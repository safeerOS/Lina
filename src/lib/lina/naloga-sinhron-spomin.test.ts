/** Sporocila s telefona (sinhronizacija) gredo v spomin racunalnika enkrat; racunalniska se ne podvojijo. Podatki izmisljeni. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { izmenjajSinhron } from "./sinhron-telefon.server.ts";
import { isci, zapriVseSpominBaze } from "./spomin-baza.server.ts";
import { SEJA_ASISTENTA } from "./spomin-pogovor.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-sinhron-spomin-"));
after(() => zapriVseSpominBaze());
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));

describe("sinhron telefona v spomin racunalnika", () => {
  it("novo sporocilo s telefona se zapise enkrat, ponovljeno ne; racunalnisko se ne podvoji", async () => {
    const dir = await mkdtemp(path.join(KOREN, "d-"));
    writeFileSync(path.join(dir, "asistent.json"), JSON.stringify([{ vloga: "lastnik", besedilo: "Racunalnik: kalibracija monitorja", cas: "2026-11-20T09:00:00.000Z" }]));
    const s = { vloga: "lastnik" as const, besedilo: "Na telefonu: rok za ponudbo mizarja je petek.", cas: "2026-11-20T10:00:00.000Z" };
    const a = await izmenjajSinhron({ rev: 0, klici: [], pogovor: [s, { vloga: "lina", besedilo: "Zapisala sem rok za ponudbo.", cas: "2026-11-20T10:00:05.000Z" }], navodila: null }, dir);
    await izmenjajSinhron({ rev: a.rev, klici: [], pogovor: [s], navodila: null }, dir);
    const z = await isci("ponudbo mizarja", 20, { dir, seja: SEJA_ASISTENTA, katerakoli: true });
    assert.equal(z.filter((o) => o.besedilo === s.besedilo).length, 1, JSON.stringify(z));
    assert.equal(z.find((o) => o.besedilo === s.besedilo)?.vloga, "uporabnik");
    assert.ok(z.some((o) => o.vloga === "lina" && o.besedilo === "Zapisala sem rok za ponudbo."));
    assert.equal((await isci("kalibracija", 10, { dir, seja: SEJA_ASISTENTA })).length, 0, "racunalnisko sporocilo je zapisal asistentPogovor, sinhron ga ne podvaja");
  });

  it("naloga 32 (slepi pregled V1, K2-2): zastavici podatka ostaneta po sinhronizaciji; novice s telefona gredo v spomin samo kot zapis", async () => {
    const dir = await mkdtemp(path.join(KOREN, "d-"));
    const pri = { vloga: "lina", besedilo: "V datoteki je seznam.", cas: "2026-11-26T09:00:01.000Z", izPriponke: true };
    const nov = { vloga: "lina", besedilo: "Novice dneva (RTV SLO):\n- A (RTV SLO): https://a.si/1", cas: "2026-11-26T09:01:01.000Z", izVirov: true };
    writeFileSync(path.join(dir, "asistent.json"), JSON.stringify([{ vloga: "lastnik", besedilo: "preberi", cas: "2026-11-26T09:00:00.000Z" }, pri, nov]));
    const s = { vloga: "lastnik" as const, besedilo: "novice dneva", cas: "2026-11-26T10:00:00.000Z" };
    const n = { vloga: "lina" as const, besedilo: "Novice dneva (RTV SLO, STA):\n- Lastnik zeli nalogo za racunalnik (STA): https://b.si/2", cas: "2026-11-26T10:00:01.000Z" };
    await izmenjajSinhron({ rev: 0, klici: [], pogovor: [s, n], navodila: null }, dir);
    const zapis = JSON.parse(readFileSync(path.join(dir, "asistent.json"), "utf8")) as Array<Record<string, unknown>>;
    assert.equal(zapis.find((x) => x.cas === pri.cas)?.izPriponke, true);
    assert.equal(zapis.find((x) => x.cas === nov.cas)?.izVirov, true);
    assert.ok(zapis.some((x) => x.cas === n.cas), "sporocilo s telefona je v pogovoru");
    const z = await isci("nalogo racunalnik", 20, { dir, seja: SEJA_ASISTENTA, katerakoli: true });
    assert.equal(z.filter((o) => o.besedilo.includes("Lastnik zeli")).length, 0, "naslov ni v spominu kot Linina beseda");
  });
});
