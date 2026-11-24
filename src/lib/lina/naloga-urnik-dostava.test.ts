/**
 * Delovni cas prevezave (nacin podjetje) in navodilo za dostavo paketa (osebna tajnica), lastnik 23. 11. 2026 (AGENTS.md, »Preusmeritev med
 * klicem«). Brez omrezja: Twilio je nadomescen s podpisano zahtevo na webhook, ura je vbrizgana (`now`). Samo izmisljene stevilke in imena.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { en, sl, t } from "./besedila.ts";
import { formaCatalog } from "./catalog.ts";
import { stalniStavki } from "./glas.ts";
import { pocakajNujne, pravilaZaVmesnik, shraniNujne } from "./nujni.server.ts";
import { nastaviOgrevanjeZaPreizkus } from "./ogrevanje-klica.server.ts";
import { aktivnoNavodiloPaketa, jeDostava, jePredHiso, mestoPaketa, normirajPaket, odgovorDostavljalcu, PRED_HISO, razlogPaketa } from "./paket.ts";
import { defaultPravila, loadPravila, normalizePravila, savePravila } from "./pravila.server.ts";
import { preberiKlic, publishLine } from "./service.server.ts";
import { normirajUrnik, prevezavaIzvenCasa, razberiProsteDneve, razlogUrnika, slovenskiPrazniki, URNIK_PRIVZETO, vDelovnemCasu, velikaNoc } from "./urnik.ts";
import { razberiRazpone } from "./ure.ts";
import { handleVoiceRequest, pocakajOzadjeKlicev } from "./voice.server.ts";

process.env.LINA_LLM = "0";
nastaviOgrevanjeZaPreizkus(async () => undefined);

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-urnik-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const temps: string[] = [];

const OD = "+38640000000";
const LINA = "+38615550123";
const LASTNIK = "+38641000000";
/** Ponedeljek 23. 11. 2026 (23. 11. je praznik, ki NI dela prost). */
const PON_1530 = new Date("2026-11-23T15:30:00+01:00");
const TOR_1000 = new Date("2026-11-24T10:00:00+01:00");
const NAVODILO = "Pustite ga pri sosedu na št. 5.";

afterEach(async () => {
  delete process.env.TWILIO_AUTH_TOKEN;
  await pocakajNujne();
  await pocakajOzadjeKlicev();
  while (temps.length) {
    const dir = temps.pop();
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

async function linija(pravila: Record<string, unknown> = {}): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  temps.push(dir);
  const token = await setupOwner("geslo-test-1234", dir);
  await publishLine({ open: true, brezGlasu: true, catalog: formaCatalog() }, { token }, dir);
  await savePravila({ prevzem: "vsi", preusmeritev: LASTNIK, ...pravila }, token, dir);
  return { dir, token };
}

async function voice(dir: string, params: Record<string, string>, pot: string, now: Date): Promise<string> {
  const skrivnost = "twilio-zeton-preizkusa";
  process.env.TWILIO_AUTH_TOKEN = skrivnost;
  const url = `https://lina.primer${pot}`;
  const podpisano = Object.keys(params).sort().reduce((acc, kljuc) => acc + kljuc + params[kljuc], url);
  const podpis = createHmac("sha1", skrivnost).update(podpisano).digest("base64");
  const odgovor = await handleVoiceRequest(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": podpis },
      body: new URLSearchParams(params).toString(),
    }),
    dir,
    now,
  );
  return odgovor.text();
}

/** Podjetje: pozdrav, ime, nato izrek. Vrne TwiML zadnjega obrata. */
async function doZahteve(dir: string, sid: string, izrek: string, now: Date): Promise<string> {
  await voice(dir, { CallSid: sid, From: OD, To: LINA }, "/api/voice/incoming", now);
  await voice(dir, { CallSid: sid, From: OD, To: LINA, SpeechResult: "Ana Primer, nisem iz podjetja." }, "/api/voice/turn?obr=1", now);
  return voice(dir, { CallSid: sid, From: OD, To: LINA, SpeechResult: izrek }, "/api/voice/turn?obr=2", now);
}

/** Osebna: pozdrav in izreki po vrsti. Vrne TwiML vseh obratov. */
async function osebniKlic(dir: string, sid: string, izreki: string[], now = TOR_1000): Promise<string[]> {
  await voice(dir, { CallSid: sid, From: OD, To: LINA }, "/api/voice/incoming", now);
  const izhod: string[] = [];
  for (const izrek of izreki) {
    const o = (await preberiKlic(sid, dir))?.obrat ?? 1;
    izhod.push(await voice(dir, { CallSid: sid, From: OD, To: LINA, SpeechResult: izrek }, `/api/voice/turn?obr=${o}`, now));
  }
  return izhod;
}

const linaVrstice = async (sid: string, dir: string) => ((await preberiKlic(sid, dir))?.transcript ?? []).filter((v) => v.role === "lina").map((v) => v.text);

// ---------------------------------------------------------------------------------------------------------------------------
// A. Delovni cas prevezave
// ---------------------------------------------------------------------------------------------------------------------------

