/**
 * Slepi pregled sklopa 0213 (pregled-0213-slepi/NAJDBE-racunalnik.md), naloga 3: preizkusi najdb, ki nimajo boljsega doma.
 * Vsak preizkus je na izvirniku (3006ef4) padel; dnevniki rdecih tekov: sklop-0213/dnevniki/n3-racunalnik-<id>-rdece.log.
 * Nevidni znaki so sestavljeni s String.fromCodePoint (v izvoru ni nobenega skritega znaka).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { obdelajClaudeCode } from "./asistent-pogovor.server.ts";
import { cisto, predogledVnosa } from "./vprasanja-agentov.ts";

const z = (...k: number[]) => String.fromCodePoint(...k);
const TRDITEV = /Poslala sem nalogo/;

test("pregled 0213 B1: trditev »poslala sem nalogo« brez oznake ne pride do lastnika; program pove, da naloga ni bila oddana", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lina-b1-"));
  const r = await obdelajClaudeCode(root, "Poslala sem nalogo računalniku. Rezultat dobite kmalu.", true);
  assert.doesNotMatch(r, TRDITEV);
  assert.match(r, /Rezultat dobite kmalu\./);
  assert.match(r, /ni bila nikamor oddana/);
});

test("pregled 0213 B1: pri priponkah (oznaka se ne uporabi) trditev o poslani nalogi odpade", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lina-b1-"));
  const r = await obdelajClaudeCode(root, "Poslala sem nalogo računalniku.\n[[claude-code: /tmp | popravi prijavo]]", false);
  assert.doesNotMatch(r, TRDITEV);
  assert.doesNotMatch(r, /claude-code/);
});

test("pregled 0213 B1: obicajen odgovor brez trditve ostane nespremenjen do bajta (tudi dvojni presledki in prazne vrstice)", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lina-b1-"));
  const o = "Naloga za jutri:  kupi kruh.\n\n\nRačunalnik je prižgan.";
  assert.equal(await obdelajClaudeCode(root, o, true), o);
  assert.equal(await obdelajClaudeCode(root, o, false), o);
  // tretja oseba in prihodnjik nista trditev Line, da je ze poslala
  for (const s of ["Stranka je poslala naročilo za računalnik.", "Gradnjo bom zagnala na računalniku, ko potrdite.", "Kolegica je predala nalogo včeraj."]) {
    assert.equal(await obdelajClaudeCode(root, s, true), s, s);
  }
  // druga oznaka (gradnja, n8n): trditev odpade, opombe programa ni (izid pove naslednji korak)
  const g = await obdelajClaudeCode(root, "Poslala sem nalogo računalniku.\n[[gradnja: lina | apk]]", true);
  assert.doesNotMatch(g, TRDITEV);
  assert.doesNotMatch(g, /nikamor oddana/);
  assert.match(g, /\[\[gradnja: lina \| apk\]\]/);
});

test("pregled 0213 B2: neobstojeca mapa iz modela s skritimi znaki (U+202E) se lastniku ne izpise", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lina-b2-"));
  const mapa = `/nikjer/racun${z(0x202e)}fdp.exe`;
  const r = await obdelajClaudeCode(root, `[[claude-code: ${mapa} | popravi]]`, true);
  assert.ok(!r.includes(z(0x202e)), "znak za smer besedila ne sme v sporocilo lastniku");
  assert.match(r, /skritimi znaki/);
});

test("pregled 0213 C1: licence RNNoise in ovoja so v extraResources paketa deb; CI preveri licence in kodo RNNoise v svezenju", () => {
  const beri = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const viri = (JSON.parse(beri("../../../lupina/package.json")) as { build: { extraResources: { from: string; to: string; filter?: string[] }[] } }).build.extraResources;
  const r = viri.find((x) => x.from === "../vendor/rnnoise-wasm");
  assert.ok(r, "vendor/rnnoise-wasm manjka v extraResources");
  assert.equal(r.to, "lina/vendor/rnnoise-wasm");
  for (const f of ["LICENSE", "COPYING-RNNOISE", "NOTICE"]) {
    assert.ok(!r.filter || r.filter.includes(f), f);
    assert.ok(existsSync(new URL(`../../../vendor/rnnoise-wasm/${f}`, import.meta.url)), `${f} v repozitoriju`);
  }
  const ci = beri("../../../.github/workflows/racunalnik.yml");
  for (const f of ["LICENSE", "COPYING-RNNOISE", "NOTICE"]) assert.ok(ci.includes(`resources/lina/vendor/rnnoise-wasm/${f}$`), `CI preveri ${f}`);
  assert.match(ci, /grep -rqs 'rnnoise_process_frame' "\$X\/opt\/Lina\/resources\/lina\/\.output\/server"/, "CI preveri, da je koda RNNoise v svezenju streznika");
  assert.ok(readFileSync(new URL("../../../vendor/rnnoise-wasm/rnnoise.js", import.meta.url), "utf8").includes('"rnnoise_process_frame"'), "iskani niz je dobesedni niz v rnnoise.js");
});

test("pregled 0213 B7: vprasanja agenta so vidna izven zavihka Racunalnik - znacka v meniju in obvestilo namizja (sl in en)", async () => {
  const { cakajocaVprasanja } = (await import("../../components/lina2/okvir-meni.ts")) as { cakajocaVprasanja?: (s: unknown) => number };
  assert.equal(typeof cakajocaVprasanja, "function", "stevec cakajocih vprasanj v okvir-meni.ts");
  assert.equal(cakajocaVprasanja!({ vprasanja: [{ stanje: "caka" }, { stanje: "odgovorjeno" }, { stanje: "caka" }] }), 2);
  assert.equal(cakajocaVprasanja!(null), 0);
  const okvir = readFileSync(new URL("../../components/lina2/okvir.tsx", import.meta.url), "utf8");
  assert.match(okvir, /stanjeVprasanjAgentovFn\(\)/, "okvir (vedno odprt) bere vprasanja, ne samo zavihek Racunalnik");
  assert.match(okvir, /n\.id === "racunalnik" && vprasanj > 0 \? <span className="lina2-znacka-st"/);
  assert.match(okvir, /new Notification\(t2\("obvestiloVprasanjaNaslov"\)/);
  const { t2 } = await import("../../components/lina2/besedila.ts");
  for (const k of ["navVprasanjaAgenta", "obvestiloVprasanjaNaslov", "obvestiloVprasanjaTelo"] as const) {
    assert.ok(t2(k, "sl").length > 0 && t2(k, "en").length > 0 && t2(k, "sl") !== t2(k, "en"), k);
  }
});

test("pregled 0213 B5: gumb pri zamenjavi Safeer OS ne obljublja ponovnega zagona (je samo navodilo) in navodilo zapre", async () => {
  const { t } = await import("./besedila.ts");
  assert.doesNotMatch(t("posZnovaZazeni", "sl"), /Znova zaženi/);
  assert.doesNotMatch(t("posZnovaZazeni", "en"), /^Restart/);
  const desk = readFileSync(new URL("../../components/lina-desk.tsx", import.meta.url), "utf8");
  assert.match(desk, /aria-controls="pos-znova-navodilo" onClick=\{\(\) => setNavodilo\(\(v\) => !v\)\}/, "aria-expanded mora lahko postati false");
});

test("pregled 0213 B6: opis stikala Global Link nasteje vse, kar je od zunaj dosegljivo (POTI_ODDALJENO), v sl in en", async () => {
  const { t } = await import("./besedila.ts");
  const { POT, POTI_ODDALJENO } = await import("./asistent-streznik.server.ts");
  const sl = t("telGlobalLinkNamig", "sl");
  const en = t("telGlobalLinkNamig", "en");
  if (POTI_ODDALJENO.has(`${POT}/agent-naloga/dodeli`)) { assert.match(sl, /agent/); assert.match(en, /agent/); }
  if (POTI_ODDALJENO.has(`${POT}/gradnja/apk`)) { assert.match(sl, /gradnj[^.]*APK/); assert.match(en, /build[^.]*APK/); }
  if (POTI_ODDALJENO.has(`${POT}/agent-vprasanja`)) { assert.match(sl, /vprašanja/); assert.match(en, /questions/); }
});

test("pregled 0213 A5: cisto in predogled vnosa zajameta vse nevidne znake (ne samo U+200B-U+200F, U+202A-U+202E, U+2066-U+2069)", () => {
  for (const k of [0x2060, 0x2061, 0x2064, 0xfeff, 0x00ad, 0x180e, 0x034f, 0x3164, 0x115f, 0xe0041, 0xe007f, 0x0085]) {
    const s = `ls /tmp/a${z(k)}b`;
    assert.equal(cisto(s), "ls /tmp/ab", `U+${k.toString(16).toUpperCase()}`);
    assert.equal(predogledVnosa({ command: s }).odrezano, true, `U+${k.toString(16).toUpperCase()} mora onemogociti »dovoli«`);
  }
  // obicajno besedilo s sumniki, tabom in novo vrstico ostane
  assert.equal(cisto("čšž\tA\nB"), "čšž\tA\nB");
  assert.equal(predogledVnosa({ command: "echo čšž" }).odrezano, false);
});
