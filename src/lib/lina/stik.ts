/**
 * Stik klicatelja: ime in priimek, telefon, e-posta, dosegljivost.
 * Vidna stevilka iz From je telefon stika ze ob zacetku klica (G4d, lastnik 11. 11. 2026: podjetje pokliche nazaj na
 * stevilko, s katere klicatelj klice, zato je ne vprasamo); skrita stevilka ostane manjkajoc podatek.
 * Stevilka, ki jo klicatelj pove sam, prepise From.
 * Ena funkcija zajame stik in ga pobrise iz besedila, da ne gre v dnevnik ali vrzel.
 */
import { t } from "./besedila.ts";
import { fold } from "./guards.ts";
import type { OrderSlip, StikKlica } from "./types.ts";

export type ManjkaStik = "ime" | "telefon" | "eposta";

const PREDLOG = new Set(["iz", "z", "s", "v", "na", "pri", "za", "od", "do", "k", "h", "o", "po", "ob"]);
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
/** Vsaj 8 stevk. Pike in posevnice niso telefon, da datum ne postane stevilka. */
const TELEFON = /(?:\+\d(?:[\d\s()-]*\d){7,}|\b\d(?:[\d\s()-]*\d){7,})/g;

/** Skrita stevilka (Twilio: anonymous, restricted, unavailable, +266696687 ...), prazno ali brez stevk. */
const SKRITA_STEVILKA = /anonym|restrict|unavail|withheld|blocked|private|unknown|neznan|^\+?266696687$/i;

/** Stevilka iz From je vidna, ce ni skrita in ima vsaj 6 stevk. Brez tega obljuba o povratnem klicu ne drzi. */
export function jeVidnaStevilka(from: string | undefined | null): boolean {
  const f = (from ?? "").trim();
  return f !== "" && !SKRITA_STEVILKA.test(f) && (f.match(/\d/g) ?? []).length >= 6;
}

export function prazenStik(from = ""): StikKlica {
  // Vidna stevilka klicatelja je telefon stika od zacetka: ne steje kot manjkajoc podatek in Lina je ne vprasa.
  return { vprasan: false, konec: false, ime: "", telefon: jeVidnaStevilka(from) ? from.trim() : "", email: "" };
}

/** Klicatelj reče, da naj ga poklicemo na drugo stevilko (brez da bi jo povedal): prva stevilka ne velja vec. */
function drugaStevilka(text: string): boolean {
  const kljuc = fold(text);
  return /\b(drug\w* (telefonsk\w* )?(stevilk|telefon)\w*|na drugo stevilko|ne na to stevilko|ne na ta telefon)\b/.test(kljuc);
}

export function manjkajoci(stik: StikKlica): ManjkaStik[] {
  const out: ManjkaStik[] = [];
  if (!stik.ime) out.push("ime");
  if (!stik.telefon) out.push("telefon");
  // G4g: klicateljeve e-poste Lina ne sprasuje in ne opozarja nanjo; polje ostane v zapisu (>>ni dan<<) za stare klice.
  return out;
}

