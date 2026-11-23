/**
 * Koliko tisine po govoru klicatelja pomeni konec izreka, in kdaj izrek ocitno se ni koncan.
 * Lastnik po prvem pravem klicu (10. 11. 2026): »ko sem prenehal govoriti, je malo predolgo cakala«.
 * Cisti del brez diska in omrezja; modela ne klice.
 */
import { fold } from "./guards.ts";
import { jeZavrnitev, steviloStevk } from "./stik.ts";

export const TISINA_PRIVZETO_SEK = 1;
export const TISINA_NAJMANJ_SEK = 1;
/**
 * Osebna tajnica (odlocitev 17. 11. 2026): po koncu govora caka 2 s (1 s je klicatelja odrezala sredi sporocila, 3 s je bilo predolgo).
 * Nedokoncan stavek (veznik ali predlog na koncu, npr. »in«, »ker«, »da«) varuje jeNedokoncan: Lina tiho caka se CAKAJ_NADALJEVANJE_SEK
 * in izrek dopolni.
 */
export const TISINA_OSEBNA_PRIVZETO_SEK = 2;
/**
 * Osebna tajnica po zapisanem sporocilu (»Imate se kaksno vprasanje?«, odlocitev 17. 11. 2026): 2 s za hitrejsi odziv, nedokoncan stavek
 * (veznik, predlog na koncu, npr. »in«, »ker«, »da«) pa ostane zasciten z jeNedokoncan in CAKAJ_NADALJEVANJE_SEK.
 */
export const TISINA_OSEBNA_PO_SPOROCILU_SEK = 2;
/**
 * Osebna tajnica po zapisanem sporocilu: kako dolgo Gather caka, da klicatelj sploh zacne govoriti (Twilio timeout), preden Lina
 * reče slovo. Klic K6: po odgovoru brez vprasanja je Gather cakal ~11 s tisine (lastnik: »premor je bil dolg«).
 * Po vprasanju »Imate se kaksno vprasanje?« 6 s (klicatelj premisli), po odgovoru brez vprasanja 4 s.
 */
export const TIMEOUT_OSEBNA_PO_SPOROCILU_SEK = 4;
export const TIMEOUT_OSEBNA_PO_VPRASANJU_SEK = 6;
export const TISINA_NAJVEC_SEK = 5;
/** Koliko sekund Lina caka na nadaljevanje nedokoncanega izreka, preden vzame, kar je slisala. */
export const CAKAJ_NADALJEVANJE_SEK = 3;
/**
 * Meja zahtev Twilia na klic na preizkusnem racunu (pravi klic lastnika 10. 11. 2026 se je pri 10 zahtevah prekinil). Pri PREDZADNJI dovoljeni
 * zahtevi osebna tajnica odgovori in se poslovi v istem odgovoru (lastnik 14. 11. 2026: klic ne sme ostati brez Lininega slovesa).
 */
export const MEJA_ZAHTEV_KLICA = 10;

/** Nastavitev tisine: celo stevilo 1-5 (Twilio speechTimeout sprejme pozitivno celo stevilo), sicer privzeto. */
export function tisinaIzNastavitve(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return TISINA_PRIVZETO_SEK;
  return Math.min(TISINA_NAJVEC_SEK, Math.max(TISINA_NAJMANJ_SEK, Math.round(n)));
}

export type CakaPodatek = "ime" | "telefon" | "eposta" | "rok" | "dosegljiv" | "kolicina" | "nujnost" | undefined;

/**
 * Tisina po govoru v sekundah. Podatki, ki se narekujejo s premori (ime in priimek, telefon, e-posta), dobijo
 * sekundo vec, da premor med skupinami stevk ali pred priimkom ne odreze izreka.
 */
export function tisinaPoGovoru(caka: CakaPodatek, pravila: { tisinaPoGovoruSek?: number }): number {
  const osnova = tisinaIzNastavitve(pravila.tisinaPoGovoruSek);
  const narek = caka === "ime" || caka === "telefon" || caka === "eposta";
  return narek ? Math.min(TISINA_NAJVEC_SEK, osnova + 1) : osnova;
}

