// Dodatki na racunalniku s telefona ozjega kroga (lastnik 23. 11. 2026). Pravi TLS streznika asistentke, pravi podpisi EC P-256,
// lazni Docker, namestitev in RSDO (preizkus se pravih vsebnikov ne dotakne). Linina stran orodja dodatki z laznim kanalom.
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { request } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { IzvajalecClaudeCode, type Dogodek, type Izvajalec } from "./asistent.server.ts";
import { AsistentStreznik, POT, POTI_ODDALJENO, potrdiloAsistenta } from "./asistent-streznik.server.ts";
import { nastaviPreverjanjeVrat, type Izvajalec as Docker } from "./dodatki.server.ts";
import { nastaviDodatekZaTelefon, opisStanjaDodatkov, stanjeDodatkovZaTelefon } from "./dodatki-telefon.server.ts";
import {
  ORODJE_DODATKI, dokazPrijave, idIzKljuca, nizDodatka, nizOdobritve, nizStanja, nizStanjaDodatkov, opisDodatka, potVticnice, predogledDodatka,
  zgostitevPrikaza, type DodatekTelefona, type Dokaz,
} from "./kanal-claude.ts";
import { preberiKanal, pripraviKanal } from "./kanal-claude.server.ts";
import { loadPravila, nastaviDodatekIzTelefona, poSpremembiDodatkov, type UskladitevDodatkov } from "./pravila.server.ts";

const premor = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function caka(pogoj: () => boolean, ms = 5000): Promise<void> {
  const konec = Date.now() + ms;
  while (!pogoj()) {
    if (Date.now() > konec) throw new Error("rok cakanja potekel");
    await premor(20);
  }
}

type Naprava = { id: string; kljuc: string; zasebni: KeyObject };
function naprava(): Naprava {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const kljuc = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  return { id: idIzKljuca(kljuc), kljuc, zasebni: privateKey };
}
const ANA = naprava();   // v ozjem krogu
const TUJA = naprava();  // ni v krogu
const BOR = naprava();   // v krogu, a ni dala naloge
const enkratni = () => randomBytes(16).toString("base64url");
function podpisi(d: Naprava, niz: (c: number, e: string) => string, cas = Date.now(), e = enkratni()): Dokaz {
  return { cas, enkratni: e, podpis: sign("sha256", Buffer.from(niz(cas, e)), d.zasebni).toString("base64") };
}

function zahteva(vrata: number, cert: string, odtis: string, metoda: string, pot: string, telo?: unknown): Promise<{ status: number; telo: any }> {
  return new Promise((ok, ne) => {
    const r = request({
      host: "127.0.0.1", port: vrata, method: metoda, path: pot, ca: cert, rejectUnauthorized: true,
      checkServerIdentity: (_h, c) => (c.fingerprint256.replace(/:/g, "").toLowerCase() === odtis ? undefined : new Error("odtis")),
      headers: telo === undefined ? {} : { "content-type": "application/json" },
    }, (res) => {
      const k: Buffer[] = [];
      res.on("data", (d) => k.push(d));
      res.on("end", () => {
        const s = Buffer.concat(k).toString("utf8");
        let j: unknown = s;
        try { j = JSON.parse(s); } catch { /* ni JSON */ }
        ok({ status: res.statusCode ?? 0, telo: j });
      });
    });
    r.on("error", ne);
    r.end(telo === undefined ? undefined : JSON.stringify(telo));
  });
}

const neIzvajalec: Izvajalec = {
  ime: "lazni", razpolozljiv: async () => true, zacni: async () => {}, odobri: async () => {}, ustavi: async () => {},
};

/** Streznik asistentke z laznim zaledjem dodatkov (zapise klice). */
async function streznik(o: { dodatki?: boolean } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-dod-"));
  await pripraviKanal([{ id: ANA.id, kljuc: ANA.kljuc }], dir);
  const klici: Array<[DodatekTelefona, boolean]> = [];
  let branja = 0;
  const s = new AsistentStreznik({
    root: dir, izvajalec: neIzvajalec, dnevnik: () => {},
    dodatki: o.dodatki === false ? undefined : {
      stanje: async () => { branja++; return { dodatki: [{ id: "n8n", vklopljen: false, stanje: "izklopljen", razlog: "" }] }; },
      nastavi: async (d, v) => { klici.push([d, v]); return { dodatki: [{ id: d, vklopljen: v, stanje: v ? "se_zaganja" : "izklopljen", razlog: "" }] }; },
    },
  });
  const { vrata, odtis } = await s.zazeni();
  const { cert } = await potrdiloAsistenta(dir);
  const z = (metoda: string, pot: string, telo?: unknown) => zahteva(vrata, cert, odtis, metoda, pot, telo);
  return { z, klici, branja: () => branja, pospravi: async () => { await s.ustavi(); await rm(dir, { recursive: true, force: true }); } };
}
const urlStanja = (d: Naprava, p: Dokaz, posiljatelj = d.id) =>
  `${POT}/dodatki?posiljatelj=${posiljatelj}&cas=${p.cas}&enkratni=${p.enkratni}&podpis=${encodeURIComponent(p.podpis)}`;
