/**
 * Naloga 17a, pot (a): posnetek asistentke -> ffmpeg (16 kHz WAV) -> RNNoise -> RSDO (namig za Gemini). ffmpeg zapise blok LIST
 * pred data (preverjeno z ffmpeg 6, 25. 11. 2026), zato razclenjevalnik isce bloke. Stikalo »Zmanjsanje hrupa« izklopljeno ali
 * RNNoise ni na voljo = datoteka za RSDO nespremenjena. Gemini dobi izvirni posnetek (ta pot ga ne spremeni). Brez omrezja.
 * Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { prepisiRsdo, type Izvajalec } from "./rsdo-motor.server.ts";
import { MESANICA_RNNOISE_POSNETEK, nalozRnnoise, ocistiPosnetekRnnoise, ocistiWav16k } from "./zvok-rnnoise.server.ts";
import { belSum, sinteticniGovor, zmesaj } from "./zvok-sinteticno.ts";

function wavZListom(pcm: Int16Array, fs = 16000, kanalov = 1, bitov = 16, oblika = 1): Buffer {
  const list = Buffer.concat([Buffer.from("LIST"), Buffer.from([26, 0, 0, 0]), Buffer.from("INFOISFT"), Buffer.from([14, 0, 0, 0]), Buffer.from("Lavf60.16.100\0")]);
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0);
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(oblika, 8);
  fmt.writeUInt16LE(kanalov, 10);
  fmt.writeUInt32LE(fs, 12);
  fmt.writeUInt32LE(fs * kanalov * (bitov / 8), 16);
  fmt.writeUInt16LE(kanalov * (bitov / 8), 20);
  fmt.writeUInt16LE(bitov, 22);
  const data = Buffer.alloc(8);
  data.write("data", 0);
  data.writeUInt32LE(pcm.length * 2, 4);
  const telo = Buffer.concat([Buffer.from("WAVE"), fmt, list, data, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.length * 2)]);
  const glava = Buffer.alloc(8);
  glava.write("RIFF", 0);
  glava.writeUInt32LE(telo.length, 4);
  return Buffer.concat([glava, telo]);
}

function vzorci(wav: Buffer): Int16Array {
  assert.equal(wav.toString("latin1", 36, 40), "data", "izhod ima preprosto 44-bajtno glavo");
  const n = wav.readUInt32LE(40) / 2;
  return Int16Array.from({ length: n }, (_v, i) => wav.readInt16LE(44 + i * 2));
}

const govor16 = (() => {
  const g = zmesaj(sinteticniGovor(8000 * 2), belSum(8000 * 2), 5);
  return Int16Array.from({ length: g.length * 2 }, (_v, i) => g[i >> 1] as number);
})();

describe("ocistiWav16k: WAV iz ffmpeg (z blokom LIST)", () => {
  it("16 kHz mono 16-bit: ocisceno kot ocistiPosnetekRnnoise, enako stevilo vzorcev", async () => {
    const m = await nalozRnnoise();
    assert.ok(m);
    const izid = await ocistiWav16k(m, wavZListom(govor16));
    assert.ok(izid);
    assert.deepEqual(vzorci(izid), ocistiPosnetekRnnoise(m, govor16, 16000, MESANICA_RNNOISE_POSNETEK));
  });

  it("druga oblika (8 kHz, stereo, 8-bit, ne PCM, pokvarjeno) vrne null", async () => {
    const m = await nalozRnnoise();
    assert.ok(m);
    for (const w of [wavZListom(govor16, 8000), wavZListom(govor16, 16000, 2), wavZListom(govor16, 16000, 1, 8), wavZListom(govor16, 16000, 1, 16, 3), Buffer.from("RIFF1234WAVEfmt "), Buffer.alloc(0)]) {
      assert.equal(await ocistiWav16k(m, w), null);
    }
  });
});

describe("prepisiRsdo: ciscenje pred RSDO za stikalom", { timeout: 30000 }, () => {
  /** Lazni ffmpeg zapise WAV z blokom LIST v izhodno pot; lazni stalni RSDO prebere datoteko ob prepisu. */
  async function prepis(ciscenje: boolean | undefined, rnnoise?: () => Promise<null>) {
    const izvajalec: Izvajalec = async (program, args) => {
      if (program === "ffmpeg") await writeFile(args[args.length - 1] as string, wavZListom(govor16));
      return { koda: 0, izhod: "" };
    };
    let prebrano: Buffer | null = null;
    const besedilo = await prepisiRsdo(Buffer.from("RIFFxxxxWEBM"), "audio/webm", {
      izvajalec,
      streznik: {
        pripravljen: () => true,
        prepisi: async (wav) => {
          prebrano = await readFile(wav);
          return "dober dan";
        },
      },
      ...(ciscenje === undefined ? {} : { ciscenje }),
      ...(rnnoise ? { rnnoise } : {}),
    });
    assert.equal(besedilo, "dober dan");
    assert.ok(prebrano);
    return prebrano as Buffer;
  }

  it("vklopljeno: RSDO dobi ociscen posnetek (mesanica za posnetek)", async () => {
    const m = await nalozRnnoise();
    assert.ok(m);
    assert.deepEqual(vzorci(await prepis(true)), ocistiPosnetekRnnoise(m, govor16, 16000, MESANICA_RNNOISE_POSNETEK));
  });

  it("izklopljeno, ni podano ali RNNoise ni na voljo: datoteka za RSDO je bajt za bajtom izhod ffmpeg", async () => {
    const izvirnik = wavZListom(govor16);
    assert.ok((await prepis(false)).equals(izvirnik));
    assert.ok((await prepis(undefined)).equals(izvirnik));
    assert.ok((await prepis(true, async () => null)).equals(izvirnik));
  });
});
