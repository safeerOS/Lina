/** A4 (peskovnik): agenti z omejenimi mapami (agy, opencode) tecejo samo v bubblewrap; brez delujocega bwrap se ne zazenejo (fail-closed). */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { potrdiOpozorilo } from "./opozorilo.server.ts";
import { AGENTI } from "./claude-naloge.ts";
import { stanjeClaudeNalog, ukazClaudeNalog, type Odvisnosti, type PreverbaZagona } from "./claude-naloge.server.ts";

const BWRAP = "/usr/bin/bwrap";
const T0 = new Date("2026-11-24T08:00:00.000Z");
// Ne pod /tmp: peskovnik prekrije /tmp, zato bi prepovedana mapa tam izginila tudi brez --tmpfs nad njo (prazen preizkus).
const KOREN = mkdtempSync(path.join(homedir(), "lina-peskovnik-"));
assert.ok(!KOREN.startsWith("/tmp/"), "preizkus mora teci zunaj /tmp (HOME=<mapa naloge>/home)");

const preverba: PreverbaZagona = async () => ({ koda: 0, izpis: "1.0.0", potekel: false });

async function okolje(ime: string, programi: string[] = ["xterm", "bwrap", ...AGENTI], preveri: PreverbaZagona = (p, a, r) => preverba(p, a, r)) {
  // svoja funkcija preverbe na okolje: predpomnilnik zaznave je vezan nanjo
  const dom = path.join(KOREN, ime, "dom");
  const podatki = path.join(KOREN, ime, "podatki");
  const projekt = path.join(dom, "projekt");
  mkdirSync(projekt, { recursive: true });
  mkdirSync(podatki, { recursive: true });
  const token = await setupOwner("geslo-test-1234", podatki);
  await potrdiOpozorilo(podatki);
  const klici: { cwd: string; args: readonly string[] }[] = [];
  const o: Odvisnosti = {
    dom, platforma: "linux", zagonLine: new Date("2026-11-24T07:00:00.000Z"),
    najdi: (x) => (programi.includes(x) ? (x === "bwrap" ? BWRAP : `/usr/bin/${x}`) : null),
    preveriZagon: preveri,
    zazeni: async (_p, args, cwd) => { klici.push({ cwd, args }); return 4_000_000 + klici.length; },
    casZagona: () => "1",
  };
  const ukaz = (u: Record<string, unknown>) => ukazClaudeNalog(token, u, podatki, o, T0);
  return { dom, projekt, podatki, klici, o, ukaz, token };
}

/** Ukaz agenta iz zajetega zagona (brez predpone terminala »-e«), z `ukaz` namesto programa agenta - zares izveden. */
function vPeskovniku(args: readonly string[], program: string, ukaz: string[]) {
  const i = args.indexOf(program);
  assert.ok(i > 0, "program agenta je v ukazu");
  const [p, ...a] = [...args.slice(1, i), ...ukaz];
  return spawnSync(p as string, a, { encoding: "utf8", timeout: 20_000 });
}

