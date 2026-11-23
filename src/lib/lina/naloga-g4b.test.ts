/**
 * Naloga G4b. Meritev vodje 10. 11. 2026 s pravim Googlom: obrat s povzetkom je trajal 11,9 s in 11,5 s z dvema
 * skokoma, ker se je cel povzetek sintetiziral sele po zadnjem podatku. Zdaj je povzetek po podatkih (kos na
 * podatek), kosi se sintetizirajo vnaprej, prvi <Play> gre takoj, brez »Trenutek, prosim.«, najvec en skok.
 * Brez pravega omrezja; komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { t } from "./besedila.ts";
import { formaCatalog } from "./catalog.ts";
import { kljucZvoka, razdeliZaGlas, stalniStavki } from "./glas.ts";
import {
  mapaZvoka,
  NapakaGlasu,
  nastaviSintezoZaPreizkus,
  odklopnikOdprt,
  pobrisiZvokKlica,
  pocakajDnevnikGlasu,
  pocakajGlas,
  ponastaviOdklopnik,
  solZvoka,
  ustaviCiscenjeZvoka,
} from "./glas.server.ts";
import { defaultPravila } from "./pravila.server.ts";
import { deliPovzetka, deliZaPredpripravo, jePovzetek, povzetekZaPotrditev } from "./povzetek.ts";
import { pripraviGlasObZagonu, recordCaller } from "./service.server.ts";
import { writeJson } from "./store.server.ts";
import { CAKAJ_POVZETEK_MS, handleVoiceRequest, pocakajOzadjeKlicev, ustaviCiscenjeOpravil } from "./voice.server.ts";

process.env.LINA_LLM = "0";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-g4b-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const temps: string[] = [];
const zapore: Array<() => void> = [];

afterEach(async () => {
  for (const spusti of zapore.splice(0)) spusti();
  await pocakajOzadjeKlicev();
  delete process.env.TWILIO_AUTH_TOKEN;
  nastaviSintezoZaPreizkus(null);
  ponastaviOdklopnik();
  ustaviCiscenjeOpravil();
  while (temps.length) {
    const dir = temps.pop();
    if (!dir) continue;
    await pocakajGlas(dir);
    await pocakajDnevnikGlasu(dir);
    ustaviCiscenjeZvoka(dir);
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

async function linija(): Promise<string> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  temps.push(dir);
  await writeJson(dir, "line.json", { open: true, catalog: formaCatalog(), updatedAt: null });
  await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi" });
  return dir;
}

async function zGlasom(): Promise<string> {
  const dir = await linija();
  await pripraviGlasObZagonu(dir);
  await pocakajGlas(dir);
  return dir;
}

const OD = "+38640000000";
const IZVOR = "https://lina.primer";
const SKRIVNOST = "twilio-zeton-preizkusa";
let zahtevkov = 0;

async function klic(dir: string, pot: string, params: Record<string, string>): Promise<string> {
  process.env.TWILIO_AUTH_TOKEN = SKRIVNOST;
  const signed = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], `${IZVOR}${pot}`);
  const odgovor = await handleVoiceRequest(
    new Request(`${IZVOR}${pot}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": createHmac("sha1", SKRIVNOST).update(signed).digest("base64") },
      body: new URLSearchParams(params).toString(),
    }),
    dir,
  );
  assert.equal(odgovor.status, 200, pot);
  zahtevkov += 1;
  return odgovor.text();
}

function predvajani(twiml: string): string[] {
  return [...twiml.matchAll(/<Play>[^<]*\/zvok\/([0-9a-f]{32})\.wav<\/Play>/g)].map((m) => m[1]);
}

/** Lazni glas: vse takoj, razen besedil, ki ustrezajo vzorcu in cakajo na spust; belezi tudi najvecjo socasnost. */
function lazniGlas(visi?: { vzorec: RegExp; caka: Promise<void> }, odpoved?: { vzorec: RegExp; status: number; krat: number }, zamikMs = 0) {
  const stanje = { klici: [] as string[], hkrati: 0, najvec: 0, padlo: 0 };
  nastaviSintezoZaPreizkus(async (besedilo) => {
    stanje.klici.push(besedilo);
    stanje.hkrati += 1;
    stanje.najvec = Math.max(stanje.najvec, stanje.hkrati);
    try {
      if (zamikMs > 0) await new Promise((resolve) => setTimeout(resolve, zamikMs));
      if (visi?.vzorec.test(besedilo)) await visi.caka;
      if (odpoved?.vzorec.test(besedilo) && stanje.padlo < odpoved.krat) {
        stanje.padlo += 1;
        throw new NapakaGlasu(odpoved.status === 429 ? "glasOmejitev" : "glasNapaka", odpoved.status);
      }
      return Buffer.alloc(4800);
    } finally {
      stanje.hkrati -= 1;
    }
  });
  return stanje;
}

