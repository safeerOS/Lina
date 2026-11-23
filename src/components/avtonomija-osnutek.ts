/**
 * Osvezitev stanja Samostojnih opravil ne sme prepisati tega, kar je lastnik v obrazcu ze spremenil, a se ni shranil (N11):
 * kljuci iz `umazano` (vrsta opravila ali »ura«) obdrzijo lokalni osnutek, vsi drugi vzamejo vrednost s streznika.
 * Kljuci so natanko tisti s streznika: opravilo, ki ga streznik ne pozna vec, odpade; novo dobi streznikov osnutek.
 * Cista funkcija brez React-a, da jo preizkusi node:test.
 */
export function zdruziOsnutke<T>(
  prej: Readonly<Record<string, T>>,
  streznik: Readonly<Record<string, T>>,
  umazano: ReadonlySet<string>,
): Record<string, T> {
  const izid: Record<string, T> = {};
  for (const kljuc of Object.keys(streznik)) {
    const vrednost = umazano.has(kljuc) && Object.hasOwn(prej, kljuc) ? (prej[kljuc] as T) : (streznik[kljuc] as T);
    // defineProperty, ne dodelitev: kljuc »__proto__« bi z dodelitvijo zamenjal prototip izida.
    Object.defineProperty(izid, kljuc, { value: vrednost, enumerable: true, writable: true, configurable: true });
  }
  return izid;
}
