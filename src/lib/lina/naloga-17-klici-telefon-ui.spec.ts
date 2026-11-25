/**
 * Naloga 17 (racunalnik): klic s telefona na zaslonu Klici ima oznako »telefon«, celoten prepis (ali »Prepis ni na voljo.«) in ga z racunalnika
 * ni mogoce odloziti ali nadaljevati. Vitest (node), ker komponente tsx node:test ne zna. Vse vrednosti so izmisljene.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrepisKlica, ZnackaTelefon } from "../../components/klic-telefon.tsx";
import { t } from "./besedila.ts";
import { klicIzTelefona } from "./klici-telefon.ts";
import type { KlicSinhron } from "./sinhron-telefon.server.ts";

const k: KlicSinhron = {
  id: "klic-1", casZacetka: Date.parse("2026-11-24T09:15:00.000Z"), stevilka: "+38640111222", trajanjeS: 42, nujno: false,
  povzetek: "Miha Primer prosi za povratni klic.", nacin: "osebna", klicatelj: "Miha Primer", podjetje: "", sporocilo: "Naj ga poklicete nazaj.",
  sporociloDobesedno: "", brezSporocilaRazlog: "",
};
function izris<P extends object>(el: (p: P) => ReturnType<typeof ZnackaTelefon>, props: P): string {
  return renderToStaticMarkup(createElement(el, props));
}

describe("naloga 17: klic s telefona na zaslonu", () => {
  it("oznaka »telefon« samo pri klicu s telefona", () => {
    expect(izris(ZnackaTelefon, { call: { izvor: "telefon" } })).toContain(t("klicIzvorTelefon"));
    expect(izris(ZnackaTelefon, { call: {} })).toBe("");
  });

  it("celoten prepis po vrsti (klicatelj in Lina)", () => {
    const c = klicIzTelefona({ ...k, prepisPogovora: [
      { govorec: "lina", cas: k.casZacetka + 1, besedilo: "Tukaj Lina. Pogovor se zapisuje." },
      { govorec: "klicatelj", cas: k.casZacetka + 2, besedilo: "Naj me pokliče nazaj." },
    ] }, "");
    const html = izris(PrepisKlica, { call: c });
    expect(html.indexOf("Tukaj Lina. Pogovor se zapisuje.")).toBeGreaterThan(-1);
    expect(html.indexOf("Naj me pokliče nazaj.")).toBeGreaterThan(html.indexOf("Tukaj Lina."));
    expect(html).not.toContain(t("klicPrepisNi"));
  });

  it("star zapis brez prepisa: »Prepis ni na voljo.«, ne »pogovor se začne«", () => {
    const html = izris(PrepisKlica, { call: klicIzTelefona(k, "") });
    expect(html).toContain(t("klicPrepisNi"));
    expect(html).not.toContain(t("uiPogovorPrazen"));
  });

  it("okrnjen prepis to pove", () => {
    expect(izris(PrepisKlica, { call: klicIzTelefona({ ...k, prepisPogovora: [], prepisOkrnjen: true }, "") })).toContain(t("klicPrepisOkrnjen"));
  });

  it("besedilo prepisa je besedilo, ne HTML", () => {
    const html = izris(PrepisKlica, { call: klicIzTelefona({ ...k, prepisPogovora: [{ govorec: "klicatelj", cas: 1, besedilo: "<img src=x onerror=alert(1)>" }] }, "") });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("lina-desk uporablja obe komponenti in za klic s telefona skrije Sprejmi/Odloži", () => {
    const vir = readFileSync(new URL("../../components/lina-desk.tsx", import.meta.url), "utf8");
    expect(vir).toContain("<PrepisKlica call={active} />");
    expect(vir).toContain("<ZnackaTelefon call={call} />");
    expect(vir).toMatch(/active\?\.izvor === "telefon" \? \(\s*<p[^>]*>\{t\("klicTelefonaSamoBranje"\)\}/);
  });
});
