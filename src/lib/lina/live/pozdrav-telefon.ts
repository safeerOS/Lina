/**
 * Zacetek klica na poti telefona (OpenLine, surov PCM 16 kHz; lastnik 14. 11. 2026: razkritje UI je trdo pravilo, L4 15. 11. 2026).
 * Cista logika brez omrezja in diska (vse zunanje je vbrizgano). Vrstni red je zagotovljen s kodo, ne z modelom:
 *   1. besedilo pozdrava MORA v prvem stavku razkriti umetno inteligenco (nobena nastavitev tega ne izpusti),
 *   2. za besedilo MORA obstajati predsnet posnetek (16 kHz PCM); brez njega se klic zavrne,
 *   3. posnetek je PRVI zvok klica (okvirji po 20 ms = 640 B),
 *   4. Live seja se odpre sele, ko je zadnji okvir poslan. Brez posnetka ali razkritja Live NE zacne.
 * Lina se predstavi samo v pozdravu: navodilo modela ji predstavljanja ze prepoveduje (navodilo.ts).
 */
import { Prevzorcevalnik, pcmVBajte } from "./zvok.ts";

export const PCM16_FREKVENCA = 16_000;
/** 20 ms pri 16 kHz, 16-bit mono. */
export const OKVIR_PCM16_BAJTOV = 640;

const RAZKRITJE_UI = /umetno inteligenco|artificial intelligence/i;

/** Prvi stavek besedila (do prve pike, klicaja ali vprasaja). */
export function prviStavek(besedilo: string): string {
  return besedilo.trim().split(/(?<=[.!?])\s/)[0] ?? "";
}

/** Ali prvi stavek razkrije, da je Lina umetna inteligenca. */
export function razkrijeUI(besedilo: string): boolean {
  return RAZKRITJE_UI.test(prviStavek(besedilo));
}

/** Posnetek Line je 8 kHz PCM; pot telefona je 16 kHz, zato prevzorcenje (isti sinc kot sicer v zvok.ts), vrne little-endian bajte. */
export function pcm8VPcm16(pcm8: Int16Array): Uint8Array {
  return pcmVBajte(new Prevzorcevalnik(8_000, PCM16_FREKVENCA).process(pcm8));
}

/** Razrez v okvirje po 20 ms; zadnji okvir se dopolni s tisino (nicle). */
export function razrezi16(pcm: Uint8Array): Uint8Array[] {
  const okvirji: Uint8Array[] = [];
  for (let od = 0; od < pcm.length; od += OKVIR_PCM16_BAJTOV) {
    const okvir = new Uint8Array(OKVIR_PCM16_BAJTOV);
    okvir.set(pcm.subarray(od, Math.min(od + OKVIR_PCM16_BAJTOV, pcm.length)));
    okvirji.push(okvir);
  }
  return okvirji;
}

export type OdvisnostiPozdrava = {
  /** Predsnet posnetek besedila kot PCM 16 kHz; null, ce ga ni. */
  posnetek(besedilo: string): Promise<Uint8Array | null>;
  /** Okvir pozdrava k klicatelju (po vrsti). Napaka = posiljanje ni uspelo. */
  posljiOkvir(okvir: Uint8Array): void | Promise<void>;
  /** Odpre Live sejo; klicana je SAMO po poslanem pozdravu. */
  odpriLive(): Promise<void>;
  dnevnik?: (koda: string) => void;
};

export type IzidPozdrava =
  | { izid: "ok"; okvirjev: number; trajanjeMs: number }
  | { izid: "zavrnjeno"; razlog: "brez-razkritja" | "brez-posnetka" | "posiljanje" }
  | { izid: "live-napaka"; okvirjev: number; trajanjeMs: number };

/**
 * Zacne klic: pozdrav z razkritjem UI je prvi zvok, Live sele za njim. Nikoli ne vrze; izid pove, kaj se je zgodilo,
 * klicatelj naj ob zavrnitvi klic konca (brez razkritja Live ne govori s klicateljem).
 */
export async function zacniKlicTelefon(pozdrav: string, odv: OdvisnostiPozdrava): Promise<IzidPozdrava> {
  const dnevnik = (koda: string) => {
    try {
      odv.dnevnik?.(koda);
    } catch {
      /* dnevnik ne sme podreti klica */
    }
  };
  if (!razkrijeUI(pozdrav)) {
    dnevnik("pozdrav-brez-razkritja");
    return { izid: "zavrnjeno", razlog: "brez-razkritja" };
  }
  let pcm: Uint8Array | null = null;
  try {
    pcm = await odv.posnetek(pozdrav);
  } catch {
    pcm = null;
  }
  if (!pcm || pcm.length < 2) {
    dnevnik("pozdrav-brez-posnetka");
    return { izid: "zavrnjeno", razlog: "brez-posnetka" };
  }
  const okvirji = razrezi16(pcm);
  try {
    for (const okvir of okvirji) await odv.posljiOkvir(okvir);
  } catch {
    dnevnik("pozdrav-posiljanje-napaka");
    return { izid: "zavrnjeno", razlog: "posiljanje" };
  }
  const trajanjeMs = okvirji.length * 20;
  try {
    await odv.odpriLive();
  } catch {
    dnevnik("live-ni-odprt");
    return { izid: "live-napaka", okvirjev: okvirji.length, trajanjeMs };
  }
  return { izid: "ok", okvirjev: okvirji.length, trajanjeMs };
}
