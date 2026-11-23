import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  VRSTE_KLJUCEV,
  jeVrstaKljuca,
  prazno,
  uporabiZapis,
  odtisKljuca,
  zaPrikaz,
  izpeljiKljucOvoja,
  aadOvojnice,
  zapakiraj,
  odpakiraj,
} from "./kljuci-sinhron.ts";
import type { StanjeKljuca, Zapis } from "./kljuci-sinhron.ts";

test("jeVrstaKljuca in VRSTE_KLJUCEV", () => {
  assert.equal(jeVrstaKljuca("gemini"), true);
  assert.equal(jeVrstaKljuca("google-oauth"), false);
  assert.equal(jeVrstaKljuca("podpis"), false);
  assert.equal(jeVrstaKljuca("seznanitev"), false);
  assert.equal(jeVrstaKljuca(""), false);
});

test("uporabiZapis - pravilo 1 (neveljavno)", () => {
  const s = prazno("gemini");
  // vrsta
  assert.deepEqual(uporabiZapis(s, { vrsta: "google-oauth" as any, baza: 0, gen: 0, izvor: "A", cas: 1, vrednost: "veljavna-vrednost" }), { izid: "neveljaven", razlog: "vrsta" });
  assert.deepEqual(uporabiZapis(s, { vrsta: "vertex", baza: 0, gen: 0, izvor: "A", cas: 1, vrednost: "veljavna-vrednost" }), { izid: "neveljaven", razlog: "vrsta" }); // ne ujema se
  
  // polja
  assert.deepEqual(uporabiZapis(s, { vrsta: "gemini", baza: -1, gen: 0, izvor: "A", cas: 1, vrednost: "veljavna-vrednost" }), { izid: "neveljaven", razlog: "polja" });
  assert.deepEqual(uporabiZapis(s, { vrsta: "gemini", baza: 0, gen: -1, izvor: "A", cas: 1, vrednost: "veljavna-vrednost" }), { izid: "neveljaven", razlog: "polja" });
  assert.deepEqual(uporabiZapis(s, { vrsta: "gemini", baza: 1.5, gen: 0, izvor: "A", cas: 1, vrednost: "veljavna-vrednost" }), { izid: "neveljaven", razlog: "polja" });
  assert.deepEqual(uporabiZapis(s, { vrsta: "gemini", baza: 0, gen: 0, izvor: "", cas: 1, vrednost: "veljavna-vrednost" }), { izid: "neveljaven", razlog: "polja" });
  assert.deepEqual(uporabiZapis(s, { vrsta: "gemini", baza: 0, gen: 0, izvor: "a".repeat(81), cas: 1, vrednost: "veljavna-vrednost" }), { izid: "neveljaven", razlog: "polja" });
  assert.deepEqual(uporabiZapis(s, { vrsta: "gemini", baza: 0, gen: 0, izvor: "A B", cas: 1, vrednost: "veljavna-vrednost" }), { izid: "neveljaven", razlog: "polja" });
  assert.deepEqual(uporabiZapis(s, { vrsta: "gemini", baza: 0, gen: 0, izvor: "A", cas: -1, vrednost: "veljavna-vrednost" }), { izid: "neveljaven", razlog: "polja" });
  assert.deepEqual(uporabiZapis(s, { vrsta: "gemini", baza: 0, gen: 0, izvor: "A", cas: NaN, vrednost: "veljavna-vrednost" }), { izid: "neveljaven", razlog: "polja" });
  assert.deepEqual(uporabiZapis(s, { vrsta: "gemini", baza: 1, gen: 0, izvor: "A", cas: 1, vrednost: "veljavna-vrednost" }), { izid: "neveljaven", razlog: "polja" }); // baza > rev (rev je 0)
  
  // vrednost
  assert.deepEqual(uporabiZapis(s, { vrsta: "gemini", baza: 0, gen: 0, izvor: "A", cas: 1, vrednost: "kratek!" }), { izid: "neveljaven", razlog: "vrednost" }); // dolzina 7
  assert.deepEqual(uporabiZapis(s, { vrsta: "gemini", baza: 0, gen: 0, izvor: "A", cas: 1, vrednost: "a".repeat(201) }), { izid: "neveljaven", razlog: "vrednost" }); // dolzina 201
  assert.deepEqual(uporabiZapis(s, { vrsta: "gemini", baza: 0, gen: 0, izvor: "A", cas: 1, vrednost: "ima presledek" }), { izid: "neveljaven", razlog: "vrednost" });
  assert.deepEqual(uporabiZapis(s, { vrsta: "gemini", baza: 0, gen: 0, izvor: "A", cas: 1, vrednost: "nadzorni\nznak" }), { izid: "neveljaven", razlog: "vrednost" });
});

