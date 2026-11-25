/**
 * Naloga 23 (del 1): Lina zazene Claude Code z izpisom stream-json in orodjem za dovoljenja (MCP Line prek stdio + Unix vticnica z zetonom),
 * vprasanje pride v Lino, Dovoli/Zavrni se vrne agentu, rok = zavrnitev, nevarno dejanje se nikoli samodejno ne odobri.
 * Lazni Claude (spodaj) prebere --mcp-config in --permission-prompt-tool iz SVOJIH argumentov: ce jih Lina ne poda, pade.
 */
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { potrdiOpozorilo } from "./opozorilo.server.ts";
import { AGENTI } from "./claude-naloge.ts";
import { stanjeClaudeNalog, ukazClaudeNalog, type Odvisnosti } from "./claude-naloge.server.ts";
import {
  DNEVNIK_ODLOCITEV,
  ORODJE_DOVOLJENJA,
  argvClaudeVLini,
  razvrstiDejanje,
  vrsticaDnevnika,
  zgostitevVprasanja,
} from "./vprasanja-agentov.ts";
import {
  odgovorVprasanja,
  odgovoriNaVprasanje,
  stanjeVprasanj,
  stanjeVprasanjZaRoot,
  telefonOdgovor,
  telefonVprasanja,
  ustaviVseVLini,
  zazeniVLini,
} from "./vprasanja-agentov.server.ts";
import { nizOdgovoraVprasanja, nizStanjaVprasanj } from "./kanal-claude.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-vpr-"));

/** Lazni Claude Code: preveri argumente, zazene MCP streznik iz --mcp-config, poklice orodje za dovoljenje in izpise stream-json. */
const LAZNI_CLAUDE = `#!${process.execPath}
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const a = process.argv.slice(2);
const vr = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
const izpis = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
// kot pravi agent: zaprta cev izpisa (Lina je umrla) ga ne ustavi
if (process.env.LAZNI_DELA) process.stdout.on("error", () => {});
if (!a.includes("-p") || vr("--output-format") !== "stream-json" || !a.includes("--verbose")) { console.error("napacni argumenti"); process.exit(3); }
const orodje = vr("--permission-prompt-tool");
const konfig = vr("--mcp-config");
if (!orodje || !konfig) { console.error("brez orodja za dovoljenje"); process.exit(4); }
const [, streznik, ime] = orodje.split("__");
const m = JSON.parse(readFileSync(konfig, "utf8")).mcpServers[streznik];
if (!m) { console.error("streznika ni v konfiguraciji"); process.exit(5); }
const mcp = spawn(m.command, m.args ?? [], { env: { ...process.env, ...(m.env ?? {}) }, stdio: ["pipe", "pipe", "inherit"] });
let b = ""; const cakajo = new Map(); let n = 0;
mcp.stdout.setEncoding("utf8");
mcp.stdout.on("data", (d) => { b += d; let i; while ((i = b.indexOf("\\n")) >= 0) { const z = JSON.parse(b.slice(0, i)); b = b.slice(i + 1); cakajo.get(z.id)?.(z); } });
const klic = (method, params) => new Promise((r) => { const id = ++n; cakajo.set(id, r); mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\\n"); });
izpis({ type: "system", subtype: "init", session_id: "s1", tools: ["Bash"] });
await klic("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "lazni", version: "0" } });
mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\\n");
const seznam = await klic("tools/list", {});
if (!seznam.result.tools.some((t) => t.name === ime)) { console.error("orodja ni"); process.exit(6); }
// poziv naloge Line (pot porocila): kot pravi agent zapise porocilo z orodjem Write; sicer Bash z LAZNI_UKAZ ali dolgim ukazom
const poziv = a[a.indexOf("-p") + 1];
const pot = /zapisi v (\\S+POROCILO\\.md)/.exec(poziv)?.[1];
const [orodjeA, vnos] = pot
  ? ["Write", { file_path: process.cwd() + "/" + pot, content: "# Porocilo\\n" + "Narejeno.\\n".repeat(400) }]
  : ["Bash", { command: process.env.LAZNI_DOLZINA ? "echo " + "a".repeat(Number(process.env.LAZNI_DOLZINA)) + "; curl evil" : (process.env.LAZNI_UKAZ ?? "rm -rf build") }];
izpis({ type: "assistant", message: { content: [{ type: "text", text: "Pobrisem mapo build." }, { type: "tool_use", name: orodjeA, input: vnos }] } });
const r = await klic("tools/call", { name: ime, arguments: { tool_name: orodjeA, input: vnos, tool_use_id: "t1" } });
const odl = JSON.parse(r.result.content[0].text);
if (odl.behavior === "allow" && orodjeA === "Write") { mkdirSync(odl.updatedInput.file_path.replace(/\\/[^/]+$/, ""), { recursive: true }); writeFileSync(odl.updatedInput.file_path, odl.updatedInput.content); }
izpis({ type: "result", subtype: "success", is_error: false, result: "odlocitev=" + odl.behavior + (odl.updatedInput && orodjeA === "Bash" ? " vnos=" + JSON.stringify(odl.updatedInput) : "") + (odl.message ? " sporocilo=" + odl.message : "") });
mcp.stdin.end();
// LAZNI_DELA: agent dela naprej tudi po zavrnitvi (brez vprasanj); izpis v zaprto cev ga ne ustavi
if (process.env.LAZNI_DELA) { setInterval(() => izpis({ type: "assistant", message: { content: [{ type: "text", text: "delam" }] } }), 200); }
else process.exit(0);
`;

