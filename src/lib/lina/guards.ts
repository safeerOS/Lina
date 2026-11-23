import { t } from "./besedila.ts";
import { enakaStevilka, ostaniPriOsnutku, razlogPolja } from "./plast.ts";
import {
  imaBesedoCene,
  normaliziraj,
  skrci,
  stevnikJeZnesek,
  TELEFON_RE,
} from "./stevilke.ts";
import type { Catalog, GuardResult, Material, Product, Violation } from "./types.ts";

/** Primerjava brez velikosti crk in stresic. */
export function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

function matchProduct(name: string, catalog: Catalog): Product | null {
  const key = fold(name);
  if (!key) return null;
  return catalog.products.find((item) => fold(item.name) === key || fold(item.id) === key) ?? null;
}

function matchMaterial(name: string, catalog: Catalog): Material | null {
  const key = fold(name);
  if (!key) return null;
  return catalog.materials.find((item) => fold(item.name) === key || fold(item.id) === key) ?? null;
}

/** NBSP, markdown in polna sirina ne smejo skriti zneska. */
export function pripravi(text: string): string {
  return text.normalize("NFKC").replace(/&nbsp;/gi, " ").replace(/\u00a0/g, " ").replace(/[*_`]/g, "");
}

/**
 * Ime Stane ni glagol. Glagol stane stejemo samo z malo zacetnico.
 * stanejo, stala, stalo ostanejo glagoli.
 */
function imaGlagolStane(text: string): boolean {
  return /(?<![\p{L}\p{N}])stane(?:jo|la|lo|li)?(?![\p{L}\p{N}])/u.test(text);
}

/** Euro 6 je emisijski razred, ne valuta. */
function brezEmisij(value: string): string {
  return value.replace(/\beuro\s+[1-7]\b/g, " ");
}

const VPRASANJE_CENA =
  "(?:cena|ceno|cene|ceni|cenik|cenov\\w*|price|prices|popust\\w*|kosta\\w*|znesek\\w*|placat\\w*|strosek\\w*|strosk\\w*|zaracun\\w*)";

const ZNESEK_CENA =
  "(?:cena|ceno|cene|ceni|cenik|cenov\\w*|price|prices|popust\\w*|kosta\\w*|znesek\\w*|placat\\w*|strosek\\w*|strosk\\w*|ddv|skupaj|costs?|neto|polog\\w*|avans\\w*|pride)";

const VALUTA_BESEDA =
  "(?:eur|euro|euros|eura|evro|evri|evrov|evra|evrom|evre|evru|evrcke|evrckov|evrcek|evrcki|cent|centi|centov|centa|cente|usd|dolar\\w*|chf|gbp|frank\\w*|kuna|kun|kune)";

/** Ime ob "pri telefonu" ni glagol. "stane 50" in "koliko stane" ostaneta. */
function staneJeGlagol(text: string): boolean {
  if (!imaGlagolStane(text)) return false;
  if (/\bstane\s+\p{L}{2,}(?:\s+\p{L}{2,})?\s+pri\s+telefonu\b/iu.test(text) && !/\d|[€$£]/.test(text)) return false;
  return true;
}

/**
 * Vprasanje po ceni, ne po merah ali kolicini.
 * Valuta je cela beseda: Europark, Evropska in europaleta niso cena.
 */
export function vprasaPoCeni(text: string): boolean {
  if (!text.trim()) return false;
  const original = pripravi(text);
  if (/[€$£%]/.test(original)) return true;
  if (staneJeGlagol(original)) return true;
  const value = brezEmisij(skrci(original));
  if (new RegExp(`\\b${VPRASANJE_CENA}\\b`).test(value)) return true;
  if (/\bhow much\b/.test(value) || /\bwhat does it cost\b/.test(value)) return true;
  if (/\bkoliko\b.*\bpride\b/.test(value) || /\bkolk\b.*\bpride\b/.test(value)) return true;
  if (/\bkolk\s+je\b/.test(value)) return true;
  if (/\bpo\s+cem\s+je\b/.test(value)) return true;
  if (/\bkoliko\b.*\b(stalo|stala|stali|kosta)\b/.test(value)) return true;
  if (/\bkaksen\s+je\s+strosek\b/.test(value)) return true;
  if (imaBesedoCene(original)) return true;
  if (new RegExp(`\\b${VALUTA_BESEDA}\\b`).test(value)) return true;
  return false;
}

function stebloEnote(unit: string): string {
  const u = fold(unit);
  if (/^dn|^dan/.test(u)) return "dn";
  if (/^ted/.test(u)) return "ted";
  if (/^let/.test(u)) return "let";
  if (/^mes/.test(u)) return "mes";
  if (/^ur/.test(u)) return "ur";
  return u;
}

/** Rok ostane, ce je dobeseden ali ce so ista trajanja in ista vsebina ze v viru. */
function rokJeVViru(stavek: string, vir: string): boolean {
  const jedro = fold(stavek).replace(/[.!?]+$/g, "").trim();
  if (jedro.length > 0 && vir.includes(jedro)) return true;
  if (!imaRok(stavek)) return true;
  const stavF = fold(stavek);
  const re =
    /(\d+)\s+(dni|dneh|dnevih|dne|dan|dneva|tednov|tednih|tedne|tedni|tednu|tedna|teden|let|leta|leti|letih|leto|mesecev|mesecu|mesece|mesecih|ur|ure|ura|urah)/gi;
  const trajanja: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(stavF))) trajanja.push(m);
  if (trajanja.length === 0) return false;
  const vse = trajanja.every((z) => {
    const stem = stebloEnote(z[2]);
    return new RegExp(`(?<!\\d)${z[1]}\\s+${stem}\\p{L}*`, "u").test(vir);
  });
  if (!vse) return false;
  const besede = stavF.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 6);
  return besede.some((w) => vir.includes(w));
}

/**
 * Znesek: valuta, sleng, stevnik, znanstveni zapis, decimalke, polna sirina.
 * Gola kolicina in mere niso znesek. Ime Stane ni glagol.
 */
export function imaZnesek(text: string): boolean {
  if (!text) return false;
  if (/[\uFF10-\uFF19]/.test(text)) return true;
  const original = pripravi(text);
  if (/[€$£%]/.test(original)) return true;
  if (/\d{1,8}\s*,\s*-/.test(original)) return true;
  if (/(?<![\d.,])\d{1,3}\s*k(?![\p{L}\p{N}])/iu.test(original)) return true;
  if (/(?<![\d.])\d+e\d+\b/i.test(original)) return true;
  if (/(?<![\d])\d{1,6},\d{2}(?!\d)/.test(original)) return true;
  if (/(?<![\d])\d(?:\s+\d){2,}(?![\d])/.test(original)) return true;
  if (/(?<![\p{L}\d])\d{2,6}\s+e\b/iu.test(original)) return true;
  if (imaBesedoCene(original)) return true;
  const value = brezEmisij(skrci(original.replace(/(?<![\p{L}])Stane(?![\p{L}])/gu, "Ime")));
  if (new RegExp(`\\b${VALUTA_BESEDA}\\b`).test(value)) return true;
  if (/\bstotak\w*\b|\bjur(?:j\w*|cek\w*|ja|jev|je)?\b|\btisocak\w*\b/.test(value)) return true;
  if (stevnikJeZnesek(value)) return true;
  if (/\bokoli\s+\d{2,6}\b/.test(value) && !/\bokoli\s+\d{2,6}\s*(?:cm|mm|kg|kos)/.test(value)) return true;
  if (/\bmed\s+\d{2,6}\s+in\s+\d{2,6}\b/.test(value)) return true;
  const cena = new RegExp(`\\b${ZNESEK_CENA}\\b.{0,48}\\d|\\d.{0,24}\\b${ZNESEK_CENA}\\b`);
  if (cena.test(value) || (imaGlagolStane(original) && /\d/.test(original))) return true;
  if (/\bracun(?:a|u|i|e)?\b.{0,24}\d|\d.{0,16}\bracun(?:a|u|i|e)?\b/.test(value)) return true;
  return false;
}

/** Razlog za lastnika. Null, ce besedilo nima denarnega signala. */
export function razlogZneska(text: string): string | null {
  return razlogPolja("besedilo", text);
}

/** Rok, ki ga Lina ne sme dodati, ce ga lastnik ni zapisal. Tudi brez stevk. */
export function imaRok(text: string): boolean {
  const value = fold(text);
  if (/\brok\b/.test(value)) return true;
  if (/\bv\s+\d+\s+(dneh|dni|dne|tednih|tednu|mesecih|mesecu)\b/.test(value)) return true;
  if (/\bdo\s+(ponedeljka|torka|srede|cetrtka|petka|sobote|nedelje|jutri|pojutrisnjem)\b/.test(value)) return true;
  if (/\bnaslednj\w*\s+tede?n\w*\b/.test(value)) return true;
  if (/\bjutri\b/.test(value)) return true;
  if (/\bv\s+(ponedeljek|torek|sredo|sreda|cetrtek|petek|soboto|sobota|nedeljo|nedelja)\b/.test(value)) return true;
  if (/\bv\s+(enem|dveh|treh|stirih|petih|sestih|sedmih|osmih|devetih|desetih)\s+(dneh|dni|dnevih|tednih|tednu)\b/.test(value)) {
    return true;
  }
  return false;
}

/**
 * Stavek je [.!?] + presledek + velika zacetnica.
 * Pika v 8.00 in d.o.o. ni konec stavka.
 */
function stavki(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  const re = /[.!?](?=\s+\p{Lu})/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    parts.push(text.slice(start, m.index + 1).trim());
    start = m.index + 1;
  }
  const tail = text.slice(start).trim();
  if (tail) parts.push(tail);
  return parts.filter(Boolean);
}

const ZNESEK_STEVILKA = "\\d{1,8}(?:[.,]\\d{1,2})?";
const ZNESEK_VALUTA =
  "(?:€|£|\\$|eur\\b|evro\\w*|evre\\b|euro\\b|euros\\b|eura\\b|evrck\\w*|cent\\w*|usd\\b|dolar\\w*|chf\\b|gbp\\b|kuna\\b|kun\\b|kune\\b)";

/**
 * Znesek je ena stevilka tik ob valuti.
 * Telefon se prej skrije, da ga valuta ne odreze.
 */
export function brezZneska(text: string): string {
  const original = pripravi(normaliziraj(text));
  const telefoni: string[] = [];
  const skrito = original.replace(new RegExp(TELEFON_RE.source, "g"), (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) return m;
    const id = telefoni.push(m) - 1;
    return `«T${id}»`;
  });
  const cleaned = skrito
    .replace(new RegExp(`${ZNESEK_STEVILKA}\\s*${ZNESEK_VALUTA}`, "gi"), " ")
    .replace(new RegExp(`${ZNESEK_VALUTA}\\s*${ZNESEK_STEVILKA}`, "gi"), " ")
    .replace(/\d{1,8}\s*,\s*-/g, " ")
    .replace(/(?<![\d.,])\d{1,3}\s*k(?![\p{L}\p{N}])/giu, " ")
    .replace(/«T(\d+)»/g, (_, i: string) => telefoni[Number(i)] ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .trim();
  return cleaned || t("povprasevanje");
}

/**
 * Odstrani stavek o roku, razen ce je isti stavek ze v dovoljenem besedilu
 * ali gre za parafrazo istega trajanja iz vira.
 * Ce nic ni odstranjenega, vrne izvirnik (pike v urah in d.o.o. ostanejo).
 * Rezerva je sporocilo po povprasevanju, ne cel katalog.
 */
export function brezDodanegaRoka(answer: string, dovoljeno: string, rezerva?: string): string {
  const vir = fold(dovoljeno);
  const kosi = stavki(answer);
  const kept = kosi.filter((stavek) => rokJeVViru(stavek, vir));
  if (kept.length === kosi.length) return answer;
  const cleaned = kept.join(" ").replace(/\s+/g, " ").trim();
  const pad = (rezerva ?? "").trim();
  return cleaned || brezZneska(pad || dovoljeno || t("povprasevanje"));
}

/** Stevilke, ki so dobesedno v viru (katalog, vprasanje). */
export function tujeStevilke(answer: string, vir: string): boolean {
  if (!vir.trim()) return false;
  const dovoljene = new Set<string>();
  for (const m of vir.matchAll(/\d+/g)) dovoljene.add(m[0]);
  for (const m of answer.matchAll(/\d+/g)) {
    if (!dovoljene.has(m[0])) return true;
  }
  return false;
}

/** Besedilo kataloga: mere, kolicine, ure, telefon, naslov in zapiski. */
export function dejstvaKataloga(catalog: Catalog): string {
  const company = catalog.company;
  return [
    company.name,
    company.trade,
    company.phone,
    company.address,
    company.hours,
    company.about,
    ...catalog.products.flatMap((item) => [item.name, item.kind, item.summary]),
    ...catalog.materials.flatMap((item) => [item.name, item.note]),
    ...(catalog.zapiski ?? []).flatMap((item) => [item.vprasanje, item.odgovor]),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Katalog plus stevilke iz osnutka narocila: kolicina, mere in telefon klicatelja. */
export function dejstvaZaGovor(
  catalog: Catalog,
  extra?: { quantity?: number | null; notes?: string; phone?: string },
): string {
  return [dejstvaKataloga(catalog), extra?.quantity ? `${extra.quantity} kos` : "", extra?.notes ?? "", extra?.phone ?? ""]
    .filter((s) => s && s.trim())
    .join("\n");
}

/**
 * Ce je podan osnutek, model ne sme dodati stevilke, cene, brezplacnosti ali roka.
 * Vprasanje po ceni gre v sporocilo. Brez osnutka ostane stari rez stavkov.
 */
export function varenOdgovor(question: string, answer: string, inquiry?: string, osnutek = ""): string {
  const sporocilo = brezZneska((inquiry ?? "").trim() || t("povprasevanje"));
  if (vprasaPoCeni(question)) {
    return brezDodanegaRoka(sporocilo, inquiry || sporocilo, sporocilo);
  }
  if (osnutek.trim()) return ostaniPriOsnutku(answer, osnutek);
  if (imaZnesek(answer)) return brezDodanegaRoka(sporocilo, inquiry || sporocilo, sporocilo);
  return brezDodanegaRoka(answer, inquiry || answer, sporocilo);
}

/** Isti kljuc po celi E.164. Nacionalna 0 postane +386. Zadnjih 8 stevk ne zadosca. */
export function istaStevilka(a: string, b: string): boolean {
  return enakaStevilka(a, b);
}

export type SpokenGuard = {
  question: string;
  answer: string;
  inquiry?: string;
};

/** Material se vprasa in zapise samo, ce ga katalog sploh ima. */
export function uporabljaMateriale(katalog: Catalog): boolean {
  return katalog.materials.some((m) => m.name.trim());
}

/**
 * Potrdi samo par, ki je dobesedno v katalogu in je za ta izdelek dovoljen.
 * Ce je podan izgovor, odgovor na ceno ne sme vsebovati zneska.
 */
export function applyGuards(
  draft: { requestedProduct: string | null; requestedMaterial: string | null },
  catalog: Catalog,
  spoken?: SpokenGuard,
): GuardResult {
  const requestedProduct = draft.requestedProduct?.trim() || null;
  const requestedMaterial = draft.requestedMaterial?.trim() || null;
  const product = requestedProduct ? matchProduct(requestedProduct, catalog) : null;
  const material = requestedMaterial ? matchMaterial(requestedMaterial, catalog) : null;
  const violations: Violation[] = [];

  // Prazen katalog (nevtralni privzetek, 11. 11. 2026): Lina ne ve, kaj podjetje dela, zato zelja ni kršitev,
  // ampak prosto povprasevanje; »ne izdelujemo« se rece samo ob napolnjenem seznamu.
  if (requestedProduct && !product && catalog.products.length > 0) violations.push("izdelek");
  if (requestedMaterial && !material && catalog.materials.length > 0) violations.push("material");
  if (product && material && !product.materialIds.includes(material.id)) violations.push("par");

  // Katalog brez materialov (lastnik, 14. 11. 2026: Safeer ne izdeluje, Lina pa je spraševala po materialu): izdelek je dovolj.
  const confirmed = Boolean(product && (material || !uporabljaMateriale(catalog)) && violations.length === 0);

  return {
    confirmed,
    product: product ?? null,
    material: material ?? null,
    requestedProduct,
    requestedMaterial,
    violations,
    answer: spoken ? varenOdgovor(spoken.question, spoken.answer, spoken.inquiry) : undefined,
  };
}
