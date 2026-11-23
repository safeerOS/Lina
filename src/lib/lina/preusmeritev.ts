/**
 * Dovoljene smeri za preusmeritev. Privzeto samo slovenske +386
 * mobilne in stacionarne. Dodatne predpone da lastnik, niso obvezne.
 * Znane premijske in satelitske smeri ostanejo zaprte tudi, ce jih kdo dopise.
 */
import { vE164 } from "./plast.ts";

const SATELIT = /^(?:870|881|882|883|979)/;
const PREMIJA = /^(?:44(?:9|70|84|87|56)|49(?:900|137|138|180)|39899|385(?:60|61|64|65|69)|43(?:900|901|930|931)|41(?:900|901|906)|3389|34(?:803|806|807|905)|1(?:900|876|809|829|849|264))/;

function stevke(e164: string): string {
  return e164.replace(/\D/g, "");
}

/** Slovenska mobilna ali stacionarna: 8 stevk za 386, brez 89, 90 in 080. */
export function jeSlovenskaDovoljena(e164: string): boolean {
  const d = stevke(e164);
  if (!d.startsWith("386")) return false;
  const nacionalna = d.slice(3);
  if (!/^\d{8}$/.test(nacionalna)) return false;
  if (/^(?:80|89|90)/.test(nacionalna)) return false;
  if (/^(?:30|31|40|41|51|64|65|68|69|70|71)/.test(nacionalna)) return true;
  return /^[123457]/.test(nacionalna);
}

function predpone(seznam: string | undefined): string[] {
  if (!seznam) return [];
  return seznam
    .split(/[,;\s]+/)
    .map((kos) => kos.replace(/\D/g, ""))
    .filter((kos) => kos.length >= 1 && kos.length <= 4);
}

function jeVednoZaprta(d: string): boolean {
  return SATELIT.test(d) || PREMIJA.test(d);
}

/**
 * True, ce stevilke ne smemo zvati. Prazno ali neveljavno je zavrnjeno.
 * dodatne so predpone iz nastavitve, na primer 44.
 */
export function jePremiumAliKratka(e164: string, dodatne = ""): boolean {
  const d = stevke(e164);
  if (d.length < 10 || d.length > 15) return true;
  if (jeVednoZaprta(d)) return true;
  if (d.startsWith("386")) return !jeSlovenskaDovoljena(e164);
  return !predpone(dodatne).some((predpona) => predpona !== "386" && d.startsWith(predpona));
}

/** True, ce stevilke ne smemo zvati. Neveljavna oblika steje kot zavrnjena. */
export function jeNedovoljenaPreusmeritev(value: string, dodatne = ""): boolean {
  const e164 = vE164(value);
  if (!e164) return true;
  return jePremiumAliKratka(e164, dodatne);
}
