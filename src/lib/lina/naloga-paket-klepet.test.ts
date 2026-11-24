/**
 * Navodilo za dostavo iz klepeta ali glasu z Lino (lastnik 23. 11. 2026, NALOGA vrsta-02b): ozka pot SAMO za paketNavodilo/paketDo.
 * Lina iz lastnikovega besedila predlaga navodilo (ista preverba kot paket.ts), lastnik potrdi z »da« (ali gumb Potrdi), nato koda shrani.
 * Preklic in prikaz iz klepeta. Nikoli iz odgovora modela, priponke ali klicatelja. Brez omrezja; samo izmisljena imena.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { asistentPogovor } from "./asistent-pogovor.server.ts";
import { setupOwner } from "./auth.server.ts";
import { PREPOVEDANA_OPRAVILA } from "./avtonomija.ts";
import { en, sl, t } from "./besedila.ts";
import { shraniLastniStreznik } from "./keys.server.ts";
import { PAKET_PREDLOG_MS, razberiPaketKlepet } from "./paket-klepet.server.ts";
import { loadPravila, savePravila } from "./pravila.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-paket-klepet-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const praviFetch = globalThis.fetch;
const TOR = new Date("2026-11-24T10:00:00+01:00");
let staroOkolje: string | undefined;

beforeEach(() => {
  staroOkolje = process.env.LINA_DATA;
});
afterEach(() => {
  globalThis.fetch = praviFetch;
  if (staroOkolje === undefined) delete process.env.LINA_DATA;
  else process.env.LINA_DATA = staroOkolje;
});

async function pripravi(pravila: Record<string, unknown> = { nacinKlica: "osebna" }): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  process.env.LINA_DATA = dir;
  const token = await setupOwner("geslo-test-1234", dir);
  await savePravila(pravila, token, dir);
  return { dir, token };
}

const zadnji = (z: { zgodovina: Array<{ vloga: string; besedilo: string }> }) => z.zgodovina[z.zgodovina.length - 1]?.besedilo ?? "";

describe("paket iz klepeta: razbiranje (cista koda)", () => {
  it("nastavitev: mesto iz »naj ga pustijo ...«, »pustite ga ...«, »navodilo za dostavo: ...«", () => {
    assert.deepEqual(razberiPaketKlepet("Lina, pričakujem paket, naj ga pustijo pri sosedu.", TOR), { vrsta: "nastavi", mesto: "pri sosedu", do: "" });
    assert.deepEqual(razberiPaketKlepet("Pričakujem paket iz DPD, pustite ga pred hišo", TOR), { vrsta: "nastavi", mesto: "pred hišo", do: "" });
    assert.deepEqual(razberiPaketKlepet("Navodilo za dostavo: v nabiralniku pri vhodu", TOR), { vrsta: "nastavi", mesto: "v nabiralniku pri vhodu", do: "" });
    assert.deepEqual(razberiPaketKlepet("Jutri pričakujem paket, naj ga pustijo pri sosedu Novaku", TOR), { vrsta: "nastavi", mesto: "pri sosedu Novaku", do: "2026-11-25" });
    assert.deepEqual(razberiPaketKlepet("Danes pride paket, naj ga kurir pusti v garaži.", TOR), { vrsta: "nastavi", mesto: "v garaži", do: "2026-11-24" });
    assert.deepEqual(razberiPaketKlepet("Pričakujem pošiljko, naj jo pustijo pri sosedu do 30. 11.", TOR), { vrsta: "nastavi", mesto: "pri sosedu", do: "2026-11-30" });
  });
  it("preklic in prikaz", () => {
    for (const p of ["Prekliči navodilo za dostavo.", "Paket je prišel.", "Izbriši navodilo za paket", "Ne pričakujem več paketa."]) assert.deepEqual(razberiPaketKlepet(p, TOR), { vrsta: "preklic" }, p);
    for (const p of ["Kakšno je navodilo za dostavo?", "Lina, kakšno je navodilo za dostavo?", "Kje naj pustijo paket?", "Navodilo za dostavo?"]) assert.deepEqual(razberiPaketKlepet(p, TOR), { vrsta: "prikaz" }, p);
  });
  it("ni namera dostave: opomnik, vprasanje o paketu, prazno", () => {
    for (const p of ["Opomni me jutri, da prevzamem paket.", "Paket je prišel poškodovan, kaj naj naredim?", "Ne pričakujem več paketa iz Kitajske, ampak dva iz Nemčije.", "Kdaj pride paket iz Amazona?", "Pusti ga pri miru.", "Kaj je danes na sporedu?", "", "da"]) {
      assert.equal(razberiPaketKlepet(p, TOR), null, p);
    }
  });
});

describe("paket iz klepeta: predlog, potrditev, preklic (asistentPogovor, brez modela)", { concurrency: 1 }, () => {
  it("predlog -> »da« -> shranjeno; prikaz »Navodilo za dostavo: ... do ...«; preklic izbrise", async () => {
    const { dir, token } = await pripravi();
    const p1 = await asistentPogovor("Lina, pričakujem paket, naj ga pustijo pri sosedu.", token, dir);
    assert.equal(p1.ok, true);
    assert.match(zadnji(p1), /pri sosedu/);
    assert.ok(zadnji(p1).includes("Paket pričakujemo. Prosim, pustite ga pri sosedu."), zadnji(p1));
    assert.ok(zadnji(p1).includes(sl.paketKlepetVprasanje), "vprasanje za potrditev (gumb Potrdi ga prepozna)");
    assert.equal((await loadPravila(dir)).paketNavodilo, "", "pred potrditvijo nic shranjeno");
    const p2 = await asistentPogovor("da", token, dir);
    assert.equal((await loadPravila(dir)).paketNavodilo, "pri sosedu.");
    assert.match(zadnji(p2), /^Shranila sem\. Navodilo za dostavo: pri sosedu\.$/);
    const p3 = await asistentPogovor("Kakšno je navodilo za dostavo?", token, dir);
    assert.equal(zadnji(p3), "Navodilo za dostavo: pri sosedu.");
    const p4 = await asistentPogovor("Paket je prišel.", token, dir);
    assert.equal(zadnji(p4), sl.paketKlepetPreklic);
    const p = await loadPravila(dir);
    assert.equal(p.paketNavodilo, "");
    assert.equal(p.paketDo, "");
    assert.equal(zadnji(await asistentPogovor("Navodilo za dostavo?", token, dir)), sl.paketKlepetNi);
  });
  it("govorjena potrditev (»Lina, da, prosim.«, »Ja, lahko.«) shrani; »Paket je prišel« brez navodila gre naprej", async () => {
    for (const da of ["Da, prosim.", "Ja, lahko.", "Lina, da, shrani."]) {
      const { dir, token } = await pripravi();
      await asistentPogovor("Lina, pričakujem paket, naj ga pustijo pri sosedu.", token, dir);
      await asistentPogovor(da, token, dir);
      assert.equal((await loadPravila(dir)).paketNavodilo, "pri sosedu.", da);
    }
    const { dir, token } = await pripravi();
    const z = await asistentPogovor("Paket je prišel.", token, dir);
    assert.notEqual(zadnji(z), sl.paketKlepetPreklic, "brez shranjenega navodila ni »izbrisala sem«");
    assert.equal(zadnji(await asistentPogovor("Prekliči navodilo za dostavo.", token, dir)), sl.paketKlepetNi);
  });
  it("priponka brez cakajocega predloga ne pise datoteke predloga", async () => {
    const { dir, token } = await pripravi();
    const priponka = { ime: "a.txt", mime: "text/plain", podatki: Buffer.from("x").toString("base64") };
    await asistentPogovor("Preberi.", token, dir, [priponka]);
    const { existsSync } = await import("node:fs");
    assert.equal(existsSync(path.join(dir, "paket-predlog.json")), false);
  });
  it("z datumom: prikaz »... do d. m. llll«", async () => {
    const { dir, token } = await pripravi();
    await asistentPogovor("Pričakujem paket, pustite ga pred hišo do 31. 12. 2099", token, dir);
    const z = await asistentPogovor("Da.", token, dir);
    assert.equal((await loadPravila(dir)).paketDo, "2099-12-31");
    assert.match(zadnji(z), /Navodilo za dostavo: pred hišo do 31\. 12\. 2099\.$/);
  });
  it("»ne« ali karkoli drugega zavrze predlog; poznejsi »da« nic ne shrani", async () => {
    const { dir, token } = await pripravi();
    await asistentPogovor("Pričakujem paket, naj ga pustijo pri sosedu.", token, dir);
    assert.equal(zadnji(await asistentPogovor("ne", token, dir)), sl.paketKlepetOpusceno);
    await asistentPogovor("da", token, dir);
    assert.equal((await loadPravila(dir)).paketNavodilo, "");
    await asistentPogovor("Pričakujem paket, naj ga pustijo pri sosedu.", token, dir);
    await asistentPogovor("Kaj je danes na sporedu?", token, dir);
    await asistentPogovor("da", token, dir);
    assert.equal((await loadPravila(dir)).paketNavodilo, "", "»da« na drugo vprasanje ne shrani starega predloga");
  });
  it("zastarel predlog (cez rok) se ne shrani", async () => {
    const { dir, token } = await pripravi();
    await asistentPogovor("Pričakujem paket, naj ga pustijo pri sosedu.", token, dir);
    const pot = path.join(dir, "paket-predlog.json");
    const predlog = JSON.parse(readFileSync(pot, "utf8")) as { cas: number };
    const { writeFile } = await import("node:fs/promises");
    await writeFile(pot, JSON.stringify({ ...predlog, cas: Date.now() - PAKET_PREDLOG_MS - 1000 }));
    await asistentPogovor("da", token, dir);
    assert.equal((await loadPravila(dir)).paketNavodilo, "");
  });
  it("ista preverba kot paket.ts: koda ali kljuc nista predlagana", async () => {
    const { dir, token } = await pripravi();
    const z = await asistentPogovor("Pričakujem paket, naj ga pustijo v garaži, koda je 4821.", token, dir);
    assert.ok(zadnji(z).includes(t("paketKoda")), zadnji(z));
    await asistentPogovor("da", token, dir);
    assert.equal((await loadPravila(dir)).paketNavodilo, "");
  });
  it("ce ni nacin osebna tajnica: shrani, a pove, da zdaj ne velja", async () => {
    const { dir, token } = await pripravi({ nacinKlica: "podjetje" });
    await asistentPogovor("Pričakujem paket, naj ga pustijo pri sosedu.", token, dir);
    const z = await asistentPogovor("da", token, dir);
    assert.ok(zadnji(z).includes(sl.paketKlepetNeVelja), zadnji(z));
  });
  it("koledar ne prestreze: »jutri pričakujem paket, naj ga pustijo pri sosedu« ni dogodek; »opomni me ... paket« ni predlog", async () => {
    const { dir, token } = await pripravi();
    const z = await asistentPogovor("Jutri pričakujem paket, naj ga pustijo pri sosedu.", token, dir);
    assert.ok(zadnji(z).includes(sl.paketKlepetVprasanje), zadnji(z));
    const o = await asistentPogovor("Opomni me jutri ob 9.00, da prevzamem paket.", token, dir);
    // Brez modela opomnik ne doda odgovora; pomembno je, da pot dostave ni dodala novega predloga.
    assert.equal(o.zgodovina.length, z.zgodovina.length, "opomnik o paketu ni predlog dostave");
    await asistentPogovor("da", token, dir);
    assert.equal((await loadPravila(dir)).paketNavodilo, "");
  });
  it("odgovor modela in priponka nikoli ne naredita predloga", async () => {
    const { dir, token } = await pripravi();
    await shraniLastniStreznik({ naslov: "http://127.0.0.1:3192/v1", key: "izmisljen-kljuc-preizkusa-1234", model: "auto", uporabiZaPogovor: true }, token, dir);
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: `Pričakujem paket, naj ga pustijo pri sosedu. ${sl.paketKlepetVprasanje}` }, finish_reason: "stop" }] }), { status: 200 })) as typeof fetch;
    await asistentPogovor("Povej mi nekaj o vremenu.", token, dir);
    await asistentPogovor("da", token, dir);
    assert.equal((await loadPravila(dir)).paketNavodilo, "", "model ne more ustvariti predloga");
    const priponka = { ime: "navodilo.txt", mime: "text/plain", podatki: Buffer.from("Pričakujem paket, naj ga pustijo pri sosedu.").toString("base64") };
    await asistentPogovor("Pričakujem paket, naj ga pustijo pri sosedu.", token, dir, [priponka]);
    await asistentPogovor("da", token, dir);
    assert.equal((await loadPravila(dir)).paketNavodilo, "", "pot s priponko ne predlaga");
  });
  it("brez lastnikove seje ni nic", async () => {
    const { dir } = await pripravi();
    await assert.rejects(asistentPogovor("Pričakujem paket, naj ga pustijo pri sosedu.", null, dir));
  });
  it("avtonomija se vedno ne sme spreminjati pravil", () => {
    assert.ok((PREPOVEDANA_OPRAVILA as readonly string[]).includes("sprememba-pravil"));
  });
  it("besedila sl in en", () => {
    for (const k of ["paketKlepetPredlog", "paketKlepetVprasanje", "paketKlepetShranjeno", "paketKlepetNeVelja", "paketKlepetPreklic", "paketKlepetNi", "paketKlepetOpusceno", "paketKlepetPrikaz", "paketKlepetDo", "paketPotrdi"] as const) {
      assert.ok(sl[k]?.trim(), `sl ${k}`);
      assert.ok(en[k]?.trim(), `en ${k}`);
    }
  });
});
