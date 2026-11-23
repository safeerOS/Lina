// #17 OpenLine v racunalniski aplikaciji: vezava poti klicev v asistent-telefon.server.ts. Pot klicev se zazene SAMA, ko tece telefon za asistentko
// (vklop, zagon programa, zacniSeznanitev), in se ustavi z njim; napaka postane opozorilo, ne ustavi telefona. Lazna vezava, pravi streznik asistentke na 127.0.0.1.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setupOwner } from "./auth.server.ts";
import {
  ponastaviAsistenta, registrirajVezoKlicev, shraniAsistenta, stanjeAsistenta, uskladiAsistenta, zacniSeznanitev, zacniSeznanitevSKodo, type VezaKlicev,
} from "./asistent-telefon.server.ts";

async function prostaVrata(): Promise<number> {
  return await new Promise<number>((ok, ne) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); });
    s.once("error", ne);
  });
}
const pocakaj = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

type Okolje = { dir: string; token: string; vrata: number; dnevnik: string[] };
async function pripravi(): Promise<Okolje> {
  const dir = await mkdtemp(path.join(tmpdir(), "veza-klicev-"));
  const token = await setupOwner("geslo-test-1234", dir, { address: "127.0.0.1" });
  return { dir, token, vrata: await prostaVrata(), dnevnik: [] };
}
async function pospravi(o: Okolje): Promise<void> {
  registrirajVezoKlicev(null);
  await ponastaviAsistenta();
  await rm(o.dir, { recursive: true, force: true });
}
const vklopi = (o: Okolje, vklop: boolean) => shraniAsistenta(o.token, { vklop, naslov: "127.0.0.1", vrata: o.vrata }, o.dir);

function lazna(o: Okolje, zakasnitevMs = 0, napaka?: Error): VezaKlicev {
  return {
    zagotovi: async (root, naslov) => {
      o.dnevnik.push(`zagotovi-zacetek ${naslov}`);
      if (zakasnitevMs > 0) await pocakaj(zakasnitevMs);
      if (napaka) throw napaka;
      o.dnevnik.push("zagotovi-konec");
      assert.equal(root, o.dir);
    },
    ustavi: async () => { o.dnevnik.push("ustavi"); },
  };
}

test("brez vezave (preizkusi, razvoj): vklop telefona dela, nic se ne zazene, stanje nima opozorila", async () => {
  const o = await pripravi();
  try {
    registrirajVezoKlicev(null);
    const s = await vklopi(o, true);
    assert.equal(s.tece, true);
    assert.equal(s.opozoriloKlicev, "");
    assert.equal(s.klicevSePripravlja, false);
    assert.deepEqual(o.dnevnik, []);
  } finally { await pospravi(o); }
});

test("vklop telefona zazene pot klicev ENKRAT za naslov asistentke, izklop jo ustavi", async () => {
  const o = await pripravi();
  try {
    registrirajVezoKlicev(lazna(o));
    const s = await vklopi(o, true);
    assert.equal(s.tece, true);
    await pocakaj(50);
    assert.deepEqual(o.dnevnik, ["zagotovi-zacetek 127.0.0.1", "zagotovi-konec"]);
    assert.equal((await stanjeAsistenta(o.token, o.dir)).opozoriloKlicev, "");
    await vklopi(o, false);
    assert.deepEqual(o.dnevnik, ["zagotovi-zacetek 127.0.0.1", "zagotovi-konec", "ustavi"]);
  } finally { await pospravi(o); }
});

test("zagon programa (uskladiAsistenta) ob ze vklopljenem telefonu zagotovi pot klicev; ponovni uskladiAsistenta ne podvoji tekoce priprave", async () => {
  const o = await pripravi();
  try {
    await vklopi(o, true);     // brez vezave: samo streznik
    registrirajVezoKlicev(lazna(o, 200));
    await Promise.all([uskladiAsistenta(o.dir), uskladiAsistenta(o.dir)]);
    assert.equal((await stanjeAsistenta(o.token, o.dir)).klicevSePripravlja, true, "priprava tece");
    await pocakaj(350);
    assert.equal(o.dnevnik.filter((v) => v.startsWith("zagotovi-zacetek")).length, 1, "ena priprava za dva hkratna klica");
    assert.equal((await stanjeAsistenta(o.token, o.dir)).klicevSePripravlja, false);
  } finally { await pospravi(o); }
});

