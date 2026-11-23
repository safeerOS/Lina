/**
 * Naloga C (lastnik 10. 11. 2026): nujni klici na osebni telefon, DVE LOCENI STIKALI, obe privzeto IZKLOPLJENI:
 * »Obvesti me o nujnem klicu« (obvestilo) in »Prevezi nujni klic name« (prevezava). Vklop zahteva vpisano stevilko; stevilka je
 * ZAUPNA (klicatelj je ne izve, ne gre v dnevnik, zapis, zapisek ali odgovor API; na disku sifrirana). Brez odgovora uporabnika
 * klic ostane pri Lini. Brez omrezja: Twilio je nadomescen s preizkusno zahtevo; pravi klic Twilio NI preizkusen.
 * Samo izmisljene stevilke (+386 40 000 000 klicatelj, +1 202 555 0100 osebni telefon, dokumentacijska stevilka).
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { formaCatalog } from "./catalog.ts";
import { nastaviZahtevoNujnih, nujnaPrevezava, pocakajNujne, pozabiObvescene, preberiNujne, shraniNujne, sprozNujnoObvestilo } from "./nujni.server.ts";
import { savePravila } from "./pravila.server.ts";
import { izrekKlicateljaLive, listCalls, preberiKlic, publishLine, recordCaller, zacniKlicLive } from "./service.server.ts";
import { povezi as poveziTwilio, type ZahtevaTwilio } from "./twilio-racun.server.ts";
import { handleVoiceRequest, pocakajOzadjeKlicev } from "./voice.server.ts";

process.env.LINA_LLM = "0";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-nujni-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const temps: string[] = [];

const OD = "+38640000000";
const OSEBNA = "+1 202 555 0100";
const OSEBNA_E164 = "+12025550100";
const SID_RACUNA = `AC${"a".repeat(32)}`;
const SID_KLJUCA = `SK${"b".repeat(32)}`;
const SKRIVNOST = "skrivnost-preizkusa-1234567890";

type Zahtevek = { url: string; method: string; body: string };
let zahtevki: Zahtevek[] = [];
let sporocilaKonzole: string[] = [];
const izvirnaKonzola = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };

const lazniTwilio: ZahtevaTwilio = async (url, init) => {
  zahtevki.push({ url, method: init.method, body: init.body ?? "" });
  if (url.includes("/IncomingPhoneNumbers.json")) return { status: 200, json: { incoming_phone_numbers: [{ phone_number: "+38615550123" }] } };
  if (url.endsWith("/Messages.json")) return { status: 201, json: { sid: `SM${"c".repeat(32)}` } };
  return { status: 200, json: {} };
};

beforeEach(() => {
  zahtevki = [];
  sporocilaKonzole = [];
  nastaviZahtevoNujnih(lazniTwilio);
  pozabiObvescene();
  for (const ime of ["log", "info", "warn", "error", "debug"] as const) {
    console[ime] = (...args: unknown[]) => {
      sporocilaKonzole.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
  }
});

afterEach(async () => {
  Object.assign(console, izvirnaKonzola);
  nastaviZahtevoNujnih(null);
  delete process.env.TWILIO_AUTH_TOKEN;
  await pocakajNujne();
  await pocakajOzadjeKlicev();
  while (temps.length) {
    const dir = temps.pop();
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

async function linija(): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  temps.push(dir);
  const token = await setupOwner("geslo-test-1234", dir);
  await publishLine({ open: true, brezGlasu: true, catalog: formaCatalog() }, { token }, dir);
  await savePravila({ prevzem: "vsi", dovoljenePredpone: "1" }, token, dir);
  return { dir, token };
}

async function poveziRacun(dir: string, token: string): Promise<void> {
  await poveziTwilio(token, { sid: SID_RACUNA, kljucSid: SID_KLJUCA, skrivnost: SKRIVNOST }, dir, lazniTwilio);
  zahtevki = [];
}

let stevec = 0;
async function potek(dir: string, izreki: string[]) {
  const sid = `CA-OSE-${(stevec += 1)}`;
  const o: Awaited<ReturnType<typeof recordCaller>>[] = [await recordCaller({ callSid: sid, from: OD, text: "" }, dir)];
  for (const izrek of izreki) o.push(await recordCaller({ callSid: sid, from: OD, text: izrek }, dir));
  await pocakajNujne();
  return { sid, o };
}

/** Prvi zapisek klica: <zapiski>/<mapa klica>/zapisek.md (lastnik 22. 11. 2026) ali stara ravna datoteka. */
function prviZapisek(dir: string): string {
  const mapa = path.join(dir, "zapiski");
  const pot = path.join(mapa, readdirSync(mapa)[0]);
  return readFileSync(statSync(pot).isDirectory() ? path.join(pot, "zapisek.md") : pot, "utf8");
}

