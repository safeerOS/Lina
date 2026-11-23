/**
 * Mapa zapiskov (G5): preverba poti, ki jo vpise uporabnik, in razresitev privzete mape.
 * Isti pristop kot izbrana mapa podatkov (storage.server.ts): obstojec ali ustvarljiv imenik, opozorila za oblak in
 * dovoljenja, realpath pred odlocitvijo. Poleg tega: nobenih sistemskih imenikov, ne neposredno ne prek simbolne povezave.
 */
import { mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { t } from "./besedila.ts";
import { lahkoPise, opozorilaMape } from "./storage.server.ts";
import type { MapaZapiskov } from "./zapiski.ts";

export const PRIVZETA_MAPA_ZAPISKOV = "zapiski";

export type { MapaZapiskov };

const POSIX_SISTEMSKE = ["/etc", "/usr", "/bin", "/sbin", "/boot", "/dev", "/proc", "/sys", "/lib", "/lib32", "/lib64", "/run"];
const POSIX_SAMO_TOCNO = ["/", "/home", "/root", "/tmp", "/mnt", "/media", "/var", "/opt"];
const WIN_SISTEMSKE = [/^[a-z]:\\windows(\\|$)/, /^[a-z]:\\program files( \(x86\))?(\\|$)/, /^[a-z]:\\programdata(\\|$)/];
const WIN_SAMO_TOCNO = [/^[a-z]:\\?$/, /^[a-z]:\\users\\?$/];

/** Ali pot (ze razresena) kaze v sistemski imenik. Platforma je parameter, da preizkus tece tudi na drugem sistemu. */
export function jeSistemskaMapa(pot: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === "win32") {
    const p = path.win32.resolve(pot).toLowerCase();
    if (p.startsWith("\\\\")) return true;
    return WIN_SISTEMSKE.some((re) => re.test(p)) || WIN_SAMO_TOCNO.some((re) => re.test(p));
  }
  const p = path.posix.resolve(pot);
  if (POSIX_SAMO_TOCNO.includes(p)) return true;
  return POSIX_SISTEMSKE.some((s) => p === s || p.startsWith(`${s}/`));
}

/** Privzeta mapa zapiskov: »zapiski« v podatkovni mapi Line. */
export function privzetaMapaZapiskov(root: string): string {
  return path.join(root, PRIVZETA_MAPA_ZAPISKOV);
}

/** Pot, ki je se ni: najblizji obstojeci prednik se razresi z realpath, manjkajoci deli ostanejo isti. */
async function razresiNeobstojec(cilj: string, paths: typeof path.posix): Promise<string> {
  const ostanek: string[] = [];
  let tekoca = cilj;
  for (;;) {
    try {
      return paths.join(await realpath(tekoca), ...ostanek.reverse());
    } catch {
      const stars = paths.dirname(tekoca);
      if (stars === tekoca) return cilj;
      ostanek.push(paths.basename(tekoca));
      tekoca = stars;
    }
  }
}

/**
 * Preveri mapo zapiskov. Prazen vnos pomeni privzeto mapo. Z `ustvari` se mapa tudi ustvari (dovoljenja 0700) in
 * preveri, da vanjo lahko pisemo; brez tega samo bere (za prikaz).
 */
export async function preveriMapoZapiskov(
  vnos: unknown,
  root: string,
  opts: { ustvari?: boolean; platform?: NodeJS.Platform } = {},
): Promise<MapaZapiskov> {
  const platform = opts.platform ?? process.platform;
  const paths = platform === "win32" ? path.win32 : path.posix;
  const surovo = typeof vnos === "string" ? vnos.trim() : "";
  const jePrivzeta = surovo === "";
  const izbrana = jePrivzeta ? privzetaMapaZapiskov(root) : surovo;
  const napaka = (razlog: string, mapa = izbrana): MapaZapiskov => ({ ok: false, mapa, jePrivzeta, razlog, opozorila: [] });

  if (typeof vnos !== "string" && vnos !== undefined && vnos !== null) return napaka(t("mapaNiPolna"), "");
  if (!jePrivzeta) {
    // »~« in relativne poti uporabnika zmedejo (nikoli ne vemo, kaj pomenijo): zahtevamo polno pot.
    if (surovo.includes("\0") || surovo.startsWith("~") || !paths.isAbsolute(surovo)) return napaka(t("mapaNiPolna"));
  }
  const cilj = paths.resolve(izbrana);
  if (!jePrivzeta && jeSistemskaMapa(cilj, platform)) return napaka(t("mapaSistemska"), cilj);

  // Cilj mora biti imenik; sistemski imenik ne sme biti dosezen niti prek simbolne povezave (realpath).
  let pravaPot = cilj;
  try {
    const info = await stat(cilj);
    if (!info.isDirectory()) return napaka(t("mapaNiMapa"), cilj);
    pravaPot = await realpath(cilj);
  } catch (error) {
    const koda = (error as NodeJS.ErrnoException).code;
    if (koda !== "ENOENT") return napaka(t("mapaNeUstvari"), cilj);
    // Mape se ni: pravi predniki ne smejo voditi v sistemski imenik, manjkajoci deli poti ostanejo isti.
    pravaPot = await razresiNeobstojec(cilj, paths);
  }
  if (!jePrivzeta && jeSistemskaMapa(pravaPot, platform)) return napaka(t("mapaSistemska"), cilj);

  if (opts.ustvari) {
    try {
      await mkdir(pravaPot, { recursive: true, mode: 0o700 });
      pravaPot = await realpath(pravaPot);
    } catch {
      return napaka(t("mapaNeUstvari"), cilj);
    }
    if (!(await lahkoPise(pravaPot))) return napaka(t("mapaNeUstvari"), cilj);
  }
  return { ok: true, mapa: pravaPot, jePrivzeta, razlog: "", opozorila: await opozorilaMape(pravaPot, platform) };
}
