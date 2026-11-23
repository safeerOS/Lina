// Skupni vektorji TS <-> Kotlin (T2, 15. 11. 2026): datoteka vektorji-lina-v1.json je ENA za obe strani. Ta preizkus pove, da
// Lina (TS) ustvari natanko to, kar je v datoteki, in da pravi streznik asistentke (pravi TLS) sprejme telesa, ki jih po
// pogodbi sestavi Android, ter odgovori z zapisom, ki ga Android razbere. Android bere isto datoteko (SkupniVektorjiTest).
import assert from "node:assert/strict";
import { X509Certificate, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Dogodek, Izvajalec, Naloga } from "./asistent.server.ts";
import {
  AsistentStreznik, KODA_SEZNANITVE, POT, imeNaprave, potrdiloAsistenta, ustvariPotrdilo, zasebenNaslov, type Seznanitve, type StanjeSeznanitve,
} from "./asistent-streznik.server.ts";
import { ENKRATNI, ID_NAPRAVE, ID_ODOBRITVE, idIzKljuca, idPripadaKljucu, nizDogodkov, nizKlici, nizNaloge, nizOdobritve, nizSeznanitve, nizStanja, nizUstavitve, praviUnicode, preveriPodpisNaprave, zgostitevPrikaza } from "./kanal-claude.ts";
import { pripraviKanal } from "./kanal-claude.server.ts";
import { ID_LINE, NapakaKode, SeznanitevSKodo, macKljuca } from "./koda-seznanitev.ts";
import { POT_VEKTORJEV, podpisnikIzDatoteke, ustvariVektorje, FP_LINA, T0 } from "./skupni-vektorji.ts";
import { Spake2, wIzKode } from "./spake2.ts";
import { VarovalkaKode } from "./varovalka-kode.ts";
import { vsebinaQr } from "./asistent-telefon.server.ts";

/** Kopija datoteke v Androidu (openline/android/skupni-vektorji) mora imeti ISTO vsoto; spremeni se skupaj z datoteko. */
const SHA256_VEKTORJEV = "76d49c1df06e4373dec9689b9d3e2cff20194bcccaa6b69c47a9653ff883f52b";

const surovo = readFileSync(POT_VEKTORJEV);
const V = JSON.parse(surovo.toString("utf8")) as any;

test("vektorji: vsota datoteke je pripeta (Android ima isto kopijo) in Lina ustvari natanko to datoteko (brez podpisov, ki se jih ne da ponoviti)", () => {
  assert.equal(createHash("sha256").update(surovo).digest("hex"), SHA256_VEKTORJEV, "datoteka se je spremenila: posodobi vsoto v obeh preizkusih in kopijo v Androidu");
  assert.deepEqual(ustvariVektorje(podpisnikIzDatoteke(V)), V);
});

test("QR v1: vsebinaQr da natanko besedilo iz vektorja (Android ga razbere v pricakovana polja)", () => {
  let n = 0;
  for (const p of V.qr_v1.pozitivni) {
    if (!p.vhod) continue;
    assert.equal(vsebinaQr(p.vhod.asistent, p.vhod.klici, p.vhod.doMs), p.besedilo, p.ime);
    n++;
  }
  assert.ok(n >= 5);
  assert.ok(V.qr_v1.zavrnjeni.length >= 20);
  for (const z of V.qr_v1.zavrnjeni) assert.notEqual(z.besedilo, V.qr_v1.pozitivni[0].besedilo + "\n", z.ime);
});

test("naslovi: zasebenNaslov se ujema s pravilom, ki ga isti vektor drzi v Androidu (AsistentQr.jeZasebniNaslov)", () => {
  for (const n of V.naslovi) assert.equal(zasebenNaslov(n.naslov), n.zasebni, `naslov ${n.naslov}`);
});

test("imena naprav: imeNaprave se ujema z veljavnoIme v Androidu", () => {
  for (const i of V.imena) assert.equal(imeNaprave(i.ime), i.veljavno, JSON.stringify(i.ime));
});

