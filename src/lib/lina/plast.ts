/**
 * Tri plasti varovalke.
 * 1. Model ne sme dodati stevilke, stevnika, cene, brezplacnosti ali roka, ki ga ni v osnutku.
 * 2. Ob shranjevanju lastnikovih besedil steje samo denarni signal.
 * 3. Garancijo in dostavo pove samo iz vklopa, natanko z besedilom lastnika.
 */
import { t } from "./besedila.ts";
import { skrci, stevniki } from "./stevilke.ts";
import type { Pravila } from "./types.ts";

const MEJA = 2000;

/** NFKC, mehki vezaj in znaki nicelne sirine. Rez pred preverbo. */
export function ocisti(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u00AD\u200B\u200C\u200D\u2060\uFEFF]/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .slice(0, MEJA);
}

function zlozi(text: string): string {
  return skrci(ocisti(text));
}

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

function imaKotStevko(vir: string, stevka: string): boolean {
  return new RegExp(`(?<!\\d)${stevka}(?!\\d)`).test(vir);
}

function imaBesedo(vir: string, beseda: string): boolean {
  const esc = beseda.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "u").test(vir);
}

const ROK_BESEDA =
  /\b(rok|roka|roku|rokom|roki|jutri|pojutris\w*|naslednj\w*|ponedelj\w*|tork\w*|sred\w*|cetrtek\w*|cetrtk\w*|petk\w*|sobot\w*|nedelj\w*)\b/gi;

const CENA_KORENI =
  /\b(?:cen(?!ter)\w*|kosta\w*|costs?|znes\w*|plac(?:a|e|il\w*|at\w*|an\w*|uj\w*)|racun(?!aln)\w*|ddv|neto|bruto|polog\w*|avans\w*|popust\w*|akcij\w*|cenej\w*|ugodn\w*)\b/gi;

const VALUTA =
  /(?:€|\$|£|\beur\b|\beuro(?!park\b)(?!palet)(?!\s+[1-7]\b)(?:s|v)?\b|\bevr(?!op)(?!o\s+[1-7]\b)(?:o\b|i\b|e\b|a\b|ov\w*|om\b|u\b|ck\w*)|\busd\b|\bchf\b|\bdin(?:ar\w*)?\b|\bkun(?:a|e|o|i)?\b|\bcent(?:i|ov|a|e|u)?\b)/gi;

const BREZPLACNO =
  /\b(?:brezplac\w*|zastonj\w*|gratis|free)\b|\bno\s+charge\b|\bbrez\s+doplacil\w*|\bbrez\s+strosk\w*|\bpodar(?:i|j)\w*|\bne\s+zaracun\w*|\bna\s+nas\s+racun\w*|\bvkljuc\w*(?:\s+\w+){0,3}\s+cen\w*|\bpolovicn\w*\s+cen\w*/gi;

const SLENG = /\b(?:jur\w*|stotak\w*|stotk\w*|tisocak\w*|tisock\w*|tavzent\w*|kovac\w*|cuk(?:a|i|e|ov|u)?)\b/gi;

/** Oznake, ki jih model ne sme dodati mimo osnutka. */
function oznake(text: string): string[] {
  const norm = ocisti(text);
  const folded = zlozi(norm);
  const out: string[] = [];
  for (const m of folded.matchAll(/\d+/g)) out.push(`#${m[0]}`);
  for (const fraza of stevniki(folded)) {
    const kos = folded.slice(fraza.start, fraza.end).replace(/\s+/g, " ").trim();
    if (kos) out.push(`@${kos}`);
  }
  for (const re of [ROK_BESEDA, CENA_KORENI, VALUTA, BREZPLACNO, SLENG]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(folded))) out.push(`w${m[0].replace(/\s+/g, " ")}`);
  }
  if (/(?<![\p{L}])stane(?![\p{L}])/u.test(norm)) out.push("wstane");
  return out;
}

