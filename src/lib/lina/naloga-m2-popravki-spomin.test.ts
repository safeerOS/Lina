/**
 * Lina M2 popravki (slepi pregled 2, 15. 11. 2026): F2 in F3 - seznam DOVOLJENEGA (tujeBesede).
 * F2: pravi odgovori ne smejo biti zavrnjeni brez razloga (prej 24 % pravih odgovorov Gemini, 43 % naravnih odgovorov).
 * F3: seznam mora zavrniti, kar je tuje: druge pisave, stevilke izven vira, razmaknjene crke, kratke besede, predpone.
 * Vsi vzorci so izmisljeni.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dejstvaKataloga } from "./guards.ts";
import { tujeBesede } from "./spomin.ts";
import type { Catalog } from "./types.ts";

const mapa = new URL(".", import.meta.url);
const vrstice = (ime: string): string[] =>
  readFileSync(new URL(ime, mapa), "utf8")
    .split("\n")
    .filter((v) => v && !v.startsWith("#"));

const PEKARNA = {
  company: { name: "Pekarna Zlata Skorjica", trade: "Pekarna", phone: "+386 3 555 12 34", address: "Mlinska cesta 4, Celje", hours: "pon-sob 6.00-18.00", about: "Pecemo kruh, pecivo in slascice iz domace moke, brez konzervansov." },
  materials: [{ id: "psenica", name: "Pšenična moka", note: "Domača, polnozrnata ali bela." }, { id: "rz", name: "Rženo moko", note: "Za temen kruh." }],
  products: [{ id: "kruh", name: "Hlebec", kind: "kruh", summary: "Domač hlebec s hrustljavo skorjo.", materialIds: ["psenica", "rz"] }, { id: "potica", name: "Potica", kind: "slascica", summary: "Orehova in tarčna potica.", materialIds: ["psenica"] }],
  znanje:
    "Pekarna je odprta od ponedeljka do sobote od 6.00 do 18.00. V nedeljo je zaprto. Pečemo kruh, pecivo, žemlje, rogljičke in potice. Moka je domača in mleta v bližnjem mlinu. " +
    "Vsak dan pečemo sveže zjutraj. Imamo tudi brezglutenski kruh na naročilo. Večja naročila za praznike sprejemamo po telefonu ali po elektronski pošti. Trgovina je v Celju na Mlinski cesti. " +
    "Potice pečemo po družinskem receptu z orehi, tarčnim nadevom ali rozinami. Dostavljamo v okolici Celja. Plačilo je mogoče z gotovino ali kartico.",
} as unknown as Catalog;
const MIZARSTVO = {
  company: { name: "Mizarstvo Les", trade: "Mizarstvo", phone: "+386 1 555 09 00", address: "Obrtna ulica 9, Ljubljana", hours: "pon-pet 7.00-15.00", about: "Izdelujemo mize, stole in omare iz masivnega hrasta in oreha po meri." },
  materials: [{ id: "hrast", name: "Hrast", note: "Masiven, oljen." }],
  products: [{ id: "miza", name: "Jedilna miza", kind: "miza", summary: "Masivna jedilna miza po meri.", materialIds: ["hrast"] }],
  znanje: "Delamo od ponedeljka do petka. Delavnica je v Ljubljani na Obrtni ulici. Obiske sprejemamo po dogovoru. Naročila sprejemamo po telefonu ali po elektronski pošti.",
} as unknown as Catalog;
const vir = (k: Catalog, dodatno = ""): string => `${dejstvaKataloga(k)}\n${k.znanje}\n${dodatno}`;
const zavrnjeni = (odgovori: string[], v: string): string[] => odgovori.filter((o) => tujeBesede(o, v).length > 0);

describe("M2 popravki F2: pravi odgovori niso zavrnjeni", () => {
  it("101 naravnih odgovorov pekarne: najvec 5 % zavrnjenih (prej 43 %)", () => {
    const o = vrstice("m2p-odgovori-pekarna.txt");
    assert.ok(o.length >= 100);
    const z = zavrnjeni(o, vir(PEKARNA));
    assert.ok(z.length <= 5, `zavrnjenih ${z.length}/${o.length}: ${z.join(" || ")}`);
  });
  it("40 odgovorov za DRUGO podjetje (mizarstvo, napisani pred razsiritvijo besedisca): najvec 5 % zavrnjenih (prej 58 %)", () => {
    const o = vrstice("m2p-odgovori-mizarstvo.txt");
    const z = zavrnjeni(o, vir(MIZARSTVO));
    assert.ok(z.length <= 2, `zavrnjenih ${z.length}/${o.length}: ${z.join(" || ")}`);
  });
  it("33 pravih odgovorov Gemini (zapis pregleda): zavrnjen je samo odgovor z veganskim izdelkom, ki ga vir nima", () => {
    const o = vrstice("m2p-odgovori-model.txt");
    const z = zavrnjeni(o, vir(PEKARNA, "Direktor je običajno dosegljiv po telefonu dopoldne."));
    assert.ok(z.length <= 1, `zavrnjenih ${z.length}/${o.length}: ${z.join(" || ")}`);
    assert.ok(z.every((x) => /vegansk/i.test(x)));
  });
  it("odgovori iz porocila (nahaja, voljo, narejeni, podatkov, nimam informacij) so dovoljeni", () => {
    for (const o of [
      "Pekarna se nahaja na Mlinski cesti 4 v Celju.",
      "Na voljo imamo tudi brezglutenski kruh na naročilo.",
      "Naše potice so narejene po družinskem receptu.",
      "Tega podatka nimam.",
      "O tem nimam informacij.",
      "Pridite k nam po svež kruh.",
    ]) {
      assert.deepEqual(tujeBesede(o, vir(PEKARNA)), [], o);
    }
  });
  it("vsebinske besede o osebah in zdravju so se vedno tuje (direktor, operacija, bolnisnica, dializa, Berlin)", () => {
    for (const o of [
      "Direktor je do petka na operaciji kolena v Celju.",
      "Direktor ima ob torkih dializo in takrat ni dosegljiv.",
      "Žena direktorja dela v bolnišnici in ima nočne izmene.",
      "Danes je direktor v Berlinu.",
      "Lastnik ima sladkorno bolezen.",
    ]) {
      assert.ok(tujeBesede(o, vir(PEKARNA)).length > 0, o);
    }
  });
});

describe("M2 popravki F3: seznam zavrne, kar komentar trdi", () => {
  const v = vir(MIZARSTVO);
  const U = (...c: number[]) => String.fromCodePoint(...c);
  it("druge pisave (cirilica, kitajscina, grscina, arabscina) so tuje", () => {
    for (const o of [
      U(0x414, 0x438, 0x440, 0x435, 0x43a, 0x442, 0x43e, 0x440, 32, 0x432, 32, 0x411, 0x435, 0x440, 0x43b, 0x438, 0x43d, 0x435),
      U(0x603b, 0x7ecf, 0x7406, 0x5728, 0x67cf, 0x6797),
      U(0x39f, 32, 0x3b4, 0x3b9, 0x3b5, 0x3c5, 0x3b8, 0x3c5, 0x3bd, 0x3c4, 0x3ae, 0x3c2),
      U(0x627, 0x644, 0x645, 0x62f, 0x64a, 0x631),
    ]) {
      assert.ok(tujeBesede(o, v).length > 0, o);
    }
  });
  it("homoglif znotraj besede in crka izven latinice (ı, polna sirina) sta tuja", () => {
    assert.ok(tujeBesede("Dir" + U(0x435) + "ktor je v Berlinu", v).length > 0);
    assert.ok(tujeBesede("d" + U(0x131) + "rektor", v).length > 0);
    assert.ok(tujeBesede(U(0xff24, 0xff29, 0xff32, 0xff25, 0xff2b, 0xff34, 0xff2f, 0xff32), v).length > 0);
  });
  it("stevilke izven vira (telefon, ura) so tuje, stevilke iz vira niso", () => {
    assert.ok(tujeBesede("Pokličite 041 555 666 ali 031 222 333", v).length > 0);
    assert.ok(tujeBesede("Direktor je prost ob 17.30", v).length > 0);
    assert.deepEqual(tujeBesede("Naša številka je 01 555 09 00.", v), []);
    assert.deepEqual(tujeBesede("Delamo od 7.00 do 15.00.", v), []);
  });
  it("razmaknjene crke (d i r e k t o r) so tuje", () => {
    assert.deepEqual(tujeBesede("d i r e k t o r", v), ["direktor"]);
  });
  it("kratke besede kot sifra (Xy Qz) so tuje", () => {
    assert.ok(tujeBesede("Xy Qz je tu", v).length > 0);
  });
  it("kratek koren ni predpona (Petrovic, sestanek, letovanje, nasilje, urolog)", () => {
    for (const o of ["Petrovic", "Sestanek", "Letovanje", "Nasilje", "Urolog", "Ureditev"]) assert.ok(tujeBesede(o, v).length > 0, o);
    for (const o of ["Pet dni", "Petek", "Ob sestih", "Uro", "Ure"]) assert.deepEqual(tujeBesede(o, v), [], o);
  });
});
