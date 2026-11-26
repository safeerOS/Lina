// Naloga 15 (lastnik 25. 11. 2026): racunalnik zamenja omrezni naslov (Wi-Fi -> kabel), shranjen naslov asistentke ni vec na
// nobenem vmesniku. Prej: zazeni() pade z EADDRNOTAVAIL, telefon za asistentko in Global Link ne tecejo. Zdaj: Lina sama izbere
// trenutni naslov v lokalnem omrezju in ga shrani; ce lokalnega naslova ni, agent releja vseeno tece; napaka je vidna v sl in en.
// Lazno omrezje: vmesnik »enp1s0« z naslovi 127.0.0.x (na Linuxu jih je mogoce vezati brez pravega omrezja).
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir, type NetworkInterfaceInfo } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setupOwner } from "./auth.server.ts";
import {
  NASTAVITVE_ASISTENTA, nastaviOmrezjeNaslovov, ponastaviAsistenta, preveriNaslovAsistenta, registrirajRele, stanjeAsistenta, uskladiAsistenta,
  zacniSeznanitev,
} from "./asistent-telefon.server.ts";
import { izberiLanNaslov, omrezjeNaslova } from "./zasebno-omrezje.server.ts";

const v4 = (address: string, internal = false) => ({ address, family: "IPv4", internal, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: null }) as NetworkInterfaceInfo;
// naloga 21 (N1): vsak lazni vmesnik ima privzeti prehod z znanim MAC (brez njega omrezja ni mogoce odobriti)
const MAC_PREHODA = "aa:bb:cc:00:00:15";
const PREHODI = new Proxy({} as Record<string, string>, { get: () => MAC_PREHODA });
const v6 = (address: string) => ({ address, family: "IPv6", internal: false, netmask: "ffff:ffff:ffff:ffff::", mac: "00:00:00:00:00:00", cidr: null, scopeid: 0 }) as NetworkInterfaceInfo;

async function prostaVrata(): Promise<number> {
  return await new Promise<number>((ok, ne) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); });
    s.once("error", ne);
  });
}

type Okolje = { dir: string; token: string; vrata: number };
async function pripravi(naslov: string, globalLink = false): Promise<Okolje> {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-n15-"));
  const token = await setupOwner("geslo-test-1234", dir, { address: "127.0.0.1" });
  const vrata = await prostaVrata();
  // shranjen naslov, ki ga ta racunalnik nima (kot pri lastniku po menjavi Wi-Fi -> kabel); shraniAsistenta bi ga zavrnil
  // naloga 21 (N1): samodejno sledenje in poslusanje samo v omrezju, ki ga je lastnik odobril - tu lazna omrezja preizkusov (127.0.0.0/24 in
  // 192.168.77.0/24 brez prehoda); preizkusi neodobrenega omrezja so v naloga-21.test.ts
  await writeFile(path.join(dir, NASTAVITVE_ASISTENTA), JSON.stringify({ vklop: true, naslov, vrata, imena: {}, ocenaIzida: true, globalLink, omrezja: [`127.0.0.0/24|${MAC_PREHODA}`, `192.168.77.0/24|${MAC_PREHODA}`] }));
  return { dir, token, vrata };
}
async function pospravi(o: Okolje): Promise<void> {
  nastaviOmrezjeNaslovov(null);
  registrirajRele(null);
  await ponastaviAsistenta();
  await rm(o.dir, { recursive: true, force: true });
}
const shranjen = async (o: Okolje) => JSON.parse(await readFile(path.join(o.dir, NASTAVITVE_ASISTENTA), "utf8")) as { naslov: string; vrata: number };

// CRR4: Proxy brez lastnih kljucev je za omrezjeNaslova prava mapa prehodov (bere samo prehodi[ime]); sicer bi preizkusi spodaj tiho
// preverjali »brez-prehoda« ali zavrnitev namesto odobrenega omrezja
test("CRR4: lazni PREHODI da odobreno omrezje 127.0.0.0/24|MAC_PREHODA (ne brez-prehoda, ne null)", () => {
  assert.equal(omrezjeNaslova("127.0.0.5", { enp1s0: [v4("127.0.0.5")] }, PREHODI), `127.0.0.0/24|${MAC_PREHODA}`);
  assert.equal(omrezjeNaslova("192.168.77.7", { wlp2s0: [v4("192.168.77.7")] }, PREHODI), `192.168.77.0/24|${MAC_PREHODA}`);
});