describe("urnik: velika noc in slovenski dela prosti dnevi (brez omrezja)", () => {
  it("velika noc za vec let (datumi iz Pythona z istim algoritmom in iz svetovalca; NI preverjeno proti uradnemu viru)", () => {
    const pricakovano: Record<number, [number, number]> = { 2019: [4, 21], 2024: [3, 31], 2025: [4, 20], 2026: [4, 5], 2027: [3, 28], 2028: [4, 16], 2038: [4, 25] };
    for (const [leto, md] of Object.entries(pricakovano)) assert.deepEqual(velikaNoc(Number(leto)), md, leto);
  });
  it("velikonocni ponedeljek, binkosti in stalni prazniki; 23. 11. (ni dela prost) ni na seznamu", () => {
    for (const d of ["2025-04-21", "2026-04-06", "2027-03-29", "2028-04-17"]) assert.ok(slovenskiPrazniki(Number(d.slice(0, 4))).includes(d), d);
    const p2026 = slovenskiPrazniki(2026);
    for (const d of ["2026-01-01", "2026-01-02", "2026-02-08", "2026-04-05", "2026-04-27", "2026-05-01", "2026-05-02", "2026-05-24", "2026-06-25", "2026-08-15", "2026-10-31", "2026-11-01", "2026-12-25", "2026-12-26"]) {
      assert.ok(p2026.includes(d), d);
    }
    assert.equal(p2026.length, 15);
    assert.ok(!p2026.includes("2026-11-23"));
  });
});

describe("urnik: delovni cas v Ljubljani (privzeto pon-pet 07:00-15:00)", () => {
  const v = (iso: string, p = {}) => vDelovnemCasu(p, new Date(iso));
  it("zima: 07:00 noter, 06:59 ven, 14:59 noter, 15:00 ven; sobota in nedelja ven", () => {
    assert.equal(v("2026-11-24T07:00:00+01:00"), true);
    assert.equal(v("2026-11-24T06:59:00+01:00"), false);
    assert.equal(v("2026-11-24T14:59:00+01:00"), true);
    assert.equal(v("2026-11-24T15:00:00+01:00"), false);
    assert.equal(v("2026-11-28T10:00:00+01:00"), false);
    assert.equal(v("2026-11-29T10:00:00+01:00"), false);
  });
  it("poletje (CEST): 07:00 po Ljubljani je 05:00 UTC; ura procesa ne vpliva", () => {
    assert.equal(v("2026-07-01T05:00:00Z"), true);
    assert.equal(v("2026-07-01T04:59:00Z"), false);
    assert.equal(v("2026-07-01T13:00:00Z"), false);
  });
  it("praznik (velikonocni ponedeljek, bozic) in prosti dan uporabnika: ves dan ven; 23. 11. (ni dela prost) noter", () => {
    assert.equal(v("2026-04-06T10:00:00+02:00"), false);
    assert.equal(v("2026-12-25T10:00:00+01:00"), false);
    assert.equal(v("2026-11-23T10:00:00+01:00"), true);
    assert.equal(v("2026-12-24T10:00:00+01:00", { prevezavaProstiDnevi: "2026-12-24, 2026-12-31" }), false);
    assert.equal(v("2026-12-23T10:00:00+01:00", { prevezavaProstiDnevi: "2026-12-24, 2026-12-31" }), true);
  });
  it("lasten urnik; nerazumljiv urnik ni nikoli delovni cas", () => {
    const p = { prevezavaUrnik: "pon-cet 8.00-16.00, pet 8.00-13.00" };
    assert.equal(v("2026-11-26T15:30:00+01:00", p), true);
    assert.equal(v("2026-11-27T13:30:00+01:00", p), false);
    assert.equal(v("2026-11-24T07:30:00+01:00", p), false);
    assert.equal(v("2026-11-24T10:00:00+01:00", { prevezavaUrnik: "vedno" }), false);
    assert.equal(v("2026-11-24T10:00:00+01:00", { prevezavaUrnik: "" }), true, "prazno = privzeto");
  });
  it("osebna tajnica in izklopljeno stikalo: omejitve ni", () => {
    assert.equal(prevezavaIzvenCasa({}, PON_1530), true);
    assert.equal(prevezavaIzvenCasa({}, TOR_1000), false);
    assert.equal(prevezavaIzvenCasa({ nacinKlica: "osebna" }, PON_1530), false);
    assert.equal(prevezavaIzvenCasa({ prevezavaUrnikVklop: false }, PON_1530), false);
  });
  it("prosti dnevi: samo veljavni datumi, urejeni, brez podvojenih", () => {
    assert.deepEqual(razberiProsteDneve("2026-12-31, 2026-12-24 2026-12-24"), { dnevi: ["2026-12-24", "2026-12-31"], napacni: [], prevec: false });
    assert.deepEqual(razberiProsteDneve("2026-02-30, 24.12.").napacni, ["2026-02-30", "24.12."]);
  });
});

