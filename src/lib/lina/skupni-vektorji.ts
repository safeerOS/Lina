/**
 * Skupni testni vektorji TS <-> Kotlin za Lino (T2, 15. 11. 2026): EN datoteka `vektorji-lina-v1.json`, ki jo berejo
 * preizkus v Lini (skupni-vektorji.test.ts) in preizkus v Androidu (openline: SkupniVektorjiTest, kopija datoteke v
 * openline/android/skupni-vektorji/). Preizkus pade, ce se zapis na eni strani razlikuje od druge.
 *
 * Kaj vektorji drze: zdruzeni QR v1 (vsebinaQr <-> QrSeznanitev.razberi), seznanitev s kodo (SPAKE2, nacin A in B, telesa in
 * odgovori poti /koda/*), nizi podpisov in podpisi naloge (nizNaloge, nizOdobritve, nizUstavitve, nizSeznanitve, nizStanja,
 * zgostitevPrikaza), pravila imena in naslova ter telesa/odgovori koncne tocke asistentke.
 *
 * Datoteka je IZPELJANKA te kode (TS je avtor pogodbe): `node --experimental-strip-types src/lib/lina/skupni-vektorji.ts`
 * jo napise znova. Podpisi so edino nedolocljivi del (ECDSA): ob obstojecem kljucu se ohranijo, sicer se naredi nov
 * zacasen kljuc, zasebni del se takoj zavrze (v datoteko ne pride). Po spremembi kopiraj datoteko v Android in posodobi
 * SHA-256 v obeh preizkusih - brez tega eden od njiju pade.
 */
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vsebinaQr } from "./asistent-telefon.server.ts";
import { ID_LINE, KODA_VELJA_MS, SeznanitevSKodo, macKljuca } from "./koda-seznanitev.ts";
import { idIzKljuca, nizDogodkov, nizKlici, nizNaloge, nizOdobritve, nizSeznanitve, nizStanja, nizUstavitve, zgostitevPrikaza } from "./kanal-claude.ts";
import { N, Spake2, wIzKode } from "./spake2.ts";
import { VarovalkaKode } from "./varovalka-kode.ts";

export const POT_VEKTORJEV = path.join(path.dirname(fileURLToPath(import.meta.url)), "vektorji-lina-v1.json");

export const T0 = 1763130000000;
export const DO_QR = T0 + 600_000;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const FP_LINA = sha("lina-vektor-potrdilo-asistentke");
export const FP_OPENLINE = sha("lina-vektor-potrdilo-openline");
const KODA_QR = "AbCdEfGhIjKlMnOpQrStUv";
const KODA_QR_64 = "A1-_".repeat(16);
const URL_OPENLINE = "https://192.168.1.20:8787";
const KODA_OPENLINE = "K7QM4TZP";
const SKALAR = (ime: string) => ((BigInt("0x" + sha("lina-vektor-skalar-" + ime)) % (N - 1n)) + 1n).toString(16).padStart(64, "0");

export type Podpisnik = { kljuc: string; podpisi(ime: string, niz: string): string };
type Json = Record<string, unknown>;

/** Podpisnik, ki ohrani podpise obstojece datoteke (kljuc in podpisi po imenu). */
export function podpisnikIzDatoteke(v: Json): Podpisnik {
  const p = v.podpis as { kljuc: string; nizi: Array<{ ime: string; podpis: string }> };
  const po = new Map(p.nizi.map((n) => [n.ime, n.podpis] as const));
  for (const t of (v.koda as { toki: Array<{ podpis_ime?: string; potrdi_telo?: { podpis: string } }> }).toki) {
    if (t.podpis_ime && t.potrdi_telo) po.set(t.podpis_ime, t.potrdi_telo.podpis);
  }
  return { kljuc: p.kljuc, podpisi: (ime) => { const s = po.get(ime); if (!s) throw new Error(`manjka podpis ${ime}`); return s; } };
}

/** Nov zacasen kljuc: zasebni del obstaja samo v tem zaprtju in se zavrze (v datoteko pride samo javni del in podpisi). */
export function novPodpisnik(): Podpisnik {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    kljuc: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    podpisi: (_ime, niz) => sign("sha256", Buffer.from(niz, "utf8"), privateKey).toString("base64"),
  };
}

