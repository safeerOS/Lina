/**
 * Naloga G4i. Navodilo sloga v zahtevi za glas (slovenski, ne hrvaski naglas; lastnik 11. 11. 2026).
 * Nikjer pravega omrezja: sinteza je lazni izvajalec ali vbrizgan fetch. Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { besediloZaSintezo, GLAS_IME, GLAS_MODEL, kljucZvoka, NAVODILO_SLOGA, semeZaBesedilo, stalniStavki, teloGlasu } from "./glas.ts";
import { OBDELAVA_ZVOKA } from "./glas-izenacenje.ts";
import { mapaZvoka, nastaviSintezoZaPreizkus, pocakajGlas, pripraviStalne, sintetizirajVertex, solZvoka } from "./glas.server.ts";
import { t } from "./besedila.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-g4i-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
let stevec = 0;
function scratch(): string {
  stevec += 1;
  return mkdtempSync(path.join(KOREN, `d${stevec}-`));
}

afterEach(() => nastaviSintezoZaPreizkus(null));

type Telo = { contents: Array<{ parts: Array<{ text: string }> }>; generationConfig: { speechConfig: { languageCode: string } } };

describe("naloga G4i: navodilo sloga v zahtevi za glas", () => {
  it("A1 teloGlasu: en del besedila, najprej navodilo, za dvopicjem stavek; jezik sl-SI ostane", () => {
    const telo = teloGlasu("  Ali potrjujete   naročilo? ") as Telo;
    assert.equal(telo.contents[0].parts.length, 1);
    assert.equal(telo.contents[0].parts[0].text, `${NAVODILO_SLOGA}: Ali potrjujete naročilo?`);
    assert.equal(telo.generationConfig.speechConfig.languageCode, "sl-SI");
  });

  it("A2 navodilo zahteva knjizno slovenscino, slovenski naglas (ne hrvaski, ne srbski), l in v, polglasnik, naraven tempo, brez dramatizacije", () => {
    const n = NAVODILO_SLOGA.toLowerCase();
    for (const kos of ["slovenian", "not croatian or serbian", "l ", "v ", "schwa", "natural pace", "without dramatization"]) {
      assert.ok(n.includes(kos), kos);
    }
    // En stavek brez oklepajev: manj moznosti, da bi ga model prebral kot besedilo.
    assert.ok(!/[\[\]{}<>]/.test(NAVODILO_SLOGA));
    assert.ok(NAVODILO_SLOGA.length < 400);
  });

  it("A3 besediloZaSintezo: prazno navodilo da golo besedilo, drugo navodilo drugo zahtevo", () => {
    assert.equal(besediloZaSintezo("Hvala.", ""), "Hvala.");
    assert.equal(besediloZaSintezo("Hvala.", "Say warmly"), "Say warmly: Hvala.");
  });

  it("B1 kljuc posnetka vsebuje navodilo: drugo navodilo = drug kljuc, kljuc iz prejsnje razlicice ni veljaven", () => {
    const sol = randomBytes(32);
    const kljuc = kljucZvoka(sol, "Hvala za klic.");
    // G4l/G4m sta v kljuc dodala obdelavo in seme (glas.ts kljucZvoka); navodilo ostane del kljuca.
    const pricakovan = createHmac("sha256", sol).update(`${GLAS_MODEL}|${GLAS_IME}|${NAVODILO_SLOGA}|${OBDELAVA_ZVOKA}|${semeZaBesedilo("Hvala za klic.")}|Hvala za klic.`).digest("hex").slice(0, 32);
    assert.equal(kljuc, pricakovan);
    assert.notEqual(kljuc, kljucZvoka(sol, "Hvala za klic.", undefined, undefined, "", `${NAVODILO_SLOGA} slightly`));
    const stari = createHmac("sha256", sol).update(`${GLAS_MODEL}|${GLAS_IME}|Hvala za klic.`).digest("hex").slice(0, 32);
    assert.notEqual(kljuc, stari);
  });

  it("C1 prava pot sintetizirajVertex res poslje navodilo (vbrizgan fetch)", async () => {
    let poslano = "";
    const pcm = Buffer.alloc(4800);
    const odgovor = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;rate=24000", data: pcm.toString("base64") } }] } }] })}\n\n`;
    const lazniFetch = (async (_naslov: unknown, init?: RequestInit) => {
      poslano = String(init?.body);
      return new Response(odgovor, { status: 200 });
    }) as typeof fetch;
    await sintetizirajVertex("Hvala za klic.", "projekt-preizkus", { fetch: lazniFetch, zeton: async () => "zeton" });
    const telo = JSON.parse(poslano) as Telo;
    assert.equal(telo.contents[0].parts[0].text, `${NAVODILO_SLOGA}: Hvala za klic.`);
  });

  it("D1 stalni posnetek iz prejsnje razlicice (brez navodila) se ob pripravi sintetizira ZNOVA, nov ostane in se ne ponovi", async () => {
    const dir = scratch();
    const sol = await solZvoka(dir);
    const stavek = "Hvala za klic.";
    // Star posnetek: kljuc po obliki pred G4i (model|glas|besedilo), datoteka v mapi zvoka.
    const stari = createHmac("sha256", sol).update(`${GLAS_MODEL}|${GLAS_IME}|${stavek}`).digest("hex").slice(0, 32);
    await mkdir(mapaZvoka(dir), { recursive: true });
    await writeFile(path.join(mapaZvoka(dir), `${stari}.wav`), Buffer.alloc(100));
    const klici: string[] = [];
    nastaviSintezoZaPreizkus(async (besedilo) => {
      klici.push(besedilo);
      return Buffer.alloc(4800);
    });
    await pripraviStalne(dir, [stavek]);
    await pocakajGlas(dir);
    assert.deepEqual(klici, [stavek], "stari posnetek ne sme veljati za nov kljuc");
    const nov = kljucZvoka(sol, stavek);
    assert.notEqual(nov, stari);
    assert.ok((await readdir(mapaZvoka(dir))).includes(`${nov}.wav`));
    await pripraviStalne(dir, [stavek]);
    await pocakajGlas(dir);
    assert.equal(klici.length, 1);
  });

  it("D2 vsi stalni stavki poteka klica imajo kljuc z navodilom", () => {
    const sol = randomBytes(32);
    const stavki = stalniStavki({ pozdrav: "Pozdravljeni, tukaj Lina." }, "Primer d.o.o.");
    assert.ok(stavki.length > 10);
    assert.ok(stavki.includes(t("lepDan")));
    for (const s of stavki) assert.notEqual(kljucZvoka(sol, s), kljucZvoka(sol, s, undefined, undefined, "", ""), s);
  });
});
