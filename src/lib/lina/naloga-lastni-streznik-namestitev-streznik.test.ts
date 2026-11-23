/**
 * Preizkusi lastni-streznik-namestitev.server.ts (naloga #43): namestitev freellmapi z LAZNIM dockerjem in lazno mrezo.
 * Dokazujejo: datoteke se ne prepisujejo, dovoljenja 600, compose se pred zagonom preveri, ob napaki se vsebnik ustavi,
 * enotni kljuc konca samo sifriran v ponudniki.json (ne v kljuci.json, ne v datotekah namestitve), samo lastnik.
 * Pravi preizkus z dockerjem je loceno (pravi-preizkus-2.ts). Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { pogovorBrain, readBrain } from "./keys.server.ts";
import { argumentiCompose, razberiAdminIzKonfiguracije, jeVarenCompose } from "./lastni-streznik-namestitev.ts";
import { namestiLastniStreznik, stanjeLastnegaStreznika, ustaviLastniStreznik, type Odvisnosti } from "./lastni-streznik-namestitev.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-namestitev-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const ZETON = "t".repeat(64);
const ENOTNI = `freellmapi-${"K".repeat(40)}`;
const DA = { soglasje: true } as const;
let staroOkolje: string | undefined = process.env.LINA_DATA;
afterEach(() => {
  if (staroOkolje === undefined) delete process.env.LINA_DATA;
  else process.env.LINA_DATA = staroOkolje;
});

async function nova(): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  process.env.LINA_DATA = dir;
  return { dir, token: await setupOwner("geslo-test-1234", dir) };
}

type Moznosti = {
  docker?: string | null;
  infoKoda?: number | null;
  upKoda?: number | null;
  stopKoda?: number | null;
  vrata?: number | null;
  pingOk?: boolean | (() => boolean);
  pingIzjema?: boolean;
  prijavaStatus?: number;
  kljucStatus?: number;
  kljucTelo?: unknown;
  upIzhod?: string;
  vrataMapa?: string; // mapa namestitve, iz katere lazni streznik bere pravo geslo
  vrataZagonaGate?: Promise<void>;
  naUp?: () => void;
};

function lazni(dir: string, m: Moznosti = {}) {
  const zagoni: Array<{ ukaz: string; args: string[]; timeoutMs: number }> = [];
  const klici: Array<{ url: string; method: string; auth: string; telo: string; redirect: string; imaRok: boolean }> = [];
  const zacetkiVrat: number[] = [];
  let ura = 1_000_000;
  const odv: Odvisnosti = {
    najdiDocker: () => (m.docker === undefined ? "/usr/bin/docker" : m.docker),
    zagon: async (ukaz, args, opcije) => {
      zagoni.push({ ukaz, args, timeoutMs: opcije.timeoutMs });
      if (args[0] === "info") return { koda: m.infoKoda === undefined ? 0 : m.infoKoda, izhod: "27.0" };
      if (args.includes("up")) {
        m.naUp?.();
        if (m.vrataZagonaGate) await m.vrataZagonaGate;
        return { koda: m.upKoda === undefined ? 0 : m.upKoda, izhod: m.upKoda ? (m.upIzhod ?? "Error response from daemon: pull access denied") : "" };
      }
      return { koda: m.stopKoda === undefined ? 0 : m.stopKoda, izhod: "" };
    },
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      klici.push({ url: u, method: init?.method ?? "GET", auth: headers.authorization ?? "", telo: String(init?.body ?? ""), redirect: String(init?.redirect ?? ""), imaRok: init?.signal instanceof AbortSignal });
      if (u.endsWith("/api/ping")) {
        if (m.pingIzjema) throw new TypeError("fetch failed");
        const ok = typeof m.pingOk === "function" ? m.pingOk() : m.pingOk !== false;
        return new Response("{}", { status: ok ? 200 : 503 });
      }
      if (u.endsWith("/api/auth/login")) {
        if (m.prijavaStatus && m.prijavaStatus !== 200) return new Response(JSON.stringify({ token: ZETON, email: "x@localhost.invalid" }), { status: m.prijavaStatus });
        // Prijava uspe SAMO z geslom, ki ga je Lina zapisala v konfiguracijo.
        const mapa = path.join(dir, "freellmapi", "freellmapi.config.json");
        const admin = razberiAdminIzKonfiguracije(readFileSync(mapa, "utf8"));
        const telo = JSON.parse(String(init?.body)) as { email: string; password: string };
        if (!admin || telo.email !== admin.eposta || telo.password !== admin.geslo) return new Response("{}", { status: 401 });
        return new Response(JSON.stringify({ token: ZETON, email: admin.eposta }), { status: 200 });
      }
      if (u.endsWith("/api/settings/api-key")) {
        if (headers.authorization !== `Bearer ${ZETON}`) return new Response("{}", { status: 401 });
        return new Response(JSON.stringify(m.kljucTelo === undefined ? { apiKey: ENOTNI } : m.kljucTelo), { status: m.kljucStatus ?? 200 });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
    prostaVrata: async (zacetek) => {
      zacetkiVrat.push(zacetek);
      return m.vrata === undefined ? 3191 : m.vrata;
    },
    nakljucno: (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + n) % 256),
    pocakaj: async (ms) => {
      ura += ms;
    },
    zdaj: () => ura,
  };
  return { odv, zagoni, klici, zacetkiVrat };
}

const vsebina = (dir: string) => ({
  compose: readFileSync(path.join(dir, "freellmapi", "docker-compose.yml"), "utf8"),
  env: readFileSync(path.join(dir, "freellmapi", ".env"), "utf8"),
  config: readFileSync(path.join(dir, "freellmapi", "freellmapi.config.json"), "utf8"),
});
const dovoljenja = (pot: string) => statSync(pot).mode & 0o777;

describe("namestitev: srecna pot", () => {
  it("ustvari datoteke z dovoljenji 600, zazene docker, vzame kljuc in ga shrani samo za pogovor", async () => {
    const { dir, token } = await nova();
    const { odv, zagoni, klici, zacetkiVrat } = lazni(dir);
    const izid = await namestiLastniStreznik(DA, token, dir, odv);
    assert.deepEqual(izid, { ok: true, naslov: "http://127.0.0.1:3191/v1", vrata: 3191, novoNamescen: true });
    const mapa = path.join(dir, "freellmapi");
    assert.equal(dovoljenja(mapa), 0o700);
    for (const ime of ["docker-compose.yml", ".env", "freellmapi.config.json"]) assert.equal(dovoljenja(path.join(mapa, ime)), 0o600, ime);
    const v = vsebina(dir);
    assert.deepEqual(jeVarenCompose(v.compose), { ok: true });
    assert.match(v.env, /^ENCRYPTION_KEY=[a-f0-9]{64}\nPORT=3191\nHOST_BIND=127\.0\.0\.1\n$/);
    assert.ok(razberiAdminIzKonfiguracije(v.config));
    // docker: preverba, nato compose up -d z izrecnimi datotekami
    const p = { compose: path.join(mapa, "docker-compose.yml"), env: path.join(mapa, ".env") };
    assert.deepEqual(zagoni.map((z) => z.args), [["info", "--format", "{{.ServerVersion}}"], argumentiCompose(p, ["up", "-d"])]);
    assert.ok(zagoni.every((z) => z.ukaz === "/usr/bin/docker"));
    // mreza: ping, prijava, kljuc - vse samo na 127.0.0.1
    assert.deepEqual(klici.map((k) => k.url), ["http://127.0.0.1:3191/api/ping", "http://127.0.0.1:3191/api/auth/login", "http://127.0.0.1:3191/api/settings/api-key"]);
    assert.equal(klici[2].auth, `Bearer ${ZETON}`);
    assert.deepEqual(klici.map((k) => k.method), ["GET", "POST", "GET"]);
    assert.ok(klici.every((k) => k.redirect === "error" && k.imaRok), "vsak klic: redirect error in casovna omejitev");
    assert.deepEqual(zacetkiVrat, [3191]);
    assert.equal(zagoni[0].timeoutMs <= 10_000, true);
    assert.equal(zagoni[1].timeoutMs, 15 * 60_000);
    // kljuc: samo sifriran v ponudniki.json, pogovor izbran, klici nedotaknjeni
    const brain = await pogovorBrain(dir);
    assert.deepEqual(brain, { provider: "custom", model: "auto", key: ENOTNI, naslov: "http://127.0.0.1:3191/v1" });
    assert.equal((await readBrain(token, dir)).provider, null);
    assert.equal(existsSync(path.join(dir, "kljuci.json")), false);
    assert.equal(readFileSync(path.join(dir, "ponudniki.json"), "utf8").includes(ENOTNI), false);
    for (const vsebinaDatoteke of Object.values(v)) assert.equal(vsebinaDatoteke.includes(ENOTNI), false);
  });

  it("uporabiZaPogovor: false shrani strežnik, a ga ne izbere", async () => {
    const { dir, token } = await nova();
    const { odv } = lazni(dir);
    const izid = await namestiLastniStreznik({ ...DA, uporabiZaPogovor: false }, token, dir, odv);
    assert.equal(izid.ok, true);
    assert.equal(await pogovorBrain(dir), null);
    assert.equal((await readBrain(token, dir)).shranjeni?.some((p) => p.provider === "custom"), true);
  });

  it("vrata izbere nakljucno prosta vrata", async () => {
    const { dir, token } = await nova();
    const { odv } = lazni(dir, { vrata: 3195 });
    const izid = await namestiLastniStreznik(DA, token, dir, odv);
    assert.equal(izid.ok && izid.naslov, "http://127.0.0.1:3195/v1");
    assert.match(vsebina(dir).env, /PORT=3195/);
  });
});

describe("namestitev: pred zagonom", () => {
  it("docker ni najden: sporocilo in nobenih sledi", async () => {
    const { dir, token } = await nova();
    const { odv, zagoni, klici } = lazni(dir, { docker: null });
    const izid = await namestiLastniStreznik(DA, token, dir, odv);
    assert.equal(izid.ok, false);
    if (!izid.ok) assert.match(izid.sporocilo, /Docker ni nameščen/);
    assert.equal(existsSync(path.join(dir, "freellmapi")), false);
    assert.equal(zagoni.length + klici.length, 0);
  });

  it("docker ne odgovarja: nobenih datotek", async () => {
    const { dir, token } = await nova();
    for (const infoKoda of [1, null]) {
      const { odv, zagoni } = lazni(dir, { infoKoda });
      const izid = await namestiLastniStreznik(DA, token, dir, odv);
      assert.equal(izid.ok, false);
      if (!izid.ok) assert.match(izid.sporocilo, /Docker ne odgovarja/);
      assert.equal(existsSync(path.join(dir, "freellmapi")), false);
      assert.equal(zagoni.length, 1);
    }
  });

  it("ni prostih vrat", async () => {
    const { dir, token } = await nova();
    const { odv } = lazni(dir, { vrata: null });
    const izid = await namestiLastniStreznik(DA, token, dir, odv);
    assert.equal(izid.ok, false);
    if (!izid.ok) assert.match(izid.sporocilo, /prostih vrat/);
    assert.equal(existsSync(path.join(dir, "freellmapi")), false);
  });

  it("samo lastnik: brez prijave ni nic", async () => {
    const { dir } = await nova();
    const { odv, zagoni } = lazni(dir);
    await assert.rejects(namestiLastniStreznik(DA, null, dir, odv));
    await assert.rejects(namestiLastniStreznik(DA, "neveljaven", dir, odv));
    assert.equal(existsSync(path.join(dir, "freellmapi")), false);
    assert.equal(zagoni.length, 0);
  });
});

describe("namestitev: obstojece datoteke se ne prepisejo", () => {
  it("popolna namestitev: ponovni zagon z isto vsebino datotek", async () => {
    const { dir, token } = await nova();
    await namestiLastniStreznik(DA, token, dir, lazni(dir).odv);
    const prej = vsebina(dir);
    const { odv, zagoni } = lazni(dir, { vrata: 3999 });
    const izid = await namestiLastniStreznik(DA, token, dir, odv);
    assert.deepEqual(izid, { ok: true, naslov: "http://127.0.0.1:3191/v1", vrata: 3191, novoNamescen: false });
    assert.deepEqual(vsebina(dir), prej);
    assert.equal(zagoni.filter((z) => z.args.includes("up")).length, 1);
  });

  for (const manjka of ["docker-compose.yml", ".env", "freellmapi.config.json"]) {
    it(`mapa brez datoteke ${manjka}: ustavi, nic ne spremeni in nic ne zazene`, async () => {
      const { dir: izvor, token: zIzvor } = await nova();
      await namestiLastniStreznik(DA, zIzvor, izvor, lazni(izvor).odv);
      const { dir, token } = await nova();
      const { mkdirSync } = await import("node:fs");
      mkdirSync(path.join(dir, "freellmapi"), { mode: 0o700 });
      const imena = ["docker-compose.yml", ".env", "freellmapi.config.json"].filter((i) => i !== manjka);
      for (const ime of imena) writeFileSync(path.join(dir, "freellmapi", ime), readFileSync(path.join(izvor, "freellmapi", ime), "utf8"), { mode: 0o600 });
      const { odv, zagoni } = lazni(dir);
      const izid = await namestiLastniStreznik(DA, token, dir, odv);
      assert.equal(izid.ok, false);
      if (!izid.ok) assert.match(izid.sporocilo, /ni popolna/);
      assert.deepEqual(readdirSync(path.join(dir, "freellmapi")).sort(), [...imena].sort());
      assert.equal(zagoni.filter((z) => z.args.includes("up")).length, 0);
    });
  }

  it("samo .env obstaja: ustavi brez sprememb", async () => {
    const { dir, token } = await nova();
    const { mkdirSync } = await import("node:fs");
    mkdirSync(path.join(dir, "freellmapi"), { mode: 0o700 });
    writeFileSync(path.join(dir, "freellmapi", ".env"), "PORT=3191\n", { mode: 0o600 });
    const { odv, zagoni } = lazni(dir);
    const izid = await namestiLastniStreznik(DA, token, dir, odv);
    assert.equal(izid.ok, false);
    if (!izid.ok) assert.match(izid.sporocilo, /ni popolna/);
    assert.equal(readFileSync(path.join(dir, "freellmapi", ".env"), "utf8"), "PORT=3191\n");
    assert.deepEqual(readdirSync(path.join(dir, "freellmapi")), [".env"]);
    assert.equal(zagoni.filter((z) => z.args.includes("up")).length, 0);
  });

  it("popravljen compose (privileged) se ne zazene", async () => {
    const { dir, token } = await nova();
    await namestiLastniStreznik(DA, token, dir, lazni(dir).odv);
    const pot = path.join(dir, "freellmapi", "docker-compose.yml");
    const original = readFileSync(pot, "utf8");
    writeFileSync(pot, original.replace('    restart: "no"\n', '    restart: "no"\n    privileged: true\n'));
    const { odv, zagoni } = lazni(dir);
    const izid = await namestiLastniStreznik(DA, token, dir, odv);
    assert.equal(izid.ok, false);
    if (!izid.ok) assert.match(izid.sporocilo, /privileged.*Zato ga ne zaženem/s);
    assert.equal(zagoni.filter((z) => z.args.includes("up")).length, 0);
  });

  it("neveljavna vrata v .env", async () => {
    const { dir, token } = await nova();
    await namestiLastniStreznik(DA, token, dir, lazni(dir).odv);
    writeFileSync(path.join(dir, "freellmapi", ".env"), "PORT=80\n");
    const { odv, zagoni } = lazni(dir);
    const izid = await namestiLastniStreznik(DA, token, dir, odv);
    assert.equal(izid.ok, false);
    assert.equal(zagoni.filter((z) => z.args.includes("up")).length, 0);
  });
});

describe("namestitev: napake po zagonu ustavijo vsebnik in nic ne shranijo", () => {
  const ustavljen = (zagoni: Array<{ args: string[] }>) => zagoni.some((z) => z.args.includes("stop"));
  const shranjeno = async (dir: string, token: string) => (await readBrain(token, dir)).shranjeni?.some((p) => p.provider === "custom");

  it("compose up ne uspe", async () => {
    const { dir, token } = await nova();
    const { odv, zagoni } = lazni(dir, { upKoda: 1 });
    const izid = await namestiLastniStreznik(DA, token, dir, odv);
    assert.equal(izid.ok, false);
    if (!izid.ok) assert.match(izid.sporocilo, /Zagon strežnika ni uspel\. Error response from daemon/);
    assert.equal(ustavljen(zagoni), true);
    assert.equal(await shranjeno(dir, token), false);
  });

  it("streznik se ne odzove v dveh minutah (60 poskusov na 2 s)", async () => {
    for (const moznosti of [{ pingOk: false }, { pingIzjema: true }]) {
      const { dir, token } = await nova();
      const { odv, zagoni, klici } = lazni(dir, moznosti);
      const izid = await namestiLastniStreznik(DA, token, dir, odv);
      assert.equal(izid.ok, false);
      if (!izid.ok) assert.match(izid.sporocilo, /ni odzval/);
      assert.equal(klici.filter((k) => k.url.endsWith("/api/ping")).length, 60);
      assert.equal(ustavljen(zagoni), true);
      assert.equal(await shranjeno(dir, token), false);
    }
  });

  it("prijava zavrnjena", async () => {
    const { dir, token } = await nova();
    const { odv, zagoni } = lazni(dir, { prijavaStatus: 401 });
    const izid = await namestiLastniStreznik(DA, token, dir, odv);
    assert.equal(izid.ok, false);
    if (!izid.ok) assert.match(izid.sporocilo, /Prijava v strežnik ni uspela/);
    assert.equal(ustavljen(zagoni), true);
    assert.equal(await shranjeno(dir, token), false);
  });

  it("kljuc zavrnjen s statusom 500, a z veljavnim telesom", async () => {
    const { dir, token } = await nova();
    const { odv, zagoni } = lazni(dir, { kljucStatus: 500 });
    const izid = await namestiLastniStreznik(DA, token, dir, odv);
    assert.equal(izid.ok, false);
    assert.equal(ustavljen(zagoni), true);
    assert.equal(await shranjeno(dir, token), false);
  });

  it("poskodovana konfiguracija skrbnika: sporocilo, vsebnik ustavljen", async () => {
    const { dir, token } = await nova();
    await namestiLastniStreznik({ ...DA, uporabiZaPogovor: false }, token, dir, lazni(dir).odv);
    writeFileSync(path.join(dir, "freellmapi", "freellmapi.config.json"), "{}\n");
    const { odv, zagoni } = lazni(dir);
    const izid = await namestiLastniStreznik(DA, token, dir, odv);
    assert.equal(izid.ok, false);
    if (!izid.ok) assert.match(izid.sporocilo, /Prijava v strežnik ni uspela/);
    assert.equal(ustavljen(zagoni), true);
  });

  it("razlog zagona: zadnja neprazna vrstica izhoda", async () => {
    const { dir, token } = await nova();
    const { odv } = lazni(dir, { upKoda: 1, upIzhod: "prva vrstica\n\nzadnja vrstica napake  \n\n" });
    const izid = await namestiLastniStreznik(DA, token, dir, odv);
    assert.deepEqual(izid, { ok: false, sporocilo: "Zagon strežnika ni uspel. zadnja vrstica napake" });
  });

  it("razlog zagona: najvec 200 znakov", async () => {
    const { dir, token } = await nova();
    const { odv } = lazni(dir, { upKoda: 1, upIzhod: `prva\n${"x".repeat(500)}\n` });
    const izid = await namestiLastniStreznik(DA, token, dir, odv);
    assert.deepEqual(izid, { ok: false, sporocilo: `Zagon strežnika ni uspel. ${"x".repeat(200)}` });
  });

  it("kljuc nima prave oblike", async () => {
    for (const kljucTelo of [{}, { apiKey: "sk-tuj-kljuc-neveljaven-123456789" }, { apiKey: 5 }, null]) {
      // vsakic nova mapa, da se namestitev ne ponovi nad obstojeco
      const { dir, token } = await nova();
      const { odv, zagoni } = lazni(dir, { kljucTelo });
      const izid = await namestiLastniStreznik(DA, token, dir, odv);
      assert.equal(izid.ok, false);
      assert.equal(ustavljen(zagoni), true);
      assert.equal(await shranjeno(dir, token), false);
    }
  });

  it("po napaki se oznaka »poteka« sprosti in naslednji poskus deluje", async () => {
    const { dir, token } = await nova();
    const slab = lazni(dir, { upKoda: 1 });
    assert.equal((await namestiLastniStreznik(DA, token, dir, slab.odv)).ok, false);
    // mapa je ostala popolna (datoteke niso skodljive): naslednji poskus uporabi iste datoteke
    const dober = lazni(dir);
    const izid = await namestiLastniStreznik(DA, token, dir, dober.odv);
    assert.equal(izid.ok, true);
    assert.equal(izid.ok && izid.novoNamescen, false);
  });
});

describe("namestitev: dvojni klik", () => {
  it("druga namestitev med prvo je zavrnjena", async () => {
    const { dir, token } = await nova();
    let sprosti: () => void = () => undefined;
    const vrata = new Promise<void>((r) => (sprosti = r));
    let dosegel: () => void = () => undefined;
    const naUp = new Promise<void>((r) => (dosegel = r));
    const prva = namestiLastniStreznik(DA, token, dir, lazni(dir, { vrataZagonaGate: vrata, naUp: () => dosegel() }).odv);
    await naUp;
    const druga = await namestiLastniStreznik(DA, token, dir, lazni(dir).odv);
    assert.deepEqual(druga, { ok: false, sporocilo: "Namestitev že poteka." });
    sprosti();
    assert.equal((await prva).ok, true);
  });
});

describe("ustavi in stanje", () => {
  it("ustavi: compose stop z izrecnimi datotekami", async () => {
    const { dir, token } = await nova();
    await namestiLastniStreznik(DA, token, dir, lazni(dir).odv);
    const { odv, zagoni } = lazni(dir);
    assert.deepEqual(await ustaviLastniStreznik(token, dir, odv), { ok: true, sporocilo: "Strežnik je ustavljen." });
    const mapa = path.join(dir, "freellmapi");
    assert.deepEqual(zagoni.map((z) => z.args), [argumentiCompose({ compose: path.join(mapa, "docker-compose.yml"), env: path.join(mapa, ".env") }, ["stop"])]);
    assert.equal(zagoni[0].timeoutMs <= 60_000, true);
  });

  it("ustavi: ni namestitve, ni dockerja, ustavitev ne uspe, ni lastnika", async () => {
    const { dir, token } = await nova();
    const a = await ustaviLastniStreznik(token, dir, lazni(dir).odv);
    assert.equal(a.ok, false);
    await namestiLastniStreznik(DA, token, dir, lazni(dir).odv);
    const b = await ustaviLastniStreznik(token, dir, lazni(dir, { docker: null }).odv);
    assert.deepEqual(b, { ok: false, sporocilo: "Docker ni najden." });
    const c = await ustaviLastniStreznik(token, dir, lazni(dir, { stopKoda: 1 }).odv);
    assert.equal(c.ok, false);
    await assert.rejects(ustaviLastniStreznik(null, dir, lazni(dir).odv));
  });

  it("stanje: brez namestitve, tece, ne tece", async () => {
    const { dir, token } = await nova();
    assert.deepEqual(await stanjeLastnegaStreznika({}, token, dir, lazni(dir).odv), { namescen: false, tece: false, vrata: null, docker: "nepreverjeno" });
    await namestiLastniStreznik(DA, token, dir, lazni(dir).odv);
    assert.deepEqual(await stanjeLastnegaStreznika({}, token, dir, lazni(dir).odv), { namescen: true, tece: true, vrata: 3191, docker: "nepreverjeno" });
    assert.deepEqual(await stanjeLastnegaStreznika({}, token, dir, lazni(dir, { pingOk: false }).odv), { namescen: true, tece: false, vrata: 3191, docker: "nepreverjeno" });
    assert.deepEqual(await stanjeLastnegaStreznika({}, token, dir, lazni(dir, { pingIzjema: true }).odv), { namescen: true, tece: false, vrata: 3191, docker: "nepreverjeno" });
  });

  it("stanje: preverba dockerja samo ob zahtevi", async () => {
    const { dir, token } = await nova();
    const v = async (m: Moznosti) => (await stanjeLastnegaStreznika({ preveriDocker: true }, token, dir, lazni(dir, m).odv)).docker;
    assert.equal(await v({}), "ok");
    assert.equal(await v({ docker: null }), "ni");
    assert.equal(await v({ infoKoda: 1 }), "ne-odgovarja");
    const { odv, zagoni } = lazni(dir);
    await stanjeLastnegaStreznika({}, token, dir, odv);
    assert.equal(zagoni.length, 0);
  });

  it("stanje: samo lastnik", async () => {
    const { dir } = await nova();
    await assert.rejects(stanjeLastnegaStreznika({}, null, dir, lazni(dir).odv));
  });
});

describe("namestitev: soglasje z opozorilom o zasebnosti", () => {
  const brez: Array<[string, unknown]> = [
    ["manjka", {}],
    ["false", { soglasje: false }],
    ["niz true", { soglasje: "true" }],
    ["stevilo 1", { soglasje: 1 }],
    ["null", { soglasje: null }],
    ["samo uporabiZaPogovor", { uporabiZaPogovor: true }],
  ];
  for (const [ime, vhod] of brez) {
    it(`soglasje ${ime}: ne zgodi se nic`, async () => {
      const { dir, token } = await nova();
      const { odv, zagoni, klici, zacetkiVrat } = lazni(dir);
      const izid = await namestiLastniStreznik(vhod as unknown as { soglasje?: boolean }, token, dir, odv);
      assert.deepEqual(izid, { ok: false, sporocilo: "Brez potrditve opozorila o zasebnosti namestitve ne začnem." });
      assert.equal(zagoni.length + klici.length + zacetkiVrat.length, 0);
      assert.equal(existsSync(path.join(dir, "freellmapi")), false);
      assert.equal(await pogovorBrain(dir), null);
      assert.notEqual((await readBrain(token, dir)).shranjeni?.some((p) => p.provider === "custom"), true);
    });
  }

  it("brez soglasja tudi ponovni zagon obstojece namestitve ne steče", async () => {
    const { dir, token } = await nova();
    await namestiLastniStreznik(DA, token, dir, lazni(dir).odv);
    const prej = vsebina(dir);
    const { odv, zagoni, klici } = lazni(dir);
    const izid = await namestiLastniStreznik({}, token, dir, odv);
    assert.equal(izid.ok, false);
    assert.equal(zagoni.length + klici.length, 0);
    assert.deepEqual(vsebina(dir), prej);
  });

  it("preverba lastnika je pred soglasjem: brez prijave zavrne", async () => {
    const { dir } = await nova();
    const { odv, zagoni } = lazni(dir);
    await assert.rejects(namestiLastniStreznik({}, null, dir, odv));
    await assert.rejects(namestiLastniStreznik({ soglasje: false }, "neveljaven", dir, odv));
    assert.equal(zagoni.length, 0);
  });

  it("samo soglasje: true zadostuje", async () => {
    const { dir, token } = await nova();
    const izid = await namestiLastniStreznik({ soglasje: true }, token, dir, lazni(dir).odv);
    assert.equal(izid.ok, true);
  });

  it("zavrnjeno soglasje ne zaklene namestitve: naslednji klic s soglasjem uspe", async () => {
    const { dir, token } = await nova();
    const prvi = await namestiLastniStreznik({}, token, dir, lazni(dir).odv);
    assert.equal(prvi.ok, false);
    const izid = await namestiLastniStreznik(DA, token, dir, lazni(dir).odv);
    assert.equal(izid.ok, true);
  });
});
