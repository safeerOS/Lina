/**
 * Naloga 18: odpiranje seje Claude Code s kanalom Line (seja-claude.server.ts) z laznim terminalom. Stalen ukaz brez besedila naloge,
 * mapa seje po pravilih, ena seja naenkrat, ni-terminala / ni-claude, omejitev poskusov (brez zanke). Vrednosti izmisljene.
 */
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, mkdirSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { IME_MAPE_SEJE, NAJVEC_POSKUSOV, POZIV_SEJE, ROK_ODPIRANJA_MS, odpriSejoClaude, ponastaviSejo, type OdvisnostiSeje } from "./seja-claude.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-n18s-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
let n = 0;
function okolje(extra: Partial<OdvisnostiSeje> = {}) {
  const d = path.join(KOREN, `t${n++}`);
  const root = path.join(d, "podatki");
  const dom = path.join(d, "dom");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  mkdirSync(dom, { recursive: true });
  const zagoni: Array<{ program: string; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv }> = [];
  let ura = 1_000_000;
  const o: OdvisnostiSeje = {
    platforma: "linux", dom, zdaj: () => ura, zivi: () => false,
    najdi: (x) => (x === "xterm" || x === "claude" ? `/usr/bin/${x}` : null),
    zazeni: async (program, args, cwd, env) => { zagoni.push({ program, args, cwd, env }); return 4242; },
    ...extra,
  };
  ponastaviSejo(root);
  return { root, dom, zagoni, o, premakni: (ms: number) => { ura += ms; } };
}

test("stalen ukaz: terminal + claude s kanalom Line, stalen poziv, mapa seje pod domom (0700), MCP nastavitev v podatkih", async () => {
  const { root, dom, zagoni, o } = okolje();
  assert.deepEqual(await odpriSejoClaude(root, o), { ok: true });
  assert.equal(zagoni.length, 1);
  const z = zagoni[0];
  assert.equal(z.program, "/usr/bin/xterm");
  // poziv pred variadicnima moznostma (sicer bi ga --dangerously-load-development-channels prebral kot streznik)
  assert.deepEqual(z.args.slice(-6), ["/usr/bin/claude", POZIV_SEJE, "--mcp-config", path.join(root, "kanal", "seja-mcp.json"), "--dangerously-load-development-channels", "server:lina"]);
  assert.equal(z.cwd, path.join(dom, IME_MAPE_SEJE));
  assert.equal(statSync(z.cwd).mode & 0o777, 0o700);
  const mcp = JSON.parse(readFileSync(path.join(root, "kanal", "seja-mcp.json"), "utf8"));
  assert.equal(mcp.mcpServers.lina.env.LINA_DATA, root);
  assert.equal(statSync(path.join(root, "kanal", "seja-mcp.json")).mode & 0o777, 0o600);
  // brez skrivnosti v okolju agenta
  for (const k of Object.keys(z.env)) assert.doesNotMatch(k, /^(ANTHROPIC|OPENAI|GITHUB_TOKEN|SSH_AUTH_SOCK|LINA_)/);
});

test("ena seja naenkrat: hkratni in zaporedni klici v roku odpiranja ne odprejo drugega terminala; po roku in mrtvem PID znova", async () => {
  const { root, zagoni, o, premakni } = okolje();
  const [a, b] = await Promise.all([odpriSejoClaude(root, o), odpriSejoClaude(root, o)]);
  assert.deepEqual([a, b], [{ ok: true }, { ok: true }]);
  assert.equal(await odpriSejoClaude(root, o).then((x) => x.ok), true);
  assert.equal(zagoni.length, 1);
  premakni(ROK_ODPIRANJA_MS + 1);
  await odpriSejoClaude(root, o);
  assert.equal(zagoni.length, 2);
  // zivi PID terminala: tudi po roku ni nove seje
  const ziv = okolje({ zivi: () => true });
  await odpriSejoClaude(ziv.root, ziv.o);
  ziv.premakni(ROK_ODPIRANJA_MS + 1);
  await odpriSejoClaude(ziv.root, ziv.o);
  assert.equal(ziv.zagoni.length, 1);
});

test("ni terminala / ni claude: razlog, brez zagona; omejitev poskusov ustavi zanko zagonov", async () => {
  const t = okolje({ najdi: (x) => (x === "claude" ? "/usr/bin/claude" : null) });
  assert.deepEqual(await odpriSejoClaude(t.root, t.o), { ok: false, razlog: "ni-terminala" });
  const c = okolje({ najdi: (x) => (x === "xterm" ? "/usr/bin/xterm" : null) });
  assert.deepEqual(await odpriSejoClaude(c.root, c.o), { ok: false, razlog: "ni-claude" });
  assert.equal(t.zagoni.length + c.zagoni.length, 0);
  // terminal se vsakic konca z napako: najvec NAJVEC_POSKUSOV zagonov, nato »omejitev«
  const p = okolje({ zazeni: async () => { p.zagoni.push({ program: "", args: [], cwd: "", env: {} }); throw new Error("terminal se je koncal (1)"); } });
  const izidi: string[] = [];
  for (let i = 0; i < NAJVEC_POSKUSOV + 3; i++) {
    const r = await odpriSejoClaude(p.root, p.o);
    izidi.push(r.ok ? "ok" : r.razlog);
    p.premakni(1000);
  }
  assert.equal(p.zagoni.length, NAJVEC_POSKUSOV);
  assert.deepEqual(izidi.slice(-3), ["omejitev", "omejitev", "omejitev"]);
});

test("mapa seje, ki je simbolna povezava ali v podatkih Line, se ne uporabi", async () => {
  const s = okolje();
  const drugam = path.join(KOREN, `drugam-${n}`);
  mkdirSync(drugam);
  symlinkSync(drugam, path.join(s.dom, IME_MAPE_SEJE));
  assert.deepEqual(await odpriSejoClaude(s.root, s.o), { ok: false, razlog: "napaka" });
  assert.equal(s.zagoni.length, 0);
  // obstojeca mapa seje, v katero lahko pisejo drugi (slepi pregled 18 N4): ne uporabi se
  const w = okolje();
  mkdirSync(path.join(w.dom, IME_MAPE_SEJE), { mode: 0o777 });
  chmodSync(path.join(w.dom, IME_MAPE_SEJE), 0o777);
  assert.deepEqual(await odpriSejoClaude(w.root, w.o), { ok: false, razlog: "napaka" });
  assert.equal(w.zagoni.length, 0);
  // dom = podatki Line (mapa seje bi bila v podatkih)
  const p = okolje();
  assert.deepEqual(await odpriSejoClaude(p.root, { ...p.o, dom: p.root }), { ok: false, razlog: "napaka" });
  assert.equal(p.zagoni.length, 0);
});
