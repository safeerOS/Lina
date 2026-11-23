/**
 * Naloga G3. Popravki po varnostnem pregledu glasu (V1, V2, S1-S6, N1-N9), eno vprasanje naenkrat, potrditev po
 * e-posti, vaja klica, priprava snemanja, merjenje casa obrata in meritve vodje s pravim Googlom (10. 11. 2026).
 * Nikjer pravega omrezja: sinteza je lazni izvajalec ali vbrizgan fetch, model je stevec, ura je vbrizgana.
 * Imena in stevilke so izmisljeni (Ana Primer, +38640000000). Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { nastaviPridobitevZaPreizkus, pozabiZeton, vertexAccessToken, zetonJeShranjen } from "./adc.server.ts";
import { LinaAuthError, loginOwner, logoutOwner, setupOwner } from "./auth.server.ts";
import { t } from "./besedila.ts";
import { razberiRokOdgovora, wantsHangup } from "./brain.ts";
import { formaCatalog } from "./catalog.ts";
import { izgovoriEnaslov, jeVeljavenEnaslov, stavekPotrditve } from "./eposta.ts";
import { kljucZvoka, stalniStavki } from "./glas.ts";
import {
  glasPripravljenZa,
  handleZvokRequest,
  mapaZvoka,
  NapakaGlasu,
  nastaviSintezoZaPreizkus,
  nastaviUroGlasuZaPreizkus,
  odklopnikOdprt,
  ODKLOP_MS,
  pobrisiNestalneSinhrono,
  pocakajDnevnikGlasu,
  pocakajGlas,
  pocistiZvok,
  ponastaviOdklopnik,
  ponastaviOmejitevZvoka,
  preberiAliUstvariSol,
  pripraviStalne,
  pripraviZvok,
  sintetizirajVertex,
  SOCASNIH_PRIPRAV,
  solZvoka,
  stanjeGlasu,
  STAROST_NESTALNIH_MS,
  steviloKlicevZZvokom,
  steviloSintezVTeku,
  ustaviCiscenjeZvoka,
  zazeniCiscenjeZvoka,
  ZAMIKI_PRIPRAVE_MS,
  zvokZaBesedilo,
  ZVOK_NAJVEC_ZAHTEV,
  ZVOK_OKNO_MS,
} from "./glas.server.ts";
import { checkBrain, saveBrain } from "./keys.server.ts";
import { nastaviOgrevanjeZaPreizkus } from "./ogrevanje-klica.server.ts";
import { loadPravila, savePravila } from "./pravila.server.ts";
import { callProvider } from "./providers.ts";
import { listCalls, publishLine, readLine, recordCaller, steviloVaj, vajaKlica } from "./service.server.ts";
import { goloPodjetje, razberiIme, telefonIzBesed, vrstaImena } from "./stik.ts";
import {
  handleVoiceGet,
  handleVoiceRequest,
  NAJVEC_CAKANJ,
  pocakajOzadjeKlicev,
  pocistiOpravila,
  steviloNapakKlicev,
  steviloOpravil,
  TRDA_MEJA_OBRATA_MS,
  ustaviCiscenjeOpravil,
  type MoznostiKlica,
} from "./voice.server.ts";

process.env.LINA_LLM = "0";
// Razred C (23. 11. 2026): ogrevanje ob zacetku klica (odlocitev vodje 12. 11. 2026, ogrevanje-klica.server.ts) vklopi
// tople povezave za ves proces; nato gredo klici Vertex mimo laznega fetch na pravi streznik (401 v S3). Preizkusi
// tega dela ne merijo ogrevanja in ne smejo v omrezje.
nastaviOgrevanjeZaPreizkus(async () => undefined);

// Vse mape preizkusov v eni zacasni mapi, ki jo pobrisemo ob izhodu: tudi padel tek ne pusti ostankov v /tmp.
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-g3-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const temps: string[] = [];
const zapore: Array<() => void> = [];
const praviFetch = globalThis.fetch;

async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  temps.push(dir);
  return dir;
}

async function pocakajOpravila(): Promise<void> {
  for (let i = 0; i < 300 && (steviloOpravil() > 0 || steviloSintezVTeku() > 0); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

afterEach(async () => {
  for (const spusti of zapore.splice(0)) spusti();
  await pocakajOzadjeKlicev();
  delete process.env.TWILIO_AUTH_TOKEN;
  globalThis.fetch = praviFetch;
  nastaviSintezoZaPreizkus(null);
  nastaviUroGlasuZaPreizkus(null);
  nastaviPridobitevZaPreizkus(null);
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
const OD = "+38640000000";

function podpisanaZahteva(pot: string, params: Record<string, string>): Request {
  process.env.TWILIO_AUTH_TOKEN = SKRIVNOST;
  const signed = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], `${IZVOR}${pot}`);
  const good = createHmac("sha1", SKRIVNOST).update(signed).digest("base64");
  return new Request(`${IZVOR}${pot}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": good },
    body: new URLSearchParams(params).toString(),
  });
}

async function klic(dir: string, pot: string, params: Record<string, string>, moznosti: MoznostiKlica = {}): Promise<string> {
  const odgovor = await handleVoiceRequest(podpisanaZahteva(pot, params), dir, undefined, moznosti);
  assert.equal(odgovor.status, 200, pot);
  return odgovor.text();
}

type LazniGlas = { klici: string[]; hkrati: number; najvecHkrati: number; spusti: () => void };

/** Lazni izvajalec sinteze: steje klice in socasnost, lahko visi ali pade za izbrano besedilo. */
function lazniGlas(moznosti: { pade?: RegExp; status?: number; visi?: RegExp; padeKrat?: number; zberi?: number } = {}): LazniGlas {
  const stanje: LazniGlas = { klici: [], hkrati: 0, najvecHkrati: 0, spusti: () => undefined };
  const zapora = new Promise<void>((resolve) => {
    stanje.spusti = resolve;
  });
  zapore.push(() => stanje.spusti());
  const padci = new Map<string, number>();
  nastaviSintezoZaPreizkus(async (besedilo) => {
    stanje.klici.push(besedilo);
    stanje.hkrati += 1;
    stanje.najvecHkrati = Math.max(stanje.najvecHkrati, stanje.hkrati);
    try {
      // Vsaka sinteza pocaka en krog dogodkov, da se socasnost sploh lahko pokaze.
      await new Promise((resolve) => setImmediate(resolve));
      // zberi: sinteza drzi, dokler jih ne tece toliko hkrati (ali do kratkega roka) - socasnost je tako vidna
      // ne glede na hitrost diska, prevec socasnih pa zanesljivo ujetih.
      for (let i = 0; moznosti.zberi && stanje.hkrati < moznosti.zberi && i < 40; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      if (moznosti.pade?.test(besedilo)) {
        const doslej = padci.get(besedilo) ?? 0;
        padci.set(besedilo, doslej + 1);
        if (doslej < (moznosti.padeKrat ?? Number.POSITIVE_INFINITY)) throw new NapakaGlasu(moznosti.status === 429 ? "glasOmejitev" : "glasNapaka", moznosti.status ?? 503);
      }
      if (moznosti.visi?.test(besedilo)) await zapora;
      const pcm = Buffer.alloc(4800);
      for (let i = 0; i < 2400; i += 1) pcm.writeInt16LE(Math.round(8000 * Math.sin(i / 8)), i * 2);
      return pcm;
    } finally {
      stanje.hkrati -= 1;
    }
  });
  return stanje;
}

/** Lastnik z odprto linijo. Z laznim glasom se linija odpre, ko je glas pripravljen; brez glasu z izrecno potrditvijo. */
async function lastnik(dir: string, moznosti: { brezGlasu?: boolean } = {}): Promise<string> {
  const token = await setupOwner("geslo-test-1234", dir);
  await publishLine({ open: true, catalog: formaCatalog(), ...(moznosti.brezGlasu ? { brezGlasu: true } : {}) }, { token }, dir);
  await pocakajGlas(dir);
  if (!(await readLine({ token }, dir)).open) await publishLine({ open: true, brezGlasu: true }, { token }, dir);
  await pocakajGlas(dir);
  await pocakajOpravila();
  return token;
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

function zapornaModel() {
  const stanje = { klici: 0, spusti: () => undefined as void };
  const zapora = new Promise<void>((resolve) => {
    stanje.spusti = resolve;
  });
  zapore.push(() => stanje.spusti());
  return {
    stanje,
    model: async (facts: string) => {
      stanje.klici += 1;
      await zapora;
      return facts;
    },
  };
}

function predvajani(twiml: string): string[] {
  return [...twiml.matchAll(/<Play>([^<]+)<\/Play>/g)].map((m) => m[1]);
}

function prviStavek(besedilo: string): string {
  return besedilo.split(/(?<=[.!?])\s/)[0] ?? "";
}

async function dnevnikGlasu(dir: string): Promise<Array<{ razlog: string; kje?: string; status?: number }>> {
  await pocakajDnevnikGlasu(dir);
  return JSON.parse(await readFile(path.join(dir, "glas-dnevnik.json"), "utf8").catch(() => "[]")) as Array<{ razlog: string; kje?: string; status?: number }>;
}

let stevecKlicev = 0;
function novSid(): string {
  stevecKlicev += 1;
  return `CA-G3-${stevecKlicev}`;
}

describe("naloga G3 V1: razkritje UI je vedno prvi stavek", { concurrency: 1 }, () => {
  it("V1 hladen prvi klic: pozdrav takoj v rezervi <Say>, brez vmesnega stavka; sinteza tece v ozadju za naslednjic", async () => {
    const dir = await scratch();
    // Vsaka sinteza visi: predpomnilnik je hladen, kot po prvem zagonu ali menjavi pozdrava.
    const glas = lazniGlas({ visi: /./ });
    const token = await setupOwner("geslo-test-1234", dir);
    await publishLine({ open: true, brezGlasu: true, catalog: formaCatalog() }, { token }, dir);
    const sid = novSid();
    const twiml = await klic(dir, "/api/voice/incoming", { CallSid: sid, From: OD }, { cakajMs: 5, cakajNaprejMs: 5 });
    assert.doesNotMatch(twiml, /Trenutek|cak=|<Redirect method="POST">[^<]*cak/);
    assert.doesNotMatch(twiml, /<Play>/);
    // Razred A (23. 11. 2026): govor je znotraj <Gather> (lastnik 14. 11. 2026, voice.server.ts zZbiranjem: prekinitev govora);
    // pred razkritjem se vedno ne sme predvajati nic drugega.
    const govor = /^<\?xml[^>]*\?><Response>(?:<Gather [^>]*>)?<Say language="sl-SI">([^<]+)<\/Say>/.exec(twiml);
    assert.ok(govor, twiml);
    assert.match(prviStavek(govor[1]), /umetno inteligenco/);
    assert.match(twiml, /<Gather [^>]*action="https:\/\/lina\.primer\/api\/voice\/turn\?obr=1"/);
    const zapisi = await dnevnikGlasu(dir);
    assert.ok(zapisi.some((zapis) => zapis.kje === "pozdrav" && zapis.razlog === "glasPrepozen"));

    // Ko je sinteza koncana, naslednji klic pozdrav predvaja z Lininim glasom.
    glas.spusti();
    await pocakajOzadjeKlicev();
    await pocakajGlas(dir);
    const drugi = await klic(dir, "/api/voice/incoming", { CallSid: novSid(), From: OD });
    assert.doesNotMatch(drugi, /<Say|Trenutek/);
    // Razred A (23. 11. 2026): pozdrav je ENA sinteza in en posnetek (lastnik 14. 11. 2026, glas.ts stalniStavki); prej trije deli.
    assert.equal(predvajani(drugi).length, 1);
  });

  it("V1 /turn z neznanim CallSid in pocasnim modelom: pred razkritjem ni vmesnega stavka", async () => {
    const dir = await scratch();
    lazniGlas();
    await lastnik(dir);
    const pocasen = zapornaModel();
    const sid = novSid();
    const cakajoc = klic(
      dir,
      "/api/voice/turn?obr=3",
      { CallSid: sid, From: OD, SpeechResult: "Ali delate mize po meri?" },
      { model: pocasen.model, cakajMs: 5, cakajNaprejMs: 5, cakajBrezGlasuMs: 2_000 },
    );
    pocasen.stanje.spusti();
    const twiml = await cakajoc;
    assert.doesNotMatch(twiml, /Trenutek|cak=/);
    const besedilo = (twiml.match(/<Say language="sl-SI">([^<]+)<\/Say>/)?.[1] ?? "") || "";
    // Prvi Linin stavek v klicu je razkritje, v posnetku ali v rezervi.
    if (besedilo) assert.match(prviStavek(besedilo), /umetno inteligenco/);
    else assert.ok(predvajani(twiml).length >= 1);
    const zapis = (await listCallsBrezSeje(dir))[sid];
    assert.match(prviStavek(zapis.transcript.find((v) => v.role === "lina")?.text ?? ""), /umetno inteligenco/);
  });

  it("V1 linija se odpre sele s pripravljenim glasom ali z izrecno potrditvijo »odpri brez glasu«; stanje pove razlog", async () => {
    const dir = await scratch();
    const token = await setupOwner("geslo-test-1234", dir);
    // Brez prijave Google Cloud glasu ni: zahteva za odprtje linije ne odpre.
    const zahteva = await publishLine({ open: true, catalog: formaCatalog() }, { token }, dir);
    assert.equal(zahteva.open, false);
    await pocakajGlas(dir);
    const caka = await readLine({ token }, dir);
    assert.equal(caka.open, false);
    assert.deepEqual(caka.odprtje, { stanje: "cakaGlas", razlog: "glasNiVertex" });
    const zaprta = await klic(dir, "/api/voice/incoming", { CallSid: novSid(), From: OD });
    assert.match(zaprta, /Linija trenutno ni odprta/);
    assert.match(zaprta, /<Hangup\/>/);
    // brezGlasu brez open ni potrditev odprtja.
    const samo = await publishLine({ brezGlasu: true }, { token }, dir);
    assert.equal(samo.open, false);
    const brez = await publishLine({ open: true, brezGlasu: true }, { token }, dir);
    assert.equal(brez.open, true);
    assert.equal(brez.odprtje.stanje, "odprtaBrezGlasu");
    assert.equal((await readLine({ token }, dir)).odprtje.razlog, "glasNiVertex");

    // Z glasom: linija caka na pripravo in se nato odpre sama, brez potrditve.
    const drugi = await scratch();
    const glas = lazniGlas({ visi: /Kako vam lahko pomagam/ });
    const zeton = await setupOwner("geslo-test-1234", drugi);
    const objava = await publishLine({ open: true, catalog: formaCatalog() }, { token: zeton }, drugi);
    assert.equal(objava.open, false);
    assert.equal(objava.odprtje.stanje, "cakaGlas");
    assert.equal((await readLine({ token: zeton }, drugi)).open, false);
    glas.spusti();
    await pocakajGlas(drugi);
    const odprta = await readLine({ token: zeton }, drugi);
    assert.equal(odprta.open, true);
    assert.deepEqual(odprta.odprtje, { stanje: "odprta", razlog: "" });
    // Razred A (23. 11. 2026): od G4a (lastnik 10. 11. 2026) so med stalnimi tudi stavki iz kataloga; linija jih preveri s katalogom
    // (service.server.ts glasPripravljenZa(..., stalniStavki(pravila, podjetje, katalog))), pogoj je »natanko ti stavki«.
    assert.equal(glasPripravljenZa(drugi, stalniStavki(await loadPravila(drugi), "FORMA", formaCatalog())), true);
  });
});

/** Knjiga klicev z diska (brez seje): preizkus bere to, kar je res zapisano. */
async function listCallsBrezSeje(dir: string): Promise<Record<string, { transcript: Array<{ role: string; text: string; ms?: number; glasMs?: number }>; status: string; order: Record<string, unknown> }>> {
  return JSON.parse(await readFile(path.join(dir, "calls.json"), "utf8").catch(() => "{}"));
}

describe("naloga G3 V2: nestalni posnetki", { concurrency: 1 }, () => {
  it("V2 kljuc nestalnega posnetka vkljucuje CallSid: isti stavek v dveh klicih nima istega naslova", async () => {
    const dir = await scratch();
    lazniGlas();
    const sol = await solZvoka(dir);
    const stavek = "Gospa Primer, zapisala sem mizo.";
    assert.notEqual(kljucZvoka(sol, stavek, undefined, undefined, "CA-1"), kljucZvoka(sol, stavek, undefined, undefined, "CA-2"));
    assert.notEqual(kljucZvoka(sol, stavek, undefined, undefined, "CA-1"), kljucZvoka(sol, stavek));
    const a = await zvokZaBesedilo(stavek, dir, "CA-1");
    const b = await zvokZaBesedilo(stavek, dir, "CA-2");
    assert.ok("kljuci" in a && "kljuci" in b);
    assert.notDeepEqual(a.kljuci, b.kljuci);
    assert.deepEqual(a.kljuci, [kljucZvoka(sol, stavek, undefined, undefined, "CA-1")]);
  });

  it("V2 posnetek z odgovorom se pobrise ob koncu klica (status completed); stalni stavki ostanejo", async () => {
    const dir = await scratch();
    lazniGlas();
    await lastnik(dir);
    const sid = novSid();
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: OD });
    await klic(dir, "/api/voice/turn?obr=1", { CallSid: sid, From: OD, SpeechResult: "Sem Ana Primer." });
    // Razred A (23. 11. 2026): od G4a (lastnik 10. 11. 2026, brain.ts stavkiIzKataloga) je odgovor na dovoljen par stalni posnetek;
    // nestalni odgovor da nedovoljen par (»Alba ne delamo iz materiala Oreh ...«).
    const odgovor = await klic(dir, "/api/voice/turn?obr=2", { CallSid: sid, From: OD, SpeechResult: "Mizo Alba iz oreha." });
    await pocakajOzadjeKlicev();
    const naslovi = predvajani(odgovor);
    assert.ok(naslovi.length >= 1, odgovor);
    const imenaPrej = await readdir(mapaZvoka(dir));
    const stalnih = imenaPrej.filter((ime) => ime.endsWith(".stalno")).length;
    const nestalni = imenaPrej.filter((ime) => ime.endsWith(".wav") && !imenaPrej.includes(ime.replace(".wav", ".stalno")));
    // Razred A (23. 11. 2026): odgovor se razreze na kose (G3c, meritev vodje 10. 11. 2026: prvi stavek posebej) in povzetek se
    // predpripravi med klicem (G4b): »Alba ne delamo iz materiala Oreh.«, »Na voljo je: Hrast, Jesen.«, »Ime je Ana Primer.«.
    assert.equal(nestalni.length, 3);
    assert.equal((await handleZvokRequest(new Request(naslovi[0]), dir)).status, 200);
    assert.equal(steviloKlicevZZvokom(), 1);

    await klic(dir, "/api/voice/status", { CallSid: sid, CallStatus: "completed" });
    const imenaPotem = await readdir(mapaZvoka(dir));
    for (const ime of nestalni) assert.equal(imenaPotem.includes(ime), false, ime);
    assert.equal(imenaPotem.filter((ime) => ime.endsWith(".stalno")).length, stalnih);
    assert.equal(imenaPotem.filter((ime) => ime.endsWith(".wav")).length, stalnih);
    assert.equal((await handleZvokRequest(new Request(naslovi[0]), dir)).status, 404);
    assert.equal(steviloKlicevZZvokom(), 0);
  });

  it("V2 po 10 minutah javna pot nestalnega posnetka vrne 404, tudi ce datoteka se obstaja; stalni ostane", async () => {
    const dir = await scratch();
    lazniGlas();
    const stalni = await pripraviZvok("Trenutek, prosim.", dir, { stalno: true });
    const nestalni = await pripraviZvok("Gospa Primer, zapisala sem.", dir, { klic: "CA-STAR" });
    const get = (kljuc: string) => handleZvokRequest(new Request(`${IZVOR}/api/voice/zvok/${kljuc}.wav`), dir);
    const zdaj = Date.now();
    nastaviUroGlasuZaPreizkus(() => zdaj + STAROST_NESTALNIH_MS - 60_000);
    assert.equal((await get(nestalni)).status, 200);
    nastaviUroGlasuZaPreizkus(() => zdaj + STAROST_NESTALNIH_MS + 2_000);
    assert.equal((await get(nestalni)).status, 404);
    // Datoteka je se na disku: pot zavrne zaradi starosti, ne ker je ni.
    assert.equal((await stat(path.join(mapaZvoka(dir), `${nestalni}.wav`))).isFile(), true);
    assert.equal((await get(stalni)).status, 200);
    // Star nestalni posnetek tudi ni vec »pripravljen«: klic ga ne predvaja, ampak sintetizira znova.
    assert.equal(STAROST_NESTALNIH_MS, 10 * 60 * 1000);
    const izid = await pocistiZvok(dir);
    assert.equal(izid.pobrisanih, 1);
    assert.deepEqual((await readdir(mapaZvoka(dir))).sort(), [`${stalni}.stalno`, `${stalni}.wav`].sort());
  });

  it("V2 casovnik cisti ob zagonu in zaustavitvi, ne samo ob novi sintezi", async () => {
    const dir = await scratch();
    lazniGlas();
    const stalni = await pripraviZvok("Trenutek, prosim.", dir, { stalno: true });
    // Star nestalni posnetek nastavimo rocno, ko se ciscenje po sintezi stalnega stavka ze izteklo: tako ga lahko
    // pobrise samo casovnik, ne ciscenje po novi sintezi.
    await new Promise((resolve) => setTimeout(resolve, 40));
    await pocistiZvok(dir);
    const star = "ab".repeat(16);
    await writeFile(path.join(mapaZvoka(dir), `${star}.wav`), Buffer.alloc(200));
    const prej = new Date(Date.now() - 5 * 60 * 60 * 1000);
    await utimes(path.join(mapaZvoka(dir), `${star}.wav`), prej, prej);
    // Zagon: casovnik pocisti takoj, brez nove sinteze.
    const sintez = steviloSintezVTeku();
    zazeniCiscenjeZvoka(dir, 60_000);
    // Cakamo na dogodek (datoteka pobrisana), ne na cas: zanka se konca takoj, ko se zgodi.
    for (let i = 0; i < 2_000 && (await readdir(mapaZvoka(dir))).includes(`${star}.wav`); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal((await readdir(mapaZvoka(dir))).includes(`${star}.wav`), false);
    assert.equal(steviloSintezVTeku(), sintez);
    // Zaustavitev: svez nestalni posnetek gre ven, stalni ostane.
    const svez = await pripraviZvok("Gospod Primer, hvala.", dir, { klic: "CA-KONEC" });
    assert.equal((await readdir(mapaZvoka(dir))).includes(`${svez}.wav`), true);
    ustaviCiscenjeZvoka(dir);
    assert.deepEqual((await readdir(mapaZvoka(dir))).sort(), [`${stalni}.stalno`, `${stalni}.wav`].sort());
    assert.equal(pobrisiNestalneSinhrono(dir), 0);
  });

  it("N9 zaprtje linije stalnih stavkov ne odznaci: ponovno odprtje ne sintetizira nicesar", async () => {
    const dir = await scratch();
    const glas = lazniGlas();
    const token = await lastnik(dir);
    const sintez = glas.klici.length;
    const oznakPrej = (await readdir(mapaZvoka(dir))).filter((ime) => ime.endsWith(".stalno")).length;
    assert.ok(oznakPrej >= 20);
    await publishLine({ open: false }, { token }, dir);
    await pocakajGlas(dir);
    assert.equal((await readdir(mapaZvoka(dir))).filter((ime) => ime.endsWith(".stalno")).length, oznakPrej);
    // Tudi ciscenje po vec kot 10 minutah stalnih ne pobrise.
    assert.equal((await pocistiZvok(dir, { zdaj: Date.now() + 3 * 60 * 60 * 1000 })).pobrisanih, 0);
    const spet = await publishLine({ open: true }, { token }, dir);
    await pocakajGlas(dir);
    assert.equal(glas.klici.length, sintez);
    assert.equal((await readLine({ token }, dir)).open, true);
    assert.equal(spet.odprtje.stanje === "odprta" || spet.odprtje.stanje === "cakaGlas", true);
    // Sprememba besedila sintetizira samo novi stavek.
    await savePravila({ pozdrav: "Lep pozdrav iz delavnice." }, token, dir);
    await pocakajGlas(dir);
    // Razred A (23. 11. 2026): pozdrav je ENA sinteza, deli ostanejo za razkritjeSpredaj (lastnik 14. 11. 2026, glas.ts stalniStavki);
    // nov pozdrav zato sintetizira celoten pozdrav in razkritje brez imena podjetja, nic drugega.
    assert.deepEqual(glas.klici.slice(sintez), [
      "Dober dan, tukaj Lina, pomočnica z umetno inteligenco. Lep pozdrav iz delavnice. Pogovor snemam in zapisujem kot dokaz o naročilu, posnetek hranimo največ 30 dni. Prosim, povejte ime in priimek ter podjetje, če ga imate.",
      "Dober dan, tukaj Lina, pomočnica z umetno inteligenco.",
      "Lep pozdrav iz delavnice.",
    ]);
  });
});

describe("naloga G3 S1-S6: odpornost obrata", { concurrency: 1 }, () => {
  it("S1 odklopnik: po napaki sinteze gre naslednji odgovor takoj v rezervo, brez sinteze in brez »Trenutek«", async () => {
    const dir = await scratch();
    // Razred A (23. 11. 2026): od G4a (lastnik 10. 11. 2026, brain.ts stavkiIzKataloga) je »Zapisala sem <izdelek> iz materiala
    // <material>.« stalni posnetek; padec stalnega stavka odklopnika ne sprozi, zamuda pa je obesila ze pripravo stalnih.
    // Dinamicen odgovor iz kataloga je zato nedovoljen par (»Alba ne delamo iz materiala Oreh ...«).
    const glas = lazniGlas({ pade: /ne delamo/ });
    await lastnik(dir);
    const sid = novSid();
    const zdaj = Date.now();
    nastaviUroGlasuZaPreizkus(() => zdaj);
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: OD });
    await klic(dir, "/api/voice/turn?obr=1", { CallSid: sid, From: OD, SpeechResult: "Sem Ana Primer." });
    assert.equal(odklopnikOdprt(dir), false);
    const prvi = await klic(dir, "/api/voice/turn?obr=2", { CallSid: sid, From: OD, SpeechResult: "Mizo Alba iz oreha." });
    assert.match(prvi, /<Say language="sl-SI">[^<]*Alba/);
    assert.equal(odklopnikOdprt(dir), true);
    const sintez = glas.klici.length;
    // V oknu odklopa: nova sinteza se sploh ne poskusi, odgovor je takoj v rezervi, vmesnega stavka ni.
    const drugi = await klic(dir, "/api/voice/turn?obr=3", { CallSid: sid, From: OD, SpeechResult: "Rad bi tudi kavč." }, { cakajMs: 2_000 });
    assert.match(drugi, /<Say language="sl-SI">/);
    assert.doesNotMatch(drugi, /Trenutek|cak=/);
    assert.equal(glas.klici.length, sintez);
    const zapisi = await dnevnikGlasu(dir);
    assert.deepEqual(zapisi.filter((zapis) => zapis.kje === "odgovor").map((zapis) => zapis.razlog), ["glasNapaka", "glasOdklop"]);
    // Stalni stavek se v oknu odklopa se vedno predvaja z Lininim glasom.
    const stalni = await zvokZaBesedilo(t("kakoPomagam"), dir, sid);
    assert.ok("kljuci" in stalni);
    // Po oknu se sinteza spet poskusi.
    nastaviUroGlasuZaPreizkus(() => zdaj + ODKLOP_MS + 1);
    assert.equal(odklopnikOdprt(dir), false);
    await zvokZaBesedilo("Zapisala sem novo mizo.", dir, sid);
    assert.equal(glas.klici.length, sintez + 1);
  });

  it("S1 zamuda sinteze sprozi odklopnik: naslednji obrat ne caka in nima vmesnega stavka", async () => {
    const dir = await scratch();
    // Razred A (23. 11. 2026): od G4a (lastnik 10. 11. 2026, brain.ts stavkiIzKataloga) je »Zapisala sem <izdelek> iz materiala
    // <material>.« stalni posnetek; padec stalnega stavka odklopnika ne sprozi, zamuda pa je obesila ze pripravo stalnih.
    // Dinamicen odgovor iz kataloga je zato nedovoljen par (»Alba ne delamo iz materiala Oreh ...«).
    const glas = lazniGlas({ visi: /ne delamo/ });
    await lastnik(dir);
    const sid = novSid();
    // G3c (meritev vodje 10. 11. 2026, naloga-g3c.test.ts): do trde meje obrata (12 s) je skok tih, rezerva pride sele po njej.
    let zdaj = 1_800_000_000_000;
    const moznosti = { cakajMs: 5, cakajNaprejMs: 5, ura: () => zdaj };
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: OD });
    await klic(dir, "/api/voice/turn?obr=1", { CallSid: sid, From: OD, SpeechResult: "Sem Ana Primer." });
    const vmes = await klic(dir, "/api/voice/turn?obr=2", { CallSid: sid, From: OD, SpeechResult: "Mizo Alba iz oreha." }, moznosti);
    assert.match(vmes, /cak=1/);
    await pocakajZapisObrata(dir, sid, 3);
    zdaj += TRDA_MEJA_OBRATA_MS;
    const rezerva = await klic(dir, "/api/voice/turn?obr=2&cak=1", { CallSid: sid, From: OD }, moznosti);
    assert.match(rezerva, /<Say language="sl-SI">[^<]*Alba/);
    assert.doesNotMatch(rezerva, /cak=/);
    assert.equal(odklopnikOdprt(dir), true);
    // Naslednji obrat z dolgo mejo cakanja odgovori takoj: sinteze v oknu odklopa ni.
    const sintez = glas.klici.length;
    const naslednji = await klic(dir, "/api/voice/turn?obr=3", { CallSid: sid, From: OD, SpeechResult: "Rad bi tudi kavč." }, { cakajMs: 60_000 });
    assert.match(naslednji, /<Say language="sl-SI">/);
    assert.doesNotMatch(naslednji, /Trenutek|cak=/);
    assert.equal(glas.klici.length, sintez);
    glas.spusti();
  });

  it("S2 pridobitev zetona ima rok: visec oauth2 ne obesi klica in ne pusti zetona", async () => {
    let klici = 0;
    const visec = () => {
      klici += 1;
      return new Promise<{ token: string; pretece: number | null }>(() => undefined);
    };
    await assert.rejects(vertexAccessToken(visec, 1_800_000_000_000, 15), /Prijava Google Cloud ni uspela/);
    assert.equal(klici, 1);
    assert.equal(zetonJeShranjen(), false);
    // Sinteza z visecim zetonom se konca z napako brez vsebine, ne visi.
    const lazniFetch = (async () => {
      throw new Error("do sem ne sme priti");
    }) as typeof fetch;
    await assert.rejects(
      sintetizirajVertex("Dober dan.", "moj-projekt", { fetch: lazniFetch, zeton: () => vertexAccessToken(visec, 1_800_000_000_000, 15) }),
      (error: unknown) => error instanceof NapakaGlasu && error.koda === "glasNapaka",
    );
    // Pozen izid po roku ne postane shranjen zeton.
    let razresi: (zeton: { token: string; pretece: number | null }) => void = () => undefined;
    const pozen = () =>
      new Promise<{ token: string; pretece: number | null }>((resolve) => {
        razresi = resolve;
      });
    await assert.rejects(vertexAccessToken(pozen, 1_800_000_000_000, 15));
    razresi({ token: "zeton-pozen", pretece: 1_800_003_600_000 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(zetonJeShranjen(), false);
  });

  it("S3 zeton se pozabi ob shranjevanju mozganov, preverbi prijave, prijavi in odjavi lastnika", async () => {
    const dir = await scratch();
    const token = await setupOwner("geslo-test-1234", dir);
    const zdaj = Date.now();
    const pridobi = async () => ({ token: "zeton-stari", pretece: zdaj + 3_600_000 });
    const napolni = async () => {
      await vertexAccessToken(pridobi, zdaj);
      assert.equal(zetonJeShranjen(), true);
    };
    await napolni();
    await saveBrain({ provider: "vertex", model: "gemini-3-flash-preview", project: "drug-projekt" }, token, dir);
    assert.equal(zetonJeShranjen(), false);
    await napolni();
    await saveBrain({ provider: "openai", key: "kljuc-kljuc-kljuc" }, token, dir);
    assert.equal(zetonJeShranjen(), false);
    await napolni();
    const seja = await loginOwner("geslo-test-1234", dir);
    assert.equal(zetonJeShranjen(), false);
    await napolni();
    await logoutOwner(seja, dir);
    assert.equal(zetonJeShranjen(), false);
    // Preverba prijave (gumb v nastavitvah) pridobi nov zeton, ne uporabi starega.
    await napolni();
    const videni: string[] = [];
    nastaviPridobitevZaPreizkus(async () => ({ token: "zeton-novi", pretece: Date.now() + 3_600_000 }));
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      videni.push(String((init?.headers as Record<string, string>).authorization ?? (init?.headers as Record<string, string>).Authorization ?? ""));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "da" }] } }] }), { status: 200 });
    }) as typeof fetch;
    const izid = await checkBrain({ provider: "vertex", project: "moj-projekt" }, token, dir);
    assert.equal(izid.ok, true);
    assert.deepEqual(videni, ["Bearer zeton-novi"]);
  });

  it("S3 veja 401: glas in mozgani po zavrnitvi pozabita zeton, naslednji klic ga pridobi znova", async () => {
    const zdaj = Date.now();
    let pridobitev = 0;
    const pridobi = async () => {
      pridobitev += 1;
      return { token: `zeton-${pridobitev}`, pretece: zdaj + 3_600_000 };
    };
    // Glas: 401 pozabi zeton.
    const zavrne401 = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    await assert.rejects(
      sintetizirajVertex("Dober dan.", "moj-projekt", { fetch: zavrne401, zeton: () => vertexAccessToken(pridobi, zdaj) }),
      (error: unknown) => error instanceof NapakaGlasu && error.status === 401,
    );
    assert.equal(zetonJeShranjen(), false);
    assert.equal(await vertexAccessToken(pridobi, zdaj), "zeton-2");
    // Druga napaka (403) zetona ne pozabi.
    const zavrne403 = (async () => new Response("{}", { status: 403 })) as typeof fetch;
    await assert.rejects(sintetizirajVertex("Dober dan.", "moj-projekt", { fetch: zavrne403, zeton: () => vertexAccessToken(pridobi, zdaj) }));
    assert.equal(zetonJeShranjen(), true);

    // Mozgani: 401 pozabi zeton, naslednji klic poslje novega.
    pozabiZeton();
    let n = 0;
    nastaviPridobitevZaPreizkus(async () => {
      n += 1;
      return { token: `mozgani-${n}`, pretece: Date.now() + 3_600_000 };
    });
    const glave: string[] = [];
    let status = 401;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const h = init?.headers as Record<string, string>;
      glave.push(h.authorization ?? h.Authorization ?? "");
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "da" }] } }] }), { status });
    }) as typeof fetch;
    const klicModela = () => callProvider({ provider: "vertex", model: "gemini-3-flash-preview", key: "", project: "moj-projekt", text: "Pozdrav" });
    const zavrnjen = await klicModela();
    assert.equal(zavrnjen.ok, false);
    assert.equal(zetonJeShranjen(), false);
    status = 200;
    assert.equal((await klicModela()).ok, true);
    assert.equal((await klicModela()).ok, true);
    // Po 401 nov zeton; ko deluje, isti zeton za naslednji klic.
    assert.deepEqual(glave, ["Bearer mozgani-1", "Bearer mozgani-2", "Bearer mozgani-2"]);
  });

  it("S4 napaka obrata ni HTTP 500: opravicilo in nadaljevanje, drugic slovo; ponovitev zahteve dobi isti TwiML", async () => {
    const dir = await scratch();
    lazniGlas();
    await lastnik(dir);
    const sid = novSid();
    // Razred A (23. 11. 2026): od G4a (lastnik 10. 11. 2026, AGENTS.md »Po drugem pravem klicu«; service.server.ts »Model samo
    // za vprasanja klicatelja«) narocilo iz kataloga modela ne poklice; model dobi samo vprasanje, na katero katalog ne odgovori.
    const pokvarjen = async () => {
      throw new Error("model je padel z vsebino pogovora");
    };
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: OD });
    await klic(dir, "/api/voice/turn?obr=1", { CallSid: sid, From: OD, SpeechResult: "Sem Ana Primer." });
    const zahteva = () => handleVoiceRequest(podpisanaZahteva("/api/voice/turn?obr=2", { CallSid: sid, From: OD, SpeechResult: "Kakšna je razlika med hrastom in jesenom?" }), dir, undefined, { model: pokvarjen });
    const prvi = await zahteva();
    assert.equal(prvi.status, 200);
    const twiml = await prvi.text();
    const sol = await solZvoka(dir);
    assert.deepEqual(predvajani(twiml), [`${IZVOR}/api/voice/zvok/${kljucZvoka(sol, t("oprostiteNapaka"))}.wav`]);
    assert.match(twiml, /<Gather [^>]*action="https:\/\/lina\.primer\/api\/voice\/turn\?obr=2"/);
    assert.doesNotMatch(twiml, /model je padel/);
    // Ponovitev iste podpisane zahteve: isti TwiML, ne 409 in ne nov obrat.
    const ponovitev = await zahteva();
    assert.equal(ponovitev.status, 200);
    assert.equal(await ponovitev.text(), twiml);
    assert.equal(steviloNapakKlicev(), 1);
    assert.equal(steviloOpravil(), 0);

    // Druga napaka v istem klicu: slovo in konec, klic je zapisan kot zakljucen.
    const drugi = await handleVoiceRequest(
      podpisanaZahteva("/api/voice/turn?obr=2", { CallSid: sid, From: OD, SpeechResult: "Ali je hrast primeren za kuhinjo?" }),
      dir,
      undefined,
      { model: pokvarjen },
    );
    assert.equal(drugi.status, 200);
    const slovo = await drugi.text();
    assert.deepEqual(predvajani(slovo), [`${IZVOR}/api/voice/zvok/${kljucZvoka(sol, t("oprostiteSlovo"))}.wav`]);
    assert.match(slovo, /<Hangup\/>/);
    assert.doesNotMatch(slovo, /<Gather/);
    assert.equal((await listCallsBrezSeje(dir))[sid].status, "zakljucen");
    assert.equal(steviloNapakKlicev(), 0);
    // V dnevniku glasu ni vsebine napake.
    assert.doesNotMatch(JSON.stringify(await dnevnikGlasu(dir)), /model je padel|Alba/);
  });

  it("S4 socasna ponovitev zahteve, ki se tece, pocaka isti TwiML", async () => {
    const dir = await scratch();
    lazniGlas();
    await lastnik(dir);
    const sid = novSid();
    // Razred A (23. 11. 2026): od G4a (lastnik 10. 11. 2026, AGENTS.md »Po drugem pravem klicu«; service.server.ts »Model samo
    // za vprasanja klicatelja«) narocilo iz kataloga modela ne poklice; model dobi samo vprasanje, na katero katalog ne odgovori.
    const pocasen = zapornaModel();
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: OD });
    await klic(dir, "/api/voice/turn?obr=1", { CallSid: sid, From: OD, SpeechResult: "Sem Ana Primer." });
    const params = { CallSid: sid, From: OD, SpeechResult: "Kakšna je razlika med hrastom in jesenom?" };
    const moznosti = { model: pocasen.model, cakajMs: 2_000 };
    const prva = handleVoiceRequest(podpisanaZahteva("/api/voice/turn?obr=2", params), dir, undefined, moznosti);
    const druga = handleVoiceRequest(podpisanaZahteva("/api/voice/turn?obr=2", params), dir, undefined, moznosti);
    pocasen.stanje.spusti();
    const [a, b] = await Promise.all([prva, druga]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(await a.text(), await b.text());
    assert.equal(pocasen.stanje.klici, 1);
  });

  it("S6 ponudnik brez glasu Gemini: brez vmesnega stavka, model caka dlje in molce", async () => {
    const dir = await scratch();
    await lastnik(dir, { brezGlasu: true });
    const sid = novSid();
    const pocasen = zapornaModel();
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: OD });
    await klic(dir, "/api/voice/turn?obr=1", { CallSid: sid, From: OD, SpeechResult: "Sem Ana Primer." });
    // cakajMs (meja z glasom) je kratka; brez glasu velja daljsa meja, zato odgovor pride brez vmesnega stavka.
    const moznosti = { model: pocasen.model, cakajMs: 1, cakajNaprejMs: 1, cakajBrezGlasuMs: 5_000 };
    const cakajoc = klic(dir, "/api/voice/turn?obr=2", { CallSid: sid, From: OD, SpeechResult: "Mizo Alba iz hrasta." }, moznosti);
    for (let i = 0; i < 2_000 && pocasen.stanje.klici === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 2));
    pocasen.stanje.spusti();
    const twiml = await cakajoc;
    assert.match(twiml, /<Say language="sl-SI">[^<]*Alba/);
    assert.doesNotMatch(twiml, /Trenutek|cak=|<Pause/);
    // Ce model ne odgovori niti v daljsi meji: molk (Pause) in skok, nikoli »Trenutek« v glasu posrednika.
    const visec = zapornaModel();
    const dolgo = await klic(
      dir,
      "/api/voice/turn?obr=3",
      { CallSid: sid, From: OD, SpeechResult: "Ali delate tudi omare?" },
      { model: visec.model, cakajMs: 1, cakajNaprejMs: 1, cakajBrezGlasuMs: 5 },
    );
    assert.doesNotMatch(dolgo, /Trenutek|<Say/);
    assert.match(dolgo, /^<\?xml[^>]*\?><Response><Pause length="1"\/><Redirect method="POST">[^<]*turn\?obr=3&amp;cak=1<\/Redirect><\/Response>$/);
    visec.stanje.spusti();
    await pocakajOpravila();
  });
});

