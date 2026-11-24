/**
 * Lina sama izbere delujoc model ponudnika (lastnik 24. 11. 2026, AGENTS.md »Model, ki ga ponudnik ne pozna«).
 * Ob shranjevanju kljuca: seznam modelov, priporoceni, preizkusni klic, shrani samo model, ki je odgovoril. Med delovanjem: ob
 * »model ne obstaja« zamenjava znotraj ISTEGA ponudnika, ponovitev, shranitev, ena vrstica lastniku. Lazni ponudniki, brez omrezja.
 * Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { activeBrain, checkBrain, pogovorBrain, readBrain, saveBrain } from "./keys.server.ts";
import { callProvider, pozabiZamenjaveModelov, vzrokNapake } from "./providers.ts";
import { kandidati } from "./samodejni-model.server.ts";
import { DEFAULT_BRAIN_MODELS } from "./types.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-model-samodejno-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const praviFetch = globalThis.fetch;
const KLJUC = "sk-ant-izmisljen-preizkusni-kljuc-0001";
const KLJUC_OR = "sk-or-v1-izmisljen-preizkusni-kljuc-0002";
const OKOLJE = ["OPENROUTER_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "LINA_DATA"];
const shranjeno: Record<string, string | undefined> = {};

async function nova(): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  process.env.LINA_DATA = dir;
  return { dir, token: await setupOwner("geslo-test-1234", dir) };
}

beforeEach(() => {
  pozabiZamenjaveModelov();
  for (const ime of OKOLJE) {
    shranjeno[ime] = process.env[ime];
    if (ime !== "LINA_DATA") delete process.env[ime];
  }
});

afterEach(() => {
  globalThis.fetch = praviFetch;
  for (const ime of OKOLJE) {
    if (shranjeno[ime] === undefined) delete process.env[ime];
    else process.env[ime] = shranjeno[ime];
  }
});

type Zahteva = { url: string; metoda: string; glave: Record<string, string>; telo: { model?: string; provider?: { data_collection?: string } } };

/** Lazni ponudnik: GET seznam modelov, POST odgovor po modelu (status in telo). */
function lazni(o: {
  seznam?: { status: number; telo: unknown } | "napaka";
  odgovor: (model: string) => { status: number; telo: unknown };
}): { zahteve: Zahteva[] } {
  const zahteve: Zahteva[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const glave = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const metoda = init?.method ?? "GET";
    const telo = metoda === "POST" ? (JSON.parse(String(init?.body ?? "{}")) as Zahteva["telo"]) : {};
    zahteve.push({ url: String(url), metoda, glave, telo });
    if (metoda === "GET") {
      if (!o.seznam || o.seznam === "napaka") throw new TypeError("fetch failed");
      return new Response(JSON.stringify(o.seznam.telo), { status: o.seznam.status, headers: { "content-type": "application/json" } });
    }
    const r = o.odgovor(String(telo.model));
    return new Response(JSON.stringify(r.telo), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { zahteve };
}

const ANTHROPIC_404 = (model: string) => ({ status: 404, telo: { type: "error", error: { type: "not_found_error", message: `model: ${model}` } } });
const ANTHROPIC_OK = { status: 200, telo: { content: [{ type: "text", text: "da" }] } };
const OPENAI_OK = { status: 200, telo: { choices: [{ message: { content: "da" } }] } };
const seznamAnthropic = (ids: string[]) => ({ status: 200, telo: { data: ids.map((id) => ({ id, type: "model" })) } });

describe("privzeti modeli (javna dokumentacija 24. 11. 2026)", () => {
  it("claude je claude-sonnet-5-5; ugasnjeni ali zastareli niso privzeti", () => {
    assert.equal(DEFAULT_BRAIN_MODELS.claude, "claude-sonnet-5-5");
    for (const star of ["claude-sonnet-4-5", "gemini-2.0-flash", "gemini-2.5-flash", "gpt-4.1-mini", "grok-4"]) {
      assert.ok(!Object.values(DEFAULT_BRAIN_MODELS).includes(star), star);
    }
  });
});

describe("vzrok napake iz statusa in telesa", () => {
  it("model ni na voljo samo ob statusu IN telesu, ki to povesta", () => {
    assert.equal(vzrokNapake(404, JSON.stringify(ANTHROPIC_404("claude-sonnet-4-5").telo)), "model");
    assert.equal(vzrokNapake(404, JSON.stringify({ error: { code: "model_not_found", message: "The model `x` does not exist" } })), "model");
    assert.equal(vzrokNapake(404, JSON.stringify({ error: { code: 404, status: "NOT_FOUND", message: "models/x is not found" } })), "model");
    assert.equal(vzrokNapake(400, JSON.stringify({ error: { code: 400, message: "openai/gpt-4o is not a valid model ID" } })), "model");
    // OpenRouter 404 ob zahtevi »deny« ni »model ne obstaja«; gol 404 brez telesa tudi ne.
    assert.equal(vzrokNapake(404, JSON.stringify({ error: { code: 404, message: "No endpoints found matching your data policy" } })), null);
    assert.equal(vzrokNapake(404, ""), null);
    assert.equal(vzrokNapake(400, JSON.stringify({ error: { type: "invalid_request_error", message: "max_tokens: too large" } })), null);
    // Napaka parametra pri novem modelu ni »model ne obstaja« (sicer bi Lina zavrnila veljaven kljuc ali zamenjala model).
    assert.equal(vzrokNapake(400, JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", type: "invalid_request_error", code: "unsupported_parameter" } })), null);
    assert.equal(vzrokNapake(400, JSON.stringify({ error: { message: "Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported.", code: "unsupported_value" } })), null);
    assert.equal(vzrokNapake(404, JSON.stringify({ error: { message: "The model `gpt-4.1-mini` does not exist or you do not have access to it." } })), "model");
  });

  it("kljuc, dobroimetje in omejitev nikoli ne sprozijo zamenjave modela", () => {
    assert.equal(vzrokNapake(401, JSON.stringify({ error: { type: "authentication_error", message: "invalid x-api-key" } })), "kljuc");
    assert.equal(vzrokNapake(402, "{}"), "dobroimetje");
    assert.equal(vzrokNapake(400, JSON.stringify({ error: { type: "invalid_request_error", message: "Your credit balance is too low" } })), "dobroimetje");
    assert.equal(vzrokNapake(429, JSON.stringify({ error: { code: "insufficient_quota" } })), "dobroimetje");
    assert.equal(vzrokNapake(429, "{}"), "omejitev");
  });

  it("kandidati: vrstni red priporocil, seznam odloci, brez brezplacnih in izkljucenih, najvec 3", () => {
    assert.deepEqual(kandidati("claude", ["claude-opus-5-5", "claude-haiku-5-5", "claude-3-x"]), ["claude-haiku-5-5", "claude-opus-5-5"]);
    assert.deepEqual(kandidati("openrouter", ["openai/gpt-oss-20b:free", "openai/gpt-6-luna", "meta/llama"]), ["openai/gpt-6-luna"]);
    assert.deepEqual(kandidati("claude", null, ["claude-sonnet-5-5"]), ["claude-haiku-5-5", "claude-sonnet-5", "claude-opus-5-5"]);
    assert.ok(kandidati("openai", ["gpt-6-luna", "gpt-6.1-terra", "gpt-6.2-sol", "gpt-6-luna-audio", "gpt-5"]).length <= 3);
    assert.ok(!kandidati("openai", ["gpt-6-luna-realtime", "gpt-6-tts"]).length);
  });

  it("seznam brez zgornje meje: priporocen model za 400. mestom je na seznamu", async () => {
    const { razberiSeznam } = await import("./samodejni-model.server.ts");
    const ids = [...Array.from({ length: 450 }, (_, i) => `openai/gpt-${i}-drag`), "openai/gpt-4o"];
    const seznam = razberiSeznam("openrouter", { data: ids.map((id) => ({ id })) });
    assert.equal(seznam.length, 451);
    assert.equal(kandidati("openrouter", seznam)[0], "openai/gpt-4o");
  });
});

describe("med delovanjem: model, ki ga ponudnik ne pozna", { concurrency: 1 }, () => {
  it("Claude 404 not_found -> isti ponudnik, delujoc model, ponovitev, shranitev, ena vrstica lastniku", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "claude", model: "claude-sonnet-4-5", key: KLJUC }, token, dir);
    const { zahteve } = lazni({
      seznam: seznamAnthropic(["claude-sonnet-5-5", "claude-haiku-5-5"]),
      odgovor: (m) => (m === "claude-sonnet-4-5" ? ANTHROPIC_404(m) : ANTHROPIC_OK),
    });
    const brain = await activeBrain(dir);
    assert.ok(brain);
    const izid = await callProvider({ ...brain, text: "Pozdravljena", vsebinaKlica: false });
    assert.equal(izid.ok, true);
    assert.ok(izid.ok && izid.text === "da");
    assert.ok(izid.ok && izid.povratek && /claude-sonnet-4-5/.test(izid.povratek) && /claude-sonnet-5-5/.test(izid.povratek), "ena vrstica lastniku");
    assert.ok(izid.ok && !/model: /.test(`${izid.text} ${izid.povratek}`), "surovo sporocilo ponudnika ni vidno");
    // B9: samo uradni naslov istega ponudnika, kljuc samo v glavi.
    for (const z of zahteve) {
      assert.match(z.url, /^https:\/\/api\.anthropic\.com\/v1\//, z.url);
      assert.ok(!z.url.includes(KLJUC));
      assert.equal(z.glave["x-api-key"], KLJUC);
    }
    assert.equal((await activeBrain(dir))?.model, "claude-sonnet-5-5", "klici: shranjen nov model");
    const pogled = await readBrain(token, dir);
    assert.equal(pogled.model, "claude-sonnet-5-5");
    assert.ok(pogled.shranjeni?.find((p) => p.provider === "claude")?.modeli.includes("claude-sonnet-5-5"));
    assert.ok(!pogled.shranjeni?.find((p) => p.provider === "claude")?.modeli.includes("claude-sonnet-4-5"));
    assert.match(pogled.zamenjavaModela ?? "", /claude-sonnet-5-5/);
    const kljuci = await readFile(path.join(dir, "kljuci.json"), "utf8");
    assert.ok(!kljuci.includes(KLJUC), "kljuc ostane sifriran");
    // Tekoci klic s starim modelom v pomnilniku: takoj nov model, brez ponovnega 404 in iskanja.
    const pred = zahteve.length;
    const drugic = await callProvider({ ...brain, text: "Se enkrat", vsebinaKlica: false });
    assert.equal(drugic.ok, true);
    assert.equal(zahteve.length - pred, 1);
    assert.equal(zahteve.at(-1)?.telo.model, "claude-sonnet-5-5");
  });

  it("izbira asistentke (pogovor) s starim modelom se premakne na nov model", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "claude", model: "claude-sonnet-4-5", key: KLJUC }, token, dir);
    const { izberiModelPogovora } = await import("./keys.server.ts");
    await izberiModelPogovora({ provider: "claude", model: "claude-sonnet-4-5" }, token, dir);
    lazni({ seznam: seznamAnthropic(["claude-sonnet-5-5"]), odgovor: (m) => (m === "claude-sonnet-4-5" ? ANTHROPIC_404(m) : ANTHROPIC_OK) });
    const brain = await pogovorBrain(dir);
    assert.ok(brain);
    assert.equal((await callProvider({ ...brain, text: "Kaj je novega?", vsebinaKlica: false })).ok, true);
    assert.equal((await pogovorBrain(dir))?.model, "claude-sonnet-5-5");
    assert.deepEqual((await readBrain(token, dir)).pogovor, { provider: "claude", model: "claude-sonnet-5-5" });
  });

  it("klici (OpenRouter): brezplacen model se ne izbere, deny ostane, isti ponudnik", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "openrouter", key: KLJUC_OR }, token, dir);
    const { zahteve } = lazni({
      seznam: { status: 200, telo: { data: [{ id: "openai/gpt-oss-20b:free" }, { id: "openai/gpt-6-luna" }] } },
      odgovor: (m) => (m === "openai/gpt-4o" ? { status: 400, telo: { error: { code: 400, message: "openai/gpt-4o is not a valid model ID" } } } : OPENAI_OK),
    });
    const brain = await activeBrain(dir);
    assert.ok(brain);
    const izid = await callProvider({ ...brain, text: "Klicatelj vprasa", vsebinaKlica: true });
    assert.equal(izid.ok, true);
    assert.equal((await activeBrain(dir))?.model, "openai/gpt-6-luna");
    for (const z of zahteve) assert.match(z.url, /^https:\/\/openrouter\.ai\/api\/v1\//);
    for (const z of zahteve.filter((x) => x.metoda === "POST")) {
      assert.ok(!/:free/.test(String(z.telo.model)), "brezplacen model nikoli za klice");
      assert.equal(z.telo.provider?.data_collection, "deny");
    }
    // Seznam OpenRouter je javen: kljuc ne gre zraven.
    assert.equal(zahteve.find((z) => z.metoda === "GET")?.glave.authorization, undefined);
  });

  it("noben model ne odgovori: pravi vzrok (kljuc), nikoli »model: ...«, nic ne shrani", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "claude", model: "claude-sonnet-4-5", key: KLJUC }, token, dir);
    lazni({
      seznam: seznamAnthropic(["claude-sonnet-5-5"]),
      odgovor: (m) => (m === "claude-sonnet-4-5" ? ANTHROPIC_404(m) : { status: 401, telo: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } }),
    });
    const brain = await activeBrain(dir);
    assert.ok(brain);
    const izid = await callProvider({ ...brain, text: "Pozdravljena", vsebinaKlica: false });
    assert.equal(izid.ok, false);
    assert.ok(!izid.ok && /ključ ni veljaven/.test(izid.sporocilo), !izid.ok ? izid.sporocilo : "");
    assert.ok(!izid.ok && !/model: /.test(izid.sporocilo));
    assert.equal((await activeBrain(dir))?.model, "claude-sonnet-4-5");
  });

  it("401 pri delujocem modelu ne sprozi iskanja drugega modela", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "claude", model: "claude-sonnet-5-5", key: KLJUC }, token, dir);
    const { zahteve } = lazni({ seznam: seznamAnthropic(["claude-haiku-5-5"]), odgovor: () => ({ status: 401, telo: { error: { type: "authentication_error" } } }) });
    const brain = await activeBrain(dir);
    assert.ok(brain);
    assert.equal((await callProvider({ ...brain, text: "x", vsebinaKlica: false })).ok, false);
    assert.equal(zahteve.length, 1);
  });

  it("stalen (izmerjen) model klicatelja, ki ni shranjen, se ne zamenja; brez obvestila", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "claude", model: "claude-sonnet-5-5", key: KLJUC }, token, dir);
    const { zahteve } = lazni({ seznam: seznamAnthropic(["claude-haiku-5-5"]), odgovor: (m) => (m === "claude-opus-4-6" ? ANTHROPIC_404(m) : ANTHROPIC_OK) });
    const brain = await activeBrain(dir);
    assert.ok(brain);
    const izid = await callProvider({ ...brain, model: "claude-opus-4-6", text: "x", vsebinaKlica: false });
    assert.equal(izid.ok, false);
    assert.ok(!izid.ok && !/model: /.test(izid.sporocilo));
    assert.equal(zahteve.length, 1, "brez seznama in preizkusov");
    assert.equal((await activeBrain(dir))?.model, "claude-sonnet-5-5");
    assert.equal((await readBrain(token, dir)).zamenjavaModela, undefined);
  });

  it("preverba kljuca ne zamenja shranjenega modela in pove razumljivo", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "claude", model: "claude-sonnet-4-5", key: KLJUC }, token, dir);
    const { zahteve } = lazni({ seznam: seznamAnthropic(["claude-sonnet-5-5"]), odgovor: (m) => ANTHROPIC_404(m) });
    const izid = await checkBrain({ provider: "claude", model: "claude-sonnet-4-5" }, token, dir);
    assert.equal(izid.ok, false);
    assert.ok(!/model: /.test(izid.sporocilo));
    assert.match(izid.sporocilo, /Lina sama izbere/);
    assert.equal(zahteve.length, 1);
    assert.equal((await activeBrain(dir))?.model, "claude-sonnet-4-5");
  });
});

