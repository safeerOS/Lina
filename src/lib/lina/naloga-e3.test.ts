/**
 * Naloga E3. Vsak preizkus pade, ce popravek manjka.
 * Komentarji so brez sumnikov. K2 tece s celim katalogom.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { t } from "./besedila.ts";
import { emptyDraft, absorbUtterance, MEJA_IZREKA } from "./brain.ts";
import { formaCatalog } from "./catalog.ts";
import {
  brezDodanegaRoka,
  brezZneska,
  dejstvaKataloga,
  imaZnesek,
  istaStevilka,
  razlogZneska,
  varenOdgovor,
  vprasaPoCeni,
} from "./guards.ts";
import { sestaviPozdrav } from "./povzetek.ts";
import { listVrzeli, savePravila } from "./pravila.server.ts";
import { phoneTurn, publishLine, recordCaller } from "./service.server.ts";
import { handleVoiceRequest } from "./voice.server.ts";
import { razberiRazpone, ureSoRazumljive, znotrajDelovnika } from "./ure.ts";
import { besediloVrzel, najdiZapisek, odgovorIzKataloga } from "./znanje.ts";

process.env.LINA_LLM = "0";

const temps: string[] = [];

async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-e3-"));
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

function ob(dan: number, ura: number, minuta: number): Date {
  const datum = new Date(2026, 0, 1, ura, minuta, 0, 0);
  while (datum.getDay() !== dan) datum.setDate(datum.getDate() + 1);
  datum.setHours(ura, minuta, 0, 0);
  return datum;
}

afterEach(async () => {
  delete process.env.TWILIO_AUTH_TOKEN;
  while (temps.length) {
    const dir = temps.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function voice(dir: string, params: Record<string, string>, pot = "/api/voice/incoming", now?: Date): Promise<Response> {
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
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": good },
      body,
    }),
    dir,
    now,
  );
}

describe("naloga E3", { concurrency: 1 }, () => {
  it("N1 K2 cene s celim katalogom, stevniki in zavrnitev ob shranjevanju", async () => {
    const dejstva = dejstvaKataloga(formaCatalog());
    const naTelefonu = [
      "Cena je osemsto devetdeset.",
      "okoli tisocaka",
      "devetsto",
      "osem devet nic",
      "pol tisocaka",
      "en jurcek",
      "devetindevetdeset",
      "milijon",
      "Miza vas pride devetsto.",
      "eight hundred ninety",
      "Cena je \uFF18\uFF19\uFF10.",
      "brezplacno",
      "zastonj",
      "gratis",
      "Alba je 555.",
      "Alba je 16.",
    ];
    // Cetrti argument varenOdgovor je od 12. 11. 2026 OSNUTEK (AGENTS.md »Glavni uporabniki so podjetja«: model kataloga ne vidi,
    // samo uredi osnutek; govor.ts sestaviOdgovor, plast.ts ostaniPriOsnutku). Stavek, ki doda znesek ali stevilo, ki ga v
    // osnutku ni, odpade; ce ne ostane nic, Lina pove osnutek. Prej je bil tu cel katalog (dejstva), kar v kodi ni vec vloga.
    const OSNUTEK = "Alba je jedilna miza po meri iz masivnega lesa.";
    for (const primer of naTelefonu) {
      const out = varenOdgovor("povej o Albi", primer, t("povprasevanje"), OSNUTEK);
      assert.equal(imaZnesek(out), false, primer);
      assert.doesNotMatch(out, /osemsto|devetsto|tisocak|jurcek|milijon|brezplacno|zastonj|gratis|555|890|\b16\b/i, primer);
      assert.equal(out, OSNUTEK, primer);
    }
    // Osnutek s stevilkami (v klicu je to jedro.facts, npr. odgovor na vprasanje po telefonu ali urah): stevke iz telefona ali ure
    // model ne sme uporabiti kot gole stevilke za izdelkom (»Alba je 555.« zveni kot cena). Prej je to ujela varovalka z dejstvi.
    const SSTEVILKAMI = "Telefon je +386 1 555 09 00. Odprto je od 8.00 do 16.00.";
    for (const primer of ["Alba je 555.", "Alba je 16.", "Miza vas pride 555."]) {
      const out = varenOdgovor("povej o Albi", primer, t("povprasevanje"), SSTEVILKAMI);
      assert.equal(out, SSTEVILKAMI, primer);
    }
    // Dejstva iz osnutka v svojem kontekstu ostanejo.
    assert.equal(varenOdgovor("Kdaj ste odprti?", "Odprto je od 8.00 do 16.00.", t("povprasevanje"), SSTEVILKAMI), "Odprto je od 8.00 do 16.00.");
    assert.equal(varenOdgovor("Telefon?", "Telefon je +386 1 555 09 00.", t("povprasevanje"), SSTEVILKAMI), "Telefon je +386 1 555 09 00.");

    const naslov = varenOdgovor("Kje ste?", "Naslov je Obrtna ulica 9. Odprto 8.00-16.00.", t("povprasevanje"), dejstva);
    assert.match(naslov, /ulica 9/);
    assert.match(naslov, /8\.00-16\.00/);
    const telefon = varenOdgovor("Kakšna je telefonska številka?", "Telefon je +386 1 555 09 00.", t("povprasevanje"), dejstva);
    assert.match(telefon, /555 09 00/);

    const obShranjevanju = [
      "To vas pride 890.",
      "9,99",
      "890 e",
      "100 evrckov",
      "20 centov",
      "costs 900",
      "8 9 0",
      "1e3",
      "890 eurov",
      "Alba: 890",
      "890 neto",
      "polog 30 %",
      "avans 200",
      "Racun bo 890.",
      "polog je 200",
      "3 evre na minuto",
      "brezplacno",
      "zastonj",
      "gratis",
    ];
    const dir = await scratch();
    const token = await lastnik(dir);
    for (const besedilo of obShranjevanju) {
      assert.ok(razlogZneska(besedilo), besedilo);
      await assert.rejects(() => savePravila({ povprasevanje: besedilo }, token, dir), /znesk|cen/i);
      await assert.rejects(() => savePravila({ pozdrav: besedilo }, token, dir), /znesk|cen/i);
    }
    assert.equal(razlogZneska("2 kosa, 180 x 90 cm"), null);
    assert.equal(razlogZneska("Garancija velja 2 leti, rok za reklamacijo pa je 8 dni."), null);
    assert.equal(imaZnesek("2 kosa, 180 x 90 cm"), false);

    const katalog = formaCatalog();
    katalog.products[0].summary = "Alba: 890";
    await assert.rejects(() => publishLine({ open: true, catalog: katalog }, { token }, dir), /znesk|cen/i);

    assert.doesNotMatch(sestaviPozdrav("Cena je osemsto devetdeset.", "FORMA"), /osemsto|devetdeset/);
    assert.match(sestaviPozdrav("Cena je osemsto devetdeset.", "FORMA"), /AI asistentka/);
    await writeFile(
      path.join(dir, "pravila.json"),
      JSON.stringify({
        povprasevanje: t("povprasevanje"),
        prevzem: "vsi",
        cakanjeSekund: 20,
        pozdrav: "Miza vas pride devetsto.",
        preusmeritev: "",
      }),
    );
    const izgovor = await phoneTurn({ callSid: "poz-e3", from: "+38640000991", text: "" }, { token }, dir);
    assert.doesNotMatch(izgovor.reply, /devetsto|890/);
    // Razkritje UI v govoru (lastnik 14. 11. 2026, AGENTS.md »Razkritje UI je TRDO pravilo«).
    assert.match(izgovor.reply, /pomočnica z umetno inteligenco/);
  });

  it("N7 stevilke iz osnutka narocila ostanejo v potrditvi", async () => {
    const dir = await scratch();
    const token = await lastnik(dir);
    // Potrditev samo po izrecnem vprasanju na koncu klica (lastnik 10. 11. 2026, AGENTS.md »Potrditev narocila samo po
    // izrecnem vprasanju«; potek G4g 11. 11. 2026): »Potrjujem.« v prvem izreku ne potrdi. Stevilke narocila ostanejo v
    // povzetku pred vprasanjem za potrditev in v zapisu.
    const prvi = await phoneTurn(
      { callSid: "potrdi-3", from: "+38641111222", text: "Mizo Alba iz hrasta, 3 kose, 180 x 90 cm. Potrjujem." },
      { token },
      dir,
    );
    assert.equal(prvi.call.order.confirmed, false);
    await phoneTurn({ callSid: "potrdi-3", text: "Do petka." }, { token }, dir);
    const turn = await phoneTurn({ callSid: "potrdi-3", text: "Ana Horvat." }, { token }, dir);
    assert.match(turn.reply, /v količini 3\b/);
    assert.match(turn.reply, /Ali potrjujete naročilo\?$/);
    assert.doesNotMatch(turn.reply, /povpra[sš]evanj|ponudbo/i);
    assert.equal(turn.call.order.quantity, 3);
    assert.match(turn.call.order.notes, /180 x 90 cm/);
    const potrjeno = await phoneTurn({ callSid: "potrdi-3", text: "Da." }, { token }, dir);
    assert.equal(potrjeno.call.order.confirmed, true);
    const dejstva = `${dejstvaKataloga(formaCatalog())}\n3 kos\n180 x 90 cm\n+38641111222`;
    // Osnutek je vir resnice (12. 11. 2026, plast.ts plast 1): stevilo, ki ga v osnutku ni, odpade in ostane osnutek.
    // ZNANA MEJA te zasnove (porocilo): stevka iz osnutka (»3 kos«) sme v stavek brez enote (»Alba je 3.«); prej jo je
    // varovalka z dejstvi zavrnila. Tu je zato preverjeno stevilo, ki ga v osnutku ni.
    const gola = varenOdgovor("povej", "Alba je 7.", t("povprasevanje"), dejstva);
    assert.doesNotMatch(gola, /\b7\b/);
    assert.equal(gola, dejstva);
    const mera = varenOdgovor("povej", "Miza je 180 x 90 cm.", t("povprasevanje"), dejstva);
    assert.match(mera, /180 x 90 cm/);
  });

  it("N2 dva socasna klica ne prepiseta knjige", async () => {
    const dir = await scratch();
    await lastnik(dir);
    let noter = false;
    let sprosti: () => void = () => undefined;
    const cakaj = new Promise<void>((res) => {
      sprosti = res;
    });
    // G4a (lastnik 10. 11. 2026, AGENTS.md »Po drugem pravem klicu«): narocilo iz kataloga (»Mizo Alba iz hrasta.«) je stalni
    // stavek brez modela, zato model nikoli ne bi bil poklican in zanka spodaj bi obvisela (tek se ni koncal). Izreka sta
    // vprasanji, ki modelu gresta; cakanje na model je omejeno, da padel pogoj ne obesi celega teka.
    const prvi = recordCaller({ callSid: "CA-A", from: "+38641111001", text: "Kakšna je razlika med hrastom in jesenom?" }, dir, async () => {
      noter = true;
      await cakaj;
      return "Alba iz hrasta je na voljo.";
    });
    for (let i = 0; !noter && i < 400; i += 1) await new Promise((res) => setTimeout(res, 5));
    assert.equal(noter, true, "prvi klic ni poklical modela");
    const drugi = recordCaller({ callSid: "CA-B", from: "+38641111002", text: "Ali je oreh primeren za kuhinjo?" }, dir, async () => {
      return "Lira iz oreha je na voljo.";
    });
    sprosti();
    await Promise.all([prvi, drugi]);
    const knjiga = JSON.parse(await readFile(path.join(dir, "calls.json"), "utf8")) as Record<
      string,
      { transcript: { role: string; text: string }[] }
    >;
    assert.ok(knjiga["CA-A"]);
    assert.ok(knjiga["CA-B"]);
    const a = knjiga["CA-A"].transcript.filter((v) => v.role === "lina").map((v) => v.text).join(" ");
    const b = knjiga["CA-B"].transcript.filter((v) => v.role === "lina").map((v) => v.text).join(" ");
    assert.match(a, /Alba iz hrasta je na voljo/);
    assert.match(b, /Lira iz oreha je na voljo/);
  });

  it("N3 otrokov krak in status nista pogovor, completed ne klice recordCaller", async () => {
    const dir = await scratch();
    const token = await lastnik(dir);
    await savePravila({ prevzem: "neodgovorjeni", preusmeritev: "+38641999000" }, token, dir);
    const zvonjenje = await voice(dir, { CallSid: "CA-STAR", From: "+38640000001", To: "+38615550900" });
    assert.match(await zvonjenje.text(), /<Dial\b/);

    const otrok = await voice(
      dir,
      { CallSid: "CA-OTROK", ParentCallSid: "CA-STAR", From: "+38640000001", CallStatus: "no-answer" },
      "/api/voice/status",
    );
    const otrokTelo = await otrok.text();
    assert.doesNotMatch(otrokTelo, /<Say|<Gather|<Dial/);
    const narobe = await voice(
      dir,
      { CallSid: "CA-OTROK2", ParentCallSid: "CA-STAR", CallStatus: "failed" },
      "/api/voice/incoming",
    );
    assert.doesNotMatch(await narobe.text(), /<Say|<Gather|<Dial/);

    const konec = await voice(dir, { CallSid: "CA-STAR", CallStatus: "completed" }, "/api/voice/status");
    const konecTelo = await konec.text();
    assert.match(konecTelo, /<Hangup\/>/);
    assert.doesNotMatch(konecTelo, /<Say/);
    let knjiga: Record<string, { status?: string; transcript?: unknown[] }> = {};
    try {
      knjiga = JSON.parse(await readFile(path.join(dir, "calls.json"), "utf8")) as typeof knjiga;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    assert.equal(knjiga["CA-OTROK"], undefined);
    assert.equal(knjiga["CA-OTROK2"], undefined);
    assert.equal(knjiga["CA-STAR"], undefined);
  });

  it("N4 zadnjih 8 stevk in oblika preusmeritve", async () => {
    assert.equal(istaStevilka("01 555 09 00", "+38615550900"), true);
    assert.equal(istaStevilka("+386 1 555 09 00", "+38615550900"), true);
    assert.equal(istaStevilka("+38641777000", "+38615550900"), false);
    const dir = await scratch();
    const token = await lastnik(dir);
    await assert.rejects(() => savePravila({ preusmeritev: "041999000" }, token, dir), /oblik|\+/i);
    await assert.rejects(() => savePravila({ preusmeritev: "+386 1 555 09 00" }, token, dir), /zanka/i);
    const shranjeno = await savePravila({ preusmeritev: "+38641999000" }, token, dir);
    assert.equal(shranjeno.preusmeritev, "+38641999000");
  });

  it("N5 prazna preusmeritev opozori in klicatelj ne slisi navodil", async () => {
    const dir = await scratch();
    const token = await lastnik(dir);
    const izven = await savePravila({ prevzem: "izven", preusmeritev: "" }, token, dir);
    assert.ok(izven.opozorila.some((vrstica) => /preusmerit|prazn/i.test(vrstica)));
    const med = await voice(dir, { CallSid: "CA-PRAZNO", From: "+38640000081", To: "+38615550900" }, "/api/voice/incoming", ob(1, 10, 0));
    const telo = await med.text();
    assert.doesNotMatch(telo, /izven delovnega|Delavnica je zdaj/);
    // Razkritje UI v govoru je »pomočnica z umetno inteligenco« (lastnik 14. 11. 2026, AGENTS.md »Razkritje UI je TRDO pravilo«).
    assert.match(telo, /pomočnica z umetno inteligenco/);
    const neodg = await savePravila({ prevzem: "neodgovorjeni", preusmeritev: "" }, token, dir);
    assert.ok(neodg.opozorila.some((vrstica) => /preusmerit|prazn/i.test(vrstica)));
  });

  it("N8 S7 vrzel obdrzi samo vprasanje brez stika", () => {
    const primer = "Ana Horvat, 041 555 123, ali dostavljate na Ptuj?";
    const out = besediloVrzel(primer);
    assert.equal(out, "ali dostavljate na Ptuj?");
    const posta = besediloVrzel("ana@primer.si, Ana Horvat. Ali dostavljate na Ptuj?");
    assert.doesNotMatch(posta, /@|Ana|041/);
    assert.match(posta, /dostavljate na Ptuj/);
  });

  it("N9 izjava o svojem telefonu ni stevilka podjetja", () => {
    const catalog = formaCatalog();
    assert.equal(odgovorIzKataloga("Moj telefon je 041 555 123", catalog), null);
    assert.match(odgovorIzKataloga("telefonska stevilka", catalog) ?? "", /555/);
    assert.match(odgovorIzKataloga("Kakšna je telefonska številka?", catalog) ?? "", /555/);
  });

  it("N10 nastevanje dni, deljen delovnik in nerazumljen ostanek", async () => {
    const dnevi = "pon, sre, pet 8.00-16.00";
    assert.equal(ureSoRazumljive(dnevi), true);
    assert.equal(razberiRazpone(dnevi).length, 3);
    assert.equal(znotrajDelovnika(ob(1, 10, 0), dnevi), true);
    assert.equal(znotrajDelovnika(ob(2, 10, 0), dnevi), false);
    assert.equal(znotrajDelovnika(ob(3, 10, 0), dnevi), true);
    assert.equal(znotrajDelovnika(ob(5, 10, 0), dnevi), true);
    const deljen = "pon-pet 8.00-12.00 in 13.00-17.00";
    assert.equal(ureSoRazumljive(deljen), true);
    assert.equal(znotrajDelovnika(ob(1, 10, 0), deljen), true);
    assert.equal(znotrajDelovnika(ob(1, 12, 30), deljen), false);
    assert.equal(znotrajDelovnika(ob(1, 14, 0), deljen), true);
    assert.equal(znotrajDelovnika(ob(1, 17, 0), deljen), false);
    assert.equal(ureSoRazumljive("pon-pet 8.00-16.00 pa pet 18.00"), false);
    const dir = await scratch();
    const token = await lastnik(dir);
    const slabo = formaCatalog();
    slabo.company.hours = "pon-pet 8.00-16.00 pa pet 18.00";
    await publishLine({ open: true, catalog: slabo }, { token }, dir);
    const op = await savePravila({ prevzem: "izven", preusmeritev: "+38641999000" }, token, dir);
    assert.ok(op.opozorila.some((vrstica) => /ni razumljiv/i.test(vrstica)));
  });

  it("V2 dodan rok brez stevk pade, parafraza dejstva ostane", () => {
    for (const dodan of ["Pridemo naslednji teden.", "Lahko jutri.", "Pridemo v ponedeljek.", "Koncano v dveh dneh."]) {
      assert.doesNotMatch(brezDodanegaRoka(dodan, "Katalog brez roka."), /naslednji|jutri|ponedeljek|dveh/, dodan);
    }
    const vir = "Garancija: velja 2 leti. Reklamacijski rok je 8 dni.";
    const parafraza = "Garancija velja 2 leti, rok za reklamacijo pa je 8 dni.";
    const out = varenOdgovor("Povejte o garanciji", parafraza, t("povprasevanje"), vir);
    assert.match(out, /2 leti/);
    assert.match(out, /8 dni/);
    assert.doesNotMatch(out, /povpra[sš]evanj/);
  });

  it("V3 telefon ob valuti ostane cel", () => {
    const out = brezZneska("Tel. 041 123 456 EUR 50");
    assert.match(out, /041 123 456/);
    assert.doesNotMatch(out, /50/);
    assert.doesNotMatch(out, /EUR/);
  });

  it("V4 delni kljuc ne zadene zapiska", () => {
    const catalog = formaCatalog();
    catalog.zapiski = [{ id: "z1", vprasanje: "Ali dostavljate na Ptuj?", odgovor: "Dostavljamo po dogovoru." }];
    assert.equal(najdiZapisek("dostavljate", catalog), null);
    assert.equal(odgovorIzKataloga("dostavljate", catalog), null);
    assert.match(odgovorIzKataloga("Ali dostavljate na Ptuj?", catalog) ?? "", /dogovoru/);
  });

  it("S8 vprasanje o roku ali urah ni rok narocila", () => {
    const catalog = formaCatalog();
    assert.equal(absorbUtterance(emptyDraft(), "Kaksen je rok dobave?", catalog).deadline, null);
    assert.equal(absorbUtterance(emptyDraft(), "Ali delate do petka do 16h?", catalog).deadline, null);
    assert.match(absorbUtterance(emptyDraft(), "Mizo Alba iz hrasta, rok do petka.", catalog).deadline ?? "", /petk/);
  });

  it("N12 meja dolzine v absorbUtterance in najdiZapisek", () => {
    const catalog = formaCatalog();
    catalog.zapiski = [{ id: "z1", vprasanje: "Ali dostavljate na Ptuj?", odgovor: "Dostavljamo po dogovoru." }];
    const predolg = `${"a".repeat(MEJA_IZREKA)} Ali dostavljate na Ptuj?`;
    assert.equal(najdiZapisek(predolg, catalog), null);
    const znotraj = absorbUtterance(emptyDraft(), `${"b".repeat(20)} Alba`, catalog);
    assert.equal(znotraj.requestedProduct, "Alba");
    const zunaj = absorbUtterance(emptyDraft(), `${"c".repeat(MEJA_IZREKA)} Alba`, catalog);
    assert.equal(zunaj.requestedProduct, null);
  });

  it("N13 vprasanja po ceni in ime stane", () => {
    for (const vprasanje of ["Koliko pride miza?", "Koliko zaracunate?", "Kolk je?"]) {
      assert.equal(vprasaPoCeni(vprasanje), true, vprasanje);
    }
    assert.equal(vprasaPoCeni("stane novak pri telefonu"), false);
    assert.equal(imaZnesek("stane novak pri telefonu"), false);
    assert.equal(vprasaPoCeni("Koliko stane miza?"), true);
  });

  it("N3 v nastavitvah je navodilo za statusni URL", async () => {
    const vir = await readFile(new URL("../../components/lina-desk.tsx", import.meta.url), "utf8");
    assert.match(vir, /statusUrl/);
    assert.match(t("statusUrl"), /\/api\/voice\/status/);
    assert.match(t("statusUrl"), /incoming/);
  });

  it("S7 skozi klic shrani samo vprasanje", async () => {
    const dir = await scratch();
    const token = await lastnik(dir);
    await phoneTurn(
      { callSid: "vrzel-e3", from: "+38640000111", text: "Ana Horvat, 041 555 123, ali dostavljate na Ptuj?" },
      { token },
      dir,
    );
    const vrzeli = await listVrzeli(token, dir);
    assert.equal(vrzeli.length, 1);
    assert.equal(vrzeli[0].vprasanje, "ali dostavljate na Ptuj?");
  });
});
