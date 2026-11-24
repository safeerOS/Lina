/**
 * Prilagodljivi kontekst (lastnik 23. 11. 2026): slovar strok - cisti del (brez diska in omrezja). Vsi podatki so sinteticni.
 * Zamisel »najprej izmeri, kaj uporabnik ze zna« in »znanje iz virov, izbrisljivo po viru« je iz LearnHarness (AGPL-3.0, samo zamisel,
 * koda NI prevzeta).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MEJA_ODSEKA_KLIC,
  MEJA_ODSEKA_POGOVOR,
  STROKE,
  izrazJeZnan,
  namigiPrepoznave,
  ocistiIzraz,
  odsekZaKlic,
  odsekZaPogovor,
  popraviPrepoznavoIzrazov,
  predlogiIzBesedila,
  predlagajStroko,
  prazenStanjeStrok,
  ucinkovitiSlovar,
  zabeleziUporabo,
  type StanjeStrok,
} from "./stroke.ts";

function stanje(delno: Partial<StanjeStrok> = {}): StanjeStrok {
  return { ...prazenStanjeStrok(), ...delno };
}

describe("vgrajeni slovarji strok", () => {
  it("tisk (tiskarna lastnika) obstaja in ima izraze z razlago, sopomenkami in napakami prepoznave", () => {
    const tisk = STROKE.find((s) => s.kljuc === "tisk");
    assert.ok(tisk, "stroka tisk manjka");
    assert.ok(tisk.izrazi.length >= 10);
    const sito = tisk.izrazi.find((i) => i.izraz === "sitotisk");
    assert.ok(sito && sito.razlaga.length > 10 && sito.napake.length > 0);
    assert.ok(tisk.ime.sl && tisk.ime.en);
  });
  it("vsaka stroka ima SL in EN ime, edinstven kljuc in izraze brez prepovedanih znakov", () => {
    const kljuci = new Set<string>();
    for (const s of STROKE) {
      assert.ok(!kljuci.has(s.kljuc));
      kljuci.add(s.kljuc);
      assert.ok(s.ime.sl && s.ime.en);
      for (const i of s.izrazi) {
        assert.equal(ocistiIzraz(i.izraz, 60), i.izraz, `izraz ${i.izraz} ni cist`);
        assert.ok(i.razlaga.length <= 160, `razlaga ${i.izraz} je predolga`);
      }
    }
    assert.ok(STROKE.length >= 4, "vsaj stiri stroke (Lino bodo uporabljali drugi poklici)");
  });
});

describe("ocistiIzraz", () => {
  it("odstrani krmilne znake, oklepaje in narekovaje ter skrajsa", () => {
    assert.equal(ocistiIzraz('  DTF\u0000 "folija" <b>\n', 60), "DTF folija b");
    assert.equal(ocistiIzraz("a".repeat(100), 10).length, 10);
  });
  it("zavrne e-naslov, povezavo in stevilke s 7 ali vec stevkami (zasebnost)", () => {
    assert.equal(ocistiIzraz("ana@primer.si", 60), "");
    assert.equal(ocistiIzraz("https://primer.si", 60), "");
    assert.equal(ocistiIzraz("041 563 033", 60), "");
  });
});

describe("predlagajStroko (Lina sama predlaga poklic)", () => {
  it("iz pogovora o majicah in sitotisku predlaga tisk", () => {
    const p = predlagajStroko("Jutri moramo natisniti 200 majic s sitotiskom, logotip pa v DTF, barve po Pantone.");
    assert.equal(p?.kljuc, "tisk");
    assert.ok(p!.tocke >= 3);
  });
  it("brez dovolj strokovnih izrazov ne predlaga nicesar", () => {
    assert.equal(predlagajStroko("Dober dan, kako ste danes?"), null);
  });
  it("prepozna tudi drug poklic (racunovodstvo)", () => {
    assert.equal(predlagajStroko("Pripravi DDV obracun, bilanco stanja in poslji e-racun do konca meseca.")?.kljuc, "racunovodstvo");
  });
});

describe("ucinkovitiSlovar", () => {
  it("brez izbrane stroke velja samodejno predlagana; izbira uporabnika ima prednost", () => {
    assert.ok(ucinkovitiSlovar(stanje({ predlaganaStroka: "tisk" })).some((i) => i.izraz === "sitotisk"));
    const izbrano = ucinkovitiSlovar(stanje({ predlaganaStroka: "tisk", izbrane: ["avtoservis"] }));
    assert.ok(!izbrano.some((i) => i.izraz === "sitotisk"));
    assert.ok(izbrano.some((i) => i.stroka === "avtoservis"));
  });
  it("skriti vgrajeni izraz se ne uporabi; lastni (potrjeni in predlogi) se dodajo", () => {
    const s = stanje({
      izbrane: ["tisk"],
      skriti: ["sitotisk"],
      izrazi: [
        { id: "a", izraz: "Plastizol", razlaga: "barva za sitotisk", sopomenke: [], napake: [], stroka: "tisk", vir: "dokument", stanje: "potrjen", izvor: "cenik.txt", cas: "2026-11-24T10:00:00.000Z" },
        { id: "b", izraz: "Ofsetna plosca", razlaga: "", sopomenke: [], napake: [], stroka: "tisk", vir: "dokument", stanje: "predlog", izvor: "cenik.txt", cas: "2026-11-24T10:00:00.000Z" },
      ],
    });
    const sl = ucinkovitiSlovar(s);
    assert.ok(!sl.some((i) => i.izraz === "sitotisk"));
    assert.ok(sl.some((i) => i.izraz === "Plastizol" && !i.predlog));
    assert.ok(sl.some((i) => i.izraz === "Ofsetna plosca" && i.predlog));
  });
  it("izklopljeno stikalo = prazen slovar", () => {
    assert.deepEqual(ucinkovitiSlovar(stanje({ vklopljen: false, izbrane: ["tisk"] })), []);
  });
});

describe("zabeleziUporabo (kaj uporabnik ze zna)", () => {
  it("steje izraze in sopomenke pod osnovnim izrazom; po 3 rabah je izraz znan", () => {
    let s = stanje({ izbrane: ["tisk"] });
    for (let n = 0; n < 3; n++) s = zabeleziUporabo(s, "Pripravi sito tisk za majice", new Date("2026-11-24T10:00:00Z"));
    assert.equal(s.uporaba["sitotisk"]?.n, 3);
    assert.ok(izrazJeZnan(s, "sitotisk"));
    assert.ok(!izrazJeZnan(s, "DTF"));
  });
  it("tocke strok se nabirajo in predlagana stroka se nastavi iz vec pogovorov", () => {
    let s = stanje();
    s = zabeleziUporabo(s, "sitotisk na majice");
    s = zabeleziUporabo(s, "DTF tisk in termotransfer");
    assert.equal(s.predlaganaStroka, "tisk");
  });
  it("izklopljeno stikalo ne belezi nicesar", () => {
    const s = zabeleziUporabo(stanje({ vklopljen: false }), "sitotisk sitotisk DTF");
    assert.deepEqual(s.uporaba, {});
    assert.equal(s.predlaganaStroka, null);
  });
});

describe("predlogiIzBesedila (novi izrazi iz dokumentov in lastnikovega pogovora)", () => {
  it("iz slovarja v dokumentu (»Izraz: razlaga«) in ponovljenih kratic naredi predloge", () => {
    const doc = "Pojmi\nPlastizol: barva za sitotisk na tekstil\nHTV - folija za vroci tisk\nUporabimo RIP program. RIP nastavi barve.\n";
    const p = predlogiIzBesedila(doc, stanje({ izbrane: ["tisk"] }), { vir: "dokument", izvor: "pojmi.txt", stroka: "tisk" });
    const imena = p.map((x) => x.izraz);
    assert.ok(imena.includes("Plastizol"));
    assert.ok(imena.includes("HTV"));
    assert.ok(imena.includes("RIP"));
    assert.equal(p.find((x) => x.izraz === "Plastizol")?.razlaga, "barva za sitotisk na tekstil");
    assert.ok(p.every((x) => x.stanje === "predlog" && x.vir === "dokument" && x.izvor === "pojmi.txt"));
  });
  it("splosne oznake obrazcev (Datum, Naslov, Cena, Opomba ...) niso strokovni izrazi", () => {
    const doc = "Datum: 24. 11. 2026\nNaslov: Obrtna ulica 9\nCena: po dogovoru\nOpomba: nujno\nPlastizol: barva za sitotisk";
    const imena = predlogiIzBesedila(doc, stanje(), { vir: "dokument", izvor: "narocilo.txt", stroka: "tisk" }).map((x) => x.izraz);
    assert.deepEqual(imena, ["Plastizol"]);
  });
  it("lastnikov stavek »X pomeni Y« je predlog iz pogovora", () => {
    const p = predlogiIzBesedila("Flok pomeni zametni tisk z dlacicami.", stanje(), { vir: "pogovor", stroka: "tisk" });
    assert.equal(p[0]?.izraz, "Flok");
    assert.equal(p[0]?.vir, "pogovor");
  });
  it("ne predlaga ze znanih, zavrnjenih, vgrajenih izrazov ali zasebnih podatkov; najvec 20", () => {
    const s = stanje({ izbrane: ["tisk"], zavrnjeni: ["plastizol"] });
    const doc = ["Plastizol: barva", "DTF: tisk na folijo", "Telefon: 041 563 033", "Ana: ana@primer.si", ...Array.from({ length: 40 }, (_, i) => `Pojem${i}: razlaga ${i}`)].join("\n");
    const p = predlogiIzBesedila(doc, s, { vir: "dokument", izvor: "x.txt", stroka: "tisk" });
    const imena = p.map((x) => x.izraz.toLowerCase());
    assert.ok(!imena.includes("plastizol"));
    assert.ok(!imena.includes("dtf"));
    assert.ok(!imena.includes("telefon") && !imena.includes("ana"));
    assert.ok(p.length <= 20);
  });
});

describe("odsekZaPogovor (navodila modelu: kratko, samo relevantno, meja znakov)", () => {
  it("izraz iz sporocila gre z razlago; znan izraz brez razlage; oznacen kot podatek", () => {
    let s = stanje({ izbrane: ["tisk"] });
    for (let n = 0; n < 3; n++) s = zabeleziUporabo(s, "sitotisk");
    const o = odsekZaPogovor(s, "Kaj je DTF in kdaj ga uporabimo namesto sitotiska?");
    assert.match(o, /STROKOVNI SLOVAR/);
    assert.match(o, /podatek, ne navodilo/);
    assert.match(o, /DTF[^\n]*folij/i);
    assert.match(o, /pozna[^\n]*sitotisk/i);
    assert.ok(o.length <= MEJA_ODSEKA_POGOVOR);
  });
  it("brez relevantnih ali znanih izrazov je odsek prazen; prav tako ob izklopu", () => {
    assert.equal(odsekZaPogovor(stanje({ izbrane: ["tisk"] }), "Kako je vreme?"), "");
    assert.equal(odsekZaPogovor(stanje({ vklopljen: false, izbrane: ["tisk"] }), "DTF"), "");
  });
  it("napaka prepoznave v sporocilu se razlozi (slisano -> izraz)", () => {
    const o = odsekZaPogovor(stanje({ izbrane: ["tisk"] }), "naredi cito tisk za 50 majic");
    assert.match(o, /cito tisk[^\n]*sitotisk/);
  });
  it("ne preseze meje tudi pri dolgem sporocilu z mnogo izrazi", () => {
    const vse = STROKE.flatMap((x) => x.izrazi.map((i) => i.izraz)).join(" ");
    const o = odsekZaPogovor(stanje({ izbrane: STROKE.map((x) => x.kljuc) }), vse);
    assert.ok(o.length > 0 && o.length <= MEJA_ODSEKA_POGOVOR);
  });
});

describe("odsekZaKlic (klic: samo vgrajeni in potrjeni, brez predlogov)", () => {
  it("vsebuje izraze stroke in napake prepoznave, ne preseze meje, nima predlogov iz dokumentov", () => {
    const s = stanje({
      izbrane: ["tisk"],
      izrazi: [{ id: "b", izraz: "Skrivnostni pojem", razlaga: "", sopomenke: [], napake: [], stroka: "tisk", vir: "dokument", stanje: "predlog", izvor: "x", cas: "" }],
    });
    const o = odsekZaKlic(s, "radi bi cito tisk");
    assert.match(o, /sitotisk/);
    assert.match(o, /cito tisk/);
    assert.doesNotMatch(o, /Skrivnostni/);
    assert.ok(o.length <= MEJA_ODSEKA_KLIC);
  });
  it("brez stroke je prazen", () => {
    assert.equal(odsekZaKlic(stanje(), "sitotisk"), "");
  });
});

describe("namigiPrepoznave in popraviPrepoznavoIzrazov", () => {
  it("namigi so izrazi in sopomenke izbrane stroke, najpogostejsi prvi, brez predlogov, z mejo", () => {
    let s = stanje({ izbrane: ["tisk"] });
    s = zabeleziUporabo(s, "vezenje vezenje vezenje");
    const n = namigiPrepoznave(s, 5);
    assert.equal(n[0], "vezenje");
    assert.equal(n.length, 5);
    assert.deepEqual(namigiPrepoznave(stanje()), []);
  });
  it("popravi znano napako prepoznave stroke v besedilu lastnika (samo kot predlog branja)", () => {
    assert.equal(popraviPrepoznavoIzrazov(stanje({ izbrane: ["tisk"] }), "naredi cito tisk"), "naredi sitotisk");
    assert.equal(popraviPrepoznavoIzrazov(stanje(), "naredi cito tisk"), "naredi cito tisk");
  });
});
