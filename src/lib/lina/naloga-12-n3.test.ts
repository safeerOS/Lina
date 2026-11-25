/**
 * Naloga 12, #3 (slepi pregled 11): po nadgradnji na podpisano stanje (naloga 11 N1) naloge iz prejsnje izdaje ne smejo tiho izginiti.
 * Naloga 14 N3: stanje brez podpisa je samo za branje z oznako nepreverjeno (izracunano ob vsakem branju), nikoli podpisano in nikoli
 * nadaljevano; izbris mozen. Stanje z napacnim podpisom ostane neveljavno; izbrisi dovoli izbris neveljavne datoteke.
 * Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { OrodjeOrkestratorja } from "./orkestrator.ts";
import { javnaNaloga, ustvariOrkestrator, type KlicModela } from "./orkestrator.server.ts";

const mapa = () => mkdtemp(path.join(tmpdir(), "lina-n12-n3-"));
const brez = { oceni: null, ucenje: null, imaGeslo: async () => true } as const;
const koncni: KlicModela = async () => ({ ok: true, besedilo: "Koncano z dokazom.", klici: [], usage: null, razlogKonca: "konec" });

function pisi(stevec: { n: number }): OrodjeOrkestratorja {
  return {
    razred: "pisanje",
    potrditev: true,
    definicija: { ime: "pisi", opis: "pisi", parametri: { type: "object", properties: { pot: { type: "string" } } } },
    izvedi: async () => (stevec.n++, { ok: true, rezultat: "zapisano" }),
  };
}

/** Stanje, kot ga je zapisala izdaja pred podpisom: brez polja podpis (prava koda ga ustvari, polje se odstrani). */
async function staro(root: string, orodja: OrodjeOrkestratorja[], sprememba: (s: Record<string, unknown>) => void): Promise<string> {
  const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni, orodja });
  const n = await o.nova({ cilj: "Preberi datoteko." });
  const pot = path.join(root, "orkestrator", `${n.id}.json`);
  const s = JSON.parse(await readFile(pot, "utf8")) as Record<string, unknown>;
  delete s.podpis;
  sprememba(s);
  await writeFile(pot, JSON.stringify(s), { mode: 0o600 });
  return n.id;
}

const koncana = (s: Record<string, unknown>) => Object.assign(s, { faza: "koncano", razlog: "dosezeno", odgovor: "Stari odgovor." });
const sPisi = (s: Record<string, unknown>) => {
  (s.sporocila as unknown[]).push({ vloga: "asistent", klici: [{ id: "k1-1", ime: "pisi", argumenti: { pot: "/x" } }] });
  s.odprti = [{ id: "k1-1", ime: "pisi", argumenti: { pot: "/x" }, potrjeno: true }];
};

// Naloga 14 N3 (slepi pregled 12): selitev, ki je nepodpisano stanje PODPISALA, je odstranjena (oznako v mapi lahko izbrise kdor
// sme pisati v mapo, podpis pa bi podtaknjeno vsebino opral v veljavno). Stanje brez podpisa ostane nepodpisano: vidno samo za branje,
// oznaka nepreverjeno se izracuna ob vsakem branju, nedokoncano se nikoli ne nadaljuje.
const surovo = (root: string, id: string) => readFile(path.join(root, "orkestrator", `${id}.json`));

