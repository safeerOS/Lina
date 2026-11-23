/** Nastavitve obvestil: preverba popravka, shramba (samo lastnik), pokvarjena datoteka ne podre obvestil. Podatki izmisljeni. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { PRIVZETE_NASTAVITVE_OBVESTIL as P, nastavitveIzShrambe, zdruziNastavitveObvestil } from "./obvestila-odlocitev.ts";
import { DATOTEKA_OBVESTIL, preberiNastavitveObvestil, shraniNastavitveObvestil } from "./obvestila.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-obvestila-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const nova = () => mkdtemp(path.join(KOREN, "d-"));

describe("zdruziNastavitveObvestil", () => {
  it("sprejme veljavna polja in zavrne neznana ali neveljavna", () => {
    const z = zdruziNastavitveObvestil(P, { neMoti: true, ureMiru: { od: 22, do: 7 }, poVrsti: { klic: "pomembno" }, vip: [" 041 222 333 ", "", "041 222 333"] });
    assert.ok(z);
    assert.equal(z.neMoti, true);
    assert.deepEqual(z.ureMiru, { od: 22, do: 7 });
    assert.equal(z.poVrsti.klic, "pomembno");
    assert.equal(z.poVrsti.novica, "pomembno", "ostale vrste ostanejo");
    assert.deepEqual(z.vip, ["041 222 333"]);
    for (const slab of [null, [], { x: 1 }, { neMoti: "da" }, { ureMiru: { od: 24, do: 1 } }, { poVrsti: { klic: "glasno" } }, { poVrsti: { pes: "vse" } }, { globalno: "privzeto" }, { vip: "a" }, { zakasnitevTelefonaMs: -1 }]) {
      assert.equal(zdruziNastavitveObvestil(P, slab), null, JSON.stringify(slab));
    }
    assert.deepEqual(zdruziNastavitveObvestil(P, {}), P, "prazen popravek ne spremeni nicesar");
  });
  it("shramba: pokvarjena ali stara vsebina se zdruzi s privzetimi brez napake", () => {
    assert.deepEqual(nastavitveIzShrambe(null), P);
    const n = nastavitveIzShrambe({ neMoti: true, globalno: "neznano", poVrsti: { klic: "nic" }, smeti: 1 });
    assert.equal(n.neMoti, true);
    assert.equal(n.globalno, "vse");
    assert.equal(n.poVrsti.klic, "nic");
  });
});

describe("obvestila.server", () => {
  it("samo lastnik; privzeto, shrani, preberi; neveljaven popravek ne spremeni datoteke", async () => {
    const dir = await nova();
    const token = await setupOwner("geslo-test-1234", dir);
    await assert.rejects(() => preberiNastavitveObvestil(null, dir));
    await assert.rejects(() => shraniNastavitveObvestil({ neMoti: true }, null, dir));
    assert.deepEqual(await preberiNastavitveObvestil(token, dir), P);
    await shraniNastavitveObvestil({ neMoti: true }, token, dir);
    assert.equal((await preberiNastavitveObvestil(token, dir)).neMoti, true);
    await assert.rejects(() => shraniNastavitveObvestil({ neMoti: "ja" }, token, dir));
    assert.equal((await preberiNastavitveObvestil(token, dir)).neMoti, true);
  });
  it("pokvarjena datoteka: veljajo privzete", async () => {
    const dir = await nova();
    const token = await setupOwner("geslo-test-1234", dir);
    writeFileSync(path.join(dir, DATOTEKA_OBVESTIL), "{ne json");
    assert.deepEqual(await preberiNastavitveObvestil(token, dir), P);
  });
  it("hkratna shranjevanja se ne prepisejo (izgubljena sprememba, meritev 22. 11. 2026)", async () => {
    const dir = await nova();
    const token = await setupOwner("geslo-test-1234", dir);
    await Promise.all([
      shraniNastavitveObvestil({ neMoti: true }, token, dir),
      shraniNastavitveObvestil({ ureMiru: { od: 22, do: 7 } }, token, dir),
      shraniNastavitveObvestil({ vip: ["Ana"] }, token, dir),
      shraniNastavitveObvestil({ poVrsti: { klic: "pomembno" } }, token, dir),
    ]);
    const n = await preberiNastavitveObvestil(token, dir);
    assert.equal(n.neMoti, true);
    assert.deepEqual(n.ureMiru, { od: 22, do: 7 });
    assert.deepEqual(n.vip, ["Ana"]);
    assert.equal(n.poVrsti.klic, "pomembno");
  });
});
