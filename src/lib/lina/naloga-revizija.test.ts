/**
 * Preizkusi revizijske verige (naloga #45): povezava z zgoscenimi vrednostmi, odkrivanje posegov, sidro, zavrnitev skrivnosti.
 * Zlata vrednost je izracunana NEODVISNO (python hashlib nad kanonicnim nizom), ne s kodo pod preizkusom.
 * Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  NICELNA_ZGOSCENA,
  izracunajZgosceno,
  preveriVerigo,
  sestaviVnos,
  sidroIzVerige,
  vsebujeSkrivnost,
  type Vnos,
} from "./revizija.ts";

const T0 = new Date("2026-11-21T09:00:00.000Z");
const ZLATA_1 = "30a2f1a47347c5d306a6bde9eaf5c9b5a985dcad22f60a6afb586e7b0976432b";
const ZLATA_2 = "6f0183da23a0a8a8eb1a0102e12f9578303e7601bcf81d780c45aefdd2663f84";

function vnos(prejsnji: Vnos | null, opis: string, sekunde: number, podatki: Record<string, string | number | boolean | null> = {}): Vnos {
  const izid = sestaviVnos(prejsnji, { vrsta: "preizkus", opis, podatki }, new Date(T0.getTime() + sekunde * 1000));
  assert.equal(izid.ok, true, JSON.stringify(izid));
  if (!izid.ok) throw new Error("nemogoce");
  return izid.vnos;
}

function veriga(k: number): Vnos[] {
  const v: Vnos[] = [];
  for (let i = 0; i < k; i++) v.push(vnos(v[v.length - 1] ?? null, `vnos ${i + 1}`, i * 3));
  return v;
}

/** Ponaredek: spremeni vnos in mu pravilno izracuna SVOJO zgosceno vrednost (napadalec, ki zna zgoscevati). */
function prezgosti(v: Vnos, spremembe: Partial<Vnos>): Vnos {
  const { zgoscena: _stara, ...brez } = { ...v, ...spremembe };
  return { ...brez, zgoscena: izracunajZgosceno(brez) };
}

