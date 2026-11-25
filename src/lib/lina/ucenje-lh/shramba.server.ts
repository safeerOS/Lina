/**
 * Shramba ucnih enot: ucenje-lh.json v podatkovni mapi lastnika (0600 prek writeJson, atomaren zapis), branje brez sledenja simbolnim
 * povezavam (lstat + O_NOFOLLOW) in z mejo velikosti. Privzeto VKLOPLJENO (manjkajoca datoteka = vklopljen). Brez omrezja.
 *
 * Nova koda Safeer (vzorec ucenje-popravkov.server.ts), del modula ucenje-lh (prirejeno po LearnHarness, Amos Blomqvist,
 * AGPL-3.0-only); spremenil Safeer, team@safeer.si, 25. 11. 2026. Licenca: AGPL-3.0 (LICENSE v tej mapi).
 */
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { writeJson } from "../store.server.ts";
import {
  NAJMANJ_KORAKOV,
  NAJVEC_ENOT,
  NAJVEC_KORAKOV,
  NAJVEC_ZNAKOV_KORAKA,
  NAJVEC_ZNAKOV_NASLOVA,
  NAJVEC_IZKUSENJ,
  NAJVEC_IZKUSENJ_NA_TIP,
  cisto,
  enaVrstica,
  zacetniNapredek,
  type Enota,
  type IzkusnjaLH,
  type NapredekKoraka,
  type Seja,
  type StanjeLH,
} from "./enota.ts";

export const UCENJE_LH_DATOTEKA = "ucenje-lh.json";
const MEJA_DATOTEKE_B = 1024 * 1024;
const O_VARNO_BRANJE = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

const vrste = new Map<string, Promise<unknown>>();
/** Zaporedni dostop do datoteke za isto podatkovno mapo. */
export function vVrsti<T>(root: string, delo: () => Promise<T>): Promise<T> {
  const prej = vrste.get(root) ?? Promise.resolve();
  const zdaj = prej.then(delo, delo);
  const rep = zdaj.catch(() => undefined);
  vrste.set(root, rep);
  void rep.then(() => {
    if (vrste.get(root) === rep) vrste.delete(root);
  });
  return zdaj;
}

const privzeto = (): StanjeLH => ({ vklopljen: true, enote: [], seja: null, izkusnje: [] });
/** Nepricakovana datoteka (simbolna povezava, prevelika): izklopljeno, nic se ne bere. */
const zaprto = (): StanjeLH => ({ vklopljen: false, enote: [], seja: null, izkusnje: [] });

/** Izkusnje orkestratorja (naloga 8): tip v obliki normirajTip, besedilo ocisceno ([[, nevidni znaki), meje stevila in dolzine. */
function veljavneIzkusnje(x: unknown): IzkusnjaLH[] {
  if (!Array.isArray(x)) return [];
  const po: Map<string, number> = new Map();
  const out: IzkusnjaLH[] = [];
  for (const i of x.slice(-NAJVEC_IZKUSENJ)) {
    const v = i as Partial<IzkusnjaLH> | null;
    if (!v || typeof v.tip !== "string" || !/^[a-z0-9-]{1,40}$/.test(v.tip)) continue;
    const besedilo = cisto(v.besedilo, 600);
    if (!besedilo) continue;
    const n = po.get(v.tip) ?? 0;
    if (n >= NAJVEC_IZKUSENJ_NA_TIP) continue;
    po.set(v.tip, n + 1);
    out.push({ tip: v.tip, naslov: cisto(v.naslov, 80) || "Izkusnja", besedilo });
  }
  return out;
}

function veljavenNapredek(x: unknown): NapredekKoraka {
  const n = x as Partial<NapredekKoraka> | null;
  if (!n || typeof n !== "object") return zacetniNapredek();
  return {
    skatla: Number.isInteger(n.skatla) && n.skatla! >= 0 && n.skatla! <= 5 ? n.skatla! : 0,
    naslednjic: typeof n.naslednjic === "string" && !Number.isNaN(Date.parse(n.naslednjic)) ? n.naslednjic : null,
    poskusov: Number.isInteger(n.poskusov) && n.poskusov! >= 0 ? Math.min(n.poskusov!, 1e6) : 0,
    preverjen: n.preverjen === true,
  };
}

