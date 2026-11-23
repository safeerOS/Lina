/**
 * Glas telefona: koncna tocka /api/voice/telefon (L2, lastnik 15. 11. 2026; POROCILO-T9 razdelek 2.1, L1: surov 16 kHz PCM).
 * OpenLine na telefonu poslje zvok klica Lini po WebSocketu (wss), Lina ga prek priklopa (PrikljucekTelefona) preda mostu Live
 * (L3, drug agent) in vrne odgovor. Ta datoteka je SAMO vrata: preverba, meje in dogovor o sporocilih; prazen priklop za L3.
 *
 * Pot ni nova: HTTPS s samopodpisanim potrdilom EC P-256 in pripetim odtisom SHA-256 lista (kot asistentka: zasebno-omrezje.server.ts,
 * asistent-streznik.server.ts; OpenLine stream-bridge.ts pinnedWsOptions), streznik samo na 127.0.0.1 ali zasebnem naslovu.
 * Locen od asistentke: lastno potrdilo (mapa glas-telefon-tls), lasten zeton, noben uvoz iz asistent-* / kanal-claude* (preizkus).
 *
 * Varnostni model (napadalec = proces na istem omrezju brez zetona ali z napacnim, preplavljanje, prevelika sporocila, druga
 * povezava med klicem):
 *  - ZETON: Authorization: Bearer <zeton OpenLine>, primerjava v konstantnem casu prek HMAC (enaka dolzina za vsak vnos); brez
 *    nastavljenega (>= 32 znakov) zetona se zavrne VSE. Zeton ni nikoli v naslovu, dnevniku ali odgovoru. Nic iz sporocil
 *    (callId, remoteNumber) ne da dostopa: sta samo podatka za zapis, kot pri Twiliu.
 *  - ZAVRNITEV BREZ NAMIGOV: napake zahteve, zetona in stikala dajo isti odgovor 401, brez telesa; 503 je samo po veljavnem zetonu in se steje v isto mejo.
 *  - BREZ Origin (telefon ni brskalnik), BREZ poizvedbe v naslovu, BREZ preusmeritev (streznik jih nikoli ne poslje), brez razsiritev.
 *  - NAJVEC EN KLIC: rezino prevzame sele ZETON, ki ze velja (napadalec brez zetona je ne zasede); druga povezava dobi 503.
 *  - MEJE: okvir <= 8 KiB (preverjeno pred hranjenjem), zacetek v 5 s, 100 sporocil in 40 kB na sekundo (realni cas + 25 %), 30 s tisine
 *    (ping je ne podaljsa), 60 min klic, TLS rokovanje 5 s, zahteva za nadgradnjo v 10 s po rokovanju, povezave na naslov in skupaj omejene
 *    (rezerva za naslov z veljavnim zetonom), zavrnitve na naslov na minuto omejene (nato brez odgovora), kvota klicev in minut.
 *  - PRIVZETO IZKLOPLJENO: stikalo v nastavitvah Line (glas-telefon.json); izklop ustavi streznik IN konca tekoci klic, vsaka povezava pa
 *    se ob nadgradnji ponovno preveri proti stikalu. Zeton je na disku sifriran.
 *
 * Dogovor o sporocilih (pogodba v AGENTS.md, razdelek »Glas telefona«):
 *   odjemalec -> Lina: besedilo {"type":"start","callId":"...","remoteNumber":"..."} (prvo sporocilo, najvec ena sama);
 *                      dvojisko: surov PCM s16le 16 kHz mono (kot OpenLine format raw) ALI besedilo {"type":"media","pcm16k":"<base64>"};
 *                      besedilo {"type":"stop"} (konec klica).
 *   Lina -> odjemalec: dvojisko surov PCM 16 kHz; besedilo {"type":"clear"} (prekinitev, odjemalec zavrze predvajano).
 */
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:https";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { TLSSocket } from "node:tls";
import type { Duplex } from "node:stream";
import { requireOwner } from "./auth.server.ts";
import { odsifrirajSkrivnost, sifrirajSkrivnost } from "./keys.server.ts";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";
import {
  KLJUC_WS, KODA, OP_BESEDILO, OP_DVOJISKO, OP_PING, OP_PONG, OP_ZAPRI, Razclenjevalnik, okvir, okvirZapri, sprejemniKljuc,
} from "./glas-telefon-ws.ts";
import { potrdiloVMapi, zasebenNaslov, zasebenOdjemalec, zasebniNaslovi } from "./zasebno-omrezje.server.ts";

export const POT_TELEFON = "/api/voice/telefon";
export const NASTAVITVE_GLASU_TELEFONA = "glas-telefon.json";
export const ZETON_GLASU_TELEFONA = "glas-telefon-zeton.json";
export const PRIVZETA_VRATA_GLASU_TELEFONA = 8447;

/** Najvec hkratnih klicev (povezav WebSocket po preverbi). */
export const NAJVEC_KLICEV = 1;
/** Najvecji okvir (OpenLine media-relay: 640 B okvir, 8 KiB zaloga). Preverja se pred hranjenjem vsebine. */
export const NAJVEC_OKVIR = 8 * 1024;
/** Najvec surovega zvoka v enem sporocilu (200 ms pri 16 kHz s16le = 6400 B; 6000 B je zaokrozeno, da base64 stane v okvir). */
export const NAJVEC_PCM = 6000;
/** Besedilo start/stop je kratko. */
export const NAJVEC_KONTROLNO = 2 * 1024;
export const NAJVEC_SPOROCIL_NA_S = 100;
/**
 * Realni cas je 32 kB/s PCM (16 kHz s16le); 48 kB/s = +50 % rezerve za izravnavo zamud Wi-Fi. Steje se ZVOK (PCM bajti po dekodiranju),
 * ne velikost okvira (N-3): JSON »media« z base64 je ~38 % vecji (32 kB/s zvoka = ~44 kB/s na zici) in je pri 40 kB/s po okvirju zaprl poštenega
 * odjemalca po ~1 s. Hitrejsi tok bi Live dobival hitreje od realnega casa (L-05).
 */
export const NAJVEC_BAJTOV_NA_S = 48_000;
/** Okno meje hitrosti (N-3): 2 s, da salva po 0,5 s zamude Wi-Fi ne zapre pravega klica. Meji sta NAJVEC_*_NA_S × okno. */
export const OKNO_MEJ_MS = 2_000;
export const ROK_ZACETKA_MS = 5_000;
export const ROK_TISINE_MS = 30_000;
export const NAJDLJE_KLIC_MS = 60 * 60_000;
/** Nepreverjena povezava je draga (N-1): telefon konca TLS rokovanje v nekaj 10 ms, zato 3 s. */
export const ROK_ROKOVANJA_MS = 3_000;
export const NAJVEC_POVEZAV = 8;
export const NAJVEC_POVEZAV_NA_NASLOV = 4;
export const NAJVEC_ZAHTEV_NA_MINUTO = 120;
export const NAJVEC_ZAVRNITEV_NA_MINUTO = 20;
/** Povezava, ki v tem casu ne dokonca zahteve za nadgradnjo (npr. prazna po TLS), se zapre (L-01). */
export const ROK_PRED_NADGRADNJO_MS = 3_000;
/**
 * N-1: naslov brez veljavnega zetona v zadnjih 10 min (neznan) sme imeti hkrati najvec toliko povezav; znan NAJVEC_POVEZAV_NA_NASLOV.
 * Napadalec z dvema naslovoma tako drzi najvec 4 od 8 mest.
 */
