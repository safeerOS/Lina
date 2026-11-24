/**
 * Lina gradi APK in deb na GitHubu (lastnik 24. 11. 2026; AGENTS.md »Lina gradi APK in deb na GitHubu«). Cista logika brez diska,
 * omrezja in procesov. Nacelo: repozitorij in tokovi so STALNI (zaprt seznam v kodi), veja samo s seznama, ki ga vrne GitHub, in
 * prave oblike; model, klicatelj ali splet ne more dati ne repozitorija ne toka ne argumenta. Vsak zagon potrdi lastnik.
 */
import { createHash } from "node:crypto";

export const REPOZITORIJ = "safeerOS/Lina";
/** SHA-256 certifikata stalnega kljuca Line (CN=Safeer Lina), prebrano z apksigner iz zgrajenega APK 22. 11. 2026. */
export const PODPIS_LINE = "166efb0a3c4afd12b036010eac681581d6821256ffb21565109074e52e8247bd";

export type VrstaGradnje = "apk" | "deb";
/**
 * artefakt: ime artefakta s paketom (upload-artifact v .github/workflows); prenese se SAMO ta (gh run download -n), ne porocila
 * preizkusov in drugi artefakti (pregled 0225 A-4: gradnja.yml nalozi tudi globoka Gradle porocila »testna-porocila«).
 */
export const TOKOVI = {
  "gradnja.yml": { vrsta: "apk", paket: "si.safeer.lina", podpis: PODPIS_LINE, privzetoMs: 12 * 60_000, artefakt: "lina-apk-debug" },
  "racunalnik.yml": { vrsta: "deb", paket: "lina-lupina", podpis: null, privzetoMs: 10 * 60_000, artefakt: "lina-deb" },
} as const satisfies Record<string, { vrsta: VrstaGradnje; paket: string; podpis: string | null; privzetoMs: number; artefakt: string }>;
export type Tok = keyof typeof TOKOVI;

export function jeTok(x: unknown): x is Tok {
  return typeof x === "string" && Object.hasOwn(TOKOVI, x);
}

export const NAJVEC_VEJ = 500;
export const NAJVEC_ZAPISOV = 30;
export const NAJVEC_CAKAJOCIH = 3;
/** Linini predlogi (izvor »lina«) imajo svojo mejo, loceno od lastnika in telefona (B-7). */
export const NAJVEC_CAKAJOCIH_LINE = 1;
export const NAJVEC_ANOTACIJ = 50;
/** Nepotrjen predlog ugasne (kot naloge za Claude Code). */
export const CAKA_MS = 15 * 60_000;
/** Tek, ki do tega casa ni koncan, se ne spremlja vec (zaklep toka se sprosti). */
export const ROK_TEKA_MS = 3 * 60 * 60_000;
/** Po zagonu mora GitHub v tem casu pokazati nov tek, sicer napaka. */
export const ROK_ISKANJA_TEKA_MS = 10 * 60_000;

export const STANJA = ["caka", "odklonjeno", "poteklo", "zaganja", "tece", "prenasa", "koncano", "neuspesno", "napaka"] as const;
export type StanjeGradnje = (typeof STANJA)[number];
export const AKTIVNA: readonly StanjeGradnje[] = ["zaganja", "tece", "prenasa"];

export const RAZLOGI = [
  "ukaz", "tok", "veja", "veje", "ni-najdeno", "zgostitev", "poteklo", "polno-cakajoce", "tok-zaseden", "izklopljeno", "geslo",
  "ni-gh", "zagon", "ni-teka", "rok", "prenos", "artefakt", "ni-paketa", "podpis", "ni-namestitve", "odpri",
  // pregled 0225: veja se je premaknila (A-3, A-13), veja ni dovoljena za namestitev (A-3), artefakt prevelik (A-4)
  "commit", "veja-namestitev", "prevelik",
] as const;
export type RazlogGradnje = (typeof RAZLOGI)[number];

export class GradnjaNapaka extends Error {
  readonly razlog: RazlogGradnje;
  constructor(razlog: RazlogGradnje) {
    super(razlog);
    this.razlog = razlog;
  }
}

/**
 * Ime veje: zacne s crko ali stevko (nikoli »-«, ki bi gh razumel kot zastavico), samo [A-Za-z0-9._/-], najvec 100 znakov,
 * brez »..«, »//«, »/.«, koncne »/« ali ».« in ».lock« (pravila git check-ref-format, ozje).
 */
