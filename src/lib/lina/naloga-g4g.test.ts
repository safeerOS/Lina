/**
 * Naloga G4g (lastnik 11. 11. 2026, po 5. pravem klicu): potek konca klica.
 * (1) klicatelj pove izdelek, KOLICINO in rok (lahko v enem stavku); Lina vprasa samo manjkajoce, vsako najvec enkrat;
 * (2) Lina ponovi, kaj je razumela, in prosi za potrditev; (3) PO potrditvi prosi, naj narocilo poslje se na e-naslov
 * podjetja (naslov izgovori), pove, da bomo poklicali, ce bomo potrebovali dodatne informacije, in se zahvali.
 * Klicateljeve e-poste in casa povratnega klica Lina ne sprasuje vec. Brez omrezja; samo izmisljeni podatki.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { t } from "./besedila.ts";
import { zajemiKolicino } from "./brain.ts";
import { formaCatalog } from "./catalog.ts";
import { izgovoriEnaslov, stavekPotrditve } from "./eposta.ts";
import { stalniStavki } from "./glas.ts";
import { loadPravila, savePravila } from "./pravila.server.ts";
import { govorjenRok, povzetekZaPotrditev } from "./povzetek.ts";
import { publishLine, recordCaller } from "./service.server.ts";
import { manjkajoci, prazenStik } from "./stik.ts";
import { handleVoiceRequest } from "./voice.server.ts";

process.env.LINA_LLM = "0";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-g4g-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const temps: string[] = [];

afterEach(async () => {
  delete process.env.TWILIO_AUTH_TOKEN;
  while (temps.length) {
    const dir = temps.pop();
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

async function linija(naslov = ""): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  temps.push(dir);
  const token = await setupOwner("geslo-test-1234", dir);
  await publishLine({ open: true, brezGlasu: true, catalog: formaCatalog() }, { token }, dir);
  await savePravila({ prevzem: "vsi", ...(naslov ? { potrditevNaslov: naslov } : {}) }, token, dir);
  return { dir, token };
}

const OD = "+38640000000";
let stevec = 0;
const novSid = () => `CA-G4G-${(stevec += 1)}`;

async function potek(dir: string, izreki: string[], od = OD) {
  const sid = novSid();
  const odgovori: Awaited<ReturnType<typeof recordCaller>>[] = [await recordCaller({ callSid: sid, from: od, text: "" }, dir)];
  for (const izrek of izreki) odgovori.push(await recordCaller({ callSid: sid, from: od, text: izrek }, dir));
  return odgovori;
}

const VPRASANJE_KOLICINA = /Koliko kosov potrebujete\?/;
const VPRASANJE_ROK = /Do kdaj potrebujete izdelano naročilo\?/;
const POVZETEK = /Ponovim, kar sem razumela\./;

describe("naloga G4g (1): kolicina in vse v enem stavku", { concurrency: 1 }, () => {
  it("vse v prvem stavku (ime v pozdravu, izdelek, kolicina, rok): Lina gre naravnost na ponovitev", async () => {
    const { dir } = await linija();
    const o = await potek(dir, ["Ana Primer, nisem iz podjetja.", "Rada bi naročila dve mizi Alba iz hrasta, rok do petka."]);
    const izid = o[2];
    assert.match(izid.reply, POVZETEK);
    assert.match(izid.reply, /Naročate izdelek Alba iz materiala Hrast, v količini 2, rok pa je do petka\./);
    assert.match(izid.reply, /Ali potrjujete naročilo\?$/);
    assert.doesNotMatch(izid.reply, /Koliko|Do kdaj|telefonsk|elektronsk|pokličemo/);
    assert.equal(izid.call.order.quantity, 2);
    assert.equal(izid.call.status, "v-teku");
  });

  it("manjka samo kolicina: Lina vprasa SAMO po kolicini, enkrat; z odgovorom sledi ponovitev", async () => {
    const { dir } = await linija();
    const o = await potek(dir, ["Ana Primer, nisem iz podjetja.", "Mizo Alba iz hrasta, rok do petka.", "Dve."]);
    assert.match(o[2].reply, VPRASANJE_KOLICINA);
    assert.doesNotMatch(o[2].reply, /Do kdaj|telefonsk|elektronsk/);
    assert.equal((o[2].reply.match(/\?/g) ?? []).length, 1);
    assert.equal(o[3].call.order.quantity, 2);
    assert.match(o[3].reply, POVZETEK);
    assert.match(o[3].reply, /v količini 2, rok pa je do petka/);
    assert.doesNotMatch(o[3].reply, VPRASANJE_KOLICINA);
  });

  it("manjkata kolicina in rok: ena stvar naenkrat, najprej kolicina, nato rok", async () => {
    const { dir } = await linija();
    const o = await potek(dir, ["Ana Primer, nisem iz podjetja.", "Mizo Alba iz hrasta.", "Pet kosov.", "Do petka."]);
    assert.match(o[2].reply, VPRASANJE_KOLICINA);
    assert.doesNotMatch(o[2].reply, VPRASANJE_ROK);
    assert.match(o[3].reply, VPRASANJE_ROK);
    assert.doesNotMatch(o[3].reply, VPRASANJE_KOLICINA);
    assert.equal(o[3].call.order.quantity, 5);
    assert.match(o[4].reply, POVZETEK);
    assert.match(o[4].reply, /v količini 5, rok pa je do petka/);
  });

  it("»ne vem« na vprasanje po kolicini: gre naprej, kolicine ne vprasa drugic", async () => {
    const { dir } = await linija();
    const o = await potek(dir, ["Ana Primer, nisem iz podjetja.", "Mizo Alba iz hrasta.", "Ne vem.", "Do petka."]);
    assert.match(o[2].reply, VPRASANJE_KOLICINA);
    assert.match(o[3].reply, VPRASANJE_ROK);
    assert.match(o[4].reply, POVZETEK);
    const lina = o[4].call.transcript.filter((v) => v.role === "lina").map((v) => v.text);
    assert.equal(lina.filter((besedilo) => VPRASANJE_KOLICINA.test(besedilo)).length, 1);
    assert.ok(!o[4].call.order.quantity);
  });

  it("prosto povprasevanje brez izdelka (»miza iz hrasta, dolga dva metra«) kolicine ne sprozi", async () => {
    const { dir } = await linija();
    const o = await potek(dir, ["Ana Primer, nisem iz podjetja.", "Zanima me miza iz hrasta, dolga dva metra.", "Ne vem."]);
    assert.doesNotMatch(o[2].reply, VPRASANJE_KOLICINA);
    assert.ok(!o[2].call.order.quantity);
    // Po vprasanju o izdelku gre naprej na rok, ne na kolicino.
    assert.doesNotMatch(o[3].reply, VPRASANJE_KOLICINA);
    assert.match(o[3].reply, VPRASANJE_ROK);
  });

  it("zajemiKolicino: stevilo z besedo pred izdelkom ali kot odgovor na vprasanje; mere, roki in telefon niso kolicina", () => {
    const k = formaCatalog();
    const tabela: Array<[string, boolean, number | null]> = [
      ["Dve mizi Alba iz hrasta.", false, 2],
      ["Rabim dva stola.", false, 2],
      ["Pet miz.", false, 5],
      ["Enaindvajset miz.", false, 21],
      ["Dve omari.", false, 2],
      ["Deset kosov.", false, 10],
      ["Mizo Alba, dolga dva metra.", false, null],
      ["Potrebujem jo v dveh tednih.", false, null],
      ["Do petnajstega decembra.", false, null],
      ["Mizo Alba iz hrasta.", false, null],
      // kot odgovor na »Koliko kosov potrebujete?«
      ["Dve.", true, 2],
      ["Dva kosa.", true, 2],
      ["Tri.", true, 3],
      ["Ne vem.", true, null],
      ["Sto dvajset.", true, null],
    ];
    for (const [izrek, vprasana, pricakovano] of tabela) assert.equal(zajemiKolicino(izrek, k, vprasana), pricakovano, izrek);
  });

  it("odgovor na vprasanje po kolicini je podatek: brez modela in brez novega povprasevanja", async () => {
    const { dir } = await linija();
    let klicev = 0;
    const model = async (facts: string) => {
      klicev += 1;
      return facts;
    };
    const sid = novSid();
    const obrat = (text: string) => recordCaller({ callSid: sid, from: OD, text }, dir, model);
    await obrat("");
    await obrat("Ana Primer, nisem iz podjetja.");
    const povprasevanje = await obrat("Mizo Alba iz hrasta, rok do petka.");
    assert.match(povprasevanje.reply, VPRASANJE_KOLICINA);
    const prej = povprasevanje.call.order.povprasevanje;
    const odgovor = await obrat("Dve.");
    assert.equal(klicev, 0, "odgovor na vprasanje po kolicini ne gre k modelu");
    assert.match(odgovor.reply, POVZETEK);
    assert.equal(odgovor.call.order.povprasevanje, prej);
  });

  it("odgovor na vprasanje po kolicini ni rok in ni nov zapis povprasevanja", async () => {
    const { dir } = await linija();
    const o = await potek(dir, ["Ana Primer, nisem iz podjetja.", "Mizo Alba iz hrasta.", "Do petka."]);
    // »Do petka.« je odgovor na vprasanje o kolicini: kolicine ni, roka tudi ne (odgovor velja samo za svoje polje).
    assert.match(o[2].reply, VPRASANJE_KOLICINA);
    assert.equal(o[3].call.order.deadline ?? null, null);
    assert.match(o[3].reply, VPRASANJE_ROK);
  });
});

describe("naloga G4g (2): konec klica po potrditvi", { concurrency: 1 }, () => {
  const NASLOV = "info@primer.si";
  const STAVEK_EPOSTE = `${t("potrditevProsim")} info, afna, primer, pika, si.`;

  it("e-posta podjetja je PO potrditvi (ne v povzetku): [naslov] [povratni klic] Hvala za klic. Lep dan.", async () => {
    const { dir } = await linija(NASLOV);
    assert.equal((await loadPravila(dir)).potrditevEposta, true, "vpis veljavnega naslova vklopi izgovor");
    const o = await potek(dir, ["Ana Primer, nisem iz podjetja.", "Dve mizi Alba iz hrasta, rok do petka.", "Da."]);
    const povzetek = o[2];
    assert.match(povzetek.reply, /Ali potrjujete naročilo\?$/);
    assert.doesNotMatch(povzetek.reply, /afna|elektronsk|poklicali/);
    assert.equal(povzetek.call.status, "v-teku");
    const konec = o[3];
    assert.equal(konec.call.status, "zakljucen");
    assert.equal(konec.reply, `${STAVEK_EPOSTE} ${t("povzetekStik")} ${t("slovo")} ${t("lepDan")}`);
    assert.equal(konec.reply, `Prosim, pošljite naročilo še po elektronski pošti na naslov info, afna, primer, pika, si. Če bomo potrebovali dodatne informacije, vas bomo poklicali na številko, s katere kličete. Hvala za klic. Lep dan.`);
    assert.equal(konec.call.order.confirmed, true);
    assert.equal(konec.call.order.potrditevEposta, true);
    // Naslov je izgovorjen najvec enkrat na klic.
    const lina = konec.call.transcript.filter((v) => v.role === "lina").map((v) => v.text);
    assert.equal(lina.filter((besedilo) => besedilo.includes("afna")).length, 1);
  });

  it("brez vpisanega naslova stavka ni; ostane stavek o povratnem klicu, zahvala in lep dan", async () => {
    const { dir } = await linija();
    assert.equal((await loadPravila(dir)).potrditevEposta, false);
    const o = await potek(dir, ["Ana Primer, nisem iz podjetja.", "Dve mizi Alba iz hrasta, rok do petka.", "Da."]);
    assert.equal(o[3].reply, `${t("povzetekStik")} ${t("slovo")} ${t("lepDan")}`);
    assert.doesNotMatch(o[3].reply, /afna|elektronsk/);
    assert.ok(!o[3].call.order.potrditevEposta);
  });

  it("stikalo za izklop ostane: naslov vpisan, izgovor izklopljen -> stavka ni", async () => {
    const { dir, token } = await linija(NASLOV);
    await savePravila({ potrditevEposta: false }, token, dir);
    const pravila = await loadPravila(dir);
    assert.equal(pravila.potrditevNaslov, NASLOV);
    assert.equal(pravila.potrditevEposta, false);
    assert.equal(stavekPotrditve(pravila), "");
    // Ponovni vpis istega naslova izrecnega izklopa ne razveljavi.
    await savePravila({ potrditevNaslov: NASLOV }, token, dir);
    assert.equal((await loadPravila(dir)).potrditevEposta, false);
    const o = await potek(dir, ["Ana Primer, nisem iz podjetja.", "Dve mizi Alba iz hrasta, rok do petka.", "Da."]);
    assert.doesNotMatch(o[3].reply, /afna/);
  });

  it("prvi veljavni vpis naslova vklopi izgovor tudi pri naknadnem vpisu; neveljaven naslov ga ne vklopi", async () => {
    const { dir, token } = await linija();
    await assert.rejects(savePravila({ potrditevNaslov: "ni naslov" }, token, dir), /e-naslov ni veljaven/);
    assert.equal((await loadPravila(dir)).potrditevEposta, false);
    const shranjena = await savePravila({ potrditevNaslov: " Info@Primer.si " }, token, dir);
    assert.equal(shranjena.potrditevNaslov, "info@primer.si");
    assert.equal(shranjena.potrditevEposta, true);
    // Sprememba naslova (ze veljavnega) ne spremeni stikala.
    await savePravila({ potrditevEposta: false }, token, dir);
    await savePravila({ potrditevNaslov: "ponudbe@primer.si" }, token, dir);
    assert.equal((await loadPravila(dir)).potrditevEposta, false);
  });

  it("Lina po klicateljevi e-posti in po casu povratnega klica ne vprasa nikoli; sprasuje samo kolicino, rok in (skrita stevilka) telefon", async () => {
    const { dir } = await linija(NASLOV);
    const o = await potek(dir, ["Ana Primer, nisem iz podjetja.", "Mizo Alba iz hrasta.", "Tri.", "Ne vem.", "Ne vem.", "Da."], "anonymous");
    const vsa = o.map((izid) => izid.reply).join(" | ");
    assert.doesNotMatch(vsa.replace(STAVEK_EPOSTE, ""), /elektronsk|pokličemo nazaj|Kdaj vas/, vsa);
    assert.equal(o.at(-1)?.call.status, "zakljucen");
    // Skrita stevilka in telefon zavrnjen: obljube o povratnem klicu ni.
    assert.doesNotMatch(o.at(-1)?.reply ?? "", /poklicali/);
    assert.match(o.at(-1)?.reply ?? "", /Hvala za klic\. Lep dan\.$/);
  });

  it("klicatelj sam pove cas povratnega klica: v povzetku, brez stavka o povratnem klicu po potrditvi; e-posta ostane v zapisu", async () => {
    const { dir } = await linija();
    const o = await potek(dir, [
      "Ana Primer, nisem iz podjetja.",
      "Dve mizi Alba iz hrasta, rok do petka.",
      "Pokličite me jutri popoldne, moja e-posta je ana@primer.si.",
      "Da.",
    ]);
    assert.match(o[2].reply, POVZETEK);
    assert.doesNotMatch(o[2].reply, /Poklicali vas bomo jutri/);
    assert.match(o[3].reply, /Poklicali vas bomo jutri popoldne\./);
    assert.equal(o[3].call.order.email, "ana@primer.si");
    assert.equal(o[4].reply, `${t("slovo")} ${t("lepDan")}`);
    // E-naslova Lina ne bere in ga ni v dnevniku.
    assert.doesNotMatch(povzetekZaPotrditev(o[3].call), /ana@|afna/);
    assert.doesNotMatch(o[3].call.transcript.map((v) => v.text).join(" "), /ana@primer/);
  });

  it("klicatelj ob povzetku zavrne vidno stevilko: Lina vprasa telefon enkrat, nato nov povzetek", async () => {
    const { dir } = await linija();
    const o = await potek(dir, ["Ana Primer, nisem iz podjetja.", "Dve mizi Alba iz hrasta, rok do petka.", "Pokličite me raje na drugo številko.", "041 111 222"]);
    assert.match(o[2].reply, POVZETEK);
    assert.equal(o[3].reply, t("prosiTelefon"));
    assert.match(o[4].reply, POVZETEK);
    assert.match(o[4].call.order.phone ?? "", /041/);
  });

  it("manjkajoci stik ne vsebuje e-poste; stari podatkovni model ostane (email v zapisu je »ni dan«)", async () => {
    assert.deepEqual(manjkajoci(prazenStik(OD)), ["ime"]);
    assert.deepEqual(manjkajoci(prazenStik("anonymous")), ["ime", "telefon"]);
    const { dir } = await linija();
    const o = await potek(dir, ["Ana Primer, nisem iz podjetja.", "Dve mizi Alba iz hrasta, rok do petka.", "Da."]);
    assert.equal(o[3].call.order.email, t("niDan"));
    assert.ok(o[3].call.stik?.konec);
  });

  it("stalni stavki imajo kolicino in stavek o povratnem klicu; vprasanj po e-posti in povratnem klicu ni med pripravljenimi", () => {
    const stalni = stalniStavki({ pozdrav: "", potrditevEposta: true, potrditevNaslov: NASLOV }, "FORMA", formaCatalog());
    for (const kljuc of ["prosiKolicino", "prosiRok", "prosiTelefon", "povzetekStik", "povratniKlicSploh", "slovo", "lepDan"] as const) {
      assert.ok(stalni.includes(t(kljuc)), kljuc);
    }
    for (const kljuc of ["prosiEposto", "prosiDosegljiv", "niNujno"] as const) assert.ok(!stalni.includes(t(kljuc)), kljuc);
    assert.ok(stalni.includes(STAVEK_EPOSTE));
  });
});

describe("naloga G4g (3): izgovor e-naslova podjetja", () => {
  it("kos, ki ga glas ne izgovori kot besedo, se crkuje; drugo ostane cela beseda", () => {
    const tabela: Array<[string, string]> = [
      ["info@primer.si", "info, afna, primer, pika, si"],
      ["jana.novak@primer-doo.si", "jana, pika, novak, afna, primer, vezaj, de, o, o, pika, si"],
      ["ponudbe_2026@primer.si", "ponudbe, podčrtaj, dva, nič, dva, šest, afna, primer, pika, si"],
      ["xyz@primer.si", "iks, ipsilon, ze, afna, primer, pika, si"],
      ["a+b@primer.si", "a, plus, be, afna, primer, pika, si"],
    ];
    for (const [naslov, izgovor] of tabela) assert.equal(izgovoriEnaslov(naslov), izgovor, naslov);
    // En sam stavek: ena pika na koncu, brez drugih stavcnih mej.
    for (const [naslov] of tabela) {
      const stavek = stavekPotrditve({ potrditevEposta: true, potrditevNaslov: naslov });
      assert.equal(stavek.match(/[.!?]/g)?.length, 1, stavek);
      assert.ok(stavek.endsWith("."));
    }
  });
});

describe("naloga G4g (4): rok z datumom in mesecem", () => {
  it("»petnajstega decembra« dobi »do«; izrazi z lastnim predlogom ostanejo", () => {
    const tabela: Array<[string, string]> = [
      ["petnajstega decembra", ", rok pa je do petnajstega decembra"],
      ["prvega januarja", ", rok pa je do prvega januarja"],
      ["15. decembra", ", rok pa je do 15. decembra"],
      ["petka", ", rok pa je do petka"],
      ["do petnajstega decembra", ", rok pa je do petnajstega decembra"],
      ["konec decembra", ", rok pa je konec decembra"],
      ["v dveh tednih", ", rok pa je v dveh tednih"],
      ["čim prej", ", rok pa je čim prej"],
      ["jutri", ", rok pa je jutri"],
    ];
    for (const [vhod, izhod] of tabela) assert.equal(govorjenRok(vhod), izhod, vhod);
    assert.equal(govorjenRok("petnajstega decembra", true), "Rok je do petnajstega decembra.");
    assert.equal(govorjenRok("15. decembra", false, "en"), ", and the deadline is by 15. decembra");
  });

  it("v povzetku klica: »Do petnajstega decembra.« se izgovori »rok pa je do petnajstega decembra« brez podvojenega »do«", async () => {
    const { dir } = await linija();
    const o = await potek(dir, ["Ana Primer, nisem iz podjetja.", "Dve mizi Alba iz hrasta.", "Do petnajstega decembra."]);
    assert.match(o[3].reply, /v količini 2, rok pa je do petnajstega decembra\./);
    assert.doesNotMatch(o[3].reply, /do do|je petnajstega/);
  });
});

describe("naloga G4g (5): Gather in Twilio", () => {
  async function voice(dir: string, params: Record<string, string>, pot: string): Promise<string> {
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
    );
    return odgovor.text();
  }

  it("tipicen klic je najvec 5 zahtev (pozdrav, ime, izdelek s kolicino, rok, »Da.«); Gather je brez hints (sl-SI ni potrjen)", async () => {
    const { dir } = await linija(NASLOV_BREZ);
    let zahtevkov = 0;
    const vsi: string[] = [];
    const sid = novSid();
    zahtevkov += 1;
    vsi.push(await voice(dir, { CallSid: sid, From: OD }, "/api/voice/incoming"));
    for (const [i, izrek] of ["Ana Primer.", "Dve mizi Alba iz hrasta.", "Do petka.", "Da."].entries()) {
      zahtevkov += 1;
      vsi.push(await voice(dir, { CallSid: sid, From: OD, SpeechResult: izrek }, `/api/voice/turn?obr=${i + 1}`));
    }
    assert.equal(zahtevkov, 5);
    assert.ok(zahtevkov <= 10);
    assert.match(vsi.at(-1) ?? "", /<Hangup\/>/);
    for (const twiml of vsi.slice(0, -1)) assert.match(twiml, /<Gather /);
    // Twilio dokumentacija za Gather ne potrjuje podpore hints za sl-SI (glej porocilo G4g): atributa ne dodajamo.
    for (const twiml of vsi) assert.doesNotMatch(twiml, /hints=/);
    assert.doesNotMatch(readFileSync(new URL("./voice.server.ts", import.meta.url), "utf8"), /hints=/);
  });
});

const NASLOV_BREZ = "";
