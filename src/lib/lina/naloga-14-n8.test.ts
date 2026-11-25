/**
 * Naloga 14 N8 (slepi pregled 12): izbris neveljavne datoteke stanja ne sme znizati znane verzije. Ce indeks za nalogo nima vnosa,
 * se verzija izbrisa vzame tudi iz surove datoteke (polje verzija, ce je celo stevilo), sicer bi se starejsa podpisana kopija z
 * verzijo >= 1 po izbrisu vrnila. Verzija izbrisa ostane varno celo stevilo (sicer jo branje indeksa zavrze). Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ustvariOrkestrator, type KlicModela } from "./orkestrator.server.ts";

const mapa = () => mkdtemp(path.join(tmpdir(), "lina-n14-n8-"));
const koncni: KlicModela = async () => ({ ok: true, besedilo: "Koncano z dokazom.", klici: [], usage: null, razlogKonca: "konec" });
const brez = { oceni: null, ucenje: null, imaGeslo: async () => true, klicModela: koncni } as const;
const datoteka = (root: string, id: string) => path.join(root, "orkestrator", `${id}.json`);

/** Koncana naloga; vrne id in njeno podpisano koncno stanje. Indeks se nato izgubi, datoteka postane neveljavna (spremenjen odgovor). */
async function neveljavnaBrezVnosa(root: string, verzija?: number): Promise<{ id: string; podpisana: string }> {
  const o = ustvariOrkestrator(root, brez);
  const n = await o.nova({ cilj: "Naloga." });
  await o.teci(n.id);
  const podpisana = await readFile(datoteka(root, n.id), "utf8");
  const x = JSON.parse(podpisana) as Record<string, unknown>;
  assert.ok((x.verzija as number) >= 2, "kontrola: koncna verzija je vsaj 2");
  await writeFile(datoteka(root, n.id), JSON.stringify({ ...x, odgovor: "Spremenjeno.", ...(verzija === undefined ? {} : { verzija }) }));
  await unlink(path.join(root, "orkestrator", "indeks.json"));
  return { id: n.id, podpisana };
}

describe("N8: izbris neveljavne datoteke ne zniza verzije", () => {
  it("indeks brez vnosa: po izbrisu se starejsa podpisana kopija ne vrne", async () => {
    const root = await mapa();
    const { id, podpisana } = await neveljavnaBrezVnosa(root);
    const o = ustvariOrkestrator(root, brez);
    assert.equal(await o.preberi(id), null, "kontrola: datoteka je neveljavna");
    await o.izbrisi(id);
    await writeFile(datoteka(root, id), podpisana);
    assert.equal(await ustvariOrkestrator(root, brez).preberi(id), null);
  });

  it("verzija iz datoteke na meji varnega celega stevila: izbris ostane v indeksu", async () => {
    const root = await mapa();
    const { id, podpisana } = await neveljavnaBrezVnosa(root, Number.MAX_SAFE_INTEGER);
    await ustvariOrkestrator(root, brez).izbrisi(id);
    const ind = JSON.parse(await readFile(path.join(root, "orkestrator", "indeks.json"), "utf8")) as { verzije: Record<string, number> };
    assert.equal(ind.verzije[id], Number.MAX_SAFE_INTEGER);
    await writeFile(datoteka(root, id), podpisana);
    assert.equal(await ustvariOrkestrator(root, brez).preberi(id), null);
  });

  it("kontrola: neveljavna verzija v datoteki (niz) ne podre izbrisa", async () => {
    const root = await mapa();
    const { id } = await neveljavnaBrezVnosa(root);
    const x = JSON.parse(await readFile(datoteka(root, id), "utf8")) as Record<string, unknown>;
    await writeFile(datoteka(root, id), JSON.stringify({ ...x, verzija: "99" }));
    await ustvariOrkestrator(root, brez).izbrisi(id);
    const ind = JSON.parse(await readFile(path.join(root, "orkestrator", "indeks.json"), "utf8")) as { verzije: Record<string, number> };
    assert.equal(ind.verzije[id], 1);
  });
});
