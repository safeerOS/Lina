/**
 * Lastnik 24. 11. 2026: locen model za klice in asistentko, brezplacni modeli OpenRouter SAMO za asistentko, kljuc OpenRouter samo
 * za asistentko (NALOGA-LINA-MODELI-KLICI-IN-ASISTENTKA.md, A, B, C). Nikjer pravega omrezja (fetch je lazni), kljuci so izmisljeni.
 * Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { freshCall } from "./brain.ts";
import {
  activeBrain,
  checkBrain,
  izberiModelPogovora,
  nastaviBrezplacneModele,
  odstraniKljucAsistentke,
  pogovorBrain,
  preveriAsistentko,
  readBrain,
  saveBrain,
  shraniKljucAsistentke,
  stanjeAsistentkeOpenRouter,
} from "./keys.server.ts";
import { razberiModele, razberiStanjeKljuca } from "./openrouter.server.ts";
import { callProvider, providerRequest, razlogOpenRouter } from "./providers.ts";
import { DEFAULT_BRAIN_MODELS, jeBrezplacenModel, jeTocnoBrezplacen, PRIVZETI_BREZPLACNI } from "./types.ts";
import { povzetekKlicatelja, seznamZapiskov, zapisiZapisekKlica } from "./zapiski.server.ts";

process.env.LINA_LLM = "0";
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-modeli-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const praviFetch = globalThis.fetch;
const KLJUC_KLICI = "xai-izmisljen-kljuc-za-klice-1111";
const KLJUC_OR_KLICI = "sk-or-v1-izmisljen-kljuc-klicev-2222";
const KLJUC_ASIST = "sk-or-v1-izmisljen-kljuc-asistentke-3333";
const OKOLJE = ["OPENROUTER_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "LINA_DATA"];
const shranjeno: Record<string, string | undefined> = {};

async function nova(): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  process.env.LINA_DATA = dir;
  return { dir, token: await setupOwner("geslo-test-1234", dir) };
}

beforeEach(() => {
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

type Vidno = { url: string; metoda: string; avtorizacija: string; telo: { model?: string; provider?: unknown } };

/** Lazni fetch: odgovor izbere funkcija po naslovu in telesu; vse zahteve se zabelezijo. */
function lazni(odgovor: (v: Vidno) => { status: number; json: unknown }, vidno: Vidno[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const glave = (init?.headers ?? {}) as Record<string, string>;
    const v: Vidno = {
      url: String(url),
      metoda: init?.method ?? "GET",
      avtorizacija: glave.authorization ?? glave.Authorization ?? "",
      telo: init?.body ? (JSON.parse(String(init.body)) as Vidno["telo"]) : {},
    };
    vidno.push(v);
    const o = odgovor(v);
    return new Response(JSON.stringify(o.json), { status: o.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const OK = { status: 200, json: { choices: [{ message: { content: "da" } }] } };

function telo(input: Parameters<typeof providerRequest>[0]): Record<string, unknown> {
  return JSON.parse(String(providerRequest(input).init.body)) as Record<string, unknown>;
}

describe("B2: data_collection deny", () => {
  const osnova = { provider: "openrouter" as const, model: "google/gemma-4-31b-it:free", key: "k-12345678", text: "x" };

  it("deny izpade SAMO ob vseh stirih pogojih: openrouter + stikalo + vsebinaKlica false + tocen :free", () => {
    assert.equal(telo({ ...osnova, brezplacniDovoljeni: true, vsebinaKlica: false }).provider, undefined);
    assert.equal(telo({ ...osnova, model: "openrouter/free", brezplacniDovoljeni: true, vsebinaKlica: false }).provider, undefined);
    const deny = { data_collection: "deny" };
    // Brez stikala, s klicem, brez izrecnega false, s placljivim modelom ali z zvokom: deny ostane.
    assert.deepEqual(telo({ ...osnova, vsebinaKlica: false }).provider, deny);
    assert.deepEqual(telo({ ...osnova, brezplacniDovoljeni: true, vsebinaKlica: true }).provider, deny);
    assert.deepEqual(telo({ ...osnova, brezplacniDovoljeni: true }).provider, deny);
    assert.deepEqual(telo({ ...osnova, model: "openai/gpt-4o", brezplacniDovoljeni: true, vsebinaKlica: false }).provider, deny);
    assert.deepEqual(telo({ ...osnova, model: "google/gemma:free-x", brezplacniDovoljeni: true, vsebinaKlica: false }).provider, deny);
    assert.deepEqual(telo({ ...osnova, brezplacniDovoljeni: true, vsebinaKlica: false, audio: { mime: "audio/wav", data: "AA" } }).provider, deny);
  });

  it("OpenAI in Grok ne dobita polja provider, tudi z zastavicami", () => {
    for (const provider of ["openai", "grok"] as const) {
      const b = telo({ ...osnova, provider, brezplacniDovoljeni: true, vsebinaKlica: false });
      assert.equal("provider" in b, false, provider);
    }
  });

  it("predikata: siroko za zaporo, ozko za izpust", () => {
    for (const m of ["a/b:free", "A/B:FREE", " a/b:free ", "openrouter/free", "x:free:extended", "openrouter/free-x"]) assert.equal(jeBrezplacenModel(m), true, m);
    for (const m of ["openai/gpt-4o", "freedom/model", "a/free"]) assert.equal(jeBrezplacenModel(m), false, m);
    for (const m of ["a/b:free", "openrouter/free", "google/gemma-4-31b-it:free"]) assert.equal(jeTocnoBrezplacen(m), true, m);
    for (const m of ["A/B:FREE", " a/b:free", "x:free:extended", "b:free", "openrouter/free-x", "a/b:free/c"]) assert.equal(jeTocnoBrezplacen(m), false, m);
  });
});

describe("B3: klici nikoli z brezplacnim modelom", () => {
  it("callProvider zavrne :free model brez izrecnega vsebinaKlica false (tudi s stikalom), brez omrezja", async () => {
    const vidno: Vidno[] = [];
    globalThis.fetch = lazni(() => OK, vidno);
    for (const vsebinaKlica of [undefined, true]) {
      for (const model of ["google/gemma-4-31b-it:free", "openrouter/free", "Google/Gemma:FREE"]) {
        const izid = await callProvider({ provider: "openrouter", model, key: "k-12345678", text: "x", brezplacniDovoljeni: true, vsebinaKlica });
        assert.deepEqual(izid, { ok: false, sporocilo: "Brezplačni modeli so samo za asistentko." });
      }
    }
    // Zvok je vedno pot klica.
    const zvok = await callProvider({ provider: "openrouter", model: "a/b:free", key: "k-12345678", text: "x", vsebinaKlica: false, audio: { mime: "audio/wav", data: "AA" } });
    assert.equal(zvok.ok, false);
    assert.equal(vidno.length, 0);
  });

  it("saveBrain zavrne :free in openrouter/free; kljuci.json se ne spremeni", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "grok", key: KLJUC_KLICI }, token, dir);
    const prej = await readFile(path.join(dir, "kljuci.json"), "utf8");
    for (const model of ["google/gemma-4-31b-it:free", "openrouter/free", " x/y:FREE "]) {
      await assert.rejects(saveBrain({ provider: "openrouter", model, key: KLJUC_OR_KLICI }, token, dir), /Brezplačni modeli so samo za asistentko/);
    }
    assert.equal(await readFile(path.join(dir, "kljuci.json"), "utf8"), prej);
  });

  it("activeBrain ne sprejme :free modela iz rocno urejenega kljuci.json; checkBrain (pot klicev) ga zavrne brez omrezja", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "openrouter", model: "openai/gpt-4o", key: KLJUC_OR_KLICI }, token, dir);
    const kljuci = JSON.parse(await readFile(path.join(dir, "kljuci.json"), "utf8")) as Record<string, unknown>;
    await writeFile(path.join(dir, "kljuci.json"), JSON.stringify({ ...kljuci, model: "google/gemma-4-31b-it:free" }));
    const klic = await activeBrain(dir);
    assert.equal(klic?.provider, "openrouter");
    assert.equal(klic?.model, DEFAULT_BRAIN_MODELS.openrouter);
    assert.equal(klic?.key, KLJUC_OR_KLICI);
    assert.equal(jeBrezplacenModel(klic?.model ?? ""), false);
    const javno = await readBrain(token, dir);
    assert.equal(javno.provider, klic?.provider);
    assert.equal(javno.model, klic?.model);
    const vidno: Vidno[] = [];
    globalThis.fetch = lazni(() => OK, vidno);
    const izid = await checkBrain({ provider: "openrouter", model: "google/gemma-4-31b-it:free", key: KLJUC_OR_KLICI }, token, dir);
    assert.deepEqual(izid, { ok: false, sporocilo: "Brezplačni modeli so samo za asistentko." });
    assert.equal(vidno.length, 0);
  });
});

