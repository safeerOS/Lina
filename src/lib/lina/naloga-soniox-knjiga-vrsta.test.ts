/**
 * Dobeseden zapis (Soniox) pride PO koncu klica, ko lahko drugi klic (dve liniji hkrati) isto knjigo klicev ze zapisuje.
 * Zapis dobesednega besedila mora iti skozi ISTO vrsto zapisov knjige kot vsi drugi zapisi (service.server.ts), sicer
 * branje-spreminjanje-pisanje cele knjige pobrise sveze spremembe drugega klica. Vsi podatki so izmisljeni.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { zapisnikIzKnjige } from "./live/vstop.server.ts";
import type { CallSession } from "./types.ts";

process.env.LINA_LLM = "0";
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-soniox-vrsta-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));

const POZDRAV = "Dober dan, tukaj Lina, pomočnica z umetno inteligenco.";

describe("dobesedni zapis in zapisi drugega klica si ne pobrisejo sprememb", () => {
  it("hkratni dobesedni zapis klica A in izreki klica B: nobena sprememba ne izgine", async () => {
    const dir = await mkdtemp(path.join(KOREN, "d-"));
    await setupOwner("geslo-soniox-vrsta-1234", dir);
    const zap = zapisnikIzKnjige(dir);
    const a = "CA-vrsta-a";
    const b = "CA-vrsta-b";
    await zap.zacni({ callSid: a, from: "+38640000011", pozdrav: POZDRAV });
    await zap.zacni({ callSid: b, from: "+38640000012", pozdrav: POZDRAV });
    await zap.zakljuci(a);

    const KROGOV = 40;
    for (let i = 0; i < KROGOV; i += 1) {
      await Promise.all([zap.dobesedno!(a, `dobesedno ${i}`), zap.izrek(b, `izrek številka ${i}`)]);
    }

    const book = JSON.parse(await readFile(path.join(dir, "calls.json"), "utf8")) as Record<string, CallSession>;
    assert.equal(book[a].dobesedno, `dobesedno ${KROGOV - 1}`, "zadnji dobeseden zapis klica A je shranjen");
    const izreki = book[b].transcript.filter((v) => v.role === "stranka").length;
    assert.equal(izreki, KROGOV, `vsak izrek klica B je v zapisu (${izreki} od ${KROGOV})`);
  });
});
