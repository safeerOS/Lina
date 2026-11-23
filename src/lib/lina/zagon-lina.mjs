// Zagon Line brez odvisnosti od Safeer OS (lastnik 14. 11. 2026: »Lina naj deluje tudi, ce uporabnik nima namescenega
// Safeer OS; ce ga ima, je popolnoma zdruzljiva in se procesi med seboj ne motijo«).
// Cisti Node brez paketov in brez core/ ali Safeer poti: lastna mapa podatkov, ena instanca z zaklepom datoteke, prosta vrata.
// Safeer OS se zaznava SAMO prek vodila D-Bus (ime aplikacije), nikoli po imenu procesa; Lina mu nic ne poslje in nic ne bere.
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { randomBytes } from "node:crypto";

/** GApplication ID Safeer OS (core/link_predvajanje.py APP_ID v Safeerju). Samo ime na vodilu, nic drugega. */
export const SAFEER_OS_IME = "io.github.memelandfaner.SafeerOS";
export const ZAKLEP_DATOTEKA = "lina.lock";
export const PRIVZETA_VRATA = 8080;

/** Enako kot defaultDataDir v store.server.ts (preizkus ju primerja). */
export function privzetaMapa(env = process.env, platform = process.platform) {
  if (platform === "win32") {
    const lokalno = env.LOCALAPPDATA?.trim();
    return path.win32.join(lokalno || path.win32.join(env.USERPROFILE?.trim() || "C:\\Users\\Default", "AppData", "Local"), "Lina");
  }
  const xdg = env.XDG_DATA_HOME?.trim();
  return path.posix.join(xdg || path.posix.join(env.HOME?.trim() || "", ".local", "share"), "lina");
}

/** Enako kot resolveDataDir: LINA_DATA, sicer izbrana mapa iz nastavitve.json, sicer privzeta. */
export function mapaPodatkov(env = process.env, platform = process.platform) {
  const izEnv = env.LINA_DATA?.trim();
  if (izEnv) return path.resolve(izEnv);
  try {
    const izbrana = JSON.parse(readFileSync(path.join(privzetaMapa(env, platform), "nastavitve.json"), "utf8"))?.mapa;
    if (typeof izbrana === "string" && izbrana.trim()) return path.resolve(izbrana.trim());
  } catch {
    // brez nastavitev: privzeta mapa
  }
  return path.resolve(privzetaMapa(env, platform));
}

/** Podatki Line ne smejo v mapo Safeerja (config/share »safeer*«): dva programa ne smeta pisati v isto mapo. */
export function mapaJeSafeerjeva(mapa) {
  return mapa.split(/[\\/]+/).some((del) => del.toLowerCase().startsWith("safeer"));
}

/** Ali Safeer OS tece: ime aplikacije na sejnem vodilu D-Bus. Brez gdbus ali vodila je odgovor »ne« (Lina tece sama). */
export function zaznajSafeerOs(env = process.env, zazeni = spawnSync) {
  try {
    const okolje = { PATH: env.PATH ?? "/usr/bin:/bin" };
    for (const k of ["DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR", "HOME"]) if (env[k]) okolje[k] = env[k];
    const r = zazeni(
      "gdbus",
      ["call", "--session", "--timeout", "2", "--dest", "org.freedesktop.DBus", "--object-path", "/org/freedesktop/DBus", "--method", "org.freedesktop.DBus.NameHasOwner", SAFEER_OS_IME],
      { env: okolje, encoding: "utf8", timeout: 4000 },
    );
    return r.status === 0 && /\(true,\)/.test(String(r.stdout));
  } catch {
    return false;
  }
}

/** Cas zacetka procesa (Linux, /proc): proti ponovni uporabi PID. Drugje null. */
function zacetekProcesa(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
  } catch {
    return null;
  }
}

function jeZiv(zapis) {
  if (!zapis || !Number.isInteger(zapis.pid) || zapis.pid <= 0) return false;
  try {
    process.kill(zapis.pid, 0);
  } catch (napaka) {
    if (napaka.code !== "EPERM") return false;
  }
  const zacetek = zacetekProcesa(zapis.pid);
  return !(zapis.zacetek && zacetek && zapis.zacetek !== zacetek);
}

function preberiZaklep(pot) {
  let surovo = "";
  try {
    surovo = readFileSync(pot, "utf8");
  } catch {
    return { surovo: null, zapis: null };
  }
  try {
    return { surovo, zapis: JSON.parse(surovo) };
  } catch {
    return { surovo, zapis: null };
  }
}

/**
 * ENA instanca: zaklep je datoteka lina.lock v mapi podatkov (ustvarjena z O_EXCL, vsebuje PID in cas zacetka procesa).
 * Zivi lastnik -> {ok:false, pid, vrata}. Zastarel zaklep (proces ne tece ali je PID ponovno uporabljen) se prevzame.
 */
