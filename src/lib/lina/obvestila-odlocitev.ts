/**
 * Enotna odlocitev »ali Lina poslje obvestilo in kam« (lastnik 22. 11. 2026, ideja iz diagrama obvestil Slacka; koda NI prevzeta).
 * Prej so bile odlocitve razprsene (nujni klic, opomnik koledarja, misel dneva). Cista funkcija brez diska in casa (cas je vhod),
 * enaka na Linuxu in Windows; Android dobi prenos v Kotlin. Vrstni red pravil (kot v diagramu, prilagojeno Lini):
 *  1. Vrsta je izklopljena (»nic«) -> NE.
 *  2. Ne moti (odsotnost ali ure miru): samo nujno ali VIP stik z izjemo »nujno prebije ne moti« (privzeto da).
 *  3. Nastavitev vrste: »vse« -> da; »pomembno« -> samo nujno, VIP, kljucna beseda, ali neposredno za uporabnika; »privzeto« -> globalna.
 *  4. Ze prebrano na drugi napravi -> NE (kot Slackov »Mark as read« na racunalniku).
 *  5. Kam: uporabnik je aktiven na racunalniku -> racunalnik; sicer telefon, a telefon sele po pragu zakasnitve (razen nujno),
 *     da obvestilo, ki ga uporabnik vidi na racunalniku, ne zazvoni se na telefonu.
 * Privzeto vse VKLOPLJENO (lastnikove ideje so privzeto vklopljene, z izklopom). Komentarji so brez sumnikov.
 */
import { istaStevilka } from "./guards.ts";

export type VrstaDogodka = "klic" | "sporocilo" | "opomnik" | "nujno" | "agent" | "novica" | "motivacija";
export type RavenObvestil = "vse" | "pomembno" | "nic" | "privzeto";
export type Naprava = "racunalnik" | "telefon";

export type Dogodek = {
  vrsta: VrstaDogodka;
  nujno?: boolean;
  /** Stevilka ali ime posiljatelja (za VIP); primerja se brez presledkov in velikih crk. */
  od?: string;
  besedilo?: string;
  /** Dogodek je neposredno za uporabnika (osebno sporocilo, opomnik, ki ga je sam nastavil). */
  neposredno?: boolean;
  /** Cas dogodka in, ce je ze prebran, na kateri napravi. */
  casMs: number;
  prebranoNa?: Naprava | null;
};

export type NastavitveObvestil = {
  globalno: Exclude<RavenObvestil, "privzeto">;
  poVrsti: Partial<Record<VrstaDogodka, RavenObvestil>>;
  /** Ne moti: rocno ali odsotnost; ure miru v lokalnem casu (od, do; cez polnoc dovoljeno). */
  neMoti: boolean;
  ureMiru?: { od: number; do: number } | null;
  nujnoPrebijeNeMoti: boolean;
  vip: string[];
  kljucneBesede: string[];
  /** Zakasnitev pred obvestilom na telefon, ko racunalnik ni aktiven (kot Slackov »mobile push timing threshold«). */
  zakasnitevTelefonaMs: number;
};

export const PRIVZETE_NASTAVITVE_OBVESTIL: NastavitveObvestil = {
  globalno: "vse",
  poVrsti: { novica: "pomembno", motivacija: "pomembno" },
  neMoti: false,
  ureMiru: null,
  nujnoPrebijeNeMoti: true,
  vip: [],
  kljucneBesede: [],
  zakasnitevTelefonaMs: 60_000,
};

export type Prisotnost = { racunalnikAktiven: boolean; telefonPovezan: boolean; uraLokalno: number };

export type Odlocitev =
  | { poslji: false; razlog: "izklopljeno" | "neMoti" | "nepomembno" | "zePrebrano" | "niNaprave" }
  | { poslji: true; kam: Naprava; zakasnitevMs: number; razlog: "nujno" | "vip" | "kljucnaBeseda" | "neposredno" | "vse" };

const zlozi = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const brezPresledkov = (s: string): string => zlozi(s).replace(/[\s\-()./]/g, "");

function vUrahMiru(ure: NastavitveObvestil["ureMiru"], ura: number): boolean {
  if (!ure || ure.od === ure.do) return false;
  return ure.od < ure.do ? ura >= ure.od && ura < ure.do : ura >= ure.od || ura < ure.do;
}

/** Zakaj je dogodek pomemben (ali null). */
function pomembnost(d: Dogodek, n: NastavitveObvestil): "nujno" | "vip" | "kljucnaBeseda" | "neposredno" | null {
  if (d.nujno || d.vrsta === "nujno") return "nujno";
  // Stevilka v razlicnih oblikah (+386 41 ..., 041 ...) je ista (istaStevilka iz guards.ts, kot pri nujnih klicih); ime brez velikih crk.
  if (d.od && n.vip.some((v) => v.trim() && (brezPresledkov(v) === brezPresledkov(d.od ?? "") || istaStevilka(v, d.od ?? "")))) return "vip";
  const b = zlozi(d.besedilo ?? "");
  if (b && n.kljucneBesede.some((k) => zlozi(k).length >= 3 && b.includes(zlozi(k)))) return "kljucnaBeseda";
  if (d.neposredno) return "neposredno";
  return null;
}

