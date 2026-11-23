/**
 * Naloga G3c. Meritev vodje s pravim Googlom (10. 11. 2026): odgovor modela je bil pripravljen tik ob roku (5,7-6 s)
 * in je enkrat koncal v glasu posrednika, ki ga lastnik po telefonu ne razume. Trda meja obrata z drugim vmesnim
 * stavkom, predvajanje prvega stavka pred ostankom, ponovitev priprave po omejitvi 429.
 * Brez pravega omrezja; uro in premor vodi preizkus. Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { t } from "./besedila.ts";
import { formaCatalog } from "./catalog.ts";
import { kljucZvoka, razdeliZaGlas, stalniStavki } from "./glas.ts";
import {
  NapakaGlasu,
  NAJVEC_KROGOV_PRIPRAVE,
  nastaviSintezoZaPreizkus,
  nastaviUroGlasuZaPreizkus,
  odklopnikOdprt,
  pocakajDnevnikGlasu,
  pocakajGlas,
  ponastaviOdklopnik,
  PREMOR_OMEJITVE_MS,
  solZvoka,
  stanjeGlasu,
  ustaviCiscenjeZvoka,
  ZAMIKI_PRIPRAVE_MS,
} from "./glas.server.ts";
import { defaultPravila } from "./pravila.server.ts";
import { loadLine, pripraviGlasObZagonu } from "./service.server.ts";
import { writeJson } from "./store.server.ts";
import {
  CAKAJ_MS,
  CAKAJ_NAPREJ_MS,
  handleVoiceRequest,
  NAJVEC_CAKANJ,
  pocakajOzadjeKlicev,
  TRDA_MEJA_OBRATA_MS,
  ustaviCiscenjeOpravil,
  type MoznostiKlica,
} from "./voice.server.ts";

process.env.LINA_LLM = "0";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-g3c-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const temps: string[] = [];
const zapore: Array<() => void> = [];

afterEach(async () => {
  for (const spusti of zapore.splice(0)) spusti();
  await pocakajOzadjeKlicev();
  delete process.env.TWILIO_AUTH_TOKEN;
  nastaviSintezoZaPreizkus(null);
  nastaviUroGlasuZaPreizkus(null);
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

async function poZagonu(linija: { open: boolean; caka?: boolean } = { open: true }): Promise<string> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  temps.push(dir);
  await writeJson(dir, "line.json", { ...linija, catalog: formaCatalog(), updatedAt: null });
  await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi" });
  return dir;
}

type Zapora = { spusti: () => void; caka: Promise<void> };
function zapora(): Zapora {
  let spusti: () => void = () => undefined;
  const caka = new Promise<void>((resolve) => {
    spusti = resolve;
  });
  zapore.push(spusti);
  return { spusti, caka };
}

/** Lazni glas: besedilo, ki ustreza vzorcu, visi do spusta ali pade; ostalo je takoj pripravljeno. */
function lazniGlas(pravila: Array<{ vzorec: RegExp; visi?: Zapora; pade?: number; krat?: number }> = []) {
  const klici: string[] = [];
  const padci = new Map<string, number>();
  nastaviSintezoZaPreizkus(async (besedilo) => {
    klici.push(besedilo);
    for (const pravilo of pravila) {
      if (!pravilo.vzorec.test(besedilo)) continue;
      if (pravilo.pade) {
        const doslej = padci.get(besedilo) ?? 0;
        padci.set(besedilo, doslej + 1);
        if (doslej < (pravilo.krat ?? Number.POSITIVE_INFINITY)) throw new NapakaGlasu(pravilo.pade === 429 ? "glasOmejitev" : "glasNapaka", pravilo.pade);
      }
      if (pravilo.visi) await pravilo.visi.caka;
    }
    return Buffer.alloc(4800);
  });
  return klici;
}

const IZVOR = "https://lina.primer";
const SKRIVNOST = "twilio-zeton-preizkusa";
const OD = "+38640000000";
const PRVI = "Na voljo imamo hrastov les.";
const DRUGI = "Prosim, sporočite, kateri izmed modelov - Alba, Nara, Lira ali Kaskada - vas zanima.";
/** Odgovor modela iz meritve vodje. */
const model = async () => `${PRVI} ${DRUGI}`;

