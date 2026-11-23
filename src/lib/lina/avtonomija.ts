/**
 * Pravila avtonomije Line (lastnik 15. 11. 2026: »Glede line kot osebna asistentka pa naj ima moznost za avtonomno uporabo za
 * opravila, katera jih doloci uporabnik.«). Cista logika brez diska in omrezja.
 *
 * Nacelo: uporabnik SAM doloci, katera opravila sme Lina opraviti brez vprasanja; vse je privzeto izklopljeno. Vhod z druge
 * strani (klicatelj, SMS, e-posta, spletna stran) je napadalcev: nikoli ne spremeni pravil, prejemnikov ali besedil, in nikoli ne
 * doloci, KAJ se poslje. Dejanje izvrsi koda iz seznama DOVOLJENEGA (VRSTE_OPRAVIL) z ze shranjenimi, potrjenimi parametri.
 * smeAvtonomno() je edina vrata: iz vhoda vzame samo izvor, id povezave in znacko potrditve; vse drugo zavrze.
 * Lina nikoli ne placuje, ne pove cene in ne obljubi: besedilo predloge gre skozi isto denarno zaporo kot besedila uporabnika
 * (plast.ts signalDenarja; ta datoteka plast.ts ne spreminja).
 */
import { jePrepovedanaStevilka, signalDenarja, vE164 } from "./plast.ts";
import { jeNedovoljenaPreusmeritev } from "./preusmeritev.ts";

/** Seznam DOVOLJENEGA: samo ta opravila Lina sploh lahko opravi sama. Vse drugo je zavrnjeno, tudi ce uporabnik ali model zahteva. */
export const VRSTE_OPRAVIL = ["sms-predloga", "povzetek-dneva"] as const;
export type VrstaOpravila = (typeof VRSTE_OPRAVIL)[number];

/** Opravila, ki jih Lina ne dobi nikoli (zavrnitev z jasnim razlogom). Seznam je samo za razlago; dovoljenje daje VRSTE_OPRAVIL. */
export const PREPOVEDANA_OPRAVILA = ["placilo", "nakup", "brisanje", "namestitev", "ukaz", "denar", "sprememba-pravil", "sprememba-prejemnikov"] as const;

export const NACINI = ["izklopljeno", "potrditev", "samodejno"] as const;
export type Nacin = (typeof NACINI)[number];

/** Kdo je sprozil zahtevo. Samo te vrednosti sploh pridejo v postev; vse drugo (klicatelj, sms, eposta, splet, model) je zavrnjeno. */
export const DOVOLJENI_IZVORI: Readonly<Record<VrstaOpravila, readonly string[]>> = {
  "sms-predloga": ["dogodek", "uporabnik"],
  "povzetek-dneva": ["urnik", "uporabnik"],
};

export const NAJVEC_PREJEMNIKOV = 10;
export const NAJVEC_PREDLOG = 10;
export const NAJVEC_POVEZAV = 10;
export const NAJVEC_CAKAJOCIH = 20;
export const NAJVEC_PREDLOGA_ZNAKOV = 160;
export const NAJVEC_IMENA_ZNAKOV = 40;
export const NAJVEC_NA_DAN_TRDO = 50;
export const NAJVEC_NA_PREJEMNIKA_DAN = 3;
export const NAJDALJSI_IZTEK_DNI = 365;
export const PRIVZETI_IZTEK_DNI = 30;
export const CAKAJOCE_MS = 15 * 60_000;
export const NAJVEC_OBDELANIH = 200;
export const PRIVZETA_URA_POVZETKA = "08:00";
/** Najvec toliko minut po uri povzetka se zamujen zagon se opravi; pozneje se PRESKOCI (ne nadomesti). */
export const ZAMUDA_POVZETKA_MIN = 120;

export const PRIVZETA_MEJA_NA_DAN: Readonly<Record<VrstaOpravila, number>> = { "sms-predloga": 5, "povzetek-dneva": 1 };

/** Razlogi so FIKSNA koda: v dnevnik in odgovore gre samo koda, nikoli besedilo klicatelja, predloge ali stevilka. */
export const RAZLOGI = [
  "stanje", "ustavljeno", "prepovedano", "neznano-opravilo", "izvor", "izklopljeno", "poteklo", "iztek-neveljaven", "izven-okna",
  "povezava", "prejemnik", "predloga", "denar", "omejitev-dan", "omejitev-prejemnik", "nacin-potrditev", "zamujeno", "posrednik",
  "racun", "trdo-izklopljeno", "cakalna-vrsta",
  "nastavitev-pravilo", "nastavitev-prejemnik", "nastavitev-predloga", "nastavitev-povezava", "nastavitev-ura", "ustavi-vse", "nadaljuj", "ponastavi",
  "kazalo-ura",
] as const;
export type Razlog = (typeof RAZLOGI)[number];