describe("revizija: sestava vnosa", () => {
  it("prvi vnos: n=1, nicelna prejsnja, zlata zgoscena vrednost", () => {
    const izid = sestaviVnos(null, { vrsta: "znanje.sprememba", opis: "Dodano znanje iz strani.", podatki: { b: "x", a: 1, c: true, d: null } }, T0);
    assert.ok(izid.ok);
    if (!izid.ok) return;
    assert.equal(izid.vnos.n, 1);
    assert.equal(izid.vnos.prejsnja, NICELNA_ZGOSCENA);
    assert.equal(izid.vnos.cas, "2026-11-21T09:00:00.000Z");
    assert.equal(izid.vnos.zgoscena, ZLATA_1);
  });

  it("drugi vnos: n=2, prejsnja je zgoscena prvega, zlata zgoscena vrednost", () => {
    const prvi = vnos(null, "Dodano znanje iz strani.", 0);
    const izid1 = sestaviVnos(null, { vrsta: "znanje.sprememba", opis: "Dodano znanje iz strani.", podatki: { b: "x", a: 1, c: true, d: null } }, T0);
    assert.ok(izid1.ok && izid1.vnos.zgoscena === ZLATA_1 && prvi.n === 1);
    if (!izid1.ok) return;
    const izid2 = sestaviVnos(izid1.vnos, { vrsta: "odobritev", opis: "Odobreno." }, new Date("2026-11-21T09:00:05.250Z"));
    assert.ok(izid2.ok);
    if (!izid2.ok) return;
    assert.equal(izid2.vnos.n, 2);
    assert.equal(izid2.vnos.prejsnja, ZLATA_1);
    assert.equal(izid2.vnos.zgoscena, ZLATA_2);
  });

  it("vrstni red kljucev podatkov ne vpliva na zgosceno vrednost", () => {
    const a = sestaviVnos(null, { vrsta: "x", opis: "o", podatki: { a: 1, b: 2 } }, T0);
    const b = sestaviVnos(null, { vrsta: "x", opis: "o", podatki: { b: 2, a: 1 } }, T0);
    assert.ok(a.ok && b.ok);
    if (a.ok && b.ok) assert.equal(a.vnos.zgoscena, b.vnos.zgoscena);
  });

  it("vsaka spremenjena polja dajo drugo zgosceno vrednost", () => {
    const osnova = vnos(null, "opis", 0, { a: 1 });
    const druge = [
      prezgosti(osnova, { n: 2 }),
      prezgosti(osnova, { cas: "2026-11-21T09:00:01.000Z" }),
      prezgosti(osnova, { vrsta: "druga" }),
      prezgosti(osnova, { opis: "opis2" }),
      prezgosti(osnova, { podatki: { a: 2 } }),
      prezgosti(osnova, { prejsnja: "1".repeat(64) }),
    ];
    for (const d of druge) assert.notEqual(d.zgoscena, osnova.zgoscena);
    assert.equal(new Set(druge.map((d) => d.zgoscena)).size, druge.length);
  });

  it("ura, ki skoci nazaj, se ne vpise nazaj (cas ostane enak prejsnjemu)", () => {
    const prvi = vnos(null, "prvi", 100);
    const izid = sestaviVnos(prvi, { vrsta: "x", opis: "drugi" }, new Date(T0.getTime() + 10_000));
    assert.ok(izid.ok);
    if (izid.ok) assert.equal(izid.vnos.cas, prvi.cas);
    const naprej = sestaviVnos(prvi, { vrsta: "x", opis: "tretji" }, new Date(T0.getTime() + 200_000));
    assert.ok(naprej.ok);
    if (naprej.ok) assert.equal(naprej.vnos.cas, new Date(T0.getTime() + 200_000).toISOString());
  });

  it("neveljaven cas se zavrne", () => {
    assert.deepEqual(sestaviVnos(null, { vrsta: "x", opis: "o" }, new Date(Number.NaN)), { ok: false, razlog: "cas" });
  });

  it("neveljavna vrsta", () => {
    for (const vrsta of ["", "Velika", "aVelika", "z presledkom", "-zacne", "a".repeat(41), "č"]) {
      assert.deepEqual(sestaviVnos(null, { vrsta, opis: "o" }, T0), { ok: false, razlog: "vrsta" }, vrsta);
    }
    assert.equal(sestaviVnos(null, { vrsta: "a".repeat(40), opis: "o" }, T0).ok, true);
    assert.equal(sestaviVnos(null, { vrsta: "znanje.iz-strani_1", opis: "o" }, T0).ok, true);
  });

  it("neveljaven opis", () => {
    for (const opis of ["", "   ", "x".repeat(301), "vrstica\nnova", "tab\tznak", "nul\u0000", "del\u007f"]) {
      assert.deepEqual(sestaviVnos(null, { vrsta: "x", opis }, T0), { ok: false, razlog: "opis" }, JSON.stringify(opis));
    }
    assert.equal(sestaviVnos(null, { vrsta: "x", opis: "x".repeat(300) }, T0).ok, true);
    assert.equal(sestaviVnos(null, { vrsta: "x", opis: "Čopič, šola, žaba" }, T0).ok, true);
  });

  it("neveljavni podatki", () => {
    const veliko: Record<string, number> = {};
    for (let i = 0; i <= 12; i++) veliko[`k${i}`] = i;
    const primeri: unknown[] = [
      veliko,
      { "s-vezajem": 1 },
      { "1zacne": 1 },
      { a: { b: 1 } },
      { a: [1] },
      { a: "x".repeat(201) },
      { a: Number.NaN },
      { a: Number.POSITIVE_INFINITY },
      { a: "vrstica\nnova" },
      [1, 2],
      null,
      "niz",
    ];
    for (const podatki of primeri) {
      const izid = sestaviVnos(null, { vrsta: "x", opis: "o", podatki: podatki as never }, T0);
      assert.deepEqual(izid, { ok: false, razlog: "podatki" }, JSON.stringify(podatki)?.slice(0, 60));
    }
    const meja: Record<string, number> = {};
    for (let i = 0; i < 12; i++) meja[`k${i}`] = i;
    assert.equal(sestaviVnos(null, { vrsta: "x", opis: "o", podatki: meja }, T0).ok, true);
    assert.equal(sestaviVnos(null, { vrsta: "x", opis: "o", podatki: { a: "x".repeat(200) } }, T0).ok, true);
  });
});

