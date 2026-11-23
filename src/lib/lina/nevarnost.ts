/**
 * Nevarnost v izreku klicatelja (lastnik 22. 11. 2026, enako kot na telefonu): ce klicatelj opise nesreco, pozar, nasilje ali nujno
 * zdravstveno stanje, mu Lina TAKOJ rece, naj poklice 112, in izrek zapise kot nujno sporocilo. Odloca koda (ne model): stavek je
 * stalen, brez stevk (varovalo osebne tajnice prepove stevke; »sto dvanajst« z besedami).
 * Vzorci so ozki: raje zgresen kot napacen alarm pri obicajnem sporocilu (»kapa«, »gori lucka«, »napad« v sportu).
 */
import { fold } from "./guards.ts";

const VZORCI: RegExp[] = [
  /\bv (smrtni |zivljenjski )?nevarnosti\b/,
  /\b(prometna |huda |delovna )nesrec/,
  /\bnesrec[aoi]\b.*\b(poskodovan|ranjen|krvav|ne diha|nezavest)/,
  /\bpozar\b|\bgori (hisa|stanovanje|blok|avto|kuhinja|streha|gozd|pri nas|nam|mi)\b|\bzagorel[oai]?\b/,
  /\bne diha\b|\bne morem dihati\b|\bnehal[ai]? dihati\b|\bse dusi(m)?\b|\bdusim se\b/,
  /\bnezavest|\bizgubil[ai]? zavest\b|\bse je zgrudil[ai]?\b|\bse ne odziva\b/,
  /\b(mocno|hudo) krvavi|\bkrvavi(m)? (iz|mocno|hudo)\b/,
  /\b(srcni|epilepticni|astmaticni) napad\b|\binfarkt\b|\b(mozganska|srcna) kap\b|\bzadela (ga|jo|me) je kap\b/,
  /\b(napadel|napadla|napadli|pretepa|pretepel|pretepli|davi|zabodel|zabodla|ustrelil[ai]?) (me|ga|jo|nas|nekoga)\b|\b(me|ga|jo|nas) (je |so )?(napadel|napadla|napadli|pretepel|pretepli|zabodel|zabodla)\b/,
  /\bgrozi (mi|nam) z (nozem|orozjem|pistolo|smrtjo)\b|\b(vlomilec|vlamljajo|vlomili so) /,
  /\bumiram\b|\b(oce|mama|moz|zena|otrok|sin|hci|nekdo|clovek|sosed|soseda) umira\b|\bbom umrl[ai]?\b|\bzastrupil[ai]? (sem )?se\b|\bzastrupitev\b/,
  /\bklicite (resilce|resevalce|gasilce|policijo)\b|\bpoklicite (resilce|resevalce|gasilce|policijo)\b|\bpotrebujem(o)? (resilce|resevalce|nujno medicinsko pomoc)\b/,
];

/** True, ce izrek opisuje nevarnost, nesreco ali nujno zdravstveno stanje. */
export function jeNevarnost(izrek: string): boolean {
  const s = fold(izrek).replace(/[^\p{L}\s]+/gu, " ").replace(/\s+/g, " ").trim();
  if (!s) return false;
  return VZORCI.some((v) => v.test(s));
}