// ---------------------------------------------------------------------------------------------------------- QR v1
function qr(): Json {
  const klici = { url: URL_OPENLINE, koda: KODA_OPENLINE, odtis: FP_OPENLINE };
  const poz = (ime: string, asistent: { naslov: string; vrata: number; odtis: string; koda: string }, kl: typeof klici | null, doMs = DO_QR) => {
    const besedilo = vsebinaQr(asistent, kl, doMs);
    return {
      ime, vhod: { klici: kl, asistent, doMs }, besedilo, zdajMs: T0,
      pricakovano: {
        klici: kl ? { url: kl.url, code: kl.koda, fp: kl.odtis } : null,
        asistent: { naslov: asistent.naslov, vrata: asistent.vrata, odtis: asistent.odtis, koda: asistent.koda, doMs },
      },
    };
  };
  const a1 = { naslov: "192.168.1.20", vrata: 8446, odtis: FP_LINA, koda: KODA_QR };
  const p1 = poz("oba_razdelka_ipv4", a1, klici);
  const b = p1.besedilo;
  const enc = (u: string) => encodeURIComponent(u);
  const lina = enc("https://192.168.1.20:8446/api/asistent/v1");
  const zam = (od: string | RegExp, v: string) => { const r = b.replace(od, v); if (r === b) throw new Error("zamenjava ni nic spremenila: " + String(od)); return r; };
  const pozitivni = [
    p1,
    poz("samo_asistentka", a1, null),
    poz("ipv6_ula_oba", { naslov: "fd12:3456:789a::1", vrata: 8446, odtis: FP_LINA, koda: KODA_QR }, { url: "https://[fd12:3456:789a::1]:8787", koda: KODA_OPENLINE, odtis: FP_OPENLINE }),
    poz("koda_64_znakov_in_vrata_65535", { naslov: "10.0.0.5", vrata: 65535, odtis: FP_LINA, koda: KODA_QR_64 }, null),
    poz("zanka_172_16", { naslov: "172.16.0.1", vrata: 1, odtis: FP_LINA, koda: KODA_QR }, klici),
    { ime: "presledki_okoli_besedila", vhod: null, besedilo: `  ${b}\n`, zdajMs: T0, pricakovano: p1.pricakovano },
    {
      ime: "stari_qr_openline_brez_v", vhod: null,
      besedilo: `httpgateway://pair?url=${enc(URL_OPENLINE)}&code=${KODA_OPENLINE}&fp=${FP_OPENLINE}`, zdajMs: T0,
      pricakovano: { klici: { url: URL_OPENLINE, code: KODA_OPENLINE, fp: FP_OPENLINE }, asistent: null },
    },
  ];
  const zavrnjeni: Array<{ ime: string; besedilo: string; zdajMs: number }> = [
    { ime: "potekel_rok", besedilo: b, zdajMs: DO_QR },
    { ime: "potekel_rok_za_ms", besedilo: b, zdajMs: DO_QR + 1 },
    { ime: "javni_naslov_asistentke", besedilo: zam(lina, enc("https://8.8.8.8:8446/api/asistent/v1")), zdajMs: T0 },
    { ime: "ime_gostitelja_asistentke", besedilo: zam(lina, enc("https://lina.local:8446/api/asistent/v1")), zdajMs: T0 },
    { ime: "http_namesto_https", besedilo: zam(lina, enc("http://192.168.1.20:8446/api/asistent/v1")), zdajMs: T0 },
    { ime: "napacna_pot", besedilo: zam(lina, enc("https://192.168.1.20:8446/api/asistent/v2")), zdajMs: T0 },
    { ime: "uporabnik_v_naslovu", besedilo: zam(lina, enc("https://x@192.168.1.20:8446/api/asistent/v1")), zdajMs: T0 },
    { ime: "poizvedba_v_naslovu", besedilo: zam(lina, enc("https://192.168.1.20:8446/api/asistent/v1?x=1")), zdajMs: T0 },
    { ime: "javni_naslov_klicev", besedilo: zam(enc(URL_OPENLINE), enc("https://8.8.8.8:8787")), zdajMs: T0 },
    { ime: "neznan_parameter", besedilo: b + "&x=1", zdajMs: T0 },
    { ime: "podvojen_parameter", besedilo: b + "&linakoda=" + KODA_QR, zdajMs: T0 },
    { ime: "manjka_rok", besedilo: zam(/&do=\d+$/, ""), zdajMs: T0 },
    { ime: "rok_ni_stevilo", besedilo: zam(/&do=\d+$/, "&do=12ab"), zdajMs: T0 },
    { ime: "manjka_koda_asistentke", besedilo: zam(`&linakoda=${KODA_QR}`, ""), zdajMs: T0 },
    { ime: "razlicica_2", besedilo: zam("v=1", "v=2"), zdajMs: T0 },
    { ime: "koda_asistentke_21_znakov", besedilo: zam(KODA_QR, KODA_QR.slice(1)), zdajMs: T0 },
    { ime: "koda_asistentke_65_znakov", besedilo: zam(KODA_QR, KODA_QR_64 + "A"), zdajMs: T0 },
    { ime: "koda_asistentke_nedovoljen_znak", besedilo: zam(KODA_QR, "AbCdEfGhIjKlMnOpQrSt.v"), zdajMs: T0 },
    { ime: "odtis_asistentke_63_hex", besedilo: zam(`linafp=${FP_LINA}`, `linafp=${FP_LINA.slice(1)}`), zdajMs: T0 },
    { ime: "koda_klicev_7_znakov", besedilo: zam(`code=${KODA_OPENLINE}`, `code=${KODA_OPENLINE.slice(1)}`), zdajMs: T0 },
    { ime: "del_razdelka_klicev", besedilo: zam(`&code=${KODA_OPENLINE}`, ""), zdajMs: T0 },
    { ime: "druga_shema", besedilo: zam("httpgateway://", "https://"), zdajMs: T0 },
    { ime: "druga_pot_pair", besedilo: zam("httpgateway://pair?", "httpgateway://pairx?"), zdajMs: T0 },
    { ime: "brez_poizvedbe", besedilo: "httpgateway://pair", zdajMs: T0 },
    { ime: "prazno", besedilo: "", zdajMs: T0 },
    { ime: "predolgo_besedilo", besedilo: b + "&" + "a=".repeat(1100), zdajMs: T0 },
  ];
  return { pozitivni, zavrnjeni };
}

