/**
 * Naloga 30 (lastnik 26. 11. 2026, »Se strinjam z tvojimi predlogi«):
 * 1. B9: neuspel prevod opisa prek Googla v lastnikovem projektu -> opis ne gre nobenemu drugemu ponudniku (ne mozganom asistentke,
 *    ne OpenRouterju) in slika/video se ne ustvari; orodje ustvari_sliko vrne »Prevod opisa ni uspel, slika ni ustvarjena.«
 * 2. ustvari_sliko caka lastnika samo, ce je naloga pred tem prebrala zasebne podatke; sicer brez potrditve.
 * 3. Seznam prepovedanih map brez veljavnega podpisa (spremenjen, izpraznjen, nikoli potrjen) -> opozorilo v zavihku Racunalnik;
 *    »Potrdi seznam« (ukaz prepovedane z geslom lastnika) ga podpise. Ukaz mape prepovedanih ne podpise vec sam.
 * Omrezje je lazno (globalThis.fetch, ki vsak gostitelj zapise; tople povezave in ogrevanje izklopljeni). Podatki izmisljeni.
 * Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { podpisSeznama, stanjeClaudeNalog, ukazClaudeNalog, type Odvisnosti } from "./claude-naloge.server.ts";
import { shraniKljucAsistentke, pogovorBrain } from "./keys.server.ts";
import { nastaviOgrevanjeZaPreizkus } from "./ogrevanje-klica.server.ts";
import { potrdiOpozorilo } from "./opozorilo.server.ts";
import { zahtevaPotrditev, type OrodjeOrkestratorja } from "./orkestrator.ts";
import { orodjaLine } from "./orkestrator-orodja.server.ts";
import { ustvariOrkestrator, type KlicModela } from "./orkestrator.server.ts";
import { nastaviToplePovezave } from "./povezave.server.ts";
import type { KlicOrodja, RezultatOrodij } from "./providers.ts";
import { DATOTEKA_SLIK, generirajSliko } from "./slike-generator.server.ts";
import { generirajVideo } from "./video-generator.server.ts";
import { razvrstiDejanje } from "./vprasanja-agentov.ts";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]);
const ZETON = "ya29.zeton-preizkusa";
const SPOROCILO = "Prevod opisa ni uspel, slika ni ustvarjena.";
const odgovorSlike = () => ({ candidates: [{ content: { role: "model", parts: [{ inlineData: { mimeType: "image/png", data: PNG.toString("base64") } }] }, finishReason: "STOP" }] });
const odgovorMozganov = () => ({ choices: [{ message: { content: "A dog on a meadow" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });

let n = 0;
const ids = () => `id${String(++n).padStart(10, "0")}`;
const vertex = async () => ({ provider: "vertex", project: "moj-projekt" });
const ctx = (nalogaId = "o-0000000000000030") => ({ nalogaId, signal: new AbortController().signal });
const poImenu = (o: OrodjeOrkestratorja[]) => new Map(o.map((x) => [x.definicija.ime, x]));

before(() => {
  // tople povezave do googleapis.com in ogrevanje bi lahko sle mimo laznega fetch (opazanje 0128)
  nastaviToplePovezave(false);
  nastaviOgrevanjeZaPreizkus(async () => undefined);
});
after(() => nastaviOgrevanjeZaPreizkus(null));

/**
 * Lazni globalThis.fetch: zapise gostitelja vsake zahteve. Prevod Google: 500 (prevodOk=false) ali prevod; slika Vertex: slika;
 * mozgani (openrouter.ai): odgovor, da bi zahteva tja uspela (in se videla), ce bi jo koda poslala.
 */
async function zLaznimOmrezjem<T>(prevodOk: boolean, fn: () => Promise<T>): Promise<{ izid: T | Error; gostitelji: string[] }> {
  const gostitelji: string[] = [];
  const prej = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL | Request) => {
    const url = new URL(u instanceof Request ? u.url : String(u));
    gostitelji.push(url.hostname);
    if (url.hostname === "translation.googleapis.com") {
      return prevodOk ? new Response(JSON.stringify({ translations: [{ translatedText: "A dog on a meadow" }] }), { status: 200 }) : new Response("napaka", { status: 500 });
    }
    if (url.pathname.endsWith(":generateContent")) return new Response(JSON.stringify(odgovorSlike()), { status: 200 });
    if (url.pathname.endsWith(":predictLongRunning")) return new Response(JSON.stringify({ name: "x" }), { status: 200 });
    return new Response(JSON.stringify(odgovorMozganov()), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    return { izid: await fn().catch((e: unknown) => (e instanceof Error ? e : new Error(String(e)))), gostitelji };
  } finally {
    globalThis.fetch = prej;
  }
}

