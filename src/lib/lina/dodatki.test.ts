import assert from "node:assert/strict";
import { test } from "node:test";
import { DODATKI, nastaviPreverjanjeVrat, stanjeDodatka, uskladiDodatke, ukazZagona, ustaviDodatek, zagnaniDodatek, type Izvajalec } from "./dodatki.server.ts";

nastaviPreverjanjeVrat(async () => true);

function lazni(stanje: Record<string, string>, klici: string[][]): Izvajalec {
  return async (args) => {
    klici.push(args);
    if (args[0] === "container" && args[1] === "inspect") {
      const ime = args[args.length - 1];
      return ime in stanje ? { koda: 0, izhod: stanje[ime] } : { koda: 1, izhod: "No such object" };
    }
    if (args[0] === "run") return { koda: 0, izhod: "id" };
    return { koda: 0, izhod: "" };
  };
}

test("zagon poveze samo 127.0.0.1 in izklopi telemetrijo n8n", () => {
  const args = ukazZagona(DODATKI.n8n!);
  assert.ok(args.includes("127.0.0.1:5678:5678"));
  assert.ok(args.includes("N8N_DIAGNOSTICS_ENABLED=false"));
  assert.ok(!args.some((a) => a.startsWith("0.0.0.0")));
});

test("Paperclip tece v vsebniku Node 24 kot uporabnik node", () => {
  const args = ukazZagona(DODATKI.paperclip!);
  assert.ok(args.includes("node:24-slim"));
  assert.ok(args.join(" ").includes("su -s /bin/sh node"));
});

test("vklopljen dodatek se zazene, izklopljen ustavi", async () => {
  const klici: string[][] = [];
  const izid = await uskladiDodatke({ n8n: true, paperclip: false }, lazni({ "lina-dodatek-paperclip": "running" }, klici));
  assert.equal(izid.n8n, "se_zaganja");
  assert.equal(izid.paperclip, "izklopljen");
  assert.ok(klici.some((k) => k[0] === "run"));
  assert.ok(klici.some((k) => k[0] === "stop" && k[1] === "lina-dodatek-paperclip"));
});

test("zaustavljen vsebnik se znova zazene, tekoci ostane", async () => {
  const klici: string[][] = [];
  assert.equal(await zagnaniDodatek("n8n", lazni({ "lina-dodatek-n8n": "exited" }, klici)), "se_zaganja");
  assert.deepEqual(klici.at(-1), ["start", "lina-dodatek-n8n"]);
  const k2: string[][] = [];
  assert.equal(await zagnaniDodatek("n8n", lazni({ "lina-dodatek-n8n": "running" }, k2)), "deluje".replace("deluje", "deluje"));
  assert.ok(!k2.some((k) => k[0] === "run"));
});

test("neuspel zagon pove napako, AFFiNE ni na voljo", async () => {
  const klici: string[][] = [];
  const izv: Izvajalec = async (a) => (a[1] === "inspect" ? { koda: 1, izhod: "" } : { koda: 125, izhod: "docker napaka" });
  assert.equal(await zagnaniDodatek("n8n", izv), "napaka");
  assert.equal(await stanjeDodatka("affine", lazni({}, klici)), "ni_na_voljo");
  assert.equal(await ustaviDodatek("affine", lazni({}, klici)), "ni_na_voljo");
});

test("tekoc vsebnik brez odgovora na vratih je »se_zaganja«, ne »deluje«", async () => {
  const prej = nastaviPreverjanjeVrat(async () => false);
  try {
    assert.equal(await stanjeDodatka("n8n", lazni({ "lina-dodatek-n8n": "running" }, [])), "se_zaganja");
  } finally {
    nastaviPreverjanjeVrat(prej);
  }
});

test("ustvarjen, a nezagnan vsebnik dobi ukaz start", async () => {
  const klici: string[][] = [];
  assert.equal(await zagnaniDodatek("n8n", lazni({ "lina-dodatek-n8n": "created" }, klici)), "se_zaganja");
  assert.deepEqual(klici.at(-1), ["start", "lina-dodatek-n8n"]);
});

test("mrtev vsebnik se odstrani in ustvari znova (nosilec ostane)", async () => {
  const klici: string[][] = [];
  assert.equal(await zagnaniDodatek("n8n", lazni({ "lina-dodatek-n8n": "dead" }, klici)), "se_zaganja");
  const ukazi = klici.map((k) => k[0]);
  assert.deepEqual(ukazi.slice(-2), [["r", "m"].join(""), "run"]);
  assert.ok(!klici.some((k) => k[0] === "volume"));
  assert.ok(!klici.some((k) => k[0] === "start"));
});

test("nedosegljiv Docker ni potrditev izklopa", async () => {
  const klici: string[][] = [];
  const izv: Izvajalec = async (a) => {
    klici.push(a);
    return { koda: 1, izhod: "Cannot connect to the Docker daemon" };
  };
  assert.equal(await stanjeDodatka("n8n", izv), "napaka");
  assert.equal(await ustaviDodatek("n8n", izv), "napaka");
  assert.ok(!klici.some((k) => k[0] === "stop"));
});
