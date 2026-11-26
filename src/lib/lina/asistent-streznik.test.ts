// Koncna tocka asistentke za telefon (asistent-streznik.server.ts). Pravi TLS, pripet odtis kot na telefonu (PinnedHttp), pravi
// podpisi iz Kotlina (vektor) in skozi pravi kanal Claude Code. Vsako varovalo preverjeno z mutacijo (orodja/lina-kanal-mutacije.py).
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, sign, X509Certificate, type KeyObject } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import { request } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { IzvajalecClaudeCode, type Dogodek, type Izvajalec, type Naloga } from "./asistent.server.ts";
import {
  AsistentStreznik, NAJVEC_NEZNANIH_NA_MINUTO, NAJVEC_POVEZAV_NA_NASLOV, NAJVEC_ZAHTEV_NA_MINUTO, NAJVEC_ZAVRNITEV_NA_MINUTO, POT, odtisPotrdila, potrdiloAsistenta, ustvariPotrdilo, zasebenNaslov, zasebenOdjemalec,
  dogodkiDoMeje, NAJVEC_ODGOVOR_DOGODKOV_B, POTI_ODDALJENO, POT_SLIKA_KONTROLE, ponovitevUstavitve,
} from "./asistent-streznik.server.ts";
import { idIzKljuca, nizDogodkov, nizNadaljevanja, nizNaloge, nizOdobritve, nizSinhron, nizSlikeKontrole, nizUstavitve, potVticnice, zgostitevPrikaza, zgostitevSinhron, type Dokaz } from "./kanal-claude.ts";
import { preberiKanal, pripraviKanal } from "./kanal-claude.server.ts";
import { nizDovoljenjaOdobritve } from "./dovoljenja-podobne.ts";
import { najdiDovoljenje } from "./dovoljenja-podobne.server.ts";
import { ovijCilj } from "./cilj-naloge.server.ts";

const KOREN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
/** Vektor 21. 11. 2026 (odobritev v3; prejsnji iz 14. 11. je bil v2): ustvaril ga je Kotlin (podpis: Podpisnik, NiziLine, NalogaLine; generator outputs/naloge/ui-racunalnik/kotlin-vektor-v3/GeneriraVektor.kt) z novim kljucem; prej: Kotlin (openline-gemini-linije @a54d304, modul podpis: Podpisnik, NiziLine, NalogaLine), JCA SHA256withECDSA. */
const KT = {"kljuc":"MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEMXPKgY7glU5wzt4CW77vhsOWrgyAEheLL98DrS3/UF3ShNvdwVvPUo2ashMAYpPMOfy2rfHFYs7nNVKaYVl3mg==","id":"n-7fd01d326eac2590","cas":1763130000000,"naloga":{"id":"kotlinVektorNaloga0001xyz","posiljatelj":"n-7fd01d326eac2590","besedilo":"izpisi git status v repozitoriju Line","cas":1763130000000,"enkratni":"kotlin-enkratni-0001","podpis":"MEUCIFkxYErIzKNK4pgztjcJtlK4/Hb/ndngXoSjvo7LIfLWAiEAtnmrDsT2Kt/aTSYEH5HqFVoOj3zpkWX19+aOga26BiM="},"odobritev":"MEUCIQDzXtMUiKAASI/fOAyD20yF3oImOSs6d+J+i939/BCbnAIgTUtIPf29ScVMCzaEoqqfX2jIQAxG5X4f38xwvmgwogQ=","ustavitev":"MEYCIQDOzuqjxnvrg3jbqU5QQiHvcZL2uBxpiTC2L3nfWF8pRQIhAMdTlW0nhBk2bl2igWSZohPNO+IDiW8Oar3/rGCrMSEZ"} as const;

const premor = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function caka(pogoj: () => boolean, ms = 5000): Promise<void> {
  const konec = Date.now() + ms;
  while (!pogoj()) {
    if (Date.now() > konec) throw new Error("rok cakanja potekel");
    await premor(20);
  }
}

type Odgovor = { status: number; telo: any; glave: Record<string, unknown> };
/** Odjemalec kot telefon: zaupa samo potrdilu s pripetim odtisom (ime gostitelja se ne gleda), brez preusmeritev. */
function zahteva(vrata: number, cert: string, odtis: string, metoda: string, pot: string, telo?: unknown, tip = "application/json"): Promise<Odgovor> {
  return new Promise((ok, ne) => {
    const r = request({
      host: "127.0.0.1", port: vrata, method: metoda, path: pot, ca: cert, rejectUnauthorized: true,
      checkServerIdentity: (_h, c) => (c.fingerprint256.replace(/:/g, "").toLowerCase() === odtis ? undefined : new Error("odtis se ne ujema")),
      headers: telo === undefined ? {} : { "content-type": tip },
    }, (res) => {
      const k: Buffer[] = [];
      res.on("data", (d) => k.push(d));
      res.on("end", () => {
        const s = Buffer.concat(k).toString("utf8");
        let j: unknown = s;
        try { j = JSON.parse(s); } catch { /* ni JSON */ }
        ok({ status: res.statusCode ?? 0, telo: j, glave: res.headers });
      });
    });
    r.on("error", ne);
    r.end(telo === undefined ? undefined : typeof telo === "string" ? telo : JSON.stringify(telo));
  });
}

/** Lazni izvajalec: zapise klice; preizkus sam poslje dogodke. */
function lazni() {
  const klici: Array<{ kaj: string; args: unknown[] }> = [];
  const poslusalci = new Map<string, (d: Dogodek) => void>();
  const iz: Izvajalec = {
    ime: "lazni",
    razpolozljiv: async () => true,
    zacni: async (n: Naloga, cb) => { klici.push({ kaj: "zacni", args: [n] }); poslusalci.set(n.id, cb); },
    odobri: async (...a) => { klici.push({ kaj: "odobri", args: a }); },
    ustavi: async (...a) => { klici.push({ kaj: "ustavi", args: a }); },
  };
  return { iz, klici, dogodek: (id: string, d: Dogodek) => poslusalci.get(id)!(d) };
}

async function streznik(o: { krog: Array<{ id: string; kljuc: string }>; ura?: { t: number }; izvajalec?: Izvajalec; preberi?: typeof preberiKanal; rokRokovanja?: number; dnevnik?: (s: string) => void; odpriSejoClaude?: () => Promise<{ ok: true } | { ok: false; razlog: "napaka" }> }) {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-as-"));
  await pripraviKanal(o.krog, dir);
  const l = lazni();
  const s = new AsistentStreznik({ root: dir, izvajalec: o.izvajalec ?? l.iz, zdaj: o.ura ? () => o.ura!.t : undefined, dnevnik: o.dnevnik ?? (() => {}), preberiKanal: o.preberi, rokRokovanja: o.rokRokovanja, odpriSejoClaude: o.odpriSejoClaude });
  const { vrata, odtis } = await s.zazeni();
  const { cert } = await potrdiloAsistenta(dir);
  const z = (metoda: string, pot: string, telo?: unknown, tip?: string) => zahteva(vrata, cert, odtis, metoda, pot, telo, tip);
  return { dir, s, l, z, vrata, odtis, cert, pospravi: async () => { await s.ustavi(); await rm(dir, { recursive: true, force: true }); } };
}

type Naprava = { id: string; kljuc: string; zasebni: KeyObject };
function naprava(): Naprava {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const kljuc = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  return { id: idIzKljuca(kljuc), kljuc, zasebni: privateKey };
}
const ANA = naprava();
const BOR = naprava();
const enkratni = () => randomBytes(16).toString("base64url");
const idNaloge = () => randomBytes(18).toString("base64url");
function podpisi(d: Naprava, niz: (c: number, e: string) => string, cas = Date.now()): Dokaz {
  const e = enkratni();
  return { cas, enkratni: e, podpis: sign("sha256", Buffer.from(niz(cas, e)), d.zasebni).toString("base64") };
}
/** T1-N3: GET /dogodki ni vec odprt s samim id-jem; podpise ga naprava, ki je dala nalogo (kot /stanje). */
function dogodkiUrl(d: Naprava, id: string, ostalo = "", podpisnik = d): string {
  const p = podpisi(podpisnik, (c, e) => nizDogodkov(id, d.id, c, e));
  return `${POT}/dogodki?id=${id}&posiljatelj=${d.id}&cas=${p.cas}&enkratni=${p.enkratni}&podpis=${encodeURIComponent(p.podpis)}${ostalo}`;
}
const telefonNaloga = (d: Naprava, id: string, besedilo: string, cas?: number) =>
  ({ id, posiljatelj: d.id, besedilo, ...podpisi(d, (c, e) => nizNaloge(id, d.id, besedilo, c, e), cas) });