export function zakleni(mapa, moj = { pid: process.pid }) {
  mkdirSync(mapa, { recursive: true, mode: 0o700 });
  const pot = path.join(mapa, ZAKLEP_DATOTEKA);
  const zeton = randomBytes(8).toString("hex");
  const zapis = { pid: moj.pid, zacetek: zacetekProcesa(moj.pid), zeton, vrata: null, safeerOs: false };
  for (let poskus = 0; poskus < 4; poskus += 1) {
    try {
      const fd = openSync(pot, "wx", 0o600);
      writeSync(fd, JSON.stringify(zapis));
      closeSync(fd);
      return {
        ok: true,
        pot,
        posodobi(dodatno) {
          Object.assign(zapis, dodatno);
          const zacasna = `${pot}.${zeton}`;
          writeFileSync(zacasna, JSON.stringify(zapis), { mode: 0o600 });
          renameSync(zacasna, pot);
        },
        sprosti() {
          // Samo svoj zaklep (zeton): zaklepa drugega zagona ne brisemo.
          if (preberiZaklep(pot).zapis?.zeton === zeton) {
            try {
              unlinkSync(pot);
            } catch {
              // ze odstranjen
            }
          }
        },
      };
    } catch (napaka) {
      if (napaka.code !== "EEXIST") throw napaka;
    }
    const { surovo, zapis: obstojec } = preberiZaklep(pot);
    if (surovo === null) continue;
    // Zapis, ki ga drug zagon ravnokar pise (neberljiv), je zivo stanje; star neberljiv zapis je ostanek.
    let mladi = false;
    if (!obstojec) {
      try {
        mladi = Date.now() - statSync(pot).mtimeMs < 5000;
      } catch {
        mladi = false;
      }
    }
    if (obstojec ? jeZiv(obstojec) : mladi) return { ok: false, pid: obstojec?.pid ?? null, vrata: obstojec?.vrata ?? null };
    // Zastarel zaklep: odstranimo samo, ce je se isti zapis (manj tekme med dvema zagonoma).
    if (preberiZaklep(pot).surovo === surovo) {
      try {
        unlinkSync(pot);
      } catch {
        // drug zagon ga je ze odstranil
      }
    }
  }
  throw new Error("Zaklepa instance Line ni bilo mogoce vzeti.");
}

function prostaVrata(vrata, gostitelj) {
  return new Promise((resolve) => {
    const streznik = net.createServer();
    streznik.once("error", () => resolve(null));
    streznik.listen(vrata, gostitelj, () => {
      const dodeljena = streznik.address().port;
      streznik.close(() => resolve(dodeljena));
    });
  });
}

/** Prednostna vrata, ce so prosta (ce jih ima Safeer OS ali drug program, nas ne ovirajo), sicer prosta vrata od OS. */
export async function izberiVrata(prednostna = PRIVZETA_VRATA, gostitelj = "127.0.0.1") {
  const prva = Number.isInteger(prednostna) && prednostna > 0 && prednostna < 65536 ? await prostaVrata(prednostna, gostitelj) : null;
  if (prva) return prva;
  const druga = await prostaVrata(0, gostitelj);
  if (!druga) throw new Error("Ni prostih vrat na 127.0.0.1.");
  return druga;
}

/** systemd --user enota (izbira uporabnika, ne obveza): brez odvisnosti od Safeer storitev. */
export function sestaviEnoto({ node, koren }) {
  const navedi = (pot) => `"${pot.replace(/(["\\])/g, "\\$1")}"`;
  return [
    "[Unit]",
    "Description=Lina, lokalna telefonska tajnica",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${navedi(koren)}`,
    `ExecStart=${navedi(node)} ${navedi(path.join(koren, "scripts", "start.mjs"))}`,
    "Restart=on-failure",
    "RestartSec=5",
    "NoNewPrivileges=yes",
    "PrivateTmp=yes",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

/**
 * Priprava zagona: mapa, zaklep, vrata. Vrne {ostani:false, sporocilo} ce Lina ze tece, sicer {ostani:true, vrata, safeerOs, sprosti}.
 */
export async function pripraviZagon(env = process.env) {
  const mapa = mapaPodatkov(env);
  if (mapaJeSafeerjeva(mapa)) {
    return { napaka: `Mapa podatkov Line (${mapa}) je v mapi Safeerja. Izberite lastno mapo (LINA_DATA).` };
  }
  const zaklep = zakleni(mapa);
  if (!zaklep.ok) {
    return { ostani: false, sporocilo: `Lina ze tece (PID ${zaklep.pid}${zaklep.vrata ? `, vrata ${zaklep.vrata}` : ""}). Druge instance ne zazenem.` };
  }
  try {
    const vrata = await izberiVrata(Number(env.LINA_VRATA) || PRIVZETA_VRATA);
    const safeerOs = zaznajSafeerOs(env);
    zaklep.posodobi({ vrata, safeerOs });
    return { ostani: true, mapa, vrata, safeerOs, sprosti: () => zaklep.sprosti() };
  } catch (napaka) {
    zaklep.sprosti();
    throw napaka;
  }
}
