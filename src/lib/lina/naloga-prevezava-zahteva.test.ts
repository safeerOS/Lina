/**
 * Prevezava MED klicem na zahtevo klicatelja (lastnik 23. 11. 2026: »ce bo klicatelj rekel da zeli govoriti z pravo osebo ali nujno da
 * preusmeri klic na osebni telefon uporabnika«; tudi v sedanji aplikaciji, privzeto vklopljeno, s stikalom). Cilj je »Stevilka za
 * preusmeritev«. Brez omrezja: Twilio je nadomescen s podpisano zahtevo na webhook; pravi klic NI preizkusen.
 * Samo izmisljene stevilke.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { formaCatalog } from "./catalog.ts";
import { nastaviZahtevoNujnih, pocakajNujne, pozabiObvescene, prevezavaNaZahtevo, rezervirajKvoto, shraniNujne, ZAHTEVA_OMEJITEV_DAN, ZAHTEVA_OMEJITEV_URA } from "./nujni.server.ts";
import { nastaviOgrevanjeZaPreizkus } from "./ogrevanje-klica.server.ts";
import { defaultPravila, loadPravila, normalizePravila, savePravila } from "./pravila.server.ts";
import { preberiKlic, publishLine } from "./service.server.ts";
import { ocistiSporocilo, sporociloObProsnji, zajemiTajnico, zeliPravoOsebo } from "./tajnica.ts";
import type { ModelRazumevanja } from "./razumevanje.server.ts";
import { povezi as poveziTwilio, type ZahtevaTwilio } from "./twilio-racun.server.ts";
import { handleVoiceRequest, pocakajOzadjeKlicev, type MoznostiKlica } from "./voice.server.ts";

process.env.LINA_LLM = "0";
nastaviOgrevanjeZaPreizkus(async () => undefined);

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-prevezava-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const temps: string[] = [];

const OD = "+38640000000";
const LINA = "+38615550123";
const LASTNIK = "+38641000000";

afterEach(async () => {
  delete process.env.TWILIO_AUTH_TOKEN;
  await pocakajNujne();
  await pocakajOzadjeKlicev();
  while (temps.length) {
    const dir = temps.pop();
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

async function linija(pravila: Record<string, unknown> = {}): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  temps.push(dir);
  const token = await setupOwner("geslo-test-1234", dir);
  await publishLine({ open: true, brezGlasu: true, catalog: formaCatalog() }, { token }, dir);
  await savePravila({ prevzem: "vsi", preusmeritev: LASTNIK, ...pravila }, token, dir);
  return { dir, token };
}

async function voice(dir: string, params: Record<string, string>, pot: string, moznosti?: MoznostiKlica): Promise<string> {
  const skrivnost = "twilio-zeton-preizkusa";
  process.env.TWILIO_AUTH_TOKEN = skrivnost;
  const url = `https://lina.primer${pot}`;
  const podpisano = Object.keys(params).sort().reduce((acc, kljuc) => acc + kljuc + params[kljuc], url);
  const podpis = createHmac("sha1", skrivnost).update(podpisano).digest("base64");
  const odgovor = await handleVoiceRequest(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": podpis },
      body: new URLSearchParams(params).toString(),
    }),
    dir,
    undefined,
    moznosti,
  );
  return odgovor.text();
}

/** Klic do izreka z zahtevo: pozdrav, ime, nato izrek. Vrne TwiML zadnjega obrata. */
async function doZahteve(dir: string, sid: string, izrek: string, od = OD): Promise<string> {
  await voice(dir, { CallSid: sid, From: od, To: LINA }, "/api/voice/incoming");
  await voice(dir, { CallSid: sid, From: od, To: LINA, SpeechResult: "Ana Primer, nisem iz podjetja." }, "/api/voice/turn?obr=1");
  return voice(dir, { CallSid: sid, From: od, To: LINA, SpeechResult: izrek }, "/api/voice/turn?obr=2");
}

async function poDialu(dir: string, sid: string, stanje: string): Promise<string> {
  const o = (await preberiKlic(sid, dir))?.obrat;
  return voice(dir, { CallSid: sid, From: OD, To: LINA, CallStatus: "in-progress", DialCallStatus: stanje }, `/api/voice/turn?nujni=1&obr=${o}`);
}

const DIAL_NA_LASTNIKA = new RegExp(`<Dial [^>]*action="[^"]*nujni=1&amp;obr=\\d+"[^>]*><Number [^>]*>\\${LASTNIK}</Number></Dial>`);

describe("zaznava: klicatelj zeli pravo osebo", () => {
  const DA = [
    "Rad bi govoril s pravo osebo.",
    "rad bi govoril z direktorjem",
    "Ali lahko govorim s človekom?",
    "a lahko govorim z njo",
    "Želim govoriti z živo osebo.",
    "Povežite me z vodjo, prosim.",
    "prevezite me prosim",
    "Dajte mi direktorja.",
    "Hočem človeka, ne robota.",
    "rabim cloveka",
    "dober dan ne vem kako to deluje rad bi govoril s sefom",
    "Bi se lahko pogovoril z resničnim človekom?",
    // CodeRabbit 029: zanikanje velja samo tik pred prosnjo
    "ne vem, rad bi govoril z direktorjem",
    "Ne vem rad bi govoril z direktorjem.",
    "Ne, rad bi govoril z direktorjem.",
    // CodeRabbit 029: »prava/ziva oseba« s prosnjo
    "Dajte mi živo osebo.",
    "Rabim pravega človeka.",
    "Govoril bi s pravo osebo.",
    "Rabim govoriti s pravo osebo.",
    "Pravo osebo, prosim.",
    "Lahko dobim živo osebo?",
  ];
  const NE = [
    "Ste robot?",
    "Ali govorim s človekom?",
    "Rad bi govoril z vami o ponudbi.",
    "Ne rabim človeka, samo sporočite.",
    "Ni treba, da me povežete.",
    "Nočem govoriti z direktorjem.",
    "Ni nujno.",
    "Pravzaprav osebno bi rad naročil mizo.",
    "Potrebujem dve mizi iz hrasta.",
    "Sporočite direktorju, da me pokliče.",
    "Kdo je to?",
    "",
    "Ne bi rad govoril z direktorjem.",
    "ne bi rad govoril z direktorjem",
    "ni treba da me povežete",
    "Ne rabim človeka.",
    "Ste vi prava oseba?",
    "A ste prava oseba za to?",
    "Govorim s pravo osebo?",
    "Ali ste živa oseba?",
    "Ne rabim, da me povežete.",
    "ne rabim da me povežete",
    "Ne želim, da me povežete.",
    "ne želim da me povežete",
  ];
  it("pozitivni stavki so prosnja", () => {
    for (const s of DA) assert.equal(zeliPravoOsebo(s), true, s);
  });
  it("zanikanje, vprasanje o Lini in pogovor z Lino niso prosnja", () => {
    for (const s of NE) assert.equal(zeliPravoOsebo(s), false, s);
  });
});

