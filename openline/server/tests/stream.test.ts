import type { AddressInfo } from "node:net";
import https from "node:https";
import { X509Certificate } from "node:crypto";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { createGatewayServer, type GatewayServer } from "../src/server.js";
import { linearToMulaw, mulawToLinear, MulawUpsampler, pcm16kToMulaw8k } from "../src/stream/codec.js";
import type { WebhookDispatcher } from "../src/webhooks.js";

const require = createRequire(import.meta.url);
const selfsigned = require("selfsigned") as {
  generate: (attrs: { name: string; value: string }[], opts: Record<string, unknown>) => { cert: string; private: string };
};

const API_KEY = "test-api-key";
const noWebhooks: WebhookDispatcher = { dispatch: async () => undefined };
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

describe("mu-law codec", () => {
  it("round-trips samples within G.711 precision and converts rates", () => {
    for (const sample of [0, 100, -100, 1000, -5000, 20000, -32000]) {
      const back = mulawToLinear(linearToMulaw(sample));
      expect(Math.abs(back - sample)).toBeLessThanOrEqual(Math.max(8, Math.abs(sample) * 0.07));
    }
    expect(pcm16kToMulaw8k(Buffer.alloc(640))).toHaveLength(160); // 20 ms
    expect(new MulawUpsampler().process(Buffer.alloc(160, 0xff))).toHaveLength(640);
  });
});