/** Lastnik z mozgani asistentke na OpenRouterju (kljuc s soglasjem) - prav ta ponudnik ne sme dobiti opisa. */
async function lastnikZOpenRouterjem() {
  const baza = await realpath(await mkdtemp(path.join(tmpdir(), "lina-n30-")));
  const root = path.join(baza, "podatki");
  await mkdir(root, { recursive: true });
  const token = await setupOwner("geslo-test-1234", root);
  await shraniKljucAsistentke({ key: "sk-or-v1-izmisljen-kljuc-asistentke-3030", soglasje: true }, token, root);
  assert.equal((await pogovorBrain(root))?.provider, "openrouter", "predpogoj: mozgani asistentke so OpenRouter");
  return { baza, root, token };
}

const samoPrevod = (g: string[]) => g.every((h) => h === "translation.googleapis.com");
const brezKnjiznice = async (root: string) => assert.equal(await stat(path.join(root, DATOTEKA_SLIK)).then(() => true, () => false), false, "nic v knjiznici");

describe("naloga 30 / 1: B9 - neuspel Google prevod opisa", () => {
  it("orodje ustvari_sliko: jasno sporocilo, zahteve samo na Google prevod (ne openrouter.ai, ne Vertex), nic v knjiznici, meja se vrne", async () => {
    const { root } = await lastnikZOpenRouterjem();
    const o = poImenu(orodjaLine(root, { slike: { mozgani: vertex, zeton: async () => ZETON, nakljucno: ids } })).get("ustvari_sliko")!;
    // 5 x 2 slike > meja 8: ce neuspel prevod ne vrne rezervacije, peti klic dobi mejo namesto sporocila o prevodu
    for (let i = 0; i < 5; i++) {
      const { izid, gostitelji } = await zLaznimOmrezjem(false, () => o.izvedi({ opis: "pes na travniku", stevilo: 2 }, ctx()));
      assert.ok(!(izid instanceof Error) && "ok" in izid && !izid.ok, JSON.stringify(izid));
      if (izid instanceof Error || !("ok" in izid) || izid.ok) return;
      assert.equal(izid.napaka, SPOROCILO);
      assert.ok(gostitelji.length >= 1 && samoPrevod(gostitelji), gostitelji.join(","));
    }
    await brezKnjiznice(root);
  });

  it("kontrola: uspel prevod - orodje ustvari sliko prek Vertexa (lazno omrezje res prestreze zahteve)", async () => {
    const { root } = await lastnikZOpenRouterjem();
    const o = poImenu(orodjaLine(root, { slike: { mozgani: vertex, zeton: async () => ZETON, nakljucno: ids } })).get("ustvari_sliko")!;
    const { izid, gostitelji } = await zLaznimOmrezjem(true, () => o.izvedi({ opis: "pes na travniku" }, ctx("o-0000000000000031")));
    assert.ok(!(izid instanceof Error) && "ok" in izid && izid.ok, JSON.stringify(izid));
    assert.deepEqual([...new Set(gostitelji)].sort(), ["aiplatform.googleapis.com", "translation.googleapis.com"]);
  });

  it("lastnikova pot (Mediji, generirajSlikoFn): napaka s sporocilom, opis ne gre k mozganom asistentke, slike ni", async () => {
    const { root, token } = await lastnikZOpenRouterjem();
    const { izid, gostitelji } = await zLaznimOmrezjem(false, () => generirajSliko("pes na travniku z zasebnimi podatki", token, root, { projekt: "moj-projekt", zeton: async () => ZETON, nakljucno: ids }));
    assert.ok(izid instanceof Error, "generirajSliko mora vreci");
    assert.equal((izid as Error).message, SPOROCILO);
    assert.ok(samoPrevod(gostitelji), gostitelji.join(","));
    await brezKnjiznice(root);
  });

  it("video (generirajVideo): enako - samo Google prevod, video ni ustvarjen", async () => {
    const { root, token } = await lastnikZOpenRouterjem();
    const { izid, gostitelji } = await zLaznimOmrezjem(false, () => generirajVideo("pes tece po travniku", token, root, { projekt: "moj-projekt", zeton: async () => ZETON, cakaj: async () => undefined }));
    assert.ok(izid instanceof Error, "generirajVideo mora vreci");
    assert.equal((izid as Error).message, "Prevod opisa ni uspel, video ni ustvarjen.");
    assert.ok(samoPrevod(gostitelji), gostitelji.join(","));
  });

  it("dolg opis (1950 znakov, pod mejo 2000) z enako dolgim prevodom: prevod velja (meja poziva ga ne zavrne)", async () => {
    const { root } = await lastnikZOpenRouterjem();
    const dolg = "x".repeat(1950);
    const prej = globalThis.fetch;
    const gostitelji: string[] = [];
    globalThis.fetch = (async (u: string | URL | Request) => {
      const url = new URL(String(u));
      gostitelji.push(url.hostname);
      if (url.hostname === "translation.googleapis.com") return new Response(JSON.stringify({ translations: [{ translatedText: "y".repeat(1990) }] }), { status: 200 });
      return new Response(JSON.stringify(odgovorSlike()), { status: 200 });
    }) as typeof fetch;
    try {
      const o = poImenu(orodjaLine(root, { slike: { mozgani: vertex, zeton: async () => ZETON, nakljucno: ids } })).get("ustvari_sliko")!;
      const izid = await o.izvedi({ opis: dolg }, ctx("o-0000000000000032"));
      assert.ok("ok" in izid && izid.ok, JSON.stringify(izid));
      assert.ok(gostitelji.includes("aiplatform.googleapis.com"));
    } finally {
      globalThis.fetch = prej;
    }
  });
});

