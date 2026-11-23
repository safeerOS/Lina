/**
 * Naloga G2. Glas Gemini TTS namesto Twiliovega Say, obrat mimo webhooka, hitrost mozganov, potek klica.
 * Nikjer pravega omrezja: sinteza je lazni izvajalec ali vbrizgan fetch, model je stevec.
 * Preizkusi gredo skozi handleVoiceRequest, recordCaller, handleZvokRequest ali izvozeno funkcijo.
 * Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { pozabiZeton, vertexAccessToken } from "./adc.server.ts";
import { setupOwner } from "./auth.server.ts";
import { t } from "./besedila.ts";
import { absorbUtterance, emptyDraft, razberiRokOdgovora } from "./brain.ts";
import { formaCatalog } from "./catalog.ts";
import {
  GLAS_MODEL,
  NAVODILO_SLOGA,
  SEME_SINTEZE,
  kljucIzPoti,
  kljucZvoka,
  MEJA_SINTEZE,
  naslovGlasu,
  pcm24VWav8,
  pcmIzOdgovora,
  razdeliZaGlas,
  stalniStavki,
  teloGlasu,
} from "./glas.ts";
import { OBDELAVA_ZVOKA } from "./glas-izenacenje.ts";
import {
  handleZvokRequest,
  nastaviUroGlasuZaPreizkus,
  ponastaviOdklopnik,
  ponastaviOmejitevZvoka,
  ustaviCiscenjeZvoka,
  mapaZvoka,
  NapakaGlasu,
  nastaviSintezoZaPreizkus,
  pocakajDnevnikGlasu,
  pocakajGlas,
  pocistiZvok,
  pripraviStalne,
  pripraviZvok,
  sintetizirajVertex,
  solZvoka,
  stanjeGlasu,
  steviloSintezVTeku,
} from "./glas.server.ts";
import { loadPravila, savePravila } from "./pravila.server.ts";
import { dodatekLastnika, predstavitevKlica, zRazkritjem } from "./povzetek.ts";
import { podpiraMinimalniRazmislek, providerRequest } from "./providers.ts";
import { publishLine, readLine, recordCaller } from "./service.server.ts";
import { dopolniStik, prazenStik, razberiIme } from "./stik.ts";
import { handleVoiceRequest, pocakajOzadjeKlicev, steviloOpravil, ustaviCiscenjeOpravil, type MoznostiKlica } from "./voice.server.ts";

process.env.LINA_LLM = "0";

const temps: string[] = [];
// Vse mape preizkusov v eni zacasni mapi, ki jo pobrisemo ob izhodu: tudi padel tek ne pusti /tmp/lina-g2-* (pregled G2).
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-g2-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));

async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(KOREN, "lina-g2-"));
  temps.push(dir);
  return dir;
}

async function lastnik(dir: string, odprta = true): Promise<string> {
  const token = await setupOwner("geslo-test-1234", dir);
  await publishLine({ open: odprta, catalog: formaCatalog() }, { token }, dir);
  await pocakajGlas(dir);
  await pocakajOpravila();
  // G3 (V1): linija se odpre sama, ko je glas pripravljen; brez glasu jo uporabnik odpre z izrecno potrditvijo.
  if (odprta && !(await readLine({ token }, dir)).open) await publishLine({ open: true, brezGlasu: true }, { token }, dir);
  await pocakajGlas(dir);
  return token;
}

/** Zapore visecih laznih sintez: afterEach jih spusti, da padel preizkus ne obesi vseh naslednjih. */
const zapore: Array<() => void> = [];