describe("urnik: nastavitve (privzeto, shranjevanje, zavrnitev)", () => {
  it("privzeto vklopljeno s privzetim urnikom; izrecen false ostane", async () => {
    assert.equal(defaultPravila().prevezavaUrnikVklop, true);
    assert.equal(normalizePravila({}).prevezavaUrnikVklop, true);
    assert.equal(normalizePravila({ prevezavaUrnikVklop: false }).prevezavaUrnikVklop, false);
    assert.equal(URNIK_PRIVZETO, "pon-pet 07.00-15.00");
    const { dir } = await linija({ prevezavaUrnik: "pon-pet 8.00-16.00", prevezavaProstiDnevi: "2026-12-31,2026-12-24" });
    const p = await loadPravila(dir);
    assert.equal(p.prevezavaUrnik, "pon-pet 8.00-16.00");
    assert.equal(p.prevezavaProstiDnevi, "2026-12-24, 2026-12-31");
  });
  it("nerazumljiv urnik, napacen datum ali tip je zavrnjen z razlago", async () => {
    const { dir, token } = await linija();
    await assert.rejects(savePravila({ prevezavaUrnik: "od jutra do vecera" }, token, dir), new RegExp(t("prevezavaUrnikNeveljaven").slice(0, 30)));
    await assert.rejects(savePravila({ prevezavaProstiDnevi: "24. 12. 2026" }, token, dir), /LLLL-MM-DD/);
    await assert.rejects(savePravila({ prevezavaUrnikVklop: "ne" as never }, token, dir));
  });
});