it("A4: opencode tece v bwrap - prepovedane mape ne vidi (tudi prek povezave), bere ostalo, pise samo v projekt", async () => {
  const e = await okolje("pravi");
  const scit = path.join(e.dom, "scit");
  mkdirSync(scit, { recursive: true });
  writeFileSync(path.join(scit, "skrivnost.txt"), "SKRIVNO");
  writeFileSync(path.join(e.dom, "odprto.txt"), "ODPRTO");
  const kljuc = path.join(e.dom, "kljuc.txt"); // prepovedana DATOTEKA (ne mapa)
  writeFileSync(kljuc, "KLJUC");
  const nastavitve = path.join(e.dom, ".config", "opencode");
  mkdirSync(nastavitve, { recursive: true });
  mkdirSync(path.join(e.dom, ".config", "drugo"));
  await e.ukaz({ ukaz: "prepovedane", mape: [scit, kljuc] });
  await e.ukaz({ ukaz: "dodeli", agent: "opencode", mapa: e.projekt, besedilo: "Preglej kodo.", pogoj: "zdaj" });
  const k = e.klici.find((x) => x.cwd === e.projekt);
  assert.ok(k, "opencode zagnan");

  const cat = vPeskovniku(k.args, "/usr/bin/opencode", ["/bin/cat", path.join(scit, "skrivnost.txt")]);
  assert.notEqual(cat.status, 0, `cat prepovedane datoteke mora pasti: ${cat.stdout}${cat.stderr}`);
  assert.ok(!cat.stdout.includes("SKRIVNO"));
  assert.equal(k.args[1], BWRAP, "agent z omejenimi mapami se zazene v bwrap");
  // kontrola: ista ovojnica bere datoteko zunaj prepovedane mape (dokaz, da ni skrito vse)
  const odprto = vPeskovniku(k.args, "/usr/bin/opencode", ["/bin/cat", path.join(e.dom, "odprto.txt")]);
  assert.equal(odprto.stdout, "ODPRTO", odprto.stderr);
  // pisanje: v projekt da, drugam ne
  const v = vPeskovniku(k.args, "/usr/bin/opencode", ["/bin/sh", "-c", `echo x > '${path.join(e.projekt, "f.txt")}'`]);
  assert.equal(v.status, 0, v.stderr);
  assert.equal(readFileSync(path.join(e.projekt, "f.txt"), "utf8"), "x\n");
  const zunaj = path.join(e.dom, "g.txt");
  assert.notEqual(vPeskovniku(k.args, "/usr/bin/opencode", ["/bin/sh", "-c", `echo x > '${zunaj}'`]).status, 0);
  assert.equal(existsSync(zunaj), false);
  // prepovedana datoteka je prazna
  const k2 = vPeskovniku(k.args, "/usr/bin/opencode", ["/bin/cat", kljuc]);
  assert.ok(!k2.stdout.includes("KLJUC"), k2.stdout);
  // N10 (vodja 24. 11., popravki-1605): mapa nastavitev agenta je zapisljiva (prijava, zgodovina), sosednja ne
  assert.equal(vPeskovniku(k.args, "/usr/bin/opencode", ["/bin/sh", "-c", `echo n > '${path.join(nastavitve, "n.txt")}'`]).status, 0);
  assert.equal(existsSync(path.join(nastavitve, "n.txt")), true);
  assert.notEqual(vPeskovniku(k.args, "/usr/bin/opencode", ["/bin/sh", "-c", `echo n > '${path.join(e.dom, ".config", "drugo", "n.txt")}'`]).status, 0);
  // povezava v prepovedano, ki jo agent naredi sam med delom (po pregledu povezav), ne pomaga
  const pov = vPeskovniku(k.args, "/usr/bin/opencode", ["/bin/sh", "-c", `ln -s '${scit}' pov && cat pov/skrivnost.txt`]);
  assert.notEqual(pov.status, 0);
  assert.ok(!pov.stdout.includes("SKRIVNO"));
  // vticnice pod /run (vodilo seje: systemd-run --user, gdbus; docker.sock = root) niso dosegljive; kontrola: na gostitelju obstajajo
  const uid = process.getuid?.() ?? 0;
  for (const v of [`/run/user/${uid}/bus`, "/run/docker.sock", "/var/run/docker.sock"]) {
    const r = vPeskovniku(k.args, "/usr/bin/opencode", ["/bin/sh", "-c", `test -e '${v}' && echo IMA || echo NIMA`]);
    assert.equal(r.stdout.trim(), "NIMA", `${v} (na gostitelju: ${existsSync(v) ? "obstaja" : "ne obstaja"})`);
  }
  assert.ok(existsSync(`/run/user/${uid}/bus`), "kontrola: vodilo seje na gostitelju obstaja (sicer je preverba zgoraj prazna)");
  // DNS ostane (resolv.conf kaze pod /run na systemd-resolved)
  const dns = vPeskovniku(k.args, "/usr/bin/opencode", ["/bin/sh", "-c", "test -r /etc/resolv.conf && echo IMA || echo NIMA"]);
  assert.equal(dns.stdout.trim(), "IMA");
});

