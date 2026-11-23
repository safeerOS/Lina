/**
 * Osebna tajnica: prosnja, naj Lina POVE zapisano sporocilo, in slovo (lastnik 14. 11. 2026: »ni ponovila mojega sporočila, ko sem jo prosil«).
 * (1) »povej mi, kakšno je moje sporočilo«, »kaj boš sporočila«, »še enkrat« ... je ponovitev po pravilih, brez modela, tudi s popacenim svojilnim
 * zaimkom (»moj sporočilo«, »moj je sporočilo«); (2) vprasanje Lini na koncu izreka ne gre v sporocilo in dobi celo ponovitev; brez vsebine se
 * sporocilo ne zapise; (3) Lina klica ne zakljuci kot odgovor na vprasanje ali prosnjo: poslusa in se ob tisini poslovi sama. Povedi so izmisljene
 * (izvor je v AGENTS.md); ime lastnika je »Ana«, stevilka izmisljena. Brez omrezja.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { t } from "./besedila.ts";
import { pocakajDnevnikGlasu, pocakajGlas, ustaviCiscenjeZvoka } from "./glas.server.ts";
import { jePonovitev, lociMetaVprasanje, prosnjaZaPonovitev } from "./osebna-polnila.ts";
import { NAVODILO_OSEBNEGA } from "./osebna-razumevanje.server.ts";
import { defaultPravila } from "./pravila.server.ts";
import type { ModelRazumevanja } from "./razumevanje.server.ts";
import { recordCaller } from "./service.server.ts";
import { SKIL_RAZLICICA } from "./skil-lina.ts";
import { writeJson } from "./store.server.ts";

process.env.LINA_LLM = "0";
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-prosnja-sporocila-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length) {
    const dir = dirs.pop() as string;
    await pocakajGlas(dir);
    await pocakajDnevnikGlasu(dir);
    ustaviCiscenjeZvoka(dir);
  }
});

const OD = "+38641123456";
const SPOROCILO = "pozdravite jo lepo in ji povejte da pridem v ponedeljek";
const PONOVITEV = "Zapisala sem: pozdravite jo lepo in ji povejte da pridem v ponedeljek.";
const SLOVO = "Hvala za klic, nasvidenje.";
/** Pravilo C (15. 11. 2026): odgovor po zapisu sporocila ima zakljucni stavek (vprasanje, vabilo ali slovo). */
const PONOVITEV_SLOVO = `${PONOVITEV} ${SLOVO}`;
/** Dokler zapis ni potrjen, se ponovitev konca z vprasanjem (stalni stavek), ne s slovesom. */
const PONOVITEV_VPRASANJE = `${PONOVITEV} Ali sem prav razumela?`;
/** Potek klica z izmisljenima povedma: pozdrav in klepet z vprasanjem Lini na koncu, nato prosnja, naj Lina pove sporocilo. */
const KLEPET = "zdravo tukaj Marko rad bi vprašal kako si";
const IZREK_1 = `${KLEPET} ali si razumela moj je sporočilo`;
const IZREK_2 = "prosim povej mi kakšno je moj sporočilo";
/** Model, kot je odgovoril v klicu: po zapisu »vprasanje« (izrek dobesedno) s predposneto frazo o zapisu; pred zapisom ne odgovori. */
const modelKlica = (vhod: string): string | null =>
  vhod.includes("Zapisan izrek")
    ? JSON.stringify({ namen: "vprasanje", sporocilo: null, ime: "", vprasanje: /Klicatelj: (.*)$/.exec(vhod)?.[1] ?? "", odgovor: "Da, sporočilo je zapisano in bo posredovano.", confident: true })
    : null;

