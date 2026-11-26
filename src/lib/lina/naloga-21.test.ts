// Naloga 21 (sklepni slepi pregled 0.2.14, lastnikov ukaz v NALOGA-21.md): N1 samodejni naslov samo v odobrenem omrezju, N2 QR ob
// zapustitvi in zapora kode po viru, N3 rezerva »vrata« se preverja znova, N4 PID seje, N6 stevec slik, N9 kopija pokvarjene knjiznice,
// N10 odtis omrezja. Lazno omrezje: vmesnik »enp1s0« z naslovi 127.0.0.x (na Linuxu jih je mogoce vezati brez pravega omrezja).
// Komentarji brez sumnikov.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { request } from "node:https";
import net from "node:net";
import { tmpdir, type NetworkInterfaceInfo } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setupOwner } from "./auth.server.ts";
import {
  NASTAVITVE_ASISTENTA, nadzorVrat, nastaviOmrezjeNaslovov, ponastaviAsistenta, prekliciSeznanitev, preveriNaslovAsistenta, registrirajRele,
  registrirajVezoKlicev, shraniAsistenta, stanjeAsistenta, uskladiAsistenta, zacniSeznanitev,
} from "./asistent-telefon.server.ts";
import { odtisLan, omrezjeNaslova, prehodiVmesnikov } from "./zasebno-omrezje.server.ts";
import { kljucVira, NapakaKode, SeznanitevSKodo } from "./koda-seznanitev.ts";
import { Spake2 } from "./spake2.ts";
import { POSKUSOV, SKUPNO_KRAT, VarovalkaKode } from "./varovalka-kode.ts";
import { casZagonaProcesa, odpriSejoClaude, ponastaviSejo, ROK_ODPIRANJA_MS } from "./seja-claude.server.ts";
import { nalogSStevcemSlik, orodjaLine } from "./orkestrator-orodja.server.ts";
import { ustvariOrkestrator, type KlicModela } from "./orkestrator.server.ts";
import { DATOTEKA_SLIK, dodajVKnjiznico, preberiKnjiznico } from "./slike-knjiznica.server.ts";

const v4 = (address: string) => ({ address, family: "IPv4", internal: false, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: null }) as NetworkInterfaceInfo;
const v6 = (address: string) => ({ address, family: "IPv6", internal: false, netmask: "ffff:ffff:ffff:ffff::", mac: "00:00:00:00:00:00", cidr: null, scopeid: 0 }) as NetworkInterfaceInfo;
const MAC_DOMA = "aa:bb:cc:00:00:01";
const MAC_TUJE = "aa:bb:cc:00:00:99";

async function prostaVrata(): Promise<number> {
  return await new Promise<number>((ok, ne) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); });
    s.once("error", ne);
  });
}

type Okolje = { dir: string; token: string; vrata: number; zagoni: string[] };
/** Shranjene nastavitve kot pri lastniku; omrezja = odobrena omrezja (undefined = zapisa ni, kot pred nadgradnjo). */
async function pripravi(naslov: string, o: { globalLink?: boolean; omrezja?: string[] } = {}): Promise<Okolje> {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-n21-"));
  const token = await setupOwner("geslo-test-1234", dir, { address: "127.0.0.1" });
  const vrata = await prostaVrata();
  await writeFile(path.join(dir, NASTAVITVE_ASISTENTA), JSON.stringify({ vklop: true, naslov, vrata, imena: {}, ocenaIzida: true, globalLink: o.globalLink ?? false, ...(o.omrezja ? { omrezja: o.omrezja } : {}) }));
  const zagoni: string[] = [];
  registrirajVezoKlicev({ zagotovi: async (_r, n) => { zagoni.push(n); }, ustavi: async () => undefined });
  return { dir, token, vrata, zagoni };
}
async function pospravi(o: Okolje): Promise<void> {
  nastaviOmrezjeNaslovov(null);
  registrirajRele(null);
  registrirajVezoKlicev(null);
  nadzorVrat.ms = 5 * 60_000;
  await ponastaviAsistenta();
  await rm(o.dir, { recursive: true, force: true });
}
const shranjeno = async (o: Okolje) => JSON.parse(await readFile(path.join(o.dir, NASTAVITVE_ASISTENTA), "utf8")) as { naslov: string; omrezja?: string[] };
const pocakaj = () => new Promise((r) => setTimeout(r, 30));

