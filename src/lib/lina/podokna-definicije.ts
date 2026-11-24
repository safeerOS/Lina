import type { Beseda } from "./besedila.ts";

/**
 * Razvrstitev razdelkov v podokna za zavihka Nastavitve in Znanje (lastnik 15. 11. 2026). Cista podatkovna datoteka brez Reacta:
 * komponenta Podokna (components/podokna.tsx) in preizkusi berejo isto tabelo. Zavihki, ki niso daljsi od enega zaslona
 * (Klic, Narocila/Sporocila, Dnevnik, Zapiski, Linija, Telefon), podoken nimajo.
 */
export type PodoknoDef = {
  readonly id: string;
  readonly oznaka: Beseda;
  readonly razdelki: readonly string[];
  /** Dodatna sidra (npr. obstojeci id ovitka #nast-pravila), ki odprejo to podokno. */
  readonly sidra?: readonly string[];
};

export type DefinicijaPodoken = {
  /** Predpona id-jev v DOM in del kljuca localStorage. */
  readonly predpona: string;
  /** Naziv seznama podoken (aria-label). */
  readonly naziv: Beseda;
  readonly podokna: ReadonlyArray<PodoknoDef>;
};

export const NASTAVITVE = {
  predpona: "nast",
  naziv: "nastPodNaslov",
  podokna: [
    { id: "prevzem", oznaka: "nastPodPrevzem", razdelki: ["pr-prevzem", "pr-nacin", "pr-predpone"], sidra: ["nast-pravila"] },
    { id: "pozdrav", oznaka: "nastPodPozdrav", razdelki: ["pr-pozdrav", "pr-pogovor"] },
    { id: "javni", oznaka: "nastPodJavni", razdelki: ["pr-javni"], sidra: ["pr-povezava"] },
    { id: "twilio", oznaka: "nastPodTwilio", razdelki: ["pr-twilio"] },
    { id: "iphone", oznaka: "nastPodIphone", razdelki: ["nast-iphone"], sidra: ["iphone"] },
    { id: "odgovori", oznaka: "nastPodOdgovori", razdelki: ["pr-tema", "pr-garancija", "pr-dostava"] },
    { id: "potrditev", oznaka: "nastPodPotrditev", razdelki: ["pr-potrditev"] },
    { id: "mozgani", oznaka: "nastPodMozgani", razdelki: ["nast-mozgani"] },
    { id: "podatki", oznaka: "nastPodPodatki", razdelki: ["nast-shranjevanje", "mapa-zapiskov", "pr-snemanje"] },
    { id: "dodatki", oznaka: "uiDodatkiNaslov", razdelki: ["nast-dodatki"] },
    { id: "strani", oznaka: "nastPodStrani", razdelki: ["nast-strani"] },
    { id: "narocila", oznaka: "nastPodNarocila", razdelki: ["nast-narocila"] },
    { id: "dovoljenja", oznaka: "nastPodDovoljenja", razdelki: ["nast-dovoljenja"] },
    { id: "posodobitev", oznaka: "posNaslov", razdelki: ["nast-posodobitev"] },
    { id: "github", oznaka: "nastPodGithub", razdelki: ["nast-github"] },
    { id: "agenti", oznaka: "nastPodAgenti", razdelki: ["nast-agenti"] },
    { id: "olini", oznaka: "nastPodOLini", razdelki: ["nast-o-lini"] },
  ],
} as const satisfies DefinicijaPodoken;

export const ZNANJE = {
  predpona: "znanje",
  naziv: "znPodNaslov",
  podokna: [
    { id: "podjetje", oznaka: "znPodPodjetje", razdelki: ["zn-podjetje", "znanje-besedilo"] },
    { id: "povprasevanje", oznaka: "znPodPovprasevanje", razdelki: ["povprasevanje"] },
    { id: "izdelki", oznaka: "znPodIzdelki", razdelki: ["zn-izdelki"] },
    { id: "splet", oznaka: "znPodSplet", razdelki: ["splet-naslov"] },
    { id: "vrzeli", oznaka: "znPodVrzeli", razdelki: ["zn-vrzeli"] },
    { id: "kljuci", oznaka: "znPodKljuci", razdelki: ["zn-kljuci"] },
    { id: "spomin", oznaka: "znPodSpomin", razdelki: ["zn-nujni", "zn-spomin"], sidra: ["nujni"] },
    { id: "avtonomija", oznaka: "samostojnoNaslov", razdelki: ["zn-avtonomija"] },
  ],
} as const satisfies DefinicijaPodoken;

