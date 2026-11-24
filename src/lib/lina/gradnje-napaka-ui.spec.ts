/**
 * B7 (pregled zdruzitve 0225): napaka ob branju stanja gradenj na GitHubu je vidna - kartica z role="alert" in gumbom »Poskusi znova«;
 * kartica in stikalo v Nastavitvah ne izgineta brez razlage. Vitest (node): renderToStaticMarkup ne pozene useEffect, zato je branje
 * stanja loceno (preberiStanjeGradenj) in preizkuseno samo, izris napake pa iz podanega stanja.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { en, sl } from "./besedila.ts";

type Modul = {
  preberiStanjeGradenj?: (beri: () => Promise<unknown>) => Promise<{ stanje: unknown; napaka: string }>;
  GradnjeNapaka?: FunctionComponent<{ razlog: string; onPonovi: () => void }>;
};
// Modul (z functions.ts) se nalozi enkrat in z daljso mejo: pod obremenitvijo nalaganje traja vec kot privzetih 5 s vitest.
let modul: Modul = {};
beforeAll(async () => {
  modul = (await import("../../components/lina2/racunalnik.tsx")) as Modul;
}, 60_000);
const racunalnik = async () => modul;
const besedilo = (k: string, b: Record<string, string>) => b[k];

describe("B7: napaka branja stanja gradenj", () => {
  it("branje stanja: napaka da razlog brez stanja, uspeh da stanje brez napake", async () => {
    const m = await racunalnik();
    expect(typeof m.preberiStanjeGradenj).toBe("function");
    const slabo = await m.preberiStanjeGradenj!(async () => {
      throw new Error("omrezje");
    });
    expect(slabo.stanje).toBeNull();
    expect(slabo.napaka).toBe(besedilo("ghStanjeNapaka", sl as unknown as Record<string, string>));
    expect(await m.preberiStanjeGradenj!(async () => ({ vklopljeno: true }))).toEqual({ stanje: { vklopljeno: true }, napaka: "" });
  });

  it("kartica napake: role=\"alert\", razlog in gumb »Poskusi znova«", async () => {
    const m = await racunalnik();
    expect(typeof m.GradnjeNapaka).toBe("function");
    const razlog = besedilo("ghStanjeNapaka", sl as unknown as Record<string, string>) ?? "";
    const html = renderToStaticMarkup(createElement(m.GradnjeNapaka!, { razlog, onPonovi: () => undefined }));
    expect(html).toContain('role="alert"');
    expect(razlog.length).toBeGreaterThan(0);
    expect(html).toContain(razlog);
    expect(html).toContain("Poskusi znova");
  });

  it("besedila v sl in en", () => {
    expect(besedilo("ghStanjeNapaka", sl as unknown as Record<string, string>)).toMatch(/gradenj/i);
    expect(besedilo("ghStanjeNapaka", en as unknown as Record<string, string>)).toMatch(/build/i);
    expect(sl.uiPoskusiZnova).toBe("Poskusi znova");
    expect(en.uiPoskusiZnova).toBe("Try again");
  });

  it("kartica in stikalo brez stanja ob napaki izriseta GradnjeNapaka s ponovitvijo (ne null)", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "../../components/lina2/racunalnik.tsx"), "utf8");
    expect(src).toMatch(/if \(!stanje\) return napaka \? <GradnjeNapaka razlog=\{napaka\} onPonovi=\{osvezi\} \/> : null;/);
    expect(src).toMatch(/if \(vklop === null\) return napaka \? <GradnjeNapaka razlog=\{napaka\} onPonovi=\{nalozi\} \/> : null;/);
  });
});