// ------------------------------------------------------------------ N1

test("N1: shranjenega naslova ni, racunalnik je v NEODOBRENEM omrezju - nic se ne shrani, doma ne poslusa, OpenLine se ne zazene; predlog naslova", async () => {
  // shranjen domaci naslov je izginil; prenosnik je v hotelskem omrezju z zasebnim naslovom (tu 127.0.0.5) in drugim prehodom
  const o = await pripravi("192.168.77.7", { omrezja: [`192.168.77.0/24|${MAC_DOMA}`] });
  try {
    nastaviOmrezjeNaslovov({ vmesniki: () => ({ enp1s0: [v4("127.0.0.5")] }), izvor: async () => "127.0.0.5", prehodi: async () => ({ enp1s0: MAC_TUJE }) });
    await uskladiAsistenta(o.dir);
    await pocakaj();
    const s = await stanjeAsistenta(o.token, o.dir);
    assert.equal((await shranjeno(o)).naslov, "192.168.77.7", "naslov tujega omrezja se ne shrani");
    assert.equal(s.tece, false, "streznik za telefon ne poslusa na tujem omrezju");
    assert.equal(s.napakaKoda, "omrezje");
    assert.equal(s.predlogNaslova, "127.0.0.5");
    assert.deepEqual(o.zagoni, [], "OpenLine se na neodobrenem omrezju ne zazene");
    await assert.rejects(zacniSeznanitev(o.token, o.dir));
  } finally { await pospravi(o); }
});

test("N1: v ODOBRENEM omrezju Lina naslovu sledi sama (naloga 15 ostane)", async () => {
  const o = await pripravi("192.168.77.7", { omrezja: [`127.0.0.0/24|${MAC_DOMA}`] });
  try {
    nastaviOmrezjeNaslovov({ vmesniki: () => ({ enp1s0: [v4("127.0.0.5")] }), izvor: async () => "127.0.0.5", prehodi: async () => ({ enp1s0: MAC_DOMA }) });
    await uskladiAsistenta(o.dir);
    await pocakaj();
    const s = await stanjeAsistenta(o.token, o.dir);
    assert.equal(s.tece, true, s.napaka);
    assert.equal((await shranjeno(o)).naslov, "127.0.0.5");
    assert.deepEqual(o.zagoni, ["127.0.0.5"]);
  } finally { await pospravi(o); }
});

test("N1: shranjen naslov je na vmesniku, a za drugim prehodom (isti 192.168.x doma in v hotelu) - ne poslusa; odobri samo »Uporabi ta naslov«, stikalo ne", async () => {
  const o = await pripravi("127.0.0.5", { omrezja: [`127.0.0.0/24|${MAC_DOMA}`] });
  try {
    nastaviOmrezjeNaslovov({ vmesniki: () => ({ enp1s0: [v4("127.0.0.5")] }), izvor: async () => "127.0.0.5", prehodi: async () => ({ enp1s0: MAC_TUJE }) });
    await uskladiAsistenta(o.dir);
    assert.equal((await stanjeAsistenta(o.token, o.dir)).napakaKoda, "omrezje");
    // stikalo (brez odobritve) omrezja ne odobri
    await shraniAsistenta(o.token, { vklop: true, naslov: "127.0.0.5" }, o.dir);
    assert.equal((await stanjeAsistenta(o.token, o.dir)).tece, false);
    assert.deepEqual((await shranjeno(o)).omrezja, [`127.0.0.0/24|${MAC_DOMA}`]);
    // lastnikov izrecen klik
    const s = await shraniAsistenta(o.token, { naslov: "127.0.0.5", odobriOmrezje: true }, o.dir);
    await pocakaj();
    assert.equal(s.tece, true, s.napaka);
    assert.equal(s.napakaKoda, "");
    assert.deepEqual((await shranjeno(o)).omrezja, [`127.0.0.0/24|${MAC_DOMA}`, `127.0.0.0/24|${MAC_TUJE}`]);
    assert.deepEqual(o.zagoni, ["127.0.0.5"]);
  } finally { await pospravi(o); }
});

