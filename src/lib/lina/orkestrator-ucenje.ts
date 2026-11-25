/**
 * Adaptivno ucenje orkestratorja (zamisel LearnHarness: »kaj ze znas«, »preveri po koraku«; koda NI prevzeta - LearnHarness je AGPL).
 * Vmesnik UcenjeVmesnik je pogodba, skozi katero se priklopi tudi modul ucenje-lh (naloga 16, AGPL, locen; nalozi se dinamicno, ce obstaja).
 * Privzeta izvedba je Linino samoucenje (samoucenje-baza.server.ts): izkusnje so vrstice teme »izkusnje-<tip>«, vidne in izbrisljive
 * kot vsa naucena znanja, in veljajo samo ob vklopljenem samoucenju. Zapis gradi KODA iz strukturiranih polj (orodja, izid, dokaz),
 * nikoli iz prostega besedila modela ali orodja, da izkusnja ne postane trajni kanal vbrizga v naslednjo nalogo.
 */
import { isciZnanje, naucilSeJe } from "./samoucenje-baza.server.ts";

export type UcnaEnota = { naslov: string; besedilo: string; vir: string };

export type Izkusnja = {
  tip: string;
  izid: "uspeh" | "neuspeh" | "nepopolno";
  /** Orodja, ki so uspela, in orodja, ki so vrnila napako (samo imena iz registra). */
  delovalo: string[];
  ni: string[];
  /** Razlog ustavitve ali ocena samopregleda (stalna koda). */
  razlog: string;
  koraki: number;
  /** Dokaz: id naloge (dnevnik <podatki>/orkestrator/<id>.dnevnik.jsonl ima vsak klic z izidom). */
  naloga: string;
  cas: string;
};

export type PreverbaKoraka = { razumevanje: "ok" | "dvom"; opomba: string };

export interface UcenjeVmesnik {
  /** Pred korakom: ustrezne ucne enote in izkusnje za ta tip naloge. */
  predKorakom(v: { tip: string; cilj: string; korak: number }): Promise<UcnaEnota[]>;
  /** Po koraku: preverba izida koraka (napaka ali prazno = dvom). */
  poKoraku(v: { tip: string; korak: number; orodje: string; ok: boolean; dolzina: number }): Promise<PreverbaKoraka | null>;
  /** Po nalogi: zapis izkusnje z dokazom. */
  poNalogi(i: Izkusnja): Promise<void>;
}

/** Tip naloge = kljuc teme samoucenja; samo male crke, stevke in vezaj (ista oblika kot teme Learn Anything). */
export function normirajTip(tip: unknown): string {
  const t = typeof tip === "string" ? tip.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) : "";
  return t || "splosno";
}

export function temaIzkusenj(tip: string): string {
  return `izkusnje-${normirajTip(tip)}`;
}

/** Besedilo izkusnje sestavi koda iz polj (brez prostega besedila). */
export function besediloIzkusnje(i: Izkusnja): string {
  const imena = (s: string[]) => s.filter((x) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(x)).slice(0, 12).join(", ") || "-";
  return `Izid: ${i.izid}. Razlog: ${i.razlog.replace(/[^a-z0-9-]/gi, "").slice(0, 40)}. Korakov: ${Math.max(0, Math.floor(i.koraki))}. ` +
    `Delovalo: ${imena(i.delovalo)}. Ni delovalo: ${imena(i.ni)}.` +
    (/^o-[a-f0-9]{16}$/.test(i.naloga) ? ` Dokaz: dnevnik naloge ${i.naloga}.` : "");
}

const NAJVEC_IZKUSENJ_NA_TIP = 10;

export function ucenjeSamoucenje(dir?: string): UcenjeVmesnik {
  const zadnje = new Map<string, Array<{ naslov: string; besedilo: string; url: string }>>();
  return {
    async predKorakom({ tip }) {
      const tema = temaIzkusenj(tip);
      // FTS isce po besedah; »Izid« je v vsaki izkusnji, zato poizvedba vrne izkusnje teme ne glede na cilj
      const z = await isciZnanje("Izid", { dir, tema, najvec: 5 }).catch(() => []);
      return z.map((p) => ({ naslov: p.naslov, besedilo: p.besedilo, vir: `samoucenje:${tema}` }));
    },
    async poKoraku({ ok, dolzina }) {
      return ok && dolzina > 0 ? { razumevanje: "ok", opomba: "izid je" } : { razumevanje: "dvom", opomba: ok ? "prazen izid" : "napaka orodja" };
    },
    async poNalogi(i) {
      const tema = temaIzkusenj(i.tip);
      // naucilSeJe zamenja vse vrstice teme: obdrzimo zadnjih N (iz pomnilnika in baze)
      const prej = zadnje.get(tema) ?? (await isciZnanje("Izid", { dir, tema, najvec: NAJVEC_IZKUSENJ_NA_TIP }).catch(() => [])).map((p) => ({ naslov: p.naslov, besedilo: p.besedilo, url: "" }));
      const nova = [{ naslov: `Izkusnja ${i.cas.slice(0, 16)}`, besedilo: besediloIzkusnje(i), url: "" }, ...prej].slice(0, NAJVEC_IZKUSENJ_NA_TIP);
      const r = await naucilSeJe(tema, nova, { dir }).catch(() => ({ zapisano: false as const }));
      if (r.zapisano) zadnje.set(tema, nova);
    },
  };
}

/**
 * Modul ucenje-lh (naloga 16) se priklopi, ce obstaja in izvozi `ucenjeOrkestratorja(dir)`, ki vrne UcenjeVmesnik. Dinamicen uvoz:
 * zastavica gradnje lahko modul izpusti, Lina pa dela enako (privzeto samoucenje). Pogodbo preverja orkestrator.test.ts.
 */
// shortcut: pot v spremenljivki (tsc in vite modula ne zahtevata); ko naloga 16 modul doda, ga vpisi v gradnjo kot izbirni vhod
const POT_UCENJE_LH = "./ucenje-lh/index.ts";
export async function izberiUcenje(dir?: string, nalozi: () => Promise<unknown> = () => import(/* @vite-ignore */ POT_UCENJE_LH)): Promise<UcenjeVmesnik> {
  try {
    const m = (await nalozi()) as { ucenjeOrkestratorja?: (dir?: string) => UcenjeVmesnik };
    if (typeof m.ucenjeOrkestratorja === "function") {
      const u = m.ucenjeOrkestratorja(dir);
      if (u && typeof u.predKorakom === "function" && typeof u.poKoraku === "function" && typeof u.poNalogi === "function") return u;
    }
  } catch {
    /* modula ni (se ni narejen ali izpuscen v gradnji) */
  }
  return ucenjeSamoucenje(dir);
}
