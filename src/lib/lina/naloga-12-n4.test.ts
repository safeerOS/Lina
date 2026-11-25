/**
 * Naloga 12, #4 (slepi pregled 11): podkljuc celovitosti se izracuna enkrat na mapo in namen in ostane v pomnilniku (seznam nalog ga
 * sicer bere ob vsakem stanju: branje .kljuc + chmod). Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { chmod, mkdtemp, stat, writeFile } from "node:fs/promises";
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

  it("zavrnjen kljuc se ne shrani: po popravku pravic deluje", async () => {
    const dir = await mapa();
    const pot = path.join(dir, ".kljuc");
    await writeFile(pot, Buffer.alloc(32, 1), { mode: 0o644 });
    await chmod(pot, 0o644);
    await assert.rejects(kljucCelovitosti("orkestrator", dir));
    await chmod(pot, 0o600);
    assert.equal((await kljucCelovitosti("orkestrator", dir)).length, 32);
  });
});
