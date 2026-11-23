import { createHash } from "node:crypto";
import { requireOwner } from "./auth.server.ts";
import { t } from "./besedila.ts";
import { istaStevilka } from "./guards.ts";
import { jeUstavljenoNujno } from "./avtonomija-stanje.server.ts";
import { odsifrirajSkrivnost, sifrirajSkrivnost } from "./keys.server.ts";
import { jePrepovedanaStevilka, vE164 } from "./plast.ts";
import { jeNedovoljenaPreusmeritev } from "./preusmeritev.ts";
import { loadPravila } from "./pravila.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";
import { glava, preberi, zahtevaTwilio, type ZahtevaTwilio } from "./twilio-racun.server.ts";
import type { CallSession, LineState, NujniDogodek } from "./types.ts";

/**
 * Nujni klici na osebni telefon (lastnik 10. 11. 2026): DVE LOCENI STIKALI, obe privzeto IZKLOPLJENI.
 *  - »Obvesti me o nujnem klicu«: takojsnje obvestilo (SMS prek Twilio) na osebni telefon;
 *  - »Prevezi nujni klic name«: Lina poskusi klic prevezati (Twilio Dial); klicatelju pove samo, da ga poskusa povezati.
 * Vklop vsakega zahteva vpisano stevilko osebnega telefona. Stevilka je ZAUPNA: sifrirana na disku kot kljuci (isti glavni
 * kljuc, pravice 0600), nikoli v dnevniku, povzetku, zapisku, vrzelih ali odgovoru API (odjemalec dobi samo »vpisana«), klicatelj je
 * ne izve ne v govoru ne kot prikazano stevilko. Dogodki (cas, izid) so v zapisu klica BREZ stevilke.
 */
const DATOTEKA = "nujni.json";
export const NUJNI_CAKANJE_PRIVZETO_SEK = 20;
export const NUJNI_CAKANJE_NAJMANJ_SEK = 10;
export const NUJNI_CAKANJE_NAJVEC_SEK = 60;
/** Omejitev nujnih obvestil/prevezav (lastnik 10. 11. 2026: varnost pred udobjem): na uro za isto stevilko klicatelja in na dan skupaj. */
export const NUJNI_OMEJITEV_URA_PRIVZETO = 3;
export const NUJNI_OMEJITEV_DAN_PRIVZETO = 10;
const KVOTA_NUJNIH = "nujni-kvota.json";
/**
 * Prevezava NA ZAHTEVO (»prava oseba«) ima LOCENO kvoto (pregled 029): zloraba stikala, ki je privzeto vklopljeno, ne sme porabiti kvote
 * pravih nujnih prevezav in obvestil. Na uro za isto stevilko klicatelja in na dan skupaj.
 */
export const ZAHTEVA_OMEJITEV_URA = 2;
export const ZAHTEVA_OMEJITEV_DAN = 6;
const KVOTA_ZAHTEVE = "prevezava-zahteva-kvota.json";
/** Najvec poskusov SMS po neuspehu v istem klicu. */
const NAJVEC_NAPAK_OBVESTILA = 2;
const OSNOVA = "https://api.twilio.com/2010-04-01/";
const SID_TELEFONA = /^\+[1-9][0-9]{7,14}$/;

type Shranjeno = {
  obvesti: boolean;
  prevezi: boolean;
  cakanjeSek: number;
  omejitevUra: number;
  omejitevDan: number;
  iv?: string;
  tag?: string;
  ciphertext?: string;
};

/** Kar vidi odjemalec: stikali, cakanje in samo podatek, ali je stevilka vpisana. Stevilke nikoli. */
export type NujniNastavitve = {
  obvesti: boolean;
  prevezi: boolean;
  cakanjeSek: number;
  omejitevUra: number;
  omejitevDan: number;
  stevilkaVpisana: boolean;
  /** Opozorilo ob vklopljeni prevezavi (klic gre prek posrednika in se obracuna); prazno, ce je prevezava izklopljena. */
  opozorilo: string;
};

function cakanje(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return NUJNI_CAKANJE_PRIVZETO_SEK;
  return Math.min(NUJNI_CAKANJE_NAJVEC_SEK, Math.max(NUJNI_CAKANJE_NAJMANJ_SEK, Math.round(n)));
}

function omejitev(value: unknown, privzeta: number, najvec: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return privzeta;
  return Math.min(najvec, Math.max(1, Math.round(n)));
}

