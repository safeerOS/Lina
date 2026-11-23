/** Glava RTP (RFC 3550 5.1): razclenitev brez izjem in sestava. */
import { napaka, uspeh, type Izid } from "./izid.ts";

export type RtpPaket = {
  oznaka: boolean;
  tip: number;
  zaporedna: number;
  casovniZig: number;
  ssrc: number;
  koristno: Uint8Array;
};

export const RTP_NAJVEC_BAJTOV = 1500;

export function razcleniRtp(b: Uint8Array): Izid<RtpPaket> {
  if (!(b instanceof Uint8Array)) return napaka("ni bajtov");
  if (b.length < 12) return napaka("prekratek paket");
  if (b.length > RTP_NAJVEC_BAJTOV) return napaka("prevelik paket");
  const prvi = b[0] as number;
  if (prvi >> 6 !== 2) return napaka("ni RTP v2");
  const polnilo = (prvi & 0x20) !== 0;
  const razsiritev = (prvi & 0x10) !== 0;
  const csrc = prvi & 0x0f;
  const drugi = b[1] as number;
  const tip = drugi & 0x7f;
  // 72-76 so tipi RTCP (RFC 5761 4): na vratih RTP jih ne sprejmemo kot zvok.
  if (tip >= 72 && tip <= 76) return napaka("RTCP na vratih RTP");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let odmik = 12 + csrc * 4;
  if (odmik > b.length) return napaka("CSRC cez konec");
  if (razsiritev) {
    if (odmik + 4 > b.length) return napaka("razsiritev cez konec");
    const dolzina = dv.getUint16(odmik + 2) * 4;
    odmik += 4 + dolzina;
    if (odmik > b.length) return napaka("razsiritev cez konec");
  }
  let konec = b.length;
  if (polnilo) {
    const p = b[b.length - 1] as number;
    if (p === 0 || konec - p < odmik) return napaka("napacno polnilo");
    konec -= p;
  }
  return uspeh({
    oznaka: (drugi & 0x80) !== 0,
    tip,
    zaporedna: dv.getUint16(2),
    casovniZig: dv.getUint32(4),
    ssrc: dv.getUint32(8),
    koristno: b.subarray(odmik, konec),
  });
}

export function sestaviRtp(p: RtpPaket): Buffer {
  const b = Buffer.alloc(12 + p.koristno.length);
  b[0] = 0x80;
  b[1] = (p.oznaka ? 0x80 : 0) | (p.tip & 0x7f);
  b.writeUInt16BE(p.zaporedna & 0xffff, 2);
  b.writeUInt32BE(p.casovniZig >>> 0, 4);
  b.writeUInt32BE(p.ssrc >>> 0, 8);
  b.set(p.koristno, 12);
  return b;
}