function veljavnaEnota(x: unknown): Enota | null {
  const e = x as Partial<Enota> | null;
  if (!e || typeof e.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(e.id) || !Array.isArray(e.koraki)) return null;
  const koraki = e.koraki.slice(0, NAJVEC_KORAKOV).map((k) => ({
    besedilo: enaVrstica(k?.besedilo, NAJVEC_ZNAKOV_KORAKA),
    razlaga: enaVrstica(k?.razlaga, NAJVEC_ZNAKOV_KORAKA),
    vprasanje: enaVrstica(k?.vprasanje, 300),
    bistvo: Array.isArray(k?.bistvo) ? k.bistvo.map((b: unknown) => enaVrstica(b, 40)).filter(Boolean).slice(0, 6) : [],
  }));
  if (koraki.length < NAJMANJ_KORAKOV || koraki.some((k) => !k.besedilo || !k.vprasanje)) return null;
  const napredek = koraki.map((_, i) => veljavenNapredek(Array.isArray(e.napredek) ? e.napredek[i] : null));
  return {
    id: e.id,
    naslov: enaVrstica(e.naslov, NAJVEC_ZNAKOV_NASLOVA) || "Postopek",
    ustvarjeno: typeof e.ustvarjeno === "string" ? e.ustvarjeno.slice(0, 40) : "",
    koraki,
    napredek,
  };
}

function veljavnaSeja(x: unknown, enote: Enota[]): Seja | null {
  const s = x as Partial<Seja> | null;
  if (!s || typeof s.enotaId !== "string" || !["merjenje", "pouk", "ponavljanje"].includes(s.faza as string)) return null;
  const e = enote.find((y) => y.id === s.enotaId);
  if (!e) return null;
  const n = e.koraki.length;
  const cel = (v: unknown, max: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : null);
  const lo = cel(s.lo, n);
  const hi = cel(s.hi, n);
  const korak = cel(s.korak, n);
  if (lo === null || hi === null || korak === null || lo > hi || typeof s.zadnjic !== "string" || Number.isNaN(Date.parse(s.zadnjic))) return null;
  const vrsta = Array.isArray(s.vrsta) ? s.vrsta.filter((i): i is number => cel(i, n - 1) !== null).slice(0, n) : [];
  // vsaka faza mora imeti korak, ki obstaja (sicer bi ura obticala)
  if (s.faza === "merjenje" && lo >= hi) return null;
  if (s.faza === "pouk" && korak >= n) return null;
  if (s.faza === "ponavljanje" && vrsta.length === 0) return null;
  return { enotaId: e.id, faza: s.faza as Seja["faza"], lo, hi, korak, vrsta, zadnjic: s.zadnjic };
}

export async function preberiStanjeLH(root: string): Promise<StanjeLH> {
  const pot = path.join(root, UCENJE_LH_DATOTEKA);
  let st;
  try {
    st = await lstat(pot);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return privzeto();
    throw e;
  }
  if (!st.isFile() || st.size > MEJA_DATOTEKE_B) return zaprto();
  let h;
  try {
    h = await open(pot, O_VARNO_BRANJE);
  } catch {
    return zaprto();
  }
  try {
    const st2 = await h.stat();
    if (!st2.isFile() || st2.size > MEJA_DATOTEKE_B) return zaprto();
    const buf = Buffer.allocUnsafe(st2.size);
    const { bytesRead } = await h.read(buf, 0, st2.size, 0);
    const raw = JSON.parse(buf.subarray(0, bytesRead).toString("utf8")) as { vklopljen?: unknown; enote?: unknown; seja?: unknown; izkusnje?: unknown };
    const enote = Array.isArray(raw.enote) ? raw.enote.map(veljavnaEnota).filter((e): e is Enota => e !== null).slice(-NAJVEC_ENOT) : [];
    return { vklopljen: raw.vklopljen !== false, enote, seja: veljavnaSeja(raw.seja, enote), izkusnje: veljavneIzkusnje(raw.izkusnje) };
  } catch {
    // pokvarjena datoteka: izklopljeno, da je samodejni zapis ne prepise (lastnik jo vidi kot izklopljeno in odloci sam)
    return zaprto();
  } finally {
    await h.close().catch(() => undefined);
  }
}

export async function zapisiStanjeLH(root: string, s: StanjeLH): Promise<void> {
  await writeJson(root, UCENJE_LH_DATOTEKA, s);
}
