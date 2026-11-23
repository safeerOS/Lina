/**
 * Naloga G3b. Meritev vodje s pravim Googlom (10. 11. 2026): po zagonu z odprto linijo se stalni stavki niso
 * pripravili, zato je pozdrav prvega klica sel v glas posrednika. Priprava glasu ob zagonu, stevilo stalnih stavkov
 * in zakljucek klica samo iz stalnih stavkov. Brez pravega omrezja; komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { t } from "./besedila.ts";
import { formaCatalog } from "./catalog.ts";
import { razdeliZaGlas, stalniStavki } from "./glas.ts";
import {
  mapaZvoka,
  nastaviSintezoZaPreizkus,
  pocakajDnevnikGlasu,
  pocakajGlas,
  ponastaviOdklopnik,
  stanjeGlasu,
  ustaviCiscenjeZvoka,
} from "./glas.server.ts";
import { defaultPravila } from "./pravila.server.ts";
import { loadLine, pripraviGlasObZagonu, recordCaller } from "./service.server.ts";
import { writeJson } from "./store.server.ts";
import { handleVoiceRequest, pocakajOzadjeKlicev, ustaviCiscenjeOpravil } from "./voice.server.ts";
import { GLAVA_ZAGONA, handleZagonRequest, novZetonZagona, POT_ZAGONA } from "./zagon.server.ts";

process.env.LINA_LLM = "0";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-g3b-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const temps: string[] = [];
const zapore: Array<() => void> = [];

afterEach(async () => {
  for (const spusti of zapore.splice(0)) spusti();
  await pocakajOzadjeKlicev();
  delete process.env.TWILIO_AUTH_TOKEN;
  nastaviSintezoZaPreizkus(null);
  ponastaviOdklopnik();
  ustaviCiscenjeOpravil();
  while (temps.length) {
    const dir = temps.pop();
    if (!dir) continue;
    await pocakajGlas(dir);
    await pocakajDnevnikGlasu(dir);
    ustaviCiscenjeZvoka(dir);
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

/** Mapa podatkov, kot jo najde program po zagonu: linija je zapisana na disku, v pomnilniku ni nicesar. */
async function poZagonu(linija: { open: boolean; caka?: boolean }, pravila: Record<string, unknown> = {}): Promise<string> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  temps.push(dir);
  await writeJson(dir, "line.json", { ...linija, catalog: formaCatalog(), updatedAt: null });
  await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi", ...pravila });
  return dir;
}

function lazniGlas(visi = false) {
  const stanje = { klici: [] as string[], spusti: () => undefined as void };
  const zapora = new Promise<void>((resolve) => {
    stanje.spusti = resolve;
  });
  zapore.push(() => stanje.spusti());
  nastaviSintezoZaPreizkus(async (besedilo) => {
    stanje.klici.push(besedilo);
    if (visi) await zapora;
    return Buffer.alloc(4800);
  });
  return stanje;
}

const IZVOR = "https://lina.primer";
const SKRIVNOST = "twilio-zeton-preizkusa";

