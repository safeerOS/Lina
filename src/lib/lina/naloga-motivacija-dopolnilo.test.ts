/**
 * Dopolnilni preizkusi cistega dela motivacije (motivacija.ts), dodani po mutacijskem teku 21. 11. 2026: vhod se ne spreminja,
 * pravi koledarski dan, primerjava brez locil, zadnji kandidat vnaprej pripravljenih misli, pravila v navodilu, rezanje dolgega
 * odgovora na meji stavka in vsaka prepovedana oblika ter uvod posebej (par: slab, dober). Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PRIVZETE_NASTAVITVE, VNAPREJ, VNAPREJ_VECER, dnevnaStevilka, izberiVnaprej, jeKljucDneva, ocistiOdgovorModela, primerjalno, sestaviNavodilo, zdruziNastavitve } from "./motivacija.ts";

describe("motivacija: dopolnilo", () => {
  it("zdruziNastavitve ne spremeni vhoda", () => {
    const t = { ...PRIVZETE_NASTAVITVE };
    const n = zdruziNastavitve(t, { humor: "vec", vecer: false });
    assert.deepEqual(t, PRIVZETE_NASTAVITVE);
    assert.deepEqual(n, { vklopljena: true, vecer: false, slog: "citat", humor: "vec" });
  });

  it("jeKljucDneva: predpona ali pripona ni veljavna", () => {
    assert.equal(jeKljucDneva("x2026-11-21"), false);
    assert.equal(jeKljucDneva(" 2026-11-21"), false);
    assert.equal(jeKljucDneva("2026-11-21 "), false);
  });

  it("primerjalno: locila in dvojni presledki ne vplivajo, velike crke in diakritike tudi ne", () => {
    assert.equal(primerjalno("a, b"), "a b");
    assert.equal(primerjalno("Kot si, mislis!"), primerjalno("kot si mislis"));
    assert.equal(primerjalno("  Čaj, ŽIVLJENJE  "), primerjalno("caj zivljenje"));
  });

  for (const [ime, zaloga] of [
    ["jutro", VNAPREJ],
    ["vecer", VNAPREJ_VECER],
  ] as const) {
    it(`izberiVnaprej (${ime}): ce je porabljeno vse razen zadnjega kandidata v zaporedju, vrne njega; ce je porabljeno vse, zacetnega`, () => {
      const del = ime;
      let dan = "";
      let zacetek = 0;
      for (let d = 1; d <= 28; d++) {
        const kandidat = `2026-11-${String(d).padStart(2, "0")}`;
        const z = dnevnaStevilka(kandidat) % zaloga.length;
        if (z !== 0 && z !== zaloga.length - 1) {
          dan = kandidat;
          zacetek = z;
          break;
        }
      }
      assert.notEqual(dan, "");
      const zadnji = (zacetek + zaloga.length - 1) % zaloga.length;
      assert.equal(izberiVnaprej(dan, zaloga.filter((_b, i) => i !== zadnji), del), zaloga[zadnji]);
      assert.equal(izberiVnaprej(dan, [...zaloga], del), zaloga[zacetek]);
      assert.equal(izberiVnaprej(dan, [], del), zaloga[zacetek]);
    });
  }

  it("navodilo vsebuje vsa pravila za model", () => {
    const { system } = sestaviNavodilo({ dan: "2026-11-21", del: "jutro", humor: "malo" });
    for (const s of ["Piši v slovenščini", "1 do 2 stavka", "največ 240 znakov", "brez obljub rezultata", "brez zdravstvenih ali finančnih nasvetov", "brez imen, povezav", "Odgovori samo z mislijo"])
      assert.ok(system.includes(s), s);
  });
});

describe("motivacija: ociscenje odgovora, meje in rezanje", () => {
  it("besedilo s tocno 280 znaki brez locila na koncu ostane celo", () => {
    const b = "a".repeat(280);
    assert.equal(ocistiOdgovorModela(b), b);
  });

  it("predolg odgovor se odreze na zadnji meji stavka (pika, klicaj, vprasaj)", () => {
    const stavek = (n: number, konec: string) => "a".repeat(n) + konec;
    for (const konec of [".", "!", "?"]) {
      const prvi = stavek(150, konec);
      const dolg = `${prvi} ${"b".repeat(200)}`;
      assert.equal(ocistiOdgovorModela(dolg), prvi, konec);
    }
  });

  it("odgovor, ki ima na 280. mestu locilo, se odreze natanko tam (ne na prejsnjem stavku)", () => {
    const prvi = `${"a".repeat(100)}.`;
    const drugi = `${"b".repeat(177)}.`;
    const dolg = `${prvi} ${drugi} ${"c".repeat(50)}`;
    const rezultat = ocistiOdgovorModela(dolg);
    assert.equal(rezultat, `${prvi} ${drugi}`);
    assert.equal(rezultat?.length, 280);
  });

  it("predolg odgovor brez meje stavka v prvih 280 znakih je zavrnjen", () => {
    assert.equal(ocistiOdgovorModela("a".repeat(400)), null);
  });

  const PARI: Array<[string, string, string]> = [
    ["zagotovljen", "Zagotovljen uspeh je vsakemu na dosegu roke.", "Majhen uspeh je vsakemu na dosegu roke."],
    ["diagnoz", "Ta misel nadomesti diagnozo pri zdravniku.", "Ta misel nadomesti pogovor pri prijatelju."],
    ["zdravil", "Vzemi zdravila ob pravem času vsak dan.", "Vzemi počitek ob pravem času vsak dan."],
    ["naložb", "Dobra naložba je potrpežljivost vsak dan.", "Dobra navada je potrpežljivost vsak dan."],
    ["nalozb", "Dobra nalozba je potrpezljivost vsak dan.", "Dobra navada je potrpezljivost vsak dan."],
    ["delnic", "Kupi delnice in boš bogat jutri zjutraj.", "Kupi knjigo in boš bogat jutri zjutraj."],
    ["kripto", "Kripto valute te bodo naredile bogatega.", "Majhni koraki te bodo naredili bogatega."],
    ["http:", "Poglej http:primer za več misli danes.", "Poglej primer za več misli danes."],
    ["://", "Poglej ftp://primer za več misli danes.", "Poglej primer za več misli danes."],
    ["www.", "Poglej www.primer za več misli danes.", "Poglej primer za več misli danes."],
    ["uvod evo", "Evo ena majhna misel za današnji dan, naredi korak.", "Ena majhna misel za današnji dan, naredi korak."],
    ["uvod here", "Here is a small thought for today, take a step.", "A small thought for today, take a step."],
    ["uvod sure", "Sure, a small step today is enough for you.", "A small step today is enough for you."],
    ["uvod okej", "Okej, danes naredi en majhen korak naprej.", "Danes naredi en majhen korak naprej."],
    ["uvod v redu", "V redu, danes naredi en majhen korak naprej.", "Danes naredi en majhen korak naprej."],
    ["uvod seveda", "Seveda, danes naredi en majhen korak naprej.", "Danes naredi en majhen korak naprej."],
    ["uvod tukaj je", "Tukaj je misel: danes naredi en majhen korak naprej.", "Misel: danes naredi en majhen korak naprej."],
  ];
  for (const [ime, slab, dober] of PARI)
    it(`zavrne ${ime}, dober par ostane`, () => {
      assert.equal(ocistiOdgovorModela(slab), null, slab);
      assert.equal(ocistiOdgovorModela(dober), dober, dober);
    });

  it("beseda, ki se zacne kot uvod, ni uvod (meja besede)", () => {
    const b = "Evolucija prinaša majhne korake vsak dan.";
    assert.equal(ocistiOdgovorModela(b), b);
  });
});
