/**
 * Vmesnik nacrta z diagramom (lastnik 24. 11. 2026): prikaz nacrt.html samo v izoliranem okvirju (iframe sandbox="" brez allow-scripts
 * in allow-same-origin, vsebina z ovojem CSP iz streznika), stikalo v Nastavitvah (privzeto vklopljeno), besedila v sl in en.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NacrtStikalo } from "../../components/nacrt-stikalo.tsx";
import { en, sl } from "./besedila.ts";
import { NASTAVITVE } from "./podokna-definicije.ts";

const beri = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const racunalnik = beri("src/components/lina2/racunalnik.tsx");
const stikalo = beri("src/components/nacrt-stikalo.tsx");
const desk = beri("src/components/lina-desk.tsx");
const funkcije = beri("src/lib/lina/functions.ts");

function kljuciT(koda: string): string[] {
  return [...koda.matchAll(/\bt\(\s*["']([A-Za-z0-9]+)["']\s*\)/g)].map((m) => m[1]);
}

describe("nacrt v zavihku Racunalnik: izoliran okvir", () => {
  const iframi = [...racunalnik.matchAll(/<iframe\b[^>]*>/g)].map((m) => m[0]);

  it("natanko en iframe, sandbox je prazen (brez allow-scripts in allow-same-origin), vsebina samo prek srcDoc", () => {
    expect(iframi).toHaveLength(1);
    const f = iframi[0]!;
    expect(f).toMatch(/\bsandbox=""/);
    expect(f).not.toMatch(/allow-/);
    expect(f).toMatch(/\bsrcDoc=\{/);
    expect(f).not.toMatch(/\bsrc=/);
    expect(f).toMatch(/\btitle=\{t\("rcNacrtOkvir"\)\}/);
    expect(f).toMatch(/referrerPolicy="no-referrer"/);
  });

  it("HTML pride samo iz streznika (nacrtClaudeNalogeFn, ki ga ovije s CSP), nikoli dangerouslySetInnerHTML", () => {
    expect(racunalnik).toMatch(/nacrtClaudeNalogeFn\(/);
    expect(racunalnik).not.toMatch(/dangerouslySetInnerHTML/);
    expect(funkcije).toMatch(/export const nacrtClaudeNalogeFn/);
    expect(funkcije).toMatch(/nacrtClaudeNaloge\(await sessionToken\(\)/);
  });

  it("obrazec ima izbiro »najprej nacrt«, ki doda oznako [nacrt] v besedilo (lastnik jo vidi in potrdi)", () => {
    expect(racunalnik).toMatch(/OZNAKA_NACRTA/);
    expect(racunalnik).toMatch(/t\("rcNajprejNacrt"\)/);
  });
});

describe("stikalo v Nastavitvah", () => {
  it("podokno agenti je v meniju Nastavitev in izrisano v lina-desk", () => {
    expect(NASTAVITVE.podokna.map((p) => p.id)).toContain("agenti");
    expect(desk).toMatch(/"nast-agenti":\s*<NacrtStikalo id="nast-agenti" \/>/);
  });

  it("privzeto vklopljeno ze ob prvem izrisu (pred odgovorom streznika)", () => {
    const html = renderToStaticMarkup(createElement(NacrtStikalo, { id: "nast-agenti" }));
    expect(html).toMatch(/id="nacrt-diagram-vklop"[^>]*checked=""|checked=""[^>]*id="nacrt-diagram-vklop"/);
    expect(stikalo).toMatch(/nastaviNacrtDiagramFn/);
    expect(stikalo).toMatch(/stanjeAgentPomociFn/);
  });

  it("vsa besedila obstajajo v sl in en", () => {
    for (const k of [...kljuciT(racunalnik), ...kljuciT(stikalo), "nastPodAgenti"]) {
      expect(typeof (sl as Record<string, string>)[k], k).toBe("string");
      expect((en as Record<string, string>)[k]?.length ?? 0, k).toBeGreaterThan(0);
    }
  });
});
