/**
 * Avtentikacija digest za SIP (RFC 3261 22, RFC 2617, RFC 7616: MD5, MD5-sess, SHA-256, SHA-256-sess; qop=auth).
 * Ciste funkcije (samo node:crypto). Geslo pride iz nastavitev uporabnika, nikoli iz kode ali dnevnika.
 */
import { createHash, randomBytes } from "node:crypto";
import { napaka, uspeh, type Izid } from "./izid.ts";

export type DigestAlgoritem = "MD5" | "MD5-sess" | "SHA-256" | "SHA-256-sess";

export type DigestIzziv = {
  realm: string;
  nonce: string;
  opaque: string | null;
  algoritem: DigestAlgoritem;
  /** qop, ki ga ponuja streznik; prazen seznam = stari nacin RFC 2069. */
  qop: string[];
  stale: boolean;
};

const NAJVEC_IZZIV = 2048;

/** Razcleni vrednost glave WWW-Authenticate / Proxy-Authenticate. Nepodprto (ne-Digest, auth-int brez auth) vrne napako. */
export function razcleniIzziv(vrednost: string): Izid<DigestIzziv> {
  if (typeof vrednost !== "string" || vrednost.length > NAJVEC_IZZIV) return napaka("predolg izziv");
  const m = /^\s*Digest\s+(.*)$/is.exec(vrednost);
  if (!m) return napaka("ni Digest");
  const p = razcleniParametre(m[1] ?? "");
  if (!p) return napaka("napacni parametri");
  const realm = p.get("realm");
  const nonce = p.get("nonce");
  if (realm === undefined || !nonce) return napaka("manjka realm ali nonce");
  const alg = (p.get("algorithm") ?? "MD5").toUpperCase();
  const algoritem: DigestAlgoritem | null =
    alg === "MD5" ? "MD5" : alg === "MD5-SESS" ? "MD5-sess" : alg === "SHA-256" ? "SHA-256" : alg === "SHA-256-SESS" ? "SHA-256-sess" : null;
  if (!algoritem) return napaka(`nepodprt algoritem ${alg.slice(0, 32)}`);
  const qopSurovo = p.get("qop");
  const qop = qopSurovo === undefined ? [] : qopSurovo.split(",").map((q) => q.trim().toLowerCase()).filter(Boolean);
  if (qopSurovo !== undefined && !qop.includes("auth")) return napaka("streznik ne ponuja qop=auth");
  return uspeh({ realm, nonce, opaque: p.get("opaque") ?? null, algoritem, qop, stale: (p.get("stale") ?? "").toLowerCase() === "true" });
}

/** auth-param seznam: kljuc=zeton ali kljuc="niz z \" ubezniki", loceni z vejicami. */
export function razcleniParametre(niz: string): Map<string, string> | null {
  const izid = new Map<string, string>();
  let i = 0;
  const n = niz.length;
  while (i < n) {
    while (i < n && (niz[i] === " " || niz[i] === "\t" || niz[i] === ",")) i++;
    if (i >= n) break;
    const zacetek = i;
    while (i < n && /[A-Za-z0-9\-_.]/.test(niz[i] ?? "")) i++;
    const kljuc = niz.slice(zacetek, i).toLowerCase();
    if (!kljuc) return null;
    while (i < n && (niz[i] === " " || niz[i] === "\t")) i++;
    if (niz[i] !== "=") return null;
    i++;
    while (i < n && (niz[i] === " " || niz[i] === "\t")) i++;
    let vrednost = "";
    if (niz[i] === '"') {
      i++;
      let zaprto = false;
      while (i < n) {
        const z = niz[i];
        if (z === "\\" && i + 1 < n) {
          vrednost += niz[i + 1];
          i += 2;
          continue;
        }
        if (z === '"') {
          zaprto = true;
          i++;
          break;
        }
        vrednost += z;
        i++;
      }
      if (!zaprto) return null;
    } else {
      const z = i;
      while (i < n && niz[i] !== "," && niz[i] !== " " && niz[i] !== "\t") i++;
      vrednost = niz.slice(z, i);
    }
    if (izid.has(kljuc)) return null; // podvojen parameter je dvoumen
    izid.set(kljuc, vrednost);
  }
  return izid;
}

