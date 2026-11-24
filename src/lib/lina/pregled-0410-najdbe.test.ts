/**
 * Preizkusi najdb pregleda 0410. Merijo varno vedenje po odlocitvi vodje.
 * Na nepopravljeni kodi padejo. Kljuci so izmisljeni. Brez omrezja (fetch je lazni).
 * Zacasnih map ne brisem.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { vsebinaNaloge } from "./claude-naloge.ts";
import { activeBrain, nastaviBrezplacneModele, pogovorBrain, readBrain, saveBrain, shraniKljucAsistentke } from "./keys.server.ts";
import { sestaviPregledProjekta } from "./pregled-projekta.server.ts";
import { callProvider, preizkusiModel } from "./providers.ts";
import { DEFAULT_BRAIN_MODELS, jeBrezplacenModel } from "./types.ts";

const OZNAKA = "UKAZ-ZUNAJ-NABORA-0410";
const BESEDILO = "VSEBINA-POGOVORA-0410";
const KLJUC_ASIST = "sk-or-v1-izmisljen-kljuc-asistentke-3333";
const KLJUC_KLICI = "sk-or-v1-izmisljen-kljuc-klicev-2222";
const KLJUC_OKOLJE = "xai-izmisljen-kljuc-okolja-4444";
const KLJUC_ISTI = "sk-or-v1-izmisljen-kljuc-okolja-5555";
const PLACLJIV = "anthropic/claude-sonnet-4.5";
const STIKALO = "OpenRouter: vklopite stikalo za brezplačne modele.";
const OKOLJE = ["OPENROUTER_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "LINA_DATA"];
const shranjeno: Record<string, string | undefined> = {};
const praviFetch = globalThis.fetch;

function pocistiOkolje(): void {
  for (const ime of OKOLJE) {
    shranjeno[ime] = process.env[ime];
    delete process.env[ime];
  }
}

function vrniOkolje(): void {
  globalThis.fetch = praviFetch;
  for (const ime of OKOLJE) {
    if (shranjeno[ime] === undefined) delete process.env[ime];
    else process.env[ime] = shranjeno[ime];
  }
}

afterEach(() => {
  vrniOkolje();
});

function lazneZahteve(): { vidno: Array<{ model: string; besedilo: string }>; fetch: typeof globalThis.fetch } {
  const vidno: Array<{ model: string; besedilo: string }> = [];
  const lazni = (async (_url: string | URL | Request, init?: RequestInit) => {
    const surovo = String(init?.body ?? "");
    let model = "";
    try {
      model = String((JSON.parse(surovo) as { model?: unknown }).model ?? "");
    } catch {
      model = "";
    }
    vidno.push({ model, besedilo: surovo });
    return new Response(JSON.stringify({ choices: [{ message: { content: "da" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { vidno, fetch: lazni };
}

describe("pregled 0410: telo skripta ne sme v navodilo naloge", () => {
  it("besedilo skripta iz package.json ne pride v NALOGA.md", async () => {
    const proj = await mkdtemp(path.join(tmpdir(), "lina-pregled-0410-"));
    await writeFile(
      path.join(proj, "package.json"),
      JSON.stringify({ scripts: { test: "echo `" + OZNAKA } }),
    );
    const blok = await sestaviPregledProjekta(proj);
    assert.match(blok, /npm test/, "zaznava ukaza mora delovati, sicer preizkus nic ne meri");
    assert.equal(blok.includes(OZNAKA), false, blok);
    assert.equal(blok.includes("echo"), false, blok);
    const besediloLastnika = "Popravi test";
    const md = vsebinaNaloge(
      { id: "0123456789abcdef", izvor: "lastnik", besedilo: besediloLastnika },
      new Date(0),
      { pregledProjekta: blok },
    );
    assert.equal(besediloLastnika.includes(OZNAKA), false);
    assert.equal(md.includes(OZNAKA), false, md);
    const iPravila = md.indexOf("## Pravila");
    const iNaloga = md.indexOf("## Naloga");
    const iPregled = md.indexOf("## Pregled projekta");
    assert.ok(iPravila >= 0 && iNaloga > iPravila && iPregled > iNaloga, md);
    assert.match(md, /nezaupljiv/);
    assert.match(md, /podatek iz repozitorija/i);
  });
});

describe("pregled 0410: klice in brezplacni model", () => {
  it("po izklopu stikala pogovorBrain ne vrne brezplacnega modela", async () => {
    pocistiOkolje();
    const dir = await mkdtemp(path.join(tmpdir(), "lina-pregled-0410-"));
    process.env.LINA_DATA = dir;
    const token = await setupOwner("geslo-test-1234", dir);
    await shraniKljucAsistentke({ key: KLJUC_ASIST, model: "google/gemma-4-31b-it:free", soglasje: true }, token, dir);
    await nastaviBrezplacneModele(false, token, dir);
    const brain = await pogovorBrain(dir);
    if (brain) {
      assert.equal(jeBrezplacenModel(brain.model), false, brain.model);
      assert.notEqual(brain.brezplacniDovoljeni, true);
    } else {
      assert.equal(brain, null);
    }

    const placljiv = await mkdtemp(path.join(tmpdir(), "lina-pregled-0410-"));
    process.env.LINA_DATA = placljiv;
    const tokenPlac = await setupOwner("geslo-test-1234", placljiv);
    await shraniKljucAsistentke({ key: KLJUC_ASIST, model: PLACLJIV }, tokenPlac, placljiv);
    await shraniKljucAsistentke({ key: KLJUC_ASIST, model: "google/gemma-4-31b-it:free", soglasje: true }, tokenPlac, placljiv);
    await nastaviBrezplacneModele(false, tokenPlac, placljiv);
    const nazaj = await pogovorBrain(placljiv);
    assert.ok(nazaj);
    assert.equal(nazaj.provider, "openrouter");
    assert.equal(nazaj.model, PLACLJIV);
    assert.equal(nazaj.key, KLJUC_ASIST);
    assert.equal(nazaj.brezplacniDovoljeni, undefined);

    const klici = await mkdtemp(path.join(tmpdir(), "lina-pregled-0410-"));
    process.env.LINA_DATA = klici;
    const tokenKlic = await setupOwner("geslo-test-1234", klici);
    await saveBrain({ provider: "grok", model: "grok-4.5", key: KLJUC_KLICI }, tokenKlic, klici);
    await shraniKljucAsistentke({ key: KLJUC_ASIST, model: "google/gemma-4-31b-it:free", soglasje: true }, tokenKlic, klici);
    await nastaviBrezplacneModele(false, tokenKlic, klici);
    // B9 (pregled RAC-B, B-1): izrecno izbrana asistentka brez uporabnega modela ne pade na ponudnika klicev.
    assert.equal(await pogovorBrain(klici), null);
  });

  it("callProvider zavrne :free brez brezplacniDovoljeni tudi ko vsebinaKlica ni klic", async () => {
    pocistiOkolje();
    const { vidno, fetch } = lazneZahteve();
    globalThis.fetch = fetch;
    const zavrnjen = await callProvider({
      provider: "openrouter",
      model: "google/gemma-4-31b-it:free",
      key: KLJUC_ASIST,
      text: BESEDILO,
      vsebinaKlica: false,
    });
    assert.equal(zavrnjen.ok, false);
    assert.equal(zavrnjen.ok ? "" : zavrnjen.sporocilo, STIKALO);
    assert.equal(vidno.length, 0, JSON.stringify(vidno));
    const dovoljen = await callProvider({
      provider: "openrouter",
      model: "google/gemma-4-31b-it:free",
      key: KLJUC_ASIST,
      text: BESEDILO,
      vsebinaKlica: false,
      brezplacniDovoljeni: true,
    });
    assert.equal(dovoljen.ok, true);
    assert.equal(vidno.filter((v) => jeBrezplacenModel(v.model) && v.besedilo.includes(BESEDILO)).length, 1);
    const preizkus = await preizkusiModel({
      provider: "openrouter",
      model: "google/gemma-4-31b-it:free",
      key: KLJUC_ASIST,
      text: BESEDILO,
      vsebinaKlica: false,
    });
    assert.equal(preizkus.ok, false);
    assert.equal(preizkus.ok ? "" : preizkus.sporocilo, STIKALO);
    assert.equal(vidno.filter((v) => jeBrezplacenModel(v.model)).length, 1, "preizkusiModel brez stikala ne sme poslati se enega :free");
  });

  it("brezplacen model v kljuci.json ne preusmeri klicev na kljuc iz okolja drugega ponudnika", async () => {
    pocistiOkolje();
    const dir = await mkdtemp(path.join(tmpdir(), "lina-pregled-0410-"));
    process.env.LINA_DATA = dir;
    const token = await setupOwner("geslo-test-1234", dir);
    await saveBrain({ provider: "openrouter", model: "openai/gpt-4o", key: KLJUC_KLICI }, token, dir);
    const pot = path.join(dir, "kljuci.json");
    const j = JSON.parse(await readFile(pot, "utf8")) as { model?: string };
    j.model = "openai/gpt-4o:free";
    await writeFile(pot, JSON.stringify(j));
    process.env.XAI_API_KEY = KLJUC_OKOLJE;
    const javno = await readBrain(token, dir);
    const klic = await activeBrain(dir);
    assert.ok(klic);
    assert.equal(klic.provider, "openrouter");
    assert.equal(klic.model, DEFAULT_BRAIN_MODELS.openrouter);
    assert.equal(jeBrezplacenModel(klic.model), false);
    assert.equal(klic.key, KLJUC_KLICI);
    assert.notEqual(klic.key, KLJUC_OKOLJE);
    assert.equal(javno.provider, klic.provider);
    assert.equal(javno.model, klic.model);

    const prazen = await mkdtemp(path.join(tmpdir(), "lina-pregled-0410-"));
    process.env.LINA_DATA = prazen;
    const tokenPrazen = await setupOwner("geslo-test-1234", prazen);
    await writeFile(path.join(prazen, "kljuci.json"), JSON.stringify({ provider: "openrouter", model: "openai/gpt-4o:free" }));
    process.env.XAI_API_KEY = KLJUC_OKOLJE;
    delete process.env.OPENROUTER_API_KEY;
    const javnoPrazen = await readBrain(tokenPrazen, prazen);
    assert.equal(await activeBrain(prazen), null);
    assert.equal(javnoPrazen.provider, "openrouter");
    assert.notEqual(javnoPrazen.provider, "grok");

    const izOkolja = await mkdtemp(path.join(tmpdir(), "lina-pregled-0410-"));
    process.env.LINA_DATA = izOkolja;
    const tokenOkolje = await setupOwner("geslo-test-1234", izOkolja);
    await writeFile(path.join(izOkolja, "kljuci.json"), JSON.stringify({ provider: "openrouter", model: "openai/gpt-4o:free" }));
    process.env.OPENROUTER_API_KEY = KLJUC_ISTI;
    process.env.XAI_API_KEY = KLJUC_OKOLJE;
    const klicOkolje = await activeBrain(izOkolja);
    const javnoOkolje = await readBrain(tokenOkolje, izOkolja);
    assert.ok(klicOkolje);
    assert.equal(klicOkolje.provider, "openrouter");
    assert.equal(klicOkolje.model, DEFAULT_BRAIN_MODELS.openrouter);
    assert.equal(klicOkolje.key, KLJUC_ISTI);
    assert.notEqual(klicOkolje.key, KLJUC_OKOLJE);
    assert.equal(javnoOkolje.provider, klicOkolje.provider);
    assert.equal(javnoOkolje.model, klicOkolje.model);
  });
});
