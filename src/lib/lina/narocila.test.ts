import assert from "node:assert/strict";
import { test } from "node:test";
import {
  izberiPoMotivu,
  kljucNaloga,
  najdiNalogVBesedilu,
  narocilaIzTabele,
  narociloIzBesedila,
  odtisMotiva,
  poveziSliko,
  razdaljaOdtisov,
  type Narocilo,
} from "./narocila.ts";
import type { Slika } from "./kakovost.ts";

// Lastnik 23. 11. 2026: ob slikanju majice Lina ve, kateri stranki pripada in kaksen je motiv. Stranke so izmisljene.
const N = (stevilka: string, stranka: string, motiv = ""): Narocilo => ({ stevilka, stranka, motiv, kolicina: null, rok: "", vir: "t.csv" });

test("tabela: glava s sopomenkami (SL), vrstice v narocila, kolicina stevilo", () => {
  const { narocila, glava } = narocilaIzTabele(
    [
      ["Izvoz 24.11.2026"],
      ["Št. naloga", "Naročnik", "Motiv", "Količina", "Rok"],
      ["DN-2026/0153", "Kolesarski klub Primer", "logo-kk.png", "120", "2026-12-01"],
      ["DN-2026/0154", "Šola Vzorec", "Grb sole", "35 kos", "5. 12. 2026"],
      ["", "", "", "", ""],
    ],
    "izvoz.csv",
  );
  assert.ok(glava);
  assert.equal(narocila.length, 2);
  assert.deepEqual(narocila[0], {
    stevilka: "DN-2026/0153", stranka: "Kolesarski klub Primer", motiv: "logo-kk.png", kolicina: 120, rok: "2026-12-01", vir: "izvoz.csv",
  });
  assert.equal(narocila[1].kolicina, 35);
});

test("tabela: angleska glava (Order, Customer, Design, Qty, Due)", () => {
  const { narocila } = narocilaIzTabele([["Order no", "Customer", "Design", "Qty", "Due date"], ["A-77", "Demo d.o.o.", "star", "10", "1.1.2027"]], "x.xlsx");
  assert.equal(narocila[0].stevilka, "A-77");
  assert.equal(narocila[0].stranka, "Demo d.o.o.");
  assert.equal(narocila[0].motiv, "star");
});

test("tabela brez prepoznane glave: ne ugiba, vrne prvo vrstico za rocno dolocitev stolpcev", () => {
  const r = narocilaIzTabele([["a", "b", "c"], ["1", "2", "3"]], "x.csv");
  assert.equal(r.narocila.length, 0);
  assert.equal(r.glava, null);
  assert.deepEqual(r.neprepoznano, ["a", "b", "c"]);
});

test("delovni nalog kot besedilo (PDF/e-posta): oznake v vrsticah", () => {
  const n = narociloIzBesedila(
    "DELOVNI NALOG\nŠtevilka naloga: DN-2026/0153\nStranka: Kolesarski klub Primer\nMotiv: logo-kk.png\nKoličina: 120 kos\nRok: 1. 12. 2026\n",
    "nalog.pdf",
  );
  assert.deepEqual(n, { stevilka: "DN-2026/0153", stranka: "Kolesarski klub Primer", motiv: "logo-kk.png", kolicina: 120, rok: "1. 12. 2026", vir: "nalog.pdf" });
  assert.equal(narociloIzBesedila("Pozdravljeni, lep dan.", "x.txt"), null);
});

test("kljuc naloga: brez locil, velike crke, OCR zamenjave O->0, I/L->1", () => {
  assert.equal(kljucNaloga("dn-2026/0153"), "DN20260153");
  assert.equal(kljucNaloga("DN 2O26 Ol53"), "DN20260153");
});

