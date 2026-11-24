/**
 * Strokovni izrazi iz kataloga kot namigi prepoznave (23. 11. 2026): imena izdelkov in materialov gredo v hints samo ob izbranem
 * modelu prepoznave (brez modela ostane klic kot doslej). Lastnikovi namigi so prvi, podvojeni izrazi se ne ponovijo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { atributiGovora, izraziKataloga, NAJVEC_HINTOV } from "./govor-model.ts";

const katalog = {
  products: [{ name: "Nalepke" }, { name: "Vizitke" }],
  materials: [{ name: "Termotransfer folija" }, { name: "nalepke" }],
};

test("izrazi kataloga se dodajo za lastnikovimi, brez podvojenih", () => {
  const a = atributiGovora({ govorModel: "googlev2_telephony", hintsGovor: "Sitotisk, Nalepke" }, izraziKataloga(katalog));
  assert.equal(a, 'speechModel="googlev2_telephony" hints="Sitotisk, Nalepke, Vizitke, Termotransfer folija"');
});

test("brez modela prepoznave ni namigov, tudi z izrazi kataloga", () => {
  assert.equal(atributiGovora({ govorModel: "", hintsGovor: "" }, izraziKataloga(katalog)), "");
});

test("meja 500 namigov velja tudi z izrazi kataloga; znaki, ki bi pokvarili atribut, gredo ven", () => {
  const velik = { products: Array.from({ length: 600 }, (_, i) => ({ name: `Izdelek ${i}` })), materials: [{ name: 'Papir "mat" <b>' }] };
  const a = atributiGovora({ govorModel: "deepgram_nova-3" }, izraziKataloga(velik));
  const hints = /hints="([^"]*)"/.exec(a)![1].split(", ");
  assert.equal(hints.length, NAJVEC_HINTOV);
  assert.doesNotMatch(atributiGovora({ govorModel: "deepgram_nova-3" }, izraziKataloga({ products: [], materials: [{ name: 'Papir "mat" <b>' }] })), /["<>]\s*mat|<b>/);
});