function zapora(): { spusti: () => void; caka: Promise<void> } {
  let spusti: () => void = () => undefined;
  const caka = new Promise<void>((resolve) => {
    spusti = resolve;
  });
  zapore.push(() => spusti());
  return { spusti: () => spusti(), caka };
}

// Razred A (23. 11. 2026): po G4b so se potek in povzetek spremenili z odlocitvami lastnika (AGENTS.md »Pravi klici z
// lastnikom«, 10.-11. 11. 2026, in »Potek konca klica (G4g)«, 11. 11. 2026): stevilke klicatelja Lina ne bere (G4c),
// namesto oznak (»Rok: petka.«) so naravni stavki, izdelek, kolicina in rok so EN stavek narocila (G4e, povzetek.ts
// stavekNarocila), e-poste klicatelja in casa povratnega klica ne vprasa, telefon samo ob skriti stevilki. Pri vidni
// stevilki zato sledi povzetek takoj po roku; rok je podatek, ki ga klicatelj pove v obratu povzetka (prej povratni klic).
// Ta podrobni potek izbere LINA_PODROBNI_POTEK=1 (pravila.server.ts podrobniPotek); privzeti je kratek zakljucek (14. 11. 2026).
const IZREKI = ["Ana Primer.", "Mizo Alba iz hrasta, 2 kosa.", "Do petka.", "Da."];
/** Skrita stevilka: Lina vprasa se telefon, zato je med zbranim rokom in povzetkom en obrat vec (predpriprava). */
const SKRITA = "anonymous";
const IZREKI_SKRITA = ["Ana Primer.", "Mizo Alba iz hrasta, 2 kosa.", "Do petka.", "041 000 000", "Da."];
const UVOD = "Ponovim, kar sem razumela.";
const DELI = ["Naročate izdelek Alba iz materiala Hrast, v količini 2, rok pa je do petka.", "Ime je Ana Primer."];