describe("naloga G3 N1-N7: meje in pot zvoka", { concurrency: 1 }, () => {
  it("N1 meja cak: vmesni stavek do stirih cakanj na besedilo, nato rezerva; vrednost nad mejo ali neveljavna ne podaljsa", async () => {
    const dir = await scratch();
    lazniGlas();
    await lastnik(dir);
    const sid = novSid();
    // Razred A (23. 11. 2026): od G4a (lastnik 10. 11. 2026, AGENTS.md »Po drugem pravem klicu«; service.server.ts »Model samo
    // za vprasanja klicatelja«) narocilo iz kataloga modela ne poklice; model dobi samo vprasanje, na katero katalog ne odgovori.
    const visec = zapornaModel();
    const moznosti = { model: visec.model, cakajMs: 2, cakajNaprejMs: 2 };
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: OD });
    await klic(dir, "/api/voice/turn?obr=1", { CallSid: sid, From: OD, SpeechResult: "Sem Ana Primer." });
    let twiml = await klic(dir, "/api/voice/turn?obr=2", { CallSid: sid, From: OD, SpeechResult: "Kakšna je razlika med hrastom in jesenom?" }, moznosti);
    assert.equal(NAJVEC_CAKANJ, 4);
    for (let k = 1; k < NAJVEC_CAKANJ; k += 1) {
      assert.match(twiml, new RegExp(`turn\\?obr=2&amp;cak=${k}</Redirect>`));
      assert.doesNotMatch(twiml, /<Gather/);
      twiml = await klic(dir, `/api/voice/turn?obr=2&cak=${k}`, { CallSid: sid, From: OD }, moznosti);
    }
    assert.match(twiml, /cak=4<\/Redirect>/);
    // Vrednost nad mejo in neveljavna vrednost veljata kot zadnje cakanje: brez novega skoka cak.
    for (const vrednost of ["99", "5", "abc", "-1", "0"]) {
      const cez = await klic(dir, `/api/voice/turn?obr=2&cak=${vrednost}`, { CallSid: sid, From: OD }, moznosti);
      assert.doesNotMatch(cez, /cak=/, vrednost);
      assert.match(cez, /<Gather [^>]*action="https:\/\/lina\.primer\/api\/voice\/turn\?obr=2"/, vrednost);
    }
    // Model se vseskozi ni vrnil in je bil klican enkrat.
    assert.equal(visec.stanje.klici, 1);
    visec.stanje.spusti();
    await pocakajOpravila();
  });

  it("N2 mapa zvok kot simbolna povezava drugam in povezava namesto datoteke sta 404", async () => {
    if (process.platform === "win32") return;
    const dir = await scratch();
    const drugje = await scratch();
    lazniGlas();
    const kljuc = await pripraviZvok("Hvala.", dir);
    const get = () => handleZvokRequest(new Request(`${IZVOR}/api/voice/zvok/${kljuc}.wav`), dir);
    assert.equal((await get()).status, 200);
    // Mapa zvok prestavljena drugam, na njenem mestu simbolna povezava: vsebina je ista, pot pa ni vec nasa.
    await rename(mapaZvoka(dir), path.join(drugje, "zvok"));
    await symlink(path.join(drugje, "zvok"), mapaZvoka(dir));
    assert.equal((await readFile(path.join(mapaZvoka(dir), `${kljuc}.wav`))).length > 44, true);
    assert.equal((await get()).status, 404);
    // Prava mapa, datoteka pa simbolna povezava na datoteko zunaj mape podatkov.
    await rm(mapaZvoka(dir));
    await mkdir(mapaZvoka(dir));
    await symlink(path.join(drugje, "zvok", `${kljuc}.wav`), path.join(mapaZvoka(dir), `${kljuc}.wav`));
    assert.equal((await get()).status, 404);
  });

  it("N3 sol: socasno ustvarjanje brez predpomnilnika da eno samo sol; napol zapisane datoteke nihce ne pobrise", async () => {
    const dir = await scratch();
    const soli = await Promise.all(Array.from({ length: 12 }, () => preberiAliUstvariSol(dir)));
    const naDisku = await readFile(path.join(dir, ".sol-zvoka"));
    assert.equal(naDisku.length, 32);
    for (const sol of soli) assert.deepEqual(sol, naDisku);
    assert.deepEqual((await readdir(dir)).filter((ime) => ime.includes(".sol-zvoka")), [".sol-zvoka"]);
    if (process.platform !== "win32") assert.equal((await stat(path.join(dir, ".sol-zvoka"))).mode & 0o777, 0o600);
    // Veljavna sol drugega procesa ostane, tudi ce jo beremo znova.
    assert.deepEqual(await preberiAliUstvariSol(dir), naDisku);
    // Okrnjen ostanek (stara izdaja): zamenja se s celo soljo, naslednji klici dobijo isto.
    const drugi = await scratch();
    await writeFile(path.join(drugi, ".sol-zvoka"), Buffer.alloc(5));
    nastaviUroGlasuZaPreizkus(null, async () => undefined);
    const popravljena = await preberiAliUstvariSol(drugi);
    assert.equal(popravljena.length, 32);
    assert.deepEqual(await readFile(path.join(drugi, ".sol-zvoka")), popravljena);
    const potem = await Promise.all(Array.from({ length: 6 }, () => preberiAliUstvariSol(drugi)));
    for (const sol of potem) assert.deepEqual(sol, popravljena);
    assert.deepEqual((await readdir(drugi)).filter((ime) => ime.includes(".sol-zvoka")), [".sol-zvoka"]);
  });

  it("N4 pot zvoka: meja velikosti, nosniff in omejitev stevila zahtev", async () => {
    const dir = await scratch();
    lazniGlas();
    const kljuc = await pripraviZvok("Hvala.", dir);
    const naslov = `${IZVOR}/api/voice/zvok/${kljuc}.wav`;
    const velikost = (await stat(path.join(mapaZvoka(dir), `${kljuc}.wav`))).size;
    const dober = await handleZvokRequest(new Request(naslov), dir);
    assert.equal(dober.status, 200);
    assert.equal(dober.headers.get("x-content-type-options"), "nosniff");
    assert.equal(dober.headers.get("content-type"), "audio/wav");
    // Datoteka nad mejo ni nas posnetek: 404. Meja je natancna.
    assert.equal((await handleZvokRequest(new Request(naslov), dir, { najvecBajtov: velikost })).status, 200);
    assert.equal((await handleZvokRequest(new Request(naslov), dir, { najvecBajtov: velikost - 1 })).status, 404);
    // Privzeta meja 8 MB: vecja datoteka z veljavnim imenom je 404.
    const velik = "ef".repeat(16);
    await writeFile(path.join(mapaZvoka(dir), `${velik}.wav`), Buffer.alloc(8 * 1024 * 1024 + 1));
    assert.equal((await handleZvokRequest(new Request(`${IZVOR}/api/voice/zvok/${velik}.wav`), dir)).status, 404);
    await rm(path.join(mapaZvoka(dir), `${velik}.wav`));

    // Omejitev stevila zahtev v oknu; po oknu spet dela. Velja tudi za ugibanje neobstojecih kljucev.
    ponastaviOmejitevZvoka();
    const zdaj = Date.now();
    nastaviUroGlasuZaPreizkus(() => zdaj);
    const ugibanje = `${IZVOR}/api/voice/zvok/${"0".repeat(32)}.wav`;
    for (let i = 0; i < ZVOK_NAJVEC_ZAHTEV; i += 1) {
      assert.equal((await handleZvokRequest(new Request(i % 2 ? naslov : ugibanje), dir)).status, i % 2 ? 200 : 404);
    }
    const prevec = await handleZvokRequest(new Request(naslov), dir);
    assert.equal(prevec.status, 429);
    assert.equal(prevec.headers.get("cache-control"), "no-store");
    nastaviUroGlasuZaPreizkus(() => zdaj + ZVOK_OKNO_MS);
    assert.equal((await handleZvokRequest(new Request(naslov), dir)).status, 200);
  });

  it("N5 GET na /api/voice/incoming, turn in status je 403; posnetek ostane dosegljiv", async () => {
    const dir = await scratch();
    lazniGlas();
    await lastnik(dir);
    for (const pot of ["/api/voice/incoming", "/api/voice/turn", "/api/voice/turn?obr=1", "/api/voice/status", "/api/voice/karkoli", "/api/voice/"]) {
      const odgovor = await handleVoiceGet(new Request(`${IZVOR}${pot}`), dir);
      assert.equal(odgovor.status, 403, pot);
    }
    const kljuc = kljucZvoka(await solZvoka(dir), t("trenutek"));
    assert.equal((await handleVoiceGet(new Request(`${IZVOR}/api/voice/zvok/${kljuc}.wav`), dir)).status, 200);
    assert.equal((await handleVoiceGet(new Request(`${IZVOR}/api/voice/zvok/${"0".repeat(32)}.wav`), dir)).status, 404);
    // GET nikoli ne zapise klica.
    await assert.rejects(stat(path.join(dir, "calls.json")));
  });

  it("N7 zemljevid opravil se pocisti ob koncu klica in po starosti, ne sele ob naslednjem obratu", async () => {
    const dir = await scratch();
    // Razred A (23. 11. 2026): od G4a (lastnik 10. 11. 2026, brain.ts stavkiIzKataloga) je »Zapisala sem <izdelek> iz materiala
    // <material>.« stalni posnetek, zato je zamuda obesila ze pripravo stalnih. Viseca sinteza je dinamicen odgovor (nedovoljen par).
    const glas = lazniGlas({ visi: /ne delamo/ });
    await lastnik(dir);
    const moznosti = { cakajMs: 2, cakajNaprejMs: 2 };
    const prvi = novSid();
    await klic(dir, "/api/voice/incoming", { CallSid: prvi, From: OD });
    await klic(dir, "/api/voice/turn?obr=1", { CallSid: prvi, From: OD, SpeechResult: "Sem Ana Primer." });
    assert.equal(steviloOpravil(), 0);
    await klic(dir, "/api/voice/turn?obr=2", { CallSid: prvi, From: OD, SpeechResult: "Mizo Alba iz oreha." }, moznosti);
    assert.equal(steviloOpravil(), 1);
    // Klicatelj odlozi med cakanjem: status completed pocisti opravilo tega klica.
    await klic(dir, "/api/voice/status", { CallSid: prvi, CallStatus: "completed" });
    assert.equal(steviloOpravil(), 0);

    const drugi = novSid();
    const zacetek = 1_800_000_000_000;
    const zUro = { ...moznosti, ura: () => zacetek };
    // Prva obrata sta stalna stavka in cakata privzeto mejo; kratka meja velja samo za obrat z viseco sintezo.
    await klic(dir, "/api/voice/incoming", { CallSid: drugi, From: OD }, { ura: () => zacetek });
    await klic(dir, "/api/voice/turn?obr=1", { CallSid: drugi, From: OD, SpeechResult: "Sem Ana Primer." }, { ura: () => zacetek });
    await klic(dir, "/api/voice/turn?obr=2", { CallSid: drugi, From: OD, SpeechResult: "Mizo Alba iz oreha." }, zUro);
    assert.equal(steviloOpravil(), 1);
    // Casovnik: mlado opravilo ostane, staro gre ven brez novega obrata.
    assert.equal(pocistiOpravila(zacetek + 60_000), 0);
    assert.equal(steviloOpravil(), 1);
    assert.equal(pocistiOpravila(zacetek + 2 * 60_000 + 1), 1);
    assert.equal(steviloOpravil(), 0);
    glas.spusti();
  });
});