/** Vse datoteke v mapi podatkov (rekurzivno), razen imenovanih. */
function vseDatoteke(dir: string, razen: string[] = []): Array<{ pot: string; vsebina: string }> {
  const izhod: Array<{ pot: string; vsebina: string }> = [];
  const hodi = (mapa: string) => {
    for (const ime of readdirSync(mapa)) {
      const pot = path.join(mapa, ime);
      if (statSync(pot).isDirectory()) hodi(pot);
      else if (!razen.includes(ime)) izhod.push({ pot, vsebina: readFileSync(pot).toString("utf8") });
    }
  };
  hodi(dir);
  return izhod;
}

/** Stevilke osebnega telefona (v kateri koli obliki zapisa) ni v besedilu. */
function brezStevilkeOsebnega(besedilo: string): boolean {
  return !besedilo.replace(/[\s()\-.]/g, "").includes("12025550100");
}

const NUJNO = ["Ana Primer, nisem iz podjetja.", "Sporočite direktorju, da je nujno, rabim odgovor danes."];

describe("naloga C: nastavitve (privzeto izklopljeno, stevilka sifrirana in zaupna)", { concurrency: 1 }, () => {
  it("obe stikali sta privzeto izklopljeni, stevilke ni", async () => {
    const { token, dir } = await linija();
    const s = await preberiNujne(token, dir);
    assert.deepEqual({ obvesti: s.obvesti, prevezi: s.prevezi, stevilkaVpisana: s.stevilkaVpisana, opozorilo: s.opozorilo }, { obvesti: false, prevezi: false, stevilkaVpisana: false, opozorilo: "" });
  });

  it("vklop brez stevilke je napaka z razlago (vsako stikalo posebej)", async () => {
    const { token, dir } = await linija();
    await assert.rejects(shraniNujne({ obvesti: true }, token, dir), /številko osebnega telefona/);
    await assert.rejects(shraniNujne({ prevezi: true }, token, dir), /številko osebnega telefona/);
    const s = await preberiNujne(token, dir);
    assert.equal(s.obvesti, false);
    assert.equal(s.prevezi, false);
  });

  it("neveljavne stevilke: 112, 090, premijska, brez + ali javna stevilka podjetja", async () => {
    const { token, dir } = await linija();
    for (const stevilka of ["112", "+386 90 123 456", "+49 900 123 4567", "040 000 000", "+386 1 555 09 00"]) {
      await assert.rejects(shraniNujne({ obvesti: true, stevilka }, token, dir), Error, stevilka);
    }
    assert.equal((await preberiNujne(token, dir)).stevilkaVpisana, false);
  });

  it("stevilka je sifrirana na disku, odjemalec dobi samo »vpisana«; vklop prevezave pokaze opozorilo o posredniku", async () => {
    const { token, dir } = await linija();
    const s = await shraniNujne({ obvesti: true, prevezi: true, stevilka: OSEBNA, cakanjeSek: 25 }, token, dir);
    assert.equal(s.stevilkaVpisana, true);
    assert.equal(s.obvesti, true);
    assert.equal(s.prevezi, true);
    assert.equal(s.cakanjeSek, 25);
    assert.match(s.opozorilo, /posrednik[^.]*obračuna/);
    assert.equal(brezStevilkeOsebnega(JSON.stringify(s)), true);
    assert.equal(brezStevilkeOsebnega(JSON.stringify(await preberiNujne(token, dir))), true);
    assert.equal(brezStevilkeOsebnega(readFileSync(path.join(dir, "nujni.json"), "utf8")), true);
    // stevilka se ne pojavi v nobeni drugi datoteki podatkov (razen sifrirane)
    for (const d of vseDatoteke(dir, ["nujni.json", ".kljuc"])) assert.equal(brezStevilkeOsebnega(d.vsebina), true, d.pot);
    // nova stikala brez nove stevilke ohranijo staro; izklop ne zbrise stevilke
    const izklop = await shraniNujne({ obvesti: false, prevezi: false }, token, dir);
    assert.equal(izklop.stevilkaVpisana, true);
    assert.equal(izklop.obvesti, false);
  });

  it("pozabi stevilko: izbrise jo in izklopi obe stikali", async () => {
    const { token, dir } = await linija();
    await shraniNujne({ obvesti: true, prevezi: true, stevilka: OSEBNA }, token, dir);
    const s = await shraniNujne({ obvesti: false, prevezi: false, pozabiStevilko: true }, token, dir);
    assert.deepEqual({ o: s.obvesti, p: s.prevezi, v: s.stevilkaVpisana }, { o: false, p: false, v: false });
    assert.equal(await nujnaPrevezava(dir), null);
  });

  it("rocno popravljena datoteka (stikalo brez stevilke) ne vklopi ničesar", async () => {
    const { token, dir } = await linija();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(dir, "nujni.json"), JSON.stringify({ obvesti: true, prevezi: true, cakanjeSek: 20 }));
    const s = await preberiNujne(token, dir);
    assert.equal(s.obvesti, false);
    assert.equal(s.prevezi, false);
    assert.equal(await nujnaPrevezava(dir), null);
  });
});

