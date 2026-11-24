/** Preverba najdb H2, H4, H5, H8/I2 (del B). fs-stevec.ts MORA biti prvi uvoz. */
import { ponastavi, st } from "./fs-stevec.ts";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { shraniNujne } from "./nujni.server.ts";
import { listVrzeli, savePravila } from "./pravila.server.ts";
import {
  izrekKlicateljaLive,
  odgovorLinaLive,
  prevezavaIzid,
  preberiKlic,
  recordCaller,
  steviloVrstSida,
  zabeleziSprejem,
  zacniKlicLive,
  zapisiDelIzreka,
  vrzelLive,
} from "./service.server.ts";
import { povezi as poveziTwilio, type ZahtevaTwilio } from "./twilio-racun.server.ts";
import { pozabiSprejemKlicev } from "./twilio-sprejem.server.ts";
import { handleVoiceRequest } from "./voice.server.ts";
import { writeJson } from "./store.server.ts";
import { dokaz, linija, ms, OD, voice } from "./preverba-skupno.ts";

let sidSt = 0;
/** Torek 24. 11. 2026 ob 10.00 v Ljubljani: znotraj privzetega urnika prevezave (pon-pet 07.00-15.00). */
const DELOVNI = new Date("2026-11-24T10:00:00+01:00");
const novSid = () => `CA${(++sidSt).toString(16).padStart(32, "0")}`;
const delta = (f: () => Promise<unknown>) => async () => {
  ponastavi();
  await f();
  return { beri: st.beri, pisi: st.pisi };
};

describe("H2 celotna knjiga pri vsakem zapisu", { concurrency: 1 }, () => {
  it("stevilo branj in pisanj calls.json na operacijo (1 klic v knjigi)", async () => {
    const { dir } = await linija();
    const sid = novSid();
    await recordCaller({ callSid: sid, from: OD, text: "" }, dir);
    const izidi: Record<string, { beri: number; pisi: number }> = {};
    izidi["recordCaller obrat"] = await delta(() => recordCaller({ callSid: sid, text: "Ana Primer, nisem iz podjetja." }, dir))();
    izidi["zapisiDelIzreka"] = await delta(() => zapisiDelIzreka({ callSid: sid, izrek: "ali imate", zdruzeno: "ali imate" }, dir))();
    const live = novSid();
    await zacniKlicLive({ callSid: live, from: OD, pozdrav: "Dober dan." }, dir);
    izidi["izrekKlicateljaLive"] = await delta(() => izrekKlicateljaLive(live, "Ana Primer, nisem iz podjetja.", dir))();
    izidi["odgovorLinaLive"] = await delta(() => odgovorLinaLive(live, "Zapisala sem.", dir))();
    izidi["zabeleziSprejem (neznan sid)"] = await delta(() => zabeleziSprejem("neznan", dir))();
    for (const [k, v] of Object.entries(izidi)) dokaz(`H2 ${k}: branj calls.json ${v.beri}, pisanj ${v.pisi}`);
    assert.ok(izidi["zapisiDelIzreka"].beri >= 2 && izidi["zapisiDelIzreka"].pisi === 1, "zapisiDelIzreka: 2 branji in 1 pisanje celotne knjige");
  });

  it("rast: knjiga nima brisanja; cas operacije raste s stevilom klicev; globalna vrsta po mapi zadrzi tudi tuj klic", async () => {
    const { dir } = await linija();
    const sid = novSid();
    await recordCaller({ callSid: sid, from: OD, text: "" }, dir);
    await recordCaller({ callSid: sid, text: "Ana Primer, nisem iz podjetja." }, dir);
    const knjiga = JSON.parse(readFileSync(path.join(dir, "calls.json"), "utf8")) as Record<string, unknown>;
    const vzorec = knjiga[sid];
    dokaz(`H2 en klic s 2 obrati v calls.json: ${JSON.stringify(vzorec).length} B`);
    for (const n of [500, 2000, 5000]) {
      const velika: Record<string, unknown> = {};
      for (let i = 0; i < n; i += 1) velika[`CA${String(i).padStart(32, "0")}`] = vzorec;
      velika[sid] = vzorec;
      await writeJson(dir, "calls.json", velika);
      const velikost = statSync(path.join(dir, "calls.json")).size;
      const t0 = process.hrtime.bigint();
      await zapisiDelIzreka({ callSid: sid, izrek: "ali imate", zdruzeno: "ali imate" }, dir);
      const dt = ms(t0);
      // 20 hkrati za RAZLICNE klice: vsi v isti vrsti knjige; cas nepovezanega klica med njimi
      const hkrati = Array.from({ length: 20 }, (_, i) => zapisiDelIzreka({ callSid: sid, izrek: `del ${i}`, zdruzeno: `del ${i}` }, dir));
      const tuj = novSid();
      const t1 = process.hrtime.bigint();
      const tujIzid = recordCaller({ callSid: tuj, from: OD, text: "" }, dir).then(() => ms(t1));
      await Promise.all(hkrati);
      const cakal = await tujIzid;
      const knjigaPo = JSON.parse(readFileSync(path.join(dir, "calls.json"), "utf8")) as Record<string, unknown>;
      dokaz(`H2 knjiga ${n} klicev (${(velikost / 1024 / 1024).toFixed(2)} MB): zapisiDelIzreka ${dt.toFixed(0)} ms; nov klic za 20 zapisi v vrsti: ${cakal.toFixed(0)} ms; klicev po: ${Object.keys(knjigaPo).length} (brez brisanja)`);
      assert.ok(Object.keys(knjigaPo).length >= n);
    }
  });

  it("/delni se NE dotakne calls.json (najdba H2 pripisuje /delni zapis delnega izreka); doda vrstico v delni-rezultati.jsonl", async () => {
    const { dir } = await linija();
    const sid = novSid();
    await voice(dir, { CallSid: sid, From: OD, To: "+38615550123" }, "/api/voice/incoming");
    ponastavi();
    for (let i = 0; i < 20; i += 1) {
      await voice(dir, { CallSid: sid, From: OD, UnstableSpeechResult: `del ${i}`, SequenceNumber: String(i) }, `/api/voice/delni?i=${i}`);
    }
    dokaz(`H2 /delni x20: branj calls.json ${st.beri}, pisanj ${st.pisi}, vrstic v jsonl ${st.jsonlPisi}`);
    assert.equal(st.beri + st.pisi, 0);
    assert.equal(st.jsonlPisi, 20);
  });
});

