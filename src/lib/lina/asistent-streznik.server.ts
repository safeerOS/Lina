/**
 * Koncna tocka asistentke za telefon (lastnik 13.-14. 11. 2026; NALOGA-lina-kanal-claude-code.md 3b): telefon v ozjem krogu
 * Safeer Linka poslje PODPISANO nalogo, odobritev ali ustavitev (nizi iz kanal-claude.ts, Kotlin: si.safeer.lina.podpis);
 * Lina jih preveri in preda izvajalcu (IzvajalecClaudeCode), telefon pa bere dogodke (izid, zahteve za odobritev).
 *
 * Pot ni nova: kot povezava telefon <-> OpenLine na racunalniku (openline/server: lan.ts, tls.ts, tls-pin.ts) - HTTPS s
 * samopodpisanim potrdilom, telefon pripne odtis SHA-256 lista (PinnedHttp, TlsPin), brez preusmeritev, streznik samo na
 * 127.0.0.1 ali zasebnem naslovu domacega omrezja (nikoli 0.0.0.0 ali javni IP). Locen streznik od poti klica (tajnica):
 * nobena datoteka poti klica ga ne uvaza (preizkus v kanal-claude.test.ts).
 *
 * Dostop: vsako dejanje podpise naprava s seznama kanala (kanal-claude.json, isti javni kljuci); cas v oknu 2 min, ne pred
 * zagonom; enkratni niz. Dogodke bere samo, kdor pozna id naloge (vsaj 128 bitov, poslan samo prek pripetega TLS) - telefon,
 * ki jo je dal. Pogodba (poti, JSON, napake) je v AGENTS.md (»Koncna tocka asistentke za telefon«).
 */
import { obremenitevRacunalnika, type ObremenitevRacunalnika } from "./obremenitev.server.ts";
import { createHash, generateKeyPairSync, randomBytes, sign, timingSafeEqual, X509Certificate, createPrivateKey } from "node:crypto";
import { constants as fsKonstante } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:https";
import { constants as cryptoKonstante } from "node:crypto";
import { TLSSocket, createSecureContext, type SecureContext } from "node:tls";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Socket } from "node:net";
import { Transform, type Duplex } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MAPA_SLIK, NAJVEC_BAJTOV_SLIKE, NAJVEC_BAJTOV_VIDEA, preberiKnjiznico } from "./slike-knjiznica.server.ts";
import { NAJVEC_ZNAKOV, type Dogodek, type Izvajalec, type Naloga } from "./asistent.server.ts";
import {
  ENKRATNI,
  ID_NAPRAVE,
  ID_ODOBRITVE,
  OKNO_PODPISA_MS,
  nizDodatka,
  nizDogodkov,
  nizKlici,
  nizNadaljevanja,
  nizNaloge,
  nizOdobritve,
  nizSeznanitve,
  nizSinhron,
  nizSlikeKontrole,
  nizStanja,
  nizStanjaDodatkov,
  nizN8nStanja,
  nizN8nPredloga,
  nizN8nPotrditve,
  zgostitevN8nPredlogaVnos,
  nizApkGradnje,
  nizSeznamaSlik,
  nizSlike,
  nizPotrditveGradnje,
  nizPredlogaGradnje,
  nizStanjaGradenj,
  nizDodelitveAgentNaloge,
  nizPreklicaAgentNaloge,
  nizOdgovoraVprasanja,
  nizStanjaVprasanj,
  nizStanjaAgentNalog,
  zgostitevDodelitve,
  nizUstavitve,
  zgostitevSinhron,
  idPripadaKljucu,
  praviUnicode,
  veljavenKljucNaprave,
  preveriPodpisNaprave,
  zgostitevPrikaza,
  jeDodatekTelefona,
  type DodatekTelefona,
  type Dokaz,
} from "./kanal-claude.ts";
import { preberiKanal, preveriKoren } from "./kanal-claude.server.ts";
import { nizDovoljenjaOdobritve } from "./dovoljenja-podobne.ts";
import { obsegIzPrikaza, zapisiDovoljenje } from "./dovoljenja-podobne.server.ts";
import { NapakaKode, PAIR_ID, type SeznanitevSKodo } from "./koda-seznanitev.ts";
import { NapakaSinhron, izmenjajSinhron, preveriZahtevo } from "./sinhron-telefon.server.ts";

// ------------------------------------------------------------------ naslov poslusanja (prepis openline/server/src/lan.ts)

const VSI_VMESNIKI = new Set(["0.0.0.0", "::", "[::]", "*", "::0"]);

/** Zasebni IPv4, ULA IPv6, localhost. Javni naslov in 0.0.0.0 nista dovoljena (openline lan.ts isPrivateBindHost). */
export function zasebenNaslov(host: string): boolean {
  const raw = host.trim().toLowerCase();
  const bare = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  if (bare === "localhost" || bare === "127.0.0.1" || bare === "::1") return true;
  if (VSI_VMESNIKI.has(raw) || VSI_VMESNIKI.has(bare)) return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(bare);
  if (v4) {
    // vodilne nicle ne: nekateri sklopi omrezja »010« berejo osmisko (8), zato bi bil »010.0.0.1« v resnici javni 8.0.0.1
    // (isto pravilo ima Android AsistentQr.jeZasebniNaslov; skupni vektor TS <-> Kotlin)
    if (v4.slice(1).some((x) => x.length > 1 && x.startsWith("0"))) return false;
    const d = v4.slice(1).map(Number);
    if (d.some((x) => x > 255)) return false;
    const [a, b] = d as [number, number];
    if (a === 127 || a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  }
  // fc00::/7: prva skupina je natanko fcXX ali fdXX (»fc::1« je 00fc::1, ni ULA)
  return /^f[cd][0-9a-f]{2}:/i.test(bare);
}

/** Naslov odjemalca: samo zasebni ali loopback (tudi v obliki ::ffff:192.168.x.x). Javni naslov se zavrne. */
export function zasebenOdjemalec(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.toLowerCase().startsWith("::ffff:") ? addr.slice(7) : addr;
  if (VSI_VMESNIKI.has(a)) return false;
  return zasebenNaslov(a);
}

// ------------------------------------------------------------------ samopodpisano potrdilo (EC P-256, brez zunanjih programov)

function dolzina(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const b: number[] = [];
  for (let x = n; x > 0; x >>= 8) b.unshift(x & 0xff);
  return Buffer.from([0x80 | b.length, ...b]);
}
const tlv = (tag: number, ...vsebina: Buffer[]) => {
  const v = Buffer.concat(vsebina);
  return Buffer.concat([Buffer.from([tag]), dolzina(v.length), v]);
};
const seq = (...v: Buffer[]) => tlv(0x30, ...v);
function oid(niz: string): Buffer {
  const d = niz.split(".").map(Number);
  const b: number[] = [40 * d[0] + d[1]];
  for (const x of d.slice(2)) {
    const deli: number[] = [x & 0x7f];
    for (let y = x >> 7; y > 0; y >>= 7) deli.unshift((y & 0x7f) | 0x80);
    b.push(...deli);
  }
  return tlv(0x06, Buffer.from(b));
}
/** Celo stevilo v DER: najkrajsi zapis (vodilna nicla samo, ce bi sicer bil najvisji bit prizgan); drugace OpenSSL zavrne »illegal padding«. */
const celo = (b: Buffer) => {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0 && !(b[i + 1] & 0x80)) i++;
  const m = b.subarray(i);
  return tlv(0x02, m[0] & 0x80 ? Buffer.concat([Buffer.from([0]), m]) : m);
};
function utc(d: Date): Buffer {
  const p = (n: number) => String(n).padStart(2, "0");
  const s = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return tlv(0x17, Buffer.from(s, "ascii"));
}

/** Samopodpisano X.509 v3 (CN »Lina asistentka«, SAN localhost in 127.0.0.1 kot pri OpenLine; istovetnost je odtis, ne ime). */
export function ustvariPotrdilo(zdaj = new Date()): { cert: string; key: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const ecdsaSha256 = seq(oid("1.2.840.10045.4.3.2"));
  const ime = seq(tlv(0x31, seq(oid("2.5.4.3"), tlv(0x0c, Buffer.from("Lina asistentka", "utf8")))));
  const zacetek = new Date(zdaj.getTime() - 24 * 3600_000);
  const konec = new Date(zdaj.getTime() + 825 * 24 * 3600_000);
  const san = seq(tlv(0x82, Buffer.from("localhost", "ascii")), tlv(0x87, Buffer.from([127, 0, 0, 1])));
  const razsiritve = tlv(0xa3, seq(
    seq(oid("2.5.29.19"), tlv(0x01, Buffer.from([0xff])), tlv(0x04, seq())),
    seq(oid("2.5.29.17"), tlv(0x04, san)),
  ));
  const serijska = randomBytes(16);
  serijska[0] &= 0x7f;
  const tbs = seq(
    tlv(0xa0, celo(Buffer.from([2]))),
    celo(serijska),
    ecdsaSha256,
    ime,
    seq(utc(zacetek), utc(konec)),
    ime,
    publicKey.export({ format: "der", type: "spki" }),
    razsiritve,
  );
  const podpis = sign("sha256", tbs, privateKey);
  const der = seq(tbs, ecdsaSha256, tlv(0x03, Buffer.concat([Buffer.from([0]), podpis])));
  const cert = `-----BEGIN CERTIFICATE-----\n${der.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----\n`;
  return { cert, key: privateKey.export({ format: "pem", type: "pkcs8" }) as string };
}

/** SHA-256 lista, male crke brez dvopicij (oblika TlsPin.normalize na telefonu). */
export function odtisPotrdila(certPem: string): string {
  return new X509Certificate(certPem).fingerprint256.replace(/:/g, "").toLowerCase();
}

/** Potrdilo v <mapa podatkov>/asistent-tls (mapa 0700, kljuc 0600); ce ni veljavno ali ne ustreza kljucu, novo. */
export async function potrdiloAsistenta(root: string): Promise<{ cert: string; key: string; odtis: string }> {
  await preveriKoren(root);
  const mapa = path.join(root, "asistent-tls");
  await mkdir(mapa, { recursive: true, mode: 0o700 });
  const st = await lstat(mapa);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("Mapa potrdila asistentke ni navadna mapa.");
  if (process.platform !== "win32") await chmod(mapa, 0o700);
  const pc = path.join(mapa, "potrdilo.pem");
  const pk = path.join(mapa, "kljuc.pem");
  try {
    const cert = await readFile(pc, "utf8");
    const key = await readFile(pk, "utf8");
    const x = new X509Certificate(cert);
    if (x.checkPrivateKey(createPrivateKey(key)) && new Date(x.validTo).getTime() > Date.now() + 30 * 24 * 3600_000) {
      return { cert, key, odtis: odtisPotrdila(cert) };
    }
  } catch {
    // ni potrdila ali je pokvarjeno: novo
  }
  const nov = ustvariPotrdilo();
  await writeFile(pk, nov.key, { mode: 0o600 });
  await writeFile(pc, nov.cert, { mode: 0o644 });
  return { ...nov, odtis: odtisPotrdila(nov.cert) };
}

// ------------------------------------------------------------------ streznik

/** Id naloge za to pot: najmanj 22 znakov iz 64 (128 bitov) - ker je id tudi kljuc za branje dogodkov. */
export const ID_NALOGE_TELEFONA = /^[A-Za-z0-9_-]{22,64}$/;
export const NAJVEC_TELO = 16 * 1024;
/** Sinhronizacija: telefon poslje do 400 000 B zapisov klicev (SinhronLine.NAJVEC_BAJTOV_KLICEV) + pogovor + navodila, JSON-niz v JSON-u. */
export const NAJVEC_TELO_SINHRON = 768 * 1024;
/**
 * Fotografija za kontrolo tiska: telo so SUROVI bajti slike (image/jpeg ali image/png) do 16 MiB; podpis je v glavah in se
 * preveri PRED branjem telesa (neodvisni pregled 24. 11. 2026, N1), zgostitev telesa se primerja po branju.
 * Glave: x-lina-posiljatelj, x-lina-cas, x-lina-enkratni, x-lina-podpis, x-lina-zgostitev (sha256 hex surovih bajtov).
 */
export const NAJVEC_TELO_SLIKA = 16 * 1024 * 1024;
export const POT_SLIKA_KONTROLE = "/api/asistent/v1/kontrola-tiska/slika";
export const NAJVEC_NALOG = 200;
/**
 * Naloga 25 (N3b, N6c/d): podpisan /ustavi za id, ki ga racunalnik se nima, zapise id v grob te naprave; poznejsi POST /naloga s tem
 * id dobi 409 »obstaja« (telefon: sprejeta, ne odda znova) in se ne izvede. Rok mora biti daljsi od okna podpisa (OKNO_PODPISA_MS):
 * zadrzan POST je star najvec toliko, potem ga zavrne ze preverba casa.
 */
