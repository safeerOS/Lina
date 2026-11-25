/**
 * Naloga 17a (25. 11. 2026): RNNoise (WASM, vendor/rnnoise-wasm) pred prepoznavo. Preizkusi modula zvok-rnnoise.server.ts:
 * nalaganje v Node brez ostankov, pretvorba 8/16 kHz <-> 48 kHz (okvir 480), stalna zakasnitev, tokovnost, poravnava mesanice
 * ociscenega in surovega zvoka (sicer glavnikasti filter), zmanjsanje stalnega suma, unicenje stanja. Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CiscenjeRnnoise,
  PolifazniPrevzorcevalnik,
  ZAMIK_RNNOISE_48K,
  nalozRnnoise,
  nalozRnnoiseIz,
  ocistiPosnetekRnnoise,
  ocistiPosnetekRnnoiseAsinhrono,
  type RnnoiseModul,
} from "./zvok-rnnoise.server.ts";
import { Prevzorcevalnik } from "./live/zvok.ts";
import { belSum, sinteticniGovor, zmesaj } from "./zvok-sinteticno.ts";

function ton(n: number, fs: number, frekvence: number[], amp = 6000): Int16Array {
  const y = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (const f of frekvence) v += Math.sin((2 * Math.PI * f * i) / fs);
    y[i] = Math.round((amp / frekvence.length) * v);
  }
  return y;
}

/** Govoru podoben signal: harmoniki f0 (120-180 Hz) z zlogi 4 Hz. */
function harmonicni(n: number, fs: number): Int16Array {
  const y = new Int16Array(n);
  let faza = 0;
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const f0 = 150 + 30 * Math.sin(2 * Math.PI * 0.7 * t);
    faza += (2 * Math.PI * f0) / fs;
    let v = 0;
    for (let h = 1; h * f0 < Math.min(3400, fs / 2 - 200); h++) v += Math.sin(h * faza) / h;
    const zlog = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t);
    y[i] = Math.round(5000 * zlog * v);
  }
  return y;
}

function snrPoZamiku(vhod: Int16Array, izhod: Int16Array, zamik: number, od: number): number {
  let s = 0;
  let e = 0;
  for (let i = od; i + zamik < izhod.length; i++) {
    const c = vhod[i] as number;
    s += c * c;
    e += ((izhod[i + zamik] as number) - c) ** 2;
  }
  return 10 * Math.log10((s + 1e-9) / (e + 1e-9));
}

function poKosih(c: CiscenjeRnnoise, x: Int16Array, dolzine: number[]): Int16Array {
  const ven = new Int16Array(x.length);
  let i = 0;
  let k = 0;
  while (i < x.length) {
    const d = Math.min(dolzine[k++ % dolzine.length] as number, x.length - i);
    const y = c.obdelaj(x.subarray(i, i + d));
    assert.equal(y.length, d, "vsak klic vrne natanko toliko vzorcev, kot jih je dobil");
    ven.set(y, i);
    i += d;
  }
  return ven;
}

const rms = (a: Int16Array, od: number, do_ = a.length): number => {
  let s = 0;
  for (let i = od; i < do_; i++) s += (a[i] as number) ** 2;
  return Math.sqrt(s / Math.max(1, do_ - od));
};

/** Nadomestek RNNoise: zakasni okvirje za ZAMIK_RNNOISE_48K (kot pravi), brez ciscenja; steje unicenja. */
function lazniModul(stevec: { unicenih: number; okvirjev: number }): RnnoiseModul {
  return {
    frameSize: 480,
    createDenoiseState() {
      const vrsta = new Float32Array(ZAMIK_RNNOISE_48K + 480);
      return {
        processFrame(f: Float32Array): number {
          stevec.okvirjev += 1;
          vrsta.copyWithin(0, 480);
          vrsta.set(f, ZAMIK_RNNOISE_48K);
          f.set(vrsta.subarray(0, 480));
          return 0;
        },
        destroy() {
          stevec.unicenih += 1;
        },
      };
    },
  };
}

