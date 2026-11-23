/** Sporocila s telefona (sinhronizacija) gredo v spomin racunalnika enkrat; racunalniska se ne podvojijo. Podatki izmisljeni. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
});