test("podpisi: nizi so bajt za bajtom isti, podpisi telefona (JCA/Node ECDSA) preveri TS, spremenjen niz ne", () => {
  const id = idIzKljuca(V.podpis.kljuc);
  assert.equal(V.podpis.id, id);
  assert.ok(ID_NAPRAVE.test(id));
  for (const z of V.zgostitve) assert.equal(zgostitevPrikaza(z.orodje, z.predogled, z.opis), z.sha256);
  const pricakovan: Record<string, (v: any) => string> = {
    naloga: (v) => nizNaloge(v.id, v.posiljatelj, v.besedilo, v.cas, v.enkratni),
    odobritev: (v) => nizOdobritve(v.zahtevaId, v.dovoli, v.posiljatelj, v.cas, v.enkratni, v.chatId, v.zgostitev),
    ustavitev: (v) => nizUstavitve(v.id, v.posiljatelj, v.cas, v.enkratni),
    stanje: (v) => nizStanja(v.posiljatelj, v.cas, v.enkratni),
    seznanitev: (v) => nizSeznanitve(v.koda, v.id, v.kljuc, v.ime, v.cas, v.enkratni),
    dogodki: (v) => nizDogodkov(v.id, v.posiljatelj, v.cas, v.enkratni),
    klici: (v) => nizKlici(v.koda, v.posiljatelj, v.cas, v.enkratni),
  };
  assert.equal(V.podpis.nizi.length, 8);
  assert.deepEqual(V.podpis.nizi.filter((n: any) => n.vrsta === "dogodki" || n.vrsta === "klici").map((n: any) => n.ime), ["dogodki", "klici"]);
  for (const n of V.podpis.nizi) {
    assert.equal(pricakovan[n.vrsta](n.vhod), n.niz, n.ime);
    assert.equal(preveriPodpisNaprave(V.podpis.kljuc, n.niz, n.podpis), true, n.ime);
    assert.equal(preveriPodpisNaprave(V.podpis.kljuc, n.niz + "x", n.podpis), false, `spremenjen niz ${n.ime}`);
  }
  const razlogi: Record<string, (v: any) => boolean> = {
    enkratni_kratek: (v) => !ENKRATNI.test(v.enkratni),
    enkratni_nedovoljen_znak: (v) => !ENKRATNI.test(v.enkratni),
    posiljatelj_oblika: (v) => !ID_NAPRAVE.test(v.posiljatelj),
    osamljen_nadomestni: (v) => !praviUnicode(v.besedilo),
    zahtevaId_oblika: (v) => !ID_ODOBRITVE.test(v.zahtevaId),
    zgostitev_oblika: (v) => !/^[0-9a-f]{64}$/.test(v.zgostitev),
    koda_kratka: (v) => !KODA_SEZNANITVE.test(v.koda),
    id_ne_iz_kljuca: (v) => !idPripadaKljucu(v.id, v.kljuc),
    ime_prazno: (v) => !imeNaprave(v.ime),
  };
  for (const z of V.podpis.zavrnjeni) assert.equal(razlogi[z.razlog](z.vhod), true, `TS bi to zavrnil: ${z.razlog}`);
});

test("SPAKE2: w, pB, pA, cA, cB, Ke in MAC iz vektorja izracuna TS z znanima skalarjema (nacin A, nacin B, napacna koda)", () => {
  for (const w of V.koda.w) assert.equal(wIzKode(w.koda, Buffer.from(w.sol_utf8)).toString(16).padStart(64, "0"), w.w);
  for (const t of V.koda.toki) {
    const sol = Buffer.from(t.pair_id, "utf8"), aad = Buffer.from(t.odtis, "utf8");
    assert.equal(wIzKode(t.koda_telefon, sol).toString(16).padStart(64, "0"), t.w_telefon);
    const tel = Spake2.odjemalec(t.koda_telefon, t.id, ID_LINE, aad, sol, BigInt("0x" + t.y_telefon));
    const lina = Spake2.streznik(t.nacin === "B" ? t.koda_vnos_lastnika.replace(/\s+/g, "") : t.koda_lina, ID_LINE, t.id, aad, sol, BigInt("0x" + t.x_lina));
    assert.equal(tel.sporocilo().toString("hex"), t.spake_telo.pb);
    const { potrditev: ca } = lina.zakljuci(tel.sporocilo());
    assert.equal(lina.sporocilo().toString("hex"), t.spake_odgovor.pa);
    assert.equal(ca.toString("hex"), t.spake_odgovor.ca);
    const { ke, potrditev } = tel.zakljuci(lina.sporocilo());
    assert.equal(tel.preveri(ca), t.ca_velja);
    if (t.ca_velja) {
      assert.equal(ke.toString("hex"), t.ke);
      assert.equal(potrditev.toString("hex"), t.cb);
      assert.equal(lina.preveri(potrditev), true);
      assert.equal(macKljuca(ke, t.pair_id, t.id, V.podpis.kljuc).toString("hex"), t.mac);
      assert.equal(preveriPodpisNaprave(V.podpis.kljuc, t.niz_podpisa, t.potrdi_telo.podpis), true);
      assert.equal(nizSeznanitve(t.pair_id, t.id, V.podpis.kljuc, t.ime_telefona, t.potrdi_telo.cas, t.potrdi_telo.enkratni), t.niz_podpisa);
    } else {
      assert.equal(lina.preveri(potrditev), false, "napacna koda: tudi Lina cB ne sprejme");
    }
  }
});