function oznakaJeVViru(oznaka: string, vir: string): boolean {
  if (oznaka.startsWith("#")) return imaKotStevko(vir, oznaka.slice(1));
  if (oznaka === "wstane") return imaBesedo(vir, "stane");
  return imaBesedo(vir, oznaka.slice(1));
}

/** Stavek doda stevilko, stevnik, ceno, brezplacnost ali rok, ki ga v osnutku ni. */
export function dodaObcutljivo(stavek: string, osnutek: string): boolean {
  // Stevka iz osnutka (telefon, ura) kot gola stevilka za izdelkom (»Alba je 555.«) zveni kot cena: velja isti denarni signal
  // kot ob shranjevanju. Osnutek iz kataloga ga nima (katalog z zneskom se ne shrani), zato tak stavek odpade.
  if (signalDenarja(stavek) && !signalDenarja(osnutek)) return true;
  const vir = zlozi(osnutek);
  return oznake(stavek).some((oznaka) => !oznakaJeVViru(oznaka, vir));
}

/**
 * Ce izpiljeno besedilo doda obcutljivo vsebino, ostane osnutek.
 * Stavek brez dodatka ostane. Ce ne ostane nic, velja cel osnutek, ne sporocilo o ponudbi.
 */
export function ostaniPriOsnutku(izpiljeno: string, osnutek: string): string {
  const vir = osnutek.trim();
  if (!vir) return izpiljeno;
  const kosi = stavki(ocisti(izpiljeno));
  if (kosi.length === 0) return vir;
  const ostane = kosi.filter((stavek) => !dodaObcutljivo(stavek, vir));
  if (ostane.length === 0) return vir;
  if (ostane.length === kosi.length) return izpiljeno;
  return ostane.join(" ").replace(/\s+/g, " ").trim();
}

const URA_RAZ = /\b\d{1,2}[.:]\d{2}\s*[-–—]\s*\d{1,2}[.:]\d{2}\b/g;
const URA_KONTEKST = /\b(?:ob|od|do)\s+\d{1,2}[.:]\d{2}\b/gi;
const DIMENZIJA = /\b\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?)?(?:\s*(?:cm|mm|m|kg))?/gi;
const TELEFON = /(?:\+\d[\d\s()./-]{6,16}\d|\b0\d(?:[\s./-]?\d){6,12}\b)/g;

const VARNA_NAPREJ =
  /^(?:oseb\w*|vrat\w*|barv\w*|teden\w*|tedn\w*|km|kg|nadstrop\w*|dni|dneh|dne|dan\w*|let\w*|ur\w*|minut\w*|cm|mm|m|kuhinj\w*|stol\w*|miz\w*|omar\w*|stopnic\w*|izdelk\w*|material\w*|leto|leti|letih|leta)$/;

const SPORNE_NAPREJ = /^(?:kos\w*|evr\w*|eur\w*|cent\w*)$/;

const PROZILNIK = new Set(["je", "so", "pride", "prides", "stane", "stanejo", "po", "za"]);

const ULICA = /(?:ulica|cesta|pot|trg|naselje|ova|eva|ska|cka|ina)$/;

function jeUraVKontekstu(text: string, raw: string): boolean {
  const [, min] = raw.split(/[.:]/);
  if (Number(min) > 59) return false;
  return new RegExp(`(?:\\b(?:ob|od|do)\\s+${raw.replace(/[.]/g, "\\.")}|${raw.replace(/[.]/g, "\\.")}\\s*[-–—]|[-–—]\\s*${raw.replace(/[.]/g, "\\.")})`).test(
    text,
  );
}

function obmocja(text: string, re: RegExp): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length]);
  return out;
}

function znotraj(obm: Array<[number, number]>, index: number): boolean {
  return obm.some(([a, b]) => index >= a && index < b);
}

