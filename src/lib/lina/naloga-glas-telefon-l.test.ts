// Popravki slepega pregleda poti telefona (POROCILO-L-PREGLED, 15. 11. 2026): L-01 ... L-10.
// Vsak varnostni preizkus je preverjen BREZ popravka (izvorna koda iz osnove cf6de61, preizkus ostane): brez popravka pade, s popravkom uspe.
// Pravi TLS in pravi WebSocket (odjemalec kot telefon), samo 127.0.0.x, nakljucna vrata.
import assert from "node:assert/strict";
import { chmodSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import tls from "node:tls";
import { test } from "node:test";
import { t } from "./besedila.ts";
import { formaCatalog } from "./catalog.ts";
import {
  GlasTelefonStreznik, NAJVEC_ZAVRNITEV_NA_MINUTO, NASTAVITVE_GLASU_TELEFONA, ZETON_GLASU_TELEFONA, glasTelefonaTece, nastaviPrikljucekTelefona, primerjajZeton,
  prikljucekTelefona, shraniZetonGlasaTelefona, uskladiGlasTelefona, ustaviGlasTelefona, type PrikljucekTelefona, type RazlogKonca, type VrataTelefona,
} from "./glas-telefon.server.ts";
import { KODA, OP_PING, OP_ZAPRI } from "./glas-telefon-ws.ts";
import { odtisPotrdila, potrdiloVMapi } from "./zasebno-omrezje.server.ts";
import { Odjemalec, ZETON, caka, odpri, odpriWs, premor } from "./glas-telefon-odjemalec.preizkus.ts";
import { casLive, izrekKlicateljaLive, loadLine, odgovorLinaLive, zacniKlicLive, zakljuciKlic } from "./service.server.ts";
import { sprejemKlicaTelefona } from "./live/telefon-zagon.server.ts";
import { prikljucekZaMost } from "./live/telefon-prikljucek.ts";
import type { OdvisnostiMosta } from "./live/most.ts";
import { prevzemiLinijo, sprostiAktivniKlic } from "./voice.server.ts";

const PREDPONA = "glas-tel-l-";

// ------------------------------------------------------------------ pomocniki

type Dnevnik = { zacni: Array<{ callId: string; remoteNumber: string }>; zvok: Buffer[]; ustavi: RazlogKonca[]; vrata: VrataTelefona | null };
function lazniPriklop(): { priklop: PrikljucekTelefona; d: Dnevnik } {
  const d: Dnevnik = { zacni: [], zvok: [], ustavi: [], vrata: null };
  return { d, priklop: { zacni: (k, v) => { d.zacni.push(k); d.vrata = v; }, zvok: (p) => void d.zvok.push(p), ustavi: (r) => void d.ustavi.push(r) } };
}
type Zagon = { s: GlasTelefonStreznik; dir: string; vrata: number; odtis: string; cert: string; d: Dnevnik; zapri: () => Promise<void> };
async function zazeni(m: Partial<ConstructorParameters<typeof GlasTelefonStreznik>[0]> = {}): Promise<Zagon> {
  const dir = await mkdtemp(path.join(tmpdir(), PREDPONA));
  const { priklop, d } = lazniPriklop();
  const s = new GlasTelefonStreznik({ root: dir, zeton: () => ZETON, vklopljeno: () => true, prikljucek: () => priklop, dnevnik: () => undefined, primerjaj: primerjajZeton, ...m });
  const { vrata, odtis } = await s.zazeni();
  const cert = readFileSync(path.join(dir, "glas-telefon-tls", "potrdilo.pem"), "utf8");
  return { s, dir, vrata, odtis, cert, d, zapri: async () => { await s.ustavi(); await rm(dir, { recursive: true, force: true }); } };
}
async function klic(z: Zagon, callId = "klic-1"): Promise<Odjemalec> {
  const n = z.d.zacni.length;
  const od = await odpriWs(z);
  od.besedilo({ type: "start", callId, remoteNumber: "+38640123456" });
  await caka(() => z.d.zacni.length > n);
  return od;
}
async function prostaVrata(): Promise<number> {
  return await new Promise<number>((ok, ne) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); });
    s.once("error", ne);
  });
}
/** Prazna TLS povezava (rokovanje opravljeno), po zelji z drugega naslova 127.0.0.x in z delno zahtevo. */
async function praznaTls(z: Zagon, od?: string, poslji?: string): Promise<tls.TLSSocket> {
  const v = tls.connect({ host: "127.0.0.1", port: z.vrata, localAddress: od, ca: z.cert, checkServerIdentity: () => undefined } as tls.ConnectionOptions & { localAddress?: string });
  v.on("error", () => undefined);
  await new Promise<void>((ok, ne) => { v.once("secureConnect", () => ok()); v.once("error", ne); });
  if (poslji) v.write(poslji);
  return v;
}
const zaprta = (v: tls.TLSSocket): boolean => v.destroyed || v.readyState === "closed";
const rok = <T>(p: Promise<T>, ms: number): Promise<T | "visi"> => Promise.race([p, premor(ms).then(() => "visi" as const)]);

