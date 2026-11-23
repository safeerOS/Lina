/**
 * Tajnica direktorja (lastnik 10. 11. 2026): Lina v ISTEM klicu zapise povprasevanje iz kataloga IN tajniski zapis
 * (sporocilo za direktorja, razlog klica, nujnost). Ime, podjetje in dosegljivost klicatelja so ze v obstojecih poljih
 * (stik, podjetjeKlicatelja, dosegljiv). Tu je samo cista logika brez diska in modela.
 *
 * Nujnost doloci KLICATELJ (izrecno »nujno« ali rok danes); Lina vprasa, ne ugiba (lastnik 10. 11. 2026).
 */
import { brezZneska, fold, imaZnesek } from "./guards.ts";
import type { CallSession, TajniskiZapis } from "./types.ts";

export const NAJVEC_SPOROCILA = 300;
const NAJVEC_RAZLOGA = 120;

/** Klicatelj daje sporocilo direktorju ali zeli govoriti z njim. Delo na zloznem (brez sumnikov) besedilu. */
const VZORCI_SPOROCILA: RegExp[] = [
  /\b(?:sporoc|povej|recit|prenes|obvest|javit)\w*\b[^.?!]{0,30}\b(?:direktor|vodj|sef)\w*/,
  /\bsporocilo\s+za\s+(?:direktor|vodj|sef)\w*/,
  /\b(?:direktor|vodja|sef)\w*\s+(?:naj|mora|bi moral|me)\b/,
  /\b(?:rad|rada|zelim|zelela)\b[^.?!]{0,20}\bgovori\w*\s+z\s+(?:direktor|vodj|sef)\w*/,
  /\bprosim\b[^.?!]{0,20}\b(?:da|naj)\b[^.?!]{0,20}\bdirektor\w*/,
];

export function jeSporociloDirektorju(text: string): boolean {
  const kljuc = fold(text);
  return VZORCI_SPOROCILA.some((vzorec) => vzorec.test(kljuc));
}

/** »Klicem zaradi reklamacije«, »klicem glede ponudbe«: razlog klica do locila. */
export function zajemiRazlog(text: string): string {
  const m = /(?<![\p{L}])kli[cč]em\s+(?:zaradi|glede|v zvezi z|v zvezi s)\s+([^.,;?!]{3,})/iu.exec(text);
  return m ? m[1].replace(/\s+/g, " ").trim().slice(0, NAJVEC_RAZLOGA) : "";
}

/**
 * Klicatelj je sam rekel, da je nujno. Samo izrecne oblike (lastnik 10. 11. 2026: Lina vprasa, ne ugiba):
 * »je nujno«, »nujna zadeva«, »nujno potrebujem/rabim/prosim«, »poklicite me takoj«, »rabim odgovor danes«.
 * NE: »nujne zapore« (pridevnik pri izdelku), »takoj po novem letu«, »takoj ko bo mogoce«, »ponudba za danes«.
 */
export function jeNujno(text: string): boolean {
  const k = fold(text).replace(/[.!?,;:]+/g, " ").replace(/\s+/g, " ");
  if (izrecnoNiNujno(text)) return false;
  const nujn = "nujn(?:o|a|en)";
  if (new RegExp(`(?<![a-z])(?:je|bo|zelo|res|prav|gre za)\\s+${nujn}(?![a-z])`).test(k)) return true;
  if (new RegExp(`(?<![a-z])${nujn}\\s+(?:je|zadev\\w*|stvar\\w*|sporocil\\w*|klic\\w*|primer\\w*|potrebujem|rabim|prosim|poklic\\w*|odgovor\\w*)`).test(k)) return true;
  if (new RegExp(`(?<![a-z])${nujn}\\s*$`).test(k)) return true;
  // »takoj« samo pri prosnji za klic ali odgovor in ne kot zacetek roka (»takoj po«, »takoj ko«).
  const takoj = "takoj(?!\\s+(?:po|ko|ob|ce|zatem|nato|ko))";
  const prosnja = "(?:poklic\\w*|klicite|rabim|potrebujem|odgovor\\w*)";
  if (new RegExp(`${prosnja}[^.]{0,25}(?<![a-z])${takoj}(?![a-z])|(?<![a-z])${takoj}\\s+(?:me|nas|poklic\\w*|klicite|rabim|potrebujem|odgovor\\w*)`).test(k)) return true;
  // »klicem« (predstavitev klicatelja) in »ponudba za danes« nista prosnja za povratni klic ali odgovor danes.
  const danes = "(?:se danes|do danes|danes)";
  const potreba = "(?:odgovor\\w*|poklic(?:ite|i|ali|at)\\w*|klicite)";
  return new RegExp(`${potreba}[^.]{0,25}(?<![a-z])${danes}(?![a-z])|(?<![a-z])${danes}(?![a-z])[^.]{0,20}${potreba}`).test(k);
}

