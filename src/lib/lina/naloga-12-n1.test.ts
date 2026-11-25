/**
 * Naloga 12, #1 (slepi pregled 11): glavni kljuc (.kljuc) se uporabi samo, ce je prava datoteka (ne simbolna povezava), last procesa
 * in brez pravic skupine/drugih; sicer Lina zavrne z jasnim sporocilom in kljuca NE prepise (izguba vseh sifriranih kljucev API).
 * Naloga 14 N1: ohlapne pravice na lastnem kljucu se popravijo (fchmod); ce FS pravic ne podpira, Lina deluje z opozorilom v vmesniku.
 * Lastnika (uid) brez root ni mogoce preizkusiti; preverjeno z branjem kode. Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createHmac } from "node:crypto";
import { setupOwner } from "./auth.server.ts";
import { en, sl } from "./besedila.ts";
import { kljucBrezPravic, kljucCelovitosti, praviceKljuca } from "./keys.server.ts";
import { readStorage } from "./storage.server.ts";

const mapa = () => mkdtemp(path.join(tmpdir(), "lina-n12-n1-"));
const posix = process.platform !== "win32";

describe("#1: preverba .kljuc pred uporabo", { skip: !posix }, () => {
  it("kontrola: kljuc 0600 se uporabi in pravice ostanejo", async () => {
    const dir = await mapa();
    await writeFile(path.join(dir, ".kljuc"), Buffer.alloc(32, 3), { mode: 0o600 });
    assert.equal((await kljucCelovitosti("x", dir)).length, 32);
    assert.equal((await stat(path.join(dir, ".kljuc"))).mode & 0o777, 0o600);
  });

  it("simbolna povezava na veljaven kljuc: zavrnjeno", async () => {
    const dir = await mapa();
    const tuj = path.join(await mapa(), "tuj");
    await writeFile(tuj, Buffer.alloc(32, 5), { mode: 0o600 });
    await symlink(tuj, path.join(dir, ".kljuc"));
    await assert.rejects(kljucCelovitosti("x", dir), /\.kljuc/);
  });

  it("simbolna povezava na datoteko napacne dolzine: zavrnjeno, cilj ni prepisan", async () => {
    const dir = await mapa();
    const tuj = path.join(await mapa(), "tuj");
    await writeFile(tuj, "vsebina", { mode: 0o600 });
    await symlink(tuj, path.join(dir, ".kljuc"));
    await assert.rejects(kljucCelovitosti("x", dir), /\.kljuc/);
    assert.equal(await readFile(tuj, "utf8"), "vsebina");
  });

  // naloga 14 N1: ohlapne pravice na kljucu, ki je last procesa, se popravijo na odprtem rocaju (fchmod) - prej trda napaka
  it("kljuc 0644 last procesa: popravljen na 0600 in uporabljen, vsebina ista", async () => {
    const dir = await mapa();
    const pot = path.join(dir, ".kljuc");
    await writeFile(pot, Buffer.alloc(32, 9));
    await chmod(pot, 0o644);
    const pricakovan = createHmac("sha256", Buffer.alloc(32, 9)).update("lina-celovitost:x").digest();
    assert.deepEqual(await kljucCelovitosti("x", dir), pricakovan);
    assert.deepEqual(await readFile(pot), Buffer.alloc(32, 9));
    assert.equal((await stat(pot)).mode & 0o777, 0o600);
    assert.equal(kljucBrezPravic(dir), false);
  });

  it("kontrola: kljuc 0400 ostane 0400 (popravi se samo, ce ima skupina ali drugi pravice)", async () => {
    const dir = await mapa();
    const pot = path.join(dir, ".kljuc");
    await writeFile(pot, Buffer.alloc(32, 2), { mode: 0o600 });
    await chmod(pot, 0o400);
    assert.equal((await kljucCelovitosti("x", dir)).length, 32);
    assert.equal((await stat(pot)).mode & 0o777, 0o400);
  });
});

// Datotecni sistem brez POSIX pravic (NTFS, exFAT, vfat, drvfs) brez root ni mogoce priklopiti: fchmod se nadomesti
describe("N1 (naloga 14): datotecni sistem pravic ne podpira", { skip: !posix }, () => {
  const z = praviceKljuca.popravi;
  for (const [ime, popravi] of [
    ["fchmod nima ucinka", async () => undefined],
    ["fchmod vrze EPERM", async () => { throw Object.assign(new Error("EPERM"), { code: "EPERM" }); }],
  ] as const) {
    it(`${ime}: Lina deluje naprej (kljuc uporabljen), opozorilo v pogledu mape v sl in en`, async () => {
      const dir = await mapa();
      const pot = path.join(dir, ".kljuc");
      await writeFile(pot, Buffer.alloc(32, 7));
      await chmod(pot, 0o644);
      praviceKljuca.popravi = popravi;
      try {
        assert.equal((await kljucCelovitosti("x", dir)).length, 32);
      } finally {
        praviceKljuca.popravi = z;
      }
      assert.deepEqual(await readFile(pot), Buffer.alloc(32, 7));
      assert.equal(kljucBrezPravic(dir), true);
      const token = await setupOwner("geslo-test-1234", dir);
      // streznik govori samo slovensko (jezik pozna brskalnik): zastavica, besedilo v jeziku vmesnika izbere lina-desk.tsx
      assert.equal((await readStorage(token, dir)).kljucBrezPravic, true);
      assert.ok(en.kljucBrezPravic.length > 20 && en.kljucBrezPravic !== sl.kljucBrezPravic);
      const namizje = await readFile(path.join(import.meta.dirname, "../../components/lina-desk.tsx"), "utf8");
      assert.match(namizje, /place\.kljucBrezPravic \?[^\n]*t\("kljucBrezPravic"\)/);
    });
  }

  it("kontrola: brez tezav s pravicami pogled mape nima opozorila kljuca", async () => {
    const dir = await mapa();
    await writeFile(path.join(dir, ".kljuc"), Buffer.alloc(32, 1), { mode: 0o600 });
    await kljucCelovitosti("x", dir);
    const token = await setupOwner("geslo-test-1234", dir);
    assert.equal((await readStorage(token, dir)).kljucBrezPravic, undefined);
  });
});
