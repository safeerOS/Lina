/**
 * Tocke naloge s preverbo (lastnik 24. 11. 2026; vzrok: 23. 11. je Lina Claude Codu poslala 5 tock, narejena 1, nihce ni opazil).
 * Cista logika brez diska: naloga se razbije na ostevilcene tocke, agent v porocilu za VSAKO tocko navede dokaz (pot datoteke, preizkus,
 * commit) ali »ni narejeno - razlog«. Porocilo je nezaupljivo besedilo: dokaze preveri streznik (claude-naloge.server.ts), tu se samo
 * razbere, kaj agent trdi. Naloga je koncana sele, ko ima vsaka tocka preverjen dokaz.
 */
import { lstat } from "node:fs/promises";
import path from "node:path";

/** Ista mapa kot MAPA_NALOG v claude-naloge.ts (brez uvoza: modul uvaza tudi kanal, ki claude-naloge ne sme doseci). */
const MAPA_NALOG = ".lina-naloge";

export const NAJVEC_TOCK = 30;
/** Najvec dokazov na tocko (preverba vsakega pomeni branje diska ali git). */
export const NAJVEC_DOKAZOV = 5;

const OSTEVILCENA = /^\s*(\d{1,3})[.)]\s+(\S.*)$/;
const ALINEJA = /^\s*[-*]\s+(\S.*)$/;

function zlozi(deli: string[]): string {
  return deli.join(" ").replace(/\s+/g, " ").trim();
}

/** Seznam (ostevilcen ali z alinejami) iz vrstic: nadaljevalne zamaknjene vrstice ostanejo pri tocki, prazna ali nezamaknjena ga konca. */
function seznam(vrstice: string[], vzorec: RegExp, skupina: number): string[] {
  const tocke: string[][] = [];
  let odprta: string[] | null = null;
  for (const v of vrstice) {
    const m = vzorec.exec(v);
    if (m) {
      tocke.push((odprta = [m[skupina]!]));
    } else if (odprta && /^\s+\S/.test(v)) {
      odprta.push(v.trim());
    } else {
      odprta = null;
    }
  }
  return tocke.map(zlozi);
}

/**
 * Tocke naloge: ostevilcen seznam (»1.« ali »1)«); brez njega vsaj dve alineji (»-« ali »*«); sicer je cela naloga ena tocka.
 * Vec kot NAJVEC_TOCK: preostale se zdruzijo v zadnjo (nobena se ne izgubi).
 */
export function tockeNaloge(besedilo: string): string[] {
  const vrstice = besedilo.replace(/\r\n?/g, "\n").split("\n");
  let t = seznam(vrstice, OSTEVILCENA, 2);
  if (!t.length) {
    t = seznam(vrstice, ALINEJA, 1);
    if (t.length < 2) t = [];
  }
  if (!t.length) t = [zlozi([besedilo])];
  if (t.length > NAJVEC_TOCK) t = [...t.slice(0, NAJVEC_TOCK - 1), zlozi(t.slice(NAJVEC_TOCK - 1))];
  return t.filter(Boolean);
}

/**
 * Razdelek NALOGA.md (ali dodatek nalogi v kanalu): tocke T1..Tn in stroga oblika vrstice porocila (SL; EN sprejeto enako).
 * kanal: porocilo je besedilo reply z vrsta=koncano; commit tam ni dokaz (kanal nima gita projekta).
 */
export function navodiloTock(tocke: readonly string[], kanal = false): string[] {
  return [
    "## Tocke naloge (vsaka potrebuje dokaz)",
    "",
    ...tocke.map((t, i) => `T${i + 1}: ${t}`),
    "",
    kanal
      ? "V odgovoru reply z vrsta=koncano za VSAKO tocko natanko ena vrstica na zacetku vrstice (commit tu ni dokaz, navedi datoteko):"
      : "V porocilu za VSAKO tocko natanko ena vrstica na zacetku vrstice:",
    "- `T<n>: narejeno - dokaz: <pot datoteke v projektu>; preizkus: <pot datoteke preizkusa>; commit: <hash>` (vsaj en dokaz)",
    "- `T<n>: ni narejeno - razlog: <zakaj>`",
    "Poti so relativne na projektno mapo. Preizkus steje samo, ce je ime njegove datoteke tudi v izpisu preizkusov, ki ga prilozis v porocilo.",
    "Lina dokaze preveri; tocka brez vrstice ali z dokazom, ki ne obstaja, ostane odprta.",
    "English is accepted too: `T<n>: done - evidence: ...` / `T<n>: not done - reason: ...`.",
    "",
  ];
}

export type VrstaDokaza = "pot" | "preizkus" | "commit";
export type Dokaz = { vrsta: VrstaDokaza; vrednost: string };
export type TrditevTocke = { st: number; stanje: "narejeno" | "ni-narejeno" | "manjka"; dokazi: Dokaz[] };

