/**
 * OmniRoute kot ponudnik mozganov (lastnik 24. 11. 2026, AGENTS.md »OmniRoute kot ponudnik mozganov«, B9).
 * Lazni OmniRoute je pravi http streznik na 127.0.0.1 (brez omrezja): /v1/models in /v1/chat/completions.
 * Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { activeBrain, checkBrain, envKey, pogovorBrain, readBrain, saveBrain } from "./keys.server.ts";
import { veljavenNaslovOmniroute } from "./omniroute.ts";
import { callProvider, pozabiZamenjaveModelov, providerRequest } from "./providers.ts";
import { kandidati } from "./samodejni-model.server.ts";
import { besedila } from "./besedila.ts";
import { DEFAULT_BRAIN_MODELS, IME_PONUDNIKA } from "./types.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-omniroute-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const KLJUC = "om-izmisljen-preizkusni-kljuc-0001";
const OKOLJE = ["OPENROUTER_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "LINA_DATA"];
const shranjeno: Record<string, string | undefined> = {};

type Zahteva = { pot: string; metoda: string; avtorizacija: string; model?: string };
const zahteve: Zahteva[] = [];
let modeli: string[] = [];
let odgovor: (model: string) => { status: number; telo: unknown } = () => ({ status: 200, telo: { choices: [{ message: { content: "da" } }] } });
let streznik: Server;
let osnova = "";

function telo(req: IncomingMessage): Promise<string> {
  return new Promise((ok) => {
    let s = "";
    req.on("data", (d) => (s += d));
    req.on("end", () => ok(s));
  });
}

before(async () => {
  streznik = createServer(async (req, res) => {
    const surovo = await telo(req);
    const model = surovo ? (JSON.parse(surovo) as { model?: string }).model : undefined;
    zahteve.push({ pot: req.url ?? "", metoda: req.method ?? "", avtorizacija: String(req.headers.authorization ?? ""), ...(model ? { model } : {}) });
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ object: "list", data: modeli.map((id) => ({ id })) }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      const r = odgovor(String(model));
      res.writeHead(r.status, { "content-type": "application/json" }).end(JSON.stringify(r.telo));
      return;
    }
    if (req.url === "/preusmeri/chat/completions") {
      res.writeHead(302, { location: "https://example.invalid/" }).end();
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((ok) => streznik.listen(0, "127.0.0.1", ok));
  osnova = `http://127.0.0.1:${(streznik.address() as AddressInfo).port}/v1`;
});

after(() => new Promise<void>((ok) => streznik.close(() => ok())));

async function nova(): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  process.env.LINA_DATA = dir;
  return { dir, token: await setupOwner("geslo-test-1234", dir) };
}

beforeEach(() => {
  pozabiZamenjaveModelov();
  zahteve.length = 0;
  modeli = ["auto", "kr/claude-sonnet", "gemini-cli/gemini-3-flash", "if/kimi-k2", "text-embedding-3"];
  odgovor = () => ({ status: 200, telo: { choices: [{ message: { content: "da" } }] } });
  for (const ime of OKOLJE) {
    shranjeno[ime] = process.env[ime];
    if (ime !== "LINA_DATA") delete process.env[ime];
  }
});

afterEach(() => {
  for (const ime of OKOLJE) {
    if (shranjeno[ime] === undefined) delete process.env[ime];
    else process.env[ime] = shranjeno[ime];
  }
});

describe("ponudnik omniroute: osnove", () => {
  it("ime, privzeti model auto in privzeti naslov 127.0.0.1:20128", () => {
    assert.equal(IME_PONUDNIKA.omniroute, "OmniRoute");
    assert.equal(DEFAULT_BRAIN_MODELS.omniroute, "auto");
    assert.equal(veljavenNaslovOmniroute("http://127.0.0.1:20128/v1"), "http://127.0.0.1:20128/v1");
  });

  it("http samo za 127.0.0.1 in localhost; domace omrezje in tuji gostitelji samo https", () => {
    assert.equal(veljavenNaslovOmniroute("http://localhost:20128/v1/"), "http://localhost:20128/v1");
    assert.equal(veljavenNaslovOmniroute("http://192.168.1.5:20128/v1"), null);
    assert.equal(veljavenNaslovOmniroute("http://10.0.0.2:20128/v1"), null);
    assert.equal(veljavenNaslovOmniroute("http://[::1]:20128/v1"), null);
    assert.equal(veljavenNaslovOmniroute("http://primer.si/v1"), null);
    assert.equal(veljavenNaslovOmniroute("https://omni.primer.si/v1"), "https://omni.primer.si/v1");
    assert.equal(veljavenNaslovOmniroute("https://u:g@omni.primer.si/v1"), null);
    assert.equal(veljavenNaslovOmniroute("ftp://127.0.0.1/v1"), null);
  });

  it("kljuc iz okolja nikoli (ne pade na XAI_API_KEY)", () => {
    process.env.XAI_API_KEY = "xai-izmisljen-0000";
    assert.equal(envKey("omniroute"), null);
  });

  it("zahteva gre na naslov OmniRoute v obliki OpenAI, nikoli k Anthropic", () => {
    const { url, init } = providerRequest({ provider: "omniroute", model: "auto", key: KLJUC, text: "zivjo", naslov: "http://127.0.0.1:20128/v1" });
    assert.equal(url, "http://127.0.0.1:20128/v1/chat/completions");
    const glave = init.headers as Record<string, string>;
    assert.equal(glave.authorization, `Bearer ${KLJUC}`);
    assert.equal(glave["x-api-key"], undefined);
    assert.equal((JSON.parse(String(init.body)) as { model: string }).model, "auto");
    assert.throws(() => providerRequest({ provider: "omniroute", model: "auto", key: KLJUC, text: "x", naslov: "http://192.168.1.5/v1" }));
  });

  it("kandidati: auto prvi, nato modeli s seznama (brez vdelav in :free)", () => {
    const k = kandidati("omniroute", ["text-embedding-3", "kr/claude-sonnet", "x/model:free", "if/kimi-k2"]);
    assert.deepEqual(k, ["auto", "kr/claude-sonnet", "if/kimi-k2"]);
  });
});

describe("omniroute z laznim streznikom na 127.0.0.1", () => {
  it("callProvider gre na lazni streznik (http na zanki), s kljucem v glavi", async () => {
    const r = await callProvider({ provider: "omniroute", model: "auto", key: KLJUC, text: "Odgovori: da", naslov: osnova, vsebinaKlica: false });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(zahteve.at(-1)?.pot, "/v1/chat/completions");
    assert.equal(zahteve.at(-1)?.avtorizacija, `Bearer ${KLJUC}`);
  });

  it("preusmeritev ni dovoljena", async () => {
    const naslov = osnova.replace(/\/v1$/, "/preusmeri");
    const r = await callProvider({ provider: "omniroute", model: "auto", key: KLJUC, text: "x", naslov, vsebinaKlica: false, brezZamenjave: true });
    assert.equal(r.ok, false);
  });

  it("brez izrecne izbire za klice: shrani samo za asistentko, klici nimajo mozganov omniroute", async () => {
    const { dir, token } = await nova();
    const b = await saveBrain({ provider: "omniroute", key: KLJUC, naslov: osnova, samodejno: true }, token, dir);
    assert.equal(await activeBrain(dir), null);
    const om = b.shranjeni?.find((p) => p.provider === "omniroute");
    assert.ok(om, "omniroute je med shranjenimi");
    assert.equal(om.samoAsistentka, true);
    assert.equal(om.naslov, osnova);
    assert.match(b.sporociloModela ?? "", /asistentk/i);
    const kljuci = JSON.parse(await readFile(path.join(dir, "kljuci.json"), "utf8").catch(() => "{}")) as { provider?: string };
    assert.notEqual(kljuci.provider, "omniroute");
  });

  it("z izrecno izbiro za klice: samodejni model z seznama, preizkusni klic samo na 127.0.0.1", async () => {
    const { dir, token } = await nova();
    const b = await saveBrain({ provider: "omniroute", key: KLJUC, naslov: osnova, samodejno: true, zaKlice: true }, token, dir);
    assert.equal(b.provider, "omniroute");
    assert.equal(b.model, "auto");
    assert.ok(zahteve.some((z) => z.metoda === "GET" && z.pot === "/v1/models"), "seznam iz /v1/models");
    const aktivni = await activeBrain(dir);
    assert.equal(aktivni?.provider, "omniroute");
    assert.equal(aktivni?.naslov, osnova);
    const om = b.shranjeni?.find((p) => p.provider === "omniroute");
    assert.ok(om?.modeli.includes("kr/claude-sonnet"), "seznam modelov za izbiro v vmesniku");
    assert.equal(JSON.stringify(b).includes(KLJUC), false, "kljuc ne gre odjemalcu");
    const disk = await readFile(path.join(dir, "kljuci.json"), "utf8");
    assert.equal(disk.includes(KLJUC), false, "kljuc je sifriran");
  });

  it("klic brez naslova v vhodu uporabi shranjen naslov (klicatelji activeBrain)", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "omniroute", key: KLJUC, naslov: osnova, model: "auto", zaKlice: true }, token, dir);
    const a = await activeBrain(dir);
    assert.ok(a);
    const r = await callProvider({ provider: a.provider, model: a.model, key: a.key, text: "x" });
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it("zapis omniroute v kljuci.json brez oznake klicev (rocno urejen) ne da mozganov za klice", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "omniroute", key: KLJUC, naslov: osnova, model: "auto", zaKlice: true }, token, dir);
    const pot = path.join(dir, "kljuci.json");
    const zapis = JSON.parse(await readFile(pot, "utf8")) as Record<string, unknown>;
    delete zapis.klici;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(pot, JSON.stringify(zapis));
    // B9: tudi s kljucem drugega ponudnika v okolju ni padca na drugega ponudnika.
    process.env.XAI_API_KEY = "xai-izmisljen-0000";
    process.env.OPENAI_API_KEY = "sk-izmisljen-0000";
    assert.equal(await activeBrain(dir), null);
  });

  // Slepi pregled mozganov M2 (24. 11. 2026): za KLICE OmniRoute modela ne zamenja sam (prehod posreduje k razlicnim, tudi tretjim
  // brezplacnim ponudnikom; »auto« prepusti izbiro prehodu). Lina vrne razlog, model klicev ostane, izbiro naredi lastnik.
  it("model, ki ga OmniRoute ne pozna: za klice brez samodejne zamenjave (razlog, model ostane)", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "omniroute", key: KLJUC, naslov: osnova, model: "star/model", zaKlice: true }, token, dir);
    odgovor = (m) =>
      m === "star/model"
        ? { status: 404, telo: { error: { code: "model_not_found", message: "model not found" } } }
        : { status: 200, telo: { choices: [{ message: { content: "da" } }] } };
    const a = await activeBrain(dir);
    assert.ok(a);
    const r = await callProvider({ ...a, text: "x" });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.ok ? undefined : r.vzrok, "model");
    assert.match(r.ok ? "" : r.sporocilo, /OmniRoute/);
    assert.equal((await activeBrain(dir))?.model, "star/model");
    assert.deepEqual(zahteve.filter((z) => z.model !== undefined && z.model !== "star/model").map((z) => z.model), []);
    // Naloga 31: preverba dosegljivosti (GET /v1/models) namenoma brez kljuca; vse drugo s kljucem.
    assert.equal(zahteve.every((z) => z.avtorizacija === `Bearer ${KLJUC}` || (z.avtorizacija === "" && z.metoda === "GET" && z.pot === "/v1/models")), true);
  });

  it("asistentka lahko izbere omniroute; pogovorBrain vrne naslov", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "omniroute", key: KLJUC, naslov: osnova, model: "auto" }, token, dir);
    const { izberiModelPogovora } = await import("./keys.server.ts");
    await izberiModelPogovora({ provider: "omniroute", model: "auto" }, token, dir);
    const p = await pogovorBrain(dir);
    assert.equal(p?.provider, "omniroute");
    assert.equal(p?.naslov, osnova);
    assert.equal((await readBrain(token, dir)).provider, null, "klici ostanejo brez mozganov");
  });

  it("seznam za izbiro brez :free in modelov, ki niso za pogovor; asistentka brez izbire dobi OmniRoute", async () => {
    const { dir, token } = await nova();
    modeli = ["auto", "kr/claude-sonnet", "x/model:free", "text-embedding-3", "tts-1"];
    const b = await saveBrain({ provider: "omniroute", key: KLJUC, naslov: osnova, model: "auto" }, token, dir);
    const om = b.shranjeni?.find((p) => p.provider === "omniroute");
    assert.deepEqual(om?.modeli, ["auto", "kr/claude-sonnet"]);
    assert.deepEqual(b.pogovor, { provider: "omniroute", model: "auto" });
    assert.equal((await pogovorBrain(dir))?.provider, "omniroute");
  });

  it("nov naslov ne prenese starega kljuca k drugemu gostitelju", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "omniroute", key: KLJUC, naslov: osnova, model: "auto" }, token, dir);
    // Naloga 31 (26. 11. 2026): preverba dosegljivosti je pred preverbo kljuca, zato drug naslov, ki TECE (localhost namesto 127.0.0.1);
    // nedosegljiv https://omni.primer.si bi zdaj vrnil OMNIROUTE_NE_TECE. Namen ostane: kljuc ne gre k drugemu naslovu.
    const drug = osnova.replace("127.0.0.1", "localhost");
    await assert.rejects(() => saveBrain({ provider: "omniroute", naslov: drug, model: "auto" }, token, dir), /kljuc|ključ/i);
    assert.equal(zahteve.at(-1)?.avtorizacija, "", "preverba dosegljivosti ne nese kljuca");
  });

  it("checkBrain preveri omniroute na shranjenem naslovu", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "omniroute", key: KLJUC, naslov: osnova, model: "auto" }, token, dir);
    const r = await checkBrain({ provider: "omniroute", model: "auto" }, token, dir);
    assert.equal(r.ok, true, r.sporocilo);
  });
});

describe("opozorilo v vmesniku (sl in en)", () => {
  it("brezplacni modeli tretjih ponudnikov in izrecna izbira za klice", () => {
    for (const jezik of ["sl", "en"] as const) {
      assert.ok(besedila[jezik].omPonudnikOpozorilo.length > 40, jezik);
      assert.ok(besedila[jezik].omPonudnikZaKlice.length > 10, jezik);
      assert.ok(besedila[jezik].omPonudnikNaslov.length > 5, jezik);
    }
    assert.match(besedila.sl.omPonudnikOpozorilo, /tretj/i);
    assert.match(besedila.en.omPonudnikOpozorilo, /third/i);
  });
});
