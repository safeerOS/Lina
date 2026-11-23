/**
 * Preizkusi vezave cistenja zvoka v klicno pot (lastnik 21. 11. 2026: privzeto vklopljeno): stikalo zvok.json, vhod mostu
 * (VhodTwilioVLive) in LiveMost (Twilio media in SIP prek mosta), nalozi() v vstop.server.ts. Brez omrezja, lazni Live.
 * Vsi podatki so izmisljeni. NEPREVERJENO ostaja korist za razumevanje na pravih klicih. Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { formaCatalog } from "./catalog.ts";
import { t } from "./besedila.ts";
import { saveBrain } from "./keys.server.ts";
import { LiveMost, type LiveSeja, type LiveSporocilo, type NastavitveMosta, type OdvisnostiMosta, type TwilioVrata } from "./live/most.ts";
import { pravaOdvisnost } from "./live/vstop.server.ts";
import { Prevzorcevalnik, VhodTwilioVLive, mulawVPcm, pcmVBajte, pcmVMulaw } from "./live/zvok.ts";
import { CiscenjeZvoka8k } from "./zvok-ciscenje.ts";
import { DATOTEKA_ZVOKA, ciscenjeKlicevVklopljeno, nastaviCiscenjeKlicev, preberiNastavitveZvoka } from "./zvok-ciscenje.server.ts";
import { belSum, sinteticniGovor, zmesaj } from "./zvok-sinteticno.ts";

process.env.LINA_LLM = "0";
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-zvok-vezava-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));

async function nova(): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  return { dir, token: await setupOwner("geslo-test-1234", dir) };
}
const datoteka = (dir: string) => path.join(dir, DATOTEKA_ZVOKA);

describe("stikalo zvok.json", () => {
  it("brez datoteke je cistenje klicev VKLOPLJENO (privzeto)", async () => {
    const { dir, token } = await nova();
    assert.equal(existsSync(datoteka(dir)), false);
    assert.equal(await ciscenjeKlicevVklopljeno(dir), true);
    assert.deepEqual(await preberiNastavitveZvoka(token, dir), { ciscenjeKlicev: true });
  });

  it("izklop in ponovni vklop se shranita; samo izrecni false izklopi", async () => {
    const { dir, token } = await nova();
    assert.deepEqual(await nastaviCiscenjeKlicev(false, token, dir), { ciscenjeKlicev: false });
    assert.equal(await ciscenjeKlicevVklopljeno(dir), false);
    assert.deepEqual(JSON.parse(readFileSync(datoteka(dir), "utf8")), { ciscenjeKlicev: false });
    assert.deepEqual(await preberiNastavitveZvoka(token, dir), { ciscenjeKlicev: false });
    assert.deepEqual(await nastaviCiscenjeKlicev(true, token, dir), { ciscenjeKlicev: true });
    assert.equal(await ciscenjeKlicevVklopljeno(dir), true);
    for (const vsebina of ['{"ciscenjeKlicev":"false"}', '{"ciscenjeKlicev":0}', '{"ciscenjeKlicev":null}', "{}", "[]", "to ni json", ""]) {
      writeFileSync(datoteka(dir), vsebina);
      assert.equal(await ciscenjeKlicevVklopljeno(dir), true, vsebina);
    }
  });

  it("ni vrednosti true/false: vrze in datoteke ne spremeni; brez prijave vrze", async () => {
    const { dir, token } = await nova();
    await nastaviCiscenjeKlicev(false, token, dir);
    const prej = readFileSync(datoteka(dir), "utf8");
    for (const v of ["true", "false", 1, 0, null, undefined, {}, []]) await assert.rejects(nastaviCiscenjeKlicev(v, token, dir), /Neveljavna nastavitev/);
    assert.equal(readFileSync(datoteka(dir), "utf8"), prej);
    for (const zeton of [null, "napacen"]) {
      await assert.rejects(nastaviCiscenjeKlicev(true, zeton, dir));
      await assert.rejects(preberiNastavitveZvoka(zeton, dir));
    }
    assert.equal(readFileSync(datoteka(dir), "utf8"), prej);
  });
});

const govor = sinteticniGovor(8000 * 4);
const hrup = zmesaj(govor, belSum(8000 * 4), 5);

function vOkvirje(pcm: Int16Array): Uint8Array[] {
  const mulaw = pcmVMulaw(pcm);
  const okvirji: Uint8Array[] = [];
  for (let i = 0; i + 160 <= mulaw.length; i += 160) okvirji.push(mulaw.slice(i, i + 160));
  return okvirji;
}

function pricakovano(okvirji: Uint8Array[], ciscenje: boolean): Uint8Array[] {
  const gor = new Prevzorcevalnik(8000, 16000);
  const c = ciscenje ? new CiscenjeZvoka8k() : null;
  return okvirji.map((o) => {
    const pcm8 = mulawVPcm(o);
    return pcmVBajte(gor.process(c ? c.obdelaj(pcm8) : pcm8));
  });
}

const zdruzi = (deli: Uint8Array[]): Buffer => Buffer.concat(deli.map((d) => Buffer.from(d)));

/** Primerjava brez izpisa razlike celotnih medpomnilnikov (assert.deepEqual na velikih Buffer-jih je 21. 11. 2026 pojedel 17 GB pomnilnika). */
function jednako(dobljeno: Buffer, pricakovano: Buffer, ime = ""): void {
  let prvi = -1;
  const n = Math.min(dobljeno.length, pricakovano.length);
  for (let i = 0; i < n; i++) {
    if (dobljeno[i] !== pricakovano[i]) {
      prvi = i;
      break;
    }
  }
  assert.ok(dobljeno.length === pricakovano.length && prvi === -1, `${ime} dolzina ${dobljeno.length} proti ${pricakovano.length}, prva razlika pri ${prvi}`);
}
const energija16 = (b: Buffer): number => {
  let e = 0;
  const n = b.length / 2;
  for (let i = 0; i < n; i++) e += b.readInt16LE(i * 2) ** 2;
  return e / n;
};

