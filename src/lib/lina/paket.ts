/**
 * Osebna tajnica: dostava paketa (lastnik 23. 11. 2026). Uporabnik vpise navodilo (»Pustite ga pri sosedu na št. 5.«), neobvezno do datuma;
 * ko se klicatelj predstavi kot dostava (Pošta Slovenije, DPD, GLS, DHL, UPS, Express One, InPost, kurir, dostavljalec, »imam paket za vas«),
 * Lina rece »Paket pričakujemo. Prosim, pustite ga <mesto>.« (lastnik 24. 11.; BREZ imena lastnika: to slisi vsak, ki rece »tukaj DPD«). Navodilo dobi SAMO tak klicatelj, najvec enkrat na klic; nikoli v pozdrav,
 * stalne stavke ali dejstva modela. Prazno navodilo = izklopljeno.
 * Cista koda (brez omrezja in datotek).
 */
import { t } from "./besedila.ts";
import { fold } from "./guards.ts";
import { nfkcVrstica } from "./odsotnost.ts";
import { razlogPolja } from "./plast.ts";
import { jeDatum } from "./urnik.ts";

export const PAKET_NAJVEC_ZNAKOV = 160;
const PAS = "Europe/Ljubljana";

export type NastavitvePaketa = { nacinKlica?: string; paketNavodilo?: string; paketDo?: string };

/** Navodilo v eni vrstici, brez robnih presledkov, najvec PAKET_NAJVEC_ZNAKOV (z zakljucnim locilom). */
export function normirajPaket(surovo: unknown): string {
  if (typeof surovo !== "string") return "";
  const v = nfkcVrstica(surovo).slice(0, PAKET_NAJVEC_ZNAKOV);
  // Pika samo, ce je prostor: shranjeno navodilo nikoli ne preseze meje (sicer bi ga razlogPaketa ob naslednjem shranjevanju zavrnil).
  return v && !/[.!?]$/.test(v) && v.length < PAKET_NAJVEC_ZNAKOV ? `${v}.` : v;
}

/** Datum »velja do« (LLLL-MM-DD) ali prazen niz; vse drugo je prazno (klicatelj preveri `paketDoNeveljaven`). */
export function normirajPaketDo(surovo: unknown): string {
  return typeof surovo === "string" && jeDatum(surovo.trim()) ? surovo.trim() : "";
}

export function paketDoNeveljaven(surovo: unknown): boolean {
  return typeof surovo === "string" && surovo.trim() !== "" && !normirajPaketDo(surovo);
}

/** Besede stevil (po fold): »štiri osem dva ena« je koda kot »4821« (pregled 0.2.10, najdba 2). */
const BESEDA_STEVILA =
  "(?:nic|nula|ena|en|eno|dva|dve|tri|stiri|pet|sest|sedem|osem|devet|deset|enajst|dvanajst|trinajst|stirinajst|petnajst|sestnajst|sedemnajst|osemnajst|devetnajst|dvajset|trideset|stirideset|petdeset|sestdeset|sedemdeset|osemdeset|devetdeset|sto|tisoc)";
/**
 * Postna stevilka pred krajem (»1000 Ljubljana«) ni koda: stiri stevke, za njimi kraj (ena ali dve besedi z veliko zacetnico) NA KONCU
 * navodila ali pred locilom (drugi pregled 0.2.10, N8: »Tipkovnica 4821 Hvala ...« sredi navodila ni naslov).
 */
const POSTNA = /(?<!\d)[1-9]\d{3}\s+\p{Lu}\p{Ll}+(?:\s+(?:ob\s+|na\s+|pri\s+)?\p{Lu}\p{Ll}+)?(?=\s*(?:[,.;!]|$))/gu;
/** Ce navodilo omenja vhod ali vpis kode, stiri stevke nikoli niso postna stevilka (po fold, deli besed). */
const BESEDA_VHODA = /(?<![a-z])(?:vrat|vhod|tipkovnic|kombinacij|domofon|vpis|vtipka)/;
/**
 * Beseda za dostop (cele besede po fold): koda, geslo, PIN, sifra in (lastnik 0.2.10) kljuc, odklenjen, odprt - navodilo pove, kako priti
 * noter. »vključno«, »zaključek«, »Kodeljevo«, »Pintar« niso zadetki.
 */
const BESEDA_DOSTOPA =
  /(?<![a-z])(?:kod[aeio]|kodam\w*|geslo|gesla|geslom|gesli|pin|pina|pinom|sifr[aeio]|sifrant\w*|kljuc(?:a|u|em|i|e|ev|ema|ih|ka|ki|ek)?|odklenjen\w*|odklepa\w*|odklenil\w*|odprt[aeiou]?|odprti\w*)(?![a-z])/;

