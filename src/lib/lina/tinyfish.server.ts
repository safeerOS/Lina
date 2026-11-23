import { rm } from "node:fs/promises";
import path from "node:path";
import { requireOwner } from "./auth.server.ts";
import { odsifrirajSkrivnost, sifrirajSkrivnost } from "./keys.server.ts";
import { razberiNaslov } from "./splet.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

/**
 * Rezerva za strani, ki brez JavaScripta ne pokazejo vsebine (lastnik 12. 11. 2026: »naj ima Lina tudi kaj koristnega od
 * TinyFish«). Vsak uporabnik s SVOJIM kljucem TinyFish; kljuc je sifriran na disku in gre samo na https api.fetch.tinyfish.ai,
 * brez preusmeritev. Poslje se samo javni https naslov strani podjetja, ki jo je uporabnik sam vpisal; nic iz klicev, kataloga
 * ali zapiskov. Oblika zahteve in odgovora po dokumentaciji docs.tinyfish.ai/fetch-api/reference (12. 11. 2026);
 * NEPREVERJENO s pravim kljucem do lastnikovega preizkusa.
 */
const DATOTEKA = "tinyfish.json";
const GOSTITELJ = "api.fetch.tinyfish.ai";
const ROK_MS = 60_000;
const MEJA_ZNAKOV = 200_000;

type Shranjeno = { iv: string; tag: string; ciphertext: string };
export type StanjeTinyFish = { povezan: boolean };
export type ZahtevaTinyFish = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; json: unknown }>;

export const zahtevaTinyFish: ZahtevaTinyFish = async (url, init) => {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.hostname !== GOSTITELJ) throw new Error("Nedovoljen naslov.");
  const odgovor = await fetch(u, { ...init, redirect: "error", signal: AbortSignal.timeout(ROK_MS) });
  let json: unknown = null;
  try {
    json = await odgovor.json();
  } catch {
    json = null;
  }
  return { status: odgovor.status, json };
};

export function jeVeljavenKljuc(kljuc: string): boolean {
  return kljuc.length >= 16 && kljuc.length <= 200 && !/\s/.test(kljuc);
}

function glava(kljuc: string): Record<string, string> {
  return { "X-API-Key": kljuc, "Content-Type": "application/json", Accept: "application/json" };
}

async function preberiKljuc(root: string): Promise<string | null> {
  const f = await readJsonFile<Shranjeno>(root, DATOTEKA);
  if (!f?.ciphertext) return null;
  return odsifrirajSkrivnost(f, root);
}

export async function stanjeTinyFish(token: string | null, dir?: string): Promise<StanjeTinyFish> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return { povezan: (await preberiKljuc(root)) !== null };
}

/** Kljuc se preveri z brezplacnim branjem porabe; napacen kljuc se ne shrani. */
export async function poveziTinyFish(
  token: string | null,
  kljuc: string,
  dir?: string,
  zahteva: ZahtevaTinyFish = zahtevaTinyFish,
): Promise<StanjeTinyFish> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const k = kljuc.trim();
  if (!jeVeljavenKljuc(k)) throw new Error("Kljuc TinyFish ni veljaven.");
  const odg = await zahteva(`https://${GOSTITELJ}/usage?limit=1`, { method: "GET", headers: glava(k) });
  if (odg.status === 401 || odg.status === 403) throw new Error("TinyFish kljuca ni sprejel.");
  if (odg.status !== 200) throw new Error("Povezava s TinyFish ni uspela.");
  await writeJson(root, DATOTEKA, await sifrirajSkrivnost(k, root));
  return { povezan: true };
}

export async function pozabiTinyFish(token: string | null, dir?: string): Promise<StanjeTinyFish> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  await rm(path.join(root, DATOTEKA), { force: true });
  return { povezan: false };
}

/**
 * Markdown strani prek TinyFish, ali null (brez kljuca, napaka, prazno). Napaka ne podre branja strani: Lina ostane pri
 * navadnem branju. Naslov mora biti javni https (isto preverjanje kot pri navadnem branju).
 */
export async function preberiPrekTinyFish(
  naslov: string,
  dir?: string,
  zahteva: ZahtevaTinyFish = zahtevaTinyFish,
): Promise<string | null> {
  const root = resolveDataDir(dir);
  const kljuc = await preberiKljuc(root);
  if (!kljuc) return null;
  const url = razberiNaslov(naslov);
  // Dodatno: IP v naslovu (tudi zasebni) in imena brez pike se ne posljejo zunanji storitvi.
  const gostitelj = url.hostname.replace(/^\[|\]$/g, "");
  if (!gostitelj.includes(".") || /^[\d.]+$/.test(gostitelj) || gostitelj.includes(":")) {
    throw new Error("Naslov ni javno ime strani.");
  }
  try {
    const odg = await zahteva(`https://${GOSTITELJ}`, {
      method: "POST",
      headers: glava(kljuc),
      body: JSON.stringify({
        urls: [url.toString()],
        format: "markdown",
        links: false,
        image_links: false,
        purpose: "Ucenje o podjetju za telefonsko tajnico: opis, storitve, uradne ure in stik.",
      }),
    });
    if (odg.status !== 200 || !odg.json || typeof odg.json !== "object") return null;
    const rezultati = (odg.json as { results?: unknown }).results;
    if (!Array.isArray(rezultati) || !rezultati.length) return null;
    const text = (rezultati[0] as { text?: unknown })?.text;
    return typeof text === "string" && text.trim() ? text.slice(0, MEJA_ZNAKOV) : null;
  } catch {
    return null;
  }
}
