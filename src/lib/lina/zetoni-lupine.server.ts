/**
 * Naloga 11 N2: zetona, ki ju lupina da strezniku v okolju (LINA_LUPINA_ZETON za okno, LINA_KONCAJ_ZETON za »--koncaj« v skripti
 * posodobitve). Ob zagonu (vticnik lina-zagon) se prebereta v pomnilnik procesa in odstranita iz process.env, da ju otroci (RSDO, docker,
 * namestitve, CLI) ne podedujejo. globalThis: vticnik in obdelava zahtev sta locena svezenja kode.
 * Meja je geslo lastnika: proces istega uporabnika lahko bere pomnilnik ali /proc tega procesa; zetona locita samo procese DRUGEGA
 * uporabnika in tujo kodo v otrocih, ne pa zlonamernega procesa lastnika. Komentarji brez sumnikov.
 */
const KLJUC = Symbol.for("lina.zetoni.lupine");

export type ZetoniLupine = { lupina?: string; koncaj?: string };

export function prevzemiZetone(env: NodeJS.ProcessEnv = process.env): ZetoniLupine {
  const g = globalThis as { [KLJUC]?: ZetoniLupine };
  const z = (g[KLJUC] ??= {});
  if (env.LINA_LUPINA_ZETON) z.lupina = env.LINA_LUPINA_ZETON;
  if (env.LINA_KONCAJ_ZETON) z.koncaj = env.LINA_KONCAJ_ZETON;
  delete env.LINA_LUPINA_ZETON;
  delete env.LINA_KONCAJ_ZETON;
  return { ...z };
}

export const zetonLupine = (): string | undefined => prevzemiZetone().lupina;
export const zetonKoncaja = (): string | undefined => prevzemiZetone().koncaj;
