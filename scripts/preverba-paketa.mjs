// Preverba razpakiranega paketa deb: PDF po pravi poti (izvleciBesedilo -> otrok z ELECTRON_RUN_AS_NODE, kot v Lini) in
// vsi moduli, ki jih streznik nalozi po imenu (import.meta.resolve, dinamicni uvoz), razreseni iz mape svezenja.
// Uporaba: ELECTRON_RUN_AS_NODE=1 <opt/Lina/lina-lupina> scripts/preverba-paketa.mjs <resources/lina> <vzorec.pdf> <pricakovano besedilo>
// Ob napaki izhod 1. V paket ne pise nicesar (deluje tudi na namescenem paketu samo za branje): del svezenja z dodanimi izvozi
// ponudi kavelj nalaganja v pomnilniku (slepi pregled mozganov M7). Uvoz dela svezenja izvede njegovo kodo na vrhnji ravni s pravicami
// uporabnika - preverbo zato poganjaj samo na lastnem paketu.
// shortcut: module.register potrebuje Node >= 20.6 (Electron >= 28); na Electronu v paketu ni bilo zagnano (24. 11. 2026).
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [koren, pdf, pricakovano] = process.argv.slice(2);
if (!koren || !pdf || !pricakovano) {
  console.error("Uporaba: preverba-paketa.mjs <resources/lina> <vzorec.pdf> <pricakovano besedilo>");
  process.exit(2);
}
const ssr = join(koren, ".output/server/_ssr");
const kosi = readdirSync(ssr).filter((f) => f.endsWith(".mjs") && !f.startsWith("__preverba-"));
const del = kosi.filter((f) => readFileSync(join(ssr, f), "utf8").includes("async function izvleciBesedilo("));
if (del.length !== 1) {
  console.error(`NAPAKA: izvleciBesedilo je v ${del.length} delih svezenja (pricakovan 1): ${del.join(", ")}`);
  process.exit(1);
}

// Moduli po imenu: znani seznam (unpdf: otrok razclembe PDF; jazz: samoucenje) + vsak import.meta.resolve("x") / uvozi("x") v svezenju.
const imena = new Set(["unpdf", "jazz-tools", "cojson", "cojson-transport-ws"]);
const streznik = join(koren, ".output/server");
const vsi = readdirSync(streznik, { recursive: true }).filter((f) => /\.m?js$/.test(f) && !f.includes("__preverba-"));
for (const f of vsi) {
  for (const m of readFileSync(join(streznik, f), "utf8").matchAll(/(?:import\.meta\.resolve|\buvozi)\(\s*["']([^"'./][^"']*)["']\s*\)/g)) imena.add(m[1]);
}

// Isti del svezenja pod ?preverba z dodanimi izvozi: isto izhodisce razresevanja kot streznik, nic zapisanega na disk.
const PRIPONA =
  "\nexport { izvleciBesedilo as __izvleci };\nexport const __razresi = (n) => import.meta.resolve(n);\nexport const __uvozi = (n) => import(n);\n";
const kavelj = `const PRIPONA = ${JSON.stringify(PRIPONA)};
export async function load(url, ctx, next) {
  const r = await next(url, ctx);
  if (!url.endsWith("?preverba")) return r;
  return { format: "module", source: String(r.source) + PRIPONA, shortCircuit: true };
}`;
register("data:text/javascript," + encodeURIComponent(kavelj));
let napak = 0;
{
  const m = await import(pathToFileURL(join(ssr, del[0])).href + "?preverba");
  for (const ime of [...imena].sort()) {
    try {
      const naslov = m.__razresi(ime);
      await m.__uvozi(naslov);
      console.log(`OK modul ${ime} -> ${naslov}`);
    } catch (e) {
      napak++;
      console.error(`NAPAKA modul ${ime}: ${e?.code ?? ""} ${e?.message ?? e}`.slice(0, 300));
    }
  }
  try {
    const izid = await m.__izvleci("vzorec.pdf", new Uint8Array(readFileSync(pdf)));
    if (!izid?.besedilo?.includes(pricakovano)) throw new Error(`besedilo brez »${pricakovano}«: ${JSON.stringify(izid).slice(0, 200)}`);
    console.log(`OK PDF (${process.versions.node}, electron ${process.versions.electron ?? "-"}): ${JSON.stringify(izid.besedilo)}`);
  } catch (e) {
    napak++;
    console.error(`NAPAKA PDF: ${e?.name ?? ""} ${e?.razlog ?? ""} ${e?.message ?? e}`.slice(0, 300));
  }
}
console.log(napak ? `PREVERBA PAKETA: ${napak} napak` : "PREVERBA PAKETA: OK");
process.exit(napak ? 1 : 0);
