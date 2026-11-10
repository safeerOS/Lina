import { describe, expect, it, vi, afterEach } from "vitest";
import WebSocket from "ws";
import { createGatewayServer, type GatewayServer } from "../src/server.js";
import {
  CLIENT_MEDIA_MAX_PAYLOAD,
  DEVICE_MEDIA_MAX_PAYLOAD,
  MEDIA_FRAME_BYTES,
} from "../src/media-relay.js";
import { DEVICE_CHANNEL_MAX_PAYLOAD } from "../src/device-channel.js";
import type { AddressInfo } from "node:net";

const API_KEY = "test-api-key";
const DEVICE_ID = "phone-1";
const DEVICE_TOKEN = "device-token-for-media-tests";

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
  vi.restoreAllMocks();
});

async function startGateway(): Promise<{ gateway: GatewayServer; port: number; callId: string }> {
  const gateway = createGatewayServer({ apiKey: API_KEY });
  await new Promise<void>((resolve, reject) => {
    gateway.httpServer.once("error", reject);
    gateway.httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  cleanup.push(() => gateway.httpServer.close());
  const port = (gateway.httpServer.address() as AddressInfo).port;
  gateway.state.upsertDevice({ id: DEVICE_ID });
  gateway.state.setDeviceToken(DEVICE_ID, DEVICE_TOKEN);
  const call = gateway.state.createOutgoingCall({ deviceId: DEVICE_ID, to: "1" });
  return { gateway, port, callId: call.id };
}

async function open(url: string, headers: Record<string, string>): Promise<WebSocket> {
  const ws = new WebSocket(url, { headers });
  cleanup.push(() => ws.terminate());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  // Odjemalec ob zaprtju s kodo 1009 ne sme vreci neujete napake v preizkusu.
  ws.on("error", () => {});
  return ws;
}

const openClient = (port: number, callId: string) =>
  open(`ws://127.0.0.1:${port}/v1/calls/${callId}/media`, { "x-api-key": API_KEY });

const openDevice = (port: number, callId: string) =>
  open(`ws://127.0.0.1:${port}/v1/device-media?callId=${callId}`, {
    "x-device-id": DEVICE_ID,
    "x-device-token": DEVICE_TOKEN,
  });

const closed = (ws: WebSocket) =>
  new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));

function nextJson(ws: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) return;
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      if (message.type !== type) return;
      ws.off("message", onMessage);
      resolve(message);
    };
    ws.on("message", onMessage);
  });
}

/** Zbira binarna sporocila, dokler ne pride `total` bajtov. */
function collectBinary(ws: WebSocket, total: number): Promise<Buffer[]> {
  return new Promise((resolve) => {
    const frames: Buffer[] = [];
    let received = 0;
    const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      if (!isBinary) return;
      const frame = data as Buffer;
      frames.push(frame);
      received += frame.length;
      if (received < total) return;
      ws.off("message", onMessage);
      resolve(frames);
    };
    ws.on("message", onMessage);
  });
}

function logged(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls.map((call) => call.map(String).join(" "));
}

async function alive(port: number): Promise<number> {
  return (await fetch(`http://127.0.0.1:${port}/health`)).status;
}

