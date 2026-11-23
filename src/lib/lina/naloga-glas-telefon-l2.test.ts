// Popravki drugega slepega pregleda poti telefona (POROCILO-L-PREGLED2, 15. 11. 2026): N-1 ... N-8.
// Vsak varnostni preizkus je preverjen BREZ popravka (orodja/lina-glas-telefon-mutacije2.py umakne popravek v kopiji): brez njega pade, z njim uspe.
// Pravi TLS in pravi WebSocket (odjemalec kot telefon), samo 127.0.0.x, nakljucna vrata.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import tls from "node:tls";
import { test } from "node:test";
import {
  GlasTelefonStreznik, NASTAVITVE_GLASU_TELEFONA, ZETON_GLASU_TELEFONA, NAJVEC_BAJTOV_NA_S, NAJVEC_PCM, kljucNaslova, nastaviPrikljucekTelefona, primerjajZeton, shraniZetonGlasaTelefona,
  uskladiGlasTelefona, ustaviGlasTelefona, type PrikljucekTelefona, type RazlogKonca, type VrataTelefona,
} from "./glas-telefon.server.ts";
import { KODA } from "./glas-telefon-ws.ts";
import { odsifrirajSkrivnost } from "./keys.server.ts";
import { odtisPotrdila, potrdiloVMapi } from "./zasebno-omrezje.server.ts";
import { Odjemalec, ZETON, caka, odpri, odpriWs, premor } from "./glas-telefon-odjemalec.preizkus.ts";

const PREDPONA = "glas-tel-l2-";

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
const pcm = (n: number, v = 1) => Buffer.alloc(n, v);
/** Odjemalec poslje `okvirjev` okvirjev v REALNEM casu (en na 20 ms, urnik po uri, ne po premorih), kot OpenLine. */
async function realniCas(okvirjev: number, poslji: (i: number) => void, ms = 20): Promise<void> {
  const t0 = Date.now();
  for (let i = 0; i < okvirjev; i++) {
    poslji(i);
    const cakaj = t0 + (i + 1) * ms - Date.now();
    if (cakaj > 0) await premor(cakaj);
  }
}
type TlsMoznosti = tls.ConnectionOptions & { localAddress?: string };
const prazna = (z: { vrata: number; cert: string }, naslov: string): tls.TLSSocket => {
  const v = tls.connect({ host: "127.0.0.1", port: z.vrata, localAddress: naslov, ca: z.cert, checkServerIdentity: () => undefined } as TlsMoznosti);
  v.on("error", () => undefined);
  return v;
};

// ================================================================== N-0 (L6)

// Obstojeci preizkusi tega niso ujeli: preizkus »brez starta v roku« ni imel veljavnega starta, preizkus tisine pa je imel rokZacetka 5000 ms in
// je seja koncala zaradi tisine PREJ, kot bi se rok starta sprozil. Nihce ni cakal cez rokZacetka po veljavnem startu.
test("N-0 veljaven start, nato cakanje cez rokZacetka: povezava ostane odprta (dolg pozdrav, klic tece)", async () => {
  const z = await zazeni({ rokZacetka: 200, rokTisine: 5000 });
  try {
    const od = await klic(z);
    await premor(800); // 4 x rokZacetka
    assert.equal(od.zaprta, false, `klic prekinjen (koda ${od.koda()}) po roku starta, ceprav je start prisel`);
    assert.deepEqual(z.d.ustavi, []);
    od.dvojisko(pcm(640));
    await caka(() => z.d.zvok.length === 1);
    od.besedilo({ type: "stop" });
    await od.cakajZaprtje();
    assert.deepEqual(z.d.ustavi, ["stop"]);
  } finally { await z.zapri(); }
});

// ================================================================== N-3

