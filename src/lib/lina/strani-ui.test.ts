import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { razvrstiStrani, preveriVnos, povzetekStrani } from "./strani-ui.ts";

describe("strani-ui.ts logika", () => {
  it("razvrstiStrani: občutljive na vrhu, nato po abecedi, ne spremeni vhoda", () => {
    const vhod = [
      { izvor: "https://z-navadna.si", dodano: "2024-01-01", obcutljiva: false },
      { izvor: "https://b-obcutljiva.si", dodano: "2024-01-01", obcutljiva: true },
      { izvor: "https://a-navadna.si", dodano: "2024-01-01", obcutljiva: false },
      { izvor: "https://a-obcutljiva.si", dodano: "2024-01-01", obcutljiva: true },
    ];
    
    const razvrsceno = razvrstiStrani(vhod);
    
    assert.equal(razvrsceno.length, 4);
    assert.equal(razvrsceno[0].izvor, "https://a-obcutljiva.si");
    assert.equal(razvrsceno[1].izvor, "https://b-obcutljiva.si");
    assert.equal(razvrsceno[2].izvor, "https://a-navadna.si");
    assert.equal(razvrsceno[3].izvor, "https://z-navadna.si");
    
    // originalni array nespremenjen
    assert.equal(vhod[0].izvor, "https://z-navadna.si");
  });

  it("preveriVnos: odstrani presledke in validira", () => {
    const ok = preveriVnos("   https://primer.si   ");
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.izvor, "https://primer.si");
    
    const pot = preveriVnos("https://primer.si/pot");
    assert.equal(pot.ok, false);
    
    const prazno = preveriVnos("   ");
    assert.equal(prazno.ok, false);
  });

  it("povzetekStrani: vrne skupno število in število občutljivih", () => {
    const seznam = [
      { izvor: "https://a.si", dodano: "2024-01-01", obcutljiva: true },
      { izvor: "https://b.si", dodano: "2024-01-01", obcutljiva: false },
    ];
    const povzetek = povzetekStrani(seznam);
    assert.equal(povzetek.skupaj, 2);
    assert.equal(povzetek.obcutljivih, 1);
  });
});
