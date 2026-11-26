/**
 * Samodejna preverba posodobitev Line (naloga 28, lastnik 26. 11. 2026: »ko objavimo update za Lino, da obvestilo uporabniku in da
 * uporabnik klikne le Posodobi«). Streznik, ki ga je zagnala namescena lupina, vprasa GitHub 2 min po zagonu in nato vsakih 6 h
 * (If-None-Match, kandidatGithub); po napaki (omrezje, 403/429, 5xx) se naslednja preverba odmakne eksponentno (12 h, 24 h), nikoli
 * hitro ponavljanje. Stikalo »Samodejno preveri posodobitve« je privzeto VKLOPLJENO (lastnikova ideja), izklop velja takoj.
 * Vmesnik bere SAMO stanje v pomnilniku (obvestiloPosodobitve) - nikoli ne sprozi zahteve na GitHub. Posodobi zazene obstojeco pot
 * zacniPosodobitev (podpis -> vsota -> pkexec); ta modul nicesar ne namesti.
 */
import { requireOwner } from "./auth.server.ts";
import { kandidat, odv, podpisaneOpombe, podpisanSeznam, predpogoj, primerjajRazlicici, vsotaIzSeznama, type Odvisnosti } from "./posodobitev.server.ts";
import { izvedljivaLupine } from "./samodejni-zagon.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

export const DATOTEKA_SAMODEJNO = "posodobitev-samodejno.json";
export const OBDOBJE_PREVERBE_MS = 6 * 3600_000;
export const ZAMIK_ZAGONA_MS = 2 * 60_000;
/** Opombe izdaje v vmesniku: najvec toliko znakov (nezaupano besedilo z GitHuba). */
export const NAJVEC_OPOMB = 1500;
const NAJVEC_ODMIKA = 2;

export type Casovnik = { nastavi: (fn: () => void, ms: number) => { unref?(): void }; pocisti: (t: unknown) => void };
export type ObvestiloPosodobitve = { samodejno: boolean; razlicica: string | null; opombe: string };
type Stanje = { napakZapored: number; najdeno: { razlicica: string; opombe: string } | null; casovnik: unknown; c: Casovnik | null };

/** Nadzorni (razen nove vrstice), oblikovni, smerni in nevidni znaki (Trojan Source, skrito besedilo): v opombah se izpustijo. */
function nevidni(k: number): boolean {
  return (
    (k < 0x20 && k !== 0x0a) ||
    (k >= 0x7f && k <= 0x9f) ||
    k === 0xad ||
    k === 0x34f ||
    k === 0x61c ||
    k === 0x180e ||
    k === 0x115f ||
    k === 0x1160 ||
    k === 0x3164 ||
    k === 0xffa0 ||
    (k >= 0xfe00 && k <= 0xfe0f) ||
    (k >= 0x180b && k <= 0x180d) ||
    k === 0x2800 ||
    k === 0xfffc ||
    (k >= 0x1bca0 && k <= 0x1bca3) ||
    (k >= 0x200b && k <= 0x200f) ||
    (k >= 0x202a && k <= 0x202e) ||
    (k >= 0x2060 && k <= 0x206f) ||
    k === 0xfeff ||
    (k >= 0xfff9 && k <= 0xfffb) ||
    (k >= 0xe0000 && k <= 0xe0fff) ||
    (k >= 0xd800 && k <= 0xdfff)
  );
}

/** Golo besedilo za prikaz: brez nevidnih znakov, CRLF/LS/PS -> \n, tab -> presledek, najvec ena prazna vrstica, omejena dolzina. */
export function ocistiOpombe(v: unknown): string {
  if (typeof v !== "string") return "";
  let izid = "";
  for (const znak of v.slice(0, NAJVEC_OPOMB * 4)) {
    const k = znak.codePointAt(0)!;
    if (k === 0x2028 || k === 0x2029) izid += "\n";
    else if (k === 0x09) izid += " ";
    else if (!nevidni(k)) izid += znak;
  }
  izid = izid.replace(/\n{3,}/g, "\n\n").trim();
  if (izid.length <= NAJVEC_OPOMB) return izid;
  // rez na meji znaka (ne sredi nadomestnega para)
  let rez = "";
  for (const znak of izid) {
    if (rez.length + znak.length > NAJVEC_OPOMB - 1) break;
    rez += znak;
  }
  return rez.trimEnd() + "…";
}

/** Zamik do naslednje preverbe: 6 h, po n zaporednih napakah 6 h * 2^min(n, 2). */
export function zamikPoNapakah(napak: number): number {
  return OBDOBJE_PREVERBE_MS * 2 ** Math.min(Math.max(0, napak), NAJVEC_ODMIKA);
}

const stanja = new Map<string, Stanje>();
function stanjeZa(root: string): Stanje {
  let s = stanja.get(root);
  if (!s) stanja.set(root, (s = { napakZapored: 0, najdeno: null, casovnik: null, c: null }));
  return s;
}

/** Samo za preizkuse in diagnozo. */
export function stanjeSamodejne(dir?: string): { napakZapored: number } {
  return { napakZapored: stanjeZa(resolveDataDir(dir)).napakZapored };
}

