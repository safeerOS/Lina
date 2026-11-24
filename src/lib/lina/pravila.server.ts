import { uskladiDodatke } from "./dodatki.server.ts";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireOwner } from "./auth.server.ts";
import {
  konecJePrazen,
  konecNeobstojec,
  konecNerazumljiv,
  konecVMs,
  normirajDo,
  normirajRazlog,
  ODSOTNOST_NAJVEC_NAPREJ_MS,
  preveriPas,
  razlogOdsotnosti,
} from "./odsotnost.ts";
import { absorbUtterance, draftFromOrder, emptyDraft, slipFromGuard } from "./brain.ts";
import { defaultLine } from "./catalog.ts";
import { t } from "./besedila.ts";
import { zazeniNamestitevSlovenskega } from "./slovenski-modul.server.ts";
import { uskladiRsdo } from "./rsdo-streznik.server.ts";
import { applyGuards, fold, istaStevilka, vprasaPoCeni } from "./guards.ts";
import { jePrepovedanaStevilka, razlogPolja, razlogTeme, vE164 } from "./plast.ts";
import { jePremiumAliKratka } from "./preusmeritev.ts";
import { jedroOdgovora, sestaviOdgovor } from "./govor.ts";
import { polishReply } from "./llm.server.ts";
import { jeVeljavenEnaslov } from "./eposta.ts";
import { TISINA_NAJMANJ_SEK, TISINA_NAJVEC_SEK, TISINA_OSEBNA_PRIVZETO_SEK, TISINA_PRIVZETO_SEK, tisinaIzNastavitve } from "./tisina.ts";
import { stalniStavki } from "./glas.ts";
import { pripraviStalneVOzadju } from "./glas.server.ts";
import { povzetekKlica, type Povzetek } from "./povzetek.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";
import { preveriMapoZapiskov } from "./zapiski-mapa.server.ts";
import { odgovorTemeLastnika } from "./teme.ts";
import type { CallSession, Catalog, LineState, Pravila, Vrzel, Zapisek } from "./types.ts";
import { CAKANJE_PRIVZETO_SEK, cakanjePredPrevzemom } from "./ure.ts";
import { normirajHints, veljavenGovorModel } from "./govor-model.ts";
import type { NacinPrevzema } from "./ure.ts";
import { ureSoRazumljive } from "./ure.ts";
import { normirajUrnik, razberiProsteDneve, razlogUrnika, URNIK_NAJVEC_ZNAKOV } from "./urnik.ts";
import { normirajPaket, normirajPaketDo, paketDoNeveljaven, razlogPaketa } from "./paket.ts";
import { besediloVrzel } from "./znanje.ts";

export type { Pravila, Vrzel };

const NACINI = new Set<NacinPrevzema>(["vsi", "neodgovorjeni", "izven"]);

/** Koliko odprtih vrzeli hranimo. Obdelane se ne stejejo v mejo. */
export const MEJA_ODPRTIH_VRZELI = 100;
export const MEJA_ZAPISKOV = 100;

/**
 * Privzeti potek podjetja je kratek zakljucek (lastnik 14. 11. 2026). Podroben potek (G4g) je nastavitev; spremenljivka
 * LINA_PODROBNI_POTEK=1 ga vklopi kot privzetega (stari preizkusi poteka zbiranja podatkov).
 */
const PRIVZETO_PODROBNO = process.env.LINA_PODROBNI_POTEK === "1";

/** Privzeto: samo neodgovorjeni po 28 sekundah in sporocilo po povprasevanju. */
export function defaultPravila(): Pravila {
  return {
    povprasevanje: t("povprasevanje"),
    prevzem: "neodgovorjeni",
    cakanjeSekund: CAKANJE_PRIVZETO_SEK,
    pozdrav: "",
    preusmeritev: "",
    dovoljenePredpone: "",
    javniNaslov: "",
    garancijaVklop: false,
    garancijaBesedilo: "",
    dostavaVklop: false,
    dostavaBesedilo: "",
    rokVklop: false,
    rokBesedilo: "",
    temaOdgovor: t("temaPrivzeto"),
    slog: "prijazno",
    navodila: "",
    najdaljsiPogovorMinut: null,
    tisinaPoGovoruSek: TISINA_PRIVZETO_SEK,
    potrditevEposta: false,
    toplePovezave: true,
    prevezaNaZahtevo: true,
    prevezavaUrnikVklop: true,
    prevezavaUrnik: "",
    prevezavaProstiDnevi: "",
    urnikObvestilo: false,
    paketNavodilo: "",
    paketDo: "",
    potrditevNaslov: "",
    // Lastnik 22. 11. 2026: snemanje v nacinu podjetje privzeto vklopljeno (s stikalom); osebni nacin nikoli ne snema.
    snemanjeVklop: true,
    snemanjeZavrnitev: false,
    snemanjeHrambaDni: HRAMBA_PRIVZETO_DNI,
    zapiskiHrambaDni: ZAPISKI_HRAMBA_PRIVZETO_DNI,
    nacinKlica: "podjetje",
    imeLastnika: "",
    imeLastnikaTozilnik: "",
    odsotnostVklop: false,
    odsotnostRazlog: "",
    odsotnostDo: "",
    odsotnostCasovniPas: "",
    govorModel: "",
    hintsGovor: "",
    rsdoNamig: true,
    dodatki: { paperclip: false, n8n: false, affine: false, programi: false, slovenski: false },
    podrobniPotek: PRIVZETO_PODROBNO,
    mapaZapiskov: "",
    naPot: "gather",
    sonioxVklop: false,
  };
}