// ================================================================== L-01

test("L-01 povezava po TLS, ki ne dokonca zahteve (prazna ali pol glave), se zapre po roku pred nadgradnjo", async () => {
  const z = await zazeni({ rokPredNadgradnjo: 300 });
  const v = [await praznaTls(z), await praznaTls(z, undefined, "GET /api/voice/telefon HTTP/1.1\r\nHost: x\r\n")];
  try {
    await caka(() => v.every(zaprta), 2500).catch(() => undefined);
    assert.deepEqual(v.map(zaprta), [true, true], "prazna in pol poslana povezava sta zaprti");
  } finally { for (const x of v) x.destroy(); await z.zapri(); }
});

test("L-01 klic po nadgradnji ni vezan na rok pred nadgradnjo", async () => {
  const z = await zazeni({ rokPredNadgradnjo: 300 });
  try {
    const od = await klic(z);
    await premor(700);
    assert.equal(od.zaprta, false, "klic tece naprej");
    od.besedilo({ type: "stop" });
    await od.cakajZaprtje();
  } finally { await z.zapri(); }
});

test("L-01 osem praznih povezav z drugih naslovov ne zapre vrat pravemu telefonu: naslov z veljavnim zetonom ima rezervo", async () => {
  const z = await zazeni();
  const prazne: tls.TLSSocket[] = [];
  try {
    const prvi = await klic(z); // naslov 127.0.0.1 postane »znan« (veljaven zeton)
    prvi.besedilo({ type: "stop" });
    await prvi.cakajZaprtje();
    // N-1: neznan naslov sme imeti hkrati najvec NAJVEC_NEZNANIH_NA_NASLOV (2) povezavi, zato je osem praznih povezav 4 naslovi x 2 (prej 2 x 4)
    for (const naslov of ["127.0.0.2", "127.0.0.3", "127.0.0.4", "127.0.0.5"]) for (let i = 0; i < 2; i++) prazne.push(await praznaTls(z, naslov));
    const od = await klic(z, "klic-2");
    assert.equal(od.odziv?.status, 101, "pravi telefon se poveze kljub zasedenim 8 povezavam");
    od.besedilo({ type: "stop" });
    await od.cakajZaprtje();
  } finally { for (const x of prazne) x.destroy(); await z.zapri(); }
});

// ================================================================== L-02

test("L-02 ustavi() (izklop stikala) konca tekoci klic takoj, priklop dobi »odklop«, ustavi se ne obesi", async () => {
  const z = await zazeni();
  const od = await klic(z);
  try {
    const izid = await rok(z.s.ustavi().then(() => "ok" as const), 2500);
    assert.equal(izid, "ok", "ustavi() se mora razresiti v 2,5 s (ne cakati na konec klica)");
    await od.cakajZaprtje(2000);
    assert.equal(od.koda(), KODA.odhaja);
    assert.deepEqual(z.d.ustavi, ["odklop"]);
    assert.equal(z.s.klicTece, false);
  } finally { od.zapri(); await z.zapri(); }
});

