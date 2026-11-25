/**
 * Naloga 16: datoteke, ki jih Lina med tekom bere ali zazene ob sebi (Python skripte, podatki), v paketu niso ob svezenju.
 * Po gradnji je koda v resources/lina/.output/server/_ssr/*.mjs, zato pot iz import.meta.url ne kaze na scripts/ ali src/.
 * Koren namestitve (resources/lina) se razbere iz vstopne datoteke streznika (<koren>/.output/server/index.mjs, ki jo lupina
 * zazene na Linuxu in Windows); ne iz trde poti /opt/Lina, ki je na Windows ni.
 */
import { existsSync } from "node:fs";
import path from "node:path";

/** resources/lina iz vstopne datoteke streznika; null, ce streznik ni zagnan iz zgrajenega .output (razvoj, preizkusi). */
export function korenNamestitve(vstop: string | undefined = process.argv[1]): string | null {
  if (!vstop) return null;
  const datoteka = path.resolve(vstop);
  const server = path.dirname(datoteka);
  const output = path.dirname(server);
  if (path.basename(datoteka) !== "index.mjs" || path.basename(server) !== "server" || path.basename(output) !== ".output") return null;
  return path.dirname(output);
}

/** Datoteka iz paketa (pot relativno na resources/lina), ce obstaja; sicer razvojna pot v projektu. */
export function datotekaPaketa(relativno: string, razvoj: string, vstop?: string): string {
  const koren = korenNamestitve(vstop);
  const vPaketu = koren ? path.join(koren, relativno) : null;
  return vPaketu && existsSync(vPaketu) ? vPaketu : razvoj;
}
