/**
 * Domov: klici, ki jih je sprejela Lina, vidni BREZ drsenja (lastnik 23. 11. 2026). Kartica »Zadnji klici« je prva v desnem
 * stolpcu scene (ta je pri sirini nad 1320 px ob vrhu zaslona), ni v izbiri oken (stara shranjena izbira je ne skrije) in ima
 * povezavo »Vsi klici«.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { t } from "./besedila.ts";
import { kliciZaPrikaz } from "./imenik.ts";
import { NAJVEC_ZADNJIH_KLICEV, NAJVEC_ZNAKOV_POVZETKA, VSA_OKNA, zadnjiKliciDomov, type VrsticaKlica } from "../../components/lina2/domov-izbira.ts";

const TU = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "components", "lina2");

function klic(i: number, kaj = `povzetek ${i}`): VrsticaKlica {
  return { sid: `CA${i}`, kdaj: `2026-11-23T0${i}:00:00.000Z`, ime: i % 2 ? `Stranka ${i}` : "", telefon: `+38640111${100 + i}`, kaj, zakljucen: true };
}

test("zadnjiKliciDomov: najvec NAJVEC_ZADNJIH_KLICEV (3-5), vrstni red ohranjen", () => {
  assert.ok(NAJVEC_ZADNJIH_KLICEV >= 3 && NAJVEC_ZADNJIH_KLICEV <= 5);
  const vrstice = zadnjiKliciDomov([1, 2, 3, 4, 5, 6].map((i) => klic(i)));
  assert.deepEqual(vrstice.map((v) => v.sid), ["CA1", "CA2", "CA3", "CA4"].slice(0, NAJVEC_ZADNJIH_KLICEV));
  assert.deepEqual(zadnjiKliciDomov([]), []);
});

test("zadnjiKliciDomov: povzetek v eni kratki vrstici", () => {
  const dolg = `Narocilo  dveh\nmiz ${"iz hrasta ".repeat(20)}`;
  const [v] = zadnjiKliciDomov([klic(1, dolg)]);
  assert.ok(v!.kaj.length <= NAJVEC_ZNAKOV_POVZETKA);
  assert.ok(v!.kaj.endsWith("…"));
  assert.ok(!/\s{2}|\n/.test(v!.kaj));
  assert.equal(zadnjiKliciDomov([klic(2, "kratko")])[0]!.kaj, "kratko");
});

test("vir je kliciZaPrikaz: brez vaj, najnovejsi prvi, ime iz imenika", () => {
  const klici = [
    { callSid: "CAstar", updatedAt: "2026-11-22T10:00:00.000Z", order: { phone: "+38641000001" }, from: "+38641000001", status: "zakljucen", transcript: [] },
    { callSid: "CAvaja", updatedAt: "2026-11-23T11:00:00.000Z", order: {}, from: "+38641000009", status: "zakljucen", vaja: true, transcript: [] },
    { callSid: "CAnov", updatedAt: "2026-11-23T10:00:00.000Z", order: { phone: "+38641000002" }, from: "+38641000002", status: "v-teku", transcript: [] },
  ];
  const imenik = [{ id: "s1", ime: "Ana Novak", telefon: "+38641000002", opomba: "" }];
  const vrstice = zadnjiKliciDomov(kliciZaPrikaz(klici as never, imenik));
  assert.deepEqual(vrstice.map((v) => v.sid), ["CAnov", "CAstar"]);
  assert.equal(vrstice[0]!.ime, "Ana Novak");
  assert.equal(vrstice[0]!.zakljucen, false);
});

test("domov.tsx: kartica je PRVA v desnem stolpcu scene, brez pogoja izbire oken, s povezavo Vsi klici", () => {
  const vir = readFileSync(path.join(TU, "domov.tsx"), "utf8");
  const desno = vir.indexOf('<div className="lina-scena-desno">');
  assert.ok(desno > 0);
  const za = vir.slice(desno);
  const kartica = za.indexOf('className="lina-karta lina-zadnji-klici"');
  const danes = za.indexOf('jeOknoVidno(izbira, "danes")');
  assert.ok(kartica > 0 && kartica < danes, "kartica mora biti pred ostalimi okni desnega stolpca");
  assert.ok(!/jeOknoVidno\([^)]*\)\s*\?\s*\(\s*<section className="lina-karta lina-zadnji-klici"/.test(vir), "kartica ne sme biti odvisna od izbire oken");
  const telo = za.slice(kartica, danes);
  assert.match(telo, /zadnji\.map/);
  assert.match(telo, /t\("d2VsiKlici"\)/);
  assert.match(telo, /onOdpri\("klic"\)/);
  assert.match(vir, /const zadnji = zadnjiKliciDomov\(klici\);/);
  assert.ok(!(VSA_OKNA as readonly string[]).includes("klici"), "kartica ni izbirno okno");
});

test("lina2.css: desni stolpec je ob vrhu nad 1320 px; vrstice kartice so enovrsticne (ne rastejo v visino)", () => {
  const css = readFileSync(path.join(TU, "lina2.css"), "utf8");
  assert.match(css, /\.lina-scena-desno \{\s*grid-column: 3;\s*grid-row: 1 \/ 3;/);
  assert.match(css, /@media \(width<=1320px\)/);
  for (const r of ["lina-zadnji-ime", "lina-zadnji-kaj"]) {
    const blok = css.slice(css.indexOf(`.${r} {`), css.indexOf("}", css.indexOf(`.${r} {`)));
    assert.match(blok, /white-space: nowrap/, r);
    assert.match(blok, /text-overflow: ellipsis/, r);
  }
});

test("besedila kartice v slovenscini in anglescini", () => {
  assert.equal(t("d2ZadnjiKlici"), "Zadnji klici");
  assert.equal(t("d2VsiKlici"), "Vsi klici");
  assert.equal(t("d2ZadnjiKlici", "en"), "Recent calls");
  assert.equal(t("d2VsiKlici", "en"), "All calls");
});