function golaStevila(norm: string): string | null {
  const folded = zlozi(norm);
  const skrito = [
    ...obmocja(folded, URA_RAZ),
    ...obmocja(folded, URA_KONTEKST),
    ...obmocja(folded, DIMENZIJA),
    ...obmocja(folded, TELEFON),
  ];
  const stevila: { value: number; start: number; end: number; raw: string }[] = [];
  const reStev = /\d+/g;
  let st: RegExpExecArray | null;
  while ((st = reStev.exec(folded))) {
    if (znotraj(skrito, st.index)) continue;
    const value = Number(st[0]);
    if (!Number.isFinite(value) || value < 10) continue;
    stevila.push({ value, start: st.index, end: st.index + st[0].length, raw: st[0] });
  }
  for (const fraza of stevniki(folded)) {
    if (znotraj(skrito, fraza.start)) continue;
    if (fraza.denar) return folded.slice(fraza.start, fraza.end);
    if (fraza.value < 10) continue;
    stevila.push({
      value: fraza.value,
      start: fraza.start,
      end: fraza.end,
      raw: folded.slice(fraza.start, fraza.end),
    });
  }
  for (const stev of stevila) {
    const pred = folded.slice(0, stev.start).match(/([\p{L}]+)\s*[:,]?\s*$/u);
    const po = folded.slice(stev.end).match(/^\s*[,.]?\s*([\p{L}]+)/u);
    const prej = pred?.[1] ?? "";
    const naprej = po?.[1] ?? "";
    if (naprej && VARNA_NAPREJ.test(naprej) && !SPORNE_NAPREJ.test(naprej)) continue;
    if (PROZILNIK.has(prej) && !(naprej && VARNA_NAPREJ.test(naprej) && !SPORNE_NAPREJ.test(naprej))) return stev.raw;
    const ulica = ULICA.test(prej);
    if (!naprej) {
      if (ulica && stev.value < 10000) continue;
      return stev.raw;
    }
    const izvirniPred = norm.slice(Math.max(0, stev.start - prej.length - 2), stev.start);
    const ime = Boolean(prej) && /\p{Lu}/u.test(izvirniPred) && !ulica && !PROZILNIK.has(prej);
    if (ime && stev.value >= 100) return stev.raw;
    if (ime && SPORNE_NAPREJ.test(naprej)) return stev.raw;
  }
  return null;
}

/**
 * Denarni signal za shranjevanje. Null, ce besedilo sme v pozdrav, sporocilo ali zapisek.
 * Enice in nic ne sprozijo gole stevke. Samostalnik za stevilko jo spusti.
 */
export function signalDenarja(text: string): string | null {
  if (!text.trim()) return null;
  const norm = ocisti(text);
  const folded = zlozi(norm);
  for (const re of [VALUTA, CENA_KORENI, BREZPLACNO, SLENG]) {
    re.lastIndex = 0;
    const m = re.exec(folded);
    if (m) return m[0];
  }
  if (/(?<![\p{L}])stane(?![\p{L}])/u.test(norm)) {
    const ime = /\bstane\s+\p{L}+(?:\s+\p{L}+)?\s+pri\s+telefonu\b/iu.test(norm) && !/\d|[€$£]/.test(norm);
    if (!ime) return "stane";
  }
  const znanstveno = folded.match(/(?<![\d.])\d+e\d+\b/i);
  if (znanstveno) return znanstveno[0];
  const razmak = folded.match(/(?<!\d)\d(?:\s+\d){2,}(?!\d)/);
  if (razmak) return razmak[0];
  if (folded.includes("%")) return "%";
  const vejica = folded.match(/\d{1,8}\s*,\s*-/);
  if (vejica) return vejica[0];
  const kratkoE = folded.match(/(?<![\p{L}\p{N}])\d{1,6}\s+e\b/u);
  if (kratkoE) return kratkoE[0];
  const kil = folded.match(/(?<![\d.,])\d{1,3}\s*k(?![\p{L}\p{N}])/iu);
  if (kil) return kil[0];
  const decimal = /(?<!\d)(\d{1,6})[.,](\d{2})(?!\d)/g;
  let dec: RegExpExecArray | null;
  while ((dec = decimal.exec(folded))) {
    const raw = dec[0];
    if (jeUraVKontekstu(folded, raw)) continue;
    return raw;
  }
  return golaStevila(norm);
}

