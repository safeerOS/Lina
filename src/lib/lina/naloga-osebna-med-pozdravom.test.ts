/**
 * Klic K1 (14. 11. 2026): lastnik je spregovoril MED pozdravom (~12 s), <Play> v <Gather> govora ne prekine; Gather je zbral
 * »zdravo ni na zdravo zdravo ej« (/turn 13 s po /incoming) in Lina je to vzela za sporocilo. Ime v preizkusih izmisljeno (Ana).
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { trajanjeWavMs } from "./glas.server.ts";
import { pocakajDnevnikGlasu, pocakajGlas, ustaviCiscenjeZvoka } from "./glas.server.ts";
import { jeSamoPozdravnoPolnilo, vsebinskeBesede } from "./osebna-polnila.ts";
import { razberiOsebno } from "./osebna-razumevanje.server.ts";
import { defaultPravila } from "./pravila.server.ts";
import type { ModelRazumevanja } from "./razumevanje.server.ts";
import { preberiKlic } from "./service.server.ts";
import { writeJson } from "./store.server.ts";
import { handleVoiceRequest } from "./voice.server.ts";

process.env.LINA_LLM = "0";
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-osebna-med-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const dirs: string[] = [];
afterEach(async () => {
  delete process.env.TWILIO_AUTH_TOKEN;
  while (dirs.length) {
    const dir = dirs.pop() as string;
    await pocakajGlas(dir);
    await pocakajDnevnikGlasu(dir);
    ustaviCiscenjeZvoka(dir);
  }
});
const nikoliModel: ModelRazumevanja = async () => {
  throw new Error("brez modela");
};

/** Klic preko Twilio z vbrizgano uro (ms): cas /incoming in /turn je tocen potek klica. */
async function klicatelj(sid: string) {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  dirs.push(dir);
  await writeJson(dir, "line.json", { open: true, catalog: { company: { name: "Podjetje Primer", trade: "", phone: "", address: "", hours: "", about: "" }, materials: [], products: [], zapiski: [], znanje: "" }, updatedAt: null });
  await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi", nacinKlica: "osebna", imeLastnika: "Ana" });
  process.env.TWILIO_AUTH_TOKEN = "zeton-preizkusa";
  let cas = 1_000_000;
  const klic = async (pot: string, params: Record<string, string>, ms: number) => {
    cas = 1_000_000 + ms;
    const url = `https://lina.primer${pot}`;
    const podpis = createHmac("sha1", "zeton-preizkusa").update(Object.keys(params).sort().reduce((a, k) => a + k + params[k], url)).digest("base64");
    const r = await handleVoiceRequest(
      new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": podpis }, body: new URLSearchParams(params).toString() }),
      dir,
      undefined,
      { razumevanje: nikoliModel, ura: () => cas } as never,
    );
    return r.text();
  };
  const incoming = () => klic("/api/voice/incoming", { CallSid: sid, From: "+38640000000" }, 0);
  const turn = (izrek: string, ms: number, obr = 1) => klic(`/api/voice/turn?obr=${obr}`, { CallSid: sid, From: "+38640000000", SpeechResult: izrek }, ms);
  return { dir, incoming, turn };
}

describe("osebna tajnica: govor med pozdravom ni sporocilo", () => {
  it("tocen potek K1: /turn 13 s po /incoming z »zdravo ni na zdravo zdravo ej« -> Izvolite, poslusam; klic se nadaljuje", async () => {
    const { dir, incoming, turn } = await klicatelj("CA-MED-1");
    await incoming();
    const b = await turn("zdravo ni na zdravo zdravo ej", 13_000);
    assert.match(b, /Izvolite, poslušam\./);
    assert.doesNotMatch(b, /Zapisala sem: |<Hangup\/>/);
    assert.equal((await preberiKlic("CA-MED-1", dir))?.order.tajnica, undefined, "ni shranjeno kot sporocilo");
    const c = await turn("Naj me Marko jutri pokliče nazaj", 30_000, 2);
    assert.match(c, /Zapisala sem: .+ Ali sem prav razumela\?/);
  });

  it("v oknu pozdrava velja kot sporocilo samo govor z vsaj 3 vsebinskimi besedami", async () => {
    const kratek = await klicatelj("CA-MED-2");
    await kratek.incoming();
    assert.match(await kratek.turn("pokličite me", 5_000), /Izvolite, poslušam\./);
    const dolg = await klicatelj("CA-MED-3");
    await dolg.incoming();
    assert.match(await dolg.turn("zdravo pokličite me jutri nazaj", 5_000), /Zapisala sem: .+ Ali sem prav razumela\?/);
  });

  it("zunaj okna (po koncu pozdrava + 2 s) isti kratek govor velja kot sporocilo", async () => {
    const { incoming, turn } = await klicatelj("CA-MED-4");
    await incoming();
    assert.match(await turn("pokličite me", 20_000), /Zapisala sem: .+ Ali sem prav razumela\?/);
  });

  it("med pozdravom najvec 2x »Izvolite«, nato velja, kar je", async () => {
    const { incoming, turn } = await klicatelj("CA-MED-5");
    await incoming();
    assert.match(await turn("zdravo ej", 5_000), /Izvolite, poslušam\./);
    assert.match(await turn("zdravo ni", 30_000, 2), /Izvolite, poslušam\./);
  });
});

describe("pozdravna in polnilna besedila", () => {
  it("izrek iz samih pozdravnih/polnilnih besed je pozdrav ne glede na stevilo besed", () => {
    for (const izrek of ["zdravo ni na zdravo zdravo ej", "dober dan halo hej aha ja ja ja ja", "Živijo, ej!"]) assert.equal(jeSamoPozdravnoPolnilo(izrek), true, izrek);
    for (const izrek of ["", "zdravo pokličite me", "ni mi uspelo"]) assert.equal(jeSamoPozdravnoPolnilo(izrek), false, izrek);
    assert.deepEqual(vsebinskeBesede("dober dan zdravo pokličite me nazaj"), ["poklicite", "me", "nazaj"]);
  });

  it("razumiOsebniIzrek/razberiOsebno: polnila so pozdrav tudi ce model trdi sporocilo ali ni modela", () => {
    const izrek = "zdravo ni na zdravo zdravo ej";
    assert.equal(razberiOsebno('{"vrsta":"sporocilo","sporocilo":"zdravo zdravo","ime":""}', izrek)?.vrsta, "pozdrav");
    assert.equal(razberiOsebno(null, izrek)?.vrsta, "pozdrav");
  });

  it("trajanje WAV iz glave", () => {
    const pcm = 24_000 * 2 * 12;
    const wav = Buffer.alloc(44 + pcm);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + pcm, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(24_000, 24);
    wav.writeUInt32LE(48_000, 28);
    wav.write("data", 36);
    wav.writeUInt32LE(pcm, 40);
    assert.equal(trajanjeWavMs(wav), 12_000);
    assert.equal(trajanjeWavMs(Buffer.alloc(10)), 0);
  });
});