export const NAJVEC_NEZNANIH_NA_NASLOV = 2;
/** N-1: povrh splosne meje je VEDNO rezerva za naslov, ki nima nobene odprte povezave (pravi telefon, tudi ce ga nismo se videli). */
export const REZERVA_POVEZAV_NOVIH = 4;
/** N-1: odpiranje povezav na naslov (skupina: IPv4 naslov, IPv6 /64) na minuto, steje se ob sprejemu (ne sele ob nadgradnji). */
export const NAJVEC_ODPIRANJ_NA_MINUTO = 120;
export const ZNAN_NASLOV_MS = 10 * 60_000;
/** Zgornja meja vnosov v zemljevidih mej po naslovih (L-06). */
export const NAJVEC_VNOSOV_MEJ = 1024;
export const ROK_CISCENJA_MEJ_MS = 60_000;
/** Kvota zacetkov klicev in minut (L-05): ukraden zeton ne sme neomejeno odpirati sej Live (Vertex). */
export const NAJVEC_STARTOV_NA_MINUTO = 6;
export const NAJVEC_STARTOV_NA_URO = 60;
export const NAJVEC_MINUT_NA_DAN = 240;
/** Zaostanek pisanja proti telefonu, nad katerim povezavo prekinemo (pocasen bralec ne sme polniti pomnilnika). */
export const NAJVEC_ZAOSTANEK_PISANJA = 1024 * 1024;
export const NAJKRAJSI_ZETON = 32;
export const NAJDALJSI_ZETON = 256;
const OBLIKA_ZETONA = /^[A-Za-z0-9._~+/=-]+$/;
/** Oznaka klica od telefona: strogo bela lista oblike (zacne z crko/stevilko). Nikoli ne postane kljuc zapisa v Lini (L-03). */
const ID_KLICA = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const STEVILKA = /^[0-9+*#() -]{0,32}$/;
/** Smer klica: Lina uporablja inbound/outbound, OpenLine pa poslje incoming/outgoing (openline/server/src/types.ts). Smer se samo preverja, nikjer se ne uporablja. */
const SMER = /^(inbound|outbound|incoming|outgoing)$/;
const ID_NAPRAVE_OL = /^[A-Za-z0-9_-]{1,64}$/;

// ------------------------------------------------------------------ priklop za L3 (most Live)

/** Kar L3 dobi za en klic: pot do telefona. */
export interface VrataTelefona {
  /** Surov PCM s16le 16 kHz mono proti telefonu (odgovor modela). */
  posljiZvok(pcm: Buffer): void;
  /** Telefon naj zavrze se nepredvajan zvok (prekinitev, »interrupted« v Live). */
  posljiClear(): void;
  /** Konec klica iz Line (telefon dobi close 1000). */
  zapri(): void;
}

export type RazlogKonca = "stop" | "odklop" | "napaka";

/**
 * Priklop L3 (prilagodilnik TwilioVrata za telefon). Brez priklopa streznik povezave ne sprejme (503): ne sme biti tihega klica.
 * Klici priklopa se izvedejo v enem klicu na dogodek, po vrstnem redu zacni -> zvok* -> ustavi (natanko enkrat).
 */
export interface PrikljucekTelefona {
  zacni(klic: { callId: string; remoteNumber: string }, vrata: VrataTelefona): void;
  zvok(pcm: Buffer): void;
  ustavi(razlog: RazlogKonca): void;
}

const KLJUC_PRIKLOPA = Symbol.for("lina.glas.telefon.prikljucek");
/** Prazen priklop za L3: registrira ga L3 ob zagonu; null ga odstrani. */
export function nastaviPrikljucekTelefona(p: PrikljucekTelefona | null): void {
  (globalThis as { [KLJUC_PRIKLOPA]?: PrikljucekTelefona | null })[KLJUC_PRIKLOPA] = p;
}
export function prikljucekTelefona(): PrikljucekTelefona | null {
  return (globalThis as { [KLJUC_PRIKLOPA]?: PrikljucekTelefona | null })[KLJUC_PRIKLOPA] ?? null;
}

// ------------------------------------------------------------------ preverba zetona

/** Primerjava v konstantnem casu, neodvisna od dolzine: HMAC obeh vnosov z nakljucnim kljucem procesa, nato timingSafeEqual (32 B). */
const KLJUC_PRIMERJAVE = randomBytes(32);
export function primerjajZeton(a: string, b: string): boolean {
  const x = createHmac("sha256", KLJUC_PRIMERJAVE).update(a).digest();
  const y = createHmac("sha256", KLJUC_PRIMERJAVE).update(b).digest();
  return timingSafeEqual(x, y);
}

/** Nastavljen zeton velja samo, ce je dovolj dolg in iz dovoljenih znakov (sicer streznik zavrne vse). */
export function veljavenZetonTelefona(z: unknown): z is string {
  return typeof z === "string" && z.length >= NAJKRAJSI_ZETON && z.length <= NAJDALJSI_ZETON && OBLIKA_ZETONA.test(z);
}

export type MoznostiGlasu = {
  root: string;
  /** 127.0.0.1 (privzeto) ali zasebni naslov domacega omrezja; 0.0.0.0 in javni naslov se zavrneta. */
  naslov?: string;
  vrata?: number;
  /** Zeton OpenLine, ki ga Lina pricakuje (L5 ga shrani). null/prekratek = zavrni vse. */
  zeton: () => string | null | Promise<string | null>;
  /** Stikalo iz nastavitev; preverja se ob VSAKI nadgradnji (tudi ce streznik se tece). */
  vklopljeno: () => boolean | Promise<boolean>;
  prikljucek?: () => PrikljucekTelefona | null;
  /** Za preizkuse: primerjava zetona (privzeto primerjajZeton, konstanten cas). */
  primerjaj?: (a: string, b: string) => boolean;
  zdaj?: () => number;
  dnevnik?: (koda: string) => void;
  /** Za preizkuse: naslov odjemalca (privzeto naslov vticnice); preizkus tako doseze vejo »javni naslov«. */
  naslovOdjemalca?: (req: IncomingMessage) => string | undefined;
  rokRokovanja?: number;
  rokZacetka?: number;
  rokTisine?: number;
  rokPredNadgradnjo?: number;
  najvecVnosovMej?: number;
  najvecStartovNaMinuto?: number;
  najvecStartovNaUro?: number;
  najvecMinutNaDan?: number;
};

const ODGOVORI: Record<number, string> = { 401: "Unauthorized", 503: "Service Unavailable" };

// ------------------------------------------------------------------ seja ene povezave

class Seja {
  private stanje: "caka-start" | "tece" | "koncano" = "caka-start";
  private zacetaPriklop = false;
  private koncanoPriklop = false;
  private readonly razclen = new Razclenjevalnik(NAJVEC_OKVIR);
  private readonly okna: Array<{ t: number; n: number }> = [];
  private readonly casovniki: Array<ReturnType<typeof setTimeout>> = [];
  private tisina: ReturnType<typeof setTimeout> | null = null;
  private readonly vrata: VrataTelefona;
  private readonly vticnica: Socket;
  private readonly priklop: PrikljucekTelefona;
  private readonly zdaj: () => number;
  private readonly dnevnik: (koda: string) => void;
  private readonly obKoncu: () => void;
  private readonly obStartu: () => void;
  private readonly rokTisine: number;

  constructor(
    vticnica: Socket, priklop: PrikljucekTelefona, zdaj: () => number, dnevnik: (koda: string) => void, obKoncu: () => void, rokZacetka: number, rokTisine: number, obStartu: () => void,
  ) {
    this.obStartu = obStartu;
    this.vticnica = vticnica;
    this.priklop = priklop;
    this.zdaj = zdaj;
    this.dnevnik = dnevnik;
    this.obKoncu = obKoncu;
    this.rokTisine = rokTisine;
    this.vrata = {
      posljiZvok: (pcm) => {
        if (this.stanje !== "tece") return;
        for (let i = 0; i < pcm.length; i += NAJVEC_OKVIR) this.pisi(okvir(OP_DVOJISKO, pcm.subarray(i, i + NAJVEC_OKVIR)));
      },
      posljiClear: () => {
        if (this.stanje === "tece") this.pisi(okvir(OP_BESEDILO, Buffer.from('{"type":"clear"}')));
      },
      zapri: () => this.zakljuci(KODA.normalno, "konec klica", "stop"),
    };
    vticnica.setNoDelay(true);
    vticnica.on("data", (k: Buffer) => this.naPodatkih(k));
    vticnica.on("close", () => this.vticnicaZaprta());
    vticnica.on("error", () => undefined);
    // N-0 (L6): rok velja samo, dokler start ni prisel; prej se je sprozil tudi po veljavnem startu in po 5 s prekinil vsak klic (dolg pozdrav 7,7 s)
    this.casovniki.push(setTimeout(() => { if (this.stanje === "caka-start") this.zakljuci(KODA.pravilnik, "start ni prisel", "napaka"); }, rokZacetka));
    this.casovniki.push(setTimeout(() => this.zakljuci(KODA.pravilnik, "klic predolg", "napaka"), NAJDLJE_KLIC_MS));
    for (const c of this.casovniki) c.unref?.();
    this.ponastaviTisino();
  }

  /** Bajti, ki so prisli skupaj z zahtevo za nadgradnjo (po glavah). */
  predhodniPodatki(k: Buffer): void {
    if (k.length > 0) this.naPodatkih(k);
  }

  private ponastaviTisino(): void {
    if (this.tisina) clearTimeout(this.tisina);
    this.tisina = setTimeout(() => this.zakljuci(KODA.pravilnik, "tisina", "napaka"), this.rokTisine);
    this.tisina.unref?.();
  }

  private pisi(b: Buffer): void {
    if (this.vticnica.destroyed || !this.vticnica.writable) return;
    if (this.vticnica.writableLength > NAJVEC_ZAOSTANEK_PISANJA) {
      this.zakljuci(KODA.pravilnik, "pocasen bralec", "napaka");
      return;
    }
    this.vticnica.write(b);
  }

  private naPodatkih(kos: Buffer): void {
    if (this.stanje === "koncano") return;
    // tisina se ponastavi samo ob zvoku in startu (ne ob pingu): ping brez zvoka ne drzi seje do 60 min (L-05)
    for (const d of this.razclen.dodaj(kos)) {
      if ((this.stanje as string) === "koncano") return;
      if (d.tip === "napaka") return void this.zakljuci(d.koda, d.razlog, "napaka");
      try {
        this.obdelaj(d.op, d.podatki);
      } catch {
        return void this.zakljuci(KODA.notranja, "notranja napaka", "napaka");
      }
    }
  }

  /** Meja hitrosti: drsece okno OKNO_MEJ_MS. Vsak okvir (tudi ping) se steje kot sporocilo; bajti so samo ZVOK (dodajZvok). */
  private prekoracitev(): boolean {
    const t = this.zdaj();
    while (this.okna.length > 0 && t - this.okna[0].t >= OKNO_MEJ_MS) this.okna.shift();
    this.okna.push({ t, n: 0 });
    return this.presezeno();
  }

  /** N-3: PCM bajti (po dekodiranju base64) tega sporocila; true = meja presezena. */
  private dodajZvok(bajtov: number): boolean {
    if (this.okna.length > 0) this.okna[this.okna.length - 1].n += bajtov;
    return this.presezeno();
  }

  private presezeno(): boolean {
    let b = 0;
    for (const o of this.okna) b += o.n;
    const s = OKNO_MEJ_MS / 1000;
    return this.okna.length > NAJVEC_SPOROCIL_NA_S * s || b > NAJVEC_BAJTOV_NA_S * s;
  }

  private obdelaj(op: number, v: Buffer): void {
    if (this.prekoracitev()) return void this.zakljuci(KODA.pravilnik, "prehitro", "napaka");
    if (op === OP_PING) return void this.pisi(okvir(OP_PONG, v));
    if (op === OP_PONG) return;
    if (op === OP_ZAPRI) return void this.zakljuci(KODA.normalno, "", "odklop");
    if (op === OP_DVOJISKO) {
      if (this.stanje !== "tece") return void this.zakljuci(KODA.pravilnik, "zvok pred startom", "napaka");
      if (v.length === 0 || v.length > NAJVEC_PCM || v.length % 2 !== 0) return void this.zakljuci(KODA.pravilnik, "neveljaven zvok", "napaka");
      if (this.dodajZvok(v.length)) return void this.zakljuci(KODA.pravilnik, "prehitro", "napaka");
      this.ponastaviTisino();
      this.priklop.zvok(Buffer.from(v));
      return;
    }
    if (op !== OP_BESEDILO) return void this.zakljuci(KODA.protokol, "neznan okvir", "napaka");
    let sporocilo: Record<string, unknown>;
    try {
      const besedilo = new TextDecoder("utf-8", { fatal: true }).decode(v);
      const x: unknown = JSON.parse(besedilo);
      if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("ni objekt");
      sporocilo = x as Record<string, unknown>;
    } catch {
      return void this.zakljuci(KODA.neveljavno, "neveljavno besedilo", "napaka");
    }
    const tip = sporocilo.type;
    if (tip === "start") return this.start(sporocilo, v.length);
    if (tip === "media") return this.media(sporocilo);
    if (tip === "stop") return this.stop(sporocilo, v.length);
    this.zakljuci(KODA.pravilnik, "neznano sporocilo", "napaka");
  }

  private start(s: Record<string, unknown>, dolzina: number): void {
    // dovoljen je samo nabor polj, ki ga poslje OpenLine (raw); vse drugo je napaka
    const dovoljena = new Set(["type", "callId", "remoteNumber", "direction", "deviceId", "format"]);
    const okFormat = (f: unknown): boolean => {
      if (f === undefined) return true;
      const o = f as Record<string, unknown> | null;
      return !!o && typeof o === "object" && !Array.isArray(o) && o.sampleRate === 16000 && o.channels === 1 && o.encoding === "pcm_s16le"
        && Object.keys(o).every((k) => k === "encoding" || k === "sampleRate" || k === "channels" || k === "frameMs");
    };
    if (this.stanje !== "caka-start" || dolzina > NAJVEC_KONTROLNO
      || Object.keys(s).some((k) => !dovoljena.has(k))
      || typeof s.callId !== "string" || !ID_KLICA.test(s.callId)
      || (s.remoteNumber !== undefined && (typeof s.remoteNumber !== "string" || !STEVILKA.test(s.remoteNumber)))
      || (s.direction !== undefined && (typeof s.direction !== "string" || !SMER.test(s.direction)))
      || (s.deviceId !== undefined && (typeof s.deviceId !== "string" || !ID_NAPRAVE_OL.test(s.deviceId)))
      || !okFormat(s.format)) {
      return void this.zakljuci(KODA.pravilnik, "neveljaven start", "napaka");
    }
    this.stanje = "tece";
    this.ponastaviTisino();
    this.obStartu();
    this.zacetaPriklop = true;
    this.priklop.zacni({ callId: s.callId, remoteNumber: (s.remoteNumber as string | undefined) ?? "" }, this.vrata);
    this.dnevnik("klic-zacet");
  }

  private media(s: Record<string, unknown>): void {
    const b64 = s.pcm16k;
    if (this.stanje !== "tece" || Object.keys(s).length !== 2 || typeof b64 !== "string"
      || b64.length === 0 || b64.length > Math.ceil(NAJVEC_PCM / 3) * 4 || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
      return void this.zakljuci(KODA.pravilnik, "neveljaven media", "napaka");
    }
    const pcm = Buffer.from(b64, "base64");
    // samo kanonicni base64 (brez presezka bitov) in sodo stevilo bajtov (s16le)
    if (pcm.length === 0 || pcm.length > NAJVEC_PCM || pcm.length % 2 !== 0 || pcm.toString("base64") !== b64) {
      return void this.zakljuci(KODA.pravilnik, "neveljaven zvok", "napaka");
    }
    if (this.dodajZvok(pcm.length)) return void this.zakljuci(KODA.pravilnik, "prehitro", "napaka");
    this.ponastaviTisino();
    this.priklop.zvok(pcm);
  }

  private stop(s: Record<string, unknown>, dolzina: number): void {
    if (this.stanje !== "tece" || dolzina > NAJVEC_KONTROLNO || Object.keys(s).some((k) => k !== "type" && k !== "callId")
      || (s.callId !== undefined && (typeof s.callId !== "string" || !ID_KLICA.test(s.callId)))) {
      return void this.zakljuci(KODA.pravilnik, "neveljaven stop", "napaka");
    }
    this.zakljuci(KODA.normalno, "konec klica", "stop");
  }

  /** Streznik: izklop stikala, preklic zetona ali ustavitev: seja se konca takoj, priklop dobi »odklop« (L-02). */
  prekini(razlog: string): void {
    this.zakljuci(KODA.odhaja, razlog, "odklop");
  }

  private zakljuci(koda: number, razlog: string, zakaj: RazlogKonca): void {
    if (this.stanje === "koncano") return;
    this.stanje = "koncano";
    this.pocisti();
    this.javiKonec(zakaj);
    if (!this.vticnica.destroyed) {
      try { this.vticnica.write(okvirZapri(koda, razlog)); } catch { /* vticnica ze zaprta */ }
      this.vticnica.end();
      // odjemalec, ki close ne potrdi, ne sme zadrzati vticnice
      const rok = setTimeout(() => this.vticnica.destroy(), 1000);
      rok.unref?.();
    }
    this.dnevnik(`konec-${zakaj}`);
    this.obKoncu();
  }

  private vticnicaZaprta(): void {
    if (this.stanje !== "koncano") {
      this.stanje = "koncano";
      this.pocisti();
      this.javiKonec("odklop");
      this.obKoncu();
    }
  }

  private javiKonec(zakaj: RazlogKonca): void {
    if (!this.zacetaPriklop || this.koncanoPriklop) return;
    this.koncanoPriklop = true;
    try { this.priklop.ustavi(zakaj); } catch { /* priklop ne sme podreti streznika */ }
  }

  private pocisti(): void {
    for (const c of this.casovniki.splice(0)) clearTimeout(c);
    if (this.tisina) clearTimeout(this.tisina);
    this.tisina = null;
  }
}

// ------------------------------------------------------------------ streznik

/** Skupina naslova za meje povezav: IPv4 naslov, IPv6 po /64 (napadalec z milijoni naslovov v /64 ni milijon napadalcev). */
export function kljucNaslova(a: string): string {
  const mapiran = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a);
  if (mapiran) return mapiran[1];
  if (!a.includes(":")) return a;
  const deli = a.split("%")[0].toLowerCase().split("::");
  const levo = deli[0] ? deli[0].split(":") : [];
  const desno = deli[1] ? deli[1].split(":") : [];
  const skupine = deli.length === 2 ? [...levo, ...new Array(Math.max(0, 8 - levo.length - desno.length)).fill("0"), ...desno] : levo;
  return `${skupine.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** Odprta TCP povezava (N-1): nepotrjena je tista, ki se ni pokazala z veljavnim zetonom; potrjene (seje) se ne izpodrivajo. */
type Povezava = { kljuc: string; t: number; potrjena: boolean; vticnica: Socket };

export class GlasTelefonStreznik {
  private streznik: Server | null = null;
  private zasedeno = false;
  private readonly pov = new Map<string, Povezava>();
  private readonly odpiranja = new Map<string, number[]>();
  /** N-2: poveca se ob vsakem preklicu (zamenjava zetona, izklop); nadgradnja, ki je zeton prebrala pred tem, ne sme postati seja. */
  private generacija = 0;
  private readonly zavrnitve = new Map<string, number[]>();
  private readonly zahteve = new Map<string, number[]>();
  /** Naslovi z veljavnim zetonom (cas zadnje preverbe): rezerva povezav za pravi telefon (L-01). */
  private readonly znani = new Map<string, number>();
  private readonly vticnice = new Set<Socket>();
  private readonly seje = new Set<Seja>();
  private readonly predNadgradnjo = new WeakMap<object, ReturnType<typeof setTimeout>>();
  private readonly starti: number[] = [];
  private readonly minute: Array<{ t: number; ms: number }> = [];
  private ciscenje: ReturnType<typeof setInterval> | null = null;
  private readonly zdaj: () => number;
  private readonly dnevnik: (koda: string) => void;
  private readonly primerjaj: (a: string, b: string) => boolean;
  odtis = "";

  private readonly m: MoznostiGlasu;

  constructor(m: MoznostiGlasu) {
    this.m = m;
    this.zdaj = m.zdaj ?? Date.now;
    this.dnevnik = m.dnevnik ?? ((k) => process.stderr.write(`[lina-glas-telefon] ${k}\n`));
    this.primerjaj = m.primerjaj ?? primerjajZeton;
  }

  async zazeni(): Promise<{ naslov: string; vrata: number; odtis: string }> {
    const naslov = (this.m.naslov ?? "127.0.0.1").trim();
    if (!zasebenNaslov(naslov)) throw new Error("Glas telefona poslusa samo na 127.0.0.1 ali zasebnem naslovu domacega omrezja.");
    const { cert, key, odtis } = await potrdiloVMapi(this.m.root, "glas-telefon-tls", "Lina glas telefona");
    this.odtis = odtis;
    // navadne zahteve (brez nadgradnje): vedno 404 brez telesa, nikoli preusmeritev
    const s = createServer({ cert, key, minVersion: "TLSv1.2", handshakeTimeout: this.m.rokRokovanja ?? ROK_ROKOVANJA_MS }, (_req, res) => {
      res.writeHead(404, { "cache-control": "no-store", "content-length": 0, connection: "close" });
      res.end();
    });
    s.headersTimeout = 10_000;
    s.requestTimeout = 10_000;
    s.maxHeadersCount = 30;
    // meje povezav izvajamo sami (ne s s.maxConnections); steje se ze ob sprejemu, ne sele ob nadgradnji (N-1)
    s.on("tlsClientError", () => undefined);
    s.on("connection", (v: Duplex) => {
      const vticnica = v as Socket;
      const k = kljucNaslova(vticnica.remoteAddress ?? "");
      const id = `${vticnica.remoteAddress}|${vticnica.remotePort}`;
      if (this.meja(this.odpiranja, k, NAJVEC_ODPIRANJ_NA_MINUTO) || !this.sprejmiPovezavo(k)) { vticnica.destroy(); return; }
      this.pov.set(id, { kljuc: k, t: this.zdaj(), potrjena: false, vticnica });
      this.vticnice.add(vticnica);
      vticnica.once("close", () => {
        this.vticnice.delete(vticnica);
        if (this.pov.get(id)?.vticnica === vticnica) this.pov.delete(id);
      });
    });
    // L-01: po TLS rokovanju ima povezava le omejen cas za celotno zahtevo za nadgradnjo (headersTimeout ne zajame prazne povezave).
    // Lasten casovnik na TLS vticnici; po nadgradnji se ukine (seja ima svoje roke: start 5 s, tisina 30 s, klic 60 min).
    s.on("secureConnection", (t: TLSSocket) => {
      const rok = setTimeout(() => t.destroy(), this.m.rokPredNadgradnjo ?? ROK_PRED_NADGRADNJO_MS);
      rok.unref?.();
      this.predNadgradnjo.set(t, rok);
      t.once("close", () => clearTimeout(rok));
    });
    s.on("upgrade", (req: IncomingMessage, vticnica: Duplex, glava: Buffer) => {
      this.nadgradnja(req, vticnica as Socket, glava).catch(() => (vticnica as Socket).destroy());
    });
    await new Promise<void>((ok, ne) => {
      s.once("error", ne);
      s.listen(this.m.vrata ?? 0, naslov, () => { s.off("error", ne); ok(); });
    });
    this.streznik = s;
    this.ciscenje = setInterval(() => this.ocistiMeje(), ROK_CISCENJA_MEJ_MS);
    this.ciscenje.unref?.();
    const a = s.address();
    return { naslov, vrata: typeof a === "object" && a ? a.port : 0, odtis };
  }

  /**
   * Ustavitev (izklop stikala): vse seje se zakljucijo TAKOJ (priklop dobi »odklop«, klic se konca), ostale vticnice se
   * zaprejo po kratkem roku; cakanje je omejeno (L-02: prej je close() cakal do konca klica, do 60 min, in blokiral verigo).
   */
  ustavi(): Promise<void> {
    const s = this.streznik;
    this.streznik = null;
    if (this.ciscenje) clearInterval(this.ciscenje);
    this.ciscenje = null;
    if (!s) return Promise.resolve();
    s.closeAllConnections?.();
    this.prekiniSeje("izklop");
    const unici = setTimeout(() => { for (const v of this.vticnice) v.destroy(); }, 300);
    return new Promise((ok) => {
      const zadnji = setTimeout(() => { for (const v of this.vticnice) v.destroy(); ok(); }, 3000);
      s.close(() => { clearTimeout(unici); clearTimeout(zadnji); ok(); });
    });
  }

  /** Vse tekoce seje se zakljucijo (preklic zetona, izklop); nadgradnje v teku (zeton ze prebran) po tem ne uspejo vec (N-2). */
  prekiniSeje(razlog: string): void {
    this.generacija += 1;
    for (const seja of [...this.seje]) seja.prekini(razlog);
  }

  /**
   * N-1: ali se nova povezava sprejme. Neznan naslov najvec NAJVEC_NEZNANIH_NA_NASLOV, znan NAJVEC_POVEZAV_NA_NASLOV; splosna meja
   * NAJVEC_POVEZAV; povrh nje je VEDNO rezerva za naslov brez odprtih povezav (pravi telefon). Ko je tudi rezerva polna, nov naslov
   * izpodrine najstarejso NEPOTRJENO povezavo naslova z najvec povezavami (potrjene seje ostanejo).
   */
  private sprejmiPovezavo(k: string): boolean {
    let svoje = 0;
    for (const p of this.pov.values()) if (p.kljuc === k) svoje += 1;
    if (svoje >= (this.jeZnan(k) ? NAJVEC_POVEZAV_NA_NASLOV : NAJVEC_NEZNANIH_NA_NASLOV)) return false;
    if (this.pov.size < NAJVEC_POVEZAV) return true;
    if (svoje > 0) return false;
    if (this.pov.size < NAJVEC_POVEZAV + REZERVA_POVEZAV_NOVIH) return true;
    return this.izpodrini();
  }

  private izpodrini(): boolean {
    const stevci = new Map<string, number>();
    for (const p of this.pov.values()) stevci.set(p.kljuc, (stevci.get(p.kljuc) ?? 0) + 1);
    let izbran: [string, Povezava] | null = null;
    for (const e of this.pov) {
      if (e[1].potrjena) continue;
      if (!izbran) { izbran = e; continue; }
      const s = stevci.get(e[1].kljuc) ?? 0;
      const si = stevci.get(izbran[1].kljuc) ?? 0;
      if (s > si || (s === si && e[1].t < izbran[1].t)) izbran = e;
    }
    if (!izbran) return false;
    this.pov.delete(izbran[0]);
    izbran[1].vticnica.destroy();
    return true;
  }

  get klicTece(): boolean {
    return this.zasedeno;
  }

  /** Za preizkuse in nadzor: stevilo vnosov v zemljevidih mej po naslovih. */
  get velikostMej(): { zahteve: number; zavrnitve: number; znani: number } {
    return { zahteve: this.zahteve.size, zavrnitve: this.zavrnitve.size, znani: this.znani.size };
  }

  private jeZnan(naslov: string): boolean {
    const t = this.znani.get(naslov);
    return t !== undefined && this.zdaj() - t < ZNAN_NASLOV_MS;
  }

  /** Izbrise iztekle vnose (L-06): naslovi, ki so enkrat poklicali in nikoli vec, ne smejo ostati v pomnilniku. */
  ocistiMeje(): void {
    const t = this.zdaj();
    for (const z of [this.zahteve, this.zavrnitve, this.odpiranja]) {
      for (const [a, l] of z) if (!l.some((x) => t - x < 60_000)) z.delete(a);
    }
    for (const [a, c] of this.znani) if (t - c >= ZNAN_NASLOV_MS) this.znani.delete(a);
  }

  private odbij(v: Socket, status: 401 | 503): void {
    if (v.destroyed) return;
    v.end(`HTTP/1.1 ${status} ${ODGOVORI[status]}\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Length: 0\r\n\r\n`);
    const rok = setTimeout(() => v.destroy(), 1000);
    rok.unref?.();
  }

  /** Drsece okno 60 s na naslov; true = meja presezena. Zemljevid ima zgornjo mejo vnosov (najstarejsi gre ven). */
  private meja(zemljevid: Map<string, number[]>, naslov: string, najvec: number, dodaj = true): boolean {
    const t = this.zdaj();
    const l = (zemljevid.get(naslov) ?? []).filter((x) => t - x < 60_000);
    if (dodaj) l.push(t);
    zemljevid.delete(naslov);
    if (l.length > 0) {
      zemljevid.set(naslov, l);
      const zgornja = this.m.najvecVnosovMej ?? NAJVEC_VNOSOV_MEJ;
      while (zemljevid.size > zgornja) {
        const prvi = zemljevid.keys().next().value;
        if (prvi === undefined) break;
        zemljevid.delete(prvi);
      }
    }
    return l.length > najvec;
  }

  /** Kvota zacetkov klicev in minut na dan (L-05); klicati v sinhronem odseku pred prevzemom rezine. true = presezena. */
  private presezenaKvota(): boolean {
    const t = this.zdaj();
    while (this.starti.length > 0 && t - this.starti[0] >= 3_600_000) this.starti.shift();
    while (this.minute.length > 0 && t - this.minute[0].t >= 86_400_000) this.minute.shift();
    const naMinuto = this.starti.filter((x) => t - x < 60_000).length;
    const ms = this.minute.reduce((a, b) => a + b.ms, 0);
    return naMinuto >= (this.m.najvecStartovNaMinuto ?? NAJVEC_STARTOV_NA_MINUTO)
      || this.starti.length >= (this.m.najvecStartovNaUro ?? NAJVEC_STARTOV_NA_URO)
      || ms >= (this.m.najvecMinutNaDan ?? NAJVEC_MINUT_NA_DAN) * 60_000;
  }

  private async nadgradnja(req: IncomingMessage, v: Socket, glava: Buffer): Promise<void> {
    const generacija = this.generacija;
    const rokPred = this.predNadgradnjo.get(v);
    if (rokPred) clearTimeout(rokPred);
    const naslov = (this.m.naslovOdjemalca ? this.m.naslovOdjemalca(req) : req.socket.remoteAddress) ?? "";
    // tujec z javnega naslova ne dobi niti odgovora
    if (!zasebenOdjemalec(naslov)) return void v.destroy();
    // L4-N1: meje po skupini naslova (IPv6 po /64), enako kot odpiranja; sicer vsak naslov iz /64 dobi svoj stevec
    const kn = kljucNaslova(naslov);
    if (this.meja(this.zahteve, kn, NAJVEC_ZAHTEV_NA_MINUTO)) return void v.destroy();
    // preplavljanje z napacnimi zetoni: nad mejo brez preverbe in brez odgovora (ugibanje zetona ne tece)
    if (this.meja(this.zavrnitve, kn, NAJVEC_ZAVRNITEV_NA_MINUTO - 1, false)) return void v.destroy();
    // L-07: vse zavrnitve (tudi 503 po veljavnem zetonu in izklopljeno stikalo) se stejejo v isto mejo, zato ugibanje zetona
    // ne pridobi nic z locevanjem 401 in 503; 401 ostane za napake zahteve/zetona/stikala, 503 samo »zasedeno/brez priklopa/kvota«
    const zavrni = (status: 401 | 503 = 401): void => {
      this.meja(this.zavrnitve, kn, NAJVEC_ZAVRNITEV_NA_MINUTO);
      this.odbij(v, status);
    };
    if (!this.zahtevaVeljavna(req)) return zavrni();
    const m = /^Bearer ([^\s]+)$/.exec(req.headers.authorization ?? "");
    const pricakovan = await this.m.zeton();
    if (!m || !veljavenZetonTelefona(pricakovan) || !this.primerjaj(m[1], pricakovan)) return zavrni();
    // od tu naprej je zeton ze veljal: napadalec brez zetona rezine in stikala ne doseze
    this.znani.set(kn, this.zdaj());
    const odprta = this.pov.get(`${v.remoteAddress}|${v.remotePort}`);
    if (odprta) odprta.potrjena = true;
    if (!(await this.m.vklopljeno())) return zavrni(401);
    const priklop = (this.m.prikljucek ?? prikljucekTelefona)();
    if (!priklop) return zavrni(503);
    // preverba in prevzem rezine v istem sinhronem odseku (po zadnjem await): dve hkratni povezavi ne moreta obe uspeti
    // N-2: zeton je bil prebran pred preklicem (zamenjava zetona, izklop) -> brez seje; preverba je v istem sinhronem odseku kot prevzem
    if (generacija !== this.generacija) return zavrni(401);
    if (this.zasedeno || v.destroyed || this.presezenaKvota()) return zavrni(503);
    this.zasedeno = true;
    const zacetek = this.zdaj();
    try {
      const kljuc = req.headers["sec-websocket-key"] as string;
      v.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${sprejemniKljuc(kljuc)}\r\n\r\n`);
      v.setTimeout(0);
      const seja: Seja = new Seja(v, priklop, this.zdaj, this.dnevnik, () => {
        this.zasedeno = false;
        this.seje.delete(seja);
        this.minute.push({ t: this.zdaj(), ms: Math.max(0, this.zdaj() - zacetek) });
      }, this.m.rokZacetka ?? ROK_ZACETKA_MS, this.m.rokTisine ?? ROK_TISINE_MS,
      // kvota steje samo veljavne zacetke klicev (tisti odprejo Live/Vertex), ne prazne ali napacne povezave z veljavnim zetonom
      () => void this.starti.push(this.zdaj()));
      this.seje.add(seja);
      seja.predhodniPodatki(glava);
    } catch (e) {
      this.zasedeno = false;
      v.destroy();
      throw e;
    }
  }

  /** Oblika zahteve: GET na tocno to pot brez poizvedbe, brez Origin, pravilna glava nadgradnje WebSocket 13. */
  private zahtevaVeljavna(req: IncomingMessage): boolean {
    if (req.method !== "GET" || req.httpVersion !== "1.1" || typeof req.url !== "string") return false;
    if (req.url !== POT_TELEFON) return false; // tudi poizvedba (?zeton=...) in # sta zavrnjena
    const h = req.headers;
    if (h.origin !== undefined || h["sec-websocket-origin"] !== undefined) return false;
    if (String(h.upgrade ?? "").toLowerCase() !== "websocket") return false;
    if (!String(h.connection ?? "").toLowerCase().split(",").map((x) => x.trim()).includes("upgrade")) return false;
    if (h["sec-websocket-version"] !== "13") return false;
    const k = h["sec-websocket-key"];
    return typeof k === "string" && KLJUC_WS.test(k) && Buffer.from(k, "base64").length === 16;
  }
}