/**
 * Klicatelj izrecno zeli govoriti s pravo osebo (lastnik 23. 11. 2026: »ce bo klicatelj rekel da zeli govoriti z pravo osebo«):
 * »rad bi govoril s clovekom/direktorjem/z njo«, »ali lahko govorim z Ano«, »povezite me z ...«, »dajte mi zivo osebo«.
 * NE: zanikanje (»ne rabim cloveka«, »nocem govoriti z ...«), vprasanje o Lini (»ste robot?«, »ali govorim s clovekom?« - ni prosnje),
 * pogovor z Lino (»rad bi govoril z vami«).
 */
export function zeliPravoOsebo(text: string): boolean {
  // Vejica ostane kot svoja beseda (`,`) samo za presojo zanikanja; vzorci iscejo po stavku brez vejic.
  const stavki = fold(text).split(/[.!?;]+/).map((s) => s.replace(/:+/g, " ").replace(/,+/g, " , ").replace(/\s+/g, " ").trim()).filter((s) => s.replace(/,/g, "").trim());
  // Oseba, ki ni Lina: z vami/tabo/teboj/robotom/umetno ... je pogovor z Lino.
  const neLina = "(?!(?:vami|vama|tabo|teboj|robot\\w*|umetn\\w*|asistent\\w*|lino)(?![a-z]))[a-z]{2,}";
  const zelja = "(?:zelim|zelel\\w*|hocem|hoce|rad|rada|radi|bi|lahko|moram|morem|prosim|zelimo)";
  const vzorci = [
    // »rad bi govoril z direktorjem«, »ali lahko govorim s clovekom«, »moram se pogovoriti z njo«
    new RegExp(`(?<![a-z])${zelja}(?![a-z])[a-z ]{0,25}?(?<![a-z])(?:govori\\w*|pogovori\\w*|pogovarja\\w*)\\s+(?:se\\s+)?(?:z|s)\\s+${neLina}`),
    // »povezite me z ...«, »prevezite me«, »preusmerite klic«, »dajte mi direktorja/cloveka«
    /(?<![a-z])(?:povez(?:ite|i|ete)|prevez(?:ite|i)|preusmer(?:ite|i))(?![a-z])/,
    /(?<![a-z])(?:dajte|daj)\s+mi\s+(?:direktor\w*|vodj\w*|sef\w*|lastnik\w*|clovek\w*|osebo|nekoga)/,
    // »dajte mi zivo osebo«, »rabim pravega cloveka«, »govoril bi s pravo osebo«: samo s prosnjo pred njim (CodeRabbit 029: »Ste vi prava oseba?«
    // je vprasanje o Lini, ne prosnja). »Rad bi govoril s pravo osebo« zajame ze prvi vzorec.
    /(?<![a-z])(?:(?:govori\w*|pogovori\w*)\s+bi\s+(?:se\s+)?(?:z|s)|(?:govoriti|pogovoriti)\s+(?:se\s+)?(?:z|s)|(?:dajte|daj)\s+mi|dob(?:im|imo|iti)|rabim|potrebujem|hocem|zelim|iscem)\s+(?:(?:eno|neko|nekega|enega)\s+)?(?:prav[aoi]|pravega|pravim|ziv[aoi]|zivega|zivim|resnicn\w*)\s+(?:oseb\w*|clovek\w*)(?![a-z])/,
    // ves stavek je prosnja v tozilniku: »Pravo osebo, prosim.«, »zivega cloveka«
    /^(?:(?:pravo|zivo|resnicno)\s+osebo|(?:pravega|zivega|resnicnega)\s+cloveka)(?:\s+prosim)?$/,
    // »rabim/hocem/zelim cloveka«
    /(?<![a-z])(?:rabim|potrebujem|hocem|zelim)\s+(?:cloveka|osebo|direktorja|vodjo|sefa|lastnika)(?![a-z])/,
  ];
  return stavki.some((z) => {
    const s = z.replace(/ ,/g, "").replace(/^, /, "").trim();
    const besede = z.split(" ");
    return vzorci.some((v) => {
      const m = v.exec(s);
      if (!m) return false;
      if (m[0].split(" ").some((b) => ZANIKANJE.test(b))) return false;
      // Indeks prve besede prosnje med besedami z vejicami.
      let pred = s.slice(0, m.index).split(" ").filter(Boolean).length;
      let i = 0;
      for (; i < besede.length && pred > 0; i += 1) if (besede[i] !== ",") pred -= 1;
      while (besede[i] === ",") i += 1;
      return !zanikanoPred(besede, i);
    });
  });
}

