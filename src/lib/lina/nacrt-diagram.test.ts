/**
 * Lina nacrtuje z diagramom (lastnik 24. 11. 2026, AGENTS.md »Lina nacrtuje z diagramom«). Oznaka nacrtovanja in prvi korak NACRT v
 * NALOGA.md, stikalo (privzeto vklopljeno), varno branje nacrt.html (iste ovire kot POROCILO.md + meja brez rezanja) in ovoj s CSP.
 * Vsak varnostni preizkus ima pozitivno kontrolo: obicajen nacrt.html se v istem preizkusu prebere, sele nato se podtakne povezava.
 */
import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import {
  DATOTEKA_NACRTA,
  DATOTEKA_NALOGE,
  MAPA_NALOG,
  NAJVEC_BAJTOV_NACRTA,
  OZNAKA_NACRTA,
  izluciPredloge,
  jeNacrtovanje,
  ovijNacrt,
  vsebinaNaloge,
} from "./claude-naloge.ts";
import { jeNacrtVklopljen, nacrtClaudeNaloge, nastaviNacrt, stanjeClaudeNalog, telefonStanjeNalog, ukazClaudeNalog, type Odvisnosti } from "./claude-naloge.server.ts";
import { potrdiOpozorilo } from "./opozorilo.server.ts";
import { SKILI_ASISTENTKE_MD } from "./skili-asistentka.generated.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-nacrt-diagram-"));
const ID = "0123456789abcdef";
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

async function okolje(ime: string) {
  const osnova = path.join(KOREN, ime);
  const dom = path.join(osnova, "dom");
  const podatki = path.join(osnova, "podatki");
  const projekt = path.join(dom, "projekt");
  mkdirSync(projekt, { recursive: true });
  mkdirSync(podatki, { recursive: true });
  const token = await setupOwner("geslo-test-1234", podatki);
  await potrdiOpozorilo(podatki);
  const o: Odvisnosti = {
    dom,
    platforma: "linux",
    najdi: (p) => (p === "x-terminal-emulator" || p === "claude" || p === "pi" ? `/usr/bin/${p}` : null),
    razresi: (p) => (p.endsWith("/x-terminal-emulator") ? "/usr/bin/xterm" : p),
    preveriZagon: async () => ({ koda: 0, izpis: "1.0.0", potekel: false }),
    zazeni: async () => undefined,
  };
  return { osnova, dom, podatki, projekt, token, o };
}

type Okolje = Awaited<ReturnType<typeof okolje>>;

/** Kje dela naloga: druga naloga v istem projektu dobi svojo kopijo (Lina kot vodja, A1 je ne zavrne). */
const delovna = new Map<string, string>();

/** Pripravi in potrdi nalogo (claude); vrne id. */
async function zazeni(e: Okolje, besedilo: string): Promise<string> {
  const s = await ukazClaudeNalog(e.token, { ukaz: "pripravi", mapa: e.projekt, besedilo }, e.podatki, e.o);
  const n = s.naloge[0]!;
  const s2 = await ukazClaudeNalog(e.token, { ukaz: "potrdi", id: n.id, zgostitev: n.zgostitev }, e.podatki, e.o);
  delovna.set(n.id, s2.naloge.find((x) => x.id === n.id)?.kopija ?? e.projekt);
  return n.id;
}

const potNacrta = (e: Okolje, id: string) => path.join(e.projekt, MAPA_NALOG, id, DATOTEKA_NACRTA);
const nalogaMd = (e: Okolje, id: string) => readFileSync(path.join(delovna.get(id) ?? e.projekt, MAPA_NALOG, id, DATOTEKA_NALOGE), "utf8");

describe("skil asistentke lina-vodja-projektov", () => {
  it("razlicica 2: pri vecji ali arhitekturni nalogi najprej nacrt z diagramom, koda po potrjenem nacrtu", () => {
    const s = SKILI_ASISTENTKE_MD.find((x) => x.ime === "lina-vodja-projektov");
    assert.match(s?.md ?? "", /razlicica: 2/);
    assert.match(s?.md ?? "", /najprej naroci nacrt z diagramom/);
    assert.match(s?.md ?? "", /koda sele po potrjenem nacrtu/);
  });
});

