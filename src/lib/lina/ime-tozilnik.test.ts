/** Sklanjanje imena lastnika v tožilnik za osebno tajnico (lastnik, 21. 11. 2026). Imena izmišljena ali običajna. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { imeVTozilniku, PREPOVEDANO_ZA_POKLICALI } from "./ime-tozilnik.ts";
import { osebniDeli } from "./povzetek.ts";

describe("ime v tožilniku", () => {
  const primeri: Array<[string, string]> = [
    ["Tomaž", "Tomaža"], ["Alen", "Alena"], ["Ana", "Ano"], ["Maja", "Majo"], ["Luka", "Luko"], ["Žiga", "Žigo"],
    ["Marko", "Marka"], ["Peter", "Petra"], ["Pavel", "Pavla"], ["Jure", "Jureta"], ["Igor", "Igorja"], ["Primož", "Primoža"],
    ["Ines", "Ines"], ["Karmen", "Karmen"], ["Tomaž Novak", "Tomaža Novaka"], ["Ana Novak", "Ano Novak"], ["Nejc Kranjc", "Nejca Kranjca"],
    ["Mitja", "Mitjo"], ["Gregor", "Gregorja"], ["", ""],
  ];
  for (const [vhod, izhod] of primeri) it(`${vhod || "(prazno)"} -> ${izhod || "(prazno)"}`, () => assert.equal(imeVTozilniku(vhod), izhod));
  it("uporabnikov zapis ima prednost", () => assert.equal(imeVTozilniku("Neznanko", "Neznanka"), "Neznanka"));
  it("pozdrav osebne tajnice uporabi tožilnik in nikoli splošne besede", () => {
    const deli = osebniDeli("", "Tomaž").join(" ");
    assert.match(deli, /Poklicali ste Tomaža\./);
    assert.doesNotMatch(deli, PREPOVEDANO_ZA_POKLICALI);
    assert.doesNotMatch(osebniDeli("", "").join(" "), /podjetj|organizacij|društv|osebo/i);
  });
});
