/**
 * Lina odpre Claude Code z nalogo (lastnik 23. 11. 2026). Preizkusi brez pravega terminala ali Claude Code: zagon je nadomestek,
 * ki samo zapise klic. Vsako varovalo (seja lastnika, geslo, zgostitev, enkratnost, meja hkratnih, pot, simbolne povezave,
 * Windows, porocilo brez sledenja povezavi, locitev od poti klica) ima preizkus, ki brez varovala pade.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, closeSync, constants, linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { odpriLokalnoSejo, setupOwner } from "./auth.server.ts";
import { PREPOVEDANA_OPRAVILA, VRSTE_OPRAVIL } from "./avtonomija.ts";
import {
  CAKA_MS,
  DATOTEKA_NALOGE,
  DATOTEKA_POROCILA,
  MAPA_NALOG,
  NAJVEC_CAKAJOCIH,
  NAJVEC_HKRATNIH,
  NAJVEC_ZNAKOV_NALOGE,
  izluciPredloge,
  ocistiBesediloNaloge,
  pozivZaClaude,
  preveriMapo,
  vsebinaNaloge,
} from "./claude-naloge.ts";
import { okoljeZaAgenta, predlagajClaudeNalogo, stanjeClaudeNalog, ukazClaudeNalog, type Odvisnosti } from "./claude-naloge.server.ts";
import { obdelajClaudeCode } from "./asistent-pogovor.server.ts";
import { ukazTerminala } from "./platforma.server.ts";
import { potrdiOpozorilo } from "./opozorilo.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-claude-naloge-"));
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const NALOGA = "Popravi preizkus v src/a.test.ts; merilo konca: npm test zelen. $(rm -rf ~) `sudo reboot`";

type Klic = { program: string; args: readonly string[]; cwd: string; okolje: NodeJS.ProcessEnv };

async function okolje(ime: string, platforma: NodeJS.Platform = "linux") {
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
    platforma,
    najdi: (p) => (p === "x-terminal-emulator" || p === "claude" ? `/usr/bin/${p}` : null),
    // x-terminal-emulator kaze na xterm (N7: brez tega se ne uporabi)
    razresi: (p) => (p.endsWith("/x-terminal-emulator") ? "/usr/bin/xterm" : p),
    // preverba zagona agenta (24. 11. 2026) je nadomestek: lazni /usr/bin/claude se ne zazene
    preveriZagon: async () => ({ koda: 0, izpis: "2.1.331 (Claude Code)", potekel: false }),
    zazeni: async (program, args, cwd, okolje) => {
      klici.push({ program, args, cwd, okolje });
    },
  };
  return { osnova, dom, podatki, projekt, token, klici, o };
}

/** Sosednja projektna mapa: A1 (pregled RAC-A) ne zazene dveh nalog v isti mapi, preizkusi meje hkratnih zato uporabijo locene mape. */
let stevecMap = 0;
function svezaMapa(e: { dom: string }): string {
  const m = path.join(e.dom, `projekt-${++stevecMap}`);
  mkdirSync(m, { recursive: true });
  return m;
}

async function pripravi(e: Awaited<ReturnType<typeof okolje>>, mapa = e.projekt, besedilo = NALOGA, zdaj = new Date()) {
  const s = await ukazClaudeNalog(e.token, { ukaz: "pripravi", mapa, besedilo }, e.podatki, e.o, zdaj);
  return s.naloge[0]!;
}

