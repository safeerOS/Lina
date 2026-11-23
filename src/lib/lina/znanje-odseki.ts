import { fold } from "./guards.ts";

/**
 * Izbira odsekov iz velikega znanja podjetja (lastnik 12. 11. 2026: podjetja z veliko izdelki, npr. nekaj tisoc).
 * Celotno znanje v vsak klic bi podaljsalo odgovor in stalo; modelu damo samo odseke, ki ustrezajo izreku klicatelja.
 * Cifre in naslove odgovora se se vedno preverja proti CELOTNEMU znanju (odgovor-znanje.ts), zato izbira ne more
 * dodati ali spremeniti dejstva, samo zmanjsa, kaj model vidi.
 */
export const MEJA_ODSEKA = 600;

/** Besedilo na odseke: prazne vrstice, predolge odstavke pa po vrsticah in stavkih na najvec MEJA_ODSEKA znakov. */
export function razdeliNaOdseke(znanje: string): string[] {
  const odseki: string[] = [];
  for (const odstavek of znanje.split(/\n{2,}/)) {
    const cist = odstavek.trim();
    if (!cist) continue;
    if (cist.length <= MEJA_ODSEKA) {
      odseki.push(cist);
      continue;
    }
    let trenutni = "";
    for (const kos of cist.split(/(?<=[.!?\n])\s+/)) {
      if (trenutni && trenutni.length + kos.length + 1 > MEJA_ODSEKA) {
        odseki.push(trenutni);
        trenutni = "";
      }
      trenutni = trenutni ? `${trenutni} ${kos}` : kos;
      while (trenutni.length > MEJA_ODSEKA) {
        odseki.push(trenutni.slice(0, MEJA_ODSEKA));
        trenutni = trenutni.slice(MEJA_ODSEKA);
      }
    }
    if (trenutni) odseki.push(trenutni);
  }
  return odseki;
}

/** Koren besede (prvih 5 znakov): sklanjatve »pomivalni/pomivalnega« se ujamejo. Kratke besede so brez pomena. */
function koreni(text: string): string[] {
  const besede = fold(text).match(/[a-z0-9]{3,}/g) ?? [];
  return [...new Set(besede.map((b) => (/\d/.test(b) ? b : b.slice(0, 5))))];
}

/**
 * Vrne najvec `meja` znakov odsekov, razvrscenih po ustreznosti izreku, v izvirnem vrstnem redu. Prvi odsek (predstavitev
 * podjetja) je vedno zraven. Kratko znanje se vrne celo.
 */
export function izberiOdseke(znanje: string, izrek: string, meja: number): string {
  if (znanje.length <= meja) return znanje;
  const odseki = razdeliNaOdseke(znanje);
  const poizvedba = koreni(izrek);
  const kazalo = odseki.map((o) => new Set(koreni(o)));
  const df = new Map<string, number>();
  for (const k of poizvedba) df.set(k, kazalo.filter((s) => s.has(k)).length);
  const ocene = odseki.map((_, i) => {
    let ocena = 0;
    for (const k of poizvedba) if (kazalo[i].has(k)) ocena += Math.log(1 + odseki.length / (df.get(k) || 1));
    return ocena;
  });
  const vrstni = odseki
    .map((_, i) => i)
    .filter((i) => i > 0 && ocene[i] > 0)
    .sort((a, b) => ocene[b] - ocene[a] || a - b);
  const izbrani = new Set<number>();
  let poraba = 0;
  const dodaj = (i: number): void => {
    if (izbrani.has(i) || poraba + odseki[i].length + 1 > meja) return;
    izbrani.add(i);
    poraba += odseki[i].length + 1;
  };
  dodaj(0);
  for (const i of vrstni) dodaj(i);
  // Brez zadetkov ali z ostankom prostora: zacetek znanja po vrsti.
  for (let i = 1; i < odseki.length && poraba < meja; i++) if (!vrstni.length) dodaj(i);
  return [...izbrani].sort((a, b) => a - b).map((i) => odseki[i]).join("\n");
}