describe("naloga C: obvestilo o nujnem klicu", { concurrency: 1 }, () => {
  it("stikalo izklopljeno -> nic ne gre na osebno stevilko (tudi ce je stevilka vpisana)", async () => {
    const { dir, token } = await linija();
    await poveziRacun(dir, token);
    await shraniNujne({ obvesti: false, prevezi: false, stevilka: OSEBNA }, token, dir);
    const { o } = await potek(dir, NUJNO);
    assert.equal(o[o.length - 1].call.order.tajnica?.nujno, true);
    assert.equal(zahtevki.length, 0);
    assert.equal((await preberiKlic(o[0].call.callSid, dir))?.nujniDogodki, undefined);
  });

  it("stikalo vklopljeno: eno obvestilo na klic, stalna vsebina; zapis ima cas in izid brez stevilke", async () => {
    const { dir, token } = await linija();
    await poveziRacun(dir, token);
    await shraniNujne({ obvesti: true, stevilka: OSEBNA }, token, dir);
    const { sid, o } = await potek(dir, NUJNO);
    const sms = zahtevki.filter((z) => z.url.endsWith("/Messages.json"));
    assert.equal(sms.length, 1);
    const telo = new URLSearchParams(sms[0].body);
    assert.equal(telo.get("To"), OSEBNA_E164);
    assert.equal(telo.get("From"), "+38615550123");
    assert.equal(telo.get("Body"), "Lina: nujen klic. Podrobnosti so v zapisniku.");
    // vsebina SMS nima klicatelja, njegove stevilke ali sporocila
    assert.doesNotMatch(telo.get("Body") ?? "", /Ana|Primer|40000000|direktor/);
    const zapis = await preberiKlic(sid, dir);
    assert.equal(zapis?.nujniDogodki?.length, 1);
    assert.equal(zapis?.nujniDogodki?.[0].vrsta, "obvestilo");
    assert.equal(zapis?.nujniDogodki?.[0].izid, "poslano");
    assert.ok(Number.isFinite(Date.parse(zapis?.nujniDogodki?.[0].cas ?? "")));
    // zapisek je prepisan z dogodkom, brez stevilke
    const md = prviZapisek(dir);
    assert.match(md, /Nujni klic - Obvestilo na osebni telefon \(.*\): poslano/);
    assert.match(md, /^NUJNO: da$/m);
    assert.equal(o[o.length - 1].call.status, "zakljucen");
    // se en obrat istega klica ne poslje drugega obvestila
    assert.equal(zahtevki.filter((z) => z.url.endsWith("/Messages.json")).length, 1);
  });

  it("navaden klic (brez nujnosti) ne sprozi obvestila", async () => {
    const { dir, token } = await linija();
    await poveziRacun(dir, token);
    await shraniNujne({ obvesti: true, stevilka: OSEBNA }, token, dir);
    await potek(dir, ["Ana Primer, nisem iz podjetja.", "Sporočite direktorju, da me pokliče.", "Ne."]);
    assert.equal(zahtevki.length, 0);
  });

  it("napaka Twilio: izid »napaka« v zapisu, klic se ne izgubi, stevilke ni nikjer", async () => {
    const { dir, token } = await linija();
    await poveziRacun(dir, token);
    await shraniNujne({ obvesti: true, stevilka: OSEBNA }, token, dir);
    nastaviZahtevoNujnih(async (url) => {
      zahtevki.push({ url, method: "POST", body: "" });
      throw new Error(`omrezna napaka za ${OSEBNA_E164}`);
    });
    const { sid, o } = await potek(dir, NUJNO);
    assert.equal(o[o.length - 1].call.status, "zakljucen");
    const zapis = await preberiKlic(sid, dir);
    assert.equal(zapis?.nujniDogodki?.[0].izid, "napaka");
    assert.equal(zapis?.order.tajnica?.nujno, true);
    for (const d of vseDatoteke(dir, ["nujni.json", ".kljuc"])) assert.equal(brezStevilkeOsebnega(d.vsebina), true, d.pot);
  });

  it("brez racuna Twilio: izid »napaka«, nujen klic je vseeno oznacen", async () => {
    const { dir, token } = await linija();
    await shraniNujne({ obvesti: true, stevilka: OSEBNA }, token, dir);
    const { sid } = await potek(dir, NUJNO);
    const zapis = await preberiKlic(sid, dir);
    assert.equal(zapis?.nujniDogodki?.[0].izid, "napaka");
    assert.equal(zapis?.order.tajnica?.nujno, true);
  });

  it("stevilke osebnega telefona ni v nobenem dnevniku, zapisu, zapisku, seznamu klicev ali izpisu konzole", async () => {
    const { dir, token } = await linija();
    await poveziRacun(dir, token);
    await shraniNujne({ obvesti: true, prevezi: false, stevilka: OSEBNA }, token, dir);
    await potek(dir, NUJNO);
    for (const d of vseDatoteke(dir, ["nujni.json", ".kljuc"])) assert.equal(brezStevilkeOsebnega(d.vsebina), true, d.pot);
    assert.equal(brezStevilkeOsebnega(JSON.stringify(await listCalls({ token }, dir))), true);
    assert.equal(brezStevilkeOsebnega(sporocilaKonzole.join("\n")), true);
    assert.ok(vseDatoteke(dir).some((d) => d.pot.endsWith("nujni.json")));
  });
});