describe("ob shranjevanju kljuca Lina sama izbere delujoc model", { concurrency: 1 }, () => {
  it("seznam brez privzetega -> priporocen s seznama, ki je odgovoril; shranjen samo ta", async () => {
    const { dir, token } = await nova();
    const { zahteve } = lazni({
      seznam: seznamAnthropic(["claude-opus-5-5", "claude-haiku-5-5"]),
      odgovor: (m) => (m === "claude-haiku-5-5" ? ANTHROPIC_OK : ANTHROPIC_404(m)),
    });
    const izid = await saveBrain({ provider: "claude", model: "", key: KLJUC, samodejno: true }, token, dir);
    assert.equal(izid.model, "claude-haiku-5-5");
    assert.match(izid.sporociloModela ?? "", /claude-haiku-5-5/);
    assert.equal((await activeBrain(dir))?.model, "claude-haiku-5-5");
    assert.equal(zahteve[0]?.metoda, "GET");
    assert.equal(zahteve[0]?.url, "https://api.anthropic.com/v1/models?limit=100");
    assert.equal(zahteve[0]?.glave["x-api-key"], KLJUC);
    assert.ok(!zahteve.some((z) => z.telo.model === "claude-sonnet-5-5"), "model, ki ga ni na seznamu, se ne preizkusa");
  });

  it("seznam ni na voljo -> preizkusijo se priporoceni po vrsti", async () => {
    const { dir, token } = await nova();
    lazni({ seznam: { status: 500, telo: {} }, odgovor: (m) => (m === "claude-sonnet-5-5" ? ANTHROPIC_404(m) : ANTHROPIC_OK) });
    const izid = await saveBrain({ provider: "claude", key: KLJUC, samodejno: true }, token, dir);
    assert.equal(izid.model, "claude-haiku-5-5");
  });

  it("neveljaven kljuc: pravi vzrok, nic se ne shrani (prejsnja nastavitev klicev ostane)", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "grok", model: "grok-4.5", key: "xai-izmisljen-kljuc-0003" }, token, dir);
    lazni({ seznam: { status: 401, telo: {} }, odgovor: () => ({ status: 401, telo: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } }) });
    await assert.rejects(saveBrain({ provider: "claude", key: KLJUC, samodejno: true }, token, dir), /Claude: ključ ni veljaven/);
    assert.equal((await activeBrain(dir))?.provider, "grok");
  });

  it("ni dobroimetja: pove to, ne »model ne obstaja«", async () => {
    const { dir, token } = await nova();
    lazni({ seznam: seznamAnthropic(["claude-sonnet-5-5"]), odgovor: () => ({ status: 400, telo: { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } } }) });
    await assert.rejects(saveBrain({ provider: "claude", key: KLJUC, samodejno: true }, token, dir), (e: Error) => /dobroimetja/.test(e.message) && !/ne obstaja/.test(e.message));
  });

  it("ponudnik ni dosegljiv: shrani privzeti model z opozorilom", async () => {
    const { dir, token } = await nova();
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const izid = await saveBrain({ provider: "claude", key: KLJUC, samodejno: true }, token, dir);
    assert.equal(izid.model, DEFAULT_BRAIN_MODELS.claude);
    assert.match(izid.sporociloModela ?? "", /ni bilo mogoče preveriti/);
  });

  it("Vertex (prijava Google): samodejno ne preizkusa, projekt se shrani kot prej", async () => {
    const { dir, token } = await nova();
    globalThis.fetch = (async () => {
      throw new Error("omrezje ni dovoljeno");
    }) as typeof fetch;
    const izid = await saveBrain({ provider: "vertex", project: "moj-projekt-test", samodejno: true }, token, dir);
    assert.equal(izid.provider, "vertex");
    assert.equal(izid.model, DEFAULT_BRAIN_MODELS.vertex);
    assert.equal(izid.projekt, "moj-projekt-test");
  });

  it("okno Mozgani: model pod Napredno, samodejno ob shranjevanju, rocni model samo ce ga uporabnik spremeni", async () => {
    const koda = await readFile(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "components", "lina-desk.tsx"), "utf8");
    assert.match(koda, /model: rocniModel \? model : ""/);
    assert.match(koda, /samodejno: !rocniModel/);
    assert.match(koda, /<summary[^>]*>\{t\("uiNapredno"\)\}<\/summary>[\s\S]{0,200}htmlFor="model"/);
    assert.match(koda, /setModel\(event\.target\.value\);\s*setRocniModel\(true\)/);
    const besedila = await readFile(path.join(path.dirname(new URL(import.meta.url).pathname), "besedila.ts"), "utf8");
    assert.equal(besedila.match(/uiNapredno:/g)?.length, 2, "sl in en");
    assert.equal(besedila.match(/uiModelSamodejno:/g)?.length, 2, "sl in en");
  });

  it("rocno vpisan model (Napredno) ali brez zastavice: brez omrezja", async () => {
    const { dir, token } = await nova();
    globalThis.fetch = (async () => {
      throw new Error("omrezje ni dovoljeno");
    }) as typeof fetch;
    assert.equal((await saveBrain({ provider: "claude", model: "claude-opus-5-5", key: KLJUC, samodejno: true }, token, dir)).model, "claude-opus-5-5");
    assert.equal((await saveBrain({ provider: "claude", key: KLJUC }, token, dir)).model, DEFAULT_BRAIN_MODELS.claude);
  });
});