// ------------------------------------------------------------------ nastavitve (privzeto IZKLOPLJENO) in zagon v Lini

type Nastavitve = { vklop: boolean; naslov: string; vrata: number };

function cisteNastavitve(n: Partial<Nastavitve> | null): Nastavitve {
  const vrata = Number.isInteger(n?.vrata) && (n!.vrata as number) >= 1024 && (n!.vrata as number) <= 65535 ? (n!.vrata as number) : PRIVZETA_VRATA_GLASU_TELEFONA;
  const naslov = typeof n?.naslov === "string" && zasebenNaslov(n.naslov) ? n.naslov : "127.0.0.1";
  return { vklop: n?.vklop === true, naslov, vrata };
}

async function preberiNastavitve(root: string): Promise<Nastavitve> {
  return cisteNastavitve(await readJsonFile<Partial<Nastavitve>>(root, NASTAVITVE_GLASU_TELEFONA).catch(() => null));
}

type SifraZetona = { iv: string; tag: string; ciphertext: string };
/** AAD sifre zetona (N-4): sifra je vezana na namen, zamenjava z drugo skrivnostjo iz iste mape ne da veljavnega zetona. */
const AAD_ZETONA = "lina.glas-telefon.zeton.v1";
/** Oznaka »v: 2« = zapis z AAD (L3-N2): pri njem rezervna pot brez AAD ne obstaja, druga skrivnost iz iste mape ne postane zeton. */
const VERZIJA_ZAPISA_ZETONA = 2;
type DatotekaZetona = { zeton?: unknown; sifra?: unknown; v?: unknown };

