import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { AuthService } from "./auth.js";
import { isEndedCallState, type StateStore } from "./state.js";
import { hasSecretQuery } from "./lan-url.js";
import { registerUpgrade } from "./upgrade-router.js";

/**
 * Live call audio, relayed between the phone and one developer/AI client per call.
 *
 * Both legs carry binary frames of raw PCM (see MEDIA_FORMAT):
 *   phone  -> client : remote party audio (what the caller says)
 *   client -> phone  : audio injected into the call (what the agent says)
 *
 * Text frames are JSON control messages:
 *   server -> client : {type:"start", callId, format} | {type:"stop", callId, reason}
 *   client -> server : {type:"clear"}  (drop queued agent audio, e.g. on barge-in)
 *
 * Listen-only monitors (`?mode=listen`, any number per call) hear both sides without taking the
 * client slot. Their binary frames carry a 1-byte channel prefix: 0x01 remote party, 0x02 the
 * audio injected into the call. They also receive start/stop and {type:"clear"}.
 */
export const MEDIA_FORMAT = {
  encoding: "pcm_s16le",
  sampleRate: 16000,
  channels: 1,
  frameMs: 20,
} as const;

/** En okvir: 20 ms pri 16 kHz mono s16le. Toliko poslje telefon in lastni most (stream-bridge.ts). */
export const MEDIA_FRAME_BYTES =
  (MEDIA_FORMAT.sampleRate / 1000) * MEDIA_FORMAT.frameMs * MEDIA_FORMAT.channels * 2;

/**
 * Najvecje sporocilo noge telefona. Telefon poslje okvirje po 640 B; 8 KiB pusti zalogo
 * za daljsi okvir. Vec od tega je napaka ali zloraba zetona naprave.
 */
export const DEVICE_MEDIA_MAX_PAYLOAD = 8 * 1024;

/**
 * Najvecje sporocilo noge odjemalca. Zunanji odjemalec sme poslati cel stavek TTS naenkrat:
 * 64 KiB sta le 2 s zvoka in sta sredi stavka prekinila povezavo, klic pa je utihnil (N10-7).
 * 1 MiB je 32 s zvoka in se vedno omeji pomnilnik na povezavo. Telefonu gre razrezano na okvirje.
 */
export const CLIENT_MEDIA_MAX_PAYLOAD = 1024 * 1024;

/**
 * Najvec bajtov, ki smejo cakati na posiljanje telefonu (N12-8). 2 MiB je 64 s zvoka. Odjemalec, ki
 * posilja hitreje, kot telefon sprejema, bi sicer polnil pomnilnik streznika brez meje.
 */
export const DEVICE_BACKLOG_MAX_BYTES = 2 * CLIENT_MEDIA_MAX_PAYLOAD;

export const DEVICE_MEDIA_PATH = "/v1/device-media";
export const MONITOR_CHANNEL = { remote: 0x01, injected: 0x02 } as const;
const CLIENT_MEDIA_PATH = /^\/v1\/calls\/([^/]+)\/media$/;

/**
 * Lastna medijska noga. Vedno 127.0.0.1, tudi ce HOST ni localhost.
 * Certifikat ima SAN samo za localhost, zato naslov vmesnika ne sme v URL.
 * Streznik mora na 127.0.0.1 tudi poslusati, sicer se noga po dvigu prekine.
 */
export function ownMediaUrl(port: number, callId: string, tls: boolean): string {
  const proto = tls ? "wss" : "ws";
  return `${proto}://127.0.0.1:${port}/v1/calls/${encodeURIComponent(callId)}/media`;
}

/** Medijska noga sme biti samo loopback. LAN ime gostitelja certifikat nima v SAN. */
export function assertLoopbackMediaUrl(url: string): void {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("medijska noga mora biti loopback");
  }
}

interface MediaSession {
  /** Zastoj proti telefonu je ze zapisan; vsako zavrzeno sporocilo ne sme v dnevnik. */
  backlogLogged?: boolean;
  device?: WebSocket;
  client?: WebSocket;
  monitors: Set<WebSocket>;
}

export class MediaRelay {
  private readonly deviceServer = new WebSocketServer({ noServer: true, maxPayload: DEVICE_MEDIA_MAX_PAYLOAD });
  private readonly clientServer = new WebSocketServer({ noServer: true, maxPayload: CLIENT_MEDIA_MAX_PAYLOAD });
  private readonly sessions = new Map<string, MediaSession>();