describe("naloga G3 B: eno vprasanje naenkrat", { concurrency: 1 }, () => {
  // Razred A (23. 11. 2026): potek konca klica G4g (lastnik 11. 11. 2026, AGENTS.md »Potek konca klica (G4g)« in »Potek klica«
  // tocka 4, »Telefonska stevilka klicatelja« 11. 11. 2026): Lina vprasa samo kolicino, rok in telefon (samo pri skriti stevilki),
  // vsako najvec enkrat; e-poste in casa povratnega klica ne vprasa vec; na koncu povzetek in »Ali potrjujete naročilo?«, po
  // potrditvi stavek o povratnem klicu in »Hvala za klic. Lep dan.«. Od G4a (10. 11. 2026) narocilo iz kataloga modela ne poklice.
  // Prej (G3, 10. 11. 2026): rok -> telefon -> e-posta -> povratni klic. Telefon ostane v zaporedju s skrito stevilko.
  const SKRITA = "anonymous";
  const VPRASANJA: Array<[string, RegExp]> = [
    ["kolicina", /koliko kosov/i],
    ["rok", /do kdaj potrebujete/i],
    ["telefon", /telefonsko številko/i],
    ["eposta", /elektronsko pošto/i],
    ["dosegljiv", /pokličemo nazaj/i],
  ];
  const kajVprasa = (reply: string) => VPRASANJA.filter(([, vzorec]) => vzorec.test(reply)).map(([polje]) => polje);

  it("B vrstni red kolicina -> rok -> telefon (skrita stevilka), vsako enkrat, en obrat eno vprasanje, vse brez modela", async () => {
    const dir = await scratch();
    await lastnik(dir, { brezGlasu: true });
    const stevec = modelStevec();
    const sid = novSid();
    const obrat = (text: string) => recordCaller({ callSid: sid, from: SKRITA, text }, dir, stevec.model);
    const pozdrav = await obrat("");
    assert.match(prviStavek(pozdrav.reply), /umetno inteligenco/);
    assert.equal((await obrat("Ana Primer, nisem iz podjetja.")).reply, t("kakoPomagam"));
    const vrsta: string[] = [];
    let izid = await obrat("Zanima me miza Alba iz hrasta.");
    for (const odgovor of ["Dva kosa.", "Do petnajstega decembra.", "041 000 000"]) {
      assert.equal(izid.call.status, "v-teku");
      const vprasano = kajVprasa(izid.reply);
      assert.equal(vprasano.length, 1, izid.reply);
      assert.ok((izid.reply.match(/\?/g) ?? []).length <= 1, izid.reply);
      vrsta.push(vprasano[0]);
      izid = await obrat(odgovor);
    }
    assert.deepEqual(vrsta, ["kolicina", "rok", "telefon"]);
    // Povzetek in vprasanje za potrditev sta na koncu; po potrditvi slovo z zahvalo.
    assert.deepEqual(kajVprasa(izid.reply), []);
    assert.ok(izid.reply.startsWith(t("povzetekUvod")), izid.reply);
    assert.ok(izid.reply.endsWith(t("potrditevVprasanje")), izid.reply);
    izid = await obrat("Potrjujem.");
    // Model ni bil klican: potrditev, vprasanja in slovo so stalni stavki, narocilo je iz kataloga.
    assert.equal(stevec.stanje.klici, 0);
    assert.equal(izid.call.status, "zakljucen");
    assert.equal(izid.reply, `${t("povratniKlicSploh")} ${t("slovo")} ${t("lepDan")}`);
    assert.equal(izid.call.order.deadline, "petnajstega decembra");
    assert.equal(izid.call.order.quantity, 2);
    assert.match(izid.call.order.phone, /041/);
    assert.equal(izid.call.order.email, t("niDan"));
    assert.equal(izid.call.order.customerName, "Ana Primer");
    // Vsa vprasanja in zakljucek so stalni stavki: glas jih ima pripravljene, modela ne rabijo.
    const stalni = new Set(stalniStavki(await loadPravila(dir), "FORMA"));
    for (const kljuc of ["prosiKolicino", "prosiRok", "prosiTelefon", "povzetekUvod", "potrditevVprasanje", "povratniKlicSploh", "slovo", "lepDan", "kakoPomagam"] as const) {
      assert.ok(stalni.has(t(kljuc)), kljuc);
    }
    const lina = izid.call.transcript.filter((v) => v.role === "lina").map((v) => v.text);
    for (const [polje, vzorec] of VPRASANJA) assert.equal(lina.filter((stavek) => vzorec.test(stavek)).length, ["eposta", "dosegljiv"].includes(polje) ? 0 : 1, polje);
    assert.equal(lina.filter((stavek) => /ime in priimek/.test(stavek)).length, 1);
    // Vidna stevilka: telefona ne vprasa, stavek o povratnem klicu omeni stevilko, s katere klicatelj klice.
    const vidna = novSid();
    const obratV = (text: string) => recordCaller({ callSid: vidna, from: OD, text }, dir, stevec.model);
    await obratV("");
    await obratV("Ana Primer.");
    await obratV("Zanima me miza Alba iz hrasta, dva kosa.");
    const povzetek = await obratV("Do petnajstega decembra.");
    assert.deepEqual(kajVprasa(povzetek.reply), []);
    assert.ok(povzetek.reply.endsWith(t("potrditevVprasanje")), povzetek.reply);
    const konecV = await obratV("Da.");
    assert.equal(konecV.reply, `${t("povzetekStik")} ${t("slovo")} ${t("lepDan")}`);
    assert.equal(konecV.call.order.phone, OD);
  });

  it("B odgovor na vprasanje X gre samo v polje X: »Pokličite me jutri popoldne.« ni rok (S5)", async () => {
    const dir = await scratch();
    await lastnik(dir, { brezGlasu: true });
    const sid = novSid();
    const obrat = (text: string) => recordCaller({ callSid: sid, from: SKRITA, text }, dir);
    await obrat("");
    await obrat("Ana Primer.");
    await obrat("Mizo Alba iz hrasta.");
    const rok = await obrat("Dva kosa.");
    assert.deepEqual(kajVprasa(rok.reply), ["rok"]);
    const izid = await obrat("Pokličite me jutri popoldne.");
    assert.equal(izid.call.order.deadline ?? null, null);
    assert.match(izid.call.order.dosegljiv ?? "", /jutri popoldne/i);
    assert.deepEqual(kajVprasa(izid.reply), ["telefon"]);
    // Odgovor na vprasanje o telefonu ni rok in ni telefon.
    const telefon = await obrat("Jutri.");
    assert.equal(telefon.call.order.deadline ?? null, null);
    assert.doesNotMatch(telefon.call.order.phone, /\d/);
    assert.deepEqual(kajVprasa(telefon.reply), []);
    assert.ok(telefon.reply.endsWith(t("potrditevVprasanje")), telefon.reply);
    assert.equal(telefon.call.transcript.filter((v) => v.role === "lina" && /pokličemo nazaj/i.test(v.text)).length, 0);
    assert.equal(razberiRokOdgovora("Pokličite me jutri popoldne."), null);
    assert.equal(razberiRokOdgovora("Dosegljiv sem do petka."), null);
    assert.equal(razberiRokOdgovora("Do petka."), "petka");

    // »Ni pomembno« pri vprasanju o roku ni podatek o povratnem klicu.
    const drugi = novSid();
    const obrat2 = (text: string) => recordCaller({ callSid: drugi, from: SKRITA, text }, dir);
    await obrat2("");
    await obrat2("Ana Primer.");
    await obrat2("Mizo Alba iz hrasta.");
    await obrat2("Dva kosa.");
    const niPomembno = await obrat2("Ni pomembno.");
    assert.equal(niPomembno.call.order.dosegljiv ?? "", "");
    assert.equal(niPomembno.call.order.deadline ?? null, null);
  });

  it("B »ne vem«, »nimam« in molk gredo naprej; vprasanja se ne ponovijo; slovo z zahvalo", async () => {
    const dir = await scratch();
    await lastnik(dir, { brezGlasu: true });
    const stevec = modelStevec();
    const sid = novSid();
    const obrat = (text: string) => recordCaller({ callSid: sid, from: SKRITA, text }, dir, stevec.model);
    await obrat("");
    await obrat("Ana Primer.");
    const prvo = await obrat("Mizo Alba iz hrasta.");
    const klicev = stevec.stanje.klici;
    const odgovori = [prvo, await obrat("Ne vem."), await obrat("Nimam."), await obrat("")];
    assert.deepEqual(odgovori.map((izid) => kajVprasa(izid.reply)), [["kolicina"], ["rok"], ["telefon"], []]);
    // Brez opravicevanja in brez ponovitve vprasanja.
    for (const izid of odgovori.slice(1)) assert.doesNotMatch(izid.reply, /oprostite|nisem vas slišala/i);
    assert.ok(odgovori[3].reply.endsWith(t("potrditevVprasanje")), odgovori[3].reply);
    const konec = await obrat("Potrjujem.");
    assert.equal(konec.call.status, "zakljucen");
    assert.match(konec.reply, /Hvala za klic\. Lep dan\.$/);
    assert.equal(konec.call.order.email, t("niDan"));
    assert.equal(konec.call.order.deadline ?? null, null);
    assert.equal(stevec.stanje.klici, klicev);
    const lina = konec.call.transcript.filter((v) => v.role === "lina").map((v) => v.text);
    for (const [polje, vzorec] of VPRASANJA) assert.equal(lina.filter((stavek) => vzorec.test(stavek)).length, ["eposta", "dosegljiv"].includes(polje) ? 0 : 1, polje);
  });

  it("B kar je klicatelj ze povedal, Lina preskoci", async () => {
    const dir = await scratch();
    await lastnik(dir, { brezGlasu: true });
    const sid = novSid();
    const obrat = (text: string) => recordCaller({ callSid: sid, from: SKRITA, text }, dir);
    await obrat("");
    await obrat("Ana Primer.");
    const naprej = await obrat("Mizo Alba iz hrasta, rok do petka, moj telefon je 041 000 000.");
    assert.deepEqual(kajVprasa(naprej.reply), ["kolicina"]);
    const zadnje = await obrat("Dva kosa.");
    assert.deepEqual(kajVprasa(zadnje.reply), []);
    assert.ok(zadnje.reply.endsWith(t("potrditevVprasanje")), zadnje.reply);
    const lina = zadnje.call.transcript.filter((v) => v.role === "lina").map((v) => v.text).join(" ");
    assert.doesNotMatch(lina, /do kdaj potrebujete|telefonsko številko/i);
  });

  it("vodja 2: klic se ne zatakne pri izbiri izdelka - tocno zaporedje stavkov iz meritve", async () => {
    const dir = await scratch();
    await lastnik(dir, { brezGlasu: true });
    const stevec = modelStevec();
    const sid = novSid();
    const obrat = (text: string) => recordCaller({ callSid: sid, from: SKRITA, text }, dir, stevec.model);
    await obrat("");
    await obrat("Ana Primer, nisem iz podjetja.");
    const izdelek = await obrat("Zanima me miza iz hrasta, dolga dva metra.");
    assert.match(izdelek.reply, /Alba, Nara, Lira, Kaskada/);
    assert.equal(izdelek.call.order.povprasevanje, "Zanima me miza iz hrasta, dolga dva metra.");
    const poteki = [
      await obrat("Do petnajstega decembra."),
      await obrat("nič ena štiri nič, ena dva tri, štiri pet šest"),
      await obrat("Potrjujem."),
    ];
    // Vprasanje o izdelku samo enkrat; potek gre na telefon -> povzetek -> slovo.
    for (const izid of poteki) assert.doesNotMatch(izid.reply, /Kateri izdelek|Alba, Nara/);
    assert.deepEqual(poteki.map((izid) => kajVprasa(izid.reply)), [["telefon"], [], []]);
    assert.ok(poteki[1].reply.endsWith(t("potrditevVprasanje")), poteki[1].reply);
    const konec = poteki[2];
    assert.equal(konec.call.status, "zakljucen");
    assert.match(konec.reply, /Hvala za klic\. Lep dan\.$/);
    assert.equal(konec.call.order.deadline, "petnajstega decembra");
    assert.equal(konec.call.order.phone, "0140123456");
    assert.equal(konec.call.order.email, t("niDan"));
    assert.match(konec.call.povzetek?.zelel ?? "", /miza iz hrasta, dolga dva metra/);
    // Narekovana stevilka ni v prepisu pogovora.
    assert.doesNotMatch(konec.call.transcript.map((v) => v.text).join("\n"), /štiri pet šest|0140123456/);
    // »Ne, hvala.« po slovesu: klic je ze zakljucen, brez novega zapisa in brez modela.
    const klicev = stevec.stanje.klici;
    const poSlovesu = await obrat("Ne, hvala.");
    assert.equal(poSlovesu.nespremenjen, true);
    assert.equal(stevec.stanje.klici, klicev);
    assert.equal(stevec.stanje.klici, 0);

    // »Ne, hvala.« in »To je vse.« sredi zbiranja zakljucita s slovesom; izdelek ni vprasan drugic.
    for (const slovo of ["Ne, hvala.", "To je vse."]) {
      const drugi = novSid();
      const obrat2 = (text: string) => recordCaller({ callSid: drugi, from: SKRITA, text }, dir, stevec.model);
      await obrat2("");
      await obrat2("Ana Primer.");
      await obrat2("Zanima me miza iz hrasta, dolga dva metra.");
      const naprej = await obrat2("Ne vem.");
      assert.doesNotMatch(naprej.reply, /Kateri izdelek|Alba, Nara/);
      assert.deepEqual(kajVprasa(naprej.reply), ["rok"]);
      const zakljucek = await obrat2(slovo);
      assert.equal(zakljucek.call.status, "zakljucen", slovo);
      assert.match(zakljucek.reply, /Hvala za klic\. Lep dan\.$/);
    }
    assert.equal(wantsHangup("Ne, hvala."), true);
    assert.equal(wantsHangup("To je vse."), true);
    assert.equal(wantsHangup("Ne vem, hvala za vprašanje."), false);
  });

  it("vodja 3: narekovana telefonska stevilka z besedami; nerazumljen narek se zapise dobesedno", async () => {
    assert.equal(telefonIzBesed("nič eden štiri nič, ena dva tri, štiri pet šest"), "0140123456");
    assert.equal(telefonIzBesed("nic ena stiri nic ena dva tri stiri pet sest"), "0140123456");
    assert.equal(telefonIzBesed("plus tri osem šest štiri nič nič nič nič nič nič nič"), "+38640000000");
    assert.equal(telefonIzBesed("tri osem šest štiri nič nič nič nič nič nič nič"), "+38640000000");
    assert.equal(telefonIzBesed("nič štiri ena, 000 000"), "041000000");
    // Ni telefon: premalo stevk, kolicina, datum s pikami.
    assert.equal(telefonIzBesed("Rabim pet miz in dva stola."), null);
    assert.equal(telefonIzBesed("Rok do 01.12.2026"), null);
    assert.equal(telefonIzBesed("ena dva tri"), null);

    const dir = await scratch();
    await lastnik(dir, { brezGlasu: true });
    const sid = novSid();
    // Razred A (23. 11. 2026): telefon Lina vprasa samo pri skriti stevilki in za njim ne vprasa vec e-poste, ampak poda povzetek
    // (G4g, lastnik 11. 11. 2026, AGENTS.md »Potek konca klica (G4g)« in »Telefonska stevilka klicatelja«).
    const obrat = (text: string) => recordCaller({ callSid: sid, from: SKRITA, text }, dir);
    await obrat("");
    await obrat("Ana Primer.");
    await obrat("Mizo Alba iz hrasta.");
    await obrat("Dva kosa.");
    await obrat("Do petka.");
    const dobesedno = await obrat("nič štiri ena in potem še tri nule");
    assert.equal(dobesedno.call.order.phone, "nič štiri ena in potem še tri nule");
    assert.ok(dobesedno.reply.startsWith(t("povzetekUvod")), dobesedno.reply);
    assert.doesNotMatch(dobesedno.reply, /telefonsko/);
    assert.equal(dobesedno.call.transcript.filter((v) => v.role === "stranka").at(-1)?.text, "Podatek je v zapisniku.");
  });

  it("N8 ime: podjetje ali kraj ni ime osebe; ime je vprasano samo v pozdravu, brez odgovora »ni podatka«", async () => {
    const kraji = ["Obrtna ulica 9, Ljubljana"];
    const katalog = ["Alba", "jedilna miza", "Hrast"];
    const tabela: Array<[string, string | null, string | null]> = [
      // stavek, ime osebe, podjetje
      ["Slovenske Železnice.", null, "Slovenske Železnice"],
      ["Mizarstvo Kovač.", null, "Mizarstvo Kovač"],
      ["Nova Gorica.", null, null],
      ["Tukaj Mizarstvo Kovač.", null, "Mizarstvo Kovač"],
      ["Ana Primer d.o.o.", null, "Ana Primer doo"],
      ["Iva Primer s.p.", null, "Iva Primer sp"],
      ["Pekarna Primer.", null, "Pekarna Primer"],
      ["Zavarovalnica Primer, Ana Primer.", "Ana Primer", "Zavarovalnica Primer"],
      ["Murska Sobota.", null, null],
      ["Ljubljana Center.", null, "Ljubljana Center"],
      ["Ana Primer, nisem iz podjetja.", "Ana Primer", null],
      ["Da, Ana Primer.", "Ana Primer", null],
      ["Sem Ana Primer.", "Ana Primer", null],
      ["Frančiška Primer.", "Frančiška Primer", null],
      ["Kličem iz Nove Gorice, Ana Primer.", "Ana Primer", null],
    ];
    for (const [stavek, ime, podjetje] of tabela) {
      assert.equal(razberiIme(stavek, true, katalog, kraji), ime, `ime: ${stavek}`);
      assert.equal(goloPodjetje(stavek, katalog, kraji), podjetje, `podjetje: ${stavek}`);
    }
    assert.equal(vrstaImena("Obrtna", "Ljubljana", "", kraji), "kraj");
    assert.equal(vrstaImena("Ana", "Primer"), "oseba");

    const dir = await scratch();
    await lastnik(dir, { brezGlasu: true });
    for (const [stavek, podjetje] of [
      ["Slovenske Železnice.", "Slovenske Železnice"],
      ["Mizarstvo Kovač.", "Mizarstvo Kovač"],
      ["Nova Gorica.", ""],
    ] as const) {
      const sid = novSid();
      const obrat = (text: string) => recordCaller({ callSid: sid, from: OD, text }, dir);
      await obrat("");
      const ime = await obrat(stavek);
      assert.equal(ime.reply, t("kakoPomagam"), stavek);
      assert.equal(ime.call.order.customerName, t("niPodatka"), stavek);
      assert.equal(ime.call.order.podjetjeKlicatelja, podjetje, stavek);
      await obrat("Mizo Alba iz hrasta.");
      let izid = await obrat("Da.");
      for (let i = 0; i < 6 && izid.call.status === "v-teku"; i += 1) izid = await obrat("Ne vem.");
      assert.equal(izid.call.status, "zakljucen");
      const lina = izid.call.transcript.filter((v) => v.role === "lina").map((v) => v.text);
      // Ime je vprasano enkrat (v pozdravu) in nikoli vec.
      assert.equal(lina.filter((besedilo) => /ime in priimek|kako vam je ime/i.test(besedilo)).length, 1, stavek);
      assert.equal(izid.call.order.customerName, t("niPodatka"));
      assert.match(izid.call.povzetek?.kdo ?? "", /neznan klicatelj/);
    }
    // Ime, povedano pozneje, se vseeno zapise namesto »ni podatka«.
    const sid = novSid();
    await recordCaller({ callSid: sid, from: OD, text: "" }, dir);
    await recordCaller({ callSid: sid, text: "Dober dan." }, dir);
    const pozneje = await recordCaller({ callSid: sid, text: "Sem Ana Primer, zanima me miza Alba iz hrasta." }, dir);
    assert.equal(pozneje.call.order.customerName, "Ana Primer");
  });
});

