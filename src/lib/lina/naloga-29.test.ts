/**
 * Naloga 29: umik modelov Claude (preslikava ob zagonu z obvestilom), D1 (Claude z orodji brez temperature) in D3 (prazna ovojnica
 * ponudnika ni uspeh). Lazni fetch, izmisljeni kljuci, brez omrezja. Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { setupOwner } from "./auth.server.ts";
import { nastaviOgrevanjeZaPreizkus } from "./ogrevanje-klica.server.ts";
import { nastaviToplePovezave } from "./povezave.server.ts";
import { activeBrain, checkBrain, izberiModelPogovora, preslikajUmaknjeneModele, readBrain, saveBrain } from "./keys.server.ts";
import { callProvider, callProviderZOrodji, NEPRICAKOVAN_ODGOVOR, PRAZEN_ODGOVOR, preizkusiModel, pozabiZamenjaveModelov, providerRequest } from "./providers.ts";
import { DEFAULT_BRAIN_MODELS, naslednikUmaknjenegaClaude, PRIPOROCENI_MODELI, UMAKNJENI_MODELI_CLAUDE } from "./types.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-naloga-29-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const praviFetch = globalThis.fetch;
const KLJUC = "sk-ant-izmisljen-preizkusni-kljuc-0029";
const OKOLJE = ["OPENROUTER_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "LINA_DATA"];
const shranjeno: Record<string, string | undefined> = {};

async function nova(): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  process.env.LINA_DATA = dir;
  return { dir, token: await setupOwner("geslo-test-1234", dir) };
}

beforeEach(() => {
  // N5: saveBrain po 1 s ogreje povezave (topel bazen obide globalThis.fetch v pravo omrezje) - v preizkusu brez ogrevanja
  nastaviOgrevanjeZaPreizkus(async () => {});
  nastaviToplePovezave(false);
  // brez omrezja tudi za korake pred laznim fetch (saveBrain, izbira asistentke)
  brezOmrezja();
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

/** Lazni fetch: vsak POST dobi isti odgovor; telesa zahtev se zajamejo. */
function lazni(status: number, telo: string): Array<Record<string, unknown>> {
  const zajeto: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    zajeto.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return new Response(telo, { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return zajeto;
}

function brezOmrezja(): { klici: number } {
  const s = { klici: 0 };
  globalThis.fetch = (async () => {
    s.klici++;
    throw new TypeError("omrezje v tem preizkusu ni dovoljeno");
  }) as typeof fetch;
  return s;
}

describe("naloga 29: umaknjeni modeli Claude", () => {
  it("tabela: noben privzet ali priporocen model ni umaknjen, noben naslednik ni umaknjen, datumi so YYYY-MM-DD", () => {
    const kljuci = Object.keys(UMAKNJENI_MODELI_CLAUDE);
    assert.ok(kljuci.includes("claude-sonnet-4-5") && kljuci.includes("claude-sonnet-4-5-20250929"));
    for (const m of [...Object.values(DEFAULT_BRAIN_MODELS), ...Object.values(PRIPOROCENI_MODELI).flat()]) assert.ok(!kljuci.includes(m), m);
    for (const [k, z] of Object.entries(UMAKNJENI_MODELI_CLAUDE)) {
      assert.ok(!kljuci.includes(z.naslednik), `${k} -> ${z.naslednik}`);
      assert.match(z.umik, /^\d{4}-\d{2}-\d{2}$/, k);
    }
    assert.equal(naslednikUmaknjenegaClaude("claude-sonnet-4-5", "2026-11-29"), null, "pred umikom model se dela");
    assert.equal(naslednikUmaknjenegaClaude("claude-sonnet-4-5", "2026-11-30"), "claude-sonnet-5-5");
    assert.equal(naslednikUmaknjenegaClaude("toString", "2030-01-01"), null, "lastnosti predmeta niso modeli");
    assert.equal(naslednikUmaknjenegaClaude("claude-sonnet-5-5", "2030-01-01"), null);
  });

  it("ob zagonu: klici, ponudnik in izbira asistentke na umaknjenem modelu -> naslednik, obvestilo, brez omrezja", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "claude", model: "claude-sonnet-4-5", key: KLJUC }, token, dir);
    await izberiModelPogovora({ provider: "claude", model: "claude-sonnet-4-5" }, token, dir);
    const omrezje = brezOmrezja();
    assert.deepEqual(await preslikajUmaknjeneModele(dir, "2026-11-30"), ["claude-sonnet-4-5"]);
    assert.equal(omrezje.klici, 0);
    assert.equal((await activeBrain(dir))?.model, "claude-sonnet-5-5", "klici");
    const pogled = await readBrain(token, dir);
    assert.equal(pogled.model, "claude-sonnet-5-5");
    assert.deepEqual(pogled.pogovor, { provider: "claude", model: "claude-sonnet-5-5" }, "asistentka");
    const claude = pogled.shranjeni?.find((p) => p.provider === "claude");
    assert.equal(claude?.model, "claude-sonnet-5-5", "ponudnik");
    assert.ok(!claude?.modeli.includes("claude-sonnet-4-5"));
    assert.match(pogled.zamenjavaModela ?? "", /umaknil claude-sonnet-4-5 \(zdaj claude-sonnet-5-5\)/, "obvestilo lastniku");
    assert.deepEqual(await preslikajUmaknjeneModele(dir, "2026-11-30"), [], "drugi zagon nic ne spremeni");
  });

  it("pred datumom umika in na zivem modelu ostane lastnikova izbira, brez obvestila", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "claude", model: "claude-sonnet-4-5", key: KLJUC }, token, dir);
    brezOmrezja();
    assert.deepEqual(await preslikajUmaknjeneModele(dir, "2026-11-29"), []);
    assert.equal((await activeBrain(dir))?.model, "claude-sonnet-4-5");
    assert.equal((await readBrain(token, dir)).zamenjavaModela, undefined);
    const drugi = await nova();
    await saveBrain({ provider: "claude", model: "claude-opus-4-5", key: KLJUC }, drugi.token, drugi.dir);
    assert.deepEqual(await preslikajUmaknjeneModele(drugi.dir, "2026-12-01"), [], "opus 4.5 dela do 22. 1. 2027");
    assert.equal((await activeBrain(drugi.dir))?.model, "claude-opus-4-5");
    const tretji = await nova();
    await saveBrain({ provider: "claude", model: "claude-sonnet-5-5", key: KLJUC }, tretji.token, tretji.dir);
    assert.deepEqual(await preslikajUmaknjeneModele(tretji.dir, "2030-01-01"), []);
    assert.equal((await activeBrain(tretji.dir))?.model, "claude-sonnet-5-5");
  });

  it("N4: dve zamenjavi (klici in asistentka) -> obe v enem obvestilu", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "claude", model: "claude-3-haiku-20240307", key: KLJUC }, token, dir);
    await saveBrain({ provider: "claude", model: "claude-3-7-sonnet-20250219", key: KLJUC }, token, dir);
    await izberiModelPogovora({ provider: "claude", model: "claude-3-7-sonnet-20250219" }, token, dir);
    await saveBrain({ provider: "claude", model: "claude-3-haiku-20240307", key: KLJUC }, token, dir);
    brezOmrezja();
    const zamenjani = await preslikajUmaknjeneModele(dir, "2026-11-30");
    assert.deepEqual([...zamenjani].sort(), ["claude-3-7-sonnet-20250219", "claude-3-haiku-20240307"]);
    const pogled = await readBrain(token, dir);
    assert.equal(pogled.model, "claude-haiku-4-5-20251001");
    assert.deepEqual(pogled.pogovor, { provider: "claude", model: "claude-sonnet-5-5" });
    assert.match(pogled.zamenjavaModela ?? "", /claude-3-haiku-20240307 \(zdaj claude-haiku-4-5-20251001\)/);
    assert.match(pogled.zamenjavaModela ?? "", /claude-3-7-sonnet-20250219 \(zdaj claude-sonnet-5-5\)/);
  });

  it("N3: pokvarjen ponudniki.json -> preslikava nicesar ne zapise", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "claude", model: "claude-sonnet-4-5", key: KLJUC }, token, dir);
    const pot = path.join(dir, "ponudniki.json");
    await writeFile(pot, "{ pokvarjeno", { mode: 0o600 });
    brezOmrezja();
    assert.deepEqual(await preslikajUmaknjeneModele(dir, "2026-11-30"), []);
    assert.equal(await readFile(pot, "utf8"), "{ pokvarjeno");
    assert.equal((await activeBrain(dir))?.model, "claude-sonnet-4-5");
    for (const vsebina of ["[]", '"x"', '{"ponudniki":"abc"}']) {
      await writeFile(pot, vsebina, { mode: 0o600 });
      assert.deepEqual(await preslikajUmaknjeneModele(dir, "2026-11-30"), [], vsebina);
      assert.equal(await readFile(pot, "utf8"), vsebina);
    }
  });

  it("zagon programa poklice preslikavo pred orkestratorjem in asistentko", () => {
    // shortcut: preverba vrstnega reda v izvorni kodi (handleZagonRequest zazene prave storitve), ce dobi zagon vbrizgane odvisnosti - vedenjski preizkus
    const vir = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "zagon.server.ts"), "utf8");
    const i = vir.indexOf("preslikajUmaknjeneModele(dir)");
    assert.ok(i > 0);
    assert.ok(i < vir.indexOf("zazeniOrkestrator(dir)") && i < vir.indexOf("uskladiAsistenta(dir)"));
  });
});