/** Privzeto vklopljeno: izklopljeno samo, ce je v datoteki izrecno false. */
export async function samodejnoVklopljeno(dir?: string): Promise<boolean> {
  const v = await readJsonFile<{ vklop?: unknown }>(resolveDataDir(dir), DATOTEKA_SAMODEJNO).catch(() => null);
  return v?.vklop !== false;
}

export async function nastaviSamodejno(token: string | null, vklop: unknown, dir?: string): Promise<{ samodejno: boolean }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (typeof vklop !== "boolean") throw new Error("Neveljavna vrednost.");
  // najdena izdaja ostane v pomnilniku: izklop jo samo skrije (obvestiloPosodobitve), ponovni vklop jo takoj spet pokaze
  await writeJson(root, DATOTEKA_SAMODEJNO, { vklop });
  return { samodejno: vklop };
}

/** Ena preverba (brez casovnika). Napaka vira poveca odmik; izklopljeno stikalo ali nemogoca posodobitev ne vprasata nikogar. */
export async function preveriEnkrat(dir: string | undefined, odvisnosti: Odvisnosti = {}): Promise<"ok" | "napaka" | "preskoceno"> {
  const root = resolveDataDir(dir);
  const s = stanjeZa(root);
  if (!(await samodejnoVklopljeno(root))) return "preskoceno";
  const o = odv(odvisnosti);
  const p = await predpogoj(o);
  if (typeof p === "string") {
    s.najdeno = null;
    return "preskoceno";
  }
  try {
    const k = await kandidat(o, root, true);
    let najdeno = k && primerjajRazlicici(k.razlicica, p.namescena) > 0 ? { razlicica: k.razlicica, opombe: "" } : null;
    // slepi pregled S2: obvestilo (razlicica in besedilo opomb) samo za izdajo, katere SHA256SUMS je podpisan s kljucem Safeer in
    // nasteje ta paket; JSON izdaje sam ni podpisan. Vir »mapa« (razvojni racunalnik) nima podpisa (kot pri Posodobi).
    if (k && najdeno && k.vir === "github") {
      const vsote = await podpisanSeznam(o, root, k);
      if (vsote === "prenos") throw new Error("Prenos seznama vsot ni uspel.");
      if (vsote === "podpis" || !vsotaIzSeznama(vsote.toString("utf8"), k.ime)) najdeno = null;
      // krog 2 #1: besedilo samo iz podpisanega OPOMBE.txt (telo izdaje lahko napise vsak, ki objavi izdajo)
      else if (najdeno) najdeno.opombe = ocistiOpombe(await podpisaneOpombe(o, root, k, vsote));
    }
    s.napakZapored = 0;
    s.najdeno = najdeno;
    return "ok";
  } catch {
    s.napakZapored++;
    return "napaka";
  }
}

/** Za vmesnik (Domov, obvestilo, Nastavitve): samo stanje v pomnilniku, brez zahteve na GitHub. */
export async function obvestiloPosodobitve(token: string | null, dir?: string): Promise<ObvestiloPosodobitve> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const samodejno = await samodejnoVklopljeno(root);
  const n = samodejno ? stanjeZa(root).najdeno : null;
  return { samodejno, razlicica: n?.razlicica ?? null, opombe: n?.opombe ?? "" };
}

const PRAVI_CASOVNIK: Casovnik = { nastavi: (fn, ms) => setTimeout(fn, ms), pocisti: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };

/**
 * Zazene preverbo za to mapo podatkov (idempotentno). Samo streznik namescene lupine (izvedljivaLupine): razvojni streznik in
 * preizkusi ne sprozijo nobene zahteve na GitHub. Casovnik ne drzi procesa pri zivljenju. Vrne true, ce je bil urnik zagnan zdaj.
 */
export function zazeniSamodejnoPreverbo(
  dir?: string,
  m: { odvisnosti?: Odvisnosti; casovnik?: Casovnik; env?: NodeJS.ProcessEnv; izvedljiva?: string } = {},
): boolean {
  if (!izvedljivaLupine(m.env ?? process.env, m.izvedljiva ?? process.execPath)) return false;
  const root = resolveDataDir(dir);
  const s = stanjeZa(root);
  if (s.casovnik) return false;
  const c = m.casovnik ?? PRAVI_CASOVNIK;
  s.c = c;
  const naslednja = (ms: number) => {
    const t = c.nastavi(() => {
      void preveriEnkrat(root, m.odvisnosti)
        .catch(() => {
          s.napakZapored++;
        })
        .finally(() => {
          if (s.casovnik) naslednja(zamikPoNapakah(s.napakZapored));
        });
    }, ms);
    t.unref?.();
    s.casovnik = t;
  };
  naslednja(ZAMIK_ZAGONA_MS);
  return true;
}

export function ustaviSamodejnoPreverbo(dir?: string): void {
  const s = stanjeZa(resolveDataDir(dir));
  if (s.casovnik) s.c?.pocisti(s.casovnik);
  s.casovnik = null;
}
