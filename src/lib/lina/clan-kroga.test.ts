// N5b: clanstvo v ozjem krogu Safeer Linka (krog.json) kot EDINI vir izjeme od primerjave id-ja. Vsak preizkus mora brez popravka
// (jeClanKroga vedno true / vedno false) pasti; fail-closed za ponarejeno, staro, preklicano, tuje in nezanesljivo.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { jeClanKroga, NAJVEC_KROG_BAJTOV } from "./clan-kroga.server.ts";
import { idIzKljuca } from "./kanal-claude.ts";

function kljuc(): { kljuc: string; id: string } {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const k = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  return { kljuc: k, id: idIzKljuca(k) };
}
const clan = (k: string, dodano = 1000) => ({ kljuc: k, ime: "Telefon", platforma: "android", dodano, dodal: "n-0000000000000000" });

async function krog(vsebina: unknown, nacin = 0o600) {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-krog-"));
  const pot = path.join(dir, "krog.json");
  await writeFile(pot, typeof vsebina === "string" ? vsebina : JSON.stringify(vsebina), { mode: nacin });
  await chmod(pot, nacin);
  return { dir, pot };
}

test("clan kroga: kljuc je v krogu in ni umaknjen -> true; naprave ni v krogu -> false", async () => {
  const a = kljuc(), b = kljuc();
  const { dir, pot } = await krog({ v: 1, clani: { [a.id]: clan(a.kljuc) }, umiki: {} });
  try {
    assert.equal(await jeClanKroga(a.kljuc, a.id, pot), true);
    assert.equal(await jeClanKroga(b.kljuc, b.id, pot), false, "neznan telefon: ostane primerjava");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("clan kroga: PONAREJENO - tuj kljuc z istim id-jem/imenom clana, id brez kljuca ali id iz sporocila ne dokazujejo clanstva", async () => {
  const clanA = kljuc(), napadalec = kljuc();
  // krog hrani kljuc clana pod id-jem clana; napadalec prinese svoj kljuc (svoj id) z IMENOM clana
  const { dir, pot } = await krog({ v: 1, clani: { [clanA.id]: clan(clanA.kljuc) } });
  try {
    assert.equal(await jeClanKroga(napadalec.kljuc, napadalec.id, pot), false, "tuj kljuc, tuj id");
    assert.equal(await jeClanKroga(napadalec.kljuc, clanA.id, pot), false, "id clana, kljuc napadalca (id ni izpeljan iz kljuca)");
    assert.equal(await jeClanKroga(clanA.kljuc, napadalec.id, pot), false, "kljuc clana, tuj id");
    // vpis pod id napadalca s kljucem DRUGEGA clana: kljuc se ne ujema z vpisom
    const { dir: d2, pot: p2 } = await krog({ v: 1, clani: { [napadalec.id]: clan(clanA.kljuc) } });
    try { assert.equal(await jeClanKroga(napadalec.kljuc, napadalec.id, p2), false); } finally { await rm(d2, { recursive: true, force: true }); }
    for (const slab of [null, undefined, 5, "", "x", clanA.kljuc + "A"]) assert.equal(await jeClanKroga(slab, clanA.id, pot), false, String(slab));
    for (const slab of [null, 5, "", "n-123", clanA.id + "-os", clanA.id.toUpperCase()]) assert.equal(await jeClanKroga(clanA.kljuc, slab, pot), false, String(slab));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("clan kroga: STARI/PREKLICANI clan - umik novejsi od vpisa -> false; vpis po umiku z ostalim umikom -> false (strozje od link_krog.py)", async () => {
  const a = kljuc();
  const preklican = await krog({ v: 1, clani: { [a.id]: clan(a.kljuc, 1000) }, umiki: { [a.id]: { umaknjeno: 2000, umaknil: "n-1111111111111111" } } });
  const znova = await krog({ v: 1, clani: { [a.id]: clan(a.kljuc, 3000) }, umiki: { [a.id]: { umaknjeno: 2000, umaknil: "n-1111111111111111" } } });
  const brezCasa = await krog({ v: 1, clani: { [a.id]: { kljuc: a.kljuc } }, umiki: { [a.id]: {} } });
  try {
    assert.equal(await jeClanKroga(a.kljuc, a.id, preklican.pot), false, "umaknjen");
    // Strozje od Pythona (clan-kroga.server.ts, umikDovoljuje): vrnitev po umiku Lina ne sprejme nikoli, ker legitimen krog.json
    // takega zapisa nima (Python po vrnitvi umik izbrise). Preizkus je pricakoval Pythonovo pravilo, koda pa je kasneje postala strozja.
    assert.equal(await jeClanKroga(a.kljuc, a.id, znova.pot), false, "vpis novejsi od umika, umik ostal: dvom = false");
    assert.equal(await jeClanKroga(a.kljuc, a.id, brezCasa.pot), false, "umik brez casov = dvom = false");
  } finally { for (const x of [preklican, znova, brezCasa]) await rm(x.dir, { recursive: true, force: true }); }
});

test("clan kroga: DRUG UPORABNIK/nezanesljiva datoteka (pisanje skupine/drugih, simbolna povezava, prevelika, pokvarjena, v2, brez datoteke) -> false", async () => {
  const a = kljuc();
  const vsebina = { v: 1, clani: { [a.id]: clan(a.kljuc) } };
  const odprta = await krog(vsebina, 0o666);
  const skupina = await krog(vsebina, 0o620);
  const berljiva = await krog(vsebina, 0o644);                       // branje drugih je dovoljeno, pisanje ne
  const velika = await krog(JSON.stringify(vsebina) + " ".repeat(NAJVEC_KROG_BAJTOV));
  const pokvarjena = await krog("{ne json");
  const v2 = await krog({ v: 2, clani: { [a.id]: clan(a.kljuc) } });
  const brezClanov = await krog({ v: 1 });
  const povezava = await krog(vsebina);
  const cilj = path.join(povezava.dir, "povezava.json");
  await symlink(povezava.pot, cilj);
  try {
    assert.equal(await jeClanKroga(a.kljuc, a.id, odprta.pot), false, "0666");
    assert.equal(await jeClanKroga(a.kljuc, a.id, skupina.pot), false, "0620");
    assert.equal(await jeClanKroga(a.kljuc, a.id, berljiva.pot), true, "0644 je varno (pisati sme le lastnik)");
    assert.equal(await jeClanKroga(a.kljuc, a.id, velika.pot), false, "prevelika");
    assert.equal(await jeClanKroga(a.kljuc, a.id, pokvarjena.pot), false);
    assert.equal(await jeClanKroga(a.kljuc, a.id, v2.pot), false);
    assert.equal(await jeClanKroga(a.kljuc, a.id, brezClanov.pot), false);
    assert.equal(await jeClanKroga(a.kljuc, a.id, cilj), false, "simbolna povezava");
    assert.equal(await jeClanKroga(a.kljuc, a.id, path.join(povezava.dir, "ni-je.json")), false, "brez datoteke");
    assert.equal(await jeClanKroga(a.kljuc, a.id, path.join(tmpdir(), "lk-ni-mape", "krog.json")), false);
  } finally { for (const x of [odprta, skupina, berljiva, velika, pokvarjena, v2, brezClanov, povezava]) await rm(x.dir, { recursive: true, force: true }); }
});
