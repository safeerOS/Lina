/**
 * Stanje za lupino programa (okno in ikona Line, lastnik 10. 11. in 12. 11. 2026: »Lina je pravi program«, tece v ozadju).
 * Lupina mora vedeti, ali je linija odprta in ali klic tece, sicer bi zaprtje okna ustavilo Lino sredi klica.
 * Zeton (LINA_LUPINA_ZETON) ustvari lupina ob zagonu in ga da samo temu procesu; brez njega 403. Pot ni za javni naslov:
 * zahteva mora biti z istega racunalnika (brez glav posrednika), tunel in Caddy posredujeta samo /api/voice/.
 */
import { timingSafeEqual } from "node:crypto";
import { izvorIzGlav, jeLokalnaZahteva } from "./origin.ts";
import { loadLine } from "./service.server.ts";
import { resolveDataDir } from "./store.server.ts";
import { klicTece } from "./voice.server.ts";

export const POT_LUPINE = "/api/lupina";
export const GLAVA_LUPINE = "x-lina-lupina";
/** Lupina da 32 nakljucnih bajtov v hex (64 znakov); krajsi zeton pomeni napacno nastavitev in velja kot brez zetona. */
export const NAJKRAJSI_ZETON = 32;

export type StanjeLupine = { linija: "odprta" | "zaprta"; klicVTeku: boolean };

export function veljavenZetonLupine(dan: string | null | undefined, pricakovan: string | null | undefined): boolean {
  if (!pricakovan || pricakovan.length < NAJKRAJSI_ZETON || !dan || dan.length !== pricakovan.length) return false;
  return timingSafeEqual(Buffer.from(dan), Buffer.from(pricakovan));
}

/** Linija, ki caka na odprtje, steje kot odprta: raje vprasati ob zaprtju kot tiho ustaviti sprejem klicev. */
export function stanjeLupine(linija: { open: boolean; caka?: boolean }, klic: boolean): StanjeLupine {
  return { linija: linija.open || linija.caka ? "odprta" : "zaprta", klicVTeku: klic };
}

export async function handleLupinaRequest(
  request: Request,
  naslov: string | null | undefined,
  dir?: string,
  zeton: string | undefined = process.env.LINA_LUPINA_ZETON,
): Promise<Response> {
  const glave = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  if (request.method !== "GET" || !jeLokalnaZahteva(izvorIzGlav(naslov, request.headers))
    || !veljavenZetonLupine(request.headers.get(GLAVA_LUPINE), zeton)) {
    return new Response('{"napaka":"prepovedano"}', { status: 403, headers: glave });
  }
  const root = resolveDataDir(dir);
  const stanje = stanjeLupine(await loadLine(root), klicTece(root));
  return new Response(JSON.stringify(stanje), { status: 200, headers: glave });
}