// ------------------------------------------------------------------------------------- naslovi in imena naprav
function naslovi(): Json[] {
  const primeri: Array<[string, boolean]> = [
    ["192.168.1.20", true], ["10.1.2.3", true], ["172.16.0.1", true], ["172.31.255.255", true], ["127.0.0.1", true],
    ["172.15.255.255", false], ["172.32.0.1", false], ["8.8.8.8", false], ["192.169.1.1", false], ["0.0.0.0", false], ["256.1.1.1", false],
    ["010.0.0.1", false], ["192.168.01.1", false], ["10.0.0", false],
    ["fd12:3456:789a::1", true], ["fc00::1", true], ["fdff::1", true], ["::1", true],
    ["fe80::1", false], ["2001:db8::1", false], ["::", false], ["fc::1", false], ["fd1::1", false], ["fb00::1", false], ["fe00::1", false],
  ];
  return primeri.map(([naslov, zasebni]) => ({ naslov, zasebni }));
}

function imena(): Json[] {
  const primeri: Array<[string, boolean]> = [
    ["Ana", true], ["Anžetov telefon 📱", true], ["a".repeat(60), true], ["😀".repeat(30), true],
    ["", false], ["a".repeat(61), false], ["😀".repeat(31), false],
    ["   ", false], ["  ", false], ["　", false], [" ", false], ["  Ana  ", true],
    ["Ana\nBor", false], ["Ana\u0000", false], ["Ana\u007f", false], ["Ana\u0085", false], ["Ana‍Bor", false], ["Ana‮Bor", false],
    ["a\ud800b", false],
  ];
  return primeri.map(([ime, veljavno]) => ({ ime, veljavno }));
}

