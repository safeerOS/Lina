/** Preizkusi Lininega generatorja slik (slike-generator.server.ts): brez omrezja, lazni fetch in zeton. Podatki so izmisljeni. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import {
  DATOTEKA_SLIK,
  MAPA_SLIK,
  NAJVEC_ZNAKOV_OPISA,
  generirajSliko,
  knjiznicaSlik,
  naslovSlik,
  preveriVhodSlike,
  razberiSlike,
  teloSlik,
} from "./slike-generator.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-slike-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
async function nova() {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  return { dir, token: await setupOwner("geslo-test-1234", dir) };
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 3)]);
const ZETON = "ya29.zeton-preizkusa";
/** Ena slika v obliki pravega odgovora generateContent (26. 11. 2026). */
const odg = (b: Buffer, mimeType?: string) => ({ candidates: [{ content: { parts: [{ inlineData: { ...(mimeType ? { mimeType } : {}), data: b.toString("base64") } }] }, finishReason: "STOP" }] });
const BREZ_SLIKE = { candidates: [{ content: { parts: [{ text: "ne" }] }, finishReason: "STOP" }] };
const PREVOD = async (b: string) => b;

function lazni(status: number, telo: unknown) {
  const klici: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    // Rezervni Googlov prevajalnik gre skozi isti lazni fetch; steti samo zahteve za slike.
    if (String(url).startsWith("https://translation.googleapis.com/")) return new Response("{}", { status: 200 });
    klici.push({ url: String(url), init: init ?? {} });
    return new Response(typeof telo === "string" ? telo : JSON.stringify(telo), { status });
  }) as typeof fetch;
  return { f, klici };
}
let n = 0;
const ids = () => `id${String(++n).padStart(10, "0")}`;

describe("ciste preverbe", () => {
  it("vhod: prazen, predolg, neznan model, stevilo, razmerje, serija", () => {
    assert.equal(preveriVhodSlike("pes bere casopis"), null);
    for (const slab of [undefined, "", "   ", 5, "x".repeat(NAJVEC_ZNAKOV_OPISA + 1)]) assert.notEqual(preveriVhodSlike(slab), null, String(slab).slice(0, 20));
    assert.notEqual(preveriVhodSlike("a", { model: "dall-e" }), null);
    for (const s of [0, 5, 1.5, "2"]) assert.notEqual(preveriVhodSlike("a", { stevilo: s }), null, String(s));
    for (const s of [1, 4]) assert.equal(preveriVhodSlike("a", { stevilo: s }), null);
    assert.notEqual(preveriVhodSlike("a", { razmerje: "2:1" }), null);
    assert.equal(preveriVhodSlike("a", { razmerje: "16:9" }), null);
    for (const s of ["../x", "ABCDEFGHIJKL", "kratko", 5]) assert.notEqual(preveriVhodSlike("a", { serija: s }), null, String(s));
    assert.equal(preveriVhodSlike("a", { serija: "abc123def456" }), null);
  });

  // Naloga 20: Imagen je ugasnjen; naslov in oblika odgovora Gemini image (generateContent, global) - podrobno v naloga-20-slike.test.ts.
  it("naslov: generateContent na global; projekt ne more vriniti poti", () => {
    assert.equal(
      naslovSlik("moj-projekt", "gemini-3.1-flash-image"),
      "https://aiplatform.googleapis.com/v1/projects/moj-projekt/locations/global/publishers/google/models/gemini-3.1-flash-image:generateContent",
    );
    for (const p of ["../x", "a/b", "Moj", "moj-projekt/../../x", "ab"]) assert.throws(() => naslovSlik(p, "gemini-3.1-flash-image"), p);
  });

  it("odgovor: PNG in JPEG sprejeta; brez slike (filter), ne-slika in napacen mime zavrnjeni", () => {
    assert.equal(razberiSlike(odg(PNG, "image/png")).slike[0]?.mime, "image/png");
    assert.equal(razberiSlike(odg(JPG)).slike[0]?.mime, "image/jpeg");
    for (const slabo of [{ candidates: [{ content: { parts: [{ text: "ne" }] } }] }, odg(Buffer.from("<html>")), odg(PNG, "text/html"), {}, null]) {
      assert.deepEqual(razberiSlike(slabo), { slike: [], zavrnjenih: 1 });
    }
  });
});

