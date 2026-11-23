import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import {
  CAKAJOCE_MS,
  NAJVEC_CAKAJOCIH,
  NAJVEC_OBDELANIH,
  VRSTE_OPRAVIL,
  ZAMUDA_POVZETKA_MIN,
  danKljuc,
  minuteIzCasa,
  pripraviPredlogo,
  smeAvtonomno,
  type Razlog,
  type StanjeAvtonomije,
  type VrstaOpravila,
} from "./avtonomija.ts";
import { jeUstavljeno, preberiNastavitvePravil, preberiStanje, spremeniStanje, zapisiDnevnik } from "./avtonomija-stanje.server.ts";
import { signalDenarja } from "./plast.ts";
import { readJsonFile } from "./store.server.ts";
import { glava, preberi, zahtevaTwilio, type ZahtevaTwilio } from "./twilio-racun.server.ts";
import { tA } from "./besedila-avtonomija.ts";

/**
 * Izvajalci avtonomnih opravil (faza 1: sms-predloga, povzetek-dneva), urnik in cakalna vrsta potrditev. Vsako dejanje gre skozi
 * smeAvtonomno() v ISTI transakciji, v kateri se rezervira dnevna omejitev; stranski ucinek sele nato. Ta datoteka NE sprejema nobenega
 * vhoda od klicatelja: dogodek »nujen klic« bere iz zapisov klicev na disku kot dejstvo (id), brez vsebine klica.
 */
const OSNOVA = "https://api.twilio.com/2010-04-01/";
const SID_TELEFONA = /^\+[1-9][0-9]{7,14}$/;
export const OBDOBJE_URNIKA_MS = 30_000;
/** Najvec novih nujnih klicev na en tik urnika (zasuk klicev ne sme zasuti prejemnika, meje so dodatna zapora). */
const NAJVEC_NOVIH_NA_TIK = 5;
/** Klic z zakljuckom v prihodnosti (pokvarjena ura ali datoteka) se ne obdela in ne premakne kazala naprej. */
const PRIHODNOST_MS = 5 * 60_000;
/** Najvecji mozen zgoscen id (16 sestnajstiskih znakov): kazalo z njim preskoci vse klice z istim casom. */
const NAJVECJI_HASH = "f".repeat(16);

/** Samo za preizkuse: zahteva proti API Twilio namesto prave (brez omrezja). */
let zahtevaPreizkusa: ZahtevaTwilio | null = null;
export function nastaviZahtevoAvtonomije(zahteva: ZahtevaTwilio | null = null): void {
  zahtevaPreizkusa = zahteva;
}

/**
 * Samo za preizkuse: klic tik po rezervaciji meje in tik PRED preverbo »ustavi vse« pred ucinkom (M19 slepega pregleda: ustavitev
 * natanko med transakcijo in posiljanjem ni bila preizkusljiva). Brez kavlja vedenje ni spremenjeno.
 */
let kavljePredUcinkom: (() => Promise<void>) | null = null;
export function nastaviKavljePredUcinkom(kavelj: (() => Promise<void>) | null = null): void {
  kavljePredUcinkom = kavelj;
}

export type IzidIzvedbe = { izid: "izvedeno" | "zavrnjeno" | "caka" | "napaka"; razlog?: Razlog };

function skrci(vrednost: string): string {
  return createHash("sha256").update(vrednost).digest("hex").slice(0, 16);
}

/**
 * SMS prek uporabnikovega racuna Twilio: prva stevilka racuna, ki zna SMS (kot nujno obvestilo). Besedilo napake posrednika
 * ne gre nikamor; vrne samo kodo. NEPREVERJENO s pravim Twilio: dostava iz slovenske stevilke, preizkusni racun (samo preverjene stevilke).
 */
