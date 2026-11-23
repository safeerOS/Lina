/**
 * Okvirji WebSocket (RFC 6455) za glas telefona: rokovanje (Sec-WebSocket-Accept), gradnja okvirjev streznik -> odjemalec
 * (brez maske) in razclenjevalnik okvirjev odjemalec -> streznik (z masko).
 */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

/** Stalnica RFC 6455 4.2.2 za izracun Sec-WebSocket-Accept. */
const GUID_WS = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Glava Sec-WebSocket-Key: 16 nakljucnih bajtov v base64 (22 znakov + "=="). */
export const KLJUC_WS = /^[A-Za-z0-9+/]{22}==$/;

/** Kode operacij okvirjev (RFC 6455 5.2). */
const OP_NADALJEVANJE = 0x0;
export const OP_BESEDILO = 0x1;
export const OP_DVOJISKO = 0x2;
export const OP_ZAPRI = 0x8;
export const OP_PING = 0x9;
export const OP_PONG = 0xa;

/** Zgornja meja stevila fragmentov enega sporocila (prepreci poplavo praznih nadaljevalnih okvirjev). */
const NAJVEC_FRAGMENTOV = 128;

/** Izracun glave Sec-WebSocket-Accept po RFC 6455 4.2.2 (SHA-1 + base64). */
export function sprejemniKljuc(kljuc: string): string {
  return createHash("sha1").update(kljuc + GUID_WS, "utf8").digest("base64");
}

/** Zgradi okvir streznik -> odjemalec (FIN=1, brez maske, najkrajsa kodirana dolzina). */
export function okvir(op: number, podatki: Buffer = Buffer.alloc(0)): Buffer {
  const n = podatki.length;
  const b0 = 0x80 | (op & 0x0f);
  let glava: Buffer;
  if (n < 126) {
    glava = Buffer.from([b0, n]);
  } else if (n < 65536) {
    glava = Buffer.allocUnsafe(4);
    glava[0] = b0;
    glava[1] = 126;
    glava.writeUInt16BE(n, 2);
  } else {
    glava = Buffer.allocUnsafe(10);
    glava[0] = b0;
    glava[1] = 127;
    glava.writeBigUInt64BE(BigInt(n), 2);
  }
  return n === 0 ? glava : Buffer.concat([glava, podatki], glava.length + n);
}

/** Skrajsa niz UTF-8 na najvec `najvec` bajtov brez pretrganja vecbajtnega znaka. */
function skrajsajUtf8(besedilo: string, najvec: number): Buffer {
  const b = Buffer.from(besedilo, "utf8");
  if (b.length <= najvec) return b;
  let n = najvec;
  while (n > 0 && (b[n] & 0xc0) === 0x80) n -= 1;
  return b.subarray(0, n);
}

/** Zgradi okvir za zapiranje (OP_ZAPRI): 2 B kode + najvec 123 B UTF-8 razloga (skupaj <= 125 B). */
export function okvirZapri(koda: number, razlog = ""): Buffer {
  const r = skrajsajUtf8(razlog, 123);
  const telo = Buffer.allocUnsafe(2 + r.length);
  telo.writeUInt16BE(koda, 0);
  r.copy(telo, 2);
  return okvir(OP_ZAPRI, telo);
}

export type DogodekOkvirja =
  | { tip: "okvir"; op: number; podatki: Buffer }
  | { tip: "napaka"; koda: number; razlog: string };

/** Kode zapiranja, ki jih uporablja streznik (RFC 6455 7.4.1). */
export const KODA = { normalno: 1000, odhaja: 1001, protokol: 1002, nepodprto: 1003, neveljavno: 1007, pravilnik: 1008, preveliko: 1009, notranja: 1011 } as const;

/**
 * Razclenjevalnik okvirjev odjemalec -> streznik. Pomnilnik: najvec glava (14 B) + najvec vsebine; po prvi napaki ne sprejme vec nic.
 */
export class Razclenjevalnik {
  private readonly najvec: number;
  private ostanek: Buffer = Buffer.alloc(0);
  private pokvarjen = false;
  private fragOp: number | null = null;
  private fragDeli: Buffer[] = [];
  private fragDolzina = 0;

  constructor(najvec: number) {
    this.najvec = najvec;
  }

  private napaka(izid: DogodekOkvirja[], koda: number, razlog: string): DogodekOkvirja[] {
    this.pokvarjen = true;
    this.ostanek = Buffer.alloc(0);
    this.fragOp = null;
    this.fragDeli = [];
    this.fragDolzina = 0;
    izid.push({ tip: "napaka", koda, razlog });
    return izid;
  }