export const ROK_GROBA_MS = 10 * 60_000;
export const NAJVEC_GROB_NA_NAPRAVO = 50;
export const NAJVEC_GROB = 1000;
/** CRR3-3: odlozena ustavitev (/ustavi je ze vrnil 202) se ob napaki ponovi na toliko ms (spremenljivo samo za preizkuse). */
export const ponovitevUstavitve = { ms: 5_000 };
export const NAJVEC_DOGODKOV = 200;
/** SR-8: telefon zavrne odgovor nad 64 KiB, zato Lina dogodke razdeli (z rezervo za ovojnico). */
export const NAJVEC_ODGOVOR_DOGODKOV_B = 48 * 1024;
/** Prvi dogodki, katerih skupna dolzina JSON ne presega [najvec] bajtov (vedno vsaj en, da telefon napreduje). */
export function dogodkiDoMeje<T>(dogodki: T[], najvec: number): T[] {
  let vsota = 0;
  const izhod: T[] = [];
  for (const d of dogodki) {
    const b = Buffer.byteLength(JSON.stringify(d), "utf8") + 1;
    if (izhod.length && vsota + b > najvec) break;
    vsota += b;
    izhod.push(d);
  }
  return izhod;
}
/** Najdaljse cakanje na nov dogodek (dolgo poizvedovanje) - manj zahtev s telefona, takojsnja dostava. */
export const NAJDLJE_CAKA_S = 25;
/** Neuspesnih poizvedb po neznanem id na minuto z enega naslova; nato 429 (ugibanje id-jev). */
export const NAJVEC_NEZNANIH_NA_MINUTO = 30;
export const POT = "/api/asistent/v1";
/** T1-S2: najvec hkratnih povezav (TLS rokovanj) vsega skupaj in z enega naslova; sicer sosed zasede vticnice procesa, kjer tecejo tudi klici. */
export const NAJVEC_POVEZAV = 64;
export const NAJVEC_POVEZAV_NA_NASLOV = 8;
/** Rok TLS rokovanja (privzeto v Nodu 120 s: pol-odprta povezava bi zasedala vticnico dve minuti). */
export const ROK_ROKOVANJA_MS = 5_000;
/** T1-N6: zahtev na minuto z enega naslova (vse poti) in zavrnjenih (podpis, koda, naprava) na minuto; nato 429 brez branja diska. */
export const NAJVEC_ZAHTEV_NA_MINUTO = 120;
export const NAJVEC_ZAVRNITEV_NA_MINUTO = 20;
/**
 * Pregled 0213 A2: rele ne pove, katera naprava je odprla kanal, zato zgornji meji veljata po KANALU (en kanal s slabimi podpisi ne
 * zapre poti drugim), vsi kanali istega transporta skupaj pa imajo visjo skupno mejo (menjava kanalov ne obide T1-N6).
 */
export const NAJVEC_ZAHTEV_ODDALJENO_SKUPAJ = 5 * NAJVEC_ZAHTEV_NA_MINUTO;
export const NAJVEC_ZAVRNITEV_ODDALJENO_SKUPAJ = 5 * NAJVEC_ZAVRNITEV_NA_MINUTO;
/**
 * Oddaljeni prehod (F5): glavi, ki ju nastavi samo prehod v ISTEM procesu (oddaljeni-prehod.server.ts) z zetonom, ki ga zna samo
 * streznik. Brez omogocenega prehoda ali z napacnim zetonom je zahteva z njima zavrnjena (nikoli ne spremeni vira omejitve).
 */
export const GLAVA_PREHOD = "x-lina-prehod";
export const GLAVA_VIR = "x-lina-vir";
export const VIR_PREHODA = /^[A-Za-z0-9._:-]{1,64}$/;
/** Povezav z lokalnega naslova, ko je prehod omogocen (vse oddaljene zahteve pridejo od tam; vir omejitve je drug). */
export const NAJVEC_POVEZAV_PREHOD = 32;
/** Naloga 20: datoteke knjiznice slik, ki jih sme dobiti telefon (isti vzorec kot mediji-datoteka.server.ts). */
const DATOTEKA_KNJIZNICE = /^[a-z0-9]{12}\.(png|jpg|mp4)$/;
const MIME_KNJIZNICE = { png: "image/png", jpg: "image/jpeg", mp4: "video/mp4" } as const;
/** Poti, ki jih sme poklicati OSEBA ZUNAJ DOMA (beli seznam); seznanjanje (/seznani, /koda/*) nikoli. */
export const POTI_ODDALJENO: ReadonlyMap<string, string> = new Map([
  [`${POT}/naloga`, "POST"], [`${POT}/odobritev`, "POST"], [`${POT}/ustavi`, "POST"], [`${POT}/nadaljuj`, "POST"], [`${POT}/dogodki`, "GET"], [`${POT}/stanje`, "GET"],
  // Dodatki na racunalniku (23. 11. 2026) in n8n tokovi (24. 11. 2026): ista naprava ozjega kroga s podpisom kot za nalogo.
  [`${POT}/dodatki`, "GET"], [`${POT}/dodatek`, "POST"],
  [`${POT}/dodatki/n8n`, "GET"], [`${POT}/dodatki/n8n/predlog`, "POST"], [`${POT}/dodatki/n8n/potrdi`, "POST"],
  // Naloge agentov in gradnje prek Global Linka: lastnik 25. 11. 2026 »da« (»more tudi global link delovati«); isti podpis naprave.
  [`${POT}/agent-naloge`, "GET"], [`${POT}/agent-naloga/dodeli`, "POST"], [`${POT}/agent-naloga/preklici`, "POST"],
  [`${POT}/gradnje`, "GET"], [`${POT}/gradnja/apk`, "GET"], [`${POT}/gradnja/predlog`, "POST"], [`${POT}/gradnja/potrdi`, "POST"],
  // Pregled 0213 A10: naloga, dodeljena od zunaj, caka na vprasanja agenta - brez teh poti bi jo rok (10 min) zavrnil; isti podpis naprave.
  [`${POT}/agent-vprasanja`, "GET"], [`${POT}/agent-vprasanje/odgovor`, "POST"],
]);

type DogodekTelefona = Dogodek & { st: number };
type NalogaTelefona = {
  posiljatelj: string;
  dogodki: DogodekTelefona[];
  koncano: boolean;
  cas: number;
  odprte: Map<string, string>; // zahtevaId -> zgostitev prikazanega
  cakajo: Set<() => void>;
  /** CRR4-1: /ustavi je dobil 202 - naloga je za telefon ustavljena, /nadaljuj se zavrne (tudi ce je odlozena ustavitev opuscena). */
  ustavljena?: true;
};

/** Enkratna koda iz QR (128 bitov, base64url). */
export const KODA_SEZNANITVE = /^[A-Za-z0-9_-]{22,64}$/;
export type StanjeSeznanitve = "odprta" | "caka" | "sprejeto" | "zavrnjeno";
/** Seznanjanje vodi Lina (asistent-telefon.server.ts); streznik samo preveri dokaz kljuca in prijavo preda lastniku. */
export interface Seznanitve {
  stanje(koda: string): StanjeSeznanitve | null;
  /** Prijava telefona za odprto kodo; dostopa NE podeli - napravo doda samo lastnik z gumbom. */
  prijavi(koda: string, naprava: { id: string; kljuc: string; ime: string }): boolean;
  /**
   * Prijava telefona po uspesnem SPAKE2 s 6-mestno kodo (koda = pair_id); enako kot prijavi: stanje »caka«, napravo doda
   * samo lastnik. Vrne razdelek poti klicev (kot QR) ali null, ce prijave ni mogoce zapisati.
   */
  prijaviPoKodi?(koda: string, naprava: { id: string; kljuc: string; ime: string }): boolean;
  /**
   * Razdelek poti klicev OpenLine za napravo, ki jo je lastnik ze dodal (T1-S1: pred »Dodaj« ga telefon ne dobi, ne iz QR in ne po
   * kodi). undefined = prijava ni sprejeta ali ni te naprave; null = poti klicev ni.
   */
  klici?(koda: string, id: string): { url: string; code: string; fp: string } | null | undefined;
}

export type { IzidOdpiranjaSeje } from "./seja-claude.server.ts";

export type MoznostiStreznika = {
  root: string;
  /**
   * Naloga 18: Lina sama odpre sejo Claude Code (seja-claude.server.ts; stikalo in opozorilo preveri klicatelj). Klice se SAMO v poti /naloga
   * po preverbi podpisa naprave s seznama kanala (vsak dodan telefon, tudi prek releja). Naloga se NE zadrzi: kanal zavrne podpis, starejsi od svojega zagona (kanal-claude.server.ts,
   * N-C), zato jo mora telefon po odprtju seje podpisati in poslati znova (odgovor 503 s stanje.zagon = "odpira").
   */
  odpriSejoClaude?: () => Promise<import("./seja-claude.server.ts").IzidOdpiranjaSeje>;
  /** 127.0.0.1 (privzeto) ali zasebni naslov domacega omrezja; 0.0.0.0 in javni naslov se zavrneta. */
  naslov?: string;
  vrata?: number;
  izvajalec: Izvajalec;
  seznanitve?: Seznanitve;
  /** Seznanjanje s 6-mestno kodo (koda-seznanitev.ts); brez njega poti /koda/* odgovorijo 404. */
  koda?: SeznanitevSKodo;
  zdaj?: () => number;
  dnevnik?: (s: string) => void;
  /** Za preizkuse: branje seznana naprav (preizkus steje, kdaj streznik bere in desifrira kanal-claude.json). */
  preberiKanal?: typeof preberiKanal;
  /** Za preizkuse: rok TLS rokovanja v ms (privzeto ROK_ROKOVANJA_MS). */
  rokRokovanja?: number;
  /** F5: omogoci vhod za oddaljeni prehod (privzeto izklopljeno; streznik se vseeno veze samo na zasebni naslov). */
  omogociPrehod?: boolean;
  /**
   * Global Link (naloga 22): sprejem kanalov releja v istem procesu (sprejmiOddaljeno). Privzeto izklopljeno; brez tega se vsak
   * predan kanal takoj zapre.
   */
  omogociOddaljeno?: boolean;
  /** Id Line na releju (rele-lina.server.ts); telefon ga dobi v podpisanem odgovoru /stanje. null = rele izklopljen. */
  rele?: () => string | null;
  /** Naloga 34: obremenitev in ime racunalnika v podpisanem /stanje (telefon razdeli naloge); privzeto obremenitev.server.ts. */
  obremenitev?: () => ObremenitevRacunalnika;
  /** Dodatki na racunalniku (dodatki-telefon.server.ts + n8n.server.ts); brez njih poti /dodatki, /dodatek in /dodatki/n8n* odgovorijo 404. */
  dodatki?: {
    stanje(): Promise<unknown>;
    nastavi(dodatek: DodatekTelefona, vklop: boolean): Promise<unknown>;
    n8n?: {
      stanje(): Promise<unknown>;
      predlog(vrsta: unknown, cilj: unknown, ime?: unknown): Promise<{ id: string; vrsta: string; zgostitev: string; povzetek: string }>;
      potrdi(id: unknown, zgostitev: unknown, dovoli: unknown): Promise<unknown>;
    };
  };
  /**
   * Gradnje na GitHubu (24. 11. 2026, gradnje-github.server.ts); brez njih poti /gradnje in /gradnja/* odgovorijo 404. Napaka z
   * lastnostjo razlog (GradnjaNapaka) postane 409 {napaka: razlog}. Poti so v POTI_ODDALJENO (lastnik 25. 11. 2026: tudi prek Global Linka).
   */
  gradnje?: {
    stanje(): Promise<unknown>;
    /** `naprava`: dovoljenje za podobne gradnje, ki ga je dala TA naprava (podpis se preveri s kljucem iz `kljuci`). */
    predlog(tok: unknown, veja: unknown, naprava?: { naprava: string; kljuci: ReadonlyMap<string, string> }): Promise<{ id: string; zgostitev: string; stanje?: string }>;
    /** `podobne`: podpis naprave za »Velja tudi za vse podobne« (nizDovoljenja), preveri ga gradnje-github ob zapisu. */
    potrdi(id: unknown, zgostitev: unknown, podobne?: { naprava: string; kljuc: string; cas: number; enkratni: string; podpis: string }): Promise<void>;
    /** SAMO zadnja koncana gradnja APK s preverjenim podpisom (nikoli poljubna pot). */
    apk(): Promise<{ id: string; pot: string; sha256: string; velikost: number; paket: string } | null>;
  };
  /**
   * Naloge agentov na racunalniku (24. 11. 2026, claude-naloge.server.ts): vrsta, dodelitev in preklic s podpisom naprave; brez njih poti
   * /agent-naloge in /agent-naloga/* odgovorijo 404. Napaka z lastnostjo razlog postane 409. Poti so v POTI_ODDALJENO (lastnik 25. 11. 2026: tudi prek Global Linka).
   */
  agentiNaloge?: {
    stanje(): Promise<unknown>;
    dodeli(agent: string, mapa: string, besedilo: string, pogoj: string): Promise<{ id: string }>;
    preklici(id: string): Promise<void>;
  };
  /**
   * Vprasanja agentov (naloga 23, vprasanja-agentov.server.ts): stanje (odprta vprasanja, zadnje vrstice dela) in odgovor s podpisom naprave,
   * ki veze id, odlocitev in zgostitev prikazanega. Brez njih poti /agent-vprasanja* odgovorijo 404. Doma in prek Global Linka (pregled 0213 A10).
   */
  vprasanjaAgentov?: {
    stanje(): Promise<unknown>;
    odgovori(id: string, odlocitev: string, zgostitev: string, naprava: string): Promise<void>;
  };
};

