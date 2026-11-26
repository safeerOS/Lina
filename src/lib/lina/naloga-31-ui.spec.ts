/**
 * Naloga 31 (UI): OmniRoute ne tece -> vprasanje »Ga namestim?« (Da/Ne), koraki s stanjem, napaka v navadnem jeziku,
 * »Odstrani OmniRoute« samo za namestitev Line. Vitest (node), ker komponente tsx node:test ne zna.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OmniRouteNamestitev } from "../../components/omniroute-namestitev.tsx";
import type { StanjeNamestitve } from "./omniroute-namestitev.server.ts";

const nic = () => undefined;
function izris(stanje: StanjeNamestitve | null, vprasaj: boolean): string {
  return renderToStaticMarkup(createElement(OmniRouteNamestitev, { stanje, vprasaj, busy: false, onDa: nic, onNe: nic, onOdstrani: nic }));
}
const osnova: StanjeNamestitve = {
  namescen: false,
  tece: false,
  vTeku: false,
  pripravljeno: false,
  koraki: [
    { korak: "prenos", stanje: "caka" },
    { korak: "namestitev", stanje: "caka" },
    { korak: "zagon", stanje: "caka" },
    { korak: "preverba", stanje: "caka" },
  ],
  napaka: null,
  naslov: null,
  razlicica: "3.8.54",
};

describe("OmniRouteNamestitev", () => {
  it("ne tece in ni namescen: vprasanje z Da/Ne, brez surove napake in brez gumba Odstrani", () => {
    const html = izris(osnova, true);
    expect(html).toContain("OmniRoute še ni nameščen. Ga namestim?");
    expect(html).toContain("Da, namesti");
    expect(html).toContain(">Ne<");
    expect(html).not.toMatch(/ECONNREFUSED|fetch failed|ERR_CONNECTION/);
    expect(html).not.toContain("Odstrani OmniRoute");
  });

  it("namescen, a ne tece: vprasanje za zagon in gumb Odstrani", () => {
    const html = izris({ ...osnova, namescen: true }, true);
    expect(html).toContain("Ga zaženem?");
    expect(html).toContain("Da, zaženi");
    expect(html).toContain("Odstrani OmniRoute");
  });

  it("med namestitvijo: koraki 1-4 s stanjem, vprasanje skrito", () => {
    const html = izris({ ...osnova, vTeku: true, koraki: [{ korak: "prenos", stanje: "uspeh" }, { korak: "namestitev", stanje: "tece" }, { korak: "zagon", stanje: "caka" }, { korak: "preverba", stanje: "caka" }] }, true);
    expect(html).not.toContain("Ga namestim?");
    expect(html).toContain('data-korak="namestitev" data-stanje="tece"');
    expect(html).toContain("Prenos: končano");
    expect(html).toContain("Preverba modelov: čaka");
    expect(html).toContain('aria-live="polite"');
  });

  it("napaka koraka: besedilo s streznika v role=alert; pripravljeno: sporocilo", () => {
    const napaka = izris({ ...osnova, napaka: "Na disku je premalo prostora.", koraki: [{ korak: "prenos", stanje: "napaka" }, ...osnova.koraki.slice(1)] }, false);
    expect(napaka).toContain('role="alert"');
    expect(napaka).toContain("Prenos: ni uspelo");
    const ok = izris({ ...osnova, namescen: true, tece: true, pripravljeno: true, koraki: osnova.koraki.map((k) => ({ ...k, stanje: "uspeh" as const })) }, false);
    expect(ok).toContain("OmniRoute je pripravljen.");
  });
});
