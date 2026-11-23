import type { Catalog, Company, LineState, Material, Product } from "./types.ts";

/** Vzorcna delavnica SAMO za preizkuse (lastnik 11. 11. 2026: prevzete nastavitve so nevtralne, brez vzorcnega podjetja). */
export function formaCatalog(): Catalog {
  return {
    company: {
      name: "FORMA",
      trade: "Mizarska delavnica po meri",
      phone: "+386 1 555 09 00",
      address: "Obrtna ulica 9, Ljubljana",
      hours: "pon–pet 8.00–16.00",
      about:
        "Izdelujemo jedilne mize, kuhinjske otoke, omare in stopnice. " +
        "Obljubimo samo izdelke in materiale s tega seznama.",
    },
    materials: [
      { id: "hrast", name: "Hrast", note: "Masiven evropski hrast." },
      { id: "jesen", name: "Jesen", note: "Svetel jesen." },
      { id: "oreh", name: "Oreh", note: "Temen oreh." },
      { id: "jeklo", name: "Jeklo", note: "Prašno barvano jeklo za ogrodje." },
    ],
    products: [
      {
        id: "alba",
        name: "Alba",
        kind: "jedilna miza",
        summary: "Jedilna miza po meri iz masivnega lesa.",
        materialIds: ["hrast", "jesen"],
      },
      {
        id: "nara",
        name: "Nara",
        kind: "kuhinjski otok",
        summary: "Kuhinjski otok z jeklenim ogrodjem.",
        materialIds: ["hrast", "jeklo"],
      },
      {
        id: "lira",
        name: "Lira",
        kind: "omara",
        summary: "Omara z okvirnimi vrati.",
        materialIds: ["hrast", "oreh"],
      },
      {
        id: "kaskada",
        name: "Kaskada",
        kind: "stopnice",
        summary: "Stopnice z lesenimi nastopnimi ploskvami.",
        materialIds: ["hrast", "jesen", "jeklo"],
      },
    ],
  };
}

/** Nevtralen privzetek (lastnik 11. 11. 2026): prazno podjetje, nobenega izdelka ali materiala; uporabnik vse vnese sam. */
export function defaultLine(): LineState {
  return { open: false, catalog: { company: blankCompany(), products: [], materials: [], zapiski: [], znanje: "" }, updatedAt: null };
}

export function blankCompany(): Company {
  return { name: "", trade: "", phone: "", address: "", hours: "", about: "" };
}

export function blankMaterial(): Material {
  return { id: "", name: "", note: "" };
}

export function blankProduct(): Product {
  return { id: "", name: "", kind: "", summary: "", materialIds: [] };
}
