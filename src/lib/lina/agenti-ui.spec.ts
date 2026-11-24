/**
 * Zavihek Racunalnik: zaznani agenti s stikali, »Dodeli nalogo«, vrsta s stanjem in uro (lastnik 24. 11. 2026). Izris v pravem
 * Reactu (react-dom/server), ker node:test tsx ne zna. Besedila v sl IN en.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentiKartica, NalogaVrstica } from "../../components/lina2/racunalnik.tsx";
import { en, sl } from "./besedila.ts";
import type { JavnaNaloga, JavnoStanjeNalog, StanjeAgenta } from "./claude-naloge.server.ts";

const agent = (id: StanjeAgenta["id"], x: Partial<StanjeAgenta> = {}): StanjeAgenta => ({
  id, ime: id, pot: `/usr/bin/${id}`, stanje: "pripravljen", razlicica: "1.0", vklopljen: true, kanal: id === "claude", zacetniPoziv: id !== "kimi", omejeneMape: id === "opencode" || id === "agy", ...x,
});

const STANJE: JavnoStanjeNalog = {
  naVoljo: true, razlogNiNaVoljo: null, geslo: true, mape: [], prepovedane: ["/home/a/scit"], naloge: [],
  agenti: [agent("claude"), agent("agy", { vklopljen: false }), agent("opencode", { stanje: "ni-najden", pot: null }), agent("kimi"), agent("pi"), agent("grok", { stanje: "prijava" })],
};

const ni = () => Promise.resolve(true);

describe("AgentiKartica", () => {
  const html = renderToStaticMarkup(createElement(AgentiKartica, { stanje: STANJE, zaposlen: false, onUkaz: ni }));

  it("zaznani agenti imajo stikalo; nezaznan nima; grok pove, da je potrebna prijava (grok login)", () => {
    expect(html.match(/type="checkbox"/g)?.length).toBe(5);
    expect(html).toContain('aria-label="agy"');
    expect(html).toContain(sl.agPrijava);
    expect(html).toContain("grok login");
    expect(html).toContain(sl.agNiNajden);
  });

  it("jasno pove, da ima kanal in samodejni odgovor samo Claude Code", () => {
    expect(html).toContain(sl.agSamoClaudeKanal);
    expect(html.split(sl.agKanalDa).length - 1).toBe(1);
  });

  it("v izbiri za dodelitev so samo vklopljeni, preverjeni agenti z zacetnim pozivom (ne agy, opencode, kimi, grok)", () => {
    const izbira = html.slice(html.indexOf("<select"), html.indexOf("</select>"));
    expect(izbira).toContain('value="claude"');
    expect(izbira).toContain('value="pi"');
    for (const x of ["agy", "opencode", "kimi", "grok"]) expect(izbira).not.toContain(`value="${x}"`);
    expect(html).toContain(sl.agKimiBrezPoziva);
  });

  it("obrazec »Dodeli nalogo«: agent, mapa, besedilo, kdaj (zdaj, ob uri, ko konca); prepovedane mape so vidne", () => {
    expect(html).toContain(sl.agDodeli);
    for (const k of ["agKdajZdaj", "agKdajUra", "agKdajPo", "agMapa", "agBesedilo", "agPrepovedane"] as const) expect(html).toContain(sl[k]);
    expect(html).toContain("/home/a/scit");
  });
});

describe("NalogaVrstica: stanje, agent, ura, ocena in opomnik", () => {
  const n: JavnaNaloga = {
    id: "0123456789abcdef", izvor: "telefon", agent: "pi", mapa: "/home/a/p", besedilo: "Naloga.", zgostitev: "a".repeat(64), stanje: "tece",
    ustvarjeno: "2026-11-24T08:00:00.000Z", potrjeno: "2026-11-24T08:00:00.000Z", razlog: null, porocilo: null, pogoj: { vrsta: "zdaj" },
    ocena: { konec: "2026-11-24T08:30:00.000Z", groba: true }, opomnik: { cas: "2026-11-24T08:45:00.000Z", razlog: "terminal-zaprt", krog: 1 }, koncano: null,
  };
  it("pokaze agenta, oceno konca (groba), opomnik z razlogom v ljubljanskem casu", () => {
    const html = renderToStaticMarkup(createElement("ul", null, createElement(NalogaVrstica, { n, zaposlen: false, onUkaz: ni })));
    expect(html).toContain("pi");
    expect(html).toContain(sl.agOcena);
    expect(html).toContain(sl.agGroba);
    expect(html).toContain("09:30");
    expect(html).toContain("09:45");
    expect(html).toContain(sl.agROpTerminal);
    expect(html).toContain(sl.agIzvorTelefon);
  });
  it("Linin predlog za drugega agenta ne pise »odpri Claude Code«; neznan PID ima nevtralen razlog opomnika", () => {
    const c = renderToStaticMarkup(createElement(NalogaVrstica, { n: { ...n, izvor: "lina", stanje: "caka" }, zaposlen: false, onUkaz: ni }));
    expect(c).not.toContain(sl.rcPotrdi);
    expect(c).toContain(`${sl.agPotrdiAgent} pi`);
    const b = renderToStaticMarkup(createElement(NalogaVrstica, { n: { ...n, opomnik: { ...n.opomnik!, razlog: "brez-porocila" } }, zaposlen: false, onUkaz: ni }));
    expect(b).toContain(sl.agROpBrez);
    expect(b).not.toContain(sl.agROpTerminal);
  });

  it("dodeljena ima Preklici; zamujena ima Potrdi in Preklici", () => {
    const d = renderToStaticMarkup(createElement(NalogaVrstica, { n: { ...n, stanje: "dodeljeno", pogoj: { vrsta: "ura", cas: "2026-11-24T10:00:00.000Z" } }, zaposlen: false, onUkaz: ni }));
    expect(d).toContain(sl.agPreklici);
    expect(d).toContain("11:00");
    const z = renderToStaticMarkup(createElement(NalogaVrstica, { n: { ...n, stanje: "zamujeno" }, zaposlen: false, onUkaz: ni }));
    expect(z).toContain(sl.agZamujenoPotrdi);
    expect(z).toContain(sl.agPreklici);
  });
});

describe("besedila agentov v sl IN en", () => {
  it("vsak kljuc ag* ima neprazen prevod v obeh jezikih, ki se razlikuje", () => {
    const kljuci = Object.keys(sl).filter((k) => k.startsWith("ag") && /^ag[A-Z]/.test(k)) as Array<keyof typeof sl>;
    expect(kljuci.length).toBeGreaterThan(20);
    for (const k of kljuci) {
      expect(sl[k].trim(), k).not.toBe("");
      expect(en[k].trim(), k).not.toBe("");
    }
    expect(en.agDodeli).not.toBe(sl.agDodeli);
  });
});
