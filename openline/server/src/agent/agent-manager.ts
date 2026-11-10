import type { ConfigStore } from "../config.js";
import type { Database, SettingsStore } from "../db.js";
import type { DeviceCommandChannel } from "../device-channel.js";
import { mayTakeOver, type AllowlistMode } from "../allowlist.js";
import { takeoverDenied } from "../redact.js";
import type { StateStore } from "../state.js";
import type { CallRecord, DeviceEventName } from "../types.js";
import type { AgentMessage, TranscriptLine } from "./gemini-call-agent.js";

export interface AgentSettings {
  /** Answer incoming calls automatically and hand them to the AI assistant. */
  autoAnswer: boolean;
  ownerName: string;
  /** Free-form notes about the owner that the assistant may use with callers. */
  about: string;
  voice: string;
}

export interface AgentManagerOptions {
  state: StateStore;
  deviceChannel: DeviceCommandChannel;
  apiKey: string;
  db: Database;
  settings: SettingsStore;
  /** Gemini key and model (console settings, falling back to server/.env). */
  config: ConfigStore;
  ownerName?: string;
  /** Loopback URL of this server's client media WebSocket for a call. */
  mediaUrl(callId: string): string;
  /** Seznam dovoljenih dohodnih stevilk. Ob nacinu on prazen seznam ne dovoli nic. */
  allowlist?: readonly string[];
  allowlistMode?: AllowlistMode;
}

const LIVE_STATES = new Set<CallRecord["state"]>(["queued", "dialing", "ringing", "active", "held"]);

/** Gemini je izklopljen. Dogodki se samo sprostijo; zvok dohodnih klicev prevzame Lina. */
export class AgentManager {
  readonly settings: AgentSettings;
  private readonly allowlist: readonly string[];
  private readonly allowlistMode: AllowlistMode;

  constructor(private readonly options: AgentManagerOptions) {
    this.allowlist = options.allowlist ?? [];
    this.allowlistMode = options.allowlistMode ?? "on";
    this.settings = {
      autoAnswer: false,
      ownerName: options.ownerName ?? "the owner",
      about: "",
      voice: "Kore",
      ...options.settings.get<Partial<AgentSettings>>("agent"),
    };
  }

  /** Kljuc je lahko shranjen, a model se ne zaze. */
  get configured(): boolean {
    return false;
  }

  get model(): string {
    return this.options.config.get("geminiModel") ?? "gemini-3.8-live";
  }

  updateSettings(patch: Partial<AgentSettings>): AgentSettings {
    Object.assign(this.settings, patch);
    this.options.settings.set("agent", this.settings);
    return this.settings;
  }

  listMessages(limit = 100): AgentMessage[] {
    const rows = this.options.db
      .prepare("SELECT body FROM messages ORDER BY taken_at DESC LIMIT ?")
      .all(limit) as { body: string }[];
    return rows.map((r) => JSON.parse(r.body) as AgentMessage);
  }

  getMessage(callId: string): AgentMessage | undefined {
    const row = this.options.db.prepare("SELECT body FROM messages WHERE call_id = ?").get(callId) as
      | { body: string }
      | undefined;
    return row ? (JSON.parse(row.body) as AgentMessage) : undefined;
  }

  /** Live transcript while the assistant is on the call, the saved one afterwards. */
  transcript(callId: string): TranscriptLine[] {
    const row = this.options.db.prepare("SELECT lines FROM transcripts WHERE call_id = ?").get(callId) as
      | { lines: string }
      | undefined;
    return row ? (JSON.parse(row.lines) as TranscriptLine[]) : [];
  }

  info(callId: string) {
    return {
      requested: false,
      status: "off" as const,
      error: undefined,
      transcript: this.transcript(callId),
      message: this.getMessage(callId),
    };
  }

  /** Gemini je izklopljen; prevzem gre cez seznam in tok do Line. */
  takeOver(_callId: string): void {
    throw new Error("Gemini je izklopljen; dohodni klici gredo na Lino");
  }

  release(_callId: string): void {
    // Ni zivega agenta, ki bi ga bilo treba ustaviti.
  }

  /**
   * Gemini se ne odziva (configured je vedno false). Seznam se vseeno preveri,
   * da odgovor ne bi sel skozi, ce bi model kdaj spet tekel.
   */
  onCallEvent(call: CallRecord, event: DeviceEventName, streamed = false): void {
    const dovoljen = mayTakeOver(call.remoteNumber, this.allowlist, this.allowlistMode);
    if (
      event === "call.ringing" &&
      !streamed &&
      call.direction === "incoming" &&
      dovoljen &&
      this.settings.autoAnswer &&
      this.configured
    ) {
      this.command(call, "answer");
    }
    if (!LIVE_STATES.has(call.state)) this.release(call.id);
  }

  private command(call: CallRecord, action: "answer" | "hangup"): void {
    // Dodatna zapora: brez seznama ni odgovora, tudi ce bi Gemini spet tekel.
    if (action === "answer" && !mayTakeOver(call.remoteNumber, this.allowlist, this.allowlistMode)) {
      console.error(takeoverDenied(call.remoteNumber, "seznamu"));
      return;
    }
    try {
      this.options.deviceChannel.send(call.deviceId, { action, callId: call.id });
    } catch (error) {
      console.error(`agent could not ${action} ${call.id}:`, error instanceof Error ? error.message : error);
    }
  }
}
