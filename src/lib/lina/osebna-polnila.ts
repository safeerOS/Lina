import { fold } from "./guards.ts";
import { vrstaVprasanjaOdsotnosti, type VrstaVprasanjaOdsotnosti } from "./odsotnost.ts";
import PREPOZNAVA from "./napake-prepoznave.json" with { type: "json" };

/**
 * Tipicne napake prepoznave govora iz pravih klicev (napake-prepoznave.json; lastnik 14. 11. 2026: pravila razumevanja morajo biti v Lini
 * sami). Ista datoteka gre v poziv modela; nov primer iz klica je nova vrstica, brez spremembe kode.
 */
/**
 * Veljavna vrstica: »slisano« ima vsaj DVE besedi (ena splosna beseda, npr. »da« = »ponovi«, bi brez opozorila spremenila pravila za vsak izrek) in
 * se od »pomeni« razlikuje. Neveljavna vrstica ali manjkajoc seznam se izpusti (linija zaradi podatkovne datoteke ne sme pasti); skil-lina.test.ts
 * pade, ce datoteka vsebuje vrstico, ki se izpusti (neodvisni pregled 14. 11. 2026).
 */
export function veljavneNapakePrepoznave(surovo: unknown): Array<{ slisano: string; pomeni: string }> {
  if (!Array.isArray(surovo)) return [];
  const kljuc = (besedilo: string) => fold(besedilo).replace(/[^\p{L}\d]+/gu, " ").trim();
  return surovo.flatMap((vrstica: unknown) => {
    const { slisano, pomeni } = (vrstica ?? {}) as { slisano?: unknown; pomeni?: unknown };
    if (typeof slisano !== "string" || typeof pomeni !== "string") return [];
    const s = kljuc(slisano);
    const p = kljuc(pomeni);
    return s.split(" ").length >= 2 && p !== "" && s !== p ? [{ slisano, pomeni }] : [];
  });
}
export const NAPAKE_PREPOZNAVE: ReadonlyArray<{ slisano: string; pomeni: string }> = veljavneNapakePrepoznave((PREPOZNAVA as { napake?: unknown }).napake);
const NAPAKE_OBLIKE = NAPAKE_PREPOZNAVE.map((n) => ({
  vzorec: new RegExp(`(^| )${fold(n.slisano).replace(/[^\p{L}\d]+/gu, " ").trim()}(?= |$)`, "g"),
  pomeni: fold(n.pomeni).replace(/[^\p{L}\d]+/gu, " ").trim(),
}));
/** Izrek v obliki za pravila (fold, brez locil) s popravljenimi znanimi napakami prepoznave. */
export function popraviPrepoznavo(izrek: string): string {
  let k = fold(izrek).replace(/[^\p{L}\d]+/gu, " ").trim();
  for (const n of NAPAKE_OBLIKE) k = k.replace(n.vzorec, (_m, pred: string) => `${pred}${n.pomeni}`);
  return k;
}

/**
 * Pozdravne in polnilne besede osebne tajnice (lastnik, 14. 11. 2026, klic K1: med pozdravom je lastnik rekel
 * »zdravo ni na zdravo zdravo ej« in Lina je to vzela za sporocilo). Izrek iz samih teh besed ni sporocilo.
 */
const VEC_BESEDNA = ["dober dan", "dobro jutro", "dober vecer", "lep pozdrav"];
const POLNILA = new Set([
  "pozdravljeni", "pozdravljena", "pozdravljen", "zdravo", "zivijo", "zivio", "halo", "hello", "hej", "ej", "aha", "aja", "ja", "ni", "na", "no",
  "mhm", "hm", "hmm", "em", "eee", "ee", "eh", "oh", "ok", "prosim", "tukaj", "tu", "hvala",
]);

/** Vsebinske besede izreka: brez pozdravov in polnil, z zlozenimi sklici (»dober dan«) odstranjenimi najprej. */
export function vsebinskeBesede(izrek: string): string[] {
  let niz = ` ${fold(izrek).replace(/[^\p{L}\d]+/gu, " ").replace(/\s+/g, " ").trim()} `;
  for (const p of VEC_BESEDNA) niz = niz.split(` ${p} `).join("  ").split(` ${p} `).join("  ");
  return niz.split(" ").filter((b) => b && !POLNILA.has(b));
}

