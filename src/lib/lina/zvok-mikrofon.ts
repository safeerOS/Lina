/**
 * Mikrofon asistentke na racunalniku (pogovor.tsx): zaznava govora za konec posnetka, odporna na hrup tiskarne, in omejitve
 * getUserMedia. Meritev 24. 11. 2026 (zvok-hrup-1510/POROCILO.md): stalni prag RMS 0,035 se pri 0 dB SNR v 6 s ne konca na
 * 7 od 12 posnetkov. Brez modela in brez odvisnosti (Silero VAD bi bil nova knjiznica; odlocitev lastnika):
 * - pasovne moci 200-2000 Hz (sumenje papirja je visje, brnenje omrezja in motorja nizje);
 * - sum vsakega pasu = najmanjse POVPRECJE 250-ms odsekov zadnjih 2 s (najmanjse statistike po odsekih: en prehodni okvir,
 *   npr. ob vklopu mikrofona, oceno ne pokvari), zato stalni hrup ni govor;
 * - okvir je glasen, ce je v vsaj 3 pasovih glajena moc 3x (4,8 dB) nad sumom;
 * - govor sele, ko je glasno neprekinjeno vsaj 90 ms: udarci tiskarne (~30 ms) zato niso govor;
 * - in raven okvirja nad -40 dBFS (NAJMANJSA_RAVEN);
 * - digitalna tisina (pod -120 dBFS, zacetek toka) ne vstopi v oceno suma; dokler ni prvega celega odseka (250 ms), govora ni.
 * Tokovno, cista funkcija (cas podaja klicatelj), brez omrezja in diska. Komentarji so brez sumnikov.
 */

/** Stari stalni prag (pogovor.tsx do 24. 11. 2026); velja, ko je zmanjsanje hrupa izklopljeno. */
export const PRAG_GOVORA_RMS = 0.035;

const OD_HZ = 200;
const DO_HZ = 2000;
const PASOV = 10;
const ZGODOVINA_MS = 2_000;
const ODSEK_MS = 250;
const NAD_SUMOM = 3;
const NAJMANJ_PASOV = 3;
const NEPREKINJENO_MS = 90;
/** Glajenje moci: polovica stare vrednosti na vsakih 16,7 ms (60 Hz), casovno, da je enako pri 30, 60 ali 144 Hz. */
const POLCAS_GLAJENJA_MS = 1000 / 60;
/**
 * Najmanjsa raven okvirja (RMS) za govor, -40 dBFS: 3,5x pod starim pragom, zato v tihem prostoru konec ni nikoli kasnejsi kot
 * prej; sobni sum, ki ob vklopu mikrofona narasca (AGC) in mu ocena suma sledi sele v 2 s, zato ni govor.
 */
export const NAJMANJSA_RAVEN = 0.01;
/** Pod tem (moc na vzorec, -120 dBFS) je okvir digitalna tisina: ni govor in ne vstopi v oceno suma. */
const NAJMANJSA_MOC = 1e-12;

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] as number, re[i] as number];
      [im[i], im[j]] = [im[j] as number, im[i] as number];
    }
  }
  for (let d = 2; d <= n; d <<= 1) {
    const kot = (-2 * Math.PI) / d;
    for (let z = 0; z < n; z += d) {
      for (let k = 0; k < d / 2; k++) {
        const wr = Math.cos(kot * k), wi = Math.sin(kot * k);
        const a = z + k, b = a + d / 2;
        const xr = (re[b] as number) * wr - (im[b] as number) * wi;
        const xi = (re[b] as number) * wi + (im[b] as number) * wr;
        re[b] = (re[a] as number) - xr;
        im[b] = (im[a] as number) - xi;
        re[a] = (re[a] as number) + xr;
        im[a] = (im[a] as number) + xi;
      }
    }
  }
}

