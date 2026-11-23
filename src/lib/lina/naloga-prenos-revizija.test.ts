/**
 * Preizkus prenosa podatkovne mape (naloga #45 + #37): ponudniki.json (sifrirani kljuci vec ponudnikov in lastni streznik)
 * in revizija.jsonl se morata preseliti z mapo; dovoljenja v novi mapi 600, veriga v cilju ostane veljavna.
 * Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { DATOTEKA_REVIZIJE, zapisiRevizijo } from "./revizija.server.ts";
import { preveriVerigo, type Vnos } from "./revizija.ts";
import { moveDataDir, PRENOS_DATOTEK } from "./storage.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-prenos-revizija-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));

const sha = (pot: string) => createHash("sha256").update(readFileSync(pot)).digest("hex");
const nacin = (pot: string) => statSync(pot).mode & 0o777;

async function pripravi(): Promise<{ from: string; target: string; configDir: string }> {
  const koren = mkdtempSync(path.join(KOREN, "p-"));
  const from = path.join(koren, "stara");
  const target = path.join(koren, "nova");
  const configDir = path.join(koren, "nastavitve");
  mkdirSync(from);
  mkdirSync(configDir);
  writeFileSync(path.join(from, "line.json"), '{"odprto":true}\n');
  writeFileSync(path.join(from, "ponudniki.json"), '{"v":1,"sifrirano":"abc123"}\n');
  for (let i = 1; i <= 3; i++) {
    const izid = await zapisiRevizijo(from, { vrsta: "preizkus", opis: `vnos ${i}`, podatki: { i } }, new Date(Date.UTC(2026, 10, 21, 9, 0, i)));
    assert.equal(izid.ok, true);
  }
  for (const ime of ["ponudniki.json", DATOTEKA_REVIZIJE, "line.json"]) chmodSync(path.join(from, ime), 0o644);
  return { from, target, configDir };
}

describe("prenos podatkovne mape: ponudniki.json in revizija.jsonl", () => {
  it("seznam za prenos vsebuje obe datoteki", () => {
    assert.equal((PRENOS_DATOTEK as readonly string[]).includes("ponudniki.json"), true);
    assert.equal((PRENOS_DATOTEK as readonly string[]).includes("revizija.jsonl"), true);
  });

  it("obe datoteki se prenesesta z enakim SHA-256, v cilju z dovoljenji 600", async () => {
    const { from, target, configDir } = await pripravi();
    const izid = await moveDataDir(target, { from, configDir, platform: "linux" });
    assert.equal(izid.ok, true, izid.razlog);
    for (const ime of ["ponudniki.json", DATOTEKA_REVIZIJE]) {
      assert.equal(sha(path.join(target, ime)), sha(path.join(from, ime)), `${ime} je enak`);
      assert.equal(nacin(path.join(target, ime)), 0o600, `${ime} ima dovoljenja 600`);
    }
    assert.equal(nacin(path.join(from, "ponudniki.json")), 0o644, "izvirnik se ne spremeni");
  });

  it("veriga v novi mapi je veljavna in ima vse vnose", async () => {
    const { from, target, configDir } = await pripravi();
    const izid = await moveDataDir(target, { from, configDir, platform: "linux" });
    assert.equal(izid.ok, true, izid.razlog);
    const vnosi = readFileSync(path.join(target, DATOTEKA_REVIZIJE), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((v) => JSON.parse(v) as Vnos);
    assert.equal(vnosi.length, 3);
    assert.equal(preveriVerigo(vnosi).ok, true);
  });

  it("brez teh datotek prenos se vedno uspe (preskoci manjkajoce)", async () => {
    const koren = mkdtempSync(path.join(KOREN, "q-"));
    const from = path.join(koren, "stara");
    const configDir = path.join(koren, "nastavitve");
    mkdirSync(from);
    mkdirSync(configDir);
    writeFileSync(path.join(from, "line.json"), "{}\n");
    const izid = await moveDataDir(path.join(koren, "nova"), { from, configDir, platform: "linux" });
    assert.equal(izid.ok, true, izid.razlog);
  });
});
