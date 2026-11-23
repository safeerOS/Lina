/**
 * Dnevna motivacija (lastnik 21. 11. 2026: "Lina naj vsak dan generira novo motivacijo, majhni koraki delajo velike razlike";
 * predlog iz priloge: jutro in vecer, teme, osebno povezano z delom, nastavitve, "raje ena iskrena kot deset nepomembnih").
 * Cista pravila brez diska in omrezja: kljuc dneva, del dneva, tema dneva, vnaprej pripravljene misli, navodilo modelu in
 * ciscenje odgovora.
 * - Najvec DVE sporocili na dan (jutro, vecer), nikoli obvestil; vecer samo po 17. uri po uri naprave.
 * - Zahteva modelu privzeto NE nosi osebnih podatkov (dan v tednu, tema, ton, nekaj prejsnjih misli). Zapiske o lastniku
 *   dobi samo, ce je lastnik izbral slog "osebno" ali "oboje".
 * - Razpolozenja lastnika Lina NE ugiba (domneva o cloveku, ne dejstvo).
 * - Odgovor modela je NEZAUPEN: oblika, dolzina, povezave, skrivnosti, znamke kode, obljube in nasveti so zavrnjeni;
 *   ob zavrnitvi velja vnaprej pripravljena misel (vsak dan druga).
 * Komentarji so brez sumnikov.
 */
import { jeSkrivnost } from "./spomin.ts";

export const MOTIVACIJA_SLOGAN = "Majhni koraki delajo velike razlike";
export const MOTIVACIJA_NAJVEC_ZNAKOV = 280;
export const MOTIVACIJA_NAJMANJ_ZNAKOV = 20;
/** Do 30 dni, dve sporocili na dan. */
export const MOTIVACIJA_ZGODOVINA = 60;
export const URA_VECERA = 17;
export const NAJVEC_ZNAKOV_ZAPISKOV = 600;

export const TEME = ["majhni koraki", "vztrajnost", "produktivnost", "mir in ravnovesje", "ustvarjalnost", "pogum", "hvaležnost"] as const;
export type Tema = (typeof TEME)[number];
export type TemaVnosa = Tema | "zaključek";
export const OPISI_TEM: Record<Tema, string> = {
  "majhni koraki": "majhni koraki delajo velike razlike",
  vztrajnost: "ne odnehaj pri prvih ovirah",
  produktivnost: "majhen korak naprej je več kot popoln načrt",
  "mir in ravnovesje": "tudi počitek je del uspeha",
  ustvarjalnost: "dobre ideje se začnejo z vprašanjem",
  pogum: "ne boj se začeti nečesa novega",
  hvaležnost: "opazi tudi majhne dobre stvari",
};

export type Del = "jutro" | "vecer";
export type MotivacijaVir = "model" | "vnaprej";
export type Motivacija = { dan: string; del: Del; tema: TemaVnosa; besedilo: string; vir: MotivacijaVir; ustvarjeno: string };

export const SLOGI = ["citat", "osebno", "oboje"] as const;
export const HUMORJI = ["brez", "malo", "vec"] as const;
export type Slog = (typeof SLOGI)[number];
export type Humor = (typeof HUMORJI)[number];
export type Nastavitve = { vklopljena: boolean; vecer: boolean; slog: Slog; humor: Humor };
export const PRIVZETE_NASTAVITVE: Nastavitve = { vklopljena: true, vecer: true, slog: "citat", humor: "malo" };

/** Veljaven del popravka nastavitev ali null (neznan kljuc je napaka, neveljavna vrednost je napaka, prazen popravek je napaka). */
export function zdruziNastavitve(trenutne: Nastavitve, popravek: unknown): Nastavitve | null {
  if (!popravek || typeof popravek !== "object" || Array.isArray(popravek)) return null;
  const p = popravek as Record<string, unknown>;
  const kljuci = Object.keys(p);
  if (kljuci.length === 0) return null;
  const naslednje = { ...trenutne };
  for (const k of kljuci) {
    const v = p[k];
    if (k === "vklopljena" && typeof v === "boolean") naslednje.vklopljena = v;
    else if (k === "vecer" && typeof v === "boolean") naslednje.vecer = v;
    else if (k === "slog" && (SLOGI as readonly unknown[]).includes(v)) naslednje.slog = v as Slog;
    else if (k === "humor" && (HUMORJI as readonly unknown[]).includes(v)) naslednje.humor = v as Humor;
    else return null;
  }
  return naslednje;
}

