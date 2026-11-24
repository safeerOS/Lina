/**
 * Lina v hrupni tiskarni (naloga 24. 11. 2026, meritev zvok-hrup-1510): konec govora asistentke v hrupu, nizja obcutljivost zacetka govora v Live, mikrofon ohrani NS/AEC tudi na rezervni poti.
 * Signali so sinteticni (zvok-sinteticno.ts + udarci tiskarne); to NI pravi govor. Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { brnenje, nakljucni, sinteticniGovor, ventilator } from "./zvok-sinteticno.ts";
import { PRAG_GOVORA_RMS, ZaznavaGovora, omejitveMikrofona } from "./zvok-mikrofon.ts";
import { setupLive } from "./live/navodilo.ts";

const FS = 8000;
const TISINA_MS = 1_600;

/** Udarci tiskarne: kratki izbruhi suma (30 ms, upad 6 ms) vsakih ~0,4 s, vsak deseti glasnejsi. */
function udarci(n: number, seme = 5): Float64Array {
  const r = nakljucni(seme);
  const x = new Float64Array(n);
  for (let t = 0.2; t * FS < n; t += 0.35 + 0.1 * r()) {
    const i = Math.floor(t * FS);
    const a = r() < 0.1 ? 6 : 2.5;
    for (let k = 0; k < 0.03 * FS && i + k < n; k++) x[i + k] = a * (r() * 2 - 1) * Math.exp(-k / (0.006 * FS));
  }
  return x;
}

/** 0,5 s hruma, 2 s govora, 6 s hruma; hrup (brnenje + ventilator + udarci) zmesan na dani SNR glede na govor. Vrne float -1..1. */
function posnetek(snrDb: number | null, sekundGovora = 2): { x: Float32Array; konecGovoraS: number } {
  const pred = FS / 2;
  const dolzinaGovora = FS * sekundGovora;
  const n = pred + dolzinaGovora + FS * 6;
  const g = new Float64Array(n);
  const sg = sinteticniGovor(dolzinaGovora);
  for (let i = 0; i < dolzinaGovora; i++) g[pred + i] = (sg[i] as number) / 32768;
  let zadnji = pred;
  for (let i = pred; i < pred + dolzinaGovora; i++) if (Math.abs(g[i] as number) > 1e-4) zadnji = i;
  const konecGovoraS = (zadnji + 1) / FS;
  const x = new Float32Array(n);
  if (snrDb === null) {
    // "cisto" = tihi prostor (-70 dBFS): pravi mikrofon sredi govora ne da samih nicel
    const r = nakljucni(9);
    for (let i = 0; i < n; i++) x[i] = (g[i] as number) + (r() * 2 - 1) * 5.5e-4;
    return { x, konecGovoraS };
  }
  const b = brnenje(n);
  const v = ventilator(n);
  const u = udarci(n);
  const h = new Float64Array(n);
  const rms = (a: ArrayLike<number>, od = 0, do_ = a.length) => {
    let s = 0;
    for (let i = od; i < do_; i++) s += (a[i] as number) ** 2;
    return Math.sqrt(s / (do_ - od));
  };
  const rb = rms(b), rv = rms(v), ru = rms(u);
  for (let i = 0; i < n; i++) h[i] = (b[i] as number) / rb + (v[i] as number) / rv + (u[i] as number) / ru;
  const k = (rms(g, pred, pred + dolzinaGovora) / rms(h)) * 10 ** (-snrDb / 20);
  for (let i = 0; i < n; i++) x[i] = Math.max(-1, Math.min(1, (g[i] as number) + (h[i] as number) * k));
  return { x, konecGovoraS };
}

/** Kot pogovor.tsx: okno 32 ms vsakih ~16,7 ms, pravilo »1,6 s tisine po prvem govoru«; vrne cas konca v s ali null. */
function konec(x: Float32Array, jeGovor: (okno: Float32Array, casMs: number) => boolean): number | null {
  const okno = 256;
  let govoril = false;
  let tihoOd = -1;
  for (let i = okno; i <= x.length; i += Math.round(FS / 60)) {
    const casMs = (i / FS) * 1000;
    if (jeGovor(x.subarray(i - okno, i), casMs)) {
      govoril = true;
      tihoOd = -1;
    } else if (govoril) {
      if (tihoOd < 0) tihoOd = casMs;
      if (casMs - tihoOd > TISINA_MS) return casMs / 1000;
    }
  }
  return null;
}

const staroPravilo = (o: Float32Array) => Math.sqrt(o.reduce((s, v) => s + v * v, 0) / o.length) > PRAG_GOVORA_RMS;