/** Zapisi zetona (shranjevanje, preselitev starega zapisa) potekajo po vrsti: stara vrednost ne prepise nove (L-08). */
let vrstaZetona: Promise<unknown> = Promise.resolve();
function vVrstiZetona<T>(delo: () => Promise<T>): Promise<T> {
  const p = vrstaZetona.then(delo, delo);
  vrstaZetona = p.catch(() => undefined);
  return p;
}

function jeSifra(x: unknown): x is SifraZetona {
  const o = x as Record<string, unknown> | null;
  return !!o && typeof o === "object" && typeof o.iv === "string" && typeof o.tag === "string" && typeof o.ciphertext === "string";
}

/**
 * Zeton je na disku SIFRIRAN z glavnim kljucem Line (kot Twilio kljuc, Brave, kljuc OpenLine: keys.server.ts sifrirajSkrivnost), ne v
 * cistem besedilu (L-08). Star zapis {zeton: "<besedilo>"} se se prebere in ob prvem branju samodejno preseli v sifriran zapis, brez
 * prekinitve: telefon se ne ponovno seznanja.
 */
async function preberiZeton(root: string): Promise<string | null> {
  const d = await readJsonFile<DatotekaZetona>(root, ZETON_GLASU_TELEFONA).catch(() => null);
  if (jeSifra(d?.sifra)) {
    const sifra = d.sifra;
    const z = await odsifrirajSkrivnost(sifra, root, AAD_ZETONA).catch(() => null);
    if (veljavenZetonTelefona(z)) return z;
    // L3-N2: zapis z oznako v:2 je ze v novi obliki; rezerva brez AAD velja SAMO za star zapis brez oznake (preselitev), nikoli za v:2
    if (d.v === VERZIJA_ZAPISA_ZETONA) return null;
    // zapis brez AAD (prejsnja oblika): prebere se in se preseli v zapis z AAD
    const staro = await odsifrirajSkrivnost(sifra, root).catch(() => null);
    if (!veljavenZetonTelefona(staro)) return null;
    void vVrstiZetona(async () => {
      const zdaj = await readJsonFile<DatotekaZetona>(root, ZETON_GLASU_TELEFONA).catch(() => null);
      if (jeSifra(zdaj?.sifra) && zdaj.sifra.iv === sifra.iv) {
        await writeJson(root, ZETON_GLASU_TELEFONA, { sifra: await sifrirajSkrivnost(staro, root, AAD_ZETONA), v: VERZIJA_ZAPISA_ZETONA });
        stanje().zetonNapaka = "";
      }
    }).catch(() => undefined);
    return staro;
  }
  if (veljavenZetonTelefona(d?.zeton)) {
    const staro = d.zeton;
    // N-4: preselitev se opravi PRED vrnitvijo zetona. Ce sifriranje ne uspe (glavni kljuc nedostopen), cisto besedilo NIKOLI ne ostane
    // odprto: pravice 0600 in zeton velja za neveljavnega (fail-closed), v stanju je razlog; telefon se ponovno seznani.
    const izid = await vVrstiZetona(async (): Promise<"ok" | "drugo" | "napaka"> => {
      const zdaj = await readJsonFile<DatotekaZetona>(root, ZETON_GLASU_TELEFONA).catch(() => null);
      if (zdaj?.zeton !== staro || zdaj.sifra !== undefined) return "drugo";
      try {
        await writeJson(root, ZETON_GLASU_TELEFONA, { sifra: await sifrirajSkrivnost(staro, root, AAD_ZETONA), v: VERZIJA_ZAPISA_ZETONA });
        return "ok";
      } catch {
        if (process.platform !== "win32") await chmod(path.join(root, ZETON_GLASU_TELEFONA), 0o600).catch(() => undefined);
        return "napaka";
      }
    }).catch((): "napaka" => "napaka");
    if (izid === "napaka") {
      stanje().zetonNapaka = "Zeton glasa telefona ni mogoce sifrirati (glavni kljuc Line ni dostopen); telefon se mora ponovno seznaniti.";
      return null;
    }
    if (izid === "ok") stanje().zetonNapaka = "";
    return izid === "ok" ? staro : null;
  }
  return null;
}