afterEach(async () => {
  for (const spusti of zapore.splice(0)) spusti();
  await pocakajOzadjeKlicev();
  delete process.env.TWILIO_AUTH_TOKEN;
  nastaviSintezoZaPreizkus(null);
  nastaviUroGlasuZaPreizkus(null);
  ponastaviOdklopnik();
  ponastaviOmejitevZvoka();
  ustaviCiscenjeOpravil();
  pozabiZeton();
  while (temps.length) {
    const dir = temps.pop();
    if (!dir) continue;
    await pocakajGlas(dir);
    await pocakajDnevnikGlasu(dir);
    ustaviCiscenjeZvoka(dir);
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

const IZVOR = "https://lina.primer";
const SKRIVNOST = "twilio-zeton-preizkusa";

function podpisanaZahteva(pot: string, params: Record<string, string>, podpis?: string): Request {
  process.env.TWILIO_AUTH_TOKEN = SKRIVNOST;
  const signed = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], `${IZVOR}${pot}`);
  const good = createHmac("sha1", SKRIVNOST).update(signed).digest("base64");
  return new Request(`${IZVOR}${pot}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": podpis ?? good },
    body: new URLSearchParams(params).toString(),
  });
}

async function klic(dir: string, pot: string, params: Record<string, string>, moznosti: MoznostiKlica = {}): Promise<string> {
  const odgovor = await handleVoiceRequest(podpisanaZahteva(pot, params), dir, undefined, moznosti);
  assert.equal(odgovor.status, 200);
  return odgovor.text();
}

/** Lazni izvajalec sinteze: steje klice, lahko zamuja, visi ali pade za izbrano besedilo. */
function lazniGlas(moznosti: { pocasno?: RegExp; zamudaMs?: number; pade?: RegExp; visi?: RegExp } = {}) {
  const stanje = { klici: [] as string[], spusti: () => undefined as void };
  const zapora = new Promise<void>((resolve) => {
    stanje.spusti = resolve;
  });
  zapore.push(() => stanje.spusti());
  nastaviSintezoZaPreizkus(async (besedilo) => {
    stanje.klici.push(besedilo);
    if (moznosti.pade?.test(besedilo)) throw new NapakaGlasu("glasNapaka", 503);
    if (moznosti.visi?.test(besedilo)) await zapora;
    if (moznosti.pocasno?.test(besedilo)) await new Promise((resolve) => setTimeout(resolve, moznosti.zamudaMs ?? 150));
    // 0,1 s tona: 2400 vzorcev PCM 24 kHz.
    const pcm = Buffer.alloc(4800);
    for (let i = 0; i < 2400; i += 1) pcm.writeInt16LE(Math.round(8000 * Math.sin(i / 8)), i * 2);
    return pcm;
  });
  return stanje;
}

/** Pocaka, da je obrat zapisan (dogodek, ne cas): besedilo je, glas pa lahko se visi. */
async function pocakajZapisObrata(dir: string, sid: string, obrat: number): Promise<void> {
  for (let i = 0; i < 2_000; i += 1) {
    const knjiga = JSON.parse(await readFile(path.join(dir, "calls.json"), "utf8").catch(() => "{}")) as Record<string, { obrat?: number }>;
    if ((knjiga[sid]?.obrat ?? 0) >= obrat) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

function modelStevec() {
  const stanje = { klici: 0 };
  return {
    stanje,
    model: async (facts: string) => {
      stanje.klici += 1;
      return facts;
    },
  };
}

function predvajani(twiml: string): string[] {
  return [...twiml.matchAll(/<Play>([^<]+)<\/Play>/g)].map((m) => m[1]);
}

async function pocakajOpravila(): Promise<void> {
  for (let i = 0; i < 200 && (steviloOpravil() > 0 || steviloSintezVTeku() > 0); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("naloga G2 glas: pretvorba, kljuc, predpomnilnik", { concurrency: 1 }, () => {
  it("A2 PCM 24 kHz postane WAV 16-bit mono 8 kHz z glavo RIFF in povprecenimi vzorci", () => {
    const pcm = Buffer.alloc(14);
    [300, 600, 900, -300, -600, -900, 1234].forEach((v, i) => pcm.writeInt16LE(v, i * 2));
    const wav = pcm24VWav8(pcm.subarray(0, 13));
    assert.equal(wav.length, 44 + 4);
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.readUInt32LE(4), 36 + 4);
    assert.equal(wav.toString("ascii", 8, 16), "WAVEfmt ");
    assert.equal(wav.readUInt32LE(16), 16);
    assert.equal(wav.readUInt16LE(20), 1);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), 8000);
    assert.equal(wav.readUInt32LE(28), 16000);
    assert.equal(wav.readUInt16LE(32), 2);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.toString("ascii", 36, 40), "data");
    assert.equal(wav.readUInt32LE(40), 4);
    assert.equal(wav.readInt16LE(44), 600);
    assert.equal(wav.readInt16LE(46), -600);
    // 1 s zvoka: 24000 vzorcev -> 8000 vzorcev.
    assert.equal(pcm24VWav8(Buffer.alloc(48000)).length, 44 + 16000);
  });

  it("A3 kljuc je 32 hex znakov HMAC s soljo: brez soli ga iz besedila ni mogoce izracunati", () => {
    const sol = randomBytes(32);
    const kljuc = kljucZvoka(sol, "Hvala. Kako vam lahko pomagam?");
    assert.match(kljuc, /^[0-9a-f]{32}$/);
    const pricakovan = createHmac("sha256", sol)
      .update(`${GLAS_MODEL}|Kore|${NAVODILO_SLOGA}|${OBDELAVA_ZVOKA}|${SEME_SINTEZE}|Hvala. Kako vam lahko pomagam?`)
      .digest("hex")
      .slice(0, 32);
    assert.equal(kljuc, pricakovan);
    assert.notEqual(kljuc, kljucZvoka(randomBytes(32), "Hvala. Kako vam lahko pomagam?"));
    assert.notEqual(kljuc, kljucZvoka(sol, "Hvala. Kako vam lahko pomagam"));
    assert.notEqual(kljuc, kljucZvoka(sol, "Hvala. Kako vam lahko pomagam?", GLAS_MODEL, "Puck"));
    assert.equal(kljuc, kljucZvoka(sol, "  Hvala.   Kako vam lahko pomagam? "));
    assert.throws(() => kljucZvoka(Buffer.alloc(8), "x"));
  });

  it("A3 sol je nakljucna, 32 bajtov, v mapi podatkov z dovoljenji 0600 in ostane ista", async () => {
    const dir = await scratch();
    const druga = await scratch();
    const sol = await solZvoka(dir);
    assert.equal(sol.length, 32);
    assert.deepEqual(await solZvoka(dir), sol);
    assert.deepEqual(await readFile(path.join(dir, ".sol-zvoka")), sol);
    assert.notDeepEqual(await solZvoka(druga), sol);
    if (process.platform !== "win32") {
      assert.equal((await stat(path.join(dir, ".sol-zvoka"))).mode & 0o777, 0o600);
    }
  });

  it("A3 dve socasni zahtevi za isto besedilo sta ena sinteza, zapis je atomaren in v mapi zvok", async () => {
    const dir = await scratch();
    const glas = lazniGlas({ pocasno: /./, zamudaMs: 40 });
    const [a, b, c] = await Promise.all([
      pripraviZvok("Zapisala sem mizo.", dir),
      pripraviZvok("Zapisala sem mizo.", dir),
      pripraviZvok("  Zapisala   sem mizo. ", dir),
    ]);
    assert.equal(a, b);
    assert.equal(a, c);
    assert.equal(glas.klici.length, 1);
    // Tretjic iz predpomnilnika.
    assert.equal(await pripraviZvok("Zapisala sem mizo.", dir), a);
    assert.equal(glas.klici.length, 1);
    const imena = await readdir(mapaZvoka(dir));
    assert.deepEqual(imena, [`${a}.wav`]);
    const wav = await readFile(path.join(mapaZvoka(dir), `${a}.wav`));
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.length, 44 + 1600);
    assert.equal(steviloSintezVTeku(), 0);
  });

  it("A3 najvec 600 znakov na sintezo: daljse besedilo se razreze po stavkih, stalni stavki so svoj kos", async () => {
    const dolg = Array.from({ length: 30 }, (_, i) => `To je stavek stevilka ${i + 1} o mizi iz hrasta.`).join(" ");
    assert.ok(dolg.length > 2 * MEJA_SINTEZE);
    const kosi = razdeliZaGlas(dolg);
    assert.ok(kosi.length >= 3);
    for (const kos of kosi) {
      assert.ok(kos.length <= MEJA_SINTEZE);
      assert.match(kos, /\.$/);
    }
    assert.equal(kosi.join(" "), dolg);
    assert.deepEqual(
      razdeliZaGlas("Zapisala sem Alba do 15. decembra. Hvala. Do kdaj potrebujete izdelano naročilo?", [
        t("hvalaStik"),
        t("prosiRok"),
      ]),
      ["Zapisala sem Alba do 15. decembra.", "Hvala.", "Do kdaj potrebujete izdelano naročilo?"],
    );
    assert.ok(razdeliZaGlas("a".repeat(1500)).every((kos) => kos.length <= MEJA_SINTEZE));
    const dir = await scratch();
    lazniGlas();
    await assert.rejects(pripraviZvok("b".repeat(MEJA_SINTEZE + 1), dir), NapakaGlasu);
  });

  it("A3 nestalni posnetki starejsi od ene ure se pobrisejo, stalni ostanejo, mapa ima mejo velikosti", async () => {
    const dir = await scratch();
    lazniGlas();
    const stalni = await pripraviZvok("Trenutek, prosim.", dir, { stalno: true });
    const star = await pripraviZvok("Gospod Novak, zapisala sem.", dir);
    const svez = await pripraviZvok("Zapisala sem mizo.", dir);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const predDvemaUrama = new Date(Date.now() - 2 * 60 * 60 * 1000);
    for (const kljuc of [stalni, star]) await utimes(path.join(mapaZvoka(dir), `${kljuc}.wav`), predDvemaUrama, predDvemaUrama);
    const izid = await pocistiZvok(dir);
    assert.equal(izid.pobrisanih, 1);
    const imena = await readdir(mapaZvoka(dir));
    assert.equal(imena.includes(`${star}.wav`), false);
    assert.equal(imena.includes(`${stalni}.wav`), true);
    assert.equal(imena.includes(`${svez}.wav`), true);

    // Meja velikosti: najstarejsi nestalni gredo ven, stalni nikoli.
    const drugi = await pripraviZvok("Drugi odgovor.", dir);
    const pred = new Date(Date.now() - 60_000);
    await utimes(path.join(mapaZvoka(dir), `${svez}.wav`), pred, pred);
    const poMeji = await pocistiZvok(dir, { mejaBajtov: 2 * 1644 });
    assert.equal(poMeji.pobrisanih, 1);
    const ostali = await readdir(mapaZvoka(dir));
    assert.equal(ostali.includes(`${svez}.wav`), false);
    assert.equal(ostali.includes(`${drugi}.wav`), true);
    assert.equal(ostali.includes(`${stalni}.wav`), true);
  });
});

describe("naloga G2 glas: zahteva Vertex", { concurrency: 1 }, () => {
  const ZETON = "ya29.TAJNI-zeton-ki-ne-sme-ven";

  function sse(pcm: Buffer): string {
    const pol = Math.floor(pcm.length / 2);
    const kos = (del: Buffer) =>
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: del.toString("base64") } }] } }] })}\n\n`;
    return kos(pcm.subarray(0, pol)) + kos(pcm.subarray(pol));
  }

  it("A1 oblika zahteve je ista kot v meritvi: naslov, telo, zeton samo v glavi", async () => {
    const videno: Array<{ url: string; init: RequestInit }> = [];
    const pcm = Buffer.from(Array.from({ length: 600 }, (_, i) => i % 251));
    const lazniFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      videno.push({ url: String(url), init: init ?? {} });
      return new Response(sse(pcm), { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const ven = await sintetizirajVertex("Hvala. Kako vam lahko pomagam?", "moj-projekt", {
      fetch: lazniFetch,
      zeton: async () => ZETON,
    });
    assert.deepEqual(ven, pcm);
    assert.equal(videno.length, 1);
    assert.equal(
      videno[0].url,
      "https://aiplatform.googleapis.com/v1beta1/projects/moj-projekt/locations/global/publishers/google/models/gemini-2.5-flash-tts:streamGenerateContent?alt=sse",
    );
    assert.equal(videno[0].url.includes(ZETON), false);
    assert.equal(videno[0].init.method, "POST");
    assert.equal(videno[0].init.redirect, "error");
    assert.equal((videno[0].init.headers as Record<string, string>).authorization, `Bearer ${ZETON}`);
    assert.deepEqual(JSON.parse(String(videno[0].init.body)), {
      contents: [{ role: "user", parts: [{ text: `${NAVODILO_SLOGA}: Hvala. Kako vam lahko pomagam?` }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        seed: SEME_SINTEZE,
        speechConfig: { languageCode: "sl-SI", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
      },
    });
    assert.deepEqual(teloGlasu("x"), JSON.parse(JSON.stringify(teloGlasu("x"))));
    assert.equal(
      naslovGlasu("moj-projekt", false),
      "https://aiplatform.googleapis.com/v1beta1/projects/moj-projekt/locations/global/publishers/google/models/gemini-2.5-flash-tts:generateContent",
    );
    assert.throws(() => naslovGlasu("../../drug/pot", true));
    assert.throws(() => naslovGlasu("Moj_Projekt", true));
  });

  it("A1 zeton in odgovor ponudnika ne prideta v napako; brez prijave je razlog jasen", async () => {
    const zavrne = (async () =>
      new Response(JSON.stringify({ error: { message: `Token ${ZETON} is not allowed for Ana Novak` } }), { status: 403 })) as typeof fetch;
    await assert.rejects(
      sintetizirajVertex("Dober dan.", "moj-projekt", { fetch: zavrne, zeton: async () => ZETON }),
      (error: unknown) => {
        assert.ok(error instanceof NapakaGlasu);
        assert.equal(error.koda, "glasNapaka");
        assert.equal(error.status, 403);
        const vse = `${error.message} ${JSON.stringify(error)} ${String(error.stack)}`;
        assert.equal(vse.includes(ZETON), false);
        assert.equal(vse.includes("Ana Novak"), false);
        return true;
      },
    );
    const pade = (async () => {
      throw new Error(`connect failed with Bearer ${ZETON}`);
    }) as typeof fetch;
    await assert.rejects(
      sintetizirajVertex("Dober dan.", "moj-projekt", { fetch: pade, zeton: async () => ZETON }),
      (error: unknown) => error instanceof NapakaGlasu && !`${error.message}${String(error.stack)}`.includes(ZETON),
    );
    const { ADC_MANJKA } = await import("./adc.server.ts");
    await assert.rejects(
      sintetizirajVertex("Dober dan.", "moj-projekt", {
        fetch: pade,
        zeton: async () => {
          throw new Error(ADC_MANJKA);
        },
      }),
      (error: unknown) => error instanceof NapakaGlasu && error.koda === "glasNiPrijave",
    );
  });

  it("A1 odgovor: pretok SSE in en JSON dasta isti PCM; druga frekvenca ali prazen odgovor je napaka", () => {
    const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(pcmIzOdgovora(sse(pcm)), pcm);
    const json = JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: pcm.toString("base64") } }] } }],
    });
    assert.deepEqual(pcmIzOdgovora(json), pcm);
    assert.throws(() => pcmIzOdgovora(json.replace("rate=24000", "rate=48000")));
    assert.throws(() => pcmIzOdgovora(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ni zvoka" }] } }] })));
    assert.throws(() => pcmIzOdgovora(""));
  });
});