/** Klic na ravni obrata; model belezi vhode in odgovarja po danem pravilu (null = ne odgovori), po zelji z zamikom. */
async function klic(sid: string, odgovor: (vhod: string) => string | null = () => null, zamikMs = 0) {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  dirs.push(dir);
  await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi", nacinKlica: "osebna", imeLastnika: "Ana" });
  const vhodi: string[] = [];
  const model: ModelRazumevanja = async (_sistem, vhod) => {
    vhodi.push(vhod);
    if (zamikMs > 0) await new Promise((r) => setTimeout(r, zamikMs));
    const o = odgovor(vhod);
    if (o === null) throw new Error("model ne odgovori");
    return o;
  };
  const m = { razumevanje: model, osebnaRokMs: 400 };
  await recordCaller({ callSid: sid, from: OD, text: "" }, dir, undefined, m);
  const reci = (text: string, vec: { zahteva?: number } = {}) => recordCaller({ callSid: sid, from: OD, text, ...vec }, dir, undefined, m);
  return { vhodi, reci };
}

describe("potek klica: klepet z vprasanjem Lini, nato prosnja, naj pove sporocilo", () => {
  it("vprasanje Lini na koncu izreka ni v sporocilu; odgovor je CELA ponovitev, ne »Da, sporočilo sem zapisala«; izrek ostane v prepisu dobesedno", async () => {
    const { reci } = await klic("CA-PS-1", modelKlica);
    const r = await reci(IZREK_1);
    assert.equal(r.call.order.tajnica?.sporocilo, KLEPET);
    assert.equal(r.reply, `Zapisala sem: ${KLEPET}. Ali sem prav razumela?`);
    assert.notEqual(r.call.status, "zakljucen");
    const vrstica = r.call.transcript.find((v) => v.role === "stranka" && v.text === IZREK_1);
    assert.ok(vrstica, "izrek v prepisu dobesedno");
    assert.equal(vrstica.razumljeno, `${KLEPET} ali si razumela moje sporočilo`, "branje znane napake samo v vprasanju, ob prepisu");
  });

  it("prosnja »prosim povej mi kakšno je moj sporočilo« je ponovitev PO PRAVILIH (model ni vprasan, obrat ne caka nanj) in klica ne zakljuci; ob tisini slovo", async () => {
    // Pocasen model (350 ms): ce bi obrat cakal nanj, bi trajal vsaj toliko.
    const { vhodi, reci } = await klic("CA-PS-2", modelKlica, 350);
    await reci(IZREK_1);
    const prej = vhodi.length;
    const t0 = performance.now();
    const r = await reci(IZREK_2);
    const ms = performance.now() - t0;
    console.log(`obrat s prosnjo (pravila, brez modela): ${ms.toFixed(1)} ms`);
    assert.equal(r.reply, `Zapisala sem: ${KLEPET}. Ali sem prav razumela?`, "zapis ni potrjen: ponovitev se konca z vprasanjem");
    assert.equal(vhodi.length, prej, "model ni vprasan");
    assert.ok(ms < 200, `obrat ${ms.toFixed(0)} ms ne caka na model (350 ms)`);
    assert.equal(r.call.transcript.at(-1)?.odlocil, "pravila");
    assert.notEqual(r.call.status, "zakljucen", "prosnja ni razlog za slovo");
    assert.doesNotMatch(r.reply, /nasvidenje|Da, sporočilo je zapisano/);
    assert.equal(r.call.osebnoPotrdi, "caka");
    assert.equal(r.call.transcript.find((v) => v.text === IZREK_2)?.razumljeno, "prosim povej mi kakšno je moje sporočilo");
    // Lina poslusa; ob tisini se poslovi SAMA in klic zakljuci (klicatelj ne ostane na liniji brez slovesa).
    const tisina = await reci("");
    assert.equal(tisina.reply, SLOVO);
    assert.equal(tisina.call.status, "zakljucen");
  });

  it("brez vsebine (samo pozdrav ali »kako si«) se sporocilo NE zapise: Lina prosi za sporocilo; izrek ostane v prepisu", async () => {
    for (const [i, izrek] of ["zdravo ali si razumela moj je sporočilo", "zdravo kako si ali si razumela moje sporočilo", "povej mi kakšno je moje sporočilo"].entries()) {
      const { vhodi, reci } = await klic(`CA-PS-3${i}`);
      const r = await reci(izrek);
      assert.equal(vhodi.length, 0, `${izrek}: pravila, model ni vprasan`);
      assert.equal(r.call.order.tajnica, undefined, `${izrek}: brez sporocila`);
      assert.equal(r.reply, t("osebnaPonovi"), izrek);
      assert.notEqual(r.call.status, "zakljucen");
      assert.ok(r.call.transcript.some((v) => v.role === "stranka" && v.text === izrek), "dobesedno v prepisu");
      // Druga prosnja brez sporocila: edino vprasanje; sporocilo, ki sledi, se zapise in na prosnjo ponovi.
      const drugi = await reci("povej mi kakšno je moje sporočilo");
      assert.equal(drugi.reply, t("osebnaSporocilo"));
      assert.equal(drugi.call.order.tajnica, undefined);
      const tretji = await reci(SPOROCILO);
      assert.equal(tretji.call.order.tajnica?.sporocilo, SPOROCILO);
      assert.equal((await reci("kakšno je moje sporočilo")).reply, `${PONOVITEV} Ali sem prav razumela?`);
    }
  });

  it("kratka vsebina z vprasanjem Lini (»pridem jutri ali si razumela«): sporocilo je vsebina brez vprasanja, odgovor cela ponovitev", async () => {
    const { reci } = await klic("CA-PS-4");
    const r = await reci("pridem jutri ali si razumela");
    assert.equal(r.call.order.tajnica?.sporocilo, "pridem jutri");
    assert.equal(r.reply, "Zapisala sem: pridem jutri. Ali sem prav razumela?");
  });
});

