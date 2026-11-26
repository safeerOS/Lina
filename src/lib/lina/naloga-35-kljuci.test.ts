import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAS_UVOZA,
  NAJVEC_NAPREJ_MS,
  idSpora,
  javniKljucPara,
  korakRacunalnika,
  kljucPara,
  noviParKljucev,
  poOdgovoruTelefona,
  pripraviTelefon,
  veljavenZapis,
  zZice,
  zaZico,
  zdruzi,
  type PonudnikKljuca,
  type Sloti,
  type StanjeNabora,
  type StanjeTelefona,
  type ZapisKljuca,
} from "./kljuci-mozganov.ts";

// NALOGA-35 (lastnik 26. 11. 2026): kljuc, vnesen na eni napravi, je na vseh seznanjenih; odstranitev se prenese; rele vidi samo sifrat.
const oznaka = (p: PonudnikKljuca) => `Kljuc ${p}`;
const K1 = "AIzaTESTkljuc-ena-1111";
const K2 = "AIzaTESTkljuc-dva-2222";
const K3 = "sk-TESTkljuc-tri-3333";

class Racunalnik {
  st: StanjeNabora = { zapisi: [], aktivni: {}, uvozeno: false };
  sloti: Sloti = {};
  par = noviParKljucev();
  telefoni = new Map<string, string>();
  rele: string[] = [];
  jaz = "r-racunalnik";
  lokalno(zdaj: number) {
    const k = korakRacunalnika(this.st, this.sloti, [], this.jaz, zdaj, oznaka);
    this.uporabi(k.stanje, k.uporaba.sloti);
  }
  private uporabi(st: StanjeNabora, sloti: Partial<Record<PonudnikKljuca, string | null>>) {
    this.st = st;
    for (const [p, v] of Object.entries(sloti) as Array<[PonudnikKljuca, string | null]>) {
      if (v === null) delete this.sloti[p];
      else this.sloti[p] = v;
    }
  }
  /** POST /kljuci: telo je JSON niz (kot na zici), odgovor tudi. */
  zahteva(telo: string, zdaj: number): string {
    this.rele.push(telo);
    const v = JSON.parse(telo) as { id: string; javni: string; zapisi: unknown[] };
    if (!this.telefoni.has(v.id)) throw new Error("ni seznanjen");
    const javni = javniKljucPara(v.javni);
    assert.ok(javni);
    const k = kljucPara(this.par.zasebni, javni, v.id);
    const prejeti = v.zapisi.map((z) => zZice(z, k, "telefon-racunalnik")).filter((z): z is ZapisKljuca => z !== null);
    const korak = korakRacunalnika(this.st, this.sloti, prejeti, this.jaz, zdaj, oznaka);
    this.uporabi(korak.stanje, korak.uporaba.sloti);
    const odg = JSON.stringify({ javni: this.par.javni, zapisi: this.st.zapisi.map((z) => zaZico(z, k, "racunalnik-telefon")) });
    this.rele.push(odg);
    return odg;
  }
}

class Telefon {
  st: StanjeTelefona = { zapisi: [], aktivni: {}, uvozeno: false, neposlani: [] };
  sloti: Sloti = {};
  par = noviParKljucev();
  javniRacunalnika: string | null = null;
  odstranjeni: PonudnikKljuca[] = [];
  id: string;
  constructor(id: string) {
    this.id = id;
  }
  sinhroniziraj(r: Racunalnik, zdaj: number, medIzmenjavo?: () => void) {
    for (let krog = 0; krog < 4; krog++) {
      const slotiPrej = { ...this.sloti };
      const p = pripraviTelefon(this.st, this.sloti, this.id, zdaj, oznaka);
      this.st = p.stanje;
      const k = this.javniRacunalnika ? kljucPara(this.par.zasebni, javniKljucPara(this.javniRacunalnika)!, this.id) : null;
      // brez kljuca racunalnika (prvi krog) se ne poslje noben zapis
      const zapisi = k ? p.poslji.map((z) => zaZico(z, k, "telefon-racunalnik")) : [];
      const odg = JSON.parse(r.zahteva(JSON.stringify({ id: this.id, javni: this.par.javni, zapisi }), zdaj)) as { javni: string; zapisi: unknown[] };
      medIzmenjavo?.();
      medIzmenjavo = undefined;
      this.javniRacunalnika = odg.javni;
      const kk = kljucPara(this.par.zasebni, javniKljucPara(odg.javni)!, this.id);
      const prejeti = odg.zapisi.map((z) => zZice(z, kk, "racunalnik-telefon")).filter((z): z is ZapisKljuca => z !== null);
      const po = poOdgovoruTelefona(this.st, k ? p.poslji : [], prejeti, slotiPrej, this.sloti, this.id, zdaj, oznaka);
      this.st = po.stanje;
      for (const [pp, v] of Object.entries(po.uporaba.sloti) as Array<[PonudnikKljuca, string | null]>) {
        if (v === null) delete this.sloti[pp];
        else this.sloti[pp] = v;
      }
      this.odstranjeni.push(...po.uporaba.odstranjeni);
      if (!po.znova) return;
    }
  }
}

