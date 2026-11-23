/**
 * Sporocilo odsotnosti osebne tajnice (lastnik 15. 11. 2026: »uporabnik ima moznost, da Lina pove, da je uporabnik npr. do 15. ure
 * v sluzbi, zato ne more odgovarjati na klice, kaj zelite, da mu sporocim«).
 *
 * Odsotnost je DEJSTVO, ki ga da uporabnik v nastavitvah (stikalo, razlog, do kdaj); Lina ne ugiba, ne obljubi povratnega klica in ne
 * dodaja podatkov. Preverba poteka ob VSAKEM klicu iz sistemske ure (brez casovnika): po izteku se sporocilo ne izgovori vec.
 * Velja samo za osebno tajnico (odlocitev lastnika 15. 11. 2026); nacin podjetja ostane nespremenjen.
 * Cista koda (brez omrezja in datotek): enaka na Linuxu in Windows.
 *
 * Popravki slepega pregleda (15. 11. 2026): konec odsotnosti je STROGI ISO (ne Date.parse, ki bere tudi »Nov 15 2026 15:00« po casu
 * procesa); konec ali pas, ki ga ne razumemo, nikoli ne postane odsotnost brez konca ali tiha Ljubljana; razlog je samo kraj ali stanje
 * (seznam DOVOLJENEGA, ne seznam prepovedanih besed); polnoc in konec cez vec kot pol leta se izgovorita brez dvoumnosti.
 *
 * Popravki 3. kroga (15. 11. 2026, dva neodvisna pregleda): razlog ni vec prosto besedilo, ampak ZAPRT KATALOG pogostih razlogov ali KRAJ (predlog
 * v/na/pri in 1 do 3 besede z veliko zacetnico, samo crke); ime lastnika ima enako strogo obliko; NFKC pred vsemi preverbami (siroke crke, stevke
 * drugih pisav); neobstojeca ura (prehod na poletni cas) je zavrnjena, dvoumna (zimski) vzame prvi pojav; konec najvec eno leto naprej.
 */
import { t } from "./besedila.ts";
import { fold } from "./guards.ts";
import { razlogPolja } from "./plast.ts";

export const ODSOTNOST_NAJVEC_ZNAKOV = 140;
export const PRIVZETI_CASOVNI_PAS = "Europe/Ljubljana";
/** Konec odsotnosti je lahko samo v tem obsegu let (izgovor leta je besedno; skrajni datumi nimajo pomena). */
export const ODSOTNOST_LETO_NAJMANJ = 2000;
export const ODSOTNOST_LETO_NAJVEC = 2099;
/** Konec je »daleč naprej«, ce je dlje od tega (ms) in v drugem koledarskem letu: takrat Lina izgovori tudi leto. */
const LETO_IZGOVORI_PO_MS = 180 * 24 * 3_600_000;
/** Konec je lahko najvec toliko naprej (ms): tipkarska napaka (2062 namesto 2026) ne sme postati odsotnost za 36 let (pregled C6, N7). */
export const ODSOTNOST_NAJVEC_NAPREJ_MS = 366 * 24 * 3_600_000;

/** Nastavitve odsotnosti v Pravila (vse neobvezno: stare datoteke pravil jih nimajo). */
export type NastavitveOdsotnosti = {
  nacinKlica?: string;
  imeLastnika?: string;
  /** Stikalo (privzeto izklopljeno); vklopi ga samo logicni `true`. */
  odsotnostVklop?: boolean;
  /** Razlog (krog 3: zaprt nabor): fraza iz kataloga (RAZLOGI_KATALOG, npr. »v službi«) ali kraj »v/na/pri« + 1 do 3 besede z veliko zacetnico; prosto besedilo ni veljavno. */
  odsotnostRazlog?: string;
  /**
   * Konec odsotnosti: strogi ISO. Z odmikom (Z, +01:00) velja kot je; BREZ odmika je to ura v casovnem pasu uporabnika (ne strezniskega
   * procesa). Prazno ali brez vrednosti = dokler uporabnik ne izklopi; vse drugo, kar ni razumljiv ISO (tudi stevilo ali objekt), je neveljavno.
   */
  odsotnostDo?: string;
  /** IANA casovni pas uporabnika (ura v stavku je ura po njegovem casu). Prazno = privzeti pas; neveljaven pas je napaka. */
  odsotnostCasovniPas?: string;
};

