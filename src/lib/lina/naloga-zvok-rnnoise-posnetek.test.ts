/**
 * Naloga 17a/17d, pot (a): posnetek asistentke -> ffmpeg (16 kHz WAV) -> 16 -> 8 kHz, Wiener, RNNoise 8 kHz 50/50, 8 -> 16 kHz
 * (17d, w8_rnn50) -> RSDO (namig za Gemini). ffmpeg zapise blok LIST
 * pred data (preverjeno z ffmpeg 6, 25. 11. 2026), zato razclenjevalnik isce bloke. Stikalo »Zmanjsanje hrupa« izklopljeno ali
 * RNNoise ni na voljo = datoteka za RSDO nespremenjena. Gemini dobi izvirni posnetek (ta pot ga ne spremeni). Brez omrezja.
 * Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { Prevzorcevalnik } from "./live/zvok.ts";
import { prepisiRsdo, type Izvajalec } from "./rsdo-motor.server.ts";
import { CiscenjeZvoka8k, ZAKASNITEV_VZORCEV } from "./zvok-ciscenje.ts";
import { CiscenjeRnnoise, MESANICA_RNNOISE_POSNETEK, nalozRnnoise, ocistiPosnetekRnnoise, ocistiWav16k, type RnnoiseModul } from "./zvok-rnnoise.server.ts";
import { belSum, sinteticniGovor, zmesaj } from "./zvok-sinteticno.ts";

/**
 * Naloga 17d: referenca verige w8_rnn50 iz gradnikov, korak za korakom kot meritev 17c (obdelaj17c.mjs, OZKO): rep 1600 vzorcev tisine,
 * 16 -> 8 kHz, Wiener, RNNoise 8 kHz z mesanico, zakasnitev odstranjena, 8 -> 16 kHz, dolzina kot vhod.
 */
function referencaOzko(m: RnnoiseModul, x: Int16Array, mesanica: number, wiener = true): Int16Array {
  const rep = new Int16Array(x.length + 1600);
  rep.set(x);
  const x8 = new Prevzorcevalnik(16000, 8000).process(rep);
  const w = new CiscenjeZvoka8k();
  const r = new CiscenjeRnnoise(m, { frekvenca: 8000, mesanica });
  const zamik = (wiener ? ZAKASNITEV_VZORCEV : 0) + r.zakasnitev;
  const v = new Int16Array(x8.length + zamik);
  v.set(x8);
  const y8 = new Int16Array(v.length);
  for (let i = 0; i < v.length; i += 160) {
    const kos = v.subarray(i, Math.min(v.length, i + 160));
    y8.set(r.obdelaj(wiener ? w.obdelaj(kos) : kos), i);
  }
  r.unici();
  return new Prevzorcevalnik(8000, 16000).process(y8.subarray(zamik)).slice(0, x.length);
}

/** Stevilo razlicnih vzorcev (skalar, brez izpisa tabel); razlika v dolzini steje kot razlika. */
function razlik(a: Int16Array, b: Int16Array): number {
  let n = Math.abs(a.length - b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) n++;
  return n;
}

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

  it("naloga 17d: vklopljeno - RSDO dobi 16 -> 8 kHz, Wiener, RNNoise 8 kHz 50/50, 8 -> 16 kHz (w8_rnn50), enako dolg posnetek", async () => {
    const m = await nalozRnnoise();
    assert.ok(m);
    const dobljeno = vzorci(await prepis(true));
    const ref = referencaOzko(m, govor16, MESANICA_RNNOISE_POSNETEK);
    assert.equal(dobljeno.length, govor16.length, "enako stevilo vzorcev kot izhod ffmpeg");
    assert.equal(razlik(dobljeno, ref), 0, "pot (a) ne gre skozi 8 kHz Wiener in RNNoise 50/50");
  });

  it("naloga 17d: kontrola - referenca se loci od RNNoise 16 kHz in od verige 8 kHz brez Wienerja", async () => {
    const m = await nalozRnnoise();
    assert.ok(m);
    const ref = referencaOzko(m, govor16, MESANICA_RNNOISE_POSNETEK);
    assert.ok(razlik(ref, ocistiPosnetekRnnoise(m, govor16, 16000, MESANICA_RNNOISE_POSNETEK)) > 1000, "ni isto kot RNNoise 16 kHz");
    assert.ok(razlik(ref, referencaOzko(m, govor16, MESANICA_RNNOISE_POSNETEK, false)) > 1000, "ni isto kot 8 kHz brez Wienerja");
  });

  it("izklopljeno, ni podano ali RNNoise ni na voljo: datoteka za RSDO je bajt za bajtom izhod ffmpeg", async () => {
    const izvirnik = wavZListom(govor16);
    assert.ok((await prepis(false)).equals(izvirnik));
    assert.ok((await prepis(undefined)).equals(izvirnik));
    assert.ok((await prepis(true, async () => null)).equals(izvirnik));
  });

  it("pregled 0213 C3: ociscen glas je v NOVI datoteki 0600 (ffmpeg jo je ustvaril 0644 po umask), ne prepisan cez izvirnik", async () => {
    let nacin = -1;
    let ino = -1;
    let inoFfmpeg = -2;
    const { chmod, stat } = await import("node:fs/promises");
    const izvajalec: Izvajalec = async (program, args) => {
      if (program === "ffmpeg") {
        const w = args[args.length - 1] as string;
        await writeFile(w, wavZListom(govor16), { mode: 0o644 });
        await chmod(w, 0o644);
        inoFfmpeg = (await stat(w)).ino;
      }
      return { koda: 0, izhod: "" };
    };
    const besedilo = await prepisiRsdo(Buffer.from("RIFFxxxxWEBM"), "audio/webm", {
      izvajalec,
      ciscenje: true,
      streznik: {
        pripravljen: () => true,
        prepisi: async (wav) => {
          const s = await stat(wav);
          nacin = s.mode & 0o777;
          ino = s.ino;
          return "dober dan";
        },
      },
    });
    assert.equal(besedilo, "dober dan");
    assert.equal(nacin, 0o600, "ociscen glas klicatelja samo za lastnika");
    assert.notEqual(ino, inoFfmpeg, "zapis v novo datoteko in rename (okrnjen zapis ne zamenja izvirnika)");
  });

  it("pregled 0213 C5: stikalo vklopljeno, RNNoise ni na voljo - pot RSDO to zapise v dnevnik (kot zivi klic)", async () => {
    const dn: string[] = [];
    const izvajalec: Izvajalec = async (program, args) => {
      if (program === "ffmpeg") await writeFile(args[args.length - 1] as string, wavZListom(govor16));
      return { koda: 0, izhod: "" };
    };
    await prepisiRsdo(Buffer.from("RIFFxxxxWEBM"), "audio/webm", {
      izvajalec, ciscenje: true, rnnoise: async () => null, dnevnik: (s) => void dn.push(s),
      streznik: { pripravljen: () => true, prepisi: async () => "x" },
    } as Parameters<typeof prepisiRsdo>[2]);
    assert.deepEqual(dn, ["rnnoise-ni-na-voljo"]);
  });
});