const KLJUC_DNEVA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Pravi koledarski dan oblike LLLL-MM-DD (ne 2026-02-30). */
export function jeKljucDneva(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = KLJUC_DNEVA.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function deliCasa(zdaj: Date, pas?: string): { dan: string; ura: number } {
  try {
    const oblika = new Intl.DateTimeFormat("en-CA", { timeZone: pas, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
    const kos = Object.fromEntries(oblika.formatToParts(zdaj).map((p) => [p.type, p.value]));
    const dan = `${kos.year}-${kos.month}-${kos.day}`;
    const ura = Number(kos.hour);
    if (jeKljucDneva(dan) && Number.isInteger(ura) && ura >= 0 && ura <= 23) return { dan, ura };
  } catch {
    /* neveljaven pas: nazaj na UTC */
  }
  return { dan: zdaj.toISOString().slice(0, 10), ura: zdaj.getUTCHours() };
}

/** Koledarski dan v danem casovnem pasu (privzeto pas naprave). Neveljaven pas: dan po UTC. */
export function kljucDneva(zdaj: Date, pas?: string): string {
  return deliCasa(zdaj, pas).dan;
}

/** Vecer se zacne ob 17. uri po uri v danem pasu. */
export function delDneva(zdaj: Date, pas?: string): Del {
  return deliCasa(zdaj, pas).ura >= URA_VECERA ? "vecer" : "jutro";
}

/** Stevilo dni od 1. 1. 1970 za veljaven kljuc dneva. */
export function dnevnaStevilka(dan: string): number {
  if (!jeKljucDneva(dan)) throw new Error("Neveljaven dan.");
  const m = KLJUC_DNEVA.exec(dan)!;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

const DNEVI = ["nedelja", "ponedeljek", "torek", "sreda", "četrtek", "petek", "sobota"] as const;
export function imeDneva(dan: string): string {
  return DNEVI[(dnevnaStevilka(dan) + 4) % 7];
}

/** Tema jutranje misli: sedem tem se vrti, vsak dan druga. Vecer ima fiksen "zaključek". */
export function temaDneva(dan: string, del: Del = "jutro"): TemaVnosa {
  if (del === "vecer") return "zaključek";
  return TEME[dnevnaStevilka(dan) % TEME.length];
}

/** Osebna misel: slog "osebno" vedno, "oboje" na lihe dni zjutraj in na sode zvecer (dnevno ena in ena). */
export function jeOsebnaMisel(slog: Slog, dan: string, del: Del): boolean {
  if (slog === "citat") return false;
  if (slog === "osebno") return true;
  const lih = dnevnaStevilka(dan) % 2 === 1;
  return del === "jutro" ? lih : !lih;
}

/** Vnaprej pripravljene jutranje misli (izvirna besedila, tema: majhni koraki). Uporabijo se, ko modela ni ali odgovor ni varen. */
export const VNAPREJ: readonly string[] = [
  "Danes ni treba narediti vsega. Dovolj je en majhen korak, ki ga res narediš.",
  "Majhen korak danes je večji od velikega načrta, ki ostane v glavi.",
  "Velike spremembe so sestavljene iz majhnih dni. Današnji je lahko tak.",
  "Ne primerjaj svojega začetka z nečijo sredino. Naredi svoj naslednji korak.",
  "Pet minut dela danes pomeni več kot popolna ura, ki je nikoli ne začneš.",
  "Vsak dan, ko narediš le malo, si korak dlje od dneva, ko nisi naredil nič.",
  "Začni z najlažjim delom. Zagon pride, ko se že premikaš.",
  "Kaplja za kapljo izdolbe skalo. Danes bodi ena kaplja.",
  "Ni ti treba biti popoln. Dovolj je, da si danes malo boljši kot včeraj.",
  "Eno opravljeno opravilo ti da več moči kot deset načrtovanih.",
  "Razdeli veliko nalogo na majhne dele in danes naredi prvega.",
  "Majhne navade se seštevajo. Danes dodaj eno k svojemu skladu.",
  "Če te je strah velikega cilja, pomanjšaj današnji korak, dokler ni lahek.",
  "Danes izberi eno stvar, ki jo boš dokončal. Samo ena je dovolj.",
  "Utrujenost ne prepreči majhnega koraka. Naredi ga počasi, a ga naredi.",
  "Vztrajnost ni hitrost. Je to, da se vrneš tudi po počasnem dnevu.",
  "Ko ne veš, kaj naj narediš, naredi nekaj majhnega in koristnega.",
  "Na pravi trenutek ti ni treba čakati. Za začetek je lahko dovolj že ta.",
  "Vsak korak, ki ga narediš, je dokaz, da zmoreš naslednjega.",
  "Zmaga dneva je lahko tako majhna, da jo opaziš samo ti. Tudi ta šteje.",
  "Danes naredi nekaj za svoje prihodnje jaz, četudi le v petih minutah.",
  "Težko je veliko naenkrat, lahko pa je malo vsak dan.",
  "Namesto da čakaš na motivacijo, naredi majhen korak. Motivacija pogosto pride za njim.",
  "Ena stran, en klic, ena vaja, en odstavek. Majhno delo, ki se kopiči.",
  "Mala dobra odločitev danes olajša jutrišnji dan.",
  "Ne podcenjuj majhnih korakov. Tudi najdaljša pot se začne z enim.",
  "Prosi za pomoč, ko jo potrebuješ. Tudi to je majhen korak naprej.",
  "Pospravi eno stvar, odgovori na eno sporočilo, naredi en korak. Stvari se premikajo.",
  "Danes bodi prijazen do sebe in naredi vsaj eno majhno stvar, ki te približa cilju.",
  "Majhne zmage gradijo zaupanje vase. Naberi si jih danes nekaj.",
  "Če danes ne gre vse po načrtu, rešiš dan z enim dobrim korakom.",
  "Vsaka velika stvar je nekoč bila prvi majhen korak. Naredi ga danes.",
  "Dosleden majhen trud premaga občasen velik zagon.",
  "Poglej, koliko si že naredil, in dodaj še en korak.",
  "Svoj dan lahko obrneš z enim samim majhnim dejanjem.",
  "Ne rabiš cele poti. Danes potrebuješ le naslednji korak.",
  "Počasi je še vedno naprej. Nadaljuj.",
  "Vsak dan ima prostor za eno majhno izboljšavo. Danes jo poišči.",
  "Najboljši čas za majhen korak je zdaj, še preden začneš razmišljati o velikem.",
  "Ko se naloge zdijo prevelike, jih skrči na prvi gib in ga naredi.",
];

/** Vnaprej pripravljene vecerne misli: pozitiven zakljucek dneva (izvirna besedila). */
export const VNAPREJ_VECER: readonly string[] = [
  "Dan je za tabo. Vsak korak, ki si ga naredil, je štel.",
  "Tudi če nisi dosegel vsega, si se danes premaknil naprej. To je dovolj za dober večer.",
  "Zaključi dan z mislijo na eno stvar, ki ti je uspela. Majhna je lahko.",
  "Počitek je del napredka. Zaslužiš si miren večer.",
  "Jutri je nova priložnost za majhen korak. Danes si naredil svoje.",
  "Ne štej, česa nisi naredil. Poglej, kaj si začel.",
  "Večer je čas, da si priznaš: danes sem se trudil.",
  "Majhni koraki se seštevajo tudi, ko jih ne opaziš. Danes si dodal enega.",
  "Odloži skrbi do jutri. Danes si dal, kar si zmogel.",
  "Dober dan ni popoln dan. Je dan, ko si šel naprej, četudi počasi.",
  "Zahvali se sebi za današnji trud. Tudi to je majhen korak.",
  "Utrujenost po dnevu je znak, da si se trudil. Spočij se.",
  "Vsak večer je priložnost, da pogledaš nazaj in rečeš: to mi je uspelo.",
  "Jutrišnji dan bo lažji, če si danes naredil vsaj en korak. Ti si ga.",
  "Pusti dan za sabo z mirno mislijo: naredil sem, kar sem zmogel.",
  "Napredek ni vedno velik. Večer te lahko spomni, da si še vedno na poti.",
  "Naj bo današnji večer počitek, jutrišnje jutro pa nov začetek.",
  "Tudi tihi dnevi štejejo. Danes si vztrajal, in to je dovolj.",
  "Opazi eno dobro stvar, ki se je zgodila danes. Z njo zaključi dan.",
  "Majhen korak več kot včeraj. To je bila tvoja današnja zmaga.",
];

/** Primerjalna oblika za »ni ponovitve«: male crke, brez locil in dvojnih presledkov. */
export function primerjalno(besedilo: string): string {
  return besedilo
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Deterministicna izbira za dan: zaporedni dnevi imajo razlicno misel, misel iz zgodovine se preskoci. */
export function izberiVnaprej(dan: string, zgodovina: readonly string[] = [], del: Del = "jutro"): string {
  const zaloga = del === "vecer" ? VNAPREJ_VECER : VNAPREJ;
  const n = zaloga.length;
  const zacetek = ((dnevnaStevilka(dan) % n) + n) % n;
  const uporabljene = new Set(zgodovina.map(primerjalno));
  for (let i = 0; i < n; i++) {
    const kandidat = zaloga[(zacetek + i) % n];
    if (!uporabljene.has(primerjalno(kandidat))) return kandidat;
  }
  return zaloga[zacetek];
}

export type Navodilo = { system: string; text: string };
export type VhodNavodila = { dan: string; del: Del; humor: Humor; zapiski?: string };

const TON: Record<Humor, string> = {
  brez: "Brez humorja, resno in toplo.",
  malo: "Dovoljen je droben, prijazen nasmešek v tonu.",
  vec: "Bodi igriva in zabavna, a nikoli posmehljiva.",
};

/** Zapiski za navdih: besedilo brez skrivnosti, skrajsano; sicer prazen niz. */
export function ocistiZapiske(zapiski: unknown): string {
  if (typeof zapiski !== "string") return "";
  const b = zapiski.replace(/\s+/g, " ").trim().slice(0, NAJVEC_ZNAKOV_ZAPISKOV);
  return b && !jeSkrivnost(b) ? b : "";
}

/** Navodilo modelu. Brez osebnih podatkov, razen ociscenih zapiskov, ki jih je lastnik izrecno dovolil (slog osebno/oboje). */
export function sestaviNavodilo(vhod: VhodNavodila, zgodovina: readonly string[] = []): Navodilo {
  const tema = temaDneva(vhod.dan, vhod.del);
  const prejsnje = zgodovina.slice(0, 5).map((b) => `- ${b.slice(0, 160)}`);
  const zapiski = ocistiZapiske(vhod.zapiski);
  const jutro = tema === "zaključek" ? "" : `Tema današnjega dne: ${OPISI_TEM[tema]}.`;
  const del =
    vhod.del === "vecer"
      ? "Napiši ENO kratko večerno misel: pozitiven zaključek dneva, brez poročila o opravljenem delu."
      : "Napiši ENO kratko jutranjo motivacijsko misel za začetek dneva.";
  const sistem = [
    `Si Lina, prijazna asistentka. ${del} Piši v slovenščini.`,
    jutro,
    `Središčni slogan Line je »${MOTIVACIJA_SLOGAN}«: misel naj bo z njim v skladu, a ga ne ponavljaj dobesedno.`,
    TON[vhod.humor],
    "Pravila: 1 do 2 stavka, največ 240 znakov; konkretno; brez ukazovanja, brez obljub rezultata, brez zdravstvenih ali finančnih nasvetov;",
    "brez imen, povezav, številk, emojijev, narekovajev in oblikovanja. Odgovori samo z mislijo, brez uvoda.",
    zapiski ? "Zapiski o uporabniku so samo za navdih: misel lahko prijazno poveže z njegovim delom, a ne navajaj občutljivih podrobnosti in ne trdi ničesar, česar zapiski ne vsebujejo." : "",
  ]
    .filter(Boolean)
    .join(" ");
  const besedilo = [
    `Dan v tednu: ${imeDneva(vhod.dan)}.`,
    zapiski ? `Zapiski o uporabniku: ${zapiski}` : "",
    prejsnje.length ? `Teh misli ne ponovi:\n${prejsnje.join("\n")}` : "Napiši novo misel.",
  ]
    .filter(Boolean)
    .join("\n");
  return { system: sistem, text: besedilo };
}

const EMOJI = /[\p{Extended_Pictographic}‍️]/gu;
const PREPOVEDANO = /(garantir|zagotovljen|diagnoz|zdravljenj|zdravil|naložb|nalozb|investir|delnic|kripto|\d{4,}|https?:|www\.|:\/\/|@|[<>{}[\]`|\\])/i;
const UVOD = /^(seveda|tukaj je|evo|here|sure|okej|v redu)\b/i;

/**
 * Ocisti NEZAUPEN odgovor modela v eno varno misel ali vrne null.
 * Dovoljeno: 1 odstavek navadnega besedila, 20 do 280 znakov, brez povezav, kode, skrivnosti, obljub in ponovitve.
 */
export function ocistiOdgovorModela(surovo: unknown, zgodovina: readonly string[] = []): string | null {
  if (typeof surovo !== "string") return null;
  let b = surovo.replace(EMOJI, "").replace(/\s+/g, " ").trim();
  b = b.replace(/^[-*>#\s]+/, "").replace(/\*\*|__/g, "");
  b = b.replace(/^[„“”"'«»]+|[„“”"'«»]+$/g, "").trim();
  if (b.length > MOTIVACIJA_NAJVEC_ZNAKOV) {
    const rez = b.slice(0, MOTIVACIJA_NAJVEC_ZNAKOV);
    const konec = Math.max(rez.lastIndexOf(". "), rez.lastIndexOf("! "), rez.lastIndexOf("? "));
    const celo = /[.!?]$/.test(rez) ? rez.length : konec + 1;
    if (celo < MOTIVACIJA_NAJMANJ_ZNAKOV) return null;
    b = rez.slice(0, celo).trim();
  }
  if (b.length < MOTIVACIJA_NAJMANJ_ZNAKOV) return null;
  if (UVOD.test(b) || PREPOVEDANO.test(b) || jeSkrivnost(b)) return null;
  const p = primerjalno(b);
  if (zgodovina.some((z) => primerjalno(z) === p)) return null;
  return b;
}