/** Zeton OpenLine za pot telefona (L5: povezi-telefon ga shrani ob seznanitvi); datoteka 0600 in sifrirana, zeton se nikoli ne vrne ali zapise v dnevnik. */
export async function shraniZetonGlasaTelefona(root: string, zeton: string): Promise<void> {
  if (!veljavenZetonTelefona(zeton)) throw new Error("Zeton ni veljaven.");
  const prejsnji = await preberiZeton(root);
  await vVrstiZetona(async () => writeJson(root, ZETON_GLASU_TELEFONA, { sifra: await sifrirajSkrivnost(zeton, root, AAD_ZETONA), v: VERZIJA_ZAPISA_ZETONA }));
  // L3-N3: uspesno ponovno seznanjanje pobrise staro napako zetona takoj, ne sele ob zagonu
  stanje().zetonNapaka = "";
  // sprememba zetona prekine seje, ki so se overile s starim (L-02: preklic velja takoj, ne ob izteku klica).
  // L3-N7: fail-closed: ce prejsnjega zetona ni bilo mogoce prebrati (prehodna napaka, null), se seje VSEENO prekinejo in generacija poveca;
  // izjema je samo isti zeton (ponovna seznanitev z istim zetonom nic ne preklice).
  if (prejsnji !== zeton) stanje().tekoci?.streznik.prekiniSeje("zeton");
}

