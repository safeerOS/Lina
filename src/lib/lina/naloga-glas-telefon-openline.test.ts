// #17 OpenLine v racunalniski aplikaciji: pripraviGlasTelefonaZaOpenLine = Lina SAMA vklopi glas telefona, zasuka zeton in vrne podatke za OpenLine
// (naslov in vrata glasu telefona, odtis njegovega potrdila, nov zeton). Pravi TLS in pravi WebSocket, samo 127.0.0.1, nakljucna vrata.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  NASTAVITVE_GLASU_TELEFONA, glasTelefonaTece, nastaviPrikljucekTelefona, pripraviGlasTelefonaZaOpenLine, ustaviGlasTelefona, type PrikljucekTelefona,
} from "./glas-telefon.server.ts";
import { odtisPotrdila } from "./zasebno-omrezje.server.ts";
import { odpri } from "./glas-telefon-odjemalec.preizkus.ts";

async function prostaVrata(): Promise<number> {
  return await new Promise<number>((ok, ne) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); });
    s.once("error", ne);
  });
}
const priklop: PrikljucekTelefona = { zacni: () => undefined, zvok: () => undefined, ustavi: () => undefined };

test("pripraviGlasTelefonaZaOpenLine: vklopi glas telefona brez lastnikove seje, vrne vrata, odtis in nov zeton; zeton velja, napacen ne", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "glas-ol-"));
  const vrata = await prostaVrata();
  try {
    await writeFile(path.join(dir, NASTAVITVE_GLASU_TELEFONA), JSON.stringify({ vklop: false, vrata }));
    nastaviPrikljucekTelefona(priklop);
    const p = await pripraviGlasTelefonaZaOpenLine(dir);
    assert.equal(p.naslov, "127.0.0.1");
    assert.equal(p.vrata, vrata, "izbrana vrata ostanejo");
    assert.match(p.odtis, /^[0-9a-f]{64}$/);
    assert.ok(p.zeton.length >= 32, "zeton ima vsaj 32 znakov");
    assert.equal(glasTelefonaTece(), true);
    const nastavitve = JSON.parse(readFileSync(path.join(dir, NASTAVITVE_GLASU_TELEFONA), "utf8")) as { vklop: boolean; vrata: number; naslov: string };
    assert.deepEqual(nastavitve, { vklop: true, naslov: "127.0.0.1", vrata });
    const cert = readFileSync(path.join(dir, "glas-telefon-tls", "potrdilo.pem"), "utf8");
    assert.equal(p.odtis, odtisPotrdila(cert), "odtis je odtis pravega potrdila strezniska");
    const z = { vrata: p.vrata, cert, odtis: p.odtis };
    const dober = await odpri(z, { zeton: p.zeton });
    assert.equal(dober.odziv?.status, 101, "vrnjeni zeton odpre povezavo");
    dober.zapri();
    const slab = await odpri(z, { zeton: p.zeton + "x" });
    assert.notEqual(slab.odziv?.status, 101, "napacen zeton ne odpre povezave");
    slab.zapri();
    assert.equal(readFileSync(path.join(dir, "glas-telefon-zeton.json"), "utf8").includes(p.zeton), false, "zeton ni v datoteki v cistem besedilu");
  } finally { await ustaviGlasTelefona(); await rm(dir, { recursive: true, force: true }); }
});

test("pripraviGlasTelefonaZaOpenLine: ponovni klic zasuka zeton (stari preneha veljati), strezniska vrata in odtis ostanejo", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "glas-ol-"));
  const vrata = await prostaVrata();
  try {
    await writeFile(path.join(dir, NASTAVITVE_GLASU_TELEFONA), JSON.stringify({ vklop: false, vrata }));
    nastaviPrikljucekTelefona(priklop);
    const p1 = await pripraviGlasTelefonaZaOpenLine(dir);
    const p2 = await pripraviGlasTelefonaZaOpenLine(dir);
    assert.notEqual(p1.zeton, p2.zeton, "nov zeton ob vsakem klicu");
    assert.equal(p2.vrata, p1.vrata);
    assert.equal(p2.odtis, p1.odtis, "potrdilo se ne zamenja (telefon ne izgubi seznanitve)");
    const cert = readFileSync(path.join(dir, "glas-telefon-tls", "potrdilo.pem"), "utf8");
    const z = { vrata: p2.vrata, cert, odtis: p2.odtis };
    const star = await odpri(z, { zeton: p1.zeton });
    assert.notEqual(star.odziv?.status, 101, "stari zeton ne velja vec");
    star.zapri();
    const nov = await odpri(z, { zeton: p2.zeton });
    assert.equal(nov.odziv?.status, 101);
    nov.zapri();
  } finally { await ustaviGlasTelefona(); await rm(dir, { recursive: true, force: true }); }
});
