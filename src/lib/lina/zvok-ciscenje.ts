/**
 * Ciscenje zvoka klicatelja (odstranjevanje stalnega suma) za telefonski zvok 8 kHz, 16-bitni PCM. Ideja iz projekta audioghost-ai
 * (lastnik 21. 11. 2026: odstraniti zunanje zvoke, ko se Lina pogovarja s klicatelji in z uporabnikom, ker cistejsi zvok pomeni
 * boljse razumevanje), a brez GPU, brez modelov in brez omrezja: kratkocasovna Fourierjeva preobrazba (okno 256, korak 128,
 * koren Hannovega okna za analizo in sintezo), ocena suma z minimumom glajene moci (okno 96 okvirjev = 1,5 s) in Wienerjevo
 * ojacenje z nizkim tlom ter casovnim glajenjem ojacenja. Samo stalni sumi (ventilator, brnenje, siscanje); govor v ozadju in
 * zvoki, ki se hitro spreminjajo, ostanejo (za to bi bil potreben model).
 * - Tokovno: kosi poljubne dolzine dajo ISTI izhod kot celota; vsak klic vrne natanko toliko vzorcev, kot jih je dobil.
 * - Zakasnitev je stalna: ZAKASNITEV_VZORCEV (256 vzorcev = 32 ms): izhodni vzorec i ustreza vhodnemu i - 256.
 * - Brez stanja med klici (vsak klic ima svoj objekt); nic se ne zapisuje na disk, nic ne gre v omrezje.
 * - Privzeto VKLOPLJENO (lastnikov ukaz 21. 11. 2026), izklop v nastavitvah. Korist za razumevanje pri Gemini na pravih klicih
 *   je NEPREVERJENA (sinteticni preizkusi dokazujejo samo, da stalni sum pade in da govor ostane).
 * Komentarji so brez sumnikov.
 */

export const OKVIR_FFT = 256;
export const KORAK = 128;
export const ZAKASNITEV_VZORCEV = OKVIR_FFT;
const BINOV = OKVIR_FFT / 2 + 1;
/** Okvirji zgodovine za minimum (96 * 16 ms = 1,5 s). */
const ZGODOVINA_OKVIRJEV = 96;
/** Glajenje moci po casu. */
const GLAJENJE_MOCI = 0.7;
/** Popravek pristranskosti minimuma glajene moci pri polni zgodovini (minimum je pod pravo povprecno mocjo); pri manj okvirjih sorazmerno manjsi. */
const POPRAVEK_MINIMUMA = 2;
/** Prvih 16 okvirjev (0,25 s) ne ukrepa: ocene suma se ni. */
const OKVIRJEV_UVODA = 16;
/** Hitrost spremembe ojacenja: navzgor (govor se zacne) hitro, navzdol pocasneje (brez klikanja). */
const OJACENJE_NAVZGOR = 0.6;
const OJACENJE_NAVZDOL = 0.3;

export type NastavitveCiscenja = {
  /** Moc odstranjevanja (privzeto 1,2); 0,5 do 3. */
  moc?: number;
  /** Najmanjse ojacenje v dB (privzeto -12); -30 do 0. */
  tloDb?: number;
};

export const PRIVZETA_MOC = 1.2;
export const PRIVZETO_TLO_DB = -12;

function omeji(v: unknown, najmanj: number, najvec: number, privzeto: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(najvec, Math.max(najmanj, v)) : privzeto;
}

const OKNO = Float64Array.from({ length: OKVIR_FFT }, (_v, n) => Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * n) / OKVIR_FFT)));
const KOS = Float64Array.from({ length: OKVIR_FFT / 2 }, (_v, i) => Math.cos((2 * Math.PI * i) / OKVIR_FFT));
const SIN = Float64Array.from({ length: OKVIR_FFT / 2 }, (_v, i) => -Math.sin((2 * Math.PI * i) / OKVIR_FFT));
const OBRAT = (() => {
  const bitov = Math.log2(OKVIR_FFT);
  return Uint16Array.from({ length: OKVIR_FFT }, (_v, i) => {
    let r = 0;
    for (let b = 0; b < bitov; b++) r |= ((i >> b) & 1) << (bitov - 1 - b);
    return r;
  });
})();

