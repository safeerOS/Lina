/**
 * Nastavitve SIP uporabnika (registrar, uporabnik, geslo). Geslo je sifrirano z glavnim kljucem Line (keys.server.ts,
 * AES-256-GCM, datoteka 0600) in nikoli ne gre nazaj v brskalnik ali v dnevnik. Branje/zapis samo za prijavljenega lastnika.
 * Povezave z zaslonom nastavitev in z zagonom klica (SipOdjemalec) se NI: to je samo vmesnik.
 */
import { rm } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { requireOwner } from "../auth.server.ts";
import { odsifrirajSkrivnost, sifrirajSkrivnost } from "../keys.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "../store.server.ts";
import { napaka, uspeh, type Izid } from "./izid.ts";
import type { SipKonfiguracija } from "./odjemalec.server.ts";

export const SIP_DATOTEKA = "sip.json";

export type SipVnos = {
  registrar: string;
  vrata?: number;
  domena?: string;
  uporabnik: string;
  avtUporabnik?: string;
  /** Prazno geslo pri spremembi pomeni: obdrzi shranjeno. */
  geslo?: string;
  expires?: number;
};

export type SipJavno = {
  nastavljen: boolean;
  registrar: string;
  vrata: number;
  domena: string;
  uporabnik: string;
  avtUporabnik: string;
  expires: number;
  imaGeslo: boolean;
};

type Shranjeno = {
  registrar: string;
  vrata: number;
  domena: string;
  uporabnik: string;
  avtUporabnik: string;
  expires: number;
  geslo: { iv: string; tag: string; ciphertext: string } | null;
};

const GOSTITELJ = /^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
// Uporabniski del SIP URI (RFC 3261 25.1: unreserved / user-unreserved), brez ubeznih zaporedij.
const UPORABNIK = /^[A-Za-z0-9\-_.!~*'()&=+$,;?/]{1,64}$/;

function gostitelj(v: string): boolean {
  return isIP(v) !== 0 || GOSTITELJ.test(v);
}

/** Cista preverba vnosa (brez diska). */
export function preveriSipVnos(v: SipVnos): Izid<Omit<Shranjeno, "geslo"> & { geslo: string }> {
  if (!v || typeof v !== "object") return napaka("Manjkajo podatki.");
  const registrar = String(v.registrar ?? "").trim();
  if (!gostitelj(registrar)) return napaka("Naslov strežnika SIP ni veljaven (samo ime ali IP, brez sip: in vrat).");
  const vrata = v.vrata === undefined ? 5060 : Number(v.vrata);
  if (!Number.isInteger(vrata) || vrata < 1 || vrata > 65535) return napaka("Vrata morajo biti od 1 do 65535.");
  const domena = String(v.domena ?? "").trim() || registrar;
  if (!gostitelj(domena)) return napaka("Domena SIP ni veljavna.");
  const uporabnik = String(v.uporabnik ?? "").trim();
  if (!UPORABNIK.test(uporabnik)) return napaka("Uporabniško ime SIP ni veljavno.");
  const avtUporabnik = String(v.avtUporabnik ?? "").trim() || uporabnik;
  if (!UPORABNIK.test(avtUporabnik)) return napaka("Uporabniško ime za prijavo ni veljavno.");
  const geslo = String(v.geslo ?? "");
  if (geslo.length > 128 || /[\r\n\0]/.test(geslo)) return napaka("Geslo SIP ni veljavno.");
  const expires = v.expires === undefined ? 300 : Number(v.expires);
  if (!Number.isInteger(expires) || expires < 60 || expires > 86400) return napaka("Veljavnost registracije mora biti od 60 do 86400 sekund.");
  return uspeh({ registrar, vrata, domena, uporabnik, avtUporabnik, expires, geslo });
}

function javno(s: Shranjeno | null): SipJavno {
  if (!s) return { nastavljen: false, registrar: "", vrata: 5060, domena: "", uporabnik: "", avtUporabnik: "", expires: 300, imaGeslo: false };
  return { nastavljen: true, registrar: s.registrar, vrata: s.vrata, domena: s.domena, uporabnik: s.uporabnik, avtUporabnik: s.avtUporabnik, expires: s.expires, imaGeslo: Boolean(s.geslo?.ciphertext) };
}

export async function preberiSip(token: string | null, dir?: string): Promise<SipJavno> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return javno(await readJsonFile<Shranjeno>(root, SIP_DATOTEKA));
}

export async function shraniSip(token: string | null, vnos: SipVnos, dir?: string): Promise<SipJavno> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const p = preveriSipVnos(vnos);
  if (!p.ok) throw new Error(p.napaka);
  const star = await readJsonFile<Shranjeno>(root, SIP_DATOTEKA);
  const geslo = p.vrednost.geslo ? await sifrirajSkrivnost(p.vrednost.geslo, root) : (star?.geslo ?? null);
  if (!geslo) throw new Error("Vpišite geslo SIP.");
  const zapis: Shranjeno = { ...p.vrednost, geslo };
  await writeJson(root, SIP_DATOTEKA, zapis);
  return javno(zapis);
}

export async function pozabiSip(token: string | null, dir?: string): Promise<SipJavno> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  await rm(path.join(root, SIP_DATOTEKA), { force: true });
  return javno(null);
}

/** Samo za streznik: konfiguracija odjemalca z odsifriranim geslom (ali null). Ne vracaj je v brskalnik. */
export async function sipKonfiguracija(dir?: string): Promise<SipKonfiguracija | null> {
  const root = resolveDataDir(dir);
  const s = await readJsonFile<Shranjeno>(root, SIP_DATOTEKA);
  if (!s?.geslo) return null;
  const geslo = await odsifrirajSkrivnost(s.geslo, root);
  if (geslo === null) return null;
  return { registrar: s.registrar, vrata: s.vrata, domena: s.domena, uporabnik: s.uporabnik, avtUporabnik: s.avtUporabnik, geslo, expires: s.expires };
}