const teloPreklopa = (d: Naprava, dodatek: DodatekTelefona, vklop: boolean, p = podpisi(d, (c, e) => nizDodatka(d.id, dodatek, vklop, c, e))) =>
  ({ posiljatelj: d.id, dodatek, vklop, ...p });

test("dodatki: stanje bere samo podpisana naprava ozjega kroga; tuja naprava, podpis seje, ponovitev in nepodpisano se zavrnejo", async () => {
  const s = await streznik();
  try {
    const p = podpisi(ANA, (c, e) => nizStanjaDodatkov(ANA.id, c, e));
    const r = await s.z("GET", urlStanja(ANA, p));
    assert.equal(r.status, 200, JSON.stringify(r.telo));
    assert.deepEqual(r.telo.dodatki[0], { id: "n8n", vklopljen: false, stanje: "izklopljen", razlog: "" });
    assert.equal((await s.z("GET", urlStanja(ANA, p))).status, 403);                                         // isti enkratni niz
    assert.equal((await s.z("GET", urlStanja(TUJA, podpisi(TUJA, (c, e) => nizStanjaDodatkov(TUJA.id, c, e))))).status, 403); // ni v krogu
    assert.equal((await s.z("GET", urlStanja(ANA, podpisi(ANA, (c, e) => nizStanja(ANA.id, c, e))))).status, 403);  // podpis seje ne velja
    assert.equal((await s.z("GET", `${POT}/dodatki?posiljatelj=${ANA.id}`)).status, 400);                     // brez podpisa
    assert.equal(s.branja(), 1);
  } finally {
    await s.pospravi();
  }
});

test("dodatki: preklop velja samo za podpisani dodatek in smer; zamenjana smer ali dodatek, podpis stanja, tuja naprava in ponovitev nimajo ucinka", async () => {
  const s = await streznik();
  try {
    const dobro = teloPreklopa(ANA, "n8n", true);
    const r = await s.z("POST", `${POT}/dodatek`, dobro);
    assert.equal(r.status, 200, JSON.stringify(r.telo));
    assert.deepEqual(s.klici, [["n8n", true]]);
    assert.equal((await s.z("POST", `${POT}/dodatek`, dobro)).status, 403);                                   // ponovitev
    assert.equal((await s.z("POST", `${POT}/dodatek`, { ...teloPreklopa(ANA, "n8n", true), vklop: false })).status, 403);       // smer obrnjena
    assert.equal((await s.z("POST", `${POT}/dodatek`, { ...teloPreklopa(ANA, "n8n", true), dodatek: "slovenski" })).status, 403); // drug dodatek
    const pStanja = podpisi(ANA, (c, e) => nizStanjaDodatkov(ANA.id, c, e));
    assert.equal((await s.z("POST", `${POT}/dodatek`, { posiljatelj: ANA.id, dodatek: "n8n", vklop: true, ...pStanja })).status, 403);
    assert.equal((await s.z("POST", `${POT}/dodatek`, teloPreklopa(TUJA, "n8n", true))).status, 403);       // ni v krogu
    assert.equal((await s.z("POST", `${POT}/dodatek`, { ...teloPreklopa(ANA, "n8n", true), dodatek: "programi" })).status, 400); // ni na seznamu
    assert.equal((await s.z("POST", `${POT}/dodatek`, { ...teloPreklopa(ANA, "n8n", true), vklop: "da" })).status, 400);
    const izklop = await s.z("POST", `${POT}/dodatek`, teloPreklopa(ANA, "slovenski", false));
    assert.equal(izklop.status, 200);
    assert.deepEqual(s.klici, [["n8n", true], ["slovenski", false]]);
  } finally {
    await s.pospravi();
  }
});

