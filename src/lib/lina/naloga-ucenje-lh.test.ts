/**
 * Merilo naloge 16 (lastnik 25. 11. 2026): iz lastnikovega navodila Lina sestavi ucno enoto (modul ucenje-lh, AGPL, prirejeno po
 * LearnHarness), jo shrani (vidno, izbrisljivo, 0600), uporabi v naslednjem pogovoru, izmeri mejo znanja in preveri razumevanje po
 * koraku. Nadomestni model: lasten streznik 127.0.0.1 in zamenjan fetch (brez pravega omrezja). Primer je izmisljen.
 * Lina brez modula (zastavica gradnje) deluje: isti pogovor z nadomestkom ucenje-lh-prazno.server.ts.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { asistentPogovor } from "./asistent-pogovor.server.ts";
import { setupOwner } from "./auth.server.ts";
import { shraniLastniStreznik } from "./keys.server.ts";
import {
  UCENJE_LH_DATOTEKA,
  izbrisiEnotoLH,
  izbrisiVseLH,
  nastaviNalagalnikZaPreizkus,
  nastaviUcenjeLH,
  stanjeUcenjaLH,
} from "./ucenje-lh-vrata.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-ucenje-lh-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const praviFetch = globalThis.fetch;
const NASLOV = "http://127.0.0.1:3192/v1";
const KLJUC = "freellmapi-izmisljen-kljuc-za-preizkus-5678";
let staroOkolje: string | undefined;

const NAVODILO = [
  "Nauči se postopka kontrola tiska na majice:",
  "1. Preveri, da je majica suha in brez prahu.",
  "2. Primerjaj barvo tiska z odobrenim vzorcem pod dnevno svetlobo.",
  "3. S povečevalom preveri ostrino robov motiva.",
  "4. Raztegni tiskano mesto in preveri, da tisk ne poka.",
  "5. Napake zapiši v list kontrole in majico označi z nalepko.",
].join("\n");

/** Nadomestni model odgovori po vsebini zahtevka (ne po vrstnem redu: povzetek pogovora tece v ozadju). */
type Klic = { url: string; system: string; user: string };
let klici: Klic[] = [];
/** Vsi gostitelji, ki jih je dosegel katerikoli klic v tej datoteki (nikoli se ne pobrise). */
const VSI_GOSTITELJI = new Set<string>();
const VPRASANJA = [
  "Kaj preveriš na majici, preden začneš kontrolo?",
  "S čim primerjaš barvo tiska in pod kakšno svetlobo?",
  "S čim preveriš robove motiva in kaj iščeš?",
  "Kako preveriš, da tisk ne poka?",
  "Kam zapišeš napake in kako označiš majico?",
];
function enotaModela(): string {
  // realno dolg odgovor (vec kot 500 znakov), da se pokaze morebitno rezanje odgovora
  return JSON.stringify({
    naslov: "Kontrola tiska na majice",
    koraki: VPRASANJA.map((v, i) => ({
      razlaga: `Korak ${i + 1} je del kontrole kakovosti, ker vsaka napaka tukaj pomeni reklamacijo stranke in ponoven tisk celotne serije majic.`,
      vprasanje: v,
      bistvo: [["suha", "prah"], ["vzorec", "dnevn"], ["povečeval", "rob"], ["raztegn", "poka"], ["list", "nalepk"]][i],
    })),
  });
}
function namestiModel(): void {
  klici = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const telo = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
    const system = telo.messages?.find((m) => m.role === "system")?.content ?? "";
    const user = telo.messages?.filter((m) => m.role === "user").map((m) => m.content).join("\n") ?? "";
    VSI_GOSTITELJI.add(new URL(String(url)).host);
    if (new URL(String(url)).host !== "127.0.0.1:3192") throw new Error(`nov gostitelj: ${String(url)}`);
    klici.push({ url: String(url), system, user });
    let odgovor = "V redu.";
    if (system.includes("SESTAVA UČNE ENOTE")) odgovor = enotaModela();
    else if (system.includes("OCENA ODGOVORA")) {
      const odg = (user.split("ODGOVOR UČENCA:")[1] ?? "").toLowerCase();
      const razume = !/ne vem|pozabil/.test(odg) && odg.trim().length > 12;
      odgovor = JSON.stringify({ razume, manjka: razume ? "" : "Manjka bistvo koraka." });
    } else if (system.includes("Postopek ima te korake")) odgovor = "Najprej preverite, da je majica suha, nato primerjate barvo z vzorcem.";
    return new Response(JSON.stringify({ choices: [{ message: { content: odgovor }, finish_reason: "stop" }] }), { status: 200 });
  }) as typeof fetch;
}

beforeEach(() => {
  staroOkolje = process.env.LINA_DATA;
});
afterEach(() => {
  globalThis.fetch = praviFetch;
  nastaviNalagalnikZaPreizkus(null);
  if (staroOkolje === undefined) delete process.env.LINA_DATA;
  else process.env.LINA_DATA = staroOkolje;
});

