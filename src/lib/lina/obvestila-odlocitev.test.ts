/** Enotna odlocitev obvestil (obvestila-odlocitev.ts). Podatki izmisljeni. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PRIVZETE_NASTAVITVE_OBVESTIL as P, odlociObvestilo, type Dogodek, type Prisotnost } from "./obvestila-odlocitev.ts";

const doma: Prisotnost = { racunalnikAktiven: false, telefonPovezan: true, uraLokalno: 14 };
const zaRacunalnikom: Prisotnost = { ...doma, racunalnikAktiven: true };
const klic: Dogodek = { vrsta: "klic", casMs: 0, od: "+386 41 222 333", besedilo: "Klicatelj prosi za ponudbo." };

describe("odlociObvestilo", () => {
  it("privzeto: klic gre na telefon z zakasnitvijo, ce racunalnik ni aktiven; sicer takoj na racunalnik", () => {
    assert.deepEqual(odlociObvestilo(klic, P, doma), { poslji: true, kam: "telefon", zakasnitevMs: 60_000, razlog: "vse" });
    assert.deepEqual(odlociObvestilo(klic, P, zaRacunalnikom), { poslji: true, kam: "racunalnik", zakasnitevMs: 0, razlog: "vse" });
  });
  it("nujno gre takoj na telefon in prebije ne moti in izklop vrste", () => {
    const n = { ...P, neMoti: true, poVrsti: { klic: "nic" as const } };
    assert.deepEqual(odlociObvestilo({ ...klic, nujno: true }, n, doma), { poslji: true, kam: "telefon", zakasnitevMs: 0, razlog: "nujno" });
    assert.deepEqual(odlociObvestilo({ ...klic, nujno: true }, { ...n, nujnoPrebijeNeMoti: false }, doma), { poslji: false, razlog: "izklopljeno" });
  });
  it("ne moti in ure miru (tudi cez polnoc) utisajo navadno, VIP prebije", () => {
    assert.deepEqual(odlociObvestilo(klic, { ...P, neMoti: true }, doma), { poslji: false, razlog: "neMoti" });
    const noc = { ...P, ureMiru: { od: 22, do: 7 } };
    assert.equal(odlociObvestilo(klic, noc, { ...doma, uraLokalno: 23 }).poslji, false);
    assert.equal(odlociObvestilo(klic, noc, { ...doma, uraLokalno: 3 }).poslji, false);
    assert.equal(odlociObvestilo(klic, noc, { ...doma, uraLokalno: 9 }).poslji, true);
    const vip = odlociObvestilo(klic, { ...noc, vip: ["041222333"] }, { ...doma, uraLokalno: 23 });
    assert.equal(vip.poslji && vip.razlog, "vip");
  });
  it("»pomembno«: novica brez kljucne besede ne, s kljucno besedo (brez stresic) da", () => {
    const novica: Dogodek = { vrsta: "novica", casMs: 0, besedilo: "Nova različica WebKitGTK popravlja ranljivost." };
    assert.deepEqual(odlociObvestilo(novica, P, doma), { poslji: false, razlog: "nepomembno" });
    const z = odlociObvestilo(novica, { ...P, kljucneBesede: ["ranljivost"] }, doma);
    assert.equal(z.poslji && z.razlog, "kljucnaBeseda");
  });
  it("ze prebrano na drugi napravi se ne poslje; brez naprav ni obvestila", () => {
    assert.deepEqual(odlociObvestilo({ ...klic, prebranoNa: "racunalnik" }, P, doma), { poslji: false, razlog: "zePrebrano" });
    assert.deepEqual(odlociObvestilo(klic, P, { ...doma, telefonPovezan: false }), { poslji: false, razlog: "niNaprave" });
  });
  it("izklop globalno utisa vse razen nujnega; vrsta »vse« prevlada nad globalnim", () => {
    assert.equal(odlociObvestilo(klic, { ...P, globalno: "nic" }, doma).poslji, false);
    assert.equal(odlociObvestilo(klic, { ...P, globalno: "nic", poVrsti: { klic: "vse" } }, doma).poslji, true);
    assert.equal(odlociObvestilo({ ...klic, nujno: true }, { ...P, globalno: "nic" }, doma).poslji, true);
  });
});
