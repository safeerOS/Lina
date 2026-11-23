/**
 * Naloga G3d. Po prvem pravem klicu lastnika (10. 11. 2026): »ko sem prenehal govoriti, je malo predolgo cakala«,
 * klic pa se je prekinil pri deseti zahtevi (meja preizkusnega racuna Twilio). Tisina po govoru v sekundah,
 * varovalka proti rezanju nedokoncanega izreka, manj zahtev na klic. Brez pravega omrezja; komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { formaCatalog } from "./catalog.ts";
import { nastaviSintezoZaPreizkus, pocakajDnevnikGlasu, pocakajGlas, ponastaviOdklopnik, ustaviCiscenjeZvoka } from "./glas.server.ts";
import { defaultPravila, loadPravila, savePravila } from "./pravila.server.ts";
import { pripraviGlasObZagonu } from "./service.server.ts";
import { writeJson } from "./store.server.ts";
import { CAKAJ_NADALJEVANJE_SEK, jeNedokoncan, tisinaIzNastavitve, tisinaPoGovoru, zdruziIzrek, type CakaPodatek } from "./tisina.ts";
import { handleVoiceRequest, pocakajOzadjeKlicev, steviloDelnihIzrekov, ustaviCiscenjeOpravil, type MoznostiKlica } from "./voice.server.ts";

process.env.LINA_LLM = "0";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-g3d-"));
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

async function odprtaLinija(pravila: Record<string, unknown> = {}): Promise<string> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  temps.push(dir);
  await writeJson(dir, "line.json", { open: true, catalog: formaCatalog(), updatedAt: null });
  await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi", ...pravila });
  return dir;
}

/** Lazni glas: vse je takoj pripravljeno, razen besedila, ki ustreza vzorcu in caka na spust. */
function lazniGlas(visi?: { vzorec: RegExp; caka: Promise<void> }): string[] {
  const klici: string[] = [];
  nastaviSintezoZaPreizkus(async (besedilo) => {
    klici.push(besedilo);
    if (visi?.vzorec.test(besedilo)) await visi.caka;
    return Buffer.alloc(4800);
  });
  return klici;
}

async function zGlasom(pravila: Record<string, unknown> = {}): Promise<string> {
  const dir = await odprtaLinija(pravila);
  await pripraviGlasObZagonu(dir);
  await pocakajGlas(dir);
  return dir;
}

const IZVOR = "https://lina.primer";
const SKRIVNOST = "twilio-zeton-preizkusa";
const OD = "+38640000000";
let zahtev = 0;

async function klic(dir: string, pot: string, params: Record<string, string>, moznosti: MoznostiKlica = {}): Promise<string> {
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
    undefined,
    moznosti,
  );
  assert.equal(odgovor.status, 200, pot);
  zahtev += 1;
  return odgovor.text();
}

