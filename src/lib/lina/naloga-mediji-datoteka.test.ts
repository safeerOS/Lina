/** Preizkusi branja medijev za vmesnik (mediji-datoteka.server.ts). Podatki so izmisljeni, brez omrezja. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { preberiMedij } from "./mediji-datoteka.server.ts";
import { DATOTEKA_SLIK, MAPA_SLIK } from "./slike-generator.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-mediji-dat-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
async function nova() {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  return { dir, token: await setupOwner("geslo-test-1234", dir) };
}
const zapis = (id: string, datoteka: string) => ({ id, serija: "s00000000001", cas: "2026-11-22T10:00:00.000Z", opis: "x", poziv: "x", prevedeno: true, model: "imagen-4.0-fast-generate-001", datoteka, bajtov: 4 });

describe("preberiMedij", () => {
  it("vrne data URL za sliko in video iz knjiznice", async () => {
    const { dir, token } = await nova();
    await mkdir(path.join(dir, MAPA_SLIK), { recursive: true });
    await writeFile(path.join(dir, MAPA_SLIK, "aaaaaaaaaaaa.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(path.join(dir, MAPA_SLIK, "bbbbbbbbbbbb.mp4"), Buffer.from([0, 0, 0, 24]));
    await writeFile(path.join(dir, DATOTEKA_SLIK), JSON.stringify({ slike: [zapis("aaaaaaaaaaaa", "aaaaaaaaaaaa.png"), zapis("bbbbbbbbbbbb", "bbbbbbbbbbbb.mp4")] }));
    const s = await preberiMedij("aaaaaaaaaaaa", token, dir);
    assert.equal(s.mime, "image/png");
    assert.equal(s.podatki, `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")}`);
    assert.equal((await preberiMedij("bbbbbbbbbbbb", token, dir)).mime, "video/mp4");
  });
  it("zavrne neveljaven ID, ID izven knjiznice, pot v datoteki in povezavo", async () => {
    const { dir, token } = await nova();
    await mkdir(path.join(dir, MAPA_SLIK), { recursive: true });
    await writeFile(path.join(dir, "skrivno.txt"), "tajno");
    await symlink(path.join(dir, "skrivno.txt"), path.join(dir, MAPA_SLIK, "cccccccccccc.png"));
    await writeFile(path.join(dir, DATOTEKA_SLIK), JSON.stringify({ slike: [zapis("cccccccccccc", "cccccccccccc.png"), zapis("dddddddddddd", "../skrivno.txt")] }));
    for (const id of [undefined, 5, "../x", "AAAAAAAAAAAA", "eeeeeeeeeeee", "dddddddddddd", "cccccccccccc"]) {
      await assert.rejects(() => preberiMedij(id, token, dir), String(id));
    }
  });
  it("brez zetona lastnika zavrne", async () => {
    const { dir } = await nova();
    await assert.rejects(() => preberiMedij("aaaaaaaaaaaa", null, dir));
  });
});