test("N1: brez zapisa odobrenih omrezij (nadgradnja) - fail-closed; MAC prehoda se ni znan: odobritev zavrnjena z jasnim sporocilom", async () => {
  const o = await pripravi("127.0.0.5");
  try {
    let prehod = "";
    nastaviOmrezjeNaslovov({ vmesniki: () => ({ enp1s0: [v4("127.0.0.5")] }), izvor: async () => "127.0.0.5", prehodi: async () => ({ enp1s0: prehod }) });
    await uskladiAsistenta(o.dir);
    assert.equal((await stanjeAsistenta(o.token, o.dir)).tece, false);
    await assert.rejects(shraniAsistenta(o.token, { naslov: "127.0.0.5", odobriOmrezje: true }, o.dir), /prepoznati/);
    prehod = MAC_DOMA;
    assert.equal((await shraniAsistenta(o.token, { naslov: "127.0.0.5", odobriOmrezje: true }, o.dir)).tece, true);
  } finally { await pospravi(o); }
});

test("N1: tekoci streznik doma - menjava prehoda (drugo omrezje) ga ustavi v drugi zaporedni preverbi (ARP/VRRP ne utripa); neznan MAC ga ne ustavi", async () => {
  const o = await pripravi("127.0.0.5", { omrezja: [`127.0.0.0/24|${MAC_DOMA}`] });
  try {
    let prehod = MAC_DOMA;
    nastaviOmrezjeNaslovov({ vmesniki: () => ({ enp1s0: [v4("127.0.0.5")] }), izvor: async () => "127.0.0.5", prehodi: async () => ({ enp1s0: prehod }) });
    await uskladiAsistenta(o.dir);
    assert.equal((await stanjeAsistenta(o.token, o.dir)).tece, true);
    prehod = "";
    assert.equal(await preveriNaslovAsistenta(o.dir), false, "neznan MAC ni sprememba omrezja");
    prehod = MAC_TUJE;
    assert.equal(await preveriNaslovAsistenta(o.dir), false, "ena preverba z drugim MAC se ne ustavi (slepi pregled 21, najdba 9)");
    prehod = MAC_DOMA;
    assert.equal(await preveriNaslovAsistenta(o.dir), false, "MAC se je vrnil: stevec gre na 0");
    prehod = MAC_TUJE;
    assert.equal(await preveriNaslovAsistenta(o.dir), false);
    prehod = "";
    assert.equal(await preveriNaslovAsistenta(o.dir), false, "»ne-vem« stevca ne ponastavi (slepi pregled 21b, 2)");
    prehod = MAC_TUJE;
    assert.equal(await preveriNaslovAsistenta(o.dir), true, "druga preverba v tujem omrezju");
    const s = await stanjeAsistenta(o.token, o.dir);
    assert.equal(s.tece, false);
    assert.equal(s.napakaKoda, "omrezje");
  } finally { await pospravi(o); }
});

test("N1 (Windows, brez podatka o prehodih): lastnik omrezje izrecno odobri, samodejno sledenje ga NE uporabi (isto podomrezje je lahko tuje)", async () => {
  const o = await pripravi("192.168.77.7", { omrezja: ["127.0.0.0/24|brez-prehoda"] });
  try {
    nastaviOmrezjeNaslovov({ vmesniki: () => ({ Ethernet: [v4("127.0.0.5")] }), izvor: async () => "127.0.0.5", prehodi: async () => ({}) });
    await uskladiAsistenta(o.dir);
    assert.equal((await shranjeno(o)).naslov, "192.168.77.7", "brez MAC prehoda ni samodejnega sledenja");
    assert.equal((await stanjeAsistenta(o.token, o.dir)).tece, false);
    const s = await shraniAsistenta(o.token, { naslov: "127.0.0.5", odobriOmrezje: true }, o.dir);
    assert.equal(s.tece, true, s.napaka);
  } finally { await pospravi(o); }
});

test("N1: Global Link na neodobrenem omrezju tece naprej (samo rele), QR in koda se ne izdata", async () => {
  const o = await pripravi("127.0.0.5", { globalLink: true, omrezja: [`127.0.0.0/24|${MAC_DOMA}`] });
  try {
    nastaviOmrezjeNaslovov({ vmesniki: () => ({ enp1s0: [v4("127.0.0.5")] }), izvor: async () => "127.0.0.5", prehodi: async () => ({ enp1s0: MAC_TUJE }) });
    registrirajRele({ host: "127.0.0.1", port: await prostaVrata() });
    await uskladiAsistenta(o.dir);
    const s = await stanjeAsistenta(o.token, o.dir);
    assert.equal(s.samoGlobalLink, true);
    assert.equal(s.napakaKoda, "omrezje");
    assert.notEqual(s.globalLinkStanje, "izklopljen");
    await assert.rejects(zacniSeznanitev(o.token, o.dir));
    assert.deepEqual(o.zagoni, []);
    assert.equal(await preveriNaslovAsistenta(o.dir), false, "isto omrezje: rele ne utripa");
  } finally { await pospravi(o); }
});