describe("naloga C: prevezava nujnega klica (Twilio Dial) in vrnitev k Lini", { concurrency: 1 }, () => {
  async function voice(dir: string, params: Record<string, string>, pot: string): Promise<string> {
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
    );
    return odgovor.text();
  }

  async function doNujnega(dir: string, sid: string): Promise<string> {
    await voice(dir, { CallSid: sid, From: OD, To: "+38615550123" }, "/api/voice/incoming");
    await voice(dir, { CallSid: sid, From: OD, To: "+38615550123", SpeechResult: NUJNO[0] }, "/api/voice/turn?obr=1");
    return voice(dir, { CallSid: sid, From: OD, To: "+38615550123", SpeechResult: NUJNO[1] }, "/api/voice/turn?obr=2");
  }

  it("stikalo izklopljeno: Lina nujni klic samo oznaci (brez Dial), klic se zakljuci pri Lini", async () => {
    const { dir, token } = await linija();
    await shraniNujne({ obvesti: false, prevezi: false, stevilka: OSEBNA }, token, dir);
    const twiml = await doNujnega(dir, "CA-VOI-1");
    assert.doesNotMatch(twiml, /<Dial/);
    assert.doesNotMatch(twiml, /12025550100/);
    const zapis = await preberiKlic("CA-VOI-1", dir);
    assert.equal(zapis?.order.tajnica?.nujno, true);
    assert.equal(zapis?.status, "zakljucen");
    assert.equal(zapis?.nujniDogodki, undefined);
  });

  it("stikalo vklopljeno: klicatelj slisi samo »Poskusam vas povezati«; Dial gre na osebno stevilko, ki je v govoru ni", async () => {
    const { dir, token } = await linija();
    await shraniNujne({ prevezi: true, stevilka: OSEBNA, cakanjeSek: 15 }, token, dir);
    const twiml = await doNujnega(dir, "CA-VOI-2");
    // Kasneje dodano: timeLimit, answerOnBridge in potrditev s tipko 1 (Number url) - atributi za action so dovoljeni.
    assert.match(twiml, /<Dial timeout="15" method="POST" action="[^"]*nujni=1&amp;obr=\d+"[^>]*>/);
    assert.match(twiml, new RegExp(`<Number [^>]*>${OSEBNA_E164.replace("+", "\\+")}</Number>`));
    const predDial = twiml.slice(0, twiml.indexOf("<Dial"));
    assert.match(predDial, /Poskušam vas povezati\./);
    assert.doesNotMatch(predDial, /12025550100|202 555 0100|Sporočilo za direktorja|nujna/);
    assert.doesNotMatch(twiml, /<Gather/);
    const zapis = await preberiKlic("CA-VOI-2", dir);
    assert.equal(zapis?.status, "v-teku");
    assert.deepEqual(zapis?.nujniDogodki?.map((d) => [d.vrsta, d.izid]), [["prevezava", "poskus"]]);
    // v dnevniku klica je samo stalni stavek, ne stevilka
    assert.equal(brezStevilkeOsebnega(JSON.stringify(zapis)), true);
  });

  it("uporabnik se ne oglasi (no-answer): klic ostane pri Lini - stavek, oznaka Nujno, sporocilo; dogodek ima cas in izid", async () => {
    const { dir, token } = await linija();
    await shraniNujne({ prevezi: true, stevilka: OSEBNA }, token, dir);
    await doNujnega(dir, "CA-VOI-3");
    const zapis0 = await preberiKlic("CA-VOI-3", dir);
    const twiml = await voice(
      dir,
      { CallSid: "CA-VOI-3", From: OD, To: "+38615550123", CallStatus: "in-progress", DialCallStatus: "no-answer" },
      `/api/voice/turn?nujni=1&obr=${zapis0?.obrat}`,
    );
    assert.match(twiml, /Povezava ni uspela\. Zadevo sem zapisala kot nujno\./);
    assert.doesNotMatch(twiml, /12025550100/);
    assert.doesNotMatch(twiml, /poklic[^<]*direktor|direktor[^<]*poklic/i);
    const zapis = await preberiKlic("CA-VOI-3", dir);
    assert.equal(zapis?.order.tajnica?.nujno, true);
    assert.match(zapis?.order.tajnica?.sporocilo ?? "", /direktorju/);
    assert.deepEqual(zapis?.nujniDogodki?.map((d) => [d.vrsta, d.izid]), [["prevezava", "neodgovor"]]);
    assert.equal(zapis?.status, "zakljucen");
    const md = prviZapisek(dir);
    assert.match(md, /^NUJNO: da$/m);
    assert.match(md, /Nujni klic - Prevezava na osebni telefon \(.*\): uporabnik se ni oglasil, klic je ostal pri Lini/);
    for (const d of vseDatoteke(dir, ["nujni.json", ".kljuc"])) assert.equal(brezStevilkeOsebnega(d.vsebina), true, d.pot);
    assert.equal(brezStevilkeOsebnega(sporocilaKonzole.join("\n")), true);
  });

  it("izid prevezave se obdela tudi, ce je linija vmes zaprta (ne linijaZaprta)", async () => {
    const { dir, token } = await linija();
    await shraniNujne({ prevezi: true, stevilka: OSEBNA }, token, dir);
    await doNujnega(dir, "CA-VOI-60");
    await publishLine({ open: false }, { token }, dir);
    const o = (await preberiKlic("CA-VOI-60", dir))?.obrat;
    const twiml = await voice(dir, { CallSid: "CA-VOI-60", From: OD, To: "+38615550123", DialCallStatus: "no-answer" }, `/api/voice/turn?nujni=1&obr=${o}`);
    assert.match(twiml, /Povezava ni uspela/);
    assert.deepEqual((await preberiKlic("CA-VOI-60", dir))?.nujniDogodki?.map((d) => [d.vrsta, d.izid]), [["prevezava", "neodgovor"]]);
  });

  it("zasedeno ali napaka (busy, failed) je enako kot brez odgovora; uporabnik se oglasi (completed): klic se zakljuci, izid »oglasil«", async () => {
    const { dir, token } = await linija();
    await shraniNujne({ prevezi: true, stevilka: OSEBNA }, token, dir);
    for (const [i, stanje] of (["busy", "failed"] as const).entries()) {
      const sid = `CA-VOI-4${i}`;
      await doNujnega(dir, sid);
      const o = (await preberiKlic(sid, dir))?.obrat;
      const twiml = await voice(dir, { CallSid: sid, From: OD, To: "+38615550123", DialCallStatus: stanje }, `/api/voice/turn?nujni=1&obr=${o}`);
      assert.match(twiml, /Povezava ni uspela/);
      assert.equal((await preberiKlic(sid, dir))?.nujniDogodki?.[0].izid, "neodgovor");
    }
    const sid = "CA-VOI-45";
    await doNujnega(dir, sid);
    const o = (await preberiKlic(sid, dir))?.obrat;
    // »Oglasil« samo ob pritisku 1 na osebnem telefonu (service.server.ts: odzivnik ga ne pritisne, trajanje ni dokaz).
    const brezTipke = await voice(dir, { CallSid: sid, From: OD, To: "+38615550123", DialCallStatus: "completed" }, `/api/voice/turn?nujni=1&obr=${o}`);
    assert.match(brezTipke, /Povezava ni uspela/);
    assert.equal((await preberiKlic(sid, dir))?.nujniDogodki?.[0].izid, "neodgovor", "completed brez tipke 1 = odzivnik");
    // Nova linija: omejitev prevezav na klicatelja (izid »omejeno«) bi sicer ustavila cetrti nujni klic iste stevilke.
    const { dir: dir2, token: token2 } = await linija();
    await shraniNujne({ prevezi: true, stevilka: OSEBNA }, token2, dir2);
    const sid2 = "CA-VOI-46";
    await doNujnega(dir2, sid2);
    const o2 = (await preberiKlic(sid2, dir2))?.obrat;
    assert.equal(await voice(dir2, { CallSid: "CA-VOI-46-NOGA", Digits: "1" }, `/api/voice/potrdi-tipka?sid=${sid2}`), '<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    const twiml = await voice(dir2, { CallSid: sid2, From: OD, To: "+38615550123", DialCallStatus: "completed" }, `/api/voice/turn?nujni=1&obr=${o2}`);
    assert.match(twiml, /<Hangup\/>/);
    const zapis = await preberiKlic(sid2, dir2);
    assert.equal(zapis?.status, "zakljucen");
    assert.equal(zapis?.nujniDogodki?.[0].izid, "oglasil");
    assert.equal(zapis?.order.tajnica?.nujno, true);
  });

  it("zanka: klic je prisel s stevilke osebnega telefona (ForwardedFrom) ali na njo -> brez prevezave, samo oznaka", async () => {
    const { dir, token } = await linija();
    await shraniNujne({ prevezi: true, stevilka: OSEBNA }, token, dir);
    assert.equal(await nujnaPrevezava(dir, [OSEBNA_E164]), null);
    assert.equal(await nujnaPrevezava(dir, [OSEBNA]), null);
    assert.notEqual(await nujnaPrevezava(dir, [OD]), null);
    const sid = "CA-VOI-6";
    await voice(dir, { CallSid: sid, From: OD, To: "+38615550123", ForwardedFrom: OSEBNA_E164 }, "/api/voice/incoming");
    await voice(dir, { CallSid: sid, From: OD, To: "+38615550123", ForwardedFrom: OSEBNA_E164, SpeechResult: NUJNO[0] }, "/api/voice/turn?obr=1");
    const twiml = await voice(dir, { CallSid: sid, From: OD, To: "+38615550123", ForwardedFrom: OSEBNA_E164, SpeechResult: NUJNO[1] }, "/api/voice/turn?obr=2");
    assert.doesNotMatch(twiml, /<Dial/);
    assert.equal((await preberiKlic(sid, dir))?.order.tajnica?.nujno, true);
  });

  it("prevezava samo enkrat na klic; navaden klic se ne prevezuje", async () => {
    const { dir, token } = await linija();
    await shraniNujne({ prevezi: true, stevilka: OSEBNA }, token, dir);
    const sid = "CA-VOI-7";
    await voice(dir, { CallSid: sid, From: OD }, "/api/voice/incoming");
    await voice(dir, { CallSid: sid, From: OD, SpeechResult: "Jana Primer, nisem iz podjetja." }, "/api/voice/turn?obr=1");
    const navaden = await voice(dir, { CallSid: sid, From: OD, SpeechResult: "Sporočite direktorju, da me pokliče." }, "/api/voice/turn?obr=2");
    assert.doesNotMatch(navaden, /<Dial/);
    // Lina je vprasala »Ali je zadeva nujna?«; odgovor »Da.« sprozi prevezavo (nujnost je povedal klicatelj na vprasanje)
    const nujen = await voice(dir, { CallSid: sid, From: OD, SpeechResult: "Da." }, "/api/voice/turn?obr=3");
    assert.match(nujen, /<Dial/);
    assert.equal((await preberiKlic(sid, dir))?.nujnoPrevezano, true);
  });
});

