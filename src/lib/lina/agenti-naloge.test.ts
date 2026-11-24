/**
 * Lina vodi vse agente na racunalniku in izvede vnaprej dodeljene naloge (lastnik 24. 11. 2026, AGENTS.md). Preizkusi brez pravih
 * agentov in terminala: zagon in preverba zagona sta nadomestka (razen preverbe, ki mora ubiti obviselo skripto).
 * Deli: seznam agentov in argv, preverba zagona brez okna, prepovedane mape, vrsta dodeljenih nalog z razporejevalnikom,
 * ocena trajanja in lasten opomnik, dogodek »naloga koncana«, oznaka [[agent-naloga: ...]], locitev od poti klica.
 */
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { potrdiOpozorilo } from "./opozorilo.server.ts";
import {
  AGENTI,
  OPIS_AGENTOV,
  PRIVZETO_TRAJANJE_MS,
  argvAgenta,
  izluciPredloge,
  ocenaTrajanja,
  pozivZaClaude,
  razberiPogoj,
  razpored,
  vPrepovedani,
  type ZapisNaloge,
} from "./claude-naloge.ts";
import {
  DATOTEKA_STANJA,
  korakRazporejevalnika,
  obNalogaKoncana,
  privzetaPreverba,
  stanjeClaudeNalog,
  ukazClaudeNalog,
  type DogodekNalogaKoncana,
  type Odvisnosti,
  type PreverbaZagona,
} from "./claude-naloge.server.ts";
import { brezOznak, obdelajClaudeCode } from "./asistent-pogovor.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-agenti-"));
const MIN = 60_000;
const T0 = new Date("2026-11-24T08:00:00.000Z");
const ZAGON = new Date("2026-11-24T07:00:00.000Z");

type Klic = { program: string; args: readonly string[]; cwd: string };

/** Preverba zagona: vsi agenti odgovorijo na --version; grok na »models« pove prijavo (ali »Not signed in«). */
function preverba(o: { neprijavljen?: boolean; pokvarjen?: string[] } = {}): { fn: PreverbaZagona; klici: string[] } {
  const klici: string[] = [];
  const fn: PreverbaZagona = async (program, args) => {
    klici.push(`${path.basename(program)} ${args.join(" ")}`);
    if (o.pokvarjen?.includes(path.basename(program))) return { koda: 1, izpis: "napaka", potekel: false };
    if (args[0] === "models") return { koda: 0, izpis: o.neprijavljen ? "Not signed in. Run grok login." : "You are logged in with grok.com.", potekel: false };
    return { koda: 0, izpis: "1.0.0", potekel: false };
  };
  return { fn, klici };
}

async function okolje(ime: string, p = preverba()) {
  const osnova = path.join(KOREN, ime);
  const dom = path.join(osnova, "dom");
  const podatki = path.join(osnova, "podatki");
  const projekt = path.join(dom, "projekt");
  mkdirSync(projekt, { recursive: true });
  mkdirSync(podatki, { recursive: true });
  const token = await setupOwner("geslo-test-1234", podatki);
  await potrdiOpozorilo(podatki); // brez potrditve opozorila Lina agentov ne zaganja (opozorilo.test.ts)
  const klici: Klic[] = [];
  const o: Odvisnosti = {
    dom,
    platforma: "linux",
    zagonLine: ZAGON,
    najdi: (x) => (["xterm", ...AGENTI].includes(x as never) ? `/usr/bin/${x}` : null),
    preveriZagon: p.fn,
    zazeni: async (program, args, cwd) => {
      klici.push({ program, args, cwd });
      return 4_000_000 + klici.length;
    },
  };
  const ukaz = (u: Record<string, unknown>, zdaj = T0) => ukazClaudeNalog(token, u, podatki, o, zdaj);
  return { osnova, dom, podatki, projekt, token, klici, o, ukaz, preverba: p };
}

function porocilo(mapa: string, id: string, mtime: Date) {
  const p = path.join(mapa, ".lina-naloge", id, "POROCILO.md");
  writeFileSync(p, "Narejeno.");
  utimesSync(p, mtime, mtime);
}

describe("agenti: seznam in argv (preverjeno z --help 24. 11. 2026)", () => {
  it("dovoljeni agenti so natanko claude, agy, opencode, kimi, pi, grok (freebuff odstranjen)", () => {
    assert.deepEqual([...AGENTI], ["claude", "agy", "opencode", "kimi", "pi", "grok"]);
  });

  it("argv za interaktivni zagon z zacetnim pozivom, tocno po --help; kimi nima zacetnega poziva", () => {
    const p = pozivZaClaude("0123456789abcdef");
    assert.deepEqual(argvAgenta("claude", p), [p]);
    assert.deepEqual(argvAgenta("agy", p), ["--prompt-interactive", p]);
    assert.deepEqual(argvAgenta("opencode", p), ["--prompt", p]);
    assert.deepEqual(argvAgenta("pi", p), [p]);
    assert.deepEqual(argvAgenta("grok", p), [p]);
    assert.equal(argvAgenta("kimi", p), null);
    assert.equal(OPIS_AGENTOV.kimi.zacetniPoziv, false);
  });

  it("samo claude ima kanal (samodejni odgovor); opencode in agy imata omejene mape", () => {
    assert.deepEqual(AGENTI.filter((a) => OPIS_AGENTOV[a].kanal), ["claude"]);
    assert.deepEqual(AGENTI.filter((a) => OPIS_AGENTOV[a].omejeneMape), ["agy", "opencode"]);
  });

  it("stanje agentov: zaznan in preverjen, ni najden, ne deluje, grok brez prijave; preverba samo --version (in grok models)", async () => {
    const p = preverba({ neprijavljen: true, pokvarjen: ["pi"] });
    const e = await okolje("stanje-agentov", p);
    e.o.najdi = (x) => (x === "opencode" ? null : ["xterm", ...AGENTI].includes(x as never) ? `/usr/bin/${x}` : null);
    const s = await stanjeClaudeNalog(e.token, e.podatki, e.o, T0);
    const po = Object.fromEntries(s.agenti.map((a) => [a.id, a.stanje]));
    assert.deepEqual(po, { claude: "pripravljen", agy: "pripravljen", opencode: "ni-najden", kimi: "pripravljen", pi: "ne-deluje", grok: "prijava" });
    assert.ok(p.klici.every((k) => / --version$/.test(k) || k === "grok models"), p.klici.join(";"));
    assert.ok(p.klici.includes("grok models"));
  });
});