describe("konec govora asistentke v hrupu tiskarne", () => {
  it("negativni dokaz: stalni prag RMS se pri 0 dB v 6 s ne konca", () => {
    const { x } = posnetek(0);
    assert.equal(konec(x, staroPravilo), null);
  });

  for (const snr of [null, 10, 5, 0]) {
    it(`nova zaznava konca: ${snr === null ? "cisto" : `${snr} dB`} - konec 1,6 do 2,6 s po koncu govora, nikoli prej`, () => {
      const { x, konecGovoraS } = posnetek(snr);
      const z = new ZaznavaGovora(FS);
      const k = konec(x, (o, t) => z.okvir(o, t));
      assert.ok(k !== null, "brez konca");
      assert.ok(k > konecGovoraS + 1.5 && k < konecGovoraS + 2.6, `konec ${k} s, govor do ${konecGovoraS} s`);
    });
  }

  // ZNANA OMEJITEV (24. 11. 2026): pri 0 dB se dolg neprekinjen stavek lahko prekine (Linini stavki pri 0 dB in 30 Hz: 4 od 20; Silero 0).
  it("dolg stavek (8 s) pri 0 dB: konec sele po govoru", { todo: "znana omejitev zaznave brez modela pri 0 dB; glej POROCILO.md" }, () => {
    const { x, konecGovoraS } = posnetek(0, 8);
    const z = new ZaznavaGovora(FS);
    const k = konec(x, (o, t) => z.okvir(o, t));
    assert.ok(k !== null && k > konecGovoraS + 1.5 && k < konecGovoraS + 2.6, `konec ${k} s, govor do ${konecGovoraS} s`);
  });

  it("samo hrup (udarci, brnenje, ventilator) ni govor", () => {
    const { x } = posnetek(0);
    const z = new ZaznavaGovora(FS);
    let govora = 0;
    // prvih 0,5 s je samo hrup; nato preskocimo govor in gledamo zadnje 4 s
    for (let i = 256; i <= x.length; i += 133) {
      const govor = z.okvir(x.subarray(i - 256, i), (i / FS) * 1000);
      if (govor && (i < FS / 2 || i > x.length - FS * 4)) govora += 1;
    }
    assert.equal(govora, 0);
  });

  it("digitalne nicle na zacetku toka ne postavijo suma na 0: sobni sum po njih ni govor", () => {
    const z = new ZaznavaGovora(48000);
    const r = nakljucni(3);
    let govora = 0;
    for (let t = 0; t < 3000; t += 17) {
      const o = new Float32Array(1024);
      // nicle, nato 100 ms postopnega vklopa (RMS -95 do -82 dBFS, kot posnetki meritve), nato sobni sum -40 dBFS
      const a = t < 400 ? 0 : t < 500 ? 10 ** ((-90 + ((t - 400) / 100) * 13) / 20) : 0.02;
      for (let i = 0; i < o.length; i++) o[i] = (r() * 2 - 1) * a;
      if (z.okvir(o, t)) govora += 1;
    }
    assert.equal(govora, 0);
  });

  it("digitalna tisina in prazen okvir nista govor (brez deljenja z 0)", () => {
    const z = new ZaznavaGovora(48000);
    for (let t = 0; t < 2000; t += 17) assert.equal(z.okvir(new Float32Array(1024), t), false);
    assert.equal(z.okvir(new Float32Array(0), 2100), false);
  });
});

describe("mikrofon: rezervna pot ohrani NS/AEC, AGC izrecno", () => {
  it("privzeta naprava in izbrana naprava imata iste obdelave", () => {
    assert.deepEqual(omejitveMikrofona(), { echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    assert.deepEqual(omejitveMikrofona("abc"), { echoCancellation: true, noiseSuppression: true, autoGainControl: true, deviceId: { exact: "abc" } });
  });
});

describe("Live: nizja obcutljivost zacetka govora za stikalom", () => {
  const osnova = { projekt: "p", sistemsko: "s" };
  it("vklopljeno: realtimeInputConfig.automaticActivityDetection.startOfSpeechSensitivity = START_SENSITIVITY_LOW (kot telefon)", () => {
    const s = setupLive({ ...osnova, zmanjsanjeHrupa: true }) as { setup: Record<string, unknown> };
    assert.deepEqual(s.setup.realtimeInputConfig, { automaticActivityDetection: { startOfSpeechSensitivity: "START_SENSITIVITY_LOW" } });
  });
  it("izklopljeno ali brez nastavitve: setup enak kot prej (brez realtimeInputConfig)", () => {
    assert.deepEqual(setupLive({ ...osnova, zmanjsanjeHrupa: false }), setupLive(osnova));
    assert.equal("realtimeInputConfig" in (setupLive(osnova) as { setup: object }).setup, false);
  });
});
