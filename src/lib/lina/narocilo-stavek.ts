/**
 * Stavek narocila v pravi slovenscini (G4f, lastnik 11. 11. 2026: >>kolicina dva<< ni dobro, Lina naj rece >>Narocate dve mizi
 * iz materiala hrast.<<). Sklanjanje (dvojina, spol stevnika, tozilnik) naredi model, ker pravila po koncih besed niso
 * zanesljiva; tu je samo ODLOCITEV, ali se izhod modela sme izgovoriti (varovala), in majhen pomnilnik, da stavek
 * pripravimo vnaprej (predpriprava) in ob potrditvi ne cakamo. Brez streznika in omrezja: uvozi ga lahko tudi povzetek.ts.
 */
import { fold } from "./guards.ts";

export type VhodStavka = { izdelek: string; material: string; kolicina: number };

/** Vec znakov od tega ni stavek tajnice (varovalo pred pridigo ali razlago modela). */
export const NAJVEC_ZNAKOV_STAVKA = 200;
/** Kolicine nad tem ne beremo besedno (sestavljena stevila nad sto so redka in jih model rad zgresi). */
export const NAJVECJA_KOLICINA = 99;

const ZBIRNI = ["enoje", "dvoje", "troje", "cetvero", "stiroje"];
const ENICE = ["en", "ena", "eno", "ene", "eni", "enega", "enem", "enim", "enemu", "enoje"];
const DVOJICE = ["dva", "dve", "dveh", "dvema", "dvoje"];
const TROJICE = ["tri", "treh", "trem", "tremi", "troje"];
const STIRICE = ["stiri", "stirje", "stirih", "stirim", "stirimi", "cetvero", "stiroje"];
/** Daljse korenine najprej: >>petnajst<< ne sme obveljati za >>pet<<. */
const KORENINE: Array<[string, number]> = [
  ["devetnajst", 19], ["osemnajst", 18], ["sedemnajst", 17], ["sestnajst", 16], ["petnajst", 15], ["stirinajst", 14],
  ["trinajst", 13], ["dvanajst", 12], ["enajst", 11],
  ["devetdeset", 90], ["osemdeset", 80], ["sedemdeset", 70], ["sestdeset", 60], ["petdeset", 50], ["stirideset", 40],
  ["trideset", 30], ["dvajset", 20],
  ["devet", 9], ["osem", 8], ["sedem", 7], ["sest", 6], ["pet", 5], ["deset", 10],
];
const DESETICE = new Set(KORENINE.filter(([, n]) => n >= 20 && n % 10 === 0).map(([k]) => k));

/** Razred stevnika (1-99) v besedi, ali 0, ce beseda ni stevnik. Zdruzena oblika >>enaindvajset<< da dva razreda. */
function razredi(beseda: string): number[] {
  const zdruzena = /^(ena|en|dva|dve|tri|stiri|pet|sest|sedem|osem|devet)in([a-z]+)$/.exec(beseda);
  if (zdruzena && DESETICE.has(zdruzena[2])) return [...razredi(zdruzena[1]), ...razredi(zdruzena[2])];
  if (ENICE.includes(beseda)) return [1];
  if (DVOJICE.includes(beseda)) return [2];
  if (TROJICE.includes(beseda)) return [3];
  if (STIRICE.includes(beseda)) return [4];
  for (const [koren, n] of KORENINE) if (beseda.startsWith(koren)) return [n];
  return [];
}

/**
 * Vrsta samostalnika (AGENTS.md, slovnica stevnikov, os-brinje.si): mnozinski imajo samo mnozino in zbirni stevnik
 * (dvoje skarje, ne >>dve skarji<<); snovni se ne stejejo (>>dva litra olja<<, enote v podatkih ni). Seznama sta
 * namenoma kratka in zanesljiva; kar ni na njiju, je navaden samostalnik in ga preveri model z navodilom.
 */
