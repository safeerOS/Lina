/**
 * Naloga 17a, tocka 3 (25. 11. 2026): streznik odpira Live na Vertex v1 (odjemalec.server.ts), telefon pa na v1beta1. Ali v1 sprejme
 * realtimeInputConfig.automaticActivityDetection.startOfSpeechSensitivity, iz te seje ni bilo mogoce preveriti v dokumentaciji
 * (splet ni bil dovoljen). Zato se Live odpre ne glede na odgovor: ce streznik sejo zapre PRED setupComplete in je bilo polje
 * poslano, se odpre se enkrat brez polja (zRezervoSetupa). Preizkus s pravim odjemalcem odpriLiveWs in laznim streznikom
 * WebSocket (node:http, rocno rokovanje RFC 6455). Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { after, describe, it } from "node:test";
import { setupLive } from "./live/navodilo.ts";
import { odpriLiveWs } from "./live/odjemalec.server.ts";
import { brezObcutljivosti, zRezervoSetupa } from "./live/odpri-rezerva.ts";
import type { LiveSporocilo } from "./live/most.ts";

type Nacin = "zavrni-polje" | "sprejmi" | "zavrni-vse";

function okvir(opcode: number, podatki: Buffer): Buffer {
  const glava = podatki.length < 126 ? Buffer.from([0x80 | opcode, podatki.length]) : Buffer.from([0x80 | opcode, 126, podatki.length >> 8, podatki.length & 0xff]);
  return Buffer.concat([glava, podatki]);
}

/** Lazni Live: sprejme setup, odgovori setupComplete ali zapre s 1007 (kot Google ob neznanem polju). */
function lazniLive(nacin: Nacin): Promise<{ naslov: string; setupi: Record<string, unknown>[]; streznik: Server }> {
  const setupi: Record<string, unknown>[] = [];
  const streznik = createServer();
  streznik.on("upgrade", (zahteva, vticnica: Socket) => {
    const kljuc = String(zahteva.headers["sec-websocket-key"]);
    const sprejem = createHash("sha1").update(`${kljuc}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    vticnica.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${sprejem}\r\n\r\n`);
    let zbrano = Buffer.alloc(0);
    vticnica.on("data", (d: Buffer) => {
      zbrano = Buffer.concat([zbrano, d]);
      for (;;) {
        if (zbrano.length < 2) return;
        const opcode = (zbrano[0] as number) & 0x0f;
        let dolzina = (zbrano[1] as number) & 0x7f;
        let od = 2;
        if (dolzina === 126) {
          dolzina = zbrano.readUInt16BE(2);
          od = 4;
        } else if (dolzina === 127) {
          dolzina = Number(zbrano.readBigUInt64BE(2));
          od = 10;
        }
        if (zbrano.length < od + 4 + dolzina) return;
        const maska = zbrano.subarray(od, od + 4);
        const vsebina = Buffer.from(zbrano.subarray(od + 4, od + 4 + dolzina));
        for (let i = 0; i < vsebina.length; i++) vsebina[i] = (vsebina[i] as number) ^ (maska[i % 4] as number);
        zbrano = zbrano.subarray(od + 4 + dolzina);
        if (opcode === 8) {
          vticnica.end(okvir(8, Buffer.from([0x03, 0xe8])));
          return;
        }
        if (opcode !== 1) continue;
        const m = JSON.parse(vsebina.toString("utf8")) as { setup?: Record<string, unknown> };
        if (!m.setup) continue;
        setupi.push(m.setup);
        const zavrni = nacin === "zavrni-vse" || (nacin === "zavrni-polje" && "realtimeInputConfig" in m.setup);
        if (zavrni) {
          const razlog = Buffer.from('Invalid JSON payload received. Unknown name "realtimeInputConfig"');
          vticnica.end(okvir(8, Buffer.concat([Buffer.from([0x03, 0xef]), razlog])));
        } else vticnica.write(okvir(1, Buffer.from(JSON.stringify({ setupComplete: {} }))));
      }
    });
    vticnica.on("error", () => undefined);
  });
  return new Promise((resolve) => {
    streznik.listen(0, "127.0.0.1", () => {
      const { port } = streznik.address() as AddressInfo;
      resolve({ naslov: `ws://127.0.0.1:${port}/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`, setupi, streznik });
    });
  });
}

const strezniki: Server[] = [];
after(() => {
  for (const s of strezniki) s.close();
});

