import path from "node:path";
import { loadLine, prevezavaIzid, preberiKlic, recordCaller, zabeleziCasGlasu, zabeleziPrenosZvoka, zabeleziSprejem, zakljuciKlic, zapisiDelIzreka, type ModelOsnutka } from "./service.server.ts";
import { nujnaPrevezava, prevezavaNaZahtevo } from "./nujni.server.ts";
import { prevezavaIzvenCasa } from "./urnik.ts";
import { kljucIzPoti, potZvoka, stalniStavki } from "./glas.ts";
import {
  glasNaVoljo,
  handleZvokRequest,
  nastaviJavljanjePrenosa,
  zabeleziPripravoKosa,
  zlepiPosnetke,
  predpripraviOdgovor,
  ROB_KOSA_PONOVITVE_MS,
  pripraviStalneVOzadju,
  predpripraviStavke,
  pripravljeniKljuci,
  sproziOdklopnik,
  zapisiRazlogGlasu,
  zazeniCiscenjeZvoka,
  razlogNapakeGlasu,
  preberiWavPosnetka,
  trajanjeWavMs,
  zvokPoKosih,
  type KodaGlasu,
  type MestoGlasu,
} from "./glas.server.ts";
import { pripraviStavekNarocila } from "./narocilo-stavek.server.ts";
import { deliPovzetka, deliZaPredpripravo, imaPodatek, jeOsebna, jePovzetek, uvodKlica, zRazkritjem } from "./povzetek.ts";
import type { TurnResult } from "./types.ts";
import { claimWebhook, kljucPonovitve, shraniZadnjiTwiml, zadnjiTwiml } from "./replay.server.ts";
import { resolveDataDir } from "./store.server.ts";
import { formParams, podpisSharedKey, preberiGlavoPodpisa, signaturesMatch, signatureUrl, twilioSignature } from "./twilio.server.ts";
import { sharedKeyLine } from "./twilio-podpis.server.ts";
import { kljucBrezPodpisa, ociscenaPolja, preizkusniKlicVeljaven } from "./twilio-preizkus.server.ts";
import { sprejetKlicVeljaven } from "./twilio-sprejem.server.ts";
import { jeSumljivBot } from "./sum-klicatelja.ts";
import type { ZahtevaTwilio } from "./twilio-racun.server.ts";
import { t } from "./besedila.ts";
import { istaStevilka } from "./guards.ts";
import { vE164 } from "./plast.ts";
import { jeNedovoljenaPreusmeritev } from "./preusmeritev.ts";
import { atributiGovora, izraziKataloga } from "./govor-model.ts";
import { namigiStrok } from "./stroke.server.ts";
import { loadPravila } from "./pravila.server.ts";
import { CAKAJ_NADALJEVANJE_SEK, jeNedokoncan, TIMEOUT_OSEBNA_PO_SPOROCILU_SEK, TIMEOUT_OSEBNA_PO_VPRASANJU_SEK, TISINA_OSEBNA_PO_SPOROCILU_SEK, TISINA_PRIVZETO_SEK, tisinaIzNastavitve, tisinaPoGovoru, zdruziIzrek, type CakaPodatek } from "./tisina.ts";
import { rokZbira } from "./trajanje.ts";
import { REZERVA_PO_POZDRAVU_MS, stevilkaBesedno } from "./osebna-polnila.ts";
import { odlocitevLinije } from "./ure.ts";
import { jeLinijaZasedena, type AktivniKlic } from "./zasedenost.ts";
import { Zbiralnik, trenutniZbiralnik, vZbiralniku } from "./meritve.server.ts";
import type { ModelRazumevanja } from "./razumevanje.server.ts";
import { ogrejZaKlic } from "./ogrevanje-klica.server.ts";
import { obIzrekuKlicatelja, zazeniPospravljanjePosnetkov } from "./snemanje.server.ts";
import { twimlLive } from "./live/twiml.ts";
import { izdajZetonLive } from "./live/zeton.ts";

// Merilnik verige: prvi GET /zvok obrata gre v zapis klica (stevila, v ozadju).
nastaviJavljanjePrenosa((sid, obrat, prislo, poslan, dir) => {
  void zabeleziPrenosZvoka(sid, obrat, prislo, poslan, dir);
});