const MNOZINSKI = new Set(["skarje", "hlace", "ocala", "vrata", "pljuca", "vilice", "kleste", "grablje", "copate"]);
const SNOVNI = new Set(["moka", "olje", "voda", "sol", "sadje", "sladkor", "mleko", "pesek", "zelenjava"]);
/** Zbirni stevnik velja samo do stirih (>>petere skarje<< je preredko in ga model rad zgresi: oblika B). */
export const NAJVECJA_ZBIRNA_KOLICINA = 4;

export function vrstaIzdelka(izdelek: string): "mnozinski" | "snovni" | "navaden" {
  const b = besede(izdelek);
  if (b.some((x) => SNOVNI.has(x))) return "snovni";
  if (b.some((x) => MNOZINSKI.has(x))) return "mnozinski";
  return "navaden";
}

/** Ali model za ta izdelek in kolicino sploh sme sklanjati (sicer oblika B brez klica modela). */
export function sklanjanjeMozno(izdelek: string, kolicina: number): boolean {
  const vrsta = vrstaIzdelka(izdelek);
  if (vrsta === "snovni") return false;
  return !(vrsta === "mnozinski" && kolicina > NAJVECJA_ZBIRNA_KOLICINA);
}

function pricakovaniRazredi(n: number): number[] {
  return n % 10 === 0 || n < 20 ? [n] : [n % 10, n - (n % 10)];
}

function besede(besedilo: string): string[] {
  return fold(besedilo).split(/[^\p{L}]+/u).filter(Boolean);
}

export type IzidPreverbe = { ok: true; stavek: string } | { ok: false; razlog: string };

/**
 * Varovala: izhod modela se uporabi samo, ce preide VSE. Vrne stavek BREZ koncne pike (rok se doda v povzetek.ts).
 * prepovedano: besede, ki jih model ne sme dodati (ime klicatelja ...); telefon in e-posta ze padeta na stevkah in znakih.
 */