test("Kotlin vektor: podpisana naloga, odobritev in ustavitev s telefona so sprejete in predane izvajalcu", async () => {
  const ura = { t: KT.cas - 5000 };                                                               // zagon pred podpisom
  const s = await streznik({ krog: [{ id: KT.id, kljuc: KT.kljuc }], ura });
  try {
    ura.t = KT.cas + 3000;
    const r = await s.z("POST", `${POT}/naloga`, KT.naloga);
    assert.equal(r.status, 202, JSON.stringify(r.telo));
    const zacni = s.l.klici.find((k) => k.kaj === "zacni")!.args[0] as Naloga;
    assert.deepEqual(zacni, { id: KT.naloga.id, besedilo: KT.naloga.besedilo, posiljatelj: KT.id, izvor: "asistent",
      dokaz: { cas: KT.cas, enkratni: KT.naloga.enkratni, podpis: KT.naloga.podpis } });
    assert.equal((await s.z("POST", `${POT}/naloga`, KT.naloga)).status, 403);                // ponovitev istega podpisa
    s.l.dogodek(KT.naloga.id, { vrsta: "odobritev", zahtevaId: "abcde", orodje: "Bash", predogled: '{"command":"git status"}', opis: "Pokaze stanje",
      zgostitev: zgostitevPrikaza("Bash", '{"command":"git status"}', "Pokaze stanje") });
    // dogodke bere samo podpisana naprava (T1-N3); Kotlin vektor za ta niz ni (podpisnik ni v preizkusu), pot s podpisom je spodaj
    assert.equal((await s.z("GET", `${POT}/dogodki?id=${KT.naloga.id}&od=0`)).status, 400);
    // Odobritev (niz safeer-lina-odobritev-v3, zgostitev z dolzinami, BBB1): podpis iz Kotlina nad v2 ne velja vec, zasebnega
    // kljuca ni (vektor je bil enkraten zagon). Odobritev v3 pokrivata skupni vektorji vektorji-lina-v1.json (TS podpise, Kotlin
    // SkupniVektorjiTest jih preveri) in preizkus streznika iz vektorja v skupni-vektorji.test.ts. KT.odobritev ostane le kot zgodovina.
    const u = { id: KT.naloga.id, posiljatelj: KT.id, cas: KT.cas + 2000, enkratni: "kotlin-enkratni-0003", podpis: KT.ustavitev };
    assert.equal((await s.z("POST", `${POT}/ustavi`, u)).status, 202);
    assert.equal(s.l.klici.filter((k) => k.kaj === "ustavi").length, 1);
  } finally {
    await s.pospravi();
  }
});

test("Kotlin vektor: spremenjeno besedilo, druga vsebina odobritve, star podpis ali naprava izven seznama - 403", async () => {
  const ura = { t: KT.cas - 5000 };
  const s = await streznik({ krog: [{ id: KT.id, kljuc: KT.kljuc }, BOR], ura });
  try {
    ura.t = KT.cas + 3000;
    assert.equal((await s.z("POST", `${POT}/naloga`, { ...KT.naloga, besedilo: "izbrisi vse" })).status, 403);
    ura.t = KT.cas + 3 * 60_000;                                                                  // zunaj okna 2 min
    assert.equal((await s.z("POST", `${POT}/naloga`, KT.naloga)).status, 403);
    ura.t = KT.cas + 3000;
    assert.equal((await s.z("POST", `${POT}/naloga`, KT.naloga)).status, 202);
    // prikazano je bilo nekaj drugega, kot je telefon podpisal
    s.l.dogodek(KT.naloga.id, { vrsta: "odobritev", zahtevaId: "abcde", orodje: "Bash", predogled: '{"command":"rm -rf /"}', opis: "Pokaze stanje",
      zgostitev: zgostitevPrikaza("Bash", '{"command":"rm -rf /"}', "Pokaze stanje") });
    // telefon sme poslati svojo zgostitev - streznik je ne upostevi, preveri tisto, kar je SAM poslal na zaslon
    const o = { nalogaId: KT.naloga.id, zahtevaId: "abcde", dovoli: true, posiljatelj: KT.id, cas: KT.cas + 1000, enkratni: "kotlin-enkratni-0002", podpis: KT.odobritev,
      zgostitev: zgostitevPrikaza("Bash", '{"command":"git status"}', "Pokaze stanje") };
    assert.equal((await s.z("POST", `${POT}/odobritev`, o)).status, 403);
    // druga naprava kroga (BOR) ne sme odobriti ne ustaviti Anine naloge
    const ob = { ...o, posiljatelj: BOR.id, ...podpisi(BOR, (c, e) => nizOdobritve("abcde", true, BOR.id, c, e, KT.naloga.id, zgostitevPrikaza("Bash", '{"command":"rm -rf /"}', "Pokaze stanje")), ura.t) };
    assert.equal((await s.z("POST", `${POT}/odobritev`, ob)).status, 403);
    const ub = { id: KT.naloga.id, posiljatelj: BOR.id, ...podpisi(BOR, (c, e) => nizUstavitve(KT.naloga.id, BOR.id, c, e), ura.t) };
    assert.equal((await s.z("POST", `${POT}/ustavi`, ub)).status, 403);
    // zahteva, ki je ta naloga ni dobila
    assert.equal((await s.z("POST", `${POT}/odobritev`, { ...o, zahtevaId: "qwert" })).status, 403);
    assert.equal(s.l.klici.filter((k) => k.kaj !== "zacni").length, 0);
  } finally {
    await s.pospravi();
  }
});

test("podpis s casom pred zagonom, naprava izven seznama, kratek id in napacna oblika se zavrnejo", async () => {
  const pred = telefonNaloga(ANA, idNaloge(), "pokazi datum");
  await premor(20);
  const s = await streznik({ krog: [ANA] });
  try {
    assert.equal((await s.z("POST", `${POT}/naloga`, pred)).status, 403);                       // podpisano pred zagonom
    assert.equal((await s.z("POST", `${POT}/naloga`, telefonNaloga(BOR, idNaloge(), "x"))).status, 403); // BOR ni v seznamu
    assert.equal((await s.z("POST", `${POT}/naloga`, telefonNaloga(ANA, "kratek-id-0001", "x"))).status, 400);
    assert.equal((await s.z("POST", `${POT}/naloga`, telefonNaloga(ANA, idNaloge(), "a\ud800b"))).status, 400);
    assert.equal((await s.z("POST", `${POT}/naloga`, "ni json")).status, 400);
    assert.equal((await s.z("POST", `${POT}/naloga`, "{}", "text/plain")).status, 415);
    assert.equal((await s.z("POST", `${POT}/naloga`, JSON.stringify({ x: "y".repeat(17_000) }))).status, 413);
    const n = await s.z("GET", "/kamorkoli");
    assert.equal(n.status, 404);
    assert.equal(n.glave.location, undefined);                                                   // nikoli preusmeritve
    assert.equal((await s.z("GET", `${POT}/naloga`)).status, 405);
    assert.equal(s.l.klici.length, 0);
  } finally {
    await s.pospravi();
  }
});

test("dogodki: neznan id 404 in nato 429; dolgo poizvedovanje vrne dogodek takoj, ko pride; koncano", async () => {
  const s = await streznik({ krog: [ANA] });
  try {
    for (let i = 0; i < NAJVEC_NEZNANIH_NA_MINUTO; i++) assert.equal((await s.z("GET", dogodkiUrl(ANA, idNaloge()))).status, 404);
    assert.equal((await s.z("GET", dogodkiUrl(ANA, idNaloge()))).status, 429);
    const n = telefonNaloga(ANA, idNaloge(), "pozeni preizkuse");
    assert.equal((await s.z("POST", `${POT}/naloga`, n)).status, 202);
    const t = Date.now();
    const cakam = s.z("GET", dogodkiUrl(ANA, n.id, "&od=0&caka=10"));
    await premor(300);
    s.l.dogodek(n.id, { vrsta: "izid", ok: true, besedilo: "Vsi preizkusi so zeleni." });
    const d = await cakam;
    assert.ok(Date.now() - t < 3000);
    assert.deepEqual(d.telo, { dogodki: [{ vrsta: "izid", ok: true, besedilo: "Vsi preizkusi so zeleni.", st: 1 }], koncano: true });
    assert.deepEqual((await s.z("GET", dogodkiUrl(ANA, n.id, "&od=1"))).telo, { dogodki: [], koncano: true });
  } finally {
    await s.pospravi();
  }
});

test("T1-N3: dogodke naloge bere samo podpisana naprava, ki je dala nalogo; samo id ne zadostuje", async () => {
  const s = await streznik({ krog: [ANA, BOR] });
  try {
    const n = telefonNaloga(ANA, idNaloge(), "pozeni preizkuse");
    assert.equal((await s.z("POST", `${POT}/naloga`, n)).status, 202);
    s.l.dogodek(n.id, { vrsta: "izid", ok: true, besedilo: "Konec." });
    assert.equal((await s.z("GET", `${POT}/dogodki?id=${n.id}&od=0`)).status, 400, "kdor pozna ali ugane id, brez podpisa ne bere");
    assert.equal((await s.z("GET", dogodkiUrl(naprava(), n.id))).status, 403, "naprava izven seznama");
    assert.equal((await s.z("GET", dogodkiUrl(ANA, n.id, "", BOR))).status, 403, "podpis druge naprave");
    assert.equal((await s.z("GET", dogodkiUrl(BOR, n.id))).status, 404, "druga naprava s seznama ne bere tujih nalog");
    const url = dogodkiUrl(ANA, n.id);
    const d = await s.z("GET", url);
    assert.equal(d.status, 200);
    assert.equal(d.telo.dogodki[0].besedilo, "Konec.");
    assert.equal((await s.z("GET", url)).status, 403, "ponovitev istega podpisa");
  } finally {
    await s.pospravi();
  }
});

