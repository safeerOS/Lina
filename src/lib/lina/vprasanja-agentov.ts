/**
 * Vprasanja agenta v Lini (naloga 23, del 1; lastnik 23. in 25. 11. 2026: »neposreden vpogled v vprasanja in delo Claude Code-a«).
 *
 * Lina zazene Claude Code brez okna (-p, --output-format stream-json) z orodjem za dovoljenja (--permission-prompt-tool), ki ga ponuja
 * majhen MCP streznik Line prek stdio (PROGRAM_POMOCNIKA). Pomocnik vprasanje poslje Lini prek Unix vticnice v mapi podatkov (0700) z
 * zetonom zagona; po vticnici gre SAMO vprasanje, odgovor da lastnik (racunalnik z geslom ali podpisan telefon), nikoli agent.
 * Samodejnega »da« ni: vsako vprasanje caka lastnika, rok = zavrnitev. Pravila allow iz nastavitev uporabnika in projekta se ne uporabijo
 * (--restricted, pregled 0213 A3); privzeto dovoljeno branje v delovni mapi ni vprasanje. Razvrstitev (razvrstiDejanje) samo oznaci nevarno za prikaz.
 * Brez stanja in brez omrezja (preizkusi: vprasanja-agentov.test.ts).
 */
import { createHash } from "node:crypto";
import path from "node:path";

/** Ime MCP streznika (ne »lina«: to je kanal Claude Code, IME_KANALA). Samo crke, da ga Claude Code ne preimenuje v imenu orodja. */
export const IME_STREZNIKA_VPRASANJ = "linavprasanja";
export const IME_ORODJA_VPRASANJ = "dovoljenje";
/** Vrednost za --permission-prompt-tool: mcp__<streznik>__<orodje>. */
export const ORODJE_DOVOLJENJA = `mcp__${IME_STREZNIKA_VPRASANJ}__${IME_ORODJA_VPRASANJ}`;
export const DNEVNIK_ODLOCITEV = "vprasanja-agentov-odlocitve.jsonl";
export const MAPA_VPRASANJ = "vpr";
/** Rok za odgovor lastnika; potem zavrnitev. Claude Code dobi daljsi rok orodja MCP (MCP_TOOL_TIMEOUT), da ga ne prehiti. */
export const ROK_VPRASANJA_MS = 10 * 60_000;
export const ROK_ORODJA_MCP_MS = ROK_VPRASANJA_MS + 5 * 60_000;
export const NAJVEC_ODPRTIH_VPRASANJ = 20;
export const NAJVEC_VRSTIC_DNEVNIKA = 200;
export const NAJVEC_ZNAKOV_VRSTICE = 500;
/** Predogled na racunalniku je cel vnos do te meje (vrstica vticnice je 256 KB); daljsi se lahko samo zavrne. */
export const NAJVEC_PREDOGLED = 200_000;
/** Telefon dobi krajsi predogled; vnos, ki na telefonu ni ves viden, se s telefona lahko samo zavrne. */
export const NAJVEC_PREDOGLED_TELEFON = 4000;

export type Odlocitev = "dovoli" | "zavrni";
export type RazlogNevarnosti = "brisanje" | "git-push" | "sudo" | "omrezje" | "namescanje" | "zunaj-mape" | "nastavitve" | "sestavljen" | "neznano";

export class VprasanjeNapaka extends Error {
  readonly razlog: "ni-vprasanja" | "zgostitev" | "geslo" | "oblika" | "odrezano";
  constructor(razlog: VprasanjeNapaka["razlog"]) {
    super(razlog);
    this.razlog = razlog;
  }
}

/** Orodja seje v Lini (--restricted brez --tools odstrani Bash in WebFetch); ostala vgrajena orodja niso na voljo. */
export const ORODJA_CLAUDE_V_LINI = "Bash,Read,Edit,Write,MultiEdit,NotebookEdit,Glob,Grep,WebFetch,WebSearch,TodoWrite,Task";