test("povezava s kodo: QR ali OCR besedilo najde natanko en nalog", () => {
  const nar = [N("DN-2026/0153", "Klub"), N("DN-2026/0154", "Sola"), N("15", "Kratka")];
  const r = najdiNalogVBesedilu("LINA-NALOG:DN-2026-0153", nar);
  assert.equal(r.izid, "najden");
  assert.equal(r.izid === "najden" && r.narocilo.stranka, "Klub");
  // OCR z napakami in presledki
  assert.equal(najdiNalogVBesedilu("Nalog st. DN 2O26 / O154 kos 35", nar).izid, "najden");
  // del daljse stevilke ni zadetek (0153 ni 01534), kratke stevilke (<3) se ne iscejo v prostem besedilu
  assert.equal(najdiNalogVBesedilu("DN-2026/01534", nar).izid, "ni");
  assert.equal(najdiNalogVBesedilu("velikost 15 cm", nar).izid, "ni");
});

test("povezava s kodo: dva razlicna naloga v besedilu = ni mogoce dolociti (nikoli ugibanje stranke)", () => {
  const nar = [N("DN-2026/0153", "Klub"), N("DN-2026/0154", "Sola")];
  const r = najdiNalogVBesedilu("DN-2026/0153 in DN-2026/0154", nar);
  assert.equal(r.izid, "vec");
  assert.equal(r.izid === "vec" && r.kandidati.length, 2);
});

function slika(f: (x: number, y: number) => number, s = 32): Slika {
  const p = new Uint8Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) p[y * s + x] = Math.max(0, Math.min(255, Math.round(f(x, y))));
  return { sirina: s, visina: s, podatki: p };
}

test("odtis motiva: ista slika svetlejsa ~ enaka, drug motiv dalec", () => {
  const krog = slika((x, y) => ((x - 16) ** 2 + (y - 16) ** 2 < 100 ? 30 : 220));
  const krogSvetel = slika((x, y) => ((x - 16) ** 2 + (y - 16) ** 2 < 100 ? 60 : 250));
  const crte = slika((x) => (x % 8 < 4 ? 20 : 230));
  const [a, b, c] = [odtisMotiva(krog), odtisMotiva(krogSvetel), odtisMotiva(crte)];
  assert.ok(a && b && c);
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.ok(razdaljaOdtisov(a, b) <= 2);
  assert.ok(razdaljaOdtisov(a, c) > 10);
  assert.equal(odtisMotiva({ sirina: 0, visina: 0, podatki: new Uint8Array() }), null);
});

test("izbira po motivu: samo jasen zmagovalec (prag in razlika do drugega)", () => {
  const a = N("1001", "A"), b = N("1002", "B");
  assert.equal(izberiPoMotivu("0000000000000000", [{ narocilo: a, odtis: "0000000000000001" }, { narocilo: b, odtis: "ffffffffffffffff" }]).izid, "najden");
  // oba blizu = vec
  assert.equal(izberiPoMotivu("0000000000000000", [{ narocilo: a, odtis: "0000000000000001" }, { narocilo: b, odtis: "0000000000000003" }]).izid, "vec");
  // nobeden blizu = ni
  assert.equal(izberiPoMotivu("0000000000000000", [{ narocilo: a, odtis: "ffffffff00000000" }]).izid, "ni");
});

test("poveziSliko: koda ima prednost; ob vec kandidatih odloci motiv; brez kode samo motiv", () => {
  const nar = [N("DN-0001", "A"), N("DN-0002", "B")];
  const odtisi = { [kljucNaloga("DN-0001")]: "0000000000000000", [kljucNaloga("DN-0002")]: "ffffffffffffffff" };
  const k = poveziSliko({ prebrano: "DN-0002" }, nar, odtisi);
  assert.equal(k.izid === "najden" && k.nacin, "koda");
  assert.equal(k.izid === "najden" && k.narocilo.stranka, "B");
  const v = poveziSliko({ prebrano: "DN-0001 DN-0002", odtis: "0000000000000000" }, nar, odtisi);
  assert.equal(v.izid === "najden" && v.nacin, "motiv");
  assert.equal(v.izid === "najden" && v.narocilo.stranka, "A");
  const m = poveziSliko({ odtis: "fffffffffffffffe" }, nar, odtisi);
  assert.equal(m.izid === "najden" && m.narocilo.stranka, "B");
  assert.equal(poveziSliko({}, nar, odtisi).izid, "ni");
});
