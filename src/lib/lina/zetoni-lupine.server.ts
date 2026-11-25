/**
 * Naloga 11 N2: zetona, ki ju lupina da strezniku v okolju (LINA_LUPINA_ZETON za okno, LINA_KONCAJ_ZETON za »--koncaj« v skripti
 * posodobitve). Ob zagonu (vticnik lina-zagon) se prebereta v pomnilnik procesa in odstranita iz process.env, da ju otroci (RSDO, docker,
 * namestitve, CLI) ne podedujejo. globalThis: vticnik in obdelava zahtev sta locena svezenja kode.
 * Meja je geslo lastnika: proces istega uporabnika lahko bere pomnilnik ali /proc tega procesa; zetona locita samo procese DRUGEGA
 * uporabnika in tujo kodo v otrocih, ne pa zlonamernega procesa lastnika. Komentarji brez sumnikov.
 */
const KLJUC = Symbol.for("lina.zetoni.lupine");

export type ZetoniLupine = { lupina?: string; koncaj?: string };

/**
 * Naloga 12 #6: prevzem velja ENKRAT (prvi klic: vticnik ob zagonu ali prvi getter); kasnejsa vrednost v okolju (nalaganje okolja,
 * vticnik, orodje) zetona ne prepise - iz okolja se samo odstrani z opozorilom.
 */
export function prevzemiZetone(env: NodeJS.ProcessEnv = process.env): ZetoniLupine {
  const g = globalThis as { [KLJUC]?: ZetoniLupine & { prevzeto?: boolean } };
  const z = (g[KLJUC] ??= {});
  if (!z.prevzeto) {
    if (env.LINA_LUPINA_ZETON) z.lupina = env.LINA_LUPINA_ZETON;
    if (env.LINA_KONCAJ_ZETON) z.koncaj = env.LINA_KONCAJ_ZETON;
    z.prevzeto = true;
  } else if (env.LINA_LUPINA_ZETON || env.LINA_KONCAJ_ZETON) {
    console.error("lina: zeton lupine v okolju po zagonu je prezrt in odstranjen");
  }
  delete env.LINA_LUPINA_ZETON;
  delete env.LINA_KONCAJ_ZETON;
  const { prevzeto: _, ...zetoni } = z;
  return zetoni;
}

export const zetonLupine = (): string | undefined => prevzemiZetone().lupina;
export const zetonKoncaja = (): string | undefined => prevzemiZetone().koncaj;