describe("stikalo »Preveži klic na zahtevo klicatelja«", () => {
  it("privzeto vklopljeno; izrecen false ostane; napacen tip je zavrnjen", async () => {
    assert.equal(defaultPravila().prevezaNaZahtevo, true);
    assert.equal(normalizePravila({}).prevezaNaZahtevo, true);
    assert.equal(normalizePravila({ prevezaNaZahtevo: false }).prevezaNaZahtevo, false);
    const { dir, token } = await linija({ prevezaNaZahtevo: false });
    assert.equal((await loadPravila(dir)).prevezaNaZahtevo, false);
    await assert.rejects(savePravila({ prevezaNaZahtevo: "da" as unknown as boolean }, token, dir));
  });

  it("cilj: izklopljeno -> null; brez stevilke, zanka (klicatelj, Linina stevilka, preusmerjena, telefon podjetja) -> »brez«", async () => {
    const { dir } = await linija();
    const p = await loadPravila(dir);
    assert.deepEqual(await prevezavaNaZahtevo(dir, p, [LINA, "", OD]), { stevilka: LASTNIK, cakanjeSek: p.cakanjeSekund });
    assert.equal(await prevezavaNaZahtevo(dir, { ...p, prevezaNaZahtevo: false }, [LINA]), null);
    assert.equal(await prevezavaNaZahtevo(dir, { ...p, preusmeritev: "" }, [LINA]), "brez");
    assert.equal(await prevezavaNaZahtevo(dir, p, [LINA, "", LASTNIK]), "brez", "klicatelj je lastnik");
    assert.equal(await prevezavaNaZahtevo(dir, p, [LASTNIK]), "brez", "Linina stevilka");
    assert.equal(await prevezavaNaZahtevo(dir, p, [LINA, "+386 41 000 000"]), "brez", "ForwardedFrom v drugi obliki");
    assert.equal(await prevezavaNaZahtevo(dir, { ...p, preusmeritev: "+386 1 555 09 00" }, [LINA]), "brez", "javna stevilka podjetja");
    assert.equal(await prevezavaNaZahtevo(dir, { ...p, preusmeritev: "+38690123456" }, [LINA]), "brez", "premijska");
  });
});

