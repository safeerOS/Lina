/**
 * Naloga 21 (N1, N2): zaslon »Poveži telefon« na neodobrenem omrezju - QR in koda ostaneta na mestu (lastnikov ukaz), namesto njiju napis,
 * zakaj ju ni; gumb »Uporabi ta naslov« odobri omrezje; zapustitev zaslona preklice QR. Vitest (node), ker komponente tsx node:test ne zna.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PovezavaPlosca, razlogBrezKode, type PovezavaPloscaLastnosti } from "../../components/povezi-telefon.tsx";
import { t } from "./besedila.ts";

type S = NonNullable<PovezavaPloscaLastnosti["s"]>;
const nic = () => undefined;
const stanje = (delno: Partial<S> = {}): S => ({
  vklop: true, globalLink: true, globalLinkStanje: "povezan", samodejniAgenti: true, zagonClaude: "", ocenaIzida: false, naslov: "192.168.77.7", vrata: 8446, naslovi: ["192.168.77.7"],
  tece: false, napaka: "Omrezje ni odobreno.", napakaKoda: "omrezje", samoGlobalLink: true, predlogNaslova: "10.12.34.56", odtis: "", claudeCode: false, cakajo: [], ozjiKrog: [],
  sKodo: { odprto: false, koda: "", do: 0, cakajoKodo: [], zaprtoSe: 0, oglas: "" },
  naprave: [], openLine: { povezan: false, vrata: 0, odtis: "" }, opozoriloKlicev: "", klicevSePripravlja: false,
  ...delno,
}) as S;

describe("naloga 21: Poveži telefon na neodobrenem omrezju", () => {
  it("QR, koda in vnos so na mestu; razlog pove, da omrezje ni odobreno (ne »se pripravlja« in ne samo Global Link)", () => {
    expect(razlogBrezKode(stanje(), null)).toBe(t("telNeodobrenoOmrezje"));
    const html = renderToStaticMarkup(createElement(PovezavaPlosca, {
      s: stanje(), povabilo: null, zaposlen: false, kodaTel: {}, onKodaTel: nic, onPotrdiKodo: nic, onOdkleni: nic, onVklopi: nic, onDodaj: nic, onZavrni: nic,
    }));
    for (const del of ['data-del="qr"', 'data-del="koda"', 'data-del="vnos"']) expect(html).toContain(del);
    expect(html).toContain(t("telNeodobrenoOmrezje"));
    expect(html).not.toMatch(/\d{3} \d{3}/);
  });

  it("besedila v sl in en, razlicna; gumb »Uporabi ta naslov« poslje odobriOmrezje in streznisko dejanje ga posreduje", () => {
    const besedila = readFileSync(new URL("./besedila.ts", import.meta.url), "utf8");
    for (const k of ["telNapaka_omrezje", "telNeodobrenoOmrezje", "telUporabiNaslov", "telPredlogNaslova"]) {
      const v = [...besedila.matchAll(new RegExp(`${k}: "([^"]+)"`, "g"))].map((m) => m[1]);
      expect(v.length, k).toBe(2);
      expect(v[0], k).not.toBe(v[1]);
    }
    const ui = readFileSync(new URL("../../components/povezi-telefon.tsx", import.meta.url), "utf8");
    expect(ui).toMatch(/shraniAsistentaFn\(\{ data: \{ naslov: s\.predlogNaslova, odobriOmrezje: true \} \}\)/);
    // »Shrani« odobri samo NOV naslov (slepi pregled 21, najdba 8)
    expect(ui).toMatch(/naslov, vrata: Number\(vrata\), odobriOmrezje: naslov !== s\.naslov/);
    expect(ui).toMatch(/void prekliciSeznanitevFn\(\)\.catch\(\(\) => undefined\);/);
    // QR, ki pride po zapustitvi zaslona, se takoj preklice (zacniSeznanitev lahko caka do 25 s)
    expect(ui).toMatch(/if \(ziv\.current\) setPovabilo\(\{ \.\.\.p, do: Date\.now\(\) \+ p\.velja, kljuc: kljucStreznika \}\);\s*\/\/[^\n]*\n\s*else void prekliciSeznanitevFn\(\)/);
    const fn = readFileSync(new URL("./functions.ts", import.meta.url), "utf8");
    expect(fn).toMatch(/odobriOmrezje: data\?\.odobriOmrezje/);
    expect(fn).toMatch(/await prekliciSeznanitev\(await sessionToken\(\)\)/);
  });
});
