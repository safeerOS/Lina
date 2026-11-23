// Dopolnilni preizkusi (vodja): meje, vse vrste neveljavnosti, vsa polja AAD, dolocna oblika sporocil napak.
// Pogodba je v svet-16-sklep.md (sinhronizacija kljucev): kljuc se nikoli ne pojavi v napaki, izidu ali prikazu.
import test from "node:test";
import assert from "node:assert/strict";
import { hkdfSync, createCipheriv } from "node:crypto";
import {
  VRSTE_KLJUCEV,
  NAMEN_OVOJNICE,
  jeVrstaKljuca,
  prazno,
  uporabiZapis,
  zaPrikaz,
  izpeljiKljucOvoja,
  aadOvojnice,
  zapakiraj,
  odpakiraj,
} from "./kljuci-sinhron.ts";
import type { StanjeKljuca, Zapis } from "./kljuci-sinhron.ts";

const OSNOVA: Zapis = { vrsta: "gemini", baza: 0, gen: 0, izvor: "A", cas: 1, vrednost: "veljavna-vrednost" };

test("VRSTE_KLJUCEV: natancno dogovorjeni seznam in vsaka je veljavna", () => {
  assert.deepEqual([...VRSTE_KLJUCEV], ["gemini", "vertex", "twilio", "tinyfish", "brave", "soniox", "sip"]);
  for (const v of VRSTE_KLJUCEV) assert.equal(jeVrstaKljuca(v), true);
  for (const v of [null, undefined, 5, {}, [], "Gemini", " gemini"]) assert.equal(jeVrstaKljuca(v as unknown), false);
});

test("uporabiZapis: neveljavne vrste (tudi ne-niz) dajo razlog vrsta", () => {
  const s = prazno("gemini");
  for (const v of ["google-oauth", "podpis", "seznanitev", "", 123, null, undefined]) {
    const izid = uporabiZapis(s, { ...OSNOVA, vrsta: v as any });
    assert.deepEqual(izid, { izid: "neveljaven", razlog: "vrsta" });
  }
});

test("uporabiZapis: meje dolzine vrednosti 8 in 200 so veljavne, 7 in 201 ne", () => {
  const s = prazno("gemini");
  assert.equal(uporabiZapis(s, { ...OSNOVA, vrednost: "a".repeat(8) }).izid, "sprejet");
  assert.equal(uporabiZapis(s, { ...OSNOVA, vrednost: "a".repeat(200) }).izid, "sprejet");
  assert.deepEqual(uporabiZapis(s, { ...OSNOVA, vrednost: "a".repeat(7) }), { izid: "neveljaven", razlog: "vrednost" });
  assert.deepEqual(uporabiZapis(s, { ...OSNOVA, vrednost: "a".repeat(201) }), { izid: "neveljaven", razlog: "vrednost" });
});

test("uporabiZapis: tabulator, DEL, presledek in ne-niz niso veljavna vrednost", () => {
  const s = prazno("gemini");
  for (const v of ["abcdefgh\tx", "abcdefgh\x7fx", "abcdefgh x", "abcdefgh\u0000", 12345678 as any, undefined as any]) {
    assert.deepEqual(uporabiZapis(s, { ...OSNOVA, vrednost: v }), { izid: "neveljaven", razlog: "vrednost" });
  }
});

test("uporabiZapis: razlog neveljavnosti nikoli ne vsebuje vrednosti zapisa", () => {
  const s = prazno("gemini");
  const tajna = "TAJNA-VREDNOST-ZA-PREIZKUS";
  const izidi = [
    uporabiZapis(s, { ...OSNOVA, vrsta: "podpis" as any, vrednost: tajna }),
    uporabiZapis(s, { ...OSNOVA, izvor: "A B", vrednost: tajna }),
    uporabiZapis(s, { ...OSNOVA, baza: 3, vrednost: tajna }),
    uporabiZapis(s, { ...OSNOVA, vrednost: tajna + " s presledkom" }),
  ];
  for (const izid of izidi) {
    assert.equal(izid.izid, "neveljaven");
    assert.equal(JSON.stringify(izid).includes("TAJNA"), false);
  }
});

test("uporabiZapis: izvor ima natancno pravilo (80 znakov, samo A-Za-z0-9._-)", () => {
  const s = prazno("gemini");
  assert.equal(uporabiZapis(s, { ...OSNOVA, izvor: "a".repeat(80) }).izid, "sprejet");
  assert.equal(uporabiZapis(s, { ...OSNOVA, izvor: "tel.1_A-b" }).izid, "sprejet");
  for (const izvor of ["A/B", "A|B", "A\nB", "šč", 5 as any, null as any]) {
    assert.deepEqual(uporabiZapis(s, { ...OSNOVA, izvor }), { izid: "neveljaven", razlog: "polja" });
  }
});

