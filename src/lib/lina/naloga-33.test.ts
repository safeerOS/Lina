// Naloga 33 (lastnik 26. 11. 2026, testni PC, Lina 0.2.12): sveza namestitev ima naslov 127.0.0.1, telefon doma Line ne najde in
// Lina ne predlaga nicesar; OpenLine javi samo »se ni pripravil pravocasno«. Zdaj: predlog naslova privzete poti (brez docker), preklop
// samo z lastnikovim klikom; vsak neuspeh zagona OpenLine ima vzrok. Lazno omrezje: vmesnik »enp1s0« z naslovom 127.0.0.x (vezljiv
// brez pravega omrezja), »docker0« s 172.17.0.1. Komentarji brez sumnikov.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir, type NetworkInterfaceInfo } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setupOwner } from "./auth.server.ts";
import {
  NASTAVITVE_ASISTENTA, nastaviOmrezjeNaslovov, ponastaviAsistenta, registrirajRele, registrirajVezoKlicev, shraniAsistenta, stanjeAsistenta,
  uskladiAsistenta,
} from "./asistent-telefon.server.ts";
import { ustaviOpenLine, vzrokIzhoda, vzrokIzStderr, zagotoviOpenLine } from "./openline-zagon.server.ts";
import { slovenskoSporociloOpenLine } from "./openline-veza.server.ts";

const v4 = (address: string) => ({ address, family: "IPv4", internal: false, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: null }) as NetworkInterfaceInfo;
const MAC_DOMA = "aa:bb:cc:00:00:01";

async function prostaVrata(): Promise<number> {
  return await new Promise<number>((ok, ne) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); });
    s.once("error", ne);
  });
}

async function pripravi(): Promise<{ dir: string; token: string; zagoni: string[] }> {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-n33-"));
  const token = await setupOwner("geslo-test-1234", dir, { address: "127.0.0.1" });
  // kot sveza namestitev, ki jo je lastnik vklopil: naslov 127.0.0.1 (privzeta rezerva), nobeno omrezje se ni odobreno
  await writeFile(path.join(dir, NASTAVITVE_ASISTENTA), JSON.stringify({ vklop: true, naslov: "127.0.0.1", vrata: await prostaVrata(), imena: {}, ocenaIzida: true, globalLink: false }));
  const zagoni: string[] = [];
  registrirajVezoKlicev({ zagotovi: async (_r, n) => { zagoni.push(n); }, ustavi: async () => undefined });
  return { dir, token, zagoni };
}
async function pospravi(dir: string): Promise<void> {
  nastaviOmrezjeNaslovov(null);
  registrirajRele(null);
  registrirajVezoKlicev(null);
  await ponastaviAsistenta();
  await rm(dir, { recursive: true, force: true });
}
const omrezje = () => nastaviOmrezjeNaslovov({
  // docker0 je prvi: predlog ga mora preskociti
  vmesniki: () => ({ docker0: [v4("172.17.0.1")], enp1s0: [v4("127.0.0.5")] }),
  izvor: async () => "127.0.0.5",
  prehodi: async () => ({ enp1s0: MAC_DOMA }),
});

test("naloga 33: na 127.0.0.1 Lina predlaga naslov privzete poti (ne docker), sama ne preklopi in ne odobri omrezja", async () => {
  const o = await pripravi();
  try {
    omrezje();
    await uskladiAsistenta(o.dir);
    const s = await stanjeAsistenta(o.token, o.dir);
    assert.equal(s.naslov, "127.0.0.1");
    assert.equal(s.predlogNaslova, "127.0.0.5", "predlog za gumb »Uporabi domace omrezje«");
    const z = JSON.parse(await readFile(path.join(o.dir, NASTAVITVE_ASISTENTA), "utf8")) as { naslov: string; omrezja?: string[] };
    assert.equal(z.naslov, "127.0.0.1", "brez klika se naslov ne spremeni");
    assert.deepEqual(z.omrezja ?? [], [], "brez klika ni odobrenega omrezja");
  } finally { await pospravi(o.dir); }
});

test("naloga 33: klik »Uporabi domace omrezje« odobri omrezje, Lina poslusa na zasebnem naslovu in OpenLine dobi ta naslov", async () => {
  const o = await pripravi();
  try {
    omrezje();
    await uskladiAsistenta(o.dir);
    const pred = await stanjeAsistenta(o.token, o.dir);
    const s = await shraniAsistenta(o.token, { naslov: pred.predlogNaslova, odobriOmrezje: true }, o.dir);
    assert.equal(s.naslov, "127.0.0.5");
    assert.equal(s.tece, true);
    assert.equal(s.predlogNaslova, "", "po odobritvi ni vec predloga");
    const z = JSON.parse(await readFile(path.join(o.dir, NASTAVITVE_ASISTENTA), "utf8")) as { omrezja: string[] };
    assert.deepEqual(z.omrezja, [`127.0.0.0/24|${MAC_DOMA}`]);
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(o.zagoni.includes("127.0.0.5"), `OpenLine na zasebnem naslovu: ${o.zagoni.join(",")}`);
  } finally { await pospravi(o.dir); }
});

