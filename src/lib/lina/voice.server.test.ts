import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { handleVoiceRequest } from "./voice.server.ts";
import { defaultDataDir, readChosenDir, resolveDataDir } from "./store.server.ts";
import { moveDataDir } from "./storage.server.ts";

process.env.LINA_LLM = "0";

const DATOTEKE = ["line.json", "calls.json", "sessions.json", "prijave.json", "auth.json", "kljuci.json", ".kljuc"];
const temps: string[] = [];

async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-c-"));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.LINA_DATA;
  while (temps.length) {
    const dir = temps.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function sha(file: string): Promise<string> {
  const body = await readFile(file);
  return createHash("sha256").update(body).digest("hex");
}

async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of DATOTEKE) out[name] = await sha(path.join(dir, name));
  return out;
}

describe("naloga C", { concurrency: 1 }, () => {
  it("privzeta mapa za linux in win32", () => {
    assert.equal(defaultDataDir("linux", { HOME: "/home/ana" }), "/home/ana/.local/share/lina");
    assert.equal(defaultDataDir("linux", { HOME: "/home/ana", XDG_DATA_HOME: "/xdg/ana" }), "/xdg/ana/lina");
    assert.equal(
      defaultDataDir("win32", { LOCALAPPDATA: "C:\\Users\\Ana\\AppData\\Local" }),
      "C:\\Users\\Ana\\AppData\\Local\\Lina",
    );
    const previous = process.env.LINA_DATA;
    process.env.LINA_DATA = "/tmp/lina-preizkus-env";
    try {
      assert.equal(resolveDataDir(), path.resolve("/tmp/lina-preizkus-env"));
      assert.equal(resolveDataDir("/izrecno/lina"), path.resolve("/izrecno/lina"));
    } finally {
      if (previous === undefined) delete process.env.LINA_DATA;
      else process.env.LINA_DATA = previous;
    }
  });

  it("menjava mape v mapo brez pisanja ostane pri stari", async () => {
    const root = await scratch();
    const from = path.join(root, "stara");
    const configDir = path.join(root, "nastavitve");
    await writeFile(path.join(root, "zid"), "ni mapa");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(from, { recursive: true });
    await mkdir(configDir, { recursive: true });
    const body = '{"odprto":true}\n';
    await writeFile(path.join(from, "line.json"), body);
    const blocked = path.join(root, "zid", "cilj");
    const result = await moveDataDir(blocked, { from, configDir });
    assert.equal(result.ok, false);
    assert.equal(result.mapa, path.resolve(from));
    assert.match(result.razlog, /pisati/);
    assert.equal(await readFile(path.join(from, "line.json"), "utf8"), body);
    assert.equal(readChosenDir(configDir), null);
    assert.deepEqual(await readdir(from), ["line.json"]);
  });

  it("po menjavi so datoteke prenesene z enakim SHA-256 in stara mapa nespremenjena", async () => {
    const root = await scratch();
    const from = path.join(root, "stara");
    const target = path.join(root, "nova");
    const configDir = path.join(root, "nastavitve");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(from, { recursive: true });
    await mkdir(configDir, { recursive: true });
    let n = 0;
    for (const name of DATOTEKE) {
      n += 1;
      const payload = name === ".kljuc" ? Buffer.from([n, 255, 7, n]) : Buffer.from(`vsebina-${name}-${n}`, "utf8");
      await writeFile(path.join(from, name), payload);
    }
    const before = await snapshot(from);
    const result = await moveDataDir(target, { from, configDir, platform: "linux" });
    assert.equal(result.ok, true, result.razlog);
    assert.equal(result.mapa, path.resolve(target));
    assert.deepEqual(await snapshot(from), before);
    assert.deepEqual(await snapshot(target), before);
    assert.deepEqual((await readdir(from)).sort(), [...DATOTEKE].sort());
    assert.equal(readChosenDir(configDir), path.resolve(target));
  });

  it("opozorilo za pot z OneDrive", async () => {
    const root = await scratch();
    const from = path.join(root, "stara");
    const target = path.join(root, "OneDrive", "Lina");
    const configDir = path.join(root, "nastavitve");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(from, { recursive: true });
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(from, "line.json"), '{"ime":"FORMA"}\n');
    const result = await moveDataDir(target, { from, configDir, platform: "win32" });
    assert.equal(result.ok, true, result.razlog);
    assert.match(result.opozorila.join(" "), /OneDrive|oblaku/i);
    assert.equal(readChosenDir(configDir), path.resolve(target));
  });

  it("ponovljen podpisan webhook vrne zadnji TwiML, prvi 200", async () => {
    const dir = await scratch();
    const secret = "twilio-zeton-ponovitev";
    process.env.TWILIO_AUTH_TOKEN = secret;
    const url = "https://lina.primer/api/voice/incoming";
    const params = { CallSid: "CA-PONOVITEV", From: "+38640000001" };
    const body = new URLSearchParams(params).toString();
    const signed = Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + params[key as keyof typeof params], url);
    const good = createHmac("sha1", secret).update(signed).digest("base64");
    const request = () =>
      new Request(url, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-twilio-signature": good,
        },
        body,
      });
    const first = await handleVoiceRequest(request(), dir);
    assert.equal(first.status, 200);
    const telo = await first.text();
    const second = await handleVoiceRequest(request(), dir);
    assert.equal(second.status, 200);
    assert.equal(await second.text(), telo);
    assert.equal(telo.includes(secret), false);
  });
});