/** Hramba posnetka klica (lastnik 22. 11. 2026, »Se strinjam z predlogom«): privzeto 30 dni, nastavljivo 1 do 90 (prej 7, najvec 30). */
export const HRAMBA_PRIVZETO_DNI = 30;
export const HRAMBA_NAJVEC_DNI = 90;
/** Hramba zapiska klica v nacinu podjetje (lastnik 22. 11. 2026): 90 dni, nastavljivo 1 do 3650. Osebni zapiski se ne brisejo sami. */
export const ZAPISKI_HRAMBA_PRIVZETO_DNI = 90;
export const ZAPISKI_HRAMBA_NAJVEC_DNI = 3650;

function dniHrambe(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 1) return HRAMBA_PRIVZETO_DNI;
  return Math.min(HRAMBA_NAJVEC_DNI, Math.round(n));
}

function dniHrambeZapiskov(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 1) return ZAPISKI_HRAMBA_PRIVZETO_DNI;
  return Math.min(ZAPISKI_HRAMBA_NAJVEC_DNI, Math.round(n));
}

/**
 * Snemanje klicev je na voljo (lastnik 22. 11. 2026): Twilio Recordings na klicu, prenos v mapo klica, izbris pri Twiliu
 * (snemanje.server.ts). Snema se samo v nacinu podjetje; prej (do 0.2.2) je bilo stikalo zaklenjeno.
 */
export const SNEMANJE_NA_VOLJO = true;

function clampSeconds(value: unknown): number {
  return cakanjePredPrevzemom(value);
}

function stevilkaBesedilo(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 48);
}

function minutePogovora(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(180, Math.round(n));
}