test("naloga 33: izkljucen telefon ali brez zasebnega naslova - ni predloga", async () => {
  const o = await pripravi();
  try {
    nastaviOmrezjeNaslovov({ vmesniki: () => ({ docker0: [v4("172.17.0.1")] }), izvor: async () => "172.17.0.1", prehodi: async () => ({}) });
    await uskladiAsistenta(o.dir);
    assert.equal((await stanjeAsistenta(o.token, o.dir)).predlogNaslova, "", "docker ni domace omrezje");
    await shraniAsistenta(o.token, { vklop: false }, o.dir);
    omrezje();
    assert.equal((await stanjeAsistenta(o.token, o.dir)).predlogNaslova, "");
  } finally { await pospravi(o.dir); }
});

// ------------------------------------------------------------------ vzroki zagona OpenLine

test("naloga 33: vzrokIzhoda in vzrokIzStderr dajo samo kratke kode; vsaka koda ima svoje sporocilo (ne obce in ne »pravocasno«)", () => {
  assert.equal(vzrokIzhoda(2, null, null), "zaganjalnik");
  assert.equal(vzrokIzhoda(3, null, null), "uvoz");
  assert.equal(vzrokIzhoda(1, null, null), "izhod");
  assert.equal(vzrokIzhoda(null, "SIGKILL", null), "ustavljen");
  assert.equal(vzrokIzhoda(1, null, "vrata zasedena"), "vrata zasedena");
  assert.equal(vzrokIzStderr("Error: listen EADDRINUSE: address already in use 127.0.0.1:8447 kljuc=TAJNO"), "vrata zasedena");
  assert.equal(vzrokIzStderr("Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'express'"), "manjka modul");
  assert.equal(vzrokIzStderr("listen EACCES"), "dovoljenje");
  assert.equal(vzrokIzStderr("nekaj drugega TAJNO"), null);
  for (const k of ["rok", "zagon", "zaganjalnik", "uvoz", "vrata zasedena", "dovoljenje", "manjka modul", "ustavljen", "izhod", "OpenLine ni v paketu"]) {
    const m = slovenskoSporociloOpenLine(new Error(k));
    assert.notEqual(m, "OpenLine se ni zagnal", k);
    assert.doesNotMatch(m, /pravočasno/, k);
  }
});

function paket(vsebina: string): { root: string; koren: string } {
  const root = mkdtempSync(path.join(tmpdir(), "lina-n33-ol-"));
  const koren = path.join(root, "ol");
  mkdirSync(path.join(koren, "dist"), { recursive: true });
  writeFileSync(path.join(koren, "package.json"), '{"type":"module"}');
  writeFileSync(path.join(koren, "dist", "index.js"), vsebina);
  return { root, koren };
}
const lina = async () => ({ naslov: "127.0.0.1", vrata: 8447, odtis: "AB".repeat(32), zeton: "z".repeat(40) });

test("naloga 33: pravi zaganjalnik - napaka uvoza OpenLine je »uvoz«, zasedena vrata »vrata zasedena«, molk »rok«", async () => {
  const zaseden = net.createServer();
  await new Promise<void>((ok) => zaseden.listen(0, "127.0.0.1", () => ok()));
  const vrataZasedena = (zaseden.address() as net.AddressInfo).port;
  const primeri: Array<[string, string, number]> = [
    ["throw new Error('pokvarjeno TAJNO');\n", "uvoz", 10_000],
    [`import net from "node:net"; net.createServer().listen(${vrataZasedena}, "127.0.0.1");\nsetInterval(() => {}, 1000);\n`, "vrata zasedena", 10_000],
    ["setInterval(() => {}, 1000);\n", "rok", 400],
  ];
  try {
    for (const [vsebina, vzrok, rok] of primeri) {
      const p = paket(vsebina);
      try {
        await assert.rejects(
          zagotoviOpenLine(p.root, "127.0.0.1", { korenOpenLine: () => p.koren, pripraviLino: lina, rokPripravljenostiMs: rok }),
          (e: unknown) => { assert.equal((e as Error).message, vzrok); return true; },
        );
      } finally {
        await ustaviOpenLine(1500);
        await rm(p.root, { recursive: true, force: true });
      }
    }
  } finally { zaseden.close(); }
});
