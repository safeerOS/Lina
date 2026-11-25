/**
 * Naloga 12, #4 (slepi pregled 11): podkljuc celovitosti se izracuna enkrat na mapo in namen in ostane v pomnilniku (seznam nalog ga
 * sicer bere ob vsakem stanju: branje .kljuc + chmod). Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { chmod, mkdtemp, rename, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { kljucCelovitosti } from "./keys.server.ts";

const mapa = () => mkdtemp(path.join(tmpdir(), "lina-n12-n4-"));

describe("#4: kljuc celovitosti v pomnilniku", { skip: process.platform === "win32" }, () => {
  it("drugo branje ne bere .kljuc znova (zamenjana vsebina na disku ne spremeni podkljuca)", async () => {
    const dir = await mapa();
    await writeFile(path.join(dir, ".kljuc"), Buffer.alloc(32, 1), { mode: 0o600 });
    const prvi = await kljucCelovitosti("orkestrator", dir);
    await writeFile(path.join(dir, ".kljuc"), Buffer.alloc(32, 2), { mode: 0o600 });
    assert.deepEqual(await kljucCelovitosti("orkestrator", dir), prvi);
  });

  it("drugo branje ne kliče chmod (pravice, ki jih je nastavil lastnik, ostanejo)", async () => {
    const dir = await mapa();
    const pot = path.join(dir, ".kljuc");
    await writeFile(pot, Buffer.alloc(32, 1), { mode: 0o600 });
    await kljucCelovitosti("orkestrator", dir);
    await chmod(pot, 0o400);
    await kljucCelovitosti("orkestrator", dir);
    assert.equal((await stat(pot)).mode & 0o777, 0o400);
  });

  it("kontrola: drug namen da drug podkljuc", async () => {
    const dir = await mapa();
    await writeFile(path.join(dir, ".kljuc"), Buffer.alloc(32, 1), { mode: 0o600 });
    assert.notDeepEqual(await kljucCelovitosti("a", dir), await kljucCelovitosti("b", dir));
  });

  // naloga 14 N1: 0644 se zdaj popravi sam; zavrnjen kljuc je simbolna povezava, popravek = prava datoteka namesto nje
  it("zavrnjen kljuc se ne shrani: po popravku (simbolna povezava -> datoteka) deluje", async () => {
    const dir = await mapa();
    const pot = path.join(dir, ".kljuc");
    const prava = path.join(await mapa(), "kljuc");
    await writeFile(prava, Buffer.alloc(32, 1), { mode: 0o600 });
    await symlink(prava, pot);
    await assert.rejects(kljucCelovitosti("orkestrator", dir));
    await rename(prava, pot);
    assert.equal((await kljucCelovitosti("orkestrator", dir)).length, 32);
  });
});
