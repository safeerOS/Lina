/**
 * Samodejni zagon Line ob prijavi (naloga 21, 25. 11. 2026): po ponovnem zagonu racunalnika Lina ni tekla in telefon je visel na
 * »Sprasujem racunalnik ...«. Lina je tajnica in mora teci vedno, zato je zagon ob prijavi PRIVZETO VKLOPLJEN; uporabnik ga izklopi
 * v Nastavitvah (stikalo »Zaženi ob prijavi«).
 * - Uporabniski vnos XDG (~/.config/autostart/lina.desktop), ki ga Lina zapise ob zagonu streznika: deluje v vseh namizjih (Cinnamon,
 *   GNOME, KDE, Xfce), brez sudo in brez spremembe paketa; izklop ga odstrani. /etc/xdg/autostart ni potreben.
 * - Vnos pozene lupino (izvedljiva datoteka, ki je zagnala ta streznik: ELECTRON_RUN_AS_NODE, npr. /opt/Lina/lina-lupina) z
 *   zastavico --ozadje (lupina ne odpre okna, ostane v pladnju). Brez lupine (razvojni streznik) vnosa ni: ni kaj zagnati.
 * - Tuj vnos z istim imenom (brez nase oznake) se nikoli ne prepise in ne izbrise.
 * - Samo Linux (platforma.server.ts); Windows: stikalo pove, da ni na voljo (NEPREVERJENO na pravem Windows).
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { requireOwner } from "./auth.server.ts";
import { imaXdgSamodejniZagon, platformaZdaj, type Platforma } from "./platforma.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

export const DATOTEKA_NASTAVITVE = "samodejni-zagon.json";
export const IME_VNOSA = "lina.desktop";
export const OZNAKA_VNOSA = "X-Lina-Samodejni-Zagon=1";
export const ZASTAVICA_OZADJA = "--ozadje";

export type OkoljeZagona = { env?: NodeJS.ProcessEnv; izvedljiva?: string; platforma?: Platforma };
export type StanjeSamodejnegaZagona = {
  vklop: boolean;
  /** Ali ta namestitev vnos sploh lahko zapise (Linux in streznik, ki ga je zagnala lupina). */
  naVoljo: boolean;
  /** Ali vnos ta trenutek obstaja (nas). */
  vnos: boolean;
  /** Na poti je tuj vnos z istim imenom: Lina ga ne spreminja. */
  tuj: boolean;
};

/** ~/.config/autostart (ali $XDG_CONFIG_HOME/autostart). */
export function mapaSamodejnegaZagona(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  return path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(env.HOME?.trim() || os.homedir(), ".config"), "autostart");
}

/**
 * Izvedljiva datoteka lupine: samo ce je streznik zagnala nameščena lupina (Electron kot Node); sicer null.
 * Nezapakirana lupina (razvoj) tece kot gol »electron«: tak vnos bi ob prijavi odprl prazen Electron, zato ga ni.
 */
export function izvedljivaLupine(env: NodeJS.ProcessEnv = process.env, izvedljiva: string = process.execPath): string | null {
  // A13: nova vrstica v poti bi v datoteko autostart vnesla nov kljuc
  if (env.ELECTRON_RUN_AS_NODE !== "1" || !path.isAbsolute(izvedljiva) || /[\r\n]/.test(izvedljiva)) return null;
  if (/^electron(\.exe)?$/i.test(path.basename(izvedljiva))) return null;
  return izvedljiva;
}

/**
 * Vrednost za Exec po specifikaciji Desktop Entry: pot v narekovajih, " ` $ \ ubezani (pravilo narekovajev), nato splosno pravilo za niz
 * (\ -> \\, zato je dobesedna posevnica \\\\) in % -> %% (koda polja). Pregled 0213 A13: prej GLib vrednosti s temi znaki ni razclenil
 * (»value that cannot be interpreted«, preverjeno z GLib.KeyFile 25. 11. 2026).
 */
function argumentExec(pot: string): string {
  return `"${pot.replace(/[\\"`$]/g, (z) => `\\${z}`)}"`.replace(/\\/g, "\\\\").replace(/%/g, "%%");
}