export const IZIDI = ["izvedeno", "zavrnjeno", "caka", "potrjeno", "odklonjeno", "napaka", "preklicano", "poteklo", "preskoceno", "nastavitev"] as const;
export type Izid = (typeof IZIDI)[number];

export type Okno = { od: string; do: string };
export type Pravilo = {
  nacin: Nacin;
  /** ISO cas izteka. Brez njega vklopljeno pravilo ne velja (obvezen datum izteka). */
  veljaDo: string | null;
  /** ISO cas vklopa: dogodki pred njim (npr. nujni klici izpred vklopa) ne sprozijo nicesar. */
  aktivnoOd: string | null;
  najvecNaDan: number;
  okno: Okno | null;
};
export type Prejemnik = { id: string; ime: string; stevilka: string };
export type Predloga = { id: string; besedilo: string };
export type Povezava = { id: string; vrsta: "sms-predloga"; sprozilec: "nujen-klic"; predlogaId: string; prejemnikId: string };
export type Cakajoce = { id: string; povezavaId: string; vrsta: VrstaOpravila; sprozilecId: string; ustvarjeno: string; poteceDo: string };
export type Poraba = { dan: string; vrste: Partial<Record<VrstaOpravila, number>>; prejemniki: Record<string, number> };
export type StanjeAvtonomije = {
  v: 1;
  ustavljeno: boolean;
  ustavljenoOd: string | null;
  pravila: Record<VrstaOpravila, Pravilo>;
  prejemniki: Prejemnik[];
  predloge: Predloga[];
  povezave: Povezava[];
  povzetekUra: string;
  kazalec: { nujniObdelani: string[]; nujniCas: number; nujniHash: string; zadnjiPovzetek: string | null };
  poraba: Poraba;
  cakajoca: Cakajoce[];
};

export type Parametri = { izvor?: unknown; povezavaId?: unknown; potrjeno?: unknown };
export type Odlocitev =
  | { izid: "dovoli"; prejemnikId?: string; predlogaId?: string }
  | { izid: "zahtevaj-potrditev"; razlog: "nacin-potrditev" }
  | { izid: "zavrni"; razlog: Razlog };

const ID = /^[a-f0-9]{16}$/;
const CAS = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function privzetoPravilo(vrsta: VrstaOpravila): Pravilo {
  return { nacin: "izklopljeno", veljaDo: null, aktivnoOd: null, najvecNaDan: PRIVZETA_MEJA_NA_DAN[vrsta], okno: null };
}

export function privzetoStanje(): StanjeAvtonomije {
  return {
    v: 1,
    ustavljeno: false,
    ustavljenoOd: null,
    pravila: { "sms-predloga": privzetoPravilo("sms-predloga"), "povzetek-dneva": privzetoPravilo("povzetek-dneva") },
    prejemniki: [],
    predloge: [],
    povezave: [],
    povzetekUra: PRIVZETA_URA_POVZETKA,
    kazalec: { nujniObdelani: [], nujniCas: 0, nujniHash: "", zadnjiPovzetek: null },
    poraba: { dan: "", vrste: {}, prejemniki: {} },
    cakajoca: [],
  };
}

export function jeVrstaOpravila(v: unknown): v is VrstaOpravila {
  return typeof v === "string" && (VRSTE_OPRAVIL as readonly string[]).includes(v);
}
export function jeRazlog(v: unknown): v is Razlog {
  return typeof v === "string" && (RAZLOGI as readonly string[]).includes(v);
}

