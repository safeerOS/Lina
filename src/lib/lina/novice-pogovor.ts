/**
 * Naloga 32 (lastnik 26. 11. 2026, »Zakaj ne zna novice dneva«): novice v pogovoru z Lino. Namero razbere KODA iz lastnikovega
 * besedila (ozek vzorec, kot vprasanjeDneva v koledarju), odgovor sestavi KODA iz postavk virov (naslov, vir, povezava): model
 * vsebine virov ne vidi, zato je ne more vzeti kot navodilo in ne more reci »nimam dostopa do novic«.
 * Brez nastavljanja: ce lastnik nima virov na zaslonu Novice, Lina prebere privzete javne vire RSS (brez kljuca, brez strganja strani).
 * Komentarji so brez sumnikov.
 */
import type { Vir } from "./novice.ts";

/**
 * Privzeti javni viri (samo RSS, https). NEPREVERJENO z omrezjem (prenosnik 26. 11. 2026 ni imel dovoljenja za splet): preveri
 * na testnem PC z scripts/preveri-privzete-novice.mts; napacen naslov ne podre odgovora (drugi vir ostane, sicer sporocilo o nedosegljivosti).
 */
export const PRIVZETI_VIRI_NOVIC: readonly Vir[] = [
  { id: "privzeto-rtvslo", vrsta: "rss", ime: "RTV SLO", vnos: "https://img.rtvslo.si/feeds/00.xml", kategorija: "Slovenija" },
  { id: "privzeto-sta", vrsta: "rss", ime: "STA", vnos: "https://www.sta.si/rss-0", kategorija: "Slovenija" },
];

/** Koliko novic pokaze odgovor. */
export const NOVIC_V_ODGOVORU = 6;
const MEJA_VPRASANJA = 160;

const brezSumnikov = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const UVOD = String.raw`(?:(?:lina|prosim|hej|zivjo)[,!]? )?(?:(?:kaj|katere|kaksne) so (?:danes )?|povej(?: mi)? |preberi(?: mi)? |pokazi(?: mi)? |daj(?: mi)? |imas |zanimajo me |kje so )?`;
const PRIDEVNIK = String.raw`(?:(?:danasnje|dnevne|zadnje|najnovejse|glavne|sveze|aktualne|jutranje|vecerne|pomembne) )?`;
const OKVIR = String.raw`(?: (?:dneva|danes|za danes|iz slovenije|v sloveniji|iz sveta|po svetu|doma))?`;
// slepi pregled S4: tema samo z »o« / »o temi« / »na temo« (»kaj je novega pri nalogi«, »glede ponudbe za stranko« niso novice)
const TEMA = String.raw`(?: (?:o temi|na temo|o) (.{2,80}))?`;
const RE_NOVICE = new RegExp(String.raw`^${UVOD}${PRIDEVNIK}(?:novice|novic|novica|novosti)${OKVIR}${TEMA}$`);
const RE_NOVEGA = new RegExp(String.raw`^${UVOD}kaj je (?:danes )?novega(?: (?:v svetu|po svetu|doma|v sloveniji|danes))?(?: o (.{2,80}))?$`);

/**
 * Ali lastnik sprasuje po novicah; tema = »novice o X« (sicer null). Samo kratka vprasanja brez povezave (»preberi novice iz https://…«
 * je n8n tok) in brez ukaza (»opomni me, da preberem novice« je koledar): vzorec mora zajeti celo sporocilo.
 */
export function vprasanjeONovicah(besedilo: string): { tema: string | null } | null {
  if (besedilo.length > MEJA_VPRASANJA || /https?:|www\./i.test(besedilo)) return null;
  const s = brezSumnikov(besedilo).replace(/[?!.…]+$/u, "").trim();
  const m = RE_NOVICE.exec(s) ?? RE_NOVEGA.exec(s);
  if (!m) return null;
  const tema = (m[1] ?? "").trim();
  return { tema: tema ? izvirnaTema(besedilo, tema) : null };
}

/** Tema v lastnikovem zapisu (s sumniki), dolzina enaka kot v normaliziranem nizu (NFD odstrani samo naglasna znamenja). */
function izvirnaTema(besedilo: string, tema: string): string {
  const izvirno = besedilo.replace(/\s+/g, " ").trim().replace(/[?!.…]+$/u, "").trim();
  return izvirno.slice(Math.max(0, izvirno.length - tema.length)).trim() || tema;
}

/** Korenski deli besed teme (sklanjatve: »vremenu« -> »vreme«); besede krajse od 3 znakov ne stejejo. */
function koreni(tema: string): string[] {
  return brezSumnikov(tema)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((b) => b.length >= 3 && !["the", "and", "ter", "pri", "kaj"].includes(b))
    .map((b) => (b.length > 5 ? b.slice(0, b.length - 2) : b.slice(0, Math.max(3, b.length - 1))));
}

export type NovicaOdgovora = { naslov: string; povezava: string; vir: string; odlomek?: string };

/** Novice, ki omenjajo temo (naslov ali odlomek). */
export function poTemi<T extends NovicaOdgovora>(postavke: readonly T[], tema: string): T[] {
  const k = koreni(tema);
  if (!k.length) return [...postavke];
  return postavke.filter((p) => {
    const besedilo = brezSumnikov(`${p.naslov} ${p.odlomek ?? ""}`);
    return k.some((x) => besedilo.includes(x));
  });
}

