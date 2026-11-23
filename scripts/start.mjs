// Zagon Line (npm start, systemd --user enota, samostojni zagon): ena instanca, lastna mapa podatkov, prosta vrata.
// Obnovljeno 21. 11. 2026 po specifikaciji preizkusa src/lib/lina/store.server.test.ts (izvirna datoteka je bila izbrisana).
// Lastnik 14. 11. 2026: Lina deluje tudi brez Safeer OS; ce ga ima, tece loceno ob njem in se procesi ne motijo.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import { constants as signali } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pripraviZagon } from "./zagon-lina.mjs";

const KOREN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Strezniska gradnja (Nitro); LINA_STREZNIK jo zamenja (preizkusi uporabljajo lazni streznik). */
const STREZNIK = process.env.LINA_STREZNIK?.trim() || path.join(KOREN, ".output", "server", "index.mjs");

const zagon = await pripraviZagon(process.env);

if (zagon.napaka) {
  console.error(zagon.napaka);
  process.exit(1);
}
if (!zagon.ostani) {
  console.log(zagon.sporocilo);
  process.exit(0);
}
if (!existsSync(STREZNIK)) {
  zagon.sprosti();
  console.error(`Strezniske datoteke ni (${STREZNIK}). Najprej zgradite Lino (npm run build).`);
  process.exit(1);
}

console.log(zagon.safeerOs ? "Safeer OS: zaznan, Lina tece loceno ob njem." : "Safeer OS: ni, Lina tece sama.");

const otrok = spawn(process.execPath, [STREZNIK], {
  cwd: KOREN,
  env: { ...process.env, PORT: String(zagon.vrata), NITRO_PORT: String(zagon.vrata), HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1", LINA_DATA: zagon.mapa },
  stdio: "inherit",
});
// Zaklep zapomni tudi streznik: ob ubitem ovoju (SIGKILL) streznik tece naprej in naslednji zagon ne sme prevzeti zaklepa.
if (otrok.pid) zagon.zabeleziOtroka(otrok.pid);

let koncano = false;
let zahtevanaUstavitev = false;
function konec(koda) {
  if (koncano) return;
  koncano = true;
  zagon.sprosti();
  process.exit(koda);
}

/** Sporocilo o pripravljenosti: sele ko streznik res sprejema povezave (do 120 s, nato odnehamo brez napake). */
function sprejema(vrata) {
  return new Promise((resolve) => {
    const vticnica = net.connect({ host: "127.0.0.1", port: vrata });
    vticnica.once("connect", () => {
      vticnica.destroy();
      resolve(true);
    });
    vticnica.once("error", () => resolve(false));
  });
}
(async () => {
  const rok = Date.now() + 120_000;
  while (!koncano && otrok.exitCode === null && Date.now() < rok) {
    if (await sprejema(zagon.vrata)) {
      console.log(`Lina poslusa na http://127.0.0.1:${zagon.vrata}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
})();

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => {
    zahtevanaUstavitev = true;
    if (otrok.exitCode === null) otrok.kill("SIGTERM");
    // Ce otrok ne konca v 5 s, ga ubijemo; zaklep se vseeno sprosti.
    setTimeout(() => {
      if (otrok.exitCode === null) otrok.kill("SIGKILL");
      konec(0);
    }, 5000).unref();
  });
}

otrok.on("exit", (koda, signal) => {
  // Ustavitev (zahtevana tukaj ali SIGTERM/SIGINT/SIGHUP od sistema) je pricakovan konec: koda 0. Nepricakovan signal otroka
  // (SIGKILL ob pomanjkanju pomnilnika, SIGABRT, SIGSEGV) je napaka: koda 128+n, da systemd (Restart=on-failure) Lino znova zazene.
  const pricakovan = zahtevanaUstavitev || ["SIGTERM", "SIGINT", "SIGHUP"].includes(signal);
  konec(signal ? (pricakovan ? 0 : 128 + (signali.signals[signal] ?? 1)) : (koda ?? 0));
});
otrok.on("error", (napaka) => {
  console.error(`Strezniskega procesa ni bilo mogoce zagnati: ${napaka.message}`);
  konec(1);
});