test("T1-N6: poceni preverbe PRED branjem kanala; po meji zavrnitev in zahtev 429 brez branja diska", async () => {
  let branj = 0;
  const s = await streznik({ krog: [ANA], preberi: async (d) => { branj += 1; return preberiKanal(d); } });
  try {
    // star podpis (zunaj okna 2 min) in ponovitev enkratnega niza: kanal se ne bere
    assert.equal((await s.z("POST", `${POT}/naloga`, telefonNaloga(ANA, idNaloge(), "x", Date.now() - 10 * 60_000))).status, 403);
    assert.equal(branj, 0, "star podpis ne sme brati kanala");
    const n = telefonNaloga(ANA, idNaloge(), "preizkus");
    assert.equal((await s.z("POST", `${POT}/naloga`, n)).status, 202);
    assert.equal(branj, 1);
    assert.equal((await s.z("POST", `${POT}/naloga`, { ...n, id: idNaloge() })).status, 403);
    assert.equal(branj, 1, "ponovljen enkratni niz ne sme brati kanala");
    // neznana naprava s svezim podpisom bere kanal, a jih je na naslov na minuto najvec NAJVEC_ZAVRNITEV_NA_MINUTO
    const tuja = naprava();
    let zavrnjenih = 2;
    for (; zavrnjenih < NAJVEC_ZAVRNITEV_NA_MINUTO; zavrnjenih++) assert.equal((await s.z("POST", `${POT}/naloga`, telefonNaloga(tuja, idNaloge(), "x"))).status, 403);
    const pred = branj;
    assert.equal((await s.z("POST", `${POT}/naloga`, telefonNaloga(tuja, idNaloge(), "x"))).status, 429);
    assert.equal((await s.z("POST", `${POT}/naloga`, telefonNaloga(ANA, idNaloge(), "x"))).status, 429, "naslov je za minuto omejen");
    assert.equal((await s.z("GET", `${POT}/stanje`)).status, 429);
    assert.equal(branj, pred, "pod mejo se kanal ne bere in ne desifrira");
  } finally {
    await s.pospravi();
  }
});

test("T1-N6: najvec NAJVEC_ZAHTEV_NA_MINUTO zahtev na minuto z enega naslova (vse poti)", async () => {
  const s = await streznik({ krog: [ANA] });
  try {
    for (let i = 0; i < NAJVEC_ZAHTEV_NA_MINUTO; i++) assert.equal((await s.z("GET", `${POT}/nic`)).status, 405);
    assert.equal((await s.z("GET", `${POT}/nic`)).status, 429);
  } finally {
    await s.pospravi();
  }
});

test("T1-S2: najvec NAJVEC_POVEZAV_NA_NASLOV hkratnih povezav z enega naslova; pol-odprto TLS rokovanje se ob roku zapre", async () => {
  const s = await streznik({ krog: [ANA], rokRokovanja: 1500 });
  const vticnice: net.Socket[] = [];
  const zaprte: boolean[] = [];
  try {
    for (let i = 0; i <= NAJVEC_POVEZAV_NA_NASLOV; i++) {
      const v = net.connect(s.vrata, "127.0.0.1");
      zaprte.push(false);
      v.on("close", () => { zaprte[i] = true; });
      v.on("error", () => undefined);
      vticnice.push(v);
      await new Promise((r) => v.once("connect", r));
      await premor(30);
    }
    await premor(150);
    assert.equal(zaprte[NAJVEC_POVEZAV_NA_NASLOV], true, "povezava nad mejo se zapre takoj");
    assert.deepEqual(zaprte.slice(0, NAJVEC_POVEZAV_NA_NASLOV), new Array(NAJVEC_POVEZAV_NA_NASLOV).fill(false), "prvih 8 caka na rokovanje");
    await caka(() => zaprte.every(Boolean), 4000);
    // rok rokovanja je sprostil mesta: navadna zahteva spet uspe
    assert.equal((await s.z("GET", `${POT}/nic`)).status, 405);
  } finally {
    for (const v of vticnice) v.destroy();
    await s.pospravi();
  }
});

test("poslusanje samo na 127.0.0.1 ali zasebnem naslovu; odjemalec z javnega naslova se zavrne", async () => {
  for (const n of ["0.0.0.0", "::", "8.8.8.8", "100.64.0.1", "172.32.0.1"]) assert.equal(zasebenNaslov(n), false, n);
  for (const n of ["127.0.0.1", "192.168.1.20", "10.0.0.5", "172.16.3.4", "fd00::1"]) assert.equal(zasebenNaslov(n), true, n);
  assert.equal(zasebenOdjemalec("::ffff:192.168.1.5"), true);
  assert.equal(zasebenOdjemalec("::ffff:8.8.8.8"), false);
  assert.equal(zasebenOdjemalec("203.0.113.9"), false);
  assert.equal(zasebenOdjemalec(undefined), false);
  const dir = await mkdtemp(path.join(tmpdir(), "lk-as-"));
  try {
    await pripraviKanal([ANA], dir);
    for (const naslov of ["0.0.0.0", "8.8.8.8"]) {
      await assert.rejects(new AsistentStreznik({ root: dir, naslov, izvajalec: lazni().iz }).zazeni(), /samo na 127/);
    }
    // zahteva z javnega naslova (npr. ce bi kdo preusmeril vrata na usmerjevalniku) ne pride do obdelave
    const l = lazni();
    const s = new AsistentStreznik({ root: dir, izvajalec: l.iz, dnevnik: () => {} });
    let status = 0;
    const res = { headersSent: false, writeHead: (st: number) => { status = st; }, end: () => {} };
    const req = Object.assign((async function* () { yield Buffer.from(JSON.stringify(telefonNaloga(ANA, idNaloge(), "x"))); })(),
      { socket: { remoteAddress: "203.0.113.9" }, url: `${POT}/naloga`, method: "POST", headers: { "content-type": "application/json" } });
    await (s as unknown as { zahteva(a: unknown, b: unknown): Promise<void> }).zahteva(req, res);
    assert.equal(status, 403);
    assert.equal(l.klici.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("TLS: samopodpisano potrdilo EC P-256, odtis se ujema, kljuc 0600; napacen pripet odtis ne poveze", async () => {
  const { cert } = ustvariPotrdilo();
  const x = new X509Certificate(cert);
  assert.equal(x.verify(x.publicKey), true);
  assert.equal(x.publicKey.asymmetricKeyDetails?.namedCurve, "prime256v1");
  assert.match(x.subjectAltName ?? "", /localhost/);
  const s = await streznik({ krog: [ANA] });
  try {
    assert.equal(s.odtis, odtisPotrdila(s.cert));
    assert.equal(s.odtis.length, 64);
    if (process.platform !== "win32") {
      assert.equal(statSync(path.join(s.dir, "asistent-tls", "kljuc.pem")).mode & 0o777, 0o600);
      assert.equal(statSync(path.join(s.dir, "asistent-tls")).mode & 0o777, 0o700);
    }
    await assert.rejects(zahteva(s.vrata, s.cert, "0".repeat(64), "GET", `${POT}/dogodki?id=x`), /odtis se ne ujema/);
    // ponovni zagon obdrzi isto potrdilo (telefon ga ima pripetega)
    assert.equal((await potrdiloAsistenta(s.dir)).odtis, s.odtis);
  } finally {
    await s.pospravi();
  }
});

// ------------------------------------------------------------------ od telefona do Claude Code skozi pravi kanal

function zagonKanala(dir: string) {
  return spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", path.join(KOREN, "scripts", "kanal-claude.mts")], {
    cwd: KOREN, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LINA_DATA: dir }, stdio: ["pipe", "pipe", "pipe"],
  });
}

test("od telefona do Claude Code: naloga v sejo, zahteva za odobritev na telefon, podpisana odobritev v Claude Code, izid nazaj", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-"));
  await pripraviKanal([ANA], dir);
  const p: ChildProcess = zagonKanala(dir);
  const izhod: Array<Record<string, any>> = [];
  let ost = "";
  p.stdout!.setEncoding("utf8");
  p.stdout!.on("data", (k: string) => { ost += k; let i; while ((i = ost.indexOf("\n")) >= 0) { izhod.push(JSON.parse(ost.slice(0, i))); ost = ost.slice(i + 1); } });
  const poslji = (x: unknown) => p.stdin!.write(JSON.stringify(x) + "\n");
  const izv = new IzvajalecClaudeCode({ pot: potVticnice(dir), zeton: async () => (await preberiKanal(dir)).zeton, ozjiKrog: () => new Set([ANA.id]) });
  const s = new AsistentStreznik({ root: dir, izvajalec: izv, dnevnik: () => {} });
  try {
    poslji({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "lazni-claude", version: "0" } } });
    await caka(() => izhod.some((x) => x.id === 1), 15000);
    poslji({ jsonrpc: "2.0", method: "notifications/initialized" });
    await caka(() => existsSync(potVticnice(dir)));
    const { vrata, odtis } = await s.zazeni();
    const { cert } = await potrdiloAsistenta(dir);
    const z = (m: string, pot: string, t?: unknown) => zahteva(vrata, cert, odtis, m, pot, t);
    const n = telefonNaloga(ANA, idNaloge(), "izpisi git status");
    assert.equal((await z("POST", `${POT}/naloga`, n)).status, 202);
    await caka(() => izhod.some((x) => x.method === "notifications/claude/channel"));
    assert.equal(izhod.find((x) => x.method === "notifications/claude/channel")!.params.meta.chat_id, n.id);
    poslji({ jsonrpc: "2.0", method: "notifications/claude/channel/permission_request",
      params: { request_id: "abcde", tool_name: "Bash", description: "Pokaze stanje", input_preview: '{"command":"git status"}' } });
    const d = await z("GET", dogodkiUrl(ANA, n.id, "&od=0&caka=10"));
    const o = d.telo.dogodki.find((x: Dogodek) => x.vrsta === "odobritev");
    assert.equal(o.zgostitev, zgostitevPrikaza(o.orodje, o.predogled, o.opis));                 // telefon izracuna isto
    const odob = { nalogaId: n.id, zahtevaId: "abcde", dovoli: true, posiljatelj: ANA.id,
      ...podpisi(ANA, (c, e) => nizOdobritve("abcde", true, ANA.id, c, e, n.id, zgostitevPrikaza(o.orodje, o.predogled, o.opis))) };
    assert.equal((await z("POST", `${POT}/odobritev`, odob)).status, 202);
    await caka(() => izhod.some((x) => x.method === "notifications/claude/channel/permission"));
    assert.deepEqual(izhod.find((x) => x.method === "notifications/claude/channel/permission")!.params, { request_id: "abcde", behavior: "allow" });
    poslji({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "reply", arguments: { chat_id: n.id, text: "Delovna kopija je cista.", vrsta: "koncano" } } });
    const k = await z("GET", dogodkiUrl(ANA, n.id, `&od=${o.st}&caka=10`));
    assert.deepEqual(k.telo, { dogodki: [{ vrsta: "izid", ok: true, besedilo: "Delovna kopija je cista.", st: o.st + 1 }], koncano: true });
  } finally {
    await s.ustavi();
    izv.zapri();
    p.stdin!.end();
    await new Promise((r) => (p.exitCode !== null ? r(null) : p.on("exit", r)));
    await rm(dir, { recursive: true, force: true });
  }
});

