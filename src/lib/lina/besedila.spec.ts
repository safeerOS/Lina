/**
 * Podokna dolgih zavihkov Line (lastnik 15. 11. 2026: »Nastavitve so dolgo brskanje po strani dol«; pravilo velja za vsako stran,
 * ki je daljsa od enega zaslona - Nastavitve in Znanje).
 * Preizkus v pravem izrisu (react-dom/server): vsak razdelek in vsako polje je pod pravim podoknom, nobeno ne manjka,
 * nobeno se ne podvoji, ni praznih podoken; tipkovnica, aria, shramba brez izjeme. Vitest (node), ker tsx node:test ne zna.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Knowledge, NastavitveVsebina } from "../../components/lina-desk.tsx";
import { en, sl } from "./besedila.ts";
import {
  jePodoknoId,
  kljucPodokna,
  naslednjePodokno,
  NASTAVITVE,
  preberiPodokno,
  shraniPodokno,
  ZNANJE,
  type DefinicijaPodoken,
  type PodoknoNastavitev,
  type PodoknoZnanja,
} from "./podokna-definicije.ts";
import type { BrainPublic, Catalog, Pravila, StorageView } from "./types.ts";

// Pravila z vsemi pogojnimi polji, da se izrisejo tudi cakanje, ime lastnika in namig govora.
const PRAVILA = {
  povprasevanje: "",
  prevzem: "neodgovorjeni",
  cakanjeSekund: 28,
  pozdrav: "",
  preusmeritev: "",
  dovoljenePredpone: "",
  javniNaslov: "",
  garancijaVklop: false,
  garancijaBesedilo: "",
  dostavaVklop: false,
  dostavaBesedilo: "",
  rokVklop: false,
  rokBesedilo: "",
  temaOdgovor: "",
  najdaljsiPogovorMinut: null,
  tisinaPoGovoruSek: 1,
  toplePovezave: true,
  potrditevEposta: false,
  potrditevNaslov: "",
  snemanjeVklop: false,
  snemanjeZavrnitev: false,
  snemanjeHrambaDni: 7,
  nacinKlica: "podjetje",
  imeLastnika: "",
  govorModel: "gemini-2.5-flash",
  hintsGovor: "",
} as unknown as Pravila;
const PRAVILA_OSEBNA: Pravila = {
  ...PRAVILA,
  nacinKlica: "osebna",
  imeLastnika: "Ana",
};
const MOZGANI: BrainPublic = { provider: "gemini", model: "m", nastavljen: false, namig: null };
const MAPA: StorageView = { ok: true, mapa: "/podatki/lina", razlog: "", opozorila: [] };
const KATALOG = {
  company: { name: "", trade: "", phone: "", address: "", hours: "", about: "" },
  materials: [{ id: "m1", name: "hrast", note: "" }],
  products: [{ id: "p1", name: "miza", kind: "", summary: "", materialIds: [] }],
} as unknown as Catalog;
const brez = () => {};

function izrisiNastavitve(zacetno?: PodoknoNastavitev, pravila: Pravila = PRAVILA): string {
  return renderToStaticMarkup(
    createElement(NastavitveVsebina, {
      pravila,
      mind: MOZGANI,
      place: MAPA,
      busy: false,
      zacetno,
      onPravila: brez,
      onSave: brez,
      onBrain: brez,
      onPlace: brez,
      onError: brez,
      onBusy: brez,
    }),
  );
}

function izrisiZnanje(zacetno?: PodoknoZnanja): string {
  return renderToStaticMarkup(
    createElement(Knowledge, {
      catalog: KATALOG,
      zacetno,
      busy: false,
      pravila: PRAVILA,
      vrzeli: [],
      onChange: brez,
      onPravila: brez,
      onVrzeli: brez,
      onSave: brez,
      onSaveRules: brez,
      onError: brez,
      onBusy: brez,
    }),
  );
}

/** Razreze izris na vsebino podoken; vsako podokno je od svojega role="tabpanel" do naslednjega. */
function podokna(html: string, def: DefinicijaPodoken): Record<string, string> {
  const zacetki = [...html.matchAll(new RegExp(`<div role="tabpanel" id="${def.predpona}-podokno-([a-z]+)"`, "g"))];
  const izid: Record<string, string> = {};
  zacetki.forEach((m, i) => {
    izid[m[1]] = html.slice(m.index, i + 1 < zacetki.length ? zacetki[i + 1].index : html.length);
  });
  return izid;
}