/** Najdaljsi niz zaporednih »stevk«: skupina stevk steje svoje stevke, beseda stevila eno; presledki, vejice in vezaji locijo zaporedje ne. */
function najvecStevk(f: string): number {
  const beseda = new RegExp(`^${BESEDA_STEVILA}$`);
  let naj = 0;
  let zdaj = 0;
  // Samo robna locila stran (»4.« je stevka); ura »16.30« ostane en kos, ki ni stevilo, in zaporedje prekine.
  for (const kos of f.split(/[\s,;-]+/).map((k) => k.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, ""))) {
    const n = /^\d+$/.test(kos) ? kos.length : beseda.test(kos) ? 1 : 0;
    zdaj = n ? zdaj + n : 0;
    naj = Math.max(naj, zdaj);
  }
  return naj;
}

/**
 * Razlog zavrnitve navodila (null = v redu). Ob shranjevanju (ko se navodilo spremeni) in ob vsakem klicu: dolzina, denarni signal (kot vsa
 * besedila uporabnika) in DOSTOP (stiri ali vec zaporednih stevk - tudi z besedami -, beseda koda/geslo/PIN/kljuc/odklenjen/odprt): navodilo
 * slisi vsak, ki se predstavi kot dostava. Postna stevilka pred krajem (»1000 Ljubljana«) je dovoljena.
 */
export function razlogPaketa(surovo: unknown): string | null {
  if (typeof surovo !== "string") return null;
  const v = nfkcVrstica(surovo);
  if (!v) return null;
  if (v.length > PAKET_NAJVEC_ZNAKOV) return t("paketDolzina");
  // Ura (»do 16.30«) ni koda: pika loci; presledki in vezaji ne (»4 8 2 1«, »48-21«). Besede samo cele (»Pintar«, »Kodeljevo« so v redu).
  const brezPostne = BESEDA_VHODA.test(fold(v)) ? v : v.replace(POSTNA, (m) => m.replace(/\d/g, "#"));
  const f = fold(brezPostne);
  if (/\d{4,}/.test(brezPostne.replace(/[\s-]/g, "")) || najvecStevk(f) >= 4 || BESEDA_DOSTOPA.test(f)) return t("paketKoda");
  // Denarni signal brez postne stevilke (»2000 Maribor« ni znesek).
  return razlogPolja("paket", brezPostne.replace(/#{4}/g, ""));
}

/** Izbira »Pred hišo« v vmesniku (ena kljukica) shrani to besedilo v paketNavodilo; »Drugo mesto« je lastno besedilo. */
export const PRED_HISO = "pred hišo";

/**
 * Mesto iz navodila (lastnik 24. 11. 2026): brez uvodnega »Pustite ga« / »Naj ga pustijo« / »Paket pustite« in brez koncnega locila, ker
 * odgovor sam rece »pustite ga ...«. Prej shranjeni celi stavki (»Pustite ga pri sosedu na št. 5.«) tako dajo isti odgovor.
 */
export function mestoPaketa(navodilo: string): string {
  return nfkcVrstica(navodilo)
    .replace(/^(?:prosim,?\s+)?(?:(?:naj\s+)?(?:ga|paket)\s+(?:naj\s+)?pust(?:ite|ijo|i)|pust(?:ite|ijo|i)\s+(?:ga|paket))\s+/iu, "")
    .replace(/[\s.!?]+$/u, "");
}

export function jePredHiso(navodilo: unknown): boolean {
  return typeof navodilo === "string" && fold(mestoPaketa(navodilo)) === fold(PRED_HISO);
}

/** Odgovor dostavljalcu (lastnik 24. 11. 2026): »Paket pričakujemo. Prosim, pustite ga <mesto>.« - brez imena lastnika. */
export function odgovorDostavljalcu(navodilo: string): string {
  return t("paketOdgovor").replace("{mesto}", () => mestoPaketa(navodilo));
}

/** Danasnji datum v Ljubljani (LLLL-MM-DD). */
function danes(zdaj: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PAS, year: "numeric", month: "2-digit", day: "2-digit" }).format(zdaj);
}

/** Navodilo, ki velja ta trenutek, ali "": samo osebna tajnica, vpisano in veljavno besedilo, »velja do« vkljucno s tem dnem v Ljubljani. */
export function aktivnoNavodiloPaketa(p: NastavitvePaketa, zdaj: Date): string {
  if (p.nacinKlica !== "osebna" || !Number.isFinite(zdaj.getTime())) return "";
  const navodilo = normirajPaket(p.paketNavodilo);
  if (!navodilo || razlogPaketa(p.paketNavodilo)) return "";
  if (paketDoNeveljaven(p.paketDo)) return "";
  const doDne = normirajPaketDo(p.paketDo);
  if (doDne && danes(zdaj) > doDne) return "";
  return navodilo;
}

