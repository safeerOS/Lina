/**
 * Ucna enota postopka: razbiranje korakov, merjenje meje znanja (dvojisko), preverba po koraku in ponavljanje. Cista logika, brez
 * omrezja in brez datotek.
 *
 * Zamisli iz LearnHarness (github.com/amosblomqvist/learnharness, commit 069a6a1, Amos Blomqvist, AGPL-3.0-only):
 * dvojisko iskanje meje in »nepreizkusena meja ni ugotovitev« (prober/10-probe-doctrine.md »Bracket the learner's edge«),
 * »nikoli ne gradi na nepreverjenem koraku« (teacher/20-teaching.md) in »weakest first« (practice/10-doctrine.md, vrstica 68).
 * Koda je nova (spremenil Safeer, team@safeer.si, 25. 11. 2026): LearnHarness meri tla in strop z modelom in orodjem probe_done;
 * tu je meja indeks v urejeni verigi korakov. Ponavljanje (skatle 1/3/7/14/30 dni) je lastna koda Safeer - jedro LearnHarness
 * ponavljanja med sejami nima. Licenca: AGPL-3.0 (LICENSE v tej mapi), ker je del modula, prirejenega po LearnHarness.
 */

export type Korak = { besedilo: string; razlaga: string; vprasanje: string; bistvo: string[] };
export type NapredekKoraka = { skatla: number; naslednjic: string | null; poskusov: number; preverjen: boolean };
export type Enota = { id: string; naslov: string; koraki: Korak[]; napredek: NapredekKoraka[]; ustvarjeno: string };
export type Seja = {
  enotaId: string;
  faza: "merjenje" | "pouk" | "ponavljanje";
  /** Merjenje: meja je v [lo, hi]; lo = prvi korak, za katerega ni dokaza. */
  lo: number;
  hi: number;
  /** Pouk: trenutni korak. Ponavljanje: vrsta korakov (najsibkejsi najprej). */
  korak: number;
  vrsta: number[];
  zadnjic: string;
};
export type StanjeLH = { vklopljen: boolean; enote: Enota[]; seja: Seja | null };

export const NAJVEC_ENOT = 50;
export const NAJMANJ_KORAKOV = 2;
export const NAJVEC_KORAKOV = 20;
export const NAJVEC_ZNAKOV_KORAKA = 400;
export const NAJVEC_ZNAKOV_NASLOVA = 120;
export const NAJVEC_ZNAKOV_ODSEKA = 1500;
/** Ura brez odziva 2 h se konca sama (ne obtici). */
export const ROK_SEJE_MS = 2 * 60 * 60_000;
/** Ponavljanje: dni do naslednje preverbe po skatli 1..5. */
export const INTERVALI_DNI = [1, 3, 7, 14, 30] as const;

/** Nezaupano ali shranjeno besedilo v varno obliko: brez krmilnih in nevidnih znakov, brez oznak [[ ]], omejena dolzina. */
/** Kot cisto, a v eni vrstici (besedilo modela ne sme ponarediti vrstice pogovora, npr. »\nLastnik: ...«). */
export function enaVrstica(s: unknown, najvec: number): string {
  return cisto(typeof s === "string" ? s.replace(/\s*[\r\n]+\s*/g, " ") : s, najvec);
}

export function cisto(s: unknown, najvec: number): string {
  if (typeof s !== "string") return "";
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u2069\ufeff]/g, " ")
    .replace(/\[\[|\]\]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, najvec);
}

const KORAK = /^\s*(?:(\d{1,2})\s*[.)]|[-*•])\s+(.+?)\s*$/;

/** Koraki iz lastnikovega navodila: ostevilcene vrstice (1. / 1)) ali alineje. Naslov = besedilo pred prvim korakom. */
export function razberiKorake(besedilo: string): { naslov: string; koraki: string[] } {
  const vrstice = besedilo.split(/\r?\n/);
  const koraki: string[] = [];
  const pred: string[] = [];
  for (const v of vrstice) {
    const m = KORAK.exec(v);
    if (m) koraki.push(cisto(m[2], NAJVEC_ZNAKOV_KORAKA));
    else if (koraki.length === 0 && v.trim()) pred.push(v.trim());
  }
  const naslov = cisto(
    pred
      .join(" ")
      .replace(/^(lina[,:]?\s*)?/i, "")
      .replace(/^(nau[cč]i se|zapomni si|shrani|learn|remember)\s+(ta\s+|tale\s+|this\s+|the\s+)?(postopka?|postopek|navodila?|korake|procedure|steps|instructions)\s*(za|for|of)?\s*/i, "")
      .replace(/[:.]+\s*$/, ""),
    NAJVEC_ZNAKOV_NASLOVA,
  );
  return { naslov, koraki: koraki.filter(Boolean).slice(0, NAJVEC_KORAKOV) };
}