// Vsako polje iz starih strani (enega zaslona Nastavitve in Znanje) in podokno, kamor spada.
const POLJA_NASTAVITVE: Record<string, string[]> = {
  prevzem: ['name="prevzem"', 'id="preusmeritev"', 'id="cakanje"', 'name="nacinKlica"', 'id="predpone"'],
  pozdrav: ['id="pozdrav"', 'id="najdaljsi"', 'id="govorModel"', 'id="hintsGovor"', 'id="tople-povezave-vklop"'],
  javni: ['id="javni-naslov"', 'id="pt-nacin-samodejno"'],
  twilio: ['id="tw-naslov"'],
  iphone: ['id="iphone-naslov"'],
  odgovori: ['id="tema-odgovor"', 'id="garancija-vklop"', 'id="garancija-besedilo"', 'id="dostava-vklop"', 'id="dostava-besedilo"'],
  potrditev: ['id="potrditev-naslov"', 'id="potrditev-vklop"'],
  mozgani: ["Možgani", "Ponudnik", "Preveri ključ"],
  podatki: ['id="snemanje-vklop"', 'id="snemanje-zavrnitev"', 'id="snemanje-hramba"', 'id="mapa"', "Shranjevanje"],
  dodatki: ['id="nast-dodatki"', 'id="om-naslov-polje"', 'id="om-kljuc"'],
  strani: ['id="nast-strani"'],
  posodobitev: ['id="nast-posodobitev"', sl.posGumb, sl.posPojasnilo],
};
const POLJA_ZNANJE: Record<string, string[]> = {
  podjetje: ["Dejavnost", "Telefon", "O delavnici", 'id="znanje-besedilo"'],
  povprasevanje: ['id="povprasevanje"'],
  izdelki: ['aria-label="Ime materiala"', 'aria-label="Ime izdelka"', "+ material", "+ izdelek"],
  splet: ['id="splet-naslov"'],
  vrzeli: [],
  kljuci: ['id="tf-naslov"', 'id="br-naslov"'],
  spomin: ['id="nu-naslov"', 'id="sp-naslov"'],
  avtonomija: ['id="zn-avtonomija"', sl.samostojnoNaslov],
};

const SKUPINE = [
  { ime: "Nastavitve", def: NASTAVITVE, izrisi: (z?: string) => izrisiNastavitve(z as never), polja: POLJA_NASTAVITVE },
  { ime: "Znanje", def: ZNANJE, izrisi: (z?: string) => izrisiZnanje(z as never), polja: POLJA_ZNANJE },
];

