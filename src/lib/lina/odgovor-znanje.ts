import { dejstvaKataloga, fold, imaRok, imaZnesek, vprasaPoCeni } from "./guards.ts";
import { razlogPolja, razlogTeme } from "./plast.ts";
import type { Catalog } from "./types.ts";

/**
 * Preverba odgovora modela iz znanja (lastnik 11. 11. 2026). Seznam DOVOLJENEGA: odgovor velja samo, ce izpolni VSE
 * pogoje; karkoli drugega zavrne koda in Lina reče stalni stavek iz pravil. Model nikoli ne odloca, kaj klicatelj slisi.
 */
export const MEJA_ODGOVORA = 300;

const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"']+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:si|com|eu|net|org|de|at|hr|it|io|info|biz)\b(?:\/[^\s<>"']*)?/gi;
const EPOSTA_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const OBLJUBA = /\b(obljub\w*|zagotavlj\w*|zagotovo|garantir\w*|gotovo|brez skrbi|vsekakor)\b/;

function brezKoncnihLoc(vrednost: string): string {
  return vrednost.replace(/[.,;:!?)\]]+$/g, "").toLowerCase();
}

function naslovi(text: string): string[] {
  const posta = (text.match(EPOSTA_RE) ?? []).map(brezKoncnihLoc);
  const brezPoste = text.replace(EPOSTA_RE, " ");
  const url = (brezPoste.match(URL_RE) ?? []).map(brezKoncnihLoc);
  return [...posta, ...url];
}

/** Vrstni red cifer brez vodilnih nicel: »09« in »9« je ista stevka. */
function stevka(niz: string): string {
  return niz.replace(/^0+(?=\d)/, "");
}

/** Vsaka skupina cifer. */
function skupine(text: string): string[] {
  return (text.match(/\d+/g) ?? []).map(stevka);
}

/** Telefonu podobna vrsta (7 ali vec cifer z locili): cifre morajo biti v istem vrstnem redu tudi v viru. */
function telefoni(text: string): string[] {
  return (text.match(/\+?\d[\d ()\-./]{5,}\d/g) ?? []).map((m) => m.replace(/\D/g, "")).filter((c) => c.length >= 7);
}

/** Dnevni razponi (»od ponedeljka do petka«) niso rok: pred preverbo roka se odstranijo. */
function brezDnevnihRazponov(text: string): string {
  const dan = "(?:ponedeljk\\w*|tork\\w*|sred\\w*|cetrtk\\w*|petk\\w*|sobot\\w*|nedelj\\w*)";
  return fold(text).replace(new RegExp(`\\bod\\s+${dan}\\s+do\\s+${dan}`, "g"), " ");
}

/** Besedilo, iz katerega sme odgovor povzeti cifre in naslove: znanje in katalog. */
export function virOdgovora(katalog: Catalog): string {
  return `${katalog.znanje ?? ""}\n${dejstvaKataloga(katalog)}`;
}

/**
 * Vrne ociscen odgovor ali null. Null pomeni: Lina reče stalni stavek.
 * (a) najvec 300 znakov; (b) brez denarnega signala, roka, garancije, dostave in obljube;
 * (c) vsaka stevilka (ura, telefon, hisna stevilka) je tudi v znanju ali katalogu;
 * (d) noben URL ali e-naslov, ki ga ni v znanju ali katalogu.
 */