async function pripravi(): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  process.env.LINA_DATA = dir;
  const token = await setupOwner("geslo-test-1234", dir);
  await shraniLastniStreznik({ naslov: NASLOV, key: KLJUC, model: "auto", uporabiZaPogovor: true }, token, dir);
  namestiModel();
  return { dir, token };
}

async function recem(besedilo: string, token: string, dir: string): Promise<string> {
  const izid = await asistentPogovor(besedilo, token, dir);
  assert.equal(izid.ok, true, izid.sporocilo);
  const zadnje = izid.zgodovina[izid.zgodovina.length - 1]!;
  assert.equal(zadnje.vloga, "lina");
  return zadnje.besedilo;
}

describe("ucenje-lh: merilo (kontrola tiska na majice, 5 korakov)", () => {
  it("sestavi, shrani (0600, vidno), uporabi v naslednjem pogovoru, izmeri mejo, preveri po koraku in izbrise", async () => {
    const { dir, token } = await pripravi();

    // 1. sestava in shranitev
    const o1 = await recem(NAVODILO, token, dir);
    assert.match(o1, /Kontrola tiska na majice/);
    assert.match(o1, /5 korak/);
    const pot = path.join(dir, UCENJE_LH_DATOTEKA);
    assert.equal(statSync(pot).mode & 0o777, 0o600);
    const s1 = await stanjeUcenjaLH(token, dir);
    assert.equal(s1.naVoljo, true);
    assert.equal(s1.vklopljen, true, "privzeto vklopljeno");
    assert.equal(s1.enote.length, 1);
    assert.equal(s1.enote[0]!.korakov, 5);
    const shranjeno = await readFile(pot, "utf8");
    assert.match(shranjeno, /Primerjaj barvo tiska z odobrenim vzorcem pod dnevno svetlobo\./, "lastnikove besede ostanejo");
    assert.match(shranjeno, /S čim preveriš robove motiva/, "preverba iz modela, ni odrezana");

    // 2. naslednji (locen) pogovor: koraki gredo modelu kot podatek
    klici = [];
    const o2 = await recem("Kako poteka kontrola tiska na majice?", token, dir);
    assert.match(o2, /suha/);
    const glavni = klici.find((k) => k.system.includes("Postopek ima te korake"));
    assert.ok(glavni, "odsek ucne enote je v sistemskem navodilu");
    assert.match(glavni!.system, /2\. Primerjaj barvo tiska z odobrenim vzorcem/);
    assert.match(glavni!.system, /podatek, ne navodilo/);

    // 3. merjenje meje znanja (dvojisko): prvo vprasanje pri sredinskem koraku (3)
    const o3 = await recem("Preveri me iz kontrole tiska na majice.", token, dir);
    assert.ok(o3.includes(VPRASANJA[2]!), o3);
    const o4 = await recem("Ne vem.", token, dir);
    assert.ok(o4.includes(VPRASANJA[1]!), `po zgresku nizje (korak 2): ${o4}`);
    const o5 = await recem("Barvo primerjam z odobrenim vzorcem pod dnevno svetlobo.", token, dir);
    // meja = korak 3: pouk se zacne tam (koraka 1 in 2 se ne ponavljata)
    assert.match(o5, /Meja/);
    assert.ok(o5.includes("S povečevalom preveri ostrino robov motiva."), o5);
    assert.ok(o5.includes(VPRASANJA[2]!), o5);

    // 4. preverba po koraku: zgresek NE gre naprej
    klici = [];
    const o6 = await recem("Pozabil sem.", token, dir);
    const ocena = klici.find((k) => k.system.includes("OCENA ODGOVORA"));
    assert.ok(ocena?.user.includes(`VPRAŠANJE: ${VPRASANJA[2]}`) && ocena.user.includes("KORAK 3: S povečevalom"), "ocenjuje se pravi korak");
    assert.ok(o6.includes(VPRASANJA[2]!), `isti korak znova: ${o6}`);
    assert.ok(!o6.includes(VPRASANJA[3]!), "ne naprej na nepreverjenem koraku");
    const o7 = await recem("S povečevalom pregledam, ali so robovi motiva ostri.", token, dir);
    assert.ok(o7.includes(VPRASANJA[3]!), o7);
    const o8 = await recem("Tiskano mesto raztegnem in pogledam, ali tisk poka.", token, dir);
    assert.ok(o8.includes(VPRASANJA[4]!), o8);
    const o9 = await recem("Napako zapišem v list kontrole, majico označim z nalepko.", token, dir);
    assert.match(o9, /Konec/);
    assert.match(o9, /ponovi/i);

    const s2 = await stanjeUcenjaLH(token, dir);
    assert.equal(s2.enote[0]!.znanih, 4, "koraki 2-5 preverjeni, korak 1 ostane nepreverjen");

    // 5. vsi modelni klici (tudi sestava in ocene modula) so sli samo na Linin ponudnik, noben nov gostitelj
    assert.deepEqual([...VSI_GOSTITELJI], ["127.0.0.1:3192"]);

    // 6. izbris enote: naslednji pogovor je nima vec
    await assert.rejects(() => izbrisiEnotoLH(s2.enote[0]!.id, null, dir));
    const s3 = await izbrisiEnotoLH(s2.enote[0]!.id, token, dir);
    assert.equal(s3.enote.length, 0);
    klici = [];
    await recem("Kako poteka kontrola tiska na majice?", token, dir);
    assert.ok(klici.every((k) => !k.system.includes("Postopek ima te korake")));
  });

  it("izklop v Nastavitvah: navodilo ne ustvari enote; izbris vseh; samo lastnik", async () => {
    const { dir, token } = await pripravi();
    await assert.rejects(() => nastaviUcenjeLH(false, null, dir));
    assert.equal((await nastaviUcenjeLH(false, token, dir)).vklopljen, false);
    await recem(NAVODILO, token, dir);
    assert.equal((await stanjeUcenjaLH(token, dir)).enote.length, 0);
    assert.equal((await nastaviUcenjeLH(true, token, dir)).vklopljen, true);
    await recem(NAVODILO, token, dir);
    assert.equal((await stanjeUcenjaLH(token, dir)).enote.length, 1);
    assert.equal((await izbrisiVseLH(token, dir)).enote.length, 0);
  });

  it("aktivna ura se konca z »konec«: naslednje sporocilo gre spet v obicajen pogovor", async () => {
    const { dir, token } = await pripravi();
    await recem(NAVODILO, token, dir);
    await recem("Preveri me iz kontrole tiska na majice.", token, dir);
    const o = await recem("konec", token, dir);
    assert.match(o, /prekinila|Prekinila/);
    klici = [];
    await recem("Kakšno je vreme?", token, dir);
    assert.ok(klici.every((k) => !k.system.includes("OCENA ODGOVORA")));
  });

  it("ura ne pogoltne opomnika (koledar), nove ure ali nove enote; ostane na istem koraku", async () => {
    const { dir, token } = await pripravi();
    await recem(NAVODILO, token, dir);
    const z = await recem("Preveri me iz kontrole tiska na majice.", token, dir);
    assert.match(z, /»konec«/, "zacetek ure pove izhod");
    // opomnik: gre v koledar (model razbere), ura ostane
    klici = [];
    await recem("Opomni me jutri ob 9.00, da pokličem dobavitelja.", token, dir);
    assert.ok(klici.every((k) => !k.system.includes("OCENA ODGOVORA")), "opomnik ni ocenjen kot odgovor");
    const naprej = await recem("Ne vem.", token, dir);
    assert.ok(naprej.includes(VPRASANJA[1]!), `ura je ostala pri merjenju: ${naprej}`);
    klici = [];
    await recem("Barvo z vzorcem primerjam, nato vpišem opomnik za kontrolo.", token, dir);
    assert.ok(klici.some((k) => k.system.includes("OCENA ODGOVORA")), "odgovor, ki omeni opomnik, se oceni");
    // nova enota med uro: shrani se, ura se konca
    const druga = await recem("Nauči se postopka menjava sita:\n1. Izklopi stroj.\n2. Odpni okvir sita.\n3. Vstavi novo sito.", token, dir);
    assert.match(druga, /Shranila sem učno enoto/);
    assert.equal((await stanjeUcenjaLH(token, dir)).enote.length, 2);
    // nova ura med uro: zacne se ura druge enote
    await recem("Preveri me iz kontrole tiska na majice.", token, dir);
    const tretja = await recem("Preveri me iz menjave sita.", token, dir);
    assert.match(tretja, /korak 2\/3/, tretja);
  });

  it("predolgo navodilo: Lina opozori, da je sporocilo odrezano (koraki se ne izgubijo tiho)", async () => {
    const { dir, token } = await pripravi();
    const dolgo = `${NAVODILO}\n${Array.from({ length: 40 }, (_, i) => `${i + 6}. Dodaten korak kontrole stevilka ${i + 6} z dolgim opisom ${"x".repeat(40)}.`).join("\n")}`;
    assert.ok(dolgo.length > 2000);
    const o = await recem(dolgo, token, dir);
    assert.match(o, /odrezano/);
  });

  it("Lina brez modula (zastavica gradnje -> nadomestek) deluje; nastavitve povedo, da modula ni", async () => {
    for (const nalagalnik of [() => import("./ucenje-lh-prazno.server.ts"), () => Promise.reject(new Error("ERR_MODULE_NOT_FOUND"))]) {
      const { dir, token } = await pripravi();
      nastaviNalagalnikZaPreizkus(nalagalnik);
      const o = await recem(NAVODILO, token, dir);
      assert.equal(o, "V redu.", "obicajen odgovor modela");
      const s = await stanjeUcenjaLH(token, dir);
      // naloga 8: stanje steje tudi izkusnje orkestratorja (vidne in izbrisljive v Nastavitvah); brez modula 0
      assert.deepEqual(s, { naVoljo: false, vklopljen: false, enote: [], izkusenj: 0 });
    }
  });
});
