import { jeTunelskiNaslov } from "./sprejem-klicev.ts";
import { requireOwner } from "./auth.server.ts";
import { odsifrirajSkrivnost, sifrirajSkrivnost } from "./keys.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";
import { rm } from "node:fs/promises";
import path from "node:path";

/**
 * Racun Twilio: Account SID + API kljuc (lastnik 11. 11. 2026, »dovolj je API«, 12. 11. 2026). Kljuc je sifriran na disku
 * (isti glavni kljuc kot pri kljucih mozganov), nikoli v dnevniku ali odgovoru strezniku. Brez prijave z racunom Twilio in
 * brez branja zetona iz konzole. Vsi klici gredo samo na https api.twilio.com, brez preusmeritev.
 */
const DATOTEKA = "twilio.json";
const OSNOVA = "https://api.twilio.com/2010-04-01/";
const SID_RACUNA = /^AC[0-9a-f]{32}$/i;
const SID_KLJUCA = /^SK[0-9a-f]{32}$/i;
const ROK_MS = 10_000;

type Shranjeno = {
  sid: string;
  kljucSid: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

export type StanjeTwilio = { povezan: boolean; sid: string | null; kljucSid: string | null };
export type StevilkaTwilio = { sid: string; stevilka: string; ime: string; glasUrl: string };

export type ZahtevaTwilio = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; json: unknown }>;

/** Samo https api.twilio.com in webhooks.twilio.com, brez preusmeritev (zahteva nosi kljuc). */
export const zahtevaTwilio: ZahtevaTwilio = async (url, init) => {
  const u = new URL(url);
  if (u.protocol !== "https:" || (u.hostname !== "api.twilio.com" && u.hostname !== "webhooks.twilio.com")) throw new Error("Nedovoljen naslov.");
  const odgovor = await fetch(u, { ...init, redirect: "error", signal: AbortSignal.timeout(ROK_MS) });
  let json: unknown = null;
  try {
    json = await odgovor.json();
  } catch {
    json = null;
  }
  return { status: odgovor.status, json };
};

export function glava(sid: string, kljucSid: string, skrivnost: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${kljucSid}:${skrivnost}`).toString("base64")}`,
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
}

export function jeVeljavenVnos(sid: string, kljucSid: string, skrivnost: string): string | null {
  if (!SID_RACUNA.test(sid)) return "Account SID se zacne z AC in ima 34 znakov.";
  if (!SID_KLJUCA.test(kljucSid)) return "SID API kljuca se zacne s SK in ima 34 znakov.";
  if (skrivnost.length < 20 || skrivnost.length > 100 || /\s/.test(skrivnost)) return "Skrivnost API kljuca ni veljavna.";
  return null;
}

export async function preberi(dir: string): Promise<{ sid: string; kljucSid: string; skrivnost: string } | null> {
  const f = await readJsonFile<Shranjeno>(dir, DATOTEKA);
  if (!f?.sid || !f.kljucSid) return null;
  const skrivnost = await odsifrirajSkrivnost(f, dir);
  return skrivnost ? { sid: f.sid, kljucSid: f.kljucSid, skrivnost } : null;
}

export async function stanjeTwilioRacuna(token: string | null, dir?: string): Promise<StanjeTwilio> {
  await requireOwner(token, resolveDataDir(dir));
  const root = resolveDataDir(dir);
  const f = await readJsonFile<Shranjeno>(root, DATOTEKA);
  return f?.sid ? { povezan: true, sid: f.sid, kljucSid: f.kljucSid } : { povezan: false, sid: null, kljucSid: null };
}

