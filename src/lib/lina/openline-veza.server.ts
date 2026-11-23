/**
 * Vezava poti klicev (OpenLine) za asistentko Line (#17: ob »Poveži telefon« se OpenLine zažene sam, uporabnik ne vpiše nič).
 * Zagon programa (zagon.server.ts) vpiše to vezavo z registrirajVezoKlicev (asistent-telefon.server.ts). Modul je namenoma LOČEN od
 * asistent-telefon.server.ts in ga ne uvaža (struktura tipa je prepisana), da pot telefona ne uvaža poti klica in obratno.
 *
 * Napake zagona so v modulu zagona kratke kode (brez skrivnosti); tukaj postanejo kratka slovenska sporočila za zaslon.
 * Sporočilo nikoli ne vsebuje besedila izvirne napake (lahko bi imelo pot ali podatek iz okolja).
 */
import { pripraviGlasTelefonaZaOpenLine } from "./glas-telefon.server.ts";
import { privzeteOdvisnosti, ustaviOpenLine, zagotoviOpenLine, type Odvisnosti } from "./openline-zagon.server.ts";

/** Enaka oblika kot VezaKlicev v asistent-telefon.server.ts (tip je prepisan, da modula ne uvažamo drug v drugega). */
export type VezaKlicevOpenLine = {
  zagotovi: (root: string, naslov: string) => Promise<void>;
  ustavi: () => Promise<void>;
};

const OBCE_SPOROCILO = "OpenLine se ni zagnal";

const SPOROCILA: Readonly<Record<string, string>> = Object.freeze({
  naslov: "računalnik nima zasebnega naslova v domačem omrežju",
  "OpenLine ni v paketu": "OpenLine ni v programu (manjka paket)",
  vrata: "ni prostih vrat za OpenLine",
  izpis: "OpenLine je izpisal nepričakovane podatke",
  "OpenLine se ni pripravil": "OpenLine se ni pripravil pravočasno",
  "glas telefona": "glas telefona se ni zagnal",
  odvisnost: "notranja napaka priprave",
});

/** Kratka koda napake zagona -> kratko slovensko sporočilo; vse neznano v obče sporočilo (brez besedila izvirne napake). */
export function slovenskoSporociloOpenLine(napaka: unknown): string {
  const koda = napaka instanceof Error ? napaka.message : "";
  return Object.prototype.hasOwnProperty.call(SPOROCILA, koda) ? SPOROCILA[koda]! : OBCE_SPOROCILO;
}

/**
 * Naredi vezavo za zagon programa. Koren paketa OpenLine pride iz okolja LINA_OPENLINE_DIR (nastavi ga lupina programa);
 * brez njega zagon OpenLine ne uspe z jasnim sporočilom in ostalo (glas telefona, pogovor) deluje naprej.
 * `delne` je samo za preizkuse.
 */
export function ustvariVezoKlicev(delne?: Partial<Odvisnosti>): VezaKlicevOpenLine {
  const pripraviLinoPrivzeto: Odvisnosti["pripraviLino"] = async (root) => {
    try {
      return await pripraviGlasTelefonaZaOpenLine(root);
    } catch {
      // besedilo izvirne napake gre lahko iz strežnika glasu; na zaslon ne sme
      throw new Error("glas telefona");
    }
  };
  const odv = privzeteOdvisnosti({
    pripraviLino: pripraviLinoPrivzeto,
    korenOpenLine: () => process.env.LINA_OPENLINE_DIR || null,
    ...delne,
  });
  return {
    zagotovi: async (root, naslov) => {
      try {
        await zagotoviOpenLine(root, naslov, odv);
      } catch (napaka) {
        throw new Error(slovenskoSporociloOpenLine(napaka));
      }
    },
    ustavi: () => ustaviOpenLine(),
  };
}