async function klic(dir: string, pot: string, params: Record<string, string>): Promise<string> {
  process.env.TWILIO_AUTH_TOKEN = SKRIVNOST;
  const signed = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], `${IZVOR}${pot}`);
  const podpis = createHmac("sha1", SKRIVNOST).update(signed).digest("base64");
  const odgovor = await handleVoiceRequest(
    new Request(`${IZVOR}${pot}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": podpis },
      body: new URLSearchParams(params).toString(),
    }),
    dir,
  );
  assert.equal(odgovor.status, 200);
  return odgovor.text();
}

function predvajani(twiml: string): string[] {
  return [...twiml.matchAll(/<Play>([^<]+)<\/Play>/g)].map((m) => m[1]);
}

describe("naloga G3b: priprava glasu ob zagonu", { concurrency: 1 }, () => {
  it("zagon z odprto linijo pripravi vse stalne stavke brez prve zahteve; prvi klic ima pozdrav v Lininem glasu", async () => {
    const dir = await poZagonu({ open: true });
    const glas = lazniGlas();
    assert.equal(await pripraviGlasObZagonu(dir), "odprta");
    await pocakajGlas(dir);
    // Zagon pripravi stalne stavke S katalogom (G4a): 42 osnovnih + 23 iz kataloga = 65 (z naslovom za potrditev po
    // e-posti 44 + 23 = 67). Staro stevilo 25/26 je veljalo pred G4a in pred stavki za omejitev casa, nujno in razkritje UI.
    const stavki = stalniStavki(defaultPravila(), "FORMA", formaCatalog());
    assert.equal(stavki.length, 65);
    assert.equal(stalniStavki(defaultPravila(), "FORMA").length, 42);
    assert.deepEqual([...glas.klici].sort(), [...stavki].sort());
    assert.deepEqual(stanjeGlasu(dir), { pripravljen: true, vTeku: false, razlog: "", pripravljenih: 65, vseh: 65 });
    const imena = await readdir(mapaZvoka(dir));
    assert.equal(imena.filter((ime) => ime.endsWith(".wav")).length, 65);
    assert.equal(imena.filter((ime) => ime.endsWith(".stalno")).length, 65);
    // Prvi klic po zagonu: pozdrav so trije posnetki, brez rezerve in brez nove sinteze.
    const pozdrav = await klic(dir, "/api/voice/incoming", { CallSid: "CA-G3B-1", From: "+38640000000" });
    assert.doesNotMatch(pozdrav, /<Say|Trenutek/);
    // Pozdrav je ENA sinteza (lastnik, 14. 11. 2026; glej stalniStavki v glas.ts): en posnetek, ne trije.
    assert.equal(predvajani(pozdrav).length, 1);
    assert.equal(glas.klici.length, 65);
    await assert.rejects(readFile(path.join(dir, "glas-dnevnik.json"), "utf8"));
  });

  it("prvi klic med pripravo ne pozene druge priprave: vsak stavek se sintetizira enkrat", async () => {
    const dir = await poZagonu({ open: true });
    const glas = lazniGlas(true);
    assert.equal(await pripraviGlasObZagonu(dir), "odprta");
    assert.equal(stanjeGlasu(dir).vTeku, true);
    // Klic pride, ko priprava se visi: pozdrav gre v rezervo (razkritje UI je prvi stavek), druge priprave ni.
    const pozdrav = await klic(dir, "/api/voice/incoming", { CallSid: "CA-G3B-2", From: "+38640000000" });
    assert.match(pozdrav, /<Say language="sl-SI">Dober dan, tukaj Lina, pomočnica z umetno inteligenco/);
    assert.equal(await pripraviGlasObZagonu(dir), "odprta");
    glas.spusti();
    await pocakajOzadjeKlicev();
    await pocakajGlas(dir);
    assert.equal(glas.klici.length, new Set(glas.klici).size, "isti stavek sintetiziran dvakrat");
    assert.equal(new Set(glas.klici).size, 65);
    assert.equal(stanjeGlasu(dir).pripravljen, true);
  });

  it("linija, ki caka na glas, se po pripravi ob zagonu odpre; zaprta linija sinteze ne trosi", async () => {
    const caka = await poZagonu({ open: false, caka: true });
    const glas = lazniGlas();
    assert.equal(await pripraviGlasObZagonu(caka), "caka");
    await pocakajGlas(caka);
    assert.equal((await loadLine(caka)).open, true);
    assert.equal(glas.klici.length, 65);

    const zaprta = await poZagonu({ open: false });
    assert.equal(await pripraviGlasObZagonu(zaprta), "zaprta");
    await pocakajGlas(zaprta);
    assert.equal(glas.klici.length, 65);
    await assert.rejects(readdir(mapaZvoka(zaprta)));
  });

  it("zagon ne pade: brez prijave Google Cloud, s pokvarjeno datoteko linije ali brez mape podatkov", async () => {
    // Brez laznega glasu in brez prijave: razlog ostane v stanju, funkcija se vrne.
    const brez = await poZagonu({ open: true });
    assert.equal(await pripraviGlasObZagonu(brez), "odprta");
    await pocakajGlas(brez);
    assert.equal(stanjeGlasu(brez).razlog, "glasNiVertex");
    const pokvarjena = await poZagonu({ open: true });
    await writeFile(path.join(pokvarjena, "line.json"), "{ to ni json");
    assert.equal(await pripraviGlasObZagonu(pokvarjena), "napaka");
    assert.equal(await pripraviGlasObZagonu(path.join(KOREN, "ni-te-mape")), "zaprta");
  });

  it("notranja zahteva zagona: samo POST z enkratnim zetonom iz pomnilnika; vse drugo je 403 in ne pripravi nicesar", async () => {
    const dir = await poZagonu({ open: true });
    const glas = lazniGlas();
    const zahteva = (zeton: string | null, metoda = "POST") =>
      handleZagonRequest(new Request(`http://127.0.0.1${POT_ZAGONA}`, { method: metoda, headers: zeton === null ? {} : { [GLAVA_ZAGONA]: zeton } }), dir);
    // Brez izdanega zetona ni veljavne zahteve.
    assert.equal((await zahteva("")).status, 403);
    const zeton = novZetonZagona();
    assert.match(zeton, /^[0-9a-f]{64}$/);
    for (const slab of [null, "", "a".repeat(64), zeton.slice(0, 63), `${zeton}0`, zeton.toUpperCase() === zeton ? "x" : zeton.toUpperCase()]) {
      assert.equal((await zahteva(slab)).status, 403, String(slab));
    }
    assert.equal((await zahteva(zeton, "GET")).status, 403);
    assert.equal(glas.klici.length, 0);
    const dobra = await zahteva(zeton);
    assert.equal(dobra.status, 200);
    assert.equal(await dobra.text(), "odprta");
    await pocakajGlas(dir);
    assert.equal(glas.klici.length, 65);
    // Zeton je enkraten.
    assert.equal((await zahteva(zeton)).status, 403);
  });

  it("vticnik streznika je naveden v gradnji in uporablja ista imena kot notranja zahteva", async () => {
    const koren = path.resolve(import.meta.dirname, "..", "..", "..");
    const vticnik = await readFile(path.join(koren, "server", "plugins", "lina-zagon.ts"), "utf8");
    assert.ok(vticnik.includes('Symbol.for("lina.zagon.zeton")'));
    assert.ok(vticnik.includes(`"${GLAVA_ZAGONA}"`));
    assert.ok(vticnik.includes(`http://127.0.0.1${POT_ZAGONA}"`));
    // Vticnik ne uvozi kode Line: imel bi svojo kopijo stanja in prvi klic bi pognal drugo pripravo.
    assert.doesNotMatch(vticnik, /^import .*lib\/lina/m);
    // 23. 11. 2026: drugi vticnik lina-izhod.ts (konec procesa po SIGTERM, ker srvx zapre samo glavni streznik HTTP).
    const gradnja = await readFile(path.join(koren, "vite.config.ts"), "utf8");
    assert.match(gradnja, /plugins: \["\.\/server\/plugins\/lina-zagon\.ts", "\.\/server\/plugins\/lina-izhod\.ts"\]/);
    const izhod = await readFile(path.join(koren, "server", "plugins", "lina-izhod.ts"), "utf8");
    assert.doesNotMatch(izhod, /^import .*lib\/lina/m);
    assert.match(izhod, /"SIGTERM", "SIGINT", "SIGHUP"/);
    assert.match(izhod, /process\.exit\(0\)/);
    assert.match(await readFile(path.join(koren, "src", "routes", "api", "zagon.ts"), "utf8"), /createFileRoute\("\/api\/zagon"\)/);
  });
});