describe("revizija: skrivnosti se ne zapisujejo", () => {
  const skrivnosti = [
    `freellmapi-${"A".repeat(20)}`,
    `sk-${"b".repeat(20)}`,
    `Authorization: Bearer ${"c".repeat(24)}`,
    `AIza${"D".repeat(35)}`,
    `ghp_${"e".repeat(36)}`,
    "-----BEGIN PRIVATE KEY-----",
    "-----BEGIN RSA PRIVATE KEY-----",
  ];
  for (const s of skrivnosti) {
    it(`zavrne ${s.slice(0, 14)}... v opisu in v podatkih`, () => {
      assert.equal(vsebujeSkrivnost(s), true);
      assert.deepEqual(sestaviVnos(null, { vrsta: "x", opis: `uporabljen ${s}` }, T0), { ok: false, razlog: "skrivnost" });
      assert.deepEqual(sestaviVnos(null, { vrsta: "x", opis: "o", podatki: { kljuc: s } }, T0), { ok: false, razlog: "skrivnost" });
    });
  }

  it("navadno besedilo in zgoscena vrednost vsebine nista skrivnost", () => {
    assert.equal(vsebujeSkrivnost("freellmapi-kratek"), false);
    assert.equal(vsebujeSkrivnost("sk-kratek"), false);
    assert.equal(vsebujeSkrivnost("Bearer"), false);
    assert.equal(vsebujeSkrivnost("Dodano znanje s strani primer.si"), false);
    const izid = sestaviVnos(null, { vrsta: "x", opis: "o", podatki: { vsebina: createHash("sha256").update("a").digest("hex") } }, T0);
    assert.equal(izid.ok, true);
  });
});