describe("claude-naloge: cista logika", () => {
  it("preveriMapo: samo obstojeca podmapa doma ali dovoljene mape, brez .., skritih delov in podatkov Line", () => {
    const meje = { dom: "/home/a", podatki: "/home/a/.local/share/lina", dovoljene: ["/srv/delo"] };
    assert.deepEqual(preveriMapo("/home/a/projekt", meje), { mapa: "/home/a/projekt" });
    assert.deepEqual(preveriMapo("/srv/delo/x", meje), { mapa: "/srv/delo/x" });
    assert.deepEqual(preveriMapo("projekt", meje), { razlog: "mapa" });
    assert.deepEqual(preveriMapo("/home/a/projekt/../../b", meje), { razlog: "mapa" });
    assert.deepEqual(preveriMapo("/home/a", meje), { razlog: "mapa-zunaj" });
    assert.deepEqual(preveriMapo("/home/b/x", meje), { razlog: "mapa-zunaj" });
    assert.deepEqual(preveriMapo("/srv/delo", meje), { razlog: "mapa-zunaj" });
    assert.deepEqual(preveriMapo("/home/a/.ssh", meje), { razlog: "mapa-skrita" });
    assert.deepEqual(preveriMapo("/home/a/x/.claude/y", meje), { razlog: "mapa-skrita" });
    assert.deepEqual(preveriMapo("/home/a/projekt", { ...meje, podatki: "/home/a/projekt/lina" }), { razlog: "mapa-podatki" });
    assert.deepEqual(preveriMapo("/home/a/projekt/lina/x", { ...meje, podatki: "/home/a/projekt/lina" }), { razlog: "mapa-podatki" });
    assert.deepEqual(preveriMapo("/home/a/pro\njekt", meje), { razlog: "mapa" });
    assert.deepEqual(preveriMapo(42, meje), { razlog: "mapa" });
  });

  it("besedilo naloge: brez kontrolnih in smernih znakov, brez osamljenih nadomestnih, z mejo (ne reze tiho)", () => {
    // A7 (pregled RAC-A): nevidni in kontrolni znaki se ne rezejo tiho, besedilo se zavrne
    assert.equal(ocistiBesediloNaloge("  a\u202eb\u0007c\r\nd  "), null);
    assert.equal(ocistiBesediloNaloge("  ab\tc\r\nd  "), "ab\tc\nd");
    assert.equal(ocistiBesediloNaloge("   "), null);
    assert.equal(ocistiBesediloNaloge("x".repeat(NAJVEC_ZNAKOV_NALOGE + 1)), null);
    assert.equal(ocistiBesediloNaloge("a\ud800b"), null);
    assert.equal(ocistiBesediloNaloge(5), null);
  });

  it("poziv za Claude Code je stalen in vsebuje samo id; pravila so v NALOGA.md", () => {
    const id = "0123456789abcdef";
    const poziv = pozivZaClaude(id);
    assert.match(poziv, /^Preberi datoteko \.lina-naloge\/0123456789abcdef\/NALOGA\.md/);
    assert.throws(() => pozivZaClaude("../x"));
    const v = vsebinaNaloge({ id, izvor: "lina", besedilo: NALOGA }, new Date(0));
    assert.ok(v.includes(NALOGA));
    assert.match(v, /Brez sudo, brez brisanja/);
    assert.match(v, /POROCILO\.md/);
  });

  it("oznaka [[claude-code: mapa | naloga]] se izlusci in odstrani; najvec en predlog", () => {
    const r = izluciPredloge("Pripravila sem. [[claude-code: /home/a/p | popravi test]] [[claude-code: /home/a/q | drugo]]");
    assert.equal(r.besedilo, "Pripravila sem.");
    assert.deepEqual(r.predlogi, [{ mapa: "/home/a/p", naloga: "popravi test" }]);
    assert.deepEqual(izluciPredloge("brez").predlogi, []);
  });

  it("terminal: Windows jasno »ni na voljo«, Linux prvi najdeni, brez terminala razlog", () => {
    const vse = (p: string) => `/bin/${p}`;
    assert.deepEqual(ukazTerminala(vse, "win32"), { razlog: "ni-na-voljo" });
    assert.deepEqual(ukazTerminala(vse, "linux", () => "/usr/bin/xterm"), { program: "/bin/x-terminal-emulator", predpona: ["-e"] });
    assert.deepEqual(ukazTerminala((p) => (p === "gnome-terminal" ? "/g" : null), "linux"), { program: "/g", predpona: ["--"] });
    assert.deepEqual(ukazTerminala(() => null, "linux"), { razlog: "ni-terminala" });
  });

  it("zagon Claude Code NI opravilo avtonomije (ni samodejnega nacina; »ukaz« ostane prepovedan)", () => {
    assert.ok(!VRSTE_OPRAVIL.some((v) => /claude|ukaz|terminal/.test(v)));
    assert.ok((PREPOVEDANA_OPRAVILA as readonly string[]).includes("ukaz"));
  });
});

