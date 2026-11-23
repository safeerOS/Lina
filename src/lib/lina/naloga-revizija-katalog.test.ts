/**
 * Preizkusi revizija-katalog.ts (naloga #44 + #45): povzetek spremembe poslovnega znanja brez vsebine.
 * Zlate zgoscene vrednosti so izracunane neodvisno (python hashlib). Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formaCatalog } from "./catalog.ts";
import { kratkaZgoscena, povzetekSpremembeKataloga } from "./revizija-katalog.ts";
import { sestaviVnos } from "./revizija.ts";
import type { Catalog } from "./types.ts";

const osnova = (): Catalog => ({ ...JSON.parse(JSON.stringify(formaCatalog())), zapiski: [], znanje: "Staro znanje." });
const kopija = (): Catalog => JSON.parse(JSON.stringify(osnova())) as Catalog;

describe("povzetek spremembe kataloga", () => {
  it("enak katalog: brez vnosa", () => {
    assert.equal(povzetekSpremembeKataloga(osnova(), kopija()), null);
  });

  it("zapiski undefined in prazno polje, znanje undefined in prazen niz so enaki", () => {
    const a = osnova();
    const b = osnova();
    delete a.zapiski;
    delete b.znanje;
    a.znanje = "";
    b.zapiski = [];
    assert.equal(povzetekSpremembeKataloga(a, b), null);
  });

  it("prej brez polja znanje in potem prazen niz: ni spremembe", () => {
    const a = osnova();
    const b = osnova();
    delete a.znanje;
    b.znanje = "";
    assert.equal(povzetekSpremembeKataloga(a, b), null);
  });

  it("oba brez polja znanje: ni spremembe", () => {
    const a = osnova();
    const b = osnova();
    delete a.znanje;
    delete b.znanje;
    assert.equal(povzetekSpremembeKataloga(a, b), null);
  });

  it("podjetje", () => {
    const b = kopija();
    b.company.phone = "+386 1 000 00 00";
    const izid = povzetekSpremembeKataloga(osnova(), b);
    assert.deepEqual(izid, { vrsta: "katalog.sprememba", opis: "Spremenjeno poslovno znanje: podjetje.", podatki: { razdelki: "podjetje", znanjeZnakov: "Staro znanje.".length } });
  });

  it("izdelki, materiali in zapiski posamezno", () => {
    const i = kopija();
    i.products[0].summary = "Drug opis.";
    assert.equal(povzetekSpremembeKataloga(osnova(), i)?.podatki?.razdelki, "izdelki");
    const m = kopija();
    m.materials.pop();
    assert.equal(povzetekSpremembeKataloga(osnova(), m)?.podatki?.razdelki, "materiali");
    const z = kopija();
    z.zapiski = [{ id: "z1", vprasanje: "Ali dostavljate?", odgovor: "Da." }];
    assert.equal(povzetekSpremembeKataloga(osnova(), z)?.podatki?.razdelki, "zapiski");
  });

  it("znanje: zlata kratka zgoscena vrednost in stevilo znakov novega besedila", () => {
    const b = kopija();
    b.znanje = "Nova ponudba.";
    assert.deepEqual(povzetekSpremembeKataloga(osnova(), b), {
      vrsta: "katalog.sprememba",
      opis: "Spremenjeno poslovno znanje: znanje.",
      podatki: { razdelki: "znanje", znanjeZnakov: 13, znanjeSha16: "65704422e49be599" },
    });
    assert.equal(kratkaZgoscena("Nova ponudba."), "65704422e49be599");
  });

  it("znanje izbrisano: zgoscena vrednost praznega niza in 0 znakov", () => {
    const b = kopija();
    b.znanje = "";
    assert.deepEqual(povzetekSpremembeKataloga(osnova(), b)?.podatki, { razdelki: "znanje", znanjeZnakov: 0, znanjeSha16: "e3b0c44298fc1c14" });
  });

  it("vsi razdelki hkrati v stalnem vrstnem redu", () => {
    const b = kopija();
    b.company.name = "Drugo";
    b.products = [];
    b.materials = [];
    b.zapiski = [{ id: "z1", vprasanje: "v", odgovor: "o" }];
    b.znanje = "Nova ponudba.";
    const izid = povzetekSpremembeKataloga(osnova(), b);
    assert.equal(izid?.opis, "Spremenjeno poslovno znanje: podjetje, izdelki, materiali, zapiski, znanje.");
    assert.equal(izid?.podatki?.razdelki, "podjetje,izdelki,materiali,zapiski,znanje");
  });

  it("zamenjan vrstni red izdelkov je sprememba", () => {
    const b = kopija();
    b.products.reverse();
    assert.equal(povzetekSpremembeKataloga(osnova(), b)?.podatki?.razdelki, "izdelki");
  });

  it("vsebine ni v povzetku (ime podjetja, telefon, izdelki, besedilo znanja)", () => {
    const b = kopija();
    b.company.name = "TajnoImePodjetja";
    b.company.phone = "+386 40 123 456";
    b.products[0].name = "TajniIzdelek";
    b.znanje = "Zaupno besedilo znanja.";
    const besedilo = JSON.stringify(povzetekSpremembeKataloga(osnova(), b));
    for (const iskano of ["TajnoImePodjetja", "+386 40 123 456", "TajniIzdelek", "Zaupno besedilo", "FORMA", "Alba", "Staro znanje"]) {
      assert.equal(besedilo.includes(iskano), false, iskano);
    }
  });

  it("znanjeZnakov je dolzina novega, ne starega besedila; brez spremembe znanja ni zgoscene vrednosti", () => {
    const a = osnova();
    a.znanje = "x".repeat(50);
    const b = JSON.parse(JSON.stringify(a)) as Catalog;
    b.company.name = "Drugo";
    const izid = povzetekSpremembeKataloga(a, b);
    assert.equal(izid?.podatki?.znanjeZnakov, 50);
    assert.equal("znanjeSha16" in (izid?.podatki ?? {}), false);
    const c = JSON.parse(JSON.stringify(a)) as Catalog;
    c.znanje = "y".repeat(20000);
    assert.equal(povzetekSpremembeKataloga(a, c)?.podatki?.znanjeZnakov, 20000);
  });

  it("povzetek je veljaven vhod za verigo", () => {
    const b = kopija();
    b.znanje = "Nova ponudba.";
    b.company.name = "Drugo";
    const povzetek = povzetekSpremembeKataloga(osnova(), b);
    assert.ok(povzetek);
    if (povzetek) assert.equal(sestaviVnos(null, povzetek, new Date("2026-11-21T09:00:00.000Z")).ok, true);
  });
});