describe("preverba zagona brez okna", () => {
  it("obviselega programa ne caka: po roku ubije celo skupino procesov (tudi ce ignorira SIGTERM) in ne preda zaslona", async () => {
    const mapa = mkdtempSync(path.join(tmpdir(), "lina-agent-obvisi-"));
    const skripta = path.join(mapa, "obvisi");
    const pidi = path.join(mapa, "pidi");
    writeFileSync(skripta, `#!/bin/sh\ntrap '' TERM\necho "zaslon=[$DISPLAY$WAYLAND_DISPLAY]"\nsleep 30 &\necho "$$ $!" > ${pidi}\nwait\n`);
    chmodSync(skripta, 0o755);
    const prej = { d: process.env.DISPLAY, w: process.env.WAYLAND_DISPLAY };
    process.env.DISPLAY = ":99";
    process.env.WAYLAND_DISPLAY = "wayland-9";
    const zacetek = Date.now();
    try {
      const izid = await privzetaPreverba(skripta, ["--version"], 700);
      assert.equal(izid.potekel, true);
      assert.ok(Date.now() - zacetek < 5000, "preverba je cakala predolgo");
      assert.match(izid.izpis, /zaslon=\[\]/);
      // ubit je program IN njegov otrok (sleep), ne samo program s SIGTERM, ki ga ignorira
      for (const pid of readFileSync(pidi, "utf8").trim().split(" ").map(Number)) {
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, `proces ${pid} se zivi`);
      }
    } finally {
      if (prej.d === undefined) delete process.env.DISPLAY; else process.env.DISPLAY = prej.d;
      if (prej.w === undefined) delete process.env.WAYLAND_DISPLAY; else process.env.WAYLAND_DISPLAY = prej.w;
    }
  });

  it("hiter program: koda in izpis (omejen)", async () => {
    const mapa = mkdtempSync(path.join(tmpdir(), "lina-agent-hiter-"));
    const skripta = path.join(mapa, "hiter");
    writeFileSync(skripta, `#!/bin/sh\necho 2.1.0\nhead -c 100000 /dev/zero | tr '\\0' x\n`);
    chmodSync(skripta, 0o755);
    const izid = await privzetaPreverba(skripta, ["--version"], 3000);
    assert.equal(izid.koda, 0);
    assert.equal(izid.potekel, false);
    assert.match(izid.izpis, /^2\.1\.0/);
    assert.ok(izid.izpis.length <= 4096);
  });
});

