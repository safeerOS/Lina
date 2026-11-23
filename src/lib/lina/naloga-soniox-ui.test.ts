import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";

test("komponenta soniox-nastavitve.tsx", () => {
    const koda = fs.readFileSync("src/components/soniox-nastavitve.tsx", "utf-8");
    
    assert.match(koda, /stanjeSonioxFn/, "Uvozi stanjeSonioxFn");
    assert.match(koda, /shraniSonioxKljucFn/, "Uvozi shraniSonioxKljucFn");
    assert.match(koda, /pozabiSonioxKljucFn/, "Uvozi pozabiSonioxKljucFn");
    assert.match(koda, /from\s+["']@\/lib\/lina\/functions(?:\.ts)?["']/, "Uvozi iz functions.ts");

    assert.match(koda, /type=["']password["']/, "Ima type=password");
    assert.match(koda, /role=["']note["']/, "Ima role=note za soglasje");
    assert.doesNotMatch(koda, /defaultChecked/, "Brez defaultChecked");
    assert.doesNotMatch(koda, / checked\s*={?\s*true\s*}?/, "Brez trdega checked=true");
    
    assert.doesNotMatch(koda, /console\./, "Brez console.");
    assert.doesNotMatch(koda, /localStorage/, "Brez localStorage");
    assert.doesNotMatch(koda, /sessionStorage/, "Brez sessionStorage");

    // Preveri vsak ključ t("sonioxXxx")
    const match = koda.matchAll(/t\(["'](soniox[A-Z][a-zA-Z0-9]*)["']\)/g);
    const keys = new Set(Array.from(match).map(m => m[1]));
    const besedilaKoda = fs.readFileSync("src/lib/lina/besedila.ts", "utf-8");

    // Samo zgolj preveri, da ključ obstaja v datoteki (malo naivno, ampak v redu za test Regex-a).
    // Ali pa dejansko zahtevamo test brez uvoza besedila.ts (ker navodila pravijo branje kot besedilo).
    for (const k of keys) {
        assert.ok(besedilaKoda.includes(`\n    ${k}:`) || besedilaKoda.includes(`\n  ${k}:`), `Ključ ${k} mora biti v besedila.ts`);
    }
});