/**
 * Argumenti za Claude Code. --permission-mode default: o vsem, kar ni privzeto dovoljeno, odloci orodje Line; nikoli --allowedTools ali
 * preskok dovoljenj. --strict-mcp-config: samo MCP Line (drugi strezniki iz nastavitev se ne zazenejo v seji brez okna).
 * Pregled 0213 A3: --restricted (Claude Code 2.1.331 --help) prezre nastavitve user, project in local - pravila allow iz
 * ~/.claude/settings.json in iz .claude/ projekta (ki ga agent lahko sam zapise) ne obidejo vprasanj Line; datotecna orodja so omejena
 * na delovno mapo, pisanje nastavitev, gita in orodij sme odobriti samo upravljalec dovoljenj (orodje Line). Upravljane nastavitve
 * organizacije veljajo se naprej. Kar Claude Code privzeto dovoli brez vprasanja (branje v delovni mapi), ne pride v Lino.
 */
export function argvClaudeVLini(poziv: string, mcpKonfig: string): string[] {
  return [
    "-p", poziv,
    "--output-format", "stream-json", "--verbose",
    "--permission-mode", "default",
    "--restricted",
    "--tools", ORODJA_CLAUDE_V_LINI,
    "--permission-prompt-tool", ORODJE_DOVOLJENJA,
    "--mcp-config", mcpKonfig, "--strict-mcp-config",
  ];
}