// ---------------------------------------------------------------------------------------------------- podpisi
const ID_NALOGE = "vektorNaloga0123456789abc";
const ORODJE = { orodje: "Bash", predogled: '{"command":"git status"}', opis: "Pokaže stanje map: čšž 😀" };
const IME_TELEFONA = "Anžetov telefon 📱";

function podpisi(p: Podpisnik) {
  const id = idIzKljuca(p.kljuc);
  const zg = zgostitevPrikaza(ORODJE.orodje, ORODJE.predogled, ORODJE.opis);
  const nizi: Array<{ ime: string; vrsta: string; vhod: Json; niz: string; podpis: string }> = [];
  const dodaj = (ime: string, vrsta: string, vhod: Json, niz: string) => nizi.push({ ime, vrsta, vhod, niz, podpis: p.podpisi(ime, niz) });
  const nal = { id: ID_NALOGE, posiljatelj: id, besedilo: 'Pokliči Anžeta in mu povej:\n  »ob 15:00« 😀 {"a":1}\n\nHvala!', cas: T0, enkratni: "enkratniNaloga-0001" };
  dodaj("naloga", "naloga", nal, nizNaloge(nal.id, nal.posiljatelj, nal.besedilo, nal.cas, nal.enkratni));
  const od = { zahtevaId: "abcde", dovoli: true, posiljatelj: id, cas: T0 + 1000, enkratni: "enkratniOdobr-0002", chatId: ID_NALOGE, zgostitev: zg };
  dodaj("odobritev_dovoli", "odobritev", od, nizOdobritve(od.zahtevaId, od.dovoli, od.posiljatelj, od.cas, od.enkratni, od.chatId, od.zgostitev));
  const zv = { ...od, dovoli: false, cas: T0 + 1500, enkratni: "enkratniOdobr-0003" };
  dodaj("odobritev_zavrni", "odobritev", zv, nizOdobritve(zv.zahtevaId, zv.dovoli, zv.posiljatelj, zv.cas, zv.enkratni, zv.chatId, zv.zgostitev));
  const us = { id: ID_NALOGE, posiljatelj: id, cas: T0 + 2000, enkratni: "enkratniUstav-0004" };
  dodaj("ustavitev", "ustavitev", us, nizUstavitve(us.id, us.posiljatelj, us.cas, us.enkratni));
  const st = { posiljatelj: id, cas: T0 + 500, enkratni: "enkratniStanje-0005" };
  dodaj("stanje", "stanje", st, nizStanja(st.posiljatelj, st.cas, st.enkratni));
  const sq = { koda: KODA_QR, id, kljuc: p.kljuc, ime: IME_TELEFONA, cas: T0 + 100, enkratni: "enkratniSezn-0006" };
  dodaj("seznanitev_qr", "seznanitev", sq, nizSeznanitve(sq.koda, sq.id, sq.kljuc, sq.ime, sq.cas, sq.enkratni));
  // T1-N3 in T1-S1 (15. 11. 2026): niza, ki ju mora telefon dodati (Kotlin: NiziLine.nizDogodkov, NiziLine.nizKlici)
  const dg = { id: ID_NALOGE, posiljatelj: id, cas: T0 + 600, enkratni: "enkratniDogod-0007" };
  dodaj("dogodki", "dogodki", dg, nizDogodkov(dg.id, dg.posiljatelj, dg.cas, dg.enkratni));
  const kl = { koda: KODA_QR, posiljatelj: id, cas: T0 + 700, enkratni: "enkratniKlici-0008" };
  dodaj("klici", "klici", kl, nizKlici(kl.koda, kl.posiljatelj, kl.cas, kl.enkratni));
  return { id, zg, nizi };
}

