/**
 * Ucenje iz popravkov lastnika - strezniska shramba (ideja: Task Observer, rebelytics/one-skill-to-rule-them-all, CC-BY-4.0; lastna koda).
 *
 * Pravila:
 * - Privzeto VKLOPLJENO (manjkajoca datoteka = vklopljen: true); samo izrecen false v ucenje-popravkov.json izklopi.
 * - Zapis kandidata nikoli ne spremeni trajnih pravil; trajno pravilo nastane SAMO z izrecnim klicem shraniKandidata (lastnikov gumb »Shrani«).
 * - Branje brez sledenja simbolnim povezavam (lstat + O_NOFOLLOW) in z mejo velikosti; atomaren zapis z 0600 (writeJson).
 * - Skrivnosti se zavrnejo (jeSkrivnost); v dnevnik gredo samo stevila, nikoli vsebina.
 * - Klici tajnice te datoteke ne uvazajo.
 */
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { resolveDataDir, writeJson } from "./store.server.ts";
import {
  POPRAVKI_NAJVEC_KANDIDATOV,
  POPRAVKI_NAJVEC_PRAVIL,
  oblikujTrajnaPravila,
  preveriPraviloPopravka,
  pripraviKandidata,
  staPodobnaPopravka,
  type KandidatPravila,
  type ShranjenoPravilo,
} from "./ucenje-popravkov.ts";

export const POPRAVKI_DATOTEKA = "ucenje-popravkov.json";
const MEJA_DATOTEKE_B = 512 * 1024;
const O_VARNO_BRANJE = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

export type StanjePopravkov = {
  vklopljen: boolean;
  kandidati: KandidatPravila[];
  pravila: ShranjenoPravilo[];
};

const vrste = new Map<string, Promise<unknown>>();
function vVrsti<T>(root: string, delo: () => Promise<T>): Promise<T> {
  const prej = vrste.get(root) ?? Promise.resolve();
  const zdaj = prej.then(delo, delo);
  const rep = zdaj.catch(() => undefined);
  vrste.set(root, rep);
  void rep.then(() => {
    if (vrste.get(root) === rep) vrste.delete(root);
  });
  return zdaj;
}

function privzetoStanje(): StanjePopravkov {
  return { vklopljen: true, kandidati: [], pravila: [] };
}

async function preberiStanje(root: string): Promise<StanjePopravkov> {
  const pot = path.join(root, POPRAVKI_DATOTEKA);
  let st;
  try {
    st = await lstat(pot);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return privzetoStanje();
    throw e;
  }
  if (!st.isFile() || st.size > MEJA_DATOTEKE_B) return { vklopljen: false, kandidati: [], pravila: [] };
  let h;
  try {
    h = await open(pot, O_VARNO_BRANJE);
  } catch {
    return { vklopljen: false, kandidati: [], pravila: [] };
  }
  try {
    const st2 = await h.stat();
    if (!st2.isFile() || st2.size > MEJA_DATOTEKE_B) return { vklopljen: false, kandidati: [], pravila: [] };
    const buf = Buffer.allocUnsafe(st2.size);
    const { bytesRead } = await h.read(buf, 0, st2.size, 0);
    const raw = JSON.parse(buf.subarray(0, bytesRead).toString("utf8")) as Partial<StanjePopravkov>;
    const kandidati = Array.isArray(raw.kandidati)
      ? raw.kandidati
          .filter((k): k is KandidatPravila => Boolean(k && typeof k.id === "string" && typeof k.besedeLastnika === "string" && typeof k.predlogPravila === "string"))
          .slice(-POPRAVKI_NAJVEC_KANDIDATOV)
      : [];
    const pravila = Array.isArray(raw.pravila)
      ? raw.pravila
          .filter((p): p is ShranjenoPravilo => Boolean(p && typeof p.id === "string" && typeof p.besedilo === "string"))
          .slice(-POPRAVKI_NAJVEC_PRAVIL)
      : [];
    return {
      vklopljen: raw.vklopljen !== false,
      kandidati,
      pravila,
    };
  } catch {
    return privzetoStanje();
  } finally {
    await h.close().catch(() => undefined);
  }
}

/** Stikalo: privzeto VKLOPLJENO (manjkajoca datoteka = true); izklopi samo izrecni false. */
export async function jeUcenjePopravkovVklopljeno(dir?: string): Promise<boolean> {
  return (await preberiStanje(resolveDataDir(dir))).vklopljen;
}

export async function preberiStanjePopravkov(dir?: string): Promise<StanjePopravkov> {
  return preberiStanje(resolveDataDir(dir));
}

export async function nastaviUcenjePopravkov(vklopljen: boolean, dir?: string): Promise<StanjePopravkov> {
  const root = resolveDataDir(dir);
  return vVrsti(root, async () => {
    const s = await preberiStanje(root);
    s.vklopljen = vklopljen === true;
    await writeJson(root, POPRAVKI_DATOTEKA, s);
    return s;
  });
}

/**
 * Zabelezi kandidata za pravilo iz sporocila lastnika (ce je ucenje vklopljeno in sporocilo je popravek).
 * Ponovljen opomin zdruzi z obstojecim cakajocim kandidatom (ponovitev++), da ne nastajajo podvojitve.
 * NIKOLI ne spremeni trajnih pravil (s.pravila).
 */
