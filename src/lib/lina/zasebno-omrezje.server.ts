/**
 * Skupni deli HTTPS strezniku za telefon (asistentka in glas telefona): zasebni naslov, samopodpisano potrdilo EC P-256 in
 * mapa potrdila (mapa 0700, kljuc 0600). Prepis openline/server/src/lan.ts in tls.ts; izvlecen iz asistent-streznik.server.ts
 * (15. 11. 2026), da pot klica (glas telefona -> Live) ne uvaza nobenega modula asistentke ali kanala Claude Code.
 * Brez uvozov iz asistent-*, kanal-claude* in poti klica (preizkus v glas-telefon.test.ts).
 */
import { generateKeyPairSync, randomBytes, sign, X509Certificate, createPrivateKey } from "node:crypto";
import { createSocket } from "node:dgram";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import path from "node:path";

/** Mapa podatkov Line: navadna mapa tega uporabnika, brez pisanja drugih (enako kot preveriKoren v kanal-claude.server.ts). */
export async function preveriMapoPodatkov(root: string): Promise<void> {
  if (process.platform === "win32") return;
  await mkdir(root, { recursive: true, mode: 0o700 });
  const st = await lstat(root);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("Mapa podatkov Line ni navadna mapa.");
  if (typeof process.getuid === "function" && st.uid !== process.getuid()) throw new Error("Mapa podatkov Line ni od tega uporabnika.");
  if (st.mode & 0o022) throw new Error(`Glas telefona ne poslusa: mapa podatkov Line ima pravice ${(st.mode & 0o777).toString(8)} in vanjo lahko pisejo drugi uporabniki. Nastavite pravice 700 (chmod 700 <mapa podatkov>).`);
}

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
const celo = (b: Buffer) => tlv(0x02, b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
function utc(d: Date): Buffer {
  const p = (n: number) => String(n).padStart(2, "0");
  const s = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return tlv(0x17, Buffer.from(s, "ascii"));
}

/** Samopodpisano X.509 v3 (CN »Lina asistentka«, SAN localhost in 127.0.0.1 kot pri OpenLine; istovetnost je odtis, ne ime). */
export function ustvariPotrdilo(zdaj = new Date(), izvorSerijske: () => Buffer = () => randomBytes(16), cn = "Lina asistentka"): { cert: string; key: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const ecdsaSha256 = seq(oid("1.2.840.10045.4.3.2"));
  const ime = seq(tlv(0x31, seq(oid("2.5.4.3"), tlv(0x0c, Buffer.from(cn, "utf8")))));
  const zacetek = new Date(zdaj.getTime() - 24 * 3600_000);
  const konec = new Date(zdaj.getTime() + 825 * 24 * 3600_000);
  const san = seq(tlv(0x82, Buffer.from("localhost", "ascii")), tlv(0x87, Buffer.from([127, 0, 0, 1])));
  const razsiritve = tlv(0xa3, seq(
    seq(oid("2.5.29.19"), tlv(0x01, Buffer.from([0xff])), tlv(0x04, seq())),
    seq(oid("2.5.29.17"), tlv(0x04, san)),
  ));
  const serijska = izvorSerijske();
  // DER INTEGER mora biti najkrajsi in pozitiven: prvi bajt 0x00 (po maski 0x7f ob 1/128 vrednosti) da »illegal padding« (obcasen padec
  // preizkusa asistent-streznik in zagona streznika, ~1/256 na potrdilo; 15. 11. 2026), zato prvi bajt ni nikoli 0. ENA resitev za vse poti.
  serijska[0] = (serijska[0] & 0x7f) || 0x01;
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

/**
 * L3-N6: pravice se nastavijo; ce chmod ne uspe (datotecni sistem brez pravic: FAT/NTFS mount, nekateri vsebniki), je izid odvisen od STVARNIH
 * pravic: ze stroge (nobenih pravic za skupino in druge) = nadaljuje; odprte = JASNA napaka in zagon se ustavi (fail-closed). Kljuca z odprtimi
 * pravicami NE zamenjamo tiho: mapa je 0700 (nastavljena PRED branjem kljuca, tudi fail-closed), nov kljuc na istem sistemu bi bil enako odprt,
 * zamenjava pa bi telefonom brez razloga unicila seznanitev (odtis).
 */
async function zagotoviPravice(pot: string, nacin: number, popravi: (pot: string, nacin: number) => Promise<void>): Promise<void> {
  try {
    await popravi(pot, nacin);
  } catch (e) {
    const st = await lstat(pot).catch(() => null);
    if (st && (st.mode & 0o077) === 0) return;
    const koda = (e as NodeJS.ErrnoException).code ?? "napaka";
    throw new Error(`Pravic ni mogoce nastaviti na ${nacin.toString(8)} (${koda}) in so odprte: datotecni sistem jih verjetno ne podpira. Mapo podatkov Line premaknite na datotecni sistem s pravicami (npr. ext4).`);
  }
}

/** Potrdilo v <mapa podatkov>/<imeMape> (mapa 0700, kljuc 0600); ce ni veljavno ali ne ustreza kljucu, novo. */
export async function potrdiloVMapi(
  root: string, imeMape: string, cn: string, popraviPravice: (pot: string, nacin: number) => Promise<void> = chmod,
): Promise<{ cert: string; key: string; odtis: string }> {
  await preveriMapoPodatkov(root);
  const mapa = path.join(root, imeMape);
  await mkdir(mapa, { recursive: true, mode: 0o700 });
  const st = await lstat(mapa);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("Mapa potrdila ni navadna mapa.");
  if (process.platform !== "win32") await zagotoviPravice(mapa, 0o700, popraviPravice);
  const pc = path.join(mapa, "potrdilo.pem");
  const pk = path.join(mapa, "kljuc.pem");
  let obstojece: { cert: string; key: string } | null = null;
  try {
    const cert = await readFile(pc, "utf8");
    const key = await readFile(pk, "utf8");
    const x = new X509Certificate(cert);
    if (x.checkPrivateKey(createPrivateKey(key)) && new Date(x.validTo).getTime() > Date.now() + 30 * 24 * 3600_000) obstojece = { cert, key };
  } catch {
    // ni potrdila ali je pokvarjeno: novo
  }
  if (obstojece) {
    // L-09: dovoljenja OBSTOJECEGA kljuca se preverijo ob vsakem zagonu (mode pri writeFile velja samo ob ustvarjanju datoteke).
    // N-6: chmod je IZVEN try: neuspeh ne sme tiho ustvariti novega potrdila (odtis se spremeni, telefon izgubi seznanitev), zagon javi napako.
    if (process.platform !== "win32") await zagotoviPravice(pk, 0o600, popraviPravice);
    return { ...obstojece, odtis: odtisPotrdila(obstojece.cert) };
  }
  const nov = ustvariPotrdilo(new Date(), undefined, cn);
  // kljuc se zapise atomarno (zacasna datoteka 0600 + rename), da zrusitev sredi pisanja ne pusti pol kljuca ali kljuca z odprtimi pravicami
  for (const [ime, vsebina, nacin] of [[pk, nov.key, 0o600], [pc, nov.cert, 0o644]] as const) {
    const zacasna = `${ime}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      await writeFile(zacasna, vsebina, { mode: nacin, flag: "wx" });
      if (process.platform !== "win32") await chmod(zacasna, nacin);
      await rename(zacasna, ime);
    } catch (e) {
      await rm(zacasna, { force: true }).catch(() => undefined);
      throw e;
    }
  }
  return { ...nov, odtis: odtisPotrdila(nov.cert) };
}

/** Vmesniki, na katerih telefon v domacem omrezju Line ne doseze (vsebniki, mostovi, navidezni, VPN, loopback). */
// »lo« samo kot celo ime (lo, lo0): »Local Area Connection« / »Lokalna povezava« na Windows sta prava vmesnika
const NI_LAN = /^(lo\d*$|docker|br-|veth|virbr|vboxnet|vmnet|cni|flannel|podman|lxc|lxd|tun|tap|wg|zt|tailscale|vethernet)/i;

/**
 * Naloga 15: naslov v lokalnem omrezju, ko shranjenega ni vec (menjava Wi-Fi -> kabel). Prednost ima vmesnik privzete poti
 * ([izvor] = izvorni naslov privzete poti), nato drugi pravi vmesniki; zasebni IPv4 pred ULA; nikoli javni, notranji ali NI_LAN.
 */
export function izberiLanNaslov(vmesniki: NodeJS.Dict<NetworkInterfaceInfo[]>, izvor: string | null): string | null {
  const kandidati = lanVnosi(vmesniki).map(({ v, e, je4 }) => ({ naslov: e.address, ocena: (je4 ? 0 : 2) + (izvor && v.some((x) => x.address === izvor) ? 0 : 1) }));
  kandidati.sort((a, b) => a.ocena - b.ocena);
  return kandidati[0]?.naslov ?? null;
}

/** Zasebni IPv4 in ULA na pravih vmesnikih (brez NI_LAN in notranjih): kandidati za naslov asistentke. */
function lanVnosi(vmesniki: NodeJS.Dict<NetworkInterfaceInfo[]>): Array<{ ime: string; v: NetworkInterfaceInfo[]; e: NetworkInterfaceInfo; je4: boolean }> {
  const izid: Array<{ ime: string; v: NetworkInterfaceInfo[]; e: NetworkInterfaceInfo; je4: boolean }> = [];
  for (const [ime, v] of Object.entries(vmesniki)) {
    if (NI_LAN.test(ime) || !v) continue;
    for (const e of v) {
      const je4 = e.family === "IPv4" || (e.family as unknown) === 4; // Node 18.0-18.3: stevilka
      if (e.internal || !zasebenNaslov(e.address) || (!je4 && !/^f[cd]/i.test(e.address))) continue;
      izid.push({ ime, v, e, je4 });
    }
  }
  return izid;
}

/** IPv6 v polni obliki (8 skupin po 4 hex); null, ce naslov ni IPv6 oblike. */
function razsiriIpv6(a: string): string[] | null {
  const [glava, rep, prevec] = a.split("%")[0].toLowerCase().split("::");
  if (prevec !== undefined) return null;
  const g = glava ? glava.split(":") : [];
  const r = rep === undefined ? [] : rep ? rep.split(":") : [];
  const manjka = 8 - g.length - r.length;
  if (rep === undefined ? manjka !== 0 : manjka < 0) return null;
  const vse = [...g, ...Array<string>(rep === undefined ? 0 : manjka).fill("0"), ...r];
  return vse.every((x) => /^[0-9a-f]{1,4}$/.test(x)) ? vse.map((x) => x.padStart(4, "0")) : null;
}

/** Podomrezje vmesnika: IPv4 »mreza/dolzina« iz maske; IPv6 (ULA) prvih 64 bitov (zacasni naslovi imajo isto predpono). */
function podomrezje(e: NetworkInterfaceInfo): string | null {
  const st = (s: string) => s.split(".").map(Number);
  const a = st(e.address), m = st(e.netmask);
  if (a.length === 4 && m.length === 4 && [...a, ...m].every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) {
    const dolzina = m.reduce((s, x) => s + x.toString(2).split("").filter((b) => b === "1").length, 0);
    return `${a.map((x, i) => x & m[i]).join(".")}/${dolzina}`;
  }
  const x = razsiriIpv6(e.address);
  return x ? `${x.slice(0, 4).join(":")}::/64` : null;
}

/**
 * Naloga 21 (N10): odtis lokalnega omrezja za nadzor naslova - samo kandidati izberiLanNaslov (IPv4 naslovi, ULA kot predpona /64),
 * brez docker/veth in brez zacasnih IPv6, ki se menjajo, ter MAC privzetih prehodov. Sprememba odtisa = omrezje se je res spremenilo.
 */
export function odtisLan(vmesniki: NodeJS.Dict<NetworkInterfaceInfo[]>, prehodi: Readonly<Record<string, string>>): string {
  const deli = new Set(lanVnosi(vmesniki).map(({ ime, e, je4 }) => `${ime}=${je4 ? e.address : podomrezje(e)}@${prehodi[ime] ?? ""}`));
  return [...deli].sort().join(",");
}

/**
 * Naloga 21 (N1): MAC privzetega prehoda po vmesniku iz /proc/net/route in /proc/net/arp. »« = privzeti prehod je, njegov MAC se ni
 * znan (ARP); vmesnika brez privzete poti ni. Brez teh datotek (Windows) je izid {} - glej omrezjeNaslova.
 */
export async function prehodiVmesnikov(beri: (pot: string) => Promise<string> = (p) => readFile(p, "utf8")): Promise<Record<string, string>> {
  const [route, arp] = await Promise.all([beri("/proc/net/route"), beri("/proc/net/arp")]).catch(() => ["", ""]);
  const mac = new Map<string, string>();
  for (const vrsta of arp.split("\n").slice(1)) {
    const f = vrsta.trim().split(/\s+/); // IP, HW type, Flags, HW address, Mask, Device
    if (f.length >= 6 && f[2] !== "0x0" && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(f[3]) && !/^(00:){5}00$/.test(f[3])) mac.set(`${f[5]}|${f[0]}`, f[3].toLowerCase());
  }
  const izid: Record<string, string> = {};
  for (const vrsta of route.split("\n").slice(1)) {
    const f = vrsta.trim().split(/\s+/); // Iface, Destination, Gateway (hex, little-endian) ...
    if (f.length < 3 || f[1] !== "00000000" || !/^[0-9a-f]{8}$/i.test(f[2]) || f[2] === "00000000" || f[0] in izid) continue;
    const ip = [6, 4, 2, 0].map((i) => parseInt(f[2].slice(i, i + 2), 16)).join(".");
    izid[f[0]] = mac.get(`${f[0]}|${ip}`) ?? "";
  }
  return izid;
}

/**
 * Naloga 21 (N1): odtis omrezja, v katerem je [naslov] - podomrezje vmesnika in MAC privzetega prehoda (ob lastnikovi izbiri naslova
 * se shrani, samodejno sledenje in poslusanje veljata samo v shranjenem omrezju). null = ne vemo (naslova ni ali MAC prehoda se ni znan).
 */
export function omrezjeNaslova(naslov: string, vmesniki: NodeJS.Dict<NetworkInterfaceInfo[]>, prehodi: Readonly<Record<string, string>>): string | null {
  for (const [ime, v] of Object.entries(vmesniki)) for (const e of v ?? []) {
    if (e.address !== naslov) continue;
    const mreza = podomrezje(e);
    const mac = prehodi[ime];
    if (!mreza || mac === "") return null;
    // shortcut: brez /proc (Windows) ali brez privzete poti na vmesniku odtis nosi samo podomrezje; nadgradi z Get-NetNeighbor, ko Lina na Windows sprejema telefon doma
    return `${mreza}|${mac ?? ""}`;
  }
  return null;
}

/** Izvorni naslov privzete poti IPv4 (UDP connect na TEST-NET, nic se ne poslje); deluje na Linuxu in Windows. null = ni poti. */
export function izvorPrivzetePoti(): Promise<string | null> {
  return new Promise((ok) => {
    const s = createSocket("udp4");
    const konec = (x: string | null) => { try { s.close(); } catch { /* ze zaprta */ } ok(x); };
    s.once("error", () => konec(null));
    s.connect(9, "192.0.2.1", () => { try { konec(s.address().address); } catch { konec(null); } });
  });
}

/** Ali je naslov se na kateremkoli vmesniku (127.0.0.1, ::1 in localhost vedno). */
export function naslovNaVmesniku(naslov: string, vmesniki: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): boolean {
  if (naslov === "127.0.0.1" || naslov === "::1" || naslov === "localhost") return true;
  return Object.values(vmesniki).some((v) => (v ?? []).some((e) => e.address === naslov));
}

/** Naslov zanke (127.0.0.1, ::1, localhost): telefon ga ne doseze, zato ne potrebuje odobritve omrezja. */
export const naslovZanke = (naslov: string) => naslov === "127.0.0.1" || naslov === "::1" || naslov === "localhost";

/** Zasebni naslovi IPv4 tega racunalnika (izbira v nastavitvah) in 127.0.0.1; nikoli 0.0.0.0 ali javni naslov. */
export function zasebniNaslovi(vmesniki: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string[] {
  const izid = new Set<string>(["127.0.0.1"]);
  for (const v of Object.values(vmesniki)) for (const e of v ?? []) {
    if (e.family === "IPv4" && !e.internal && zasebenNaslov(e.address)) izid.add(e.address);
  }
  return [...izid];
}
