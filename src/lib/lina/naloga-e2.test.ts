/**
 * Naloga E2. Vsak preizkus pade, ce popravek manjka.
 * Komentarji in imena so brez sumnikov. Ista koda na Linuxu in Windows.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { t } from "./besedila.ts";
import { emptyDraft, absorbUtterance } from "./brain.ts";
import { formaCatalog } from "./catalog.ts";
import {
  brezDodanegaRoka,
  brezZneska,
  dejstvaKataloga,
  imaZnesek,
  razlogZneska,
  varenOdgovor,
  vprasaPoCeni,
} from "./guards.ts";
import { delezKratkih, jeKlicIzVmesnika, sestaviPozdrav, zRazkritjem } from "./povzetek.ts";
import { dodajVrzel, listVrzeli, MEJA_ODPRTIH_VRZELI, MEJA_ZAPISKOV, savePravila, zapomniVrzel } from "./pravila.server.ts";
import { listCalls, phoneTurn, publishLine } from "./service.server.ts";
import { handleVoiceRequest, xmlEscape } from "./voice.server.ts";
import { razberiDelovnik, razberiRazpone, ureSoRazumljive, znotrajDelovnika } from "./ure.ts";
import { besediloVrzel, najdiZapisek, odgovorIzKataloga } from "./znanje.ts";

process.env.LINA_LLM = "0";

const temps: string[] = [];

async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-e2-"));
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
  delete process.env.LINA_DATA;
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

describe("naloga E2", { concurrency: 1 }, () => {
  it("K1 drugi obrat ne klice znova in klic cez 8.00 ne pade", async () => {
    const dir = await scratch();
    const token = await lastnik(dir);
    await savePravila({ prevzem: "neodgovorjeni", preusmeritev: "+38641999000" }, token, dir);

    const prvi = await voice(dir, { CallSid: "CA-DRUGI", From: "+38640000001", To: "+38615550900" });
    assert.match(await prvi.text(), /<Dial\b/);

    const poZvonjenju = await voice(dir, {
      CallSid: "CA-DRUGI",
      From: "+38640000001",
      To: "+38615550900",
      DialCallStatus: "no-answer",
    }, "/api/voice/turn");
    assert.match(await poZvonjenju.text(), /<Gather\b/);

    const drugi = await voice(
      dir,
      {
        CallSid: "CA-DRUGI",
        From: "+38640000001",
        To: "+38615550900",
        SpeechResult: "Kje je naslov delavnice?",
      },
      "/api/voice/turn",
    );
    const telo = await drugi.text();
    assert.match(telo, /Obrtna/);
    assert.doesNotMatch(telo, /<Dial\b/);
    assert.match(telo, /<Gather\b/);

    const izven = await scratch();
    const token2 = await lastnik(izven);
    await savePravila({ prevzem: "izven", preusmeritev: "+38641999000" }, token2, izven);
    const zacetek = await voice(izven, { CallSid: "CA-759", From: "+38640000002" }, "/api/voice/incoming", ob(1, 7, 59));
    const zacetekTelo = await zacetek.text();
    assert.match(zacetekTelo, /<Say\b/);
    assert.doesNotMatch(zacetekTelo, /<Hangup\/>/);
    const cez = await voice(
      izven,
      { CallSid: "CA-759", From: "+38640000002", SpeechResult: "Kje je naslov delavnice?" },
      "/api/voice/turn",
      ob(1, 8, 0),
    );
    const cezTelo = await cez.text();
    assert.match(cezTelo, /Obrtna/);
    assert.doesNotMatch(cezTelo, /<Hangup\/>/);
    assert.doesNotMatch(cezTelo, /<Dial\b/);
  });

  it("K2 dovoljene stevilke, zneski in zavrnitev ob shranjevanju", async () => {
    const lazni = [
      "890,-",
      "okoli 900",
      "med 800 in 900",
      "Skupaj 890 z DDV",
      "900 + DDV",
      "2k",
      "petnajst evrov",
      "tisoc dvesto",
      "dvanajst jurjev",
      "5 stotakov",
      "50 CHF",
      "50$",
      "£50",
      "50 kun",
      "stane okoli 900",
      "cena znasa 900",
      "cena za kos je 900",
      "price is 900",
      "kosta 500",
      "**890** EUR",
      "890&nbsp;€",
    ];
    const celKatalog = dejstvaKataloga(formaCatalog());
    for (const primer of lazni) {
      assert.equal(imaZnesek(primer), true, primer);
      const out = varenOdgovor("povej", primer, t("povprasevanje"), celKatalog);
      assert.equal(imaZnesek(out), false, primer);
      assert.doesNotMatch(out, /890|900|500|2k|petnajst|jurj|stotak|CHF/i, primer);
    }
    assert.equal(imaZnesek("2 kosa, 180 x 90 cm"), false);

    const vprasanja = [
      "Koliko bi stalo",
      "koliko kosta",
      "Kolk pride",
      "Koliko je treba placati",
      "Kaksen je strosek",
      "Po cem je",
      "popust",
      "how much",
      "what does it cost",
    ];
    for (const vprasanje of vprasanja) {
      assert.equal(vprasaPoCeni(vprasanje), true, vprasanje);
      const out = varenOdgovor(vprasanje, "To je 890 EUR.", t("povprasevanje"), celKatalog);
      assert.equal(imaZnesek(out), false);
      assert.match(out, /povpra[sš]evanj/);
    }

    const dejstva = "Obrtna ulica 9\npon-pet 8.00-16.00\n+386 1 555 09 00\n180 x 90";
    const dovoljeno = varenOdgovor("Kje ste?", "Naslov je Obrtna ulica 9. Odprto 8.00-16.00.", t("povprasevanje"), dejstva);
    assert.match(dovoljeno, /ulica 9/);
    assert.match(dovoljeno, /8\.00-16\.00/);
    // Cetrti argument je od 12. 11. 2026 OSNUTEK (AGENTS.md »Glavni uporabniki so podjetja«: model samo uredi osnutek;
    // govor.ts sestaviOdgovor, plast.ts ostaniPriOsnutku): stevilka, ki je v osnutku ni, odpade in ostane osnutek.
    const tuje = varenOdgovor("Koliko miz?", "Imamo 12 miz.", t("povprasevanje"), dejstva);
    assert.doesNotMatch(tuje, /12/);
    assert.equal(tuje, dejstva);

    assert.ok(razlogZneska("Cena je 10 EUR"));
    const dir = await scratch();
    const token = await lastnik(dir);
    await assert.rejects(() => savePravila({ povprasevanje: "Ponudba je 50 EUR." }, token, dir), /znesk|cen/i);
    await assert.rejects(() => savePravila({ pozdrav: "Dober dan, stane 20 EUR." }, token, dir), /znesk|cen/i);
    await phoneTurn({ callSid: "zap-1", from: "+38640000071", text: "Ali dostavljate na Kranj?" }, { token }, dir);
    const vrzeli = await listVrzeli(token, dir);
    await assert.rejects(() => dodajVrzel(vrzeli[0].id, "Dostava stane 20 EUR.", token, dir), /znesk|cen/i);
  });

  it("V1 lazne zadetki niso ponudba", async () => {
    const primeri = [
      "Pobreska cesta 18, Europark",
      "Evropska 12",
      "2 europaleti",
      "Euro 6",
      "sodelavec Stane 3x tedensko",
      "Stane Novak pri telefonu",
    ];
    for (const primer of primeri) {
      assert.equal(vprasaPoCeni(primer), false, primer);
      assert.equal(imaZnesek(primer), false, primer);
      const out = varenOdgovor(primer, primer, t("povprasevanje"));
      assert.equal(out, primer, primer);
    }
  });

  it("V2 pike v urah in rok iz kataloga", async () => {
    const ure = "Delovni cas je pon-pet 8.00-16.00.";
    assert.equal(brezDodanegaRoka(ure, ""), ure);
    const druzba = "Podjetje d.o.o. je odprto.";
    assert.equal(brezDodanegaRoka(druzba, ""), druzba);
    const rok = "Rok dobave je 3 tedne.";
    const dnevi = "Dostavljamo v 3 dneh.";
    assert.equal(brezDodanegaRoka(rok, rok), rok);
    assert.equal(brezDodanegaRoka(dnevi, dnevi), dnevi);
    assert.doesNotMatch(brezDodanegaRoka(rok, "Ponudbo posljemo."), /tedne/);
    const skupaj = varenOdgovor("Kdaj pridete?", `${rok} ${dnevi}`, t("povprasevanje"), `${rok}\n${dnevi}`);
    assert.match(skupaj, /3 tedne/);
    assert.match(skupaj, /3 dneh/);
  });

  it("V3 telefon ostane, znesek pade", async () => {
    const out = brezZneska("Poklicite 041 123 456, 50 EUR je polog");
    assert.match(out, /041 123 456/);
    assert.doesNotMatch(out, /50\s*EUR/);
    assert.match(out, /polog/);
  });

  it("V4 kratke besede ne zadenejo zapiska", async () => {
    const catalog = formaCatalog();
    catalog.zapiski = [{ id: "z1", vprasanje: "Ali dostavljate na Ptuj?", odgovor: "Dostavljamo po dogovoru." }];
    for (const izrek of ["da", "na", "a", "?"]) {
      assert.equal(najdiZapisek(izrek, catalog), null, izrek);
      assert.equal(odgovorIzKataloga(izrek, catalog), null, izrek);
    }
    assert.match(odgovorIzKataloga("Ali dostavljate na Ptuj?", catalog) ?? "", /dogovoru/);
  });

  it("V5 izven med delom poklice lastnika, ce molci prevzame Lina", async () => {
    const dir = await scratch();
    const token = await lastnik(dir);
    await savePravila({ prevzem: "izven", preusmeritev: "+38641888000" }, token, dir);
    const med = await voice(dir, { CallSid: "CA-IZVEN", From: "+38640000081", To: "+38615550900" }, "/api/voice/incoming", ob(1, 10, 0));
    const telo = await med.text();
    assert.match(telo, /<Dial\b/);
    assert.match(telo, /38641888000/);
    assert.doesNotMatch(telo, /izven delovnega/);
    const naprej = await voice(
      dir,
      { CallSid: "CA-IZVEN", From: "+38640000081", DialCallStatus: "no-answer" },
      "/api/voice/turn",
      ob(1, 10, 0),
    );
    // Razkritje UI v govoru je »pomočnica z umetno inteligenco« (lastnik 14. 11. 2026, AGENTS.md »Razkritje UI je TRDO pravilo«).
    assert.match(await naprej.text(), /pomočnica z umetno inteligenco/);
  });

  it("V6 preusmeritev ni javna stevilka in ni enaka To", async () => {
    const dir = await scratch();
    const token = await lastnik(dir);
    await assert.rejects(() => savePravila({ preusmeritev: "+386 1 555 09 00" }, token, dir), /zanka/i);
    const brez = await voice(dir, { CallSid: "CA-BREZ", From: "+38640000091", To: "+38615550900" });
    const brezTelo = await brez.text();
    assert.doesNotMatch(brezTelo, /<Dial\b/);
    assert.doesNotMatch(brezTelo, /555\s*09\s*00|5550900/);
    // En klic naenkrat (lastnik 11. 11. 2026): nezakljucen klic bi naslednjemu dal »Linija je trenutno zasedena«.
    await voice(dir, { CallSid: "CA-BREZ", CallStatus: "completed" }, "/api/voice/status");

    await savePravila({ preusmeritev: "+38641777000" }, token, dir);
    const klic = await voice(dir, { CallSid: "CA-LOOP", From: "+38640000092", To: "+38641777000" });
    const klicTelo = await klic.text();
    assert.doesNotMatch(klicTelo, /<Dial\b/);
    assert.doesNotMatch(klicTelo, /555\s*09\s*00/);
    await voice(dir, { CallSid: "CA-LOOP", CallStatus: "completed" }, "/api/voice/status");

    const drug = await voice(dir, { CallSid: "CA-DRUG", From: "+38640000093", To: "+38615550900" });
    const drugTelo = await drug.text();
    assert.match(drugTelo, /<Number[^>]*>\+38641777000<\/Number>/);
    assert.doesNotMatch(drugTelo, /555\s*09\s*00|5550900/);
  });

  it("V7 statusni povratni klic zakljuci povzetek in kratki klic", async () => {
    const dir = await scratch();
    const token = await lastnik(dir);
    await savePravila({ prevzem: "vsi" }, token, dir);
    await voice(dir, { CallSid: "CA-STAT", From: "+38640000101", CallStatus: "ringing" });
    const odprt = JSON.parse(await readFile(path.join(dir, "calls.json"), "utf8")) as Record<string, { status: string; povzetek?: unknown }>;
    assert.equal(odprt["CA-STAT"].status, "v-teku");
    assert.equal(odprt["CA-STAT"].povzetek, undefined);

    const brezPodpisa = await handleVoiceRequest(
      new Request("https://lina.primer/api/voice/status", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ CallSid: "CA-STAT", CallStatus: "completed" }).toString(),
      }),
      dir,
    );
    assert.equal(brezPodpisa.status, 403);
    const se = JSON.parse(await readFile(path.join(dir, "calls.json"), "utf8")) as Record<string, { status: string }>;
    assert.equal(se["CA-STAT"].status, "v-teku");

    const konec = await voice(dir, { CallSid: "CA-STAT", CallStatus: "completed" }, "/api/voice/status");
    assert.match(await konec.text(), /<Hangup\/>/);
    const knjiga = JSON.parse(await readFile(path.join(dir, "calls.json"), "utf8")) as Record<
      string,
      { status: string; kratek?: boolean; povzetek?: { kdo: string } }
    >;
    assert.equal(knjiga["CA-STAT"].status, "zakljucen");
    assert.equal(knjiga["CA-STAT"].kratek, true);
    assert.ok(knjiga["CA-STAT"].povzetek);
  });

  it("S1 nerazumljive ure v nacinu izven opozorijo", async () => {
    const dir = await scratch();
    const token = await lastnik(dir);
    const slabo = formaCatalog();
    slabo.company.hours = "odprto ob delavnikih";
    const objava = await publishLine({ open: true, catalog: slabo }, { token }, dir);
    assert.equal(objava.opozorila.length, 0);
    const opozorjeno = await savePravila({ prevzem: "izven" }, token, dir);
    assert.ok(opozorjeno.opozorila.some((vrstica) => /ni razumljiv/i.test(vrstica)));
    const spet = await publishLine({ open: true, catalog: slabo }, { token }, dir);
    assert.ok(spet.opozorila.some((vrstica) => /ni razumljiv/i.test(vrstica)));
    const ure = formaCatalog();
    const dobro = await publishLine({ open: true, catalog: ure }, { token }, dir);
    assert.equal(dobro.opozorila.length, 0);
  });

  it("S2 razponi, zaprto in minute", async () => {
    const ure = "sob-ned zaprto, pon-pet 8.00-16.00";
    assert.equal(znotrajDelovnika(ob(6, 10, 0), ure), false);
    assert.equal(znotrajDelovnika(ob(0, 10, 0), ure), false);
    assert.equal(znotrajDelovnika(ob(1, 10, 0), ure), true);
    assert.equal(razberiDelovnik("pon-pet 8.60-16.00"), null);
    assert.equal(znotrajDelovnika(ob(1, 10, 0), "pon-pet 8.99-16.00"), false);
    assert.equal(ureSoRazumljive("odprto ob delavnikih"), false);
    const sobota = "pon-pet 8.00-16.00, sob 8.00-12.00";
    assert.equal(razberiRazpone(sobota).length, 2);
    assert.equal(znotrajDelovnika(ob(6, 10, 0), sobota), true);
    assert.equal(znotrajDelovnika(ob(6, 13, 0), sobota), false);
    assert.equal(znotrajDelovnika(ob(0, 10, 0), sobota), false);
    assert.equal(razberiDelovnik("pon-pet 22.00-06.00"), null);
  });

  it("S4 pozdrav in razkritje AI", () => {
    const pozdrav = sestaviPozdrav("", "FORMA");
    assert.match(pozdrav, /^Dober dan, FORMA\./);
    assert.match(pozdrav, /AI asistentka/);
    assert.match(pozdrav, /Kako vam lahko pomagam\?$/);
    // 14. 11. 2026 (besedila.ts, AGENTS.md »Razkritje UI je TRDO pravilo«): razkritje doda zRazkritjem spredaj, podvojeno
    // »Sem AI asistentka« v linijaZaprta je odstranjeno. Prvi izgovorjeni stavek zaprte linije je razkritje.
    assert.doesNotMatch(t("linijaZaprta"), /AI asistentka/);
    assert.match(zRazkritjem(null, t("linijaZaprta")).split(/(?<=[.!?])\s/)[0], /umetno inteligenco/);
    assert.match(t("zasedeno"), /AI asistentka/);
    assert.match(t("zasedeno"), /izven delovnega/);
  });

  it("S5 xml pobegne in vrze nedovoljene znake", () => {
    const out = xmlEscape("a\u0000b\u0001<c>&\"'");
    const amp = "&";
    assert.equal(out.includes("\u0000") || out.includes("\u0001"), false);
    assert.equal(out.includes("<") || out.includes(">"), false);
    assert.equal(out, `ab${amp}lt;c${amp}gt;${amp}amp;${amp}quot;${amp}apos;`);
    assert.equal(xmlEscape("čšž"), "čšž");
  });

  it("S6 meja steje odprte vrzeli, zapiski imajo opozorilo", async () => {
    const dir = await scratch();
    const token = await lastnik(dir);
    await zapomniVrzel("Ali imate parkiranje za goste?", dir);
    const prva = (await listVrzeli(token, dir))[0];
    await dodajVrzel(prva.id, "Parkiranje je za hišo.", token, dir);
    const oznaka = (n: number): string => {
      let s = "";
      let x = n + 1;
      do {
        s = String.fromCharCode(97 + ((x - 1) % 26)) + s;
        x = Math.floor((x - 1) / 26);
      } while (x > 0);
      return s;
    };
    for (let i = 0; i < MEJA_ODPRTIH_VRZELI + 5; i += 1) {
      await zapomniVrzel(`Ali dostavljate v kraj ${oznaka(i)} ta teden?`, dir);
    }
    const vse = await listVrzeli(token, dir);
    const odprte = vse.filter((vrzel) => !vrzel.dodano);
    assert.equal(odprte.length, MEJA_ODPRTIH_VRZELI);
    assert.equal(vse.some((vrzel) => vrzel.id === prva.id && vrzel.dodano), true);

    const catalog = formaCatalog();
    catalog.zapiski = Array.from({ length: MEJA_ZAPISKOV }, (_, i) => ({
      id: `z-${oznaka(i)}`,
      // Zapisek o dostavi brez vklopa se zavrne (lastnik 10. 11. 2026, AGENTS.md »Garancija in dostava«): nevtralna tema.
      vprasanje: `Vprasanje x${oznaka(i)} o parkiranju?`,
      // Beseda »zneska« je ob shranjevanju denarni signal (plast.ts, CENA_KORENI); preizkus meje rabi nevtralen odgovor.
      odgovor: "Kratek odgovor.",
    }));
    await publishLine({ open: true, catalog }, { token }, dir);
    await zapomniVrzel("Ali imate se eno vprasanje o barvi stopnic?", dir);
    const zadnja = (await listVrzeli(token, dir)).find((vrzel) => !vrzel.dodano);
    assert.ok(zadnja);
    await assert.rejects(() => dodajVrzel(zadnja.id, "Barvo dogovorimo posebej.", token, dir), /100/);
  });

  it("S7 vrzel nima telefona in imena", async () => {
    const dir = await scratch();
    const token = await lastnik(dir);
    const text = "Ana Horvat pri telefonu, 041 555 123. Ali dostavljate na Ptuj?";
    assert.doesNotMatch(besediloVrzel(text), /041|Ana Horvat/);
    assert.match(besediloVrzel(text), /dostavljate na Ptuj/);
    await phoneTurn({ callSid: "vrzel-oseba", from: "+38640000111", text }, { token }, dir);
    const vrzeli = await listVrzeli(token, dir);
    assert.equal(vrzeli.length, 1);
    assert.doesNotMatch(vrzeli[0].vprasanje, /041|Ana|Horvat|\+386/);
    assert.match(vrzeli[0].vprasanje, /Ptuj/);
  });

  it("S8 do kdaj in znesek nista rok", () => {
    const catalog = formaCatalog();
    const kdaj = absorbUtterance(emptyDraft(), "Do kdaj delate?", catalog);
    assert.equal(kdaj.deadline, null);
    const denar = absorbUtterance(emptyDraft(), "Proracun je do 500 evrov.", catalog);
    assert.equal(denar.deadline, null);
    const rok = absorbUtterance(emptyDraft(), "Mizo Alba iz hrasta, rok do petka.", catalog);
    assert.match(rok.deadline ?? "", /petk/);
  });

  it("nizko: nahajanje, telefon, odstotki, vzorec in lokalno", async () => {
    const catalog = formaCatalog();
    assert.match(odgovorIzKataloga("kje se nahajate", catalog) ?? "", /Obrtna/);
    assert.match(odgovorIzKataloga("telefonska stevilka", catalog) ?? "", /555/);

    const dir = await scratch();
    const token = await lastnik(dir);
    await phoneTurn({ callSid: "pravi-k", from: "+38640000121", text: "" }, { token }, dir);
    await phoneTurn({ callSid: "pravi-k", hangup: true }, { token }, dir);
    await phoneTurn({ callSid: "lokalno-1", from: "pisarna", text: "" }, { token }, dir);
    await phoneTurn({ callSid: "lokalno-1", hangup: true }, { token }, dir);
    await phoneTurn({ callSid: "vzorec-1", from: "vzorec", text: "" }, { token }, dir);
    await phoneTurn({ callSid: "vzorec-1", hangup: true }, { token }, dir);
    const delez = delezKratkih(await listCalls({ token }, dir));
    assert.equal(delez.koncani, 1);
    assert.equal(delez.kratki, 1);
    assert.equal(delez.odstotki, 100);
    assert.equal(jeKlicIzVmesnika({ callSid: "lokalno-abc", from: "+386" }), true);
    assert.equal(jeKlicIzVmesnika({ callSid: "vzorec-abc", from: "+386" }), true);
    assert.equal(jeKlicIzVmesnika({ callSid: "CA1", from: "+38640000000" }), false);
  });
});