describe("prosnja, naj Lina pove sporocilo: pravila (brez modela)", () => {
  const DA = [
    IZREK_2,
    "povej mi kakšno je moje sporočilo",
    "povej mi kaj je moje sporočilo",
    "povej mi kakšno je moj je sporočilo",
    "povej mi moja sporočilo",
    "povej mi moje sporočilo",
    "povej mi sporočilo",
    "povejte mi prosim kako se glasi moje sporočilo",
    "a mi lahko poveš kakšno je moje sporočilo",
    "kakšno je moje sporočilo",
    "kaj je moje sporočilo",
    "kakšno je moj sporočilo",
    "kako se glasi moje sporočilo",
    "kaj boš sporočila",
    "kaj boste posredovali",
    "kaj boš povedala",
    "kaj mu boš povedala",
    "kaj si napisala",
    "še enkrat",
    "še enkrat prosim",
    "prosim še enkrat",
    "lahko ponoviš",
    "lahko ponovite",
    "ponovi mi sporočilo",
  ];
  // Naslovljeno osebi (»povej ji/mu«), druga vsebina ali glagol v odvisnem stavku: SPOROCILO, ne prosnja Lini.
  const NE = [
    "povej ji da je moje sporočilo nujno",
    "kakšno je stanje naročila",
    "sporočilo za šefa je da pridem jutri",
    "Po novi številki me pokliči",
    "po novi cesti pridem jutri",
    "pokliči me po novi številki",
    "povejte ji naj mi jutri vse še enkrat ponovi",
    "ne ponovi",
    "ponovi ji da pridem jutri",
    "povej mu da bom odpovedal naročilo če se to še enkrat ponovi",
    "upam da se to ne ponovi",
    "povejte mu da se to ne sme ponoviti",
    "kaj boš rekla če pridem jutri",
    "povej mi sporočilo za Ano",
    "moj je sporočilo dobil šele včeraj pride jutri",
    "povej ji da si zapisal številko",
    "še enkrat hvala",
  ];

  it(`${DA.length} oblik prosnje je ponovitev; ${NE.length} laznih zadetkov ni`, () => {
    for (const izrek of DA) assert.equal(jePonovitev(izrek), true, izrek);
    for (const izrek of NE) assert.equal(jePonovitev(izrek), false, izrek);
  });

  it("vsaka oblika prosnje po zapisu: ponovitev brez modela, konec z vprasanjem (zapis se ni potrjen)", async () => {
    for (const [i, izrek] of DA.entries()) {
      const { vhodi, reci } = await klic(`CA-PS-5${i}`, modelKlica);
      await reci(SPOROCILO);
      const prej = vhodi.length;
      const r = await reci(izrek);
      assert.equal(r.reply, PONOVITEV_VPRASANJE, izrek);
      assert.equal(vhodi.length, prej, `${izrek}: brez modela`);
      assert.notEqual(r.call.status, "zakljucen", izrek);
    }
  });

  it("lazni zadetki po zapisu se DOPISEJO dobesedno (brez ponovitve, brez izmisljenega branja); vprasanje o narocilu dobi »Tega ne vem«", async () => {
    for (const [i, izrek] of ["povej ji da je moje sporočilo nujno", "sporočilo za šefa je da pridem jutri", "Po novi številki me pokliči", "po novi cesti pridem jutri", "povejte ji naj mi jutri vse še enkrat ponovi", "pozdravite jo lepo in ji povejte da si zapisal številko in pridem jutri ob petih"].entries()) {
      const { reci } = await klic(`CA-PS-6${i}`);
      await reci(SPOROCILO);
      const r = await reci(izrek);
      assert.doesNotMatch(r.reply, /^Zapisala sem:/, izrek);
      assert.ok(r.call.order.tajnica?.sporocilo.endsWith(izrek), `${izrek}: dopisano dobesedno (${r.call.order.tajnica?.sporocilo})`);
      assert.equal(r.call.transcript.find((v) => v.text === izrek)?.razumljeno, undefined, `${izrek}: brez branja`);
      assert.notEqual(r.call.status, "zakljucen");
    }
    const { reci } = await klic("CA-PS-6N");
    await reci(SPOROCILO);
    const r = await reci("kakšno je stanje naročila");
    assert.equal(r.reply, `${t("osebnaNevemKratko")} ${SLOVO}`, "pravilo C: odgovor po zapisu ima zakljucni stavek");
    assert.equal(r.call.order.tajnica?.sporocilo, SPOROCILO);
  });

  it("vsebina in prosnja v istem izreku po zapisu: vsebina se dopise, nato cela ponovitev; popravek prepoznave samo v prosnji", async () => {
    const { reci } = await klic("CA-PS-7");
    await reci(SPOROCILO);
    const r = await reci("pa naj prinese tudi mapo z dokumenti ali si me razumela");
    assert.equal(r.call.order.tajnica?.sporocilo, `${SPOROCILO}. pa naj prinese tudi mapo z dokumenti`);
    assert.match(r.reply, /^Zapisala sem: pozdravite jo lepo in ji povejte da pridem v ponedeljek\. pa naj prinese tudi mapo z dokumenti\. Ali sem prav razumela\?$/);
    assert.deepEqual(prosnjaZaPonovitev("pridem po novi cesti prosim ponovi"), { vsebina: "pridem po novi cesti" });
    assert.deepEqual(lociMetaVprasanje("pridem jutri ob osmih aleš si razumela moje sporočilo"), { vsebina: "pridem jutri ob osmih", vprasanje: "aleš si razumela moje sporočilo" });
    assert.deepEqual(lociMetaVprasanje("povejte mu da se to ne sme ponoviti"), { vsebina: "povejte mu da se to ne sme ponoviti", vprasanje: "" });
  });
});