test("izberiLanNaslov: vmesnik privzete poti, nikoli docker/br-/veth/lo/notranji, IPv4 pred ULA, javni nikoli", () => {
  const vmesniki = {
    lo: [v4("127.0.0.1", true)],
    docker0: [v4("172.17.0.1")],
    "br-aa1c5a814643": [v4("10.83.0.1")],
    veth12ab: [v4("10.0.5.1")],
    lo0: [v4("10.9.9.9")],
    wlp2s0: [v4("192.168.1.20")],
    enp1s0: [v4("192.168.0.135"), v6("fd12:3456::1")],
  };
  assert.equal(izberiLanNaslov(vmesniki, "192.168.0.135"), "192.168.0.135", "vmesnik privzete poti");
  assert.equal(izberiLanNaslov(vmesniki, null), "192.168.1.20", "brez privzete poti: prvi zasebni na pravem vmesniku");
  assert.equal(izberiLanNaslov(vmesniki, "172.17.0.1"), "192.168.1.20", "privzeta pot prek dockerja se ne uporabi");
  assert.equal(izberiLanNaslov({ docker0: [v4("172.17.0.1")], lo: [v4("127.0.0.1", true)] }, null), null);
  assert.equal(izberiLanNaslov({ eth0: [v4("8.8.4.4")] }, "8.8.4.4"), null, "javni naslov nikoli");
  assert.equal(izberiLanNaslov({ eth0: [v4("8.8.4.4"), v6("fd00::5")] }, null), "fd00::5", "ULA, ce zasebnega IPv4 ni");
  // Windows: imena pravih vmesnikov, ki se zacnejo z »Lo«, niso loopback
  assert.equal(izberiLanNaslov({ "Local Area Connection": [v4("192.168.5.5")] }, null), "192.168.5.5");
  assert.equal(izberiLanNaslov({ "Lokalna povezava 2": [v4("10.1.1.4")] }, "10.1.1.4"), "10.1.1.4");
  assert.equal(izberiLanNaslov({ eth0: [v6("fe80::1"), v6("2001:db8::1")] }, null), null, "link-local in javni IPv6 ne");
});

test("shranjenega naslova ni vec: Lina izbere trenutni naslov lokalnega omrezja, poslusa na njem in ga shrani", async () => {
  const o = await pripravi("192.168.77.7");
  try {
    nastaviOmrezjeNaslovov({ prehodi: async () => PREHODI, vmesniki: () => ({ lo: [v4("127.0.0.1", true)], docker0: [v4("172.17.0.1")], enp1s0: [v4("127.0.0.5")] }), izvor: async () => "127.0.0.5" });
    await uskladiAsistenta(o.dir);
    const s = await stanjeAsistenta(o.token, o.dir);
    assert.equal(s.tece, true, s.napaka);
    assert.equal(s.napaka, "");
    assert.equal(s.naslov, "127.0.0.5");
    assert.equal((await shranjen(o)).naslov, "127.0.0.5", "nov naslov je shranjen");
    assert.equal((await shranjen(o)).vrata, o.vrata, "vrata ostanejo");
  } finally { await pospravi(o); }
});

test("sprememba omrezja med tekom: preveriNaslovAsistenta preklopi na nov naslov; zdrav streznik pusti pri miru", async () => {
  const o = await pripravi("127.0.0.5");
  try {
    let naslov = "127.0.0.5";
    nastaviOmrezjeNaslovov({ prehodi: async () => PREHODI, vmesniki: () => ({ enp1s0: [v4(naslov)] }), izvor: async () => naslov });
    await uskladiAsistenta(o.dir);
    const prej = await stanjeAsistenta(o.token, o.dir);
    assert.equal(prej.tece, true, prej.napaka);
    // nic se ni spremenilo: ni ponovnega zagona (isti odtis in isto okno kode bi se sicer izgubilo)
    assert.equal(await preveriNaslovAsistenta(o.dir), false);
    naslov = "127.0.0.6";
    assert.equal(await preveriNaslovAsistenta(o.dir), true);
    const po = await stanjeAsistenta(o.token, o.dir);
    assert.equal(po.tece, true, po.napaka);
    assert.equal(po.naslov, "127.0.0.6");
    assert.equal((await shranjen(o)).naslov, "127.0.0.6");
  } finally { await pospravi(o); }
});

test("brez lokalnega naslova: Global Link (agent releja) vseeno tece, napaka je vidna s kodo, QR doma se ne izda", async () => {
  const o = await pripravi("192.168.77.7", true);
  try {
    nastaviOmrezjeNaslovov({ prehodi: async () => PREHODI, vmesniki: () => ({ lo: [v4("127.0.0.1", true)], docker0: [v4("172.17.0.1")] }), izvor: async () => null });
    registrirajRele({ host: "127.0.0.1", port: await prostaVrata() }); // zaprta vrata: agent poskusa, a tece
    await uskladiAsistenta(o.dir);
    const s = await stanjeAsistenta(o.token, o.dir);
    assert.notEqual(s.globalLinkStanje, "izklopljen", "agent releja mora teci tudi brez lokalnega naslova");
    assert.equal(s.samoGlobalLink, true);
    assert.equal(s.napakaKoda, "naslov");
    assert.notEqual(s.napaka, "");
    assert.equal((await shranjen(o)).naslov, "192.168.77.7", "brez novega naslova ostane shranjen stari (ko se vrne, velja spet)");
    await assert.rejects(zacniSeznanitev(o.token, o.dir), /omrezj/i);
    assert.equal(await preveriNaslovAsistenta(o.dir), false, "omrezje se ni spremenilo: brez ponovnega zagona (rele ne utripa)");
    // omrezje se vrne: preveriNaslovAsistenta preklopi s samo Global Linka na lokalni naslov
    nastaviOmrezjeNaslovov({ prehodi: async () => PREHODI, vmesniki: () => ({ enp1s0: [v4("127.0.0.7")] }), izvor: async () => "127.0.0.7" });
    assert.equal(await preveriNaslovAsistenta(o.dir), true);
    const po = await stanjeAsistenta(o.token, o.dir);
    assert.equal(po.samoGlobalLink, false);
    assert.equal(po.naslov, "127.0.0.7");
    assert.equal(po.napakaKoda, "");
    assert.notEqual(po.globalLinkStanje, "izklopljen");
  } finally { await pospravi(o); }
});

