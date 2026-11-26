/**
 * Naloga 31 (lastnik 26. 11. 2026): OmniRoute, ki na racunalniku ne tece. Nedosegljiv naslov se ne shrani (klici ostanejo na
 * prejsnjem ponudniku), napaka je dogovorjeno besedilo OMNIROUTE_NE_TECE (vmesnik nanj odgovori z vprasanjem za namestitev),
 * ne surova napaka omrezja. Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { readBrain, saveBrain } from "./keys.server.ts";
import { OMNIROUTE_NE_TECE } from "./omniroute.ts";
import { besedila } from "./besedila.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-n31-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const KLJUC = "om-izmisljen-preizkusni-kljuc-0031";
let streznik: Server;
let ziv = "";
let mrtev = "";

before(async () => {
  streznik = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ object: "list", data: [{ id: "auto" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: "da" } }] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((ok) => streznik.listen(0, "127.0.0.1", ok));
  ziv = `http://127.0.0.1:${(streznik.address() as AddressInfo).port}/v1`;
  // Vrata, na katerih nic ne poslusa: zasedi in sprosti.
  const zacasen = createServer();
  await new Promise<void>((ok) => zacasen.listen(0, "127.0.0.1", ok));
  const vrata = (zacasen.address() as AddressInfo).port;
  await new Promise<void>((ok) => zacasen.close(() => ok()));
  mrtev = `http://127.0.0.1:${vrata}/v1`;
});

after(() => new Promise<void>((ok) => streznik.close(() => ok())));

async function nova(): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  process.env.LINA_DATA = dir;
  return { dir, token: await setupOwner("geslo-test-1234", dir) };
}

describe("naloga 31: OmniRoute ne tece", () => {
  it("nedosegljiv naslov z izbiro za klice: dogovorjena napaka, kljuci.json (klici) ostane nespremenjen", async () => {
    const { dir, token } = await nova();
    await saveBrain({ provider: "omniroute", key: KLJUC, naslov: ziv, model: "auto", zaKlice: true }, token, dir);
    const prej = await readFile(path.join(dir, "kljuci.json"), "utf8");
    const brainPrej = await readBrain(token, dir);
    await assert.rejects(
      saveBrain({ provider: "omniroute", key: KLJUC, naslov: mrtev, model: "auto", zaKlice: true }, token, dir),
      (e: Error) => e.message === OMNIROUTE_NE_TECE,
    );
    assert.equal(await readFile(path.join(dir, "kljuci.json"), "utf8"), prej, "klici ne preklopijo na nedosegljiv naslov");
    assert.deepEqual(await readBrain(token, dir), brainPrej);
  });

  it("nedosegljiv privzeti naslov brez kljuca: ista napaka (vprasanje za namestitev), ne »Vpisite kljuc«", async () => {
    const { dir, token } = await nova();
    await assert.rejects(saveBrain({ provider: "omniroute", naslov: mrtev, samodejno: true }, token, dir), (e: Error) => e.message === OMNIROUTE_NE_TECE);
  });

  it("tuj program na naslovu (404) ni OmniRoute: ista napaka, nic se ne shrani", async () => {
    const { dir, token } = await nova();
    await assert.rejects(
      saveBrain({ provider: "omniroute", key: KLJUC, naslov: ziv.replace(/\/v1$/, "/drugo"), model: "auto" }, token, dir),
      (e: Error) => e.message === OMNIROUTE_NE_TECE,
    );
  });

  it("besedilo napake ni surova napaka omrezja in je prevedeno (sl, en)", () => {
    assert.doesNotMatch(OMNIROUTE_NE_TECE, /ECONNREFUSED|fetch failed|TypeError/);
    assert.equal(besedila.sl.omNeTece, OMNIROUTE_NE_TECE);
    assert.ok(besedila.en.omNeTece.length > 10 && besedila.en.omNeTece !== besedila.sl.omNeTece);
  });

  it("besedilo v Mozganih pove resnico: OmniRoute je locen program, ki ga je treba namestiti; Lina ga lahko namesti", () => {
    assert.match(besedila.sl.omPonudnikOpis, /namest/i);
    assert.match(besedila.sl.omPonudnikOpis, /Lina/);
    assert.match(besedila.en.omPonudnikOpis, /install/i);
    assert.doesNotMatch(besedila.sl.omPonudnikOpis, /Ključ ustvarite v nadzorni plošči/);
  });
});