function privzeto(): Shranjeno {
  return {
    obvesti: false,
    prevezi: false,
    cakanjeSek: NUJNI_CAKANJE_PRIVZETO_SEK,
    omejitevUra: NUJNI_OMEJITEV_URA_PRIVZETO,
    omejitevDan: NUJNI_OMEJITEV_DAN_PRIVZETO,
  };
}

async function beri(root: string): Promise<Shranjeno> {
  const f = await readJsonFile<Partial<Shranjeno>>(root, DATOTEKA);
  if (!f) return privzeto();
  const imaStevilko = Boolean(f.iv && f.tag && f.ciphertext);
  return {
    // Brez stevilke stikali ne veljata, tudi ce je datoteka rocno popravljena (kot pri naslovu potrditve).
    obvesti: Boolean(f.obvesti) && imaStevilko,
    prevezi: Boolean(f.prevezi) && imaStevilko,
    cakanjeSek: cakanje(f.cakanjeSek ?? NUJNI_CAKANJE_PRIVZETO_SEK),
    omejitevUra: omejitev(f.omejitevUra, NUJNI_OMEJITEV_URA_PRIVZETO, 20),
    omejitevDan: omejitev(f.omejitevDan, NUJNI_OMEJITEV_DAN_PRIVZETO, 100),
    ...(imaStevilko ? { iv: f.iv, tag: f.tag, ciphertext: f.ciphertext } : {}),
  };
}

function javno(s: Shranjeno): NujniNastavitve {
  return {
    obvesti: s.obvesti,
    prevezi: s.prevezi,
    cakanjeSek: s.cakanjeSek,
    omejitevUra: s.omejitevUra,
    omejitevDan: s.omejitevDan,
    stevilkaVpisana: Boolean(s.ciphertext),
    opozorilo: s.prevezi ? t("nujniPrevezaOpozorilo") : "",
  };
}

export async function preberiNujne(token: string | null, dir?: string): Promise<NujniNastavitve> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return javno(await beri(root));
}

/**
 * Shrani stikali, cakanje in (po izbiri) stevilko. stevilka: nova stevilka (preverjena kot pri preusmeritvi: ne 112/113/090,
 * ne premijska, ne javna stevilka podjetja); pozabiStevilko: izbrise stevilko in izklopi obe stikali. Vklop brez stevilke je napaka
 * z razlago, ne tiho. Odgovor je samo javni pogled (brez stevilke).
 */
export async function shraniNujne(
  vnos: { obvesti?: unknown; prevezi?: unknown; stevilka?: unknown; cakanjeSek?: unknown; omejitevUra?: unknown; omejitevDan?: unknown; pozabiStevilko?: unknown },
  token: string | null,
  dir?: string,
): Promise<NujniNastavitve> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const prej = await beri(root);
  let sifra: Pick<Shranjeno, "iv" | "tag" | "ciphertext"> = prej.ciphertext ? { iv: prej.iv, tag: prej.tag, ciphertext: prej.ciphertext } : {};
  if (vnos.pozabiStevilko === true) sifra = {};
  const surova = typeof vnos.stevilka === "string" ? vnos.stevilka.trim() : "";
  if (surova) {
    if (jePrepovedanaStevilka(surova)) throw new Error(t("preusmeritevNujna"));
    const e164 = vE164(surova);
    if (!e164 || !surova.replace(/\(0\)/g, "").replace(/[\s()./-]/g, "").startsWith("+")) throw new Error(t("preusmeritevOblika"));
    const pravila = await loadPravila(root);
    if (jeNedovoljenaPreusmeritev(e164, pravila.dovoljenePredpone ?? "")) throw new Error(t("preusmeritevPremium"));
    const line = await readJsonFile<LineState>(root, "line.json");
    // Javna stevilka podjetja bi ob prevezavi naredila zanko.
    if (istaStevilka(e164, line?.catalog?.company?.phone ?? "")) throw new Error(t("preusmeritevZanka"));
    sifra = await sifrirajSkrivnost(e164, root);
  }
  const obvesti = typeof vnos.obvesti === "boolean" ? vnos.obvesti : prej.obvesti;
  const prevezi = typeof vnos.prevezi === "boolean" ? vnos.prevezi : prej.prevezi;
  const imaStevilko = Boolean(sifra.ciphertext);
  if ((obvesti || prevezi) && !imaStevilko) throw new Error(t("nujniBrezStevilke"));
  const next: Shranjeno = {
    obvesti: obvesti && imaStevilko,
    prevezi: prevezi && imaStevilko,
    cakanjeSek: vnos.cakanjeSek === undefined ? prej.cakanjeSek : cakanje(vnos.cakanjeSek),
    omejitevUra: vnos.omejitevUra === undefined ? prej.omejitevUra : omejitev(vnos.omejitevUra, prej.omejitevUra, 20),
    omejitevDan: vnos.omejitevDan === undefined ? prej.omejitevDan : omejitev(vnos.omejitevDan, prej.omejitevDan, 100),
    ...sifra,
  };
  await writeJson(root, DATOTEKA, next);
  return javno(next);
}

