import { connect as h2Povezi, constants as H2, type ClientHttp2Session } from "node:http2";
import { Agent, request as httpsZahteva, type AgentOptions } from "node:https";
import { Readable } from "node:stream";
import { trenutniZbiralnik } from "./meritve.server.ts";

/**
 * Bazen ogretih povezav do Googla (Vertex, TTS) - lastnik 12. 11. 2026: povezava je zelo pomemben del odzivnosti.
 * Brez njega vsak obrat po vec kot nekaj sekundah tisine placa DNS + TCP + TLS (izmerjeno 12. 11. na prenosniku: tls 0,13-0,32 s).
 * Algoritem (prevzet kot zamisel iz Safeerjevih Link/Usenet bazenov, koda je nova):
 *  - vnaprej odprta povezava se ob dejavnosti klica vzdrzuje z lahkim zahtevkom, preden jo streznik zapre zaradi tisine;
 *  - ponovna raba (lifo), omejitev hkratnosti, nedejavna povezava se po roku zavrze;
 *  - ob 429 se hkratnost razpolovi in ogrevanje ustavi s premorom, ki se podvaja do zgornje meje; po mirnem casu se vrne.
 * Stikalo je privzeto IZKLOPLJENO: takrat vse gre prek obicajnega fetch kot doslej (nastavitev »toplePovezave«).
 * Undici Agent ni mogoc: paket undici ni nameščen (uvoz je ERR_MODULE_NOT_FOUND), vgrajeni undici v Node pa ne izvozi Agenta.
 * Zato node:https Agent (keepAlive); HTTP/1.1, torej vzporedni kosi odprejo vsak svojo povezavo.
 */

export const PRIVZETO_NAJVEC_HKRATI = 8;
export const PROSTA_NAJDLJE_MS = 55_000;
export const PREMOR_ZACETEK_MS = 2_000;
export const PREMOR_NAJVEC_MS = 60_000;
/** Mirovanje brez 429, po katerem se hkratnost poveca za ena in premor pozabi. */
export const RAST_MS = 30_000;
export const NAJMANJ_HKRATI = 2;

/** Stanje bazena brez omrezja: preizkusljivo z vstavljeno uro. */
export class StanjeBazena {
  private tekoci: number;
  private premor = 0;
  private doPremora = 0;
  private zadnji429 = -Infinity;
  private zadnjaRast = -Infinity;

  private readonly najvec: number;

  constructor(najvec = PRIVZETO_NAJVEC_HKRATI) {
    this.najvec = najvec;
    this.tekoci = najvec;
  }

  najvecHkrati(): number {
    return this.tekoci;
  }

  ob429(zdaj: number): void {
    this.premor = this.premor === 0 ? PREMOR_ZACETEK_MS : Math.min(PREMOR_NAJVEC_MS, this.premor * 2);
    this.doPremora = zdaj + this.premor;
    this.zadnji429 = zdaj;
    this.zadnjaRast = zdaj;
    // Najmanj 2: en obrat potrebuje dva vzporedna kosa TTS (ali hedge); pri 1 bi se zaporedoma cakala na isti povezavi in
    // obrat po nepotrebnem podaljsala (pregled 12. 11. 2026, A6). Obremenitev zmanjsa predvsem premor ogrevanja.
    this.tekoci = Math.max(NAJMANJ_HKRATI, Math.floor(this.tekoci / 2));
  }

  obUspehu(zdaj: number): void {
    if (this.zadnji429 === -Infinity || zdaj - this.zadnjaRast < RAST_MS) return;
    this.zadnjaRast = zdaj;
    this.premor = 0;
    if (this.tekoci < this.najvec) this.tekoci += 1;
  }

  smeOgrevati(zdaj: number): boolean {
    return zdaj >= this.doPremora;
  }

  /** Ob izklopu stikala ali zamenjavi racuna: bazen zacne cist. */
  ponastavi(): void {
    this.tekoci = this.najvec;
    this.premor = 0;
    this.doPremora = 0;
    this.zadnji429 = -Infinity;
    this.zadnjaRast = -Infinity;
  }

  premorDo(): number {
    return this.doPremora;
  }
}

const jeGoogle = (gostitelj: string): boolean => /(^|\.)googleapis\.com$/i.test(gostitelj);

let vklopljeno = false;
let agent: Agent | null = null;
export const stanje = new StanjeBazena();