/** Kar mora Kotlin zavrniti (vrne null, ker polje ni po pogodbi); TS to preveri s svojimi pravili (razlog). */
function zavrnjeniNizi(id: string, kljuc: string, zg: string): Json[] {
  const o = { zahtevaId: "abcde", dovoli: true, posiljatelj: id, cas: T0, enkratni: "enkratniOdobr-0002", chatId: ID_NALOGE, zgostitev: zg };
  const n = { id: ID_NALOGE, posiljatelj: id, besedilo: "Pozdrav", cas: T0, enkratni: "enkratniNaloga-0001" };
  const s = { koda: KODA_QR, id, kljuc, ime: IME_TELEFONA, cas: T0, enkratni: "enkratniSezn-0006" };
  return [
    { razlog: "enkratni_kratek", vrsta: "naloga", vhod: { ...n, enkratni: "kratek" } },
    { razlog: "enkratni_nedovoljen_znak", vrsta: "ustavitev", vhod: { id: ID_NALOGE, posiljatelj: id, cas: T0, enkratni: "enkratni z presledkom 12" } },
    { razlog: "posiljatelj_oblika", vrsta: "stanje", vhod: { posiljatelj: "n-xyz", cas: T0, enkratni: "enkratniStanje-0005" } },
    { razlog: "osamljen_nadomestni", vrsta: "naloga", vhod: { ...n, besedilo: "a\ud800b" } },
    { razlog: "zahtevaId_oblika", vrsta: "odobritev", vhod: { ...o, zahtevaId: "abcdl" } },
    { razlog: "zgostitev_oblika", vrsta: "odobritev", vhod: { ...o, zgostitev: zg.toUpperCase() } },
    { razlog: "koda_kratka", vrsta: "seznanitev", vhod: { ...s, koda: KODA_QR.slice(1) } },
    { razlog: "id_ne_iz_kljuca", vrsta: "seznanitev", vhod: { ...s, id: "n-0000000000000000" } },
    { razlog: "ime_prazno", vrsta: "seznanitev", vhod: { ...s, ime: "   " } },
    { razlog: "koda_kratka", vrsta: "klici", vhod: { koda: KODA_QR.slice(1), posiljatelj: id, cas: T0, enkratni: "enkratniKlici-0008" } },
    { razlog: "posiljatelj_oblika", vrsta: "dogodki", vhod: { id: ID_NALOGE, posiljatelj: "n-xyz", cas: T0, enkratni: "enkratniDogod-0007" } },
  ];
}

// ------------------------------------------------------------------------------------ seznanitev s kodo (SPAKE2)
type VhodToka = { ime: string; nacin: "A" | "B"; kodaLina: string; kodaVnos: string; kodaTelefon: string; pairId: string; cas: number; enkratni: string };