/** Shrani po uspesni preverbi pri Twilio (branje racuna s tem kljucem). Napacen vnos se ne shrani. */
export async function povezi(
  token: string | null,
  vnos: { sid: string; kljucSid: string; skrivnost: string },
  dir?: string,
  zahteva: ZahtevaTwilio = zahtevaTwilio,
): Promise<StanjeTwilio> {
  await requireOwner(token, resolveDataDir(dir));
  const sid = vnos.sid.trim();
  const kljucSid = vnos.kljucSid.trim();
  const skrivnost = vnos.skrivnost.trim();
  const napaka = jeVeljavenVnos(sid, kljucSid, skrivnost);
  if (napaka) throw new Error(napaka);
  const odg = await zahteva(`${OSNOVA}Accounts/${sid}.json`, { method: "GET", headers: glava(sid, kljucSid, skrivnost) });
  if (odg.status === 401 || odg.status === 403) {
    // Twilio v odgovoru poda kodo in besedilo napake (brez skrivnosti); pomaga ugotoviti, ali je kriva skrivnost, racun ali tip kljuca.
    const j = (odg.json ?? {}) as { code?: unknown; message?: unknown };
    const podrobnost = [`HTTP ${odg.status}`, typeof j.code === "number" ? `koda ${j.code}` : "", typeof j.message === "string" ? j.message.slice(0, 160) : ""]
      .filter(Boolean)
      .join(", ");
    throw new Error(`Twilio kljuca ni sprejel. Preveri SID in skrivnost. (${podrobnost})`);
  }
  if (odg.status !== 200) throw new Error("Povezava s Twilio ni uspela.");
  const root = resolveDataDir(dir);
  const sifra = await sifrirajSkrivnost(skrivnost, root);
  await writeJson(root, DATOTEKA, { sid, kljucSid, ...sifra } satisfies Shranjeno);
  return { povezan: true, sid, kljucSid };
}

export async function stevilkeTwilio(
  token: string | null,
  dir?: string,
  zahteva: ZahtevaTwilio = zahtevaTwilio,
): Promise<StevilkaTwilio[]> {
  await requireOwner(token, resolveDataDir(dir));
  const r = await preberi(resolveDataDir(dir));
  if (!r) throw new Error("Twilio ni povezan.");
  const odg = await zahteva(`${OSNOVA}Accounts/${r.sid}/IncomingPhoneNumbers.json?PageSize=50`, {
    method: "GET",
    headers: glava(r.sid, r.kljucSid, r.skrivnost),
  });
  if (odg.status !== 200) throw new Error("Stevilk ni bilo mogoce prebrati.");
  const seznam = (odg.json as { incoming_phone_numbers?: Array<Record<string, unknown>> } | null)?.incoming_phone_numbers ?? [];
  return seznam
    .filter((s) => typeof s.sid === "string" && typeof s.phone_number === "string")
    .map((s) => ({
      sid: String(s.sid),
      stevilka: String(s.phone_number),
      ime: typeof s.friendly_name === "string" ? s.friendly_name : "",
      glasUrl: typeof s.voice_url === "string" ? s.voice_url : "",
    }));
}

/** Nastavi (ali ob praznem naslovu odstrani) naslov klicev na izbrani stevilki. Naslov mora biti https. */
export async function nastaviNaslovKlicev(
  token: string | null,
  stevilkaSid: string,
  naslov: string,
  dir?: string,
  zahteva: ZahtevaTwilio = zahtevaTwilio,
): Promise<void> {
  await requireOwner(token, resolveDataDir(dir));
  if (!/^PN[0-9a-f]{32}$/i.test(stevilkaSid)) throw new Error("Neveljavna stevilka.");
  if (naslov && !/^https:\/\//i.test(naslov)) throw new Error("Naslov klicev mora biti https.");
  if (naslov && jeTunelskiNaslov(naslov)) throw new Error("Sprejem klicev deluje samo po neposredni poti, ne prek tunela Cloudflare.");
  const r = await preberi(resolveDataDir(dir));
  if (!r) throw new Error("Twilio ni povezan.");
  const telo = new URLSearchParams({ VoiceUrl: naslov, VoiceMethod: "POST" }).toString();
  const odg = await zahteva(`${OSNOVA}Accounts/${r.sid}/IncomingPhoneNumbers/${stevilkaSid}.json`, {
    method: "POST",
    headers: glava(r.sid, r.kljucSid, r.skrivnost),
    body: telo,
  });
  if (odg.status !== 200) throw new Error("Naslova klicev ni bilo mogoce nastaviti.");
}

/** Pozabi racun: izbris datoteke s sifrirano skrivnostjo. Odstranitev naslova na stevilki ponudi vmesnik PRED tem. */
export async function pozabiTwilio(token: string | null, dir?: string): Promise<void> {
  await requireOwner(token, resolveDataDir(dir));
  await rm(path.join(resolveDataDir(dir), DATOTEKA), { force: true });
}