const VEJA = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
export function oblikaVeje(v: unknown): v is string {
  return typeof v === "string" && VEJA.test(v) && !v.includes("..") && !v.includes("//") && !v.includes("/.") && !/[/.]$/.test(v) && !v.endsWith(".lock");
}

/** Veja mora biti TOCNO ime s seznama vej z GitHuba in prave oblike. */
export function preveriVejo(v: unknown, seznam: readonly string[]): string | null {
  return oblikaVeje(v) && seznam.includes(v) ? v : null;
}

/** Izpis `gh api --paginate .../branches --jq '.[].name'`: ena veja na vrstico; neveljavna imena se zavrzejo. */
export function razberiVeje(izpis: string): string[] {
  return [...new Set(izpis.split("\n").map((v) => v.trim()).filter(oblikaVeje))].slice(0, NAJVEC_VEJ);
}

const dve = (n: number) => String(n).padStart(2, "0");
/** <YYYY-MM-DD HHMM>-<tok brez .yml>-<veja z - namesto />, po LOKALNEM casu racunalnika. */
export function imeMapeGradnje(zdaj: Date, tok: Tok, veja: string): string {
  const d = `${zdaj.getFullYear()}-${dve(zdaj.getMonth() + 1)}-${dve(zdaj.getDate())} ${dve(zdaj.getHours())}${dve(zdaj.getMinutes())}`;
  return `${d}-${tok.replace(/\.yml$/, "")}-${veja.replace(/\//g, "-")}`;
}

/** Prvo ime, ki se ne obstaja: osnova, osnova-2, osnova-3 ... (mapa gradnje se nikoli ne prepise). */
export function prostoIme(osnova: string, obstaja: (ime: string) => boolean): string {
  if (!obstaja(osnova)) return osnova;
  for (let i = 2; i < 1000; i++) if (!obstaja(`${osnova}-${i}`)) return `${osnova}-${i}`;
  throw new GradnjaNapaka("artefakt");
}

/**
 * Kar lastnik vidi in potrdi: tok, veja in commit (SHA vrha veje ob predlogu; pregled 0225 A-3). Zagon in prenos veljata samo za
 * tek prav tega commita; ce se veja medtem premakne, gradnja ne velja (razlog commit).
 */
export function zgostitevGradnje(tok: string, veja: string, commit: string): string {
  return createHash("sha256").update(`${REPOZITORIJ}\u0000${tok}\u0000${veja}\u0000${commit}`, "utf8").digest("hex");
}

/** Polni SHA commita (40 hex, male crke), kot ga vrne GitHub. */
export function oblikaCommita(c: unknown): c is string {
  return typeof c === "string" && /^[0-9a-f]{40}$/.test(c);
}

export type Tek = { status: string; conclusion: string | null; createdAt: string | null; updatedAt: string | null; opravila: number[] };
const BESEDA = /^[a-z_]{1,30}$/;
const CAS = /^[0-9TZ:.+-]{10,40}$/;
/** `gh run view <id> --json status,conclusion,createdAt,updatedAt,jobs`. */
export function razberiTek(izpis: string): Tek | null {
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(izpis) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || typeof v.status !== "string" || !BESEDA.test(v.status)) return null;
  const conclusion = typeof v.conclusion === "string" && BESEDA.test(v.conclusion) ? v.conclusion : null;
  const cas = (x: unknown) => (typeof x === "string" && CAS.test(x) ? x : null);
  const opravila = Array.isArray(v.jobs) ? v.jobs.map((j) => (j as { databaseId?: unknown })?.databaseId).filter((x): x is number => Number.isSafeInteger(x) && (x as number) > 0) : [];
  return { status: v.status, conclusion, createdAt: cas(v.createdAt), updatedAt: cas(v.updatedAt), opravila };
}

export type TekSeznama = { id: number; headSha: string | null; createdAt: string | null };
/**
 * `gh run list --json databaseId,headSha,createdAt`. Neveljaven izpis = null (pregled 0225 A-13: prej je dal prazen seznam in s tem
 * »prejsnji tek 0«, zato bi se lahko vzel star tek).
 */
