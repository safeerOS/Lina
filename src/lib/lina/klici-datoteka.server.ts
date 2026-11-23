/**
 * Strezniski zapis ene vrstice na klic v datoteko Klici.txt v mapi zapiskov (naloga #18).
 * Zapisi ostanejo samo v uporabnikovi mapi; atomarni zapis (tmp + sync + rename, 0600),
 * vzporedni klici za isto mapo se serializirajo, napaka nikoli ne vrze.
 */
import { createHash, randomBytes } from "node:crypto";
import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { dopolniKlici, vrsticaKlica } from "./klici-datoteka.ts";
import type { CallSession } from "./types.ts";
import { mapaZaPisanje } from "./zapiski.server.ts";

export const DATOTEKA_KLICEV = "Klici.txt";
/** Zascita pomnilnika: 2000 vrstic po ~300 znakov je ~600 KB; 2 MB je varna zgornja meja. */
const NAJVEC_VELIKOST_KLICEV = 2 * 1024 * 1024;

const vrste = new Map<string, Promise<unknown>>();

function vVrsti<T>(kljuc: string, delo: () => Promise<T>): Promise<T> {
  const prej = vrste.get(kljuc) ?? Promise.resolve();
  const naslednji = prej.catch(() => undefined).then(delo);
  const rep = naslednji.catch(() => undefined);
  vrste.set(kljuc, rep);
  void rep.then(() => {
    if (vrste.get(kljuc) === rep) vrste.delete(kljuc);
  });
  return naslednji;
}

/** Prvih 8 sestnajstiskih znakov sha256(callSid). */
export function idKlica(callSid: string): string {
  return createHash("sha256").update(callSid, "utf8").digest("hex").slice(0, 8);
}

async function preberiObstojeco(pot: string): Promise<string> {
  try {
    const info = await lstat(pot);
    // Simbolna povezava ali imenik se ne bere in ne prepisuje.
    if (!info.isFile()) throw new Error("Klici.txt ni navadna datoteka.");
    if (info.size > NAJVEC_VELIKOST_KLICEV) throw new Error("Klici.txt presega dovoljeno velikost.");
    return await readFile(pot, "utf8");
  } catch (napaka) {
    if ((napaka as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw napaka;
  }
}

async function zapisiAtomarno(mapa: string, pot: string, vsebina: string): Promise<void> {
  const tmp = path.join(mapa, `.${DATOTEKA_KLICEV}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  const rocaj = await open(tmp, "wx", 0o600);
  try {
    await rocaj.writeFile(vsebina, "utf8");
    await rocaj.sync();
  } catch (napaka) {
    await rocaj.close().catch(() => undefined);
    await unlink(tmp).catch(() => undefined);
    throw napaka;
  }
  await rocaj.close();
  try {
    await rename(tmp, pot);
  } catch (napaka) {
    await unlink(tmp).catch(() => undefined);
    throw napaka;
  }
}

/**
 * Doda ali posodobi vrstico klica v Klici.txt v uporabnikovi mapi zapiskov.
 * Vrne true ob uspehu, false ob kakrsni koli napaki; nikoli ne vrze.
 */
export async function zapisiKlicVDatoteko(call: CallSession, root: string): Promise<boolean> {
  try {
    const mapa = await mapaZaPisanje(root);
    const id = idKlica(call.callSid);
    const vrstica = vrsticaKlica(call, id);
    await vVrsti(mapa, async () => {
      const pot = path.join(mapa, DATOTEKA_KLICEV);
      const obstojeca = await preberiObstojeco(pot);
      const nova = dopolniKlici(obstojeca, vrstica, id);
      await zapisiAtomarno(mapa, pot, nova);
    });
    return true;
  } catch {
    return false;
  }
}
