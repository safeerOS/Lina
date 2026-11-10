import https from "node:https";
import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import { spawn } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { isAllowedLanUrl } from "../src/lan-url.js";
import { mayTakeOver } from "../src/allowlist.js";
import { bindHost, isPrivateBindHost, lanIpv4, listenHosts } from "../src/lan.js";
import { assertLoopbackMediaUrl, ownMediaUrl } from "../src/media-relay.js";
import { linaStreamConfig } from "../src/lina.js";
import { streamSchema, createCallSchema, configSchema } from "../src/schemas.js";
import { createGatewayServer } from "../src/server.js";
import { apiKeyProblem, tlsEnvProblem } from "../src/startup-check.js";
import { loadOrCreateTls } from "../src/tls.js";
import { fingerprintsMatch, mediaTlsOptions, pinnedWsOptions, resolveStreamPin } from "../src/tls-pin.js";
import type { WebhookPayload } from "../src/types.js";
import { HttpWebhookDispatcher } from "../src/webhooks.js";

const require = createRequire(import.meta.url);
const selfsigned = require("selfsigned") as {
  generate: (attrs: { name: string; value: string }[], opts: Record<string, unknown>) => { cert: string; private: string };
};
const serverDir = fileURLToPath(new URL("..", import.meta.url));
const SECRET = "super-secret-lina-token-value";
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