test("napaka vezave ne ustavi telefona; postane opozorilo brez skrivnosti; naslednji zacniSeznanitev poskusi znova", async () => {
  const o = await pripravi();
  try {
    registrirajVezoKlicev(lazna(o, 0, new Error("OpenLine ni v paketu")));
    const s = await vklopi(o, true);
    assert.equal(s.tece, true);
    await pocakaj(50);
    const st = await stanjeAsistenta(o.token, o.dir);
    assert.equal(st.tece, true);
    assert.equal(st.opozoriloKlicev, "Pot klicev ni pripravljena: OpenLine ni v paketu");
    const poskusov = () => o.dnevnik.filter((v) => v.startsWith("zagotovi-zacetek")).length;
    assert.equal(poskusov(), 1);
    const povabilo = await zacniSeznanitev(o.token, o.dir);
    assert.ok(povabilo.vsebina.startsWith("httpgateway://pair?"), "QR se vseeno izda");
    assert.equal(poskusov(), 2, "zacniSeznanitev je znova poskusil zagotoviti pot klicev");
  } finally { await pospravi(o); }
});

test("sporocilo napake se skrajsa in ne nosi tujega besedila preko meje", async () => {
  const o = await pripravi();
  try {
    registrirajVezoKlicev(lazna(o, 0, new Error("x".repeat(500))));
    await vklopi(o, true);
    await pocakaj(50);
    const opozorilo = (await stanjeAsistenta(o.token, o.dir)).opozoriloKlicev;
    assert.ok(opozorilo.startsWith("Pot klicev ni pripravljena: "));
    assert.ok(opozorilo.length <= "Pot klicev ni pripravljena: ".length + 120);
  } finally { await pospravi(o); }
});

test("zacniSeznanitev in zacniSeznanitevSKodo pocakata na tekoco pripravo poti klicev (uporabnik dobi QR, ko je pot pripravljena)", async () => {
  const o = await pripravi();
  try {
    await vklopi(o, true);     // brez vezave
    registrirajVezoKlicev(lazna(o, 250));
    await uskladiAsistenta(o.dir);       // zacne pripravo v ozadju
    const povabilo = await zacniSeznanitev(o.token, o.dir);
    assert.ok(o.dnevnik.includes("zagotovi-konec"), "QR se izda sele, ko je priprava koncana");
    assert.ok(povabilo.vsebina.length > 0);
    const zacetkov = o.dnevnik.filter((v) => v.startsWith("zagotovi-zacetek")).length;
    // nova priprava za drugo pot (pripravljeno ni ostalo kot tekoca obljuba): ponovno poklicano, ker vezava sama odloca o idempotenci
    const s2 = await zacniSeznanitevSKodo(o.token, o.dir);
    assert.ok(s2.koda.length > 0);
    assert.equal(o.dnevnik.filter((v) => v.startsWith("zagotovi-zacetek")).length, zacetkov + 1);
  } finally { await pospravi(o); }
});

test("izklop med tekoco pripravo: ustavitev pocaka, da se priprava konca (proces ne ostane brez lastnika)", async () => {
  const o = await pripravi();
  try {
    registrirajVezoKlicev(lazna(o, 250));
    await vklopi(o, true);
    await vklopi(o, false);
    assert.deepEqual(o.dnevnik, ["zagotovi-zacetek 127.0.0.1", "zagotovi-konec", "ustavi"], "ustavi je SELE po koncu priprave");
  } finally { await pospravi(o); }
});

test("neuspela ustavitev vezave ne zavrne izklopa", async () => {
  const o = await pripravi();
  try {
    registrirajVezoKlicev({ zagotovi: async () => undefined, ustavi: async () => { throw new Error("ustavitev"); } });
    await vklopi(o, true);
    const s = await vklopi(o, false);
    assert.equal(s.tece, false);
  } finally { await pospravi(o); }
});

test("zacniSeznanitevSKodo pocaka na pripravo poti klicev: koda se izda sele, ko je priprava koncana", async () => {
  const o = await pripravi();
  try {
    await vklopi(o, true);     // brez vezave
    registrirajVezoKlicev(lazna(o, 250));
    const s = await zacniSeznanitevSKodo(o.token, o.dir);
    assert.ok(s.koda.length > 0);
    assert.ok(o.dnevnik.includes("zagotovi-konec"), "priprava je bila koncana pred izdajo kode");
  } finally { await pospravi(o); }
});

test("opozorilo o neuspeli pripravi izgine, ko naslednja priprava uspe", async () => {
  const o = await pripravi();
  try {
    let uspe = false;
    registrirajVezoKlicev({
      zagotovi: async () => { if (!uspe) throw new Error("OpenLine se ni pripravil"); },
      ustavi: async () => undefined,
    });
    await vklopi(o, true);
    await pocakaj(50);
    assert.equal((await stanjeAsistenta(o.token, o.dir)).opozoriloKlicev, "Pot klicev ni pripravljena: OpenLine se ni pripravil");
    uspe = true;
    await zacniSeznanitev(o.token, o.dir);
    assert.equal((await stanjeAsistenta(o.token, o.dir)).opozoriloKlicev, "");
  } finally { await pospravi(o); }
});