/** Stevilka osebnega telefona za posiljanje. SAMO za notranjo rabo (Twilio); nikoli v odgovor, dnevnik ali zapis. */
async function stevilkaOsebnega(root: string, s: Shranjeno): Promise<string | null> {
  if (!s.ciphertext) return null;
  const stevilka = await odsifrirajSkrivnost({ iv: s.iv, tag: s.tag, ciphertext: s.ciphertext }, root);
  return stevilka && SID_TELEFONA.test(stevilka) ? stevilka : null;
}

/**
 * Prevezava je vklopljena in mogoca: stevilka in cakanje, ali null. Klicatelj voice.server (Twilio Dial); stevilka ne gre
 * nikamor drugam. izKljucev: To in ForwardedFrom klica (zanka: nikoli na isto stevilko).
 */
export async function nujnaPrevezava(dir: string, izKljucev: readonly string[] = []): Promise<{ stevilka: string; cakanjeSek: number } | null> {
  const root = resolveDataDir(dir);
  const s = await beri(root);
  if (!s.prevezi) return null;
  // »Ustavi vse« (pravila avtonomije, 15. 11. 2026) ustavi tudi prevezavo nujnega klica: klic ostane pri Lini.
  if (await jeUstavljenoNujno(root)) return null;
  const stevilka = await stevilkaOsebnega(root, s);
  if (!stevilka) return null;
  // Pravila o dovoljenih smereh (premija, satelit) veljajo ob vsakem klicu, ne samo ob vpisu.
  if (jeNedovoljenaPreusmeritev(stevilka, (await loadPravila(root)).dovoljenePredpone ?? "")) return null;
  // Zanka: klic je na Lino prisel s te stevilke (preusmeritev osebnega telefona) ali je klicana stevilka ista.
  if (izKljucev.some((druga) => druga && istaStevilka(stevilka, druga))) return null;
  return { stevilka, cakanjeSek: s.cakanjeSek };
}

/**
 * Prevezava NA ZAHTEVO klicatelja (lastnik 23. 11. 2026: »ce bo klicatelj rekel da zeli govoriti z pravo osebo ali nujno«): cilj je
 * »Stevilka za preusmeritev« (ista kot pri prevzemu). null = stikalo izklopljeno ali »Ustavi vse«; "brez" = stikalo je vklopljeno, a
 * prevezave ni (ni stevilke, zanka ali nedovoljena smer): Lina zadevo samo oznaci kot nujno. izKljucev: To, ForwardedFrom in From klica;
 * nikoli na klicatelja in nikoli na Linino javno stevilko (zanka).
 */
export async function prevezavaNaZahtevo(
  dir: string,
  pravila: { prevezaNaZahtevo?: boolean; preusmeritev?: string; dovoljenePredpone?: string; cakanjeSekund?: number },
  izKljucev: readonly string[] = [],
): Promise<{ stevilka: string; cakanjeSek: number } | "brez" | null> {
  if (pravila.prevezaNaZahtevo === false) return null;
  const root = resolveDataDir(dir);
  if (await jeUstavljenoNujno(root)) return null;
  const stevilka = vE164((pravila.preusmeritev ?? "").trim());
  if (!stevilka || !SID_TELEFONA.test(stevilka) || jePrepovedanaStevilka(stevilka)) return "brez";
  if (jeNedovoljenaPreusmeritev(stevilka, pravila.dovoljenePredpone ?? "")) return "brez";
  const line = await readJsonFile<LineState>(root, "line.json");
  const zanka = [...izKljucev, line?.catalog?.company?.phone ?? ""];
  if (zanka.some((druga) => druga && istaStevilka(stevilka, druga))) return "brez";
  return { stevilka, cakanjeSek: cakanje(pravila.cakanjeSekund ?? NUJNI_CAKANJE_PRIVZETO_SEK) };
}

