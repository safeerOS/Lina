/**
 * Stevilke, stevniki in vloge. NFKC je pred vsakim preverjanjem.
 * Stevnik je stevilka. Gola stevilka ob izdelku ali ob pride/stane/je ni ista vloga
 * kot telefon, ura ali mera v dejstvih.
 */
import { t } from "./besedila.ts";

export function skrci(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/** NFKC, nbsp in locila, ki skrijejo znesek. Pomisljaj ostane za ure. */
export function normaliziraj(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[–—]/g, "-");
}

const ENOTA_KOLICINA = new Set(["kos", "kosa", "kose", "kosov", "kosu", "kosom"]);
const ENOTA_MERA = new Set(["cm", "mm", "m", "kg"]);
const ENOTA_CAS = new Set([
  "dan",
  "dni",
  "dneh",
  "dne",
  "dneva",
  "dnevu",
  "dnevih",
  "teden",
  "tedna",
  "tednu",
  "tedne",
  "tednov",
  "tednih",
  "tedni",
  "tednom",
  "tedensko",
  "let",
  "leta",
  "leti",
  "letih",
  "leto",
  "letom",
  "ura",
  "ure",
  "uri",
  "uro",
  "ur",
  "urah",
  "minuto",
  "minute",
  "minuti",
  "minut",
  "min",
  "minuta",
  "h",
]);

const DNEVI = new Set(["pon", "tor", "sre", "cet", "pet", "sob", "ned"]);

const MALA: Record<string, number> = {
  nic: 0,
  nula: 0,
  zero: 0,
  en: 1,
  ena: 1,
  eno: 1,
  eden: 1,
  one: 1,
  dva: 2,
  dve: 2,
  two: 2,
  tri: 3,
  trije: 3,
  three: 3,
  stiri: 4,
  four: 4,
  pet: 5,
  five: 5,
  sest: 6,
  six: 6,
  sedem: 7,
  seven: 7,
  osem: 8,
  eight: 8,
  devet: 9,
  nine: 9,
  dveh: 2,
  treh: 3,
  stirih: 4,
  petih: 5,
  sestih: 6,
  sedmih: 7,
  osmih: 8,
  devetih: 9,
  enem: 1,
  enega: 1,
  eni: 1,
};

const NAJST: Record<string, number> = {
  deset: 10,
  ten: 10,
  enajst: 11,
  eleven: 11,
  dvanajst: 12,
  twelve: 12,
  trinajst: 13,
  thirteen: 13,
  stirinajst: 14,
  fourteen: 14,
  petnajst: 15,
  fifteen: 15,
  sestnajst: 16,
  sixteen: 16,
  sedemnajst: 17,
  seventeen: 17,
  osemnajst: 18,
  eighteen: 18,
  devetnajst: 19,
  nineteen: 19,
};

const DESET: Record<string, number> = {
  dvajset: 20,
  desetih: 10,
  desetimi: 10,
  twenty: 20,
  trideset: 30,
  thirty: 30,
  stirideset: 40,
  forty: 40,
  petdeset: 50,
  fifty: 50,
  sestdeset: 60,
  sixty: 60,
  sedemdeset: 70,
  seventy: 70,
  osemdeset: 80,
  eighty: 80,
  devetdeset: 90,
  ninety: 90,
};

const STO: Record<string, number> = {
  sto: 100,
  dvesto: 200,
  tristo: 300,
  stiristo: 400,
  petsto: 500,
  seststo: 600,
  sedemsto: 700,
  osemsto: 800,
  devetsto: 900,
};

