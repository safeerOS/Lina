/**
 * Snemanje klicev v nacinu za podjetja (lastnik 22. 11. 2026: »Se strinjam«; skil safeer-lina-snemanje-klicev).
 *
 * Pravila:
 *  - snema se SAMO v nacinu podjetje s stikalom snemanjeVklop (privzeto vklopljeno); osebni nacin nikoli (preverjeno tu, ne samo v UI);
 *  - snemanje se zacne sele PO izgovorjeni napovedi (prvi obrat klicatelja po pozdravu, ZEKom-2 clen 214: namen in rok sta v napovedi);
 *  - klic brez narocila: posnetek se ob koncu klica izbrise pri Twiliu, lokalno ne nastane nic;
 *  - klic z narocilom: posnetek (dva kanala) se prenese v mapo klica (posnetek.wav, 0600), nato izbrise pri Twiliu;
 *  - lokalni posnetek se po snemanjeHrambaDni izbrise (zapisek ostane do svojega roka).
 *
 * Twilio: Recordings na klicu prek REST (API kljuc iz twilio.json). Brez spletnega povratnega klica: stanje posnetka Lina vprasa sama
 * (preizkusni racun Twilio webhookov ne podpise, nepodpisane zahteve pa ne sprejmemo). Cakajoci posnetki so v posnetki-cakajo.json,
 * da jih po ponovnem zagonu programa ne pozabimo pri Twiliu. NEPREVERJENO s pravim racunom Twilio (prenos .wav, preusmeritev).
 */
