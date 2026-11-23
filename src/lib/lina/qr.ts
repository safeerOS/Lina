/**
 * Koda QR za seznanjanje telefona (ISO/IEC 18004, nacin bajtov, popravljanje M, razlicice 1-20), brez zunanjih paketov.
 * Postopek sledi javni referencni izvedbi (Nayuki, »QR Code generator library«, MIT): bloki in Reed-Solomon, vzorci, vrstni
 * red modulov, maske. Ujemanje modul za modulom s paketom qrcode 1.5.4 (OpenLine) drzi preizkus qr.test.ts.
 */

/** [skupno kodnih besed, ECC na blok, stevilo blokov] za popravljanje M, razlicice 1-20 (ISO/IEC 18004, tabela 9). */
const M: ReadonlyArray<readonly [number, number, number]> = [
  [26, 10, 1], [44, 16, 1], [70, 26, 1], [100, 18, 2], [134, 24, 2],
  [172, 16, 4], [196, 18, 4], [242, 22, 4], [292, 22, 5], [346, 26, 5],
  [404, 30, 5], [466, 22, 8], [532, 22, 9], [581, 24, 9], [655, 24, 10],
  [733, 28, 10], [815, 28, 11], [901, 26, 13], [991, 26, 14], [1085, 26, 16],
];
const PORAVNAVA: ReadonlyArray<readonly number[]> = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
  [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78],
  [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
];
export const NAJVECJA_RAZLICICA = 20;

