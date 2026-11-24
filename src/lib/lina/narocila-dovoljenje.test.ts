/**
 * Uvoz narocil iz mape prek skupnega modula dovoljenj (02f, »Velja tudi za vse podobne«): podobno = ista vrsta (narocila-uvoz) in
 * ista kanonicna mapa. Druga mapa ali podmapa in druga (nevarnejsa) vrsta dejanja v isti mapi se vprasata znova.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { enD, slD } from "./besedila-dovoljenja.ts";
import { DATOTEKA_DNEVNIKA, najdiDovoljenje } from "./dovoljenja-podobne.server.ts";
import { VRSTE_DOVOLJENJ, kljucObsega } from "./dovoljenja-podobne.ts";
import { DATOTEKA_NAROCIL, VRSTA_UVOZA, stanjeNarocil, uvoziNarocilaLastnik, uvoziNarocilaLina } from "./narocila.server.ts";

async function okolje() {
  const koren = await mkdtemp(path.join(tmpdir(), "lina-nar-dov-"));
  const vir = path.join(koren, "vir");
  const druga = path.join(koren, "druga");
  const dir = path.join(koren, "podatki");
  await mkdir(path.join(vir, "podmapa"), { recursive: true });
  await mkdir(druga, { recursive: true });
  await writeFile(path.join(vir, "izvoz.csv"), "Nalog;Stranka;Motiv\nDN-1;Klub Primer;Orel\n");
  await writeFile(path.join(vir, "podmapa", "izvoz.csv"), "Nalog;Stranka\nDN-2;Podmapa\n");
  await writeFile(path.join(druga, "izvoz.csv"), "Nalog;Stranka\nDN-3;Druga\n");
  const token = await setupOwner("geslo-test-1234", dir);
  return { koren, vir, druga, dir, token };
}

describe("vrsta dovoljenja narocila-uvoz", () => {
  it("je v zaprtem seznamu z obsegom mapa in ima ime v sl in en", () => {
    assert.ok((VRSTE_DOVOLJENJ as readonly string[]).includes(VRSTA_UVOZA));
    assert.equal(kljucObsega(VRSTA_UVOZA, { mapa: "/dom/narocila" }), "narocila-uvoz\n/dom/narocila");
    assert.equal(kljucObsega(VRSTA_UVOZA, { mapa: "/dom/narocila", agent: "claude" }), null);
    assert.ok(slD.vrsta_narocila_uvoz && enD.vrsta_narocila_uvoz);
  });
});

describe("uvoz narocil z dovoljenjem", { concurrency: 1 }, () => {
  it("brez seje lastnika ni uvoza", async () => {
    const { vir, dir } = await okolje();
    await assert.rejects(uvoziNarocilaLastnik(null, { mapa: vir, potrjeno: true }, dir));
    assert.ok(!existsSync(path.join(dir, DATOTEKA_NAROCIL)));
  });

  it("brez potrditve in brez dovoljenja: vprasa (kanonicna mapa), nic ne prebere", async () => {
    const { vir, dir, token } = await okolje();
    const r = await uvoziNarocilaLastnik(token, { mapa: vir }, dir);
    assert.deepEqual(r, { stanje: "potrebna-potrditev", mapa: vir });
    assert.ok(!existsSync(path.join(dir, DATOTEKA_NAROCIL)));
  });

  it("potrditev brez »velja za podobne«: uvozi, dovoljenja ne shrani, naslednjic znova vprasa", async () => {
    const { vir, dir, token } = await okolje();
    const r = await uvoziNarocilaLastnik(token, { mapa: vir, potrjeno: true, podobne: false }, dir);
    assert.equal(r.stanje, "uvozeno");
    assert.equal(r.stanje === "uvozeno" && r.izid.narocila, 1);
    assert.equal(await najdiDovoljenje(dir, VRSTA_UVOZA, { mapa: vir }, { zabelezi: false }), null);
    assert.equal((await uvoziNarocilaLastnik(token, { mapa: vir }, dir)).stanje, "potrebna-potrditev");
  });

  it("»velja za podobne«: ista mapa (tudi prek povezave) brez vprasanja; podmapa, druga mapa in druga vrsta se vprasajo", async () => {
    const { koren, vir, druga, dir, token } = await okolje();
    assert.equal((await uvoziNarocilaLastnik(token, { mapa: vir, potrjeno: true, podobne: true }, dir)).stanje, "uvozeno");
    assert.equal((await uvoziNarocilaLastnik(token, { mapa: vir }, dir)).stanje, "uvozeno");
    const povezava = path.join(koren, "povezava-na-vir");
    await symlink(vir, povezava);
    assert.equal((await uvoziNarocilaLastnik(token, { mapa: povezava }, dir)).stanje, "uvozeno");
    assert.equal((await uvoziNarocilaLastnik(token, { mapa: path.join(vir, "podmapa") }, dir)).stanje, "potrebna-potrditev");
    assert.equal((await uvoziNarocilaLastnik(token, { mapa: druga }, dir)).stanje, "potrebna-potrditev");
    // seznam se ni zamenjal z vprasanima mapama
    assert.ok(!(await readFile(path.join(dir, DATOTEKA_NAROCIL), "utf8")).includes("Druga"));
    // dovoljenje za branje narocil ni dovoljenje za nalogo agentu v isti mapi
    assert.equal(await najdiDovoljenje(dir, "naloga-agentu", { agent: "claude", mapa: vir }, { zabelezi: false }), null);
  });

  it("»podobne« samo strogo true (niz »true« ali 1 ne shrani dovoljenja)", async () => {
    const { vir, dir, token } = await okolje();
    await uvoziNarocilaLastnik(token, { mapa: vir, potrjeno: true, podobne: "true" }, dir);
    await uvoziNarocilaLastnik(token, { mapa: vir, potrjeno: 1 as unknown as boolean, podobne: true }, dir);
    assert.equal(await najdiDovoljenje(dir, VRSTA_UVOZA, { mapa: vir }, { zabelezi: false }), null);
  });

  it("Lina (ponovni uvoz shranjene mape) samo z dovoljenjem za podobne; uporaba gre v dnevnik dovoljenj", async () => {
    const { vir, dir, token } = await okolje();
    assert.deepEqual(await uvoziNarocilaLina(dir), { stanje: "ni-mape" });
    await uvoziNarocilaLastnik(token, { mapa: vir, potrjeno: true }, dir);
    assert.equal((await uvoziNarocilaLina(dir)).stanje, "potrebna-potrditev");
    await uvoziNarocilaLastnik(token, { mapa: vir, potrjeno: true, podobne: true }, dir);
    await writeFile(path.join(vir, "nov.txt"), "Nalog: DN-9\nStranka: Nova stranka\n");
    const r = await uvoziNarocilaLina(dir);
    assert.equal(r.stanje === "uvozeno" && r.izid.narocila, 2);
    assert.match(await readFile(path.join(dir, DATOTEKA_DNEVNIKA), "utf8"), /narocila-uvoz/);
  });

  it("stanje za Nastavitve: mapa, stevilo narocil, cas in ali velja za podobne", async () => {
    const { vir, dir, token } = await okolje();
    await assert.rejects(stanjeNarocil(null, dir));
    assert.deepEqual(await stanjeNarocil(token, dir), { mapa: null, posodobljeno: null, narocila: 0, podobne: false });
    await uvoziNarocilaLastnik(token, { mapa: vir, potrjeno: true, podobne: true }, dir);
    const s = await stanjeNarocil(token, dir);
    assert.equal(s.mapa, vir);
    assert.equal(s.narocila, 1);
    assert.equal(s.podobne, true);
    assert.ok(s.posodobljeno);
  });
});
