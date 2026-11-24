/**
 * Okvir Line 2.0 v osebnem nacinu (lastnik 15. 11. 2026):
 * - v osebnem nacinu ("osebna") levega menija ni za razdelek Znanje (razdelekViden("znanje", nacin)),
 *   iskalno polje ga ne najde, jeStran ga zavrne, prehod ob spremembi nacina pa preklopi na "klic";
 * - vnos "narocila" dobi oznako "Sporočila" / "Messages" (t("zavihekSporocila"));
 * - nacin "podjetje" in nedolocen (undefined) ostaneta popolnoma nespremenjena (15 vnosov od 23. 11. 2026 z Racunalnikom; 14 od 22. 11. 2026, ko je dodan Slike in video; 13 od 21. 11. z Novice; isti vrstni red in oznake).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  jeStran,
  menijStrani,
  najdiStran,
  veljavnaStran,
} from "../../components/lina2/okvir-meni.ts";
import { t } from "./besedila.ts";

const beri = (pot: string) => readFileSync(new URL(pot, import.meta.url), "utf8");

const PRICAKOVANI_PODJETJE_SL: Array<{ id: string; oznaka: string }> = [
  { id: "domov", oznaka: "Domov" },
  { id: "pogovor", oznaka: "Pogovor" },
  { id: "koledar", oznaka: "Koledar" },
  { id: "imenik", oznaka: "Imenik" },
  { id: "novice", oznaka: "Novice" },
  { id: "mediji", oznaka: "Slike in video" },
  { id: "klic", oznaka: "Klici" },
  { id: "narocila", oznaka: "Naročila" },
  { id: "znanje", oznaka: "Znanje" },
  { id: "dnevnik", oznaka: "Dnevnik" },
  { id: "zapiski", oznaka: "Zapiski" },
  { id: "telefon", oznaka: "Poveži telefon" },
  { id: "linija", oznaka: "Linija" },
  { id: "racunalnik", oznaka: "Računalnik" },
  { id: "nastavitve", oznaka: "Nastavitve" },
];

test("menijStrani v nacinu podjetje in undefined vrne vseh 15 vnosov v starem vrstnem redu in z istimi oznakami", () => {
  for (const nacin of ["podjetje", undefined, "neznan"] as const) {
    const meni = menijStrani(nacin);
    assert.equal(meni.length, 15);
    assert.deepEqual(
      meni.map(({ id, oznaka }) => ({ id, oznaka })),
      PRICAKOVANI_PODJETJE_SL,
    );
  }
  const enPodjetje = menijStrani("podjetje", "en");
  assert.equal(enPodjetje.length, 15);
  assert.equal(enPodjetje.find((v) => v.id === "racunalnik")?.oznaka, "Computer");
  assert.equal(enPodjetje.find((v) => v.id === "narocila")?.oznaka, "Orders");
  assert.equal(enPodjetje.find((v) => v.id === "znanje")?.oznaka, "Knowledge");
  assert.equal(enPodjetje.find((v) => v.id === "novice")?.oznaka, "News");
});

test("menijStrani v osebnem nacinu skrije Znanje in preimenuje Narocila v Sporocila", () => {
  const meni = menijStrani("osebna");
  assert.equal(meni.length, 14);
  assert.equal(
    meni.some((v) => v.id === "znanje"),
    false,
    "znanje se v osebnem nacinu ne sme prikazati",
  );
  assert.equal(meni.find((v) => v.id === "narocila")?.oznaka, t("zavihekSporocila"));
  assert.equal(meni.find((v) => v.id === "narocila")?.oznaka, "Sporočila");
  assert.deepEqual(
    meni.map((v) => v.id),
    PRICAKOVANI_PODJETJE_SL.filter((v) => v.id !== "znanje").map((v) => v.id),
  );

  const meniEn = menijStrani("osebna", "en");
  assert.equal(meniEn.length, 14);
  assert.equal(meniEn.some((v) => v.id === "znanje"), false);
  assert.equal(meniEn.find((v) => v.id === "narocila")?.oznaka, t("zavihekSporocila", "en"));
  assert.equal(meniEn.find((v) => v.id === "narocila")?.oznaka, "Messages");
});

test("iskanje, jeStran in veljavnaStran v osebnem nacinu ne odprejo Znanja in preklopijo na klic", () => {
  assert.equal(najdiStran("znanje", "osebna"), undefined);
  assert.equal(najdiStran("Znanje", "podjetje"), "znanje");
  assert.equal(najdiStran("znanje", undefined), "znanje");

  assert.equal(najdiStran("sporocila", "osebna"), "narocila");
  assert.equal(najdiStran("Sporočila", "osebna"), "narocila");
  assert.equal(najdiStran("narocila", "osebna"), undefined);
  assert.equal(najdiStran("narocila", "podjetje"), "narocila");

  assert.equal(jeStran("znanje", "osebna"), false);
  assert.equal(jeStran("znanje", "podjetje"), true);
  assert.equal(jeStran("znanje", undefined), true);
  assert.equal(jeStran("narocila", "osebna"), true);
  assert.equal(jeStran("domov", "osebna"), true);
  assert.equal(jeStran("neobstaja", "podjetje"), false);

  assert.equal(veljavnaStran("znanje", "osebna"), "klic");
  assert.equal(veljavnaStran("znanje", "podjetje"), "znanje");
  assert.equal(veljavnaStran("znanje", undefined), "znanje");
  assert.equal(veljavnaStran("domov", "osebna"), "domov");
  assert.equal(veljavnaStran("narocila", "osebna"), "narocila");
});

test("okvir.tsx uporablja menijStrani, props.pravila.nacinKlica in varuje prehod na skrito stran", () => {
  const okvir = beri("../../components/lina2/okvir.tsx");
  const meniVir = beri("../../components/lina2/okvir-meni.ts");

  assert.match(meniVir, /razdelekViden\("znanje",\s*nacin\)/);
  assert.match(meniVir, /t\("zavihekSporocila"/);

  assert.match(okvir, /props\.pravila\.nacinKlica/);
  assert.match(okvir, /menijStrani\(/);
  assert.match(okvir, /najdiStran\(/);
  assert.match(okvir, /veljavnaStran\(/);
  assert.match(okvir, /jeStran\(/);
  assert.match(okvir, /\bconst LASTNI\b/);
  assert.match(okvir, /\bStran\b/);
  assert.doesNotMatch(okvir, /\bNAV\.map\b/);
  assert.doesNotMatch(okvir, /\bNAV\.find\b/);
});