/** Izrek iz samih pozdravnih/polnilnih besed (ne glede na stevilo besed); prazen izrek ni pozdrav. */
export function jeSamoPozdravnoPolnilo(izrek: string): boolean {
  return /[\p{L}\d]/u.test(izrek) && vsebinskeBesede(izrek).length === 0;
}

/** Najmanj vsebinskih besed, da govor, zbran med pozdravom, velja za sporocilo. */
export const NAJMANJ_VSEBINSKIH_BESED = 3;
/** Rezerva po koncu pozdravnega posnetka (omrezje, zakasnitev Twilio). */
export const REZERVA_PO_POZDRAVU_MS = 2_000;

/** Vprasalnice in »imate/delate ...«: izrek z njimi ni cisto sporocilo (osebna tajnica). */
export const VPRASALNICA_OSEBNA = /\b(kaj|kdo|kdaj|kje|kako|kaks\w*|kater\w*|koliko|zakaj|imate|delate|izdelujete|prodajate|cena|cene)\b/;

/** Izrek, s katerim klicatelj konca pogovor (»ne«, »ne hvala«, »to je vse«, »nimam vec vprasanj«). */
export function jeKonecOsebno(izrek: string): boolean {
  const k = fold(izrek).replace(/[^\p{L}\d]+/gu, " ").trim();
  if (!k) return false;
  if (/\b(nasvidenje|adijo|to je vse|to bo vse|nic vec|nic drugega|konec klica|to je to)\b/.test(k)) return true;
  return /^(ne|ne hvala|hvala|ja hvala ne|nimam|nimam vec|nimam vec vprasanj|nimam vprasanj|ni vec|v redu|v redu hvala|ok|okej|super|super hvala|aha|aha hvala|odlicno|odlicno hvala|dobro|fino|ne hvala nimam vec|ne nimam)$/.test(k);
}

/** Prosnja za cakanje (»pocakaj«, »trenutek«, »moment«, »samo malo«, »preden ...«): Lina samo »Izvolite.« in poslusa naprej. */
export function jeProsnjaZaCakanje(izrek: string): boolean {
  return /\b(pocakaj\w*|trenutek|moment\w*|samo malo|preden)\b/.test(fold(izrek));
}

/**
 * Slovo (»se slisimo kasneje«, »nasvidenje«, »adijo«, »ciao«, »to je vse«, »ne hvala«, tudi STT-zgresene oblike »ne to slisimo kasneje«) na
 * koncu izreka: vsebina = izrek pred slovom (lahko prazna). Klic K5: »ne to slisimo kasneje« je koncalo v sporocilu.
 */
const SLOVO = /^((ne |no |ja |in |pa |ok )*(to )?(se )?(slisimo|vidimo)( se)?( kasneje| jutri| kmalu| potem| spet)*|kasneje|nasvidenje|na svidenje|adijo|ciao|ciau|to je vse|to bo vse|nic vec|nic drugega|konec klica|ne hvala)( hvala| in lep dan| lep dan| nasvidenje| adijo)*$/;
export function lociSlovo(izrek: string): { vsebina: string; slovo: boolean } {
  const besede = izrek.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < besede.length; i += 1) {
    const rep = fold(besede.slice(i).join(" ")).replace(/[^\p{L}\d]+/gu, " ").trim();
    if (rep && SLOVO.test(rep)) return { vsebina: besede.slice(0, i).join(" "), slovo: true };
  }
  return { vsebina: izrek.trim(), slovo: false };
}

/** Pogovor (»kako si«, »kako je«, »kako ste«): kratek stalni odgovor »Dobro, hvala.« */
export function jeMalopogovor(izrek: string): boolean {
  const k = fold(izrek).replace(/[^\p{L}\d]+/gu, " ").trim();
  return /^((a|ali|pa|no|ja|hej|halo) )*kako (si|ste|je|ti gre|vam gre|gre|se pocutis|se pocutite)( kaj| vam| ti| danes| pa vi| kaj pa ti)*$/.test(k);
}