describe("zagon", () => {
  it("zavrne prazen, change-me in prekratek kljuc", () => {
    expect(apiKeyProblem(undefined)).toMatch(/required/);
    expect(apiKeyProblem("")).toMatch(/required/);
    expect(apiKeyProblem("change-me")).toMatch(/change-me/);
    expect(apiKeyProblem("x".repeat(31))).toMatch(/32/);
    expect(apiKeyProblem("x".repeat(32))).toBeNull();
    expect(tlsEnvProblem({ NODE_TLS_REJECT_UNAUTHORIZED: "0" })).toMatch(/NODE_TLS_REJECT_UNAUTHORIZED/);
    expect(tlsEnvProblem({})).toBeNull();
  });

  it("index zavrne change-me, prekratek kljuc in izklopljen TLS", async () => {
    const tsx = path.join(serverDir, "node_modules/tsx/dist/cli.mjs");
    for (const env of [
      { HTTP_GATEWAY_API_KEY: "change-me" },
      { HTTP_GATEWAY_API_KEY: "short-key" },
      { HTTP_GATEWAY_API_KEY: "x".repeat(40), NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    ]) {
      const code = await runIndex(tsx, env);
      expect(code).toBe(1);
    }
  });
});

describe("LAN naslov", () => {
  it("ne izbere javnega IPv4", () => {
    const onlyPublic = { eth0: [{ address: "203.0.113.9", family: "IPv4", internal: false }] };
    expect(lanIpv4(onlyPublic as never)).toBe("127.0.0.1");
    const mixed = {
      eth0: [
        { address: "8.8.8.8", family: "IPv4", internal: false },
        { address: "192.168.1.20", family: "IPv4", internal: false },
        { address: "169.254.1.1", family: "IPv4", internal: false },
      ],
    };
    expect(lanIpv4(mixed as never)).toBe("192.168.1.20");
  });

  it("dovoli samo wss in https na zasebnem naslovu ali localhost", () => {
    expect(isAllowedLanUrl("ws://127.0.0.1/a", ["wss:"])).toBe(false);
    expect(isAllowedLanUrl("wss://8.8.8.8/a", ["wss:"])).toBe(false);
    expect(isAllowedLanUrl("wss://example.com/a", ["wss:"])).toBe(false);
    expect(isAllowedLanUrl("wss://169.254.169.254/a", ["wss:"])).toBe(false);
    expect(isAllowedLanUrl("wss://192.168.1.5/a", ["wss:"])).toBe(true);
    expect(isAllowedLanUrl("wss://127.0.0.1:8080/api/voice/stream", ["wss:"])).toBe(true);
    expect(isAllowedLanUrl("wss://localhost/a", ["wss:"])).toBe(true);
    expect(isAllowedLanUrl("wss://evil.localhost/a", ["wss:"])).toBe(false);
    expect(isAllowedLanUrl("https://a.localhost/h", ["https:"])).toBe(false);
    expect(isAllowedLanUrl("http://127.0.0.1/h", ["https:"])).toBe(false);
    expect(isAllowedLanUrl("https://10.0.0.2/h", ["https:"])).toBe(true);
    expect(isAllowedLanUrl("https://hooks.example.test/h", ["https:"])).toBe(false);
    expect(isAllowedLanUrl(`wss://10.0.0.2/a?token=${SECRET}`, ["wss:"])).toBe(false);
    expect(streamSchema.safeParse({ url: "ws://127.0.0.1/a" }).success).toBe(false);
    expect(streamSchema.safeParse({ url: "wss://1.2.3.4/a" }).success).toBe(false);
    expect(streamSchema.safeParse({ url: "wss://10.1.1.1/a" }).success).toBe(true);
    expect(createCallSchema.safeParse({ deviceId: "d", to: "1", webhookUrl: "http://127.0.0.1/h" }).success).toBe(false);
    expect(configSchema.safeParse({ incomingStreamUrl: "ws://127.0.0.1/a" }).success).toBe(false);
    expect(configSchema.safeParse({ webhookUrl: "https://192.168.0.2/h" }).success).toBe(true);
    expect(createCallSchema.safeParse({ deviceId: "d", to: "1", webhookUrl: "https://hooks.example.test/h" }).success).toBe(false);
    expect(streamSchema.safeParse({ url: "wss://8.8.8.8/a" }).success).toBe(false);
  });

  it("javni webhook se ne poslje, tudi ce je ze zapisan na klicu", async () => {
    const deliveries: string[] = [];
    const gateway = createGatewayServer({
      apiKey: "k".repeat(32),
      defaultWebhookUrl: "https://hooks.example.test/default",
      webhookDispatcher: { async dispatch(url: string) { deliveries.push(url); } },
    });
    gateway.state.upsertDevice({ id: "phone-1" });
    const leaked = gateway.state.createOutgoingCall({
      deviceId: "phone-1",
      to: "1",
      webhookUrl: "https://hooks.example.test/call",
    });
    const stamp = new Date().toISOString();
    await gateway.events.ingest("phone-1", {
      type: "event",
      eventId: "e-pub",
      callId: leaked.id,
      event: "call.ringing",
      timestamp: stamp,
      payload: {},
    });
    expect(deliveries).toEqual([]);

    const local = gateway.state.createOutgoingCall({
      deviceId: "phone-1",
      to: "2",
      webhookUrl: "https://10.1.1.1/hook",
    });
    await gateway.events.ingest("phone-1", {
      type: "event",
      eventId: "e-lan",
      callId: local.id,
      event: "call.active",
      timestamp: stamp,
      payload: {},
    });
    expect(deliveries).toEqual(["https://10.1.1.1/hook"]);
  });

  it("tok na javni wss se ne odpre", () => {
    const gateway = createGatewayServer({ apiKey: "k".repeat(32) });
    gateway.state.upsertDevice({ id: "phone-1" });
    const call = gateway.state.createOutgoingCall({
      deviceId: "phone-1",
      to: "1",
      stream: { url: "wss://8.8.8.8/agent", format: "raw" },
    });
    gateway.state.setCallState(call.id, "active");
    gateway.streams.onCallEvent(gateway.state.getCall(call.id)!, "call.active");
    expect(gateway.streams.info(call.id).status).toBe("waiting");
  });
});

describe("zeton Line", () => {
  it("ni v URL, bazi, nastavitvah ali odgovoru toka", async () => {
    const configured = linaStreamConfig({ LINA_STREAM_TOKEN: SECRET, LINA_STREAM_URL: "wss://127.0.0.1:8080/api/voice/stream" });
    expect(configured?.token).toBe(SECRET);
    expect(configured?.url).not.toContain(SECRET);
    expect(configured?.url).not.toContain("token=");

    const dataDir = mkdtempSync(path.join(tmpdir(), "gw-sec-"));
    const gateway = createGatewayServer({
      apiKey: "test-api-key",
      dataDir,
      incomingStreamUrl: `wss://127.0.0.1:8080/api/voice/stream?token=${SECRET}`,
      linaStreamToken: SECRET,
      linaOrigin: "wss://127.0.0.1:8080",
    });
    expect(gateway.config.get("incomingStreamUrl")).not.toContain(SECRET);
    expect(JSON.stringify(gateway.config.view())).not.toContain(SECRET);

    gateway.config.update({ incomingStreamUrl: `wss://10.0.0.5/agent?token=${SECRET}` });
    const settings = gateway.db.prepare("SELECT value FROM settings").all() as { value: string }[];
    expect(JSON.stringify(settings)).not.toContain(SECRET);
    expect(gateway.config.view().incomingStreamUrl).toBe("wss://10.0.0.5/agent");

    gateway.state.upsertDevice({ id: "phone-1" });
    const call = gateway.state.createOutgoingCall({
      deviceId: "phone-1",
      to: "1",
      stream: { url: `wss://10.0.0.8/a?token=${SECRET}`, format: "raw", token: SECRET },
    });
    expect(JSON.stringify(call)).not.toContain(SECRET);
    const row = gateway.db.prepare("SELECT stream FROM calls WHERE id = ?").get(call.id) as { stream: string };
    expect(row.stream).not.toContain(SECRET);

    await listen(gateway);
    cleanup.push(() => gateway.httpServer.close());
    const base = `http://127.0.0.1:${(gateway.httpServer.address() as AddressInfo).port}`;
    const settingsBody = await (await fetch(`${base}/v1/settings`, { headers: { "x-api-key": "test-api-key" } })).text();
    expect(settingsBody).not.toContain(SECRET);
    const streamBody = await (await fetch(`${base}/v1/calls/${call.id}/stream`, { headers: { "x-api-key": "test-api-key" } })).text();
    expect(streamBody).not.toContain(SECRET);

    const queried = await request(gateway.httpServer).get("/v1/devices").query({ apiKey: "test-api-key" });
    expect(queried.status).toBe(401);
    const header = await request(gateway.httpServer).get("/v1/devices").set("x-api-key", "test-api-key");
    expect(header.status).toBe(200);
  });
});

describe("pripetje TLS", () => {
  it("napacen odtis ne sprejme HTTP, pravi pa", async () => {
    const pems = selfsigned.generate([{ name: "commonName", value: "127.0.0.1" }], {
      algorithm: "sha256",
      keySize: 2048,
      days: 1,
      extensions: [{ name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }] }],
    });
    const fingerprint = new X509Certificate(pems.cert).fingerprint256.replace(/:/g, "").toLowerCase();
    let httpSeen = 0;
    const server = https.createServer({ cert: pems.cert, key: pems.private }, (_req, res) => {
      httpSeen += 1;
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    cleanup.push(() => server.close());
    const port = (server.address() as AddressInfo).port;

    const wrong = await httpsGet(port, pinnedWsOptions("ab".repeat(32)));
    expect(wrong).toMatch(/odtis|error|ECONNRESET|socket/i);
    expect(httpSeen).toBe(0);

    const right = await httpsGet(port, pinnedWsOptions(fingerprint));
    expect(right).toBe("ok");
    expect(httpSeen).toBe(1);

    const foreign = selfsigned.generate([{ name: "commonName", value: "127.0.0.1" }], {
      algorithm: "sha256",
      keySize: 2048,
      days: 1,
      extensions: [{ name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }] }],
    });
    expect(() => mediaTlsOptions(foreign.cert, fingerprint)).toThrow(/odtis/);
    const mismatched = await httpsGet(port, mediaTlsOptions(foreign.cert, new X509Certificate(foreign.cert).fingerprint256));
    expect(mismatched).toMatch(/certificate|error|self-signed|unable/i);
    expect(httpSeen).toBe(1);
  });

  it("tok na Lino brez odtisa se ne odpre in ne poslje kljuca", async () => {
    let sawKey = false;
    const pems = selfsigned.generate([{ name: "commonName", value: "127.0.0.1" }], {
      algorithm: "sha256",
      keySize: 2048,
      days: 1,
      extensions: [{ name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }] }],
    });
    const httpsServer = https.createServer({ cert: pems.cert, key: pems.private });
    const wss = new WebSocketServer({ server: httpsServer });
    wss.on("connection", (_ws, req) => {
      if (req.headers["x-api-key"] || req.headers.authorization) sawKey = true;
    });
    httpsServer.on("request", (req) => {
      if (req.headers["x-api-key"] || req.headers.authorization) sawKey = true;
    });
    await new Promise<void>((resolve) => httpsServer.listen(0, "127.0.0.1", () => resolve()));
    const port = (httpsServer.address() as AddressInfo).port;
    const origin = `wss://127.0.0.1:${port}`;
    cleanup.push(() => {
      wss.close();
      httpsServer.close();
    });

    const gateway = createGatewayServer({
      apiKey: "k".repeat(32),
      linaOrigin: origin,
      linaStreamToken: SECRET,
    });
    await listen(gateway);
    cleanup.push(() => gateway.httpServer.close());
    gateway.state.upsertDevice({ id: "phone-1" });
    const call = gateway.state.createOutgoingCall({
      deviceId: "phone-1",
      to: "1",
      stream: { url: `${origin}/api/voice/stream`, format: "raw" },
    });
    gateway.state.setCallState(call.id, "active");
    gateway.streams.onCallEvent(gateway.state.getCall(call.id)!, "call.active");
    await new Promise((r) => setTimeout(r, 200));
    expect(sawKey).toBe(false);
  });
});

