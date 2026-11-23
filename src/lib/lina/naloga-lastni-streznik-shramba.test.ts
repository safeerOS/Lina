/**
 * Lasten OpenAI-zdruzljiv streznik kot mozgani ZA POGOVOR (naloga #43, lastnik 21. 11. 2026): shramba in zapora za klice.
 * Lastnik: tajnica (klici) ne posega in ne daje ukazov; zato lasten streznik NE sme v mozgane za klice
 * (kljuci.json, activeBrain) in callProvider ga zavrne, razen ce je vsebinaKlica izrecno false.
 * Nikjer pravega omrezja (fetch je lazni), kljuci so izmisljeni. Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import {
  activeBrain,
  checkBrain,
  envKey,
  izberiModelPogovora,
  kljucLastnika,
  odstraniLastniStreznik,
  pogovorBrain,
  preveriLastniStreznik,
  readBrain,
  saveBrain,
  shraniLastniStreznik,
} from "./keys.server.ts";
import { callProvider, providerRequest } from "./providers.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-lastni-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const praviFetch = globalThis.fetch;
const KLJUC = "freellmapi-izmisljen-kljuc-za-preizkus-1234";
const NASLOV = "http://127.0.0.1:3191/v1";
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

type Vidno = { url: string; avtorizacija: string; redirect?: string; telo: { model?: string; max_tokens?: number; messages?: Array<{ role: string; content: string }> } };

function lazniFetch(status: number, odgovor: unknown, vidno: Vidno[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const glave = (init?.headers ?? {}) as Record<string, string>;
    vidno.push({
      url: String(url),
      avtorizacija: glave.authorization ?? glave.Authorization ?? "",
      redirect: init?.redirect,
      telo: JSON.parse(String(init?.body ?? "{}")) as Vidno["telo"],
    });
    return new Response(typeof odgovor === "string" ? odgovor : JSON.stringify(odgovor), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const uspeh = (vsebina: string) => ({ choices: [{ message: { role: "assistant", content: vsebina }, finish_reason: "stop" }] });
const klic = (dodatno: Record<string, unknown> = {}) => ({
  provider: "custom" as const,
  model: "auto",
  key: KLJUC,
  naslov: NASLOV,
  text: "Pozdravljena, Lina.",
  vsebinaKlica: false,
  ...dodatno,
});

describe("callProvider custom: zapora za klice (tajnica)", () => {
  it("brez vsebinaKlica: false (klic) je zavrnjen in omrezja ne pokliče", async () => {
    await nova();
    const vidno: Vidno[] = [];
    globalThis.fetch = lazniFetch(200, uspeh("Dober dan."), vidno);
    for (const vsebinaKlica of [undefined, true]) {
      const izid = await callProvider({ ...klic(), ...(vsebinaKlica === undefined ? { vsebinaKlica: undefined } : { vsebinaKlica }) });
      assert.equal(izid.ok, false);
      if (!izid.ok) assert.match(izid.sporocilo, /samo za pogovor z asistentko, ne za klice/);
    }
    assert.equal(vidno.length, 0);
  });

  it("zvok je zavrnjen tudi z vsebinaKlica: false", async () => {
    await nova();
    const vidno: Vidno[] = [];
    globalThis.fetch = lazniFetch(200, uspeh("Dober dan."), vidno);
    const izid = await callProvider({ ...klic(), audio: { mime: "audio/wav", data: "AAAA" } });
    assert.equal(izid.ok, false);
    assert.equal(vidno.length, 0);
  });

  it("pogovor (vsebinaKlica: false): klic na lasten naslov z glavo Authorization in modelom", async () => {
    await nova();
    const vidno: Vidno[] = [];
    globalThis.fetch = lazniFetch(200, uspeh("Dober dan."), vidno);
    const izid = await callProvider(klic({ system: "Si Lina.", maxTokens: 400 }));
    assert.deepEqual(izid, { ok: true, text: "Dober dan." });
    assert.equal(vidno.length, 1);
    assert.equal(vidno[0].url, "http://127.0.0.1:3191/v1/chat/completions");
    assert.equal(vidno[0].avtorizacija, `Bearer ${KLJUC}`);
    // Preusmeritev je prepovedana ze pri klicu (kljuc ne sme za preusmeritvijo k drugemu gostitelju).
    assert.equal(vidno[0].redirect, "error");
    assert.equal(vidno[0].telo.model, "auto");
    assert.equal(vidno[0].telo.max_tokens, 1024);
    assert.equal(vidno[0].telo.messages?.[0].role, "system");
  });

  it("brez kljuca ni glave Authorization", async () => {
    await nova();
    const vidno: Vidno[] = [];
    globalThis.fetch = lazniFetch(200, uspeh("Dober dan."), vidno);
    await callProvider(klic({ key: "" }));
    assert.equal(vidno[0].avtorizacija, "");
  });

  it("prehod (tretja stran) se NE uporabi: samo lasten naslov", async () => {
    await nova();
    const vidno: Vidno[] = [];
    globalThis.fetch = lazniFetch(200, uspeh("Dober dan."), vidno);
    const prehod = { vklop: true, naslov: "http://localhost:20128/v1", klici: true, kljuc: "prehod-kljuc-izmisljen-1" };
    const izid = await callProvider(klic({ prehod }));
    assert.equal(izid.ok, true);
    assert.deepEqual(
      vidno.map((v) => v.url),
      ["http://127.0.0.1:3191/v1/chat/completions"],
    );
  });

  it("izhodni filter velja tudi za lasten streznik (kljuc v besedilu ne odide)", async () => {
    await nova();
    const vidno: Vidno[] = [];
    globalThis.fetch = lazniFetch(200, uspeh("V redu."), vidno);
    await callProvider(klic({ text: "Moj kljuc je sk-izmisljen-skrivni-kljuc-1234567 prosim shrani." }));
    const poslano = JSON.stringify(vidno[0].telo);
    assert.equal(poslano.includes("sk-izmisljen-skrivni-kljuc-1234567"), false);
  });

  it("neveljaven ali manjkajoc naslov: brez klica omrezja", async () => {
    await nova();
    const vidno: Vidno[] = [];
    globalThis.fetch = lazniFetch(200, uspeh("Dober dan."), vidno);
    for (const naslov of [undefined, "", "http://example.org/v1", "ftp://127.0.0.1/v1", "http://169.254.169.254/v1"]) {
      const izid = await callProvider(klic({ naslov }));
      assert.equal(izid.ok, false, String(naslov));
    }
    assert.equal(vidno.length, 0);
  });

  it("providerRequest za custom vrne napako (ne zrcali Anthropic poti)", () => {
    assert.throws(() => providerRequest({ provider: "custom", model: "auto", key: "", text: "x" }), /svojo pot klica/);
  });
});

describe("callProvider custom: napake in odgovori", () => {
  it("status 401: razumljiva napaka brez telesa odgovora", async () => {
    await nova();
    globalThis.fetch = lazniFetch(401, { error: { message: `skrivno ${KLJUC}` } }, []);
    const izid = await callProvider(klic());
    assert.deepEqual(izid, { ok: false, sporocilo: "Strežnik je zavrnil klic (401)." });
  });

  it("preusmeritev (3xx ali napaka fetch) ni dovoljena", async () => {
    await nova();
    globalThis.fetch = (async () => new Response(null, { status: 302, headers: { location: "http://evil.example/" } })) as typeof fetch;
    assert.deepEqual(await callProvider(klic()), { ok: false, sporocilo: "Preusmeritev ni dovoljena." });
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed: redirect mode is set to error");
    }) as typeof fetch;
    assert.deepEqual(await callProvider(klic()), { ok: false, sporocilo: "Preusmeritev ni dovoljena." });
  });

  it("strezniku ni dosegljiv in rok", async () => {
    await nova();
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const a = await callProvider(klic());
    assert.equal(a.ok, false);
    if (!a.ok) assert.match(a.sporocilo, /ni dosegljiv/);
    globalThis.fetch = (async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as typeof fetch;
    const b = await callProvider(klic());
    assert.equal(b.ok, false);
    if (!b.ok) assert.match(b.sporocilo, /pravočasno/);
  });

  it("kljuc se ne pojavi v sporocilu napake", async () => {
    await nova();
    globalThis.fetch = (async () => {
      throw new Error(`nepricakovano ${KLJUC} napaka`);
    }) as typeof fetch;
    const izid = await callProvider(klic());
    assert.equal(izid.ok, false);
    if (!izid.ok) assert.equal(izid.sporocilo.includes(KLJUC), false);
  });

  it("odgovor, ki ponovi kljuc, ga ne vrne", async () => {
    await nova();
    globalThis.fetch = lazniFetch(200, uspeh(`Tvoj kljuc je ${KLJUC}.`), []);
    const izid = await callProvider(klic());
    assert.equal(izid.ok, true);
    if (izid.ok) assert.equal(izid.text.includes(KLJUC), false);
  });

  it("odrezan razmislek (resnicen primer freellmapi) ni odgovor", async () => {
    await nova();
    const r = "We need to answer with only one Slovenian word";
    globalThis.fetch = lazniFetch(200, { choices: [{ message: { content: r, reasoning: r }, finish_reason: "length" }] }, []);
    const izid = await callProvider(klic());
    assert.equal(izid.ok, false);
    if (!izid.ok) assert.match(izid.sporocilo, /razmišljanje/);
  });

  it("odgovor se skrajsa na najvecZnakov (privzeto 500, z mejo 2000 celoten)", async () => {
    await nova();
    globalThis.fetch = lazniFetch(200, uspeh("x".repeat(800)), []);
    const kratek = await callProvider(klic());
    assert.equal(kratek.ok && kratek.text.length, 500);
    const dolg = await callProvider(klic({ najvecZnakov: 2000 }));
    assert.equal(dolg.ok && dolg.text.length, 800);
  });
});

describe("lasten streznik: shramba (samo ponudniki.json, samo pogovor)", () => {
  it("shrani, ne dotakne se kljuci.json, kljuc je sifriran", async () => {
    const { dir, token } = await nova();
    const stanje = await shraniLastniStreznik({ naslov: `${NASLOV}/`, model: "auto", key: KLJUC }, token, dir);
    const ponudnik = stanje.shranjeni?.find((p) => p.provider === "custom");
    assert.ok(ponudnik);
    assert.equal(ponudnik?.naslov, NASLOV);
    assert.equal(ponudnik?.namig, KLJUC.slice(-4));
    assert.deepEqual(ponudnik?.modeli, ["auto"]);
    // Mozgani za klice ostanejo nedotaknjeni.
    assert.equal(stanje.provider, null);
    await assert.rejects(access(path.join(dir, "kljuci.json")));
    assert.equal(await activeBrain(dir), null);
    assert.equal(await kljucLastnika(dir), null);
    const surovo = await readFile(path.join(dir, "ponudniki.json"), "utf8");
    assert.equal(surovo.includes(KLJUC), false);
    assert.match(surovo, /"ciphertext"/);
  });

  it("javni pogled ne vsebuje celega kljuca", async () => {
    const { dir, token } = await nova();
    const stanje = await shraniLastniStreznik({ naslov: NASLOV, key: KLJUC }, token, dir);
    assert.equal(JSON.stringify(stanje).includes(KLJUC), false);
  });

  it("brez kljuca: ponudnik je viden (kljuc je neobvezen), namig prazen", async () => {
    const { dir, token } = await nova();
    const stanje = await shraniLastniStreznik({ naslov: NASLOV }, token, dir);
    const p = stanje.shranjeni?.find((x) => x.provider === "custom");
    assert.equal(p?.namig, null);
    assert.equal(p?.model, "auto");
  });

  it("neveljaven naslov, model ali kljuc: napaka in nic ni shranjeno", async () => {
    const { dir, token } = await nova();
    for (const vhod of [
      { naslov: "http://example.org/v1" },
      { naslov: "" },
      { naslov: NASLOV, model: "slab model!" },
      { naslov: NASLOV, key: "kratek" },
      { naslov: NASLOV, key: "k".repeat(401) },
    ]) {
      await assert.rejects(shraniLastniStreznik(vhod, token, dir), JSON.stringify(vhod));
    }
    await assert.rejects(access(path.join(dir, "ponudniki.json")));
  });

  it("brez prijave lastnika vse tri funkcije zavrnejo", async () => {
    const { dir } = await nova();
    await assert.rejects(shraniLastniStreznik({ naslov: NASLOV }, null, dir));
    await assert.rejects(shraniLastniStreznik({ naslov: NASLOV }, "neveljaven", dir));
    await assert.rejects(preveriLastniStreznik({ naslov: NASLOV }, null, dir));
    await assert.rejects(odstraniLastniStreznik(null, dir));
    await assert.rejects(access(path.join(dir, "ponudniki.json")));
  });

  it("saveBrain, checkBrain in envKey za custom ne delujejo kot mozgani za klice", async () => {
    const { dir, token } = await nova();
    await assert.rejects(saveBrain({ provider: "custom", key: KLJUC }, token, dir), /samo za pogovor/);
    const vidno: Vidno[] = [];
    globalThis.fetch = lazniFetch(200, uspeh("da"), vidno);
    const preverba = await checkBrain({ provider: "custom", key: KLJUC }, token, dir);
    assert.deepEqual(preverba, { ok: false, sporocilo: "Lasten strežnik preverite v njegovem razdelku." });
    assert.equal(vidno.length, 0);
    assert.equal(envKey("custom"), null);
    await assert.rejects(access(path.join(dir, "kljuci.json")));
  });

  it("rocno vpisan custom v kljuci.json (tudi s sifriranim kljucem) ne postane ponudnik za klice", async () => {
    const { dir, token } = await nova();
    await shraniLastniStreznik({ naslov: NASLOV, key: KLJUC }, token, dir);
    const surovo = JSON.parse(await readFile(path.join(dir, "ponudniki.json"), "utf8")) as { ponudniki: { custom: Record<string, unknown> } };
    await odstraniLastniStreznik(token, dir);
    await writeFile(path.join(dir, "kljuci.json"), JSON.stringify({ provider: "custom", ...surovo.ponudniki.custom }));
    assert.equal(await activeBrain(dir), null);
    assert.equal(await kljucLastnika(dir), null);
    const stanje = await readBrain(token, dir);
    assert.equal(stanje.provider, null);
    assert.equal(stanje.shranjeni?.some((p) => p.provider === "custom"), false);
    assert.equal(await pogovorBrain(dir), null);
  });

  it("v datoteki rocno vpisan neveljaven naslov ni viden in ni izbran za pogovor", async () => {
    const { dir, token } = await nova();
    await writeFile(
      path.join(dir, "ponudniki.json"),
      JSON.stringify({ ponudniki: { custom: { model: "auto", naslov: "http://example.org/v1" } }, pogovor: { provider: "custom", model: "auto" } }),
    );
    const stanje = await readBrain(token, dir);
    assert.equal(stanje.shranjeni?.some((p) => p.provider === "custom"), false);
    assert.equal(await pogovorBrain(dir), null);
  });

  it("pogovorBrain: custom samo ob izbiri za pogovor; klici ostanejo brez", async () => {
    const { dir, token } = await nova();
    await shraniLastniStreznik({ naslov: NASLOV, key: KLJUC }, token, dir);
    assert.equal(await pogovorBrain(dir), null);
    assert.equal(await activeBrain(dir), null);
    await izberiModelPogovora({ provider: "custom", model: "auto" }, token, dir);
    assert.deepEqual(await pogovorBrain(dir), { provider: "custom", model: "auto", key: KLJUC, naslov: NASLOV });
    assert.equal(await activeBrain(dir), null);
    await assert.rejects(izberiModelPogovora({ provider: "custom", model: "drug-model" }, token, dir), /seznama/);
  });

  it("uporabiZaPogovor: shrani in takoj izbere za pogovor", async () => {
    const { dir, token } = await nova();
    const stanje = await shraniLastniStreznik({ naslov: NASLOV, key: KLJUC, model: "auto:fast", uporabiZaPogovor: true }, token, dir);
    assert.deepEqual(stanje.pogovor, { provider: "custom", model: "auto:fast" });
    assert.equal((await pogovorBrain(dir))?.provider, "custom");
  });

  it("ponovno shranjevanje istega streznika brez kljuca ohrani kljuc in modele", async () => {
    const { dir, token } = await nova();
    await shraniLastniStreznik({ naslov: NASLOV, key: KLJUC, model: "auto" }, token, dir);
    const stanje = await shraniLastniStreznik({ naslov: NASLOV, model: "auto:fast", uporabiZaPogovor: true }, token, dir);
    const p = stanje.shranjeni?.find((x) => x.provider === "custom");
    assert.deepEqual(p?.modeli, ["auto:fast", "auto"]);
    assert.equal((await pogovorBrain(dir))?.key, KLJUC);
  });

  it("drug naslov: stari kljuc NE gre k drugemu gostitelju, modeli in izbira pogovora se zacnejo znova", async () => {
    const { dir, token } = await nova();
    await shraniLastniStreznik({ naslov: NASLOV, key: KLJUC, model: "auto", uporabiZaPogovor: true }, token, dir);
    const stanje = await shraniLastniStreznik({ naslov: "http://192.168.1.50:3001/v1", model: "auto" }, token, dir);
    const p = stanje.shranjeni?.find((x) => x.provider === "custom");
    assert.equal(p?.naslov, "http://192.168.1.50:3001/v1");
    assert.equal(p?.namig, null);
    assert.deepEqual(p?.modeli, ["auto"]);
    assert.equal(stanje.pogovor, null);
    assert.equal(await pogovorBrain(dir), null);
    const surovo = await readFile(path.join(dir, "ponudniki.json"), "utf8");
    assert.equal(surovo.includes("ciphertext"), false);
  });

  it("odstrani: vrne izbiro pogovora na privzeto in ne dotakne drugih ponudnikov", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "openrouter", key: "sk-or-v1-izmisljen-kljuc-za-preizkus-1" }, token, dir);
    await shraniLastniStreznik({ naslov: NASLOV, key: KLJUC, uporabiZaPogovor: true }, token, dir);
    const stanje = await odstraniLastniStreznik(token, dir);
    assert.equal(stanje.shranjeni?.some((p) => p.provider === "custom"), false);
    assert.equal(stanje.shranjeni?.some((p) => p.provider === "openrouter"), true);
    assert.equal(stanje.pogovor, null);
    assert.equal((await pogovorBrain(dir))?.provider, "openrouter");
    // Ponovni vpis istega streznika ne sme obuditi stare izbire za pogovor.
    const znova = await shraniLastniStreznik({ naslov: NASLOV, key: KLJUC, model: "auto" }, token, dir);
    assert.equal(znova.pogovor, null);
    assert.equal((await pogovorBrain(dir))?.provider, "openrouter");
  });
});

describe("lasten streznik: preverba", () => {
  it("uspesna preverba: kratek pogovor, shranjen kljuc samo za isti naslov", async () => {
    const { dir, token } = await nova();
    await shraniLastniStreznik({ naslov: NASLOV, key: KLJUC }, token, dir);
    const vidno: Vidno[] = [];
    globalThis.fetch = lazniFetch(200, uspeh("da"), vidno);
    const a = await preveriLastniStreznik({ naslov: NASLOV }, token, dir);
    assert.deepEqual(a, { ok: true, sporocilo: "Strežnik deluje." });
    assert.equal(vidno[0].avtorizacija, `Bearer ${KLJUC}`);
    assert.equal(vidno[0].telo.max_tokens, 1024);
    // Drug naslov: shranjen kljuc se ne sme poslati.
    await preveriLastniStreznik({ naslov: "http://192.168.1.50:3001/v1" }, token, dir);
    assert.equal(vidno[1].avtorizacija, "");
    // Vpisan kljuc ima prednost.
    await preveriLastniStreznik({ naslov: NASLOV, key: "drug-vpisan-kljuc-12345" }, token, dir);
    assert.equal(vidno[2].avtorizacija, "Bearer drug-vpisan-kljuc-12345");
  });

  it("neuspela preverba vrne razlog; neveljaven naslov brez omrezja", async () => {
    const { dir, token } = await nova();
    const vidno: Vidno[] = [];
    globalThis.fetch = lazniFetch(500, {}, vidno);
    const a = await preveriLastniStreznik({ naslov: NASLOV }, token, dir);
    assert.deepEqual(a, { ok: false, sporocilo: "Strežnik je zavrnil klic (500)." });
    const n = vidno.length;
    const b = await preveriLastniStreznik({ naslov: "http://example.org/v1" }, token, dir);
    assert.equal(b.ok, false);
    assert.equal(vidno.length, n);
  });
});
