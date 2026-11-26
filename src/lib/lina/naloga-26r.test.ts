// Naloga 26r: najdbe CodeRabbit r3 na racunalniku 0.2.14 (slepi-0214/coderabbit-r3-najdbe.md). CRR3-1 in CRR3-3 sta v
// asistent-streznik.test.ts (potrebujeta njegov streznik). Vsak preizkus brez popravka pade, razen »(ohrani)«, ki zaklene vedenje,
// ki ga popravek ne sme spremeniti. Lazno omrezje: vmesnik »enp1s0« z
// naslovi 127.0.0.x. Komentarji brez sumnikov.
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { tmpdir, type NetworkInterfaceInfo } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setupOwner } from "./auth.server.ts";
import {
  NASTAVITVE_ASISTENTA, nastaviOmrezjeNaslovov, ponastaviAsistenta, preveriNaslovAsistenta, registrirajRele, registrirajVezoKlicev,
  stanjeAsistenta, uskladiAsistenta,
} from "./asistent-telefon.server.ts";
import { izmenjajSinhron, preveriZahtevo } from "./sinhron-telefon.server.ts";

process.env.LINA_LLM = "0";
const v4 = (address: string) => ({ address, family: "IPv4", internal: false, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: null }) as NetworkInterfaceInfo;
const MAC_DOMA = "aa:bb:cc:00:00:01";
const MAC_TUJ = "aa:bb:cc:00:00:99";

async function prostaVrata(): Promise<number> {
  return await new Promise<number>((ok, ne) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); });
    s.once("error", ne);
  });
}

/**
 * Rezerva »vrata«: shranjeni naslov 127.0.0.5 v odobrenem omrezju (prehod MAC_DOMA), vrata zasedena. [vm] in [mac] preizkus spremeni.
 * Vrne stevec ustavitev poti klicev (= ponovni zagon streznika).
 */