class Napaka extends Error {
  readonly status: number;
  readonly koda: string;
  readonly dodatno: Record<string, unknown>;
  constructor(status: number, koda: string, sporocilo: string, dodatno: Record<string, unknown> = {}) {
    super(sporocilo);
    this.status = status;
    this.koda = koda;
    this.dodatno = dodatno;
  }
}
const zavrnjeno = () => new Napaka(403, "zavrnjeno", "Podpis, naprava, cas ali enkratni niz ne velja.");
/** Pot ni na belem seznamu oddaljenih poti: 403 kot prej, a ne steje med zavrnitve (pregled 1: skupna omejitev releja). */
class NiOddaljeno extends Napaka {}

export function imeNaprave(ime: unknown): ime is string {
  return typeof ime === "string" && !!ime.trim() && ime.length <= 60 && praviUnicode(ime) && !/[\u0000-\u001f\u007f-\u009f]|\p{Cf}/u.test(ime);
}

export class AsistentStreznik {
  private streznik: Server | null = null;
  private readonly naloge = new Map<string, NalogaTelefona>();
  /**
   * Naloga 25 N4: id, ki ga /naloga ze obdeluje (od preverjenega podpisa do konca zacni); ustavi = podpisan /ustavi med tem,
   * izid = obljuba prve oddaje (druga oddaja istega id caka nanjo).
   */
  private readonly zacenja = new Map<string, { posiljatelj: string; ustavi: Dokaz | null; izid: Promise<void> }>();
  /** Naloga 25 N3b: posiljatelj + "\n" + id -> cas zapisa (vrstni red vstavljanja = od najstarejsega). */
  private readonly grob = new Map<string, number>();
  private readonly videni = new Map<string, number>();
  private readonly neznani = new Map<string, number[]>();
  private readonly zahteve = new Map<string, number[]>();
  private readonly zavrnitve = new Map<string, number[]>();
  private readonly povezave = new Map<string, number>();
  private readonly viri = new WeakMap<IncomingMessage, string>();
  private readonly zetonPrehoda: string | null;
  private cilj: { naslov: string; vrata: number; cert: string; odtis: string } | null = null;
  /** Global Link: vticnice TLS iz kanala releja -> vir (overjen s strani transporta); samo te so »oddaljene«. */
  private readonly oddaljeni = new WeakMap<object, { vir: string; kanal: number }>();
  private readonly oddaljeneVticnice = new Set<TLSSocket>();
  private readonly oddaljeniNaVir = new Map<string, number>();
  private stevecKanalov = 0;
  private kontekst: SecureContext | null = null;
  private readonly zagnan: number;
  private readonly zdaj: () => number;
  private readonly dnevnik: (s: string) => void;
  private readonly m: MoznostiStreznika;
  odtis = "";
  private lokalniNaslov = "127.0.0.1";

  constructor(m: MoznostiStreznika) {
    this.m = m;
    this.zdaj = m.zdaj ?? Date.now;
    this.zagnan = this.zdaj();
    this.zetonPrehoda = m.omogociPrehod ? randomBytes(32).toString("base64url") : null;
    this.dnevnik = m.dnevnik ?? ((s) => process.stderr.write(`[lina-asistent] ${s}\n`));
  }

  async zazeni(): Promise<{ naslov: string; vrata: number; odtis: string }> {
    const naslov = (this.m.naslov ?? "127.0.0.1").trim();
    if (!zasebenNaslov(naslov)) throw new Error("Asistentka poslusa samo na 127.0.0.1 ali zasebnem naslovu domacega omrezja.");
    const { cert, key, odtis } = await potrdiloAsistenta(this.m.root);
    this.odtis = odtis;
    // oddaljeni kanali: isto potrdilo; brez ponovnega rokovanja TLS 1.2 (AGENTS.md F5, pregled 18. 11. 2026)
    if (this.m.omogociOddaljeno) this.kontekst = createSecureContext({ cert, key, minVersion: "TLSv1.2", secureOptions: cryptoKonstante.SSL_OP_NO_RENEGOTIATION });
    const lokalni = naslov;
    const s = createServer({ cert, key, minVersion: "TLSv1.2", handshakeTimeout: this.m.rokRokovanja ?? ROK_ROKOVANJA_MS }, (req, res) => { this.zahteva(req, res).catch(() => this.poslji(res, 500, { napaka: "notranja" })); });
    s.headersTimeout = 10_000;
    // celotna zahteva (glava + telo) v 10 s; dolgo poizvedovanje se steje v odgovor, ne v sprejem zahteve
    s.requestTimeout = 10_000;
    s.maxHeadersCount = 30;
    s.maxConnections = NAJVEC_POVEZAV;
    s.on("tlsClientError", () => undefined);
    // surova vticnica pred TLS: omejitev na naslov, preden se zacne drago rokovanje
    s.on("connection", (v: Duplex) => {
      const vticnica = v as Socket;
      const a = vticnica.remoteAddress ?? "";
      const n = (this.povezave.get(a) ?? 0) + 1;
      if (n > (this.zetonPrehoda && this.jeLokalno(a) ? NAJVEC_POVEZAV_PREHOD : NAJVEC_POVEZAV_NA_NASLOV)) { vticnica.destroy(); return; }
      this.povezave.set(a, n);
      vticnica.once("close", () => {
        const m = (this.povezave.get(a) ?? 1) - 1;
        if (m <= 0) this.povezave.delete(a); else this.povezave.set(a, m);
      });
    });
    await new Promise<void>((ok, ne) => {
      s.once("error", ne);
      s.listen(this.m.vrata ?? 0, naslov, () => { s.off("error", ne); ok(); });
    });
    this.streznik = s;
    const a = s.address();
    const vrata = typeof a === "object" && a ? a.port : 0;
    this.lokalniNaslov = lokalni;
    this.cilj = { naslov, vrata, cert, odtis };
    return { naslov, vrata, odtis };
  }

  /** Cilj za oddaljeni prehod v istem procesu; vrne se samo, ce je prehod omogocen in streznik tece. */
  ciljPrehoda(): { naslov: string; vrata: number; cert: string; odtis: string; zeton: string } {
    if (!this.zetonPrehoda || !this.cilj || !this.streznik) throw new Error("Oddaljeni prehod ni omogocen ali streznik ne tece.");
    return { ...this.cilj, zeton: this.zetonPrehoda };
  }

  /**
   * Global Link (naloga 22): kanal releja (rele-lina.server.ts) postane povezava TEGA streznika. TLS opravi streznik sam z
   * istim potrdilom (telefon pripne odtis kot doma), zato transport ne vidi vsebine. [vir] je identiteta, ki jo je overil
   * transport (nikoli naslov na releju ali id iz telesa); omejitve tecejo po »r:<vir>«. Na vticnici je oznaka »oddaljena«:
   * velja samo beli seznam POTI_ODDALJENO, podpis naprave, okno casa in enkratni niz kot doma. Stevca se povecata sele po
   * uspesni gradnji TLSSocket. false = kanal je zavrnjen in zaprt.
   */
  sprejmiOddaljeno(v: Duplex, vir: string): boolean {
    const s = this.streznik;
    const naVir = this.oddaljeniNaVir.get(vir) ?? 0;
    if (!s || !this.kontekst || !this.m.omogociOddaljeno || typeof vir !== "string" || !VIR_PREHODA.test(vir)
      || this.oddaljeneVticnice.size >= NAJVEC_POVEZAV_PREHOD || naVir >= NAJVEC_POVEZAV_NA_NASLOV) {
      v.destroy();
      return false;
    }
    let t: TLSSocket;
    try {
      t = new TLSSocket(v as Socket, { isServer: true, secureContext: this.kontekst, requestCert: false });
    } catch {
      v.destroy();
      return false;
    }
    this.oddaljeni.set(t, { vir, kanal: ++this.stevecKanalov });
    this.oddaljeneVticnice.add(t);
    this.oddaljeniNaVir.set(vir, naVir + 1);
    let sproscen = false;
    const sprosti = () => {
      if (sproscen) return;
      sproscen = true;
      clearTimeout(rok);
      this.oddaljeneVticnice.delete(t);
      const m = (this.oddaljeniNaVir.get(vir) ?? 1) - 1;
      if (m <= 0) this.oddaljeniNaVir.delete(vir); else this.oddaljeniNaVir.set(vir, m);
    };
    const rok = setTimeout(() => t.destroy(), this.m.rokRokovanja ?? ROK_ROKOVANJA_MS);
    t.once("close", sprosti);
    v.once("close", () => t.destroy());
    // obratno ni treba: unicenje TLSSocket na Node 22 zapre tudi zaviti kanal (izmerjeno: preizkus »pregled 3«, mutacija M11 25. 11. 2026)
    t.on("error", () => t.destroy());
    t.once("secure", () => {
      clearTimeout(rok);
      if (this.streznik !== s) { t.destroy(); return; }
      s.emit("secureConnection", t);
    });
    return true;
  }

  /** Zahteva prihaja z istega racunalnika (loopback ali lasten naslov poslusanja). */
  private jeLokalno(addr: string | undefined): boolean {
    if (!addr) return false;
    const a = addr.toLowerCase().startsWith("::ffff:") ? addr.slice(7) : addr;
    return a === "::1" || /^127\./.test(a) || a === this.lokalniNaslov;
  }

  /**
   * F5: vir omejitev za zahtevo prek prehoda. null = navadna zahteva (vir je naslov odjemalca). Glavi prehoda brez omogocenega
   * prehoda, z drugega naslova ali z napacnim zetonom pomenita zavrnitev, ne tihega prepisa vira.
   */
  private virPrehoda(req: IncomingMessage): string | null {
    const z = req.headers[GLAVA_PREHOD];
    const v = req.headers[GLAVA_VIR];
    if (z === undefined && v === undefined) return null;
    if (!this.zetonPrehoda || typeof z !== "string" || typeof v !== "string" || !this.jeLokalno(req.socket.remoteAddress)) throw zavrnjeno();
    const a = Buffer.from(z);
    const b = Buffer.from(this.zetonPrehoda);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw zavrnjeno();
    if (!VIR_PREHODA.test(v)) throw new Napaka(400, "oblika", "Neveljaven vir prehoda.");
    return `p:${v}`;
  }

  ustavi(): Promise<void> {
    const s = this.streznik;
    this.streznik = null;
    for (const n of this.naloge.values()) for (const c of n.cakajo) c();
    for (const t of this.oddaljeneVticnice) t.destroy();
    if (!s) return Promise.resolve();
    s.closeAllConnections?.();
    return new Promise((ok) => s.close(() => ok()));
  }

  private poslji(res: ServerResponse, status: number, telo: unknown): void {
    if (res.headersSent) return;
    const b = Buffer.from(JSON.stringify(telo));
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": b.length });
    res.end(b);
  }

