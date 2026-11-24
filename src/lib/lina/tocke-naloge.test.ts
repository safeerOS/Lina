/**
 * Tocke naloge s preverbo (23. 11. 2026: Lina je Claude Codu poslala 5 tock, narejena 1, nihce ni opazil). Cista logika: razbitje
 * naloge na tocke, navodilo za porocilo po tockah (SL in EN), razbor porocila in povzetek »3/5 narejeno«.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NAJVEC_TOCK,
  besediloPredlogaTock,
  izpisPorocila,
  navodiloTock,
  povzetekTock,
  razberiPorociloTock,
  tockeNaloge,
  varnaRelativnaPot,
} from "./tocke-naloge.ts";

describe("tockeNaloge: razbitje naloge na ostevilcene tocke", () => {
  it("ostevilcen seznam (1. in 2)) da tocke; uvodno besedilo ni tocka; nadaljevalne vrstice ostanejo pri tocki", () => {
    const t = tockeNaloge("Popravi Lino:\n1. dodaj preizkus\n   za klic\n2) popravi zaslon\n\n3. posodobi AGENTS.md\nKonec.");
    assert.deepEqual(t, ["dodaj preizkus za klic", "popravi zaslon", "posodobi AGENTS.md"]);
  });

  it("brez ostevilcenega seznama: alineje (vsaj dve) so tocke; sicer je cela naloga ena tocka", () => {
    assert.deepEqual(tockeNaloge("Naredi:\n- prvo\n- drugo"), ["prvo", "drugo"]);
    assert.deepEqual(tockeNaloge("Dodaj preizkus za ceno."), ["Dodaj preizkus za ceno."]);
    assert.deepEqual(tockeNaloge("Samo ena:\n- alineja"), ["Samo ena: - alineja"]);
  });

  it("vec kot NAJVEC_TOCK tock: nobena se ne izgubi (preostale so zdruzene v zadnjo)", () => {
    const besedilo = Array.from({ length: NAJVEC_TOCK + 3 }, (_, i) => `${i + 1}. t${i + 1}`).join("\n");
    const t = tockeNaloge(besedilo);
    assert.equal(t.length, NAJVEC_TOCK);
    assert.match(t.at(-1)!, new RegExp(`t${NAJVEC_TOCK}.*t${NAJVEC_TOCK + 3}`));
  });
});

describe("navodiloTock: kaj agent dobi v NALOGA.md", () => {
  it("vse tocke ostevilcene T1..Tn in oblika vrstice porocila v SL in EN", () => {
    const n = navodiloTock(["prvo", "drugo"]).join("\n");
    assert.match(n, /T1: prvo/);
    assert.match(n, /T2: drugo/);
    assert.match(n, /T<n>: narejeno - dokaz:/);
    assert.match(n, /T<n>: ni narejeno - razlog:/);
    assert.match(n, /done - evidence:/);
    assert.match(n, /not done - reason:/);
  });
});

describe("razberiPorociloTock: porocilo je nezaupljivo besedilo", () => {
  const porocilo = [
    "Porocilo",
    "T1: narejeno - dokaz: `src/a.ts`; preizkus: src/a.test.ts; commit: 0123abcd",
    "- T2: done - evidence: file: docs/b.md:12",
    "T3: ni narejeno - razlog: ni casa",
    "T4: narejeno",
    "T9: narejeno - dokaz: x.ts",
    "",
    "# tests 3",
    "ok 1 - a.test.ts",
  ].join("\n");

  it("vsaka tocka dobi stanje in dokaze; tocka brez vrstice manjka; tocka izven obsega se prezre", () => {
    const r = razberiPorociloTock(porocilo, 5);
    assert.equal(r.length, 5);
    assert.deepEqual(r[0], { st: 1, stanje: "narejeno", dokazi: [{ vrsta: "pot", vrednost: "src/a.ts" }, { vrsta: "preizkus", vrednost: "src/a.test.ts" }, { vrsta: "commit", vrednost: "0123abcd" }] });
    assert.deepEqual(r[1], { st: 2, stanje: "narejeno", dokazi: [{ vrsta: "pot", vrednost: "docs/b.md" }] });
    assert.deepEqual(r[2], { st: 3, stanje: "ni-narejeno", dokazi: [] });
    assert.deepEqual(r[3], { st: 4, stanje: "narejeno", dokazi: [] });
    assert.deepEqual(r[4], { st: 5, stanje: "manjka", dokazi: [] });
  });

  it("dvojna vrstica iste tocke: velja prva (kasnejsa ne more preglasiti »ni narejeno«)", () => {
    const r = razberiPorociloTock("T1: ni narejeno - razlog: x\nT1: narejeno - dokaz: a.ts", 1);
    assert.equal(r[0]!.stanje, "ni-narejeno");
  });

  it("izpis porocila (za preverbo preizkusa) so vrstice, ki niso vrstice tock", () => {
    const iz = izpisPorocila(porocilo);
    assert.match(iz, /ok 1 - a\.test\.ts/);
    assert.doesNotMatch(iz, /T1:/);
  });
});

describe("varnaRelativnaPot: dokaz je samo pot znotraj projekta", () => {
  it("relativna pot ostane; absolutna znotraj projekta postane relativna; .., zunanja, .lina-naloge in prazno so zavrnjeni", () => {
    assert.equal(varnaRelativnaPot("src/a.ts", "/p"), "src/a.ts");
    assert.equal(varnaRelativnaPot("./src/a.ts", "/p"), "src/a.ts");
    assert.equal(varnaRelativnaPot("/p/src/a.ts", "/p"), "src/a.ts");
    assert.equal(varnaRelativnaPot("/etc/passwd", "/p"), null);
    assert.equal(varnaRelativnaPot("../x", "/p"), null);
    assert.equal(varnaRelativnaPot("src/../../x", "/p"), null);
    assert.equal(varnaRelativnaPot(".lina-naloge/0123456789abcdef/POROCILO.md", "/p"), null);
    assert.equal(varnaRelativnaPot("", "/p"), null);
    assert.equal(varnaRelativnaPot("a\u0000b", "/p"), null);
  });
});

describe("povzetekTock in predlog za manjkajoce", () => {
  const tocke = ["prvo", "drugo", "tretje"];
  const izid = [
    { st: 1, narejeno: true, razlog: null },
    { st: 2, narejeno: false, razlog: "dokaz-ni-najden" as const },
    { st: 3, narejeno: false, razlog: "manjka" as const },
  ];

  it("povzetek: skupaj, narejeno, popolno in seznam manjkajocih s stevilko, besedilom tocke in razlogom", () => {
    const p = povzetekTock(tocke, izid);
    assert.equal(p.skupaj, 3);
    assert.equal(p.narejeno, 1);
    assert.equal(p.popolno, false);
    assert.deepEqual(p.manjkajoce, [{ st: 2, besedilo: "drugo", razlog: "dokaz-ni-najden" }, { st: 3, besedilo: "tretje", razlog: "manjka" }]);
    assert.equal(povzetekTock(["a"], [{ st: 1, narejeno: true, razlog: null }]).popolno, true);
  });

  it("predlog nove naloge: samo besedilo tock iz naloge (nikoli iz porocila), ostevilceno, v meji znakov", () => {
    const b = besediloPredlogaTock("0123456789abcdef", povzetekTock(tocke, izid), 1500);
    assert.match(b, /0123456789abcdef/);
    assert.match(b, /1\/3/);
    assert.deepEqual(tockeNaloge(b), ["drugo", "tretje"]);
    const dolgo = povzetekTock(["x".repeat(3000), "y".repeat(3000)], [{ st: 1, narejeno: false, razlog: "manjka" }, { st: 2, narejeno: false, razlog: "manjka" }]);
    const k = besediloPredlogaTock("0123456789abcdef", dolgo, 1500);
    assert.ok(k.length <= 1500, String(k.length));
    assert.equal(tockeNaloge(k).length, 2);
  });
});
