import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { X509Certificate } from "node:crypto";

const require = createRequire(import.meta.url);

/** Samopodpisan certifikat za wss. Odtis gre v kodo QR ob seznanitvi. */
export interface TlsMaterial {
  cert: string;
  key: string;
  /** SHA-256, male crke, brez dvopicij. */
  fingerprint256: string;
  /** Ista vrednost z dvopicji, za izpis cloveku. */
  fingerprintColon: string;
}

interface SelfSigned {
  generate: (
    attrs: { name: string; value: string }[],
    opts: Record<string, unknown>,
  ) => { cert: string; private: string };
}

/** Identiteta potrdila. Naslov DHCP vanj ne sme. */
const CERT_IDENTITY = "localhost";

export function loadOrCreateTls(dataDir: string, _bindHost: string): TlsMaterial {
  const dir = path.join(dataDir, "tls");
  mkdirSync(dir, { recursive: true });
  const certPath = path.join(dir, "cert.pem");
  const keyPath = path.join(dir, "key.pem");
  const hostPath = path.join(dir, "host.txt");
  const sameHost = existsSync(hostPath) && readFileSync(hostPath, "utf8").trim() === CERT_IDENTITY;
  if (existsSync(certPath) && existsSync(keyPath) && sameHost) {
    return material(readFileSync(certPath, "utf8"), readFileSync(keyPath, "utf8"));
  }
  // SAN je samo localhost in 127.0.0.1. Naslov vmesnika (DHCP) se ne vpise,
  // tudi ce je _bindHost drugacen. Istovetnost odjemalca je odtis, ne IP.
  void _bindHost;
  const selfsigned = require("selfsigned") as SelfSigned;
  const altNames: { type: number; ip?: string; value?: string }[] = [
    { type: 2, value: "localhost" },
    { type: 7, ip: "127.0.0.1" },
  ];
  const pems = selfsigned.generate([{ name: "commonName", value: CERT_IDENTITY }], {
    algorithm: "sha256",
    keySize: 2048,
    days: 825,
    extensions: [{ name: "subjectAltName", altNames }],
  });
  writeFileSync(certPath, pems.cert);
  writeFileSync(keyPath, pems.private, { mode: 0o600 });
  writeFileSync(hostPath, CERT_IDENTITY);
  return material(pems.cert, pems.private);
}

function material(cert: string, key: string): TlsMaterial {
  const fingerprint256 = new X509Certificate(cert).fingerprint256.replace(/:/g, "").toLowerCase();
  const fingerprintColon = fingerprint256
    .toUpperCase()
    .match(/.{2}/g)!
    .join(":");
  return { cert, key, fingerprint256, fingerprintColon };
}