describe("naloga G4b (1): povzetek po podatkih", { concurrency: 1 }, () => {
  it("deliPovzetka: kos na podatek (stavek narocila z rokom, ime); skupaj isto besedilo kot prej", async () => {
    const dir = await linija();
    const obrat = (text: string) => recordCaller({ callSid: "CA-G4B-1", from: OD, text }, dir);
    let izid = await obrat("");
    for (const izrek of IZREKI.slice(0, 3)) izid = await obrat(izrek);
    assert.deepEqual(deliPovzetka(izid.call), DELI);
    assert.equal(izid.reply, povzetekZaPotrditev(izid.call));
    assert.equal(izid.reply, `${UVOD} ${DELI.join(" ")} Ali potrjujete naročilo?`);
    assert.ok(jePovzetek(izid.reply));
    assert.ok(!jePovzetek("Zapisala sem Alba iz materiala Hrast."));
    // Naravni stavki, brez oznak, ki jih glas izgovori napacno (lastnik 11. 11. 2026), in brez telefonske stevilke (G4c).
    assert.doesNotMatch(izid.reply, /Rok:|Ime:|Telefon|0 4 1/);
  });

  it("razdeliZaGlas s posebnimi stavki: uvod, vsak podatek, vprasanje; brez njih ostane star razrez", () => {
    const stalni = stalniStavki(defaultPravila(), "FORMA", formaCatalog());
    const besedilo = `${UVOD} ${DELI.join(" ")} Ali potrjujete naročilo?`;
    assert.deepEqual(razdeliZaGlas(besedilo, stalni, undefined, DELI), [UVOD, ...DELI, "Ali potrjujete naročilo?"]);
    // Razred A (23. 11. 2026): posebnih kosov je zdaj 4 (uvod, stavek narocila, ime, vprasanje; glej DELI), prej 7, in star
    // razrez jih da prav tako 4, a z drugimi mejami (stavek narocila razreze pri vejici, ime zlepi).
    assert.deepEqual(razdeliZaGlas(besedilo, stalni), [
      UVOD,
      "Naročate izdelek Alba iz materiala Hrast,",
      "v količini 2, rok pa je do petka. Ime je Ana Primer.",
      "Ali potrjujete naročilo?",
    ]);
  });

  it("predpriprava velja samo za klic s povprasevanjem (samo ime se ne sintetizira vnaprej)", async () => {
    const dir = await linija();
    const obrat = (text: string) => recordCaller({ callSid: "CA-G4B-2", from: OD, text }, dir);
    await obrat("");
    const samoIme = await obrat("Ana Primer.");
    assert.deepEqual(deliPovzetka(samoIme.call), ["Ime je Ana Primer."]);
    assert.deepEqual(deliZaPredpripravo(samoIme.call), []);
    // Razred A (23. 11. 2026): G4e (povzetek.ts deliZaPredpripravo, 11. 11. 2026): stavek narocila se s podatki spreminja,
    // zato se pripravi sele z rokom; brez roka bi bila vsaka predpriprava zavrzena sinteza.
    const zIzdelkom = await obrat("Mizo Alba iz hrasta, 2 kosa.");
    assert.deepEqual(deliZaPredpripravo(zIzdelkom.call), ["Ime je Ana Primer."]);
    const zRokom = await obrat("Do petka.");
    assert.deepEqual(deliZaPredpripravo(zRokom.call), DELI);
  });
});

