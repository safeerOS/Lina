import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

/**
 * Opozorilo ob prvem zagonu (lastnik 24. 11. 2026, AGENTS.md »Objava Line na safeer.si in opozorilo uporabniku«): osebna raba,
 * Lina je UI in lahko dela napake, uporaba na lastno odgovornost, nadzor in obseg dela doloci uporabnik. Brez potrditve »Razumem«
 * za TRENUTNO razlicico besedila Lina ne sprejema klicev in ne zaganja agentov. Ob spremembi besedila (besedila.ts opoz*) povecaj
 * RAZLICICA_OPOZORILA, da uporabnik potrdi znova. Na poti klica: ta datoteka uvaza samo store.server.ts.
 */
export const RAZLICICA_OPOZORILA = "2026-11-24";
export const DATOTEKA_OPOZORILA = "opozorilo.json";

export async function opozoriloPotrjeno(dir?: string): Promise<boolean> {
  try {
    const f = await readJsonFile<{ razlicica?: unknown }>(resolveDataDir(dir), DATOTEKA_OPOZORILA);
    return f?.razlicica === RAZLICICA_OPOZORILA;
  } catch {
    return false;
  }
}

/** Zapis potrditve (writeJson: 0600, atomarno). Klice ga samo lokalni vmesnik (functions.ts, assertLocalSetup). */
export async function potrdiOpozorilo(dir?: string, zdaj = new Date()): Promise<void> {
  await writeJson(resolveDataDir(dir), DATOTEKA_OPOZORILA, { razlicica: RAZLICICA_OPOZORILA, cas: zdaj.toISOString() });
}
