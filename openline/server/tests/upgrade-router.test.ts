import * as net from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createGatewayServer, type GatewayServer } from "../src/server.js";
import { ustvariLinaSprejemnik } from "../src/lina-sprejemnik.js";

/** Pregled 15, N8: vsaka nadgradnja dobi odgovor; tuja pot 404, ne visece vticnice. */
const ZETON = "zeton-preizkusa-usmerjevalnika-0123456789";
let gateway: GatewayServer | undefined;

afterEach(async () => {
  if (gateway?.httpServer.listening) {
    gateway.httpServer.closeAllConnections?.();
    await new Promise<void>((resolve) => gateway!.httpServer.close(() => resolve()));
  }
  gateway = undefined;
});

async function zazeni(): Promise<number> {
  gateway = createGatewayServer({ apiKey: "test-api-key" });
  ustvariLinaSprejemnik({ zeton: ZETON, nesifriranoSamoZaPreizkus: true }).attach(gateway.httpServer);
  await new Promise<void>((resolve, reject) => {
    gateway!.httpServer.once("error", reject);
    gateway!.httpServer.listen(0, "127.0.0.1", resolve);
  });
  return (gateway.httpServer.address() as AddressInfo).port;
}

/** Surova zahteva za nadgradnjo; vrne statusno vrstico ali "BREZ ODGOVORA" po 1,5 s (prej: vticnica je visela). */
function nadgradnja(port: number, pot: string, glave: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    let prejeto = "";
    const rok = setTimeout(() => { s.destroy(); resolve("BREZ ODGOVORA"); }, 1500);
    s.on("data", (d) => {
      prejeto += d.toString("latin1");
      const konec = prejeto.indexOf("\r\n");
      if (konec >= 0) { clearTimeout(rok); s.destroy(); resolve(prejeto.slice(0, konec)); }
    });
    s.on("error", () => { clearTimeout(rok); resolve("NAPAKA"); });
    const dodatne = Object.entries(glave).map(([k, v]) => `${k}: ${v}\r\n`).join("");
    s.write(
      `GET ${pot} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n` +
      `Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n${dodatne}\r\n`,
    );
  });
}

describe("skupni usmerjevalnik nadgradenj (N8)", () => {
  it("neznana pot dobi 404, ne visi", async () => {
    const port = await zazeni();
    expect(await nadgradnja(port, "/neznano")).toBe("HTTP/1.1 404 Not Found");
    expect(await nadgradnja(port, "/api/voice/streamX")).toBe("HTTP/1.1 404 Not Found");
  });

  it("zapis //gostitelj/pot ne doseze modula (400)", async () => {
    const port = await zazeni();
    expect(await nadgradnja(port, "//drug.example/api/voice/stream", { Authorization: `Bearer ${ZETON}` }))
      .toBe("HTTP/1.1 400 Bad Request");
  });

  it("prijavljene poti na istem strezniku delujejo naprej", async () => {
    const port = await zazeni();
    expect(await nadgradnja(port, "/api/voice/stream", { Authorization: `Bearer ${ZETON}` }))
      .toBe("HTTP/1.1 101 Switching Protocols");
    expect(await nadgradnja(port, "/api/voice/stream")).toBe("HTTP/1.1 401 Unauthorized");
    expect(await nadgradnja(port, "/v1/device-channel?deviceId=x")).toBe("HTTP/1.1 401 Unauthorized");
    expect(await nadgradnja(port, "/v1/calls/klic-1/media")).toMatch(/^HTTP\/1\.1 40[13] /);
  });

  it("napacen zapis id klica (%) ne sesuje streznika, dobi odgovor", async () => {
    const port = await zazeni();
    expect(await nadgradnja(port, "/v1/calls/%E0%A4%A/media")).toMatch(/^HTTP\/1\.1 [45]\d\d /);
    expect(await nadgradnja(port, "/neznano")).toBe("HTTP/1.1 404 Not Found");
  });
});
