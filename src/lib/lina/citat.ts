/**
 * Pogoj dobesednosti (Mercury C, lastnik 15. 11. 2026): podatek, ki ga model izlusci iz besedila strani in ki naj bi se
 * zapisal kot dejstvo (ime, telefon, e-posta, naslov, ure, izdelek), se ne zapise, ce ga ni DOBESEDNO v besedilu, ki ga je
 * model dobil. Model povzema in lahko izmisli; koda preveri. Isto pravilo za klic ze izvajata potrdiPoljaLive (service.server.ts)
 * in dobesedna preverba v osebna-razumevanje.server.ts; tu je manjkajoci del za spletno stran.
 *
 * Opis (prosto besedilo povzetka) se ne preverja dobesedno, ker je povzetek; zanj veljajo varovala cen in vrinjenih navodil.
 */
import { fold } from "./guards.ts";
import type { Predlog } from "./types.ts";

function pomembneBesede(besedilo: string): string[] {
  return fold(besedilo)
    .split(/[^a-z0-9@]+/)
    .filter((b) => b.length >= 3);
}

function nizStevilk(besedilo: string): string[] {
  return besedilo.match(/\d+/g) ?? [];
}

/** Isti koren: enaki ali se razlikujeta samo v koncnici (hrast/hrasta, miza/mize): skupna predpona vsaj 3 in vsaj krajsa beseda - 1. */
export function istiKoren(a: string, b: string): boolean {
  if (a === b) return true;
  const najmanj = Math.min(a.length, b.length);
  let n = 0;
  while (n < najmanj && a[n] === b[n]) n++;
  return n >= Math.max(3, najmanj - 1);
}

/**
 * Pomembne besede vrednosti (dolzina >= 3, brez stresic) so v viru v ISTEM vrstnem redu, ena tik za drugo (tudi v drugem sklonu).
 * M2 N7: prej je zadostovala vsaka beseda posebej, zato je bilo »Mizarstvo Kovac« dobesedno iz »Mizarstvo Les ... Kovac«.
 */
export function besedeSoVViru(vrednost: string, vir: string): boolean {
  const delci = pomembneBesede(vrednost);
  if (delci.length === 0) return false;
  const besede = pomembneBesede(vir);
  for (let i = 0; i + delci.length <= besede.length; i++) {
    if (delci.every((d, k) => istiKoren(d, besede[i + k]))) return true;
  }
  return false;
}

/**
 * Seznam (naslov z vejicami, materiali »hrast, oreh« ali »hrast in oreh«): vsak del posebej mora biti v viru zaporedoma, deli med seboj
 * ne (v viru so lahko loceni z drugim besedilom). Zaporedje znotraj dela ostane strogo (M2 N7).
 */
function deliSoVViru(vrednost: string, vir: string): boolean {
  const deli = vrednost.split(/[,;|\n]+|\s+(?:in|ali|and|und|oder)\s+/i).map((d) => d.trim()).filter(Boolean);
  return deli.length > 0 && deli.every((d) => besedeSoVViru(d, vir));
}

/** Vsako zaporedje stevk vrednosti je tudi zaporedje stevk v viru (ure, hisne stevilke, kolicine). */
export function stevilkeSoVViru(vrednost: string, vir: string): boolean {
  const iz = nizStevilk(vrednost);
  if (iz.length === 0) return false;
  const v = new Set(nizStevilk(vir).map((s) => s.replace(/^0+(?=\d)/, "")));
  return iz.every((s) => v.has(s.replace(/^0+(?=\d)/, "")));
}

/** Telefonu podobno zaporedje v viru: stevke, ki jih locujejo samo presledek, oklepaj, vezaj, poševnica ali pika med stevkama. */
const TELEFONSKI_NIZ = /\+?\d(?:\d|[ ()\-/]|\.(?=\d))*/g;

/**
 * Telefon: vse stevke so v ENEM telefonu podobnem zaporedju v viru (tudi brez zacetne 0 ali s +386 namesto 0).
 * M2 N7: prej so se stevke iskale v zlepljenem nizu vseh stevk strani, zato je »555 09 00 8 00 1« nastal iz razlicnih stevilk.
 */
export function telefonJeVViru(vrednost: string, vir: string): boolean {
  const cifre = vrednost.replace(/\D/g, "");
  if (cifre.length < 6) return false;
  const brez0 = cifre.replace(/^0+/, "");
  const brez386 = cifre.replace(/^386/, "");
  const nizi = (vir.match(TELEFONSKI_NIZ) ?? []).map((n) => n.replace(/\D/g, ""));
  return nizi.some((n) => n.includes(cifre) || (brez0.length >= 6 && n.includes(brez0)) || (brez386.length >= 6 && n.includes(brez386)));
}

export function epostaJeVViru(vrednost: string, vir: string): boolean {
  const e = vrednost.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && vir.toLowerCase().includes(e);
}

/** Ena vrstica stika: e-posta, telefon ali naslov. */
function vrsticaStikaJeVViru(vrstica: string, vir: string): boolean {
  if (vrstica.includes("@")) return epostaJeVViru(vrstica, vir);
  const stevke = vrstica.replace(/\D/g, "");
  if (stevke.length >= 8 && !/\p{L}/u.test(vrstica)) return telefonJeVViru(vrstica, vir);
  return deliSoVViru(vrstica, vir) && (nizStevilk(vrstica).length === 0 || stevilkeSoVViru(vrstica, vir));
}

/**
 * Predlog brez polj, ki jih ni dobesedno v viru. Vrne se kopija; imena zavrnjenih polj so za dnevnik (brez vsebine).
 */
export function preveriCitate(predlog: Predlog, vir: string): { predlog: Predlog; zavrnjeno: string[] } {
  const zavrnjeno: string[] = [];
  const p = predlog.podjetje;
  let ime = p.ime;
  if (ime && !besedeSoVViru(ime, vir)) {
    ime = "";
    zavrnjeno.push("ime");
  }
  const stik = p.stik
    .split(/\n+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .filter((v) => {
      const ok = vrsticaStikaJeVViru(v, vir);
      if (!ok) zavrnjeno.push("stik");
      return ok;
    })
    .join("\n");
  let ure = p.ure;
  if (ure) {
    const ok = nizStevilk(ure).length > 0 ? stevilkeSoVViru(ure, vir) : deliSoVViru(ure, vir);
    if (!ok) {
      ure = "";
      zavrnjeno.push("ure");
    }
  }
  let material = p.material;
  if (material && !deliSoVViru(material, vir)) {
    material = "";
    zavrnjeno.push("material");
  }
  const vrstice = predlog.vrstice
    .filter((v) => {
      const ok = besedeSoVViru(v.ime, vir);
      if (!ok) zavrnjeno.push("izdelek");
      return ok;
    })
    .map((v) => {
      if (v.material && !deliSoVViru(v.material, vir)) {
        zavrnjeno.push("material");
        return { ...v, material: "" };
      }
      return v;
    });
  return { predlog: { ...predlog, podjetje: { ...p, ime, stik, ure, material }, vrstice }, zavrnjeno };
}
