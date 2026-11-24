/**
 * Dostop Line do GitHuba (lastnik 24. 11. 2026, AGENTS.md »Lina gradi APK in deb na GitHubu«: »Uporabnik more v nastavitvah line se
 * sam enostavno prijaviti na githube ali ji dolociti dostop do ključa ... ter ji določiti represetori v katerem bo delala«).
 * Cista logika brez I/O: oblika kljuca in imen, zaprt seznam dovoljenih zahtev (metoda + pot), razclemba odgovorov OAuth device flow,
 * zaznava `workflow_dispatch` v toku in normalizacija izbire repozitorijev/tokov. Streznik: github-dostop.server.ts.
 */

/**
 * Client id Safeer OAuth App (javen, brez skrivnosti). PRAZNO, dokler vodja ne registrira aplikacije: takrat vmesnik poti »Prijava z
 * GitHubom« ne pokaze in streznik jo zavrne.
 */
export const GITHUB_CLIENT_ID = "";
export const API = "https://api.github.com";
export const NASLOV_KODE = "https://github.com/login/device/code";
export const NASLOV_ZETONA = "https://github.com/login/oauth/access_token";
export const NASLOV_POTRDITVE = "https://github.com/login/device";
/** Pravica OAuth: zagon tokov in branje v zasebnih repozitorijih (GitHub nima ozje pravice za workflow_dispatch v zasebnem repozitoriju). */
export const OBSEG_OAUTH = "repo";
export const NAJVEC_REPOZITORIJEV = 300;
export const NA_STRAN = 100;
export const NAJVEC_IZBRANIH = 20;
export const NAJVEC_TOKOV = 30;
export const NAJVEC_YML_ZNAKOV = 200_000;

export const NACINI = ["oauth", "gh", "kljuc"] as const;
export type Nacin = (typeof NACINI)[number];
export const VRSTE = ["apk", "deb", "drugo"] as const;
export type VrstaIzdelka = (typeof VRSTE)[number];

export type JavnoStanjeGithub = {
  nacin: Nacin | null;
  racun: string | null;
  /** Pot »Prijava z GitHubom« je na voljo (client id je vpisan). */
  oauthNaVoljo: boolean;
  /** Na racunalniku je program gh (prijava se preveri sele ob izbiri te poti). */
  ghNaVoljo: boolean;
};

export type DovoljenTok = { repozitorij: string; tok: string; vrsta: VrstaIzdelka };
export type IzbiraRepozitorija = { repozitorij: string; tokovi: Array<{ tok: string; vrsta: VrstaIzdelka }> };
export type TokRepozitorija = { tok: string; ime: string; rocniZagon: boolean };

export function jeNacin(v: unknown): v is Nacin {
  return typeof v === "string" && (NACINI as readonly string[]).includes(v);
}
export function jeVrsta(v: unknown): v is VrstaIzdelka {
  return typeof v === "string" && (VRSTE as readonly string[]).includes(v);
}

/** Kljuc, ki ga vpise uporabnik: fine-grained (github_pat_...) ali klasicen (ghp_...). Drugih oblik ne sprejmemo. */
export function jeOblikaKljuca(k: unknown): k is string {
  return typeof k === "string" && (/^github_pat_[A-Za-z0-9_]{20,250}$/.test(k) || /^ghp_[A-Za-z0-9]{30,250}$/.test(k));
}

/** Zeton, ki ga vrne OAuth device flow (OAuth App: gho_, GitHub App: ghu_). */
export function jeOblikaZetonaOauth(k: unknown): k is string {
  return typeof k === "string" && /^gh[ou]_[A-Za-z0-9]{30,250}$/.test(k);
}

/** Ime racuna GitHub: crke, stevke, vezaj (ne na zacetku), najvec 39 znakov. */
export function jeImeRacuna(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(v);
}

function jeImeRepo(v: string): boolean {
  return /^[A-Za-z0-9_.-]{1,100}$/.test(v) && v !== "." && v !== ".." && !v.startsWith("-") && !v.endsWith(".git");
}

/** Polno ime repozitorija »lastnik/ime«. */
export function jeRepozitorij(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const deli = v.split("/");
  return deli.length === 2 && jeImeRacuna(deli[0]) && jeImeRepo(deli[1]);
}

/** Datoteka toka v .github/workflows (samo ime, brez poti): ne zacne s piko ali vezajem, konci .yml/.yaml. */
export function jeDatotekaToka(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,95}\.ya?ml$/.test(v);
}