  private async zahteva(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let vir = req.socket.remoteAddress ?? "";
    // A2: skupni vir vseh kanalov istega transporta (samo oddaljena pot); omejitve tecejo po kanalu IN skupno
    let skupni: string | null = null;
    try {
      // tujec z javnega naslova (preusmeritev vrat, posrednik) ne pride naprej, tudi ce bi streznik kdo izpostavil
      // Global Link: oznako »oddaljena« ima samo vticnica iz sprejmiOddaljeno (nikoli glava ali naslov odjemalca)
      const oddaljen = this.oddaljeni.get(req.socket);
      if (oddaljen === undefined && !zasebenOdjemalec(req.socket.remoteAddress)) throw new Napaka(403, "zavrnjeno", "Samo domace omrezje.");
      if (oddaljen !== undefined && (req.headers[GLAVA_PREHOD] !== undefined || req.headers[GLAVA_VIR] !== undefined)) throw zavrnjeno();
      const prehod = oddaljen !== undefined ? `r:${oddaljen.vir}#${oddaljen.kanal}` : this.virPrehoda(req);
      if (prehod !== null) vir = prehod;
      this.viri.set(req, vir);
      if (oddaljen !== undefined) {
        skupni = `r:${oddaljen.vir}`;
        this.omeji(skupni, NAJVEC_ZAVRNITEV_ODDALJENO_SKUPAJ, NAJVEC_ZAHTEV_ODDALJENO_SKUPAJ);
      }
      this.omeji(vir);
      const url = new URL(req.url ?? "/", "https://lina.invalid");
      // oddaljena naprava: samo beli seznam poti (seznanjanje zahteva lastnika pri racunalniku), tudi ce bi prehod napacno posredoval
      if (prehod !== null && POTI_ODDALJENO.get(url.pathname) !== req.method) throw new NiOddaljeno(403, "zavrnjeno", "Pot ni dovoljena prek oddaljene poti.");
      if (req.method === "GET" && url.pathname === `${POT}/dogodki`) return await this.dogodki(req, res, url);
      if (req.method === "GET" && url.pathname === `${POT}/seznani`) return this.poslji(res, 200, this.stanjeSeznanitve(req, url));
      if (req.method === "GET" && url.pathname === `${POT}/stanje`) return this.poslji(res, 200, await this.stanjeSeje(url));
      if (req.method === "GET" && url.pathname === `${POT}/dodatki`) return this.poslji(res, 200, await this.stanjeDodatkov(url));
      if (req.method === "GET" && url.pathname === `${POT}/dodatki/n8n`) return this.poslji(res, 200, await this.stanjeN8n(url));
      if (req.method === "GET" && url.pathname === `${POT}/gradnje`) return this.poslji(res, 200, await this.stanjeGradenj(url));
      if (req.method === "GET" && url.pathname === `${POT}/gradnja/apk`) return await this.apkGradnje(url, res);
      // naloga 20: knjiznica slik na telefon - samo doma (ni v POTI_ODDALJENO; Global Link sele po lastnikovem »da«)
      if (req.method === "GET" && url.pathname === `${POT}/slike`) return this.poslji(res, 200, await this.seznamSlik(url));
      if (req.method === "GET" && url.pathname === `${POT}/slika`) return await this.slikaKnjiznice(url, res);
      if (req.method === "GET" && url.pathname === `${POT}/agent-naloge`) return this.poslji(res, 200, await this.stanjeAgentNalog(url));
      if (req.method === "GET" && url.pathname === `${POT}/agent-vprasanja`) return this.poslji(res, 200, await this.stanjeVprasanjAgentov(url));
      if (req.method !== "POST") throw new Napaka(url.pathname.startsWith(POT) ? 405 : 404, "ni", "Ni take poti.");
      if (url.pathname === POT_SLIKA_KONTROLE) return this.poslji(res, 200, await this.slikaKontrole(req));
      const telo = await this.telo(req, url.pathname === `${POT}/sinhron` ? NAJVEC_TELO_SINHRON : NAJVEC_TELO);
      const izid = url.pathname === `${POT}/naloga` ? await this.naloga(telo)
        : url.pathname === `${POT}/odobritev` ? await this.odobritev(telo)
          : url.pathname === `${POT}/ustavi` ? await this.ustavitev(telo)
          : url.pathname === `${POT}/nadaljuj` ? await this.nadaljevanje(telo)
            : url.pathname === `${POT}/seznani` ? await this.seznani(telo)
              : url.pathname === `${POT}/koda/zacni` ? await this.kodaZacni(vir, telo)
                : url.pathname === `${POT}/koda/spake` ? this.kodaSpake(telo)
                  : url.pathname === `${POT}/koda/potrdi` ? await this.kodaPotrdi(telo)
                    : url.pathname === `${POT}/koda/odpovej` ? this.kodaOdpovej(telo)
                      : url.pathname === `${POT}/seznani/klici` ? await this.klici(telo)
                        : url.pathname === `${POT}/sinhron` ? await this.sinhron(telo)
                          : url.pathname === `${POT}/dodatek` ? await this.dodatek(telo)
                            : url.pathname === `${POT}/dodatki/n8n/predlog` ? await this.predlogN8n(telo)
                              : url.pathname === `${POT}/dodatki/n8n/potrdi` ? await this.potrdiN8n(telo)
                                : url.pathname === `${POT}/gradnja/predlog` ? await this.predlogGradnje(telo)
                              : url.pathname === `${POT}/gradnja/potrdi` ? await this.potrdiGradnjo(telo)
                                : url.pathname === `${POT}/agent-naloga/dodeli` ? await this.dodeliAgentNalogo(telo)
                                  : url.pathname === `${POT}/agent-naloga/preklici` ? await this.prekliciAgentNalogo(telo)
                                    : url.pathname === `${POT}/agent-vprasanje/odgovor` ? await this.odgovorVprasanjaAgenta(telo)
                                    : null;
      if (!izid) throw new Napaka(404, "ni", "Ni take poti.");
      this.poslji(res, izid.status, izid.telo);
    } catch (e) {
      const n = e instanceof Napaka ? e : e instanceof NapakaKode ? new Napaka(e.status, e.koda, e.message) : new Napaka(500, "notranja", "Notranja napaka.");
      if ((n.status === 401 || n.status === 403) && !(e instanceof NiOddaljeno)) {
        this.zabeleziZavrnitev(vir);
        if (skupni !== null) this.zabeleziZavrnitev(skupni);
      }
      if (!(e instanceof Napaka) && !(e instanceof NapakaKode)) this.dnevnik(`napaka: ${(e as Error).message}`);
      this.poslji(res, n.status, { napaka: n.koda, sporocilo: n.message, ...n.dodatno });
    }
  }

  private async telo(req: IncomingMessage, meja = NAJVEC_TELO): Promise<Record<string, unknown>> {
    const tip = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (tip !== "application/json") throw new Napaka(415, "tip", "Telo mora biti application/json.");
    const kosi: Buffer[] = [];
    let n = 0;
    for await (const k of req) {
      n += (k as Buffer).length;
      if (n > meja) throw new Napaka(413, "prevelik", "Telo je preveliko.");
      kosi.push(k as Buffer);
    }
    const besedilo = Buffer.concat(kosi).toString("utf8");
    try {
      const v = JSON.parse(besedilo) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      // spodaj
    }
    throw new Napaka(400, "oblika", "Telo ni veljaven JSON objekt.");
  }

  private kanal() {
    return (this.m.preberiKanal ?? preberiKanal)(this.m.root);
  }

  /** Podpis naprave s seznama kanala v oknu, ne pred zagonom, enkratni niz ze ni bil uporabljen (isto kot kanal). */
  private async preveri(posiljatelj: unknown, t: Record<string, unknown>, niz: (cas: number, e: string) => string): Promise<Dokaz> {
    if (typeof posiljatelj !== "string" || !ID_NAPRAVE.test(posiljatelj)) throw new Napaka(400, "oblika", "Neveljaven posiljatelj.");
    const { cas, enkratni, podpis } = t;
    if (!Number.isSafeInteger(cas) || typeof enkratni !== "string" || !ENKRATNI.test(enkratni) || typeof podpis !== "string") {
      throw new Napaka(400, "oblika", "Manjka cas, enkratni niz ali podpis.");
    }
    this.predPreverba(t);
    const kljuc = (await this.kanal()).dovoljene.get(posiljatelj);
    return this.preveriSKljucem(kljuc, t, niz);
  }

  /** T1-N6: poceni preverbe (okno casa, ne pred zagonom, enkratni niz) PRED branjem in desifriranjem kanal-claude.json. */
  private predPreverba(t: Record<string, unknown>): void {
    const { cas, enkratni } = t;
    if (!Number.isSafeInteger(cas) || typeof enkratni !== "string" || !ENKRATNI.test(enkratni)) throw new Napaka(400, "oblika", "Manjka cas, enkratni niz ali podpis.");
    const zdaj = this.zdaj();
    const c = cas as number;
    if (Math.abs(zdaj - c) > OKNO_PODPISA_MS || c < this.zagnan || this.videni.has(enkratni)) throw zavrnjeno();
  }

  private oknoMinute(m: Map<string, number[]>, naslov: string, vstavi: boolean): number {
    const t = this.zdaj();
    const s = (m.get(naslov) ?? []).filter((x) => t - x < 60_000);
    if (vstavi) s.push(t);
    if (s.length) m.set(naslov, s); else m.delete(naslov);
    if (m.size > 2000) for (const [k, v] of m) if (!v.some((x) => t - x < 60_000)) m.delete(k);
    return s.length;
  }

  /** T1-N6: zahtev z naslova, ki je presegel mejo zahtev ali zavrnitev, dobi 429 PRED vsakim branjem diska ali preverbo podpisa. */
  private omeji(naslov: string, mejaZavrnitev = NAJVEC_ZAVRNITEV_NA_MINUTO, mejaZahtev = NAJVEC_ZAHTEV_NA_MINUTO): void {
    if (this.oknoMinute(this.zavrnitve, naslov, false) >= mejaZavrnitev) throw new Napaka(429, "prevec", "Prevec zavrnjenih zahtev.");
    if (this.oknoMinute(this.zahteve, naslov, true) > mejaZahtev) throw new Napaka(429, "prevec", "Prevec zahtev.");
  }

  private zabeleziZavrnitev(naslov: string): void {
    this.oknoMinute(this.zavrnitve, naslov, true);
  }

  /** Preverba s podanim kljucem (seznanjanje: kljuc, ki ga telefon sele prinasa). */
  private preveriSKljucem(kljuc: string | undefined, t: Record<string, unknown>, niz: (cas: number, e: string) => string): Dokaz {
    const { cas, enkratni, podpis } = t;
    if (!Number.isSafeInteger(cas) || typeof enkratni !== "string" || !ENKRATNI.test(enkratni) || typeof podpis !== "string") {
      throw new Napaka(400, "oblika", "Manjka cas, enkratni niz ali podpis.");
    }
    const zdaj = this.zdaj();
    const c = cas as number;
    for (const [e, v] of this.videni) if (zdaj - v > OKNO_PODPISA_MS) this.videni.delete(e);
    if (!kljuc || Math.abs(zdaj - c) > OKNO_PODPISA_MS || c < this.zagnan || this.videni.has(enkratni)) throw zavrnjeno();
    if (!preveriPodpisNaprave(kljuc, niz(c, enkratni), podpis)) throw zavrnjeno();
    this.videni.set(enkratni, c);
    return { cas: c, enkratni, podpis };
  }

