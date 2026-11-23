import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filtrirajIzhod, type Kategorija } from "./izhodni-filter.ts";

describe("izhodni-filter (cista enota)", () => {
  it("vedno zakrije kljuce in zetone (tudi pri vsebinaKlica: true) in jih ne obnovi", () => {
    const kljuci = [
      "sk-test00000000000000000001",
      "sk-ant-test000000000000000001",
      "AIzaSyTest0000000000000000000000000",
      "ya29.test00000000000000000001",
      "ghp_test0000000000000000000000000001",
      "xoxb-0000000000-0000000000-test00000000",
    ];
    const dolgi = [
      "0123456789abcdef0123456789abcdef",
      "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=",
      "fedcba9876543210fedcba9876543210",
      "QWxhZGRpbjpvcGVuIHNlc2FtZTAxMjM0NTY3ODk=",
    ];
    const vhod = [
      `OpenAI ${kljuci[0]} in Claude ${kljuci[1]}`,
      `Google ${kljuci[2]} ter OAuth ${kljuci[3]}.`,
      `GitHub ${kljuci[4]} in Slack ${kljuci[5]}`,
      `kljuc: ${dolgi[0]}`,
      `token=${dolgi[1]}`,
      `key: ${dolgi[2]}`,
      `secret=${dolgi[3].replace(/\s+/g, "A")}`,
    ].join("\n");

    const izid = filtrirajIzhod(vhod, { vsebinaKlica: true });
    for (const k of [...kljuci, ...dolgi.map((d) => d.replace(/\s+/g, "A"))]) {
      assert.equal(izid.besedilo.includes(k), false, `Kljuc ne sme ostati v izhodu: ${k}`);
    }
    assert.equal(izid.kategorije.kljuc, 10);
    assert.equal(izid.besedilo.includes("[KLJUC]"), true);
    // Kljuc se v odgovoru ne obnovi.
    assert.equal(izid.obnovi("Uporabil sem [KLJUC]."), "Uporabil sem [KLJUC].");
    assert.equal(JSON.stringify(izid.kategorije).includes("sk-"), false);
  });

  it("vedno zakrije gesla po vzorcih geslo:, password=, pass: do konca besede in jih ne obnovi", () => {
    const vhod = "Prijava geslo: TajnoGeslo123, nato password=Drugo!Geslo9 in pass: tretje_geslo. Konec.";
    const izid = filtrirajIzhod(vhod, { vsebinaKlica: true });
    assert.equal(izid.besedilo.includes("TajnoGeslo123"), false);
    assert.equal(izid.besedilo.includes("Drugo!Geslo9"), false);
    assert.equal(izid.besedilo.includes("tretje_geslo"), false);
    assert.equal(izid.besedilo, "Prijava geslo: [GESLO], nato password=[GESLO] in pass: [GESLO]. Konec.");
    assert.equal(izid.kategorije.geslo, 3);
    assert.equal(izid.obnovi("Vnesite [GESLO]."), "Vnesite [GESLO].");
  });

  it("zakrije kartice 13-19 stevk samo ce Luhn velja; nakljucne 16-mestne pusti", () => {
    const veljavna1 = "4111 1111 1111 1111";
    const veljavna2 = "4111-1111-1111-1111";
    const veljavna3 = "4000000000000002";
    const neveljavna1 = "4111 1111 1111 1112";
    const neveljavna2 = "1234567890123456";
    const vhod = `Kartice ${veljavna1}, ${veljavna2}, ${veljavna3}; ni kartica ${neveljavna1} in ${neveljavna2}.`;

    const izid = filtrirajIzhod(vhod, { vsebinaKlica: true });
    assert.equal(izid.besedilo.includes(veljavna1), false);
    assert.equal(izid.besedilo.includes(veljavna2), false);
    assert.equal(izid.besedilo.includes(veljavna3), false);
    assert.equal(izid.besedilo.includes(neveljavna1), true);
    assert.equal(izid.besedilo.includes(neveljavna2), true);
    assert.equal(izid.kategorije.kartica, 3);
    assert.equal(izid.besedilo.includes("[KARTICA]"), true);
    assert.equal(izid.obnovi("Placilo [KARTICA]."), "Placilo [KARTICA].");
  });

  it("zakrije veljaven IBAN (dolzina in mod 97), neveljavnega pa pusti", () => {
    // SI56 0000 0000 0000 001: 000000000000001281856 mod 97 === 1 (izmisljen veljaven IBAN).
    const veljavenSi = "SI56 0000 0000 0000 001";
    const veljavenDe = "DE89 3704 0044 0532 0130 00";
    // SI56 0000 0000 0000 000: mod 97 !== 1 (neveljaven).
    const neveljavenMod = "SI56 0000 0000 0000 000";
    const neveljavenDolzina = "SI56 0000 0000 0000 01";
    const vhod = `Racun ${veljavenSi} in ${veljavenDe} za nakazilo; napacna ${neveljavenMod} ter ${neveljavenDolzina}.`;

    const izid = filtrirajIzhod(vhod, { vsebinaKlica: true });
    assert.equal(izid.besedilo.includes(veljavenSi), false);
    assert.equal(izid.besedilo.includes(veljavenDe), false);
    assert.equal(izid.besedilo.includes(neveljavenMod), true);
    assert.equal(izid.besedilo.includes(neveljavenDolzina), true);
    assert.equal(izid.kategorije.iban, 2);
    assert.equal(izid.kategorije.kartica, 0);
    assert.equal(izid.obnovi("Nakazi na [IBAN]."), "Nakazi na [IBAN].");
  });

  it("pri asistentki (vsebinaKlica: false) psevdonimizira stike, enak stik dobi enak psevdonim in obnovi deluje", () => {
    const vhod =
      "Pisi na ana@primer.si in kopijo na marko@primer.si ter se enkrat ana@primer.si. " +
      "Poklici +386 40 000 001, 040 000 002, 041000003 ali spet +386 40 000 001.";

    const izid = filtrirajIzhod(vhod, { vsebinaKlica: false });
    assert.equal(izid.besedilo.includes("ana@primer.si"), false);
    assert.equal(izid.besedilo.includes("marko@primer.si"), false);
    assert.equal(izid.besedilo.includes("+386 40 000 001"), false);
    assert.equal(izid.besedilo.includes("040 000 002"), false);
    assert.equal(izid.besedilo.includes("041000003"), false);

    assert.equal(
      izid.besedilo,
      "Pisi na [E-POSTA-1] in kopijo na [E-POSTA-2] ter se enkrat [E-POSTA-1]. " +
        "Poklici [TELEFON-1], [TELEFON-2], [TELEFON-3] ali spet [TELEFON-1].",
    );
    assert.equal(izid.kategorije.eposta, 3);
    assert.equal(izid.kategorije.telefon, 4);

    const odgovorModela = "Poslal sem na [E-POSTA-1] in [E-POSTA-2] ter klical [TELEFON-1], [TELEFON-2] in [TELEFON-3].";
    assert.equal(
      izid.obnovi(odgovorModela),
      "Poslal sem na ana@primer.si in marko@primer.si ter klical +386 40 000 001, 040 000 002 in 041000003.",
    );
  });

  it("pri klicu (vsebinaKlica: true) stikov NE zakrije", () => {
    const vhod = "Klicatelj Ana Primer, telefon +386 40 000 001, 040 000 002, 041000003, e-posta ana@primer.si.";
    const izid = filtrirajIzhod(vhod, { vsebinaKlica: true });
    assert.equal(izid.besedilo, vhod);
    assert.equal(izid.kategorije.eposta, 0);
    assert.equal(izid.kategorije.telefon, 0);
  });

  it("brez lazno pozitivnih: kolicina, leto, ura, obicajne besede in 9-mestna slovenska stevilka brez Luhn", () => {
    const vhod =
      "Narocilo: kolicina 100, leto 2026, ura 15:00, datum 19. 11. 2026. " +
      "Pozabil sem geslo in kljuc od delavnice. Stevilka klicatelja 040 000 005 in 041000006.";

    const klicIzid = filtrirajIzhod(vhod, { vsebinaKlica: true });
    assert.equal(klicIzid.besedilo, vhod);
    for (const st of Object.values(klicIzid.kategorije)) assert.equal(st, 0);

    const asistentBesedilo = "Narocilo: kolicina 100, leto 2026, ura 15:00, datum 19. 11. 2026. Pozabil sem geslo in kljuc od delavnice.";
    const asistentIzid = filtrirajIzhod(asistentBesedilo, { vsebinaKlica: false });
    assert.equal(asistentIzid.besedilo, asistentBesedilo);
    for (const st of Object.values(asistentIzid.kategorije)) assert.equal(st, 0);
  });

  it("kategorije vsebujejo samo stevila in nikoli izvirnih vrednosti", () => {
    const vhod =
      "kljuc: sk-test00000000000000000099 geslo: Skrivno99 kartica 4111 1111 1111 1111 " +
      "iban SI56 0000 0000 0000 001 stik ana@primer.si +386 40 000 009";
    const izid = filtrirajIzhod(vhod, { vsebinaKlica: false });

    const kljuciKategorij: Kategorija[] = ["kljuc", "geslo", "kartica", "iban", "eposta", "telefon"];
    for (const k of kljuciKategorij) {
      assert.equal(typeof izid.kategorije[k], "number");
      assert.equal(izid.kategorije[k], 1, k);
    }
    const json = JSON.stringify(izid.kategorije);
    for (const tajno of ["sk-test", "Skrivno99", "4111", "SI56", "ana@primer.si", "386"]) {
      assert.equal(json.includes(tajno), false, tajno);
    }
  });
});
