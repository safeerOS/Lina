// Lina kot storitev systemd --user: SAMO po izbiri uporabnika (nic se ne vklopi samo). Obnovljeno 21. 11. 2026 po specifikaciji
// preizkusa src/lib/lina/store.server.test.ts (izvirna datoteka je bila izbrisana).
// Uporaba: node scripts/sluzba.mjs namesti | odstrani | stanje
// Enota je brez odvisnosti od drugih storitev (lastnik 14. 11. 2026: Lina deluje tudi brez Safeer OS).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sestaviEnoto } from "./zagon-lina.mjs";

const KOREN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IME_ENOTE = "lina.service";

function mapaEnot(env = process.env) {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  return path.join(xdg || path.join(env.HOME?.trim() || os.homedir(), ".config"), "systemd", "user");
}

function systemctl(...args) {
  const r = spawnSync("systemctl", ["--user", ...args], { encoding: "utf8" });
  return { koda: r.status ?? 1, izpis: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

export function namesti(env = process.env) {
  const mapa = mapaEnot(env);
  const datoteka = path.join(mapa, IME_ENOTE);
  mkdirSync(mapa, { recursive: true });
  writeFileSync(datoteka, sestaviEnoto({ node: process.execPath, koren: KOREN }), { mode: 0o644 });
  systemctl("daemon-reload");
  const vklop = systemctl("enable", "--now", IME_ENOTE);
  return vklop.koda === 0 ? `Lina je nameščena kot storitev: ${datoteka}` : `Enota je zapisana (${datoteka}), vklop ni uspel: ${vklop.izpis}`;
}

export function odstrani(env = process.env, ctl = systemctl) {
  const datoteka = path.join(mapaEnot(env), IME_ENOTE);
  const izklop = ctl("disable", "--now", IME_ENOTE);
  if (izklop.koda !== 0) {
    // Brez enote ali ze ustavljena storitev: odstranitev je idempotentna. Vse drugo (npr. upravitelj sej ni dosegljiv) pomeni,
    // da ne vemo, ali Lina tece: enote ne brisemo, da stanje() ostane resnicno.
    const aktivna = ctl("is-active", IME_ENOTE).izpis;
    if (aktivna !== "inactive" && aktivna !== "failed") {
      throw new Error(`Storitve Line ni bilo mogoče ustaviti (${izklop.izpis || "brez izpisa"}); enota je ohranjena: ${datoteka}`);
    }
  }
  if (existsSync(datoteka)) unlinkSync(datoteka);
  ctl("daemon-reload");
  return "Storitev Line je odstranjena (podatki Line ostanejo).";
}

export function stanje(env = process.env) {
  const datoteka = path.join(mapaEnot(env), IME_ENOTE);
  if (!existsSync(datoteka)) return "Lina ni nameščena kot storitev.";
  const aktivna = systemctl("is-active", IME_ENOTE).izpis;
  return `Enota: ${datoteka}\nStanje: ${aktivna || "neznano"}\n${readFileSync(datoteka, "utf8").split("\n").find((v) => v.startsWith("ExecStart=")) ?? ""}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ukaz = process.argv[2];
  const dejanja = { namesti, odstrani, stanje };
  if (!dejanja[ukaz]) {
    console.error("Uporaba: node scripts/sluzba.mjs namesti | odstrani | stanje");
    process.exit(2);
  }
  try {
    console.log(dejanja[ukaz]());
  } catch (napaka) {
    console.error(napaka.message);
    process.exit(1);
  }
}