test("L-02 izklop stikala v nastavitvah med klicem: veriga uskladi ne visi, ponovni vklop deluje; zamenjava zetona prekine klic", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), PREDPONA));
  const vrata = await prostaVrata();
  const { priklop, d } = lazniPriklop();
  const nastavitve = (vklop: boolean) => writeFile(path.join(dir, NASTAVITVE_GLASU_TELEFONA), JSON.stringify({ vklop, vrata }));
  let od: Odjemalec | null = null;
  try {
    await shraniZetonGlasaTelefona(dir, ZETON);
    nastaviPrikljucekTelefona(priklop);
    await nastavitve(true);
    await uskladiGlasTelefona(dir);
    const cert = readFileSync(path.join(dir, "glas-telefon-tls", "potrdilo.pem"), "utf8");
    const z = { vrata, cert, odtis: odtisPotrdila(cert) };
    od = await odpriWs(z);
    od.besedilo({ type: "start", callId: "klic-1" });
    await caka(() => d.zacni.length === 1);
    await nastavitve(false);
    assert.equal(await rok(uskladiGlasTelefona(dir).then(() => "ok" as const), 3000), "ok", "izklop ne sme viseti do konca klica");
    await od.cakajZaprtje(2000);
    assert.deepEqual(d.ustavi, ["odklop"]);
    assert.equal(glasTelefonaTece(), false);
    // ponovni vklop ni blokiran
    await nastavitve(true);
    assert.equal(await rok(uskladiGlasTelefona(dir).then(() => "ok" as const), 3000), "ok");
    assert.equal(glasTelefonaTece(), true);
    od = await odpriWs(z);
    od.besedilo({ type: "start", callId: "klic-2" });
    await caka(() => d.zacni.length === 2);
    // zamenjava zetona: stara seja se konca takoj
    await shraniZetonGlasaTelefona(dir, `${ZETON}-nov`);
    await od.cakajZaprtje(2000);
    assert.deepEqual(d.ustavi, ["odklop", "odklop"]);
  } finally {
    od?.zapri();
    await ustaviGlasTelefona();
    nastaviPrikljucekTelefona(null);
    await rm(dir, { recursive: true, force: true });
  }
});

// ================================================================== L-03

test("L-03 callId: stroga bela lista oblike; __proto__, vodilni _ ali -, presledek in predolgo se zavrnejo, priklop nic ne dobi", async () => {
  const z = await zazeni();
  try {
    for (const slab of ["__proto__", "_klic", "-klic", "kl ic", "klic/../x", "k".repeat(65), ""]) {
      const od = await odpriWs(z);
      od.besedilo({ type: "start", callId: slab, remoteNumber: "+38640123456" });
      await od.cakajZaprtje();
      assert.equal(od.koda(), KODA.pravilnik, `callId ${JSON.stringify(slab)}`);
    }
    assert.equal(z.d.zacni.length, 0);
    const dober = await klic(z, "Klic_1-a");
    assert.equal(z.d.zacni[0].callId, "Klic_1-a");
    dober.zapri();
  } finally { await z.zapri(); }
});

