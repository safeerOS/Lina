/**
 * Preizkusi ciste enote klici-datoteka.ts (brez diska, brez streznika).
 * Vsi podatki (imena, stevilke, sporocila) so izmisljeni.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { en, sl } from "./besedila.ts";
import { dopolniKlici, vrsticaKlica } from "./klici-datoteka.ts";
import type { CallSession } from "./types.ts";

function klic(deli: Partial<CallSession> = {}): CallSession {
  return {
    callSid: "CA-TEST-0001",
    from: "+38640000101",
    startedAt: "2026-11-21T08:15:00.000Z",
    updatedAt: "2026-11-21T08:16:05.000Z",
    status: "zakljucen",
    transcript: [
      { role: "lina", text: "Tukaj Lina, pomočnica z umetno inteligenco.", at: "2026-11-21T08:15:00.000Z" },
      { role: "stranka", text: "Tukaj Miha Primer, pokličite me jutri.", at: "2026-11-21T08:15:10.000Z" },
    ],
    order: {
      customerName: "Miha Primer",
      phone: "+38640000101",
      productName: null,
      materialName: null,
      requestedProduct: null,
      requestedMaterial: null,
      quantity: null,
      notes: "",
      confirmed: false,
      violations: [],
    },
    ...deli,
  };
}

function sha8(sid: string): string {
  return createHash("sha256").update(sid, "utf8").digest("hex").slice(0, 8);
}

describe("klici-datoteka: besedila kljuci", () => {
  it("sl in en imata enake kljuce, razlogi pa so neprazni", () => {
    assert.deepEqual(Object.keys(sl).sort(), Object.keys(en).sort());
    assert.ok(sl.klicBrezPogovora.length > 0);
    assert.ok(en.klicBrezPogovora.length > 0);
    assert.ok(sl.klicBrezSporocila.length > 0);
    assert.ok(en.klicBrezSporocila.length > 0);
  });
});

describe("klici-datoteka: vrsticaKlica", () => {
  it("oblika vrstice: <datum ura> | <kdo> | <trajanje> | <sporocilo> | id:<8 hex>", () => {
    const c = klic({
      callSid: "CA-OBLIKA-1",
      nacin: "osebna",
      order: {
        ...klic().order,
        customerName: "Ana Primer",
        tajnica: { sporocilo: "Pokličite me po tretji uri.", razlog: "", nujno: false, nujnostZnana: false },
      },
    });
    const id = sha8(c.callSid);
    const v = vrsticaKlica(c);
    assert.equal(v, vrsticaKlica(c, id));
    const deli = v.split(" | ");
    assert.equal(deli.length, 5);
    assert.match(deli[0], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    assert.equal(deli[1], "Ana Primer");
    assert.equal(deli[2], "1:05");
    assert.equal(deli[3], "Pokličite me po tretji uri.");
    assert.equal(deli[4], `id:${id}`);
  });

  it("osebna tajnica ne vkljuci podjetniskih polj iz order", () => {
    const c = klic({
      nacin: "osebna",
      order: {
        ...klic().order,
        customerName: "Nina Primer",
        productName: "Miza Alfa",
        povprasevanje: "hrastova miza",
        notes: "dostava do petka",
      },
    });
    const deli = vrsticaKlica(c).split(" | ");
    assert.equal(deli[3], "brez sporočila");
    assert.doesNotMatch(deli[3], /Miza|hrastova|dostava/i);
  });

  it("nacin podjetja uporabi smiselno vsebino iz call.order (izdelek ali povprasevanje)", () => {
    const cIzdelek = klic({
      order: {
        ...klic().order,
        productName: "Miza Alfa",
        materialName: "Hrast",
        quantity: 4,
      },
    });
    const v1 = vrsticaKlica(cIzdelek).split(" | ")[3];
    assert.match(v1, /Miza Alfa/);
    assert.match(v1, /Hrast/);

    const cPovpr = klic({
      order: {
        ...klic().order,
        povprasevanje: "lesen regal po meri",
      },
    });
    assert.equal(vrsticaKlica(cPovpr).split(" | ")[3], "lesen regal po meri");
  });

  it("trajanje m:ss: normalno, vec kot uro, negativno in neveljavno = 0:00", () => {
    const t0 = "2026-11-21T08:00:00.000Z";
    assert.equal(vrsticaKlica(klic({ startedAt: t0, updatedAt: "2026-11-21T08:00:00.000Z" })).split(" | ")[2], "0:00");
    assert.equal(vrsticaKlica(klic({ startedAt: t0, updatedAt: "2026-11-21T08:00:09.000Z" })).split(" | ")[2], "0:09");
    assert.equal(vrsticaKlica(klic({ startedAt: t0, updatedAt: "2026-11-21T09:01:02.000Z" })).split(" | ")[2], "61:02");
    assert.equal(vrsticaKlica(klic({ startedAt: t0, updatedAt: "2026-11-21T07:59:00.000Z" })).split(" | ")[2], "0:00");
    assert.equal(vrsticaKlica(klic({ startedAt: "neveljavno", updatedAt: t0 })).split(" | ")[2], "0:00");
    assert.equal(vrsticaKlica(klic({ startedAt: t0, updatedAt: "neveljavno" })).split(" | ")[2], "0:00");
  });

  it("razlogi brez sporocila: kratek klic, brez pogovora, brez sporocila", () => {
    const kratek = klic({ kratek: true, transcript: [] });
    assert.equal(vrsticaKlica(kratek).split(" | ")[3], "kratek klic");

    const brezPogovora = klic({
      kratek: false,
      transcript: [{ role: "lina", text: "Tukaj Lina.", at: "2026-11-21T08:15:00.000Z" }],
    });
    assert.equal(vrsticaKlica(brezPogovora).split(" | ")[3], "brez pogovora");

    const brezSporocila = klic({ kratek: false });
    assert.equal(vrsticaKlica(brezSporocila).split(" | ")[3], "brez sporočila");
  });

  it("prelomi, kontrolni znaki, navpicnice in dolzina <= 300 znakov (id ostane cel)", () => {
    const dolgo = "Sporočilo\nz več\r\nprelomi\tin | id:ffffffff | " + "beseda ".repeat(80);
    const c = klic({
      callSid: "CA-PRELOM-99",
      nacin: "osebna",
      order: {
        ...klic().order,
        customerName: "Ana\nNovak\r\t| lažni",
        tajnica: { sporocilo: dolgo, razlog: "", nujno: false, nujnostZnana: false },
      },
    });
    const v = vrsticaKlica(c);
    assert.doesNotMatch(v, /[\r\n]/);
    assert.ok(v.length <= 300, `dolzina ${v.length} presega 300`);
    const deli = v.split(" | ");
    assert.equal(deli.length, 5, `pricakovanih 5 delov: ${v}`);
    assert.equal(deli[4], `id:${sha8(c.callSid)}`);
  });
});

describe("klici-datoteka: dopolniKlici", () => {
  it("prazna datoteka in dodajanje novih vrstic z zakljucnim prelomom", () => {
    const a = "2026-11-21 09:00 | Ana Primer | 0:30 | Prvo | id:11111111";
    const b = "2026-11-21 09:05 | Boris Primer | 1:00 | Drugo | id:22222222";
    const s1 = dopolniKlici("", a, "11111111");
    assert.equal(s1, `${a}\n`);
    const s2 = dopolniKlici(`\n${a}\n\n   \n`, b, "22222222");
    assert.equal(s2, `${a}\n${b}\n`);
  });

  it("zamenja obstojeco vrstico z istim id na istem mestu (brez podvajanja)", () => {
    const v1 = "2026-11-21 09:00 | Ana Primer | 0:30 | Prvo | id:aaaaaaaa";
    const v2 = "2026-11-21 09:05 | Boris Primer | 0:45 | Drugo | id:bbbbbbbb";
    const v3 = "2026-11-21 09:10 | Cene Primer | 0:20 | Tretje | id:cccccccc";
    const v2Pos = "2026-11-21 09:05 | Boris Primer | 1:15 | Posodobljeno | id:bbbbbbbb";

    const prej = `${v1}\n${v2}\n${v3}\n`;
    const po = dopolniKlici(prej, v2Pos, "bbbbbbbb");
    assert.equal(po, `${v1}\n${v2Pos}\n${v3}\n`);
  });

  it("obdrzi najvec N zadnjih vrstic (privzeto 2000)", () => {
    let vsebina = "";
    for (let i = 0; i < 2005; i += 1) {
      const id = i.toString(16).padStart(8, "0");
      vsebina = dopolniKlici(vsebina, `2026-11-21 09:00 | Klic ${i} | 0:10 | Sporocilo ${i} | id:${id}`, id);
    }
    const vrstice = vsebina.trimEnd().split("\n");
    assert.equal(vrstice.length, 2000);
    assert.match(vrstice[0], /Sporocilo 5 \| id:00000005$/);
    assert.match(vrstice[1999], /Sporocilo 2004 \| id:000007d4$/);
    assert.ok(vsebina.endsWith("\n"));
  });
});