describe("revizija: preverba verige", () => {
  it("prazna veriga je veljavna", () => {
    assert.deepEqual(preveriVerigo([]), { ok: true, stevilo: 0, zadnja: NICELNA_ZGOSCENA });
  });

  it("nepokvarjena veriga petih vnosov", () => {
    const v = veriga(5);
    assert.deepEqual(preveriVerigo(v), { ok: true, stevilo: 5, zadnja: v[4].zgoscena });
    for (let i = 1; i < v.length; i++) assert.equal(v[i].prejsnja, v[i - 1].zgoscena);
  });

  it("veriga, prebrana iz JSON, ostane veljavna", () => {
    const v = veriga(4);
    assert.equal(preveriVerigo(JSON.parse(JSON.stringify(v))).ok, true);
  });

  it("sprememba opisa ali podatkov ali vrste ali casa v sredini: zgoscena pri tistem vnosu", () => {
    for (const sprememba of [{ opis: "drugo" }, { podatki: { x: 1 } }, { vrsta: "druga" }, { cas: "2026-11-21T09:00:04.000Z" }] as Array<Partial<Vnos>>) {
      const v = veriga(5);
      v[2] = { ...v[2], ...sprememba };
      assert.deepEqual(preveriVerigo(v), { ok: false, n: 3, razlog: "zgoscena" }, JSON.stringify(sprememba));
    }
  });

  it("sprememba zadnjega vnosa se pozna", () => {
    const v = veriga(3);
    v[2] = { ...v[2], opis: "spremenjeno" };
    assert.deepEqual(preveriVerigo(v), { ok: false, n: 3, razlog: "zgoscena" });
  });

  it("sprememba z ponovno izracunano lastno zgosceno vrednostjo: pokvari povezavo naslednjega", () => {
    const v = veriga(5);
    v[2] = prezgosti(v[2], { opis: "ponarejeno" });
    assert.deepEqual(preveriVerigo(v), { ok: false, n: 4, razlog: "povezava" });
  });

  it("sprememba zadnjega vnosa s ponovnim izracunom brez sidra ostane neopazna, s sidrom pa ne", () => {
    const v = veriga(4);
    const sidro = sidroIzVerige(v);
    assert.ok(sidro);
    v[3] = prezgosti(v[3], { opis: "ponarejeno" });
    assert.equal(preveriVerigo(v).ok, true);
    assert.deepEqual(preveriVerigo(v, sidro ?? undefined), { ok: false, n: 4, razlog: "sidro" });
  });

  it("izbrisan vnos v sredini: zaporedje", () => {
    const v = veriga(5);
    v.splice(2, 1);
    assert.deepEqual(preveriVerigo(v), { ok: false, n: 3, razlog: "zaporedje" });
  });

  it("izbrisan prvi vnos: zaporedje", () => {
    const v = veriga(3);
    v.shift();
    assert.deepEqual(preveriVerigo(v), { ok: false, n: 1, razlog: "zaporedje" });
  });

  it("zamenjan vrstni red: zaporedje", () => {
    const v = veriga(4);
    [v[1], v[2]] = [v[2], v[1]];
    assert.deepEqual(preveriVerigo(v), { ok: false, n: 2, razlog: "zaporedje" });
  });

  it("vrinjen ponarejen vnos z veljavno lastno zgosceno vrednostjo, a napacno prejsnjo", () => {
    const v = veriga(4);
    const ponaredek = prezgosti(v[2], { prejsnja: "a".repeat(64) });
    v[2] = ponaredek;
    assert.deepEqual(preveriVerigo(v), { ok: false, n: 3, razlog: "povezava" });
  });

  it("prvi vnos s prejsnjo, ki ni nicelna: povezava", () => {
    const v = veriga(2);
    v[0] = prezgosti(v[0], { prejsnja: "f".repeat(64) });
    assert.deepEqual(preveriVerigo(v), { ok: false, n: 1, razlog: "povezava" });
  });

  it("okrnitev na koncu brez sidra ni vidna, s sidrom je", () => {
    const v = veriga(5);
    const sidro = sidroIzVerige(v);
    const krajsa = v.slice(0, 3);
    assert.equal(preveriVerigo(krajsa).ok, true);
    assert.deepEqual(preveriVerigo(krajsa, sidro ?? undefined), { ok: false, n: 5, razlog: "sidro" });
  });

  it("sidro srednjega vnosa: veljavno, ce veriga ostane enaka; krajsa od sidra ne", () => {
    const v = veriga(5);
    const sidro = { n: 3, zgoscena: v[2].zgoscena };
    assert.equal(preveriVerigo(v, sidro).ok, true);
    assert.equal(preveriVerigo(v.slice(0, 2), sidro).ok, false);
    assert.equal(preveriVerigo(v.slice(0, 3), sidro).ok, true);
  });

  it("popolnoma prepisana veriga (drugacna vsebina, veljavna sama zase) ne ustreza sidru", () => {
    const stara = veriga(3);
    const sidro = sidroIzVerige(stara);
    const nova: Vnos[] = [];
    for (let i = 0; i < 3; i++) nova.push(vnos(nova[nova.length - 1] ?? null, `drugo ${i}`, i * 3));
    assert.equal(preveriVerigo(nova).ok, true);
    assert.deepEqual(preveriVerigo(nova, sidro ?? undefined), { ok: false, n: 3, razlog: "sidro" });
  });

  it("neveljavna sidra", () => {
    const v = veriga(3);
    for (const sidro of [{ n: 0, zgoscena: v[0].zgoscena }, { n: 1.5, zgoscena: v[0].zgoscena }, { n: -1, zgoscena: v[0].zgoscena }, { n: 1, zgoscena: "xyz" }, { n: 4, zgoscena: v[2].zgoscena }]) {
      assert.equal(preveriVerigo(v, sidro).ok, false, JSON.stringify(sidro));
    }
  });

  it("cas, ki pada (z veljavnimi zgoscenimi vrednostmi): cas", () => {
    const v = veriga(3);
    const drugi = prezgosti(v[1], { cas: "2026-11-21T08:00:00.000Z" });
    const tretji = prezgosti(v[2], { prejsnja: drugi.zgoscena });
    assert.deepEqual(preveriVerigo([v[0], drugi, tretji]), { ok: false, n: 2, razlog: "cas" });
  });

  it("enak cas dveh zaporednih vnosov je dovoljen", () => {
    const a = vnos(null, "a", 5);
    const b = vnos(a, "b", 5);
    assert.equal(a.cas, b.cas);
    assert.equal(preveriVerigo([a, b]).ok, true);
  });

  it("oblika casa: napacna ali nemogoca", () => {
    for (const cas of ["2026-11-21 09:00:00.000Z", "2026-11-21T09:00:00Z", "2026-11-21T09:00:00.000+01:00", "2026-02-31T00:00:00.000Z", "danes"]) {
      const v = veriga(1);
      v[0] = prezgosti(v[0], { cas });
      assert.deepEqual(preveriVerigo(v), { ok: false, n: 1, razlog: "cas" }, cas);
    }
  });

  it("vsebina, ki jo sestava ne bi sprejela, tudi pri veljavni zgoscena: vsebina", () => {
    const v = veriga(2);
    v[1] = prezgosti(v[1], { opis: `kljuc freellmapi-${"Z".repeat(20)}` });
    assert.deepEqual(preveriVerigo(v), { ok: false, n: 2, razlog: "vsebina" });
    const w = veriga(1);
    w[0] = prezgosti(w[0], { vrsta: "Velika" });
    assert.deepEqual(preveriVerigo(w), { ok: false, n: 1, razlog: "vsebina" });
    const u = veriga(1);
    u[0] = prezgosti(u[0], { podatki: { a: { b: 1 } } as never });
    assert.deepEqual(preveriVerigo(u), { ok: false, n: 1, razlog: "vsebina" });
  });

  it("oblika: nepolje, nepravi vnosi, manjkajoca ali dodatna polja, napacne vrste", () => {
    assert.deepEqual(preveriVerigo({}), { ok: false, n: 0, razlog: "oblika" });
    assert.deepEqual(preveriVerigo("x"), { ok: false, n: 0, razlog: "oblika" });
    assert.deepEqual(preveriVerigo(null), { ok: false, n: 0, razlog: "oblika" });
    assert.deepEqual(preveriVerigo([null]), { ok: false, n: 1, razlog: "oblika" });
    assert.deepEqual(preveriVerigo([[]]), { ok: false, n: 1, razlog: "oblika" });
    assert.deepEqual(preveriVerigo(["niz"]), { ok: false, n: 1, razlog: "oblika" });
    const v = veriga(1)[0];
    const { opis: _o, ...brezOpisa } = v;
    assert.deepEqual(preveriVerigo([brezOpisa]), { ok: false, n: 1, razlog: "oblika" });
    assert.deepEqual(preveriVerigo([{ ...v, dodatno: 1 }]), { ok: false, n: 1, razlog: "oblika" });
    assert.deepEqual(preveriVerigo([{ ...v, n: "1" }]), { ok: false, n: 1, razlog: "oblika" });
    assert.deepEqual(preveriVerigo([{ ...v, n: 1.5 }]), { ok: false, n: 1, razlog: "oblika" });
    assert.deepEqual(preveriVerigo([{ ...v, podatki: null }]), { ok: false, n: 1, razlog: "vsebina" });
    assert.deepEqual(preveriVerigo([{ ...v, zgoscena: "xyz" }]), { ok: false, n: 1, razlog: "oblika" });
    assert.deepEqual(preveriVerigo([{ ...v, prejsnja: "ABC" }]), { ok: false, n: 1, razlog: "oblika" });
    assert.deepEqual(preveriVerigo([{ ...v, zgoscena: v.zgoscena.toUpperCase() }]), { ok: false, n: 1, razlog: "oblika" });
  });

  it("sidroIzVerige", () => {
    assert.equal(sidroIzVerige([]), null);
    const v = veriga(3);
    assert.deepEqual(sidroIzVerige(v), { n: 3, zgoscena: v[2].zgoscena });
  });

  it("dolga veriga (500 vnosov) se preveri in vsak poseg se najde", () => {
    const v = veriga(500);
    assert.equal(preveriVerigo(v).ok, true);
    for (const i of [0, 249, 499]) {
      const kopija = v.map((x) => ({ ...x }));
      kopija[i] = { ...kopija[i], opis: "poseg" };
      assert.deepEqual(preveriVerigo(kopija), { ok: false, n: i + 1, razlog: "zgoscena" });
    }
  });
});

