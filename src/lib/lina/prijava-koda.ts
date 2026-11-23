/**
 * Oblika verifikacijske kode Googla pri prijavi brez brskalnika (gcloud »enter the verification code«). Skupna preverba za vmesnik
 * (omogoci gumb) in streznik (zavrne vse drugo, preden se karkoli zapise na stdin gcloud): ena vrstica, brez presledkov in
 * krmilnih znakov, 10 do 512 znakov iz nabora, ki ga Google uporablja za kode (crke, stevilke, _ - / . ~ + =).
 * Kode same ne hranimo nikjer (ne v stanju, ne v dnevniku).
 */
export const NAJMANJ_ZNAKOV_KODE = 10;
export const NAJVEC_ZNAKOV_KODE = 512;

const OBLIKA_KODE = /^[A-Za-z0-9_\-/.~+=]+$/;

export function jeVeljavnaKodaPrijave(koda: unknown): koda is string {
  if (typeof koda !== "string") return false;
  const cista = koda.trim();
  return cista.length >= NAJMANJ_ZNAKOV_KODE && cista.length <= NAJVEC_ZNAKOV_KODE && OBLIKA_KODE.test(cista);
}
