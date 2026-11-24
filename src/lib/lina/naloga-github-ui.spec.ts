/** Vmesnik: Nastavitve > GitHub in O Lini, okno opozorila ob prvem zagonu (lastnik 24. 11. 2026). Branje izvorne kode. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en, sl } from "./besedila.ts";
import { NASTAVITVE } from "./podokna-definicije.ts";

const beri = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const github = beri("src/components/github-dostop.tsx");
const opozorilo = beri("src/components/opozorilo.tsx");
const desk = beri("src/components/lina-desk.tsx");
const index = beri("src/routes/index.tsx");

function kljuciT(koda: string): string[] {
  return [...koda.matchAll(/\bt\(\s*["']([A-Za-z0-9]+)["']\s*\)/g)].map((m) => m[1]);
}

describe("Nastavitve > GitHub", () => {
  it("podokni GitHub in O Lini sta v meniju Nastavitev in izrisani v lina-desk", () => {
    const ids = NASTAVITVE.podokna.map((p) => p.id);
    expect(ids).toContain("github");
    expect(ids).toContain("olini");
    expect(desk).toMatch(/"nast-github":\s*<GithubDostop id="nast-github" onError=\{onError\} \/>/);
    expect(desk).toMatch(/"nast-o-lini":\s*<OLiniPanel id="nast-o-lini" \/>/);
  });

  it("tri poti, najenostavnejsa prva; OAuth samo, ce je na voljo; gh samo, ce je gh na voljo", () => {
    const iOauth = github.indexOf('t("ghdPotOauth")');
    const iGh = github.indexOf('t("ghdPotGh")');
    const iKljuc = github.indexOf('t("ghdPotKljuc")');
    expect(iOauth).toBeGreaterThan(0);
    expect(iOauth).toBeLessThan(iGh);
    expect(iGh).toBeLessThan(iKljuc);
    expect(github).toMatch(/stanje\?\.oauthNaVoljo \?/);
    expect(github).toMatch(/stanje\?\.ghNaVoljo \?/);
  });

  it("kljuc: polje gesla brez samodejnega izpolnjevanja, po shranjevanju izpraznjeno; brez localStorage in console", () => {
    expect(github).toMatch(/id="ghd-kljuc" type="password" autoComplete="off"/);
    expect(github).toMatch(/setKljuc\(""\)/);
    expect(github).not.toMatch(/localStorage|sessionStorage|console\./);
    expect(github).toMatch(/t\("ghdPovezan"\)\.replace\("\{racun\}"/);
    expect(github).toMatch(/odjavaGithubFn/);
  });

  it("vsa besedila obstajajo v sl in en (tudi O Lini in opozorilo)", () => {
    for (const k of [...kljuciT(github), ...kljuciT(opozorilo), "nastPodGithub", "nastPodOLini", "rcROpozorilo"]) {
      expect(typeof (sl as Record<string, string>)[k], k).toBe("string");
      expect((en as Record<string, string>)[k]?.length ?? 0, k).toBeGreaterThan(0);
    }
  });
});

describe("Opozorilo ob prvem zagonu", () => {
  it("okno pred prijavo, po soglasju; gumb Razumem poklice potrdiOpozoriloFn", () => {
    expect(index).toMatch(/if \(!data\.opozorilo\) return <OpozoriloPrviZagon/);
    expect(index.indexOf("if (!data.soglasje)")).toBeLessThan(index.indexOf("if (!data.opozorilo)"));
    expect(index.indexOf("if (!data.opozorilo)")).toBeLessThan(index.indexOf("if (!data.auth.signedIn"));
    expect(opozorilo).toMatch(/await potrdiOpozoriloFn\(\)/);
    expect(opozorilo).toMatch(/t\("opozRazumem"\)/);
  });

  it("besedilo vsebuje vseh pet tock iz osnutka (osebna raba, napake, odgovornost, nadzor, obseg) v sl in en", () => {
    expect(sl.opozT1).toMatch(/osebni rabi/);
    expect(sl.opozT2).toMatch(/lahko dela napake/);
    expect(sl.opozT3).toMatch(/ne prevzema odgovornosti/);
    expect(sl.opozT4).toMatch(/nadzirati/);
    expect(sl.opozT5).toMatch(/omeji obseg/);
    expect(en.opozT3).toMatch(/accepts no liability/);
    for (const k of ["opozT1", "opozT2", "opozT3", "opozT4", "opozT5"]) expect(opozorilo).toContain(`t("${k}")`);
  });
});