export function razberiTeke(izpis: string): TekSeznama[] | null {
  let v: unknown;
  try {
    v = JSON.parse(izpis);
  } catch {
    return null;
  }
  if (!Array.isArray(v)) return null;
  return v
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
    .filter((x) => Number.isSafeInteger(x.databaseId) && (x.databaseId as number) > 0)
    .map((x) => ({
      id: x.databaseId as number,
      headSha: oblikaCommita(x.headSha) ? x.headSha : null,
      createdAt: typeof x.createdAt === "string" && CAS.test(x.createdAt) ? x.createdAt : null,
    }));
}

/**
 * `gh api repos/<repo>/actions/runs/<id>/artifacts`: velikost neizteklih artefaktov z imenom `ime` v bajtih; neveljaven izpis ali
 * artefakta ni = null.
 */
export function velikostArtefaktov(izpis: string, ime: string): number | null {
  let v: unknown;
  try {
    v = JSON.parse(izpis);
  } catch {
    return null;
  }
  const a = (v as { artifacts?: unknown })?.artifacts;
  if (!Array.isArray(a)) return null;
  let vsota = 0;
  let najdeno = false;
  for (const x of a as Array<Record<string, unknown>>) {
    if (x?.expired === true || x?.name !== ime) continue;
    najdeno = true;
    if (!Number.isSafeInteger(x?.size_in_bytes) || (x.size_in_bytes as number) < 0) return null;
    vsota += x.size_in_bytes as number;
  }
  return najdeno ? vsota : null;
}

