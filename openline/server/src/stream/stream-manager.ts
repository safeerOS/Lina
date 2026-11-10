import { mayTakeOver, type AllowlistMode } from "../allowlist.js";
import { takeoverDenied } from "../redact.js";
import type { ConfigStore } from "../config.js";
import type { DeviceCommandChannel } from "../device-channel.js";
import { isAllowedLanUrl, stripSecretQuery } from "../lan-url.js";
import type { StateStore } from "../state.js";
import type { CallRecord, DeviceEventName, StreamConfig, StreamFormat } from "../types.js";
import { StreamBridge } from "./stream-bridge.js";

export interface StreamManagerOptions {
  state: StateStore;
  deviceChannel: DeviceCommandChannel;
  config: ConfigStore;
  apiKey: string;
  mediaUrl(callId: string): string;
  /** Seznam dovoljenih dohodnih stevilk. Ob nacinu on prazen seznam ne dovoli nic. */
  allowlist?: readonly string[];
  /** on = samo seznam. off = vse dohodne razen stevilk v sili. */
  allowlistMode?: AllowlistMode;
  /** Zeton Line, samo v pomnilniku. Doda se v glavo, ce je cilj njen izvor. */
  linaStreamToken?: string;
  linaOrigin?: string;
  linaCertSha256?: string;
  mediaCaPem?: string;
  mediaFingerprint?: string;
}

const LIVE_STATES = new Set<CallRecord["state"]>(["queued", "dialing", "ringing", "active", "held"]);

/** Tok dohodnih klicev gre na Lino, a samo ce je stevilka na seznamu. */
export class StreamManager {
  private readonly bridges = new Map<string, StreamBridge>();
  private readonly allowlist: readonly string[];
  private readonly allowlistMode: AllowlistMode;

  constructor(private readonly options: StreamManagerOptions) {
    this.allowlist = options.allowlist ?? [];
    this.allowlistMode = options.allowlistMode ?? "on";
  }

  /** The account-wide target for incoming calls, if set. */
  incomingTarget(): StreamConfig | undefined {
    const url = this.options.config.get("incomingStreamUrl");
    if (!url) return undefined;
    const format = (this.options.config.get("incomingStreamFormat") ?? "raw") as StreamFormat;
    return { url, format };
  }

  /** Attach an agent to a live call (answers it first if it is ringing in). */
  attach(callId: string, stream: StreamConfig): CallRecord {
    const current = this.options.state.getCall(callId);
    if (!current || !LIVE_STATES.has(current.state)) throw new Error("call is not live");
    if (current.direction === "incoming" && !this.allowed(current.remoteNumber)) {
      throw new Error("stevilka ni na seznamu dovoljenih");
    }
    this.bridges.get(callId)?.stop();
    this.bridges.delete(callId);
    const call = this.options.state.setCallStream(callId, stream)!;
    if (call.state === "ringing" && call.direction === "incoming") this.command(call, "answer");
    if (call.state === "active") this.startBridge(call);
    return call;
  }

  detach(callId: string): void {
    this.options.state.setCallStream(callId, undefined);
    this.bridges.get(callId)?.stop();
  }

  info(callId: string) {
    const bridge = this.bridges.get(callId);
    const call = this.options.state.getCall(callId);
    return {
      stream: call?.stream ?? null,
      status: bridge?.status ?? (call?.stream ? "waiting" : "off"),
      error: bridge?.error,
    };
  }

  /**
   * Called for every call update. Returns true when it took an incoming call (so the built-in
   * assistant leaves it alone).
   */
  onCallEvent(call: CallRecord, event: DeviceEventName): boolean {
    let claimed = false;
    if (event === "call.ringing" && call.direction === "incoming" && !call.stream) {
      const target = this.incomingTarget();
      // Brez seznama (ali ce stevilke ni na njem) klic ne prevzamemo.
      if (target && this.allowed(call.remoteNumber)) {
        call = this.options.state.setCallStream(call.id, target) ?? call;
        setTimeout(() => this.command(call, "answer"), 1_000);
        claimed = true;
      }
    }
    if (call.stream && call.state === "active") this.startBridge(call);
    if (!LIVE_STATES.has(call.state)) this.bridges.get(call.id)?.stop();
    return claimed || Boolean(call.stream);
  }

  private startBridge(call: CallRecord): void {
    if (!call.stream || this.bridges.has(call.id)) return;
    // Javni gostitelj in ws:// se ne odpreta, tudi ce sta ze v zapisu klica.
    if (!isAllowedLanUrl(call.stream.url, ["wss:"])) return;
    if (call.direction === "incoming" && !this.allowed(call.remoteNumber)) return;
    const bridge = new StreamBridge({
      call,
      config: this.liveConfig(call.stream),
      mediaUrl: this.options.mediaUrl(call.id),
      apiKey: this.options.apiKey,
      mediaCaPem: this.options.mediaCaPem,
      mediaFingerprint: this.options.mediaFingerprint,
      linaOrigin: this.options.linaOrigin,
      linaCertSha256: this.options.linaCertSha256,
      userCertSha256: this.options.config.explicit("linaCertSha256"),
      onAgentClosed: () => {
        const latest = this.options.state.getCall(call.id);
        if (latest && LIVE_STATES.has(latest.state)) this.command(latest, "hangup");
      },
      onEnded: () => {
        if (this.bridges.get(call.id) === bridge) this.bridges.delete(call.id);
      },
    });
    this.bridges.set(call.id, bridge);
    bridge.start();
  }

  /** Zeton Line se pripne samo v pomnilniku in samo za njen izvor. */
  private liveConfig(stream: StreamConfig): StreamConfig {
    const url = stripSecretQuery(stream.url);
    const { token: _dropped, ...rest } = stream;
    let token: string | undefined;
    try {
      if (this.options.linaStreamToken && this.options.linaOrigin && new URL(url).origin === this.options.linaOrigin) {
        token = this.options.linaStreamToken;
      }
    } catch {
      token = undefined;
    }
    return { ...rest, url, ...(token ? { token } : {}) };
  }

  private allowed(number: string | null | undefined): boolean {
    return mayTakeOver(number, this.allowlist, this.allowlistMode);
  }

  private command(call: CallRecord, action: "answer" | "hangup"): void {
    if (action === "answer" && !this.allowed(call.remoteNumber)) {
      console.error(takeoverDenied(call.remoteNumber, "dovoljena"));
      return;
    }
    try {
      this.options.deviceChannel.send(call.deviceId, { action, callId: call.id });
    } catch (error) {
      console.error(`stream could not ${action} ${call.id}:`, error instanceof Error ? error.message : error);
    }
  }
}
