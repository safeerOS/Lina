/**
 * Delovni cas prevezave (lastnik 23. 11. 2026, nacin podjetje): prevezava klica med pogovorom (prosnja po osebi IN nujnost) samo v delovnem
 * casu; privzeto pon-pet 07:00-15:00 Europe/Ljubljana, brez slovenskih dela prostih dni in brez prostih dni, ki jih vpise uporabnik. Uporabnik
 * lahko urnik spremeni ali omejitev izklopi. Osebna tajnica: omejitev NE velja.
 * Cista koda (brez omrezja in datotek). Ura je vedno ura v Ljubljani (Intl), ne ura procesa.
 */
import { razberiRazpone } from "./ure.ts";

export const URNIK_PAS = "Europe/Ljubljana";
export const URNIK_PRIVZETO = "pon-pet 07.00-15.00";
export const URNIK_NAJVEC_ZNAKOV = 120;
export const PROSTI_DNEVI_NAJVEC = 60;

export type NastavitveUrnika = {
  nacinKlica?: string;
  /** Prevezava samo v delovnem casu; privzeto vklopljeno, izklopi samo izrecen false. */
  prevezavaUrnikVklop?: boolean;
  /** Urnik v obliki kot delovni cas podjetja (»pon-pet 07.00-15.00«, »pon-cet 8.00-16.00, pet 8.00-13.00«). */
  prevezavaUrnik?: string;
  /** Prosti dnevi uporabnika (LLLL-MM-DD), loceni z vejico ali presledkom. */
  prevezavaProstiDnevi?: string;
};

/** Velika noc (gregorijanski koledar, anonimni algoritem Meeus/Jones/Butcher): [mesec 1-12, dan]. */
export function velikaNoc(leto: number): [number, number] {
  const a = leto % 19;
  const b = Math.floor(leto / 100);
  const c = leto % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return [Math.floor(n / 31), (n % 31) + 1];
}

const dvo = (n: number) => String(n).padStart(2, "0");
const datum = (leto: number, mesec: number, dan: number) => `${leto}-${dvo(mesec)}-${dvo(dan)}`;

