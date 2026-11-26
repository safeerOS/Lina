/**
 * Naloga 31: Lina sama namesti OmniRoute. Preizkus v izolirani mapi z NADOMESTNIM registrom (lazen npm v pravem tgz, sha512
 * izracunan iz datoteke) in laznim OmniRoute (pravi http streznik na zanki). Preveri: pripet npm in integriteta, zaklepna
 * datoteka Line, --ignore-scripts, okolje brez kljucev Line, poslusanje samo 127.0.0.1, kljuc ustvari Lina, Mozgani nastavljeni
 * brez soglasja za klice, odstrani samo svojo mapo. Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import net, { type AddressInfo } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { readBrain, saveBrain } from "./keys.server.ts";
import {
  korenOmniroute,
  namestiOmniroute,
  NPM_PRIPET,
  odstraniOmniroute,
  OMNIROUTE_RAZLICICA,
  pocakajNamestitev,
  privzeteOdvisnosti,
  stanjeNamestitve,
  ustaviOmniroute,
  zazeniObZagonu,
  type Odvisnosti,
} from "./omniroute-namestitev.server.ts";
import ZAKLEP from "./omniroute-zaklep.json" with { type: "json" };

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-n31n-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const LAZNI_KLJUC = "sk-lazni-kljuc-0031";

// Lazen OmniRoute (ga ustvari lazni »npm ci«): prijava z geslom iz okolja, kljuc samo s piskotkom, /v1 samo s kljucem.
const LAZNI_STREZNIK = `import http from "node:http"; import fs from "node:fs"; import path from "node:path";
fs.writeFileSync(path.join(process.env.HOME, "..", "streznik-okolje.json"), JSON.stringify(process.env));
fs.appendFileSync(path.join(process.env.HOME, "..", "zagoni.txt"), "z\\n");
const s = http.createServer(async (req, res) => {
  let b = ""; for await (const c of req) b += c;
  const json = (st, o, glave = {}) => res.writeHead(st, { "content-type": "application/json", ...glave }).end(JSON.stringify(o));
  if (req.url === "/api/auth/login" && req.method === "POST") {
    return JSON.parse(b || "{}").password === process.env.INITIAL_PASSWORD ? json(200, { success: true }, { "set-cookie": "auth_token=abc; Path=/; HttpOnly" }) : json(401, {});
  }
  if (req.url === "/api/keys" && req.method === "POST") return (req.headers.cookie || "").includes("auth_token=abc") ? json(201, { key: "${LAZNI_KLJUC}" }) : json(401, {});
  const ok = req.headers.authorization === "Bearer ${LAZNI_KLJUC}";
  if (req.url === "/v1/models") return ok ? json(200, { data: [{ id: "auto" }, { id: "kr/claude-sonnet" }] }) : json(401, { error: "Invalid API key" });
  if (req.url === "/v1/chat/completions") return ok ? json(200, { choices: [{ message: { content: "da" } }] }) : json(401, {});
  json(404, {});
});
s.listen(Number(process.env.PORT), process.env.HOSTNAME);`;

// Lazen npm-cli.js: zapise klic; ob »ci« ustvari drevo, kot ga da pravi npm (omniroute/dist, sql.js, node-machine-id, playwright).
const LAZNI_NPM = `const fs = require("fs"), path = require("path");
const zapis = path.join(process.env.HOME, "..", "npm-klici.json");
const prej = fs.existsSync(zapis) ? JSON.parse(fs.readFileSync(zapis, "utf8")) : [];
prej.push({ argv: process.argv.slice(2), cwd: process.cwd(), env: Object.keys(process.env) });
fs.writeFileSync(zapis, JSON.stringify(prej));
if (process.argv[2] === "ci") {
  const nm = path.join(process.cwd(), "node_modules");
  fs.mkdirSync(path.join(nm, "omniroute", "dist"), { recursive: true });
  fs.writeFileSync(path.join(nm, "omniroute", "dist", "server-ws.mjs"), ${JSON.stringify(LAZNI_STREZNIK)});
  for (const p of ["sql.js", "node-machine-id"]) { fs.mkdirSync(path.join(nm, p), { recursive: true }); fs.writeFileSync(path.join(nm, p, "package.json"), "{}"); }
  fs.mkdirSync(path.join(nm, "playwright"), { recursive: true });
  fs.writeFileSync(path.join(nm, "playwright", "cli.js"), 'const fs=require("fs"),path=require("path");fs.writeFileSync(path.join(process.env.HOME,"..","pw-klic.json"),JSON.stringify({argv:process.argv.slice(2),pot:process.env.PLAYWRIGHT_BROWSERS_PATH}));if(fs.existsSync(path.join(process.env.HOME,"..","..","pw-pade")))process.exit(1)');
}`;

let register: Server;
let reg = "";
let tgz: Buffer;
let pokvarjen = false;
let vrata = 0;

async function prostaVrata(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  const v = (s.address() as AddressInfo).port;
  await new Promise<void>((ok) => s.close(() => ok()));
  return v;
}

function odvisnosti(): Odvisnosti {
  return {
    ...privzeteOdvisnosti(),
    izvrsljivo: process.execPath,
    register: reg,
    vrata,
    rokZagonaMs: 15_000,
    prostor: async () => 1e12,
    npm: { razlicica: NPM_PRIPET.razlicica, sha512: createHash("sha512").update(tgz).digest("base64") },
  };
}

async function nova(): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  process.env.LINA_DATA = dir;
  return { dir, token: await setupOwner("geslo-test-1234", dir) };
}

function json<T>(p: string): T {
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

before(async () => {
  const pkg = path.join(KOREN, "npm-paket");
  mkdirSync(path.join(pkg, "package", "bin"), { recursive: true });
  writeFileSync(path.join(pkg, "package", "bin", "npm-cli.js"), LAZNI_NPM);
  execFileSync("tar", ["-czf", path.join(KOREN, "npm.tgz"), "-C", pkg, "package"]);
  tgz = readFileSync(path.join(KOREN, "npm.tgz"));
  register = createServer((req, res) => {
    if (req.url === `/npm/-/npm-${NPM_PRIPET.razlicica}.tgz`) {
      const vsebina = pokvarjen ? Buffer.concat([tgz, Buffer.from("x")]) : tgz;
      res.writeHead(200, { "content-type": "application/octet-stream" }).end(vsebina);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((ok) => register.listen(0, "127.0.0.1", ok));
  reg = `http://127.0.0.1:${(register.address() as AddressInfo).port}`;
  vrata = await prostaVrata();
  process.env.GEMINI_API_KEY = "AIza-izmisljen-kljuc-lastnika-0031";
});

after(async () => {
  await ustaviOmniroute();
  delete process.env.GEMINI_API_KEY;
  await new Promise<void>((ok) => register.close(() => ok()));
});

describe("naloga 31: Lina namesti OmniRoute (nadomestni register)", () => {
  let dir = "";
  let token = "";

  it("zaklepna datoteka pripne omniroute 3.8.54 z integriteto iz registra; vsi paketi imajo integriteto in uradni register", () => {
    const p = (ZAKLEP as { packages: Record<string, { version?: string; integrity?: string; resolved?: string; link?: boolean; dependencies?: Record<string, string> }> }).packages;
    assert.equal(p[""]?.dependencies?.omniroute, OMNIROUTE_RAZLICICA, "brez ^ ali latest");
    assert.equal(p["node_modules/omniroute"]?.version, OMNIROUTE_RAZLICICA);
    assert.equal(p["node_modules/omniroute"]?.integrity, "sha512-CwAq+cK1fm2EnWqHCvQObfR+ACAEbEGQvgOGf/Fe0HxWRPvBqLO3+8Kry852g+q65nLBavcUAx/3zgMNkNdhAQ==");
    const brez = Object.entries(p).filter(([k, v]) => k && !v.link && (!v.integrity?.startsWith("sha512-") || !v.resolved?.startsWith("https://registry.npmjs.org/")));
    assert.deepEqual(brez.map(([k]) => k), []);
  });

  it("namestitev: koraki uspejo, npm ci --ignore-scripts z zaklepno datoteko Line, Mozgani nastavljeni brez soglasja za klice", async () => {
    ({ dir, token } = await nova());
    await namestiOmniroute(token, dir, odvisnosti());
    await pocakajNamestitev();
    const st = await stanjeNamestitve(token, dir);
    assert.equal(st.napaka, null);
    assert.equal(st.pripravljeno, true);
    assert.deepEqual(st.koraki.map((k) => k.stanje), ["uspeh", "uspeh", "uspeh", "uspeh"]);
    assert.equal(st.namescen, true);
    assert.equal(st.naslov, `http://127.0.0.1:${vrata}/v1`);
    const koren = korenOmniroute(dir);
    const klici = json<{ argv: string[]; env: string[] }[]>(path.join(koren, "npm-klici.json"));
    assert.equal(klici.length, 1);
    assert.equal(klici[0]!.argv[0], "ci");
    for (const z of ["--ignore-scripts", "--omit=dev", "--no-audit", `--registry=${reg}/`]) assert.ok(klici[0]!.argv.includes(z), z);
    assert.ok(!klici[0]!.env.includes("GEMINI_API_KEY") && !klici[0]!.env.includes("LINA_DATA"), "npm ne dobi kljucev ali okolja Line");
    assert.deepEqual(json(path.join(koren, "app", "package-lock.json")), ZAKLEP);
    assert.deepEqual(json<{ dependencies: unknown }>(path.join(koren, "app", "package.json")).dependencies, { omniroute: OMNIROUTE_RAZLICICA });
    const pw = json<{ argv: string[]; pot: string }>(path.join(koren, "pw-klic.json"));
    assert.deepEqual(pw.argv, ["install", "--only-shell", "chromium"]);
    assert.equal(pw.pot, path.join(koren, "brskalniki"));
    assert.ok(existsSync(path.join(koren, "app", "node_modules", "omniroute", "dist", "node_modules", "sql.js")), "namesto postinstall");
    assert.equal(existsSync(path.join(koren, "prenos")), false, "predpomnilnik npm pospravljen");
    const b = await readBrain(token, dir);
    const om = b.shranjeni?.find((p) => p.provider === "omniroute");
    assert.equal(om?.naslov, `http://127.0.0.1:${vrata}/v1`);
    assert.equal(existsSync(path.join(dir, "kljuci.json")), false, "soglasja za klice Lina ne vklopi sama");
    const surovo = readFileSync(path.join(dir, "omniroute-lokalno.json"), "utf8");
    assert.doesNotMatch(surovo, new RegExp(LAZNI_KLJUC));
  });

  it("streznik OmniRoute: okolje samo z dovoljenega seznama (brez kljucev Line), kljuc API obvezen, geslo nastavi Lina", () => {
    const env = json<Record<string, string>>(path.join(korenOmniroute(dir), "streznik-okolje.json"));
    assert.equal(env.HOSTNAME, "127.0.0.1");
    assert.equal(env.OMNIROUTE_SERVER_HOST, "127.0.0.1");
    assert.equal(env.REQUIRE_API_KEY, "true");
    assert.equal(env.GEMINI_API_KEY, undefined);
    assert.equal(env.LINA_DATA, undefined);
    assert.ok(env.DATA_DIR?.startsWith(korenOmniroute(dir)), "podatki v mapi Line, ne ~/.omniroute");
    assert.ok((env.INITIAL_PASSWORD ?? "").length >= 24 && env.INITIAL_PASSWORD !== "CHANGEME");
    assert.ok(env.HOME?.startsWith(korenOmniroute(dir)));
  });

  it("poslusa samo zanko: na naslovu omrezne kartice vrata niso dosegljiva", async (t) => {
    const ip = Object.values(networkInterfaces())
      .flat()
      .find((a) => a && a.family === "IPv4" && !a.internal)?.address;
    if (!ip) return t.skip("ni omrezne kartice z IPv4");
    const r = await fetch(`http://${ip}:${vrata}/v1/models`, { signal: AbortSignal.timeout(2000) }).then(
      () => "odgovor",
      () => "zavrnjeno",
    );
    assert.equal(r, "zavrnjeno");
    const zanka = await fetch(`http://127.0.0.1:${vrata}/v1/models`).then((x) => x.status);
    assert.equal(zanka, 401, "na zanki tece (brez kljuca 401)");
  });

  it("ustavi in ob zagonu Line znova zazene namescen OmniRoute (brez ponovne namestitve); hkratna zagona = en proces", async () => {
    await ustaviOmniroute();
    assert.equal((await stanjeNamestitve(token, dir)).pripravljeno, false, "mrtev OmniRoute ni »pripravljen«");
    writeFileSync(path.join(korenOmniroute(dir), "zagoni.txt"), "");
    const ustavljen = await fetch(`http://127.0.0.1:${vrata}/v1/models`, { signal: AbortSignal.timeout(2000) }).then(
      () => "tece",
      () => "ustavljen",
    );
    assert.equal(ustavljen, "ustavljen");
    await Promise.all([zazeniObZagonu(dir, odvisnosti()), zazeniObZagonu(dir, odvisnosti())]);
    assert.equal((await stanjeNamestitve(token, dir)).tece, true);
    assert.equal(readFileSync(path.join(korenOmniroute(dir), "zagoni.txt"), "utf8").split("\n").filter(Boolean).length, 1);
    // Hkrati zagon ob zagonu Line in »Da, zazeni« v vmesniku: en proces in brez lazne napake »vrata zaseda drug program«.
    await ustaviOmniroute();
    writeFileSync(path.join(korenOmniroute(dir), "zagoni.txt"), "");
    await Promise.all([zazeniObZagonu(dir, odvisnosti()), namestiOmniroute(token, dir, odvisnosti()).then(() => pocakajNamestitev())]);
    const st = await stanjeNamestitve(token, dir);
    assert.equal(st.napaka, null);
    assert.equal(st.pripravljeno, true);
    assert.equal(readFileSync(path.join(korenOmniroute(dir), "zagoni.txt"), "utf8").split("\n").filter(Boolean).length, 1);
    assert.equal(json<unknown[]>(path.join(korenOmniroute(dir), "npm-klici.json")).length, 1, "npm ci se ne ponovi");
  });

  it("odstrani: samo mapa z oznako Line in skrivnosti; ostalo v mapi podatkov ostane; OmniRoute ustavljen", async () => {
    writeFileSync(path.join(dir, "druga-datoteka.txt"), "ostane");
    await odstraniOmniroute(token, dir);
    assert.equal(existsSync(korenOmniroute(dir)), false);
    assert.equal(existsSync(path.join(dir, "omniroute-lokalno.json")), false);
    assert.equal(readFileSync(path.join(dir, "druga-datoteka.txt"), "utf8"), "ostane");
    const r = await fetch(`http://127.0.0.1:${vrata}/v1/models`, { signal: AbortSignal.timeout(2000) }).then(
      () => "tece",
      () => "ustavljen",
    );
    assert.equal(r, "ustavljen");
    await assert.rejects(odstraniOmniroute(token, dir), /ni namestila/);
    const b = await readBrain(token, dir);
    assert.equal(b.shranjeni?.some((p) => p.provider === "omniroute"), false, "asistentka ne ostane na odstranjenem OmniRoute");
    assert.equal(b.pogovor ?? null, null);
  });

  it("padec brskalnika: namestitev ni koncana; ponovni poskus namesti znova in uspe", async () => {
    const n = await nova();
    const zastavica = path.join(n.dir, "pw-pade");
    writeFileSync(zastavica, "1");
    await namestiOmniroute(n.token, n.dir, odvisnosti());
    await pocakajNamestitev();
    let st = await stanjeNamestitve(n.token, n.dir);
    assert.equal(st.koraki[1]?.stanje, "napaka");
    assert.equal(st.pripravljeno, false);
    rmSync(zastavica);
    await namestiOmniroute(n.token, n.dir, odvisnosti());
    await pocakajNamestitev();
    st = await stanjeNamestitve(n.token, n.dir);
    assert.equal(st.napaka, null);
    assert.equal(st.pripravljeno, true);
    assert.equal(json<unknown[]>(path.join(korenOmniroute(n.dir), "npm-klici.json")).length, 2, "drugi poskus ne preskoci namestitve");
    await odstraniOmniroute(n.token, n.dir);
  });

  it("odstrani zavrne, ce je OmniRoute izbran za klice", async () => {
    const n = await nova();
    mkdirSync(korenOmniroute(n.dir), { recursive: true });
    writeFileSync(path.join(korenOmniroute(n.dir), "lina-namestitev.json"), "{}");
    writeFileSync(path.join(n.dir, "kljuci.json"), JSON.stringify({ provider: "omniroute" }));
    await assert.rejects(odstraniOmniroute(n.token, n.dir), /za klice/);
    assert.equal(existsSync(korenOmniroute(n.dir)), true);
  });

  it("pokvarjen prenos npm: integriteta se ne ujema -> napaka v navadnem jeziku, npm ci se ne zazene", async () => {
    const n = await nova();
    pokvarjen = true;
    try {
      await namestiOmniroute(n.token, n.dir, odvisnosti());
      await pocakajNamestitev();
    } finally {
      pokvarjen = false;
    }
    const st = await stanjeNamestitve(n.token, n.dir);
    assert.equal(st.pripravljeno, false);
    assert.equal(st.koraki[0]?.stanje, "napaka");
    assert.match(st.napaka ?? "", /integritete/);
    assert.equal(existsSync(path.join(korenOmniroute(n.dir), "npm-klici.json")), false);
    assert.equal(existsSync(path.join(korenOmniroute(n.dir), "app")), false);
  });

  it("klici na OmniRoute z drugim naslovom: namestitev jih ne preusmeri (kljuci.json bajt za bajtom enak)", async () => {
    const n = await nova();
    const drug = createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "auto" }], choices: [{ message: { content: "da" } }] }));
    });
    await new Promise<void>((ok) => drug.listen(0, "127.0.0.1", ok));
    try {
      const naslovDrugega = `http://localhost:${(drug.address() as AddressInfo).port}/v1`;
      await saveBrain({ provider: "omniroute", key: "om-drug-kljuc-00031", naslov: naslovDrugega, model: "auto", zaKlice: true }, n.token, n.dir);
      const prej = readFileSync(path.join(n.dir, "kljuci.json"));
      await namestiOmniroute(n.token, n.dir, odvisnosti());
      await pocakajNamestitev();
      const st = await stanjeNamestitve(n.token, n.dir);
      assert.match(st.napaka ?? "", /drugem naslovu/);
      assert.deepEqual(readFileSync(path.join(n.dir, "kljuci.json")), prej);
      await ustaviOmniroute();
    } finally {
      await new Promise<void>((ok) => drug.close(() => ok()));
    }
  });

  it("klici na drugem ponudniku: namestitev kljuci.json ne spremeni in soglasja ne vklopi", async () => {
    const n = await nova();
    const zapis = JSON.stringify({ provider: "grok", model: "grok-4", iv: "x", tag: "y", ciphertext: "z" });
    writeFileSync(path.join(n.dir, "kljuci.json"), zapis);
    await namestiOmniroute(n.token, n.dir, odvisnosti());
    await pocakajNamestitev();
    assert.equal(readFileSync(path.join(n.dir, "kljuci.json"), "utf8"), zapis);
    await ustaviOmniroute();
  });

  it("obstojeca mapa omniroute brez oznake Line (rocna namestitev): Lina je ne prevzame in v njej nic ne spremeni", async () => {
    const n = await nova();
    mkdirSync(korenOmniroute(n.dir), { recursive: true });
    writeFileSync(path.join(korenOmniroute(n.dir), "moje.txt"), "rocno");
    await namestiOmniroute(n.token, n.dir, odvisnosti());
    await pocakajNamestitev();
    const st = await stanjeNamestitve(n.token, n.dir);
    assert.match(st.napaka ?? "", /ni ustvarila Lina/);
    assert.equal(existsSync(path.join(korenOmniroute(n.dir), "lina-namestitev.json")), false);
    assert.equal(readFileSync(path.join(korenOmniroute(n.dir), "moje.txt"), "utf8"), "rocno");
    await assert.rejects(odstraniOmniroute(n.token, n.dir), /ni namestila/);
  });

  it("premalo prostora na disku: napaka pred prenosom", async () => {
    const n = await nova();
    await namestiOmniroute(n.token, n.dir, { ...odvisnosti(), prostor: async () => 1024 ** 3 });
    await pocakajNamestitev();
    const st = await stanjeNamestitve(n.token, n.dir);
    assert.match(st.napaka ?? "", /premalo prostora/);
    assert.equal(existsSync(path.join(korenOmniroute(n.dir), "npm")), false);
  });
});
