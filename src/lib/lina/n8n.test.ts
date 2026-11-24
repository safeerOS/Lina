/**
 * Cista logika uporabe dodatka n8n (n8n.ts): lokalni naslov, razclenitev urnika in sestava varnega toka iz opisa (SL/EN),
 * zgostitev predloga, neposredne namere v pogovoru, oznake modela in besedila SL/EN.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { en, sl } from "./besedila.ts";
import {
  NAVODILO_OZNAKE_N8N,
  imaNevidneN8n,
  izluciOznakeN8n,
  jeKratkaPotrditev,
  jeLokalniN8nNaslov,
  jeSporociloPotrditveN8n,
  oblikujIzidN8n,
  oblikujPredlogPotrditveN8n,
  oblikujSeznamTokovN8n,
  razberiNameroN8n,
  razberiUrnikIzOpisa,
  sestaviTokIzOpisa,
  veljavenIdTokaN8n,
  zgostitevPredlogaN8n,
} from "./n8n.ts";

describe("n8n.ts: varnost naslova in ID", () => {
  it("dovoli samo http://127.0.0.1:<vrata>; zavrne druge gostitelje, 0.0.0.0, poverilnice in poti", () => {
    assert.equal(jeLokalniN8nNaslov("http://127.0.0.1:5678"), "http://127.0.0.1:5678");
    assert.equal(jeLokalniN8nNaslov("http://127.0.0.1:5678/"), "http://127.0.0.1:5678");
    assert.equal(jeLokalniN8nNaslov("http://127.0.0.1:41234"), "http://127.0.0.1:41234");
    assert.equal(jeLokalniN8nNaslov("http://0.0.0.0:5678"), null);
    assert.equal(jeLokalniN8nNaslov("http://localhost:5678"), null);
    assert.equal(jeLokalniN8nNaslov("https://127.0.0.1:5678"), null);
    assert.equal(jeLokalniN8nNaslov("https://n8n.example.com"), null);
    assert.equal(jeLokalniN8nNaslov("http://user:pass@127.0.0.1:5678"), null);
    assert.equal(jeLokalniN8nNaslov("http://127.0.0.1:5678/api"), null);
    assert.equal(jeLokalniN8nNaslov("http://127.0.0.1:99999"), null);
  });

  it("veljavenIdTokaN8n zavrne lupinske znake, poti in zastavice", () => {
    assert.equal(veljavenIdTokaN8n("wf_123-abc"), true);
    assert.equal(veljavenIdTokaN8n("42"), true);
    assert.equal(veljavenIdTokaN8n("--help"), false);
    assert.equal(veljavenIdTokaN8n("../etc"), false);
    assert.equal(veljavenIdTokaN8n("id;rm -rf /"), false);
    assert.equal(veljavenIdTokaN8n(""), false);
  });

  it("zazna skrite in smerne znake", () => {
    assert.equal(imaNevidneN8n("navaden opis"), false);
    assert.equal(imaNevidneN8n("opis\u202ezlo"), true);
    assert.equal(imaNevidneN8n("opis\u200bneviden"), true);
  });
});

describe("n8n.ts: urnik in sestava toka iz opisa (SL/EN)", () => {
  it("razbere dnevni urnik SL: »vsak dan ob 7:00 mi pošlji povzetek novic«", () => {
    const u = razberiUrnikIzOpisa("vsak dan ob 7:00 mi pošlji povzetek novic");
    assert.ok(u);
    assert.equal(u.vrsta, "dnevno");
    assert.equal(u.ura, 7);
    assert.equal(u.minuta, 0);

    const { definicija, povzetek, urnikOpis } = sestaviTokIzOpisa("vsak dan ob 7:00 mi pošlji povzetek novic");
    assert.ok(definicija.name.length > 0 && definicija.name.length <= 80);
    assert.equal(definicija.nodes[0]?.type, "n8n-nodes-base.scheduleTrigger");
    const interval = (definicija.nodes[0]?.parameters as { rule?: { interval?: Array<Record<string, unknown>> } })?.rule?.interval?.[0];
    assert.equal(interval?.field, "days");
    assert.equal(interval?.triggerAtHour, 7);
    assert.equal(interval?.triggerAtMinute, 0);
    assert.equal(definicija.nodes[1]?.type, "n8n-nodes-base.set");
    assert.ok(definicija.connections[definicija.nodes[0]!.name]?.main?.[0]?.[0]?.node === definicija.nodes[1]!.name);
    assert.ok(urnikOpis && urnikOpis.includes("07:00"));
    assert.match(povzetek, /07:00/);
    assert.ok(!definicija.nodes.some((n) => /executeCommand|code|ssh/i.test(n.type)));
  });

  it("razbere dnevni urnik EN: »every day at 7:00 send me a news summary«", () => {
    const { definicija, povzetek, urnikOpis } = sestaviTokIzOpisa("every day at 7:00 send me a news summary", undefined, "en");
    assert.equal(definicija.nodes[0]?.type, "n8n-nodes-base.scheduleTrigger");
    const interval = (definicija.nodes[0]?.parameters as { rule?: { interval?: Array<Record<string, unknown>> } })?.rule?.interval?.[0];
    assert.equal(interval?.field, "days");
    assert.equal(interval?.triggerAtHour, 7);
    assert.equal(interval?.triggerAtMinute, 0);
    assert.ok(urnikOpis && urnikOpis.includes("07:00"));
    assert.match(povzetek, /07:00/);
  });

  it("razbere tedenski, urni in minutni urnik ter ročni sprožilec brez urnika", () => {
    const ted = razberiUrnikIzOpisa("vsak ponedeljek ob 9:30 pripravi poročilo");
    assert.equal(ted?.vrsta, "tedensko");
    assert.equal(ted?.dan, 1);
    assert.equal(ted?.ura, 9);
    assert.equal(ted?.minuta, 30);

    const ure = razberiUrnikIzOpisa("every 2 hours check status");
    assert.equal(ure?.vrsta, "urno");
    assert.equal(ure?.interval, 2);

    const min = razberiUrnikIzOpisa("vsakih 15 minut preveri stanje");
    assert.equal(min?.vrsta, "minutno");
    assert.equal(min?.interval, 15);

    const rocni = sestaviTokIzOpisa("pripravi tedenski povzetek opravil");
    assert.equal(rocni.definicija.nodes[0]?.type, "n8n-nodes-base.manualTrigger");
    assert.equal(rocni.urnikOpis, null);
  });

  it("javni https URL doda kot varen HTTP GET korak; zasebni ali http URL prezre", () => {
    const javni = sestaviTokIzOpisa("vsak dan ob 7:00 preberi novice iz https://www.rtvslo.si/feeds/novice.xml");
    assert.ok(javni.definicija.nodes.some((n) => n.type === "n8n-nodes-base.httpRequest"));
    const zasebni = sestaviTokIzOpisa("preberi http://127.0.0.1:8080/skrivnost in https://192.168.1.1/admin");
    assert.ok(!zasebni.definicija.nodes.some((n) => n.type === "n8n-nodes-base.httpRequest"));
  });
});

describe("n8n.ts: zgostitev, namere, oznake in SL/EN besedila", () => {
  it("zgostitev predloga se spremeni ob vsaki spremembi vsebine", () => {
    const a = sestaviTokIzOpisa("vsak dan ob 7:00 mi pošlji povzetek novic");
    const z1 = zgostitevPredlogaN8n({ vrsta: "ustvari", imeToka: a.definicija.name, opis: "vsak dan ob 7:00 mi pošlji povzetek novic", definicija: a.definicija });
    const z2 = zgostitevPredlogaN8n({ vrsta: "ustvari", imeToka: "Drugo ime", opis: "vsak dan ob 7:00 mi pošlji povzetek novic", definicija: a.definicija });
    assert.match(z1, /^[a-f0-9]{64}$/);
    assert.notEqual(z1, z2);
  });

  it("razbere neposredne namere v pogovoru (SL in EN)", () => {
    assert.deepEqual(razberiNameroN8n("Pokaži n8n tokove"), { vrsta: "seznam" });
    assert.deepEqual(razberiNameroN8n("list n8n workflows"), { vrsta: "seznam" });
    assert.deepEqual(razberiNameroN8n("Zaženi n8n tok Jutranje novice"), { vrsta: "zazeni", cilj: "Jutranje novice" });
    assert.deepEqual(razberiNameroN8n("run n8n workflow wf-1"), { vrsta: "zazeni", cilj: "wf-1" });
    assert.deepEqual(razberiNameroN8n("Ustvari n8n tok: vsak dan ob 7:00 mi pošlji povzetek novic"), {
      vrsta: "ustvari",
      opis: "vsak dan ob 7:00 mi pošlji povzetek novic",
    });
    assert.deepEqual(razberiNameroN8n("create n8n workflow: every day at 7:00 send me a news summary"), {
      vrsta: "ustvari",
      opis: "every day at 7:00 send me a news summary",
    });
    assert.deepEqual(razberiNameroN8n("Potrdi n8n"), { vrsta: "potrdi" });
    assert.deepEqual(razberiNameroN8n("confirm n8n a1b2c3d4e5f60708"), { vrsta: "potrdi", id: "a1b2c3d4e5f60708" });
    assert.deepEqual(razberiNameroN8n("Zavrni n8n"), { vrsta: "odkloni" });
    assert.deepEqual(razberiNameroN8n("cancel n8n a1b2c3d4e5f60708"), { vrsta: "odkloni", id: "a1b2c3d4e5f60708" });
    assert.equal(razberiNameroN8n("Kakšno je vreme danes?"), null);
    assert.equal(jeKratkaPotrditev("da"), "potrdi");
    assert.equal(jeKratkaPotrditev("yes"), "potrdi");
    assert.equal(jeKratkaPotrditev("ne"), "odkloni");
    assert.equal(jeKratkaPotrditev("cancel"), "odkloni");
    assert.equal(jeKratkaPotrditev("da, ampak jutri povej več o tem"), null);
  });

  it("izluciOznakeN8n izloči oznake in jih odstrani iz besedila", () => {
    const s = izluciOznakeN8n("Preverjam tokove. [[n8n-seznam]]");
    assert.equal(s.besedilo, "Preverjam tokove.");
    assert.deepEqual(s.oznake, [{ vrsta: "seznam" }]);

    const u = izluciOznakeN8n("Pripravila sem predlog. [[n8n-ustvari: Jutranje novice | vsak dan ob 7:00 mi pošlji povzetek novic]]");
    assert.equal(u.besedilo, "Pripravila sem predlog.");
    assert.deepEqual(u.oznake, [{ vrsta: "ustvari", ime: "Jutranje novice", opis: "vsak dan ob 7:00 mi pošlji povzetek novic" }]);

    const z = izluciOznakeN8n("Pripravila sem zagon. [[n8n-zazeni: wf-42]]");
    assert.equal(z.besedilo, "Pripravila sem zagon.");
    assert.deepEqual(z.oznake, [{ vrsta: "zazeni", cilj: "wf-42" }]);

    assert.match(NAVODILO_OZNAKE_N8N, /\[\[n8n-ustvari:/);
    assert.match(NAVODILO_OZNAKE_N8N, /\[\[n8n-zazeni:/);
    assert.match(NAVODILO_OZNAKE_N8N, /\[\[n8n-seznam\]\]/);
  });

  it("oblikuje sporočila v SL in EN ter prepozna ID predloga v potrditvenem sporočilu", () => {
    const seznamSl = oblikujSeznamTokovN8n([{ id: "1", ime: "Jutranje novice", aktiven: false, posodobljen: null }], "sl");
    const seznamEn = oblikujSeznamTokovN8n([{ id: "1", ime: "Morning news", aktiven: true, posodobljen: null }], "en");
    assert.match(seznamSl, /Jutranje novice/);
    assert.match(seznamEn, /Morning news/);

    const potrSl = oblikujPredlogPotrditveN8n({ id: "0123456789abcdef", vrsta: "ustvari", imeToka: "Novice", povzetek: "Urnik 07:00" }, "sl");
    const potrEn = oblikujPredlogPotrditveN8n({ id: "0123456789abcdef", vrsta: "zazeni", imeToka: "News", povzetek: "Run workflow" }, "en");
    assert.equal(jeSporociloPotrditveN8n(potrSl), "0123456789abcdef");
    assert.equal(jeSporociloPotrditveN8n(potrEn), "0123456789abcdef");

    const izidSl = oblikujIzidN8n({ vrsta: "ustvari", imeToka: "Novice", tokId: "wf-9", stanje: "koncano", rezultat: null, izvedbaId: null, razlog: null }, "sl");
    const izidEn = oblikujIzidN8n({ vrsta: "zazeni", imeToka: "News", tokId: "wf-9", stanje: "koncano", rezultat: null, izvedbaId: "ex-1", razlog: null }, "en");
    assert.match(izidSl, /wf-9/);
    assert.match(izidEn, /ex-1/);
  });

  it("besedila.ts vsebuje SL in EN ključe za n8n", () => {
    const kljuci = ["n8nNaslov", "n8nNamig", "n8nPotrdi", "n8nOdkloni", "n8nUstvariPredlog", "n8nZazeniPredlog", "n8nPraznoTokovi", "n8nIzklopljeno"] as const;
    for (const k of kljuci) {
      assert.ok(typeof sl[k] === "string" && sl[k].length > 0, `manjka sl.${k}`);
      assert.ok(typeof en[k] === "string" && en[k].length > 0, `manjka en.${k}`);
      assert.notEqual(sl[k], en[k], `sl.${k} in en.${k} ne smeta biti enaka`);
    }
  });
});

// Vodja 24. 11. 2026 (pravi n8n 2.48.7): tok z urnikom mora imeti tudi rocni sprozilec, sicer »n8n execute« javi »Missing node to start execution«.
import { test as testRocni } from "node:test";
import assertRocni from "node:assert/strict";
import { sestaviTokIzOpisa as sestaviRocni } from "./n8n.ts";
testRocni("tok z urnikom ima tudi manualTrigger, povezan na isto vozlisce kot urnik", () => {
  const t = sestaviRocni("vsak dan ob 7:00 mi pošlji povzetek novic", "Preizkus", "sl") as unknown as { definicija?: { nodes: { name: string; type: string }[]; connections: Record<string, { main: { node: string }[][] }> } } & { nodes?: { name: string; type: string }[]; connections?: Record<string, { main: { node: string }[][] }> };
  const d = t.definicija ?? (t as never);
  const rocni = d.nodes.find((n) => n.type === "n8n-nodes-base.manualTrigger");
  const urnik = d.nodes.find((n) => n.type === "n8n-nodes-base.scheduleTrigger");
  assertRocni.ok(rocni && urnik);
  assertRocni.equal(d.connections[rocni!.name]!.main[0]![0]!.node, d.connections[urnik!.name]!.main[0]![0]!.node);
});
