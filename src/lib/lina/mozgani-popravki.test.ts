/**
 * Popravki slepega pregleda mozganov (pregled-vecer-1405/mozgani/NAJDBE.md, M1-M5, M8). Lazni ponudniki, brez omrezja.
 * Sonda pregledovalca (pregled-mozgani-sonda.test.ts) je tu obrnjena v pravilno vedenje.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { activeBrain, izberiModelPogovora, saveBrain, shraniKljucAsistentke, zamenjajModel } from "./keys.server.ts";
import { callProvider, pozabiZamenjaveModelov } from "./providers.ts";
import { seznamModelov } from "./samodejni-model.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-mozgani-popravki-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const praviFetch = globalThis.fetch;
const KLJUC_OR = "sk-or-v1-izmisljen-test-kljuc-0001";
const KLJUC_OR_2 = "sk-or-v1-izmisljen-test-kljuc-0002";
const KLJUC_OM = "om-izmisljen-test-kljuc-0003";
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

type Z = { url: string; model?: string; vsebina?: string; kljuc?: string };
function lazni(seznam: string[], zivi: (m: string) => boolean): Z[] {
  const zahteve: Z[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const glave = new Headers(init?.headers);
    if ((init?.method ?? "GET") === "GET") {
      zahteve.push({ url: u });
      return new Response(JSON.stringify({ data: seznam.map((id) => ({ id })) }), { status: 200 });
    }
    const telo = JSON.parse(String(init?.body ?? "{}")) as { model?: string; messages?: Array<{ content?: unknown }> };
    zahteve.push({ url: u, model: telo.model, vsebina: JSON.stringify(telo.messages ?? []), kljuc: glave.get("authorization") ?? "" });
    if (zivi(String(telo.model))) return new Response(JSON.stringify({ choices: [{ message: { content: "da" } }] }), { status: 200 });
    return new Response(JSON.stringify({ error: { message: `${telo.model} is not a valid model ID`, code: 400 } }), { status: 400 });
  }) as typeof fetch;
  return zahteve;
}

/** Neskoncen tok: steje prebrane bajte (meja branja mora tok prekiniti). */
function velikTok(skupajBajtov: number, stevec: { prebrano: number }): ReadableStream<Uint8Array> {
  const kos = new Uint8Array(64 * 1024).fill(0x20);
  return new ReadableStream({
    pull(c) {
      if (stevec.prebrano >= skupajBajtov) return c.close();
      stevec.prebrano += kos.byteLength;
      c.enqueue(kos);
    },
  });
}

describe("M1: OpenRouter zamenja model samo z modelom ISTEGA izdelovalca", () => {
  it("anthropic/* izgine -> anthropic/claude-haiku-4.5, nikoli openai/*", async () => {
    const { dir, token } = await nova();
    lazni([], () => true);
    await saveBrain({ provider: "openrouter", key: KLJUC_OR, model: "anthropic/claude-sonnet-4.5" }, token, dir);
    const brain = await activeBrain(dir);
    const zahteve = lazni(["anthropic/claude-sonnet-4.5", "openai/gpt-4o", "anthropic/claude-haiku-4.5"], (m) => m !== "anthropic/claude-sonnet-4.5");
    const r = await callProvider({ ...brain!, text: "Klicatelj Ana Kovac, 041 123 456, sporoca zdravniski izvid." });
    assert.equal(r.ok, true);
    assert.deepEqual(zahteve.filter((z) => z.model && !z.model.startsWith("anthropic/")), [], "vsebina ne sme k drugemu izdelovalcu");
    assert.equal(zahteve.filter((z) => z.model).at(-1)!.model, "anthropic/claude-haiku-4.5");
    const kljuci = JSON.parse(await readFile(path.join(dir, "kljuci.json"), "utf8")) as { model: string };
    assert.equal(kljuci.model, "anthropic/claude-haiku-4.5");
  });

  it("brez modela istega izdelovalca: ni zamenjave, razlog, kljuci.json nespremenjen (fail-closed)", async () => {
    const { dir, token } = await nova();
    lazni([], () => true);
    await saveBrain({ provider: "openrouter", key: KLJUC_OR, model: "anthropic/claude-sonnet-4.5" }, token, dir);
    const brain = await activeBrain(dir);
    const zahteve = lazni(["anthropic/claude-sonnet-4.5", "openai/gpt-4o", "google/gemini-3-pro"], (m) => m !== "anthropic/claude-sonnet-4.5");
    const r = await callProvider({ ...brain!, text: "Klicatelj Ana Kovac sporoca." });
    assert.equal(r.ok, false);
    assert.equal(r.ok ? undefined : r.vzrok, "model");
    assert.deepEqual(zahteve.filter((z) => z.model && z.model !== "anthropic/claude-sonnet-4.5"), []);
    const kljuci = JSON.parse(await readFile(path.join(dir, "kljuci.json"), "utf8")) as { model: string };
    assert.equal(kljuci.model, "anthropic/claude-sonnet-4.5");
  });
});