describe("naloga G3b: zakljucek klica je samo iz stalnih stavkov", { concurrency: 1 }, () => {
  it("vse oblike zakljucka se razrezejo na stalne stavke; zadnji obrat nima vmesnega stavka in nove sinteze", async () => {
    const naslov = { potrditevEposta: true, potrditevNaslov: "ponudbe@primer-podjetje.si" };
    const dir = await poZagonu({ open: true }, naslov);
    const glas = lazniGlas();
    await pripraviGlasObZagonu(dir);
    await pocakajGlas(dir);
    const stalni = stalniStavki({ ...defaultPravila(), ...naslov }, "FORMA", formaCatalog());
    assert.equal(stalni.length, 67);
    assert.equal(glas.klici.length, 67);
    // Tok danes (izmerjeno 21. 11. 2026): izdelek -> kolicina -> rok -> povzetek in vprasanje »Ali potrjujete naročilo?« -> »da« zakljuci klic.
    // Oblike roka so zato predzadnji odgovor, zakljucek sledi potrditvi.
    for (const [sid, rok] of [
      ["CA-G3B-Z1", "Jutri popoldne."],
      ["CA-G3B-Z2", "Ne vem."],
      ["CA-G3B-Z3", "Kadarkoli."],
    ] as const) {
      const obrat = (text: string) => recordCaller({ callSid: sid, from: "+38640000000", text }, dir);
      await obrat("");
      await obrat("Ana Primer.");
      await obrat("Mizo Alba iz hrasta.");
      for (const odgovor of ["Dva kosa.", rok]) await obrat(odgovor);
      const konec = await obrat("Da.");
      assert.equal(konec.call.status, "zakljucen", sid);
      assert.doesNotMatch(konec.reply, /zapisala sem/i);
      const kosi = razdeliZaGlas(konec.reply, stalni);
      assert.ok(kosi.length >= 3, konec.reply);
      for (const kos of kosi) assert.ok(stalni.includes(kos), `ni stalni stavek: ${kos}`);
    }
    // Po telefonu: zadnji obrat so sami pripravljeni posnetki.
    const sid = "CA-G3B-TEL";
    const od = "+38640000000";
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: od });
    const stavki = ["Ana Primer.", "Mizo Alba iz hrasta.", "Dva kosa.", "Do petka."];
    for (const [i, stavek] of stavki.entries()) await klic(dir, `/api/voice/turn?obr=${i + 1}`, { CallSid: sid, From: od, SpeechResult: stavek });
    await pocakajOzadjeKlicev();
    const sintez = glas.klici.length;
    const slovo = await klic(dir, `/api/voice/turn?obr=${stavki.length + 1}`, { CallSid: sid, From: od, SpeechResult: "Da." });
    assert.doesNotMatch(slovo, /<Say|cak=/);
    // Zakljucek zbiranja so STIRJE posnetki: prosnja za e-posto, »Ce bomo potrebovali dodatne informacije ...«, »Hvala za klic.«,
    // »Lep dan.« (zakljucekZbiranja v service.server.ts; slovo in lepDan ostaneta loceni, povzetek.test.ts zahteva 2 posnetka za slovo).
    // Staro stevilo 3 je veljalo, preden je zakljucek dobil stavek o povratnem klicu.
    assert.equal(predvajani(slovo).length, 4);
    assert.match(slovo, /<Hangup\/>/);
    assert.equal(glas.klici.length, sintez);
    assert.equal(t("slovo"), "Hvala za klic.");
  });
});
