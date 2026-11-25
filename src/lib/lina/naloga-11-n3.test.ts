/**
 * Naloga 11, N3 (B9): tuja vsebina gre na OpenRouter vedno z data_collection = deny, tudi :free s stikalom asistentke.
 * Ocena izida agenta (oceniZModelom, pot telefona asistent-telefon.server.ts) in ocena novic (vsebina virov s spleta).
 * Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { oceniZModelom } from "./cilj-naloge.server.ts";
import { pogovorBrain, shraniKljucAsistentke } from "./keys.server.ts";
import { jeTocnoBrezplacen } from "./types.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-n11-n3-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const praviFetch = globalThis.fetch;
const DENY = { data_collection: "deny" };

afterEach(() => {
  globalThis.fetch = praviFetch;
});

describe("N3: ocena izida agenta vedno z deny", () => {
  it("privzeti klic (callProvider) z mozgani asistentke na OpenRouter :free s stikalom: zahteva nosi deny", async () => {
    const dir = mkdtempSync(path.join(KOREN, "d-"));
    const token = await setupOwner("geslo-test-1234", dir);
    await shraniKljucAsistentke({ key: "sk-or-v1-izmisljen-kljuc-asistentke-4444", soglasje: true }, token, dir);
    const brain = await pogovorBrain(dir);
    // predpogoj: sicer bi deny prisel samo zato, ker model ni brezplacen
    assert.equal(brain?.provider, "openrouter");
    assert.equal(brain?.brezplacniDovoljeni, true);
    assert.equal(jeTocnoBrezplacen(brain?.model ?? ""), true, brain?.model);
    const telesa: Array<{ url: string; provider?: unknown }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const telo = init?.body ? (JSON.parse(String(init.body)) as { provider?: unknown }) : {};
      telesa.push({ url: String(url), provider: telo.provider });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ovira":"dosezeno","dokaz":"x"}' }, finish_reason: "stop" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    // kot asistent-telefon.server.ts: oceniZModelom(() => pogovorBrain(root), undefined, dovoljeno)
    const o = await oceniZModelom(() => pogovorBrain(dir) as never, undefined, async () => true)("Popravi README.", "Koncano: README popravljen, preizkus 3/3.");
    assert.ok(o, "ocena je bila narejena");
    const or = telesa.filter((t) => t.url.startsWith("https://openrouter.ai/"));
    assert.ok(or.length >= 1, JSON.stringify(telesa));
    for (const t of or) assert.deepEqual(t.provider, DENY, JSON.stringify(t));
  });

  it("vbrizgan klic dobi vednoDeny: true (privzeto za vse uporabnike oceniZModelom)", async () => {
    let dobljeno: Record<string, unknown> | null = null;
    await oceniZModelom(async () => ({ provider: "openrouter", model: "x:free", key: "k" }), async (c) => ((dobljeno = c), { ok: true, text: "" }))("c", "i");
    assert.equal(dobljeno!.vednoDeny, true);
  });
});

describe("N3: ocena novic (vsebina virov s spleta) z deny", () => {
  it("klic ponudnika v novice.server.ts nosi vednoDeny: true", () => {
    const f = readFileSync(path.join(import.meta.dirname, "novice.server.ts"), "utf8");
    const i = f.indexOf("await callProvider({");
    assert.ok(i > 0);
    assert.match(f.slice(i, f.indexOf("});", i)), /vednoDeny: true/);
  });
});