describe("M2: OmniRoute brez samodejne zamenjave za klice", () => {
  it("klici: model izgine -> razlog, brez drugega modela prehoda, kljuci.json nespremenjen", async () => {
    const { dir, token } = await nova();
    lazni(["kr/claude-sonnet-4.5"], () => true);
    await saveBrain({ provider: "omniroute", key: KLJUC_OM, model: "kr/claude-sonnet-4.5", zaKlice: true }, token, dir);
    const brain = await activeBrain(dir);
    assert.equal(brain?.model, "kr/claude-sonnet-4.5");
    const zahteve = lazni(["gemini-cli/gemini-3-flash", "kr/claude-sonnet-4.5"], (m) => m === "gemini-cli/gemini-3-flash");
    const r = await callProvider({ ...brain!, text: "Klicatelj Ana Kovac sporoca." });
    assert.equal(r.ok, false);
    assert.equal(r.ok ? undefined : r.vzrok, "model");
    assert.deepEqual(zahteve.filter((z) => z.model && z.model !== "kr/claude-sonnet-4.5").map((z) => z.model), []);
    const kljuci = JSON.parse(await readFile(path.join(dir, "kljuci.json"), "utf8")) as { model: string };
    assert.equal(kljuci.model, "kr/claude-sonnet-4.5");
  });

  it("asistentka: samo model z isto predpono (nikoli auto ali drug ponudnik prehoda)", async () => {
    const { dir, token } = await nova();
    lazni(["kr/claude-sonnet-4.5"], () => true);
    await saveBrain({ provider: "omniroute", key: KLJUC_OM, model: "kr/claude-sonnet-4.5", zaKlice: true }, token, dir);
    const brain = await activeBrain(dir);
    const zahteve = lazni(["gemini-cli/gemini-3-flash", "kr/claude-sonnet-4.5", "kr/claude-haiku-4.5"], (m) => m !== "kr/claude-sonnet-4.5");
    const r = await callProvider({ ...brain!, vsebinaKlica: false, text: "Pozdravljena." });
    assert.equal(r.ok, true);
    const modeli = zahteve.filter((z) => z.model).map((z) => z.model);
    assert.ok(modeli.every((m) => m!.startsWith("kr/")), String(modeli));
    assert.equal(modeli.at(-1), "kr/claude-haiku-4.5");
    // Zamenjava asistentke ne spremeni mozganov za klice (kljuci.json).
    const kljuci = JSON.parse(await readFile(path.join(dir, "kljuci.json"), "utf8")) as { model: string };
    assert.equal(kljuci.model, "kr/claude-sonnet-4.5");
    assert.equal((await activeBrain(dir))?.model, "kr/claude-sonnet-4.5");
  });
});

describe("M3: zamenjava velja samo za isti kljuc in vlogo", () => {
  it("zamenjava asistentke (kljuc A) ne preusmeri klica s kljucem B mimo preizkusa", async () => {
    const { dir, token } = await nova();
    lazni([], () => true);
    await saveBrain({ provider: "openrouter", key: KLJUC_OR, model: "anthropic/claude-sonnet-4.5" }, token, dir);
    const brain = await activeBrain(dir);
    lazni(["anthropic/claude-sonnet-4.5", "anthropic/claude-haiku-4.5"], (m) => m !== "anthropic/claude-sonnet-4.5");
    const a = await callProvider({ ...brain!, key: KLJUC_OR_2, vsebinaKlica: false, text: "Pozdravljena." });
    assert.equal(a.ok, true);
    const kljuci = JSON.parse(await readFile(path.join(dir, "kljuci.json"), "utf8")) as { model: string };
    assert.equal(kljuci.model, "anthropic/claude-sonnet-4.5", "zamenjava asistentke ne sme spremeniti modela klicev");
    assert.equal((await activeBrain(dir))?.model, "anthropic/claude-sonnet-4.5");
    // Drug racun vidi drug seznam: za klic s kljucem A mora Lina najprej poskusiti shranjeni model, ne zamenjave racuna B.
    const zahteve = lazni(["anthropic/claude-sonnet-4.5"], () => true);
    const k = await callProvider({ ...brain!, key: KLJUC_OR, model: "anthropic/claude-sonnet-4.5", text: "Klicatelj sporoca." });
    assert.equal(k.ok, true);
    assert.equal(zahteve.filter((z) => z.model)[0]!.model, "anthropic/claude-sonnet-4.5");
  });
});

describe("M3: tekoci klic istega racuna po zamenjavi iz asistentke", () => {
  it("klic s starim modelom v pomnilniku (isti kljuc) dobi zamenjavo, ne napake", async () => {
    const { dir, token } = await nova();
    lazni([], () => true);
    await saveBrain({ provider: "openrouter", key: KLJUC_OR, model: "anthropic/claude-sonnet-4.5" }, token, dir);
    const brain = await activeBrain(dir);
    lazni(["anthropic/claude-sonnet-4.5", "anthropic/claude-haiku-4.5"], (m) => m !== "anthropic/claude-sonnet-4.5");
    const a = await callProvider({ ...brain!, vsebinaKlica: false, text: "Pozdravljena." });
    assert.equal(a.ok, true);
    assert.equal((await activeBrain(dir))?.model, "anthropic/claude-haiku-4.5", "isti racun: model klicev zamenjan");
    const k = await callProvider({ ...brain!, text: "Klicatelj sporoca." });
    assert.equal(k.ok, true, JSON.stringify(k));
  });
});