describe("naloga G3 C: potrditev povprasevanja po e-posti", { concurrency: 1 }, () => {
  it("C izgovor e-naslova: afna, pika, vezaj, podcrtaj; preverba oblike", () => {
    const tabela: Array<[string, string]> = [
      ["info@primer.si", "info, afna, primer, pika, si"],
      ["ana.primer@primer-podjetje.si", "ana, pika, primer, afna, primer, vezaj, podjetje, pika, si"],
      // Razred A (23. 11. 2026): stevke se crkujejo (G4g, lastnik 11. 11. 2026, AGENTS.md »Potek konca klica (G4g)«, eposta.ts).
      ["Ponudbe_2026@Primer.SI", "ponudbe, podčrtaj, dva, nič, dva, šest, afna, primer, pika, si"],
      ["  info@primer.si  ", "info, afna, primer, pika, si"],
      ["a+b@primer.co.uk", "a, plus, be, afna, primer, pika, co, pika, uk"],
    ];
    for (const [naslov, izgovor] of tabela) {
      assert.equal(jeVeljavenEnaslov(naslov), true, naslov);
      assert.equal(izgovoriEnaslov(naslov), izgovor, naslov);
    }
    for (const slab of ["", "info", "info@", "@primer.si", "info@primer", "in fo@primer.si", "info@@primer.si", "info@primer..si", ".info@primer.si", "info@-primer.si", "info@primer.s", `${"a".repeat(130)}@primer.si`, "info@primer.si\nBcc: x@primer.si", "<info@primer.si>"]) {
      assert.equal(jeVeljavenEnaslov(slab), false, slab);
      assert.equal(izgovoriEnaslov(slab), "", slab);
    }
    assert.equal(stavekPotrditve({ potrditevEposta: false, potrditevNaslov: "info@primer.si" }), "");
    assert.equal(stavekPotrditve({ potrditevEposta: true, potrditevNaslov: "ni naslov" }), "");
    assert.equal(stavekPotrditve({ potrditevEposta: true, potrditevNaslov: "info@primer.si" }), `${t("potrditevProsim")} info, afna, primer, pika, si.`);
  });

  it("C nastavitev: privzeto izklopljeno, brez veljavnega naslova se ne vklopi", async () => {
    const dir = await scratch();
    const token = await lastnik(dir, { brezGlasu: true });
    const privzeta = await loadPravila(dir);
    assert.equal(privzeta.potrditevEposta, false);
    assert.equal(privzeta.potrditevNaslov, "");
    await assert.rejects(savePravila({ potrditevEposta: true }, token, dir), /e-naslov ni veljaven/);
    await assert.rejects(savePravila({ potrditevEposta: true, potrditevNaslov: "info@primer" }, token, dir), /e-naslov ni veljaven/);
    await assert.rejects(savePravila({ potrditevNaslov: "ni naslov" }, token, dir), /e-naslov ni veljaven/);
    assert.equal((await loadPravila(dir)).potrditevEposta, false);
    const shranjena = await savePravila({ potrditevEposta: true, potrditevNaslov: " Info@Primer.si " }, token, dir);
    assert.equal(shranjena.potrditevEposta, true);
    assert.equal(shranjena.potrditevNaslov, "info@primer.si");
    // Rocno pokvarjena datoteka nastavitev moznosti ne vklopi.
    await writeFile(path.join(dir, "pravila.json"), JSON.stringify({ potrditevEposta: true, potrditevNaslov: "pokvarjen" }));
    assert.equal((await loadPravila(dir)).potrditevEposta, false);
    await assert.rejects(savePravila({ potrditevEposta: true }, null, dir), LinaAuthError);
  });

  it("C stavek pride pred zahvalo in slovesom, najvec enkrat, z oznako v zapisu; izklopljeno ga ni", async () => {
    const dir = await scratch();
    const token = await lastnik(dir, { brezGlasu: true });
    const potek = async (sid: string) => {
      const obrat = (text: string) => recordCaller({ callSid: sid, from: OD, text }, dir);
      await obrat("");
      await obrat("Ana Primer.");
      // Razred A (23. 11. 2026): potek G4g (lastnik 11. 11. 2026): kolicina, rok, povzetek, potrditev; e-naslov podjetja Lina
      // izgovori PO potrditvi, pred stavkom o povratnem klicu in zahvalo (AGENTS.md »Potek konca klica (G4g)«).
      await obrat("Mizo Alba iz hrasta.");
      let izid = await obrat("Dva kosa.");
      for (const odgovor of ["Do petka.", "Da."]) izid = await obrat(odgovor);
      return izid;
    };
    const brez = await potek(novSid());
    assert.equal(brez.call.status, "zakljucen");
    assert.doesNotMatch(brez.call.transcript.map((v) => v.text).join(" "), /afna|potrditev/i);
    assert.equal(brez.call.order.potrditevEposta ?? false, false);

    await savePravila({ potrditevEposta: true, potrditevNaslov: "ponudbe@primer-podjetje.si" }, token, dir);
    const stavek = `${t("potrditevProsim")} ponudbe, afna, primer, vezaj, podjetje, pika, si.`;
    assert.ok(stalniStavki(await loadPravila(dir), "FORMA").includes(stavek));
    const s = await potek(novSid());
    assert.equal(s.call.status, "zakljucen");
    assert.equal(s.reply, `${stavek} ${t("povzetekStik")} ${t("slovo")} ${t("lepDan")}`);
    assert.ok(s.reply.indexOf(stavek) < s.reply.indexOf(t("slovo")));
    assert.equal(s.call.order.potrditevEposta, true);
    const lina = s.call.transcript.filter((v) => v.role === "lina").map((v) => v.text);
    assert.equal(lina.filter((besedilo) => besedilo.includes("afna")).length, 1);
    // Lina s tem narocila ne potrdi.
    assert.doesNotMatch(stavek, /potrjen|potrjujem/i);
    assert.match(t("potrditevOznaka"), /naprošen za potrditev po e-pošti/);

    // Slovo klicatelja sredi zbiranja: prosnja se vedno pred zahvalo, enkrat.
    const sid = novSid();
    const obrat = (text: string) => recordCaller({ callSid: sid, from: OD, text }, dir);
    await obrat("");
    await obrat("Ana Primer.");
    await obrat("Mizo Alba iz hrasta.");
    await obrat("Da.");
    const slovo = await obrat("To je vse, nasvidenje.");
    assert.equal(slovo.call.status, "zakljucen");
    assert.equal((slovo.reply.match(/afna/g) ?? []).length, 1);
    assert.ok(slovo.reply.indexOf("afna") < slovo.reply.indexOf(t("slovo")));
    // Brez povprasevanja Lina za potrditev ne prosi.
    const prazen = novSid();
    await recordCaller({ callSid: prazen, from: OD, text: "" }, dir);
    await recordCaller({ callSid: prazen, text: "Ana Primer." }, dir);
    const samoSlovo = await recordCaller({ callSid: prazen, text: "Nič, hvala, nasvidenje." }, dir);
    assert.equal(samoSlovo.call.status, "zakljucen");
    assert.doesNotMatch(samoSlovo.reply, /afna/);
  });
});