describe("media relay", () => {
  it("survives 70kB message on /media and logs error code", async () => {
    // Krog 12: meja noge odjemalca je 1 MiB (prej 64 KiB), zato 70 kB ni vec preveliko sporocilo.
    // Preizkus ostane isti: sporocilo nad mejo zapre povezavo, streznik zivi, v dnevniku je koda.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { port, callId } = await startGateway();
    const ws = await openClient(port, callId);

    const closing = closed(ws);
    ws.send(Buffer.alloc(CLIENT_MEDIA_MAX_PAYLOAD + 1, "a"));
    expect(await closing).toBe(1009);

    expect(ws.readyState).not.toBe(WebSocket.OPEN);
    expect(logged(errorSpy)).toContain("ws_error client-media WS_ERR_UNSUPPORTED_MESSAGE_LENGTH");
    expect(await alive(port)).toBe(200);
  });

  it("meje sporocil: telefon 8 KiB, odjemalec 1 MiB, nadzorni kanal 64 KiB", () => {
    // Telefon poslje okvir 640 B (MediaStream.FRAME_BYTES); meja mora biti nad njim in dalec pod mejo odjemalca.
    expect(MEDIA_FRAME_BYTES).toBe(640);
    expect(DEVICE_MEDIA_MAX_PAYLOAD).toBe(8 * 1024);
    expect(DEVICE_MEDIA_MAX_PAYLOAD).toBeGreaterThanOrEqual(4 * MEDIA_FRAME_BYTES);
    expect(CLIENT_MEDIA_MAX_PAYLOAD).toBe(1024 * 1024);
    expect(DEVICE_CHANNEL_MAX_PAYLOAD).toBe(64 * 1024);
  });

  it("70 kB zunanjega odjemalca pride do telefona v okvirjih po 20 ms in povezava ostane", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { port, callId } = await startGateway();
    const client = await openClient(port, callId);
    const started = nextJson(client, "start");
    const device = await openDevice(port, callId);
    await started;

    const audio = Buffer.alloc(70_000);
    for (let i = 0; i < audio.length; i++) audio[i] = (i * 31 + 7) & 0xff;
    const receiving = collectBinary(device, audio.length);
    client.send(audio);
    const frames = await receiving;

    expect(Buffer.concat(frames).equals(audio)).toBe(true);
    expect(Math.max(...frames.map((frame) => frame.length))).toBe(MEDIA_FRAME_BYTES);
    expect(frames.length).toBe(Math.ceil(audio.length / MEDIA_FRAME_BYTES));

    // Povezava je se ziva: kratek okvir pride nespremenjen.
    const one = collectBinary(device, 4);
    client.send(Buffer.from([9, 8, 7, 6]));
    expect((await one)[0]).toEqual(Buffer.from([9, 8, 7, 6]));
    expect(client.readyState).toBe(WebSocket.OPEN);
    expect(logged(errorSpy)).toEqual([]);
  });

  it("noga naprave: preveliko sporocilo zapre samo to nogo in zapise kodo brez vsebine", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { port, callId } = await startGateway();
    const client = await openClient(port, callId);
    const started = nextJson(client, "start");
    const device = await openDevice(port, callId);
    await started;

    // Okvir na meji gre skozi.
    const atLimit = collectBinary(client, DEVICE_MEDIA_MAX_PAYLOAD);
    device.send(Buffer.alloc(DEVICE_MEDIA_MAX_PAYLOAD, 1));
    expect(Buffer.concat(await atLimit).length).toBe(DEVICE_MEDIA_MAX_PAYLOAD);
    expect(logged(errorSpy)).toEqual([]);

    // 70 kB z noge naprave: zaprto, odjemalec dobi stop, streznik zivi.
    const stopped = nextJson(client, "stop");
    const closing = closed(device);
    device.send(Buffer.alloc(70_000, "Z"));
    expect(await closing).toBe(1009);
    expect(await stopped).toMatchObject({ type: "stop", callId, reason: "device_media_closed" });

    const lines = logged(errorSpy);
    expect(lines).toEqual(["ws_error device-media WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"]);
    expect(lines.join("\n")).not.toContain("ZZZZ");
    expect(lines.join("\n")).not.toContain(callId);
    expect(lines.join("\n")).not.toContain(DEVICE_ID);
    expect(client.readyState).toBe(WebSocket.OPEN);
    expect(await alive(port)).toBe(200);
  });

  it("nadzorni kanal naprave: preveliko sporocilo zapise nogo in kodo brez vsebine", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { port } = await startGateway();
    const channel = await open(`ws://127.0.0.1:${port}/v1/device-channel`, {
      "x-device-id": DEVICE_ID,
      "x-device-token": DEVICE_TOKEN,
    });

    const closing = closed(channel);
    channel.send(JSON.stringify({ type: "health", note: "+38640111222".repeat(8_000) }));
    expect(await closing).toBe(1009);

    const lines = logged(errorSpy);
    expect(lines).toEqual(["ws_error device-channel WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"]);
    expect(lines.join("\n")).not.toContain("38640111222");
    expect(lines.join("\n")).not.toContain(DEVICE_ID);
    expect(lines.join("\n")).not.toContain(DEVICE_TOKEN);
    expect(await alive(port)).toBe(200);
  });
});