/** Pot toka, kot jo vrne API (`.github/workflows/<datoteka>`), v ime datoteke ali null (nezaupan vhod). */
export function datotekaIzPoti(pot: unknown): string | null {
  if (typeof pot !== "string") return null;
  const m = /^\.github\/workflows\/([^/]+)$/.exec(pot);
  return m && jeDatotekaToka(m[1]) ? m[1] : null;
}

const STEVILO = /^[1-9][0-9]{0,18}$/;
const VEJA = /^[A-Za-z0-9._/-]{1,200}$/;

/** Dovoljeni parametri poizvedbe in njihove vrednosti (vse drugo zavrne). */
const POIZVEDBA: Record<string, RegExp> = {
  per_page: /^(?:[1-9]|[1-9][0-9]|100)$/,
  page: /^[1-9][0-9]{0,2}$/,
  sort: /^(?:updated|pushed|full_name|created)$/,
  affiliation: /^(?:owner|collaborator|organization_member)(?:,(?:owner|collaborator|organization_member)){0,2}$/,
  branch: VEJA,
  status: /^(?:queued|in_progress|completed|success|failure)$/,
  event: /^workflow_dispatch$/,
  ref: VEJA,
};

/**
 * Zaprt seznam zahtev, ki jih sme Lina poslati GitHubu (metoda IN pot): branje uporabnika, repozitorijev, vej, tokov, tekov, opravil,
 * artefaktov in anotacij; edino pisanje je zagon toka (POST .../dispatches). Nikoli skrivnosti, nastavitve, brisanje ali poljubna pot.
 */
const DOVOLJENE: ReadonlyArray<readonly ["GET" | "POST", RegExp]> = [
  ["GET", /^user$/],
  ["GET", /^user\/repos$/],
  ["GET", /^repos\/R$/],
  ["GET", /^repos\/R\/branches$/],
  ["GET", /^repos\/R\/actions\/workflows$/],
  ["GET", /^repos\/R\/actions\/workflows\/F$/],
  ["GET", /^repos\/R\/actions\/workflows\/F\/runs$/],
  ["GET", /^repos\/R\/actions\/runs$/],
  ["GET", /^repos\/R\/actions\/runs\/N$/],
  ["GET", /^repos\/R\/actions\/runs\/N\/jobs$/],
  ["GET", /^repos\/R\/actions\/runs\/N\/artifacts$/],
  ["GET", /^repos\/R\/actions\/jobs\/N$/],
  ["GET", /^repos\/R\/check-runs\/N\/annotations$/],
  ["GET", /^repos\/R\/contents\/\.github\/workflows\/F$/],
  ["POST", /^repos\/R\/actions\/workflows\/F\/dispatches$/],
];

/** Razbije pot (brez vodilne posevnice) na dele R (repozitorij), F (datoteka toka), N (stevilka) in preveri vzorec. */
function ujemaVzorec(vzorec: RegExp, pot: string): boolean {
  const deli = pot.split("/");
  if (deli[0] !== "repos") return vzorec.test(pot);
  if (deli.length < 3 || !jeRepozitorij(`${deli[1]}/${deli[2]}`)) return false;
  const ostanek = deli.slice(3).map((d, i, vsi) => {
    if (STEVILO.test(d)) return "N";
    // Ime datoteke toka samo za .../workflows/<F> (ne kot poljuben del poti).
    if (i > 0 && vsi[i - 1] === "workflows" && jeDatotekaToka(d)) return "F";
    return d;
  });
  return vzorec.test(["repos", "R", ...ostanek].join("/"));
}

/**
 * Ali je zahteva dovoljena. Pot je relativna na api.github.com, brez vodilne posevnice in brez sheme; zavrne `..`, kodirane znake,
 * nadomestke gh (`{owner}`), vodilni vezaj (gh bi ga bral kot zastavico), presledke in nadzorne znake.
 */
