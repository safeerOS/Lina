import { requireOwner } from "./auth.server.ts";
import { imeVTozilniku } from "./ime-tozilnik.ts";
import { absorbUtterance, draftFromOrder, freshCall, jeSignalPopravka, odgovorNaPotrditev, renderReply, slipFromGuard, wantsHangup } from "./brain.ts";
import { defaultLine } from "./catalog.ts";
import { t } from "./besedila.ts";
import { jeNevarnost } from "./nevarnost.ts";
import { applyGuards, fold, vprasaPoCeni } from "./guards.ts";
import { brezUvoda, jedroOdgovora, sestaviOdgovor } from "./govor.ts";
import { jeVprasanje, odgovorIzKataloga } from "./znanje.ts";
import { polishReply, polishReplyIzid, speakAudio } from "./llm.server.ts";
import { zRazkritjem, imaPovprasevanje, jeKratekKlic, jeOsebna, osebniZakljucek, povzetekBrezPodatkov, povzetekKlica, povzetekZaPotrditev, razkritjeSpredaj, uvodKlica, stalniStikPovzetka } from "./povzetek.ts";
import { loadPravila, zapomniVrzel } from "./pravila.server.ts";
import {
  besediloOpozorila,
  dopolniStik,
  goloPodjetje,
  jeVidnaStevilka,
  jeZavrnitev,
  manjkajoci,
  poisciTelefon,
  prazenStik,
  razberiIme,
  redigirajDnevnik,
  redigirajPoDelih,
  soDeliIzreka,
  brezIzgovorjenegaStika,
  lahkoDelStika,
  steviloStevk,
  telefonIzBesed,
  uveljaviStik,
  zajemiStik,
  zapriStik,
} from "./stik.ts";
import { zabeleziVbrizg, zaznajVbrizg } from "./vbrizg.ts";
import { omenilEposto, stavekPotrditve } from "./eposta.ts";
import { PREDPONA_KLICA_TELEFONA } from "./klici-telefon.ts";
import { kliciTelefona } from "./sinhron-telefon.server.ts";
import { NAJVEC_SPOROCILA, imaTajnico, jeNujno, ocistiSporocilo, razvrstiKlice, sporociloObProsnji, zajemiTajnico, zeliPravoOsebo } from "./tajnica.ts";
import { rezervirajKvoto, sprozNujnoObvestilo } from "./nujni.server.ts";
import { odgovorTemeLastnika } from "./teme.ts";
import { razlogPolja } from "./plast.ts";
import { odgovorKatalog, razumiIzrek, type ModelRazumevanja } from "./razumevanje.server.ts";
import { SKIL_RAZLICICA } from "./skil-lina.ts";
import { NAJMANJ_VSEBINSKIH_BESED, VPRASALNICA_OSEBNA, VPRASANJE_O_ZAPISU, beriZnaneNapake, jeKonecOsebno, jePonovitev, prosnjaZaPonovitev, lociMetaVprasanje, lociVprasanjeOdsotnosti, jeMalopogovor, jeProsnjaZaCakanje, lociSlovo, jeSamoPozdravnoPolnilo, stevilkaBesedno, vrstaVgrajenega, vsebinskeBesede, type VrstaVgrajenega } from "./osebna-polnila.ts";
import { odsotnostOdgovor, odsotnostStavek, vrstaVprasanjaOdsotnosti } from "./odsotnost.ts";
import { aktivnoNavodiloPaketa, jeDostava, odgovorDostavljalcu } from "./paket.ts";
import { razumiOsebniIzrek } from "./osebna-razumevanje.server.ts";
import { imaSlovo, izberiVarianto, jeVabiloAliVprasanje } from "./osebna-slovo.ts";
import { preveriOdgovorZnanja, skrajsajZnanje, stavkiBesedila, zadnjiStavek } from "./odgovor-znanje.ts";
import { fazaTrajanja } from "./trajanje.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";
import { povzetekSpremembeKataloga } from "./revizija-katalog.ts";
import { zapisiRevizijo } from "./revizija.server.ts";
import { Zbiralnik, merjeno, trenutniZbiralnik, vZbiralniku } from "./meritve.server.ts";
import { ogrejZaKlic } from "./ogrevanje-klica.server.ts";
import { hedge, type Hedge } from "./hedge.ts";
import type { CallSession, LineState, LinijaZGlasom, MerjenjeObrata, NujniDogodek, OdgovorVaje, Pravila, StanjeOdprtja, TurnResult, ZapisVaje } from "./types.ts";

export type { OdgovorVaje, ZapisVaje } from "./types.ts";
import { kosiPonovitve, potZvoka, stalniStavki, VARIANTE_OSEBNE } from "./glas.ts";
import {
  glasPripravljenZa,
  ODLOG_PO_SLOVESU_MS,
  pobrisiZvokKlica,
  poPripraviGlasu,
  pripraviStalne,
  stanjeGlasu,
  predpripraviOdgovor,
  glasNaVoljo,
  pripravljeniKljuci,
  zazeniCiscenjeZvoka,
  zvokZaBesedilo,
} from "./glas.server.ts";
import { ureSoRazumljive } from "./ure.ts";
import { jeNedokoncan, MEJA_ZAHTEV_KLICA } from "./tisina.ts";
import { zapisiZapisekKlica } from "./zapiski.server.ts";
import { zapisiKlicVDatoteko } from "./klici-datoteka.server.ts";
import { brezTematskihZapiskov, parsePublish } from "./validate.ts";

export type SessionContext = { token: string | null };

type CallBook = Record<string, CallSession>;

const MAX_LINES = 40;

/** Vrsta po CallSid drzi vrstni red enega klica. Knjiga je zaklenjena samo ob zapisu. */
const vrsteSida = new Map<string, Promise<unknown>>();
const vrsteKnjige = new Map<string, Promise<unknown>>();

function vVrsti<T>(vrsta: Map<string, Promise<unknown>>, kljuc: string, delo: () => Promise<T>): Promise<T> {
  const prej = vrsta.get(kljuc) ?? Promise.resolve();
  const tek = prej.then(delo, delo);
  vrsta.set(
    kljuc,
    tek.then(
      () => undefined,
      () => undefined,
    ),
  );
  return tek;
}

/** Po zakljucku klica vrsta ne ostane v pomnilniku. */
function pocistiVrsto(vrsta: Map<string, Promise<unknown>>, kljuc: string): void {
  const trenutno = vrsta.get(kljuc);
  if (!trenutno) return;
  void trenutno.finally(() => {
    if (vrsta.get(kljuc) === trenutno) vrsta.delete(kljuc);
  });
}

/** Za preizkus: koliko klicev se drzi v vrsti. */
export function steviloVrstSida(): number {
  return vrsteSida.size;
}

/** Model za preizkus. Linija in Twilio ga ne podata. */
export type ModelOsnutka = (facts: string, signal?: AbortSignal) => Promise<string>;
/** Izid vzporedno zacetega klica parafraze: besedilo (null = ni uspel), cas klica in njegova meritev. */
type KlicParafraze = { v: string | null; ms: number; merjenje: MerjenjeObrata };

function zakljuci(call: CallSession, now: string, inquiry: string): void {
  if (typeof call.kratek !== "boolean") call.kratek = jeKratekKlic(call.startedAt, now);
  // Kar klicatelj ni povedal, je v zapisu »ni podatka«, ne prazno polje (slog besedil, razdelek 4).
  if (!call.order.customerName) call.order.customerName = t("niPodatka");
  call.status = "zakljucen";
  call.povzetek = povzetekKlica(call, inquiry);
}

/**
 * G5 (lastnik 11. 11. 2026): vsak pogovor ima svoj zapisek v mapi zapiskov; nastane ob koncu klica. Vaja zapiska nima.
 * Napaka zapiska (mapa ni pisljiva ...) ne sme podreti konca klica: zapis klica ostane v calls.json.
 */
async function zapisekOdKlica(root: string, sid: string, call: CallSession): Promise<void> {
  if (call.vaja) return;
  try {
    const ime = await zapisiZapisekKlica(call, root);
    if (ime !== call.zapisek) {
      call.zapisek = ime;
      await zapisiKnjigo(root, sid, call);
    }
  } catch {
    /* Zapisek se ob naslednji dopolnitvi klica poskusi znova. */
  }
  try {
    await zapisiKlicVDatoteko(call, root);
  } catch {
    /* Napaka Klici.txt ne sme podreti konca klica in ne sme prepreciti zapiska. */
  }
}