  private async naloga(t: Record<string, unknown>) {
    const { id, posiljatelj, besedilo } = t;
    if (typeof id !== "string" || !ID_NALOGE_TELEFONA.test(id)) throw new Napaka(400, "oblika", "Id naloge mora imeti 22-64 znakov [A-Za-z0-9_-].");
    if (typeof besedilo !== "string" || !besedilo.trim() || besedilo.length > NAJVEC_ZNAKOV || !praviUnicode(besedilo)) {
      throw new Napaka(400, "oblika", "Besedilo je prazno, predolgo ali ni veljaven Unicode.");
    }
    const dokaz = await this.preveri(posiljatelj, t, (c, e) => nizNaloge(id, posiljatelj as string, besedilo, c, e));
    // naloga 25 N4: od tu do rezervacije brez await - dve socasni oddaji istega id: ena izvedba, druga 409 »obstaja«
    const obstaja = () => new Napaka(409, "obstaja", "Naloga s tem id ze obstaja.");
    const tece = this.zacenja.get(id);
    // slepi pregled 25 (1b): druga oddaja dobi izid prve - 409 sele, ko je prva res sprejeta; ob 503 isti 503 (telefon odda znova)
    if (tece) { await tece.izid; throw obstaja(); }
    if (this.vGrobu(posiljatelj as string, id) || this.naloge.has(id)) throw obstaja();
    this.pocisti();
    if (this.naloge.size + this.zacenja.size >= NAJVEC_NALOG) throw new Napaka(429, "prevec", "Prevec nalog hkrati.");
    const rez = { posiljatelj: posiljatelj as string, ustavi: null as Dokaz | null, izid: Promise.resolve() };
    this.zacenja.set(id, rez);
    rez.izid = (async () => {
      const ok = await this.m.izvajalec.razpolozljiv().catch(() => false);
      // N6c/d: /ustavi je prisel med cakanjem na sejo - naloga se ne zacne in seja se zanjo ne odpira (slepi pregled 25, 2)
      if (rez.ustavi) throw obstaja();
      if (!ok) {
        // naloga 18: podpis naprave s seznama kanala (vsak dodan telefon, tudi prek releja) je ze preverjen (preveri zgoraj) - samo ta pot
        // sme odpreti sejo; to NI clanstvo ozjega kroga Safeer Linka. Naloga se ne zadrzi (glej odpriSejoClaude)
        const z = this.m.odpriSejoClaude ? await this.m.odpriSejoClaude().catch(() => ({ ok: false as const, razlog: "napaka" as const })) : null;
        throw new Napaka(503, "claude-code-ni", "Seja Claude Code na racunalniku ni odprta ali ni dosegljiva.", {
          stanje: { claudeCode: "zaprta", ...(z ? { zagon: z.ok ? "odpira" : z.razlog } : {}) },
        });
      }
      const n: NalogaTelefona = { posiljatelj: posiljatelj as string, dogodki: [], koncano: false, cas: this.zdaj(), odprte: new Map(), cakajo: new Set() };
      this.naloge.set(id, n);
      // izvor je vedno »asistent«: ta streznik je samo pot asistentke, iz poti klica do njega ni poti
      const naloga: Naloga = { id, besedilo, posiljatelj: posiljatelj as string, izvor: "asistent", dokaz };
      try {
        // slepi pregled 25 (1): izvajalec tik pred oddajo v sejo preveri preklic - /ustavi med zacni nalogo prepreci, ne ustavi
        await this.m.izvajalec.zacni(naloga, (d) => this.dogodek(id, d), () => rez.ustavi !== null);
      } catch (e) {
        this.naloge.delete(id);
        if (rez.ustavi) throw obstaja();
        // besedilo napake izvajalca (npr. pot vticnice v domaci mapi) gre samo v dnevnik; telefon dobi stalno besedilo (pregled 0225 A-17)
        this.dnevnik(`naloga ni zacela: ${(e as Error).message.slice(0, 300)}`);
        throw new Napaka(503, "claude-code-ni", "Seja Claude Code naloge ni sprejela ali ni dosegljiva.");
      }
    })();
    rez.izid.catch(() => undefined);
    try {
      await rez.izid;
    } finally {
      this.zacenja.delete(id);
    }
    // /ustavi, ki se je razresil po oddaji v sejo (zacni ze koncan, ta nadaljevanje se ne): naloga se ustavi takoj
    if (rez.ustavi) await this.ustaviPozneje(id, rez.ustavi);
    return { status: 202, telo: { id } };
  }

  /**
   * CRR3-3: telefon je za /ustavi ze dobil 202 in ga ne poslje vec - neuspela ustavitev (seja se znova povezuje) se ponavlja, dokler
   * ne uspe, streznik tece, naloga obstaja IN podpis telefona se velja (OKNO_PODPISA_MS: starejsega kanal zavrne, naloga bi tekla naprej,
   * Lina pa bi jo stela za ustavljeno). Napaka gre v dnevnik enkrat, opustitev tudi.
   */
  private async ustaviPozneje(id: string, dokaz: Dokaz, prvic = true): Promise<void> {
    try {
      await this.m.izvajalec.ustavi(id, dokaz);
    } catch (e) {
      if (prvic) this.dnevnik(`ustavitev po zacetku ni uspela: ${(e as Error).message.slice(0, 300)}`);
      setTimeout(() => {
        if (!this.streznik || !this.naloge.has(id)) return;
        // okno se preveri ob poskusu (tudi po spanju racunalnika) in v obe smeri ure, kot kanal (slepi pregled 26r krog 3, K3-3)
        if (Math.abs(this.zdaj() - dokaz.cas) >= OKNO_PODPISA_MS) {
          this.dnevnik("ustavitev po zacetku opuscena: podpis telefona je za kanal prestar");
          return;
        }
        void this.ustaviPozneje(id, dokaz, false);
      }, ponovitevUstavitve.ms).unref?.();
    }
  }

  /** Naloga 25 N3b: grob preklicanih id (samo ta naprava, rok ROK_GROBA_MS, omejeno na napravo in skupaj). */
  private vGrobu(posiljatelj: string, id: string): boolean {
    const t = this.zdaj();
    for (const [k, v] of this.grob) if (t - v > ROK_GROBA_MS) this.grob.delete(k);
    return this.grob.has(`${posiljatelj}\n${id}`);
  }

  private vGrob(posiljatelj: string, id: string): void {
    const kljuc = `${posiljatelj}\n${id}`;
    this.vGrobu(posiljatelj, id);
    this.grob.delete(kljuc);
    const predpona = `${posiljatelj}\n`;
    const svoji = [...this.grob.keys()].filter((k) => k.startsWith(predpona));
    // najprej izrine najstarejse iste naprave, tako da ena naprava ne izrine groba druge
    for (const k of svoji.slice(0, Math.max(0, svoji.length - NAJVEC_GROB_NA_NAPRAVO + 1))) this.grob.delete(k);
    while (this.grob.size >= NAJVEC_GROB) this.grob.delete(this.grob.keys().next().value as string);
    this.grob.set(kljuc, this.zdaj());
  }

  private dogodek(id: string, d: Dogodek): void {
    const n = this.naloge.get(id);
    if (!n) return;
    if (d.vrsta === "odobritev" && d.zgostitev) n.odprte.set(d.zahtevaId, d.zgostitev);
    if (d.vrsta === "izid") n.koncano = true;
    // Claude Code je po koncu znova odgovoril (lastnik v terminalu): naloga je spet v teku, telefon jo spremlja naprej
    else if (d.vrsta === "stanje" && d.tip && n.koncano) { n.koncano = false; n.cas = this.zdaj(); }
    if (n.dogodki.length >= NAJVEC_DOGODKOV) n.dogodki.shift();
    const st = (n.dogodki.at(-1)?.st ?? 0) + 1;
    n.dogodki.push({ ...d, st } as DogodekTelefona);
    for (const c of n.cakajo) c();
    n.cakajo.clear();
  }

  private async odobritev(t: Record<string, unknown>) {
    const { nalogaId, zahtevaId, dovoli, posiljatelj } = t;
    if (typeof nalogaId !== "string" || typeof zahtevaId !== "string" || !ID_ODOBRITVE.test(zahtevaId) || typeof dovoli !== "boolean") {
      throw new Napaka(400, "oblika", "Manjka nalogaId, zahtevaId ali dovoli.");
    }
    const n = this.naloge.get(nalogaId);
    const zg = n?.odprte.get(zahtevaId);
    // odobri samo naprava, ki je dala nalogo, in samo zahtevo, ki je bila tej nalogi poslana; podpis vezan na prikazano
    if (!n || !zg || n.posiljatelj !== posiljatelj) throw zavrnjeno();
    const dokaz = await this.preveri(posiljatelj, t, (c, e) => nizOdobritve(zahtevaId, dovoli, posiljatelj as string, c, e, nalogaId, zg));
    n.odprte.delete(zahtevaId);
    if (dovoli && typeof t.podobnePodpis === "string") await this.dovoliPodobne(n, nalogaId, zahtevaId, zg, posiljatelj as string, dokaz, t.podobnePodpis);
    await this.m.izvajalec.odobri(nalogaId, zahtevaId, dovoli, posiljatelj as string, dokaz, zg);
    return { status: 202, telo: { zahtevaId } };
  }

  /**
   * »Velja tudi za vse podobne« pri odobritvi zahteve Claude Code (lastnik 24. 11. 2026): samo za program (en preprost ukaz
   * cli-anything-<ime>) ali dodatek, samo z LOCENIM podpisom naprave (nizDovoljenjaOdobritve: isti cas, enkratni niz in zgostitev prikaza),
   * ki ga je glavni podpis ze omejil na to napravo in to nalogo. Shrani se s prikazom, da ga kanal in Lina ob vsaki uporabi preverita znova.
   */
  private async dovoliPodobne(n: NalogaTelefona, nalogaId: string, zahtevaId: string, zg: string, posiljatelj: string, dokaz: Dokaz, podpis: string): Promise<void> {
    if (podpis.length > 200) return;
    const d = [...n.dogodki].reverse().find((x) => x.vrsta === "odobritev" && x.zahtevaId === zahtevaId);
    if (!d || d.vrsta !== "odobritev" || zgostitevPrikaza(d.orodje, d.predogled, d.opis) !== zg) return;
    const obseg = obsegIzPrikaza(d.orodje, d.predogled);
    const kljuc = (await this.kanal()).dovoljene.get(posiljatelj);
    if (!obseg || !kljuc || !preveriPodpisNaprave(kljuc, nizDovoljenjaOdobritve(posiljatelj, zahtevaId, nalogaId, zg, dokaz.cas, dokaz.enkratni), podpis)) return;
    await zapisiDovoljenje(this.m.root, obseg.vrsta, obseg.obseg, {
      kdo: "naprava", naprava: posiljatelj, dokaz: { cas: dokaz.cas, enkratni: dokaz.enkratni, podpis },
      prikaz: { zahtevaId, chatId: nalogaId, orodje: d.orodje, predogled: d.predogled, opis: d.opis },
    }).catch(() => undefined);
  }

  private async ustavitev(t: Record<string, unknown>) {
    const { id, posiljatelj } = t;
    if (typeof id !== "string" || !ID_NALOGE_TELEFONA.test(id)) throw zavrnjeno();
    const tuja = () => {
      const lastnik = this.zacenja.get(id)?.posiljatelj ?? this.naloge.get(id)?.posiljatelj;
      return lastnik !== undefined && lastnik !== posiljatelj;
    };
    // naloga druge naprave: 403 brez groba (kot prej, poceni pred podpisom)
    if (tuja()) throw zavrnjeno();
    const dokaz = await this.preveri(posiljatelj, t, (c, e) => nizUstavitve(id, posiljatelj as string, c, e));
    if (tuja()) throw zavrnjeno();
    const z = this.zacenja.get(id);
    const n = this.naloge.get(id);
    if (z) {
      // N6c/d: /naloga se obdeluje - ne zacne se (ali se ustavi takoj po zacni); grob za ponovljen POST
      z.ustavi = dokaz;
      // slepi 27r S1: naloga je lahko ze v this.naloge (zacni tece) - /nadaljuj do konca zacni ne sme mimo
      if (n) n.ustavljena = true;
      this.vGrob(posiljatelj as string, id);
    } else if (n) {
      await this.m.izvajalec.ustavi(id, dokaz);
      // slepi 27r S2: samo po uspehu (ob napaki telefon ne dobi 202 in naloga tece)
      n.ustavljena = true;
    }
    else {
      // N3b: naloga se ni prisla (zadrzan POST) - podpisan preklic se zapomni; ni zavrnitev (N5), zato 202 in ne 403
      this.vGrob(posiljatelj as string, id);
      this.dnevnik("ustavitev pred nalogo: id v grobu preklicanih");
    }
    return { status: 202, telo: { id } };
  }

  /**
   * POST /nadaljuj {"id","posiljatelj","besedilo","cas","enkratni","podpis"} -> 202 {"id"}: odgovor ali navodilo v ISTO nalogo
   * (lastnik 23. 11. 2026 »Lina sama odgovori Claude Code«). Samo naprava, ki je nalogo dala; podpis nizNadaljevanja.
   */
  private async nadaljevanje(t: Record<string, unknown>) {
    const { id, posiljatelj, besedilo } = t;
    const n = typeof id === "string" ? this.naloge.get(id) : undefined;
    if (typeof besedilo !== "string" || !besedilo.trim() || besedilo.length > NAJVEC_ZNAKOV || !praviUnicode(besedilo)) {
      throw new Napaka(400, "oblika", "Besedilo je prazno, predolgo ali ni veljaven Unicode.");
    }
    if (!n || n.posiljatelj !== posiljatelj) throw zavrnjeno();
    const dokaz = await this.preveri(posiljatelj, t, (c, e) => nizNadaljevanja(id as string, posiljatelj as string, besedilo, c, e));
    // CRR4-1: zakasnjena ponovitev ustavitve bi sicer ustavila sprejeto nadaljevanje; kot kanal (p.ustavljen) - ustavljena se ne nadaljuje
    if (n.ustavljena) throw new Napaka(409, "ni-v-teku", "Naloga ni v teku ali nadaljevanje ni dovoljeno.");
    if (!this.m.izvajalec.nadaljuj) throw new Napaka(501, "ni-podprto", "Izvajalec ne podpira odgovora v nalogo.");
    try {
      await this.m.izvajalec.nadaljuj(id as string, besedilo, posiljatelj as string, dokaz);
    } catch (e) {
      // kot zgoraj (A-17): podrobnost samo v dnevnik
      this.dnevnik(`nadaljevanje ni sprejeto: ${(e as Error).message.slice(0, 300)}`);
      throw new Napaka(409, "ni-v-teku", "Naloga ni v teku ali nadaljevanje ni dovoljeno.");
    }
    if (n.koncano) { n.koncano = false; n.cas = this.zdaj(); }
    return { status: 202, telo: { id } };
  }