async function rezervaVrata(t: (o: { dir: string; token: string; okolje: { vm: NodeJS.Dict<NetworkInterfaceInfo[]>; mac: string | null }; ustavitve: () => number }) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-n26r-"));
  const token = await setupOwner("geslo-test-1234", dir, { address: "127.0.0.1" });
  const vrata = await prostaVrata();
  await writeFile(path.join(dir, NASTAVITVE_ASISTENTA), JSON.stringify({ vklop: true, naslov: "127.0.0.5", vrata, imena: {}, ocenaIzida: true, globalLink: true, omrezja: [`127.0.0.0/24|${MAC_DOMA}`] }));
  const zaseden = net.createServer();
  await new Promise<void>((ok, ne) => { zaseden.once("error", ne); zaseden.listen(vrata, "127.0.0.5", () => ok()); });
  const okolje: { vm: NodeJS.Dict<NetworkInterfaceInfo[]>; mac: string | null } = { vm: { enp1s0: [v4("127.0.0.5")] }, mac: MAC_DOMA };
  let ustavitev = 0;
  try {
    nastaviOmrezjeNaslovov({
      vmesniki: () => okolje.vm,
      izvor: async () => okolje.vm.enp1s0?.[0]?.address ?? null,
      // mac null: prehod enp1s0 se ni v ARP, drug vmesnik ga ima (prazen seznam bi bil Windows BREZ_PREHODA, ne »ne-vem«)
      prehodi: async (): Promise<Record<string, string>> => (okolje.mac ? { enp1s0: okolje.mac } : { wlp9s0: MAC_DOMA }),
    });
    registrirajRele({ host: "127.0.0.1", port: await prostaVrata() });
    registrirajVezoKlicev({ zagotovi: async () => undefined, ustavi: async () => { ustavitev += 1; } });
    await uskladiAsistenta(dir);
    assert.equal((await stanjeAsistenta(token, dir)).napakaKoda, "vrata", "izhodisce: rezerva vrata");
    await t({ dir, token, okolje, ustavitve: () => ustavitev });
  } finally {
    await new Promise<void>((ok) => zaseden.close(() => ok()));
    nastaviOmrezjeNaslovov(null);
    registrirajRele(null);
    registrirajVezoKlicev(null);
    await ponastaviAsistenta();
    await rm(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ CRR3-2

test("CRR3-2: rezerva »vrata«, prehod se zamenja (neodobreno omrezje), vrata se zasedena - razlog postane »omrezje« z gumbom za odobritev", async () => {
  await rezervaVrata(async ({ dir, token, okolje, ustavitve }) => {
    okolje.mac = MAC_TUJ;
    assert.equal(await preveriNaslovAsistenta(dir), true, "sprememba prehoda sprozi uskladitev");
    const s = await stanjeAsistenta(token, dir);
    assert.equal(s.napakaKoda, "omrezje", "zaslon Povezi telefon pokaze gumb za odobritev samo pri »omrezje«");
    assert.equal(s.predlogNaslova, "127.0.0.5", "gumb »Uporabi ta naslov« ima naslov");
    assert.equal(s.samoGlobalLink, true, "Global Link tece naprej");
    assert.equal(ustavitve(), 0, "slepi pregled 26r N1: rezerva se ne zazene znova (naloge Global Linka ostanejo)");
    assert.equal(await preveriNaslovAsistenta(dir), false, "nespremenjeno omrezje: brez ponovne uskladitve (rele ne utripa)");
    assert.equal((await stanjeAsistenta(token, dir)).napakaKoda, "omrezje");
    // slepi pregled 26r krog 2 (N0): omrezje se vrne, vrata so se zasedena - razlog spet »vrata«, BREZ ponovnega zagona na poti nazaj
    okolje.mac = MAC_DOMA;
    assert.equal(await preveriNaslovAsistenta(dir), true);
    const d = await stanjeAsistenta(token, dir);
    assert.equal(d.napakaKoda, "vrata");
    assert.equal(d.predlogNaslova, "");
    assert.equal(ustavitve(), 0, "tja in nazaj: streznik, rele in naloge Global Linka tecejo ves cas");
  });
});

test("CRR3-2: rezerva »vrata«, shranjeni naslov izgine brez novega naslova - razlog postane »naslov«, brez ponovnega zagona", async () => {
  await rezervaVrata(async ({ dir, token, okolje, ustavitve }) => {
    okolje.vm = { enp1s0: [] };
    assert.equal(await preveriNaslovAsistenta(dir), true);
    const s = await stanjeAsistenta(token, dir);
    assert.equal(s.napakaKoda, "naslov");
    assert.equal(s.samoGlobalLink, true);
    assert.equal(ustavitve(), 0);
    assert.equal(await preveriNaslovAsistenta(dir), false, "brez utripanja");
    // krog 2 (N1): tuje omrezje z novim naslovom - razlog »omrezje« z gumbom za ta naslov (kot nov zagon), ne zataknjen »naslov«
    okolje.vm = { enp1s0: [v4("127.0.0.9")] };
    okolje.mac = MAC_TUJ;
    assert.equal(await preveriNaslovAsistenta(dir), true);
    const t = await stanjeAsistenta(token, dir);
    assert.equal(t.napakaKoda, "omrezje");
    assert.equal(t.predlogNaslova, "127.0.0.9");
    // domov: shranjeni naslov in prehod sta spet tu, vrata se zasedena -> »vrata«, brez ponovnega zagona
    okolje.vm = { enp1s0: [v4("127.0.0.5")] };
    okolje.mac = MAC_DOMA;
    assert.equal(await preveriNaslovAsistenta(dir), true);
    assert.equal((await stanjeAsistenta(token, dir)).napakaKoda, "vrata");
    assert.equal(ustavitve(), 0, "ves krog brez ponovnega zagona");
  });
});

test("CRR3-2 (ohrani): rezerva »vrata«, omrezje nespremenjeno ali neprepoznano (»ne-vem«), vrata zasedena - brez ponovnega zagona", async () => {
  await rezervaVrata(async ({ dir, token, okolje, ustavitve }) => {
    assert.equal(await preveriNaslovAsistenta(dir), false, "nic se ni spremenilo");
    okolje.mac = null; // prehod se ni v ARP: »ne-vem« tekocega ne ustavi (naloga 21 N1)
    assert.equal(await preveriNaslovAsistenta(dir), true, "odtis brez prehoda je drug");
    const s = await stanjeAsistenta(token, dir);
    assert.equal(s.napakaKoda, "vrata");
    assert.equal(ustavitve(), 0, "streznik in rele se nista ustavila");
  });
});

// ------------------------------------------------------------------ CRR3-4

test("CRR3-4: pravila.json se med preverbo in branjem roka zamenja z »null« - rok je iz ENEGA posnetka (365), ne zasilnih 90", async () => {
  const ZDAJ = Date.parse("2026-11-26T09:00:00.000Z");
  const DAN = 86_400_000;
  const stari = { id: "klic-star-200", casZacetka: ZDAJ - 200 * DAN, stevilka: "+38640111222", trajanjeS: 42, nujno: false, povzetek: "Povprasevanje.", nacin: "podjetje",
    klicatelj: "Miha Primer", podjetje: "", sporocilo: "", sporociloDobesedno: "", brezSporocilaRazlog: "", prepisPogovora: [], prepisOkrnjen: false };
  const zahteva = (klici: unknown[], rev = 0, epoha: string | null = null) =>
    preveriZahtevo(JSON.parse(JSON.stringify({ rev, klici, pogovor: [], navodila: null, epoha, izbrisani: [] })), ZDAJ);
  const dir = await mkdtemp(path.join(tmpdir(), "lina-n26r-rok-"));
  const pravila = path.join(dir, "pravila.json");
  const izvirni = fs.promises.readFile;
  try {
    await writeFile(pravila, JSON.stringify({ zapiskiHrambaDni: 365 }));
    const prvi = await izmenjajSinhron(zahteva([stari]), dir, { zdaj: () => ZDAJ });
    assert.equal(prvi.rokHrambeDni, 365);
    // drug pisec (urejevalnik, drug proces) zamenja datoteko TAKOJ po prvem branju pravila.json v tej izmenjavi
    let branj = 0;
    fs.promises.readFile = (async (...a: Parameters<typeof izvirni>) => {
      const r = await izvirni(...a);
      if (String(a[0]) === pravila && ++branj === 1) fs.writeFileSync(pravila, "null");
      return r;
    }) as typeof izvirni;
    syncBuiltinESMExports();
    const drugi = await izmenjajSinhron(zahteva([], prvi.rev, prvi.epoha), dir, { zdaj: () => ZDAJ });
    assert.ok(branj >= 1, "preizkus je ujel branje pravila.json");
    assert.equal(drugi.rokHrambeDni, 365, "telefon po zasilnih 90 dneh ne sme brisati 200 dni starega klica");
    fs.promises.readFile = izvirni;
    syncBuiltinESMExports();
    await writeFile(pravila, JSON.stringify({ zapiskiHrambaDni: 365 }));
    const znova = await izmenjajSinhron(zahteva([], 0, prvi.epoha), dir, { zdaj: () => ZDAJ });
    assert.deepEqual(znova.klici.map((k) => k.id), ["klic-star-200"], "klic ni bil izbrisan po zasilnem roku");
  } finally {
    fs.promises.readFile = izvirni;
    syncBuiltinESMExports();
    await rm(dir, { recursive: true, force: true });
  }
});