describe("revizija: dodatni robovi", () => {
  it("dolzina kljuca podatka: 30 znakov se sprejme, 31 ne", () => {
    assert.equal(sestaviVnos(null, { vrsta: "x", opis: "o", podatki: { ["a".repeat(30)]: 1 } }, T0).ok, true);
    assert.deepEqual(sestaviVnos(null, { vrsta: "x", opis: "o", podatki: { ["a".repeat(31)]: 1 } }, T0), { ok: false, razlog: "podatki" });
  });

  it("zlata zgoscena vrednost z znaki izven ASCII (utf-8)", () => {
    const izid = sestaviVnos(null, { vrsta: "znanje.sprememba", opis: "Čopič, šola, žaba", podatki: { ime: "Škofja Loka" } }, T0);
    assert.ok(izid.ok);
    if (izid.ok) assert.equal(izid.vnos.zgoscena, "60de0a44242f38d288eab7a9e5e086f5291201c5ab8a1ac2db01dda3da5c702d");
  });

  it("napacne vrste polj vnosa: oblika", () => {
    const v = veriga(1)[0];
    const napacna: Array<[string, unknown]> = [["cas", 5], ["vrsta", 5], ["opis", 5], ["podatki", "x"], ["prejsnja", 5], ["zgoscena", 5], ["n", null]];
    for (const [polje, vrednost] of napacna) {
      assert.deepEqual(preveriVerigo([{ ...v, [polje]: vrednost }]), { ok: false, n: 1, razlog: "oblika" }, polje);
    }
  });

  it("podatki null ob sestavi se zavrnejo, manjkajoci pomenijo prazne", () => {
    assert.deepEqual(sestaviVnos(null, { vrsta: "x", opis: "o", podatki: null as never }, T0), { ok: false, razlog: "podatki" });
    const brez = sestaviVnos(null, { vrsta: "x", opis: "o" }, T0);
    assert.ok(brez.ok);
    if (brez.ok) assert.deepEqual(brez.vnos.podatki, {});
  });

  it("vnos ne deli objekta podatkov z vhodom", () => {
    const podatki = { a: 1 };
    const izid = sestaviVnos(null, { vrsta: "x", opis: "o", podatki }, T0);
    assert.ok(izid.ok);
    podatki.a = 2;
    if (izid.ok) assert.deepEqual(izid.vnos.podatki, { a: 1 });
  });
});

