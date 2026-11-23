/**
 * Naloga B (lastnik 10. 11. 2026): nujni klici. Lina klica NE prevezuje; nujen klic je v zapisniku POSEBEJ oznacen
 * (rdeca oznaka IN napis »Nujno«), nujni klici so na vrhu zapisnika in v povzetku na prvem mestu. Nujnost doloci to, kar
 * pove klicatelj (izrecno »nujno« ali rok danes); Lina vprasa, ne ugiba, in ne obljubi, kdaj bo direktor poklical.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { besedila } from "./besedila.ts";
import { formaCatalog } from "./catalog.ts";
import { savePravila } from "./pravila.server.ts";
import { listCalls, publishLine, recordCaller } from "./service.server.ts";
import { razvrstiKlice } from "./tajnica.ts";
import { seznamZapiskov } from "./zapiski.server.ts";
import { jeNujenZapisek, vsebinaZapiska } from "./zapiski.ts";

process.env.LINA_LLM = "0";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-nujno-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const temps: string[] = [];

afterEach(async () => {
  while (temps.length) {
    const dir = temps.pop();
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

async function linija(): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  temps.push(dir);
  const token = await setupOwner("geslo-test-1234", dir);
  await publishLine({ open: true, brezGlasu: true, catalog: formaCatalog() }, { token }, dir);
  await savePravila({ prevzem: "vsi" }, token, dir);
  return { dir, token };
}

const OD = "+38640000000";
let stevec = 0;

async function potek(dir: string, izreki: string[], ura?: string) {
  const sid = `CA-NUJ-${(stevec += 1)}`;
  const odgovori: Awaited<ReturnType<typeof recordCaller>>[] = [await recordCaller({ callSid: sid, from: OD, text: "", now: ura }, dir)];
  for (const izrek of izreki) odgovori.push(await recordCaller({ callSid: sid, from: OD, text: izrek, now: ura }, dir));
  return odgovori;
}

describe("naloga B: nujni klici", { concurrency: 1 }, () => {
  it("klic z »nujno je, rabim odgovor danes« dobi oznako in je prvi v seznamu; navaden klic je nima", async () => {
    const { dir, token } = await linija();
    // Nujen klic je starejsi, navaden novejsi: brez razvrscanja bi bil navaden prvi.
    const nujen = await potek(dir, ["Ana Primer, nisem iz podjetja.", "Sporočite direktorju, da je nujno, rabim odgovor danes."], "2026-11-12T08:00:00.000Z");
    const navaden = await potek(dir, ["Jana Primer, nisem iz podjetja.", "Sporočite direktorju, da me pokliče.", "Ne."], "2026-11-12T09:00:00.000Z");
    const zadnjiNujen = nujen[nujen.length - 1];
    assert.equal(zadnjiNujen.call.order.tajnica?.nujno, true);
    assert.equal(zadnjiNujen.call.order.tajnica?.nujnostZnana, true);
    assert.equal(navaden[navaden.length - 1].call.order.tajnica?.nujno, false);
    // Lina je potrdila, da je zapisano kot nujno; ne ugiba in ne vprasa (klicatelj je nujnost povedal sam) in ne obljubi klica.
    assert.match(zadnjiNujen.reply, /Zapisala sem, da je zadeva nujna\./);
    const vse = nujen.map((x) => x.reply).join(" | ");
    assert.doesNotMatch(vse, /Ali je zadeva nujna\?/);
    assert.doesNotMatch(vse, /direktor[^.]*poklic|poklic[^.]*direktor|poklicali vas bomo/i);
    // Seznam: nujen prvi, navaden drugi.
    const seznam = await listCalls({ token }, dir);
    assert.equal(seznam.length, 2);
    assert.equal(seznam[0].callSid, zadnjiNujen.call.callSid);
    assert.equal(seznam[0].order.tajnica?.nujno, true);
    assert.notEqual(seznam[1].order.tajnica?.nujno, true);
  });

  it("Lina vprasa, ne ugiba: brez izrecne nujnosti vprasa enkrat; odgovor »da« da oznako", async () => {
    const { dir } = await linija();
    const o = await potek(dir, ["Ana Primer, nisem iz podjetja.", "Sporočite direktorju, da naj preveri pogodbo.", "Da."]);
    assert.match(o[2].reply, /Ali je zadeva nujna\?/);
    assert.equal(o[2].call.order.tajnica?.nujno, false);
    const koncni = o[3];
    assert.equal(koncni.call.order.tajnica?.nujno, true);
    assert.match(koncni.reply, /Zapisala sem, da je zadeva nujna\./);
    assert.equal(koncni.call.povzetek?.nujno, true);
    assert.equal(koncni.call.status, "zakljucen");
  });

  it("»ni nujno« ni nujen klic; samo »danes« brez zahteve ni nujno", async () => {
    const { dir } = await linija();
    const o = await potek(dir, ["Ana Primer, nisem iz podjetja.", "Danes kličem zaradi ponudbe. Sporočite direktorju, da ni nujno.", "Ne."]);
    assert.equal(o[o.length - 1].call.order.tajnica?.nujno, false);
    assert.equal(o[o.length - 1].call.povzetek?.nujno, undefined);
  });

  it("zapisek: napis »NUJNO« na prvem mestu in strojna oznaka; navaden zapisek ju nima; seznam zapiskov ima nujne na vrhu", async () => {
    const { dir, token } = await linija();
    // Oba klica se zakljucita sama (nujnost znana), zapisek nastane ob zakljucku.
    await potek(dir, ["Ana Primer, nisem iz podjetja.", "Sporočite direktorju, da je nujno, rabim odgovor danes."], "2026-11-12T08:00:00.000Z");
    await potek(dir, ["Jana Primer, nisem iz podjetja.", "Sporočite direktorju, da me pokliče.", "Ne."], "2026-11-12T09:00:00.000Z");
    const seznam = await seznamZapiskov(token, dir);
    assert.equal(seznam.length, 2);
    assert.equal(seznam[0].nujno, true);
    assert.equal(seznam[1].nujno, false);
    const mapa = path.join(dir, "zapiski");
    const vsebina = readFileSync(path.join(mapa, seznam[0].id), "utf8");
    const vrstice = vsebina.split("\n");
    assert.ok(jeNujenZapisek(vsebina));
    // Napis (ne samo barva) je pred vsemi drugimi polji.
    assert.equal(vrstice.find((v) => /^NUJNO: /.test(v)), "NUJNO: da");
    assert.ok(vrstice.indexOf("NUJNO: da") < vrstice.findIndex((v) => v.startsWith("Čas klica")));
    const navaden = readFileSync(path.join(mapa, seznam[1].id), "utf8");
    assert.equal(jeNujenZapisek(navaden), false);
    assert.doesNotMatch(navaden, /NUJNO/);
    // Od naloge #18 je v mapi zapiskov poleg zapiskov tudi Klici.txt (pregled vseh klicev): tu štejejo samo zapiski.
    assert.equal(readdirSync(mapa).filter((d) => d !== "Klici.txt").length, 2);
  });

  it("razvrstiKlice: nujni na vrhu, znotraj skupine najnovejsi, vhod nespremenjen", () => {
    const k = (id: string, updatedAt: string, nujno?: boolean) => ({ id, updatedAt, order: { tajnica: nujno === undefined ? undefined : { nujno } } });
    const vhod = [k("a", "2026-11-12T10:00:00Z"), k("b", "2026-11-12T08:00:00Z", true), k("c", "2026-11-12T09:00:00Z", false), k("d", "2026-11-12T07:00:00Z", true)];
    const kopija = [...vhod];
    assert.deepEqual(razvrstiKlice(vhod).map((x) => x.id), ["b", "d", "a", "c"]);
    assert.deepEqual(vhod, kopija);
  });

  it("besedila: oznaka »Nujno« v vseh jezikih, ki jih datoteka ima (sl, en)", () => {
    assert.equal(besedila.sl.nujnoOznaka, "Nujno");
    assert.equal(besedila.en.nujnoOznaka, "Urgent");
    for (const jezik of ["sl", "en"] as const) {
      for (const k of ["zapisekRazlog", "zapisekSporocilo", "prosiNujnost", "nujnoZapisano", "sporociloZapisano"] as const) {
        assert.ok(besedila[jezik][k].length > 3, `${jezik}.${k}`);
      }
    }
  });

  it("vsebinaZapiska brez tajnice ostane enaka kot prej (brez oznake)", () => {
    const klic = {
      callSid: "CA-X",
      from: OD,
      startedAt: "2026-11-12T08:00:00.000Z",
      updatedAt: "2026-11-12T08:01:00.000Z",
      status: "zakljucen" as const,
      transcript: [],
      order: { customerName: "Ana Primer", phone: OD, productName: null, materialName: null, requestedProduct: null, requestedMaterial: null, quantity: null, notes: "", confirmed: false, violations: [] },
    };
    const v = vsebinaZapiska(klic);
    assert.doesNotMatch(v, /NUJNO|lina-nujno/);
  });
});
