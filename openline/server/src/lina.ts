import type { StreamConfig } from "./types.js";
import { stripSecretQuery } from "./lan-url.js";

/** Privzeti cilj dohodnega zvoka: lokalna Lina, ne Gemini. */
export const LINA_STREAM_URL = "wss://127.0.0.1:8080/api/voice/stream";

export interface LinaStreamConfig extends StreamConfig {
  /** Samo v pomnilniku. Ni v URL, bazi ali odgovoru API. */
  token: string;
}

/**
 * Sestavi cilj toka. Zeton ostane poleg naslova, nikoli v poizvedbi.
 * Brez zetona vrne undefined (nic se ne odpre).
 */
export function linaStreamConfig(env: NodeJS.ProcessEnv = process.env): LinaStreamConfig | undefined {
  const token = env.LINA_STREAM_TOKEN?.trim();
  if (!token) return undefined;
  const base = env.LINA_STREAM_URL?.trim() || LINA_STREAM_URL;
  try {
    const url = new URL(stripSecretQuery(base));
    if (url.protocol !== "wss:") return undefined;
    return { url: url.toString(), format: "raw", token };
  } catch {
    return undefined;
  }
}