describe("agent streams", () => {
  it("dials out to the agent in Twilio format, relays audio and marks, and hangs up when the agent leaves", async () => {
    const pems = selfsigned.generate([{ name: "commonName", value: "127.0.0.1" }], {
      algorithm: "sha256",
      keySize: 2048,
      days: 1,
      extensions: [{ name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }] }],
    });
    const tlsSha256 = new X509Certificate(pems.cert).fingerprint256.replace(/:/g, "").toLowerCase();
    const httpsServer = https.createServer({ cert: pems.cert, key: pems.private });
    const agentServer = new WebSocketServer({ server: httpsServer });
    cleanup.push(() => {
      agentServer.close();
      httpsServer.close();
    });
    await new Promise<void>((resolve) => httpsServer.listen(0, "127.0.0.1", () => resolve()));
    const agentUrl = `wss://127.0.0.1:${(httpsServer.address() as AddressInfo).port}/ws`;
    const agentMessages: Record<string, unknown>[] = [];
    const agentSocket = new Promise<WebSocket>((resolve) =>
      agentServer.on("connection", (ws) => {
        ws.on("message", (data) => agentMessages.push(JSON.parse(data.toString()) as Record<string, unknown>));
        resolve(ws);
      }),
    );

    const gateway = createGatewayServer({ apiKey: API_KEY, webhookDispatcher: noWebhooks });
    await listen(gateway);
    cleanup.push(() => gateway.httpServer.close());
    const base = `http://127.0.0.1:${(gateway.httpServer.address() as AddressInfo).port}`;
    const wsBase = base.replace("http", "ws");

    const registration = await fetch(`${base}/v1/devices`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({ deviceId: "phone-1" }),
    });
    const { deviceToken } = (await registration.json()) as { deviceToken: string };
    const channel = new WebSocket(`${wsBase}/v1/device-channel`, {
      headers: { "x-device-id": "phone-1", "x-device-token": deviceToken },
    });
    cleanup.push(() => channel.close());
    await once(channel, "open");
    const commands: Record<string, unknown>[] = [];
    channel.on("message", (data) => commands.push(JSON.parse(data.toString()) as Record<string, unknown>));

    const bad = await fetch(`${base}/v1/calls`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({ deviceId: "phone-1", to: "+919876543210", stream: { url: "https://not-ws" } }),
    });
    expect(bad.status).toBe(400);

    const created = await fetch(`${base}/v1/calls`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({
        deviceId: "phone-1",
        to: "+919876543210",
        stream: { url: agentUrl, format: "twilio", parameters: { campaign: "demo" }, tlsSha256 },
      }),
    });
    expect(created.status).toBe(202);
    const { call } = (await created.json()) as { call: { id: string; stream: unknown } };
    expect(call.stream).toMatchObject({ url: agentUrl, format: "twilio" });

    // The phone reports the call connected and opens its media leg.
    channel.send(JSON.stringify({
      type: "event", eventId: "e1", callId: call.id, event: "call.active",
      timestamp: new Date().toISOString(), payload: { direction: "outgoing" },
    }));
    const agent = await agentSocket;
    const device = new WebSocket(`${wsBase}/v1/device-media?callId=${call.id}`, {
      headers: { "x-device-id": "phone-1", "x-device-token": deviceToken },
    });
    cleanup.push(() => device.close());
    await once(device, "open");
    await until(() => agentMessages.some((m) => m.event === "start"));
    expect(agentMessages[0]).toMatchObject({ event: "connected" });
    expect(agentMessages.find((m) => m.event === "start")).toMatchObject({
      start: {
        callSid: call.id,
        mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
        customParameters: { campaign: "demo", direction: "outgoing", remoteNumber: "+919876543210" },
      },
    });

    // Caller audio: 20 ms of 16 kHz PCM becomes 160 bytes of mu-law.
    device.send(Buffer.alloc(640), { binary: true });
    await until(() => agentMessages.some((m) => m.event === "media"));
    const media = agentMessages.find((m) => m.event === "media") as { media: { payload: string; track: string } };
    expect(media.media.track).toBe("inbound");
    expect(Buffer.from(media.media.payload, "base64")).toHaveLength(160);

    // Agent audio reaches the phone as 20 ms frames; the mark comes back after it has played.
    const phoneFrames: Buffer[] = [];
    device.on("message", (data, isBinary) => isBinary && phoneFrames.push(data as Buffer));
    agent.send(JSON.stringify({ event: "media", streamSid: "x", media: { payload: Buffer.alloc(320, 0xff).toString("base64") } }));
    agent.send(JSON.stringify({ event: "mark", streamSid: "x", mark: { name: "turn-1" } }));
    await until(() => phoneFrames.length === 2);
    expect(phoneFrames.every((f) => f.length === 640)).toBe(true);
    await until(() => agentMessages.some((m) => m.event === "mark"));
    expect(agentMessages.find((m) => m.event === "mark")).toMatchObject({ mark: { name: "turn-1" } });

    const info = await (await fetch(`${base}/v1/calls/${call.id}/stream`, { headers: { "x-api-key": API_KEY } })).json();
    expect(info).toMatchObject({ status: "live", stream: { format: "twilio" } });

    // The agent hangs up by closing its socket.
    agent.close();
    await until(() => commands.some((c) => c.action === "hangup"));
  });

  it("answers incoming calls and streams them to the agent set in Settings", async () => {
    const gateway = createGatewayServer({
      apiKey: API_KEY,
      webhookDispatcher: noWebhooks,
      allowlist: ["+911111111111"],
    });
    gateway.config.update({ incomingStreamUrl: "wss://127.0.0.1:9/agent", incomingStreamFormat: "raw" });
    gateway.state.upsertDevice({ id: "phone-1" });
    const sent: { action: string }[] = [];
    (gateway.deviceHub as unknown as { send: (id: string, input: { action: string }) => void }).send = (_id, input) => {
      sent.push(input);
    };
    gateway.agents.updateSettings({ autoAnswer: true });

    await gateway.events.ingest("phone-1", {
      type: "event", eventId: "r1", callId: "call-in-1", event: "call.ringing",
      timestamp: new Date().toISOString(), payload: { direction: "incoming", number: "+911111111111" },
    });
    expect(gateway.state.getCall("call-in-1")?.stream).toEqual({ url: "wss://127.0.0.1:9/agent", format: "raw" });
    await until(() => sent.length > 0, 3000);
    expect(sent).toEqual([expect.objectContaining({ action: "answer" })]); // once: the assistant stays out
  });

  it("po padcu zvoka poslje hangup", async () => {
    const pems = selfsigned.generate([{ name: "commonName", value: "127.0.0.1" }], {
      algorithm: "sha256",
      keySize: 2048,
      days: 1,
      extensions: [{ name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }] }],
    });
    const tlsSha256 = new X509Certificate(pems.cert).fingerprint256.replace(/:/g, "").toLowerCase();
    const httpsServer = https.createServer({ cert: pems.cert, key: pems.private });
    const agentServer = new WebSocketServer({ server: httpsServer });
    cleanup.push(() => {
      agentServer.close();
      httpsServer.close();
    });
    await new Promise<void>((resolve) => httpsServer.listen(0, "127.0.0.1", () => resolve()));
    const agentUrl = `wss://127.0.0.1:${(httpsServer.address() as AddressInfo).port}/ws`;
    agentServer.on("connection", () => undefined);

    const gateway = createGatewayServer({ apiKey: API_KEY, webhookDispatcher: noWebhooks });
    await listen(gateway);
    cleanup.push(() => gateway.httpServer.close());
    const port = (gateway.httpServer.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const registration = await fetch(`${base}/v1/devices`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({ deviceId: "phone-1" }),
    });
    const { deviceToken } = (await registration.json()) as { deviceToken: string };
    const channel = new WebSocket(`ws://127.0.0.1:${port}/v1/device-channel`, {
      headers: { "x-device-id": "phone-1", "x-device-token": deviceToken },
    });
    cleanup.push(() => channel.close());
    await once(channel, "open");
    const commands: { action?: string }[] = [];
    channel.on("message", (data) => commands.push(JSON.parse(data.toString()) as { action?: string }));

    const created = await fetch(`${base}/v1/calls`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({
        deviceId: "phone-1",
        to: "+15555550100",
        stream: { url: agentUrl, format: "raw", tlsSha256 },
      }),
    });
    expect(created.status).toBe(202);
    const { call } = (await created.json()) as { call: { id: string } };
    channel.send(JSON.stringify({
      type: "event",
      eventId: "e-live",
      callId: call.id,
      event: "call.active",
      timestamp: new Date().toISOString(),
      payload: { direction: "outgoing" },
    }));
    const device = new WebSocket(`ws://127.0.0.1:${port}/v1/device-media?callId=${call.id}`, {
      headers: { "x-device-id": "phone-1", "x-device-token": deviceToken },
    });
    cleanup.push(() => device.close());
    await once(device, "open");
    await until(() => gateway.streams.info(call.id).status === "live", 3000);
    device.close();
    await until(() => commands.some((command) => command.action === "hangup"), 3000);
  });
});

function listen(gateway: GatewayServer): Promise<void> {
  return new Promise((resolve, reject) => {
    gateway.httpServer.once("error", reject);
    gateway.httpServer.listen(0, "127.0.0.1", resolve);
  });
}

function once(socket: WebSocket, event: "open"): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once(event, () => resolve());
    socket.once("error", reject);
  });
}

async function until(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}