describe("urnik: prevezava med klicem (Twilio Dial) samo v delovnem casu", { concurrency: 1 }, () => {
  it("zunaj urnika: prosnja po osebi brez Diala; Lina pove, da je zunaj delovnega casa, in vprasa po sporocilu; ni NUJNO, ni dogodka", async () => {
    const { dir } = await linija();
    const sid = "CA-URN-1";
    const twiml = await doZahteve(dir, sid, "Povežite me z vodjo.", PON_1530);
    assert.doesNotMatch(twiml, /<Dial/);
    assert.match(twiml, /zunaj delovnega časa/);
    assert.match(twiml, /Katero sporočilo želite pustiti\?/);
    const zapis = await preberiKlic(sid, dir);
    assert.notEqual(zapis?.order.tajnica?.nujno, true);
    assert.equal(zapis?.nujniDogodki, undefined);
    assert.equal(zapis?.cakaSporocilo, true);
    const dalje = await voice(dir, { CallSid: sid, From: OD, To: LINA, SpeechResult: "Povežite me z vodjo. Naj me poklice glede racuna." }, `/api/voice/turn?obr=${zapis?.obrat}`, PON_1530);
    assert.doesNotMatch(dalje, /<Dial|zunaj delovnega časa/, "najvec enkrat na klic");
    assert.match((await preberiKlic(sid, dir))?.order.tajnica?.sporocilo ?? "", /racuna/);
  });
  it("zunaj urnika: povedana nujnost ostane oznacena, brez Diala", async () => {
    const { dir } = await linija();
    const sid = "CA-URN-2";
    const twiml = await doZahteve(dir, sid, "Zelo nujno je, pokličite me takoj.", PON_1530);
    assert.doesNotMatch(twiml, /<Dial/);
    assert.match(twiml, /zunaj delovnega časa/);
    assert.match(twiml, /Zapisala sem, da je zadeva nujna\./);
    assert.equal((await preberiKlic(sid, dir))?.order.tajnica?.nujno, true);
  });
  it("praznik sredi delovnega casa (velikonocni ponedeljek 2026): brez Diala", async () => {
    const { dir } = await linija();
    const twiml = await doZahteve(dir, "CA-URN-3", "Povežite me z vodjo.", new Date("2026-04-06T10:00:00+02:00"));
    assert.doesNotMatch(twiml, /<Dial/);
    assert.match(twiml, /zunaj delovnega časa/);
  });
  it("v delovnem casu: Dial kot doslej (kontrola)", async () => {
    const { dir } = await linija();
    const twiml = await doZahteve(dir, "CA-URN-4", "Povežite me z vodjo.", TOR_1000);
    assert.match(twiml, /<Dial /);
    assert.doesNotMatch(twiml, /zunaj delovnega časa/);
  });
  it("stikalo urnika izklopljeno: Dial tudi zunaj urnika", async () => {
    const { dir } = await linija({ prevezavaUrnikVklop: false });
    const twiml = await doZahteve(dir, "CA-URN-5", "Povežite me z vodjo.", PON_1530);
    assert.match(twiml, /<Dial /);
  });
  it("osebna tajnica: omejitev ne velja (Dial zunaj urnika)", async () => {
    const { dir } = await linija({ nacinKlica: "osebna", imeLastnika: "Ana" });
    const [twiml] = await osebniKlic(dir, "CA-URN-6", ["A lahko govorim z njo?"], PON_1530);
    assert.match(twiml ?? "", /<Dial /);
  });
  it("nujni klic na osebni telefon (stikalo »Prevezi nujni klic name«): zunaj urnika brez Diala, nujnost oznacena", async () => {
    const { dir, token } = await linija({ prevezaNaZahtevo: false });
    await shraniNujne({ prevezi: true, stevilka: "+38641000001" }, token, dir);
    const zunaj = await doZahteve(dir, "CA-URN-7", "Zelo nujno je, pokličite me takoj.", PON_1530);
    assert.doesNotMatch(zunaj, /<Dial/);
    assert.match(zunaj, /zunaj delovnega časa/);
    assert.equal((await preberiKlic("CA-URN-7", dir))?.order.tajnica?.nujno, true);
    const drugi = await linija({ prevezaNaZahtevo: false });
    await shraniNujne({ prevezi: true, stevilka: "+38641000001" }, drugi.token, drugi.dir);
    const noter = await doZahteve(drugi.dir, "CA-URN-8", "Zelo nujno je, pokličite me takoj.", TOR_1000);
    assert.match(noter, /<Dial /, "kontrola: v delovnem casu Dial");
  });
  it("»Rad bi govoril z direktorjem« (ze sporocilo za direktorja): zunaj urnika brez Diala, obrat vprasa naslednje kot po neuspeli prevezavi", async () => {
    const { dir } = await linija();
    const twiml = await doZahteve(dir, "CA-URN-10", "Rad bi govoril z direktorjem.", PON_1530);
    assert.doesNotMatch(twiml, /<Dial/);
    assert.match(twiml, /zunaj delovnega časa, zato vas ne morem povezati\. Ali je zadeva nujna\?/);
  });
  it("brez cilja prevezave (ni stevilke): obstojeci potek, brez stavka o delovnem casu", async () => {
    const { dir } = await linija({ preusmeritev: "" });
    const twiml = await doZahteve(dir, "CA-URN-9", "Rad bi govoril z direktorjem.", PON_1530);
    assert.doesNotMatch(twiml, /zunaj delovnega časa|<Dial/);
  });
  it("stavek zunaj delovnega casa NI stalni stavek (preklop sloga glasu ostane)", () => {
    const p = normalizePravila({});
    assert.ok(!stalniStavki(p, "Podjetje").includes(t("prevezavaIzvenCasa")));
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// B. Dostava paketa (osebna tajnica)
// ---------------------------------------------------------------------------------------------------------------------------

describe("paket: zaznava dostave", () => {
  const DA = [
    "Dober dan, tukaj DPD, imam paket za vas.",
    "Tukaj Marko iz GLS.",
    "Kličem iz Pošte Slovenije.",
    "Sem s pošte, imam pošiljko za vas.",
    "Jaz sem kurir, kje vas najdem?",
    "Tukaj dostavljalec, paket je za vas.",
    "DHL, dober dan.",
    "Express One tukaj.",
    "InPost",
    "Dostava!",
    "Halo, kurir tukaj.",
    "Imam paket za gospo Novak.",
    "Dostavljam paket.",
    "Sem dostavljavec.",
    "Dober dan, UPS dostava.",
    "Kurirka GLS tukaj.",
    "tukaj ups imam paket",
    "DPD dostava.",
    "Dober dan, kurir DPD.",
    "Tukaj dostava.",
    "DPD, paket imam za vas.",
    "Pošta, paket za gospo Novak.",
  ];
  const NE = [
    "Poslal sem vam paket ponudb po pošti.",
    "Kličem glede paketa, ki sem ga naročil.",
    "Ups, napačna številka.",
    "Ups.",
    "Moja e-pošta je ana@primer.si.",
    "Sem ga dobil od DPD, pa je poškodovan.",
    "Račun sem poslal s pošto.",
    "Dostava paketa zamuja, prosim pokličite me.",
    "Ali je kurir že prišel?",
    "Kje naj pustim?",
    "Imam vprašanje glede paketa.",
    "Nisem dostavljalec, kličem zaradi računa.",
    "Ne kličem iz DPD, sem soseda.",
    "Rad bi govoril z Ano.",
    "DPD paket je izgubljen, kaj naj naredim?",
    "Ups, halo?",
    "Ups, dober dan.",
    "Ups, imam napačno številko.",
    "Jaz sem ga dobil od DPD.",
    "Tukaj Ana, paket od DPD še ni prišel.",
    "Pošta, dober dan, račun sem plačal.",
    "Sem ga dostavljal sosedu.",
    "Jaz sem ga dostavljal včeraj.",
    "Sem dostavljal paket sosedu, pa ga ni bilo doma.",
    "",
  ];
  it("predstavitev kot dostava", () => {
    for (const s of DA) assert.equal(jeDostava(s), true, s);
  });
  it("izreki o paketu ali posti, ki niso predstavitev, niso dostava", () => {
    for (const s of NE) assert.equal(jeDostava(s), false, s);
  });
});

describe("paket: navodilo (preverba, velja do, samo osebna)", () => {
  it("koda, geslo, PIN, stiri stevke in denar so zavrnjeni; »št. 5« je v redu; dolzina omejena", () => {
    assert.equal(razlogPaketa(NAVODILO), null);
    assert.equal(razlogPaketa("Koda vrat je 4821."), t("paketKoda"));
    assert.equal(razlogPaketa("Pustite v nabiralniku, geslo je sonce."), t("paketKoda"));
    assert.equal(razlogPaketa("PIN 1 2 3 4"), t("paketKoda"));
    assert.equal(razlogPaketa("Vrata odprete z 4821."), t("paketKoda"), "samo stevke");
    assert.equal(razlogPaketa("Odprite s 48-21."), t("paketKoda"), "stevke z locili");
    assert.equal(razlogPaketa("Pustite v nabiralniku, šifra je modra."), t("paketKoda"), "samo beseda");
    assert.ok(razlogPaketa("Plačilo 20 EUR ob prevzemu."));
    assert.equal(razlogPaketa("a".repeat(161)), t("paketDolzina"));
    assert.equal(normirajPaket("  pri sosedu\n na št. 5 "), "pri sosedu na št. 5.");
    // Polno polje brez locila: shranjeno ostane v meji (sicer ga razlogPaketa ob naslednjem shranjevanju zavrne).
    const polno = "a".repeat(160);
    assert.equal(normirajPaket(polno).length, 160);
    assert.equal(razlogPaketa(normirajPaket(polno)), null);
    for (const ok of ["Pustite ga pri sosedu Pintarju.", "Pri Šifrerjevih, hiša desno.", "Na Kodeljevem pri vratih.", "Doma sem do 16.30, prej pri sosedu."]) assert.equal(razlogPaketa(ok), null, ok);
  });
  it("velja samo v osebni tajnici, vkljucno z dnem »velja do« po Ljubljani; prazno = izklopljeno", () => {
    const p = { nacinKlica: "osebna", paketNavodilo: NAVODILO, paketDo: "2026-11-24" };
    assert.equal(aktivnoNavodiloPaketa(p, new Date("2026-11-24T23:30:00+01:00")), NAVODILO);
    assert.equal(aktivnoNavodiloPaketa(p, new Date("2026-11-25T00:10:00+01:00")), "");
    assert.equal(aktivnoNavodiloPaketa({ ...p, nacinKlica: "podjetje" }, TOR_1000), "");
    assert.equal(aktivnoNavodiloPaketa({ ...p, paketNavodilo: "" }, TOR_1000), "");
    assert.equal(aktivnoNavodiloPaketa({ ...p, paketNavodilo: "Koda je 4821." }, TOR_1000), "", "rocno popravljena datoteka");
  });
  it("»velja do« je strog koledarski datum (30. 2. ni datum)", () => {
    assert.equal(aktivnoNavodiloPaketa({ nacinKlica: "osebna", paketNavodilo: NAVODILO, paketDo: "2026-02-30" }, TOR_1000), "");
  });
  it("polno navodilo (160 znakov brez locila) se shrani, ostane aktivno in ne podre naslednjega shranjevanja", async () => {
    const { dir, token } = await linija({ nacinKlica: "osebna", imeLastnika: "Ana" });
    await savePravila({ paketNavodilo: "a".repeat(160) }, token, dir);
    await savePravila({ imeLastnika: "Ana Nova" }, token, dir);
    const p = await loadPravila(dir);
    assert.equal(aktivnoNavodiloPaketa(p, TOR_1000).length, 160);
  });
  it("shranjevanje zavrne kodo in napacen datum", async () => {
    const { dir, token } = await linija({ nacinKlica: "osebna", imeLastnika: "Ana" });
    await assert.rejects(savePravila({ paketNavodilo: "Koda je 4821." }, token, dir), /kode/);
    await assert.rejects(savePravila({ paketNavodilo: NAVODILO, paketDo: "jutri" }, token, dir), /Velja do/);
    await assert.rejects(savePravila({ paketNavodilo: NAVODILO, paketDo: "2026-02-30" }, token, dir), /Velja do/);
    await savePravila({ paketNavodilo: NAVODILO, paketDo: "2026-11-30" }, token, dir);
    const p = await loadPravila(dir);
    assert.equal(p.paketNavodilo, NAVODILO);
    assert.equal(p.paketDo, "2026-11-30");
  });
});

describe("paket: odgovor dostavljalcu (lastnik 24. 11. 2026)", () => {
  it("»Paket pričakujemo. Prosim, pustite ga <mesto>.« tudi iz starega celega stavka in iz »pred hišo«", () => {
    assert.equal(odgovorDostavljalcu(NAVODILO), "Paket pričakujemo. Prosim, pustite ga pri sosedu na št. 5.");
    assert.equal(odgovorDostavljalcu("pred hišo"), "Paket pričakujemo. Prosim, pustite ga pred hišo.");
    assert.equal(odgovorDostavljalcu(normirajPaket(PRED_HISO)), "Paket pričakujemo. Prosim, pustite ga pred hišo.");
    assert.equal(odgovorDostavljalcu("Naj ga pustijo v nabiralniku!"), "Paket pričakujemo. Prosim, pustite ga v nabiralniku.");
    assert.equal(odgovorDostavljalcu("Paket pustite pri sosedu Novaku."), "Paket pričakujemo. Prosim, pustite ga pri sosedu Novaku.");
    assert.equal(mestoPaketa("Pustite ga pri sosedu na št. 5."), "pri sosedu na št. 5");
    assert.ok(jePredHiso("pred hišo.") && jePredHiso("Pred hišo") && !jePredHiso("pri sosedu"));
  });
});

describe("paket: klic (osebna tajnica)", { concurrency: 1 }, () => {
  it("dostavljalec: Lina rece »Paket pričakujemo. Prosim, pustite ga <mesto>.« (BREZ imena lastnika, pregled 0.2.10 najdba 2); enkrat na klic (lastnik 24. 11.)", async () => {
    const { dir } = await linija({ nacinKlica: "osebna", imeLastnika: "Ana", paketNavodilo: NAVODILO });
    const sid = "CA-PAK-1";
    const [prvi, drugi] = await osebniKlic(dir, sid, ["Dober dan, tukaj DPD, imam paket za vas.", "Tukaj DPD, kje naj pustim?"]);
    assert.ok((prvi ?? "").includes("Paket pričakujemo. Prosim, pustite ga pri sosedu na št. 5."), prvi);
    assert.doesNotMatch(prvi ?? "", /ne more odgovoriti|Navodilo za dostavo|Pustite ga pri/, "stari odgovor ne ostane");
    assert.doesNotMatch(prvi ?? "", /Ana/, "kdorkoli rece »tukaj DPD«, ne izve imena lastnika");
    assert.doesNotMatch(drugi ?? "", /sosedu/, "najvec enkrat na klic");
    const zapis = await preberiKlic(sid, dir);
    assert.match(zapis?.order.tajnica?.sporocilo ?? "", /DPD/);
    assert.notEqual(zapis?.order.tajnica?.nujno, true);
    assert.equal(zapis?.paketPovedan, true);
  });
  it("navodilo nikoli v drugih klicih: pozdrav, nedostavni izreki in »Kje naj pustim?« ga nimajo", async () => {
    const { dir } = await linija({ nacinKlica: "osebna", imeLastnika: "Ana", paketNavodilo: NAVODILO });
    const sid = "CA-PAK-2";
    const twiml = await osebniKlic(dir, sid, ["Kje naj pustim?", "Poslal sem vam paket ponudb po pošti.", "Kličem glede paketa, ki sem ga naročil."]);
    for (const x of twiml) assert.doesNotMatch(x, /sosedu/);
    for (const vrstica of await linaVrstice(sid, dir)) assert.doesNotMatch(vrstica, /sosedu|Navodilo za dostavo/);
    const p = await loadPravila(dir);
    assert.ok(!stalniStavki(p, "").some((s) => s.includes("sosedu")), "ni v stalnih stavkih ali pozdravu");
  });
  it("nacin podjetje: navodilo se nikoli ne pove (tudi ce je v datoteki)", async () => {
    const { dir } = await linija({ paketNavodilo: NAVODILO });
    const twiml = await doZahteve(dir, "CA-PAK-3", "Dober dan, tukaj DPD, imam paket za vas.", TOR_1000);
    assert.doesNotMatch(twiml, /sosedu/);
    for (const vrstica of await linaVrstice("CA-PAK-3", dir)) assert.doesNotMatch(vrstica, /sosedu/);
  });
  it("brez navodila: dostavljalec dobi obicajen potek", async () => {
    const { dir } = await linija({ nacinKlica: "osebna", imeLastnika: "Ana" });
    const [twiml] = await osebniKlic(dir, "CA-PAK-4", ["Dober dan, tukaj DPD, imam paket za vas."]);
    assert.doesNotMatch(twiml ?? "", /Navodilo za dostavo/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Vmesnik (lina-desk.tsx) in besedila
// ---------------------------------------------------------------------------------------------------------------------------

describe("vmesnik: urnik pri prevezavi (podjetje) in navodilo za paket (osebna)", () => {
  const desk = readFileSync(new URL("../../components/lina-desk.tsx", import.meta.url), "utf8");
  it("urnik: stikalo, urnik in prosti dnevi samo v nacinu podjetje, ob stikalu prevezave", () => {
    const i = desk.indexOf('id="prevezava-urnik-vklop"');
    assert.ok(i > 0, "stikalo urnika");
    assert.ok(i > desk.indexOf('id="preveza-na-zahtevo"'), "ob stikalu prevezave");
    assert.match(desk.slice(i - 400, i), /\{pravila\.nacinKlica !== "osebna" \? \(\s*<fieldset/);
    const blok = desk.slice(i, i + 2500);
    for (const x of ['checked={pravila.prevezavaUrnikVklop !== false}', "prevezavaUrnik: event.target.value", "prevezavaProstiDnevi: event.target.value", 't("prevezavaUrnikNamig")', 'aria-describedby="prevezava-urnik-namig"']) {
      assert.ok(blok.includes(x), x);
    }
  });
  it("paket: polje, »velja do« in namig o kodah samo v osebnem bloku nastavitev", () => {
    const i = desk.indexOf('id="paket-navodilo"');
    const osebna = desk.lastIndexOf('{pravila.nacinKlica === "osebna" ? (', i);
    const konec = desk.indexOf('"pr-predpone": (');
    // Med zacetkom osebnega bloka in poljem se blok ne zapre (») : null}« na isti globini bi ga koncal pred poljem odsotnosti).
    assert.ok(desk.slice(osebna, i).includes('t("odsotnostNaslov")'), "v istem bloku kot odsotnost");
    assert.ok(osebna > 0 && i > osebna && i < konec, "v osebnem bloku");
    const blok = desk.slice(i - 1500, i + 1500);
    for (const x of ['aria-describedby="paket-namig"', 'value={pravila.paketNavodilo ?? ""}', "maxLength={160}", 't("paketNamig")', 'type="date"', "paketDo: event.target.value"]) assert.ok(blok.includes(x), x);
    // Lastnik 24. 11.: izbira »Pred hišo« (ena kljukica) ali »Drugo mesto« (besedilo), isto polje paketNavodilo.
    for (const x of ['id="paket-pred-hiso"', 'type="checkbox"', 't("paketPredHiso")', 't("paketDrugoMesto")', "jePredHiso("]) assert.ok(blok.includes(x), x);
  });
  it("besedila sl in en: vsi novi kljuci, namig opozori na kode", () => {
    for (const k of ["prevezavaIzvenCasa", "prevezavaUrnikVklop", "prevezavaUrnikNaslov", "prevezavaUrnikNamig", "prevezavaProstiNaslov", "prevezavaUrnikNeveljaven", "prevezavaProstiNeveljavni", "paketNaslov", "paketNamig", "paketDoNaslov", "paketOdgovor", "paketPredHiso", "paketDrugoMesto", "paketDolzina", "paketKoda", "paketDoNeveljaven"] as const) {
      assert.ok(sl[k]?.trim(), `sl ${k}`);
      assert.ok(en[k]?.trim(), `en ${k}`);
    }
    assert.match(sl.paketNamig, /kod/);
    assert.match(en.paketNamig, /code/);
  });
});

describe("pregled 0.2.10 (najdba 2): navodilo za dostavo slisi vsak, ki se predstavi kot dostava", () => {
  it("zavrne besede kljuc, odklenjen, odprt, koda, geslo (cele besede) in stevke z besedami", () => {
    for (const ne of [
      "Ključ je v nabiralniku.",
      "Ključa sta pod predpražnikom.",
      "Garaža je odklenjena.",
      "Vrata so odprta, pustite ga v veži.",
      "Vhodna koda je modra.",
      "Geslo je sonce.",
      "Vtipkajte štiri osem dva ena pri vratih.",
      "Pri vratih vtipkajte ena dva 3 4.",
    ]) {
      assert.equal(razlogPaketa(ne), t("paketKoda"), ne);
    }
  });
  it("poštna številka pred krajem je dovoljena; »vključno« in »zaključek« nista ključ; posamezne besede števil so v redu", () => {
    for (const ok of [
      "Pustite ga na Cesti 5, 1000 Ljubljana, pri sosedu.",
      "Pošta 2000 Maribor, okence 3.",
      "Velja vključno s petkom, pri sosedu.",
      "Po zaključku dela pri sosedu.",
      "Pustite ga pri sosedu na št. pet.",
      "Pri sosedu, dva paketa naenkrat.",
    ]) {
      assert.equal(razlogPaketa(ok), null, ok);
    }
  });
  it("prej shranjeno navodilo, ki je zdaj zavrnjeno, se ne pove in ne podre shranjevanja drugih nastavitev", async () => {
    const { dir, token } = await linija({ nacinKlica: "osebna", imeLastnika: "Ana", paketNavodilo: NAVODILO });
    const pot = path.join(dir, "pravila.json");
    const surovo = JSON.parse(readFileSync(pot, "utf8")) as Record<string, unknown>;
    await writeFile(pot, JSON.stringify({ ...surovo, paketNavodilo: "Ključ je pod predpražnikom." }));
    assert.equal(aktivnoNavodiloPaketa(await loadPravila(dir), TOR_1000), "");
    await savePravila({ imeLastnika: "Ana Nova" }, token, dir);
    assert.equal((await loadPravila(dir)).imeLastnika, "Ana Nova");
    // Nov vnos z isto vsebino pa je zavrnjen.
    await assert.rejects(savePravila({ paketNavodilo: "Ključ je v nabiralniku." }, token, dir), /kode/);
  });
  it("namig v vmesniku pove, da navodilo slisi vsak, ki se predstavi kot dostava, in nasteje prepovedano", () => {
    assert.match(sl.paketNamig, /vsak, ki se predstavi kot dostava/);
    assert.match(sl.paketNamig, /ključ/);
    assert.match(en.paketNamig, /Anyone who says they are a delivery/);
    assert.ok(sl.paketOdgovor.includes("{mesto}") && en.paketOdgovor.includes("{mesto}"));
    assert.doesNotMatch(sl.paketOdgovor, /\{kdo\}/);
  });
});

describe("pregled 0.2.10 (najdba 3): urnik velja tudi za nujnost; enkratno obvestilo po posodobitvi; stikalo tudi pri nujnih klicih", () => {
  /** Pravila iz izdaje pred urnikom: kljuca prevezavaUrnikVklop ni. */
  async function staraNamestitev(nujnaPrevezava: boolean): Promise<{ dir: string; token: string }> {
    const { dir, token } = await linija();
    if (nujnaPrevezava) await shraniNujne({ prevezi: true, stevilka: "+38631000000" }, token, dir);
    const pot = path.join(dir, "pravila.json");
    const surovo = JSON.parse(readFileSync(pot, "utf8")) as Record<string, unknown>;
    delete surovo.prevezavaUrnikVklop;
    delete surovo.urnikObvestilo;
    await writeFile(pot, JSON.stringify(surovo));
    return { dir, token };
  }

  it("stara namestitev z vklopljeno nujno prevezavo: obvestilo enkrat; drugo shranjevanje ga ne izbrise, potrditev ga", async () => {
    const { dir, token } = await staraNamestitev(true);
    assert.equal((await pravilaZaVmesnik(dir)).urnikObvestilo, true);
    await savePravila({ cakanjeSekund: 25 }, token, dir);
    assert.equal((await pravilaZaVmesnik(dir)).urnikObvestilo, true, "shranjevanje drugih nastavitev ne pomeni, da je obvestilo videl");
    await savePravila({ urnikObvestilo: false }, token, dir);
    assert.equal((await pravilaZaVmesnik(dir)).urnikObvestilo, false);
    // Urnik ostane vklopljen tudi za nujnost (zahteva lastnika).
    assert.equal((await loadPravila(dir)).prevezavaUrnikVklop, true);
  });

  it("brez nujne prevezave ali v novi namestitvi obvestila ni", async () => {
    assert.equal((await pravilaZaVmesnik((await staraNamestitev(false)).dir)).urnikObvestilo, false);
    const { dir, token } = await linija();
    await shraniNujne({ prevezi: true, stevilka: "+38631000000" }, token, dir);
    assert.equal((await pravilaZaVmesnik(dir)).urnikObvestilo, false);
  });

  it("vmesnik: obvestilo z gumbom, ki ga potrdi; stikalo urnika tudi v razdelku nujnih klicev; besedila sl in en", () => {
    const desk = readFileSync(new URL("../../components/lina-desk.tsx", import.meta.url), "utf8");
    const i = desk.indexOf('t("urnikObvestilo")');
    assert.ok(i > 0, "obvestilo");
    assert.ok(desk.slice(i - 600, i + 600).includes("urnikObvestilo: false"), "potrditev zapise false");
    const nujni = desk.slice(desk.indexOf('"zn-nujni": ('), desk.indexOf('"zn-avtonomija": ('));
    for (const x of ['id="prevezava-urnik-vklop-nujni"', "prevezavaUrnikVklop: event.target.checked", 't("prevezavaUrnikNujniNamig")', "onSaveRules"]) assert.ok(nujni.includes(x), x);
    for (const k of ["urnikObvestilo", "prevezavaUrnikNujniNamig"] as const) {
      assert.ok(sl[k]?.trim(), `sl ${k}`);
      assert.ok(en[k]?.trim(), `en ${k}`);
    }
  });
});

describe("pregled 0.2.10 (najdbi 8 in 14): prosti dnevi nad mejo in ista preverba urnika ob shranjevanju in v klicu", () => {
  it("vec kot 60 prostih dni: razberiProsteDneve javi prekoracitev, shranjevanje jo zavrne (ne zavrze tiho)", async () => {
    const dnevi = Array.from({ length: 61 }, (_, i) => new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10));
    assert.equal(razberiProsteDneve(dnevi.join(", ")).prevec, true);
    assert.equal(razberiProsteDneve(dnevi.slice(0, 60).join(", ")).prevec, false);
    const { token, dir } = await linija();
    await assert.rejects(savePravila({ prevezavaProstiDnevi: dnevi.join(", ") }, token, dir), new RegExp(t("prevezavaProstiPrevec").slice(0, 20)));
    await savePravila({ prevezavaProstiDnevi: dnevi.slice(0, 60).join(", ") }, token, dir);
    assert.equal((await loadPravila(dir)).prevezavaProstiDnevi?.split(", ").length, 60);
  });

  it("urnik se preveri v isti obliki, kot se shrani in uporabi v klicu (presledki ne vplivajo na mejo)", async () => {
    const urnik = `pon-cet${" ".repeat(40)}07.00-15.00,${" ".repeat(40)}pet${" ".repeat(20)}07.00-13.00`;
    assert.ok(urnik.length > 120);
    assert.equal(razlogUrnika(urnik), null);
    const { token, dir } = await linija();
    await savePravila({ prevezavaUrnik: urnik }, token, dir);
    const p = await loadPravila(dir);
    assert.equal(p.prevezavaUrnik, normirajUrnik(urnik));
    assert.equal(vDelovnemCasu(p, new Date("2026-11-27T12:00:00+01:00")), true, "petek 12.00");
    assert.equal(vDelovnemCasu(p, new Date("2026-11-27T14:00:00+01:00")), false, "petek 14.00");
    for (const x of ["pon-pet 07.00-15.00", "", "vsak dan", "pon-pet 15.00-07.00", "pon zaprto", "x".repeat(130)]) {
      const shranjen = normirajUrnik(x);
      assert.equal(razlogUrnika(x) === null, shranjen === "" || razberiRazpone(shranjen).length > 0, x);
    }
  });
});