export function preveriStavekNarocila(izhod: string, vhod: VhodStavka, prepovedano: readonly string[] = []): IzidPreverbe {
  const surov = (izhod ?? "").trim();
  if (!surov) return { ok: false, razlog: "prazen" };
  if (surov.length >= NAJVEC_ZNAKOV_STAVKA) return { ok: false, razlog: "dolg" };
  if (/\d/.test(surov)) return { ok: false, razlog: "stevka" };
  if (!/^[\p{L} ,.\-]+$/u.test(surov)) return { ok: false, razlog: "znaki" };
  const stavek = surov.replace(/\.$/, "").trim();
  if (/[.]/.test(stavek) || !stavek) return { ok: false, razlog: "vec stavkov" };
  const besedeIzhoda = besede(stavek);
  if (besedeIzhoda[0] !== "narocate") return { ok: false, razlog: "jezik" };
  if (!Number.isInteger(vhod.kolicina) || vhod.kolicina < 1 || vhod.kolicina > NAJVECJA_KOLICINA) {
    return { ok: false, razlog: "kolicina" };
  }
  if (!sklanjanjeMozno(vhod.izdelek, vhod.kolicina)) return { ok: false, razlog: "vrsta samostalnika" };
  // Izdelek: lastno ime (z veliko) dobesedno za besedo >>izdelek<<; sicer korenski del (sklanjatev spremeni konec).
  const izdelek = vhod.izdelek.trim();
  const besedeIzdelka = besede(izdelek);
  if (besedeIzdelka.length === 0) return { ok: false, razlog: "izdelek" };
  if (/^\p{Lu}/u.test(izdelek)) {
    if (!stavek.includes(`izdelek ${izdelek}`)) return { ok: false, razlog: "lastno ime" };
  } else {
    const prva = besedeIzdelka[0];
    const koren = prva.length <= 3 ? prva : prva.slice(0, Math.max(3, prva.length - 2));
    if (!besedeIzhoda.slice(1).some((b) => b.startsWith(koren))) return { ok: false, razlog: "izdelek" };
  }
  // Material dobesedno (ne sklanjamo); brez materiala besede >>material<< ni.
  const material = vhod.material.trim();
  const besedeMateriala = besede(material);
  if (besedeMateriala.length > 0) {
    if (!fold(stavek).includes(`iz materiala ${besedeMateriala.join(" ")}`)) return { ok: false, razlog: "material" };
  } else if (besedeIzhoda.includes("materiala")) {
    return { ok: false, razlog: "izmisljen material" };
  }
  // Stevilo kot beseda, in sicer tocno pricakovano (brez stevnikov izdelka in materiala, npr. >>Petra<< ni stevnik).
  const lastne = new Set([...besedeIzdelka, ...besedeMateriala]);
  const najdeni = besedeIzhoda.slice(1).filter((b) => !lastne.has(b)).flatMap(razredi).sort((a, b) => a - b);
  const pricakovani = pricakovaniRazredi(vhod.kolicina).sort((a, b) => a - b);
  if (najdeni.length !== pricakovani.length || najdeni.some((n, i) => n !== pricakovani[i])) {
    return { ok: false, razlog: "stevilo" };
  }
  // Sestavljeno 21, 31 ...: >>ena in dvajset miz<< / >>enaindvajset miz<<; >>eno in dvajset<<, >>en in dvajset<< je napaka
  // (meritev G4f: model je enkrat od treh rekel >>eno in dvajset miz<<).
  if (vhod.kolicina > 20 && vhod.kolicina % 10 === 1 && besedeIzhoda.slice(1).some((b) => !lastne.has(b) && ENICE.includes(b) && b !== "ena")) {
    return { ok: false, razlog: "ena v sestavljenem stevilu" };
  }
  // Zbirni stevnik (dvoje, troje) samo za mnozinske samostalnike; za navadne je napaka (>>dvoje mizi<<).
  const zbirnih = besedeIzhoda.filter((b) => ZBIRNI.includes(b) && !lastne.has(b)).length;
  if (vrstaIzdelka(vhod.izdelek) === "mnozinski" ? zbirnih !== 1 : zbirnih !== 0) return { ok: false, razlog: "zbirni stevnik" };
  // Drugi podatki klicatelja (ime): beseda, ki je ni v vhodu, se ne sme ujemati s prepovedano.
  for (const beseda of prepovedano.flatMap(besede)) {
    if (beseda.length >= 3 && besedeIzhoda.includes(beseda) && !lastne.has(beseda)) return { ok: false, razlog: "podatek klicatelja" };
  }
  // Predolg stavek glede na vhod: izdelek, material, stevnik + okvirne besede (Narocate, iz materiala, v kolicini, izdelek, vezniki).
  if (besedeIzhoda.length > besedeIzdelka.length + besedeMateriala.length + 8) return { ok: false, razlog: "predolg glede na vhod" };
  return { ok: true, stavek };
}

/** Pomnilnik pripravljenih stavkov (samo v pomnilniku, omejen): povzetek.ts ga bere sinhrono, predpriprava piše. */
const NAJVEC_V_POMNILNIKU = 64;
const pomnilnik = new Map<string, string>();

export function kljucStavka(v: VhodStavka): string {
  return JSON.stringify([fold(v.izdelek), fold(v.material), v.kolicina]);
}

export function shraniStavekNarocila(v: VhodStavka, stavek: string): void {
  const kljuc = kljucStavka(v);
  pomnilnik.delete(kljuc);
  pomnilnik.set(kljuc, stavek);
  while (pomnilnik.size > NAJVEC_V_POMNILNIKU) {
    const najstarejsi = pomnilnik.keys().next().value;
    if (najstarejsi === undefined) break;
    pomnilnik.delete(najstarejsi);
  }
}

export function najdiStavekNarocila(v: VhodStavka): string | undefined {
  return pomnilnik.get(kljucStavka(v));
}

/** Samo za preizkuse. */
export function pocistiStavkeNarocila(): void {
  pomnilnik.clear();
}