for (const { ime, def, izrisi, polja } of SKUPINE) {
  describe(`podokna ${ime}: razvrstitev`, () => {
    it("vsako polje je v pravem podoknu natanko enkrat in nikjer drugje", () => {
      const html = izrisi();
      const deli = podokna(html, def);
      expect(Object.keys(deli).sort()).toEqual(def.podokna.map((p) => p.id).sort());
      expect(Object.keys(polja).sort()).toEqual(def.podokna.map((p) => p.id).sort());
      for (const [podokno, seznam] of Object.entries(polja)) {
        for (const polje of seznam) {
          // Polje z id mora biti v izrisu natanko enkrat (radio gumbi in besedila imajo vec pojavitev).
          if (polje.startsWith('id="')) expect(html.split(polje).length - 1, `${polje} v celotnem izrisu`).toBe(1);
          expect(deli[podokno], `${polje} pod podoknom ${podokno}`).toContain(polje);
        }
      }
    });

    it("vsak razdelek ima ovojnico pod pravim podoknom, noben ni podvojen ali izgubljen", () => {
      const html = izrisi();
      const deli = podokna(html, def);
      const vsi = [...html.matchAll(/data-razdelek="([a-z-]+)"/g)].map((m) => m[1]);
      expect(vsi.length).toBe(new Set(vsi).size);
      expect([...vsi].sort()).toEqual(def.podokna.flatMap((p) => [...p.razdelki]).sort());
      for (const podokno of def.podokna) for (const razdelek of podokno.razdelki) expect(deli[podokno.id]).toContain(`data-razdelek="${razdelek}"`);
    });

    it("brez praznih podoken; razdelek je samo pod enim podoknom", () => {
      const razdelki = def.podokna.flatMap((p) => [...p.razdelki]);
      expect(new Set(razdelki).size).toBe(razdelki.length);
      for (const podokno of def.podokna) expect(podokno.razdelki.length).toBeGreaterThan(0);
      const deli = podokna(izrisi(), def);
      for (const podokno of def.podokna) expect(deli[podokno.id].length, podokno.id).toBeGreaterThan(300);
    });
  });

  describe(`podokna ${ime}: dostopnost`, () => {
    it("tablist, tab, tabpanel: aria-selected samo pri enem, roving tabindex, povezave aria-controls", () => {
      const izbranoId = def.podokna[2].id;
      const html = izrisi(izbranoId);
      expect(html).toContain('role="tablist"');
      expect(html).toContain(`aria-label="${sl[def.naziv]}"`);
      expect((html.match(/role="tab"/g) ?? []).length).toBe(def.podokna.length);
      expect((html.match(/aria-selected="true"/g) ?? []).length).toBe(1);
      for (const p of def.podokna) {
        const izbrano = p.id === izbranoId;
        const gumb = html.match(new RegExp(`<button[^>]*id="${def.predpona}-zavihek-${p.id}"[^>]*>`))?.[0] ?? "";
        expect(gumb).toContain(`aria-controls="${def.predpona}-podokno-${p.id}"`);
        expect(gumb).toContain(`aria-selected="${izbrano}"`);
        expect(gumb).toContain(`tabindex="${izbrano ? 0 : -1}"`);
        const plosca = html.match(new RegExp(`<div role="tabpanel" id="${def.predpona}-podokno-${p.id}"[^>]*>`))?.[0] ?? "";
        expect(plosca).toContain(`aria-labelledby="${def.predpona}-zavihek-${p.id}"`);
        expect(plosca.includes("hidden"), `podokno ${p.id} skrito`).toBe(!izbrano);
      }
    });

    it("privzeto je izbrano prvo podokno", () => {
      expect(izrisi()).toMatch(new RegExp(`<button[^>]*id="${def.predpona}-zavihek-${def.podokna[0].id}"[^>]*aria-selected="true"`));
    });

    it("tipkovnica: puscice, Home, End, ovijanje; druge tipke ne premaknejo", () => {
      const [prvo, drugo] = def.podokna;
      const zadnje = def.podokna[def.podokna.length - 1];
      expect(naslednjePodokno(def, prvo.id, "ArrowRight")).toBe(drugo.id);
      expect(naslednjePodokno(def, prvo.id, "ArrowDown")).toBe(drugo.id);
      expect(naslednjePodokno(def, prvo.id, "ArrowLeft")).toBe(zadnje.id);
      expect(naslednjePodokno(def, prvo.id, "ArrowUp")).toBe(zadnje.id);
      expect(naslednjePodokno(def, zadnje.id, "ArrowRight")).toBe(prvo.id);
      expect(naslednjePodokno(def, drugo.id, "Home")).toBe(prvo.id);
      expect(naslednjePodokno(def, drugo.id, "End")).toBe(zadnje.id);
      expect(naslednjePodokno(def, drugo.id, "Enter")).toBeNull();
      expect(naslednjePodokno(def, drugo.id, "a")).toBeNull();
      expect(naslednjePodokno(def, "neznano", "ArrowRight")).toBeNull();
    });

    it("naslovi podoken v vseh jezikih datoteke (sl, en), vsi razlicni in neprazni", () => {
      for (const jezik of [sl, en] as const) {
        const naslovi = def.podokna.map((p) => jezik[p.oznaka]);
        expect(naslovi.every((n) => typeof n === "string" && n.length > 0)).toBe(true);
        expect(new Set(naslovi).size).toBe(naslovi.length);
        expect(jezik[def.naziv].length).toBeGreaterThan(0);
      }
    });

    it("izbrano podokno se zapomni; napacna vrednost ali shramba z izjemo ne podre strani", () => {
      const zapisi: Record<string, string> = {};
      const shramba = { getItem: (k: string) => zapisi[k] ?? null, setItem: (k: string, v: string) => void (zapisi[k] = v) };
      const drugo = def.podokna[1].id;
      expect(preberiPodokno(def, shramba)).toBeNull();
      shraniPodokno(def, drugo, shramba);
      expect(zapisi[kljucPodokna(def)]).toBe(drugo);
      expect(preberiPodokno(def, shramba)).toBe(drugo);
      zapisi[kljucPodokna(def)] = "<script>";
      expect(preberiPodokno(def, shramba)).toBeNull();
      const pokvarjena = {
        getItem: () => {
          throw new Error("blokirano");
        },
        setItem: () => {
          throw new Error("blokirano");
        },
      };
      expect(preberiPodokno(def, pokvarjena)).toBeNull();
      expect(() => shraniPodokno(def, drugo, pokvarjena)).not.toThrow();
      expect(preberiPodokno(def)).toBeNull(); // brez window v node: izjema je ujeta
      expect(jePodoknoId(def, drugo)).toBe(true);
      expect(jePodoknoId(def, "nekaj")).toBe(false);
    });
  });
}