describe("RNNoise: nalaganje v Node", () => {
  it("nalozi pravi WASM (okvir 480) brez ostanka WorkerGlobalScope; drugi klic vrne isti modul", async () => {
    assert.equal("WorkerGlobalScope" in globalThis, false);
    const m = await nalozRnnoise();
    assert.ok(m, "RNNoise se nalozi");
    assert.equal(m.frameSize, 480);
    assert.equal("WorkerGlobalScope" in globalThis, false, "zacasni nadomestek ne ostane");
    assert.ok((await nalozRnnoise()) === m, "drugi klic vrne isti modul"); // assert.ok: izpis modula WASM ob padcu = OOM
  });

  it("napaka nalaganja vrne null (klic gre naprej po stari poti), nadomestek ne ostane", async () => {
    assert.ok(await nalozRnnoiseIz(async () => { throw new Error("ni modula"); }) === null, "napaka uvoza = null");
    assert.ok(await nalozRnnoiseIz(async () => ({ Rnnoise: { load: () => Promise.reject(new Error("wasm")) } })) === null, "napaka load = null");
    assert.equal("WorkerGlobalScope" in globalThis, false);
  });
});

describe("PolifazniPrevzorcevalnik: enak izhod kot Prevzorcevalnik (live/zvok.ts)", () => {
  for (const [a, b] of [[8000, 48000], [48000, 8000], [16000, 48000], [48000, 16000]] as const) {
    it(`${a} -> ${b} Hz: isto stevilo vzorcev, razlika najvec 1 (zaokrozevanje), kosi poljubne dolzine`, () => {
      const x = harmonicni(a / 2, a);
      const pp = new PolifazniPrevzorcevalnik(a, b);
      const pr = new Prevzorcevalnik(a, b);
      const deli: number[] = [];
      const ref: number[] = [];
      for (let i = 0, k = 0; i < x.length; k++) {
        const d = Math.min([160, 1, 333, 7][k % 4] as number, x.length - i);
        deli.push(...pp.process(x.subarray(i, i + d)));
        ref.push(...pr.process(x.subarray(i, i + d)));
        i += d;
      }
      assert.equal(deli.length, ref.length);
      let r = 0;
      for (let i = 0; i < ref.length; i++) r = Math.max(r, Math.abs((deli[i] as number) - (ref[i] as number)));
      assert.ok(r <= 1, `najvecja razlika ${r}`);
    });
  }
  it("zavrne necelo razmerje", () => {
    assert.throws(() => new PolifazniPrevzorcevalnik(44100, 48000));
  });
});

describe("RNNoise: pretvorba frekvence in zakasnitev", () => {
  for (const fs of [8000, 16000] as const) {
    it(`${fs} Hz: brez ociscenega dela (mesanica 0) gre signal skozi 48 kHz in nazaj z zakasnitvijo ${fs === 8000 ? 280 : 520} vzorcev (35 / 32,5 ms), SNR > 35 dB`, async () => {
      const m = await nalozRnnoise();
      assert.ok(m);
      const c = new CiscenjeRnnoise(m, { frekvenca: fs, mesanica: 0 });
      assert.equal(c.zakasnitev, fs === 8000 ? 280 : 520);
      const x = ton(fs * 2, fs, [300, 1000, 2900]);
      const y = poKosih(c, x, [160, 7, 333, 1, 480]);
      assert.ok(snrPoZamiku(x, y, c.zakasnitev, fs / 4) > 35, `SNR ${snrPoZamiku(x, y, c.zakasnitev, fs / 4).toFixed(1)} dB`);
      assert.equal(c.podtekov, 0, "izhodna vrsta nikoli ne ostane brez vzorcev");
      c.unici();
    });
  }

  it("8 kHz: mesanica 0,5 z nadomestkom, ki zakasni kot RNNoise, je enaka surovi poti (poravnava, brez glavnika)", () => {
    const st = { unicenih: 0, okvirjev: 0 };
    const x = harmonicni(16000, 8000);
    const a = poKosih(new CiscenjeRnnoise(lazniModul(st), { frekvenca: 8000, mesanica: 0.5 }), x, [160]);
    const b = poKosih(new CiscenjeRnnoise(lazniModul(st), { frekvenca: 8000, mesanica: 0 }), x, [160]);
    let razlika = 0;
    for (let i = 0; i < a.length; i++) razlika = Math.max(razlika, Math.abs((a[i] as number) - (b[i] as number)));
    assert.ok(razlika <= 1, `najvecja razlika ${razlika}`);
    assert.ok(st.okvirjev > 0);
  });

  it("pravi RNNoise: ocisceni del je poravnan s surovim (najvecja korelacija pri zakasnitvi +-1 vzorec)", async () => {
    const m = await nalozRnnoise();
    assert.ok(m);
    const c = new CiscenjeRnnoise(m, { frekvenca: 16000, mesanica: 1 });
    const x = harmonicni(16000 * 3, 16000);
    const y = poKosih(c, x, [320]);
    let najboljsi = -1;
    let zamik = -1;
    for (let l = c.zakasnitev - 40; l <= c.zakasnitev + 40; l++) {
      let s = 0;
      let a = 0;
      let b = 0;
      for (let i = 8000; i + l < y.length; i++) {
        s += (x[i] as number) * (y[i + l] as number);
        a += (x[i] as number) ** 2;
        b += (y[i + l] as number) ** 2;
      }
      const k = s / Math.sqrt(a * b + 1e-9);
      if (k > najboljsi) {
        najboljsi = k;
        zamik = l;
      }
    }
    assert.ok(Math.abs(zamik - c.zakasnitev) <= 1, `zamik ${zamik}, pricakovano ${c.zakasnitev}`);
    // Izmerjeno 0,30: RNNoise sinteticni harmonski signal mocno spremeni; preizkus meri polozaj vrha, ne kakovosti.
    assert.ok(najboljsi > 0.2, `korelacija ${najboljsi.toFixed(2)}`);
  });

  it("kosi poljubne dolzine (tudi 0 in 1) dajo isti izhod kot en sam kos", async () => {
    const m = await nalozRnnoise();
    assert.ok(m);
    const x = zmesaj(sinteticniGovor(8000 * 2), belSum(8000 * 2), 5);
    const a = poKosih(new CiscenjeRnnoise(m, { frekvenca: 8000, mesanica: 0.5 }), x, [x.length]);
    const c = new CiscenjeRnnoise(m, { frekvenca: 8000, mesanica: 0.5 });
    assert.equal(c.obdelaj(new Int16Array(0)).length, 0);
    const b = poKosih(c, x, [1, 159, 160, 37, 800]);
    assert.deepEqual(b, a);
  });
});