describe("naloga 29 D1: Claude z orodji brez temperature", () => {
  const CLAUDE_OK = JSON.stringify({ content: [{ type: "text", text: "Ok." }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
  const OPENAI_OK = JSON.stringify({ choices: [{ message: { content: "Ok." }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });

  it("telo zahteve Claude nima temperature, tudi ko jo klicatelj poda", async () => {
    for (const temperatura of [undefined, 0, 0.7]) {
      const zajeto = lazni(200, CLAUDE_OK);
      const r = await callProviderZOrodji(
        { provider: "claude", model: "claude-sonnet-5-5", key: KLJUC },
        [{ vloga: "uporabnik", besedilo: "Zivjo" }],
        [],
        temperatura === undefined ? {} : { temperatura },
      );
      assert.equal(r.ok, true);
      assert.equal(zajeto.length, 1);
      assert.ok(!Object.hasOwn(zajeto[0]!, "temperature"), `temperatura ${temperatura}`);
      assert.equal(zajeto[0]!.model, "claude-sonnet-5-5");
    }
  });

  it("kontrola: OpenAI z orodji temperaturo poslje kot doslej; Claude brez orodij je nima", async () => {
    const zajeto = lazni(200, OPENAI_OK);
    const r = await callProviderZOrodji({ provider: "openai", model: "gpt-6-luna", key: "sk-izmisljen" }, [{ vloga: "uporabnik", besedilo: "Zivjo" }], [], { temperatura: 0.7 });
    assert.equal(r.ok, true);
    assert.equal(zajeto[0]!.temperature, 0.7);
    const { init } = providerRequest({ provider: "claude", model: "claude-sonnet-5-5", key: KLJUC, text: "x" });
    assert.ok(!Object.hasOwn(JSON.parse(String(init.body)) as object, "temperature"));
  });
});

describe("naloga 29 D3: prazna ovojnica ponudnika ni uspeh", () => {
  const klic = (provider: "gemini" | "openai" | "claude") => callProvider({ provider, model: DEFAULT_BRAIN_MODELS[provider], key: "izmisljen-kljuc-0029", text: "Zivjo", vsebinaKlica: false });

  it("Gemini brez parts, OpenAI s praznim content, Claude s praznim ali napacnim content -> ok:false brez surovega telesa", async () => {
    await nova();
    const primeri: Array<["gemini" | "openai" | "claude", unknown]> = [
      ["gemini", { candidates: [{ content: { role: "model" }, finishReason: "STOP" }] }],
      ["openai", { choices: [{ message: { content: "" }, finish_reason: "stop" }] }],
      ["openai", { choices: [] }],
      ["claude", { content: [], stop_reason: "end_turn" }],
      ["claude", { content: "napacna oblika", stop_reason: "end_turn" }],
      ["claude", { content: [{ type: "thinking", thinking: "..." }], stop_reason: "max_tokens" }],
    ];
    for (const [provider, telo] of primeri) {
      const zajeto = lazni(200, JSON.stringify(telo));
      const r = await klic(provider);
      assert.equal(zajeto.length, 1, "zahteva gre skozi lazni fetch, ne v omrezje");
      assert.deepEqual(r, { ok: false, sporocilo: PRAZEN_ODGOVOR }, `${provider} ${JSON.stringify(telo)}`);
    }
  });

  it("napaka s 200 in JSON brez ovojnice -> nepricakovan odgovor (ne prazen), brez besedila ponudnika", async () => {
    await nova();
    const primeri: Array<["gemini" | "openai" | "claude", unknown, string]> = [
      ["gemini", { promptFeedback: { blockReason: "SAFETY" }, usageMetadata: { promptTokenCount: 3 } }, NEPRICAKOVAN_ODGOVOR],
      ["openai", { error: { message: "model: claude-x", code: 502 } }, NEPRICAKOVAN_ODGOVOR],
      ["openai", { podjetje: "X", vrstice: [] }, NEPRICAKOVAN_ODGOVOR],
      ["openai", [1, 2], NEPRICAKOVAN_ODGOVOR],
      ["claude", {}, NEPRICAKOVAN_ODGOVOR],
      ["claude", null, NEPRICAKOVAN_ODGOVOR],
    ];
    for (const [provider, telo, sporocilo] of primeri) {
      const zajeto = lazni(200, JSON.stringify(telo));
      assert.deepEqual(await klic(provider), { ok: false, sporocilo }, JSON.stringify(telo));
      assert.equal(zajeto.length, 1);
    }
  });

  it("kontrole: golo besedilo, content kot polje delov in pravi odgovor ostanejo uspeh", async () => {
    await nova();
    lazni(200, "Dober dan");
    assert.deepEqual(await klic("gemini"), { ok: true, text: "Dober dan" });
    lazni(200, JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: "Dober " }, { type: "text", text: "dan." }] } }] }));
    assert.deepEqual(await klic("openai"), { ok: true, text: "Dober dan." }, "N8");
    lazni(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: "Pozdravljeni." }] } }] }));
    assert.deepEqual(await klic("gemini"), { ok: true, text: "Pozdravljeni." });
  });

  it("preizkusni klic samodejne izbire: prazna ovojnica s 200 pomeni, da model obstaja", async () => {
    await nova();
    lazni(200, JSON.stringify({ content: [{ type: "thinking", thinking: "..." }], stop_reason: "max_tokens" }));
    const r = await preizkusiModel({ provider: "claude", model: "claude-opus-5-5", key: KLJUC, text: "Odgovori samo z besedo: da.", maxTokens: 8, vsebinaKlica: true });
    assert.equal(r.ok, true);
  });

  it("N1: preverba kljuca s prazno ovojnico pove, da kljuc deluje (kot samodejna izbira)", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "claude", model: "claude-opus-5-5", key: KLJUC }, token, dir);
    const zajeto = lazni(200, JSON.stringify({ content: [{ type: "thinking", thinking: "..." }], stop_reason: "max_tokens" }));
    const izid = await checkBrain({ provider: "claude", model: "claude-opus-5-5" }, token, dir);
    assert.equal(zajeto.length, 1);
    assert.deepEqual(izid, { ok: true, sporocilo: "Ključ deluje." });
  });

  it("N1 meja: preverba kljuca in preizkus modela NE sprejmeta {error} s 200 ali {} kot delujoc kljuc", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "claude", model: "claude-opus-5-5", key: KLJUC }, token, dir);
    for (const telo of [{ error: { code: 401, message: "invalid x-api-key" } }, {}]) {
      lazni(200, JSON.stringify(telo));
      const izid = await checkBrain({ provider: "claude", model: "claude-opus-5-5" }, token, dir);
      assert.equal(izid.ok, false, JSON.stringify(telo));
      lazni(200, JSON.stringify(telo));
      assert.equal((await preizkusiModel({ provider: "claude", model: "claude-opus-5-5", key: KLJUC, text: "da", maxTokens: 8, vsebinaKlica: true })).ok, false);
    }
  });
});