const VRSTICA_TOCKE = /^\s*(?:[-*]\s*)?T(\d{1,3})\s*[:.)-]\s*(.*)$/i;
const NI = /^(?:ni\s+narejeno|not\s+done)\b/i;
const JE = /^(?:narejeno|done)\b/i;

function razberiDokaze(v: string): Dokaz[] {
  const m = /(?:dokaz|evidence)\s*:\s*(.*)$/i.exec(v);
  if (!m) return [];
  const dokazi: Dokaz[] = [];
  for (const kos of m[1]!.split(/[;,]/)) {
    const d = /^\s*(?:(preizkus|test|commit|pot|file|path)\s*:)?\s*(.*?)\s*$/i.exec(kos);
    const vrednost = (d?.[2] ?? "").replace(/^`+|`+$/g, "").trim();
    if (!vrednost) continue;
    const kljuc = (d?.[1] ?? "").toLowerCase();
    const vrsta: VrstaDokaza = kljuc === "preizkus" || kljuc === "test" ? "preizkus" : kljuc === "commit" ? "commit" : "pot";
    // »pot:12« (vrstica) ni del poti
    dokazi.push({ vrsta, vrednost: vrsta === "commit" ? vrednost : vrednost.replace(/:\d+(?::\d+)?$/, "") });
    if (dokazi.length >= NAJVEC_DOKAZOV) break;
  }
  return dokazi;
}

/** Kaj porocilo trdi za tocke 1..n. Prva vrstica tocke velja (kasnejsa je ne preglasi); tocke brez vrstice »manjka«. */
export function razberiPorociloTock(porocilo: string, n: number): TrditevTocke[] {
  const izid: TrditevTocke[] = Array.from({ length: n }, (_, i) => ({ st: i + 1, stanje: "manjka", dokazi: [] }));
  for (const v of porocilo.split("\n")) {
    const m = VRSTICA_TOCKE.exec(v);
    if (!m) continue;
    const st = Number(m[1]);
    const t = izid[st - 1];
    if (!t || t.stanje !== "manjka") continue;
    const telo = m[2]!.trim();
    if (NI.test(telo)) t.stanje = "ni-narejeno";
    else if (JE.test(telo)) {
      t.stanje = "narejeno";
      t.dokazi = razberiDokaze(telo);
    }
  }
  return izid;
}

/** Porocilo brez vrstic tock: tu mora biti izpis preizkusov (preizkus kot dokaz steje samo, ce je omenjen v izpisu). */
export function izpisPorocila(porocilo: string): string {
  return porocilo.split("\n").filter((v) => !VRSTICA_TOCKE.test(v)).join("\n");
}

/**
 * Pot dokaza kot relativna pot v projektu ali null: brez nicelnega znaka, brez »..«, absolutna samo znotraj projekta, nikoli v mapi
 * nalog (.lina-naloge: tam je porocilo samo, ki ga pise agent).
 */