import { lstat, open, readdir, rename, rmdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { CallSession, Pravila as LinaPravila } from "./types.ts";
import { glava, preberi, zahtevaTwilio, type ZahtevaTwilio } from "./twilio-racun.server.ts";
import { readJsonFile, writeJson } from "./store.server.ts";

const OSNOVA = "https://api.twilio.com/2010-04-01/";
const SID_RACUNA = /^AC[0-9a-f]{32}$/i;
const SID_KLICA = /^CA[0-9a-f]{32}$/i;
const SID_POSNETKA = /^RE[0-9a-f]{32}$/i;
const DATOTEKA_CAKAJO = "posnetki-cakajo.json";
/** Najvec bajtov posnetka: 2 kanala, 8 kHz, 16 bit = 32 kB/s; 60 min = ~115 MB. Vec se ne prenese. */
export const NAJVEC_BAJTOV_POSNETKA = 160 * 1024 * 1024;
/** Najdaljse cakanje, da Twilio posnetek obdela po koncu klica. */
export const ROK_OBDELAVE_MS = 120_000;
const RAZMIK_VPRASANJ_MS = 3_000;
/** Cakajoc posnetek, ki ga v tem casu ni bilo mogoce obdelati (ni zapisa klica, napaka), se pri Twiliu izbrise. */
export const NAJDLJE_CAKA_MS = 24 * 3_600_000;
const ROK_PRENOSA_MS = 120_000;
export const POSNETEK = "posnetek.wav";
export const ZAPISEK = "zapisek.md";
const DAN_MS = 86_400_000;

export type Cakajoc = { callSid: string; recSid: string; at: number };

export type Odvisnosti = {
  zahteva?: ZahtevaTwilio;
  /** Prenos medija (lazen v preizkusih). */
  prenesi?: typeof fetch;
  zdaj?: () => number;
  pocakaj?: (ms: number) => Promise<void>;
  /** Racun Twilio (lazen v preizkusih); privzeto twilio.json. */
  racun?: () => Promise<{ sid: string; kljucSid: string; skrivnost: string } | null>;
};

/** Ali Lina v tem klicu sme snemati: samo nacin podjetje in vklopljeno stikalo. */
export function smeSnemati(pravila: Pick<LinaPravila, "nacinKlica" | "snemanjeVklop">): boolean {
  return pravila.nacinKlica === "podjetje" && pravila.snemanjeVklop === true;
}

/**
 * Ali ima klic narocilo (posnetek je dokaz o narocilu): potrjen zapisnik ali vsebina narocila (izdelek, povprasevanje, kolicina).
 * Iz uporabnikove strani steje tudi nepotrjeno povprasevanje z vsebino; osebni klic nikoli.
 */
export function imaNarocilo(call: Pick<CallSession, "order" | "nacin"> | null | undefined): boolean {
  if (!call || call.nacin === "osebna") return false;
  const o = call.order;
  if (!o) return false;
  return Boolean(o.confirmed || o.productName || o.requestedProduct || (o.povprasevanje ?? "").trim() || (o.quantity ?? 0) > 0);
}

/** Klicatelj zavrne snemanje (stikalo snemanjeZavrnitev): kratki slovenski in angleski izrazi. */
export function zavracaSnemanje(izrek: string): boolean {
  const s = izrek.normalize("NFC").toLowerCase();
  return (
    /\b(ne\s+(želim|zelim|maram|dovolim|dovoljujem|soglašam|soglasam|strinjam\s+se\s+s)|brez|nehajte|prenehajte|ustavite)\b[^.?!]{0,20}\bsnem/.test(s) ||
    /\bne\s+snemajte\b/.test(s) ||
    /\b(don'?t|do\s+not|stop)\s+record/.test(s)
  );
}

const zaceti = new Map<string, number>();

function kljuc(root: string, callSid: string): string {
  return `${root}\n${callSid}`;
}

const vrste = new Map<string, Promise<unknown>>();
function vVrsti<T>(root: string, delo: () => Promise<T>): Promise<T> {
  const prej = vrste.get(root) ?? Promise.resolve();
  const naslednji = prej.catch(() => undefined).then(delo);
  const rep = naslednji.catch(() => undefined);
  vrste.set(root, rep);
  void rep.then(() => {
    if (vrste.get(root) === rep) vrste.delete(root);
  });
  return naslednji;
}

async function beriCakajoce(root: string): Promise<Cakajoc[]> {
  let raw: unknown = null;
  try {
    raw = await readJsonFile<unknown>(root, DATOTEKA_CAKAJO);
  } catch {
    raw = null;
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (v): v is Cakajoc =>
        Boolean(v) && typeof v === "object" && SID_KLICA.test(String((v as Cakajoc).callSid)) && SID_POSNETKA.test(String((v as Cakajoc).recSid)) && Number.isFinite((v as Cakajoc).at),
    )
    .slice(0, 500);
}

async function spremeniCakajoce(root: string, fn: (s: Cakajoc[]) => Cakajoc[]): Promise<void> {
  await vVrsti(root, async () => writeJson(root, DATOTEKA_CAKAJO, fn(await beriCakajoce(root))));
}

/** Seznam cakajocih posnetkov (za preizkuse in pospravljanje). */
export function cakajociPosnetki(root: string): Promise<Cakajoc[]> {
  return beriCakajoce(root);
}

export function pozabiZaceteSnemanja(): void {
  zaceti.clear();
}

/**
 * Zacne snemanje klica pri Twiliu (dva kanala, oba glasova). Najvec enkrat na klic; napaka ne podre klica (vrne null).
 * Klicati sele po izgovorjeni napovedi in samo, ce smeSnemati(pravila).
 */
export async function zacniSnemanje(root: string, callSid: string, pravila: Pick<LinaPravila, "nacinKlica" | "snemanjeVklop">, odv: Odvisnosti = {}): Promise<string | null> {
  if (!smeSnemati(pravila) || !SID_KLICA.test(callSid)) return null;
  const k = kljuc(root, callSid);
  if (zaceti.has(k)) return null;
  const zdaj = (odv.zdaj ?? Date.now)();
  if (zaceti.size > 500) zaceti.clear();
  zaceti.set(k, zdaj);
  const r = await (odv.racun ?? (() => preberi(root)))().catch(() => null);
  if (!r || !SID_RACUNA.test(r.sid)) return null;
  const telo = new URLSearchParams({ RecordingChannels: "dual", RecordingTrack: "both" }).toString();
  const odgovor = await (odv.zahteva ?? zahtevaTwilio)(`${OSNOVA}Accounts/${r.sid}/Calls/${callSid}/Recordings.json`, {
    method: "POST",
    headers: glava(r.sid, r.kljucSid, r.skrivnost),
    body: telo,
  }).catch(() => null);
  const recSid = String((odgovor?.json as { sid?: unknown } | null)?.sid ?? "");
  if (!odgovor || odgovor.status >= 300 || !SID_POSNETKA.test(recSid)) return null;
  await spremeniCakajoce(root, (s) => [...s.filter((c) => c.recSid !== recSid), { callSid, recSid, at: zdaj }]);
  return recSid;
}

async function izbrisiPriTwiliu(root: string, recSid: string, odv: Odvisnosti): Promise<boolean> {
  const r = await (odv.racun ?? (() => preberi(root)))().catch(() => null);
  if (!r || !SID_RACUNA.test(r.sid) || !SID_POSNETKA.test(recSid)) return false;
  const odgovor = await (odv.zahteva ?? zahtevaTwilio)(`${OSNOVA}Accounts/${r.sid}/Recordings/${recSid}.json`, {
    method: "DELETE",
    headers: glava(r.sid, r.kljucSid, r.skrivnost),
  }).catch(() => null);
  // 204 izbrisano, 404 ga ni vec: v obeh primerih pri Twiliu posnetka ni.
  return Boolean(odgovor && (odgovor.status === 204 || odgovor.status === 200 || odgovor.status === 404));
}

/** Klicatelj je zavrnil snemanje: posnetek se ustavi in izbrise takoj, klic tece naprej brez snemanja. */
export async function ustaviSnemanje(root: string, callSid: string, odv: Odvisnosti = {}): Promise<boolean> {
  const cakajo = (await beriCakajoce(root)).filter((c) => c.callSid === callSid);
  let vse = true;
  for (const c of cakajo) {
    const izbrisan = await izbrisiPriTwiliu(root, c.recSid, odv);
    if (izbrisan) await spremeniCakajoce(root, (s) => s.filter((x) => x.recSid !== c.recSid));
    vse &&= izbrisan;
  }
  return vse;
}

async function stanjePosnetka(root: string, recSid: string, odv: Odvisnosti): Promise<string> {
  const r = await (odv.racun ?? (() => preberi(root)))().catch(() => null);
  if (!r) return "";
  const odgovor = await (odv.zahteva ?? zahtevaTwilio)(`${OSNOVA}Accounts/${r.sid}/Recordings/${recSid}.json`, {
    method: "GET",
    headers: glava(r.sid, r.kljucSid, r.skrivnost),
  }).catch(() => null);
  if (!odgovor) return "";
  if (odgovor.status === 404) return "absent";
  return String((odgovor.json as { status?: unknown } | null)?.status ?? "");
}

/** Dovoljeni gostitelji medija: api.twilio.com in (po eni preusmeritvi, BREZ kljuca) shramba Twilio pri Amazonu. */
function dovoljenMedij(u: URL, prvi: boolean): boolean {
  if (u.protocol !== "https:") return false;
  if (prvi) return u.hostname === "api.twilio.com";
  return u.hostname === "api.twilio.com" || u.hostname.endsWith(".twilio.com") || /^[a-z0-9.-]+\.amazonaws\.com$/.test(u.hostname);
}

/** Prenese posnetek v cilj (zacasna datoteka 0600 in rename) po kosih, z mejo velikosti. Vrne true ob uspehu. */
async function prenesiPosnetek(root: string, recSid: string, cilj: string, odv: Odvisnosti): Promise<boolean> {
  const r = await (odv.racun ?? (() => preberi(root)))().catch(() => null);
  if (!r || !SID_RACUNA.test(r.sid)) return false;
  const prenesi = odv.prenesi ?? fetch;
  let url = new URL(`${OSNOVA}Accounts/${r.sid}/Recordings/${recSid}.wav`);
  const avt = glava(r.sid, r.kljucSid, r.skrivnost).Authorization;
  let odgovor: Response | null = null;
  for (let skok = 0; skok < 2; skok++) {
    if (!dovoljenMedij(url, skok === 0)) return false;
    odgovor = await prenesi(url, {
      method: "GET",
      // Kljuc samo do api.twilio.com; preusmeritev drugam ga ne dobi.
      headers: url.hostname === "api.twilio.com" ? { Authorization: avt, Accept: "audio/wav" } : { Accept: "audio/wav" },
      redirect: "manual",
      signal: AbortSignal.timeout(ROK_PRENOSA_MS),
    }).catch(() => null);
    if (!odgovor) return false;
    if (odgovor.status >= 300 && odgovor.status < 400) {
      const kam = odgovor.headers.get("location");
      if (!kam) return false;
      try {
        url = new URL(kam, url);
      } catch {
        return false;
      }
      odgovor = null;
      continue;
    }
    break;
  }
  if (!odgovor || odgovor.status !== 200 || !odgovor.body) return false;
  const dolzina = Number(odgovor.headers.get("content-length") ?? "0");
  if (dolzina > NAJVEC_BAJTOV_POSNETKA) return false;
  const tmp = path.join(path.dirname(cilj), `.${POSNETEK}.${process.pid}.${recSid.slice(-8)}.tmp`);
  const rocaj = await open(tmp, "wx", 0o600);
  let skupaj = 0;
  let ok = false;
  try {
    const bralec = odgovor.body.getReader();
    for (;;) {
      const { done, value } = await bralec.read();
      if (done) break;
      skupaj += value.byteLength;
      if (skupaj > NAJVEC_BAJTOV_POSNETKA) {
        await bralec.cancel().catch(() => undefined);
        throw new Error("prevelik");
      }
      await rocaj.write(value);
    }
    await rocaj.sync();
    ok = skupaj > 44;
  } catch {
    ok = false;
  } finally {
    await rocaj.close().catch(() => undefined);
  }
  if (!ok) {
    await unlink(tmp).catch(() => undefined);
    return false;
  }
  try {
    // Obstojecega posnetka ne prepisemo (isti klic dvakrat): cilj mora biti prost.
    await lstat(cilj);
    await unlink(tmp).catch(() => undefined);
    return true;
  } catch {
    /* cilj je prost */
  }
  await rename(tmp, cilj);
  return true;
}

export type IzidKonca = "izbrisan" | "shranjen" | "caka" | "ni";

/**
 * Konec klica: brez narocila izbris pri Twiliu; z narocilom pocaka obdelavo, prenese v mapo klica in izbrise pri Twiliu.
 * mapaKlica: pot mape klica (iz zapiski.server.ts mapaKlicaZaPosnetek) ali null, ce je ni (posnetek caka na naslednje pospravljanje).
 */
export async function koncajSnemanje(
  root: string,
  call: CallSession | null,
  mapaKlica: string | null,
  odv: Odvisnosti = {},
): Promise<IzidKonca> {
  if (!call || !SID_KLICA.test(call.callSid)) return "ni";
  zaceti.delete(kljuc(root, call.callSid));
  const cakajo = (await beriCakajoce(root)).filter((c) => c.callSid === call.callSid);
  if (cakajo.length === 0) return "ni";
  let izid: IzidKonca = "izbrisan";
  for (const c of cakajo) {
    if (!imaNarocilo(call)) {
      if (await izbrisiPriTwiliu(root, c.recSid, odv)) await spremeniCakajoce(root, (s) => s.filter((x) => x.recSid !== c.recSid));
      else izid = "caka";
      continue;
    }
    if (!mapaKlica) {
      izid = "caka";
      continue;
    }
    const ura = odv.zdaj ?? Date.now;
    const pocakaj = odv.pocakaj ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms).unref()));
    const zacetek = ura();
    let stanje = await stanjePosnetka(root, c.recSid, odv);
    while ((stanje === "processing" || stanje === "in-progress" || stanje === "paused" || stanje === "") && ura() - zacetek < ROK_OBDELAVE_MS) {
      await pocakaj(RAZMIK_VPRASANJ_MS);
      stanje = await stanjePosnetka(root, c.recSid, odv);
    }
    if (stanje === "completed") {
      const shranjen = await prenesiPosnetek(root, c.recSid, path.join(mapaKlica, POSNETEK), odv).catch(() => false);
      if (!shranjen) {
        izid = "caka";
        continue;
      }
      izid = "shranjen";
    } else if (stanje !== "absent" && stanje !== "failed" && stanje !== "deleted") {
      izid = "caka";
      continue;
    }
    if (await izbrisiPriTwiliu(root, c.recSid, odv)) await spremeniCakajoce(root, (s) => s.filter((x) => x.recSid !== c.recSid));
    else izid = "caka";
  }
  return izid;
}

