/**
 * Klici, ki jih je sprejela Lina na telefonu (naloga 17, lastnik 25. 11. 2026): zapis iz sinhronizacije v obliko klica za zaslon Klici
 * in zapisek. Cista logika brez diska. Zapis je nezaupan (tudi star zapis v sinhron-telefon.json): napaka = null, ne izjema.
 */
import { emptyOrder } from "./brain.ts";
import { normalizirajTelefon } from "./imenik.ts";
import type { CallSession } from "./types.ts";

/** Zapis klica s telefona v sinhronizaciji (sinhron-telefon.server.ts ga preveri). Tu, ker ta modul uvaza pot klica (service.server.ts). */
export type IzmenjavaSinhron = { govorec: "klicatelj" | "lina"; cas: number; besedilo: string };
export type KlicSinhron = {
  id: string;
  casZacetka: number;
  stevilka: string;
  trajanjeS: number;
  nujno: boolean;
  povzetek: string;
  nacin: "osebna" | "podjetje";
  klicatelj: string;
  podjetje: string;
  sporocilo: string;
  sporociloDobesedno: string;
  brezSporocilaRazlog: string;
  /** Celoten prepis pogovora (telefon 0.2.14); starejsi zapisi ga nimajo (polja ni). */
  prepisPogovora?: IzmenjavaSinhron[];
  prepisOkrnjen?: boolean;
};

/** Id klica s telefona na racunalniku; klici racunalnika (Twilio CA..., pisarna-...) te predpone nimajo. */
export const PREDPONA_KLICA_TELEFONA = "s-telefona-";
const DAN_MS = 86_400_000;

function iso(ms: unknown): string | null {
  if (typeof ms !== "number") return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Ime iz imenika racunalnika za stevilko (prazno, ce stika ni); kratke ali skrite stevilke se ne iscejo. */
export function imeVImeniku(stiki: ReadonlyArray<{ ime: string; telefon: string }>, stevilka: string): string {
  const tel = normalizirajTelefon(String(stevilka ?? ""));
  if (tel.replace(/\D/g, "").length < 6) return "";
  return stiki.find((s) => s.telefon === tel)?.ime ?? "";
}

/** Podjetniski klic po roku hrambe zapisov (zapiskiHrambaDni, enako kot zapisek na racunalniku); osebni klici ostanejo do izbrisa. */
export function potekelKlicTelefona(k: Pick<KlicSinhron, "nacin" | "casZacetka"> | null | undefined, rokDni: number, zdaj: number): boolean {
  return !!k && k.nacin === "podjetje" && zdaj - k.casZacetka > Math.max(1, rokDni) * DAN_MS;
}

export function klicIzTelefona(k: KlicSinhron, imeImenik: string, zapisek?: string): CallSession | null {
  try {
    if (!k || typeof k !== "object" || typeof k.id !== "string" || typeof k.stevilka !== "string") return null;
    const zacetek = iso(k.casZacetka);
    if (!zacetek) return null;
    const konec = iso(k.casZacetka + (Number.isSafeInteger(k.trajanjeS) ? k.trajanjeS : 0) * 1000) ?? zacetek;
    const ime = imeImenik || (typeof k.klicatelj === "string" ? k.klicatelj : "");
    const order = emptyOrder(k.stevilka);
    order.customerName = ime;
    order.phone = k.stevilka;
    order.podjetjeKlicatelja = k.podjetje || undefined;
    order.tajnica = { sporocilo: k.sporocilo ?? "", ...(k.sporociloDobesedno ? { izrek: k.sporociloDobesedno } : {}), razlog: "", nujno: k.nujno === true, nujnostZnana: true };
    if (k.brezSporocilaRazlog) order.oznaka = k.brezSporocilaRazlog;
    const transcript = (Array.isArray(k.prepisPogovora) ? k.prepisPogovora : []).map((v) => ({
      role: v.govorec === "lina" ? ("lina" as const) : ("stranka" as const),
      text: String(v.besedilo),
      at: iso(v.cas) ?? zacetek,
    }));
    return {
      callSid: `${PREDPONA_KLICA_TELEFONA}${k.id}`,
      from: k.stevilka,
      startedAt: zacetek,
      updatedAt: konec,
      status: "zakljucen",
      transcript,
      order,
      ...(k.trajanjeS < 10 ? { kratek: true } : {}),
      ...(k.nacin === "podjetje" ? {} : { nacin: "osebna" as const }),
      izvor: "telefon",
      ...(k.prepisOkrnjen ? { prepisOkrnjen: true } : {}),
      ...(zapisek ? { zapisek } : {}),
      povzetek: { kdo: ime || k.stevilka, zelel: k.povzetek ?? "", obljubila: "", narediti: "", nujno: k.nujno === true, sporocilo: k.sporocilo ?? "", cas: zacetek },
    };
  } catch {
    return null;
  }
}