test("uporabiZapis - celotno zaporedje", () => {
  let s = prazno("gemini");
  
  // 1. nastavi (baza=rev)
  const z1: Zapis = { vrsta: "gemini", baza: 0, gen: 0, izvor: "A", cas: 10, vrednost: "veljavna-vrednost-1" };
  const strS = JSON.stringify(s);
  let izid = uporabiZapis(s, z1);
  assert.equal(JSON.stringify(s), strS); // vhod nespremenjen
  assert.equal(izid.izid, "sprejet");
  if (izid.izid === "sprejet") { s = izid.stanje; }
  assert.deepEqual(s, { vrsta: "gemini", rev: 1, gen: 0, stanje: "nastavljen", vrednost: "veljavna-vrednost-1", izvor: "A", cas: 10, konflikt: null });

  // 2. nagrobnik
  const z2: Zapis = { vrsta: "gemini", baza: 1, gen: 0, izvor: "B", cas: 20, vrednost: null };
  izid = uporabiZapis(s, z2);
  assert.equal(izid.izid, "sprejet");
  if (izid.izid === "sprejet") { s = izid.stanje; }
  assert.deepEqual(s, { vrsta: "gemini", rev: 2, gen: 1, stanje: "pozabljen", vrednost: null, izvor: "B", cas: 20, konflikt: null });

  // 3. stara nastavitev z nizjo gen -> zastarel
  const z3: Zapis = { vrsta: "gemini", baza: 1, gen: 0, izvor: "C", cas: 30, vrednost: "veljavna-vrednost-2" };
  izid = uporabiZapis(s, z3);
  assert.equal(izid.izid, "zastarel");
  if (izid.izid === "zastarel") { assert.deepEqual(izid.stanje, s); }

  // 4. ponovni vnos po nagrobniku (gen enak, baza=rev) -> sprejet
  const z4: Zapis = { vrsta: "gemini", baza: 2, gen: 1, izvor: "D", cas: 40, vrednost: "veljavna-vrednost-3" };
  izid = uporabiZapis(s, z4);
  assert.equal(izid.izid, "sprejet");
  if (izid.izid === "sprejet") { s = izid.stanje; }
  assert.deepEqual(s, { vrsta: "gemini", rev: 3, gen: 1, stanje: "nastavljen", vrednost: "veljavna-vrednost-3", izvor: "D", cas: 40, konflikt: null });

  // 5. hkratna ista vrednost -> brez-spremembe
  const z5: Zapis = { vrsta: "gemini", baza: 2, gen: 1, izvor: "E", cas: 50, vrednost: "veljavna-vrednost-3" };
  izid = uporabiZapis(s, z5);
  assert.equal(izid.izid, "brez-spremembe");
  
  // 6. hkratna razlicna -> konflikt
  const z6: Zapis = { vrsta: "gemini", baza: 2, gen: 1, izvor: "F", cas: 60, vrednost: "veljavna-vrednost-4" };
  izid = uporabiZapis(s, z6);
  assert.equal(izid.izid, "konflikt");
  if (izid.izid === "konflikt") {
    assert.deepEqual(izid.stanje.konflikt, { izvor: "F", odtis: odtisKljuca("veljavna-vrednost-4"), cas: 60 });
    assert.equal(izid.stanje.vrednost, "veljavna-vrednost-3"); // ni spremenjena
  }
});

test("uporabiZapis - hkratni nagrobnik in neveljavne vrednosti", () => {
  let s = prazno("gemini");
  
  // nastavi
  let izid = uporabiZapis(s, { vrsta: "gemini", baza: 0, gen: 0, izvor: "A", cas: 10, vrednost: "veljavna-12345" });
  if (izid.izid === "sprejet") { s = izid.stanje; }
  
  // hkratni nagrobnik
  const zh: Zapis = { vrsta: "gemini", baza: 0, gen: 0, izvor: "X", cas: 5, vrednost: null };
  const izidh = uporabiZapis(s, zh);
  assert.equal(izidh.izid, "konflikt");
  if (izidh.izid === "konflikt") {
    assert.deepEqual(izidh.stanje.konflikt, { izvor: "X", odtis: "", cas: 5 });
  }

  // prazen vhodni stanje - hkratni nagrobnik -> brez-spremembe
  const sz = prazno("gemini");
  const i0 = uporabiZapis(sz, { vrsta: "gemini", baza: 0, gen: 0, izvor: "A", cas: 1, vrednost: null });
  assert.equal(i0.izid, "brez-spremembe");
});