const SLANG: Record<string, number> = {
  jur: 1000,
  jurja: 1000,
  jurju: 1000,
  jurje: 1000,
  jurjev: 1000,
  jurcek: 1000,
  jurcka: 1000,
  jurcku: 1000,
  jurcke: 1000,
  jurckov: 1000,
  stotak: 100,
  stotaka: 100,
  stotake: 100,
  stotakov: 100,
  tisocak: 1000,
  tisocaka: 1000,
  tisocake: 1000,
  tisocakov: 1000,
  tisocaku: 1000,
  tisocka: 1000,
  tisocke: 1000,
  tisocki: 1000,
  tisocko: 1000,
  tisock: 1000,
  tisockah: 1000,
  stotka: 100,
  stotke: 100,
  stotki: 100,
  stotko: 100,
  stotk: 100,
  tavzent: 1000,
  tavzenta: 1000,
  tavzenti: 1000,
  kovac: 1000,
  kovaca: 1000,
  kovacev: 1000,
  kovacu: 1000,
  cuk: 1000,
  cuka: 1000,
  cukov: 1000,
};

const ZLOZENKA =
  /^(en|ena|eno|dva|dve|tri|stiri|pet|sest|sedem|osem|devet)in(dvajset|trideset|stirideset|petdeset|sestdeset|sedemdeset|osemdeset|devetdeset)$/;

type Tip = "mala" | "najst" | "deset" | "sto" | "tisoc" | "milijon" | "slang" | "pol" | "hundred" | "thousand" | "million";

type Klas = { tip: Tip; n: number };

function klasificirajJedro(w: string): Klas | null {
  const z = ZLOZENKA.exec(w);
  if (z) {
    const a = MALA[z[1]] ?? 0;
    const b = DESET[z[2]] ?? 0;
    return { tip: "deset", n: a + b };
  }
  if (w === "pol" || w === "polovica" || w === "half") return { tip: "pol", n: 0 };
  if (w in SLANG) return { tip: "slang", n: SLANG[w] };
  if (w in STO) return { tip: "sto", n: STO[w] };
  if (w in NAJST) return { tip: "najst", n: NAJST[w] };
  if (w in DESET) return { tip: "deset", n: DESET[w] };
  if (w in MALA) return { tip: "mala", n: MALA[w] };
  if (w === "hundred") return { tip: "hundred", n: 100 };
  if (w === "thousand" || w === "tisoc" || w === "tisoca" || w === "tisoci") return { tip: "tisoc", n: 1000 };
  if (w === "million" || w === "milijon" || w === "milijona" || w === "milijonov") return { tip: "milijon", n: 1_000_000 };
  return null;
}

const PRIKAZNE = [
  ...Object.keys(MALA),
  ...Object.keys(NAJST),
  ...Object.keys(DESET),
  ...Object.keys(STO),
  ...Object.keys(SLANG),
  "sto",
  "tisoc",
  "tisoca",
  "tisoci",
  "milijon",
  "hundred",
  "thousand",
  "million",
].sort((a, b) => b.length - a.length);

/** Sklanjanje: devetstotih, tisocka. Ne odrezi jedra, ce osnova ni stevnik. */
function sklanjatev(w: string): Klas | null {
  const konci = ["tih", "tim", "tega", "tem", "ima", "ami", "ih", "ah", "ov", "om", "e", "a", "o", "i", "u"];
  for (const konec of konci) {
    if (!w.endsWith(konec) || w.length - konec.length < 3) continue;
    const osnova = w.slice(0, -konec.length);
    const jedro = klasificirajJedro(osnova) ?? zlepljeno(osnova);
    if (jedro) return jedro;
  }
  return null;
}

/** Osemstodevetdeset je en stevnik, ne dve besedi. */
function zlepljeno(w: string): Klas | null {
  if (w.length < 10) return null;
  function hodi(rest: string, vsota: number, kosi: number): number | null {
    if (!rest) return kosi >= 2 ? vsota : null;
    for (const beseda of PRIKAZNE) {
      if (beseda.length < 3 || !rest.startsWith(beseda)) continue;
      const jedro = klasificirajJedro(beseda);
      if (!jedro || jedro.tip === "pol") continue;
      const naprej = hodi(rest.slice(beseda.length), vsota + jedro.n, kosi + 1);
      if (naprej !== null) return naprej;
    }
    return null;
  }
  const n = hodi(w, 0, 0);
  if (n === null) return null;
  return { tip: n >= 10 ? "deset" : "mala", n };
}

