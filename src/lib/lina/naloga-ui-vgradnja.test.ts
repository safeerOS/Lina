/**
 * Vgradnja komponent Soniox (Dodatki) in Strani (novo podokno Nastavitev) v zaslon (21. 11. 2026). Izvorne datoteke se berejo kot
 * besedilo (node ne zna izvajati TSX): preizkus pade, ce vgradnja manjka ali se pokvari.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NASTAVITVE } from "./podokna-definicije.ts";
import { sl, en } from "./besedila.ts";

const koda = readFileSync("src/components/lina-desk.tsx", "utf-8");

test("Soniox: komponenta je uvozena in vgrajena v panel Dodatki; vklop gre v pravilo sonioxVklop", () => {
  assert.match(koda, /import \{ SonioxNastavitve \} from "@\/components\/soniox-nastavitve\.tsx";/);
  const zacetek = koda.indexOf("function DodatkiPanel(");
  assert.ok(zacetek > 0, "DodatkiPanel manjka");
  const konec = koda.indexOf("\nfunction ", zacetek + 10);
  const panel = koda.slice(zacetek, konec > 0 ? konec : undefined);
  assert.match(panel, /<SonioxNastavitve[\s\S]*?vklop=\{pravila\.sonioxVklop === true\}/, "vklop mora biti samo pri izrecnem true (privzeto izklopljeno)");
  assert.match(panel, /onVklop=\{\(vklop\) => onChange\(\{ \.\.\.pravila, sonioxVklop: vklop \}\)\}/, "stikalo shrani prek pravil (Shrani)");
  assert.ok(panel.indexOf("<SonioxNastavitve") < panel.indexOf("onClick={onSave}"), "Soniox mora biti pred gumbom Shrani");
});

test("Strani: komponenta je uvozena, podokno »strani« ima razdelek nast-strani, ki ga zaslon izrise", () => {
  assert.match(koda, /import \{ StraniNastavitve \} from "@\/components\/strani-nastavitve\.tsx";/);
  const podokno = NASTAVITVE.podokna.find((p) => p.id === "strani");
  assert.ok(podokno, "podokno strani manjka v podokna-definicije.ts");
  assert.deepEqual([...podokno.razdelki], ["nast-strani"]);
  assert.match(koda, /"nast-strani": \(\s*<Razdelek id="nast-strani"[\s\S]*?<StraniNastavitve onError=\{onError\} \/>/);
  assert.ok(podokno.oznaka in sl && podokno.oznaka in en, "oznaka podokna mora biti v sl IN en");
  assert.ok(sl.nastPodStrani.length > 0 && en.nastPodStrani.length > 0);
  // Oznaka zavihka je kratka (ne celoten naslov razdelka).
  assert.ok(sl.nastPodStrani.length <= 20 && en.nastPodStrani.length <= 20);
});

test("Soniox in Strani: besedila obstajajo v sl in en za vsak t(\"...\") obeh komponent", () => {
  for (const datoteka of ["src/components/soniox-nastavitve.tsx", "src/components/strani-nastavitve.tsx"]) {
    const vsebina = readFileSync(datoteka, "utf-8");
    for (const u of vsebina.matchAll(/\bt\("([A-Za-z0-9]+)"\)/g)) {
      assert.ok(u[1] in sl, `${datoteka}: ${u[1]} manjka v sl`);
      assert.ok(u[1] in en, `${datoteka}: ${u[1]} manjka v en`);
    }
    // stanjeBesedilo vrne kljuc, ne besedila: kljuci morajo obstajati tudi, ce niso napisani kot t("...") v komponenti
  }
  for (const k of ["sonioxStanjeNalaga", "sonioxStanjeIzklopljen", "sonioxStanjeBrezKljuca", "sonioxStanjeAktiven"]) {
    assert.ok(k in sl && k in en, `${k} manjka`);
  }
});