describe("nacrt z diagramom: oznaka nacrtovanja", () => {
  it("izrecna oznaka [nacrt] na zacetku besedila", () => {
    assert.equal(OZNAKA_NACRTA, "[nacrt]");
    assert.equal(jeNacrtovanje("[nacrt] Dodaj izvoz v CSV"), true);
    assert.equal(jeNacrtovanje("  [NACRT] dodaj izvoz"), true);
  });

  it("vecja ali arhitekturna naloga: beseda arhitektura/zasnova/nacrt, vec datotek, vec delov", () => {
    assert.equal(jeNacrtovanje("Predlagaj arhitekturo sinhronizacije med telefonom in racunalnikom"), true);
    assert.equal(jeNacrtovanje("Nova zasnova shrambe nalog"), true);
    assert.equal(jeNacrtovanje("Pripravi načrt za prenos podatkov"), true);
    assert.equal(jeNacrtovanje("Spremeni src/a.ts, src/b.ts in server/c.ts, da uporabljajo isto mejo"), true);
    assert.equal(jeNacrtovanje("Naredi:\n- streznik\n- vmesnik\n- preizkuse"), true);
    assert.equal(jeNacrtovanje("Naredi:\n1. streznik\n2. vmesnik\n3. preizkuse"), true);
  });

  it("Linina oznaka: [nacrt] v oznaki ne gre (] konca oznako), beseda »nacrt« pa naredi nalogo za nacrtovanje", () => {
    assert.deepEqual(izluciPredloge("[[claude-code: /home/a/p | [nacrt] x]]").predlogi, []);
    const r = izluciPredloge("[[claude-code: /home/a/p | Najprej nacrt z diagramom: prenovi shrambo nalog]]");
    assert.equal(r.predlogi.length, 1);
    assert.equal(jeNacrtovanje(r.predlogi[0]!.naloga), true);
  });

  it("majhna naloga ni nacrtovanje", () => {
    assert.equal(jeNacrtovanje("Popravi preizkus v src/a.test.ts; merilo konca: npm test zelen."), false);
    assert.equal(jeNacrtovanje("Popravi tipkarsko napako v README.md"), false);
    assert.equal(jeNacrtovanje("Naredi:\n- streznik\n- vmesnik"), false);
    assert.equal(jeNacrtovanje("Dodaj gumb [x] v obrazec na strani https://example.org/a/b"), false);
  });
});

