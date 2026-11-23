/**
 * Naloga E. Preizkusi padejo, ce varovalka, zapis ali delez manjka.
 * Ista koda na Linuxu in Windows: lokalna polja datuma, brez vejitev po sistemu.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { LinaAuthError, setupOwner } from "./auth.server.ts";
import { t } from "./besedila.ts";
import { formaCatalog } from "./catalog.ts";
import { imaZnesek, varenOdgovor, vprasaPoCeni } from "./guards.ts";
import { delezKratkih, jeKratekKlic, sestaviPozdrav } from "./povzetek.ts";
import { dodajVrzel, listVrzeli, loadPravila, preizkusniOdgovor, savePravila } from "./pravila.server.ts";
import { listCalls, phoneTurn, publishLine, recordCaller } from "./service.server.ts";
import { handleVoiceRequest } from "./voice.server.ts";
import { odlocitevLinije, razberiDelovnik, znotrajDelovnika } from "./ure.ts";

process.env.LINA_LLM = "0";

const temps: string[] = [];
const URE = "pon-pet 8.00-16.00";
const URE_CRTA = "pon\u2013pet 8.00\u201316.00";

async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-e-"));
  temps.push(dir);
  return dir;
}

async function lastnik(dir: string): Promise<string> {
  const token = await setupOwner("geslo-test-1234", dir);
  // Pregled G2/G3 (V1, service.server.ts publishLine): linija se odpre sele s pripravljenim glasom ali z izrecnim
  // odprtjem brez glasu. Ti preizkusi glasu nimajo, zato linijo odpremo izrecno (kot lastnik() v naloga-g2.test.ts).
  await publishLine({ open: true, brezGlasu: true, catalog: formaCatalog() }, { token }, dir);
  return token;
}

function ob(dan: number, ura: number, minuta: number, sekunda = 0): Date {
  const datum = new Date(2026, 0, 1, ura, minuta, sekunda, 0);
  while (datum.getDay() !== dan) datum.setDate(datum.getDate() + 1);
  datum.setHours(ura, minuta, sekunda, 0);
  return datum;
}

afterEach(async () => {
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.LINA_DATA;
  while (temps.length) {
    const dir = temps.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("naloga E", { concurrency: 1 }, () => {
  it("1 cene: vec oblik vprasanja in modelov znesek, v odgovoru ga ni", async () => {
    assert.equal(imaZnesek("2 kosa, 180 x 90 cm"), false);
    assert.equal(vprasaPoCeni("2 kosa, 180 x 90 cm"), false);
    assert.equal(imaZnesek("EUR 890"), true);
    assert.equal(imaZnesek("$99"), true);
    assert.equal(imaZnesek("stane 50"), true);

    const vprasanja = [
      "Koliko stane miza?",
      "Kaksna je cena Albe?",
      "Kak\u0161na je cena?",
      "Koliko evrov je to?",
      "What is the price?",
      "Imate cenik?",
      "Koliko bi stala?",
      "\u20ac",
    ];
    const modeli = [
      "Stane 890 EUR.",
      "Cena je 1.250 evrov.",
      "To stane 400 euro.",
      "Only $99 today.",
      "stane 50.",
      "EUR 890 je znesek.",
      "Cena: 75 EUR",
      "stanejo 20 evrov.",
    ];
    for (let i = 0; i < vprasanja.length; i += 1) {
      const out = varenOdgovor(vprasanja[i], modeli[i], t("povprasevanje"));
      assert.equal(vprasaPoCeni(vprasanja[i]), true, vprasanja[i]);
      assert.equal(imaZnesek(out), false, out);
      assert.doesNotMatch(out, /\d/);
      assert.match(out, /povpra[sš]evanj/);
    }

    const izKataloga = varenOdgovor("Koliko stane dostava?", "Dostava stane 20 EUR.", "Ponudba je 50 EUR, potem se oglasimo.");
    assert.equal(imaZnesek(izKataloga), false);
    assert.doesNotMatch(izKataloga, /20|50/);

    const dir = await scratch();
    const token = await lastnik(dir);
    // plast.ts (plast 2, CENA_KORENI): ob shranjevanju je denarni signal ze beseda z denarnim korenom (»znesek«, »cena«,
    // »placilo« ...), tudi v nedolznem stavku (cene: lastnik 9.-12. 11. 2026). Prvotno besedilo zato zavrne; preizkus
    // uporabi sporocilo brez takih besed in zavrnitev preveri posebej.
    await assert.rejects(() => savePravila({ povprasevanje: "Sodelavec pripravi ponudbo brez objave zneska." }, token, dir), /znesk/i);
    const sporocilo = "Sodelavec pripravi ponudbo in vas pokliče.";
    await savePravila({ povprasevanje: sporocilo }, token, dir);
    const callSid = "cene-1";
    await recordCaller({ callSid, from: "+38640000000", text: "" }, dir);
    let kliciModela = 0;
    for (let i = 0; i < vprasanja.length; i += 1) {
      const turn = await recordCaller({ callSid, text: vprasanja[i] }, dir, async () => {
        kliciModela += 1;
        return modeli[i];
      });
      assert.equal(turn.reply, sporocilo, vprasanja[i]);
      assert.equal(imaZnesek(turn.reply), false);
      assert.doesNotMatch(turn.reply, /\d/);
    }
    // G4a (lastnik 10. 11. 2026; service.server.ts »brezModela«: cena -> stalni stavek): na vprasanje po ceni Lina modela
    // sploh ne poklice, zato znesek modela ne more priti v odgovor.
    assert.equal(kliciModela, 0);

    const poTelefonu = await phoneTurn(
      { callSid: "cene-tel", from: "+38640000009", text: "Koliko stane miza Alba?" },
      { token },
      dir,
    );
    assert.equal(imaZnesek(poTelefonu.reply), false);
    assert.match(poTelefonu.reply, /Sodelavec pripravi ponudbo/);
    // Edina stevka v odgovoru je rok hrambe posnetka iz pozdrava (privzeto snemanje, lastnik 22. 11. 2026, pravila.server.ts).
    assert.doesNotMatch(poTelefonu.reply.replace(/posnetek hranimo največ \d+ dni/, ""), /\d/);
  });

  it("2 sporocilo, zapis povprasevanja in brez tujega roka", async () => {
    const lastniskiRok = varenOdgovor("Koliko stane?", "Rok je jutri. Stane 10 EUR.", "Ponudbo posljemo v 5 dneh.");
    assert.equal(lastniskiRok, "Ponudbo posljemo v 5 dneh.");
    assert.doesNotMatch(lastniskiRok, /jutri/);
    assert.equal(imaZnesek(lastniskiRok), false);

    const tujRok = varenOdgovor("Je miza na voljo?", "Miza je na voljo. Rok je 5 dni.", "Ponudbo posljemo v 5 dneh.");
    assert.match(tujRok, /Miza je na voljo/);
    assert.doesNotMatch(tujRok, /Rok je 5 dni/);

    const dir = await scratch();
    const token = await lastnik(dir);
    assert.equal((await loadPravila(dir)).povprasevanje, t("povprasevanje"));
    await savePravila({ povprasevanje: "   " }, token, dir);
    assert.equal((await loadPravila(dir)).povprasevanje, t("povprasevanje"));

    const turn = await phoneTurn(
      {
        callSid: "zapis-1",
        from: "+38640111000",
        text: "Ana Horvat pri telefonu, 041 555 123. Mizo Alba iz hrasta, 2 kosa, 180 x 90 cm, rok do petka.",
      },
      { token },
      dir,
    );
    const order = turn.call.order;
    assert.equal(order.customerName, "Ana Horvat");
    assert.match(order.phone, /041/);
    assert.equal(order.productName, "Alba");
    assert.equal(order.materialName, "Hrast");
    assert.equal(order.quantity, 2);
    assert.match(order.notes, /180/);
    assert.match(order.deadline ?? "", /petk/);
    // G4g (lastnik 11. 11. 2026, AGENTS.md »Potek konca klica (G4g)«): ko so podatki zbrani, Lina ponovi narocilo z rokom
    // KLICATELJA (»rok pa je do petka«) in vprasa za potrditev. Tuj rok (od modela) je preverjen spodaj (zModelom).
    assert.match(turn.reply, /rok pa je do petka\. .*Ali potrjujete naročilo\?$/);
    assert.equal(imaZnesek(turn.reply), false);

    const zModelom = await recordCaller(
      { callSid: "zapis-1", text: "Je Alba iz hrasta na voljo?" },
      dir,
      async () => "Seveda. Rok je petek.",
    );
    assert.match(zModelom.reply, /Seveda/);
    assert.doesNotMatch(zModelom.reply, /petek/i);
    assert.doesNotMatch(zModelom.reply, /\brok\b/i);
  });

  it("3 prevzem: robovi dneva in tedna ter klic na liniji", async () => {
    const pon8 = ob(1, 8, 0);
    const pon759 = ob(1, 7, 59);
    const pon0 = ob(1, 0, 0);
    const pet1559 = ob(5, 15, 59, 59);
    const pet16 = ob(5, 16, 0, 1);
    const sob0 = ob(6, 0, 0);
    const ned2359 = ob(0, 23, 59);
    assert.equal(pon8.getDay(), 1);
    assert.equal(znotrajDelovnika(pon8, URE), true);
    assert.equal(znotrajDelovnika(pon759, URE), false);
    assert.equal(znotrajDelovnika(pon0, URE), false);
    assert.equal(znotrajDelovnika(pet1559, URE), true);
    assert.equal(znotrajDelovnika(pet16, URE), false);
    assert.equal(znotrajDelovnika(sob0, URE), false);
    assert.equal(znotrajDelovnika(ned2359, URE), false);
    assert.equal(znotrajDelovnika(ob(1, 10, 0), URE_CRTA), true);
    assert.equal(razberiDelovnik("pon-pet 22.00-06.00"), null);

    assert.equal(znotrajDelovnika(ob(6, 10, 0), "sob-pon 10.00-12.00"), true);
    assert.equal(znotrajDelovnika(ob(6, 9, 59), "sob-pon 10.00-12.00"), false);
    assert.equal(znotrajDelovnika(ob(0, 11, 0), "sob-pon 10.00-12.00"), true);
    assert.equal(znotrajDelovnika(ob(1, 11, 59), "sob-pon 10.00-12.00"), true);
    assert.equal(znotrajDelovnika(ob(1, 12, 0), "sob-pon 10.00-12.00"), false);
    assert.equal(znotrajDelovnika(ob(2, 11, 0), "sob-pon 10.00-12.00"), false);
    assert.equal(znotrajDelovnika(ob(5, 11, 0), "sob-pon 10.00-12.00"), false);

    const osnova = { cakanjeSekund: 20, hours: URE_CRTA };
    assert.equal(
      odlocitevLinije({ ...osnova, nacin: "vsi", zvonjenjeSekund: 0, now: ob(1, 10, 0) }),
      "lina",
    );
    assert.equal(
      odlocitevLinije({ ...osnova, nacin: "neodgovorjeni", zvonjenjeSekund: 19, now: ob(1, 10, 0) }),
      "cakaj",
    );
    assert.equal(
      odlocitevLinije({ ...osnova, nacin: "neodgovorjeni", zvonjenjeSekund: 20, now: ob(1, 10, 0) }),
      "lina",
    );
    assert.equal(
      odlocitevLinije({
        ...osnova,
        nacin: "neodgovorjeni",
        zvonjenjeSekund: 0,
        now: ob(1, 10, 0),
        dialStatus: "no-answer",
      }),
      "lina",
    );
    assert.equal(
      odlocitevLinije({
        ...osnova,
        nacin: "vsi",
        zvonjenjeSekund: 0,
        now: ob(6, 12, 0),
        dialStatus: "completed",
      }),
      "prekini",
    );
    assert.equal(odlocitevLinije({ ...osnova, nacin: "izven", zvonjenjeSekund: 0, now: ob(1, 10, 0) }), "cakaj");
    assert.equal(odlocitevLinije({ ...osnova, nacin: "izven", zvonjenjeSekund: 0, now: ob(1, 8, 0) }), "cakaj");
    assert.equal(odlocitevLinije({ ...osnova, nacin: "izven", zvonjenjeSekund: 0, now: ob(1, 7, 59) }), "lina");
    assert.equal(odlocitevLinije({ ...osnova, nacin: "izven", zvonjenjeSekund: 0, now: pet1559 }), "cakaj");
    assert.equal(odlocitevLinije({ ...osnova, nacin: "izven", zvonjenjeSekund: 0, now: pet16 }), "lina");
    assert.equal(odlocitevLinije({ ...osnova, nacin: "izven", zvonjenjeSekund: 0, now: ob(6, 12, 0) }), "lina");
    assert.equal(odlocitevLinije({ ...osnova, nacin: "izven", zvonjenjeSekund: 0, now: ned2359 }), "lina");
    assert.equal(odlocitevLinije({ ...osnova, nacin: "izven", zvonjenjeSekund: 0, now: pon0 }), "lina");

    const dir = await scratch();
    const token = await lastnik(dir);
    await savePravila({ preusmeritev: "+38641999000" }, token, dir);
    const prvi = await voice(dir, { CallSid: "CA-E-CAKAJ", From: "+38640000021" });
    const telo = await prvi.text();
    assert.equal(prvi.status, 200);
    assert.match(telo, /<Dial\b/);
    // Cakanje pred prevzemom je privzeto 28 s (lastnik 11. 11. 2026, AGENTS.md »Socasnih klicev ne sprejemamo in cakanje«).
    assert.match(telo, /timeout="28"/);
    assert.doesNotMatch(telo, /<Say/);

    await savePravila({ cakanjeSekund: 35, prevzem: "neodgovorjeni" }, token, dir);
    const drugi = await voice(dir, { CallSid: "CA-E-35", From: "+38640000022" });
    assert.match(await drugi.text(), /timeout="35"/);

    const poCakanju = await voice(dir, {
      CallSid: "CA-E-NOANSWER",
      From: "+38640000023",
      DialCallStatus: "no-answer",
    });
    // Razkritje UI v govoru (lastnik 14. 11. 2026, AGENTS.md »Razkritje UI je TRDO pravilo«).
    assert.match(await poCakanju.text(), /pomočnica z umetno inteligenco/);

    // En klic naenkrat (lastnik 11. 11. 2026, AGENTS.md »Socasnih klicev ne sprejemamo«): nezakljucen klic bi naslednjemu
    // dal »Linija je trenutno zasedena«, zato se prejsnji klic zakljuci s statusom, kot ga poslje Twilio.
    await voice(dir, { CallSid: "CA-E-NOANSWER", CallStatus: "completed" }, undefined, "/api/voice/status");
    await savePravila({ prevzem: "izven" }, token, dir);
    const medDelom = await voice(dir, { CallSid: "CA-E-DEL", From: "+38640000024" }, ob(1, 10, 0));
    const medBesedilom = await medDelom.text();
    assert.match(medBesedilom, /<Dial\b/);
    assert.doesNotMatch(medBesedilom, /<Say/);
    const knjiga = JSON.parse(await readFile(path.join(dir, "calls.json"), "utf8")) as Record<string, unknown>;
    assert.equal(knjiga["CA-E-DEL"], undefined);

    const poTihem = await voice(
      dir,
      { CallSid: "CA-E-DEL", From: "+38640000024", DialCallStatus: "no-answer" },
      ob(1, 10, 0),
    );
    assert.match(await poTihem.text(), /pomočnica z umetno inteligenco/);

    await voice(dir, { CallSid: "CA-E-DEL", CallStatus: "completed" }, undefined, "/api/voice/status");
    const sobota = await voice(dir, { CallSid: "CA-E-SOB", From: "+38640000025" }, ob(6, 11, 0));
    assert.match(await sobota.text(), /pomočnica z umetno inteligenco/);
  });

  it("4 pozdrav se ne da zbrisati, kratki klici in delez", async () => {
    const start = "2026-11-09T08:00:00.000Z";
    assert.equal(jeKratekKlic(start, "2026-11-09T08:00:10.000Z"), true);
    assert.equal(jeKratekKlic(start, "2026-11-09T08:00:10.001Z"), false);
    assert.equal(sestaviPozdrav("").includes(t("obvezniPozdrav")), true);
    assert.equal(sestaviPozdrav(t("obvezniPozdrav")).split(t("obvezniPozdrav")).length - 1, 1);

    const dir = await scratch();
    const token = await lastnik(dir);
    await savePravila({ pozdrav: t("obvezniPozdrav") }, token, dir);
    assert.equal((await loadPravila(dir)).pozdrav.includes("AI asistentka"), false);
    // Razkritje UI je prvi stavek in samo enkrat (lastnik 10. in 14. 11. 2026, AGENTS.md »Po drugem pravem klicu« in
    // »Razkritje UI je TRDO pravilo«): v govoru klica je to »pomočnica z umetno inteligenco«, stavka »Sem AI asistentka ...« ni vec.
    const razkritja = (besedilo: string): number => (besedilo.match(/umetno inteligenco/g) ?? []).length;
    const prazen = await phoneTurn({ callSid: "poz-1", from: "+38640000031", text: "" }, { token }, dir);
    assert.equal(razkritja(prazen.reply), 1, prazen.reply);
    assert.match(prazen.reply.split(/(?<=[.!?])\s/)[0], /pomočnica z umetno inteligenco/);

    // Lina se predstavi in pozdravi ENKRAT (lastnik 10. 11. 2026, AGENTS.md »Po drugem pravem klicu«): pozdravno besedo
    // v lastnikovem pozdravu (»Dober dan iz delavnice.«) povzetek.ts brezPonovljenegaPozdrava odreze. Lastnikovo besedilo
    // brez pozdrava ostane cel.
    await savePravila({ pozdrav: "Smo mizarska delavnica." }, token, dir);
    const dodan = await phoneTurn({ callSid: "poz-2", from: "+38640000032", text: "" }, { token }, dir);
    assert.match(dodan.reply, /Smo mizarska delavnica\./);
    assert.match(dodan.reply.split(/(?<=[.!?])\s/)[0], /pomočnica z umetno inteligenco/);
    assert.equal(razkritja(dodan.reply), 1, dodan.reply);
    // Privzeto snemanje (lastnik 22. 11. 2026, pravila.server.ts): »Pogovor snemam in zapisujem ...«.
    assert.match(dodan.reply, /zapisujem/);

    const kratek = await phoneTurn({ callSid: "kratek-1", from: "+38640000033", text: "" }, { token }, dir);
    assert.match(kratek.reply, /pomočnica z umetno inteligenco/);
    const konecKratkega = await phoneTurn({ callSid: "kratek-1", hangup: true }, { token }, dir);
    assert.equal(konecKratkega.call.kratek, true);

    await phoneTurn({ callSid: "dolg-1", from: "+38640000034", text: "" }, { token }, dir);
    const datoteka = path.join(dir, "calls.json");
    const knjiga = JSON.parse(await readFile(datoteka, "utf8")) as Record<string, { startedAt: string; updatedAt: string }>;
    knjiga["dolg-1"].startedAt = new Date(Date.now() - 30_000).toISOString();
    await writeFile(datoteka, JSON.stringify(knjiga));
    const konecDolgi = await phoneTurn({ callSid: "dolg-1", hangup: true }, { token }, dir);
    assert.equal(konecDolgi.call.kratek, false);

    const poKoncu = JSON.parse(await readFile(datoteka, "utf8")) as Record<string, { updatedAt: string; kratek?: boolean }>;
    poKoncu["kratek-1"].updatedAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    await writeFile(datoteka, JSON.stringify(poKoncu));
    const delez = delezKratkih(await listCalls({ token }, dir));
    assert.equal(delez.kratki, 1);
    assert.equal(delez.koncani, 2);
    assert.equal(delez.delez, 0.5);
  });

  it("5 preizkusni klic ne gre med klice ali statistiko", async () => {
    const dir = await scratch();
    await assert.rejects(() => preizkusniOdgovor("Koliko stane?", null, dir), LinaAuthError);
    const token = await lastnik(dir);
    await publishLine({ open: false, catalog: formaCatalog() }, { token }, dir);
    await phoneTurn({ callSid: "pravi-1", from: "+38640000041", text: "" }, { token }, dir);
    await phoneTurn({ callSid: "pravi-1", hangup: true }, { token }, dir);
    const prej = delezKratkih(await listCalls({ token }, dir));
    const pred = (await readdir(dir)).filter((ime) => ime === "calls.json" || ime === "vrzeli.json").sort();

    const cena = await preizkusniOdgovor("Koliko stane miza Alba?", token, dir);
    const vrzel = await preizkusniOdgovor("Ali dostavljate na Ptuj?", token, dir);
    assert.equal(imaZnesek(cena.reply), false);
    assert.match(cena.reply, /povpra[sš]evanj/);
    assert.match(cena.reply, /AI asistentka/);
    assert.doesNotMatch(vrzel.reply, /Ptuj vsak/);

    const potem = (await readdir(dir)).filter((ime) => ime === "calls.json" || ime === "vrzeli.json").sort();
    assert.deepEqual(potem, pred);
    assert.equal((await readdir(dir)).includes("vrzeli.json"), false);
    const klici = await listCalls({ token }, dir);
    assert.equal(klici.length, 1);
    assert.equal(klici.some((klic) => klic.callSid === "preizkus"), false);
    assert.deepEqual(delezKratkih(klici), prej);
    await assert.rejects(() => recordCaller({ callSid: "preizkus", text: "Koliko stane?" }, dir));
  });

  it("6 povzetek je besedilo brez cene in brez zvoka", async () => {
    const dir = await scratch();
    const token = await lastnik(dir);
    await recordCaller(
      {
        callSid: "pov-1",
        from: "+38640111222",
        text: "Ana Horvat pri telefonu. Mizo Alba iz hrasta, 2 kosa, 180 x 90 cm, rok do petka.",
      },
      dir,
      async () => "Potrjujem. Stane 890 EUR. Rok je jutri.",
    );
    const konec = await phoneTurn({ callSid: "pov-1", hangup: true }, { token }, dir);
    const povzetek = konec.call.povzetek;
    assert.ok(povzetek);
    assert.match(povzetek.kdo, /Ana Horvat/);
    assert.match(povzetek.zelel, /Alba/);
    assert.match(povzetek.zelel, /2 kos/);
    assert.match(povzetek.zelel, /180/);
    assert.match(povzetek.zelel, /petk/);
    assert.equal(imaZnesek(povzetek.obljubila), false);
    assert.doesNotMatch(povzetek.obljubila, /890|EUR|€|evro|jutri|petk/i);
    assert.equal(imaZnesek(povzetek.narediti), false);
    assert.match(povzetek.narediti, /povpra[sš]evanj/);
    assert.equal(konec.reply.includes("890"), false);

    const disk = await readFile(path.join(dir, "calls.json"), "utf8");
    assert.equal(disk.includes("890"), false);
    assert.equal(/audioBase64|audio\/mpeg|\.mp3|\.wav/i.test(disk), false);
    const imena = await readdir(dir);
    assert.equal(imena.some((ime) => /\.(mp3|wav|ogg|m4a)$/i.test(ime)), false);
  });

  it("7 vrzel v znanju, en klik v katalog, cena iz kataloga se ne izgovori", async () => {
    const dir = await scratch();
    const token = await lastnik(dir);
    const vprasanje = "Ali dostavljate na Ptuj?";
    await phoneTurn({ callSid: "v1", from: "+38640000051", text: vprasanje }, { token }, dir);
    await phoneTurn({ callSid: "v1b", from: "+38640000052", text: vprasanje }, { token }, dir);
    await phoneTurn({ callSid: "cena", from: "+38640000053", text: "Koliko stane Alba?" }, { token }, dir);
    const odprte = (await listVrzeli(token, dir)).filter((vrzel) => !vrzel.dodano);
    assert.equal(odprte.length, 1);
    assert.equal(odprte[0].vprasanje, vprasanje);

    const izum = await recordCaller(
      { callSid: "v-izum", from: "+38640000054", text: "Ali imate garancijo na izdelke?" },
      dir,
      async () => "Garancija je dvanajst let.",
    );
    assert.doesNotMatch(izum.reply, /dvanajst/);
    assert.equal((await listVrzeli(token, dir)).filter((vrzel) => !vrzel.dodano).length, 2);

    await assert.rejects(() => dodajVrzel(odprte[0].id, "Dostava stane 20 EUR.", token, dir), /znesk|cen/i);
    assert.equal((await listVrzeli(token, dir)).find((vrzel) => vrzel.id === odprte[0].id)?.dodano, false);
    const vrstica = JSON.parse(await readFile(path.join(dir, "line.json"), "utf8")) as {
      catalog: { zapiski?: Array<{ id: string; vprasanje: string; odgovor: string }> };
    };
    vrstica.catalog.zapiski = [{ id: "stari-znesek", vprasanje, odgovor: "Dostava stane 20 EUR." }];
    await writeFile(path.join(dir, "line.json"), JSON.stringify(vrstica));

    const spet = await phoneTurn({ callSid: "v2", from: "+38640000055", text: vprasanje }, { token }, dir);
    assert.equal(imaZnesek(spet.reply), false);
    assert.doesNotMatch(spet.reply, /20/);
    assert.match(spet.reply, /povpra[sš]evanj/);
    assert.equal((await listVrzeli(token, dir)).some((vrzel) => vrzel.id === odprte[0].id && vrzel.dodano), false);

    const cist = await scratch();
    const token2 = await lastnik(cist);
    await phoneTurn({ callSid: "cist-v", from: "+38640000056", text: vprasanje }, { token: token2 }, cist);
    const vrzelDostave = (await listVrzeli(token2, cist))[0];
    // Garancija in dostava (lastnik 10. 11. 2026, AGENTS.md »Garancija in dostava«): zapisek o dostavi brez vklopa se
    // zavrne ob shranjevanju; Lina dostave ne obljublja sama. En klik v katalog zato preverimo z vprasanjem o drugi temi.
    await assert.rejects(() => dodajVrzel(vrzelDostave.id, "Dostavljamo po dogovoru po Sloveniji.", token2, cist), /dostav/i);
    const parkiranje = "Ali imate parkiranje za stranke?";
    await phoneTurn({ callSid: "cist-p", from: "+38640000059", text: parkiranje }, { token: token2 }, cist);
    const vrzelParkiranja = (await listVrzeli(token2, cist)).find((vrzel) => vrzel.vprasanje === parkiranje);
    assert.ok(vrzelParkiranja);
    await dodajVrzel(vrzelParkiranja.id, "Parkiranje je za hišo.", token2, cist);
    const odgovor = await phoneTurn({ callSid: "cist-2", from: "+38640000057", text: parkiranje }, { token: token2 }, cist);
    assert.match(odgovor.reply, /Parkiranje je za hišo/);
    // Odprta ostane samo vrzel o dostavi (zapisek je bil zavrnjen).
    assert.deepEqual((await listVrzeli(token2, cist)).filter((vrzel) => !vrzel.dodano).map((vrzel) => vrzel.id), [vrzelDostave.id]);

    const naslov = await phoneTurn(
      { callSid: "naslov", from: "+38640000058", text: "Kje je naslov delavnice?" },
      { token: token2 },
      cist,
    );
    assert.match(naslov.reply, /Obrtna ulica/);
    assert.equal((await listVrzeli(token2, cist)).filter((vrzel) => !vrzel.dodano).length, 1);
  });
});

async function voice(dir: string, params: Record<string, string>, now?: Date, pot = "/api/voice/incoming"): Promise<Response> {
  const secret = "twilio-zeton-preizkusa";
  process.env.TWILIO_AUTH_TOKEN = secret;
  const url = `https://lina.primer${pot}`;
  const body = new URLSearchParams(params).toString();
  const signed = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  const good = createHmac("sha1", secret).update(signed).digest("base64");
  return handleVoiceRequest(
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": good,
      },
      body,
    }),
    dir,
    now,
  );
}
