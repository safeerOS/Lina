/**
 * E-naslov podjetja za potrditev povprasevanja: preverba oblike in izgovor po telefonu.
 * Cisti del brez diska in omrezja (lastnik 10. 11. 2026: moznost, privzeto izklopljena).
 */
import { t } from "./besedila.ts";

/** Ozka oblika: en @, domena s piko, brez presledkov. Namen je izgovor po telefonu, ne popoln RFC. */
const OBLIKA = /^[A-Za-z0-9](?:[A-Za-z0-9._+-]{0,62}[A-Za-z0-9_+-])?@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/;

export function jeVeljavenEnaslov(naslov: string): boolean {
  const cisto = naslov.trim();
  return cisto.length <= 120 && OBLIKA.test(cisto) && !cisto.includes("..");
}

const ZNAK: Record<string, string> = { "@": "afna", ".": "pika", "-": "vezaj", _: "podčrtaj", "+": "plus" };

/** Imena crk in stevk, kot jih narekuje clovek po telefonu (G4g: glas je »doo« slisal kot »do« in »dou«, "d o o" prav). */
const CRKA: Record<string, string> = {
  a: "a", b: "be", c: "ce", d: "de", e: "e", f: "ef", g: "ge", h: "ha", i: "i", j: "je", k: "ka", l: "el", m: "em", n: "en",
  o: "o", p: "pe", q: "ku", r: "er", s: "es", t: "te", u: "u", v: "ve", w: "dvojni ve", x: "iks", y: "ipsilon", z: "ze",
  "0": "nič", "1": "ena", "2": "dva", "3": "tri", "4": "štiri", "5": "pet", "6": "šest", "7": "sedem", "8": "osem", "9": "devet",
};

/**
 * Kos naslova, ki ga glas ne izgovori kot besedo, se crkuje: brez samoglasnika (»mkd«), z dvema enakima samoglasnikoma
 * zapored (»doo«, »aab«) ali iz stevk (»2026« po stevkah, ne »dva tisoc«). Drugi kosi ostanejo cele besede.
 */
function kosZaCrkovanje(kos: string): boolean {
  return !/[aeiou]/.test(kos) || /([aeiou])\1/.test(kos) || /\d/.test(kos);
}

function crkujKos(kos: string): string {
  if (!kosZaCrkovanje(kos)) return kos;
  return [...kos].map((znak) => CRKA[znak] ?? znak).join(", ");
}

/**
 * Naslov, kot se izgovori: »info, afna, primer, pika, si«. Posebne znake izgovorimo z besedo, kose med njimi pustimo cele,
 * razen tistih, ki jih je treba crkovati (crkujKos); vejice dajo glasu premor. Neveljaven naslov vrne prazen niz.
 */
export function izgovoriEnaslov(naslov: string): string {
  const cisto = naslov.trim().toLowerCase();
  if (!jeVeljavenEnaslov(cisto)) return "";
  const deli: string[] = [];
  for (const kos of cisto.split(/([@._+-])/)) {
    if (!kos) continue;
    deli.push(ZNAK[kos] ?? crkujKos(kos));
  }
  return deli.join(", ");
}

const BESEDA_EPOSTE = /\b(e-? ?(post\w*|mail\w*|naslov\w*)|mail\w*|mejl\w*|meil\w*|email\w*|elektronsk\w* post\w*)\b/;
/** Posiljanje ali vprasanje po naslovu (»poslal bom«, »napisem«, »imate«, »kam«); »moj mail je …« (narek svojega) ni omemba. */
const POSILJANJE = /\b(poslj\w*|posl\w*|napis\w*|pis\w*|odda\w*|imate|mate|kam|kateri|lahko)\b/;

/**
 * Ali je klicatelj sam omenil, da bi povprasevanje poslal po e-posti (»poslal bom po mailu«, »imate e-naslov«). Prepis skrije
 * stik (naslov, »afna«), zato iscemo samo besede: beseda za e-posto in posiljanje ali vprasanje v istem izreku.
 */
