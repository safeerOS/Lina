/**
 * Narocila podjetja za kontrolo kakovosti (lastnik 23. 11. 2026): ob slikanju majice Lina ve, kateri stranki pripada in kaksen je motiv.
 * Sistema narocil podjetja ne poznamo, zato splosno: iz izvoza (CSV/XLSX) ali delovnih nalogov (PDF, besedilo, izvozena e-posta) nastane
 * LOKALNI seznam (stevilka naloga, stranka, motiv, kolicina, rok). Slika se z narocilom poveze prek kode na nalogu (QR/crtna koda ali
 * stevilka, prebrana z OCR - bralnik poda klicatelj) ali po podobnosti motiva. Stranke NIKOLI ne ugibamo: ni zadetka ali vec zadetkov =
 * »ni mogoce dolociti«. Vsebina datotek je PODATEK, ne navodilo. Cisti del brez streznika (uvoz iz mape je v narocila.server.ts).
 */
import type { Slika } from "./kakovost.ts";

export type Narocilo = { stevilka: string; stranka: string; motiv: string; kolicina: number | null; rok: string; vir: string };
type Polje = "stevilka" | "stranka" | "motiv" | "kolicina" | "rok";

/** Sopomenke glav stolpcev in oznak na nalogu (normirane: male crke, brez sumnikov in locil). */
const SOPOMENKE: Record<Polje, readonly string[]> = {
  stevilka: ["st naloga", "stevilka naloga", "delovni nalog", "nalog", "st narocila", "stevilka narocila", "narocilo", "order", "order no",
    "order number", "job", "job no", "work order"],
  stranka: ["stranka", "narocnik", "kupec", "customer", "client"],
  motiv: ["motiv", "datoteka motiva", "opis motiva", "design", "artwork", "grafika"],
  kolicina: ["kolicina", "kos", "kosov", "st kosov", "qty", "quantity"],
  rok: ["rok", "rok izdelave", "rok dobave", "datum dobave", "dobava", "due", "due date", "deadline"],
};
const POLJA = Object.keys(SOPOMENKE) as Polje[];
const NAJVEC_ZNAKOV_POLJA = 300;

const normiraj = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const polje = (oznaka: string): Polje | null => {
  const n = normiraj(oznaka);
  return POLJA.find((p) => SOPOMENKE[p].includes(n)) ?? null;
};
const celica = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, NAJVEC_ZNAKOV_POLJA);
function kolicina(s: string): number | null {
  const m = s.replace(/(?<=\d)[.\s](?=\d{3}\b)/g, "").match(/\d+/);
  return m ? Number(m[0]) : null;
}
function sestavi(v: Partial<Record<Polje, string>>, vir: string): Narocilo | null {
  const stevilka = celica(v.stevilka);
  const stranka = celica(v.stranka);
  const motiv = celica(v.motiv);
  if (!stevilka || kljucNaloga(stevilka).length === 0 || (!stranka && !motiv)) return null;
  return { stevilka, stranka, motiv, kolicina: kolicina(celica(v.kolicina)), rok: celica(v.rok), vir };
}