test("SR-8: dogodkiDoMeje razdeli velik paket (5 odobritev s 4000 narekovaji = vec kot 64 KiB), vedno vsaj en dogodek", () => {
  const veliki = Array.from({ length: 5 }, (_, i) => ({ st: i + 1, vrsta: "odobritev", predogled: '"'.repeat(4000), opis: "\\".repeat(4000) }));
  assert.ok(JSON.stringify({ dogodki: veliki }).length > 64 * 1024, "brez razdelitve bi telefon odgovor zavrnil");
  const prvi = dogodkiDoMeje(veliki, NAJVEC_ODGOVOR_DOGODKOV_B);
  assert.ok(prvi.length >= 1 && prvi.length < 5);
  assert.ok(JSON.stringify({ dogodki: prvi, koncano: false }).length < 64 * 1024);
  assert.equal(dogodkiDoMeje(veliki, 10).length, 1, "tudi ob premajhni meji vsaj en dogodek");
});

const sinhronTelo = (d: Naprava, vsebina: string, cas?: number) =>
  ({ posiljatelj: d.id, vsebina, ...podpisi(d, (c, e) => nizSinhron(d.id, c, e, zgostitevSinhron(vsebina)), cas) });

test("sinhronizacija: podpisana zahteva izmenja klic; spremenjena vsebina, ponovitev, tuja naprava in prevelik paket se zavrnejo", async () => {
  const s = await streznik({ krog: [{ id: ANA.id, kljuc: ANA.kljuc }] });
  try {
    const klic = { id: "klic-1", casZacetka: 1000, stevilka: "+38640111222", trajanjeS: 5, nujno: false, povzetek: "Miha Horvat se oglasi.", nacin: "osebna",
      klicatelj: "Miha Horvat", podjetje: "", sporocilo: "Pokličite nazaj.", sporociloDobesedno: "pokličite me nazaj", brezSporocilaRazlog: "" };
    const vsebina = JSON.stringify({ rev: 0, klici: [klic], pogovor: [], navodila: null });
    const telo = sinhronTelo(ANA, vsebina);
    const r = await s.z("POST", `${POT}/sinhron`, telo);
    assert.equal(r.status, 200, JSON.stringify(r.telo));
    assert.equal(r.telo.klici[0].id, "klic-1");
    assert.equal((await s.z("POST", `${POT}/sinhron`, telo)).status, 403);                         // ponovitev istega podpisa
    const t2 = sinhronTelo(ANA, vsebina);
    const t2spremenjen = { ...t2, vsebina: vsebina.replace("Miha", "Mihec") };
    assert.equal((await s.z("POST", `${POT}/sinhron`, t2spremenjen)).status, 403);                // podpis ne pokriva druge vsebine
    assert.equal((await s.z("POST", `${POT}/sinhron`, sinhronTelo(BOR, vsebina))).status, 403);   // naprava izven seznama
    const velik = JSON.stringify({ rev: 0, klici: [], pogovor: [], navodila: null, x: "a".repeat(1024 * 1024) });
    assert.equal((await s.z("POST", `${POT}/sinhron`, sinhronTelo(ANA, velik))).status, 413);
    const slab = sinhronTelo(ANA, JSON.stringify({ rev: -1 }));
    assert.equal((await s.z("POST", `${POT}/sinhron`, slab)).status, 400);
  } finally {
    await s.pospravi();
  }
});

test("sinhronizacija (21r A8, A7): zapis klica vec kot dan v prihodnosti se preskoci in presteje v dnevnik brez vsebine; odgovor nosi rokHrambeDni", async () => {
  const vrstice: string[] = [];
  const s = await streznik({ krog: [{ id: ANA.id, kljuc: ANA.kljuc }], dnevnik: (v) => vrstice.push(v) });
  try {
    const klic = (id: string, casZacetka: number, stevilka = "+38640111222") => ({ id, casZacetka, stevilka, trajanjeS: 5, nujno: false, povzetek: "Miha Horvat se oglasi.",
      nacin: "osebna", klicatelj: "Miha Horvat", podjetje: "", sporocilo: "Pokličite nazaj.", sporociloDobesedno: "", brezSporocilaRazlog: "" });
    const zdaj = Date.now();
    const vsebina = JSON.stringify({ rev: 0, klici: [klic("klic-1", zdaj - 60_000), klic("klic-prihodnost-77", zdaj + 3 * 86_400_000, "+38640999888"), klic("klic-2", zdaj - 30_000)], pogovor: [], navodila: null });
    const r = await s.z("POST", `${POT}/sinhron`, sinhronTelo(ANA, vsebina));
    assert.equal(r.status, 200, JSON.stringify(r.telo));
    assert.deepEqual(r.telo.klici.map((k: { id: string }) => k.id), ["klic-1", "klic-2"]);
    assert.equal(r.telo.rokHrambeDni, 90);
    const zapis = vrstice.filter((v) => /prihodnost/i.test(v));
    assert.equal(zapis.length, 1, JSON.stringify(vrstice));
    assert.match(zapis[0], /\b1\b/);
    assert.ok(!vrstice.some((v) => /klic-prihodnost-77|38640999888|Miha/.test(v)), "dnevnik ne sme nositi vsebine zapisa");
    // brez preskocenih ni vrstice
    vrstice.length = 0;
    assert.equal((await s.z("POST", `${POT}/sinhron`, sinhronTelo(ANA, JSON.stringify({ rev: 0, klici: [klic("klic-3", zdaj)], pogovor: [], navodila: null })))).status, 200);
    assert.equal(vrstice.filter((v) => /prihodnost/i.test(v)).length, 0);
  } finally {
    await s.pospravi();
  }
});

test("sinhronizacija (21r, slepi pregled #2): meja prihodnosti in rok hrambe veljata po isti uri strežnika", async () => {
  const DAN = 86_400_000;
  const ura = { t: Date.now() + 200 * DAN };
  const s = await streznik({ krog: [{ id: ANA.id, kljuc: ANA.kljuc }], ura });
  try {
    const klic = (id: string, casZacetka: number) => ({ id, casZacetka, stevilka: "+38640111222", trajanjeS: 5, nujno: false, povzetek: "Miha Horvat se oglasi.",
      nacin: "podjetje", klicatelj: "Miha Horvat", podjetje: "Primer d.o.o.", sporocilo: "Pokličite nazaj.", sporociloDobesedno: "", brezSporocilaRazlog: "" });
    // po uri strežnika 100 dni star (rok 90 = potekel), po Date.now() 100 dni v prihodnosti
    const vsebina = JSON.stringify({ rev: 0, klici: [klic("klic-star", ura.t - 100 * DAN), klic("klic-nov", ura.t - DAN)], pogovor: [], navodila: null });
    const r = await s.z("POST", `${POT}/sinhron`, sinhronTelo(ANA, vsebina, ura.t));
    assert.equal(r.status, 200, JSON.stringify(r.telo));
    assert.deepEqual(r.telo.klici.map((k: { id: string }) => k.id), ["klic-nov"]);
  } finally {
    await s.pospravi();
  }
});