describe("M4: zamenjajModel ne prepise hkratnega shranjevanja", () => {
  it("hkratna zamenjava in izbira asistentke: ohranita se obe spremembi", async () => {
    for (let zamik = 0; zamik < 12; zamik++) {
      const { dir, token } = await nova();
      lazni([], () => true);
      await saveBrain({ provider: "openrouter", key: KLJUC_OR, model: "anthropic/claude-sonnet-4.5" }, token, dir);
      await shraniKljucAsistentke({ key: KLJUC_OR_2, model: "anthropic/claude-opus-4.5" }, token, dir);
      await izberiModelPogovora({ provider: "openrouter", model: "anthropic/claude-sonnet-4.5" }, token, dir);
      const izbira = (async () => {
        for (let i = 0; i < zamik; i++) await new Promise((r) => setImmediate(r));
        await izberiModelPogovora({ provider: "openrouter", model: "anthropic/claude-opus-4.5" }, token, dir);
      })();
      await Promise.all([zamenjajModel("openrouter", "anthropic/claude-sonnet-4.5", "anthropic/claude-haiku-4.5", "obvestilo", dir), izbira]);
      const p = JSON.parse(await readFile(path.join(dir, "ponudniki.json"), "utf8")) as { pogovor: { model: string } | null };
      const kljuci = JSON.parse(await readFile(path.join(dir, "kljuci.json"), "utf8")) as { model: string };
      assert.equal(kljuci.model, "anthropic/claude-haiku-4.5", `zamik ${zamik}`);
      // Lastnikova izbira (opus) je zadnja ali pa jo je zamenjava videla in pustila: nikoli izgubljena.
      assert.equal(p.pogovor?.model, "anthropic/claude-opus-4.5", `zamik ${zamik}: izbira lastnika izgubljena`);
    }
  });
});

describe("M5: odgovori brez meje velikosti", () => {
  it("seznam modelov prevelik -> null, tok prekinjen", async () => {
    const stevec = { prebrano: 0 };
    const f = (async () => new Response(velikTok(64 * 1024 * 1024, stevec), { status: 200 })) as unknown as typeof fetch;
    const seznam = await seznamModelov("openai", "sk-izmisljen-0001", f as never);
    assert.equal(seznam, null);
    assert.ok(stevec.prebrano <= 9 * 1024 * 1024, `prebrano ${stevec.prebrano}`);
  });

  it("odgovor ponudnika prevelik -> napaka, tok prekinjen", async () => {
    const stevec = { prebrano: 0 };
    globalThis.fetch = (async () => new Response(velikTok(64 * 1024 * 1024, stevec), { status: 200 })) as unknown as typeof fetch;
    const r = await callProvider({ provider: "openai", model: "gpt-5", key: "sk-izmisljen-0001", vsebinaKlica: false, text: "Pozdravljena." });
    assert.equal(r.ok, false);
    assert.ok(stevec.prebrano <= 3 * 1024 * 1024, `prebrano ${stevec.prebrano}`);
  });
});

describe("M8: stari prehod ne posilja kljuca in vsebine po golem http v domace omrezje", () => {
  it("http://192.168.1.5 -> nobene zahteve tja, izbrani ponudnik z opozorilom", async () => {
    const zahteve = lazni([], () => true);
    const prehod = { vklop: true, naslov: "http://192.168.1.5:20128/v1", klici: true, kljuc: "prehod-izmisljen-kljuc-01" };
    const r = await callProvider({ provider: "openai", model: "gpt-5", key: "sk-izmisljen-0001", prehod, text: "Klicatelj Ana Kovac." });
    assert.equal(r.ok, true);
    assert.deepEqual(zahteve.filter((z) => z.url.includes("192.168.")).map((z) => z.url), []);
    assert.match(r.ok ? (r.opozorilo ?? "") : "", /https|ta računalnik|http/);
  });

  it("http://127.0.0.1 (ta racunalnik) gre se vedno prek prehoda", async () => {
    const zahteve = lazni([], () => true);
    const prehod = { vklop: true, naslov: "http://127.0.0.1:20128/v1", klici: true, kljuc: "prehod-izmisljen-kljuc-01" };
    const r = await callProvider({ provider: "openai", model: "gpt-5", key: "sk-izmisljen-0001", prehod, text: "Pozdrav." });
    assert.equal(r.ok, true);
    assert.equal(zahteve[0]?.url, "http://127.0.0.1:20128/v1/chat/completions");
  });
});