/** Sluzbe v imenovalniku ali rodilniku (»iz Pošte«); NE »s pošto« ali »po pošti« (nacin posiljanja, ne predstavitev). */
const SLUZBE = "(?:post[ae] slovenije|post[ae]|dpd|gls|dhl|ups|express one|expressone|inpost|in post)";
/** Sluzbe, ki so na zacetku izreka nedvoumne: brez »ups« (medmet: »Ups, halo?«) in same »pošta« (»Pošta, dober dan, račun sem plačal«). */
const SLUZBE_ZACETEK = "(?:post[ae] slovenije|dpd|gls|dhl|express one|expressone|inpost|in post)";
/** Sluzbe, ki so same (»DPD.«) nedvoumne: brez »ups« (medmet) in »posta«. */
const SLUZBE_SAME = "(?:posta slovenije|dpd|gls|dhl|express one|expressone|inpost)";
/** Vloga samo kot samostalnik (»dostavljal« je tudi glagol: »sem ga dostavljal«). */
const VLOGA = "(?:dostavlja(?:lec|lka|lci|lca|vec|vka|vci|vca)|kurir(?:ka|ji|ja|ju)?|dostavn\\w* sluzb\\w*|kurirsk\\w* sluzb\\w*)";
/** Dostavno nadaljevanje za dvoumni zacetek (»Pošta, paket za gospo Novak«, »UPS, dostava«). */
const DOSTAVNO = `(?:dostava|${VLOGA}|paket (?:imam|za)|posiljk\\w* (?:imam|za))`;
const POZDRAV = "(?:(?:dober dan|dobro jutro|pozdravljeni|zdravo|halo) )?";
const VZORCI_DOSTAVE: RegExp[] = [
  // »tukaj Marko iz DPD« (najvec ena beseda imena vmes); »jaz sem s pošte«, »klicem iz GLS«, »sem iz DPD« (brez besed vmes: »jaz sem ga dobil od DPD«
  // in »Tukaj Ana, paket od DPD še ni prišel« nista predstavitev)
  new RegExp(`(?<![a-z])(?:(?:tukaj|tu je)(?: [a-z]+)?|jaz sem|klicem|klice vas|vas klice|sem|smo) (?:iz|od|z|s) ${SLUZBE}(?![a-z])`),
  // »tukaj DPD«, »tu je pošta«, »tukaj Marko, kurir«, »sem dostavljalec«
  new RegExp(`(?<![a-z])(?:(?:tukaj|tu je) (?:${SLUZBE}|dostava|(?:[a-z]+ )?${VLOGA})|jaz sem (?:${SLUZBE}|dostava|${VLOGA})|(?:sem|smo) ${VLOGA})(?![a-z])`),
  // Izrek se zacne s sluzbo ali vlogo: »DPD, dober dan«, »Dostava!«, »Kurir tukaj.«, »GLS, imam paket za vas«
  new RegExp(`^${POZDRAV}(?:${SLUZBE_ZACETEK}|${VLOGA}|dostava) (?:tukaj|dober dan|pozdravljeni|halo|za vas|imam|${DOSTAVNO})(?![a-z])`),
  // Dvoumni zacetek (ups, pošta) samo z dostavnim nadaljevanjem
  new RegExp(`^${POZDRAV}(?:ups|post[ae]) ${DOSTAVNO}(?![a-z])`),
  // »kurir DPD«, »dostavljalec iz GLS«
  new RegExp(`^${POZDRAV}${VLOGA} (?:(?:iz|od|z|s) )?${SLUZBE}(?![a-z])`),
  new RegExp(`^${POZDRAV}(?:${SLUZBE_SAME}|${VLOGA}|dostava)$`),
  // »imam paket za vas/Ano«, »dostavljam posiljko«, »nosim paket za gospo Novak«
  /(?<![a-z])(?:(?:imam|nosim|pripeljal\w*|prinesel\w*|prinesla)(?: (?:en|eno|neki|nek))? (?:paket|posiljk\w*) za|dostavljam(?: (?:en|eno|neki|nek|vam))? (?:paket|posiljk\w*))(?![a-z])/,
  /(?<![a-z])(?:paket|posiljka|posiljko) (?:je )?za vas(?![a-z])/,
];

/**
 * Klicatelj se predstavi kot dostava. Seznam DOVOLJENEGA (predstavitev + sluzba ali vloga, ali »imam paket za vas«); izrek klicatelja, ki
 * govori O paketu ali posti (»poslal sem vam paket ponudb po pošti«, »kličem glede paketa, ki sem ga naročil«, »ups«), ni dostava.
 */
export function jeDostava(izrek: string): boolean {
  const k = fold(izrek).replace(/[^\p{L}\d ]+/gu, " ").replace(/\s+/g, " ").trim();
  if (!k) return false;
  // Zanikanje predstavitve (»nisem dostavljalec«, »ne klicem iz DPD«) ni dostava.
  if (new RegExp(`(?<![a-z])(?:nisem|nismo|ne klicem)(?: [a-z]+)? (?:${VLOGA}|(?:iz|od|z|s) ${SLUZBE})(?![a-z])`).test(k)) return false;
  return VZORCI_DOSTAVE.some((v) => v.test(k));
}
