// Naloga 24b: najdbe CodeRabbit r2 na racunalniku 0.2.14 (CRR1-CRR8, slepi-0214/coderabbit-r2-najdbe.md). Vsak preizkus je dokaz:
// DRZI = brez popravka pade; NE DRZI = preverba, ki pokaze, da koda ze ravna prav. Lazno omrezje: vmesnik »enp1s0« z naslovi 127.0.0.x.
// Komentarji brez sumnikov.
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { request } from "node:https";
import net from "node:net";
import { tmpdir, type NetworkInterfaceInfo } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setupOwner } from "./auth.server.ts";
import {
  NASTAVITVE_ASISTENTA, nastaviOmrezjeNaslovov, ponastaviAsistenta, prekliciSeznanitev, preveriNaslovAsistenta, registrirajRele,
  registrirajVezoKlicev, stanjeAsistenta, uskladiAsistenta, zacniSeznanitev,
} from "./asistent-telefon.server.ts";
import { izmenjajSinhron, preveriZahtevo } from "./sinhron-telefon.server.ts";
import { DATOTEKA_SLIK, dodajVKnjiznico, preberiKnjiznico } from "./slike-knjiznica.server.ts";

process.env.LINA_LLM = "0";
const v4 = (address: string, netmask = "255.255.255.0") => ({ address, family: "IPv4", internal: false, netmask, mac: "00:00:00:00:00:00", cidr: null }) as NetworkInterfaceInfo;
const MAC_DOMA = "aa:bb:cc:00:00:01";

async function prostaVrata(): Promise<number> {
  return await new Promise<number>((ok, ne) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); });
    s.once("error", ne);
  });
}

type Okolje = { dir: string; token: string; vrata: number };
async function pripravi(naslov: string, omrezja: string[], globalLink = true): Promise<Okolje> {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-n24b-"));
  const token = await setupOwner("geslo-test-1234", dir, { address: "127.0.0.1" });
  const vrata = await prostaVrata();
  await writeFile(path.join(dir, NASTAVITVE_ASISTENTA), JSON.stringify({ vklop: true, naslov, vrata, imena: {}, ocenaIzida: true, globalLink, omrezja }));
  registrirajVezoKlicev({ zagotovi: async () => undefined, ustavi: async () => undefined });
  return { dir, token, vrata };
}
async function pospravi(o: Okolje): Promise<void> {
  nastaviOmrezjeNaslovov(null);
  registrirajRele(null);
  registrirajVezoKlicev(null);
  await ponastaviAsistenta();
  await rm(o.dir, { recursive: true, force: true });
}
const shranjeno = async (o: Okolje) => JSON.parse(await readFile(path.join(o.dir, NASTAVITVE_ASISTENTA), "utf8")) as { naslov: string };

// ------------------------------------------------------------------ CRR1

test("CRR1: rezerva »vrata«, shranjeni naslov izgine, drug naslov v odobrenem omrezju - nadzor mu sledi (brez cakanja na preverbo vrat)", async () => {
  const o = await pripravi("127.0.0.5", [`127.0.0.0/24|${MAC_DOMA}`]);
  const zaseden = net.createServer();
  await new Promise<void>((ok, ne) => { zaseden.once("error", ne); zaseden.listen(o.vrata, "127.0.0.5", () => ok()); });
  try {
    let vm: NodeJS.Dict<NetworkInterfaceInfo[]> = { enp1s0: [v4("127.0.0.5")] };
    nastaviOmrezjeNaslovov({ vmesniki: () => vm, izvor: async () => vm.enp1s0![0].address, prehodi: async () => ({ enp1s0: MAC_DOMA }) });
    registrirajRele({ host: "127.0.0.1", port: await prostaVrata() });
    await uskladiAsistenta(o.dir);
    assert.equal((await stanjeAsistenta(o.token, o.dir)).napakaKoda, "vrata");
    // vrata ostanejo zasedena na starem naslovu; vmesnik dobi nov naslov v istem (odobrenem) omrezju
    vm = { enp1s0: [v4("127.0.0.6")] };
    assert.equal(await preveriNaslovAsistenta(o.dir), true, "izginotje naslova sprozi uskladitev tudi v rezervi »vrata«");
    assert.equal((await shranjeno(o)).naslov, "127.0.0.6");
    const s = await stanjeAsistenta(o.token, o.dir);
    assert.equal(s.tece, true, s.napaka);
    assert.equal(s.samoGlobalLink, false);
    // naslov ostane, vrata ostanejo zasedena: rezerva se ohrani, brez ponovnega zagona vsakih 30 s (N3)
    assert.equal(await preveriNaslovAsistenta(o.dir), false);
  } finally {
    await new Promise<void>((ok) => zaseden.close(() => ok()));
    await pospravi(o);
  }
});

// ------------------------------------------------------------------ CRR2

