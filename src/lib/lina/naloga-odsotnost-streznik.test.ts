/**
 * Naloga lina-odsotnost-streznik: shranjevanje, preverba, izgovor, zapis in vprasanja o odsotnosti na strezniku.
 * Vsi podatki so izmisljeni (Ana, +38640000001). Brez omrezja, LINA_LLM=0.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { t } from "./besedila.ts";
import { stalniStavki } from "./glas.ts";
import { pocakajDnevnikGlasu, pocakajGlas, ustaviCiscenjeZvoka } from "./glas.server.ts";
import { konecVMs, ODSOTNOST_NAJVEC_NAPREJ_MS, odsotnostOdgovor, odsotnostStavek, preveriPas, razlogOdsotnosti } from "./odsotnost.ts";
import { varenOdgovorOsebna } from "./osebna-razumevanje.server.ts";
import { uvodKlica } from "./povzetek.ts";
import { defaultPravila, loadPravila, normalizePravila, savePravila } from "./pravila.server.ts";
import type { ModelRazumevanja } from "./razumevanje.server.ts";
import { preberiKlic, recordCaller } from "./service.server.ts";
import { writeJson } from "./store.server.ts";
import { vsebinaZapiska } from "./zapiski.ts";

process.env.LINA_LLM = "0";
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-odsotnost-streznik-"));
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

const STEVILKA = "+38640000001";
const BREZ_MODELA: ModelRazumevanja = async () => null;

async function novaMapa(): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  dirs.push(dir);
  const token = await setupOwner("geslo-odsotnost-1234", dir);
  return { dir, token };
}

function casNaprej(ur: number): { zdaj: Date; konecIso: string; konecLokalno: string } {
  const zdaj = new Date(Date.now() + 60_000);
  const konec = new Date(zdaj.getTime() + ur * 3_600_000);
  // Zaokrozi na minuto navzgor, brez sekund/ms za cisto primerjavo.
  konec.setUTCSeconds(0, 0);
  return { zdaj, konecIso: konec.toISOString(), konecLokalno: konec.toISOString().slice(0, 16) + "Z" };
}

describe("(a) shrani in nalozi: vsa 4 polja prezivijo savePravila -> loadPravila", () => {
  it("vsa 4 polja odsotnosti se shranijo, kanonizirajo in ponovno nalozijo", async () => {
    const { dir, token } = await novaMapa();
    const { konecIso } = casNaprej(3);
    const shranjeno = await savePravila(
      {
        prevzem: "vsi",
        nacinKlica: "osebna",
        imeLastnika: "Ana",
        odsotnostVklop: true,
        odsotnostRazlog: "v sluzbi",
        odsotnostDo: konecIso,
        odsotnostCasovniPas: "Europe/Ljubljana",
      },
      token,
      dir,
    );
    assert.equal(shranjeno.odsotnostVklop, true);
    assert.equal(shranjeno.odsotnostRazlog, "v službi");
    assert.equal(shranjeno.odsotnostDo, konecIso);
    assert.equal(shranjeno.odsotnostCasovniPas, "Europe/Ljubljana");
    assert.deepEqual(shranjeno.opozorila, []);

    const nalozeno = await loadPravila(dir);
    assert.equal(nalozeno.odsotnostVklop, true);
    assert.equal(nalozeno.odsotnostRazlog, "v službi");
    assert.equal(nalozeno.odsotnostDo, konecIso);
    assert.equal(nalozeno.odsotnostCasovniPas, "Europe/Ljubljana");
  });

  it("stara datoteka brez polj odsotnosti ostane brez odsotnosti; neveljaven shranjen razlog ali pas ne postaneta tiho veljavna", async () => {
    const { dir } = await novaMapa();
    await writeJson(dir, "pravila.json", { prevzem: "vsi", nacinKlica: "osebna", imeLastnika: "Ana" });
    const stara = await loadPravila(dir);
    assert.equal(stara.odsotnostVklop, false);
    assert.equal(stara.odsotnostRazlog, "");
    assert.equal(stara.odsotnostDo, "");

    const slabRazlog = normalizePravila({
      nacinKlica: "osebna",
      odsotnostVklop: true,
      odsotnostRazlog: "poklicem vas ob treh",
    });
    assert.equal(slabRazlog.odsotnostVklop, false);
    assert.notEqual(razlogOdsotnosti(slabRazlog.odsotnostRazlog), null);

    const slabPas = normalizePravila({
      nacinKlica: "osebna",
      odsotnostVklop: true,
      odsotnostRazlog: "v službi",
      odsotnostCasovniPas: "Mars/Phobos",
    });
    assert.equal(slabPas.odsotnostVklop, false);
    assert.equal(preveriPas(slabPas.odsotnostCasovniPas).veljaven, false);
  });
});

describe("(b) neveljavni vnosi zavrnjeni s pravim sporocilom", () => {
  it("zavrne vseh 5 neveljavnih primerov ob vklopljeni odsotnosti", async () => {
    const { dir, token } = await novaMapa();
    const { konecIso } = casNaprej(2);
    const predaleko = new Date(Date.now() + ODSOTNOST_NAJVEC_NAPREJ_MS + 48 * 3_600_000).toISOString();

    await assert.rejects(
      savePravila({ nacinKlica: "osebna", odsotnostVklop: true, odsotnostRazlog: "neki prosto besedilo" }, token, dir),
      (err: unknown) => err instanceof Error && err.message === t("odsotnostRazlogShranjenNeveljaven"),
    );
    await assert.rejects(
      savePravila({ nacinKlica: "osebna", odsotnostVklop: true, odsotnostRazlog: "v službi", odsotnostDo: "jutri ob 15h" }, token, dir),
      (err: unknown) => err instanceof Error && err.message === t("odsotnostDoNeveljaven"),
    );
    // Prehod na poletni cas v Europe/Ljubljana: 2027-03-28 02:30 ne obstaja
    await assert.rejects(
      savePravila(
        { nacinKlica: "osebna", odsotnostVklop: true, odsotnostRazlog: "v službi", odsotnostDo: "2027-03-28T02:30", odsotnostCasovniPas: "Europe/Ljubljana" },
        token,
        dir,
      ),
      (err: unknown) => err instanceof Error && err.message === t("odsotnostDoNeobstojec"),
    );
    await assert.rejects(
      savePravila({ nacinKlica: "osebna", odsotnostVklop: true, odsotnostRazlog: "v službi", odsotnostDo: predaleko }, token, dir),
      (err: unknown) => err instanceof Error && err.message === t("odsotnostDoPredaleko"),
    );
    await assert.rejects(
      savePravila(
        { nacinKlica: "osebna", odsotnostVklop: true, odsotnostRazlog: "v službi", odsotnostDo: konecIso, odsotnostCasovniPas: "Mars/Olympus" },
        token,
        dir,
      ),
      (err: unknown) => err instanceof Error && err.message === t("odsotnostPasNeveljaven"),
    );
  });

  it("zavrne napacno vrsto vrednosti polja in ne-objekt input", async () => {
    const { dir, token } = await novaMapa();
    await assert.rejects(
      savePravila({ odsotnostVklop: "da" as unknown as boolean }, token, dir),
      (err: unknown) => err instanceof Error && err.message === t("pravilaVnosTip").replace("{polje}", "odsotnostVklop"),
    );
    await assert.rejects(
      savePravila({ odsotnostDo: 5 as unknown as string }, token, dir),
      (err: unknown) => err instanceof Error && err.message === t("pravilaVnosTip").replace("{polje}", "odsotnostDo"),
    );
    await assert.rejects(
      savePravila({ odsotnostRazlog: 42 as unknown as string }, token, dir),
      (err: unknown) => err instanceof Error && err.message === t("pravilaVnosTip").replace("{polje}", "odsotnostRazlog"),
    );
    await assert.rejects(
      savePravila({ odsotnostCasovniPas: true as unknown as string }, token, dir),
      (err: unknown) => err instanceof Error && err.message === t("pravilaVnosTip").replace("{polje}", "odsotnostCasovniPas"),
    );
    for (const slab of [null, "x", [], 123] as unknown[]) {
      await assert.rejects(
        savePravila(slab as never, token, dir),
        (err: unknown) => err instanceof Error && err.message === t("pravilaVnosOblika"),
      );
    }
  });

  it("poskodovana datoteka pravil na disku (ni objekt): loadPravila ne sesuje, savePravila zavrne brez prepisa", async () => {
    for (const vsebina of ["[]", '"x"']) {
      const { dir, token } = await novaMapa();
      const pot = path.join(dir, "pravila.json");
      await writeFile(pot, vsebina, "utf8");
      const nalozeno = await loadPravila(dir);
      assert.equal(nalozeno.nacinKlica, defaultPravila().nacinKlica);
      assert.equal(nalozeno.odsotnostVklop, false);

      await assert.rejects(
        savePravila({ pozdrav: "Pozdrav" }, token, dir),
        (err: unknown) => err instanceof Error && err.message === t("pravilaDatotekaPoskodovana"),
      );
      assert.equal(await readFile(pot, "utf8"), vsebina, "datoteka na disku ostane nedotaknjena");
    }
  });
});

describe("(c) pretekel konec: shranjeno z opozorilom, pozdrav BREZ stavka", () => {
  it("shrani z opozorilom odsotnostPretekla in pozdrav ne vsebuje stavka odsotnosti", async () => {
    const { dir, token } = await novaMapa();
    const preteklo = new Date(Date.now() - 3_600_000).toISOString();
    const izid = await savePravila(
      {
        prevzem: "vsi",
        nacinKlica: "osebna",
        imeLastnika: "Ana",
        odsotnostVklop: true,
        odsotnostRazlog: "v službi",
        odsotnostDo: preteklo,
        odsotnostCasovniPas: "Europe/Ljubljana",
      },
      token,
      dir,
    );
    assert.ok(izid.opozorila.includes(t("odsotnostPretekla")), `opozorila: ${JSON.stringify(izid.opozorila)}`);
    const pozdrav = await recordCaller({ callSid: "CA-ODS-PRETEKLA", from: STEVILKA, text: "" }, dir, undefined, { razumevanje: BREZ_MODELA });
    assert.doesNotMatch(pozdrav.reply, /v službi|ne more odgovoriti/i);
    assert.equal(pozdrav.call.odsotnostPovedana, undefined);
  });
});

function prihodnjiDanLjubljana(): { zdaj: Date; konec: string; poIzteku: Date } {
  const dan = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const zdajMs = konecVMs(`${dan}T10:00`, "Europe/Ljubljana");
  const poMs = konecVMs(`${dan}T15:30`, "Europe/Ljubljana");
  assert.ok(zdajMs !== null && poMs !== null);
  return { zdaj: new Date(zdajMs), konec: `${dan}T15:00`, poIzteku: new Date(poMs) };
}

describe("(d) aktivna odsotnost v pozdravu (osebna da, podjetje nikoli) in poravnava glas.ts", () => {
  it("osebna tajnica: stavek odsotnosti po Poklicali ste in pred vprasanjem; glas.ts stalniStavki poravnan z uvodKlica", async () => {
    const { dir, token } = await novaMapa();
    const { zdaj, konec, poIzteku } = prihodnjiDanLjubljana();
    await savePravila(
      {
        prevzem: "vsi",
        nacinKlica: "osebna",
        imeLastnika: "Ana",
        odsotnostVklop: true,
        odsotnostRazlog: "v službi",
        odsotnostDo: konec,
        odsotnostCasovniPas: "Europe/Ljubljana",
      },
      token,
      dir,
    );
    const pravila = await loadPravila(dir);
    const pricakovanStavek = odsotnostStavek(pravila, zdaj);
    assert.ok(pricakovanStavek.length > 0);
    assert.match(pricakovanStavek, /Ana je do petnajste ure v službi/);

    const uvod = uvodKlica(pravila, "", zdaj);
    const stalni = stalniStavki(pravila, "", undefined, zdaj);
    assert.ok(stalni.includes(uvod), `stalniStavki mora vsebovati uvodKlica z odsotnostjo:\nuvod: ${uvod}`);

    const pozdrav = await recordCaller(
      { callSid: "CA-ODS-AKTIVNA", from: STEVILKA, text: "", now: zdaj.toISOString() },
      dir,
      undefined,
      { razumevanje: BREZ_MODELA },
    );
    assert.equal(pozdrav.reply, uvod);
    const iPoklicali = pozdrav.reply.indexOf("Poklicali ste Ano.");
    const iOdsotnost = pozdrav.reply.indexOf(pricakovanStavek);
    const iVprasanje = pozdrav.reply.indexOf(t("osebnaKajSporocim"));
    assert.ok(iPoklicali >= 0 && iOdsotnost > iPoklicali && iVprasanje > iOdsotnost, pozdrav.reply);

    // Po izteku (brez casovnika, preverba ob vsakem klicu) stavka ni vec
    const pozdravPo = await recordCaller(
      { callSid: "CA-ODS-PO-IZTEKU", from: STEVILKA, text: "", now: poIzteku.toISOString() },
      dir,
      undefined,
      { razumevanje: BREZ_MODELA },
    );
    assert.doesNotMatch(pozdravPo.reply, /v službi|ne more odgovoriti/i);
  });

  it("nacin podjetje: stavka odsotnosti NI nikoli", async () => {
    const { dir, token } = await novaMapa();
    const { zdaj, konec } = prihodnjiDanLjubljana();
    await savePravila(
      {
        prevzem: "vsi",
        nacinKlica: "podjetje",
        imeLastnika: "Ana",
        odsotnostVklop: true,
        odsotnostRazlog: "v službi",
        odsotnostDo: konec,
        odsotnostCasovniPas: "Europe/Ljubljana",
      },
      token,
      dir,
    );
    const pravila = await loadPravila(dir);
    assert.doesNotMatch(uvodKlica(pravila, "Primer d.o.o.", zdaj), /v službi|ne more odgovoriti/i);
    assert.ok(stalniStavki(pravila, "Primer d.o.o.", undefined, zdaj).every((s) => !/v službi|ne more odgovoriti/i.test(s)));
    const pozdrav = await recordCaller(
      { callSid: "CA-ODS-PODJETJE", from: STEVILKA, text: "", now: zdaj.toISOString() },
      dir,
      undefined,
      { razumevanje: BREZ_MODELA },
    );
    assert.doesNotMatch(pozdrav.reply, /v službi|ne more odgovoriti/i);
    assert.equal(pozdrav.call.odsotnostPovedana, undefined);
  });
});

describe("(e) + (f) + (g) zapis odsotnostPovedana in vprasanja klicatelja", () => {
  it("(e)+(f) aktivna odsotnost: vprasanje kje je in kdaj bo na voljo vrne dejstvo brez obljube; odsotnostPovedana brez podvojitev", async () => {
    const { dir, token } = await novaMapa();
    const { zdaj, konec } = prihodnjiDanLjubljana();
    const ZDAJ = zdaj.toISOString();
    await savePravila(
      {
        prevzem: "vsi",
        nacinKlica: "osebna",
        imeLastnika: "Ana",
        odsotnostVklop: true,
        odsotnostRazlog: "v službi",
        odsotnostDo: konec,
        odsotnostCasovniPas: "Europe/Ljubljana",
      },
      token,
      dir,
    );
    const pravila = await loadPravila(dir);
    const stavekPozdrav = odsotnostStavek(pravila, zdaj);
    const odgDejstvo = odsotnostOdgovor(pravila, "kje", zdaj);
    assert.equal(odgDejstvo, "Je do petnajste ure v službi.");

    const sid = "CA-ODS-VPR-1";
    const r0 = await recordCaller({ callSid: sid, from: STEVILKA, text: "", now: ZDAJ }, dir, undefined, { razumevanje: BREZ_MODELA });
    assert.deepEqual(r0.call.odsotnostPovedana, [stavekPozdrav]);

    // Vprasanje pred sporocilom
    const rPred = await recordCaller({ callSid: sid, from: STEVILKA, text: "Kje je Ana?", now: ZDAJ }, dir, undefined, { razumevanje: BREZ_MODELA });
    assert.ok(rPred.reply.includes(odgDejstvo), rPred.reply);
    assert.doesNotMatch(rPred.reply, /pokli[cč]|nazaj|vrne|javi/i);
    assert.deepEqual(rPred.call.odsotnostPovedana, [stavekPozdrav, odgDejstvo]);

    // Sporocilo
    await recordCaller({ callSid: sid, from: STEVILKA, text: "Povejte Ani da pridem v ponedeljek ob devetih", now: ZDAJ }, dir, undefined, { razumevanje: BREZ_MODELA });

    // Vprasanje po sporocilu (ista vsebina -> brez podvojitve v odsotnostPovedana)
    const rPo = await recordCaller({ callSid: sid, from: STEVILKA, text: "Kdaj bo Ana na voljo?", now: ZDAJ }, dir, undefined, { razumevanje: BREZ_MODELA });
    assert.ok(rPo.reply.includes(odgDejstvo), rPo.reply);
    assert.doesNotMatch(rPo.reply, /pokli[cč]|nazaj|vrne|javi/i);
    assert.deepEqual(rPo.call.odsotnostPovedana, [stavekPozdrav, odgDejstvo]);

    const zapis = await preberiKlic(sid, dir);
    assert.deepEqual(zapis?.odsotnostPovedana, [stavekPozdrav, odgDejstvo]);
    const md = vsebinaZapiska(zapis!);
    assert.ok(md.includes(`${t("zapisekOdsotnost")}: ${stavekPozdrav} ${odgDejstvo}`), md);
  });

  it("(f) odsotnost brez konca: kje je dobi razlog, kdaj bo na voljo ne ugiba (Tega ne vem)", async () => {
    const { dir, token } = await novaMapa();
    const { zdaj } = prihodnjiDanLjubljana();
    const ZDAJ = zdaj.toISOString();
    await savePravila(
      {
        prevzem: "vsi",
        nacinKlica: "osebna",
        imeLastnika: "Ana",
        odsotnostVklop: true,
        odsotnostRazlog: "v službi",
        odsotnostDo: "",
        odsotnostCasovniPas: "Europe/Ljubljana",
      },
      token,
      dir,
    );
    const sid = "CA-ODS-BREZ-KONCA";
    await recordCaller({ callSid: sid, from: STEVILKA, text: "", now: ZDAJ }, dir, undefined, { razumevanje: BREZ_MODELA });
    await recordCaller({ callSid: sid, from: STEVILKA, text: "Povejte Ani da pridem v ponedeljek ob devetih", now: ZDAJ }, dir, undefined, { razumevanje: BREZ_MODELA });
    const kje = await recordCaller({ callSid: sid, from: STEVILKA, text: "Kje je Ana?", now: ZDAJ }, dir, undefined, { razumevanje: BREZ_MODELA });
    // Pravilo C (lastnik 15. 11. 2026, osebna-slovo.ts): odgovor po zapisanem sporocilu dobi slovo.
    assert.equal(kje.reply, "Je v službi. Hvala za klic, nasvidenje.");
    const kdaj = await recordCaller({ callSid: sid, from: STEVILKA, text: "Kdaj bo Ana na voljo?", now: ZDAJ }, dir, undefined, { razumevanje: BREZ_MODELA });
    assert.equal(kdaj.reply, `${t("osebnaNevemKratko")} Hvala, nasvidenje.`, "pravilo C, druga varianta slovesa (lastnik 14. in 15. 11. 2026)");
  });

  it("(f) v istem izreku kot sporocilo: sporocilo ostane zapisano in Lina odgovori z dejstvom odsotnosti", async () => {
    const { dir, token } = await novaMapa();
    const { zdaj, konec } = prihodnjiDanLjubljana();
    const ZDAJ = zdaj.toISOString();
    await savePravila(
      {
        prevzem: "vsi",
        nacinKlica: "osebna",
        imeLastnika: "Ana",
        odsotnostVklop: true,
        odsotnostRazlog: "v službi",
        odsotnostDo: konec,
        odsotnostCasovniPas: "Europe/Ljubljana",
      },
      token,
      dir,
    );
    const sid = "CA-ODS-ISTI-IZREK";
    await recordCaller({ callSid: sid, from: STEVILKA, text: "", now: ZDAJ }, dir, undefined, { razumevanje: BREZ_MODELA });
    const r = await recordCaller(
      { callSid: sid, from: STEVILKA, text: "Povejte Ani da pridem v ponedeljek, kje je Ana?", now: ZDAJ },
      dir,
      undefined,
      { razumevanje: BREZ_MODELA },
    );
    assert.match(r.call.order.tajnica?.sporocilo ?? "", /pridem v ponedeljek/i, "sporocilo mora ostati zapisano");
    assert.ok(r.reply.includes("Je do petnajste ure v službi."), r.reply);
    assert.doesNotMatch(r.reply, /pokli[cč]|nazaj|vrne|javi/i);
    assert.ok(r.call.odsotnostPovedana?.includes("Je do petnajste ure v službi."));
  });

  it("(f) varenOdgovorOsebna in model pot: samo tocno dejstvo odsotnosti, nikoli obljube ali izmisljotine", async () => {
    const osnova = { imeLastnika: "Ana", stevilkaBesedno: "", izrek: "", zapisano: true };
    assert.equal(varenOdgovorOsebna("Je do petnajste ure v službi.", osnova), null, "brez dejstva v DejstvaOsebna zavrnjeno");
    const zOdsotnostjo = { ...osnova, odsotnost: "Je do petnajste ure v službi." };
    assert.equal(varenOdgovorOsebna("Je do petnajste ure v službi.", zOdsotnostjo), "Je do petnajste ure v službi.");
    assert.equal(varenOdgovorOsebna("Je do petnajste ure v službi in vas bo poklicala nazaj.", zOdsotnostjo), null);
    assert.equal(varenOdgovorOsebna("Je do šestnajste ure v službi.", zOdsotnostjo), null);

    const { dir, token } = await novaMapa();
    const { zdaj, konec } = prihodnjiDanLjubljana();
    const ZDAJ = zdaj.toISOString();
    await savePravila(
      {
        prevzem: "vsi",
        nacinKlica: "osebna",
        imeLastnika: "Ana",
        odsotnostVklop: true,
        odsotnostRazlog: "v službi",
        odsotnostDo: konec,
        odsotnostCasovniPas: "Europe/Ljubljana",
      },
      token,
      dir,
    );
    let prejetiVhod = "";
    const model: ModelRazumevanja = async (_s, vhod) => {
      prejetiVhod = vhod;
      return JSON.stringify({
        namen: "vprasanje",
        sporocilo: "",
        ime: "",
        vprasanje: "ali je Ana v pisarni",
        odgovor: "Je do petnajste ure v službi.",
        confident: true,
      });
    };
    const sid = "CA-ODS-MODEL";
    await recordCaller({ callSid: sid, from: STEVILKA, text: "", now: ZDAJ }, dir, undefined, { razumevanje: model });
    await recordCaller({ callSid: sid, from: STEVILKA, text: "Povejte Ani da pridem v ponedeljek ob devetih", now: ZDAJ }, dir, undefined, { razumevanje: BREZ_MODELA });
    const r = await recordCaller({ callSid: sid, from: STEVILKA, text: "Ali mi lahko poveste, ali je Ana v pisarni?", now: ZDAJ }, dir, undefined, { razumevanje: model });
    assert.ok(prejetiVhod.includes("Je do petnajste ure v službi."), prejetiVhod);
    assert.equal(r.reply, "Je do petnajste ure v službi. Hvala za klic, nasvidenje.");
    assert.ok(r.call.odsotnostPovedana?.includes("Je do petnajste ure v službi."));
  });

  it("(g) brez aktivne odsotnosti vprasanje kje je da obstojec odgovor (Tega ne vem)", async () => {
    const { dir, token } = await novaMapa();
    const { zdaj } = prihodnjiDanLjubljana();
    const ZDAJ = zdaj.toISOString();
    await savePravila({ prevzem: "vsi", nacinKlica: "osebna", imeLastnika: "Ana", odsotnostVklop: false }, token, dir);
    const sid = "CA-ODS-BREZ";
    await recordCaller({ callSid: sid, from: STEVILKA, text: "", now: ZDAJ }, dir, undefined, { razumevanje: BREZ_MODELA });
    await recordCaller({ callSid: sid, from: STEVILKA, text: "Povejte Ani da pridem v ponedeljek ob devetih", now: ZDAJ }, dir, undefined, { razumevanje: BREZ_MODELA });
    const r = await recordCaller({ callSid: sid, from: STEVILKA, text: "Kje je Ana?", now: ZDAJ }, dir, undefined, { razumevanje: BREZ_MODELA });
    assert.equal(r.reply, `${t("osebnaNevemKratko")} Hvala za klic, nasvidenje.`, "pravilo C: slovo po zapisu");
    assert.equal(r.call.odsotnostPovedana, undefined);
  });
});