test("dodatki: brez zaledja poti ne obstajata (404); oddaljena pot (prehod) dovoli GET /dodatki in POST /dodatek", async () => {
  const s = await streznik({ dodatki: false });
  try {
    assert.equal((await s.z("POST", `${POT}/dodatek`, teloPreklopa(ANA, "n8n", true))).status, 404);
    assert.equal((await s.z("GET", urlStanja(ANA, podpisi(ANA, (c, e) => nizStanjaDodatkov(ANA.id, c, e))))).status, 404);
  } finally {
    await s.pospravi();
  }
  assert.equal(POTI_ODDALJENO.get(`${POT}/dodatki`), "GET");
  assert.equal(POTI_ODDALJENO.get(`${POT}/dodatek`), "POST");
});

/** Lazna uskladitev: zapise, kaj bi se zagnalo (Docker, namestitev, RSDO). */
function laznaUskladitev() {
  const dnevnik: string[] = [];
  const u: UskladitevDodatkov = {
    namestiSlovenskega: () => { dnevnik.push("namesti"); },
    uskladiRsdo: async (v) => { dnevnik.push(`rsdo:${v}`); },
    uskladiDodatke: async (d) => { dnevnik.push(`docker:${JSON.stringify({ paperclip: d?.paperclip, n8n: d?.n8n, affine: d?.affine })}`); },
  };
  return { u, dnevnik };
}

