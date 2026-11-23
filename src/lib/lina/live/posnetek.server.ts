import { preberiWavPosnetka, pripravljeniKljuci, zvokZaBesedilo } from "../glas.server.ts";
import { IZHODNA_FREKVENCA } from "../glas.ts";
import { pcm8VPcm16 } from "./pozdrav-telefon.ts";
import { pcmVMulaw, wavVPcm } from "./zvok.ts";

/** Rok sinteze stalnega stavka, ce posnetka se ni: pozdrav ob prvem klicu ne sme viseti (sinteza brez pretoka 3-9 s). */
export const ROK_SINTEZE_POSNETKA_MS = 8_000;

/**
 * Stalni stavek (pozdrav, odgovor varovalke, slovo ...) kot mu-law 8 kHz za Twilio. Vzame ze pripravljene stalne posnetke
 * Line (isti kot pot Gather, isti glas Kore); ce jih ni, jih poskusi sintetizirati. Null: posnetka ni (glas ni na voljo).
 */
export function posnetekMulaw(root: string): (besedilo: string) => Promise<Uint8Array | null> {
  return async (besedilo) => {
    const deli = await deliPosnetka(root, besedilo);
    if (!deli) return null;
    return zlepi(deli.map((pcm) => pcmVMulaw(pcm)));
  };
}

/**
 * Isti stalni posnetek kot PCM 16-bit little-endian 16 kHz za pot telefona (surov PCM, odlocitev L1 15. 11. 2026): brez mu-law
 * (ta ni potreben), 8 kHz posnetek Line se prevzorci na 16 kHz. Null: posnetka ni (potem Live ne sme zaceti).
 */
export function posnetekPcm16(root: string): (besedilo: string) => Promise<Uint8Array | null> {
  return async (besedilo) => {
    const deli = await deliPosnetka(root, besedilo);
    if (!deli) return null;
    return zlepi(deli.map((pcm) => pcm8VPcm16(pcm)));
  };
}

function zlepi(deli: Uint8Array[]): Uint8Array {
  const skupaj = new Uint8Array(deli.reduce((vsota, d) => vsota + d.length, 0));
  let od = 0;
  for (const d of deli) {
    skupaj.set(d, od);
    od += d.length;
  }
  return skupaj;
}

/** Deli stalnega posnetka kot PCM 8 kHz (isti kljuci in sinteza z rokom za obe poti). */
async function deliPosnetka(root: string, besedilo: string): Promise<Int16Array[] | null> {
  let kljuci = await pripravljeniKljuci(besedilo, root);
  if (!kljuci) {
    let casovnik: ReturnType<typeof setTimeout> | undefined;
    const rok = new Promise<null>((resolve) => {
      casovnik = setTimeout(() => resolve(null), ROK_SINTEZE_POSNETKA_MS);
    });
    try {
      const izid = await Promise.race([zvokZaBesedilo(besedilo, root), rok]);
      kljuci = izid && "kljuci" in izid ? izid.kljuci : null;
    } catch {
      kljuci = null;
    } finally {
      if (casovnik) clearTimeout(casovnik);
    }
  }
  if (!kljuci || kljuci.length === 0) return null;
  const deli: Int16Array[] = [];
  for (const kljuc of kljuci) {
    const wav = await preberiWavPosnetka(root, kljuc);
    const pcm = wav ? wavVPcm(wav) : null;
    if (!pcm || pcm.frekvenca !== IZHODNA_FREKVENCA) return null;
    deli.push(pcm.pcm);
  }
  return deli;
}