type Tekoci = { streznik: GlasTelefonStreznik; naslov: string; vrata: number; odtis: string };
type Stanje = { tekoci: Tekoci | null; napaka: string; zetonNapaka: string; veriga: Promise<unknown> };
const KLJUC = Symbol.for("lina.glas.telefon");
function stanje(): Stanje {
  const g = globalThis as { [KLJUC]?: Stanje };
  g[KLJUC] ??= { tekoci: null, napaka: "", zetonNapaka: "", veriga: Promise.resolve() };
  return g[KLJUC];
}

function zaporedno<T>(delo: () => Promise<T>): Promise<T> {
  const s = stanje();
  const p = s.veriga.then(delo, delo);
  s.veriga = p.catch(() => undefined);
  return p;
}

async function ustavi(): Promise<void> {
  const t = stanje().tekoci;
  stanje().tekoci = null;
  if (t) await t.streznik.ustavi();
}

/** Uskladi tekoci streznik z nastavitvami (zagon Line, sprememba stikala). Brez vklopa se nic ne zazene in nic ne poslusa. */
export function uskladiGlasTelefona(dir?: string): Promise<void> {
  return zaporedno(async () => {
    const root = resolveDataDir(dir);
    // N-4: star zapis zetona v cistem besedilu se preseli ali zapre TAKOJ ob zagonu in ob vsaki uskladitvi, ne sele ob prvi povezavi
    await preberiZeton(root).catch(() => null);
    const n = await preberiNastavitve(root);
    const t = stanje().tekoci;
    if (t && (!n.vklop || t.naslov !== n.naslov || t.vrata !== n.vrata)) await ustavi();
    if (!n.vklop || stanje().tekoci) {
      if (!n.vklop) stanje().napaka = "";
      return;
    }
    try {
      const streznik = new GlasTelefonStreznik({
        root, naslov: n.naslov, vrata: n.vrata,
        zeton: () => preberiZeton(root),
        vklopljeno: async () => (await preberiNastavitve(root)).vklop,
      });
      const { naslov, vrata, odtis } = await streznik.zazeni();
      stanje().tekoci = { streznik, naslov, vrata, odtis };
      stanje().napaka = "";
    } catch (e) {
      const c = (e as NodeJS.ErrnoException).code;
      process.stderr.write(`[lina-glas-telefon] zagon ni uspel: ${c ?? (e as Error).message.slice(0, 200)}\n`);
      stanje().napaka = c === "EADDRINUSE" ? "Vrata so zasedena." : c === "EADDRNOTAVAIL" ? "Naslova ta racunalnik nima vec." : (e as Error).message.slice(0, 320);
    }
  });
}