test("sinhronizacija: velik veljaven paket telefona (stotine kB zapisov klicev) je sprejet, ne zavrnjen kot 413", async () => {
  const s = await streznik({ krog: [{ id: ANA.id, kljuc: ANA.kljuc }] });
  try {
    const klic = (i: number) => ({ id: `klic-${i}`, casZacetka: 1000 + i, stevilka: "+38640111222", trajanjeS: 5, nujno: false, povzetek: "p".repeat(1500), nacin: "osebna",
      klicatelj: "Miha Horvat", podjetje: "", sporocilo: "Pokličite nazaj.", sporociloDobesedno: "d".repeat(1500), brezSporocilaRazlog: "" });
    const vsebina = JSON.stringify({ rev: 0, klici: Array.from({ length: 120 }, (_, i) => klic(i)), pogovor: [], navodila: null });
    assert.ok(vsebina.length > 100_000 && vsebina.length < 400_000, `velikost ${vsebina.length}`);
    const r = await s.z("POST", `${POT}/sinhron`, sinhronTelo(ANA, vsebina));
    assert.equal(r.status, 200, JSON.stringify(r.telo).slice(0, 200));
    assert.ok(r.telo.klici.length > 0);
  } finally {
    await s.pospravi();
  }
});

// ------------------------------------------------------------------ odgovor v nalogo (POST /nadaljuj) in stanje naloge (23. 11. 2026)

const telefonNadaljuj = (d: Naprava, id: string, besedilo: string, podpisal = d) =>
  ({ id, posiljatelj: d.id, besedilo, ...podpisi(podpisal, (c, e) => nizNadaljevanja(id, d.id, besedilo, c, e)) });

test("POST /nadaljuj: samo naprava naloge s pravim podpisom; izvajalec dobi odgovor; brez zmoznosti 501; v POTI_ODDALJENO", async () => {
  const s = await streznik({ krog: [ANA, BOR] });
  try {
    const n = telefonNaloga(ANA, idNaloge(), "uredi nacrt");
    assert.equal((await s.z("POST", `${POT}/naloga`, n)).status, 202);
    // lazni izvajalec brez nadaljuj
    assert.equal((await s.z("POST", `${POT}/nadaljuj`, telefonNadaljuj(ANA, n.id, "korak 2"))).status, 501);
    const prejeto: unknown[][] = [];
    s.l.iz.nadaljuj = async (...a) => { prejeto.push(a); };
    assert.equal((await s.z("POST", `${POT}/nadaljuj`, telefonNadaljuj(BOR, n.id, "korak 2"))).status, 403);            // tuja naprava
    assert.equal((await s.z("POST", `${POT}/nadaljuj`, telefonNadaljuj(ANA, n.id, "korak 2", BOR))).status, 403);       // tuj podpis
    const spremenjen = { ...telefonNadaljuj(ANA, n.id, "korak 2"), besedilo: "rm -rf ." };
    assert.equal((await s.z("POST", `${POT}/nadaljuj`, spremenjen)).status, 403);                                       // besedilo po podpisu
    assert.equal((await s.z("POST", `${POT}/nadaljuj`, telefonNadaljuj(ANA, idNaloge(), "korak 2"))).status, 403);     // neznana naloga
    // podpis naloge ni prenosljiv na nadaljevanje (lastna predpona)
    const izNaloge = { ...telefonNaloga(ANA, n.id, "korak 2") };
    assert.equal((await s.z("POST", `${POT}/nadaljuj`, izNaloge)).status, 403);
    const ok = telefonNadaljuj(ANA, n.id, "korak 2");
    assert.equal((await s.z("POST", `${POT}/nadaljuj`, ok)).status, 202);
    assert.equal((await s.z("POST", `${POT}/nadaljuj`, ok)).status, 403);                                               // ponovitev
    assert.equal(prejeto.length, 1);
    assert.deepEqual(prejeto[0].slice(0, 3), [n.id, "korak 2", ANA.id]);
    assert.equal(POTI_ODDALJENO.get(`${POT}/nadaljuj`), "POST");
  } finally {
    await s.pospravi();
  }
});

test("stanje naloge: vprasanje ni konec; koncano konca; vmesni odgovor po koncu jo odpre (telefon vidi koncano:false)", async () => {
  const s = await streznik({ krog: [ANA] });
  try {
    const n = telefonNaloga(ANA, idNaloge(), "pozeni preizkuse");
    assert.equal((await s.z("POST", `${POT}/naloga`, n)).status, 202);
    s.l.dogodek(n.id, { vrsta: "stanje", besedilo: "Katero vejo?", tip: "vprasanje" });
    let d = await s.z("GET", dogodkiUrl(ANA, n.id, "&od=0"));
    assert.deepEqual(d.telo, { dogodki: [{ vrsta: "stanje", besedilo: "Katero vejo?", tip: "vprasanje", st: 1 }], koncano: false });
    s.l.dogodek(n.id, { vrsta: "izid", ok: true, besedilo: "Koncano." });
    d = await s.z("GET", dogodkiUrl(ANA, n.id, "&od=1"));
    assert.equal(d.telo.koncano, true);
    s.l.dogodek(n.id, { vrsta: "stanje", besedilo: "Lastnik je ukazal naprej.", tip: "vmesno" });
    d = await s.z("GET", dogodkiUrl(ANA, n.id, "&od=2"));
    assert.deepEqual(d.telo, { dogodki: [{ vrsta: "stanje", besedilo: "Lastnik je ukazal naprej.", tip: "vmesno", st: 3 }], koncano: false });
    // sistemsko stanje brez tip (npr. izguba povezave) koncane naloge ne odpre
    s.l.dogodek(n.id, { vrsta: "izid", ok: true, besedilo: "Spet koncano." });
    s.l.dogodek(n.id, { vrsta: "stanje", besedilo: "sistem" });
    d = await s.z("GET", dogodkiUrl(ANA, n.id, "&od=3"));
    assert.equal(d.telo.koncano, true);
  } finally {
    await s.pospravi();
  }
});