/** Besede, s katerimi se slovenski stavek ne konca: vezniki, predlogi, clenki pred podatkom. */
const NEDOKONCANO = new Set([
  "in", "ali", "ker", "da", "pa", "ter", "oziroma", "ampak", "vendar", "toda", "saj", "ce", "ko", "kot", "torej",
  "za", "na", "v", "z", "s", "iz", "do", "od", "pri", "po", "o", "k", "h", "ob", "med", "brez", "pred", "cez", "proti",
  "moj", "moja", "moje",
  // 14. 11. 2026 (osebna tajnica): tudi »ki«, »zato«, »kjer«, »kateri« ne zakljucijo stavka.
  "ki", "zato", "kjer", "kateri", "katera", "katero",
]);
/**
 * Pomozni glagoli brez dopolnila (»ali lahko«, »recite da bom«, »rad bi«): izrek ni cel. Samo pri izreku z vsaj tolikimi besedami, da
 * kratek cel odgovor (»Ne bo.«, »Tako bi.«) ni zmotno cakan. Lastnik 14. 11. 2026: prekinitev klicatelja je hujsa napaka od 0,5 s pocasnejsega odziva.
 */
const NEDOKONCAN_GLAGOL = new Map<string, number>([
  ["lahko", 2], ["bom", 3], ["bomo", 3], ["bi", 3], ["bo", 4], ["hocem", 3], ["zelim", 3], ["moram", 3], ["moramo", 3], ["rad", 3], ["rada", 3],
]);

/**
 * HEVRISTIKA: ali je izrek ocitno odrezan (klicatelj je sredi stavka naredil premor). Pri kratki tisini Lina iz
 * polovice ne sklepa, ampak enkrat pocaka nadaljevanje. Znaki: vejica na koncu prepisa, zadnja beseda je veznik ali
 * predlog (pri vsaj dveh besedah - »Da.« je cel odgovor), pri telefonu manj kot 6 stevk, pri e-posti naslov brez
 * domene. Zavrnitev (»ne vem«, »nimam«) je cel odgovor. Zmoti se pri stavkih, ki se res koncajo s predlogom.
 */
export function jeNedokoncan(text: string, caka?: CakaPodatek): boolean {
  const cisto = text.trim();
  if (!cisto) return false;
  if (/,\s*$/.test(cisto)) return true;
  const besede = fold(cisto)
    .replace(/[.!?…]+$/g, "")
    .split(/\s+/)
    .map((beseda) => beseda.replace(/^[^\p{L}\d@]+|[^\p{L}\d@]+$/gu, ""))
    .filter(Boolean);
  if (besede.length === 0) return false;
  const zavrnitev = jeZavrnitev(cisto);
  if (zavrnitev.splosno || zavrnitev.telefon || zavrnitev.email || zavrnitev.ime) return false;
  const zadnja = besede[besede.length - 1];
  if (besede.length >= 2 && NEDOKONCANO.has(zadnja)) return true;
  if (besede.length >= (NEDOKONCAN_GLAGOL.get(zadnja) ?? Infinity)) return true;
  // »Moja številka je«, »Ime mi je«: pri narekovanem podatku se stavek z »je« sele zacne (»Tako je.« je drugje cel odgovor).
  const narek = caka === "telefon" || caka === "eposta" || caka === "ime";
  if (narek && besede.length >= 2 && zadnja === "je") return true;
  if (caka === "telefon") {
    const stevk = steviloStevk(cisto);
    if (stevk >= 1 && stevk < 6) return true;
  }
  if (caka === "eposta") {
    const afna = besede.findIndex((beseda) => beseda === "afna" || beseda.includes("@"));
    if (zadnja === "afna" || zadnja === "pika" || zadnja.endsWith("@")) return true;
    if (afna >= 0) {
      const zaAfno = besede.slice(afna).join(" ");
      // Za afno mora priti domena s piko (»primer pika si« ali »primer.si«).
      if (!/\bpika\s+\p{L}{2,}|\.\p{L}{2,}/u.test(zaAfno)) return true;
    }
  }
  return false;
}

/** Zdruzi prvi del izreka z nadaljevanjem. Vejica na stiku ostane ena. */
export function zdruziIzrek(prvi: string, nadaljevanje: string): string {
  const a = prvi.trim().replace(/[.!?…]+$/g, "");
  const b = nadaljevanje.trim();
  if (!a) return b;
  if (!b) return prvi.trim();
  return `${a} ${b}`.replace(/\s+/g, " ");
}