const ZANIKANJE = /^(?:ne|nocem|noce|nocemo|ni|nikakor)$/;
/** Besede, ki lahko stojijo med zanikanjem in prosnjo (»ne bi rad«, »ni treba, da me povezete«, »ne rabim, da me povezete«). */
const MED_ZANIKANJEM = /^(?:bi|rad|rada|radi|mi|me|nas|vas|se|treba|potrebno|da|res|sploh|cisto|zares|pa|ga|jo|vec|rabim|potrebujem|zelim|zelel|zelela|hocem|moram|morem|mores|moremo)$/;

/**
 * Zanikanje velja za prosnjo samo, ce stoji TIK pred njo (vmes le MED_ZANIKANJEM). Vsaka druga beseda (»ne VEM, rad bi govoril z direktorjem«) ali
 * vejica, za katero se ne nadaljuje odvisnik z »da« (»Ne, rad bi govoril z direktorjem.«), zanikanje loci od prosnje (CodeRabbit 029).
 */
function zanikanoPred(besede: string[], zacetek: number): boolean {
  let za = besede[zacetek] ?? "";
  for (let i = zacetek - 1; i >= 0; i -= 1) {
    const b = besede[i];
    if (b === ",") {
      if (za !== "da") return false;
      continue;
    }
    if (ZANIKANJE.test(b)) return true;
    if (!MED_ZANIKANJEM.test(b)) return false;
    za = b;
  }
  return false;
}

/** Besede, ki same niso vsebina sporocila (pozdrav, vljudnost, nujnost brez vsebine). */
const BREZ_VSEBINE_SPOROCILA = new Set([
  "dober", "dan", "dobro", "jutro", "vecer", "pozdravljeni", "zivjo", "halo", "lep", "pozdrav", "prosim", "hvala", "lepa", "nujno", "nujna", "nujen",
  "je", "zelo", "res", "gre", "za", "ja", "da", "ok", "okej", "no", "torej", "zadeva", "stvar", "takoj", "pa", "in", "se", "mi", "me",
  // stik (stevilka in e-naslov gresta v polja stika, ne v sporocilo)
  "moja", "moj", "stevilka", "telefon", "telefonska", "e", "posta", "eposta", "mail", "naslov",
]);

/**
 * Vsebina izreka, ki NI prosnja po osebi (CodeRabbit 029: »Nujno je, povežite me z Ano. Jutrišnji sestanek odpovedujem.« -> »Jutrišnji sestanek
 * odpovedujem.«). Samo stavki ZA prvo prosnjo (uvod pred njo - pozdrav, ime, »ne vem, kako to deluje« - ni sporocilo; ob dvomu Lina po
 * neuspehu raje vprasa), brez nadaljnjih prosenj, vljudnosti in gole nujnosti. "" = sporocila ni.
 * shortcut: deli samo po locilih; izrek brez locil (prepoznava govora) z vsebino in prosnjo v istem stavku se ne razdeli (sporocilo se vprasa
 * po neuspehu kot prej) - nadgradi, ce se pokaze v pravih klicih.
 */