const CIFRE = ["nič", "ena", "dve", "tri", "štiri", "pet", "šest", "sedem", "osem", "devet"];
/** Stevilka po slovensko za govor (brez stevk): +386 41 234 567 -> »nič štiri ena, dve tri štiri, pet šest sedem«. */
export function stevilkaBesedno(stevilka: string): string {
  let cifre = stevilka.replace(/[^\d+]/g, "");
  const mednarodna = cifre.startsWith("+") && !cifre.startsWith("+386");
  if (cifre.startsWith("+386")) cifre = `0${cifre.slice(4)}`;
  else cifre = cifre.replace(/^\+/, "").replace(/^00/, "");
  if (cifre.replace(/\D/g, "").length < 6) return "";
  const skupine = cifre.replace(/\D/g, "").match(/\d{1,3}/g) ?? [];
  const govor = skupine.map((g) => [...g].map((c) => CIFRE[Number(c)] ?? "").join(" ")).join(", ");
  return mednarodna ? `plus ${govor}` : govor;
}

export type VrstaVgrajenega = "stevilka" | "stevilkaNejasno" | "ai" | "nevem" | "zapisala";
/**
 * Vprasanje, ki ga je klicatelj postavil v ISTEM izreku kot sporocilo (klic K3: »... pokliče kaj številke« = STT-popacen »ali imate
 * mojo stevilko«). Pravila brez modela: jasen vzorec (»ali imate ... stevilk«) ali nejasen (»kaj ... stevilk«). Null: ni vprasanja.
 */
export function vrstaVgrajenega(izrek: string): VrstaVgrajenega | null {
  // Brez popravkov prepoznave: »Aleš si je kupil novo številko« (vsebina) ne sme postati »ali ... številko« (vprasanje).
  const k = fold(izrek).replace(/[^\p{L}\d]+/gu, " ").trim();
  if (/\b(imate|imas|vidite|veste)\b.*\b(stevilk\w*|telefonsk\w*)\b/.test(k) || /\b(stevilk\w*|telefonsk\w*)\b.*\b(imate|imas|vidite)\b/.test(k)) return "stevilka";
  if (/\b(kaj|ali)\b.*\b(stevilk\w*|telefonsk\w*)\b/.test(k)) return "stevilkaNejasno";
  if (/\bkdo ste\b/.test(k)) return "ai";
  // »si razumela / ali si zapisala / si me slisala« (tudi »vprasal sem te ce si razumela sporocilo«, STT brez vprasaja): dejstvo je samo, da
  // je sporocilo zapisano. »Kaj si zapisala« je branje nazaj, ne to vprasanje.
  if (!/\bkaj\b/.test(k) && /\b(si|ste)\b.*\b(razumel\w*|slisal\w*|zapisal\w*|sprejel\w*)\b/.test(k)) return "zapisala";
  if (/\b(koliko|kdaj)\b/.test(k)) return "nevem";
  return null;
}

/** Izrek v obliki za pravila: male crke, brez sumnikov in locil. */
const kljucIzreka = (izrek: string): string => fold(izrek).replace(/[^\p{L}\d]+/gu, " ").trim();

/**
 * Prosnja za ponovitev zapisanega. Iz klicev lastnika 14. 11. 2026: »kaj si me razumela prosim po novi« (STT »po novi« = »ponovi«), »aleš si
 * razumela moje sporočilo« (STT za »ali si«), odrezan »razumela«, »prosim povej mi kakšno je moj sporočilo« (STT za »moje«). Pravilo deluje brez
 * modela. »si slisala / si dobila« ostane potrditev (vrstaVgrajenega »zapisala«).
 */
export function jePonovitev(izrek: string): boolean {
  return prosnjaZaPonovitev(izrek) !== null;
}

const UKAZI = "ponovi|ponovite|ponovis|preberi|preberite|preberes";
/**
 * Ukaz ponovi/preberi kot CEL stavek (skil lina-slovenski-klici: »Prošnjo Lini prepoznaš po celem stavku, ne po dveh besedah«): polnila, ukaz, nato
 * najvec 5 besed. »ponovi ji/mu ...« je narocilo za osebo (vsebina); »naj ji ponovi navodila« se ne zacne z ukazom.
 */
