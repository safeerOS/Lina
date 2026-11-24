// Prenosen zagon preizkusov (Linux, Windows): spremenljivka okolja gre podprocesu z env=, brez lupine in brez glob razsiritve lupine.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const koren = join(dirname(fileURLToPath(import.meta.url)), "..");
const mapa = join("src", "lib", "lina");
const datoteke = readdirSync(join(koren, mapa)).filter((ime) => ime.endsWith(".test.ts")).sort().map((ime) => join(mapa, ime));
// LINA_PODROBNI_POTEK=1: stari preizkusi poteka zbiranja podatkov (privzeti potek podjetja je kratek zakljucek).
const izid = spawnSync(process.execPath, ["--experimental-strip-types", "--test", "--test-concurrency=1", ...datoteke], {
  cwd: koren,
  stdio: "inherit",
  env: { ...process.env, LINA_PODROBNI_POTEK: "1" },
});
// Izhod v dnevnik (CI 24. 11. 2026: koda 1 ob »fail 0« - vzrok mora biti viden): status, signal, napaka zagona.
console.error(`[test.mjs] status=${izid.status} signal=${izid.signal} napaka=${izid.error?.message ?? "-"}`);
process.exit(izid.status ?? 1);