/** Odvisnosti mosta za priklop: Live se ne odpre (odpriLive vrze), nalozi se steje. */
function odvisnostiMosta(stevec: { nalozi: number }, zapisnikZacni?: (v: { callSid: string }) => void): OdvisnostiMosta {
  const noop = async () => undefined;
  return {
    porabiZeton: () => ({ izid: "ok", from: "" }),
    nalozi: async () => {
      stevec.nalozi += 1;
      return { setup: { setup: { model: "test" } }, katalog: { ...formaCatalog(), znanje: "Izdelujemo pohistvo." }, pozdrav: "Pozdravljeni, tukaj Lina, pomocnica z umetno inteligenco.", temaOdgovor: t("temaPrivzeto"), oprostilo: t("oprostiteSlovo"), najdaljsiMinut: null };
    },
    odpriLive: async () => { throw new Error("preizkus: brez Live"); },
    zapisnik: { zacni: async (v: { callSid: string }) => void zapisnikZacni?.(v), izrek: noop, odgovor: noop, vrzel: noop, cas: async () => null, povprasevanje: async () => ({ sprejeto: [], zavrnjeno: [] }), zakljuci: noop },
    zasedenost: { osvezi: () => undefined, sprosti: () => undefined },
    posnetek: async () => null,
    dnevnik: () => undefined,
  } as unknown as OdvisnostiMosta;
}
const posnetekPozdrava = async () => new Uint8Array(6400).fill(0x55);
function lazneVrata() {
  const v = { zapri: 0, zvok: 0, clear: 0 };
  return { v, vrata: { posljiZvok: () => void (v.zvok += 1), posljiClear: () => void (v.clear += 1), zapri: () => void (v.zapri += 1) } as VrataTelefona };
}

test("L-03 prilagodilnik: oznako zapisa klica izda Lina (tel-<hex>), callId telefona ne pride v zapisnik", async () => {
  const videni: string[] = [];
  const p = prikljucekZaMost({ odvisnosti: () => odvisnostiMosta({ nalozi: 0 }, (v) => void videni.push(v.callSid)), posnetekPcm16: posnetekPozdrava });
  const { vrata } = lazneVrata();
  p.zacni({ callId: "__proto__", remoteNumber: "+38640123456" }, vrata);
  await caka(() => videni.length === 1);
  assert.match(videni[0], /^tel-[0-9a-f]{16}$/);
  p.ustavi("stop");
});