/** Zavrnitev pove polje in sporni izsek. */
export function razlogPolja(polje: string, text: string): string | null {
  const izsek = signalDenarja(text);
  if (!izsek) return null;
  return `${t("znesekZavrnitev")} Polje ${polje}: ${izsek}.`;
}

const GARANC = /\b(?:garanc\w*|jamstv\w*|reklamacij\w*)/;
const DOSTAV = /\b(?:dostav\w*|dobav\w*|posilj\w*|montaz\w*)/;
const VPRASA = /\b(?:ali|kdaj|kje|kako|kam|koliko|kolk|kaks\w*|kater\w*|kaj)\b|\?|v\s+kolik\w*\s+cas\w*/;

export function razlogTeme(text: string): string | null {
  const folded = zlozi(text);
  if (GARANC.test(folded) || DOSTAV.test(folded)) return t("temaZavrnitev");
  return null;
}

export function vprasanjeOGaranciji(text: string): boolean {
  const folded = zlozi(text);
  if (!GARANC.test(folded)) return false;
  return folded.includes("?") || VPRASA.test(folded);
}

export function vprasanjeODostavi(text: string): boolean {
  const folded = zlozi(text);
  if (!DOSTAV.test(folded)) return false;
  return folded.includes("?") || VPRASA.test(folded);
}

/** Null, ce vprasanje ni o garanciji ali dostavi. Sicer tocno besedilo ali sporocilo. */
export function odgovorTeme(
  text: string,
  pravila: Pick<Pravila, "povprasevanje" | "garancijaVklop" | "garancijaBesedilo" | "dostavaVklop" | "dostavaBesedilo">,
): { besedilo: string; neznano: boolean } | null {
  const gar = vprasanjeOGaranciji(text);
  const dos = vprasanjeODostavi(text);
  if (!gar && !dos) return null;
  if (gar && pravila.garancijaVklop && pravila.garancijaBesedilo.trim()) {
    return { besedilo: pravila.garancijaBesedilo.trim(), neznano: false };
  }
  if (dos && !gar && pravila.dostavaVklop && pravila.dostavaBesedilo.trim()) {
    return { besedilo: pravila.dostavaBesedilo.trim(), neznano: false };
  }
  return { besedilo: pravila.povprasevanje.trim() || t("povprasevanje"), neznano: true };
}

/** Cela stevilka E.164. Null, ce so crke ali oblika ne zdrzi. */
export function vE164(value: string): string | null {
  const raw = value.normalize("NFKC");
  if (/\p{L}/u.test(raw)) return null;
  let s = raw.replace(/\(0\)/g, "");
  s = s.replace(/[\s()./-]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (s.startsWith("0")) s = `+386${s.slice(1)}`;
  if (!s.startsWith("+") && /^\d+$/.test(s)) s = `+${s}`;
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return null;
  return s;
}

/** 112, 113 in 090, tudi v nacionalni ali E.164 obliki. */
export function jePrepovedanaStevilka(value: string): boolean {
  const raw = value.normalize("NFKC").replace(/\(0\)/g, "");
  const digits = raw.replace(/\D/g, "");
  const brezDrzave = digits.startsWith("386") ? digits.slice(3) : digits.replace(/^0+/, "");
  const nacionalna = digits.startsWith("386") ? digits.slice(3) : digits;
  if (brezDrzave === "112" || brezDrzave === "113" || nacionalna === "112" || nacionalna === "113") return true;
  if (/^(?:386)?090/.test(digits) || /^090/.test(digits) || digits.startsWith("38690")) return true;
  return false;
}

/** Ista stevilka po celi E.164, ne po zadnjih 8 stevkah. Nacionalna 0 gre v +386. */
export function enakaStevilka(a: string, b: string): boolean {
  const left = vE164(a);
  const right = vE164(b);
  if (!left || !right) return false;
  return left === right;
}
