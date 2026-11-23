/**
 * Naloga B (UI): oznaka nujnega klica ima napis »Nujno«, ne samo barvo (dostopnost, crno-beli izpis).
 * Vitest (node), ker komponente tsx node:test ne zna.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NujnoOznaka } from "../../components/nujno-oznaka.tsx";

describe("NujnoOznaka", () => {
  it("izpise napis »Nujno« in rdeco oznako; pri tiskanju crno-beli okvir z napisom", () => {
    const html = renderToStaticMarkup(createElement(NujnoOznaka));
    expect(html).toContain("Nujno");
    expect(html).toContain("--color-signal");
    expect(html).toContain("print:border-black");
    expect(html).toContain('data-nujno="1"');
    // Klicaj je okras (aria-hidden); napis ni skrit bralniku zaslona.
    expect(html).toContain('aria-hidden="true">!');
  });
});
