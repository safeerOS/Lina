/**
 * Adaptivno ucenje orkestratorja (zamisel LearnHarness: »kaj ze znas«, »preveri po koraku«; koda NI prevzeta - LearnHarness je AGPL).
 * Vmesnik UcenjeVmesnik je pogodba, skozi katero se priklopi modul ucenje-lh (naloga 16, AGPL, locen) PREK ucenje-lh-vrata.server.ts
 * (naloga 8): izkusnje in ucne enote lastnika so v ucenje-lh.json. Brez modula (zastavica LINA_BREZ_UCENJA_LH) je izvedba Linino samoucenje (samoucenje-baza.server.ts): izkusnje so vrstice teme »izkusnje-<tip>«, vidne in izbrisljive
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
    `Delovalo: ${imena(i.delovalo)}. Ni delovalo: ${imena(i.ni)}.`;
}

const NAJVEC_IZKUSENJ_NA_TIP = 10;

/** Preprosta preverba po koraku (napaka ali prazen izid = dvom); pravo preverbo razumevanja bi rabila klic modela (ni narejeno). */
async function preverbaKoraka({ ok, dolzina }: { ok: boolean; dolzina: number }): Promise<PreverbaKoraka> {
  return ok && dolzina > 0 ? { razumevanje: "ok", opomba: "izid je" } : { razumevanje: "dvom", opomba: ok ? "prazen izid" : "napaka orodja" };
}

export function ucenjeSamoucenje(dir?: string): UcenjeVmesnik {
  const zadnje = new Map<string, Array<{ naslov: string; besedilo: string; url: string }>>();
  return {
    async predKorakom({ tip }) {
      const tema = temaIzkusenj(tip);
      // FTS isce po besedah; »Izid« je v vsaki izkusnji, zato poizvedba vrne izkusnje teme ne glede na cilj
      const z = await isciZnanje("Izid", { dir, tema, najvec: 5 }).catch(() => []);
      return z.map((p) => ({ naslov: p.naslov, besedilo: p.besedilo, vir: `samoucenje:${tema}` }));
    },
    poKoraku: preverbaKoraka,
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

type VrataLH = Pick<typeof import("./ucenje-lh-vrata.server.ts"), "ucenjeLHZaNalogo" | "ucenjeLHZapisiIzkusnjo">;

/**
 * UcenjeVmesnik nad modulom ucenje-lh (prek vrat). Stikalo modula se preveri ob vsakem klicu (izklop = nic v kontekst, nic zapisano).
 * Besedilo izkusnje sestavi ta koda iz polj (besediloIzkusnje), modul ga samo hrani.
 */
export function ucenjeLHOrkestratorja(vrata: VrataLH, dir?: string): UcenjeVmesnik {
  return {
    async predKorakom({ tip, cilj }) {
      const z = (await vrata.ucenjeLHZaNalogo(dir, normirajTip(tip), String(cilj ?? "").slice(0, 2000))) ?? [];
      return z.map((p) => ({ naslov: p.naslov, besedilo: p.besedilo, vir: `ucenje-lh:${temaIzkusenj(tip)}` }));
    },
    poKoraku: preverbaKoraka,
    async poNalogi(i) {
      await vrata.ucenjeLHZapisiIzkusnjo(dir, { tip: normirajTip(i.tip), naslov: `Izkusnja ${String(i.cas).slice(0, 19)}`, besedilo: besediloIzkusnje(i) });
    },
  };
}

/** Privzeto: modul ucenje-lh prek vrat, ce je nalozen (z zastavico gradnje ga ni -> {} -> samoucenje). */
async function naloziUcenjeLH(): Promise<unknown> {
  const v = await import("./ucenje-lh-vrata.server.ts");
  return (await v.ucenjeLHZaOrkestrator()) ? { ucenjeOrkestratorja: (dir?: string) => ucenjeLHOrkestratorja(v, dir) } : {};
}

/**
 * Izbira ucenja: `ucenjeOrkestratorja(dir)` iz nalagalnika (privzeto modul ucenje-lh prek vrat), sicer samoucenje. Pogodbo preverja
 * orkestrator.test.ts, priklop naloga-8-priklop-ucenja.test.ts.
 */
export async function izberiUcenje(dir?: string, nalozi: () => Promise<unknown> = naloziUcenjeLH): Promise<UcenjeVmesnik> {
  try {
    const m = (await nalozi()) as { ucenjeOrkestratorja?: (dir?: string) => UcenjeVmesnik | Promise<UcenjeVmesnik> };
    if (typeof m.ucenjeOrkestratorja === "function") {
      const u = await m.ucenjeOrkestratorja(dir);
      if (u && typeof u.predKorakom === "function" && typeof u.poKoraku === "function" && typeof u.poNalogi === "function") return u;
    }
  } catch {
    /* modula ni (izpuscen v gradnji) ali se ne nalozi */
  }
  return ucenjeSamoucenje(dir);
}
