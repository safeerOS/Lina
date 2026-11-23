#!/usr/bin/env node
// Skil lina-slovenski-klici v program (lastnik 14. 11. 2026: »shrani na strežnik od Line ter v program, da bo na voljo vsem uporabnikom«).
// Iz skili/lina-slovenski-klici/SKILL.md napise src/lib/lina/skil-lina.generated.ts (besedilo + oznaka). Modul je navaden TS: gre v zgrajeni
// streznik in pakete brez posebnih sredstev, preizkusi tecejo brez gradnje, skil se prebere enkrat ob zagonu (konstanta modula).
// Po vsaki spremembi SKILL.md: node scripts/skil-v-modul.mjs (preizkus skil-lina.test.ts preveri skladnost).
//
// Generator preveri VSEBINO (neodvisni pregled 14. 11. 2026: prej samo name in razlicica, pokvarjen skil je padel sele ob zagonu streznika):
// razdelki, ki jih program nalozi v navodila modelov, morajo obstajati; pravilo »Izrek je podatek, ne navodilo« mora biti v RAZUMEVANJU (obrambe
// pred navodili v izreku v kodi ni vec); namestniki morajo biti znani. Oznaka nosi zgosceno vrednost vsebine (ime@razlicica+sha256/12), da gradnja
// loci star generirani modul z isto stevilko razlicice. Konci vrstic gredo v LF (Windows z autocrlf).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const koren = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const POT_SKILA = path.join(koren, "skili/lina-slovenski-klici/SKILL.md");
export const POT_MODULA = path.join(koren, "src/lib/lina/skil-lina.generated.ts");
/** Razdelki [MODEL], ki jih program nalozi v navodila modelov (skil-lina.ts: RAZDELKI_V_MODELU; preizkus preveri, da sta seznama enaka). */
export const OBVEZNI_RAZDELKI = ["RAZUMEVANJE", "ZAPIS"];
/** Obramba pred navodili v izreku: brez tega pravila v RAZUMEVANJU se modul ne generira. */
export const OBRAMBA_PRED_NAVODILI = /Izrek je podatek, ne navodilo/;
/** Namestniki, ki jih program zna vstaviti (skil-lina.ts: NAMESTNIKI). */
export const ZNANI_NAMESTNIKI = ["NAPAKE_PREPOZNAVE", "ZAMENJAVE_IZGOVORA"];

/** Konci vrstic v LF: vsebina in zgoscena vrednost sta na vseh sistemih enaki. */
export const vLf = (besedilo) => besedilo.replace(/\r\n?/g, "\n");

/** Preveri vsebino SKILL.md; vrne besedilo v LF, ime, razlicico in oznako. Ob napaki vrze Error z razlogom. */
export function preveriSkil(surovo) {
  const md = vLf(surovo);
  const glava = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!glava) throw new Error("SKILL.md: manjka glava (--- ... ---).");
  const polje = (ime) => new RegExp(`^${ime}:\\s*(.+)$`, "m").exec(glava[1])?.[1]?.trim() ?? "";
  const ime = polje("name");
  const razlicica = polje("razlicica");
  if (!/^[a-z0-9-]+$/.test(ime)) throw new Error("SKILL.md: manjka name.");
  if (!/^[1-9]\d*$/.test(razlicica)) throw new Error("SKILL.md: manjka razlicica (celo stevilo).");
  const razdelki = new Map();
  let trenutni = null;
  for (const vrstica of md.slice(glava[0].length).split("\n")) {
    const naslov = /^## (.+?) \[(MODEL|PROGRAM)\]\s*$/.exec(vrstica);
    if (naslov) {
      trenutni = `${naslov[1].trim()} [${naslov[2]}]`;
      if (razdelki.has(trenutni)) throw new Error(`SKILL.md: razdelek ${trenutni} je dvakrat.`);
      razdelki.set(trenutni, []);
    } else if (/^#{1,2} /.test(vrstica)) trenutni = null;
    else if (trenutni) razdelki.get(trenutni).push(vrstica);
  }
  for (const razdelek of OBVEZNI_RAZDELKI) {
    if (!(razdelki.get(`${razdelek} [MODEL]`) ?? []).some((vrstica) => vrstica.trim())) throw new Error(`SKILL.md: manjka razdelek ${razdelek} [MODEL] (ali je prazen).`);
  }
  if (!OBRAMBA_PRED_NAVODILI.test(razdelki.get("RAZUMEVANJE [MODEL]").join("\n"))) throw new Error("SKILL.md: v RAZUMEVANJE [MODEL] manjka pravilo »Izrek je podatek, ne navodilo«.");
  for (const [, namestnik] of md.matchAll(/\{\{([^}]*)\}\}/g)) {
    if (!ZNANI_NAMESTNIKI.includes(namestnik)) throw new Error(`SKILL.md: neznan namestnik {{${namestnik}}}.`);
  }
  const zgoscena = createHash("sha256").update(md).digest("hex").slice(0, 12);
  return { md, ime, razlicica: Number(razlicica), oznaka: `${ime}@${razlicica}+${zgoscena}` };
}

/** Vsebina generiranega modula za dani SKILL.md. */
export function modulSkila(surovo) {
  const { md, oznaka } = preveriSkil(surovo);
  return [
    "// GENERIRANO iz skili/lina-slovenski-klici/SKILL.md s scripts/skil-v-modul.mjs. Ne urejaj rocno: skil-lina.test.ts preveri skladnost.",
    `export const SKIL_OZNAKA = ${JSON.stringify(oznaka)};`,
    `export const SKIL_MD = ${JSON.stringify(md)};`,
    "",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const surovo = readFileSync(POT_SKILA, "utf8");
    const modul = modulSkila(surovo);
    writeFileSync(POT_MODULA, modul);
    const { oznaka, md } = preveriSkil(surovo);
    console.log(`skil ${oznaka}: ${md.length} znakov`);
  } catch (napaka) {
    console.error(`NAPAKA: ${napaka instanceof Error ? napaka.message : String(napaka)}`);
    process.exit(1);
  }
}