test("prehodiVmesnikov: privzeti prehod iz /proc/net/route (little-endian) in MAC iz /proc/net/arp; brez vnosa ARP prazen niz; brez datotek {}", async () => {
  const route = "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT\nwlp2s0\t00000000\t0101A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0\nwlp2s0\t0001A8C0\t00000000\t0001\t0\t0\t600\t00FFFFFF\t0\t0\t0\nenp1s0\t00000000\t0100000A\t0003\t0\t0\t100\t00000000\t0\t0\t0\n";
  const arp = "IP address       HW type     Flags       HW address            Mask     Device\n192.168.1.1      0x1         0x2         AA:BB:CC:00:00:01     *        wlp2s0\n10.0.0.1         0x1         0x0         00:00:00:00:00:00     *        enp1s0\n";
  assert.deepEqual(await prehodiVmesnikov(async (p) => (p.endsWith("route") ? route : arp)), { wlp2s0: MAC_DOMA, enp1s0: "" });
  assert.deepEqual(await prehodiVmesnikov(async () => { throw new Error("ENOENT"); }), {});
  assert.equal(omrezjeNaslova("192.168.1.20", { wlp2s0: [v4("192.168.1.20")] }, { wlp2s0: MAC_DOMA }), `192.168.1.0/24|${MAC_DOMA}`);
  assert.equal(omrezjeNaslova("192.168.1.20", { wlp2s0: [v4("192.168.1.20")] }, { wlp2s0: "" }), null, "MAC prehoda se ni znan = ne vemo");
  assert.equal(omrezjeNaslova("192.168.1.20", {}, {}), null);
  // slepi pregled 21 (2): vmesnik brez privzete poti, ko jo imajo drugi = ne vemo; sistem brez podatka o prehodih (Windows) = samo podomrezje
  assert.equal(omrezjeNaslova("192.168.1.20", { eth1: [v4("192.168.1.20")] }, { wlp2s0: MAC_DOMA }), null);
  assert.equal(omrezjeNaslova("192.168.1.20", { Ethernet: [v4("192.168.1.20")] }, {}), "192.168.1.0/24|brez-prehoda");
  // slepi pregled 21b (1): MAC prehoda samo z ISTEGA vmesnika (MAC z drugega vmesnika z istim IP prehoda bi tuje omrezje razvrstil kot domace)
  const route2 = "Iface\tDestination\tGateway\nenp1s0\t00000000\t0101A8C0\nwlp2s0\t00000000\t0101A8C0\n";
  const arp2 = "IP address HW type Flags HW address Mask Device\n192.168.1.1 0x1 0x2 aa:bb:cc:00:00:01 * enp1s0\n";
  assert.deepEqual(await prehodiVmesnikov(async (p) => (p.endsWith("route") ? route2 : arp2)), { enp1s0: MAC_DOMA, wlp2s0: "" });
});

test("slepi pregled 21 (5): ob menjavi neodobrenega omrezja med rezervo predlog naslova ni zastarel", async () => {
  const o = await pripravi("127.0.0.5", { globalLink: true, omrezja: [`127.0.0.0/24|${MAC_DOMA}`] });
  try {
    let naslov = "127.0.0.5";
    nastaviOmrezjeNaslovov({ vmesniki: () => ({ enp1s0: [v4(naslov)] }), izvor: async () => naslov, prehodi: async () => ({ enp1s0: MAC_TUJE }) });
    registrirajRele({ host: "127.0.0.1", port: await prostaVrata() });
    await uskladiAsistenta(o.dir);
    assert.equal((await stanjeAsistenta(o.token, o.dir)).predlogNaslova, "127.0.0.5");
    naslov = "127.0.0.9";
    await preveriNaslovAsistenta(o.dir);
    assert.equal((await stanjeAsistenta(o.token, o.dir)).predlogNaslova, "127.0.0.9");
  } finally { await pospravi(o); }
});