function klasificiraj(w: string): Klas | null {
  return klasificirajJedro(w) ?? sklanjatev(w) ?? zlepljeno(w);
}

type Tok = { t: string; start: number; end: number };

function tokeni(text: string): Tok[] {
  const out: Tok[] = [];
  const re = /[\p{L}\p{N}]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ t: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

function jeDan(toks: Tok[], i: number): boolean {
  const w = toks[i]?.t ?? "";
  if (!DNEVI.has(w)) return false;
  if (w !== "pet") return true;
  const prev = toks[i - 1]?.t ?? "";
  const next = toks[i + 1]?.t ?? "";
  if (DNEVI.has(prev) || DNEVI.has(next)) return true;
  if (/^\d/.test(next)) return true;
  return false;
}

export type Stevnik = { value: number; start: number; end: number; denar: boolean; significant: boolean; index: number };

function preberi(toks: Tok[], i: number): Stevnik | null {
  let j = i;
  let current = 0;
  let total = 0;
  let seen = false;
  let denar = false;
  let significant = false;
  let sameMala = true;

  while (j < toks.length) {
    const w = toks[j].t;
    if (w === "and" && seen) {
      j += 1;
      sameMala = false;
      continue;
    }
    if ((w === "a" || w === "an") && seen) break;
    const k = klasificiraj(w);
    if (!k) break;
    if (k.tip === "pol") {
      let korak = 1;
      let nxt = toks[j + 1]?.t ?? "";
      if (nxt === "a" || nxt === "an") {
        korak = 2;
        nxt = toks[j + 2]?.t ?? "";
      }
      const n = klasificiraj(nxt);
      if (!n || (n.tip !== "tisoc" && n.tip !== "milijon" && n.tip !== "slang" && n.tip !== "sto" && n.tip !== "thousand" && n.tip !== "million")) {
        break;
      }
      current += Math.round((n.n || 1000) / 2);
      if (n.tip === "slang") denar = true;
      significant = true;
      seen = true;
      sameMala = false;
      j += 1 + korak;
      continue;
    }
    if (k.tip === "slang") {
      current = (current || 1) * k.n;
      denar = true;
      significant = true;
      seen = true;
      sameMala = false;
      j += 1;
      break;
    }
    if (k.tip === "mala") {
      current += k.n;
      seen = true;
      j += 1;
      continue;
    }
    if (k.tip === "najst" || k.tip === "deset") {
      current += k.n;
      significant = true;
      seen = true;
      sameMala = false;
      j += 1;
      continue;
    }
    if (k.tip === "sto") {
      if (k.n === 100 && current > 0 && current < 10) current *= 100;
      else current += k.n;
      significant = true;
      seen = true;
      sameMala = false;
      j += 1;
      continue;
    }
    if (k.tip === "hundred") {
      current = (current || 1) * 100;
      significant = true;
      seen = true;
      sameMala = false;
      j += 1;
      continue;
    }
    if (k.tip === "tisoc" || k.tip === "thousand") {
      current = (current || 1) * 1000;
      total += current;
      current = 0;
      significant = true;
      seen = true;
      sameMala = false;
      j += 1;
      continue;
    }
    if (k.tip === "milijon" || k.tip === "million") {
      current = (current || 1) * 1_000_000;
      total += current;
      current = 0;
      significant = true;
      seen = true;
      sameMala = false;
      j += 1;
      continue;
    }
    break;
  }
  if (!seen || j === i) return null;
  const consumed = toks.slice(i, j);
  if (sameMala && consumed.length >= 2 && consumed.every((tok) => klasificiraj(tok.t)?.tip === "mala")) {
    const cat = Number(consumed.map((tok) => String(klasificiraj(tok.t)?.n ?? "")).join(""));
    return {
      value: cat,
      start: toks[i].start,
      end: toks[j - 1].end,
      denar: false,
      significant: true,
      index: j,
    };
  }
  total += current;
  return {
    value: total,
    start: toks[i].start,
    end: toks[j - 1].end,
    denar,
    significant,
    index: j,
  };
}

export function stevniki(text: string): Stevnik[] {
  const folded = skrci(normaliziraj(text));
  const toks = tokeni(folded);
  const out: Stevnik[] = [];
  for (let i = 0; i < toks.length; ) {
    if (jeDan(toks, i)) {
      i += 1;
      continue;
    }
    const fraza = preberi(toks, i);
    if (!fraza) {
      i += 1;
      continue;
    }
    out.push(fraza);
    i = fraza.index;
  }
  return out;
}

function jeEnota(beseda: string): boolean {
  return ENOTA_KOLICINA.has(beseda) || ENOTA_MERA.has(beseda) || ENOTA_CAS.has(beseda);
}

function enotaTakojZa(text: string, end: number): boolean {
  const m = text.slice(end).match(/^\s*([\p{L}]+)/u);
  if (!m) return false;
  return jeEnota(skrci(m[1]));
}

/** Velik stevnik, sleng ali zapisane stevke brez enote, ki ni denar. */
export function stevnikJeZnesek(text: string): boolean {
  const folded = skrci(normaliziraj(text));
  for (const fraza of stevniki(folded)) {
    if (fraza.denar) return true;
    if (!fraza.significant) continue;
    if (enotaTakojZa(folded, fraza.end)) continue;
    return true;
  }
  return false;
}

const DENAR_OKNO =
  /(?:€|\$|£|%|\b(?:eur|euro|euros|eura|evro|evri|evrov|evra|evrom|evre|evru|evrcke|evrckov|evrcek|evrcki|cent|centi|centov|centa|cente|neto|bruto|polog\w*|avans\w*|ddv|cena|ceno|cene|ceni|cenik|price|prices|costs?|stane|stanejo|pride|racun|racuna|racunu|racuni|jur\w*|stotak\w*|tisocak\w*|popust\w*|znesek\w*|gratis|zastonj|brezplacno)\b)/i;

const TELEFON_RE = /(?:\+\d[\d\s()./-]{6,16}\d|\b0\d(?:[\s./-]?\d){6,10}\b)/g;
const URA_RE = /\b\d{1,2}[.:]\d{2}(?:\s*-\s*\d{1,2}[.:]\d{2})?/g;
const DATUM_RE = /\b\d{1,2}\.\s*\d{1,2}\.\s*\d{2,4}\b/g;
const MERA_RE = /\b\d+(?:[.,]\d+)?\s*(?:x|×)\s*\d+(?:[.,]\d+)?(?:\s*(?:x|×)\s*\d+(?:[.,]\d+)?)?(?:\s*(?:cm|mm|m))?\b/gi;
const ULICA_RE = /\b(?:ulica|cesta|pot|trg|naselje)\s+\d{1,4}\b/gi;

export type Vloga = "telefon" | "ura" | "datum" | "mera" | "kolicina" | "trajanje" | "naslov" | "denar" | "gola";

export type PojavStevila = { raw: string; vloga: Vloga };

function vlogaBesede(beseda: string): Vloga | null {
  const b = skrci(beseda);
  if (ENOTA_KOLICINA.has(b)) return "kolicina";
  if (ENOTA_MERA.has(b)) return "mera";
  if (ENOTA_CAS.has(b)) return "trajanje";
  if (b === "ulica" || b === "cesta" || b === "pot" || b === "trg" || b === "naselje") return "naslov";
  return null;
}

function vlogaOb(text: string, start: number, end: number): Vloga {
  const po = text.slice(end).match(/^\s*([\p{L}%]+)/u);
  const pred = text.slice(0, start).match(/([\p{L}]+)\s*$/u);
  const poV = po ? vlogaBesede(po[1]) : null;
  if (poV) return poV;
  const predV = pred ? vlogaBesede(pred[1]) : null;
  if (predV === "naslov" || predV === "kolicina" || predV === "mera" || predV === "trajanje") return predV;
  const okno = text.slice(Math.max(0, start - 28), Math.min(text.length, end + 28));
  if (DENAR_OKNO.test(okno)) return "denar";
  return "gola";
}

export function vlogeStevilk(text: string): PojavStevila[] {
  const norm = normaliziraj(text);
  const spans: { start: number; end: number; vloga: Vloga }[] = [];
  const dodaj = (re: RegExp, vloga: Vloga) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(norm))) spans.push({ start: m.index, end: m.index + m[0].length, vloga });
  };
  dodaj(TELEFON_RE, "telefon");
  dodaj(URA_RE, "ura");
  dodaj(DATUM_RE, "datum");
  dodaj(MERA_RE, "mera");
  dodaj(ULICA_RE, "naslov");
  const out: PojavStevila[] = [];
  const re = /\d+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm))) {
    const start = m.index;
    const end = start + m[0].length;
    const span = spans.find((s) => start >= s.start && end <= s.end);
    const vloga = span?.vloga ?? vlogaOb(norm, start, end);
    out.push({ raw: m[0], vloga });
  }
  return out;
}