/** apksigner verify --print-certs: odtis, ce je natanko en podpisnik; sicer null (podpis NI preverjen). */
export function razberiPodpis(izpis: string): string | null {
  const odtisi = [...izpis.matchAll(/^Signer #(\d+) certificate SHA-256 digest: ([0-9a-f]+)\s*$/gm)];
  const podpisniki = new Set([...izpis.matchAll(/^Signer #(\d+) /gm)].map((m) => m[1]));
  if (odtisi.length !== 1 || podpisniki.size !== 1 || !/^[0-9a-f]{64}$/.test(odtisi[0]![2]!)) return null;
  return odtisi[0]![2]!;
}

export type Anotacija = { raven: "notice" | "warning" | "failure"; sporocilo: string; pot: string };
/**
 * Kontrolni znaki (razen \t in \n, ki ju \s{2,} zdruzi v presledek), vsi oblikovni (Cf: smerni, nevidni, U+00AD, U+061C, U+180E,
 * U+FFF9-FFFB, znaki oznak U+E0000-E007F), locila vrstic in odstavkov (U+2028/2029) in izbirniki razlicic (pregled 0225 A-9).
 */
const NEVIDNI = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Cf}\p{Zl}\p{Zp}\u{E0000}-\u{E007F}\u{FE00}-\u{FE0F}]/gu;
function cisto(v: unknown, meja: number): string {
  // rezanje po kodnih tockah: osamljen nadomestek na koncu ne nastane
  return typeof v === "string" ? Array.from(v.replace(NEVIDNI, "").replace(/\s{2,}/g, " ").trim()).slice(0, meja).join("") : "";
}

/**
 * Del poti v artefaktu gradnje (pregled 0225 A-2): samo ASCII crke, stevke in . _ + -, ne na zacetku pike, najvec 100 znakov.
 * Ime datoteke je izpis GitHuba (nezaupano): brez nove vrstice, oznak [[...]], smernih ali nevidnih znakov.
 */
const DEL_POTI = /^[A-Za-z0-9_+-][A-Za-z0-9._+-]{0,99}$/;
export function varenDelPoti(ime: string): boolean {
  return DEL_POTI.test(ime);
}
export function varnaPotArtefakta(pot: string): boolean {
  const deli = pot.split("/");
  return deli.length >= 1 && deli.length <= 6 && deli.every(varenDelPoti);
}
/** `gh api repos/<repo>/check-runs/<opravilo>/annotations`: besedilo je NEZAUPANO in gre samo v kartico kot besedilo. */
export function razberiAnotacije(izpis: string): Anotacija[] {
  let v: unknown;
  try {
    v = JSON.parse(izpis);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const izid: Anotacija[] = [];
  for (const a of v as Array<Record<string, unknown>>) {
    const raven = a?.annotation_level;
    if (raven !== "notice" && raven !== "warning" && raven !== "failure") continue;
    izid.push({ raven, sporocilo: cisto(a.message, 500), pot: cisto(a.path, 200) });
    if (izid.length >= NAJVEC_ANOTACIJ) break;
  }
  return izid;
}

/** Ocena konca: zacetek + mediana trajanj prejsnjih uspesnih gradenj istega toka (ali privzeto). */
export function oceniKonec(zacetek: number, trajanja: readonly number[], vrsta: VrstaGradnje): number {
  const t = trajanja.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  const privzeto = vrsta === "apk" ? TOKOVI["gradnja.yml"].privzetoMs : TOKOVI["racunalnik.yml"].privzetoMs;
  return zacetek + (t.length ? t[Math.floor((t.length - 1) / 2)]! : privzeto);
}

/**
 * Oznaka, s katero Lina PREDLAGA gradnjo: [[gradnja: gradnja.yml | main]]. Nicesar ne zazene; tok in vejo preveri streznik
 * (zaprt seznam, seznam vej z GitHuba), zagon potrdi lastnik.
 */
// Presledki in velike crke dovoljeni (pregled 0225 B1): oznaka iz priponke se tako vedno odstrani.
const OZNAKA = /\[\[\s*gradnja\s*:\s*([^|\]\n]{1,40})\|([^\]\n]{1,120})\]\]/gi;
export function izluciPredlogeGradnje(odgovor: string): { besedilo: string; predlogi: Array<{ tok: string; veja: string }> } {
  const predlogi: Array<{ tok: string; veja: string }> = [];
  const besedilo = odgovor
    .replace(OZNAKA, (_m, tok: string, veja: string) => {
      if (predlogi.length < 1) predlogi.push({ tok: tok.trim(), veja: veja.trim() });
      return "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { besedilo, predlogi };
}

export const NAVODILO_OZNAKE_GRADNJE =
  " Ko lastnik zeli novo gradnjo Line na GitHubu (APK za telefon ali deb za racunalnik), dodaj na konec odgovora oznako " +
  "[[gradnja: gradnja.yml | <veja>]] za APK ali [[gradnja: racunalnik.yml | <veja>]] za deb. Oznaka nicesar ne zazene: lastnik " +
  "gradnjo potrdi v zavihku Racunalnik ali na telefonu. Ne trdi, da gradnja tece, dokler je lastnik ne potrdi.";

export type PaketGradnje = { pot: string; sha256: string; velikost: number };
export type PodpisGradnje = "ujema" | "ne-ujema" | "ni-preverjen";

/** Sporocilo Line ob koncu gradnje: sestavi ga koda (izid, ura, POLNA pot, sha256, stevilo opozoril), nikoli model ali GitHub. */
export function sporociloIzida(g: {
  tok: Tok;
  veja: string;
  zakljucek: string | null;
  konec: string | null;
  mapa: string | null;
  paket: PaketGradnje | null;
  podpis: PodpisGradnje | null;
  anotacije: readonly Anotacija[];
}): string {
  const vrsta = TOKOVI[g.tok].vrsta === "apk" ? "APK za telefon" : "deb za racunalnik";
  const ura = g.konec ? new Date(g.konec).toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit" }) : "";
  if (g.zakljucek !== "success" || !g.mapa || !g.paket) {
    return `Gradnja ${vrsta} (veja ${g.veja}) ni uspela${ura ? ` (${ura})` : ""}: ${g.zakljucek ?? "napaka"}. Opozoril: ${g.anotacije.length}. Podrobnosti so v zavihku Računalnik.`;
  }
  const podpis =
    g.podpis === "ujema" ? " Podpis je enak nameščeni Lini." : g.podpis === "ne-ujema" ? " POZOR: podpis NI enak nameščeni Lini; namestitve ne ponudim." : g.podpis === "ni-preverjen" ? " Podpis NI preverjen (ni apksigner); namestitve ne ponudim." : "";
  return (
    // pot paketa je preverjena ob prenosu (varnaPotArtefakta); tu se enkrat znova, ker gre besedilo v zgodovino pogovora
    `Gradnja ${vrsta} (veja ${g.veja}) je uspela ob ${ura}. Shranjena je v ${g.mapa}/${varnaPotArtefakta(g.paket.pot) ? g.paket.pot : "(neveljavno ime datoteke)"} ` +
    `(sha256 ${g.paket.sha256}). Opozoril: ${g.anotacije.length}.${podpis} Namestitev potrdite z gumbom »Namesti« v zavihku Računalnik.`
  );
}