describe("A: locen model za klice in asistentko", () => {
  it("A6: en sam ponudnik, pogovor = null: klici in asistentka dobijo istega", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "grok", key: KLJUC_KLICI }, token, dir);
    const javno = await readBrain(token, dir);
    assert.equal(javno.pogovor, null);
    assert.equal(javno.shranjeni?.length, 1);
    const klici = await activeBrain(dir);
    const asist = await pogovorBrain(dir);
    assert.deepEqual(asist, klici);
  });

  it("A3: odstranitev kljuca asistentke vrne asistentko na privzeto (kot klici)", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "grok", key: KLJUC_KLICI }, token, dir);
    await shraniKljucAsistentke({ key: KLJUC_ASIST, soglasje: true }, token, dir);
    assert.equal((await pogovorBrain(dir))?.key, KLJUC_ASIST);
    const po = await odstraniKljucAsistentke(token, dir);
    assert.equal(po.pogovor, null);
    assert.equal(po.shranjeni?.some((p) => p.provider === "openrouter"), false);
    assert.deepEqual(await pogovorBrain(dir), await activeBrain(dir));
    assert.equal((await pogovorBrain(dir))?.provider, "grok");
    // Izbira na disku se res pobrise (sicer bi poznejsi kljuc OpenRouter za klice tiho preklopil tudi asistentko).
    const naDisku = JSON.parse(await readFile(path.join(dir, "ponudniki.json"), "utf8")) as { pogovor?: unknown };
    assert.equal(naDisku.pogovor, null);
  });

  it("izbira modela za asistentko ne spremeni klicev; stikalo brezplacnih ostane ob vsakem zapisu ponudnikov", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "grok", key: KLJUC_KLICI }, token, dir);
    await nastaviBrezplacneModele(true, token, dir);
    await saveBrain({ provider: "openai", key: "sk-izmisljen-openai-4444" }, token, dir);
    await izberiModelPogovora({ provider: "grok", model: "grok-4.5" }, token, dir);
    const javno = await readBrain(token, dir);
    assert.equal(javno.brezplacniModeli, true);
    assert.equal((await activeBrain(dir))?.provider, "openai");
    assert.equal((await pogovorBrain(dir))?.provider, "grok");
    const kljuci = await readFile(path.join(dir, "kljuci.json"), "utf8");
    assert.equal(kljuci.includes("brezplacni"), false, "stikalo ne sme v kljuci.json");
  });
});