describe("naloga G4b (2): povzetek na koncu klica, prvi <Play> takoj, brez »Trenutek«, najvec en skok", { concurrency: 1 }, () => {
  it("zadnji podatek caka na sintezo: prvi odgovor v < 1 s predvaja uvod in pripravljene podatke, en <Redirect>, brez <Say>, <Pause> in »Trenutek«", async () => {
    // Razred A (23. 11. 2026): podatek iz obrata povzetka je rok, ki je v stavku narocila (G4e, G4g; glej IZREKI).
    const vrata = zapora();
    const glas = lazniGlas({ vzorec: /^Naročate/, caka: vrata.caka });
    const dir = await zGlasom();
    const sol = await solZvoka(dir);
    const sid = "CA-G4B-3";
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: OD });
    for (const [i, izrek] of IZREKI.slice(0, 2).entries()) await klic(dir, `/api/voice/turn?obr=${i + 1}`, { CallSid: sid, From: OD, SpeechResult: izrek });
    await pocakajOzadjeKlicev();
    // Do zadnjega podatka je vse ze sintetizirano (predpriprava); roka se ne ve.
    assert.ok(glas.klici.includes(DELI[1]), glas.klici.join(" | "));
    assert.ok(!glas.klici.some((del) => /^Naročate/.test(del)));

    zahtevkov = 0;
    const zacetek = Date.now();
    const prvi = await klic(dir, "/api/voice/turn?obr=3", { CallSid: sid, From: OD, SpeechResult: IZREKI[2] });
    const trajanje = Date.now() - zacetek;
    assert.ok(trajanje < 1_000, `prvi <Play> po ${trajanje} ms`);
    assert.ok(CAKAJ_POVZETEK_MS < 1_000);
    assert.deepEqual(predvajani(prvi), [kljucZvoka(sol, UVOD)]);
    assert.doesNotMatch(prvi, /<Say|<Pause|<Gather/);
    assert.equal((prvi.match(/<Redirect/g) ?? []).length, 1);
    assert.match(prvi, /<Redirect method="POST">[^<]*turn\?obr=3&amp;cak=1&amp;od=1<\/Redirect>/);
    assert.ok(!predvajani(prvi).includes(kljucZvoka(sol, t("trenutek"))));

    vrata.spusti();
    await pocakajOzadjeKlicev();
    const drugi = await klic(dir, "/api/voice/turn?obr=3&cak=1&od=1", { CallSid: sid, From: OD });
    assert.deepEqual(predvajani(drugi), [...DELI.map((del) => kljucZvoka(sol, del, undefined, undefined, sid)), kljucZvoka(sol, t("potrditevVprasanje"))]);
    assert.match(drugi, /<Gather [^>]*turn\?obr=4"/);
    assert.doesNotMatch(drugi, /<Say|[?&;](cak|od)=/);
    const zadnji = await klic(dir, "/api/voice/turn?obr=4", { CallSid: sid, From: OD, SpeechResult: IZREKI[3] });
    assert.match(zadnji, /<Hangup\/>/);
    // Pozdrav + 4 obrati + 1 skok = 6 zahtev (pod mejo 10 preizkusnega racuna Twilio); tu stejemo od obrata 3: 3.
    assert.equal(zahtevkov, 3);
  });

  it("vse pripravljeno: povzetek je ena zahteva, brez skoka; celoten klic 5 zahtev", async () => {
    const glas = lazniGlas();
    const dir = await zGlasom();
    const sid = "CA-G4B-4";
    zahtevkov = 0;
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: OD });
    for (const [i, izrek] of IZREKI.entries()) {
      const twiml = await klic(dir, `/api/voice/turn?obr=${i + 1}`, { CallSid: sid, From: OD, SpeechResult: izrek });
      if (i === 2) {
        assert.doesNotMatch(twiml, /[?&;](cak|od)=|<Say|<Pause/);
        assert.equal(predvajani(twiml).length, 4, "uvod, 2 podatka, vprasanje");
        assert.match(twiml, /<Gather /);
      }
    }
    // Razred A (23. 11. 2026): G4g (lastnik 11. 11. 2026) - brez vprasanj po telefonu (vidna stevilka), e-posti in povratnem klicu.
    assert.equal(zahtevkov, 5);
    assert.ok(glas.najvec <= 2, `socasnih sintez: ${glas.najvec}`);
  });

  it("predpriprava: ena sinteza naenkrat na klic (meja 429), vsak stavek povzetka natanko enkrat", async () => {
    const glas = lazniGlas(undefined, undefined, 15);
    const dir = await zGlasom();
    glas.najvec = 0;
    const sid = "CA-G4B-9";
    // Skrita stevilka (G4g): izdelek, kolicina in rok v enem izreku, zato sta stavek narocila in ime za predpripravo hkrati
    // (serializacija se res preveri); obrat s telefonom je nato povzetek, ki mora vzeti ze pripravljene posnetke.
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: SKRITA });
    for (const [i, izrek] of ["Ana Primer.", "Mizo Alba iz hrasta, 2 kosa, do petka.", "041 000 000"].entries()) {
      await klic(dir, `/api/voice/turn?obr=${i + 1}`, { CallSid: sid, From: SKRITA, SpeechResult: izrek });
      await pocakajOzadjeKlicev();
    }
    assert.equal(glas.najvec, 1, "predpriprava ne sme poslati vec sinteze hkrati");
    assert.deepEqual(
      glas.klici.filter((stavek) => DELI.includes(stavek)).sort(),
      [...DELI].sort(),
      "vsak stavek povzetka natanko enkrat, tudi ce se predpriprava ponovi v vsakem obratu",
    );
  });

  it("noben kos ni pripravljen (stalni stavki ne obstajajo): skok je tih, brez »Trenutek« in brez <Pause>", async () => {
    const vrata = zapora();
    lazniGlas({ vzorec: /./, caka: vrata.caka });
    const dir = await linija();
    const sid = "CA-G4B-5";
    const obrat = (text: string) => recordCaller({ callSid: sid, from: OD, text }, dir);
    await obrat("");
    for (const izrek of IZREKI.slice(0, 2)) await obrat(izrek);
    const tihi = await klic(dir, "/api/voice/turn?obr=3", { CallSid: sid, From: OD, SpeechResult: IZREKI[2] });
    assert.doesNotMatch(tihi, /<Pause|<Say|<Play>/);
    assert.match(tihi, /<Redirect method="POST">[^<]*cak=1<\/Redirect>/);
    vrata.spusti();
  });

  it("predpriprava ni v poti odgovora: pocasna sinteza podatka ne zadrzi obrata, ki jo sprozi", async () => {
    const vrata = zapora();
    lazniGlas({ vzorec: /^Ime je /, caka: vrata.caka });
    const dir = await zGlasom();
    const sid = "CA-G4B-6";
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: OD });
    await klic(dir, "/api/voice/turn?obr=1", { CallSid: sid, From: OD, SpeechResult: IZREKI[0] });
    const zacetek = Date.now();
    const odgovor = await klic(dir, "/api/voice/turn?obr=2", { CallSid: sid, From: OD, SpeechResult: IZREKI[1] });
    assert.ok(Date.now() - zacetek < 1_000);
    // Razred A (23. 11. 2026): odgovor je »Zapisala sem Alba iz materiala Hrast.« (stalni katalogni stavek, G4a 10. 11. 2026)
    // in vprasanje po roku (G4g 11. 11. 2026): cel odgovor sta dva posnetka.
    assert.equal(predvajani(odgovor).length, 2);
    vrata.spusti();
  });
});