describe("naloga G2 glas: javna pot zvoka", { concurrency: 1 }, () => {
  it("A4 vrne samo posnetek s tocno 32 hex znaki iz mape zvok; vse drugo je 404", async () => {
    const dir = await scratch();
    lazniGlas();
    const kljuc = await pripraviZvok("Hvala.", dir);
    const dober = await handleZvokRequest(new Request(`${IZVOR}/api/voice/zvok/${kljuc}.wav`), dir);
    assert.equal(dober.status, 200);
    assert.equal(dober.headers.get("content-type"), "audio/wav");
    assert.equal(dober.headers.get("cache-control"), "no-store");
    const telo = Buffer.from(await dober.arrayBuffer());
    assert.equal(telo.toString("ascii", 0, 4), "RIFF");
    assert.equal(dober.headers.get("content-length"), String(telo.length));

    // Datoteke zunaj mape zvok: skrivnost v mapi podatkov in posnetek z veljavnim imenom eno mapo vise.
    const zunaj = "ab".repeat(16);
    await writeFile(path.join(dir, `${zunaj}.wav`), Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(100)]));
    await writeFile(path.join(dir, "kljuci.json"), "{\"skrivnost\":true}");
    const neobstojec = "0123456789abcdef0123456789abcdef";
    const poti = [
      `/api/voice/zvok/${zunaj}.wav`,
      `/api/voice/zvok/../${zunaj}.wav`,
      `/api/voice/zvok/..%2F${zunaj}.wav`,
      `/api/voice/zvok/%2e%2e/${zunaj}.wav`,
      `/api/voice/zvok/../kljuci.json`,
      `/api/voice/zvok/..%2Fkljuci.json`,
      `/api/voice/zvok/....//kljuci.json`,
      `/api/voice/zvok/${kljuc}`,
      `/api/voice/zvok/${kljuc}.wav/`,
      `/api/voice/zvok/${kljuc}.wav/../../../kljuci.json`,
      `/api/voice/zvok/${kljuc}.WAV`,
      `/api/voice/zvok/${kljuc.toUpperCase()}.wav`,
      `/api/voice/zvok/${kljuc.slice(0, 31)}.wav`,
      `/api/voice/zvok/${kljuc}a.wav`,
      `/api/voice/zvok/${kljuc}.wav%00.json`,
      `/api/voice/zvok/${neobstojec}.wav`,
      `/api/voice/zvok/.sol-zvoka`,
      `/api/voice/zvok/`,
      `/api/voice/zvok//${kljuc}.wav`,
      `/api/voice/turn`,
      `/api/voice/${kljuc}.wav`,
      `/zvok/${kljuc}.wav`,
    ];
    for (const pot of poti) {
      const odgovor = await handleZvokRequest(new Request(`${IZVOR}${pot}`), dir);
      assert.equal(odgovor.status, 404, pot);
      assert.equal((await odgovor.text()).includes("skrivnost"), false, pot);
    }
    // Poizvedba ne spremeni poti; druga metoda ni dovoljena.
    assert.equal((await handleZvokRequest(new Request(`${IZVOR}/api/voice/zvok/${kljuc}.wav?x=../../kljuci.json`), dir)).status, 200);
    assert.equal((await handleZvokRequest(new Request(`${IZVOR}/api/voice/zvok/${kljuc}.wav`, { method: "POST" }), dir)).status, 404);
    assert.equal(kljucIzPoti(`/api/voice/zvok/${kljuc}.wav`), kljuc);
    assert.equal(kljucIzPoti(`/api/voice/zvok/${kljuc}.wav\n`), null);

    // Simbolna povezava v mapi zvok ne pokaze datoteke od drugod.
    if (process.platform !== "win32") {
      const povezava = "cd".repeat(16);
      await symlink(path.join(dir, `${zunaj}.wav`), path.join(mapaZvoka(dir), `${povezava}.wav`));
      assert.equal((await handleZvokRequest(new Request(`${IZVOR}/api/voice/zvok/${povezava}.wav`), dir)).status, 404);
    }
  });

  it("A4 POST na /api/voice/* ostane pod podpisom Twilio tudi za pot zvoka", async () => {
    const dir = await scratch();
    await lastnik(dir);
    process.env.TWILIO_AUTH_TOKEN = SKRIVNOST;
    const brez = await handleVoiceRequest(
      new Request(`${IZVOR}/api/voice/zvok/${"ab".repeat(16)}.wav`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "CallSid=CA-X",
      }),
      dir,
    );
    assert.equal(brez.status, 403);
  });
});