/** Natancen kljuc: velike crke, brez locil in presledkov, BREZ zamenjav OCR - loci razlicna narocila (N6: DN-1O5 in DN-105). */
export function kljucTocen(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Kljuc za primerjavo: velike crke, brez locil in presledkov; tipicne zamenjave OCR (O->0, I/L->1) na obeh straneh enako. */
export function kljucNaloga(s: string): string {
  return kljucTocen(s).replace(/O/g, "0").replace(/[IL]/g, "1");
}

/** Narocila s to stevilko: najprej natancno ujemanje, zamenjave OCR samo, ce natancnega ni (N6). */
export function narocilaZaStevilko<T extends Narocilo>(stevilka: string, narocila: readonly T[]): T[] {
  const t = kljucTocen(stevilka);
  const tocni = narocila.filter((n) => kljucTocen(n.stevilka) === t);
  if (tocni.length) return tocni;
  const k = kljucNaloga(stevilka);
  return narocila.filter((n) => kljucNaloga(n.stevilka) === k);
}

/** Vrstice tabele (CSV/XLSX) v narocila. Glava je med prvimi 10 vrsticami; brez prepoznane glave ne ugibamo stolpcev. */
export function narocilaIzTabele(vrstice: string[][], vir: string): { narocila: Narocilo[]; glava: Record<Polje, number> | null; neprepoznano: string[] } {
  for (let i = 0; i < Math.min(vrstice.length, 10); i++) {
    const glava = {} as Record<Polje, number>;
    vrstice[i].forEach((c, j) => {
      const p = polje(c);
      if (p && glava[p] === undefined) glava[p] = j;
    });
    if (glava.stevilka === undefined || (glava.stranka === undefined && glava.motiv === undefined)) continue;
    const narocila: Narocilo[] = [];
    for (const v of vrstice.slice(i + 1)) {
      const n = sestavi(Object.fromEntries(POLJA.map((p) => [p, glava[p] === undefined ? "" : v[glava[p]]])), vir);
      if (n) narocila.push(n);
    }
    return { narocila, glava, neprepoznano: [] };
  }
  return { narocila: [], glava: null, neprepoznano: (vrstice[0] ?? []).map(celica) };
}

/** Delovni nalog kot besedilo (PDF, TXT, izvozena e-posta): vrstice »Oznaka: vrednost«; prva pojavitev polja velja. */
export function narociloIzBesedila(besedilo: string, vir: string): Narocilo | null {
  const v: Partial<Record<Polje, string>> = {};
  for (const vrstica of besedilo.split(/\r?\n/).slice(0, 500)) {
    const m = vrstica.match(/^\s*([^:]{1,40}):\s*(.+)$/);
    const p = m && polje(m[1]);
    if (p && v[p] === undefined) v[p] = m[2];
  }
  return sestavi(v, vir);
}

export type Povezava =
  | { izid: "najden"; nacin: "koda" | "motiv"; narocilo: Narocilo }
  | { izid: "vec"; kandidati: Narocilo[] }
  | { izid: "ni" };

/**
 * Stevilka naloga v prebranem besedilu (vsebina kode QR/crtne kode ali OCR). Zadetek = kljuc naloga je enak zaporedju 1-4 sosednjih
 * besed (»DN 2026 / 0153«), nikoli del daljse stevilke. Kratke stevilke (pod 3 znaki) samo, ce je to celotno prebrano besedilo.
 */
export function najdiNalogVBesedilu(prebrano: string, narocila: readonly Narocilo[]): Povezava {
  const besede = prebrano.slice(0, 4000).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const okna = [prebrano];
  for (let i = 0; i < besede.length; i++) {
    for (let d = 1; d <= 4 && i + d <= besede.length; d++) okna.push(besede.slice(i, i + d).join(""));
  }
  // N6: najprej natancni kljuci; zamenjave OCR samo, ce natancnega zadetka ni. Vsako narocilo je svoj kandidat (dve narocili z
  // istim kljucem OCR = »vec«, nikoli tiho prvo).
  const najdi = (kljuc: (s: string) => string) => {
    const kljuci = new Set(okna.map(kljuc));
    const celota = kljuc(prebrano);
    return narocila.filter((n) => {
      const k = kljuc(n.stevilka);
      return k && kljuci.has(k) && (k.length >= 3 || k === celota);
    });
  };
  const tocni = najdi(kljucTocen);
  const zadetki = tocni.length ? tocni : najdi(kljucNaloga);
  if (zadetki.length === 1) return { izid: "najden", nacin: "koda", narocilo: zadetki[0] };
  return zadetki.length ? { izid: "vec", kandidati: zadetki } : { izid: "ni" };
}

/** Odtis motiva (dHash 9x8 na sivinski sliki, 64 bitov kot 16 sestnajstiskih znakov); neveljavna slika = null. */
export function odtisMotiva(slika: Slika): string | null {
  const { sirina: s, visina: v, podatki: p } = slika;
  if (s < 9 || v < 8 || p.length !== s * v) return null;
  const povp = (x0: number, x1: number, y0: number, y1: number) => {
    let vsota = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { vsota += p[y * s + x]; n++; }
    return vsota / n;
  };
  let bit = 0n;
  for (let r = 0; r < 8; r++) {
    const y0 = Math.floor((r * v) / 8), y1 = Math.max(y0 + 1, Math.floor(((r + 1) * v) / 8));
    const vrsta = Array.from({ length: 9 }, (_, c) => {
      const x0 = Math.floor((c * s) / 9);
      return povp(x0, Math.max(x0 + 1, Math.floor(((c + 1) * s) / 9)), y0, y1);
    });
    for (let c = 0; c < 8; c++) bit = (bit << 1n) | (vrsta[c] > vrsta[c + 1] ? 1n : 0n);
  }
  return bit.toString(16).padStart(16, "0");
}

export function razdaljaOdtisov(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), n = 0;
  for (; x; x >>= 1n) n += Number(x & 1n);
  return n;
}

