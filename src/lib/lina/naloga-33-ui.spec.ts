/**
 * Naloga 33: na 127.0.0.1 zaslon »Poveži telefon« pove, zakaj ga telefon doma ne najde, in pokaze EN gumb »Uporabi domače omrežje (<naslov>)«,
 * ki odobri omrezje predlaganega naslova (isto dejanje kot »Uporabi ta naslov«, N1). Vitest (node); komponenta z zahtevami ob zagonu se
 * v SSR ne izrise, zato preverba vira kot naloga-21-povezi-ui.spec.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { t } from "./besedila.ts";

describe("naloga 33: Poveži telefon na 127.0.0.1", () => {
  it("besedila v sl in en, razlicna; razlaga omeni 127.0.0.1 in Global Link", () => {
    const besedila = readFileSync(new URL("./besedila.ts", import.meta.url), "utf8");
    for (const k of ["telZankaRazlaga", "telUporabiDomace"]) {
      const v = [...besedila.matchAll(new RegExp(`${k}: "([^"]+)"`, "g"))].map((m) => m[1]);
      expect(v.length, k).toBe(2);
      expect(v[0], k).not.toBe(v[1]);
    }
    expect(t("telZankaRazlaga", "sl")).toMatch(/127\.0\.0\.1.*Global Link/);
    expect(t("telZankaRazlaga", "en")).toMatch(/127\.0\.0\.1.*Global Link/);
  });

  it("gumb se pokaze samo ob vklopu, naslovu zanke in predlogu; poslje odobriOmrezje s predlaganim naslovom in ga pokaze", () => {
    const ui = readFileSync(new URL("../../components/povezi-telefon.tsx", import.meta.url), "utf8");
    const blok = ui.slice(ui.indexOf('data-predlog-domace="1"') - 200, ui.indexOf('data-predlog-domace="1"') + 600);
    expect(blok).toMatch(/s\.vklop && ZANKA\.test\(s\.naslov\) && s\.predlogNaslova/);
    expect(blok).toMatch(/shraniAsistentaFn\(\{ data: \{ naslov: s\.predlogNaslova, odobriOmrezje: true \} \}\)/);
    expect(blok).toMatch(/\{t\("telUporabiDomace"\)\} \(\{s\.predlogNaslova\}\)/);
    expect(ui).toMatch(/const ZANKA = \/\^\(127\\\.0\\\.0\\\.1\|::1\|localhost\)\$\/;/);
  });
});