describe("naloga G2 glas: stalni stavki in stanje linije", { concurrency: 1 }, () => {
  it("A5 stalni stavki poteka klica: pozdrav s podjetjem, vprasanja, slovo, linija zaprta, vmesni stavek", async () => {
    const stavki = stalniStavki({ pozdrav: "Lep pozdrav iz hiše." }, "FORMA", formaCatalog());
    for (const kljuc of [
      "trenutek",
      "prosiImeInPodjetje",
      "pozdravZapis",
      "kakoPomagam",
      "prosiRok",
      "prosiKolicino",
      "prosiTelefon",
      "povratniKlicSploh",
      "povzetekStik",
      "stikZakljucek",
      "slovo",
      "lepDan",
      "nisemSlisala",
    ] as const) {
      assert.ok(stavki.includes(t(kljuc)), kljuc);
    }
    // Stavek zaprte linije je med stalnimi z razkritjem UI spredaj (zRazkritjem, pregled G3 V1: razkritje je vedno prvi stavek).
    assert.ok(stavki.includes(zRazkritjem({}, t("linijaZaprta"))), "linijaZaprta z razkritjem");
    assert.notEqual(zRazkritjem({}, t("linijaZaprta")), t("linijaZaprta"));
    // Z uporabnikovim pozdravom Lina ne pove »pri FORMA« (lastnik 11. 11. 2026, izbira C).
    assert.ok(stavki.includes(t("predstavitevBrez")));
    assert.ok(stavki.includes("Lep pozdrav iz hiše."));
    assert.equal(stavki[0], t("trenutek"));
    // Pozdrav klica je en stalni stavek: predvaja se brez sinteze med klicem in je en glas (14. 11. 2026).
    assert.deepEqual(
      razdeliZaGlas(predstavitevKlica("Lep pozdrav iz hiše.", "FORMA"), stavki),
      [predstavitevKlica("Lep pozdrav iz hiše.", "FORMA")],
    );
    // G3 (N9): mnozica je ista za odprto in zaprto linijo, zato zaprtje stalnih stavkov ne odznaci.
    assert.ok(stalniStavki({ pozdrav: "" }, "FORMA", formaCatalog()).includes(zRazkritjem({}, t("linijaZaprta"))));
  });

  it("A5 odprtje linije pripravi stavke v ozadju; sprememba pozdrava in podjetja pripravi nove", async () => {
    const dir = await scratch();
    const glas = lazniGlas();
    const token = await setupOwner("geslo-test-1234", dir);
    const objava = await publishLine({ open: true, catalog: formaCatalog() }, { token }, dir);
    // G3 (V1): zahteva ne caka na sintezo, linija pa se odpre sele, ko so stalni stavki pripravljeni - sicer bi
    // prvi klic razkritje UI povedal v nerazumljivem glasu posrednika.
    assert.equal(objava.open, false);
    assert.equal(objava.odprtje.stanje, "cakaGlas");
    assert.equal(objava.glas.pripravljen, false);
    assert.equal(objava.glas.vTeku, true);
    await pocakajGlas(dir);
    assert.equal((await readLine({ token }, dir)).open, true);
    const pravila = await loadPravila(dir);
    const stavki = stalniStavki(pravila, formaCatalog().company.name, formaCatalog());
    assert.deepEqual([...glas.klici].sort(), [...stavki].sort());
    const prebrana = await readLine({ token }, dir);
    assert.deepEqual(prebrana.odprtje, { stanje: "odprta", razlog: "" });
    const stanje = prebrana.glas;
    assert.deepEqual(stanje, { pripravljen: true, vTeku: false, razlog: "", pripravljenih: stavki.length, vseh: stavki.length });

    // Ista mnozica se ne pripravlja dvakrat.
    await publishLine({ open: true, catalog: formaCatalog() }, { token }, dir);
    await pocakajGlas(dir);
    assert.equal(glas.klici.length, stavki.length);

    await savePravila({ pozdrav: "Pozdravljeni v mizarstvu." }, token, dir);
    await pocakajGlas(dir);
    // Prvi stavek je zdaj »Dober dan, tukaj Lina ...« brez podjetja (izbira C), uporabnikov pozdrav je nov posnetek.
    assert.deepEqual(
      glas.klici.slice(stavki.length).sort(),
      // Lastnik 22. 11. 2026: snemanje v nacinu podjetje privzeto vklopljeno, pozdrav napove snemanje z rokom iz pravil.
      [t("predstavitevBrez"), "Pozdravljeni v mizarstvu.", predstavitevKlica("Pozdravljeni v mizarstvu.", "FORMA", await loadPravila(dir))].sort(),
    );

    const katalog = formaCatalog();
    katalog.company.name = "Mizarstvo Hrast";
    await publishLine({ open: true, catalog: katalog }, { token }, dir);
    await pocakajGlas(dir);
    // Z uporabnikovim pozdravom ime podjetja ni v prvem stavku, zato nov posnetek ni potreben.
    assert.equal(glas.klici.length, stavki.length + 3);
    assert.equal(stanjeGlasu(dir).pripravljen, true);
  });

  it("A5 napaka sinteze ne podre odprtja linije: stanje pove »glas ni pripravljen« in razlog", async () => {
    const dir = await scratch();
    lazniGlas({ pade: /Kako vam lahko pomagam/ });
    const token = await setupOwner("geslo-test-1234", dir);
    // G3 (V1): napaka sinteze shranjevanja ne podre, linija pa brez glasu ostane zaprta z razlogom v stanju,
    // dokler uporabnik izrecno ne potrdi »odpri brez glasu«.
    const objava = await publishLine({ open: true, catalog: formaCatalog() }, { token }, dir);
    assert.equal(objava.open, false);
    await pocakajGlas(dir);
    const caka = await readLine({ token }, dir);
    assert.equal(caka.open, false);
    assert.deepEqual(caka.odprtje, { stanje: "cakaGlas", razlog: "glasNapaka" });
    const brez = await publishLine({ open: true, brezGlasu: true }, { token }, dir);
    assert.equal(brez.open, true);
    assert.equal(brez.odprtje.stanje, "odprtaBrezGlasu");
    await pocakajGlas(dir);
    const linija = await readLine({ token }, dir);
    assert.equal(linija.open, true);
    assert.equal(linija.glas.pripravljen, false);
    assert.equal(linija.glas.vTeku, false);
    assert.equal(linija.glas.razlog, "glasNapaka");
    assert.match(t("glasNapaka"), /ni pripravljen/);
    const dnevnik = JSON.parse(await readFile(path.join(dir, "glas-dnevnik.json"), "utf8")) as Array<Record<string, unknown>>;
    assert.equal(dnevnik.length, 1);
    // G3: zapis ima se mesto (priprava/pozdrav/odgovor), se vedno brez vsebine.
    assert.deepEqual(Object.keys(dnevnik[0]).sort(), ["at", "kje", "razlog", "status", "vzrok"]);
    assert.equal(dnevnik[0].kje, "priprava");
    assert.equal(dnevnik[0].razlog, "glasNapaka");
    assert.equal(dnevnik[0].status, 503);
  });

  it("A5 brez prijave Google Cloud (drug ponudnik mozganov) glasu ni: razlog je v stanju, sinteze ni", async () => {
    const dir = await scratch();
    const token = await lastnik(dir);
    const stanje = (await readLine({ token }, dir)).glas;
    assert.equal(stanje.pripravljen, false);
    assert.equal(stanje.razlog, "glasNiVertex");
    await assert.rejects(pripraviZvok("Hvala.", dir), (error: unknown) => error instanceof NapakaGlasu && error.koda === "glasNiVertex");
    await assert.rejects(stat(mapaZvoka(dir)));
    await pripraviStalne(dir, ["Hvala."]);
    assert.equal(stanjeGlasu(dir).razlog, "glasNiVertex");
  });
});

