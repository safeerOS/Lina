/**
 * Testno okno sprejema klicev (16. 11. 2026): preizkusni racun Twilio nima stevilke v IncomingPhoneNumbers, zato uporabnik
 * dohodni klic preizkusi iz programa: dokler tece javni naslov, klic zadosca potrditvi prek API Twilio. Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { savePravila } from "./pravila.server.ts";
import { TESTNO_OKNO_MS, pozabiSprejemKlicev, testnoOknoAktivno, ugasniTestnoOknoSprejema, vklopiTestnoOknoSprejema } from "./twilio-sprejem.server.ts";
import { povezi, type ZahtevaTwilio } from "./twilio-racun.server.ts";
import { handleVoiceRequest } from "./voice.server.ts";

const SID = `AC${"a".repeat(32)}`;
const KLJUC = `SK${"b".repeat(32)}`;
const API = "tajna-skrivnost-api-kljuca-12345";
const KLIC = `CA${"e".repeat(32)}`;
const OD = "+38640123456";
const ZA = "+12025550100";
const NASLOV = "https://lina.primer/api/voice/incoming";
const temps: string[] = [];

afterEach(async () => {
  pozabiSprejemKlicev();
  ugasniTestnoOknoSprejema();
  delete process.env.TWILIO_AUTH_TOKEN;
  while (temps.length) await rm(temps.pop() as string, { recursive: true, force: true });
});

type Dnevnik = { url: string };
type Stanje = { klic?: Record<string, unknown>; stevilka?: Record<string, unknown> | null };
function lazni(stanje: Stanje = {}, dnevnik: Dnevnik[] = []): ZahtevaTwilio {
  return async (url, init) => {
    dnevnik.push({ url });
    if (init.method === "GET" && /\/Calls\/CA[0-9a-f]{32}\.json$/.test(url)) {
      return { status: 200, json: { sid: url.match(/CA[0-9a-f]{32}/)?.[0], direction: "inbound", from: OD, to: ZA, status: "in-progress", ...stanje.klic } };
    }
    if (init.method === "GET" && url.includes("/IncomingPhoneNumbers.json")) {
      const s = stanje.stevilka === undefined ? { phone_number: ZA, voice_url: NASLOV } : stanje.stevilka;
      return { status: 200, json: { incoming_phone_numbers: s ? [s] : [] } };
    }
    return { status: 200, json: {} };
  };
}

async function pripravi(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-spr-"));
  temps.push(dir);
  const token = await setupOwner("dolgo-geslo-za-preizkus-9", dir, { address: "127.0.0.1" });
  await povezi(token, { sid: SID, kljucSid: KLJUC, skrivnost: API }, dir, async () => ({ status: 200, json: {} }));
  await savePravila({ javniNaslov: "https://lina.primer" }, token, dir);
  return dir;
}

function zahteva(sid: string, od = OD, za = ZA, podpis?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (podpis) headers["x-twilio-signature"] = podpis;
  return new Request(NASLOV, { method: "POST", headers, body: new URLSearchParams({ CallSid: sid, From: od, To: za }).toString() });
}
const poslji = (dir: string, r: Request, t: ZahtevaTwilio) => handleVoiceRequest(r, dir, new Date(), { zahtevaTwilio: t });


const brezStevilk = { stevilka: null } as const;

describe("testno okno sprejema klicev", () => {
  it("okno je privzeto ugasnjeno, po vklopu velja do izteka, ugasne ob zaustavitvi", () => {
    assert.equal(testnoOknoAktivno(), false);
    vklopiTestnoOknoSprejema(1000);
    assert.equal(testnoOknoAktivno(1000 + TESTNO_OKNO_MS - 1), true);
    assert.equal(testnoOknoAktivno(1000 + TESTNO_OKNO_MS), false);
    vklopiTestnoOknoSprejema();
    ugasniTestnoOknoSprejema();
    assert.equal(testnoOknoAktivno(), false);
  });

  it("brez okna in brez stevilke v racunu ostane 403", async () => {
    const dir = await pripravi();
    assert.equal((await poslji(dir, zahteva(KLIC), lazni(brezStevilk))).status, 403);
  });

  it("v oknu in brez stevilke v racunu Twilio potrjen vhodni klic vrne 200", async () => {
    const dir = await pripravi();
    vklopiTestnoOknoSprejema();
    assert.equal((await poslji(dir, zahteva(KLIC), lazni(brezStevilk))).status, 200);
  });

  it("v oknu se klic vseeno zavrne: odhodni, zakljucen, drug To/From ali tuj sid", async () => {
    for (const klic of [{ direction: "outbound-api" }, { status: "completed" }, { to: "+12025550199" }, { sid: `CA${"f".repeat(32)}` }]) {
      pozabiSprejemKlicev();
      const dir = await pripravi();
      vklopiTestnoOknoSprejema();
      assert.equal((await poslji(dir, zahteva(KLIC), lazni({ ...brezStevilk, klic }))).status, 403, JSON.stringify(klic));
    }
  });

  it("v oknu racun, ki IMA stevilko, ostane pri polni preverbi (stevilka na tujem naslovu je 403)", async () => {
    const dir = await pripravi();
    vklopiTestnoOknoSprejema();
    const tuja = { phone_number: ZA, voice_url: "https://drugje.primer/api/voice/incoming" };
    assert.equal((await poslji(dir, zahteva(KLIC), lazni({ stevilka: tuja }))).status, 403);
  });

  it("v oknu zahteva z napacnim podpisom ostane 403", async () => {
    const dir = await pripravi();
    vklopiTestnoOknoSprejema();
    assert.equal((await poslji(dir, zahteva(KLIC, OD, ZA, "napacen"), lazni(brezStevilk))).status, 403);
  });

  it("tunel okno vklopi ob uspesnem zagonu in ugasne ob pospravljanju (izvorna koda)", async () => {
    const { readFile } = await import("node:fs/promises");
    const koda = await readFile(new URL("./tunel.server.ts", import.meta.url), "utf8");
    assert.match(koda, /this\.faza = "tece";\s*vklopiTestnoOknoSprejema\(\);/);
    assert.match(koda, /private pospravi\(a: Aktiven\): void \{\s*ugasniTestnoOknoSprejema\(\);/);
    assert.match(koda, /pospraviZaIzhod\(\): void \{\s*ugasniTestnoOknoSprejema\(\);/);
  });
});