describe("prevezava med klicem (Twilio Dial) in vrnitev k Lini", { concurrency: 1 }, () => {
  it("»prava oseba«: Lina rece samo »Poskušam vas povezati.«, Dial na stevilko za preusmeritev s potrditvijo in action nujni=1", async () => {
    const { dir } = await linija();
    const twiml = await doZahteve(dir, "CA-PRZ-1", "Rad bi govoril s pravo osebo.");
    assert.match(twiml, DIAL_NA_LASTNIKA);
    assert.match(twiml, /<Number url="[^"]*\/api\/voice\/potrdi\?sid=CA-PRZ-1"/);
    const predDial = twiml.slice(0, twiml.indexOf("<Dial"));
    assert.match(predDial, /Poskušam vas povezati\./);
    assert.doesNotMatch(twiml, /<Gather/);
    const zapis = await preberiKlic("CA-PRZ-1", dir);
    assert.equal(zapis?.status, "v-teku");
    assert.equal(zapis?.nujnoPrevezano, true);
    assert.deepEqual(zapis?.nujniDogodki?.map((d) => [d.vrsta, d.izid]), [["prevezava", "poskus"]]);
    assert.doesNotMatch(JSON.stringify(zapis), /41000000|41 000 000/, "stevilka lastnika ni v zapisu");
  });

  it("lastnik se ne oglasi (no-answer, busy, completed brez tipke 1): klic ostane pri Lini, NUJNO, Lina vprasa po sporocilu in ga zapise", async () => {
    for (const [i, stanje] of ["no-answer", "busy", "completed"].entries()) {
      const { dir } = await linija();
      const sid = `CA-PRZ-2${i}`;
      await doZahteve(dir, sid, "Ali lahko govorim s človekom?");
      const twiml = await poDialu(dir, sid, stanje);
      assert.match(twiml, /Povezava ni uspela\. Zadevo sem zapisala kot nujno\./, stanje);
      assert.match(twiml, /Katero sporočilo želite pustiti\?/, stanje);
      assert.match(twiml, /<Gather/, stanje);
      assert.doesNotMatch(twiml, /<Dial/, stanje);
      const zapis = await preberiKlic(sid, dir);
      assert.equal(zapis?.order.tajnica?.nujno, true, stanje);
      assert.deepEqual(zapis?.nujniDogodki?.map((d) => [d.vrsta, d.izid]), [["prevezava", "neodgovor"]], stanje);
      const o = zapis?.obrat;
      const dalje = await voice(dir, { CallSid: sid, From: OD, To: LINA, SpeechResult: "Naj me pokliče glede računa za oktober." }, `/api/voice/turn?obr=${o}`);
      assert.doesNotMatch(dalje, /<Dial/, "najvec enkrat na klic");
      const po = await preberiKlic(sid, dir);
      assert.match(po?.order.tajnica?.sporocilo ?? "", /računa za oktober/, stanje);
      assert.equal(po?.order.tajnica?.nujno, true);
    }
  });

  it("kratek potek podjetja (podrobniPotek: false): po neuspeli prevezavi se klic ne konca brez sporocila", async () => {
    const { dir } = await linija({ podrobniPotek: false });
    const sid = "CA-PRZ-3";
    await doZahteve(dir, sid, "Povežite me z vodjo.");
    const twiml = await poDialu(dir, sid, "no-answer");
    assert.match(twiml, /Katero sporočilo želite pustiti\?/);
    assert.doesNotMatch(twiml, /<Hangup\/>/);
    assert.notEqual((await preberiKlic(sid, dir))?.status, "zakljucen");
  });

  it("lastnik se oglasi in pritisne 1 (completed): klic se konca brez novega govora, izid »oglasil«", async () => {
    const { dir } = await linija();
    const sid = "CA-PRZ-4";
    await doZahteve(dir, sid, "Dajte mi direktorja.");
    await voice(dir, { CallSid: "CA-PRZ-4-NOGA", Digits: "1" }, `/api/voice/potrdi-tipka?sid=${sid}`);
    const twiml = await poDialu(dir, sid, "completed");
    assert.match(twiml, /<Response><Hangup\/><\/Response>/);
    const zapis = await preberiKlic(sid, dir);
    assert.equal(zapis?.status, "zakljucen");
    assert.equal(zapis?.nujniDogodki?.[0].izid, "oglasil");
  });

  it("brez stevilke za preusmeritev in brez nujnosti (pregled 029, najdba 4): ni Dial, ni »Povezava ni uspela«, ni oznake NUJNO, obrat tece naprej", async () => {
    const { dir } = await linija({ preusmeritev: "" });
    const sid = "CA-PRZ-5";
    const twiml = await doZahteve(dir, sid, "Rad bi govoril z direktorjem.");
    assert.doesNotMatch(twiml, /<Dial/);
    assert.doesNotMatch(twiml, /Povezava ni uspela|zapisala kot nujno/);
    assert.match(twiml, /<Gather/);
    const zapis = await preberiKlic(sid, dir);
    const lina = zapis?.transcript.filter((v) => v.role === "lina").at(-1)?.text ?? "";
    assert.ok(lina.trim(), "obicajen odgovor");
    assert.doesNotMatch(lina, /Povezava ni uspela|zapisala kot nujno/);
    assert.notEqual(zapis?.order.tajnica?.nujno, true);
    assert.equal(zapis?.nujnoPrevezano, undefined);
    assert.notEqual(zapis?.cakaSporocilo, true);
    assert.equal(zapis?.nujniDogodki, undefined, "poskusa ni bilo");
  });

  it("stikalo izklopljeno: prosnja ne sprozi prevezave", async () => {
    const { dir } = await linija({ prevezaNaZahtevo: false });
    const twiml = await doZahteve(dir, "CA-PRZ-6", "Rad bi govoril s pravo osebo.");
    assert.doesNotMatch(twiml, /<Dial/);
    assert.equal((await preberiKlic("CA-PRZ-6", dir))?.nujnoPrevezano, undefined);
  });

  it("zanka: klicatelj klice s stevilke za preusmeritev (lastnik sam) ali preusmerjen z nje -> ni Dial", async () => {
    const { dir } = await linija();
    assert.doesNotMatch(await doZahteve(dir, "CA-PRZ-7", "Rad bi govoril s pravo osebo.", LASTNIK), /<Dial/);
    const sid = "CA-PRZ-8";
    await voice(dir, { CallSid: sid, From: OD, To: LINA, ForwardedFrom: LASTNIK }, "/api/voice/incoming");
    const twiml = await voice(dir, { CallSid: sid, From: OD, To: LINA, ForwardedFrom: LASTNIK, SpeechResult: "Rad bi govoril s pravo osebo." }, "/api/voice/turn?obr=1");
    assert.doesNotMatch(twiml, /<Dial/);
  });

  it("nujnost z veljavnim ciljem sprozi prevezavo; »ni nujno« in navaden izrek ne", async () => {
    const { dir } = await linija();
    assert.match(await doZahteve(dir, "CA-PRZ-9", "Sporočite direktorju, da je nujno, rabim odgovor danes."), DIAL_NA_LASTNIKA);
    assert.doesNotMatch(await doZahteve(dir, "CA-PRZ-10", "Sporočite direktorju, da me pokliče, ni nujno."), /<Dial/);
    assert.doesNotMatch(await doZahteve(dir, "CA-PRZ-11", "Zanima me miza iz hrasta."), /<Dial/);
  });

  it("nujnost brez stevilke ostane po obstojecem poteku (samo oznaka, brez stavka o povezavi)", async () => {
    const { dir } = await linija({ preusmeritev: "" });
    const twiml = await doZahteve(dir, "CA-PRZ-12", "Sporočite direktorju, da je nujno, rabim odgovor danes.");
    assert.doesNotMatch(twiml, /<Dial/);
    const zapis = await preberiKlic("CA-PRZ-12", dir);
    assert.equal(zapis?.order.tajnica?.nujno, true);
    assert.equal(zapis?.nujnoPrevezano, undefined);
  });
});