const PROSNJA_CEL = new RegExp(`^(?:(?:prosim|lahko|a|ali|mi|kar|pa|no|ja|se|enkrat|mogoce|bi) )*(?:${UKAZI}|povej nazaj|povejte nazaj)(?! (?:ji|mu|jim|njej|njemu|njim)(?: |$))(?: \\S+){0,5}$`);
/**
 * Stroga oblika za branje z ZNANO NAPAKO prepoznave (»prosim po novi« = »prosim ponovi«): okoli ukaza samo polnila. Popravljeno »po novi številki me
 * pokliči« (»ponovi stevilki me poklici«) ima za ukazom vsebino in NI prosnja (neodvisni pregled 14. 11. 2026).
 */
const PROSNJA_STROGA = new RegExp(`^(?:(?:prosim|lahko|a|ali|mi|kar|pa|no|ja|daj|dajte) )*(?:${UKAZI})(?: (?:prosim|mi|to|vse|se enkrat|(?:moj\\w* )?sporocil\\w*))*$`);
const KAJ_SI_RAZUMELA = /\bkaj (si|ste) (me |mi )?(razumel\w*|zapisal\w*|slisal\w*)\b/;
/** »da si zapisal«, »ki ste razumeli« (odvisni stavek) je vsebina za osebo, ne vprasanje Lini. */
const BREZ_ODVISNIKA = "(?<!(?:^| )(?:da|ki|ker|ko|kar|kjer) )";
// Klic K8 (lastnik 14. 11. 2026): »aleš si razumela moje sporočilo« (STT za »ali si«) in odrezan »razumela« sta vprasanje, ali je
// Lina razumela: odgovor je PONOVITEV sporocila, ne potrditev in slovo. Samo kratek izrek (do 8 besed); daljsi izrek je prosnja le, ce je
// vprasanje na KONCU (lociMetaVprasanje).
const RAZUMEVANJE = new RegExp(`${BREZ_ODVISNIKA}\\b(si|ste)( me| mi)?( vse| prav| dobro)? (razumel\\w*|zapisal\\w*)\\b`);
const SAMO_BESEDA = /^(ali |a )?(razumel\w*|razumes|razumete|zapisal\w*)( prosim)?$/;
/**
 * Lastnik 14. 11. 2026 (»ni ponovila mojega sporočila, ko sem jo prosil«): prosnja, naj Lina POVE sporocilo, je ponovitev. Cel stavek,
 * naslovljen Lini (2. oseba, »mi«); med glagolom in »sporocilo« samo besede iz zaprtega seznama, svojilni zaimek tudi v popaceni obliki (»moj
 * sporocilo«, »moj je sporocilo«, »moja sporocilo«). »povej ji/mu ...« in stavki z drugo vsebino ostanejo sporocilo.
 */
