/**
 * Razpored z varovalkami (Mercury E, lastnik 15. 11. 2026): samo CISTO PRAVILO za povratni klic in jutranji povzetek zgresenih
 * klicev; vezava na izvajalca ni del te naloge. Zamisel je iz Mercury Agenta (razpored s politiko zamujenega zagona in zavrnitvijo
 * prikrivanja), pravila so lastna.
 * - Razpored vedno obvesti lastnika: stikala za izklop obvestila ni, vnos »obvestiLastnika: false« se prepise.
 * - Besedilo, ki prosi za prikrivanje pred lastnikom, se zavrne (razpored je vedno viden lastniku).
 * - Politika zamujenega zagona: privzeto »skip« (zamujen opomnik se ne sprozi pozno), »run_once« samo ce je izrecno izbrana.
 * - Zapis razporeda gre prek atomarnega writeJson (store.server.ts: temp + fsync + rename); tu zapisa ni.
 */
import { zaznajVbrizg } from "./vbrizg.ts";
import { jeSkrivnost } from "./spomin.ts";
import { fold } from "./guards.ts";

export type PolitikaZamujenega = "skip" | "run_once";
export type VrstaRazporeda = "povratni-klic" | "jutranji-povzetek";

export type Razpored = {
  vrsta: VrstaRazporeda;
  opis: string;
  /** ISO cas zagona. */
  ob: string;
  politika: PolitikaZamujenega;
  /** Vedno true: razpored lastnika vedno obvesti. */
  obvestiLastnika: true;
};

export const NAJVEC_ZNAKOV_OPISA = 200;
export const NAJVEC_PRIHODNOSTI_MS = 366 * 24 * 3_600_000;
/** Zagon, zamujen do te meje, se se izvede; poznejsi velja za zamujen zagon. */
export const TOLERANCA_ZAGONA_MS = 5 * 60_000;

const PRIKRIVANJE =
  /\b(?:na\s+skrivaj|skrivaj\w*|prikrij\w*|brez\s+(?:da\s+bi\s+)?(?:obvestil\w*|vedenja)\s+(?:lastnik\w*|uporabnik\w*)|secretly|silently|covertly|without\s+(?:telling|notifying|informing)\s+(?:the\s+)?(?:user|owner)|hide\s+(?:this\s+)?from\s+(?:the\s+)?(?:user|owner))\b/;

/** Ali besedilo prosi za prikrivanje pred lastnikom (sl, en). Vzorec vbrizga »ne povej lastniku« prav tako. */
export function prosiZaPrikrivanje(besedilo: string): boolean {
  const v = fold(besedilo).replace(/[^a-z0-9]+/g, " ");
  return PRIKRIVANJE.test(v) || zaznajVbrizg(besedilo).vzorci.includes("prikrij-lastniku");
}

export type PreverbaRazporeda = { ok: true; razpored: Razpored } | { ok: false; razlog: "vrsta" | "opis" | "prikrivanje" | "skrivnost" | "cas" };

export function preveriRazpored(vnos: { vrsta?: unknown; opis?: unknown; ob?: unknown; politika?: unknown; obvestiLastnika?: unknown }, zdaj: number): PreverbaRazporeda {
  if (vnos.vrsta !== "povratni-klic" && vnos.vrsta !== "jutranji-povzetek") return { ok: false, razlog: "vrsta" };
  const opis = typeof vnos.opis === "string" ? vnos.opis.replace(/\s+/g, " ").trim() : "";
  if (!opis || opis.length > NAJVEC_ZNAKOV_OPISA) return { ok: false, razlog: "opis" };
  if (prosiZaPrikrivanje(opis)) return { ok: false, razlog: "prikrivanje" };
  if (jeSkrivnost(opis)) return { ok: false, razlog: "skrivnost" };
  const cas = typeof vnos.ob === "string" ? Date.parse(vnos.ob) : NaN;
  if (!Number.isFinite(cas) || cas <= zdaj || cas - zdaj > NAJVEC_PRIHODNOSTI_MS) return { ok: false, razlog: "cas" };
  return {
    ok: true,
    razpored: {
      vrsta: vnos.vrsta,
      opis,
      ob: new Date(cas).toISOString(),
      // Neznana politika je »skip«: zamujen opomnik se ne sprozi pozno brez izrecne izbire.
      politika: vnos.politika === "run_once" ? "run_once" : "skip",
      obvestiLastnika: true,
    },
  };
}

export type OdlocitevZagona = { odlocitev: "pocakaj" | "zazeni" | "preskoci"; obvestiLastnika: true };

/** Kaj z razporedom ob dani uri: zamujen zagon se po politiki preskoci ali izvede enkrat; lastnik je obvescen v obeh primerih. */
export function odlociZagon(r: Pick<Razpored, "ob" | "politika">, zdaj: number, tolerancaMs = TOLERANCA_ZAGONA_MS): OdlocitevZagona {
  const cas = Date.parse(r.ob);
  if (!Number.isFinite(cas)) return { odlocitev: "preskoci", obvestiLastnika: true };
  if (zdaj < cas) return { odlocitev: "pocakaj", obvestiLastnika: true };
  if (zdaj - cas <= tolerancaMs) return { odlocitev: "zazeni", obvestiLastnika: true };
  return { odlocitev: r.politika === "run_once" ? "zazeni" : "preskoci", obvestiLastnika: true };
}
