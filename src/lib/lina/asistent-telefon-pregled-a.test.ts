/**
 * Pregled A (zdruzitev 0225), A-12: zasebnostno stikalo ocenaIzida je fail-closed (neberljiva nastavitev = izid Claude Code NE gre
 * k ponudniku modela) in shranjevanje nastavitev tece pod istim zaklepom kot seznam naprav.
 */
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { NASTAVITVE_ASISTENTA, dovoliOcenoIzida, odstraniNapravo, ponastaviAsistenta, shraniAsistenta } from "./asistent-telefon.server.ts";
import { idIzKljuca } from "./kanal-claude.ts";
import { pripraviKanal } from "./kanal-claude.server.ts";

after(async () => { await ponastaviAsistenta(); });

test("A-12: datoteke ni = vklopljeno; pokvarjena, ne-objekt, neveljavna vrednost ali neberljiva = IZKLOPLJENO", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-a12-"));
  const f = path.join(dir, NASTAVITVE_ASISTENTA);
  assert.equal(await dovoliOcenoIzida(dir), true);
  for (const vsebina of ["{", "[]", "null", "5", JSON.stringify({ ocenaIzida: "ne" }), JSON.stringify({ ocenaIzida: 0 })]) {
    await writeFile(f, vsebina);
    assert.equal(await dovoliOcenoIzida(dir), false, vsebina);
  }
  await writeFile(f, JSON.stringify({ vklop: false }));
  assert.equal(await dovoliOcenoIzida(dir), true, "veljavna datoteka brez polja = privzeto");
  await writeFile(f, JSON.stringify({ ocenaIzida: false }));
  assert.equal(await dovoliOcenoIzida(dir), false);
  if (process.getuid?.() !== 0) {
    await writeFile(f, JSON.stringify({ ocenaIzida: true }));
    await chmod(f, 0o000);
    assert.equal(await dovoliOcenoIzida(dir), false, "neberljiva datoteka");
    await chmod(f, 0o600);
  }
});

test("A-12: shraniAsistenta in odstraniNapravo hkrati: nobena sprememba se ne izgubi (isti zaklep)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-a12z-"));
  const token = await setupOwner("geslo-test-1234", dir);
  const kljuc = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const id = idIzKljuca(kljuc);
  await pripraviKanal([{ id, kljuc }], dir);
  await writeFile(path.join(dir, NASTAVITVE_ASISTENTA), JSON.stringify({ vklop: false, imena: { [id]: "Telefon" }, ocenaIzida: true }));
  await Promise.all([odstraniNapravo(token, id, dir), shraniAsistenta(token, { ocenaIzida: false }, dir)]);
  let n = JSON.parse(await readFile(path.join(dir, NASTAVITVE_ASISTENTA), "utf8")) as { imena: Record<string, string>; ocenaIzida: boolean; vrata: number };
  assert.equal(n.ocenaIzida, false, "izklop ocene izgubljen");
  assert.deepEqual(n.imena, {}, "odstranjena naprava je spet v imenih");
  // dve hkratni shranjevanji lastnika (dva zavihka): obe spremembi ostaneta
  await Promise.all([shraniAsistenta(token, { vrata: 9123 }, dir), shraniAsistenta(token, { ocenaIzida: true }, dir)]);
  n = JSON.parse(await readFile(path.join(dir, NASTAVITVE_ASISTENTA), "utf8"));
  assert.equal(n.vrata, 9123, "sprememba vrat izgubljena");
  assert.equal(n.ocenaIzida, true, "sprememba ocene izgubljena");
});