/** Datum velike noci + zamik dni (ponedeljek +1, binkosti +49). */
function odVelikeNoci(leto: number, zamik: number): string {
  const [m, d] = velikaNoc(leto);
  const t = new Date(Date.UTC(leto, m - 1, d + zamik));
  return datum(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * Slovenski dela prosti dnevi (Zakon o praznikih in dela prostih dnevih): novo leto (1. in 2. 1.), Preseren (8. 2.), velika noc in
 * velikonocni ponedeljek, dan upora (27. 4.), praznik dela (1. in 2. 5.), binkosti, dan drzavnosti (25. 6.), Marijino vnebovzetje (15. 8.),
 * dan reformacije (31. 10.), dan spomina na mrtve (1. 11.), bozic (25. 12.), dan samostojnosti in enotnosti (26. 12.).
 * Prazniki, ki niso dela prosti (npr. 23. 11.), niso na seznamu.
 */
export function slovenskiPrazniki(leto: number): string[] {
  const stalni: Array<[number, number]> = [[1, 1], [1, 2], [2, 8], [4, 27], [5, 1], [5, 2], [6, 25], [8, 15], [10, 31], [11, 1], [12, 25], [12, 26]];
  return [...stalni.map(([m, d]) => datum(leto, m, d)), odVelikeNoci(leto, 0), odVelikeNoci(leto, 1), odVelikeNoci(leto, 49)].sort();
}

const DATUM = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Veljaven koledarski datum LLLL-MM-DD (leta 2000-2099). */
export function jeDatum(s: string): boolean {
  const m = DATUM.exec(s);
  if (!m) return false;
  const [l, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (l < 2000 || l > 2099) return false;
  const t = new Date(Date.UTC(l, me - 1, d));
  return t.getUTCMonth() === me - 1 && t.getUTCDate() === d;
}

/**
 * Prosti dnevi: veljavni datumi, brez podvojenih, urejeni, najvec PROSTI_DNEVI_NAJVEC; `napacni` so vnosi, ki niso datum; `prevec` = vec
 * razlicnih datumov od meje (pregled 0.2.10, najdba 8: savePravila to zavrne, ne zavrze tiho).
 */
export function razberiProsteDneve(surovo: unknown): { dnevi: string[]; napacni: string[]; prevec: boolean } {
  if (typeof surovo !== "string") return { dnevi: [], napacni: [], prevec: false };
  const kosi = surovo.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const napacni = kosi.filter((k) => !jeDatum(k));
  const vsi = [...new Set(kosi.filter(jeDatum))].sort();
  return { dnevi: vsi.slice(0, PROSTI_DNEVI_NAJVEC), napacni, prevec: vsi.length > PROSTI_DNEVI_NAJVEC };
}

/** Urnik v obliki, ki se shrani in uporabi v klicu: presledki strnjeni, brez robnih. */
export function normirajUrnik(surovo: unknown): string {
  return typeof surovo === "string" ? surovo.replace(/\s+/g, " ").trim() : "";
}

/**
 * Razlog zavrnitve urnika ali null (pregled 0.2.10, najdba 14): preveri se NORMIRAN urnik - natanko to, kar se shrani in kar vDelovnemCasu
 * razbere -, z istim razclenjevalnikom. Prazno = privzeti urnik (v redu).
 */
export function razlogUrnika(surovo: unknown): "dolg" | "nerazumljiv" | null {
  const urnik = normirajUrnik(surovo);
  if (!urnik) return null;
  if (urnik.length > URNIK_NAJVEC_ZNAKOV) return "dolg";
  return razberiRazpone(urnik).length > 0 ? null : "nerazumljiv";
}

/** Lokalni dan v tednu (0 = nedelja), minuta dneva in datum v Ljubljani. */
function lokalno(zdaj: Date): { dan: number; minuta: number; datum: string; leto: number } {
  const deli = new Intl.DateTimeFormat("en-GB", {
    timeZone: URNIK_PAS,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
  }).formatToParts(zdaj);
  const vz = (tip: string) => deli.find((d) => d.type === tip)?.value ?? "";
  const dan = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(vz("weekday"));
  const leto = Number(vz("year"));
  return { dan, minuta: (Number(vz("hour")) % 24) * 60 + Number(vz("minute")), datum: datum(leto, Number(vz("month")), Number(vz("day"))), leto };
}

/** Urnik, ki velja: vpisan in razumljiv, sicer privzeti (prazno polje = privzeto). */
export function veljavenUrnik(surovo: unknown): string {
  return normirajUrnik(surovo) || URNIK_PRIVZETO;
}

/**
 * Je ta trenutek v delovnem casu prevezave? Nerazumljiv urnik (rocno popravljena datoteka) ni nikoli delovni cas: varna smer je klic pri Lini.
 * Zacetek je noter, konec ze zunaj (07:00 da, 15:00 ne). Praznik ali prosti dan uporabnika: ves dan ne.
 */
export function vDelovnemCasu(p: NastavitveUrnika, zdaj: Date): boolean {
  if (!Number.isFinite(zdaj.getTime())) return false;
  const l = lokalno(zdaj);
  if (slovenskiPrazniki(l.leto).includes(l.datum)) return false;
  if (razberiProsteDneve(p.prevezavaProstiDnevi).dnevi.includes(l.datum)) return false;
  return razberiRazpone(veljavenUrnik(p.prevezavaUrnik)).some((r) => {
    const danNoter = r.startDay <= r.endDay ? l.dan >= r.startDay && l.dan <= r.endDay : l.dan >= r.startDay || l.dan <= r.endDay;
    return danNoter && l.minuta >= r.startMin && l.minuta < r.endMin;
  });
}

/** Prevezava med klicem je zdaj zaprta zaradi urnika: samo nacin podjetje, stikalo urnika vklopljeno (privzeto) in zunaj delovnega casa. */
export function prevezavaIzvenCasa(p: NastavitveUrnika, zdaj: Date): boolean {
  return p.nacinKlica !== "osebna" && p.prevezavaUrnikVklop !== false && !vDelovnemCasu(p, zdaj);
}
