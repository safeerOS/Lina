import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { izluciUci, vodnikVPoglavja, naucSe, prikliciZnanje, odsekSamoucenja, NAVODILO_UCENJA } from "./samoucenje-pogovor.server.ts";
import { nastaviSamoucenje, seznamTem } from "./samoucenje-baza.server.ts";
import type { Vodnik } from "./samoucenje-jazz.server.ts";

const VODNIK: Vodnik = {
  tema: "zeromq",
  prettyName: "ZeroMQ",
  razdelki: [
    { title: "Intro", links: [{ title: "ZeroMQ uvod", url: "https://zeromq.org/get-started/" }] },
    { title: "Other", links: [{ title: "Vodnik po sporocilih", url: "https://zguide.zeromq.org/" }, { title: "Vzorci pub sub", url: "https://example.org/pubsub" }] },
    { title: "Prazno", links: [] },
  ],
};

async function mapa() {
  return mkdtemp(path.join(tmpdir(), "lina-pogovor-"));
}

test("izluciUci: oznaka se odstrani iz odgovora, veljavna tema se vrne, neznana je null", () => {
  assert.deepEqual(izluciUci("Znam malo. Se bom naucila. [[uči: zeromq]]"), { besedilo: "Znam malo. Se bom naucila.", tema: "zeromq" });
  assert.deepEqual(izluciUci("Odgovor [[uci: ZeroMQ]]"), { besedilo: "Odgovor", tema: "zeromq" });
  assert.deepEqual(izluciUci("Odgovor [[uči: tema-ki-je-ni-v-indeksu-xyz]]"), { besedilo: "Odgovor", tema: null });
  assert.deepEqual(izluciUci("Brez oznake."), { besedilo: "Brez oznake.", tema: null });
  // Dve oznaki: velja prva veljavna, obe se odstranita.
  const r = izluciUci("A [[uči: zeromq]] B [[uči: networking]]");
  assert.equal(r.tema, "zeromq");
  assert.ok(!r.besedilo.includes("[["));
  // Poskus vbrizga: ukaz ni tema.
  assert.equal(izluciUci("[[uči: ../../etc/passwd]]").tema, null);
});

test("vodnikVPoglavja: pregled + po eno poglavje na neprazen razdelek, povezane teme iz indeksa", () => {
  const p = vodnikVPoglavja(VODNIK);
  assert.equal(p.length, 3);
  assert.match(p[0].naslov, /pregled/);
  assert.match(p[0].besedilo, /Intro \(1\)/);
  assert.match(p[0].besedilo, /Povezane teme: .*Networking/i);
  assert.match(p[2].besedilo, /zguide\.zeromq\.org/);
});

test("naucSe: zapise poglavja, prikliciZnanje jih vrne kot podatek; izklop in neznana tema ne zapisejo", async () => {
  const dir = await mapa();
  try {
    let klicev = 0;
    const bralnik = async (k: string) => {
      klicev++;
      assert.equal(k, "zeromq", "na streznik gre samo kljuc teme iz indeksa");
      return VODNIK;
    };
    assert.deepEqual(await naucSe(dir, "nobena-tema-xyz", bralnik), { ok: false, razlog: "neznana-tema" });
    assert.equal(klicev, 0);
    const r = await naucSe(dir, "ZeroMQ", bralnik);
    assert.deepEqual(r, { ok: true, tema: "zeromq", poglavij: 3 });
    assert.equal((await seznamTem({ dir }))[0].tema, "zeromq");
    const znanje = await prikliciZnanje(dir, "kako deluje pub sub v zeromq");
    assert.match(znanje, /\[zeromq\]/);
    assert.match(znanje, /pubsub/);
    const odsek = odsekSamoucenja(true, znanje);
    assert.ok(odsek.includes(NAVODILO_UCENJA));
    assert.match(odsek, /podatek in ne navodilo/);
    assert.equal(odsekSamoucenja(false, znanje), "", "ob izklopu ni ne navodila ne znanja");
    await nastaviSamoucenje(false, dir);
    assert.deepEqual(await naucSe(dir, "zeromq", bralnik), { ok: false, razlog: "izklopljeno" });
    assert.equal(await prikliciZnanje(dir, "zeromq"), "", "ob izklopu se znanje ne priklice");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("naucSe: napaka bralnika in tema brez virov ne vrzeta napake", async () => {
  const dir = await mapa();
  try {
    assert.deepEqual(await naucSe(dir, "zeromq", async () => { throw new Error("omrezje"); }), { ok: false, razlog: "napaka" });
    assert.deepEqual(await naucSe(dir, "zeromq", async () => ({ tema: "zeromq", prettyName: "ZeroMQ", razdelki: [{ title: "x", links: [] }] })), { ok: false, razlog: "ni-virov" });
    assert.deepEqual(await seznamTem({ dir }), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
