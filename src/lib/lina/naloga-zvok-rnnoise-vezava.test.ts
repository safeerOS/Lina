/**
 * Naloga 17a: vezava RNNoise v klicno pot. (b) Twilio Media Streams / SIP (8 kHz, VhodTwilioVLive) in (c) telefon kot prehod
 * (naPcm16k, 16 kHz, danes brez filtra - NACRT #4). Cistilnik dobi most prek odvisnosti ciscenjeRnnoise (most.ts ne uvaza
 * WASM). Stikalo izklopljeno ali RNNoise ni nalozen = vedenje kot prej, bajt za bajtom. Lazen Live, brez omrezja.
 * Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { t } from "./besedila.ts";
import { formaCatalog } from "./catalog.ts";
import { saveBrain } from "./keys.server.ts";
import { LiveMost, WIENER_Z_RNNOISE, type LiveSeja, type LiveSporocilo, type NastavitveMosta, type OdvisnostiMosta } from "./live/most.ts";
import { MESANICA_RNNOISE_16K, pravaOdvisnost } from "./live/vstop.server.ts";
import { Prevzorcevalnik, mulawVPcm, pcmVBajte, pcmVMulaw, type CistilnikPcm } from "./live/zvok.ts";
import { CiscenjeZvoka8k } from "./zvok-ciscenje.ts";
import { CiscenjeRnnoise } from "./zvok-rnnoise.server.ts";
import { nastaviCiscenjeKlicev } from "./zvok-ciscenje.server.ts";
import { belSum, sinteticniGovor, zmesaj } from "./zvok-sinteticno.ts";

process.env.LINA_LLM = "0";
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-rnnoise-vezava-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));

/** Lazen cistilnik: obrne predznak in steje (ohrani stevilo vzorcev). */
function lazen(frekvenca: number, dnevnik: string[]): CistilnikPcm {
  let unicen = false;
  return {
    obdelaj(pcm: Int16Array): Int16Array {
      dnevnik.push(`obdelaj-${frekvenca}`);
      return unicen ? Int16Array.from(pcm) : Int16Array.from(pcm, (v) => (v === -32768 ? 32767 : -v));
    },
    unici() {
      if (!unicen) dnevnik.push(`unici-${frekvenca}`);
      unicen = true;
    },
  };
}
const obrni = (pcm: Int16Array): Int16Array => Int16Array.from(pcm, (v) => (v === -32768 ? 32767 : -v));

const hrup = zmesaj(sinteticniGovor(8000 * 3), belSum(8000 * 3), 5);
function vOkvirje(pcm: Int16Array): Uint8Array[] {
  const mulaw = pcmVMulaw(pcm);
  const okvirji: Uint8Array[] = [];
  for (let i = 0; i + 160 <= mulaw.length; i += 160) okvirji.push(mulaw.slice(i, i + 160));
  return okvirji.slice(0, 100);
}
const zdruzi = (deli: Uint8Array[]): Buffer => Buffer.concat(deli.map((d) => Buffer.from(d)));
function jednako(a: Buffer, b: Buffer, ime: string): void {
  let prvi = -1;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      prvi = i;
      break;
    }
  }
  assert.ok(a.length === b.length && prvi === -1, `${ime}: dolzina ${a.length} proti ${b.length}, prva razlika ${prvi}`);
}

function most(nast: Partial<NastavitveMosta>, tovarna: OdvisnostiMosta["ciscenjeRnnoise"]) {
  const poslano: Buffer[] = [];
  const kode: string[] = [];
  let naSporocilo: ((m: LiveSporocilo) => void) | null = null;
  const seja: LiveSeja = {
    poslji: (m) => {
      const a = (m as { realtimeInput?: { audio?: { data: string } } }).realtimeInput?.audio;
      if (a) poslano.push(Buffer.from(a.data, "base64"));
    },
    zapri: () => undefined,
  };
  const odv: OdvisnostiMosta = {
    porabiZeton: () => ({ izid: "ok", from: "+38640000002" }),
    nalozi: async () => ({ setup: { setup: { model: "test" } }, katalog: formaCatalog(), pozdrav: "Dober dan, tukaj Lina, pomocnica z umetno inteligenco.", temaOdgovor: t("temaPrivzeto"), oprostilo: t("oprostiteSlovo"), najdaljsiMinut: null, ...nast }),
    odpriLive: async (p) => {
      naSporocilo = p.onSporocilo;
      return seja;
    },
    zapisnik: { zacni: async () => undefined, izrek: async () => undefined, odgovor: async () => undefined, vrzel: async () => undefined, cas: async () => null, povprasevanje: async () => ({ sprejeto: [], zavrnjeno: [] }), zakljuci: async () => undefined, dobesedno: async () => undefined },
    zasedenost: { osvezi: () => undefined, sprosti: () => undefined },
    posnetek: async () => new Uint8Array(1600),
    tikMs: 10,
    dnevnik: (koda) => void kode.push(koda),
    ...(tovarna ? { ciscenjeRnnoise: tovarna } : {}),
  };
  const m = new LiveMost({ poslji: () => undefined, zapri: () => undefined }, odv);
  m.naSporocilo(JSON.stringify({ event: "connected" }));
  m.naSporocilo(JSON.stringify({ event: "start", start: { streamSid: "MZ200000000000000000000000000002", callSid: "KLIC-RNN-0001", mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 }, customParameters: { zeton: "z" } } }));
  return { m, poslano, kode, odprt: () => naSporocilo !== null, emit: (s: LiveSporocilo) => naSporocilo?.(s) };
}

