import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { jezikVmesnika, nastaviJezikVmesnika, razberiIzbiroJezika, razresiJezik, t } from "../../lib/lina/besedila.ts";
import { datumDanes, datumGlave, uraGlave } from "../../lib/lina/ui-videz.ts";
import { t2 } from "./besedila.ts";
import { menijStrani, najdiStran } from "./okvir-meni.ts";
import { tA } from "../../lib/lina/besedila-avtonomija.ts";
import { enM, tM } from "../../lib/lina/besedila-mozgani.ts";
import { besedaDatotek, besedilaDatotek } from "../../lib/lina/znanje-datoteke-besedila.ts";
import { obveznoBesedilo, prazenSeznamBesedilo } from "../../lib/lina/osebni-nacin.ts";

// torek, 24. 11. 2026 09.30 UTC = 10.30 v Ljubljani: trenutek z Z, da preizkus glave res preveri ljubljanski pas (pregled 1405, N1)
const D = new Date("2026-11-24T09:30:00Z");

test("izbira jezika: sistem, slovenscina ali anglescina; privzeto sistem", () => {
  assert.equal(razberiIzbiroJezika(null), "sistem");
  assert.equal(razberiIzbiroJezika("nekaj"), "sistem");
  assert.equal(razberiIzbiroJezika("en"), "en");
  assert.equal(razberiIzbiroJezika("sl"), "sl");
  assert.equal(razresiJezik("sistem", "sl-SI"), "sl");
  assert.equal(razresiJezik("sistem", "en-US"), "en");
  assert.equal(razresiJezik("sistem", "de-DE"), "en");
  assert.equal(razresiJezik("sistem", undefined), "sl");
  assert.equal(razresiJezik("en", "sl-SI"), "en");
  assert.equal(razresiJezik("sl", "en-US"), "sl");
});

test("t in t2 sledita jeziku vmesnika (privzeto slovensko, kot na strezniku)", () => {
  assert.equal(jezikVmesnika(), "sl");
  assert.equal(t("d2Danes"), "danes");
  nastaviJezikVmesnika("en");
  try {
    assert.equal(t("d2Danes"), "today");
    assert.equal(t2("navTelefon"), "Connect phone");
    assert.equal(t("d2Danes", "sl"), "danes");
  } finally {
    nastaviJezikVmesnika("sl");
  }
});

test("datum in ura v glavi po jeziku vmesnika, v ljubljanskem casu", () => {
  assert.match(datumGlave(D, "sl"), /tor/);
  const en = datumGlave(D, "en");
  assert.match(en, /Tue/);
  assert.match(en, /Nov/);
  assert.doesNotMatch(en, /tor|nov\./);
  assert.equal(uraGlave(D, "en"), "10:30");
  assert.equal(uraGlave(D, "sl"), "10:30");
});

test("kartica Today: angleski dan in mesec, slovenski ostane kot prej", () => {
  const en = datumDanes(D, "en");
  assert.match(en, /Tuesday/);
  assert.match(en, /November/);
  assert.doesNotMatch(en, /torek|november/);
  assert.equal(datumDanes(D, "sl"), "torek, 24. november");
});

test("zasloni Lina 2.0 nimajo trdo kodiranih slovenskih ostankov", () => {
  const mapa = new URL(".", import.meta.url);
  for (const ime of readdirSync(mapa).filter((f) => f.endsWith(".tsx"))) {
    const koda = readFileSync(new URL(ime, mapa), "utf8");
    assert.doesNotMatch(koda, /"sl-SI"/, `${ime}: trdo kodiran sl-SI`);
    assert.doesNotMatch(koda, /,\s*"sl"\)/, `${ime}: trdo kodiran jezik "sl"`);
    assert.doesNotMatch(koda, /\bdatumBesedilo\(/, `${ime}: datumBesedilo je samo slovenski`);
    assert.doesNotMatch(koda, /"Nekaj je šlo narobe\.|"Posnetka ni mogoče/, `${ime}: slovenski niz mimo t()`);
  }
  // Misel dneva tvori model v slovenscini: v anglescini ostane anglesko stalno besedilo.
  const mediji = readFileSync(new URL("mediji.tsx", mapa), "utf8");
  const mot = mediji.slice(mediji.indexOf("export function MotivacijaBesedilo"));
  assert.match(mot.slice(0, mot.indexOf("\n}\n")), /jezikVmesnika\(\) !== "sl"/);
});

test("levi meni, iskanje strani in drugi prevajalniki sledijo jeziku vmesnika", () => {
  nastaviJezikVmesnika("en");
  try {
    const meni = menijStrani("podjetje");
    assert.equal(meni.find((m) => m.id === "nastavitve")?.oznaka, "Settings");
    assert.equal(najdiStran("settings", "podjetje"), "nastavitve");
    assert.equal(tA("nacin_izklopljeno"), "Off");
    assert.equal(tM("naslovKlici"), enM.naslovKlici);
    assert.doesNotMatch(prazenSeznamBesedilo("podjetje"), /naročil/);
    // Kar Lina klicatelju res izgovori, ostane slovensko tudi v angleskem vmesniku.
    assert.equal(obveznoBesedilo("podjetje"), t("obvezniPozdrav", "sl"));
    assert.equal(besedaDatotek("vrsta"), besedilaDatotek.en.vrsta);
  } finally {
    nastaviJezikVmesnika("sl");
  }
  assert.equal(menijStrani("podjetje").find((m) => m.id === "nastavitve")?.oznaka, "Nastavitve");
  assert.equal(prazenSeznamBesedilo("podjetje"), "Potrjenih naročil še ni.");
});