describe("revizija: robovi zgoscenih vrednosti, podatkov in sidra", () => {
  it("zgoscena in prejsnja morata imeti natancno 64 znakov", () => {
    const v = veriga(1)[0];
    for (const spr of [{ zgoscena: v.zgoscena.slice(1) }, { zgoscena: `${v.zgoscena}a` }, { prejsnja: "a".repeat(63) }, { prejsnja: "a".repeat(65) }] as Array<Partial<Vnos>>) {
      assert.deepEqual(preveriVerigo([{ ...v, ...spr }]), { ok: false, n: 1, razlog: "oblika" }, JSON.stringify(spr).slice(0, 40));
    }
  });

  it("podatki: prazno polje, stevilo, logicna vrednost in prazen niz niso predmet", () => {
    for (const podatki of [[], 5, true, ""]) {
      assert.deepEqual(sestaviVnos(null, { vrsta: "x", opis: "o", podatki: podatki as never }, T0), { ok: false, razlog: "podatki" }, JSON.stringify(podatki));
    }
  });

  it("sidro prvega vnosa je veljavno", () => {
    const v = veriga(3);
    assert.equal(preveriVerigo(v, { n: 1, zgoscena: v[0].zgoscena }).ok, true);
    assert.equal(preveriVerigo(v, { n: 3, zgoscena: v[2].zgoscena }).ok, true);
  });

  it("cas z nemogocim datumom, brez milisekund ali z razsirjenim letom je zavrnjen", () => {
    for (const cas of ["2026-02-31T00:00:00.000Z", "2026-11-21T09:00:00Z", "+020000-01-01T00:00:00.000Z", "2026-13-45T00:00:00.000Z"]) {
      const v = veriga(1);
      v[0] = prezgosti(v[0], { cas });
      assert.deepEqual(preveriVerigo(v), { ok: false, n: 1, razlog: "cas" }, cas);
    }
  });
});