function zbiranje(twiml: string): { tisina: string; timeout: string; action: string } | null {
  const m = /<Gather input="speech" language="sl-SI" speechTimeout="([^"]+)" timeout="(\d+)" method="POST" action="([^"]+)">/.exec(twiml);
  return m ? { tisina: m[1], timeout: m[2], action: m[3].replace(/&amp;/g, "&") } : null;
}

async function zapis(dir: string, sid: string): Promise<{ obrat: number; transcript: Array<{ role: string; text: string }>; order: Record<string, string> }> {
  return (JSON.parse(await readFile(path.join(dir, "calls.json"), "utf8")) as Record<string, never>)[sid];
}

describe("naloga G3d: tisina po govoru", { concurrency: 1 }, () => {
  it("tisinaPoGovoru: 1 s privzeto, sekunda vec za narekovan podatek, nastavitev 1-5", () => {
    const tabela: Array<[CakaPodatek, number | undefined, number]> = [
      [undefined, undefined, 1],
      ["rok", undefined, 1],
      ["dosegljiv", undefined, 1],
      ["ime", undefined, 2],
      ["telefon", undefined, 2],
      ["eposta", undefined, 2],
      [undefined, 3, 3],
      ["telefon", 3, 4],
      ["eposta", 5, 5],
      [undefined, 5, 5],
    ];
    for (const [caka, nastavitev, sekund] of tabela) assert.equal(tisinaPoGovoru(caka, { tisinaPoGovoruSek: nastavitev }), sekund, `${caka} ${nastavitev}`);
    // Twilio sprejme pozitivno celo stevilo: nastavitev je vedno celo stevilo v mejah.
    for (const [vhod, izhod] of [[0, 1], [-3, 1], [1.4, 1], [2.6, 3], [9, 5], ["4", 4], ["auto", 1], [null, 1], [Number.NaN, 1]] as const) {
      assert.equal(tisinaIzNastavitve(vhod), izhod, String(vhod));
    }
  });

  it("nastavitev v pravilih: privzeto 1, shrani 1-5, napacno vrednost zavrne z razlago", async () => {
    const dir = await odprtaLinija();
    const token = await setupOwner("geslo-test-1234", dir);
    assert.equal(defaultPravila().tisinaPoGovoruSek, 1);
    assert.equal((await loadPravila(dir)).tisinaPoGovoruSek, 1);
    assert.equal((await savePravila({ tisinaPoGovoruSek: 3 }, token, dir)).tisinaPoGovoruSek, 3);
    for (const slaba of [0, 6, 1.5, -1, Number.NaN, "auto" as unknown as number]) {
      await assert.rejects(savePravila({ tisinaPoGovoruSek: slaba }, token, dir), /celo število sekund od 1 do 5/, String(slaba));
    }
    assert.equal((await loadPravila(dir)).tisinaPoGovoruSek, 3);
    // Shranjevanje drugega polja tisine ne spremeni; rocno pokvarjena datoteka da vrednost v mejah.
    assert.equal((await savePravila({ pozdrav: "Lep pozdrav." }, token, dir)).tisinaPoGovoruSek, 3);
    await writeFile(path.join(dir, "pravila.json"), JSON.stringify({ tisinaPoGovoruSek: 60 }));
    assert.equal((await loadPravila(dir)).tisinaPoGovoruSek, 5);
  });

  it("Gather ima speechTimeout v sekundah (nikoli »auto«): 2 s za ime, telefon in e-posto, 1 s sicer", async () => {
    lazniGlas();
    const dir = await zGlasom();
    const sid = "CA-G3D-1";
    // Razred A (23. 11. 2026): potek konca klica G4g (lastnik 11. 11. 2026, AGENTS.md »Potek konca klica (G4g)« in »Telefonska
    // stevilka klicatelja«): Lina vprasa kolicino, rok in telefon SAMO ob skriti stevilki, potrditev je na koncu, e-poste
    // klicatelja in casa povratnega klica ne vprasa vec. Zato klic s skrito stevilko; 2 s za e-posto preverja tabela zgoraj.
    // Ta podrobni potek izbere LINA_PODROBNI_POTEK=1 (pravila.server.ts podrobniPotek); privzeti je kratek zakljucek (14. 11. 2026).
    const skrita = "anonymous";
    const koraki: Array<[string, string, string]> = [
      // izrek klicatelja, kaj Lina nato caka, pricakovana tisina
      ["", "ime in priimek", "2"],
      ["Ana Primer.", "kako lahko pomagam", "1"],
      ["Mizo Alba iz hrasta.", "kolicina", "1"],
      ["Pet.", "rok", "1"],
      ["Do petka.", "telefon", "2"],
      ["041 000 000", "potrditev", "1"],
    ];
    for (const [i, [izrek, kaj, tisina]] of koraki.entries()) {
      const twiml = i === 0 ? await klic(dir, "/api/voice/incoming", { CallSid: sid, From: skrita }) : await klic(dir, `/api/voice/turn?obr=${i}`, { CallSid: sid, From: skrita, SpeechResult: izrek });
      assert.doesNotMatch(twiml, /speechTimeout="auto"/);
      const zadnjaLina = (await zapis(dir, sid)).transcript.filter((v) => v.role !== "caller").slice(-1)[0]?.text ?? "";
      assert.equal(zbiranje(twiml)?.tisina, tisina, `${kaj} | Lina: ${zadnjaLina.slice(0, 300)}`);
      // timeout (cakanje na zacetek govora) ostane locen od tisine po govoru.
      assert.equal(zbiranje(twiml)?.timeout, "20", kaj);
    }
    // Nastavitev 3 s: 3 s sicer, 4 s za narekovan podatek.
    const drugi = await zGlasom({ tisinaPoGovoruSek: 3 });
    assert.equal(zbiranje(await klic(drugi, "/api/voice/incoming", { CallSid: "CA-G3D-1B", From: OD }))?.tisina, "4");
    assert.equal(zbiranje(await klic(drugi, "/api/voice/turn?obr=1", { CallSid: "CA-G3D-1B", From: OD, SpeechResult: "Ana Primer." }))?.tisina, "3");
  });
});

describe("naloga G3d: nedokoncan izrek", { concurrency: 1 }, () => {
  it("pravilo: tabela slovenskih izrekov", () => {
    const tabela: Array<[string, CakaPodatek, boolean]> = [
      ["Rada bi naročila mizo in", undefined, true],
      ["Zanima me miza iz hrasta,", undefined, true],
      ["Kličem, ker", undefined, true],
      ["Mizo ali", undefined, true],
      ["Hvala in", undefined, true],
      ["Rabim jo do", "rok", true],
      ["Pokličite me po", "dosegljiv", true],
      ["Zanima me, ali", undefined, true],
      ["Mizo bi rad za", undefined, true],
      ["Sem Ana Primer iz", "ime", true],
      ["Moje ime je", "ime", true],
      ["Moja številka je", "telefon", true],
      ["nič štiri ena", "telefon", true],
      ["041 22", "telefon", true],
      ["nič štiri ena,", "telefon", true],
      ["ana afna", "eposta", true],
      ["ana afna primer", "eposta", true],
      ["ana afna primer pika", "eposta", true],
      ["ana.primer@", "eposta", true],
      ["Moj naslov je", "eposta", true],
      ["Da.", undefined, false],
      ["Ne.", "telefon", false],
      ["Ne vem.", "telefon", false],
      ["Nimam.", "eposta", false],
      ["Telefona ne dam.", "telefon", false],
      // Zavrnitev je cel odgovor, tudi ce so v njej stevke.
      ["Številke ne vem na pamet, začne se z 041", "telefon", false],
      ["Tako je.", undefined, false],
      ["Strinjam se.", undefined, false],
      ["Rada bi naročila mizo iz hrasta, dolgo dva metra.", undefined, false],
      ["nič štiri ena, nič nič nič, nič nič nič", "telefon", false],
      ["041 000 000", "telefon", false],
      ["Pet miz.", undefined, false],
      ["ana afna primer pika si", "eposta", false],
      ["ana@primer.si", "eposta", false],
      ["Do petnajstega decembra.", "rok", false],
      ["Jutri popoldne.", "dosegljiv", false],
      ["Ana Primer.", "ime", false],
      ["Potrjujem.", undefined, false],
      ["To je vse.", undefined, false],
      ["", undefined, false],
    ];
    assert.ok(tabela.length >= 20);
    for (const [izrek, caka, nedokoncan] of tabela) assert.equal(jeNedokoncan(izrek, caka), nedokoncan, `${izrek} [${caka}]`);
    assert.equal(zdruziIzrek("Rada bi mizo in", "dva stola."), "Rada bi mizo in dva stola.");
    assert.equal(zdruziIzrek("nič štiri ena,", "nič nič nič nič nič nič"), "nič štiri ena, nič nič nič nič nič nič");
    assert.equal(zdruziIzrek("Mizo.", ""), "Mizo.");
    assert.equal(zdruziIzrek("", "Mizo."), "Mizo.");
  });

  it("Lina iz polovice ne sklepa: enkrat pocaka nadaljevanje brez govora in modela, nato obrat z zdruzenim izrekom", async () => {
    lazniGlas();
    const dir = await zGlasom();
    const sid = "CA-G3D-2";
    const modelVidel: string[] = [];
    const model = async (facts: string) => {
      modelVidel.push(facts);
      return facts;
    };
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: OD });
    await klic(dir, "/api/voice/turn?obr=1", { CallSid: sid, From: OD, SpeechResult: "Ana Primer." });
    const pred = await zapis(dir, sid);
    // Razred A (23. 11. 2026): od G4a (lastnik 10. 11. 2026, service.server.ts »Model samo za vprasanja klicatelja«) narocilo
    // modela ne poklice; zdruzeni izrek je zato vprasanje (»kako«), ki model poklice.
    const cakaj = await klic(dir, "/api/voice/turn?obr=2", { CallSid: sid, From: OD, SpeechResult: "Zanima me, kako se razlikujeta hrast in" }, { model });
    // Nov Gather brez Lininega govora; obrat ni zapisan, model ni klican.
    assert.doesNotMatch(cakaj, /<Play>|<Say|<Hangup/);
    assert.deepEqual(zbiranje(cakaj), { tisina: "2", timeout: String(CAKAJ_NADALJEVANJE_SEK), action: `${IZVOR}/api/voice/turn?obr=2&nad=1` });
    assert.match(cakaj, /<Redirect method="POST">https:\/\/lina\.primer\/api\/voice\/turn\?obr=2&amp;nad=1<\/Redirect>/);
    assert.equal(modelVidel.length, 0);
    assert.deepEqual(await zapis(dir, sid), pred);
    assert.equal(steviloDelnihIzrekov(), 1);
    // Nadaljevanje je spet nedokoncano: Lina ne caka drugic, vzame zdruzeni izrek.
    const odgovor = await klic(dir, "/api/voice/turn?obr=2&nad=1", { CallSid: sid, From: OD, SpeechResult: "jesen pri mizi Alba, ker" }, { model });
    assert.match(odgovor, /<Play>/);
    assert.doesNotMatch(odgovor, /[?;]nad=1/);
    assert.equal(modelVidel.length, 1);
    assert.match(modelVidel[0], /Alba iz materiala Hrast/);
    const po = await zapis(dir, sid);
    assert.equal(po.obrat, pred.obrat + 1);
    // Razred A (23. 11. 2026): skil lina-slovenski-klici, ZAPIS POGOVORA [PROGRAM] (AGENTS.md »PREPIS POGOVORA«, 14. 11. 2026):
    // vsak SpeechResult je svoja vrstica, nespremenjen, tudi odrezan del; odlocitev (model zgoraj) je na zdruzenem izreku.
    assert.deepEqual(
      po.transcript.filter((v) => v.role === "stranka").slice(-2).map((v) => v.text),
      ["Zanima me, kako se razlikujeta hrast in", "jesen pri mizi Alba, ker"],
    );
    assert.equal(steviloDelnihIzrekov(), 0);
  });

  it("narek telefona s premorom se zdruzi; molk po prvem delu vzame, kar je bilo slisano; konec klica pocisti", async () => {
    lazniGlas();
    const dir = await zGlasom();
    const sid = "CA-G3D-3";
    // Razred A (23. 11. 2026): potek konca klica G4g (lastnik 11. 11. 2026, AGENTS.md »Potek konca klica (G4g)« in »Telefonska
    // stevilka klicatelja«): telefon Lina vprasa samo ob skriti stevilki, e-poste klicatelja ne vprasa vec, po telefonu sledi
    // povzetek s potrditvijo. Molk po prvem delu zato preverjamo pri roku (pred telefonom), ne pri e-posti.
    const skrita = "anonymous";
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: skrita });
    const uvod = ["Ana Primer.", "Mizo Alba iz hrasta.", "Pet."];
    for (const [i, izrek] of uvod.entries()) await klic(dir, `/api/voice/turn?obr=${i + 1}`, { CallSid: sid, From: skrita, SpeechResult: izrek });
    // Rok brez konca, nato molk: Lina vzame slisano in gre naprej (nic ne ostane v pomnilniku).
    const rokCakaj = await klic(dir, "/api/voice/turn?obr=4", { CallSid: sid, From: skrita, SpeechResult: "Rabim jo do" });
    assert.equal(zbiranje(rokCakaj)?.action, `${IZVOR}/api/voice/turn?obr=4&nad=1`);
    assert.doesNotMatch(rokCakaj, /<Play>|<Say/);
    const poMolku = await klic(dir, "/api/voice/turn?obr=4&nad=1", { CallSid: sid, From: skrita });
    assert.match(poMolku, /<Play>/);
    assert.equal(steviloDelnihIzrekov(), 0);
    assert.equal((await zapis(dir, sid)).obrat, 5);
    // Lina caka telefon (2 s tisine); klicatelj po treh stevkah naredi premor.
    assert.equal(zbiranje(poMolku)?.tisina, "2");
    const cakaj = await klic(dir, "/api/voice/turn?obr=5", { CallSid: sid, From: skrita, SpeechResult: "nič štiri ena," });
    assert.equal(zbiranje(cakaj)?.action, `${IZVOR}/api/voice/turn?obr=5&nad=1`);
    assert.doesNotMatch(cakaj, /<Play>|<Say/);
    const naprej = await klic(dir, "/api/voice/turn?obr=5&nad=1", { CallSid: sid, From: skrita, SpeechResult: "nič nič nič, nič nič nič" });
    assert.equal((await zapis(dir, sid)).order.phone, "041000000");
    // Naslednje je povzetek s potrditvijo: tisina 1 s, obrat 6.
    assert.equal(zbiranje(naprej)?.tisina, "1");
    assert.equal(steviloDelnihIzrekov(), 0);
    assert.equal((await zapis(dir, sid)).obrat, 6);
    // Odlozen klic med cakanjem na nadaljevanje ne pusti delnega izreka.
    await klic(dir, "/api/voice/turn?obr=6", { CallSid: sid, From: skrita, SpeechResult: "Pokličite me po" });
    assert.equal(steviloDelnihIzrekov(), 1);
    await klic(dir, "/api/voice/status", { CallSid: sid, CallStatus: "completed" });
    assert.equal(steviloDelnihIzrekov(), 0);
  });
});

