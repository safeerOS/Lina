import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { AgentManager } from "./agent/agent-manager.js";
import { createApp } from "./app.js";
import { mayTakeOver, type AllowlistMode } from "./allowlist.js";
import { AuthService } from "./auth.js";
import { ConfigStore } from "./config.js";
import { openDatabase, SettingsStore, type Database } from "./db.js";
import { DeviceWebSocketHub } from "./device-channel.js";
import { DeviceEventService } from "./events.js";
import { MediaRelay, ownMediaUrl } from "./media-relay.js";
import { listenHosts } from "./lan.js";
import { StateStore } from "./state.js";
import { StreamManager } from "./stream/stream-manager.js";
import { HttpWebhookDispatcher, type WebhookDispatcher } from "./webhooks.js";

export interface GatewayServerOptions {
  /** Root API key from server/.env; also the one-time setup key for the console password. */
  apiKey: string;
  webhookSecret?: string;
  webhookDispatcher?: WebhookDispatcher;
  /** Defaults from server/.env; the console's Settings page overrides them. */
  defaultWebhookUrl?: string;
  geminiApiKey?: string;
  agentModel?: string;
  agentOwnerName?: string;
  publicUrl?: string;
  docsUrl?: string;
  /** Privzeti tok dohodnih klicev (Lina). Nastavitev v konzoli ga lahko prekrije. */
  incomingStreamUrl?: string;
  /** Zeton Line. Samo v pomnilniku, nikoli v URL. */
  linaStreamToken?: string;
  linaOrigin?: string;
  linaCertSha256?: string;
  /** Seznam dovoljenih dohodnih stevilk. Prazen seznam ob nacinu on ne dovoli nic. */
  allowlist?: readonly string[];
  /** on = samo seznam. off = vse dohodne, tudi neznane, razen stevilk v sili. */
  allowlistMode?: AllowlistMode;
  /** Samopodpisan certifikat. Brez njega testi ostanejo na golem HTTP. */
  tls?: { cert: string; key: string };
  /** Odtis, ki ga QR pokaze ob seznanitvi. */
  certFingerprint?: string;
  /** Directory of the SQLite database. Without it everything is kept in memory (tests). */
  dataDir?: string;
}

export interface GatewayServer {
  httpServer: HttpServer;
  /** Poslusa na HOST in, ce to ni loopback, se na 127.0.0.1 zaradi medijske noge. */
  listen(port: number, host: string): Promise<void>;
  db: Database;
  state: StateStore;
  config: ConfigStore;
  auth: AuthService;
  deviceHub: DeviceWebSocketHub;
  events: DeviceEventService;
  media: MediaRelay;
  agents: AgentManager;
  streams: StreamManager;
}

export function createGatewayServer(options: GatewayServerOptions): GatewayServer {
  const db = openDatabase(options.dataDir);
  const settings = new SettingsStore(db);
  const config = new ConfigStore(settings, {
    geminiApiKey: options.geminiApiKey,
    geminiModel: options.agentModel,
    publicUrl: options.publicUrl,
    webhookUrl: options.defaultWebhookUrl,
    docsUrl: options.docsUrl,
    incomingStreamUrl: options.incomingStreamUrl,
  });
  const auth = new AuthService(db, options.apiKey);
  const state = new StateStore(db);
  const dispatcher =
    options.webhookDispatcher ?? new HttpWebhookDispatcher(options.webhookSecret ?? options.apiKey);
  const events = new DeviceEventService(state, dispatcher, () => config.get("webhookUrl"), db);
  const deviceHub = new DeviceWebSocketHub(state, (deviceId, event) => events.ingest(deviceId, event));
  const media = new MediaRelay(state, auth);
  const allowlist = options.allowlist ?? [];
  const allowlistMode = options.allowlistMode ?? "on";
  let httpServer: HttpServer | undefined;
  const mediaUrl = (callId: string) => {
    const address = httpServer!.address() as AddressInfo;
    return ownMediaUrl(address.port, callId, Boolean(options.tls));
  };
  const streams = new StreamManager({
    state,
    deviceChannel: deviceHub,
    config,
    apiKey: options.apiKey,
    mediaUrl,
    allowlist,
    allowlistMode,
    linaStreamToken: options.linaStreamToken,
    linaOrigin: options.linaOrigin,
    linaCertSha256: options.linaCertSha256,
    mediaCaPem: options.tls?.cert,
    mediaFingerprint: options.certFingerprint,
  });
  const agents = new AgentManager({
    state,
    deviceChannel: deviceHub,
    apiKey: options.apiKey,
    db,
    settings,
    config,
    ownerName: options.agentOwnerName,
    mediaUrl,
    allowlist,
    allowlistMode,
  });
  events.onCallEvent = (call, event) => {
    const streamed = streams.onCallEvent(call, event);
    agents.onCallEvent(state.getCall(call.id) ?? call, event, streamed);
  };
  const app = createApp({
    auth,
    config,
    state,
    deviceChannel: deviceHub,
    events,
    media,
    agents,
    streams,
    certFingerprint: options.certFingerprint,
    mayTakeOverNumber: (number) => mayTakeOver(number, allowlist, allowlistMode),
  });
  httpServer = options.tls
    ? (createHttpsServer({ cert: options.tls.cert, key: options.tls.key }, app) as HttpServer)
    : createHttpServer(app);
  deviceHub.attach(httpServer);
  media.attach(httpServer);
  const extras: HttpServer[] = [];
  function listen(port: number, host: string): Promise<void> {
    const server = httpServer;
    if (!server) return Promise.reject(new Error("http server missing"));
    const hosts = listenHosts(host);
    return new Promise((resolve, reject) => {
      let pending = hosts.length;
      let failed = false;
      const fail = (error: Error) => {
        if (failed) return;
        failed = true;
        server.close();
        for (const extra of extras) extra.close();
        reject(error);
      };
      const done = () => {
        pending -= 1;
        if (!failed && pending === 0) resolve();
      };
      server.once("error", fail);
      server.on("close", () => {
        for (const extra of extras) extra.close();
      });
      server.listen(port, hosts[0], () => {
        const actual = (server.address() as AddressInfo).port;
        for (const extraHost of hosts.slice(1)) {
          const twin = options.tls
            ? (createHttpsServer({ cert: options.tls.cert, key: options.tls.key }, app) as HttpServer)
            : createHttpServer(app);
          extras.push(twin);
          deviceHub.attach(twin);
          media.attach(twin);
          twin.once("error", fail);
          twin.listen(actual, extraHost, done);
        }
        done();
      });
    });
  }
  return { httpServer, listen, db, state, config, auth, deviceHub, events, media, agents, streams };
}
