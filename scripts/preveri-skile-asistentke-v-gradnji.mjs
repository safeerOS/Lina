#!/usr/bin/env node
// postbuild: skili za asistentko morajo biti usklajeni z generiranim modulom in v zgrajenem strezniku.
// (a) generirani modul mora biti natanko modulSkilovAsistentke(preberiSkiliAsistentke(<koren>/skili));
// (b) ce je skilov 0, konca s kodo 0 brez zahteve po mapi gradnje; sicer mora vsaka oznaka obstajati v gradnji.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { modulSkilovAsistentke, POT_MODULA, preberiSkiliAsistentke, vLf } from "./skili-asistentka-v-modul.mjs";

const koren = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function napaka(sporocilo) {
  console.error(`NAPAKA: ${sporocilo}`);
  process.exit(1);
}

/** Vse datoteke v mapi (rekurzivno); simbolnih povezav ne sledimo. */
function* datoteke(mapa) {
  for (const vnos of readdirSync(mapa, { withFileTypes: true })) {
    const pot = path.join(mapa, vnos.name);
    if (vnos.isSymbolicLink()) continue;
    if (vnos.isDirectory()) yield* datoteke(pot);
    else if (vnos.isFile()) yield pot;
  }
}

let skili;
let pricakovaniModul;
try {
  skili = preberiSkiliAsistentke(path.join(koren, "skili"));
  pricakovaniModul = modulSkilovAsistentke(skili);
} catch (e) {
  napaka(`skilov za asistentko ni mogoce prebrati ali so neveljavni (${e instanceof Error ? e.message : String(e)})`);
}

// (a) generirani modul mora biti natanko iz skilov za asistentko.
let modul = "";
try {
  modul = readFileSync(POT_MODULA, "utf8");
} catch {
  napaka(`generiranega modula ${POT_MODULA} ni: zazeni node scripts/skili-asistentka-v-modul.mjs`);
}
if (vLf(modul) !== pricakovaniModul) {
  napaka(`generirani modul ${POT_MODULA} ni usklajen s skili: zazeni node scripts/skili-asistentka-v-modul.mjs`);
}

// (b) ce je skilov 0, mape gradnje ne zahtevamo.
if (skili.length === 0) {
  console.log("skilov za asistentko ni (nic za preveriti v gradnji)");
  process.exit(0);
}

const izhod = path.resolve(koren, process.env.LINA_IZHOD || ".output/server");
if (!existsSync(izhod) || !statSync(izhod).isDirectory()) {
  napaka(`mape gradnje ${izhod} ni (najprej vite build)`);
}

const manjkajoci = new Set(skili.map((s) => s.oznaka));
for (const datoteka of datoteke(izhod)) {
  if (!/\.(m?js|cjs|json)$/.test(datoteka)) continue;
  const vsebina = readFileSync(datoteka, "utf8");
  for (const oznaka of [...manjkajoci]) {
    if (vsebina.includes(oznaka)) manjkajoci.delete(oznaka);
  }
  if (manjkajoci.size === 0) break;
}

if (manjkajoci.size > 0) {
  const seznam = skili
    .filter((s) => manjkajoci.has(s.oznaka))
    .map((s) => `${s.ime} (${s.oznaka})`)
    .join(", ");
  napaka(`skilov za asistentko ni v ${izhod}: ${seznam}`);
}

console.log(`skili za asistentko (${skili.length}) so v gradnji (${izhod})`);
