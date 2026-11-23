/**
 * Naloga G4l. Izenacenje glasu: vsi posnetki v klicu naj zvenijo kot ista oseba (lastnik 11. 11. 2026).
 * Nikjer pravega omrezja: sinteza je lazni izvajalec z umetnim govorom (harmoniki), komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { CILJ_F0_HZ, CILJ_RMS_DB, izenaciGovor, medianaF0, OBDELAVA_ZVOKA, rmsGovoraDb } from "./glas-izenacenje.ts";
import { GLAS_IME, GLAS_MODEL, kljucZvoka, NAVODILO_SLOGA, SEME_SINTEZE, semeZaBesedilo, teloGlasu } from "./glas.ts";
import { mapaZvoka, nastaviSintezoZaPreizkus, pripraviZvok } from "./glas.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-g4l-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
afterEach(() => nastaviSintezoZaPreizkus(null));

/** Umetni govor: osnovna frekvenca f0 z 8 harmoniki, amplituda a, 1,5 s, z mehko obliko glasnosti. */
function govor(f0: number, amplituda: number): Buffer {
  const n = 36_000;
  const ven = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i += 1) {
    let v = 0;
    for (let k = 1; k <= 8; k += 1) v += Math.sin((2 * Math.PI * f0 * k * i) / 24_000) / k;
    const ovojnica = Math.min(1, i / 2400, (n - i) / 2400);
    ven.writeInt16LE(Math.round(v * amplituda * ovojnica * 32767), i * 2);
  }
  return ven;
}

function wavPcm(wav: Buffer): Buffer {
  // WAV 8 kHz iz pcm24VWav8; za meritev ga vrnemo na 24 kHz s ponovitvijo vzorcev (RMS ostane).
  const podatki = wav.subarray(44);
  const ven = Buffer.alloc(podatki.length * 3);
  for (let i = 0; i < podatki.length / 2; i += 1) for (let k = 0; k < 3; k += 1) podatki.copy(ven, (i * 3 + k) * 2, i * 2, i * 2 + 2);
  return ven;
}

describe("naloga G4l: izenacenje glasu", () => {
  it("A1 glasnost: tih in glasen posnetek po izenacenju enako glasna (prej 12 dB razlike)", () => {
    const tih = rmsGovoraDb(izenaciGovor(govor(214, 0.08)))!;
    const glasen = rmsGovoraDb(izenaciGovor(govor(214, 0.32)))!;
    assert.ok(Math.abs(tih - glasen) < 0.3, `${tih} ${glasen}`);
    assert.ok(Math.abs(tih - CILJ_RMS_DB) < 0.5, `${tih}`);
  });

  it("A2 visina: nizek in visok glas se priblizata cilju (v mejah +-2 pt), ne presezeta meje", () => {
    const nizek = medianaF0(izenaciGovor(govor(190, 0.2)))!;
    const visok = medianaF0(izenaciGovor(govor(240, 0.2)))!;
    assert.ok(Math.abs(12 * Math.log2(nizek / CILJ_F0_HZ)) < 0.45, `${nizek}`);
    // 240 Hz je 2,0 pt nad ciljem: premik je omejen na 2 pt, torej ostane v bliznji cilja.
    assert.ok(Math.abs(12 * Math.log2(visok / CILJ_F0_HZ)) < 0.45, `${visok}`);
    const zelo = medianaF0(izenaciGovor(govor(300, 0.2)))!; // 5,9 pt nad ciljem: omejitev, ne popolno izenacenje
    assert.ok(zelo > CILJ_F0_HZ * 1.15 && zelo < 300, `${zelo}`);
  });

  it("A3 tisina, prekratek posnetek in neparna dolzina gredo ven brez popacenja ali izjeme", () => {
    const tisina = Buffer.alloc(48_000);
    assert.deepEqual(izenaciGovor(tisina), tisina);
    assert.equal(izenaciGovor(Buffer.alloc(0)).length, 0);
    assert.doesNotThrow(() => izenaciGovor(Buffer.from([1, 2, 3])));
    assert.equal(izenaciGovor(govor(214, 0.2)).length % 2, 0);
  });

  it("A4 ojacenje ne povzroci prekoracitve (vrh <= 0,98)", () => {
    const pcm = govor(214, 0.02);
    pcm.writeInt16LE(30_000, 1000); // kratek sunek: ojacenje po RMS bi ga presililo
    const ven = izenaciGovor(pcm);
    let vrh = 0;
    for (let i = 0; i < ven.length; i += 2) vrh = Math.max(vrh, Math.abs(ven.readInt16LE(i)));
    assert.ok(vrh <= 0.98 * 32768 + 2, `${vrh}`);
  });

  it("B1 seme in obdelava sta v zahtevi in v kljucu posnetka", () => {
    // G4m (tabela_semen.ts): stavek iz tabele ima svoje izmerjeno seme, drug stavek privzeto SEME_SINTEZE.
    const telo = teloGlasu("Hvala.") as { generationConfig: { seed?: number } };
    assert.equal(telo.generationConfig.seed, semeZaBesedilo("Hvala."));
    assert.equal((teloGlasu("Stavek, ki ga ni v tabeli.") as { generationConfig: { seed?: number } }).generationConfig.seed, SEME_SINTEZE);
    const sol = randomBytes(32);
    const pricakovan = createHmac("sha256", sol)
      .update(`${GLAS_MODEL}|${GLAS_IME}|${NAVODILO_SLOGA}|${OBDELAVA_ZVOKA}|${semeZaBesedilo("Hvala.")}|Hvala.`)
      .digest("hex")
      .slice(0, 32);
    assert.equal(kljucZvoka(sol, "Hvala."), pricakovan);
  });

  it("B2 pripraviZvok shrani IZENACEN posnetek: dve sintezi razlicne glasnosti dasta isto glasnost na disku", async () => {
    const dir = mkdtempSync(path.join(KOREN, "d-"));
    const amplitude = new Map([["Tih stavek.", 0.05], ["Glasen stavek.", 0.4]]);
    nastaviSintezoZaPreizkus(async (besedilo) => govor(214, amplitude.get(besedilo) ?? 0.2));
    const a = await pripraviZvok("Tih stavek.", dir);
    const b = await pripraviZvok("Glasen stavek.", dir);
    const ra = rmsGovoraDb(wavPcm(await readFile(path.join(mapaZvoka(dir), `${a}.wav`))))!;
    const rb = rmsGovoraDb(wavPcm(await readFile(path.join(mapaZvoka(dir), `${b}.wav`))))!;
    assert.ok(Math.abs(ra - rb) < 0.6, `${ra} ${rb}`);
  });
});
