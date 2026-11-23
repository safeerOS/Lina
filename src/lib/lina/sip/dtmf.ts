/** DTMF po RFC 4733 (telephone-event): koristna vsebina, sprejem brez podvajanja in zaporedje paketov za oddajo. */
import { napaka, uspeh, type Izid } from "./izid.ts";

export const DTMF_ZNAKI = "0123456789*#ABCD";

export type DtmfDogodek = { znak: string; konec: boolean; glasnost: number; trajanje: number };

export function razcleniDtmf(b: Uint8Array): Izid<DtmfDogodek> {
  if (!(b instanceof Uint8Array) || b.length < 4) return napaka("prekratek dogodek");
  const dogodek = b[0] as number;
  if (dogodek >= DTMF_ZNAKI.length) return napaka("nepodprt dogodek");
  const drugi = b[1] as number;
  return uspeh({
    znak: DTMF_ZNAKI[dogodek] as string,
    konec: (drugi & 0x80) !== 0,
    glasnost: drugi & 0x3f,
    trajanje: ((b[2] as number) << 8) | (b[3] as number),
  });
}

export function sestaviDtmf(d: DtmfDogodek): Uint8Array {
  const i = DTMF_ZNAKI.indexOf(d.znak.toUpperCase());
  if (i < 0 || d.znak.length !== 1) throw new RangeError("neznan znak DTMF");
  const trajanje = Math.max(0, Math.min(0xffff, Math.trunc(d.trajanje)));
  return Uint8Array.from([i, (d.konec ? 0x80 : 0) | (d.glasnost & 0x3f), trajanje >> 8, trajanje & 0xff]);
}

/**
 * Sprejem: en dogodek = en casovni zig RTP (RFC 4733 2.5.1.2). Znak sporoci ob prvem paketu z novim zigom;
 * ponovitve in trije koncni paketi istega ziga ga ne sporocijo znova.
 */
export class SprejemnikDtmf {
  private zadnjiZig: number | null = null;

  sprejmi(casovniZig: number, koristno: Uint8Array): string | null {
    const d = razcleniDtmf(koristno);
    if (!d.ok) return null;
    // Serijska aritmetika (32 bitov): enak ali starejsi zig (zakasnjen ali podvojen paket prejsnjega dogodka) ni nov dogodek (SIP1-4).
    if (this.zadnjiZig !== null && (casovniZig === this.zadnjiZig || ((casovniZig - this.zadnjiZig) >>> 0) >= 0x80000000)) return null;
    this.zadnjiZig = casovniZig;
    return d.vrednost.znak;
  }
}

/**
 * Pakete za en znak (8 kHz): vsakih 20 ms posodobljeno trajanje, prvi z oznako (marker), konec trikrat (RFC 4733 2.5.1.4).
 * Vsi paketi imajo isti casovni zig (zacetek dogodka).
 */
export function paketiDtmf(znak: string, trajanjeMs = 100, glasnost = 10): { oznaka: boolean; koristno: Uint8Array }[] {
  const korak = 160;
  const skupaj = Math.max(korak, Math.round((trajanjeMs * 8000) / 1000));
  const izid: { oznaka: boolean; koristno: Uint8Array }[] = [];
  for (let t = korak; t < skupaj; t += korak) izid.push({ oznaka: t === korak, koristno: sestaviDtmf({ znak, konec: false, glasnost, trajanje: t }) });
  for (let i = 0; i < 3; i++) izid.push({ oznaka: izid.length === 0, koristno: sestaviDtmf({ znak, konec: true, glasnost, trajanje: skupaj }) });
  return izid;
}