function casObrata(value?: string): string {
  if (value && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return new Date().toISOString();
}

export async function loadLine(dir?: string): Promise<LineState> {
  const saved = await readJsonFile<LineState>(resolveDataDir(dir), "line.json");
  if (!saved?.catalog?.company) return defaultLine();
  return { ...saved, catalog: brezTematskihZapiskov(saved.catalog) };
}

async function loadCalls(dir: string): Promise<CallBook> {
  // L-03: knjiga brez prototipa: callSid "__proto__" ali "constructor" ne more onesnaziti Object.prototype.
  return Object.assign(Object.create(null) as CallBook, (await readJsonFile<CallBook>(dir, "calls.json")) ?? {});
}

/** L-03: oblika oznake klica (Twilio CA<hex>, tel-<hex>): stroga bela lista, brez __proto__, vodilnega _ ali -, presledkov in predolgih. */
const OBLIKA_CALLSID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

async function zapisiKnjigo(root: string, callSid: string, call: CallSession): Promise<void> {
  await vVrsti(vrsteKnjige, root, async () => {
    const sveze = await loadCalls(root);
    sveze[callSid] = trimCall(call);
    await writeJson(root, "calls.json", sveze);
  });
}

/** Kje zivi zapis klica. Pravi klici so v calls.json; vaja samo v pomnilniku, da na disku ne pusti sledi. */
type Knjiga = {
  beri(root: string, sid: string): Promise<CallSession | undefined>;
  zapisi(root: string, sid: string, call: CallSession): Promise<void>;
};

const knjigaKlicev: Knjiga = {
  beri: async (root, sid) => (await loadCalls(root))[sid],
  zapisi: zapisiKnjigo,
};

const NAJVEC_VAJ = 20;
const vaje = new Map<string, CallSession>();

const knjigaVaj: Knjiga = {
  // Kopija kot pri branju z diska: obrat ne spreminja shranjenega zapisa, dokler ga ne zapise.
  beri: async (root, sid) => {
    const zapis = vaje.get(`${root}\n${sid}`);
    return zapis ? structuredClone(zapis) : undefined;
  },
  zapisi: async (root, sid, call) => {
    const kljuc = `${root}\n${sid}`;
    vaje.delete(kljuc);
    vaje.set(kljuc, structuredClone(trimCall(call)));
    while (vaje.size > NAJVEC_VAJ) {
      const najstarejsa = vaje.keys().next().value;
      if (najstarejsa === undefined) break;
      vaje.delete(najstarejsa);
    }
  },
};

/** Za preizkus: koliko vaj je v pomnilniku. */
export function steviloVaj(): number {
  return vaje.size;
}

/** Vrstica klicatelja brez vsebine: stik (ime, telefon, e-naslov) je v zapisniku, v prepis ne gre. */
const BREZ_VSEBINE = "Podatek je v zapisniku.";

/**
 * Vrstica klicatelja v prepis: vsak SpeechResult je svoja vrstica (skil, ZAPIS POGOVORA). Redakcija stika pa velja za ZDRUZENI izrek (neodvisni
 * pregled 14. 11. 2026: narek telefona ali e-naslova, ki ga je premor razdelil, je po delih ostal v prepisu): ze zapisane vrstice prejsnjih delov
 * (oznaka `del`) in novi del dobijo samo besede, ki jih ima redigirani zdruzeni izrek (redigirajPoDelih). `del` je del te zahteve (prazen ob molku po
 * odrezanem delu), `zdruzeno` izrek z vsemi deli. Vrne indekse vrstic tega izreka v prepisu.
 */
function zapisiVrsticoKlicatelja(
  call: CallSession,
  del: string,
  zdruzeno: string,
  redigiraj: (besedilo: string) => string,
  vrstica: Omit<CallSession["transcript"][number], "role" | "text">,
  cakaNadaljevanje = false,
  /** Osebni nacin: vrstica odrezanega dela z mozno delno stevilko ali e-naslovom gre v prepis brez vsebine, dokler zdruzitev ne pokaze, kaj ni stik. */
  skrijDelStika = false,
): number[] {
  // Prejsnji deli istega izreka: zadnje vrstice klicatelja z oznako `del` (po njih Lina ni rekla nicesar).
  let prej: number[] = [];
  for (let i = call.transcript.length - 1; i >= 0 && call.transcript[i].role === "stranka" && call.transcript[i].del; i -= 1) prej.unshift(i);
  const besedila = prej.map((i) => (call.transcript[i].text === BREZ_VSEBINE ? "" : call.transcript[i].text));
  let novo = redigiraj(del);
  // Osebni nacin: ce je bil prvi del skrit zaradi delnega stika (lahkoDelStika), ga ob zdruzitvi (samo v pomnilniku, brez zapisa surovega stika na disk)
  // uporabimo za poravnavo redigiranega zdruzenega izreka, da ostane neredigirani del na prvi vrstici in skriti stik v drugi.
  const zaPoravnavo = (() => {
    if (!cakaNadaljevanje && call.nacin === "osebna" && prej.length === 1 && besedila[0] === "" && del) {
      const z = zdruzeno.trimEnd();
      const d = del.trim();
      if (z.length > d.length && z.endsWith(d)) {
        const prvi = z.slice(0, z.length - d.length).trim();
        if (prvi) return [prvi, del];
      }
    }
    return del ? [...besedila, del] : besedila;
  })();
  // Nadaljevanje samo, ce je izrek res zdruzen in vsebuje prejsnje dele (po ponovnem zagonu programa se prvi del v pomnilniku izgubi).
  if (prej.length > 0 && zdruzeno.trim() !== del.trim() && soDeliIzreka(zaPoravnavo, zdruzeno)) {
    const poDelih = redigirajPoDelih(zaPoravnavo, redigiraj(zdruzeno));
    // Izrek je se vedno odrezan (novo nadaljevanje): delni stik ne gre v nobeno vrstico.
    const skrij = (besedilo: string) => (cakaNadaljevanje && skrijDelStika && lahkoDelStika(besedilo) ? "" : besedilo);
    for (const [n, i] of prej.entries()) call.transcript[i].text = skrij(poDelih[n] ?? "") || BREZ_VSEBINE;
    novo = del ? skrij(poDelih[prej.length] ?? "") : "";
  } else {
    // Zdruzitve ni: prejsnje vrstice niso vec del tega izreka (oznaka bi jih sicer zbrala kasnejsi izrek; drugi slepi pregled 14. 11. 2026).
    for (const i of prej) delete call.transcript[i].del;
    prej = [];
    if (cakaNadaljevanje && skrijDelStika && lahkoDelStika(novo)) novo = "";
  }
  if (!del) return prej;
  call.transcript.push({ role: "stranka", text: novo || BREZ_VSEBINE, ...vrstica, ...(cakaNadaljevanje ? { del: true as const } : {}) });
  return [...prej, call.transcript.length - 1];
}

/** Zgodovina zivi samo na strezniku, kljuc je CallSid. Model caka zunaj kljucavnice knjige. */
export async function recordCaller(
  input: { callSid: string; from?: string; text?: string; izrek?: string; zahteva?: number; hangup?: boolean; now?: string; zaupanje?: number; predPozdravom?: boolean; brezNadaljevanj?: boolean },
  dir?: string,
  model?: ModelOsnutka,
  moznosti: MoznostiObrata = {},
): Promise<TurnResult> {
  const root = resolveDataDir(dir);
  const sid = input.callSid.trim().slice(0, 80) || "_";
  // Klic s telefona (naloga 17) je koncan zapis: odlozi ali replika (talk, phoneTurn) ne sme v calls.json narediti klica z njegovim id-jem.
  if (sid.startsWith(PREDPONA_KLICA_TELEFONA)) throw new Error(t("klicTelefonaSamoBranje"));
  const kljuc = `${root}\n${moznosti.vaja ? "vaja\n" : ""}${sid}`;
  return vVrsti(vrsteSida, kljuc, async () => {
    // Merjenje po stopnjah: ce webhook ze ima zbiralnik (podpis, TTS), ga deli; sicer ima ta obrat svojega.
    const izid = await vZbiralniku(trenutniZbiralnik() ?? new Zbiralnik(), () => obratKlica(input, root, model, moznosti));
    // Nujen klic: takojsnje obvestilo na osebni telefon (samo ob vklopljenem stikalu; ozadje, klica ne zadrzi).
    if (!moznosti.vaja) sprozNujnoObvestilo(root, izid.call, dodajNujniDogodek);
    if (izid.call.status === "zakljucen") {
      pocistiVrsto(vrsteSida, kljuc);
      // Lina se je poslovila: posnetki tega klica gredo ven, ko jih Twilio prebere (status klica jih pobrise prej).
      void pobrisiZvokKlica(root, sid, ODLOG_PO_SLOVESU_MS).catch(() => undefined);
    }
    return izid;
  });
}

/**
 * Odrezan izrek, na katerega Lina caka nadaljevanje po pravilu (voice, brez obrata): v prepis gre kot svoja vrstica (skil, ZAPIS POGOVORA: nic se
 * ne zdruzuje), z oznako `del`. Stik se skrije po ZDRUZENEM izreku (`zdruzeno` = vsi deli do zdaj). Brez odgovora in brez spremembe obrata; ce
 * zapisa klica ni, se nic ne zgodi.
 */
export async function zapisiDelIzreka(input: { callSid: string; izrek: string; zdruzeno?: string; now?: string; zaupanje?: number }, dir?: string): Promise<void> {
  const root = resolveDataDir(dir);
  const sid = input.callSid.trim().slice(0, 80);
  const izrek = input.izrek.trim().slice(0, 2000);
  if (!sid || !izrek) return;
  const zdruzeno = (input.zdruzeno ?? "").trim().slice(0, 2000) || izrek;
  await vVrsti(vrsteSida, `${root}\n${sid}`, async () => {
    const call = await knjigaKlicev.beri(root, sid);
    if (!call || call.status === "zakljucen") return;
    const now = casObrata(input.now);
    let redigiraj: (besedilo: string) => string;
    if (call.nacin === "osebna") redigiraj = (besedilo) => redigirajDnevnik(besedilo, false);
    else if (call.caka === "telefon" || call.caka === "eposta") {
      // Lina je vprasala po telefonu ali e-naslovu: odrezan odgovor je narek stika, ki se v celoti prepozna sele v zdruzenem izreku. Del zato ne
      // gre v prepis dobesedno (ce klicatelj vmes odlozi, delna stevilka ne ostane); kar ni stik, vrne redakcija zdruzenega izreka.
      redigiraj = () => "";
    } else {
      // Enako skrivanje kot v obratu podjetja (izloci besede kataloga in naslov podjetja).
      const line = await loadLine(root);
      const cakaOdgovor = call.korak === "ime" || call.caka === "ime" || (Boolean(call.stik?.vprasan) && !call.stik?.ime);
      const izloci = besedeKataloga(line);
      const kraji = [line.catalog.company.address];
      redigiraj = (besedilo) => redigirajDnevnik(besedilo, cakaOdgovor, izloci, kraji);
    }
    zapisiVrsticoKlicatelja(call, izrek, zdruzeno, redigiraj, { at: now, ...merjenjeGovora(input.zaupanje, izrek) }, true, call.nacin === "osebna");
    call.updatedAt = now;
    await knjigaKlicev.zapisi(root, sid, call);
  });
}

/**
 * Dogodek nujnega klica (obvestilo, prevezava) v zapis klica: cas in izid, brez stevilke. Klic ze koncan: zapisek se prepise,
 * da je dogodek viden tudi v njem. Pisanje gre skozi vrsto klica (po koncanem obratu).
 */
export async function dodajNujniDogodek(root: string, callSid: string, dogodek: NujniDogodek): Promise<void> {
  const sid = callSid.trim();
  const kljuc = `${root}\n${sid}`;
  await vVrsti(vrsteSida, kljuc, async () => {
    const call = (await loadCalls(root))[sid];
    if (!call) {
      // Zapisa klica ni (dirka, brisanje): dogodek ne sme izginiti brez sledi; v dnevnik samo vrsta in izid, brez stevilke.
      console.warn(`nujni dogodek brez zapisa klica: ${dogodek.vrsta} ${dogodek.izid}`);
      return;
    }
    call.nujniDogodki = [...(call.nujniDogodki ?? []), dogodek];
    await zapisiKnjigo(root, sid, call);
    if (call.status === "zakljucen") await zapisekOdKlica(root, sid, call);
  });
  if ((await preberiKlic(sid, root))?.status === "zakljucen") pocistiVrsto(vrsteSida, kljuc);
}

export type IzidPrevezave = { deli: string[]; konec: boolean; call: CallSession; ponovitev?: boolean; oglasil?: boolean };

/** Uporabnik je na osebnem telefonu pritisnil 1 (Twilio Number url, pred povezavo): edini dokaz, da se je oglasil clovek. */
export async function zabeleziSprejem(callSid: string, dir?: string): Promise<boolean> {
  const root = resolveDataDir(dir);
  const sid = callSid.trim().slice(0, 80);
  // true SAMO ce je sprejem res zapisan na aktivnem klicu z zacetim poskusom prevezave; ob vsakem neuspehu (ni klica, zakljucen,
  // brez poskusa, zapis spodleti) false: klicana noga odlozi in klicatelj ostane pri Lini.
  return vVrsti(vrsteSida, `${root}\n${sid}`, async () => {
    const call = (await loadCalls(root))[sid];
    if (!call || call.status === "zakljucen") return false;
    const dogodki = call.nujniDogodki ?? [];
    const zadnji = [...dogodki].reverse().find((d) => d.vrsta === "prevezava");
    if (zadnji?.izid !== "poskus") return false;
    call.nujniSprejeto = true;
    await zapisiKnjigo(root, sid, call);
    return true;
  });
}

/**
 * Izid prevezave nujnega klica (Twilio Dial, action URL): oglasil = uporabnik je dvignil in klic je tekel na njegovem telefonu
 * (zapis klica se zakljuci, ostane dogodek); sicer (nihce se ni oglasil, zasedeno, napaka) klic OSTANE PRI LINI: stalni stavek
 * (brez obljube, brez stevilke), nato naslednje manjkajoce vprasanje ali zakljucek - klic se ne izgubi. Dogodek »poskus« dobi
 * izid. deli so ze stavki za govor (vsak svoj stalni posnetek).
 */
export async function prevezavaIzid(callSid: string, oglasilVhod: boolean, dir?: string, now?: string): Promise<IzidPrevezave | null> {
  const root = resolveDataDir(dir);
  const sid = callSid.trim();
  return vVrsti(vrsteSida, `${root}\n${sid}`, async () => {
    const call = (await loadCalls(root))[sid];
    if (!call || call.status === "zakljucen") return null;
    const cas = casObrata(now);
    const dogodki = [...(call.nujniDogodki ?? [])];
    const i = dogodki.map((d) => d.vrsta).lastIndexOf("prevezava");
    // Izid sprejmemo SAMO za prevezavo, ki jo je Lina res zacela (zadnji dogodek prevezava z izidom »poskus«). Ponovitev
    // Twilio action URL ali izmisljen klic ne ustvari dogodka, ne doda vrstice v transkript in ne ponovi vprasanja.
    if (i < 0 || dogodki[i].izid !== "poskus") return { deli: [], konec: false, call, ponovitev: true };
    // »Oglasil« samo ob pritisku 1 na osebnem telefonu (odzivnik ga ne pritisne; trajanje pogovora ni dokaz).
    const oglasil = oglasilVhod && call.nujniSprejeto === true;
    const izid = oglasil ? ("oglasil" as const) : ("neodgovor" as const);
    dogodki[i] = { ...dogodki[i], izid };
    call.nujniDogodki = dogodki;
    if (oglasil) {
      call.updatedAt = cas;
      await zapisiKnjigo(root, sid, call);
      return { deli: [], konec: true, call, oglasil: true };
    }
    const pravila = await loadPravila(root);
    // Klic ostane pri Lini: zadeva je NUJNA (tudi pri prevezavi na zahtevo brez sporocila), nato sporocilo ali naslednje vprasanje.
    const { deli, konec } = poNeuspeliPrevezavi(call, pravila, t("nujniNeOglasi"));
    const besedilo = deli.join(" ");
    call.transcript.push({ role: "lina", text: povzetekBrezPodatkov(besedilo), at: cas, ms: 0 });
    if (povzetekBrezPodatkov(besedilo) === besedilo) call.zadnjaLina = besedilo.slice(0, 500);
    if (konec) zakljuci(call, cas, pravila.povprasevanje);
    call.updatedAt = cas;
    call.obrat = (call.obrat ?? 0) + 1;
    await zapisiKnjigo(root, sid, call);
    if (konec) {
      await zapisekOdKlica(root, sid, call);
      pocistiVrsto(vrsteSida, `${root}\n${sid}`);
    }
    return { deli, konec, call, oglasil: false };
  });
}

function casNiPomemben(text: string): boolean {
  const kljuc = fold(text);
  return /\b(ni pomemben|ni pomembno|ni nujn|kadarkoli|kdajkoli|brez roka|cas ni pomemben|vseeno)\b/.test(kljuc);
}

/** Null, ce podjetja ni omenil. Prazen niz pomeni fizicno osebo, da ne vprasamo se enkrat. */
function zajemiPodjetje(text: string): string | null {
  const kljuc = fold(text);
  if (/\b(nisem iz podjetja|ne klicem v imenu|fizicna oseba|zasebno|kot fizicna|nisem iz firme)\b/.test(kljuc)) {
    return "";
  }
  const m = text.match(/(?:v imenu(?: podjetja)?|iz podjetja|za podjetje)\s+([\p{Lu}][\p{L}\d&.'-]{1,40})/u);
  return m ? m[1].replace(/[.,;]+$/g, "").trim() : null;
}

type Polje = "ime" | "telefon" | "eposta" | "rok" | "dosegljiv" | "kolicina" | "nujnost";

/**
 * Kdaj je klicatelj dosegljiv. Izrecen stavek (»pokličite …«, »dosegljiv sem …«) velja kadarkoli; prost odgovor
 * (»Jutri popoldne.«) samo kot odgovor na vprasanje o povratnem klicu - odgovor na vprasanje X gre samo v polje X
 * (pregled G2, S5). »Ni pomembno« pri vprasanju o roku ni podatek o povratnem klicu.
 */
function zajemiDosegljivost(text: string, caka: Polje | undefined, prostOdgovor: string): string {
  const drugoVprasanje = caka !== undefined && caka !== "dosegljiv";
  if (casNiPomemben(text) && !drugoVprasanje && !/\bbrez roka\b/.test(fold(text))) return "ni-nujno";
  // G4g: cas povratnega klica konca pri vejici in nikoli ne vsebuje e-naslova (»pokličite me jutri, moja e-posta je ana@primer.si«
  // se je prej odrezalo na »... je ana@« in to je Lina izgovorila).
  const brezPoste = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, " ");
  const izrecno = brezPoste.match(/\b((?:pokli[cč]ite|dosegljiv\w*)[^.,]{0,40})/i);
  if (izrecno) return izrecno[0].replace(/\s+/g, " ").trim().slice(0, 80);
  if (caka !== "dosegljiv" || jeZavrnitev(text).splosno) return "";
  return prostOdgovor.replace(/[.!\s]+$/g, "").slice(0, 80);
}

/** Zadnji stavek klica ima zahvalo in lep dan, tudi ce veja vrne krajse besedilo. */
function zLepimDnem(text: string): string {
  const imaHvala = /hvala/i.test(text);
  const imaDan = /lep dan/i.test(text);
  const dod = [!imaHvala ? t("hvalaStik") : "", !imaDan ? t("lepDan") : ""].filter(Boolean).join(" ");
  return `${text} ${dod}`.replace(/\s+/g, " ").trim();
}

/**
 * Povprasevanje je tudi to, kar klicatelj pove s svojimi besedami in ne ustreza natanko izdelku iz kataloga
 * (meritev vodje 10. 11. 2026: »miza iz hrasta, dva metra« je obtical pri izbiri modela in klic se ni koncal).
 */
/** Opozorilo samo enkrat. Ce okno preskocimo, opozorilo pride pred slovo in brez modela. */
function odzivCasa(call: CallSession, faza: ReturnType<typeof fazaTrajanja>, pravila?: Pravila): { reply: string; konec: boolean } | null {
  if (faza === "brez") return null;
  if (!call.opozorjen) {
    call.opozorjen = true;
    call.caka = undefined;
    // Pred iztekom casa ni vec obratov za posamezna vprasanja: manjkajoce povemo skupaj, a nicesar ne vprasamo drugic.
    const ze = new Set(call.vprasano ?? []);
    const manjka = manjkajoci(call.stik ?? prazenStik()).filter((polje) => !ze.has(polje));
    // G4g: povratnega klica Lina ne sprasuje vec; pred iztekom casa samo rok (in ime/telefon, ce ju se nima).
    const extra = [!call.order.deadline && !ze.has("rok") ? t("prosiRok") : ""].filter(Boolean);
    if ((manjka.length > 0 || extra.length > 0) && call.stik) call.stik.vprasan = true;
    call.vprasano = [...new Set([...ze, ...manjka, "rok" as const, "dosegljiv" as const])];
    return { reply: [besediloOpozorila(manjka), ...extra].join(" "), konec: false };
  }
  if (faza === "potek") {
    call.order.oznaka = t("casPotekel");
    // Prosnja za e-posto velja v vsakem klicu s povprasevanjem, tudi ob izteku casa (lastnik 23. 11. 2026).
    return { reply: zlepi([pravila ? potrditevEnkrat(call, pravila) : "", t("casSlovo")]), konec: true };
  }
  return null;
}

/** Vrstni red lastnika (10. 11. 2026): rok, telefon. Ime je vprasano v pozdravu; ce klic pozdrava ni imel (pogovor iz
 * programa), pride enkrat za rokom. G4g (lastnik 11. 11. 2026, po 5. klicu): klicateljeve e-poste in casa povratnega klica
 * Lina NE sprasuje vec (Twilio je e-posto in podjetje zgresil); polji ostaneta v zapisu za stare klice in ce ju klicatelj pove sam. */
const VRSTNI_RED: Polje[] = ["kolicina", "rok", "ime", "telefon", "nujnost"];
const VPRASANJE: Record<Polje, "prosiRok" | "prosiIme" | "prosiTelefon" | "prosiEposto" | "prosiDosegljiv" | "prosiKolicino" | "prosiNujnost"> = {
  nujnost: "prosiNujnost",
  kolicina: "prosiKolicino",
  rok: "prosiRok",
  ime: "prosiIme",
  telefon: "prosiTelefon",
  eposta: "prosiEposto",
  dosegljiv: "prosiDosegljiv",
};

function jeZnano(call: CallSession, polje: Polje): boolean {
  const stik = call.stik ?? prazenStik();
  // Tajnica (lastnik 10. 11. 2026): nujnost Lina vprasa samo ob sporocilu za direktorja in samo, ce je klicatelj ni povedal sam;
  // rok izdelave pri klicu samo s sporocilom nima smisla (brez izdelka ali prostega povprasevanja).
  if (polje === "nujnost") return !imaTajnico(call) || Boolean(call.order.tajnica?.nujnostZnana);
  if (polje === "rok") return Boolean(call.order.deadline) || (imaTajnico(call) && !imaPovprasevanje(call));
  // G4g: kolicino Lina vprasa samo pri izdelku; prosto povprasevanje (>>miza iz hrasta, dva metra<<) kolicine nima.
  if (polje === "kolicina") return !(call.order.productName || call.order.requestedProduct) || Boolean(call.order.quantity);
  if (polje === "ime") return Boolean(stik.ime);
  if (polje === "telefon") return Boolean(stik.telefon);
  if (polje === "eposta") return Boolean(stik.email);
  return Boolean(call.order.dosegljiv);
}

/**
 * ENO vprasanje naenkrat (lastnik potrdil 10. 11. 2026): naslednje manjkajoce polje, ki ga Lina se NI vprasala.
 * Vsako vprasanje najvec enkrat; kar je klicatelj ze povedal, preskoci. Prazen niz: ni vec vprasanj.
 * Vsa vprasanja so stalni stavki - brez modela in s pripravljenim posnetkom.
 */
function naslednjeVprasanje(call: CallSession): string {
  const ze = new Set(call.vprasano ?? []);
  for (const polje of VRSTNI_RED) {
    if (ze.has(polje) || jeZnano(call, polje)) continue;
    call.vprasano = [...ze, polje];
    call.caka = polje;
    call.korak = "podatki";
    if (call.stik) call.stik.vprasan = true;
    return t(VPRASANJE[polje]);
  }
  call.caka = undefined;
  return "";
}

/**
 * Stavek o povratnem klicu po potrditvi (G4g): »Ce bomo potrebovali dodatne informacije, vas bomo poklicali ...«. Enkrat.
 * Samo, ce lahko obljubo izpolnimo: vidna stevilka klicatelja (>>na stevilko, s katere klicete<<) ali stevilka, ki jo je povedal.
 * Ce je klicatelj sam povedal cas (>>pokli\u010dite me jutri<<), ga povzetek ze vsebuje in stavka ni.
 */
function povratniKlicEnkrat(call: CallSession): string {
  const doseg = call.order.dosegljiv;
  if (call.niNujnoPovedano || !imaPovprasevanje(call) || (doseg && doseg !== "ni-nujno")) return "";
  const stik = stalniStikPovzetka(call);
  const povedana = jeVidnaStevilka(call.stik?.telefon);
  const stavek = stik[0] ?? (povedana ? t("povratniKlicSploh") : "");
  if (stavek) call.niNujnoPovedano = true;
  return stavek;
}

/**
 * Prosnja, naj klicatelj narocilo poslje se po e-posti na naslov podjetja (G4g: Lina naslov izgovori): PO potrditvi, pred
 * zahvalo in slovesom, najvec enkrat, samo ko je povprasevanje zapisano in je vpisan veljaven naslov (vpis ga vklopi,
 * stikalo za izklop ostane). Lina s tem narocila ne potrdi.
 */
function potrditevEnkrat(call: CallSession, pravila: Pravila): string {
  if (call.order.potrditevEposta || !imaPovprasevanje(call)) return "";
  const omenjeno = omenilEposto(call.transcript.filter((v) => v.role === "stranka").map((v) => v.text));
  const stavek = stavekPotrditve(pravila, omenjeno);
  if (stavek) call.order.potrditevEposta = true;
  return stavek;
}

/** Zaupanje prepoznave (Twilio Confidence) in dolzina besedila v zapis klica: primerjava modelov po klicu, brez vsebine. */
function merjenjeGovora(zaupanje: number | undefined, text: string): { zaupanje?: number; znakov?: number } {
  // Twilio za sl-SI vrne Confidence 0 tudi pri dobro razumljenem stavku: 0 (ali manjka) je NEZNANO in se ne zapise.
  const ok = typeof zaupanje === "number" && Number.isFinite(zaupanje) && zaupanje > 0 && zaupanje <= 1;
  return { ...(ok ? { zaupanje: Math.round((zaupanje as number) * 1000) / 1000 } : {}), znakov: text.length };
}

/** Golo pozdravljanje ali polnila (osebna tajnica): seznam je v osebna-polnila.ts. */
export function jeGoloPozdravljanje(text: string): boolean {
  return jeSamoPozdravnoPolnilo(text);
}

function zlepi(deli: string[]): string {
  return deli.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Kratek zakljucek po povedani potrebi (lastnik, 14. 11. 2026): prosnja za e-posto na naslov podjetja (ce ga je uporabnik
 * vpisal), zahvala, »podjetje vas bo kontaktiralo«, lep dan. Brez dodatnih vprasanj. Isti stavek je stalni posnetek (glas.ts).
 */
export function kratekZakljucekPodjetja(call: CallSession, pravila: Pravila): string {
  call.caka = undefined;
  call.stik = zapriStik(call.stik ?? prazenStik());
  call.order = uveljaviStik(call.order, call.stik);
  return zlepi([potrditevEnkrat(call, pravila), t("kratekZakljucek"), t("lepDan")]);
}

/**
 * Konec zbiranja podatkov: kaj sledi, prosnja za potrditev, zahvala in lep dan. Brez modela.
 * Brez »Hvala, zapisala sem.« (lastnik, 10. 11. 2026: »saj se zahvalimo na koncu«) - ena zahvala, na koncu.
 */
function zakljucekZbiranja(call: CallSession, pravila: Pravila): string {
  call.caka = undefined;
  call.stik = zapriStik(call.stik ?? prazenStik());
  call.order = uveljaviStik(call.order, call.stik);
  return zlepi([potrditevEnkrat(call, pravila), povratniKlicEnkrat(call), t("slovo"), t("lepDan")]);
}

/**
 * Vsi podatki so zbrani: Lina ponovi, kar je razumela, in vprasa »Ali potrjujete naročilo?« (lastnik, 10. 11. 2026:
 * potrditev NA KONCU klica, ne sredi pogovora). Povzetek najvec dvakrat (po popravku); potem zakljuci.
 * Klic brez povprasevanja nima kaj potrjevati in se zakljuci brez povzetka.
 */
function koncajZbiranje(call: CallSession, pravila: Pravila): { reply: string; konec: boolean } {
  if (!imaPovprasevanje(call) || (call.potrditevVprasanj ?? 0) >= NAJVEC_VPRASANJ_POTRDITVE) {
    return { reply: zakljucekZbiranja(call, pravila), konec: true };
  }
  call.caka = undefined;
  call.stik = zapriStik(call.stik ?? prazenStik());
  call.order = uveljaviStik(call.order, call.stik);
  call.order.confirmed = false;
  call.korak = "potrditev";
  call.cakaPotrditev = true;
  call.potrditevVprasanj = (call.potrditevVprasanj ?? 0) + 1;
  return { reply: povzetekZaPotrditev(call), konec: false };
}

/** Besede kataloga, ki niso ime klicatelja (»Mizo Alba« je izdelek). */
function besedeKataloga(line: LineState): string[] {
  return [
    ...line.catalog.products.flatMap((izdelek) => [izdelek.name, izdelek.kind]),
    ...line.catalog.materials.map((material) => material.name),
  ].filter(Boolean);
}

/**
 * Rok klica modela v obratu pogovora. En klic gemini-3-flash-preview z minimalnim razmislekom je trajal
 * 2,1 s (10. 11. 2026); po 6 s velja ze preverjeni osnutek, da klic ne molci.
 */
export const ROK_MODELA_OBRATA_MS = 6_000;
/** Vprasanje za potrditev zapisnika: prvic in se enkrat po popravku. */
export const NAJVEC_VPRASANJ_POTRDITVE = 2;

export type MoznostiObrata = {
  /** Rok razumevanja izreka v osebnem nacinu (ms); privzeto ROK_OSEBNEGA_RAZUMEVANJA_MS (1500). Samo za preizkuse. */
  osebnaRokMs?: number;
  /** Vaja klica: ista koda poteka, zapis samo v pomnilniku, nic med prave klice, narocila ali vrzeli. */
  vaja?: boolean;
  /** Ura za merjenje casa obrata (ms); vbrizgana v preizkusih. */
  ura?: () => number;
  /** Razumevanje izreka z modelom (preizkus); brez njega klic ponudnika po nastavitvah Line. */
  razumevanje?: ModelRazumevanja;
  /**
   * Zamik (ms), po katerem se ob se tekocem razumevanju vzporedno zacne parafraza (hedge). null = zaporedno kot prej.
   * Brez navedbe: ZAMIK_PARAFRAZE_MS.
   */
  zamikParafrazeMs?: number | null;
  /**
   * Nujni klic se sme prevezati na osebni telefon (stikalo vklopljeno in stevilka vpisana; to ugotovi webhook, stevilke tu ni).
   * Ko klicatelj prvic pove nujnost, Lina rece samo »Poskusam vas povezati« in odgovor nosi prevezi (lastnik 10. 11. 2026).
   */
  nujniPrevezava?: boolean;
  /**
   * Prevezava na zahtevo klicatelja (stikalo »Preveži klic na zahtevo klicatelja«, privzeto vklopljeno; lastnik 23. 11. 2026). Brez vrednosti je
   * stikalo izklopljeno. "cilj" = stevilka za preusmeritev je veljavna (ve jo samo webhook), "brez" = prevezave ni, Lina zadevo oznaci kot nujno.
   */
  prevezavaZahteva?: "cilj" | "brez";
  /**
   * Prevezava bi bila mogoca (cilj obstaja), a je zunaj delovnega casa prevezave (nacin podjetje, urnik.ts; ve webhook). Ob prosnji po osebi ali
   * nujnosti Lina enkrat na klic pove, da je zunaj delovnega casa, in vprasa po sporocilu; brez Diala, brez kvote in brez dogodka.
   */
  prevezavaIzvenCasa?: boolean;
};

/** Oznaka Nujno na zapisu klica (tudi brez sporocila: prevezava na zahtevo); sporocilo in razlog ostaneta. */
function oznaciNujno(call: CallSession): void {
  const prej = call.order.tajnica;
  call.order.tajnica = { sporocilo: prej?.sporocilo ?? "", ...(prej?.izrek ? { izrek: prej.izrek } : {}), razlog: prej?.razlog ?? "", nujno: true, nujnostZnana: true };
}

/**
 * Nadaljevanje po neuspeli prevezavi (klic ostane pri Lini): uvod (stalni stavek), nato vprasanje po sporocilu, ce ga se ni; sicer naslednje
 * manjkajoce vprasanje ali zakljucek (podjetje) oziroma poslusanje (osebna). deli so stavki za govor (vsak svoj stalni posnetek).
 */
function poNeuspeliPrevezavi(call: CallSession, pravila: Pravila, uvod: string, oznaci = true): { deli: string[]; konec: boolean } {
  // Klicatelj nujnosti ni povedal (oznaka je samo posledica neuspele prevezave): oznaka ostane, SMS in kvota nujnih ne (vodja, pregled 029).
  // Zunaj delovnega casa (oznaci = false) poskusa ni bilo: oznako NUJNO ima samo nujnost, ki jo je povedal klicatelj (zajemiTajnico).
  if (oznaci) {
    if (call.order.tajnica?.nujno !== true) call.nujnoBrezIzjave = true;
    oznaciNujno(call);
  }
  call.caka = undefined;
  const deli = [uvod];
  if (!call.order.tajnica?.sporocilo) {
    if (call.nacin !== "osebna") call.cakaSporocilo = true;
    deli.push(t("osebnaSporocilo"));
    return { deli, konec: false };
  }
  if (call.nacin === "osebna") return { deli, konec: false };
  const naslednje = naslednjeVprasanje(call);
  if (naslednje) return { deli: [...deli, naslednje], konec: false };
  const k = koncajZbiranje(call, pravila);
  return { deli: [...deli, ...k.reply.split(/(?<=[.!?])\s+/).filter(Boolean)], konec: k.konec };
}

/**
 * Razumevanje (rok 4,5 s za vprasanja) in parafraza (rok 6 s) sta bila zaporedna. Parafraza potrebuje samo jedro odgovora, ki
 * je znano ze pred razumevanjem; od izida razumevanja je odvisno le, ALI se klice. Zato se zacne vzporedno, a samo ce
 * razumevanje po zamiku se tece (takrat je verjetno brez izida in padec v parafrazo): brez odvecnih klicev ob hitrem
 * razumevanju (izmerjeno 12. 11. 2026: model za vprasanje ~1,0-1,5 s) in z enakim vhodom, torej enakim izidom.
 */
export const ZAMIK_PARAFRAZE_MS = 2_000;

async function obratKlica(
  input: { callSid: string; from?: string; text?: string; izrek?: string; zahteva?: number; hangup?: boolean; now?: string; zaupanje?: number; predPozdravom?: boolean; brezNadaljevanj?: boolean },
  root: string,
  model?: ModelOsnutka,
  moznosti: MoznostiObrata = {},
): Promise<TurnResult> {
  const ura = moznosti.ura ?? (() => performance.now());
  const zacetek = ura();
  const knjiga = moznosti.vaja ? knjigaVaj : knjigaKlicev;
  const callSid = input.callSid.trim();
  if (!callSid || callSid.length > 80) throw new Error("Manjka CallSid.");
  if (callSid === "preizkus") throw new Error("Preizkus se ne zapise.");
  const line = await loadLine(root);
  const pravila = await loadPravila(root);
  const now = casObrata(input.now);
  const obstojec = await knjiga.beri(root, callSid);
  // Ze zakljucen klic: Hangup brez modela in brez novega zapisa.
  if (obstojec?.status === "zakljucen") {
    return { reply: "", call: obstojec, nespremenjen: true };
  }
  const from = (input.from ?? obstojec?.from ?? "").slice(0, 40);
  const call = obstojec ?? freshCall(callSid, from, now);
  if (moznosti.vaja) call.vaja = true;
  // Zapis klica nosi razlicico skila (samo stevilka), s katero je bil razumljen.
  call.skilRazlicica = SKIL_RAZLICICA;
  call.from = from || call.from;
  call.stik = call.stik ?? prazenStik(call.from);
  // Vidna stevilka je v zapisniku od prvega obrata (G4d), ne sele po prvem podatku klicatelja.
  if (!call.order.phone && call.stik.telefon && call.stik.telefon === call.from) call.order = uveljaviStik(call.order, call.stik);
  const text = (input.text ?? "").trim().slice(0, 2000);
  // Po neuspeli prevezavi je Lina vprasala po sporocilu: velja SAMO za naslednji izrek, zato se zastavica pocisti na ZACETKU obrata
  // (pregled 029, najdba 8: prej sele globoko v obratu, zgodnji return jo je pustil za poljuben kasnejsi izrek). Tisina je ne porabi.
  const cakaSporocilo = call.cakaSporocilo === true && text !== "";
  if (text) call.cakaSporocilo = false;
  // Klicatelj je nujnost povedal po neuspeli prevezavi: obvestilo o nujnem klicu velja kot pri vsaki povedani nujnosti.
  if (call.nujnoBrezIzjave && text && jeNujno(text)) delete call.nujnoBrezIzjave;
  // Prepis (skil, ZAPIS POGOVORA): vsak SpeechResult je svoja vrstica, nespremenjen. Pri nadaljevanju odrezanega izreka je text zdruzen (za
  // odlocitev), izrek pa samo nov del te zahteve; prejsnji deli so ze v prepisu (zapisiDelIzreka, zapis ob cakanju na nadaljevanje).
  const zaPrepis = input.izrek !== undefined ? input.izrek.trim().slice(0, 2000) : text;
  const fresh = call.transcript.length === 0;
  const prvaLina = !call.transcript.some((vrstica) => vrstica.role === "lina");

  // Vzporedno zacet klic parafraze (hedge), ce obstaja; izid ni vec potreben ob vsakem odgovoru (prekinitev: pregled B1).
  let spekulativna: { facts: string; h: Hedge<KlicParafraze> } | null = null;
  // Ali je prvi Linin govor v tem klicu (razkritje UI mora biti v PRVEM stavku vsakega klica, na vseh zgodnjih poteh).
  let znanjeOdgovor = false;
  // Kosi odgovora, ki so vsak svoj posnetek (ponovitev po kosih); voice jih da v zvokPoKosih kot posebne.
  let posebniOdgovora: string[] = [];
  // Kdo je odlocil (zapisnik po obratu): nastavi osebni nacin.
  let odlocil: "pravila" | "model" | "rezerva" | undefined;
  // Cakanje na nadaljevanje (model: »nedokoncano«): v zapis gre SAMO izrek te zahteve (svoja vrstica), nic drugega iz tega obrata.
  const zapisiSamoIzrek = async (): Promise<CallSession> => {
    const prej = await knjiga.beri(root, callSid);
    const shranjen = prej ?? call;
    // Zastavica, pociscena v tem obratu (povedana nujnost, nevarnost), velja tudi za shranjeni zapis: sicer bi SMS ostal zadrzan (pregled 029b, najdba 7).
    // cakaSporocilo ostane: nedokoncan izrek je ne porabi (sporocilo je sele nadaljevanje).
    if (prej && !call.nujnoBrezIzjave) delete prej.nujnoBrezIzjave;
    // Brez shranjenega zapisa (prvi obrat klica je ze z besedilom) ima `call` vrstico tega izreka ze v prepisu: samo oznaka `del`, vrstica se ne
    // doda se enkrat (neodvisni pregled 14. 11. 2026: dvojna vrstica klicatelja).
    const zadnja = shranjen.transcript.at(-1);
    if (!prej && zaPrepis && zadnja?.role === "stranka") {
      zadnja.del = true;
      if (lahkoDelStika(zadnja.text)) zadnja.text = BREZ_VSEBINE;
    } else zapisiVrsticoKlicatelja(shranjen, zaPrepis, text, (besedilo) => redigirajDnevnik(besedilo, false), { at: now, ...merjenjeGovora(input.zaupanje, zaPrepis) }, true, true);
    shranjen.updatedAt = now;
    await knjiga.zapisi(root, callSid, shranjen);
    return shranjen;
  };
  const odgovori = async (reply: string, konec: boolean): Promise<TurnResult> => {
    spekulativna?.h.preklici();
    if (prvaLina && !input.hangup && reply.trim() && !/umetno inteligenco|artificial intelligence/i.test(reply.trim().split(/(?<=[.!?])\s/)[0] ?? "")) {
      reply = `${jeOsebna(pravila) ? t("osebnaPredstavitev") : t("predstavitevBrez")} ${reply}`;
    }
    // SLOVO PO ZAPISU (pravilo C, lastnik 15. 11. 2026, osebna-slovo.ts): vsak Linin odgovor po zapisanem sporocilu, ki ni vabilo ali vprasanje, dobi zakljucni stavek;
    // Lina vseeno poslusa naprej, ob tisini pa klic TIHO konca (brez drugega slovesa).
    if (jeOsebna(pravila) && !konec && call.order.tajnica?.sporocilo && reply.trim() && !jeVabiloAliVprasanje(reply) && !imaSlovo(reply)) {
      reply = `${reply} ${izberiVarianto(call, "osebnaKonec")}`;
    }
    if (jeOsebna(pravila)) call.osebnoSlovoPovedano = imaSlovo(reply);
    // Osebni nacin: slovo brez »lep dan« (lastnik 14. 11. 2026: »Hvala nasvidenje je bolje kot lep dan«); vsako slovo ze ima zahvalo ali nasvidenje.
    const besedilo = konec && !jeOsebna(pravila) ? zLepimDnem(reply) : reply;
    // Cas obrata brez vsebine: od prejema izreka do besedila odgovora (z modelom, brez glasu).
    const ms = Math.max(0, Math.round(ura() - zacetek));
    // Povzetek za potrditev ima telefon in ime klicatelja: v dnevnik gre samo okvir (kot pri stranki: »Podatek je v zapisniku.«).
    const merjenje = trenutniZbiralnik()?.posnetek();
    if (besedilo.trim()) call.transcript.push({
      role: "lina",
      text: povzetekBrezPodatkov(besedilo),
      at: now,
      ms,
      ...(merjenje && (Object.keys(merjenje.ms).length > 0 || merjenje.povezava) ? { merjenje } : {}),
      ...(odlocil ? { odlocil } : {}),
    });
    // Zadnji izgovorjeni stavek za »nisem razumel«: samo kar ni povzetek s podatki in ni ze ponovitev.
    if (besedilo.trim() && povzetekBrezPodatkov(besedilo) === besedilo && !besedilo.startsWith("Ponovim. ")) {
      call.zadnjaLina = besedilo.slice(0, 500);
      call.zadnjaZnanje = znanjeOdgovor;
    }
    if (konec) zakljuci(call, now, pravila.povprasevanje);
    call.updatedAt = now;
    call.obrat = (call.obrat ?? 0) + 1;
    await knjiga.zapisi(root, callSid, call);
    if (konec && !moznosti.vaja) await zapisekOdKlica(root, callSid, call);
    return { reply: besedilo, call, ms, ...(posebniOdgovora.length > 0 ? { posebni: posebniOdgovora } : {}) };
  };

  if (input.hangup) {
    return odgovori("Hvala za klic.", true);
  }

  /**
   * Prevezava na zahtevo klicatelja (lastnik 23. 11. 2026): klicatelj zeli pravo osebo ali (z veljavnim ciljem) pove nujnost. Najvec enkrat na
   * klic (nujnoPrevezano, skupaj z nujnim klicem), nikoli v vaji. S ciljem: »Poskušam vas povezati.«, dogodek »poskus«, odgovor nosi prevezi
   * (webhook doda Dial s potrditvijo 1, izid pride v prevezavaIzid). Brez cilja ali ob kvoti: klic ostane pri Lini, zadeva je NUJNA. Nujnost brez
   * cilja ostane po obstojecem poteku (»Zapisala sem, da je zadeva nujna.«). Vrne null, ce prevezave ni.
   */
  const sproziPrevezavoNaZahtevo = async (izrek: string, nujnoNovo: boolean, obSprozitvi?: (zeli: boolean) => void): Promise<TurnResult | null> => {
    const zahteva = moznosti.prevezavaZahteva;
    if (!(zahteva || moznosti.prevezavaIzvenCasa) || moznosti.vaja || call.nujnoPrevezano || !izrek.trim()) return null;
    const zeli = zeliPravoOsebo(izrek);
    // Zunaj delovnega casa prevezave (lastnik 23. 11. 2026): enkrat na klic stavek »zunaj delovnega casa« in vprasanje po sporocilu; nujnost, ki jo je
    // klicatelj povedal, ostane oznacena. Brez Diala, kvote in dogodka prevezave.
    if (moznosti.prevezavaIzvenCasa) {
      if (!(zeli || nujnoNovo)) return null;
      call.nujnoPrevezano = true;
      obSprozitvi?.(zeli);
      // Povedana nujnost dobi potrditev zapisa (obstojeci stalni stavek), tudi ce se klic takoj zakljuci.
      const uvod = nujnoNovo ? `${t("prevezavaIzvenCasa")} ${t("nujnoZapisano")}` : t("prevezavaIzvenCasa");
      const { deli, konec } = poNeuspeliPrevezavi(call, pravila, uvod, false);
      return odgovori(deli.join(" "), konec);
    }
    if (!zahteva) return null;
    const imaCilj = zahteva === "cilj" || Boolean(moznosti.nujniPrevezava);
    // Brez cilja in brez povedane nujnosti (pregled 029, najdba 4): ni stavka o povezavi, ni oznake NUJNO, obrat tece naprej kot prej.
    if (imaCilj ? !(zeli || nujnoNovo) : !(zeli && nujnoNovo)) return null;
    // Kvota (na uro za isto stevilko, na dan skupaj): kvoto nujnih porabi samo nujnost ob lastnikovem stikalu »Prevezi nujni klic name«;
    // vse drugo (prosnja po osebi, nujnost prek tega stikala) ima LOCENO kvoto, da zloraba ne porabi kvote pravih nujnih prevezav.
    // Rezervacija PRED vsako spremembo klica: zavrnjena kvota nicesar ne zapise.
    const kvota = imaCilj && (await rezervirajKvoto(root, call.callSid, call.from, now, nujnoNovo && moznosti.nujniPrevezava ? "nujni" : "zahteva"));
    // Porabljena kvota brez povedane nujnosti (vodja, pregled 029) = kot cilj »brez«: brez stavka o povezavi, brez NUJNO, brez dogodka.
    if (imaCilj && !kvota && !nujnoNovo) return null;
    call.nujnoPrevezano = true;
    obSprozitvi?.(zeli);
    if (kvota) {
      call.nujniDogodki = [...(call.nujniDogodki ?? []), { cas: now, vrsta: "prevezava", izid: "poskus" }];
      const r = await odgovori(t("nujniPovezujem"), false);
      return { ...r, prevezi: true };
    }
    if (imaCilj) call.nujniDogodki = [...(call.nujniDogodki ?? []), { cas: now, vrsta: "prevezava", izid: "omejeno" }];
    // Isti stalni stavek kot po neodgovoru (»Povezava ni uspela. Zadevo sem zapisala kot nujno.«): pripravljen vnaprej, brez nove sinteze.
    const { deli, konec } = poNeuspeliPrevezavi(call, pravila, t("nujniNeOglasi"));
    return odgovori(deli.join(" "), konec);
  };

  // Osebna tajnica (lastnik, 14. 11. 2026): razkritje UI, »Poklicali ste ...«, edino vprasanje je sporocilo, zahvala in slovo.
  // Nic o podjetju, katalogu, znanju, e-posti ali roku. Na vprasanje klicatelja odgovor SAMO iz dejstev (lastnik 14. 11. 2026), sicer »Tega ne vem«.
  if (jeOsebna(pravila)) {
    call.nacin = "osebna";
    odlocil = "pravila";
    const casZdaj = new Date(now);
    const imeLastnika = (pravila.imeLastnika ?? "").replace(/\s+/g, " ").trim();
    const odsDejstvo = odsotnostOdgovor(pravila, "oboje", casZdaj);
    const zabeleziOdsotnost = (stavek: string) => {
      const cist = stavek.replace(/\s+/g, " ").trim();
      if (!cist) return;
      const obstojeci = call.odsotnostPovedana ?? [];
      if (!obstojeci.includes(cist)) call.odsotnostPovedana = [...obstojeci, cist];
    };
    const zabeleziCeModelOdsotnost = (odgovor: string | null | undefined) => {
      if (odgovor && odsDejstvo && fold(odgovor).includes(fold(odsDejstvo))) zabeleziOdsotnost(odsDejstvo);
    };
    // Predzadnja dovoljena zahteva Twilia (preizkusni racun: 10 zahtev na klic, nato klic prekine): Lina odgovori in se poslovi v ISTEM odgovoru.
    // Brez stevca (klic mimo webhooka, vaja) meje ni.
    const predzadnja = (input.zahteva ?? 0) >= MEJA_ZAHTEV_KLICA - 1;
    // Ponovitev zapisanega (klic K7: lastnik je hotel, da mu Lina PONOVI, kaj je razumela): ocisceno sporocilo (model ga je moral vzeti iz
    // izreka, razberiOsebno), nic dodanega. Sinteza se zacne v ozadju takoj ob zapisu, da je zvok pripravljen, ko klicatelj prosi za ponovitev.
    // Po kosih (kosiPonovitve): stalni uvod »Zapisala sem:« + kosi vsebine, ki se sintetizirajo HKRATI ob zapisu (izmerjeno p95 2952 ms).
    // »Zapisala sem:« je DEL prvega kosa (lastnik 14. 11. 2026 po posluhu: glas se je od »zapisala sem« naprej spremenil). Izmerjeno: sam uvod ima
    // f0 177,8 Hz (padajoca intonacija kratkega stavka), kosi vsebine 222-242 Hz; po izenacenju 200 proti 210,5 Hz. Skupaj s prvimi besedami ima
    // uvod isti tok govora kot ostali kosi.
    // Branje znane napake prepoznave ob zadnji vrstici klicatelja (skil, ZAPIS POGOVORA): izvirnik ostane, ob njem »razumljeno«.
    const oznaciRazumljeno = (razumljeno: string | undefined) => {
      const zadnja = call.transcript.at(-1);
      if (razumljeno && zadnja?.role === "stranka") zadnja.razumljeno = redigirajDnevnik(razumljeno, false).slice(0, 300);
    };
    // Zadnji izreki klicatelja PRED tem (kontekst modela: kratek ali odrezan izrek se presodi s prejsnjimi; lastnik 14. 11. 2026).
    const prejsnjiIzreki = () => call.transcript.filter((v) => v.role === "stranka").map((v) => v.text).slice(0, -1).slice(-3);
    const kosiZa = (tajnica: { sporocilo: string; izrek?: string }) => {
      const kosi = kosiPonovitve((tajnica.sporocilo || tajnica.izrek || "").slice(0, 300));
      return kosi.length > 0 ? [`${t("osebnaZapisalaSemUvod")} ${kosi[0]}`, ...kosi.slice(1)] : [];
    };
    // Variante fraz (lastnik 14. 11. 2026): v istem klicu brez ponovitve; prva raba je osnovna fraza.
    const varianta = (kljuc: (typeof VARIANTE_OSEBNE)[number][0]): string => {
      const sez = VARIANTE_OSEBNE.find((x) => x[0] === kljuc) ?? [kljuc];
      const st = call.osebnoVariante?.[kljuc] ?? 0;
      call.osebnoVariante = { ...(call.osebnoVariante ?? {}), [kljuc]: st + 1 };
      return t(sez[st % sez.length]);
    };
    // Odgovor modela, ki je tocno ena od osnovnih predposnetih fraz, dobi varianto (isti pomen, drug posnetek).
    const fraza = (odgovor: string): string => {
      for (const sez of VARIANTE_OSEBNE) if (odgovor === t(sez[0])) return varianta(sez[0]);
      return odgovor;
    };
    const stavekPonovitve = (tajnica: { sporocilo: string; izrek?: string }) => kosiZa(tajnica).join(" ") || t("osebnaZapisalaSemUvod");
    // Ponovitev (lastnik 14. 11. 2026): ce kosi ob prosnji se niso pripravljeni, najprej posteno »Sporočilo sem zapisala, preberem ga v trenutku.«
    // in ponovitev v naslednjem obratu (kratko cakanje; najvec enkrat; ne cez mejo zahtev: od 7. obrata dalje se caka kar v istem obratu).
    // Cela ponovitev (posluh lastnika 14. 11. 2026 16:14: »že pri Ji je razlika«): vsak kos je nova sinteza z zacetnim tonom novega stavka (izmerjeno na
    // meji »lepo in | ji«: F0 247 -> 195 Hz, centroid 637 -> 976 Hz, brez tisine in klika). Ob zapisu se zato vzporedno s kosi sintetizira tudi CELA
    // ponovitev (en tok govora); ce je ob prosnji pripravljena, gre ona, sicer kosi (hitrost ostane kot pri kosih).
    const ponovi = async (tajnica: { sporocilo: string; izrek?: string }): Promise<TurnResult> => {
      const besedilo = stavekPonovitve(tajnica);
      const cela = await pripravljeniKljuci(besedilo, root, [besedilo], callSid).catch(() => null);
      posebniOdgovora = cela ? [besedilo] : kosiZa(tajnica);
      const pripravljeno = cela ?? (await pripravljeniKljuci(besedilo, root, posebniOdgovora, callSid).catch(() => null));
      // Brez glasu (rezerva <Say>) cakanje nima smisla: ponovitev takoj. Pri predzadnji dovoljeni zahtevi ni prostora za dodatno zahtevo.
      if (!pripravljeno && !call.osebnoPonovitevCaka && !predzadnja && (call.obrat ?? 0) < 7 && !moznosti.vaja && (await glasNaVoljo(root))) {
        call.osebnoPonovitevCaka = true;
        posebniOdgovora = [];
        return odgovori(t("osebnaPonovitevVTrenutku"), false);
      }
      call.osebnoPonovitevCaka = false;
      if (predzadnja) return odgovori(`${besedilo} ${varianta("osebnaKonec")}`.trim(), true);
      if (call.osebnoPotrdi !== "potrjeno") {
        call.osebnoPotrdi = "caka";
        return odgovori(`${besedilo} ${t("osebnaPravRazumela")}`, false);
      }
      return odgovori(besedilo, false);
    };
    const pripraviPonovitev = () => {
      if (call.order.tajnica?.sporocilo && !moznosti.vaja) void predpripraviOdgovor(stavekPonovitve(call.order.tajnica), root, callSid, kosiZa(call.order.tajnica), true);
    };
    // Odgovor na vprasanje iz dejstev (stevilka klicatelja iz From, ime iz nastavitve, UI); »model« = prosto vprasanje (meja 2,5 s, varovalo).
    const odgovorVgrajenega = async (vg: VrstaVgrajenega | "model", _vprasanje: string, _izrek: string, kratko = false, modelOdgovor: string | null = null): Promise<string> => {
      const nevem = kratko ? t("osebnaNevemKratko") : t("osebnaNevem");
      const b = stevilkaBesedno(call.from ?? "");
      const ime = (pravila.imeLastnika ?? "").replace(/\s+/g, " ").trim();
      if (vg === "stevilka") return b ? t("osebnaStevilka").replace("{stevilka}", () => b) : t("osebnaBrezStevilke");
      if (vg === "stevilkaNejasno") return b ? t("osebnaNejasno").replace("{stevilka}", () => b) : t("osebnaNejasnoBrez");
      if (vg === "ai") return t("osebnaAI");
      if (vg === "zapisala") return t("osebnaZapisanaDa");
      if (vg === "nevem") return nevem;
      void ime;
      return modelOdgovor ?? nevem; // prosto vprasanje: odgovor modela je ze prestal varovalo DOVOLJENEGA (razberiOsebno)
    };
    /** Dopolnilo zapisa z locilom (ne zlepek brez locila). */
    const dopolni = (prej: string, nov: string): string => (prej ? `${prej.replace(/[\s.,;:!?]+$/, "")}. ${nov}` : nov);
    const faza = fazaTrajanja(call.startedAt, now, pravila.najdaljsiPogovorMinut);
    if (faza === "potek") {
      call.order.oznaka = t("casPotekel");
      return odgovori(t("casSlovo"), true);
    }
    if (!text) {
      if (fresh) {
        call.korak = "pomoc";
        zabeleziOdsotnost(odsotnostStavek(pravila, casZdaj));
        return odgovori(uvodKlica(pravila, "", casZdaj), false);
      }
      // Ponovitev, ki je cakala na kose (prejsnji obrat »preberem ga v trenutku«), pride zdaj.
      if (call.osebnoPonovitevCaka && call.order.tajnica?.sporocilo) return ponovi(call.order.tajnica);
      // Po zapisanem sporocilu tisina pomeni »nimam vec vprasanj«: zahvala in slovo; ce je bilo slovo ze del prejsnjega odgovora, klic TIHO konca.
      if (call.order.tajnica?.sporocilo) return call.osebnoSlovoPovedano ? odgovori("", true) : odgovori(varianta("osebnaKonec"), true);
      const tisine = call.tisine ?? 0;
      call.tisine = tisine + 1;
      return tisine + 1 >= 2 ? odgovori(t("osebnaSlovoTisina"), true) : odgovori(t("osebnaSporocilo"), false);
    }
    call.tisine = 0;
    zapisiVrsticoKlicatelja(call, zaPrepis, text, (besedilo) => redigirajDnevnik(besedilo, false), { at: now, ...merjenjeGovora(input.zaupanje, zaPrepis) });
    // Ime in priimek klicatelja se ne vprasa; ce ga klicatelj pove sam, se zapise.
    const ime = razberiIme(text, false);
    if (ime && !call.stik.ime) {
      call.stik = { ...call.stik, ime };
      call.order = uveljaviStik(call.order, call.stik);
    }
    // Nevarnost (lastnik 22. 11. 2026, kot na telefonu): odloca koda pred modelom in pred vsemi drugimi pravili. Takoj napotitev na 112
    // (stalen stavek), izrek gre v sporocilo kot NUJNO; klic tece naprej (klicatelj lahko doda sporocilo). Najvec enkrat na klic.
    if (!call.osebnoNevarnost && jeNevarnost(text)) {
      call.osebnoNevarnost = true;
      // Nevarnost je nujnost, ki jo pove klicatelj: tudi po neuspeli prevezavi na zahtevo velja obvestilo (vodja, pregled 029).
      delete call.nujnoBrezIzjave;
      const prejT = call.order.tajnica;
      const vsebina = ocistiSporocilo(text).slice(0, 300) || text.slice(0, 300);
      call.order.tajnica = {
        sporocilo: dopolni(prejT?.sporocilo ?? "", vsebina).slice(0, 600),
        izrek: dopolni(prejT?.izrek ?? "", brezIzgovorjenegaStika(vsebina)).slice(0, 600),
        razlog: prejT?.razlog ?? "",
        nujno: true,
        nujnostZnana: true,
      };
      call.order.povprasevanje = call.order.tajnica.sporocilo.slice(0, 200);
      return odgovori(t("osebnaNevarnost"), false);
    }
    // Dostava paketa (lastnik 23. in 24. 11. 2026, paket.ts): klicatelj se predstavi kot dostava in lastnik je vpisal navodilo -> Lina rece
    // »Paket pričakujemo. Prosim, pustite ga <mesto>.« Koda pred modelom, najvec enkrat na klic; navodilo nikoli v drugih klicih ali dejstvih modela.
    // Izrek dostavljalca je sporocilo klica (zapis kot obicajno), brez oznake nujno.
    const navodiloPaketa = call.paketPovedan ? "" : aktivnoNavodiloPaketa(pravila, casZdaj);
    if (navodiloPaketa && jeDostava(text)) {
      call.paketPovedan = true;
      const prejT = call.order.tajnica;
      const vsebina = ocistiSporocilo(text).slice(0, 300) || text.slice(0, 300);
      call.order.tajnica = {
        sporocilo: dopolni(prejT?.sporocilo ?? "", vsebina).slice(0, 600),
        izrek: dopolni(prejT?.izrek ?? "", brezIzgovorjenegaStika(vsebina)).slice(0, 600),
        razlog: prejT?.razlog ?? "",
        nujno: prejT?.nujno === true,
        nujnostZnana: prejT?.nujnostZnana === true,
      };
      call.order.povprasevanje = call.order.tajnica.sporocilo.slice(0, 200);
      // Brez imena lastnika (pregled 0.2.10, najdba 2): »tukaj DPD« lahko rece kdorkoli.
      return odgovori(odgovorDostavljalcu(navodiloPaketa), false);
    }
    // Prevezava na zahtevo (osebna): »lahko govorim z njo«, »nujno je ...«. Nujen izrek je hkrati sporocilo (kot pri nevarnosti), da se ob
    // neuspeli prevezavi nic ne izgubi; prosnja po osebi sama ni sporocilo (Lina po neuspehu vprasa po njem), vsebina ob njej pa je (CodeRabbit 029).
    const nujnoOsebno = !call.order.tajnica?.nujno && jeNujno(text);
    const prevezavaOsebna = await sproziPrevezavoNaZahtevo(text, nujnoOsebno, (zeli) => {
      const prejOsebno = call.order.tajnica;
      const vsebina = zeli ? ocistiSporocilo(sporociloObProsnji(text)) : ocistiSporocilo(text).slice(0, 300) || text.slice(0, 300);
      if (!vsebina && !nujnoOsebno) return;
      call.order.tajnica = {
        sporocilo: vsebina ? dopolni(prejOsebno?.sporocilo ?? "", vsebina).slice(0, 600) : (prejOsebno?.sporocilo ?? ""),
        ...(vsebina || prejOsebno?.izrek ? { izrek: (vsebina ? dopolni(prejOsebno?.izrek ?? "", brezIzgovorjenegaStika(vsebina)) : prejOsebno?.izrek ?? "").slice(0, 600) } : {}),
        razlog: prejOsebno?.razlog ?? "",
        // Povedana nujnost (tudi ob prosnji po osebi) je nujnost klicatelja, ne posledica neuspele prevezave.
        nujno: nujnoOsebno || prejOsebno?.nujno === true,
        nujnostZnana: nujnoOsebno || prejOsebno?.nujnostZnana === true,
      };
      if (call.order.tajnica.sporocilo) call.order.povprasevanje = call.order.tajnica.sporocilo.slice(0, 200);
    });
    if (prevezavaOsebna) return prevezavaOsebna;
    // Po zapisanem sporocilu Lina NE zakljuci takoj (klicatelj lahko vprasa, ali ima njegovo stevilko): »Imate se kaksno vprasanje?«.
    // Odgovor »ne/hvala/to je vse« = zahvala in slovo; vprasanje = odgovor SAMO iz dejstev, ki jih Lina res ima; dodatno sporocilo dopolni
    // zapisek; po 3 dodatnih obratih zahvala in slovo (lastnik, 14. 11. 2026, klic K3).
    if (call.order.tajnica?.sporocilo) {
      const zapisano = call.order.tajnica;
      // Ponovitev, ki je cakala na kose, pride v tem obratu (ne glede na izrek).
      if (call.osebnoPonovitevCaka) return ponovi(zapisano);
      // »Želite, da ponovim sporočilo?« (model ni bil preprican): pritrditev = ponovitev; karkoli drugega gre naprej po pravilih.
      const ponudila = call.osebnoPonudilPonovitev === true;
      call.osebnoPonudilPonovitev = false;
      // Pritrditev po skilu (RAZUMEVANJE: »ja, jah, aha, seveda, itak, lahko, velja, prav, v redu, okej, dobro, tako je, drži« = da).
      const pritrditev = /^(da|ja|jah|aha|seveda|itak|lahko|velja|prav|v redu|okej|ok|dobro|tako je|drzi|tocno|res je)( (da|ja|prav|hvala|tako je|tocno|drzi))*$/;
      const cistiOdgovor = fold(text).replace(/[^\p{L}\d]+/gu, " ").trim();
      if (ponudila && /^(da|ja|jah|aha|seveda|itak|lahko|velja|prav|v redu|okej|ok|dobro|tako je|drzi|prosim|izvoli\w*|ponovi\w*)( (da|ja|prosim|lahko|ponovi\w*|hvala))*$/.test(cistiOdgovor)) return ponovi(zapisano);
      // 15. 11. 2026: potrditev zapisanega sporocila (»Ali sem prav razumela?«); brez imena enkrat vprasa za ime, sicer zakljuci.
      if (call.osebnoPotrdi === "caka" && pritrditev.test(cistiOdgovor)) {
        call.osebnoPotrdi = "potrjeno";
        if (!call.stik.ime && call.korak !== "ime") {
          call.korak = "ime";
          return predzadnja ? odgovori(varianta("osebnaKonec"), true) : odgovori(t("osebnaKakoIme"), false);
        }
        return odgovori(varianta("osebnaKonec"), true);
      }
      if (call.korak === "ime" && call.stik.ime) return odgovori(varianta("osebnaKonec"), true);
      const n = (call.osebnoDodatnih ?? 0) + 1;
      call.osebnoDodatnih = n;
      const zakljuci = n >= 3 || predzadnja;
      // »Imate se kaksno vprasanje?« samo ENKRAT na klic (ob prvem zapisu; lastnik po klicu K5): odgovor se konca brez vprasanja in Lina
      // poslusa naprej (tisina = slovo).
      // SLOVO PO ODGOVORU (dva klica lastnika 14. 11. 2026: enkrat je klic odlozil sam, ker se Lina ni poslovila; drugic je Lina na prosnjo
      // odgovorila s slovesom in odlozila): odgovor na vprasanje ali prosnjo klica NE zakljuci. Lina odgovori, poslusa (Gather 4 s) in
      // se ob tisini poslovi SAMA (slovo + Hangup), zato klicatelj nikoli ne ostane na liniji brez slovesa. Slovo v istem odgovoru samo pri
      // predzadnji dovoljeni zahtevi (meja 10 zahtev Twilia).
      const dalje = (odgovor: string) => (predzadnja ? odgovori(`${odgovor} ${varianta("osebnaKonec")}`.trim(), true) : odgovori(odgovor, false));
      // Odgovor, po katerem Lina samo poslusa (»Izvolite.«, ponudba ponovitve): pri predzadnji zahtevi namesto njega slovo.
      const poslusaj = (besedilo: string) => (predzadnja ? odgovori(varianta("osebnaKonec"), true) : odgovori(besedilo, false));
      const dopisi = (vsebina: string, dobesedno: string = vsebina) => {
        // Vprasanje Lini na koncu (»... ali si me razumela«) ne gre v sporocilo.
        const dodatek = ocistiSporocilo(lociMetaVprasanje(vsebina).vsebina).slice(0, 300);
        if (!dodatek) return;
        // `izrek` je DOBESEDNI izrek klicatelja, tudi kadar je sporocilo ocistil model (neodvisni pregled 14. 11. 2026: v izrek je slo besedilo
        // modela). Brez zapisanega in izgovorjenega stika (ocistiSporocilo, brezIzgovorjenegaStika): izrek gre v vsak naslednji vhod modela.
        const izvirnik = brezIzgovorjenegaStika(ocistiSporocilo(lociMetaVprasanje(dobesedno).vsebina)).slice(0, 300) || dodatek;
        call.order.tajnica = { ...zapisano, sporocilo: dopolni(zapisano.sporocilo, dodatek).slice(0, 600), izrek: dopolni(zapisano.izrek ?? "", izvirnik).slice(0, 600) };
        call.order.povprasevanje = call.order.tajnica.sporocilo.slice(0, 200);
        pripraviPonovitev();
      };
      // Slovo (tudi STT-zgresen »ne to slisimo kasneje«) ni sporocilo; slovo na koncu izreka z vsebino se odreze, vsebina po pravilu >= 4 besed.
      const slovo = lociSlovo(text);
      if (slovo.slovo || jeKonecOsebno(text)) {
        const v = slovo.vsebina;
        if (slovo.slovo && vsebinskeBesede(v).length >= 4 && !jeVprasanje(v) && !VPRASALNICA_OSEBNA.test(fold(v))) dopisi(v);
        return odgovori(varianta("osebnaKonec"), true);
      }
      // Pogovor (»kako si/je/ste«): »Dobro, hvala.« in poslusa naprej; ne steje med dodatne obrate.
      if (jeMalopogovor(text) && (call.osebnoMalo ?? 0) < 2) {
        call.osebnoMalo = (call.osebnoMalo ?? 0) + 1;
        call.osebnoDodatnih = n - 1;
        return dalje(varianta("osebnaDobro"));
      }
      // »Pocakaj/trenutek/preden ...«: kratko »Izvolite.« in poslusa naprej (ne dopise, ne zakljuci, ne steje med obrate).
      if (jeProsnjaZaCakanje(text) && vsebinskeBesede(text).length < 4 && (call.osebnoCakanj ?? 0) < 2) {
        call.osebnoCakanj = (call.osebnoCakanj ?? 0) + 1;
        call.osebnoDodatnih = n - 1;
        return poslusaj(varianta("osebnaIzvoliteKratko"));
      }
      const k = fold(text);
      // Prosnja za ponovitev (»ponovi«, STT »po novi«, »kaj si (me) razumela«, »aleš si razumela«, odrezan »razumela«): pravilo pred modelom;
      // zvok je predpripravljen ob zapisu. Branje znane napake prepoznave gre ob vrstico prepisa (»razumljeno«), izvirnik ostane. Vsebina v istem
      // izreku (»pridem ob osmih, prosim ponovi«) se najprej dopise, da se nic ne izgubi (skil: vsako stvar izreka razvrsti posebej).
      // Lastnik 14. 11. 2026: tudi »povej mi, kakšno je moje sporočilo«, »kaj boš sporočila«, »še enkrat« (pravila, brez modela).
      const prosnja = prosnjaZaPonovitev(text);
      if (prosnja) {
        oznaciRazumljeno(prosnja.razumljeno);
        // Vsebina pred prosnjo: samo cel stavek (vsaj 4 besede, ne odrezan uvod kot »vprašal sem te če«).
        if (prosnja.vsebina && vsebinskeBesede(prosnja.vsebina).length >= 4 && !jeNedokoncan(prosnja.vsebina) && !jeVprasanje(prosnja.vsebina)) dopisi(prosnja.vsebina);
        return ponovi(call.order.tajnica ?? zapisano);
      }
      // »da si zapisal ...«, »ki ste razumeli ...« v izreku je vsebina za osebo, ne vprasanje Lini (neodvisni pregled 14. 11. 2026): odloci model oziroma dopis.
      const vgSurovo = vrstaVgrajenega(text);
      const vg = vgSurovo === "zapisala" && !VPRASANJE_O_ZAPISU.test(k.replace(/[^\p{L}\d]+/gu, " ").trim()) ? null : vgSurovo;
      // Daljse vprasanje o razumevanju ali zapisu (»a ste vi to sploh razumeli kar sem rekel«): tudi ponovitev (lastnik 14. 11. 2026, klic K8);
      // »si slisala / si sprejela« ostane potrditev.
      if (vg === "zapisala" && /\b(razumel\w*|zapisal\w*)\b/.test(fold(text))) return ponovi(zapisano);
      // Pravila prepoznajo vprasanje o stevilki/UI tudi popacen (»a imas moj stevilk«): odgovor iz dejstev brez modela.
      if (vg && vg !== "nevem") return dalje(await odgovorVgrajenega(vg, text, zapisano.izrek ?? zapisano.sporocilo, true));
      const odsVprPo = lociVprasanjeOdsotnosti(text, imeLastnika);
      if (odsVprPo) {
        if (odsVprPo.vsebina && vsebinskeBesede(odsVprPo.vsebina).length >= 4 && !jeVprasanje(odsVprPo.vsebina)) dopisi(odsVprPo.vsebina);
        const odgOdsPo = odsotnostOdgovor(pravila, odsVprPo.vrsta, casZdaj);
        if (odgOdsPo) {
          zabeleziOdsotnost(odgOdsPo);
          return dalje(odgOdsPo);
        }
      }
      const jeVpr = jeVprasanje(text) || VPRASALNICA_OSEBNA.test(k) || (/^(vidite|veste|ste|imate)\b/.test(k) && text.trim().split(/\s+/).length <= 12);
      // CodeRabbit 14. 11. 2026: splosne besede (»lahko«, »ste«, »imate« kjer koli) so razvrstile dopolnilo (»Lahko me pokličete jutri zvečer«) kot vprasanje;
      // zato samo vprasalnica ali obrnjen vrstni red NA ZACETKU izreka; vse drugo odloci model, brez njega >= 4 vsebinske besede = dopis.
      const ime = (pravila.imeLastnika ?? "").replace(/\s+/g, " ").trim();
      // HITRE POTI pravil pred modelom (brez cakanja): izven dejstev, stevilka, UI, koga, branje nazaj.
      // Pravi klic (15. 11. 2026): daljsi izrek o televiziji, racunalniku in »telefonu« je zacel z »da zakaj si me prekinjas« in ga je pravilo
      // /telefon/ razvrstilo kot vprasanje o stevilki (Lina je odgovorila »vidim, da ste poklicali s stevilke ...«). Podniz v dolgem izreku ni dokaz:
      // hitra pot samo za KRATEK izrek (do 8 besed); dolg izrek razume model, brez modela velja dopis.
      if (jeVpr && k.split(" ").filter(Boolean).length <= 8) {
        if (/\b(kdaj|kje|cen\w*|stane|izdel\w*|naroc\w*|rok|dostav\w*)\b/.test(k)) return dalje(t("osebnaNevemKratko"));
        if (/\b(stevilk\w*|telefonsk\w*|telefon)\b/.test(k)) {
          const b = stevilkaBesedno(call.from ?? "");
          return dalje(b ? t("osebnaStevilka").replace("{stevilka}", () => b) : t("osebnaBrezStevilke"));
        }
        if (/(robot|umetn|clovek|stroj|resnic)/.test(k)) return dalje(t("osebnaAI"));
        if (/\b(koga|komu|kam sem)\b/.test(k) || /kdo je (to|ta)/.test(k)) return dalje(ime ? t("osebnaPoklicali").replace("{ime}", () => imeVTozilniku(ime, pravila.imeLastnikaTozilnik ?? "")) : t("osebnaPoklicaliBrez"));
        if (/(zapisal|preberi|ponovi\w* sporocilo)/.test(k)) return ponovi(zapisano);
      }
      // MODEL razume VSAK preostali izrek (meja 2,5 s; ob napaki/preseganju pravila kode). Odgovor modela samo iz dejstev (varovalo DOVOLJENEGA).
      const razum = await razumiOsebniIzrek(text, call.zadnjaLina ?? "", {
        dir: root,
        model: moznosti.razumevanje,
        rokMs: moznosti.osebnaRokMs,
        dejstva: { imeLastnika: ime, imeTozilnik: ime ? imeVTozilniku(ime, pravila.imeLastnikaTozilnik ?? "") : "", stevilkaBesedno: stevilkaBesedno(call.from ?? ""), izrek: zapisano.izrek ?? zapisano.sporocilo, zapisano: true, ...(odsDejstvo ? { odsotnost: odsDejstvo } : {}) },
        prejsnji: prejsnjiIzreki(),
      });
      if (!jeSamoPozdravnoPolnilo(text)) odlocil = razum ? "model" : "rezerva";
      // Model je izrek oznacil kot nedokoncan (lastnik 14. 11. 2026: Lina mora biti prepricana, da je klicatelj nehal): brez odgovora in brez zapisa
      // obrata; voice tiho poslusa nadaljevanje (najvec 2 na obrat, 3 na klic). Brez dovoljenja (brezNadaljevanj) velja izrek kot je.
      if (razum?.vrsta === "nedokoncano" && !input.brezNadaljevanj) return { reply: "", call: await zapisiSamoIzrek(), cakaNadaljevanje: true };
      const besed = vsebinskeBesede(text).length;
      if (razum) {
        if (razum.ime && !call.stik.ime) {
          call.stik = { ...call.stik, ime: razum.ime };
          call.order = uveljaviStik(call.order, call.stik);
        }
        // Slovo, ki ga pravila ne poznajo, model pa ga je zaznal (izmerjeno: »javljat« je flash vcasih razvrstil kot slovo): enkrat samo
        // »Izvolite.« in poslusa; ce klicatelj res konca, sledi tisina (Gather 4 s) in slovo, sicer klica ne prekinemo po napaki.
        if (razum.vrsta === "slovo") {
          if ((call.osebnoSlovoModel ?? 0) < 1) {
            call.osebnoSlovoModel = (call.osebnoSlovoModel ?? 0) + 1;
            call.osebnoDodatnih = n - 1;
            return poslusaj(varianta("osebnaIzvoliteKratko"));
          }
          return odgovori(varianta("osebnaKonec"), true);
        }
        if (razum.vrsta === "cakaj" && (call.osebnoCakanj ?? 0) < 2) {
          call.osebnoCakanj = (call.osebnoCakanj ?? 0) + 1;
          call.osebnoDodatnih = n - 1;
          return poslusaj(varianta("osebnaIzvoliteKratko"));
        }
        // Vprasanje o razumevanju (»ali si razumela«, tudi popacen prepis) = ponovitev sporocila, ne potrditev in slovo (klic K8).
        if (razum.vrsta === "vprasanje" && (razum.ponovitev || (razum.vprasanje && jePonovitev(razum.vprasanje)))) {
          // Branje, ki ne izhaja iz izreka (»branje«), velja samo, kadar pravila izreka ne bi dopisala (vprasanje ali manj kot 4 vsebinske
          // besede): daljse dopolnilo se ne izgubi zaradi zmote modela ali navodila v izreku (neodvisni pregled 14. 11. 2026).
          if (razum.ponovitev === "branje" && !jeVpr && besed >= 4) {
            dopisi(text);
            return zakljuci ? odgovori(osebniZakljucek(), true) : odgovori(varianta("osebnaZapisanaKratko"), false);
          }
          // Ob vrstico prepisa gre samo PREVERJENO branje: vprasanje, ki je prestalo dobesedno preverbo (iz izreka ali iz izreka s popravljeno
          // znano napako prepoznave), z zamenjano znano napako. Besedilo modela, ki ga klicatelj ni izrekel, v prepis ne gre.
          const branje = razum.vprasanje ? beriZnaneNapake(razum.vprasanje) : "";
          if (branje && !fold(text).includes(fold(branje))) oznaciRazumljeno(branje);
          return ponovi(zapisano);
        }
        if (razum.vrsta === "vprasanje") {
          zabeleziCeModelOdsotnost(razum.odgovor);
          return dalje(razum.odgovor ? fraza(razum.odgovor) : t("osebnaNevemKratko"));
        }
        // Model ni preprican (confident=false) po zapisu: enkrat vprasa, ali naj ponovi (z uporabnikove strani: odgovor da/ne, nic se ne dopise).
        if (razum.negotovo && !call.osebnoPonudilaZe && !predzadnja) {
          call.osebnoPonudilaZe = true;
          call.osebnoPonudilPonovitev = true;
          call.osebnoDodatnih = n - 1;
          return odgovori(t("osebnaPonovimVprasanje"), false);
        }
        // Negotovo (confident=false): nic se ne dopise; sledi »Izvolite.« (smeti spodaj), drugic slovo.
        if ((razum.vrsta === "sporocilo" || razum.vrsta === "dopolnilo") && besed >= 3 && !razum.negotovo) {
          dopisi(razum.sporocilo || text, text);
          const kratko = varianta("osebnaZapisanaKratko");
          zabeleziCeModelOdsotnost(razum.odgovor);
          return zakljuci ? odgovori(osebniZakljucek(), true) : odgovori(razum.odgovor ? `${kratko} ${fraza(razum.odgovor)}` : kratko, false);
        }
        // pozdrav, pogovor, nedokoncano, nerazumljivo, nejasno in prekratko dopolnilo: smeti (spodaj)
      } else {
        // Model ni odgovoril (napaka, 2,5 s, neveljavno): pravila kode kot prej. Zelo dolg izrek (12+ vsebinskih besed) z vprasalnico (klic lastnika 15. 11. 2026:
        // »da zakaj si me prekinjas ... zelim da ...«) je vsebina za osebo, ne kratko vprasanje: dopis, da se nic ne izgubi.
        if (jeVpr && besed < 12) return dalje(t("osebnaNevemKratko"));
        if (besed >= 4) {
          dopisi(text);
          return zakljuci ? odgovori(osebniZakljucek(), true) : odgovori(varianta("osebnaZapisanaKratko"), false);
        }
      }
      const smeti = (call.osebnoSmeti ?? 0) + 1;
      call.osebnoSmeti = smeti;
      return smeti >= 2 || zakljuci ? odgovori(varianta("osebnaKonec"), true) : odgovori(varianta("osebnaIzvoliteKratko"), false);
    }
    // Govor, zbran MED Lininim pozdravom (voice.server: izrek je prisel pred koncem posnetka + rezerva), ni odgovor na vprasanje
    // (<Play> v <Gather> govora ne prekine; klic K1): sporocilo samo z vsaj 3 vsebinskimi besedami, sicer »Izvolite,
    // poslusam.« in znova poslusanje (najvec 2x, nato velja, kar je).
    if (input.predPozdravom && !call.order.tajnica?.sporocilo && (call.osebnoPredhodnih ?? 0) < 2 && vsebinskeBesede(text).length < NAJMANJ_VSEBINSKIH_BESED) {
      call.osebnoPredhodnih = (call.osebnoPredhodnih ?? 0) + 1;
      return odgovori(t("osebnaIzvolite"), false);
    }
    // Razumevanje izreka (model, trda meja 2,5 s): samo izrek in prejsnji Linin stavek. Ob napaki ali preseganju roka (null) velja
    // pravilo kode. Model ne pise odgovorov Line in ne dodaja podatkov (razberiOsebno preveri).
    // Model SAMO kadar so pravila neodlocilna (klic K3: model je po nepotrebnem pojedel 2,5 s pred vsakim odgovorom). Odlocno:
    // pozdrav/polnila, slovo, ali jasno sporocilo (>= 4 vsebinske besede, brez vprasalnice, dobro prepoznano).
    // Hitre poti pravil (pozdrav/polnila, slovo, stevilka/UI, pogovor) so pred modelom in ostanejo pod 500 ms; vsak drug izrek razume model.
    // Cista prosnja Lini brez vsebine (»povej mi, kakšno je moje sporočilo«, se pred sporocilom) je odlocena po pravilih: model ne zadrzi odgovora.
    const prosnjaVIzreku = prosnjaZaPonovitev(text);
    const odsVprPred = lociVprasanjeOdsotnosti(text, imeLastnika);
    const odgOdsPred = odsVprPred ? odsotnostOdgovor(pravila, odsVprPred.vrsta, casZdaj) : "";
    const odlocno =
      jeGoloPozdravljanje(text) ||
      wantsHangup(text) ||
      vrstaVgrajenega(text) !== null ||
      jeMalopogovor(text) ||
      (odsVprPred !== null && odgOdsPred !== "") ||
      (prosnjaVIzreku !== null && !prosnjaVIzreku.vsebina);
    const razum = odlocno
      ? null
      : await razumiOsebniIzrek(text, call.zadnjaLina ?? "", {
          dir: root,
          model: moznosti.razumevanje,
          rokMs: moznosti.osebnaRokMs,
          dejstva: { imeLastnika, imeTozilnik: imeLastnika ? imeVTozilniku(imeLastnika, pravila.imeLastnikaTozilnik ?? "") : "", stevilkaBesedno: stevilkaBesedno(call.from ?? ""), izrek: "", zapisano: false, ...(odsDejstvo ? { odsotnost: odsDejstvo } : {}) },
          prejsnji: prejsnjiIzreki(),
        });
    if (!odlocno && !jeSamoPozdravnoPolnilo(text)) odlocil = razum ? "model" : "rezerva";
    if (razum?.vrsta === "nedokoncano" && !input.brezNadaljevanj) return { reply: "", call: await zapisiSamoIzrek(), cakaNadaljevanje: true };
    if (razum?.ime && !call.stik.ime) {
      call.stik = { ...call.stik, ime: razum.ime };
      call.order = uveljaviStik(call.order, call.stik);
    }
    const besedStevilo = text.trim().split(/\s+/).length;
    const jeSporocilo = razum?.vrsta === "sporocilo" || razum?.vrsta === "dopolnilo";
    // Zacetna pravila so varovalo: golo pozdravljanje po seznamu je pozdrav, tudi ce model misli drugace.
    const pozdrav = jeGoloPozdravljanje(text) || ((razum?.vrsta === "pozdrav" || razum?.vrsta === "pogovor") && besedStevilo <= 5);
    // Vprasanje Lini na koncu izreka (»... ali si me razumela«, »ponovi«, »kdo si«) ne gre v sporocilo (klic K7); vprasanja za lastnika ostanejo.
    const meta = lociMetaVprasanje(text);
    // Prosnja ali vprasanje Lini o zapisanem v ISTEM izreku kot sporocilo (lastnik 14. 11. 2026: »... ali si razumela moj je sporočilo«): po zapisu CELA
    // ponovitev, ne samo »Da, sporočilo sem zapisala«.
    const hocePonovitev = prosnjaVIzreku !== null || Boolean(razum?.ponovitev) || Boolean(razum?.vprasanje && jePonovitev(razum.vprasanje));
    // Vprasanje Lini BREZ vsebine za sporocilo (samo pozdrav, polnila ali »kako si«): sporocila ni in Lina ga ne zapise (prej je zapisala kar
    // vprasanje samo). Vsebina sta vsaj dve vsebinski besedi, ki nista samo »kako si«.
    const ostanek = meta.vprasanje ? meta.vsebina : (prosnjaVIzreku?.vsebina ?? text);
    const vsebinaOstanka = vsebinskeBesede(ostanek);
    const brezVsebine = (meta.vprasanje !== "" || prosnjaVIzreku !== null) && (vsebinaOstanka.length < 2 || jeMalopogovor(vsebinaOstanka.join(" ")));
    // Vprasanje o zapisu ali razumevanju, ki so ga prepoznala pravila (na koncu izreka ali kot cel izrek): ni »vprasanje o podjetju«.
    const vprasanjeOZapisu = prosnjaVIzreku !== null || vrstaVgrajenega(meta.vprasanje) === "zapisala";
    const brezMeta = meta.vprasanje && !brezVsebine ? meta.vsebina : odsVprPred?.vsebina || text;
    const sporociloSurovo = (razum?.vrsta === "sporocilo" ? razum.sporocilo : "") || ocistiSporocilo(brezMeta).slice(0, 300);
    const sporocilo = lociMetaVprasanje(sporociloSurovo).vsebina || sporociloSurovo;
    // Golo pozdravljanje (»dober dan«, »halo«) ni sporocilo: kratek »Izvolite, poslusam.«, najvec 2x, nato velja za sporocilo.
    if (pozdrav && (call.osebnoPozdravov ?? 0) < 2 && !call.order.tajnica?.sporocilo) {
      call.osebnoPozdravov = (call.osebnoPozdravov ?? 0) + 1;
      return odgovori(t("osebnaIzvolite"), false);
    }
    // Govorjeno vprasanje nima vprasaja: poleg jeVprasanje tudi vprasalnice in »imate/delate/izdelujete«.
    const kratekVprasalec =
      (razum?.vrsta === "vprasanje" && besedStevilo <= 12) ||
      (!jeSporocilo &&
        besedStevilo <= 8 &&
        (jeVprasanje(text) || /\b(kaj|kdo|kdaj|kje|kako|kaks\w*|kater\w*|koliko|zakaj|imate|delate|izdelujete|prodajate|cena|cene)\b/.test(fold(text))));
    // Brez zapisanega sporocila ni »sporočilo sem zapisala« (osebniZakljucek): samo slovo.
    if (wantsHangup(text) && !call.order.tajnica?.sporocilo) return odgovori(varianta("osebnaKonec"), true);
    // Pogovor pred sporocilom (»kako je«): »Dobro, hvala.« in nazaj k sporocilu (najvec 2x).
    if (jeMalopogovor(text) && !call.order.tajnica?.sporocilo && (call.osebnoMalo ?? 0) < 2) {
      call.osebnoMalo = (call.osebnoMalo ?? 0) + 1;
      return odgovori(`${varianta("osebnaDobro")} ${t("osebnaSporocilo")}`, false);
    }
    // Samo vprasanje o stevilki ali UI pred sporocilom: odgovor iz dejstev in nazaj k sporocilu (brez modela).
    const vgPred = vrstaVgrajenega(text);
    if ((vgPred === "stevilka" || vgPred === "ai") && besedStevilo <= 5 && !call.order.tajnica?.sporocilo && (call.osebnoNazaj ?? 0) < 2) {
      call.osebnoNazaj = (call.osebnoNazaj ?? 0) + 1;
      return odgovori(`${await odgovorVgrajenega(vgPred, text, "")} ${t("osebnaSporocilo")}`, false);
    }
    if (odsVprPred && !odsVprPred.vsebina && odgOdsPred && !call.order.tajnica?.sporocilo && (call.osebnoNazaj ?? 0) < 2) {
      call.osebnoNazaj = (call.osebnoNazaj ?? 0) + 1;
      zabeleziOdsotnost(odgOdsPred);
      return odgovori(`${odgOdsPred} ${t("osebnaSporocilo")}`, false);
    }
    // Vprasanje o podjetju ali izdelkih: vljudno nazaj k sporocilu (dvakrat; tretjic velja za sporocilo).
    // Sporocilo z vgrajenim vprasanjem (> 5 besed in znan vzorec) ni cisto vprasanje: sporocilo se zapise, vprasanje se odgovori.
    if (razum?.vrsta === "slovo" && !call.order.tajnica?.sporocilo) {
      if ((call.osebnoSlovoModel ?? 0) < 1) {
        call.osebnoSlovoModel = (call.osebnoSlovoModel ?? 0) + 1;
        return odgovori(varianta("osebnaIzvoliteKratko"), false);
      }
      return odgovori(varianta("osebnaKonec"), true);
    }
    if (razum?.vrsta === "cakaj" && !call.order.tajnica?.sporocilo && (call.osebnoCakanj ?? 0) < 2) {
      call.osebnoCakanj = (call.osebnoCakanj ?? 0) + 1;
      return odgovori(varianta("osebnaIzvoliteKratko"), false);
    }
    if (kratekVprasalec && !vprasanjeOZapisu && !odsVprPred?.vsebina && !(vgPred !== null && besedStevilo > 5) && (call.osebnoNazaj ?? 0) < 2) {
      call.osebnoNazaj = (call.osebnoNazaj ?? 0) + 1;
      // Model odgovori na vprasanje iz dejstev (pred sporocilom brez trditev o zapisu), nato nazaj k sporocilu.
      if (razum?.vrsta === "vprasanje" && razum.odgovor) {
        zabeleziCeModelOdsotnost(razum.odgovor);
        return odgovori(`${fraza(razum.odgovor)} ${t("osebnaSporocilo")}`, false);
      }
      return odgovori(t("osebnaNazaj"), false);
    }
    // Slabo prepoznan govor (Twilio Confidence < 0.5; 0 je neznano), manj kot 2 besedi ali model: nedokoncano/nerazumljivo.
    const slabo =
      !jeSporocilo &&
      ((typeof input.zaupanje === "number" && input.zaupanje > 0 && input.zaupanje < 0.5) ||
        besedStevilo < 2 ||
        razum?.vrsta === "nedokoncano" ||
        razum?.vrsta === "nerazumljivo" ||
        razum?.vrsta === "nejasno");
    // Model ni preprican, kaj je klicatelj rekel (Fable 7): enkrat prosi za ponovitev, preden zapise sporocilo.
    if ((slabo || razum?.negotovo) && !call.osebnoPonovljeno && !call.order.tajnica?.sporocilo) {
      call.osebnoPonovljeno = true;
      return odgovori(t("osebnaPonovi"), false);
    }
    // Samo ime brez sporocila: se enkrat edino vprasanje.
    if (!jeSporocilo && ime && sporocilo.split(/\s+/).length <= 3 && !call.order.tajnica?.sporocilo) return odgovori(t("osebnaSporocilo"), false);
    // Vprasanje ali prosnja Lini brez vsebine za sporocilo (lastnik 14. 11. 2026): nic se ne zapise. Na vprasanje o razumevanju ali zapisu posteno »Žal vas
    // nisem dobro razumela. Ali lahko ponovite sporočilo?« (enkrat na klic), sicer edino vprasanje »Katero sporočilo želite pustiti?«.
    if (brezVsebine) {
      if (vprasanjeOZapisu && !call.osebnoPonovljeno) {
        call.osebnoPonovljeno = true;
        return odgovori(t("osebnaPonovi"), false);
      }
      return odgovori(t("osebnaSporocilo"), false);
    }
    const prejSporocilo = call.order.tajnica?.sporocilo ?? "";
    const prejIzrek = call.order.tajnica?.izrek ?? "";
    // Vir je DOBESEDEN izrek (brez stika); sporocilo je ocisceno (model ga je moral povzeti iz izreka, razberiOsebno).
    call.order.tajnica = {
      sporocilo: prejSporocilo ? `${prejSporocilo} ${sporocilo}`.slice(0, 600) : sporocilo,
      // Izrek brez zapisanega in izgovorjenega stika: gre v vsak naslednji vhod modela (»Zapisan izrek«); stevilko ima lastnik v sporocilu in polju stika.
      izrek: (prejIzrek ? `${prejIzrek} ${brezIzgovorjenegaStika(ocistiSporocilo(brezMeta))}` : brezIzgovorjenegaStika(ocistiSporocilo(brezMeta))).slice(0, 600),
      razlog: call.order.tajnica?.razlog ?? "",
      // Prvo sporocilo po neuspeli prevezavi ne sme izbrisati oznake NUJNO, ki jo je ta prevezava postavila (CodeRabbit 029).
      nujno: call.order.tajnica?.nujno === true,
      nujnostZnana: call.order.tajnica?.nujnostZnana === true,
    };
    call.order.povprasevanje = call.order.tajnica.sporocilo.slice(0, 200);
    call.osebnoDodatnih = 0;
    pripraviPonovitev();
    // Prosnja ali vprasanje o zapisanem v ISTEM izreku (lastnik 14. 11. 2026): cela ponovitev »Zapisala sem: ...«. Ce posnetek se ni pripravljen (sinteza se
    // je pravkar zacela), najprej »Sporočilo sem zapisala, preberem ga v trenutku.« in ponovitev v naslednjem obratu (ponovi).
    if (hocePonovitev) {
      oznaciRazumljeno(prosnjaVIzreku?.razumljeno);
      return ponovi(call.order.tajnica);
    }
    // Predzadnja dovoljena zahteva: zahvala in slovo v istem odgovoru.
    if (predzadnja) return odgovori(osebniZakljucek(), true);
    // Vprasanje v ISTEM izreku (klic K3): sporocilo je ze zapisano; najprej odgovor iz dejstev, nato »Imate se kaksno vprasanje?«.
    const odsVrstaIsti = odsVprPred?.vrsta ?? (razum?.vprasanje ? vrstaVprasanjaOdsotnosti(razum.vprasanje, imeLastnika) : null);
    if (odsVrstaIsti) {
      const odgOdsIsti = odsotnostOdgovor(pravila, odsVrstaIsti, casZdaj);
      if (odgOdsIsti) {
        zabeleziOdsotnost(odgOdsIsti);
        return odgovori(`${odgOdsIsti} ${t("osebnaZapisana")}`, false);
      }
    }
    const vgrajeno = razum?.vprasanje
      ? (vrstaVgrajenega(razum.vprasanje) ?? "model")
      : (vrstaVgrajenega(meta.vprasanje || text) ?? (odsVrstaIsti ? "nevem" : null));
    if (vgrajeno) {
      zabeleziCeModelOdsotnost(razum?.odgovor);
      const odgovor = await odgovorVgrajenega(vgrajeno, razum?.vprasanje ?? "", call.order.tajnica.izrek ?? sporocilo, false, razum?.odgovor ? fraza(razum.odgovor) : null);
      return odgovori(`${odgovor} ${t("osebnaVprasanje")}`, false);
    }
    // 15. 11. 2026: po zapisu sporocila Lina ponovi zapisano in vprasa za potrditev (»Zapisala sem: <sporocilo>. Ali sem prav razumela?«).
    call.osebnoPotrdi = "caka";
    const besediloPotrditve = stavekPonovitve(call.order.tajnica);
    posebniOdgovora = [besediloPotrditve];
    return odgovori(`${besediloPotrditve} ${t("osebnaPravRazumela")}`, false);
  }

  if (!text) {
    const faza = fazaTrajanja(call.startedAt, now, pravila.najdaljsiPogovorMinut);
    const cas = odzivCasa(call, faza, pravila);
    if (cas) return odgovori(cas.reply, cas.konec);
    const tisine = call.tisine ?? 0;
    if (!fresh && tisine + 1 >= 2) {
      call.tisine = tisine + 1;
      return odgovori(zlepi([potrditevEnkrat(call, pravila), t("slovoTisina")]), true);
    }
    if (!fresh) call.tisine = tisine + 1;
    if (fresh) {
      call.korak = "ime";
      call.podjetjeVprasan = true;
      // Ime je vprasano v pozdravu; po pravilu »najvec enkrat« ga pozneje ne vprasamo znova.
      call.vprasano = ["ime"];
      return odgovori(uvodKlica(pravila, line.catalog.company.name), false);
    }
    // Molk na vprasanje po podatku: brez ponavljanja naprej na naslednje vprasanje (lastnik 10. 11. 2026).
    if (call.korak === "podatki" && call.caka && !call.stik.konec) {
      call.caka = undefined;
      const naslednje = naslednjeVprasanje(call);
      if (naslednje) return odgovori(naslednje, false);
      const k = koncajZbiranje(call, pravila);
      return odgovori(k.reply, k.konec);
    }
    // Molk po povzetku: vprasanje se ponovi enkrat (tisine stejejo, drugic Lina zakljuci).
    if (call.korak === "potrditev") {
      call.cakaPotrditev = true;
      return odgovori(t("potrditevVprasanje"), false);
    }
    return odgovori(t("nisemSlisala"), false);
  }

  call.tisine = 0;
  // Naslednji obrat po pozdravu je odgovor na vprasanje po imenu, tudi brez uvodne fraze.
  const cakaIme = call.korak === "ime";
  // Odgovor velja samo za vprasanje, ki je bilo postavljeno v prejsnjem obratu.
  const caka = call.caka;
  call.caka = undefined;
  // Golo ime velja kot odgovor na vprasanje po imenu; v pogovoru brez pozdrava (iz programa) tudi, dokler imena ni.
  const cakaOdgovor = cakaIme || caka === "ime" || (Boolean(call.stik.vprasan) && !call.stik.ime);
  const cakalPomoc = call.korak === "pomoc";
  const izloci = besedeKataloga(line);
  const kraji = [line.catalog.company.address];
  // vDnevnik je VSEBINA obrata (sporocilo za direktorja, povprasevanje, vrzeli znanja), zato iz ZDRUZENEGA izreka (neodvisni pregled 14. 11. 2026: z zadnjim
  // delom izreka je sporocilo izgubilo prvi del ali se sploh ni zapisalo). Vrstica prepisa je posebej: samo del te zahteve (skil, ZAPIS POGOVORA).
  const redigirajObrat = (besedilo: string) => redigirajDnevnik(besedilo, cakaOdgovor, izloci, kraji);
  const vDnevnik = redigirajObrat(text);
  // Vrstice prepisa tega izreka (novi del in ze zapisani prejsnji deli): stik se skrije po zdruzenem izreku.
  // Lina je vprasala po telefonu ali e-naslovu: VSE vrstice tega izreka so brez vsebine, tudi ce redakcija stika ne prepozna (delni e-naslov po
  // molku, telefon z manj stevkami; drugi slepi pregled 14. 11. 2026). Odgovor je v polju stika ali v zapisniku.
  const odgovorStika = caka === "telefon" || caka === "eposta";
  // Ce je stik v zdruzenem izreku prepoznan in redigiran brez ostanka stevk ali delnega stika, ostane neredigirani uvod v prepisu;
  // sicer (delni e-naslov po molku, telefon z manj stevkami) ostanejo vse vrstice brez vsebine (varovalka zasebnosti).
  const stikRedigiran =
    odgovorStika &&
    (caka === "telefon" ? Boolean(poisciTelefon(text) || telefonIzBesed(text)) : Boolean(zajemiStik(text, false).email)) &&
    !lahkoDelStika(vDnevnik);
  const vrsticeIzreka = zapisiVrsticoKlicatelja(call, zaPrepis, text, odgovorStika && !stikRedigiran ? () => "" : redigirajObrat, { at: now, ...merjenjeGovora(input.zaupanje, zaPrepis) });
  const prej = call.order;
  const prejStik = call.stik;
  const prejOsnutek = draftFromOrder(call.order);
  // Rok brez besede »rok« velja kot odgovor na vprasanje o roku, ali ko zbiramo podatke in Lina ravno ne caka
  // drugega podatka (klicatelj rok pove sam). Odgovor na vprasanje o telefonu ali povratnem klicu ni rok.
  const zeVprasanRok = (call.vprasano ?? []).includes("rok");
  const rokVprasan = !prej.deadline && (caka === "rok" || (caka === undefined && call.korak === "podatki" && !zeVprasanRok));
  const drugoVprasanje = caka !== undefined && caka !== "rok";
  // Potrditev velja samo kot odgovor na Linino vprasanje iz prejsnjega obrata (lastnik 10. 11. 2026).
  const cakaPotrditev = Boolean(call.cakaPotrditev);
  call.cakaPotrditev = false;
  const draft = absorbUtterance(prejOsnutek, text, line.catalog, {
    rokVprasan,
    drugoVprasanje,
    potrditevVprasana: cakaPotrditev,
    kolicinaVprasana: caka === "kolicina",
  });
  // Popravek v istem izreku (»Da, ampak iz jesena.«) ni potrditev: Lina popravi zapis in vprasa znova.
  const popravljeno =
    draft.requestedProduct !== prejOsnutek.requestedProduct ||
    draft.requestedMaterial !== prejOsnutek.requestedMaterial ||
    draft.quantity !== prejOsnutek.quantity ||
    draft.notes !== prejOsnutek.notes;
  if (popravljeno && !prejOsnutek.confirmAsked) draft.confirmAsked = false;
  const guard = applyGuards(draft, line.catalog, {
    question: text,
    answer: "",
    inquiry: pravila.povprasevanje,
  });
  call.order = {
    ...slipFromGuard(draft, guard, call.from),
    email: prej.email,
    oznaka: prej.oznaka,
    dosegljiv: prej.dosegljiv,
    podjetjeKlicatelja: prej.podjetjeKlicatelja,
    tajnica: prej.tajnica,
    povprasevanje: prej.povprasevanje,
    potrditevEposta: prej.potrditevEposta,
  };
  call.stik = dopolniStik(call.stik, text, call.from, { vprasan: cakaOdgovor, izloci, kraji });
  // Klicatelj je zavrnil številko iz From (»pokličite na drugo številko«): v zapisu ne ostane stara stevilka.
  if (!call.stik.telefon && prejStik.telefon && prejStik.telefon === call.from) call.order.phone = "";
  const zav = jeZavrnitev(text);
  // Narekovana stevilka, ki je ne znamo razbrati: zapisemo dobesedno in gremo naprej (vodja 10. 11. 2026).
  if (caka === "telefon" && !call.stik.telefon && !zav.splosno && !zav.telefon && steviloStevk(text) >= 3) {
    call.stik.telefon = text.replace(/\s+/g, " ").slice(0, 40);
    // Vse vrstice tega izreka (tudi prejsnji deli); brez vrstice klicatelja se ne prepise nic (prej je bila to lahko Linina vrstica).
    for (const i of vrsticeIzreka) call.transcript[i].text = BREZ_VSEBINE;
  }
  call.order = uveljaviStik(call.order, call.stik);
  const podjetje = zajemiPodjetje(text) ?? (cakaIme ? goloPodjetje(text, izloci, kraji) : null);
  if (podjetje !== null) call.order.podjetjeKlicatelja = podjetje;
  const cena = vprasaPoCeni(text);
  const vprasanje = jeVprasanje(text);
  const slovo = wantsHangup(text);
  const doseg = zajemiDosegljivost(text, caka, vprasanje || slovo ? "" : vDnevnik);
  if (doseg) call.order.dosegljiv = doseg;
  // Tajnica direktorja (lastnik 10. 11. 2026): sporocilo, razlog in nujnost v istem klicu kot povprasevanje.
  // Po neuspeli prevezavi je Lina vprasala po sporocilu: ta izrek je sporocilo.
  const taj = zajemiTajnico(text, vDnevnik, prej.tajnica, cakaSporocilo ? "sporocilo" : caka);
  if (taj) call.order.tajnica = taj;
  const sporociloNovo = Boolean(taj?.sporocilo) && taj?.sporocilo !== prej.tajnica?.sporocilo;
  const nujnoNovo = Boolean(taj?.nujno) && !prej.tajnica?.nujno;
  const potrdiloNujno = nujnoNovo ? t("nujnoZapisano") : "";
  const faza = fazaTrajanja(call.startedAt, now, pravila.najdaljsiPogovorMinut);

  // Ura pred modelom. Preskok okna najprej opozori, slovo sele na naslednjem obratu.
  const cas = odzivCasa(call, faza, pravila);
  if (cas) return odgovori(cas.reply, cas.konec);

  // Nujni klic na osebni telefon (stikalo »Prevezi nujni klic name«): Lina klicatelju pove SAMO, da ga poskusa povezati
  // (ne stevilke, ne casa, ne obljube). Dogodek »poskus« je v zapisu, izid (oglasil/neodgovor) sledi iz Dial (prevezavaIzid).
  // Ce se uporabnik ne oglasi, klic ostane pri Lini (sporocilo in oznaka »Nujno« sta ze zapisana): klic se ne izgubi.
  // Prevezava na zahtevo klicatelja (lastnik 23. 11. 2026): »prava oseba« ali nujnost, enkrat na klic, po isti poti kot nujni klic.
  // Vsebina ob prosnji po osebi (»Povežite me z Ano. Sestanek odpovedujem.«) je sporocilo PRED prevezavo: po neuspehu se ne vprasa znova (CodeRabbit 029).
  const prevezavaNaZahtevo = await sproziPrevezavoNaZahtevo(text, nujnoNovo, (zeli) => {
    const vsebina = zeli ? ocistiSporocilo(sporociloObProsnji(vDnevnik)) : "";
    const prejT = call.order.tajnica;
    if (!vsebina || prejT?.sporocilo.includes(vsebina)) return;
    call.order.tajnica = {
      sporocilo: (prejT?.sporocilo ? `${prejT.sporocilo} ${vsebina}` : vsebina).slice(0, NAJVEC_SPOROCILA * 2),
      ...(prejT?.izrek ? { izrek: prejT.izrek } : {}),
      razlog: prejT?.razlog ?? "",
      nujno: prejT?.nujno === true,
      nujnostZnana: prejT?.nujnostZnana === true,
    };
  });
  if (prevezavaNaZahtevo) return prevezavaNaZahtevo;
  if (nujnoNovo && moznosti.nujniPrevezava && !moznosti.vaja && !call.nujnoPrevezano) {
    call.nujnoPrevezano = true;
    // Kvota (na uro za isto stevilko, na dan skupaj): ob preseganju klic ostane pri Lini, dogodek ima izid »omejeno«.
    if (await rezervirajKvoto(root, call.callSid, call.from, now)) {
      call.nujniDogodki = [...(call.nujniDogodki ?? []), { cas: now, vrsta: "prevezava", izid: "poskus" }];
      const r = await odgovori(t("nujniPovezujem"), false);
      return { ...r, prevezi: true };
    }
    call.nujniDogodki = [...(call.nujniDogodki ?? []), { cas: now, vrsta: "prevezava", izid: "omejeno" }];
  }

  // Sporocilo za direktorja brez novega izdelka: koda odgovori (stalni stavki, brez modela), vprasa samo manjkajoce
  // (telefon, ce je skrit; nujnost, ce je klicatelj ni povedal) in zakljuci brez povzetka za potrditev.
  const novoNarociloT =
    draft.requestedProduct !== prejOsnutek.requestedProduct ||
    draft.requestedMaterial !== prejOsnutek.requestedMaterial ||
    (draft.quantity !== prejOsnutek.quantity && caka !== "kolicina") ||
    draft.notes !== prejOsnutek.notes;
  if (sporociloNovo && !novoNarociloT && !cena && call.korak !== "potrditev") {
    if (cakaIme) {
      call.korak = "pomoc";
      if (call.order.podjetjeKlicatelja === undefined) call.order.podjetjeKlicatelja = "";
      if (!call.stik.ime) {
        call.stik.ime = t("niPodatka");
        call.order = uveljaviStik(call.order, call.stik);
      }
    }
    const zapisano = zlepi([t("sporociloZapisano"), potrdiloNujno]);
    if (slovo) return odgovori(zlepi([zapisano, zakljucekZbiranja(call, pravila)]), true);
    const naslednje = naslednjeVprasanje(call);
    if (naslednje) return odgovori(zlepi([zapisano, naslednje]), false);
    const k = koncajZbiranje(call, pravila);
    return odgovori(zlepi([zapisano, k.reply]), k.konec);
  }

  // Razumevanje z modelom (lastnik 11. 11. 2026): »nisem razumel« in vprasanje po izdelkih. Model razbere samo namen,
  // besedilo sestavi koda iz kataloga. Brez modela, ob napaki ali po roku velja pravilo kode kot doslej.
  const stBesed = text.split(/\s+/).filter(Boolean).length;
  const golaPotrditev = cakaPotrditev && odgovorNaPotrditev(text) !== null && stBesed <= 3;
  if (stBesed >= 2 && !cakaIme && !slovo && !cena && !golaPotrditev && caka !== "telefon" && caka !== "eposta" && caka !== "ime") {
    const razumevanjeTece = merjeno("razumevanje", () => razumiIzrek(text, call.zadnjaLina ?? "", line.catalog, { dir: root, model: moznosti.razumevanje }));
    // Vzporedna parafraza (hedge) samo za vprasanje, ki bi ga pozneje res poslali modelu: ne cena, ne tema lastnika,
    // ne dobesedni odgovor iz kataloga, ne neznano. Vhod (jedro.facts) je isti kot pri poznejsem zaporednem klicu.
    const zamikParafraze = moznosti.zamikParafrazeMs === undefined ? ZAMIK_PARAFRAZE_MS : moznosti.zamikParafrazeMs;
    if (zamikParafraze !== null && vprasanje && !odgovorTemeLastnika(text, pravila) && !zaznajVbrizg(text).nezaupano) {
      const zgodnje = jedroOdgovora(text, line.catalog, draft, guard);
      if (!zgodnje.izKataloga && !zgodnje.neznano) {
        spekulativna = {
          facts: zgodnje.facts,
          // Spekulativni klic ima SVOJ zbiralnik meritev: ce se zavrze, obratu ne pripise zetona, 429 ali povezave (pregled B3).
          h: hedge<KlicParafraze>(
            (signal) =>
              vZbiralniku(new Zbiralnik(), async () => {
                const zb = trenutniZbiralnik() as Zbiralnik;
                const zacetekKlica = performance.now();
                const v = model ? await model(zgodnje.facts, signal) : await polishReplyIzid(zgodnje.facts, root, ROK_MODELA_OBRATA_MS, signal);
                return { v, ms: performance.now() - zacetekKlica, merjenje: zb.posnetek() };
              }),
            zamikParafraze,
            razumevanjeTece,
          ),
        };
      }
    }
    const razum = await razumevanjeTece;
    if (razum?.namen === "katalog" && line.catalog.products.length > 0) {
      call.vprasano = [...new Set([...(call.vprasano ?? []), "izdelek" as const])];
      return odgovori(odgovorKatalog(line.catalog, razum.material), false);
    }
    // Vprasanje o podjetju (kaj delamo, tehnologije, delovni cas ...): odgovor modela iz znanja velja samo, ce ga prepusti
    // preverba DOVOLJENEGA (odgovor-znanje.ts); sicer Lina rece stalni stavek iz pravil. Teme (garancija, dostava, rok) in
    // dobesedni odgovori iz kataloga (zapisek, naslov, ure, telefon) ostanejo pri obstojecih pravilih.
    if (razum?.namen === "vprasanje" && !odgovorTemeLastnika(text, pravila) && !odgovorIzKataloga(text, line.catalog)) {
      const veljaven = razum.odgovor ? preveriOdgovorZnanja(razum.odgovor, line.catalog) : null;
      if (!veljaven && !moznosti.vaja) await zapomniVrzel(vDnevnik, root);
      call.caka = caka;
      call.cakaPotrditev = cakaPotrditev;
      // Odgovor iz znanja: 1-2 kratka stavka (meja v kodi); isti odgovor drugic ne gre ponovno (»Kaj vas se zanima?«).
      // Prej se je za odgovorom ponovil se zadnji stavek Line in ves odgovor ob »ponovi« (pravi klic 14. 11. 2026).
      const kratek = veljaven ? skrajsajZnanje(veljaven) : null;
      // Klicatelj lahko Lino prekine (Gather sprejema govor med predvajanjem), zato »predvajano« ni »slisano«: isti odgovor
      // drugic pride skrajsan na prvi stavek (vsebina se ne izgubi), sele tretjic »Kaj vas se zanima?«.
      const kljucOdgovora = kratek ? fold(kratek) : "";
      const povedano = call.znanjePovedano ?? [];
      const kolikokrat = kljucOdgovora ? povedano.filter((k) => k === kljucOdgovora).length : 0;
      const ponovljen = kolikokrat >= 2;
      if (kljucOdgovora && !ponovljen) call.znanjePovedano = [...povedano, kljucOdgovora].slice(-12);
      znanjeOdgovor = Boolean(kratek) && !ponovljen;
      const prviStavek = kratek ? (stavkiBesedila(kratek)[0] ?? kratek) : "";
      let reply = ponovljen ? t("kajSeZanima") : kolikokrat === 1 ? prviStavek : (kratek ?? pravila.temaOdgovor);
      if (call.korak === "potrditev") {
        call.cakaPotrditev = true;
        reply = zlepi([reply, t("potrditevVprasanje")]);
      } else if (!imaPovprasevanje(call) && !ponovljen) {
        // Povprasevanja se ni: Lina ga ponudi (najvec enkrat na odgovor, ne ko je ze zapisano).
        reply = zlepi([reply, t("zanimaPovprasevanje")]);
      }
      if (prvaLina) reply = razkritjeSpredaj(reply, pravila.pozdrav, line.catalog.company.name, pravila);
      return odgovori(reply, false);
    }
    if (razum?.namen === "ponovi") {
      call.caka = caka;
      if (call.korak === "potrditev") {
        call.cakaPotrditev = true;
        return odgovori(povzetekZaPotrditev(call), false);
      }
      if (call.zadnjaLina) {
        call.cakaPotrditev = cakaPotrditev;
        // Odgovor iz znanja je kratek (najvec 2 stavka) in klicatelj ga je morda prekinil: ponovi se cel. Sicer samo zadnji stavek.
        return odgovori(`Ponovim. ${call.zadnjaZnanje ? call.zadnjaLina : zadnjiStavek(call.zadnjaLina)}`, false);
      }
    }
  }

  // Novo narocilo v tem obratu: izdelek, material, kolicina, mere ali potrditev. Tak obrat ni samo podatek.
  const novoNarocilo =
    draft.requestedProduct !== prejOsnutek.requestedProduct ||
    draft.requestedMaterial !== prejOsnutek.requestedMaterial ||
    // Kolicina kot odgovor na Linino vprasanje je podatek (kot rok), ne novo narocilo (G4g).
    (draft.quantity !== prejOsnutek.quantity && caka !== "kolicina") ||
    draft.notes !== prejOsnutek.notes ||
    (draft.confirmAsked && !prejOsnutek.confirmAsked);
  const zajeto =
    call.stik.ime !== prejStik.ime ||
    call.stik.telefon !== prejStik.telefon ||
    call.stik.email !== prejStik.email ||
    (draft.deadline ?? null) !== (prejOsnutek.deadline ?? null) ||
    (caka === "kolicina" && draft.quantity !== prejOsnutek.quantity) ||
    Boolean(doseg) ||
    sporociloNovo ||
    (caka === "nujnost" && Boolean(taj?.nujnostZnana)) ||
    podjetje !== null;
  // Koraki poteka klica (ime, podjetje, rok, telefon, e-posta, povratni klic, potrditev, slovo) ne rabijo modela:
  // odgovor je stalni stavek, ki ga ima glas ze pripravljenega.
  const tema = cena ? { besedilo: pravila.temaOdgovor?.trim() || t("temaPrivzeto"), neznano: false } : odgovorTemeLastnika(text, pravila);
  const samoPodatek = !cena && !vprasanje && !novoNarocilo && !tema;

  // Povprasevanje z besedami klicatelja: odgovor na »Kako vam lahko pomagam?« ali nov podatek o narocilu.
  const besed = vDnevnik.split(/\s+/).filter(Boolean).length;
  if (!call.order.povprasevanje && !cakaIme && !cena && !vprasanje && !slovo && !zav.splosno) {
    if (novoNarocilo || (cakalPomoc && !zajeto && besed >= 3)) call.order.povprasevanje = vDnevnik.slice(0, 200);
  }

  if (cakaIme) {
    call.korak = "pomoc";
    if (call.order.podjetjeKlicatelja === undefined) call.order.podjetjeKlicatelja = "";
    // Ime je bilo vprasano v pozdravu in ga ne vprasamo znova: brez odgovora ostane »ni podatka« (pregled G2, N8).
    if (!call.stik.ime) {
      call.stik.ime = t("niPodatka");
      call.order = uveljaviStik(call.order, call.stik);
    }
    if (samoPodatek && !slovo) return odgovori(t("kakoPomagam"), false);
  }

  // Nacin podjetja (lastnik 14. 11. 2026): klicatelj pove, kaj potrebuje (»nalepke, 100 kosov«) -> Lina zabelezi, ne razlaga
  // drugih izdelkov in ne sprasuje vec; zahvala, »podjetje vas bo kontaktiralo«, lep dan. Potrditev na koncu odpade.
  const potrebaPovedana =
    !pravila.podrobniPotek &&
    !cena &&
    !vprasanje &&
    !slovo &&
    !tema &&
    !zav.splosno &&
    !call.order.confirmed &&
    call.korak !== "potrditev" &&
    !sporociloNovo &&
    !nujnoNovo &&
    !doseg &&
    (novoNarocilo || (cakalPomoc && !zajeto && besed >= 3));
  if (potrebaPovedana) {
    if (!call.order.povprasevanje) call.order.povprasevanje = vDnevnik.slice(0, 200);
    if (call.order.podjetjeKlicatelja === undefined) call.order.podjetjeKlicatelja = "";
    const zakljucek = kratekZakljucekPodjetja(call, pravila);
    return odgovori(prvaLina ? razkritjeSpredaj(zakljucek, pravila.pozdrav, line.catalog.company.name, pravila) : zakljucek, true);
  }

  // Zanikanje brez popravka (»Ne.«, »Ni tako.«): Lina enkrat vprasa, kaj naj popravi. Brez modela.
  // Odgovor na povzetek na koncu klica: »Da.« in »Potrjujem.« potrdita, »Da, ampak ...« je popravek (G4a).
  if (call.korak === "potrditev" && cakaPotrditev && !cena && !vprasanje && !tema) {
    const odg = odgovorNaPotrditev(text);
    const signal = jeSignalPopravka(text);
    if (slovo || (odg === "da" && !signal && !popravljeno && !zajeto)) {
      return odgovori(zakljucekZbiranja(call, pravila), true);
    }
    if (odg === "ne" && !popravljeno && !signal && !zajeto && !call.popravekVprasan) {
      call.popravekVprasan = true;
      call.cakaPotrditev = true;
      return odgovori(t("kajPopravim"), false);
    }
    // G4g: klicatelj ob povzetku zavrne vidno stevilko (»pokličite me na drugo stevilko«): telefon je spet manjkajoc in Lina
    // ga vprasa (enkrat); po odgovoru sledi nov povzetek.
    if (!call.stik.telefon && !(call.vprasano ?? []).includes("telefon")) {
      call.stik.konec = false;
      const vprasanje = naslednjeVprasanje(call);
      if (vprasanje) return odgovori(vprasanje, false);
    }
    if (popravljeno || signal || zajeto || odg === "ne") {
      const k = koncajZbiranje(call, pravila);
      return odgovori(k.reply, k.konec);
    }
    // Nejasen odgovor brez spremembe: vprasanje se ponovi, drugic Lina zakljuci.
    if ((call.potrditevVprasanj ?? 0) >= NAJVEC_VPRASANJ_POTRDITVE) return odgovori(zakljucekZbiranja(call, pravila), true);
    call.potrditevVprasanj = (call.potrditevVprasanj ?? 0) + 1;
    call.cakaPotrditev = true;
    return odgovori(t("potrditevVprasanje"), false);
  }

  if (call.korak === "podatki" && !call.stik.konec && samoPodatek) {
    // Zbiranje podatkov: eno vprasanje na obrat, brez modela. »Ne vem«, »nimam« in vse drugo gre naprej.
    const ni = t("niDan");
    if ((zav.telefon || (zav.splosno && caka === "telefon")) && !call.stik.telefon) call.stik.telefon = ni;
    if ((zav.email || (zav.splosno && caka === "eposta")) && !call.stik.email) call.stik.email = ni;
    if ((zav.ime || (zav.splosno && caka === "ime")) && !call.stik.ime) call.stik.ime = ni;
    call.order = uveljaviStik(call.order, call.stik);
    // Slovo sredi zbiranja ne odpira novega vprasanja.
    if (slovo) return odgovori(zlepi([potrdiloNujno, zakljucekZbiranja(call, pravila)]), true);
    const naslednje = naslednjeVprasanje(call);
    if (naslednje) return odgovori(zlepi([potrdiloNujno, naslednje]), false);
    const k = koncajZbiranje(call, pravila);
    return odgovori(zlepi([potrdiloNujno, k.reply]), k.konec);
  }

  const samoIme =
    call.korak === undefined &&
    Boolean(call.stik.ime) &&
    !imaPovprasevanje(call) &&
    !cena &&
    !vprasanje;
  if (samoIme) {
    call.korak = "pomoc";
    if (call.order.podjetjeKlicatelja === undefined) call.order.podjetjeKlicatelja = "";
    const uvod = prvaLina ? razkritjeSpredaj("", pravila.pozdrav, line.catalog.company.name, pravila) : "";
    return odgovori(`${uvod} ${t("kakoPomagam")}`.trim(), false);
  }

  // Slovo in podatek, povedan po zaprtem stiku (»Aja, moj mail je …«), prav tako brez modela.
  if (!prvaLina && samoPodatek && slovo && !call.order.confirmed) {
    return odgovori(zlepi([potrditevEnkrat(call, pravila), t("slovo")]), true);
  }
  if (!prvaLina && samoPodatek && zajeto && call.stik.konec) {
    return odgovori(t("stikZakljucek"), false);
  }

  const jedro0 = jedroOdgovora(text, line.catalog, draft, guard);
  const jedro = tema ? { facts: tema.besedilo, neznano: tema.neznano, izKataloga: true } : jedro0;
  // Vprasanje o izdelku oziroma materialu najvec enkrat (vodja 10. 11. 2026): drugic Lina zapise, kar je slisala.
  const ze = new Set(call.vprasano ?? []);
  const vrstaPoziva: "izdelek" | "material" | null =
    cena || tema || jedro0.izKataloga || guard.violations.length > 0 || guard.confirmed || line.catalog.products.length === 0
      ? null
      : guard.product
        ? "material"
        : "izdelek";
  const ponovljenPoziv = vrstaPoziva !== null && ze.has(vrstaPoziva) && imaPovprasevanje(call);
  if (vrstaPoziva && !ponovljenPoziv) call.vprasano = [...ze, vrstaPoziva];
  // Potrditev zapisnika je natancen stavek iz kataloga: model je ne preoblikuje.
  const potrjeno = guard.confirmed && draft.confirmAsked;
  // Model samo za vprasanja klicatelja; vse drugo je stalni stavek (G4a: manj klicev modela, manj cakanja).
  // Izrek z vzorcem vbrizga navodil (Mercury F) modela ne dobi: odgovor je preverjeno dejstvo iz kataloga.
  const brezModela = Boolean(cena || tema || ponovljenPoziv || potrjeno || !vprasanje || zaznajVbrizg(text).nezaupano);
  if (jedro.neznano && !moznosti.vaja) await zapomniVrzel(vDnevnik, root);
  const osnutek = ponovljenPoziv
    ? t("stikZakljucek")
    : brezModela || jedro.neznano || jedro.izKataloga
      ? jedro.facts
      // Odgovor modela se nikoli ne zacne s pozdravom ali predstavitvijo (predstavitev je samo v pozdravu).
      : brezUvoda(
          await (async () => {
            // Vzporedno zacet klic z istim vhodom: ce je uspel, vzamemo njegov izid in meritev. Ce ni (napaka, prazen izid),
            // padec nazaj na zaporedni klic, ki lahko uspe (pregled B2).
            const zacet = spekulativna && spekulativna.facts === jedro.facts ? spekulativna.h.zacet() : null;
            if (zacet) {
              try {
                const izid = await zacet;
                if (izid.v !== null) {
                  const zb = trenutniZbiralnik();
                  zb?.dodaj("parafraza", izid.ms);
                  zb?.zdruzi(izid.merjenje);
                  return izid.v;
                }
              } catch {
                /* zaporedni klic spodaj */
              }
            }
            return merjeno("parafraza", async () => (model ? await model(jedro.facts) : await polishReply(jedro.facts, root, ROK_MODELA_OBRATA_MS)));
          })(),
          jedro.facts,
        );
  const potrditev =
    guard.confirmed && draft.confirmAsked && vprasaPoCeni(text) ? renderReply(line.catalog, draft, guard, false) : "";
  let reply = ponovljenPoziv
    ? osnutek
    : sestaviOdgovor({
        question: text,
        osnutek,
        // Cena: uporabnikovo sporocilo po povprasevanju, ce ga je nastavil; sicer privzeto »obvestilo podjetje«.
        inquiry: cena && pravila.povprasevanje.trim() === t("povprasevanje") ? (tema?.besedilo ?? pravila.povprasevanje) : pravila.povprasevanje,
        fresh: false,
        pozdrav: pravila.pozdrav,
        podjetje: line.catalog.company.name,
        osnova: jedro.facts,
        potrditev,
      });
  // Prazen katalog: »Povejte, kaj bi radi narocili« po ze povedanem povprasevanju ne bi imelo smisla; sledi naslednje vprasanje.
  if (line.catalog.products.length === 0 && imaPovprasevanje(call) && reply.trim() === t("povejteNarocilo")) reply = "";
  const nedotaknjeno = Boolean(tema) && reply.trim() === tema?.besedilo.trim();
  // Povprasevanje in sporocilo v istem izreku: oba zapisa dobita potrditev (stalna stavka), nato odgovor o izdelku.
  if (sporociloNovo || nujnoNovo) reply = zlepi([sporociloNovo ? t("sporociloZapisano") : "", potrdiloNujno, reply]);
  if (prvaLina) reply = razkritjeSpredaj(reply, pravila.pozdrav, line.catalog.company.name, pravila);
  let konec = slovo;
  const zbiranje = imaPovprasevanje(call) && !call.stik.konec;
  if (zbiranje) call.korak = "podatki";
  // En obrat = eno vprasanje: ce odgovor ze sprasuje (izdelek, material), vprasanje po podatku pocaka naslednji obrat.
  const zeSprasuje = (vrstaPoziva !== null && !ponovljenPoziv) || reply.includes("?");
  const smeVprasati = (!cena && !nedotaknjeno) || call.order.confirmed;
  // Slovo z zapisanim povprasevanjem: stik se vprasa pred slovesom, a samo, ce se ni bil.
  const prvicPredSlovesom = slovo && !(call.vprasano ?? []).some((polje) => polje === "telefon" || polje === "eposta");
  if (zbiranje && smeVprasati && !zeSprasuje && (!slovo || prvicPredSlovesom)) {
    const naslednje = naslednjeVprasanje(call);
    if (naslednje) {
      konec = false;
      // Brez »Hvala.« po podatku (lastnik, G4c: za vsak podatek je preveč): zahvala je samo na koncu klica.
      reply = zlepi([reply, naslednje]);
    } else {
      // Vse je zbrano: povzetek in vprasanje »Ali potrjujete naročilo?« (ali zakljucek, ce ni kaj potrjevati).
      const k = koncajZbiranje(call, pravila);
      reply = zlepi([reply, k.reply]);
      konec = k.konec;
    }
  }
  // Vprasanje med potrditvijo: Lina odgovori in ponovi vprasanje za potrditev (ne odpre novih vprasanj).
  if (call.korak === "potrditev" && !konec && !reply.includes(t("potrditevVprasanje"))) {
    reply = zlepi([reply, t("potrditevVprasanje")]);
    call.cakaPotrditev = true;
  }
  if (konec && !call.stik.konec) reply = zlepi([reply, potrditevEnkrat(call, pravila)]);
  return odgovori(reply, konec);
}

function trimCall(call: CallSession): CallSession {
  if (call.transcript.length > MAX_LINES) {
    call.transcript = call.transcript.slice(-MAX_LINES);
  }
  return call;
}

const vrsteLinije = new Map<string, Promise<unknown>>();

function odprtje(line: LineState, root: string): { stanje: StanjeOdprtja; razlog: LinijaZGlasom["odprtje"]["razlog"] } {
  const razlog = stanjeGlasu(root).razlog;
  if (line.open) return line.brezGlasu ? { stanje: "odprtaBrezGlasu", razlog } : { stanje: "odprta", razlog: "" };
  return line.caka ? { stanje: "cakaGlas", razlog } : { stanje: "zaprta", razlog: "" };
}

/** Linija, ki caka na glas, se odpre, ko so stalni stavki pripravljeni. Brez pripravljenega glasu ostane zaprta. */
async function odpriCeCaka(root: string): Promise<void> {
  await vVrsti(vrsteLinije, root, async () => {
    const line = await loadLine(root);
    if (line.open || !line.caka) return;
    const pravila = await loadPravila(root);
    if (!glasPripravljenZa(root, stalniStavki(pravila, line.catalog.company.name, line.catalog))) return;
    await writeJson(root, "line.json", { ...line, open: true, caka: false, brezGlasu: false, updatedAt: new Date().toISOString() });
  });
}

/**
 * Priprava glasu za stanje linije. Odprta linija (ali linija, ki caka na odprtje) pripravi vse stalne stavke;
 * zaprta samo stavek »linija zaprta« in stalnih stavkov ne odznaci (pregled G2, N9).
 */
function pripraviGlasLinije(root: string, line: LineState, pravila: Pravila): void {
  zazeniCiscenjeZvoka(root);
  if (line.open || line.caka) {
    void pripraviStalne(root, stalniStavki(pravila, line.catalog.company.name, line.catalog)).catch(() => undefined);
    if (line.caka) poPripraviGlasu(root, () => odpriCeCaka(root));
    return;
  }
  void pripraviStalne(root, [zRazkritjem(pravila, t("linijaZaprta"))], { odznaci: false }).catch(() => undefined);
}

export type StanjeZagona = "odprta" | "caka" | "zaprta" | "napaka";

/**
 * Ob zagonu programa: odprta linija (ali linija, ki caka na glas) pripravi stalne stavke v ozadju, da ima ze prvi
 * klic pozdrav v Lininem glasu. Zaprta linija sinteze ne trosi. Nikoli ne vrze: napaka ali manjkajoca prijava
 * ostane v stanju glasu. Prvi klic med pripravo caka isto pripravo (pripraviStalne iste mnozice ne pozene dvakrat).
 */
export async function pripraviGlasObZagonu(dir?: string): Promise<StanjeZagona> {
  try {
    const root = resolveDataDir(dir);
    // Zeton Google in povezava ne smeta biti hladna ob prvem klicu (ce je racun nastavljen).
    await ogrejZaKlic(root);
    const line = await loadLine(root);
    if (!line.open && !line.caka) return "zaprta";
    pripraviGlasLinije(root, line, await loadPravila(root));
    return line.open ? "odprta" : "caka";
  } catch {
    return "napaka";
  }
}

export async function publishLine(
  input: unknown,
  ctx: SessionContext,
  dir?: string,
): Promise<LinijaZGlasom & { opozorila: string[] }> {
  const root = resolveDataDir(dir);
  await requireOwner(ctx.token, root);
  const patch = parsePublish(input);
  const pravila = await loadPravila(root);
  const next = await vVrsti(vrsteLinije, root, async () => {
    const current = await loadLine(root);
    const catalog = patch.catalog ?? current.catalog;
    let open = current.open;
    let caka = Boolean(current.caka);
    let brezGlasu = Boolean(current.brezGlasu);
    if (patch.open === false) {
      open = false;
      caka = false;
      brezGlasu = false;
    } else if (patch.open === true && (!current.open || patch.brezGlasu)) {
      // Razkritje UI mora biti prvi stavek v razumljivem glasu (pregled G2, V1): linija se odpre sele, ko so stalni
      // stavki pripravljeni, ali ko uporabnik izrecno potrdi odprtje brez glasu.
      if (patch.brezGlasu) {
        open = true;
        caka = false;
        brezGlasu = true;
      } else if (glasPripravljenZa(root, stalniStavki(pravila, catalog.company.name, catalog))) {
        open = true;
        caka = false;
        brezGlasu = false;
      } else if (!current.open) {
        caka = true;
      }
    }
    const zapis: LineState = { open, caka, brezGlasu, catalog, updatedAt: new Date().toISOString() };
    await writeJson(root, "line.json", zapis);
    // Revizijska veriga (naloga #45): le ob spremembi poslovnega znanja; vsebine ne zapisemo, samo razdelke in zgoscevalno kodo.
    // zapisiRevizijo nikoli ne vrze, zato shranjevanje kataloga zaradi dnevnika ne more odpovedati.
    if (patch.catalog) {
      const povzetek = povzetekSpremembeKataloga(current.catalog, catalog);
      if (povzetek) await zapisiRevizijo(root, povzetek);
    }
    return zapis;
  });
  const opozorila: string[] = [];
  if (pravila.prevzem === "izven" && !ureSoRazumljive(next.catalog.company.hours)) {
    opozorila.push(t("ureOpozorilo"));
  }
  // Glas se pripravi v ozadju: napaka sinteze ne sme podreti shranjevanja, razlog je v stanju glasu in odprtja.
  pripraviGlasLinije(root, next, pravila);
  return { ...next, opozorila, glas: stanjeGlasu(root), odprtje: odprtje(next, root) };
}

/** Zapis klica za rezervo po ponovnem zagonu (zahteva po vmesnem stavku brez opravila v pomnilniku). */
export async function preberiKlic(callSid: string, dir?: string): Promise<CallSession | null> {
  const book = await loadCalls(resolveDataDir(dir));
  return book[callSid.trim()] ?? null;
}

export async function klicObstaja(callSid: string, dir?: string): Promise<boolean> {
  const book = await loadCalls(resolveDataDir(dir));
  return Boolean(callSid && book[callSid]);
}

/** Statusni povratni klic: klicatelj je odlozil, povzetek in kratki klic se zapiseta. */
export async function zakljuciKlic(callSid: string, dir?: string): Promise<CallSession | null> {
  const root = resolveDataDir(dir);
  const sid = callSid.trim();
  const kljuc = `${root}\n${sid}`;
  return vVrsti(vrsteSida, kljuc, async () => {
    const call = await zakljuciKlicVrstno(callSid, root);
    if (call?.status === "zakljucen") pocistiVrsto(vrsteSida, kljuc);
    else if (!call && vrsteSida.get(kljuc)) pocistiVrsto(vrsteSida, kljuc);
    // Konec klica pri posredniku: nestalni posnetki (lahko z imenom klicatelja) gredo ven takoj (pregled G2, V2).
    await pobrisiZvokKlica(root, sid).catch(() => undefined);
    // Snemanje (lastnik 22. 11. 2026): brez narocila izbris pri Twiliu, z narocilom prenos v mapo klica. V ozadju (Twilio obdeluje posnetek).
    if (call?.status === "zakljucen") void import("./snemanje.server.ts").then((m) => m.koncajPoKlicu(root, call)).catch(() => undefined);
    return call;
  });
}

/**
 * Izbirni dodatek Soniox: dobeseden zapis govora pride PO koncu klica, ko isto knjigo klicev ze zapisuje drug klic.
 * Zapis zato gre skozi ISTI vrsti (klic, knjiga) kot vsak drug zapis klica: lastno branje-spreminjanje-pisanje cele knjige
 * bi pobrisalo sveze spremembe drugega klica (preizkus naloga-soniox-knjiga-vrsta). Zapisek in Klici.txt se osvezita.
 */
export async function dopolniKlicDobesedno(callSid: string, besedilo: string, dir?: string): Promise<void> {
  const root = resolveDataDir(dir);
  const sid = callSid.trim();
  if (!OBLIKA_CALLSID.test(sid) || !besedilo) return;
  const kljuc = `${root}\n${sid}`;
  await vVrsti(vrsteSida, kljuc, async () => {
    const call = await knjigaKlicev.beri(root, sid);
    if (call) {
      call.dobesedno = besedilo;
      call.updatedAt = new Date().toISOString();
      await zapisiKnjigo(root, sid, call);
      if (call.status === "zakljucen") await zapisekOdKlica(root, sid, call);
    }
    if (!call || call.status === "zakljucen") pocistiVrsto(vrsteSida, kljuc);
  });
}

async function zakljuciKlicVrstno(callSid: string, root: string): Promise<CallSession | null> {
  const sid = callSid.trim();
  if (!sid) return null;
  const book = await loadCalls(root);
  const call = book[sid];
  if (!call) return null;
  if (call.status === "zakljucen") {
    // Zapisek, ki ob koncu klica ni nastal (napaka mape), se ob dopolnitvi poskusi znova.
    if (!call.zapisek) await zapisekOdKlica(root, sid, call);
    return call;
  }
  const pravila = await loadPravila(root);
  const now = new Date().toISOString();
  zakljuci(call, now, pravila.povprasevanje);
  call.updatedAt = now;
  await zapisiKnjigo(root, sid, call);
  await zapisekOdKlica(root, sid, call);
  return call;
}

export async function readLine(ctx: SessionContext, dir?: string): Promise<LinijaZGlasom> {
  const root = resolveDataDir(dir);
  await requireOwner(ctx.token, root);
  const line = await loadLine(root);
  // Po ponovnem zagonu programa se glas pripravi, ko lastnik odpre vmesnik (v ozadju).
  pripraviGlasLinije(root, line, await loadPravila(root));
  return { ...line, glas: stanjeGlasu(root), odprtje: odprtje(line, root) };
}

export async function listCalls(ctx: SessionContext, dir?: string): Promise<CallSession[]> {
  const root = resolveDataDir(dir);
  await requireOwner(ctx.token, root);
  const book = await loadCalls(root);
  // Nujni klici na vrhu zapisnika, nato najnovejsi (lastnik 10. 11. 2026). Klici, ki jih je sprejela Lina na telefonu (naloga 17), so na istem seznamu.
  return razvrstiKlice([...Object.values(book), ...(await kliciTelefona(root))]);
}

export async function talk(
  input: { callSid?: string; from?: string; text?: string; hangup?: boolean },
  ctx: SessionContext,
  dir?: string,
): Promise<TurnResult> {
  const root = resolveDataDir(dir);
  await requireOwner(ctx.token, root);
  const callSid = input.callSid?.trim() || `pisarna-${crypto.randomUUID()}`;
  return recordCaller({ ...input, callSid }, root);
}

export async function phoneTurn(
  input: { callSid?: string; from?: string; text?: string; hangup?: boolean },
  ctx: SessionContext,
  dir?: string,
): Promise<TurnResult> {
  const root = resolveDataDir(dir);
  await requireOwner(ctx.token, root);
  if (!input.callSid?.trim()) throw new Error("Manjka CallSid.");
  return recordCaller({ callSid: input.callSid, from: input.from, text: input.text, hangup: input.hangup }, root);
}

/** Izgovori samo zadnji stavek, ki ga je Lina ze zapisala za ta CallSid. */
export async function speak(
  input: { callSid?: string; text?: string },
  ctx: SessionContext,
  dir?: string,
): Promise<{ text: string; lang: "sl-SI"; audioBase64: string | null; mime: string | null }> {
  const root = resolveDataDir(dir);
  await requireOwner(ctx.token, root);
  const callSid = input.callSid?.trim() ?? "";
  const text = input.text?.trim() ?? "";
  const book = await loadCalls(root);
  const call = book[callSid];
  const last = [...(call?.transcript ?? [])].reverse().find((line) => line.role === "lina");
  if (!call || !last || last.text !== text) throw new Error("Tega stavka ne izgovorim.");
  const audio = await speakAudio(text);
  return { text, lang: "sl-SI", audioBase64: audio?.audioBase64 ?? null, mime: audio?.mime ?? null };
}

function zapisVaje(call: CallSession, inquiry: string): ZapisVaje {
  const ni = t("niPodatka");
  const o = call.order;
  const izdelek = [o.productName || o.requestedProduct, o.materialName || o.requestedMaterial, o.quantity ? `${o.quantity} kos` : "", o.notes]
    .filter(Boolean)
    .join(", ");
  return {
    ime: o.customerName || ni,
    podjetje: o.podjetjeKlicatelja || ni,
    povprasevanje: izdelek || o.povprasevanje || ni,
    rok: o.deadline || ni,
    telefon: o.phone || ni,
    eposta: o.email || ni,
    povratniKlic: o.dosegljiv === "ni-nujno" ? t("niNujnoOznaka") : o.dosegljiv || ni,
    potrditevEposta: Boolean(o.potrditevEposta),
    povzetek: call.povzetek ?? povzetekKlica(call, inquiry),
  };
}

/** Najdaljse cakanje vaje na glas: v programu ni roka posrednika, a uporabnik ne sme cakati v nedogled. */
export const ROK_GLASU_VAJE_MS = 20_000;

/**
 * Vaja klica pred vklopom linije (lastnik potrdil 10. 11. 2026). Tece po ISTI kodi kot pravi klic (recordCaller,
 * mozgani, pravila, glas), zapis pa zivi samo v pomnilniku: nic ne gre med prave klice, narocila ali vrzeli.
 * Samo za prijavljenega uporabnika; javna pot /api/voice vaje ne pozna.
 */
export async function vajaKlica(
  input: { id?: string; text?: string; konec?: boolean },
  ctx: SessionContext,
  dir?: string,
  moznosti: { model?: ModelOsnutka; ura?: () => number } = {},
): Promise<OdgovorVaje> {
  const root = resolveDataDir(dir);
  await requireOwner(ctx.token, root);
  const ura = moznosti.ura ?? (() => performance.now());
  const zacetek = ura();
  void ogrejZaKlic(root);
  const id = input.id?.trim() || `vaja-${crypto.randomUUID()}`;
  if (!/^vaja-[0-9a-f-]{36}$/.test(id)) throw new Error("Vaja ni veljavna.");
  const pravila = await loadPravila(root);
  const konec = async (call: CallSession): Promise<ZapisVaje> => {
    const zapis = zapisVaje(call, pravila.povprasevanje);
    vaje.delete(`${root}\n${id}`);
    // Posnetki vaje se predvajajo v programu se nekaj casa, nato gredo ven kot pri klicu.
    void pobrisiZvokKlica(root, id, ODLOG_PO_SLOVESU_MS).catch(() => undefined);
    return zapis;
  };
  if (input.konec) {
    const call = await knjigaVaj.beri(root, id);
    if (!call) throw new Error("Vaja ni veljavna.");
    zakljuci(call, new Date().toISOString(), pravila.povprasevanje);
    return { id, vaja: true, reply: "", ms: 0, msBesedila: 0, zvok: [], koncano: true, zapis: await konec(call) };
  }
  const obstaja = Boolean(await knjigaVaj.beri(root, id));
  if (input.id && !obstaja) throw new Error("Vaja ni veljavna.");
  const izid = await recordCaller({ callSid: id, from: "", text: obstaja ? (input.text ?? "") : "" }, root, moznosti.model, {
    vaja: true,
    ura: moznosti.ura,
  });
  let zvok: string[] = [];
  if (izid.reply) {
    const glas = await Promise.race([
      zvokZaBesedilo(izid.reply, root, id),
      new Promise<null>((resolve) => {
        const casovnik = setTimeout(() => resolve(null), ROK_GLASU_VAJE_MS);
        casovnik.unref?.();
      }),
    ]);
    if (glas && "kljuci" in glas) zvok = glas.kljuci.map((kljuc) => potZvoka(kljuc));
  }
  const koncano = izid.call.status === "zakljucen";
  return {
    id,
    vaja: true,
    reply: izid.reply,
    ms: Math.max(0, Math.round(ura() - zacetek)),
    msBesedila: izid.ms ?? 0,
    zvok,
    koncano,
    zapis: koncano ? await konec(izid.call) : null,
  };
}

/** Cas do pripravljenega glasu za zadnji Linin odgovor: dopolni zapis klica, brez vsebine. */
export async function zabeleziCasGlasu(callSid: string, obrat: number, ms: number, dir?: string, merjenje?: MerjenjeObrata): Promise<void> {
  const root = resolveDataDir(dir);
  const sid = callSid.trim();
  const kljuc = `${root}\n${sid}`;
  await vVrsti(vrsteSida, kljuc, async () => {
    const call = (await loadCalls(root))[sid];
    const zadnja = call ? [...call.transcript].reverse().find((vrstica) => vrstica.role === "lina") : undefined;
    if (!call || !zadnja || (call.obrat ?? 0) !== obrat) return;
    zadnja.glasMs = Math.max(0, Math.round(ms));
    // Dopolnjeno merjenje (TTS, zapis WAV, povezava) nadomesti zacetno, ki je imelo samo stopnje do besedila.
    if (merjenje && (Object.keys(merjenje.ms).length > 0 || merjenje.povezava)) zadnja.merjenje = merjenje;
    await zapisiKnjigo(root, sid, call);
    if (call.status === "zakljucen") pocistiVrsto(vrsteSida, kljuc);
  }).catch(() => undefined);
}

/** Merilnik verige: prvi GET /zvok obrata dopolni zadnjo Lino vrstico (zvokPrislo, zvokPoslan; ms, brez vsebine). Samo prvi kos obrata. */
export async function zabeleziPrenosZvoka(callSid: string, obrat: number, prislo: number, poslan: number, dir?: string): Promise<void> {
  const root = resolveDataDir(dir);
  const sid = callSid.trim();
  const kljuc = `${root}\n${sid}`;
  await vVrsti(vrsteSida, kljuc, async () => {
    const call = (await loadCalls(root))[sid];
    const zadnja = call ? [...call.transcript].reverse().find((vrstica) => vrstica.role === "lina") : undefined;
    if (!call || !zadnja || (call.obrat ?? 0) !== obrat || zadnja.merjenje?.ms.zvokPrislo !== undefined) return;
    const m = zadnja.merjenje ?? { ms: {} };
    m.ms.zvokPrislo = Math.max(0, Math.round(prislo));
    m.ms.zvokPoslan = Math.max(0, Math.round(poslan));
    zadnja.merjenje = m;
    await zapisiKnjigo(root, sid, call);
    if (call.status === "zakljucen") pocistiVrsto(vrsteSida, kljuc);
  }).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------------------------------
// Pot Gemini Live (naloga-live, lastnik 11. 11. 2026). Govor tece neposredno med klicateljem in modelom (most Twilio Media
// Streams <-> Live, live/most.ts); koda tu samo ZAPISUJE: prepis izrekov klicatelja gre skozi ista pravila zajema kot pot
// Gather (absorbUtterance, dopolniStik, uveljaviStik, applyGuards ...), prepis Linih odgovorov v dnevnik klica, ura in
// zakljucek povprasevanja. Odgovora tu ne sestavljamo (ga je ze izrekel model) in zvoka ne hranimo.
// OMEJITEV: zajem podatkov iz izreka je kopija dela obratKlica; obratKlica je tesno povezan z gradnjo odgovora, zato ga
// nismo razdelili (refaktor ni del te naloge). Ob spremembi pravil zajema v obratKlica je treba spremeniti tudi tu.
// ---------------------------------------------------------------------------------------------------------------------

/** Nov klic na poti Live: zapis z Lininim pozdravom (ki ga predvaja koda, ne model). Ze obstojec zapis se ne prepise. */
export async function zacniKlicLive(input: { callSid: string; from?: string; now?: string; pozdrav: string }, dir?: string): Promise<CallSession> {
  const root = resolveDataDir(dir);
  const sid = input.callSid.trim().slice(0, 80);
  if (!sid || sid === "preizkus" || !OBLIKA_CALLSID.test(sid)) throw new Error("Manjka CallSid.");
  return vVrsti(vrsteSida, `${root}\n${sid}`, async () => {
    const obstojec = (await loadCalls(root))[sid];
    if (obstojec) return obstojec;
    const now = casObrata(input.now);
    const call = freshCall(sid, (input.from ?? "").slice(0, 40), now);
    call.stik = prazenStik(call.from);
    if (!call.order.phone && call.stik.telefon && call.stik.telefon === call.from) call.order = uveljaviStik(call.order, call.stik);
    // Kot pri Gather: ime je vprasano v pozdravu in ga pozneje ne vprasamo znova; naslednji izrek je odgovor nanj.
    call.korak = "ime";
    call.podjetjeVprasan = true;
    call.vprasano = ["ime"];
    call.transcript.push({ role: "lina", text: povzetekBrezPodatkov(input.pozdrav), at: now, ms: 0 });
    call.zadnjaLina = input.pozdrav.slice(0, 500);
    call.obrat = 1;
    await zapisiKnjigo(root, sid, call);
    return call;
  });
}

/** Zakljucen izrek klicatelja iz prepisa Live: zajem podatkov enako kot pot Gather, brez odgovora. */
export async function izrekKlicateljaLive(callSid: string, besedilo: string, dir?: string, now?: string): Promise<void> {
  const root = resolveDataDir(dir);
  const sid = callSid.trim();
  const text = besedilo.replace(/\s+/g, " ").trim().slice(0, MEJA_IZREKA_LIVE);
  if (!sid || !text) return;
  await vVrsti(vrsteSida, `${root}\n${sid}`, async () => {
    const call = (await loadCalls(root))[sid];
    if (!call || call.status === "zakljucen") return;
    const line = await loadLine(root);
    const pravila = await loadPravila(root);
    const cas = casObrata(now);
    const cakaIme = call.korak === "ime";
    const cakalPomoc = call.korak === "pomoc";
    call.stik = call.stik ?? prazenStik(call.from);
    const izloci = besedeKataloga(line);
    const kraji = [line.catalog.company.address];
    const vDnevnik = redigirajDnevnik(text, cakaIme, izloci, kraji);
    call.transcript.push({ role: "stranka", text: vDnevnik || "Podatek je v zapisniku.", at: cas });
    const prej = call.order;
    const prejStik = call.stik;
    const prejOsnutek = draftFromOrder(call.order);
    const draft = absorbUtterance(prejOsnutek, text, line.catalog, {});
    const guard = applyGuards(draft, line.catalog, { question: text, answer: "", inquiry: pravila.povprasevanje });
    call.order = {
      ...slipFromGuard(draft, guard, call.from),
      email: prej.email,
      oznaka: prej.oznaka,
      dosegljiv: prej.dosegljiv,
      podjetjeKlicatelja: prej.podjetjeKlicatelja,
      tajnica: prej.tajnica,
      povprasevanje: prej.povprasevanje,
      potrditevEposta: prej.potrditevEposta,
    };
    call.stik = dopolniStik(call.stik, text, call.from, { vprasan: cakaIme, izloci, kraji });
    if (!call.stik.telefon && prejStik.telefon && prejStik.telefon === call.from) call.order.phone = "";
    call.order = uveljaviStik(call.order, call.stik);
    const podjetje = zajemiPodjetje(text) ?? (cakaIme ? goloPodjetje(text, izloci, kraji) : null);
    if (podjetje !== null) call.order.podjetjeKlicatelja = podjetje;
    const cena = vprasaPoCeni(text);
    const vprasanje = jeVprasanje(text);
    const slovo = wantsHangup(text);
    const zav = jeZavrnitev(text);
    const doseg = zajemiDosegljivost(text, undefined, vprasanje || slovo ? "" : vDnevnik);
    if (doseg) call.order.dosegljiv = doseg;
    // Tajnica direktorja tudi na poti Live: nujnost in sporocilo doloci koda iz izreka klicatelja, ne model.
    const taj = zajemiTajnico(text, vDnevnik, prej.tajnica);
    if (taj) call.order.tajnica = taj;
    const novoNarocilo =
      draft.requestedProduct !== prejOsnutek.requestedProduct ||
      draft.requestedMaterial !== prejOsnutek.requestedMaterial ||
      draft.quantity !== prejOsnutek.quantity ||
      draft.notes !== prejOsnutek.notes;
    const zajeto =
      call.stik.ime !== prejStik.ime ||
      call.stik.telefon !== prejStik.telefon ||
      call.stik.email !== prejStik.email ||
      (draft.deadline ?? null) !== (prejOsnutek.deadline ?? null) ||
      Boolean(doseg) ||
      Boolean(taj?.sporocilo && taj.sporocilo !== prej.tajnica?.sporocilo) ||
      podjetje !== null;
    const besed = vDnevnik.split(/\s+/).filter(Boolean).length;
    if (!call.order.povprasevanje && !cakaIme && !cena && !vprasanje && !slovo && !zav.splosno) {
      if (novoNarocilo || (cakalPomoc && !zajeto && besed >= 3)) call.order.povprasevanje = vDnevnik.slice(0, 200);
    }
    if (cakaIme) {
      call.korak = "pomoc";
      if (call.order.podjetjeKlicatelja === undefined) call.order.podjetjeKlicatelja = "";
      if (!call.stik.ime) {
        call.stik.ime = t("niPodatka");
        call.order = uveljaviStik(call.order, call.stik);
      }
    }
    call.tisine = 0;
    call.updatedAt = cas;
    await zapisiKnjigo(root, sid, call);
    // Nujen klic na poti Live: obvestilo na osebni telefon enako kot na poti Gather (prevezave Live ne podpira).
    if (!call.vaja) sprozNujnoObvestilo(root, call, dodajNujniDogodek);
  });
}

const MEJA_IZREKA_LIVE = 2000;

/** Linin odgovor (prepis izhoda Live) v dnevnik klica. Besedilo je ze preverila varovalka; podatki klicatelja se ne zapisejo. */
export async function odgovorLinaLive(callSid: string, besedilo: string, dir?: string, now?: string): Promise<void> {
  const root = resolveDataDir(dir);
  const sid = callSid.trim();
  const text = besedilo.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!sid || !text) return;
  await vVrsti(vrsteSida, `${root}\n${sid}`, async () => {
    const call = (await loadCalls(root))[sid];
    if (!call || call.status === "zakljucen") return;
    const cas = casObrata(now);
    call.transcript.push({ role: "lina", text: povzetekBrezPodatkov(text), at: cas });
    call.zadnjaLina = text;
    call.updatedAt = cas;
    call.obrat = (call.obrat ?? 0) + 1;
    await zapisiKnjigo(root, sid, call);
  });
}

/**
 * Ura klica (lastnik 10. 11. 2026, uro vodi koda): opozorilo 30 s pred iztekom in slovo ob izteku. Ista funkcija kot pri
 * poti Gather (odzivCasa): opozorilo samo enkrat (in vprasa samo manjkajoce), slovo sele po opozorilu, oznaka »cas je potekel«.
 * Vrne besedilo, ki ga mora most izreci/vbrizgati, in ali je to konec klica. Null: ni treba nic.
 */
export async function casLive(callSid: string, faza: "opozorilo" | "potek", dir?: string): Promise<{ besedilo: string; konec: boolean } | null> {
  const root = resolveDataDir(dir);
  const sid = callSid.trim();
  return vVrsti(vrsteSida, `${root}\n${sid}`, async () => {
    const call = (await loadCalls(root))[sid];
    if (!call || call.status === "zakljucen") return null;
    const pravila = await loadPravila(root);
    const odziv = odzivCasa(call, faza, pravila);
    if (!odziv) return null;
    const now = new Date().toISOString();
    call.transcript.push({ role: "lina", text: povzetekBrezPodatkov(odziv.reply), at: now });
    call.updatedAt = now;
    if (odziv.konec) zakljuci(call, now, pravila.povprasevanje);
    await zapisiKnjigo(root, sid, call);
    return { besedilo: odziv.reply, konec: odziv.konec };
  });
}

/** Vprasanje, na katerega Lina ne sme odgovoriti sama (varovalka): v seznam »Manjka v znanju« kot pri poti Gather. */
export async function vrzelLive(vprasanje: string, dir?: string): Promise<void> {
  const root = resolveDataDir(dir);
  const text = redigirajDnevnik(vprasanje.replace(/\s+/g, " ").trim().slice(0, 300));
  if (!text) return;
  await zapomniVrzel(text, root).catch(() => undefined);
}

export type PoljaPovprasevanja = {
  ime?: string;
  podjetje?: string;
  telefon?: string;
  eposta?: string;
  izdelek?: string;
  rok?: string;
  povratniKlic?: string;
  sporocilo?: string;
  potrdil?: boolean;
};

/** Besede dolzine >= 3 brez locil in sumnikov; za preverbo, ali je model polje res slisal. */
function pomembneBesede(besedilo: string): string[] {
  return fold(besedilo)
    .split(/[^a-z0-9@]+/)
    .filter((beseda) => beseda.length >= 3);
}

/**
 * KODA POTRDI, kar poslje model s funkcijo zakljuci_povprasevanje (lastnik 11. 11. 2026: model ne zapisuje sam). Polje velja,
 * samo ce ga je klicatelj res povedal (vse pomembne besede polja so v prepisu klicatelja) in ima pravo obliko. Ostalo se
 * zavrne in v zapisu ostane to, kar je zajel absorbUtterance iz izrekov. Vrne imena sprejetih in zavrnjenih polj.
 */
export function potrdiPoljaLive(
  polja: PoljaPovprasevanja,
  izreki: readonly string[],
  from: string,
): { sprejeta: Partial<Record<keyof PoljaPovprasevanja, string>>; sprejeto: string[]; zavrnjeno: string[] } {
  const vse = izreki.join(" ");
  const besede = new Set(pomembneBesede(vse));
  const stevke = vse.replace(/\D/g, "");
  const crke = fold(vse).replace(/[^a-z0-9]/g, "");
  const sprejeta: Partial<Record<keyof PoljaPovprasevanja, string>> = {};
  const sprejeto: string[] = [];
  const zavrnjeno: string[] = [];
  const dodaj = (polje: keyof PoljaPovprasevanja, vrednost: string, veljavno: boolean) => {
    if (veljavno) {
      sprejeta[polje] = vrednost;
      sprejeto.push(polje);
    } else zavrnjeno.push(polje);
  };
  const besedilo = (v: unknown, najvec: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, najvec) : "");
  for (const [polje, najvec] of [["ime", 80], ["podjetje", 80], ["izdelek", 120], ["rok", 80], ["povratniKlic", 80], ["sporocilo", 200]] as const) {
    const v = besedilo(polja[polje], najvec);
    if (!v) continue;
    const delci = pomembneBesede(v);
    dodaj(polje, v, delci.length > 0 && delci.every((d) => besede.has(d)) && !razlogPolja(polje, v) );
  }
  const telefon = besedilo(polja.telefon, 40);
  if (telefon) {
    const cifre = telefon.replace(/\D/g, "");
    const izFrom = Boolean(from) && cifre === from.replace(/\D/g, "");
    dodaj("telefon", telefon, /^\+?[\d\s()./-]{6,40}$/.test(telefon) && cifre.length >= 6 && (izFrom || stevke.includes(cifre) || stevke.includes(cifre.replace(/^0+/, ""))));
  }
  const eposta = besedilo(polja.eposta, 120);
  if (eposta) {
    const m = /^([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)$/.exec(eposta);
    const lokalno = m ? fold(m[1]).replace(/[^a-z0-9]/g, "") : "";
    const domena = m ? fold(m[2]).replace(/[^a-z0-9]/g, "") : "";
    dodaj("eposta", eposta, Boolean(m) && crke.includes(lokalno) && crke.includes(domena));
  }
  if (typeof polja.potrdil === "boolean") sprejeta.potrdil = polja.potrdil ? "da" : "ne";
  // Mercury F: ce je TA izrek (zadnji obrat) oznacen kot vbrizg navodil, model v tem obratu ne more potrditi narocila (zmanjsane
  // pravice); polja, ki jih je klicatelj res povedal, ostanejo. M2 S3 (lastnik 15. 11. 2026): zaznava se lahko zmoti, zato en izrek
  // NIKOLI ne odvzame potrditve za cel klic (prej je lazni zadetek »Pozabil sem pravilne mere« odvzel potrdil vsem naslednjim
  // obratom). Klic ni zavrnjen, v dnevnik gredo samo imena vzorcev.
  const vbrizg = zaznajVbrizg(izreki[izreki.length - 1] ?? "");
  if (vbrizg.nezaupano && "potrdil" in sprejeta) {
    zabeleziVbrizg("klic-live", vbrizg.vzorci);
    delete sprejeta.potrdil;
  }
  return { sprejeta, sprejeto, zavrnjeno };
}

/** Zakljucek povprasevanja (funkcija zakljuci_povprasevanje): sprejeta polja gredo v zapis, kot bi jih zajela pot Gather. */
export async function povprasevanjeLive(
  callSid: string,
  polja: PoljaPovprasevanja,
  izreki: readonly string[],
  zadnjiIzrek: string,
  dir?: string,
): Promise<{ sprejeto: string[]; zavrnjeno: string[] }> {
  const root = resolveDataDir(dir);
  const sid = callSid.trim();
  return vVrsti(vrsteSida, `${root}\n${sid}`, async () => {
    const call = (await loadCalls(root))[sid];
    if (!call || call.status === "zakljucen") return { sprejeto: [], zavrnjeno: ["klic"] };
    const line = await loadLine(root);
    const pravila = await loadPravila(root);
    const { sprejeta, sprejeto, zavrnjeno } = potrdiPoljaLive(polja, izreki, call.from);
    call.stik = call.stik ?? prazenStik(call.from);
    const ni = [t("niDan"), t("niPodatka"), ""];
    if (sprejeta.ime && ni.includes(call.stik.ime)) call.stik.ime = sprejeta.ime;
    if (sprejeta.telefon && (!call.stik.telefon || call.stik.telefon === call.from)) call.stik.telefon = sprejeta.telefon;
    if (sprejeta.eposta && !call.stik.email) call.stik.email = sprejeta.eposta;
    call.order = uveljaviStik(call.order, call.stik);
    if (sprejeta.podjetje && !call.order.podjetjeKlicatelja) call.order.podjetjeKlicatelja = sprejeta.podjetje;
    if (sprejeta.rok && !call.order.deadline) call.order.deadline = sprejeta.rok;
    if (sprejeta.povratniKlic && !call.order.dosegljiv) call.order.dosegljiv = sprejeta.povratniKlic;
    if (sprejeta.sporocilo && !call.order.povprasevanje) call.order.povprasevanje = redigirajDnevnik(sprejeta.sporocilo).slice(0, 200);
    if (sprejeta.sporocilo) {
      const prejT = call.order.tajnica;
      const novo = ocistiSporocilo(redigirajDnevnik(sprejeta.sporocilo)).slice(0, 300);
      if (novo && !prejT?.sporocilo) {
        call.order.tajnica = { sporocilo: novo, razlog: prejT?.razlog ?? "", nujno: prejT?.nujno ?? false, nujnostZnana: prejT?.nujnostZnana ?? false };
      }
    }
    if (sprejeta.izdelek) {
      if (!call.order.requestedProduct && !call.order.productName) call.order.requestedProduct = sprejeta.izdelek;
      if (!call.order.povprasevanje) call.order.povprasevanje = redigirajDnevnik(sprejeta.izdelek).slice(0, 200);
    }
    // Potrditev velja samo, ce je model oznacil potrditev IN je klicateljev zadnji izrek res »da«/»potrjujem« (koda, ne model).
    const potrditev = sprejeta.potrdil === "da" && odgovorNaPotrditev(zadnjiIzrek) === "da" && !jeSignalPopravka(zadnjiIzrek);
    if (potrditev) {
      const draft = { ...draftFromOrder(call.order), confirmAsked: true };
      const guard = applyGuards(draft, line.catalog, { question: "", answer: "", inquiry: pravila.povprasevanje });
      const prej = call.order;
      call.order = {
        ...slipFromGuard(draft, guard, call.from),
        email: prej.email,
        oznaka: prej.oznaka,
        dosegljiv: prej.dosegljiv,
        podjetjeKlicatelja: prej.podjetjeKlicatelja,
        tajnica: prej.tajnica,
        povprasevanje: prej.povprasevanje,
        potrditevEposta: prej.potrditevEposta,
      };
    }
    call.stik = zapriStik(call.stik);
    call.order = uveljaviStik(call.order, call.stik);
    call.updatedAt = new Date().toISOString();
    await zapisiKnjigo(root, sid, call);
    return { sprejeto, zavrnjeno };
  });
}