async function nared(o: ReturnType<typeof most>): Promise<void> {
  const rok = Date.now() + 3000;
  while (!o.odprt()) {
    if (Date.now() > rok) throw new Error("Live se ni odprl");
    await new Promise((r) => setTimeout(r, 10));
  }
  await new Promise((r) => setTimeout(r, 700));
  o.emit({ setupComplete: {} });
}

function pricakovano8(okvirji: Uint8Array[], wiener: boolean, dodatno: boolean): Buffer {
  const gor = new Prevzorcevalnik(8000, 16000);
  const w = wiener ? new CiscenjeZvoka8k() : null;
  return zdruzi(
    okvirji.map((o) => {
      let pcm = mulawVPcm(o);
      if (w) pcm = w.obdelaj(pcm);
      if (dodatno) pcm = obrni(pcm);
      return pcmVBajte(gor.process(pcm));
    }),
  );
}

describe("(b) Twilio / SIP 8 kHz: RNNoise za stikalom", { timeout: 30000 }, () => {
  const okvirji = vOkvirje(hrup);
  for (const [ime, nast] of [["privzeto", {}], ["izrecno vklopljeno", { ciscenjeZvoka: true }]] as const) {
    it(`${ime}: zvok v Live = ${WIENER_Z_RNNOISE ? "Wiener, nato " : ""}RNNoise (8 kHz), nato 16 kHz; ob koncu klica unici natanko enkrat`, async () => {
      const dn: string[] = [];
      const o = most(nast, (fs) => lazen(fs, dn));
      await nared(o);
      for (const k of okvirji) o.m.naSporocilo(JSON.stringify({ event: "media", media: { track: "inbound", payload: Buffer.from(k).toString("base64") } }));
      await o.m.zakljuci("stop");
      await o.m.zakljuci("stop");
      jednako(Buffer.concat(o.poslano), pricakovano8(okvirji, WIENER_Z_RNNOISE, true), ime);
      assert.equal(dn.filter((d) => d === "unici-8000").length, 1);
      assert.equal(dn.filter((d) => d.endsWith("16000")).length, 0, "pot Twilio ne ustvari 16 kHz cistilnika");
    });
  }

  it("stikalo izklopljeno: tovarna se ne poklice, zvok bajt za bajtom kot prej (brez ciscenja)", async () => {
    let klicev = 0;
    const o = most({ ciscenjeZvoka: false }, () => {
      klicev += 1;
      return null;
    });
    await nared(o);
    for (const k of okvirji) o.m.naSporocilo(JSON.stringify({ event: "media", media: { track: "inbound", payload: Buffer.from(k).toString("base64") } }));
    await o.m.zakljuci("stop");
    assert.equal(klicev, 0);
    jednako(Buffer.concat(o.poslano), pricakovano8(okvirji, false, false), "izklop");
  });

  it("RNNoise ni na voljo (tovarna vrne null ali vrze): danasnja pot (samo Wiener)", async () => {
    for (const tovarna of [() => null, () => { throw new Error("wasm"); }]) {
      const o = most({}, tovarna);
      await nared(o);
      for (const k of okvirji) o.m.naSporocilo(JSON.stringify({ event: "media", media: { track: "inbound", payload: Buffer.from(k).toString("base64") } }));
      await o.m.zakljuci("stop");
      jednako(Buffer.concat(o.poslano), pricakovano8(okvirji, true, false), "brez RNNoise");
    }
  });
});

