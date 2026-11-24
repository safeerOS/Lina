/**
 * Uporaba dodatka n8n (lastnik 19. 11. in 24. 11. 2026): cista logika brez diska, omrezja in procesov.
 * Nacelo: n8n tece samo na 127.0.0.1, tokovi se ustvarijo neaktivni, ustvarjanje in zagon potekata SAMO po izrecni
 * potrditvi lastnika (vezani na zgostitev predloga). Podprti sta slovenscina in anglescina (SL/EN).
 */
import { createHash } from "node:crypto";
import type { Jezik } from "./besedila.ts";

export const N8N_PRIVZETI_NASLOV = "http://127.0.0.1:5678";
export const N8N_IME_VSEBNIKA = "lina-dodatek-n8n";
export const CAKA_N8N_MS = 15 * 60_000;
export const NAJVEC_PREDLOGOV_N8N = 30;
export const NAJVEC_CAKAJOCIH_N8N = 5;
export const NAJVEC_CAKAJOCIH_LINE_N8N = 3;
export const NAJVEC_TOKOV_N8N = 100;

export type VrstaPredlogaN8n = "ustvari" | "zazeni";
export type IzvorN8n = "lastnik" | "lina" | "telefon" | "kanal";
export type StanjePredlogaN8n = "caka" | "odklonjeno" | "poteklo" | "koncano" | "napaka";

export const RAZLOGI_N8N = [
  "izklopljeno",
  "ni-povezave",
  "ni-kljuca",
  "ze-nastavljen",
  "geslo",
  "oblika",
  "ni-najdeno",
  "zgostitev",
  "poteklo",
  "polno-cakajoce",
  "zagon",
  "ustvari",
  "ukaz",
  "neveljaven-naslov",
] as const;
export type RazlogN8n = (typeof RAZLOGI_N8N)[number];

export class N8nNapaka extends Error {
  readonly razlog: RazlogN8n;
  constructor(razlog: RazlogN8n, sporocilo?: string) {
    super(sporocilo ?? razlog);
    this.razlog = razlog;
  }
}

export type TokN8n = {
  id: string;
  ime: string;
  aktiven: boolean;
  posodobljen: string | null;
  webhookPot?: string | null;
};

export type JsonVrednost = string | number | boolean | null | JsonVrednost[] | { [k: string]: JsonVrednost };

export type VozlisceN8n = {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, JsonVrednost>;
};

export type DefinicijaTokaN8n = {
  name: string;
  nodes: VozlisceN8n[];
  connections: Record<string, { main: Array<Array<{ node: string; type: "main"; index: number }>> }>;
  settings: { executionOrder: "v1"; timezone: string };
};

export type PredlogN8n = {
  id: string;
  vrsta: VrstaPredlogaN8n;
  izvor: IzvorN8n;
  stanje: StanjePredlogaN8n;
  zgostitev: string;
  ustvarjeno: string;
  potrjeno: string | null;
  zakljuceno: string | null;
  tokId: string | null;
  imeToka: string;
  opis: string;
  definicija: DefinicijaTokaN8n | null;
  povzetek: string;
  rezultat: string | null;
  izvedbaId: string | null;
  razlog: RazlogN8n | null;
};

/** Kontrolni, smerni in nevidni znaki (kot gradnje-github.ts): lastnik mora potrditi tocno tisto, kar vidi. */
const NEVIDNI = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Cf}\p{Zl}\p{Zp}\u{E0000}-\u{E007F}\u{FE00}-\u{FE0F}]/gu;
const NEVIDNI_TEST = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Cf}\p{Zl}\p{Zp}\u{E0000}-\u{E007F}\u{FE00}-\u{FE0F}]/u;

export function imaNevidneN8n(s: string): boolean {
  return NEVIDNI_TEST.test(s);
}

export function ocistiBesediloN8n(v: unknown, meja = 300): string {
  if (typeof v !== "string") return "";
  return Array.from(v.replace(NEVIDNI, "").replace(/\s+/g, " ").trim()).slice(0, meja).join("");
}

