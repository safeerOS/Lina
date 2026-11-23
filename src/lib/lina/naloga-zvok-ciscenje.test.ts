/**
 * Preizkusi cistenja zvoka 8 kHz (zvok-ciscenje.ts): tokovnost, zakasnitev, SNR na sinteticnih signalih, govor ostane,
 * neveljavne nastavitve, meje int16. Merjene vrednosti (sinteticni govor, 6 s, od 1 s naprej): bel sum 5 dB: +3,3 dB; ventilator
 * 5 dB: +4,3 dB; brnenje 5 dB: +10,3 dB; mesan 5 dB: +3,6 dB; cisti govor 23,9 dB; samo bel sum -7,7 dB. Pragi so pod merjenim.
 * To NI dokaz boljsega razumevanja pri Gemini (NEPREVERJENO na pravih klicih). Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CiscenjeZvoka8k, KORAK, OKVIR_FFT, ZAKASNITEV_VZORCEV, izmeriSnrDb, ocistiPosnetek } from "./zvok-ciscenje.ts";
import { belSum, brnenje, sinteticniGovor, ventilator, zmesaj } from "./zvok-sinteticno.ts";

const N = 8000 * 6;
const OD = 8000;
const govor = sinteticniGovor(N);

function skozi(zasumljen: Int16Array, nast = {}): Int16Array {
  return ocistiPosnetek(zasumljen, nast);
}

function izboljsava(zasumljen: Int16Array, nast = {}): number {
  const po = skozi(zasumljen, nast);
  return izmeriSnrDb(govor.subarray(OD), po.subarray(OD)) - izmeriSnrDb(govor.subarray(OD), zasumljen.subarray(OD));
}

const energija = (a: Int16Array, od: number): number => a.subarray(od).reduce((s, x) => s + x * x, 0) / (a.length - od);

describe("cistenje zvoka: oblika in tokovnost", () => {
  it("konstante: okno 256, korak 128, zakasnitev 256 vzorcev (32 ms)", () => {
    assert.equal(OKVIR_FFT, 256);
    assert.equal(KORAK, 128);
    assert.equal(ZAKASNITEV_VZORCEV, 256);
  });

  it("vsak klic vrne natanko toliko vzorcev, kot jih je dobil (tudi prazen in en vzorec)", () => {
    const c = new CiscenjeZvoka8k();
    for (const n of [0, 1, 7, 160, 333, 1000, 5, 127, 128, 129]) assert.equal(c.obdelaj(new Int16Array(n).fill(100)).length, n, String(n));
  });

  it("tisina na vhodu je tisina na izhodu (natanko 0)", () => {
    const izhod = new CiscenjeZvoka8k().obdelaj(new Int16Array(20000));
    assert.equal(
      izhod.every((v) => v === 0),
      true,
    );
  });

  it("kosi poljubne dolzine dajo ISTI izhod kot celota", () => {
    const vhod = zmesaj(govor.subarray(0, 12000), belSum(12000), 5);
    const celota = new CiscenjeZvoka8k().obdelaj(vhod);
    for (const velikosti of [[160], [1], [7, 333, 1, 160], [128], [129, 127]]) {
      const c = new CiscenjeZvoka8k();
      const deli: number[] = [];
      let poz = 0;
      for (let i = 0; poz < vhod.length; i++) {
        const v = velikosti[i % velikosti.length] as number;
        deli.push(...c.obdelaj(vhod.subarray(poz, poz + v)));
        poz += v;
      }
      assert.deepEqual(Int16Array.from(deli), celota, velikosti.join(","));
    }
  });

  it("impulz pride ven ob zakasnitvi 256 in nespremenjen (uvodnih 16 okvirjev ne ukrepa)", () => {
    const vhod = new Int16Array(4000);
    vhod[1000] = 10000;
    const izhod = new CiscenjeZvoka8k().obdelaj(Int16Array.from([...vhod, ...new Int16Array(ZAKASNITEV_VZORCEV)]));
    assert.ok(Math.abs((izhod[1000 + ZAKASNITEV_VZORCEV] as number) - 10000) <= 1, String(izhod[1000 + ZAKASNITEV_VZORCEV]));
    for (let i = 0; i < izhod.length; i++) if (i !== 1000 + ZAKASNITEV_VZORCEV) assert.ok(Math.abs(izhod[i] as number) <= 1, `${i}: ${izhod[i]}`);
  });

  it("vhodna tabela se ne spremeni; izhod je nova tabela", () => {
    const vhod = zmesaj(govor.subarray(0, 4000), belSum(4000), 5);
    const kopija = Int16Array.from(vhod);
    const izhod = new CiscenjeZvoka8k().obdelaj(vhod);
    assert.deepEqual(vhod, kopija);
    assert.notEqual(izhod.buffer, vhod.buffer);
  });

  it("dva objekta sta neodvisna (izmenicni klici dajo enak izhod kot vsak sam)", () => {
    const a = zmesaj(govor.subarray(0, 8000), belSum(8000, 1), 5);
    const b = zmesaj(govor.subarray(8000, 16000), ventilator(8000, 2), 5);
    const sama = [new CiscenjeZvoka8k().obdelaj(a), new CiscenjeZvoka8k().obdelaj(b)];
    const x = new CiscenjeZvoka8k();
    const y = new CiscenjeZvoka8k();
    const ia: number[] = [];
    const ib: number[] = [];
    for (let p = 0; p < 8000; p += 160) {
      ia.push(...x.obdelaj(a.subarray(p, p + 160)));
      ib.push(...y.obdelaj(b.subarray(p, p + 160)));
    }
    assert.deepEqual(Int16Array.from(ia), sama[0]);
    assert.deepEqual(Int16Array.from(ib), sama[1]);
  });

  it("reset vrne objekt v zacetno stanje", () => {
    const vhod = zmesaj(govor.subarray(0, 10000), belSum(10000), 5);
    const c = new CiscenjeZvoka8k();
    c.obdelaj(zmesaj(govor.subarray(10000, 30000), ventilator(20000), 0));
    c.reset();
    assert.deepEqual(c.obdelaj(vhod), new CiscenjeZvoka8k().obdelaj(vhod));
  });
});

describe("cistenje zvoka: izmerjeni ucinek na sinteticnih signalih", () => {
  it("bel sum 5 dB: SNR se izboljsa vsaj za 2,5 dB", () => {
    assert.ok(izboljsava(zmesaj(govor, belSum(N), 5)) >= 2.5);
  });

  it("ventilator 5 dB: izboljsava vsaj 3 dB", () => {
    assert.ok(izboljsava(zmesaj(govor, ventilator(N), 5)) >= 3);
  });

  it("brnenje 50 Hz 5 dB: izboljsava vsaj 8 dB", () => {
    assert.ok(izboljsava(zmesaj(govor, brnenje(N), 5)) >= 8);
  });

  it("mesan sum 5 dB: izboljsava vsaj 2,5 dB", () => {
    const b = belSum(N);
    const v = ventilator(N, 3);
    const h = brnenje(N);
    const s = Float64Array.from({ length: N }, (_x, i) => 0.5 * (b[i] as number) + (v[i] as number) + 0.15 * (h[i] as number));
    assert.ok(izboljsava(zmesaj(govor, s, 5)) >= 2.5);
  });

  it("bel sum 0 dB: se vedno izboljsa vsaj za 3 dB", () => {
    assert.ok(izboljsava(zmesaj(govor, belSum(N), 0)) >= 3);
  });

  it("cisti govor ostane: SNR proti izvirniku vsaj 18 dB", () => {
    const po = skozi(govor);
    assert.ok(izmeriSnrDb(govor.subarray(OD), po.subarray(OD)) >= 18);
  });

  it("samo sum: energija po prvi sekundi pade vsaj za 6 dB", () => {
    const sum = Int16Array.from(belSum(N, 5), (x) => Math.round(x * 800));
    const po = skozi(sum);
    assert.ok(10 * Math.log10(energija(sum, 16000) / energija(po, 16000)) >= 6);
  });

  it("izklopljeno tlo (0 dB) pusti signal nespremenjen (samo zakasnjen)", () => {
    const vhod = zmesaj(govor.subarray(0, 20000), belSum(20000), 5);
    const izhod = skozi(vhod, { tloDb: 0 });
    for (let i = 0; i < vhod.length; i++) assert.ok(Math.abs((izhod[i] as number) - (vhod[i] as number)) <= 1, String(i));
  });

  it("vecja moc in nizje tlo odstranita vec suma", () => {
    const sum = Int16Array.from(belSum(N, 5), (x) => Math.round(x * 800));
    const e = (nast: object) => energija(skozi(sum, nast), 16000);
    assert.ok(e({ moc: 2.5 }) < e({ moc: 0.6 }));
    assert.ok(e({ tloDb: -30 }) < e({ tloDb: -6 }));
  });
});

describe("cistenje zvoka: neveljavne nastavitve in robni primeri", () => {
  const vhod = zmesaj(govor.subarray(0, 24000), belSum(24000), 5);
  const privzeto = new CiscenjeZvoka8k().obdelaj(vhod);

  it("NaN, nizi in neskoncno dajo privzeto vedenje", () => {
    for (const nast of [{ moc: Number.NaN }, { moc: "x" as unknown as number }, { tloDb: Number.NaN }, { moc: undefined }, {}]) assert.deepEqual(new CiscenjeZvoka8k(nast).obdelaj(vhod), privzeto);
  });

  it("vrednosti zunaj meja se omejijo na mejo", () => {
    assert.deepEqual(new CiscenjeZvoka8k({ moc: 99 }).obdelaj(vhod), new CiscenjeZvoka8k({ moc: 3 }).obdelaj(vhod));
    assert.deepEqual(new CiscenjeZvoka8k({ moc: -4 }).obdelaj(vhod), new CiscenjeZvoka8k({ moc: 0.5 }).obdelaj(vhod));
    assert.deepEqual(new CiscenjeZvoka8k({ tloDb: -100 }).obdelaj(vhod), new CiscenjeZvoka8k({ tloDb: -30 }).obdelaj(vhod));
    assert.deepEqual(new CiscenjeZvoka8k({ tloDb: 12 }).obdelaj(vhod), new CiscenjeZvoka8k({ tloDb: 0 }).obdelaj(vhod));
  });

  it("najglasnejsi vhod (pravokotnik +-32767/-32768, enosmerna komponenta) ostane v mejah int16 brez izjeme", () => {
    const pravokotnik = Int16Array.from({ length: 20000 }, (_v, i) => (Math.floor(i / 20) % 2 === 0 ? 32767 : -32768));
    const enosmerno = new Int16Array(20000).fill(32767);
    for (const v of [pravokotnik, enosmerno]) {
      const izhod = new CiscenjeZvoka8k().obdelaj(v);
      assert.equal(izhod.length, v.length);
      for (const x of izhod) assert.ok(Number.isInteger(x) && x >= -32768 && x <= 32767);
    }
  });

  it("ocistiPosnetek: enako dolg in poravnan (cisti govor brez premika, SNR vsaj 18 dB); prazen vhod daje prazen izhod", () => {
    const po = ocistiPosnetek(govor);
    assert.equal(po.length, govor.length);
    assert.ok(izmeriSnrDb(govor.subarray(OD), po.subarray(OD)) >= 18);
    assert.equal(ocistiPosnetek(new Int16Array(0)).length, 0);
  });
});

describe("izmeriSnrDb", () => {
  it("znane vrednosti", () => {
    assert.ok(Math.abs(izmeriSnrDb([100, 0], [90, 0]) - 20) < 1e-6);
    assert.ok(izmeriSnrDb([5, 6, 7], [5, 6, 7]) > 100);
    assert.equal(izmeriSnrDb([1e6, 1e6], [1e6, 1e6]), 120);
    assert.ok(izmeriSnrDb([100, 100], [0, 0]) < 1e-6 && izmeriSnrDb([100, 100], [0, 0]) > -1e-6);
  });

  it("razlicni dolzini vrzeta", () => {
    assert.throws(() => izmeriSnrDb([1, 2], [1]), /enaki/);
  });
});
