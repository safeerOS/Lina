/**
 * Naloga 9, V6: novo nalogo orkestratorja sme ustvariti samo lastnik. Z geslom: seja z geslom (enako kot »dovoli«). Brez gesla
 * lokalno sejo dobi vsak proces na istem racunalniku (Host/Origin lahko ponaredi), zato nalogo ustvari samo Linin lasten
 * vmesnik: okno lupine, ki zahtevam do lokalnega streznika doda zeton lupine (x-lina-lupina, LINA_LUPINA_ZETON).
 * Lupina na pravem namizju tu NI zagnana: preverjena sta pomocnik glav (pravi modul) in priklop v main.js (besedilo).
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { odpriLokalnoSejo, setupOwner } from "./auth.server.ts";
import { OrkestratorNapaka, ukazOrkestratorja } from "./orkestrator.server.ts";

const mapa = () => mkdtemp(path.join(tmpdir(), "lina-n9-v6-"));
const zahtevaj = createRequire(import.meta.url);
const ZETON = "a".repeat(48);
const lokalna = { address: "127.0.0.1", host: "127.0.0.1:8446", origin: "http://127.0.0.1:8446", fetchSite: "same-origin" };

describe("V6: nova naloga orkestratorja", () => {
  it("brez gesla: lokalna seja (vsak lokalni proces s pravim Host/Origin) NE ustvari naloge", async () => {
    const root = await mapa();
    const token = await odpriLokalnoSejo(lokalna, root);
    assert.ok(token, "predpogoj: lokalna seja brez gesla obstaja");
    await assert.rejects(
      ukazOrkestratorja(token, { vrsta: "nova", cilj: "Izbrisi vse datoteke v Dokumentih." }, root),
      (e: unknown) => e instanceof OrkestratorNapaka && e.koda === "geslo",
    );
  });

  it("brez gesla: lokalni proces tudi ne odgovori namesto lastnika (besedilo gre v nalogo neovito) in ne brise", async () => {
    const root = await mapa();
    const token = await odpriLokalnoSejo(lokalna, root);
    for (const ukaz of [{ vrsta: "odgovor", id: "o-0123456789abcdef", besedilo: "Da, izbrisi vse." }, { vrsta: "izbrisi", id: "o-0123456789abcdef" }]) {
      await assert.rejects(ukazOrkestratorja(token, ukaz, root), (e: unknown) => e instanceof OrkestratorNapaka && e.koda === "geslo", ukaz.vrsta);
      // iz okna lupine gre ukaz naprej (tu do »ni naloge«)
      await assert.rejects(ukazOrkestratorja(token, ukaz, root, true), (e: unknown) => e instanceof OrkestratorNapaka && e.koda !== "geslo", ukaz.vrsta);
    }
  });

  it("brez gesla: zahteva iz okna lupine (veljaven zeton lupine) ustvari nalogo", async () => {
    const root = await mapa();
    const token = await odpriLokalnoSejo(lokalna, root);
    const st = await ukazOrkestratorja(token, { vrsta: "nova", cilj: "Povzemi zadnja narocila." }, root, true);
    assert.equal(st.naloge.length, 1);
  });

  it("z geslom: seja z geslom ustvari nalogo tudi brez zetona lupine (enako kot dovoli)", async () => {
    const root = await mapa();
    const token = await setupOwner("geslo-test-1234", root);
    const st = await ukazOrkestratorja(token, { vrsta: "nova", cilj: "Povzemi zadnja narocila." }, root);
    assert.equal(st.naloge.length, 1);
  });

  it("streznik: ukazOrkestratorjaFn poda izLupine samo iz veljavnega zetona v glavi x-lina-lupina", async () => {
    const f = await readFile(path.join(import.meta.dirname, "functions.ts"), "utf8");
    const i = f.indexOf("export const ukazOrkestratorjaFn");
    const telo = f.slice(i, f.indexOf("export const", i + 10));
    assert.match(telo, /ukazOrkestratorja\(await sessionToken\(\), data\?\.ukaz, undefined, veljavenZetonLupine\(getRequest\(\)\.headers\.get\(GLAVA_LUPINE\), zetonLupine\(\)\)\)/);
  });
});

describe("V6: lupina doda zeton samo zahtevam na lokalni streznik Line", () => {
  const { glaveZaStreznik } = zahtevaj("../../../lupina/pomocniki.js") as {
    glaveZaStreznik: (url: string, naslov: string, zeton: string, glave: Record<string, string>) => Record<string, string>;
  };

  it("streznik Line dobi glavo; tuj izvor, podobna predpona in prazen zeton ne", () => {
    const naslov = "http://127.0.0.1:41234";
    assert.equal(glaveZaStreznik(`${naslov}/_serverFn/x`, naslov, ZETON, { a: "1" })["x-lina-lupina"], ZETON);
    assert.equal(glaveZaStreznik(`${naslov}/`, naslov, ZETON, {})["x-lina-lupina"], ZETON);
    assert.equal(glaveZaStreznik("https://fonts.googleapis.com/css", naslov, ZETON, {})["x-lina-lupina"], undefined);
    assert.equal(glaveZaStreznik("http://127.0.0.1:412345/", naslov, ZETON, {})["x-lina-lupina"], undefined);
    assert.equal(glaveZaStreznik("http://127.0.0.1:41234.zlo.si/", naslov, ZETON, {})["x-lina-lupina"], undefined);
    assert.equal(glaveZaStreznik(`${naslov}/`, "", ZETON, {})["x-lina-lupina"], undefined);
    assert.equal(glaveZaStreznik(`${naslov}/`, naslov, "", {})["x-lina-lupina"], undefined);
    // tuja glava z istim imenom (npr. iz strani) se ne prenese naprej na tuj izvor
    assert.equal(glaveZaStreznik("https://zlo.si/", naslov, ZETON, { "x-lina-lupina": "x" })["x-lina-lupina"], undefined);
  });

  it("main.js: isti zeton gre strezniku (LINA_LUPINA_ZETON) in v glave okna prek glaveZaStreznik", async () => {
    const m = await readFile(path.join(import.meta.dirname, "../../../lupina/main.js"), "utf8");
    assert.match(m, /LINA_LUPINA_ZETON: zetonLupine/);
    assert.match(m, /webRequest\.onBeforeSendHeaders\(/);
    assert.match(m, /glaveZaStreznik\(podrobnosti\.url, naslov, zetonLupine, podrobnosti\.requestHeaders\)/);
  });
});