/** Zapis delnega rezultata (brez vsebine): datoteka delni-rezultati.jsonl v mapi podatkov, ena vrstica na klic Twilia. */
async function zabeleziDelniRezultat(root: string, params: Record<string, string>): Promise<void> {
  const { appendFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const zgosceno = (x: string) => (x ? createHash("sha256").update(x).digest("hex").slice(0, 12) : "");
  const nestabilno = params.UnstableSpeechResult ?? "";
  const stabilno = params.StableSpeechResult ?? "";
  const vrstica = {
    at: new Date().toISOString(),
    sid: (params.CallSid ?? "").slice(0, 64),
    st: Number.parseInt(params.SequenceNumber ?? "", 10) || null,
    dolzina: nestabilno.length,
    zgosceno: zgosceno(nestabilno),
    stabilnoDolzina: stabilno.length,
    stabilnoZgosceno: zgosceno(stabilno),
  };
  await appendFile(path.join(root, "delni-rezultati.jsonl"), `${JSON.stringify(vrstica)}\n`, { mode: 0o600 });
}

function forbidden(): Response {
  return new Response("Prepovedano", {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

/** XML 1.0: kontrolni znaki zunaj dovoljenih se odstrani, posebni znaki se pobegnejo. */
export function xmlEscape(value: string): string {
  let clean = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const allowed =
      code === 0x9 ||
      code === 0xa ||
      code === 0xd ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff);
    if (allowed) clean += char;
  }
  return clean.replace(/[&<>"']/g, (char) => {
    if (char === "&") return "\u0026amp;";
    if (char === "<") return "\u0026lt;";
    if (char === ">") return "\u0026gt;";
    if (char === "'") return "\u0026apos;";
    return "\u0026quot;";
  });
}

function teloXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

function odgovorXml(telo: string): Response {
  return new Response(telo, {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" },
  });
}

/**
 * Govor enega odgovora. S pripravljenimi posnetki <Play> (Gemini TTS, glas Kore); brez njih rezerva
 * <Say language="sl-SI">, da klic nikoli ne obmolkne. Twiliov Say slovenscine ne izgovarja razumljivo
 * (pravi klic 10. 11. 2026), zato je samo rezerva.
 */
function govor(text: string, kljuci: string[] | null, origin: string): string {
  if (kljuci && kljuci.length > 0) {
    return kljuci.map((kljuc) => `<Play>${xmlEscape(`${origin}${potZvoka(kljuc)}`)}</Play>`).join("");
  }
  // Prazen odgovor je TIHO slovo (osebna tajnica: slovo je ze bilo del prejsnjega odgovora, tisina po njem klic le konca): brez praznega <Say>.
  if (!text.trim()) return "";
  return `<Say language="sl-SI">${xmlEscape(text)}</Say>`;
}

/** Za govorom Gather na naslednji obrat ali Hangup. spoken je ze TwiML. */
function zZbiranjem(spoken: string, action: string | null, timeoutSec = 20, tisinaSek = TISINA_PRIVZETO_SEK): string {
  if (!action) return `${spoken}<Hangup/>`;
  const url = xmlEscape(action);
  const meja = Math.max(1, Math.min(20, Math.round(timeoutSec)));
  // speechTimeout je tisina PO govoru v celih sekundah (Twilio sprejme pozitivno celo stevilo ali auto; »auto« je
  // lastnik po pravem klicu 10. 11. 2026 ocenil kot predolgo cakanje). timeout je cakanje na ZACETEK govora.
  const tisina = tisinaIzNastavitve(tisinaSek);
  // Redirect in kratek timeout: molk ne sme skociti cez 30 s opozorila.
  // Govor je ZNOTRAJ Gather: klicatelj Lino prekine (barge-in) in ji reče, naj neha (lastnik, 14. 11. 2026: ni se
  // ustavila, ko jo je vprasal na glas; prej je <Play> pred Gather tekel do konca). timeout steje od konca govora.
  return `<Gather input="speech" language="sl-SI" speechTimeout="${tisina}" timeout="${meja}" method="POST" action="${url}">${spoken}</Gather><Redirect method="POST">${url}</Redirect>`;
}

/**
 * Cakanje znotraj ene zahteve. Twilio caka na TwiML najvec 5 s (preizkusni racun) oziroma 15 s; vsaka zahteva caka
 * 3,5 s. Vmesni stavek »Trenutek, prosim.« je NAJVEC ENKRAT na odgovor in samo ce odgovor po prvih 3,5 s se ni
 * pripravljen (lastnik, 10. 11. 2026, drugi pravi klic: prej 1,5 s in drugi »Se trenutek« - prevec); nadaljnji skoki
 * so tihi. Stalni odgovori (posnetek ze pripravljen) ne cakajo nikoli. Nadaljnji skoki po 3,5 s do trde meje,
 * nato rezerva in odklopnik (pregled G2, S1).
 * Preizkusni racun dovoli 10 skokov (Gather action / Redirect) na klic, vsak vmesni stavek porabi enega.
 */
export const CAKAJ_MS = 3_500;
export const CAKAJ_NAPREJ_MS = 3_500;
/**
 * Povzetek na koncu klica (G4b): prvi <Play> takoj. Njegovi stavki so vecinoma ze pripravljeni (predpriprava med
 * pogovorom), zato cakamo samo toliko, da disk in zadnja sinteza ob pripravljenosti vseeno prideta v isto zahtevo.
 * Dlje bi odlasalo prvi stavek (cilj < 1 s) zaradi stavka, ki ga sinteza tako ali tako ne konca prej.
 */
export const CAKAJ_POVZETEK_MS = 500;
/**
 * G4k: ko je prvi kos povzetka pripravljen, damo se tole, da v isto zahtevo pridejo tudi drugi ze pripravljeni kosi
 * (stalni posnetki se na disku preverijo v nekaj ms), nato vrnemo. Brez tega je klicatelj izmerjeno cakal vseh 500 ms,
 * ce je bil en kos (stavek narocila) nepripravljen, ceprav bi uvod lahko ze tekel (meritev 11. 11. 2026).
 */
export const PRIPRAVLJEN_PRVI_POVZETEK_MS = 40;
export const NAJVEC_CAKANJ = 4;
/**
 * Brez Lininega glasu (ponudnik brez prijave Google Cloud) bi bil tudi vmesni stavek v nerazumljivem glasu
 * posrednika: model cakamo dlje in molce (pregled G2, S6). Pod 5 s, kolikor caka preizkusni racun Twilio.
 */
export const CAKAJ_BREZ_GLASU_MS = 4_000;
/**
 * Trda meja obrata z glasom. Meritev vodje 10. 11. 2026: odgovor modela (~110 znakov) je bil pripravljen po
 * 5,7-6 s in je pri meji ~6 s enkrat koncal v glasu posrednika, ki ga lastnik po telefonu ne razume. Dokler sinteza
 * tece in obrat ni starejsi od te meje, Lina rece se en vmesni stavek; rezerva samo ob napaki ali po meji.
 * 12 s = 1,5 s + najvec trije skoki po 3,5 s (vsak pod 5 s, kolikor na TwiML caka preizkusni racun Twilio).
 */
export const TRDA_MEJA_OBRATA_MS = 12_000;
const OPRAVILO_ZIVI_MS = 2 * 60 * 1000;
const INTERVAL_OPRAVIL_MS = 60_000;

export type MoznostiKlica = {
  cakajMs?: number;
  cakajNaprejMs?: number;
  cakajBrezGlasuMs?: number;
  trdaMejaMs?: number;
  /** Model za preizkus; linija ga ne poda. */
  model?: ModelOsnutka;
  /** Zahteva proti API Twilio za preverbo preizkusnega klica; linija jo ne poda. */
  zahtevaTwilio?: ZahtevaTwilio;
  /** Model razumevanja izreka za preizkus (osebna); linija ga ne poda. */
  razumevanje?: ModelRazumevanja;
  /** Ura v ms za starost opravil in cas obrata; vbrizgana v preizkusih. */
  ura?: () => number;
  /** Samo za preizkuse: obrat se zacne sele, ko se obljuba izpolni (deterministicen »obrat se ni koncal v prvi zahtevi«). */
  zadrziObrat?: () => Promise<void>;
};

/** Obrat v teku: model in sinteza teceta mimo webhooka, zahteve cak samo cakajo nanj. */
type Opravilo = {
  at: number;
  izid: TurnResult | null;
  kljuci: string[] | null;
  razlog: KodaGlasu | "";
  status: number | null;
  gotovo: boolean;
  napaka: unknown;
  besedilo: Promise<void>;
  konec: Promise<void>;
  /** Resolvira, ko je pripravljen PRVI kos zvoka (ali ko je delo koncano): povzetek ne caka na zadnji kos (G4k). */
  prviDel: Promise<void>;
  /** Kosi odgovora za sintezo in stanje vsakega: prvi stavek se predvaja, ko je pripravljen, ostanek za njim. */
  kosi: string[];
  deli: Array<{ stanje: "caka" | "ok" | "napaka"; kljuc?: string; error?: unknown }>;
  /**
   * Klic, ZDRUZENI izrek tega obrata in stevilo nadaljevanj v obratu: izid »caka nadaljevanje« lahko pride sele v skoku (cak > 0), ta zahteva pa
   * nima SpeechResult (neodvisni pregled 14. 11. 2026).
   */
  sid: string;
  izrek: string;
  nadSt: number;
};

const opravila = new Map<string, Opravilo>();
/** Koliko obratov klica je ze padlo: prvic opravicilo in nadaljevanje, drugic slovo. */
const napakeKlicev = new Map<string, { at: number; stevilo: number }>();
/** Odgovor v teku po kljucu ponovitve: ponovljena zahteva pocaka isti TwiML namesto 409. */
const odgovoriVTeku = new Map<string, Promise<string>>();

/** Obrati, ki se tecejo mimo webhooka (sinteza v ozadju). */
const ozadje = new Set<Promise<void>>();

/** Zaustavitev in preizkusi: pocaka delo v ozadju, da po njem ni vec pisanja v mapo podatkov. */
export async function pocakajOzadjeKlicev(): Promise<void> {
  while (ozadje.size > 0) await Promise.allSettled([...ozadje]);
}

/** Prvi del nedokoncanega izreka do nadaljevanja. Samo v pomnilniku; pobrise se ob nadaljevanju, koncu klica ali po starosti. */
/**
 * Osebna tajnica: do kdaj traja Lin pozdrav (konec posnetka + rezerva). <Play> v <Gather> govora ne prekine (izmerjeno 14. 11. 2026),
 * zato je izrek, ki pride prej, govor MED pozdravom in ne odgovor na vprasanje. Kljuc: root + CallSid.
 */
const oknaPozdrava = new Map<string, number>();
/** Klici, za katere se je stavek »zunaj delovnega casa« ze zacel pripravljati (en poskus na klic: napaka sinteze, npr. 429, se ne ponavlja na vsaki zahtevi). */
const izvenCasaPripravljen = new Set<string>();
/** Ocena trajanja govora brez posnetka (izmerjeno: 106 znakov = 12,1 s, torej ~9 znakov na sekundo). */
const ZNAKOV_NA_SEKUNDO = 9;

const delniIzreki = new Map<string, { at: number; besedilo: string }>();
/**
 * Osebna tajnica (lastnik 14. 11. 2026: »Lina mora biti prepricana, da je uporabnik nehal govoriti«): nedokoncan izrek (pravilo ali oznaka modela)
 * se ne odgovori, ampak tiho poslusa nadaljevanje in ga dopise: najvec 2 nadaljevanji na obrat in najvec 3 na klic, da zahteve ostanejo pod mejo
 * 10 preizkusnega racuna Twilio (vsako nadaljevanje je ena zahteva). Podjetje: kot doslej enkrat na obrat.
 */
export const NAJVEC_NADALJEVANJ_OBRAT = 2;
export const NAJVEC_NADALJEVANJ_KLIC = 3;
const nadaljevanjaKlica = new Map<string, { n: number; at: number }>();
/**
 * Stevec zahtev Twilia na klic (pogovorne zahteve incoming/turn, tudi skoki in tiha nadaljevanja; ponovitev iste podpisane zahteve ne steje).
 * Preizkusni racun dovoli MEJA_ZAHTEV_KLICA zahtev, nato klic prekine: osebna tajnica zato pri predzadnji dovoljeni zahtevi odgovori in se
 * poslovi v istem odgovoru (service.server.ts, »predzadnja«).
 */
const zahteveKlica = new Map<string, { n: number; at: number }>();

/** Za preizkus: koliko nedokoncanih izrekov caka na nadaljevanje. */
export function steviloDelnihIzrekov(): number {
  return delniIzreki.size;
}

/** Za preizkus: koliko obratov se drzi v pomnilniku. */
export function steviloOpravil(): number {
  return opravila.size;
}

/** Za preizkus: koliko klicev ima zabelezeno napako obrata. */
export function steviloNapakKlicev(): number {
  return napakeKlicev.size;
}

/**
 * Ciscenje zemljevidov po starosti. Tece s casovnikom (pregled G2, N7: prej samo ob naslednjem obratu,
 * zato je opravilo zadnjega klica ostalo v pomnilniku do naslednjega klica).
 */
export function pocistiOpravila(zdaj = Date.now()): number {
  let pobrisanih = 0;
  for (const [kljuc, opravilo] of opravila) {
    if (zdaj - opravilo.at > OPRAVILO_ZIVI_MS) {
      opravila.delete(kljuc);
      pobrisanih += 1;
    }
  }
  for (const [kljuc, napaka] of napakeKlicev) if (zdaj - napaka.at > OPRAVILO_ZIVI_MS) napakeKlicev.delete(kljuc);
  for (const [kljuc, del] of delniIzreki) if (zdaj - del.at > OPRAVILO_ZIVI_MS) delniIzreki.delete(kljuc);
  for (const [kljuc, nad] of nadaljevanjaKlica) if (zdaj - nad.at > 60 * 60_000) nadaljevanjaKlica.delete(kljuc);
  for (const [kljuc, z] of zahteveKlica) if (zdaj - z.at > 60 * 60_000) zahteveKlica.delete(kljuc);
  return pobrisanih;
}

/** Konec klica: opravila in stevec napak tega klica gredo iz pomnilnika takoj. */
/** Aktivni klic Line po podatkovni mapi (en klic naenkrat, lastnik 11. 11. 2026). */
// N-7: en vir stanja za vse instance modula (Vite/SSR lahko naloži modul dvakrat: pot Twilio in pot telefona); kot stanje() v glas-telefon.server.ts
const KLJUC_AKTIVNIH = Symbol.for("lina.voice.aktivniKlici");
const aktivniKlici: Map<string, NonNullable<AktivniKlic>> = ((globalThis as { [KLJUC_AKTIVNIH]?: Map<string, NonNullable<AktivniKlic>> })[KLJUC_AKTIVNIH] ??= new Map());

/** Ali pri tej podatkovni mapi zdaj tece klic (racuna med klicem ni dovoljeno menjati). */
export function klicTece(root: string): boolean {
  return aktivniKlici.has(root);
}

/**
 * Pot Live (naloga-live): most Twilio Media Streams <-> Live drzi linijo zasedeno, dokler tece klic. Isti zemljevid kot pot
 * Gather, zato drugi klic dobi stalni stavek »zasedeno« in prvega ne dotakne.
 */
export function osveziAktivniKlic(root: string, sid: string, zdaj = Date.now()): void {
  if (aktivniKlici.get(root)?.sid === sid) aktivniKlici.set(root, { sid, zadnji: zdaj });
}

/**
 * Prevzem linije za klic, ki ga ni pripeljal webhook Twilio (pot telefona, L-04): enaka zasedenost kot pri Twilio (»en klic naenkrat«,
 * lastnik 11. 11. 2026). false = linijo drzi drug klic. Po await se stanje ponovno preveri, da dva hkratna prevzema ne uspeta oba.
 */
export async function prevzemiLinijo(root: string, sid: string, zdaj = Date.now()): Promise<boolean> {
  const aktivni = aktivniKlici.get(root) ?? null;
  if (aktivni && aktivni.sid !== sid) {
    const zapis = await preberiKlic(aktivni.sid, root);
    if (jeLinijaZasedena({ aktivni, sid, aktivniZakljucen: zapis?.status === "zakljucen", now: zdaj })) return false;
  }
  const zdajAktivni = aktivniKlici.get(root) ?? null;
  if (zdajAktivni && zdajAktivni.sid !== sid && zdajAktivni.sid !== aktivni?.sid) return false;
  aktivniKlici.set(root, { sid, zadnji: zdaj });
  return true;
}

/** Pot SIP (SIP-2, sip/sluzba-sip.server.ts): isti prevzem linije kot pot telefona; vrne false, ce ze tece drug klic (prevod: zasediAktivniKlic). */
export const zasediAktivniKlic = prevzemiLinijo;

export function sprostiAktivniKlic(root: string, sid: string): void {
  if (aktivniKlici.get(root)?.sid === sid) aktivniKlici.delete(root);
}

function pocistiKlic(root: string, sid: string): void {
  if (aktivniKlici.get(root)?.sid === sid) aktivniKlici.delete(root);
  const predpona = `${root}\n${sid}\n`;
  for (const kljuc of opravila.keys()) if (kljuc.startsWith(predpona)) opravila.delete(kljuc);
  for (const kljuc of delniIzreki.keys()) if (kljuc.startsWith(predpona)) delniIzreki.delete(kljuc);
  napakeKlicev.delete(`${root}\n${sid}`);
  nadaljevanjaKlica.delete(`${root}\n${sid}`);
  zahteveKlica.delete(`${root}\n${sid}`);
}

let casovnikOpravil: ReturnType<typeof setInterval> | null = null;

function zazeniCiscenjeOpravil(): void {
  if (casovnikOpravil) return;
  casovnikOpravil = setInterval(() => pocistiOpravila(), INTERVAL_OPRAVIL_MS);
  // Casovnik ne drzi procesa pri zivljenju.
  casovnikOpravil.unref?.();
}

/** Zaustavitev (in preizkusi): brez casovnika in brez ostankov v pomnilniku. */
export function ustaviCiscenjeOpravil(): void {
  if (casovnikOpravil) clearInterval(casovnikOpravil);
  casovnikOpravil = null;
  opravila.clear();
  delniIzreki.clear();
  nadaljevanjaKlica.clear();
  napakeKlicev.clear();
  odgovoriVTeku.clear();
}

/** Caka na delo najvec ms; casovnik pobrise, ko delo konca prej, da ne ostane v zanki dogodkov. */
async function cakajNajvec(delo: Promise<void>, ms: number): Promise<void> {
  let casovnik: ReturnType<typeof setTimeout> | undefined;
  const rok = new Promise<void>((resolve) => {
    casovnik = setTimeout(resolve, Math.max(0, ms));
  });
  try {
    await Promise.race([delo, rok]);
  } finally {
    if (casovnik) clearTimeout(casovnik);
  }
}

function premorMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function zazeniObrat(
  kljuc: string,
  root: string,
  vhod: { callSid: string; from: string; text: string; izrek?: string; zahteva?: number; now: string; zaupanje?: number; brezNadaljevanj?: boolean },
  model: ModelOsnutka | undefined,
  ura: () => number,
  nujniPrevezava = false,
  razumevanje?: ModelRazumevanja,
  nadSt = 0,
  prevezavaZahteva?: "cilj" | "brez",
  izvenCasa = false,
  zadrzi?: () => Promise<void>,
): Opravilo {
  const zacetek = ura();
  pocistiOpravila(zacetek);
  let prviPripravljen: () => void = () => undefined;
  const prviDel = new Promise<void>((resolve) => {
    prviPripravljen = resolve;
  });
  const opravilo: Opravilo = {
    at: zacetek,
    izid: null,
    kljuci: null,
    razlog: "",
    status: null,
    gotovo: false,
    napaka: null,
    besedilo: Promise.resolve(),
    konec: Promise.resolve(),
    prviDel,
    kosi: [],
    deli: [],
    sid: vhod.callSid,
    izrek: vhod.text,
    nadSt,
  };
  const obrat = (zadrzi ? zadrzi() : Promise.resolve()).then(() => recordCaller(vhod, root, model, { ...(nujniPrevezava ? { nujniPrevezava: true } : {}), ...(prevezavaZahteva ? { prevezavaZahteva } : {}), ...(izvenCasa ? { prevezavaIzvenCasa: true } : {}), ...(razumevanje ? { razumevanje } : {}) }));
  opravilo.besedilo = obrat.then(
    (izid) => {
      opravilo.izid = izid;
    },
    (error) => {
      opravilo.napaka = error ?? new Error("Obrat ni uspel.");
    },
  );
  opravilo.konec = opravilo.besedilo
    .then(async () => {
      const izid = opravilo.izid;
      if (!izid || izid.nespremenjen || !izid.reply) return;
      // Sinteza se zacne takoj, ko je besedilo znano, vzporedno z morebitnim vmesnim stavkom.
      // CallSid gre v kljuc nestalnih posnetkov: isti stavek v dveh klicih nima istega naslova.
      // Povzetek: vsak podatek je svoj kos, da gre ze pripravljeni del takoj v <Play> (G4b).
      const povzetek = jePovzetek(izid.reply);
      const zvok = await zvokPoKosih(izid.reply, root, vhod.callSid, izid.posebni ?? (povzetek ? deliPovzetka(izid.call) : []), izid.posebni ? ROB_KOSA_PONOVITVE_MS : undefined);
      if ("razlog" in zvok) {
        opravilo.razlog = zvok.razlog;
        return;
      }
      opravilo.kosi = zvok.kosi;
      opravilo.deli = zvok.kosi.map(() => ({ stanje: "caka" as const }));
      const cakanja = zvok.obljube.map((obljuba, i) =>
        obljuba.then(
          (kljucKosa) => {
            opravilo.deli[i] = { stanje: "ok", kljuc: kljucKosa };
            if (i === 0) {
              zabeleziPripravoKosa(kljucKosa, vhod.callSid, izid.call.obrat ?? 0);
              prviPripravljen();
            }
          },
          (error) => {
            opravilo.deli[i] = { stanje: "napaka", error };
          },
        ),
      );
      await Promise.all(cakanja);
      const padel = opravilo.deli.find((del) => del.stanje === "napaka");
      if (padel) {
        const zakaj = razlogNapakeGlasu(padel.error);
        opravilo.razlog = zakaj.razlog;
        opravilo.status = zakaj.status;
        return;
      }
      opravilo.kljuci = opravilo.deli.map((del) => del.kljuc ?? "");
      // Predpriprava (G4b): stavki povzetka z ze znanimi podatki se sintetizirajo, medtem ko klicatelj posluša in
      // govori. Zacne se sele, ko je sinteza tega obrata koncana, in ne zadrzuje odgovora (ozadje).
      if (!povzetek && izid.call.status !== "zakljucen") {
        // G4f: sklonjen stavek narocila se pripravi vnaprej v ozadju; sintezo narocila (ko je rok znan) pocaka, sicer ne zadrzuje
        // sinteze drugih kosov. Ni Twilio zahteve; ob napaki ali zavrnitvi varoval ostane oblika B.
        const stavekModela = pripraviStavekNarocila(izid.call, root).then(() => undefined, () => undefined);
        const rokZnan = imaPodatek(izid.call.order.deadline);
        const predpriprava = (rokZnan ? stavekModela : Promise.resolve())
          .then(() => predpripraviStavke(deliZaPredpripravo(izid.call), root, vhod.callSid))
          .catch(() => undefined);
        ozadje.add(stavekModela);
        void stavekModela.finally(() => ozadje.delete(stavekModela));
        ozadje.add(predpriprava);
        void predpriprava.finally(() => ozadje.delete(predpriprava));
      }
      // Cas do pripravljenega glasu v zapis klica (stevilo, brez vsebine).
      await zabeleziCasGlasu(vhod.callSid, izid.call.obrat ?? 0, ura() - zacetek, root, trenutniZbiralnik()?.posnetek());
    })
    .catch(() => {
      opravilo.razlog = "glasNapaka";
    })
    .finally(() => {
      opravilo.gotovo = true;
      prviPripravljen();
    });
  ozadje.add(opravilo.konec);
  void opravilo.konec.finally(() => ozadje.delete(opravilo.konec));
  opravila.set(kljuc, opravilo);
  return opravilo;
}

/** Rezerva potrditve nujnega klica brez pripravljenega posnetka: angleski stavek (Twilio slovensko ne izgovori razumljivo). */
const NUJNI_POTRDI_REZERVA_EN = "Urgent call. Press 1 to accept.";

/** Zgornja meja prevezanega nujnega klica (s): Dial brez timeLimit bi lahko tekel brez konca na racun lastnika. */
const NAJDALJSA_PREVEZAVA_SEK = 1800;

function dial(stevilka: string, timeout: number, action: string, status: string, timeLimitSek?: number, potrdiUrl?: string): string {
  // answerOnBridge: klicatelj slisi zvonjenje, dokler se osebni telefon ne oglasi (ne tiho povezavo z odzivnikom).
  const omejitev = timeLimitSek ? ` timeLimit="${Math.max(60, Math.min(NAJDALJSA_PREVEZAVA_SEK, Math.round(timeLimitSek)))}" answerOnBridge="true"` : "";
  // Potrditev s pritiskom 1 na klicani nogi PRED povezavo (Number url): odzivnik tipke ne pritisne, zato ne more »sprejeti«.
  const potrdi = potrdiUrl ? ` url="${xmlEscape(potrdiUrl)}" method="POST"` : "";
  return `<Dial timeout="${timeout}" method="POST" action="${xmlEscape(action)}"${omejitev}><Number${potrdi} statusCallback="${xmlEscape(status)}" statusCallbackMethod="POST" statusCallbackEvent="completed">${xmlEscape(stevilka)}</Number></Dial>`;
}

/**
 * GET na /api/voice/*: edina dovoljena pot je posnetek Lininega glasu. Vhodi klica (incoming, turn, status) so
 * samo POST s podpisom; GET nanje je 403 kot pred G2 (pregled G2, N5), ne 404.
 */
export async function handleVoiceGet(request: Request, dir?: string): Promise<Response> {
  let pot = "";
  try {
    pot = new URL(request.url).pathname;
  } catch {
    return forbidden();
  }
  if (pot.startsWith("/api/voice/zvok/") || kljucIzPoti(pot)) return handleZvokRequest(request, dir);
  return forbidden();
}

/**
 * Edini vhod brez prijave. Brez TWILIO_AUTH_TOKEN ali z napacnim
 * X-Twilio-Signature vrne 403 in nicesar ne zapise.
 * now je za preizkus robov dneva; linija uporabi trenutni cas.
 * Odlocitev o prevzemu samo ob prvi zahtevi klica ali ob DialCallStatus.
 */
export function handleVoiceRequest(
  request: Request,
  dir?: string,
  now: Date = new Date(),
  moznosti: MoznostiKlica = {},
): Promise<Response> {
  // Zbiralnik meritev po stopnjah tece skozi vso obdelavo zahteve (podpis, razumevanje, parafraza, TTS, zapis WAV).
  return vZbiralniku(new Zbiralnik(), () => obdelajVoiceZahtevo(request, dir, now, moznosti));
}

async function obdelajVoiceZahtevo(
  request: Request,
  dir?: string,
  now: Date = new Date(),
  moznosti: MoznostiKlica = {},
): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/voice/")) return forbidden();
  if (request.method !== "POST") return forbidden();

  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";

  const params = await formParams(request);
  const zacetekPodpisa = performance.now();
  let given = request.headers.get("x-twilio-signature") ?? "";
  // Javni naslov iz nastavitev (lokalna datoteka) preberemo pred preverbo podpisa: z njim Twilio podpise zahtevo.
  let javni = "";
  try {
    javni = (await loadPravila(resolveDataDir(dir))).javniNaslov ?? "";
  } catch {
    javni = "";
  }
  const naslovPodpisa = signatureUrl(request, javni);
  // Podpis SharedKey (glava X-Twilio-Webhooks-Signature-Settings): kljuc mora biti NASA shranjen vrednost, sicer 403.
  // Brez Auth Tokena in brez shranjenega SharedKey zahteva ni nikoli sprejeta. NEPREVERJENO s pravim Twilio.
  const glavaNastavitev = preberiGlavoPodpisa(request.headers.get("x-twilio-webhooks-signature-settings"));
  let podpisVeljaven = false;
  if (given && glavaNastavitev) {
    let kljuc = null;
    try {
      kljuc = await sharedKeyLine(dir);
    } catch {
      kljuc = null;
    }
    if (kljuc && kljuc.kljucId === glavaNastavitev.kljucId) {
      podpisVeljaven = signaturesMatch(podpisSharedKey(kljuc.skrivnost, glavaNastavitev.algoritem, naslovPodpisa, params), given);
    }
  } else if (given && authToken) {
    podpisVeljaven = signaturesMatch(twilioSignature(authToken, naslovPodpisa, params), given);
  }
  // Preizkusni racun Twilio zahtev ne podpise: sprejmemo SAMO nepodpisano zahtevo za klic, ki ga je Lina sama narocila in ki ga
  // Twilio na vprasanje z API kljucem potrdi (twilio-preizkus.server.ts). Zahteva z (napacnim) podpisom ostane 403.
  if (!podpisVeljaven && !given) {
    const sidPreizkusa = params.CallSid?.trim() ?? "";
    ociscenaPolja(params);
    if (sidPreizkusa && (await preizkusniKlicVeljaven(sidPreizkusa, dir, moznosti.zahtevaTwilio, Date.now(), { od: params.From ?? "", za: params.To ?? "" }))) {
      podpisVeljaven = true;
      given = kljucBrezPodpisa(naslovPodpisa, params);
    } else if (sidPreizkusa && (await sprejetKlicVeljaven(sidPreizkusa, dir, moznosti.zahtevaTwilio, Date.now(), { od: params.From ?? "", za: params.To ?? "" }))) {
      // Vhodni klic na preizkusnem racunu (lastnik 12. 11. 2026): isto zaupanje kot pri testnem klicu, potrjeno prek API Twilio.
      podpisVeljaven = true;
      given = kljucBrezPodpisa(naslovPodpisa, params);
    }
  }
  trenutniZbiralnik()?.dodaj("podpis", performance.now() - zacetekPodpisa);
  if (!podpisVeljaven) return forbidden();
  // Meritev delnih rezultatov prepoznave (Fable 4): samo stetje in zapis (cas, CallSid, zaporedna stevilka, dolzina, zgoscena vrednost za stabilnost),
  // NIKOLI vsebina izreka in nikoli odgovor (Twilio TwiML na delni klic ne sprejme).
  if (new URL(request.url).pathname.endsWith("/delni")) {
    await zabeleziDelniRezultat(resolveDataDir(dir), params).catch(() => undefined);
    return new Response(null, { status: 204 });
  }
  // Preverjena zahteva klica: ogrej povezave do Googla in zeton (samo ob stikalu; brez vsebine klica).
  void ogrejZaKlic(resolveDataDir(dir));

  const obr = url.searchParams.get("obr") ?? "0";
  // cak=K: zahteva po vmesnem stavku. Podpis je ze preverjen cez cel naslov s poizvedbo, zato K ni ponarejen;
  // vrednost vseeno omejimo. Kljuc ponovitve vsebuje podpis, ta pa naslov s cak - zahteva cak zato ni
  // zamenjana s prvo zahtevo istega obrata.
  const cakSurovo = url.searchParams.get("cak");
  // Neveljavna, nicelna ali negativna vrednost velja kot zadnje cakanje: nobena vrednost ne podaljsa verige skokov.
  const cakStevilo = cakSurovo === null ? 0 : Number.parseInt(cakSurovo, 10);
  const cak = cakSurovo === null ? 0 : Number.isInteger(cakStevilo) && cakStevilo >= 1 ? Math.min(NAJVEC_CAKANJ, cakStevilo) : NAJVEC_CAKANJ;
  // od=N: prvih N kosov odgovora je ze predvajanih (podpis pokriva tudi to vrednost).
  const odStevilo = Number.parseInt(url.searchParams.get("od") ?? "0", 10);
  const od = Number.isInteger(odStevilo) && odStevilo > 0 ? Math.min(odStevilo, 50) : 0;
  // nad=1: zahteva z nadaljevanjem nedokoncanega izreka (najvec enkrat na obrat; vrednost je v podpisanem naslovu).
  const nadSurovo = Number.parseInt(url.searchParams.get("nad") ?? "0", 10);
  const nadSt = Number.isInteger(nadSurovo) && nadSurovo > 0 ? Math.min(nadSurovo, NAJVEC_NADALJEVANJ_OBRAT) : 0;
  const nad = nadSt > 0;
  const callSid = params.CallSid?.trim() || "";
  const sidKljuca = params.CallSid ?? "";
  const kljucOdgovora = kljucPonovitve(given, sidKljuca, obr);
  if (claimWebhook(given, params, Date.now(), obr)) {
    // Ponovitev iste podpisane zahteve dobi isti TwiML, tudi ce prva se tece (pregled G2, S4: prej 409).
    const ponovitev = zadnjiTwiml(given, sidKljuca, obr) ?? (await odgovoriVTeku.get(kljucOdgovora)?.catch(() => null));
    if (ponovitev) return odgovorXml(ponovitev);
    return new Response("Ponovljena zahteva", {
      status: 409,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  let oddano: (telo: string) => void = () => undefined;
  odgovoriVTeku.set(
    kljucOdgovora,
    new Promise<string>((resolve) => {
      oddano = resolve;
    }),
  );

  // Atributi modela prepoznave govora (nastavitev govorModel/hintsGovor): nastavljeni, ko so pravila nalozena.
  let govorAtributi = "";
  const poslji = (body: string): Response => {
    const telo = teloXml(govorAtributi ? body.replaceAll('<Gather input="speech" ', () => `<Gather input="speech" ${govorAtributi} `) : body);
    shraniZadnjiTwiml(given, sidKljuca, obr, telo);
    oddano(telo);
    odgovoriVTeku.delete(kljucOdgovora);
    return odgovorXml(telo);
  };

  const root = resolveDataDir(dir);
  const ura = moznosti.ura ?? (() => Date.now());
  zazeniCiscenjeOpravil();
  zazeniCiscenjeZvoka(root);
  zazeniPospravljanjePosnetkov(root);

  try {
    return await obdelaj();
  } catch {
    // Napaka obrata nikoli ni HTTP 500 (pregled G2, S4): Twilio bi klicatelju prebral anglesko sporocilo o napaki.
    // Prvic opravicilo in nadaljevanje, drugic slovo. V dnevnik ne gre nic (napaka lahko nosi vsebino pogovora).
    // Napaka ob PRVI zahtevi klica je prvi govor: stavek z razkritjem UI spredaj (trdo pravilo). Sredi klica je razkritje ze bilo izreceno.
    const pravilaNapake = await loadPravila(root).catch(() => null);
    const sRazkritjem = (besedilo: string) => (obr === "0" || !callSid ? zRazkritjem(pravilaNapake, besedilo) : besedilo);
    // Osebni nacin: slovo brez »lep dan« (lastnik 14. 11. 2026).
    const slovoNapake = pravilaNapake && jeOsebna(pravilaNapake) ? "osebnaOprostiteSlovo" : "oprostiteSlovo";
    try {
      const origin = javniIzvor(request, javni);
      const kljucNapak = `${root}\n${callSid}`;
      const stevilo = (napakeKlicev.get(kljucNapak)?.stevilo ?? 0) + 1;
      napakeKlicev.set(kljucNapak, { at: ura(), stevilo });
      for (const kljuc of opravila.keys()) if (kljuc === `${root}\n${callSid}\n${obr}`) opravila.delete(kljuc);
      if (stevilo >= 2 || !callSid) {
        const slovo = sRazkritjem(t(slovoNapake));
        if (callSid) {
          await zakljuciKlic(callSid, root).catch(() => undefined);
          pocistiKlic(root, callSid);
        }
        return poslji(zZbiranjem(govor(slovo, await pripravljeniKljuci(slovo, root), origin), null));
      }
      const opravicilo = sRazkritjem(t("oprostiteNapaka"));
      const naprej = `${origin}/api/voice/turn?obr=${encodeURIComponent(obr)}`;
      return poslji(zZbiranjem(govor(opravicilo, await pripravljeniKljuci(opravicilo, root), origin), naprej));
    } catch {
      return poslji(`<Say language="sl-SI">${xmlEscape(sRazkritjem(t(slovoNapake)))}</Say><Hangup/>`);
    }
  }

  async function obdelaj(): Promise<Response> {
    // Potrditev nujnega klica na osebnem telefonu (Number url, klicana noga, pred povezavo). Podpis je ze preverjen za vsak naslov.
    // Linin klic je v sid (poizvedba je v podpisanem naslovu). Brez pritiska 1 klicana noga odloži: Dial se konca neuspesno
    // in klicatelj se vrne Lini. Samo oznaka na zapisu klica, brez vsebine in stevilke.
    if (url.pathname.endsWith("/potrdi") || url.pathname.endsWith("/potrdi-tipka")) {
      const sid = (url.searchParams.get("sid") ?? "").trim().slice(0, 80);
      if (url.pathname.endsWith("/potrdi-tipka")) {
        if (sid && (params.Digits ?? "").trim() === "1") {
          // Povezava (prazen odgovor) SELE po uspesnem zapisu sprejema; ob neuspehu Hangup, nikoli povezava brez zapisa.
          const zapisan = await zabeleziSprejem(sid, root).catch(() => false);
          return poslji(zapisan ? "" : "<Hangup/>");
        }
        return poslji("<Hangup/>");
      }
      const izvor = javniIzvor(request, javni);
      const tipka = `${izvor}/api/voice/potrdi-tipka?sid=${encodeURIComponent(sid)}`;
      // Stalni stavek Line (vnaprej pripravljen posnetek, <Play>). Brez posnetka kratek ANGLESKI <Say>: Twiliov Say slovenscine
      // ni razumljiv (pravi klic 10. 11. 2026), slovenskega besedila v Say ne dajemo.
      const kljuciPotrdi = await pripravljeniKljuci(t("nujniPotrdi"), root);
      const poziv =
        kljuciPotrdi && kljuciPotrdi.length > 0
          ? kljuciPotrdi.map((kljuc) => `<Play>${xmlEscape(`${izvor}${potZvoka(kljuc)}`)}</Play>`).join("")
          : `<Say language="en-GB">${xmlEscape(NUJNI_POTRDI_REZERVA_EN)}</Say>`;
      return poslji(`<Gather input="dtmf" numDigits="1" timeout="8" method="POST" action="${xmlEscape(tipka)}">${poziv}</Gather><Hangup/>`);
    }
    const callStatus = (params.CallStatus ?? "").trim().toLowerCase();
    const dialStatus = (params.DialCallStatus ?? "").trim();
    const parentSid = (params.ParentCallSid ?? "").trim();
    const naStatusu = url.pathname.endsWith("/status");

    // Otrokov krak in statusni URL nista pogovor. Samo zapiranje, brez pozdrava.
    if (parentSid || naStatusu) {
      if (callStatus === "completed" && callSid && !parentSid) {
        await zakljuciKlic(callSid, root);
        pocistiKlic(root, callSid);
      }
      const zapri = callStatus === "completed" && !parentSid;
      return poslji(zapri ? "<Hangup/>" : "");
    }

    // Klicatelj je odlozil, tudi med zvonjenjem lastniku. Nikoli recordCaller.
    if (callStatus === "completed") {
      if (callSid) {
        await zakljuciKlic(callSid, root);
        pocistiKlic(root, callSid);
      }
      return poslji("<Hangup/>");
    }

    // Zaporedna stevilka pogovorne zahteve tega klica (1 = prva zahteva): gre v obrat, da se Lina pri predzadnji dovoljeni poslovi.
    const kljucZahtev = `${root}\n${callSid}`;
    const zahteva = callSid ? (zahteveKlica.get(kljucZahtev)?.n ?? 0) + 1 : 0;
    if (callSid) zahteveKlica.set(kljucZahtev, { n: zahteva, at: ura() });
    const line = await loadLine(root);
    const pravila = await loadPravila(root);
    // Izrazi kataloga v obeh nacinih (lastnik 23. 11. 2026: privzeto vse za podjetje in osebno; samo za podjetja je le, kar izrecno
    // narocim). izrazeKatalogaIzklop = meritev brez njih (samo pravila.json).
    // Prilagodljivi kontekst (24. 11. 2026): izrazi stroke za izrazi kataloga (samo branje slovarja; prazno ob izklopu stikala).
    govorAtributi = atributiGovora(pravila, [...(pravila.izrazeKatalogaIzklop ? [] : izraziKataloga(line.catalog)), ...(await namigiStrok(root))]);
    // Action URL je nastavitev. X-Forwarded-* ne sme prepisati gostitelja.
    const origin = javniIzvor(request, pravila.javniNaslov ?? "");
    const action = `${origin}/api/voice/turn`;
    const statusUrl = `${origin}/api/voice/status`;
    // Stalni stavki so pripravljeni pred odprtjem linije; po ponovnem zagonu programa jih prvi klic sprozi v ozadju.
    if (line.open) pripraviStalneVOzadju(root, stalniStavki(pravila, line.catalog.company.name, line.catalog));

    const isTurn = url.pathname.endsWith("/turn");
    // Snemanje (nacin podjetje, lastnik 22. 11. 2026): zahteva /turn pride sele po pozdravu z napovedjo; v ozadju, klic ne caka.
    if (isTurn && callSid && !parentSid) void obIzrekuKlicatelja(root, callSid, (params.SpeechResult ?? "").slice(0, 500), pravila).catch(() => undefined);
    /** Tisina po govoru za naslednji izrek klicatelja: dlje, ko Lina caka narekovan podatek (ime, telefon, e-posta). */
    const tisinaZa = (klic?: { caka?: CakaPodatek; korak?: string; status?: string; nacin?: string; order?: { tajnica?: { sporocilo?: string } } } | null): number =>
      // Osebna tajnica po zapisanem sporocilu: 2 s, razen ce je lastnik tisino nastavil sam.
      klic?.nacin === "osebna" && klic.order?.tajnica?.sporocilo && !pravila.tisinaNastavil
        ? TISINA_OSEBNA_PO_SPOROCILU_SEK
        : tisinaPoGovoru(klic?.korak === "ime" ? "ime" : klic?.caka, pravila);
    const kljucOpravila = (sid: string) => `${root}\n${sid}\n${obr}`;
    // Nujni klic na osebni telefon (stikalo »Prevezi nujni klic name«): stevilka je samo tu, za Dial; ne gre v dnevnik ali zapis.
    // Izracun za vsak obrat klicatelja (tudi skoke po vmesnem stavku), ker izid obrata lahko pride sele v skoku.
    // Zanka: nikoli na klicano (Linino) stevilko, na stevilko, s katere je bil klic preusmerjen, ali na klicatelja.
    const kljuciZanke = [params.To ?? "", params.ForwardedFrom ?? "", params.From ?? ""];
    const ciljNujne =
      isTurn && callSid && !dialStatus
        ? await nujnaPrevezava(root, kljuciZanke).catch(() => null)
        : null;
    // Prevezava na zahtevo klicatelja (»prava oseba« ali nujno; lastnik 23. 11. 2026): stevilka za preusmeritev. "brez" = stikalo vklopljeno, a
    // prevezave ni (Lina samo oznaci nujno). Osebni telefon nujnih ima prednost, ce je nastavljen.
    const ciljZahteve =
      isTurn && callSid && !dialStatus
        ? await prevezavaNaZahtevo(root, pravila, kljuciZanke).catch(() => null)
        : null;
    // Delovni cas prevezave (nacin podjetje, lastnik 23. 11. 2026; urnik.ts): zunaj urnika ni Diala na nobeni poti (nujni klic in zahteva); obrat dobi
    // samo podatek, da bi prevezava bila mogoca, in Lina pove, da je zunaj delovnega casa. Ura je `now` zahteve (preizkusi jo vbrizgajo).
    const izvenCasa = Boolean(ciljNujne || (ciljZahteve && ciljZahteve !== "brez")) && prevezavaIzvenCasa(pravila, now);
    const prevezavaNujna = izvenCasa ? null : ciljNujne;
    const naZahtevo = izvenCasa ? null : ciljZahteve;
    // Stavek »zunaj delovnega casa« ni stalen (nov stalni stavek bi ustavil preklop sloga glasu): ob zahtevah klica zunaj urnika se pripravi kot
    // posnetek klica, skupaj z vprasanjem po sporocilu (v podjetju ni stalno). Enkrat na klic, ob prvi zahtevi /incoming ali /turn (pri privzetem prevzemu
    // »neodgovorjeni« je to ze zahteva pred Dialom, Lina govori sele po vrnitvi); nikoli na poteh druge noge (/potrdi, /potrdi-tipka, /delni).
    const kljucIzven = `${root}\n${callSid}`;
    if (
      callSid &&
      (isTurn || url.pathname.endsWith("/incoming")) &&
      !izvenCasaPripravljen.has(kljucIzven) &&
      pravila.prevezaNaZahtevo !== false &&
      pravila.preusmeritev &&
      prevezavaIzvenCasa(pravila, now) &&
      (await glasNaVoljo(root))
    ) {
      if (izvenCasaPripravljen.size > 200) izvenCasaPripravljen.clear();
      izvenCasaPripravljen.add(kljucIzven);
      for (const stavek of [t("prevezavaIzvenCasa"), t("osebnaSporocilo")]) void predpripraviOdgovor(stavek, root, callSid);
    }
    const prevezava = prevezavaNujna ?? (naZahtevo && naZahtevo !== "brez" ? naZahtevo : null);
    const zRezervo = async (razlog: KodaGlasu, status: number | null, kje: MestoGlasu): Promise<void> => {
      // Vsak odgovor, ki konca v <Say>, pusti zapis z razlogom (vodja 10. 11. 2026); vsebine pogovora v njem ni.
      await zapisiRazlogGlasu(root, razlog, status, kje);
    };

    /** Vmesni stavek med cakanjem: samo prvic »Trenutek, prosim.«; nadaljnji skoki so tihi; brez posnetka molk. */
    const vmesniStavek = async (bezVmesnega = false): Promise<string> => {
      // Ob povzetku nikoli (lastnik, 10. 11. 2026: prevec »Trenutek, prosim«): klicatelj slisi povzetek, ne cakanja.
      if (cak > 0 || bezVmesnega) return "";
      const vmesni = t("trenutek");
      const kljuciVmesnega = await pripravljeniKljuci(vmesni, root);
      return kljuciVmesnega ? govor(vmesni, kljuciVmesnega, origin) : '<Pause length="1"/>';
    };

    /** Stalni stavek zunaj obrata (linija zaprta, ponovitev): posnetek, sicer rezerva z zapisom razloga. */
    const povej = async (besedilo: string): Promise<string> => {
      const kljuci = await pripravljeniKljuci(besedilo, root);
      if (!kljuci) await zRezervo((await glasNaVoljo(root)) ? "glasPrepozen" : "glasNiVertex", null, "odgovor");
      return govor(besedilo, kljuci, origin);
    };

    // Tiho cakanje na nadaljevanje odrezanega izreka (Gather brez govora; vsako nadaljevanje je ena zahteva). Definirano PRED `oddaj`: izid »caka
    // nadaljevanje« lahko pride sele v skoku (cak > 0), kjer zahteva nima SpeechResult; zdruzeni izrek in stevilo nadaljevanj zato nosi opravilo
    // (neodvisni pregled 14. 11. 2026: dostop pred inicializacijo je obrat koncal z napako in opravicilom). `del` je del te zahteve, ki gre v
    // prepis kot svoja vrstica (skil, ZAPIS POGOVORA); pri »nedokoncano« modela ga je zapisal ze obrat. Zapis je kratek (calls.json).
    const tihoNadaljuj = async (sidKlica: string, besedilo: string, stNad: number, del = ""): Promise<Response> => {
      delniIzreki.set(`${root}\n${sidKlica}\n${obr}`, { at: ura(), besedilo: besedilo.slice(0, 2000) });
      if (del) {
        // Zapis dela ne zadrzi odgovora Twiliu (neodvisni pregled 14. 11. 2026: prebere in zapise celo knjigo klicev; izmerjeno 39-42 ms pri 500
        // in 443-629 ms pri 5000 shranjenih klicih; brez roka bi odgovor cakal tudi na obesen obrat). Zapis gre v vrsto klica takoj (sinhrono do
        // prvega await), zato naslednji obrat istega klica pocaka nanj in vrstni red vrstic ostane.
        const zapisDela: Promise<void> = zapisiDelIzreka({ callSid: sidKlica, izrek: del, zdruzeno: besedilo, now: now.toISOString() }, root)
          .catch(() => undefined)
          .finally(() => ozadje.delete(zapisDela));
        ozadje.add(zapisDela);
      }
      if (pravila.nacinKlica === "osebna") {
        const kljucStevca = `${root}\n${sidKlica}`;
        nadaljevanjaKlica.set(kljucStevca, { n: (nadaljevanjaKlica.get(kljucStevca)?.n ?? 0) + 1, at: ura() });
      }
      const nadaljuj = `${action}?obr=${encodeURIComponent(obr)}&nad=${stNad + 1}`;
      return poslji(zZbiranjem("", nadaljuj, CAKAJ_NADALJEVANJE_SEK, tisinaPoGovoru("telefon", pravila)));
    };

    /**
     * Odgovor po pravilu: takoj <Play>, ce je pripravljeno v meji; sicer vmesni stavek in Redirect; na koncu rezerva.
     * prvi: Linin prvi stavek v klicu. Pred razkritjem UI ne sme biti nobenega drugega stavka (pregled G2, V1),
     * zato tu ni vmesnega stavka: pozdrav gre takoj, s pripravljenimi posnetki ali v rezervi <Say>.
     */
    const oddaj = async (opravilo: Opravilo, kljuc: string, prvi: boolean): Promise<Response> => {
      const imaGlas = await glasNaVoljo(root);
      if (prvi) {
        await cakajNajvec(opravilo.besedilo, moznosti.cakajBrezGlasuMs ?? CAKAJ_BREZ_GLASU_MS);
        if (opravilo.napaka) throw opravilo.napaka;
        opravila.delete(kljuc);
        const izid = opravilo.izid;
        if (izid?.nespremenjen) return poslji("<Hangup/>");
        // Sinteza tece naprej v ozadju (opravilo.konec) in bo pripravljena za naslednji klic.
        const besedilo = izid?.reply || uvodKlica(pravila, line.catalog.company.name);
        const kljuci = opravilo.gotovo && opravilo.kljuci ? opravilo.kljuci : await pripravljeniKljuci(besedilo, root);
        if (!kljuci) await zRezervo(imaGlas ? "glasPrepozen" : "glasNiVertex", null, "pozdrav");
        if (pravila.nacinKlica === "osebna" && callSid && izid?.call.status !== "zakljucen") {
          let trajanje = 0;
          for (const k of kljuci ?? []) trajanje += trajanjeWavMs((await preberiWavPosnetka(root, k).catch(() => null)) ?? new Uint8Array());
          if (trajanje <= 0) trajanje = Math.round((besedilo.length / ZNAKOV_NA_SEKUNDO) * 1000);
          if (oknaPozdrava.size > 200) oknaPozdrava.clear();
          oknaPozdrava.set(`${root}\n${callSid}`, ura() + trajanje + REZERVA_PO_POZDRAVU_MS);
          // Fable 6 (14. 11. 2026): odgovor s stevilko klicatelja se pripravi v ozadju MED pozdravom (~7 s), da je na vprasanje »a imate mojo
          // stevilko« takoj na voljo. Samo stevila v kljucu klica (nestalni posnetek, pobrise se s klicem); napaka sinteze ne vpliva na klic.
          const besedno = stevilkaBesedno(params.From ?? "");
          if (besedno) {
            for (const kljucBesedila of ["osebnaStevilka", "osebnaNejasno"] as const) void predpripraviOdgovor(t(kljucBesedila).replace("{stevilka}", () => besedno), root, callSid);
          }
        }
        const hangup = izid?.call.status === "zakljucen";
        const naprej = `${action}?obr=${izid ? (izid.call.obrat ?? 1) : obr}`;
        const twimlPozdrava = zZbiranjem(govor(besedilo, kljuci, origin), hangup ? null : naprej, 20, izid ? tisinaZa(izid.call) : tisinaPoGovoru("ime", pravila));
        // Meritev delnih rezultatov (stikalo merjenjeDelnih, privzeto izklopljeno): samo na Gather pozdrava osebnega nacina.
        if (pravila.merjenjeDelnih && pravila.nacinKlica === "osebna" && !hangup) {
          return poslji(twimlPozdrava.replace('<Gather input="speech" ', () => `<Gather input="speech" partialResultCallback="${xmlEscape(`${origin}/api/voice/delni`)}" partialResultCallbackMethod="POST" `));
        }
        return poslji(twimlPozdrava);
      }
      const meja = !imaGlas
        ? (moznosti.cakajBrezGlasuMs ?? CAKAJ_BREZ_GLASU_MS)
        : cak === 0
          ? (moznosti.cakajMs ?? CAKAJ_MS)
          : (moznosti.cakajNaprejMs ?? CAKAJ_NAPREJ_MS);
      // Trda meja obrata: do nje raje se en vmesni stavek kot odgovor v nerazumljivem glasu posrednika.
      const trdaMeja = moznosti.trdaMejaMs ?? TRDA_MEJA_OBRATA_MS;
      const ostane = () => trdaMeja - (ura() - opravilo.at);
      // Brez Lininega glasu cakamo samo besedilo; z glasom do meje zahteve na CEL odgovor. Vsaka zahteva steje v mejo
      // preizkusnega racuna Twilio (10 na klic; pravi klic lastnika 10. 11. 2026 se je zato prekinil): po kosih
      // predvajamo sele, ko cel odgovor v tej zahtevi ni pripravljen - prvi stavek tako nadomesti vmesni stavek.
      const cakanja = Math.max(0, Math.min(meja, ostane()));
      const zacetekCakanja = Date.now();
      // Povzetek ne caka cele meje: najprej besedilo (brez modela je takoj), nato kratko na zvok (G4b).
      await cakajNajvec(opravilo.besedilo, cakanja);
      const povzetek = Boolean(opravilo.izid && jePovzetek(opravilo.izid.reply));
      // Nadaljnji skok (cak > 0) pride po predvajanem prvem delu: tam se caka polna meja, da ne porabimo se ene zahteve.
      const preostalo = povzetek && cak === 0 ? Math.min(CAKAJ_POVZETEK_MS, cakanja) : Math.max(0, cakanja - (Date.now() - zacetekCakanja));
      const zvokPovzetka = povzetek && cak === 0 && imaGlas ? opravilo.prviDel.then(() => premorMs(PRIPRAVLJEN_PRVI_POVZETEK_MS)) : null;
      await cakajNajvec(imaGlas ? (zvokPovzetka ? Promise.race([opravilo.konec, zvokPovzetka]) : opravilo.konec) : opravilo.besedilo, preostalo);
      const zadnje = cak >= NAJVEC_CAKANJ;
      if (!opravilo.gotovo && zadnje && !opravilo.izid && !opravilo.napaka) {
        await cakajNajvec(opravilo.besedilo, meja);
      }
      if (opravilo.napaka) {
        opravila.delete(kljuc);
        throw opravilo.napaka;
      }
      const result = opravilo.izid;
      const skokNa = (naslednjiOd: number) => {
        const dalje = `${action}?obr=${encodeURIComponent(obr)}&cak=${cak + 1}${naslednjiOd > 0 ? `&od=${naslednjiOd}` : ""}`;
        return `<Redirect method="POST">${xmlEscape(dalje)}</Redirect>`;
      };
      if (!result) {
        if (zadnje) {
          // Obrat se v tem casu ni zapisal (disk, model): klic ne sme obmolkniti, klicatelj naj ponovi.
          await zRezervo("glasPrepozen", null, "odgovor");
          return poslji(zZbiranjem(await povej(t("nisemSlisala")), `${action}?obr=${obr}`, 20, tisinaZa(null)));
        }
        // Brez Lininega glasu je vmesni stavek molk: »Trenutek« v glasu posrednika ni razumljiv.
        return poslji(`${imaGlas ? await vmesniStavek() : '<Pause length="1"/>'}${skokNa(od)}`);
      }
      if (result.nespremenjen) {
        opravila.delete(kljuc);
        return poslji("<Hangup/>");
      }
      // Model je izrek oznacil »nedokoncano« (osebna): Lina ne odgovori, obrat se ni zapisal; tiho poslusa nadaljevanje.
      if (result.cakaNadaljevanje) {
        opravila.delete(kljuc);
        return await tihoNadaljuj(opravilo.sid, opravilo.izrek, opravilo.nadSt);
      }
      const hangup = result.call.status === "zakljucen";
      const naprej = `${action}?obr=${result.call.obrat ?? 1}`;
      let timeout = rokZbira(result.call.startedAt, now.toISOString(), pravila.najdaljsiPogovorMinut);
      // Osebna tajnica po zapisanem sporocilu: kratko cakanje na odziv (4 s), nato slovo (~11 s tisine je bilo predolgo). Po VSAKEM Lininem
      // vprasanju 6 s (odgovor se konca z vprasajem: »Imate še kakšno vprašanje?«, »Želite, da ponovim sporočilo?«; neodvisni pregled 14. 11. 2026:
      // prej samo po besedi »vprašanje?«).
      if (result.call.nacin === "osebna" && result.call.order.tajnica?.sporocilo && !pravila.tisinaNastavil) {
        // Samo Linina lastna vprasanja (stalni frazi + 15. 11. potrditev/ime), ne poljuben odgovor z vprasajem.
        const vprasanjeLine = [t("osebnaVprasanje"), t("osebnaPonovimVprasanje"), t("osebnaPravRazumela"), t("osebnaKakoIme")].some((fraza) => result.reply.trim().endsWith(fraza));
        timeout = Math.min(timeout, vprasanjeLine ? TIMEOUT_OSEBNA_PO_VPRASANJU_SEK : TIMEOUT_OSEBNA_PO_SPOROCILU_SEK);
        // Ponovitev caka na kose: kratko cakanje (1 s), nato naslednji obrat predvaja ponovitev.
        if (result.call.osebnoPonovitevCaka) timeout = 1;
      }
      const zakljuci = async (spoken: string): Promise<Response> => {
        opravila.delete(kljuc);
        // Obrat je zahteval prevezavo, cilja pa ob tej zahtevi ni vec (stikalo, stevilka ali »Ustavi vse« spremenjeni med skoki; pregled 029,
        // najdba 9): izid takoj kot neodgovor, klic ostane pri Lini (stalni stavek in sporocilo), dogodek »poskus« ne ostane brez izida.
        if (result.prevezi && !prevezava) {
          const izid = await prevezavaIzid(result.call.callSid, false, root, now.toISOString());
          if (izid && !izid.ponovitev) {
            let govorjeno = spoken;
            for (const del of izid.deli) {
              const kljuciDela = (await pripravljeniKljuci(del, root)) ?? (await pripravljeniKljuci(del, root, [del], result.call.callSid));
              govorjeno += kljuciDela ? govor(del, kljuciDela, origin) : await povej(del);
            }
            if (izid.konec) pocistiKlic(root, result.call.callSid);
            return poslji(zZbiranjem(govorjeno, izid.konec ? null : `${action}?obr=${izid.call.obrat ?? 1}`, timeout, tisinaZa(izid.call)));
          }
        }
        // Nujen klic: Lina je rekla samo »Poskusam vas povezati«; Dial na osebni telefon, po izteku se klic vrne Lini (nujni=1).
        if (result.prevezi && prevezava) {
          // Stavka po neuspeli prevezavi, ki v tem nacinu nista stalna (osebna; »Katero sporočilo …« v podjetju), se pripravita MED zvonjenjem
          // (posnetek klica, pobrise se s klicem), da Lina po vrnitvi klica ne govori v glasu posrednika.
          for (const stavek of [t("nujniNeOglasi"), t("osebnaSporocilo")]) void predpripraviOdgovor(stavek, root, result.call.callSid);
          const poDialu = `${action}?nujni=1&obr=${result.call.obrat ?? 1}`;
          return poslji(`${spoken}${dial(prevezava.stevilka, prevezava.cakanjeSek, poDialu, statusUrl, (pravila.najdaljsiPogovorMinut || 30) * 60, `${origin}/api/voice/potrdi?sid=${encodeURIComponent(result.call.callSid)}`)}`);
        }
        return poslji(zZbiranjem(spoken, hangup ? null : naprej, timeout, tisinaZa(result.call)));
      };
      const kosi = opravilo.kosi;
      if (kosi.length === 0) {
        // Kosov ni: brez glasu, odklopnik ali sinteza se ni zacela. Brez glasu in po koncanem obratu takoj rezerva.
        if (opravilo.gotovo || !imaGlas) {
          await zRezervo(opravilo.razlog || (imaGlas ? "glasNapaka" : "glasNiVertex"), opravilo.status, "odgovor");
          return zakljuci(govor(result.reply, null, origin));
        }
        return poslji(`${await vmesniStavek(povzetek)}${skokNa(od)}`);
      }
      // Kosi od »od« naprej, ki so ze pripravljeni: predvajamo jih v vrstnem redu, vsakega natanko enkrat.
      const zacetek = Math.min(od, kosi.length);
      let pripravljenih = 0;
      while (zacetek + pripravljenih < kosi.length && opravilo.deli[zacetek + pripravljenih].stanje === "ok") pripravljenih += 1;
      const posnetki = opravilo.deli.slice(zacetek, zacetek + pripravljenih).map((del) => del.kljuc ?? "");
      // En <Play> za vse ze pripravljene kose (tocka B, osebna tajnica): zlepek brez nove sinteze; ob napaki locceni kosi. Podjetje ostane kot prej
      // (povzetek in znani odgovori podjetja so preizkuseni po kosih; razsiritev po meritvi v pravem klicu).
      const predvajaj = posnetki.length > 0 ? govor("", pravila.nacinKlica === "osebna" ? await zlepiPosnetke(posnetki, root, callSid) : posnetki, origin) : "";
      const naslednji = zacetek + pripravljenih;
      if (naslednji >= kosi.length) return zakljuci(predvajaj);
      const padel = opravilo.deli[naslednji].stanje === "napaka";
      if (padel || zadnje || ostane() <= 0) {
        // Sinteza je odpovedala ali je obrat presegel trdo mejo: preostanek (in samo preostanek) gre v rezervo.
        const zakaj = padel ? razlogNapakeGlasu(opravilo.deli[naslednji].error) : { razlog: "glasPrepozen" as const, status: null };
        if (!padel) sproziOdklopnik(root);
        await zRezervo(zakaj.razlog, zakaj.status, "odgovor");
        return zakljuci(`${predvajaj}${govor(kosi.slice(naslednji).join(" "), null, origin)}`);
      }
      // Prvi del je pripravljen: predvajamo ga brez vmesnega stavka, ostanek pride v naslednjem skoku.
      if (pripravljenih > 0) return poslji(`${predvajaj}${skokNa(naslednji)}`);
      return poslji(`${await vmesniStavek(povzetek)}${skokNa(zacetek)}`);
    };

    if (cak > 0) {
      // Zahteva po vmesnem stavku nikoli ne poklice modela in ne zapise obrata: samo caka na opravilo.
      if (!isTurn || !callSid) return poslji("<Hangup/>");
      if (aktivniKlici.get(root)?.sid === callSid) aktivniKlici.set(root, { sid: callSid, zadnji: ura() });
      const kljuc = kljucOpravila(callSid);
      const opravilo = opravila.get(kljuc);
      if (opravilo) return oddaj(opravilo, kljuc, false);
      // Opravila ni (ponovni zagon programa): ce je obrat ze zapisan, povemo zapisani odgovor z rezervo.
      const klic = await preberiKlic(callSid, root);
      if (klic?.status === "zakljucen") return poslji("<Hangup/>");
      // Del odgovora je ze bil predvajan: ne ponavljamo ga, klicatelj nadaljuje.
      if (od > 0 && klic) return poslji(zZbiranjem("", `${action}?obr=${klic.obrat ?? 1}`, 20, tisinaZa(klic)));
      const zadnji = klic ? [...klic.transcript].reverse().find((vrstica) => vrstica.role === "lina") : undefined;
      const zapisan = klic && zadnji && String((klic.obrat ?? 0) - 1) === obr;
      const besedilo = zapisan ? zadnji.text : t("nisemSlisala");
      const naprej = `${action}?obr=${zapisan ? (klic.obrat ?? 1) : obr}`;
      return poslji(zZbiranjem(await povej(besedilo), naprej, 20, tisinaZa(klic)));
    }

    // Po Dial na osebni telefon (nujni klic), PRED preverbo linije in zasedenosti (zaprta linija ne sme izgubiti izida): uporabnik se je oglasil -> klic se zakljuci; sicer klic OSTANE PRI LINI (nic se ne
    // izgubi): stalni stavek, nato naslednje vprasanje ali slovo. Zapis klica dobi cas in izid, brez stevilke.
    if (isTurn && callSid && dialStatus && url.searchParams.get("nujni") === "1") {
      // »Oglasil« samo ob pritisku 1 na osebnem telefonu (prevezavaIzid preveri zapis); sicer klic ostane pri Lini.
      const oglasil = dialStatus === "completed" || dialStatus === "answered";
      const izid = await prevezavaIzid(callSid, oglasil, root, now.toISOString());
      if (izid?.ponovitev) {
        // Ponovitev action URL ali izid ze obdelan: nic novega v zapis, klicatelj samo nadaljuje.
        const rokP = rokZbira(izid.call.startedAt, now.toISOString(), pravila.najdaljsiPogovorMinut);
        return poslji(zZbiranjem("", `${action}?obr=${izid.call.obrat ?? 1}`, rokP, tisinaZa(izid.call)));
      }
      if (!izid || izid.oglasil) {
        await zakljuciKlic(callSid, root).catch(() => undefined);
        pocistiKlic(root, callSid);
        return poslji("<Hangup/>");
      }
      let govorjeno = "";
      for (const del of izid.deli) {
        // Stalni posnetek, sicer posnetek tega klica (pripravljen med zvonjenjem), sicer rezerva kot povej.
        const kljuciKlica = (await pripravljeniKljuci(del, root)) ? null : await pripravljeniKljuci(del, root, [del], callSid);
        govorjeno += kljuciKlica ? govor(del, kljuciKlica, origin) : await povej(del);
      }
      if (izid.konec) pocistiKlic(root, callSid);
      const naprejPoDialu = `${action}?obr=${izid.call.obrat ?? 1}`;
      const rok = rokZbira(izid.call.startedAt, now.toISOString(), pravila.najdaljsiPogovorMinut);
      return poslji(zZbiranjem(govorjeno, izid.konec ? null : naprejPoDialu, rok, tisinaZa(izid.call)));
    }

    if (!line.open) return poslji(zZbiranjem(await povej(zRazkritjem(pravila, t("linijaZaprta"))), null));

    // En klic naenkrat (lastnik 11. 11. 2026): drugi klic dobi sporocilo in se konca; prvi klic se ne dotakne
    // (zapis, opravila in zasedenost ostanejo nespremenjeni). Zasedenost se sprosti ob koncu klica ali po izteku.
    const aktivni = aktivniKlici.get(root) ?? null;
    if (callSid && aktivni && aktivni.sid !== callSid) {
      const zapisAktivnega = await preberiKlic(aktivni.sid, root);
      if (
        jeLinijaZasedena({
          aktivni,
          sid: callSid,
          aktivniZakljucen: zapisAktivnega?.status === "zakljucen",
          now: ura(),
        })
      ) {
        return poslji(zZbiranjem(await povej(zRazkritjem(pravila, t(jeOsebna(pravila) ? "osebnaLinijaZasedena" : "linijaZasedena"))), null));
      }
    }

    const naVhodu = url.pathname.endsWith("/incoming");
    // /turn z neznanim CallSid ne klice lastnika. Odlocitev je samo na vhodu ali po Dial.
    const odlocaj = naVhodu || Boolean(dialStatus);
    if (odlocaj) {
      const odlocitev = odlocitevLinije({
        nacin: pravila.prevzem,
        cakanjeSekund: pravila.cakanjeSekund,
        zvonjenjeSekund: dialStatus ? pravila.cakanjeSekund : 0,
        now,
        hours: line.catalog.company.hours,
        dialStatus,
      });
      if (odlocitev === "prekini") return poslji("<Hangup/>");
      if (odlocitev === "cakaj") {
        const stevilka = pravila.preusmeritev.trim();
        const klicana = vE164(stevilka) ?? "";
        const zanka =
          Boolean(klicana) &&
          (istaStevilka(klicana, params.To ?? "") || istaStevilka(klicana, params.ForwardedFrom ?? ""));
        if (klicana && !zanka && !jeNedovoljenaPreusmeritev(klicana, pravila.dovoljenePredpone ?? "")) {
          return poslji(dial(klicana, pravila.cakanjeSekund, action, statusUrl));
        }
        // Brez stevilke, zanka, ForwardedFrom ali premijska: javne stevilke ne klicemo.
      }
    }

    // Pot Live (nastavitev naPot = »live«, privzeto izklopljena): TwiML <Connect><Stream> z enkratnim zetonom; od tu
    // govor in zapis klica vodi most (live/most.ts). Podpis Twilio je ze preverjen zgoraj, zasedenost in odlocitev o
    // prevzemu (28 s zvonjenja, Dial) sta ze obdelani. Brez prijave Google Cloud Live ni na voljo in klic ostane na poti Gather.
    // Razkritje UI je trdo pravilo (lastnik 14. 11. 2026, »tak je zakon«): na pot Live samo, ce je posnetek pozdrava z razkritjem ze pripravljen;
    // sicer klic ostane na poti Gather, kjer gre razkritje prvo (posnetek ali rezerva <Say>).
    if (pravila.naPot === "live" && odlocaj && callSid && (await glasNaVoljo(root)) && (await pripravljeniKljuci(uvodKlica(pravila, line.catalog.company.name), root)) !== null) {
      aktivniKlici.set(root, { sid: callSid, zadnji: ura() });
      return poslji(twimlLive(origin, izdajZetonLive(callSid, Date.now(), params.From ?? "")));
    }

    const sid = callSid || `klic-${crypto.randomUUID()}`;
    if (callSid) aktivniKlici.set(root, { sid: callSid, zadnji: ura() });
    const from = params.From ?? "";
    const slisano = isTurn && !dialStatus ? params.SpeechResult || params.Digits || "" : "";
    const zapisKlica = await preberiKlic(sid, root);
    // Nedokoncan izrek (kratka tisina ga je odrezala): Lina iz polovice ne sklepa. Enkrat pocaka nadaljevanje z novim
    // Gather brez govora in oba dela zdruzi; obrat se zapise sele z zdruzenim izrekom. Brez modela.
    const kljucDela = `${root}\n${sid}\n${obr}`;
    const prviDel = nad ? (delniIzreki.get(kljucDela)?.besedilo ?? "") : "";
    if (nad) delniIzreki.delete(kljucDela);
    const cakaPodatek: CakaPodatek = zapisKlica?.korak === "ime" ? "ime" : zapisKlica?.caka;
    const speech = prviDel ? zdruziIzrek(prviDel, slisano) : slisano;
    const jeOsebnaNad = pravila.nacinKlica === "osebna";
    const kljucNad = `${root}\n${sid}`;
    const porabljenoNad = nadaljevanjaKlica.get(kljucNad)?.n ?? 0;
    // Podjetje: najvec eno nadaljevanje na obrat (kot doslej). Osebna: do 2 na obrat in 3 na klic; nadaljevanje brez govora (tisina) pomeni, da je
    // klicatelj nehal, zato naprej ne cakamo.
    const smeNadaljevati = jeOsebnaNad ? nadSt < NAJVEC_NADALJEVANJ_OBRAT && (nadSt === 0 || Boolean(slisano)) && porabljenoNad < NAJVEC_NADALJEVANJ_KLIC : !nad;
    if (smeNadaljevati && zapisKlica && zapisKlica.status !== "zakljucen" && speech && jeNedokoncan(speech, cakaPodatek)) return await tihoNadaljuj(sid, speech, nadSt, slisano);
    // Klicatelj resnicno brez stevilke in znaki bota (tisina, ponavljanje, fraze robocall): Lina klic zavrne (lastnik 12. 11. 2026).
    // Prikrita stevilka ni brez stevilke. Odlocitev vodi koda, ne model.
    if (isTurn && !dialStatus && jeSumljivBot(`${root}\n${sid}`, from, speech, ura())) {
      await zakljuciKlic(sid, root).catch(() => null);
      return poslji("<Hangup/>");
    }
    // Linin prvi stavek v klicu: obrat 0 ali klic, ki ga se ni v zapisu (npr. /turn z neznanim CallSid).
    const prvi = obr === "0" || !zapisKlica;
    // Obrat tece mimo webhooka: model in sinteza ne smeta zadrzati odgovora Twiliu.
    const kljuc = kljucOpravila(sid);
    const zaupanje = Number.parseFloat(params.Confidence ?? "");
    // Prvi govor po pozdravu: ali je prisel se med pozdravom (okno pozdrava)?
    const okno = isTurn && !dialStatus && callSid ? oknaPozdrava.get(`${root}\n${callSid}`) : undefined;
    if (okno !== undefined) oknaPozdrava.delete(`${root}\n${callSid}`);
    const predPozdravom = okno !== undefined && Boolean(speech) && ura() <= okno;
    const opravilo = zazeniObrat(
      kljuc,
      root,
      { callSid: sid, from, text: speech, izrek: slisano, ...(zahteva > 0 ? { zahteva } : {}), now: now.toISOString(), ...(predPozdravom ? { predPozdravom } : {}), ...(!(jeOsebnaNad && smeNadaljevati) ? { brezNadaljevanj: true } : {}), ...(slisano && Number.isFinite(zaupanje) && zaupanje > 0 && zaupanje <= 1 ? { zaupanje } : {}) },
      moznosti.model,
      ura,
      Boolean(prevezavaNujna),
      moznosti.razumevanje,
      nadSt,
      naZahtevo === null ? undefined : naZahtevo === "brez" ? "brez" : "cilj",
      izvenCasa,
      moznosti.zadrziObrat,
    );
    return oddaj(opravilo, kljuc, prvi);
  }
}

/** Nastavitev, sicer izvor zahteve. Posredniskih glav ne beremo. */
function javniIzvor(request: Request, nastavljen: string): string {
  const raw = nastavljen.trim().replace(/\/+$/, "");
  if (/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/i.test(raw)) return raw;
  return new URL(request.url).origin;
}
