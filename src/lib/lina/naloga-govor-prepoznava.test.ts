/**
 * Prepoznava govora (14. 11. 2026): model in namigi v Gather, zaupanje v zapisu klica, ponovitev sporocila ob slabi prepoznavi
 * v osebnem nacinu, skrajsanje tisine na robovih posnetka. Imena so izmisljena.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { obreziTisinoNaRobovih8k } from "./glas-izenacenje.ts";
import { atributiGovora, NAJVEC_HINTOV, normirajHints } from "./govor-model.ts";
import { nastaviSintezoZaPreizkus, pocakajDnevnikGlasu, pocakajGlas, pripraviZvok, preberiWavPosnetka, ustaviCiscenjeZvoka } from "./glas.server.ts";
import { defaultPravila, normalizePravila } from "./pravila.server.ts";
import type { ModelRazumevanja } from "./razumevanje.server.ts";
import { preberiKlic, recordCaller } from "./service.server.ts";
import { writeJson } from "./store.server.ts";
import type { Catalog } from "./types.ts";
import { handleVoiceRequest } from "./voice.server.ts";

process.env.LINA_LLM = "0";
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-govor-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const dirs: string[] = [];
afterEach(async () => {
  nastaviSintezoZaPreizkus(null);
  delete process.env.TWILIO_AUTH_TOKEN;
  while (dirs.length) {
    const dir = dirs.pop() as string;
    await pocakajGlas(dir);
    await pocakajDnevnikGlasu(dir);
    ustaviCiscenjeZvoka(dir);
  }
});

const katalog: Catalog = { company: { name: "Primer", trade: "", phone: "", address: "", hours: "", about: "" }, materials: [], products: [], zapiski: [] };
const nikoliModel: ModelRazumevanja = async () => '{"namen":"drugo","material":"","odgovor":""}';

async function nov(pravila: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  dirs.push(dir);
  await writeJson(dir, "line.json", { open: true, catalog: katalog, updatedAt: null });
  await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi", ...pravila });
  return dir;
}

async function klic(dir: string, pot: string, params: Record<string, string>): Promise<string> {
  process.env.TWILIO_AUTH_TOKEN = "zeton-preizkusa";
  const url = `https://lina.primer${pot}`;
  const podpis = createHmac("sha1", "zeton-preizkusa").update(Object.keys(params).sort().reduce((a, k) => a + k + params[k], url)).digest("base64");
  const r = await handleVoiceRequest(
    new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": podpis }, body: new URLSearchParams(params).toString() }),
    dir,
    undefined,
    { model: async () => "x", razumevanje: nikoliModel } as never,
  );
  return r.text();
}

describe("model prepoznave govora v Gather", () => {
  it("privzeto brez atributa; veljaven model in namigi gredo v Gather; neveljavna vrednost je prazna", async () => {
    const brez = await klic(await nov({}), "/api/voice/incoming", { CallSid: "CA-GM-1", From: "+38640000000" });
    assert.doesNotMatch(brez, /speechModel|hints=/);
    const z = await klic(await nov({ govorModel: "googlev2_chirp_3", hintsGovor: "Ana, Safeer" }), "/api/voice/incoming", { CallSid: "CA-GM-2", From: "+38640000000" });
    assert.match(z, /<Gather input="speech" speechModel="googlev2_chirp_3" hints="Ana, Safeer" language="sl-SI" speechTimeout="\d+"/);
    const napacen = await klic(await nov({ govorModel: "nekaj-drugega", hintsGovor: "Ana" }), "/api/voice/incoming", { CallSid: "CA-GM-3", From: "+38640000000" });
    assert.doesNotMatch(napacen, /speechModel|hints=/);
  });

  it("izrazi kataloga gredo v hints na poti klica (oba nacina); izrazeKatalogaIzklop jih izklopi", async () => {
    const zKatalogom = async (pravila: Record<string, unknown>) => {
      const dir = await nov(pravila);
      const k: Catalog = { ...katalog, products: [{ id: "p1", name: "Tampotisk", kind: "", summary: "", materialIds: [] }], materials: [{ id: "m1", name: "Folija", note: "" }] };
      await writeJson(dir, "line.json", { open: true, catalog: k, updatedAt: null });
      return dir;
    };
    for (const nacinKlica of ["podjetje", "osebna"]) {
      const z = await klic(await zKatalogom({ nacinKlica, govorModel: "googlev2_telephony", hintsGovor: "Ana" }), "/api/voice/incoming", { CallSid: `CA-GM-K-${nacinKlica}`, From: "+38640000000" });
      assert.match(z, /hints="Ana, Tampotisk, Folija"/, nacinKlica);
    }
    const izkl = await klic(await zKatalogom({ govorModel: "googlev2_telephony", hintsGovor: "Ana", izrazeKatalogaIzklop: true }), "/api/voice/incoming", { CallSid: "CA-GM-K-izkl", From: "+38640000000" });
    assert.match(izkl, /hints="Ana"/);
  });

  it("normalizacija: neznan model je prazen, namigi samo ob modelu, meje 500 x 100 znakov, brez znakov XML", () => {
    assert.equal(normalizePravila({ govorModel: "xyz" as never }).govorModel, "");
    assert.equal(normalizePravila({ hintsGovor: "a, b" }).hintsGovor, "", "namigi brez modela se zavrzejo");
    assert.equal(normalizePravila({ govorModel: "deepgram_nova-3", hintsGovor: "a, b" }).hintsGovor, "a, b");
    const veliko = Array.from({ length: 600 }, (_, i) => `beseda${i}`).join(",");
    assert.equal(normirajHints(veliko).split(", ").length, NAJVEC_HINTOV);
    assert.ok(normirajHints("x".repeat(250)).length === 100);
    assert.doesNotMatch(normirajHints('a"b<c>&d'), /["<>&]/);
    assert.equal(atributiGovora({ govorModel: "", hintsGovor: "a" }), "");
  });
});

describe("zaupanje prepoznave v zapisu klica", () => {
  it("Twilio Confidence in stevilo znakov gresta v vnos stranke; brez Confidence samo znakov", async () => {
    const dir = await nov({});
    const sid = "CA-ZAUPANJE";
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: "+38640000000" });
    const turn = await klic(dir, "/api/voice/turn?obr=1", { CallSid: sid, From: "+38640000000", SpeechResult: "Jan Primer", Confidence: "0.42" });
    // Govor je znotraj Gather tudi na /turn (barge-in; po dokumentaciji Twilio ni izrecno potrjen za speech).
    assert.match(turn, /<Gather [^>]*>\s*<(Play|Say)[ >]/);
    const zapis = await preberiKlic(sid, dir);
    const stranka = zapis?.transcript.filter((v) => v.role === "stranka") ?? [];
    assert.equal(stranka[0]?.zaupanje, 0.42);
    assert.equal(stranka[0]?.znakov, "Jan Primer".length);
  });
});

describe("osebna tajnica: slabo prepoznano sporocilo", () => {
  const m = { razumevanje: nikoliModel };
  it("zaupanje < 0.5: enkrat prosba, naj ponovi; drugic sprejme, kar je", async () => {
    const dir = await nov({ nacinKlica: "osebna", imeLastnika: "Ana" });
    const sid = "CA-SLABO-1";
    await recordCaller({ callSid: sid, from: "+38640000000", text: "" }, dir, undefined, m);
    const prva = await recordCaller({ callSid: sid, text: "povejte mate", zaupanje: 0.3 }, dir, undefined, m);
    assert.equal(prva.reply, "Žal vas nisem dobro razumela. Ali lahko ponovite sporočilo?");
    assert.notEqual(prva.call.status, "zakljucen");
    const druga = await recordCaller({ callSid: sid, text: "pozdravite jo lepo", zaupanje: 0.3 }, dir, undefined, m);
    assert.ok(druga.call.order.tajnica?.sporocilo, "sporocilo zapisano");
    assert.match(druga.reply, /Zapisala sem: .+ Ali sem prav razumela\?/);
    assert.match(druga.call.order.tajnica?.sporocilo ?? "", /pozdravite jo lepo/);
  });

  it("ena beseda tudi pri visokem zaupanju: prosba; dobro razumljeno sporocilo takoj zakljuci", async () => {
    const dir = await nov({ nacinKlica: "osebna", imeLastnika: "Ana" });
    await recordCaller({ callSid: "CA-SLABO-2", from: "+38640000000", text: "" }, dir, undefined, m);
    const ena = await recordCaller({ callSid: "CA-SLABO-2", text: "pozdrav", zaupanje: 0.95 }, dir, undefined, m);
    assert.match(ena.reply, /ponovite sporočilo/);
    await recordCaller({ callSid: "CA-SLABO-3", from: "+38640000000", text: "" }, dir, undefined, m);
    const dobro = await recordCaller({ callSid: "CA-SLABO-3", text: "pozdravite jo lepo prosim", zaupanje: 0.9 }, dir, undefined, m);
    assert.ok(dobro.call.order.tajnica?.sporocilo, "sporocilo zapisano");
  });
});

/** WAV 8 kHz 16-bit mono: tisina, ton, tisina (sekunde). */
function wav(zacetek: number, ton: number, konec: number): Buffer {
  const n = Math.round((zacetek + ton + konec) * 8000);
  const podatki = Buffer.alloc(n * 2);
  for (let i = Math.round(zacetek * 8000); i < Math.round((zacetek + ton) * 8000); i += 1) podatki.writeInt16LE(Math.round(8000 * Math.sin(i * 0.3)), i * 2);
  const g = Buffer.alloc(44);
  g.write("RIFF", 0, "ascii");
  g.writeUInt32LE(36 + podatki.length, 4);
  g.write("WAVEfmt ", 8, "ascii");
  g.writeUInt32LE(16, 16);
  g.writeUInt16LE(1, 20);
  g.writeUInt16LE(1, 22);
  g.writeUInt32LE(8000, 24);
  g.writeUInt32LE(16000, 28);
  g.writeUInt16LE(2, 32);
  g.writeUInt16LE(16, 34);
  g.write("data", 36, "ascii");
  g.writeUInt32LE(podatki.length, 40);
  return Buffer.concat([g, podatki]);
}
const trajanje = (w: Buffer) => (w.length - 44) / 2 / 8000;