describe("naloga G2 TwiML: Play, vmesni stavek, cakanje, rezerva", { concurrency: 1 }, () => {
  // Vsak preizkus svoj CallSid: zascita pred ponovitvijo bi isti podpisani zahtevi vrnila TwiML prejsnjega.
  let stevec = 0;
  let SID = "";
  beforeEach(() => {
    stevec += 1;
    SID = `CA-G2-KLIC-${stevec}`;
  });
  const OD = "+38640000000";

  it("B pozdrav je <Play> pripravljenih posnetkov z javnega naslova, brez <Say>; posnetki so berljivi z GET", async () => {
    const dir = await scratch();
    const glas = lazniGlas();
    await lastnik(dir);
    const pripravljenih = glas.klici.length;
    const twiml = await klic(dir, "/api/voice/incoming", { CallSid: SID, From: OD });
    assert.doesNotMatch(twiml, /<Say/);
    const naslovi = predvajani(twiml);
    assert.equal(naslovi.length, 1, "pozdrav je en posnetek (en glas)");
    for (const naslov of naslovi) {
      assert.match(naslov, /^https:\/\/lina\.primer\/api\/voice\/zvok\/[0-9a-f]{32}\.wav$/);
      const zvok = await handleZvokRequest(new Request(naslov), dir);
      assert.equal(zvok.status, 200);
    }
    assert.match(twiml, /<Gather [^>]*action="https:\/\/lina\.primer\/api\/voice\/turn\?obr=1"/);
    assert.equal(glas.klici.length, pripravljenih);

    // Korak imena odgovori s stalnim stavkom: brez modela in brez nove sinteze.
    const stevec = modelStevec();
    const ime = await klic(dir, "/api/voice/turn?obr=1", { CallSid: SID, From: OD, SpeechResult: "Ana Novak, nisem iz podjetja." }, { model: stevec.model });
    assert.doesNotMatch(ime, /<Say/);
    assert.equal(predvajani(ime).length, 1);
    assert.equal(stevec.stanje.klici, 0);
    assert.equal(glas.klici.length, pripravljenih);
    assert.match(ime, /turn\?obr=2"/);
  });

  it("B pocasen odgovor: vmesni stavek in Redirect s cak; zahteva cak ne poklice modela in ne zapise obrata znova", async () => {
    const dir = await scratch();
    // G3: namesto meje 350 ms (casovno obcutljivo) sinteza visi, dokler je preizkus ne spusti: odgovor webhooka
    // pred tem dokazuje, da ne caka nanjo.
    const glas = lazniGlas({ visi: /Izdelka Kavč/ });
    await lastnik(dir);
    const stevec = modelStevec();
    const moznosti = { model: stevec.model, cakajMs: 20, cakajNaprejMs: 3000 };
    // Prva obrata sta stalna stavka in cakata privzeto mejo; kratka meja velja samo za pocasni obrat.
    await klic(dir, "/api/voice/incoming", { CallSid: SID, From: OD }, { model: stevec.model });
    await klic(dir, "/api/voice/turn?obr=1", { CallSid: SID, From: OD, SpeechResult: "Ana Novak, nisem iz podjetja." }, { model: stevec.model });

    const vmes = await klic(dir, "/api/voice/turn?obr=2", { CallSid: SID, From: OD, SpeechResult: "Ali delate kavč?" }, moznosti);
    // Webhook je odgovoril, ceprav sinteza visi (cakamo na dogodek »sinteza se je zacela«, ne na cas).
    // G3c: odgovor ima dva kosa (prvi stavek in ostanek); prvi visi, drugi je takoj pripravljen.
    const zaceta = () => glas.klici.some((b) => /Izdelka Kavč/.test(b)) && glas.klici.some((b) => /Delamo: Alba/.test(b));
    for (let i = 0; i < 2_000 && !zaceta(); i += 1) await new Promise((resolve) => setTimeout(resolve, 2));
    assert.ok(zaceta());
    assert.ok(steviloSintezVTeku() >= 1);
    assert.doesNotMatch(vmes, /<Say|<Gather|<Hangup/);
    const sol = await solZvoka(dir);
    assert.deepEqual(predvajani(vmes), [`${IZVOR}/api/voice/zvok/${kljucZvoka(sol, t("trenutek"))}.wav`]);
    assert.match(vmes, /<Redirect method="POST">https:\/\/lina\.primer\/api\/voice\/turn\?obr=2&amp;cak=1<\/Redirect>/);

    const sintezPred = glas.klici.length;
    glas.spusti();
    const konec = await klic(dir, "/api/voice/turn?obr=2&cak=1", { CallSid: SID, From: OD }, moznosti);
    assert.doesNotMatch(konec, /<Say|Trenutek/);
    // G3 (eno vprasanje naenkrat): odgovor nima vec pripetih vprasanj, zato je posnetek en sam.
    assert.ok(predvajani(konec).length >= 1);
    assert.match(konec, /<Gather [^>]*action="https:\/\/lina\.primer\/api\/voice\/turn\?obr=3"/);
    // En klic modela in en zapis obrata, ceprav sta bili zahtevi dve.
    assert.equal(stevec.stanje.klici, 1);
    // Po odgovoru tece samo predpriprava stavkov povzetka (G4b); odgovor sam ni bil sintetiziran znova.
    await pocakajOzadjeKlicev();
    assert.ok(glas.klici.slice(sintezPred).every((b) => /^(Ime je|Poklicali vas bomo) /.test(b) || /^Naročate izdelek /.test(b)), glas.klici.slice(sintezPred).join(" | "));
    const knjiga = JSON.parse(await readFile(path.join(dir, "calls.json"), "utf8")) as Record<string, { obrat: number; transcript: Array<{ role: string }> }>;
    assert.equal(knjiga[SID].obrat, 3);
    assert.equal(knjiga[SID].transcript.filter((v) => v.role === "stranka").length, 2);
    assert.equal(knjiga[SID].transcript.filter((v) => v.role === "lina").length, 3);
    assert.equal(steviloOpravil(), 0);

    // Ponovitev iste zahteve cak (isti podpis) vrne isti TwiML in nicesar ne zapise.
    assert.equal(await klic(dir, "/api/voice/turn?obr=2&cak=1", { CallSid: SID, From: OD }, moznosti), konec);
    // Zahteva cak brez opravila (ponovni zagon programa): zapisani odgovor, brez modela in novega zapisa.
    const poZagonu = await klic(dir, "/api/voice/turn?obr=2&cak=2", { CallSid: SID, From: OD }, moznosti);
    assert.match(poZagonu, /turn\?obr=3"/);
    assert.equal(stevec.stanje.klici, 1);
    const potem = JSON.parse(await readFile(path.join(dir, "calls.json"), "utf8")) as Record<string, { obrat: number; transcript: unknown[] }>;
    assert.equal(potem[SID].obrat, 3);
    assert.equal(potem[SID].transcript.length, 5);
  });

  it("B podpis velja cez cel naslov s poizvedbo cak; napacen podpis je 403 in opravila ne dobi", async () => {
    const dir = await scratch();
    const glas = lazniGlas({ visi: /Naslov je/ });
    await lastnik(dir);
    const opravilPrej = steviloOpravil();
    const moznosti = { cakajMs: 5, cakajNaprejMs: 2000 };
    await klic(dir, "/api/voice/incoming", { CallSid: SID, From: OD });
    await klic(dir, "/api/voice/turn?obr=1", { CallSid: SID, From: OD, SpeechResult: "Sem Ana Novak." });
    const vmes = await klic(dir, "/api/voice/turn?obr=2", { CallSid: SID, From: OD, SpeechResult: "Kje ste?" }, moznosti);
    assert.match(vmes, /cak=1/);
    // Podpis prve zahteve (brez cak) ne velja za naslov s cak.
    const brezCak = createHmac("sha1", SKRIVNOST)
      .update(`${IZVOR}/api/voice/turn?obr=2CallSid${SID}From${OD}`)
      .digest("base64");
    const ponarejena = await handleVoiceRequest(
      podpisanaZahteva("/api/voice/turn?obr=2&cak=1", { CallSid: SID, From: OD }, brezCak),
      dir,
      undefined,
      moznosti,
    );
    assert.equal(ponarejena.status, 403);
    const brez = await handleVoiceRequest(podpisanaZahteva("/api/voice/turn?obr=2&cak=1", { CallSid: SID, From: OD }, ""), dir);
    assert.equal(brez.status, 403);
    assert.equal(steviloOpravil(), opravilPrej + 1);
    glas.spusti();
    const prava = await klic(dir, "/api/voice/turn?obr=2&cak=1", { CallSid: SID, From: OD }, moznosti);
    assert.match(prava, /<Play>/);
    assert.match(prava, /turn\?obr=3"/);
    assert.equal(steviloOpravil(), opravilPrej);
  });

  it("B viseca sinteza: vmesni stavki do trde meje, nato rezerva <Say>, klic ne obmolkne; v dnevniku je razlog brez vsebine pogovora", async () => {
    // G3 (S1) in G3c (lastnik: glas posrednika je nerazumljiv): na glas cakamo z vmesnimi stavki do trde meje obrata
    // (12 s), sele nato rezerva in odklopnik. Uro vodi preizkus.
    const dir = await scratch();
    const glas = lazniGlas({ visi: /Naslov je/ });
    try {
      await lastnik(dir);
      let zdaj = 1_800_000_000_000;
      const moznosti = { cakajMs: 5, cakajNaprejMs: 5, ura: () => zdaj };
      await klic(dir, "/api/voice/incoming", { CallSid: SID, From: OD });
      await klic(dir, "/api/voice/turn?obr=1", { CallSid: SID, From: OD, SpeechResult: "Sem Ana Novak." });
      const vmes = await klic(dir, "/api/voice/turn?obr=2", { CallSid: SID, From: OD, SpeechResult: "Kje ste?" }, moznosti);
      assert.match(vmes, /turn\?obr=2&amp;cak=1<\/Redirect>/);
      assert.doesNotMatch(vmes, /<Gather/);
      await pocakajZapisObrata(dir, SID, 3);
      zdaj += 12_001;
      const rezerva = await klic(dir, "/api/voice/turn?obr=2&cak=1", { CallSid: SID, From: OD }, moznosti);
      assert.match(rezerva, /<Say language="sl-SI">[^<]*Obrtna[^<]*<\/Say>/);
      assert.doesNotMatch(rezerva, /<Play>|cak=/);
      assert.match(rezerva, /<Gather [^>]*action="https:\/\/lina\.primer\/api\/voice\/turn\?obr=3"/);
      await pocakajDnevnikGlasu(dir);
      const dnevnik = await readFile(path.join(dir, "glas-dnevnik.json"), "utf8");
      assert.match(dnevnik, /glasPrepozen/);
      assert.doesNotMatch(dnevnik, /Obrtna|Naslov|Novak|38640000000|CA-G2/i);
      // Vrednost cak nad mejo ne podaljsa cakanja.
      const cez = await klic(dir, "/api/voice/turn?obr=2&cak=99", { CallSid: SID, From: OD }, moznosti);
      assert.doesNotMatch(cez, /cak=/);
    } finally {
      glas.spusti();
      await pocakajOpravila();
    }
  });

  it("B napaka sinteze in ponudnik brez glasu: takoj rezerva <Say> z odgovorom, razlog v dnevniku", async () => {
    const dir = await scratch();
    lazniGlas({ pade: /Naslov je/ });
    await lastnik(dir);
    await klic(dir, "/api/voice/incoming", { CallSid: SID, From: OD });
    await klic(dir, "/api/voice/turn?obr=1", { CallSid: SID, From: OD, SpeechResult: "Sem Ana Novak." });
    const rezerva = await klic(dir, "/api/voice/turn?obr=2", { CallSid: SID, From: OD, SpeechResult: "Kje ste?" });
    assert.match(rezerva, /<Say language="sl-SI">[^<]*Obrtna/);
    assert.doesNotMatch(rezerva, /<Play>/);
    assert.match(rezerva, /turn\?obr=3"/);
    await pocakajDnevnikGlasu(dir);
    assert.match(await readFile(path.join(dir, "glas-dnevnik.json"), "utf8"), /glasNapaka/);

    // Brez prijave Google Cloud glas ostane Twiliov Say, kot do zdaj.
    nastaviSintezoZaPreizkus(null);
    const drugi = await scratch();
    await lastnik(drugi);
    const pozdrav = await klic(drugi, "/api/voice/incoming", { CallSid: "CA-G2-SAY", From: OD });
    assert.match(pozdrav, /<Say language="sl-SI">Dober dan, tukaj Lina, pomočnica z umetno inteligenco/);
    assert.doesNotMatch(pozdrav, /<Play>/);
    await pocakajDnevnikGlasu(drugi);
    const dnevnik = await readFile(path.join(drugi, "glas-dnevnik.json"), "utf8");
    assert.match(dnevnik, /glasNiVertex/);
    assert.doesNotMatch(dnevnik, /Dober dan|38640000000/);
  });

  it("B zaprta linija in slovo: <Play> in Hangup brez Gather", async () => {
    const dir = await scratch();
    lazniGlas();
    const token = await lastnik(dir, false);
    const zaprta = await klic(dir, "/api/voice/incoming", { CallSid: "CA-G2-ZAPRTA", From: OD });
    assert.equal(predvajani(zaprta).length, 1);
    assert.match(zaprta, /<\/Play><Hangup\/>/);
    assert.doesNotMatch(zaprta, /<Say|<Gather/);

    await publishLine({ open: true, catalog: formaCatalog() }, { token }, dir);
    await pocakajGlas(dir);
    await klic(dir, "/api/voice/incoming", { CallSid: SID, From: OD });
    await klic(dir, "/api/voice/turn?obr=1", { CallSid: SID, From: OD, SpeechResult: "Sem Ana Novak." });
    const slovo = await klic(dir, "/api/voice/turn?obr=2", { CallSid: SID, From: OD, SpeechResult: "Hvala, nasvidenje." });
    assert.equal(predvajani(slovo).length, 2);
    assert.match(slovo, /<\/Play><Hangup\/>/);
    assert.doesNotMatch(slovo, /<Say|<Gather/);
  });
});

describe("naloga G2 hitrost mozganov", { concurrency: 1 }, () => {
  it("C1 minimalni razmislek samo za druzino Gemini 3 Flash", () => {
    for (const model of ["gemini-3-flash-preview", "gemini-3-flash", "Gemini-3-Flash-Preview", "gemini-3.1-flash-lite-preview"]) {
      assert.equal(podpiraMinimalniRazmislek(model), true, model);
    }
    for (const model of [
      "gemini-2.0-flash",
      "gemini-2.5-flash",
      "gemini-2.5-flash-tts",
      "gemini-3-pro-preview",
      "gemini-30-flash",
      "gemini-3-flashy",
      "x-gemini-3-flash",
      "gpt-4.1-mini",
      "claude-sonnet-4-5",
      "grok-4.5",
      "",
    ]) {
      assert.equal(podpiraMinimalniRazmislek(model), false, model);
    }
  });

  it("C1 zahteva za mozgane: thinkingConfig minimal pri gemini-3-flash, pri drugih polja ni", () => {
    const telo = (vhod: Parameters<typeof providerRequest>[0]) => JSON.parse(String(providerRequest(vhod).init.body)) as Record<string, unknown>;
    const vertex = providerRequest({ provider: "vertex", model: "gemini-3-flash-preview", key: "zeton-zeton", project: "moj-projekt", text: "Pozdrav" });
    assert.deepEqual((JSON.parse(String(vertex.init.body)) as { generationConfig?: unknown }).generationConfig, {
      thinkingConfig: { thinkingLevel: "minimal" },
    });
    assert.match(vertex.url, /^https:\/\/aiplatform\.googleapis\.com\/v1beta1\/projects\/moj-projekt\/locations\/global\//);
    assert.deepEqual(telo({ provider: "gemini", model: "gemini-3-flash-preview", key: "kljuc-kljuc", text: "Pozdrav" }).generationConfig, {
      thinkingConfig: { thinkingLevel: "minimal" },
    });
    const star = providerRequest({ provider: "vertex", model: "gemini-2.5-flash", key: "zeton-zeton", project: "moj-projekt", text: "Pozdrav" });
    assert.equal(String(star.init.body).includes("thinking"), false);
    assert.match(star.url, /googleapis\.com\/v1\/projects\//);
    for (const vhod of [
      { provider: "gemini" as const, model: "gemini-2.0-flash", key: "kljuc-kljuc", text: "Pozdrav" },
      { provider: "vertex" as const, model: "gemini-3-pro-preview", key: "zeton-zeton", project: "moj-projekt", text: "Pozdrav" },
      { provider: "openai" as const, model: "gpt-4.1-mini", key: "kljuc-kljuc", text: "Pozdrav" },
      { provider: "claude" as const, model: "claude-sonnet-4-5", key: "kljuc-kljuc", text: "Pozdrav" },
      { provider: "grok" as const, model: "grok-4.5", key: "kljuc-kljuc", text: "Pozdrav" },
    ]) {
      assert.equal(JSON.stringify(telo(vhod)).includes("thinking"), false, vhod.model);
    }
  });

  it("C2 zeton prijave se ne osvezuje ob vsakem klicu: velja do izteka, samo v pomnilniku", async () => {
    let pridobitev = 0;
    const zdaj = 1_800_000_000_000;
    const pridobi = async () => {
      pridobitev += 1;
      return { token: `zeton-${pridobitev}`, pretece: zdaj + 3_600_000 };
    };
    assert.equal(await vertexAccessToken(pridobi, zdaj), "zeton-1");
    assert.equal(await vertexAccessToken(pridobi, zdaj + 60_000), "zeton-1");
    assert.equal(await vertexAccessToken(pridobi, zdaj + 3_400_000), "zeton-1");
    assert.equal(pridobitev, 1);
    // Dve minuti pred iztekom ga pridobimo znova.
    assert.equal(await vertexAccessToken(pridobi, zdaj + 3_500_000), "zeton-2");
    pozabiZeton();
    assert.equal(await vertexAccessToken(pridobi, zdaj + 3_500_001), "zeton-3");
    // Brez znanega izteka zetona ne hranimo.
    pozabiZeton();
    const brezIzteka = async () => {
      pridobitev += 1;
      return { token: `zeton-${pridobitev}`, pretece: null };
    };
    assert.equal(await vertexAccessToken(brezIzteka, zdaj), "zeton-4");
    assert.equal(await vertexAccessToken(brezIzteka, zdaj), "zeton-5");
  });

  it("C3 koraki poteka klica odgovorijo brez modela: ime, rok, telefon, e-posta, povratni klic, slovo", async () => {
    // G3 (eno vprasanje naenkrat): koraki so isti, a vsak obrat vprasa eno stvar in klic se po zadnjem odgovoru
    // zakljuci s slovesom. Prej je bil odgovor na vsak podatek »Hvala, zapisala sem.« in klic je cakal na slovo.
    const dir = await scratch();
    await lastnik(dir);
    const stevec = modelStevec();
    const sid = "CA-G2-BREZ";
    const obrat = (text: string) => recordCaller({ callSid: sid, from: "anonymous", text }, dir, stevec.model);
    await obrat("");
    const ime = await obrat("Ana Novak, nisem iz podjetja.");
    assert.equal(ime.reply, t("kakoPomagam"));
    assert.equal(stevec.stanje.klici, 0);
    // G4a: model samo za vprasanja klicatelja; navedba izdelka je stalni stavek in vprasanje po roku.
    await obrat("Mizo Alba iz hrasta, 2 kosa.");
    assert.equal(stevec.stanje.klici, 0);
    // G4c: brez »Hvala.« po vsakem podatku (lastnik 11. 11. 2026): samo naslednje vprasanje; zahvala je samo na koncu klica.
    const rok = await obrat("Do 15. decembra.");
    assert.equal(rok.reply, t("prosiTelefon"));
    // G4g: e-poste in povratnega klica Lina ne sprasuje; klicatelj ju lahko pove sam (ostaneta v zapisu).
    const povzetek = await obrat("Telefon 041 222 333, moja e-posta je ana@primer.si, pokličite dopoldne.");
    assert.equal(povzetek.call.status, "v-teku");
    assert.match(povzetek.reply, new RegExp(`${t("potrditevVprasanje").replace("?", "\\?")}$`));
    const slovo = await obrat("Da.");
    assert.equal(slovo.call.status, "zakljucen");
    assert.equal(slovo.reply, `${t("slovo")} ${t("lepDan")}`);
    assert.equal(stevec.stanje.klici, 0);
    assert.equal(slovo.call.order.deadline, "15. decembra");
    assert.match(slovo.call.order.phone, /041/);
    assert.equal(slovo.call.order.email, "ana@primer.si");
    assert.match(slovo.call.order.dosegljiv ?? "", /dopoldne/i);

    // Podatki, povedani skupaj, se preskocijo; slovo sredi zbiranja zakljuci brez novega vprasanja in brez modela.
    const drugi = "CA-G2-BREZ2";
    const obrat2 = (text: string) => recordCaller({ callSid: drugi, from: "anonymous", text }, dir, stevec.model);
    await obrat2("");
    await obrat2("Ana Novak.");
    await obrat2("Mizo Alba iz hrasta, 2 kosa.");
    const pred = stevec.stanje.klici;
    const skupaj = await obrat2("041 222 333, ana@primer.si");
    // Rok je Lina vprasala ze ob navedbi izdelka (caka je na rok): telefon in e-posta se zapisata, vse je znano -> povzetek.
    assert.match(skupaj.reply, /Ponovim, kar sem razumela/);
    const konec = await obrat2("To je vse, hvala.");
    assert.equal(konec.call.status, "zakljucen");
    assert.match(konec.reply, /dodatne informacije, vas bomo poklicali\./i);
    assert.match(konec.reply, new RegExp(`${t("slovo")} ${t("lepDan")}$`));
    assert.equal(stevec.stanje.klici, pred);
  });

  it("C3 webhook ne caka na pocasen model: obrat tece mimo zahteve", async () => {
    // G3: namesto meje 350 ms (casovno obcutljivo) model visi, dokler ga preizkus ne spusti.
    const dir = await scratch();
    lazniGlas();
    await lastnik(dir);
    let klici = 0;
    let spusti: () => void = () => undefined;
    const zapora = new Promise<void>((resolve) => {
      spusti = resolve;
    });
    const pocasenModel = async (facts: string) => {
      klici += 1;
      await zapora;
      return facts;
    };
    const moznosti = { model: pocasenModel, cakajMs: 20, cakajNaprejMs: 3000 };
    const sid = "CA-G2-ASINH";
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: "anonymous" });
    await klic(dir, "/api/voice/turn?obr=1", { CallSid: sid, From: "anonymous", SpeechResult: "Sem Ana Novak." });
    const vmes = await klic(dir, "/api/voice/turn?obr=2", { CallSid: sid, From: "anonymous", SpeechResult: "Ali delate mizo Alba iz hrasta?" }, moznosti);
    // Webhook je odgovoril, ceprav model visi (cakamo na dogodek »model je klican«, ne na cas).
    for (let i = 0; i < 2_000 && klici === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 2));
    assert.equal(klici, 1);
    assert.match(vmes, /<Play>[^<]+<\/Play><Redirect method="POST">[^<]*turn\?obr=2&amp;cak=1<\/Redirect>/);
    spusti();
    const konec = await klic(dir, "/api/voice/turn?obr=2&cak=1", { CallSid: sid, From: "anonymous" }, moznosti);
    assert.match(konec, /turn\?obr=3"/);
    assert.equal(klici, 1);
  });

});

describe("naloga G2 potek klica: najdbe pregleda na realnih stavkih", { concurrency: 1 }, () => {
  const OD = "+38640000000";

  it("D1 »Ana Novak, nisem iz podjetja.« je ime; sledi »Kako vam lahko pomagam?« in ime ni v prepisu", async () => {
    const dir = await scratch();
    await lastnik(dir);
    const stevec = modelStevec();
    await recordCaller({ callSid: "CA-D1", from: "anonymous", text: "" }, dir, stevec.model);
    const ime = await recordCaller({ callSid: "CA-D1", text: "Ana Novak, nisem iz podjetja." }, dir, stevec.model);
    assert.equal(ime.call.order.customerName, "Ana Novak");
    assert.equal(ime.call.order.podjetjeKlicatelja, "");
    assert.match(ime.reply, /kako vam lahko pomagam/i);
    assert.doesNotMatch(ime.reply, /Povejte izdelek/);
    assert.equal(stevec.stanje.klici, 0);
    const prepis = ime.call.transcript.map((v) => v.text).join("\n");
    assert.equal(prepis.includes("Novak"), false);

    // »Da« ni ime; ime je za vejico.
    await recordCaller({ callSid: "CA-D1B", from: "anonymous", text: "" }, dir);
    const da = await recordCaller({ callSid: "CA-D1B", text: "Da, Ana Novak." }, dir);
    assert.equal(da.call.order.customerName, "Ana Novak");
    assert.match(da.reply, /kako vam lahko pomagam/i);

    // Brez imena gremo naprej (ime vprasamo najvec enkrat), povprasevanje pa ni ime.
    await recordCaller({ callSid: "CA-D1C", from: "anonymous", text: "" }, dir);
    const brez = await recordCaller({ callSid: "CA-D1C", text: "Dober dan." }, dir);
    // G3 (N8): ime je bilo vprasano v pozdravu in ga Lina ne vprasa znova; brez odgovora je v zapisu »ni podatka«.
    assert.equal(brez.call.order.customerName, t("niPodatka"));
    assert.equal(brez.reply, t("kakoPomagam"));
    await recordCaller({ callSid: "CA-D1D", from: "anonymous", text: "" }, dir);
    const miza = await recordCaller({ callSid: "CA-D1D", text: "Mizo Alba iz hrasta, dva kosa." }, dir);
    assert.equal(miza.call.order.customerName, t("niPodatka"));
    assert.equal(miza.call.order.productName, "Alba");
    assert.doesNotMatch(miza.reply, /ime in priimek/);
  });

  it("D1 razclenjevalnik imena: tabela realnih odgovorov", () => {
    const katalog = ["Alba", "miza", "Hrast", "Oreh"];
    const tabela: Array<[string, string | null]> = [
      ["Ana Novak, nisem iz podjetja.", "Ana Novak"],
      ["Da, Ana Novak.", "Ana Novak"],
      ["Ja, tukaj Ana Novak.", "Ana Novak"],
      ["Tukaj Ana Novak.", "Ana Novak"],
      ["Dober dan, Ana Novak pri telefonu.", "Ana Novak"],
      ["Kličem v imenu podjetja Lesnina, Ana Novak.", "Ana Novak"],
      ["Sem Ana Novak.", "Ana Novak"],
      ["Mizo Alba iz hrasta, dva kosa.", null],
      ["Dober dan, zanima me miza.", null],
      ["Da.", null],
      ["Ne vem.", null],
      ["Do petka.", null],
      ["Sem iz Nove Gorice.", null],
    ];
    for (const [stavek, ime] of tabela) assert.equal(razberiIme(stavek, true, katalog), ime, stavek);
    // Brez vprasanja golo ime se vedno ne steje.
    assert.equal(razberiIme("Ana Novak, nisem iz podjetja.", false), null);
    assert.equal(dopolniStik(prazenStik(), "Da, Ana Novak.", "", { vprasan: true }).ime, "Ana Novak");
  });

  it("D2 rok brez besede »rok« se zapise in Lina po njem ne vprasa znova", async () => {
    const dir = await scratch();
    await lastnik(dir);
    for (const [sid, odgovor, rok] of [
      ["CA-D2A", "Do 15. decembra.", "15. decembra"],
      ["CA-D2B", "Do petka.", "petka"],
    ] as const) {
      await recordCaller({ callSid: sid, from: "anonymous", text: "" }, dir);
      await recordCaller({ callSid: sid, text: "Ana Novak." }, dir);
      // G4a: navedba izdelka takoj vprasa rok (potrditev je na koncu klica).
      const vprasanja = await recordCaller({ callSid: sid, text: "Mizo Alba iz hrasta, 2 kosa." }, dir);
      assert.match(vprasanja.reply, /do kdaj/i);
      const zapisano = await recordCaller({ callSid: sid, text: odgovor }, dir);
      assert.equal(zapisano.call.order.deadline, rok);
      assert.doesNotMatch(zapisano.reply, /do kdaj/i);
      const naprej = await recordCaller({ callSid: sid, text: "Telefon 041 222 333." }, dir);
      assert.doesNotMatch(naprej.reply, /do kdaj/i);
      assert.equal(naprej.call.order.deadline, rok);
      assert.match(naprej.call.povzetek?.zelel ?? povzetekZelel(naprej.call), new RegExp(rok));
    }
    function povzetekZelel(call: { order: { deadline?: string | null } }): string {
      return `rok ${call.order.deadline}`;
    }
    const tabela: Array<[string, string | null]> = [
      ["Do 15. decembra.", "15. decembra"],
      ["Do petka.", "petka"],
      ["Do 15. 12.", "15. 12."],
      ["V dveh tednih.", "V dveh tednih"],
      ["Čim prej.", "Čim prej"],
      ["Do konca meseca.", "konca meseca"],
      ["Telefon 041 222 333.", null],
      ["Pokličite dopoldne.", null],
      ["Dosegljiv sem do 15. ure.", null],
      ["Do petih.", null],
      ["Do kdaj delate?", null],
      ["Ne vem.", null],
    ];
    for (const [stavek, rok] of tabela) assert.equal(razberiRokOdgovora(stavek), rok, stavek);
    // Brez vprasanja po roku se »do …« ne zapise kot rok.
    assert.equal(absorbUtterance(emptyDraft(), "Do 15. decembra.", formaCatalog()).deadline, null);
    assert.equal(absorbUtterance(emptyDraft(), "Do 15. decembra.", formaCatalog(), { rokVprasan: true }).deadline, "15. decembra");
  });

  it("D3 »Ne vem.« in »Nimam.« ne povzrocita zanke: vsako vprasanje najvec enkrat, nato slovo", async () => {
    // G3 (eno vprasanje naenkrat): vprasanja pridejo posamezno; po zadnjem se klic zakljuci s slovesom (prej je
    // ostal »v-teku«). Pravilo »najvec enkrat« in »ni dan« za e-posto ostaneta.
    const dir = await scratch();
    await lastnik(dir);
    // G4g: vprasanji po e-posti in povratnem klicu odpadeta; ostaneta rok, ime (ce ga ni) in telefon.
    const vprasanja = [/do kdaj/i, /ime in priimek/i, /telefonsk/i, /elektronsk/i, /pokli[cč]emo nazaj/i];
    for (const [sid, odgovori] of [
      ["CA-D3A", ["Do petka.", "Telefon 041 222 333."]],
      ["CA-D3B", ["Ne vem.", "Telefon 041 222 333."]],
      ["CA-D3C", ["Ne vem.", "Ne vem."]],
      ["CA-D3E", ["Hm.", "Telefon 041 222 333."]],
    ] as const) {
      await recordCaller({ callSid: sid, from: "anonymous", text: "" }, dir);
      await recordCaller({ callSid: sid, text: "Sem Ana Novak." }, dir);
      let zadnji = await recordCaller({ callSid: sid, text: "Mizo Alba iz hrasta, 2 kosa." }, dir);
      for (const odgovor of odgovori) {
        assert.equal(zadnji.call.status, "v-teku", sid);
        // Najvec eno vprasanje na obrat.
        assert.ok(vprasanja.filter((vzorec) => vzorec.test(zadnji.reply)).length <= 1, `${sid}: ${zadnji.reply}`);
        zadnji = await recordCaller({ callSid: sid, text: odgovor }, dir);
      }
      const lina = zadnji.call.transcript.filter((v) => v.role === "lina").map((v) => v.text);
      for (const vzorec of vprasanja) {
        const kolikokrat = lina.filter((stavek) => vzorec.test(stavek)).length;
        assert.ok(kolikokrat <= 1, `${sid}: ${vzorec} vprasano ${kolikokrat}-krat`);
      }
      assert.equal(zadnji.call.stik?.konec, true, sid);
      assert.equal(zadnji.call.order.email, t("niDan"), sid);
      // G4a: po zadnjem podatku povzetek in vprasanje; »Da.« zakljuci.
      assert.equal(zadnji.call.status, "v-teku", sid);
      assert.match(zadnji.reply, /Ali potrjujete naročilo\?/, sid);
      zadnji = await recordCaller({ callSid: sid, text: "Da." }, dir);
      assert.equal(zadnji.call.status, "zakljucen", sid);
      assert.match(zadnji.reply, /lep dan/i);
    }
  });

  it("D3 klicatelj odgovarja po delih: Lina zapise vse, vprasa eno stvar naenkrat in nicesar dvakrat", async () => {
    // G3 (eno vprasanje naenkrat): prej je en obrat vprasal rok, telefon, e-posto in povratni klic skupaj.
    const dir = await scratch();
    await lastnik(dir);
    const sid = "CA-D3D";
    await recordCaller({ callSid: sid, from: "anonymous", text: "" }, dir);
    await recordCaller({ callSid: sid, text: "Ana Novak, nisem iz podjetja." }, dir);
    const prvi = await recordCaller({ callSid: sid, text: "Mizo Alba iz hrasta, 2 kosa." }, dir);
    assert.match(prvi.reply, /do kdaj/i);
    assert.doesNotMatch(prvi.reply, /telefonsk|elektronsk|pokli[cč]emo|ime in priimek/i);
    const delni = await recordCaller({ callSid: sid, text: "Do petka." }, dir);
    assert.match(delni.reply, /telefonsk/i);
    assert.equal((delni.reply.match(/\?/g) ?? []).length <= 1, true, delni.reply);
    assert.doesNotMatch(delni.reply, /ime in priimek|elektronsk|pokli[cč]emo nazaj/i);
    assert.equal(delni.call.status, "v-teku");
    // Klicatelj sam pove se e-posto in da je cas povratnega klica nepomemben: ostane v zapisu, Lina ne vprasa.
    const povzetek = await recordCaller({ callSid: sid, text: "Telefon 041 222 333, ana afna primer pika si, cas ni pomemben." }, dir);
    assert.match(povzetek.reply, /Ali potrjujete naročilo\?/);
    assert.equal(povzetek.call.status, "v-teku");
    const zadnji = await recordCaller({ callSid: sid, text: "Da." }, dir);
    assert.match(zadnji.reply, /dodatne informacije, vas bomo poklicali\./i);
    assert.equal(zadnji.call.status, "zakljucen");
    assert.equal(zadnji.call.order.deadline, "petka");
    assert.match(zadnji.call.order.phone, /041/);
    assert.equal(zadnji.call.order.email, "ana@primer.si");
    // »Cas ni pomemben« ob drugem odgovoru ni odgovor na vprasanje o povratnem klicu (tega ni vec): zapis ostane prazen.
    assert.equal(zadnji.call.order.dosegljiv ?? "", "");
    assert.equal(zadnji.call.order.customerName, "Ana Novak");
  });

  it("D4 lastnikov »Kako vam lahko pomagamo?« ne prehiti vprasanja po imenu", async () => {
    assert.equal(dodatekLastnika("Pozdravljeni pri Formi. Kako vam lahko pomagamo?"), "Pozdravljeni pri Formi.");
    assert.equal(dodatekLastnika("Kako vam smem pomagati? Lep pozdrav iz hiše."), "Lep pozdrav iz hiše.");
    assert.equal(dodatekLastnika("S čim vam lahko pomagam danes"), "");
    assert.equal(dodatekLastnika("Tukaj pomočnica mizarja. Vesel pozdrav."), "Tukaj pomočnica mizarja. Vesel pozdrav.");
    const dir = await scratch();
    const token = await lastnik(dir);
    await savePravila({ pozdrav: "Pozdravljeni pri Formi. Kako vam lahko pomagamo?", prevzem: "vsi" }, token, dir);
    const pozdrav = await recordCaller({ callSid: "CA-D4", from: "anonymous", text: "" }, dir);
    const prvi = pozdrav.reply.split(/(?<=[.!?])\s/)[0] ?? "";
    assert.match(prvi, /umetno inteligenco/);
    assert.match(pozdrav.reply, /Pozdravljeni pri Formi\./);
    assert.doesNotMatch(pozdrav.reply, /pomaga/i);
    assert.match(pozdrav.reply, /ime in priimek/);
    const ime = await recordCaller({ callSid: "CA-D4", text: "Ana Novak." }, dir);
    assert.match(ime.reply, /Kako vam lahko pomagam\?/);
    // Isti vrstni red po telefonu: razkritje in pozdrav, ime, sele nato pomoc.
    const twiml = await klic(dir, "/api/voice/incoming", { CallSid: "CA-D4-TEL", From: "anonymous" });
    assert.doesNotMatch(twiml, /pomaga/i);
    assert.match(twiml, /ime in priimek/);
  });
});
