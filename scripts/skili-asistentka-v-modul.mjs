#!/usr/bin/env node
// Generator skilov za asistentko Line: iz skili/<ime>/SKILL.md (velja: asistentka)
// zapise src/lib/lina/skili-asistentka.generated.ts. Skil za klice (brez velja: asistentka) preskoci.
// Pred zapisom preveri vse skile, meje dolzine in prepovedane vzorce; delnega modula nikoli ne zapise.
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const koren = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const POT_MODULA = path.join(koren, "src/lib/lina/skili-asistentka.generated.ts");

/** Najvecje dovoljeno stevilo znakov v razdelku PRAVILA [ASISTENTKA] enega skila. */
export const MEJA_PRAVIL_SKILA = 1200;
/** Najvecje dovoljeno stevilo znakov vseh razdelkov PRAVILA [ASISTENTKA] skupaj. */
export const MEJA_PRAVIL_SKUPAJ = 9000;
/** Imena skilov, ki ne smejo v Lino. */
export const PREPOVEDANA_IMENA = ["safeer-kljuci-lokacija"];
/** Prepovedani vzorci na celem besedilu skila: [imeVzorca, RegExp]. */
export const PREPOVEDANI_VZORCI = [
  ["osebno-ime-j", new RegExp(["ja", "nez"].join(""), "i")],
  ["osebno-ime-m", new RegExp(["ma", "tej"].join(""), "i")],
  ["domaca-pot", new RegExp(["\\/ho", "me\\/"].join(""))],
  ["naslov-ipv4", /\b\d{1,3}(\.\d{1,3}){3}\b/],
  ["kljuc-google", /AIza[0-9A-Za-z_-]{20,}/],
  ["kljuc-zeton", /\b(?:sk|ghp|gho)[-_][A-Za-z0-9_-]{16,}/],
  ["kljuc-slack", /\bxox[bap]-[A-Za-z0-9-]{10,}/],
  ["oznaka-klica", /\bCA[0-9a-f]{6,}\b/],
  ["prepovedana-tema", /(?:Ščit|Scit|YouTube|Googlov\w* prijav|Google sign)/i],
];

/** Konci vrstic v LF: vsebina in zgoscena vrednost sta na vseh sistemih enaki. */
export const vLf = (besedilo) => besedilo.replace(/\r\n?/g, "\n");

const primerjajBesedilo = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Preveri vsebino enega SKILL.md za asistentko; ob napaki vrze Error z razlogom. */
export function preveriSkilAsistentke(surovo, imeMape) {
  const md = vLf(surovo);
  const glava = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!glava) throw new Error(`${imeMape}: manjka glava (--- ... ---).`);

  const polje = (kljuc) => new RegExp(`^${kljuc}:\\s*(.+)$`, "m").exec(glava[1])?.[1]?.trim() ?? "";
  const ime = polje("name");
  const razlicicaSurovo = polje("razlicica");
  const velja = polje("velja");

  if (!/^[a-z0-9-]+$/.test(ime)) throw new Error(`${imeMape}: neveljavno ali manjkajoce polje name.`);
  if (ime !== imeMape) throw new Error(`${imeMape}: polje name (${ime}) se ne ujema z imenom mape.`);
  if (PREPOVEDANA_IMENA.includes(ime)) throw new Error(`${ime}: prepovedano ime skila.`);
  if (!/^[1-9]\d*$/.test(razlicicaSurovo)) throw new Error(`${ime}: manjka ali ni veljavna razlicica (celo stevilo >= 1).`);
  if (velja !== "asistentka") throw new Error(`${ime}: polje velja mora biti natanko asistentka.`);

  const telo = md.slice(glava[0].length);
  let najdenihPravil = 0;
  let vPravilih = false;
  const vrsticePravil = [];
  for (const vrstica of telo.split("\n")) {
    const naslovOznaka = /^##\s*(.*?)\s*\[ASISTENTKA\]\s*$/.exec(vrstica);
    if (naslovOznaka) {
      const imeRazdelka = naslovOznaka[1].trim();
      if (imeRazdelka !== "PRAVILA") {
        throw new Error(`${ime}: nedovoljen razdelek ${imeRazdelka || "(brez imena)"} [ASISTENTKA].`);
      }
      najdenihPravil += 1;
      if (najdenihPravil > 1) throw new Error(`${ime}: razdelek PRAVILA [ASISTENTKA] je podvojen.`);
      vPravilih = true;
      continue;
    }
    if (/^#{1,2} /.test(vrstica)) {
      vPravilih = false;
      continue;
    }
    if (vPravilih) vrsticePravil.push(vrstica);
  }

  if (najdenihPravil === 0) throw new Error(`${ime}: manjka razdelek PRAVILA [ASISTENTKA].`);
  const pravila = vrsticePravil.join("\n").trim();
  if (!pravila) throw new Error(`${ime}: razdelek PRAVILA [ASISTENTKA] je prazen.`);
  if (pravila.length > MEJA_PRAVIL_SKILA) {
    throw new Error(`${ime}: razdelek PRAVILA [ASISTENTKA] presega mejo ${MEJA_PRAVIL_SKILA} znakov (${pravila.length}).`);
  }

  for (const [imeVzorca, vzorec] of PREPOVEDANI_VZORCI) {
    if (vzorec.test(md)) {
      throw new Error(`${ime}: vsebina vsebuje prepovedan vzorec (${imeVzorca}).`);
    }
  }

  const razlicica = Number(razlicicaSurovo);
  const zgoscena = createHash("sha256").update(md).digest("hex").slice(0, 12);
  return {
    md,
    ime,
    razlicica,
    oznaka: `${ime}@${razlicica}+${zgoscena}`,
    pravila,
  };
}