/** Dovoli izkljucno http://127.0.0.1:<vrata> brez poti, poizvedbe, sidra in poverilnic (SSRF varovalo). */
export function jeLokalniN8nNaslov(naslov: unknown): string | null {
  if (typeof naslov !== "string") return null;
  const s = naslov.trim();
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" || u.hostname !== "127.0.0.1") return null;
  if (u.username || u.password || u.search || u.hash) return null;
  if (u.pathname !== "/" && u.pathname !== "") return null;
  const vrata = Number(u.port);
  if (!Number.isInteger(vrata) || vrata < 1 || vrata > 65535) return null;
  return `http://127.0.0.1:${vrata}`;
}

/** ID toka v n8n: samo varni znaki, nikoli zastavica (ne zacne z »-«) ali locilo poti. */
const ID_TOKA = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export function veljavenIdTokaN8n(id: unknown): id is string {
  return typeof id === "string" && ID_TOKA.test(id);
}

/** Varna pot webhooka (brez .. ali polne povezave). */
const POT_WEBHOOKA = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;
export function varnaPotWebhooka(pot: unknown): string | null {
  if (typeof pot !== "string") return null;
  const c = pot.trim().replace(/^\/+/, "");
  if (!c || !POT_WEBHOOKA.test(c) || c.includes("..") || c.includes("//")) return null;
  return c;
}

/** Zgostitev predloga, ki jo lastnik potrdi (veze vrsto, tokId, ime, opis in celotno definicijo toka). */
export function zgostitevPredlogaN8n(v: {
  vrsta: VrstaPredlogaN8n;
  tokId?: string | null;
  imeToka: string;
  opis: string;
  definicija?: DefinicijaTokaN8n | null;
}): string {
  return createHash("sha256")
    .update(JSON.stringify([v.vrsta, v.tokId ?? null, v.imeToka, v.opis, v.definicija ?? null]), "utf8")
    .digest("hex");
}

// ------------------------------------------------------------------ Razclenitev urnika in sestava toka iz opisa (SL/EN)

export type UrnikN8n = {
  vrsta: "dnevno" | "tedensko" | "urno" | "minutno";
  ura?: number;
  minuta?: number;
  /** 0 = nedelja .. 6 = sobota (n8n scheduleTrigger triggerAtDay). */
  dan?: number;
  interval: number;
  opisSl: string;
  opisEn: string;
};

const DNEVI_SL: Array<[RegExp, number, string, string]> = [
  [/\b(?:nedelj[oaei]|ned)\b/i, 0, "vsako nedeljo", "every Sunday"],
  [/\b(?:ponedelj(?:ek|ka|kom|ku)|pon)\b/i, 1, "vsak ponedeljek", "every Monday"],
  [/\b(?:tor(?:ek|ka|kom|ku)|tor)\b/i, 2, "vsak torek", "every Tuesday"],
  [/\b(?:sred[oaei]|sre)\b/i, 3, "vsako sredo", "every Wednesday"],
  [/\b(?:[cč]etrt(?:ek|ka|kom|ku)|[cč]et)\b/i, 4, "vsak četrtek", "every Thursday"],
  [/\b(?:pet(?:ek|ka|kom|ku)|pet)\b/i, 5, "vsak petek", "every Friday"],
  [/\b(?:sobot[oaei]|sob)\b/i, 6, "vsako soboto", "every Saturday"],
];

const DNEVI_EN: Array<[RegExp, number, string, string]> = [
  [/\bsundays?\b/i, 0, "vsako nedeljo", "every Sunday"],
  [/\bmondays?\b/i, 1, "vsak ponedeljek", "every Monday"],
  [/\btuesdays?\b/i, 2, "vsak torek", "every Tuesday"],
  [/\bwednesdays?\b/i, 3, "vsako sredo", "every Wednesday"],
  [/\bthursdays?\b/i, 4, "vsak četrtek", "every Thursday"],
  [/\bfridays?\b/i, 5, "vsak petek", "every Friday"],
  [/\bsaturdays?\b/i, 6, "vsako soboto", "every Saturday"],
];