  constructor(
    private readonly state: StateStore,
    private readonly auth: Pick<AuthService, "isAuthorized">,
  ) {}

  attach(httpServer: HttpServer): void {
    // Skupni usmerjevalnik (N8): tuja pot dobi 404 enkrat za vse module.
    registerUpgrade(httpServer, (pathname) => pathname === DEVICE_MEDIA_PATH, (request, socket, head, url) => {
      this.upgradeDevice(request, socket, head, url);
    });
    registerUpgrade(httpServer, (pathname) => CLIENT_MEDIA_PATH.test(pathname), (request, socket, head, url) => {
      const match = CLIENT_MEDIA_PATH.exec(url.pathname)!;
      this.upgradeClient(request, socket, head, url, decodeURIComponent(match[1]!));
    });
  }

  /**
   * Klic je koncan ali ga je prevzel uporabnik (N12-3): noga telefona se zapre takoj in okvirji ne
   * gredo vec ne odjemalcu ne poslusalcem. Brez tega bi telefon, ki mu lupina se ni potrdila stopa,
   * do izteka najema (8 s) posiljal glas s klica, ki je zdaj uporabnikov.
   */
  endCall(callId: string): void {
    const session = this.sessions.get(callId);
    const device = session?.device;
    if (!session || !device) return;
    session.device = undefined;
    device.close(4002, "call ended");
    const stop = { type: "stop", callId, reason: "call_ended" };
    if (session.client) sendJson(session.client, stop);
    for (const monitor of session.monitors) sendJson(monitor, stop);
    this.dropIfEmpty(callId);
  }

  /** True while the phone is streaming audio for this call. */
  isStreaming(callId: string): boolean {
    return this.sessions.get(callId)?.device?.readyState === WebSocket.OPEN;
  }

  private upgradeDevice(request: IncomingMessage, socket: Duplex, head: Buffer, url: URL): void {
    const deviceId = url.searchParams.get("deviceId") ?? headerString(request, "x-device-id");
    const deviceToken = hasSecretQuery(url) ? null : headerString(request, "x-device-token");
    const callId = url.searchParams.get("callId");

    if (!deviceId || !this.state.verifyDeviceToken(deviceId, deviceToken)) {
      reject(socket, 401, "Unauthorized");
      return;
    }
    const call = callId ? this.state.getCall(callId) : undefined;
    if (!callId || call?.deviceId !== deviceId) {
      reject(socket, 404, "Not Found");
      return;
    }
    // Koncan klic zvoka ne sprejema vec, tudi ce telefon poskusi znova (N12-3).
    if (isEndedCallState(call.state)) {
      reject(socket, 410, "Gone");
      return;
    }

    this.deviceServer.handleUpgrade(request, socket, head, (ws) => {
      logSocketErrors(ws, "device-media");
      const session = this.session(callId);
      session.device?.close(4000, "replaced by newer connection");
      session.device = ws;
      if (session.client) sendJson(session.client, startMessage(callId));
      for (const monitor of session.monitors) sendJson(monitor, startMessage(callId));

      ws.on("message", (data, isBinary) => {
        if (!isBinary || session.device !== ws) return;
        forwardBinary(session.client, data);
        forwardToMonitors(session, MONITOR_CHANNEL.remote, data);
      });
      ws.on("close", () => {
        if (session.device !== ws) return;
        session.device = undefined;
        const stop = { type: "stop", callId, reason: "device_media_closed" };
        if (session.client) sendJson(session.client, stop);
        for (const monitor of session.monitors) sendJson(monitor, stop);
        this.dropIfEmpty(callId);
      });
    });
  }