/** Lokalni koledarski dan YYYY-MM-DD (dnevne meje so po uri uporabnika). */
export function danKljuc(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function veljavenCas(v: unknown): v is string {
  return typeof v === "string" && CAS.test(v);
}

export function minuteIzCasa(c: string): number {
  const m = CAS.exec(c);
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
}

/** Okno sme prestopiti polnoc (22:00-06:00). Enaka meja = prazno okno (nikoli). */
export function vOknu(okno: Okno | null, zdaj: Date): boolean {
  if (!okno) return true;
  const od = minuteIzCasa(okno.od);
  const dov = minuteIzCasa(okno.do);
  if (od < 0 || dov < 0 || od === dov) return false;
  const m = zdaj.getHours() * 60 + zdaj.getMinutes();
  return od < dov ? m >= od && m < dov : m >= od || m < dov;
}

export type NapakaPredloge = "predloga-prazna" | "predloga-dolga" | "predloga-znaki" | "predloga-povezava" | "denar";

/** Koda napake ali null. Besedilo predloge: ena sporocilna enota, brez povezav, brez denarnega signala, brez kontrolnih znakov. */
export function preveriPredlogo(besedilo: unknown): NapakaPredloge | null {
  if (typeof besedilo !== "string") return "predloga-prazna";
  const t = besedilo.normalize("NFKC").trim();
  if (!t) return "predloga-prazna";
  if (t.length > NAJVEC_PREDLOGA_ZNAKOV) return "predloga-dolga";
  if (/[\p{C}\u2028\u2029]/u.test(t)) return "predloga-znaki";
  // Povezava ali domena v SMS je pot za izmikanje in zlorabo (vsiljena stran, sledenje); predloga je cisto besedilo.
  if (/(?:https?:|www\.|\/\/|[\p{L}\p{N}-]+\.(?:si|com|net|org|io|eu|me|ly|co|info|biz|xyz|app|dev|ru|cn)\b)/iu.test(t)) return "predloga-povezava";
  if (signalDenarja(t)) return "denar";
  return null;
}

/**
 * N8: posle se SAMO to, kar je bilo preverjeno: normalizirano (NFKC) in prirezano besedilo, nikoli surovo besedilo iz datoteke.
 * Neveljavna predloga vrne napako (ista preverba kot preveriPredlogo), nikoli besedila.
 */
export function pripraviPredlogo(besedilo: unknown): { napaka: NapakaPredloge } | { besedilo: string } {
  const napaka = preveriPredlogo(besedilo);
  if (napaka) return { napaka };
  return { besedilo: (besedilo as string).normalize("NFKC").trim() };
}

/**
 * Brez gesla vsak lokalni proces dobi sejo lastnika (origin.ts jeLokalnaZahteva): takrat smejo veljati SAMO ukazi, ki avtonomijo
 * zmanjsajo ali ustavijo (izklop pravila, odstranitev, ustavi, nadaljuj, odkloni, ponastavi). Vklop, dodajanje prejemnika, predloge in
 * povezave, urnik in odobritev cakajocega opravila zahtevajo geslo (fail-closed; N1/N2 slepega pregleda). Neznan ukaz ne zahteva
 * gesla: zavrne ga stikalo z napako »ukaz«.
 */
export function ukazZahtevaGeslo(ukaz: unknown, nacin: unknown): boolean {
  switch (ukaz) {
    case "pravilo": return nacin !== "izklopljeno";
    case "ura":
    case "prejemnik-dodaj":
    case "predloga-dodaj":
    case "povezava-dodaj":
    case "odobri": return true;
    default: return false;
  }
}

/** Ime prejemnika za prikaz: crke, stevke, presledek, pika, vezaj, opuscaj. */
export function ocistiIme(ime: unknown): string | null {
  if (typeof ime !== "string") return null;
  const t = ime.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!t || t.length > NAJVEC_IMENA_ZNAKOV) return null;
  if (!/^[\p{L}\p{N} .'’-]+$/u.test(t)) return null;
  return t;
}

/** Prejemnik: E.164, ne 112/113/090, in dovoljena smer (privzeto samo slovenska +386 ali predpone iz pravil). Vrne cisto stevilko ali kodo napake. */
export function preveriStevilkoPrejemnika(v: unknown, dovoljenePredpone = ""): { stevilka: string } | { napaka: "prejemnik" } {
  if (typeof v !== "string") return { napaka: "prejemnik" };
  const e = vE164(v);
  if (!e || jePrepovedanaStevilka(e) || jeNedovoljenaPreusmeritev(e, dovoljenePredpone)) return { napaka: "prejemnik" };
  return { stevilka: e };
}

export function maskirajStevilko(e164: string): string {
  const d = e164.replace(/\D/g, "");
  if (d.length < 7) return "•••";
  return `+${d.slice(0, 3)} ••• ${d.slice(-3)}`;
}

function jeCasISO(v: unknown): v is string {
  return typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v));
}