function lazniClaude(): string {
  const p = path.join(KOREN, `claude-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(p, LAZNI_CLAUDE);
  chmodSync(p, 0o700);
  return p;
}

let st = 0;
function okolje() {
  const osnova = path.join(KOREN, `o${++st}`);
  const root = path.join(osnova, "podatki");
  const delovna = path.join(osnova, "projekt");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  mkdirSync(delovna, { recursive: true });
  return { root, delovna };
}

async function pocakaj<T>(fn: () => Promise<T | null | undefined | false> | T | null | undefined | false, ms = 8000): Promise<T> {
  const konec = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > konec) throw new Error("rok cakanja");
    await new Promise((r) => setTimeout(r, 25));
  }
}

const ID = "0123456789abcdef";

describe("vprasanja agenta (Claude Code -> Lina)", () => {
  it("argv: -p, stream-json, --verbose, orodje za dovoljenje Line in samo MCP Line; nikoli preskok dovoljenj", () => {
    const a = argvClaudeVLini("Preberi nalogo.", "/x/mcp.json");
    assert.deepEqual(a.slice(0, 2), ["-p", "Preberi nalogo."]);
    assert.equal(a[a.indexOf("--output-format") + 1], "stream-json");
    assert.ok(a.includes("--verbose"));
    assert.equal(a[a.indexOf("--permission-prompt-tool") + 1], ORODJE_DOVOLJENJA);
    assert.equal(a[a.indexOf("--mcp-config") + 1], "/x/mcp.json");
    assert.ok(a.includes("--strict-mcp-config"));
    assert.equal(a[a.indexOf("--setting-sources") + 1], "user", "pravila in kljuke projekta ne obidejo vprasanj");
    assert.equal(a[a.indexOf("--permission-mode") + 1], "default");
    assert.ok(!a.some((x) => /dangerously|bypass|allowedTools|allowed-tools/i.test(x)));
  });

  it("lazni Claude: vprasanje pride v Lino, Dovoli se vrne agentu z nespremenjenim vnosom, dnevnik dela in odlocitev sta zapisana", async () => {
    const e = okolje();
    await zazeniVLini(e.root, ID, lazniClaude(), "Naloga.", e.delovna, { PATH: process.env.PATH });
    const v = await pocakaj(() => stanjeVprasanjZaRoot(e.root).vprasanja.find((x) => x.stanje === "caka"));
    assert.equal(v.orodje, "Bash");
    assert.equal(v.naloga, ID);
    assert.ok(v.nevarno);
    assert.ok(v.razlogi.includes("brisanje"));
    assert.match(v.predogled, /rm -rf build/);
    await odgovoriNaVprasanje(e.root, v.id, "dovoli", v.zgostitev, "lastnik");
    const t = await pocakaj(() => stanjeVprasanjZaRoot(e.root).teki.find((x) => x.naloga === ID && x.stanje !== "tece"));
    assert.equal(t.stanje, "koncano");
    assert.ok(t.vrstice.some((x) => /odlocitev=allow vnos=\{"command":"rm -rf build"\}/.test(x)), t.vrstice.join("\n"));
    assert.ok(t.vrstice.some((x) => /Pobrisem mapo build/.test(x)));
    const dn = readFileSync(path.join(e.root, DNEVNIK_ODLOCITEV), "utf8").trim().split("\n").map((x) => JSON.parse(x));
    assert.equal(dn.length, 1);
    assert.equal(dn[0].odlocitev, "dovoli");
    assert.equal(dn[0].kdo, "lastnik");
    assert.equal(statSync(path.join(e.root, DNEVNIK_ODLOCITEV)).mode & 0o777, 0o600);
    // ponoven odgovor na isto vprasanje ne velja
    await assert.rejects(odgovoriNaVprasanje(e.root, v.id, "zavrni", v.zgostitev, "lastnik"), { razlog: "ni-vprasanja" });
  });

  it("Zavrni se vrne agentu kot deny", async () => {
    const e = okolje();
    await zazeniVLini(e.root, ID, lazniClaude(), "Naloga.", e.delovna, { PATH: process.env.PATH });
    const v = await pocakaj(() => stanjeVprasanjZaRoot(e.root).vprasanja.find((x) => x.stanje === "caka"));
    await odgovoriNaVprasanje(e.root, v.id, "zavrni", v.zgostitev, "lastnik");
    const t = await pocakaj(() => stanjeVprasanjZaRoot(e.root).teki.find((x) => x.stanje !== "tece"));
    assert.ok(t.vrstice.some((x) => /odlocitev=deny/.test(x)), t.vrstice.join("\n"));
  });

  it("odgovor z napacno zgostitvijo prikaza (drugo vprasanje na zaslonu) se zavrne", async () => {
    const e = okolje();
    await zazeniVLini(e.root, ID, lazniClaude(), "Naloga.", e.delovna, { PATH: process.env.PATH });
    const v = await pocakaj(() => stanjeVprasanjZaRoot(e.root).vprasanja.find((x) => x.stanje === "caka"));
    await assert.rejects(odgovoriNaVprasanje(e.root, v.id, "dovoli", "0".repeat(64), "lastnik"), { razlog: "zgostitev" });
    await odgovoriNaVprasanje(e.root, v.id, "zavrni", v.zgostitev, "lastnik");
    await pocakaj(() => stanjeVprasanjZaRoot(e.root).teki.find((x) => x.stanje !== "tece"));
  });

  it("rok za odgovor -> zavrnitev (nevarno dejanje se nikoli samodejno ne odobri)", async () => {
    const e = okolje();
    await zazeniVLini(e.root, ID, lazniClaude(), "Naloga.", e.delovna, { PATH: process.env.PATH, LAZNI_UKAZ: "sudo git push --force" }, { rokMs: 300 });
    const t = await pocakaj(() => stanjeVprasanjZaRoot(e.root).teki.find((x) => x.stanje !== "tece"));
    assert.ok(t.vrstice.some((x) => /odlocitev=deny/.test(x) && /rok/i.test(x)), t.vrstice.join("\n"));
    const dn = readFileSync(path.join(e.root, DNEVNIK_ODLOCITEV), "utf8").trim().split("\n").map((x) => JSON.parse(x));
    assert.equal(dn[0].odlocitev, "zavrni");
    assert.equal(dn[0].kdo, "rok");
    assert.ok(dn[0].razlogi.includes("sudo") && dn[0].razlogi.includes("git-push"));
  });

  it("povezava na vticnico brez pravega zetona ne odpre vprasanja", async () => {
    const e = okolje();
    // lazni claude, ki caka: vticnica ostane odprta, dokler ne odgovorimo
    await zazeniVLini(e.root, ID, lazniClaude(), "Naloga.", e.delovna, { PATH: process.env.PATH });
    const v = await pocakaj(() => stanjeVprasanjZaRoot(e.root).vprasanja.find((x) => x.stanje === "caka"));
    const vt = stanjeVprasanjZaRoot(e.root).teki[0]!.vticnica;
    assert.ok(vt && existsSync(vt));
    assert.equal(statSync(path.dirname(vt)).mode & 0o777, 0o700);
    const odg = await new Promise<string>((r) => {
      const s = createConnection(vt);
      let b = "";
      s.on("connect", () => s.write(JSON.stringify({ zeton: "napacen", orodje: "Bash", vnos: { command: "ls" } }) + "\n"));
      s.on("data", (d) => (b += d));
      s.on("close", () => r(b));
      s.on("error", () => r(b));
    });
    assert.equal(odg, "");
    assert.equal(stanjeVprasanjZaRoot(e.root).vprasanja.filter((x) => x.stanje === "caka").length, 1);
    await odgovoriNaVprasanje(e.root, v.id, "zavrni", v.zgostitev, "lastnik");
    await pocakaj(() => stanjeVprasanjZaRoot(e.root).teki.find((x) => x.stanje !== "tece"));
  });

  it("razvrstitev: brisanje, push, sudo, omrezje, namescanje, pisanje zunaj mape in sestavljeni ukazi so nevarni", () => {
    const d = "/dom/projekt";
    const nev = (o: string, v: Record<string, unknown>) => razvrstiDejanje(o, v, d);
    for (const c of [
      "rm -rf build", "git push origin main", "sudo ls", "curl https://x", "wget x", "npm install x", "pip install x", "apt-get install x",
      "bash -c 'echo'", "python3 -c 'import os'", "find . -delete", "ls | xargs rm", "git -C .. push", "echo x > /etc/y", "echo x | tee a",
      "node -e 1", "eval x", "$(echo rm) -rf /", "unlink a", "shred a", "mv a /tmp/b", "dd if=/dev/zero of=x", "/usr/bin/rm a", "\\rm a",
    ]) assert.ok(nev("Bash", { command: c }).nevarno, c);
    assert.ok(nev("Write", { file_path: "/etc/passwd" }).razlogi.includes("zunaj-mape"));
    assert.ok(nev("Edit", { file_path: "/dom/projekt/../drugo/a.ts" }).razlogi.includes("zunaj-mape"));
    assert.ok(nev("Write", { file_path: "rel/a.ts" }).razlogi.includes("zunaj-mape"), "relativna pot ni dokazljivo v mapi");
    assert.ok(!nev("Write", { file_path: "/dom/projekt/src/a.ts" }).nevarno);
    assert.ok(nev("WebFetch", { url: "https://x" }).razlogi.includes("omrezje"));
    assert.ok(nev("mcp__drugo__x", {}).razlogi.includes("neznano"));
    assert.ok(!nev("Bash", { command: "npm test" }).nevarno);
    assert.ok(nev("Write", { file_path: "/dom/projekt/.claude/settings.json" }).razlogi.includes("nastavitve"));
    assert.ok(nev("Edit", { file_path: "/dom/projekt/.git/hooks/pre-commit" }).razlogi.includes("nastavitve"));
    assert.ok(nev("Read", { file_path: "/dom/.ssh/id_ed25519" }).razlogi.includes("zunaj-mape"));
    assert.ok(nev("Grep", { pattern: "x", path: "/dom/.local/share/lina" }).razlogi.includes("zunaj-mape"));
    assert.ok(!nev("Read", { file_path: "/dom/projekt/a.ts" }).nevarno);
    assert.ok(nev("Bash", { command: "awk 'BEGIN{system(\"rm -rf x\")}'" }).nevarno);
  });

  it("dnevnik dela: stream-json v kratke vrstice brez nadzornih znakov", () => {
    assert.equal(vrsticaDnevnika(JSON.stringify({ type: "system", subtype: "init" })), "Zacetek seje");
    assert.equal(vrsticaDnevnika(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "a\u001b[31mb" }] } })), "ab");
    assert.equal(vrsticaDnevnika(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: {} }] } })), "Orodje: Bash");
    assert.equal(vrsticaDnevnika(JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true })), "Konec: error_max_turns (napaka)");
    assert.equal(vrsticaDnevnika(JSON.stringify({ type: "user", message: {} })), null);
    assert.ok((vrsticaDnevnika("x".repeat(5000)) ?? "").length <= 500);
  });

  it("zgostitev in podpisani nizi za telefon vezejo id, odlocitev in prikazano", () => {
    const z = zgostitevVprasanja({ id: "a", naloga: ID, orodje: "Bash", predogled: "rm", vnos: "1" });
    assert.notEqual(z, zgostitevVprasanja({ id: "a", naloga: ID, orodje: "Bash", predogled: "rm -rf /", vnos: "1" }));
    assert.notEqual(z, zgostitevVprasanja({ id: "a", naloga: ID, orodje: "Bash", predogled: "rm", vnos: "2" }), "veze tudi celoten vnos");
    assert.equal(nizOdgovoraVprasanja("n-0", "a", "dovoli", z, 1, "e"), `safeer-lina-agent-vprasanje-v1\nn-0\na\ndovoli\n${z}\n1\ne`);
    assert.equal(nizStanjaVprasanj("n-0", 1, "e"), "safeer-lina-agent-vprasanja-stanje-v1\nn-0\n1\ne");
  });

  it("racunalnik: Dovoli brez gesla lastnika je zavrnjen (vsak lokalni proces ima sejo), Zavrni deluje", async () => {
    const e = okolje();
    const { odpriLokalnoSejo } = await import("./auth.server.ts");
    const t = await odpriLokalnoSejo({ address: "127.0.0.1", forwardedFor: null, forwarded: null, host: "localhost:3000", origin: null, fetchSite: null }, e.root);
    assert.ok(t);
    await zazeniVLini(e.root, ID, lazniClaude(), "Naloga.", e.delovna, { PATH: process.env.PATH });
    const v = await pocakaj(async () => (await stanjeVprasanj(t, e.root)).vprasanja.find((x) => x.stanje === "caka"));
    await assert.rejects(odgovorVprasanja(t, { id: v.id, odlocitev: "dovoli", zgostitev: v.zgostitev }, e.root), { razlog: "geslo" });
    await odgovorVprasanja(t, { id: v.id, odlocitev: "zavrni", zgostitev: v.zgostitev }, e.root);
    const k = await pocakaj(() => stanjeVprasanjZaRoot(e.root).teki.find((x) => x.stanje !== "tece"));
    assert.ok(k.vrstice.some((x) => /odlocitev=deny/.test(x)));
  });

  it("racunalnik: brez seje lastnika ni ne stanja ne odgovora", async () => {
    const e = okolje();
    await setupOwner("geslo-test-1234", e.root);
    await assert.rejects(stanjeVprasanj(null, e.root));
    await assert.rejects(odgovorVprasanja("napacen", { id: "x", odlocitev: "dovoli", zgostitev: "y" }, e.root));
  });

  it("naloga za claude (Linux, brez peskovnika) se zazene v Lini z vprasanji, ne v terminalu", async () => {
    const osnova = path.join(KOREN, "integr");
    const dom = path.join(osnova, "dom");
    const podatki = path.join(osnova, "podatki");
    const projekt = path.join(dom, "projekt");
    mkdirSync(projekt, { recursive: true });
    mkdirSync(podatki, { recursive: true });
    const token = await setupOwner("geslo-test-1234", podatki);
    await potrdiOpozorilo(podatki);
    const terminal: string[][] = [];
    const vLini: { program: string; poziv: string; cwd: string }[] = [];
    const o: Odvisnosti = {
      dom,
      platforma: "linux",
      najdi: (x) => (["xterm", ...AGENTI].includes(x as never) ? `/usr/bin/${x}` : null),
      preveriZagon: async () => ({ koda: 0, izpis: "1.0.0", potekel: false }),
      zazeni: async (program, args) => {
        terminal.push([program, ...args]);
        return 4242;
      },
      zazeniVLini: async (_root, _id, program, poziv, cwd) => {
        vLini.push({ program, poziv, cwd });
        return 4343;
      },
      casZagona: () => null,
    };
    await ukazClaudeNalog(token, { ukaz: "dodeli", agent: "claude", mapa: projekt, besedilo: "Popravi.", pogoj: "zdaj" }, podatki, o);
    assert.equal(terminal.length, 0);
    assert.equal(vLini.length, 1);
    assert.equal(vLini[0]!.program, "/usr/bin/claude");
    assert.match(vLini[0]!.poziv, /NALOGA\.md/);
  });
});

describe("vprasanja agenta: popravki pregleda 25. 11.", () => {
  it("S1: Lina ustavljena s SIGTERM ustavi agenta (cela skupina) in sama konca", async () => {
    const e = okolje();
    const modul = path.resolve("src/lib/lina/vprasanja-agentov.server.ts");
    const otrok = path.join(KOREN, `lina-${st}.mts`);
    writeFileSync(otrok, `import { zazeniVLini } from ${JSON.stringify(modul)};
const pid = await zazeniVLini(${JSON.stringify(e.root)}, "${ID}", ${JSON.stringify(lazniClaude())}, "Naloga.", ${JSON.stringify(e.delovna)}, { PATH: process.env.PATH, LAZNI_DELA: "1" });
process.stdout.write(pid + "\\n");
setInterval(() => {}, 1000);
`);
    const { spawn: sp } = await import("node:child_process");
    const lina = sp(process.execPath, ["--experimental-strip-types", "--no-warnings", otrok], { stdio: ["ignore", "pipe", "inherit"] });
    let izpis = "";
    lina.stdout.setEncoding("utf8");
    lina.stdout.on("data", (d) => (izpis += d));
    const pid = Number(await pocakaj(() => /^\d+\n/.test(izpis) && izpis.trim()));
    // agent zivi in caka na vprasanje (vticnica obstaja)
    await pocakaj(() => existsSync(path.join(e.root, "vpr")) && readdirSync(path.join(e.root, "vpr")).some((f) => f.endsWith(".s")));
    process.kill(pid, 0);
    const izhod = new Promise<NodeJS.Signals | null>((r) => lina.once("exit", (_k, sig) => r(sig)));
    lina.kill("SIGTERM");
    assert.equal(await izhod, "SIGTERM", "Lina konca kot pri privzetem SIGTERM");
    await pocakaj(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    });
  });

  it("prava pot: dodelitev naloge za claude -> privzeti zagon v Lini -> Dovoli za pisanje porocila (nekaj KB) -> naloga ima porocilo", async () => {
    const osnova = path.join(KOREN, "e2e");
    const dom = path.join(osnova, "dom");
    const podatki = path.join(osnova, "podatki");
    const projekt = path.join(dom, "projekt");
    mkdirSync(projekt, { recursive: true });
    mkdirSync(podatki, { recursive: true });
    const token = await setupOwner("geslo-test-1234", podatki);
    await potrdiOpozorilo(podatki);
    const claude = lazniClaude();
    const o: Odvisnosti = {
      dom,
      platforma: "linux",
      najdi: (x) => (x === "claude" ? claude : x === "xterm" ? "/usr/bin/xterm" : null),
      preveriZagon: async () => ({ koda: 0, izpis: "1.0.0", potekel: false }),
    };
    await ukazClaudeNalog(token, { ukaz: "dodeli", agent: "claude", mapa: projekt, besedilo: "Popravi.", pogoj: "zdaj" }, podatki, o);
    const v = await pocakaj(async () => (await stanjeVprasanj(token, podatki)).vprasanja.find((x) => x.stanje === "caka"));
    assert.equal(v.orodje, "Write");
    assert.ok(!v.odrezano, "porocilo nekaj KB mora biti mogoce odobriti");
    assert.ok(!v.razlogi.includes("nastavitve"), v.razlogi.join(","));
    await odgovorVprasanja(token, { id: v.id, odlocitev: "dovoli", zgostitev: v.zgostitev }, podatki);
    await pocakaj(() => stanjeVprasanjZaRoot(podatki).teki.find((x) => x.stanje === "koncano"));
    const n = await pocakaj(async () => (await stanjeClaudeNalog(token, podatki, o)).naloge.find((x) => x.porocilo));
    assert.match(n.porocilo!, /Narejeno\./);
  });

  it("V2: vnos nekaj KB je na racunalniku viden ves (odobriti ga je mogoce); na telefonu je odrezan in ga telefon lahko samo zavrne", async () => {
    const e = okolje();
    await zazeniVLini(e.root, ID, lazniClaude(), "Naloga.", e.delovna, { PATH: process.env.PATH, LAZNI_DOLZINA: "5000" });
    const v = await pocakaj(() => stanjeVprasanjZaRoot(e.root).vprasanja.find((x) => x.stanje === "caka"));
    assert.ok(!v.odrezano);
    assert.ok(v.predogled.includes("curl evil"));
    const tv = telefonVprasanja(e.root).vprasanja.find((x) => x.id === v.id)!;
    assert.ok(tv.odrezano && !tv.predogled.includes("curl evil"));
    await assert.rejects(telefonOdgovor(e.root, v.id, "dovoli", v.zgostitev, "n-0123456789abcdef"), { razlog: "odrezano" });
    await odgovoriNaVprasanje(e.root, v.id, "dovoli", v.zgostitev, "lastnik");
    const t = await pocakaj(() => stanjeVprasanjZaRoot(e.root).teki.find((x) => x.stanje !== "tece"));
    assert.ok(t.vrstice.some((x) => /odlocitev=allow/.test(x)));
  });

  it("V2: vnos nad mejo prikaza (lastnik ne vidi celega) se ne more odobriti, samo zavrniti", async () => {
    const e = okolje();
    await zazeniVLini(e.root, ID, lazniClaude(), "Naloga.", e.delovna, { PATH: process.env.PATH, LAZNI_DOLZINA: "210000" });
    const v = await pocakaj(() => stanjeVprasanjZaRoot(e.root).vprasanja.find((x) => x.stanje === "caka"));
    assert.ok(v.odrezano);
    assert.ok(!v.predogled.includes("curl evil"));
    await assert.rejects(odgovoriNaVprasanje(e.root, v.id, "dovoli", v.zgostitev, "lastnik"), { razlog: "odrezano" });
    await odgovoriNaVprasanje(e.root, v.id, "zavrni", v.zgostitev, "lastnik");
    const t = await pocakaj(() => stanjeVprasanjZaRoot(e.root).teki.find((x) => x.stanje !== "tece"));
    assert.ok(t.vrstice.some((x) => /odlocitev=deny/.test(x)));
  });

  it("V1: geslo, nastavljeno sele po zagonu agenta (agent ga lahko nastavi sam), ne odobri nicesar z racunalnika", async () => {
    const e = okolje();
    await zazeniVLini(e.root, ID, lazniClaude(), "Naloga.", e.delovna, { PATH: process.env.PATH });
    const v = await pocakaj(() => stanjeVprasanjZaRoot(e.root).vprasanja.find((x) => x.stanje === "caka"));
    const token = await setupOwner("geslo-agenta-1234", e.root);
    await assert.rejects(odgovorVprasanja(token, { id: v.id, odlocitev: "dovoli", zgostitev: v.zgostitev }, e.root), { razlog: "geslo" });
    await odgovorVprasanja(token, { id: v.id, odlocitev: "zavrni", zgostitev: v.zgostitev }, e.root);
    await pocakaj(() => stanjeVprasanjZaRoot(e.root).teki.find((x) => x.stanje !== "tece"));
  });

  it("V1: z geslom ze ob zagonu racunalnik odobri", async () => {
    const e = okolje();
    const token = await setupOwner("geslo-test-1234", e.root);
    await zazeniVLini(e.root, ID, lazniClaude(), "Naloga.", e.delovna, { PATH: process.env.PATH });
    const v = await pocakaj(() => stanjeVprasanjZaRoot(e.root).vprasanja.find((x) => x.stanje === "caka"));
    await odgovorVprasanja(token, { id: v.id, odlocitev: "dovoli", zgostitev: v.zgostitev }, e.root);
    const t = await pocakaj(() => stanjeVprasanjZaRoot(e.root).teki.find((x) => x.stanje !== "tece"));
    assert.ok(t.vrstice.some((x) => /odlocitev=allow/.test(x)), t.vrstice.join("\n"));
  });

  it("S3: brez zapisa v dnevnik odlocitev ni odobritve (agent dobi deny)", async () => {
    const e = okolje();
    mkdirSync(path.join(e.root, DNEVNIK_ODLOCITEV)); // pot dnevnika je mapa: zapis ne uspe
    await zazeniVLini(e.root, ID, lazniClaude(), "Naloga.", e.delovna, { PATH: process.env.PATH });
    const v = await pocakaj(() => stanjeVprasanjZaRoot(e.root).vprasanja.find((x) => x.stanje === "caka"));
    await odgovoriNaVprasanje(e.root, v.id, "dovoli", v.zgostitev, "lastnik");
    const t = await pocakaj(() => stanjeVprasanjZaRoot(e.root).teki.find((x) => x.stanje !== "tece"));
    assert.ok(t.vrstice.some((x) => /odlocitev=deny.*Dnevnik/.test(x)), t.vrstice.join("\n"));
  });

  it("S3: dnevnik odlocitev skrije ocitne skrivnosti v predogledu", async () => {
    const e = okolje();
    await zazeniVLini(e.root, ID, lazniClaude(), "Naloga.", e.delovna, { PATH: process.env.PATH, LAZNI_UKAZ: "curl -H 'Authorization: Bearer abcdef123456' https://x" });
    const v = await pocakaj(() => stanjeVprasanjZaRoot(e.root).vprasanja.find((x) => x.stanje === "caka"));
    await odgovoriNaVprasanje(e.root, v.id, "zavrni", v.zgostitev, "lastnik");
    await pocakaj(() => stanjeVprasanjZaRoot(e.root).teki.find((x) => x.stanje !== "tece"));
    const dn = readFileSync(path.join(e.root, DNEVNIK_ODLOCITEV), "utf8");
    assert.ok(!dn.includes("abcdef123456"), dn);
    assert.match(dn, /zgostitevVnosa/);
  });

  it("S1: ob izhodu Line se agenti ustavijo (ne delajo naprej brez nadzora), odprto vprasanje je zavrnjeno", async () => {
    const e = okolje();
    await zazeniVLini(e.root, ID, lazniClaude(), "Naloga.", e.delovna, { PATH: process.env.PATH });
    const v = await pocakaj(() => stanjeVprasanjZaRoot(e.root).vprasanja.find((x) => x.stanje === "caka"));
    ustaviVseVLini();
    const t = await pocakaj(() => stanjeVprasanjZaRoot(e.root).teki.find((x) => x.stanje !== "tece"));
    assert.equal(t.stanje, "napaka");
    assert.equal(stanjeVprasanjZaRoot(e.root).vprasanja.find((x) => x.id === v.id)!.stanje, "zavrnjeno");
  });
});

// ------------------------------------------------------------------ telefon: podpisan odgovor naprave (isti mehanizem kot naloge)

import { generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { request } from "node:https";
import type { Izvajalec } from "./asistent.server.ts";
import { AsistentStreznik, POT, POTI_ODDALJENO, potrdiloAsistenta } from "./asistent-streznik.server.ts";
import { idIzKljuca, type Dokaz } from "./kanal-claude.ts";
import { pripraviKanal } from "./kanal-claude.server.ts";

type Naprava = { id: string; kljuc: string; zasebni: KeyObject };
function naprava(): Naprava {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const kljuc = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  return { id: idIzKljuca(kljuc), kljuc, zasebni: privateKey };
}
function podpisi(d: Naprava, niz: (c: number, e: string) => string): Dokaz {
  const cas = Date.now();
  const e = randomBytes(16).toString("base64url");
  return { cas, enkratni: e, podpis: sign("sha256", Buffer.from(niz(cas, e)), d.zasebni).toString("base64") };
}
function zahteva(vrata: number, cert: string, odtis: string, metoda: string, pot: string, telo?: unknown): Promise<{ status: number; telo: string }> {
  return new Promise((ok, ne) => {
    const r = request({
      host: "127.0.0.1", port: vrata, method: metoda, path: pot, ca: cert, rejectUnauthorized: true,
      checkServerIdentity: (_h, c) => (c.fingerprint256.replace(/:/g, "").toLowerCase() === odtis ? undefined : new Error("odtis")),
      headers: telo === undefined ? {} : { "content-type": "application/json" },
    }, (res) => {
      let b = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (b += d));
      res.on("end", () => ok({ status: res.statusCode ?? 0, telo: b }));
    });
    r.on("error", ne);
    r.end(telo === undefined ? undefined : JSON.stringify(telo));
  });
}
const neIzvajalec: Izvajalec = { ime: "lazni", razpolozljiv: async () => true, zacni: async () => {}, odobri: async () => {}, ustavi: async () => {} };

describe("vprasanja agenta s telefona", () => {
  it("stanje in odgovor samo s podpisom naprave ozjega kroga; podpis veze id, odlocitev in zgostitev; enkratno", async () => {
    const ANA = naprava();
    const TUJA = naprava();
    const e = okolje();
    await pripraviKanal([{ id: ANA.id, kljuc: ANA.kljuc }], e.root);
    const s = new AsistentStreznik({
      root: e.root, izvajalec: neIzvajalec, dnevnik: () => {},
      vprasanjaAgentov: {
        stanje: async () => telefonVprasanja(e.root),
        odgovori: (id, odl, zg, nap) => telefonOdgovor(e.root, id, odl, zg, nap),
      },
    });
    const { vrata, odtis } = await s.zazeni();
    const { cert } = await potrdiloAsistenta(e.root);
    const z = (m: string, p: string, t?: unknown) => zahteva(vrata, cert, odtis, m, p, t);
    const q = (d: Naprava, p: Dokaz) => `${POT}/agent-vprasanja?posiljatelj=${d.id}&cas=${p.cas}&enkratni=${p.enkratni}&podpis=${encodeURIComponent(p.podpis)}`;
    try {
      await zazeniVLini(e.root, ID, lazniClaude(), "Naloga.", e.delovna, { PATH: process.env.PATH });
      await pocakaj(() => stanjeVprasanjZaRoot(e.root).vprasanja.find((x) => x.stanje === "caka"));
      const r = await z("GET", q(ANA, podpisi(ANA, (c, n) => nizStanjaVprasanj(ANA.id, c, n))));
      assert.equal(r.status, 200);
      const st = JSON.parse(r.telo) as { vprasanja: { id: string; zgostitev: string; stanje: string }[]; teki: { vticnica: unknown }[] };
      assert.equal(st.teki[0]!.vticnica, null, "telefon ne dobi poti vticnice");
      const v = st.vprasanja.find((x) => x.stanje === "caka")!;
      assert.equal((await z("GET", q(TUJA, podpisi(TUJA, (c, n) => nizStanjaVprasanj(TUJA.id, c, n))))).status, 403);
      const telo = (d: Naprava, odl: string, podpisanaOdl = odl) => ({
        posiljatelj: d.id, id: v.id, odlocitev: odl, zgostitev: v.zgostitev,
        ...podpisi(d, (c, n) => nizOdgovoraVprasanja(d.id, v.id, podpisanaOdl, v.zgostitev, c, n)),
      });
      // tuja naprava, podpisan »zavrni« poslan kot »dovoli«: 403, vprasanje ostane odprto
      assert.equal((await z("POST", `${POT}/agent-vprasanje/odgovor`, telo(TUJA, "dovoli"))).status, 403);
      assert.equal((await z("POST", `${POT}/agent-vprasanje/odgovor`, telo(ANA, "dovoli", "zavrni"))).status, 403);
      assert.equal(stanjeVprasanjZaRoot(e.root).vprasanja.find((x) => x.id === v.id)!.stanje, "caka");
      assert.equal((await z("POST", `${POT}/agent-vprasanje/odgovor`, telo(ANA, "dovoli"))).status, 202);
      // drugi odgovor (nov podpis) na zaprto vprasanje: 409
      const r2 = await z("POST", `${POT}/agent-vprasanje/odgovor`, telo(ANA, "zavrni"));
      assert.equal(r2.status, 409);
      const t = await pocakaj(() => stanjeVprasanjZaRoot(e.root).teki.find((x) => x.stanje !== "tece"));
      assert.ok(t.vrstice.some((x) => /odlocitev=allow/.test(x)), t.vrstice.join("\n"));
      const dn = readFileSync(path.join(e.root, DNEVNIK_ODLOCITEV), "utf8").trim().split("\n").map((x) => JSON.parse(x));
      assert.equal(dn[0].kdo, `naprava:${ANA.id}`);
    } finally {
      await s.ustavi();
    }
    for (const p of ["/agent-vprasanja", "/agent-vprasanje/odgovor"]) assert.equal(POTI_ODDALJENO.get(`${POT}${p}`), undefined);
  });
});