/** Obvestila, ki so ze poslana ali v teku (po podatkovni mapi in CallSid; cas za ciscenje): en klic, eno obvestilo. */
const obvesceni = new Map<string, number>();
const OBVESCENI_ZIVLJENJE_MS = 6 * 60 * 60 * 1000;
/** Obvestila v teku: preizkusi in zaustavitev pocakajo, da po njih ni vec pisanja v mapo podatkov. */
const vOzadju = new Set<Promise<void>>();

function rezervirajObvestilo(kljuc: string): void {
  const zdaj = Date.now();
  for (const [k, cas] of obvesceni) if (zdaj - cas > OBVESCENI_ZIVLJENJE_MS) obvesceni.delete(k);
  obvesceni.set(kljuc, zdaj);
}

type ZapisKvote = { cas: string; kdo: string; sid: string };
let vrstaKvote: Promise<unknown> = Promise.resolve();

/** Skrita ali neveljavna stevilka klicatelja je ena skupna kvota (»skrito«); sicer zgostitev stevilke (stevilka ni v datoteki). */
function kdoKlice(from: string): string {
  const stevke = from.replace(/\D/g, "");
  if (stevke.length < 6) return "skrito";
  return createHash("sha256").update(stevke.slice(-9)).digest("hex").slice(0, 16);
}

/**
 * Rezervira mesto v kvoti nujnih obvestil/prevezav za ta klic: najvec omejitevUra na uro za isto stevilko klicatelja in
 * omejitevDan na dan skupaj. Klic, ki je ze v kvoti, ostane (obvestilo in prevezava istega klica sta eno mesto). Brez mesta (ali
 * pri napaki branja/pisanja) vrne false: klic ostane pri Lini, nic se ne poslje (varnost pred udobjem).
 * vrsta "zahteva": locena kvota prevezave na zahtevo (ZAHTEVA_OMEJITEV_*, svoja datoteka); dnevna meja najvec lastnikova omejitevDan.
 */
export function rezervirajKvoto(root: string, callSid: string, from: string, now: string = new Date().toISOString(), vrsta: "nujni" | "zahteva" = "nujni"): Promise<boolean> {
  const delo = vrstaKvote.then(async () => {
    try {
      const nujni = await beri(root);
      // Dnevna meja prevezav na zahtevo nikoli ne preseze lastnikove dnevne meje nujnih (pregled 029b, najdba 1); urna ostane ZAHTEVA_OMEJITEV_URA.
      const s = vrsta === "zahteva" ? { omejitevUra: ZAHTEVA_OMEJITEV_URA, omejitevDan: Math.min(ZAHTEVA_OMEJITEV_DAN, nujni.omejitevDan) } : nujni;
      const KVOTA = vrsta === "zahteva" ? KVOTA_ZAHTEVE : KVOTA_NUJNIH;
      const cas = Date.parse(now);
      const datoteka = await readJsonFile<{ zapisi?: ZapisKvote[] }>(root, KVOTA);
      const zapisi = (datoteka?.zapisi ?? []).filter((z) => z && typeof z.cas === "string" && cas - Date.parse(z.cas) < 24 * 3600_000);
      if (zapisi.some((z) => z.sid === callSid)) return true;
      const kdo = kdoKlice(from);
      const naUro = zapisi.filter((z) => z.kdo === kdo && cas - Date.parse(z.cas) < 3600_000).length;
      if (naUro >= s.omejitevUra || zapisi.length >= s.omejitevDan) return false;
      zapisi.push({ cas: now, kdo, sid: callSid });
      await writeJson(root, KVOTA, { zapisi });
      return true;
    } catch {
      return false;
    }
  });
  vrstaKvote = delo.catch(() => undefined);
  return delo;
}

export async function pocakajNujne(): Promise<void> {
  while (vOzadju.size > 0) await Promise.allSettled([...vOzadju]);
}

/** Za preizkus: pozabi, kateri klici so ze obvesceni. */
export function pozabiObvescene(): void {
  obvesceni.clear();
}

/** Samo za preizkuse: zahteva proti API Twilio namesto prave (brez omrezja). Brez argumenta jo vrne na pravo. */
let zahtevaPreizkusa: ZahtevaTwilio | null = null;
export function nastaviZahtevoNujnih(zahteva: ZahtevaTwilio | null = null): void {
  zahtevaPreizkusa = zahteva;
}

export type ZapisiDogodek = (root: string, callSid: string, dogodek: NujniDogodek) => Promise<void>;

