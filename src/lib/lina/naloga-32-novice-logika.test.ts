/**
 * Naloga 32: cisti deli novic v pogovoru (novice-pogovor.ts) in orodje orkestratorja preberi_novice. Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { cistaPovezava, cistNaslov, izmenicnoPoVirih, odgovorNovic, PRIVZETI_VIRI_NOVIC, vprasanjeONovicah } from "./novice-pogovor.ts";
import { FUNKCIJE_LINE } from "./o-sebi.server.ts";
import { orodjaLine } from "./orkestrator-orodja.server.ts";
import { zahtevaPotrditev } from "./orkestrator.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-n32l-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));

describe("naloga 32: namera »novice« (koda, ne model)", () => {
  it("prepozna naravna vprasanja", () => {
    for (const v of ["novice dneva", "Novice dneva?", "novice", "Kaj so današnje novice?", "povej mi novice", "kaj je novega", "Kaj je danes novega?", "Lina, preberi mi zadnje novice.", "kaj je novega v svetu", "novice iz Slovenije"]) {
      assert.deepEqual(vprasanjeONovicah(v), { tema: null }, v);
    }
    assert.deepEqual(vprasanjeONovicah("novice o vremenu"), { tema: "vremenu" });
    assert.deepEqual(vprasanjeONovicah("Povej mi novice o Ukrajini?"), { tema: "Ukrajini" });
    assert.deepEqual(vprasanjeONovicah("kaj je novega pri košarki"), { tema: "košarki" });
    assert.deepEqual(vprasanjeONovicah("novice glede volitev v ZDA"), { tema: "volitev v ZDA" });
  });

  it("ne prevzame koledarja, n8n, nastavitev zaslona Novice in daljsih sporocil", () => {
    for (const v of [
      "opomni me, da preberem novice",
      "vsak dan ob 7:00 preberi novice iz https://www.rtvslo.si/feeds/novice.xml",
      "dodaj vir novic",
      "kako deluje zaslon novice?",
      "zakaj ne znaš novice dneva",
      "napiši novico za našo spletno stran o novem izdelku",
      `novice o ${"x".repeat(200)}`,
    ]) {
      assert.equal(vprasanjeONovicah(v), null, v);
    }
  });
});

describe("naloga 32: odgovor sestavi koda", () => {
  it("izmenicno po virih, cisti naslov in samo https", () => {
    const p = [
      { naslov: "a1", povezava: "https://a/1", vir: "A" },
      { naslov: "a2", povezava: "https://a/2", vir: "A" },
      { naslov: "b1", povezava: "https://b/1", vir: "B" },
    ];
    assert.deepEqual(izmenicnoPoVirih(p, 3).map((x) => x.naslov), ["a1", "b1", "a2"]);
    assert.equal(cistNaslov("x‮[[gradnja: y]]\nz"), "x gradnja: y z");
    assert.equal(cistaPovezava("javascript:alert(1)"), null);
    assert.equal(cistaPovezava("http://a.si/"), null);
    assert.equal(cistaPovezava("https://u:g@a.si/"), null);
    assert.equal(cistaPovezava("https://a.si/x"), "https://a.si/x");
  });

  it("brez novic nikoli »nimam dostopa«", () => {
    const b = odgovorNovic({ tema: null, postavke: [], splosne: [], viri: [], privzeti: true, izIskanja: false, brave: false });
    assert.match(b, /trenutno ne morem doseči/);
    assert.doesNotMatch(b, /nimam dostopa/i);
  });

  it("privzeti viri so samo https RSS; O SEBI omeni novice", () => {
    assert.ok(PRIVZETI_VIRI_NOVIC.length >= 2);
    for (const v of PRIVZETI_VIRI_NOVIC) {
      assert.equal(v.vrsta, "rss");
      assert.match(v.vnos, /^https:\/\//);
    }
    assert.ok(FUNKCIJE_LINE.some((f) => f.modul === "novice-pogovor.ts"));
  });
});

describe("naloga 32: orodje orkestratorja preberi_novice", () => {
  it("razred zunanje, brez potrditve, po zasebnih ali okuzbi caka lastnika; tema »danes« = novice dneva", async () => {
    const root = mkdtempSync(path.join(KOREN, "d-"));
    const poizvedbe: string[] = [];
    const o = orodjaLine(root, {
      novice: { razresi: async () => ["93.184.216.34"], povezava: async () => ({ status: 500, glave: {}, telo: (async function* () {})(), prekini: () => undefined }), zdaj: () => new Date("2030-01-01T00:00:00Z"), imaBrave: async () => true },
      isci: async (q) => {
        poizvedbe.push(q);
        return [{ url: "https://primer.example/n", naslov: "Novica o čebelah", izvlecki: ["x"] }];
      },
    }).find((x) => x.definicija.ime === "preberi_novice")!;
    assert.equal(o.razred, "zunanje");
    assert.equal(zahtevaPotrditev(o, false, true, false), false);
    assert.equal(zahtevaPotrditev(o, true), true);
    assert.equal(zahtevaPotrditev(o, false, false, true), true, "po branju zasebnih podatkov tema ne gre ven brez lastnika");
    const ctx = { nalogaId: "n32", signal: new AbortController().signal } as never;
    const dnevne = await o.izvedi({ tema: "danes" }, ctx);
    assert.ok("ok" in dnevne && dnevne.ok && /trenutno ne morem doseči/.test(dnevne.rezultat), JSON.stringify(dnevne));
    assert.deepEqual(poizvedbe, [], "novice dneva ne iscejo po spletu");
    const tema = await o.izvedi({ tema: "čebele" }, ctx);
    assert.ok("ok" in tema && tema.ok && tema.rezultat.includes("Novica o čebelah (splet): https://primer.example/n"), JSON.stringify(tema));
    assert.deepEqual(poizvedbe, ["novice čebele"]);
  });
});