/** Fourierjeva preobrazba radix-2 na mestu (naprej). Inverzna: zamenjaj re in im, preobrazi, zamenjaj nazaj, deli z N. */
function fft(re: Float64Array, im: Float64Array): void {
  for (let i = 0; i < OKVIR_FFT; i++) {
    const j = OBRAT[i] as number;
    if (j > i) {
      const tr = re[i] as number;
      re[i] = re[j] as number;
      re[j] = tr;
      const ti = im[i] as number;
      im[i] = im[j] as number;
      im[j] = ti;
    }
  }
  for (let dolzina = 2; dolzina <= OKVIR_FFT; dolzina <<= 1) {
    const pol = dolzina >> 1;
    const korak = OKVIR_FFT / dolzina;
    for (let zacetek = 0; zacetek < OKVIR_FFT; zacetek += dolzina) {
      for (let k = 0; k < pol; k++) {
        const wr = KOS[k * korak] as number;
        const wi = SIN[k * korak] as number;
        const a = zacetek + k;
        const b = a + pol;
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

function vInt16(v: number): number {
  const r = Math.round(v);
  return r > 32767 ? 32767 : r < -32768 ? -32768 : r;
}

export class CiscenjeZvoka8k {
  private readonly alfa: number;
  private readonly tlo: number;
  private readonly vhod = new Float64Array(OKVIR_FFT);
  private vhodPolno = OKVIR_FFT - KORAK;
  private readonly sestevek = new Float64Array(OKVIR_FFT);
  private fifo: number[] = [];
  private readonly re = new Float64Array(OKVIR_FFT);
  private readonly im = new Float64Array(OKVIR_FFT);
  private readonly glajena = new Float64Array(BINOV);
  private readonly zgodovina = new Float64Array(ZGODOVINA_OKVIRJEV * BINOV);
  private readonly ojacenje = new Float64Array(BINOV).fill(1);
  private okvirjev = 0;

  constructor(nastavitve: NastavitveCiscenja = {}) {
    this.alfa = omeji(nastavitve.moc, 0.5, 3, PRIVZETA_MOC);
    this.tlo = 10 ** (omeji(nastavitve.tloDb, -30, 0, PRIVZETO_TLO_DB) / 20);
    this.reset();
  }

  /** Nazaj na zacetno stanje (kot nov objekt). */
  reset(): void {
    this.vhod.fill(0);
    this.vhodPolno = OKVIR_FFT - KORAK;
    this.sestevek.fill(0);
    this.fifo = new Array<number>(KORAK).fill(0);
    this.glajena.fill(0);
    this.zgodovina.fill(0);
    this.ojacenje.fill(1);
    this.okvirjev = 0;
  }

  /** Obdela kos 8 kHz PCM; vrne natanko toliko vzorcev, kot jih je dobil (zakasnjeno za ZAKASNITEV_VZORCEV). */
  obdelaj(vhod: Int16Array): Int16Array {
    const izid = new Int16Array(vhod.length);
    let zadnji = 0;
    for (let i = 0; i < vhod.length; i++) {
      this.vhod[this.vhodPolno++] = vhod[i] as number;
      if (this.vhodPolno === OKVIR_FFT) this.obdelajOkvir();
      izid[i] = vInt16(this.fifo[zadnji++] as number);
    }
    this.fifo = this.fifo.slice(zadnji);
    return izid;
  }

  private obdelajOkvir(): void {
    const { re, im } = this;
    for (let n = 0; n < OKVIR_FFT; n++) {
      re[n] = (this.vhod[n] as number) * (OKNO[n] as number);
      im[n] = 0;
    }
    fft(re, im);
    const vrstica = (this.okvirjev % ZGODOVINA_OKVIRJEV) * BINOV;
    const stevilo = Math.min(this.okvirjev + 1, ZGODOVINA_OKVIRJEV);
    const faktor = 1 + ((stevilo - 1) / (ZGODOVINA_OKVIRJEV - 1)) * (POPRAVEK_MINIMUMA - 1);
    const uvod = this.okvirjev < OKVIRJEV_UVODA;
    for (let k = 0; k < BINOV; k++) {
      const p = (re[k] as number) ** 2 + (im[k] as number) ** 2;
      const g = this.okvirjev === 0 ? p : GLAJENJE_MOCI * (this.glajena[k] as number) + (1 - GLAJENJE_MOCI) * p;
      this.glajena[k] = g;
      this.zgodovina[vrstica + k] = g;
      let najmanjsa = g;
      for (let o = 0; o < stevilo; o++) {
        const v = this.zgodovina[o * BINOV + k] as number;
        if (v < najmanjsa) najmanjsa = v;
      }
      const sum = najmanjsa * faktor;
      const zeljeno = uvod || g <= 1e-9 ? 1 : Math.min(1, Math.max(this.tlo, 1 - (this.alfa * sum) / g));
      const prejsnje = this.ojacenje[k] as number;
      const nov = prejsnje + (zeljeno > prejsnje ? OJACENJE_NAVZGOR : OJACENJE_NAVZDOL) * (zeljeno - prejsnje);
      this.ojacenje[k] = nov;
      re[k] = (re[k] as number) * nov;
      im[k] = (im[k] as number) * nov;
      if (k > 0 && k < OKVIR_FFT / 2) {
        re[OKVIR_FFT - k] = (re[OKVIR_FFT - k] as number) * nov;
        im[OKVIR_FFT - k] = (im[OKVIR_FFT - k] as number) * nov;
      }
    }
    // Inverzna preobrazba: zamenjava re/im, naprej, zamenjava nazaj, deljenje z N.
    fft(im, re);
    for (let n = 0; n < OKVIR_FFT; n++) this.sestevek[n] = (this.sestevek[n] as number) + ((re[n] as number) / OKVIR_FFT) * (OKNO[n] as number);
    for (let n = 0; n < KORAK; n++) this.fifo.push(this.sestevek[n] as number);
    this.sestevek.copyWithin(0, KORAK);
    this.sestevek.fill(0, OKVIR_FFT - KORAK);
    this.vhod.copyWithin(0, KORAK);
    this.vhodPolno = OKVIR_FFT - KORAK;
    this.okvirjev += 1;
  }
}

/** Cel posnetek naenkrat; izhod je poravnan z vhodom (zakasnitev odstranjena), enako dolg. */
export function ocistiPosnetek(pcm: Int16Array, nastavitve: NastavitveCiscenja = {}): Int16Array {
  const c = new CiscenjeZvoka8k(nastavitve);
  const dodatek = new Int16Array(pcm.length + ZAKASNITEV_VZORCEV);
  dodatek.set(pcm);
  return c.obdelaj(dodatek).subarray(ZAKASNITEV_VZORCEV);
}

/** SNR v dB med cistim signalom in ocenjenim (ocenjeni - cisti = napaka). Enako dolga; cap +-120 dB. */
export function izmeriSnrDb(cisto: ArrayLike<number>, ocenjeno: ArrayLike<number>): number {
  if (cisto.length !== ocenjeno.length) throw new Error("Dolzini morata biti enaki.");
  let signal = 0;
  let napaka = 0;
  for (let i = 0; i < cisto.length; i++) {
    const c = cisto[i] as number;
    signal += c * c;
    napaka += ((ocenjeno[i] as number) - c) ** 2;
  }
  return Math.max(-120, Math.min(120, 10 * Math.log10((signal + 1e-9) / (napaka + 1e-9))));
}
