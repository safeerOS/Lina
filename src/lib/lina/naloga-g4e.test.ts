/**
 * Naloga G4e (lastnik po 4. pravem klicu, 11. 11. 2026: >>ni me posebej motilo, le ce lahko narocilo malo lepse izgovori<<):
 * povzetek narocila pred potrditvijo je EN tekoc stavek (izdelek, material, kolicina, rok), ne vrsta kratkih stavkov.
 * Samo govorjena oblika: zapis klica (povzetekKlica) in e-posta ostaneta. Brez pravega omrezja; komentarji brez sumnikov.
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
import {
  deliPovzetka,
  deliZaPredpripravo,
  govorjenRok,
  povzetekBrezPodatkov,
  povzetekKlica,
  povzetekZaPotrditev,
  stavekNarocila,
} from "./povzetek.ts";
import { recordCaller } from "./service.server.ts";
import { writeJson } from "./store.server.ts";
import type { CallSession } from "./types.ts";

process.env.LINA_LLM = "0";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-g4e-"));
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
const NAROCILO = "Naročate izdelek Alba iz materiala Hrast, v količini 2, rok pa je do petka.";

async function potek(dir: string, sid: string, izreki: string[]) {
  let zadnji = await recordCaller({ callSid: sid, from: OD, text: "" }, dir);
  for (const izrek of izreki) zadnji = await recordCaller({ callSid: sid, from: OD, text: izrek }, dir);
  return zadnji;
}

/** Klic z izmisljenimi podatki narocila; polja, ki jih ne podamo, so prazna. */
function klicZ(call: CallSession, order: Partial<CallSession["order"]>, ime = ""): CallSession {
  const kopija = structuredClone(call);
  kopija.order = {
    ...kopija.order,
    productName: null,
    requestedProduct: null,
    materialName: null,
    requestedMaterial: null,
    quantity: null,
    deadline: null,
    povprasevanje: null,
    dosegljiv: null,
    ...order,
  } as CallSession["order"];
  kopija.stik = { ...(kopija.stik ?? {}), ime } as CallSession["stik"];
  return kopija;
}

/** Stavek konca na eni piki: en sklenjen stavek, brez vmesnih stavcnih mej. */
function jeEnStavek(besedilo: string): boolean {
  return /^[^.!?]+\.$/.test(besedilo.replace(/(\d)\. (\d)/g, "$1,$2"));
}