const nabor = (zapisi: ZapisKljuca[]) => zapisi.map((z) => `${z.id}|${z.ponudnik}|${z.oznaka}|${z.izbrisan}|${z.vrednost}`).sort().join("\n");

function trije() {
  const r = new Racunalnik();
  const a = new Telefon("n-aaaaaaaaaaaaaaaa");
  const b = new Telefon("n-bbbbbbbbbbbbbbbb");
  r.telefoni.set(a.id, a.par.javni);
  r.telefoni.set(b.id, b.par.javni);
  return { r, a, b };
}

test("naloga 35: kljuc, dodan na telefonu A, imata racunalnik in telefon B (isti nabor, B ga uporablja)", () => {
  const { r, a, b } = trije();
  a.sinhroniziraj(r, 1000);
  b.sinhroniziraj(r, 1000);
  a.sloti.gemini = K1;
  a.sinhroniziraj(r, 2000);
  b.sinhroniziraj(r, 3000);
  assert.equal(r.sloti.gemini, K1);
  assert.equal(b.sloti.gemini, K1);
  assert.equal(nabor(r.st.zapisi), nabor(a.st.zapisi));
  assert.equal(nabor(r.st.zapisi), nabor(b.st.zapisi));
  assert.equal(r.st.zapisi.filter((z) => !z.izbrisan).length, 1);
});

test("naloga 35: odstranitev na racunalniku se prenese na oba telefona (grob, prazen slot, vidno obvestilo)", () => {
  const { r, a, b } = trije();
  r.sloti.openai = K3;
  r.lokalno(1000);
  a.sinhroniziraj(r, 1100);
  b.sinhroniziraj(r, 1100);
  assert.equal(a.sloti.openai, K3);
  delete r.sloti.openai;
  r.lokalno(2000);
  a.sinhroniziraj(r, 2100);
  b.sinhroniziraj(r, 2100);
  assert.equal(a.sloti.openai, undefined);
  assert.equal(b.sloti.openai, undefined);
  assert.deepEqual(a.odstranjeni, ["openai"]);
  assert.ok(a.st.zapisi.every((z) => z.izbrisan && z.vrednost === ""));
  assert.equal(nabor(r.st.zapisi), nabor(b.st.zapisi));
});

test("naloga 35: sifrat na releju ne vsebuje kljuca (zahteve in odgovori)", () => {
  const { r, a, b } = trije();
  a.sinhroniziraj(r, 1000);
  a.sloti.gemini = K1;
  a.sloti.openai = K3;
  a.sinhroniziraj(r, 2000);
  b.sinhroniziraj(r, 3000);
  assert.equal(b.sloti.openai, K3);
  const vse = r.rele.join("\n");
  assert.ok(vse.includes('"ovoj"'));
  for (const k of [K1, K3]) {
    assert.ok(!vse.includes(k), "kljuc v cistem besedilu na zici");
    assert.ok(!vse.includes(Buffer.from(k).toString("base64")), "kljuc v base64 na zici");
  }
});

