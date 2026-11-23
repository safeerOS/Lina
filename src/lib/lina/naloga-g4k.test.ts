/**
 * Naloga G4k (lastnik 11. 11. 2026: »ko uporabnik pove svoje podatke in kaj zeli, naj bo cim manj cakanja«).
 * Meritev 11. 11. 2026 (pravi Vertex): odgovor »Material Hrast imamo. Kateri izdelek zelite? Delamo: ...« ni bil
 * stalni posnetek, sinteza je presegla mejo zahteve 3,5 s in klicatelj je slisal tisino + »Trenutek«. Zdaj sta
 * odgovora »samo material« in »nic znanega« stalna posnetka. Brez pravega omrezja; komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { stavekBrezIzdelka, stavekSamoMaterial, stavkiIzKataloga } from "./brain.ts";
import { formaCatalog } from "./catalog.ts";
import { stalniStavki } from "./glas.ts";
import { nastaviSintezoZaPreizkus, pocakajDnevnikGlasu, pocakajGlas, ponastaviOdklopnik, ustaviCiscenjeZvoka } from "./glas.server.ts";
import { defaultPravila } from "./pravila.server.ts";
import { pripraviGlasObZagonu } from "./service.server.ts";
import { writeJson } from "./store.server.ts";
import { CAKAJ_POVZETEK_MS, handleVoiceRequest, pocakajOzadjeKlicev, ustaviCiscenjeOpravil } from "./voice.server.ts";

process.env.LINA_LLM = "0";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-g4k-"));
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

const IZVOR = "https://lina.primer";
const SKRIVNOST = "twilio-zeton-preizkusa";
const OD = "+38640000000";

async function zGlasom(): Promise<string> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  temps.push(dir);
  await writeJson(dir, "line.json", { open: true, catalog: formaCatalog(), updatedAt: null });
  await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi" });
  await pripraviGlasObZagonu(dir);
  await pocakajGlas(dir);
  return dir;
}

async function klic(dir: string, pot: string, params: Record<string, string>): Promise<string> {
  process.env.TWILIO_AUTH_TOKEN = SKRIVNOST;
  const signed = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], `${IZVOR}${pot}`);
  const odgovor = await handleVoiceRequest(
    new Request(`${IZVOR}${pot}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": createHmac("sha1", SKRIVNOST).update(signed).digest("base64") },
      body: new URLSearchParams(params).toString(),
    }),
    dir,
  );
  assert.equal(odgovor.status, 200, pot);
  return odgovor.text();
}

describe("naloga G4k: odgovora »samo material« in »nic znanega« sta stalna posnetka", { concurrency: 1 }, () => {
  it("stalni stavki vsebujejo natancno besedilo odgovora za vsak material in splosni odgovor", () => {
    const katalog = formaCatalog();
    const imena = katalog.products.map((izdelek) => izdelek.name).join(", ");
    const stalni = stalniStavki(defaultPravila(), "FORMA", katalog);
    for (const material of katalog.materials) assert.ok(stalni.includes(stavekSamoMaterial(material.name, imena)), material.name);
    assert.ok(stalni.includes(stavekBrezIzdelka(imena)));
    // H1 (brain.ts stavkiIzKataloga): dodani so stalni odgovori »kateri izdelki« - vsi in po vsakem materialu (1 + materiali).
    assert.equal(stavkiIzKataloga(katalog).length, 13 + katalog.materials.length + 1 + (1 + katalog.materials.length));
  });

  it("klicatelj pove samo material: ena zahteva, samo <Play> stalnih posnetkov, brez nove sinteze in brez »Trenutek«", async () => {
    // Stalni posnetki se pripravijo ob zagonu (hitri lazni glas); sele nato nova sinteza obvisi.
    nastaviSintezoZaPreizkus(async () => Buffer.alloc(4800));
    const dir = await zGlasom();
    const klici: string[] = [];
    // Vsaka nova sinteza obvisi: ce bi bil odgovor sintetiziran med klicem, bi klicatelj dobil Redirect.
    const nikoli = new Promise<void>((resolve) => zapore.push(resolve));
    nastaviSintezoZaPreizkus(async (besedilo) => {
      klici.push(besedilo);
      await nikoli;
      return Buffer.alloc(4800);
    });
    const sid = "CA-G4K-1";
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: OD });
    await klic(dir, "/api/voice/turn?obr=1", { CallSid: sid, From: OD, SpeechResult: "Ana Primer." });
    const odgovor = await klic(dir, "/api/voice/turn?obr=2", { CallSid: sid, From: OD, SpeechResult: "Rad bi naročil hrast." });
    // Predpriprava povzetka (ime) tece v ozadju; odgovor na material pa se ne sme sintetizirati.
    assert.deepEqual(klici.filter((besedilo) => /imamo|Delamo/.test(besedilo)), [], "odgovor na material je stalni posnetek");
    assert.doesNotMatch(odgovor, /<Redirect[^>]*cak=/);
    assert.doesNotMatch(odgovor, /<Say/);
    assert.ok((odgovor.match(/<Play>/g) ?? []).length >= 1);
    assert.match(odgovor, /<Gather/);
  });
});

describe("naloga G4k (2): povzetek ne caka 500 ms, ce je prvi kos ze pripravljen", { concurrency: 1 }, () => {
  it("stavek narocila se sintetizira: prvi odgovor s pripravljenim uvodom pride bistveno pred mejo CAKAJ_POVZETEK_MS", async () => {
    const vrata = new Promise<void>((resolve) => zapore.push(resolve));
    nastaviSintezoZaPreizkus(async (besedilo) => {
      if (/^Naročate izdelek/.test(besedilo)) await vrata;
      return Buffer.alloc(4800);
    });
    const dir = await zGlasom();
    const sid = "CA-G4K-2";
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: OD });
    await klic(dir, "/api/voice/turn?obr=1", { CallSid: sid, From: OD, SpeechResult: "Ana Primer." });
    await klic(dir, "/api/voice/turn?obr=2", { CallSid: sid, From: OD, SpeechResult: "Mizo Alba iz hrasta, 2 kosa." });
    await pocakajOzadjeKlicev();
    const zacetek = Date.now();
    const prvi = await klic(dir, "/api/voice/turn?obr=3", { CallSid: sid, From: OD, SpeechResult: "Do petka." });
    const trajanje = Date.now() - zacetek;
    assert.match(prvi, /<Redirect[^>]*>[^<]*cak=1&amp;od=1/, "stavek narocila caka: nadaljevanje");
    // Brez popravka vedno cela meja (500 ms), ker zadnji kos ni pripravljen; s popravkom le nekaj deset ms.
    assert.ok(trajanje < CAKAJ_POVZETEK_MS - 150, `prvi odgovor po ${trajanje} ms`);
  });
});
