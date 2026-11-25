import { execFile } from "node:child_process";
import { IME_PAKETA, veljavnaRazlicica } from "./posodobitev.server.ts";

/**
 * Lina o sebi (naloga 11, lastnik 25. 11. 2026): različico in funkcije pove iz nameščenega paketa, ne ugiba.
 * Lina je trdila »različica iz 23. novembra« (nameščena 0.2.11) in da so stroke in cilj naloge »samo v izvorni kodi« (bili so v 0.2.11).
 */

/** Funkcije v tej gradnji; vsaka ima modul v paketu (preizkus zvestoba-virom-11 preveri, da datoteka obstaja). Nova funkcija = nova vrstica. */
export const FUNKCIJE_LINE: readonly { ime: string; modul: string }[] = [
  { ime: "sprejem klicev (tajnica: Twilio, zapisnik, nujni klici)", modul: "twilio-sprejem.server.ts" },
  { ime: "glasovni pogovor", modul: "voice.server.ts" },
  { ime: "koledar: opomniki, dogodki, zapiski", modul: "koledar.server.ts" },
  { ime: "naloge za Claude Code in druge agente (predlog, ki ga potrdite v zavihku Računalnik)", modul: "claude-naloge.server.ts" },
  { ime: "povezava s telefonom (kanal za naloge)", modul: "kanal-claude.server.ts" },
  { ime: "gradnje na GitHubu", modul: "gradnje-github.server.ts" },
  { ime: "n8n tokovi", modul: "n8n.server.ts" },
  { ime: "iskanje po spletu (Brave) in branje strani (TinyFish)", modul: "splet.server.ts" },
  { ime: "Znanje podjetja iz datotek", modul: "znanje-viri.server.ts" },
  { ime: "spomin pogovorov", modul: "spomin-pogovor.server.ts" },
  { ime: "samoučenje tem (Learn Anything)", modul: "samoucenje-pogovor.server.ts" },
  { ime: "učenje iz popravkov", modul: "ucenje-popravkov.server.ts" },
  { ime: "prilagodljivi kontekst (stroke in izrazi)", modul: "stroke.server.ts" },
  { ime: "cilj naloge", modul: "cilj-naloge.server.ts" },
  { ime: "priponke (slike, PDF, besedilo)", modul: "priponke.ts" },
  { ime: "dostava paketov iz klepeta", modul: "paket-klepet.server.ts" },
  { ime: "posodobitve programa", modul: "posodobitev.server.ts" },
];

type Izvedi = (program: string, argumenti: string[]) => Promise<string>;
const privzetoIzvedi: Izvedi = (p, a) =>
  new Promise((ok, ne) => execFile(p, a, { timeout: 3000, env: { PATH: "/usr/bin:/bin" } }, (e, izpis) => (e ? ne(e) : ok(String(izpis)))));

let predpomnilnik: { vrednost: string | null; cas: number } | null = null;
/** Paket se med tekom zamenja samo s posodobitvijo, ki Lino znova zažene; ura je samo varovalo. */
const VELJAVNOST_MS = 60 * 60_000;

/** Nameščena različica (dpkg lina-lupina) ali null (ni nameščena, Windows, razvojni zagon). Prvi klic ~10-30 ms, nato iz pomnilnika. */
export async function razlicicaLine(o: { izvedi?: Izvedi; sveze?: boolean } = {}): Promise<string | null> {
  if (!o.sveze && predpomnilnik && Date.now() - predpomnilnik.cas < VELJAVNOST_MS) return predpomnilnik.vrednost;
  let vrednost: string | null = null;
  try {
    const v = (await (o.izvedi ?? privzetoIzvedi)("/usr/bin/dpkg-query", ["-W", "-f=${Version}", IME_PAKETA])).trim();
    vrednost = veljavnaRazlicica(v) ? v : null;
  } catch {
    vrednost = null;
  }
  predpomnilnik = { vrednost, cas: Date.now() };
  return vrednost;
}

/**
 * Vprasanje o Linini razlicici: »si/imaš (nameščeno)/teče/are you« takoj za besedo razlicica na koncu vprasanja ali »tvoja/Lina« ob njej.
 * Golo »si« ni dovolj (»Zapiši si, da je nova verzija pogodbe …«); zgresena oblika ni draga, ker model razlicico dobi v O SEBI.
 */
const VPRASANJE =
  /(različic|razlicic|verzij|version)\p{L}*\s+(si|ima[sš](\s+name[sš][cč]en\p{L}*)?|te[cč]e[sš]?|are you)\s*[?.!]*\s*$|(^|[^\p{L}])(tvoj\p{L}*|your)\s+(različic|razlicic|verzij|version)|(različic|razlicic|verzij|version)\p{L}*\s+(lin[ae]|tvoj\p{L}*|of lina)(?!\p{L})/iu;

export function vprasanjeORazlicici(besedilo: string): boolean {
  return besedilo.length <= 120 && VPRASANJE.test(besedilo.trim());
}

export function odgovorORazlicici(razlicica: string | null): string {
  return razlicica
    ? `Nameščena je Lina ${razlicica} (vir: nameščeni paket ${IME_PAKETA} na tem računalniku).`
    : "Različice ne vem: nameščenega paketa Lina na tem računalniku ne najdem (morda teče razvojna različica).";
}

/** Odsek za navodilo modelu: dejstvo iz paketa, ne ugibanje. */
export function navodiloOSebi(razlicica: string | null): string {
  return (
    " O SEBI (iz nameščenega paketa, ne ugibaj): " +
    (razlicica ? `nameščena različica je ${razlicica}. ` : "Različice ne poznaš; če te vprašajo, povej, da je ne veš. ") +
    `Glavne funkcije v tej gradnji: ${FUNKCIJE_LINE.map((f) => f.ime).join("; ")}. Seznam ni popoln: veljajo tudi sposobnosti, ki jih opisujejo ta navodila. ` +
    "O funkciji, ki je ni ne tu ne v navodilih, ne trdi, da jo znaš, in ne, da je »samo v izvorni kodi«: povej, da tega ne veš zagotovo."
  );
}
