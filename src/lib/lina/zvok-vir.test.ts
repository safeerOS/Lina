/**
 * Vir zvoka klicatelja (lastnik 19. 11. 2026): simulacija iz WAV, adapter Twilio, vrsta s potiskom. Brez omrezja.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KOS_VZORCEV_16K, PotisniVir, ZvokVirTwilio, zvokVirIzWav } from "./live/zvok-vir.ts";
import { MULAW_TISINA, pcmVMulaw } from "./live/zvok.ts";

function wav(pcm: Int16Array, frekvenca: number): Uint8Array {
  const ven = new Uint8Array(44 + pcm.length * 2);
  const d = new DataView(ven.buffer);
  const niz = (od: number, s: string) => [...s].forEach((c, i) => (ven[od + i] = c.charCodeAt(0)));
  niz(0, "RIFF");
  d.setUint32(4, 36 + pcm.length * 2, true);
  niz(8, "WAVE");
  niz(12, "fmt ");
  d.setUint32(16, 16, true);
  d.setUint16(20, 1, true);
  d.setUint16(22, 1, true);
  d.setUint32(24, frekvenca, true);
  d.setUint32(28, frekvenca * 2, true);
  d.setUint16(32, 2, true);
  d.setUint16(34, 16, true);
  niz(36, "data");
  d.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i += 1) d.setInt16(44 + i * 2, pcm[i], true);
  return ven;
}

async function preberi(vir: { kosi(): AsyncIterable<Int16Array> }): Promise<Int16Array[]> {
  const kosi: Int16Array[] = [];
  for await (const k of vir.kosi()) kosi.push(k);
  return kosi;
}

describe("simulacija iz WAV", () => {
  it("16 kHz: kosi po 320 vzorcev, zadnji krajsi, vsi vzorci ohranjeni", async () => {
    const pcm = Int16Array.from({ length: 1000 }, (_, i) => i - 500);
    const vir = zvokVirIzWav(wav(pcm, 16000));
    assert.ok(vir);
    assert.equal(vir.id, "wav-simulacija");
    const kosi = await preberi(vir);
    assert.deepEqual(kosi.map((k) => k.length), [KOS_VZORCEV_16K, KOS_VZORCEV_16K, KOS_VZORCEV_16K, 40]);
    const vse = new Int16Array(1000);
    let o = 0;
    for (const k of kosi) {
      vse.set(k, o);
      o += k.length;
    }
    assert.deepEqual(vse, pcm);
  });
  it("8 kHz se prevzorci na 16 kHz (priblizno dvakrat vec vzorcev)", async () => {
    const vir = zvokVirIzWav(wav(new Int16Array(8000), 8000));
    assert.ok(vir);
    const skupaj = (await preberi(vir)).reduce((a, k) => a + k.length, 0);
    assert.ok(skupaj > 15000 && skupaj <= 16000, `skupaj ${skupaj}`);
  });
  it("neveljaven ali stereo WAV vrne null", () => {
    assert.equal(zvokVirIzWav(new Uint8Array(10)), null);
    const stereo = wav(new Int16Array(100), 16000);
    new DataView(stereo.buffer).setUint16(22, 2, true);
    assert.equal(zvokVirIzWav(stereo), null);
  });
});

describe("adapter Twilio in vrsta", () => {
  it("mu-law okvirji 20 ms dajo kose po 320 vzorcev pri 16 kHz", async () => {
    const vir = new ZvokVirTwilio();
    assert.equal(vir.id, "twilio-stream");
    const okvir = new Uint8Array(160).fill(MULAW_TISINA);
    for (let i = 0; i < 10; i += 1) vir.potisniMulaw(okvir);
    vir.zapri();
    const kosi = await preberi(vir);
    assert.ok(kosi.length >= 8, `kosov ${kosi.length}`);
    assert.ok(kosi.slice(0, -1).every((k) => k.length === KOS_VZORCEV_16K));
  });
  it("mu-law zaokrozitev: ton 1 kHz ostane ton (energija ni nicelna)", async () => {
    const vir = new ZvokVirTwilio();
    const ton = Int16Array.from({ length: 1600 }, (_, i) => Math.round(8000 * Math.sin((2 * Math.PI * 1000 * i) / 8000)));
    const mulaw = pcmVMulaw(ton);
    for (let i = 0; i + 160 <= mulaw.length; i += 160) vir.potisniMulaw(mulaw.subarray(i, i + 160));
    vir.zapri();
    const energija = (await preberi(vir)).flatMap((k) => [...k]).reduce((a, v) => a + Math.abs(v), 0);
    assert.ok(energija > 1_000_000, `energija ${energija}`);
  });
  it("cakajoci bralec dobi kos, ko je potisnjen, in konec ob zapiranju", async () => {
    const vir = new PotisniVir("openline-ws");
    const it = vir.kosi()[Symbol.asyncIterator]();
    const cakanje = it.next();
    vir.potisni(new Int16Array(KOS_VZORCEV_16K));
    assert.equal((await cakanje).value?.length, KOS_VZORCEV_16K);
    const konec = it.next();
    vir.zapri();
    assert.equal((await konec).done, true);
  });
  it("polna vrsta zavrze najstarejse kose in jih steje; po zapiranju potisk ne naredi nic", async () => {
    const vir = new PotisniVir("openline-ws", 2);
    for (let i = 0; i < 5; i += 1) vir.potisni(Int16Array.from({ length: KOS_VZORCEV_16K }, () => i));
    assert.equal(vir.zavrzenih, 3);
    vir.zapri();
    vir.potisni(new Int16Array(KOS_VZORCEV_16K));
    const kosi = await preberi(vir);
    assert.deepEqual(kosi.map((k) => k[0]), [3, 4]);
  });
});
