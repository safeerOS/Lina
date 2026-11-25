/**
 * Naloga 9, V11 (B9: podatki ne gredo drugemu ponudniku samodejno): vsak klic OpenRouter iz orkestratorja (zanka z orodji IN
 * samopregled cilja) poslje provider.data_collection = "deny", tudi z brezplacnim modelom in vklopljenim stikalom asistentke.
 * Izidi orodij so vsebina datotek in spleta, ne pogovor lastnika, zato izjema B2 (brez deny za :free) tu ne velja.
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { pogovorBrain, shraniKljucAsistentke } from "./keys.server.ts";
import { ustvariOrkestrator } from "./orkestrator.server.ts";
import { providerRequest, providerRequestZOrodji } from "./providers.ts";
import { jeTocnoBrezplacen } from "./types.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-n9-v11-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const praviFetch = globalThis.fetch;
const DENY = { data_collection: "deny" };
const prejLinaData = process.env.LINA_DATA;

afterEach(() => {
  globalThis.fetch = praviFetch;
  if (prejLinaData === undefined) delete process.env.LINA_DATA;
  else process.env.LINA_DATA = prejLinaData;
});

// naloga 11 N9: preizkus ne pusti LINA_DATA spremenjene za druge preizkuse v istem procesu
after(() => assert.equal(process.env.LINA_DATA, prejLinaData));

describe("V11: callProviderZOrodji vedno z deny", () => {
  it("OpenRouter :free s stikalom in vsebinaKlica false: telo ima provider.data_collection = deny", () => {
    const { init } = providerRequestZOrodji(
      { provider: "openrouter", model: "google/gemma-4-31b-it:free", key: "sk-or-x-12345678", brezplacniDovoljeni: true },
      [{ vloga: "uporabnik", besedilo: "x" }],
      [],
      { vsebinaKlica: false },
    );
    assert.deepEqual((JSON.parse(String(init.body)) as { provider?: unknown }).provider, DENY);
  });

  it("callProvider z vednoDeny: deny ostane tudi ob vseh stirih pogojih izjeme B2", () => {
    const telo = JSON.parse(String(providerRequest({
      provider: "openrouter", model: "google/gemma-4-31b-it:free", key: "k-12345678", text: "x",
      brezplacniDovoljeni: true, vsebinaKlica: false, vednoDeny: true,
    } as Parameters<typeof providerRequest>[0]).init.body)) as { provider?: unknown };
    assert.deepEqual(telo.provider, DENY);
  });
});

describe("V11: orkestrator s privzetimi odvisnostmi (pravi pogovorBrain, klic modela in samopregled)", () => {
  it("asistentka na OpenRouter :free s stikalom: vsaka zahteva na openrouter.ai nosi deny", async () => {
    const dir = await mkdtemp(path.join(KOREN, "d-"));
    process.env.LINA_DATA = dir;
    const token = await setupOwner("geslo-test-1234", dir);
    await shraniKljucAsistentke({ key: "sk-or-v1-izmisljen-kljuc-asistentke-3333", soglasje: true }, token, dir);
    const brain = await pogovorBrain(dir);
    // kontrola predpogoja: brez nje bi preizkus lahko uspel samo zato, ker model ni brezplacen
    assert.equal(brain?.provider, "openrouter");
    assert.equal(brain?.brezplacniDovoljeni, true);
    assert.equal(jeTocnoBrezplacen(brain?.model ?? ""), true, brain?.model);

    const telesa: Array<{ url: string; provider?: unknown; orodja: boolean }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const telo = init?.body ? (JSON.parse(String(init.body)) as { provider?: unknown; tools?: unknown }) : {};
      telesa.push({ url: String(url), provider: telo.provider, orodja: Array.isArray(telo.tools) });
      const vsebina = Array.isArray(telo.tools)
        ? "Koncni odgovor: datoteka ima tri vrstice."
        : JSON.stringify({ ovira: "dosezeno", dokaz: "tri vrstice", korak: "" });
      return new Response(JSON.stringify({ choices: [{ message: { content: vsebina }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 3 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const o = ustvariOrkestrator(dir, { ucenje: null, imaGeslo: async () => true });
    const s = await o.nova({ cilj: "Preberi datoteko in povej, koliko vrstic ima." });
    const konec = await o.teci(s.id);
    assert.equal(konec.faza, "koncano", JSON.stringify(konec.dogodki.slice(-3)));
    const openrouter = telesa.filter((t) => t.url.startsWith("https://openrouter.ai/"));
    // oba klica: zanka z orodji in samopregled cilja (callProvider)
    assert.ok(openrouter.some((t) => t.orodja), JSON.stringify(telesa));
    assert.ok(openrouter.some((t) => !t.orodja), JSON.stringify(telesa));
    for (const t of openrouter) assert.deepEqual(t.provider, DENY, JSON.stringify(t));
  });
});