describe("naloga G4e (1): povzetek narocila je en tekoc stavek", { concurrency: 1 }, () => {
  it("izdelek, material, kolicina in rok so v enem stavku; povzetek ima uvod, narocilo, ime, povratni klic, stalni stavek, vprasanje", async () => {
    const dir = await linija();
    // Potek G4g (lastnik 11. 11. 2026, AGENTS.md »Potek konca klica (G4g)«): e-poste in casa povratnega klica Lina ne vprasa;
    // cas, ki ga klicatelj pove sam, je v povzetku. Stalni stavek o povratnem klicu (STIK) je PO potrditvi in ga ni, ce je
    // klicatelj cas povedal sam.
    const zadnji = await potek(dir, "CA-G4E-1", ["Ana Primer.", "Mizo Alba iz hrasta, 2 kosa.", "Do petka.", "Pokličite me jutri popoldne."]);
    const povzetek = povzetekZaPotrditev(zadnji.call);
    assert.equal(povzetek, `Ponovim, kar sem razumela. ${NAROCILO} Ime je Ana Primer. Poklicali vas bomo jutri popoldne. Ali potrjujete naročilo?`);
    assert.ok(!povzetek.includes(STIK));
    assert.equal(stavekNarocila(zadnji.call), NAROCILO);
    assert.ok(jeEnStavek(NAROCILO));
    // Ne vec ločenih stavkov z oznakami (>>Izdelek ...<<, >>Rok je ...<< kot svoj stavek).
    assert.doesNotMatch(povzetek, /(^|\. )(Izdelek|Rok je) /);
    assert.deepEqual(deliPovzetka(zadnji.call), [NAROCILO, "Ime je Ana Primer.", "Poklicali vas bomo jutri popoldne."]);
  });

  it("brez podatkov v zapisniku: stavek >>Podatki so v zapisniku<< je samo v dnevniku in samo kadar je povzetek brez podatkov", async () => {
    const dir = await linija();
    const zadnji = await potek(dir, "CA-G4E-2", ["Ana Primer.", "Mizo Alba iz hrasta, 2 kosa.", "Do petka.", "ana@primer.si", "Jutri popoldne."]);
    const povzetek = povzetekZaPotrditev(zadnji.call);
    assert.doesNotMatch(povzetek, /Podatki so v zapisniku/);
    // Dnevnik: podatki klicatelja izrezani, ostane uvod, opomba in vprasanje (zapis ni spremenjen).
    assert.equal(povzetekBrezPodatkov(povzetek), `Ponovim, kar sem razumela. ${t("povzetekVZapisniku")} ${t("potrditevVprasanje")}`);
  });

  it("imena izdelka in materiala se ne sklanjajo: stojijo dobesedno kot v katalogu", () => {
    const osnova = klicZ({ order: {} } as unknown as CallSession, {});
    for (const [izdelek, material] of [["Kaskada", "Jeklo"], ["Nara", "Oreh"], ["Lira", "Jesen"]]) {
      const stavek = stavekNarocila(klicZ(osnova, { productName: izdelek, materialName: material, quantity: 1, deadline: "jutri" }));
      assert.equal(stavek, `Naročate izdelek ${izdelek} iz materiala ${material}, v količini 1, rok pa je jutri.`);
    }
  });

  it("deli podatkov se izpustijo, stavek ostane tekoc: brez materiala, kolicine ali roka", () => {
    const osnova = klicZ({ order: {} } as unknown as CallSession, {});
    const z = (order: Partial<CallSession["order"]>) => stavekNarocila(klicZ(osnova, order));
    assert.equal(z({ productName: "Alba" }), "Naročate izdelek Alba.");
    assert.equal(z({ productName: "Alba", materialName: "Hrast" }), "Naročate izdelek Alba iz materiala Hrast.");
    assert.equal(z({ productName: "Alba", quantity: 2 }), "Naročate izdelek Alba, v količini 2.");
    assert.equal(z({ productName: "Alba", deadline: "petka" }), "Naročate izdelek Alba, rok pa je do petka.");
    assert.equal(z({ productName: "Alba", materialName: "ni podatka", deadline: "ni podatka" }), "Naročate izdelek Alba.");
    for (const stavek of [z({ productName: "Alba" }), z({ productName: "Alba", quantity: 2, deadline: "jutri" })]) assert.ok(jeEnStavek(stavek), stavek);
  });

  it("prosto povprasevanje (brez izdelka iz kataloga) in rok sta en stavek; sam rok je svoj kratek stavek", () => {
    const osnova = klicZ({ order: {} } as unknown as CallSession, {});
    const z = (order: Partial<CallSession["order"]>) => stavekNarocila(klicZ(osnova, order));
    assert.equal(z({ povprasevanje: "Iscem omaro po meri", deadline: "do petka" }), "Iscem omaro po meri, rok pa je do petka.");
    assert.equal(z({ povprasevanje: "Iscem omaro po meri" }), "Iscem omaro po meri.");
    assert.equal(z({ deadline: "jutri" }), "Rok je jutri.");
  });

  it("brez podatkov o narocilu: stavka narocila ni, povzetek ostane varna oblika (uvod in vprasanje, brez izmisljenih podatkov)", () => {
    const prazen = klicZ({ order: {} } as unknown as CallSession, {});
    assert.equal(stavekNarocila(prazen), "");
    assert.deepEqual(deliPovzetka(prazen), []);
    const povzetek = povzetekZaPotrditev(prazen);
    assert.ok(povzetek.startsWith(t("povzetekUvod")) && povzetek.endsWith(t("potrditevVprasanje")), povzetek);
    assert.doesNotMatch(povzetek, /Naročate|undefined|null|\{/);
  });
});

describe("naloga G4e (2): jeziki, predpriprava, zapis", { concurrency: 1 }, () => {
  it("angleski stavek je prav tako en stavek z istimi podatki; kosi imajo oba jezika", () => {
    const osnova = klicZ({ order: {} } as unknown as CallSession, {});
    const klic = klicZ(osnova, { productName: "Alba", materialName: "Hrast", quantity: 2, deadline: "Friday" });
    const en = stavekNarocila(klic, "en");
    assert.equal(en, "You are ordering the product Alba made of Hrast, in a quantity of 2, and the deadline is Friday.");
    assert.ok(jeEnStavek(en));
    assert.equal(stavekNarocila({ ...klic, order: { ...klic.order, deadline: "jutri" } }, "sl"), "Naročate izdelek Alba iz materiala Hrast, v količini 2, rok pa je jutri.");
    for (const kljuc of ["povzetekIzdelek", "povzetekMaterial", "povzetekKolicina", "povzetekRok", "povzetekRokSam", "povzetekRokDo"] as const) {
      assert.notEqual(t(kljuc, "en"), "", kljuc);
      assert.notEqual(t(kljuc, "en"), t(kljuc, "sl"), kljuc);
    }
    assert.equal(govorjenRok("15. 12.", false, "en"), ", and the deadline is by 15. 12");
  });

  it("predpriprava: stavek narocila je en kos z rokom, zato se vnaprej pripravi sele z rokom (ne zavrzena sinteza ob vsakem podatku)", () => {
    const osnova = klicZ({ order: {} } as unknown as CallSession, {});
    const brezRoka = klicZ(osnova, { productName: "Alba", materialName: "Hrast" }, "Ana Primer");
    assert.deepEqual(deliZaPredpripravo(brezRoka), ["Ime je Ana Primer."]);
    const zRokom = klicZ(osnova, { productName: "Alba", materialName: "Hrast", deadline: "petka" }, "Ana Primer");
    assert.deepEqual(deliZaPredpripravo(zRokom), ["Naročate izdelek Alba iz materiala Hrast, rok pa je do petka.", "Ime je Ana Primer."]);
    assert.deepEqual(deliPovzetka(brezRoka), ["Naročate izdelek Alba iz materiala Hrast.", "Ime je Ana Primer."]);
  });

  it("zapis klica ostane kot prej: kratki podatki z >>kos<< in >>rok<<, brez govorjenega stavka", async () => {
    const dir = await linija();
    const zadnji = await potek(dir, "CA-G4E-3", ["Ana Primer.", "Mizo Alba iz hrasta, 2 kosa.", "Do petka.", "ana@primer.si", "Jutri popoldne."]);
    const zapis = povzetekKlica(zadnji.call);
    assert.match(zapis.zelel, /Alba, Hrast, 2 kos/);
    assert.match(zapis.zelel, /rok /);
    assert.doesNotMatch(JSON.stringify(zapis), /Naročate|rok pa je/);
  });
});
