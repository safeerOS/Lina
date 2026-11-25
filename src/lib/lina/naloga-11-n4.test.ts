/**
 * Naloga 11, N4: kadar Lina sama vsili data_collection = deny (klic z orodji, vednoDeny), 404/503 brezplacnega modela ne svetuje
 * vklopa brezplacnih modelov v racunu OpenRouter (to napake ne odpravi), ampak izbiro drugega modela. Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { callProvider, callProviderZOrodji, razlogOpenRouter } from "./providers.ts";

const praviFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = praviFetch;
});
const odgovor = (status: number) => (async () => new Response('{"error":{"message":"No endpoints found matching your data policy"}}', { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
const brain = { provider: "openrouter", model: "google/gemma-4-31b-it:free", key: "sk-or-x-12345678", brezplacniDovoljeni: true } as const;

describe("N4: sporocilo za 404/503 pri vsiljenem deny", () => {
  it("razlogOpenRouter z vednoDeny: brez nasveta o Privacy, z nasvetom za drug model", () => {
    for (const status of [404, 503]) {
      const s = razlogOpenRouter(status, { model: brain.model, brezplacniDovoljeni: true, asistentka: true, vednoDeny: true }) ?? "";
      assert.doesNotMatch(s, /Privacy|vklopite/);
      assert.match(s, /ne zbira podatkov/);
      assert.match(s, /drug model|plačljiv/);
    }
  });

  it("kontrola: brez vednoDeny ostane dosedanje besedilo (stikalo v racunu)", () => {
    assert.match(razlogOpenRouter(404, { model: brain.model, brezplacniDovoljeni: true, asistentka: true }) ?? "", /Privacy/);
  });

  it("klic z orodji (orkestrator) na :free z 404: pravo sporocilo", async () => {
    globalThis.fetch = odgovor(404);
    const r = await callProviderZOrodji({ ...brain }, [{ vloga: "uporabnik", besedilo: "x" }], [], { vsebinaKlica: false });
    assert.equal(r.ok, false);
    assert.doesNotMatch(r.ok ? "" : r.sporocilo, /Privacy/);
    assert.match(r.ok ? "" : r.sporocilo, /ne zbira podatkov/);
  });

  it("callProvider z vednoDeny (ocena izida) na :free s 503: pravo sporocilo", async () => {
    globalThis.fetch = odgovor(503);
    const r = await callProvider({ ...brain, text: "x", vsebinaKlica: false, vednoDeny: true });
    assert.equal(r.ok, false);
    assert.doesNotMatch(r.ok ? "" : r.sporocilo, /Privacy/);
    assert.match(r.ok ? "" : r.sporocilo, /ne zbira podatkov/);
  });
});