/** Izmenicno po virih (najnovejse najprej znotraj vira), da en vir ne zasede vsega odgovora. */
export function izmenicnoPoVirih<T extends NovicaOdgovora>(postavke: readonly T[], najvec = NOVIC_V_ODGOVORU): T[] {
  const skupine = new Map<string, T[]>();
  for (const p of postavke) skupine.set(p.vir, [...(skupine.get(p.vir) ?? []), p]);
  const ven: T[] = [];
  for (let i = 0; ven.length < najvec; i++) {
    let dodano = false;
    for (const s of skupine.values()) {
      if (s[i] && ven.length < najvec) {
        ven.push(s[i]);
        dodano = true;
      }
    }
    if (!dodano) break;
  }
  return ven;
}

/** Besedilo vira je podatek: brez kontrolnih in nevidnih znakov, brez oznak [[ ]] (ne smejo postati ukaz v zgodovini), ena vrstica. */
export function cistNaslov(s: string): string {
  return s
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, " ")
    .replace(/\[\[|\]\]|<<<|>>>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** Pokaze se samo https povezava brez uporabnika in gesla. */
export function cistaPovezava(s: string): string | null {
  try {
    const u = new URL(s.trim());
    if (u.protocol !== "https:" || u.username || u.password || u.href.length > 500) return null;
    // slepi pregled N1: URL oglatih oklepajev ne kodira; [[ v povezavi ne sme postati oznaka v zgodovini
    return u.href.replace(/\[/g, "%5B").replace(/\]/g, "%5D");
  } catch {
    return null;
  }
}

export type IzidNovicZaOdgovor = {
  tema: string | null;
  /** Novice, ze izbrane po temi (ali prazne). */
  postavke: NovicaOdgovora[];
  /** Najnovejse novice ne glede na temo (za »o temi ni novic, najnovejse so«). */
  splosne: NovicaOdgovora[];
  /** Imena prebranih virov. */
  viri: string[];
  /** Viri so privzeti javni (lastnik jih ni dodal). */
  privzeti: boolean;
  /** Novice o temi so iz iskanja Brave. */
  izIskanja: boolean;
  /** Ali ima lastnik kljuc Brave (sicer namig). */
  brave: boolean;
};

function vrstice(postavke: readonly NovicaOdgovora[]): string[] {
  const ven: string[] = [];
  for (const p of postavke) {
    const naslov = cistNaslov(p.naslov);
    const povezava = cistaPovezava(p.povezava);
    if (!naslov || !povezava) continue;
    ven.push(`- ${naslov} (${cistNaslov(p.vir).slice(0, 40)}): ${povezava}`);
  }
  return ven;
}

/** Odgovor Line na vprasanje o novicah; nikoli »nimam dostopa«. */
export function odgovorNovic(i: IzidNovicZaOdgovor): string {
  const viri = i.viri.map((v) => cistNaslov(v).slice(0, 40)).join(", ");
  const opomba = i.privzeti ? "\n\nTo so javni viri, ki jih uporabim, dokler na zaslonu Novice ne dodate svojih." : "";
  const izbrane = vrstice(i.postavke.slice(0, NOVIC_V_ODGOVORU));
  if (izbrane.length) {
    const glava = i.tema ? `Novice o temi »${cistNaslov(i.tema)}«${i.izIskanja ? " (iskanje Brave)" : ` (${viri})`}:` : `Novice dneva (${viri}):`;
    return `${glava}\n${izbrane.join("\n")}${opomba}`;
  }
  const splosne = vrstice(i.splosne.slice(0, 3));
  if (i.tema && splosne.length) {
    const namig = i.brave ? "" : " Za iskanje po celem spletu dodajte ključ Brave v Nastavitvah.";
    return `O temi »${cistNaslov(i.tema)}« v virih (${viri}) zdaj ni novic.${namig} Najnovejše:\n${splosne.join("\n")}${opomba}`;
  }
  return `Virov novic (${viri || "RTV SLO, STA"}) trenutno ne morem doseči. Poskusite čez nekaj minut ali na zaslonu Novice dodajte svoje vire.`;
}

/**
 * Odgovor z novicami po vsebini (glava, ki jo sestavi koda na racunalniku in telefonu). Slepi pregled V1: sinhronizacija s telefonom
 * zastavice izVirov ne nese, zato zgodovina, povzetek in spomin prepoznajo podatek tudi po glavi. Lazni zadetek (model napise isto
 * glavo) samo zmanjsa zaupanje temu besedilu.
 */
export function jeOdgovorNovic(besedilo: string): boolean {
  return /^(?:Novice dneva \(|Novice o temi »|O temi »[^\n]{1,200}« v virih \()/.test(besedilo);
}

/** Navodilo modelu (naloga 32, tocka 4): za novice ne trdi, da nimas dostopa. */
export const NAVODILO_NOVIC =
  " Novice prebere program: iz virov, ki jih ima lastnik na zaslonu Novice, ali iz javnih virov (RTV SLO, STA), za druge teme tudi z iskanjem Brave, če ima ključ. Nikoli ne reci, da nimaš dostopa do novic ali aktualnih dogodkov; če vprašanja program ni prepoznal, predlagaj na primer »novice dneva« ali »novice o …«.";