describe("tisina na robovih posnetka", () => {
  it("tisina nad 0,3 s se skrajsa na 0,15 s, govor ostane cel; do 0,3 s se ne dotakne", () => {
    const dolga = obreziTisinoNaRobovih8k(wav(1.0, 2.0, 1.0));
    assert.ok(Math.abs(trajanje(dolga) - 2.3) < 0.03, String(trajanje(dolga)));
    assert.equal(dolga.readUInt32LE(40), dolga.length - 44);
    const kratka = wav(0.25, 2.0, 0.25);
    assert.equal(obreziTisinoNaRobovih8k(kratka).length, kratka.length);
  });

  it("zapis posnetka ob sintezi obreze robove (en poseg v glas.server)", async () => {
    const dir = await mkdtemp(path.join(KOREN, "w-"));
    dirs.push(dir);
    nastaviSintezoZaPreizkus(async () => {
      const n = 24000 * 4;
      const pcm = Buffer.alloc(n * 2);
      for (let i = 24000; i < 24000 * 3; i += 1) pcm.writeInt16LE(Math.round(8000 * Math.sin(i * 0.1)), i * 2);
      return pcm;
    });
    const kljuc = await pripraviZvok("Preizkus robov posnetka.", dir, { stalno: true, zamiki: [] });
    const w = await preberiWavPosnetka(dir, kljuc);
    assert.ok(w);
    const sek = (w.length - 44) / 2 / 8000;
    assert.ok(sek < 2.7, `posnetek ${sek} s (brez obreze 4 s)`);
    assert.ok(sek > 2.0);
  });
});