describe("VhodTwilioVLive: mu-law 8 kHz -> PCM 16 kHz", () => {
  const okvirji = vOkvirje(hrup);

  it("brez argumenta ne cisti (drugi uporabniki ostanejo nespremenjeni)", () => {
    const v = new VhodTwilioVLive();
    const izhod = okvirji.map((o) => v.process(o));
    jednako(zdruzi(izhod), zdruzi(pricakovano(okvirji, false)), "brez");
  });

  it("z ciscenjem: natancno cistilnik pred prevzorcenjem; izhod enako dolg, drugacen od necistega", () => {
    const v = new VhodTwilioVLive(true);
    const izhod = okvirji.map((o) => v.process(o));
    jednako(zdruzi(izhod), zdruzi(pricakovano(okvirji, true)), "cisto");
    assert.ok(!zdruzi(izhod).equals(zdruzi(pricakovano(okvirji, false))));
    const brezCiscenja = pricakovano(okvirji, false);
    for (const [i, o] of izhod.entries()) assert.equal(o.length, (brezCiscenja[i] as Uint8Array).length);
  });

  it("samo hrup: energija po prvi sekundi pade vsaj za 5 dB", () => {
    const sum = vOkvirje(Int16Array.from(belSum(8000 * 4, 9), (x) => Math.round(x * 800)));
    const brez = zdruzi(sum.map((o) => new VhodTwilioVLive(false).process(o)));
    const v = new VhodTwilioVLive(true);
    const z = zdruzi(sum.map((o) => v.process(o)));
    const od = 16000 * 2; // bajtov: 1 s pri 16 kHz = 32000 bajtov
    assert.ok(10 * Math.log10(energija16(brez.subarray(od)) / energija16(z.subarray(od))) >= 5);
  });
});

