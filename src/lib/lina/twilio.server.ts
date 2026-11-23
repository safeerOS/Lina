import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Twilio podpiše URL in razvrščene parametre obrazca z HMAC-SHA1
 * ter Base64. Primerjava je v konstantnem času.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const keys = Object.keys(params).sort();
  let data = url;
  for (const key of keys) data += key + params[key];
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function signaturesMatch(expected: string, given: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(given);
  if (left.length !== right.length) {
    const padded = Buffer.alloc(left.length);
    right.copy(padded);
    timingSafeEqual(left, padded);
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * Naslov, s katerim Twilio podpise zahtevo. Za posrednikom (tunel, obratni posrednik) streznik vidi lokalni naslov
 * (http://127.0.0.1:8080), Twilio pa podpise JAVNI https naslov - brez nastavljenega javnega naslova bi bil vsak
 * pravi klic zavrnjen s 403 (ugotovljeno 10. 11. 2026 pred prvim preizkusnim klicem). X-Forwarded-* ne zaupamo,
 * ker ga lahko nastavi klicatelj; velja samo javni naslov iz nastavitev.
 */
export function signatureUrl(request: Request, javniNaslov = ""): string {
  const url = new URL(request.url);
  url.hash = "";
  const raw = javniNaslov.trim().replace(/\/+$/, "");
  const origin = /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/i.test(raw) ? raw : url.origin;
  return `${origin}${url.pathname}${url.search}`;
}

export async function formParams(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/x-www-form-urlencoded") && !type.includes("multipart/form-data")) {
    return {};
  }
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params[key] = value;
  }
  return params;
}

/**
 * Podpis s SharedKey (Webhooks configuration API): isti vhod kot pri Auth Tokenu (naslov + razvrsteni parametri), HMAC z izbranim
 * algoritmom in Base64. NEPREVERJENO z pravim Twilio (dokumentacija vhoda ne opisuje); preizkus z lastnikovim kljucem pred vklopom.
 */
export function podpisSharedKey(skrivnost: string, algoritem: "sha1" | "sha256", url: string, params: Record<string, string>): string {
  const keys = Object.keys(params).sort();
  let data = url;
  for (const key of keys) data += key + params[key];
  return createHmac(algoritem, skrivnost).update(data, "utf8").digest("base64");
}

/** Glava X-Twilio-Webhooks-Signature-Settings: »key=<id>,algorithm=<HMAC_SHA256>«. Vrne null, ce ni veljavna. */
export function preberiGlavoPodpisa(glava: string | null): { kljucId: string; algoritem: "sha1" | "sha256" } | null {
  if (!glava) return null;
  const deli = new Map<string, string>();
  for (const kos of glava.split(",")) {
    const i = kos.indexOf("=");
    if (i > 0) deli.set(kos.slice(0, i).trim().toLowerCase(), kos.slice(i + 1).trim());
  }
  const kljucId = deli.get("key") ?? "";
  const alg = (deli.get("algorithm") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^webhooks_sharedkey_[A-Za-z0-9]{10,64}$/.test(kljucId)) return null;
  if (alg === "HMACSHA256") return { kljucId, algoritem: "sha256" };
  if (alg === "HMACSHA1") return { kljucId, algoritem: "sha1" };
  return null;
}
