/**
 * Dopolnilni preizkusi motivacija.server.ts: meje zgodovine in dolzine, zgodovina ostane ob spremembi nastavitev,
 * pot spomina za osebni slog (privzeti izvor zapiskov), dolg odgovor modela in obseg zahteve (lazni fetch, brez omrezja).
 * Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { shraniLastniStreznik } from "./keys.server.ts";
import { DATOTEKA_MOTIVACIJE, dnevnaMotivacija, nastaviMotivacijo, preberiMotivacijo } from "./motivacija.server.ts";
import { dodajDejstvo, nastaviSpomin } from "./spomin.server.ts";

process.env.LINA_LLM = "0";
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-motivacija2-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const praviFetch = globalThis.fetch;
const staroOkolje = process.env.LINA_DATA;

beforeEach(() => {
  globalThis.fetch = (async () => {
    throw new Error("omrezje v preizkusu ni dovoljeno");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = praviFetch;
  if (staroOkolje === undefined) delete process.env.LINA_DATA;
  else process.env.LINA_DATA = staroOkolje;
});

async function nova(): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  process.env.LINA_DATA = dir;
  return { dir, token: await setupOwner("geslo-test-1234", dir) };
}

const LJ = "Europe/Ljubljana";
const JUTRO = new Date(Date.UTC(2026, 10, 21, 8));
const MOZN = (zdaj: Date) => ({ zdaj, pas: LJ });
const datoteka = (dir: string) => path.join(dir, DATOTEKA_MOTIVACIJE);
const shramba = (dir: string) => JSON.parse(readFileSync(datoteka(dir), "utf8")) as Record<string, unknown> & { zgodovina: Array<Record<string, unknown>> };

const vnos = (dan: string, del: string, besedilo: string, dodatno: Record<string, unknown> = {}) => ({
  dan,
  del,
  tema: del === "vecer" ? "zaključek" : "vztrajnost",
  besedilo,
  vir: "vnaprej",
  ustvarjeno: `${dan}T08:00:00.000Z`,
  ...dodatno,
});

describe("dnevna motivacija: meje in zgodovina", () => {
  it("datoteka z 70 vnosi se ob shranjevanju nastavitev skrajsa na 60 najnovejsih", async () => {
    const { dir, token } = await nova();
    const zgodovina = Array.from({ length: 70 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 5, 1 + i));
      return vnos(d.toISOString().slice(0, 10), "jutro", `Misel številka ${i} za majhen korak naprej.`);
    });
    writeFileSync(datoteka(dir), JSON.stringify({ zgodovina }));
    await nastaviMotivacijo({ humor: "vec" }, token, dir, MOZN(JUTRO));
    const f = shramba(dir);
    assert.equal(f.zgodovina.length, 60);
    assert.equal(f.zgodovina[0].besedilo, "Misel številka 69 za majhen korak naprej.");
    assert.equal(f.zgodovina[59].besedilo, "Misel številka 10 za majhen korak naprej.");
  });

  it("besedilo s 280 znaki je veljavno, s 281 ne; tipi polj se preverijo", async () => {
    const { dir, token } = await nova();
    const dolgo280 = "a".repeat(280);
    writeFileSync(
      datoteka(dir),
      JSON.stringify({
        zgodovina: [
          vnos("2026-11-20", "jutro", dolgo280),
          vnos("2026-11-19", "jutro", "b".repeat(281)),
          vnos("2026-11-18", "jutro", "Veljaven vnos osemnajstega.", { ustvarjeno: 5 }),
          vnos("2026-11-17", "jutro", "Veljaven vnos sedemnajstega.", { dan: 5 }),
          vnos("2026-11-16", "jutro", "Veljaven vnos šestnajstega.", { vir: null }),
        ],
      }),
    );
    const p = await preberiMotivacijo(token, dir, MOZN(JUTRO));
    assert.deepEqual(
      p.prejsnje.map((m) => m.besedilo),
      [dolgo280],
    );
  });

  it("sprememba nastavitev ne izbrise zgodovine", async () => {
    const { dir, token } = await nova();
    const A = "Majhen korak danes naredi večjo razliko, kot si misliš.";
    await dnevnaMotivacija(token, dir, { ...MOZN(JUTRO), generiraj: async () => A });
    const p = await nastaviMotivacijo({ humor: "brez" }, token, dir, MOZN(JUTRO));
    assert.equal(p.jutro?.besedilo, A);
    assert.equal(shramba(dir).zgodovina.length, 1);
    assert.equal(shramba(dir).humor, "brez");
  });
});

describe("dnevna motivacija: neznana tema in vir v datoteki", () => {
  it("vnosi z neznano temo ali neznanim virom se zavrnejo (besedila so razlicna, da je razlika vidna)", async () => {
    const { dir, token } = await nova();
    writeFileSync(
      datoteka(dir),
      JSON.stringify({
        zgodovina: [
          vnos("2026-11-20", "jutro", "Prvi veljaven vnos dvajsetega."),
          vnos("2026-11-19", "jutro", "Vnos z neznano temo devetnajstega.", { tema: "x" }),
          vnos("2026-11-18", "jutro", "Vnos z neznanim virom osemnajstega.", { vir: "x" }),
        ],
      }),
    );
    const p = await preberiMotivacijo(token, dir, MOZN(JUTRO));
    assert.deepEqual(
      p.prejsnje.map((m) => m.besedilo),
      ["Prvi veljaven vnos dvajsetega."],
    );
  });
});

describe("dnevna motivacija: privzeti generator in spomin", () => {
  const NASLOV = "http://127.0.0.1:3194/v1";
  const KLJUC = "freellmapi-izmisljen-kljuc-za-preizkus-3456";

  async function sLastnim(slog: string): Promise<{ dir: string; token: string }> {
    const n = await nova();
    await shraniLastniStreznik({ naslov: NASLOV, key: KLJUC, model: "auto", uporabiZaPogovor: true }, n.token, n.dir);
    await nastaviMotivacijo({ slog }, n.token, n.dir, MOZN(JUTRO));
    return n;
  }
  const odgovor = (besedilo: string) =>
    (async () => new Response(JSON.stringify({ choices: [{ message: { content: besedilo }, finish_reason: "stop" }] }), { status: 200 })) as unknown as typeof fetch;

  it("dolg odgovor (nad 200 znakov) ostane cel", async () => {
    const { dir, token } = await sLastnim("citat");
    const dolgo =
      "Danes si izberi eno stvar, ki jo res želiš dokončati, in jo razdeli na majhne dele. Prvi del naredi takoj, še pred kavo. Ko je prvi korak za tabo, je drugi veliko lažji, tretji pa pride skoraj sam od sebe.";
    assert.ok(dolgo.length > 200 && dolgo.length <= 280, String(dolgo.length));
    let telo = "";
    globalThis.fetch = (async (u: string | URL | Request, init?: RequestInit) => {
      telo = String(init?.body ?? "");
      return odgovor(dolgo)(u, init);
    }) as typeof fetch;
    const p = await dnevnaMotivacija(token, dir, MOZN(JUTRO));
    assert.equal(p.jutro?.vir, "model");
    assert.equal(p.jutro?.besedilo, dolgo);
    // max_tokens za lasten streznik doloci lastni-streznik.ts (spodnja meja), zato ga tu ne pinamo.
    assert.ok(telo.includes("Dan v tednu"));
  });

  it("osebni slog: dejstva iz spomina gredo v zahtevo samo, ce je spomin vklopljen", async () => {
    const { dir, token } = await sLastnim("osebno");
    await dodajDejstvo({ besedilo: "Rad hodi v hribe ob vikendih." }, token, dir);
    const telesa: string[] = [];
    globalThis.fetch = (async (u: string | URL | Request, init?: RequestInit) => {
      telesa.push(String(init?.body ?? ""));
      return odgovor("Pot v hribe se začne z enim samim korakom, danes naredi svojega.")(u, init);
    }) as typeof fetch;
    await nastaviSpomin(false, token, dir);
    await dnevnaMotivacija(token, dir, MOZN(JUTRO));
    assert.equal(telesa.length, 1);
    assert.equal(telesa[0].includes("hribe"), false, "spomin izklopljen: dejstva ne gredo v model");

    await nastaviSpomin(true, token, dir);
    await dnevnaMotivacija(token, dir, MOZN(new Date(JUTRO.getTime() + 24 * 3_600_000)));
    assert.equal(telesa.length, 2);
    assert.ok(telesa[1].includes("Rad hodi v hribe ob vikendih."), "spomin vklopljen: dejstvo je v zahtevi");
  });

  it("slog citat: dejstva iz spomina ne gredo v zahtevo niti ob vklopljenem spominu", async () => {
    const { dir, token } = await sLastnim("citat");
    await dodajDejstvo({ besedilo: "Rad hodi v hribe ob vikendih." }, token, dir);
    await nastaviSpomin(true, token, dir);
    let telo = "";
    globalThis.fetch = (async (u: string | URL | Request, init?: RequestInit) => {
      telo = String(init?.body ?? "");
      return odgovor("Pot v hribe se začne z enim samim korakom, danes naredi svojega.")(u, init);
    }) as typeof fetch;
    await dnevnaMotivacija(token, dir, MOZN(JUTRO));
    assert.ok(telo.length > 0);
    assert.equal(telo.includes("hribe"), false);
  });
});