test("slepi pregled 21 (6): shranjen naslov na vmesniku izven odtisa (vEthernet, wg) se vrne - rezerva »naslov« poskusi znova (enkrat)", async () => {
  const o = await pripravi("192.168.77.7", { globalLink: true, omrezja: [`192.168.77.0/24|${MAC_DOMA}`] });
  try {
    let vm: NodeJS.Dict<NetworkInterfaceInfo[]> = {};
    nastaviOmrezjeNaslovov({ vmesniki: () => vm, izvor: async () => null, prehodi: async () => ({ "vEthernet (External)": MAC_DOMA }) });
    registrirajRele({ host: "127.0.0.1", port: await prostaVrata() });
    await uskladiAsistenta(o.dir);
    assert.equal((await stanjeAsistenta(o.token, o.dir)).samoGlobalLink, true);
    // lazno: vmesnik ima naslov, jedro ga ne veze (192.168.77.7) - pomembno je, da se uskladitev sprozi, in to samo enkrat
    vm = { "vEthernet (External)": [v4("192.168.77.7")] };
    assert.equal(await preveriNaslovAsistenta(o.dir), true);
    assert.equal(await preveriNaslovAsistenta(o.dir), false, "brez ponovnega zagona vsakih 30 s");
  } finally { await pospravi(o); }
});

// ------------------------------------------------------------------ N10

test("N10: odtis omrezja brez zacasnih IPv6 (ista predpona /64) in brez docker/veth; sprememba IPv4 ali prehoda ga spremeni", () => {
  const osnova = { lo: [v4("127.0.0.1")], enp1s0: [v4("192.168.1.20"), v6("fd12:3456:789a:1::1111")], docker0: [v4("172.17.0.1")], veth9: [v4("10.0.5.1")] };
  const a = odtisLan(osnova, { enp1s0: MAC_DOMA });
  assert.equal(odtisLan({ ...osnova, enp1s0: [v4("192.168.1.20"), v6("fd12:3456:789a:1::2222")] }, { enp1s0: MAC_DOMA }), a, "nov zacasni IPv6");
  assert.equal(odtisLan({ ...osnova, docker0: [v4("172.18.0.1")], vethx: [v4("10.0.6.1")] }, { enp1s0: MAC_DOMA }), a, "docker/veth");
  assert.equal(odtisLan({ ...osnova, enp1s0: [v4("192.168.1.20"), v6("2001:db8::1")] }, { enp1s0: MAC_DOMA }) === a, false, "ULA izgine");
  assert.notEqual(odtisLan({ ...osnova, enp1s0: [v4("192.168.1.21")] }, { enp1s0: MAC_DOMA }), a);
  assert.notEqual(odtisLan(osnova, { enp1s0: MAC_TUJE }), a);
});

test("N10: rezerva (samo Global Link) - nov zacasni IPv6 ne sprozi ponovnega zagona streznika in releja", async () => {
  const o = await pripravi("192.168.77.7", { globalLink: true, omrezja: [`127.0.0.0/24|${MAC_DOMA}`] });
  try {
    let ipv6 = "fd00:1:2:3::aaaa";
    nastaviOmrezjeNaslovov({ vmesniki: () => ({ wg0: [v4("10.9.0.2")], enp1s0: [v6(ipv6)] }), izvor: async () => null });
    registrirajRele({ host: "127.0.0.1", port: await prostaVrata() });
    await uskladiAsistenta(o.dir);
    assert.equal((await stanjeAsistenta(o.token, o.dir)).samoGlobalLink, true);
    ipv6 = "fd00:1:2:3::bbbb";
    assert.equal(await preveriNaslovAsistenta(o.dir), false);
  } finally { await pospravi(o); }
});

// ------------------------------------------------------------------ N3

