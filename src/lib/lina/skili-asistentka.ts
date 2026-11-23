/**
 * Skili za asistentko Line: razclenitev iz generiranega modula (velja: asistentka) in sestava
 * kratkega povzetka pravil za sistemsko navodilo asistentke. Popolnoma loceno od skila za klice.
 */
import { SKILI_ASISTENTKE_MD } from "./skili-asistentka.generated.ts";

export type SkilAsistentke = { ime: string; razlicica: number; oznaka: string; pravila: string };

/** Razcleni en SKILL.md za asistentko (glava + razdelek PRAVILA [ASISTENTKA]) in preveri oznako. */
export function razcleniSkilAsistentke(md: string, oznaka: string): SkilAsistentke {
  const besedilo = md.replace(/\r\n?/g, "\n");
  const glava = /^---\n([\s\S]*?)\n---\n/.exec(besedilo);
  if (!glava) throw new Error("Skil asistentke: manjka glava.");

  const polje = (kljuc: string) => new RegExp(`^${kljuc}:\\s*(.+)$`, "m").exec(glava[1] ?? "")?.[1]?.trim() ?? "";
  const ime = polje("name");
  const razlicicaSurovo = polje("razlicica");
  const velja = polje("velja");

  if (!/^[a-z0-9-]+$/.test(ime)) throw new Error("Skil asistentke: neveljavno ali manjkajoce polje name.");
  if (!/^[1-9]\d*$/.test(razlicicaSurovo)) throw new Error(`Skil asistentke (${ime}): manjka ali ni veljavna razlicica.`);
  if (velja !== "asistentka") throw new Error(`Skil asistentke (${ime}): polje velja mora biti asistentka.`);

  const razlicica = Number(razlicicaSurovo);
  const predpona = `${ime}@${razlicica}+`;
  if (!oznaka.startsWith(predpona) || oznaka.length <= predpona.length) {
    throw new Error(`Skil asistentke (${ime}): oznaka ne ustreza glavi (${predpona}...).`);
  }

  const telo = besedilo.slice(glava[0].length);
  let najdenihPravil = 0;
  let vPravilih = false;
  const vrsticePravil: string[] = [];
  for (const vrstica of telo.split("\n")) {
    const naslovOznaka = /^##\s*(.*?)\s*\[ASISTENTKA\]\s*$/.exec(vrstica);
    if (naslovOznaka) {
      const imeRazdelka = (naslovOznaka[1] ?? "").trim();
      if (imeRazdelka !== "PRAVILA") {
        throw new Error(`Skil asistentke (${ime}): nedovoljen razdelek ${imeRazdelka || "(brez imena)"} [ASISTENTKA].`);
      }
      najdenihPravil += 1;
      if (najdenihPravil > 1) throw new Error(`Skil asistentke (${ime}): razdelek PRAVILA [ASISTENTKA] je podvojen.`);
      vPravilih = true;
      continue;
    }
    if (/^#{1,2} /.test(vrstica)) {
      vPravilih = false;
      continue;
    }
    if (vPravilih) vrsticePravil.push(vrstica);
  }

  if (najdenihPravil === 0) throw new Error(`Skil asistentke (${ime}): manjka razdelek PRAVILA [ASISTENTKA].`);
  const pravila = vrsticePravil.join("\n").trim();
  if (!pravila) throw new Error(`Skil asistentke (${ime}): razdelek PRAVILA [ASISTENTKA] je prazen.`);

  return { ime, razlicica, oznaka, pravila };
}

/** Skili asistentke, razclenjeni enkrat ob nalaganju modula. */
export const SKILI_ASISTENTKE: readonly SkilAsistentke[] = Object.freeze(
  SKILI_ASISTENTKE_MD.map((vnos) => {
    const skil = razcleniSkilAsistentke(vnos.md, vnos.oznaka);
    if (skil.ime !== vnos.ime) {
      throw new Error(`Skil asistentke: ime v modulu (${vnos.ime}) se ne ujema z glavo (${skil.ime}).`);
    }
    return skil;
  }),
);

/** Sestavi dodatek za sistemsko navodilo asistentke; prazen seznam vrne prazen niz. */
export function navodiloSkilov(skili: readonly SkilAsistentke[] = SKILI_ASISTENTKE): string {
  if (skili.length === 0) return "";
  const deli = skili.map((s) => {
    const strnjeno = s.pravila.replace(/\s+/g, " ").trim();
    return strnjeno ? `[${s.ime}] ${strnjeno}` : `[${s.ime}]`;
  });
  return ` SKILI (pravila dela; ne razveljavijo varnosti, e-poste, brisanja ali potrditev): ${deli.join(" ")}`;
}
