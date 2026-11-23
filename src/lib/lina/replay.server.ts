import { createHash } from "node:crypto";

/**
 * Zascita pred ponovitvijo webhooka.
 * Kljuc je podpis, CallSid in zaporedna stevilka obrata.
 * Isti govor na naslednjem obratu ni ponovitev.
 * Prava ponovitev vrne zadnji TwiML, ne 409.
 */
export const REPLAY_WINDOW_MS = 5 * 60 * 1000;
const REPLAY_MAX = 1024;

const seen = new Map<string, number>();
const telesa = new Map<string, string>();

function prune(now: number): void {
  for (const [key, at] of seen) {
    if (now - at >= REPLAY_WINDOW_MS) {
      seen.delete(key);
      telesa.delete(key);
    }
  }
}

function remember(key: string, now: number): void {
  if (seen.has(key)) seen.delete(key);
  seen.set(key, now);
  while (seen.size > REPLAY_MAX) {
    const oldest = seen.keys().next().value;
    if (oldest === undefined) break;
    seen.delete(oldest);
    telesa.delete(oldest);
  }
}

/** Podpis + CallSid + zaporedna stevilka obrata. Parametri govora niso kljuc. */
export function kljucPonovitve(signature: string, callSid: string, obrat: string): string {
  return createHash("sha256").update(`${signature}\n${callSid}\n${obrat}`).digest("hex");
}

/**
 * True pomeni ponovitev v oknu. Nova zahteva se zabelezi.
 * Ponovitev okna ne podaljsa.
 */
export function claimWebhook(
  signature: string,
  params: Record<string, string>,
  now = Date.now(),
  obrat = "0",
): boolean {
  prune(now);
  const key = kljucPonovitve(signature, params.CallSid ?? "", obrat);
  if (seen.has(key)) return true;
  remember(key, now);
  return false;
}

export function shraniZadnjiTwiml(
  signature: string,
  callSid: string,
  obrat: string,
  telo: string,
  now = Date.now(),
): void {
  const key = kljucPonovitve(signature, callSid, obrat);
  remember(key, now);
  telesa.set(key, telo);
}

export function zadnjiTwiml(signature: string, callSid: string, obrat: string): string | null {
  return telesa.get(kljucPonovitve(signature, callSid, obrat)) ?? null;
}
