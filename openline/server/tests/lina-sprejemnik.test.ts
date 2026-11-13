import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as http from "node:http";
import { WebSocket } from "ws";
import { ustvariLinaSprejemnik } from "../src/lina-sprejemnik.js";

const ZETON = "skrivnost-za-preizkus-0123456789abcdef";
import { MEDIA_FRAME_BYTES, MEDIA_FORMAT } from "../src/media-relay.js";

describe("Lina Sprejemnik", () => {
  let streznik: http.Server;
  let vrata: number;
  let sprejemnik: ReturnType<typeof ustvariLinaSprejemnik>;
  let klicani: WebSocket[] = [];

  beforeEach(async () => {
    klicani = [];
    sprejemnik = ustvariLinaSprejemnik({ zeton: ZETON, nesifriranoSamoZaPreizkus: true });
    streznik = http.createServer();
    sprejemnik.attach(streznik);

    await new Promise<void>((resolve) => {
      streznik.listen(0, "127.0.0.1", () => {
        const naslov = streznik.address() as http.AddressInfo;
        vrata = naslov.port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    for (const ws of klicani) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }
    await new Promise<void>((resolve) => streznik.close(() => resolve()));
  });

  function ustvariOdjemalca(pot: string = "/api/voice/stream", glave: Record<string, string> = { Authorization: `Bearer ${ZETON}` }) {
    const ws = new WebSocket(`ws://127.0.0.1:${vrata}${pot}`, { headers: glave });
    klicani.push(ws);
    return ws;
  }

  function cakajOdprtje(ws: WebSocket) {
    return new Promise<void>((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
      ws.on("unexpected-response", (_, res) => reject(new Error(`Status: ${res.statusCode}`)));
    });
  }

  // 1. zeton v glavi OK
  it("sprejme povezavo z ustreznim zetonom v glavi in vrne start", async () => {
    const ws = ustvariOdjemalca();
    const sporocila: any[] = [];
    ws.on("message", (podatki) => sporocila.push(JSON.parse(podatki.toString())));
    await cakajOdprtje(ws);
    
    // Pocakamo, da streznik poslje 'start'
    await new Promise((r) => setTimeout(r, 50));
    
    expect(sporocila).toHaveLength(1);
    expect(sporocila[0]).toEqual({ type: "start", format: MEDIA_FORMAT });
    expect(sprejemnik.statistika().povezave).toBe(1);
  });

  // 2. zeton v poizvedbi 401
  it("zavrne povezavo z zetonom v poizvedbi z 401", async () => {
    // Z veljavno glavo: zavrne SAMO zato, ker je zeton tudi v poizvedbi (pregled 15: prej brez glave ni nic dokazal).
    const ws = ustvariOdjemalca(`/api/voice/stream?token=${ZETON}`, { Authorization: `Bearer ${ZETON}` });
    await expect(cakajOdprtje(ws)).rejects.toThrow("Status: 401");
  });

  // 3. napacen zeton 401
  it("zavrne povezavo z napacnim zetonom z 401", async () => {
    const ws = ustvariOdjemalca("/api/voice/stream", { Authorization: "Bearer napacen" });
    await expect(cakajOdprtje(ws)).rejects.toThrow("Status: 401");
  });

  // 4. brez zetona 401
  it("zavrne povezavo brez zetona z 401", async () => {
    const ws = ustvariOdjemalca("/api/voice/stream", {});
    await expect(cakajOdprtje(ws)).rejects.toThrow("Status: 401");
  });

  // 5. okvir 639 B zavrnjen
  it("zavrne okvir neustrezne velikosti (premajhen 639B) in zapre s 1008", async () => {
    const ws = ustvariOdjemalca();
    await cakajOdprtje(ws);
    const zaprtje = new Promise<number>((r) => ws.on("close", r));
    
    ws.send(Buffer.alloc(MEDIA_FRAME_BYTES - 1));
    const koda = await zaprtje;
    
    expect(koda).toBe(1008);
    expect(sprejemnik.statistika().zavrnjeniOkvirji).toBe(1);
  });

  // 6. 640 B sprejet
  it("sprejme okvir natancne velikosti in poveca stevec", async () => {
    const ws = ustvariOdjemalca();
    await cakajOdprtje(ws);
    
    ws.send(Buffer.alloc(MEDIA_FRAME_BYTES));
    await new Promise((r) => setTimeout(r, 50));
    
    expect(sprejemnik.statistika().sprejetiOkvirji).toBe(1);
    expect(sprejemnik.statistika().zavrnjeniOkvirji).toBe(0);
  });

  // 7. prevelik okvir
  it("zavrne prevelik okvir, ki presega maksimalno velikost", async () => {
    const ws = ustvariOdjemalca();
    await cakajOdprtje(ws);
    const zaprtje = new Promise<number>((r) => ws.on("close", r));
    
    ws.send(Buffer.alloc(8193)); // Presega DEVICE_MEDIA_MAX_PAYLOAD (8192)
    const koda = await zaprtje;
    
    expect(koda).toBe(1009); // 1009 se zgodi nativno zaradi maxPayload
  });

  // 8. druga povezava 429
  it("nova overjena povezava zamenja staro (ponovna povezava po izpadu Wi-Fi)", async () => {
    const ws1 = ustvariOdjemalca();
    await cakajOdprtje(ws1);
    const zaprtje1 = new Promise<number>((r) => ws1.on("close", (koda) => r(koda)));

    const ws2 = ustvariOdjemalca();
    await cakajOdprtje(ws2);
    expect(await zaprtje1).toBe(1012);
    expect(ws2.readyState).toBe(WebSocket.OPEN);
  });

  it("zavrne prekratek ali prazen zeton ob ustvarjanju", () => {
    expect(() => ustvariLinaSprejemnik({ zeton: "", nesifriranoSamoZaPreizkus: true })).toThrow();
    expect(() => ustvariLinaSprejemnik({ zeton: "kratek", nesifriranoSamoZaPreizkus: true })).toThrow();
  });

  it("brez TLS se ne priklopi, razen izrecno za preizkus", () => {
    const s = ustvariLinaSprejemnik({ zeton: ZETON });
    expect(() => s.attach(http.createServer())).toThrow(/TLS/);
  });

  // 9. hitrost
  it("prekine povezavo s 1008 ob prekoracitvi hitrosti (vec kot 100 okvirjev naenkrat)", async () => {
    const ws = ustvariOdjemalca();
    await cakajOdprtje(ws);
    const zaprtje = new Promise<number>((r) => ws.on("close", r));
    
    for (let i = 0; i < 101; i++) {
      ws.send(Buffer.alloc(MEDIA_FRAME_BYTES));
    }
    const koda = await zaprtje;
    
    expect(koda).toBe(1008);
    expect(sprejemnik.statistika().zavrnjeniOkvirji).toBeGreaterThan(0);
  });

  // 10. neveljaven besedilni okvir
  it("zavrne besedilni okvir, ki ni 'clear' z 1008", async () => {
    const ws = ustvariOdjemalca();
    await cakajOdprtje(ws);
    const zaprtje = new Promise<number>((r) => ws.on("close", r));
    
    ws.send(JSON.stringify({ type: "nekaj_drugega" }));
    const koda = await zaprtje;
    
    expect(koda).toBe(1008);
  });

  // Ekstra test za veljaven text okvir
  it("vrne 'cleared' ob prejemu 'clear' besedilnega okvirja", async () => {
    const ws = ustvariOdjemalca();
    await cakajOdprtje(ws);
    
    const sporocila: any[] = [];
    ws.on("message", (podatki) => sporocila.push(JSON.parse(podatki.toString())));
    
    ws.send(JSON.stringify({ type: "clear" }));
    await new Promise((r) => setTimeout(r, 50));
    
    expect(sporocila).toContainEqual({ type: "cleared" });
  });
});
