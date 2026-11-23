/**
 * Pogovor lastnika z asistentko prek lastnega streznika (naloga #43): dolg odgovor se NE odreze na 500 znakov
 * (privzeta meja callProvider je za klice), in zahtevek res gre na lasten naslov. Brez pravega omrezja.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { asistentPogovor } from "./asistent-pogovor.server.ts";
import { setupOwner } from "./auth.server.ts";
import { shraniLastniStreznik } from "./keys.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-asistent-dolg-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const praviFetch = globalThis.fetch;
const NASLOV = "http://127.0.0.1:3192/v1";
const KLJUC = "freellmapi-izmisljen-kljuc-za-preizkus-5678";
let staroOkolje: string | undefined;

beforeEach(() => {
  staroOkolje = process.env.LINA_DATA;
});
afterEach(() => {
  globalThis.fetch = praviFetch;
  if (staroOkolje === undefined) delete process.env.LINA_DATA;
  else process.env.LINA_DATA = staroOkolje;
});

async function pripravi(): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  process.env.LINA_DATA = dir;
  const token = await setupOwner("geslo-test-1234", dir);
  await shraniLastniStreznik({ naslov: NASLOV, key: KLJUC, model: "auto", uporabiZaPogovor: true }, token, dir);
  return { dir, token };
}

describe("asistentka prek lastnega streznika", () => {
  it("dolg odgovor (1200 znakov) ostane cel in gre na lasten naslov", async () => {
    const { dir, token } = await pripravi();
    const dolg = "Odgovor ".repeat(150).trim();
    assert.ok(dolg.length > 1000);
    const klici: Array<{ url: string; telo: { max_tokens?: number } }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      klici.push({ url: String(url), telo: JSON.parse(String(init?.body ?? "{}")) as { max_tokens?: number } });
      return new Response(JSON.stringify({ choices: [{ message: { content: dolg }, finish_reason: "stop" }] }), { status: 200 });
    }) as typeof fetch;
    const izid = await asistentPogovor("Razlozi mi, kako deluje stroj za rezanje.", token, dir);
    assert.equal(izid.ok, true);
    assert.deepEqual(
      klici.map((k) => k.url),
      ["http://127.0.0.1:3192/v1/chat/completions"],
    );
    const zadnje = izid.zgodovina[izid.zgodovina.length - 1];
    assert.equal(zadnje.vloga, "lina");
    assert.equal(zadnje.besedilo.length, dolg.length);
  });

  it("odgovor nad mejo 2000 znakov se skrajsa na 2000", async () => {
    const { dir, token } = await pripravi();
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "x".repeat(3000) }, finish_reason: "stop" }] }), { status: 200 })) as typeof fetch;
    const izid = await asistentPogovor("Razlozi mi, kako deluje stroj za rezanje.", token, dir);
    assert.equal(izid.zgodovina[izid.zgodovina.length - 1].besedilo.length, 2000);
  });
});
