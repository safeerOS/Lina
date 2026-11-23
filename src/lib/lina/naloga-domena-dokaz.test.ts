/**
 * Preizkusi cistega modula domena-dokaz.ts (naloga #44): neobvezen dokaz nadzora nad domeno, samo oznaka (ne vrata).
 * Brez omrezja. Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IME_TXT_PREDPONA,
  NAJVEC_BAJTOV_DATOTEKE,
  POT_DATOTEKE,
  PREDPONA_TXT,
  VELJAVNOST_DNI,
  imeTxtZapisa,
  jeDokazVeljaven,
  jeGostiteljPotrjen,
  jeVeljavenZeton,
  normirajGostitelja,
  opozoriloPodobneDomene,
  preveriTeloDatoteke,
  preveriTxtZapise,
  vrednostTxtZapisa,
  zetonIzBajtov,
} from "./domena-dokaz.ts";

const Z = "0123456789abcdef0123456789abcdef";
const DAN = 24 * 60 * 60 * 1000;
const ZDAJ = new Date("2026-11-21T10:00:00Z");
const prej = (dni: number): string => new Date(ZDAJ.getTime() - dni * DAN).toISOString();

describe("konstante dolocajo obliko dokaza", () => {
  it("imena in poti", () => {
    assert.equal(PREDPONA_TXT, "lina-preverjanje=");
    assert.equal(IME_TXT_PREDPONA, "_lina-preverjanje");
    assert.equal(POT_DATOTEKE, "/.well-known/lina-preverjanje.txt");
    assert.equal(NAJVEC_BAJTOV_DATOTEKE, 200);
    assert.equal(VELJAVNOST_DNI, 180);
  });
});

describe("zeton", () => {
  it("iz 16 in 32 bajtov: 32 oziroma 64 malih sestnajstiskih znakov", () => {
    assert.equal(zetonIzBajtov(new Uint8Array(16).fill(255)), "ff".repeat(16));
    assert.equal(zetonIzBajtov(Uint8Array.from({ length: 32 }, (_, i) => i)).length, 64);
  });
  it("vec kot 32 bajtov se odreze na 64 znakov", () => {
    assert.equal(zetonIzBajtov(new Uint8Array(48).fill(1)), "01".repeat(32));
  });
  it("manj kot 16 bajtov je napaka", () => {
    assert.throws(() => zetonIzBajtov(new Uint8Array(15)), /16/);
  });
  it("bajt 0x0a ima vodilno niclo", () => {
    assert.equal(zetonIzBajtov(new Uint8Array(16).fill(10)), "0a".repeat(16));
  });
  it("veljavnost: samo mali sestnajstiski 32 do 64", () => {
    assert.equal(jeVeljavenZeton(Z), true);
    assert.equal(jeVeljavenZeton("a".repeat(64)), true);
    assert.equal(jeVeljavenZeton("a".repeat(31)), false);
    assert.equal(jeVeljavenZeton("a".repeat(65)), false);
    assert.equal(jeVeljavenZeton("A".repeat(32)), false);
    assert.equal(jeVeljavenZeton("g".repeat(32)), false);
    assert.equal(jeVeljavenZeton(`${Z}\n`), false);
    assert.equal(jeVeljavenZeton(123), false);
    assert.equal(jeVeljavenZeton(null), false);
  });
});

describe("normirajGostitelja", () => {
  it("male crke in pika na koncu", () => {
    assert.equal(normirajGostitelja("Podjetje.SI."), "podjetje.si");
    assert.equal(normirajGostitelja("  www.Podjetje.si "), "www.podjetje.si");
  });
  it("zavrne IP, lokalna imena, eno oznako in napacne oznake", () => {
    for (const slab of [
      "1.2.3.4",
      "localhost",
      "a.localhost",
      "streznik.local",
      "x.internal",
      "podjetje",
      "pod_jetje.si",
      "pod jetje.si",
      "a..si",
      "-a.si",
      "a-.si",
      "",
      `${"a".repeat(64)}.si`,
      `${"a.".repeat(130)}si`,
    ]) {
      assert.equal(normirajGostitelja(slab), null, slab);
    }
    assert.equal(normirajGostitelja(42), null);
    assert.equal(normirajGostitelja(undefined), null);
  });
});

describe("TXT zapis", () => {
  it("ime in vrednost", () => {
    assert.equal(imeTxtZapisa("Podjetje.si"), "_lina-preverjanje.podjetje.si");
    assert.equal(imeTxtZapisa("1.2.3.4"), null);
    assert.equal(vrednostTxtZapisa(Z), `lina-preverjanje=${Z}`);
    assert.throws(() => vrednostTxtZapisa("kratek"), /Neveljaven/);
  });
  it("ujemanje celega zapisa, tudi iz kosov dns.resolveTxt", () => {
    assert.equal(preveriTxtZapise([`lina-preverjanje=${Z}`], Z), true);
    assert.equal(preveriTxtZapise([["lina-preverjanje=", Z.slice(0, 10), Z.slice(10)]], Z), true);
    assert.equal(preveriTxtZapise(["v=spf1 -all", [`lina-preverjanje=${Z}`]], Z), true);
    assert.equal(preveriTxtZapise([`  lina-preverjanje=${Z}\n`], Z), true);
  });
  it("neujemanje: drug zeton, pripona, predpona, golo besedilo, velike crke, prazen seznam", () => {
    const drug = "f".repeat(32);
    assert.equal(preveriTxtZapise([`lina-preverjanje=${drug}`], Z), false);
    assert.equal(preveriTxtZapise([`lina-preverjanje=${Z}x`], Z), false);
    assert.equal(preveriTxtZapise([`x lina-preverjanje=${Z}`], Z), false);
    assert.equal(preveriTxtZapise([Z], Z), false);
    assert.equal(preveriTxtZapise([`LINA-PREVERJANJE=${Z}`], Z), false);
    assert.equal(preveriTxtZapise([`lina-preverjanje=${Z.slice(0, 31)}`], Z), false);
    assert.equal(preveriTxtZapise([], Z), false);
  });
  it("neveljaven zeton nikoli ne potrdi", () => {
    assert.equal(preveriTxtZapise(["lina-preverjanje=abc", "abc"], "abc"), false);
    assert.equal(preveriTxtZapise([`lina-preverjanje=`], ""), false);
  });
});

describe("datoteka /.well-known", () => {
  it("cela vsebina je zeton ali zeton s predpono", () => {
    assert.equal(preveriTeloDatoteke(Z, Z), true);
    assert.equal(preveriTeloDatoteke(`${Z}\n`, Z), true);
    assert.equal(preveriTeloDatoteke(`lina-preverjanje=${Z}\r\n`, Z), true);
    assert.equal(preveriTeloDatoteke(new TextEncoder().encode(Z), Z), true);
  });
  it("stran z zetonom v besedilu ali HTML ne velja", () => {
    assert.equal(preveriTeloDatoteke(`<html><body>${Z}</body></html>`, Z), false);
    assert.equal(preveriTeloDatoteke(`koda: ${Z}`, Z), false);
    assert.equal(preveriTeloDatoteke(`${Z}\nse nekaj`, Z), false);
    assert.equal(preveriTeloDatoteke(`${Z}x`, Z), false);
    assert.equal(preveriTeloDatoteke("f".repeat(32), Z), false);
  });
  it("prazno in predolgo telo ter neveljaven zeton", () => {
    assert.equal(preveriTeloDatoteke("", Z), false);
    assert.equal(preveriTeloDatoteke("   \n", Z), false);
    assert.equal(preveriTeloDatoteke(`${Z}${" ".repeat(NAJVEC_BAJTOV_DATOTEKE)}`, Z), false);
    assert.equal(preveriTeloDatoteke("abc", "abc"), false);
  });
});

describe("veljavnost dokaza", () => {
  it("do 180 dni velja, od 180 dni ne", () => {
    assert.equal(jeDokazVeljaven(prej(0), ZDAJ), true);
    assert.equal(jeDokazVeljaven(prej(179), ZDAJ), true);
    assert.equal(jeDokazVeljaven(prej(180), ZDAJ), false);
    assert.equal(jeDokazVeljaven(prej(400), ZDAJ), false);
  });
  it("prihodnost in nesmisel ne veljata", () => {
    assert.equal(jeDokazVeljaven(prej(-1), ZDAJ), false);
    assert.equal(jeDokazVeljaven("jutri", ZDAJ), false);
    assert.equal(jeDokazVeljaven("", ZDAJ), false);
  });
});

describe("jeGostiteljPotrjen", () => {
  const p = [{ domena: "podjetje.si", potrjenoOb: prej(10) }];
  it("domena in poddomene", () => {
    assert.equal(jeGostiteljPotrjen("podjetje.si", p, ZDAJ), true);
    assert.equal(jeGostiteljPotrjen("www.podjetje.si", p, ZDAJ), true);
    assert.equal(jeGostiteljPotrjen("a.b.podjetje.si", p, ZDAJ), true);
    assert.equal(jeGostiteljPotrjen("WWW.Podjetje.SI.", p, ZDAJ), true);
  });
  it("sorodna imena in starsi niso pokriti", () => {
    assert.equal(jeGostiteljPotrjen("evilpodjetje.si", p, ZDAJ), false);
    assert.equal(jeGostiteljPotrjen("podjetje.si.evil.com", p, ZDAJ), false);
    assert.equal(jeGostiteljPotrjen("podjetje.com", p, ZDAJ), false);
    assert.equal(jeGostiteljPotrjen("podjetje.si", [{ domena: "www.podjetje.si", potrjenoOb: prej(1) }], ZDAJ), false);
    assert.equal(jeGostiteljPotrjen("si", p, ZDAJ), false);
  });
  it("potekel dokaz se prezre, drugi veljavni pa velja", () => {
    const stari = [{ domena: "podjetje.si", potrjenoOb: prej(200) }];
    assert.equal(jeGostiteljPotrjen("podjetje.si", stari, ZDAJ), false);
    assert.equal(jeGostiteljPotrjen("podjetje.si", [...stari, { domena: "podjetje.si", potrjenoOb: prej(5) }], ZDAJ), true);
  });
  it("neveljaven gostitelj ali domena v seznamu", () => {
    assert.equal(jeGostiteljPotrjen("1.2.3.4", [{ domena: "1.2.3.4", potrjenoOb: prej(1) }], ZDAJ), false);
    assert.equal(jeGostiteljPotrjen("podjetje.si", [{ domena: "", potrjenoOb: prej(1) }], ZDAJ), false);
    assert.equal(jeGostiteljPotrjen("podjetje.si", [], ZDAJ), false);
  });
});

describe("opozorilo pri podobnih domenah", () => {
  it("punycode in ne-ASCII", () => {
    assert.equal(opozoriloPodobneDomene("xn--pdjetje-9xa.si"), "mednarodni-znaki");
    assert.equal(opozoriloPodobneDomene("www.xn--e1awd7f.com"), "mednarodni-znaki");
    // Druga crka je cirilicni o (U+043E): namerna podobnost latinskemu o.
    assert.equal(opozoriloPodobneDomene("pоdjetje.si"), "mednarodni-znaki");
    assert.equal(opozoriloPodobneDomene("XN--abc.si."), "mednarodni-znaki");
  });
  it("navadna domena nima opozorila", () => {
    assert.equal(opozoriloPodobneDomene("podjetje.si"), null);
    assert.equal(opozoriloPodobneDomene("moj-xn.si"), null);
    assert.equal(opozoriloPodobneDomene("www.podjetje.si."), null);
  });
});
