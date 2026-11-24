/**
 * Izbira oken na Domovu (lastnik 21. 11. 2026: »uporabnik sam izbira, katera okna bo imel, nacelo priljubljene moznosti«).
 * Cista logika brez Reacta (preizkus: domov-izbira.test.ts), enaka na Linuxu in Windows; shranjuje jo domov.tsx v lokalno shrambo.
 *
 * - Ploscice (hitra dejanja): uporabnik izbere do NAJVEC_PLOSCIC med vsemi razdelki; vrstni red = vrstni red izbire.
 * - Okna (kartice desno): Danes, Hitre informacije, Majhni koraki; vsako se sme skriti.
 * Poškodovana ali tuja shramba nikoli ne podre Domova: neznani id-ji se zavržejo, brez ploščic velja privzeta izbira.
 */

export type IdPloscice =
  | "vprasanje" | "koledar" | "opravilo" | "sporocila" | "klici" | "nastavitve"
  | "imenik" | "zapiski" | "dnevnik" | "telefon" | "linija" | "znanje";
export type IdOkna = "danes" | "hitre" | "majhni";

export const NAJVEC_PLOSCIC = 6;
export const KLJUC_IZBIRE = "lina2-domov-izbira-v1";

export const VSE_PLOSCICE: readonly IdPloscice[] = [
  "vprasanje", "koledar", "opravilo", "sporocila", "klici", "nastavitve",
  "imenik", "zapiski", "dnevnik", "telefon", "linija", "znanje",
];
export const VSA_OKNA: readonly IdOkna[] = ["danes", "hitre", "majhni"];
export const PRIVZETE_PLOSCICE: readonly IdPloscice[] = ["vprasanje", "koledar", "opravilo", "sporocila", "klici", "nastavitve"];

/** Stran levega menija, ki jo ploščica odpre. */
export const STRAN_PLOSCICE: Readonly<Record<IdPloscice, string>> = {
  vprasanje: "pogovor",
  koledar: "koledar",
  opravilo: "koledar",
  sporocila: "narocila",
  klici: "klic",
  nastavitve: "nastavitve",
  imenik: "imenik",
  zapiski: "zapiski",
  dnevnik: "dnevnik",
  telefon: "telefon",
  linija: "linija",
  znanje: "znanje",
};

export type IzbiraDomov = { ploscice: IdPloscice[]; okna: IdOkna[] };

export function privzetaIzbira(): IzbiraDomov {
  return { ploscice: [...PRIVZETE_PLOSCICE], okna: [...VSA_OKNA] };
}

const jePloscica = (v: unknown): v is IdPloscice => typeof v === "string" && (VSE_PLOSCICE as readonly string[]).includes(v);
const jeOkno = (v: unknown): v is IdOkna => typeof v === "string" && (VSA_OKNA as readonly string[]).includes(v);
const brezDvojnikov = <T,>(a: T[]): T[] => a.filter((x, i) => a.indexOf(x) === i);

/** Prebere shranjeno izbiro (JSON niz ali null); vse nepravilno se popravi, ne vrže. */
export function razberiIzbiro(surovo: string | null | undefined): IzbiraDomov {
  const izid = privzetaIzbira();
  if (typeof surovo !== "string" || !surovo) return izid;
  let v: unknown;
  try {
    v = JSON.parse(surovo);
  } catch {
    return izid;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return izid;
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.ploscice)) {
    const p = brezDvojnikov(o.ploscice.filter(jePloscica)).slice(0, NAJVEC_PLOSCIC);
    if (p.length > 0) izid.ploscice = p;
  }
  // Prazen seznam oken je veljavna izbira (uporabnik je skril vse); manjkajoc ali nepravilen = privzeto (vsa).
  if (Array.isArray(o.okna)) izid.okna = brezDvojnikov(o.okna.filter(jeOkno));
  return izid;
}

/** Vklopi ali izklopi ploščico: najvec NAJVEC_PLOSCIC, vsaj ena ostane (Domov brez hitrih dejanj ni namen). */
export function preklopiPloscico(i: IzbiraDomov, id: IdPloscice): IzbiraDomov {
  if (!jePloscica(id)) return i;
  if (i.ploscice.includes(id)) {
    if (i.ploscice.length <= 1) return i;
    return { ...i, ploscice: i.ploscice.filter((x) => x !== id) };
  }
  if (i.ploscice.length >= NAJVEC_PLOSCIC) return i;
  return { ...i, ploscice: [...i.ploscice, id] };
}

export function preklopiOkno(i: IzbiraDomov, id: IdOkna): IzbiraDomov {
  if (!jeOkno(id)) return i;
  return { ...i, okna: i.okna.includes(id) ? i.okna.filter((x) => x !== id) : [...i.okna, id] };
}

export function jeOknoVidno(i: IzbiraDomov, id: IdOkna): boolean {
  return i.okna.includes(id);
}

/** Ploščica je na voljo, če njena stran obstaja v meniju tega načina (npr. Znanje je v osebnem načinu skrito). */
export function ploscicaNaVoljo(id: IdPloscice, strani: readonly string[] | undefined): boolean {
  return strani === undefined || strani.includes(STRAN_PLOSCICE[id]);
}

/** Vse ploščice, ki jih uporabnik sme izbrati (po vrstnem redu seznama). */
export function izbirnePloscice(strani: readonly string[] | undefined): IdPloscice[] {
  return VSE_PLOSCICE.filter((id) => ploscicaNaVoljo(id, strani));
}

/** Ploščice, ki se res prikažejo: izbrane in na voljo, v vrstnem redu izbire; če bi ostalo prazno, privzete na voljo. */
export function vidnePloscice(i: IzbiraDomov, strani: readonly string[] | undefined): IdPloscice[] {
  const izbrane = i.ploscice.filter((id) => ploscicaNaVoljo(id, strani));
  if (izbrane.length > 0) return izbrane;
  const privzete = PRIVZETE_PLOSCICE.filter((id) => ploscicaNaVoljo(id, strani));
  return privzete.length > 0 ? [...privzete] : [...PRIVZETE_PLOSCICE];
}

export function serializirajIzbiro(i: IzbiraDomov): string {
  return JSON.stringify({ v: 1, ploscice: i.ploscice, okna: i.okna });
}

/**
 * Kartica »Zadnji klici« na Domovu (lastnik 23. 11. 2026: klici, ki jih je prevzela Lina, vidni BREZ drsenja). Vrstice so ze
 * urejene od najnovejse (kliciZaPrikaz); kartica pokaze najvec NAJVEC_ZADNJIH_KLICEV, povzetek v eni kratki vrstici.
 */
export const NAJVEC_ZADNJIH_KLICEV = 4;
export const NAJVEC_ZNAKOV_POVZETKA = 70;

export type VrsticaKlica = { sid: string; kdaj: string; ime: string; telefon: string; kaj: string; zakljucen: boolean };

export function zadnjiKliciDomov<T extends VrsticaKlica>(klici: readonly T[], najvec = NAJVEC_ZADNJIH_KLICEV): VrsticaKlica[] {
  return klici.slice(0, Math.max(0, najvec)).map((k) => {
    const kaj = (k.kaj ?? "").replace(/\s+/g, " ").trim();
    return {
      sid: k.sid,
      kdaj: k.kdaj,
      ime: k.ime,
      telefon: k.telefon,
      kaj: kaj.length > NAJVEC_ZNAKOV_POVZETKA ? `${kaj.slice(0, NAJVEC_ZNAKOV_POVZETKA - 1).trimEnd()}…` : kaj,
      zakljucen: k.zakljucen,
    };
  });
}