test("dodatki: telefon spremeni samo svoje stikalo v pravila.json; Docker se uskladi ob spremembi, namestitev slovenskega samo ob izklop->vklop", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-dod-p-"));
  try {
    const prej = { navodila: "Bodi kratka.", imeLastnika: "Lastnik", dodatki: { paperclip: true, n8n: false, affine: false, programi: true, slovenski: false }, neznano: 7 };
    writeFileSync(path.join(dir, "pravila.json"), JSON.stringify(prej));
    const { u, dnevnik } = laznaUskladitev();
    await nastaviDodatekIzTelefona("n8n", true, dir, u);
    const po = JSON.parse(readFileSync(path.join(dir, "pravila.json"), "utf8"));
    assert.deepEqual(po, { ...prej, dodatki: { ...prej.dodatki, n8n: true } });
    await premor(10);
    assert.deepEqual(dnevnik, ['docker:{"paperclip":true,"n8n":true,"affine":false}']);
    await nastaviDodatekIzTelefona("n8n", true, dir, u);                                            // brez spremembe: nic
    await premor(10);
    assert.equal(dnevnik.length, 1);
    await nastaviDodatekIzTelefona("slovenski", true, dir, u);
    await premor(10);
    assert.deepEqual(dnevnik.slice(1), ["namesti", "rsdo:true"]);
    await nastaviDodatekIzTelefona("slovenski", false, dir, u);
    await premor(10);
    assert.deepEqual(dnevnik.slice(3), ["rsdo:false"]);
    // hkratna preklopa ne izgubita drug drugega (zaporedni zapisi)
    await Promise.all([nastaviDodatekIzTelefona("affine", true, dir, u), nastaviDodatekIzTelefona("paperclip", false, dir, u)]);
    const konec = JSON.parse(readFileSync(path.join(dir, "pravila.json"), "utf8"));
    assert.equal(konec.dodatki.affine, true);
    assert.equal(konec.dodatki.paperclip, false);
    assert.equal(konec.navodila, "Bodi kratka.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dodatki: poskodovana pravila.json se ne prepisejo; brez datoteke telefon ustvari samo stikalo", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-dod-x-"));
  try {
    const { u, dnevnik } = laznaUskladitev();
    await nastaviDodatekIzTelefona("affine", true, dir, u);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "pravila.json"), "utf8")), { dodatki: { affine: true } });
    writeFileSync(path.join(dir, "pravila.json"), "[1,2]");
    await assert.rejects(nastaviDodatekIzTelefona("n8n", true, dir, u));
    assert.equal(readFileSync(path.join(dir, "pravila.json"), "utf8"), "[1,2]");
    await premor(10);
    assert.equal(dnevnik.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dodatki: stanje za telefon = shranjeno stikalo + dejansko stanje; branje Dockerja samo pregleda (nic ne zazene)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-dod-s-"));
  const prejVrata = nastaviPreverjanjeVrat(async () => true);
  try {
    writeFileSync(path.join(dir, "pravila.json"), JSON.stringify({ dodatki: { n8n: true, slovenski: true } }));
    const ukazi: string[][] = [];
    const docker: Docker = async (args) => {
      ukazi.push(args);
      if (args.at(-1) === "lina-dodatek-n8n") return { koda: 0, izhod: "running" };
      return { koda: 1, izhod: "Error: No such container: x" };
    };
    const s = await stanjeDodatkovZaTelefon(dir, { docker, slovenski: () => ({ stanje: "napaka", razlog: "namestitev-ni-uspela" }) });
    assert.deepEqual(s.dodatki, [
      { id: "paperclip", vklopljen: false, stanje: "izklopljen", razlog: "" },
      { id: "n8n", vklopljen: true, stanje: "deluje", razlog: "" },
      { id: "affine", vklopljen: false, stanje: "ni_na_voljo", razlog: "" },
      { id: "slovenski", vklopljen: true, stanje: "napaka", razlog: "namestitev-ni-uspela" },
    ]);
    assert.ok(ukazi.every((a) => a[0] === "container" && a[1] === "inspect"), JSON.stringify(ukazi));
    assert.match(opisStanjaDodatkov(s), /^paperclip: stikalo izklopljeno, stanje izklopljen\nn8n: stikalo vklopljeno, stanje deluje\n/);
    const { u } = laznaUskladitev();
    const po = await nastaviDodatekZaTelefon("paperclip", true, dir, { docker, slovenski: () => ({ stanje: "izklopljen", razlog: "" }), uskladitev: u });
    assert.equal(po.dodatki[0].vklopljen, true);
  } finally {
    nastaviPreverjanjeVrat(prejVrata);
    await rm(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ Linina stran orodja dodatki (lazni kanal)

/** Lazni kanal: opravi prijavo z zetonom kanala, zapise, kar posilja Lina, in poslje, kar preizkus zeli. */
async function lazniKanal(dir: string) {
  const { zeton } = await preberiKanal(dir);
  const pot = potVticnice(dir);
  const prejeto: Array<Record<string, any>> = [];
  let sock: net.Socket | null = null;
  const srv = net.createServer((s) => {
    sock = s;
    let ost = "";
    s.setEncoding("utf8");
    s.on("data", (d: string) => {
      ost += d;
      let i: number;
      while ((i = ost.indexOf("\n")) >= 0) {
        const m = JSON.parse(ost.slice(0, i));
        ost = ost.slice(i + 1);
        prejeto.push(m);
        if (m.vrsta === "pozdrav") {
          const sv = randomBytes(24).toString("base64url");
          s.write(JSON.stringify({ vrsta: "izziv", s: sv, dokaz: dokazPrijave(zeton!, "streznik", m.c, sv) }) + "\n");
        } else if (m.vrsta === "prijava") {
          s.write(JSON.stringify({ vrsta: "pozdravljen", seja: true, apiKljuc: false, aktivne: [] }) + "\n");
        }
      }
    });
  });
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(pot), { recursive: true, mode: 0o700 });
  await new Promise<void>((ok) => srv.listen(pot, ok));
  return {
    pot, prejeto, poslji: (o: unknown) => sock!.write(JSON.stringify(o) + "\n"),
    zapri: () => new Promise<void>((ok) => { sock?.destroy(); srv.close(() => ok()); }),
  };
}

test("orodje dodatki (Lina): stanje takoj; preklop samo po zahtevi, ki jo je Lina pokazala, in podpisani »Dovoli« iste naprave za isti dodatek in smer", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-dod-l-"));
  await pripraviKanal([{ id: ANA.id, kljuc: ANA.kljuc }], dir);
  const k = await lazniKanal(dir);
  const preklopi: Array<[DodatekTelefona, boolean]> = [];
  const l = new IzvajalecClaudeCode({
    pot: k.pot, zeton: async () => (await preberiKanal(dir)).zeton, ozjiKrog: () => new Set([ANA.id, BOR.id]),
    dodatki: { stanje: async () => "n8n: stikalo izklopljeno", nastavi: async (d, v) => { preklopi.push([d, v]); return "ok"; } },
  });
  const izidi = () => k.prejeto.filter((m) => m.vrsta === "dodatkiIzid");
  try {
    const dogodki: Dogodek[] = [];
    const chatId = "naloga-dodatki-01";
    await l.zacni({ id: chatId, besedilo: "vklopi n8n", posiljatelj: ANA.id, izvor: "asistent" }, (d) => dogodki.push(d));
    await caka(() => k.prejeto.some((m) => m.vrsta === "naloga"));

    k.poslji({ vrsta: "dodatki", zahteva: "s-stanje-01", chatId, dejanje: "stanje" });
    await caka(() => izidi().length === 1);
    assert.deepEqual(izidi()[0], { vrsta: "dodatkiIzid", zahteva: "s-stanje-01", ok: true, besedilo: "n8n: stikalo izklopljeno" });

    // kanal (ali kdor ima zeton) brez odobritve: nic
    k.poslji({ vrsta: "dodatki", zahteva: "abcde", chatId, dejanje: "vklopi", dodatek: "n8n" });
    await caka(() => izidi().length === 2);
    assert.equal(izidi()[1].ok, false);

    // zgostitev prikaza, ki jo naprava podpise (zadnja pokazana za ta ID, razen ce preizkus poda drugo)
    const pokazane = new Map<string, string>();
    const pokazi = (zahtevaId: string, predogled: string, orodje = ORODJE_DODATKI) => {
      const opis = opisDodatka("n8n", true);
      const zg = zgostitevPrikaza(orodje, predogled, opis);
      pokazane.set(zahtevaId, zg);
      k.poslji({ vrsta: "odobritev", chatId, zahtevaId, orodje, opis, predogled, zgostitev: zg });
    };
    const dovoli = (zahtevaId: string, d = true, n = ANA, zg = pokazane.get(zahtevaId) ?? "0".repeat(64)) =>
      l.odobri(chatId, zahtevaId, d, n.id, podpisi(n, (c, e) => nizOdobritve(zahtevaId, d, n.id, c, e, chatId, zg)), zg);

    // pokazan drug dodatek kot zahtevan: nic
    pokazi("bcdef", predogledDodatka("paperclip", true));
    await caka(() => dogodki.some((d) => d.vrsta === "odobritev" && d.zahtevaId === "bcdef"));
    await dovoli("bcdef");
    k.poslji({ vrsta: "dodatki", zahteva: "bcdef", chatId, dejanje: "vklopi", dodatek: "n8n" });
    await caka(() => izidi().length === 3);
    assert.equal(izidi()[2].ok, false);

    // pokazano pravo, a lastnik zavrnil: nic
    pokazi("cdefg", predogledDodatka("n8n", true));
    await caka(() => dogodki.some((d) => d.vrsta === "odobritev" && d.zahtevaId === "cdefg"));
    await dovoli("cdefg", false);
    k.poslji({ vrsta: "dodatki", zahteva: "cdefg", chatId, dejanje: "vklopi", dodatek: "n8n" });
    await caka(() => izidi().length === 4);
    assert.equal(izidi()[3].ok, false);

    // pokazano z drugim orodjem (Bash) z enakim predogledom: nic
    pokazi("defgh", predogledDodatka("n8n", true), "Bash");
    await caka(() => dogodki.some((d) => d.vrsta === "odobritev" && d.zahtevaId === "defgh"));
    await dovoli("defgh");
    k.poslji({ vrsta: "dodatki", zahteva: "defgh", chatId, dejanje: "vklopi", dodatek: "n8n" });
    await caka(() => izidi().length === 5);
    assert.equal(izidi()[4].ok, false);
    assert.deepEqual(preklopi, []);

    // »Dovoli« druge naprave kroga (ne tiste, ki je dala nalogo): nic
    pokazi("hijkm", predogledDodatka("n8n", true));
    await caka(() => dogodki.some((d) => d.vrsta === "odobritev" && d.zahtevaId === "hijkm"));
    await dovoli("hijkm", true, BOR);
    k.poslji({ vrsta: "dodatki", zahteva: "hijkm", chatId, dejanje: "vklopi", dodatek: "n8n" });
    await caka(() => izidi().length === 6);
    assert.equal(izidi()[5].ok, false);
    assert.deepEqual(preklopi, []);

    // po »Dovoli« isti ID znova pokazan z drugo vsebino: velja vsebina ob dovoljenju (paperclip), ne nova (n8n)
    pokazi("ghijk", predogledDodatka("paperclip", true));
    await caka(() => dogodki.some((d) => d.vrsta === "odobritev" && d.zahtevaId === "ghijk"));
    await dovoli("ghijk");
    pokazi("ghijk", predogledDodatka("n8n", true));
    await caka(() => dogodki.filter((d) => d.vrsta === "odobritev" && d.zahtevaId === "ghijk").length === 2);
    k.poslji({ vrsta: "dodatki", zahteva: "ghijk", chatId, dejanje: "vklopi", dodatek: "n8n" });
    await caka(() => izidi().length === 7);
    assert.equal(izidi()[6].ok, false);
    assert.deepEqual(preklopi, []);

    // pokazano, dovoljeno, isti dodatek in smer: preklop; ista zahteva drugic ne velja
    pokazi("efghi", predogledDodatka("n8n", true));
    await caka(() => dogodki.some((d) => d.vrsta === "odobritev" && d.zahtevaId === "efghi"));
    await dovoli("efghi");
    k.poslji({ vrsta: "dodatki", zahteva: "efghi", chatId, dejanje: "izklopi", dodatek: "n8n" });   // obrnjena smer: nic
    await caka(() => izidi().length === 8);
    assert.equal(izidi()[7].ok, false);
    pokazi("fghij", predogledDodatka("n8n", true));
    await caka(() => dogodki.some((d) => d.vrsta === "odobritev" && d.zahtevaId === "fghij"));
    await dovoli("fghij");
    k.poslji({ vrsta: "dodatki", zahteva: "fghij", chatId, dejanje: "vklopi", dodatek: "n8n" });
    await caka(() => izidi().length === 9);
    assert.deepEqual(izidi()[8], { vrsta: "dodatkiIzid", zahteva: "fghij", ok: true, besedilo: "ok" });
    assert.deepEqual(preklopi, [["n8n", true]]);
    k.poslji({ vrsta: "dodatki", zahteva: "fghij", chatId, dejanje: "vklopi", dodatek: "n8n" });
    await caka(() => izidi().length === 10);
    assert.equal(izidi()[9].ok, false);
    assert.equal(preklopi.length, 1);

    // CodeRabbit (drugi pregled 0.2.10): naprava je podpisala prikaz A (paperclip), kanal pa je med preverjanjem podpisa isti ID
    // zamenjal s prikazom B (n8n). Dovoljenje velja samo za podpisano zgostitev, zato B ne preklopi nicesar.
    pokazi("jkmnp", predogledDodatka("paperclip", true));
    await caka(() => dogodki.some((d) => d.vrsta === "odobritev" && d.zahtevaId === "jkmnp"));
    const podpisano = pokazane.get("jkmnp")!;
    pokazi("jkmnp", predogledDodatka("n8n", true));
    await caka(() => dogodki.filter((d) => d.vrsta === "odobritev" && d.zahtevaId === "jkmnp").length === 2);
    await dovoli("jkmnp", true, ANA, podpisano);
    k.poslji({ vrsta: "dodatki", zahteva: "jkmnp", chatId, dejanje: "vklopi", dodatek: "n8n" });
    await caka(() => izidi().length === 11);
    assert.equal(izidi()[10].ok, false, "preklop po zamenjanem prikazu");
    assert.equal(preklopi.length, 1);
  } finally {
    l.zapri();
    await k.zapri();
    await rm(dir, { recursive: true, force: true });
  }
});

test("dodatki: skupni vektor nizov (isti dobesedni nizi v Kotlinu, DodatkiLineTest)", () => {
  const id = "n-0123456789abcdef";
  const e = "enkratni-dodatki-01";
  assert.equal(nizStanjaDodatkov(id, 1763900000000, e), `safeer-lina-dodatki-stanje-v1\n${id}\n1763900000000\n${e}`);
  assert.equal(nizDodatka(id, "n8n", true, 1763900000000, e), `safeer-lina-dodatek-v1\n${id}\nn8n\nvklopi\n1763900000000\n${e}`);
  assert.equal(nizDodatka(id, "slovenski", false, 1763900000000, e), `safeer-lina-dodatek-v1\n${id}\nslovenski\nizklopi\n1763900000000\n${e}`);
});

test("dodatki: skupni korak po shranjevanju (tudi savePravila) ne namesti slovenskega znova, ce je bil ze vklopljen, in ne uskladi nespremenjenih", async () => {
  const mapa = await mkdtemp(path.join(tmpdir(), "lk-dod-k-"));
  const p = await loadPravila(mapa);
  await rm(mapa, { recursive: true, force: true });
  const z = (d: Partial<NonNullable<typeof p.dodatki>>) => ({ ...p, dodatki: { ...p.dodatki!, ...d } });
  const { u, dnevnik } = laznaUskladitev();
  poSpremembiDodatkov(z({ slovenski: true, n8n: true }), z({ slovenski: true, n8n: true }), "/ni-mape", u);   // npr. shranjen pozdrav
  await premor(10);
  assert.deepEqual(dnevnik, []);
  poSpremembiDodatkov(z({ slovenski: false }), z({ slovenski: true }), "/ni-mape", u);
  await premor(10);
  assert.deepEqual(dnevnik, ["namesti", "rsdo:true"]);
});
