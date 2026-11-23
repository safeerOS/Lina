/**
 * Snemanje klicev (lastnik 22. 11. 2026: »Se strinjam«, mapa za vsak klic, roki hrambe). Brez omrezja: lazen Twilio in prenos.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, utimes, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  cakajociPosnetki,
  imaNarocilo,
  koncajSnemanje,
  obIzrekuKlicatelja,
  pospraviPosnetke,
  pozabiZaceteSnemanja,
  smeSnemati,
  zacniSnemanje,
  zavracaSnemanje,
  type Odvisnosti,
} from "./snemanje.server.ts";
import { normalizePravila } from "./pravila.server.ts";
import { stavekZapisa, deliPredstavitve } from "./povzetek.ts";
import type { CallSession } from "./types.ts";

const AC = "AC" + "a".repeat(32);
const CA = "CA" + "b".repeat(32);
const RE = "RE" + "c".repeat(32);

type Klic = { url: string; method: string; body?: string };

function lazni(stanje = "completed", wav = new Uint8Array(1000).fill(7)) {
  const klici: Klic[] = [];
  const odv: Odvisnosti = {
    racun: async () => ({ sid: AC, kljucSid: "SK" + "d".repeat(32), skrivnost: "x".repeat(32) }),
    zahteva: async (url, init) => {
      klici.push({ url, method: init.method, body: init.body });
      if (init.method === "POST" && url.endsWith(`/Calls/${CA}/Recordings.json`)) return { status: 201, json: { sid: RE } };
      if (init.method === "GET") return { status: 200, json: { status: stanje } };
      if (init.method === "DELETE") return { status: 204, json: null };
      return { status: 400, json: null };
    },
    prenesi: (async (url: URL | string) => {
      klici.push({ url: String(url), method: "MEDIJ" });
      return new Response(wav, { status: 200, headers: { "content-type": "audio/wav" } });
    }) as typeof fetch,
    pocakaj: async () => undefined,
  };
  return { klici, odv };
}

function klic(narocilo: boolean, nacin?: "osebna"): CallSession {
  return {
    callSid: CA,
    from: "+38640111222",
    startedAt: "2026-11-22T08:00:00.000Z",
    updatedAt: "2026-11-22T08:01:00.000Z",
    status: "zakljucen",
    transcript: [],
    order: {
      customerName: "Ana",
      phone: "",
      productName: narocilo ? "Vizitke" : null,
      materialName: null,
      requestedProduct: null,
      requestedMaterial: null,
      quantity: null,
      notes: "",
      confirmed: false,
      violations: [],
    },
    ...(nacin ? { nacin } : {}),
  } as CallSession;
}

const podjetje = { nacinKlica: "podjetje" as const, snemanjeVklop: true, snemanjeZavrnitev: true };

test("osebni nacin nikoli ne snema, tudi ce je stikalo shranjeno kot vklopljeno", async () => {
  assert.equal(smeSnemati({ nacinKlica: "osebna", snemanjeVklop: true }), false);
  const p = normalizePravila({ nacinKlica: "osebna", snemanjeVklop: true } as never);
  assert.equal(p.snemanjeVklop, false);
  const dir = await mkdtemp(path.join(tmpdir(), "lina-snem-"));
  const { klici, odv } = lazni();
  pozabiZaceteSnemanja();
  assert.equal(await zacniSnemanje(dir, CA, { nacinKlica: "osebna", snemanjeVklop: true }, odv), null);
  assert.equal(klici.length, 0, "brez zahteve Twiliu");
});

test("nacin podjetje: snemanje privzeto vklopljeno, izrecen false izklopi; hramba 30 dni (1-90), zapiski 90", () => {
  const p = normalizePravila({} as never);
  assert.equal(p.nacinKlica, "podjetje");
  assert.equal(p.snemanjeVklop, true);
  assert.equal(p.snemanjeHrambaDni, 30);
  assert.equal(p.zapiskiHrambaDni, 90);
  assert.equal(normalizePravila({ snemanjeVklop: false } as never).snemanjeVklop, false);
  assert.equal(normalizePravila({ snemanjeHrambaDni: 500 } as never).snemanjeHrambaDni, 90);
});

test("napoved pove namen in rok iz nastavitve; brez snemanja ostane zapisovanje", () => {
  const z = stavekZapisa({ nacinKlica: "podjetje", snemanjeVklop: true, snemanjeHrambaDni: 14 });
  assert.match(z, /snemam/);
  assert.match(z, /dokaz o naročilu/);
  assert.match(z, /14 dni/);
  assert.equal(stavekZapisa({ nacinKlica: "podjetje", snemanjeVklop: false }), "Pogovor zapisujem za naročilo.");
  assert.equal(stavekZapisa({ nacinKlica: "osebna", snemanjeVklop: true }), "Pogovor zapisujem za naročilo.");
  const deli = deliPredstavitve("", "Tiskarna", { nacinKlica: "podjetje", snemanjeVklop: true, snemanjeHrambaDni: 30 });
  assert.ok(deli.some((d) => d.includes("30 dni")));
  assert.match(deli[0], /umetno inteligenco/, "razkritje UI ostane prvo");
});

test("snemanje se zacne enkrat na klic in se zapise v cakajoce", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-snem-"));
  const { klici, odv } = lazni();
  pozabiZaceteSnemanja();
  await obIzrekuKlicatelja(dir, CA, "Rad bi vizitke", podjetje, odv);
  await obIzrekuKlicatelja(dir, CA, "500 kosov", podjetje, odv);
  const post = klici.filter((k) => k.method === "POST");
  assert.equal(post.length, 1);
  assert.match(post[0].body ?? "", /RecordingChannels=dual/);
  assert.deepEqual((await cakajociPosnetki(dir)).map((c) => c.recSid), [RE]);
});

test("klicatelj zavrne snemanje: izbris pri Twiliu, v klicu se ne zacne znova", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-snem-"));
  const { klici, odv } = lazni();
  pozabiZaceteSnemanja();
  await obIzrekuKlicatelja(dir, CA, "Dober dan", podjetje, odv);
  await obIzrekuKlicatelja(dir, CA, "Ne želim snemanja, prosim.", podjetje, odv);
  await obIzrekuKlicatelja(dir, CA, "Vizitke", podjetje, odv);
  assert.equal(klici.filter((k) => k.method === "POST").length, 1);
  assert.equal(klici.filter((k) => k.method === "DELETE").length, 1);
  assert.deepEqual(await cakajociPosnetki(dir), []);
  assert.equal(zavracaSnemanje("ne snemajte"), true);
  assert.equal(zavracaSnemanje("snemanje je ok"), false);
});

test("brez narocila: posnetek samo izbrisan pri Twiliu, lokalno nic", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-snem-"));
  const mapa = path.join(dir, "Ana - klic");
  await mkdir(mapa);
  const { klici, odv } = lazni();
  pozabiZaceteSnemanja();
  await zacniSnemanje(dir, CA, podjetje, odv);
  assert.equal(imaNarocilo(klic(false)), false);
  assert.equal(await koncajSnemanje(dir, klic(false), mapa, odv), "izbrisan");
  assert.equal(klici.filter((k) => k.method === "MEDIJ").length, 0);
  assert.equal(klici.filter((k) => k.method === "DELETE").length, 1);
  assert.deepEqual(await readdir(mapa), []);
  assert.deepEqual(await cakajociPosnetki(dir), []);
});

test("z narocilom: posnetek.wav 0600 v mapi klica, nato izbris pri Twiliu", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-snem-"));
  const mapa = path.join(dir, "Ana - klic");
  await mkdir(mapa);
  const { klici, odv } = lazni();
  pozabiZaceteSnemanja();
  await zacniSnemanje(dir, CA, podjetje, odv);
  assert.equal(await koncajSnemanje(dir, klic(true), mapa, odv), "shranjen");
  const info = await stat(path.join(mapa, "posnetek.wav"));
  assert.equal(info.mode & 0o777, 0o600);
  assert.equal((await readFile(path.join(mapa, "posnetek.wav"))).length, 1000);
  const del = klici.findIndex((k) => k.method === "DELETE");
  assert.ok(del > klici.findIndex((k) => k.method === "MEDIJ"), "izbris pri Twiliu sele po prenosu");
  assert.ok(klici.every((k) => k.method !== "MEDIJ" || k.url.startsWith("https://api.twilio.com/")));
});

test("osebni klic nikoli nima narocila", () => {
  assert.equal(imaNarocilo(klic(true, "osebna")), false);
});

test("rok hrambe: posnetek po roku izbrisan (zapisek ostane), zapisek podjetja po roku izbrisan, osebni ostane", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-snem-"));
  const zapiski = path.join(dir, "zapiski");
  const star = Date.now() / 1000 - 40 * 86400;
  const zelo = Date.now() / 1000 - 100 * 86400;
  // A: podjetje, star 40 dni, s posnetkom -> izbrise se samo posnetek
  await mkdir(path.join(zapiski, "A"), { recursive: true });
  await writeFile(path.join(zapiski, "A", "zapisek.md"), "# A\n<!-- lina-nacin: podjetje -->\n");
  await writeFile(path.join(zapiski, "A", "posnetek.wav"), "x");
  await utimes(path.join(zapiski, "A", "posnetek.wav"), star, star);
  // B: podjetje, star 100 dni -> cela mapa
  await mkdir(path.join(zapiski, "B"));
  await writeFile(path.join(zapiski, "B", "zapisek.md"), `# B\n<!-- lina-cas: ${new Date(zelo * 1000).toISOString()} -->\n<!-- lina-nacin: podjetje -->\n`);
  await utimes(path.join(zapiski, "B", "zapisek.md"), zelo, zelo);
  // C: osebni, star 100 dni -> ostane
  await mkdir(path.join(zapiski, "C"));
  await writeFile(path.join(zapiski, "C", "zapisek.md"), "# C\n");
  await utimes(path.join(zapiski, "C", "zapisek.md"), zelo, zelo);
  // D: podjetje, star 100 dni, a z drugo datoteko -> ostane
  await mkdir(path.join(zapiski, "D"));
  await writeFile(path.join(zapiski, "D", "zapisek.md"), "# D\n<!-- lina-nacin: podjetje -->\n");
  await writeFile(path.join(zapiski, "D", "moje.txt"), "uporabnik");
  await utimes(path.join(zapiski, "D", "zapisek.md"), zelo, zelo);
  const vrstice: string[] = [];
  const izid = await pospraviPosnetke(dir, zapiski, { snemanjeHrambaDni: 30, zapiskiHrambaDni: 90 }, {}, (v) => vrstice.push(v));
  const ostalo = (await readdir(zapiski)).sort();
  assert.deepEqual(ostalo, ["A", "C", "D"]);
  assert.deepEqual(await readdir(path.join(zapiski, "A")), ["zapisek.md"]);
  assert.equal(izid.posnetkov, 1);
  assert.equal(izid.klicev, 1);
  assert.ok(vrstice.every((v) => !/[A-D]/.test(v)), "v dnevniku ni imena ali vsebine");
});
