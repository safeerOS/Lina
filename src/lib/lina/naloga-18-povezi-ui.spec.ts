/**
 * Naloga 18: stikalo »Lina sama zazene Claude Code in agente za naloge, potrjene na telefonu« v »Povezi telefon« (privzeto vklopljeno) in
 * sporocilo, ko samodejni zagon seje ne uspe (ni terminala, ni claude, omejitev, napaka), v slovenscini in anglescini.
 * PoveziTelefon uporablja streznisko stanje (hooki), zato zaslon preverja vir komponente; privzeto vrednost preverja asistent-telefon.
 * Vitest (node). Vrednosti izmisljene.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { t } from "./besedila.ts";

const vir = readFileSync(new URL("../../components/povezi-telefon.tsx", import.meta.url), "utf8");
const KLJUCI = ["telSamodejniAgenti", "telSamodejniAgentiNamig", "telClaudeZaprtSamodejno", "telZagonClaude_ni-terminala", "telZagonClaude_ni-claude", "telZagonClaude_omejitev", "telZagonClaude_napaka"] as const;

describe("naloga 18: stikalo in sporocila samodejnega zagona", () => {
  it("besedila obstajajo v sl in en in se razlikujeta", () => {
    for (const k of KLJUCI) {
      const sl = t(k, "sl");
      const en = t(k, "en");
      expect(sl.length, k).toBeGreaterThan(10);
      expect(en.length, k).toBeGreaterThan(10);
      expect(sl).not.toBe(en);
    }
  });

  it("stikalo je potrditveno polje, vezano na samodejniAgenti, s pojasnilom (aria-describedby) in shrani prek shraniAsistentaFn", () => {
    expect(vir).toMatch(/checked=\{s\.samodejniAgenti\}[\s\S]{0,200}aria-describedby="pt-samodejni-namig"[\s\S]{0,200}samodejniAgenti: e\.target\.checked/);
    expect(vir).toContain('id="pt-samodejni-namig"');
  });

  it("streznisko dejanje shraniAsistentaFn stikalo res posreduje v shraniAsistenta", () => {
    const fn = readFileSync(new URL("./functions.ts", import.meta.url), "utf8");
    expect(fn).toMatch(/shraniAsistenta\(await sessionToken\(\), \{[^}]*samodejniAgenti: data\?\.samodejniAgenti[^}]*\}\)/);
  });

  it("razlog neuspelega zagona je viden kot opozorilo (role=alert) samo, ko seja ni odprta", () => {
    expect(vir).toMatch(/!s\.claudeCode && s\.zagonClaude \? <p role="alert"[^>]*>\{t\(`telZagonClaude_\$\{s\.zagonClaude\}`\)\}/);
  });
});