export class ZaznavaGovora {
  private readonly hitrost: number;
  private glajena: number[] | null = null;
  private zadnjiCas = 0;
  /** Povprecja koncanih odsekov (cas konca odseka). */
  private zgodovina: { cas: number; moci: number[] }[] = [];
  private odsek: { od: number; vsota: number[]; okvirjev: number } | null = null;
  private glasnoOd = -1;

  constructor(hitrost: number) {
    this.hitrost = hitrost;
  }

  /** Okvir casovnih vzorcev (-1..1) ob casu casMs; vrne true, ce je to govor. */
  okvir(vzorci: Float32Array, casMs: number): boolean {
    let n = 1;
    while (n * 2 <= vzorci.length) n *= 2;
    if (n < 64) return false;
    const zamik = vzorci.length - n;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    let moc = 0;
    for (let i = 0; i < n; i++) {
      const v = vzorci[zamik + i] as number;
      moc += v * v;
      re[i] = v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
    }
    // Digitalna tisina (zacetek toka, odklopljen mikrofon) ni ocena suma: sicer bi bil sum 2 s enak 0 in sobni sum po njej govor.
    if (moc / n <= NAJMANJSA_MOC) {
      this.glasnoOd = -1;
      return false;
    }
    fft(re, im);
    const naBin = this.hitrost / n;
    const meje = Array.from({ length: PASOV + 1 }, (_v, p) => OD_HZ * (DO_HZ / OD_HZ) ** (p / PASOV));
    const moci = new Array<number>(PASOV).fill(0);
    for (let p = 0; p < PASOV; p++) {
      const od = Math.max(1, Math.round((meje[p] as number) / naBin));
      const doBin = Math.min(n / 2, Math.max(od + 1, Math.round((meje[p + 1] as number) / naBin)));
      for (let k = od; k < doBin; k++) moci[p] = (moci[p] as number) + (re[k] as number) ** 2 + (im[k] as number) ** 2;
      moci[p] = (moci[p] as number) / (doBin - od);
    }
    const a = 0.5 ** (Math.max(0, casMs - this.zadnjiCas) / POLCAS_GLAJENJA_MS);
    const g = this.glajena ? moci.map((m, p) => a * (this.glajena?.[p] as number) + (1 - a) * m) : moci;
    this.glajena = g;
    this.zadnjiCas = casMs;
    while (this.zgodovina.length > 0 && (this.zgodovina[0] as { cas: number }).cas < casMs - ZGODOVINA_MS) this.zgodovina.shift();
    let glasnih = 0;
    for (let p = 0; p < PASOV && this.zgodovina.length > 0; p++) {
      const sum = Math.min(...this.zgodovina.map((z) => z.moci[p] as number));
      if ((g[p] as number) > NAD_SUMOM * sum) glasnih += 1;
    }
    const glasno = glasnih >= NAJMANJ_PASOV && Math.sqrt(moc / n) > NAJMANJSA_RAVEN;
    if (!glasno) this.glasnoOd = -1;
    else if (this.glasnoOd < 0) this.glasnoOd = casMs;
    const govor = glasno && casMs - this.glasnoOd >= NEPREKINJENO_MS;
    if (!this.odsek) this.odsek = { od: casMs, vsota: new Array<number>(PASOV).fill(0), okvirjev: 0 };
    const o = this.odsek;
    for (let p = 0; p < PASOV; p++) o.vsota[p] = (o.vsota[p] as number) + (g[p] as number);
    o.okvirjev += 1;
    if (casMs - o.od >= ODSEK_MS) {
      this.zgodovina.push({ cas: casMs, moci: o.vsota.map((v) => v / o.okvirjev) });
      this.odsek = null;
    }
    return govor;
  }
}

/** Omejitve getUserMedia: ista obdelava (NS, AEC, AGC) za privzeto in za izbrano napravo (rezervna pot ob NotReadableError). */
export function omejitveMikrofona(deviceId?: string): MediaTrackConstraints {
  const obdelava = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  return deviceId === undefined ? obdelava : { ...obdelava, deviceId: { exact: deviceId } };
}