function tok(p: Podpisnik, v: VhodToka, uspeh: boolean): Json {
  const id = idIzKljuca(p.kljuc);
  const x = SKALAR(v.ime + "-lina"), y = SKALAR(v.ime + "-telefon");
  const ura = { t: T0 };
  const varovalka = new VarovalkaKode({ ura: () => ura.t / 1000 });
  const k = new SeznanitevSKodo({
    varovalka, odtis: () => FP_LINA, zdaj: () => ura.t, koda: () => v.kodaLina,
    nakljucno: { pairId: () => v.pairId, skalar: () => BigInt("0x" + x) },
  });
  k.odpri();
  const z = k.zacni("192.168.1.5", id, IME_TELEFONA, v.nacin === "B");
  if (v.nacin === "B") k.vnesiKodo(v.pairId, v.kodaVnos);
  const tel = Spake2.odjemalec(v.kodaTelefon, id, ID_LINE, Buffer.from(FP_LINA, "utf8"), Buffer.from(v.pairId, "utf8"), BigInt("0x" + y));
  const pb = tel.sporocilo().toString("hex");
  const { pa, ca } = k.spake(v.pairId, id, Buffer.from(pb, "hex"));
  const { ke, potrditev } = tel.zakljuci(pa);
  const caVelja = tel.preveri(ca);
  const mac = macKljuca(ke, v.pairId, id, p.kljuc);
  if (caVelja !== uspeh) throw new Error(`vektor ${v.ime}: caVelja=${caVelja}`);
  const izhod: Json = {
    ime: v.ime, nacin: v.nacin, koda_lina: v.kodaLina, koda_vnos_lastnika: v.kodaVnos, koda_telefon: v.kodaTelefon,
    pair_id: v.pairId, id, ime_telefona: IME_TELEFONA, odtis: FP_LINA, x_lina: x, y_telefon: y,
    w_telefon: wIzKode(v.kodaTelefon, Buffer.from(v.pairId, "utf8")).toString(16).padStart(64, "0"),
    zacni_telo: { id, ime: IME_TELEFONA, ...(v.nacin === "B" ? { kodaNaTelefonu: true } : {}) },
    zacni_odgovor: z,
    spake_telo: { pair_id: v.pairId, id, pb },
    spake_odgovor: { pa: pa.toString("hex"), ca: ca.toString("hex") },
    ca_velja: caVelja,
    odpovej_telo: { pair_id: v.pairId, id },
    odpovej_odgovor: { stanje: "odpovedano" },
  };
  if (uspeh) {
    const niz = nizSeznanitve(v.pairId, id, p.kljuc, IME_TELEFONA, v.cas, v.enkratni);
    const imeP = `seznanitev_koda_${v.nacin}`;
    const podpis = p.podpisi(imeP, niz);
    k.potrdi(v.pairId, id, p.kljuc, potrditev, mac);
    Object.assign(izhod, {
      ke: ke.toString("hex"), cb: potrditev.toString("hex"), mac: mac.toString("hex"),
      podpis_ime: imeP, niz_podpisa: niz,
      potrdi_telo: { pair_id: v.pairId, id, kljuc: p.kljuc, ime: IME_TELEFONA, cas: v.cas, enkratni: v.enkratni, podpis, cb: potrditev.toString("hex"), mac: mac.toString("hex") },
      // T1-S1: koda OpenLine v odgovoru NI vec (pride sele s podpisanim POST /seznani/klici po lastnikovem »Dodaj«)
      potrdi_odgovor: { stanje: "caka" },
    });
  }
  return izhod;
}

function koda(p: Podpisnik): Json {
  return {
    ime_lina: ID_LINE, velja_s: KODA_VELJA_MS / 1000, odtis: FP_LINA,
    w: [
      { koda: "482913", sol_utf8: "pair-lina-01", w: wIzKode("482913", Buffer.from("pair-lina-01")).toString(16).padStart(64, "0") },
      { koda: " 482913 ", sol_utf8: "pair-lina-01", w: wIzKode(" 482913 ", Buffer.from("pair-lina-01")).toString(16).padStart(64, "0") },
      { koda: "731905", sol_utf8: "", w: wIzKode("731905", Buffer.alloc(0)).toString(16).padStart(64, "0") },
    ],
    toki: [
      tok(p, { ime: "A", nacin: "A", kodaLina: "482913", kodaVnos: "", kodaTelefon: "482913", pairId: "pairVektorA-0123456789", cas: T0 + 200, enkratni: "enkratniKodaA-0007" }, true),
      tok(p, { ime: "B", nacin: "B", kodaLina: "482913", kodaVnos: "731 905", kodaTelefon: "731905", pairId: "pairVektorB-0123456789", cas: T0 + 300, enkratni: "enkratniKodaB-0008" }, true),
      tok(p, { ime: "C_napacna_koda", nacin: "A", kodaLina: "482913", kodaVnos: "", kodaTelefon: "482914", pairId: "pairVektorC-0123456789", cas: T0 + 400, enkratni: "enkratniKodaC-0009" }, false),
    ],
    // napaka (status, "napaka") -> NapakaKode v Androidu (enum po imenu)
    napake: [
      { status: 403, napaka: "ni_odprto", kotlin: "NI_ODPRTO" },
      { status: 429, napaka: "prevec_cakajocih", kotlin: "PREVEC" },
      { status: 429, napaka: "prevec_poskusov", kotlin: "PREVEC" },
      { status: 429, napaka: "seznanitev_zaprta", kotlin: "ZAPRTO" },
      { status: 409, napaka: "id_zaseden", kotlin: "ID_ZASEDEN" },
      { status: 404, napaka: "prijava_ne_obstaja", kotlin: "NI_PRIJAVE" },
      { status: 409, napaka: "manjka_korak", kotlin: "MANJKA_KORAK" },
      { status: 409, napaka: "caka_kodo", kotlin: "CAKA_KODO" },
      { status: 401, napaka: "napacna_koda", kotlin: "NAPACNA_KODA" },
      { status: 403, napaka: "zavrnjeno", kotlin: "ZAVRNJENO" },
      { status: 400, napaka: "neveljavna_tocka", kotlin: "NAPAKA" },
      { status: 400, napaka: "oblika", kotlin: "NAPAKA" },
    ],
  };
}