export function vsebinaVnosa(izvedljiva: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Lina",
    "Comment=Lina - AI telefonska tajnica (zagon ob prijavi, v ozadju)",
    `Exec=${argumentExec(izvedljiva)} ${ZASTAVICA_OZADJA}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    OZNAKA_VNOSA,
    "",
  ].join("\n");
}

async function beriVnos(pot: string): Promise<string | null> {
  try {
    return await readFile(pot, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** vklop: privzeto true; zapisan: Lina je vnos ze kdaj zapisala (izginil vnos = uporabnik ga je odstranil). */
type Nastavitev = { vklop: boolean; zapisan: boolean };
async function beriNastavitev(root: string): Promise<Nastavitev> {
  const n = await readJsonFile<{ vklop?: unknown; zapisan?: unknown }>(root, DATOTEKA_NASTAVITVE);
  return { vklop: n?.vklop !== false, zapisan: n?.zapisan === true };
}

/** Uporabnik je nas vnos izklopil v orodju namizja (Zagonski programi): Hidden=true ali X-GNOME-Autostart-enabled=false. */
export function jeIzklopljenVnos(besedilo: string): boolean {
  return /^Hidden\s*=\s*true\s*$/im.test(besedilo) || /^X-GNOME-Autostart-enabled\s*=\s*false\s*$/im.test(besedilo);
}

function okolje(o: OkoljeZagona) {
  const env = o.env ?? process.env;
  const platforma = o.platforma ?? platformaZdaj();
  const izvedljiva = imaXdgSamodejniZagon(platforma) ? izvedljivaLupine(env, o.izvedljiva ?? process.execPath) : null;
  return { pot: path.join(mapaSamodejnegaZagona(env), IME_VNOSA), izvedljiva };
}

/**
 * Vnos uskladi z nastavitvijo: vklop = nas vnos z ZDAJSNJO potjo lupine; izklop = nasega ni. Tujega ne spreminja.
 * Ob zagonu (samodejno) velja tudi izbira v orodju namizja: izklopljen ali odstranjen nas vnos = izklop, Lina ga ne obnovi.
 */
async function uskladi(vklop: boolean, o: OkoljeZagona, root: string, samodejno: boolean, zapisan: boolean): Promise<StanjeSamodejnegaZagona> {
  const { pot, izvedljiva } = okolje(o);
  const obstojec = await beriVnos(pot);
  const tuj = obstojec !== null && !obstojec.includes(OZNAKA_VNOSA);
  if (tuj) return { vklop, naVoljo: izvedljiva !== null, vnos: false, tuj };
  if (samodejno && vklop && ((obstojec !== null && jeIzklopljenVnos(obstojec)) || (obstojec === null && zapisan))) {
    await writeJson(root, DATOTEKA_NASTAVITVE, { vklop: false, zapisan });
    return { vklop: false, naVoljo: izvedljiva !== null, vnos: false, tuj: false };
  }
  if (vklop && izvedljiva) {
    const vsebina = vsebinaVnosa(izvedljiva);
    if (obstojec !== vsebina) {
      await mkdir(path.dirname(pot), { recursive: true, mode: 0o700 });
      const zacasna = `${pot}.${process.pid}.tmp`;
      await writeFile(zacasna, vsebina, { encoding: "utf8", mode: 0o644 });
      await rename(zacasna, pot);
    }
    if (!zapisan) await writeJson(root, DATOTEKA_NASTAVITVE, { vklop, zapisan: true });
    return { vklop, naVoljo: true, vnos: true, tuj: false };
  }
  if (!vklop && obstojec !== null) await unlink(pot).catch(() => undefined);
  return { vklop, naVoljo: izvedljiva !== null, vnos: vklop && obstojec !== null, tuj: false };
}

/** Ob zagonu streznika (zagon.server.ts): privzeto vklopljen zagon ob prijavi zapise vnos, ce ga se ni. */
export async function uskladiSamodejniZagon(dir?: string, o: OkoljeZagona = {}): Promise<StanjeSamodejnegaZagona> {
  const root = resolveDataDir(dir);
  const n = await beriNastavitev(root);
  return uskladi(n.vklop, o, root, true, n.zapisan);
}

export async function stanjeSamodejnegaZagona(token: string | null, dir?: string, o: OkoljeZagona = {}): Promise<StanjeSamodejnegaZagona> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const { vklop } = await beriNastavitev(root);
  const { pot, izvedljiva } = okolje(o);
  const obstojec = await beriVnos(pot);
  const tuj = obstojec !== null && !obstojec.includes(OZNAKA_VNOSA);
  return { vklop, naVoljo: izvedljiva !== null, vnos: obstojec !== null && !tuj && !jeIzklopljenVnos(obstojec), tuj };
}

export async function nastaviSamodejniZagon(vklop: unknown, token: string | null, dir?: string, o: OkoljeZagona = {}): Promise<StanjeSamodejnegaZagona> {
  if (typeof vklop !== "boolean") throw new Error("Neveljavna nastavitev.");
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  // Izrecna izbira v Nastavitvah prepise izklop iz orodja namizja (vklop zapise svez vnos).
  await writeJson(root, DATOTEKA_NASTAVITVE, { vklop, zapisan: false });
  return uskladi(vklop, o, root, false, false);
}