test("od telefona do Claude Code: vprasanje -> /nadaljuj v isti chat_id -> koncano -> /nadaljuj odpre znova", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-"));
  await pripraviKanal([ANA], dir);
  const p: ChildProcess = zagonKanala(dir);
  const izhod: Array<Record<string, any>> = [];
  let ost = "";
  p.stdout!.setEncoding("utf8");
  p.stdout!.on("data", (k: string) => { ost += k; let i; while ((i = ost.indexOf("\n")) >= 0) { izhod.push(JSON.parse(ost.slice(0, i))); ost = ost.slice(i + 1); } });
  const poslji = (x: unknown) => p.stdin!.write(JSON.stringify(x) + "\n");
  const izv = new IzvajalecClaudeCode({ pot: potVticnice(dir), zeton: async () => (await preberiKanal(dir)).zeton, ozjiKrog: () => new Set([ANA.id]) });
  const s = new AsistentStreznik({ root: dir, izvajalec: izv, dnevnik: () => {} });
  const kanalska = () => izhod.filter((x) => x.method === "notifications/claude/channel");
  try {
    poslji({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "lazni-claude", version: "0" } } });
    await caka(() => izhod.some((x) => x.id === 1), 15000);
    poslji({ jsonrpc: "2.0", method: "notifications/initialized" });
    await caka(() => existsSync(potVticnice(dir)));
    const { vrata, odtis } = await s.zazeni();
    const { cert } = await potrdiloAsistenta(dir);
    const z = (m: string, pot: string, t?: unknown) => zahteva(vrata, cert, odtis, m, pot, t);
    const n = telefonNaloga(ANA, idNaloge(), "uredi nacrt po korakih");
    assert.equal((await z("POST", `${POT}/naloga`, n)).status, 202);
    await caka(() => kanalska().length === 1);
    poslji({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "reply", arguments: { chat_id: n.id, text: "Kje je nacrt?", vrsta: "vprasanje" } } });
    let d = await z("GET", dogodkiUrl(ANA, n.id, "&od=0&caka=10"));
    assert.deepEqual(d.telo, { dogodki: [{ vrsta: "stanje", besedilo: "Kje je nacrt?", tip: "vprasanje", st: 1 }], koncano: false });
    assert.equal((await z("POST", `${POT}/nadaljuj`, telefonNadaljuj(ANA, n.id, "Nacrt je v docs/nacrt.md."))).status, 202);
    await caka(() => kanalska().length === 2);
    assert.deepEqual(kanalska()[1].params, { content: "Nacrt je v docs/nacrt.md.", meta: { chat_id: n.id, naprava: ANA.id, nadaljevanje: "da" } });
    poslji({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "reply", arguments: { chat_id: n.id, text: "Koncano.", vrsta: "koncano" } } });
    d = await z("GET", dogodkiUrl(ANA, n.id, "&od=1&caka=10"));
    assert.equal(d.telo.koncano, true);
    assert.equal((await z("POST", `${POT}/nadaljuj`, telefonNadaljuj(ANA, n.id, "Dodaj se korak 3."))).status, 202);
    await caka(() => kanalska().length === 3);
    d = await z("GET", dogodkiUrl(ANA, n.id, "&od=2"));
    assert.equal(d.telo.koncano, false);
    poslji({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "reply", arguments: { chat_id: n.id, text: "Delam korak 3." } } });
    d = await z("GET", dogodkiUrl(ANA, n.id, "&od=2&caka=10"));
    assert.deepEqual(d.telo, { dogodki: [{ vrsta: "stanje", besedilo: "Delam korak 3.", tip: "vmesno", st: 3 }], koncano: false });
  } finally {
    await s.ustavi();
    izv.zapri();
    p.stdin!.end();
    await new Promise((r) => (p.exitCode !== null ? r(null) : p.on("exit", r)));
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- Pregled A (zdruzitev 0225): A-1/A-18 (produkcijska veriga ovojev), A-17 ----
test("A-1: POST /nadaljuj skozi ovijCilj (kot v produkciji, asistent-telefon.server.ts) pride do izvajalca, ne 501", async () => {
  const l = lazni();
  const prejeto: unknown[][] = [];
  l.iz.nadaljuj = async (...a) => { prejeto.push(a); };
  const s = await streznik({ krog: [ANA], izvajalec: ovijCilj(l.iz, async () => null) });
  try {
    const n = telefonNaloga(ANA, idNaloge(), "uredi nacrt");
    assert.equal((await s.z("POST", `${POT}/naloga`, n)).status, 202);
    assert.equal((await s.z("POST", `${POT}/nadaljuj`, telefonNadaljuj(ANA, n.id, "korak 2"))).status, 202);
    assert.deepEqual(prejeto.map((a) => a.slice(0, 3)), [[n.id, "korak 2", ANA.id]]);
  } finally {
    await s.pospravi();
  }
});

test("A-17: notranje besedilo napake izvajalca (pot v domaci mapi) ne gre telefonu", async () => {
  const skrito = "connect ENOENT /home/uporabnik/.local/share/lina/kanal-claude.sock";
  const l = lazni();
  const iz: Izvajalec = { ...l.iz, zacni: async () => { throw new Error(skrito); } };
  const s = await streznik({ krog: [ANA], izvajalec: iz });
  try {
    const r = await s.z("POST", `${POT}/naloga`, telefonNaloga(ANA, idNaloge(), "uredi nacrt"));
    assert.equal(r.status, 503);
    assert.equal(r.telo.napaka, "claude-code-ni");
    assert.ok(!JSON.stringify(r.telo).includes("/home/"), JSON.stringify(r.telo));
  } finally {
    await s.pospravi();
  }
  const l2 = lazni();
  l2.iz.nadaljuj = async () => { throw new Error(skrito); };
  const s2 = await streznik({ krog: [ANA], izvajalec: l2.iz });
  try {
    const n = telefonNaloga(ANA, idNaloge(), "uredi nacrt");
    assert.equal((await s2.z("POST", `${POT}/naloga`, n)).status, 202);
    const r = await s2.z("POST", `${POT}/nadaljuj`, telefonNadaljuj(ANA, n.id, "korak 2"));
    assert.equal(r.status, 409);
    assert.equal(r.telo.napaka, "ni-v-teku");
    assert.ok(!JSON.stringify(r.telo).includes("/home/"), JSON.stringify(r.telo));
  } finally {
    await s2.pospravi();
  }
});

test("dovoljenja za podobne (02f): odobritev s telefona zapise dovoljenje SAMO z veljavnim locenim podpisom in samo za program ali dodatek", async () => {
  const s = await streznik({ krog: [ANA, BOR] });
  try {
    const id = idNaloge();
    assert.equal((await s.z("POST", `${POT}/naloga`, telefonNaloga(ANA, id, "uredi sliko z gimpom"))).status, 202);
    const odobri = async (zahtevaId: string, predogled: string, podobne: "brez" | "dober" | "slab" | "neoznacen", opis = "Uredi sliko") => {
      const zg = zgostitevPrikaza("Bash", predogled, opis);
      s.l.dogodek(id, { vrsta: "odobritev", zahtevaId, orodje: "Bash", predogled, opis, zgostitev: zg });
      const p = podpisi(ANA, (c, e) => nizOdobritve(zahtevaId, true, ANA.id, c, e, id, zg));
      const podpisPodobne = podobne === "dober" ? sign("sha256", Buffer.from(nizDovoljenjaOdobritve(ANA.id, zahtevaId, id, zg, p.cas, p.enkratni)), ANA.zasebni).toString("base64")
        : podobne === "slab" ? sign("sha256", Buffer.from(nizDovoljenjaOdobritve(ANA.id, zahtevaId, id, "0".repeat(64), p.cas, p.enkratni)), ANA.zasebni).toString("base64")
        : undefined;
      const telo = { nalogaId: id, zahtevaId, dovoli: true, posiljatelj: ANA.id, ...p, ...(podpisPodobne ? { podobnePodpis: podpisPodobne } : {}), ...(podobne === "neoznacen" ? { podobne: true } : {}) };
      assert.equal((await s.z("POST", `${POT}/odobritev`, telo)).status, 202);
    };
    const krog = new Map([[ANA.id, ANA.kljuc], [BOR.id, BOR.kljuc]]);
    await odobri("abcde", '{"command":"cli-anything-gimp --help"}', "brez");
    await odobri("abcdf", '{"command":"cli-anything-gimp --help"}', "neoznacen");     // polje brez podpisa ne pomeni nicesar
    await odobri("abcdg", '{"command":"cli-anything-gimp --help"}', "slab");
    await odobri("abcdh", '{"command":"git status"}', "dober");                        // poljuben ukaz nima obsega
    assert.equal(await najdiDovoljenje(s.dir, "program", { program: "gimp", podukaz: "--help" }, { naprava: ANA.id, kljuci: krog }), null);
    assert.equal((await readFile(path.join(s.dir, "dovoljenja-podobne.json"), "utf8").catch(() => "")), "");
    await odobri("abcdj", '{"command":"cli-anything-gimp --help"}', "dober");
    assert.ok(await najdiDovoljenje(s.dir, "program", { program: "gimp", podukaz: "--help" }, { naprava: ANA.id, kljuci: krog }));
    assert.equal(await najdiDovoljenje(s.dir, "program", { program: "gimp", podukaz: "--help" }, { naprava: BOR.id, kljuci: krog }), null);
    assert.equal(await najdiDovoljenje(s.dir, "program", { program: "gimp", podukaz: "--help" }), null, "racunalnik ne podeduje dovoljenja naprave");
    assert.equal(s.l.klici.filter((k) => k.kaj === "odobri").length, 5, "vsaka odobritev je sla izvajalcu kot prej");
  } finally {
    await s.pospravi();
  }
});

// ------------------------------------------------------------------ kontrola tiska: fotografija s telefona (24. 11. 2026)

/** Surovi bajti slike, podpis v glavah (preveri se pred branjem telesa). */
function posljiSliko(s: { vrata: number; cert: string; odtis: string }, bajti: Buffer, glave: Record<string, string>, tip = "image/jpeg"): Promise<{ status: number; telo: any } | { napaka: string }> {
  return new Promise((ok) => {
    const r = request({
      host: "127.0.0.1", port: s.vrata, method: "POST", path: POT_SLIKA_KONTROLE, ca: s.cert, rejectUnauthorized: true,
      checkServerIdentity: (_h, c) => (c.fingerprint256.replace(/:/g, "").toLowerCase() === s.odtis ? undefined : new Error("odtis")),
      headers: { "content-type": tip, "content-length": String(bajti.length), ...glave },
    }, (res) => {
      const k: Buffer[] = [];
      res.on("data", (d) => k.push(d));
      res.on("end", () => {
        let j: unknown = null;
        try { j = JSON.parse(Buffer.concat(k).toString("utf8")); } catch { /* ni JSON */ }
        ok({ status: res.statusCode ?? 0, telo: j });
      });
    });
    r.on("error", (e) => ok({ napaka: (e as NodeJS.ErrnoException).code ?? "napaka" }));
    r.end(bajti);
  });
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
function glaveSlike(d: Naprava, bajti: Buffer, cas?: number): Record<string, string> {
  const z = sha(bajti);
  const p = podpisi(d, (c, e) => nizSlikeKontrole(d.id, c, e, z), cas);
  return { "x-lina-posiljatelj": d.id, "x-lina-cas": String(p.cas), "x-lina-enkratni": p.enkratni, "x-lina-podpis": p.podpis, "x-lina-zgostitev": z };
}
const status = (r: { status: number } | { napaka: string }) => ("status" in r ? r.status : r.napaka);

test("kontrola tiska: podpisana fotografija s telefona se samo shrani v prejeto; nepodpisana, tuja, spremenjena, ne-slika in prevelika se zavrnejo", async () => {
  const s = await streznik({ krog: [{ id: ANA.id, kljuc: ANA.kljuc }] });
  try {
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(2000)]);
    const glave = glaveSlike(ANA, jpg);
    const r = await posljiSliko(s, jpg, glave);
    assert.ok("status" in r && r.status === 200, JSON.stringify(r));
    if (!("status" in r)) return;
    assert.equal(r.telo.sprejeto, true);
    assert.match(r.telo.id, /^\d{8}-\d{6}-[a-f0-9]{6}\.jpg$/);
    const pot = path.join(s.dir, "kontrola-tiska", "prejeto", r.telo.id);
    assert.ok(existsSync(pot));
    assert.equal(statSync(pot).mode & 0o777, 0o600);
    assert.equal(status(await posljiSliko(s, jpg, glave)), 403);                                   // ponovitev
    const druga = Buffer.concat([jpg.subarray(0, 100), Buffer.alloc(10)]);
    assert.equal(status(await posljiSliko(s, druga, glaveSlike(ANA, jpg))), 403);                 // telo ne ustreza podpisani zgostitvi
    assert.equal(status(await posljiSliko(s, jpg, glaveSlike(BOR, jpg))), 403);                   // naprava izven seznama
    assert.equal(status(await posljiSliko(s, jpg, { "x-lina-zgostitev": sha(jpg) })), 400);       // brez podpisa
    assert.equal(status(await posljiSliko(s, jpg, glaveSlike(ANA, jpg), "application/json")), 415);
    const pdf = Buffer.from("%PDF-1.4 nic");
    assert.equal(status(await posljiSliko(s, pdf, glaveSlike(ANA, pdf))), 415);                  // podpisano, a ni JPEG/PNG
    const velika = Buffer.alloc(17 * 1024 * 1024, 0xff);
    const v = await posljiSliko(s, velika, glaveSlike(ANA, velika));
    assert.ok(status(v) === 413 || status(v) === "ECONNRESET" || status(v) === "EPIPE", String(status(v)));  // odgovor pred branjem telesa
    assert.equal((await s.z("GET", POT_SLIKA_KONTROLE)).status, 405);
    assert.equal(POTI_ODDALJENO.has(POT_SLIKA_KONTROLE), false, "od zunaj doma pot ni dovoljena");
  } finally {
    await s.pospravi();
  }
});

