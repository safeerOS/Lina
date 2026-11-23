/**
 * Klic K7 (14. 11. 2026): (1) vprasanje Lini na koncu izreka (»... ali si me razumela«) ne gre v sporocilo; (2) prosnja za ponovitev
 * (»kaj si me razumela prosim po novi«) dobi »Zapisala sem: <sporocilo>.« iz posnetka, ki se pripravi v ozadju takoj ob zapisu. Brez omrezja.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { formaCatalog } from "./catalog.ts";
import { lociMetaVprasanje, jePonovitev } from "./osebna-polnila.ts";
import { kosiPonovitve } from "./glas.ts";
import { handleZvokRequest, nastaviSintezoZaPreizkus, pocakajDnevnikGlasu, pocakajGlas, ponastaviOdklopnik, ustaviCiscenjeZvoka } from "./glas.server.ts";
import { defaultPravila } from "./pravila.server.ts";
import { pripraviGlasObZagonu, recordCaller } from "./service.server.ts";
import { writeJson } from "./store.server.ts";
import { handleVoiceRequest, pocakajOzadjeKlicev, ustaviCiscenjeOpravil, type MoznostiKlica } from "./voice.server.ts";

process.env.LINA_LLM = "0";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-ponovitev-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const temps: string[] = [];
const zapore: Array<() => void> = [];

afterEach(async () => {
  for (const spusti of zapore.splice(0)) spusti();
  await pocakajOzadjeKlicev();
  delete process.env.TWILIO_AUTH_TOKEN;
  nastaviSintezoZaPreizkus(null);
  ponastaviOdklopnik();
  ustaviCiscenjeOpravil();
  while (temps.length) {
    const dir = temps.pop();
    if (!dir) continue;
    await pocakajGlas(dir);
    await pocakajDnevnikGlasu(dir);
    ustaviCiscenjeZvoka(dir);
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

async function odprtaLinija(pravila: Record<string, unknown> = {}): Promise<string> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  temps.push(dir);
  await writeJson(dir, "line.json", { open: true, catalog: formaCatalog(), updatedAt: null });
  await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi", nacinKlica: "osebna", imeLastnika: "Ana", ...pravila });
  return dir;
}

/** Lazni glas: vse je takoj pripravljeno, razen besedila, ki ustreza vzorcu in caka na spust. */
function lazniGlas(visi?: { vzorec: RegExp; caka: Promise<void> }): string[] {
  const klici: string[] = [];
  nastaviSintezoZaPreizkus(async (besedilo) => {
    klici.push(besedilo);
    if (visi?.vzorec.test(besedilo)) await visi.caka;
    return Buffer.alloc(4800);
  });
  return klici;
}

async function zGlasom(pravila: Record<string, unknown> = {}): Promise<string> {
  const dir = await odprtaLinija(pravila);
  await pripraviGlasObZagonu(dir);
  await pocakajGlas(dir);
  return dir;
}

const IZVOR = "https://lina.primer";
const SKRIVNOST = "twilio-zeton-preizkusa";
const OD = "+38640000000";
let zahtev = 0;

