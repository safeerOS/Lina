import { randomUUID } from "node:crypto";
import { requireOwner } from "./auth.server.ts";
import { MEJA_ZAPISOV, ocistiVnos, razlogVnosa, type RazlogVnosa, type VhodKoledar, type ZapisKoledar } from "./koledar.ts";
import { sl as BESEDILA_SL } from "./besedila.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

/** Koledar uporabnika: samo lokalno v podatkovni mapi (koledar.json). Vsak klic zahteva prijavo lastnika. */
const DATOTEKA = "koledar.json";

/** Zapisi si sledijo po vrsti, da hkratni klici ne prepisejo drug drugega. */
let veriga: Promise<unknown> = Promise.resolve();
function vVrsti<T>(delo: () => Promise<T>): Promise<T> {
  const rezultat = veriga.then(delo, delo);
  veriga = rezultat.catch(() => undefined);
  return rezultat;
}

function veljaven(z: unknown): z is ZapisKoledar {
  if (!z || typeof z !== "object") return false;
  const o = z as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.naslov === "string" && (o.vrsta === "dogodek" || o.vrsta === "opomnik" || o.vrsta === "zapisek");
}

async function preberi(root: string): Promise<ZapisKoledar[]> {
  const shranjeno = await readJsonFile<unknown>(root, DATOTEKA);
  if (!Array.isArray(shranjeno)) return [];
  return shranjeno.filter(veljaven).map((z) => ({
    id: z.id,
    vrsta: z.vrsta,
    naslov: z.naslov,
    cas: typeof z.cas === "string" ? z.cas : null,
    opravljeno: z.opravljeno === true,
    obvesceno: z.obvesceno === true,
    ustvarjeno: typeof z.ustvarjeno === "string" ? z.ustvarjeno : new Date(0).toISOString(),
  }));
}

export async function koledarSeznam(token: string | null, dir?: string): Promise<ZapisKoledar[]> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return preberi(root);
}

/** Dodaj zapis; napaka vnosa je sporocilo, ne izjema. Klice ga tudi pogovor (ze overjen lastnik). */
export function dodajZapis(root: string, vhod: VhodKoledar): Promise<{ ok: true; zapis: ZapisKoledar; zapisi: ZapisKoledar[] } | { ok: false; sporocilo: string; razlog: RazlogVnosa | "kolNapPolno" | null }> {
  return vVrsti(async () => {
    const ocisceno = ocistiVnos(vhod);
    if (typeof ocisceno === "string") return { ok: false as const, sporocilo: ocisceno, razlog: razlogVnosa(ocisceno) };
    const zapisi = await preberi(root);
    if (zapisi.length >= MEJA_ZAPISOV) return { ok: false as const, sporocilo: BESEDILA_SL.kolNapPolno.replace("{n}", String(MEJA_ZAPISOV)), razlog: "kolNapPolno" as const };
    const zapis: ZapisKoledar = { id: randomUUID(), ...ocisceno, opravljeno: false, obvesceno: false, ustvarjeno: new Date().toISOString() };
    const nova = [...zapisi, zapis];
    await writeJson(root, DATOTEKA, nova);
    return { ok: true as const, zapis, zapisi: nova };
  });
}

export async function koledarDodaj(vhod: VhodKoledar, token: string | null, dir?: string) {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return dodajZapis(root, vhod);
}

export type SpremembaKoledar = { opravljeno?: boolean; obvesceno?: boolean };

export async function koledarSpremeni(id: string, sprememba: SpremembaKoledar, token: string | null, dir?: string): Promise<ZapisKoledar[]> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return vVrsti(async () => {
    const zapisi = await preberi(root);
    const nova = zapisi.map((z) =>
      z.id === id
        ? {
            ...z,
            ...(typeof sprememba.opravljeno === "boolean" ? { opravljeno: sprememba.opravljeno } : {}),
            ...(typeof sprememba.obvesceno === "boolean" ? { obvesceno: sprememba.obvesceno } : {}),
          }
        : z,
    );
    await writeJson(root, DATOTEKA, nova);
    return nova;
  });
}

export async function koledarIzbrisi(id: string, token: string | null, dir?: string): Promise<ZapisKoledar[]> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return vVrsti(async () => {
    const nova = (await preberi(root)).filter((z) => z.id !== id);
    await writeJson(root, DATOTEKA, nova);
    return nova;
  });
}

/** Za pogovor: ze overjen lastnik, samo branje. */
export function koledarBeri(root: string): Promise<ZapisKoledar[]> {
  return preberi(root);
}