// ---------------------------------------------------------------------------------------- koncna tocka asistentke
function asistent(pod: ReturnType<typeof podpisi>): Json {
  const n = (ime: string) => pod.nizi.find((x) => x.ime === ime)!;
  const naloga = n("naloga").vhod as Json, odob = n("odobritev_dovoli").vhod as Json, ust = n("ustavitev").vhod as Json;
  const sezn = n("seznanitev_qr").vhod as Json, stanje = n("stanje").vhod as Json;
  return {
    id_naloge: ID_NALOGE,
    orodje: ORODJE,
    naloga_telo: { ...naloga, podpis: n("naloga").podpis },
    odobritev_telo: { nalogaId: ID_NALOGE, zahtevaId: odob.zahtevaId, dovoli: true, posiljatelj: odob.posiljatelj, cas: odob.cas, enkratni: odob.enkratni, podpis: n("odobritev_dovoli").podpis },
    ustavitev_telo: { ...ust, podpis: n("ustavitev").podpis },
    seznanitev_telo: { koda: sezn.koda, id: sezn.id, kljuc: sezn.kljuc, ime: sezn.ime, cas: sezn.cas, enkratni: sezn.enkratni, podpis: n("seznanitev_qr").podpis },
    stanje_poizvedba: { ...stanje, podpis: n("stanje").podpis },
    // T1-N3: GET /dogodki?id=&posiljatelj=&cas=&enkratni=&podpis=&od=&caka= (podpis nizDogodkov)
    dogodki_poizvedba: { ...(n("dogodki").vhod as Json), podpis: n("dogodki").podpis },
    // T1-S1: POST /seznani/klici po lastnikovem »Dodaj« (podpis nizKlici); odgovor 200 {"klici":{url,code,fp}|null}
    klici_telo: { koda: (n("klici").vhod as Json).koda, id: (n("klici").vhod as Json).posiljatelj, cas: (n("klici").vhod as Json).cas, enkratni: (n("klici").vhod as Json).enkratni, podpis: n("klici").podpis },
    klici_odgovori: [
      { status: 200, telo: { klici: { url: URL_OPENLINE, code: KODA_OPENLINE, fp: FP_OPENLINE } }, pricakovano: { url: URL_OPENLINE, code: KODA_OPENLINE, fp: FP_OPENLINE } },
      { status: 200, telo: { klici: null }, pricakovano: null },
    ],
    // dogodki, kot jih vrne GET /dogodki, ko izvajalec odda ta zaporedja (st narasca od 1)
    dogodki_vhod: [
      { vrsta: "stanje", besedilo: "Berem datoteke: čšž 😀" },
      { vrsta: "odobritev", zahtevaId: "abcde", orodje: ORODJE.orodje, predogled: ORODJE.predogled, opis: ORODJE.opis },
      { vrsta: "izid", ok: true, besedilo: "Končano." },
    ],
    dogodki_odgovor: {
      dogodki: [
        { st: 1, vrsta: "stanje", besedilo: "Berem datoteke: čšž 😀" },
        { st: 2, vrsta: "odobritev", zahtevaId: "abcde", orodje: ORODJE.orodje, predogled: ORODJE.predogled, opis: ORODJE.opis },
        { st: 3, vrsta: "izid", ok: true, besedilo: "Končano." },
      ],
      koncano: true,
    },
    // Android mora iz teh odgovorov razbrati: tip, st in polja (zgostitev, ki jo poslje Lina, telefon ne uporabi)
    dogodki_pricakovano: [
      { vrsta: "stanje", st: 1, besedilo: "Berem datoteke: čšž 😀" },
      { vrsta: "odobritev", st: 2, zahtevaId: "abcde", orodje: ORODJE.orodje, predogled: ORODJE.predogled, opis: ORODJE.opis },
      { vrsta: "izid", st: 3, ok: true, besedilo: "Končano." },
    ],
    seznanitev_stanja: [
      { telo: { stanje: "caka" }, pricakovano: "CAKA" },
      { telo: { stanje: "sprejeto" }, pricakovano: "SPREJETO" },
      { telo: { stanje: "zavrnjeno" }, pricakovano: "ZAVRNJENO" },
      { telo: { stanje: "odprta" }, pricakovano: null },
      { telo: { stanje: 1 }, pricakovano: null },
    ],
    seja: [
      { status: 200, telo: { claudeCode: "odprta" }, pricakovano: true },
      { status: 200, telo: { claudeCode: "zaprta" }, pricakovano: false },
      { status: 503, telo: { napaka: "claude-code-ni", sporocilo: "Seja Claude Code ni odprta.", stanje: { claudeCode: "zaprta" } }, pricakovano: false },
      { status: 200, telo: { claudeCode: "nekaj" }, pricakovano: null },
    ],
  };
}