describe("generirajSliko", () => {
  it("samo lastnik: brez zetona vrze in zahteve ne poslje", async () => {
    const { dir } = await nova();
    const { f, klici } = lazni(200, BREZ_SLIKE);
    for (const z of [null, "napacen"]) await assert.rejects(generirajSliko("pes", z, dir, { fetch: f, zeton: async () => ZETON, projekt: "moj-projekt" }));
    await assert.rejects(knjiznicaSlik(null, dir));
    assert.equal(klici.length, 0);
  });

  it("zahteva: Bearer zeton v glavi (ne v naslovu), brez preusmeritev, pravo telo; slike 0600 v knjiznici z isto serijo", async () => {
    const { dir, token } = await nova();
    const { f, klici } = lazni(200, odg(PNG, "image/png"));
    const izid = await generirajSliko("  pes bere casopis  ", token, dir, { fetch: f, zeton: async () => ZETON, projekt: "moj-projekt", stevilo: 2, razmerje: "16:9", prevedi: PREVOD, nakljucno: ids, zdaj: () => new Date("2026-11-21T22:00:00Z") });
    // ena slika na zahtevo (candidateCount > 1 vrne 400)
    assert.equal(klici.length, 2);
    assert.equal(klici[0].url.includes(ZETON), false);
    assert.equal((klici[0].init.headers as Record<string, string>).authorization, `Bearer ${ZETON}`);
    assert.equal(klici[0].init.redirect, "error");
    assert.deepEqual(JSON.parse(String(klici[0].init.body)), teloSlik("pes bere casopis", "16:9"));
    assert.equal(izid.slike.length, 2);
    assert.equal(izid.zavrnjenih, 0);
    const serija = izid.slike[0].serija;
    assert.ok(izid.slike.every((s) => s.serija === serija && s.opis === "pes bere casopis" && s.model === "gemini-3.1-flash-image"));
    assert.deepEqual(izid.slike.map((s) => path.extname(s.datoteka)), [".png", ".png"]);
    for (const s of izid.slike) {
      const pot = path.join(dir, MAPA_SLIK, s.datoteka);
      assert.equal((await stat(pot)).mode & 0o777, 0o600);
      assert.equal((await readFile(pot)).length, s.bajtov);
    }
    assert.deepEqual((await knjiznicaSlik(token, dir)).slike.map((s) => s.id), izid.slike.map((s) => s.id));
    // Nadaljevanje niza: ista serija, nove slike na vrhu.
    const naprej = await generirajSliko("pes pije kavo", token, dir, { fetch: lazni(200, odg(JPG)).f, zeton: async () => ZETON, projekt: "moj-projekt", serija, prevedi: PREVOD, nakljucno: ids });
    const k = await knjiznicaSlik(token, dir);
    assert.equal(k.slike.length, 3);
    assert.equal(k.slike[0].id, naprej.slike[0].id);
    assert.equal(k.slike[0].serija, serija);
  });

  it("napaka ponudnika, neveljaven JSON ali vse zavrnjeno: nic se ne zapise", async () => {
    const { dir, token } = await nova();
    // naloga 30 (B9): brez uspelega prevoda zahteve ponudniku slik ni - preizkus napak ponudnika zato poda prevod
    await assert.rejects(generirajSliko("pes", token, dir, { fetch: lazni(403, "zavrnjeno").f, zeton: async () => ZETON, projekt: "moj-projekt", prevedi: PREVOD }), /403/);
    await assert.rejects(generirajSliko("pes", token, dir, { fetch: lazni(200, "ni json").f, zeton: async () => ZETON, projekt: "moj-projekt", prevedi: PREVOD }), /neveljaven/);
    const vse = await generirajSliko("pes", token, dir, { fetch: lazni(200, BREZ_SLIKE).f, zeton: async () => ZETON, projekt: "moj-projekt", prevedi: PREVOD });
    assert.deepEqual(vse, { slike: [], zavrnjenih: 1 });
    assert.deepEqual(await readdir(path.join(dir, MAPA_SLIK)), []);
    await assert.rejects(stat(path.join(dir, DATOTEKA_SLIK)));
  });

  it("brez projekta Vertex jasna napaka; pokvarjena knjiznica = prazna", async () => {
    const { dir, token } = await nova();
    const { f, klici } = lazni(200, BREZ_SLIKE);
    await assert.rejects(generirajSliko("pes", token, dir, { fetch: f, zeton: async () => ZETON }), /Vertex/);
    assert.equal(klici.length, 0);
    await writeFile(path.join(dir, DATOTEKA_SLIK), "{pokvarjeno");
    assert.deepEqual(await knjiznicaSlik(token, dir), { slike: [] });
  });
});