describe("N3: stanje brez podpisa samo za branje, nikoli podpisano", () => {
  it("koncana naloga brez podpisa: vidna kot nepreverjena, datoteka po zagonu ostane enaka (ni podpisana)", async () => {
    const root = await mapa();
    const id = await staro(root, [], koncana);
    const pred = await surovo(root, id);
    const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    await o.nadaljujPoZagonu();
    const s = (await o.seznam()).find((x) => x.id === id);
    assert.ok(s, "naloga je na seznamu");
    assert.equal(s!.faza, "koncano");
    assert.equal(s!.odgovor, "Stari odgovor.");
    assert.equal(javnaNaloga(s!).nepreverjeno, true, "vmesnik dobi oznako");
    assert.deepEqual(await surovo(root, id), pred, "datoteka ni prepisana");
    assert.equal("podpis" in JSON.parse(String(await surovo(root, id))), false, "ni podpisa");
  });

  it("podpisana naloga, ki ji napadalec odstrani podpis in spremeni odgovor: samo branje, ni oprana v podpisano", async () => {
    const root = await mapa();
    const id = await staro(root, [], (x) => { koncana(x); x.odgovor = "Racun placajte na SI56 0000 0000 0000 000."; x.okuzeno = false; x.verzija = 999; });
    const pred = await surovo(root, id);
    for (let i = 0; i < 2; i++) {
      // dva zagona: oznaka se izracuna ob vsakem branju, ne shrani se v datoteko
      const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
      await o.nadaljujPoZagonu();
      await o.preveriPomocnike();
      assert.equal((await o.preberi(id))?.nepreverjeno, true);
    }
    assert.deepEqual(await surovo(root, id), pred);
  });

  it("nedokoncana naloga brez podpisa s podtaknjeno potrditvijo: ne nadaljuje se, orodje ni poklicano, datoteka enaka", async () => {
    const root = await mapa();
    const st = { n: 0 };
    const id = await staro(root, [pisi(st)], sPisi);
    const pred = await surovo(root, id);
    const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni, orodja: [pisi(st)] });
    assert.deepEqual(await o.nadaljujPoZagonu(), [], "ni nadaljevana");
    await o.teci(id).catch(() => undefined);
    await o.ustavi(id).catch(() => undefined);
    await o.odgovorLastnika(id, "da").catch(() => undefined);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(st.n, 0, "orodje ni poklicano");
    assert.equal((await o.preberi(id))?.nepreverjeno, true);
    assert.deepEqual(await surovo(root, id), pred, "datoteka ni prepisana in ni podpisana");
  });

  it("nedokoncana naloga brez podpisa se lahko izbrise in ne steje v mejo hkratnih nalog", async () => {
    const root = await mapa();
    const id = await staro(root, [], () => undefined);
    const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    assert.equal((await o.preberi(id))?.faza, "tece");
    await o.izbrisi(id);
    await assert.rejects(access(path.join(root, "orkestrator", `${id}.json`)));
    // meja NAJVEC_NALOG (50): 50 nepodpisanih nedokoncanih ne zapre nalog lastniku
    for (let i = 0; i < 50; i++) await staro(root, [], () => undefined);
    assert.ok(await o.nova({ cilj: "Nova naloga lastnika." }));
  });

  it("kontrola: naloga, ki jo je zapisala Lina, ni oznacena (ni nepreverjeno)", async () => {
    const root = await mapa();
    const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    const n = await o.nova({ cilj: "Preberi datoteko." });
    assert.equal((await o.preberi(n.id))?.nepreverjeno, undefined);
    assert.equal(javnaNaloga((await o.preberi(n.id))!).nepreverjeno, false);
  });

  it("stanje z napacnim podpisom ostane neveljavno", async () => {
    const root = await mapa();
    const id = await staro(root, [], (s) => { koncana(s); s.podpis = "0".repeat(64); });
    const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    await o.nadaljujPoZagonu();
    assert.equal(await o.preberi(id), null);
  });

  it("izbrisi odstrani neveljavno datoteko z veljavnim id", async () => {
    const root = await mapa();
    const id = await staro(root, [], (s) => { koncana(s); s.podpis = "0".repeat(64); });
    const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    await o.izbrisi(id);
    await assert.rejects(access(path.join(root, "orkestrator", `${id}.json`)));
  });

  it("opozorilo v vmesniku: kljuc v sl in en, kartica ga prikaze, nepreverjena nima ukazov (ustavi/odgovor/potrdi)", async () => {
    const { besedila } = await import("./besedila.ts") as unknown as { besedila: Record<string, Record<string, string>> };
    assert.match(besedila.sl?.orkNepreverjeno ?? "", /samo za branje/i);
    assert.match(besedila.en?.orkNepreverjeno ?? "", /read-only/i);
    const kartica = await readFile(path.join(import.meta.dirname, "../../components/lina2/orkestrator-kartica.tsx"), "utf8");
    assert.match(kartica, /n\.nepreverjeno \?[^\n]*orkNepreverjeno/);
    assert.match(kartica, /const tece = !KONCNE\.includes\(n\.faza\) && !n\.nepreverjeno/);
    assert.match(kartica, /const ukazi = !n\.nepreverjeno/);
  });
});

describe("#3/N3: nepodpisano stanje ob zavrnjenem kljucu ni izgubljeno", { skip: process.platform === "win32" }, () => {
  it("po popravku kljuca je nepodpisano stanje vidno kot nepreverjeno", async () => {
    const { copyFile, mkdir, rename, symlink } = await import("node:fs/promises");
    const vir = await mapa();
    const id = await staro(vir, [], koncana);
    const root = await mapa();
    await mkdir(path.join(root, "orkestrator"), { recursive: true });
    await copyFile(path.join(vir, "orkestrator", `${id}.json`), path.join(root, "orkestrator", `${id}.json`));
    // naloga 14 N1: zavrnjen kljuc je simbolna povezava (0644 se zdaj popravi sam)
    const prava = path.join(await mapa(), "kljuc");
    await writeFile(prava, Buffer.alloc(32, 4), { mode: 0o600 });
    await symlink(prava, path.join(root, ".kljuc"));
    await ustvariOrkestrator(root, { ...brez, klicModela: koncni }).nadaljujPoZagonu().catch(() => undefined);
    await rename(prava, path.join(root, ".kljuc"));
    const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    await o.nadaljujPoZagonu();
    assert.equal((await o.preberi(id))?.nepreverjeno, true);
  });
});