describe("Lina klica ne zakljuci kot odgovor na vprasanje ali prosnjo", () => {
  // 15. 11. 2026 (pravilo C): odgovor po zapisu ima zakljucni stavek (vprasanje ali slovo), a klic ostane odprt; ob tisini se konca brez drugega slovesa.
  it("po vprasanju ali prosnji odgovor konca z vprasanjem ali slovesom, klic ostane odprt; klic se konca ob »ne hvala«, zahvali ali tisini", async () => {
    const brezOdgovora = (vhod: string) => (vhod.includes("Zapisan izrek") ? JSON.stringify({ namen: "vprasanje", sporocilo: null, ime: "", vprasanje: "ali boste", odgovor: null }) : null);
    const primeri: Array<[string, (vhod: string) => string | null]> = [
      ["Ali imate mojo številko?", () => null],
      ["Kdaj me bo poklicala nazaj?", () => null],
      ["ali boste to res povedali Ani", modelKlica],
      ["ali boste to res povedali Ani", brezOdgovora],
      ["ali ste vi robot", () => null],
      ["si me slišala", () => null],
      [IZREK_2, modelKlica],
      ["kaj si zapisala", () => null],
    ];
    for (const [i, [izrek, model]] of primeri.entries()) {
      const { reci } = await klic(`CA-PS-8${i}`, model);
      await reci(SPOROCILO);
      const r = await reci(izrek);
      assert.notEqual(r.call.status, "zakljucen", `${izrek}: klic ostane odprt`);
      assert.match(r.reply, /(\?|nasvidenje\.)$/, `${izrek}: zakljucni stavek`);
      assert.doesNotMatch(r.reply, /vprašanje\?/, `${izrek}: »Imate še kakšno vprašanje?« najvec enkrat na klic`);
      let konec = await reci(i % 3 === 0 ? "" : i % 3 === 1 ? "ne hvala" : "hvala");
      // Slovo je ze izgovorjeno (pravilo C): tisina klic samo konca; ob »ne hvala« ali zahvali se Lina se enkrat poslovi.
      const povedano = /nasvidenje\.$/.test(r.reply);
      if (i % 3 === 0 && povedano) assert.equal(konec.reply, "", izrek);
      else assert.match(konec.reply, /^(Hvala( za klic)?, nasvidenje\.|Kako vam je ime\?)$/, izrek); // zapis se ni potrjen, ime ni znano: najprej vprasanje za ime
      if (konec.reply === "Kako vam je ime?") konec = await reci("ne hvala"); // ime se vprasa enkrat, klicatelj ga ne pove
      assert.equal(konec.call.status, "zakljucen");
    }
  });

  it("vec vprasanj zapored ne zakljuci klica (tudi tretje ne); pri predzadnji dovoljeni zahtevi odgovor in slovo v ISTEM odgovoru", async () => {
    const { reci } = await klic("CA-PS-9");
    await reci(SPOROCILO);
    for (let i = 0; i < 4; i += 1) {
      const r = await reci("Ali imate mojo številko?", { zahteva: 3 + i });
      assert.notEqual(r.call.status, "zakljucen", `${i + 1}. vprasanje`);
      assert.match(r.reply, /nasvidenje\.$/, "pravilo C: odgovor ima zakljucni stavek, klic pa ostane odprt");
    }
    const zadnji = await reci(IZREK_2, { zahteva: 9 });
    assert.match(zadnji.reply, /^Zapisala sem: .*\. Hvala, nasvidenje\.$|^Zapisala sem: .*\. Hvala za klic, nasvidenje\.$/);
    assert.equal(zadnji.call.status, "zakljucen");
    // Tudi odgovor na vprasanje pri predzadnji zahtevi dobi slovo.
    const drugi = await klic("CA-PS-9B");
    await drugi.reci(SPOROCILO);
    const r = await drugi.reci("Ali imate mojo številko?", { zahteva: 9 });
    assert.match(r.reply, /^Da, vidim, da ste poklicali s številke .* Hvala za klic, nasvidenje\.$/);
    assert.equal(r.call.status, "zakljucen");
  });
});

describe("skil lina-slovenski-klici (razlicica 2): pravili sta v navodilu modela", () => {
  it("»prosnja, naj Lina pove, prebere ali ponovi sporocilo, je ponovitev« in »klica ne zakljuci kot odgovor na vprasanje ali prosnjo«", () => {
    assert.ok(SKIL_RAZLICICA >= 2);
    assert.match(NAVODILO_OSEBNEGA, /Prošnja, naj Lina pove, prebere ali ponovi sporočilo \(»povej mi, kakšno je moje sporočilo«[^\n]*je ponovitev/);
    assert.match(NAVODILO_OSEBNEGA, /Klica ne zaključi kot odgovor na vprašanje ali prošnjo klicatelja/);
  });
});