describe("osebna tajnica: Confidence 0 je neznano, pozdrav ni sporocilo, tisina 3 s", () => {
  const m = { razumevanje: nikoliModel };
  it("Confidence 0 (Twilio sl-SI): dobro sporocilo se sprejme in zaupanje se ne zapise", async () => {
    const dir = await nov({ nacinKlica: "osebna", imeLastnika: "Ana" });
    const sid = "CA-CONF0";
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: "+38640000000" });
    const t = await klic(dir, "/api/voice/turn?obr=1", { CallSid: sid, From: "+38640000000", SpeechResult: "pozdravite jo lepo prosim", Confidence: "0" });
    assert.match(t, /Zapisala sem: .+ Ali sem prav razumela\?/);
    const zapis = await preberiKlic(sid, dir);
    assert.equal(zapis?.transcript.find((v) => v.role === "stranka")?.zaupanje, undefined);
    assert.ok(zapis?.order.tajnica?.sporocilo);
    // Neposredno: zaupanje 0 ne sproži prošnje za ponovitev.
    await recordCaller({ callSid: "CA-CONF0B", from: "+38640000000", text: "" }, dir, undefined, m);
    const b = await recordCaller({ callSid: "CA-CONF0B", text: "pozdravite jo lepo prosim", zaupanje: 0 }, dir, undefined, m);
    assert.ok(b.call.order.tajnica?.sporocilo, "sporocilo zapisano");
  });

  for (const pozdrav of ["Dober dan", "pozdravljeni.", "Halo?", "zdravo", "Dobro jutro", "dober večer", "Halo, dober dan"]) {
    it(`»${pozdrav}« ni sporocilo: »Izvolite, poslusam.«, klic ostane odprt`, async () => {
      const dir = await nov({ nacinKlica: "osebna", imeLastnika: "Ana" });
      const sid = `CA-POZDRAV-${pozdrav.length}`;
      await recordCaller({ callSid: sid, from: "+38640000000", text: "" }, dir, undefined, m);
      const r = await recordCaller({ callSid: sid, text: pozdrav, zaupanje: 0.9 }, dir, undefined, m);
      assert.equal(r.reply, "Izvolite, poslušam.");
      assert.notEqual(r.call.status, "zakljucen");
      assert.equal(r.call.order.tajnica?.sporocilo ?? "", "");
      assert.ok(!r.call.osebnoPonovljeno, "ne steje kot ponovna prosnja");
    });
  }

  it("po dveh pozdravih tretjic sprejme, kar je; pravo sporocilo z uvodnim pozdravom je sporocilo", async () => {
    const dir = await nov({ nacinKlica: "osebna", imeLastnika: "Ana" });
    const sid = "CA-POZDRAV-3X";
    await recordCaller({ callSid: sid, from: "+38640000000", text: "" }, dir, undefined, m);
    assert.equal((await recordCaller({ callSid: sid, text: "dober dan" }, dir, undefined, m)).reply, "Izvolite, poslušam.");
    assert.equal((await recordCaller({ callSid: sid, text: "halo" }, dir, undefined, m)).reply, "Izvolite, poslušam.");
    const tretji = await recordCaller({ callSid: sid, text: "dober dan dober dan" }, dir, undefined, m);
    assert.ok(tretji.call.order.tajnica?.sporocilo, "sporocilo zapisano");
    const dir2 = await nov({ nacinKlica: "osebna", imeLastnika: "Ana" });
    await recordCaller({ callSid: "CA-POZDRAV-4", from: "+38640000000", text: "" }, dir2, undefined, m);
    const sporocilo = await recordCaller({ callSid: "CA-POZDRAV-4", text: "dober dan pozdravite jo lepo" }, dir2, undefined, m);
    assert.ok(sporocilo.call.order.tajnica?.sporocilo, "sporocilo zapisano");
  });

  // Odlocitev 17. 11. 2026 (tisina.ts TISINA_OSEBNA_PRIVZETO_SEK): osebna tajnica caka 2 s (1 s je odrezala, 3 s predolgo).
  it("speechTimeout v osebnem nacinu je privzeto 2 s, pri podjetju 1 s; lastnikova vrednost ostane", async () => {
    const osebna = await klic(await nov({ nacinKlica: "osebna", imeLastnika: "Ana" }), "/api/voice/incoming", { CallSid: "CA-TIS-1", From: "+38640000000" });
    assert.match(osebna, /speechTimeout="2"/);
    const podjetje = await klic(await nov({ nacinKlica: "podjetje" }), "/api/voice/incoming", { CallSid: "CA-TIS-2", From: "+38640000000" });
    assert.match(podjetje, /speechTimeout="2"|speechTimeout="1"/);
    assert.equal(normalizePravila({ nacinKlica: "osebna", tisinaPoGovoruSek: 1 }).tisinaPoGovoruSek, 2, "stara privzeta 1 se ne steje za lastnikovo");
    assert.equal(normalizePravila({ nacinKlica: "osebna", tisinaPoGovoruSek: 3 }).tisinaPoGovoruSek, 2, "stara privzeta 3 preide na 2");
    assert.equal(normalizePravila({ nacinKlica: "osebna", tisinaPoGovoruSek: 2, tisinaNastavil: true }).tisinaPoGovoruSek, 2);
    assert.equal(normalizePravila({ nacinKlica: "podjetje", tisinaPoGovoruSek: 2 }).tisinaPoGovoruSek, 2);
  });

  it("savePravila: sprememba tisine v osebnem nacinu ostane lastnikova vrednost", async () => {
    const { setupOwner } = await import("./auth.server.ts");
    const { loadPravila, savePravila } = await import("./pravila.server.ts");
    const dir = await nov({ nacinKlica: "osebna", imeLastnika: "Ana" });
    const token = await setupOwner("geslo-test-1234", dir);
    assert.equal((await loadPravila(dir)).tisinaPoGovoruSek, 2);
    await savePravila({ tisinaPoGovoruSek: 1 }, token, dir);
    assert.equal((await loadPravila(dir)).tisinaPoGovoruSek, 1);
  });
});