function jeObjekt(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

async function preberiSurovaPravila(dir: string): Promise<{ obstaja: boolean; vrednost: unknown }> {
  let raw: string;
  try {
    raw = await readFile(path.join(dir, "pravila.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { obstaja: false, vrednost: null };
    throw error;
  }
  return { obstaja: true, vrednost: JSON.parse(raw) };
}

export function normalizePravila(raw: Partial<Pravila> | null): Pravila {
  const base = defaultPravila();
  if (!jeObjekt(raw)) return base;
  const pasPreverba = preveriPas(raw.odsotnostCasovniPas);
  const odsotnostCasovniPas =
    raw.odsotnostCasovniPas === undefined || raw.odsotnostCasovniPas === null
      ? ""
      : typeof raw.odsotnostCasovniPas === "string"
        ? pasPreverba.veljaven
          ? raw.odsotnostCasovniPas.trim()
            ? pasPreverba.pas
            : ""
          : raw.odsotnostCasovniPas.trim().slice(0, 80)
        : String(raw.odsotnostCasovniPas).slice(0, 80);
  const odsotnostRazlog = typeof raw.odsotnostRazlog === "string" ? normirajRazlog(raw.odsotnostRazlog) : "";
  const razlogSlab =
    (raw.odsotnostRazlog !== undefined && raw.odsotnostRazlog !== null && typeof raw.odsotnostRazlog !== "string") ||
    razlogOdsotnosti(odsotnostRazlog) !== null;
  const konecSlab = !konecJePrazen(raw.odsotnostDo) && (!pasPreverba.veljaven || konecNerazumljiv(raw.odsotnostDo, pasPreverba.pas));
  const odsotnostDo = konecJePrazen(raw.odsotnostDo)
    ? ""
    : !konecSlab
      ? normirajDo(raw.odsotnostDo, pasPreverba.pas)
      : typeof raw.odsotnostDo === "string"
        ? raw.odsotnostDo.trim().slice(0, 80)
        : "";
  const odsotnostVklop = raw.odsotnostVklop === true && pasPreverba.veljaven && !razlogSlab && !konecSlab;
  const prevzem = NACINI.has(raw.prevzem as NacinPrevzema) ? (raw.prevzem as NacinPrevzema) : base.prevzem;
  const povprasevanje = typeof raw.povprasevanje === "string" && raw.povprasevanje.trim()
    ? raw.povprasevanje.trim().slice(0, 500)
    : base.povprasevanje;
  const pozdrav = typeof raw.pozdrav === "string" ? raw.pozdrav.replace(t("obvezniPozdrav"), "").replace(t("pozdravZapis"), "").trim().slice(0, 400) : "";
  const preusmeritev = stevilkaBesedilo(raw.preusmeritev ?? base.preusmeritev);
  const dovoljenePredpone = typeof raw.dovoljenePredpone === "string" ? raw.dovoljenePredpone.trim().slice(0, 80) : "";
  const javniNaslov = typeof raw.javniNaslov === "string" ? raw.javniNaslov.trim().slice(0, 200) : "";
  const garancijaBesedilo = typeof raw.garancijaBesedilo === "string" ? raw.garancijaBesedilo.trim().slice(0, 400) : base.garancijaBesedilo;
  const dostavaBesedilo = typeof raw.dostavaBesedilo === "string" ? raw.dostavaBesedilo.trim().slice(0, 400) : base.dostavaBesedilo;
  const temaOdgovor = typeof raw.temaOdgovor === "string" && raw.temaOdgovor.trim()
    ? raw.temaOdgovor.trim().slice(0, 500)
    : base.temaOdgovor;
  const potrditevNaslov = typeof raw.potrditevNaslov === "string" ? raw.potrditevNaslov.trim().toLowerCase().slice(0, 120) : "";
  return {
    povprasevanje,
    prevzem,
    cakanjeSekund: clampSeconds(raw.cakanjeSekund ?? base.cakanjeSekund),
    pozdrav,
    preusmeritev,
    dovoljenePredpone,
    javniNaslov,
    garancijaVklop: Boolean(raw.garancijaVklop),
    garancijaBesedilo,
    dostavaVklop: Boolean(raw.dostavaVklop),
    dostavaBesedilo,
    rokVklop: false,
    rokBesedilo: "",
    temaOdgovor,
    slog: raw.slog === "uradno" ? "uradno" : "prijazno",
    navodila: typeof raw.navodila === "string" ? raw.navodila.trim().slice(0, 1500) : "",
    najdaljsiPogovorMinut: minutePogovora(raw.najdaljsiPogovorMinut ?? base.najdaljsiPogovorMinut),
    // Osebna tajnica (17. 11. 2026): privzeto 2 s; tudi shranjena stara privzeta 3 brez tisinaNastavil preide na novi privzeti 2.
    // Kar je uporabnik nastavil izrecno (tisinaNastavil: true), ostane. Privzetek se NE zapise na disk (glej savePravila).
    tisinaPoGovoruSek:
      raw.nacinKlica === "osebna" && (!raw.tisinaNastavil || (raw.tisinaPoGovoruSek === 3 && raw.tisinaNastavil !== true))
        ? TISINA_OSEBNA_PRIVZETO_SEK
        : tisinaIzNastavitve(raw.tisinaPoGovoruSek ?? base.tisinaPoGovoruSek),
    tisinaNastavil: Boolean(raw.tisinaNastavil),
    // Brez veljavnega naslova je moznost izklopljena, tudi ce je datoteka rocno popravljena.
    // Lastnik 22. 11. 2026: »Za podjetja more Lina se prositi, da klicatelj poslje narocilo na elektronsko posto, ki jo podjetje vnese«
    // (spremeni G4g »brez e-poste«): vpisan veljaven naslov prosnjo vklopi, izklopi jo samo izrecen false.
    potrditevEposta: raw.potrditevEposta !== false && jeVeljavenEnaslov(potrditevNaslov),
    potrditevNaslov,
    // Privzeto vklopljeno (odlocitev vodje 12. 11. 2026); samo izrecen false ga izklopi.
    toplePovezave: raw.toplePovezave !== false,
    // Ideja lastnika (23. 11. 2026) = privzeto vklopljeno; samo izrecen false izklopi. Velja v obeh nacinih.
    prevezaNaZahtevo: raw.prevezaNaZahtevo !== false,
    // Delovni cas prevezave (lastnik 23. 11. 2026): privzeto vklopljeno; nerazumljiv urnik ostane zapisan (vmesnik ga pokaze), velja kot »nikoli« (urnik.ts).
    prevezavaUrnikVklop: raw.prevezavaUrnikVklop !== false,
    prevezavaUrnik: normirajUrnik(raw.prevezavaUrnik).slice(0, URNIK_NAJVEC_ZNAKOV),
    prevezavaProstiDnevi: razberiProsteDneve(raw.prevezavaProstiDnevi).dnevi.join(", "),
    // Namestitev iz izdaje pred urnikom (ni ne stikala ne oznake): obvestilo caka na potrditev (pregled 0.2.10, najdba 3).
    urnikObvestilo: raw.urnikObvestilo === true || (jeStaraNamestitev(raw) && raw.urnikObvestilo === undefined),
    // Navodilo za dostavo paketa (osebna tajnica): pove ga samo paket.ts klicatelju, ki se predstavi kot dostava.
    paketNavodilo: normirajPaket(raw.paketNavodilo),
    paketDo: normirajPaketDo(raw.paketDo),
    merjenjeDelnih: raw.merjenjeDelnih === true,
    izrazeKatalogaIzklop: raw.izrazeKatalogaIzklop === true,
    // Privzeto vklopljeno (ideja lastnika = privzeto vklop, s stikalom); samo izrecen false izklopi. Osebni nacin: vedno izklopljeno.
    snemanjeVklop: SNEMANJE_NA_VOLJO && raw.nacinKlica !== "osebna" && raw.snemanjeVklop !== false,
    snemanjeZavrnitev: Boolean(raw.snemanjeZavrnitev),
    snemanjeHrambaDni: dniHrambe(raw.snemanjeHrambaDni),
    zapiskiHrambaDni: dniHrambeZapiskov(raw.zapiskiHrambaDni),
    mapaZapiskov: typeof raw.mapaZapiskov === "string" ? raw.mapaZapiskov.trim().slice(0, 500) : "",
    // Nepoznana vrednost velja kot privzeta pot: nova pot se vklopi samo z izrecnim »live«.
    // Osebna tajnica gre vedno po poti Gather: Live model bi iz kataloga razlagal izdelke.
    naPot: raw.naPot === "live" && raw.nacinKlica !== "osebna" ? "live" : "gather",
    nacinKlica: raw.nacinKlica === "osebna" ? "osebna" : "podjetje",
    govorModel: veljavenGovorModel(raw.govorModel),
    hintsGovor: veljavenGovorModel(raw.govorModel) ? normirajHints(raw.hintsGovor) : "",
    // Privzeto vklopljeno (lastnik 19. 11. 2026); samo izrecen false izklopi, ostalo je privzeto.
    rsdoNamig: raw.rsdoNamig === false ? false : true,
    // Dodatki: samo izrecen true vklopi (privzeto izklopljeno, lastnik 19. 11. 2026); nepoznana vrednost = izklop.
    dodatki: {
      paperclip: raw.dodatki?.paperclip === true,
      n8n: raw.dodatki?.n8n === true,
      affine: raw.dodatki?.affine === true,
      programi: raw.dodatki?.programi === true,
      slovenski: raw.dodatki?.slovenski === true,
    },
    podrobniPotek: typeof raw.podrobniPotek === "boolean" ? raw.podrobniPotek : PRIVZETO_PODROBNO,
    imeLastnika: typeof raw.imeLastnika === "string" ? raw.imeLastnika.replace(/\s+/g, " ").trim().slice(0, 60) : "",
    imeLastnikaTozilnik: typeof raw.imeLastnikaTozilnik === "string" ? raw.imeLastnikaTozilnik.replace(/\s+/g, " ").trim().slice(0, 60) : "",
    odsotnostVklop,
    odsotnostRazlog,
    odsotnostDo,
    odsotnostCasovniPas,
    sonioxVklop: raw.sonioxVklop === true,
  };
}

export type ShranjenaPravila = Pravila & { opozorila: string[] };

/** pravila.json iz izdaje pred urnikom prevezave: datoteka obstaja (ima vsaj prevzem), kljuca prevezavaUrnikVklop pa ni. */
function jeStaraNamestitev(raw: Partial<Pravila>): boolean {
  return Object.keys(raw).length > 0 && !("prevezavaUrnikVklop" in raw);
}

export async function loadPravila(dir?: string): Promise<Pravila> {
  const saved = await readJsonFile<Partial<Pravila>>(resolveDataDir(dir), "pravila.json");
  return normalizePravila(saved);
}

/**
 * Navodila lastnika s telefona (sinhronizacija, 20. 11. 2026). Klic je ze preverjen s podpisom seznanjene naprave, zato zetona
 * lastnika ne zahteva; spremeni se SAMO polje navodila, z isto preverbo kot pri shranjevanju. Vrne true, ce se je besedilo spremenilo.
 */
export async function nastaviNavodilaIzTelefona(besedilo: string, dir?: string): Promise<boolean> {
  const root = resolveDataDir(dir);
  const novo = besedilo.trim().slice(0, 1500);
  const razlog = razlogPolja("navodila", novo);
  if (razlog) return false;
  return vVrstiPravil(root, async () => {
    const prej = await loadPravila(root);
    // Veljavna, a nespremenjena navodila: uspeh brez prepisa pravila.json (klicatelj si zapomni revizijo).
    if (prej.navodila !== novo) await writeJson(root, "pravila.json", normalizePravila({ ...prej, navodila: novo }));
    return true;
  });
}

/** Kaj se zgodi po zapisu spremenjenih stikal dodatkov; preizkusi podajo svoje (pravi Docker, namestitev in RSDO se ne zazenejo). */
export type UskladitevDodatkov = {
  namestiSlovenskega: (obKoncu: (uspeh: boolean) => void) => void;
  uskladiRsdo: (vklop: boolean) => Promise<unknown>;
  uskladiDodatke: (dodatki: Pravila["dodatki"]) => Promise<unknown>;
};

/** Isti potek za namizje (savePravila) in telefon (nastaviDodatekIzTelefona); klice se SAMO po zapisu pravila.json. */
export function poSpremembiDodatkov(prej: Pravila, next: Pravila, root: string, u?: UskladitevDodatkov): void {
  // Brez podanih odvisnosti preizkusi (node --test nastavi NODE_TEST_CONTEXT) pravega Dockerja in namestitve ne dosezejo:
  // 23. 11. 2026 je preizkus, ki shrani zacasna pravila, ustavil in odstranil lastnikova tekoca vsebnika.
  const vPreizkusu = !u && !!process.env.NODE_TEST_CONTEXT;
  const x: UskladitevDodatkov = u ?? {
    namestiSlovenskega: (obKoncu) => { zazeniNamestitevSlovenskega(undefined, obKoncu); },
    uskladiRsdo: (vklop) => uskladiRsdo(vklop),
    uskladiDodatke: (d) => uskladiDodatke(d),
  };
  // Slovenski pomocnik za razumevanje (RSDO, samo zapisuje, ne govori): namestitev SAMO po izrecnem vklopu (uporabnik je prebral pojasnilo v Dodatkih), enkrat ob preklopu false -> true.
  if (next.dodatki?.slovenski === true && prej.dodatki?.slovenski !== true && !vPreizkusu) {
    x.namestiSlovenskega((uspeh) => void poNamestitviSlovenskega(uspeh, root).catch(() => {}));
  }
  // Stalni proces RSDO (lastnik 23. 11. 2026): nalozi se ob vklopu, ustavi SAMO ob izklopu stikala (ali koncu Line).
  // Pravega RSDO v preizkusih ne zazene privzeti ukaz sam (rsdo-streznik.server.ts, NODE_TEST_CONTEXT).
  if ((next.dodatki?.slovenski === true) !== (prej.dodatki?.slovenski === true)) {
    void x.uskladiRsdo(next.dodatki?.slovenski === true).catch(() => {});
  }
  // Paperclip, n8n, AFFiNE: vklop zazene dodatek (samo 127.0.0.1, telemetrija izklopljena), izklop ga ustavi; v ozadju, napaka ne podre shranjevanja.
  const spremembaDodatkov = (["paperclip", "n8n", "affine"] as const).some((k) => (next.dodatki?.[k] === true) !== (prej.dodatki?.[k] === true));
  if (spremembaDodatkov && !vPreizkusu) void x.uskladiDodatke(next.dodatki).catch(() => {});
}

/**
 * Vsi zapisi pravila.json (namizje savePravila, telefon: dodatki in navodila) tecejo v ISTI vrsti na koren (drugi pregled 0.2.10, CodeRabbit
 * in N1): branje in zapis sta v isti operaciji, zato zastarelo branje ene poti ne povozi spremembe druge.
 */
const vrstePravil = new Map<string, Promise<unknown>>();
/** Vsak pisec pravila.json (tudi zapiski.server.ts in tunel.server.ts) bere in pise v tej vrsti. */
export function vVrstiPravil<T>(root: string, delo: () => Promise<T>): Promise<T> {
  const prej = vrstePravil.get(root) ?? Promise.resolve();
  const zdaj = prej.then(delo, delo);
  const rep = zdaj.catch(() => undefined);
  vrstePravil.set(root, rep);
  void rep.then(() => {
    if (vrstePravil.get(root) === rep) vrstePravil.delete(root);
  });
  return zdaj;
}

/**
 * Vklop ali izklop enega dodatka s telefona ozjega kroga (lastnik 23. 11. 2026). Klic je ze preverjen s podpisom naprave, zato zetona
 * lastnika ne zahteva. Na disku se spremeni SAMO to stikalo; nato isti potek kot savePravila (uskladitev, namestitev slovenskega samo
 * ob false -> true). Zapisi so zaporedni, da dva hkratna preklopa ne izgubita drug drugega.
 */
// Pot klica uvaza ta modul, zato tip ni uvozen iz kanal-claude.ts (preizkus 4.4: pot tajnice ne doseze modulov asistentke).
export function nastaviDodatekIzTelefona(dodatek: "paperclip" | "n8n" | "affine" | "slovenski", vklop: boolean, dir?: string, u?: UskladitevDodatkov): Promise<void> {
  const root = resolveDataDir(dir);
  return vVrstiPravil(root, async () => {
    const naDisku = await preberiSurovaPravila(root);
    if (naDisku.obstaja && !jeObjekt(naDisku.vrednost)) throw new Error(t("pravilaDatotekaPoskodovana"));
    const surova = (naDisku.vrednost ?? {}) as Record<string, unknown>;
    const prej = normalizePravila(surova as Partial<Pravila>);
    if ((prej.dodatki?.[dodatek] === true) === vklop) return;
    const surovi = jeObjekt(surova.dodatki) ? surova.dodatki : {};
    await writeJson(root, "pravila.json", { ...surova, dodatki: { ...surovi, [dodatek]: vklop } });
    poSpremembiDodatkov(prej, normalizePravila({ ...prej, dodatki: { ...prej.dodatki, [dodatek]: vklop } } as Partial<Pravila>), root, u);
  });
}

export async function savePravila(input: Partial<Pravila>, token: string | null, dir?: string): Promise<ShranjenaPravila> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (!jeObjekt(input)) throw new Error(t("pravilaVnosOblika"));
  return vVrstiPravil(root, () => shraniPravila(input, root));
}

/** Branje, preverba in zapis pravila.json; samo v vrsti vVrstiPravil (savePravila). */
async function shraniPravila(input: Partial<Pravila>, root: string): Promise<ShranjenaPravila> {
  const preveriTip = (polje: string, vrednost: unknown, vrsta: "boolean" | "string") => {
    if (vrednost !== undefined && typeof vrednost !== vrsta) {
      throw new Error(t("pravilaVnosTip").replace("{polje}", () => polje));
    }
  };
  preveriTip("odsotnostVklop", input.odsotnostVklop, "boolean");
  preveriTip("odsotnostRazlog", input.odsotnostRazlog, "string");
  preveriTip("odsotnostDo", input.odsotnostDo, "string");
  preveriTip("odsotnostCasovniPas", input.odsotnostCasovniPas, "string");
  preveriTip("imeLastnika", input.imeLastnika, "string");
  preveriTip("imeLastnikaTozilnik", input.imeLastnikaTozilnik, "string");
  preveriTip("sonioxVklop", input.sonioxVklop, "boolean");
  preveriTip("prevezaNaZahtevo", input.prevezaNaZahtevo, "boolean");
  preveriTip("prevezavaUrnikVklop", input.prevezavaUrnikVklop, "boolean");
  preveriTip("prevezavaUrnik", input.prevezavaUrnik, "string");
  preveriTip("prevezavaProstiDnevi", input.prevezavaProstiDnevi, "string");
  preveriTip("urnikObvestilo", input.urnikObvestilo, "boolean");
  preveriTip("paketNavodilo", input.paketNavodilo, "string");
  preveriTip("paketDo", input.paketDo, "string");
  const naDisku = await preberiSurovaPravila(root);
  if (naDisku.obstaja && !jeObjekt(naDisku.vrednost)) throw new Error(t("pravilaDatotekaPoskodovana"));
  const prej = normalizePravila(naDisku.vrednost as Partial<Pravila> | null);
  const merged = { ...prej, ...input };
  // Dodatki po kljucih (pregled 0225 B3): namizje poslje samo spremenjene, preklop s telefona na disku ostane.
  if (jeObjekt(input.dodatki)) merged.dodatki = { ...prej.dodatki, ...input.dodatki };
  let odsotnostPretekla = false;
  if (merged.odsotnostVklop === true) {
    const pasPreverba = preveriPas(merged.odsotnostCasovniPas);
    if (!pasPreverba.veljaven) throw new Error(t("odsotnostPasNeveljaven"));
    if (razlogOdsotnosti(merged.odsotnostRazlog)) throw new Error(t("odsotnostRazlogShranjenNeveljaven"));
    if (!konecJePrazen(merged.odsotnostDo)) {
      if (konecNeobstojec(merged.odsotnostDo, pasPreverba.pas)) throw new Error(t("odsotnostDoNeobstojec"));
      const konecMs = konecVMs(merged.odsotnostDo, pasPreverba.pas);
      if (konecMs === null) throw new Error(t("odsotnostDoNeveljaven"));
      const zdajMs = Date.now();
      if (konecMs - zdajMs > ODSOTNOST_NAJVEC_NAPREJ_MS) throw new Error(t("odsotnostDoPredaleko"));
      if (konecMs <= zdajMs) odsotnostPretekla = true;
    }
  }
  // Izpeljana privzeta tisina osebnega nacina ni lastnikova: ob shranjevanju (tudi preklopu nacina) se ne prenese naprej.
  if (prej.nacinKlica === "osebna" && !prej.tisinaNastavil && input.tisinaPoGovoruSek === undefined) merged.tisinaPoGovoruSek = TISINA_PRIVZETO_SEK;
  // G4g (lastnik 11. 11. 2026): vpis veljavnega naslova podjetja je zelja, da ga Lina izgovori. Prvi veljavni vpis vklopi
  // izgovor, ce klicatelj nastavitev ne poda sam; stikalo za izklop ostane (izrecen false ostane false).
  if (input.potrditevNaslov !== undefined && input.potrditevEposta === undefined) {
    const novNaslov = input.potrditevNaslov.trim();
    if (jeVeljavenEnaslov(novNaslov) && !jeVeljavenEnaslov(prej.potrditevNaslov)) merged.potrditevEposta = true;
  }
  const razlogSporocila = razlogPolja("sporocilo", merged.povprasevanje ?? "");
  if (razlogSporocila) throw new Error(razlogSporocila);
  const razlogPozdrava = razlogPolja("pozdrav", merged.pozdrav ?? "");
  if (razlogPozdrava) throw new Error(razlogPozdrava);
  const razlogGarancije = razlogPolja("garancija", merged.garancijaBesedilo ?? "");
  if (razlogGarancije) throw new Error(razlogGarancije);
  const razlogDostave = razlogPolja("dostava", merged.dostavaBesedilo ?? "");
  if (razlogDostave) throw new Error(razlogDostave);
  const razlogNavodil = razlogPolja("navodila", merged.navodila ?? "");
  if (razlogNavodil) throw new Error(razlogNavodil);
  // Urnik prevezave in prosti dnevi: napacen vnos zavrnemo z razlago, ne popravimo tiho.
  // Ista preverba kot v klicu (urnik.ts razlogUrnika, najdba 14); prosti dnevi nad mejo se zavrnejo, ne zavrzejo tiho (najdba 8).
  if (razlogUrnika(merged.prevezavaUrnik)) throw new Error(t("prevezavaUrnikNeveljaven"));
  const prosti = razberiProsteDneve(merged.prevezavaProstiDnevi);
  if (prosti.napacni.length > 0) throw new Error(t("prevezavaProstiNeveljavni"));
  if (prosti.prevec) throw new Error(t("prevezavaProstiPrevec"));
  // Samo ob spremembi (pregled 0.2.10): prej shranjeno navodilo, ki ga strozja preverba zdaj zavrne, se v klicu ne pove (aktivnoNavodiloPaketa)
  // in ne sme podreti shranjevanja drugih nastavitev.
  const razlogNavodilaPaketa = normirajPaket(merged.paketNavodilo) !== prej.paketNavodilo ? razlogPaketa(merged.paketNavodilo) : null;
  if (razlogNavodilaPaketa) throw new Error(razlogNavodilaPaketa);
  if (paketDoNeveljaven(merged.paketDo)) throw new Error(t("paketDoNeveljaven"));
  const razlogTemeOdgovora = razlogPolja("tema", merged.temaOdgovor ?? "");
  if (razlogTemeOdgovora) throw new Error(razlogTemeOdgovora);
  // Vklop brez veljavnega naslova zavrnemo z razlago, ne tiho (lastnik 10. 11. 2026).
  const naslovPotrditve = typeof merged.potrditevNaslov === "string" ? merged.potrditevNaslov.trim() : "";
  if (naslovPotrditve && !jeVeljavenEnaslov(naslovPotrditve)) throw new Error(t("potrditevNeveljaven"));
  if (merged.potrditevEposta && !jeVeljavenEnaslov(naslovPotrditve)) throw new Error(t("potrditevNeveljaven"));
  const staraNeizrecna3 = input.tisinaNastavil === false && Number(input.tisinaPoGovoruSek) === 3 && !prej.tisinaNastavil;
  if (staraNeizrecna3) merged.tisinaPoGovoruSek = TISINA_OSEBNA_PRIVZETO_SEK;
  else if (input.tisinaPoGovoruSek !== undefined && Number(input.tisinaPoGovoruSek) !== prej.tisinaPoGovoruSek) merged.tisinaNastavil = true;
  // Tisina po govoru: samo celo stevilo v mejah; napacen vnos zavrnemo z razlago, ne popravimo tiho.
  if (input.tisinaPoGovoruSek !== undefined) {
    const tisina = Number(input.tisinaPoGovoruSek);
    if (!Number.isInteger(tisina) || tisina < TISINA_NAJMANJ_SEK || tisina > TISINA_NAJVEC_SEK) throw new Error(t("tisinaMeje"));
  }
  // Mapa zapiskov (G5): preverimo samo, ce jo uporabnik spreminja (nepovezan shranjen vnos ne sme podreti shranjevanja drugih pravil).
  if (input.mapaZapiskov !== undefined && input.mapaZapiskov !== prej.mapaZapiskov) {
    const mapa = await preveriMapoZapiskov(input.mapaZapiskov, root, { ustvari: true });
    if (!mapa.ok) throw new Error(mapa.razlog);
    merged.mapaZapiskov = mapa.jePrivzeta ? "" : mapa.mapa;
  }
  // Osebni nacin ne snema: normalizePravila snemanjeVklop v osebnem nacinu vedno izklopi (UI poslje cele nastavitve tudi ob preklopu nacina,
  // zato tu ni zavrnitve, ki bi preprecila preklop). V UI je stikalo v osebnem nacinu skrito.
  const next = normalizePravila(merged);
  const line = await readJsonFile<LineState>(root, "line.json");
  const javna = line?.catalog?.company?.phone ?? "";
  if (next.preusmeritev) {
    if (jePrepovedanaStevilka(next.preusmeritev)) throw new Error(t("preusmeritevNujna"));
    const e164 = vE164(next.preusmeritev);
    if (!e164 || !next.preusmeritev.replace(/\(0\)/g, "").replace(/[\s()./-]/g, "").startsWith("+")) {
      throw new Error(t("preusmeritevOblika"));
    }
    if (jePremiumAliKratka(e164, next.dovoljenePredpone ?? "")) throw new Error(t("preusmeritevPremium"));
    next.preusmeritev = e164;
  }
  if (next.preusmeritev && istaStevilka(next.preusmeritev, javna)) {
    throw new Error(t("preusmeritevZanka"));
  }
  const opozorila: string[] = [];
  const ure = line?.catalog?.company?.hours ?? "";
  if (next.prevzem === "izven" && !ureSoRazumljive(ure)) {
    opozorila.push(t("ureOpozorilo"));
  }
  if ((next.prevzem === "izven" || next.prevzem === "neodgovorjeni") && !next.preusmeritev) {
    opozorila.push(t("preusmeritevPrazna"));
  }
  if (odsotnostPretekla) opozorila.push(t("odsotnostPretekla"));
  // Izpeljana privzeta 2 s (in stara privzeta 3 s brez tisinaNastavil) osebnega nacina se ne zapise (ob preklopu v podjetje bi ostala kot »nastavitev«);
  // na disk gre samo izrecna vrednost (tisinaNastavil), sicer privzetek podjetja.
  const zaDisk =
    !next.tisinaNastavil && next.nacinKlica === "osebna" && (next.tisinaPoGovoruSek === TISINA_OSEBNA_PRIVZETO_SEK || next.tisinaPoGovoruSek === 3)
      ? { ...next, tisinaPoGovoruSek: TISINA_PRIVZETO_SEK }
      : next;
  await writeJson(root, "pravila.json", zaDisk);
  poSpremembiDodatkov(prej, next, root);
  // Pozdrav je del stalnih stavkov: po spremembi jih glas pripravi znova, v ozadju in brez vpliva na shranjevanje.
  const veljavna = line?.catalog?.company ? line : defaultLine();
  // Zaprta linija, ki ne caka na odprtje, sinteze ne trosi: stavki se pripravijo pred odprtjem.
  if (veljavna.open || veljavna.caka) pripraviStalneVOzadju(root, stalniStavki(next, veljavna.catalog.company.name, veljavna.catalog));
  return { ...next, opozorila };
}

async function loadGaps(dir: string): Promise<Vrzel[]> {
  return (await readJsonFile<Vrzel[]>(dir, "vrzeli.json")) ?? [];
}

/** Ista vrsta kot za knjigo klicev: preberi, zdruzi, zapisi. Model je zunaj. */
const vrsteVrzeli = new Map<string, Promise<unknown>>();

function vVrstiVrzeli<T>(kljuc: string, delo: () => Promise<T>): Promise<T> {
  const prej = vrsteVrzeli.get(kljuc) ?? Promise.resolve();
  const tek = prej.then(delo, delo);
  vrsteVrzeli.set(
    kljuc,
    tek.then(
      () => undefined,
      () => undefined,
    ),
  );
  return tek;
}

/** Vprasanje, na katero katalog ni imel odgovora. Podvojene ne pise. Brez telefona in imena. */
export async function zapomniVrzel(vprasanje: string, dir?: string): Promise<Vrzel | null> {
  const root = resolveDataDir(dir);
  return vVrstiVrzeli(root, () => zapomniVrzelVrstno(vprasanje, root));
}

async function zapomniVrzelVrstno(vprasanje: string, root: string): Promise<Vrzel | null> {
  const text = besediloVrzel(vprasanje).slice(0, 400);
  if (!text || vprasaPoCeni(text)) return null;
  const gaps = await loadGaps(root);
  const key = fold(text);
  if (gaps.some((gap) => fold(gap.vprasanje) === key && !gap.dodano)) return null;
  const gap: Vrzel = { id: randomUUID(), vprasanje: text, at: new Date().toISOString(), dodano: false };
  gaps.push(gap);
  const zaprte = gaps.filter((item) => item.dodano);
  const odprte = gaps.filter((item) => !item.dodano).slice(-MEJA_ODPRTIH_VRZELI);
  await writeJson(root, "vrzeli.json", [...zaprte, ...odprte]);
  return gap;
}

export async function listVrzeli(token: string | null, dir?: string): Promise<Vrzel[]> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return loadGaps(root);
}

/**
 * En klic doda odgovor v katalog in oznaci vrzel kot urejeno.
 */
export async function dodajVrzel(
  id: string,
  odgovor: string,
  token: string | null,
  dir?: string,
): Promise<{ catalog: Catalog; vrzeli: Vrzel[] }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const answer = odgovor.trim().slice(0, 800);
  if (!answer) throw new Error("Odgovor je prazen.");
  const zavrnitev = razlogPolja("odgovor", answer);
  if (zavrnitev) throw new Error(zavrnitev);
  const line = await readJsonFile<LineState>(root, "line.json");
  if (!line?.catalog?.company) throw new Error("Najprej shranite katalog.");
  const gaps = await loadGaps(root);
  const gap = gaps.find((item) => item.id === id);
  if (!gap) throw new Error("Vprasanje ni na seznamu.");
  // Vprasanje o temi sme dobiti odgovor. Zavrne samo odgovor, ki sam obljublja temo.
  const tema = razlogTeme(answer);
  if (tema) throw new Error(tema);
  const note: Zapisek = { id: gap.id, vprasanje: gap.vprasanje, odgovor: answer };
  const obstojeci = (line.catalog.zapiski ?? []).filter((item) => item.id !== note.id);
  if (obstojeci.length >= MEJA_ZAPISKOV) throw new Error(t("mejaZapiskov"));
  const zapiski = [...obstojeci, note];
  line.catalog = { ...line.catalog, zapiski };
  line.updatedAt = new Date().toISOString();
  gap.dodano = true;
  await writeJson(root, "line.json", line);
  await writeJson(root, "vrzeli.json", gaps);
  return { catalog: line.catalog, vrzeli: gaps };
}

