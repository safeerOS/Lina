// Naloga 11 (25. 11. 2026): Lina o sebi (različica, funkcije) in o nalogah za računalnik trdi samo, kar potrdi program.
// Lastnik: Lina je trdila »različica iz 23. novembra« (nameščena je bila 0.2.11) in »Pošiljam nalogo … mapa 'Lina-Project'«, ki ni obstajala.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { NAVODILO_ASISTENTA, asistentPogovor, obdelajClaudeCode, sestaviAsistenta } from "./asistent-pogovor.server.ts";
import { setupOwner } from "./auth.server.ts";
import { shraniLastniStreznik } from "./keys.server.ts";
import { FUNKCIJE_LINE, navodiloOSebi, odgovorORazlicici, razlicicaLine, vprasanjeORazlicici } from "./o-sebi.server.ts";

const trdiPosiljanje = /po[sš]iljam|poslala|predala|predajam/i;

test("vprašanje o različici: prepozna naravne oblike, ne pa drugih vprašanj", () => {
  for (const v of ["Katera različica si?", "katero verzijo imaš nameščeno", "Kakšna je tvoja različica?", "Which version are you?"]) assert.ok(vprasanjeORazlicici(v), v);
  for (const v of ["Katera različica Pythona je na računalniku?", "Pošlji nalogo računalniku", "Kaj je novega v Androidu 16?",
    "Katero verzijo ponudbe naj pošljem stranki?", "Katera različica dokumenta je zadnja?", "Katero različico si želiš za stran?"]) assert.ok(!vprasanjeORazlicici(v), v);
});

test("odgovor o različici: prava različica iz nameščenega paketa z virom; brez podatka ne ugiba", () => {
  const z = odgovorORazlicici("0.2.11");
  assert.match(z, /0\.2\.11/);
  assert.match(z, /nameščen/);
  assert.match(odgovorORazlicici(null), /ne vem/i);
  assert.doesNotMatch(odgovorORazlicici(null), /\d+\.\d+\.\d+/);
});

test("različica: bere se iz nameščenega paketa (dpkg lina-lupina), enkrat na proces", async () => {
  let klicev = 0;
  const izvedi = async (p: string, a: string[]) => { klicev++; assert.equal(p, "/usr/bin/dpkg-query"); assert.ok(a.includes("lina-lupina")); return "0.2.11"; };
  assert.equal(await razlicicaLine({ izvedi, sveze: true }), "0.2.11");
  assert.equal(await razlicicaLine({ izvedi }), "0.2.11");
  assert.equal(klicev, 1);
  assert.equal(await razlicicaLine({ izvedi: async () => { throw new Error("ni dpkg"); }, sveze: true }), null);
});

test("navodilo modelu: različica in seznam funkcij iz paketa; zastarelo »Zdaj znaš …« ne obstaja več", () => {
  const n = navodiloOSebi("0.2.11");
  assert.match(n, /0\.2\.11/);
  for (const f of FUNKCIJE_LINE) assert.ok(n.includes(f.ime), f.ime);
  assert.match(navodiloOSebi(null), /različice ne poznaš/i);
  assert.doesNotMatch(NAVODILO_ASISTENTA, /Zdaj znaš pogovor, sprejem nalog ter opomnike/);
});

test("seznam funkcij: vsaka funkcija ima modul v nameščeni kodi (seznam ne trdi česa, česar ni)", () => {
  for (const f of FUNKCIJE_LINE) assert.ok(existsSync(path.join(import.meta.dirname, f.modul)), `${f.ime}: ${f.modul}`);
});

test("naloga z izmišljeno mapo: Lina vpraša za pravo pot; model ne more trditi, da je poslala", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lina-11-"));
  const odgovor = "Pošiljam nalogo računalniku.\n[[claude-code: /nikjer/Lina-Project | popravi prijavo; merilo: preizkusi uspejo]]";
  const r = await obdelajClaudeCode(root, odgovor, true);
  assert.doesNotMatch(r, trdiPosiljanje);
  assert.match(r, /Lina-Project/);
  assert.match(r, /prav\w* pot/);
  const r2 = await obdelajClaudeCode(root, "Poslala sem nalogo.\n[[claude-code: Lina-Project | popravi prijavo]]", true);
  assert.doesNotMatch(r2, trdiPosiljanje);
  assert.match(r2, /prav\w* pot/);
});

test("naloga s pravo mapo: ostane predlog (ali zavrnitev programa), trditve modela o pošiljanju ni", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lina-11-"));
  const r = await obdelajClaudeCode(root, "Nalogo sem predala Claude Code. Popravila bom prijavo.\n[[claude-code: /tmp | popravi prijavo]]", true);
  assert.doesNotMatch(r, trdiPosiljanje);
  assert.match(r, /Popravila bom prijavo/);
});

test("sestaviAsistenta: odsek O SEBI je v navodilu za vse poti (pogovor in priponke), z različico ali »ne poznaš«", () => {
  assert.match(sestaviAsistenta([], "Živjo", undefined, undefined, [], "", "", { razlicica: "0.2.11" }).system, /O SEBI[^]*0\.2\.11/);
  assert.match(sestaviAsistenta([], "Živjo", undefined, undefined, []).system, /O SEBI[^]*različice ne poznaš/i);
});

test("prava pot asistentPogovor: vprašanje o različici dobi odgovor iz paketa brez modela; drugo vprašanje dobi O SEBI v navodilu", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-11-pot-"));
  const staro = process.env.LINA_DATA;
  const praviFetch = globalThis.fetch;
  process.env.LINA_DATA = dir;
  try {
    const token = await setupOwner("geslo-test-1234", dir);
    await shraniLastniStreznik({ naslov: "http://127.0.0.1:3192/v1", key: "izmisljen-kljuc-za-preizkus-1111", model: "auto", uporabiZaPogovor: true }, token, dir);
    await razlicicaLine({ izvedi: async () => "9.8.7", sveze: true });
    const sistemi: string[] = [];
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
      const telo = JSON.parse(String(init?.body ?? "{}")) as { messages?: { role: string; content: string }[] };
      sistemi.push(telo.messages?.find((m) => m.role === "system")?.content ?? "");
      return new Response(JSON.stringify({ choices: [{ message: { content: "Sem različica iz 23. novembra." }, finish_reason: "stop" }] }), { status: 200 });
    }) as typeof fetch;
    const r1 = await asistentPogovor("Katera različica si?", token, dir);
    assert.equal(sistemi.length, 0, "model ne sme odgovarjati o različici");
    assert.match(r1.zgodovina.at(-1)!.besedilo, /9\.8\.7/);
    await asistentPogovor("Kako si danes?", token, dir);
    assert.equal(sistemi.length, 1);
    assert.match(sistemi[0]!, /O SEBI[^]*9\.8\.7/);
  } finally {
    globalThis.fetch = praviFetch;
    if (staro === undefined) delete process.env.LINA_DATA; else process.env.LINA_DATA = staro;
    await razlicicaLine({ izvedi: async () => { throw new Error("ponastavi"); }, sveze: true });
  }
});