/** Odloca koda iz LASTNIKOVEGA besedila (nikoli oznaka modela): nauci se postopka + vsaj 2 koraka. */
export function jeNameraSestave(besedilo: string): boolean {
  const namera = /\b(nau[cč]i se|zapomni si|shrani)\b[^\n]{0,60}?(postop|navodil|korak)/i.test(besedilo) ||
    /\b(learn|remember)\b[^\n]{0,40}?\b(procedure|steps|instructions)/i.test(besedilo);
  return namera && razberiKorake(besedilo).koraki.length >= NAJMANJ_KORAKOV;
}

export function jeNameraUre(besedilo: string): boolean {
  return /(^|[^\p{L}])(nau[cč]i me|preveri me|preveri moje znanje|ponoviva|ponovi z mano|vadiva|teach me|quiz me|test me)([^\p{L}]|$)/iu.test(besedilo);
}

export function jeKonec(besedilo: string): boolean {
  // samo celo sporocilo (odgovor »Konec motiva ...« je odgovor, ne izhod)
  return /^\s*(konec|stop|prekini|nehaj|dovolj|konec ure|end|quit)\s*[.!]?\s*$/i.test(besedilo);
}

/** Koreni besed (prvih 5 crk besed z vsaj 4 crkami), za ujemanje naslova in vprasanja. */
export function koreni(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/\p{L}{4,}/gu) ?? []).map((w) => w.slice(0, 5)));
}