describe("naloga G3 D: vaja klica", { concurrency: 1 }, () => {
  const SCENARIJ = ["Ana Primer, nisem iz podjetja.", "Zanima me miza Alba iz hrasta.", "Potrjujem.", "Do petka.", "041 000 000", "ana@primer.si", "Jutri popoldne."];

  it("D vaja tece po isti kodi kot pravi klic: enaki odgovori, cas v ms, posnetki glasu, povzetek na koncu", async () => {
    const dir = await scratch();
    lazniGlas();
    const token = await lastnik(dir);
    await savePravila({ potrditevEposta: true, potrditevNaslov: "info@primer.si" }, token, dir);
    await pocakajGlas(dir);
    // Razred A (23. 11. 2026): vaja nima stevilke klicatelja, zato je enak pravi klic tisti s skrito stevilko (od 11. 11. 2026 Lina
    // telefon vprasa samo pri skriti stevilki); scenarij sledi poteku G4g (lastnik 11. 11. 2026: kolicina, rok, telefon, povzetek,
    // potrditev; e-poste in casa povratnega klica ne vprasa vec).
    const SCENARIJ = ["Ana Primer, nisem iz podjetja.", "Zanima me miza Alba iz hrasta.", "Dva kosa.", "Do petka.", "041 000 000", "Potrjujem."];
    // Pravi klic z istim scenarijem.
    const sid = novSid();
    const model = async (facts: string) => `Seveda. ${facts}`;
    const pravi = [(await recordCaller({ callSid: sid, from: "anonymous", text: "" }, dir, model)).reply];
    for (const stavek of SCENARIJ) pravi.push((await recordCaller({ callSid: sid, text: stavek }, dir, model)).reply);

    let tik = 1_000;
    const ura = () => {
      tik += 40;
      return tik;
    };
    const zacetek = await vajaKlica({}, { token }, dir, { model, ura });
    assert.match(zacetek.id, /^vaja-/);
    assert.equal(zacetek.vaja, true);
    assert.match(prviStavek(zacetek.reply), /umetno inteligenco/);
    const vaja = [zacetek];
    for (const stavek of SCENARIJ) vaja.push(await vajaKlica({ id: zacetek.id, text: stavek }, { token }, dir, { model, ura }));
    assert.deepEqual(vaja.map((izid) => izid.reply), pravi);
    for (const izid of vaja) {
      assert.ok(Number.isInteger(izid.ms) && izid.ms > 0, String(izid.ms));
      assert.ok(izid.msBesedila > 0 && izid.msBesedila <= izid.ms);
      // Naslov posnetka je javna pot zvoka; posnetek je berljiv.
      assert.ok(izid.zvok.length >= 1);
      for (const naslov of izid.zvok) {
        assert.match(naslov, /^\/api\/voice\/zvok\/[0-9a-f]{32}\.wav$/);
        assert.equal((await handleZvokRequest(new Request(`${IZVOR}${naslov}`), dir)).status, 200);
      }
    }
    const konec = vaja[vaja.length - 1];
    assert.equal(konec.koncano, true);
    assert.deepEqual(vaja.slice(0, -1).map((izid) => [izid.koncano, izid.zapis]), vaja.slice(0, -1).map(() => [false, null]));
    assert.deepEqual(
      { ...konec.zapis, povzetek: undefined },
      {
        ime: "Ana Primer",
        podjetje: t("niPodatka"),
        povprasevanje: "Alba, Hrast, 2 kos",
        rok: "petka",
        telefon: "041 000 000",
        eposta: t("niDan"),
        povratniKlic: t("niPodatka"),
        potrditevEposta: true,
        povzetek: undefined,
      },
    );
    assert.equal(konec.zapis?.povzetek.kdo, "Ana Primer");
    assert.equal(steviloVaj(), 0);
  });

  it("D vaja ne pusti sledi med klici, narocili in vrzelmi; zahteva prijavo in ni na javni poti", async () => {
    const dir = await scratch();
    const token = await lastnik(dir, { brezGlasu: true });
    const datotekePrej = (await readdir(dir)).sort();
    const stevec = modelStevec();
    const zacetek = await vajaKlica({}, { token }, dir, { model: stevec.model });
    for (const stavek of ["Ana Primer.", "Ali imate modro polico za hodnik?", "Zanima me miza Alba iz hrasta.", "Da.", "Do petka."]) {
      await vajaKlica({ id: zacetek.id, text: stavek }, { token }, dir, { model: stevec.model });
    }
    assert.equal(steviloVaj(), 1);
    // Predcasen konec vrne povzetek tega, kar bi Lina zapisala.
    const konec = await vajaKlica({ id: zacetek.id, konec: true }, { token }, dir);
    assert.equal(konec.koncano, true);
    assert.equal(konec.zapis?.ime, "Ana Primer");
    assert.equal(konec.zapis?.rok, "petka");
    assert.equal(konec.zapis?.telefon, t("niPodatka"));
    assert.equal(steviloVaj(), 0);
    // Na disku ni nicesar novega: ne klicev, ne vrzeli (»Manjka v znanju«), ne datoteke vaje.
    assert.deepEqual((await readdir(dir)).sort(), datotekePrej);
    await assert.rejects(stat(path.join(dir, "calls.json")));
    await assert.rejects(stat(path.join(dir, "vrzeli.json")));
    assert.deepEqual(await listCalls({ token }, dir), []);
    // Isti stavki v pravem klicu pustijo zapis in vrzel - razlika je samo oznaka vaje.
    const sid = novSid();
    await recordCaller({ callSid: sid, from: OD, text: "" }, dir);
    await recordCaller({ callSid: sid, text: "Ana Primer." }, dir);
    await recordCaller({ callSid: sid, text: "Ali imate modro polico za hodnik?" }, dir);
    assert.equal((await listCalls({ token }, dir)).length, 1);
    assert.match(await readFile(path.join(dir, "vrzeli.json"), "utf8"), /modro polico/);
    // Vaja istega CallSid ne vidi pravega klica in obratno.
    await assert.rejects(vajaKlica({ id: sid, text: "Dober dan." }, { token }, dir), /Vaja ni veljavna/);
    await assert.rejects(vajaKlica({ id: zacetek.id, text: "Dober dan." }, { token }, dir), /Vaja ni veljavna/);
    await assert.rejects(vajaKlica({ id: "../calls", text: "x" }, { token }, dir), /Vaja ni veljavna/);

    // Samo za prijavljenega uporabnika; javna pot /api/voice vaje ne pozna.
    await assert.rejects(vajaKlica({}, { token: null }, dir), LinaAuthError);
    await assert.rejects(vajaKlica({}, { token: "ponarejen-zeton" }, dir), LinaAuthError);
    process.env.TWILIO_AUTH_TOKEN = SKRIVNOST;
    const javno = await handleVoiceRequest(new Request(`${IZVOR}/api/voice/vaja`, { method: "POST", body: "id=vaja" }), dir);
    assert.equal(javno.status, 403);
    assert.equal((await handleVoiceGet(new Request(`${IZVOR}/api/voice/vaja`), dir)).status, 403);
    assert.equal((await listCalls({ token }, dir)).length, 1);
  });
});