describe("C: kljuc OpenRouter samo za asistentko", () => {
  it("C1/C2: vnos NE spremeni kljuci.json, pogovor se nastavi samodejno na privzeti brezplacni model", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "grok", key: KLJUC_KLICI }, token, dir);
    const prej = await readFile(path.join(dir, "kljuci.json"));
    const javno = await shraniKljucAsistentke({ key: KLJUC_ASIST, soglasje: true }, token, dir);
    assert.deepEqual(await readFile(path.join(dir, "kljuci.json")), prej, "kljuci.json mora ostati bajt za bajtom enak");
    assert.deepEqual(javno.pogovor, { provider: "openrouter", model: PRIVZETI_BREZPLACNI });
    assert.equal(javno.brezplacniModeli, true);
    assert.equal(javno.shranjeni?.find((p) => p.provider === "openrouter")?.samoAsistentka, true);
    assert.equal(JSON.stringify(javno).includes(KLJUC_ASIST), false);
    const klici = await activeBrain(dir);
    assert.equal(klici?.provider, "grok");
    assert.equal(klici?.key, KLJUC_KLICI);
    assert.equal("brezplacniDovoljeni" in (klici ?? {}), false);
    const asist = await pogovorBrain(dir);
    assert.equal(asist?.key, KLJUC_ASIST);
    assert.equal(asist?.brezplacniDovoljeni, true);
    // Oznaka »samo asistentka« je v podatkovnem modelu (za sinhronizacijo), kljuc ni v cistem besedilu.
    const ponudniki = await readFile(path.join(dir, "ponudniki.json"), "utf8");
    assert.match(ponudniki, /"samoAsistentka": ?true/);
    assert.equal(ponudniki.includes(KLJUC_ASIST), false);
  });

  it("C4: brezplacen model brez potrditve ni sprejet; placljiv brez potrditve je sprejet in ostane z deny", async () => {
    const { dir, token } = await nova();
    await assert.rejects(shraniKljucAsistentke({ key: KLJUC_ASIST }, token, dir), /potrdite obvestilo/);
    await assert.rejects(shraniKljucAsistentke({ key: KLJUC_ASIST, soglasje: "true" }, token, dir), /potrdite obvestilo/);
    const javno = await shraniKljucAsistentke({ key: KLJUC_ASIST, model: "anthropic/claude-sonnet-4.5" }, token, dir);
    assert.equal(javno.brezplacniModeli, false);
    const vidno: Vidno[] = [];
    globalThis.fetch = lazni(() => OK, vidno);
    assert.equal((await preveriAsistentko(token, dir)).ok, true);
    assert.deepEqual(vidno[0].telo.provider, { data_collection: "deny" });
    assert.equal(vidno[0].avtorizacija, `Bearer ${KLJUC_ASIST}`);
  });

  it("prazen saveBrain za OpenRouter nikoli ne podeduje kljuca asistentke (klici ostanejo na svojem kljucu)", async () => {
    // Primer 1: klici na OpenRouter s kljucem A, asistentka s kljucem B.
    const a = await nova();
    await saveBrain({ provider: "openrouter", model: "openai/gpt-4o", key: KLJUC_OR_KLICI }, a.token, a.dir);
    await shraniKljucAsistentke({ key: KLJUC_ASIST, soglasje: true }, a.token, a.dir);
    assert.equal((await activeBrain(a.dir))?.key, KLJUC_OR_KLICI);
    await saveBrain({ provider: "openrouter", model: "anthropic/claude-sonnet-4.5" }, a.token, a.dir);
    assert.equal((await activeBrain(a.dir))?.key, KLJUC_OR_KLICI);
    assert.equal((await pogovorBrain(a.dir))?.key, KLJUC_ASIST, "zapis asistentke ostane nedotaknjen");
    // Primer 2: klici na drugem ponudniku; prazen saveBrain za OpenRouter ne vzame kljuca asistentke.
    const b = await nova();
    await saveBrain({ provider: "grok", key: KLJUC_KLICI }, b.token, b.dir);
    await shraniKljucAsistentke({ key: KLJUC_ASIST, soglasje: true }, b.token, b.dir);
    const izid = await saveBrain({ provider: "openrouter", model: "openai/gpt-4o" }, b.token, b.dir);
    assert.equal(izid.nastavljen, false);
    const klici = await activeBrain(b.dir);
    assert.notEqual(klici?.key, KLJUC_ASIST);
  });

  it("obstojec kljuc OpenRouter za klice: prazno polje asistentke ga uporabi za brezplacni model, klici nespremenjeni", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "openrouter", model: "openai/gpt-4o", key: KLJUC_OR_KLICI }, token, dir);
    const prej = await readFile(path.join(dir, "kljuci.json"));
    await assert.rejects(shraniKljucAsistentke({}, token, dir), /potrdite obvestilo/);
    const javno = await shraniKljucAsistentke({ soglasje: true }, token, dir);
    assert.deepEqual(javno.pogovor, { provider: "openrouter", model: PRIVZETI_BREZPLACNI });
    assert.deepEqual(await readFile(path.join(dir, "kljuci.json")), prej);
    assert.equal((await activeBrain(dir))?.model, "openai/gpt-4o");
    const asist = await pogovorBrain(dir);
    assert.equal(asist?.key, KLJUC_OR_KLICI);
    assert.equal(asist?.model, PRIVZETI_BREZPLACNI);
    assert.equal(asist?.brezplacniDovoljeni, true);
    // Brez kakrsnegakoli kljuca OpenRouter prazno polje ni sprejeto.
    const b = await nova();
    await saveBrain({ provider: "grok", key: KLJUC_KLICI }, b.token, b.dir);
    await assert.rejects(shraniKljucAsistentke({ soglasje: true }, b.token, b.dir), /Vpišite ključ OpenRouter/);
  });

  it("pogovorBrain: rezervni brezplacni model in zastavica samo s stikalom; activeBrain nikoli", async () => {
    const { dir, token } = await nova();
    await shraniKljucAsistentke({ key: KLJUC_ASIST, model: "anthropic/claude-sonnet-4.5" }, token, dir);
    assert.equal((await pogovorBrain(dir))?.brezplacniDovoljeni, undefined);
    await nastaviBrezplacneModele(true, token, dir);
    const asist = await pogovorBrain(dir);
    assert.equal(asist?.brezplacniDovoljeni, true);
    assert.equal(asist?.rezervniBrezplacni, PRIVZETI_BREZPLACNI);
    await assert.rejects(nastaviBrezplacneModele("da", token, dir), /Neveljavna/);
  });
});