/** Celotna vsebina datoteke; podpisnik doloci kljuc in podpise (glej podpisnikIzDatoteke, novPodpisnik). */
export function ustvariVektorje(p: Podpisnik): Json {
  const pod = podpisi(p);
  return {
    verzija: 1,
    opis: "Skupni vektorji TS <-> Kotlin za Lino (T2, 15. 11. 2026). Izpeljanka skupni-vektorji.ts; ne urejaj z roko.",
    cas_t0: T0,
    qr_v1: qr(),
    naslovi: naslovi(),
    imena: imena(),
    zgostitve: [
      { ...ORODJE, sha256: pod.zg },
      { orodje: "Edit", predogled: "a\nb\r\nc", opis: "", sha256: zgostitevPrikaza("Edit", "a\nb\r\nc", "") },
      { orodje: "Write", predogled: "čšž ☃ 😀", opis: "Ustvari datoteko »x«", sha256: zgostitevPrikaza("Write", "čšž ☃ 😀", "Ustvari datoteko »x«") },
      // BBB1: meje med poljema ne smejo biti dvoumne (v2 je za prva dva dala isto zgostitev); dolzina steje bajte UTF-8
      { orodje: "Bash", predogled: "a\nb", opis: "c", sha256: zgostitevPrikaza("Bash", "a\nb", "c") },
      { orodje: "Bash", predogled: "a", opis: "b\nc", sha256: zgostitevPrikaza("Bash", "a", "b\nc") },
      { orodje: "é", predogled: "", opis: "x", sha256: zgostitevPrikaza("é", "", "x") },
      { orodje: "", predogled: "é", opis: "x", sha256: zgostitevPrikaza("", "é", "x") },
      { orodje: "A", predogled: "1:b", opis: "c", sha256: zgostitevPrikaza("A", "1:b", "c") },
      { orodje: "A1:b", predogled: "", opis: "c", sha256: zgostitevPrikaza("A1:b", "", "c") },
    ],
    podpis: { kljuc: p.kljuc, id: pod.id, nizi: pod.nizi, zavrnjeni: zavrnjeniNizi(pod.id, p.kljuc, pod.zg) },
    koda: koda(p),
    asistent: asistent(pod),
  };
}

// zagon z ukazne vrstice: napise datoteko (obstojec kljuc ohrani, `--nov-kljuc` naredi novega)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const nov = process.argv.includes("--nov-kljuc") || !existsSync(POT_VEKTORJEV);
  const p = nov ? novPodpisnik() : podpisnikIzDatoteke(JSON.parse(readFileSync(POT_VEKTORJEV, "utf8")));
  const v = ustvariVektorje(p);
  writeFileSync(POT_VEKTORJEV, JSON.stringify(v, null, 1) + "\n", "utf8");
  console.log(`napisano ${POT_VEKTORJEV} sha256=${createHash("sha256").update(readFileSync(POT_VEKTORJEV)).digest("hex")}`);
}