export function sporociloObProsnji(text: string): string {
  // Pika za stevilom pred stevilom ali malo zacetnico ne konca stavka (CodeRabbit 029b: datum »12. 11. 2026«, »12. novembra«, »ob 15. uri«).
  const stavki = text.split(/(?<=[.!?;])(?<!\d\.)\s+|(?<=\d\.)\s+(?![\d\p{Ll}])/u).map((s) => s.trim()).filter(Boolean);
  const prva = stavki.findIndex((s) => zeliPravoOsebo(s));
  if (prva < 0) return "";
  return stavki
    .slice(prva + 1)
    .filter((s) => {
      // vprasanje (»Je to mogoče?«, »Ali je dosegljiva?«) ni sporocilo
      if (zeliPravoOsebo(s) || /\?\s*$/.test(s)) return false;
      const k = fold(ocistiSporocilo(s)).replace(/[^\p{L}\d ]+/gu, " ").replace(/\s+/g, " ").trim();
      if (/^(?:tukaj|jaz sem|moje ime je|klice vas|klicem iz)(?![a-z])/.test(k)) return false;
      return k.split(" ").filter((b) => b && !BREZ_VSEBINE_SPOROCILA.has(b)).length >= 2;
    })
    .join(" ")
    .slice(0, NAJVEC_SPOROCILA);
}

/** »Ni nujno«, »ne tako nujno«, »lahko pocaka«. (»Ni casa« je nujnost, ne zanikanje.) */
export function izrecnoNiNujno(text: string): boolean {
  const k = fold(text).replace(/[.!?,;:]+/g, " ").replace(/\s+/g, " ");
  return /(?<![a-z])(?:ni|ne|nikakor ne)\s+(?:zelo\s+|tako\s+|prav\s+)?nujn\w*|lahko pocaka/.test(k);
}

/** Odgovor na Linino vprasanje »Ali je zadeva nujna?«: da, ne ali nejasno. */
export function odgovorNujnost(text: string): "da" | "ne" | null {
  const k = fold(text).replace(/[.!?,;:]+/g, " ").replace(/\s+/g, " ").trim();
  if (!k) return null;
  if (izrecnoNiNujno(text) || /^(ne|ni|nikakor|ni treba|ne rabim)(?![a-z])/.test(k)) return "ne";
  if (jeNujno(text) || /^(da|ja|jap|seveda|tocno|zelo|nujna|danes|takoj)(?![a-z])/.test(k)) return "da";
  return null;
}

const JE_DATUM = /^\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*(?:\d{4}|\d{2})$/;

/** Stik klicatelja ne sodi v sporocilo za direktorja: e-naslov, povezava in telefonska stevilka (7+ stevk). */
export function ocistiSporocilo(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, " ")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:si|com|net|org|eu|io|de|at|hr)\b(?:\/\S*)?/gi, " ")
    // Datum (»12. 11. 2026«, »12.11.26«) ni telefonska stevilka: ostane v sporocilu.
    .replace(/\+?\d[\d\s().\/-]{5,}\d/g, (m) => (JE_DATUM.test(m.trim()) || m.replace(/\D/g, "").length < 7 ? m : " "))
    .replace(/\s+/g, " ")
    .trim();
}

const brezStika = ocistiSporocilo;

/**
 * Tajniski zapis po tem izreku. Sporocilo je izrek klicatelja, kakrsen gre v dnevnik (brez stika: vDnevnik ze nima telefona
 * in imena), najvec 300 znakov. Vrne nespremenjen zapis, ce izrek nic ne doda; undefined, ce tajniskega dela sploh ni.
 * caka === "nujnost": izrek je odgovor na vprasanje o nujnosti.
 */
