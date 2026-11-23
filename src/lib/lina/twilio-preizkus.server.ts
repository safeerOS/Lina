import { randomBytes } from "node:crypto";
import { requireOwner } from "./auth.server.ts";
import { loadPravila } from "./pravila.server.ts";
import { jePremiumAliKratka } from "./preusmeritev.ts";
import { resolveDataDir } from "./store.server.ts";
import { twilioSignature } from "./twilio.server.ts";
import { glava, preberi, zahtevaTwilio, type ZahtevaTwilio } from "./twilio-racun.server.ts";
import { merjeno } from "./meritve.server.ts";
import { ogrejZaKlic } from "./ogrevanje-klica.server.ts";

/**
 * Preizkusni racun Twilio (lastnik 12. 11. 2026: »uporabnik lahko uporablja testni racun tako kot ga uporabljam jaz«, brez terminala).
 * Preizkusni racun zahtev webhooka NE podpise (izmerjeno 10. 11. 2026) in pri Calls.json dovoli samo To in Url. Lina zato
 * SAMA narocni klic prek API kljuca (Twilio poklice uporabnika) in sprejme nepodpisano zahtevo samo, ce:
 *  - CallSid je klic, ki ga je Lina pravkar narocila (spomin procesa, najvec 15 min),
 *  - Twilio na vprasanje z API kljucem potrdi, da je to odhodni klic NASEGA racuna proti narocenemu To in da se tece.
 * Nepodpisana zahteva brez tega, ali zahteva z napacnim podpisom, je 403 kot prej. Podpisa se ne rahlja.
 */
const OSNOVA = "https://api.twilio.com/2010-04-01/";
const SID_RACUNA = /^AC[0-9a-f]{32}$/i;
const SID_KLICA = /^CA[0-9a-f]{32}$/i;
const E164 = /^\+[1-9][0-9]{7,14}$/;
const ROK_KLICA_MS = 15 * 60_000;
const ROK_PREVERBE_MS = 30_000;
const STANJA = new Set(["queued", "ringing", "in-progress"]);

type Narocen = { kam: string; rok: number; preverjenDo: number; vezano: { od: string; za: string } | null };
/** Omejitev narocil (pregled 12. 11. 2026, SREDNJE-2): najvec 1 na 60 s in 5 na uro; cas zadnjih narocil v spominu procesa. */
const casiNarocil: number[] = [];
const RAZMIK_NAROCIL_MS = 60_000;
const NAJVEC_NA_URO = 5;
/** Polja, ki jih Lina pri nepodpisanem klicu sploh bere (SREDNJE-1): ostala (DialCallStatus, ForwardedFrom ...) se zavrzejo. */
const DOVOLJENA_POLJA = new Set(["CallSid", "CallStatus", "From", "To", "SpeechResult", "Confidence", "Digits"]);
const narocene = new Map<string, Narocen>();
/** Kljuc za ponovitve nepodpisanih zahtev (kot podpis): naslov + polja; ne zapusti procesa. */
const procesnaSkrivnost = randomBytes(32).toString("hex");

function pocisti(zdaj: number): void {
  for (const [sid, n] of narocene) if (n.rok <= zdaj) narocene.delete(sid);
}

export function pozabiPreizkusneKlice(): void {
  narocene.clear();
  casiNarocil.length = 0;
}

/** Nepodpisana zahteva ne sme z dodatnimi polji vplivati na odlocitve linije ali obiti zascite pred ponovitvijo. */
export function ociscenaPolja(params: Record<string, string>): void {
  for (const k of Object.keys(params)) if (!DOVOLJENA_POLJA.has(k)) delete params[k];
}