export type PodoknoNastavitev = (typeof NASTAVITVE)["podokna"][number]["id"];
export type PodoknoZnanja = (typeof ZNANJE)["podokna"][number]["id"];

const KLJUC_PREDPONA = "lina.podokno.";

export function jePodoknoId(def: DefinicijaPodoken, vrednost: unknown): boolean {
  return def.podokna.some((podokno) => podokno.id === vrednost);
}

/**
 * Pretvori sidro (#nast-iphone, pr-nacin, nast-pravila, id podokna ali id plosce) v id podokna iz tabele definicij.
 * Ce sidro ne pripada nobenemu podoknu v tabeli, vrne null.
 */
export function podoknoZaRazdelek(def: DefinicijaPodoken, sidro: string): string | null {
  const cisto = sidro.replace(/^#/, "").trim();
  if (!cisto) return null;
  for (const podokno of def.podokna) {
    if (
      podokno.id === cisto ||
      `${def.predpona}-podokno-${podokno.id}` === cisto ||
      `${def.predpona}-zavihek-${podokno.id}` === cisto ||
      podokno.razdelki.includes(cisto) ||
      Boolean(podokno.sidra?.includes(cisto))
    ) {
      return podokno.id;
    }
  }
  return null;
}

/**
 * Izbere samo podokna, ki imajo vsaj en viden razdelek (npr. v osebnem nacinu so vsi poslovni razdelki v
 * podoknu »Odgovori« skriti, zato se celo podokno ne prikaze v traku).
 */
export function filtrirajPodokna(
  def: DefinicijaPodoken,
  vidniRazdelki: Readonly<Record<string, unknown>>,
): DefinicijaPodoken {
  const podokna = def.podokna.filter((podokno) =>
    podokno.razdelki.some((r) => {
      const vrednost = vidniRazdelki[r];
      return vrednost !== null && vrednost !== undefined && vrednost !== false;
    }),
  );
  return { ...def, podokna };
}

/** Zapomnjeno podokno; brez shrambe (zasebno okno, blokirani podatki, streznik) ali z neveljavno vrednostjo vrne null. */
export function preberiPodokno(def: DefinicijaPodoken, shramba?: Pick<Storage, "getItem"> | null): string | null {
  try {
    const vrednost = (shramba ?? window.localStorage).getItem(KLJUC_PREDPONA + def.predpona);
    return jePodoknoId(def, vrednost) ? vrednost : null;
  } catch {
    return null;
  }
}

export function shraniPodokno(def: DefinicijaPodoken, id: string, shramba?: Pick<Storage, "setItem"> | null): void {
  try {
    (shramba ?? window.localStorage).setItem(KLJUC_PREDPONA + def.predpona, id);
  } catch {
    /* Brez shrambe stran dela naprej; izbira se samo ne zapomni. */
  }
}

export function kljucPodokna(def: DefinicijaPodoken): string {
  return KLJUC_PREDPONA + def.predpona;
}

/** Tipkovnica po vzorcu WAI-ARIA tablist: puscice (obe smeri, ker je seznam na ozkem zaslonu vodoraven, na sirokem navpicen), Home, End. */
export function naslednjePodokno(def: DefinicijaPodoken, trenutno: string, tipka: string): string | null {
  const n = def.podokna.length;
  if (n === 0) return null;
  const vrstni = def.podokna.findIndex((podokno) => podokno.id === trenutno);
  if (vrstni < 0) return null;
  if (tipka === "ArrowRight" || tipka === "ArrowDown") return def.podokna[(vrstni + 1) % n].id;
  if (tipka === "ArrowLeft" || tipka === "ArrowUp") return def.podokna[(vrstni - 1 + n) % n].id;
  if (tipka === "Home") return def.podokna[0].id;
  if (tipka === "End") return def.podokna[n - 1].id;
  return null;
}