describe("prevezava na zahtevo v nacinu osebna tajnica", { concurrency: 1 }, () => {
  it("»lahko govorim z njo«: Dial na lastnika; ob neodgovoru vrnitev k Lini, NUJNO, vprasanje po sporocilu", async () => {
    const { dir } = await linija({ nacinKlica: "osebna", imeLastnika: "Ana" });
    const sid = "CA-PRZ-O1";
    await voice(dir, { CallSid: sid, From: OD, To: LINA }, "/api/voice/incoming");
    const twiml = await voice(dir, { CallSid: sid, From: OD, To: LINA, SpeechResult: "A lahko govorim z njo osebno?" }, "/api/voice/turn?obr=1");
    assert.match(twiml, DIAL_NA_LASTNIKA);
    assert.match(twiml.slice(0, twiml.indexOf("<Dial")), /Poskušam vas povezati\./);
    const nazaj = await poDialu(dir, sid, "no-answer");
    assert.match(nazaj, /Povezava ni uspela\. Zadevo sem zapisala kot nujno\./);
    assert.match(nazaj, /Katero sporočilo želite pustiti\?/);
    const zapis = await preberiKlic(sid, dir);
    assert.equal(zapis?.order.tajnica?.nujno, true);
    assert.equal(zapis?.status, "v-teku");
  });

  it("nujno sporocilo: zapise se kot sporocilo PRED prevezavo (ob neodgovoru se nic ne izgubi)", async () => {
    const { dir } = await linija({ nacinKlica: "osebna", imeLastnika: "Ana" });
    const sid = "CA-PRZ-O2";
    await voice(dir, { CallSid: sid, From: OD, To: LINA }, "/api/voice/incoming");
    const twiml = await voice(dir, { CallSid: sid, From: OD, To: LINA, SpeechResult: "Nujno je, ključi od stanovanja so pri sosedu." }, "/api/voice/turn?obr=1");
    assert.match(twiml, DIAL_NA_LASTNIKA);
    const nazaj = await poDialu(dir, sid, "no-answer");
    assert.match(nazaj, /Povezava ni uspela/);
    assert.doesNotMatch(nazaj, /Katero sporočilo/);
    const zapis = await preberiKlic(sid, dir);
    assert.match(zapis?.order.tajnica?.sporocilo ?? "", /ključi od stanovanja/);
    assert.equal(zapis?.order.tajnica?.nujno, true);
  });
});

describe("sporocilo po vprasanju (zajemiTajnico, caka »sporocilo«)", () => {
  it("izrek je sporocilo; »ne, to je vse« ni", () => {
    const prej = { sporocilo: "", razlog: "", nujno: true, nujnostZnana: true };
    assert.equal(zajemiTajnico("Naj me pokliče.", "Naj me pokliče.", prej, "sporocilo")?.sporocilo, "Naj me pokliče.");
    assert.equal(zajemiTajnico("Ne, to je vse.", "Ne, to je vse.", prej, "sporocilo")?.sporocilo, "");
  });
});

describe("pregled 029: locena kvota prevezave na zahtevo (najdba 1)", { concurrency: 1 }, () => {
  it("kvota na zahtevo: 2 na uro za istega klicatelja, 6 na dan; kvota nujnih ostane nedotaknjena", async () => {
    const { dir } = await linija();
    assert.equal(ZAHTEVA_OMEJITEV_URA, 2);
    assert.equal(ZAHTEVA_OMEJITEV_DAN, 6);
    const zdaj = "2026-11-23T10:00:00.000Z";
    assert.equal(await rezervirajKvoto(dir, "K1", OD, zdaj, "zahteva"), true);
    assert.equal(await rezervirajKvoto(dir, "K2", OD, zdaj, "zahteva"), true);
    assert.equal(await rezervirajKvoto(dir, "K3", OD, zdaj, "zahteva"), false, "tretja v isti uri");
    for (let i = 0; i < 4; i += 1) assert.equal(await rezervirajKvoto(dir, `KD${i}`, `+3864000010${i}`, zdaj, "zahteva"), true);
    assert.equal(await rezervirajKvoto(dir, "KD9", "+38640000109", zdaj, "zahteva"), false, "sedma v dnevu");
    // kvota nujnih (privzeto 3 na uro) je locena
    assert.equal(await rezervirajKvoto(dir, "N1", OD, zdaj), true);
  });

  it("tretja prosnja istega klicatelja v uri ne zazvoni; kvote nujnih ne porabi", async () => {
    const { dir } = await linija();
    // en klic naenkrat: vsak klic se konca (status completed), preden pride naslednji
    const konec = (sid: string) => voice(dir, { CallSid: sid, From: OD, To: LINA, CallStatus: "completed" }, "/api/voice/status");
    assert.match(await doZahteve(dir, "CA-KV-1", "Rad bi govoril s pravo osebo."), DIAL_NA_LASTNIKA);
    await konec("CA-KV-1");
    assert.match(await doZahteve(dir, "CA-KV-2", "Rad bi govoril s pravo osebo."), DIAL_NA_LASTNIKA);
    await konec("CA-KV-2");
    const tretji = await doZahteve(dir, "CA-KV-3", "Rad bi govoril s pravo osebo.");
    assert.doesNotMatch(tretji, /zasedena/);
    assert.doesNotMatch(tretji, /<Dial/);
    await assert.rejects(access(path.join(dir, "nujni-kvota.json")), "kvota nujnih ni bila porabljena");
    // Odlocitev vodje (naloga 2, A): porabljena kvota brez povedane nujnosti = kot »brez« - obrat tece normalno.
    assert.doesNotMatch(tretji, /Povezava ni uspela|zapisala kot nujno/);
    assert.match(tretji, /<Gather/);
    const zapis = await preberiKlic("CA-KV-3", dir);
    assert.notEqual(zapis?.order.tajnica?.nujno, true);
    assert.equal(zapis?.nujnoPrevezano, undefined);
    assert.equal(zapis?.nujniDogodki, undefined, "brez dogodka »omejeno«");
    assert.notEqual(zapis?.cakaSporocilo, true);
  });

  it("porabljena kvota s POVEDANO nujnostjo ostane kot prej: »Povezava ni uspela«, NUJNO, dogodek »omejeno«", async () => {
    const { dir } = await linija();
    const konec = (sid: string) => voice(dir, { CallSid: sid, From: OD, To: LINA, CallStatus: "completed" }, "/api/voice/status");
    for (const sid of ["CA-KV-N1", "CA-KV-N2"]) {
      await doZahteve(dir, sid, "Rad bi govoril s pravo osebo.");
      await konec(sid);
    }
    const tretji = await doZahteve(dir, "CA-KV-N3", "Rad bi govoril s pravo osebo, nujno je.");
    assert.doesNotMatch(tretji, /<Dial/);
    assert.match(tretji, /Povezava ni uspela/);
    const zapis = await preberiKlic("CA-KV-N3", dir);
    assert.equal(zapis?.order.tajnica?.nujno, true);
    assert.deepEqual(zapis?.nujniDogodki?.map((d) => [d.vrsta, d.izid]), [["prevezava", "omejeno"]]);
  });
});

