/**
 * Prikaz id-ja naprave za primerjavo na dveh zaslonih (T6-04, 15. 11. 2026): kdor vidi QR ali okno kode, se lahko prvi
 * prijavi s poljubnim imenom, zato lastnik pri »Dodaj« ne sme zaupati samo imenu. Id (n-<16 hex iz kljuca naprave>) se
 * prikaze v skupinah po 4 in je na telefonu isti niz (Android: IdNaprave.vSkupinah, skupni vektor vektorji-id-v1.json).
 * Ne spreminja protokola ali podpisov; samo oblikovanje. Neveljaven id da null (ne ugibamo).
 */
const ID_NAPRAVE = /^n-([0-9a-f]{16})(-[A-Za-z0-9._-]{1,100})?$/;

export function idVSkupinah(id: string): string | null {
  const m = ID_NAPRAVE.exec(id);
  if (!m) return null;
  return (m[1].match(/.{4}/g) as string[]).join(" ") + (m[2] ?? "");
}