describe("H4 zabeleziSprejem in vrste za poljuben sid", { concurrency: 1 }, () => {
  it("funkcija: 2000 razlicnih neznanih sid -> 2000 vnosov v vrsteSida, ki se ne pocistijo, in 2000 branj knjige", async () => {
    const { dir } = await linija();
    await recordCaller({ callSid: novSid(), from: OD, text: "" }, dir);
    const pred = steviloVrstSida();
    ponastavi();
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 2000; i += 1) assert.equal(await zabeleziSprejem(`nap${i}`, dir), false);
    const po = steviloVrstSida();
    dokaz(`H4 zabeleziSprejem x2000: vrst pred ${pred}, po ${po} (prirastek ${po - pred}); branj calls.json ${st.beri}; ${ms(t0).toFixed(0)} ms`);
    assert.ok(po - pred >= 2000);
    assert.equal(st.beri, 2000);
  });

  it("webhook: podpisan zahtevek z drugim sid v poizvedbi kot CallSid (legitimno za klicano nogo) gre skozi; vrste rastejo", async () => {
    const { dir } = await linija();
    const pred = steviloVrstSida();
    for (let i = 0; i < 200; i += 1) {
      const t = await voice(dir, { CallSid: "NOGA-1", Digits: "1" }, `/api/voice/potrdi-tipka?sid=izmisljen${i}`);
      assert.match(t, /Hangup/);
    }
    dokaz(`H4 webhook (podpisan) x200 z razlicnim sid: prirastek vrst ${steviloVrstSida() - pred}`);
    assert.ok(steviloVrstSida() - pred >= 200);
  });

  it("nepodpisana pot (preizkusni racun, vhodni klic potrjen prek API): sid v poizvedbi ni podpisan, napadalec ga dolocas sam", async () => {
    const SID = `AC${"a".repeat(32)}`;
    const KLJUC = `SK${"b".repeat(32)}`;
    const KLIC = `CA${"e".repeat(32)}`;
    const ZA = "+12025550100";
    const NASLOV = "https://lina.primer/api/voice/incoming";
    const lazni: ZahtevaTwilio = async (url, init) => {
      if (init.method === "GET" && /\/Calls\/CA[0-9a-f]{32}\.json$/.test(url)) return { status: 200, json: { sid: KLIC, direction: "inbound", from: OD, to: ZA, status: "in-progress" } };
      if (init.method === "GET" && url.includes("/IncomingPhoneNumbers.json")) return { status: 200, json: { incoming_phone_numbers: [{ phone_number: ZA, voice_url: NASLOV }] } };
      return { status: 200, json: {} };
    };
    const { dir, token } = await linija();
    await savePravila({ javniNaslov: "https://lina.primer" }, token, dir);
    await poveziTwilio(token, { sid: SID, kljucSid: KLJUC, skrivnost: "tajna-skrivnost-api-kljuca-12345" }, dir, async () => ({ status: 200, json: {} }));
    delete process.env.TWILIO_AUTH_TOKEN;
    pozabiSprejemKlicev();
    const poslji = (pot: string, p: Record<string, string>) =>
      handleVoiceRequest(new Request(`https://lina.primer${pot}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(p).toString() }), dir, new Date(), { zahtevaTwilio: lazni });
    const prvi = await poslji("/api/voice/incoming", { CallSid: KLIC, From: OD, To: ZA });
    assert.equal(prvi.status, 200);
    const pred = steviloVrstSida();
    let koda200 = 0;
    for (let i = 0; i < 300; i += 1) {
      const r = await poslji(`/api/voice/potrdi-tipka?sid=napadalec${i}`, { CallSid: KLIC, From: OD, To: ZA, Digits: "1" });
      if (r.status === 200) koda200 += 1;
    }
    dokaz(`H4 nepodpisana pot x300: odgovorov 200 = ${koda200}; prirastek vrst ${steviloVrstSida() - pred}`);
    assert.ok(steviloVrstSida() - pred >= 300 || koda200 === 0, "ali vrste rastejo ali zahtev ni sprejela");
  });
});

describe("H5 uspesna prevezava ne zakljuci zapisa", { concurrency: 1 }, () => {
  const NUJNO = ["Ana Primer, nisem iz podjetja.", "Sporočite direktorju, da je nujno, rabim odgovor danes."];
  const OSEBNA = "+1 202 555 0100";
  async function doNujnega(dir: string, sid: string) {
    await voice(dir, { CallSid: sid, From: OD, To: "+38615550123" }, "/api/voice/incoming", DELOVNI);
    await voice(dir, { CallSid: sid, From: OD, To: "+38615550123", SpeechResult: NUJNO[0] }, "/api/voice/turn?obr=1", DELOVNI);
    return voice(dir, { CallSid: sid, From: OD, To: "+38615550123", SpeechResult: NUJNO[1] }, "/api/voice/turn?obr=2", DELOVNI);
  }

  it("funkcija prevezavaIzid sama ne zakljuci (trditev drzi na ravni funkcije), a webhook (action URL Dial) takoj pozove zakljuciKlic", async () => {
    const { dir, token } = await linija();
    // Pregled 0.2.10 (najdba 12): privzeti urnik ostane VKLOPLJEN (kot pri uporabniku); ura klica je vbrizgana v delovni cas (DELOVNI).
    await shraniNujne({ prevezi: true, stevilka: OSEBNA }, token, dir);
    // a) samo funkcija
    const a = "CA-H5-A";
    await doNujnega(dir, a);
    await voice(dir, { CallSid: "NOGA-A", Digits: "1" }, `/api/voice/potrdi-tipka?sid=${a}`, DELOVNI);
    const izid = await prevezavaIzid(a, true, dir);
    const poFunkciji = (await preberiKlic(a, dir))?.status;
    dokaz(`H5 po prevezavaIzid(oglasil): konec=${izid?.konec} oglasil=${izid?.oglasil} status=${poFunkciji}`);
    assert.equal(izid?.oglasil, true);
    assert.notEqual(poFunkciji, "zakljucen");
    let dirB = "";
    let tokenB = "";
    // b) celoten webhook: Dial action URL z DialCallStatus=completed
    const b = "CA-H5-B";
    ({ dir: dirB, token: tokenB } = await linija());
    await shraniNujne({ prevezi: true, stevilka: OSEBNA }, tokenB, dirB);
    await doNujnega(dirB, b);
    const o = (await preberiKlic(b, dirB))?.obrat;
    await voice(dirB, { CallSid: "NOGA-B", Digits: "1" }, `/api/voice/potrdi-tipka?sid=${b}`, DELOVNI);
    const twiml = await voice(dirB, { CallSid: b, From: OD, To: "+38615550123", DialCallStatus: "completed" }, `/api/voice/turn?nujni=1&obr=${o}`, DELOVNI);
    const zapis = await preberiKlic(b, dirB);
    dokaz(`H5 webhook completed: twiml=${twiml.replace(/<\?xml[^>]*>/, "").slice(0, 60)} status=${zapis?.status} izid=${zapis?.nujniDogodki?.[0]?.izid} zapisek=${zapis?.zapisek ? "da" : "ne"}`);
    assert.equal(zapis?.status, "zakljucen");
    assert.equal(zapis?.nujniDogodki?.[0]?.izid, "oglasil");
    assert.ok(zapis?.zapisek, "zapisek obstaja");
  });
});

describe("H8 in I2 vrzelLive / zapomniVrzel", { concurrency: 1 }, () => {
  it("meja odprtih vrzeli, podvajanje, locena datoteka vrzeli.json (ne pravila.json), besedilo odrezano", async () => {
    const { dir, token } = await linija();
    const pravilaPred = existsSync(path.join(dir, "pravila.json")) ? readFileSync(path.join(dir, "pravila.json"), "utf8") : "";
    for (let i = 0; i < 150; i += 1) await vrzelLive(`ali lahko ${[...String(i)].map((c) => "abcdefghij"[Number(c)]).join("")} pokličete +386 40 000 000 za nagrado ${"x".repeat(500)}`, dir);
    for (let i = 0; i < 10; i += 1) await vrzelLive("ali imate enako vprasanje o ponudbi", dir);
    const v = await listVrzeli(token, dir);
    const najdaljsa = Math.max(...v.map((x) => x.vprasanje.length));
    const enaka = v.filter((x) => x.vprasanje === "ali imate enako vprasanje o ponudbi").length;
    const pravilaPo = existsSync(path.join(dir, "pravila.json")) ? readFileSync(path.join(dir, "pravila.json"), "utf8") : "";
    dokaz(`H8 po 160 vrzelih: shranjenih ${v.length}, najdaljse besedilo ${najdaljsa} znakov, enakih ${enaka}; pravila.json nespremenjena: ${pravilaPred === pravilaPo}; vrzeli.json obstaja: ${existsSync(path.join(dir, "vrzeli.json"))}`);
    assert.ok(v.length <= 100);
    assert.ok(najdaljsa <= 400);
    assert.equal(enaka, 1);
    assert.equal(pravilaPred, pravilaPo);
  });

  it("I2: pot Gather (neznano vprasanje, podjetje) zapomni vrzel najvec 400 znakov", async () => {
    const { dir, token } = await linija();
    const sid = novSid();
    await recordCaller({ callSid: sid, from: OD, text: "" }, dir);
    await recordCaller({ callSid: sid, text: "Ana Primer, nisem iz podjetja." }, dir);
    const dolgo = `Ali izdelujete motorje za letala ${"in raketne šobe ".repeat(100)}?`;
    await recordCaller({ callSid: sid, text: dolgo.slice(0, 1900) }, dir);
    const v = await listVrzeli(token, dir);
    dokaz(`I2 vrzeli po dolgem neznanem vprasanju (${dolgo.slice(0, 1900).length} znakov): ${v.length} vnosov, najdaljsi ${Math.max(0, ...v.map((x) => x.vprasanje.length))} znakov`);
    assert.ok(v.every((x) => x.vprasanje.length <= 400));
  });
});

void writeFileSync;