describe("B6, C6, C8: sporocila in povratek znotraj OpenRouter", () => {
  async function asistentka(model: string, brezplacni: boolean): Promise<{ dir: string; token: string }> {
    const s = await nova();
    await shraniKljucAsistentke({ key: KLJUC_ASIST, model, soglasje: brezplacni }, s.token, s.dir);
    if (!brezplacni) await nastaviBrezplacneModele(false, s.token, s.dir);
    return s;
  }

  it("404 pri :free: s stikalom -> vklopite v racunu, brez stikala -> vklopite stikalo; nikoli drug ponudnik (B9)", async () => {
    const vklop = await asistentka("google/gemma-4-31b-it:free", true);
    const vidno: Vidno[] = [];
    globalThis.fetch = lazni(() => ({ status: 404, json: { error: { message: "No endpoints found matching your data policy" } } }), vidno);
    assert.deepEqual(await preveriAsistentko(vklop.token, vklop.dir), {
      ok: false,
      sporocilo: "OpenRouter: vklopite brezplačne modele v računu OpenRouter (Privacy) ali izberite drug model.",
    });
    assert.equal(vidno.length, 1);
    assert.equal(vidno[0].telo.provider, undefined, "s stikalom za asistentko deny izpade");
    const predIzklopom = vidno.length;
    await nastaviBrezplacneModele(false, vklop.token, vklop.dir);
    assert.deepEqual(await preveriAsistentko(vklop.token, vklop.dir), { ok: false, sporocilo: "OpenRouter: vklopite stikalo za brezplačne modele." });
    assert.equal(vidno.length, predIzklopom, "po izklopu stikala ni nove zahteve");
    assert.ok(vidno.every((v) => v.url.startsWith("https://openrouter.ai/")));
  });

  it("C8: 402 na poti asistentke -> besedilo o dobroimetju; 429 brezplacnega -> koliko je danes se ostalo", async () => {
    const s = await asistentka("google/gemma-4-31b-it:free", true);
    const vidno: Vidno[] = [];
    globalThis.fetch = lazni(() => ({ status: 402, json: {} }), vidno);
    assert.equal(
      (await preveriAsistentko(s.token, s.dir)).sporocilo,
      "OpenRouter: na računu OpenRouter ni dobroimetja ali je negativen; izberite brezplačen model ali dodajte kredit.",
    );
    globalThis.fetch = lazni(
      (v) => (v.url.endsWith("/key") ? { status: 200, json: { data: { is_free_tier: true, free_model_daily_requests: { used: 50, limit: 50, remaining: 0 } } } } : { status: 429, json: {} }),
      vidno,
    );
    const izid = await preveriAsistentko(s.token, s.dir);
    assert.equal(izid.ok, false);
    assert.match(izid.sporocilo, /omejitev brezplačnih modelov/);
    assert.match(izid.sporocilo, /Danes še 0 od 50\./);
    const kljucni = vidno.find((v) => v.url.endsWith("/key"));
    assert.equal(kljucni?.metoda, "GET");
    assert.equal(kljucni?.avtorizacija, `Bearer ${KLJUC_ASIST}`);
    assert.equal(izid.sporocilo.includes(KLJUC_ASIST), false);
  });

  it("C6: placljiv model z 402 enkrat poskusi brezplacnega (s stikalom) in to pove; brez stikala ali na poti klica ne", async () => {
    const s = await asistentka("anthropic/claude-sonnet-4.5", true);
    const vidno: Vidno[] = [];
    globalThis.fetch = lazni((v) => (v.telo.model === "anthropic/claude-sonnet-4.5" ? { status: 402, json: {} } : OK), vidno);
    const izid = await preveriAsistentko(s.token, s.dir);
    assert.equal(izid.ok, true);
    assert.match(izid.opozorilo ?? "", /brezplačni model google\/gemma-4-31b-it:free/);
    assert.deepEqual(vidno.map((v) => v.telo.model), ["anthropic/claude-sonnet-4.5", PRIVZETI_BREZPLACNI]);
    assert.equal(vidno[1].telo.provider, undefined);
    // Na poti klica (vsebinaKlica ni false) ni povratka.
    vidno.length = 0;
    const brain = await pogovorBrain(s.dir);
    const klic = await callProvider({ ...brain!, text: "x" });
    assert.equal(klic.ok, false);
    assert.equal(vidno.length, 1);
    // Brez stikala ni povratka; na poti asistentke velja besedilo C8 tudi za placljiv model.
    await nastaviBrezplacneModele(false, s.token, s.dir);
    vidno.length = 0;
    const brez = await preveriAsistentko(s.token, s.dir);
    assert.equal(brez.ok, false);
    assert.equal(brez.sporocilo, "OpenRouter: na računu OpenRouter ni dobroimetja ali je negativen; izberite brezplačen model ali dodajte kredit.");
    assert.equal(vidno.length, 1);
  });

  it("C6 neposredno: rezervni model brez zastavice brezplacniDovoljeni ne sprozi povratka (samo s potrditvijo)", async () => {
    const vidno: Vidno[] = [];
    globalThis.fetch = lazni((v) => (v.telo.model === "openai/gpt-4o" ? { status: 402, json: {} } : OK), vidno);
    const izid = await callProvider({ provider: "openrouter", model: "openai/gpt-4o", key: "k-12345678", text: "x", vsebinaKlica: false, rezervniBrezplacni: PRIVZETI_BREZPLACNI });
    assert.equal(izid.ok, false);
    assert.equal(vidno.length, 1);
  });

  it("brez konteksta ostanejo stara besedila (pot klicev, B6)", () => {
    assert.equal(razlogOpenRouter(402), "OpenRouter: na računu ni dovolj dobroimetja.");
    assert.equal(razlogOpenRouter(429), "OpenRouter: preveč zahtevkov, poskusite čez trenutek.");
    assert.equal(razlogOpenRouter(402, { model: "openai/gpt-4o" }), "OpenRouter: na računu ni dovolj dobroimetja.");
  });
});