export function nastaviToplePovezave(vklop: boolean): void {
  if (vklop === vklopljeno) return;
  vklopljeno = vklop;
  stanje.ponastavi();
  if (!vklop) {
    ustaviOgrevanje();
    // Stari bazen ne dobi novih zahtev; proste povezave se same zaprejo po PROSTA_NAJDLJE_MS, zasedene dokoncajo delo.
    agent = null;
  }
}

export function toplePovezaveVklopljene(): boolean {
  return vklopljeno;
}

let dovoli: (gostitelj: string) => boolean = jeGoogle;
let opcijeAgenta: AgentOptions = {};

/** Samo za preizkuse: drug gostitelj (lokalni streznik) in svoj CA. Brez argumenta povrne privzeto. http2: privzeto izklopljen za lokalni streznik. */
export function nastaviPovezaveZaPreizkus(o?: { dovoli?: (gostitelj: string) => boolean; agent?: AgentOptions; http2?: boolean }): void {
  dovoli = o?.dovoli ?? jeGoogle;
  opcijeAgenta = o?.agent ?? {};
  agent?.destroy();
  agent = null;
  http2Preizkus = o ? (o.http2 ?? false) : true;
  zapriSejoH2();
  h2PremorDo = 0;
}

// --- HTTP/2 do Vertexa (lastnik 14. 11. 2026: »se vgradi«) -----------------------------------------------------------
/**
 * (Privzeto izklopljeno, glej http2Vklop.) Ena trajna seja HTTP/2 na izvor (multipleks: model in vzporedni kosi TTS na isti povezavi), ogreta z ogrej(). Ob napaki seje (GOAWAY, zavrnjen
 * tok, napaka povezave) PRED odgovorom gre ta zahteva enkrat po HTTP/1.1 (bazen zgoraj), HTTP/2 pa pocaka H2_PREMOR_PO_NAPAKI_MS. Rok klicatelja
 * (signal) velja za oba poskusa: po izteku roka ni ponovitve. Preusmeritve se ne sledijo, TLS se preverja (privzeti CA, kot https).
 */
export const H2_PROSTA_NAJDLJE_MS = PROSTA_NAJDLJE_MS;
export const H2_PREMOR_PO_NAPAKI_MS = 60_000;
// Privzeto IZKLOPLJENO: izmerjeno 14. 11. 2026 v Lini (2 teka x 48, izmenicno) HTTP/2 ni hitrejsi od bazena HTTP/1.1 (ogreto mediana 761|741 proti
// 754|814 ms, p95 slabsi 2787|3424 proti >4000|2667; hladno 1053|1062 proti 1032|1052). Lastnik odloci o vklopu (nastaviHttp2).
let http2Vklop = false;
let http2Preizkus = true;
let seja: ClientHttp2Session | null = null;
let sejaIzvor = "";
let sejaOdprta = false;
let h2PremorDo = 0;
const aktivnihTokov = new WeakMap<ClientHttp2Session, number>();

export function nastaviHttp2(vklop: boolean): void {
  http2Vklop = vklop;
  if (!vklop) zapriSejoH2();
}
export function http2Vklopljen(): boolean {
  return http2Vklop;
}
export function zapriSejoH2(): void {
  const s = seja;
  seja = null;
  sejaOdprta = false;
  if (s && !s.destroyed) s.destroy();
}

function dobiSejo(izvor: string): { s: ClientHttp2Session; topla: boolean } {
  if (seja && !seja.closed && !seja.destroyed && sejaIzvor === izvor) return { s: seja, topla: sejaOdprta };
  zapriSejoH2();
  const s = h2Povezi(izvor, { ...(opcijeAgenta.ca ? { ca: opcijeAgenta.ca } : {}), settings: { enablePush: false } });
  seja = s;
  sejaIzvor = izvor;
  s.once("connect", () => {
    if (seja === s) sejaOdprta = true;
  });
  const pozabi = () => {
    if (seja === s) {
      seja = null;
      sejaOdprta = false;
    }
  };
  s.on("goaway", pozabi);
  s.on("close", pozabi);
  s.on("error", pozabi);
  // Prosta seja se zapre po roku (kot bazen HTTP/1.1); proces drzi samo, dokler tecejo zahteve.
  s.setTimeout(H2_PROSTA_NAJDLJE_MS, () => s.close());
  s.unref();
  return { s, topla: false };
}

class NapakaH2 extends Error {
  readonly vzrok: unknown;
  readonly zaRezervo: boolean;
  constructor(vzrok: unknown, zaRezervo: boolean) {
    super("http2");
    this.vzrok = vzrok;
    this.zaRezervo = zaRezervo;
  }
}

const H2_PREPOVEDANE = new Set(["host", "connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection"]);

