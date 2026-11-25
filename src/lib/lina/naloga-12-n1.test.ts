/**
 * Naloga 12, #1 (slepi pregled 11): glavni kljuc (.kljuc) se uporabi samo, ce je prava datoteka (ne simbolna povezava), last procesa
 * in brez pravic skupine/drugih; sicer Lina zavrne z jasnim sporocilom in kljuca NE prepise (izguba vseh sifriranih kljucev API).
 * Lastnika (uid) brez root ni mogoce preizkusiti; preverjeno z branjem kode. Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { kljucCelovitosti } from "./keys.server.ts";

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

  it("kljuc z dovoljenji za skupino ali druge: zavrnjeno, ne prepisan in ne popravljen tiho", async () => {
    const dir = await mapa();
    const pot = path.join(dir, ".kljuc");
    await writeFile(pot, Buffer.alloc(32, 9));
    await chmod(pot, 0o644);
    await assert.rejects(kljucCelovitosti("x", dir), /\.kljuc/);
    assert.deepEqual(await readFile(pot), Buffer.alloc(32, 9));
    assert.equal((await stat(pot)).mode & 0o777, 0o644);
  });
});
