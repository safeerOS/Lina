/**
 * Naloga G4c (povratna informacija lastnika po 3. pravem klicu, 11. 11. 2026): telefonske stevilke povzetek ne bere
 * (glas jo je bral z anglescino), »Hvala« samo na koncu klica, izgovor dneva v enem govorjenem besedilu.
 * Brez pravega omrezja; komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { renderReply } from "./brain.ts";
import { t } from "./besedila.ts";
import { formaCatalog } from "./catalog.ts";
import { stalniStavki } from "./glas.ts";
import { defaultPravila } from "./pravila.server.ts";
import { govorjenCas, govorjenDosegljiv, govorjenRok, povzetekZaPotrditev, stalniStikPovzetka } from "./povzetek.ts";
import { recordCaller } from "./service.server.ts";
import { besediloOpozorila, besediloVprasanja } from "./stik.ts";
import { writeJson } from "./store.server.ts";

process.env.LINA_LLM = "0";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-g4c-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const temps: string[] = [];

afterEach(async () => {
  while (temps.length) {
    const dir = temps.pop();
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

async function linija(): Promise<string> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  temps.push(dir);
  await writeJson(dir, "line.json", { open: true, catalog: formaCatalog(), updatedAt: null });
  await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi" });
  return dir;
}

const OD = "+38640000000";
const STIK = "Če bomo potrebovali dodatne informacije, vas bomo poklicali na številko, s katere kličete.";

async function potek(dir: string, sid: string, od: string, izreki: string[]) {
  const odgovori: string[] = [];
  let zadnji = await recordCaller({ callSid: sid, from: od, text: "" }, dir);
  odgovori.push(zadnji.reply);
  for (const izrek of izreki) {
    zadnji = await recordCaller({ callSid: sid, from: od, text: izrek }, dir);
    odgovori.push(zadnji.reply);
  }
  return { odgovori, zadnji };
}

describe("naloga G4c (A): telefona povzetek ne bere", { concurrency: 1 }, () => {
  it("povzetek nima telefonske stevilke ne oznake »Telefon«; ima stalni stavek; stevilka ostane v zapisu klica", async () => {
    // Potek G4g (lastnik 11. 11. 2026, AGENTS.md »Potek konca klica (G4g)«): pri vidni stevilki Lina po roku takoj ponovi
    // narocilo; telefona, e-poste in casa povratnega klica ne sprasuje. Stavek o povratnem klicu je PO potrditvi.
    const dir = await linija();
    const { odgovori, zadnji } = await potek(dir, "CA-G4C-A1", OD, ["Ana Primer.", "Mizo Alba iz hrasta, 2 kosa.", "Do petka."]);
    const povzetek = odgovori.at(-1) ?? "";
    assert.equal(povzetek, povzetekZaPotrditev(zadnji.call));
    assert.match(povzetek, /Ali potrjujete naročilo\?$/);
    assert.equal(t("povzetekStik"), STIK);
    assert.doesNotMatch(povzetek, /Telefon|0 4 0|040|plus|\d[ ,]+\d/);
    // Stevilka iz klica (From) je v zapisu klica, ne v govoru.
    assert.match(zadnji.call.order.phone ?? "", /40\s*000\s*000/, "stevilka je v zapisu klica");
    const konec = await recordCaller({ callSid: "CA-G4C-A1", from: OD, text: "Da." }, dir);
    assert.ok(konec.reply.includes(STIK), konec.reply);
    assert.doesNotMatch(konec.reply, /Telefon|0 4 0|040|plus|\d[ ,]+\d/);
    assert.ok(stalniStavki(defaultPravila(), "FORMA").includes(STIK), "stavek je stalni posnetek");
  });

  it("skrita stevilka klicatelja: obljube o povratnem klicu na stevilko, s katere klice, ni", async () => {
    const dir = await linija();
    const { zadnji } = await potek(dir, "CA-G4C-A2", "anonymous", ["Ana Primer.", "Mizo Alba iz hrasta, 2 kosa.", "Do petka.", "Ne vem.", "ana@primer.si", "Jutri popoldne."]);
    assert.deepEqual(stalniStikPovzetka(zadnji.call), []);
    assert.ok(!povzetekZaPotrditev(zadnji.call).includes(STIK));
    assert.deepEqual(stalniStikPovzetka({ ...zadnji.call, from: OD }), [STIK]);
  });
});

describe("naloga G4c (B): »Hvala« samo na koncu klica", { concurrency: 1 }, () => {
  it("noben odgovor sredi klica nima »Hvala«; zadnji ima natanko eno (»Hvala za klic.«)", async () => {
    const dir = await linija();
    // Potek G4g (lastnik 11. 11. 2026, AGENTS.md »Potek konca klica (G4g)«): pri vidni stevilki Lina po roku takoj ponovi
    // narocilo; telefona, e-poste in casa povratnega klica ne sprasuje. Stavek o povratnem klicu je PO potrditvi.
    const { odgovori } = await potek(dir, "CA-G4C-B1", OD, ["Ana Primer.", "Mizo Alba iz hrasta, 2 kosa.", "Do petka.", "Da."]);
    const vmes = odgovori.slice(0, -1);
    for (const odgovor of vmes) assert.doesNotMatch(odgovor, /hvala/i, odgovor);
    const konec = odgovori.at(-1) ?? "";
    assert.equal((konec.match(/hvala/gi) ?? []).length, 1, konec);
    assert.match(konec, /Hvala za klic\. Lep dan\.$/);
  });

  it("podatek, povedan skupaj (telefon in e-posta), in podatek po zaprtem stiku tudi brez »Hvala«", async () => {
    const dir = await linija();
    const { odgovori } = await potek(dir, "CA-G4C-B2", OD, ["Ana Primer.", "Mizo Alba iz hrasta, 2 kosa.", "Do petka.", "041 000 000, ana@primer.si", "Ne vem.", "Da."]);
    for (const odgovor of odgovori.slice(0, -1)) assert.doesNotMatch(odgovor, /hvala/i, odgovor);
    assert.equal(t("stikZakljucek"), "Zapisala sem.");
    assert.doesNotMatch(t("stikZakljucek"), /hvala/i);
  });
});

describe("naloga G4c (B2): ostala besedila sredi klica brez »Hvala«", { concurrency: 1 }, () => {
  it("vprasanje po manjkajocem stiku in opozorilo o omejenem casu ne zacneta z zahvalo", () => {
    for (const manjka of [["ime"], ["telefon"], ["eposta"], ["ime", "telefon", "eposta"]] as const) {
      assert.doesNotMatch(besediloVprasanja([...manjka]), /hvala/i);
      assert.doesNotMatch(besediloOpozorila([...manjka]), /hvala/i);
    }
    assert.equal(besediloVprasanja(["telefon"]), t("prosiTelefon"));
  });

  it("odgovor ob potrjenem zapisniku (katalog) nima »Hvala.« na koncu", () => {
    const guard = { violations: [], confirmed: true, product: { name: "Alba" }, material: { name: "Hrast" } };
    const draft = { customerName: "Ana Primer", quantity: 2, confirmAsked: true };
    const odgovor = renderReply(formaCatalog(), draft as never, guard as never, false);
    assert.match(odgovor, /^Zapisnik je potrjen za Ana Primer: Alba iz materiala Hrast, 2 kos\.$/);
    assert.doesNotMatch(odgovor, /hvala/i);
  });
});

describe("naloga G4c (C, D): govorjeno besedilo dneva in casa", { concurrency: 1 }, () => {
  it("govorjenDosegljiv: naravni stavek, mala zacetnica, brez izrecnega stavka klicatelja", () => {
    const tabela: Array<[string, string]> = [
      ["Jutri popoldne", "Poklicali vas bomo jutri popoldne."],
      ["jutri popoldne.", "Poklicali vas bomo jutri popoldne."],
      ["Pokličite jutri popoldne", "Poklicali vas bomo jutri popoldne."],
      ["pokličite me v ponedeljek", "Poklicali vas bomo v ponedeljek."],
      ["dosegljiv sem po 15. uri", "Poklicali vas bomo po 15. uri."],
      ["Danes", "Poklicali vas bomo danes."],
      ["V ponedeljek", "Poklicali vas bomo v ponedeljek."],
      ["pojutrišnjem", "Poklicali vas bomo čez dva dni."],
      ["Pojutrišnjem popoldne", "Poklicali vas bomo čez dva dni popoldne."],
      ["pokličite me", ""],
      ["", ""],
    ];
    for (const [vhod, izhod] of tabela) assert.equal(govorjenDosegljiv(vhod), izhod, vhod);
    assert.ok(!govorjenDosegljiv("jutri").includes("Povratni klic:"));
  });

  it("govorjenRok: >>Rok je ...<< namesto >>Rok: ...<<; dan v rodilniku in datum dobita »do«; pojutrisnjem zamenjan", () => {
    // G4e (11. 11. 2026, povzetek.ts govorjenRok): privzeto je rok kos stavka narocila (», rok pa je do petka«); samostojni
    // stavek »Rok je ...« je oblika sam = true.
    assert.equal(govorjenRok("petka"), ", rok pa je do petka");
    const tabela: Array<[string, string]> = [
      ["petka", "Rok je do petka."],
      ["jutri", "Rok je jutri."],
      ["danes", "Rok je danes."],
      ["v ponedeljek", "Rok je v ponedeljek."],
      ["15. 12.", "Rok je do 15. 12."],
      ["pojutrišnjem", "Rok je čez dva dni."],
      ["čez dva tedna", "Rok je čez dva tedna."],
    ];
    for (const [vhod, izhod] of tabela) assert.equal(govorjenRok(vhod, true), izhod, vhod);
    assert.equal(govorjenCas("pojutrisnjem"), "čez dva dni");
    assert.equal(govorjenCas("jutri"), "jutri");
  });

  it("besedilo v povzetku z imenom, rokom in povratnim klicem je v celoti naravni stavki (brez oznak z dvopicjem)", async () => {
    const dir = await linija();
    // Potek G4g (lastnik 11. 11. 2026, AGENTS.md »Potek konca klica (G4g)«): pri vidni stevilki Lina po roku takoj ponovi
    // narocilo; telefona, e-poste in casa povratnega klica ne sprasuje. Stavek o povratnem klicu je PO potrditvi.
    // Cas povratnega klica, ki ga klicatelj pove sam (ob povzetku), ostane v novem povzetku.
    const { zadnji } = await potek(dir, "CA-G4C-C1", OD, ["Ana Primer.", "Mizo Alba iz hrasta, 2 kosa.", "Do pojutrišnjem.", "Pokličite me jutri popoldne."]);
    const povzetek = povzetekZaPotrditev(zadnji.call);
    assert.doesNotMatch(povzetek, /(Rok|Ime|Povratni klic|Telefon):/);
    assert.match(povzetek, /Ime je Ana Primer\./);
    assert.match(povzetek, /Poklicali vas bomo jutri popoldne\./);
    assert.doesNotMatch(povzetek, /pojutri/i);
  });
});
