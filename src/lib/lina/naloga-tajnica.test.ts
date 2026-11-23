/**
 * Naloga A (lastnik 10. 11. 2026): tajnica direktorja HKRATI s povprasevanjem, v istem klicu brez preklopa.
 * Lina zapise (a) povprasevanje iz kataloga in (b) tajniski zapis: sporocilo za direktorja, razlog, nujnost, dosegljivost.
 * Pravila o cenah, obljubah in stiku veljajo za oba dela. Brez omrezja; samo izmisljeni podatki (+386 40 000 000).
 */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { formaCatalog } from "./catalog.ts";
import { savePravila } from "./pravila.server.ts";
import { publishLine, recordCaller } from "./service.server.ts";
import { sistemskoNavodilo } from "./live/navodilo.ts";
import { izrecnoNiNujno, jeNujno, jeSporociloDirektorju, odgovorNujnost, zajemiRazlog, zajemiTajnico } from "./tajnica.ts";

process.env.LINA_LLM = "0";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-tajnica-"));
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
  const token = await setupOwner("geslo-test-1234", dir);
  await publishLine({ open: true, brezGlasu: true, catalog: formaCatalog() }, { token }, dir);
  await savePravila({ prevzem: "vsi" }, token, dir);
  return dir;
}

const OD = "+38640000000";
let stevec = 0;

async function potek(dir: string, izreki: string[], od = OD) {
  const sid = `CA-TAJ-${(stevec += 1)}`;
  const odgovori: Awaited<ReturnType<typeof recordCaller>>[] = [await recordCaller({ callSid: sid, from: od, text: "" }, dir)];
  for (const izrek of izreki) odgovori.push(await recordCaller({ callSid: sid, from: od, text: izrek }, dir));
  return odgovori;
}

function zapiskiKlica(dir: string): string[] {
  const mapa = path.join(dir, "zapiski");
  // Lastnik 22. 11. 2026: vsak klic ima svojo mapo <mapa>/zapisek.md (poleg starih ravnih .md datotek).
  return readdirSync(mapa).map((ime) => {
    const pot = path.join(mapa, ime);
    return readFileSync(statSync(pot).isDirectory() ? path.join(pot, "zapisek.md") : pot, "utf8");
  });
}

describe("tajnica: prepoznava izrekov (cista logika)", () => {
  it("sporocilo za direktorja", () => {
    for (const izrek of [
      "Sporočite direktorju, da naj me pokliče.",
      "Povejte direktorju, da je pogodba pripravljena.",
      "Imam sporočilo za direktorja.",
      "Direktor naj me pokliče nazaj.",
      "Rad bi govoril z direktorjem.",
    ]) {
      assert.equal(jeSporociloDirektorju(izrek), true, izrek);
    }
    for (const izrek of ["Rada bi naročila dve mizi Alba.", "Kdaj ste odprti?", "Direktor je dober človek."]) {
      assert.equal(jeSporociloDirektorju(izrek), false, izrek);
    }
  });

  it("razlog klica", () => {
    assert.equal(zajemiRazlog("Kličem zaradi reklamacije, prosim."), "reklamacije");
    assert.equal(zajemiRazlog("Kličem glede ponudbe za mize. Hvala."), "ponudbe za mize");
    assert.equal(zajemiRazlog("Rada bi naročila mizo."), "");
  });

  it("nujnost: samo kar pove klicatelj, brez ugibanja", () => {
    for (const izrek of ["Nujno je, rabim odgovor danes.", "Gre za nujno zadevo.", "Pokličite me še danes.", "Rabim odgovor danes."]) {
      assert.equal(jeNujno(izrek), true, izrek);
    }
    for (const izrek of ["Ni nujno.", "Danes je lep dan.", "Sporočite direktorju, da me pokliče.", "Lahko počaka."]) {
      assert.equal(jeNujno(izrek), false, izrek);
    }
    assert.equal(izrecnoNiNujno("Ni nujno."), true);
    assert.equal(odgovorNujnost("Da."), "da");
    assert.equal(odgovorNujnost("Ne, lahko počaka."), "ne");
    assert.equal(odgovorNujnost("Mogoče bi lahko jutri."), null);
  });
});