function zahteva(pot: string, params: Record<string, string>): Request {
  process.env.TWILIO_AUTH_TOKEN = SKRIVNOST;
  const signed = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], `${IZVOR}${pot}`);
  return new Request(`${IZVOR}${pot}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": createHmac("sha1", SKRIVNOST).update(signed).digest("base64") },
    body: new URLSearchParams(params).toString(),
  });
}

async function klic(dir: string, pot: string, params: Record<string, string>, moznosti: MoznostiKlica = {}): Promise<string> {
  const odgovor = await handleVoiceRequest(zahteva(pot, params), dir, undefined, moznosti);
  assert.equal(odgovor.status, 200, pot);
  return odgovor.text();
}

function predvajani(twiml: string): string[] {
  return [...twiml.matchAll(/<Play>[^<]*\/zvok\/([0-9a-f]{32})\.wav<\/Play>/g)].map((m) => m[1]);
}

async function dnevnik(dir: string): Promise<Array<{ razlog: string; kje?: string; status?: number }>> {
  await pocakajDnevnikGlasu(dir);
  return JSON.parse(await readFile(path.join(dir, "glas-dnevnik.json"), "utf8").catch(() => "[]"));
}

/** Klic do obrata z odgovorom modela; vrne TwiML prve zahteve tega obrata. */
async function doOdgovoraModela(dir: string, sid: string, moznosti: MoznostiKlica): Promise<string> {
  await pripraviGlasObZagonu(dir);
  await pocakajGlas(dir);
  await klic(dir, "/api/voice/incoming", { CallSid: sid, From: OD });
  await klic(dir, "/api/voice/turn?obr=1", { CallSid: sid, From: OD, SpeechResult: "Ana Primer." });
  // Razred A (23. 11. 2026): od G4a (lastnik 10. 11. 2026, AGENTS.md »Po drugem pravem klicu«; service.server.ts »Model samo
  // za vprasanja klicatelja«) narocilo iz kataloga modela ne poklice; model dobi samo vprasanje, na katero katalog ne odgovori.
  return klic(dir, "/api/voice/turn?obr=2", { CallSid: sid, From: OD, SpeechResult: "Kakšna je razlika med hrastom in jesenom?" }, moznosti);
}

async function dokler(pogoj: () => boolean): Promise<void> {
  // Cakamo na dogodek, ne na cas: zanka se konca takoj, ko se zgodi.
  for (let i = 0; i < 3_000 && !pogoj(); i += 1) await new Promise((resolve) => setTimeout(resolve, 2));
}

describe("naloga G3c: odgovor modela ne pade v glas posrednika", { concurrency: 1 }, () => {
  it("pocasna sinteza: »Trenutek«, nato »Še trenutek«, nato odgovor v Lininem glasu - brez <Say> do trde meje", async () => {
    const dir = await poZagonu();
    const visi = zapora();
    const klici = lazniGlas([{ vzorec: /hrastov les|sporočite/, visi }]);
    let zdaj = 1_800_000_000_000;
    const moznosti = { model, cakajMs: 5, cakajNaprejMs: 5, ura: () => zdaj };
    const sol = await solZvoka(dir);
    const prvi = await doOdgovoraModela(dir, "CA-G3C-1", moznosti);
    assert.deepEqual(predvajani(prvi), [kljucZvoka(sol, t("trenutek"))]);
    assert.match(prvi, /turn\?obr=2&amp;cak=1<\/Redirect>/);
    // Sinteza obeh kosov tece ze med vmesnim stavkom (zacne se takoj, ko je besedilo modela znano).
    await dokler(() => klici.includes(PRVI) && klici.includes(DRUGI));
    assert.ok(klici.includes(PRVI) && klici.includes(DRUGI));
    // 6 s po zacetku obrata (kot v meritvi): se en skok, ne rezerva.
    // Razred A (23. 11. 2026): lastnik 10. 11. 2026 (AGENTS.md »Po drugem pravem klicu«: »Trenutek, prosim.« najvec en vmesni
    // stavek na odgovor; voice.server.ts CAKAJ_MS in vmesniStavek: nadaljnji skoki so tihi). Drugi »Še trenutek« ne obstaja vec.
    zdaj += 6_000;
    const drugi = await klic(dir, "/api/voice/turn?obr=2&cak=1", { CallSid: "CA-G3C-1", From: OD }, moznosti);
    assert.doesNotMatch(drugi, /<Say/);
    assert.deepEqual(predvajani(drugi), []);
    assert.match(drugi, /turn\?obr=2&amp;cak=2<\/Redirect>/);
    assert.equal(odklopnikOdprt(dir), false);
    zdaj += 3_000;
    const cakajoc = klic(dir, "/api/voice/turn?obr=2&cak=2", { CallSid: "CA-G3C-1", From: OD }, { ...moznosti, cakajNaprejMs: 5_000 });
    visi.spusti();
    const konec = await cakajoc;
    assert.doesNotMatch(konec, /<Say|cak=/);
    assert.deepEqual(predvajani(konec), [kljucZvoka(sol, PRVI, undefined, undefined, "CA-G3C-1"), kljucZvoka(sol, DRUGI, undefined, undefined, "CA-G3C-1")]);
    assert.match(konec, /<Gather [^>]*turn\?obr=3"/);
    assert.deepEqual(await dnevnik(dir), []);
    // Vsak kos sintetiziran enkrat.
    assert.equal(klici.filter((besedilo) => besedilo === PRVI || besedilo === DRUGI).length, 2);
    // Vmesni stavek je stalen in v slogu: kratko, vikanje. Razred A (23. 11. 2026): drugega (»Še trenutek«) ni vec
    // (lastnik 10. 11. 2026, najvec en vmesni stavek na odgovor), zato ga tudi med stalnimi ni.
    const stalni = stalniStavki(defaultPravila(), "FORMA");
    assert.ok(stalni.includes("Trenutek, prosim.") && !stalni.includes("Še trenutek, prosim."));
  });

  it("trda meja: po 12 s rezerva in odklopnik; meje ene zahteve ostanejo pod 5 s in skokov najvec stiri", async () => {
    assert.equal(TRDA_MEJA_OBRATA_MS, 12_000);
    // Preizkusni racun Twilio caka na TwiML 5 s: vsako cakanje ene zahteve je krajse.
    assert.ok(CAKAJ_MS < 5_000 && CAKAJ_NAPREJ_MS < 5_000);
    assert.ok(CAKAJ_MS + 3 * CAKAJ_NAPREJ_MS >= TRDA_MEJA_OBRATA_MS);
    assert.equal(NAJVEC_CAKANJ, 4);
    const dir = await poZagonu();
    const visi = zapora();
    lazniGlas([{ vzorec: /hrastov les|sporočite/, visi }]);
    let zdaj = 1_800_000_000_000;
    const moznosti = { model, cakajMs: 5, cakajNaprejMs: 5, ura: () => zdaj };
    await doOdgovoraModela(dir, "CA-G3C-2", moznosti);
    zdaj += TRDA_MEJA_OBRATA_MS - 1;
    assert.match(await klic(dir, "/api/voice/turn?obr=2&cak=1", { CallSid: "CA-G3C-2", From: OD }, moznosti), /cak=2/);
    zdaj += 1;
    const rezerva = await klic(dir, "/api/voice/turn?obr=2&cak=2", { CallSid: "CA-G3C-2", From: OD }, moznosti);
    assert.match(rezerva, /<Say language="sl-SI">Na voljo imamo hrastov les\. Prosim, sporočite/);
    assert.doesNotMatch(rezerva, /cak=|<Play>/);
    assert.equal(odklopnikOdprt(dir), true);
    assert.deepEqual((await dnevnik(dir)).map((z) => [z.razlog, z.kje]), [["glasPrepozen", "odgovor"]]);

    // Tudi pod trdo mejo se veriga konca pri cetrtem skoku (omejitev skokov preizkusnega racuna).
    ponastaviOdklopnik();
    const drugi = await poZagonu();
    await doOdgovoraModela(drugi, "CA-G3C-2B", moznosti);
    for (let k = 1; k < NAJVEC_CAKANJ; k += 1) {
      assert.match(await klic(drugi, `/api/voice/turn?obr=2&cak=${k}`, { CallSid: "CA-G3C-2B", From: OD }, moznosti), new RegExp(`cak=${k + 1}<`));
    }
    const zadnji = await klic(drugi, `/api/voice/turn?obr=2&cak=${NAJVEC_CAKANJ}`, { CallSid: "CA-G3C-2B", From: OD }, moznosti);
    assert.match(zadnji, /<Say language="sl-SI">/);
    assert.doesNotMatch(zadnji, /cak=/);
    visi.spusti();
  });

  it("prvi stavek se predvaja takoj, ko je pripravljen; ostanek v naslednjem skoku - v vrstnem redu in brez podvajanja", async () => {
    const dir = await poZagonu();
    const visi = zapora();
    const klici = lazniGlas([{ vzorec: /sporočite/, visi }]);
    const moznosti = { model, cakajMs: 5_000, cakajNaprejMs: 5_000 };
    const sol = await solZvoka(dir);
    const kljucPrvi = kljucZvoka(sol, PRVI, undefined, undefined, "CA-G3C-3");
    const kljucDrugi = kljucZvoka(sol, DRUGI, undefined, undefined, "CA-G3C-3");
    const prvi = await doOdgovoraModela(dir, "CA-G3C-3", moznosti);
    // Brez vmesnega stavka: klicatelj ze slisi prvi stavek odgovora.
    assert.deepEqual(predvajani(prvi), [kljucPrvi]);
    assert.doesNotMatch(prvi, /<Say|<Gather/);
    assert.match(prvi, /<Redirect method="POST">https:\/\/lina\.primer\/api\/voice\/turn\?obr=2&amp;cak=1&amp;od=1<\/Redirect>/);
    const cakajoc = klic(dir, "/api/voice/turn?obr=2&cak=1&od=1", { CallSid: "CA-G3C-3", From: OD }, moznosti);
    visi.spusti();
    const drugi = await cakajoc;
    assert.deepEqual(predvajani(drugi), [kljucDrugi]);
    assert.doesNotMatch(drugi, /<Say|cak=/);
    assert.match(drugi, /<Gather [^>]*turn\?obr=3"/);
    // Ponovitev iste zahteve vrne isti TwiML; nic ni sintetizirano dvakrat.
    assert.equal(await klic(dir, "/api/voice/turn?obr=2&cak=1&od=1", { CallSid: "CA-G3C-3", From: OD }, moznosti), drugi);
    assert.equal(klici.filter((besedilo) => besedilo === PRVI).length, 1);
    assert.equal(klici.filter((besedilo) => besedilo === DRUGI).length, 1);
    assert.deepEqual(await dnevnik(dir), []);
    // Oba kosa hkrati pripravljena: en sam odgovor z obema posnetkoma, brez dodatnega skoka.
    const hitro = await poZagonu();
    lazniGlas();
    const cel = await doOdgovoraModela(hitro, "CA-G3C-3B", moznosti);
    assert.equal(predvajani(cel).length, 2);
    assert.match(cel, /<Gather [^>]*turn\?obr=3"/);
    assert.doesNotMatch(cel, /cak=/);
  });

  it("ostanek odpove: prvi stavek ostane v Lininem glasu, v rezervo gre samo preostanek, z zapisom razloga", async () => {
    const dir = await poZagonu();
    nastaviUroGlasuZaPreizkus(null, async () => undefined);
    lazniGlas([{ vzorec: /sporočite/, pade: 503 }]);
    const sol = await solZvoka(dir);
    const twiml = await doOdgovoraModela(dir, "CA-G3C-4", { model, cakajMs: 5_000 });
    assert.deepEqual(predvajani(twiml), [kljucZvoka(sol, PRVI, undefined, undefined, "CA-G3C-4")]);
    const receno = /<Say language="sl-SI">([^<]+)<\/Say>/.exec(twiml)?.[1] ?? "";
    assert.equal(receno, DRUGI);
    assert.ok(twiml.indexOf("<Play>") < twiml.indexOf("<Say"));
    assert.match(twiml, /<Gather [^>]*turn\?obr=3"/);
    assert.deepEqual((await dnevnik(dir)).map((z) => [z.razlog, z.status, z.kje]), [["glasNapaka", 503, "odgovor"]]);
    // Vrednost od cez konec odgovora ne ponovi nicesar.
    const cez = await klic(dir, "/api/voice/turn?obr=2&cak=1&od=50", { CallSid: "CA-G3C-4", From: OD });
    assert.doesNotMatch(cez, /<Play>|<Say/);
  });

  it("razrez odgovora: prvi stavek posebej, najvec dva kosa prostega besedila, datum in kratek uvod se ne locita", () => {
    const stalni = [t("hvalaStik"), t("prosiRok")];
    const tabela: Array<[string, string[]]> = [
      [`${PRVI} ${DRUGI}`, [PRVI, DRUGI]],
      ["Zapisala sem Alba do 15. decembra. Hvala. Do kdaj potrebujete izdelano naročilo?", ["Zapisala sem Alba do 15. decembra.", "Hvala.", "Do kdaj potrebujete izdelano naročilo?"]],
      ["Seveda. Zapisala sem Alba iz materiala Hrast. Če drži, recite: potrjujem.", ["Seveda. Zapisala sem Alba iz materiala Hrast.", "Če drži, recite: potrjujem."]],
      ["Delamo mize iz hrasta. Delamo tudi omare. Naredimo jih po meri.", ["Delamo mize iz hrasta.", "Delamo tudi omare. Naredimo jih po meri."]],
      ["Da. Ne.", ["Da. Ne."]],
      ["Delovni čas je pon-pet 8.00-16.00.", ["Delovni čas je pon-pet 8.00-16.00."]],
    ];
    for (const [besedilo, kosi] of tabela) {
      assert.deepEqual(razdeliZaGlas(besedilo, stalni), kosi, besedilo);
      assert.equal(razdeliZaGlas(besedilo, stalni).join(" "), besedilo);
    }
  });
});

describe("naloga G3c: priprava po omejitvi 429", { concurrency: 1 }, () => {
  it("stavek, ki dobi 429 dlje od zamikov, se po premoru pripravi znova do uspeha - brez nove zahteve", async () => {
    const dir = await poZagonu({ open: false, caka: true });
    const premori: number[] = [];
    nastaviUroGlasuZaPreizkus(null, async (ms) => {
      premori.push(ms);
    });
    // En stavek dobi 429 pri vseh poskusih prvega kroga in se pri dveh v drugem.
    const poskusovNaKrog = ZAMIKI_PRIPRAVE_MS.length + 1;
    const klici = lazniGlas([{ vzorec: /^Lep dan\.$/, pade: 429, krat: poskusovNaKrog + 2 }]);
    assert.equal(await pripraviGlasObZagonu(dir), "caka");
    await pocakajGlas(dir);
    const stanje = stanjeGlasu(dir);
    // Razred A (23. 11. 2026): stalnih stavkov nacina podjetja je vec (glas.ts stalniStavki: katalogni stavki G4a 10. 11. 2026,
    // nujni klici in kolicina v STALNE_BESEDE 10.-11. 11. 2026, pozdrav kot en kos in stavki z razkritjem ter kratek
    // zakljucek 14. 11. 2026); 26 je bilo stevilo ob nastanku preizkusa.
    assert.deepEqual(stanje, { pripravljen: true, vTeku: false, razlog: "", pripravljenih: 65, vseh: 65 });
    assert.equal(klici.filter((besedilo) => besedilo === "Lep dan.").length, poskusovNaKrog + 3);
    // Med krogoma je premor ene minute (kvota ponudnika je na minuto).
    assert.equal(PREMOR_OMEJITVE_MS, 60_000);
    assert.equal(premori.filter((ms) => ms === PREMOR_OMEJITVE_MS).length, 1);
    // Ostali stavki se ne sintetizirajo znova.
    assert.equal(klici.filter((besedilo) => besedilo === t("kakoPomagam")).length, 1);
    // En zapis o omejitvi, ne en na krog; linija, ki je cakala na glas, se je odprla.
    assert.deepEqual((await dnevnik(dir)).map((z) => [z.razlog, z.status, z.kje]), [["glasOmejitev", 429, "priprava"]]);
    assert.equal((await loadLine(dir)).open, true);
  });

  it("trajna omejitev se konca po dolocenem stevilu krogov z razlogom v stanju; druga napaka se ne ponavlja", async () => {
    const dir = await poZagonu();
    const premori: number[] = [];
    nastaviUroGlasuZaPreizkus(null, async (ms) => {
      premori.push(ms);
    });
    lazniGlas([{ vzorec: /^Lep dan\.$/, pade: 429 }]);
    await pripraviGlasObZagonu(dir);
    await pocakajGlas(dir);
    // Razred A (23. 11. 2026): stevilo stalnih stavkov je zraslo (glej zgoraj); pade natanko eden.
    assert.deepEqual(stanjeGlasu(dir), { pripravljen: false, vTeku: false, razlog: "glasOmejitev", pripravljenih: 64, vseh: 65 });
    assert.equal(premori.filter((ms) => ms === PREMOR_OMEJITVE_MS).length, NAJVEC_KROGOV_PRIPRAVE);
    assert.equal((await dnevnik(dir)).length, 1);

    const drugi = await poZagonu();
    premori.length = 0;
    const klici = lazniGlas([{ vzorec: /^Lep dan\.$/, pade: 503 }]);
    await pripraviGlasObZagonu(drugi);
    await pocakajGlas(drugi);
    assert.equal(stanjeGlasu(drugi).razlog, "glasNapaka");
    assert.equal(klici.filter((besedilo) => besedilo === "Lep dan.").length, 1);
    assert.equal(premori.filter((ms) => ms === PREMOR_OMEJITVE_MS).length, 0);
  });
});
