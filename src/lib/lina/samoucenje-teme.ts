// Samoucenje (lastnik 21. in 22. 11. 2026): iskanje teme v indeksu Learn Anything (MIT, glej podatki/LEARN-ANYTHING-MIT.txt).
// Iz naprave gre samo veljaven kljuc teme iz indeksa, nikoli besedilo uporabnika (zasebnost). Modul je cist: brez omrezja, brez pisanja.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Tema {
  name: string;
  prettyName: string;
  connectedTopics: string[];
}

let predpomnjeno: Map<string, Tema> | null = null;

export function naloziIndeksTem(besedilo?: string): Map<string, Tema> {
  if (!besedilo && predpomnjeno) return predpomnjeno;
  const surovo = besedilo ?? readFileSync(join(dirname(fileURLToPath(import.meta.url)), "podatki", "learn-anything-teme.json"), "utf8");
  const sez: unknown = JSON.parse(surovo);
  if (!Array.isArray(sez)) throw new Error("indeks tem ni seznam");
  const m = new Map<string, Tema>();
  for (const e of sez) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    if (typeof o.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9-]{0,80}$/.test(o.name)) continue;
    const povezane = Array.isArray(o.connectedTopics) ? o.connectedTopics.filter((x): x is string => typeof x === "string") : [];
    m.set(o.name, { name: o.name, prettyName: typeof o.prettyName === "string" ? o.prettyName : o.name, connectedTopics: povezane });
  }
  if (!besedilo) predpomnjeno = m;
  return m;
}

/** Normalizacija iskanega niza v obliko kljuca teme (male crke, presledki v vezaje). */
export function kljucTeme(niz: string): string {
  return niz.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

export function jeVeljavenKljucTeme(kljuc: string, indeks: Map<string, Tema> = naloziIndeksTem()): boolean {
  return indeks.has(kljuc);
}

/** Najde temo po kljucu ali prikaznem imenu; vrne null, ce je ni (takrat se na streznik ne poslje nic). */
export function najdiTemo(poizvedba: string, indeks: Map<string, Tema> = naloziIndeksTem()): Tema | null {
  const k = kljucTeme(poizvedba);
  if (!k) return null;
  const neposredno = indeks.get(k);
  if (neposredno) return neposredno;
  // Dva kljuca v indeksu imata velike crke (macOS, macOS-apps): primerjava brez razlike velikosti.
  for (const t of indeks.values()) if (kljucTeme(t.name) === k || kljucTeme(t.prettyName) === k) return t;
  return null;
}

/** Povezane teme, ki v indeksu res obstajajo (kazalce na manjkajoce teme zavrze). */
export function povezaneTeme(t: Tema, indeks: Map<string, Tema> = naloziIndeksTem()): Tema[] {
  return t.connectedTopics.map((k) => indeks.get(k)).filter((x): x is Tema => !!x);
}