describe("naloga G4b (3): 429, zasebnost", { concurrency: 1 }, () => {
  it("429 pri predpripravi: klic tece naprej brez rezerve <Say>, odklopnik ni sprozen, predpriprava se ponovi v naslednjem obratu", async () => {
    // Razred A (23. 11. 2026): ime je naravni stavek (»Ime je ...«, lastnik 11. 11. 2026); skrita stevilka da obrat vec pred
    // povzetkom (G4g), da se predpriprava lahko ponovi.
    const glas = lazniGlas(undefined, { vzorec: /^Ime je /, status: 429, krat: 2 });
    const dir = await zGlasom();
    const sid = "CA-G4B-7";
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: SKRITA });
    let vse = "";
    for (const [i, izrek] of IZREKI_SKRITA.entries()) {
      vse += await klic(dir, `/api/voice/turn?obr=${i + 1}`, { CallSid: sid, From: SKRITA, SpeechResult: izrek });
      await pocakajOzadjeKlicev();
    }
    assert.doesNotMatch(vse, /<Say/);
    assert.match(vse, /<Hangup\/>/);
    assert.equal(glas.padlo, 2);
    assert.equal(odklopnikOdprt(dir), false);
    // Ob napaki predpriprava preneha (ne zasipa ponudnika), naslednji obrat jo ponovi: ime je na koncu pripravljeno.
    assert.ok(glas.klici.filter((stavek) => /^Ime je /.test(stavek)).length >= 3);
  });

  it("zasebnost: stavki povzetka z imenom in telefonom so nestalni posnetki klica in gredo ob koncu klica", async () => {
    lazniGlas();
    const dir = await zGlasom();
    const sid = "CA-G4B-8";
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: OD });
    for (const [i, izrek] of IZREKI.slice(0, 3).entries()) await klic(dir, `/api/voice/turn?obr=${i + 1}`, { CallSid: sid, From: OD, SpeechResult: izrek });
    await pocakajOzadjeKlicev();
    const sol = await solZvoka(dir);
    const nestalni = DELI.map((del) => kljucZvoka(sol, del, undefined, undefined, sid));
    for (const kljuc of nestalni) assert.ok(existsSync(path.join(mapaZvoka(dir), `${kljuc}.wav`)), "posnetek obstaja med klicem");
    // Brez klica v kljucu (stalni stavek) posnetkov podatkov ni.
    for (const del of DELI) assert.ok(!existsSync(path.join(mapaZvoka(dir), `${kljucZvoka(sol, del)}.wav`)), del);
    const pobrisanih = await pobrisiZvokKlica(dir, sid);
    assert.ok(pobrisanih >= nestalni.length, String(pobrisanih));
    for (const kljuc of nestalni) assert.ok(!existsSync(path.join(mapaZvoka(dir), `${kljuc}.wav`)), "posnetek je pobrisan");
    // Stalni uvod ostane.
    assert.ok(existsSync(path.join(mapaZvoka(dir), `${kljucZvoka(sol, t("povzetekUvod"))}.wav`)));
  });
});