function normalizirajPravilo(raw: unknown): Pravilo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.nacin !== "string" || !(NACINI as readonly string[]).includes(r.nacin)) return null;
  const meja = r.najvecNaDan;
  if (typeof meja !== "number" || !Number.isInteger(meja) || meja < 1 || meja > NAJVEC_NA_DAN_TRDO) return null;
  if (r.veljaDo !== null && !jeCasISO(r.veljaDo)) return null;
  if (r.aktivnoOd !== null && !jeCasISO(r.aktivnoOd)) return null;
  let okno: Okno | null = null;
  if (r.okno !== null) {
    const o = r.okno as Record<string, unknown> | undefined;
    if (!o || typeof o !== "object" || !veljavenCas(o.od) || !veljavenCas(o.do)) return null;
    okno = { od: o.od, do: o.do };
  }
  return { nacin: r.nacin as Nacin, veljaDo: r.veljaDo as string | null, aktivnoOd: r.aktivnoOd as string | null, najvecNaDan: meja, okno };
}

function seznam<T>(raw: unknown, najvec: number, obdelaj: (v: unknown) => T | null): T[] | null {
  if (!Array.isArray(raw) || raw.length > najvec) return null;
  const izhod: T[] = [];
  for (const v of raw) {
    const o = obdelaj(v);
    if (o === null) return null;
    izhod.push(o);
  }
  return izhod;
}

/**
 * Stroga preverba stanja z diska. Vse, kar ne ustreza (napacen tip, neznana vrsta, id izven oblike, presezene meje), vrne null in
 * klicatelj to obravnava kot ZAVRNJENO (fail-closed). Neznana polja se zavrzejo (ne prenasajo).
 */
export function normalizirajStanje(raw: unknown): StanjeAvtonomije | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || typeof r.ustavljeno !== "boolean") return null;
  if (r.ustavljenoOd !== null && !jeCasISO(r.ustavljenoOd)) return null;
  const p = r.pravila as Record<string, unknown> | undefined;
  if (!p || typeof p !== "object") return null;
  const sms = normalizirajPravilo(p["sms-predloga"]);
  const pov = normalizirajPravilo(p["povzetek-dneva"]);
  if (!sms || !pov) return null;
  const prejemniki = seznam<Prejemnik>(r.prejemniki, NAJVEC_PREJEMNIKOV, (v) => {
    const o = v as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || typeof o.id !== "string" || !ID.test(o.id)) return null;
    const ime = ocistiIme(o.ime);
    const e = typeof o.stevilka === "string" ? vE164(o.stevilka) : null;
    if (!ime || !e || jePrepovedanaStevilka(e)) return null;
    return { id: o.id, ime, stevilka: e };
  });
  const predloge = seznam<Predloga>(r.predloge, NAJVEC_PREDLOG, (v) => {
    const o = v as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || typeof o.id !== "string" || !ID.test(o.id) || typeof o.besedilo !== "string") return null;
    return { id: o.id, besedilo: o.besedilo };
  });
  const povezave = seznam<Povezava>(r.povezave, NAJVEC_POVEZAV, (v) => {
    const o = v as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || typeof o.id !== "string" || !ID.test(o.id)) return null;
    if (o.vrsta !== "sms-predloga" || o.sprozilec !== "nujen-klic") return null;
    if (typeof o.predlogaId !== "string" || !ID.test(o.predlogaId) || typeof o.prejemnikId !== "string" || !ID.test(o.prejemnikId)) return null;
    return { id: o.id, vrsta: "sms-predloga", sprozilec: "nujen-klic", predlogaId: o.predlogaId, prejemnikId: o.prejemnikId };
  });
  const cakajoca = seznam<Cakajoce>(r.cakajoca, NAJVEC_CAKAJOCIH, (v) => {
    const o = v as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || typeof o.id !== "string" || !ID.test(o.id)) return null;
    if (!jeVrstaOpravila(o.vrsta) || typeof o.povezavaId !== "string" || typeof o.sprozilecId !== "string") return null;
    if (!jeCasISO(o.ustvarjeno) || !jeCasISO(o.poteceDo) || o.povezavaId.length > 32 || o.sprozilecId.length > 32) return null;
    return { id: o.id, povezavaId: o.povezavaId, vrsta: o.vrsta, sprozilecId: o.sprozilecId, ustvarjeno: o.ustvarjeno, poteceDo: o.poteceDo };
  });
  if (!prejemniki || !predloge || !povezave || !cakajoca) return null;
  if (!veljavenCas(r.povzetekUra)) return null;
  const k = r.kazalec as Record<string, unknown> | undefined;
  if (!k || typeof k !== "object" || !Array.isArray(k.nujniObdelani) || k.nujniObdelani.length > NAJVEC_OBDELANIH) return null;
  if (!k.nujniObdelani.every((x) => typeof x === "string" && x.length <= 32)) return null;
  const nujniCas = k.nujniCas === undefined ? 0 : k.nujniCas;
  if (typeof nujniCas !== "number" || !Number.isSafeInteger(nujniCas) || nujniCas < 0) return null;
  const nujniHash = k.nujniHash === undefined ? "" : k.nujniHash;
  if (typeof nujniHash !== "string" || (nujniHash !== "" && !ID.test(nujniHash))) return null;
  if (k.zadnjiPovzetek !== null && (typeof k.zadnjiPovzetek !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(k.zadnjiPovzetek))) return null;
  const b = r.poraba as Record<string, unknown> | undefined;
  if (!b || typeof b !== "object" || typeof b.dan !== "string" || !b.vrste || typeof b.vrste !== "object" || !b.prejemniki || typeof b.prejemniki !== "object") return null;
  const vrste: Partial<Record<VrstaOpravila, number>> = {};
  for (const [kljuc, v] of Object.entries(b.vrste as Record<string, unknown>)) {
    if (!jeVrstaOpravila(kljuc) || typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 10_000) return null;
    vrste[kljuc] = v;
  }
  const preje: Record<string, number> = Object.create(null);
  for (const [kljuc, v] of Object.entries(b.prejemniki as Record<string, unknown>)) {
    if (!ID.test(kljuc) || typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 10_000) return null;
    preje[kljuc] = v;
  }
  return {
    v: 1,
    ustavljeno: r.ustavljeno,
    ustavljenoOd: r.ustavljenoOd as string | null,
    pravila: { "sms-predloga": sms, "povzetek-dneva": pov },
    prejemniki,
    predloge,
    povezave,
    povzetekUra: r.povzetekUra,
    kazalec: { nujniObdelani: [...(k.nujniObdelani as string[])], nujniCas, nujniHash, zadnjiPovzetek: k.zadnjiPovzetek as string | null },
    poraba: { dan: b.dan as string, vrste, prejemniki: preje },
    cakajoca,
  };
}