export function odlociObvestilo(d: Dogodek, n: NastavitveObvestil, p: Prisotnost): Odlocitev {
  const raven = n.poVrsti[d.vrsta] && n.poVrsti[d.vrsta] !== "privzeto" ? (n.poVrsti[d.vrsta] as Exclude<RavenObvestil, "privzeto">) : n.globalno;
  // Nujno je vedno vsaj »pomembno«: izklop vrste ga ne utisa, ce nujno prebije ne moti (varnost pred nujnim klicem).
  const zakaj = pomembnost(d, n);
  const jeNujno = zakaj === "nujno";
  if (raven === "nic" && !(jeNujno && n.nujnoPrebijeNeMoti)) return { poslji: false, razlog: "izklopljeno" };
  if ((n.neMoti || vUrahMiru(n.ureMiru, p.uraLokalno)) && !((jeNujno || zakaj === "vip") && n.nujnoPrebijeNeMoti)) {
    return { poslji: false, razlog: "neMoti" };
  }
  if (raven === "pomembno" && !zakaj) return { poslji: false, razlog: "nepomembno" };
  if (d.prebranoNa) return { poslji: false, razlog: "zePrebrano" };
  const razlog = zakaj ?? "vse";
  if (p.racunalnikAktiven) return { poslji: true, kam: "racunalnik", zakasnitevMs: 0, razlog };
  if (!p.telefonPovezan) return { poslji: false, razlog: "niNaprave" };
  return { poslji: true, kam: "telefon", zakasnitevMs: jeNujno ? 0 : Math.max(0, n.zakasnitevTelefonaMs), razlog };
}

const VRSTE: readonly VrstaDogodka[] = ["klic", "sporocilo", "opomnik", "nujno", "agent", "novica", "motivacija"];
const RAVNI: readonly RavenObvestil[] = ["vse", "pomembno", "nic", "privzeto"];
const NAJVEC_SEZNAMA = 50;
const NAJVEC_ZNAKOV_VNOSA = 80;

/**
 * Popravek nastavitev obvestil (samo znana polja z veljavnimi vrednostmi); neveljaven popravek vrne null in nic ne spremeni.
 * Seznami (VIP, kljucne besede) so oreznani, brez praznih in podvojenih vnosov.
 */
export function zdruziNastavitveObvestil(trenutne: NastavitveObvestil, popravek: unknown): NastavitveObvestil | null {
  if (!popravek || typeof popravek !== "object" || Array.isArray(popravek)) return null;
  const p = popravek as Record<string, unknown>;
  const n: NastavitveObvestil = { ...trenutne, poVrsti: { ...trenutne.poVrsti } };
  const seznam = (v: unknown): string[] | null => {
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return null;
    const izid: string[] = [];
    for (const x of v as string[]) {
      const c = x.replace(/\s+/g, " ").trim().slice(0, NAJVEC_ZNAKOV_VNOSA);
      if (c && !izid.includes(c)) izid.push(c);
    }
    return izid.slice(0, NAJVEC_SEZNAMA);
  };
  for (const [k, v] of Object.entries(p)) {
    if (k === "globalno") {
      if (v !== "vse" && v !== "pomembno" && v !== "nic") return null;
      n.globalno = v;
    } else if (k === "poVrsti") {
      if (!v || typeof v !== "object" || Array.isArray(v)) return null;
      for (const [vr, rv] of Object.entries(v as Record<string, unknown>)) {
        if (!VRSTE.includes(vr as VrstaDogodka) || !RAVNI.includes(rv as RavenObvestil)) return null;
        n.poVrsti[vr as VrstaDogodka] = rv as RavenObvestil;
      }
    } else if (k === "neMoti" || k === "nujnoPrebijeNeMoti") {
      if (typeof v !== "boolean") return null;
      n[k] = v;
    } else if (k === "ureMiru") {
      if (v === null) n.ureMiru = null;
      else {
        const u = v as { od?: unknown; do?: unknown };
        const ok = (x: unknown) => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 23;
        if (!v || typeof v !== "object" || !ok(u.od) || !ok(u.do)) return null;
        n.ureMiru = { od: u.od as number, do: u.do as number };
      }
    } else if (k === "vip" || k === "kljucneBesede") {
      const s = seznam(v);
      if (!s) return null;
      n[k] = s;
    } else if (k === "zakasnitevTelefonaMs") {
      if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 30 * 60_000) return null;
      n.zakasnitevTelefonaMs = v as number;
    } else return null;
  }
  return n;
}

/** Shranjene nastavitve (lahko delne ali stare) zdruzi s privzetimi; neveljavno polje se tiho zavrze (pokvarjena datoteka ne podre obvestil). */
export function nastavitveIzShrambe(shranjeno: unknown): NastavitveObvestil {
  let n: NastavitveObvestil = { ...PRIVZETE_NASTAVITVE_OBVESTIL, poVrsti: { ...PRIVZETE_NASTAVITVE_OBVESTIL.poVrsti } };
  if (!shranjeno || typeof shranjeno !== "object" || Array.isArray(shranjeno)) return n;
  for (const [k, v] of Object.entries(shranjeno as Record<string, unknown>)) {
    const z = zdruziNastavitveObvestil(n, { [k]: v });
    if (z) n = z;
  }
  return n;
}
