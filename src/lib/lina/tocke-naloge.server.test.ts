/**
 * Tocke naloge s preverbo na strezniku: NALOGA.md vsebuje tocke, Lina dokaze iz porocila preveri na disku (pot, preizkus v izpisu, commit),
 * naloga brez dokaza za vsako tocko je »nepopolno« (ne »koncano«), manjkajoce tocke dobijo predlog nove naloge (zagon samo po potrditvi),
 * telefon dobi povzetek brez porocila. Agent in terminal sta nadomestka.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { potrdiOpozorilo } from "./opozorilo.server.ts";
import { AGENTI } from "./claude-naloge.ts";
import { korakRazporejevalnika, stanjeClaudeNalog, telefonStanjeNalog, ukazClaudeNalog, type Odvisnosti } from "./claude-naloge.server.ts";
import type { Izvedi } from "./claude-naloge-vodja.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-tocke-"));
const MIN = 60_000;
const T0 = new Date("2026-11-24T08:00:00.000Z");
const ZAGON = new Date("2026-11-24T07:00:00.000Z");
const PET_TOCK = "Popravi Lino:\n1. dodaj a.ts\n2. dodaj b.ts\n3. preizkus a.test.ts\n4. commit\n5. posodobi README.md";

async function okolje(ime: string) {
  const osnova = path.join(KOREN, ime);
  const dom = path.join(osnova, "dom");
  const podatki = path.join(osnova, "podatki");
  const projekt = path.join(dom, "projekt");
  mkdirSync(projekt, { recursive: true });
  mkdirSync(podatki, { recursive: true });
  const token = await setupOwner("geslo-test-1234", podatki);
  await potrdiOpozorilo(podatki);
  const klici: string[] = [];
  const git: string[][] = [];
  // git: obstaja samo commit 0123abcd (nadomestek; pravi git ni potreben)
  const izvedi: Izvedi = async (_p, args) => {
    git.push([...args]);
    // git() Line najprej preveri nastavitve (config --list): prazen seznam = brez nevarnih nastavitev
    if (args.includes("config") && args.includes("--list")) return { koda: 0, izpis: "", potekel: false };
    return { koda: args.at(-1) === "0123abcd^{commit}" ? 0 : 128, izpis: "", potekel: false };
  };
  const o: Odvisnosti = {
    dom,
    platforma: "linux",
    zagonLine: ZAGON,
    najdi: (x) => (["xterm", "git", ...AGENTI].includes(x as never) ? `/usr/bin/${x}` : null),
    preveriZagon: async () => ({ koda: 0, izpis: "1.0.0", potekel: false }),
    zazeni: async (program) => {
      klici.push(program);
      return 4_100_000 + klici.length;
    },
    izvedi,
  };
  const ukaz = (u: Record<string, unknown>, zdaj = T0) => ukazClaudeNalog(token, u, podatki, o, zdaj);
  return { podatki, projekt, token, klici, git, o, ukaz };
}

function porocilo(projekt: string, id: string, besedilo: string) {
  const p = path.join(projekt, ".lina-naloge", id, "POROCILO.md");
  writeFileSync(p, besedilo);
  const t = new Date(T0.getTime() + 20 * MIN);
  utimesSync(p, t, t);
}

describe("tocke naloge: NALOGA.md in preverba dokazov", { concurrency: 1 }, () => {
  it("NALOGA.md vsebuje vse tocke T1..T5 in obliko vrstice porocila", async () => {
    const e = await okolje("naloga");
    const z = (await e.ukaz({ ukaz: "dodeli", agent: "claude", mapa: e.projekt, besedilo: PET_TOCK, pogoj: "zdaj" })).naloge[0]!;
    const md = readFileSync(path.join(e.projekt, ".lina-naloge", z.id, "NALOGA.md"), "utf8");
    for (const t of ["T1: dodaj a.ts", "T2: dodaj b.ts", "T3: preizkus a.test.ts", "T4: commit", "T5: posodobi README.md"]) assert.ok(md.includes(t), t);
    assert.match(md, /T<n>: narejeno - dokaz:/);
  });

  it("3/5 narejeno: nepopolno (ne koncano), manjkajoce z razlogi, predlog nove naloge caka potrditev in se ne zazene", async () => {
    const e = await okolje("tri-od-pet");
    const z = (await e.ukaz({ ukaz: "dodeli", agent: "claude", mapa: e.projekt, besedilo: PET_TOCK, pogoj: "zdaj" })).naloge[0]!;
    writeFileSync(path.join(e.projekt, "a.ts"), "a");
    writeFileSync(path.join(e.projekt, "a.test.ts"), "t");
    porocilo(e.projekt, z.id, [
      "T1: narejeno - dokaz: a.ts",
      "T2: narejeno - dokaz: b.ts",
      "T3: narejeno - dokaz: preizkus: a.test.ts",
      "T4: narejeno - dokaz: commit: 0123abcd",
      "T5: ni narejeno - razlog: ni casa",
      "",
      "Izpis:",
      "ok 1 - a.test.ts",
    ].join("\n"));
    await korakRazporejevalnika(e.podatki, e.o, new Date(T0.getTime() + 21 * MIN));
    const s = await stanjeClaudeNalog(e.token, e.podatki, e.o, new Date(T0.getTime() + 22 * MIN));
    const n = s.naloge.find((x) => x.id === z.id)!;
    assert.equal(n.stanje, "nepopolno");
    assert.equal(n.tocke?.skupaj, 5);
    assert.equal(n.tocke?.narejeno, 3);
    assert.deepEqual(n.tocke?.manjkajoce.map((m) => [m.st, m.razlog]), [[2, "dokaz-ni-najden"], [5, "ni-narejeno"]]);
    assert.ok(e.git.some((a) => a.includes("cat-file") && a.at(-1) === "0123abcd^{commit}"));
    // predlog nove naloge: izvor lina, caka potrditev, samo besedilo tock iz naloge
    const predlog = s.naloge.find((x) => x.id === n.predlogTock)!;
    assert.equal(predlog.stanje, "caka");
    assert.equal(predlog.izvor, "lina");
    assert.equal(predlog.mapa, e.projekt);
    assert.match(predlog.besedilo, /1\. dodaj b\.ts\n2\. posodobi README\.md/);
    assert.doesNotMatch(predlog.besedilo, /ni casa/);
    assert.equal(e.klici.length, 1);
    // drugi korak ne ustvari drugega predloga
    await korakRazporejevalnika(e.podatki, e.o, new Date(T0.getTime() + 22 * MIN));
    assert.equal((await stanjeClaudeNalog(e.token, e.podatki, e.o, new Date(T0.getTime() + 22 * MIN))).naloge.filter((x) => x.izvor === "lina").length, 1);
    // odklonjen predlog: lastnik dobi gumb (predlogTock = »napaka«) in ukaz »predlagaj-tocke« doda nov predlog (izvor lastnik, caka)
    await e.ukaz({ ukaz: "odkloni", id: predlog.id }, new Date(T0.getTime() + 23 * MIN));
    assert.equal((await stanjeClaudeNalog(e.token, e.podatki, e.o, new Date(T0.getTime() + 23 * MIN))).naloge.find((x) => x.id === z.id)!.predlogTock, "napaka");
    const po = await e.ukaz({ ukaz: "predlagaj-tocke", id: z.id }, new Date(T0.getTime() + 23 * MIN));
    const nov = po.naloge.find((x) => x.id === po.naloge.find((y) => y.id === z.id)!.predlogTock)!;
    assert.equal(nov.stanje, "caka");
    assert.equal(nov.izvor, "lastnik");
    assert.equal(e.klici.length, 1);
    await assert.rejects(e.ukaz({ ukaz: "predlagaj-tocke", id: "0123456789abcdef" }), { razlog: "polno-cakajoce" });
    // telefon: povzetek tock je, porocila ni
    const tel = (await telefonStanjeNalog(e.podatki, e.o, new Date(T0.getTime() + 24 * MIN))) as { naloge: Record<string, unknown>[] };
    const t = tel.naloge.find((x) => x.id === z.id)!;
    assert.equal(t.porocilo, undefined);
    assert.deepEqual((t.tocke as { skupaj: number; narejeno: number }).narejeno, 3);
  });

  it("vse tocke z dokazom = koncano; preizkus brez omembe v izpisu, simbolna povezava, .lina-naloge in pot zunaj projekta niso dokaz", async () => {
    const e = await okolje("vse");
    const z = (await e.ukaz({ ukaz: "dodeli", agent: "claude", mapa: e.projekt, besedilo: "1. a\n2. b", pogoj: "zdaj" })).naloge[0]!;
    mkdirSync(path.join(e.projekt, "src"));
    writeFileSync(path.join(e.projekt, "src", "a.ts"), "a");
    writeFileSync(path.join(e.projekt, "src", "a.test.ts"), "t");
    porocilo(e.projekt, z.id, "T1: narejeno - dokaz: src/a.ts:3\nT2: done - evidence: test: src/a.test.ts\n# pass 1 src/a.test.ts");
    await korakRazporejevalnika(e.podatki, e.o, new Date(T0.getTime() + 21 * MIN));
    const n = (await stanjeClaudeNalog(e.token, e.podatki, e.o, T0)).naloge.find((x) => x.id === z.id)!;
    assert.equal(n.stanje, "koncano");
    assert.deepEqual(n.tocke, { skupaj: 2, narejeno: 2, popolno: true, manjkajoce: [] });
    assert.equal(n.predlogTock, null);

    const e2 = await okolje("lazni");
    const z2 = (await e2.ukaz({ ukaz: "dodeli", agent: "claude", mapa: e2.projekt, besedilo: "1. a\n2. b\n3. c\n4. d", pogoj: "zdaj" })).naloge[0]!;
    writeFileSync(path.join(e2.projekt, "a.test.ts"), "t");
    symlinkSync("/etc/hostname", path.join(e2.projekt, "povezava"));
    porocilo(e2.projekt, z2.id, [
      "T1: narejeno - dokaz: preizkus: a.test.ts",
      "T2: narejeno - dokaz: povezava",
      `T3: narejeno - dokaz: .lina-naloge/${z2.id}/POROCILO.md`,
      "T4: narejeno - dokaz: /etc/hostname",
    ].join("\n"));
    await korakRazporejevalnika(e2.podatki, e2.o, new Date(T0.getTime() + 21 * MIN));
    const n2 = (await stanjeClaudeNalog(e2.token, e2.podatki, e2.o, T0)).naloge.find((x) => x.id === z2.id)!;
    assert.equal(n2.stanje, "nepopolno");
    assert.equal(n2.tocke?.narejeno, 0);
    assert.ok(n2.tocke?.manjkajoce.every((m) => m.razlog === "dokaz-ni-najden"));
  });

  it("»narejeno« brez dokaza ne steje; porocilo brez vrstic tock = vse manjka", async () => {
    const e = await okolje("brez-dokaza");
    const z = (await e.ukaz({ ukaz: "dodeli", agent: "claude", mapa: e.projekt, besedilo: "1. a\n2. b", pogoj: "zdaj" })).naloge[0]!;
    porocilo(e.projekt, z.id, "T1: narejeno\nVse narejeno.");
    await korakRazporejevalnika(e.podatki, e.o, new Date(T0.getTime() + 21 * MIN));
    const n = (await stanjeClaudeNalog(e.token, e.podatki, e.o, T0)).naloge.find((x) => x.id === z.id)!;
    assert.deepEqual(n.tocke?.manjkajoce.map((m) => m.razlog), ["brez-dokaza", "manjka"]);
  });

  it("naloga »ko konca <id>« za nepopolno nalogo ne steče sama: zamujeno (lastnik potrdi znova)", async () => {
    const e = await okolje("po-nepopolno");
    const a = (await e.ukaz({ ukaz: "dodeli", agent: "claude", mapa: e.projekt, besedilo: "1. a\n2. b", pogoj: "zdaj" })).naloge[0]!;
    const b = (await e.ukaz({ ukaz: "dodeli", agent: "pi", mapa: e.projekt, besedilo: "B.", pogoj: `po:${a.id}` })).naloge[0]!;
    porocilo(e.projekt, a.id, "T1: ni narejeno - razlog: x\nT2: ni narejeno - razlog: y");
    await korakRazporejevalnika(e.podatki, e.o, new Date(T0.getTime() + 21 * MIN));
    assert.equal((await stanjeClaudeNalog(e.token, e.podatki, e.o, T0)).naloge.find((n) => n.id === b.id)!.stanje, "zamujeno");
    assert.equal(e.klici.length, 1);
  });

  it("stanje pred korakom razporejevalnika (vmesnik bere prej) ze kaze nepopolno in povzetek", async () => {
    const e = await okolje("javno");
    const z = (await e.ukaz({ ukaz: "dodeli", agent: "claude", mapa: e.projekt, besedilo: "1. a\n2. b", pogoj: "zdaj" })).naloge[0]!;
    porocilo(e.projekt, z.id, "T1: ni narejeno - razlog: x");
    const n = (await stanjeClaudeNalog(e.token, e.podatki, e.o, new Date(T0.getTime() + 21 * MIN))).naloge.find((x) => x.id === z.id)!;
    assert.equal(n.stanje, "nepopolno");
    assert.equal(n.tocke?.narejeno, 0);
  });
});