export type StanjeGlasaTelefona = {
  vklop: boolean; naslov: string; vrata: number; naslovi: string[]; tece: boolean; napaka: string; odtis: string; zetonNastavljen: boolean; klicTece: boolean;
};

export async function stanjeGlasaTelefona(token: string | null, dir?: string): Promise<StanjeGlasaTelefona> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const n = await preberiNastavitve(root);
  const t = stanje().tekoci;
  return {
    vklop: n.vklop, naslov: n.naslov, vrata: n.vrata, naslovi: zasebniNaslovi(), tece: !!t, napaka: stanje().napaka || stanje().zetonNapaka, odtis: t?.odtis ?? "",
    zetonNastavljen: (await preberiZeton(root)) !== null, klicTece: t?.streznik.klicTece ?? false,
  };
}

/** Lastnik vklopi ali izklopi glas telefona in izbere zasebni naslov in vrata (privzeto izklopljeno). */
export async function shraniGlasTelefona(token: string | null, vnos: { vklop?: unknown; naslov?: unknown; vrata?: unknown }, dir?: string): Promise<StanjeGlasaTelefona> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const n = await preberiNastavitve(root);
  if (typeof vnos.naslov === "string" && !zasebniNaslovi().includes(vnos.naslov)) throw new Error("Izberite naslov tega racunalnika v domacem omrezju.");
  const vrata = vnos.vrata === undefined ? n.vrata : Number(vnos.vrata);
  if (!Number.isInteger(vrata) || vrata < 1024 || vrata > 65535) throw new Error("Vrata morajo biti celo stevilo od 1024 do 65535.");
  await writeJson(root, NASTAVITVE_GLASU_TELEFONA, {
    vklop: vnos.vklop === undefined ? n.vklop : vnos.vklop === true, naslov: typeof vnos.naslov === "string" ? vnos.naslov : n.naslov, vrata,
  } satisfies Nastavitve);
  await uskladiGlasTelefona(root);
  return stanjeGlasaTelefona(token, root);
}