// --- 2. potrditev ustvari_sliko po branju zasebnih podatkov (skozi orkestrator, ne samo zahtevaPotrditev) -------------------------

const klic = (ime: string, argumenti: Record<string, unknown> = {}): KlicOrodja => ({ id: "x", ime, argumenti });
const odg = (klici: KlicOrodja[], besedilo = ""): RezultatOrodij => ({ ok: true, besedilo, klici, usage: { vhod: 10, izhod: 5, predpomnjeni: 0 }, razlogKonca: klici.length ? "orodje" : "konec" });
function scenarij(koraki: RezultatOrodij[]): KlicModela {
  let i = 0;
  return async () => koraki[Math.min(i++, koraki.length - 1)]!;
}
const brez = { oceni: null, ucenje: null, imaGeslo: async () => true } as const;

async function okoljeOrodij() {
  const baza = await realpath(await mkdtemp(path.join(tmpdir(), "lina-n30o-")));
  const root = path.join(baza, "podatki");
  const proj = path.join(baza, "projekt");
  for (const m of [root, proj]) await mkdir(m, { recursive: true });
  const p = { podpisMap: await podpisSeznama(root, "mape", [proj]), podpisPrepovedanih: await podpisSeznama(root, "prepovedane", []) };
  await writeFile(path.join(root, "claude-naloge.json"), JSON.stringify({ v: 1, mape: [proj], naloge: [], prepovedane: [], ...p }));
  await writeFile(path.join(proj, "zasebno.txt"), "IBAN SI56 0000 0000 0000 000\n");
  return { root, proj };
}

function lazniVertex() {
  const zahteve: string[] = [];
  const f = (async (u: string | URL | Request) => {
    zahteve.push(String(u));
    return new Response(JSON.stringify(odgovorSlike()), { status: 200 });
  }) as typeof fetch;
  return { f, zahteve };
}
const PREVOD = async (b: string) => `EN: ${b}`;

describe("naloga 30 / 2: ustvari_sliko - potrditev samo po branju zasebnih podatkov", () => {
  it("po preberi_datoteko naloga caka lastnika za ustvari_sliko; brez potrditve ni zahteve generatorju", async () => {
    const { root, proj } = await okoljeOrodij();
    const v = lazniVertex();
    const m = scenarij([
      odg([klic("preberi_datoteko", { pot: path.join(proj, "zasebno.txt") })]),
      odg([klic("ustvari_sliko", { opis: "slika z IBAN SI56 0000 0000 0000 000" })]),
      odg([], "Konec."),
    ]);
    const o = ustvariOrkestrator(root, { ...brez, klicModela: m, orodja: orodjaLine(root, { slike: { mozgani: vertex, fetch: v.f, zeton: async () => ZETON, prevedi: PREVOD, nakljucno: ids } }) });
    const s = await o.teci((await o.nova({ cilj: "Preberi zasebno.txt in naredi sliko." })).id);
    assert.equal(s.faza, "caka-potrditev");
    assert.equal(s.odprti[0]!.ime, "ustvari_sliko");
    assert.equal(v.zahteve.length, 0, "brez potrditve ni zahteve generatorju slik");
  });

  it("brez prej prebranih zasebnih podatkov: ustvari_sliko tece brez potrditve (kot doslej)", async () => {
    const { root } = await okoljeOrodij();
    const v = lazniVertex();
    const m = scenarij([odg([klic("ustvari_sliko", { opis: "pes na travniku" })]), odg([], "Slika je v Medijih.")]);
    const o = ustvariOrkestrator(root, { ...brez, klicModela: m, orodja: orodjaLine(root, { slike: { mozgani: vertex, fetch: v.f, zeton: async () => ZETON, prevedi: PREVOD, nakljucno: ids } }) });
    const s = await o.teci((await o.nova({ cilj: "Naredi sliko psa." })).id);
    assert.equal(s.faza, "koncano");
    assert.equal(v.zahteve.length, 1);
  });

  it("definicija in oznaka v potrditvi: potrditevPoZasebnih; oznaka omrezje (ne neznano)", () => {
    const o = poImenu(orodjaLine("/ni")).get("ustvari_sliko")!;
    assert.equal(zahtevaPotrditev(o, false, false, false), false);
    assert.equal(zahtevaPotrditev(o, false, true, false), false, "podatki brez zasebnih (npr. splet) ne zahtevajo potrditve");
    assert.equal(zahtevaPotrditev(o, false, false, true), true);
    assert.deepEqual(razvrstiDejanje("ustvari_sliko", { opis: "pes" }, "/ni").razlogi, ["omrezje"]);
  });
});