function h2Zahteva(url: URL, init: RequestInit, kosi: Buffer | undefined): Promise<{ odgovor: Response; topla: boolean }> {
  return new Promise((resolve, reject) => {
    const signal = init.signal ?? undefined;
    if (signal?.aborted) return reject(signal.reason ?? new DOMException("Prekinjeno", "AbortError"));
    let s: ClientHttp2Session;
    let topla: boolean;
    try {
      ({ s, topla } = dobiSejo(url.origin));
    } catch (napaka) {
      return reject(new NapakaH2(napaka, true));
    }
    const zaglavje: Record<string, string> = { [H2.HTTP2_HEADER_METHOD]: init.method ?? "GET", [H2.HTTP2_HEADER_PATH]: `${url.pathname}${url.search}` };
    for (const [ime, vrednost] of Object.entries(glave(init))) if (!H2_PREPOVEDANE.has(ime)) zaglavje[ime] = vrednost;
    let odgovorjeno = false;
    const tok = s.request(zaglavje, { endStream: kosi === undefined });
    // Seja drzi proces samo, dokler tecejo zahteve (prosta seja ne sme zadrzati izhoda; zahteva v teku ga mora).
    aktivnihTokov.set(s, (aktivnihTokov.get(s) ?? 0) + 1);
    s.ref();
    tok.once("close", () => {
      const ostane = Math.max(0, (aktivnihTokov.get(s) ?? 1) - 1);
      aktivnihTokov.set(s, ostane);
      if (ostane === 0 && !s.destroyed) s.unref();
    });
    const obPrekinitvi = () => {
      tok.close(H2.NGHTTP2_CANCEL);
      if (!odgovorjeno) reject(signal?.reason ?? new DOMException("Prekinjeno", "AbortError"));
    };
    signal?.addEventListener("abort", obPrekinitvi, { once: true });
    tok.on("close", () => signal?.removeEventListener("abort", obPrekinitvi));
    tok.on("response", (h) => {
      odgovorjeno = true;
      const status = Number(h[H2.HTTP2_HEADER_STATUS] ?? 0);
      if (status >= 300 && status < 400 && h.location) {
        tok.close(H2.NGHTTP2_CANCEL);
        return reject(new NapakaH2(new TypeError("fetch failed: redirect"), false));
      }
      const g = new Headers();
      for (const [ime, vrednost] of Object.entries(h)) {
        if (ime.startsWith(":")) continue;
        if (Array.isArray(vrednost)) for (const v of vrednost) g.append(ime, v);
        else if (vrednost !== undefined) g.append(ime, String(vrednost));
      }
      const brez = BREZ_TELESA.has(status) || init.method === "HEAD";
      if (brez) tok.resume();
      resolve({ odgovor: new Response(brez ? null : (Readable.toWeb(tok) as unknown as ReadableStream<Uint8Array>), { status, statusText: "", headers: g }), topla });
    });
    tok.on("error", (napaka) => {
      // Pred odgovorom: rezerva HTTP/1.1 (ce rok se ni potekel). Po odgovoru napako vidi bralec telesa.
      if (!odgovorjeno && !signal?.aborted) reject(new NapakaH2(napaka, true));
    });
    if (kosi !== undefined) tok.end(kosi);
  });
}


const vsiAgenti = new Set<Agent>();
let izhodVezan = false;

/** Zapre vse povezave vseh bazenov (ob zaprtju programa; tudi stare, ki jih je izklop stikala odlozil). */
export function zapriBazen(): void {
  zapriSejoH2();
  for (const a of vsiAgenti) a.destroy();
  vsiAgenti.clear();
  agent = null;
}

function dobiAgent(): Agent {
  if (!izhodVezan) {
    izhodVezan = true;
    // Ob zaprtju Line (konec procesa) se povezave zaprejo, da ne ostanejo odprte do izteka casovnika.
    process.once("exit", zapriBazen);
    process.once("beforeExit", zapriBazen);
  }
  const nov = agent === null;
  agent ??= new Agent({ keepAlive: true, maxSockets: stanje.najvecHkrati(), maxFreeSockets: 4, timeout: PROSTA_NAJDLJE_MS, scheduling: "lifo", ...opcijeAgenta });
  if (nov) vsiAgenti.add(agent);
  agent.maxSockets = stanje.najvecHkrati();
  return agent;
}


function glave(init?: RequestInit): Record<string, string> {
  const izid: Record<string, string> = {};
  new Headers(init?.headers).forEach((vrednost, ime) => {
    izid[ime] = vrednost;
  });
  return izid;
}