export function jeDovoljenaZahteva(metoda: string, pot: string): boolean {
  if (typeof pot !== "string" || pot.length > 500) return false;
  if (!/^[A-Za-z0-9_./?=&,-]+$/.test(pot)) return false;
  const [osnova, poizvedba, ...vec] = pot.split("?");
  if (vec.length || !osnova || osnova.startsWith("-") || osnova.startsWith("/") || osnova.endsWith("/")) return false;
  if (osnova.split("/").some((d) => d === "" || d === "." || d === "..")) return false;
  if (poizvedba !== undefined) {
    if (!poizvedba) return false;
    const videni = new Set<string>();
    for (const par of poizvedba.split("&")) {
      const [k, v, ...ostalo] = par.split("=");
      if (ostalo.length || !k || v === undefined || videni.has(k) || !POIZVEDBA[k]?.test(v)) return false;
      videni.add(k);
    }
  }
  return DOVOLJENE.some(([m, vzorec]) => m === metoda && ujemaVzorec(vzorec, osnova));
}

/** Telo zahteve: samo zagon toka { ref, inputs? } z nizi; drugih teles ne posiljamo. */
export function jeDovoljenoTelo(telo: unknown): telo is { ref: string; inputs?: Record<string, string> } {
  if (!telo || typeof telo !== "object" || Array.isArray(telo)) return false;
  const t = telo as Record<string, unknown>;
  if (Object.keys(t).some((k) => k !== "ref" && k !== "inputs")) return false;
  if (typeof t.ref !== "string" || !VEJA.test(t.ref) || t.ref.startsWith("-")) return false;
  if (t.inputs === undefined) return true;
  if (!t.inputs || typeof t.inputs !== "object" || Array.isArray(t.inputs)) return false;
  const vnosi = Object.entries(t.inputs as Record<string, unknown>);
  return (
    vnosi.length <= 10 &&
    vnosi.every(([k, v]) => /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(k) && typeof v === "string" && v.length <= 200 && !/[\u0000-\u001f\u007f]/.test(v))
  );
}

// --- OAuth device flow (docs.github.com »Authorizing OAuth apps«, device flow; NEPREVERJENO s pravo aplikacijo do registracije).

export type KodaNaprave = { deviceCode: string; userCode: string; naslov: string; poteceSek: number; intervalSek: number };

export function razberiKodoNaprave(json: unknown): KodaNaprave | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  const dc = j.device_code;
  const uc = j.user_code;
  if (typeof dc !== "string" || !/^[A-Za-z0-9]{20,100}$/.test(dc)) return null;
  if (typeof uc !== "string" || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(uc)) return null;
  // Naslov za uporabnika je vedno nas stalen naslov (odgovor ne odloca, kam vmesnik poslje uporabnika).
  if (j.verification_uri !== NASLOV_POTRDITVE) return null;
  const potece = typeof j.expires_in === "number" && j.expires_in >= 60 && j.expires_in <= 1800 ? Math.floor(j.expires_in) : 900;
  const interval = typeof j.interval === "number" && j.interval >= 1 && j.interval <= 60 ? Math.ceil(j.interval) : 5;
  return { deviceCode: dc, userCode: uc, naslov: NASLOV_POTRDITVE, poteceSek: potece, intervalSek: interval };
}

export type IzidZetona =
  | { vrsta: "zeton"; zeton: string }
  | { vrsta: "cakaj" }
  | { vrsta: "pocasneje"; intervalSek: number }
  | { vrsta: "poteklo" }
  | { vrsta: "zavrnjeno" }
  | { vrsta: "napaka" };

/** Odgovor na poizvedbo zetona. GitHub vraca napake poteka v polju `error` (stanje HTTP se ne uporablja za odlocitev). */
export function razberiZeton(json: unknown, trenutniIntervalSek: number): IzidZetona {
  if (!json || typeof json !== "object") return { vrsta: "napaka" };
  const j = json as Record<string, unknown>;
  switch (j.error) {
    case undefined:
      return jeOblikaZetonaOauth(j.access_token) ? { vrsta: "zeton", zeton: j.access_token } : { vrsta: "napaka" };
    case "authorization_pending":
      return { vrsta: "cakaj" };
    case "slow_down": {
      const dan = typeof j.interval === "number" && j.interval > 0 && j.interval <= 120 ? Math.ceil(j.interval) : 0;
      return { vrsta: "pocasneje", intervalSek: Math.max(dan, trenutniIntervalSek + 5) };
    }
    case "expired_token":
      return { vrsta: "poteklo" };
    case "access_denied":
      return { vrsta: "zavrnjeno" };
    default:
      return { vrsta: "napaka" };
  }
}

// --- workflow_dispatch