describe("naloga G3 E in F: snemanje (priprava) in cas obrata", { concurrency: 1 }, () => {
  // Odlocitev lastnika 22. 11. 2026 (»Se strinjam«, »Se strinjam z predlogom«): snemanje v nacinu podjetje privzeto vklopljeno,
  // napoved z namenom in rokom, hramba posnetka 30 dni (1-90); osebni nacin nikoli ne snema. Prej (G3 E): stikalo zaklenjeno.
  it("E snemanje: v nacinu podjetje privzeto vklopljeno z napovedjo namena in roka; osebni nacin ne snema", async () => {
    const dir = await scratch();
    const token = await lastnik(dir, { brezGlasu: true });
    const privzeta = await loadPravila(dir);
    assert.equal(privzeta.snemanjeVklop, true);
    assert.equal(privzeta.snemanjeZavrnitev, false);
    assert.equal(privzeta.snemanjeHrambaDni, 30);
    const shranjena = await savePravila({ snemanjeZavrnitev: true, snemanjeHrambaDni: 14 }, token, dir);
    assert.equal(shranjena.snemanjeVklop, true);
    assert.equal(shranjena.snemanjeZavrnitev, true);
    assert.equal(shranjena.snemanjeHrambaDni, 14);
    assert.equal((await savePravila({ snemanjeHrambaDni: 900 }, token, dir)).snemanjeHrambaDni, 90);
    // Pozdrav napove snemanje, namen in rok iz nastavitve.
    await savePravila({ snemanjeHrambaDni: 21 }, token, dir);
    const pozdrav = await recordCaller({ callSid: novSid(), from: OD, text: "" }, dir);
    assert.match(pozdrav.reply, /snemam in zapisujem kot dokaz o naročilu/);
    assert.match(pozdrav.reply, /21 dni/);
    // Izklop: pozdrav snemanja ne omenja.
    assert.equal((await savePravila({ snemanjeVklop: false }, token, dir)).snemanjeVklop, false);
    const brez = await recordCaller({ callSid: novSid(), from: OD, text: "" }, dir);
    assert.doesNotMatch(brez.reply, /snema|posnet/i);
    // Razred A (23. 11. 2026): od G4a (krajsi pozdrav, 10. 11. 2026, naloga-g4a.test.ts) je to samostojen stavek »Pogovor zapisujem za naročilo.«.
    assert.match(brez.reply, /pogovor zapisujem/i);
    for (const stavek of stalniStavki(await loadPravila(dir), "FORMA")) assert.doesNotMatch(stavek, /snema|posnet/i, stavek);
    // Osebni nacin: rocno vklopljeno stikalo ne vklopi snemanja.
    await writeFile(path.join(dir, "pravila.json"), JSON.stringify({ nacinKlica: "osebna", snemanjeVklop: true }));
    assert.equal((await loadPravila(dir)).snemanjeVklop, false);
  });

  it("F cas obrata v ms je v zapisu klica brez vsebine; glas doda cas do pripravljenega posnetka", async () => {
    const dir = await scratch();
    lazniGlas();
    await lastnik(dir);
    const sid = novSid();
    let tik = 5_000;
    const ura = () => {
      tik += 25;
      return tik;
    };
    const prvi = await recordCaller({ callSid: sid, from: OD, text: "" }, dir, undefined, { ura });
    assert.equal(prvi.ms, 25);
    const drugi = await recordCaller({ callSid: sid, text: "Ana Primer." }, dir, undefined, { ura });
    assert.equal(drugi.ms, 25);
    const zapis = (await listCallsBrezSeje(dir))[sid];
    const lina = zapis.transcript.filter((v) => v.role === "lina");
    assert.deepEqual(lina.map((v) => v.ms), [25, 25]);
    for (const vrstica of zapis.transcript.filter((v) => v.role === "stranka")) assert.equal(vrstica.ms, undefined);

    // Po telefonu: zapis dobi se cas do pripravljenega glasu.
    const tel = novSid();
    let takt = 9_000;
    const uraKlica = () => {
      takt += 30;
      return takt;
    };
    await klic(dir, "/api/voice/incoming", { CallSid: tel, From: OD }, { ura: uraKlica });
    await klic(dir, "/api/voice/turn?obr=1", { CallSid: tel, From: OD, SpeechResult: "Ana Primer." }, { ura: uraKlica });
    await pocakajOzadjeKlicev();
    const poTelefonu = (await listCallsBrezSeje(dir))[tel].transcript.filter((v) => v.role === "lina");
    assert.equal(poTelefonu.length, 2);
    for (const vrstica of poTelefonu) {
      assert.equal(typeof vrstica.ms, "number");
      assert.ok((vrstica.glasMs ?? 0) > 0, JSON.stringify(vrstica));
      // Razred A (23. 11. 2026): merilnik verige (lastnik 14. 11. 2026, AGENTS.md »MERILNIK VERIGE«) doda polje merjenje - samo stevila.
      assert.deepEqual(Object.keys(vrstica).sort(), ["at", "glasMs", "merjenje", "ms", "role", "text"]);
      const merjenje = (vrstica as { merjenje?: { ms?: Record<string, unknown> } }).merjenje;
      assert.ok(Object.values(merjenje?.ms ?? {}).every((n) => typeof n === "number"), JSON.stringify(merjenje));
    }
  });
});