describe("tajnica: povprasevanje IN sporocilo za direktorja v istem klicu", { concurrency: 1 }, () => {
  it("klic s povprasevanjem in sporocilom da OBA zapisa (calls.json in zapisek)", async () => {
    const dir = await linija();
    const o = await potek(dir, [
      "Ana Primer, nisem iz podjetja.",
      "Rada bi naročila dve mizi Alba iz hrasta. Sporočite direktorju, da naj me pokliče glede reklamacije. Dosegljiva sem jutri po 14h.",
      "Do petka.",
      "Ne, ni nujno.",
      "Da.",
    ]);
    const koncni = o[o.length - 1];
    assert.equal(koncni.call.status, "zakljucen");
    const o1 = koncni.call.order;
    // (a) povprasevanje iz kataloga
    assert.equal(o1.productName, "Alba");
    assert.equal(o1.materialName, "Hrast");
    assert.equal(o1.quantity, 2);
    assert.equal(o1.deadline, "petka");
    assert.equal(o1.confirmed, true);
    // (b) tajniski zapis
    assert.match(o1.tajnica?.sporocilo ?? "", /direktorju/);
    assert.match(o1.tajnica?.sporocilo ?? "", /reklamacije/);
    // Sporocilo je samo sporocilni stavek; povprasevanje (mize) ima svoj zapis in ni v sporocilu.
    assert.doesNotMatch(o1.tajnica?.sporocilo ?? "", /mize|Alba|hrast/i);
    assert.equal(o1.tajnica?.nujno, false);
    assert.equal(o1.tajnica?.nujnostZnana, true);
    assert.match(o1.dosegljiv ?? "", /jutri po 14h/);
    assert.equal(o1.podjetjeKlicatelja, "");
    // zapisek za direktorja ima oba dela
    const md = zapiskiKlica(dir)[0];
    assert.match(md, /Sporočilo za direktorja: .*reklamacije/);
    assert.match(md, /Povratni klic: dosegljiva sem jutri po 14h/i);
    assert.match(md, /Izdelek ali povpraševanje: Alba/);
    // v povzetku po klicu je sporocilo
    assert.match(koncni.call.povzetek?.sporocilo ?? "", /reklamacije/);
    // Lina je potrdila zapis sporocila in nikjer ne obljubila klica ob tem casu
    const vse = o.map((x) => x.reply).join(" | ");
    assert.match(vse, /Sporočilo za direktorja sem zapisala\./);
    assert.match(vse, /Zapisala sem, da ste dosegljivi jutri po 14h\./);
    assert.doesNotMatch(vse, /Poklicali vas bomo jutri/);
    assert.doesNotMatch(vse, /direktor[^.]*poklic|poklic[^.]*direktor/i);
  });

  it("samo sporocilo za direktorja (brez izdelka): zapis brez povzetka za potrditev in brez vprasanja o roku", async () => {
    const dir = await linija();
    const o = await potek(dir, [
      "Ana Primer, nisem iz podjetja.",
      "Sporočite direktorju, da naj preveri pogodbo. Kličem zaradi pogodbe.",
      "Ne, ni nujno.",
    ]);
    const vse = o.map((x) => x.reply).join(" | ");
    assert.doesNotMatch(vse, /Do kdaj potrebujete/);
    assert.doesNotMatch(vse, /Ali potrjujete/);
    assert.match(o[2].reply, /Sporočilo za direktorja sem zapisala\. Ali je zadeva nujna\?/);
    const koncni = o[3];
    assert.equal(koncni.call.status, "zakljucen");
    assert.match(koncni.reply, /Hvala za klic/);
    assert.equal(koncni.call.order.tajnica?.razlog, "pogodbe");
    assert.equal(koncni.call.order.tajnica?.nujno, false);
    assert.match(koncni.call.povzetek?.zelel ?? "", /preveri pogodbo/);
    assert.equal(koncni.call.povzetek?.nujno, undefined);
    assert.match(zapiskiKlica(dir)[0], /Razlog klica: pogodbe/);
  });

  it("fizicna oseba brez podjetja ni vprasana dvakrat", async () => {
    const dir = await linija();
    const o = await potek(dir, [
      "Ana Primer, nisem iz podjetja.",
      "Sporočite direktorju, da me pokliče. Kličem zaradi pogodbe.",
      "Ne.",
    ]);
    // Podjetje je vprasano samo v pozdravu (obrat 0); pozneje nobena Lina replika ne sprasuje po podjetju.
    assert.match(o[0].reply, /podjetje/);
    for (const x of o.slice(1)) assert.doesNotMatch(x.reply, /podjetj/i);
    assert.equal(o[o.length - 1].call.order.podjetjeKlicatelja, "");
  });

  it("klicatelj iz podjetja: podjetje je v zapisu, tajniski zapis ga ne vprasa znova", async () => {
    const dir = await linija();
    const o = await potek(dir, ["Ana Primer, kličem v imenu podjetja Primerko.", "Sporočite direktorju, da je ponudba pripravljena.", "Ne."]);
    assert.equal(o[o.length - 1].call.order.podjetjeKlicatelja, "Primerko");
    for (const x of o.slice(1)) assert.doesNotMatch(x.reply, /podjetj/i);
  });

  it("»dosegljiv sem jutri po 14h« je v zapisniku; Lina ne obljubi, da bo direktor klical ob tem casu", async () => {
    const dir = await linija();
    const o = await potek(dir, [
      "Ana Primer, nisem iz podjetja.",
      "Sporočite direktorju, da naj me pokliče. Dosegljiv sem jutri po 14h.",
      "Ne.",
    ]);
    const koncni = o[o.length - 1];
    assert.match(koncni.call.order.dosegljiv ?? "", /jutri po 14h/);
    assert.match(zapiskiKlica(dir)[0], /Povratni klic: dosegljiv sem jutri po 14h/i);
    const vse = o.map((x) => x.reply).join(" | ");
    assert.doesNotMatch(vse, /Poklicali vas bomo/);
    assert.doesNotMatch(vse, /direktor[^.]*poklic|poklic[^.]*direktor/i);
  });

  it("cene: znesek iz sporocila ne gre v povzetek ali govor, Lina ga ne ponovi", async () => {
    const dir = await linija();
    const o = await potek(dir, ["Ana Primer, nisem iz podjetja.", "Sporočite direktorju, da je ponudba 500 evrov previsoka.", "Ne."]);
    const vse = o.map((x) => x.reply).join(" | ");
    assert.doesNotMatch(vse, /500|evr/i);
    const koncni = o[o.length - 1];
    assert.doesNotMatch(koncni.call.povzetek?.sporocilo ?? "", /500|evr/i);
    assert.doesNotMatch(koncni.call.povzetek?.zelel ?? "", /500|evr/i);
    assert.doesNotMatch(koncni.call.transcript.filter((v) => v.role === "lina").map((v) => v.text).join(" "), /500|evr/i);
  });

  it("stik: telefona iz sporocila ni v tajniskem zapisu (ostane v stiku)", async () => {
    const dir = await linija();
    const o = await potek(dir, ["Ana Primer, nisem iz podjetja.", "Sporočite direktorju, da naj me pokliče na 040 000 000, moj e-naslov je ana@primer.si.", "Ne."]);
    const t = o[o.length - 1].call.order.tajnica;
    assert.ok(t?.sporocilo);
    assert.doesNotMatch(t?.sporocilo ?? "", /040|000|@/);
  });

  it("nujnost se vprasa najvec enkrat; brez sporocila se sploh ne vprasa (navadno povprasevanje)", async () => {
    const dir = await linija();
    const brez = await potek(dir, ["Ana Primer, nisem iz podjetja.", "Rada bi naročila dve mizi Alba iz hrasta, rok do petka.", "Da."]);
    assert.doesNotMatch(brez.map((x) => x.reply).join(" | "), /nujna\?/);
    assert.equal(brez[brez.length - 1].call.order.tajnica, undefined);
    const z = await potek(dir, ["Ana Primer, nisem iz podjetja.", "Sporočite direktorju, da me pokliče.", "Mogoče.", "Še enkrat sporočite direktorju, da me pokliče."]);
    const vprasanj = z.map((x) => x.reply).filter((r) => /Ali je zadeva nujna\?/.test(r)).length;
    assert.equal(vprasanj, 1);
  });
});