describe("konzola in zaklep", () => {
  it("nima Google Fonts in zagon uporablja npm ci", async () => {
    const html = readFileSync(path.join(serverDir, "public/console.html"), "utf8");
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).toContain("/fonts/public_sans_regular.ttf");
    expect(html).toContain("/console-i18n.js");
    expect(html).toContain('class="ol-lang"');
    expect(html).toContain("Slovenščina");
    const i18n = readFileSync(path.join(serverDir, "public/console-i18n.js"), "utf8");
    expect(i18n).toContain("openline.lang");
    expect(i18n).toContain("Prijava");
    const bat = readFileSync(path.join(serverDir, "../run-server.bat"), "utf8");
    expect(bat).toContain("npm ci");
    expect(bat).not.toContain("npm install");
    const pkg = JSON.parse(readFileSync(path.join(serverDir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@google/genai"]).toBeUndefined();
    for (const version of [...Object.values(pkg.dependencies), ...Object.values(pkg.devDependencies)]) {
      expect(version).not.toMatch(/[\^~]/);
    }
    // Zaklep mora slediti package.json. Stari zaklep je se imel @google/genai in ^ razpone,
    // zato npm ci ne namesti zaklenjenih razlicic.
    const lock = JSON.parse(readFileSync(path.join(serverDir, "package-lock.json"), "utf8")) as {
      packages: { "": { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } };
    };
    const lockedRoot = lock.packages[""];
    expect(lockedRoot.dependencies?.["@google/genai"]).toBeUndefined();
    expect(JSON.stringify(lock)).not.toContain("@google/genai");
    expect(lockedRoot.dependencies).toEqual(pkg.dependencies);
    expect(lockedRoot.devDependencies).toEqual(pkg.devDependencies);
    const gateway = createGatewayServer({ apiKey: "test-api-key" });
    expect(gateway).toBeTruthy();
    const app = (await import("../src/app.js")).createApp;
    expect(app).toBeTypeOf("function");
    await listen(gateway);
    cleanup.push(() => gateway.httpServer.close());
    const base = `http://127.0.0.1:${(gateway.httpServer.address() as AddressInfo).port}`;
    const page = await (await fetch(base)).text();
    expect(page).not.toContain("fonts.googleapis.com");
    const font = await fetch(`${base}/fonts/public_sans_regular.ttf`);
    expect(font.status).toBe(200);
    const i18nPage = await fetch(`${base}/console-i18n.js`);
    expect(i18nPage.status).toBe(200);
    expect(await i18nPage.text()).toContain("openline.lang");
    expect(gateway.httpServer).toBeTruthy();
  });
});

describe("meje streznika", () => {
  it("fetch ne sledi preusmeritvi", async () => {
    let followed = false;
    const dest = http.createServer((_req, res) => {
      followed = true;
      res.writeHead(200);
      res.end("ok");
    });
    await new Promise<void>((resolve) => dest.listen(0, "127.0.0.1", () => resolve()));
    const destPort = (dest.address() as AddressInfo).port;
    const src = http.createServer((_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${destPort}/stolen` });
      res.end();
    });
    await new Promise<void>((resolve) => src.listen(0, "127.0.0.1", () => resolve()));
    const srcPort = (src.address() as AddressInfo).port;
    cleanup.push(() => {
      dest.close();
      src.close();
    });
    const dispatcher = new HttpWebhookDispatcher("x".repeat(32));
    const payload = {
      event: "call.ended",
      eventId: "e1",
      occurredAt: new Date().toISOString(),
      device: { id: "d", connected: false, registeredAt: "t", lastSeenAt: "t" },
      call: {
        id: "c",
        deviceId: "d",
        remoteNumber: "1",
        direction: "outgoing",
        state: "ended",
        createdAt: "t",
        updatedAt: "t",
      },
      payload: {},
    } as WebhookPayload;
    await expect(dispatcher.dispatch(`http://127.0.0.1:${srcPort}/hook`, payload)).rejects.toThrow();
    expect(followed).toBe(false);
  });

  it("privzeti HOST je 127.0.0.1 in potrdilo ni vezano na DHCP", async () => {
    expect(bindHost(undefined)).toBe("127.0.0.1");
    expect(bindHost("")).toBe("127.0.0.1");
    expect(bindHost("192.168.1.20")).toBe("192.168.1.20");
    expect(bindHost("10.1.2.3")).toBe("10.1.2.3");
    expect(bindHost("172.16.0.2")).toBe("172.16.0.2");
    expect(isPrivateBindHost("127.0.0.1")).toBe(true);
    expect(() => bindHost("8.8.8.8")).toThrow(/HOST/);
    expect(() => bindHost("1.2.3.4")).toThrow(/HOST/);
    expect(() => bindHost("172.32.0.1")).toThrow(/HOST/);
    expect(() => bindHost("0.0.0.0")).toThrow(/HOST/);
    expect(() => bindHost("::")).toThrow(/HOST/);
    expect(() => bindHost("[::]")).toThrow(/HOST/);
    expect(() => bindHost("*")).toThrow(/HOST/);

    const dir = mkdtempSync(path.join(tmpdir(), "gw-tls-"));
    const material = loadOrCreateTls(dir, "192.168.1.50");
    const cert = new X509Certificate(material.cert);
    const san = `${cert.subjectAltName ?? ""} ${cert.subject}`;
    expect(san).not.toContain("192.168.1.50");
    expect(san.toLowerCase()).toContain("localhost");
    expect(san).toContain("127.0.0.1");

    const tsx = path.join(serverDir, "node_modules/tsx/dist/cli.mjs");
    const denied = await runIndex(tsx, { HTTP_GATEWAY_API_KEY: "y".repeat(40), HOST: "0.0.0.0" });
    expect(denied).toBe(1);
    const port = await freePort();
    const line = await captureIndex(tsx, { HTTP_GATEWAY_API_KEY: "y".repeat(40), PORT: String(port) });
    expect(line).toMatch(new RegExp(`https://127\\.0\\.0\\.1:${port}`));
    expect(line).not.toContain("172.16.0.2");
  });

  it("zahteva in okolje ne prepiseta uporabnikovega odtisa Line", async () => {
    const user = "ab".repeat(32);
    const env = "cd".repeat(32);
    const requestPin = "ef".repeat(32);
    expect(resolveStreamPin({ forLina: true, requestPin, envPin: env, userPin: user })).toBe(user);
    expect(resolveStreamPin({ forLina: true, requestPin, envPin: env })).toBe(env);
    expect(resolveStreamPin({ forLina: true, requestPin })).toBeUndefined();
    expect(resolveStreamPin({ forLina: false, requestPin, envPin: env, userPin: user })).toBe(requestPin);

    const attacker = selfsigned.generate([{ name: "commonName", value: "127.0.0.1" }], {
      algorithm: "sha256",
      keySize: 2048,
      days: 1,
      extensions: [{ name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }] }],
    });
    const attackerFp = new X509Certificate(attacker.cert).fingerprint256.replace(/:/g, "").toLowerCase();
    const httpsServer = https.createServer({ cert: attacker.cert, key: attacker.private });
    const wss = new WebSocketServer({ server: httpsServer });
    let connected = false;
    wss.on("connection", () => {
      connected = true;
    });
    await new Promise<void>((resolve) => httpsServer.listen(0, "127.0.0.1", () => resolve()));
    cleanup.push(() => {
      wss.close();
      httpsServer.close();
    });
    const port = (httpsServer.address() as AddressInfo).port;
    const origin = `wss://127.0.0.1:${port}`;
    const gateway = createGatewayServer({
      apiKey: "k".repeat(32),
      linaOrigin: origin,
      linaCertSha256: attackerFp,
    });
    gateway.config.update({ linaCertSha256: user });
    expect(gateway.config.explicit("linaCertSha256")).toBe(user);
    await listen(gateway);
    cleanup.push(() => gateway.httpServer.close());
    gateway.state.upsertDevice({ id: "phone-1" });
    const call = gateway.state.createOutgoingCall({
      deviceId: "phone-1",
      to: "+100",
      stream: { url: `${origin}/ws`, format: "raw", tlsSha256: attackerFp },
    });
    gateway.state.setCallState(call.id, "active");
    gateway.streams.onCallEvent(gateway.state.getCall(call.id)!, "call.active");
    await new Promise((r) => setTimeout(r, 400));
    expect(connected).toBe(false);
    expect(gateway.streams.info(call.id).status).not.toBe("live");
  });

  it("lastna medijska noga gre na 127.0.0.1 in preveri odtis namesto imena", async () => {
    expect(ownMediaUrl(8787, "klic", true)).toBe("wss://127.0.0.1:8787/v1/calls/klic/media");
    expect(ownMediaUrl(8787, "klic", true)).not.toMatch(/10\.\d+/);
    const dir = mkdtempSync(path.join(tmpdir(), "gw-pin-"));
    const material = loadOrCreateTls(dir, "10.9.8.7");
    const secure = https.createServer({ cert: material.cert, key: material.key });
    await new Promise<void>((resolve) => secure.listen(0, "127.0.0.1", () => resolve()));
    cleanup.push(() => secure.close());
    const port = (secure.address() as AddressInfo).port;
    await new Promise<void>((resolve, reject) => {
      const socket = tls.connect(
        {
          host: "127.0.0.1",
          port,
          servername: "evil.example",
          ...mediaTlsOptions(material.cert, material.fingerprint256),
        },
        () => {
          socket.end();
          resolve();
        },
      );
      socket.on("error", reject);
    });
    expect(() => mediaTlsOptions(material.cert, "ab".repeat(32))).toThrow(/odtis/);
    expect(fingerprintsMatch(material.fingerprint256, material.fingerprint256.toUpperCase())).toBe(true);
    expect(fingerprintsMatch("ab".repeat(32), "cd".repeat(32))).toBe(false);
  });

  it("HOST na LAN poslusa tudi na 127.0.0.1, da medijska noga po dvigu ne pade", async () => {
    expect(listenHosts("192.168.1.20")).toEqual(["192.168.1.20", "127.0.0.1"]);
    expect(listenHosts("10.1.2.3")).toEqual(["10.1.2.3", "127.0.0.1"]);
    expect(listenHosts("127.0.0.1")).toEqual(["127.0.0.1"]);
    expect(listenHosts("localhost")).toEqual(["127.0.0.1"]);
    expect(() => assertLoopbackMediaUrl("wss://192.168.1.20:8787/v1/calls/klic/media")).toThrow(/loopback/);
    expect(() => assertLoopbackMediaUrl(ownMediaUrl(8787, "klic", true))).not.toThrow();

    // 127.0.0.2 je se loopback jedra, a ni 127.0.0.1: isto kot HOST=LAN, ki sam ne sprejme noge.
    const dir = mkdtempSync(path.join(tmpdir(), "gw-lan-"));
    const material = loadOrCreateTls(dir, "192.168.1.20");
    const gateway = createGatewayServer({
      apiKey: "test-api-key",
      tls: { cert: material.cert, key: material.key },
      certFingerprint: material.fingerprint256,
    });
    await gateway.listen(0, "127.0.0.2");
    cleanup.push(() => gateway.httpServer.close());
    const port = (gateway.httpServer.address() as AddressInfo).port;
    await new Promise<void>((resolve, reject) => {
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.end();
        resolve();
      });
      socket.on("error", reject);
    });
    expect(ownMediaUrl(port, "klic", true)).toBe(`wss://127.0.0.1:${port}/v1/calls/klic/media`);
  });

  it("PUT nastavitev ne zamenja odtisa in naslova brez potrditve", async () => {
    const gateway = createGatewayServer({
      apiKey: "test-api-key",
      incomingStreamUrl: "wss://127.0.0.1:8080/api/voice/stream",
    });
    const root = { "x-api-key": "test-api-key" };
    const deniedUrl = await request(gateway.httpServer)
      .put("/v1/settings")
      .set(root)
      .send({ incomingStreamUrl: "wss://10.0.0.8/agent" });
    expect(deniedUrl.status).toBe(409);
    expect(gateway.config.get("incomingStreamUrl")).toContain("127.0.0.1");
    const pin = "ab".repeat(32);
    const deniedPin = await request(gateway.httpServer).put("/v1/settings").set(root).send({ linaCertSha256: pin });
    expect(deniedPin.status).toBe(409);
    expect(gateway.config.explicit("linaCertSha256")).toBeUndefined();
    const saved = await request(gateway.httpServer).put("/v1/settings").set(root).send({
      incomingStreamUrl: "wss://10.0.0.8/agent",
      confirmIncomingStreamUrl: true,
    });
    expect(saved.status).toBe(200);
    expect(gateway.config.get("incomingStreamUrl")).toBe("wss://10.0.0.8/agent");
  });

  it("REST answer gre skozi mayTakeOver: skrita stevilka in 112", async () => {
    expect(mayTakeOver("", [], "off")).toBe(true);
    expect(mayTakeOver("unknown", [], "off")).toBe(true);
    expect(mayTakeOver("112", [], "off")).toBe(false);

    const closed = createGatewayServer({ apiKey: "test-api-key", allowlist: ["+99955501999"], allowlistMode: "on" });
    closed.state.upsertDevice({ id: "phone-1" });
    await closed.events.ingest("phone-1", {
      type: "event",
      eventId: "h1",
      callId: "call-hidden",
      event: "call.ringing",
      timestamp: new Date().toISOString(),
      payload: { direction: "incoming", number: "" },
    });
    const hiddenOn = await request(closed.httpServer)
      .post("/v1/calls/call-hidden/answer")
      .set("x-api-key", "test-api-key");
    expect(hiddenOn.status).toBe(409);
    expect(hiddenOn.body.error.code).toBe("NOT_ALLOWLISTED");

    const open = createGatewayServer({ apiKey: "test-api-key", allowlist: [], allowlistMode: "off" });
    open.state.upsertDevice({ id: "phone-1" });
    await open.events.ingest("phone-1", {
      type: "event",
      eventId: "h2",
      callId: "call-hidden",
      event: "call.ringing",
      timestamp: new Date().toISOString(),
      payload: { direction: "incoming", number: "" },
    });
    await open.events.ingest("phone-1", {
      type: "event",
      eventId: "h3",
      callId: "call-112",
      event: "call.ringing",
      timestamp: new Date().toISOString(),
      payload: { direction: "incoming", number: "112" },
    });
    const hiddenOff = await request(open.httpServer)
      .post("/v1/calls/call-hidden/answer")
      .set("x-api-key", "test-api-key");
    expect(hiddenOff.status).toBe(409);
    expect(hiddenOff.body.error.code).toBe("DEVICE_OFFLINE");
    const emergency = await request(open.httpServer)
      .post("/v1/calls/call-112/answer")
      .set("x-api-key", "test-api-key");
    expect(emergency.status).toBe(409);
    expect(emergency.body.error.code).toBe("NOT_ALLOWLISTED");
  });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

function captureIndex(tsx: string, extra: Record<string, string>): Promise<string> {
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATA_DIR: mkdtempSync(path.join(tmpdir(), "gw-boot-")),
      ...extra,
    };
    delete env.HOST;
    const child = spawn(process.execPath, [tsx, "src/index.ts"], {
      cwd: serverDir,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
      resolve(buf);
    };
    const timer = setTimeout(finish, 4000);
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      if (buf.includes("OpenLine slusa")) {
        clearTimeout(timer);
        finish();
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", () => {
      clearTimeout(timer);
      finish();
    });
  });
}

function listen(gateway: { httpServer: import("node:http").Server }): Promise<void> {
  return new Promise((resolve, reject) => {
    gateway.httpServer.once("error", reject);
    gateway.httpServer.listen(0, "127.0.0.1", () => resolve());
  });
}

function httpsGet(port: number, options: Record<string, unknown>): Promise<string> {
  return new Promise((resolve) => {
    const req = https.get({ host: "127.0.0.1", port, ...options }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk as Buffer));
      res.on("end", () => resolve(Buffer.concat(chunks).toString() || "ok"));
    });
    req.on("error", (error) => resolve(error.message));
  });
}

function runIndex(tsx: string, extra: Record<string, string>): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tsx, "src/index.ts"], {
      cwd: serverDir,
      env: { ...process.env, HOST: "127.0.0.1", DATA_DIR: mkdtempSync(path.join(tmpdir(), "gw-boot-")), ...extra },
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, 4000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}