  private upgradeClient(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    url: URL,
    callId: string,
  ): void {
    if (!this.auth.isAuthorized(request, url)) {
      reject(socket, 401, "Unauthorized");
      return;
    }
    if (!this.state.getCall(callId)) {
      reject(socket, 404, "Not Found");
      return;
    }

    this.clientServer.handleUpgrade(request, socket, head, (ws) => {
      logSocketErrors(ws, "client-media");
      const session = this.session(callId);
      if (url.searchParams.get("mode") === "listen") {
        this.addMonitor(session, callId, ws);
        return;
      }
      session.client?.close(4000, "replaced by newer connection");
      session.client = ws;
      if (session.device?.readyState === WebSocket.OPEN) sendJson(ws, startMessage(callId));

      ws.on("message", (data, isBinary) => {
        if (session.client !== ws) return;
        if (isBinary) {
          if (!forwardFramed(session.device, data)) {
            // Telefon ne dohaja. Sporocilo zavrzemo v celoti in odjemalcu to povemo.
            sendJson(ws, { type: "dropped", callId, reason: "device_backlog" });
            if (!session.backlogLogged) {
              session.backlogLogged = true;
              console.error("media_backlog", "client-media");
            }
            return;
          }
          forwardToMonitors(session, MONITOR_CHANNEL.injected, data);
          return;
        }
        const message = parseJson(data);
        if (message?.type === "clear") {
          if (session.device) sendJson(session.device, { type: "clear" });
          for (const monitor of session.monitors) sendJson(monitor, { type: "clear" });
        }
      });
      ws.on("close", () => {
        if (session.client !== ws) return;
        session.client = undefined;
        this.dropIfEmpty(callId);
      });
    });
  }

  private addMonitor(session: MediaSession, callId: string, ws: WebSocket): void {
    session.monitors.add(ws);
    if (session.device?.readyState === WebSocket.OPEN) sendJson(ws, startMessage(callId));
    ws.on("close", () => {
      session.monitors.delete(ws);
      this.dropIfEmpty(callId);
    });
  }

  private session(callId: string): MediaSession {
    let session = this.sessions.get(callId);
    if (!session) {
      session = { monitors: new Set() };
      this.sessions.set(callId, session);
    }
    return session;
  }

  private dropIfEmpty(callId: string): void {
    const session = this.sessions.get(callId);
    if (session && !session.device && !session.client && !session.monitors.size) this.sessions.delete(callId);
  }
}

function startMessage(callId: string) {
  return { type: "start", callId, format: MEDIA_FORMAT };
}

function forwardBinary(target: WebSocket | undefined, data: RawData): void {
  if (target?.readyState === WebSocket.OPEN) target.send(data, { binary: true });
}

/**
 * Zvok odjemalca gre telefonu v okvirjih po 20 ms, ne glede na to, kako ga je odjemalec razrezal.
 * Telefon tako nikoli ne dobi sporocila, vecjega od okvirja, zaporedje bajtov pa ostane isto.
 */
export function forwardFramed(
  target: Pick<WebSocket, "readyState" | "bufferedAmount" | "send"> | undefined,
  data: RawData,
): boolean {
  if (target?.readyState !== WebSocket.OPEN) return true;
  const pcm = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
  // Zastoj (N12-8): ce ze caka prevec, sporocila ne razrezemo v se 1639 okvirjev.
  if (target.bufferedAmount + pcm.length > DEVICE_BACKLOG_MAX_BYTES) return false;
  if (pcm.length <= MEDIA_FRAME_BYTES) {
    target.send(pcm, { binary: true });
    return true;
  }
  for (let offset = 0; offset < pcm.length; offset += MEDIA_FRAME_BYTES) {
    target.send(pcm.subarray(offset, offset + MEDIA_FRAME_BYTES), { binary: true });
  }
  return true;
}

/**
 * Brez poslusalca napaka vticnice (npr. preveliko sporocilo) sesuje proces.
 * V dnevnik gresta samo noga in koda napake, nikoli vsebina sporocila ali id.
 */
function logSocketErrors(ws: WebSocket, leg: string): void {
  ws.on("error", (error: Error & { code?: string }) => {
    console.error("ws_error", leg, error.code ?? "unknown");
  });
}

function forwardToMonitors(session: MediaSession, channel: number, data: RawData): void {
  if (!session.monitors.size) return;
  const pcm = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
  const frame = Buffer.concat([Buffer.from([channel]), pcm]);
  for (const monitor of session.monitors) {
    if (monitor.readyState === WebSocket.OPEN) monitor.send(frame, { binary: true });
  }
}

function parseJson(data: RawData): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(data.toString());
    return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function reject(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function headerString(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function sendJson(socket: WebSocket, value: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}