describe("prepovedane mape za opencode (Gemini) in agy", { concurrency: 1 }, () => {
  it("cista logika: ista mapa, podmapa in nadmapa so prepovedane; sosednja s skupno predpono ni", () => {
    const pr = ["/home/a/scit"];
    assert.equal(vPrepovedani("/home/a/scit", pr), true);
    assert.equal(vPrepovedani("/home/a/scit/src", pr), true);
    assert.equal(vPrepovedani("/home/a", pr), true);
    assert.equal(vPrepovedani("/home/a/scit2", pr), false);
    assert.equal(vPrepovedani("/home/a/drugo", pr), false);
    assert.equal(vPrepovedani("/home/a/scit", []), false);
  });

  it("seznam je privzeto prazen; mapo s simbolno povezavo do prepovedane opencode zavrne z razlogom, claude jo sme", async () => {
    const e = await okolje("prepoved");
    const scit = path.join(e.dom, "scit");
    mkdirSync(path.join(scit, "src"), { recursive: true });
    const povezava = path.join(e.dom, "povezava");
    symlinkSync(path.join(scit, "src"), povezava);
    assert.deepEqual((await stanjeClaudeNalog(e.token, e.podatki, e.o, T0)).prepovedane, []);
    await e.ukaz({ ukaz: "prepovedane", mape: [scit] });
    await assert.rejects(e.ukaz({ ukaz: "dodeli", agent: "opencode", mapa: povezava, besedilo: "Preglej kodo.", pogoj: "zdaj" }), { razlog: "mapa-prepovedana" });
    await assert.rejects(e.ukaz({ ukaz: "dodeli", agent: "agy", mapa: e.dom + "/scit/src", besedilo: "Preglej kodo.", pogoj: "zdaj" }), { razlog: "mapa-prepovedana" });
    assert.equal(e.klici.length, 0);
    const s = await e.ukaz({ ukaz: "dodeli", agent: "claude", mapa: povezava, besedilo: "Preglej kodo.", pogoj: "zdaj" });
    assert.equal(s.naloge[0]!.stanje, "tece");
    assert.equal(e.klici.length, 1);
  });

  it("nadmapa prepovedane je prepovedana; neobstojeca prepovedana mapa ostane na seznamu dobesedno (ne odpade)", async () => {
    const e = await okolje("prepoved-nad");
    const projekti = path.join(e.dom, "projekti");
    mkdirSync(path.join(projekti, "yt"), { recursive: true });
    const delo = path.join(e.dom, "delo");
    mkdirSync(delo, { recursive: true });
    const prihodnja = path.join(delo, "prihodnja");
    await e.ukaz({ ukaz: "prepovedane", mape: [path.join(projekti, "yt"), prihodnja] });
    await assert.rejects(e.ukaz({ ukaz: "dodeli", agent: "opencode", mapa: projekti, besedilo: "x", pogoj: "zdaj" }), { razlog: "mapa-prepovedana" });
    // se neobstojeca prepovedana mapa: njena nadmapa je prepovedana (seznam ne izgubi vnosa, ki se ne razresi)
    await assert.rejects(e.ukaz({ ukaz: "dodeli", agent: "opencode", mapa: delo, besedilo: "x", pogoj: "zdaj" }), { razlog: "mapa-prepovedana" });
    assert.deepEqual((await stanjeClaudeNalog(e.token, e.podatki, e.o, T0)).prepovedane, [path.join(projekti, "yt"), prihodnja]);
    mkdirSync(path.join(prihodnja, "a"), { recursive: true });
    await assert.rejects(e.ukaz({ ukaz: "dodeli", agent: "opencode", mapa: path.join(prihodnja, "a"), besedilo: "x", pogoj: "zdaj" }), { razlog: "mapa-prepovedana" });
  });

  it("prepoved velja tudi ob zagonu: mapa, dodana na seznam po dodelitvi, ustavi zagon ob uri", async () => {
    const e = await okolje("prepoved-zagon");
    const ura = new Date(T0.getTime() + 30 * MIN).toISOString();
    const s = await e.ukaz({ ukaz: "dodeli", agent: "opencode", mapa: e.projekt, besedilo: "x", pogoj: `ura:${ura}` });
    assert.equal(s.naloge[0]!.stanje, "dodeljeno");
    await e.ukaz({ ukaz: "prepovedane", mape: [e.projekt] });
    await korakRazporejevalnika(e.podatki, e.o, new Date(T0.getTime() + 31 * MIN));
    const z = (await stanjeClaudeNalog(e.token, e.podatki, e.o, T0)).naloge[0]!;
    assert.equal(z.stanje, "napaka");
    assert.equal(z.razlog, "mapa-prepovedana");
    assert.equal(e.klici.length, 0);
  });
});