async function posljiSms(root: string, stevilka: string, besedilo: string): Promise<"poslano" | "racun" | "posrednik"> {
  const zahteva = zahtevaPreizkusa ?? zahtevaTwilio;
  const r = await preberi(root);
  if (!r) return "racun";
  try {
    const g = glava(r.sid, r.kljucSid, r.skrivnost);
    const seznam = await zahteva(`${OSNOVA}Accounts/${r.sid}/IncomingPhoneNumbers.json?PageSize=20`, { method: "GET", headers: g });
    const stevilke = (seznam.json as { incoming_phone_numbers?: Array<Record<string, unknown>> } | null)?.incoming_phone_numbers ?? [];
    const prva = stevilke.find((n) => typeof n.phone_number === "string" && SID_TELEFONA.test(n.phone_number) && (n.capabilities as { sms?: unknown } | undefined)?.sms !== false);
    const od = typeof prva?.phone_number === "string" ? prva.phone_number : "";
    if (seznam.status !== 200 || !SID_TELEFONA.test(od) || !SID_TELEFONA.test(stevilka)) return "posrednik";
    const telo = new URLSearchParams({ To: stevilka, From: od, Body: besedilo }).toString();
    const odgovor = await zahteva(`${OSNOVA}Accounts/${r.sid}/Messages.json`, { method: "POST", headers: g, body: telo });
    return odgovor.status === 201 ? "poslano" : "posrednik";
  } catch {
    return "posrednik";
  }
}

/** E-posta, povezava (tudi brez »http«, tudi z unicode piko U+3002), IPv4 in telefonska stevilka (6 ali vec stevk) v besedilu klicatelja. */
const EPOSTA = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]*[\p{L}\p{N}]/gu;
const POVEZAVA = /(?:https?:\/\/|www\.)\S+/giu;
const DOMENA = /(?:[\p{L}\p{N}-]+[.。])+\p{L}{2,}(?:\/\S*)?/gu;
const IPV4 = /\d{1,3}(?:[.。]\d{1,3}){3}/g;
const STEVILKA = /\+?\d[\d\s().-]{4,}\d/g;
const DATUM = /^\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}$/;

function skrijOsebno(t: string): string {
  return t
    .replace(EPOSTA, tA("povzetekEposta"))
    .replace(POVEZAVA, tA("povzetekPovezava"))
    .replace(IPV4, tA("povzetekPovezava"))
    .replace(DOMENA, tA("povzetekPovezava"))
    .replace(STEVILKA, (m) => (DATUM.test(m) || m.replace(/\D/g, "").length < 6 ? m : tA("povzetekStevilka")));
}

function ocistiPolje(v: unknown, najvec: number): string {
  if (typeof v !== "string") return "";
  const t = skrijOsebno(v.normalize("NFKC").replace(/[\p{C}\u2028\u2029]+/gu, " ").replace(/\s+/g, " ").trim()).slice(0, najvec);
  // Povzetek se prebere kot Linin povzetek: zneski iz klica se ne prepisujejo (AGENTS.md: zneski iz sporocila ne gredo v povzetek).
  return signalDenarja(t) ? tA("povzetekZnesek") : t;
}

