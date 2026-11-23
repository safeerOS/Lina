/**
 * Zamaknjen (hedge) zacetek dela: delo se zacne po zamiku, ce nadzorovana obljuba (npr. razumevanje) do takrat ni koncana.
 * Namen: odgovor, ki bi sicer cakal na pocasen klic, tece vzporedno samo takrat, ko je cakanje verjetno (brez odvecnih klicev
 * ob hitrem odgovoru). Zavrnitev zacetega dela se pobere, da ni neobravnavana; kdor delo vzame, jo vidi.
 * preklici(): izid ni vec potreben (npr. razumevanje je odgovorilo samo): delo dobi AbortSignal in se ustavi (pregled B1),
 * ce se se ni zacelo, se ne zacne.
 */
export type Hedge<T> = { zacet(): Promise<T> | null; preklici(): void };

export function hedge<T>(delo: (signal: AbortSignal) => Promise<T>, zamikMs: number, nadzor: Promise<unknown>): Hedge<T> {
  const krmilo = new AbortController();
  let tek: Promise<T> | null = null;
  let casovnik: ReturnType<typeof setTimeout> | undefined;
  const zacni = (): void => {
    if (tek || krmilo.signal.aborted) return;
    tek = delo(krmilo.signal);
    tek.catch(() => undefined);
  };
  if (zamikMs <= 0) {
    zacni();
  } else {
    casovnik = setTimeout(zacni, zamikMs);
    casovnik.unref?.();
    const konec = (): void => clearTimeout(casovnik);
    nadzor.then(konec, konec);
  }
  return {
    zacet: () => tek,
    preklici: () => {
      if (casovnik) clearTimeout(casovnik);
      krmilo.abort();
    },
  };
}