  private async dogodki(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const q = url.searchParams;
    const id = q.get("id") ?? "";
    const od = Number(q.get("od") ?? "0");
    const caka = Math.min(NAJDLJE_CAKA_S, Math.max(0, Number(q.get("caka") ?? "0") || 0));
    const naslov = this.viri.get(req) ?? req.socket.remoteAddress ?? "";
    if (!ID_NALOGE_TELEFONA.test(id)) {
      this.neznan(naslov);
      throw new Napaka(404, "ni", "Ni take naloge.");
    }
    // T1-N3: dogodke (orodje, predogled ukazov in poti, izid) bere samo naprava, ki je dala nalogo, s podpisom kot pri /stanje
    const posiljatelj = q.get("posiljatelj");
    await this.preveri(posiljatelj, { cas: Number(q.get("cas")), enkratni: q.get("enkratni") ?? "", podpis: q.get("podpis") ?? "" },
      (c, e) => nizDogodkov(id, posiljatelj as string, c, e));
    const n = this.naloge.get(id);
    if (!n || n.posiljatelj !== posiljatelj) {
      this.neznan(naslov);
      throw new Napaka(404, "ni", "Ni take naloge.");
    }
    if (!Number.isSafeInteger(od) || od < 0) throw new Napaka(400, "oblika", "od mora biti nenegativno celo stevilo.");
    const nova = () => n.dogodki.filter((d) => d.st > od);
    if (!nova().length && !n.koncano && caka > 0) {
      await new Promise<void>((ok) => {
        const t = setTimeout(() => { n.cakajo.delete(koncaj); ok(); }, caka * 1000);
        const koncaj = () => { clearTimeout(t); ok(); };
        n.cakajo.add(koncaj);
        req.once("close", koncaj);
      });
    }
    // SR-8: odgovor ne sme preseci meje, ki jo telefon sprejme (64 KiB): vec dogodkov gre v naslednjem odgovoru (st napreduje),
    // »koncano« velja samo, ce so poslani vsi.
    const vsi = nova();
    const poslani = dogodkiDoMeje(vsi, NAJVEC_ODGOVOR_DOGODKOV_B);
    this.poslji(res, 200, { dogodki: poslani, koncano: n.koncano && poslani.length === vsi.length });
  }

  /**
   * Seznanjanje: telefon prinese javni kljuc, id (izpeljan iz kljuca), ime in podpis niza z enkratno kodo iz QR. Lina prijavo
   * samo zapise za lastnika; v seznam naprav jo doda SAMO lastnik z gumbom na racunalniku.
   */
  private async seznani(t: Record<string, unknown>) {
    const { koda, id, kljuc, ime } = t;
    if (typeof koda !== "string" || !KODA_SEZNANITVE.test(koda)) throw new Napaka(400, "oblika", "Neveljavna koda.");
    if (typeof id !== "string" || !veljavenKljucNaprave(kljuc) || !idPripadaKljucu(id, kljuc)) throw new Napaka(400, "oblika", "Kljuc ali id naprave ni veljaven.");
    if (!imeNaprave(ime)) {
      throw new Napaka(400, "oblika", "Ime naprave ima 1-60 znakov brez nadzornih znakov.");
    }
    if (this.m.seznanitve?.stanje(koda) !== "odprta") throw zavrnjeno();
    // T1-N10: kot pri kodi (kodaZacni): id, ki je ze na seznamu, se ne prijavlja znova (trk 64-bitnega id-ja ne prepise kljuca)
    if ((await this.kanal()).dovoljene.has(id)) throw new Napaka(409, "id_zaseden", "Naprava je ze na seznamu.");
    this.preveriSKljucem(kljuc, t, (c, e) => nizSeznanitve(koda, id, kljuc, ime, c, e));
    if (!this.m.seznanitve.prijavi(koda, { id, kljuc, ime: ime.trim() })) throw zavrnjeno();
    return { status: 202, telo: { stanje: "caka" } };
  }

  private seznanjanjeSKodo(): SeznanitevSKodo {
    if (!this.m.koda || !this.m.seznanitve?.prijaviPoKodi) throw new Napaka(404, "ni", "Ni take poti.");
    return this.m.koda;
  }

  /** Telefon zacne seznanjanje s kodo (kot /cast/pair/start v Linku); okno mora odpreti lastnik. */
  private async kodaZacni(vir: string, t: Record<string, unknown>) {
    const k = this.seznanjanjeSKodo();
    const { id, ime, kodaNaTelefonu } = t;
    if (typeof id !== "string" || !ID_NAPRAVE.test(id)) throw new Napaka(400, "oblika", "Neveljaven id naprave.");
    if (!imeNaprave(ime)) throw new Napaka(400, "oblika", "Ime naprave ima 1-60 znakov brez nadzornih znakov.");
    if (kodaNaTelefonu !== undefined && typeof kodaNaTelefonu !== "boolean") throw new Napaka(400, "oblika", "kodaNaTelefonu je true ali false.");
    if ((await this.kanal()).dovoljene.has(id)) throw new Napaka(409, "id_zaseden", "Naprava je ze na seznamu.");
    return { status: 200, telo: k.zacni(vir, id, ime.trim(), kodaNaTelefonu === true) };
  }

  /** En krog SPAKE2 (kot /cast/pair/spake): pb -> pa, ca. */
  private kodaSpake(t: Record<string, unknown>) {
    const k = this.seznanjanjeSKodo();
    const { pair_id, id, pb } = t;
    if (typeof pair_id !== "string" || !PAIR_ID.test(pair_id) || typeof id !== "string" || !ID_NAPRAVE.test(id)) throw new Napaka(400, "oblika", "Neveljaven pair_id ali id.");
    if (typeof pb !== "string" || !/^([0-9a-f]{66}|[0-9a-f]{130})$/.test(pb)) throw new Napaka(400, "neveljavna_tocka", "pb je tocka P-256 v hex (33 ali 65 B).");
    const { pa, ca } = k.spake(pair_id, id, Buffer.from(pb, "hex"));
    return { status: 200, telo: { pa: pa.toString("hex"), ca: ca.toString("hex") } };
  }

  /** Telefon je cA zavrnil: krog je neuspel, v nacinu B lastnik kodo vtipka znova (namesto cakanja ROK_POTRDI_MS). */
  private kodaOdpovej(t: Record<string, unknown>) {
    const k = this.seznanjanjeSKodo();
    const { pair_id, id } = t;
    if (typeof pair_id !== "string" || !PAIR_ID.test(pair_id) || typeof id !== "string" || !ID_NAPRAVE.test(id)) throw new Napaka(400, "oblika", "Neveljaven pair_id ali id.");
    k.odpovej(pair_id, id);
    return { status: 200, telo: { stanje: "odpovedano" } };
  }

  /**
   * Potrditev cb (kot /cast/pair/finish) in prijava kljuca naprave: podpis niza seznanitve s kljucem, ki ga telefon prinasa,
   * in MAC kljuca s skupnim Ke. Izid je enak kot s QR: prijava caka na lastnikov »Dodaj«.
   */
  private async kodaPotrdi(t: Record<string, unknown>) {
    const k = this.seznanjanjeSKodo();
    const { pair_id, id, kljuc, ime, cb, mac } = t;
    if (typeof pair_id !== "string" || !PAIR_ID.test(pair_id)) throw new Napaka(400, "oblika", "Neveljaven pair_id.");
    if (typeof id !== "string" || !veljavenKljucNaprave(kljuc) || !idPripadaKljucu(id, kljuc)) throw new Napaka(400, "oblika", "Kljuc ali id naprave ni veljaven.");
    if (!imeNaprave(ime)) throw new Napaka(400, "oblika", "Ime naprave ima 1-60 znakov brez nadzornih znakov.");
    if (typeof cb !== "string" || !/^[0-9a-f]{64}$/.test(cb) || typeof mac !== "string" || !/^[0-9a-f]{64}$/.test(mac)) throw new Napaka(400, "oblika", "cb in mac sta 32 B v hex.");
    this.preveriSKljucem(kljuc, t, (c, e) => nizSeznanitve(pair_id, id, kljuc, ime, c, e));
    if ((await this.kanal()).dovoljene.has(id)) throw new Napaka(409, "id_zaseden", "Naprava je ze na seznamu.");
    k.potrdi(pair_id, id, kljuc, Buffer.from(cb, "hex"), Buffer.from(mac, "hex"));
    // T1-S1: pot klicev OpenLine telefon dobi SELE po lastnikovem »Dodaj« (POST /seznani/klici), ne tu
    if (!this.m.seznanitve!.prijaviPoKodi!(pair_id, { id, kljuc, ime: ime.trim() })) throw zavrnjeno();
    return { status: 202, telo: { stanje: "caka" } };
  }

  /**
   * Po lastnikovem »Dodaj« telefon s podpisom (nizKlici) prevzame razdelek poti klicev OpenLine. Naprava mora biti ze v seznamu
   * kanala, prijava mora biti sprejeta in ista naprava; sicer 403/404 - kdor kodo le vidi ali ugane, do OpenLine ne pride.
   */
  private async klici(t: Record<string, unknown>) {
    const { koda, id } = t;
    if (typeof koda !== "string" || !KODA_SEZNANITVE.test(koda)) throw new Napaka(400, "oblika", "Neveljavna koda.");
    await this.preveri(id, t, (c, e) => nizKlici(koda, id as string, c, e));
    const k = this.m.seznanitve?.klici?.(koda, id as string);
    if (k === undefined) throw new Napaka(404, "ni", "Prijava ni sprejeta.");
    return { status: 200, telo: { klici: k } };
  }

  /**
   * Sinhronizacija telefona (klici, pogovor, navodila) z racunalnikom po parjenju. Podpis (nizSinhron) pokriva SHA-256 celotne vsebine,
   * zato je ni mogoce spremeniti ali ponoviti; pot ni na belem seznamu oddaljenih poti (samo domace omrezje). Neveljavna vsebina = 400.
   */
  private async sinhron(t: Record<string, unknown>) {
    const { posiljatelj, vsebina } = t;
    if (typeof vsebina !== "string" || !praviUnicode(vsebina)) throw new Napaka(400, "oblika", "Manjka vsebina sinhronizacije.");
    await this.preveri(posiljatelj, t, (c, e) => nizSinhron(posiljatelj as string, c, e, zgostitevSinhron(vsebina)));
    let zahteva;
    try {
      zahteva = preveriZahtevo(JSON.parse(vsebina), this.zdaj());
    } catch (e) {
      if (e instanceof NapakaSinhron || e instanceof SyntaxError) throw new Napaka(400, "oblika", "Vsebina sinhronizacije ni veljavna.");
      throw e;
    }
    // samo stevilo: id, stevilka in ime klica ne gredo v dnevnik (21t A8)
    if (zahteva.preskoceniPrihodnost) this.dnevnik(`sinhronizacija: preskocenih zapisov klicev s casom vec kot dan v prihodnosti: ${zahteva.preskoceniPrihodnost}`);
    return { status: 200, telo: await izmenjajSinhron(zahteva, this.m.root, { zdaj: this.zdaj }) };
  }

  private sprejemSlike = false;