// --- 3. seznam prepovedanih map: opozorilo in »Potrdi seznam« -----------------------------------------------------------------

async function okoljeNalog() {
  const baza = await realpath(await mkdtemp(path.join(tmpdir(), "lina-n30p-")));
  const root = path.join(baza, "podatki");
  const dom = path.join(baza, "dom");
  const proj = path.join(dom, "projekt");
  for (const m of [root, proj, path.join(proj, "scit")]) await mkdir(m, { recursive: true });
  const token = await setupOwner("geslo-test-1234", root);
  await potrdiOpozorilo(root);
  const o: Odvisnosti = { dom, najdi: () => null, preveriZagon: async () => ({ koda: 0, izpis: "", potekel: false }), zazeni: async () => undefined };
  return { root, proj, token, o, datoteka: path.join(root, "claude-naloge.json") };
}

describe("naloga 30 / 3: seznam prepovedanih map ni potrjen", () => {
  it("lastnik ga shrani -> ni opozorila; datoteka spremenjena brez lastnika -> opozorilo; Potrdi seznam (isti seznam) -> ni opozorila", async () => {
    const { root, proj, token, o, datoteka } = await okoljeNalog();
    const scit = path.join(proj, "scit");
    await ukazClaudeNalog(token, { ukaz: "prepovedane", mape: [scit] }, root, o);
    assert.equal((await stanjeClaudeNalog(token, root, o)).prepovedaneNepotrjene, false);
    // drug proces izprazni seznam (podpis ostane) - podpis ne velja vec
    const s = JSON.parse(await readFile(datoteka, "utf8"));
    await writeFile(datoteka, JSON.stringify({ ...s, prepovedane: [] }));
    const st = await stanjeClaudeNalog(token, root, o);
    assert.equal(st.prepovedaneNepotrjene, true);
    assert.deepEqual(st.prepovedane, [], "lastnik vidi seznam, ki ga potrjuje");
    // gumb Potrdi seznam poslje prikazani seznam
    await ukazClaudeNalog(token, { ukaz: "prepovedane", mape: st.prepovedane }, root, o);
    assert.equal((await stanjeClaudeNalog(token, root, o)).prepovedaneNepotrjene, false);
  });

  it("pranje (19b #4): izpraznjen seznam brez podpisa; ukaz mape ga NE podpise, opozorilo ostane", async () => {
    const { root, proj, token, o, datoteka } = await okoljeNalog();
    await ukazClaudeNalog(token, { ukaz: "prepovedane", mape: [path.join(proj, "scit")] }, root, o);
    await ukazClaudeNalog(token, { ukaz: "mape", mape: [proj] }, root, o);
    const s = JSON.parse(await readFile(datoteka, "utf8"));
    delete s.podpisPrepovedanih;
    await writeFile(datoteka, JSON.stringify({ ...s, prepovedane: [] }));
    await ukazClaudeNalog(token, { ukaz: "mape", mape: [proj] }, root, o);
    assert.equal((await stanjeClaudeNalog(token, root, o)).prepovedaneNepotrjene, true);
  });

  it("nova namestitev: prazen, nikoli potrjen seznam -> opozorilo (tudi po Shrani mape), dokler ga lastnik ne potrdi", async () => {
    const { root, proj, token, o } = await okoljeNalog();
    assert.equal((await stanjeClaudeNalog(token, root, o)).prepovedaneNepotrjene, true);
    await ukazClaudeNalog(token, { ukaz: "mape", mape: [proj] }, root, o);
    assert.equal((await stanjeClaudeNalog(token, root, o)).prepovedaneNepotrjene, true);
    await ukazClaudeNalog(token, { ukaz: "prepovedane", mape: [] }, root, o);
    assert.equal((await stanjeClaudeNalog(token, root, o)).prepovedaneNepotrjene, false);
  });
});