export function omenilEposto(izreki: string[]): boolean {
  return izreki.some((izrek) => {
    const f = izrek.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    // Pregled 0.2.10 (najdba 11): prosnja, naj PODJETJE pise klicatelju (»pošljite mi«, »na moj mail«), ni klicateljeva omemba
    // posiljanja - razen ce v istem izreku posilja tudi sam (»pošljem«, »poslal bom«).
    if ((PODJETJE_PISE.test(f) || /\bna moj\w*\b/.test(f)) && !KLICATELJ_POSLJE.test(f)) return false;
    return BESEDA_EPOSTE.test(f) && POSILJANJE.test(f);
  });
}

/** Druga oseba mnozine (podjetje naj poslje ali pise): »pošljete«, »pošljite«, »napišite«, »odpišete«, »odgovorite«. */
const PODJETJE_PISE = /\b(poslj(ete|ite)|(na|od)?pis(ete|ite)|odgovor(ite|ete))\b/;
/** Prva oseba (klicatelj poslje sam): »pošljem«, »pošljemo«, »poslal bom«, »napišem«, »pišem«, »oddam«. */
const KLICATELJ_POSLJE = /\b(poslj(em|emo)|poslal\w*|(na)?pis(em|emo)|odda(m|mo))\b/;

/**
 * Prosnja pred slovesom ali prazen niz, ce moznost ni vklopljena ali naslov ni veljaven (lastnik 23. 11. 2026: »mora obvezno
 * prositi, ce lahko povprasevanje se oddajo na elektronsko posto«). Ce je klicatelj e-posto ze omenil, se stavek nanj sklicuje.
 */
export function stavekPotrditve(
  pravila: { potrditevEposta?: boolean; potrditevNaslov?: string; nacinKlica?: string },
  omenjeno = false,
): string {
  // Samo nacin podjetje: osebna tajnica nikoli ne prosi za narocilo po e-posti (22. 11. 2026).
  if (!pravila.potrditevEposta || pravila.nacinKlica === "osebna") return "";
  const izgovor = izgovoriEnaslov(pravila.potrditevNaslov ?? "");
  return izgovor ? `${t(omenjeno ? "potrditevOmenjeno" : "potrditevProsim")} ${izgovor}.` : "";
}

/**
 * Naslov je na domeni strani (pregled 0.2.10, najdba 9): gostitelj z ali brez »www.« na obeh straneh; poddomena ni ista. Isto preverbo
 * uporabljata predlog s strani (predizbira) in vmesnik (opozorilo »ni na domeni strani«).
 */
export function naslovNaDomeni(naslov: string, gostitelj: string): boolean {
  const brezWww = (s: string) => s.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  const domena = naslov.split("@")[1];
  return Boolean(domena) && brezWww(domena) === brezWww(gostitelj);
}

/** Najvecja dolzina naslova, ki se po telefonu se razumljivo izgovori (info@primer.si ima 14; lastnik poslusal MP3 11. 11. 2026). */
const NAJDALJSI_PRIPOROCEN = 24;

/**
 * Veljaven naslov, ki ga glas po telefonu slabse izgovori: dolg, z vezajem, podcrtajem, plusom, stevkami, kosom za crkovanje
 * (»doo«) ali vec pikami v domeni. Samo opozorilo uporabniku (priporoci kratek naslov); vpisa ne prepreci.
 */
export function naslovJeTezakZaGovor(naslov: string): boolean {
  const cisto = naslov.trim().toLowerCase();
  if (!jeVeljavenEnaslov(cisto)) return false;
  if (cisto.length > NAJDALJSI_PRIPOROCEN || /[-_+\d]/.test(cisto)) return true;
  if (cisto.split("@")[1].split(".").length > 2) return true;
  return cisto.split(/[@.]/).some((kos) => kosZaCrkovanje(kos));
}