export function preveriOdgovorZnanja(odgovor: string, katalog: Catalog): string | null {
  const o = odgovor.replace(/\s+/g, " ").trim();
  if (!o || o.length > MEJA_ODGOVORA) return null;
  // Oznake, ki bi jih glas prebral na glas, in zaklepaji JSON niso del odgovora.
  if (/[{}<>`]|\bhttps?:\/\/\s/.test(o)) return null;

  if (imaZnesek(o) || vprasaPoCeni(o) || razlogPolja("odgovor", o) || razlogTeme(o)) return null;
  if (imaRok(brezDnevnihRazponov(o)) || OBLJUBA.test(fold(o))) return null;

  const vir = virOdgovora(katalog);
  const virSkupine = new Set(skupine(vir));
  for (const s of skupine(o)) if (!virSkupine.has(s)) return null;
  const virCifre = vir.replace(/\D/g, "");
  for (const tel of telefoni(o)) if (!virCifre.includes(tel)) return null;

  const virNaslovi = new Set(naslovi(vir));
  for (const n of naslovi(o)) if (!virNaslovi.has(n)) return null;
  return o;
}

const ENOTA_CASA = "(?:dan|dni|dneva|dnevi|dnevih|dneh|teden|tedna|tedne|tedni|tednov|tednih|tednu|mesec|meseca|mesece|mesecev|mesecih|mesecu|ur|ure|uri|urah|minut\\w*|let|leta|leti)";
const STEVILO_ALI_BESEDA =
  "(?:\\d+|en|ena|eno|dva|dve|tri|stiri|pet|sest|sedem|osem|devet|deset|enajst|dvanajst|trinajst|petnajst|dvajset|trideset|nekaj|par|vec|kakih|okoli|tja do)";
const OBVEZNOST_ROKA = /\b(izdela\w*|izdelov\w*|traja\w*|trajanje|narejen\w*|pripravljen\w*|dobav\w*|dostav\w*|opravim\w*|dokonc\w*|zakljuc\w*|rok\w*|cakat\w*|pocakat\w*)\b/;

/**
 * Trajanje, vezano na izdelavo ali pripravo (»izdelava traja dva tedna«): guards.imaRok tega ne ujame (samo »v 2 dneh«, »do petka« ...),
 * pri govoru neposredno iz modela pa je to najbolj verjetna obljuba. Samo pot Live: sama cifra z enoto (»deset let izkusenj«) ni rok,
 * rok je ob glagolu izdelave/priprave/dobave v istem stavku.
 */
function imaTrajanjeIzdelave(besedilo: string): boolean {
  const enota = new RegExp(`\\b${STEVILO_ALI_BESEDA}\\s+${ENOTA_CASA}\\b|\\b(?:teden|mesec)\\s+dni\\b`);
  const predlog = new RegExp(`\\b(?:v|cez)\\s+${STEVILO_ALI_BESEDA}\\s+${ENOTA_CASA}\\b`);
  for (const stavek of fold(besedilo).split(/[.!?]+/)) {
    if (predlog.test(stavek)) return true;
    if (enota.test(stavek) && OBVEZNOST_ROKA.test(stavek)) return true;
  }
  return false;
}

export type RazlogVarovalkeGovora = "znesek" | "tema" | "rok" | "obljuba" | "stevilka" | "naslov" | "oznaka";

/**
 * Varovalka med govorom (pot Gemini Live, lastnik 11. 11. 2026): pri govoru neposredno iz modela besedila pred izgovorom
 * ni, zato koda isce prepovedano v PREPISU IZHODA, ki prihaja med govorom. Ista pravila kot preveriOdgovorZnanja
 * (znesek, cena, garancija, dostava, rok, obljuba, stevilke in naslovi, ki jih ni v znanju), BREZ meje dolzine: prepis je
 * delen in raste; preverja se vse besedilo odgovora od zacetka obrata. Vrne razlog ali null (dovoljeno).
 */
export function razlogVarovalkeGovora(prepis: string, katalog: Catalog): RazlogVarovalkeGovora | null {
  const o = prepis.replace(/\s+/g, " ").trim();
  if (!o) return null;
  if (/[{}<>`]/.test(o)) return "oznaka";
  if (imaZnesek(o) || vprasaPoCeni(o) || razlogPolja("odgovor", o)) return "znesek";
  if (razlogTeme(o)) return "tema";
  if (imaRok(brezDnevnihRazponov(o)) || imaTrajanjeIzdelave(o)) return "rok";
  if (OBLJUBA.test(fold(o))) return "obljuba";
  const vir = virOdgovora(katalog);
  const virSkupine = new Set(skupine(vir));
  for (const s of skupine(o)) if (!virSkupine.has(s)) return "stevilka";
  const virCifre = vir.replace(/\D/g, "");
  for (const tel of telefoni(o)) if (!virCifre.includes(tel)) return "stevilka";
  const virNaslovi = new Set(naslovi(vir));
  for (const n of naslovi(o)) if (!virNaslovi.has(n)) return "naslov";
  return null;
}

/** Odgovor iz znanja je najvec toliko stavkov (lastnik, 14. 11. 2026: dolg odgovor se je ponavljal in ni bil prekinljiv). */
export const NAJVEC_STAVKOV_ZNANJA = 2;
/** Skupaj najvec toliko znakov; prvi stavek je vedno cel (preverba ga je ze omejila na MEJA_ODGOVORA). */
export const MEJA_KRATKEGA_ODGOVORA = 220;

const MEJA_STAVKA = /(?<=[.!?])(?<!\d\.)\s+(?=[\p{Lu}«„"])/u;

export function stavkiBesedila(besedilo: string): string[] {
  return besedilo.split(MEJA_STAVKA).map((s) => s.trim()).filter(Boolean);
}

/** Kratek odgovor: 1-2 stavka in najvec MEJA_KRATKEGA_ODGOVORA znakov. Meja je v kodi, ne samo v navodilu modelu. */
export function skrajsajZnanje(odgovor: string): string {
  const stavki = stavkiBesedila(odgovor.replace(/\s+/g, " ").trim());
  let ven = "";
  for (const stavek of stavki.slice(0, NAJVEC_STAVKOV_ZNANJA)) {
    const novo = ven ? `${ven} ${stavek}` : stavek;
    if (ven && novo.length > MEJA_KRATKEGA_ODGOVORA) break;
    ven = novo;
  }
  return ven;
}

/** Zadnji stavek besedila: »Ponovim« ponovi samo tega, ne celega odgovora. */
export function zadnjiStavek(besedilo: string): string {
  const stavki = stavkiBesedila(besedilo);
  return stavki[stavki.length - 1] ?? besedilo.trim();
}