const OZNAKA_PODJETJE = /^<!--\s*lina-nacin:\s*podjetje\s*-->\s*$/m;

export type IzidPospravljanja = { posnetkov: number; klicev: number; twilio: number };

/**
 * Roki hrambe (lastnik 22. 11. 2026, »Se strinjam z predlogom«):
 *  - posnetek.wav v mapi klica: po snemanjeHrambaDni dneh se izbrise samo posnetek, zapisek ostane;
 *  - zapisek klica nacina podjetje (oznaka lina-nacin: podjetje): po zapiskiHrambaDni dneh se izbrise mapa klica
 *    (samo zapisek.md in posnetek.wav; mapa z drugimi datotekami ostane). Osebni zapiski in stari ploski zapiski se nikoli ne brisejo;
 *  - cakajoc posnetek pri Twiliu, starejsi od 24 ur, se pri Twiliu izbrise.
 * Brise samo datoteke s tocno temi imeni neposredno v mapi klica (Dirent, brez simbolnih povezav). V dnevnik gre samo stevilo.
 */
export async function pospraviPosnetke(
  root: string,
  mapaZapiskov: string | null,
  pravila: Pick<LinaPravila, "snemanjeHrambaDni"> & { zapiskiHrambaDni?: number },
  odv: Odvisnosti = {},
  dnevnik: (vrstica: string) => void = () => undefined,
): Promise<IzidPospravljanja> {
  const zdaj = (odv.zdaj ?? Date.now)();
  const izid: IzidPospravljanja = { posnetkov: 0, klicev: 0, twilio: 0 };
  for (const c of await beriCakajoce(root)) {
    if (zdaj - c.at < NAJDLJE_CAKA_MS) continue;
    if (await izbrisiPriTwiliu(root, c.recSid, odv)) {
      await spremeniCakajoce(root, (s) => s.filter((x) => x.recSid !== c.recSid));
      izid.twilio++;
    }
  }
  if (!mapaZapiskov) return izid;
  const rokPosnetka = Math.max(1, pravila.snemanjeHrambaDni) * DAN_MS;
  const rokZapiska = Math.max(1, pravila.zapiskiHrambaDni ?? 90) * DAN_MS;
  let vnosi;
  try {
    vnosi = await readdir(mapaZapiskov, { withFileTypes: true });
  } catch {
    return izid;
  }
  for (const vnos of vnosi.slice(0, 5000)) {
    if (!vnos.isDirectory() || vnos.name.startsWith(".")) continue;
    const mapa = path.join(mapaZapiskov, vnos.name);
    const zapisek = path.join(mapa, ZAPISEK);
    const posnetek = path.join(mapa, POSNETEK);
    let zapisekInfo = null;
    try {
      const l = await lstat(zapisek);
      zapisekInfo = l.isFile() ? l : null;
    } catch {
      zapisekInfo = null;
    }
    if (!zapisekInfo) continue;
    let jePodjetje = false;
    let casKlica = zapisekInfo.mtimeMs;
    try {
      const rocaj = await open(zapisek, "r");
      try {
        const buf = Buffer.alloc(1024);
        const { bytesRead } = await rocaj.read(buf, 0, 1024, 0);
        const glava = buf.subarray(0, bytesRead).toString("utf8");
        jePodjetje = OZNAKA_PODJETJE.test(glava);
        // Starost zapiska = cas klica iz glave (lina-cas); brez nje cas zadnje spremembe datoteke.
        const cas = Date.parse(/^<!--\s*lina-cas:\s*([0-9TZ:.+-]+)\s*-->/m.exec(glava)?.[1] ?? "");
        if (Number.isFinite(cas)) casKlica = Math.max(cas, 0);
      } finally {
        await rocaj.close();
      }
    } catch {
      jePodjetje = false;
    }
    if (jePodjetje && zdaj - casKlica > rokZapiska) {
      const ostalo = (await readdir(mapa).catch(() => [ZAPISEK, "?"])).filter((ime) => ime !== ZAPISEK && ime !== POSNETEK);
      if (ostalo.length === 0) {
        await unlink(posnetek).catch(() => undefined);
        await unlink(zapisek).catch(() => undefined);
        await rmdir(mapa).catch(() => undefined);
        izid.klicev++;
        dnevnik("klic izbrisan po roku hrambe");
        continue;
      }
    }
    try {
      const p = await lstat(posnetek);
      if (p.isFile() && zdaj - p.mtimeMs > rokPosnetka) {
        await unlink(posnetek);
        izid.posnetkov++;
        dnevnik("posnetek izbrisan po roku hrambe");
      }
    } catch {
      /* posnetka ni */
    }
  }
  return izid;
}

