/**
 * Opozorilo ob prvem zagonu (lastnik 24. 11. 2026): potrditev z razlicico besedila (0600); brez nje streznik zavrne sprejem
 * klicev (Twilio/Live, SIP, telefon) in zagon agentov (Claude Code naloge); stalno v Nastavitve > O Lini.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { ukazClaudeNalog, type Odvisnosti } from "./claude-naloge.server.ts";
import { sprejemTelefonaZOpozorilom } from "./live/telefon-zagon.server.ts";
import { DATOTEKA_OPOZORILA, RAZLICICA_OPOZORILA, opozoriloPotrjeno, potrdiOpozorilo } from "./opozorilo.server.ts";
import { pravaOdvisnostSluzbe } from "./sip/sluzba-sip.server.ts";
import { loadLine } from "./service.server.ts";
import { sprostiAktivniKlic } from "./voice.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-opozorilo-"));
after(() => rmSync(KOREN, { recursive: true, force: true }));
let st = 0;
function mapa(): string {
  const d = path.join(KOREN, `m${st++}`);
  mkdirSync(d, { recursive: true });
  return d;
}
const izvor = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

it("brez potrditve ni potrjeno; potrditev zapise razlicico v datoteko 0600", async () => {
  const d = mapa();
  assert.equal(await opozoriloPotrjeno(d), false);
  await potrdiOpozorilo(d, new Date("2026-11-24T08:00:00Z"));
  assert.equal(await opozoriloPotrjeno(d), true);
  const f = path.join(d, DATOTEKA_OPOZORILA);
  assert.equal(statSync(f).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(f, "utf8")), { razlicica: RAZLICICA_OPOZORILA, cas: "2026-11-24T08:00:00.000Z" });
});

it("potrditev STARE razlicice besedila ne velja (ob spremembi besedila znova); pokvarjena datoteka ne velja", async () => {
  const d = mapa();
  writeFileSync(path.join(d, DATOTEKA_OPOZORILA), JSON.stringify({ razlicica: "2026-01-01" }));
  assert.equal(await opozoriloPotrjeno(d), false);
  writeFileSync(path.join(d, DATOTEKA_OPOZORILA), "{ni json");
  assert.equal(await opozoriloPotrjeno(d), false);
});

it("SIP: brez potrditve sprejem vrne 503 (zavrnjeno pred vsemi drugimi pogoji); po potrditvi gre naprej (linija zaprta = 480)", async () => {
  const d = mapa();
  const odv = pravaOdvisnostSluzbe(d);
  const brez = await odv.sprejem("SIPopoz1");
  assert.equal(brez.ok, false);
  assert.equal(!brez.ok && brez.status, 503);
  await potrdiOpozorilo(d);
  const z = await odv.sprejem("SIPopoz2");
  assert.equal(!z.ok && z.status, 480);
});

it("telefon: odprta linija v delovnem casu - brez potrditve »zaprto«, po potrditvi sprejme; vstop prikljucka uporablja varovano funkcijo", async () => {
  const d = mapa();
  const osnova = await loadLine(d);
  writeFileSync(path.join(d, "line.json"), JSON.stringify({ ...osnova, open: true, catalog: { ...osnova.catalog, company: { ...osnova.catalog.company, hours: "pon–pet 8.00–16.00" } } }));
  const torek10 = () => new Date(2026, 10, 17, 10, 0);
  assert.equal(await sprejemTelefonaZOpozorilom(d, "tel-1", torek10), "zaprto");
  await potrdiOpozorilo(d);
  assert.equal(await sprejemTelefonaZOpozorilom(d, "tel-2", torek10), null);
  sprostiAktivniKlic(d, "tel-2");
  assert.match(izvor("./live/telefon-zagon.server.ts"), /sprejem:\s*\(sid\)\s*=>\s*sprejemTelefonaZOpozorilom\(root, sid\)/);
});

it("Twilio/Live (/api/voice/$): POST in GET zavrneta brez potrditve opozorila", () => {
  const route = izvor("../../routes/api/voice/$.ts");
  const vrata = route.match(/if \(!\(await soglasjeDano\(\)\) \|\| !\(await opozoriloPotrjeno\(\)\)\) return new Response\(/g) ?? [];
  assert.equal(vrata.length, 2, "obe vrati (POST in GET) preverita opozorilo");
});

it("agenti: potrditev naloge Claude Code brez opozorila ne zazene nicesar (razlog »opozorilo«), s potrditvijo zazene", async () => {
  const osnova = mapa();
  const dom = path.join(osnova, "dom");
  const podatki = path.join(osnova, "podatki");
  const projekt = path.join(dom, "projekt");
  mkdirSync(projekt, { recursive: true });
  mkdirSync(podatki, { recursive: true });
  const token = await setupOwner("geslo-test-1234", podatki);
  const zagoni: string[] = [];
  const o: Odvisnosti = {
    dom,
    platforma: "linux",
    najdi: (p) => (p === "x-terminal-emulator" || p === "claude" ? `/usr/bin/${p}` : null),
    razresi: (p) => (p.endsWith("/x-terminal-emulator") ? "/usr/bin/xterm" : p),
    // prenos vec agentov (24. 11. 2026): agent je v izbiri samo po preverbi zagona brez okna; lazni /usr/bin/claude se ne sme zagnati
    preveriZagon: async () => ({ koda: 0, izpis: "2.1.331 (Claude Code)", potekel: false }),
    zazeni: async (program) => {
      zagoni.push(program);
    },
  };
  const s = await ukazClaudeNalog(token, { ukaz: "pripravi", mapa: projekt, besedilo: "Preglej README." }, podatki, o);
  const n = s.naloge[0];
  await assert.rejects(ukazClaudeNalog(token, { ukaz: "potrdi", id: n.id, zgostitev: n.zgostitev }, podatki, o), /opozorilo/);
  assert.deepEqual(zagoni, []);
  await potrdiOpozorilo(podatki);
  await ukazClaudeNalog(token, { ukaz: "potrdi", id: n.id, zgostitev: n.zgostitev }, podatki, o);
  assert.equal(zagoni.length, 1);
});
