import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

const WILDCARD_HOSTS = new Set(["0.0.0.0", "::", "[::]", "*", "::0"]);

/**
 * Naslov, na katerem streznik poslusa.
 * Privzeto samo 127.0.0.1. 0.0.0.0 in vsi vmesniki so zavrnjeni.
 * Izrecni HOST sme biti samo zasebni naslov ali localhost, ne javni IP.
 */
export function bindHost(value: string | undefined | null): string {
  const host = value?.trim() ?? "";
  if (!host) return "127.0.0.1";
  if (!isPrivateBindHost(host)) {
    throw new Error("HOST sme biti samo zasebni naslov ali localhost");
  }
  return host;
}

/** Zasebni IPv4, ULA IPv6, localhost. Javni naslov in 0.0.0.0 nista dovoljena. */
export function isPrivateBindHost(host: string): boolean {
  const raw = host.trim().toLowerCase();
  const bare = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  if (bare === "localhost" || bare === "127.0.0.1" || bare === "::1") return true;
  if (WILDCARD_HOSTS.has(raw) || WILDCARD_HOSTS.has(bare)) return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(bare);
  if (v4) {
    const parts = v4.slice(1).map(Number);
    if (parts.some((part) => part > 255)) return false;
    const a = parts[0]!;
    const b = parts[1]!;
    if (a === 127 || a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  }
  return /^(fc|fd)[0-9a-f]{0,2}:/i.test(bare);
}

export function isLoopbackHost(host: string): boolean {
  const raw = host.trim().toLowerCase();
  const bare = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  return bare === "localhost" || bare === "127.0.0.1" || bare === "::1";
}

/**
 * Telefon doseze streznik na HOST. Medijska noga Line je vedno 127.0.0.1,
 * zato mora isti proces poslusati tudi na loopback, sicer se klic po dvigu prekine.
 */
export function listenHosts(host: string): string[] {
  const bound = host.trim() === "localhost" ? "127.0.0.1" : host.trim();
  if (isLoopbackHost(bound)) return [bound];
  return [bound, "127.0.0.1"];
}

/**
 * Zasebni LAN IPv4 za izpis, ne za privzeti bind.
 * Prednost: 192.168, nato 10, nato 172.16–31. Javni naslov (rang 3) se ne izbere.
 * Ce zasebnega ni, ostane 127.0.0.1.
 */
export function lanIpv4(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string {
  const found: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== "IPv4") continue;
      if (entry.address.startsWith("169.254.")) continue;
      if (rank(entry.address) < 3) found.push(entry.address);
    }
  }
  found.sort((a, b) => rank(a) - rank(b));
  return found[0] ?? "127.0.0.1";
}

function rank(address: string): number {
  if (address.startsWith("192.168.")) return 0;
  if (address.startsWith("10.")) return 1;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) return 2;
  return 3;
}
