/**
 * Naloga G3e. Odlocitev lastnika (10. 11. 2026): »Lina lahko vprasa za potrditev«. Zelja ali namera (»rada bi
 * naročila«) ni potrditev; zapisnik potrdi samo odgovor na Linino vprasanje. Brez omrezja; komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { t } from "./besedila.ts";
import { absorbUtterance, emptyDraft, odgovorNaPotrditev } from "./brain.ts";
import { formaCatalog } from "./catalog.ts";
import { stalniStavki } from "./glas.ts";
import { defaultPravila } from "./pravila.server.ts";
import { NAJVEC_VPRASANJ_POTRDITVE, publishLine, recordCaller, vajaKlica } from "./service.server.ts";
import { writeJson } from "./store.server.ts";

process.env.LINA_LLM = "0";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-g3e-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const temps: string[] = [];

afterEach(async () => {
  while (temps.length) {
    const dir = temps.pop();
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

async function linija(): Promise<string> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  temps.push(dir);
  await writeJson(dir, "line.json", { open: true, catalog: formaCatalog(), updatedAt: null });
  await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi" });
  return dir;
}

const OD = "+38640000000";
/**
 * Potek G4g (lastnik 11. 11. 2026, AGENTS.md »Potek konca klica (G4g)« in »Potrditev narocila samo po izrecnem vprasanju«;
 * lastnik 10. 11. 2026, »Po drugem pravem klicu«: potrditev je NA KONCU klica, ne sredi klica in ne v obliki »recite
 * potrjujem«). Lina po izdelku vprasa kolicino in rok, nato ponovi narocilo in vprasa »Ali potrjujete naročilo?«. Stavek
 * »Če drži, recite: potrjujem.« (t("potrdiZapis")) koda ne uporablja vec. Namera G3e ostane: zelja ni potrditev, potrdi
 * samo odgovor na Linino izrecno vprasanje.
 */
const VPRASANJE = /Ali potrjujete naročilo\?$/;
const POVZETEK = /^Ponovim, kar sem razumela\./;
const KOLICINA = /Koliko kosov potrebujete\?$/;
const SLOVO = /Hvala za klic\. Lep dan\.$/;
let stevec = 0;

/** Klic do odgovora na »Kako vam lahko pomagam?«; vrne funkcijo za naslednje izreke. */
async function klic(dir: string, model?: (facts: string) => Promise<string>) {
  stevec += 1;
  const sid = `CA-G3E-${stevec}`;
  const obrat = (text: string) => recordCaller({ callSid: sid, from: OD, text }, dir, model);
  await obrat("");
  await obrat("Ana Primer.");
  return obrat;
}

/** Izdelek, kolicina in rok: Lina ponovi narocilo in vprasa za potrditev. */
async function doPovzetka(obrat: Awaited<ReturnType<typeof klic>>, izdelek = "Rada bi naročila mizo Alba iz hrasta.") {
  await obrat(izdelek);
  await obrat("Dva kosa.");
  const povzetek = await obrat("Do petka.");
  assert.match(povzetek.reply, POVZETEK);
  assert.match(povzetek.reply, VPRASANJE);
  assert.equal(povzetek.call.order.confirmed, false);
  return povzetek;
}