async function odpri(nacin: Nacin, zmanjsanjeHrupa: boolean) {
  const l = await lazniLive(nacin);
  strezniki.push(l.streznik);
  const sporocila: LiveSporocilo[] = [];
  const zaprto: string[] = [];
  const dnevnik: string[] = [];
  let pripravljeno: () => void = () => undefined;
  const setupComplete = new Promise<void>((r) => (pripravljeno = r));
  let zaprl: () => void = () => undefined;
  const zaprtoObljuba = new Promise<void>((r) => (zaprl = r));
  const seja = await zRezervoSetupa(odpriLiveWs({ naslov: l.naslov, zeton: async () => "preizkus" }), (k) => dnevnik.push(k))({
    setup: setupLive({ projekt: "p", sistemsko: "s", zmanjsanjeHrupa }),
    onSporocilo: (m) => {
      sporocila.push(m);
      if (m.setupComplete !== undefined) pripravljeno();
    },
    onZaprto: (r) => {
      zaprto.push(r);
      zaprl();
    },
  });
  const izid = await Promise.race([setupComplete.then(() => "pripravljeno"), zaprtoObljuba.then(() => "zaprto"), new Promise((r) => setTimeout(() => r("rok"), 5000))]);
  return { ...l, seja, sporocila, zaprto, dnevnik, izid };
}

describe("Live setup: Vertex v1 in polje startOfSpeechSensitivity", () => {
  it("brezObcutljivosti odstrani samo realtimeInputConfig; brez polja vrne null", () => {
    const z = setupLive({ projekt: "p", sistemsko: "s", zmanjsanjeHrupa: true }) as { setup: Record<string, unknown> };
    const b = brezObcutljivosti(z) as { setup: Record<string, unknown> };
    assert.ok("realtimeInputConfig" in z.setup, "izvirnik ostane nespremenjen");
    assert.equal("realtimeInputConfig" in b.setup, false);
    assert.deepEqual(b, setupLive({ projekt: "p", sistemsko: "s", zmanjsanjeHrupa: false }));
    assert.equal(brezObcutljivosti(setupLive({ projekt: "p", sistemsko: "s", zmanjsanjeHrupa: false })), null);
  });

  it("streznik zavrne polje (1007 pred setupComplete): druga seja brez polja se odpre, klicatelj ne vidi zaprtja", async () => {
    const o = await odpri("zavrni-polje", true);
    assert.equal(o.izid, "pripravljeno");
    assert.equal(o.setupi.length, 2);
    assert.ok("realtimeInputConfig" in (o.setupi[0] as object));
    assert.equal("realtimeInputConfig" in (o.setupi[1] as object), false);
    assert.deepEqual(o.zaprto, []);
    assert.deepEqual(o.dnevnik, ["live-setup-brez-obcutljivosti"]);
    o.seja.zapri();
  });

  it("streznik polje sprejme: ena seja s poljem", async () => {
    const o = await odpri("sprejmi", true);
    assert.equal(o.izid, "pripravljeno");
    assert.equal(o.setupi.length, 1);
    assert.ok("realtimeInputConfig" in (o.setupi[0] as object));
    assert.deepEqual(o.dnevnik, []);
    o.seja.zapri();
  });

  it("stikalo izklopljeno: brez polja, brez ponovitve; zaprtje gre klicatelju", async () => {
    const o = await odpri("zavrni-vse", false);
    assert.equal(o.izid, "zaprto");
    assert.equal(o.setupi.length, 1);
    assert.equal(o.zaprto.length, 1);
  });

  it("streznik zavrne tudi drugi poskus: natanko ena ponovitev, nato zaprtje klicatelju (pot oprostilo)", async () => {
    const o = await odpri("zavrni-vse", true);
    assert.equal(o.izid, "zaprto");
    assert.equal(o.setupi.length, 2);
    assert.equal(o.zaprto.length, 1);
  });

  it("klicatelj zapre sejo pred setupComplete: brez ponovitve", async () => {
    const l = await lazniLive("zavrni-polje");
    strezniki.push(l.streznik);
    const zaprto: string[] = [];
    const seja = await zRezervoSetupa(odpriLiveWs({ naslov: l.naslov, zeton: async () => "preizkus" }))({
      setup: setupLive({ projekt: "p", sistemsko: "s", zmanjsanjeHrupa: true }),
      onSporocilo: () => undefined,
      onZaprto: (r) => void zaprto.push(r),
    });
    seja.zapri();
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(l.setupi.length <= 1);
    assert.deepEqual(zaprto, []);
  });
});
