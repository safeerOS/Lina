import type { SettingsStore } from "./db.js";
import { isAllowedLanUrl, stripSecretQuery } from "./lan-url.js";
import { normalizeFingerprint } from "./tls-pin.js";

/** Settings editable from the console. Values saved there win over server/.env defaults. */
export interface GatewayConfig {
  geminiApiKey?: string;
  geminiModel?: string;
  publicUrl?: string;
  webhookUrl?: string;
  docsUrl?: string;
  /** Every incoming call is answered and streamed to this agent WebSocket. */
  incomingStreamUrl?: string;
  incomingStreamFormat?: string;
  /** Izrecno shranjen odtis Line. Preglasi LINA_CERT_SHA256. Zahteva ga ne sme prepisati. */
  linaCertSha256?: string;
}

const KEYS = [
  "geminiApiKey",
  "geminiModel",
  "publicUrl",
  "webhookUrl",
  "docsUrl",
  "incomingStreamUrl",
  "incomingStreamFormat",
  "linaCertSha256",
] as const;
export type ConfigKey = (typeof KEYS)[number];

export class ConfigStore {
  constructor(
    private readonly settings: SettingsStore,
    private readonly defaults: GatewayConfig = {},
  ) {}

  get(key: ConfigKey): string | undefined {
    const value = this.saved()[key] || this.defaults[key] || undefined;
    if (!value) return undefined;
    if (key === "webhookUrl") return acceptLan(value, ["https:"]);
    if (key === "incomingStreamUrl") return acceptLan(value, ["wss:"]);
    return value;
  }

  /** Samo shranjena vrednost, brez privzetka iz okolja. */
  explicit(key: ConfigKey): string | undefined {
    const value = this.saved()[key]?.trim();
    return value || undefined;
  }

  /** Empty string clears a saved value (falls back to the .env default). */
  update(patch: Partial<Record<ConfigKey, string>>): void {
    const next = { ...this.saved() };
    for (const key of KEYS) {
      const value = patch[key];
      if (value === undefined) continue;
      const trimmed = value.trim();
      if (!trimmed) {
        delete next[key];
        continue;
      }
      if (key === "webhookUrl" || key === "incomingStreamUrl") {
        // Zeton v poizvedbi se odstrani. Javni gostitelj in ws/http se ne shranita.
        const cleaned = acceptLan(trimmed, key === "webhookUrl" ? ["https:"] : ["wss:"]);
        if (!cleaned) continue;
        next[key] = cleaned;
        continue;
      }
      if (key === "linaCertSha256") {
        const pin = normalizeFingerprint(trimmed);
        if (!/^[0-9a-f]{64}$/.test(pin)) continue;
        next[key] = pin;
        continue;
      }
      next[key] = trimmed;
    }
    this.settings.set("config", next);
  }

  /** Safe to send to the browser: secrets are reduced to whether they are set and their last digits. */
  view() {
    const saved = this.saved();
    const gemini = this.get("geminiApiKey");
    return {
      publicUrl: this.get("publicUrl") ?? null,
      webhookUrl: this.get("webhookUrl") ?? null,
      docsUrl: this.get("docsUrl") ?? null,
      incomingStreamUrl: this.get("incomingStreamUrl") ?? null,
      incomingStreamFormat: this.get("incomingStreamFormat") ?? "raw",
      linaCertSha256: this.explicit("linaCertSha256") ?? null,
      geminiModel: this.get("geminiModel") ?? null,
      geminiApiKey: {
        configured: Boolean(gemini),
        hint: gemini ? `…${gemini.slice(-4)}` : null,
        source: saved.geminiApiKey ? "console" : gemini ? "env" : null,
      },
    };
  }

  private saved(): GatewayConfig {
    return this.settings.get<GatewayConfig>("config") ?? {};
  }
}

function acceptLan(value: string, protocols: readonly string[]): string | undefined {
  const stripped = stripSecretQuery(value);
  return isAllowedLanUrl(stripped, protocols) ? stripped : undefined;
}