test("N3: rezerva »vrata« - ko se vrata sprostijo, preverba preklopi na domaci naslov; dokler so zasedena, ni ponovnega zagona", async () => {
  const o = await pripravi("127.0.0.5", { globalLink: true, omrezja: [`127.0.0.0/24|${MAC_DOMA}`] });
  const zaseden = net.createServer();
  await new Promise<void>((ok, ne) => { zaseden.once("error", ne); zaseden.listen(o.vrata, "127.0.0.5", () => ok()); });
  let zaprt = false;
  try {
    nastaviOmrezjeNaslovov({ vmesniki: () => ({ enp1s0: [v4("127.0.0.5")] }), izvor: async () => "127.0.0.5", prehodi: async () => ({ enp1s0: MAC_DOMA }) });
    registrirajRele({ host: "127.0.0.1", port: await prostaVrata() });
    await uskladiAsistenta(o.dir);
    assert.equal((await stanjeAsistenta(o.token, o.dir)).napakaKoda, "vrata");
    nadzorVrat.ms = 0;
    assert.equal(await preveriNaslovAsistenta(o.dir), false, "vrata so se zasedena: brez ponovnega zagona (rele ne utripa)");
    await new Promise<void>((ok) => zaseden.close(() => ok()));
    zaprt = true;
    assert.equal(await preveriNaslovAsistenta(o.dir), true);
    const s = await stanjeAsistenta(o.token, o.dir);
    assert.equal(s.tece, true, s.napaka);
    assert.equal(s.samoGlobalLink, false);
    assert.equal(s.vrata, o.vrata);
  } finally {
    if (!zaprt) await new Promise<void>((ok) => zaseden.close(() => ok()));
    await pospravi(o);
  }
});

// ------------------------------------------------------------------ N2

function stanjeQr(naslov: string, vrata: number, koda: string): Promise<number> {
  return new Promise((ok, ne) => {
    const r = request({ host: naslov, port: vrata, path: `/api/asistent/v1/seznani?koda=${koda}`, method: "GET", rejectUnauthorized: false }, (res) => { res.resume(); ok(res.statusCode ?? 0); });
    r.once("error", ne);
    r.end();
  });
}
const kodaIzQr = (vsebina: string) => new URLSearchParams(vsebina.split("?")[1]).get("linakoda")!;

test("N2: nov QR preklice prejsnjega; zapustitev zaslona (prekliciSeznanitev) preklice neporabljeni QR", async () => {
  const o = await pripravi("127.0.0.5", { omrezja: [`127.0.0.0/24|${MAC_DOMA}`] });
  try {
    nastaviOmrezjeNaslovov({ vmesniki: () => ({ enp1s0: [v4("127.0.0.5")] }), izvor: async () => "127.0.0.5", prehodi: async () => ({ enp1s0: MAC_DOMA }) });
    await uskladiAsistenta(o.dir);
    const prvi = kodaIzQr((await zacniSeznanitev(o.token, o.dir)).vsebina);
    assert.equal(await stanjeQr("127.0.0.5", o.vrata, prvi), 200);
    const drugi = kodaIzQr((await zacniSeznanitev(o.token, o.dir)).vsebina);
    assert.equal(await stanjeQr("127.0.0.5", o.vrata, prvi), 404, "prejsnji QR ne velja vec");
    assert.equal(await stanjeQr("127.0.0.5", o.vrata, drugi), 200);
    await prekliciSeznanitev(o.token, drugi, o.dir);
    assert.equal(await stanjeQr("127.0.0.5", o.vrata, drugi), 404, "po zapustitvi zaslona QR ne velja");
    await assert.rejects(prekliciSeznanitev("napacen", drugi, o.dir));
  } finally { await pospravi(o); }
});

