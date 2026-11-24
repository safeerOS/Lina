// Koncna tocka asistentke za telefon (asistent-streznik.server.ts). Pravi TLS, pripet odtis kot na telefonu (PinnedHttp), pravi
// podpisi iz Kotlina (vektor) in skozi pravi kanal Claude Code. Vsako varovalo preverjeno z mutacijo (orodja/lina-kanal-mutacije.py).
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, randomBytes, sign, X509Certificate, type KeyObject } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { request } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { IzvajalecClaudeCode, type Dogodek, type Izvajalec, type Naloga } from "./asistent.server.ts";
import {
  AsistentStreznik, NAJVEC_NEZNANIH_NA_MINUTO, NAJVEC_POVEZAV_NA_NASLOV, NAJVEC_ZAHTEV_NA_MINUTO, NAJVEC_ZAVRNITEV_NA_MINUTO, POT, odtisPotrdila, potrdiloAsistenta, ustvariPotrdilo, zasebenNaslov, zasebenOdjemalec,
} from "./asistent-streznik.server.ts";
import { idIzKljuca, nizDogodkov, nizNaloge, nizOdobritve, nizUstavitve, potVticnice, zgostitevPrikaza, type Dokaz } from "./kanal-claude.ts";
import { preberiKanal, pripraviKanal } from "./kanal-claude.server.ts";

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

async function streznik(o: { krog: Array<{ id: string; kljuc: string }>; ura?: { t: number }; izvajalec?: Izvajalec; preberi?: typeof preberiKanal; rokRokovanja?: number }) {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-as-"));
  await pripraviKanal(o.krog, dir);
  const l = lazni();
  const s = new AsistentStreznik({ root: dir, izvajalec: o.izvajalec ?? l.iz, zdaj: o.ura ? () => o.ura!.t : undefined, dnevnik: () => {}, preberiKanal: o.preberi, rokRokovanja: o.rokRokovanja });
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
    const o = { nalogaId: KT.naloga.id, zahtevaId: "abcde", dovoli: true, posiljatelj: KT.id, cas: KT.cas + 1000, enkratni: "kotlin-enkratni-0002", podpis: KT.odobritev };
    assert.equal((await s.z("POST", `${POT}/odobritev`, o)).status, 202);
    assert.deepEqual(s.l.klici.find((k) => k.kaj === "odobri")!.args.slice(0, 4), [KT.naloga.id, "abcde", true, KT.id]);
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