describe("vrsta vnaprej dodeljenih nalog", { concurrency: 1 }, () => {
  it("dodelitev »zdaj« je potrditev za en zagon: terminal z argv agenta, stanje 0600, ocena in opomnik", async () => {
    const e = await okolje("zdaj");
    const s = await e.ukaz({ ukaz: "dodeli", agent: "agy", mapa: e.projekt, besedilo: "Dodaj preizkus.", pogoj: "zdaj" });
    const z = s.naloge[0]!;
    assert.equal(z.stanje, "tece");
    assert.equal(z.agent, "agy");
    assert.deepEqual(e.klici[0]!.args, ["-e", "/usr/bin/agy", "--prompt-interactive", pozivZaClaude(z.id)]);
    assert.equal(e.klici[0]!.cwd, e.projekt);
    assert.ok(!e.klici[0]!.args.some((a) => /dangerously|yolo|--auto|always-approve/.test(a)));
    assert.equal(statSync(path.join(e.podatki, DATOTEKA_STANJA)).mode & 0o777, 0o600);
    assert.equal(z.ocena?.groba, true);
    assert.equal(Date.parse(z.ocena!.konec) - T0.getTime(), PRIVZETO_TRAJANJE_MS);
    assert.equal(z.opomnik?.cas, z.ocena!.konec);
    assert.match(readFileSync(path.join(e.projekt, ".lina-naloge", z.id, "NALOGA.md"), "utf8"), /Dodaj preizkus\./);
  });

  it("opozorilo (prenos 24. 11. 2026): brez potrditve ni dodelitve; po novi razlicici opozorila razporejevalnik ne zazene nicesar", async () => {
    const e = await okolje("opozorilo");
    const ura = new Date(T0.getTime() + 60 * MIN).toISOString();
    const s = await e.ukaz({ ukaz: "dodeli", agent: "pi", mapa: e.projekt, besedilo: "Ob uri.", pogoj: `ura:${ura}` });
    // nova razlicica besedila opozorila (stara potrditev ne velja vec)
    writeFileSync(path.join(e.podatki, "opozorilo.json"), JSON.stringify({ razlicica: "stara" }));
    await assert.rejects(e.ukaz({ ukaz: "dodeli", agent: "pi", mapa: e.projekt, besedilo: "Zdaj.", pogoj: "zdaj" }), { razlog: "opozorilo" });
    await korakRazporejevalnika(e.podatki, e.o, new Date(T0.getTime() + 61 * MIN));
    assert.equal(e.klici.length, 0);
    const z = (await stanjeClaudeNalog(e.token, e.podatki, e.o, T0)).naloge.find((n) => n.id === s.naloge[0]!.id)!;
    assert.equal(z.stanje, "napaka");
    assert.equal(z.razlog, "opozorilo");
  });

  it("zagon dodeljene naloge (zazeniZapis) zapise cas zagona PID (pregled 0225 B8)", async () => {
    const e = await okolje("pid-zagon");
    const o = { ...e.o, casZagona: (pid: number) => `z-${pid}` };
    await ukazClaudeNalog(e.token, { ukaz: "dodeli", agent: "pi", mapa: e.projekt, besedilo: "Prva.", pogoj: "zdaj" }, e.podatki, o, T0);
    const stanje = JSON.parse(readFileSync(path.join(e.podatki, DATOTEKA_STANJA), "utf8")) as { naloge: { pid?: number; pidZagon?: string }[] };
    assert.equal(stanje.naloge[0]!.pidZagon, `z-${stanje.naloge[0]!.pid}`);
  });

  it("B8 v razporejevalniku: ziv PID z istim casom zagona drzi mesto; ponovno uporabljen PID (drug cas) ga sprosti", async () => {
    const e = await okolje("b8-razpored");
    let cas = "a";
    const o = { ...e.o, casZagona: () => cas, zazeni: async () => process.pid };
    const s = await ukazClaudeNalog(e.token, { ukaz: "dodeli", agent: "pi", mapa: e.projekt, besedilo: "Prva.", pogoj: "zdaj" }, e.podatki, o, T0);
    const id = s.naloge[0]!.id;
    porocilo(e.projekt, id, new Date(T0.getTime() + 5 * MIN));
    const surovo = () => (JSON.parse(readFileSync(path.join(e.podatki, DATOTEKA_STANJA), "utf8")) as { naloge: { id: string; stanje: string }[] }).naloge.find((n) => n.id === id)!.stanje;
    await korakRazporejevalnika(e.podatki, o, new Date(T0.getTime() + 6 * MIN));
    assert.equal(surovo(), "tece");
    cas = "b";
    await korakRazporejevalnika(e.podatki, o, new Date(T0.getTime() + 7 * MIN));
    assert.equal(surovo(), "koncano");
  });

  it("NALOGA.md vsakega agenta: pregled novega projekta ob prvem zagonu, kazalo spomina prejsnjih nalog v istem projektu", async () => {
    const e = await okolje("pregled-spomin");
    writeFileSync(path.join(e.projekt, "package.json"), JSON.stringify({ name: "p", scripts: { test: "node --test" } }));
    const s1 = await e.ukaz({ ukaz: "dodeli", agent: "pi", mapa: e.projekt, besedilo: "Dodaj ciscenje zvoka.", pogoj: "zdaj" });
    const id1 = s1.naloge[0]!.id;
    assert.match(readFileSync(path.join(e.projekt, ".lina-naloge", id1, "NALOGA.md"), "utf8"), /## Pregled projekta/);
    porocilo(e.projekt, id1, new Date(T0.getTime() + 5 * MIN));
    await korakRazporejevalnika(e.podatki, e.o, new Date(T0.getTime() + 6 * MIN));
    const s2 = await e.ukaz({ ukaz: "dodeli", agent: "grok", mapa: e.projekt, besedilo: "Se ena naloga o ciscenju zvoka.", pogoj: "zdaj" }, new Date(T0.getTime() + 7 * MIN));
    const id2 = s2.naloge.find((n) => n.id !== id1)!.id;
    const md2 = readFileSync(path.join(e.projekt, ".lina-naloge", id2, "NALOGA.md"), "utf8");
    assert.doesNotMatch(md2, /## Pregled projekta/);
    assert.match(md2, /## Spomin prejsnjih nalog v projektu \(kazalo\)/);
    assert.match(md2, /ciscenje zvoka/);
  });

  it("»ob uri«: do ure nic, ob uri zagon; zamujena ura (Lina ni tekla) = »zamujeno«, zagon sele po ponovni potrditvi", async () => {
    const e = await okolje("ura");
    const ura = new Date(T0.getTime() + 60 * MIN).toISOString();
    const s = await e.ukaz({ ukaz: "dodeli", agent: "pi", mapa: e.projekt, besedilo: "Naloga ob uri.", pogoj: `ura:${ura}` });
    assert.equal(s.naloge[0]!.stanje, "dodeljeno");
    await korakRazporejevalnika(e.podatki, e.o, new Date(T0.getTime() + 59 * MIN));
    assert.equal(e.klici.length, 0);
    await korakRazporejevalnika(e.podatki, e.o, new Date(T0.getTime() + 61 * MIN));
    assert.equal(e.klici.length, 1);
    assert.deepEqual(e.klici[0]!.args.slice(1), ["/usr/bin/pi", pozivZaClaude(s.naloge[0]!.id)]);

    // druga naloga: ura je minila, ko Lina ni tekla (nov zagon Line kasneje)
    const ura2 = new Date(T0.getTime() + 90 * MIN).toISOString();
    const s2 = await e.ukaz({ ukaz: "dodeli", agent: "pi", mapa: e.projekt, besedilo: "Druga.", pogoj: `ura:${ura2}` });
    const id2 = s2.naloge[0]!.id;
    // Lina se je zagnala 2 min po uri (znotraj tolerance spanja): zamujeno, ker ob uri ni tekla
    const o2 = { ...e.o, zagonLine: new Date(T0.getTime() + 92 * MIN) };
    await korakRazporejevalnika(e.podatki, o2, new Date(T0.getTime() + 93 * MIN));
    const z2 = (await stanjeClaudeNalog(e.token, e.podatki, o2, T0)).naloge.find((n) => n.id === id2)!;
    assert.equal(z2.stanje, "zamujeno");
    assert.equal(e.klici.length, 1);
    await assert.rejects(ukazClaudeNalog(e.token, { ukaz: "potrdi", id: id2, zgostitev: "0".repeat(64) }, e.podatki, o2, new Date(T0.getTime() + 94 * MIN)), { razlog: "zgostitev" });
    // prva naloga (pi ob +61) se tece brez porocila: ena od dveh mest je zasedena, druga je prosta
    await ukazClaudeNalog(e.token, { ukaz: "potrdi", id: id2, zgostitev: z2.zgostitev }, e.podatki, o2, new Date(T0.getTime() + 94 * MIN));
    assert.equal(e.klici.length, 2);
  });

  it("»ob uri« med spanjem racunalnika (ura minila za vec kot 5 min med tekom) = zamujeno", async () => {
    const e = await okolje("spanje");
    const ura = new Date(T0.getTime() + 10 * MIN).toISOString();
    await e.ukaz({ ukaz: "dodeli", agent: "pi", mapa: e.projekt, besedilo: "x", pogoj: `ura:${ura}` });
    await korakRazporejevalnika(e.podatki, e.o, new Date(T0.getTime() + 40 * MIN));
    assert.equal((await stanjeClaudeNalog(e.token, e.podatki, e.o, T0)).naloge[0]!.stanje, "zamujeno");
    assert.equal(e.klici.length, 0);
  });

  it("»ko konca <id>«: zagon sele po porocilu prve; preklicana prva = napaka pogoja; prva koncana, ko Lina ni tekla = zamujeno", async () => {
    const e = await okolje("po");
    const prva = (await e.ukaz({ ukaz: "dodeli", agent: "claude", mapa: e.projekt, besedilo: "Prva.", pogoj: "zdaj" })).naloge[0]!;
    const druga = (await e.ukaz({ ukaz: "dodeli", agent: "grok", mapa: e.projekt, besedilo: "Druga.", pogoj: `po:${prva.id}` })).naloge[0]!;
    assert.equal(druga.stanje, "dodeljeno");
    await korakRazporejevalnika(e.podatki, e.o, new Date(T0.getTime() + 5 * MIN));
    assert.equal(e.klici.length, 1);
    porocilo(e.projekt, prva.id, new Date(T0.getTime() + 20 * MIN));
    await korakRazporejevalnika(e.podatki, e.o, new Date(T0.getTime() + 21 * MIN));
    assert.equal(e.klici.length, 2);
    assert.deepEqual(e.klici[1]!.args.slice(1), ["/usr/bin/grok", pozivZaClaude(druga.id)]);

    const tretja = (await e.ukaz({ ukaz: "dodeli", agent: "pi", mapa: e.projekt, besedilo: "Tretja.", pogoj: "ura:" + new Date(T0.getTime() + 600 * MIN).toISOString() })).naloge[0]!;
    const cetrta = (await e.ukaz({ ukaz: "dodeli", agent: "pi", mapa: e.projekt, besedilo: "Cetrta.", pogoj: `po:${tretja.id}` })).naloge[0]!;
    await e.ukaz({ ukaz: "preklici", id: tretja.id });
    await korakRazporejevalnika(e.podatki, e.o, new Date(T0.getTime() + 22 * MIN));
    const c = (await stanjeClaudeNalog(e.token, e.podatki, e.o, T0)).naloge.find((n) => n.id === cetrta.id)!;
    assert.equal(c.stanje, "napaka");
    assert.equal(c.razlog, "pogoj");

    const e2 = await okolje("po-zamujeno");
    const a = (await e2.ukaz({ ukaz: "dodeli", agent: "claude", mapa: e2.projekt, besedilo: "A.", pogoj: "zdaj" })).naloge[0]!;
    const b = (await e2.ukaz({ ukaz: "dodeli", agent: "pi", mapa: e2.projekt, besedilo: "B.", pogoj: `po:${a.id}` })).naloge[0]!;
    porocilo(e2.projekt, a.id, new Date(T0.getTime() + 20 * MIN));
    const pozneje = { ...e2.o, zagonLine: new Date(T0.getTime() + 120 * MIN) };
    await korakRazporejevalnika(e2.podatki, pozneje, new Date(T0.getTime() + 121 * MIN));
    assert.equal((await stanjeClaudeNalog(e2.token, e2.podatki, pozneje, T0)).naloge.find((n) => n.id === b.id)!.stanje, "zamujeno");
    assert.equal(e2.klici.length, 1);
  });

  it("meja hkratnih velja tudi za razporejevalnik: tretja caka, po porocilu ene se zazene", async () => {
    const e = await okolje("meja");
    const a = (await e.ukaz({ ukaz: "dodeli", agent: "claude", mapa: e.projekt, besedilo: "A.", pogoj: "zdaj" })).naloge[0]!;
    await e.ukaz({ ukaz: "dodeli", agent: "pi", mapa: e.projekt, besedilo: "B.", pogoj: "zdaj" });
    const c = (await e.ukaz({ ukaz: "dodeli", agent: "agy", mapa: e.projekt, besedilo: "C.", pogoj: "zdaj" })).naloge[0]!;
    assert.equal(c.stanje, "dodeljeno");
    assert.equal(e.klici.length, 2);
    porocilo(e.projekt, a.id, new Date(T0.getTime() + MIN));
    // PID terminala je lazen (ne zivi): porocilo sprosti mesto
    await korakRazporejevalnika(e.podatki, e.o, new Date(T0.getTime() + 2 * MIN));
    assert.equal(e.klici.length, 3);
    assert.equal((await stanjeClaudeNalog(e.token, e.podatki, e.o, T0)).naloge.find((n) => n.id === c.id)!.stanje, "tece");
  });

  it("naloga, ki je cakala na mesto pred zagonom Line, se ob zagonu NE zazene sama (zamujeno, potrdi)", async () => {
    const e = await okolje("meja-ponovni-zagon");
    const a = (await e.ukaz({ ukaz: "dodeli", agent: "claude", mapa: e.projekt, besedilo: "A.", pogoj: "zdaj" })).naloge[0]!;
    await e.ukaz({ ukaz: "dodeli", agent: "pi", mapa: e.projekt, besedilo: "B.", pogoj: "zdaj" });
    const c = (await e.ukaz({ ukaz: "dodeli", agent: "agy", mapa: e.projekt, besedilo: "C.", pogoj: "zdaj" })).naloge[0]!;
    assert.equal(c.stanje, "dodeljeno");
    porocilo(e.projekt, a.id, new Date(T0.getTime() + MIN));
    const pozneje = { ...e.o, zagonLine: new Date(T0.getTime() + 60 * MIN) };
    await korakRazporejevalnika(e.podatki, pozneje, new Date(T0.getTime() + 61 * MIN));
    assert.equal(e.klici.length, 2);
    assert.equal((await stanjeClaudeNalog(e.token, e.podatki, pozneje, T0)).naloge.find((n) => n.id === c.id)!.stanje, "zamujeno");
  });

  it("porocilo ne sprosti mesta, dokler proces terminala zivi (N5); dogodek konca pride vseeno enkrat", async () => {
    const e = await okolje("meja-zivi");
    e.o.zazeni = async (program, args, cwd) => {
      e.klici.push({ program, args, cwd });
      return process.pid; // zivi proces
    };
    const dogodki: DogodekNalogaKoncana[] = [];
    const odjavi = obNalogaKoncana((d) => dogodki.push(d));
    try {
      // locene mape: A1 (pregled RAC-A) dveh nalog v isti mapi ne zazene hkrati
      const [mA, mB, mC] = ["a", "b", "c"].map((x) => { const m = path.join(e.projekt, "..", `meja-zivi-${x}`); mkdirSync(m, { recursive: true }); return path.resolve(m); });
      const a = (await e.ukaz({ ukaz: "dodeli", agent: "claude", mapa: mA, besedilo: "A.", pogoj: "zdaj" })).naloge[0]!;
      await e.ukaz({ ukaz: "dodeli", agent: "pi", mapa: mB, besedilo: "B.", pogoj: "zdaj" });
      const c = (await e.ukaz({ ukaz: "dodeli", agent: "agy", mapa: mC, besedilo: "C.", pogoj: "zdaj" })).naloge[0]!;
      porocilo(mA!, a.id, new Date(T0.getTime() + MIN));
      await korakRazporejevalnika(e.podatki, e.o, new Date(T0.getTime() + 2 * MIN));
      await korakRazporejevalnika(e.podatki, e.o, new Date(T0.getTime() + 3 * MIN));
      assert.equal(e.klici.length, 2);
      assert.equal((await stanjeClaudeNalog(e.token, e.podatki, e.o, T0)).naloge.find((n) => n.id === c.id)!.stanje, "dodeljeno");
      // A2 (pregled RAC-A): dokler terminal zivi, naloga ni koncana - dogodka »naloga koncana« se ni
      assert.deepEqual(dogodki.map((d) => d.id), []);
    } finally {
      odjavi();
    }
  });

  it("opomnik brez znanega PID (terminal preda okno) ne trdi, da je terminal zaprt", async () => {
    const e = await okolje("opomnik-brez-pid");
    e.o.zazeni = async (program, args, cwd) => {
      e.klici.push({ program, args, cwd });
    };
    const z = (await e.ukaz({ ukaz: "dodeli", agent: "pi", mapa: e.projekt, besedilo: "x", pogoj: "zdaj" })).naloge[0]!;
    await korakRazporejevalnika(e.podatki, e.o, new Date(Date.parse(z.opomnik!.cas) + 1000));
    assert.equal((await stanjeClaudeNalog(e.token, e.podatki, e.o, T0)).naloge[0]!.opomnik!.razlog, "brez-porocila");
  });

  it("razporejevalnik tece: zagon Line (zagon.server.ts) zazene casovnik", () => {
    const vir = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "zagon.server.ts"), "utf8");
    assert.match(vir, /^import \{ zazeniRazporejevalnik \} from "\.\/claude-naloge\.server\.ts";$/m);
    assert.match(vir, /^\s+zazeniRazporejevalnik\(dir\);$/m);
  });

  it("sprememba besedila, mape ali agenta po dodelitvi = brez zagona (zgostitev se ob zagonu preveri)", async () => {
    const e = await okolje("zgostitev");
    const ura = new Date(T0.getTime() + 10 * MIN).toISOString();
    await e.ukaz({ ukaz: "dodeli", agent: "pi", mapa: e.projekt, besedilo: "Prava naloga.", pogoj: `ura:${ura}` });
    const dat = path.join(e.podatki, DATOTEKA_STANJA);
    const st = JSON.parse(readFileSync(dat, "utf8"));
    st.naloge[0].agent = "grok";
    writeFileSync(dat, JSON.stringify(st), { mode: 0o600 });
    await korakRazporejevalnika(e.podatki, e.o, new Date(T0.getTime() + 11 * MIN));
    const z = (await stanjeClaudeNalog(e.token, e.podatki, e.o, T0)).naloge[0]!;
    assert.equal(z.stanje, "napaka");
    assert.equal(z.razlog, "zgostitev");
    assert.equal(e.klici.length, 0);
  });

  it("preklic: dodeljena naloga se ne zazene; preklic koncane ni mogoc", async () => {
    const e = await okolje("preklic");
    const ura = new Date(T0.getTime() + 10 * MIN).toISOString();
    const z = (await e.ukaz({ ukaz: "dodeli", agent: "pi", mapa: e.projekt, besedilo: "x", pogoj: `ura:${ura}` })).naloge[0]!;
    assert.equal((await e.ukaz({ ukaz: "preklici", id: z.id })).naloge[0]!.stanje, "preklicano");
    await korakRazporejevalnika(e.podatki, e.o, new Date(T0.getTime() + 11 * MIN));
    assert.equal(e.klici.length, 0);
    await assert.rejects(e.ukaz({ ukaz: "preklici", id: z.id }), { razlog: "ni-najdeno" });
  });

  it("izklopljen, nepreverjen, neprijavljen ali agent brez zacetnega poziva se ne ponudi; dodelitev brez gesla zavrnjena", async () => {
    const e = await okolje("stikala", preverba({ neprijavljen: true, pokvarjen: ["agy"] }));
    await e.ukaz({ ukaz: "agenti", agenti: { pi: false } });
    const s = await stanjeClaudeNalog(e.token, e.podatki, e.o, T0);
    assert.equal(s.agenti.find((a) => a.id === "pi")!.vklopljen, false);
    assert.equal(s.agenti.find((a) => a.id === "claude")!.vklopljen, true, "privzeto vklopljeno");
    const d = (agent: string) => e.ukaz({ ukaz: "dodeli", agent, mapa: e.projekt, besedilo: "x", pogoj: "zdaj" });
    await assert.rejects(d("pi"), { razlog: "agent-izklopljen" });
    await assert.rejects(d("agy"), { razlog: "agent-ni-pripravljen" });
    await assert.rejects(d("grok"), { razlog: "agent-ni-pripravljen" });
    await assert.rejects(d("kimi"), { razlog: "agent-brez-poziva" });
    await assert.rejects(d("freebuff"), { razlog: "agent" });
    assert.equal(e.klici.length, 0);

    const brez = path.join(KOREN, "brez-gesla");
    mkdirSync(brez, { recursive: true });
    const { odpriLokalnoSejo } = await import("./auth.server.ts");
    const t = await odpriLokalnoSejo({ address: "127.0.0.1", forwardedFor: null, forwarded: null, host: "localhost:3000", origin: null, fetchSite: null }, brez);
    assert.ok(t);
    await assert.rejects(ukazClaudeNalog(t, { ukaz: "dodeli", agent: "claude", mapa: e.projekt, besedilo: "x", pogoj: "zdaj" }, brez, e.o, T0), { razlog: "geslo" });
    await assert.rejects(ukazClaudeNalog(t, { ukaz: "prepovedane", mape: [] }, brez, e.o, T0), { razlog: "geslo" });
  });

  it("pogoj: zdaj, ura v prihodnosti (najvec 7 dni), po <id>; vse drugo zavrnjeno", () => {
    assert.deepEqual(razberiPogoj("zdaj", T0), { vrsta: "zdaj" });
    const ura = new Date(T0.getTime() + 60 * MIN).toISOString();
    assert.deepEqual(razberiPogoj(`ura:${ura}`, T0), { vrsta: "ura", cas: ura });
    assert.deepEqual(razberiPogoj("po:0123456789abcdef", T0), { vrsta: "po", id: "0123456789abcdef" });
    assert.equal(razberiPogoj(`ura:${new Date(T0.getTime() - 10 * MIN).toISOString()}`, T0), null);
    assert.equal(razberiPogoj(`ura:${new Date(T0.getTime() + 8 * 24 * 60 * MIN).toISOString()}`, T0), null);
    assert.equal(razberiPogoj("po:../x", T0), null);
    assert.equal(razberiPogoj("kdaj", T0), null);
    assert.equal(razberiPogoj(42, T0), null);
  });

  it("razpored je cista funkcija stanja in casa", () => {
    const z = (id: string, x: Partial<ZapisNaloge>): ZapisNaloge => ({ id, izvor: "lastnik", mapa: "/m", besedilo: "b", zgostitev: "", stanje: "dodeljeno", ustvarjeno: T0.toISOString(), potrjeno: null, razlog: null, ...x });
    const ura = (m: number) => ({ vrsta: "ura" as const, cas: new Date(T0.getTime() + m * MIN).toISOString() });
    const r = razpored([
      z("a000000000000001", { pogoj: { vrsta: "zdaj" } }),
      z("a000000000000002", { pogoj: ura(-1) }),
      z("a000000000000003", { pogoj: ura(-30) }),
      z("a000000000000004", { pogoj: ura(5) }),
      z("a000000000000005", { pogoj: { vrsta: "po", id: "a000000000000009" } }),
      z("a000000000000006", { pogoj: ura(-1), stanje: "preklicano" }),
    ], T0, ZAGON);
    assert.deepEqual(r, { zazeni: ["a000000000000001", "a000000000000002"], zamujeno: ["a000000000000003"], neuspelo: ["a000000000000005"] });
  });
});

describe("ocena trajanja, lasten opomnik in dogodek »naloga koncana«", { concurrency: 1 }, () => {
  const zg = (agent: "claude" | "pi", minut: number, znakov: number): ZapisNaloge => ({
    id: "b".repeat(16), izvor: "lastnik", agent, mapa: "/m", besedilo: "x".repeat(znakov), zgostitev: "", stanje: "koncano",
    ustvarjeno: T0.toISOString(), potrjeno: T0.toISOString(), koncano: new Date(T0.getTime() + minut * MIN).toISOString(), razlog: null,
  });

  it("brez zgodovine privzeto in »groba ocena«; iz zgodovine istega agenta mediana podobne velikosti", () => {
    assert.deepEqual(ocenaTrajanja([], "claude", 100), { ms: PRIVZETO_TRAJANJE_MS, groba: true, vzorcev: 0 });
    const z = [zg("claude", 10, 100), zg("claude", 20, 120), zg("claude", 40, 90), zg("claude", 300, 5000), zg("pi", 1, 100)];
    assert.deepEqual(ocenaTrajanja(z, "claude", 100), { ms: 20 * MIN, groba: false, vzorcev: 3 });
    assert.deepEqual(ocenaTrajanja(z, "pi", 100), { ms: 1 * MIN, groba: true, vzorcev: 1 });
  });

  it("opomnik ob oceni: brez porocila nov opomnik z novo uro in razlogom; porocilo = koncano, dogodek natanko enkrat", async () => {
    const e = await okolje("opomnik");
    const dogodki: DogodekNalogaKoncana[] = [];
    const odjavi = obNalogaKoncana((d) => dogodki.push(d));
    try {
      const z = (await e.ukaz({ ukaz: "dodeli", agent: "pi", mapa: e.projekt, besedilo: "Dolga naloga.", pogoj: "zdaj" })).naloge[0]!;
      const prvi = Date.parse(z.opomnik!.cas);
      await korakRazporejevalnika(e.podatki, e.o, new Date(prvi + 1000));
      const z1 = (await stanjeClaudeNalog(e.token, e.podatki, e.o, T0)).naloge[0]!;
      assert.equal(z1.stanje, "tece");
      assert.equal(z1.opomnik!.krog, 1);
      assert.ok(Date.parse(z1.opomnik!.cas) > prvi + 1000);
      assert.equal(z1.opomnik!.razlog, "terminal-zaprt");
      porocilo(e.projekt, z.id, new Date(prvi + 2 * MIN));
      await korakRazporejevalnika(e.podatki, e.o, new Date(prvi + 3 * MIN));
      await korakRazporejevalnika(e.podatki, e.o, new Date(prvi + 4 * MIN));
      const z2 = (await stanjeClaudeNalog(e.token, e.podatki, e.o, T0)).naloge[0]!;
      assert.equal(z2.stanje, "koncano");
      // A2 (pregled RAC-A): cas konca je cas, ko ga je razporejevalnik opazil, ne mtime porocila
      assert.equal(z2.koncano, new Date(prvi + 3 * MIN).toISOString());
      assert.deepEqual(dogodki, [{ id: z.id, agent: "pi", mapa: e.projekt, kopija: null }]);
    } finally {
      odjavi();
    }
  });
});

describe("oznaka [[agent-naloga: ...]] v pogovoru", { concurrency: 1 }, () => {
  it("izluci agenta, mapo, pogoj in besedilo; oznaka se vedno odstrani", () => {
    const r = izluciPredloge("V redu. [[agent-naloga: opencode | /home/a/p | 10:30 | Preglej README.]]");
    assert.equal(r.besedilo, "V redu.");
    assert.deepEqual(r.predlogi, [{ agent: "opencode", mapa: "/home/a/p", pogoj: "10:30", naloga: "Preglej README." }]);
  });

  it("Lina samo PREDLAGA: nastane »caka« z agentom in pogojem; nic se ne zazene, dokler lastnik ne potrdi", async () => {
    const e = await okolje("oznaka");
    const odgovor = await obdelajClaudeCode(e.podatki, `Pripravila sem. [[agent-naloga: pi | ${e.projekt} | zdaj | Dodaj preizkus.]]`, true, e.o);
    assert.ok(!odgovor.includes("[[agent-naloga"));
    // predlog nastane s pravim casom (pogovor), zato tudi branje s pravim casom (sicer bi bil »potekel« glede na T0)
    const s = await stanjeClaudeNalog(e.token, e.podatki, e.o, new Date());
    const z = s.naloge[0]!;
    assert.equal(z.stanje, "caka");
    assert.equal(z.izvor, "lina");
    assert.equal(z.agent, "pi");
    assert.equal(e.klici.length, 0);
    await e.ukaz({ ukaz: "potrdi", id: z.id, zgostitev: z.zgostitev }, new Date());
    assert.equal(e.klici.length, 1);
    assert.deepEqual(e.klici[0]!.args.slice(1), ["/usr/bin/pi", pozivZaClaude(z.id)]);
  });

  it("oznaka iz zgodovine, povzetka ali spomina se nevtralizira (ne more ustvariti predloga)", () => {
    assert.equal(brezOznak("x [[agent-naloga: pi | /a | zdaj | y]]"), "x [agent-naloga: pi | /a | zdaj | y]]");
    assert.equal(brezOznak("[[ Agent-Naloga :"), "[agent-naloga:");
  });
});
