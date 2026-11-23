// Zgostitev prikazane odobritve (slepi pregled BBB1, 15. 11. 2026): polja orodje, predogled in opis morajo biti v zgostitvi
// nedvoumno ločena. Prej so se spojila z "\n", zato sta (predogled "a\nb", opis "c") in (predogled "a", opis "b\nc") dala
// isto zgostitev: napadalec, ki piše /dogodki, je telefonu pokazal drugačen razrez kot strežniku, podpis pa je veljal za oba.
import assert from "node:assert/strict";
import { test } from "node:test";
import { nizOdobritve, zgostitevPrikaza } from "./kanal-claude.ts";

const f = zgostitevPrikaza;

test("BBB1 zgostitev je nedvoumna na meji predogled/opis", () => {
  assert.notEqual(f("Bash", "a\nb", "c"), f("Bash", "a", "b\nc"));
  assert.notEqual(f("Bash", "a\n", "c"), f("Bash", "a", "\nc"));
  assert.notEqual(f("Bash", "echo hi\nrm -rf ~", "x"), f("Bash", "echo hi", "rm -rf ~\nx"));
});

test("BBB1 zgostitev je nedvoumna na meji orodje/predogled in z narobe postavljeno prazno vrednostjo", () => {
  assert.notEqual(f("Bash\nrm -rf ~", "x", "o"), f("Bash", "rm -rf ~\nx", "o"));
  assert.notEqual(f("Bash", "", "x"), f("Bash", "x", ""));
  assert.notEqual(f("", "Bash", "x"), f("Bash", "", "x"));
});

test("BBB1 številke in dvopičja v vsebini ne zlepijo polj (dolžina ni del vsebine)", () => {
  assert.notEqual(f("A", "1:b", "c"), f("A1:b", "", "c"));
  assert.notEqual(f("a", "b", "c"), f("a", "b", "c\n"));
  assert.notEqual(f("ab", "3:c", "d"), f("a", "b3:c", "d"));
});

test("BBB1 nobena trojica iz majhne abecede ne trči (poln pregled)", () => {
  const abeceda = ["", "a", "\n", "1", ":", "a\n", "\na", "1:a", "é"];
  const videno = new Map<string, string>();
  for (const x of abeceda) for (const y of abeceda) for (const z of abeceda) {
    const h = f(x, y, z);
    const kljuc = JSON.stringify([x, y, z]);
    const prej = videno.get(h);
    assert.equal(prej, undefined, `trk: ${prej} in ${kljuc}`);
    videno.set(h, kljuc);
  }
  assert.equal(videno.size, abeceda.length ** 3);
});

test("BBB1 dolžine štejejo bajte UTF-8, ne znakov", () => {
  assert.notEqual(f("é", "", "x"), f("", "é", "x"));
  assert.notEqual(f("😀", "a", "b"), f("😀a", "", "b"));
});

test("BBB1 zgostitev je 64 malih šestnajstiških znakov in stalna za isto vsebino", () => {
  assert.match(f("Bash", "ls", "opis"), /^[0-9a-f]{64}$/);
  assert.equal(f("Bash", "ls", "opis"), f("Bash", "ls", "opis"));
});

test("BBB1 podpisani niz odobritve ima novo verzijo v3 (stari telefon z v2 ne more podpisati nove zgostitve)", () => {
  const n = nizOdobritve("abcde", true, "n-9427e6e5d28ff3c4", 1763130001000, "enkratniOdobr-0002", "vektorNaloga0123456789abc", f("Bash", "ls", "o"));
  assert.ok(n.startsWith("safeer-lina-odobritev-v3\n"), n.slice(0, 40));
  assert.ok(!n.includes("odobritev-v2"));
});
