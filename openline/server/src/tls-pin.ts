import { createHash, timingSafeEqual, X509Certificate } from "node:crypto";
import tls, { type PeerCertificate } from "node:tls";

/**
 * Pripenjanje samopodpisanega certifikata po odtisu SHA-256.
 * NODE_TLS_REJECT_UNAUTHORIZED se ne nastavlja. Notranji socket prebere
 * vrstniški certifikat in ga takoj zapre, ce se odtis ne ujema, se preden
 * gre ven HTTP (zeton, kljuc).
 */

export function normalizeFingerprint(value: string): string {
  return value.replace(/:/g, "").trim().toLowerCase();
}

export function fingerprintOfPem(pem: string): string {
  return normalizeFingerprint(new X509Certificate(pem).fingerprint256);
}

export function peerFingerprint(cert: PeerCertificate | undefined): string {
  return normalizeFingerprint(cert?.fingerprint256 ?? "");
}

/** Primerjava odtisa v konstantnem casu. Oba niza se najprej zgostita. */
export function fingerprintsMatch(left: string, right: string): boolean {
  const digest = (value: string) => createHash("sha256").update(normalizeFingerprint(value)).digest();
  return timingSafeEqual(digest(left), digest(right));
}

/**
 * Lastna noga do wss prehoda: zaupamo samo temu certifikatu (kot CA)
 * in se preverimo, da je odtis tisti, ki ga nesemo v QR.
 */
export function mediaTlsOptions(caPem: string, fingerprint: string): {
  ca: string;
  rejectUnauthorized: true;
  checkServerIdentity: (host: string, cert: PeerCertificate) => Error | undefined;
} {
  const expected = normalizeFingerprint(fingerprint);
  if (expected.length !== 64 || !fingerprintsMatch(fingerprintOfPem(caPem), expected)) {
    throw new Error("odtis lastnega certifikata se ne ujema");
  }
  return {
    ca: caPem,
    rejectUnauthorized: true,
    // Ime gostitelja se ne gleda. SAN je samo localhost, istovetnost je odtis.
    checkServerIdentity: (_host, cert) => {
      const got = normalizeFingerprint(cert.fingerprint256 ?? "");
      return fingerprintsMatch(got, expected) ? undefined : new Error("odtis certifikata se ne ujema");
    },
  };
}

/**
 * Povezava na Lino (ali drug wss z znanim odtisom). Certifikata nimamo kot PEM,
 * zato po stisku preverimo odtis in ob napaki socket unicimo, preden odjemalec
 * poslje zahtevek.
 */
export function pinnedWsOptions(fingerprint: string): {
  rejectUnauthorized: true;
  createConnection: (options: tls.ConnectionOptions) => tls.TLSSocket;
} {
  const expected = normalizeFingerprint(fingerprint);
  if (expected.length !== 64) throw new Error("odtis manjka");
  return {
    rejectUnauthorized: true,
    createConnection: (options) => {
      const { createConnection: _ignored, ...rest } = options as tls.ConnectionOptions & {
        createConnection?: unknown;
      };
      const socket = tls.connect({ ...rest, rejectUnauthorized: false });
      socket.prependListener("secureConnect", () => {
        const got = peerFingerprint(socket.getPeerCertificate());
        if (!fingerprintsMatch(got, expected)) socket.destroy(new Error("odtis certifikata se ne ujema"));
      });
      return socket;
    },
  };
}

function cleanPin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const pin = normalizeFingerprint(value);
  return /^[0-9a-f]{64}$/.test(pin) ? pin : undefined;
}

/**
 * Odtis za wss.
 * Za Lino zahteva ne sme prepisati odtisa. Okolje velja samo, ce uporabnik
 * odtisa ni izrecno shranil. Za drugega agenta ostane odtis iz zahteve.
 */
export function resolveStreamPin(input: {
  forLina: boolean;
  requestPin?: string;
  envPin?: string;
  userPin?: string;
}): string | undefined {
  if (input.forLina) return cleanPin(input.userPin) ?? cleanPin(input.envPin);
  return cleanPin(input.requestPin);
}