function stanjeQr(naslov: string, vrata: number, koda: string): Promise<number> {
  return new Promise((ok, ne) => {
    const r = request({ host: naslov, port: vrata, path: `/api/asistent/v1/seznani?koda=${koda}`, method: "GET", rejectUnauthorized: false }, (res) => { res.resume(); ok(res.statusCode ?? 0); });
    r.once("error", ne);
    r.end();
  });
}

test("CRR2: zaslon, ki odide, preklice samo SVOJ QR - QR drugega zaslona ostane veljaven; cakajoce prijave ostanejo", async () => {
  const o = await pripravi("127.0.0.5", [`127.0.0.0/24|${MAC_DOMA}`], false);
  try {
    nastaviOmrezjeNaslovov({ vmesniki: () => ({ enp1s0: [v4("127.0.0.5")] }), izvor: async () => "127.0.0.5", prehodi: async () => ({ enp1s0: MAC_DOMA }) });
    await uskladiAsistenta(o.dir);
    const a = await zacniSeznanitev(o.token, o.dir); // zaslon A (odgovor pride pozno)
    const b = await zacniSeznanitev(o.token, o.dir); // zaslon B prikaze nov QR
    assert.equal(typeof a.koda, "string");
    assert.match(b.vsebina, new RegExp(`linakoda=${b.koda}(&|$)`), "koda povabila je koda v QR");
    await prekliciSeznanitev(o.token, a.koda, o.dir); // A odide
    assert.equal(await stanjeQr("127.0.0.5", o.vrata, b.koda), 200, "QR zaslona B velja naprej");
    await prekliciSeznanitev(o.token, undefined, o.dir);
    assert.equal(await stanjeQr("127.0.0.5", o.vrata, b.koda), 200, "preklic brez kode ne preklice tujih QR");
    await prekliciSeznanitev(o.token, b.koda, o.dir);
    assert.equal(await stanjeQr("127.0.0.5", o.vrata, b.koda), 404, "B odide: njegov QR ne velja");
    await assert.rejects(prekliciSeznanitev("napacen", b.koda, o.dir));
  } finally { await pospravi(o); }
});

