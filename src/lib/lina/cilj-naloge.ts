/**
 * Cilj naloge agenta (23. 11. 2026; zamisel iz DeerFlow »Session Goals«, MIT - koda ni prevzeta). Po vsakem obratu agenta model
 * oceni izid proti cilju in vrne tipizirano oviro z dokazom; to pravilo odloci, ali Lina nadaljuje sama ali se ustavi in pove zakaj.
 * Samo cisto pravilo: vezave na izvajalca ni (caka odlocitev lastnika o vodenju agentov, nacrt_nadgradnje_lina.md tocka 1).
 * Nadaljevanje nikoli ne razsiri obsega: velja ista podpisana naloga, potrditve na telefonu ostanejo.
 */
export const OVIRE = ["dosezeno", "cilj-se-ni-dosezen", "manjka-dokaz", "potrebuje-lastnika", "zunanje-cakanje", "napaka-izvedbe"] as const;
export type Ovira = (typeof OVIRE)[number];
export type Ocena = { ovira: Ovira; dokaz: string };

/** Strop samodejnih nadaljevanj na nalogo in zaporednih enakih izidov (DeerFlow privzeto 8 in 2). */
export const NAJVEC_NADALJEVANJ = 8;
export const NAJVEC_BREZ_NAPREDKA = 2;

export type StanjeCilja = { nadaljevanj: number; brezNapredka: number; zadnjiIzid: string };
export type Odlocitev =
  | { vrsta: "nadaljuj" }
  | { vrsta: "koncano" }
  | { vrsta: "ustavi"; razlog: Exclude<Ovira, "dosezeno" | "cilj-se-ni-dosezen"> | "strop" | "brez-napredka" };

export const zacetnoStanje = (): StanjeCilja => ({ nadaljevanj: 0, brezNapredka: 0, zadnjiIzid: "" });

/** Ocena modela je nezaupan JSON: brez znane ovire ali brez dokaza je neveljavna (null), kar nikoli ne pomeni nadaljevanja. */
export function razberiOceno(besedilo: string): Ocena | null {
  try {
    const o = JSON.parse(besedilo) as { ovira?: unknown; dokaz?: unknown };
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    if (!(OVIRE as readonly unknown[]).includes(o.ovira)) return null;
    if (typeof o.dokaz !== "string" || !o.dokaz.trim()) return null;
    return { ovira: o.ovira as Ovira, dokaz: o.dokaz.trim().slice(0, 500) };
  } catch {
    return null;
  }
}

/** Koliko izida vidi model ocene; daljsi izid ni v celoti ocenjen, zato najvec »manjka-dokaz« (A8). */
export const NAJVEC_ZNAKOV_IZIDA = 3000;

/** Izid v pozivu ocene je med <<< in >>>: izid sam teh oznak ne sme vsebovati (sicer bi ponaredil konec podatka, A8). */
export function ubeziIzid(izid: string): string {
  return izid.replace(/<<</g, "‹‹‹").replace(/>>>/g, "›››");
}

/**
 * »dosezeno« velja samo, ce je dokaz dobesedno v izidu (surovem ali v obliki, ki jo je videl model: zakrite poti, ubezne oznake) in je bil
 * izid ocenjen v celoti; sicer »manjka-dokaz« (A8: model ocene lahko dokaz izmisli ali ga izid podtakne).
 */
function dokazVIzidu(dokaz: string, izid: string): boolean {
  if (!dokaz.trim() || izid.length > NAJVEC_ZNAKOV_IZIDA) return false;
  return izid.includes(dokaz) || ubeziIzid(zakrijSkrivnosti(izid)).includes(dokaz);
}

export function odlociNadaljevanje(stanje: StanjeCilja, ocena: Ocena, izid: string): { stanje: StanjeCilja; odlocitev: Odlocitev } {
  if (ocena.ovira === "dosezeno") {
    return { stanje, odlocitev: dokazVIzidu(ocena.dokaz, izid) ? { vrsta: "koncano" } : { vrsta: "ustavi", razlog: "manjka-dokaz" } };
  }
  if (ocena.ovira !== "cilj-se-ni-dosezen") return { stanje, odlocitev: { vrsta: "ustavi", razlog: ocena.ovira } };
  const istiIzid = izid.trim() === stanje.zadnjiIzid;
  const novo: StanjeCilja = { nadaljevanj: stanje.nadaljevanj, brezNapredka: istiIzid ? stanje.brezNapredka + 1 : 0, zadnjiIzid: izid.trim() };
  if (novo.brezNapredka >= NAJVEC_BREZ_NAPREDKA) return { stanje: novo, odlocitev: { vrsta: "ustavi", razlog: "brez-napredka" } };
  if (stanje.nadaljevanj >= NAJVEC_NADALJEVANJ) return { stanje: novo, odlocitev: { vrsta: "ustavi", razlog: "strop" } };
  return { stanje: { ...novo, nadaljevanj: stanje.nadaljevanj + 1 }, odlocitev: { vrsta: "nadaljuj" } };
}

/**
 * Zakrije skrivnosti in domaco pot v besedilu, preden gre k ponudniku modela (drugi pregled 0.2.10, S1). Splosni vzorci: zasebni kljuci PEM,
 * zetoni znanih ponudnikov (sk-, ghp_/github_pat_, AKIA, xox?-, JWT), poverilnice za shemo Bearer/Basic/Token, vrednosti za imeni kot
 * password/token/secret/api_key (tudi v JSON z narekovaji in ubeznimi narekovaji); pri vsaki ABSOLUTNI poti (/..., file://..., ~/...,
 * C:\..., C:\\... v JSON) se mape zakrijejo, ime datoteke ostane kot dokaz (»…/a.ts«). Spletni naslovi niso poti in ostanejo.
 * shortcut: seznam vzorcev ni popoln (lasten format zetona ostane viden); ce lastnik zeli vec, naj izklopi oceno izida.
 */
export function zakrijSkrivnosti(besedilo: string): string {
  return besedilo
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, "[zakrit zasebni kljuc]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[abposr]-[A-Za-z0-9-]{4,}|AIza[0-9A-Za-z_-]{20,})/g, "[zakrito]")
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, "[zakrito]")
    // Pred pravilom ime=vrednost: sicer bi se pri »Authorization: Bearer x« zakrila samo beseda sheme (B2).
    .replace(/\b(Bearer|Basic|Token)(\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1$2[zakrito]")
    .replace(/\b([A-Za-z0-9_]*(?:pass(?:word)?|passwd|geslo|token|zeton|secret|skrivnost|api[_-]?key|kljuc|auth)[A-Za-z0-9_]*)(\\?["']?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, "$1$2[zakrito]")
    .replace(/(^|[\s(\[{=:,;"'`<])(?:file:\/\/)?(?:[A-Za-z]:[\\/]+|\/|~[\\/])(?:[^\s\\/"'`<>|]+[\\/]+)+/g, "$1…/");
}