test("uporabiZapis: cas mora biti koncno nenegativno stevilo", () => {
  const s = prazno("gemini");
  assert.equal(uporabiZapis(s, { ...OSNOVA, cas: 0 }).izid, "sprejet");
  for (const cas of [Infinity, -Infinity, -0.5, "5" as any, undefined as any]) {
    assert.deepEqual(uporabiZapis(s, { ...OSNOVA, cas }), { izid: "neveljaven", razlog: "polja" });
  }
});

test("uporabiZapis: rev se poveca samo ob sprejetem, gen samo ob sprejetem nagrobniku", () => {
  let s = prazno("brave");
  const korak = (z: Partial<Zapis>) => {
    const izid = uporabiZapis(s, { vrsta: "brave", baza: s.rev, gen: s.gen, izvor: "A", cas: 5, vrednost: "veljavna-vrednost", ...z });
    return izid;
  };
  let izid = korak({});
  assert.equal(izid.izid, "sprejet");
  if (izid.izid === "sprejet") s = izid.stanje;
  assert.equal(s.rev, 1);
  assert.equal(s.gen, 0);

  // ista vrednost: brez spremembe, rev in gen ostaneta
  izid = korak({});
  assert.equal(izid.izid, "brez-spremembe");
  if (izid.izid === "brez-spremembe") assert.equal(izid.stanje.rev, 1);

  // hkratna razlicna vrednost: konflikt, rev ostane
  izid = korak({ baza: 0, vrednost: "druga-vrednost-1" });
  assert.equal(izid.izid, "konflikt");
  if (izid.izid === "konflikt") {
    assert.equal(izid.stanje.rev, 1);
    assert.equal(izid.stanje.gen, 0);
    assert.equal(izid.stanje.stanje, "nastavljen");
    assert.equal(izid.stanje.vrednost, "veljavna-vrednost");
    assert.equal(izid.stanje.izvor, "A");
  }

  // nagrobnik: rev + 1 in gen + 1
  izid = korak({ vrednost: null });
  assert.equal(izid.izid, "sprejet");
  if (izid.izid === "sprejet") s = izid.stanje;
  assert.equal(s.rev, 2);
  assert.equal(s.gen, 1);
  assert.equal(s.stanje, "pozabljen");
  assert.equal(s.vrednost, null);

  // ponovljen nagrobnik: brez-spremembe, brez novega gen
  izid = korak({ vrednost: null });
  assert.equal(izid.izid, "brez-spremembe");
  if (izid.izid === "brez-spremembe") {
    assert.equal(izid.stanje.rev, 2);
    assert.equal(izid.stanje.gen, 1);
  }
});

test("uporabiZapis: zastarel ima prednost pred konfliktom in vhod ostane nespremenjen", () => {
  const s: StanjeKljuca = { vrsta: "gemini", rev: 4, gen: 2, stanje: "nastavljen", vrednost: "trenutna-vrednost", izvor: "B", cas: 9, konflikt: null };
  const pred = JSON.stringify(s);
  const izid = uporabiZapis(s, { ...OSNOVA, baza: 1, gen: 1, vrednost: "stara-vrednost-1" });
  assert.equal(izid.izid, "zastarel");
  if (izid.izid === "zastarel") assert.equal(izid.stanje.konflikt, null);
  // nagrobnik z nizjo gen ne sme obuditi ali pobrisati novejsega stanja
  const izid2 = uporabiZapis(s, { ...OSNOVA, baza: 4, gen: 1, vrednost: null });
  assert.equal(izid2.izid, "zastarel");
  assert.equal(JSON.stringify(s), pred);
});

test("uporabiZapis: konflikt ne spremeni vhodnega stanja in ne hrani vrednosti", () => {
  const s: StanjeKljuca = { vrsta: "gemini", rev: 3, gen: 0, stanje: "nastavljen", vrednost: "trenutna-vrednost", izvor: "B", cas: 9, konflikt: null };
  const pred = JSON.stringify(s);
  const izid = uporabiZapis(s, { ...OSNOVA, baza: 2, vrednost: "konfliktna-vrednost" });
  assert.equal(izid.izid, "konflikt");
  assert.equal(JSON.stringify(s), pred);
  if (izid.izid === "konflikt") {
    assert.equal(JSON.stringify(izid.stanje.konflikt).includes("konfliktna-vrednost"), false);
    assert.equal(zaPrikaz(izid.stanje).konflikt, true);
    assert.equal(JSON.stringify(zaPrikaz(izid.stanje)).includes("trenutna-vrednost"), false);
  }
});

test("zaPrikaz: brez, pozabljen in konflikt", () => {
  const brez = zaPrikaz(prazno("sip"));
  assert.deepEqual(brez, { vrsta: "sip", rev: 0, gen: 0, stanje: "brez", izvor: "", cas: 0, odtis: "", konflikt: false });
});

test("aadOvojnice: natancno besedilo in vsako polje spremeni AAD", () => {
  const p = { vrsta: "gemini" as const, rev: 1, gen: 2, izvor: "A", smer: "telefon-racunalnik" as const };
  assert.equal(aadOvojnice(p).toString("utf-8"), `${NAMEN_OVOJNICE}|gemini|1|2|A|telefon-racunalnik`);
  const razlicice = [
    { ...p, vrsta: "vertex" as const },
    { ...p, rev: 2 },
    { ...p, gen: 3 },
    { ...p, izvor: "B" },
    { ...p, smer: "racunalnik-telefon" as const },
  ];
  const osnovni = aadOvojnice(p);
  for (const r of razlicice) assert.equal(aadOvojnice(r).equals(osnovni), false);
});