function laznMost(nastavitve: Partial<NastavitveMosta>) {
  const livePoslano: Array<{ realtimeInput?: { audio?: { data: string } } }> = [];
  const twilio: TwilioVrata = { poslji: () => undefined, zapri: () => undefined };
  let liveOdprt = false;
  let liveNaSporocilo: ((m: LiveSporocilo) => void) | null = null;
  const seja: LiveSeja = { poslji: (m) => void livePoslano.push(m as never), zapri: () => undefined };
  const nast: NastavitveMosta = {
    setup: { setup: { model: "test" } },
    katalog: formaCatalog(),
    pozdrav: "Dober dan, tukaj Lina, pomocnica z umetno inteligenco.",
    temaOdgovor: t("temaPrivzeto"),
    oprostilo: t("oprostiteSlovo"),
    najdaljsiMinut: null,
    ...nastavitve,
  };
  const odv: OdvisnostiMosta = {
    porabiZeton: (z) => (z === "ok-zeton" ? { izid: "ok", from: "+38640000001" } : { izid: "neveljaven", from: "" }),
    nalozi: async () => nast,
    odpriLive: async (p: { setup: object; onSporocilo(m: LiveSporocilo): void }) => {
      liveOdprt = true;
      liveNaSporocilo = p.onSporocilo;
      return seja;
    },
    zapisnik: {
      zacni: async () => undefined,
      izrek: async () => undefined,
      odgovor: async () => undefined,
      vrzel: async () => undefined,
      cas: async () => null,
      povprasevanje: async () => ({ sprejeto: [], zavrnjeno: [] }),
      zakljuci: async () => undefined,
      dobesedno: async () => undefined,
    },
    zasedenost: { osvezi: () => undefined, sprosti: () => undefined },
    posnetek: async () => new Uint8Array(1600),
    tikMs: 10,
  };
  const most = new LiveMost(twilio, odv);
  most.naSporocilo(JSON.stringify({ event: "connected" }));
  most.naSporocilo(
    JSON.stringify({
      event: "start",
      start: { streamSid: "MZ100000000000000000000000000001", callSid: "KLIC-PREIZKUS-0001", mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 }, customParameters: { zeton: "ok-zeton" } },
    }),
  );
  return {
    most,
    livePoslano,
    emitLive: (m: LiveSporocilo) => liveNaSporocilo?.(m),
    get liveOdprt() {
      return liveOdprt;
    },
    poslji: (o: Uint8Array) => most.naSporocilo(JSON.stringify({ event: "media", media: { track: "inbound", payload: Buffer.from(o).toString("base64") } })),
  };
}

async function cakajDo(pogoj: () => boolean, ms = 3000): Promise<void> {
  const rok = Date.now() + ms;
  while (!pogoj()) {
    if (Date.now() > rok) throw new Error("rok cakanja potekel");
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function zvokVLive(nastavitve: Partial<NastavitveMosta>): Promise<Buffer> {
  const ok = laznMost(nastavitve);
  await cakajDo(() => ok.liveOdprt);
  await new Promise((r) => setTimeout(r, 700)); // pozdrav (200 ms) je konec
  ok.emitLive({ setupComplete: {} }); // Live je nared: vhod gre naravnost v Live
  const okvirji = vOkvirje(hrup).slice(0, 120);
  for (const o of okvirji) ok.poslji(o);
  await ok.most.zakljuci("stop");
  const deli = ok.livePoslano.filter((m) => m.realtimeInput?.audio).map((m) => Buffer.from((m.realtimeInput?.audio as { data: string }).data, "base64"));
  return Buffer.concat(deli);
}

describe("LiveMost: zvok klicatelja (Twilio media; SIP gre prek istega mosta)", { timeout: 30000 }, () => {
  const okvirji = vOkvirje(hrup).slice(0, 120);

  it("privzeto (nastavitev brez polja) se cisti", async () => {
    jednako(await zvokVLive({}), zdruzi(pricakovano(okvirji, true)));
  });

  it("ciscenjeZvoka: true se cisti", async () => {
    jednako(await zvokVLive({ ciscenjeZvoka: true }), zdruzi(pricakovano(okvirji, true)));
  });

  it("ciscenjeZvoka: false izklopi: zvok gre v Live nespremenjen", async () => {
    jednako(await zvokVLive({ ciscenjeZvoka: false }), zdruzi(pricakovano(okvirji, false)));
  });
});

describe("pravaOdvisnost.nalozi() prebere stikalo", () => {
  async function nalozi(dir: string, token: string) {
    await saveBrain({ provider: "vertex", project: "moj-projekt-test", model: "gemini-3-flash-preview" }, token, dir);
    return pravaOdvisnost(dir, { osvezi: () => undefined, sprosti: () => undefined }, () => undefined).nalozi();
  }

  it("privzeto true; po izklopu false; po vklopu spet true", async () => {
    const { dir, token } = await nova();
    assert.equal((await nalozi(dir, token)).ciscenjeZvoka, true);
    await nastaviCiscenjeKlicev(false, token, dir);
    assert.equal((await nalozi(dir, token)).ciscenjeZvoka, false);
    await nastaviCiscenjeKlicev(true, token, dir);
    assert.equal((await nalozi(dir, token)).ciscenjeZvoka, true);
  });
});