describe("naloga G3 meritve vodje: glas za odgovore modela", { concurrency: 1 }, () => {
  it("vodja 1a priprava stalnih stavkov: najvec dve sintezi hkrati, 429 se ponovi z narascajocim zamikom, noben stavek ne manjka", async () => {
    const dir = await scratch();
    const zamiki: number[] = [];
    nastaviUroGlasuZaPreizkus(null, async (ms) => {
      zamiki.push(ms);
    });
    // Trije stavki dobijo 429 dvakrat, nato uspejo.
    const glas = lazniGlas({ pade: /^(Kako vam lahko pomagam\?|Hvala za klic\.|Lep dan\.)$/, status: 429, padeKrat: 2, zberi: 3 });
    const token = await setupOwner("geslo-test-1234", dir);
    await publishLine({ open: true, catalog: formaCatalog() }, { token }, dir);
    await pocakajGlas(dir);
    assert.equal(SOCASNIH_PRIPRAV, 2);
    assert.ok(glas.najvecHkrati <= 2, `hkrati ${glas.najvecHkrati}`);
    assert.equal(glas.najvecHkrati, 2);
    const stanje = stanjeGlasu(dir);
    assert.equal(stanje.pripravljen, true);
    assert.equal(stanje.pripravljenih, stanje.vseh);
    assert.equal(stanje.razlog, "");
    // Sest ponovitev (3 stavki x 2), zamiki narascajo: 1 s, nato 2 s.
    assert.deepEqual([...zamiki].sort((a, b) => a - b), [1000, 1000, 1000, 2000, 2000, 2000]);
    assert.deepEqual(ZAMIKI_PRIPRAVE_MS, [1000, 2000, 4000, 8000, 16000]);
    assert.equal((await readLine({ token }, dir)).open, true);
    assert.deepEqual(await dnevnikGlasu(dir), []);
  });

  it("vodja 1b 429 pri pripravi ne izklopi glasu za odgovore: odgovor modela dobi <Play>; trajni 429 pusti zapis", async () => {
    const dir = await scratch();
    nastaviUroGlasuZaPreizkus(null, async () => undefined);
    const glas = lazniGlas({ pade: /Kako vam lahko pomagam/, status: 429 });
    const token = await setupOwner("geslo-test-1234", dir);
    await publishLine({ open: true, catalog: formaCatalog() }, { token }, dir);
    await pocakajGlas(dir);
    // Priprava ni uspela (trajni 429): razlog in stanje HTTP sta v dnevniku, linija caka.
    assert.equal(stanjeGlasu(dir).razlog, "glasOmejitev");
    assert.deepEqual((await dnevnikGlasu(dir)).map((z) => [z.razlog, z.status, z.kje]), [["glasOmejitev", 429, "priprava"]]);
    assert.equal(odklopnikOdprt(dir), false);
    await publishLine({ open: true, brezGlasu: true }, { token }, dir);
    await pocakajGlas(dir);
    const sid = novSid();
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: OD });
    await klic(dir, "/api/voice/turn?obr=1", { CallSid: sid, From: OD, SpeechResult: "Sem Ana Primer." });
    const sintez = glas.klici.length;
    // Razred A (23. 11. 2026): od G4a (lastnik 10. 11. 2026, service.server.ts »Model samo za vprasanja klicatelja«) narocilo iz
    // kataloga modela ne poklice; odgovor modela da vprasanje, na katero katalog ne odgovori.
    const odgovor = await klic(dir, "/api/voice/turn?obr=2", { CallSid: sid, From: OD, SpeechResult: "Kakšna je razlika med hrastom in jesenom?" }, { model: async (f) => `Seveda. ${f}` });
    // Dinamicni odgovor modela je sintetiziran in predvajan z Lininim glasom.
    assert.doesNotMatch(odgovor, /<Say/);
    assert.ok(predvajani(odgovor).length >= 1);
    assert.ok(glas.klici.slice(sintez).some((besedilo) => besedilo.startsWith("Seveda.")));
    assert.equal(odklopnikOdprt(dir), false);
  });

  it("vodja 1c vsak odgovor v <Say> pusti zapis z razlogom in stanjem HTTP, brez vsebine pogovora", async () => {
    const dir = await scratch();
    nastaviUroGlasuZaPreizkus(null, async () => undefined);
    lazniGlas({ pade: /Seveda/, status: 429 });
    await lastnik(dir);
    const model = async (f: string) => `Seveda. ${f}`;
    for (let i = 0; i < 2; i += 1) {
      ponastaviOdklopnik(dir);
      const sid = novSid();
      await klic(dir, "/api/voice/incoming", { CallSid: sid, From: OD });
      await klic(dir, "/api/voice/turn?obr=1", { CallSid: sid, From: OD, SpeechResult: "Sem Ana Primer." });
      // Razred A (23. 11. 2026): od G4a (lastnik 10. 11. 2026, service.server.ts »Model samo za vprasanja klicatelja«) narocilo iz
      // kataloga modela ne poklice; odgovor modela da vprasanje, na katero katalog ne odgovori.
      const odgovor = await klic(dir, "/api/voice/turn?obr=2", { CallSid: sid, From: OD, SpeechResult: "Kakšna je razlika med hrastom in jesenom?" }, { model });
      assert.match(odgovor, /<Say language="sl-SI">Seveda/);
      // Razred A (23. 11. 2026): en klic naenkrat (lastnik 11. 11. 2026, AGENTS.md »Socasnih klicev ne sprejemamo«): nezakljucen
      // klic bi naslednjemu dal »Linija je trenutno zasedena«.
      await klic(dir, "/api/voice/status", { CallSid: sid, CallStatus: "completed" });
    }
    const zapisi = await dnevnikGlasu(dir);
    // Dva odgovora v rezervi = dva zapisa (prej je isti razlog v 10 minutah ostal en sam).
    assert.deepEqual(zapisi.map((z) => [z.razlog, z.status, z.kje]), [
      ["glasOmejitev", 429, "odgovor"],
      ["glasOmejitev", 429, "odgovor"],
    ]);
    assert.doesNotMatch(JSON.stringify(zapisi), /Seveda|Alba|Primer|38640000000|CA-G3/);
  });

  it("vodja 1d odgovor caka ISTO sintezo: po vmesnem stavku se predvaja posnetek, sinteza ni zavrzena ali ponovljena", async () => {
    const dir = await scratch();
    const glas = lazniGlas({ visi: /Seveda/ });
    await lastnik(dir);
    const model = async (f: string) => `Seveda. ${f}`;
    const sid = novSid();
    const moznosti = { model, cakajMs: 5, cakajNaprejMs: 5_000 };
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: OD });
    await klic(dir, "/api/voice/turn?obr=1", { CallSid: sid, From: OD, SpeechResult: "Sem Ana Primer." });
    // Razred A (23. 11. 2026): od G4a (lastnik 10. 11. 2026, service.server.ts »Model samo za vprasanja klicatelja«) narocilo iz
    // kataloga modela ne poklice; odgovor modela da vprasanje, na katero katalog ne odgovori.
    const vmes = await klic(dir, "/api/voice/turn?obr=2", { CallSid: sid, From: OD, SpeechResult: "Kakšna je razlika med hrastom in jesenom?" }, moznosti);
    assert.match(vmes, /cak=1/);
    // Sinteza odgovora je zacela (tece mimo webhooka) in visi.
    // Cakamo na dogodek (zacetek sinteze), ne na cas: zanka se konca takoj, ko se zgodi.
    for (let i = 0; i < 2_000 && !glas.klici.some((besedilo) => besedilo.startsWith("Seveda.")); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(glas.klici.filter((besedilo) => besedilo.startsWith("Seveda.")).length, 1);
    const cakajoc = klic(dir, "/api/voice/turn?obr=2&cak=1", { CallSid: sid, From: OD }, moznosti);
    glas.spusti();
    const konec = await cakajoc;
    assert.doesNotMatch(konec, /<Say|Trenutek/);
    assert.ok(predvajani(konec).length >= 1);
    assert.equal(glas.klici.filter((besedilo) => besedilo.startsWith("Seveda.")).length, 1);
    assert.equal(odklopnikOdprt(dir), false);
    await pocakajOzadjeKlicev();
    // Posnetek odgovora je res nastal v mapi zvoka (meritev: stevilo datotek je ostalo 32).
    const imena = await readdir(mapaZvoka(dir));
    const stalnih = imena.filter((ime) => ime.endsWith(".stalno")).length;
    // Razred A (23. 11. 2026): nestalna sta dva posnetka - »Seveda.« (odgovor se razreze, prvi stavek posebej: G3c, meritev vodje
    // 10. 11. 2026; preostanek je stalni stavek iz kataloga, G4a) in predpripravljen »Ime je Ana Primer.« (G4b: material steje kot
    // povprasevanje, povzetek.ts imaPovprasevanje).
    assert.equal(imena.filter((ime) => ime.endsWith(".wav")).length, stalnih + 2);
  });

  it("priprava: ista mnozica se med klicem ne pripravlja znova, pripraviStalne z delno mnozico ne odznaci ostalih", async () => {
    const dir = await scratch();
    const glas = lazniGlas();
    await lastnik(dir);
    const sintez = glas.klici.length;
    const oznak = (await readdir(mapaZvoka(dir))).filter((ime) => ime.endsWith(".stalno")).length;
    // Razred A (23. 11. 2026): golega »linijaZaprta« ni vec med stalnimi; stavki, ki so lahko prvi v klicu, imajo razkritje UI
    // spredaj (lastnik 14. 11. 2026, AGENTS.md »Razkritje UI je TRDO pravilo«). Stavek iz iste mnozice je »kakoPomagam«.
    await pripraviStalne(dir, [t("kakoPomagam")], { odznaci: false });
    assert.equal((await readdir(mapaZvoka(dir))).filter((ime) => ime.endsWith(".stalno")).length, oznak);
    assert.equal(glas.klici.length, sintez);
  });
});
