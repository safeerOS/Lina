/**
 * Dnevna motivacija, strezniski del (lastnik 21. 11. 2026): najvec DVE misli na dan (jutro, vecer po 17. uri), shranjeni v
 * motivacija.json. Samo za lastnika in samo za pogovor z asistentko: klici in tajnica je ne dobijo (vsebinaKlica: false).
 * Zahteva modelu privzeto ne nosi osebnih podatkov; zapiski o lastniku (spomin) gredo vanjo SAMO pri slogu "osebno" ali "oboje"
 * in samo, ce je stikalo spomina vklopljeno. Ista misel cel del dneva (brez ponovnega klica modela); hkratni klici se zdruzijo
 * v vrsti. Ob napaki ali nevarnem odgovoru modela velja vnaprej pripravljena misel. Komentarji so brez sumnikov.
 */
import { requireOwner } from "./auth.server.ts";
import { pogovorBrain } from "./keys.server.ts";
import {
  HUMORJI,
  MOTIVACIJA_NAJVEC_ZNAKOV,
  MOTIVACIJA_ZGODOVINA,
  PRIVZETE_NASTAVITVE,
  SLOGI,
  TEME,
  delDneva,
  izberiVnaprej,
  jeKljucDneva,
  jeOsebnaMisel,
  kljucDneva,
  ocistiOdgovorModela,
  sestaviNavodilo,
  temaDneva,
  zdruziNastavitve,
  type Del,
  type Motivacija,
  type Nastavitve,
  type Navodilo,
} from "./motivacija.ts";
import { callProvider } from "./providers.ts";
import { dejstvaZaModel } from "./spomin.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

export const DATOTEKA_MOTIVACIJE = "motivacija.json";
export const ROK_MODELA_MS = 10_000;
export const PRIKAZANIH_PREJSNJIH = 6;

type Shramba = { nastavitve: Nastavitve; zgodovina: Motivacija[] };
export type MotivacijaPogled = { nastavitve: Nastavitve; jutro: Motivacija | null; vecer: Motivacija | null; prejsnje: Motivacija[] };
export type Generator = (navodilo: Navodilo, root: string) => Promise<string | null>;
export type IzvorZapiskov = (root: string) => Promise<string>;
export type MotivacijaMoznosti = { zdaj?: Date; pas?: string; generiraj?: Generator; zapiski?: IzvorZapiskov };

const vrste = new Map<string, Promise<unknown>>();
async function vVrsti<T>(kljuc: string, delo: () => Promise<T>): Promise<T> {
  const prej = vrste.get(kljuc) ?? Promise.resolve();
  const to = prej.then(delo, delo);
  const rep = to.catch(() => undefined);
  vrste.set(kljuc, rep);
  try {
    return await to;
  } finally {
    if (vrste.get(kljuc) === rep) vrste.delete(kljuc);
  }
}

const TEME_VNOSA: readonly unknown[] = [...TEME, "zaključek"];

function jeMotivacija(v: unknown): v is Motivacija {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (
    jeKljucDneva(m.dan) &&
    (m.del === "jutro" || m.del === "vecer") &&
    TEME_VNOSA.includes(m.tema) &&
    typeof m.besedilo === "string" &&
    m.besedilo.length > 0 &&
    m.besedilo.length <= MOTIVACIJA_NAJVEC_ZNAKOV &&
    (m.vir === "model" || m.vir === "vnaprej") &&
    typeof m.ustvarjeno === "string"
  );
}

async function preberiShrambo(root: string): Promise<Shramba> {
  const surovo = await readJsonFile<unknown>(root, DATOTEKA_MOTIVACIJE).catch(() => null);
  const o = surovo && typeof surovo === "object" && !Array.isArray(surovo) ? (surovo as Record<string, unknown>) : {};
  const nastavitve: Nastavitve = {
    vklopljena: o.vklopljena !== false,
    vecer: o.vecer !== false,
    slog: (SLOGI as readonly unknown[]).includes(o.slog) ? (o.slog as Nastavitve["slog"]) : PRIVZETE_NASTAVITVE.slog,
    humor: (HUMORJI as readonly unknown[]).includes(o.humor) ? (o.humor as Nastavitve["humor"]) : PRIVZETE_NASTAVITVE.humor,
  };
  const seznam = Array.isArray(o.zgodovina) ? o.zgodovina.filter(jeMotivacija) : [];
  // En vnos na (dan, del), najnovejsi dan prvi, v dnevu vecer pred jutrom.
  const poKljucu = new Map<string, Motivacija>();
  for (const m of seznam) if (!poKljucu.has(`${m.dan}/${m.del}`)) poKljucu.set(`${m.dan}/${m.del}`, m);
  const zgodovina = [...poKljucu.values()]
    .sort((a, b) => b.dan.localeCompare(a.dan) || (a.del === b.del ? 0 : a.del === "vecer" ? -1 : 1))
    .slice(0, MOTIVACIJA_ZGODOVINA);
  return { nastavitve, zgodovina };
}

