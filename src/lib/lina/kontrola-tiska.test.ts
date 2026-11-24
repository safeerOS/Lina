import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GLAVA_CSV,
  NAJVEC_PORAVNANE,
  PAKETI_VIDA,
  PRIVZETA_MERITEV,
  STIRI_OZNAKE,
  argumentiPip,
  celicaCsv,
  normirajNastavitve,
  odstraniStevilke,
  preveriIzid,
  pythonOkolja,
  sistemskiPython,
  vrsticaCsv,
  vrstaSlike,
} from "./kontrola-tiska.ts";

const DOBER = {
  ocena: "NI OK",
  razlogi: ["vodoravni odmik +6.0 mm (meja 5.0 mm)"],
  napake: [{ vrsta: "madez zunaj motiva", okvir_mm: [-60, 190, 5, 4], povrsina_mm2: 12.5, dE00_najvec: 40.2 }],
  oznake_najdene: [0, 1, 2, 3],
  polozaj: { zgoraj_sredina_mm: [6, 75], odmik_x_mm: 6, odmik_y_mm: 0.1, zasuk_deg: -0.2, sirina_mm: 250.5, sirina_odstopanje_rel: 0.002 },
  barva: { dE00_povprecje: 1.2, dE00_p95: 2.5 },
  registracija: { najvecji_zamik_mm: 0.1, plasti: [{ barva_srgb: [200, 40, 40], glede_na_kljucno_mm: [0.1, 0], zanesljivost: 0.9 }] },
  referenca: { vrsta: "motiv" },
};

test("privzete nastavitve so iz prototipa (ena kartica 50 mm, tolerance iz nacrta)", () => {
  const n = normirajNastavitve(undefined);
  assert.ok(n.ok);
  assert.deepEqual(n.nastavitve.meritev, PRIVZETA_MERITEV);
  assert.equal(n.nastavitve.opisZModelom, false, "model z vidom privzeto izklopljen");
  assert.equal(n.nastavitve.meritev.tolerance.odmik_x_mm, 5);
  assert.equal(n.nastavitve.meritev.tolerance.dE00_povprecje, 5);
});

test("nastavitve: veljavne stiri oznake in tolerance se sprejmejo", () => {
  const n = normirajNastavitve({ meritev: { oznake: STIRI_OZNAKE, obmocje_mm: [-260, -90, 260, 520], tolerance: { odmik_x_mm: 2 } }, opisZModelom: true });
  assert.ok(n.ok);
  assert.equal(Object.keys(n.nastavitve.meritev.oznake).length, 4);
  assert.equal(n.nastavitve.meritev.tolerance.odmik_x_mm, 2);
  assert.equal(n.nastavitve.meritev.tolerance.odmik_y_mm, 5, "nepodana toleranca ostane privzeta");
  assert.equal(n.nastavitve.opisZModelom, true);
});

test("nastavitve: neveljavno polje zavrne celoto z imenom polja (nic se ne popravi potiho)", () => {
  const primeri: Array<[unknown, string]> = [
    [{ meritev: { tolerance: { odmik_x_mm: -1 } } }, "tolerance.odmik_x_mm"],
    [{ meritev: { tolerance: { zasuk_deg: Number.NaN } } }, "tolerance.zasuk_deg"],
    [{ meritev: { oznake: { "50": [0, 0, 50] } } }, "oznake"],
    [{ meritev: { oznake: { "0": [0, 0, 200] } } }, "oznake"],
    [{ meritev: { oznake: {} } }, "oznake"],
    [{ meritev: { px_na_mm: 50 } }, "px_na_mm"],
    [{ meritev: { obmocje_mm: [10, 0, 0, 10] } }, "obmocje_mm"],
    [{ meritev: { slovar_aruco: "DICT_6X6_250" } }, "slovar_aruco"],
    [{ meritev: { pricakovano: { zgoraj_sredina_mm: [0], sirina_mm: 250 } } }, "pricakovano"],
    [{ opisZModelom: "da" }, "opisZModelom"],
    [{ mapaDnevnika: "a\0b" }, "mapaDnevnika"],
  ];
  for (const [vnos, polje] of primeri) {
    const n = normirajNastavitve(vnos);
    assert.equal(n.ok, false, polje);
    if (!n.ok) assert.ok(n.napake.includes(polje), `${polje}: ${n.napake}`);
  }
});

test("nastavitve: obmocje x locljivost nad mejo pomnilnika je zavrnjeno", () => {
  const n = normirajNastavitve({ meritev: { px_na_mm: 10, obmocje_mm: [-1000, -1000, 1000, 1000] } });
  assert.equal(n.ok, false);
  assert.ok(2000 * 10 * 2000 * 10 > NAJVEC_PORAVNANE);
});