test("N-3 posten tok JSON »media« v realnem casu (50 x 640 B PCM = 32 kB/s zvoka, ~44 kB/s na zici) 4 s ni zavrnjen", async () => {
  const z = await zazeni();
  try {
    const od = await klic(z);
    const b64 = pcm(640, 3).toString("base64");
    await realniCas(200, () => od.besedilo({ type: "media", pcm16k: b64 }));
    await caka(() => z.d.zvok.length === 200 || od.zaprta, 2000).catch(() => undefined);
    assert.equal(od.zaprta, false, `tok je bil zavrnjen (koda ${od.koda()}), prepusceno ${z.d.zvok.length}`);
    assert.equal(z.d.zvok.length, 200);
    od.besedilo({ type: "stop" });
    await od.cakajZaprtje();
  } finally { await z.zapri(); }
});

test("N-3 dvojiski tok v realnem casu 4 s in salva po 0,5 s zamude Wi-Fi (25 okvirjev naenkrat) ni zavrnjena", async () => {
  const z = await zazeni();
  try {
    const od = await klic(z);
    await realniCas(100, () => od.dvojisko(pcm(640)));
    await premor(500);
    for (let i = 0; i < 25; i++) od.dvojisko(pcm(640));
    await realniCas(50, () => od.dvojisko(pcm(640)));
    await caka(() => z.d.zvok.length === 175 || od.zaprta, 2000).catch(() => undefined);
    assert.equal(od.zaprta, false, `tok je bil zavrnjen (koda ${od.koda()}), prepusceno ${z.d.zvok.length}`);
    assert.equal(z.d.zvok.length, 175);
    od.besedilo({ type: "stop" });
    await od.cakajZaprtje();
  } finally { await z.zapri(); }
});

test("N-3 hitrejsi tok od realnega casa se se vedno zavrne: JSON »media« in dvojisko (20 x 6000 B = 120 kB v nekaj ms)", async () => {
  assert.ok(NAJVEC_BAJTOV_NA_S >= 32_000 && NAJVEC_BAJTOV_NA_S <= 32_000 * 1.6, "meja zvoka: realni cas + najvec 60 %");
  for (const vrsta of ["media", "dvojisko"] as const) {
    const z = await zazeni();
    try {
      const od = await klic(z);
      const b64 = pcm(NAJVEC_PCM).toString("base64");
      for (let i = 0; i < 20; i++) { if (vrsta === "media") od.besedilo({ type: "media", pcm16k: b64 }); else od.dvojisko(pcm(NAJVEC_PCM)); }
      await od.cakajZaprtje();
      assert.equal(od.koda(), KODA.pravilnik, vrsta);
      assert.ok(z.d.zvok.length < 20, `${vrsta}: prepusceno ${z.d.zvok.length}`);
      await caka(() => z.d.ustavi.length === 1);
      assert.deepEqual(z.d.ustavi, ["napaka"]);
    } finally { await z.zapri(); }
  }
});

// ================================================================== N-1

test("N-1 napadalec brez zetona z 2 naslovoma x 4 praznimi povezavami (obnavljane) ne zapre vrat: telefon z veljavnim zetonom uspe v 15 s", async () => {
  // rok pred nadgradnjo je dolg, da povezav ne zapre cas (sicer bi preizkus uspel tudi brez popravka v vrzeli ob obnovi)
  const z = await zazeni({ rokPredNadgradnjo: 60_000, rokRokovanja: 60_000 });
  const ustavi = { b: false };
  const odprte = new Set<tls.TLSSocket>();
  const zanke: Array<Promise<void>> = [];
  for (const naslov of ["127.0.0.2", "127.0.0.3"]) {
    for (let i = 0; i < 4; i++) {
      zanke.push((async () => {
        while (!ustavi.b) {
          const v = prazna(z, naslov);
          odprte.add(v);
          await new Promise<void>((ok) => v.once("close", () => ok()));
          odprte.delete(v);
          await premor(20);
        }
      })());
    }
  }
  try {
    await premor(300);
    const konec = Date.now() + 15_000;
    let status = 0;
    while (Date.now() < konec && status !== 101) {
      const od = await odpri(z).catch(() => null);
      status = od?.odziv?.status ?? 0;
      od?.zapri();
      if (status !== 101) await premor(300);
    }
    assert.equal(status, 101, "telefon z veljavnim zetonom mora uspeti kljub preplavljanju s praznimi povezavami");
  } finally {
    ustavi.b = true;
    for (const v of odprte) v.destroy();
    await Promise.all(zanke);
    await z.zapri();
  }
});