const dve = (n: number) => String(n).padStart(2, "0");

function razberiUro(s: string): { ura: number; minuta: number } | null {
  // ob 7:00, ob 07.30, ob 7h, ob 7, at 7:00, at 7:30 pm, at 8 am
  const m = /\b(?:ob|at)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|h|uri|urah)?\b/i.exec(s);
  if (!m) return null;
  let ura = Number(m[1]);
  const minuta = m[2] ? Number(m[2]) : 0;
  const ozn = (m[3] ?? "").toLowerCase();
  if (ozn === "pm" && ura >= 1 && ura <= 11) ura += 12;
  if (ozn === "am" && ura === 12) ura = 0;
  if (!Number.isInteger(ura) || ura < 0 || ura > 23 || !Number.isInteger(minuta) || minuta < 0 || minuta > 59) return null;
  return { ura, minuta };
}

export function razberiUrnikIzOpisa(opis: string): UrnikN8n | null {
  const s = ocistiBesediloN8n(opis, 500);
  if (!s) return null;

  const minM = /\b(?:vsakih|na|every)\s+(\d{1,2})\s*(?:minut\w*|mins?|minutes?)\b/i.exec(s);
  if (minM) {
    const n = Math.max(1, Math.min(59, Number(minM[1])));
    return { vrsta: "minutno", interval: n, opisSl: `vsakih ${n} min`, opisEn: `every ${n} min` };
  }

  const uraM = /\b(?:vsako\s+uro|every\s+hour|hourly|(?:vsak(?:e|ih)|na|every)\s+(\d{1,2})\s*(?:ur\w*|hours?|hrs?))\b/i.exec(s);
  if (uraM) {
    const n = uraM[1] ? Math.max(1, Math.min(24, Number(uraM[1]))) : 1;
    return {
      vrsta: "urno",
      interval: n,
      opisSl: n === 1 ? "vsako uro" : `vsakih ${n} ur`,
      opisEn: n === 1 ? "every hour" : `every ${n} hours`,
    };
  }

  const cas = razberiUro(s);

  for (const [rx, dan, slDan, enDan] of [...DNEVI_SL, ...DNEVI_EN]) {
    if (rx.test(s)) {
      const ura = cas?.ura ?? 8;
      const minuta = cas?.minuta ?? 0;
      const uStr = `${dve(ura)}:${dve(minuta)}`;
      return { vrsta: "tedensko", dan, ura, minuta, interval: 1, opisSl: `${slDan} ob ${uStr}`, opisEn: `${enDan} at ${uStr}` };
    }
  }

  if (/\b(?:tedensko|vsak\s+teden|weekly|every\s+week)\b/i.test(s)) {
    const ura = cas?.ura ?? 8;
    const minuta = cas?.minuta ?? 0;
    const uStr = `${dve(ura)}:${dve(minuta)}`;
    return { vrsta: "tedensko", dan: 1, ura, minuta, interval: 1, opisSl: `tedensko ob ${uStr}`, opisEn: `weekly at ${uStr}` };
  }

  if (/\b(?:vsak\s+dan|vsako\s+jutro|dnevno|every\s+day|every\s+morning|daily)\b/i.test(s) || cas !== null) {
    const ura = cas?.ura ?? 8;
    const minuta = cas?.minuta ?? 0;
    const uStr = `${dve(ura)}:${dve(minuta)}`;
    return { vrsta: "dnevno", ura, minuta, interval: 1, opisSl: `vsak dan ob ${uStr}`, opisEn: `every day at ${uStr}` };
  }

  return null;
}