describe("naloga C: pot Live in prvi izrek", { concurrency: 1 }, () => {
  it("pot Live: nujnost iz izreka klicatelja da oznako in (ob vklopljenem stikalu) obvestilo; brez stikala nic", async () => {
    const { dir, token } = await linija();
    await poveziRacun(dir, token);
    await shraniNujne({ obvesti: true, stevilka: OSEBNA }, token, dir);
    const sid = "CA-LIVE-1";
    await zacniKlicLive({ callSid: sid, from: OD, pozdrav: "Dober dan, tukaj Lina, pomočnica z umetno inteligenco." }, dir);
    await izrekKlicateljaLive(sid, "Ana Primer, nisem iz podjetja.", dir);
    await izrekKlicateljaLive(sid, "Sporočite direktorju, da je nujno, rabim odgovor danes.", dir);
    await pocakajNujne();
    const zapis = await preberiKlic(sid, dir);
    assert.equal(zapis?.order.tajnica?.nujno, true);
    assert.equal(zapis?.nujniDogodki?.[0].izid, "poslano");
    assert.equal(zahtevki.filter((z) => z.url.endsWith("/Messages.json")).length, 1);
    // stikalo izklopljeno: oznaka je, obvestila ni
    await shraniNujne({ obvesti: false }, token, dir);
    zahtevki = [];
    pozabiObvescene();
    const sid2 = "CA-LIVE-2";
    await zacniKlicLive({ callSid: sid2, from: OD, pozdrav: "Dober dan, tukaj Lina, pomočnica z umetno inteligenco." }, dir);
    await izrekKlicateljaLive(sid2, "Jana Primer, nisem iz podjetja.", dir);
    await izrekKlicateljaLive(sid2, "Sporočite direktorju, da je nujno, rabim odgovor danes.", dir);
    await pocakajNujne();
    assert.equal((await preberiKlic(sid2, dir))?.order.tajnica?.nujno, true);
    assert.equal(zahtevki.length, 0);
  });

  it("prvi izrek po pozdravu je ze sporocilo (brez imena): Lina zapise sporocilo, ime je »ni podatka«, ne vprasa znova", async () => {
    const { dir } = await linija();
    const { o } = await potek(dir, ["Sporočite direktorju, da naj preveri pogodbo.", "Ne."]);
    assert.match(o[1].reply, /Sporočilo za direktorja sem zapisala\. Ali je zadeva nujna\?/);
    const koncni = o[2];
    assert.equal(koncni.call.status, "zakljucen");
    assert.match(koncni.call.order.tajnica?.sporocilo ?? "", /pogodbo/);
    assert.equal(koncni.call.order.podjetjeKlicatelja, "");
    for (const x of o.slice(1)) assert.doesNotMatch(x.reply, /ime in priimek|podjetj/i);
  });
});

describe("popravek po pregledu kode: obvestilo se rezervira pred asinhronim delom", { concurrency: 1 }, () => {
  it("dva hitra sprozitva za isti klic poslanega SMS ne podvojita", async () => {
    const { dir, token } = await linija();
    await shraniNujne({ obvesti: true, stevilka: OSEBNA }, token, dir);
    await poveziRacun(dir, token);
    const klic = {
      callSid: "CA-DUP-1",
      vaja: false,
      order: { tajnica: { sporocilo: "Sporocilo.", razlog: "", nujno: true, nujnostZnana: true } },
      nujniDogodki: undefined,
    } as unknown as Parameters<typeof sprozNujnoObvestilo>[1];
    const zapisi = async () => undefined;
    sprozNujnoObvestilo(dir, klic, zapisi);
    sprozNujnoObvestilo(dir, klic, zapisi);
    await pocakajNujne();
    assert.equal(zahtevki.filter((z) => z.url.endsWith("/Messages.json")).length, 1);
  });
});
