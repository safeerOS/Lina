/**
 * Zavihek Racunalnik: zaznani agenti s stikali, »Dodeli nalogo«, vrsta s stanjem in uro (lastnik 24. 11. 2026). Izris v pravem
 * Reactu (react-dom/server), ker node:test tsx ne zna. Besedila v sl IN en.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentiKartica, NalogaVrstica, VodjaKartica, ukazPotrdiPrepovedane, ukazUveljavi } from "../../components/lina2/racunalnik.tsx";
import { en, sl } from "./besedila.ts";
import type { JavnaNaloga, JavnoStanjeNalog, StanjeAgenta } from "./claude-naloge.server.ts";

const agent = (id: StanjeAgenta["id"], x: Partial<StanjeAgenta> = {}): StanjeAgenta => ({
  id, ime: id, pot: `/usr/bin/${id}`, stanje: "pripravljen", razlicica: "1.0", vklopljen: true, kanal: id === "claude", zacetniPoziv: id !== "kimi", omejeneMape: id === "opencode" || id === "agy", ...x,
});

const STANJE: JavnoStanjeNalog = {
  naVoljo: true, razlogNiNaVoljo: null, geslo: true, mape: [], prepovedane: ["/home/a/scit"], prepovedaneNepotrjene: false, naloge: [], pregledovalec: "claude", preizkusi: {}, zdruzitve: [], omrezjeAgentov: null,
  agenti: [agent("claude"), agent("agy", { vklopljen: false }), agent("opencode", { stanje: "ni-najden", pot: null }), agent("kimi"), agent("pi"), agent("grok", { stanje: "prijava" })],
};

const ni = () => Promise.resolve(true);

describe("AgentiKartica", () => {
  const html = renderToStaticMarkup(createElement(AgentiKartica, { stanje: STANJE, zaposlen: false, onUkaz: ni }));

  it("zaznani agenti imajo stikalo; nezaznan nima; grok pove, da je potrebna prijava (grok login)", () => {
    // Stikala agentov (aria-label = ime agenta); obrazec »Dodeli nalogo« ima od 02f se izbiro »Velja tudi za vse podobne«.
    expect(html.match(/type="checkbox" aria-label="(?:claude|agy|opencode|kimi|pi|grok)"/g)?.length).toBe(5);
    expect(html).toContain('id="podobne-dodeli"');
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

  it("naloga 30: potrjen seznam prepovedanih - brez opozorila in brez gumba Potrdi seznam", () => {
    expect(html).not.toContain(sl.agPrepovedaneNepotrjene);
    expect(html).not.toContain(sl.agPotrdiSeznam);
  });

  it("naloga 30: nepotrjen seznam - opozorilo (sl in en), prikazan seznam s streznika, gumb potrdi natanko ta seznam; brez gesla onemogocen", () => {
    const nepotrjen = { ...STANJE, prepovedaneNepotrjene: true, prepovedane: ["/home/a/scit", "/home/a/yt"] };
    const h = renderToStaticMarkup(createElement(AgentiKartica, { stanje: nepotrjen, zaposlen: false, onUkaz: ni }));
    const opozorilo = h.slice(h.indexOf(sl.agPrepovedaneNepotrjene));
    expect(h).toContain('role="alert"');
    expect(opozorilo).toContain(sl.agPrepovedaneNepotrjeneNamig);
    expect(opozorilo).toContain("/home/a/yt");
    expect(opozorilo).toContain(sl.agPotrdiSeznam);
    expect(ukazPotrdiPrepovedane(nepotrjen)).toEqual({ ukaz: "prepovedane", mape: ["/home/a/scit", "/home/a/yt"] });
    const prazen = renderToStaticMarkup(createElement(AgentiKartica, { stanje: { ...nepotrjen, prepovedane: [] }, zaposlen: false, onUkaz: ni }));
    expect(prazen).toContain(sl.agPrepovedanePrazen);
    const brezGesla = renderToStaticMarkup(createElement(AgentiKartica, { stanje: { ...nepotrjen, geslo: false }, zaposlen: false, onUkaz: ni }));
    expect(brezGesla.slice(brezGesla.indexOf(sl.agPrepovedaneNepotrjene))).toMatch(new RegExp(`<button type="button" disabled=""[^>]*>${sl.agPotrdiSeznam}`));
    for (const k of ["agPrepovedaneNepotrjene", "agPrepovedaneNepotrjeneNamig", "agPrepovedanePrazen", "agPotrdiSeznam"] as const) {
      expect(en[k].length).toBeGreaterThan(0);
      expect(en[k]).not.toBe(sl[k]);
    }
  });
});

describe("NalogaVrstica: stanje, agent, ura, ocena in opomnik", () => {
  const n: JavnaNaloga = {
    id: "0123456789abcdef", izvor: "telefon", agent: "pi", mapa: "/home/a/p", besedilo: "Naloga.", zgostitev: "a".repeat(64), stanje: "tece",
    ustvarjeno: "2026-11-24T08:00:00.000Z", potrjeno: "2026-11-24T08:00:00.000Z", razlog: null, porocilo: null, pogoj: { vrsta: "zdaj" },
    ocena: { konec: "2026-11-24T08:30:00.000Z", groba: true }, opomnik: { cas: "2026-11-24T08:45:00.000Z", razlog: "terminal-zaprt", krog: 1 }, koncano: null, nacrt: false,
    kopija: null, vloga: null, za: null, vodja: null, tocke: null, predlogTock: null,
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

  it("tocke naloge (24. 11. 2026): nepopolna pokaze »1/3 narejeno«, manjkajoce z razlogom in gumb za nov predlog; s predlogom samo obvestilo", () => {
    const tocke = { skupaj: 3, narejeno: 1, popolno: false, manjkajoce: [{ st: 2, besedilo: "dodaj b.ts", razlog: "dokaz-ni-najden" as const }, { st: 3, besedilo: "README", razlog: "manjka" as const }] };
    const h = renderToStaticMarkup(createElement(NalogaVrstica, { n: { ...n, stanje: "nepopolno", tocke, predlogTock: "napaka" }, zaposlen: false, onUkaz: ni }));
    expect(h).toContain(sl.rcNepopolno);
    expect(h).toContain(`1/3 ${sl.rcTockeNarejeno}`);
    expect(h).toContain("T2");
    expect(h).toContain("dodaj b.ts");
    expect(h).toContain(sl.rcTRDokazNiNajden);
    expect(h).toContain(sl.rcTRManjka);
    expect(h).toContain(sl.rcTockePredlagaj);
    expect(h).toContain(sl.rcPorocilo);
    const p = renderToStaticMarkup(createElement(NalogaVrstica, { n: { ...n, stanje: "nepopolno", tocke, predlogTock: "fedcba9876543210" }, zaposlen: false, onUkaz: ni }));
    expect(p).toContain(sl.rcTockePredlog);
    expect(p).not.toContain(sl.rcTockePredlagaj);
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

describe("Lina kot vodja: vrsta agentov po projektu, pregled, zdruzitev in »Uveljavi«", () => {
  const vodja = { projekt: "/home/a/p", git: true, osnova: "abc", pregledovalec: "claude" as const };
  const glavna: JavnaNaloga = {
    id: "1111111111111111", izvor: "lastnik", agent: "pi", mapa: "/home/a/p", besedilo: "A.", zgostitev: "b".repeat(64), stanje: "koncano",
    ustvarjeno: "2026-11-24T08:00:00.000Z", potrjeno: "2026-11-24T08:00:00.000Z", razlog: null, porocilo: null, pogoj: null, ocena: null,
    opomnik: null, koncano: "2026-11-24T08:20:00.000Z", nacrt: false, kopija: "/home/a/.local/share/lina/delo/1111111111111111/delo", vloga: null, za: null,
    vodja: { ...vodja, faza: "pregled", krog: 2, najdbe: 3 }, tocke: null, predlogTock: null,
  };
  const pregled: JavnaNaloga = {
    ...glavna, id: "2222222222222222", agent: "claude", stanje: "tece", kopija: "/home/a/.local/share/lina/delo/1111111111111111/pregled-2",
    vloga: "pregled", za: glavna.id, vodja: null,
  };
  const zdruzena: JavnaNaloga = { ...glavna, id: "3333333333333333", agent: "grok", vodja: { ...vodja, faza: "lastnik", krog: 3, najdbe: 1, razlog: "krogi" } };
  const stanje: JavnoStanjeNalog = {
    ...STANJE, naloge: [pregled, glavna, zdruzena],
    zdruzitve: [{ projekt: "/home/a/p", pot: "/home/a/.local/share/lina/delo/zdruzitev-x/delo", git: true, veja: "lina/zdruzitev-x", naloge: ["4444444444444444"], zgostitev: "c".repeat(64), diff: "/home/a/.local/share/lina/delo/zdruzitev-x/zdruzitev.diff", osvezi: false, razlog: null, opis: null, podrobnost: null, izvoz: null }],
  };
  const html = renderToStaticMarkup(createElement(VodjaKartica, { stanje, zaposlen: false, onUkaz: ni }));

  it("pokaze projekt, vrsto agentov s fazo, krogom N/3 in najdbami ter polne poti kopij in zdruzitve", () => {
    expect(html).toContain(sl.vdNaslov);
    expect(html).toContain("/home/a/p");
    expect(html).toContain(`${sl.vdKrog} 2/3`);
    expect(html).toContain(`${sl.vdNajdbe}: 3`);
    expect(html).toContain(sl.vdFazaPregled);
    expect(html).toContain(glavna.kopija!);
    // vrsta agentov pri projektu: tudi naloge brez lastne faze (slepi pregled)
    expect(html).toContain(pregled.kopija!);
    expect(html).toContain("/home/a/.local/share/lina/delo/zdruzitev-x/delo");
    expect(html).toContain("lina/zdruzitev-x");
    expect(html).toContain("zdruzitev.diff");
    expect(html).toContain(sl.vdRKrogi);
  });

  it("»Uveljavi« je samo ob zdruzenem delu in pokaze zgostitev, ki jo potrdi; pregledovalec je izbira", () => {
    expect(html).toContain(sl.vdUveljavi);
    expect(html).toContain(sl.vdOpusti);
    expect(html).toContain("c".repeat(64));
    expect(html).toContain(sl.vdPregledovalec);
    const brez = renderToStaticMarkup(createElement(VodjaKartica, { stanje: { ...stanje, zdruzitve: [] }, zaposlen: false, onUkaz: ni }));
    expect(brez).not.toContain(sl.vdUveljavi);
    // med posodabljanjem z izvirnikom ni gumba (zgostitev se bo spremenila); razlog posodobitve je viden
    const osvezuje = renderToStaticMarkup(createElement(VodjaKartica, { stanje: { ...stanje, zdruzitve: [{ ...stanje.zdruzitve[0]!, osvezi: true }] }, zaposlen: false, onUkaz: ni }));
    expect(osvezuje).toContain(sl.vdOsvezuje);
    expect(osvezuje).not.toContain(sl.vdUveljavi);
    const vrnjen = renderToStaticMarkup(createElement(VodjaKartica, { stanje: { ...stanje, zdruzitve: [{ ...stanje.zdruzitve[0]!, razlog: "vrnjen" }] }, zaposlen: false, onUkaz: ni }));
    expect(vrnjen).toContain(sl.vdRVrnjen);
    // tocki 7/8 (popravki-1605): besedilo razloga (ne koda) in dve poti naprej
    const veja = renderToStaticMarkup(createElement(VodjaKartica, { stanje: { ...stanje, zdruzitve: [{ ...stanje.zdruzitve[0]!, razlog: "uveljavi", opis: "git-nastavitve", podrobnost: "core.editor" }] }, zaposlen: false, onUkaz: ni }));
    expect(veja).toContain(sl.vdRUveljavi);
    expect(veja).toContain(sl.vdOpisGitNastavitve.split(" (")[0]);
    expect(veja).toContain("core.editor");
    expect(veja).not.toContain(sl.vdZnova); // ista zavrnitev bi se ponovila: samo izvoz
    expect(veja).toContain(sl.vdIzvozi);
    const premaknjena = renderToStaticMarkup(createElement(VodjaKartica, { stanje: { ...stanje, zdruzitve: [{ ...stanje.zdruzitve[0]!, razlog: "uveljavi", opis: "veja" }] }, zaposlen: false, onUkaz: ni }));
    expect(premaknjena).toContain(sl.vdOpisVeja);
    expect(premaknjena).toContain(sl.vdZnova);
    const agenti = renderToStaticMarkup(createElement(AgentiKartica, { stanje: { ...stanje, omrezjeAgentov: "gostitelj" }, zaposlen: false, onUkaz: ni }));
    expect(agenti).toContain("sudo apt install passt");
    expect(ukazUveljavi(stanje.zdruzitve[0]!)).toEqual({ ukaz: "uveljavi", projekt: "/home/a/p", zgostitev: "c".repeat(64) });
  });

  it("vrstica naloge pokaze vlogo (slepi pregled za nalogo) in po 3 krogih gumb »Vseeno zdruzi«", () => {
    const r = renderToStaticMarkup(createElement(NalogaVrstica, { n: pregled, zaposlen: false, onUkaz: ni }));
    expect(r).toContain(sl.vdVlogaPregled);
    expect(r).toContain(glavna.id);
    expect(r).toContain(pregled.kopija!);
    const z = renderToStaticMarkup(createElement(NalogaVrstica, { n: zdruzena, zaposlen: false, onUkaz: ni }));
    expect(z).toContain(sl.vdZdruziKljub);
    expect(renderToStaticMarkup(createElement(NalogaVrstica, { n: glavna, zaposlen: false, onUkaz: ni }))).not.toContain(sl.vdZdruziKljub);
  });

  it("vsak kljuc vd* ima neprazen prevod v sl IN en", () => {
    const kljuci = Object.keys(sl).filter((k) => /^vd[A-Z]/.test(k)) as Array<keyof typeof sl>;
    expect(kljuci.length).toBeGreaterThan(30);
    for (const k of kljuci) {
      expect(sl[k].trim(), k).not.toBe("");
      expect(en[k].trim(), k).not.toBe("");
    }
    expect(en.vdUveljavi).not.toBe(sl.vdUveljavi);
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