/** Dovoli samo javni https:// URL za varno branje (brez localhost, zasebnih IP, poverilnic). */
function varenJavniHttpsUrl(opis: string): string | null {
  const m = /\bhttps:\/\/[^\s<>)"']{4,250}/i.exec(opis);
  if (!m) return null;
  const surov = m[0].replace(/[.,;:!?]+$/, "");
  let u: URL;
  try {
    u = new URL(surov);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  if (
    h === "localhost" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h.startsWith("[") ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  ) {
    return null;
  }
  return u.toString();
}

function kategorijaIzOpisa(opis: string): string {
  if (/\b(?:novic\w*|news|rss|pregled\s+novic|povzetek\s+novic)\b/i.test(opis)) return "novice";
  if (/\b(?:po[sš]t\w*|e-?po[sš]t\w*|email|mail)\b/i.test(opis)) return "eposta";
  if (/\b(?:opomni\w*|remind\w*|koledar|calendar)\b/i.test(opis)) return "opomnik";
  if (/\b(?:poro[cč]il\w*|report|povzet\w*|summary)\b/i.test(opis)) return "povzetek";
  return "naloga";
}

function imeIzOpisa(opis: string, izrecnoIme?: string): string {
  const r = ocistiBesediloN8n(izrecnoIme ?? "", 80);
  if (r.length >= 2) return r;
  const c = ocistiBesediloN8n(opis, 80);
  if (!c) return "Lina tok";
  const z = c.charAt(0).toUpperCase() + c.slice(1);
  return Array.from(z).slice(0, 64).join("");
}

/**
 * Sestavi veljaven, varen n8n tok iz opisa lastnika (brez lupinskih ukazov, kode ali zasebnih naslovov).
 * Tok se v n8n ustvari neaktiven; izvede se sele po potrditvi lastnika.
 */
export function sestaviTokIzOpisa(
  opis: string,
  ime?: string,
  jezik: Jezik = "sl",
): { definicija: DefinicijaTokaN8n; povzetek: string; urnikOpis: string | null } {
  const cistOpis = ocistiBesediloN8n(opis, 400);
  const imeToka = imeIzOpisa(cistOpis, ime);
  const urnik = razberiUrnikIzOpisa(cistOpis);
  const url = varenJavniHttpsUrl(cistOpis);
  const kategorija = kategorijaIzOpisa(cistOpis);

  const nodes: VozlisceN8n[] = [];
  const connections: DefinicijaTokaN8n["connections"] = {};

  let sprozilecIme: string;
  if (urnik) {
    sprozilecIme = jezik === "en" ? "Schedule Trigger" : "Urnik";
    const ruleInterval: Record<string, JsonVrednost> =
      urnik.vrsta === "minutno"
        ? { field: "minutes", minutesInterval: urnik.interval }
        : urnik.vrsta === "urno"
          ? { field: "hours", hoursInterval: urnik.interval }
          : urnik.vrsta === "tedensko"
            ? { field: "weeks", weeksInterval: 1, triggerAtDay: [urnik.dan ?? 1], triggerAtHour: urnik.ura ?? 8, triggerAtMinute: urnik.minuta ?? 0 }
            : { field: "days", daysInterval: 1, triggerAtHour: urnik.ura ?? 8, triggerAtMinute: urnik.minuta ?? 0 };
    nodes.push({
      id: "lina-trigger-1",
      name: sprozilecIme,
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [240, 300],
      parameters: { rule: { interval: [ruleInterval] } },
    });
  } else {
    sprozilecIme = jezik === "en" ? "Manual Trigger" : "Ročni zagon";
    nodes.push({
      id: "lina-trigger-1",
      name: sprozilecIme,
      type: "n8n-nodes-base.manualTrigger",
      typeVersion: 1,
      position: [240, 300],
      parameters: {},
    });
  }

  let zadnji = sprozilecIme;
  let x = 500;

  if (url) {
    const httpIme = jezik === "en" ? "Fetch source" : "Preberi vir";
    nodes.push({
      id: "lina-http-1",
      name: httpIme,
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [x, 300],
      parameters: { method: "GET", url, options: { timeout: 10000 } },
    });
    connections[zadnji] = { main: [[{ node: httpIme, type: "main", index: 0 }]] };
    zadnji = httpIme;
    x += 260;
  }

  const nalogaIme = jezik === "en" ? "Prepare task" : "Priprava naloge";
  const urnikOpis = urnik ? (jezik === "en" ? urnik.opisEn : urnik.opisSl) : null;
  nodes.push({
    id: "lina-set-1",
    name: nalogaIme,
    type: "n8n-nodes-base.set",
    typeVersion: 3.4,
    position: [x, 300],
    parameters: {
      assignments: {
        assignments: [
          { id: "a1", name: "naloga", value: cistOpis, type: "string" },
          { id: "a2", name: "kategorija", value: kategorija, type: "string" },
          { id: "a3", name: "urnik", value: urnikOpis ?? (jezik === "en" ? "manual" : "ročni"), type: "string" },
          { id: "a4", name: "ustvarila", value: "Lina", type: "string" },
        ],
      },
      options: {},
    },
  });
  connections[zadnji] = { main: [[{ node: nalogaIme, type: "main", index: 0 }]] };

  // Zagon »zdaj« (n8n execute --id) zahteva rocni sprozilec: tok z urnikom ga dobi poleg urnika (izmerjeno 24. 11. 2026, n8n 2.48.7:
  // »Missing node to start execution« brez manualTrigger).
  if (urnik) {
    const rocniIme = jezik === "en" ? "Manual Trigger" : "Ročni zagon";
    nodes.push({ id: "lina-trigger-2", name: rocniIme, type: "n8n-nodes-base.manualTrigger", typeVersion: 1, position: [240, 480], parameters: {} });
    connections[rocniIme] = { main: [[...(connections[sprozilecIme]?.main[0] ?? [])]] };
  }

  const definicija: DefinicijaTokaN8n = {
    name: imeToka,
    nodes,
    connections,
    settings: { executionOrder: "v1", timezone: "Europe/Ljubljana" },
  };

  const koraki = nodes.map((n) => n.name).join(" → ");
  const povzetek =
    jezik === "en"
      ? `Workflow "${imeToka}" (${urnikOpis ?? "manual trigger"}; steps: ${koraki}; created inactive).`
      : `Tok »${imeToka}« (${urnikOpis ?? "ročni zagon"}; koraki: ${koraki}; ustvarjen neaktiven).`;

  return { definicija, povzetek, urnikOpis };
}

// ------------------------------------------------------------------ Namere in oznake v pogovoru (SL/EN)

export type NameraN8n =
  | { vrsta: "seznam" }
  | { vrsta: "zazeni"; cilj: string }
  | { vrsta: "ustvari"; opis: string; ime?: string }
  | { vrsta: "potrdi"; id?: string }
  | { vrsta: "odkloni"; id?: string };

const ID_PREDLOGA_RX = /^[a-f0-9]{16}$/i;

export function razberiNameroN8n(besedilo: string): NameraN8n | null {
  const s = besedilo.trim();
  if (!s) return null;

  // Potrditev / zavrnitev izrecno z omembo n8n
  const mPotrdi = /^(?:(?:da|yes)[,\s]+)?(?:potrdi|odobri|confirm|approve)\s+n8n(?:\s+(?:tok|predlog|workflow))?(?:\s+([a-f0-9]{16}))?[.!]?$/i.exec(s);
  if (mPotrdi) return mPotrdi[1] ? { vrsta: "potrdi", id: mPotrdi[1].toLowerCase() } : { vrsta: "potrdi" };

  const mOdkloni = /^(?:(?:ne|no)[,\s]+)?(?:zavrni|odkloni|prekli[cč]i|reject|cancel|deny)\s+n8n(?:\s+(?:tok|predlog|workflow))?(?:\s+([a-f0-9]{16}))?[.!]?$/i.exec(s);
  if (mOdkloni) return mOdkloni[1] ? { vrsta: "odkloni", id: mOdkloni[1].toLowerCase() } : { vrsta: "odkloni" };

  // Seznam tokov (SL/EN)
  if (
    /^(?:poka[zž]i|prika[zž]i|izpi[sš]i|seznam|kateri|katere|kaj\s+imam\s+v|show|list|get)\b.*\bn8n\b.*\b(?:tok\w*|potek\w*|workflow\w*)\b/i.test(s) ||
    /^(?:poka[zž]i|prika[zž]i|seznam|show|list)\s+(?:vse\s+|all\s+)?(?:tok\w*|potek\w*|workflow\w*)\s+(?:v|in|from)\s+n8n\b/i.test(s) ||
    /^(?:n8n\s+(?:tokovi|poteki|seznam|workflows|list))$/i.test(s)
  ) {
    return { vrsta: "seznam" };
  }

  // Ustvari tok (SL/EN)
  const mUstvari =
    /^(?:ustvari|naredi|dodaj|pripravi|create|make|build|add)\s+(?:nov\s+|new\s+|preprost\s+|simple\s+)?(?:n8n\s+(?:tok|potek(?:\s+dela)?|workflow)|(?:tok|potek(?:\s+dela)?|workflow)\s+(?:v|in)\s+n8n)\s*[:–—-]?\s*(.+)$/i.exec(
      s,
    );
  if (mUstvari) {
    const o = mUstvari[1]!.trim();
    if (o.length >= 3) return { vrsta: "ustvari", opis: o };
  }

  // Zazeni tok (SL/EN)
  const mZazeni =
    /^(?:za[zž]eni|po[zž]eni|izvedi|spro[zž]i|run|execute|trigger|start)\s+(?:n8n\s+(?:tok|potek(?:\s+dela)?|workflow)|(?:tok|potek(?:\s+dela)?|workflow)\s+(?:v|in)\s+n8n)\s*[:–—-]?\s*(.+)$/i.exec(
      s,
    ) ??
    /^(?:za[zž]eni|po[zž]eni|izvedi|run|execute)\s+(?:tok|potek(?:\s+dela)?|workflow)\s+(.+?)\s+(?:v|in)\s+n8n[.!?]?$/i.exec(s);
  if (mZazeni) {
    const c = mZazeni[1]!.trim().replace(/^["'«»„“]+|["'«»„“]+$/g, "").replace(/[.!?]+$/, "").trim();
    if (c.length >= 1) return { vrsta: "zazeni", cilj: c };
  }

  return null;
}

/** Kratek odgovor lastnika neposredno po Lininem potrditvenem vprasanju za n8n. */
export function jeKratkaPotrditev(besedilo: string): "potrdi" | "odkloni" | null {
  const s = besedilo.trim().toLowerCase().replace(/[.!]+$/, "");
  if (/^(?:da|ja|potrdi|potrjujem|odobri|yes|confirm|ok|seveda)$/.test(s)) return "potrdi";
  if (/^(?:ne|zavrni|odkloni|prekli[cč]i|no|cancel|reject|deny)$/.test(s)) return "odkloni";
  return null;
}

export type OznakaN8n =
  | { vrsta: "seznam" }
  | { vrsta: "zazeni"; cilj: string }
  | { vrsta: "ustvari"; ime?: string; opis: string };

const OZNAKA_N8N_RX = /\[\[\s*n8n-(seznam|zazeni|ustvari)\s*(?::\s*([^\]\n]{1,500}))?\]\]/gi;

export function izluciOznakeN8n(odgovor: string): { besedilo: string; oznake: OznakaN8n[] } {
  const oznake: OznakaN8n[] = [];
  const besedilo = odgovor
    .replace(OZNAKA_N8N_RX, (_m, tipRaw: string, vsebinaRaw?: string) => {
      const tip = tipRaw.toLowerCase();
      const vsebina = (vsebinaRaw ?? "").trim();
      if (oznake.length < 1) {
        if (tip === "seznam") {
          oznake.push({ vrsta: "seznam" });
        } else if (tip === "zazeni" && vsebina) {
          oznake.push({ vrsta: "zazeni", cilj: vsebina });
        } else if (tip === "ustvari" && vsebina) {
          const i = vsebina.indexOf("|");
          if (i >= 0) {
            const ime = vsebina.slice(0, i).trim();
            const opis = vsebina.slice(i + 1).trim();
            if (opis) oznake.push({ vrsta: "ustvari", ...(ime ? { ime } : {}), opis });
          } else {
            oznake.push({ vrsta: "ustvari", opis: vsebina });
          }
        }
      }
      return "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { besedilo, oznake };
}

export const NAVODILO_OZNAKE_N8N =
  " Dodatek n8n je vklopljen na računalniku lastnika. Ko lastnik želi videti tokove v n8n, na konec odgovora dodaj [[n8n-seznam]]. " +
  "Ko želi zagnati obstoječi tok, dodaj [[n8n-zazeni: <id ali ime toka>]]. " +
  "Ko želi ustvariti nov preprost tok iz opisa (npr. urnik ob določeni uri), dodaj [[n8n-ustvari: <kratko ime> | <opis toka>]]. " +
  "Oznaki za ustvarjanje in zagon NE izvedeta ničesar takoj: pripravita samo predlog, ki čaka potrditev lastnika. " +
  "Nikoli ne trdi, da si tok že ustvarila ali zagnala, dokler tega ne potrdi lastnik in ne sporoči program.";

// ------------------------------------------------------------------ Oblikovanje sporocil (SL/EN)

const OZNAKA_POTRDITVE = /\(n8n ID: ([a-f0-9]{16})\)/i;

export function jeSporociloPotrditveN8n(besedilo: string): string | null {
  const m = OZNAKA_POTRDITVE.exec(besedilo);
  return m && ID_PREDLOGA_RX.test(m[1]!) ? m[1]!.toLowerCase() : null;
}

export function oblikujSeznamTokovN8n(tokovi: readonly TokN8n[], jezik: Jezik = "sl"): string {
  if (tokovi.length === 0) {
    return jezik === "en" ? "There are no workflows in n8n yet." : "V n8n še ni nobenega toka.";
  }
  const glava = jezik === "en" ? `Workflows in n8n (${tokovi.length}):` : `Tokovi v n8n (${tokovi.length}):`;
  const vrstice = tokovi.slice(0, 30).map((t) => {
    const st = jezik === "en" ? (t.aktiven ? "active" : "inactive") : t.aktiven ? "aktiven" : "neaktiven";
    return `- ${t.ime} (ID: ${t.id}, ${st})`;
  });
  return `${glava}\n${vrstice.join("\n")}`;
}

export function oblikujPredlogPotrditveN8n(
  p: Pick<PredlogN8n, "id" | "vrsta" | "imeToka" | "povzetek">,
  jezik: Jezik = "sl",
): string {
  if (jezik === "en") {
    const dejanje = p.vrsta === "ustvari" ? `Create n8n workflow "${p.imeToka}"` : `Run n8n workflow "${p.imeToka}"`;
    return `Waiting for your confirmation: ${dejanje}. ${p.povzetek} Reply "yes" (or "confirm n8n") to proceed, or "no" to cancel, or confirm in the Computer tab / phone. (n8n ID: ${p.id})`;
  }
  const dejanje = p.vrsta === "ustvari" ? `Ustvarim n8n tok »${p.imeToka}«` : `Zaženem n8n tok »${p.imeToka}«`;
  return `Čakam vašo potrditev: ${dejanje}. ${p.povzetek} Odgovorite »da« (ali »potrdi n8n«) za izvedbo ali »ne« za preklic, oziroma potrdite v zavihku Računalnik ali na telefonu. (n8n ID: ${p.id})`;
}

export function oblikujIzidN8n(
  p: Pick<PredlogN8n, "vrsta" | "imeToka" | "tokId" | "stanje" | "rezultat" | "izvedbaId" | "razlog">,
  jezik: Jezik = "sl",
): string {
  if (p.stanje === "napaka") {
    const r = p.razlog ?? "zagon";
    return jezik === "en"
      ? `n8n action (${p.imeToka}) failed (${r}).`
      : `Dejanje v n8n (${p.imeToka}) ni uspelo (${r}).`;
  }
  if (p.vrsta === "ustvari") {
    return jezik === "en"
      ? `n8n workflow "${p.imeToka}" created (ID: ${p.tokId ?? "?"}, inactive).`
      : `Tok v n8n »${p.imeToka}« je ustvarjen (ID: ${p.tokId ?? "?"}, neaktiven).`;
  }
  const ex = p.izvedbaId ? (jezik === "en" ? `, execution: ${p.izvedbaId}` : `, izvedba: ${p.izvedbaId}`) : "";
  return jezik === "en"
    ? `n8n workflow "${p.imeToka}" (ID: ${p.tokId ?? "?"}) finished${ex}.`
    : `Tok v n8n »${p.imeToka}« (ID: ${p.tokId ?? "?"}) se je izvedel${ex}.`;
}

export function opisRazlogaN8n(razlog: RazlogN8n, jezik: Jezik = "sl"): string {
  if (jezik === "en") {
    switch (razlog) {
      case "izklopljeno": return "n8n is turned off in Settings → Add-ons.";
      case "ni-povezave": return "n8n is not reachable on 127.0.0.1 yet (still starting or stopped).";
      case "ni-kljuca": return "n8n API key is not ready yet.";
      case "ze-nastavljen": return "n8n already has an owner account created outside Lina.";
      case "geslo": return "Set an owner password first.";
      case "oblika": return "The workflow description or parameters are not valid.";
      case "ni-najdeno": return "Workflow or pending proposal was not found.";
      case "zgostitev": return "Confirmation does not match the proposal content.";
      case "poteklo": return "The proposal has expired; please create a new one.";
      case "polno-cakajoce": return "Too many pending n8n proposals; confirm or cancel existing ones first.";
      case "zagon": return "Running the n8n workflow failed.";
      case "ustvari": return "Creating the n8n workflow failed.";
      case "neveljaven-naslov": return "Only local 127.0.0.1 n8n addresses are allowed.";
      default: return "Unknown n8n command.";
    }
  }
  switch (razlog) {
    case "izklopljeno": return "Dodatek n8n je izklopljen v Nastavitve → Dodatki.";
    case "ni-povezave": return "n8n še ni dosegljiv na 127.0.0.1 (se še zaganja ali ne teče).";
    case "ni-kljuca": return "API ključ za n8n še ni pripravljen.";
    case "ze-nastavljen": return "n8n že ima lastniški račun, ustvarjen zunaj Line.";
    case "geslo": return "Najprej nastavite geslo lastnika.";
    case "oblika": return "Opis toka ali podatki niso veljavni.";
    case "ni-najdeno": return "Toka ali čakajočega predloga nisem našla.";
    case "zgostitev": return "Potrditev se ne ujema z vsebino predloga.";
    case "poteklo": return "Predlog je potekel; pripravite novega.";
    case "polno-cakajoce": return "Preveč čakajočih predlogov za n8n; najprej potrdite ali zavrnite obstoječe.";
    case "zagon": return "Zagon toka v n8n ni uspel.";
    case "ustvari": return "Ustvarjanje toka v n8n ni uspelo.";
    case "neveljaven-naslov": return "Dovoljen je samo lokalni naslov n8n na 127.0.0.1.";
    default: return "Neznan ukaz za n8n.";
  }
}
