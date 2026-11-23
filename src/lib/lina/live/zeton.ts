import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Enkratni podpisani zeton za WebSocket Twilio Media Streams. Twilio pri WebSocketu ne podpira glav, zato zeton gre kot
 * <Parameter name="zeton"> v TwiML in pride nazaj v dogodku 'start'. Zeton = cas + HMAC-SHA256(skrivnost procesa,
 * CallSid + cas): vezan na klic, velja 60 s, ena uporaba. Skrivnost zivi samo v pomnilniku procesa (zeton velja samo
 * toliko, kolikor tece proces; po ponovnem zagonu klic ne dobi vec povezave in ga Twilio konca).
 * Stanje je pod Symbol.for, ker ga delita spletna pot (TwiML) in vticnik WebSocket tudi, ce ju paket loci.
 */
export const ROK_ZETONA_LIVE_MS = 60_000;
const NAPREJ_MS = 5_000;

const KLJUC = Symbol.for("lina.live.zetoni");
type Stanje = {
  skrivnost: Buffer;
  /** id (HMAC) -> iztek in stevilka klicatelja (From); samo izdani in se neporabljeni zetoni. */
  izdani: Map<string, { iztek: number; from: string }>;
};

function stanje(): Stanje {
  const g = globalThis as { [KLJUC]?: Stanje };
  g[KLJUC] ??= { skrivnost: randomBytes(32), izdani: new Map() };
  return g[KLJUC];
}

function podpis(callSid: string, cas: number): string {
  return createHmac("sha256", stanje().skrivnost).update(`${callSid}|${cas}`, "utf8").digest("hex");
}

function pocisti(zdaj: number): void {
  for (const [id, z] of stanje().izdani) if (z.iztek <= zdaj) stanje().izdani.delete(id);
}

/** from: stevilka klicatelja iz podpisane zahteve Twilio; hrani se v pomnilniku ob zetonu (ne v TwiML), da jo most dobi preverjeno. */
export function izdajZetonLive(callSid: string, zdaj = Date.now(), from = ""): string {
  pocisti(zdaj);
  const hmac = podpis(callSid, zdaj);
  stanje().izdani.set(hmac, { iztek: zdaj + ROK_ZETONA_LIVE_MS, from: from.slice(0, 40) });
  return `${zdaj}.${hmac}`;
}

export type IzidZetona = "ok" | "neveljaven" | "potecen" | "ponovljen";

/**
 * Preveri in PORABI zeton. »ponovljen« = podpis je pravi, a zeton je ze porabljen ali ni bil izdan v tem procesu.
 * Zaporedje preverb: oblika -> podpis (konstanten cas) -> rok -> izdan in neporabljen.
 */
export function porabiZetonLive(zeton: string, callSid: string, zdaj = Date.now()): { izid: IzidZetona; from: string } {
  pocisti(zdaj);
  const m = /^(\d{10,16})\.([0-9a-f]{64})$/.exec(zeton);
  if (!m || !callSid) return { izid: "neveljaven", from: "" };
  const cas = Number(m[1]);
  const pricakovan = Buffer.from(podpis(callSid, cas), "hex");
  const dan = Buffer.from(m[2], "hex");
  if (pricakovan.length !== dan.length || !timingSafeEqual(pricakovan, dan)) return { izid: "neveljaven", from: "" };
  if (zdaj - cas > ROK_ZETONA_LIVE_MS || cas - zdaj > NAPREJ_MS) return { izid: "potecen", from: "" };
  const izdan = stanje().izdani.get(m[2]);
  if (!izdan) return { izid: "ponovljen", from: "" };
  stanje().izdani.delete(m[2]);
  return { izid: "ok", from: izdan.from };
}

/** Koliko izdanih in neporabljenih zetonov caka (nujen pogoj za sprejem povezave WebSocket). */
export function steviloCakajocihZetonov(zdaj = Date.now()): number {
  pocisti(zdaj);
  return stanje().izdani.size;
}

/** Za preizkus: izprazni izdane zetone. */
export function pozabiZetone(): void {
  stanje().izdani.clear();
}
