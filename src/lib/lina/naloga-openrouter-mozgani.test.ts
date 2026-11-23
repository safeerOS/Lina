/**
 * OpenRouter kot ponudnik mozganov Line (lastnik 21. 11. 2026): kljuc se shrani sifriran, mozgani ga uporabijo,
 * preverba kljuca poklice samo openrouter.ai z data_collection = deny, razlogi napak so razumljivi in brez kljuca,
 * okno Mozgani ponudi izbiro. Nikjer pravega omrezja (fetch je lazni), kljuci so izmisljeni.
 * Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { activeBrain, checkBrain, readBrain, saveBrain } from "./keys.server.ts";
import { llmConfigured } from "./llm.server.ts";
import { razlogOpenRouter } from "./providers.ts";
import { DEFAULT_BRAIN_MODELS } from "./types.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-openrouter-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const praviFetch = globalThis.fetch;
const KLJUC = "sk-or-v1-izmisljen-preizkusni-kljuc-1234";
const OKOLJE = ["OPENROUTER_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "LINA_DATA"];
const shranjenoOkolje: Record<string, string | undefined> = {};

async function nova(): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  process.env.LINA_DATA = dir;
  return { dir, token: await setupOwner("geslo-test-1234", dir) };
}

beforeEach(() => {
  for (const ime of OKOLJE) {
    shranjenoOkolje[ime] = process.env[ime];
    if (ime !== "LINA_DATA") delete process.env[ime];
  }
});

afterEach(() => {
  globalThis.fetch = praviFetch;
  for (const ime of OKOLJE) {
    if (shranjenoOkolje[ime] === undefined) delete process.env[ime];
    else process.env[ime] = shranjenoOkolje[ime];
  }
});

type Vidno = { url: string; avtorizacija: string; telo: { model?: string; provider?: { data_collection?: string } } };

function lazniFetch(status: number, odgovor: unknown, vidno: Vidno[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const glave = init?.headers as Record<string, string>;
    vidno.push({
      url: String(url),
      avtorizacija: glave.authorization ?? glave.Authorization ?? "",
      telo: JSON.parse(String(init?.body ?? "{}")) as Vidno["telo"],
    });
    return new Response(JSON.stringify(odgovor), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("OpenRouter v mozganih Line", () => {
  it("shrani sifriran kljuc, javni pogled pokaze samo zadnje stiri znake, privzeti model je z OpenRouter predpono", async () => {
    const { dir, token } = await nova();
    const izid = await saveBrain({ provider: "openrouter", key: KLJUC }, token, dir);
    assert.equal(izid.provider, "openrouter");
    assert.equal(izid.model, DEFAULT_BRAIN_MODELS.openrouter);
    assert.match(izid.model, /^[a-z0-9-]+\/[a-z0-9.:-]+$/i);
    assert.equal(izid.nastavljen, true);
    assert.equal(izid.namig, KLJUC.slice(-4));

    const javno = await readBrain(token, dir);
    assert.equal(javno.provider, "openrouter");
    assert.equal(javno.nastavljen, true);
    assert.equal(JSON.stringify(javno).includes(KLJUC), false);

    const naDisku = await readFile(path.join(dir, "kljuci.json"), "utf8");
    assert.equal(naDisku.includes(KLJUC), false, "kljuc ne sme biti na disku v cistem besedilu");

    const aktivni = await activeBrain(dir);
    assert.equal(aktivni?.provider, "openrouter");
    assert.equal(aktivni?.key, KLJUC);
    assert.equal(aktivni?.model, DEFAULT_BRAIN_MODELS.openrouter);
  });

  it("neznan ponudnik se se vedno zavrne", async () => {
    const { dir, token } = await nova();
    await assert.rejects(saveBrain({ provider: "openrouterr", key: KLJUC }, token, dir), /Izberite ponudnika/);
  });

  it("preverba kljuca poklice samo openrouter.ai, z data_collection = deny, in kljuc je samo v glavi Authorization", async () => {
    const { dir, token } = await nova();
    const vidno: Vidno[] = [];
    globalThis.fetch = lazniFetch(200, { choices: [{ message: { content: "da" } }] }, vidno);
    const izid = await checkBrain({ provider: "openrouter", model: "google/gemini-2.5-flash", key: KLJUC }, token, dir);
    assert.deepEqual(izid, { ok: true, sporocilo: "Ključ deluje." });
    assert.equal(vidno.length, 1);
    assert.equal(vidno[0].url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(vidno[0].avtorizacija, `Bearer ${KLJUC}`);
    assert.equal(vidno[0].telo.model, "google/gemini-2.5-flash");
    assert.deepEqual(vidno[0].telo.provider, { data_collection: "deny" });
    assert.equal(vidno[0].url.includes(KLJUC), false);
  });

  it("preverba brez vpisanega kljuca uporabi shranjenega, brez shranjenega pa OPENROUTER_API_KEY iz okolja", async () => {
    const { dir, token } = await nova();
    const vidno: Vidno[] = [];
    globalThis.fetch = lazniFetch(200, { choices: [{ message: { content: "da" } }] }, vidno);
    // Nic shranjenega, nic v okolju.
    assert.deepEqual(await checkBrain({ provider: "openrouter" }, token, dir), { ok: false, sporocilo: "Ključ ni nastavljen." });
    assert.equal(vidno.length, 0);
    // Okolje.
    process.env.OPENROUTER_API_KEY = "sk-or-v1-iz-okolja-5678";
    assert.equal((await checkBrain({ provider: "openrouter" }, token, dir)).ok, true);
    assert.equal(vidno[0].avtorizacija, "Bearer sk-or-v1-iz-okolja-5678");
    assert.equal(llmConfigured(), true);
    // Brez ponudnika v shrambi mozgani uporabijo OpenRouter iz okolja.
    const rezerva = await activeBrain(dir);
    assert.equal(rezerva?.provider, "openrouter");
    delete process.env.OPENROUTER_API_KEY;
    assert.equal(llmConfigured(), false);
    // Shranjeni kljuc ima prednost pred okoljem.
    await saveBrain({ provider: "openrouter", key: KLJUC }, token, dir);
    process.env.OPENROUTER_API_KEY = "sk-or-v1-iz-okolja-5678";
    assert.equal((await activeBrain(dir))?.key, KLJUC);
  });

  it("razlogi napak so razumljivi, ne vsebujejo kljuca in ne puscajo tretje osebe", async () => {
    const { dir, token } = await nova();
    const primeri: Array<[number, string]> = [
      [401, "OpenRouter: ključ ni veljaven."],
      [402, "OpenRouter: na računu ni dovolj dobroimetja."],
      [429, "OpenRouter: preveč zahtevkov, poskusite čez trenutek."],
      [404, "OpenRouter: model ne obstaja ali nima ponudnika, ki ne zbira podatkov (Lina to zahteva). Izberite drug model."],
      [503, "OpenRouter: model ne obstaja ali nima ponudnika, ki ne zbira podatkov (Lina to zahteva). Izberite drug model."],
      [500, "Ponudnik je zavrnil klic (500)."],
    ];
    for (const [status, pricakovano] of primeri) {
      const vidno: Vidno[] = [];
      globalThis.fetch = lazniFetch(status, { error: { code: status, message: `napaka ${KLJUC}` } }, vidno);
      const izid = await checkBrain({ provider: "openrouter", key: KLJUC }, token, dir);
      assert.deepEqual(izid, { ok: false, sporocilo: pricakovano }, `status ${status}`);
      assert.equal(izid.sporocilo.includes(KLJUC), false);
    }
    // Isti status pri drugem ponudniku ne dobi besedila OpenRouter.
    globalThis.fetch = lazniFetch(401, {}, []);
    const openai = await checkBrain({ provider: "openai", key: KLJUC }, token, dir);
    assert.deepEqual(openai, { ok: false, sporocilo: "Ponudnik je zavrnil klic (401)." });
    assert.equal(razlogOpenRouter(200), null);
  });

  it("okno Mozgani (LinaDesk, ki ga uporablja Lina 2.0) ponudi OpenRouter", async () => {
    const koren = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "components");
    // 21. 11. 2026: mrtva kopija components/lina2/lina-desk.tsx (nikjer uvozena) je odstranjena z dovoljenjem lastnika.
    for (const datoteka of ["lina-desk.tsx"]) {
      const koda = await readFile(path.join(koren, datoteka), "utf8");
      assert.match(koda, /<option value="openrouter">/, datoteka);
    }
    // Zivo okno (LinaDesk) pokaze namig za OpenRouter iz besedil (slovensko in anglesko).
    const zivo = await readFile(path.join(koren, "lina-desk.tsx"), "utf8");
    assert.match(zivo, /provider === "openrouter"[^\n]*uiMozganiOpenRouter/);
    const besedila = await readFile(path.join(koren, "..", "lib", "lina", "besedila.ts"), "utf8");
    assert.equal(besedila.match(/uiMozganiOpenRouter:/g)?.length, 2);
  });
});
