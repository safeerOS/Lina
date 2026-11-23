// N5b/N5c/N5d (odlocitev lastnika, 15. 11. 2026): clanstvo telefona v krogu Safeer Linka ISTEGA uporabnika na tem racunalniku.
// Vir clanstva je SAMO krog Safeer Linka (core/link_krog.py: krog.json v ~/.config/safeer-browser, zapis v1:
// clani{id:{kljuc,dodano,dodal,podpis,...}}, umiki{id:{umaknjeno}}), ki ga omrezni napadalec ne more zapisati (datoteka
// uporabnika). NIKOLI ne iz dohodnega sporocila: clan je naprava, katere javni kljuc (ki ga je telefon dokazal s podpisom ali
// MAC-om SPAKE2) je BAJT ZA BAJTOM enak kljucu clana v krogu in clan ni umaknjen.
// Fail-closed: vsaka napaka, nezanesljiva datoteka ali dvom = false.
// Lina datoteke NE pise in je ne kopira; bere jo ob vsakem preverjanju (umik takoj velja, brez predpomnilnika).
// Ena koda za Linux in Windows (pot je ista kot v Pythonu: expanduser ~/.config/safeer-browser); platformna veja je SAMO v
// [preveriMapoKroga] in [preveriDatotekoKroga] (win32: NEPREVERJENO -> vedno false, glej tam).
//
// N5d: clanstvo SAMO se bere; preskok primerjave id-ja za clane je IZKLOPLJEN ([PRESKOK_PRIMERJAVE_ZA_CLANE]), ker telefon
// (Android OpenLine) NE zna sam preveriti, da je Lina v njegovem krogu (nacrt: ogled/lina-android-1511/NACRT-TELEFON-CLANSTVO.md).
// Telefon za vsako Lino zahteva dotik »ID se ujema«, zato mora id videti in primerjati tudi uporabnik na racunalniku.
import { createHash, timingSafeEqual, verify, createPublicKey } from "node:crypto";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { idIzKljuca, ID_TELEFONA, veljavenKljucNaprave } from "./kanal-claude.ts";

/**
 * N5d: ali sme Lina clanu kroga prihraniti primerjavo id-ja (»ID se ujema«). IZKLOPLJENO, dokler telefon ne zna SAM preveriti
 * clanstva Line (glej NACRT-TELEFON-CLANSTVO.md): telefon sicer vedno zahteva dotik in uporabnik bi moral potrditi na slepo.
 * Vklop je samo sprememba te konstante PO tem, ko je preverba na telefonu izvedena in preizkusena.
 */
export const PRESKOK_PRIMERJAVE_ZA_CLANE = false;

/** Najvec bajtov datoteke kroga (krog z desetinami naprav je pod 50 KB); vecja ni zaupanja vredna. */
export const NAJVEC_KROG_BAJTOV = 262_144;
/** Samo za preizkuse: izrecna pot do datoteke kroga (brez okoljske spremenljivke - procesa z nitmi ne spreminjamo). */
let potPreizkus: string | null = null;
export function nastaviPotKroga(pot: string | null): void { potPreizkus = pot; }
/** Pot do kroga Safeer Linka (core/link_krog.py: NASTAVITVE_MAPA/krog.json; Python na Windows uporablja isto expanduser pot). */
export function potKroga(): string {
  return potPreizkus ?? path.join(os.homedir(), ".config", "safeer-browser", "krog.json");
}

/** Platforma in uporabnik procesa; v preizkusih ju je mogoce nadomestiti (simulacija Windows ali drugega uporabnika). */
export type OkoljeKroga = {
  platforma: string;
  uid: number | undefined;
  /** SAMO za preizkuse: mape seje (kot XDG_RUNTIME_DIR), kjer iscemo rezervne nagrobnike umikov; privzeto XDG_RUNTIME_DIR in /run/user/<uid>. */
  mapeSeje?: string[];
  /** SAMO za preizkuse: klic med lstat in open (simulacija zamenjave datoteke, TOCTOU); v produkciji ga ni. */
  poLstat?: () => Promise<void>;
};
export function okoljeProcesa(): OkoljeKroga {
  return {
    platforma: process.platform,
    uid: typeof process.getuid === "function" ? process.getuid() : undefined,
  };
}

