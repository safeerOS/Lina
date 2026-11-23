/**
 * Preizkusi motivacija.ts (dnevna motivacija): dan in del dneva po casovnem pasu, tema dneva, osebna misel, nastavitve,
 * vnaprej pripravljene misli, navodilo modelu, ciscenje NEZAUPNEGA odgovora. Zlate vrednosti (stevilke dni, dnevi v tednu,
 * ostanki pri deljenju) so izracunane neodvisno (python datetime). Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MOTIVACIJA_NAJVEC_ZNAKOV,
  MOTIVACIJA_SLOGAN,
  NAJVEC_ZNAKOV_ZAPISKOV,
  OPISI_TEM,
  PRIVZETE_NASTAVITVE,
  TEME,
  VNAPREJ,
  VNAPREJ_VECER,
  delDneva,
  dnevnaStevilka,
  imeDneva,
  izberiVnaprej,
  jeKljucDneva,
  jeOsebnaMisel,
  kljucDneva,
  ocistiOdgovorModela,
  ocistiZapiske,
  primerjalno,
  sestaviNavodilo,
  temaDneva,
  zdruziNastavitve,
} from "./motivacija.ts";

const T = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 21, h, m));
const LJ = "Europe/Ljubljana";

describe("kljuc dneva in del dneva", () => {
  it("isti trenutek je v razlicnih pasovih razlicen dan", () => {
    assert.equal(kljucDneva(T(23, 30), "UTC"), "2026-11-21");
    assert.equal(kljucDneva(T(23, 30), LJ), "2026-11-22");
    assert.equal(kljucDneva(T(23, 30), "America/Los_Angeles"), "2026-11-21");
    assert.equal(kljucDneva(T(0, 30), "America/Los_Angeles"), "2026-11-20");
  });

  it("prestopni dan", () => {
    assert.equal(kljucDneva(new Date(Date.UTC(2028, 1, 29, 12)), "UTC"), "2028-02-29");
  });

  it("neveljaven pas: dan po UTC", () => {
    assert.equal(kljucDneva(T(23, 30), "Mars/Olympus"), "2026-11-21");
  });

  it("brez pasu: veljaven kljuc dneva", () => {
    assert.equal(jeKljucDneva(kljucDneva(T(12))), true);
  });

  it("jeKljucDneva: samo pravi koledarski dnevi", () => {
    for (const v of ["2026-11-21", "2028-02-29", "1999-12-31"]) assert.equal(jeKljucDneva(v), true, v);
    for (const v of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-00-10", "2026-11-00", "2026-2-3", "26-11-21", "2026-11-21T", "0000-01-01", "", 20261121, null, undefined])
      assert.equal(jeKljucDneva(v), false, String(v));
  });

  it("vecer se zacne ob 17. uri po uri v pasu (16:59 jutro, 17:00 vecer)", () => {
    assert.equal(delDneva(T(15, 59), LJ), "jutro"); // 16:59
    assert.equal(delDneva(T(16, 0), LJ), "vecer"); // 17:00
    assert.equal(delDneva(T(23, 0), LJ), "jutro"); // 00:00 naslednjega dne (ura 0, ne 24)
    assert.equal(delDneva(T(23, 30), "America/Los_Angeles"), "jutro"); // 15:30
    assert.equal(delDneva(T(1, 0), "America/Los_Angeles"), "vecer"); // 17:00 prejsnjega dne
    assert.equal(delDneva(T(12, 0), "UTC"), "jutro");
    assert.equal(delDneva(T(17, 0), "UTC"), "vecer");
    assert.equal(delDneva(T(23, 59), "UTC"), "vecer");
    assert.equal(delDneva(T(0, 0), "UTC"), "jutro");
  });

  it("neveljaven pas: del po UTC", () => {
    assert.equal(delDneva(T(17, 0), "Mars/Olympus"), "vecer");
    assert.equal(delDneva(T(16, 59), "Mars/Olympus"), "jutro");
  });
});

describe("stevilka, ime in tema dneva", () => {
  it("zlate stevilke", () => {
    assert.equal(dnevnaStevilka("1970-01-01"), 0);
    assert.equal(dnevnaStevilka("1970-01-02"), 1);
    assert.equal(dnevnaStevilka("1970-02-10"), 40);
    assert.equal(dnevnaStevilka("2026-11-21"), 20778);
    assert.equal(dnevnaStevilka("2028-02-29"), 21243);
  });

  it("neveljaven dan vrze", () => {
    assert.throws(() => dnevnaStevilka("2026-02-30"));
    assert.throws(() => dnevnaStevilka("jutri"));
  });

  it("ime dneva", () => {
    assert.equal(imeDneva("1970-01-01"), "četrtek");
    assert.equal(imeDneva("1970-01-02"), "petek");
    assert.equal(imeDneva("2026-11-21"), "sobota");
    assert.equal(imeDneva("2026-11-22"), "nedelja");
    assert.equal(imeDneva("2026-11-23"), "ponedeljek");
    assert.equal(imeDneva("2026-11-24"), "torek");
    assert.equal(imeDneva("2026-11-25"), "sreda");
  });

  it("sedem tem: zlata rotacija (dan mod 7), vecer je vedno zakljucek", () => {
    assert.equal(TEME.length, 7);
    assert.equal(temaDneva("1970-01-01"), "majhni koraki");
    assert.equal(temaDneva("1970-01-02"), "vztrajnost");
    assert.equal(temaDneva("1970-01-08"), "majhni koraki");
    assert.equal(temaDneva("2026-11-21"), "produktivnost"); // 20778 mod 7 = 2
    assert.equal(temaDneva("2026-11-22"), "mir in ravnovesje"); // 20779 mod 7 = 3
    assert.equal(temaDneva("2026-11-21", "vecer"), "zaključek");
    for (const t of TEME) assert.ok(OPISI_TEM[t].length > 10);
  });

  it("v tednu dni se tema ne ponovi", () => {
    const teme = new Set<string>();
    for (let d = 21; d < 28; d++) teme.add(temaDneva(`2026-11-${d}`));
    assert.equal(teme.size, 7);
  });
});

describe("osebna misel", () => {
  it("citat nikoli, osebno vedno, oboje: ena osebna in ena navadna na dan", () => {
    for (const dan of ["2026-11-21", "2026-11-22"]) for (const del of ["jutro", "vecer"] as const) {
      assert.equal(jeOsebnaMisel("citat", dan, del), false);
      assert.equal(jeOsebnaMisel("osebno", dan, del), true);
    }
    assert.equal(jeOsebnaMisel("oboje", "2026-11-21", "jutro"), false); // sodo stevilo
    assert.equal(jeOsebnaMisel("oboje", "2026-11-21", "vecer"), true);
    assert.equal(jeOsebnaMisel("oboje", "2026-11-22", "jutro"), true);
    assert.equal(jeOsebnaMisel("oboje", "2026-11-22", "vecer"), false);
  });
});

describe("nastavitve", () => {
  it("privzete: vklopljeno, vecer, citat, malo humorja", () => {
    assert.deepEqual(PRIVZETE_NASTAVITVE, { vklopljena: true, vecer: true, slog: "citat", humor: "malo" });
  });

  it("veljaven popravek se zdruzi, ostalo ostane", () => {
    assert.deepEqual(zdruziNastavitve(PRIVZETE_NASTAVITVE, { humor: "vec" }), { vklopljena: true, vecer: true, slog: "citat", humor: "vec" });
    assert.deepEqual(zdruziNastavitve(PRIVZETE_NASTAVITVE, { vklopljena: false, vecer: false, slog: "oboje", humor: "brez" }), {
      vklopljena: false,
      vecer: false,
      slog: "oboje",
      humor: "brez",
    });
  });

  it("neveljaven popravek je null (neznan kljuc, napacna vrednost, napacna oblika)", () => {
    for (const p of [{}, [], null, undefined, "da", 5, { neznano: true }, { humor: "zelo" }, { slog: "x" }, { vklopljena: "da" }, { vecer: 1 }, { humor: "vec", neznano: 1 }])
      assert.equal(zdruziNastavitve(PRIVZETE_NASTAVITVE, p), null, JSON.stringify(p));
  });

  it("popravek ne spremeni trenutnih nastavitev (nov objekt)", () => {
    const trenutne = { ...PRIVZETE_NASTAVITVE };
    zdruziNastavitve(trenutne, { humor: "vec" });
    assert.deepEqual(trenutne, PRIVZETE_NASTAVITVE);
  });
});

describe("vnaprej pripravljene misli", () => {
  it("40 jutranjih in 20 vecernih, vse razlicne, dolzina v mejah, brez stevk in povezav", () => {
    assert.equal(VNAPREJ.length, 40);
    assert.equal(VNAPREJ_VECER.length, 20);
    assert.equal(new Set(VNAPREJ.map(primerjalno)).size, 40);
    assert.equal(new Set(VNAPREJ_VECER.map(primerjalno)).size, 20);
    for (const b of [...VNAPREJ, ...VNAPREJ_VECER]) {
      assert.ok(b.length >= 20 && b.length <= MOTIVACIJA_NAJVEC_ZNAKOV, b);
      assert.equal(/\d|https?:|@/.test(b), false, b);
    }
    for (const b of VNAPREJ_VECER) assert.equal(VNAPREJ.includes(b), false);
  });

  it("vsaka prestane isto preverbo kot odgovor modela (nespremenjena)", () => {
    for (const b of [...VNAPREJ, ...VNAPREJ_VECER]) assert.equal(ocistiOdgovorModela(b), b, b);
  });

  it("zlata izbira: dan 0 je prva, dan 1 druga, dan 40 spet prva; vecer ima svoj nabor (dan 20 spet prva)", () => {
    assert.equal(izberiVnaprej("1970-01-01"), VNAPREJ[0]);
    assert.equal(izberiVnaprej("1970-01-02"), VNAPREJ[1]);
    assert.equal(izberiVnaprej("1970-02-10"), VNAPREJ[0]);
    assert.equal(izberiVnaprej("1970-01-01", [], "vecer"), VNAPREJ_VECER[0]);
    assert.equal(izberiVnaprej("1970-01-02", [], "vecer"), VNAPREJ_VECER[1]);
    assert.equal(izberiVnaprej("1970-01-21", [], "vecer"), VNAPREJ_VECER[0]);
  });

  it("40 zaporednih dni je 40 razlicnih jutranjih, 20 je 20 razlicnih vecernih, vsak dan drugacen od prejsnjega", () => {
    const dnevi = Array.from({ length: 40 }, (_, d) => new Date(Date.UTC(2026, 10, 21 + d)).toISOString().slice(0, 10));
    const jutra = dnevi.map((d) => izberiVnaprej(d));
    assert.equal(new Set(jutra).size, 40);
    for (let i = 1; i < jutra.length; i++) assert.notEqual(jutra[i], jutra[i - 1]);
    const veceri = dnevi.slice(0, 20).map((d) => izberiVnaprej(d, [], "vecer"));
    assert.equal(new Set(veceri).size, 20);
  });

  it("deterministicno: isti dan, ista misel", () => {
    assert.equal(izberiVnaprej("2026-11-21"), izberiVnaprej("2026-11-21"));
  });

  it("misel iz zgodovine se preskoci (tudi z drugimi velikimi crkami in brez locil)", () => {
    const osnovna = izberiVnaprej("2026-11-21");
    const naslednja = izberiVnaprej("2026-11-21", [osnovna.toUpperCase().replace(/\./g, "")]);
    assert.notEqual(naslednja, osnovna);
    assert.equal(VNAPREJ.includes(naslednja), true);
    const vecerna = izberiVnaprej("2026-11-21", [], "vecer");
    assert.notEqual(izberiVnaprej("2026-11-21", [vecerna], "vecer"), vecerna);
  });

  it("vse v zgodovini: se vedno vrne misel (osnovna)", () => {
    assert.equal(izberiVnaprej("1970-01-01", [...VNAPREJ]), VNAPREJ[0]);
    assert.equal(izberiVnaprej("1970-01-01", [...VNAPREJ_VECER], "vecer"), VNAPREJ_VECER[0]);
  });
});

describe("zapiski o uporabniku", () => {
  it("ne-niz, prazno in skrivnost so prazni", () => {
    for (const v of [undefined, null, 5, {}, "", "   "]) assert.equal(ocistiZapiske(v), "");
    assert.equal(ocistiZapiske("Moje geslo je abc123xyz"), "");
  });

  it("presledki se strnejo, dolzina je omejena", () => {
    assert.equal(ocistiZapiske("  Delam   na\nprojektu.  "), "Delam na projektu.");
    assert.equal(ocistiZapiske("a ".repeat(500)).length <= NAJVEC_ZNAKOV_ZAPISKOV, true);
    assert.equal(ocistiZapiske("b".repeat(700)).length, 600);
    assert.equal(NAJVEC_ZNAKOV_ZAPISKOV, 600);
  });
});

describe("navodilo modelu", () => {
  const osnova = { dan: "2026-11-21", del: "jutro", humor: "malo" } as const;

  it("jutro: tema dneva, slogan, ton, omejitve; brez povezav, e-postnih naslovov in osebnih podatkov", () => {
    const n = sestaviNavodilo(osnova);
    assert.ok(n.system.includes(`Tema današnjega dne: ${OPISI_TEM.produktivnost}.`));
    assert.ok(n.system.includes(`»${MOTIVACIJA_SLOGAN}«`));
    assert.ok(n.system.includes("jutranjo"));
    assert.ok(n.system.includes("droben, prijazen nasmešek"));
    assert.ok(n.system.includes("240"));
    assert.ok(n.system.includes("slovenščini"));
    assert.equal(n.system.includes("navdih"), false);
    assert.equal(n.text, "Dan v tednu: sobota.\nNapiši novo misel.");
    assert.equal(/https?:|@/.test(n.system + n.text), false);
  });

  it("vecer: zakljucek dneva brez teme", () => {
    const n = sestaviNavodilo({ ...osnova, del: "vecer" });
    assert.ok(n.system.includes("večerno"));
    assert.ok(n.system.includes("zaključek dneva"));
    assert.equal(n.system.includes("Tema današnjega dne"), false);
    assert.equal(n.system.includes("jutranjo"), false);
  });

  it("humor: brez, malo, vec", () => {
    assert.ok(sestaviNavodilo({ ...osnova, humor: "brez" }).system.includes("Brez humorja"));
    assert.ok(sestaviNavodilo({ ...osnova, humor: "vec" }).system.includes("igriva"));
    assert.equal(sestaviNavodilo({ ...osnova, humor: "brez" }).system.includes("igriva"), false);
    assert.equal(sestaviNavodilo({ ...osnova, humor: "vec" }).system.includes("Brez humorja"), false);
  });

  it("zapiski gredo v besedilo in sistem poudari samo navdih; skrivnost se ne poslje", () => {
    const n = sestaviNavodilo({ ...osnova, zapiski: "Delam na velikem projektu." });
    assert.ok(n.text.includes("Zapiski o uporabniku: Delam na velikem projektu."));
    assert.ok(n.system.includes("samo za navdih"));
    const s = sestaviNavodilo({ ...osnova, zapiski: "Moje geslo je abc123xyz" });
    assert.equal(s.text.includes("Zapiski"), false);
    assert.equal(s.system.includes("navdih"), false);
  });

  it("v navodilo gre najvec 5 prejsnjih misli, vsaka skrajsana na 160 znakov", () => {
    const zgodovina = Array.from({ length: 7 }, (_, i) => `Misel ${i}: ${"x".repeat(300)}`);
    const n = sestaviNavodilo({ ...osnova, dan: "2026-11-22" }, zgodovina);
    const vrstice = n.text.split("\n").filter((v) => v.startsWith("- "));
    assert.equal(vrstice.length, 5);
    for (const v of vrstice) assert.equal(v.length, 2 + 160);
    assert.ok(n.text.startsWith("Dan v tednu: nedelja.\nTeh misli ne ponovi:\n- Misel 0"));
    assert.equal(n.text.includes("Misel 5"), false);
  });
});

describe("ciscenje odgovora modela", () => {
  const dobra = "Majhen korak danes naredi večjo razliko, kot si misliš.";

  it("ne-nizi so zavrnjeni", () => {
    for (const v of [undefined, null, 5, {}, ["x"]]) assert.equal(ocistiOdgovorModela(v), null);
  });

  it("dobra misel gre skozi nespremenjena", () => {
    assert.equal(ocistiOdgovorModela(dobra), dobra);
  });

  it("narekovaji, oznake seznama, krepki tisk in emojiji so odstranjeni", () => {
    assert.equal(ocistiOdgovorModela(`„${dobra}“`), dobra);
    assert.equal(ocistiOdgovorModela(`"${dobra}"`), dobra);
    assert.equal(ocistiOdgovorModela(`- ${dobra}`), dobra);
    assert.equal(ocistiOdgovorModela(`> ${dobra}`), dobra);
    assert.equal(ocistiOdgovorModela(`# ${dobra}`), dobra);
    assert.equal(ocistiOdgovorModela("Majhen korak danes **naredi** večjo razliko, kot si misliš."), dobra);
    assert.equal(ocistiOdgovorModela(`${dobra} 🌱`), dobra);
  });

  it("vrstice in presledki se strnejo v eno vrstico", () => {
    assert.equal(ocistiOdgovorModela("Majhen korak danes\n\nnaredi   večjo razliko, kot si misliš."), dobra);
  });

  it("dolzina: 19 zavrnjeno, 20 sprejeto, 279 in 280 sprejeto", () => {
    assert.equal(ocistiOdgovorModela("a".repeat(18) + "."), null);
    assert.equal(ocistiOdgovorModela("a".repeat(19) + "."), "a".repeat(19) + ".");
    const dolga = `${"beseda ".repeat(39)}konec.`;
    assert.equal(dolga.length, 279);
    assert.equal(ocistiOdgovorModela(dolga), dolga);
    const tocno = `${"beseda ".repeat(39)}konec!!`;
    assert.equal(tocno.length, 280);
    assert.equal(ocistiOdgovorModela(tocno), tocno);
  });

  it("predolg odgovor: odrezan na zadnji celi stavek, sicer zavrnjen", () => {
    const stavek = "Danes naredi en majhen korak.";
    const dolg = `${stavek} ${"beseda ".repeat(60)}konec.`;
    assert.ok(dolg.length > 280);
    assert.equal(ocistiOdgovorModela(dolg), stavek);
    assert.equal(ocistiOdgovorModela("beseda ".repeat(60)), null);
  });

  it("povezave, e-posta, stevilke od 4 mest naprej in znamke kode so zavrnjene", () => {
    for (const v of [
      "Obišči https://primer.si in naredi majhen korak.",
      "Piši na korak@primer.si in naredi majhen korak.",
      "Naredi majhen korak na www.primer.si danes.",
      "Leta 2026 naredi majhen korak vsak dan zjutraj.",
      "Majhen korak <b>danes</b> naredi razliko vsak dan.",
      "Majhen korak {danes} naredi razliko vsak dan res.",
      "Majhen korak `danes` naredi razliko vsak dan res.",
      "Majhen korak [danes] naredi razliko vsak dan res.",
      "Majhen korak | danes naredi razliko vsak dan res.",
    ])
      assert.equal(ocistiOdgovorModela(v), null, v);
    assert.equal(ocistiOdgovorModela("Naredi 3 majhne korake danes in ostani pri tem."), "Naredi 3 majhne korake danes in ostani pri tem.");
  });

  it("skrivnost v odgovoru je zavrnjena", () => {
    assert.equal(ocistiOdgovorModela("Tvoje geslo je abc123xyz, uporabi ga vsak dan."), null);
    assert.equal(ocistiOdgovorModela("Majhen korak danes naredi razliko sk-abcdefghijklmnop."), null);
  });

  it("uvod modela, obljube in zdravstveni ali financni nasveti so zavrnjeni", () => {
    for (const v of [
      "Seveda! Majhen korak danes naredi večjo razliko.",
      "Tukaj je misel: majhen korak naredi razliko.",
      "Garantiram, da te majhen korak pripelje do cilja.",
      "Majhen korak je kot zdravljenje za utrujenega človeka.",
      "Investiraj danes malo in prihodnost bo lepša.",
      "Naložbe v majhne korake se obrestujejo vsak dan.",
    ])
      assert.equal(ocistiOdgovorModela(v), null, v);
  });

  it("ponovitev prejsnje misli (velikost crk, locila, diakritike) je zavrnjena", () => {
    assert.equal(ocistiOdgovorModela(dobra, [dobra]), null);
    assert.equal(ocistiOdgovorModela(dobra, ["MAJHEN KORAK DANES NAREDI VECJO RAZLIKO, KOT SI MISLIS"]), null);
    assert.equal(ocistiOdgovorModela(dobra, ["Čisto druga misel o vztrajnosti."]), dobra);
  });
});