test("L-03 knjiga klicev: callSid __proto__ ne onesnazi Object.prototype, neveljaven callSid ne ustvari zapisa", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), PREDPONA));
  const pred = Object.getOwnPropertyNames(Object.prototype).sort();
  try {
    await zacniKlicLive({ callSid: "__proto__", from: "+38640123456", pozdrav: "Pozdravljeni." }, dir).catch(() => undefined);
    await izrekKlicateljaLive("__proto__", "Moje ime je Ana Horvat, potrebujem ponudbo.", dir).catch(() => undefined);
    await odgovorLinaLive("__proto__", "Zapisala sem.", dir).catch(() => undefined);
    await casLive("__proto__", "opozorilo", dir).catch(() => undefined);
    await zakljuciKlic("__proto__", dir).catch(() => undefined);
    const po = Object.getOwnPropertyNames(Object.prototype).sort();
    for (const k of po) if (!pred.includes(k)) delete (Object.prototype as Record<string, unknown>)[k]; // pospravi, ce bi popravek manjkal
    assert.deepEqual(po, pred, "Object.prototype mora ostati nespremenjen");
    await assert.rejects(zacniKlicLive({ callSid: "__proto__", from: "+38640123456", pozdrav: "x" }, dir), /CallSid/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ================================================================== L-04

test("L-04 prilagodilnik: zavrnjen prevzem (linija zaprta/zasedena) klic zapre, most se ne zagna, zvok do prevzema ne gre nikamor; sprejet klic se zagna", async () => {
  const stevec = { nalozi: 0 };
  const dnevnik: string[] = [];
  const p = prikljucekZaMost({ odvisnosti: () => odvisnostiMosta(stevec), posnetekPcm16: posnetekPozdrava, dnevnik: (k) => dnevnik.push(k), sprejem: async () => "zaprto" });
  const a = lazneVrata();
  p.zacni({ callId: "klic-1", remoteNumber: "" }, a.vrata);
  p.zvok(Buffer.alloc(640)); // pred prevzemom: prezrto
  await caka(() => a.v.zapri === 1);
  await premor(100);
  assert.equal(stevec.nalozi, 0, "most se ne zagna");
  assert.ok(dnevnik.includes("telefon-zavrnjen-zaprto"));
  const stevec2 = { nalozi: 0 };
  const p2 = prikljucekZaMost({ odvisnosti: () => odvisnostiMosta(stevec2), posnetekPcm16: posnetekPozdrava, sprejem: async () => null });
  p2.zacni({ callId: "klic-2", remoteNumber: "" }, lazneVrata().vrata);
  await caka(() => stevec2.nalozi === 1);
  p2.ustavi("stop");
});

test("L-04 prilagodilnik: klic, ki se konca med prevzemom, sprosti linijo; dvojni zacni med prevzemom je zavrnjen", async () => {
  const sproscene: string[] = [];
  let odpriPrevzem!: (r: string | null) => void;
  const stevec = { nalozi: 0 };
  const p = prikljucekZaMost({
    odvisnosti: () => odvisnostiMosta(stevec), posnetekPcm16: posnetekPozdrava,
    sprejem: () => new Promise<string | null>((ok) => { odpriPrevzem = ok; }), sprosti: (s) => void sproscene.push(s),
  });
  const a = lazneVrata();
  const b = lazneVrata();
  p.zacni({ callId: "klic-1", remoteNumber: "" }, a.vrata);
  p.zacni({ callId: "klic-2", remoteNumber: "" }, b.vrata);
  assert.equal(b.v.zapri, 1, "drugi klic med prevzemom prvega je zavrnjen");
  p.ustavi("odklop"); // telefon odlozi med prevzemom
  odpriPrevzem(null);
  await caka(() => sproscene.length === 1);
  assert.match(sproscene[0], /^tel-[0-9a-f]{16}$/);
  assert.equal(stevec.nalozi, 0, "most se ni zagnal");
});

test("L-04 sprejemKlicaTelefona (prave datoteke): linija zaprta, nacin prevzema in ura, en klic naenkrat skupaj s potjo Twilio", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), PREDPONA));
  try {
    const torek10 = () => new Date(2026, 10, 17, 10, 0); // delovni cas (pon-pet 8-16)
    const torek20 = () => new Date(2026, 10, 17, 20, 0);
    const osnova = await loadLine(dir);
    const line = { ...osnova, open: true, catalog: { ...osnova.catalog, company: { ...osnova.catalog.company, hours: "pon–pet 8.00–16.00" } } };
    await writeFile(path.join(dir, "line.json"), JSON.stringify(line));
    assert.equal(await sprejemKlicaTelefona(dir, "tel-a", torek10), null, "privzeto (neodgovorjeni; telefon je klic ze preusmeril): sprejme");
    sprostiAktivniKlic(dir, "tel-a");
    // en klic naenkrat: klic Twilio drzi linijo
    assert.equal(await prevzemiLinijo(dir, "twilio-klic-1"), true);
    assert.equal(await sprejemKlicaTelefona(dir, "tel-b", torek10), "zasedeno");
    sprostiAktivniKlic(dir, "twilio-klic-1");
    // dva hkratna prevzema: natanko eden uspe
    const dva = await Promise.all([prevzemiLinijo(dir, "tel-c"), prevzemiLinijo(dir, "tel-d")]);
    assert.equal(dva.filter(Boolean).length, 1);
    sprostiAktivniKlic(dir, "tel-c");
    sprostiAktivniKlic(dir, "tel-d");
    // nacin »izven delovnega casa«: v delovnem casu klic ostane pri lastniku
    await writeFile(path.join(dir, "pravila.json"), JSON.stringify({ prevzem: "izven", preusmeritev: "+38640111222" }));
    assert.equal(await sprejemKlicaTelefona(dir, "tel-e", torek10), "prevzem");
    assert.equal(await sprejemKlicaTelefona(dir, "tel-f", torek20), null);
    sprostiAktivniKlic(dir, "tel-f");
    // linija zaprta
    await writeFile(path.join(dir, "line.json"), JSON.stringify({ ...line, open: false }));
    assert.equal(await sprejemKlicaTelefona(dir, "tel-g", torek20), "zaprto");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ================================================================== L-05

test("L-05 ping brez zvoka ne podaljsa tisine: seja se zapre po roku tisine kljub pingom", async () => {
  const z = await zazeni({ rokTisine: 400 });
  try {
    const od = await klic(z);
    const konec = Date.now() + 1400;
    while (Date.now() < konec && !od.zaprta) { od.poslji(OP_PING, Buffer.alloc(0)); await premor(100); }
    assert.equal(od.zaprta, true, "ping ne sme drzati seje pri zivljenju");
    assert.equal(od.koda(), KODA.pravilnik);
  } finally { await z.zapri(); }
});

test("L-05 kvota: najvec zacetkov klica na minuto in najvec minut na dan; nad mejo 503", async () => {
  const z = await zazeni({ najvecStartovNaMinuto: 3 });
  try {
    for (let i = 0; i < 3; i++) { const od = await klic(z, `klic-${i}`); od.besedilo({ type: "stop" }); await od.cakajZaprtje(); }
    const cetrti = await odpri(z);
    assert.equal(cetrti.odziv?.status, 503);
    cetrti.zapri();
  } finally { await z.zapri(); }
  const z2 = await zazeni({ najvecMinutNaDan: 0.003 }); // 180 ms
  try {
    const od = await klic(z2);
    await premor(300);
    od.besedilo({ type: "stop" });
    await od.cakajZaprtje();
    const naslednji = await odpri(z2);
    assert.equal(naslednji.odziv?.status, 503, "dnevna kvota minut je porabljena");
    naslednji.zapri();
  } finally { await z2.zapri(); }
});

// ================================================================== L-06

test("L-06 zemljevidi mej imajo zgornjo mejo vnosov in se po izteku okna ocistijo", async () => {
  const ura = { t: 1_000_000 };
  const z = await zazeni({
    najvecVnosovMej: 20, zdaj: () => ura.t, zeton: () => "napacen-zeton-ki-je-dovolj-dolg-za-preverbo-1234",
    naslovOdjemalca: (req) => String(req.headers["x-test-naslov"] ?? "127.0.0.1"),
  });
  try {
    for (let i = 0; i < 60; i++) {
      const od = await odpri(z, { glave: { "X-Test-Naslov": `10.0.0.${i + 1}` }, zeton: ZETON });
      od.zapri();
    }
    const m = z.s.velikostMej;
    assert.ok(m.zahteve <= 20 && m.zavrnitve <= 20, `vnosov: ${JSON.stringify(m)}`);
    assert.ok(m.zahteve > 0);
    ura.t += 61_000;
    z.s.ocistiMeje();
    assert.deepEqual(z.s.velikostMej, { zahteve: 0, zavrnitve: 0, znani: 0 });
  } finally { await z.zapri(); }
});

// ================================================================== L-07

test("L-07 zavrnitve 503 po veljavnem zetonu se stejejo v isto mejo kot 401: ugibanje zetona se z locevanjem odgovorov ne pospesi", async () => {
  const z = await zazeni();
  try {
    const zaseden = await klic(z); // rezina je zasedena: veljaven zeton dobi 503
    const statusi: Array<number | null> = [];
    for (let i = 0; i < NAJVEC_ZAVRNITEV_NA_MINUTO + 5; i++) {
      const od = await odpri(z).catch(() => null);
      statusi.push(od?.odziv?.status ?? null);
      od?.zapri();
    }
    assert.ok(statusi.filter((s) => s === 503).length <= NAJVEC_ZAVRNITEV_NA_MINUTO, `503: ${statusi.join(",")}`);
    assert.equal(statusi[statusi.length - 1], null, "nad mejo brez odgovora");
    zaseden.zapri();
  } finally { await z.zapri(); }
});

// ================================================================== L-08

test("L-08 zeton v glas-telefon-zeton.json ni v cistem besedilu; star zapis se samodejno preseli brez prekinitve", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), PREDPONA));
  const vrata = await prostaVrata();
  const { priklop, d } = lazniPriklop();
  const datoteka = path.join(dir, ZETON_GLASU_TELEFONA);
  let od: Odjemalec | null = null;
  try {
    await shraniZetonGlasaTelefona(dir, ZETON);
    assert.equal(readFileSync(datoteka, "utf8").includes(ZETON), false, "zeton ne sme biti v cistem besedilu");
    assert.equal(statSync(datoteka).mode & 0o777, 0o600);
    // star zapis (pred popravkom) v cistem besedilu
    await writeFile(datoteka, JSON.stringify({ zeton: ZETON }), { mode: 0o600 });
    nastaviPrikljucekTelefona(priklop);
    await writeFile(path.join(dir, NASTAVITVE_GLASU_TELEFONA), JSON.stringify({ vklop: true, vrata }));
    await uskladiGlasTelefona(dir);
    const cert = readFileSync(path.join(dir, "glas-telefon-tls", "potrdilo.pem"), "utf8");
    od = await odpriWs({ vrata, cert, odtis: odtisPotrdila(cert) });
    assert.equal(od.odziv?.status, 101, "star zapis dela naprej (brez ponovne seznanitve)");
    od.besedilo({ type: "start", callId: "klic-1" });
    await caka(() => d.zacni.length === 1);
    await caka(() => !readFileSync(datoteka, "utf8").includes(ZETON), 3000);
    od.besedilo({ type: "stop" });
    await od.cakajZaprtje();
    od = await odpriWs({ vrata, cert, odtis: odtisPotrdila(cert) });
    assert.equal(od.odziv?.status, 101, "po preselitvi sifriran zeton se vedno velja");
  } finally {
    od?.zapri();
    await ustaviGlasTelefona();
    nastaviPrikljucekTelefona(null);
    await rm(dir, { recursive: true, force: true });
  }
});

