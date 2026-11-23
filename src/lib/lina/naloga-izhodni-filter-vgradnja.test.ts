import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  DATOTEKA_DNEVNIKA_FILTRA,
  NAJVEC_VRSTIC_DNEVNIKA,
  OBDRZI_VRSTIC_DNEVNIKA,
  zapisiDnevnikFiltra,
} from "./izhodni-filter.server.ts";
import {
  callProvider,
  nastaviIzhodniFilterZaPreizkus,
  providerRequest,
} from "./providers.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-izhodni-filter-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));

const praviFetch = globalThis.fetch;
const prejsnjiData = process.env.LINA_DATA;
const zacasneMape: string[] = [];

async function novaMapa(): Promise<string> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  zacasneMape.push(dir);
  return dir;
}

afterEach(async () => {
  globalThis.fetch = praviFetch;
  nastaviIzhodniFilterZaPreizkus(null);
  if (prejsnjiData === undefined) delete process.env.LINA_DATA;
  else process.env.LINA_DATA = prejsnjiData;
  while (zacasneMape.length > 0) {
    const dir = zacasneMape.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("naloga-izhodni-filter: vgradnja v callProvider", { concurrency: 1 }, () => {
  it("v zahtevi ponudniku ni kljuca, gesla, kartice ali IBAN; dnevnik zapise samo stevila", async () => {
    const dir = await novaMapa();
    process.env.LINA_DATA = dir;

    const poslanaTelesa: string[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      poslanaTelesa.push(String(init?.body ?? ""));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "Prejeto brez skrivnosti." } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const izid = await callProvider({
      provider: "openai",
      model: "gpt-4.1-mini",
      key: "kljuc-ponudnika-test",
      system: "Navodilo z geslo: TajnoSistem99 in IBAN SI56 0000 0000 0000 001.",
      text: "Kljuc sk-test00000000000000000042, geslo: MojeGeslo42 in kartica 4111 1111 1111 1111.",
    });

    assert.equal(izid.ok, true);
    assert.equal(poslanaTelesa.length, 1);
    const telo = poslanaTelesa[0];
    for (const tajno of [
      "sk-test00000000000000000042",
      "MojeGeslo42",
      "TajnoSistem99",
      "4111 1111 1111 1111",
      "SI56 0000 0000 0000 001",
    ]) {
      assert.equal(telo.includes(tajno), false, `V zahtevi ne sme biti: ${tajno}`);
    }
    assert.equal(telo.includes("[KLJUC]"), true);
    assert.equal(telo.includes("[GESLO]"), true);
    assert.equal(telo.includes("[KARTICA]"), true);
    assert.equal(telo.includes("[IBAN]"), true);

    const suroviDnevnik = await readFile(path.join(dir, DATOTEKA_DNEVNIKA_FILTRA), "utf8");
    const vrstice = suroviDnevnik.trim().split("\n");
    assert.equal(vrstice.length, 1);
    const zapis = JSON.parse(vrstice[0]) as { cas: string; kategorije: Record<string, number> };
    assert.equal(Number.isNaN(Date.parse(zapis.cas)), false);
    assert.deepEqual(zapis.kategorije, { kljuc: 1, geslo: 2, kartica: 1, iban: 1 });
    for (const tajno of ["sk-test", "MojeGeslo42", "TajnoSistem99", "4111", "SI56"]) {
      assert.equal(suroviDnevnik.includes(tajno), false, `V dnevniku ne sme biti: ${tajno}`);
    }
  });

  it("pri asistentki (vsebinaKlica: false) zakrije stike v text in system brez trka ter obnovi odgovor (opozorilo ostane)", async () => {
    const dir = await novaMapa();
    process.env.LINA_DATA = dir;

    const klicaniNaslovi: string[] = [];
    const poslanaTelesa: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      klicaniNaslovi.push(u);
      poslanaTelesa.push(String(init?.body ?? ""));
      // Prvi klic gre na prehod, ki zavrne (503), da preverimo ohranitev opozorila ob rezervi.
      if (u.startsWith("http://localhost:20128/")) {
        return new Response("nedosegljiv", { status: 503 });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Pisal sem na [E-POSTA-1] in [E-POSTA-2] ter klical [TELEFON-1]." } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const izid = await callProvider({
      provider: "openai",
      model: "gpt-4.1-mini",
      key: "kljuc-ponudnika-test",
      vsebinaKlica: false,
      prehod: { vklop: true, naslov: "http://localhost:20128/v1", klici: false, kljuc: "prehod-kljuc-1234" },
      system: "Lastnikov naslov je lastnik@primer.si.",
      text: "Poslji sporocilo na ana@primer.si in poklici +386 40 000 007.",
    });

    assert.equal(izid.ok, true);
    assert.equal(klicaniNaslovi.length, 2);
    for (const telo of poslanaTelesa) {
      assert.equal(telo.includes("ana@primer.si"), false);
      assert.equal(telo.includes("lastnik@primer.si"), false);
      assert.equal(telo.includes("+386 40 000 007"), false);
      assert.equal(telo.includes("[E-POSTA-1]"), true);
      assert.equal(telo.includes("[E-POSTA-2]"), true);
      assert.equal(telo.includes("[TELEFON-1]"), true);
    }
    assert.equal(
      izid.text,
      "Pisal sem na ana@primer.si in lastnik@primer.si ter klical +386 40 000 007.",
    );
    assert.match(izid.opozorilo ?? "", /Prehod je zavrnil klic \(503\)\. Uporabljen je izbrani ponudnik\./);
  });

  it("pri klicu (privzeto vsebinaKlica: true) stiki gredo nespremenjeni, audio ostane nedotaknjen, brez najdb ni dnevnika", async () => {
    const dir = await novaMapa();
    process.env.LINA_DATA = dir;

    const poslanaTelesa: string[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      poslanaTelesa.push(String(init?.body ?? ""));
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "Zapisala sem klic." }] } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const surovAudio = "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
    const izid = await callProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      key: "kljuc-gemini-test",
      text: "Klicatelj Ana Primer, telefon +386 40 000 008, e-posta ana@primer.si.",
      audio: { mime: "audio/wav", data: surovAudio },
    });

    assert.equal(izid.ok, true);
    assert.equal(poslanaTelesa.length, 1);
    assert.equal(poslanaTelesa[0].includes("+386 40 000 008"), true);
    assert.equal(poslanaTelesa[0].includes("ana@primer.si"), true);
    assert.equal(poslanaTelesa[0].includes(surovAudio), true);
    const datoteke = await readdir(dir);
    assert.equal(datoteke.includes(DATOTEKA_DNEVNIKA_FILTRA), false);
  });

  it("ob napaki filtra zavrne klic z 'Izhodni filter ni uspel.' in ne klice fetch", async () => {
    const dir = await novaMapa();
    process.env.LINA_DATA = dir;

    let kliciFetch = 0;
    globalThis.fetch = (async () => {
      kliciFetch += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    nastaviIzhodniFilterZaPreizkus(() => {
      throw new Error("simulirana napaka filtra");
    });

    const izid = await callProvider({
      provider: "openai",
      model: "gpt-4.1-mini",
      key: "kljuc-ponudnika-test",
      text: "Obcutljivo besedilo sk-test00000000000000000001",
    });

    assert.deepEqual(izid, { ok: false, sporocilo: "Izhodni filter ni uspel." });
    assert.equal(kliciFetch, 0);
  });

  it("OpenRouter (neposredno in prek prehoda OmniRoute) nastavi provider.data_collection = 'deny'", async () => {
    const neposredno = providerRequest({
      provider: "openrouter",
      model: "openai/gpt-4o",
      key: "kljuc-openrouter-test",
      text: "Pozdrav",
    });
    const teloNeposredno = JSON.parse(String(neposredno.init.body)) as {
      provider?: { data_collection?: string };
    };
    assert.deepEqual(teloNeposredno.provider, { data_collection: "deny" });

    // OpenAI ne dobi OpenRouter polja provider.
    const openai = providerRequest({
      provider: "openai",
      model: "gpt-4.1-mini",
      key: "kljuc-openai-test",
      text: "Pozdrav",
    });
    const teloOpenai = JSON.parse(String(openai.init.body)) as { provider?: unknown };
    assert.equal(teloOpenai.provider, undefined);

    // Prehod OmniRoute, ko kaze na OpenRouter (provider: "openrouter"): vkljuci data_collection: "deny" in obnovi psevdonime.
    const dir = await novaMapa();
    process.env.LINA_DATA = dir;
    const prehodTelesa: string[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      prehodTelesa.push(String(init?.body ?? ""));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "Poslano [E-POSTA-1]." } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const izid = await callProvider({
      provider: "openrouter",
      model: "openai/gpt-4o",
      key: "kljuc-openrouter-test",
      vsebinaKlica: false,
      prehod: { vklop: true, naslov: "http://localhost:20128/v1", klici: false, kljuc: "prehod-kljuc-1234" },
      text: "Pisi na ana@primer.si",
    });

    assert.equal(izid.ok, true);
    assert.equal(izid.text, "Poslano ana@primer.si.");
    assert.equal(prehodTelesa.length, 1);
    const teloPrehoda = JSON.parse(prehodTelesa[0]) as { provider?: { data_collection?: string } };
    assert.deepEqual(teloPrehoda.provider, { data_collection: "deny" });
  });

  it("dnevnik izhodni-filter.jsonl pri preseganju 2000 vrstic atomarno obdrzi zadnjih 1000 vrstic", async () => {
    const dir = await novaMapa();
    const pot = path.join(dir, DATOTEKA_DNEVNIKA_FILTRA);
    const zacetne = Array.from({ length: NAJVEC_VRSTIC_DNEVNIKA }, (_, i) =>
      JSON.stringify({ cas: `2026-11-21T00:00:${String(i % 60).padStart(2, "0")}.000Z`, kategorije: { kljuc: i + 1 } }),
    );
    await writeFile(pot, `${zacetne.join("\n")}\n`, "utf8");

    const zapisano = await zapisiDnevnikFiltra({ geslo: 2 }, dir, new Date("2026-11-21T03:00:00.000Z"));
    assert.equal(zapisano, true);

    const po = (await readFile(pot, "utf8")).trim().split("\n");
    assert.equal(po.length, OBDRZI_VRSTIC_DNEVNIKA);
    // Prva ohranjena je bila 1002. vrstica (indeks 1001 => kljuc: 1002), zadnja je pravkar dodana.
    assert.deepEqual((JSON.parse(po[0]) as { kategorije: Record<string, number> }).kategorije, { kljuc: 1002 });
    assert.deepEqual((JSON.parse(po[po.length - 1]) as { kategorije: Record<string, number> }).kategorije, { geslo: 2 });

    // Brez zaostalih zacasnih .tmp datotek.
    const datoteke = await readdir(dir);
    assert.deepEqual(datoteke, [DATOTEKA_DNEVNIKA_FILTRA]);

    // Prazne kategorije ne dodajo vrstice.
    assert.equal(await zapisiDnevnikFiltra({ kljuc: 0, geslo: 0 }, dir), false);
    assert.equal((await readFile(pot, "utf8")).trim().split("\n").length, OBDRZI_VRSTIC_DNEVNIKA);
  });

  it("besedilni preizkus: vgradnja v providers.ts, cistost izhodni-filter.ts in locen dnevnik .server.ts", async () => {
    const koren = path.dirname(new URL(import.meta.url).pathname);
    const providersKoda = await readFile(path.join(koren, "providers.ts"), "utf8");
    const cistaKoda = await readFile(path.join(koren, "izhodni-filter.ts"), "utf8");
    const streznikKoda = await readFile(path.join(koren, "izhodni-filter.server.ts"), "utf8");

    // callProvider poklice filtrirajIzhod, uporabi obnovi, ob napaki vrne "Izhodni filter ni uspel."
    const zacetekCallProvider = providersKoda.indexOf("export async function callProvider(");
    assert.ok(zacetekCallProvider >= 0);
    const teloCallProvider = providersKoda.slice(zacetekCallProvider, providersKoda.indexOf("async function callProviderNeposredno("));
    assert.match(teloCallProvider, /\bfiltrirajIzhod\(/);
    assert.match(teloCallProvider, /\bobnovi\(/);
    assert.match(teloCallProvider, /Izhodni filter ni uspel\./);

    // OpenRouter telo vsebuje data_collection.
    assert.match(providersKoda, /data_collection:\s*"deny"/);

    // Dnevnik je v locenem .server.ts, cista enota je brez strezniskih uvozov in omrezja.
    assert.match(providersKoda, /from "\.\/izhodni-filter\.server\.ts"/);
    assert.doesNotMatch(cistaKoda, /node:|server\.ts|\bfetch\b/);
    assert.match(streznikKoda, /izhodni-filter\.jsonl/);
    assert.match(streznikKoda, /resolveDataDir/);
  });
});