describe("pregled 029: zastavica sporocila po neuspeli prevezavi (najdba 8)", { concurrency: 1 }, () => {
  it("velja samo za naslednji izrek, tudi ce ga obdela druga veja (nacin klica spremenjen med klicem)", async () => {
    const { dir, token } = await linija();
    const sid = "CA-ZS-1";
    await doZahteve(dir, sid, "Ali lahko govorim s človekom?");
    await poDialu(dir, sid, "no-answer");
    assert.equal((await preberiKlic(sid, dir))?.cakaSporocilo, true);
    // lastnik med klicem preklopi na osebno tajnico: ta veja zastavice ne bere in se vrne pred staro ponastavitvijo
    await savePravila({ nacinKlica: "osebna", imeLastnika: "Ana" }, token, dir);
    const o = (await preberiKlic(sid, dir))?.obrat;
    await voice(dir, { CallSid: sid, From: OD, To: LINA, SpeechResult: "Kdo je to?" }, `/api/voice/turn?obr=${o}`);
    assert.notEqual((await preberiKlic(sid, dir))?.cakaSporocilo, true);
  });
});

describe("pregled 029: prevezava brez cilja ob oddaji v skoku (najdba 9)", { concurrency: 1 }, () => {
  it("stikalo izklopljeno med skoki: ni »Poskušam« brez Diala; izid neodgovor, klic ostane pri Lini", async () => {
    const { dir, token } = await linija();
    const sid = "CA-SK-1";
    await voice(dir, { CallSid: sid, From: OD, To: LINA }, "/api/voice/incoming");
    await voice(dir, { CallSid: sid, From: OD, To: LINA, SpeechResult: "Ana Primer, nisem iz podjetja." }, "/api/voice/turn?obr=1");
    const moznosti: MoznostiKlica = { cakajMs: 0, cakajNaprejMs: 0, cakajBrezGlasuMs: 0 };
    const prvi = await voice(dir, { CallSid: sid, From: OD, To: LINA, SpeechResult: "Rad bi govoril s pravo osebo." }, "/api/voice/turn?obr=2", moznosti);
    assert.match(prvi, /cak=1/, "obrat se ni koncal v prvi zahtevi");
    // obrat je izracunal prevezavo; lastnik vmes izklopi stikalo
    for (let i = 0; i < 500 && (await preberiKlic(sid, dir))?.nujniDogodki === undefined; i += 1) await new Promise((r) => setTimeout(r, 5));
    await savePravila({ prevezaNaZahtevo: false }, token, dir);
    const skok = await voice(dir, { CallSid: sid, From: OD, To: LINA }, "/api/voice/turn?obr=2&cak=1");
    assert.doesNotMatch(skok, /<Dial/);
    assert.match(skok, /Povezava ni uspela/);
    assert.match(skok, /<Gather/);
    const zapis = await preberiKlic(sid, dir);
    assert.deepEqual(zapis?.nujniDogodki?.map((d) => [d.vrsta, d.izid]), [["prevezava", "neodgovor"]]);
  });
});

describe("pregled 029: sporocilo po neuspeli prevezavi (najdba 7)", () => {
  const prej = { sporocilo: "", razlog: "", nujno: true, nujnostZnana: true };
  it("izrek, ki se z »ne/ni« samo zacne, je sporocilo", () => {
    for (const s of ["Ne vem točno, naj me pokliče glede računa.", "Ni panike, samo naj pokliče.", "Nič posebnega, naj me pokliče jutri."]) {
      assert.equal(zajemiTajnico(s, s, prej, "sporocilo")?.sporocilo, s, s);
    }
  });
  it("cela zavrnitev ni sporocilo", () => {
    for (const s of ["Ne.", "Ne, to je vse.", "Nič, hvala.", "Nimam.", "Hvala, nasvidenje.", "Ne hvala."]) {
      assert.equal(zajemiTajnico(s, s, prej, "sporocilo")?.sporocilo, "", s);
    }
  });
});