// --- naloga 25: /naloga atomarna (N4), grob preklicanih id (N3b, N6c/d). Stevilke so dogovorjene (10 min, 50 na napravo), ne iz kode.
const ustaviNiz = (d: Naprava, id: string, cas?: number) => ({ id, posiljatelj: d.id, ...podpisi(d, (c, e) => nizUstavitve(id, d.id, c, e), cas) });
/** Izvajalec, katerega razpolozljiv() caka na vrata (zadrzan POST med preverbo in zacetkom). */
function zadrzan(seja = true) {
  const l = lazni();
  let odpri!: () => void;
  const vrata = new Promise<void>((r) => { odpri = r; });
  let razp = 0;
  const iz: Izvajalec = { ...l.iz, razpolozljiv: async () => { razp++; await vrata; return seja; } };
  return { iz, klici: l.klici, odpri, razp: () => razp };
}
/** CRR3-1: streznik je sprejel podpis zahteve z [enkratni] (zasebni seznam videni) - zahteva je prisla mimo preverbe podpisa. */
const sprejetPodpis = (s: AsistentStreznik, enkratni: string) => (s as unknown as { videni: Map<string, number> }).videni.has(enkratni);

test("naloga 25 N4: dve socasni oddaji istega id - ena izvedba, druga 409 obstaja", async () => {
  const z = zadrzan();
  const s = await streznik({ krog: [ANA], izvajalec: z.iz });
  try {
    const id = idNaloge();
    const izidi: number[] = [];
    const p1 = s.z("POST", `${POT}/naloga`, telefonNaloga(ANA, id, "pokazi datum")).then((r) => { izidi.push(r.status); return r; });
    await caka(() => z.razp() >= 1);
    const b2 = telefonNaloga(ANA, id, "pokazi datum");
    const p2 = s.z("POST", `${POT}/naloga`, b2).then((r) => { izidi.push(r.status); return r; });
    // brez rezervacije obe oddaji cakata na razpolozljiv; z njo druga caka na izid prve (in nato dobi 409); CRR3-1: znak namesto roka
    await caka(() => sprejetPodpis(s.s, b2.enkratni) || izidi.length >= 1);
    z.odpri();
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.deepEqual([r1.status, r2.status].sort(), [202, 409]);
    assert.equal((r1.status === 409 ? r1 : r2).telo.napaka, "obstaja");
    assert.equal(z.razp(), 1, "druga oddaja je cakala na izid prve, ni naredila svojega poskusa");
    assert.equal(z.klici.filter((k) => k.kaj === "zacni").length, 1);
  } finally {
    z.odpri();
    await s.pospravi();
  }
});

test("naloga 25 N3b: podpisan /ustavi pred POST - 202, POST nato 409 obstaja, nic ne tece; /ustavi ne steje med zavrnitve", async () => {
  const s = await streznik({ krog: [ANA] });
  try {
    const id = idNaloge();
    const u = await s.z("POST", `${POT}/ustavi`, ustaviNiz(ANA, id));
    assert.equal(u.status, 202, JSON.stringify(u.telo));
    const r = await s.z("POST", `${POT}/naloga`, telefonNaloga(ANA, id, "pokazi datum"));
    assert.equal(r.status, 409);
    assert.equal(r.telo.napaka, "obstaja");
    assert.equal(s.l.klici.length, 0, "ne zacni ne ustavi izvajalca");
    // vec kot meja zavrnitev takih /ustavi: naslov ni omejen (429), ker to niso zavrnitve
    for (let i = 0; i < NAJVEC_ZAVRNITEV_NA_MINUTO + 1; i++) assert.equal((await s.z("POST", `${POT}/ustavi`, ustaviNiz(ANA, idNaloge()))).status, 202);
    assert.equal((await s.z("POST", `${POT}/naloga`, telefonNaloga(ANA, idNaloge(), "pokazi datum"))).status, 202);
  } finally {
    await s.pospravi();
  }
});

test("naloga 25 N6c/d: /ustavi med cakanjem POST na sejo - naloga se ne zacne", async () => {
  const z = zadrzan();
  const s = await streznik({ krog: [ANA], izvajalec: z.iz });
  let p: Promise<Odgovor> | undefined;
  try {
    const id = idNaloge();
    p = s.z("POST", `${POT}/naloga`, telefonNaloga(ANA, id, "pokazi datum"));
    await caka(() => z.razp() >= 1);
    const u = await s.z("POST", `${POT}/ustavi`, ustaviNiz(ANA, id));
    z.odpri();
    const r = await p;
    assert.equal(u.status, 202);
    assert.equal(r.status, 409);
    assert.equal(z.klici.filter((k) => k.kaj === "zacni").length, 0);
    // ponovljen POST istega id (telefon po zasuku) se vedno ne tece
    assert.equal((await s.z("POST", `${POT}/naloga`, telefonNaloga(ANA, id, "pokazi datum"))).status, 409);
    assert.equal(z.klici.filter((k) => k.kaj === "zacni").length, 0);
  } finally {
    z.odpri();
    await p?.catch(() => undefined);
    await s.pospravi();
  }
});

test("naloga 25: grob velja 10 min, nato je id spet sprejet", async () => {
  const ura = { t: Date.now() };
  const s = await streznik({ krog: [ANA], ura });
  try {
    const id = idNaloge();
    assert.equal((await s.z("POST", `${POT}/ustavi`, ustaviNiz(ANA, id, ura.t))).status, 202);
    ura.t += 10 * 60_000 - 1000;
    assert.equal((await s.z("POST", `${POT}/naloga`, telefonNaloga(ANA, id, "pokazi datum", ura.t))).status, 409, "pred rokom");
    ura.t += 2000;
    assert.equal((await s.z("POST", `${POT}/naloga`, telefonNaloga(ANA, id, "pokazi datum", ura.t))).status, 202, "po roku");
  } finally {
    await s.pospravi();
  }
});

test("naloga 25: grob ne raste neomejeno - 50 na napravo, najstarejsi izpade, druga naprava ostane", async () => {
  const ura = { t: Date.now() };
  const s = await streznik({ krog: [ANA, BOR], ura });
  try {
    const borov = idNaloge();
    assert.equal((await s.z("POST", `${POT}/ustavi`, ustaviNiz(BOR, borov, ura.t))).status, 202);
    const ani: string[] = [];
    for (let i = 0; i < 51; i++) {
      if (i && i % 50 === 0) ura.t += 61_000;                                                    // okno 120 zahtev/min
      ani.push(idNaloge());
      assert.equal((await s.z("POST", `${POT}/ustavi`, ustaviNiz(ANA, ani[i], ura.t))).status, 202);
    }
    assert.equal((await s.z("POST", `${POT}/naloga`, telefonNaloga(ANA, ani[50], "x", ura.t))).status, 409, "najnovejsi ostane");
    assert.equal((await s.z("POST", `${POT}/naloga`, telefonNaloga(ANA, ani[1], "x", ura.t))).status, 409, "drugi najstarejsi ostane");
    assert.equal((await s.z("POST", `${POT}/naloga`, telefonNaloga(BOR, borov, "x", ura.t))).status, 409, "Anin grob ne izrine Borovega");
    assert.equal((await s.z("POST", `${POT}/naloga`, telefonNaloga(ANA, ani[0], "x", ura.t))).status, 202, "najstarejsi izpade");
  } finally {
    await s.pospravi();
  }
});