function mnozi(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function delitelj(stopnja: number): number[] {
  const r = new Array<number>(stopnja).fill(0);
  r[stopnja - 1] = 1;
  let koren = 1;
  for (let i = 0; i < stopnja; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = mnozi(r[j], koren);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    koren = mnozi(koren, 0x02);
  }
  return r;
}

function ostanek(podatki: number[], d: number[]): number[] {
  const r = new Array<number>(d.length).fill(0);
  for (const b of podatki) {
    const f = b ^ (r.shift() as number);
    r.push(0);
    d.forEach((c, i) => { r[i] ^= mnozi(c, f); });
  }
  return r;
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

export type MatrikaQr = boolean[][];

/** Matrika modulov (true = temen). `maska` 0-7 izbere masko (za preizkus), sicer najnizja kazen. */
export function kodaQr(besedilo: string, moznosti: { razlicica?: number; maska?: number } = {}): MatrikaQr {
  const bajti = [...Buffer.from(besedilo, "utf8")];
  let v = moznosti.razlicica ?? 0;
  if (!v) {
    for (let r = 1; r <= NAJVECJA_RAZLICICA; r++) {
      const [skupno, ecc, bloki] = M[r - 1];
      if (4 + (r < 10 ? 8 : 16) + 8 * bajti.length <= (skupno - ecc * bloki) * 8) { v = r; break; }
    }
  }
  if (!v || v < 1 || v > NAJVECJA_RAZLICICA) throw new Error("Besedilo je predolgo za kodo QR.");
  const [skupno, eccNaBlok, stBlokov] = M[v - 1];
  const kapaciteta = (skupno - eccNaBlok * stBlokov) * 8;
  // podatkovni biti: nacin bajtov 0100, dolzina, bajti, zakljucek, polnilo
  const biti: number[] = [];
  const dodaj = (x: number, n: number) => { for (let i = n - 1; i >= 0; i--) biti.push((x >>> i) & 1); };
  dodaj(4, 4);
  dodaj(bajti.length, v < 10 ? 8 : 16);
  for (const b of bajti) dodaj(b, 8);
  if (biti.length > kapaciteta) throw new Error("Besedilo je predolgo za to razlicico.");
  dodaj(0, Math.min(4, kapaciteta - biti.length));
  dodaj(0, (8 - (biti.length % 8)) % 8);
  for (let p = 0xec; biti.length < kapaciteta; p ^= 0xec ^ 0x11) dodaj(p, 8);
  const podatki: number[] = [];
  for (let i = 0; i < biti.length; i += 8) podatki.push(biti.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // bloki, ECC in prepletanje
  const kratkih = stBlokov - (skupno % stBlokov);
  const dolzinaKratkega = Math.floor(skupno / stBlokov);
  const d = delitelj(eccNaBlok);
  const bloki: number[][] = [];
  for (let i = 0, k = 0; i < stBlokov; i++) {
    const dol = dolzinaKratkega - eccNaBlok + (i < kratkih ? 0 : 1);
    const dat = podatki.slice(k, k + dol);
    k += dol;
    const blok = [...dat, ...ostanek(dat, d)];
    if (i < kratkih) blok.splice(dat.length, 0, 0);
    bloki.push(blok);
  }
  const kodne: number[] = [];
  for (let i = 0; i < bloki[0].length; i++) {
    bloki.forEach((b, j) => { if (i !== dolzinaKratkega - eccNaBlok || j >= kratkih) kodne.push(b[i]); });
  }

  const n = v * 4 + 17;
  const moduli: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const funkcija: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const postavi = (x: number, y: number, t: boolean) => { moduli[y][x] = t; funkcija[y][x] = true; };

  for (let i = 0; i < n; i++) { postavi(6, i, i % 2 === 0); postavi(i, 6, i % 2 === 0); }
  const iskalni = (x: number, y: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const r = Math.max(Math.abs(dx), Math.abs(dy));
      const xx = x + dx; const yy = y + dy;
      if (xx >= 0 && xx < n && yy >= 0 && yy < n) postavi(xx, yy, r !== 2 && r !== 4);
    }
  };
  iskalni(3, 3); iskalni(n - 4, 3); iskalni(3, n - 4);
  const pos = PORAVNAVA[v - 1];
  pos.forEach((a, i) => pos.forEach((b, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) postavi(a + dx, b + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const oblika = (maska: number) => {
    const dat = (0 << 3) | maska; // popravljanje M = 00
    let r = dat;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((dat << 10) | r) ^ 0x5412;
    for (let i = 0; i <= 5; i++) postavi(8, i, bit(b, i));
    postavi(8, 7, bit(b, 6)); postavi(8, 8, bit(b, 7)); postavi(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) postavi(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) postavi(n - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) postavi(8, n - 15 + i, bit(b, i));
    postavi(8, n - 8, true);
  };
  oblika(0);
  if (v >= 7) {
    let r = v;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) {
      const a = n - 11 + (i % 3); const c = Math.floor(i / 3);
      postavi(a, c, bit(b, i)); postavi(c, a, bit(b, i));
    }
  }
  // kodne besede v cik-cak
  let i = 0;
  for (let desno = n - 1; desno >= 1; desno -= 2) {
    if (desno === 6) desno = 5;
    for (let navp = 0; navp < n; navp++) for (let j = 0; j < 2; j++) {
      const x = desno - j;
      const gor = ((desno + 1) & 2) === 0;
      const y = gor ? n - 1 - navp : navp;
      if (!funkcija[y][x] && i < kodne.length * 8) { moduli[y][x] = bit(kodne[i >>> 3], 7 - (i & 7)); i++; }
    }
  }
  const maskiraj = (m: number) => {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (funkcija[y][x]) continue;
      const p = [
        (x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0,
        (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, ((x * y) % 2) + ((x * y) % 3) === 0,
        (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
      ][m];
      if (p) moduli[y][x] = !moduli[y][x];
    }
  };
  let maska = moznosti.maska ?? -1;
  if (maska < 0) {
    let najmanj = Infinity;
    for (let m = 0; m < 8; m++) {
      maskiraj(m); oblika(m);
      const k = kazen(moduli);
      if (k < najmanj) { najmanj = k; maska = m; }
      maskiraj(m);
    }
  }
  maskiraj(maska);
  oblika(maska);
  return moduli;
}

/** Kazen maske (pravila 1-4 standarda, poenostavljeno pravilo 3); vsaka maska je veljavna, kazen samo izboljsa branje. */
function kazen(m: boolean[][]): number {
  const n = m.length;
  let k = 0;
  for (let a = 0; a < 2; a++) for (let y = 0; y < n; y++) {
    let tek = 1;
    for (let x = 1; x < n; x++) {
      const c = a ? m[x][y] : m[y][x];
      const p = a ? m[x - 1][y] : m[y][x - 1];
      if (c === p) { tek++; if (tek === 5) k += 3; else if (tek > 5) k++; } else tek = 1;
    }
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const c = m[y][x];
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) k += 3;
  }
  const vzorec = [true, false, true, true, true, false, true, false, false, false, false];
  for (let y = 0; y < n; y++) for (let x = 0; x + 11 <= n; x++) {
    for (const obr of [vzorec, [...vzorec].reverse()]) {
      if (obr.every((t, i) => m[y][x + i] === t)) k += 40;
      if (obr.every((t, i) => m[x + i][y] === t)) k += 40;
    }
  }
  const temnih = m.flat().filter(Boolean).length;
  k += Math.floor(Math.abs(temnih * 20 - n * n * 10) / (n * n)) * 10;
  return k;
}

/** SVG (temni moduli kot ena pot, tiha cona 4 moduli); barve iz teme programa. */
export function svgQr(m: MatrikaQr, velikost = 240): string {
  const n = m.length + 8;
  let d = "";
  m.forEach((vrsta, y) => vrsta.forEach((t, x) => { if (t) d += `M${x + 4} ${y + 4}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${velikost}" height="${velikost}" shape-rendering="crispEdges" role="img"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