  /**
   * Fotografija za kontrolo tiska s telefona s seznama (podpis kot sinhron): samo SHRANI v mapo prejetih; nic se ne izmeri in ne
   * poslje samo - lastnik jo izbere v Lini. Ni na seznamu oddaljenih poti (POTI_ODDALJENO), samo domace omrezje.
   */
  private async slikaKontrole(req: IncomingMessage) {
    const glava = (ime: string) => {
      const v = req.headers[ime];
      return typeof v === "string" ? v : "";
    };
    const tip = glava("content-type").split(";")[0].trim().toLowerCase();
    if (tip !== "image/jpeg" && tip !== "image/png") throw new Napaka(415, "tip", "Telo mora biti image/jpeg ali image/png.");
    const dolzina = Number(glava("content-length") || "0");
    if (dolzina > NAJVEC_TELO_SLIKA) throw new Napaka(413, "prevelik", "Telo je preveliko.");
    const zgostitev = glava("x-lina-zgostitev");
    if (!/^[a-f0-9]{64}$/.test(zgostitev)) throw new Napaka(400, "oblika", "Manjka zgostitev slike.");
    const posiljatelj = glava("x-lina-posiljatelj");
    const t = { cas: Number(glava("x-lina-cas")), enkratni: glava("x-lina-enkratni"), podpis: glava("x-lina-podpis") };
    // podpis (naprava s seznama, okno, enkratni niz) PRED branjem telesa: tujec ne zasede sprejema in ne porabi pomnilnika
    await this.preveri(posiljatelj, t, (c, e) => nizSlikeKontrole(posiljatelj, c, e, zgostitev));
    if (this.sprejemSlike) throw new Napaka(429, "prevec", "Sprejem slike ze tece.");
    this.sprejemSlike = true;
    try {
      const kosi: Buffer[] = [];
      const h = createHash("sha256");
      let n = 0;
      for await (const k of req) {
        n += (k as Buffer).length;
        if (n > NAJVEC_TELO_SLIKA) throw new Napaka(413, "prevelik", "Telo je preveliko.");
        h.update(k as Buffer);
        kosi.push(k as Buffer);
      }
      if (h.digest("hex") !== zgostitev) throw new Napaka(403, "zavrnjeno", "Slika se ne ujema s podpisom.");
      const { shraniPrejetoSliko } = await import("./kontrola-tiska.server.ts");
      const izid = await shraniPrejetoSliko(this.m.root, Buffer.concat(kosi));
      if (!izid.ok) {
        if (izid.razlog === "polno") throw new Napaka(507, izid.razlog, "Mapa prejetih slik je polna; lastnik jo izprazni v Kontroli tiska.");
        if (izid.razlog === "prevelika") throw new Napaka(413, izid.razlog, "Slika ima več kot 60 milijonov točk.");
        throw new Napaka(415, izid.razlog, "Samo JPEG ali PNG.");
      }
      return { sprejeto: true, id: izid.id };
    } finally {
      this.sprejemSlike = false;
    }
  }

  private stanjeSeznanitve(req: IncomingMessage, url: URL) {
    const koda = url.searchParams.get("koda") ?? "";
    const st = KODA_SEZNANITVE.test(koda) ? this.m.seznanitve?.stanje(koda) ?? null : null;
    if (!st) {
      this.neznan(req.socket.remoteAddress ?? "");
      throw new Napaka(404, "ni", "Ni take seznanitve.");
    }
    return { stanje: st };
  }

  /** Stanje seje Claude Code za napravo s seznama (podpisana poizvedba, telefon jo poslje pred nalogo in med cakanjem). */
  private async stanjeSeje(url: URL) {
    const q = url.searchParams;
    const posiljatelj = q.get("posiljatelj");
    const t = { cas: Number(q.get("cas")), enkratni: q.get("enkratni") ?? "", podpis: q.get("podpis") ?? "" };
    await this.preveri(posiljatelj, t, (c, e) => nizStanja(posiljatelj as string, c, e));
    const odprta = await this.m.izvajalec.razpolozljiv().catch(() => false);
    // id Line na releju samo podpisani napravi in samo, ce je Global Link vklopljen (telefon ga shrani za pot od zunaj)
    const rele = this.m.omogociOddaljeno ? this.m.rele?.() ?? null : null;
    // naloga 34: obremenitev za razdelitev nalog; napaka pri branju ne podre /stanje (polje se izpusti = telefon: neznano)
    let racunalnik: ObremenitevRacunalnika | undefined;
    try { racunalnik = (this.m.obremenitev ?? obremenitevRacunalnika)(); } catch { racunalnik = undefined; }
    return { claudeCode: odprta ? "odprta" : "zaprta", ...(rele ? { rele } : {}), ...(racunalnik ? { racunalnik } : {}) };
  }

  private dodatkiStreznika() {
    if (!this.m.dodatki) throw new Napaka(404, "ni", "Ni take poti.");
    return this.m.dodatki;
  }

  /** Stanje dodatkov na racunalniku (podpisana poizvedba kot /stanje); samo branje, nic ne zazene. */
  private async stanjeDodatkov(url: URL) {
    const d = this.dodatkiStreznika();
    const q = url.searchParams;
    const posiljatelj = q.get("posiljatelj");
    const t = { cas: Number(q.get("cas")), enkratni: q.get("enkratni") ?? "", podpis: q.get("podpis") ?? "" };
    await this.preveri(posiljatelj, t, (c, e) => nizStanjaDodatkov(posiljatelj as string, c, e));
    return await d.stanje();
  }

  /** Vklop ali izklop enega dodatka: podpis veze napravo, dodatek in smer (nizDodatka); vrne novo stanje vseh dodatkov. */
  private async dodatek(t: Record<string, unknown>) {
    const d = this.dodatkiStreznika();
    const { posiljatelj, dodatek, vklop } = t;
    if (!jeDodatekTelefona(dodatek) || typeof vklop !== "boolean") throw new Napaka(400, "oblika", "Neznan dodatek ali vklop ni true/false.");
    await this.preveri(posiljatelj, t, (c, e) => nizDodatka(posiljatelj as string, dodatek, vklop, c, e));
    return { status: 200, telo: await d.nastavi(dodatek, vklop) };
  }

  private n8nStreznika() {
    if (!this.m.dodatki?.n8n) throw new Napaka(404, "ni", "Ni take poti.");
    return this.m.dodatki.n8n;
  }

  /** Stanje in seznam n8n tokov za napravo ozjega kroga (samo branje, podpisana poizvedba). */
  private async stanjeN8n(url: URL) {
    const n = this.n8nStreznika();
    const { posiljatelj, t } = this.podpisPoizvedbe(url);
    await this.preveri(posiljatelj, t, (c, e) => nizN8nStanja(posiljatelj as string, c, e));
    return await this.zaledjeGradenj(() => n.stanje());
  }

  /** Predlog ustvarjanja ali zagona n8n toka s telefona: nic se ne izvede pred potrditvijo. */
  private async predlogN8n(t: Record<string, unknown>) {
    const n = this.n8nStreznika();
    const { posiljatelj, vrsta, cilj, ime } = t;
    if ((vrsta !== "ustvari" && vrsta !== "zazeni") || typeof cilj !== "string" || !cilj.trim() || cilj.length > 400
      || (ime !== undefined && (typeof ime !== "string" || ime.length > 80))) {
      throw new Napaka(400, "oblika", "Manjka vrsta (ustvari/zazeni) ali cilj/opis.");
    }
    const imeStr = typeof ime === "string" ? ime : "";
    const zg = zgostitevN8nPredlogaVnos(vrsta, cilj, imeStr);
    await this.preveri(posiljatelj, t, (c, e) => nizN8nPredloga(posiljatelj as string, vrsta, zg, c, e));
    const p = await this.zaledjeGradenj(() => n.predlog(vrsta, cilj, imeStr || undefined));
    return { status: 202, telo: p };
  }

  /** Potrditev ali preklic predloga n8n s telefona: podpis veze id, dovoli in zgostitev predloga. */
  private async potrdiN8n(t: Record<string, unknown>) {
    const n = this.n8nStreznika();
    const { posiljatelj, id, zgostitev, dovoli } = t;
    if (typeof id !== "string" || !/^[a-f0-9]{16}$/.test(id)
      || typeof zgostitev !== "string" || !/^[a-f0-9]{64}$/.test(zgostitev)
      || typeof dovoli !== "boolean") {
      throw new Napaka(400, "oblika", "Neveljaven id, zgostitev ali dovoli.");
    }
    await this.preveri(posiljatelj, t, (c, e) => nizN8nPotrditve(posiljatelj as string, id, dovoli, zgostitev, c, e));
    return { status: 200, telo: await this.zaledjeGradenj(() => n.potrdi(id, zgostitev, dovoli)) };
  }

  private gradnjeStreznika() {
    if (!this.m.gradnje) throw new Napaka(404, "ni", "Ni take poti.");
    return this.m.gradnje;
  }

  /** Napaka zaledja gradenj (stalna koda razlog) -> 409; besedilo napake ne gre telefonu. */
  private async zaledjeGradenj<T>(delo: () => Promise<T>): Promise<T> {
    try {
      return await delo();
    } catch (e) {
      const r = (e as { razlog?: unknown }).razlog;
      if (typeof r === "string" && /^[a-z-]{1,30}$/.test(r)) throw new Napaka(409, r, "Gradnja ni mogoca.");
      throw e;
    }
  }

  private podpisPoizvedbe(url: URL) {
    const q = url.searchParams;
    return { posiljatelj: q.get("posiljatelj"), t: { cas: Number(q.get("cas")), enkratni: q.get("enkratni") ?? "", podpis: q.get("podpis") ?? "" } };
  }

  private agentiNalogStreznika() {
    if (!this.m.agentiNaloge) throw new Napaka(404, "ni", "Ni take poti.");
    return this.m.agentiNaloge;
  }

  /** Vrsta nalog agentov (podpisana poizvedba); samo branje. */
  private async stanjeAgentNalog(url: URL) {
    const a = this.agentiNalogStreznika();
    const { posiljatelj, t } = this.podpisPoizvedbe(url);
    await this.preveri(posiljatelj, t, (c, e) => nizStanjaAgentNalog(posiljatelj as string, c, e));
    return await this.zaledjeGradenj(() => a.stanje());
  }

  /** Dodelitev s telefona: podpis veze zgostitev (agent, mapa, besedilo, pogoj); zaledje preveri agenta, mapo, prepovedane mape in pogoj. */
  private async dodeliAgentNalogo(t: Record<string, unknown>) {
    const a = this.agentiNalogStreznika();
    const { posiljatelj, agent, mapa, besedilo, pogoj } = t;
    if (typeof agent !== "string" || typeof mapa !== "string" || typeof besedilo !== "string" || typeof pogoj !== "string"
      || agent.length > 20 || mapa.length > 512 || besedilo.length > 8000 || pogoj.length > 40) throw new Napaka(400, "oblika", "Manjka agent, mapa, besedilo ali pogoj.");
    await this.preveri(posiljatelj, t, (c, e) => nizDodelitveAgentNaloge(posiljatelj as string, zgostitevDodelitve(agent, mapa, besedilo, pogoj), c, e));
    const z = await this.zaledjeGradenj(() => a.dodeli(agent, mapa, besedilo, pogoj));
    return { status: 202, telo: { id: z.id } };
  }

  /** Preklic dodeljene naloge s telefona: podpis veze id. */
  private async prekliciAgentNalogo(t: Record<string, unknown>) {
    const a = this.agentiNalogStreznika();
    const { posiljatelj, id } = t;
    if (typeof id !== "string" || !/^[a-f0-9]{16}$/.test(id)) throw new Napaka(400, "oblika", "Neveljaven id.");
    await this.preveri(posiljatelj, t, (c, e) => nizPreklicaAgentNaloge(posiljatelj as string, id, c, e));
    await this.zaledjeGradenj(() => a.preklici(id));
    return { status: 202, telo: { id } };
  }

  private vprasanjaStreznika() {
    if (!this.m.vprasanjaAgentov) throw new Napaka(404, "ni", "Ni take poti.");
    return this.m.vprasanjaAgentov;
  }

  /** Vprasanja agentov in zadnje vrstice dela (podpisana poizvedba); samo branje. */
  private async stanjeVprasanjAgentov(url: URL) {
    const a = this.vprasanjaStreznika();
    const { posiljatelj, t } = this.podpisPoizvedbe(url);
    await this.preveri(posiljatelj, t, (c, e) => nizStanjaVprasanj(posiljatelj as string, c, e));
    return await a.stanje();
  }

  /** Odgovor s telefona: podpis veze id, odlocitev (dovoli/zavrni) in zgostitev prikazanega; velja enkrat, samo za odprto vprasanje. */
  private async odgovorVprasanjaAgenta(t: Record<string, unknown>) {
    const a = this.vprasanjaStreznika();
    const { posiljatelj, id, odlocitev, zgostitev } = t;
    if (typeof id !== "string" || !/^[a-f0-9]{16}$/.test(id) || (odlocitev !== "dovoli" && odlocitev !== "zavrni")
      || typeof zgostitev !== "string" || !/^[a-f0-9]{64}$/.test(zgostitev)) throw new Napaka(400, "oblika", "Neveljaven id, odlocitev ali zgostitev.");
    await this.preveri(posiljatelj, t, (c, e) => nizOdgovoraVprasanja(posiljatelj as string, id, odlocitev, zgostitev, c, e));
    await this.zaledjeGradenj(() => a.odgovori(id, odlocitev, zgostitev, posiljatelj as string));
    return { status: 202, telo: { id } };
  }