/** Isti odgovor kot na liniji, a brez zapisa klica, vrzeli ali statistike. */
export async function preizkusniOdgovor(
  text: string,
  token: string | null,
  dir?: string,
): Promise<{ reply: string; povzetek: Povzetek }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const clean = text.trim().slice(0, 2000);
  if (!clean) throw new Error("Vprasanje je prazno.");
  const saved = await readJsonFile<LineState>(root, "line.json");
  const catalog = saved?.catalog?.company ? saved.catalog : defaultLine().catalog;
  const pravila = await loadPravila(root);
  const draft = absorbUtterance(emptyDraft(), clean, catalog);
  const guard = applyGuards(
    { requestedProduct: draft.requestedProduct, requestedMaterial: draft.requestedMaterial },
    catalog,
  );
  const jedro0 = jedroOdgovora(clean, catalog, draft, guard);
  const cena = vprasaPoCeni(clean);
  const tema = cena ? null : odgovorTemeLastnika(clean, pravila);
  const jedro = tema ? { facts: tema.besedilo, neznano: tema.neznano, izKataloga: true } : jedro0;
  const osnutek = cena || jedro.neznano || jedro.izKataloga ? jedro.facts : await polishReply(jedro.facts, root);
  const reply = sestaviOdgovor({
    question: clean,
    osnutek,
    inquiry: pravila.povprasevanje,
    fresh: true,
    pozdrav: pravila.pozdrav,
    podjetje: catalog.company.name,
    osnova: jedro.facts,
  });
  const slip = slipFromGuard(draft, guard, "");
  const trenutno = new Date().toISOString();
  const call: CallSession = {
    callSid: "preizkus",
    from: slip.phone,
    startedAt: trenutno,
    updatedAt: trenutno,
    status: "v-teku",
    transcript: [],
    order: slip,
  };
  return { reply, povzetek: povzetekKlica(call, pravila.povprasevanje) };
}

export { draftFromOrder };

/** Po koncani namestitvi slovenskega modula (pregled 029, najdba 13): model se nalozi takoj, ce je stikalo se vklopljeno. */
export async function poNamestitviSlovenskega(uspeh: boolean, dir?: string): Promise<void> {
  if (!uspeh) return;
  const p = await loadPravila(resolveDataDir(dir)).catch(() => null);
  if (p?.dodatki?.slovenski === true) await uskladiRsdo(true, true);
}

/** Poizvedba Dodatkov (pregled 029, najdba 11): ponoven poskus zagona RSDO (~1,65 GB) sprozi SAMO prijavljen lastnik. */
export async function uskladiRsdoObPoizvedbi(token: string | null, dir?: string): Promise<void> {
  const root = resolveDataDir(dir);
  try {
    await requireOwner(token, root);
  } catch {
    return;
  }
  const p = await loadPravila(root).catch(() => null);
  // samo zagon: izklop gre izkljucno prek stikala (savePravila); neberljiva pravila (privzeto izklopljeno) modela ne ustavijo
  if (p?.dodatki?.slovenski === true) await uskladiRsdo(true);
}
