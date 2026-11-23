/** Izvor zahteve za prvo nastavitev gesla. Glave posrednika niso zaupanja vredne. */
export type SetupOrigin = {
  address?: string | null;
  forwardedFor?: string | null;
  forwarded?: string | null;
};

function normalizeAddress(address?: string | null): string {
  if (!address) return "";
  let value = address.trim().toLowerCase();
  if (value.startsWith("::ffff:")) value = value.slice("::ffff:".length);
  if (value.startsWith("[") && value.includes("]")) value = value.slice(1, value.indexOf("]"));
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(value)) value = value.slice(0, value.lastIndexOf(":"));
  return value;
}

/**
 * Geslo lastnika sme nastaviti samo odjemalec na istem računalniku.
 * Če je prisotna glava posrednika, zahtevo zavrnemo, tudi ko je naslov lokalen.
 */
export function assertLocalSetup(origin: SetupOrigin): void {
  if (origin.forwardedFor != null || origin.forwarded != null) {
    throw new Error("Geslo lastnika lahko nastavite samo na tem računalniku, ne prek posrednika ali tunela.");
  }
  const address = normalizeAddress(origin.address);
  if (address !== "127.0.0.1" && address !== "::1") {
    throw new Error("Geslo lastnika lahko nastavite samo z istega računalnika.");
  }
  // Neodvisni pregled 12. 11. 2026: sama vticnica ne zadosca - tuja stran z DNS rebinding (Host napadalca na 127.0.0.1)
  // bi brez gesla prevzela Lino. Zahteva z glavami (Host, Origin, Sec-Fetch-Site) mora biti lokalna tudi po njih.
  if ("host" in origin) {
    const z = origin as LokalnaZahteva;
    if (!jeLokalnaZahteva(z)) {
      throw new Error("Geslo lastnika lahko nastavite samo na tem računalniku (tuj Host ali izvor zahteve).");
    }
    // N1 2. pregleda: lokalni program brez brskalnika ne posilja glave Origin; nastavitev gesla zahteva lokalni Origin iz brskalnika.
    if (typeof z.origin !== "string" || !z.origin.trim()) {
      throw new Error("Geslo lastnika lahko nastavite samo iz lokalnega brskalnika (manjka glava Origin).");
    }
  }
}

/** Zahteva za odprtje seje brez gesla: poleg izvora vticnice se gleda se Host, Origin in Sec-Fetch-Site. */
export type LokalnaZahteva = SetupOrigin & {
  host?: string | null;
  origin?: string | null;
  fetchSite?: string | null;
};

function imeGostitelja(vrednost: string): string {
  try {
    const ime = new URL(`http://${vrednost}`).hostname.toLowerCase();
    return ime.startsWith("[") ? ime.slice(1, -1) : ime;
  } catch {
    return "";
  }
}

const LOKALNA_IMENA = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Ali zahteva res prihaja z istega racunalnika (lastnik 12. 11. 2026: Lina brez gesla).
 * Vticnica 127.0.0.1/::1, brez glav posrednika, Host in Origin lokalna (varovalo pred DNS rebinding in tujimi stranmi).
 */
export function jeLokalnaZahteva(zahteva: LokalnaZahteva): boolean {
  if (zahteva.forwardedFor != null || zahteva.forwarded != null) return false;
  const naslov = normalizeAddress(zahteva.address);
  if (naslov !== "127.0.0.1" && naslov !== "::1") return false;
  if (!zahteva.host || !LOKALNA_IMENA.has(imeGostitelja(zahteva.host))) return false;
  if (zahteva.origin != null && !LOKALNA_IMENA.has(imeGostitelja(zahteva.origin.replace(/^[a-z]+:\/\//i, "")))) return false;
  if (zahteva.fetchSite != null && zahteva.fetchSite !== "same-origin" && zahteva.fetchSite !== "none") return false;
  return true;
}

/**
 * Izvor zahteve iz vticnice in glav. Vsaka glava posrednika ali tunela (X-Forwarded-For, Forwarded, Cf-Connecting-Ip,
 * X-Real-Ip) pomeni, da zahteva ni lokalna, tudi ce posrednik Host prepise v localhost.
 */
export function izvorIzGlav(naslov: string | null | undefined, glave: { get(ime: string): string | null }): LokalnaZahteva {
  return {
    address: naslov ?? null,
    forwardedFor:
      glave.get("x-forwarded-for") ?? glave.get("cf-connecting-ip") ?? glave.get("x-real-ip") ?? glave.get("true-client-ip") ?? glave.get("x-forwarded-host") ?? glave.get("via"),
    forwarded: glave.get("forwarded"),
    host: glave.get("host"),
    origin: glave.get("origin"),
    fetchSite: glave.get("sec-fetch-site"),
  };
}