const UVOD_PROSNJE = "(?:(?:prosim|lahko|a|ali|no|ja|pa|daj|dajte|torej|mi|bi|kar|mogoce) )*";
const REP_PROSNJE = "(?: (?:prosim|se enkrat|zdaj))*";
const MOJE_SPOROCILO = "(?:(?:moj\\w*|to|tisto)(?: je)? )?sporocil\\w*";
const DRUZINA_POVEJ: readonly RegExp[] = [
  // »povej mi, kakšno je moje sporočilo«, »povej mi moje sporočilo«, »mi lahko poveste, kako se glasi sporočilo«
  new RegExp(`^${UVOD_PROSNJE}(?:povej|povejte|poves|poveste)(?: mi)?(?: prosim)?(?: se enkrat)?(?: (?:kaj|kaksno|kako) je(?: v)?| kako se glasi| kaj pise v)? ${MOJE_SPOROCILO}${REP_PROSNJE}$`),
  // »kakšno je moje sporočilo«, »kaj je moje sporočilo«, »kaj je v sporočilu«
  new RegExp(`^${UVOD_PROSNJE}(?:kaj|kaksno|kako) je(?: v)? ${MOJE_SPOROCILO}${REP_PROSNJE}$`),
  // »kako se glasi moje sporočilo«
  new RegExp(`^${UVOD_PROSNJE}kako se glasi ${MOJE_SPOROCILO}${REP_PROSNJE}$`),
  // »kaj boš sporočila«, »kaj mu boste povedali«, »kaj boš posredovala naprej«
  new RegExp(`^${UVOD_PROSNJE}kaj (?:(?:ji|mu|jim) )?(?:bos|boste)(?: (?:ji|mu|jim))? (?:sporocil\\w*|posredoval\\w*|povedal\\w*|rekl\\w*)(?: naprej)?${REP_PROSNJE}$`),
  // »kaj si napisala«
  new RegExp(`^${UVOD_PROSNJE}kaj (?:si|ste) (?:mi |me )?napisal\\w*${REP_PROSNJE}$`),
  // »še enkrat«, »še enkrat prosim«, »povej še enkrat«
  new RegExp(`^${UVOD_PROSNJE}(?:(?:povej|povejte)(?: mi)? )?se enkrat(?: (?:prosim|povej|povejte))*$`),
];
/**
 * Vprasanje Lini o zapisu ali razumevanju v obliki vprasanja: »(ali|a|če) si/ste ... razumela/zapisala/slišala«. »povej ji, da si zapisal številko«
 * (odvisnik z »da«) je vsebina za osebo, ne vprasanje Lini.
 */
export const VPRASANJE_O_ZAPISU = /(?:^|(?:^| )(?:a|ali|ce|pa|in|ampak|no|torej|te|vas|ti|vi|kako) )(?:si|ste)(?: \S+){0,4} (?:razumel\w*|slisal\w*|zapisal\w*|sprejel\w*)(?: |$)/;
/** Cel (kratek) izrek ali vprasanje s konca izreka je prosnja za ponovitev. */
function celaProsnja(k: string): boolean {
  if (PROSNJA_CEL.test(k) || DRUZINA_POVEJ.some((v) => v.test(k))) return true;
  return k.split(" ").length <= 8 && (KAJ_SI_RAZUMELA.test(k) || RAZUMEVANJE.test(k) || SAMO_BESEDA.test(k));
}

/**
 * Ukaz Lini na KONCU izreka z vsebino (»pridem jutri ob osmih, prosim ponovi«): stevilo besed ukaza ali 0. Glagol v odvisnem stavku ali zanikan
 * (»naj mi vse še enkrat ponovi«, »da se to ne ponovi«, »ne ponovi«) je vsebina za osebo, ne ukaz Lini (neodvisni pregled 14. 11. 2026). »po novi« (STT za
 * »ponovi«) velja samo za »prosim«.
 */
const UKAZ_NA_KONCU = new RegExp(`(?:^| )((?:prosim )?(?:(?:a |ali )?(?:mi )?lahko (?:mi )?)?(?:${UKAZI})(?: prosim)?(?: sporocilo)?(?: prosim)?|prosim po novi)$`);
function ukazNaKoncu(k: string): number {
  const m = UKAZ_NA_KONCU.exec(k);
  if (!m) return 0;
  const ukaz = m[1] ?? "";
  const pred = k.slice(0, k.length - ukaz.length).trim().split(" ").filter(Boolean);
  if (pred.slice(-8).includes("naj")) return 0;
  // Goli »ponovi/preberi« brez prosnje je lahko 3. oseba (»ce se to ponovi«) ali zanikan (»ne ponovi«).
  if (!/(?:^| )(?:prosim|lahko)(?: |$)/.test(ukaz) && !/(?:ponovite|preberite|ponovis|preberes)/.test(ukaz)) {
    if (/^(?:ne|se|da|ce|ko|ki|ker|bo|bi|ni|ji|mu|jim)$/.test(pred.at(-1) ?? "")) return 0;
    if (pred.slice(-6).some((b) => b === "ce" || b === "da")) return 0;
  }
  return ukaz.split(" ").length;
}