  /** Doda nov kos bajtov iz vticnice in vrne razclenjene dogodke (okvirje ali prvo napako). */
  dodaj(kos: Buffer): DogodekOkvirja[] {
    if (this.pokvarjen || kos.length === 0) return [];
    const izid: DogodekOkvirja[] = [];
    let b = this.ostanek.length > 0 ? Buffer.concat([this.ostanek, kos]) : kos;

    while (b.length >= 2) {
      const b0 = b[0];
      const b1 = b[1];
      const fin = (b0 & 0x80) !== 0;
      const rsv = b0 & 0x70;
      const op = b0 & 0x0f;
      const maskiran = (b1 & 0x80) !== 0;

      if (rsv !== 0) return this.napaka(izid, KODA.protokol, "rezervirani biti");
      if (!maskiran) return this.napaka(izid, KODA.protokol, "okvir ni maskiran");
      if (op !== OP_NADALJEVANJE && op !== OP_BESEDILO && op !== OP_DVOJISKO && op !== OP_ZAPRI && op !== OP_PING && op !== OP_PONG) {
        return this.napaka(izid, KODA.protokol, "nepoznana koda operacije");
      }
      if (op >= 0x8 && !fin) return this.napaka(izid, KODA.protokol, "fragmentiran kontrolni okvir");
      if (op === OP_NADALJEVANJE && this.fragOp === null) return this.napaka(izid, KODA.protokol, "nadaljevanje brez zacetka");
      if ((op === OP_BESEDILO || op === OP_DVOJISKO) && this.fragOp !== null) return this.napaka(izid, KODA.protokol, "nov okvir med fragmentacijo");

      let dolzina = b1 & 0x7f;
      let glava = 2;
      if (dolzina === 126) {
        if (b.length < 4) break;
        dolzina = b.readUInt16BE(2);
        glava = 4;
        if (dolzina < 126) return this.napaka(izid, KODA.protokol, "dolzina ni najkrajsa mozna");
      } else if (dolzina === 127) {
        if (b.length < 10) break;
        if ((b[2] & 0x80) !== 0) return this.napaka(izid, KODA.protokol, "neveljavna 64-bitna dolzina");
        const d64 = b.readBigUInt64BE(2);
        dolzina = d64 > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(d64);
        glava = 10;
        if (dolzina < 65536) return this.napaka(izid, KODA.protokol, "dolzina ni najkrajsa mozna");
      }
      if (op >= 0x8 && dolzina > 125) return this.napaka(izid, KODA.protokol, "kontrolni okvir predolg");
      // RFC 6455 5.5.1: vsebina close je prazna ali ima vsaj 2 B (koda); 1 B je protokolna napaka (L-10)
      if (op === OP_ZAPRI && dolzina === 1) return this.napaka(izid, KODA.protokol, "close z 1 B vsebine");
      // velikost PRED hranjenjem vsebine: ne cakamo na bajte okvirja, ki ga tako ali tako zavrnemo
      if (dolzina > this.najvec) return this.napaka(izid, KODA.preveliko, "okvir prevelik");
      if (op < 0x8 && this.fragDolzina + dolzina > this.najvec) return this.napaka(izid, KODA.preveliko, "sporocilo preveliko");
      const skupaj = glava + 4 + dolzina;
      if (b.length < skupaj) break;

      const zacetek = glava + 4;
      const podatki = Buffer.allocUnsafe(dolzina);
      for (let i = 0; i < dolzina; i++) podatki[i] = b[zacetek + i] ^ b[glava + (i & 3)];
      b = b.subarray(skupaj);

      if (op >= 0x8) {
        izid.push({ tip: "okvir", op, podatki });
      } else if (op === OP_NADALJEVANJE) {
        this.fragDeli.push(podatki);
        this.fragDolzina += dolzina;
        if (fin) {
          izid.push({ tip: "okvir", op: this.fragOp!, podatki: Buffer.concat(this.fragDeli, this.fragDolzina) });
          this.fragOp = null;
          this.fragDeli = [];
          this.fragDolzina = 0;
        } else if (this.fragDeli.length >= NAJVEC_FRAGMENTOV) {
          return this.napaka(izid, KODA.protokol, "prevec fragmentov");
        }
      } else if (fin) {
        izid.push({ tip: "okvir", op, podatki });
      } else {
        this.fragOp = op;
        this.fragDeli = [podatki];
        this.fragDolzina = dolzina;
      }
    }

    // kopija ostanka prepreci zadrzevanje velikega vhodnega medpomnilnika v pomnilniku
    this.ostanek = b.length > 0 ? Buffer.from(b) : Buffer.alloc(0);
    return izid;
  }
}