test("naloga 35: vrednost v cistem besedilu ali ovojnica drugega para se ne sprejme", () => {
  const z: ZapisKljuca = { id: "0123456789abcdef", ponudnik: "gemini", oznaka: "x", cas: 5, naprava: "n-a", izbrisan: false, prej: "", vrednost: K1 };
  const p1 = noviParKljucev();
  const p2 = noviParKljucev();
  const pravi = kljucPara(p1.zasebni, javniKljucPara(p2.javni)!, "n-a");
  const tuj = kljucPara(noviParKljucev().zasebni, javniKljucPara(p2.javni)!, "n-a");
  assert.equal(zZice({ ...z }, pravi, "telefon-racunalnik"), null, "cista vrednost");
  assert.equal(zZice(zaZico(z, tuj, "telefon-racunalnik"), pravi, "telefon-racunalnik"), null, "tuj par");
  assert.equal(zZice(zaZico(z, pravi, "racunalnik-telefon"), pravi, "telefon-racunalnik"), null, "odboj v drugo smer");
  assert.equal(zZice({ ...zaZico(z, pravi, "telefon-racunalnik"), cas: 6 }, pravi, "telefon-racunalnik"), null, "spremenjen cas");
  assert.equal(zZice(zaZico(z, pravi, "telefon-racunalnik"), pravi, "telefon-racunalnik")?.vrednost, K1);
});

test("naloga 35: spor dveh hkratnih sprememb - velja zadnja, druga vrednost ostane kot »(spor)«, vse tri naprave enake", () => {
  const { r, a, b } = trije();
  r.sloti.gemini = K1;
  r.lokalno(1000);
  a.sinhroniziraj(r, 1100);
  b.sinhroniziraj(r, 1100);
  const id = r.st.aktivni.gemini as string;
  a.sloti.gemini = K2; // A: ob 2000
  b.sloti.gemini = K3; // B: ob 3000 (novejsa), A se ni sinhroniziral
  a.sinhroniziraj(r, 2000);
  b.sinhroniziraj(r, 3000);
  a.sinhroniziraj(r, 3100);
  r.lokalno(3200);
  const zivi = r.st.zapisi.filter((z) => !z.izbrisan);
  assert.equal(zivi.find((z) => z.id === id)?.vrednost, K3);
  const kopija = zivi.find((z) => z.oznaka.endsWith("(spor)"));
  assert.equal(kopija?.vrednost, K2, "vrednost A se ne izgubi");
  assert.equal(nabor(r.st.zapisi), nabor(a.st.zapisi));
  assert.equal(nabor(r.st.zapisi), nabor(b.st.zapisi));
  assert.equal(r.sloti.gemini, K3);
  assert.equal(a.sloti.gemini, K3);
});

test("naloga 35: sprememba po sinhronizaciji ni spor (zastarela kopija na telefonu ne naredi kopije)", () => {
  const { r, a, b } = trije();
  a.sinhroniziraj(r, 500);
  a.sloti.gemini = K1;
  a.sinhroniziraj(r, 1000);
  b.sinhroniziraj(r, 1100);
  a.sloti.gemini = K2;
  a.sinhroniziraj(r, 2000);
  a.sloti.gemini = K3;
  a.sinhroniziraj(r, 3000);
  b.sinhroniziraj(r, 4000);
  assert.equal(r.st.zapisi.length, 1);
  assert.equal(b.sloti.gemini, K3);
});

test("naloga 35: prehod - obstojeci kljuci ostanejo, isti kljuc na dveh napravah je en zapis, prazno mesto se zapolni", () => {
  const { r, a } = trije();
  r.sloti.gemini = K1;
  r.lokalno(1000);
  a.sloti.gemini = K1;
  a.sloti.openai = K3;
  a.sinhroniziraj(r, 2000);
  assert.equal(a.sloti.gemini, K1);
  assert.equal(a.sloti.openai, K3);
  assert.equal(r.sloti.openai, K3);
  assert.equal(r.st.zapisi.filter((z) => z.ponudnik === "gemini").length, 1);
  assert.ok(r.st.zapisi.every((z) => z.cas === CAS_UVOZA), "uvoz: vsaka kasnejsa sprememba ga preglasi");
});

