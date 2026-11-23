import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { imaPosixDovoljenja, jeWindows, kljucPlatforme, koncnicaIzvedljive } from "./platforma.server.ts";

// Eno jedro za Windows in Linux (lastnik, 21. 11. 2026). Platformne vejitve (process.platform, "win32", "darwin", "linux")
// so ZAKLENJENE na obstojece stanje: nove vejitve gredo SAMO prek platforma.server.ts. Ko datoteko preselis na pomocnike,
// zmanjsaj stevilo v tabeli (preizkus zahteva natancno ujemanje, da napredek ostane zapisan).
const ZAKLENJENO: Record<string, number> = {
  "lib/lina/asistent-streznik.server.ts": 1,
  "lib/lina/asistent-telefon.server.ts": 1,
  "lib/lina/clan-kroga.server.ts": 3,
  "lib/lina/gcloud-namestitev.server.ts": 3,
  "lib/lina/glas-telefon.server.ts": 1,
  "lib/lina/glas.server.ts": 1,
  "lib/lina/kanal-claude.server.ts": 7,
  "lib/lina/kanal-claude.ts": 4,
  "lib/lina/keys.server.ts": 1,
  "lib/lina/mdns-oglas.server.ts": 1,
  "lib/lina/neposredno.server.ts": 9,
  "lib/lina/openline-zagon.server.ts": 1,
  "lib/lina/prijava-google.server.ts": 7,
  "lib/lina/soniox-kljuc.server.ts": 1,
  "lib/lina/storage.server.ts": 4,
  "lib/lina/store.server.ts": 3,
  "lib/lina/tunel.server.ts": 13,
  "lib/lina/zapiski-mapa.server.ts": 4,
  "lib/lina/zapiski.server.ts": 4,
  "lib/lina/zasebno-omrezje.server.ts": 4,
};

const VZOREC = /process\.platform|["'](?:win32|darwin|linux)["']/;
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function stevilo(koren: string): Record<string, number> {
  const izid: Record<string, number> = {};
  const obhodi = (mapa: string) => {
    for (const ime of readdirSync(mapa)) {
      const pot = path.join(mapa, ime);
      if (statSync(pot).isDirectory()) {
        if (ime !== "node_modules") obhodi(pot);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(ime) || /\.test\.(ts|tsx)$/.test(ime) || ime === "platforma.server.ts") continue;
      const n = readFileSync(pot, "utf8").split("\n").filter((v) => VZOREC.test(v)).length;
      if (n > 0) izid[path.relative(koren, pot).split(path.sep).join("/")] = n;
    }
  };
  obhodi(koren);
  return izid;
}

test("nove platformne vejitve ne nastajajo zunaj platforma.server.ts", () => {
  const dejansko = stevilo(SRC);
  const nove = Object.keys(dejansko).filter((f) => !(f in ZAKLENJENO));
  assert.deepEqual(nove, [], `platformna vejitev v novi datoteki (uporabi platforma.server.ts): ${nove.join(", ")}`);
  const vec = Object.entries(dejansko).filter(([f, n]) => f in ZAKLENJENO && n > ZAKLENJENO[f]!).map(([f]) => f);
  assert.deepEqual(vec, [], `vec platformnih vejitev kot doslej (uporabi platforma.server.ts): ${vec.join(", ")}`);
});

test("zmanjsanje vejitev je zapisano v tabeli (zaklep napredka)", () => {
  const dejansko = stevilo(SRC);
  const manj = Object.entries(ZAKLENJENO).filter(([f, n]) => (dejansko[f] ?? 0) !== n).map(([f, n]) => `${f}: tabela ${n}, zdaj ${dejansko[f] ?? 0}`);
  assert.deepEqual(manj, [], `posodobi ZAKLENJENO navzdol: ${manj.join("; ")}`);
});

test("pomocniki platforme: Linux, Windows in macOS", () => {
  assert.equal(jeWindows("win32"), true);
  assert.equal(jeWindows("linux"), false);
  assert.equal(jeWindows("darwin"), false);
  assert.equal(imaPosixDovoljenja("win32"), false);
  assert.equal(imaPosixDovoljenja("linux"), true);
  assert.equal(koncnicaIzvedljive("win32"), ".exe");
  assert.equal(koncnicaIzvedljive("linux"), "");
  assert.equal(kljucPlatforme("win32", "x64"), "win32-x64");
  assert.equal(kljucPlatforme("linux", "arm64"), "linux-arm64");
});

test("brez argumenta pomocniki berejo dejansko platformo procesa", () => {
  assert.equal(jeWindows(), process.platform === "win32");
  assert.equal(kljucPlatforme(), `${process.platform}-${process.arch}`);
});