/**
 * Vprasanje LINI na koncu izreka (klic K7: »... pridemo petih domov ali si me razumela«) ne sodi v sporocilo. Samo vzorci za 2. osebo,
 * namenjeni Lini (si me razumela, me slisite, ponovi, kdo si, povej mi, kakšno je moje sporočilo); vprasanja za lastnika (»ali me lahko poklice?«)
 * ostanejo v sporocilu. Ne zanasa se na »?« (STT ga ne pise). Lastnik 14. 11. 2026: svojilni zaimek pred »sporocilo«, tudi popacen (»moj je sporocilo«).
 */
const META_KONEC: readonly RegExp[] = [
  // »kaj si (me) razumela (prosim) (ponovi)«: pred »si razumela«, da »kaj« ne ostane v sporocilu
  /(?:^| )(?:pa |in )?kaj (?:si|ste) (?:me |mi )?(?:razumel\w*|zapisal\w*|slisal\w*)(?: prosim)?(?: (?:ponovi|ponovite|po novi))?$/,
  new RegExp(`(?:^| )(?:pa |in )?(?:ali |a )?${BREZ_ODVISNIKA}(?:si|ste) (?:me |mi )?(?:razumel\\w*|slisal\\w*|zapisal\\w*|dobil\\w*)(?: (?:(?:moj\\w*(?: je)? )?sporocil\\w*|vse|prav|dobro))?(?: prosim)?$`),
  /(?:^| )(?:pa |in )?(?:ali |a )?me (?:razumete|slisite|razumes|slisis)(?: prosim)?$/,
  /(?:^| )(?:pa |in )?(?:prosim )?(?:a |ali )?(?:mi )?lahko (?:mi )?(?:poves|poveste)(?: mi)?(?: (?:kaj|kaksno|kako) je| kako se glasi)? (?:moj\w*(?: je)? )?sporocil\w*(?: prosim)?$/,
  /(?:^| )(?:pa |in )?(?:prosim )?(?:povej|povejte) mi(?: prosim)?(?: (?:kaj|kaksno|kako) je| kako se glasi)? (?:moj\w*(?: je)? )?sporocil\w*(?: prosim)?$/,
  /(?:^| )(?:pa |in )?(?:prosim )?(?:povej|povejte)(?: prosim)? (?:kaj|kaksno|kako) je (?:moj\w*(?: je)? )?sporocil\w*(?: prosim)?$/,
  /(?:^| )(?:pa |in )?(?:kaj|kaksno) je moj\w*(?: je)? sporocil\w*(?: prosim)?$/,
  /(?:^| )(?:pa |in )?kdo (?:si|ste)(?: ti| vi)?$/,
];
/** Znana napaka prepoznave tik pred vprasanjem (»aleš si razumela« = »ali si razumela«) sodi k vprasanju, ne v sporocilo. */
function razsiriZNapako(kljuci: readonly string[], n: number, vzorec: RegExp): number {
  for (const dodatnih of [1, 2]) {
    if (kljuci.length < n + dodatnih) break;
    const del = kljuci.slice(-(n + dodatnih)).join(" ");
    const popravljen = popraviPrepoznavo(del);
    if (popravljen === del) continue;
    const m = vzorec.exec(popravljen);
    if (m && m[0].trim() === popravljen) return n + dodatnih;
  }
  return n;
}
export function lociMetaVprasanje(izrek: string): { vsebina: string; vprasanje: string } {
  const besede = izrek.trim().split(/\s+/).filter((b) => fold(b).replace(/[^\p{L}\d]+/gu, "") !== "");
  const kljuci = besede.map((b) => fold(b).replace(/[^\p{L}\d]+/gu, ""));
  const k = kljuci.join(" ");
  let n = 0;
  for (const vzorec of META_KONEC) {
    const m = vzorec.exec(k);
    if (!m) continue;
    n = razsiriZNapako(kljuci, m[0].trim().split(" ").length, vzorec);
    break;
  }
  if (n === 0) n = ukazNaKoncu(k);
  if (n === 0) return { vsebina: izrek.trim(), vprasanje: "" };
  return { vsebina: besede.slice(0, besede.length - n).join(" ").replace(/[\s,;:-]+$/u, ""), vprasanje: besede.slice(-n).join(" ").replace(/[.!?…]+$/u, "") };
}

