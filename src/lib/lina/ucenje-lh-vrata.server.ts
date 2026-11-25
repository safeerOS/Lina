/**
 * Vrata do modula ucenje-lh (AGPL-3.0, prirejeno po LearnHarness). Lastna koda Safeer, ni prevzeta iz LearnHarness.
 *
 * - EDINO mesto, ki uvozi modul (en sam specifikator »./ucenje-lh/vstop.server.ts«; preizkus to preveri). Gradnja z
 *   LINA_BREZ_UCENJA_LH=1 ga preslika v ucenje-lh-prazno.server.ts (vite.config.ts), zato AGPL koda ne pride v paket.
 * - Brez modula ali ob napaki modula Lina deluje: obicajen pogovor, prazen odsek, nastavitve povedo naVoljo: false.
 * - Model klice modul samo prek callProvider z Lininim ponudnikom (vsebinaKlica: false); modul nima svoje poti v omrezje.
 * - Nastavitve samo lastnik (requireOwner). Odgovor modula gre skozi hideSecret.
 */
import { requireOwner } from "./auth.server.ts";
import { callProvider, hideSecret, type ProviderCall } from "./providers.ts";
import { resolveDataDir } from "./store.server.ts";

export const UCENJE_LH_DATOTEKA = "ucenje-lh.json";

type PregledEnote = { id: string; naslov: string; korakov: number; znanih: number; ustvarjeno: string; koraki: string[] };
type Pregled = { vklopljen: boolean; enote: PregledEnote[]; izkusenj: number };
export type StanjeUcenjaLH = Pregled & { naVoljo: boolean };
type KlicModela = (z: { system: string; text: string; maxTokens: number; najvecZnakov: number }) => Promise<string | null>;
type ModulLH = {
  obdelajSporocilo(root: string, besedilo: string, klic: KlicModela, zdaj?: Date, odrezano?: boolean, koledar?: boolean): Promise<string | null>;
  odsekPogovora(root: string, besedilo: string): Promise<string>;
  stanje(root: string): Promise<Pregled>;
  nastavi(root: string, vklop: boolean): Promise<Pregled>;
  izbrisi(root: string, id: string): Promise<Pregled>;
  izbrisiVse(root: string): Promise<Pregled>;
  zaNalogo?(root: string, tip: string, cilj: string): Promise<Array<{ naslov: string; besedilo: string }>>;
  zapisiIzkusnjo?(root: string, i: { tip: string; naslov: string; besedilo: string }): Promise<boolean>;
};

type Nalagalnik = () => Promise<{ ucenjeLH: ModulLH | null }>;
const privzetiNalagalnik: Nalagalnik = () => import("./ucenje-lh/vstop.server.ts");
let nalagalnik: Nalagalnik = privzetiNalagalnik;

/** Samo za preizkuse: nadomestek ali modul, ki se ne nalozi (null = privzeto). */
export function nastaviNalagalnikZaPreizkus(n: Nalagalnik | null): void {
  nalagalnik = n ?? privzetiNalagalnik;
}

async function modul(): Promise<ModulLH | null> {
  try {
    return (await nalagalnik()).ucenjeLH ?? null;
  } catch {
    return null;
  }
}

type Mozgani = Pick<ProviderCall, "provider" | "model" | "key"> & Partial<ProviderCall>;

/** Sporocilo lastnika v pogovoru (ne priponke, ne klici). Vrne odgovor modula ali null (obicajen pogovor). Nikoli ne vrze.
 *  odrezano: lastnikovo sporocilo je bilo daljse od meje pogovora (modul na to opozori, da ne izgubi korakov tiho).
 *  koledar: koledarska namera (koda Line); med uro gre izrecen ukaz koledarju, ura ostane. */
export async function ucenjeLHSporocilo(root: string, besedilo: string, brain: Mozgani, zdaj: Date = new Date(), odrezano = false, koledar = false): Promise<string | null> {
  const m = await modul();
  if (!m) return null;
  const klic: KlicModela = async (z) => {
    const r = await callProvider({ ...brain, text: z.text, system: z.system, maxTokens: z.maxTokens, najvecZnakov: z.najvecZnakov, najvecVhoda: 4000, timeoutMs: 30_000, vsebinaKlica: false });
    return r.ok ? r.text : null;
  };
  try {
    const odg = await m.obdelajSporocilo(root, besedilo, klic, zdaj, odrezano, koledar);
    return odg === null ? null : hideSecret(odg, brain.key);
  } catch {
    console.warn("lina ucenje-lh: obdelava ni uspela");
    return null;
  }
}

/** Odsek ucnih enot za sistemsko navodilo (podatek). Prazno brez modula, ob izklopu ali napaki. */
export async function ucenjeLHOdsek(root: string, besedilo: string): Promise<string> {
  const m = await modul();
  if (!m) return "";
  try {
    return await m.odsekPogovora(root, besedilo);
  } catch {
    return "";
  }
}

/**
 * Orkestrator (naloga 8, orkestrator-ucenje.ts): ucne enote in izkusnje za nalogo. null = modula ni (gradnja brez njega, napaka
 * nalaganja ali starejsi modul brez te funkcije) - orkestrator takrat uporabi privzeto samoucenje. Ob napaki modula prazno.
 * Vrata ne uvazajo orkestratorja (brez kroga, pot klica ostane locena).
 */
export async function ucenjeLHZaNalogo(dir: string | undefined, tip: string, cilj: string): Promise<Array<{ naslov: string; besedilo: string }> | null> {
  const m = await modul();
  if (!m?.zaNalogo) return null;
  return m.zaNalogo(resolveDataDir(dir), tip, cilj).catch(() => []);
}

export async function ucenjeLHZapisiIzkusnjo(dir: string | undefined, i: { tip: string; naslov: string; besedilo: string }): Promise<boolean | null> {
  const m = await modul();
  if (!m?.zapisiIzkusnjo) return null;
  return m.zapisiIzkusnjo(resolveDataDir(dir), i).catch(() => false);
}

/** Ali je modul nalozen in zna delati z orkestratorjem (izbira ucenja ob prvem koraku). */
export async function ucenjeLHZaOrkestrator(): Promise<boolean> {
  const m = await modul();
  return typeof m?.zaNalogo === "function" && typeof m?.zapisiIzkusnjo === "function";
}

const brezModula = (): StanjeUcenjaLH => ({ naVoljo: false, vklopljen: false, enote: [], izkusenj: 0 });

export async function stanjeUcenjaLH(token: string | null, dir?: string): Promise<StanjeUcenjaLH> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const m = await modul();
  return m ? { naVoljo: true, ...(await m.stanje(root)) } : brezModula();
}

export async function nastaviUcenjeLH(vklop: unknown, token: string | null, dir?: string): Promise<StanjeUcenjaLH> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (typeof vklop !== "boolean") throw new Error("Neveljavna nastavitev.");
  const m = await modul();
  return m ? { naVoljo: true, ...(await m.nastavi(root, vklop)) } : brezModula();
}

export async function izbrisiEnotoLH(id: unknown, token: string | null, dir?: string): Promise<StanjeUcenjaLH> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (typeof id !== "string" || !/^[a-z0-9-]{1,40}$/.test(id)) throw new Error("Neveljavna enota.");
  const m = await modul();
  return m ? { naVoljo: true, ...(await m.izbrisi(root, id)) } : brezModula();
}

export async function izbrisiVseLH(token: string | null, dir?: string): Promise<StanjeUcenjaLH> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const m = await modul();
  return m ? { naVoljo: true, ...(await m.izbrisiVse(root)) } : brezModula();
}
