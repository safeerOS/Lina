/**
 * Pravi klic lastnika 15. 11. 2026: (1) daljsi izrek z besedo »telefonu« je bil po zmoti razvrscen kot vprasanje o stevilki
 * klicatelja (Lina: »vidim, da ste poklicali s stevilke ...«, 3 ms, brez modela); (2) tisina po zapisanem sporocilu 2 s je odrezala premislek.
 * Stevilka in ime v preizkusu sta izmisljena.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { pocakajDnevnikGlasu, pocakajGlas, ustaviCiscenjeZvoka } from "./glas.server.ts";
import { defaultPravila } from "./pravila.server.ts";
import type { ModelRazumevanja } from "./razumevanje.server.ts";
import { recordCaller } from "./service.server.ts";
import { writeJson } from "./store.server.ts";
import { TISINA_OSEBNA_PO_SPOROCILU_SEK } from "./tisina.ts";

process.env.LINA_LLM = "0";
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-klic-1511-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length) {
    const dir = dirs.pop() as string;
    await pocakajGlas(dir);
    await pocakajDnevnikGlasu(dir);
    ustaviCiscenjeZvoka(dir);
  }
});

const STEVILKA = "+38641123456";
const PRVI = "želim da se za lino dela veš čas da je popolna in super in da je služena z osebno asistentko in da je pripravljena za uporabo";
// Dobesedno iz klica (prepis Twilia).
const DRUGI =
  "da zakaj si me prekinjaš želim da lahko mi pomaga pri opravljanju opravil tako pred televiziji in računalniku in telefonu in želim da se uporablja tudi en razvije praskalnik z lino in njeno pameto kot smo se dogovorili";

async function klic(sid: string, model: ModelRazumevanja) {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  dirs.push(dir);
  await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi", nacinKlica: "osebna", imeLastnika: "Ana" });
  const klicov = { n: 0 };
  const m: ModelRazumevanja = async (a, b) => {
    klicov.n += 1;
    return model(a, b);
  };
  await recordCaller({ callSid: sid, from: STEVILKA, text: "" }, dir, undefined, { razumevanje: m, osebnaRokMs: 200 });
  const reci = (text: string) => recordCaller({ callSid: sid, from: STEVILKA, text }, dir, undefined, { razumevanje: m, osebnaRokMs: 200 });
  return { dir, klicov, reci };
}

describe("klic lastnika 15. 11. 2026: pravila ne ugibajo po podnizu v dolgem izreku", () => {
  it("dolg izrek z »telefonu« NI vprasanje o stevilki: odloci model, odgovor ne vsebuje stevilke klicatelja", async () => {
    const { klicov, reci } = await klic("CA-1511-A", async () =>
      JSON.stringify({ namen: "sporocilo", sporocilo: DRUGI, ime: "", vprasanje: null, odgovor: null }));
    await reci(PRVI);
    klicov.n = 0;
    const r = await reci(DRUGI);
    assert.doesNotMatch(r.reply, /poklicali s/);
    assert.doesNotMatch(r.reply, /nič štiri ena/);
    assert.equal(klicov.n, 1, "dolg izrek razume model, ne pravilo");
  });

  it("ob izpadu modela dolg izrek ostane dopis (nikoli odgovor o stevilki)", async () => {
    const { reci } = await klic("CA-1511-B", async () => {
      throw new Error("model ni na voljo");
    });
    await reci(PRVI);
    const r = await reci(DRUGI);
    assert.doesNotMatch(r.reply, /poklicali s/);
    assert.match(r.call.order.tajnica?.sporocilo ?? "", /televiziji/);
  });

  it("kratko vprasanje o stevilki ostane hitra pot brez modela", async () => {
    const { klicov, reci } = await klic("CA-1511-C", async () => '{"namen":"sporocilo","sporocilo":"x","ime":"","vprasanje":null,"odgovor":null}');
    await reci("pozdravite jo lepo in ji povejte da pridem v ponedeljek");
    klicov.n = 0;
    const r = await reci("a imate mojo telefonsko številko");
    assert.match(r.reply, /poklicali s številke/);
    assert.equal(klicov.n, 0);
  });
});

describe("klic 15. 11. 2026 in odlocitev 17. 11. 2026: tisina 2 s z zascito nedokoncanih stavkov", () => {
  it("tisina po zapisanem sporocilu je 2 s, nedokoncan stavek (ker, in) ostane zasciten", () => {
    assert.equal(TISINA_OSEBNA_PO_SPOROCILU_SEK, 2, `tisina ${TISINA_OSEBNA_PO_SPOROCILU_SEK} s`);
  });
});