describe("naloga 2 (A): nujnost samo zaradi neuspele prevezave na zahtevo - brez SMS in brez kvote nujnih", { concurrency: 1 }, () => {
  const SID_RACUNA = `AC${"a".repeat(32)}`;
  const SID_KLJUCA = `SK${"b".repeat(32)}`;
  let sms = 0;
  const lazniTwilio: ZahtevaTwilio = async (url) => {
    if (url.includes("/IncomingPhoneNumbers.json")) return { status: 200, json: { incoming_phone_numbers: [{ phone_number: LINA }] } };
    if (url.endsWith("/Messages.json")) {
      sms += 1;
      return { status: 201, json: { sid: `SM${"c".repeat(32)}` } };
    }
    return { status: 200, json: {} };
  };
  async function zObvestilom(pravila: Record<string, unknown> = {}): Promise<string> {
    const { dir, token } = await linija(pravila);
    await poveziTwilio(token, { sid: SID_RACUNA, kljucSid: SID_KLJUCA, skrivnost: "skrivnost-preizkusa-1234567890" }, dir, lazniTwilio);
    await shraniNujne({ obvesti: true, stevilka: "+38641000009" }, token, dir);
    nastaviZahtevoNujnih(lazniTwilio);
    pozabiObvescene();
    sms = 0;
    return dir;
  }
  async function izrek(dir: string, sid: string, besedilo: string): Promise<string> {
    const o = (await preberiKlic(sid, dir))?.obrat;
    const twiml = await voice(dir, { CallSid: sid, From: OD, To: LINA, SpeechResult: besedilo }, `/api/voice/turn?obr=${o}`);
    await pocakajNujne();
    return twiml;
  }

  it("prosnja po osebi, lastnik ne dvigne, sporocilo: NUJNO ostane, SMS ni poslan, kvota nujnih ni porabljena", async () => {
    const dir = await zObvestilom();
    try {
      const sid = "CA-A2-1";
      await doZahteve(dir, sid, "Rad bi govoril s pravo osebo.");
      await poDialu(dir, sid, "no-answer");
      await izrek(dir, sid, "Naj me pokliče glede računa za oktober.");
      const zapis = await preberiKlic(sid, dir);
      assert.equal(zapis?.order.tajnica?.nujno, true, "oznaka NUJNO ostane (pravilo lastnika)");
      assert.equal(sms, 0, "SMS o nujnem klicu ni poslan");
      await assert.rejects(access(path.join(dir, "nujni-kvota.json")), "kvota nujnih ni porabljena");
      assert.deepEqual(zapis?.nujniDogodki?.map((d) => d.vrsta), ["prevezava"], "brez dogodka obvestila");
    } finally {
      nastaviZahtevoNujnih(null);
    }
  });

  it("kontrola: klicatelj je nujnost povedal - SMS je poslan kot doslej", async () => {
    const dir = await zObvestilom();
    try {
      const sid = "CA-A2-2";
      await doZahteve(dir, sid, "Sporočite direktorju, da je nujno, rabim odgovor danes.");
      await pocakajNujne();
      await poDialu(dir, sid, "no-answer");
      await izrek(dir, sid, "Naj me pokliče glede računa.");
      assert.equal(sms, 1);
    } finally {
      nastaviZahtevoNujnih(null);
    }
  });

  it("prosnja po osebi, neodgovor, nato klicatelj pove nujnost: SMS je poslan", async () => {
    const dir = await zObvestilom();
    try {
      const sid = "CA-A2-3";
      await doZahteve(dir, sid, "Rad bi govoril s pravo osebo.");
      await poDialu(dir, sid, "no-answer");
      await izrek(dir, sid, "Nujno je, naj me pokliče glede računa.");
      assert.equal(sms, 1);
      assert.equal((await preberiKlic(sid, dir))?.nujnoBrezIzjave, undefined);
    } finally {
      nastaviZahtevoNujnih(null);
    }
  });
});

describe("naloga 2 (A): nevarnost po neuspeli prevezavi je povedana nujnost", { concurrency: 1 }, () => {
  it("osebna: »A lahko govorim z njo?«, neodgovor, »Pri nas gori kuhinja« - SMS je poslan", async () => {
    const SID_RACUNA = `AC${"a".repeat(32)}`;
    let sms = 0;
    const lazni: ZahtevaTwilio = async (url) => {
      if (url.includes("/IncomingPhoneNumbers.json")) return { status: 200, json: { incoming_phone_numbers: [{ phone_number: LINA }] } };
      if (url.endsWith("/Messages.json")) return (sms += 1, { status: 201, json: { sid: `SM${"c".repeat(32)}` } });
      return { status: 200, json: {} };
    };
    const { dir, token } = await linija({ nacinKlica: "osebna", imeLastnika: "Ana" });
    await poveziTwilio(token, { sid: SID_RACUNA, kljucSid: `SK${"b".repeat(32)}`, skrivnost: "skrivnost-preizkusa-1234567890" }, dir, lazni);
    await shraniNujne({ obvesti: true, stevilka: "+38641000009" }, token, dir);
    nastaviZahtevoNujnih(lazni);
    pozabiObvescene();
    try {
      const sid = "CA-A2-N";
      await voice(dir, { CallSid: sid, From: OD, To: LINA }, "/api/voice/incoming");
      await voice(dir, { CallSid: sid, From: OD, To: LINA, SpeechResult: "A lahko govorim z njo osebno?" }, "/api/voice/turn?obr=1");
      await poDialu(dir, sid, "no-answer");
      await pocakajNujne();
      assert.equal(sms, 0, "pred povedano nujnostjo ni SMS");
      const o = (await preberiKlic(sid, dir))?.obrat;
      await voice(dir, { CallSid: sid, From: OD, To: LINA, SpeechResult: "Pri nas gori kuhinja" }, `/api/voice/turn?obr=${o}`);
      await pocakajNujne();
      assert.equal(sms, 1);
    } finally {
      nastaviZahtevoNujnih(null);
    }
  });
});

