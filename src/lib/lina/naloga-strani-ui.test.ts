import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { sl, en } from "./besedila.ts";

describe("strani-nastavitve.tsx vezava in zahteve", () => {
  it("izpolnjuje zahteve komponente", async () => {
    const pot = path.join(process.cwd(), "src", "components", "strani-nastavitve.tsx");
    const vsebina = await fs.readFile(pot, "utf-8");

    assert.ok(vsebina.includes("seznamStraniFn"), "seznamStraniFn manjka v uvozih/rabi");
    assert.ok(vsebina.includes("dovoliStranFn"), "dovoliStranFn manjka v uvozih/rabi");
    assert.ok(vsebina.includes("preklicStranFn"), "preklicStranFn manjka v uvozih/rabi");
    assert.match(vsebina, /import.*\{.*seznamStraniFn.*\}.*from\s+"@\/lib\/lina\/functions\.ts"/);

    assert.doesNotMatch(vsebina, /type=["']url["']/, "polje ne sme biti type=url");
    
    assert.match(vsebina, /aria-label=\{.*straniPreklici.*\}/, "gumb prekliči mora imeti aria-label z izvorom");

    assert.doesNotMatch(vsebina, /localStorage\./, "prepovedana raba localStorage");
    assert.doesNotMatch(vsebina, /sessionStorage\./, "prepovedana raba sessionStorage");
    assert.doesNotMatch(vsebina, /console\./, "prepovedana raba console");

    // vsak ključ t("..."), ki se začne s strani, obstaja v sl in en
    const ujemanja = [...vsebina.matchAll(/t\("([^"]+)"\)/g)];
    for (const u of ujemanja) {
      const kljuc = u[1] as keyof typeof sl;
      assert.ok(kljuc in sl, `Ključ ${kljuc} manjka v sl`);
      assert.ok(kljuc in en, `Ključ ${kljuc} manjka v en`);
    }
  });
});