function zgosti(algoritem: DigestAlgoritem, besedilo: string): string {
  const ime = algoritem.startsWith("SHA-256") ? "sha256" : "md5";
  return createHash(ime).update(besedilo, "utf8").digest("hex");
}

export type DigestVhod = {
  algoritem: DigestAlgoritem;
  uporabnik: string;
  realm: string;
  geslo: string;
  metoda: string;
  uri: string;
  nonce: string;
  /** "auth" ali null (RFC 2069 brez qop). */
  qop: "auth" | null;
  nc?: string;
  cnonce?: string;
};

/** Odgovor digest (RFC 2617 3.2.2.1, RFC 7616 3.4.1). */
export function izracunajOdgovor(v: DigestVhod): string {
  let ha1 = zgosti(v.algoritem, `${v.uporabnik}:${v.realm}:${v.geslo}`);
  if (v.algoritem.endsWith("-sess")) ha1 = zgosti(v.algoritem, `${ha1}:${v.nonce}:${v.cnonce ?? ""}`);
  const ha2 = zgosti(v.algoritem, `${v.metoda}:${v.uri}`);
  if (v.qop === "auth") return zgosti(v.algoritem, `${ha1}:${v.nonce}:${v.nc ?? "00000001"}:${v.cnonce ?? ""}:auth:${ha2}`);
  return zgosti(v.algoritem, `${ha1}:${v.nonce}:${ha2}`);
}

function narekovaj(v: string): string {
  return `"${v.replace(/[\\"]/g, (z) => `\\${z}`)}"`;
}

/** Med vec izzivi izbere najmocnejsega podprtega (SHA-256 pred MD5, RFC 7616 3.7). */
export function izberiIzziv(vrednosti: string[]): Izid<DigestIzziv> {
  const razclenjeni = vrednosti.slice(0, 8).map(razcleniIzziv);
  const veljavni = razclenjeni.flatMap((r) => (r.ok ? [r.vrednost] : []));
  if (veljavni.length === 0) return napaka(vrednosti.length === 0 ? "ni izziva" : "ni podprtega izziva");
  const moc = (a: DigestAlgoritem) => (a.startsWith("SHA-256") ? 2 : 1);
  veljavni.sort((a, b) => moc(b.algoritem) - moc(a.algoritem));
  return uspeh(veljavni[0] as DigestIzziv);
}

export function novCnonce(): string {
  return randomBytes(12).toString("hex");
}

/** Vrednost glave Authorization / Proxy-Authorization za izziv. */
export function glavaAvtorizacije(
  izziv: DigestIzziv,
  podatki: { uporabnik: string; geslo: string; metoda: string; uri: string; nc: number; cnonce?: string },
): string {
  const qop = izziv.qop.includes("auth") ? "auth" : null;
  const nc = podatki.nc.toString(16).padStart(8, "0");
  const cnonce = podatki.cnonce ?? novCnonce();
  const response = izracunajOdgovor({
    algoritem: izziv.algoritem,
    uporabnik: podatki.uporabnik,
    realm: izziv.realm,
    geslo: podatki.geslo,
    metoda: podatki.metoda,
    uri: podatki.uri,
    nonce: izziv.nonce,
    qop,
    nc,
    cnonce,
  });
  const deli = [
    `username=${narekovaj(podatki.uporabnik)}`,
    `realm=${narekovaj(izziv.realm)}`,
    `nonce=${narekovaj(izziv.nonce)}`,
    `uri=${narekovaj(podatki.uri)}`,
    `response=${narekovaj(response)}`,
    `algorithm=${izziv.algoritem}`,
  ];
  if (qop) deli.push(`cnonce=${narekovaj(cnonce)}`, `qop=auth`, `nc=${nc}`);
  if (izziv.opaque !== null) deli.push(`opaque=${narekovaj(izziv.opaque)}`);
  return `Digest ${deli.join(", ")}`;
}