export async function zabeleziPopravek(
  dir: string | undefined,
  besediloLastnika: string,
  prejsnjiOdgovorLine = "",
  zdaj: Date = new Date(),
): Promise<KandidatPravila | null> {
  const root = resolveDataDir(dir);
  const kandidat = pripraviKandidata(besediloLastnika, prejsnjiOdgovorLine, zdaj);
  if (!kandidat) return null;
  return vVrsti(root, async () => {
    const s = await preberiStanje(root);
    if (!s.vklopljen) return null;
    // Ze potrjeno enako pravilo: ponoven opomin vseeno zabelezimo kot ponovitev kandidata (signal za krepkejse pravilo).
    const obstojeci = s.kandidati.find((k) => k.stanje === "caka" && staPodobnaPopravka(k.predlogPravila, kandidat.predlogPravila));
    if (obstojeci) {
      obstojeci.ponovitev = (obstojeci.ponovitev || 1) + 1;
      obstojeci.cas = kandidat.cas;
      obstojeci.besedeLastnika = kandidat.besedeLastnika;
      await writeJson(root, POPRAVKI_DATOTEKA, s);
      console.info(`lina ucenje-popravkov: ponovitev=${obstojeci.ponovitev}`);
      return obstojeci;
    }
    s.kandidati = [...s.kandidati, kandidat].slice(-POPRAVKI_NAJVEC_KANDIDATOV);
    await writeJson(root, POPRAVKI_DATOTEKA, s);
    console.info(`lina ucenje-popravkov: kandidatov=${s.kandidati.length}`);
    return kandidat;
  });
}

/**
 * Lastnik potrdi kandidata s klikom »Shrani«: pravilo gre v trajna pravila Line, kandidat dobi stanje »shranjeno«.
 * Po zelji lahko lastnik pred shranjevanjem uredi predlog pravila.
 */
export async function shraniKandidata(
  id: string,
  urejenPredlog?: string,
  dir?: string,
  zdaj: Date = new Date(),
): Promise<{ ok: true; stanje: StanjePopravkov; pravilo: ShranjenoPravilo } | { ok: false; razlog: "ni-najdeno" | "prazno" | "predolgo" | "skrivnost" | "polno" }> {
  const root = resolveDataDir(dir);
  return vVrsti(root, async () => {
    const s = await preberiStanje(root);
    const k = s.kandidati.find((x) => x.id === id && x.stanje === "caka");
    if (!k) return { ok: false, razlog: "ni-najdeno" };
    const preverba = preveriPraviloPopravka(urejenPredlog ?? k.predlogPravila);
    if (!preverba.ok) return { ok: false, razlog: preverba.razlog };
    if (s.pravila.length >= POPRAVKI_NAJVEC_PRAVIL) return { ok: false, razlog: "polno" };
    const ze = s.pravila.find((p) => staPodobnaPopravka(p.besedilo, preverba.besedilo));
    let pravilo: ShranjenoPravilo;
    if (ze) {
      ze.besedilo = preverba.besedilo;
      pravilo = ze;
    } else {
      pravilo = {
        id: k.id,
        besedilo: preverba.besedilo,
        izvorKandidata: k.id,
        ustvarjeno: zdaj.toISOString(),
      };
      s.pravila = [...s.pravila, pravilo];
    }
    k.predlogPravila = preverba.besedilo;
    k.stanje = "shranjeno";
    await writeJson(root, POPRAVKI_DATOTEKA, s);
    console.info(`lina ucenje-popravkov: shranjenih_pravil=${s.pravila.length}`);
    return { ok: true, stanje: s, pravilo };
  });
}

/** Lastnik zavrne kandidata: ne gre v trajna pravila. */
export async function zavrziKandidata(id: string, dir?: string): Promise<StanjePopravkov> {
  const root = resolveDataDir(dir);
  return vVrsti(root, async () => {
    const s = await preberiStanje(root);
    const k = s.kandidati.find((x) => x.id === id && x.stanje === "caka");
    if (k) {
      k.stanje = "zavrnjeno";
      await writeJson(root, POPRAVKI_DATOTEKA, s);
    }
    return s;
  });
}

/** Lastnik odstrani shranjeno trajno pravilo. */
export async function izbrisiPraviloPopravka(id: string, dir?: string): Promise<StanjePopravkov> {
  const root = resolveDataDir(dir);
  return vVrsti(root, async () => {
    const s = await preberiStanje(root);
    const prej = s.pravila.length;
    s.pravila = s.pravila.filter((p) => p.id !== id);
    if (s.pravila.length !== prej) await writeJson(root, POPRAVKI_DATOTEKA, s);
    return s;
  });
}

/** Odsek potrjenih trajnih pravil za sistemsko navodilo asistentke (prazno ob izklopu ali brez potrjenih pravil). */
export async function odsekPravilIzPopravkov(dir?: string): Promise<string> {
  try {
    const s = await preberiStanje(resolveDataDir(dir));
    if (!s.vklopljen) return "";
    return oblikujTrajnaPravila(s.pravila);
  } catch {
    return "";
  }
}