test("naslov je na vmesniku, a vezava pade (npr. IPv6 DAD): ena rezerva, brez ponovnega zagona vsakih 30 s, dokler se omrezje ne spremeni", async () => {
  const o = await pripravi("192.168.77.7", true);
  try {
    let vm: NodeJS.Dict<NetworkInterfaceInfo[]> = { enp1s0: [v4("192.168.77.7")] }; // lazno: vmesnik ga ima, jedro ga ne veze
    nastaviOmrezjeNaslovov({ prehodi: async () => PREHODI, vmesniki: () => vm, izvor: async () => "192.168.77.7" });
    registrirajRele({ host: "127.0.0.1", port: await prostaVrata() });
    await uskladiAsistenta(o.dir);
    assert.equal((await stanjeAsistenta(o.token, o.dir)).samoGlobalLink, true);
    assert.equal(await preveriNaslovAsistenta(o.dir), false);
    assert.equal(await preveriNaslovAsistenta(o.dir), false);
    vm = { enp1s0: [v4("127.0.0.8")] };
    assert.equal(await preveriNaslovAsistenta(o.dir), true);
    const po = await stanjeAsistenta(o.token, o.dir);
    assert.equal(po.samoGlobalLink, false);
    assert.equal(po.naslov, "127.0.0.8");
  } finally { await pospravi(o); }
});

test("vrata zasedena (EADDRINUSE): Global Link tece, koda »vrata«, preverba vsakih 30 s NE zaganja znova (rele ne utripa)", async () => {
  const o = await pripravi("127.0.0.5", true);
  const zaseden = net.createServer();
  await new Promise<void>((ok, ne) => { zaseden.once("error", ne); zaseden.listen(o.vrata, "127.0.0.5", () => ok()); });
  try {
    nastaviOmrezjeNaslovov({ prehodi: async () => PREHODI, vmesniki: () => ({ enp1s0: [v4("127.0.0.5")] }), izvor: async () => "127.0.0.5" });
    registrirajRele({ host: "127.0.0.1", port: await prostaVrata() });
    await uskladiAsistenta(o.dir);
    const s = await stanjeAsistenta(o.token, o.dir);
    assert.equal(s.samoGlobalLink, true);
    assert.equal(s.napakaKoda, "vrata");
    assert.equal(s.tece, false);
    assert.notEqual(s.globalLinkStanje, "izklopljen");
    assert.equal(await preveriNaslovAsistenta(o.dir), false);
    assert.equal((await shranjen(o)).naslov, "127.0.0.5", "naslov je veljaven, ne menja se");
  } finally {
    await new Promise<void>((ok) => zaseden.close(() => ok()));
    await pospravi(o);
  }
});

test("vmesnik Poveži telefon: napaka asistenta je vidna (role=alert) tudi med tekom in v sl in en; stanje se osvezuje, ko je vklopljeno", async () => {
  const ui = await readFile(new URL("../../components/povezi-telefon.tsx", import.meta.url), "utf8");
  const besedila = await readFile(new URL("./besedila.ts", import.meta.url), "utf8");
  assert.match(ui, /s\.napakaKoda \? <p role="alert"[^>]*>\{t\(`telNapaka_\$\{s\.napakaKoda\}`\)\}/);
  assert.doesNotMatch(ui, /\{s\.napaka \|\| t\("telNeTece"\)\}/, "surovo slovensko besedilo streznika ni vec edini prikaz");
  assert.match(ui, /if \(!s\?\.vklop\) return;/, "osvezevanje tece, dokler je telefon vklopljen (tudi ko ne tece)");
  assert.match(ui, /if \(s\?\.naslov\) setNaslov\(s\.naslov\);/, "izbira naslova sledi samodejni menjavi");
  for (const k of ["telNapaka_naslov", "telNapaka_vrata", "telNapaka_drugo", "telSamoGlobalLink"]) {
    assert.equal(besedila.split(`${k}:`).length - 1, 2, `${k} v sl in en`);
  }
});