describe("naloga 2 (B3): vsebina ob prosnji po osebi je sporocilo PRED prevezavo", { concurrency: 1 }, () => {
  it("sporociloObProsnji: vsebina ostane, prosnja, pozdrav in gola nujnost ne", () => {
    assert.equal(sporociloObProsnji("Nujno je, povežite me z Ano. Jutrišnji sestanek odpovedujem."), "Jutrišnji sestanek odpovedujem.");
    assert.equal(sporociloObProsnji("Povežite me z Ano."), "");
    assert.equal(sporociloObProsnji("Nujno je. Povežite me z Ano."), "");
    assert.equal(sporociloObProsnji("Dober dan. Tukaj Marko Novak. Rad bi govoril z direktorjem."), "");
    // uvod PRED prosnjo ni sporocilo (ob dvomu Lina po neuspehu vprasa)
    assert.equal(sporociloObProsnji("Dober dan, Marko Novak tukaj. A lahko govorim z Ano?"), "");
    assert.equal(sporociloObProsnji("Ne vem, kako to deluje. Rad bi govoril s šefom."), "");
    assert.equal(sporociloObProsnji("Oprostite, da motim. Lahko govorim z Ano?"), "");
    // vprasanje in stik za prosnjo nista sporocilo
    assert.equal(sporociloObProsnji("Rad bi govoril z direktorjem. Je to mogoče?"), "");
    assert.equal(sporociloObProsnji("Povežite me z Ano. Ali je dosegljiva?"), "");
    assert.equal(sporociloObProsnji("Povežite me z Ano. Moja številka je 041 123 456."), "");
  });

  it("osebna: uvod pred prosnjo ni sporocilo - po neuspehu Lina vprasa po njem", async () => {
    const { dir } = await linija({ nacinKlica: "osebna", imeLastnika: "Ana" });
    const sid = "CA-B3-U";
    await voice(dir, { CallSid: sid, From: OD, To: LINA }, "/api/voice/incoming");
    await voice(dir, { CallSid: sid, From: OD, To: LINA, SpeechResult: "Dober dan, Marko Novak tukaj. A lahko govorim z Ano?" }, "/api/voice/turn?obr=1");
    assert.match(await poDialu(dir, sid, "no-answer"), /Katero sporočilo/);
    assert.equal((await preberiKlic(sid, dir))?.order.tajnica?.sporocilo ?? "", "");
  });

  it("osebna: »Nujno je, povežite me z Ano. Jutrišnji sestanek odpovedujem.« - po neuspehu Lina ne vprasa znova po sporocilu", async () => {
    const { dir } = await linija({ nacinKlica: "osebna", imeLastnika: "Ana" });
    const sid = "CA-B3-O";
    await voice(dir, { CallSid: sid, From: OD, To: LINA }, "/api/voice/incoming");
    const twiml = await voice(dir, { CallSid: sid, From: OD, To: LINA, SpeechResult: "Nujno je, povežite me z Ano. Jutrišnji sestanek odpovedujem." }, "/api/voice/turn?obr=1");
    assert.match(twiml, DIAL_NA_LASTNIKA);
    const nazaj = await poDialu(dir, sid, "no-answer");
    assert.match(nazaj, /Povezava ni uspela/);
    assert.doesNotMatch(nazaj, /Katero sporočilo/);
    const zapis = await preberiKlic(sid, dir);
    assert.match(zapis?.order.tajnica?.sporocilo ?? "", /Jutrišnji sestanek odpovedujem/);
    assert.doesNotMatch(zapis?.order.tajnica?.sporocilo ?? "", /Povežite/);
    assert.equal(zapis?.order.tajnica?.nujno, true);
    assert.equal(zapis?.nujnoBrezIzjave, undefined, "nujnost je povedal klicatelj");
  });

  it("podjetje: »Povežite me z Ano. Jutrišnji sestanek odpovedujem.« - po neuspehu brez vprasanja po sporocilu", async () => {
    const { dir } = await linija();
    const sid = "CA-B3-P";
    assert.match(await doZahteve(dir, sid, "Povežite me z Ano. Jutrišnji sestanek odpovedujem."), DIAL_NA_LASTNIKA);
    const nazaj = await poDialu(dir, sid, "no-answer");
    assert.doesNotMatch(nazaj, /Katero sporočilo/);
    assert.match((await preberiKlic(sid, dir))?.order.tajnica?.sporocilo ?? "", /sestanek odpovedujem/);
  });

  it("gola prosnja (tudi z nujnostjo) nima sporocila: po neuspehu Lina vprasa po njem", async () => {
    const { dir } = await linija({ nacinKlica: "osebna", imeLastnika: "Ana" });
    const sid = "CA-B3-G";
    await voice(dir, { CallSid: sid, From: OD, To: LINA }, "/api/voice/incoming");
    await voice(dir, { CallSid: sid, From: OD, To: LINA, SpeechResult: "Nujno je. Povežite me z Ano." }, "/api/voice/turn?obr=1");
    assert.match(await poDialu(dir, sid, "no-answer"), /Katero sporočilo/);
    assert.equal((await preberiKlic(sid, dir))?.order.tajnica?.nujno, true);
  });
});

describe("naloga 2 (B4): osebna - prvo sporocilo po neuspeli prevezavi ohrani NUJNO", { concurrency: 1 }, () => {
  it("»A lahko govorim z njo?«, neodgovor, sporocilo: nujno in nujnostZnana ostaneta true", async () => {
    const { dir } = await linija({ nacinKlica: "osebna", imeLastnika: "Ana" });
    const sid = "CA-B4-1";
    await voice(dir, { CallSid: sid, From: OD, To: LINA }, "/api/voice/incoming");
    await voice(dir, { CallSid: sid, From: OD, To: LINA, SpeechResult: "A lahko govorim z njo osebno?" }, "/api/voice/turn?obr=1");
    await poDialu(dir, sid, "no-answer");
    const o = (await preberiKlic(sid, dir))?.obrat;
    await voice(dir, { CallSid: sid, From: OD, To: LINA, SpeechResult: "Naj me pokliče glede ključev od stanovanja." }, `/api/voice/turn?obr=${o}`);
    const zapis = await preberiKlic(sid, dir);
    assert.match(zapis?.order.tajnica?.sporocilo ?? "", /ključev/);
    assert.equal(zapis?.order.tajnica?.nujno, true);
    assert.equal(zapis?.order.tajnica?.nujnostZnana, true);
  });
});