export function varnaRelativnaPot(v: string, projekt: string): string | null {
  if (!v || v.length > 512 || /[\u0000-\u001f]/.test(v)) return null;
  const rel = path.isAbsolute(v) ? path.relative(path.resolve(projekt), path.resolve(v)) : v;
  if (!rel || path.isAbsolute(rel) || rel.split(/[\\/]+/).includes("..")) return null;
  const cista = path.normalize(rel).replace(/\\/g, "/").replace(/^\.\//, "");
  if (!cista || cista === "." || cista.startsWith("../") || cista.split("/")[0] === MAPA_NALOG) return null;
  return cista;
}

export const RAZLOGI_TOCKE = ["manjka", "ni-narejeno", "brez-dokaza", "dokaz-ni-najden"] as const;
export type RazlogTocke = (typeof RAZLOGI_TOCKE)[number];
export type IzidTocke = { st: number; narejeno: boolean; razlog: RazlogTocke | null };
export type PovzetekTock = {
  skupaj: number;
  narejeno: number;
  popolno: boolean;
  manjkajoce: { st: number; besedilo: string; razlog: RazlogTocke }[];
};

/** »3/5 narejeno« in manjkajoce tocke z besedilom iz NALOGE (nikoli iz porocila) in kodo razloga. */
export function povzetekTock(tocke: readonly string[], izid: readonly IzidTocke[]): PovzetekTock {
  const manjkajoce = tocke.flatMap((besedilo, i) => {
    const r = izid.find((x) => x.st === i + 1);
    return r?.narejeno ? [] : [{ st: i + 1, besedilo, razlog: r?.razlog ?? ("manjka" as const) }];
  });
  return { skupaj: tocke.length, narejeno: tocke.length - manjkajoce.length, popolno: manjkajoce.length === 0, manjkajoce };
}

/** Besedilo predloga nove naloge za manjkajoce tocke (zagon samo po lastnikovi potrditvi): ostevilcen seznam v meji znakov. */
export function besediloPredlogaTock(id: string, p: PovzetekTock, najvec: number): string {
  const glava = `Dokoncaj manjkajoce tocke naloge ${id} (${p.narejeno}/${p.skupaj} narejeno):`;
  const n = Math.max(1, p.manjkajoce.length);
  // vsaka tocka dobi enak del prostora; prerez ne izgubi tocke (ostane njen zacetek z »…«)
  const prostor = Math.max(20, Math.floor((najvec - glava.length - n * 6) / n));
  const vrstice = p.manjkajoce.map((m, i) => `${i + 1}. ${m.besedilo.length > prostor ? `${m.besedilo.slice(0, prostor - 1)}…` : m.besedilo}`);
  return [glava, ...vrstice].join("\n").slice(0, najvec);
}

/** Kako streznik ali kanal preveri dokaz na disku (pot je ze varnaRelativnaPot) in commit. */
export type Preverjanje = { pot: (rel: string, mapa: boolean) => Promise<boolean>; commit: (hash: string) => Promise<boolean> };

/**
 * Izid tock iz porocila: »narejeno« samo z vsaj enim dokazom in ce VSI navedeni dokazi obstajajo (pot ali mapa v projektu; preizkus kot
 * datoteka IN ime v izpisu porocila; commit samo hex in obstaja). Drugace koda razloga, nikoli besedilo porocila.
 */
export async function oceniTocke(porocilo: string, n: number, projekt: string, p: Preverjanje): Promise<IzidTocke[]> {
  const izpis = izpisPorocila(porocilo);
  const dokazObstaja = async (d: Dokaz): Promise<boolean> => {
    if (d.vrsta === "commit") return /^[0-9a-f]{7,40}$/i.test(d.vrednost) && (await p.commit(d.vrednost).catch(() => false));
    const rel = varnaRelativnaPot(d.vrednost, projekt);
    if (!rel || !(await p.pot(rel, d.vrsta === "pot").catch(() => false))) return false;
    return d.vrsta === "pot" || izpis.includes(path.basename(rel));
  };
  const izid: IzidTocke[] = [];
  for (const t of razberiPorociloTock(porocilo, n)) {
    if (t.stanje !== "narejeno") izid.push({ st: t.st, narejeno: false, razlog: t.stanje });
    else if (!t.dokazi.length) izid.push({ st: t.st, narejeno: false, razlog: "brez-dokaza" });
    else {
      let vsi = true;
      for (const d of t.dokazi) if (vsi && !(await dokazObstaja(d))) vsi = false;
      izid.push({ st: t.st, narejeno: vsi, razlog: vsi ? null : "dokaz-ni-najden" });
    }
  }
  return izid;
}

const OPIS_RAZLOGA: Record<"sl" | "en", Record<RazlogTocke, string>> = {
  sl: { manjka: "v porocilu ni vrstice", "ni-narejeno": "agent: ni narejeno", "brez-dokaza": "brez dokaza", "dokaz-ni-najden": "dokaza ni v projektu" },
  en: { manjka: "no line in the report", "ni-narejeno": "agent: not done", "brez-dokaza": "no evidence", "dokaz-ni-najden": "evidence not found in the project" },
};

/** Kratko besedilo za telefon: »Tocke: 3/5 narejeno« in manjkajoce (besedilo tocke iz naloge, razlog kot koda v jeziku). */
export function opisTock(p: PovzetekTock, jezik: "sl" | "en" = "sl"): string {
  const glava = jezik === "en" ? `Items: ${p.narejeno}/${p.skupaj} done.` : `Tocke: ${p.narejeno}/${p.skupaj} narejeno.`;
  if (p.popolno) return glava;
  const manjka = p.manjkajoce.map((m) => `T${m.st} ${m.besedilo.slice(0, 120)} (${OPIS_RAZLOGA[jezik][m.razlog]})`).join("; ");
  return jezik === "en"
    ? `${glava} Missing: ${manjka}. The task stays open: send a follow-up for the missing items (nothing starts without your confirmation).`
    : `${glava} Manjka: ${manjka}. Naloga ostane odprta: za manjkajoce poslji nadaljevanje (brez vase potrditve se nic ne zazene).`;
}

/** Pot (ze varnaRelativnaPot) obstaja v projektu kot datoteka (ali mapa, ce je dovoljena) brez simbolne povezave na nobenem delu poti. */
export async function potVProjektu(projekt: string, rel: string, mapa: boolean): Promise<boolean> {
  let pot = projekt;
  for (const del of rel.split("/")) {
    pot = path.join(pot, del);
    if ((await lstat(pot)).isSymbolicLink()) return false;
  }
  const st = await lstat(pot);
  return st.isFile() || (mapa && st.isDirectory());
}