test("CRR2: zaslon hrani kodo svojega QR in ob odhodu preklice samo njo", async () => {
  const ui = await readFile(new URL("../../components/povezi-telefon.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(ui, /prekliciSeznanitevFn\(\)/, "preklic brez kode bi preklical QR drugega zaslona");
  assert.match(ui, /else void prekliciSeznanitevFn\(\{ data: \{ koda: p\.koda \} \}\)/);
  assert.match(ui, /void prekliciSeznanitevFn\(\{ data: \{ koda: mojQr\.current \} \}\)/);
  const fn = await readFile(new URL("./functions.ts", import.meta.url), "utf8");
  assert.match(fn, /await prekliciSeznanitev\(await sessionToken\(\), data\?\.koda\)/);
});

// ------------------------------------------------------------------ CRR5

test("CRR5: rezerva »omrezje«, maska se spremeni (/24 -> /16) in omrezje postane odobreno - nadzor uskladi (odtis nosi masko)", async () => {
  const o = await pripravi("127.0.0.5", [`127.0.0.0/16|${MAC_DOMA}`]);
  try {
    let maska = "255.255.255.0";
    nastaviOmrezjeNaslovov({ vmesniki: () => ({ enp1s0: [v4("127.0.0.5", maska)] }), izvor: async () => "127.0.0.5", prehodi: async () => ({ enp1s0: MAC_DOMA }) });
    registrirajRele({ host: "127.0.0.1", port: await prostaVrata() });
    await uskladiAsistenta(o.dir);
    assert.equal((await stanjeAsistenta(o.token, o.dir)).napakaKoda, "omrezje");
    maska = "255.255.0.0";
    assert.equal(await preveriNaslovAsistenta(o.dir), true, "isti naslov in prehod, druga maska = drugo omrezje");
    const s = await stanjeAsistenta(o.token, o.dir);
    assert.equal(s.tece, true, s.napaka);
    assert.equal(await preveriNaslovAsistenta(o.dir), false, "nespremenjeno omrezje: rele ne utripa");
  } finally { await pospravi(o); }
});

test("CRR5 (varnostna smer, NE DRZI): tekoci streznik doma se ustavi, ko maska omrezje naredi neodobreno - preverba ni vezana na odtis", async () => {
  const o = await pripravi("127.0.0.5", [`127.0.0.0/24|${MAC_DOMA}`], false);
  try {
    let maska = "255.255.255.0";
    nastaviOmrezjeNaslovov({ vmesniki: () => ({ enp1s0: [v4("127.0.0.5", maska)] }), izvor: async () => "127.0.0.5", prehodi: async () => ({ enp1s0: MAC_DOMA }) });
    await uskladiAsistenta(o.dir);
    assert.equal((await stanjeAsistenta(o.token, o.dir)).tece, true);
    maska = "255.255.0.0";
    await preveriNaslovAsistenta(o.dir);
    await preveriNaslovAsistenta(o.dir);
    const s = await stanjeAsistenta(o.token, o.dir);
    assert.equal(s.tece, false, "druga zaporedna preverba neodobrenega omrezja ustavi poslusanje doma");
    assert.equal(s.napakaKoda, "omrezje");
  } finally { await pospravi(o); }
});

// ------------------------------------------------------------------ CRR6

test("CRR6: neberljiv pravila.json (tudi JSON, ki ni objekt) - odgovor ne nosi rokHrambeDni; manjkajoca datoteka = privzetih 90", async () => {
  const ZDAJ = Date.parse("2026-11-26T09:00:00.000Z");
  const zahteva = () => preveriZahtevo(JSON.parse(JSON.stringify({ rev: 0, klici: [], pogovor: [], navodila: null, epoha: null, izbrisani: [] })), ZDAJ);
  const koren = await mkdtemp(path.join(tmpdir(), "lina-n24b-pravila-"));
  try {
    // prej je pravila.json nosil 365 dni; pokvarjen ne sme telefonu poslati zasilnih 90 (telefon bi brisal zapise 90-365 dni)
    for (const vsebina of ["{ \"zapiskiHrambaDni\": 365, ", "", "null", "[]", "\"365\"", "365"]) {
      const dir = await mkdtemp(path.join(koren, "d-"));
      await writeFile(path.join(dir, "pravila.json"), vsebina);
      const o = await izmenjajSinhron(zahteva(), dir, { zdaj: () => ZDAJ });
      assert.equal("rokHrambeDni" in o, false, `${JSON.stringify(vsebina)}: ${JSON.stringify(o)}`);
    }
    const prazna = await mkdtemp(path.join(koren, "brez-"));
    const o = await izmenjajSinhron(zahteva(), prazna, { zdaj: () => ZDAJ });
    assert.equal(o.rokHrambeDni, 90, "pravil se ni = privzeti rok");
  } finally { await rm(koren, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ CRR7, CRR8

const zapis = (id: string) => ({ id, serija: "s", cas: "2026-11-26T00:00:00Z", opis: "", poziv: "", prevedeno: false, model: "m", datoteka: `${id}.png`, bajtov: 1 });

test("CRR7 (NE DRZI): dva zaporedna neveljavna JSON skozi dodajVKnjiznico - dve kopiji z lastnim imenom, brez skupne .pokvarjen, zapis uspe", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lina-n24b-slike-"));
  try {
    const pot = path.join(root, DATOTEKA_SLIK);
    await writeFile(pot, "{prvi-ne-json");
    await dodajVKnjiznico(root, [zapis("aaaaaaaaaaa1")]);
    await writeFile(pot, "{drugi-ne-json");
    await dodajVKnjiznico(root, [zapis("aaaaaaaaaaa2")]);
    const datoteke = await readdir(root);
    assert.equal(datoteke.includes(`${DATOTEKA_SLIK}.pokvarjen`), false, "skupni readJsonFile ne premika (brez premakniPokvarjen)");
    const kopije = datoteke.filter((x) => x.startsWith(`${DATOTEKA_SLIK}.pokvarjen-`));
    assert.deepEqual((await Promise.all(kopije.map((x) => readFile(path.join(root, x), "utf8")))).sort(), ["{drugi-ne-json", "{prvi-ne-json"]);
    assert.deepEqual((await preberiKnjiznico(root)).slike.map((x) => x.id), ["aaaaaaaaaaa2"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("CRR8: branje s premikom pokvarjene knjiznice hkrati z zapisom - ziva knjiznica ne izgine, zapis ne pade, en premik", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lina-n24b-slike-"));
  try {
    const pot = path.join(root, DATOTEKA_SLIK);
    for (let i = 0; i < 40; i++) {
      await writeFile(pot, JSON.stringify({ slike: `pokvarjeno-${i}` }));
      const id = `b${String(i).padStart(11, "0")}`;
      const izidi = await Promise.allSettled([preberiKnjiznico(root), dodajVKnjiznico(root, [zapis(id)]), preberiKnjiznico(root)]);
      assert.equal(izidi[1].status, "fulfilled", `krog ${i}: zapis ${izidi[1].status === "rejected" ? String(izidi[1].reason) : ""}`);
      const k = JSON.parse(await readFile(pot, "utf8").catch(() => "null")) as { slike?: Array<{ id: string }> } | null;
      assert.equal(k?.slike?.[0]?.id, id, `krog ${i}: ziva knjiznica nosi nov zapis`);
    }
    const kopije = (await readdir(root)).filter((x) => x.startsWith(`${DATOTEKA_SLIK}.pokvarjen-`));
    assert.equal(kopije.length, 40, "vsaka pokvarjenost natanko ena kopija (bralec ne premakne nove knjiznice)");
    for (const x of kopije) assert.match(await readFile(path.join(root, x), "utf8"), /pokvarjeno-\d+/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