/**
 * #17 OpenLine v isti aplikaciji: Lina SAMA pripravi glas telefona za OpenLine (lastnik ne vpise nic). Pokliche ga samo program (zagon OpenLine ob
 * »Povezi telefon«), zato brez preverjanja lastnika; ne sme postati funkcija strezniku ali pot. Vklopi glas telefona (izbran naslov in vrata ostaneta),
 * zasuka zeton (nov nakljucni; stari preneha veljati, aktivne seje se prekinejo), uskladi streznik in vrne podatke, ki jih OpenLine potrebuje
 * za povezavo na Lino: kje poslusa, odtis njegovega potrdila in nov zeton. Zeton se nikoli ne zapise v dnevnik.
 */
export async function pripraviGlasTelefonaZaOpenLine(dir?: string): Promise<{ naslov: string; vrata: number; odtis: string; zeton: string }> {
  const root = resolveDataDir(dir);
  const n = await preberiNastavitve(root);
  await writeJson(root, NASTAVITVE_GLASU_TELEFONA, { vklop: true, naslov: n.naslov, vrata: n.vrata } satisfies Nastavitve);
  const zeton = randomBytes(32).toString("base64url");
  await shraniZetonGlasaTelefona(root, zeton);
  await uskladiGlasTelefona(root);
  const t = stanje().tekoci;
  if (!t) throw new Error(stanje().napaka || "Glas telefona se ni zagnal.");
  return { naslov: t.naslov, vrata: t.vrata, odtis: t.odtis, zeton };
}

export function glasTelefonaTece(): boolean {
  return stanje().tekoci !== null;
}

/** Za preizkuse: ustavi tekoci streznik in pozabi stanje. */
export async function ustaviGlasTelefona(): Promise<void> {
  await zaporedno(ustavi);
}
