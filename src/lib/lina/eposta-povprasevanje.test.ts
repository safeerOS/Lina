/**
 * Povprasevanje tudi po e-posti (lastnik 23. 11. 2026, nacin podjetje): »mora obvezno prositi ce lahko povprasevanje se
 * oddajo na elektronsko posto ki jo vnese uporabnik«. V VSAKEM klicu s povprasevanjem (potrditev, iztek casa, tisina, vaja)
 * Lina vljudno prosi enkrat in naslov razlocno izgovori; ce je klicatelj e-posto ze omenil, se nanjo sklicuje. Predlog naslova
 * s strani podjetja velja sele po potrditvi in ne prepise vpisanega. Brez omrezja; samo izmisljeni podatki.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { t } from "./besedila.ts";
import { formaCatalog } from "./catalog.ts";
import { izgovoriEnaslov, naslovJeTezakZaGovor, naslovNaDomeni, omenilEposto, stavekPotrditve } from "./eposta.ts";
import { stalniStavki } from "./glas.ts";
import { loadPravila, savePravila } from "./pravila.server.ts";
import { loadLine, publishLine, recordCaller } from "./service.server.ts";
import { preberiStran, type SpletOdgovor, type SpletZahteva } from "./splet.ts";
import { potrdiPredlog, preberiStranPodjetja } from "./splet.server.ts";

process.env.LINA_LLM = "0";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-eposta-pov-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const temps: string[] = [];
afterEach(async () => {
  while (temps.length) {
    const dir = temps.pop();
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

const NASLOV = "info@primer.si";
const IZGOVOR = "info, afna, primer, pika, si";
const PROSNJA = `Prosim vas, če lahko povpraševanje pošljete še po elektronski pošti na naslov ${IZGOVOR}.`;
const OMENJENO = `Kot ste omenili, lahko povpraševanje pošljete še po elektronski pošti na naslov ${IZGOVOR}.`;

async function linija(pravila: Parameters<typeof savePravila>[0] = {}): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  temps.push(dir);
  const token = await setupOwner("geslo-test-1234", dir);
  await publishLine({ open: true, brezGlasu: true, catalog: formaCatalog() }, { token }, dir);
  await savePravila({ prevzem: "vsi", potrditevNaslov: NASLOV, ...pravila }, token, dir);
  return { dir, token };
}

let stevec = 0;
const OD = "+38640000000";

async function potek(dir: string, izreki: { text: string; now?: string }[], moznosti: { vaja?: boolean } = {}, zacetek?: string) {
  const sid = `CA-EPOV-${(stevec += 1)}`;
  const o = [await recordCaller({ callSid: sid, from: OD, text: "", ...(zacetek ? { now: zacetek } : {}) }, dir, undefined, moznosti)];
  for (const i of izreki) o.push(await recordCaller({ callSid: sid, from: OD, ...i }, dir, undefined, moznosti));
  return o;
}

const prosenj = (besedila: string[]) => besedila.filter((b) => b.includes("afna")).length;

describe("e-posta za povprasevanja: stavek", () => {
  it("vljudna prosnja z izgovorjenim naslovom; ob omembi se sklicuje na klicatelja", () => {
    const p = { potrditevEposta: true, potrditevNaslov: NASLOV, nacinKlica: "podjetje" };
    assert.equal(stavekPotrditve(p), PROSNJA);
    assert.equal(stavekPotrditve(p, true), OMENJENO);
    assert.equal(stavekPotrditve({ ...p, nacinKlica: "osebna" }, true), "");
    assert.equal(stavekPotrditve({ ...p, potrditevEposta: false }), "");
    assert.equal(stavekPotrditve({ ...p, potrditevNaslov: "" }), "");
  });

  it("info@mvm.si: kratica brez samoglasnika se crkuje (em, ve, em); vmesnik opozori, da je naslov tezji za govor", () => {
    assert.equal(izgovoriEnaslov("info@mvm.si"), "info, afna, em, ve, em, pika, si");
    assert.equal(naslovJeTezakZaGovor("info@mvm.si"), true);
  });

  it("omenilEposto: besede za e-posto da, narekovan naslov in navadna posta ne", () => {
    for (const da of ["Poslal bom še po mailu.", "Imate e-pošto?", "lahko pošljem na email", "po elektronski pošti bi poslal", "a mate e-naslov", "vam pošljem mejl"]) {
      assert.equal(omenilEposto([da]), true, da);
    }
    for (const ne of ["Dve mizi iz hrasta.", "moj je ana afna primer pika si", "Paket je prinesla pošta.", "gmail ne", "moj mail je ana afna primer pika si", "e-pošta"]) {
      assert.equal(omenilEposto([ne]), false, ne);
    }
  });

  it("pregled 0.2.10 (najdba 11): prosnja, naj PODJETJE pise klicatelju, ni omemba »Kot ste omenili«", () => {
    for (const ne of ["Lahko mi pošljete ponudbo po mailu?", "Pošljite mi na e-pošto, prosim.", "napišite mi mail", "pa mi odpišete po elektronski pošti", "lahko odgovorite na moj mail"]) {
      assert.equal(omenilEposto([ne]), false, ne);
    }
    // Klicatelj sam posilja: se vedno omemba, tudi ce v izreku nagovori podjetje.
    for (const da of ["Lahko vam pošljem po mailu?", "Kam vam lahko pošljem e-pošto?", "Imate e-naslov, da vam pošljem?"]) {
      assert.equal(omenilEposto([da]), true, da);
    }
  });

  it("stalni stavki vsebujejo obe razlicici (vnaprej sintetizirani, brez molka ob koncu)", () => {
    const stalni = stalniStavki({ pozdrav: "", potrditevEposta: true, potrditevNaslov: NASLOV, nacinKlica: "podjetje" }, "Primer");
    assert.ok(stalni.includes(PROSNJA));
    assert.ok(stalni.includes(OMENJENO));
  });
});

describe("e-posta za povprasevanja: v vsakem klicu s povprasevanjem, enkrat", { concurrency: 1 }, () => {
  const POVPRASEVANJE = "Dve mizi Alba iz hrasta, rok do petka.";

  it("klicatelj je e-posto omenil: ob koncu se Lina na to sklicuje (enkrat)", async () => {
    const { dir } = await linija();
    const o = await potek(dir, [{ text: "Ana Primer, nisem iz podjetja. Povpraševanje bom poslala tudi po mailu." }, { text: POVPRASEVANJE }, { text: "Da." }]);
    const konec = o[o.length - 1];
    assert.equal(konec.call.status, "zakljucen");
    assert.ok(konec.reply.startsWith(OMENJENO), konec.reply);
    assert.equal(prosenj(konec.call.transcript.filter((v) => v.role === "lina").map((v) => v.text)), 1);
  });

  it("klicatelj narekuje svoj e-naslov (brez besede o posiljanju): navadna prosnja, ne »Kot ste omenili«", async () => {
    const { dir } = await linija();
    const o = await potek(dir, [{ text: "Ana Primer, nisem iz podjetja. Moj mail je ana afna primer pika si." }, { text: POVPRASEVANJE }, { text: "Da." }]);
    const konec = o[o.length - 1];
    assert.equal(konec.call.status, "zakljucen");
    assert.ok(konec.reply.startsWith(PROSNJA), konec.reply);
  });

  it("iztek casa klica: prosnja pred slovesom ob izteku", async () => {
    const { dir } = await linija({ najdaljsiPogovorMinut: 1 });
    const t0 = Date.parse("2026-11-23T10:00:00.000Z");
    const ob = (s: number) => new Date(t0 + s * 1000).toISOString();
    const o = await potek(
      dir,
      [
        { text: "Ana Primer, nisem iz podjetja.", now: ob(5) },
        { text: "Dve mizi Alba iz hrasta.", now: ob(10) },
        { text: "Hmm.", now: ob(40) },
        { text: "Še nekaj bi.", now: ob(70) },
      ],
      {},
      ob(0),
    );
    const konec = o[o.length - 1];
    assert.equal(konec.call.status, "zakljucen");
    assert.equal(konec.call.order.oznaka, t("casPotekel"));
    // odgovori() zadnjemu stavku doda manjkajoco zahvalo ali »Lep dan«; prosnja je pred slovesom.
    assert.ok(konec.reply.startsWith(`${PROSNJA} ${t("casSlovo")}`), konec.reply);
  });

  it("tisina po povprasevanju: prosnja pred slovesom zaradi tisine", async () => {
    const { dir } = await linija();
    const o = await potek(dir, [{ text: "Ana Primer, nisem iz podjetja." }, { text: "Dve mizi Alba iz hrasta." }, { text: "" }, { text: "" }]);
    const konec = o[o.length - 1];
    assert.equal(konec.call.status, "zakljucen");
    assert.ok(konec.reply.startsWith(`${PROSNJA} ${t("slovoTisina")}`), konec.reply);
  });

  it("tisina BREZ povprasevanja: prosnje ni", async () => {
    const { dir } = await linija();
    const o = await potek(dir, [{ text: "" }, { text: "" }]);
    assert.doesNotMatch(o[o.length - 1].reply, /afna/);
  });

  it("vaja: isti potek kot klic, prosnja tudi v vaji (Lina nic ne poslje)", async () => {
    const { dir } = await linija();
    const o = await potek(dir, [{ text: "Ana Primer, nisem iz podjetja." }, { text: POVPRASEVANJE }, { text: "Da." }], { vaja: true });
    assert.ok(o[o.length - 1].reply.startsWith(PROSNJA), o[o.length - 1].reply);
  });

  it("osebni nacin: nikoli", async () => {
    const { dir } = await linija({ nacinKlica: "osebna" });
    const o = await potek(dir, [{ text: "Tukaj Ana. Sporočite mu, da pridem jutri po mailu." }, { text: "Ne, to je vse." }, { text: "" }, { text: "" }]);
    for (const izid of o) assert.doesNotMatch(izid.reply, /afna|elektronsk/);
  });
});

function odgovor(status: number, glave: Record<string, string>, telo: string): SpletOdgovor {
  return { status, glave, telo: (async function* () { yield new TextEncoder().encode(telo); })(), prekini: () => undefined };
}

function stran(html: string) {
  return {
    razresi: async () => ["93.184.216.34"],
    povezava: async (z: SpletZahteva) =>
      z.pot === "/" ? odgovor(200, { "content-type": "text/html" }, html) : odgovor(404, { "content-type": "text/plain" }, ""),
  };
}

const HTML_SVOJ = `<html><head><title>Mizarstvo Primer</title></head><body><h1>Mizarstvo Primer</h1><p>Izdelujemo mize po meri iz lesa.</p>
<p>Izdelal <a href="mailto:studio@izdelovalec.example">studio</a>. Pišite na <a href="mailto:Info@Primer.si?subject=Povpraševanje">info</a>.</p></body></html>`;
const HTML_TUJ = `<html><head><title>Mizarstvo Primer</title></head><body><h1>Mizarstvo Primer</h1><p>Izdelujemo mize po meri iz lesa.</p>
<p>Pišite na <a href="mailto:mizarstvo.primer@posta.example">e-pošto</a>.</p></body></html>`;

describe("predlog e-poste iz strani podjetja", { concurrency: 1 }, () => {
  it("mailto na domeni strani je predizbran; tuj naslov (izdelovalec strani) ne", async () => {
    const svoj = await preberiStran("https://primer.si/", stran(HTML_SVOJ));
    assert.deepEqual(svoj.predlog.eposta, { id: "eposta", izbrano: true, naslov: NASLOV });
    const tuj = await preberiStran("https://primer.si/", stran(HTML_TUJ));
    assert.deepEqual(tuj.predlog.eposta, { id: "eposta", izbrano: false, naslov: "mizarstvo.primer@posta.example" });
  });

  it("pregled 0.2.10 (najdba 9): naslov na domeni strani tudi pri www; vmesnik uporabi isto preverbo", async () => {
    assert.equal(naslovNaDomeni("info@primer.si", "www.primer.si"), true);
    assert.equal(naslovNaDomeni("Info@Primer.si", "primer.si"), true);
    assert.equal(naslovNaDomeni("info@www.primer.si", "primer.si"), true);
    assert.equal(naslovNaDomeni("studio@izdelovalec.example", "www.primer.si"), false);
    assert.equal(naslovNaDomeni("info@posta.primer.si", "primer.si"), false, "poddomena ni ista");
    const www = await preberiStran("https://www.primer.si/", stran(HTML_SVOJ));
    assert.equal(www.predlog.eposta?.izbrano, true);
    const desk = readFileSync(new URL("../../components/lina-desk.tsx", import.meta.url), "utf8");
    const i = desk.indexOf('t("spletEpostaTuja")');
    assert.ok(desk.slice(i - 300, i).includes("naslovNaDomeni(predlog.eposta.naslov, predlog.gostitelj)"), "vmesnik: ista preverba");
  });

  it("JSON-LD e-posta (tudi s predpono mailto:) je kandidat", async () => {
    const ld = `<html><head><title>Primer</title><script type="application/ld+json">{"@type":"LocalBusiness","name":"Primer","email":"mailto:Info@Primer.si"}</script></head><body><p>Izdelujemo mize po meri iz lesa.</p></body></html>`;
    const b = await preberiStran("https://primer.si/", stran(ld));
    assert.deepEqual(b.predlog.eposta, { id: "eposta", izbrano: true, naslov: NASLOV });
  });

  it("velja sele po potrditvi: brez izbire ostane prazno; z izbiro se vpise in vklopi; vpisanega ne prepise", async () => {
    const dir = await mkdtemp(path.join(KOREN, "s-"));
    temps.push(dir);
    const token = await setupOwner("geslo-test-1234", dir);
    await publishLine({ open: true, brezGlasu: true, catalog: formaCatalog() }, { token }, dir);
    const odv = stran(HTML_SVOJ);
    const p1 = await preberiStranPodjetja("https://primer.si/", token, dir, odv);
    assert.equal(p1.eposta?.naslov, NASLOV);
    assert.equal((await loadPravila(dir)).potrditevNaslov, "", "branje strani samo predlaga");
    await potrdiPredlog([p1.podjetje.id], token, dir);
    assert.equal((await loadPravila(dir)).potrditevNaslov, "", "brez izbire vrstice e-poste ni vpisa");

    const p2 = await preberiStranPodjetja("https://primer.si/", token, dir, odv);
    await potrdiPredlog([p2.podjetje.id, "eposta"], token, dir);
    const pravila = await loadPravila(dir);
    assert.equal(pravila.potrditevNaslov, NASLOV);
    assert.equal(pravila.potrditevEposta, true, "prvi veljaven naslov vklopi prosnjo");

    await savePravila({ potrditevNaslov: "narocila@primer.si" }, token, dir);
    await preberiStranPodjetja("https://primer.si/", token, dir, odv);
    await potrdiPredlog(["eposta"], token, dir);
    assert.equal((await loadPravila(dir)).potrditevNaslov, "narocila@primer.si", "vpisan naslov ostane");
  });

  it("pregled 0.2.10 (najdba 10, CodeRabbit): katalog se objavi PRED e-posto; napaka pri shranjevanju e-poste potrditve ne ustavi", async () => {
    const dir = await mkdtemp(path.join(KOREN, "s-"));
    temps.push(dir);
    const token = await setupOwner("geslo-test-1234", dir);
    await publishLine({ open: true, brezGlasu: true, catalog: formaCatalog() }, { token }, dir);
    const p = await preberiStranPodjetja("https://primer.si/", token, dir, stran(HTML_SVOJ));
    // Rocno pokvarjena nepovezana nastavitev: savePravila zavrne vsako shranjevanje.
    await writeFile(path.join(dir, "pravila.json"), JSON.stringify({ prevezavaUrnik: "vsak dan nekoc" }));
    await assert.rejects(savePravila({ potrditevNaslov: NASLOV }, token, dir));
    const catalog = await potrdiPredlog([p.podjetje.id, "eposta"], token, dir);
    assert.equal(catalog.company.name, "Mizarstvo Primer", "katalog objavljen");
    assert.equal((await loadLine(dir)).catalog.company.name, "Mizarstvo Primer");
    assert.equal((await loadPravila(dir)).potrditevNaslov, "", "e-posta ni shranjena (napaka), katalog pa je");
  });
});