describe("nacrt z diagramom: prvi korak NACRT v NALOGA.md", () => {
  const z = { id: ID, izvor: "lastnik" as const, besedilo: "[nacrt] Prenovi shrambo" };

  it("claude: skil diagram-design, nacrt.html v mapi naloge, ustavi z vrsta=\"vprasanje\", porocilo sele na koncu", () => {
    const v = vsebinaNaloge(z, new Date(0), { nacrt: "diagram-design" });
    const iNacrt = v.indexOf("## Prvi korak: NACRT");
    assert.ok(iNacrt > 0, "manjka korak NACRT");
    assert.ok(iNacrt < v.indexOf("## Naloga"), "NACRT mora biti pred nalogo");
    assert.ok(v.includes(`${MAPA_NALOG}/${ID}/${DATOTEKA_NACRTA}`));
    assert.match(v, /diagram-design/);
    assert.match(v, /vrsta="vprasanje"/);
    assert.match(v, /nadaljuj po moznosti/);
    assert.match(v, /trenutno stanje/);
    assert.match(v, /2-3 mozne resitve/);
    assert.match(v, /priporocilo/);
    assert.match(v, /brez <script>/);
    assert.match(v, /system-ui/);
    assert.match(v, /POROCILO\.md zapisi sele/);
  });

  it("agent brez skila: navodilo za preprost SVG v HTML po istih pravilih", () => {
    const v = vsebinaNaloge(z, new Date(0), { nacrt: "svg" });
    assert.match(v, /## Prvi korak: NACRT/);
    assert.doesNotMatch(v, /diagram-design/);
    assert.match(v, /preprost SVG/);
    assert.match(v, /brez <script>/);
  });

  it("brez nacrta ni koraka NACRT", () => {
    assert.doesNotMatch(vsebinaNaloge(z, new Date(0)), /NACRT/);
  });

  it("ovoj: CSP je prvi del dokumenta, nato nespremenjen nacrt", () => {
    const html = "<!doctype html><html><head><script>alert(1)</script></head><body><svg></svg></body></html>";
    const o = ovijNacrt(html);
    assert.ok(o.startsWith(`<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP}">`), o.slice(0, 120));
    assert.ok(o.endsWith(html));
  });
});

describe("nacrt z diagramom: zagon in stikalo", () => {
  it("stikalo je privzeto vklopljeno; naloga z oznako dobi NACRT, majhna ne", async () => {
    const e = await okolje("privzeto");
    assert.equal(await jeNacrtVklopljen(e.podatki), true);
    const id = await zazeni(e, "[nacrt] Prenovi shrambo nalog");
    assert.match(nalogaMd(e, id), /## Prvi korak: NACRT/);
    assert.match(nalogaMd(e, id), /diagram-design/);
    const majhna = await zazeni(e, "Popravi tipkarsko napako v README.md");
    assert.doesNotMatch(nalogaMd(e, majhna), /NACRT/);
  });

  it("izklopljeno stikalo: tudi naloga z oznako je brez NACRT; ponoven vklop ga vrne", async () => {
    const e = await okolje("izklop");
    assert.equal(await nastaviNacrt(false, e.podatki), false);
    assert.equal(await jeNacrtVklopljen(e.podatki), false);
    const id = await zazeni(e, "[nacrt] Prenovi shrambo nalog");
    assert.doesNotMatch(nalogaMd(e, id), /NACRT/);
    await nastaviNacrt(true, e.podatki);
    const id2 = await zazeni(e, "[nacrt] Prenovi shrambo nalog 2");
    assert.match(nalogaMd(e, id2), /## Prvi korak: NACRT/);
  });

  it("drug agent (pi) dobi navodilo za preprost SVG namesto skila diagram-design", async () => {
    const e = await okolje("pi");
    const s = await ukazClaudeNalog(e.token, { ukaz: "dodeli", agent: "pi", mapa: e.projekt, besedilo: "[nacrt] Prenovi shrambo", pogoj: "zdaj" }, e.podatki, e.o);
    const id = s.naloge[0]!.id;
    assert.match(nalogaMd(e, id), /## Prvi korak: NACRT/);
    assert.match(nalogaMd(e, id), /preprost SVG/);
    assert.doesNotMatch(nalogaMd(e, id), /diagram-design/);
  });

  it("pokvarjena datoteka nastavitve ne izklopi (privzeto vklopljeno ostane)", async () => {
    const e = await okolje("pokvarjena");
    writeFileSync(path.join(e.podatki, "nacrt-diagram.json"), "{ni json");
    assert.equal(await jeNacrtVklopljen(e.podatki), true);
  });
});

describe("nacrt z diagramom: varno branje nacrt.html", () => {
  it("obicajen nacrt se prebere in ovije s CSP; simbolna povezava na skrivnost se NE prebere", async () => {
    const e = await okolje("povezava");
    const id = await zazeni(e, "[nacrt] Prenovi shrambo");
    assert.equal((await stanjeClaudeNalog(e.token, e.podatki, e.o)).naloge[0]!.nacrt, false);
    writeFileSync(potNacrta(e, id), "<svg><text>NACRT-OK</text></svg>");
    const s = await stanjeClaudeNalog(e.token, e.podatki, e.o);
    assert.equal(s.naloge[0]!.nacrt, true);
    const ok = await nacrtClaudeNaloge(e.token, id, e.podatki);
    assert.ok(ok && ok.startsWith("<!doctype html><meta http-equiv=\"Content-Security-Policy\""));
    assert.ok(ok.includes("NACRT-OK"));
    // podtaknjena povezava
    rmSync(potNacrta(e, id));
    const skrivnost = path.join(e.osnova, "skrivnost.txt");
    writeFileSync(skrivnost, "ZASEBNI-KLJUC");
    symlinkSync(skrivnost, potNacrta(e, id));
    assert.equal(await nacrtClaudeNaloge(e.token, id, e.podatki), null);
    assert.equal((await stanjeClaudeNalog(e.token, e.podatki, e.o)).naloge[0]!.nacrt, false);
  });

  it("trda povezava na drugo datoteko se ne prebere", async () => {
    const e = await okolje("trda");
    const id = await zazeni(e, "[nacrt] Prenovi shrambo");
    writeFileSync(potNacrta(e, id), "<p>NACRT-OK</p>");
    assert.ok((await nacrtClaudeNaloge(e.token, id, e.podatki))?.includes("NACRT-OK"));
    rmSync(potNacrta(e, id));
    const skrivnost = path.join(e.osnova, "kljuc.txt");
    writeFileSync(skrivnost, "ZASEBNI-KLJUC");
    linkSync(skrivnost, potNacrta(e, id));
    assert.equal(await nacrtClaudeNaloge(e.token, id, e.podatki), null);
  });

  it("prevelik nacrt se ne prebere (in ne odreze); natanko na meji se prebere", async () => {
    const e = await okolje("velik");
    const id = await zazeni(e, "[nacrt] Prenovi shrambo");
    writeFileSync(potNacrta(e, id), "a".repeat(NAJVEC_BAJTOV_NACRTA));
    assert.equal((await nacrtClaudeNaloge(e.token, id, e.podatki))?.endsWith("a".repeat(NAJVEC_BAJTOV_NACRTA)), true);
    writeFileSync(potNacrta(e, id), "a".repeat(NAJVEC_BAJTOV_NACRTA + 1));
    assert.equal(await nacrtClaudeNaloge(e.token, id, e.podatki), null);
  });

  it("mapa naloge, zamenjana po zagonu, se ne bere; neznan id in tuja seja sta zavrnjena", async () => {
    const e = await okolje("zamenjava");
    const id = await zazeni(e, "[nacrt] Prenovi shrambo");
    const mapa = path.join(e.projekt, MAPA_NALOG, id);
    writeFileSync(potNacrta(e, id), "<p>NACRT-OK</p>");
    assert.ok(await nacrtClaudeNaloge(e.token, id, e.podatki));
    // stara mapa ostane (preimenovana), da nova ne dobi istega inode
    renameSync(mapa, `${mapa}-stara`);
    mkdirSync(mapa);
    writeFileSync(path.join(mapa, DATOTEKA_NACRTA), "<p>PODTAKNJENO</p>");
    assert.equal(await nacrtClaudeNaloge(e.token, id, e.podatki), null);
    assert.equal(await nacrtClaudeNaloge(e.token, "ffffffffffffffff", e.podatki), null);
    await assert.rejects(nacrtClaudeNaloge(null, id, e.podatki));
    await assert.rejects(nacrtClaudeNaloge(e.token, "../x", e.podatki));
  });

  it("telefon ne dobi HTML nacrta (samo stanje)", async () => {
    const e = await okolje("telefon");
    const id = await zazeni(e, "[nacrt] Prenovi shrambo");
    writeFileSync(potNacrta(e, id), "<p>NACRT-HTML</p>");
    assert.doesNotMatch(JSON.stringify(await telefonStanjeNalog(e.podatki, e.o)), /NACRT-HTML/);
  });
});
