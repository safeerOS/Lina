/** Izid ciste funkcije: nepravilen vhod se vrne kot napaka, nikoli kot izjema (vhod SIP/RTP je nezaupan). */
export type Izid<T> = { ok: true; vrednost: T } | { ok: false; napaka: string };

export function uspeh<T>(vrednost: T): Izid<T> {
  return { ok: true, vrednost };
}

export function napaka<T = never>(opis: string): Izid<T> {
  return { ok: false, napaka: opis };
}