it("A4: brez seznama prepovedanih je agent z omejenimi mapami se vedno v bwrap; claude in pi nista", async () => {
  const e = await okolje("prazno");
  const drug = path.join(e.dom, "drug");
  mkdirSync(drug);
  await e.ukaz({ ukaz: "dodeli", agent: "agy", mapa: e.projekt, besedilo: "Preglej kodo.", pogoj: "zdaj" });
  await e.ukaz({ ukaz: "dodeli", agent: "pi", mapa: drug, besedilo: "Preglej kodo.", pogoj: "zdaj" });
  const agy = e.klici.find((x) => x.cwd === e.projekt)!;
  const pi = e.klici.find((x) => x.cwd === drug)!;
  assert.equal(agy.args[1], BWRAP);
  assert.ok(!pi.args.includes(BWRAP), "pi brez peskovnika (ni na seznamu omejenih)");
});

it("A4: bwrap manjka ali ne deluje (preverba ob zaznavi) - agy/opencode nista na voljo, razlog »peskovnik«", async () => {
  const brez = await okolje("brez", ["xterm", ...AGENTI]);
  let s = await stanjeClaudeNalog(brez.token, brez.podatki, brez.o, T0);
  assert.equal(s.agenti.find((a) => a.id === "opencode")?.stanje, "brez-peskovnika");
  assert.equal(s.agenti.find((a) => a.id === "agy")?.stanje, "brez-peskovnika");
  assert.equal(s.agenti.find((a) => a.id === "pi")?.stanje, "pripravljen");
  await assert.rejects(brez.ukaz({ ukaz: "dodeli", agent: "opencode", mapa: brez.projekt, besedilo: "Preglej kodo.", pogoj: "zdaj" }), { razlog: "peskovnik" });
  assert.equal(brez.klici.length, 0);

  const klici: string[] = [];
  const pokvarjen = await okolje("pokvarjen", undefined, async (p, args) => {
    klici.push(path.basename(p));
    return { koda: p === BWRAP ? 1 : 0, izpis: "bwrap: No permissions to creating new namespace", potekel: false };
  });
  s = await stanjeClaudeNalog(pokvarjen.token, pokvarjen.podatki, pokvarjen.o, T0);
  assert.equal(s.agenti.find((a) => a.id === "agy")?.stanje, "brez-peskovnika");
  assert.ok(!klici.includes("agy") && !klici.includes("opencode"), "agent brez peskovnika se ne zaganja niti za --version");
  await assert.rejects(pokvarjen.ukaz({ ukaz: "dodeli", agent: "agy", mapa: pokvarjen.projekt, besedilo: "Preglej kodo.", pogoj: "zdaj" }), { razlog: "peskovnik" });
});

it("A4: na Windows agent z omejenimi mapami ni na voljo (ni peskovnika)", async () => {
  const e = await okolje("windows");
  e.o.platforma = "win32";
  const s = await stanjeClaudeNalog(e.token, e.podatki, e.o, T0);
  assert.equal(s.agenti.find((a) => a.id === "opencode")?.stanje, "brez-peskovnika");
  assert.equal(s.agenti.find((a) => a.id === "agy")?.stanje, "brez-peskovnika");
});

it("A4: resnicna preverba bwrap ob zaznavi uspe na tem racunalniku", async () => {
  const e = await okolje("resnicna");
  const { privzetaPreverba } = await import("./claude-naloge.server.ts");
  // zares samo preverba peskovnika (/bin/sh -c :); --version agenta tece od N10 tudi v bwrap, a program agenta je tu nadomestek
  e.o.preveriZagon = async (p, args, rok) => (p === BWRAP && args.at(-1) === ":" ? privzetaPreverba(p, args, rok) : preverba(p, args, rok));
  const s = await stanjeClaudeNalog(e.token, e.podatki, e.o, T0);
  assert.equal(s.agenti.find((a) => a.id === "opencode")?.stanje, "pripravljen");
});