describe("RNNoise: ciscenje", () => {
  it("stalen sum brez govora: polno ciscenje ga zmanjsa za vsaj 10 dB, mesanica 0,5 za vsaj 4 dB", async () => {
    const m = await nalozRnnoise();
    assert.ok(m);
    const sum = belSum(16000 * 3);
    const x = Int16Array.from(sum, (v) => Math.round(v * 1500));
    for (const [mes, prag] of [[1, 10], [0.5, 4]] as const) {
      const y = ocistiPosnetekRnnoise(m, x, 16000, mes);
      assert.equal(y.length, x.length);
      const db = 20 * Math.log10(rms(x, 8000) / (rms(y, 8000) + 1e-9));
      assert.ok(db >= prag, `mesanica ${mes}: ${db.toFixed(1)} dB`);
    }
  });

  it("posnetek: poravnan z vhodom (brez zakasnitve), asinhrona razlicica da isti izid; tisina ostane tisina, meje int16", async () => {
    const m = await nalozRnnoise();
    assert.ok(m);
    const x = ton(16000, 16000, [500, 1500]);
    const y = ocistiPosnetekRnnoise(m, x, 16000, 0);
    assert.ok(snrPoZamiku(x, y, 0, 2000) > 35);
    assert.deepEqual(await ocistiPosnetekRnnoiseAsinhrono(m, x, 16000, 0.5), ocistiPosnetekRnnoise(m, x, 16000, 0.5));
    const tisina = ocistiPosnetekRnnoise(m, new Int16Array(16000), 16000, 0.5);
    assert.ok(tisina.every((v) => v === 0));
    const polno = Int16Array.from({ length: 16000 }, (_v, i) => (i % 2 ? 32767 : -32768));
    const p = ocistiPosnetekRnnoise(m, polno, 16000, 0.5);
    assert.ok(p.every((v) => v >= -32768 && v <= 32767 && Number.isInteger(v)));
  });

  it("unici sprosti stanje RNNoise natanko enkrat; po unicenju obdelaj vrne vhod nespremenjen", () => {
    const st = { unicenih: 0, okvirjev: 0 };
    const c = new CiscenjeRnnoise(lazniModul(st), { frekvenca: 8000, mesanica: 0.5 });
    c.unici();
    c.unici();
    assert.equal(st.unicenih, 1);
    const x = ton(160, 8000, [400]);
    assert.deepEqual(c.obdelaj(x), x);
  });

  it("neveljavna frekvenca ali mesanica se zavrne oz. omeji na 0..1", () => {
    const st = { unicenih: 0, okvirjev: 0 };
    assert.throws(() => new CiscenjeRnnoise(lazniModul(st), { frekvenca: 44100 as 8000 }));
    assert.equal(new CiscenjeRnnoise(lazniModul(st), { frekvenca: 8000, mesanica: 7 }).mesanica, 1);
    assert.equal(new CiscenjeRnnoise(lazniModul(st), { frekvenca: 8000, mesanica: Number.NaN }).mesanica, 0.5);
  });
});