test("zaPrikaz in odtisKljuca", () => {
  const vrednost = "SKRIVNOST-TEST-123";
  const odtis = odtisKljuca(vrednost);
  assert.equal(odtis.length, 6);
  assert.match(odtis, /^[0-9a-f]{6}$/);

  const s: StanjeKljuca = { vrsta: "gemini", rev: 1, gen: 0, stanje: "nastavljen", vrednost, izvor: "A", cas: 10, konflikt: null };
  const prikaz = zaPrikaz(s);
  assert.equal(prikaz.odtis, odtis);
  assert.equal((prikaz as any).vrednost, undefined);
  assert.equal(JSON.stringify(prikaz).includes(vrednost), false);

  const sPozabljen: StanjeKljuca = { vrsta: "gemini", rev: 2, gen: 1, stanje: "pozabljen", vrednost: null, izvor: "A", cas: 20, konflikt: null };
  const prikaz2 = zaPrikaz(sPozabljen);
  assert.equal(prikaz2.odtis, "");
});

test("ovojnica - krog", () => {
  const skrivnost = Buffer.alloc(16, "a");
  const sol = Buffer.alloc(16, "b");
  const kljuc = izpeljiKljucOvoja(skrivnost, sol);
  const kljuc2 = izpeljiKljucOvoja(skrivnost, sol);
  const kljuc3 = izpeljiKljucOvoja(skrivnost, Buffer.alloc(16, "c"));
  
  assert.equal(kljuc.equals(kljuc2), true);
  assert.equal(kljuc.equals(kljuc3), false);
  assert.equal(kljuc.length, 32);

  const aad = aadOvojnice({ vrsta: "gemini", rev: 1, gen: 2, izvor: "A", smer: "telefon-racunalnik" });
  
  const vrednost = "veljavna-skrivnost-123";
  const o1 = zapakiraj(kljuc, vrednost, aad);
  const v1 = odpakiraj(kljuc, o1, aad);
  assert.equal(v1, vrednost);
  
  // 1000 klicev - razlicni iv in ct
  const o2 = zapakiraj(kljuc, vrednost, aad);
  assert.notEqual(o1.iv, o2.iv);
  assert.notEqual(o1.ct, o2.ct);

  const ivi = new Set();
  for (let i = 0; i < 1000; i++) {
    ivi.add(zapakiraj(kljuc, vrednost, aad).iv);
  }
  assert.equal(ivi.size, 1000);
});

test("ovojnica - napake", () => {
  const skrivnost = Buffer.alloc(16, "a");
  const sol = Buffer.alloc(16, "b");
  const kljuc = izpeljiKljucOvoja(skrivnost, sol);
  const aad = aadOvojnice({ vrsta: "gemini", rev: 1, gen: 2, izvor: "A", smer: "telefon-racunalnik" });
  const o = zapakiraj(kljuc, "skrivnost-123456", aad);

  assert.equal(JSON.stringify(o).includes("skrivnost-123456"), false);

  const slabiAAD = aadOvojnice({ vrsta: "gemini", rev: 1, gen: 2, izvor: "B", smer: "telefon-racunalnik" });
  assert.throws(() => odpakiraj(kljuc, o, slabiAAD), { message: "ovojnica" });

  const slabKljuc = izpeljiKljucOvoja(skrivnost, Buffer.alloc(16, "c"));
  assert.throws(() => odpakiraj(slabKljuc, o, aad), { message: "ovojnica" });

  const slabaO = { ...o, ct: Buffer.from(Buffer.from(o.ct, "base64").map((b, i) => i === 0 ? b ^ 1 : b)).toString("base64") };
  assert.throws(() => odpakiraj(kljuc, slabaO, aad), { message: "ovojnica" });

  const slabIV = { ...o, iv: Buffer.from(Buffer.from(o.iv, "base64").map((b, i) => i === 0 ? b ^ 1 : b)).toString("base64") };
  assert.throws(() => odpakiraj(kljuc, slabIV, aad), { message: "ovojnica" });

  const slabaV = { ...o, v: 2 as any };
  assert.throws(() => odpakiraj(kljuc, slabaV, aad), { message: "ovojnica" });

  const slabaTag = { ...o, tag: Buffer.from(Buffer.from(o.tag, "base64").map((b,i) => i===0 ? b^1 : b)).toString("base64") };
  assert.throws(() => odpakiraj(kljuc, slabaTag, aad), { message: "ovojnica" });

  const okrnjenTag = { ...o, tag: Buffer.from(o.tag, "base64").subarray(0, 15).toString("base64") };
  assert.throws(() => odpakiraj(kljuc, okrnjenTag, aad), { message: "ovojnica" });
});

test("ovojnica - prekratki vhodi kljuca", () => {
  assert.throws(() => izpeljiKljucOvoja(Buffer.alloc(15), Buffer.alloc(16)), { message: "kljuc" });
  assert.throws(() => izpeljiKljucOvoja(Buffer.alloc(16), Buffer.alloc(15)), { message: "kljuc" });
  assert.throws(() => zapakiraj(Buffer.alloc(31), "A", Buffer.alloc(0)), { message: "kljuc" });
  assert.throws(() => odpakiraj(Buffer.alloc(31), {} as any, Buffer.alloc(0)), { message: "kljuc" });
});