describe("naloga G3d: stevilo zahtev na klic", { concurrency: 1 }, () => {
  it("cel klic s pripravljenim glasom: ena zahteva na izrek, 9 zahtev skupaj (meja preizkusnega racuna je 10)", async () => {
    lazniGlas();
    const dir = await zGlasom();
    const sid = "CA-G3D-4";
    zahtev = 0;
    const izreki = ["Ana Primer.", "Zanima me miza Alba iz hrasta.", "Potrjujem.", "Do petnajstega decembra.", "nič štiri ena, nič nič nič, nič nič nič", "Ne vem.", "Jutri popoldne."];
    let twiml = await klic(dir, "/api/voice/incoming", { CallSid: sid, From: OD });
    for (const [i, izrek] of izreki.entries()) {
      // Vsak odgovor se konca z Gather: nobena zahteva ni samo vmesni skok.
      assert.ok(zbiranje(twiml), twiml);
      assert.doesNotMatch(twiml, /[?;](cak|nad|od)=/);
      twiml = await klic(dir, `/api/voice/turn?obr=${i + 1}`, { CallSid: sid, From: OD, SpeechResult: izrek }, { model: async (f) => `Seveda, zapisala sem vaše povpraševanje. ${f}` });
    }
    assert.match(twiml, /<Hangup\/>/);
    assert.equal(zahtev, 1 + izreki.length);
    assert.ok(zahtev <= 10);
  });

  it("odgovor modela po vmesnem stavku: zahteva pocaka cel odgovor - dve zahtevi, ne tri", async () => {
    let spusti: () => void = () => undefined;
    const caka = new Promise<void>((resolve) => {
      spusti = resolve;
    });
    zapore.push(() => spusti());
    // Razred A (23. 11. 2026): od G4a (lastnik 10. 11. 2026, service.server.ts »Model samo za vprasanja klicatelja«; brain.ts
    // stavkiIzKataloga) narocilo modela ne poklice in katalogni stavki so stalni posnetki. Model zato dobi vprasanje in vrne
    // dva lastna (nestalna) stavka, da sta oba kosa odgovora res v sintezi.
    const klici = lazniGlas({ vzorec: /Seveda|Oba materiala/, caka });
    const dir = await zGlasom();
    const sid = "CA-G3D-5";
    const model = async () => "Seveda, zapisala sem. Oba materiala sta primerna.";
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: OD });
    await klic(dir, "/api/voice/turn?obr=1", { CallSid: sid, From: OD, SpeechResult: "Ana Primer." });
    zahtev = 0;
    const vmes = await klic(dir, "/api/voice/turn?obr=2", { CallSid: sid, From: OD, SpeechResult: "Kakšna je razlika med hrastom in jesenom?" }, { model, cakajMs: 5 });
    assert.match(vmes, /cak=1<\/Redirect>/);
    // Oba kosa odgovora se sintetizirata; spustimo ju sele, ko druga zahteva ze caka.
    for (let i = 0; i < 3_000 && klici.filter((b) => /Seveda|Oba materiala/.test(b)).length < 2; i += 1) await new Promise((resolve) => setTimeout(resolve, 2));
    const druga = klic(dir, "/api/voice/turn?obr=2&cak=1", { CallSid: sid, From: OD }, { model, cakajNaprejMs: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 400));
    spusti();
    const konec = await druga;
    // Cel odgovor v eni zahtevi: dva posnetka in Gather, brez skoka po ostanek.
    assert.equal((konec.match(/<Play>/g) ?? []).length, 2);
    assert.doesNotMatch(konec, /[?;](od|cak)=|<Say/);
    assert.ok(zbiranje(konec));
    assert.equal(zahtev, 2);
  });
});
