/**
 * Naloga 16 (lastnik 25. 11. 2026 23:05-23:10): na zaslonu »Poveži telefon« so QR, prikaz 6-mestne kode IN vnos kode s telefona VEDNO
 * vidni (tudi ko del za telefon ne tece, takrat z razlogom), v desnem stolpcu poleg nastavitev, brez gumba »Pokaži kodo QR«.
 * Vitest (node), ker komponente tsx node:test ne zna. Vse vrednosti so izmisljene.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PovezavaPlosca, razlogBrezKode, type PovezavaPloscaLastnosti } from "../../components/povezi-telefon.tsx";
import { t } from "./besedila.ts";

type S = NonNullable<PovezavaPloscaLastnosti["s"]>;

function stanje(delno: Partial<S> = {}): S {
  return {
    vklop: true, globalLink: false, globalLinkStanje: "izklopljen", ocenaIzida: false, naslov: "192.168.77.7", vrata: 8446, naslovi: ["192.168.77.7"],
    tece: true, napaka: "", napakaKoda: "", samoGlobalLink: false, odtis: "ab".repeat(32), claudeCode: false, cakajo: [], ozjiKrog: [],
    sKodo: { odprto: true, koda: "123456", do: Date.now() + 60_000, cakajoKodo: [], zaprtoSe: 0, oglas: "" },
    naprave: [], openLine: { povezan: false, vrata: 0, odtis: "" }, opozoriloKlicev: "", klicevSePripravlja: false,
    ...delno,
  } as S;
}

const nic = () => undefined;
const POVABILO = { vsebina: "lina://x", svg: '<svg data-lazni-qr="1"></svg>', velja: 600_000, klici: false, opozorilo: "", do: 0 };

function izris(s: S | null, povabilo: PovezavaPloscaLastnosti["povabilo"] = null, kodaTel: Record<string, string> = {}) {
  return renderToStaticMarkup(createElement(PovezavaPlosca, {
    s, povabilo, zaposlen: false, kodaTel, onKodaTel: nic, onPotrdiKodo: nic, onOdkleni: nic, onVklopi: nic, onDodaj: nic, onZavrni: nic,
  }));
}

function vsiTrije(html: string) {
  expect(html).toContain('data-del="qr"');
  expect(html).toContain('data-del="koda"');
  expect(html).toContain('data-del="vnos"');
  expect(html).toMatch(/<input[^>]*autoComplete="one-time-code"|<input[^>]*autocomplete="one-time-code"/i);
}

describe("naloga 16: Poveži telefon - QR, koda in vnos kode vedno vidni", () => {
  it("tece: QR (brez klika), koda 123 456 in vnos kode; ni gumba »Pokaži kodo QR«", () => {
    const html = izris(stanje(), POVABILO);
    vsiTrije(html);
    expect(html).toContain('data-lazni-qr="1"');
    expect(html).toContain("123 456");
    // besedilo »Poveži s kodo« je v navodilu za telefon; prepovedana sta samo GUMBA, ki sta QR in kodo skrivala za klikom
    expect(html).not.toMatch(new RegExp(`<button[^>]*>${t("telPokaziQr")}<`));
    expect(html).not.toMatch(new RegExp(`<button[^>]*>${t("telPoveziSKodo")}<`));
  });

  it("ne tece (naslova ni vec): vsi trije deli so na mestu, razlog je napisan, Lina poskusa sama", () => {
    const html = izris(stanje({ tece: false, napakaKoda: "naslov", sKodo: { odprto: false, koda: "", do: 0, cakajoKodo: [], zaprtoSe: 0, oglas: "" } }));
    vsiTrije(html);
    expect(html).toContain(t("telNapaka_naslov"));
    expect(html).toContain(t("telPoskusamZnova"));
    expect(html).toContain(t("telQrNiNaVoljo"));
    expect(html).toContain("––– –––");
  });

  it("izklopljeno, samo Global Link in nalaganje: deli so vidni z razlogom; pri izklopu gumb za vklop", () => {
    const izkl = izris(stanje({ vklop: false, tece: false }));
    vsiTrije(izkl);
    expect(izkl).toContain(t("telIzklopljeno"));
    expect(izkl).toContain(t("telVklopiPovezavo"));
    const gl = izris(stanje({ tece: false, samoGlobalLink: true }));
    vsiTrije(gl);
    expect(gl).toContain(t("telSamoGlobalLink"));
    const nalaganje = izris(null);
    vsiTrije(nalaganje);
    expect(nalaganje).toContain(t("telPripravljam"));
  });

  it("telefon caka na kodo: vnos kode s telefona z id-jem; stara koda iz prejsnjega teka se ne pokaze, ko ne tece", () => {
    const caka = { pairId: "p1", id: "n-" + "a".repeat(16), ime: "Samsung", napacna: false };
    const html = izris(stanje({ sKodo: { odprto: true, koda: "123456", do: 1, cakajoKodo: [caka], zaprtoSe: 0, oglas: "" } }), POVABILO, { p1: "654 321" });
    expect(html).toContain('id="pt-koda-p1"');
    expect(html).toContain("Samsung");
    expect(html).not.toContain('id="pt-koda-prazno"');
    const brez = izris(stanje({ tece: false, sKodo: { odprto: true, koda: "999888", do: 1, cakajoKodo: [caka], zaprtoSe: 0, oglas: "" } }));
    expect(brez).not.toContain("999 888");
    expect(brez).toContain('id="pt-koda-prazno"');
  });

  it("razlog: null samo, ko sta QR in koda res na voljo (ali je koda zaprta zaradi poskusov - takrat svoje sporocilo)", () => {
    expect(razlogBrezKode(stanje(), POVABILO)).toBeNull();
    expect(razlogBrezKode(stanje(), null)).toBe(t("telPripravljam"));
    expect(razlogBrezKode(stanje({ tece: false }), null)).toBe(t("telZaganjam"));
  });

  it("nova besedila so v sl in en (razlicna) in zaslon je v dveh stolpcih (desno QR) brez ozke kartice v lina-desk", () => {
    for (const k of ["telPovezavaNaslov", "telPripravljam", "telIzklopljeno", "telVklopiPovezavo", "telZaganjam", "telPoskusamZnova", "telQrOznaka", "telQrNiNaVoljo", "telKodaRacunalnika", "telKodaNiNaVoljo", "telKodaVnosNamig"] as const) {
      expect(t(k, "sl")).toBeTruthy();
      expect(t(k, "en")).toBeTruthy();
      expect(t(k, "en")).not.toBe(t(k, "sl"));
    }
    const ui = readFileSync(new URL("../../components/povezi-telefon.tsx", import.meta.url), "utf8");
    expect(ui).toMatch(/lg:grid-cols-\[minmax\(0,32rem\)_minmax\(0,1fr\)\]/);
    expect(ui).not.toContain('t("telPokaziQr")');
    const desk = readFileSync(new URL("../../components/lina-desk.tsx", import.meta.url), "utf8");
    expect(desk).not.toMatch(/max-w-xl[^"]*">\s*<PoveziTelefon/);
  });
});

describe("naloga 16: oznaka linije na Domovu (zaslon, ne samo koda)", async () => {
  const { DomovPanel } = await import("../../components/lina2/domov.tsx");
  const { oznakaLinije } = await import("./oznaka-linije.ts");
  const brain = { nastavljen: false, provider: null } as never;
  const domov = (racunalnik: boolean, telefon: "povezan" | "seznanjen" | "ne" | null) =>
    renderToStaticMarkup(createElement(DomovPanel, { calls: [], podjetje: "Podjetje d.o.o.", linija: oznakaLinije(racunalnik, telefon), onOdpri: nic, brain }));

  it("telefon povezan, racunalnikova linija zaprta: »Telefon povezan«, ne »zaprta«", () => {
    const html = domov(false, "povezan");
    expect(html).toContain(t("linOznaka_telefon"));
    expect(html).not.toContain(t("linOznaka_zaprta"));
    expect(html).not.toContain(t("d2HitreZaprta") + "<");
  });

  it("nihce ne sprejema: »Linija zaprta« je gumb, ki odpre Linijo; racunalnik odprt: »Linija odprta · računalnik«", () => {
    expect(domov(false, "ne")).toMatch(new RegExp(`<button[^>]*aria-label="${t("linOznakaOdpri")}"[^>]*>${t("linOznaka_zaprta")}</button>`));
    expect(domov(true, "ne")).toContain(t("linOznaka_racunalnik"));
    expect(domov(true, "povezan")).toContain(t("linOznaka_odprta"));
  });
});