test("N-1 napadalec z mnogimi naslovi (po 1 povezava) zapolni splosno mejo in rezervo: nov naslov izpodrine nepotrjeno povezavo, potrjena seja ostane", async () => {
  const z = await zazeni({ rokPredNadgradnjo: 60_000, rokRokovanja: 60_000 });
  const vse: tls.TLSSocket[] = [];
  try {
    const seja = await klic(z); // potrjena povezava (127.0.0.1): ne sme biti izpodrinjena
    for (let i = 2; i <= 14; i++) { vse.push(prazna(z, `127.0.0.${i}`)); await premor(30); }
    const nov = prazna(z, "127.0.0.15");
    vse.push(nov);
    const povezan = await Promise.race([new Promise<boolean>((ok) => { nov.once("secureConnect", () => ok(true)); nov.once("close", () => ok(false)); }), premor(3000).then(() => false)]);
    assert.equal(povezan, true, "nov naslov (pravi telefon) mora priti skozi, tudi ko je vse zasedeno");
    assert.equal(seja.zaprta, false, "potrjena seja ni izpodrinjena");
    seja.besedilo({ type: "stop" });
    await seja.cakajZaprtje();
  } finally { for (const v of vse) v.destroy(); await z.zapri(); }
});

test("N-1 kljucNaslova: IPv4 po naslovu, IPv6 po /64 (tudi skrajsan zapis), preslikani IPv4 kot IPv4", () => {
  assert.equal(kljucNaslova("192.168.1.5"), "192.168.1.5");
  assert.equal(kljucNaslova("::ffff:192.168.1.5"), "192.168.1.5");
  assert.equal(kljucNaslova("fd00:1:2:3:aaaa:bbbb:cccc:dddd"), kljucNaslova("fd00:1:2:3::1"));
  assert.equal(kljucNaslova("fd00::5"), kljucNaslova("fd00:0:0:0:1:2:3:4"));
  assert.notEqual(kljucNaslova("fd00:1:2:3::1"), kljucNaslova("fd00:1:2:4::1"));
});

// ================================================================== N-2

test("N-2 zahteva, ki je prebrala STARI zeton, ne prezivi zamenjave zetona (prekiniSeje med branjem zetona): brez seje", async () => {
  let vToku: () => void = () => undefined;
  const potek = new Promise<void>((ok) => { vToku = ok; });
  const z = await zazeni({ zeton: async () => { vToku(); await premor(150); return ZETON; } });
  try {
    const p = odpri(z);
    await potek;
    z.s.prekiniSeje("zeton"); // lastnik zamenja zeton: nadgradnja je stari zeton ze zacela brati
    const od = await p;
    assert.notEqual(od.odziv?.status, 101, "zahteva s starim zetonom ne sme postati seja");
    assert.equal(od.odziv?.status, 401);
    assert.equal(z.d.zacni.length, 0);
    assert.equal(z.s.klicTece, false, "rezina ni zasedena");
    od.zapri();
  } finally { await z.zapri(); }
});

test("N-2 po preklicu nova zahteva z (zdaj veljavnim) zetonom normalno uspe", async () => {
  const z = await zazeni();
  try {
    z.s.prekiniSeje("zeton");
    const od = await klic(z);
    assert.equal(od.zaprta, false);
    od.besedilo({ type: "stop" });
    await od.cakajZaprtje();
  } finally { await z.zapri(); }
});