test("naloga 35: razlicna kljuca istega ponudnika ob prehodu - oba ostaneta, vsaka naprava obdrzi svojega v uporabi", () => {
  const { r, a } = trije();
  r.sloti.gemini = K1;
  r.lokalno(1000);
  a.sloti.gemini = K2;
  a.sinhroniziraj(r, 2000);
  assert.equal(r.sloti.gemini, K1);
  assert.equal(a.sloti.gemini, K2);
  assert.equal(r.st.zapisi.filter((z) => z.ponudnik === "gemini" && !z.izbrisan).length, 2);
  assert.equal(nabor(r.st.zapisi), nabor(a.st.zapisi));
});

test("naloga 35: kljuc, ki ga lastnik spremeni MED izmenjavo, se ne prepise", () => {
  const { r, a } = trije();
  r.sloti.gemini = K1;
  r.lokalno(1000);
  a.sinhroniziraj(r, 1100);
  r.sloti.gemini = K2;
  r.lokalno(2000);
  a.sinhroniziraj(r, 2100, () => {
    a.sloti.gemini = K3;
  });
  assert.equal(a.sloti.gemini, K3);
  assert.equal(r.sloti.gemini, K3, "lastnikova sprememba gre naprej v naslednjem krogu");
});

test("naloga 35: prejet zapis - samo dovoljeni ponudniki in polja, ura najvec 10 min naprej", () => {
  const z = { id: "0123456789abcdef", ponudnik: "gemini", oznaka: "Moj", cas: 5000, naprava: "n-a", izbrisan: false, prej: "", vrednost: K1 };
  assert.ok(veljavenZapis(z, 5000));
  for (const p of ["vertex", "omniroute", "custom", "openai "]) assert.ok(!veljavenZapis({ ...z, ponudnik: p }, 5000), p);
  for (const [k, v] of [["naslov", "https://x.invalid"], ["dovoljene", {}], ["aktiven", true], ["klici", true]] as const) {
    assert.ok(!veljavenZapis({ ...z, [k]: v }, 5000), `polje ${k}`);
  }
  assert.ok(!veljavenZapis({ ...z, cas: 5000 + NAJVEC_NAPREJ_MS + 1 }, 5000));
  assert.ok(!veljavenZapis({ ...z, oznaka: "a\u202Eb" }, 5000));
  assert.ok(!veljavenZapis({ ...z, vrednost: "kratek" }, 5000));
  assert.ok(!veljavenZapis({ ...z, izbrisan: true }, 5000), "grob brez vrednosti");
});

test("naloga 35: id ne zamenja ponudnika (kljuc enega ponudnika ne gre k drugemu)", () => {
  const z: ZapisKljuca = { id: "0123456789abcdef", ponudnik: "openai", oznaka: "x", cas: 5, naprava: "n-a", izbrisan: false, prej: "", vrednost: K3 };
  const izid = zdruzi([z], [{ ...z, ponudnik: "grok", cas: 9, prej: "5/n-a" }], 10);
  assert.equal(izid.zapisi[0].ponudnik, "openai");
});

test("naloga 35: vrstni red sporocil ne spremeni izida", () => {
  const baza: ZapisKljuca = { id: "0123456789abcdef", ponudnik: "gemini", oznaka: "x", cas: 10, naprava: "n-a", izbrisan: false, prej: "", vrednost: K1 };
  const s1 = { ...baza, cas: 20, naprava: "n-b", prej: "10/n-a", vrednost: K2 };
  const s2 = { ...baza, cas: 30, naprava: "n-c", prej: "10/n-a", vrednost: K3 };
  const s3 = { ...baza, cas: 25, naprava: "n-d", prej: "10/n-a", izbrisan: true, vrednost: "" };
  const vrstni = [[s1, s2, s3], [s3, s2, s1], [s2, s1, s3], [s2, s3, s1]];
  const izidi = vrstni.map((v) => nabor(v.reduce((acc, x) => zdruzi(acc, [x], 100).zapisi, [baza])));
  for (const i of izidi) assert.equal(i, izidi[0]);
  const koncni = vrstni[0].reduce((acc, x) => zdruzi(acc, [x], 100).zapisi, [baza]);
  assert.equal(koncni.find((z) => z.id === baza.id)?.vrednost, K3);
  assert.ok(koncni.some((z) => z.id === idSpora(s1) && z.vrednost === K2));
});