describe("popravki po pregledu kode (CodeRabbit)", () => {
  it("navadna predstavitev klicatelja (»klicem danes iz podjetja«) ni nujnost; prosnja za povratni klic danes je", () => {
    assert.equal(jeNujno("Dober dan, klicem danes iz podjetja Primer."), false);
    assert.equal(jeNujno("Danes klicem zaradi ponudbe."), false);
    assert.equal(jeNujno("Poklicite me se danes."), true);
  });

  it("sporocilo ohrani vsebinske stavke po uvodnem stavku, ne le uvoda", () => {
    const izrek = "Sporocite direktorju. Rabim ponudbo za deset miz do petka.";
    const z = zajemiTajnico(izrek, izrek, undefined);
    assert.match(z?.sporocilo ?? "", /ponudbo za deset miz/);
  });

  it("klicatelj izrecno popravi (»saj ni nujno«): oznaka Nujno se umakne", () => {
    const prej = { sporocilo: "Sporocite direktorju, da je nujno.", razlog: "", nujno: true, nujnostZnana: true };
    assert.equal(zajemiTajnico("Saj ni nujno, lahko pocaka.", "Saj ni nujno, lahko pocaka.", prej)?.nujno, false);
    assert.equal(zajemiTajnico("Ne.", "Ne.", prej, "nujnost")?.nujno, false);
  });

  it("Live navodilo: sporocilo samo za direktorja se ne potrjuje kot narocilo", () => {
    const n = sistemskoNavodilo({ podjetje: "Primer", katalog: formaCatalog(), pozdrav: "Pozdravljeni" });
    assert.match(n, /samo sporocilo za direktorja, narocila ne ponavljaj in potrditve ne vprasaj/);
  });
});