/**
 * Casovni pas uporabnika: manjkajoc ali prazen = privzeti pas (stare datoteke pravil ga nimajo); veljaven IANA pas velja; vse drugo
 * (neobstojec pas, stevilo) je NEVELJAVNO in klicatelj mora odsotnost zavrniti ali izklopiti (ne tiho Ljubljana).
 */
export function preveriPas(pas: unknown): { pas: string; veljaven: boolean } {
  if (pas === undefined || pas === null) return { pas: PRIVZETI_CASOVNI_PAS, veljaven: true };
  if (typeof pas !== "string") return { pas: PRIVZETI_CASOVNI_PAS, veljaven: false };
  const obrezan = pas.trim();
  if (!obrezan) return { pas: PRIVZETI_CASOVNI_PAS, veljaven: true };
  try {
    new Intl.DateTimeFormat("sl-SI", { timeZone: obrezan });
    return { pas: obrezan, veljaven: true };
  } catch {
    return { pas: PRIVZETI_CASOVNI_PAS, veljaven: false };
  }
}

/** Pas za izracun: veljaven pas uporabnika, sicer privzeti (neveljavnost preveri `preveriPas`). */
export function veljavenPas(pas: unknown): string {
  return preveriPas(pas).pas;
}

/** Razlog v eni vrstici brez zakljucnega locila, najvec 140 znakov. */
export function normirajRazlog(surovo: unknown): string {
  if (typeof surovo !== "string") return "";
  const brez = nfkcVrstica(surovo).replace(/[.!?\s]+$/u, "");
  // Razlog iz kataloga se vedno shrani v kanonicni obliki kataloga (s sumniki); kraj dobi predlog z malo zacetnico.
  return (izKataloga(brez) ?? kanonicenKraj(brez)).slice(0, ODSOTNOST_NAJVEC_ZNAKOV);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Konec odsotnosti (strogi ISO, ura brez odmika po pasu uporabnika)
// ---------------------------------------------------------------------------------------------------------------------------

type DelCasa = { leto: number; mesec: number; dan: number; ura: number; minuta: number };

/** Lokalni deli casa v casovnem pasu uporabnika (Intl: DST in polnoc pravilno). */
function deliCasa(cas: Date, pas: string): DelCasa {
  const deli = new Intl.DateTimeFormat("en-GB", {
    timeZone: pas,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(cas);
  const vz = (tip: string) => Number(deli.find((d) => d.type === tip)?.value ?? "0");
  return { leto: vz("year"), mesec: vz("month"), dan: vz("day"), ura: vz("hour") % 24, minuta: vz("minute") };
}

/** Odmik pasu (ms; lokalni cas minus UTC) ob danem trenutku. */
function odmikPasu(trenutek: number, pas: string): number {
  const minuta = Math.floor(trenutek / 60_000) * 60_000;
  const d = deliCasa(new Date(minuta), pas);
  return Date.UTC(d.leto, d.mesec - 1, d.dan, d.ura, d.minuta) - minuta;
}

/**
 * Stenski (lokalni) cas, zapisan kot da bi bil UTC, v pravi trenutek v pasu. Preizkusi vsak odmik pasu v okolici (dan prej in dan pozneje) in obdrzi
 * tiste, pri katerih se odmik ob izracunanem trenutku res ujema: nobeden = ura NE OBSTAJA (pomlad, preskok 02:00 na 03:00), dva = ura je DVOUMNA
 * (jesen, 02:00 do 03:00 se ponovi; vzamemo PRVI pojav, da odsotnost ne traja dlje, kot je lastnik mislil). Pregled C5 (15. 11. 2026).
 */
function razresiStenski(stenski: number, pas: string): { ms: number | null; stanje: "ok" | "neobstojec" | "dvoumen" } {
  const odmiki = new Set([odmikPasu(stenski - 86_400_000, pas), odmikPasu(stenski + 86_400_000, pas)]);
  const veljavni: number[] = [];
  for (const odmik of odmiki) {
    const kandidat = stenski - odmik;
    if (odmikPasu(kandidat, pas) === odmik) veljavni.push(kandidat);
  }
  if (veljavni.length === 0) return { ms: null, stanje: "neobstojec" };
  veljavni.sort((a, b) => a - b);
  return { ms: veljavni[0] ?? null, stanje: veljavni.length > 1 ? "dvoumen" : "ok" };
}

const ISO_KONEC = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/** Izid branja konca: trenutek (ms, UTC) ali null; `neobstojec` pove, da je ISO oblika veljavna, a stenska ura v pasu ne obstaja. */
function razberiKonec(surovo: unknown, pas: string): { ms: number | null; neobstojec: boolean } {
  const nic = { ms: null, neobstojec: false };
  if (typeof surovo !== "string") return nic;
  const m = ISO_KONEC.exec(surovo.trim());
  if (!m) return nic;
  const [, l, me, d, h, mi, s = "0", delSekunde = "0", odmik] = m;
  const leto = Number(l);
  const mesec = Number(me);
  const dan = Number(d);
  const ura = Number(h);
  const minuta = Number(mi);
  const sekunda = Number(s);
  if (leto < ODSOTNOST_LETO_NAJMANJ || leto > ODSOTNOST_LETO_NAJVEC || mesec < 1 || mesec > 12 || dan < 1 || ura > 23 || minuta > 59 || sekunda > 59) return nic;
  const ms = Number(`${delSekunde}00`.slice(0, 3));
  const stenski = Date.UTC(leto, mesec - 1, dan, ura, minuta, sekunda, ms);
  const preizkus = new Date(stenski);
  if (preizkus.getUTCMonth() !== mesec - 1 || preizkus.getUTCDate() !== dan) return nic;
  if (odmik === undefined) {
    const r = razresiStenski(stenski, pas);
    return { ms: r.ms, neobstojec: r.stanje === "neobstojec" };
  }
  if (odmik === "Z") return { ms: stenski, neobstojec: false };
  const predznak = odmik.startsWith("-") ? -1 : 1;
  const oh = Number(odmik.slice(1, 3));
  const om = odmik.length > 3 ? Number(odmik.slice(-2)) : 0;
  if (oh > 23 || om > 59) return nic;
  return { ms: stenski - predznak * (oh * 60 + om) * 60_000, neobstojec: false };
}

/**
 * Konec odsotnosti v ms (UTC) ali null, ce vnos ni razumljiv. Sprejme SAMO strogi ISO »LLLL-MM-DDTHH:MM[:SS[.mmm]][Z|+HH:MM]«
 * (leta 2000 do 2099, obstojec koledarski dan). Z odmikom velja odmik; brez odmika je to stenski cas v pasu uporabnika, ne pasu procesa
 * (Date.parse je »Nov 15 2026 15:00« in »2026-11-15T15:00« bral po pasu strezniskega procesa). Datum brez ure ni konec. Neobstojeca stenska ura
 * (pomlad) je null (nerazumljivo; `konecNeobstojec` pove razlog), dvoumna (jesen) je prvi pojav.
 */
export function konecVMs(surovo: unknown, pas: string = PRIVZETI_CASOVNI_PAS): number | null {
  return razberiKonec(surovo, pas).ms;
}

/** Konec je ISO s stensko uro, ki v casovnem pasu ne obstaja (preskok ob prehodu na poletni cas): savePravila pove jasen razlog. */
export function konecNeobstojec(surovo: unknown, pas: string = PRIVZETI_CASOVNI_PAS): boolean {
  return razberiKonec(surovo, pas).neobstojec;
}

/** Konec je izrecno PRAZEN (brez vrednosti, null, prazen niz ali presledki) = odsotnost brez konca; vse drugo mora biti razumljiv ISO. */
export function konecJePrazen(surovo: unknown): boolean {
  return surovo === undefined || surovo === null || (typeof surovo === "string" && surovo.trim() === "");
}

/** Neprazen vnos, ki ga ne razumemo (nerazumljiv niz, stevilo, objekt ...): NIKOLI ne sme postati odsotnost brez konca. */
export function konecNerazumljiv(surovo: unknown, pas: string = PRIVZETI_CASOVNI_PAS): boolean {
  return !konecJePrazen(surovo) && konecVMs(surovo, pas) === null;
}

/** ISO cas (UTC) ali prazen niz; nerazumljiv vnos je prazen (klicatelj preveri `konecNerazumljiv`). Ura brez odmika je ura v pasu `pas`. */
export function normirajDo(surovo: unknown, pas: string = PRIVZETI_CASOVNI_PAS): string {
  const ms = konecVMs(surovo, pas);
  return ms === null ? "" : new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------------------------------------------------------
// Razlog (zaprt katalog ali kraj) in ime
// ---------------------------------------------------------------------------------------------------------------------------

/** NFKC (siroke crke in stevke drugih pisav postanejo navadne, sestavljene crke se zdruzijo), presledki v enega, brez robnih presledkov. */
export function nfkcVrstica(surovo: string): string {
  return surovo.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

/**
 * Obljuba povratnega klica ali dosegljivosti ni dejstvo o odsotnosti (AGENTS.md: »poklical vas bo ob ...« je prepovedano). To je DRUGA
 * crta obrambe (prva je oblika: katalog ali kraj iz crk); steblo velja za celo besedo kraja.
 */
const OBLJUBA = /\b(poklic\w*|klical\w*|odgovor\w*|javi\w*|javl\w*|vrn\w*|oglas\w*|odzv\w*|odziv\w*|dosegljiv\w*|kontakt\w*|obvesti\w*|obisk\w*|pis(?:i|ite|al|ala)|sporoc\w*)\b/;

/**
 * ZAPRT KATALOG pogostih razlogov (odlocitev izdelka v korist uporabnika, 15. 11. 2026; lastnik jo lahko spremeni): razlog ni vec prosto besedilo,
 * preverjeno po prvi besedi (obe neodvisni pregleda sta nasla, da prosto besedilo za predlogom prehaja obljube, ukaze in nesmisel). Izbira v
 * vmesniku in v pravilih; fraza se izgovori dobesedno (»Ana je do petnajste ure v službi in zato ne more odgovoriti na klic.«).
 */
export const RAZLOGI_KATALOG: readonly string[] = [
  "v službi",
  "na dopustu",
  "na bolniški",
  "pri zdravniku",
  "pri zobozdravniku",
  "na poti",
  "na sestanku",
  "na službeni poti",
  "na obisku",
  "na počitnicah",
  "na predavanju",
  "v bolnišnici",
  "v tujini",
  "doma",
];
const KATALOG_PO_FOLD = new Map(RAZLOGI_KATALOG.map((r) => [fold(r), r]));

/** Fraza iz kataloga (brez velikosti crk in strešic) ali null. */
function izKataloga(brez: string): string | null {
  return KATALOG_PO_FOLD.get(fold(brez)) ?? null;
}

/** Predlog kraja je vedno z malo zacetnico (»V Ljubljani« -> »v Ljubljani«). */
function kanonicenKraj(brez: string): string {
  return brez.replace(/^(?:V|Na|Pri)(?= )/u, (m) => m.toLowerCase());
}

/**
 * KRAJ po zelji lastnika: predlog v/na/pri in 1 do 3 besede, vsaka z veliko zacetnico (lahko z vezajem), SAMO crke a-z ter č š ž ć đ (brez
 * stevk, locil razen vezaja, glagolov, obljub in ukazov; NFKC je ze narejen pred preverbo).
 */
const ZNAKI_KRAJA = /^[A-Za-zČŠŽčšžĆćĐđ -]+$/u;
const BESEDA_KRAJA = "[A-ZČŠŽĆĐ][a-zčšžćđ]+(?:-[A-ZČŠŽĆĐ][a-zčšžćđ]+)?";
const KRAJ = new RegExp(`^(?:v|na|pri) ${BESEDA_KRAJA}(?: ${BESEDA_KRAJA}){0,2}$`, "u");

/**
 * Razlog zavrnitve besedila razloga (null = v redu). Ob shranjevanju in ob vsakem klicu. Veljavno je SAMO: prazno, fraza iz kataloga
 * (`RAZLOGI_KATALOG`) ali kraj (`KRAJ`). Denarni signal: obstojeca preverba lastnikovih besedil (plast.ts razlogPolja).
 */
export function razlogOdsotnosti(razlog: unknown): string | null {
  if (typeof razlog !== "string") return null;
  const surovo = nfkcVrstica(razlog);
  if (!surovo) return null;
  const brez = surovo.replace(/[.!?\s]+$/u, "");
  if (brez.length > ODSOTNOST_NAJVEC_ZNAKOV) return t("odsotnostDolzina");
  // Stevke vseh pisav (arabsko-indijske, devanagari, ...): NFKC pretvori samo siroke; ostale zavrnemo kot stevke.
  if (/\p{N}/u.test(brez)) return t("odsotnostStevke");
  if (izKataloga(brez)) return null;
  const denar = razlogPolja("odsotnost", brez);
  if (denar) return denar;
  if (!ZNAKI_KRAJA.test(brez)) return t("odsotnostZnaki");
  const kraj = kanonicenKraj(brez);
  if (!KRAJ.test(kraj)) return t("odsotnostOblika");
  if (OBLJUBA.test(fold(kraj))) return t("odsotnostObljuba");
  return null;
}

/** Ime lastnika: NFKC, presledki v enega, najvec 60 znakov (pred preverbo oblike). */
export function normirajImeVnos(surovo: unknown): string {
  return typeof surovo === "string" ? nfkcVrstica(surovo).slice(0, 60) : "";
}

/** Beseda imena: velika zacetnica (ali samo inicialka s piko), lahko z vezajem ali opuscajem (»Ana-Marija«, »O'Brien«, »Dr.«). */
const BESEDA_IMENA = /^(?:\p{Lu}\.|\p{Lu}(?:\p{Ll}+|['’]\p{Lu}\p{Ll}+)(?:['’-]\p{Lu}?\p{Ll}+)*\.?)$/u;

/**
 * Ime, ki ga Lina izgovori klicatelju (tudi v stavku odsotnosti): 1 do 3 besede iz latinskih crk, presledka, vezaja, pike in opuscaja, vsaka z
 * veliko zacetnico (null = v redu). NFKC pred preverbo (siroke crke, stevke drugih pisav). Prazno ime je v redu. Brez locil in do treh besed ni stavka;
 * obliko »Ana Ignoriraj Navodila« (tri velike besede) pa sprejme, zato velja se steblo obljube (preostalo tveganje: ime ni nujno ime, nepreverjeno).
 */
export function razlogImena(ime: unknown): string | null {
  if (typeof ime !== "string") return null;
  const surovo = nfkcVrstica(ime);
  if (!surovo) return null;
  if (/\p{N}/u.test(surovo)) return t("imeLastnikaStevke");
  const denar = razlogPolja("ime", surovo);
  if (denar) return denar;
  if (!/^[\p{Script=Latin}'’. -]+$/u.test(surovo)) return t("imeLastnikaOblika");
  const besede = surovo.split(" ");
  if (besede.length > 3 || !besede.every((b) => BESEDA_IMENA.test(b))) return t("imeLastnikaOblika");
  if (OBLJUBA.test(fold(surovo))) return t("imeLastnikaOblika");
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Ura besedno (slovenski vrstilni stevnik v rodilniku: »do petnajste ure«)
// ---------------------------------------------------------------------------------------------------------------------------

/** Ura 1..23 v rodilniku ednine zenskega spola (»do petnajste ure«). */
const URA_ROD = [
  "", "prve", "druge", "tretje", "četrte", "pete", "šeste", "sedme", "osme", "devete", "desete", "enajste", "dvanajste", "trinajste",
  "štirinajste", "petnajste", "šestnajste", "sedemnajste", "osemnajste", "devetnajste", "dvajsete", "enaindvajsete", "dvaindvajsete", "triindvajsete",
];
/** Dan v mesecu 1..31 v rodilniku moskega spola (»petnajstega novembra«). */
const DAN_ROD = [
  "", "prvega", "drugega", "tretjega", "četrtega", "petega", "šestega", "sedmega", "osmega", "devetega", "desetega", "enajstega", "dvanajstega",
  "trinajstega", "štirinajstega", "petnajstega", "šestnajstega", "sedemnajstega", "osemnajstega", "devetnajstega", "dvajsetega", "enaindvajsetega",
  "dvaindvajsetega", "triindvajsetega", "štiriindvajsetega", "petindvajsetega", "šestindvajsetega", "sedemindvajsetega", "osemindvajsetega",
  "devetindvajsetega", "tridesetega", "enaintridesetega",
];
const MESEC_ROD = ["januarja", "februarja", "marca", "aprila", "maja", "junija", "julija", "avgusta", "septembra", "oktobra", "novembra", "decembra"];
const ENICE = ["", "ena", "dva", "tri", "štiri", "pet", "šest", "sedem", "osem", "devet"];
const DESETICE = ["", "", "dvajset", "trideset", "štirideset", "petdeset", "šestdeset", "sedemdeset", "osemdeset", "devetdeset"];
const DESET_DO_19 = ["deset", "enajst", "dvanajst", "trinajst", "štirinajst", "petnajst", "šestnajst", "sedemnajst", "osemnajst", "devetnajst"];

/** Osnovni stevnik 1..99 (»triindvajset«). */
function osnovniStevnik(n: number): string {
  if (n < 10) return ENICE[n] ?? "";
  if (n < 20) return DESET_DO_19[n - 10] ?? "";
  const des = Math.floor(n / 10);
  const eno = n % 10;
  return eno === 0 ? (DESETICE[des] ?? "") : `${ENICE[eno]}in${DESETICE[des]}`;
}

/** Leto 2000..2199 besedno za »leta ...« (»dva tisoč sedemindvajset«, »dva tisoč sto«); lokalno leto po pretvorbi v pas je lahko tudi 2100. */
function letoBesedno(leto: number): string {
  const ostanek = leto - 2000;
  if (ostanek === 0) return "dva tisoč";
  if (ostanek >= 100 && ostanek < 200) return ostanek === 100 ? "dva tisoč sto" : `dva tisoč sto ${osnovniStevnik(ostanek - 100)}`;
  return `dva tisoč ${osnovniStevnik(ostanek)}`;
}

/** Minute z samostalnikom v rodilniku mnozine (»ene minute«, »dveh minut«, »treh minut«, »štirih minut«, »petnajst minut«). */
function minuteBesedno(m: number): string {
  if (m === 1) return "ene minute";
  if (m === 2) return "dveh minut";
  if (m === 3) return "treh minut";
  if (m === 4) return "štirih minut";
  return `${osnovniStevnik(m)} minut`;
}

const jeIstiDan = (a: DelCasa, b: DelCasa): boolean => a.leto === b.leto && a.mesec === b.mesec && a.dan === b.dan;

/** Datum v rodilniku (»petnajstega novembra«); leto (»leta dva tisoč sedemindvajset«) samo, ce je v drugem letu in vec kot pol leta naprej. */
function datumBesedno(d: DelCasa, zdaj: DelCasa, naprejMs: number): string {
  const leto = d.leto !== zdaj.leto && naprejMs > LETO_IZGOVORI_PO_MS ? ` leta ${letoBesedno(d.leto)}` : "";
  return `${DAN_ROD[d.dan] ?? ""} ${MESEC_ROD[d.mesec - 1] ?? ""}${leto}`.replace(/\s+/g, " ").trim();
}

/**
 * Konec odsotnosti besedno za stavek »do ...«: »petnajste ure«, »petnajste ure in trideset minut«, »polnoči«, »trideset minut po polnoči«.
 * Isti dan kot `zdaj` (v casovnem pasu uporabnika): samo ura; drug dan: ura in datum (»petnajste ure šestnajstega novembra«), pri vec kot
 * pol leta naprej v drugem letu tudi leto. Konec ob 00:00 je vedno konec PREJSNJEGA dne: ce je to danes, »polnoči« (klicatelj slisi »do
 * polnoči«, lastnik je vpisal 00:00 naslednjega dne), sicer »konca šestnajstega novembra« (»polnoči šestnajstega« je klicatelj razumel kot
 * 24 ur dlje).
 */
export function casBesedno(konec: Date, zdaj: Date, pas: string): string {
  const k = deliCasa(konec, pas);
  const z = deliCasa(zdaj, pas);
  const naprejMs = konec.getTime() - zdaj.getTime();
  if (k.ura === 0 && k.minuta === 0) {
    const prejsnji = deliCasa(new Date(konec.getTime() - 60_000), pas);
    return jeIstiDan(prejsnji, z) ? "polnoči" : `konca ${datumBesedno(prejsnji, z, naprejMs)}`;
  }
  const ura = k.minuta === 0 ? `${URA_ROD[k.ura]} ure` : `${URA_ROD[k.ura]} ure in ${minuteBesedno(k.minuta)}`;
  const uraPoPolnoci = k.ura === 0 ? `${minuteBesedno(k.minuta)} po polnoči` : ura;
  return jeIstiDan(k, z) ? uraPoPolnoci : `${uraPoPolnoci} ${datumBesedno(k, z, naprejMs)}`.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------------------------------------------------------
// Dejstvo odsotnosti ob klicu
// ---------------------------------------------------------------------------------------------------------------------------

export type AktivnaOdsotnost = { razlog: string; konec: Date | null; pas: string };

/**
 * Odsotnost, ki velja ob tem casu, ali null. Preverba je ob VSAKEM klicu iz podane (sistemske) ure: stikalo izklopljeno (samo logicni `true`
 * vklopi), drug nacin, potekla ali nerazumljiva ura konca (tudi stevilo ali objekt), neveljaven casovni pas = ni povedana (varno: napaka ne sme
 * izreci odsotnosti, ki je ni, ali odsotnosti brez konca, ce je uporabnik vpisal konec). Razlog, ki ne prestane preverbe (datoteka pravil
 * rocno popravljena), se izpusti; ostane samo »trenutno ne more odgovoriti na klic«.
 */
export function aktivnaOdsotnost(p: NastavitveOdsotnosti, zdaj: Date): AktivnaOdsotnost | null {
  if (p.nacinKlica !== "osebna" || p.odsotnostVklop !== true) return null;
  if (!Number.isFinite(zdaj.getTime())) return null;
  const pas = preveriPas(p.odsotnostCasovniPas);
  if (!pas.veljaven) return null;
  let konec: Date | null = null;
  if (!konecJePrazen(p.odsotnostDo)) {
    const ms = konecVMs(p.odsotnostDo, pas.pas);
    if (ms === null) return null;
    if (zdaj.getTime() >= ms) return null;
    // Konec dlje kot eno leto naprej: tipkarska napaka ali stara datoteka; odsotnost se ne izgovori (varna smer).
    if (ms - zdaj.getTime() > ODSOTNOST_NAJVEC_NAPREJ_MS) return null;
    konec = new Date(ms);
  }
  // Razlog, ki ne prestane preverbe (stara datoteka, rocni popravek): odsotnost se NE izreka (stikalo ostane izklopljeno, vmesnik pokaze razlog).
  if (razlogOdsotnosti(p.odsotnostRazlog)) return null;
  const razlog = normirajRazlog(p.odsotnostRazlog);
  return { razlog, konec, pas: pas.pas };
}

const zamenjaj = (besedilo: string, vrednosti: Record<string, string>): string =>
  besedilo.replace(/\{(\w+)\}/g, (m, kljuc: string) => (kljuc in vrednosti ? (vrednosti[kljuc] ?? "") : m)).replace(/\s+/g, " ").trim();

/**
 * Stavek v pozdravu: »Ana je do petnajste ure v službi in zato ne more odgovoriti na klic.« Brez razloga »Ana do petnajste ure ne more
 * odgovoriti na klic.«, brez razloga in konca »Ana trenutno ne more odgovoriti na klic.«, brez imena brez osebka (»Trenutno ne more ...«, 21. 11. 2026); ime s stevko ali
 * ceno se ne izgovori (ista preverba kot razlog). Spola ne ugiba (glagoli v sedanjiku so brez spola). Prazen niz = odsotnost ne velja.
 */
export function odsotnostStavek(p: NastavitveOdsotnosti, zdaj: Date): string {
  const o = aktivnaOdsotnost(p, zdaj);
  if (!o) return "";
  const ime = normirajImeVnos(p.imeLastnika);
  // Brez imena (lastnik 21. 11. 2026: osebna tajnica nikoli ne rece »oseba«, »podjetje« ...): stavek brez osebka z veliko zacetnico.
  const kdo = ime && !razlogImena(ime) ? ime : "";
  const cas = o.konec ? casBesedno(o.konec, zdaj, o.pas) : "";
  const kljuc = o.razlog ? (cas ? "odsotnostRazlogDo" : "odsotnostRazlogSamo") : cas ? "odsotnostSamoDo" : "odsotnostBrez";
  const stavek = zamenjaj(t(kljuc), { kdo, cas, razlog: o.razlog });
  return kdo ? stavek : stavek.charAt(0).toUpperCase() + stavek.slice(1);
}

/** Katero dejstvo klicatelj sprasuje: kje je (razlog), kdaj bo na voljo (konec), ali oboje. */
export type VrstaVprasanjaOdsotnosti = "kje" | "kdaj" | "oboje";

/**
 * Odgovor na vprasanje klicatelja SAMO iz tega, kar je uporabnik vpisal (»Je do petnajste ure v službi.«): nikoli obljuba povratnega klica,
 * nikoli domneva. Za »kje je« je potreben vpisan razlog, za »kdaj bo na voljo« vpisan konec; drugace prazen niz (klicatelj dobi »Tega ne vem«).
 */
export function odsotnostOdgovor(p: NastavitveOdsotnosti, vrsta: VrstaVprasanjaOdsotnosti, zdaj: Date): string {
  const o = aktivnaOdsotnost(p, zdaj);
  if (!o) return "";
  const cas = o.konec ? casBesedno(o.konec, zdaj, o.pas) : "";
  if (vrsta === "kje" && !o.razlog) return "";
  if (vrsta === "kdaj" && !cas) return "";
  if (!o.razlog && !cas) return "";
  const kljuc = o.razlog ? (cas ? "odsotnostOdgRazlogDo" : "odsotnostOdgRazlog") : "odsotnostOdgDo";
  return zamenjaj(t(kljuc), { cas, razlog: o.razlog });
}

// ---------------------------------------------------------------------------------------------------------------------------
// Vprasanje klicatelja o odsotnosti (pravila brez modela)
// ---------------------------------------------------------------------------------------------------------------------------

const PRED = "(?:(?:a|ali|pa|no|halo|oprostite|prosim|in)\\s+)*";
const PO = "(?:\\s+(?:prosim|zdaj|trenutno|danes|pa|sploh|sedaj|v tem trenutku))*";
const NA_VOLJO = "(?:na voljo|nazaj|dosegljiv\\w*|v pisarni|tam|doma|prost\\w*|spet na voljo)";
const STANJE = "(?:v sluzbi|odsotn\\w*|na dopustu|zaseden\\w*|na poti|na sestanku)";

/**
 * Vprasanje, ki ga pravila prepoznajo kot vprasanje o odsotnosti. NATANCNI vzorci cez CEL izrek (najvec 9 besed, ime lastnika dovoljeno):
 * »kje je (Ana)«, »kdaj bo (Ana) na voljo«, »a je (Ana) v službi«. Daljsi izrek ali sporocilo (»povejte mu, kje je ključ«) NI vprasanje
 * o odsotnosti in se zapise kot sporocilo; STT-popacen izrek ne ustreza in dobi obstojeci odgovor »Tega ne vem«.
 */
export function vrstaVprasanjaOdsotnosti(izrek: string, ime = ""): VrstaVprasanjaOdsotnosti | null {
  const k = fold(izrek).replace(/[^\p{L}\d]+/gu, " ").replace(/\s+/g, " ").trim();
  if (!k || k.split(" ").length > 9) return null;
  const imeBesede = fold(ime).split(/[^\p{L}]+/u).filter((b) => b.length >= 3);
  // Ime (tudi v sklonu: »Ano«, »Ani«) na mestu imena v vzorcu.
  // Imena na »a« se sklanjajo z zadnjo crko (Ana, Ane, Ani, Ano), druga imajo koncnico do dveh crk (Peter, Petra, Petrom); drugih besed ne spusti.
  const sklon = (b: string) => (b.endsWith("a") ? `${b.slice(0, -1)}[aeiou]` : `${b}\\w{0,2}`);
  // Polno ime (»Kje je Ana Novak?«), z nazivom (»gospa Novak«, »dr Novak«): do tri besede imena (pregled N4).
  const ID = imeBesede.length > 0 ? `(?:\\s+(?:gospod\\w{0,2}|gospa|gospe|gospo|dr))?(?:\\s+(?:${imeBesede.map(sklon).join("|")})){0,3}` : "";
  const kje = new RegExp(`^${PRED}(?:kje (?:je|ga|jo|pa je|se nahaja)${ID}|kje ga najdem|kje jo najdem)${PO}$`);
  const kdaj = new RegExp(
    `^${PRED}(?:kdaj bo${ID}(?: spet| zopet| znova)? ${NA_VOLJO}|kdaj se${ID} vrne(?: nazaj| domov)?|kdaj pride${ID}(?: nazaj| domov| spet)?|do kdaj (?:je|bo)${ID}(?: ${STANJE})?|kdaj ga (?:lahko )?(?:dobim|dosezem|poklicem)|kdaj jo (?:lahko )?(?:dobim|dosezem|poklicem)|kdaj ga (?:bo|je) mogoce (?:dobiti|poklicati|doseci)|kdaj jo (?:bo|je) mogoce (?:dobiti|poklicati|doseci))${PO}$`,
  );
  const stanje = new RegExp(`^${PRED}(?:a |ali )?je${ID} ${STANJE}${PO}$`);
  const zakaj = new RegExp(`^${PRED}zakaj (?:se ne (?:oglasi|javi|oglasa|javlja)|ne (?:odgovori|odgovarja|dviga|more odgovoriti|more na telefon))${ID}${PO}$`);
  if (kje.test(k) || stanje.test(k) || zakaj.test(k)) return "kje";
  if (kdaj.test(k)) return "kdaj";
  return null;
}