/** Sestavi vsebino generiranega TS modula; uredi po imenu, preveri podvojena imena in skupno mejo. */
export function modulSkilovAsistentke(skili) {
  const urejeni = [...skili].sort((a, b) => primerjajBesedilo(a.ime, b.ime));
  const videna = new Set();
  let skupaj = 0;
  for (const skil of urejeni) {
    if (videna.has(skil.ime)) throw new Error(`podvojeno ime skila: ${skil.ime}.`);
    videna.add(skil.ime);
    skupaj += skil.pravila.length;
  }
  if (skupaj > MEJA_PRAVIL_SKUPAJ) {
    throw new Error(`skupna dolzina pravil presega mejo ${MEJA_PRAVIL_SKUPAJ} znakov (${skupaj}).`);
  }
  const vrstice = urejeni.map(
    ({ ime, oznaka, md }) => `  { ime: ${JSON.stringify(ime)}, oznaka: ${JSON.stringify(oznaka)}, md: ${JSON.stringify(md)} },`,
  );
  const seznam = vrstice.length === 0 ? "[]" : `[\n${vrstice.join("\n")}\n]`;
  return [
    "// GENERIRANO iz skili/<ime>/SKILL.md (velja: asistentka) s scripts/skili-asistentka-v-modul.mjs. Ne urejaj rocno: skili-asistentka.test.ts preveri skladnost.",
    `export const SKILI_ASISTENTKE_MD: ReadonlyArray<{ ime: string; oznaka: string; md: string }> = ${seznam};`,
    "",
  ].join("\n");
}

/** Prebere in preveri vse skile za asistentko v podmapah korenSkilov; simbolnih povezav ne sledi. */
export function preberiSkiliAsistentke(korenSkilov) {
  const vnosi = readdirSync(korenSkilov, { withFileTypes: true }).sort((a, b) => primerjajBesedilo(a.name, b.name));
  const rezultati = [];
  for (const vnos of vnosi) {
    if (vnos.isSymbolicLink() || !vnos.isDirectory()) continue;
    const potSkila = path.join(korenSkilov, vnos.name, "SKILL.md");
    let podatek;
    try {
      podatek = lstatSync(potSkila);
    } catch (e) {
      if (e && e.code === "ENOENT") continue;
      throw e;
    }
    if (podatek.isSymbolicLink() || !podatek.isFile()) continue;
    const surovo = readFileSync(potSkila, "utf8");
    const md = vLf(surovo);
    const glava = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(md);
    if (!glava) continue;
    const velja = /^velja:\s*(.+)$/m.exec(glava[1])?.[1]?.trim() ?? "";
    if (velja !== "asistentka") continue;
    rezultati.push(preveriSkilAsistentke(surovo, vnos.name));
  }
  return rezultati;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const skili = preberiSkiliAsistentke(path.join(koren, "skili"));
    const modul = modulSkilovAsistentke(skili);
    writeFileSync(POT_MODULA, modul);
    const znakov = skili.reduce((vsota, s) => vsota + s.pravila.length, 0);
    console.log(`skili za asistentko: ${skili.length}, ${znakov} znakov pravil`);
  } catch (napaka) {
    console.error(`NAPAKA: ${napaka instanceof Error ? napaka.message : String(napaka)}`);
    process.exit(1);
  }
}