function stevkeZunajDovoljenega(text: string): boolean {
  const norm = normaliziraj(text);
  for (const st of vlogeStevilk(norm)) {
    if (st.vloga === "denar" || st.vloga === "gola") return true;
  }
  return false;
}

function stevnikBrezEnote(text: string): boolean {
  const folded = skrci(normaliziraj(text));
  for (const fraza of stevniki(folded)) {
    if (fraza.denar) return true;
    if (enotaTakojZa(folded, fraza.end)) continue;
    return true;
  }
  return false;
}

/**
 * Ob shranjevanju: vsaka stevka ali stevnik, ki ni ob enoti brez denarja
 * (ali telefon, ura, datum, mera, naslov). Brezplacno steje kot cena.
 */
export function razlogShranjevanja(text: string): string | null {
  if (!text.trim()) return null;
  const norm = normaliziraj(text);
  const folded = skrci(norm);
  if (/\b(brezplacno|zastonj|gratis)\b/.test(folded)) return t("znesekZavrnitev");
  if (/(?<![\d.])\d+e\d+\b/i.test(norm)) return t("znesekZavrnitev");
  if (/(?<![\d])\d{1,6},\d{2}(?!\d)/.test(norm)) return t("znesekZavrnitev");
  if (/(?<![\d])\d(?:\s+\d){2,}(?![\d])/.test(norm)) return t("znesekZavrnitev");
  if (/(?<![\p{L}\d])\d{2,6}\s+e\b/iu.test(norm)) return t("znesekZavrnitev");
  if (stevkeZunajDovoljenega(norm)) return t("znesekZavrnitev");
  if (stevnikBrezEnote(norm)) return t("znesekZavrnitev");
  return null;
}

/** True, ce odgovor vsebuje stevilko, ki je v dejstvih v drugi vlogi ali je gola. */
export function nedovoljeneStevilke(answer: string, dejstva: string, vprasanje: string): boolean {
  const odgovor = vlogeStevilk(answer);
  const vir = vlogeStevilk(dejstva);
  const vpr = normaliziraj(vprasanje);
  for (const st of odgovor) {
    if (st.vloga === "denar") return true;
    if (new RegExp(`(?<!\\d)${st.raw}(?!\\d)`).test(vpr)) continue;
    if (st.vloga === "gola") return true;
    const ista = vir.some((x) => x.raw === st.raw && x.vloga === st.vloga);
    if (!ista) return true;
  }
  return false;
}

export function imaBesedoCene(text: string): boolean {
  return /\b(brezplacno|zastonj|gratis)\b/.test(skrci(normaliziraj(text)));
}

export { TELEFON_RE };