describe("podokna Nastavitve: gumb in naslovi pravil", () => {
  it("gumb Shrani pravila je v vsakem podoknu s polji pravil natanko enkrat, drugje ga ni", () => {
    const deli = podokna(izrisiNastavitve(), NASTAVITVE);
    const gumb = sl.shraniPravila;
    for (const id of ["prevzem", "pozdrav", "javni", "odgovori", "potrditev", "podatki", "dodatki"]) expect(deli[id].split(gumb).length - 1, id).toBe(1);
    for (const id of ["twilio", "iphone", "mozgani"]) expect(deli[id], id).not.toContain(gumb);
  });

  it("naslovi razdelkov iz pravil niso izgubljeni", () => {
    const deli = podokna(izrisiNastavitve(), NASTAVITVE);
    for (const kljuc of ["prevzemNaslov", "nacinKlicaNaslov", "dovoljenePredponeNaslov"] as const) expect(deli.prevzem).toContain(sl[kljuc]);
    for (const kljuc of ["pozdravNaslov", "najdaljsiNaslov", "govorModelNaslov", "toplePovezaveVklop"] as const) expect(deli.pozdrav).toContain(sl[kljuc]);
    expect(deli.javni).toContain(sl.javniNaslovNaslov);
    expect(deli.twilio).toContain(sl.statusUrl.slice(0, 40));
    expect(deli.twilio).toContain(sl.twNaslov);
    for (const kljuc of ["temaOdgovorNaslov", "garancijaNaslov", "dostavaNaslov"] as const) expect(deli.odgovori).toContain(sl[kljuc]);
    expect(deli.potrditev).toContain(sl.potrditevNaslov);
    expect(deli.podatki).toContain(sl.snemanjeNaslov);
  });
});

describe("podokna Znanje: gumba za shranjevanje in naslovi", () => {
  it("Shrani znanje je v podoknih Podjetje in Materiali (urejata katalog), drugje ne; Shrani pravila samo pri povprasevanju", () => {
    const deli = podokna(izrisiZnanje(), ZNANJE);
    expect(deli.podjetje.split("Shrani znanje").length - 1).toBe(1);
    expect(deli.izdelki.split("Shrani znanje").length - 1).toBe(1);
    for (const id of ["povprasevanje", "splet", "vrzeli", "kljuci", "spomin"]) expect(deli[id], id).not.toContain("Shrani znanje");
    expect(deli.povprasevanje).toContain(sl.shraniPravila);
  });

  it("naslovi razdelkov niso izgubljeni", () => {
    const deli = podokna(izrisiZnanje(), ZNANJE);
    expect(deli.podjetje).toContain(sl.znanjeNaslov);
    expect(deli.povprasevanje).toContain(sl.cenaNaslov);
    expect(deli.izdelki).toContain(">Materiali<");
    expect(deli.izdelki).toContain(">Izdelki<");
    expect(deli.splet).toContain(sl.spletPolje);
    expect(deli.vrzeli).toContain(sl.vrzeliNaslov);
    expect(deli.kljuci).toContain(sl.tfNaslov);
    expect(deli.kljuci).toContain(sl.brNaslov);
    expect(deli.spomin).toContain(sl.nujniNaslov);
    expect(deli.spomin).toContain(sl.spominNaslov);
  });
});

describe("podokna v osebnem nacinu", () => {
  it("v osebnem nacinu podokna odgovori in potrditev v traku ni, prevzem ima imeLastnika, ostalih je poslovno minus ti dve", () => {
    const html = izrisiNastavitve(undefined, PRAVILA_OSEBNA);
    const deli = podokna(html, NASTAVITVE);
    expect(html).not.toContain('id="nast-zavihek-odgovori"');
    expect(html).not.toContain('id="nast-zavihek-potrditev"');
    expect(deli.odgovori).toBeUndefined();
    expect(deli.potrditev).toBeUndefined();
    expect(html.split('id="imeLastnika"').length - 1).toBe(1);
    expect(deli.prevzem).toContain('id="imeLastnika"');
    const pricakovana = NASTAVITVE.podokna
      .map((p) => p.id)
      .filter((id) => id !== "odgovori" && id !== "potrditev")
      .sort();
    expect(Object.keys(deli).sort()).toEqual(pricakovana);
    expect((html.match(/role="tab"/g) ?? []).length).toBe(NASTAVITVE.podokna.length - 2);
  });

  it("v poslovnem nacinu polja imeLastnika ni", () => {
    expect(izrisiNastavitve()).not.toContain('id="imeLastnika"');
  });
});

describe("podokna: skupna koda", () => {
  it("fokus viden, zmanjsano gibanje in barve samo iz zetonov v izvorni kodi", () => {
    const koda = readFileSync(path.resolve(import.meta.dirname, "../../components/podokna.tsx"), "utf8");
    expect(koda).toContain("focus-visible:outline-2");
    expect(koda).toContain("motion-reduce:transition-none");
    expect(koda).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