// ================================================================== N-4

test("N-4 star zapis zetona v cistem besedilu (0644): ce sifriranje ne uspe, ne ostane odprt (0600) in zeton ne velja (fail-closed)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), PREDPONA));
  const vrata = await prostaVrata();
  const { priklop } = lazniPriklop();
  const datoteka = path.join(dir, ZETON_GLASU_TELEFONA);
  try {
    await writeFile(datoteka, JSON.stringify({ zeton: ZETON }), { mode: 0o644 });
    chmodSync(datoteka, 0o644);
    mkdirSync(path.join(dir, ".kljuc")); // glavni kljuc nedostopen: sifriranje ne more uspeti
    await writeFile(path.join(dir, NASTAVITVE_GLASU_TELEFONA), JSON.stringify({ vklop: true, vrata }));
    nastaviPrikljucekTelefona(priklop);
    await uskladiGlasTelefona(dir);
    const st = statSync(datoteka);
    assert.equal(st.mode & 0o077, 0, `pravice ${(st.mode & 0o777).toString(8)}: cisto besedilo ne sme biti berljivo drugim`);
    const cert = readFileSync(path.join(dir, "glas-telefon-tls", "potrdilo.pem"), "utf8");
    const od = await odpri({ vrata, cert, odtis: odtisPotrdila(cert) }).catch(() => null);
    assert.notEqual(od?.odziv?.status, 101, "zeton, ki ga ni mogoce sifrirati, ne velja (fail-closed)");
    od?.zapri();
  } finally {
    nastaviPrikljucekTelefona(null);
    await ustaviGlasTelefona();
    await rm(dir, { recursive: true, force: true });
  }
});

test("N-4 migracija se opravi ob zagonu (uskladi), ne sele ob prvi povezavi; sifra je vezana na namen (AAD)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), PREDPONA));
  const datoteka = path.join(dir, ZETON_GLASU_TELEFONA);
  try {
    await writeFile(datoteka, JSON.stringify({ zeton: ZETON }), { mode: 0o644 });
    await uskladiGlasTelefona(dir); // stikalo izklopljeno, a star zapis se preseli takoj
    const vsebina = readFileSync(datoteka, "utf8");
    assert.ok(!vsebina.includes(ZETON), "cistega zetona ni vec v datoteki");
    assert.equal(statSync(datoteka).mode & 0o077, 0);
    const sifra = (JSON.parse(vsebina) as { sifra: { iv: string; tag: string; ciphertext: string } }).sifra;
    assert.equal(await odsifrirajSkrivnost(sifra, dir, "lina.glas-telefon.zeton.v1"), ZETON);
    assert.equal(await odsifrirajSkrivnost(sifra, dir), null, "sifra brez AAD se ne odpre: zamenjava z drugo skrivnostjo iz iste mape ne da zetona");
    await shraniZetonGlasaTelefona(dir, ZETON + "x");
    const nova = (JSON.parse(readFileSync(datoteka, "utf8")) as { sifra: { iv: string; tag: string; ciphertext: string } }).sifra;
    assert.equal(await odsifrirajSkrivnost(nova, dir), null, "novi zapis je tudi z AAD");
  } finally { await ustaviGlasTelefona(); await rm(dir, { recursive: true, force: true }); }
});

// ================================================================== N-6