test("izid: veljaven NI OK se prenese, merilo iz sirine", () => {
  const i = preveriIzid(DOBER);
  assert.equal(i.ocena, "NI OK");
  assert.equal(i.polozaj?.odmik_x_mm, 6);
  assert.equal(i.merilo, 1.002);
  assert.equal(i.napake.length, 1);
  assert.equal(i.registracija?.najvecji_zamik_mm, 0.1);
  assert.deepEqual(i.oznakeNajdene, [0, 1, 2, 3]);
});

test("izid: nikoli lazni OK - manjkajoc polozaj, protislovje, smeti so NI MOGOCE IZMERITI", () => {
  const brezPolozaja = { ...DOBER, ocena: "OK", razlogi: [], napake: [], polozaj: undefined };
  const okZRazlogi = { ...DOBER, ocena: "OK" };
  const nanX = { ...DOBER, polozaj: { ...DOBER.polozaj, odmik_x_mm: null } };
  const niOkBrezRazloga = { ...DOBER, razlogi: [] };
  for (const s of [null, "OK", [], { ocena: "ok" }, brezPolozaja, okZRazlogi, nanX, niOkBrezRazloga]) {
    assert.equal(preveriIzid(s).ocena, "NI MOGOCE IZMERITI", JSON.stringify(s));
  }
});

test("izid: NI MOGOCE IZMERITI iz Pythona obdrzi kodo in razlog", () => {
  const i = preveriIzid({ ocena: "NI MOGOCE IZMERITI", napaka: "knjiznice-manjkajo", razlogi: ["No module named cv2"] });
  assert.equal(i.napaka, "knjiznice-manjkajo");
  assert.deepEqual(i.razlogi, ["No module named cv2"]);
});

test("izid: krmilni znaki in predolgi nizi so ocisceni, napak najvec 200", () => {
  const i = preveriIzid({
    ...DOBER,
    razlogi: ["a\u202eb\nc".padEnd(1000, "x")],
    napake: Array.from({ length: 500 }, () => DOBER.napake[0]),
  });
  assert.ok(!/[\u202e\n]/.test(i.razlogi[0]));
  assert.ok(i.razlogi[0].length <= 300);
  assert.equal(i.napake.length, 200);
});

test("CSV: formule se nevtralizirajo, stevila ostanejo, narekovaji podvojeni", () => {
  assert.equal(celicaCsv("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
  assert.equal(celicaCsv("@SUM(A1)"), `"'@SUM(A1)"`);
  assert.equal(celicaCsv("+1-2"), `"'+1-2"`);
  assert.equal(celicaCsv(-0.25), `"-0,25"`, "decimalna vejica (slovenski Excel)");
  assert.equal(celicaCsv("-0.25"), `"'-0.25"`, "niz, ki ni stevilo, se nevtralizira");
  assert.equal(celicaCsv(null), `""`);
  const v = vrsticaCsv({ id: "20261124-120000-abcdef", cas: "2026-11-24T11:00:00.000Z", nalog: "=cmd", referenca: "motiv.png", vrstaReference: "motiv", izid: preveriIzid(DOBER), slika: "x.png" });
  assert.equal(v.split(";").length, GLAVA_CSV.split(";").length);
  assert.ok(v.includes(`"'=cmd"`));
  assert.ok(v.includes(`"NI OK"`));
});

test("vrsta slike po bajtih: JPEG, PNG; drugo ne", () => {
  assert.equal(vrstaSlike(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "jpg");
  assert.equal(vrstaSlike(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "png");
  assert.equal(vrstaSlike(Buffer.from("%PDF-1.4")), null);
  assert.equal(vrstaSlike(Buffer.from("GIF89a")), null);
});

test("namestitev: okolje po sistemu (Linux bin/python, Windows Scripts\\python.exe), samo kolesa, natancne razlicice", () => {
  assert.equal(pythonOkolja("/d/kontrola-tiska-python", false), "/d/kontrola-tiska-python/bin/python");
  assert.equal(pythonOkolja("C:\\L\\kontrola-tiska-python", true), "C:\\L\\kontrola-tiska-python\\Scripts\\python.exe");
  assert.deepEqual(sistemskiPython(true), { program: "py", args: ["-3"] });
  assert.deepEqual(sistemskiPython(false), { program: "python3", args: [] });
  const a = argumentiPip();
  assert.ok(a.includes("--only-binary=:all:"));
  assert.ok(PAKETI_VIDA.every((p) => /==\d/.test(p) && a.includes(p)));
});

test("opis modela: stevilke in mere se odstranijo, vrstice ostanejo", () => {
  const b = odstraniStevilke("- madez 3 mm levo\n- zasuk 1,5° in 12 %\n- nitka cez crko E");
  assert.ok(!/[0-9]/.test(b));
  assert.equal(b.split("\n").length, 3);
  assert.ok(b.includes("nitka cez crko E"));
});