/** Povzetek klicev zadnjih 24 h v lokalno datoteko (0600). Brez stevilk in e-poste klicateljev, brez omrezja. */
export async function izdelajPovzetek(root: string, zdaj: Date): Promise<boolean> {
  let knjiga: Record<string, unknown> | null = null;
  try {
    knjiga = await readJsonFile<Record<string, unknown>>(root, "calls.json");
  } catch {
    return false;
  }
  const od = zdaj.getTime() - 24 * 3_600_000;
  const klici: Array<{ cas: number; vrstica: string; nujno: boolean }> = [];
  for (const klic of Object.values(knjiga ?? {})) {
    const k = klic as { startedAt?: unknown; order?: { customerName?: unknown; podjetjeKlicatelja?: unknown; tajnica?: { razlog?: unknown; sporocilo?: unknown; nujno?: unknown } } } | null;
    if (!k || typeof k !== "object" || typeof k.startedAt !== "string") continue;
    const cas = Date.parse(k.startedAt);
    if (!Number.isFinite(cas) || cas < od || cas > zdaj.getTime()) continue;
    const t = k.order?.tajnica;
    const nujno = t?.nujno === true;
    const ime = ocistiPolje(k.order?.customerName, 40) || tA("povzetekNeznan");
    const podjetje = ocistiPolje(k.order?.podjetjeKlicatelja, 40);
    const razlog = ocistiPolje(t?.razlog, 80);
    const sporocilo = ocistiPolje(t?.sporocilo, 120);
    const ura = `${String(new Date(cas).getHours()).padStart(2, "0")}:${String(new Date(cas).getMinutes()).padStart(2, "0")}`;
    const deli = [ura, nujno ? `${tA("povzetekNujno")}:` : "", ime, podjetje ? `(${podjetje})` : "", razlog ? `- ${razlog}` : "", sporocilo ? `- ${sporocilo}` : ""];
    klici.push({ cas, vrstica: deli.filter(Boolean).join(" "), nujno });
  }
  klici.sort((a, b) => Number(b.nujno) - Number(a.nujno) || a.cas - b.cas);
  const nujnih = klici.filter((k) => k.nujno).length;
  const besedilo = [
    `${tA("povzetekNaslov")} ${danKljuc(zdaj)}`,
    `${tA("povzetekSteviloKlicev")}: ${klici.length}, ${tA("povzetekSteviloNujnih")}: ${nujnih}`,
    "",
    ...(klici.length ? klici.slice(0, 40).map((k) => k.vrstica) : [tA("povzetekBrezKlicev")]),
    "",
  ].join("\n");
  const mapa = path.join(root, "povzetki");
  await mkdir(mapa, { recursive: true, mode: 0o700 });
  const cilj = path.join(mapa, `povzetek-${danKljuc(zdaj)}.txt`);
  const zacasna = path.join(mapa, `.povzetek.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  const f = await open(zacasna, "w", 0o600);
  try {
    await f.writeFile(besedilo, "utf8");
    await f.sync();
  } catch (e) {
    await f.close().catch(() => undefined);
    await unlink(zacasna).catch(() => undefined);
    throw e;
  }
  await f.close();
  await rename(zacasna, cilj).catch(async (e) => {
    await unlink(zacasna).catch(() => undefined);
    throw e;
  });
  return true;
}

/**
 * Rok hrambe povzetkov (N6): povzetki z besedilom klicateljev se ne hranijo za vedno. Rok je snemanjeHrambaDni iz pravil Line
 * (1 do 30, privzeto 7); starejse datoteke `povzetek-<dan>.txt` in zapusceni zacasni zapisi (`.povzetek.<pid>.<id>.tmp`, starejsi
 * od ure) se izbrisejo. Brise SAMO datoteke s tocno temi imeni v mapi povzetkov (ime se preveri z izrazom, nikoli ne gre skozi pot).
 */
export async function pocistiStarePovzetke(root: string, zdaj: Date): Promise<number> {
  const mapa = path.join(root, "povzetki");
  let imena: string[];
  try {
    imena = await readdir(mapa);
  } catch {
    return 0;
  }
  const { hrambaDni } = await preberiNastavitvePravil(root);
  const meja = new Date(zdaj);
  meja.setDate(meja.getDate() - (hrambaDni - 1));
  const najstarejsi = danKljuc(meja);
  let izbrisanih = 0;
  for (const ime of imena) {
    const m = /^povzetek-(\d{4}-\d{2}-\d{2})\.txt$/.exec(ime);
    if (m) {
      if (m[1] < najstarejsi && (await unlink(path.join(mapa, ime)).then(() => true, () => false))) izbrisanih += 1;
      continue;
    }
    if (/^\.povzetek\.\d+\.[0-9a-f]{8}\.tmp$/.test(ime)) {
      const s = await stat(path.join(mapa, ime)).catch(() => null);
      if (s && zdaj.getTime() - s.mtimeMs > 3_600_000 && (await unlink(path.join(mapa, ime)).then(() => true, () => false))) izbrisanih += 1;
    }
  }
  return izbrisanih;
}

type Odlocitev =
  | { akcija: "izvedi"; stevilka?: string; besedilo?: string }
  | { akcija: "caka" }
  | { akcija: "zavrni"; razlog: Razlog };

/**
 * Sprozi opravilo: preverba + rezervacija meje v transakciji, nato ucinek. `izvor` je samo oznaka, od kod prihaja sprozilec
 * (urnik, dogodek, uporabnik); drugi izvori so zavrnjeni v smeAvtonomno. `potrjeno` pride samo iz odobriCakajoce.
 */
export async function sprozi(
  root: string,
  opravilo: VrstaOpravila,
  izvor: string,
  povezavaId: string | undefined,
  sprozilecId: string,
  opcije: { zdaj?: Date; potrjeno?: boolean } = {},
): Promise<IzidIzvedbe> {
  const zdaj = opcije.zdaj ?? new Date();
  // Lastnikove dodatne dovoljene predpone (pravila Line): prejemnik mora ostati v smereh, ki jih sme klicati tudi nujno obvestilo.
  const { dovoljenePredpone } = await preberiNastavitvePravil(root);
  let odl: Odlocitev;
  try {
    odl = await spremeniStanje(root, (s): Odlocitev => {
      const o = smeAvtonomno(opravilo, { izvor, povezavaId, potrjeno: opcije.potrjeno === true }, s, zdaj, dovoljenePredpone);
      if (o.izid === "zavrni") return { akcija: "zavrni", razlog: o.razlog };
      if (o.izid === "zahtevaj-potrditev") {
        const ze = s.cakajoca.some((c) => c.vrsta === opravilo && c.povezavaId === (povezavaId ?? "") && c.sprozilecId === sprozilecId);
        if (ze) return { akcija: "caka" };
        if (s.cakajoca.length >= NAJVEC_CAKAJOCIH) return { akcija: "zavrni", razlog: "cakalna-vrsta" };
        s.cakajoca.push({
          id: randomBytes(8).toString("hex"),
          povezavaId: povezavaId ?? "",
          vrsta: opravilo,
          sprozilecId: sprozilecId.slice(0, 32),
          ustvarjeno: zdaj.toISOString(),
          poteceDo: new Date(zdaj.getTime() + CAKAJOCE_MS).toISOString(),
        });
        return { akcija: "caka" };
      }
      const prejemnik = o.prejemnikId ? s.prejemniki.find((p) => p.id === o.prejemnikId) : undefined;
      const predloga = o.predlogaId ? s.predloge.find((p) => p.id === o.predlogaId) : undefined;
      // Posle se TO, kar je bilo preverjeno (normalizirano in prirezano besedilo), nikoli surovo besedilo iz datoteke (N8).
      const pripravljena = predloga ? pripraviPredlogo(predloga.besedilo) : null;
      if (opravilo === "sms-predloga" && (!pripravljena || "napaka" in pripravljena)) return { akcija: "zavrni", razlog: "predloga" };
      // dovoli: meja se rezervira ze zdaj (tudi neuspela posiljka steje; brez ponavljanja pri napaki posrednika)
      const dan = danKljuc(zdaj);
      if (s.poraba.dan !== dan) s.poraba = { dan, vrste: {}, prejemniki: {} };
      s.poraba.vrste[opravilo] = (s.poraba.vrste[opravilo] ?? 0) + 1;
      if (o.prejemnikId) s.poraba.prejemniki[o.prejemnikId] = (s.poraba.prejemniki[o.prejemnikId] ?? 0) + 1;
      return { akcija: "izvedi", stevilka: prejemnik?.stevilka, besedilo: pripravljena && "besedilo" in pripravljena ? pripravljena.besedilo : undefined };
    });
  } catch {
    await zapisiDnevnik(root, { opravilo, izid: "zavrnjeno", razlog: "stanje", povezavaId }, zdaj);
    return { izid: "zavrnjeno", razlog: "stanje" };
  }
  if (odl.akcija === "zavrni") {
    await zapisiDnevnik(root, { opravilo, izid: "zavrnjeno", razlog: odl.razlog, povezavaId }, zdaj);
    return { izid: "zavrnjeno", razlog: odl.razlog };
  }
  if (odl.akcija === "caka") {
    await zapisiDnevnik(root, { opravilo, izid: "caka", razlog: "nacin-potrditev", povezavaId }, zdaj);
    return { izid: "caka", razlog: "nacin-potrditev" };
  }
  if (kavljePredUcinkom) await kavljePredUcinkom();
  // Stikalo »ustavi vse« tik pred ucinkom: dejanje, ki ga uporabnik ustavi med rezervacijo in posiljanjem, se ne zgodi.
  if (await jeUstavljeno(root)) {
    await zapisiDnevnik(root, { opravilo, izid: "preklicano", razlog: "ustavljeno", povezavaId }, zdaj);
    return { izid: "zavrnjeno", razlog: "ustavljeno" };
  }
  try {
    if (opravilo === "sms-predloga") {
      if (!odl.stevilka || !odl.besedilo) throw new Error("manjka");
      const izid = await posljiSms(root, odl.stevilka, odl.besedilo);
      if (izid !== "poslano") {
        await zapisiDnevnik(root, { opravilo, izid: "napaka", razlog: izid, povezavaId }, zdaj);
        return { izid: "napaka", razlog: izid };
      }
    } else if (!(await izdelajPovzetek(root, zdaj))) {
      await zapisiDnevnik(root, { opravilo, izid: "napaka", razlog: "stanje", povezavaId }, zdaj);
      return { izid: "napaka", razlog: "stanje" };
    }
  } catch {
    await zapisiDnevnik(root, { opravilo, izid: "napaka", razlog: "posrednik", povezavaId }, zdaj);
    return { izid: "napaka", razlog: "posrednik" };
  }
  await zapisiDnevnik(root, { opravilo, izid: "izvedeno", povezavaId }, zdaj);
  return { izid: "izvedeno" };
}

/** Odobritev cakajocega dejanja (poklice jo samo avtonomija.server.ts po preverbi seje lastnika). Pravila se ZNOVA preverijo. */
export async function odobriCakajoce(root: string, id: string, zdaj: Date = new Date()): Promise<IzidIzvedbe> {
  let c: { vrsta: VrstaOpravila; povezavaId: string; sprozilecId: string; poteceDo: string } | null = null;
  try {
    c = await spremeniStanje(root, (s) => {
      const i = s.cakajoca.findIndex((x) => x.id === id);
      if (i < 0) return null;
      const [x] = s.cakajoca.splice(i, 1);
      return { vrsta: x.vrsta, povezavaId: x.povezavaId, sprozilecId: x.sprozilecId, poteceDo: x.poteceDo };
    });
  } catch {
    return { izid: "zavrnjeno", razlog: "stanje" };
  }
  if (!c) return { izid: "zavrnjeno", razlog: "cakalna-vrsta" };
  if (Date.parse(c.poteceDo) <= zdaj.getTime()) {
    await zapisiDnevnik(root, { opravilo: c.vrsta, izid: "poteklo", razlog: "poteklo", povezavaId: c.povezavaId }, zdaj);
    return { izid: "zavrnjeno", razlog: "poteklo" };
  }
  await zapisiDnevnik(root, { opravilo: c.vrsta, izid: "potrjeno", povezavaId: c.povezavaId }, zdaj);
  return sprozi(root, c.vrsta, "uporabnik", c.povezavaId || undefined, c.sprozilecId, { zdaj, potrjeno: true });
}

export async function odkloniCakajoce(root: string, id: string, zdaj: Date = new Date()): Promise<boolean> {
  const c = await spremeniStanje(root, (s) => {
    const i = s.cakajoca.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const [x] = s.cakajoca.splice(i, 1);
    return { vrsta: x.vrsta, povezavaId: x.povezavaId };
  }).catch(() => null);
  if (!c) return false;
  await zapisiDnevnik(root, { opravilo: c.vrsta, izid: "odklonjeno", povezavaId: c.povezavaId }, zdaj);
  return true;
}

/** Samodejni iztek: pravilo po datumu postane izklopljeno; potekla cakajoca dejanja se zavrzejo. */
export async function pocistiPotekla(root: string, zdaj: Date): Promise<void> {
  const izid = await spremeniStanje(root, (s) => {
    const pravila: VrstaOpravila[] = [];
    for (const vrsta of VRSTE_OPRAVIL) {
      const p = s.pravila[vrsta];
      if (p.nacin === "izklopljeno") continue;
      if (!p.veljaDo || Date.parse(p.veljaDo) <= zdaj.getTime()) {
        p.nacin = "izklopljeno";
        p.veljaDo = null;
        p.aktivnoOd = null;
        pravila.push(vrsta);
      }
    }
    const potekla = s.cakajoca.filter((c) => Date.parse(c.poteceDo) <= zdaj.getTime()).map((c) => ({ vrsta: c.vrsta, povezavaId: c.povezavaId }));
    s.cakajoca = s.cakajoca.filter((c) => Date.parse(c.poteceDo) > zdaj.getTime());
    return { pravila, potekla };
  }).catch(() => null);
  if (!izid) return;
  for (const vrsta of izid.pravila) await zapisiDnevnik(root, { opravilo: vrsta, izid: "poteklo", razlog: "poteklo" }, zdaj);
  for (const c of izid.potekla) await zapisiDnevnik(root, { opravilo: c.vrsta, izid: "poteklo", razlog: "poteklo", povezavaId: c.povezavaId }, zdaj);
}

type KlicNaDisku = { status?: unknown; updatedAt?: unknown; vaja?: unknown; order?: { tajnica?: { nujno?: unknown } } };

/** Cas zakljucka nujnega klica, ki se je koncal po vklopu pravila, sicer null. Gre samo za dejstva (stanje, oznaka, cas): vsebina klica se ne bere. */
function casNujnegaKoncanega(klic: unknown, aktivnoOd: number): number | null {
  const k = klic as KlicNaDisku | null;
  if (!k || typeof k !== "object" || k.status !== "zakljucen" || k.vaja) return null;
  if (k.order?.tajnica?.nujno !== true || typeof k.updatedAt !== "string") return null;
  const cas = Date.parse(k.updatedAt);
  return Number.isFinite(cas) && cas >= aktivnoOd ? cas : null;
}

/** Je (cas, id) za kazalom? Celoten vrstni red (cas, nato id): klic, ki ni za kazalom, je ze obdelan ali pa je bil ob »ustavi vse« preskocen. */
function zaKazalcem(cas: number, h: string, k: StanjeAvtonomije["kazalec"]): boolean {
  return cas > k.nujniCas || (cas === k.nujniCas && h > k.nujniHash);
}

/**
 * Dogodek »nujen klic«: za vsako povezavo uporabnika poskus opravila. Klic se oznaci kot obdelan PRED poskusom (najvec enkrat) in
 * v isti transakciji (pod kljucavnico), v kateri se kazalo premakne: dva procesa istega klica ne obdelata oba. Kazalo je
 * monotono po (cas zakljucka, id): po 200 klicih se stari ne ponavljajo (N4), poleg tega se hrani zadnjih 200 id-jev.
 */
export async function obdelajNujne(root: string, zdaj: Date): Promise<void> {
  const b = await preberiStanje(root);
  if (b.pokvarjeno || b.stanje.ustavljeno) return;
  const pravilo = b.stanje.pravila["sms-predloga"];
  if (pravilo.nacin === "izklopljeno" || !pravilo.aktivnoOd) return;
  // N4 2. pregleda: brez sprozilca »nujen klic« se kazalo prej ni premaknilo, zato so se klici, ki so se koncali brez sprozilca, ob
  // dodajanju sprozilca poslali za nazaj (SMS za stare klice). Kazalo se premakne tudi takrat, ko je nic za sprozit.
  if (!b.stanje.povezave.some((q) => q.sprozilec === "nujen-klic")) {
    await premakniKazaloNujnih(root, zdaj);
    return;
  }
  const od = Date.parse(pravilo.aktivnoOd);
  let knjiga: Record<string, unknown> | null = null;
  try {
    knjiga = await readJsonFile<Record<string, unknown>>(root, "calls.json");
  } catch {
    return;
  }
  const videni = new Set(b.stanje.kazalec.nujniObdelani);
  const zgornja = zdaj.getTime() + PRIHODNOST_MS;
  const kandidati: Array<{ cas: number; h: string }> = [];
  for (const [sid, klic] of Object.entries(knjiga ?? {})) {
    const cas = casNujnegaKoncanega(klic, od);
    if (cas === null || cas > zgornja) continue;
    const h = skrci(sid);
    if (videni.has(h) || !zaKazalcem(cas, h, b.stanje.kazalec)) continue;
    kandidati.push({ cas, h });
  }
  if (kandidati.length === 0) return;
  // Najstarejsi najprej: kazalo se premakne na zadnjega izbranega, preostali (novejsi) pridejo na vrsto ob naslednjem tiku.
  kandidati.sort((a, c) => a.cas - c.cas || (a.h < c.h ? -1 : a.h > c.h ? 1 : 0));
  const izbrani = kandidati.slice(0, NAJVEC_NOVIH_NA_TIK);
  const prazno = { novi: [] as string[], povezave: [] as string[] };
  const izid = await spremeniStanje(root, (s) => {
    const p = s.pravila["sms-predloga"];
    if (s.ustavljeno || p.nacin === "izklopljeno" || !p.aktivnoOd) return prazno;
    const vid = new Set(s.kazalec.nujniObdelani);
    const aktivnoOd = Date.parse(p.aktivnoOd);
    const novi = izbrani.filter((x) => !vid.has(x.h) && x.cas >= aktivnoOd && zaKazalcem(x.cas, x.h, s.kazalec));
    for (const x of novi) {
      s.kazalec.nujniObdelani.push(x.h);
      s.kazalec.nujniCas = x.cas;
      s.kazalec.nujniHash = x.h;
    }
    while (s.kazalec.nujniObdelani.length > NAJVEC_OBDELANIH) s.kazalec.nujniObdelani.shift();
    return { novi: novi.map((x) => x.h), povezave: s.povezave.filter((q) => q.sprozilec === "nujen-klic").map((q) => q.id) };
  }).catch(() => prazno);
  for (const h of izid.novi) for (const id of izid.povezave) await sprozi(root, "sms-predloga", "dogodek", id, h, { zdaj });
}

/**
 * Med »Ustavi vse« ali LINA_AVTONOMIJA=0 klici, ki se koncajo, ne smejo ostati »novi«: po »Nadaljuj« bi sprozili SMS za nazaj
 * (N5). Zato se med ustavitvijo kazalo vsak tik premakne na zdaj; vsi klici do takrat so s tem preskoceni (ne obdelani).
 * Dodatno »Nadaljuj« premakne tudi aktivnoOd (avtonomija.server.ts).
 */
export async function premakniKazaloNujnih(root: string, zdaj: Date): Promise<void> {
  const cas = zdaj.getTime();
  if (!Number.isSafeInteger(cas) || cas < 0) return;
  await spremeniStanje(root, (s) => {
    if (cas > s.kazalec.nujniCas) {
      s.kazalec.nujniCas = cas;
      s.kazalec.nujniHash = NAJVECJI_HASH;
    }
  }).catch(() => undefined);
}

/**
 * N3 2. pregleda: kazalo, ki je pred `zdaj + PRIHODNOST_MS`, bi po popravku ure (ali ob pokvarjeni datoteki) tiho preskocilo vse nujne
 * klice do tja. Zato se vrne: med ustavitvijo na `zdaj` (klici do zdaj so preskoceni, kot pri premakniKazaloNujnih), sicer za
 * PRIHODNOST_MS nazaj (ze obdelani klici so v seznamu `nujniObdelani`, zato se ne ponovijo). Vsak popravek gre v dnevnik (samo koda).
 */
export async function uskladiKazaloNujnih(root: string, zdaj: Date): Promise<boolean> {
  const cas = zdaj.getTime();
  if (!Number.isSafeInteger(cas) || cas < 0) return false;
  const b = await preberiStanje(root);
  if (b.pokvarjeno || b.stanje.kazalec.nujniCas <= cas + PRIHODNOST_MS) return false;
  const ustavljeno = await jeUstavljeno(root);
  const popravljeno = await spremeniStanje(root, (s) => {
    if (s.kazalec.nujniCas <= cas + PRIHODNOST_MS) return false;
    s.kazalec.nujniCas = ustavljeno ? cas : Math.max(0, cas - PRIHODNOST_MS);
    s.kazalec.nujniHash = ustavljeno ? NAJVECJI_HASH : "";
    return true;
  }).catch(() => false);
  if (popravljeno) await zapisiDnevnik(root, { opravilo: "sistem", izid: "preskoceno", razlog: "kazalo-ura" }, zdaj);
  return popravljeno;
}

/** Razporeditev povzetka dneva: ob nastavljeni uri; zamujen zagon (npr. Lina ni tekla) se PRESKOCI, ne nadomesti. */
export async function obdelajUrnik(root: string, zdaj: Date): Promise<void> {
  const b = await preberiStanje(root);
  if (b.pokvarjeno || b.stanje.ustavljeno) return;
  const s0 = b.stanje;
  const pravilo = s0.pravila["povzetek-dneva"];
  if (pravilo.nacin === "izklopljeno" || !pravilo.aktivnoOd) return;
  const danes = danKljuc(zdaj);
  if (s0.kazalec.zadnjiPovzetek === danes) return;
  const ura = minuteIzCasa(s0.povzetekUra);
  const zdajMin = zdaj.getHours() * 60 + zdaj.getMinutes();
  if (zdajMin < ura) return;
  const aktivno = new Date(pravilo.aktivnoOd);
  const aktivnoMin = aktivno.getHours() * 60 + aktivno.getMinutes();
  const vklopPoUri = danKljuc(aktivno) === danes && aktivnoMin > ura;
  const zamujeno = zdajMin > ura + ZAMUDA_POVZETKA_MIN;
  await spremeniStanje(root, (s) => {
    s.kazalec.zadnjiPovzetek = danes;
  }).catch(() => undefined);
  if (vklopPoUri) return;
  if (zamujeno) {
    await zapisiDnevnik(root, { opravilo: "povzetek-dneva", izid: "preskoceno", razlog: "zamujeno" }, zdaj);
    return;
  }
  await sprozi(root, "povzetek-dneva", "urnik", undefined, danes, { zdaj });
}

/** En obhod urnika. Ustavljeno ali pokvarjeno stanje: nic (le kazalo nujnih klicev se premakne naprej, glej premakniKazaloNujnih). */
export async function tikAvtonomije(root: string, zdaj: Date = new Date()): Promise<void> {
  // Hramba povzetkov je skrb za zasebnost (brise samo lastne stare datoteke), zato velja tudi med ustavitvijo.
  await pocistiStarePovzetke(root, zdaj).catch(() => 0);
  await uskladiKazaloNujnih(root, zdaj).catch(() => false);
  if (await jeUstavljeno(root)) {
    await premakniKazaloNujnih(root, zdaj);
    return;
  }
  await pocistiPotekla(root, zdaj);
  await obdelajNujne(root, zdaj);
  await obdelajUrnik(root, zdaj);
}

const tekoci = new Map<string, ReturnType<typeof setInterval>>();

/** Zagon urnika (idempotentno na mapo). Casovnik ne drzi procesa pri zivljenju; napaka obhoda ne podre ostalih. */
export function zazeniAvtonomijo(root: string, obdobjeMs: number = OBDOBJE_URNIKA_MS): void {
  if (tekoci.has(root)) return;
  let zaseden = false;
  const tik = async () => {
    if (zaseden) return;
    zaseden = true;
    try {
      await tikAvtonomije(root);
    } catch {
      // naslednji obhod poskusi znova; dnevnik pove razlog zavrnitev, ne napak urnika
    } finally {
      zaseden = false;
    }
  };
  const id = setInterval(() => void tik(), obdobjeMs);
  id.unref?.();
  tekoci.set(root, id);
  setTimeout(() => void tik(), 5_000).unref?.();
}

export function ustaviAvtonomijo(root: string): void {
  const id = tekoci.get(root);
  if (id) clearInterval(id);
  tekoci.delete(root);
}