function presek(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

/** Enota, na katero se besedilo nanasa (najvec skupnih korenov z naslovom; ob izenacenju najnovejsa). */
export function najdiEnoto(enote: readonly Enota[], besedilo: string): Enota | null {
  const k = koreni(besedilo);
  let naj: Enota | null = null;
  let tocke = 0;
  for (const e of enote) {
    const n = koreni(e.naslov);
    const t = presek(n, k);
    // vsaj dva korena naslova (ali vsi, ce jih je manj): »nauci me kako natisniti majice« ne sprozi ure »kontrola tiska na majice«
    if (t >= Math.min(2, n.size) && t > 0 && t >= tocke) {
      naj = e;
      tocke = t;
    }
  }
  return naj;
}

/** Enota je za pogovor relevantna, ce sporocilo vsebuje vsaj dva korena naslova (ali edinega). */
export function jeRelevantna(e: Enota, besedilo: string): boolean {
  const n = koreni(e.naslov);
  return n.size > 0 && presek(n, koreni(besedilo)) >= Math.min(2, n.size);
}

/** Prvi objekt JSON v odgovoru modela (model lahko doda besedilo ali ```). */
export function razberiJson(odgovor: string): unknown {
  const i = odgovor.indexOf("{");
  const j = odgovor.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try {
    return JSON.parse(odgovor.slice(i, j + 1));
  } catch {
    return null;
  }
}

export function zacetniNapredek(): NapredekKoraka {
  return { skatla: 0, naslednjic: null, poskusov: 0, preverjen: false };
}

/**
 * Enota iz lastnikovega navodila. Koraki so VEDNO lastnikove besede (model jih ne sme zdruziti ali spremeniti); od modela se vzame
 * samo naslov, razlaga, vprasanje in bistvo, in to samo, ce je stevilo korakov enako. Brez modela: vprasanje in bistvo iz koraka.
 */
export function sestaviEnoto(navodilo: string, odgovorModela: string | null, id: string, zdaj: Date): Enota | null {
  const { naslov: naslovBesedila, koraki } = razberiKorake(navodilo);
  if (koraki.length < NAJMANJ_KORAKOV) return null;
  const m = odgovorModela ? (razberiJson(odgovorModela) as { naslov?: unknown; koraki?: unknown } | null) : null;
  const mk = m && Array.isArray(m.koraki) && m.koraki.length === koraki.length ? (m.koraki as Array<Record<string, unknown>>) : null;
  // naslov modela samo ob veljavnem odgovoru (sicer bi napacen odgovor lahko prepisal drugo enoto z istim naslovom)
  const naslov = (mk ? enaVrstica(m?.naslov, NAJVEC_ZNAKOV_NASLOVA) : "") || naslovBesedila || "Postopek";
  return {
    id,
    naslov,
    ustvarjeno: zdaj.toISOString(),
    koraki: koraki.map((besedilo, i) => {
      const x = mk?.[i] ?? {};
      const bistvo = Array.isArray(x.bistvo) ? x.bistvo.map((b) => enaVrstica(b, 40)).filter(Boolean).slice(0, 6) : [];
      return {
        besedilo,
        razlaga: enaVrstica(x.razlaga, NAJVEC_ZNAKOV_KORAKA),
        vprasanje: enaVrstica(x.vprasanje, 300) || `Kaj narediš v ${i + 1}. koraku postopka »${naslov}« in zakaj?`,
        bistvo: bistvo.length ? bistvo : [...koreni(besedilo)].slice(0, 3),
      };
    }),
    napredek: koraki.map(zacetniNapredek),
  };
}

/** Merjenje: korak, pri katerem se vprasa (sredina intervala). */
export function sredina(lo: number, hi: number): number {
  return Math.floor((lo + hi) / 2);
}

/** Po odgovoru pri merjenju: prav -> meja je visje, narobe -> meja je pri tem koraku ali nizje. */
export function poMerjenju(lo: number, hi: number, razume: boolean): { lo: number; hi: number; konec: boolean } {
  const m = sredina(lo, hi);
  const n = razume ? { lo: m + 1, hi } : { lo, hi: m };
  return { ...n, konec: n.lo >= n.hi };
}

/** Rezervna ocena brez modela: vsaj polovica bistva je v odgovoru in odgovor ni »ne vem«. */
export function oceniRezerva(odgovor: string, bistvo: readonly string[]): { razume: boolean; manjka: string } {
  const o = odgovor.toLowerCase();
  if (/ne vem|ne spomnim|pozabil|don'?t know/.test(o) || o.trim().length < 3) return { razume: false, manjka: "" };
  const zadetih = bistvo.filter((b) => o.includes(b.toLowerCase().slice(0, 5))).length;
  const razume = bistvo.length === 0 ? true : zadetih >= Math.ceil(bistvo.length / 2);
  return { razume, manjka: razume ? "" : `Manjka: ${bistvo.join(", ")}.` };
}

export function razberiOceno(odgovorModela: string): { razume: boolean; manjka: string } | null {
  const j = razberiJson(odgovorModela) as { razume?: unknown; manjka?: unknown } | null;
  if (!j || typeof j.razume !== "boolean") return null;
  return { razume: j.razume, manjka: enaVrstica(j.manjka, 300) };
}

/** Ponavljanje po skatlah: prav -> visja skatla in daljsi razmik; narobe -> skatla 0, ponovi cez 1 dan. */
export function poPreverbi(n: NapredekKoraka, razume: boolean, zdaj: Date): NapredekKoraka {
  const dan = 24 * 60 * 60_000;
  if (!razume) return { skatla: 0, naslednjic: new Date(zdaj.getTime() + dan).toISOString(), poskusov: n.poskusov + 1, preverjen: n.preverjen };
  const skatla = Math.min(n.skatla + 1, INTERVALI_DNI.length);
  return { skatla, naslednjic: new Date(zdaj.getTime() + INTERVALI_DNI[skatla - 1]! * dan).toISOString(), poskusov: n.poskusov + 1, preverjen: true };
}

/** Koraki za ponavljanje: nepreverjeni ali zapadli; najsibkejsi (najnizja skatla) najprej, nato po vrsti postopka. */
export function zapadliKoraki(e: Enota, zdaj: Date): number[] {
  return e.napredek
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => !n.preverjen || n.skatla === 0 || (n.naslednjic !== null && Date.parse(n.naslednjic) <= zdaj.getTime()))
    .sort((a, b) => a.n.skatla - b.n.skatla || a.i - b.i)
    .map(({ i }) => i);
}

export function znanih(e: Enota): number {
  return e.napredek.filter((n) => n.preverjen && n.skatla > 0).length;
}

/** Najzgodnejsa naslednja ponovitev (za sporocilo ob koncu ure). */
export function naslednjaPonovitev(e: Enota): string | null {
  const t = e.napredek.map((n) => n.naslednjic).filter((x): x is string => Boolean(x)).sort();
  return t[0] ?? null;
}

/** Besedilo koraka za pouk: korak, razlaga, preverba. */
export function predstaviKorak(e: Enota, i: number): string {
  const k = e.koraki[i]!;
  return `Korak ${i + 1}/${e.koraki.length}: ${k.besedilo}${k.razlaga ? ` ${k.razlaga}` : ""}\nPreverba: ${k.vprasanje}`;
}

/** Enota kot podatek za sistemsko navodilo (omejena dolzina). */
export function besediloEnote(e: Enota): string {
  return `«${e.naslov}»:\n${e.koraki.map((k, i) => `${i + 1}. ${k.besedilo}`).join("\n")}`.slice(0, NAJVEC_ZNAKOV_ODSEKA);
}