/** Porabljeno danes (po lokalnem dnevu); star dan = 0. */
export function porabaDanes(stanje: StanjeAvtonomije, zdaj: Date): { vrste: Partial<Record<VrstaOpravila, number>>; prejemniki: Record<string, number> } {
  if (stanje.poraba.dan !== danKljuc(zdaj)) return { vrste: {}, prejemniki: {} };
  return { vrste: stanje.poraba.vrste, prejemniki: stanje.poraba.prejemniki };
}

/**
 * EDINA vrata za avtonomno dejanje. Izid: dovoli | zahtevaj-potrditev | zavrni (z razlogom). Fail-closed: vsaka neznanka je
 * zavrnitev. Iz `parametri` vzame SAMO izvor, povezavaId in potrjeno; prejemnika, besedilo in stevilko vzame iz shranjenega
 * stanja (ki ga je potrdil uporabnik), nikoli iz vhoda. Znacka `potrjeno` velja samo z izvorom »uporabnik« (odobritev v oknu
 * Line), zato je dohodni dogodek ne more postaviti.
 */
export function smeAvtonomno(
  opravilo: unknown,
  parametri: Parametri | null | undefined,
  stanje: StanjeAvtonomije | null | undefined,
  zdaj: Date = new Date(),
  dovoljenePredpone = "",
): Odlocitev {
  const zavrni = (razlog: Razlog): Odlocitev => ({ izid: "zavrni", razlog });
  if (process.env.LINA_AVTONOMIJA === "0") return zavrni("trdo-izklopljeno");
  if (!stanje || stanje.v !== 1 || !stanje.pravila || !(zdaj instanceof Date) || Number.isNaN(zdaj.getTime())) return zavrni("stanje");
  if (stanje.ustavljeno) return zavrni("ustavljeno");
  if (typeof opravilo === "string" && (PREPOVEDANA_OPRAVILA as readonly string[]).includes(opravilo)) return zavrni("prepovedano");
  if (!jeVrstaOpravila(opravilo)) return zavrni("neznano-opravilo");
  const izvor = typeof parametri?.izvor === "string" ? parametri.izvor : "";
  if (!DOVOLJENI_IZVORI[opravilo].includes(izvor)) return zavrni("izvor");
  const potrjeno = izvor === "uporabnik" && parametri?.potrjeno === true;
  const pravilo = stanje.pravila[opravilo];
  if (!pravilo || pravilo.nacin === "izklopljeno") return zavrni("izklopljeno");
  if (!pravilo.veljaDo) return zavrni("poteklo");
  const iztek = Date.parse(pravilo.veljaDo);
  if (!Number.isFinite(iztek) || iztek > zdaj.getTime() + (NAJDALJSI_IZTEK_DNI + 1) * 86_400_000) return zavrni("iztek-neveljaven");
  if (iztek <= zdaj.getTime()) return zavrni("poteklo");
  if (!vOknu(pravilo.okno, zdaj)) return zavrni("izven-okna");
  const poraba = porabaDanes(stanje, zdaj);
  let prejemnikId: string | undefined;
  let predlogaId: string | undefined;
  if (opravilo === "sms-predloga") {
    const povezava = typeof parametri?.povezavaId === "string" ? stanje.povezave.find((p) => p.id === parametri.povezavaId) : undefined;
    if (!povezava || povezava.vrsta !== opravilo) return zavrni("povezava");
    const prejemnik = stanje.prejemniki.find((p) => p.id === povezava.prejemnikId);
    if (!prejemnik) return zavrni("prejemnik");
    const st = preveriStevilkoPrejemnika(prejemnik.stevilka, dovoljenePredpone);
    if (!ocistiIme(prejemnik.ime) || "napaka" in st) return zavrni("prejemnik");
    const predloga = stanje.predloge.find((p) => p.id === povezava.predlogaId);
    if (!predloga) return zavrni("predloga");
    // Preverba se ponovi TIK PRED dejanjem, ne samo ob shranjevanju (datoteka je lahko rocno popravljena).
    const napaka = preveriPredlogo(predloga.besedilo);
    if (napaka === "denar") return zavrni("denar");
    if (napaka) return zavrni("predloga");
    if ((poraba.prejemniki[prejemnik.id] ?? 0) >= NAJVEC_NA_PREJEMNIKA_DAN) return zavrni("omejitev-prejemnik");
    prejemnikId = prejemnik.id;
    predlogaId = predloga.id;
  }
  if ((poraba.vrste[opravilo] ?? 0) >= Math.min(pravilo.najvecNaDan, NAJVEC_NA_DAN_TRDO)) return zavrni("omejitev-dan");
  if (pravilo.nacin === "potrditev" && !potrjeno) return { izid: "zahtevaj-potrditev", razlog: "nacin-potrditev" };
  return { izid: "dovoli", ...(prejemnikId ? { prejemnikId } : {}), ...(predlogaId ? { predlogaId } : {}) };
}