/**
 * Takojsnje obvestilo (SMS) na osebni telefon, ko klic postane nujen (klicatelj je nujnost povedal). Samo ob vklopljenem stikalu
 * in vpisani stevilki; en klic = eno obvestilo. Vsebina SMS je stalna (brez klicatelja, stevilke ali sporocila). V zapis klica gre
 * samo cas in izid (poslano/napaka), nikoli stevilka ali besedilo napake Twilio. Nikoli ne vrze in ne zadrzi klica (ozadje).
 * NEPREVERJENO s pravim Twilio: SMS iz Slovenije lahko racun ali operater omeji; izid »napaka« je v zapisniku.
 */
export function sprozNujnoObvestilo(
  root: string,
  call: Pick<CallSession, "callSid" | "vaja" | "order" | "nujniDogodki" | "nujnoBrezIzjave"> & { from?: string },
  zapisi: ZapisiDogodek,
  zahteva: ZahtevaTwilio = zahtevaPreizkusa ?? zahtevaTwilio,
): void {
  // Nujnost samo zaradi neuspele prevezave na zahtevo: lastnik je klic ze videl kot zgresen; brez dogodka, da se SMS poslje, ce klicatelj nujnost pove.
  if (call.vaja || !call.order.tajnica?.nujno || call.nujnoBrezIzjave) return;
  const kljuc = `${root}\n${call.callSid}`;
  const dogodki = (call.nujniDogodki ?? []).filter((d) => d.vrsta === "obvestilo");
  // Koncan izid (poslano, omejeno) je dokoncen; napaka dovoli omejen ponovni poskus na naslednjem obratu.
  if (dogodki.some((d) => d.izid !== "napaka") || dogodki.length >= NAJVEC_NAPAK_OBVESTILA || obvesceni.has(kljuc)) return;
  // Kljuc rezerviramo PRED asinhronim delom: dva hitra klica brez rezervacije bi oba poslala SMS.
  rezervirajObvestilo(kljuc);
  const delo = (async () => {
    const s = await beri(root);
    // »Ustavi vse« ustavi tudi nujno obvestilo (brez stevilke se pot konca kot pri izklopljenem stikalu).
    const stevilka = s.obvesti && !(await jeUstavljenoNujno(root)) ? await stevilkaOsebnega(root, s) : null;
    if (!stevilka) {
      obvesceni.delete(kljuc);
      return;
    }
    if (!(await rezervirajKvoto(root, call.callSid, call.from ?? ""))) {
      await zapisi(root, call.callSid, { cas: new Date().toISOString(), vrsta: "obvestilo", izid: "omejeno" });
      return;
    }
    let izid: NujniDogodek["izid"] = "napaka";
    try {
      const r = await preberi(root);
      if (r) {
        const glave = glava(r.sid, r.kljucSid, r.skrivnost);
        const seznam = await zahteva(`${OSNOVA}Accounts/${r.sid}/IncomingPhoneNumbers.json?PageSize=20`, { method: "GET", headers: glave });
        // Prva stevilka racuna, ki zna SMS (capabilities.sms ni false); brez takšne SMS ne gre.
        const stevilke = (seznam.json as { incoming_phone_numbers?: Array<Record<string, unknown>> } | null)?.incoming_phone_numbers ?? [];
        const prva = stevilke.find((n) => typeof n.phone_number === "string" && SID_TELEFONA.test(n.phone_number) && (n.capabilities as { sms?: unknown } | undefined)?.sms !== false);
        const od = typeof prva?.phone_number === "string" ? prva.phone_number : "";
        if (seznam.status === 200 && SID_TELEFONA.test(od)) {
          const telo = new URLSearchParams({ To: stevilka, From: od, Body: t("nujniSms") }).toString();
          const odg = await zahteva(`${OSNOVA}Accounts/${r.sid}/Messages.json`, { method: "POST", headers: glave, body: telo });
          if (odg.status === 201) izid = "poslano";
        }
      }
    } catch {
      izid = "napaka";
    }
    // Rezervacijo sprostimo SELE po zapisu napake (zapisi caka v vrsti klica): prej bi hiter naslednji obrat poskusil znova
    // in presegel NAJVEC_NAPAK_OBVESTILA.
    try {
      await zapisi(root, call.callSid, { cas: new Date().toISOString(), vrsta: "obvestilo", izid });
    } finally {
      if (izid === "napaka") obvesceni.delete(kljuc);
    }
  })().catch(() => undefined);
  vOzadju.add(delo);
  void delo.finally(() => vOzadju.delete(delo));
}