describe("naloga G3e: potrditev samo kot odgovor na Linino vprasanje", { concurrency: 1 }, () => {
  it("(1) »Rada bi naročila mizo Alba iz hrasta« ni potrditev: Lina vprasa kolicino, zapisnik ni potrjen", async () => {
    const dir = await linija();
    for (const zelja of [
      "Rada bi naročila mizo Alba iz hrasta.",
      "Naročil bi mizo Alba iz hrasta.",
      "Želim naročiti mizo Alba iz hrasta.",
      "Bi vzel mizo Alba iz hrasta, velja?",
      "Naročam mizo Alba iz hrasta.",
      "Strinjam se z mizo Alba iz hrasta.",
    ]) {
      const obrat = await klic(dir);
      const izid = await obrat(zelja);
      assert.equal(izid.call.order.confirmed, false, zelja);
      assert.doesNotMatch(izid.reply, /Zapisnik je potrjen|Ali potrjujete/, zelja);
      assert.equal(izid.call.order.productName, "Alba");
      assert.equal(izid.call.order.materialName, "Hrast");
      // En obrat, eno vprasanje: najprej kolicina, vprasanje o roku pocaka.
      assert.match(izid.reply, KOLICINA, zelja);
      assert.doesNotMatch(izid.reply, /Do kdaj/, zelja);
    }
  });

  it("(2) po vprasanju »Ali potrjujete naročilo?« potrdi »Potrjujem.«; tudi »Da.«, »Drži.«, »Tako je.«, »V redu.«", async () => {
    const dir = await linija();
    for (const odgovor of ["Potrjujem.", "Da.", "Ja, drži.", "Tako je.", "V redu.", "Se strinjam.", "Velja."]) {
      const obrat = await klic(dir);
      await doPovzetka(obrat);
      const izid = await obrat(odgovor);
      assert.equal(izid.call.order.confirmed, true, odgovor);
      // Po potrditvi Lina zakljuci: stavek o povratnem klicu, zahvala, slovo (G4g).
      assert.match(izid.reply, SLOVO, odgovor);
      assert.equal(izid.call.status, "zakljucen", odgovor);
    }
  });

  it("(3) »potrjujem«, izrecen pred vprasanjem, ne potrdi; potrditev velja samo za odgovor na vprasanje", async () => {
    const dir = await linija();
    const obrat = await klic(dir);
    const termin = await obrat("Potrjujem termin, o katerem sva govorila.");
    assert.equal(termin.call.order.confirmed, false);
    const skupaj = await obrat("Mizo Alba iz hrasta, potrjujem.");
    // Izdelek in potrditev v istem izreku: Lina se ni vprasala, zato ne potrdi in zbira naprej.
    assert.equal(skupaj.call.order.confirmed, false);
    assert.match(skupaj.reply, KOLICINA);
    await obrat("Dva kosa.");
    const povzetek = await obrat("Do petka.");
    assert.match(povzetek.reply, VPRASANJE);
    assert.equal(povzetek.call.order.confirmed, false);
    // Klicatelj vmes pove nekaj drugega: ni potrditev; Lina vprasanje izrecno ponovi (najvec dvakrat na klic).
    const vmes = await obrat("Hm.");
    assert.equal(vmes.call.order.confirmed, false);
    assert.equal(vmes.reply, t("potrditevVprasanje"));
    const potem = await obrat("Potrjujem.");
    assert.equal(potem.call.order.confirmed, true);
    // Cisti del: brez oznake, da je Lina vprasala, besedilo ne potrdi nicesar.
    for (const izrek of ["Potrjujem.", "Naročam.", "Velja, strinjam se.", "Da."]) {
      assert.equal(absorbUtterance(emptyDraft(), izrek, formaCatalog()).confirmAsked, false, izrek);
    }
    assert.equal(absorbUtterance(emptyDraft(), "Potrjujem.", formaCatalog(), { potrditevVprasana: true }).confirmAsked, true);
    assert.equal(absorbUtterance(emptyDraft(), "Rada bi naročila.", formaCatalog(), { potrditevVprasana: true }).confirmAsked, false);
  });

  it("(4) tabela izrekov: zelja ali namera, potrditev, zavrnitev", () => {
    const tabela: Array<[string, "da" | "ne" | null]> = [
      // zelja ali namera - ni odgovor na vprasanje
      ["Rada bi naročila mizo Alba iz hrasta.", null],
      ["Naročil bi mizo.", null],
      ["Želim naročiti dve mizi.", null],
      ["Bi vzel mizo iz hrasta.", null],
      ["Naročam mizo Alba.", null],
      ["Zanima me naročilo mize.", null],
      ["Mislim, da bi raje jesen.", null],
      ["Mizo Alba iz hrasta.", null],
      ["Hm.", null],
      ["Koliko stane?", null],
      ["Dva kosa.", null],
      ["", null],
      // potrditev
      ["Potrjujem.", "da"],
      ["Da.", "da"],
      ["Ja.", "da"],
      ["Da, potrjujem.", "da"],
      ["Drži.", "da"],
      ["Tako je.", "da"],
      ["V redu.", "da"],
      ["Ja, tako je, hvala.", "da"],
      ["Se strinjam.", "da"],
      ["Velja.", "da"],
      ["Seveda.", "da"],
      ["Točno.", "da"],
      ["To drži.", "da"],
      // zavrnitev
      ["Ne.", "ne"],
      ["Ni tako.", "ne"],
      ["Ne drži.", "ne"],
      ["Ne potrjujem.", "ne"],
      ["Ne, iz jesena.", "ne"],
      ["To je narobe.", "ne"],
      ["Ni prav, dva kosa.", "ne"],
      ["Nikakor.", "ne"],
      ["Ne strinjam se.", "ne"],
    ];
    assert.ok(tabela.length >= 20);
    for (const [izrek, odgovor] of tabela) assert.equal(odgovorNaPotrditev(izrek), odgovor, izrek);
  });

  it("popravek ni potrditev: Lina popravi zapis in vprasa znova najvec enkrat; »Ne.« brez popravka -> »Kaj naj popravim?«", async () => {
    const dir = await linija();
    assert.equal(NAJVEC_VPRASANJ_POTRDITVE, 2);
    const obrat = await klic(dir);
    await doPovzetka(obrat);
    // Popravek z »da« na zacetku: zapis se popravi, potrjeno ni, Lina ponovi narocilo in vprasa znova.
    const popravek = await obrat("Da, ampak iz jesena.");
    assert.equal(popravek.call.order.confirmed, false);
    assert.equal(popravek.call.order.materialName, "Jesen");
    assert.match(popravek.reply, /Alba iz materiala Jesen/);
    assert.match(popravek.reply, VPRASANJE);
    // Se en popravek: Lina zapise, a za potrditev ne vprasa tretjic in zakljuci (G4g).
    const drugi = await obrat("Ne, vseeno hrast.");
    assert.equal(drugi.call.order.confirmed, false);
    assert.equal(drugi.call.order.materialName, "Hrast");
    assert.doesNotMatch(drugi.reply, /Ali potrjujete/);
    assert.match(drugi.reply, SLOVO);
    const lina = drugi.call.transcript.filter((v) => v.role === "lina" && VPRASANJE.test(v.text));
    assert.equal(lina.length, 2);

    // »Ne.« brez popravka: eno vprasanje, kaj popraviti (brez modela); po popravku drugo in zadnje vprasanje za potrditev.
    let klicevModela = 0;
    const obrat2 = await klic(dir, async (facts) => {
      klicevModela += 1;
      return facts;
    });
    await doPovzetka(obrat2);
    const pred = klicevModela;
    const ne = await obrat2("Ne.");
    assert.equal(ne.reply, t("kajPopravim"));
    assert.equal(ne.call.order.confirmed, false);
    assert.equal(klicevModela, pred);
    const iz = await obrat2("Iz jesena.");
    assert.match(iz.reply, /Alba iz materiala Jesen/);
    assert.match(iz.reply, VPRASANJE);
    const potrjeno = await obrat2("Potrjujem.");
    assert.equal(potrjeno.call.order.confirmed, true);
    assert.equal(potrjeno.call.order.materialName, "Jesen");
    // »Ne.« drugic: Lina ne sprasuje vec, kaj popraviti; ponovi narocilo z drugim (zadnjim) vprasanjem.
    const obrat3 = await klic(dir);
    await doPovzetka(obrat3, "Mizo Alba iz hrasta.");
    assert.equal((await obrat3("Ni tako.")).reply, t("kajPopravim"));
    const naprej = await obrat3("Ne.");
    assert.notEqual(naprej.reply, t("kajPopravim"));
    assert.equal(naprej.call.order.confirmed, false);
    assert.match(naprej.reply, VPRASANJE);
    // »Kaj naj popravim?« najvec enkrat na klic: po drugem vprasanju za potrditev »Ne.« ne sprozi istega vprasanja.
    const obrat4 = await klic(dir);
    await doPovzetka(obrat4, "Mizo Alba iz hrasta.");
    assert.equal((await obrat4("Ne.")).reply, t("kajPopravim"));
    assert.match((await obrat4("Iz jesena.")).reply, VPRASANJE);
    const spetNe = await obrat4("Ne.");
    assert.notEqual(spetNe.reply, t("kajPopravim"));
    assert.equal(spetNe.call.transcript.filter((v) => v.role === "lina" && v.text === t("kajPopravim")).length, 1);
  });

  it("model vprasanja za potrditev ne more izpustiti; vprasanji sta stalna stavka (posnetek je pripravljen)", async () => {
    const dir = await linija();
    let klicevModela = 0;
    const obrat = await klic(dir, async () => {
      klicevModela += 1;
      return "Seveda, mizo Alba iz hrasta sem zapisala.";
    });
    // G4a (lastnik 10. 11. 2026): narocilo iz kataloga, kolicina, rok in povzetek gredo brez modela.
    const povzetek = await doPovzetka(obrat);
    assert.equal(klicevModela, 0);
    assert.ok(povzetek.reply.endsWith(t("potrditevVprasanje")));
    assert.equal((await obrat("Potrjujem.")).call.order.confirmed, true);
    const stalni = stalniStavki(defaultPravila(), "FORMA");
    assert.ok(stalni.includes(t("potrditevVprasanje")) && stalni.includes(t("kajPopravim")));
    assert.equal(t("potrditevVprasanje"), "Ali potrjujete naročilo?");
  });

  it("vaja klica gre po isti poti; potrditev je en obrat na koncu", async () => {
    const dir = await linija();
    const token = await setupOwner("geslo-test-1234", dir);
    await publishLine({ open: true, brezGlasu: true }, { token }, dir);
    const zacetek = await vajaKlica({}, { token }, dir);
    await vajaKlica({ id: zacetek.id, text: "Ana Primer." }, { token }, dir);
    const zelja = await vajaKlica({ id: zacetek.id, text: "Rada bi naročila mizo Alba iz hrasta." }, { token }, dir);
    assert.match(zelja.reply, KOLICINA);
    assert.doesNotMatch(zelja.reply, /Zapisnik je potrjen|Ali potrjujete/);
    await vajaKlica({ id: zacetek.id, text: "Dva kosa." }, { token }, dir);
    // Vaja nima stevilke klicatelja: kot klic s skrito stevilko Lina vprasa se telefon (G4g, »Telefonska stevilka klicatelja«).
    assert.match((await vajaKlica({ id: zacetek.id, text: "Do petka." }, { token }, dir)).reply, /telefonsko številko/);
    const povzetek = await vajaKlica({ id: zacetek.id, text: "041 000 000" }, { token }, dir);
    assert.match(povzetek.reply, VPRASANJE);
    const potrjeno = await vajaKlica({ id: zacetek.id, text: "Potrjujem." }, { token }, dir);
    assert.match(potrjeno.reply, SLOVO);
    assert.equal(potrjeno.koncano, true);
    // Stevilo obratov pravega klica: pozdrav, ime, izdelek, kolicina, rok (povzetek), potrditev = 6 obratov Line.
    const obrat = await klic(dir);
    const izreki = ["Rada bi naročila mizo Alba iz hrasta.", "Dva kosa.", "Do petka.", "Potrjujem."];
    let izid = await obrat(izreki[0]);
    for (const izrek of izreki.slice(1)) izid = await obrat(izrek);
    assert.equal(izid.call.status, "zakljucen");
    assert.equal(izid.call.order.confirmed, true);
    assert.equal(izid.call.transcript.filter((v) => v.role === "lina").length, 6);
  });
});