describe("naloga 3: CodeRabbit 029b in pregled 029b", { concurrency: 1 }, () => {
  it("CodeRabbit 4: zanikanje cez »morem/moremo/mores« - ni prosnja; pritrdilen primer ostane prosnja", () => {
    for (const ne of ["Ne morem govoriti s pravo osebo.", "ne moremo govoriti s pravo osebo", "Ne moreš govoriti z direktorjem."]) assert.equal(zeliPravoOsebo(ne), false, ne);
    for (const da of ["Morem govoriti s pravo osebo?", "Rad bi govoril s pravo osebo.", "Ne vem, morem govoriti s pravo osebo?"]) assert.equal(zeliPravoOsebo(da), true, da);
  });

  it("CodeRabbit 2: razrez na stavke ne raztrga datuma ali stevil z locili; konec stavka za stevilom se vedno loci", () => {
    const ostane = (t: string) => ocistiSporocilo(sporociloObProsnji(t));
    assert.equal(ostane("Povežite me z Ano. Odpovedujem sestanek 12. 11. 2026."), "Odpovedujem sestanek 12. 11. 2026.");
    assert.equal(ostane("Povežite me z Ano. Sestanek 12. novembra ob 15. uri odpade."), "Sestanek 12. novembra ob 15. uri odpade.");
    assert.equal(ostane("Povežite me z Ano. Znesek 1.250,50 je napačen."), "Znesek 1.250,50 je napačen.");
    // kontrola: »12.« pred veliko zacetnico konca stavek (vprasanje za njim ni sporocilo)
    assert.equal(ostane("Povežite me z Ano. Pridem ob 12. Je to mogoče?"), "Pridem ob 12.");
  });

  it("CodeRabbit 2: datum ostane cel v shranjenem sporocilu (osebna in podjetje)", async () => {
    const o = await linija({ nacinKlica: "osebna", imeLastnika: "Ana" });
    await voice(o.dir, { CallSid: "CA-N3-D1", From: OD, To: LINA }, "/api/voice/incoming");
    assert.match(await voice(o.dir, { CallSid: "CA-N3-D1", From: OD, To: LINA, SpeechResult: "Povežite me z Ano. Odpovedujem sestanek 12. 11. 2026." }, "/api/voice/turn?obr=1"), DIAL_NA_LASTNIKA);
    await poDialu(o.dir, "CA-N3-D1", "no-answer");
    assert.match((await preberiKlic("CA-N3-D1", o.dir))?.order.tajnica?.sporocilo ?? "", /sestanek 12\. 11\. 2026/);
    const p = await linija();
    assert.match(await doZahteve(p.dir, "CA-N3-D2", "Povežite me z Ano. Odpovedujem sestanek 12. 11. 2026."), DIAL_NA_LASTNIKA);
    await poDialu(p.dir, "CA-N3-D2", "no-answer");
    assert.match((await preberiKlic("CA-N3-D2", p.dir))?.order.tajnica?.sporocilo ?? "", /sestanek 12\. 11\. 2026/);
  });

  it("pregled 1: dnevna meja prevezav na zahtevo je najvec lastnikova dnevna meja nujnih", async () => {
    const { dir, token } = await linija();
    await shraniNujne({ omejitevDan: 1 }, token, dir);
    const zdaj = "2026-11-23T10:00:00.000Z";
    assert.equal(await rezervirajKvoto(dir, "Z1", "+38640000201", zdaj, "zahteva"), true);
    assert.equal(await rezervirajKvoto(dir, "Z2", "+38640000202", zdaj, "zahteva"), false, "lastnik dovoli 1 na dan");
    // visja lastnikova meja ne dvigne meje 6
    const b = await linija();
    await shraniNujne({ omejitevDan: 50 }, b.token, b.dir);
    for (let i = 0; i < ZAHTEVA_OMEJITEV_DAN; i += 1) assert.equal(await rezervirajKvoto(b.dir, `ZB${i}`, `+3864000030${i}`, zdaj, "zahteva"), true);
    assert.equal(await rezervirajKvoto(b.dir, "ZB9", "+38640000309", zdaj, "zahteva"), false);
  });

  it("pregled 7: nujnost v nedokoncanem izreku po neuspeli prevezavi pocisti zastavico tudi v shranjenem zapisu", async () => {
    // izrek, ki ga za nedokoncan oznaci sele model (ne hevristika glasu, ki ima svojo pot zapisiDelIzreka)
    const DEL = "Nujno je, gre za račun";
    const razumevanje: ModelRazumevanja = async (_s, vhod) =>
      vhod.endsWith(`Klicatelj: ${DEL}`) ? JSON.stringify({ sporocilo: "", ime: "", vprasanje: null, odgovor: null, confident: true, namen: "nedokoncano" }) : null;
    const { dir } = await linija({ nacinKlica: "osebna", imeLastnika: "Ana" });
    const sid = "CA-N3-P7";
    await voice(dir, { CallSid: sid, From: OD, To: LINA }, "/api/voice/incoming", { razumevanje });
    await voice(dir, { CallSid: sid, From: OD, To: LINA, SpeechResult: "A lahko govorim z njo osebno?" }, "/api/voice/turn?obr=1", { razumevanje });
    await poDialu(dir, sid, "no-answer");
    assert.equal((await preberiKlic(sid, dir))?.nujnoBrezIzjave, true, "pred povedano nujnostjo");
    const o = (await preberiKlic(sid, dir))?.obrat;
    const twiml = await voice(dir, { CallSid: sid, From: OD, To: LINA, SpeechResult: DEL }, `/api/voice/turn?obr=${o}`, { razumevanje });
    assert.match(twiml, /nad=1/, "Lina tiho caka nadaljevanje (pot zapisiSamoIzrek)");
    assert.equal((await preberiKlic(sid, dir))?.nujnoBrezIzjave, undefined);
  });
});