describe("(c) telefon kot prehod 16 kHz (naPcm16k): RNNoise za stikalom", { timeout: 30000 }, () => {
  const pcm16 = new Prevzorcevalnik(8000, 16000).process(hrup);
  const kosi: Uint8Array[] = [];
  for (let i = 0; i + 320 <= pcm16.length && kosi.length < 100; i += 320) kosi.push(pcmVBajte(pcm16.subarray(i, i + 320)));

  it("vklopljeno: vsak kos gre skozi 16 kHz cistilnik (isto stevilo bajtov), ob koncu unici", async () => {
    const dn: string[] = [];
    const o = most({}, (fs) => lazen(fs, dn));
    await nared(o);
    for (const k of kosi) o.m.naPcm16k(k);
    await o.m.zakljuci("stop");
    const pricakovano = zdruzi(kosi.map((k) => pcmVBajte(obrni(new Int16Array(new Uint8Array(k).buffer)))));
    jednako(Buffer.concat(o.poslano), pricakovano, "telefon");
    assert.equal(dn.filter((d) => d === "unici-16000").length, 1);
  });

  it("izklopljeno ali brez RNNoise: kosi gredo v Live nespremenjeni (kot danes); vklopljeno brez RNNoise se zapise v dnevnik", async () => {
    for (const [nast, tovarna, koda] of [[{ ciscenjeZvoka: false }, (fs: 8000 | 16000) => lazen(fs, []), 0], [{}, () => null, 1]] as const) {
      const o = most(nast, tovarna);
      await nared(o);
      for (const k of kosi) o.m.naPcm16k(k);
      await o.m.zakljuci("stop");
      jednako(Buffer.concat(o.poslano), zdruzi(kosi), "nespremenjeno");
      // Stikalo vklopljeno, RNNoise pa ni na voljo (npr. vendor manjka v svezenju): enkrat na klic, sicer lastnik napake ne vidi.
      assert.equal(o.kode.filter((d) => d === "rnnoise-ni-na-voljo").length, koda);
    }
  });

  it("pregled 0213 C4: napaka RNNoise sredi klica ne konca klica - cistilnik se unici, naprej gre surov zvok, dnevnik rnnoise-napaka", async () => {
    const dn: string[] = [];
    let klicev = 0;
    // samo 16 kHz (pot telefona); 8 kHz cistilnik bi zgradila pot Twilio v tem lazniku in ga ob koncu prav tako unicila
    const o = most({}, (fs) => fs !== 16000 ? null : ({
      obdelaj(pcm: Int16Array): Int16Array {
        klicev += 1;
        if (klicev === 3) throw new Error("RuntimeError: unreachable (abort WASM)");
        return obrni(pcm);
      },
      unici() { dn.push("unici"); },
    }));
    await nared(o);
    for (const k of kosi) assert.doesNotThrow(() => o.m.naPcm16k(k), "izjema cistilnika ne sme iz naPcm16k (klic bi se koncal)");
    await o.m.zakljuci("stop");
    const pricakovano = zdruzi(kosi.map((k, i) => (i < 2 ? pcmVBajte(obrni(new Int16Array(new Uint8Array(k).buffer))) : k)));
    jednako(Buffer.concat(o.poslano), pricakovano, "po napaki surov zvok");
    assert.equal(klicev, 3, "po napaki se pokvarjen modul ne klice vec");
    assert.deepEqual(dn, ["unici"]);
    assert.equal(o.kode.filter((d) => d === "rnnoise-napaka").length, 1);
  });
});

describe("pravaOdvisnost: RNNoise se nalozi v nalozi() in tovarna da CiscenjeRnnoise z izbrano mesanico", { timeout: 30000 }, () => {
  it("vklopljeno: 16 kHz (telefon kot prehod) dobi RNNoise 50/50; 8 kHz (Twilio/SIP) ne - meritev WER: samo Wiener; izklopljeno: nalozi deluje", async () => {
    const dir = await mkdtemp(path.join(KOREN, "d-"));
    const token = await setupOwner("geslo-test-1234", dir);
    await saveBrain({ provider: "vertex", project: "moj-projekt-test", model: "gemini-3-flash-preview" }, token, dir);
    const odv = pravaOdvisnost(dir, { osvezi: () => undefined, sprosti: () => undefined }, () => undefined);
    assert.equal((await odv.nalozi()).ciscenjeZvoka, true);
    // Brez assert.equal(objekt, null): ob padcu bi izpis objekta z vezavo WASM porabil vec GB (OOM v enoti 3 GB).
    const c8 = odv.ciscenjeRnnoise?.(8000);
    c8?.unici();
    assert.ok(c8 === null, `pot Twilio/SIP ostane samo Wiener (POROCILO.md naloge 17a), dobljeno: ${c8 ? "cistilnik" : String(c8)}`);
    const c16 = odv.ciscenjeRnnoise?.(16000);
    assert.ok(c16 instanceof CiscenjeRnnoise);
    assert.equal(c16.mesanica, MESANICA_RNNOISE_16K);
    assert.equal(c16.mesanica, 0.5);
    assert.equal(c16.obdelaj(new Int16Array(320)).length, 320);
    c16.unici();
    await nastaviCiscenjeKlicev(false, token, dir);
    assert.equal((await odv.nalozi()).ciscenjeZvoka, false);
  });
});
