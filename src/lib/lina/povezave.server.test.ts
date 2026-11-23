/**
 * HTTP/2 do Vertexa (lastnik 14. 11. 2026): ena trajna seja, ob napaki seje (GOAWAY, zavrnjen tok) PRED odgovorom enkrat HTTP/1.1, rok klicatelja
 * velja (po izteku ni ponovitve), preusmeritve se ne sledijo. Lokalni streznik HTTP/2 + HTTP/1.1 s samopodpisanim potrdilom; brez pravega omrezja.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { constants as H2, createSecureServer, type Http2SecureServer, type Http2ServerRequest, type Http2ServerResponse } from "node:http2";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { H2_PREMOR_PO_NAPAKI_MS, nastaviHttp2, nastaviPovezaveZaPreizkus, nastaviToplePovezave, topliFetch, zapriBazen } from "./povezave.server.ts";

let mapa = "";
let streznik: Http2SecureServer;
let naslov = "";
let nacin: "ok" | "goaway" | "pocasi" | "preusmeritev" = "ok";
const prejeto: string[] = [];
let sej = 0;

before(async () => {
  mapa = mkdtempSync(path.join(tmpdir(), "lina-h2-"));
  const k = path.join(mapa, "k.pem");
  const c = path.join(mapa, "c.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", k, "-out", c, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const ca = readFileSync(c);
  streznik = createSecureServer({ key: readFileSync(k), cert: ca, allowHTTP1: true }, (zah: Http2ServerRequest, odg: Http2ServerResponse) => {
    const verzija = zah.httpVersion;
    let telo = "";
    zah.on("data", (d) => (telo += d));
    zah.on("end", () => {
      prejeto.push(`${verzija} ${zah.method} ${telo}`);
      if (verzija === "2.0" && nacin === "goaway") {
        // Streznik zavrne tok, ki ga ni obdelal (GOAWAY z zadnjim tokom 0): odjemalec gre na HTTP/1.1.
        zah.stream.session?.goaway(H2.NGHTTP2_NO_ERROR, 0);
        zah.stream.close(H2.NGHTTP2_REFUSED_STREAM);
        return;
      }
      if (nacin === "pocasi") return void setTimeout(() => odg.writeHead(200).end("pozno"), 1_000);
      if (nacin === "preusmeritev") return void odg.writeHead(302, { location: "https://drugje.example/" }).end();
      odg.writeHead(200, { "content-type": "text/plain" });
      odg.end(`ok ${verzija}`);
    });
  });
  streznik.on("session", () => {
    sej += 1;
  });
  await new Promise<void>((r) => streznik.listen(0, "127.0.0.1", () => r()));
  const a = streznik.address();
  naslov = `https://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  nastaviToplePovezave(true);
  nastaviPovezaveZaPreizkus({ dovoli: (g) => g === "127.0.0.1", agent: { ca }, http2: true });
  nastaviHttp2(true);
});

afterEach(() => {
  nacin = "ok";
  prejeto.length = 0;
  zapriBazen();
  nastaviPovezaveZaPreizkus({ dovoli: (g) => g === "127.0.0.1", agent: { ca: readFileSync(path.join(mapa, "c.pem")) }, http2: true });
});

after(async () => {
  zapriBazen();
  nastaviPovezaveZaPreizkus();
  nastaviToplePovezave(false);
  await new Promise<void>((r) => streznik.close(() => r()));
  rmSync(mapa, { recursive: true, force: true });
});

const post = (telo: string, signal?: AbortSignal) => topliFetch(`${naslov}/v1/model:generateContent`, { method: "POST", headers: { authorization: "Bearer x", "content-type": "application/json" }, body: telo, ...(signal ? { signal } : {}) });

describe("HTTP/2 do Vertexa", () => {
  it("POST gre po HTTP/2; druga zahteva uporabi isto sejo (multipleks)", async () => {
    const pred = sej;
    const a = await post("a");
    assert.equal(await a.text(), "ok 2.0");
    const [b, c] = await Promise.all([post("b"), post("c")]);
    assert.equal(await b.text(), "ok 2.0");
    assert.equal(await c.text(), "ok 2.0");
    assert.equal(sej - pred, 1, "ena seja za tri zahteve");
    assert.deepEqual(prejeto.sort(), ["2.0 POST a", "2.0 POST b", "2.0 POST c"]);
  });

  it("GOAWAY / zavrnjen tok pred odgovorom: ista zahteva enkrat po HTTP/1.1; nato premor HTTP/2", async () => {
    nacin = "goaway";
    const r = await post("g");
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "ok 1.1");
    assert.deepEqual(prejeto, ["2.0 POST g", "1.1 POST g"]);
    prejeto.length = 0;
    nacin = "ok";
    assert.equal(await (await post("h")).text(), "ok 1.1", `v premoru (${H2_PREMOR_PO_NAPAKI_MS} ms) ostane HTTP/1.1`);
    assert.deepEqual(prejeto, ["1.1 POST h"]);
  });

  it("rok klicatelja velja: po izteku ni ponovitve po HTTP/1.1", async () => {
    nacin = "pocasi";
    const t0 = performance.now();
    await assert.rejects(post("p", AbortSignal.timeout(200)));
    assert.ok(performance.now() - t0 < 700, "brez cakanja na rezervo");
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(prejeto.filter((v) => v.startsWith("1.1")), [], "HTTP/1.1 ni bil poklican");
  });

  it("preusmeritev se ne sledi in ne ponovi po HTTP/1.1", async () => {
    nacin = "preusmeritev";
    await assert.rejects(post("r"), /redirect/);
    assert.deepEqual(prejeto, ["2.0 POST r"]);
  });

  it("izklop HTTP/2: zahteve gredo po HTTP/1.1", async () => {
    nastaviHttp2(false);
    try {
      assert.equal(await (await post("x")).text(), "ok 1.1");
    } finally {
      nastaviHttp2(true);
    }
  });
});