// ------------------------------------------------------------------------------ pravi streznik (TLS), telesa iz vektorja
type Odgovor = { status: number; telo: any };
function zahteva(vrata: number, cert: string, odtis: string, metoda: string, pot: string, telo?: unknown): Promise<Odgovor> {
  return new Promise((ok, ne) => {
    const r = request({
      host: "127.0.0.1", port: vrata, method: metoda, path: pot, ca: cert, rejectUnauthorized: true,
      checkServerIdentity: (_h, c) => (c.fingerprint256.replace(/:/g, "").toLowerCase() === odtis ? undefined : new Error("odtis se ne ujema")),
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

function lazni(odprta = true) {
  const klici: Array<{ kaj: string; args: unknown[] }> = [];
  const poslusalci = new Map<string, (d: Dogodek) => void>();
  const iz: Izvajalec = {
    ime: "lazni",
    razpolozljiv: async () => odprta,
    zacni: async (n: Naloga, cb) => { klici.push({ kaj: "zacni", args: [n] }); poslusalci.set(n.id, cb); },
    odobri: async (...a) => { klici.push({ kaj: "odobri", args: a }); },
    ustavi: async (...a) => { klici.push({ kaj: "ustavi", args: a }); },
  };
  return { iz, klici, dogodek: (id: string, d: Dogodek) => poslusalci.get(id)!(d) };
}

/** Seznanitve, kot jih vodi Lina: QR koda je odprta, prijava caka; prijaviPoKodi vrne razdelek poti klicev (kot OpenLine). */
function lazneSeznanitve(klici: { url: string; code: string; fp: string }) {
  const st = new Map<string, StanjeSeznanitve>([[V.podpis.nizi.find((n: any) => n.ime === "seznanitev_qr").vhod.koda, "odprta"]]);
  const prijave: Array<{ koda: string; id: string; ime: string }> = [];
  const s: Seznanitve = {
    stanje: (k) => st.get(k) ?? null,
    prijavi: (k, n) => { if (st.get(k) !== "odprta") return false; st.set(k, "caka"); prijave.push({ koda: k, id: n.id, ime: n.ime }); return true; },
    prijaviPoKodi: (k, n) => { st.set(k, "caka"); prijave.push({ koda: k, id: n.id, ime: n.ime }); return true; },
    klici: (k, id) => (prijave.some((p) => p.koda === k && p.id === id) ? klici : undefined),
  };
  return { s, prijave };
}

async function streznik(o: { krog?: Array<{ id: string; kljuc: string }>; odprta?: boolean }) {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-vek-"));
  await pripraviKanal(o.krog ?? [], dir);
  const ura = { t: T0 - 5000 };
  const l = lazni(o.odprta ?? true);
  const varovalka = new VarovalkaKode({ ura: () => ura.t / 1000 });
  const zaporedje = V.koda.toki as any[];
  let zadnji = 0;
  const koda = new SeznanitevSKodo({
    varovalka, odtis: () => FP_LINA, zdaj: () => ura.t, koda: () => "482913",
    nakljucno: { pairId: () => zaporedje[zadnji].pair_id, skalar: () => BigInt("0x" + zaporedje[zadnji].x_lina) },
  });
  const klici = V.asistent.klici_odgovori[0].telo.klici;
  const lazneS = lazneSeznanitve(klici);
  const s = new AsistentStreznik({ root: dir, izvajalec: l.iz, seznanitve: lazneS.s, koda, zdaj: () => ura.t, dnevnik: () => {} });
  const { vrata, odtis } = await s.zazeni();
  const { cert } = await potrdiloAsistenta(dir);
  const z = (metoda: string, pot: string, telo?: unknown) => zahteva(vrata, cert, odtis, metoda, `${POT}${pot}`, telo);
  return {
    s, l, z, ura, koda, lazneS, izberi: (i: number) => { zadnji = i; },
    pospravi: async () => { await s.ustavi(); await rm(dir, { recursive: true, force: true }); },
  };
}

test("streznik: telesa iz vektorja (naloga, odobritev, ustavitev, seznanitev QR, stanje seje) so sprejeta, odgovori imajo zapis iz vektorja", async () => {
  const A = V.asistent, id = V.podpis.id;
  const sv = await streznik({ krog: [{ id, kljuc: V.podpis.kljuc }] });
  try {
    sv.ura.t = T0 + 3000;
    const r = await sv.z("POST", "/naloga", A.naloga_telo);
    assert.equal(r.status, 202, JSON.stringify(r.telo));
    assert.deepEqual(r.telo, { id: A.id_naloge });
    const nal = sv.l.klici.find((k) => k.kaj === "zacni")!.args[0] as Naloga;
    assert.equal(nal.besedilo, A.naloga_telo.besedilo);
    for (const d of A.dogodki_vhod) sv.l.dogodek(A.id_naloge, d.vrsta === "odobritev" ? { ...d, zgostitev: zgostitevPrikaza(d.orodje, d.predogled, d.opis) } : d);
    // T1-N3: /dogodki je podpisan (vektor "dogodki": isti niz kot v Androidu)
    const vd = V.podpis.nizi.find((n: any) => n.ime === "dogodki");
    assert.equal(vd.vhod.id, A.id_naloge);
    assert.deepEqual({ ...A.dogodki_poizvedba }, { ...vd.vhod, podpis: vd.podpis });
    const qd = new URLSearchParams({ id: A.id_naloge, posiljatelj: A.dogodki_poizvedba.posiljatelj, cas: String(A.dogodki_poizvedba.cas), enkratni: A.dogodki_poizvedba.enkratni, podpis: A.dogodki_poizvedba.podpis, od: "0" });
    const d = await sv.z("GET", `/dogodki?${qd}`);
    assert.equal(d.status, 200);
    const pricakovano = JSON.parse(JSON.stringify(A.dogodki_odgovor));
    // streznik za odobritev doda zgostitev prikazanega (Android je ne uporabi, izracuna svojo iz prikazanih polj)
    for (const e of d.telo.dogodki) if (e.vrsta === "odobritev") { assert.equal(e.zgostitev, zgostitevPrikaza(e.orodje, e.predogled, e.opis)); delete e.zgostitev; }
    assert.deepEqual(d.telo, pricakovano);
    const o = await sv.z("POST", "/odobritev", A.odobritev_telo);
    assert.equal(o.status, 202, JSON.stringify(o.telo));
    assert.deepEqual(sv.l.klici.find((k) => k.kaj === "odobri")!.args.slice(0, 4), [A.id_naloge, "abcde", true, id]);
    assert.equal((await sv.z("POST", "/ustavi", A.ustavitev_telo)).status, 202);
    // stanje seje: podpisana poizvedba kot GET z iskalnimi parametri
    const q = new URLSearchParams({ posiljatelj: A.stanje_poizvedba.posiljatelj, cas: String(A.stanje_poizvedba.cas), enkratni: A.stanje_poizvedba.enkratni, podpis: A.stanje_poizvedba.podpis });
    const st = await sv.z("GET", `/stanje?${q}`);
    assert.deepEqual([st.status, st.telo], [A.seja[0].status, A.seja[0].telo]);
    // seznanitev QR: telo iz vektorja, nato stanje (naprava se v seznam kanala vpise sele z lastnikovim »Dodaj«, T1-N10: vpisana dobi 409)
    const sz409 = await sv.z("POST", "/seznani", A.seznanitev_telo);
    assert.equal(sz409.status, 409, "naprava, ki je ze na seznamu, se ne seznani znova");
    const nov = await streznik({});
    try {
      nov.ura.t = T0 + 3000;
      const sz = await nov.z("POST", "/seznani", A.seznanitev_telo);
      assert.deepEqual([sz.status, sz.telo], [202, A.seznanitev_stanja[0].telo]);
      assert.deepEqual(nov.lazneS.prijave, [{ koda: A.seznanitev_telo.koda, id, ime: A.seznanitev_telo.ime }]);
      const sg = await nov.z("GET", `/seznani?koda=${A.seznanitev_telo.koda}`);
      assert.deepEqual([sg.status, sg.telo], [200, A.seznanitev_stanja[0].telo]);
      // T1-S1: pred »Dodaj« (naprave ni na seznamu kanala) pot klicev ne gre ven
      assert.equal((await nov.z("POST", "/seznani/klici", A.klici_telo)).status, 403, "naprava izven seznama ne dobi poti klicev");
    } finally {
      await nov.pospravi();
    }
    // T1-S1: po »Dodaj« (naprava je na seznamu, prijava sprejeta) telefon s podpisom nizKlici prevzame pot klicev
    assert.equal(sv.lazneS.s.prijaviPoKodi!(A.seznanitev_telo.koda, { id, kljuc: V.podpis.kljuc, ime: A.seznanitev_telo.ime }), true);
    const kl = await sv.z("POST", "/seznani/klici", A.klici_telo);
    assert.deepEqual([kl.status, kl.telo], [A.klici_odgovori[0].status, A.klici_odgovori[0].telo]);
    assert.equal((await sv.z("POST", "/seznani/klici", { ...A.klici_telo, enkratni: "enkratniKlici-9999", podpis: A.naloga_telo.podpis })).status, 403, "podpis drugega niza ne velja");
  } finally {
    await sv.pospravi();
  }
});

test("streznik: seja Claude Code zaprta - 503 in stanje z zapisom iz vektorja", async () => {
  const A = V.asistent, id = V.podpis.id;
  const sv = await streznik({ krog: [{ id, kljuc: V.podpis.kljuc }], odprta: false });
  try {
    sv.ura.t = T0 + 3000;
    const r = await sv.z("POST", "/naloga", A.naloga_telo);
    assert.equal(r.status, A.seja[2].status);
    assert.equal(r.telo.napaka, A.seja[2].telo.napaka);
    assert.deepEqual(r.telo.stanje, A.seja[2].telo.stanje);
    const q = new URLSearchParams({ posiljatelj: A.stanje_poizvedba.posiljatelj, cas: String(A.stanje_poizvedba.cas), enkratni: A.stanje_poizvedba.enkratni, podpis: A.stanje_poizvedba.podpis });
    const st = await sv.z("GET", `/stanje?${q}`);
    assert.deepEqual([st.status, st.telo], [A.seja[1].status, A.seja[1].telo]);
  } finally {
    await sv.pospravi();
  }
});

test("streznik: seznanitev s kodo (nacin A in B) - telesa iz vektorja dajo odgovore iz vektorja, napacna koda ne preide (odpovej)", async () => {
  const id = V.podpis.id;
  const sv = await streznik({});
  try {
    sv.ura.t = T0;
    for (const [i, t] of (V.koda.toki as any[]).entries()) {
      sv.izberi(i);
      sv.ura.t = T0;
      sv.koda.odpri();
      const z = await sv.z("POST", "/koda/zacni", t.zacni_telo);
      assert.deepEqual([z.status, z.telo], [200, t.zacni_odgovor], t.ime);
      if (t.nacin === "B") {
        const prej = await sv.z("POST", "/koda/spake", t.spake_telo);
        assert.deepEqual([prej.status, prej.telo.napaka], [409, "caka_kodo"], "nacin B: dokler lastnik ne vtipka kode");
        sv.koda.vnesiKodo(t.pair_id, t.koda_vnos_lastnika);
      }
      sv.ura.t = T0 + 1000;
      const s = await sv.z("POST", "/koda/spake", t.spake_telo);
      assert.deepEqual([s.status, s.telo], [200, t.spake_odgovor], t.ime);
      if (t.ca_velja) {
        sv.ura.t = T0 + 3000;
        const p = await sv.z("POST", "/koda/potrdi", t.potrdi_telo);
        assert.deepEqual([p.status, p.telo], [202, t.potrdi_odgovor], t.ime);
        const g = await sv.z("GET", `/seznani?koda=${t.pair_id}`);
        assert.deepEqual([g.status, g.telo], [200, { stanje: "caka" }]);
        assert.equal(sv.koda.odprto(), false, "koda je za en telefon");
      } else {
        const o = await sv.z("POST", "/koda/odpovej", t.odpovej_telo);
        assert.deepEqual([o.status, o.telo], [200, t.odpovej_odgovor], t.ime);
        const po = await sv.z("POST", "/koda/odpovej", t.odpovej_telo);
        assert.deepEqual([po.status, po.telo.napaka], [409, "manjka_korak"], "drugic ni kroga za odpoved");
        sv.koda.zapri();
      }
    }
  } finally {
    await sv.pospravi();
  }
});

test("napake poti /koda/*: vsaka (status, napaka) iz vektorja je prava napaka Line (Android jih preslika v NapakaKode)", async () => {
  const videne = new Set<string>();
  const kljuci = (e: NapakaKode) => { videne.add(`${e.status} ${e.koda}`); return e; };
  const nova = (koda = "482913") => {
    const ura = { t: T0 };
    const varovalka = new VarovalkaKode({ ura: () => ura.t / 1000 });
    return new SeznanitevSKodo({ varovalka, odtis: () => FP_LINA, zdaj: () => ura.t, koda: () => koda });
  };
  const ID = V.podpis.id;
  const lov = (f: () => unknown): NapakaKode => { try { f(); } catch (e) { if (e instanceof NapakaKode) return kljuci(e); throw e; } throw new Error("napake ni bilo: " + f.toString().slice(0, 90)); };
  const pb = () => Spake2.odjemalec("482913", ID, ID_LINE).sporocilo();
  let k = nova();
  assert.equal(lov(() => k.zacni("v", ID, "Ana", false)).koda, "ni_odprto");
  k.odpri();
  const z = k.zacni("v", ID, "Ana", false);
  assert.equal(lov(() => k.spake("A".repeat(22), ID, pb())).koda, "prijava_ne_obstaja");
  assert.equal(lov(() => k.potrdi(z.pair_id, ID, V.podpis.kljuc, Buffer.alloc(32), Buffer.alloc(32))).koda, "manjka_korak");
  assert.equal(lov(() => k.spake(z.pair_id, ID, Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]))).koda, "neveljavna_tocka");
  k.spake(z.pair_id, ID, pb());
  assert.equal(lov(() => k.potrdi(z.pair_id, ID, V.podpis.kljuc, Buffer.alloc(32), Buffer.alloc(32))).koda, "napacna_koda");
  for (let i = 0; i < 3; i++) k.spake(z.pair_id, ID, pb());
  assert.equal(lov(() => k.spake(z.pair_id, ID, pb())).koda, "prevec_poskusov");
  k = nova(); k.odpri();
  for (let i = 0; i < 8; i++) k.zacni("v", ID, "Ana", false);
  assert.equal(lov(() => k.zacni("v", ID, "Ana", false)).koda, "prevec_cakajocih");
  k = nova(); k.odpri();
  const b = k.zacni("v", ID, "Ana", true);
  assert.equal(lov(() => k.spake(b.pair_id, ID, pb())).koda, "caka_kodo");
  k = nova();
  assert.equal(lov(() => { for (let i = 0; i < 60; i++) { k.odpri(); const q = k.zacni("vir", ID, "Ana", false); k.spake(q.pair_id, ID, pb()); } }).koda, "seznanitev_zaprta");
  // id_zaseden, zavrnjeno in oblika vrne streznik s HTTP
  const sv = await streznik({ krog: [{ id: ID, kljuc: V.podpis.kljuc }] });
  try {
    sv.ura.t = T0 + 3000;
    sv.izberi(0);
    sv.koda.odpri();
    const zs = await sv.z("POST", "/koda/zacni", V.koda.toki[0].zacni_telo);
    videne.add(`${zs.status} ${zs.telo.napaka}`);
    const ob = await sv.z("POST", "/koda/zacni", { id: "ni-id", ime: "Ana" });
    videne.add(`${ob.status} ${ob.telo.napaka}`);
    const zv = await sv.z("POST", "/naloga", { ...V.asistent.naloga_telo, besedilo: "izbrisi vse" });
    videne.add(`${zv.status} ${zv.telo.napaka}`);
  } finally {
    await sv.pospravi();
  }
  for (const n of V.koda.napake) assert.ok(videne.has(`${n.status} ${n.napaka}`), `Lina ne vrne ${n.status} ${n.napaka}`);
});

// Najdba T2: serijska stevilka z vodilno nicljo (zapis 00 + bajt < 0x80, okoli 1 od 200 potrdil) ni bila najkrajsi DER in OpenSSL
// je potrdilo zavrnil (»illegal padding«): streznik asistentke bi se naklucno ne zagnal. Brez popravka (celo v streznik) pade.
test("potrdilo asistentke: 2500 novih potrdil je vsa veljavnih (serijska stevilka v najkrajsem DER)", () => {
  let slabih = 0;
  for (let i = 0; i < 2500; i++) {
    try { new X509Certificate(ustvariPotrdilo().cert); } catch { slabih++; }
  }
  assert.equal(slabih, 0);
});
