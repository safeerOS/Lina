/**
 * Naloga G4d (lastnik, 4. pravi klic, 11. 11. 2026): podjetje pokliche nazaj na stevilko, s katere klicatelj klice,
 * zato je Lina ne vprasa. Vidna stevilka iz From je telefon stika ze ob zacetku klica; skrita se vprasa kot prej;
 * stevilka, ki jo klicatelj pove sam, prepise From. Brez pravega omrezja; samo izmisljene stevilke.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { t } from "./besedila.ts";
import { formaCatalog } from "./catalog.ts";
import { defaultPravila } from "./pravila.server.ts";
import { povzetekZaPotrditev, stalniStikPovzetka } from "./povzetek.ts";
import { recordCaller } from "./service.server.ts";
import { jeVidnaStevilka, manjkajoci, prazenStik } from "./stik.ts";
import { writeJson } from "./store.server.ts";

process.env.LINA_LLM = "0";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-g4d-"));
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
const STIK = t("povzetekStik");
const PRVI = ["Ana Primer.", "Mizo Alba iz hrasta, 2 kosa.", "Do petka."];

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

describe("naloga G4d (A): vidna stevilka klicatelja ni manjkajoc podatek", { concurrency: 1 }, () => {
  it("jeVidnaStevilka in prazenStik: vidna gre v stik, skrite, prazne in brez stevk ne", () => {
    for (const vidna of [OD, "+38641000111", "040000000"]) assert.equal(jeVidnaStevilka(vidna), true, vidna);
    for (const skrita of ["anonymous", "Anonymous", "restricted", "unavailable", "withheld", "private", "unknown", "+266696687", "", "   ", "+1", "abc"]) {
      assert.equal(jeVidnaStevilka(skrita), false, JSON.stringify(skrita));
    }
    assert.equal(jeVidnaStevilka(undefined), false);
    assert.equal(prazenStik(OD).telefon, OD);
    assert.equal(prazenStik("anonymous").telefon, "");
    assert.equal(prazenStik().telefon, "");
    // G4g (stik.ts manjkajoci, lastnik 11. 11. 2026): e-poste Lina ne sprasuje vec.
    assert.deepEqual(manjkajoci(prazenStik(OD)), ["ime"]);
    assert.deepEqual(manjkajoci(prazenStik("anonymous")), ["ime", "telefon"]);
  });

  it("vidna stevilka: stik ima telefon ze ob pozdravu, Lina po telefonu ne vprasa nikoli, stevilka je v zapisniku, stalni stavek ostane", async () => {
    const dir = await linija();
    const { odgovori, zadnji } = await potek(dir, "CA-G4D-A1", OD, [...PRVI, "ana@primer.si", "Jutri popoldne."]);
    for (const odgovor of odgovori) {
      assert.notEqual(odgovor, t("prosiTelefon"));
      assert.doesNotMatch(odgovor, /telefonsk/i, odgovor);
    }
    // G4g (11. 11. 2026): e-poste Lina ne sprasuje vec; po roku pride povzetek (telefona ni v vrstnem redu).
    assert.ok(odgovori[3].startsWith(t("povzetekUvod")), odgovori[3]);
    assert.equal(zadnji.call.stik?.telefon, OD);
    assert.equal(zadnji.call.order.phone, OD, "stevilka je v zapisniku klica");
    assert.ok(!manjkajoci(zadnji.call.stik!).includes("telefon"));
    const povzetek = povzetekZaPotrditev(zadnji.call);
    // G4g: stalni stavek o povratnem klicu je PO potrditvi (stalniStikPovzetka), ne v povzetku.
    assert.deepEqual(stalniStikPovzetka(zadnji.call), [STIK]);
    assert.doesNotMatch(povzetek, /0 0 0|40000000|plus/);
  });

  it("vidna stevilka ze v pozdravu: stik ima telefon, ko klicatelj se ni nic rekel", async () => {
    const dir = await linija();
    const pozdrav = await recordCaller({ callSid: "CA-G4D-A2", from: OD, text: "" }, dir);
    assert.equal(pozdrav.call.stik?.telefon, OD);
    assert.equal(pozdrav.call.order.phone, OD);
  });
});

describe("naloga G4d (B): skrita stevilka se vprasa kot prej", { concurrency: 1 }, () => {
  for (const skrita of ["anonymous", "Anonymous", "restricted", "unavailable", "withheld", "+266696687", ""]) {
    it(`From ${JSON.stringify(skrita)}: Lina vprasa telefon, stalnega stavka o povratnem klicu ni`, async () => {
      const dir = await linija();
      const { odgovori, zadnji } = await potek(dir, `CA-G4D-B-${skrita || "prazen"}`, skrita, [...PRVI, "041 000 000", "ana@primer.si", "Jutri popoldne."]);
      assert.equal(odgovori[3], t("prosiTelefon"), `po roku: ${odgovori[3]}`);
      assert.equal(odgovori.filter((o) => o === t("prosiTelefon")).length, 1, "telefon se vprasa enkrat");
      assert.match(zadnji.call.order.phone ?? "", /041/);
      assert.deepEqual(stalniStikPovzetka(zadnji.call), []);
      assert.ok(!povzetekZaPotrditev(zadnji.call).includes(STIK));
    });
  }

  it("skrita stevilka in klicatelj telefona noce dati: zapis je »ni dan«, brez ponovnega vprasanja", async () => {
    const dir = await linija();
    const { odgovori, zadnji } = await potek(dir, "CA-G4D-B-ne", "anonymous", [...PRVI, "Ne vem.", "ana@primer.si", "Jutri popoldne."]);
    assert.equal(odgovori.filter((o) => o === t("prosiTelefon")).length, 1);
    assert.equal(zadnji.call.order.phone, t("niDan"));
  });
});

describe("naloga G4d (C): stevilka, ki jo klicatelj pove sam, prepise From", { concurrency: 1 }, () => {
  it("klicatelj pove drugo stevilko: v zapisniku je ta, ne From; stavka »s katere klicete« ni", async () => {
    const dir = await linija();
    const { odgovori, zadnji } = await potek(dir, "CA-G4D-C1", OD, [...PRVI, "Pokličite me na 041 111 222.", "ana@primer.si", "Jutri popoldne."]);
    assert.ok(odgovori.every((o) => o !== t("prosiTelefon")));
    assert.equal(zadnji.call.stik?.telefon.replace(/\s+/g, ""), "041111222");
    assert.equal(zadnji.call.order.phone?.replace(/\s+/g, ""), "041111222");
    assert.notEqual(zadnji.call.order.phone, OD);
    assert.equal(zadnji.call.from, OD, "From ostane v zapisu klica");
    assert.deepEqual(stalniStikPovzetka(zadnji.call), []);
  });

  it("klicatelj pove samo, da naj pokliceno drugo stevilko: Lina jo vprasa, povedana prepise From", async () => {
    const dir = await linija();
    const { odgovori, zadnji } = await potek(dir, "CA-G4D-C2", OD, [...PRVI, "Pokličite me raje na drugo številko.", "041 111 222", "ana@primer.si", "Jutri popoldne."]);
    assert.equal(odgovori.filter((o) => o === t("prosiTelefon")).length, 1, odgovori.join(" | "));
    assert.equal(zadnji.call.order.phone?.replace(/\s+/g, ""), "041111222");
  });

  it("»ta stevilka je moja« pri vidnem From ostane From (potrditev ne spremeni nicesar)", async () => {
    const dir = await linija();
    const { zadnji } = await potek(dir, "CA-G4D-C3", OD, ["Ime mi je Ana Primer. Številka s katere kličem je moja. Mizo Alba iz hrasta."]);
    assert.equal(zadnji.call.order.phone, OD);
  });
});