function jeImeBeseda(beseda: string): boolean {
  const cisto = beseda.replace(/^[^\p{L}]+|[^\p{L}'’-]+$/gu, "");
  if (!cisto || PREDLOG.has(cisto.toLowerCase())) return false;
  return /^\p{Lu}[\p{L}'’-]{1,30}$/u.test(cisto);
}

function dveBesedi(kos: string): string | null {
  const ime: string[] = [];
  for (const beseda of kos.trim().split(/\s+/)) {
    if (!jeImeBeseda(beseda)) {
      if (ime.length === 0) return null;
      break;
    }
    ime.push(beseda.replace(/[.,;:!?]+$/g, ""));
    if (ime.length === 2) return `${ime[0]} ${ime[1]}`;
  }
  return null;
}

/** Besede, s katerimi klicatelj zacne odgovor in niso ime (»Da, Ana Novak.« ni »Da Ana«). */
const UVOD_ODGOVORA = new Set([
  "da", "ja", "seveda", "ne", "no", "ok", "okej", "tukaj", "tu", "tule", "dober", "dan", "dobro", "jutro", "vecer",
  "pozdravljeni", "pozdrav", "lep", "zdravo", "zivjo", "hvala", "prosim", "gospod", "gospa", "jaz", "sem", "je",
  "ime", "moje", "mi", "to", "pri", "telefonu", "klicem", "klice",
]);

function goloKljuc(beseda: string): string {
  return beseda
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z'-]/g, "");
}

/** Sklanjatev iste besede: »Mizo« je »miza«, »Hrasta« je »hrast«; »Hrastnik« ni »hrast«. */
function istaBeseda(a: string, b: string): boolean {
  if (!a || !b || Math.abs(a.length - b.length) > 1) return false;
  const krajsa = Math.min(a.length, b.length);
  if (krajsa < 3) return a === b;
  let skupno = 0;
  while (skupno < krajsa && a[skupno] === b[skupno]) skupno += 1;
  return skupno >= krajsa - 1;
}

/** Pravna oblika za imenom: jasen znak podjetja. */
const PRAVNA_OBLIKA = /(?<![\p{L}])(d\.\s?o\.\s?o\.?|d\.\s?d\.?|s\.\s?p\.?|d\.\s?n\.\s?o\.?|k\.\s?d\.?|z\.\s?o\.\s?o\.?|z\.\s?b\.\s?o\.?|doo|gmbh|ltd)(?![\p{L}])/iu;
/** Besede dejavnosti in ustanov (koren). Niso seznam podjetij: opisujejo, s cim se nekdo ukvarja. */
const DEJAVNOST =
  /^(zeleznic|podjetj|druzb|zavod|drustv|zadrug|obcin|trgovin|servis|gradnj|prevoz|transport|storitv|inzeniring|elektro|avto|studio|salon|center|klinik|hotel|gostiln|picerij|kmetij|bank|sol|group|holding|commerce|trade|montaz|instalacij|komunal|post|agencij|tovarn|obrt)(a|e|i|o|u|je|ja|ju|ih|em|om|ov|ami)?$/;
/** Pripone dejavnosti: mizarstvo, tesarstvo, racunovodstvo; pekarna, tiskarna; zavarovalnica, knjigarna. */
const PRIPONA_DEJAVNOSTI = /(arstvo|ovodstvo|instvo|nistvo|ilstvo|arna|alnica|ilnica)$/;
/** Pridevniki, s katerimi se zacnejo kraji in ustanove (»Nova Gorica«, »Murska Sobota«), ne osebna imena. */
const KRAJEVNI_PRIDEVNIK = new Set([
  "nova", "novo", "novi", "stara", "stari", "staro", "gornja", "gornji", "dolnja", "dolnji", "spodnja", "spodnji",
  "zgornja", "zgornji", "velika", "veliki", "velike", "sveti", "sveta", "skofja", "murska", "slovenj", "ilirska",
  "slovenska", "kranjska", "dolenjska", "gorenjska", "primorska", "stajerska", "koroska",
]);
/** Pridevnik na -ski/-ske/-sko (tudi -ški, -čki): »Slovenske«, »Ljubljanski«, »Mariborsko« ni osebno ime. */
const PRIDEVNIK_SKI = /[a-z]{3,}(s|c)k(i|e|o)$/;

export type VrstaImena = "oseba" | "podjetje" | "kraj";

/**
 * HEVRISTIKA, ne seznam imen: iz oblike dveh besed oceni, ali sta ime osebe, podjetje ali kraj.
 * Pregled G2 (N8): »Slovenske Železnice«, »Mizarstvo Kovač« in »Nova Gorica« so postali ime klicatelja.
 * Znaki: pravna oblika za besedama (d.o.o., s.p.), beseda ali pripona dejavnosti, krajevni pridevnik,
 * pridevnik na -ski/-ske, beseda iz naslova podjetja v katalogu (kraji). Zmoti se pri redkih primerih
 * (priimek »Zavod«, podjetje iz dveh osebnih imen brez pravne oblike); takrat ostane ime ali »ni podatka«.
 */
export function vrstaImena(prva: string, druga: string, ostanek = "", kraji: readonly string[] = []): VrstaImena {
  const a = goloKljuc(prva);
  const b = goloKljuc(druga);
  if (PRAVNA_OBLIKA.test(ostanek)) return "podjetje";
  if (DEJAVNOST.test(a) || DEJAVNOST.test(b) || PRIPONA_DEJAVNOSTI.test(a) || PRIPONA_DEJAVNOSTI.test(b)) return "podjetje";
  const krajevne = kraji.flatMap((vnos) => vnos.split(/[\s,]+/)).map(goloKljuc).filter((kljuc) => kljuc.length >= 4);
  if (krajevne.some((kljuc) => istaBeseda(a, kljuc) || istaBeseda(b, kljuc))) return "kraj";
  if (PRIDEVNIK_SKI.test(a)) return DEJAVNOST.test(b) || PRIPONA_DEJAVNOSTI.test(b) ? "podjetje" : "kraj";
  if (KRAJEVNI_PRIDEVNIK.has(a)) return "kraj";
  return "oseba";
}

type GoliPar = { par: string; vrsta: VrstaImena; pravna: string };

/** Prvi par besed z veliko zacetnico v odgovoru, z oceno vrste. */
function goliPari(text: string, izloci: readonly string[], kraji: readonly string[]): GoliPar[] {
  const prepovedane = izloci.flatMap((vnos) => vnos.split(/\s+/)).map(goloKljuc).filter((kljuc) => kljuc.length >= 3);
  const izKataloga = (beseda: string) => prepovedane.some((kljuc) => istaBeseda(goloKljuc(beseda), kljuc));
  const ven: GoliPar[] = [];
  // Pika v »d.o.o.« ni konec dela: pravno obliko najprej zavarujemo.
  const zavarovano = text.replace(PRAVNA_OBLIKA, (oblika) => ` ${oblika.replace(/[.\s]/g, "")}§ `);
  for (const del of zavarovano.split(/[.,;:!?\n]+/)) {
    const besede = del.trim().split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < besede.length && UVOD_ODGOVORA.has(goloKljuc(besede[i]))) i += 1;
    const prva = besede[i];
    const druga = besede[i + 1];
    if (!prva || !druga || prva.endsWith("§") || druga.endsWith("§")) continue;
    if (!jeImeBeseda(prva) || !jeImeBeseda(druga)) continue;
    if (UVOD_ODGOVORA.has(goloKljuc(druga)) || izKataloga(prva) || izKataloga(druga)) continue;
    const pravna = besede.slice(i + 2).find((beseda) => beseda.endsWith("§")) ?? "";
    const vrsta = pravna ? "podjetje" : vrstaImena(prva, druga, "", kraji);
    ven.push({ par: `${prva} ${druga}`, vrsta, pravna: pravna.replace("§", "") });
  }
  return ven;
}

/** Podjetje, povedano namesto imena (»Mizarstvo Kovač«, »Ana Primer d.o.o.«), ali null. Hevristika, glej vrstaImena. */
export function goloPodjetje(text: string, izloci: readonly string[] = [], kraji: readonly string[] = []): string | null {
  const zadetek = goliPari(text, izloci, kraji).find((par) => par.vrsta === "podjetje");
  return zadetek ? `${zadetek.par} ${zadetek.pravna}`.trim() : null;
}

/**
 * Golo ime v odgovoru na vprasanje po imenu. Pregled 10. 11. 2026: »Ana Novak, nisem iz podjetja.« ni bil
 * prepoznan, »Da, Ana Novak.« je dal ime »Da Ana«, »Mizo Alba iz hrasta« pa ime »Mizo Alba«.
 * Ime sta dve besedi z veliko zacetnico na zacetku stavka ali za vejico; uvodne besede preskocimo,
 * besed iz kataloga (izdelek, material) ne stejemo za ime, med imenom in priimkom ni locila.
 */
function goloIme(text: string, izloci: readonly string[], kraji: readonly string[]): string | null {
  // Podjetje ali kraj ni ime osebe; ime je lahko v naslednjem delu stavka (»Mizarstvo Kovač, Ana Novak.«).
  return goliPari(text, izloci, kraji).find((par) => par.vrsta === "oseba")?.par ?? null;
}

/**
 * Ime in priimek. Velika zacetnica, brez predlogov.
 * Fraze sem, tukaj je in tu je stejejo. Golo ime samo, ko cakamo odgovor na vprasanje.
 */
export function razberiIme(text: string, vprasan = false, izloci: readonly string[] = [], kraji: readonly string[] = []): string | null {
  const pri = text.match(/(\p{Lu}[\p{L}'’-]{1,30})\s+(\p{Lu}[\p{L}'’-]{1,30})\s+pri telefonu/u);
  if (pri && !PREDLOG.has(pri[1].toLowerCase()) && !PREDLOG.has(pri[2].toLowerCase())) {
    return `${pri[1]} ${pri[2]}`;
  }
  const uvod = text.match(
    /(?:ime mi je|ime je|kli[čc]em se|jaz sem|tukaj je|tu je|(?<![\p{L}])sem)\s+([^\n]{0,80})/iu,
  );
  const poFraziSurovo = uvod ? dveBesedi(uvod[1]) : null;
  // »Tukaj Mizarstvo Kovač« je podjetje, ne oseba.
  const [prva = "", druga = ""] = (poFraziSurovo ?? "").split(" ");
  const poFrazi = poFraziSurovo && vrstaImena(prva, druga, uvod?.[1] ?? "", kraji) === "oseba" ? poFraziSurovo : null;
  if (poFrazi || !vprasan) return poFrazi;
  return goloIme(text, izloci, kraji);
}

function stevke(value: string): number {
  return value.replace(/\D/g, "").length;
}

/** Telefon ima vsaj 8 stevk in nima pike ali posevnice. Datum tako odpade. */
export function poisciTelefon(text: string): string | null {
  const zadetki = text.match(TELEFON) ?? [];
  for (const kos of zadetki) {
    if (/[./]/.test(kos)) continue;
    if (stevke(kos) < 8) continue;
    return kos.replace(/\s+/g, " ").trim();
  }
  return null;
}

const STEVKA: Record<string, string> = {
  nic: "0", nicla: "0", nula: "0", ena: "1", eden: "1", en: "1", eno: "1", dva: "2", dve: "2", tri: "3", stiri: "4",
  pet: "5", sest: "6", sedem: "7", osem: "8", devet: "9",
};

/**
 * Narekovana stevilka z besedami: »nič ena štiri nič, ena dva tri, štiri pet šest« -> »0140 123 456« oblika iz stevk.
 * Meritev vodje 10. 11. 2026: prepoznava govora vrne stevke kot besede. Velja niz vsaj 8 zaporednih stevk
 * (vmes samo vejice), od tega vsaj tri z besedo - stevilko iz samih stevk ze prepozna poisciTelefon, datum
 * s pikami pa ni narek. »plus« na zacetku ostane. Krajsi niz ni telefon.
 */
export function telefonIzBesed(text: string): string | null {
  // Pika med stevkami je datum (»01.12.2026«), ne narek: locimo samo po vejicah in presledkih.
  const besede = fold(text).replace(/[,;]/g, " ").split(/\s+/).map((beseda) => beseda.replace(/[.!?]+$/, "")).filter(Boolean);
  let najboljsi = { niz: "", besed: 0 };
  let tek = { niz: "", besed: 0 };
  const zakljuci = () => {
    if (tek.besed >= 3 && tek.niz.replace(/\D/g, "").length > najboljsi.niz.replace(/\D/g, "").length) najboljsi = tek;
    tek = { niz: "", besed: 0 };
  };
  for (const beseda of besede) {
    if (beseda === "plus" && !tek.niz) tek.niz = "+";
    else if (STEVKA[beseda] !== undefined) tek = { niz: tek.niz + STEVKA[beseda], besed: tek.besed + 1 };
    else if (/^\d{1,4}$/.test(beseda)) tek.niz += beseda;
    else zakljuci();
  }
  zakljuci();
  const stevk = najboljsi.niz.replace(/\D/g, "").length;
  if (stevk < 8 || stevk > 15) return null;
  if (najboljsi.niz.startsWith("+")) return najboljsi.niz;
  // Mednarodna predpona brez plusa (»tri osem šest ...«) dobi plus; domaca stevilka ostane z niclo.
  return najboljsi.niz.startsWith("386") && stevk >= 10 ? `+${najboljsi.niz}` : najboljsi.niz;
}

/** Koliko stevk (besed ali znakov) je v odgovoru: ali je klicatelj sploh narekoval stevilko. */
export function steviloStevk(text: string): number {
  return fold(text)
    .replace(/[,;]/g, " ")
    .split(/\s+/)
    .map((beseda) => beseda.replace(/[.!?]+$/, ""))
    .reduce((vsota, beseda) => vsota + (STEVKA[beseda] !== undefined ? 1 : /^\d+$/.test(beseda) ? beseda.length : 0), 0);
}

function potrdiFrom(text: string): boolean {
  const kljuc = fold(text);
  return (
    /\bstevilka s katere klicam\b/.test(kljuc) ||
    /\bta stevilka je moja\b/.test(kljuc) ||
    /\bto je moja stevilka\b/.test(kljuc) ||
    /\bpotrjujem stevilko\b/.test(kljuc) ||
    /\bpotrjujem telefonsko\b/.test(kljuc)
  );
}

type PisaniKos = { email: string; start: number; end: number };

const USTAVI_POSTO = new Set([
  "moj", "moja", "moje", "mail", "eposta", "posta", "je", "telefon", "telefonska", "telefonski",
  "stevilka", "stevilko", "ime", "priimek", "in", "ter", "hvala", "prosim", "klicem", "sem",
  "jaz", "tukaj", "tu", "iz", "za", "na", "po", "ali", "kaj", "ker", "da", "ne",
]);

function jeAtomPoste(kljuc: string): boolean {
  return /^[a-z0-9._%+-]+$/i.test(kljuc) && !/^\d+$/.test(kljuc) && !USTAVI_POSTO.has(kljuc);
}

function jeSimbolPoste(kljuc: string): boolean {
  return kljuc === "pika" || kljuc === "minus" || kljuc === "podcrtaj" || kljuc === "afna";
}

function znakPoste(kljuc: string, raw: string): string {
  if (kljuc === "afna") return "@";
  if (kljuc === "pika") return ".";
  if (kljuc === "minus") return "-";
  if (kljuc === "podcrtaj") return "_";
  return raw;
}

/** Govorna e-posta: afna, pika, minus, podcrtaj. Ne pogoltne imena ali telefona pred vejico. */
function govornaPosta(text: string): PisaniKos | null {
  const tokeni = [...text.matchAll(/\S+/g)];
  const kljuci = tokeni.map((m) => m[0].replace(/^[.,;:!?]+|[.,;:!?]+$/g, "").toLowerCase());
  const afna = kljuci.findIndex((kos) => kos === "afna");
  if (afna < 0) return null;
  const vejica = (i: number, j: number) => text.slice(tokeni[i].index ?? 0, tokeni[j].index ?? 0).includes(",");
  let levo = afna;
  let desno = afna;
  while (levo > 0 && !vejica(levo - 1, levo) && (jeAtomPoste(kljuci[levo - 1]) || jeSimbolPoste(kljuci[levo - 1]))) {
    levo -= 1;
  }
  while (
    desno + 1 < tokeni.length &&
    !vejica(desno, desno + 1) &&
    (jeAtomPoste(kljuci[desno + 1]) || jeSimbolPoste(kljuci[desno + 1]))
  ) {
    desno += 1;
  }
  const email = tokeni
    .slice(levo, desno + 1)
    .map((m, i) => znakPoste(kljuci[levo + i], m[0].replace(/^[.,;:!?]+|[.,;:!?]+$/g, "")))
    .join("");
  if (!EMAIL.test(email)) return null;
  return { email, start: tokeni[levo].index ?? 0, end: (tokeni[desno].index ?? 0) + tokeni[desno][0].length };
}

function poisciEmail(text: string): { email: string; start: number; end: number } | null {
  const govorna = govornaPosta(text);
  if (govorna) return govorna;
  const zadetek = EMAIL.exec(text);
  EMAIL.lastIndex = 0;
  if (!zadetek || zadetek.index === undefined) return null;
  return { email: zadetek[0], start: zadetek.index, end: zadetek.index + zadetek[0].length };
}

function izrezi(text: string, razponi: Array<{ start: number; end: number }>): string {
  const urejeni = [...razponi].sort((a, b) => b.start - a.start);
  let ven = text;
  for (const razpon of urejeni) ven = `${ven.slice(0, razpon.start)} ${ven.slice(razpon.end)}`;
  return ven.replace(/\s+/g, " ").replace(/\s+([,.;])/g, "$1").trim();
}

export type ZajetStik = { ime: string; telefon: string; email: string; besedilo: string };

/** Zajame stik in vrne besedilo brez njega. Golo ime samo, ce cakamo odgovor. */
export function zajemiStik(
  text: string,
  vprasan = false,
  izloci: readonly string[] = [],
  kraji: readonly string[] = [],
): ZajetStik {
  const ime = razberiIme(text, vprasan, izloci, kraji) ?? "";
  const telefon = poisciTelefon(text) ?? telefonIzBesed(text) ?? "";
  const posta = poisciEmail(text);
  const razponi: Array<{ start: number; end: number }> = [];
  if (posta) razponi.push(posta);
  if (telefon) {
    const at = text.indexOf(telefon);
    if (at >= 0) razponi.push({ start: at, end: at + telefon.length });
  }
  if (ime) {
    const at = text.indexOf(ime);
    if (at >= 0) razponi.push({ start: at, end: at + ime.length });
  }
  return { ime, telefon, email: posta?.email ?? "", besedilo: izrezi(text, razponi) };
}

/**
 * Doda samo tisto, kar je klicatelj v tem stavku sam povedal.
 * »ni dan« ni podatek: ce klicatelj podatek pove pozneje, ga zapisemo.
 * vprasan: cakamo odgovor (tudi na prvo vprasanje po imenu, ko stik se ni odprt).
 */
export function dopolniStik(
  stik: StikKlica,
  text: string,
  from: string,
  moznosti: { vprasan?: boolean; izloci?: readonly string[]; kraji?: readonly string[] } = {},
): StikKlica {
  const next = { ...stik };
  const ni = t("niDan");
  const zajeto = zajemiStik(text, moznosti.vprasan ?? stik.vprasan, moznosti.izloci ?? [], moznosti.kraji ?? []);
  if ((!next.ime || next.ime === ni || next.ime === t("niPodatka")) && zajeto.ime) next.ime = zajeto.ime;
  // Telefon iz From je ze v stiku (G4d); stevilka, ki jo klicatelj pove sam, ga prepise.
  const izFrom = Boolean(from) && next.telefon === from.trim();
  if (!next.telefon || next.telefon === ni || izFrom) {
    if (zajeto.telefon) next.telefon = zajeto.telefon;
    else if (izFrom && drugaStevilka(text)) next.telefon = "";
    else if (from && potrdiFrom(text) && jeVidnaStevilka(from)) next.telefon = from.trim();
  }
  if ((!next.email || next.email === ni) && zajeto.email) next.email = zajeto.email;
  return next;
}

export type ZavrnitevStika = { splosno: boolean; ime: boolean; telefon: boolean; email: boolean };

/** Ni dan samo ob izrecni zavrnitvi, ne ker razclenjevalnik nic ne najde. */
export function jeZavrnitev(text: string): ZavrnitevStika {
  const kljuc = fold(text);
  const ne = /\b(ne zelim|ne dam|ne povem|nocem|nočem|ne bom povedal|ne maram|ne vem|nimam|nima)\b/.test(kljuc);
  const email = /\b(e-?post|mail|elektronsk)\w*/.test(kljuc);
  const telefon = /\b(telefon|stevilk)\w*/.test(kljuc);
  const ime = /\b(ime|priimek)\b/.test(kljuc);
  const splosno = ne && !email && !telefon && !ime;
  return { splosno, ime: ne && ime, telefon: ne && telefon, email: ne && email };
}

/** Manjkajoce po zavrnitvi zapisemo kot ni dan in ne vprasamo vec. Znano ime ostane. */
export function zapriStik(stik: StikKlica): StikKlica {
  const ni = t("niDan");
  return {
    ...stik,
    vprasan: true,
    konec: true,
    // Imena, ki ga klicatelj ni povedal, ne ugibamo: »ni podatka« (slog besedil, razdelek 4).
    ime: stik.ime || t("niPodatka"),
    telefon: stik.telefon || ni,
    email: stik.email || ni,
  };
}

export function uveljaviStik(order: OrderSlip, stik: StikKlica): OrderSlip {
  const next = { ...order };
  const ni = t("niDan");
  const brezImena = stik.ime === ni || stik.ime === t("niPodatka");
  const znanoIme = Boolean(next.customerName) && next.customerName !== ni && next.customerName !== t("niPodatka");
  if (stik.ime && !(brezImena && znanoIme)) next.customerName = stik.ime;
  if (stik.telefon) next.phone = stik.telefon;
  if (stik.email) next.email = stik.email;
  return next;
}

export function besediloVprasanja(manjka: ManjkaStik[]): string {
  const deli: string[] = [];
  if (manjka.includes("ime")) deli.push(t("prosiIme"));
  if (manjka.includes("telefon")) deli.push(t("prosiTelefon"));
  if (manjka.includes("eposta")) deli.push(t("prosiEposto"));
  return deli.join(" ");
}

export function besediloOpozorila(manjka: ManjkaStik[]): string {
  const deli = [t("casOmejitev")];
  if (manjka.length > 0) deli.push(besediloVprasanja(manjka));
  deli.push(t("casSodelavec"));
  return deli.join(" ");
}

function brezNarekovanihStevk(text: string): string {
  return text
    .split(/\s+/)
    .filter((beseda) => {
      const kljuc = fold(beseda).replace(/[,;.]/g, "");
      return STEVKA[kljuc] === undefined && !/^\+?\d+$/.test(kljuc) && kljuc !== "plus";
    })
    .join(" ");
}

/** Iz dnevnika ven ime, e-posta in telefon, tudi govorne oblike. */
export function redigirajDnevnik(text: string, vprasan = false, izloci: readonly string[] = [], kraji: readonly string[] = []): string {
  const zajeto = zajemiStik(text, vprasan, izloci, kraji);
  // Stevilka, narekovana z besedami, je v besedilu drugacna kot zajeta: v dnevnik ne gre ne ena ne druga.
  const narek = !poisciTelefon(text) && telefonIzBesed(text) ? brezNarekovanihStevk(zajeto.besedilo) : zajeto.besedilo;
  const besedilo = narek;
  return besedilo.replace(/\b(ime mi je|ime je|klicem se|kličem se|jaz sem|tukaj je|tu je|moj mail je|telefon)\b/gi, " ").replace(/\s+/g, " ").trim();
}

/**
 * Sporocilo brez IZGOVORJENEGA stika (e-naslov z »afna«, telefon s stevkami z besedo). ocistiSporocilo odstrani samo zapisan stik (stevke, @);
 * drugi slepi pregled 14. 11. 2026: izgovorjena stevilka je sla v `izrek` sporocila in z njim v vhod modela. Ime ostane (je vsebina sporocila).
 */
export function brezIzgovorjenegaStika(text: string): string {
  let ven = text;
  const posta = poisciEmail(ven);
  if (posta) ven = izrezi(ven, [posta]);
  if (!poisciTelefon(ven) && telefonIzBesed(ven)) ven = brezNarekovanihStevk(ven);
  return ven.replace(/\s+/g, " ").trim();
}

/**
 * Ali je v ODREZANEM delu izreka lahko zacetek stika (stevka, stevka z besedo, »plus«, »afna«, »pika«, @). Redakcija prepozna stik sele v celem
 * izreku, zato tak del do zdruzitve ne gre v prepis (drugi slepi pregled 14. 11. 2026: ob izteku nadaljevanja, ponovnem zagonu ali odlozitvi je
 * delna stevilka ostala v vrstici dela).
 */
export function lahkoDelStika(text: string): boolean {
  if (/[\d@]/.test(text)) return true;
  return text.split(/\s+/).some((beseda) => {
    const kljuc = fold(beseda).replace(/[^\p{L}]+/gu, "");
    return STEVKA[kljuc] !== undefined || kljuc === "plus" || kljuc === "afna" || kljuc === "pika";
  });
}

/** Kljuc besede za poravnavo vrstic izreka: brez locil, male crke. */
const kljucBesede = (beseda: string): string => beseda.toLowerCase().replace(/[^\p{L}\d]+/gu, "");
const kljuciBesed = (besedilo: string): string[] => besedilo.split(/\s+/).map(kljucBesede).filter(Boolean);

/** Ali so besede vrstic (po vrsti) podzaporedje besed celote: vrstice so deli tega izreka (redakcija dela besede samo izpusca). */
export function soDeliIzreka(vrstice: readonly string[], celota: string): boolean {
  const cilj = kljuciBesed(celota);
  let j = 0;
  for (const beseda of vrstice.flatMap(kljuciBesed)) {
    while (j < cilj.length && cilj[j] !== beseda) j += 1;
    if (j >= cilj.length) return false;
    j += 1;
  }
  return true;
}

/**
 * Redakcija izreka, ki ga je premor razdelil na vec vrstic prepisa (neodvisni pregled 14. 11. 2026: narek telefonske stevilke ali e-naslova se
 * prepozna samo v ZDRUZENEM izreku, po delih je ostal v prepisu). `vrstice` so deli izreka po vrsti, `zdruzenoRedigirano` je redigiran zdruzeni
 * izrek. V vsaki vrstici ostanejo samo besede, ki jih ima redigirani zdruzeni izrek (isti vrstni red): vse vrstice skupaj dajo natanko redigirani
 * zdruzeni izrek, torej nic, kar je redakcija izlocila. Ce se besede ne dajo poravnati (redakcija je besedo spremenila), gre redigirani zdruzeni
 * izrek v zadnjo vrstico, prejsnje ostanejo prazne.
 */
export function redigirajPoDelih(vrstice: readonly string[], zdruzenoRedigirano: string): string[] {
  const cilj = kljuciBesed(zdruzenoRedigirano);
  let j = 0;
  const izid = vrstice.map((vrstica) =>
    vrstica
      .split(/\s+/)
      .filter((beseda) => {
        const kljuc = kljucBesede(beseda);
        if (!kljuc || j >= cilj.length || kljuc !== cilj[j]) return false;
        j += 1;
        return true;
      })
      .join(" "),
  );
  if (j === cilj.length) return izid;
  return vrstice.map((_, i) => (i === vrstice.length - 1 ? zdruzenoRedigirano : ""));
}