function brezKomentarja(vrstica: string): string {
  // shortcut: # znotraj narekovajev se obravnava kot komentar; v kljucu `on:` tokov ni narekovajev z #, ce bi bili, je izid »ne«.
  const i = vrstica.search(/(^|\s)#/);
  return (i < 0 ? vrstica : vrstica.slice(0, i)).replace(/\s+$/, "");
}

const KLJUC_ON = /^(?:on|"on"|'on')\s*:(.*)$/;
const IME = /^["']?workflow_dispatch["']?$/;

/**
 * Ali tok dovoli rocni zagon: `workflow_dispatch` je NEPOSREDEN otrok kljuca `on:` na vrhnji ravni (skalar, seznam [..], slovar {..}
 * ali blok). Omemba drugje (pogoj `if:`, vhod, komentar) ne velja. Nejasno = ne.
 */
export function imaRocniZagon(yml: unknown): boolean {
  if (typeof yml !== "string" || yml.length > NAJVEC_YML_ZNAKOV) return false;
  const vrstice = yml.replace(/\r\n?/g, "\n").split("\n");
  const i = vrstice.findIndex((v) => KLJUC_ON.test(brezKomentarja(v)));
  if (i < 0) return false;
  const vrednost = KLJUC_ON.exec(brezKomentarja(vrstice[i]))![1].trim();
  if (vrednost) {
    const notranje = /^\[(.*)\]$/.exec(vrednost)?.[1] ?? /^\{(.*)\}$/.exec(vrednost)?.[1];
    const elementi = notranje !== undefined ? notranje.split(",").map((e) => e.split(":")[0].trim()) : [vrednost];
    return elementi.some((e) => IME.test(e));
  }
  let zamik = -1;
  for (const surova of vrstice.slice(i + 1)) {
    const v = brezKomentarja(surova);
    if (!v.trim()) continue;
    const z = v.length - v.trimStart().length;
    if (z === 0) break; // naslednji kljuc vrhnje ravni
    if (zamik < 0) zamik = z;
    if (z !== zamik) continue; // globlje (npr. vhodi) ne steje
    const vsebina = v.trim().replace(/^-\s+/, "");
    if (IME.test(vsebina.replace(/\s*:.*$/, ""))) return true;
  }
  return false;
}

/** Vsebina datoteke iz odgovora contents API (base64) ali null. */
export function vsebinaDatoteke(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  if (j.encoding !== "base64" || typeof j.content !== "string" || j.content.length > NAJVEC_YML_ZNAKOV * 2) return null;
  try {
    return Buffer.from(j.content.replace(/\s+/g, ""), "base64").toString("utf8");
  } catch {
    return null;
  }
}

// --- Izbira repozitorijev in tokov

/** Normalizira izbiro (nezaupan vhod iz vmesnika ali diska): samo veljavna imena, brez podvojitev, z mejami. */
export function normalizirajIzbiro(v: unknown): IzbiraRepozitorija[] {
  if (!Array.isArray(v)) return [];
  const izid: IzbiraRepozitorija[] = [];
  const repoji = new Set<string>();
  for (const r of v) {
    if (izid.length >= NAJVEC_IZBRANIH) break;
    if (!r || typeof r !== "object") continue;
    const repozitorij = (r as { repozitorij?: unknown }).repozitorij;
    const tokovi = (r as { tokovi?: unknown }).tokovi;
    if (!jeRepozitorij(repozitorij) || repoji.has(repozitorij.toLowerCase()) || !Array.isArray(tokovi)) continue;
    const videni = new Set<string>();
    const cisti: IzbiraRepozitorija["tokovi"] = [];
    for (const t of tokovi) {
      if (cisti.length >= NAJVEC_TOKOV) break;
      const tok = (t as { tok?: unknown })?.tok;
      const vrsta = (t as { vrsta?: unknown })?.vrsta;
      if (!jeDatotekaToka(tok) || !jeVrsta(vrsta) || videni.has(tok)) continue;
      videni.add(tok);
      cisti.push({ tok, vrsta });
    }
    if (!cisti.length) continue;
    repoji.add(repozitorij.toLowerCase());
    izid.push({ repozitorij, tokovi: cisti });
  }
  return izid;
}

export function sploscenaIzbira(izbira: readonly IzbiraRepozitorija[]): DovoljenTok[] {
  return izbira.flatMap((r) => r.tokovi.map((t) => ({ repozitorij: r.repozitorij, tok: t.tok, vrsta: t.vrsta })));
}