describe("C3: stanje racuna in seznam modelov", () => {
  it("razclenitev /key z ovojem data ali brez; neznano ostane null", () => {
    const polno = { is_free_tier: false, limit_remaining: 12.5, free_model_daily_requests: { used: 3, limit: 1000, remaining: 997 } };
    assert.deepEqual(razberiStanjeKljuca({ data: polno }), { brezplacniRacun: false, preostaloKreditov: 12.5, dnevno: { porabljeno: 3, meja: 1000, preostalo: 997 } });
    assert.deepEqual(razberiStanjeKljuca(polno), razberiStanjeKljuca({ data: polno }));
    assert.deepEqual(razberiStanjeKljuca(null), { brezplacniRacun: null, preostaloKreditov: null, dnevno: null });
    assert.deepEqual(razberiStanjeKljuca({ data: { is_free_tier: "true" } }).brezplacniRacun, null);
  });

  it("seznam: brez dobroimetja samo brezplacni z orodji, sicer vsi", () => {
    const json = {
      data: [
        { id: "a/b:free", pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools", "temperature"] },
        { id: "c/d:free", pricing: { prompt: "0", completion: "0" }, supported_parameters: ["temperature"] },
        { id: "e/f", pricing: { prompt: "0.000001", completion: "0.000002" }, supported_parameters: ["tools"] },
        { id: "g/h:free", pricing: { prompt: "0.1", completion: "0" }, supported_parameters: ["tools"] },
        { id: "zlo nameren id", pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
      ],
    };
    assert.deepEqual(razberiModele(json, true), ["a/b:free"]);
    assert.deepEqual(razberiModele(json, false), ["a/b:free", "c/d:free", "e/f", "g/h:free"]);
    assert.deepEqual(razberiModele({}, true), []);
  });

  it("stanjeAsistentkeOpenRouter: is_free_tier true -> samo brezplacni; z dobroimetjem razsirjen seznam; seznam brez kljuca", async () => {
    const { dir, token } = await nova();
    await shraniKljucAsistentke({ key: KLJUC_ASIST, soglasje: true }, token, dir);
    const modeli = {
      data: [
        { id: "a/b:free", pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
        { id: "e/f", pricing: { prompt: "1", completion: "1" }, supported_parameters: ["tools"] },
      ],
    };
    for (const [brezplacen, pricakovano] of [[true, ["a/b:free"]], [false, ["a/b:free", "e/f"]]] as const) {
      const vidno: Vidno[] = [];
      globalThis.fetch = lazni(
        (v) => (v.url.endsWith("/key") ? { status: 200, json: { data: { is_free_tier: brezplacen, free_model_daily_requests: { used: 1, limit: 50, remaining: 49 } } } } : { status: 200, json: modeli }),
        vidno,
      );
      const st = await stanjeAsistentkeOpenRouter(token, dir);
      assert.equal(st.brezplacniRacun, brezplacen);
      assert.deepEqual(st.modeli, pricakovano);
      assert.equal(st.dnevnoPreostalo, 49);
      assert.equal(vidno.find((v) => v.url.endsWith("/models"))?.avtorizacija, "", "seznam modelov je javen, brez kljuca");
      assert.ok(vidno.every((v) => v.url.startsWith("https://openrouter.ai/api/v1/")));
    }
  });
});

describe("B4: povzetek klicatelja (vsebina klicev) ne gre k brezplacnemu modelu", () => {
  it("asistentka na :free: povzetek zapiskov klicatelja ne poslje nicesar", async () => {
    const { dir, token } = await nova();
    await shraniKljucAsistentke({ key: KLJUC_ASIST, soglasje: true }, token, dir);
    const c = freshCall("b4-1", "+38640000000", new Date(2026, 10, 24, 8, 0).toISOString());
    c.order.customerName = "Ana Novak";
    c.status = "zakljucen";
    c.transcript.push({ role: "stranka", text: "Potrebujem mizo.", at: c.startedAt ?? new Date().toISOString() });
    await zapisiZapisekKlica(c, dir);
    const zapiski = await seznamZapiskov(token, dir);
    assert.ok(zapiski.length > 0);
    const vidno: Vidno[] = [];
    globalThis.fetch = lazni(() => OK, vidno);
    const izid = await povzetekKlicatelja(zapiski[0].klicatelj, token, dir);
    assert.equal(izid.ok, false);
    assert.equal(izid.besedilo, "Brezplačni modeli so samo za asistentko.");
    assert.equal(vidno.length, 0);
  });
});