function telo(init?: RequestInit): Buffer | undefined {
  const b = init?.body;
  if (b == null) return undefined;
  if (typeof b === "string") return Buffer.from(b);
  if (b instanceof Uint8Array) return Buffer.from(b);
  throw new TypeError("Bazen povezav sprejme samo besedilo ali bajte v telesu.");
}

const BREZ_TELESA = new Set([101, 204, 205, 304]);
/** Tekma pri prosti povezavi se pokaze v nekaj ms; kar je pocasnejse, je prekinitev med obdelavo in se ne ponovi. */
export const NAJDLJE_ZA_PONOVITEV_MS = 150;

type Poskus = { odgovor: Response; ponovno?: false } | { ponovno: true };

function poskusi(url: URL, init: RequestInit, kosi: Buffer | undefined, rabljena: { v: boolean | null }): Promise<Poskus> {
  return new Promise((resolve, reject) => {
    const signal = init.signal ?? undefined;
    if (signal?.aborted) return reject(signal.reason ?? new DOMException("Prekinjeno", "AbortError"));
    const zacetek = performance.now();
    let preBajtov = -1;
    const zahteva = httpsZahteva(url, { method: init.method ?? "GET", headers: glave(init), agent: dobiAgent() }, (res) => {
      rabljena.v = zahteva.reusedSocket;
      const status = res.statusCode ?? 0;
      // redirect: "error" kot pri fetch: ne sledimo preusmeritvam, ker nosijo kljuc.
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        zahteva.destroy();
        return reject(new TypeError("fetch failed: redirect"));
      }
      const g = new Headers();
      for (const [ime, vrednost] of Object.entries(res.headers)) {
        if (Array.isArray(vrednost)) for (const v of vrednost) g.append(ime, v);
        else if (vrednost !== undefined) g.append(ime, vrednost);
      }
      const odgovor = new Response(BREZ_TELESA.has(status) ? null : (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>), {
        status,
        statusText: res.statusMessage ?? "",
        headers: g,
      });
      if (BREZ_TELESA.has(status)) res.resume();
      resolve({ odgovor });
    });
    const obPrekinitvi = () => zahteva.destroy(signal?.reason ?? new DOMException("Prekinjeno", "AbortError"));
    signal?.addEventListener("abort", obPrekinitvi, { once: true });
    zahteva.on("close", () => signal?.removeEventListener("abort", obPrekinitvi));
    zahteva.on("socket", (s) => {
      preBajtov = s.bytesRead;
    });
    zahteva.on("error", (napaka: NodeJS.ErrnoException) => {
      // Znana tekma: streznik je tiho zaprl prosto povezavo, ravno ko smo jo vzeli. Ponovitev (ena, na novi povezavi) SAMO ce je
      // povezava bila rabljena, od streznika ni prisel noben bajt in je od zacetka minilo malo casa. Pri POST (model, TTS) bi
      // sicer ponovitev po prekinitvi sredi obdelave pomenila dvojni klic in dvojni strosek (pregled 12. 11. 2026, A1).
      const hitro = performance.now() - zacetek <= NAJDLJE_ZA_PONOVITEV_MS;
      const brezBajtov = zahteva.socket != null && preBajtov >= 0 && zahteva.socket.bytesRead === preBajtov;
      if (zahteva.reusedSocket && hitro && brezBajtov && (napaka.code === "ECONNRESET" || napaka.code === "EPIPE")) return resolve({ ponovno: true });
      reject(napaka);
    });
    zahteva.end(kosi);
  });
}

/**
 * fetch za Googlove gostitelje prek ogretega bazena. Izklopljeno ali tuj gostitelj: obicajni fetch (isti rezultat kot doslej).
 * Meritev: zapise hladno/toplo povezavo in 429 v zbiralnik trenutnega obrata (samo stevila).
 */