// ================================================================== L-09

test("L-09 kljuc.pem: obstojec kljuc z odprtimi pravicami se ob zagonu popravi na 0600, zapis ne pusti zacasnih datotek", async () => {
  if (process.platform === "win32") return;
  const dir = await mkdtemp(path.join(tmpdir(), PREDPONA));
  try {
    const prvi = await potrdiloVMapi(dir, "t", "preizkus");
    const mapa = path.join(dir, "t");
    assert.equal(statSync(path.join(mapa, "kljuc.pem")).mode & 0o777, 0o600);
    chmodSync(path.join(mapa, "kljuc.pem"), 0o644);
    const drugi = await potrdiloVMapi(dir, "t", "preizkus");
    assert.equal(drugi.odtis, prvi.odtis, "potrdilo ostane isto (odtis na telefonu)");
    assert.equal(statSync(path.join(mapa, "kljuc.pem")).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(mapa).sort(), ["kljuc.pem", "potrdilo.pem"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ================================================================== L-10

test("L-10 close z 1 B vsebine je protokolna napaka (RFC 6455 5.5.1), ne normalno zapiranje", async () => {
  const z = await zazeni();
  try {
    const od = await klic(z);
    od.poslji(OP_ZAPRI, Buffer.from([0x03]));
    await od.cakajZaprtje();
    assert.equal(od.koda(), KODA.protokol);
    assert.deepEqual(z.d.ustavi, ["napaka"]);
  } finally { await z.zapri(); }
});

// ================================================================== pospravljeno

test("L-popravki po preizkusih ni ostalo nic: ni vrat, ni priklopa, ni map", async () => {
  await ustaviGlasTelefona();
  assert.equal(glasTelefonaTece(), false);
  assert.equal(prikljucekTelefona(), null);
  assert.deepEqual(readdirSync(tmpdir()).filter((x) => x.startsWith(PREDPONA)), []);
});