async function klic(dir: string, pot: string, params: Record<string, string>, moznosti: MoznostiKlica = {}): Promise<string> {
  process.env.TWILIO_AUTH_TOKEN = SKRIVNOST;
  const signed = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], `${IZVOR}${pot}`);
  const odgovor = await handleVoiceRequest(
    new Request(`${IZVOR}${pot}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": createHmac("sha1", SKRIVNOST).update(signed).digest("base64") },
      body: new URLSearchParams(params).toString(),
    }),
    dir,
    undefined,
    moznosti,
  );
  assert.equal(odgovor.status, 200, pot);
  zahtev += 1;
  return odgovor.text();
}




const IZREK = "pozdravite jo lepo in ji povejte da jutri ob petih pridemo domov ali si me razumela";

async function zacni(sid: string, visi?: { vzorec: RegExp; caka: Promise<void> }) {
  const sinteze = lazniGlas(visi);
  const dir = await zGlasom();
  const moznosti = { razumevanje: async () => null } as never;
  await klic(dir, "/api/voice/incoming", { CallSid: sid, From: OD }, moznosti);
  await pocakajOzadjeKlicev();
  const tok = async (obr: number, izrek: string) => klic(dir, `/api/voice/turn?obr=${obr}`, { CallSid: sid, From: OD, SpeechResult: izrek }, moznosti);
  const zapis = async () => (JSON.parse(await readFile(path.join(dir, "calls.json"), "utf8")) as Record<string, { status: string; order: { tajnica?: { sporocilo: string; izrek?: string } } }>)[sid];
  return { dir, tok, zapis, sinteze };
}

describe("klic K7: vprasanje Lini na koncu izreka ni del sporocila", () => {
  const odrezi: Array<[string, string]> = [
    [IZREK, "pozdravite jo lepo in ji povejte da jutri ob petih pridemo domov"],
    ["pridem jutri ob osmih si me slišala", "pridem jutri ob osmih"],
    ["pridem jutri ob osmih ste me razumeli", "pridem jutri ob osmih"],
    ["pridem jutri ob osmih a si zapisala", "pridem jutri ob osmih"],
    ["pridem jutri ob osmih ali ste zapisali", "pridem jutri ob osmih"],
    ["pridem jutri ob osmih si razumela vse", "pridem jutri ob osmih"],
    ["pridem jutri ob osmih, ali si me razumela?", "pridem jutri ob osmih"],
    ["pridem jutri ob osmih kaj si me razumela prosim po novi", "pridem jutri ob osmih"],
    ["pridem jutri ob osmih prosim ponovi", "pridem jutri ob osmih"],
    ["pridem jutri ob osmih ponovite prosim", "pridem jutri ob osmih"],
    ["pridem jutri ob osmih me razumete", "pridem jutri ob osmih"],
    ["pridem jutri ob osmih ali me slišite", "pridem jutri ob osmih"],
    ["pridem jutri ob osmih pa kdo si ti", "pridem jutri ob osmih"],
    ["pridem jutri ob osmih kdo ste", "pridem jutri ob osmih"],
    ["pridem jutri ob osmih preberi", "pridem jutri ob osmih"],
    ["pridem jutri ob osmih in si me slišal", "pridem jutri ob osmih"],
    ["pridem jutri ob osmih ste razumeli sporočilo", "pridem jutri ob osmih"],
  ];
  const ostane = [
    "pridem jutri ob osmih ali me lahko pokliče",
    "naj me pokliče nazaj ko bo imela čas",
    "ali bo prišla jutri na sestanek",
    "povejte ji da sem razumel navodila",
    "sem zapisal številko ki mi jo je dala",
    "bom poklical ponovno jutri",
    "naj ji ponovi navodila za jutri",
    "recite ji da je ne razumem",
    "ali ste vi njena tajnica",
    "povejte ji kdo sem in da pridem",
    "ali si bo zapomnila da pridem",
    "ji recite da me je slišala",
    "pridem jutri, ali je to v redu",
    "ali me bo počakala",
    "pridem jutri ob osmih",
    "pozdravite jo lepo in ji povejte da pridem v ponedeljek",
    "ali lahko pride po mene",
    "zapisala si je naslov",
  ];
  it(`${odrezi.length} izrekov z vprasanjem Lini: vprasanje odrezano; ${ostane.length} izrekov brez njega (tudi vprasanja za lastnika): nic odrezano`, () => {
    for (const [izrek, vsebina] of odrezi) {
      const r = lociMetaVprasanje(izrek);
      assert.equal(r.vsebina, vsebina, izrek);
      assert.ok(r.vprasanje.length > 0, izrek);
    }
    for (const izrek of ostane) assert.deepEqual(lociMetaVprasanje(izrek), { vsebina: izrek, vprasanje: "" }, izrek);
    assert.equal(jePonovitev("kaj si me razumela prosim po novi"), true);
    assert.equal(jePonovitev("ponovite prosim"), true);
    // Lastnik 14. 11. 2026 (klic K8): vprasanje o razumevanju po zapisu = ponovitev sporocila (prej: samo potrditev).
    assert.equal(jePonovitev("si razumela"), true);
    assert.equal(jePonovitev("bom poklical ponovno"), false);
  });

  // Lastnik 14. 11. 2026: vprasanje o razumevanju v ISTEM izreku kot sporocilo dobi CELO ponovitev (prej »Da, sporočilo sem zapisala ...«). Posnetek
  // se ob zapisu sele pripravlja (tu visi), zato najprej »preberem ga v trenutku« in ponovitev v naslednjem obratu; brez slovesa.
  it("sporocilo + »ali si me razumela« v istem izreku: sporocilo brez vprasanja, nato cela ponovitev (»preberem ga v trenutku«, naslednji obrat), brez slovesa", async () => {
    let spusti: () => void = () => undefined;
    const caka = new Promise<void>((r) => (spusti = r));
    const { dir, tok, zapis } = await zacni("CA-PON-1", { vzorec: /pridemo domov/, caka });
    const prvi = await tok(1, IZREK);
    assert.match(prvi, /<Gather [^>]*timeout="1"/, "kratko cakanje na posnetek ponovitve");
    assert.doesNotMatch(prvi, /<Hangup/);
    spusti();
    await pocakajOzadjeKlicev();
    await new Promise((r) => setTimeout(r, 30));
    const drugi = await tok(2, "");
    assert.equal([...drugi.matchAll(/<Play>/g)].length, 1, drugi);
    assert.match(drugi, /<Gather [^>]*timeout="6"/, "po ponovitvi zapis se ni potrjen: vprasanje, poslusa 6 s");
    assert.doesNotMatch(drugi, /<Hangup/);
    const lina = (JSON.parse(await readFile(path.join(dir, "calls.json"), "utf8")) as Record<string, { transcript: Array<{ role: string; text: string }> }>)["CA-PON-1"].transcript.filter((v) => v.role === "lina").map((v) => v.text);
    assert.deepEqual(lina.slice(1), ["Sporočilo sem zapisala, preberem ga v trenutku.", "Zapisala sem: pozdravite jo lepo in ji povejte da jutri ob petih pridemo domov. Ali sem prav razumela?"]);
    const k = await zapis();
    assert.equal(k.order.tajnica?.sporocilo.includes("razumela"), false, k.order.tajnica?.sporocilo);
    assert.equal(k.order.tajnica?.izrek?.includes("razumela"), false);
    assert.match(k.order.tajnica?.sporocilo ?? "", /pridemo domov$/);
  });
});

describe("klic K7: ponovitev zapisanega iz predpripravljenega posnetka", () => {
  it("ob zapisu se v ozadju HKRATI sintetizirajo kosi (uvod »Zapisala sem:« je del prvega kosa); prosnja jih predvaja takoj, brez nove sinteze, nato slovo + Hangup", async () => {
    const { tok, zapis, sinteze } = await zacni("CA-PON-2");
    assert.ok(sinteze.includes("Zapisala sem:"), "uvod je stalni posnetek (pripravljen ob zagonu)");
    const SP = "naj prinese tudi mapo z dokumenti in naj me pokliče zvečer po šesti uri ko bo doma";
    await tok(1, SP);
    await pocakajOzadjeKlicev();
    const vsebina = kosiPonovitve(SP);
    assert.equal(vsebina.length, 3);
    // Uvod je DEL prvega kosa (isti tok govora; locen uvod je imel drugacno visino glasu, posluh lastnika 14. 11. 2026).
    const kosi = [`Zapisala sem: ${vsebina[0]}`, ...vsebina.slice(1)];
    for (let i = 0; i < 40 && !kosi.every((k) => sinteze.includes(k)); i += 1) await new Promise((r) => setTimeout(r, 10));
    for (const k of kosi) assert.ok(sinteze.includes(k), `kos »${k}« sintetiziran ob zapisu`);
    const prej = sinteze.length;
    const twiml = await tok(2, "kaj si me razumela prosim po novi");
    assert.equal([...twiml.matchAll(/<Play>/g)].length, 1, "en Play (zlepek uvoda in kosov)");
    // Lastnik 14. 11. 2026: ponovitev klica ne zakljuci; Lina poslusa (4 s) in se ob tisini poslovi sama.
    assert.match(twiml, /<Gather [^>]*timeout="6"/);
    assert.doesNotMatch(twiml, /<Hangup/);
    assert.equal(sinteze.length, prej, "ob prosnji se ne sintetizira nic (vse je ze pripravljeno)");
    assert.notEqual((await zapis()).status, "zakljucen");
    const slovo = await tok(3, "");
    assert.match(slovo, /<Hangup\/>/, "ob tisini slovo in odlog");
    assert.doesNotMatch(slovo, /<Gather /);
    assert.equal((await zapis()).status, "zakljucen");
  });

  it("cela ponovitev (posluh lastnika 14. 11. 2026: »že pri Ji je razlika«): ob zapisu se HKRATI s kosi sintetizira tudi celota; ce je pripravljena, gre ona, tudi ko kos še visi", async () => {
    let spusti: () => void = () => undefined;
    const caka = new Promise<void>((r) => (spusti = r));
    const { tok, zapis, sinteze, dir } = await zacni("CA-CELA-1", { vzorec: /^ji povejte/, caka });
    try {
      await tok(1, "pozdravite jo lepo in ji povejte da pridem v ponedeljek");
      const cela = "Zapisala sem: pozdravite jo lepo in ji povejte da pridem v ponedeljek.";
      for (let i = 0; i < 40 && !sinteze.includes(cela); i += 1) await new Promise((r) => setTimeout(r, 10));
      assert.ok(sinteze.includes(cela), `cela ponovitev sintetizirana ob zapisu: ${sinteze.slice(-4).join(" | ")}`);
      assert.ok(sinteze.includes("ji povejte da pridem v ponedeljek."), "kosi tecejo vzporedno (rezerva)");
      await new Promise((r) => setTimeout(r, 30));
      const twiml = await tok(2, "kaj si me razumela prosim po novi");
      assert.equal([...twiml.matchAll(/<Play>/g)].length, 1);
      assert.match(twiml, /<Gather [^>]*timeout="6"/, "ponovitev iz cele sinteze takoj, brez rezervne fraze; nato poslusa");
      assert.doesNotMatch(twiml, /<Hangup/);
      const k = (JSON.parse(await readFile(path.join(dir, "calls.json"), "utf8")) as Record<string, { transcript: Array<{ role: string; text: string }> }>)["CA-CELA-1"];
      assert.ok(!k.transcript.some((v) => v.text.includes("preberem ga v trenutku")));
      assert.match(await tok(3, ""), /<Hangup\/>/, "ob tisini slovo");
      assert.equal((await zapis()).status, "zakljucen");
    } finally {
      spusti();
      await pocakajOzadjeKlicev();
    }
  });

  it("kosiPonovitve: prve 4 besede, nato do 8 besed ali vejice iz izreka; brez dodanih locil, zadnji s piko", () => {
    assert.deepEqual(kosiPonovitve("pozdravite jo lepo in ji povejte da jutri ob petih pridemo domov"), ["pozdravite jo lepo in", "ji povejte da jutri ob petih pridemo domov."]);
    assert.deepEqual(kosiPonovitve("naj prinese tudi mapo, dokumente in vse ostalo kar je treba prinesti s seboj jutri zjutraj"), ["naj prinese tudi mapo,", "dokumente in vse ostalo kar je treba prinesti", "s seboj jutri zjutraj."]);
    assert.deepEqual(kosiPonovitve("pridem jutri."), ["pridem jutri."]);
    assert.deepEqual(kosiPonovitve(""), []);
  });
});

describe("klic K7 na ravni obrata (besedilo odgovora, lazen model)", () => {
  const KONEC = "Hvala za klic, nasvidenje.";
  async function obrat(sid: string, model: (s: string, v: string) => Promise<string | null>) {
    const dir = await odprtaLinija();
    await recordCaller({ callSid: sid, from: OD, text: "" }, dir, undefined, { razumevanje: model, osebnaRokMs: 200 });
    return (text: string) => recordCaller({ callSid: sid, from: OD, text }, dir, undefined, { razumevanje: model, osebnaRokMs: 200 });
  }
  it("model vrne sporocilo z vprasanjem Lini na koncu: vprasanje se odreze tudi iz besedila modela", async () => {
    const model = async (_s: string, v: string) => v.includes("Zapisan izrek") ? null : JSON.stringify({ namen: "sporocilo", sporocilo: "jutri ob petih pridemo domov kdo si", ime: "", vprasanje: "kdo si", odgovor: null });
    const reci = await obrat("CA-PON-3", model);
    const r = await reci("lepo pozdravljeni jutri ob petih pridemo domov kdo si");
    assert.equal(r.call.order.tajnica?.sporocilo, "jutri ob petih pridemo domov");
  });
  it("dopis po zapisu: vprasanje Lini na koncu (»me slisite«) ne gre v sporocilo", async () => {
    const reci = await obrat("CA-PON-5", async () => null);
    await reci("pozdravite jo lepo in ji povejte da pridem v ponedeljek");
    const r = await reci("pa naj prinese tudi mapo z dokumenti me slišite");
    assert.match(r.call.order.tajnica?.sporocilo ?? "", /mapo z dokumenti$/);
  });

  it("prosnja za ponovitev brez modela (model ne odgovori): »Zapisala sem: <sporocilo>.«, z zakljucnim stavkom; ob tisini slovo", async () => {
    let klicev = 0;
    const model = async () => {
      klicev += 1;
      return null;
    };
    const reci = await obrat("CA-PON-4", model);
    await reci("pozdravite jo lepo in ji povejte da pridem v ponedeljek");
    klicev = 0;
    const r = await reci("kaj si me razumela prosim po novi");
    // 15. 11. 2026: zapis se ni potrjen, zato se ponovitev konca z vprasanjem »Ali sem prav razumela?« (zakljucni stavek, pravilo C); slovo sledi po potrditvi ali tisini.
    assert.equal(r.reply, "Zapisala sem: pozdravite jo lepo in ji povejte da pridem v ponedeljek. Ali sem prav razumela?");
    // Brez dodanih locil: zapis klica (Lina vrstica in sporocilo) nima vejice, ki je ni bilo v izreku.
    assert.doesNotMatch(r.reply, /,/);
    assert.doesNotMatch(r.call.order.tajnica?.sporocilo ?? "", /,/);
    assert.ok(r.call.transcript.filter((v) => v.role === "lina").every((v) => !/in, ji/.test(v.text)));
    assert.equal(klicev, 0, "pravilo pred modelom");
    assert.notEqual(r.call.status, "zakljucen", "ponovitev klica ne zakljuci");
    const tisina = await reci("");
    assert.equal(tisina.reply, KONEC);
    assert.equal(tisina.call.status, "zakljucen");
  });
});

describe("tocka B: en <Play> na odgovor", () => {
  // Odgovor na vprasanje nima vec slovesa v istem odgovoru (lastnik 14. 11. 2026); vec kosov ima npr. »Dobro, hvala.« + edino vprasanje.
  it("odgovor iz vec kosov (»Dobro, hvala.« + »Katero sporočilo želite pustiti?«) je EN posnetek: dolzina = vsota kosov, veljavna glava", async () => {
    const { dir, tok } = await zacni("CA-PLAY-1");
    await pocakajOzadjeKlicev();
    // Prvi govor takoj po pozdravu velja za govor MED pozdravom (»Izvolite, poslušam.«); drugi dobi odgovor iz dveh kosov.
    await tok(1, "kako si");
    const twiml = await tok(2, "kako si");
    assert.match(twiml, /<Gather /);
    const play = [...twiml.matchAll(/<Play>([^<]+)<\/Play>/g)].map((m) => m[1]);
    assert.equal(play.length, 1, twiml);
    assert.doesNotMatch(twiml, /<Hangup/);
    const r = await handleZvokRequest(new Request(play[0]), dir);
    assert.equal(r.status, 200);
    const wav = Buffer.from(await r.arrayBuffer());
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.readUInt32LE(40), wav.length - 44);
    // Lazni glas: vsak kos je 0,1 s (800 vzorcev, 1600 bajtov); zlepek ima vsaj dva kosa.
    assert.ok(wav.length - 44 >= 3200 && (wav.length - 44) % 1600 === 0, String(wav.length));
  });
});

describe("Fable 6 in 7: stevilka med pozdravom, negotovo, surovo in ocisceno besedilo za lastnika", () => {
  it("odgovor s stevilko klicatelja se sintetizira ze ob prihodu klica; vprasanje po zapisu ga ne sintetizira znova", async () => {
    const { tok, sinteze } = await zacni("CA-STEV-1");
    await pocakajOzadjeKlicev();
    for (let i = 0; i < 40 && !sinteze.some((s) => s.includes("poklicali s številke")); i += 1) await new Promise((r) => setTimeout(r, 10));
    assert.ok(sinteze.some((s) => s.includes("poklicali s številke")), "stevilka pripravljena med pozdravom");
    await tok(1, "pozdravite jo lepo in ji povejte da pridem v ponedeljek");
    await pocakajOzadjeKlicev();
    const prej = sinteze.filter((s) => s.includes("številke")).length;
    const twiml = await tok(2, "a imas moj stevilk");
    assert.match(twiml, /<Play>/);
    assert.equal(sinteze.filter((s) => s.includes("številke")).length, prej, "ob vprasanju brez nove sinteze stevilke");
  });

  it("model negotov (confident=false): enkrat prosi za ponovitev, sporocilo se ne zapise", async () => {
    const dir = await odprtaLinija();
    const model = async () => JSON.stringify({ namen: "sporocilo", sporocilo: "javljat tako pa", ime: "", vprasanje: null, odgovor: null, confident: false });
    await recordCaller({ callSid: "CA-NEG-1", from: OD, text: "" }, dir, undefined, { razumevanje: model, osebnaRokMs: 200 });
    const r = await recordCaller({ callSid: "CA-NEG-1", from: OD, text: "javljat tako pa" }, dir, undefined, { razumevanje: model, osebnaRokMs: 200 });
    assert.equal(r.reply, "Žal vas nisem dobro razumela. Ali lahko ponovite sporočilo?");
    assert.equal(r.call.order.tajnica, undefined);
  });

  it("zapisek za lastnika ima ocisceno sporocilo IN dobesedni prepis, ce se razlikujeta", async () => {
    const { vsebinaZapiska } = await import("./zapiski.ts");
    const dir = await odprtaLinija();
    const model = async (_s: string, v: string) => (v.includes("Zapisan izrek") ? null : JSON.stringify({ namen: "sporocilo", sporocilo: "pridemo domov", ime: "", vprasanje: null, odgovor: null }));
    await recordCaller({ callSid: "CA-ZAP-1", from: OD, text: "" }, dir, undefined, { razumevanje: model, osebnaRokMs: 200 });
    const r = await recordCaller({ callSid: "CA-ZAP-1", from: OD, text: "ja dober dan jutri ob petih pridemo domov" }, dir, undefined, { razumevanje: model, osebnaRokMs: 200 });
    const z = vsebinaZapiska(r.call);
    assert.equal(r.call.order.tajnica?.sporocilo, "pridemo domov");
    assert.match(z, /pridemo domov/);
    assert.match(z, /Dobesedno \(prepoznava govora\): .*jutri ob petih pridemo domov/);
  });
});

describe("variante fraz in rezervna fraza ponovitve (lastnik 14. 11. 2026)", () => {
  it("variante v istem klicu brez ponovitve: Izvolite. -> Prosim. -> Poslušam.; vse variante so stalni posnetki", async () => {
    const { stalniStavki, VARIANTE_OSEBNE } = await import("./glas.ts");
    const { t } = await import("./besedila.ts");
    const stavki = stalniStavki({ ...defaultPravila(), nacinKlica: "osebna" as const, imeLastnika: "Ana" }, "Podjetje Primer");
    for (const sez of VARIANTE_OSEBNE) for (const k of sez) assert.ok(stavki.includes(t(k)), k);
    assert.ok(stavki.includes(t("osebnaPonovitevVTrenutku")));
    const dir = await odprtaLinija();
    const m = { razumevanje: async () => null, osebnaRokMs: 200 };
    await recordCaller({ callSid: "CA-VAR-1", from: OD, text: "" }, dir, undefined, m);
    const reci = (text: string) => recordCaller({ callSid: "CA-VAR-1", from: OD, text }, dir, undefined, m);
    await reci("pozdravite jo lepo in ji povejte da pridem v ponedeljek");
    const odgovori = [];
    for (const izrek of ["počakaj", "trenutek prosim", "tako tako pa"]) odgovori.push((await reci(izrek)).reply);
    assert.deepEqual(odgovori, ["Izvolite.", "Prosim.", "Poslušam."]);
  });

  it("kosi ponovitve ob prosnji se niso pripravljeni: »Sporočilo sem zapisala, preberem ga v trenutku.« (kratko cakanje), ponovitev v naslednjem obratu", async () => {
    let spusti: () => void = () => undefined;
    const caka = new Promise<void>((r) => (spusti = r));
    const { dir, tok, zapis } = await zacni("CA-REZ-1", { vzorec: /ponedeljek/, caka });
    await tok(1, "pozdravite jo lepo in ji povejte da pridem v ponedeljek");
    const prvi = await tok(2, "kaj si me razumela prosim po novi");
    assert.match(prvi, /<Gather [^>]*timeout="1"/, "kratko cakanje, brez slovesa");
    assert.doesNotMatch(prvi, /<Hangup/);
    spusti();
    await pocakajOzadjeKlicev();
    await new Promise((r) => setTimeout(r, 30));
    const drugi = await tok(3, "ok");
    assert.match(drugi, /<Play>/);
    assert.doesNotMatch(drugi, /<Hangup/, "ponovitev klica ne zakljuci");
    assert.match(await tok(4, ""), /<Hangup\/>/, "ob tisini slovo");
    const k = (JSON.parse(await readFile(path.join(dir, "calls.json"), "utf8")) as Record<string, { transcript: Array<{ role: string; text: string }> }>)["CA-REZ-1"];
    const lina = k.transcript.filter((v) => v.role === "lina").map((v) => v.text);
    assert.ok(lina.includes("Sporočilo sem zapisala, preberem ga v trenutku."), lina.join(" | "));
    assert.ok(lina.some((v) => v.startsWith("Zapisala sem: pozdravite jo lepo in")), "ponovitev v naslednjem obratu");
    assert.equal((await zapis()).status, "zakljucen");
  });
});