/** Izrek z znanimi napakami prepoznave, zamenjanimi v izvirni obliki (za »razumljeno« ob prepisu); brez zadetka vrne izrek. */
export function beriZnaneNapake(izrek: string): string {
  let ven = izrek;
  for (const n of NAPAKE_PREPOZNAVE) {
    const vzorec = new RegExp(`(^|[^\\p{L}\\d])${n.slisano.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\d])`, "giu");
    ven = ven.replace(vzorec, (_m, pred: string) => `${pred}${n.pomeni}`);
  }
  return ven;
}

/** Del izreka (cel izrek ali vprasanje s konca) je prosnja; znana napaka prepoznave samo v strogi obliki (ukaz in polnila, brez vsebine). */
function prosnjaVDelu(del: string): { razumljeno?: string } | null {
  const k = kljucIzreka(del);
  if (!k) return null;
  if (celaProsnja(k)) {
    const branje = beriZnaneNapake(del);
    return branje !== del ? { razumljeno: branje } : {};
  }
  const popravljeno = popraviPrepoznavo(del);
  if (popravljeno !== k && (PROSNJA_STROGA.test(popravljeno) || DRUZINA_POVEJ.some((v) => v.test(popravljeno)) || SAMO_BESEDA.test(popravljeno))) return { razumljeno: beriZnaneNapake(del) };
  return null;
}

/**
 * Prosnja za ponovitev ali null. vsebina = del izreka pred prosnjo (dopis; prazno, ce je ves izrek prosnja). Znana napaka prepoznave
 * (napake-prepoznave.json) se uporabi samo za NAMEN in samo v delu, ki je prosnja: branje (»razumljeno«) gre ob vrstico prepisa, izvirnik ostane,
 * vsebina se ne popravlja (skil, ZAPIS).
 */
export function prosnjaZaPonovitev(izrek: string): { vsebina: string; razumljeno?: string } | null {
  const cel = izrek.trim();
  const celota = prosnjaVDelu(cel);
  if (celota) return { vsebina: "", ...celota };
  const meta = lociMetaVprasanje(cel);
  if (!meta.vprasanje || !meta.vsebina) return null;
  const konec = prosnjaVDelu(meta.vprasanje);
  if (!konec) return null;
  return { vsebina: meta.vsebina, ...(konec.razumljeno ? { razumljeno: `${meta.vsebina} ${konec.razumljeno}` } : {}) };
}

/**
 * Vprasanje o odsotnosti kot cel izrek (»Kje je Ana?«) ali na KONCU izreka s sporocilom (»Povejte Ani da pridem jutri, kje je Ana?«).
 * Odvisni stavek (»povejte mu, kje je Ana«) ali vsebina (»povejte mu, kje je ključ«) ostane sporocilo (null).
 */
export function lociVprasanjeOdsotnosti(
  izrek: string,
  ime = "",
): { vsebina: string; vprasanje: string; vrsta: VrstaVprasanjaOdsotnosti } | null {
  const cel = izrek.trim();
  const celaVrsta = vrstaVprasanjaOdsotnosti(cel, ime);
  if (celaVrsta) return { vsebina: "", vprasanje: cel, vrsta: celaVrsta };
  const besede = cel.split(/\s+/).filter(Boolean);
  if (besede.length < 4) return null;
  const maxRep = Math.min(9, besede.length - 2);
  for (let n = maxRep; n >= 2; n -= 1) {
    const rep = besede.slice(-n).join(" ");
    const vrsta = vrstaVprasanjaOdsotnosti(rep, ime);
    if (!vrsta) continue;
    const vsebina = besede.slice(0, -n).join(" ").replace(/[\s,;:-]+$/u, "");
    const zadnja = fold(vsebina).split(/[^\p{L}\d]+/u).filter(Boolean).at(-1) ?? "";
    if (/^(?:da|ce|ko|ker|kjer|povej|povejte|sporoci|sporocite|vprasaj|vprasajte|recite|mu|ji|jim|njemu|njej)$/.test(zadnja)) continue;
    if (vsebinskeBesede(vsebina).length < 2) continue;
    return { vsebina, vprasanje: rep.replace(/[.!?…]+$/u, ""), vrsta };
  }
  return null;
}
