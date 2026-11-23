/**
 * Neobvezen dokaz nadzora nad domeno spletne strani podjetja (naloga #44, predlog lastnika 21. 11. 2026).
 * CISTA enota: brez omrezja in brez DNS. Streznik (kasneje) prebere TXT zapise in datoteko, ta modul odloca.
 *
 * Nacela:
 * - To je samo OZNAKA »uporabnik dokazljivo upravlja to domeno«. NIKOLI ni vrata: lastnik 21. 11. 2026 - tajnica se uci iz
 *   strani, ki jih uporabnik vnese, in uporabnika ne omejujemo. Oznaka ne pomeni, da Lina jamci za podjetje.
 * - Dokaz je vezan na TOCNO ta gostitelj (ali njegovo poddomeno), ne na sorodno ime. Poteka (domene menjajo lastnike).
 * - Dve poti: TXT zapis na _lina-preverjanje.<domena> ali besedilna datoteka /.well-known/lina-preverjanje.txt.
 *   Datoteka mora vsebovati SAMO zeton (cela vsebina), da navadna stran z zetonom nekje v besedilu ne velja.
 */

export const PREDPONA_TXT = "lina-preverjanje=";
export const IME_TXT_PREDPONA = "_lina-preverjanje";
export const POT_DATOTEKE = "/.well-known/lina-preverjanje.txt";
export const NAJMANJ_BAJTOV_ZETONA = 16;
export const NAJVEC_BAJTOV_DATOTEKE = 200;
export const VELJAVNOST_DNI = 180;

const ZETON = /^[a-f0-9]{32,64}$/;
const OZNAKA_DNS = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DAN_MS = 24 * 60 * 60 * 1000;

/** Zeton iz nakljucnih bajtov (klicatelj poda crypto.randomBytes). Premalo bajtov = napaka, nikoli slab zeton. */
export function zetonIzBajtov(bajti: Uint8Array): string {
  if (bajti.length < NAJMANJ_BAJTOV_ZETONA) throw new Error("Zeton potrebuje vsaj 16 nakljucnih bajtov.");
  const izrez = bajti.slice(0, 32);
  let izid = "";
  for (const b of izrez) izid += b.toString(16).padStart(2, "0");
  return izid;
}

export function jeVeljavenZeton(vrednost: unknown): vrednost is string {
  return typeof vrednost === "string" && ZETON.test(vrednost);
}

/** Gostitelj v malih crkah brez pike na koncu, samo veljavne oznake DNS (ne IP, ne localhost). Sicer null. */
export function normirajGostitelja(vhod: unknown): string | null {
  if (typeof vhod !== "string") return null;
  const g = vhod.trim().toLowerCase().replace(/\.$/, "");
  if (!g || g.length > 253) return null;
  const oznake = g.split(".");
  if (oznake.length < 2) return null;
  if (!oznake.every((o) => OZNAKA_DNS.test(o))) return null;
  if (/^\d+$/.test(oznake[oznake.length - 1] ?? "")) return null;
  if (g === "localhost" || g.endsWith(".localhost") || g.endsWith(".local") || g.endsWith(".internal")) return null;
  return g;
}

/** Kje naj uporabnik objavi TXT zapis. */
export function imeTxtZapisa(gostitelj: string): string | null {
  const g = normirajGostitelja(gostitelj);
  return g ? `${IME_TXT_PREDPONA}.${g}` : null;
}

/** Vrednost TXT zapisa, ki jo uporabnik prilepi. */
export function vrednostTxtZapisa(zeton: string): string {
  if (!jeVeljavenZeton(zeton)) throw new Error("Neveljaven zeton.");
  return `${PREDPONA_TXT}${zeton}`;
}

/** Zapisi iz dns.resolveTxt (vsak zapis je seznam kosov) ali ze zdruzeni nizi. Ujemanje samo celega zapisa. */
export function preveriTxtZapise(zapisi: ReadonlyArray<string | ReadonlyArray<string>>, zeton: string): boolean {
  if (!jeVeljavenZeton(zeton)) return false;
  const pricakovano = vrednostTxtZapisa(zeton);
  for (const zapis of zapisi) {
    const celoten = (typeof zapis === "string" ? zapis : zapis.join("")).trim();
    if (celoten === pricakovano) return true;
  }
  return false;
}

/** Telo datoteke: cela vsebina (po obrezovanju) je zeton ali lina-preverjanje=<zeton>. HTML ali daljse besedilo ne velja. */
export function preveriTeloDatoteke(telo: string | Uint8Array, zeton: string): boolean {
  if (!jeVeljavenZeton(zeton)) return false;
  const bajti = typeof telo === "string" ? new TextEncoder().encode(telo) : telo;
  if (bajti.length === 0 || bajti.length > NAJVEC_BAJTOV_DATOTEKE) return false;
  const besedilo = new TextDecoder("utf-8", { fatal: false }).decode(bajti).trim();
  return besedilo === zeton || besedilo === `${PREDPONA_TXT}${zeton}`;
}

export type PotrditevDomene = { domena: string; potrjenoOb: string };

/** Ali je dokaz se veljaven (ne potece, ni iz prihodnosti). */
export function jeDokazVeljaven(potrjenoOb: string, zdaj: Date): boolean {
  const cas = Date.parse(potrjenoOb);
  if (!Number.isFinite(cas)) return false;
  const razlika = zdaj.getTime() - cas;
  if (razlika < 0) return false;
  return razlika < VELJAVNOST_DNI * DAN_MS;
}

/** Potrjena domena pokrije sebe in svoje poddomene, nikoli starsa ali sorodnega imena (podjetje.si.evil.com, evilpodjetje.si). */
export function jeGostiteljPotrjen(gostitelj: string, potrditve: ReadonlyArray<PotrditevDomene>, zdaj: Date): boolean {
  const g = normirajGostitelja(gostitelj);
  if (!g) return false;
  for (const p of potrditve) {
    const d = normirajGostitelja(p.domena);
    if (!d || !jeDokazVeljaven(p.potrjenoOb, zdaj)) continue;
    if (g === d || g.endsWith(`.${d}`)) return true;
  }
  return false;
}

/**
 * Opozorilo ob dodajanju strani: mednarodni znaki (punycode xn-- ali ne-ASCII) so pogosti v lazih domenah.
 * Samo opozorilo uporabniku, ne zavrnitev (lastnik: uporabnika ne omejujemo).
 */
export function opozoriloPodobneDomene(gostitelj: string): "mednarodni-znaki" | null {
  const g = gostitelj.trim().toLowerCase().replace(/\.$/, "");
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7f]/.test(g)) return "mednarodni-znaki";
  if (g.split(".").some((o) => o.startsWith("xn--"))) return "mednarodni-znaki";
  return null;
}