/** Naroci klic: Twilio poklice uporabnikovo (v Twilio potrjeno) stevilko in ob dvigu pokliche Linin javni naslov. */
export async function narociPreizkusniKlic(
  token: string | null,
  kam: string,
  dir?: string,
  zahteva: ZahtevaTwilio = zahtevaTwilio,
  zdaj: number = Date.now(),
): Promise<{ sid: string }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  void ogrejZaKlic(root);
  const stevilka = kam.trim().replace(/[\s-]/g, "");
  if (!E164.test(stevilka)) throw new Error("Stevilka mora biti v mednarodni obliki, na primer +386 40 123 456.");
  if (jePremiumAliKratka(stevilka)) throw new Error("Na to stevilko testni klic ni mogoc.");
  pocisti(zdaj);
  while (casiNarocil.length && casiNarocil[0] <= zdaj - 3_600_000) casiNarocil.shift();
  if (casiNarocil.length && zdaj - casiNarocil[casiNarocil.length - 1] < RAZMIK_NAROCIL_MS) throw new Error("Pocakajte minuto med testnimi klici.");
  if (casiNarocil.length >= NAJVEC_NA_URO) throw new Error("Najvec 5 testnih klicev na uro.");
  const r = await preberi(root);
  if (!r || !SID_RACUNA.test(r.sid)) throw new Error("Twilio ni povezan.");
  const javni = ((await loadPravila(root)).javniNaslov ?? "").trim().replace(/\/+$/, "");
  let naslov: URL;
  try {
    naslov = new URL(javni);
  } catch {
    throw new Error("Najprej vpisite javni naslov linije (https).");
  }
  if (naslov.protocol !== "https:") throw new Error("Javni naslov linije mora biti https.");
  // Samo To in Url: preizkusni racun drugih polj ne dovoli (izmerjeno 10. 11. 2026, HTTP 400).
  // Stevilka mora biti v Twilio potrjena (OutgoingCallerIds); oblika odgovora je NEPREVERJENA s pravim Twilio, napaka pomeni »ne«.
  const potrjene = await zahteva(`${OSNOVA}Accounts/${r.sid}/OutgoingCallerIds.json?PhoneNumber=${encodeURIComponent(stevilka)}`, { method: "GET", headers: glava(r.sid, r.kljucSid, r.skrivnost) });
  const seznam = (potrjene.json as { outgoing_caller_ids?: Array<Record<string, unknown>> } | null)?.outgoing_caller_ids;
  if (potrjene.status !== 200 || !Array.isArray(seznam) || !seznam.some((x) => x.phone_number === stevilka)) {
    throw new Error("Ta stevilka v Twilio ni potrjena (Verified Caller ID). Najprej jo potrdite v konzoli Twilio.");
  }
  const telo = new URLSearchParams({ To: stevilka, Url: `${naslov.origin}/api/voice/incoming` }).toString();
  const odg = await zahteva(`${OSNOVA}Accounts/${r.sid}/Calls.json`, { method: "POST", headers: glava(r.sid, r.kljucSid, r.skrivnost), body: telo });
  const json = (odg.json ?? {}) as Record<string, unknown>;
  if (odg.status !== 201 || typeof json.sid !== "string" || !SID_KLICA.test(json.sid)) {
    const sporocilo = typeof json.message === "string" ? json.message.slice(0, 160) : "";
    throw new Error(`Twilio klica ni sprejel (HTTP ${odg.status}${sporocilo ? `: ${sporocilo}` : ""}). Stevilka mora biti v Twilio potrjena.`);
  }
  pocisti(zdaj);
  narocene.set(json.sid, { kam: stevilka, rok: zdaj + ROK_KLICA_MS, preverjenDo: 0, vezano: null });
  casiNarocil.push(zdaj);
  return { sid: json.sid };
}

/** Ali je nepodpisana zahteva za ta CallSid dovoljena. Nikoli ne vrze: vsaka napaka je »ne«. */
export async function preizkusniKlicVeljaven(
  callSid: string,
  dir?: string,
  zahteva: ZahtevaTwilio = zahtevaTwilio,
  zdaj: number = Date.now(),
  odZa: { od: string; za: string } | null = null,
): Promise<boolean> {
  try {
    pocisti(zdaj);
    const n = narocene.get(callSid);
    if (!n || !SID_KLICA.test(callSid)) return false;
    // From in To klica so ob prvi sprejeti zahtevi vezana: poznavalec CallSid jih pozneje ne more spremeniti (SREDNJE-1).
    if (odZa) {
      if (!n.vezano) n.vezano = odZa;
      else if (n.vezano.od !== odZa.od || n.vezano.za !== odZa.za) return false;
    }
    if (zdaj < n.preverjenDo) return true;
    const r = await preberi(resolveDataDir(dir));
    if (!r) return false;
    const odg = await merjeno("twilioRest", () => zahteva(`${OSNOVA}Accounts/${r.sid}/Calls/${callSid}.json`, { method: "GET", headers: glava(r.sid, r.kljucSid, r.skrivnost) }));
    const j = (odg.json ?? {}) as Record<string, unknown>;
    const veljaven = odg.status === 200 && j.sid === callSid && j.direction === "outbound-api" && j.to === n.kam && typeof j.status === "string" && STANJA.has(j.status);
    if (!veljaven) {
      // Prehoden 429/5xx ne izbrise narocila (NIZKO-1); izbrise samo jasen »ne« (200 z drugo vsebino ali 404).
      if (odg.status === 200 || odg.status === 404) narocene.delete(callSid);
      return false;
    }
    n.preverjenDo = zdaj + ROK_PREVERBE_MS;
    return true;
  } catch {
    return false;
  }
}

/** Kljuc ponovitve namesto podpisa (ki ga preizkusni racun ne poslje). */
export function kljucBrezPodpisa(naslovPodpisa: string, params: Record<string, string>): string {
  return twilioSignature(procesnaSkrivnost, naslovPodpisa, params);
}
