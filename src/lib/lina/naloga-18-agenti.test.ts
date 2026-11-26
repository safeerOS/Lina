/**
 * Naloga 18, dodatek (lastnik 25. 11. 2026 23:35): naloga, ki jo lastnik na telefonu podpise (»Dodeli nalogo«), se na racunalniku zazene
 * SAMA ob izbranem casu (zdaj ali ob uri) za vsakega agenta, ki ga telefon ponudi (claude, agy, opencode, grok, pi; kimi nima zacetnega
 * poziva). Meritev s pravo vrsto nalog (claude-naloge.server.ts) in laznim terminalom: ali zagon caka klik na racunalniku. Stikalo
 * »Lina sama zazene agente« (samodejno = false): naloga s telefona caka lastnikovo potrditev, nic se ne zazene.
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { potrdiOpozorilo } from "./opozorilo.server.ts";
import { AGENTI } from "./claude-naloge.ts";
import { korakRazporejevalnika, stanjeClaudeNalog, telefonDodeli, type Odvisnosti } from "./claude-naloge.server.ts";

const AGENTI_TELEFONA = ["claude", "agy", "opencode", "grok", "pi"] as const;

async function okolje() {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-n18a-"));
  const dom = path.join(dir, "dom");
  const projekt = path.join(dom, "projekt");
  const podatki = path.join(dir, "podatki");
  mkdirSync(projekt, { recursive: true });
  mkdirSync(podatki, { recursive: true });
  const token = await setupOwner("geslo-test-1234", podatki);
  await potrdiOpozorilo(podatki);
  const zagoni: string[][] = [];
  const o: Odvisnosti = {
    dom, platforma: "linux", najdi: (x) => (["xterm", "bwrap", ...AGENTI].includes(x as never) ? `/usr/bin/${x}` : null),
    preveriZagon: async () => ({ koda: 0, izpis: "1.0", potekel: false }),
    zazeni: async (_p, args) => { zagoni.push([...args]); return 1000 + zagoni.length; },
    casZagona: () => null,
  };
  return { podatki, projekt, token, zagoni, o };
}

for (const agent of AGENTI_TELEFONA) {
  test(`${agent}: naloga s telefona »zdaj« se zazene sama, brez klika na racunalniku; besedilo ni v argv`, async () => {
    const { podatki, projekt, token, zagoni, o } = await okolje();
    const { id } = await telefonDodeli(podatki, agent, projekt, "Popravi README s telefona.", "zdaj", o);
    assert.equal(zagoni.length, 1, `${agent}: zagon brez klika`);
    assert.ok(!zagoni[0].some((a) => a.includes("Popravi README")), "besedilo naloge ni v ukazni vrstici");
    const z = (await stanjeClaudeNalog(token, podatki, o)).naloge.find((n) => n.id === id)!;
    assert.equal(z.stanje, "tece");
  });

  test(`${agent}: naloga s telefona »ob uri« se zazene sama ob uri (razporejevalnik), prej ne`, async () => {
    const { podatki, projekt, token, zagoni, o } = await okolje();
    const ura = new Date(Date.now() + 10 * 60_000);
    const { id } = await telefonDodeli(podatki, agent, projekt, "Ob uri.", `ura:${ura.toISOString()}`, o);
    assert.equal(zagoni.length, 0);
    await korakRazporejevalnika(podatki, o, new Date(ura.getTime() - 60_000));
    assert.equal(zagoni.length, 0, "pred uro ne");
    await korakRazporejevalnika(podatki, o, new Date(ura.getTime() + 1000));
    assert.equal(zagoni.length, 1, `${agent}: ob uri sam`);
    assert.equal((await stanjeClaudeNalog(token, podatki, o)).naloge.find((n) => n.id === id)!.stanje, "tece");
  });

  test(`${agent}: stikalo izklopljeno - naloga s telefona caka lastnikovo potrditev, nic se ne zazene`, async () => {
    const { podatki, projekt, token, zagoni, o } = await okolje();
    const { id } = await telefonDodeli(podatki, agent, projekt, "Caka potrditev.", "zdaj", o, new Date(), { samodejno: false });
    await korakRazporejevalnika(podatki, o);
    assert.equal(zagoni.length, 0);
    assert.equal((await stanjeClaudeNalog(token, podatki, o)).naloge.find((n) => n.id === id)!.stanje, "caka");
  });
}

test("kimi: telefon ga ne more dodeliti (brez zacetnega poziva), nic se ne zazene", async () => {
  const { podatki, projekt, zagoni, o } = await okolje();
  await assert.rejects(telefonDodeli(podatki, "kimi", projekt, "x", "zdaj", o));
  assert.equal(zagoni.length, 0);
});

test("stikalo samodejniAgenti: privzeto vklopljeno (tudi brez datoteke nastavitev), lastnik ga izklopi in vklopi", async () => {
  const { stanjeAsistenta, shraniAsistenta } = await import("./asistent-telefon.server.ts");
  const { podatki, token } = await okolje();
  assert.equal((await stanjeAsistenta(token, podatki)).samodejniAgenti, true);
  assert.equal((await shraniAsistenta(token, { samodejniAgenti: false }, podatki)).samodejniAgenti, false);
  assert.equal((await shraniAsistenta(token, { samodejniAgenti: "ne" }, podatki)).samodejniAgenti, false, "ne-boolean ne spremeni");
  assert.equal((await shraniAsistenta(token, { samodejniAgenti: true }, podatki)).samodejniAgenti, true);
  await assert.rejects(shraniAsistenta("napacen-zeton", { samodejniAgenti: false }, podatki));
});

test("stikalo samodejniAgenti: neberljiva datoteka nastavitev ali neveljavna vrednost = IZKLOPLJENO (lastnikovega izklopa ne preglasimo)", async () => {
  const { stanjeAsistenta } = await import("./asistent-telefon.server.ts");
  const { writeFile } = await import("node:fs/promises");
  const { podatki, token } = await okolje();
  await writeFile(path.join(podatki, "asistent-telefon.json"), "{pokvarjeno");
  assert.equal((await stanjeAsistenta(token, podatki)).samodejniAgenti, false);
  await writeFile(path.join(podatki, "asistent-telefon.json"), JSON.stringify({ samodejniAgenti: "da" }));
  assert.equal((await stanjeAsistenta(token, podatki)).samodejniAgenti, false);
  await writeFile(path.join(podatki, "asistent-telefon.json"), JSON.stringify({ vklop: false }));
  assert.equal((await stanjeAsistenta(token, podatki)).samodejniAgenti, true, "brez polja = privzeto vklopljeno");
});