test("naloga 25: /ustavi brez veljavnega podpisa, z naprave izven seznama ali druge naprave ne zapise groba za Ano", async () => {
  const CENE = naprava();
  const s = await streznik({ krog: [ANA, BOR] });
  try {
    const id = idNaloge();
    assert.equal((await s.z("POST", `${POT}/ustavi`, { ...ustaviNiz(ANA, id), podpis: ustaviNiz(BOR, id).podpis })).status, 403, "podpis drugega kljuca");
    assert.equal((await s.z("POST", `${POT}/ustavi`, { id, posiljatelj: ANA.id, cas: Date.now(), enkratni: enkratni() })).status, 400, "brez podpisa");
    assert.equal((await s.z("POST", `${POT}/ustavi`, ustaviNiz(CENE, id))).status, 403, "naprava izven seznama");
    assert.equal((await s.z("POST", `${POT}/ustavi`, ustaviNiz(BOR, id))).status, 202, "Borov grob velja samo za Bora");
    assert.equal((await s.z("POST", `${POT}/naloga`, telefonNaloga(ANA, id, "pokazi datum"))).status, 202);
    assert.equal(s.l.klici.filter((k) => k.kaj === "zacni").length, 1);
    // Bor tudi zdaj ne more ustaviti Anine naloge (403, kot prej)
    assert.equal((await s.z("POST", `${POT}/ustavi`, ustaviNiz(BOR, id))).status, 403);
    assert.equal(s.l.klici.filter((k) => k.kaj === "ustavi").length, 0);
  } finally {
    await s.pospravi();
  }
});

test("naloga 25 (slepi pregled 1b): socasna oddaja istega id ob zaprti seji dobi 503 kot prva, ne 409 - telefon odda znova", async () => {
  const z = zadrzan(false);
  const s = await streznik({ krog: [ANA], izvajalec: z.iz });
  try {
    const id = idNaloge();
    const p1 = s.z("POST", `${POT}/naloga`, telefonNaloga(ANA, id, "pokazi datum"));
    await caka(() => z.razp() >= 1);
    let drugi = 0;
    const b2 = telefonNaloga(ANA, id, "pokazi datum");
    const p2 = s.z("POST", `${POT}/naloga`, b2).then((r) => { drugi = r.status; return r; });
    // CRR3-1: izrecen znak, da je druga oddaja prisla do rezervacije (podpis sprejet; od tu do cakanja na prvo ni await) - ne rok 300 ms
    await caka(() => sprejetPodpis(s.s, b2.enkratni) || drugi !== 0);
    z.odpri();
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1.status, 503);
    assert.equal(r2.status, 503, "druga oddaja ne sme reci obstaja za nalogo, ki je racunalnik ni sprejel");
    assert.equal(z.razp(), 1, "druga oddaja je cakala na izid prve, ni naredila svojega poskusa");
    assert.equal(z.klici.filter((k) => k.kaj === "zacni").length, 0);
  } finally {
    z.odpri();
    await s.pospravi();
  }
});

test("naloga 25 (slepi pregled 2): /ustavi med cakanjem na zaprto sejo - seja Claude Code se za preklicano nalogo ne odpira", async () => {
  const z = zadrzan(false);
  let odprta = 0;
  const s = await streznik({ krog: [ANA], izvajalec: z.iz, odpriSejoClaude: async () => { odprta++; return { ok: true }; } });
  let p: Promise<Odgovor> | undefined;
  try {
    const id = idNaloge();
    p = s.z("POST", `${POT}/naloga`, telefonNaloga(ANA, id, "pokazi datum"));
    await caka(() => z.razp() >= 1);
    const u = await s.z("POST", `${POT}/ustavi`, ustaviNiz(ANA, id));
    z.odpri();
    const r = await p;
    assert.equal(u.status, 202);
    assert.equal(r.status, 409);
    assert.equal(odprta, 0);
  } finally {
    z.odpri();
    await p?.catch(() => undefined);
    await s.pospravi();
  }
});

test("naloga 25 (slepi pregled 7): Borov /ustavi, ki se preverja med Aninim sprejemom istega id, Anine naloge ne ustavi (403)", async () => {
  let odpri!: () => void;
  const vrata = new Promise<void>((r) => { odpri = r; });
  let branj = 0;
  const preberi: typeof preberiKanal = async (...a) => { if (++branj === 1) await vrata; return preberiKanal(...a); };
  const s = await streznik({ krog: [ANA, BOR], preberi });
  let ub: Promise<Odgovor> | undefined;
  try {
    const id = idNaloge();
    ub = s.z("POST", `${POT}/ustavi`, ustaviNiz(BOR, id));                                          // Bor: branje kanala zadrzano
    await caka(() => branj >= 1);
    assert.equal((await s.z("POST", `${POT}/naloga`, telefonNaloga(ANA, id, "pokazi datum"))).status, 202);
    odpri();
    assert.equal((await ub).status, 403);
    assert.equal(s.l.klici.filter((k) => k.kaj === "ustavi").length, 0, "Anina naloga ni ustavljena");
  } finally {
    odpri();
    await ub?.catch(() => undefined);
    await s.pospravi();
  }
});

// --- naloga 26r (CodeRabbit r3, CRR3-3): /ustavi med zacni vrne 202, odlozena ustavitev ne sme ostati enkratna
/** Izvajalec: zacni preveri preklic (kot pravi) in nato caka na vrata; ustavi prvih [neuspehov] klicev vrze (seja se znova povezuje). */
function ustavitevPoZacni(neuspehov: number) {
  const l = lazni();
  let odpri!: () => void;
  const vrata = new Promise<void>((r) => { odpri = r; });
  const ustavitve: Array<"napaka" | "ok"> = [];
  const iz: Izvajalec = {
    ...l.iz,
    zacni: async (n, cb, preklicana) => { l.klici.push({ kaj: "zacni", args: [n] }); if (preklicana?.()) throw new Error("preklicana"); await vrata; void cb; },
    ustavi: async () => {
      if (ustavitve.length < neuspehov) { ustavitve.push("napaka"); throw new Error("Ustavitve ni bilo mogoce poslati: seja Claude Code ni dosegljiva."); }
      ustavitve.push("ok");
    },
  };
  return { iz, klici: l.klici, odpri, ustavitve };
}

test("naloga 26r CRR3-3: /ustavi med oddajo v sejo (202), prva ustavitev pade - streznik jo ponovi, ko se povezava vrne", async () => {
  const prej = ponovitevUstavitve.ms;
  ponovitevUstavitve.ms = 20;
  const z = ustavitevPoZacni(2);
  const dnevnik: string[] = [];
  const s = await streznik({ krog: [ANA], izvajalec: z.iz, dnevnik: (v) => dnevnik.push(v) });
  try {
    const id = idNaloge();
    const p = s.z("POST", `${POT}/naloga`, telefonNaloga(ANA, id, "pokazi datum"));
    await caka(() => z.klici.some((k) => k.kaj === "zacni"));
    assert.equal((await s.z("POST", `${POT}/ustavi`, ustaviNiz(ANA, id))).status, 202, "telefon dobi 202 in ustavitve ne poslje vec");
    z.odpri();
    assert.equal((await p).status, 202);
    await caka(() => z.ustavitve.includes("ok"), 3000);
    assert.deepEqual(z.ustavitve, ["napaka", "napaka", "ok"]);
    await premor(100);
    assert.equal(z.ustavitve.length, 3, "po uspeli ustavitvi ni vec poskusov");
    assert.equal(dnevnik.filter((v) => v.includes("ustavitev po zacetku ni uspela")).length, 1, "dnevnik enkrat, ne ob vsakem poskusu");
  } finally {
    ponovitevUstavitve.ms = prej;
    z.odpri();
    await s.pospravi();
  }
});

test("naloga 26r CRR3-3: ponavljanje odlozene ustavitve se konca, ko se streznik ustavi", async () => {
  const prej = ponovitevUstavitve.ms;
  ponovitevUstavitve.ms = 20;
  const z = ustavitevPoZacni(Number.MAX_SAFE_INTEGER);
  const s = await streznik({ krog: [ANA], izvajalec: z.iz });
  let n = 0;
  try {
    const id = idNaloge();
    const p = s.z("POST", `${POT}/naloga`, telefonNaloga(ANA, id, "pokazi datum"));
    await caka(() => z.klici.some((k) => k.kaj === "zacni"));
    assert.equal((await s.z("POST", `${POT}/ustavi`, ustaviNiz(ANA, id))).status, 202);
    z.odpri();
    await p;
    await caka(() => z.ustavitve.length >= 3, 3000);
  } finally {
    // slepi pregled 26r N5: stevec preberi SINHRONO ob ustavitvi (pospravi do prvega await ustavi streznik); klic izvajalca se zapise
    // ob zacetku, zato n vsebuje vsak klic, ki je tekel ob ustavitvi - casovnik, ki sprozi med zapiranjem, se steje kot nov poskus
    const zapri = s.pospravi();
    n = z.ustavitve.length;
    await zapri;
    ponovitevUstavitve.ms = prej;
  }
  await premor(150);
  assert.equal(z.ustavitve.length, n, "po ustavitvi streznika ni novih poskusov (tudi casovnik, ki je ze cakal, ne poskusi)");
});