/** Podobnost motiva: zadetek samo, ce je najblizji pod pragom IN jasno blizji od drugega (sicer »vec« ali »ni«). */
export function izberiPoMotivu(odtis: string, kandidati: ReadonlyArray<{ narocilo: Narocilo; odtis: string }>, prag = 10, razlika = 4): Povezava {
  if (!/^[0-9a-f]{16}$/.test(odtis)) return { izid: "ni" };
  const r = kandidati.filter((k) => /^[0-9a-f]{16}$/.test(k.odtis)).map((k) => ({ ...k, d: razdaljaOdtisov(odtis, k.odtis) })).sort((a, b) => a.d - b.d);
  if (!r.length || r[0].d > prag) return { izid: "ni" };
  const blizu = r.filter((k) => k.d < r[0].d + razlika && k.d <= prag);
  return blizu.length === 1 ? { izid: "najden", nacin: "motiv", narocilo: r[0].narocilo } : { izid: "vec", kandidati: blizu.map((k) => k.narocilo) };
}

/** Povezava slike z narocilom: najprej koda; ce koda ni enolicna, odloci motiv med kandidati; brez kode motiv med vsemi. */
export function poveziSliko(vhod: { prebrano?: string; odtis?: string | null }, narocila: readonly Narocilo[], odtisi: Readonly<Record<string, string>>): Povezava {
  // R8 (24. 11. 2026): odtis, shranjen pod starim kljucem (kljucNaloga), velja samo, ce tocnega ni in stari kljuc ni tocni kljuc
  // drugega narocila ter ga ima med VSEMI narocili eno samo
  const odtisZa = (n: Narocilo): string | undefined => {
    const tocen = odtisi[kljucTocen(n.stevilka)];
    if (tocen) return tocen;
    const star = kljucNaloga(n.stevilka);
    const tekmeci = narocila.filter((m) => kljucNaloga(m.stevilka) === star || kljucTocen(m.stevilka) === star);
    return tekmeci.length === 1 ? odtisi[star] : undefined;
  };
  const zOdtisi = (ns: readonly Narocilo[]) => ns.flatMap((n) => { const odtis = odtisZa(n); return odtis ? [{ narocilo: n, odtis }] : []; });
  const koda = vhod.prebrano?.trim() ? najdiNalogVBesedilu(vhod.prebrano, narocila) : ({ izid: "ni" } as Povezava);
  if (koda.izid === "najden" || !vhod.odtis) return koda;
  const motiv = izberiPoMotivu(vhod.odtis, zOdtisi(koda.izid === "vec" ? koda.kandidati : narocila));
  return motiv.izid === "najden" || koda.izid === "ni" ? motiv : koda;
}
