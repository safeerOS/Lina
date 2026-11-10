import { describe, expect, it, vi, afterEach } from "vitest";
import WebSocket from "ws";
import { createGatewayServer } from "../src/server.js";
import type { AddressInfo } from "node:net";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

describe("media relay", () => {
  it("survives 70kB message on /media and logs error code", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    
    const gateway = createGatewayServer({ apiKey: "test-api-key" });
    await new Promise<void>((resolve, reject) => {
      gateway.httpServer.once("error", reject);
      gateway.httpServer.listen(0, "127.0.0.1", () => resolve());
    });
    cleanup.push(() => gateway.httpServer.close());
    const port = (gateway.httpServer.address() as AddressInfo).port;

    gateway.state.upsertDevice({ id: "phone-1" });
    const call = gateway.state.createOutgoingCall({
      deviceId: "phone-1",
      to: "1",
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/calls/${call.id}/media`, {
      headers: { "x-api-key": "test-api-key" }
    });

    await new Promise<void>((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    });
    cleanup.push(() => ws.close());

    const largeMessage = Buffer.alloc(70000, "a");
    ws.send(largeMessage);

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(ws.readyState).not.toBe(WebSocket.OPEN);
    
    const calls = errorSpy.mock.calls.map(c => c.join(" ")).join(" ");
    expect(calls).toContain("WS_ERR_UNSUPPORTED_MESSAGE_LENGTH");
    
    errorSpy.mockRestore();
  });
});
