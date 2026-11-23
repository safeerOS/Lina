/**
 * Naloga G4a. Po drugem pravem klicu lastnika (10. 11. 2026): Lina se je predstavila dvakrat (odgovor modela se je
 * zacel z »Pozdravljeni, tukaj Lina.«), prevec »Trenutek, prosim.«, potrditev sredi klica namesto na koncu, klic se je
 * prekinil pri meji preizkusnega racuna Twilio (10 zahtev). Brez pravega omrezja; komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { t } from "./besedila.ts";
import { formaCatalog } from "./catalog.ts";
import { brezUvoda } from "./govor.ts";
import { NAVODILO_MODELA } from "./llm.server.ts";
import { defaultPravila, loadPravila } from "./pravila.server.ts";
import { deliPredstavitve, predstavitevKlica } from "./povzetek.ts";
import { recordCaller } from "./service.server.ts";
import { writeJson } from "./store.server.ts";

process.env.LINA_LLM = "0";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-g4a-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const temps: string[] = [];

afterEach(async () => {
  while (temps.length) {
    const dir = temps.pop();
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

async function linija(pravila: Record<string, unknown> = {}): Promise<string> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  temps.push(dir);
  await writeJson(dir, "line.json", { open: true, catalog: formaCatalog(), updatedAt: null });
  await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi", ...pravila });
  return dir;
}

const OD = "+38640000000";
let stevec = 0;
const novSid = () => `CA-G4A-${(stevec += 1)}`;

describe("naloga G4a (1): predstavitev samo enkrat, krajsi pozdrav", { concurrency: 1 }, () => {
  it("pozdrav: tocno besedilo, razkritje UI v prvem stavku, brez podvojenega »AI asistentka«", async () => {
    const dir = await linija();
    const izid = await recordCaller({ callSid: novSid(), from: OD, text: "" }, dir);
    assert.equal(
      izid.reply,
      // Lastnik 22. 11. 2026: v nacinu podjetje je snemanje privzeto vklopljeno, zato pozdrav vsebuje napoved snemanja in roka hrambe (ZEKom-2 14. clen).
      "Dober dan, tukaj Lina, pomočnica z umetno inteligenco pri FORMA. Pogovor snemam in zapisujem kot dokaz o naročilu, posnetek hranimo največ 30 dni. Prosim, povejte ime in priimek ter podjetje, če ga imate.",
    );
    assert.match(izid.reply.split(/(?<=[.!?])\s/)[0], /umetno inteligenco/);
    assert.equal((izid.reply.match(/umetno inteligenco|AI asistentka/g) ?? []).length, 1);
    // Lastnik 22. 11. 2026: z napovedjo snemanja in roka hrambe je pozdrav dolg 35 besed (prej 26: brez napovedi); meja 36 zaklene, da ne zraste dalje.
    assert.ok(izid.reply.split(/\s+/).length <= 36, izid.reply);
    // Pozdrav je pri stalnih stavkih po delih; vsak je krajsi od 15 besed.
    const pravila = await loadPravila(dir);
    for (const del of deliPredstavitve("", "FORMA", pravila)) assert.ok(del.split(/\s+/).length <= 15, del);
    assert.equal(predstavitevKlica("", "FORMA", pravila), izid.reply);
  });

  it("brezUvoda: tabela odgovorov modela s pozdravom ali predstavitvijo", () => {
    const rezerva = "REZERVA";
    const tabela: Array<[string, string]> = [
      ["Pozdravljeni, tukaj Lina. Mizo Alba delamo iz hrasta.", "Mizo Alba delamo iz hrasta."],
      ["Dober dan, tukaj Lina, pomočnica z umetno inteligenco. Mizo Alba delamo iz hrasta.", "Mizo Alba delamo iz hrasta."],
      ["Dober dan! Mizo Alba delamo iz hrasta.", "Mizo Alba delamo iz hrasta."],
      ["Pozdravljeni, zapisala sem mizo Alba.", "Zapisala sem mizo Alba."],
      ["Sem Lina, pomočnica z umetno inteligenco. Pozdravljeni. Zapisala sem mizo.", "Zapisala sem mizo."],
      ["Lina pri telefonu. Mizo Alba delamo iz hrasta.", "Mizo Alba delamo iz hrasta."],
      ["Tukaj Lina. Pozdravljeni.", rezerva],
      // Brez uvoda ostane nedotaknjeno; Lina v sredini besedila ni uvod.
      ["Mizo Alba delamo iz hrasta.", "Mizo Alba delamo iz hrasta."],
      ["Zapisala sem mizo. Pozdravljeni so tudi vsi, ki kličejo.", "Zapisala sem mizo. Pozdravljeni so tudi vsi, ki kličejo."],
    ];
    for (const [vhod, pricakovano] of tabela) assert.equal(brezUvoda(vhod, rezerva), pricakovano, vhod);
  });

  it("odgovor modela s pozdravom: Lina se v klicu predstavi samo v pozdravu", async () => {
    const dir = await linija();
    const sid = novSid();
    const obrat = (text: string, model?: (f: string) => Promise<string>) => recordCaller({ callSid: sid, from: OD, text }, dir, model);
    await obrat("");
    await obrat("Ana Primer.");
    const model = async (dejstvo: string) => `Pozdravljeni, tukaj Lina. ${dejstvo}`;
    const izid = await obrat("Ali izdelujete mizo Alba iz hrasta?", model);
    assert.doesNotMatch(izid.reply, /pozdravljeni|tukaj lina/i);
    const vrstice = izid.call.transcript.filter((vrstica) => vrstica.role === "lina").map((vrstica) => vrstica.text);
    assert.equal(vrstice.filter((vrstica) => /tukaj lina/i.test(vrstica)).length, 1);
    assert.equal(vrstice.join(" ").match(/umetno inteligenco/g)?.length, 1);
  });

  it("navodilo modelu izrecno prepoveduje pozdrav in predstavitev", () => {
    assert.match(NAVODILO_MODELA, /NIKOLI ne zacni s pozdravom ali predstavitvijo/);
    assert.match(t("pozdravZapis"), /zapisujem/);
  });
});
