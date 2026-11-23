#!/usr/bin/env node
// postbuild: skil lina-slovenski-klici mora biti v ZGRAJENEM strezniku (lastnik 14. 11. 2026).
// Izracuna oznako iz skili/lina-slovenski-klici/SKILL.md in pade (koda 1), ce
//  (a) generirani modul src/lib/lina/skil-lina.generated.ts ni natanko iz SKILL.md (pozabljen `node scripts/skil-v-modul.mjs`), ali
//  (b) mape gradnje ni, ali oznake (ime@razlicica+zgoscena vrednost) ni v nobeni datoteki gradnje (star modul z isto stevilko razlicice
//      ima drugo zgosceno vrednost).
// Mapa gradnje: .output/server v korenu projekta; LINA_IZHOD je lahko tudi absolutna pot (preizkus). Rekonstruirano iz specifikacije
// (AGENTS.md, izgovor.sl.json.test.ts); prvotna skripta ni bila obnovljena.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { modulSkila, POT_MODULA, POT_SKILA, preveriSkil } from "./skil-v-modul.mjs";

const koren = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function napaka(sporocilo) {
  console.error(`NAPAKA: ${sporocilo}`);
  process.exit(1);
}

/** Vse datoteke v mapi (rekurzivno); simbolnih povezav ne sledimo. */
function* datoteke(mapa) {
  for (const vnos of readdirSync(mapa, { withFileTypes: true })) {
    const pot = path.join(mapa, vnos.name);
    if (vnos.isDirectory()) yield* datoteke(pot);
    else if (vnos.isFile()) yield pot;
  }
}

let oznaka;
let surovo;
try {
  surovo = readFileSync(POT_SKILA, "utf8");
  ({ oznaka } = preveriSkil(surovo));
} catch (e) {
  napaka(`skila ni mogoce prebrati ali je neveljaven (${e instanceof Error ? e.message : String(e)})`);
}

// (a) generirani modul mora biti natanko iz SKILL.md.
let modul = "";
try {
  modul = readFileSync(POT_MODULA, "utf8");
} catch {
  napaka(`generiranega modula ${POT_MODULA} ni: zazeni node scripts/skil-v-modul.mjs`);
}
if (modul.replace(/\r\n?/g, "\n") !== modulSkila(surovo)) {
  napaka(`generirani modul ${POT_MODULA} ni iz SKILL.md (oznaka ${oznaka}): zazeni node scripts/skil-v-modul.mjs`);
}

// (b) oznaka mora biti v gradnji.
const izhod = path.resolve(koren, process.env.LINA_IZHOD || ".output/server");
if (!existsSync(izhod) || !statSync(izhod).isDirectory()) napaka(`mape gradnje ${izhod} ni (najprej vite build)`);
let najdeno = false;
for (const datoteka of datoteke(izhod)) {
  if (!/\.(m?js|cjs|json)$/.test(datoteka)) continue;
  if (readFileSync(datoteka, "utf8").includes(oznaka)) {
    najdeno = true;
    break;
  }
}
if (!najdeno) napaka(`skila ${oznaka} ni v ${izhod} (gradnja je iz drugega SKILL.md ali starega modula)`);
console.log(`skil ${oznaka} je v gradnji (${izhod})`);