test("N2: zapora kode po viru - tujec z enim naslovom zaklene samo sebe; prava seznanitev z drugega vira gre naprej; skupna meja ostane", () => {
  let t = 1_700_000_000_000;
  const skupna = new VarovalkaKode({ ura: () => t / 1000, krat: SKUPNO_KRAT });
  const k = new SeznanitevSKodo({ varovalka: skupna, odtis: () => "ab".repeat(32), zdaj: () => t, koda: () => "482913" });
  const ID = "n-0123456789abcdef";
  const pb = () => Spake2.odjemalec("000000", ID, "lina-asistent").sporocilo();
  const krog = (vir: string): string => {
    try {
      k.odpri(); // nova koda za vsak krog (okno se na zaslonu odpira samo); meje na okno ne sodelujejo
      const z = k.zacni(vir, ID, "Tujec", false);
      k.spake(z.pair_id, ID, pb());
      return "ok";
    } catch (e) {
      if (e instanceof NapakaKode) return e.koda;
      throw e;
    }
  };
  const izidi: string[] = [];
  for (let i = 0; i < 25; i++) { izidi.push(krog("192.168.1.66")); t += 1000; }
  assert.ok(izidi.includes("seznanitev_zaprta"), izidi.join(","));
  assert.equal(skupna.zaprto(), false, "skupna zapora ni sprozena z enim virom");
  assert.equal(krog("192.168.1.20"), "ok", "lastnikov telefon z drugega naslova ni zaklenjen");
  // skupna meja cez vse vire ostane (napadalec z mnogo naslovi) - natanko SKUPNO_KRAT * POSKUSOV neuspelih krogov (slepi pregled 21, najdba 12)
  const g = new VarovalkaKode({ ura: () => t / 1000, krat: SKUPNO_KRAT });
  let n = 0;
  while (g.poskus(`10.0.${n}.1`) && n < 10_000) n++;
  assert.equal(n + 1, SKUPNO_KRAT * POSKUSOV);
  assert.equal(SKUPNO_KRAT, 3, "visja skupna meja je odlocitev lastnika (POROCILO-21)");
  // IPv6: vsi naslovi iste predpone /64 so en vir (SLAAC da napadalcu neomejeno naslovov)
  assert.equal(kljucVira("fd00:1:2:3::aaaa"), kljucVira("fd00:1:2:3:dead:beef:0:1"));
  assert.notEqual(kljucVira("fd00:1:2:4::1"), kljucVira("fd00:1:2:3::1"));
  assert.equal(kljucVira("192.168.1.66"), "192.168.1.66");
  assert.equal(kljucVira("::ffff:192.168.1.66"), "::ffff:192.168.1.66");
  // skozi SeznanitevSKodo: napadalec, ki za vsak krog vzame nov IPv6 iz iste /64, se zaklene kot en vir (slepi pregled 21b, 4)
  const skupna2 = new VarovalkaKode({ ura: () => t / 1000, krat: SKUPNO_KRAT });
  const k2 = new SeznanitevSKodo({ varovalka: skupna2, odtis: () => "ab".repeat(32), zdaj: () => t, koda: () => "482913" });
  const izidi6: string[] = [];
  for (let i = 0; i < 25; i++) {
    try { k2.odpri(); const z = k2.zacni(`fd00:1:2:3::${(i + 1).toString(16)}`, ID, "Tujec", false); k2.spake(z.pair_id, ID, pb()); izidi6.push("ok"); }
    catch (e) { if (!(e instanceof NapakaKode)) throw e; izidi6.push(e.koda); }
    t += 1000;
  }
  assert.ok(izidi6.includes("seznanitev_zaprta"), izidi6.join(","));
  assert.equal(skupna2.zaprto(), false);
});

test("N2: »Dodaj« za cakajoci telefon je izrecen klik - ime in id sta vidna, gumb ni privzet (ni v obrazcu, brez autoFocus)", async () => {
  const ui = await readFile(new URL("../../components/povezi-telefon.tsx", import.meta.url), "utf8");
  const blok = ui.slice(ui.indexOf("s.cakajo.map("), ui.indexOf("</div>\n        );\n      })}"));
  assert.match(blok, /<strong>\{c\.ime\}<\/strong>/);
  assert.match(blok, /<IdTelefona id=\{c\.id\} \/>/);
  assert.match(blok, /<button type="button"[^>]*onClick=\{\(\) => onDodaj\(c\)\}/);
  assert.doesNotMatch(blok, /<form|autoFocus|autofocus/);
  assert.match(ui, /void prekliciSeznanitevFn\(\{ data: \{ koda: mojQr\.current \} \}\)\.catch/, "zapustitev zaslona preklice svoj QR (CRR2)");
});

// ------------------------------------------------------------------ N4

/**
 * CRR3: tuj PID izbran s preverbo, da signal res vrne EPERM (PID 1 je v vsebniku brez root lahko proces istega uporabnika); brez takega
 * procesa (root, en sam uporabnik v imenskem prostoru) del s tujim PID odpade, nadzor z lastnim procesom tece vedno.
 */
function tujPid(): number | null {
  for (const x of readdirSync("/proc")) {
    const pid = Number(x);
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    try { process.kill(pid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === "EPERM") return pid; }
  }
  return null;
}