/** Velikost posnetka za predvajanje (samo branje, meja). */
export async function velikostPosnetka(pot: string): Promise<number> {
  const info = await stat(pot);
  return info.size;
}

/**
 * Izrek klicatelja (pot Gather: zahteva /turn; pot Live: prvi izrek): napoved je ze bila izrecena, snemanje se lahko zacne.
 * Zavrnitev (stikalo snemanjeZavrnitev): posnetek se ustavi in izbrise, v tem klicu se ne zacne znova.
 */
export async function obIzrekuKlicatelja(
  root: string,
  callSid: string,
  izrek: string,
  pravila: Pick<LinaPravila, "nacinKlica" | "snemanjeVklop" | "snemanjeZavrnitev">,
  odv: Odvisnosti = {},
): Promise<void> {
  if (!smeSnemati(pravila) || !SID_KLICA.test(callSid)) return;
  if (pravila.snemanjeZavrnitev && izrek && zavracaSnemanje(izrek)) {
    zaceti.set(kljuc(root, callSid), (odv.zdaj ?? Date.now)());
    await ustaviSnemanje(root, callSid, odv);
    return;
  }
  await zacniSnemanje(root, callSid, pravila, odv);
}

/** Konec klica (service.server.ts zakljuciKlic): mapa klica iz zapiska, nato koncajSnemanje. Napaka ne podre konca klica. */
export async function koncajPoKlicu(root: string, call: CallSession | null, odv: Odvisnosti = {}): Promise<IzidKonca> {
  if (!call || !SID_KLICA.test(call.callSid)) return "ni";
  if ((await beriCakajoce(root)).every((c) => c.callSid !== call.callSid)) return "ni";
  const { mapaKlicaZaPosnetek } = await import("./zapiski.server.ts");
  const mapa = await mapaKlicaZaPosnetek(call, root).catch(() => null);
  return koncajSnemanje(root, call, mapa, odv);
}

const pospravljanje = new Map<string, ReturnType<typeof setInterval>>();

/** Pospravljanje po rokih hrambe: prvic minuto po prvi zahtevi klica v procesu, nato enkrat na dan (casovnik ne drzi procesa). */
export function zazeniPospravljanjePosnetkov(root: string): void {
  if (pospravljanje.has(root)) return;
  const enkrat = async () => {
    try {
      const { loadPravila } = await import("./pravila.server.ts");
      const { mapaZaPisanje } = await import("./zapiski.server.ts");
      const pravila = await loadPravila(root);
      const mapa = await mapaZaPisanje(root).catch(() => null);
      await pospraviPosnetke(root, mapa, pravila, {}, (vrstica) => console.info(`[lina] hramba: ${vrstica}`));
    } catch {
      /* naslednjic */
    }
  };
  setTimeout(() => void enkrat(), 60_000).unref();
  const t = setInterval(() => void enkrat(), DAN_MS);
  t.unref();
  pospravljanje.set(root, t);
}

export function ustaviPospravljanjePosnetkov(): void {
  for (const t of pospravljanje.values()) clearInterval(t);
  pospravljanje.clear();
}