/** Zapis za dnevnik: samo fiksne kode in id-ji. Brez besedila predloge, stevilk in vsebine klica. */
export type ZapisDnevnika = { t: string; id: string; opravilo: VrstaOpravila | "sistem"; izid: Izid; razlog?: Razlog; povezavaId?: string };

/** Zapis iz diska nazaj v znano obliko; karkoli drugega se zavrze (dnevnik je lahko rocno popravljen). */
export function preveriZapisDnevnika(raw: unknown): ZapisDnevnika | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!jeCasISO(r.t) || typeof r.id !== "string" || !ID.test(r.id)) return null;
  if (!(r.opravilo === "sistem" || jeVrstaOpravila(r.opravilo))) return null;
  if (typeof r.izid !== "string" || !(IZIDI as readonly string[]).includes(r.izid)) return null;
  if (r.razlog !== undefined && !jeRazlog(r.razlog)) return null;
  if (r.povezavaId !== undefined && (typeof r.povezavaId !== "string" || !ID.test(r.povezavaId))) return null;
  return { t: r.t, id: r.id, opravilo: r.opravilo as VrstaOpravila | "sistem", izid: r.izid as Izid, ...(r.razlog ? { razlog: r.razlog as Razlog } : {}), ...(r.povezavaId ? { povezavaId: r.povezavaId } : {}) };
}