export async function topliFetch(vhod: string | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(vhod);
  if (!vklopljeno || url.protocol !== "https:" || !dovoli(url.hostname)) return fetch(url.toString(), init);
  const kosi = telo(init);
  // HTTP/2 (ce je vklopljen): ena trajna seja; ob napaki seje pred odgovorom enkrat HTTP/1.1 in premor HTTP/2.
  if (http2Vklop && http2Preizkus && Date.now() >= h2PremorDo) {
    try {
      const { odgovor, topla } = await h2Zahteva(url, init, kosi);
      trenutniZbiralnik()?.povezava(topla);
      if (odgovor.status === 429) stanje.ob429(Date.now());
      else if (odgovor.status < 500) stanje.obUspehu(Date.now());
      return odgovor;
    } catch (napaka) {
      if (!(napaka instanceof NapakaH2)) throw napaka;
      if (!napaka.zaRezervo) throw napaka.vzrok;
      h2PremorDo = Date.now() + H2_PREMOR_PO_NAPAKI_MS;
      // Rok, ki je potekel med tem, prepreci tudi HTTP/1.1 (poskusi zavrne prekinjen signal brez zahteve).
      zapriSejoH2();
    }
  }
  const rabljena: { v: boolean | null } = { v: null };
  let izid = await poskusi(url, init, kosi, rabljena);
  let ponovljeno = false;
  if (izid.ponovno) {
    ponovljeno = true;
    izid = await poskusi(url, init, kosi, rabljena);
  }
  if (izid.ponovno) throw new TypeError("fetch failed");
  // Ponovitev po zaprti prosti povezavi pomeni, da je bila prva ze nerabna: obrat je placal novo povezavo.
  trenutniZbiralnik()?.povezava(rabljena.v === true && !ponovljeno);
  const { status } = izid.odgovor;
  // 429 v meritev zapise klicatelj (isti zapis velja tudi z izklopljenim bazenom, zato A/B primerjava ostane posteno).
  if (status === 429) stanje.ob429(Date.now());
  else if (status < 500) stanje.obUspehu(Date.now());
  return izid.odgovor;
}

// --- Ogrevanje ---------------------------------------------------------------------------------------------------------

export const GOSTITELJI_OGREVANJA = ["aiplatform.googleapis.com"];
/** Koliko sekund po zadnji dejavnosti klica ogrevanje se tece. */
export const NEDEJAVNO_MS = 90_000;
/**
 * Osvezitev povezave pred zaprtjem. Izmerjeno 12. 11. 2026 (HEAD /generate_204, ena meritev na presledek): Google je prosto
 * povezavo obdrzal vsaj 120 s, zato je rob varnosti nasa lastna meja PROSTA_NAJDLJE_MS (55 s); osvezimo pri 45 s.
 */
export const OSVEZI_MS = 45_000;
export const OGRETIH_POVEZAV = 2;

let casovnik: ReturnType<typeof setInterval> | null = null;
let zadnjaDejavnost = 0;
let ogrevalnoDelo: (() => Promise<void>) | null = null;

/** Lahek zahtevek (HEAD brez prijave): odgovor ni pomemben, pomembno je, da je povezava odprta in sveza. */
async function ogrejGostitelja(gostitelj: string): Promise<void> {
  const jobi = Array.from({ length: OGRETIH_POVEZAV }, () =>
    // /generate_204 vrne 204 brez telesa v ~0,07 s po rokovanju (izmerjeno 12. 11. 2026; »/« je 404 po ~0,8 s).
    topliFetch(`https://${gostitelj}/generate_204`, { method: "HEAD", signal: AbortSignal.timeout(5_000) }).then(
      (o) => void o.body?.cancel().catch(() => undefined),
      () => undefined,
    ),
  );
  await Promise.all(jobi);
}

/** Pokliče se ob klicu in vsakem obratu: ogreje povezave in zeton, ogrevanje se vzdrzuje do NEDEJAVNO_MS po zadnji dejavnosti. */
export function ogrej(zdaj: number = Date.now(), delo: () => Promise<void> = ogrevalnoDelo ?? privzetoOgrevanje): void {
  if (!vklopljeno) return;
  zadnjaDejavnost = zdaj;
  ogrevalnoDelo = delo;
  if (casovnik) return;
  if (stanje.smeOgrevati(zdaj)) void delo().catch(() => undefined);
  casovnik = setInterval(() => {
    const t = Date.now();
    if (!vklopljeno || t - zadnjaDejavnost > NEDEJAVNO_MS) return ustaviOgrevanje();
    if (stanje.smeOgrevati(t)) void (ogrevalnoDelo ?? privzetoOgrevanje)().catch(() => undefined);
  }, OSVEZI_MS);
  // Casovnik ne sme drzati procesa pri zivljenju.
  casovnik.unref?.();
}

async function privzetoOgrevanje(): Promise<void> {
  const { zagrejZeton } = await import("./adc.server.ts");
  await Promise.all([...GOSTITELJI_OGREVANJA.map(ogrejGostitelja), zagrejZeton()]);
}

export function ustaviOgrevanje(): void {
  if (casovnik) clearInterval(casovnik);
  casovnik = null;
  ogrevalnoDelo = null;
}

export function ogrevanjeTece(): boolean {
  return casovnik !== null;
}