// L3-N6 (zagotoviPravice v zasebno-omrezje.server.ts): ce chmod ne uspe, odloci STVARNO stanje pravic. Stroge (0700 mapa, 0600 kljuc) = nadaljuje z istim
// potrdilom; odprte = jasna napaka in NIC novega (telefon ne izgubi seznanitve, odtis ostane). Starejsa razlicica tega preizkusa je zahtevala napako
// tudi pri strogih pravicah, kar koda od L3-N6 namenoma ne dela (datotecni sistem brez chmod, npr. FAT/NTFS, bi sicer nikoli ne zagnal glasu telefona).
test("N-6 neuspeh chmod pri ze strogih pravicah: zagon nadaljuje z ISTIM potrdilom (odtis ostane)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), PREDPONA));
  try {
    const prvo = await potrdiloVMapi(dir, "t", "Preizkus");
    const pc = path.join(dir, "t", "potrdilo.pem");
    const pk = path.join(dir, "t", "kljuc.pem");
    const certPred = readFileSync(pc, "utf8");
    const kljucPred = readFileSync(pk, "utf8");
    assert.equal(statSync(pk).mode & 0o077, 0, "izhodisce: kljuc ima stroge pravice");
    const drugo = await potrdiloVMapi(dir, "t", "Preizkus", async () => { throw Object.assign(new Error("EPERM"), { code: "EPERM" }); });
    assert.equal(drugo.odtis, prvo.odtis, "odtis ostane");
    assert.equal(readFileSync(pc, "utf8"), certPred, "potrdilo ni zamenjano");
    assert.equal(readFileSync(pk, "utf8"), kljucPred, "kljuc ni zamenjan");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("N-6 neuspeh chmod pri ODPRTIH pravicah kljuca javi napako in NE ustvari novega potrdila (odtis ostane)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), PREDPONA));
  try {
    const prvo = await potrdiloVMapi(dir, "t", "Preizkus");
    const pc = path.join(dir, "t", "potrdilo.pem");
    const pk = path.join(dir, "t", "kljuc.pem");
    chmodSync(pk, 0o644);
    const certPred = readFileSync(pc, "utf8");
    const kljucPred = readFileSync(pk, "utf8");
    await assert.rejects(potrdiloVMapi(dir, "t", "Preizkus", async () => { throw Object.assign(new Error("EPERM"), { code: "EPERM" }); }), /EPERM/);
    assert.equal(readFileSync(pc, "utf8"), certPred, "potrdilo ni zamenjano");
    assert.equal(readFileSync(pk, "utf8"), kljucPred, "kljuc ni zamenjan");
    chmodSync(pk, 0o600);
    const drugo = await potrdiloVMapi(dir, "t", "Preizkus");
    assert.equal(drugo.odtis, prvo.odtis, "ob uspehu (pravice popravljene) isti odtis");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ================================================================== N-7

test("N-7 en vir stanja aktivniKlici: dve instanci modula voice.server.ts vidita isto linijo (en klic naenkrat)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), PREDPONA));
  type Glas = typeof import("./voice.server.ts");
  const spA = "./voice.server.ts?instanca-a";
  const spB = "./voice.server.ts?instanca-b";
  const A = (await import(spA)) as Glas;
  const B = (await import(spB)) as Glas;
  try {
    assert.notEqual(A.prevzemiLinijo, B.prevzemiLinijo, "preizkus potrebuje dve locene instanci modula");
    assert.equal(await A.prevzemiLinijo(dir, "tel-a"), true);
    assert.equal(await B.prevzemiLinijo(dir, "tel-b"), false, "druga instanca modula mora videti zasedeno linijo");
    assert.equal(B.klicTece(dir), true);
    A.sprostiAktivniKlic(dir, "tel-a");
    assert.equal(B.klicTece(dir), false, "sprostitev v eni instanci velja v drugi");
  } finally {
    A.sprostiAktivniKlic(dir, "tel-a");
    B.sprostiAktivniKlic(dir, "tel-b");
    await rm(dir, { recursive: true, force: true });
  }
});

test("L2-popravki po preizkusih ni ostalo nic: ni vrat, ni priklopa", async () => {
  nastaviPrikljucekTelefona(null);
  await ustaviGlasTelefona();
  const { glasTelefonaTece, prikljucekTelefona } = await import("./glas-telefon.server.ts");
  assert.equal(glasTelefonaTece(), false);
  assert.equal(prikljucekTelefona(), null);
});