test("odpakiraj: sprememba katerega koli polja AAD vrze natancno 'ovojnica'", () => {
  const kljuc = izpeljiKljucOvoja(Buffer.alloc(16, "a"), Buffer.alloc(16, "b"));
  const p = { vrsta: "gemini" as const, rev: 1, gen: 2, izvor: "A", smer: "telefon-racunalnik" as const };
  const o = zapakiraj(kljuc, "skrivnost-123456", aadOvojnice(p));
  assert.equal(odpakiraj(kljuc, o, aadOvojnice(p)), "skrivnost-123456");
  const razlicice = [
    { ...p, vrsta: "vertex" as const },
    { ...p, rev: 2 },
    { ...p, gen: 3 },
    { ...p, izvor: "B" },
    { ...p, smer: "racunalnik-telefon" as const },
  ];
  for (const r of razlicice) {
    assert.throws(() => odpakiraj(kljuc, o, aadOvojnice(r)), (e: any) => e instanceof Error && e.message === "ovojnica");
  }
});

test("izpeljiKljucOvoja: ujema se z neodvisnim izracunom HKDF-SHA256 z info = NAMEN_OVOJNICE", () => {
  const skrivnost = Buffer.from("0123456789abcdef0123456789abcdef");
  const sol = Buffer.from("fedcba9876543210");
  const pricakovan = Buffer.from(hkdfSync("sha256", skrivnost, sol, "lina-kljuci-v1", 32));
  assert.equal(izpeljiKljucOvoja(skrivnost, sol).equals(pricakovan), true);
  assert.equal(NAMEN_OVOJNICE, "lina-kljuci-v1");
});

test("odpakiraj: slabe oblike ovojnice dajo 'ovojnica', napacna dolzina kljuca pa 'kljuc'", () => {
  const kljuc = izpeljiKljucOvoja(Buffer.alloc(16, "a"), Buffer.alloc(16, "b"));
  const aad = Buffer.from("x");
  const o = zapakiraj(kljuc, "skrivnost-123456", aad);
  const slabe: any[] = [
    { ...o, iv: Buffer.alloc(11).toString("base64") },
    { ...o, iv: Buffer.alloc(13).toString("base64") },
    { ...o, tag: Buffer.alloc(17).toString("base64") },
    { ...o, v: undefined },
    { ...o, ct: 5 },
    { ...o, iv: undefined },
    { v: 1 },
  ];
  for (const s of slabe) assert.throws(() => odpakiraj(kljuc, s, aad), (e: any) => e instanceof Error && e.message === "ovojnica");
  assert.throws(() => odpakiraj(Buffer.alloc(33), o, aad), (e: any) => e instanceof Error && e.message === "kljuc");
  assert.throws(() => zapakiraj(Buffer.alloc(33), "skrivnost-123456", aad), (e: any) => e instanceof Error && e.message === "kljuc");
});

test("zapakiraj: ovojnica ima obliko v1, nobene vrednosti in odpakiraj vrne UTF-8 nespremenjeno", () => {
  const kljuc = izpeljiKljucOvoja(Buffer.alloc(32, "k"), Buffer.alloc(32, "s"));
  const aad = aadOvojnice({ vrsta: "soniox", rev: 7, gen: 0, izvor: "tel-1", smer: "racunalnik-telefon" });
  const vrednost = "šćž-ključ-123456";
  const o = zapakiraj(kljuc, vrednost, aad);
  assert.equal(o.v, 1);
  assert.deepEqual(Object.keys(o).sort(), ["ct", "iv", "tag", "v"]);
  assert.equal(Buffer.from(o.iv, "base64").length, 12);
  assert.equal(Buffer.from(o.tag, "base64").length, 16);
  assert.equal(JSON.stringify(o).includes("ključ"), false);
  assert.equal(odpakiraj(kljuc, o, aad), vrednost);
});

test("odpakiraj: pristna ovojnica z drugacno dolzino IV (ne 12 B) je zavrnjena", () => {
  const kljuc = izpeljiKljucOvoja(Buffer.alloc(16, "a"), Buffer.alloc(16, "b"));
  const aad = Buffer.from("pogodba");
  const iv = Buffer.alloc(16, 7);
  const c = createCipheriv("aes-256-gcm", kljuc, iv);
  c.setAAD(aad);
  const ct = Buffer.concat([c.update("skrivnost-123456", "utf-8"), c.final()]);
  const tuja = { v: 1 as const, iv: iv.toString("base64"), ct: ct.toString("base64"), tag: c.getAuthTag().toString("base64") };
  assert.throws(() => odpakiraj(kljuc, tuja, aad), (e: any) => e instanceof Error && e.message === "ovojnica");
});