test("N4: PID tujega procesa (EPERM) po roku odpiranja ne blokira nove seje; isti zivi proces (cas zagona) jo blokira", { skip: casZagonaProcesa(process.pid) === null ? "brez /proc" : false }, async (tc) => {
  const root = await mkdtemp(path.join(tmpdir(), "lina-n21-seja-"));
  const dom = await mkdtemp(path.join(tmpdir(), "lina-n21-dom-"));
  const tuj = tujPid();
  if (tuj === null) tc.diagnostic("ni procesa z EPERM: preverjen samo lastni proces");
  try {
    for (const [pid, pricakovano] of [...(tuj === null ? [] : [[tuj, 2] as const]), [process.pid, 1] as const]) {
      ponastaviSejo(root);
      let t = 1_000_000;
      let zagonov = 0;
      const o = { najdi: (ime: string) => (ime === "xterm" || ime === "claude" ? `/usr/bin/${ime}` : null), platforma: "linux" as const, dom, zdaj: () => t,
        zazeni: async () => { zagonov += 1; return pid; } };
      assert.deepEqual(await odpriSejoClaude(root, o), { ok: true });
      t += ROK_ODPIRANJA_MS + 1;
      await odpriSejoClaude(root, o);
      assert.equal(zagonov, pricakovano, `PID ${pid}`);
    }
    assert.notEqual(casZagonaProcesa(process.pid), null);
  } finally {
    ponastaviSejo(root);
    await rm(root, { recursive: true, force: true });
    await rm(dom, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ N6

test("N6: stevec slik naloge gre ob koncu naloge iz pomnilnika", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lina-n21-ork-"));
  try {
    const slika = orodjaLine(root, { slike: { mozgani: async () => ({ provider: "openrouter" }) } }).find((x) => x.definicija.ime === "ustvari_sliko")!;
    let i = 0;
    const model: KlicModela = async () => (i++ === 0
      ? { ok: true, besedilo: "", klici: [{ id: "k1", ime: "ustvari_sliko", argumenti: { opis: "pes na travniku" } }], usage: { vhod: 1, izhod: 1, predpomnjeni: 0 }, razlogKonca: "orodje" }
      : { ok: true, besedilo: "Koncano.", klici: [], usage: { vhod: 1, izhod: 1, predpomnjeni: 0 }, razlogKonca: "konec" });
    const ork = ustvariOrkestrator(root, { oceni: null, ucenje: null, imaGeslo: async () => true, klicModela: model, orodja: [slika] });
    const prej = nalogSStevcemSlik();
    const n = await ork.nova({ cilj: "Narisi psa." });
    const s = await ork.teci(n.id);
    assert.equal(s.faza, "koncano");
    assert.ok(i >= 2, "model je poklical orodje");
    assert.equal(nalogSStevcemSlik(), prej, "vnos naloge je pociscen");
  } finally { await rm(root, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ N9

test("N9: vsaka pokvarjena knjiznica dobi svojo kopijo (prejsnja se ne prepise)", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lina-n21-slike-"));
  try {
    const pot = path.join(root, DATOTEKA_SLIK);
    const zapis = (id: string) => ({ id, serija: "s", cas: "2026-11-26T00:00:00Z", opis: "", poziv: "", prevedeno: false, model: "m", datoteka: `${id}.png`, bajtov: 1 });
    await writeFile(pot, JSON.stringify({ slike: "prva" }));
    await dodajVKnjiznico(root, [zapis("aaaaaaaaaaa1")]);
    await writeFile(pot, "{ne-json");
    await preberiKnjiznico(root);
    await writeFile(pot, JSON.stringify([1, 2]));
    await dodajVKnjiznico(root, [zapis("aaaaaaaaaaa2")]);
    const kopije = (await readdir(root)).filter((x) => x.startsWith(`${DATOTEKA_SLIK}.pokvarjen`)).sort();
    assert.equal(kopije.length, 3, kopije.join(","));
    const vsebine = await Promise.all(kopije.map((x) => readFile(path.join(root, x), "utf8")));
    assert.deepEqual(vsebine.sort(), [JSON.stringify([1, 2]), JSON.stringify({ slike: "prva" }), "{ne-json"].sort());
    assert.deepEqual((await preberiKnjiznico(root)).slike.map((x) => x.id), ["aaaaaaaaaaa2"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