function enak(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8"), y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Platformna veja 1/2: MAPA kroga. Lastnik == uid procesa; brez pisanja SKUPINE in DRUGIH (0o022), kot datoteka.
 * N5e (slepi pregled N5d, S4): N5d je pisanje skupine dovolil, ce je skupina mape skupina procesa. To je bilo ZMANJSANJE pravila brez
 * koristi: Python ob vsakem zapisu mapo spet zoži na 0700 (_zagotovi_mapo: nacin & ~0o077), zato legitimna mapa kroga nima
 * pisanja skupine, Node pa ne ve, kdo je v skupini (skupna primarna skupina, imenski vpisi POSIX ACL: bit skupine je tam maska).
 * Mapa z g+w se zato zavrne (fail-closed, Lina je lahko le strozja od Pythona, ki mape ne preverja po nacinu).
 * win32: NEPREVERJENO (Node tam ne pozna getuid, mode ni prava maska, ACL profila ni izmerjen: testni Windows ni bil dosegljiv
 * 15. 11. 2026) -> fail-closed: false, dokler pravila ni nekdo izmeril na pravem Windows.
 */
export function preveriMapoKroga(st: Pick<Stats, "uid" | "mode">, okolje: OkoljeKroga): boolean {
  if (okolje.platforma === "win32") return false;
  if (okolje.uid === undefined || st.uid !== okolje.uid) return false;
  return (st.mode & 0o022) === 0;
}

/** Platformna veja 2/2: DATOTEKA kroga. Lastnik == uid procesa; brez pisanja skupine in drugih (Python jo zapise z 0600). win32: false (glej zgoraj). */
export function preveriDatotekoKroga(st: Pick<Stats, "uid" | "mode">, okolje: OkoljeKroga): boolean {
  if (okolje.platforma === "win32") return false;
  if (okolje.uid === undefined || st.uid !== okolje.uid) return false;
  return (st.mode & 0o022) === 0;
}

/** Najvec [meja] bajtov z ze odprtega deskriptorja; vrne null, ce je vec (datoteka lahko po preverbi zraste). */
export async function preberiOmejeno(f: { read(buf: Buffer, off: number, len: number, pos: null): Promise<{ bytesRead: number }> }, meja: number): Promise<string | null> {
  const buf = Buffer.allocUnsafe(meja + 1);
  let n = 0;
  while (n <= meja) {
    const { bytesRead } = await f.read(buf, n, meja + 1 - n, null);
    if (bytesRead === 0) break;
    n += bytesRead;
  }
  return n > meja ? null : buf.subarray(0, n).toString("utf8");
}

type VnosKroga = { kljuc?: unknown; dodano?: unknown; dodal?: unknown; platforma?: unknown; podpis?: unknown };
type ZapisKroga = { v?: unknown; clani?: Record<string, VnosKroga>; umiki?: unknown };

/**
 * Pravilo umika (isto kot Pythonov _veljaven: umaknjen, ce umaknjeno > dodano; ENAK cas = ni umaknjen). Razlike so samo STROZJE
 * (Lina nikoli ni bolj popustljiva od Pythona; vektorji iz Pythona so v vektorji-krog-python.json):
 *  - [umiki] mora biti objekt (ali manjkati/null): niz, stevilo, true, polje = pokvarjen krog (Python tak krog sploh ne nalozi);
 *  - umik tega clana, ki ni objekt s stevilsko umaknjeno, = dvom = umaknjen;
 *  - umik STAREJSI od vpisa (vrnitev po umiku): Python ga sprejme samo s podpisom veljavnega clana, ki ni naprava sama; Lina
 *    take vrnitve ne sprejme nikoli (tudi s podpisom), legitimen krog.json takega zapisa nima (Python po vrnitvi umik izbrise).
 */
function umikDovoljuje(krog: ZapisKroga, id: string, dodano: unknown): boolean {
  const umiki = krog.umiki;
  if (umiki === undefined || umiki === null) return true;
  if (typeof umiki !== "object" || Array.isArray(umiki)) return false;
  if (!Object.hasOwn(umiki, id)) return true;
  const u = (umiki as Record<string, unknown>)[id];
  if (u === null || typeof u !== "object" || Array.isArray(u)) return false;
  const umaknjeno = (u as { umaknjeno?: unknown }).umaknjeno;
  if (typeof umaknjeno !== "number" || !Number.isFinite(umaknjeno) || typeof dodano !== "number" || !Number.isFinite(dodano)) return false;
  return umaknjeno === dodano;
}

/** Strog base64 kot Pythonov b64decode(validate=True): kanonicen zapis (poln zapis s pravilno oznako), brez presledkov; Lina je lahko le strozja. */
function strogB64(s: unknown): Buffer | null {
  if (typeof s !== "string" || s.length === 0 || s.length > 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  const b = Buffer.from(s, "base64");
  return b.toString("base64") === s ? b : null;
}

/** Python id_iz_kljuca (link_krog.py): n- + prvih 16 hex SHA-256 dekodiranega kljuca; id z drugimi znaki (pripona) ni id iz kljuca. */
const ID_IZ_KLJUCA = /^n-[0-9a-f]{16}(-[A-Za-z0-9._-]*)?$/;

/** Python podatki_clana: kar podpise naprava, ki doda drugo napravo (%.3f; izvedba z toFixed(3) se na tockah ravno na sredi razlikuje, zato tam false). */
function podatkiClana(id: string, kljuc: string, platforma: string, dodano: number, dodal: string): string | null {
  if (!Number.isFinite(dodano) || Math.abs(dodano) >= 1e21) return null;
  // toFixed (pol navzgor) in Python %.3f (pol na sodo) se razlikujeta samo, ce je vrednost TOCNO na sredi tretje decimalke;
  // takega casa ne zapise noben program (time.time()), Lina ga zavrne (strozje).
  const tocno = dodano.toFixed(60);
  if (/^-?\d+\.\d{3}50*$/.test(tocno)) return null;
  return `safeer-krog-clan-v1\n${id}\n${kljuc}\n${platforma}\n${dodano.toFixed(3)}\n${dodal}`;
}

/**
 * Pravilo podpisa vnosa (Pythonov Krog.zdruzi ob nalaganju: »podpis je, podpisnika poznamo, a ga ni dal on: vnos je ponarejen ali
 * pokvarjen« -> vnos zavrzen). Lina je lahko samo ENAKA ali STROZJA:
 *  - brez podpisa (manjka, null, ""): Python ne preverja (nepodpisan vnos od huba je mogoc) -> sprejmemo tudi mi;
 *  - podpis, ki ni niz, ali polja vnosa napacnega tipa = pokvarjen vnos = false (Python bi jih pretvoril z str()/float());
 *  - podpisnik (`dodal`): Python ga najde samo med ZE nalozenimi, VELJAVNIMI clani (vrstni red zapisa, umiki). Lina isce med VSEMI
 *    vnosi, ne glede na vrstni red in umike, in preveri podpis proti VSEM kandidatom (vnos z natancnim id-jem IN vsi vnosi z
 *    istim jedrom id-ja iz kljuca): Pythonov izbrani kandidat je vedno med njimi, zato Lina podpis, ki ga Python zavrne,
 *    nikoli ne sprejme;
 *  - nobenega kandidata = Python tudi ne najde podpisnika -> sprejmemo (enako);
 *  - podpis se preveri s SHA256withECDSA (DER) nad podatkiClana (link_krog.podatki_clana), kljuc P-256 SPKI (strozje od Pythona).
 */
function podpisVnosaVelja(krog: ZapisKroga, id: string, v: VnosKroga): boolean {
  const p = v.podpis;
  if (p === undefined || p === null || p === "") return true;
  const podpis = strogB64(p);
  if (podpis === null || typeof v.kljuc !== "string") return false;
  if (v.dodal !== undefined && v.dodal !== null && typeof v.dodal !== "string") return false;
  if (v.platforma !== undefined && v.platforma !== null && typeof v.platforma !== "string") return false;
  if (v.dodano !== undefined && v.dodano !== null && typeof v.dodano !== "number") return false;
  const dodal = (v.dodal as string | undefined | null) ?? "";
  const podatki = podatkiClana(id, v.kljuc, (v.platforma as string | undefined | null) ?? "", (v.dodano as number | undefined | null) ?? 0, dodal);
  if (podatki === null) return false;
  const clani = krog.clani as Record<string, VnosKroga>;
  const kandidati: unknown[] = [];
  if (Object.hasOwn(clani, dodal)) kandidati.push(clani[dodal]?.kljuc);
  if (ID_IZ_KLJUCA.test(dodal) && dodal.length <= 128) {
    const jedro = dodal.slice(0, 18);
    for (const d of Object.values(clani)) {
      // N5e (S2): kandidata z nekanonicnim kljucem NE preskocimo (Python ga najde, saj id_iz_kljuca in _veljaven_kljuc
      // nista tako stroga kot strogB64, in preveri podpis): ostane kandidat in spodaj da false (Lina ga ne more preveriti).
      if (d === null || typeof d !== "object" || typeof d.kljuc !== "string") continue;
      if (idIzKljuca(d.kljuc) === jedro) kandidati.push(d.kljuc);
    }
  }
  for (const k of kandidati) {
    if (!veljavenKljucNaprave(k) || strogB64(k) === null) return false;
    try {
      if (!verify("sha256", Buffer.from(podatki, "utf8"), createPublicKey({ key: Buffer.from(k, "base64"), format: "der", type: "spki" }), podpis)) return false;
    } catch { return false; }
  }
  return true;
}

/**
 * N5e (slepi pregled N5d, S1): nagrobniki umikov. Ce Python krog.json ne more zapisati (poln disk, mapa samo za branje), umik
 * trajno zapise na REZERVNI mesti (core/link_krog.py _poti_nagrobnikov): ob krog.json (`<krog.json>-umiki.json`) in v mapo seje
 * (`$XDG_RUNTIME_DIR/safeer-krog-umiki-<sha256(abspath)[:16]>.json`, mapa mora biti uporabnikova in 0700). Python po ponovnem
 * zagonu umik uveljavi, Lina je brala samo krog.json in je preklicano napravo se stela za clana. Lina zdaj bere ISTA mesta;
 * umik za ta id iz kakrsnegakoli vira velja kot umik (pravilo [umikDovoljuje] je isto kot za krog.json).
 * Lina je lahko le strozja: preveri VSAKO uporabno mapo seje (Python samo prvo), nagrobnik, ki obstaja, a ni zanesljiv (povezava,
 * ni navadna datoteka, tuj lastnik, pisanje skupine/drugih, prevelik, pokvarjen, `umiki` ni objekt), je dvom = false (Python ga
 * preskoci z opozorilom); manjkajoc nagrobnik je v redu. Ostanek nagrobnika s starejsim umikom od vpisa (Python ga zbrise ob
 * naslednjem zapisu in ga steje za neskodljivega) Lina steje za dvom, dokler ne izgine.
 */
async function mapeNagrobnikov(okolje: OkoljeKroga): Promise<string[]> {
  const kandidati = okolje.mapeSeje ?? [process.env.XDG_RUNTIME_DIR ?? "", `/run/user/${okolje.uid}`];
  const dobre: string[] = [];
  for (const m of kandidati) {
    if (typeof m !== "string" || !path.isAbsolute(m) || dobre.includes(m)) continue;
    try {
      const st = await lstat(m);
      if (st.isDirectory() && st.uid === okolje.uid && (st.mode & 0o077) === 0) dobre.push(m);
    } catch { /* mape ni: kandidat odpade (kot Python) */ }
  }
  return dobre;
}

/** Poti nagrobnikov za krog na [pot] (kot Python _poti_nagrobnikov). */
export async function potiNagrobnikov(pot: string, okolje: OkoljeKroga): Promise<string[]> {
  const poti = [pot + "-umiki.json"];
  const oznaka = createHash("sha256").update(path.resolve(pot), "utf8").digest("hex").slice(0, 16);
  for (const m of await mapeNagrobnikov(okolje)) poti.push(path.join(m, `safeer-krog-umiki-${oznaka}.json`));
  return poti;
}

type BranjeNagrobnika = { stanje: "ni" } | { stanje: "slab" } | { stanje: "ok"; umiki: Record<string, unknown> };
async function preberiNagrobnik(p: string, okolje: OkoljeKroga): Promise<BranjeNagrobnika> {
  const ni = (e: unknown) => { const k = (e as NodeJS.ErrnoException)?.code; return k === "ENOENT" || k === "ENOTDIR"; };
  try {
    const l = await lstat(p);
    if (l.isSymbolicLink() || !l.isFile()) return { stanje: "slab" };
    const f = await open(p, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    let besedilo: string | null;
    try {
      const st = await f.stat();
      if (!st.isFile() || st.size > NAJVEC_KROG_BAJTOV || !preveriDatotekoKroga(st, okolje)) return { stanje: "slab" };
      besedilo = await preberiOmejeno(f, NAJVEC_KROG_BAJTOV);
    } finally { await f.close(); }
    if (besedilo === null) return { stanje: "slab" };
    const t = JSON.parse(besedilo) as { umiki?: unknown } | null;
    if (t === null || typeof t !== "object" || t.umiki === null || typeof t.umiki !== "object" || Array.isArray(t.umiki)) return { stanje: "slab" };
    return { stanje: "ok", umiki: t.umiki as Record<string, unknown> };
  } catch (e) {
    return ni(e) ? { stanje: "ni" } : { stanje: "slab" };
  }
}

/** Ali nagrobniki (ce obstajajo) dovoljujejo clana [id] z vpisom [dodano]; nezanesljiv nagrobnik = false. */
async function nagrobnikiDovoljujejo(pot: string, id: string, dodano: unknown, okolje: OkoljeKroga): Promise<boolean> {
  for (const p of await potiNagrobnikov(pot, okolje)) {
    const n = await preberiNagrobnik(p, okolje);
    if (n.stanje === "slab") return false;
    if (n.stanje === "ok" && !umikDovoljuje({ umiki: n.umiki }, id, dodano)) return false;
  }
  return true;
}

/**
 * Ali je naprava z javnim kljucem [kljuc] (base64 SPKI) in id-jem [id] clan kroga Safeer Linka na tem racunalniku.
 * Pogoji (vsi): mapa kroga je navadna mapa tega uporabnika po [preveriMapoKroga]; datoteka se odpre z O_NOFOLLOW|O_NONBLOCK
 * in se preveri NA ODPRTEM deskriptorju (navadna datoteka, lastnik, brez pisanja skupine/drugih, <= 256 KB; FIFO, naprava in
 * simbolna povezava zavrnjeni), branje je omejeno na NAJVEC_KROG_BAJTOV (tudi ce datoteka raste); v1 s clani; id = n-<16 hex>
 * IZPELJAN iz kljuca; clani[id].kljuc == kljuc; podpis vnosa glej [podpisVnosaVelja]; umik glej [umikDovoljuje]; rezervni
 * nagrobniki umikov (N5e, S1) glej [nagrobnikiDovoljujejo].
 */
export async function jeClanKroga(kljuc: unknown, id: unknown, pot: string = potKroga(), okolje: OkoljeKroga = okoljeProcesa()): Promise<boolean> {
  try {
    // kljuc mora biti tudi KANONICEN base64 (Pythonov _veljaven_kljuc: b64decode(validate=True) zavrne npr. kljuc brez oznake =; Node ga lahko
    // sprejme), sicer bi Lina sprejela vnos, ki ga Python ob nalaganju zavrze
    if (!veljavenKljucNaprave(kljuc) || strogB64(kljuc) === null || typeof id !== "string" || !ID_TELEFONA.test(id) || idIzKljuca(kljuc) !== id) return false;
    // mapa (kot preveriKoren za mapo Line): navadna mapa, ne simbolna povezava, tega uporabnika, brez pisanja drugih
    const mapa = await lstat(path.dirname(pot));
    if (mapa.isSymbolicLink() || !mapa.isDirectory() || !preveriMapoKroga(mapa, okolje)) return false;
    // datoteka: lstat zavrne povezavo se pred odpiranjem (na Windows O_NOFOLLOW ne obstaja); NATANCNA preverba je na fd spodaj
    const l = await lstat(pot);
    if (l.isSymbolicLink() || !l.isFile()) return false;
    await okolje.poLstat?.();
    const f = await open(pot, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    let besedilo: string | null;
    try {
      const st = await f.stat();
      if (!st.isFile() || st.size > NAJVEC_KROG_BAJTOV || !preveriDatotekoKroga(st, okolje)) return false;
      besedilo = await preberiOmejeno(f, NAJVEC_KROG_BAJTOV);
    } finally { await f.close(); }
    if (besedilo === null) return false;
    const krog = JSON.parse(besedilo) as ZapisKroga | null;
    if (krog === null || typeof krog !== "object" || krog.v !== 1 || krog.clani === null || typeof krog.clani !== "object") return false;
    if (!Object.hasOwn(krog.clani, id)) return false;
    const c = krog.clani[id];
    if (c === null || typeof c !== "object" || typeof c.kljuc !== "string" || !enak(c.kljuc, kljuc)) return false;
    return podpisVnosaVelja(krog, id, c) && umikDovoljuje(krog, id, c.dodano) && await nagrobnikiDovoljujejo(pot, id, c.dodano, okolje);
  } catch {
    return false;
  }
}