export function zajemiTajnico(
  text: string,
  vDnevnik: string,
  prej: TajniskiZapis | undefined,
  caka?: string,
): TajniskiZapis | undefined {
  let sporocilo = prej?.sporocilo ?? "";
  let razlog = prej?.razlog ?? "";
  let nujno = prej?.nujno ?? false;
  let znana = prej?.nujnostZnana ?? false;

  if (jeSporociloDirektorju(text)) {
    // Samo stavki, ki so sporocilo (povprasevanje v istem izreku ima svoj zapis); ce se vzorec razteza prek stavkov, ves izrek.
    const stavki = (brezStika(vDnevnik).match(/[^.!?]+[.!?]*/g) ?? []).map((s) => s.trim()).filter(Boolean);
    // Uvodni stavek (»sporocite direktorju«) sam ni sporocilo: ohranimo ga in vse stavke za njim (vsebina sporocila).
    const prvi = stavki.findIndex((s) => jeSporociloDirektorju(s));
    const novo = (prvi >= 0 ? stavki.slice(prvi).join(" ") : brezStika(vDnevnik)).slice(0, NAJVEC_SPOROCILA);
    if (novo && !sporocilo.includes(novo)) sporocilo = sporocilo ? `${sporocilo} ${novo}`.slice(0, NAJVEC_SPOROCILA * 2) : novo;
  }
  // Odgovor na »Katero sporočilo želite pustiti?« po neuspeli prevezavi: izrek je sporocilo (razen »ne«, »nič«, »to je vse«, slovo).
  else if (caka === "sporocilo") {
    const novo = brezStika(vDnevnik).slice(0, NAJVEC_SPOROCILA);
    const kljuc = fold(novo).replace(/[^\p{L}\d ]+/gu, " ").replace(/\s+/g, " ").trim();
    // Zavrnitev je samo izrek, ki je v CELOTI zavrnitev ali slovo (»ne, to je vse«, »nic, hvala«); »Ne vem tocno, naj me poklice ...« je sporocilo (pregled 029).
    const zavrnitev = "(?:ne|nic|nimam|ni|to je vse|hvala|lepa|najlepsa|nasvidenje|adijo|lep dan|nicesar|sporocila|vec)";
    if (novo && kljuc && !new RegExp(`^${zavrnitev}(?: ${zavrnitev})*$`).test(kljuc) && !sporocilo.includes(novo)) {
      sporocilo = sporocilo ? `${sporocilo} ${novo}`.slice(0, NAJVEC_SPOROCILA * 2) : novo;
    }
  }
  const noviRazlog = zajemiRazlog(text);
  if (noviRazlog && !razlog) razlog = noviRazlog;

  if (caka === "nujnost") {
    const odg = odgovorNujnost(text);
    if (odg === "da") {
      nujno = true;
      znana = true;
    } else if (odg === "ne") {
      nujno = false;
      znana = true;
    }
  }
  if (jeNujno(text)) {
    nujno = true;
    znana = true;
  } else if (izrecnoNiNujno(text) && (prej?.nujno || jeSporociloDirektorju(text) || caka === "nujnost")) {
    // Klicatelj sam popravi (»saj ni nujno«): oznaka Nujno se umakne.
    nujno = false;
    znana = true;
  }

  if (!sporocilo && !razlog && !nujno && !znana) return prej;
  // Brez sporocila in brez nujnosti tajniskega zapisa ni (razlog sam ne sprozi tajniskega dela).
  if (!sporocilo && !nujno && !znana) return prej;
  return { sporocilo, razlog, nujno, nujnostZnana: znana };
}

/** Klic ima sporocilo za direktorja. */
export function imaTajnico(call: Pick<CallSession, "order">): boolean {
  return Boolean(call.order.tajnica?.sporocilo);
}

export function jeNujenKlic(call: Pick<CallSession, "order">): boolean {
  return call.order.tajnica?.nujno === true;
}

/** Sporocilo za prikaz in povzetek: brez zneskov (pravila o cenah veljajo tudi za tajniski del). */
export function sporociloBrezZneska(sporocilo: string): string {
  const cisto = brezStika(sporocilo);
  return imaZnesek(cisto) ? brezStika(brezZneska(cisto)) : cisto;
}

/**
 * Nujni klici na vrhu, nato najnovejsi (lastnik 10. 11. 2026). Stabilno: med nujnimi in med navadnimi ostane vrstni red
 * po zadnji spremembi. Vhoda ne spreminja.
 */
export function razvrstiKlice<T extends { updatedAt: string; order: { tajnica?: { nujno?: boolean } } }>(klici: readonly T[]): T[] {
  return [...klici].sort((a, b) => {
    const razlika = Number(b.order.tajnica?.nujno === true) - Number(a.order.tajnica?.nujno === true);
    return razlika !== 0 ? razlika : b.updatedAt.localeCompare(a.updatedAt);
  });
}