  /** Stanje gradenj (podpisana poizvedba); samo branje. */
  private async stanjeGradenj(url: URL) {
    const g = this.gradnjeStreznika();
    const { posiljatelj, t } = this.podpisPoizvedbe(url);
    await this.preveri(posiljatelj, t, (c, e) => nizStanjaGradenj(posiljatelj as string, c, e));
    return await this.zaledjeGradenj(() => g.stanje());
  }

  /** Predlog s telefona: podpis veze tok in vejo; nicesar ne zazene (zagon je posebna potrditev). */
  private async predlogGradnje(t: Record<string, unknown>) {
    const g = this.gradnjeStreznika();
    const { posiljatelj, tok, veja } = t;
    if (typeof tok !== "string" || typeof veja !== "string" || tok.length > 40 || veja.length > 120) throw new Napaka(400, "oblika", "Manjka tok ali veja.");
    await this.preveri(posiljatelj, t, (c, e) => nizPredlogaGradnje(posiljatelj as string, tok, veja, c, e));
    // dovoljenje za podobne velja samo za napravo, ki ga je dala, in dokler je v ozjem krogu (kljuci iz kanal-claude.json)
    const kljuci = (await this.kanal()).dovoljene;
    const p = await this.zaledjeGradenj(() => g.predlog(tok, veja, { naprava: posiljatelj as string, kljuci }));
    // stanje: »caka« = telefon pokaze potrditev; drugo = zagnano po dovoljenju za podobne (druga potrditev ni potrebna)
    return { status: 202, telo: { id: p.id, zgostitev: p.zgostitev, stanje: p.stanje ?? "caka" } };
  }

  /** Potrditev zagona s telefona: podpis veze id predloga in zgostitev (repozitorij, tok, veja). */
  private async potrdiGradnjo(t: Record<string, unknown>) {
    const g = this.gradnjeStreznika();
    const { posiljatelj, id, zgostitev } = t;
    if (typeof id !== "string" || !/^[a-f0-9]{16}$/.test(id) || typeof zgostitev !== "string" || !/^[a-f0-9]{64}$/.test(zgostitev)) throw new Napaka(400, "oblika", "Neveljaven id ali zgostitev.");
    await this.preveri(posiljatelj, t, (c, e) => nizPotrditveGradnje(posiljatelj as string, id, zgostitev, c, e));
    // »Velja tudi za vse podobne« (privzeto obkljukano na telefonu): LOCEN podpis nad tokom in vejo z istim casom in enkratnim nizom;
    // brez njega (ali z neveljavnim) je potrditev enkratna kot prej. Neoznaceno polje v telesu brez podpisa ne pomeni nicesar.
    const pp = t.podobnePodpis;
    const kljuc = typeof pp === "string" && pp.length <= 200 ? (await this.kanal()).dovoljene.get(posiljatelj as string) : undefined;
    const podobne = kljuc ? { naprava: posiljatelj as string, kljuc, cas: t.cas as number, enkratni: t.enkratni as string, podpis: pp as string } : undefined;
    await this.zaledjeGradenj(() => g.potrdi(id, zgostitev, podobne));
    return { status: 202, telo: { id } };
  }

  /**
   * APK zadnje potrjene gradnje: datoteka se odpre brez sledenja povezavi, vsota se izracuna iz ISTE odprte datoteke in mora biti
   * enaka zapisani; sele nato se poslje (brez Range). Glave: x-lina-sha256, x-lina-paket, x-lina-gradnja, content-length.
   */
  private async apkGradnje(url: URL, res: ServerResponse): Promise<void> {
    const g = this.gradnjeStreznika();
    const { posiljatelj, t } = this.podpisPoizvedbe(url);
    await this.preveri(posiljatelj, t, (c, e) => nizApkGradnje(posiljatelj as string, c, e));
    const a = await g.apk();
    if (!a) throw new Napaka(404, "ni", "Ni potrjene gradnje APK.");
    let ds;
    try {
      // O_NONBLOCK: FIFO na poti ne obvisi ze ob odpiranju (pregled 0225 A-16); za navadno datoteko nima ucinka
      ds = await open(a.pot, fsKonstante.O_RDONLY | (fsKonstante.O_NOFOLLOW ?? 0) | (fsKonstante.O_NONBLOCK ?? 0));
    } catch {
      throw new Napaka(404, "ni", "Ni potrjene gradnje APK.");
    }
    try {
      // vrsta in velikost se preverita PRED branjem (A-16): FIFO, naprava ali spremenjena datoteka se ne bere
      const st = await ds.stat();
      if (!st.isFile() || st.size === 0 || st.size !== a.velikost) throw new Napaka(409, "vsota", "Datoteka se je spremenila.");
      // odjemalec, ki je ze prekinil, ne dobi nicesar (A-11: prej je obljuba spodaj visela in deskriptor ostal odprt)
      if (res.destroyed) return;
      const h = createHash("sha256");
      for await (const k of ds.createReadStream({ start: 0, end: st.size - 1, autoClose: false })) h.update(k as Buffer);
      if (h.digest("hex") !== a.sha256) throw new Napaka(409, "vsota", "Datoteka se je spremenila.");
      if (res.destroyed) return;
      res.writeHead(200, {
        "content-type": "application/vnd.android.package-archive",
        "content-length": st.size,
        "cache-control": "no-store",
        "x-lina-sha256": a.sha256,
        "x-lina-paket": a.paket,
        "x-lina-gradnja": a.id,
      });
      // pipeline se konca tudi ob prekinitvi odjemalca ali napaki branja (vticnica se tedaj zapre, ne visi)
      await pipeline(ds.createReadStream({ start: 0, end: st.size - 1, autoClose: false }), res).catch(() => {
        res.destroy();
      });
    } finally {
      await ds.close();
    }
  }

  /** Naloga 20: seznam knjiznice slik (podpisana poizvedba); samo metapodatki, brez poziva in poti; najnovejsi do meje odgovora. */
  private async seznamSlik(url: URL) {
    const { posiljatelj, t } = this.podpisPoizvedbe(url);
    await this.preveri(posiljatelj, t, (c, e) => nizSeznamaSlik(posiljatelj as string, c, e));
    // branje s telefona ne premakne pokvarjene datoteke (to naredi samo lastnikova pot); polja so omejena (slike.json je lokalni vnos)
    const slike = (await preberiKnjiznico(this.m.root, { premakniPokvarjen: false })).slike
      .filter((s) => typeof s.datoteka === "string" && DATOTEKA_KNJIZNICE.test(s.datoteka))
      .slice(0, 60)
      .map((s) => {
        const pripona = s.datoteka.split(".")[1] as keyof typeof MIME_KNJIZNICE;
        // samo nizi: String() na objektu iz slike.json lahko vrze (toString: null) in en zapis bi podrl cel seznam (500)
        const niz = (x: unknown, n: number) => (typeof x === "string" ? x.slice(0, n) : "");
        return {
          id: s.id, serija: typeof s.serija === "string" && /^[a-z0-9]{12}$/.test(s.serija) ? s.serija : "", cas: niz(s.cas, 30),
          opis: niz(s.opis, 200), model: niz(s.model, 60), bajtov: Number.isSafeInteger(s.bajtov) ? s.bajtov : 0,
          mime: MIME_KNJIZNICE[pripona], vrsta: pripona === "mp4" ? "video" : "slika",
        };
      });
    return { slike: dogodkiDoMeje(slike, NAJVEC_ODGOVOR_DOGODKOV_B) };
  }

  /**
   * Naloga 20: ena slika ali video iz knjiznice kot surovi bajti: id iz knjiznice, ime po vzorcu, mapa ni povezava, datoteka se odpre
   * brez sledenja povezavi, velikost = zapis v knjiznici, vsebina = pripona (PNG/JPEG/MP4), sha256 in telo iz istega branja.
   */
  private async slikaKnjiznice(url: URL, res: ServerResponse): Promise<void> {
    const { posiljatelj, t } = this.podpisPoizvedbe(url);
    const id = url.searchParams.get("id") ?? "";
    if (!/^[a-z0-9]{12}$/.test(id)) throw new Napaka(400, "oblika", "Neveljaven id.");
    await this.preveri(posiljatelj, t, (c, e) => nizSlike(posiljatelj as string, id, c, e));
    const z = (await preberiKnjiznico(this.m.root, { premakniPokvarjen: false })).slike.find((s) => s.id === id);
    if (!z || typeof z.datoteka !== "string" || !DATOTEKA_KNJIZNICE.test(z.datoteka)) throw new Napaka(404, "ni", "Slike ni v knjiznici.");
    const pripona = z.datoteka.split(".")[1] as keyof typeof MIME_KNJIZNICE;
    const mapa = path.join(this.m.root, MAPA_SLIK);
    // O_NOFOLLOW velja samo za zadnji del poti: mapa slik sama ne sme biti povezava drugam
    const sm = await lstat(mapa).catch(() => null);
    if (!sm || sm.isSymbolicLink() || !sm.isDirectory()) throw new Napaka(404, "ni", "Slike ni v knjiznici.");
    let ds;
    try {
      ds = await open(path.join(mapa, z.datoteka), fsKonstante.O_RDONLY | (fsKonstante.O_NOFOLLOW ?? 0) | (fsKonstante.O_NONBLOCK ?? 0));
    } catch {
      throw new Napaka(404, "ni", "Slike ni v knjiznici.");
    }
    try {
      const st = await ds.stat();
      if (!st.isFile() || st.size === 0 || st.size !== z.bajtov || st.size > (pripona === "mp4" ? NAJVEC_BAJTOV_VIDEA : NAJVEC_BAJTOV_SLIKE)) throw new Napaka(404, "ni", "Slike ni v knjiznici.");
      // Pretok iz enega opisnika (video do 60 MB ni cel v pomnilniku na zahtevo): 1. prehod vsota in vrsta, 2. prehod telo, ki se
      // konca SAMO, ce so poslani bajti enaki zgoscenim (sicer se povezava prekine pred zadnjim kosom - odjemalec nima cele datoteke).
      const preberi = () => ds.createReadStream({ start: 0, end: st.size - 1, autoClose: false });
      const h = createHash("sha256");
      let glava = Buffer.alloc(0);
      let n = 0;
      for await (const k of preberi()) {
        const b = k as Buffer;
        if (glava.length < 12) glava = Buffer.concat([glava, b.subarray(0, 12 - glava.length)]);
        h.update(b);
        n += b.length;
      }
      if (n !== st.size) throw new Napaka(409, "vsota", "Datoteka se je spremenila.");
      const png = glava.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const jpg = glava[0] === 0xff && glava[1] === 0xd8 && glava[2] === 0xff;
      const mp4 = glava.length >= 12 && glava.subarray(4, 8).toString("latin1") === "ftyp";
      if (!(pripona === "png" ? png : pripona === "jpg" ? jpg : mp4)) throw new Napaka(404, "ni", "Slike ni v knjiznici.");
      const vsota = h.digest("hex");
      if (res.destroyed) return;
      res.writeHead(200, { "content-type": MIME_KNJIZNICE[pripona], "content-length": st.size, "cache-control": "no-store", "x-lina-sha256": vsota });
      const h2 = createHash("sha256");
      let zadnji: Buffer | null = null;
      let poslano = 0;
      const enakaVsota = new Transform({
        transform(k: Buffer, _e, cb) {
          h2.update(k);
          poslano += k.length;
          const prej = zadnji;
          zadnji = k;
          cb(null, prej ?? undefined);
        },
        flush(cb) {
          if (poslano !== st.size || h2.digest("hex") !== vsota) return cb(new Error("vsota"));
          cb(null, zadnji ?? undefined);
        },
      });
      await pipeline(preberi(), enakaVsota, res).catch(() => {
        res.destroy();
      });
    } finally {
      await ds.close();
    }
  }

  private neznan(naslov: string): void {
    const t = this.zdaj();
    const s = (this.neznani.get(naslov) ?? []).filter((x) => t - x < 60_000);
    s.push(t);
    this.neznani.set(naslov, s);
    if (this.neznani.size > 2000) for (const [k, v] of this.neznani) if (!v.some((x) => t - x < 60_000)) this.neznani.delete(k);
    if (s.length > NAJVEC_NEZNANIH_NA_MINUTO) throw new Napaka(429, "prevec", "Prevec poizvedb.");
  }

  /** Koncane naloge se pozabijo po 1 h, vse po 24 h. */
  private pocisti(): void {
    const t = this.zdaj();
    for (const [id, n] of this.naloge) if ((n.koncano && t - n.cas > 3600_000) || t - n.cas > 24 * 3600_000) this.naloge.delete(id);
  }
}