describe("claude-naloge: streznik", { concurrency: 1 }, () => {
  it("brez seje lastnika ni ne branja ne ukaza", async () => {
    const e = await okolje("seja");
    await assert.rejects(stanjeClaudeNalog(null, e.podatki, e.o));
    await assert.rejects(ukazClaudeNalog("napacen", { ukaz: "pripravi", mapa: e.projekt, besedilo: "x" }, e.podatki, e.o));
    assert.equal(e.klici.length, 0);
  });

  it("brez gesla (lokalna seja) sta priprava in zagon zavrnjena", async () => {
    const podatki = path.join(KOREN, "brez-gesla");
    mkdirSync(podatki, { recursive: true });
    const seja = await odpriLokalnoSejo({ address: "127.0.0.1", forwardedFor: null, forwarded: null, host: "localhost:3000", origin: null, fetchSite: null }, podatki);
    assert.ok(seja);
    const dom = path.join(podatki, "..", "brez-gesla-dom");
    mkdirSync(path.join(dom, "p"), { recursive: true });
    await assert.rejects(ukazClaudeNalog(seja, { ukaz: "pripravi", mapa: path.join(dom, "p"), besedilo: "x" }, podatki, { dom }), { razlog: "geslo" });
  });

  it("priprava nicesar ne zazene; potrditev z napacno zgostitvijo tudi ne", async () => {
    const e = await okolje("zgostitev");
    const n = await pripravi(e);
    assert.equal(n.stanje, "caka");
    assert.equal(n.besedilo, NALOGA);
    assert.equal(e.klici.length, 0);
    await assert.rejects(ukazClaudeNalog(e.token, { ukaz: "potrdi", id: n.id, zgostitev: "0".repeat(64) }, e.podatki, e.o), { razlog: "zgostitev" });
    await assert.rejects(ukazClaudeNalog(e.token, { ukaz: "potrdi", id: n.id }, e.podatki, e.o), { razlog: "zgostitev" });
    assert.equal(e.klici.length, 0);
    assert.ok(!existsSync(path.join(e.projekt, MAPA_NALOG)));
  });

  it("potrditev: NALOGA.md v novi mapi, terminal z argv brez besedila naloge, sudo ali --dangerously; enkratna", async () => {
    const e = await okolje("potrdi");
    const n = await pripravi(e);
    const s = await ukazClaudeNalog(e.token, { ukaz: "potrdi", id: n.id, zgostitev: n.zgostitev }, e.podatki, e.o);
    assert.equal(s.naloge[0]!.stanje, "tece");
    assert.equal(e.klici.length, 1);
    const k = e.klici[0]!;
    assert.equal(k.program, "/usr/bin/x-terminal-emulator");
    assert.deepEqual(k.args, ["-e", "/usr/bin/claude", pozivZaClaude(n.id)]);
    assert.equal(k.cwd, e.projekt);
    const vse = k.args.join(" ");
    assert.ok(!vse.includes("rm -rf") && !vse.includes("Popravi"), "besedilo naloge ne sme v ukazno vrstico");
    assert.ok(!/sudo|--dangerously/.test(vse));
    assert.ok(!Object.keys(k.okolje).some((x) => /^(TWILIO|LINA|NITRO)_/i.test(x)), "agent ne dobi skrivnosti Line");
    assert.equal(k.okolje.LINA_PODROBNI_POTEK, undefined);
    const datoteka = path.join(e.projekt, MAPA_NALOG, n.id, DATOTEKA_NALOGE);
    assert.ok(readFileSync(datoteka, "utf8").includes(NALOGA));
    assert.equal(statSync(datoteka).mode & 0o777, 0o600);
    await assert.rejects(ukazClaudeNalog(e.token, { ukaz: "potrdi", id: n.id, zgostitev: n.zgostitev }, e.podatki, e.o), { razlog: "ni-najdeno" });
    assert.equal(e.klici.length, 1);
  });

  it("obstojeca NALOGA.md se ne prepise (mapa naloge ze obstaja -> zavrnitev, brez zagona)", async () => {
    const e = await okolje("obstaja");
    const n = await pripravi(e);
    mkdirSync(path.join(e.projekt, MAPA_NALOG, n.id), { recursive: true });
    writeFileSync(path.join(e.projekt, MAPA_NALOG, n.id, DATOTEKA_NALOGE), "lastnikova");
    await assert.rejects(ukazClaudeNalog(e.token, { ukaz: "potrdi", id: n.id, zgostitev: n.zgostitev }, e.podatki, e.o), { razlog: "naloga-obstaja" });
    assert.equal(readFileSync(path.join(e.projekt, MAPA_NALOG, n.id, DATOTEKA_NALOGE), "utf8"), "lastnikova");
    assert.equal(e.klici.length, 0);
  });

  it("najvec NAJVEC_HKRATNIH hkrati; ko je porocilo, se mesto sprosti in porocilo se pokaze kot besedilo", async () => {
    const e = await okolje("hkratne");
    // znan PID, ki ne zivi (terminal zaprt): porocilo sprosti mesto (pri neznanem PID-u sele po roku, A2)
    e.o.zazeni = async (program, args, cwd, okolje) => {
      e.klici.push({ program, args, cwd, okolje });
      return 4_000_000 + e.klici.length;
    };
    const potrjene: { id: string; mapa: string }[] = [];
    for (let i = 0; i < NAJVEC_HKRATNIH; i++) {
      const n = await pripravi(e, svezaMapa(e));
      await ukazClaudeNalog(e.token, { ukaz: "potrdi", id: n.id, zgostitev: n.zgostitev }, e.podatki, e.o);
      potrjene.push(n);
    }
    const prevec = await pripravi(e, svezaMapa(e));
    await assert.rejects(ukazClaudeNalog(e.token, { ukaz: "potrdi", id: prevec.id, zgostitev: prevec.zgostitev }, e.podatki, e.o), { razlog: "polno-hkratne" });
    assert.equal(e.klici.length, NAJVEC_HKRATNIH);
    writeFileSync(path.join(potrjene[0]!.mapa, MAPA_NALOG, potrjene[0]!.id, DATOTEKA_POROCILA), "Narejeno.\u202e\u0007 Preizkusi zeleni.");
    const s = await ukazClaudeNalog(e.token, { ukaz: "potrdi", id: prevec.id, zgostitev: prevec.zgostitev }, e.podatki, e.o);
    assert.equal(e.klici.length, NAJVEC_HKRATNIH + 1);
    const koncana = s.naloge.find((n) => n.id === potrjene[0]!.id);
    assert.equal(koncana?.stanje, "koncano");
    assert.equal(koncana?.porocilo, "Narejeno. Preizkusi zeleni.");
  });

  it("porocilo, ki je simbolna povezava, se ne prebere", async () => {
    const e = await okolje("porocilo-povezava");
    const n = await pripravi(e);
    await ukazClaudeNalog(e.token, { ukaz: "potrdi", id: n.id, zgostitev: n.zgostitev }, e.podatki, e.o);
    const skrivnost = path.join(e.osnova, "skrivnost.txt");
    writeFileSync(skrivnost, "ZASEBNI-KLJUC");
    symlinkSync(skrivnost, path.join(e.projekt, MAPA_NALOG, n.id, DATOTEKA_POROCILA));
    const s = await stanjeClaudeNalog(e.token, e.podatki, e.o);
    assert.equal(s.naloge[0]!.porocilo, null);
    assert.equal(s.naloge[0]!.stanje, "tece");
  });

  it("simbolna povezava iz doma navzven: zavrnjena ob pripravi in ob zamenjavi mape pred potrditvijo", async () => {
    const e = await okolje("povezave");
    const zunaj = path.join(e.osnova, "zunaj");
    mkdirSync(zunaj);
    symlinkSync(zunaj, path.join(e.dom, "povezava"));
    await assert.rejects(ukazClaudeNalog(e.token, { ukaz: "pripravi", mapa: path.join(e.dom, "povezava"), besedilo: "x" }, e.podatki, e.o), { razlog: "mapa-zunaj" });
    const p2 = path.join(e.dom, "p2");
    mkdirSync(p2);
    const n = await pripravi(e, p2, "naloga");
    renameSync(p2, path.join(e.dom, "p2-stara"));
    symlinkSync(zunaj, p2);
    await assert.rejects(ukazClaudeNalog(e.token, { ukaz: "potrdi", id: n.id, zgostitev: n.zgostitev }, e.podatki, e.o), { razlog: "mapa-zunaj" });
    assert.equal(e.klici.length, 0);
    assert.deepEqual(readdirSync(zunaj), []);
  });

  it("mapa pod podatki Line, skrita mapa in neobstojeca mapa so zavrnjene", async () => {
    const e = await okolje("podatki");
    await assert.rejects(ukazClaudeNalog(e.token, { ukaz: "pripravi", mapa: path.join(e.dom, ".ssh"), besedilo: "x" }, e.podatki, e.o), { razlog: "mapa-skrita" });
    await assert.rejects(ukazClaudeNalog(e.token, { ukaz: "pripravi", mapa: path.join(e.dom, "ni"), besedilo: "x" }, e.podatki, e.o), { razlog: "mapa-ni" });
    const o = { ...e.o, dom: e.osnova };
    await assert.rejects(ukazClaudeNalog(e.token, { ukaz: "pripravi", mapa: e.podatki, besedilo: "x" }, e.podatki, o), { razlog: "mapa-podatki" });
  });

  it("predlog ugasne po CAKA_MS; najvec NAJVEC_CAKAJOCIH cakajocih", async () => {
    const e = await okolje("rok");
    const zdaj = new Date();
    const n = await pripravi(e, e.projekt, "x", zdaj);
    const pozneje = new Date(zdaj.getTime() + CAKA_MS + 1000);
    await assert.rejects(ukazClaudeNalog(e.token, { ukaz: "potrdi", id: n.id, zgostitev: n.zgostitev }, e.podatki, e.o, pozneje), { razlog: "poteklo" });
    assert.equal(e.klici.length, 0);
    for (let i = 0; i < NAJVEC_CAKAJOCIH; i++) await pripravi(e, e.projekt, `n${i}`, pozneje);
    await assert.rejects(ukazClaudeNalog(e.token, { ukaz: "pripravi", mapa: e.projekt, besedilo: "prevec" }, e.podatki, e.o, pozneje), { razlog: "polno-cakajoce" });
  });

  it("na Windows: jasno »ni na voljo«, nic se ne zazene", async () => {
    const e = await okolje("windows", "win32");
    const n = await pripravi(e);
    const s = await stanjeClaudeNalog(e.token, e.podatki, e.o);
    assert.equal(s.naVoljo, false);
    assert.equal(s.razlogNiNaVoljo, "ni-na-voljo");
    await assert.rejects(ukazClaudeNalog(e.token, { ukaz: "potrdi", id: n.id, zgostitev: n.zgostitev }, e.podatki, e.o), { razlog: "ni-na-voljo" });
    assert.equal(e.klici.length, 0);
  });

  it("brez ukaza claude ni zagona", async () => {
    const e = await okolje("brez-claude");
    const o = { ...e.o, najdi: (p: string) => (p === "xterm" ? "/usr/bin/xterm" : null) };
    const n = await pripravi(e);
    await assert.rejects(ukazClaudeNalog(e.token, { ukaz: "potrdi", id: n.id, zgostitev: n.zgostitev }, e.podatki, o), { razlog: "ni-claude" });
    assert.equal(e.klici.length, 0);
  });

  it("odklonjen predlog se ne more vec potrditi", async () => {
    const e = await okolje("odkloni");
    const n = await pripravi(e);
    await ukazClaudeNalog(e.token, { ukaz: "odkloni", id: n.id }, e.podatki, e.o);
    await assert.rejects(ukazClaudeNalog(e.token, { ukaz: "potrdi", id: n.id, zgostitev: n.zgostitev }, e.podatki, e.o), { razlog: "ni-najdeno" });
    assert.equal(e.klici.length, 0);
  });

  it("dovoljene mape: koren diska in mapa nad domom sta zavrnjena; podmapa velja", async () => {
    const e = await okolje("mape");
    await assert.rejects(ukazClaudeNalog(e.token, { ukaz: "mape", mape: ["/"] }, e.podatki, e.o), { razlog: "mapa" });
    await assert.rejects(ukazClaudeNalog(e.token, { ukaz: "mape", mape: [e.osnova] }, e.podatki, e.o), { razlog: "mapa" });
    const delo = path.join(KOREN, "mape-delo");
    mkdirSync(path.join(delo, "x"), { recursive: true });
    const s = await ukazClaudeNalog(e.token, { ukaz: "mape", mape: [delo] }, e.podatki, e.o);
    assert.deepEqual(s.mape, [delo]);
    const n = await pripravi(e, path.join(delo, "x"), "x");
    assert.equal(n.mapa, path.join(delo, "x"));
  });

  it("Lina (asistentka) samo predlaga: oznaka ustvari cakajoc predlog, nic se ne zazene; pri priponkah samo odstrani", async () => {
    const e = await okolje("lina");
    // Dom je v zacasni mapi preizkusa (nikoli pravi $HOME lastnika).
    const dom = e.dom;
    const projekt = mkdtempSync(path.join(dom, "lina-claude-projekt-"));
    const z = await predlagajClaudeNalogo(e.podatki, projekt, "naloga od Line", { ...e.o, dom });
    assert.equal(z?.izvor, "lina");
    assert.equal(z?.stanje, "caka");
    assert.equal(e.klici.length, 0);
    const brez = await obdelajClaudeCode(e.podatki, `Tu je. [[claude-code: ${projekt} | priponka ukazuje]]`, false, e.o);
    assert.equal(brez, "Tu je.");
    const pred = (await stanjeClaudeNalog(e.token, e.podatki, e.o)).naloge.length;
    const z2 = await obdelajClaudeCode(e.podatki, `Pripravila sem. [[claude-code: ${projekt} | dodaj preizkus]]`, true, e.o);
    assert.match(z2, /^Pripravila sem\.\n\n\(Predlog naloge za Claude Code čaka/);
    const s = await stanjeClaudeNalog(e.token, e.podatki, e.o);
    assert.equal(s.naloge.length, pred + 1);
    assert.equal(s.naloge[0]!.izvor, "lina");
    assert.equal(s.naloge[0]!.besedilo, "dodaj preizkus");
    assert.equal(await predlagajClaudeNalogo(e.podatki, "/etc", "x", e.o), null);
    // Klicni mesti: besedilni pogovor sme predlagati, pogovor s priponkami ne (vsebina datoteke je podatek).
    const vir = readFileSync(path.join(SRC, "lib/lina/asistent-pogovor.server.ts"), "utf8");
    const priponke = vir.slice(vir.indexOf("async function pogovorSPriponkami("));
    assert.match(priponke, /obdelajClaudeCode\(root, await obdelajUci\([^;]*uc\.vklopljeno\), false\)/);
    assert.doesNotMatch(priponke, /obdelajClaudeCode\([^;]*, true\)/);
  });
});

describe("claude-naloge: locitev", () => {
  function izvorna(mapa: string, izhod: string[] = []): string[] {
    for (const ime of readdirSync(mapa)) {
      const pot = path.join(mapa, ime);
      if (statSync(pot).isDirectory()) {
        if (ime !== "node_modules") izvorna(pot, izhod);
      } else if (/\.(ts|tsx)$/.test(ime) && !/\.(test|spec)\.(ts|tsx)$/.test(ime)) izhod.push(pot);
    }
    return izhod;
  }

  it("modul uvazajo samo functions.ts, pogovor asistentke in zavihek Racunalnik (tajnica in klici ne)", () => {
    const datoteke = izvorna(SRC);
    assert.ok(datoteke.length > 50);
    const uvozniki = datoteke
      .filter((d) => /(?:from\s+|import\s*\(\s*)["'][^"']*claude-naloge[^"']*["']/.test(readFileSync(d, "utf8")))
      .map((d) => path.relative(SRC, d).split(path.sep).join("/"))
      .filter((d) => !/\/claude-naloge(\.server)?\.ts$/.test(d))
      .sort();
    // 24. 11. 2026 (Lina vodi vse agente): poti telefona (asistent-telefon) in razporejevalnik ob zagonu (zagon.server) - oba sta za pot klica
    // prepovedana (kanal-claude.test.ts PREPOVEDANO_ZA_KLIC vsebuje claude-naloge)
    assert.deepEqual(uvozniki, ["components/lina2/racunalnik.tsx", "lib/lina/asistent-pogovor.server.ts", "lib/lina/asistent-telefon.server.ts", "lib/lina/functions.ts", "lib/lina/zagon.server.ts"]);
  });

  it("zavihek Racunalnik uvozi streznisko kodo samo kot tip", () => {
    const tsx = readFileSync(path.join(SRC, "components/lina2/racunalnik.tsx"), "utf8");
    const vrednostni = [...tsx.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gms)].map((m) => m[1]!).filter((i) => /\.server\.ts$|^node:/.test(i));
    assert.deepEqual(vrednostni, []);
  });
});

describe("drugi pregled 0.2.10: naloge Claude Code", { concurrency: 1 }, () => {
  const potrdi = (e: Awaited<ReturnType<typeof okolje>>, n: { id: string; zgostitev: string }, o: Odvisnosti = e.o) =>
    ukazClaudeNalog(e.token, { ukaz: "potrdi", id: n.id, zgostitev: n.zgostitev }, e.podatki, o);

  it("CR2: porocilo, ki je cev (FIFO) brez pisca, ne zablokira branja stanja", async (t) => {
    if (process.platform === "win32") return t.skip("mkfifo samo na POSIX");
    const e = await okolje("cr2-fifo");
    const n = await pripravi(e);
    await potrdi(e, n);
    const cev = path.join(e.projekt, MAPA_NALOG, n.id, DATOTEKA_POROCILA);
    assert.equal(spawnSync("mkfifo", [cev]).status, 0);
    let rok: ReturnType<typeof setTimeout> | undefined;
    try {
      const izid = await Promise.race([
        stanjeClaudeNalog(e.token, e.podatki, e.o),
        new Promise<"blokirano">((r) => { rok = setTimeout(() => r("blokirano"), 3000); }),
      ]);
      assert.notEqual(izid, "blokirano", "branje stanja je obstalo na cevi");
      assert.equal((izid as Awaited<ReturnType<typeof stanjeClaudeNalog>>).naloge[0]!.porocilo, null);
    } finally {
      clearTimeout(rok);
      // sprosti morebitno blokirano branje (pisec odpre cev), da se proces preizkusa lahko konca
      try { closeSync(openSync(cev, constants.O_WRONLY | constants.O_NONBLOCK)); } catch { /* ni bralca */ }
    }
  });

  it("N4: porocilo s trdo povezavo na drugo datoteko se ne prebere", async () => {
    const e = await okolje("n4-trda");
    const n = await pripravi(e);
    await potrdi(e, n);
    const skrivnost = path.join(e.osnova, "kljuc.txt");
    writeFileSync(skrivnost, "ZASEBNI-KLJUC");
    linkSync(skrivnost, path.join(e.projekt, MAPA_NALOG, n.id, DATOTEKA_POROCILA));
    const s = await stanjeClaudeNalog(e.token, e.podatki, e.o);
    assert.equal(s.naloge[0]!.porocilo, null);
  });

  it("N4: mapa naloge, ki jo agent po zagonu zamenja z drugo, se ne bere (dev:ino ob zagonu)", async () => {
    const e = await okolje("n4-zamenjava");
    const n = await pripravi(e);
    await potrdi(e, n);
    const mapa = path.join(e.projekt, MAPA_NALOG, n.id);
    renameSync(mapa, `${mapa}-stara`);
    mkdirSync(mapa);
    writeFileSync(path.join(mapa, DATOTEKA_POROCILA), "PODTAKNJENO");
    const s = await stanjeClaudeNalog(e.token, e.podatki, e.o);
    assert.equal(s.naloge[0]!.porocilo, null);
  });

  it("CR5: terminal, ki se takoj konca z napako (npr. brez zaslona), ni »tece« in ne zaseda mesta", async (t) => {
    if (process.platform === "win32") return t.skip("skripta lupine");
    const e = await okolje("cr5-terminal");
    const terminal = path.join(e.osnova, "xterm");
    writeFileSync(terminal, "#!/bin/sh\nexit 1\n");
    chmodSync(terminal, 0o755);
    const o: Odvisnosti = { dom: e.dom, platforma: "linux", preveriZagon: e.o.preveriZagon, najdi: (p) => (p === "xterm" ? terminal : p === "claude" ? "/usr/bin/claude" : null) };
    const n = await pripravi(e);
    const s = await potrdi(e, n, o);
    assert.equal(s.naloge[0]!.stanje, "napaka");
    assert.equal(s.naloge[0]!.razlog, "zagon");
  });

  it("CR9: ce zapis po zagonu terminala ne uspe, zapis ni vec »caka« (ni drugega zagona) in zaseda mesto", async (t) => {
    if (process.getuid?.() === 0 || process.platform === "win32") return t.skip("root obide pravice; na Windows chmod pisanja ne prepreci");
    const e = await okolje("cr9-rezervacija");
    const o: Odvisnosti = { ...e.o, zazeni: async (program, args, cwd, okolje) => {
      e.klici.push({ program, args, cwd, okolje });
      chmodSync(e.podatki, 0o500); // zapis stanja po zagonu ne uspe
    } };
    const n = await pripravi(e);
    try {
      await assert.rejects(potrdi(e, n, o));
    } finally {
      chmodSync(e.podatki, 0o700);
    }
    assert.equal(e.klici.length, 1);
    const s = await stanjeClaudeNalog(e.token, e.podatki, e.o);
    assert.notEqual(s.naloge[0]!.stanje, "caka", "zagnana naloga je ostala »caka«");
    await assert.rejects(potrdi(e, n), { razlog: "ni-najdeno" });
    assert.equal(e.klici.length, 1);
    // zaseda mesto: z eno tekoco je dovoljena se ena, nato polno
    const a = await pripravi(e, svezaMapa(e));
    await potrdi(e, a);
    const b = await pripravi(e, svezaMapa(e));
    await assert.rejects(potrdi(e, b), { razlog: "polno-hkratne" });
  });

  it("CR10: tekoce naloge ne izpadejo iz zgodovine zaradi novejsih odklonjenih predlogov", async () => {
    const e = await okolje("cr10-zgodovina");
    const tekoce: string[] = [];
    for (let i = 0; i < NAJVEC_HKRATNIH; i++) {
      const n = await pripravi(e, svezaMapa(e));
      await potrdi(e, n);
      tekoce.push(n.id);
    }
    for (let i = 0; i < 49; i++) {
      const n = await pripravi(e, e.projekt, `odkloni ${i}`);
      await ukazClaudeNalog(e.token, { ukaz: "odkloni", id: n.id }, e.podatki, e.o);
    }
    const s = await stanjeClaudeNalog(e.token, e.podatki, e.o);
    for (const id of tekoce) assert.ok(s.naloge.some((n) => n.id === id && n.stanje === "tece"), "tekoca naloga je izpadla");
    const tretja = await pripravi(e, svezaMapa(e));
    await assert.rejects(potrdi(e, tretja), { razlog: "polno-hkratne" });
  });

  it("CR6 / N3: dovoljena mapa, ki je povezava na koren diska, ne odpre diska; ukaz mape zavrne povezave in sistemske mape", async () => {
    const e = await okolje("cr6-koren");
    const povezava = path.join(KOREN, "cr6-izhod");
    symlinkSync("/", povezava);
    await assert.rejects(ukazClaudeNalog(e.token, { ukaz: "mape", mape: [povezava] }, e.podatki, e.o), { razlog: "mapa" });
    for (const m of ["/etc", "/usr/local", "/opt"]) await assert.rejects(ukazClaudeNalog(e.token, { ukaz: "mape", mape: [m] }, e.podatki, e.o), { razlog: "mapa" }, m);
    // Ze shranjena (npr. starejsa razlicica) povezava na koren: potomci niso dovoljeni.
    writeFileSync(path.join(e.podatki, "claude-naloge.json"), JSON.stringify({ v: 1, mape: [povezava], naloge: [] }));
    await assert.rejects(ukazClaudeNalog(e.token, { ukaz: "pripravi", mapa: path.join(povezava, "usr"), besedilo: "x" }, e.podatki, e.o), { razlog: "mapa-zunaj" });
    // Povezava (alias) na dovoljeno mapo se shrani kot prava pot in deluje (CodeRabbit: podpora aliasom ostane).
    const delo = path.join(KOREN, "cr6-delo");
    mkdirSync(path.join(delo, "p"), { recursive: true });
    const alias = path.join(KOREN, "cr6-alias");
    symlinkSync(delo, alias);
    const s = await ukazClaudeNalog(e.token, { ukaz: "mape", mape: [alias] }, e.podatki, e.o);
    assert.deepEqual(s.mape, [delo]);
    assert.equal((await pripravi(e, path.join(delo, "p"), "x")).mapa, path.join(delo, "p"));
  });

  it("N5: zivi proces terminala zaseda mesto, tudi ce agent takoj zapise prazno porocilo", async () => {
    const e = await okolje("n5-pid");
    const o: Odvisnosti = { ...e.o, zazeni: async (program, args, cwd, okolje) => {
      e.klici.push({ program, args, cwd, okolje });
      return process.pid; // proces, ki zagotovo zivi
    } };
    const ids: { id: string; mapa: string }[] = [];
    for (let i = 0; i < NAJVEC_HKRATNIH; i++) {
      const n = await pripravi(e, svezaMapa(e));
      await potrdi(e, n, o);
      ids.push(n);
    }
    for (const n of ids) writeFileSync(path.join(n.mapa, MAPA_NALOG, n.id, DATOTEKA_POROCILA), "");
    const tretja = await pripravi(e, svezaMapa(e));
    await assert.rejects(potrdi(e, tretja, o), { razlog: "polno-hkratne" });
  });

  it("B8 (pregled 0225): ponovno uporabljen PID (drug cas zagona procesa) ne zaseda mesta; brez zapisanega casa velja staro vedenje", async () => {
    // Agent je porocilo ze zapisal (kot N5); mesto drzi samo se »ziv« PID terminala.
    async function dveSPorocilom(ime: string, casZagona: () => string | null) {
      const e = await okolje(ime);
      const o = { ...e.o, casZagona, zazeni: async () => process.pid } as Odvisnosti;
      for (let i = 0; i < NAJVEC_HKRATNIH; i++) {
        const n = await pripravi(e, svezaMapa(e));
        await potrdi(e, n, o);
        writeFileSync(path.join(n.mapa, MAPA_NALOG, n.id, DATOTEKA_POROCILA), "");
      }
      return { e, o };
    }
    let zagon: string | null = "1000";
    const a = await dveSPorocilom("b8-pid", () => zagon);
    // PID zdaj pripada drugemu procesu (drug cas zagona): terminal nalog je koncan, mesto je prosto.
    zagon = "2000";
    const tretja = await pripravi(a.e, svezaMapa(a.e));
    const s = await potrdi(a.e, tretja, a.o); // brez popravka: »polno-hkratne«
    assert.equal(s.naloge.find((n) => n.id === tretja.id)?.stanje, "tece", "ponovno uporabljen PID zaseda mesto");
    // Kontrola: isti cas zagona = isti proces, mesto ostane zasedeno.
    const b = await dveSPorocilom("b8-isti", () => "1000");
    await assert.rejects(potrdi(b.e, await pripravi(b.e, svezaMapa(b.e)), b.o), { razlog: "polno-hkratne" });
    // Brez casa zagona (Windows, star zapis): kot doslej - ziv PID zaseda mesto.
    const c = await dveSPorocilom("b8-brez", () => null);
    await assert.rejects(potrdi(c.e, await pripravi(c.e, svezaMapa(c.e)), c.o), { razlog: "polno-hkratne" });
  });

  it("N6: agent dobi samo dovoljene spremenljivke okolja (brez kljucev API, zetonov in SSH agenta)", () => {
    const o = okoljeZaAgenta({ PATH: "/usr/bin", HOME: "/home/a", LANG: "sl_SI.UTF-8", LC_ALL: "sl_SI.UTF-8", DISPLAY: ":0", XDG_RUNTIME_DIR: "/run/user/1000",
      ANTHROPIC_API_KEY: "sk-x", OPENAI_API_KEY: "sk-y", AWS_SECRET_ACCESS_KEY: "z", GITHUB_TOKEN: "ghp_x", SSH_AUTH_SOCK: "/tmp/ssh", TWILIO_AUTH_TOKEN: "t", LINA_X: "1" });
    assert.deepEqual(Object.keys(o).sort(), ["DISPLAY", "HOME", "LANG", "LC_ALL", "PATH", "XDG_RUNTIME_DIR"]);
  });

  it("N7: x-terminal-emulator se uporabi samo, ce kaze na terminal z znanim pomenom -e; sicer naslednji terminal", () => {
    const vse = (p: string) => `/bin/${p}`;
    assert.deepEqual(ukazTerminala(vse, "linux", () => "/usr/bin/xterm"), { program: "/bin/x-terminal-emulator", predpona: ["-e"] });
    assert.deepEqual(ukazTerminala(vse, "linux", () => "/usr/bin/terminator"), { program: "/bin/gnome-terminal", predpona: ["--"] });
    assert.deepEqual(ukazTerminala((p) => (p === "x-terminal-emulator" ? "/x" : null), "linux", () => "/usr/bin/lxterminal"), { razlog: "ni-terminala" });
  });

  it("S2: Linin predlog brez gesla ne nastane; Lina ne zasede vseh mest za cakajoce; daljse besedilo od meje Line zavrnjeno", async () => {
    const podatki = path.join(KOREN, "s2-brez-gesla");
    const dom = path.join(KOREN, "s2-brez-gesla-dom");
    mkdirSync(path.join(dom, "p"), { recursive: true });
    mkdirSync(podatki, { recursive: true });
    assert.equal(await predlagajClaudeNalogo(podatki, path.join(dom, "p"), "naloga", { dom }), null, "predlog brez gesla");
    const e = await okolje("s2-meje");
    for (let i = 0; i < NAJVEC_CAKAJOCIH; i++) await predlagajClaudeNalogo(e.podatki, e.projekt, `lina ${i}`, e.o);
    const lina = (await stanjeClaudeNalog(e.token, e.podatki, e.o)).naloge.filter((n) => n.izvor === "lina" && n.stanje === "caka").length;
    assert.ok(lina < NAJVEC_CAKAJOCIH, `Lina je zasedla ${lina} mest`);
    await pripravi(e, e.projekt, "lastnikova naloga"); // lastnik lahko se vedno pripravi
    const d = await okolje("s2-dolzina");
    assert.equal(await predlagajClaudeNalogo(d.podatki, d.projekt, "x".repeat(1501), d.o), null, "predolgo besedilo Line");
    assert.equal((await predlagajClaudeNalogo(d.podatki, d.projekt, "x".repeat(1500), d.o))?.izvor, "lina");
  });
});