const BRISANJE = /(^|[\s;&|(`$\\/"'])(rm|rmdir|unlink|shred|truncate|dd|wipefs|mkfs[.\w]*)(\s|$)|\s-delete\b|\bgit\s+(clean|reset\s+--hard|checkout\s+--|restore)\b|(^|\s)mv\s/;
const PUSH = /\bgit\b[^\n]*\bpush\b/;
const SUDO = /(^|[\s;&|(`$\\/])(sudo|su|doas|pkexec|run0)(\s|$)/;
const OMREZJE = /(^|[\s;&|(`$\\/])(curl|wget|nc|ncat|netcat|ssh|scp|rsync|sftp|ftp|telnet|socat|gh)(\s|$)|https?:\/\//;
const NAMESCANJE = /\b(npm|pnpm|yarn|bun)\s+(i|install|add|ci)\b|\bnpx\b|\b(pip3?|pipx|uv)\s+(install|add)\b|\b(apt|apt-get|dnf|yum|pacman|snap|flatpak|brew|cargo|go)\s+(install|get|-S)\b|\bdpkg\s+-i\b/;
/** Lupina v lupini, tolmaci, preusmeritve in verige: vsebine ne moremo zanesljivo razbrati, zato vedno nevarno. */
const SESTAVLJEN = /[|;&`<>]|\$\(|\b(bash|sh|zsh|dash|fish|eval|exec|xargs|tee|env|python\d*|node|perl|ruby|php|deno|lua)\b|\b(awk|gawk|sed\s+-i|find\b.*-exec)\b|(^|\s)(-c|-e)\s/;
const ORODJA_PISANJA = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const ORODJA_OMREZJA = new Set(["WebFetch", "WebSearch"]);
const ORODJA_BRANJA = new Set(["Read", "Glob", "Grep", "LS"]);
const ZNANA_DRUGA = new Set(["TodoWrite", "Task", "ExitPlanMode", "ustvari_opomnik"]);
// naloga 19b N6: orodja orkestratorja F2 (Linin koledar je znan in varen; splet nese podatke ven; zapis je omejen na dovoljene mape lastnika,
// delovna mapa teka orkestratorja je prazna, zato zunaj-mape tu ne velja - oznaci se zapis nastavitev in izvrsljivih datotek)
// naloga 30: ustvari_sliko nese opis v lastnikov projekt Google (potrditev po branju zasebnih podatkov) - oznaka omrezje, ne neznano
const ORKESTRATOR_SPLET = new Set(["isci_splet", "preberi_stran", "ustvari_sliko"]);
const IZVRSLJIVO = /\.(?:sh|bash|zsh|fish|ps1|psm1|bat|cmd|exe|com|py|js|mjs|cjs|ts|tsx|jsx|rb|pl|php|jar|desktop|service)$|(?:^|[\\/])(?:Makefile|Dockerfile|Justfile)$/i;
/** Pisanje sem spremeni, kako se agent ali git obnasata pozneje (kljuke, pravila, MCP), zato je vedno nevarno. */
const NASTAVITVENE = /(^|\/)(\.claude|\.git|\.vscode|\.husky)(\/|$)|(^|\/)(\.mcp\.json|CLAUDE\.md|AGENTS\.md|\.envrc|package\.json)$/;

/** Ali je absolutna pot (po zapisu, normalize) v delovni mapi. */
function vMapi(p: string, delovna: string): boolean {
  if (!path.isAbsolute(p)) return false;
  const n = path.normalize(p);
  const d = path.normalize(delovna);
  return n === d || n.startsWith(d.endsWith(path.sep) ? d : d + path.sep);
}

/**
 * Oznaka za prikaz in dnevnik, NE odlocitev: vprasanje vedno caka lastnika. Bash: vsak sestavljen ukaz je nevaren (bash -c, xargs,
 * preusmeritve ...), ker zavrnitveni seznam obide ze najmanjsa ovojnica. Pisanje: samo absolutna pot v delovni mapi je varna.
 */
export function razvrstiDejanje(orodje: string, vnos: Record<string, unknown>, delovna: string): { nevarno: boolean; razlogi: RazlogNevarnosti[] } {
  const r = new Set<RazlogNevarnosti>();
  if (orodje === "Bash") {
    const c = typeof vnos.command === "string" ? vnos.command.normalize("NFKC") : "";
    if (!c) r.add("neznano");
    if (BRISANJE.test(c)) r.add("brisanje");
    if (PUSH.test(c)) r.add("git-push");
    if (SUDO.test(c)) r.add("sudo");
    if (OMREZJE.test(c)) r.add("omrezje");
    if (NAMESCANJE.test(c)) r.add("namescanje");
    if (SESTAVLJEN.test(c)) r.add("sestavljen");
  } else if (ORODJA_PISANJA.has(orodje)) {
    const p = typeof vnos.file_path === "string" ? vnos.file_path : typeof vnos.notebook_path === "string" ? vnos.notebook_path : "";
    // shortcut: primerjava po zapisu (normalize), ne po realpath; povezava v mapi, ki kaze ven, ni zaznana - oznaka je samo prikaz, odloca lastnik
    if (!vMapi(p, delovna)) r.add("zunaj-mape");
    if (NASTAVITVENE.test(path.normalize(p))) r.add("nastavitve");
  } else if (ORODJA_BRANJA.has(orodje)) {
    // branje zunaj mape (~/.ssh, mapa podatkov Line ...) lastnik vidi oznaceno; brez poti = delovna mapa
    const p = typeof vnos.file_path === "string" ? vnos.file_path : typeof vnos.path === "string" ? vnos.path : delovna;
    if (!vMapi(p, delovna)) r.add("zunaj-mape");
  } else if (orodje === "zapisi_datoteko") {
    const p = typeof vnos.pot === "string" ? vnos.pot : "";
    if (!p) r.add("neznano");
    if (NASTAVITVENE.test(path.normalize(p)) || IZVRSLJIVO.test(p)) r.add("nastavitve");
  } else if (ORODJA_OMREZJA.has(orodje) || ORKESTRATOR_SPLET.has(orodje)) {
    r.add("omrezje");
  } else if (!ZNANA_DRUGA.has(orodje)) {
    r.add("neznano");
  }
  const razlogi = [...r];
  return { nevarno: razlogi.length > 0, razlogi };
}

// eslint-disable-next-line no-control-regex
// Pregled 0213 A5: vsi oblikovni znaki (\p{Cf}: U+00AD, U+200B-U+200F, U+202A-U+202E, U+2060-U+206F, U+FEFF, oznake U+E0000-U+E007F ...),
// nadzorni C0/C1 in nevidna polnila (U+034F, U+115F, U+1160, U+17B4, U+17B5, U+180E, U+3164, U+FFA0); tab in nova vrstica ostaneta
const NADZORNI = /\u001b\[[0-9;?]*[A-Za-z]|[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Cf}\u034f\u115f\u1160\u17b4\u17b5\u180e\u3164\uffa0]/gu;
export function cisto(s: string, meja = NAJVEC_ZNAKOV_VRSTICE): string {
  return s.replace(NADZORNI, "").slice(0, meja);
}

/** Vrstica stream-json -> kratka vrstica dnevnika dela (ali null, ce je ni treba pokazati). Ne-JSON (stderr) ostane besedilo. */
export function vrsticaDnevnika(v: string): string | null {
  let z: Record<string, unknown>;
  try {
    z = JSON.parse(v) as Record<string, unknown>;
  } catch {
    const t = cisto(v).trim();
    return t || null;
  }
  if (!z || typeof z !== "object") return null;
  if (z.type === "system") return z.subtype === "init" ? "Zacetek seje" : null;
  if (z.type === "result") return `Konec: ${cisto(String(z.subtype ?? ""), 60)}${z.is_error ? " (napaka)" : ""}${typeof z.result === "string" && z.result ? ` - ${cisto(z.result, 400)}` : ""}`;
  if (z.type === "assistant") {
    const vsebina = (z.message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(vsebina)) return null;
    const deli = vsebina.map((k: { type?: unknown; text?: unknown; name?: unknown }) =>
      k?.type === "text" && typeof k.text === "string" ? cisto(k.text).trim() : k?.type === "tool_use" && typeof k.name === "string" ? `Orodje: ${cisto(k.name, 100)}` : "",
    ).filter(Boolean);
    return deli.length ? cisto(deli.join(" | ")) : null;
  }
  return null;
}

/**
 * Predogled vnosa orodja za prikaz in podpis. `odrezano`: celoten vnos ni viden (daljsi od meje ali z nadzornimi znaki) - tak vnos se ne sme
 * odobriti, ker bi lastnik odobril tudi tisto, cesar ni videl (pregled 25. 11., V2).
 */
export function predogledVnosa(vnos: unknown): { predogled: string; odrezano: boolean } {
  let s: string;
  try {
    s = JSON.stringify(vnos) ?? "";
  } catch {
    return { predogled: "", odrezano: true };
  }
  const predogled = cisto(s, NAJVEC_PREDOGLED);
  return { predogled, odrezano: predogled !== s };
}

/** Zgostitev celotnega vnosa (dnevnik odlocitev in zgostitev prikaza): odobritev velja natanko za ta vnos. */
export function zgostitevVnosa(vnos: unknown): string {
  return createHash("sha256").update(JSON.stringify(vnos) ?? "", "utf8").digest("hex");
}

const SKRIVNOST = /((?:authorization|bearer|token|password|passwd|geslo|secret|api[_-]?key|access[_-]?key|private[_-]?key)["']?\s*[:=]?\s*["']?(?:bearer\s+)?)[^\s"'&,;}]{4,}/gi;
/** Predogled za dnevnik odlocitev: krajsi in brez ocitnih skrivnosti (zeton, geslo, kljuc). */
export function predogledZaDnevnik(predogled: string): string {
  return predogled.replace(SKRIVNOST, "$1***").slice(0, 300);
}

/** Zgostitev prikazanega (id, naloga, orodje, predogled) in celotnega vnosa: odgovor velja samo za to, kar je lastnik videl. */
export function zgostitevVprasanja(v: { id: string; naloga: string; orodje: string; predogled: string; vnos: string }): string {
  return createHash("sha256").update(JSON.stringify([v.id, v.naloga, v.orodje, v.predogled, v.vnos]), "utf8").digest("hex");
}

/**
 * MCP streznik za Claude Code (stdio, JSON-RPC kot kanal-claude.server.ts brez SDK). Vsebuje ga Lina sama (zapise ga v mapo zagona), da ni
 * odvisen od poti namestitve. Odgovor sme biti samo allow/deny, ki ga vrne Lina; brez Line ali ob napaki je odgovor deny.
 */
export const PROGRAM_POMOCNIKA = `import { createConnection } from "node:net";
const VT = process.env.LINA_VPRASANJA_VTICNICA ?? "", ZETON = process.env.LINA_VPRASANJA_ZETON ?? "";
const IME = ${JSON.stringify(IME_ORODJA_VPRASANJ)};
const izpis = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const zavrni = (m) => ({ behavior: "deny", message: m });
function vprasaj(a) {
  return new Promise((r) => {
    const s = createConnection(VT);
    let b = "", konec = false;
    const k = (x) => { if (konec) return; konec = true; s.destroy(); r(x); };
    s.setEncoding("utf8");
    s.on("connect", () => s.write(JSON.stringify({ zeton: ZETON, orodje: String(a.tool_name ?? ""), vnos: a.input ?? {}, idUporabe: typeof a.tool_use_id === "string" ? a.tool_use_id : null }) + "\\n"));
    s.on("data", (d) => { b += d; const i = b.indexOf("\\n"); if (i >= 0) { try { k(JSON.parse(b.slice(0, i))); } catch { k(null); } } else if (b.length > 1e6) k(null); });
    s.on("error", () => k(null));
    s.on("close", () => k(null));
  });
}
async function obdelaj(v) {
  let z; try { z = JSON.parse(v); } catch { return; }
  if (!z || z.jsonrpc !== "2.0" || typeof z.method !== "string") return;
  const id = z.id, p = z.params ?? {};
  if (z.method === "initialize") {
    const znane = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
    return izpis({ jsonrpc: "2.0", id, result: { protocolVersion: znane.includes(p.protocolVersion) ? p.protocolVersion : znane[1], capabilities: { tools: {} }, serverInfo: { name: ${JSON.stringify(IME_STREZNIKA_VPRASANJ)}, version: "1.0.0" } } });
  }
  if (z.method === "ping") return izpis({ jsonrpc: "2.0", id, result: {} });
  if (z.method === "tools/list") return izpis({ jsonrpc: "2.0", id, result: { tools: [{ name: IME, description: "Vprasanje za dovoljenje: odloci lastnik v Lini.", inputSchema: { type: "object", properties: { tool_name: { type: "string" }, input: { type: "object" }, tool_use_id: { type: "string" } }, required: ["tool_name", "input"] } }] } });
  if (z.method === "tools/call") {
    if (p.name !== IME) return izpis({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "Neznano orodje." }], isError: true } });
    const r = await vprasaj(p.arguments ?? {});
    const o = r && r.behavior === "allow" && r.updatedInput && typeof r.updatedInput === "object" ? { behavior: "allow", updatedInput: r.updatedInput }
      : r && r.behavior === "deny" ? zavrni(String(r.message ?? "Zavrnjeno.").slice(0, 500)) : zavrni("Lina ni dosegljiva; dejanje je zavrnjeno.");
    return izpis({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(o) }] } });
  }
  if (id !== undefined && !z.method.startsWith("notifications/")) izpis({ jsonrpc: "2.0", id, error: { code: -32601, message: "Ni metode." } });
}
let b = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { b += d; let i; while ((i = b.indexOf("\\n")) >= 0) { const v = b.slice(0, i); b = b.slice(i + 1); void obdelaj(v); } if (b.length > 4e6) b = ""; });
process.stdin.on("end", () => process.exit(0));
`;
