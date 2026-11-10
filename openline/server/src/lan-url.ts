/**
 * Dovoljeni naslovi za webhook in tok: samo wss oziroma https,
 * gostitelj pa samo zasebni IPv4, localhost ali krajevni IPv6.
 * Javni gostitelj in ws:// / http:// se zavrneta (SSRF, prislusk).
 */

const SECRET_QUERY = ["token", "access_token", "apikey", "api_key", "devicetoken", "device_token"];

export function isPrivateOrLocalHost(hostname: string): boolean {
  let host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host === "localhost") return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  const mapped = host.startsWith("::ffff:") ? host.slice(7) : host;
  if (isIpv4(mapped)) return isPrivateV4(mapped);
  if (host.includes(":")) return isUla(host);
  return false;
}

export function isAllowedLanUrl(value: string, protocols: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (!protocols.includes(url.protocol)) return false;
  if (url.username || url.password) return false;
  if (hasSecretQuery(url)) return false;
  return isPrivateOrLocalHost(url.hostname);
}

export function hasSecretQuery(url: URL): boolean {
  for (const key of url.searchParams.keys()) {
    if (SECRET_QUERY.includes(key.toLowerCase())) return true;
  }
  return false;
}

/** Odstrani zeton iz poizvedbe. Zeton ne sme ostati v naslovu. */
export function stripSecretQuery(value: string): string {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_QUERY.includes(key.toLowerCase())) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value;
  }
}

function isIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isPrivateV4(host: string): boolean {
  const parts = host.split(".").map(Number);
  const a = parts[0];
  const b = parts[1];
  if (a === undefined || b === undefined) return false;
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/** Krajevni IPv6 (fc00::/7), ne povezavno-krajevni fe80. */
function isUla(host: string): boolean {
  const first = host.split(":")[0];
  if (!first) return false;
  const value = Number.parseInt(first, 16);
  if (Number.isNaN(value)) return false;
  return (value & 0xfe00) === 0xfc00;
}