async function shrani(root: string, s: Shramba): Promise<void> {
  await writeJson(root, DATOTEKA_MOTIVACIJE, { ...s.nastavitve, zgodovina: s.zgodovina });
}

function pogled(s: Shramba, dan: string): MotivacijaPogled {
  const najdi = (del: Del) => s.zgodovina.find((m) => m.dan === dan && m.del === del) ?? null;
  return {
    nastavitve: s.nastavitve,
    jutro: najdi("jutro"),
    vecer: s.nastavitve.vecer ? najdi("vecer") : null,
    prejsnje: s.zgodovina.filter((m) => m.dan !== dan).slice(0, PRIKAZANIH_PREJSNJIH),
  };
}

/** Privzeti generator: model za pogovor z asistentko; brez nastavljenega modela ali ob napaki null. */
export const privzetiGenerator: Generator = async (navodilo, root) => {
  try {
    const brain = await pogovorBrain(root);
    if (!brain) return null;
    const odgovor = await callProvider({
      ...brain,
      text: navodilo.text,
      system: navodilo.system,
      maxTokens: 160,
      najvecZnakov: 600,
      timeoutMs: ROK_MODELA_MS,
      vsebinaKlica: false,
    });
    return odgovor.ok ? odgovor.text : null;
  } catch {
    return null;
  }
};

/** Privzeti izvor zapiskov: dejstva iz spomina (prazno, ce je spomin izklopljen). */
export const privzetiZapiski: IzvorZapiskov = async (root) => {
  try {
    return (await dejstvaZaModel(root)).map((d) => d.besedilo).join("; ");
  } catch {
    return "";
  }
};

/** Brez ustvarjanja: stanje za danasnji dan. */
export async function preberiMotivacijo(token: string | null, dir?: string, moznosti: MotivacijaMoznosti = {}): Promise<MotivacijaPogled> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return pogled(await preberiShrambo(root), kljucDneva(moznosti.zdaj ?? new Date(), moznosti.pas));
}

/** Popravek nastavitev (vklopljena, vecer, slog, humor); neveljaven popravek vrze, nic se ne shrani. */
export async function nastaviMotivacijo(popravek: unknown, token: string | null, dir?: string, moznosti: MotivacijaMoznosti = {}): Promise<MotivacijaPogled> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return vVrsti(root, async () => {
    const s = await preberiShrambo(root);
    const nove = zdruziNastavitve(s.nastavitve, popravek);
    if (!nove) throw new Error("Neveljavna nastavitev.");
    const naslednja: Shramba = { ...s, nastavitve: nove };
    await shrani(root, naslednja);
    return pogled(naslednja, kljucDneva(moznosti.zdaj ?? new Date(), moznosti.pas));
  });
}

/**
 * Misel za zdaj: ce za danasnji del dneva ze obstaja, jo vrne; sicer jo ustvari (model, nato vnaprej pripravljena) in shrani.
 * Zjutraj (pred 17. uro) nastane jutranja, zvecer vecerna (ce je vecer vklopljen); zgresene jutranje ne nadomesti vecer.
 */
export async function dnevnaMotivacija(token: string | null, dir?: string, moznosti: MotivacijaMoznosti = {}): Promise<MotivacijaPogled> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const zdaj = moznosti.zdaj ?? new Date();
  const dan = kljucDneva(zdaj, moznosti.pas);
  const del = delDneva(zdaj, moznosti.pas);
  return vVrsti(root, async () => {
    const s = await preberiShrambo(root);
    const jeze = s.zgodovina.some((m) => m.dan === dan && m.del === del);
    if (!s.nastavitve.vklopljena || jeze || (del === "vecer" && !s.nastavitve.vecer)) return pogled(s, dan);
    const prejsnjaBesedila = s.zgodovina.map((m) => m.besedilo);
    let besedilo: string | null = null;
    try {
      let zapiski = "";
      if (jeOsebnaMisel(s.nastavitve.slog, dan, del)) {
        try {
          zapiski = await (moznosti.zapiski ?? privzetiZapiski)(root);
        } catch {
          zapiski = "";
        }
      }
      const odgovor = await (moznosti.generiraj ?? privzetiGenerator)(sestaviNavodilo({ dan, del, humor: s.nastavitve.humor, zapiski }, prejsnjaBesedila), root);
      besedilo = ocistiOdgovorModela(odgovor, prejsnjaBesedila);
    } catch {
      besedilo = null;
    }
    const nova: Motivacija = {
      dan,
      del,
      tema: temaDneva(dan, del),
      besedilo: besedilo ?? izberiVnaprej(dan, prejsnjaBesedila, del),
      vir: besedilo ? "model" : "vnaprej",
      ustvarjeno: zdaj.toISOString(),
    };
    const naslednja: Shramba = { nastavitve: s.nastavitve, zgodovina: [nova, ...s.zgodovina].slice(0, MOTIVACIJA_ZGODOVINA) };
    await shrani(root, naslednja);
    return pogled(naslednja, dan);
  });
}
