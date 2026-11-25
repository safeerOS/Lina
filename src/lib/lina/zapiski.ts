/**
 * Zapiski pogovorov (G5, lastnik 11. 11. 2026): cista logika brez branja diska - imena, vsebina, zdruzevanje.
 * Ime klicatelja je podatek z drugega izvora (pove ga klicatelj): iz njega NIKOLI ne gre pot, samo varno ime.
 */
import { t } from "./besedila.ts";
import type { CallSession } from "./types.ts";

export const KONCNICA = ".md";
/** Najvec bajtov imena klicatelja v imenu datoteke: ext4 dovoli 255 bajtov, unikodni znaki imajo do 4. */
export const NAJVEC_BAJTOV_IMENA = 100;
export const NAJVEC_ZDRUZENIH = 50;
/** Zapisek je kratko besedilo; vecje datoteke se ne berejo (zascita pomnilnika). */
export const NAJVEC_VELIKOST = 1024 * 1024;

export type Zapisek = {
  /** Ime datoteke v mapi zapiskov ali »<mapa klica>/zapisek.md«; odjemalec poslje samo to in streznik ga poisce na seznamu. */
  id: string;
  naslov: string;
  /** Mapa klica ima posnetek pogovora (nacin podjetje z narocilom). */
  posnetek?: boolean;
  /** Cas klica, ISO. */
  cas: string;
  zdruzen: boolean;
  velikost: number;
  /** Nujen klic (lastnik 10. 11. 2026): na seznamu na vrhu, z oznako in napisom »Nujno«. */
  nujno: boolean;
  /** Kljuc klicatelja (22. 11. 2026): ista stevilka v vsakem zapisu ali, brez stevilke, isto ime; za povzetek vseh sporocil. */
  klicatelj: string;
};

export type MapaZapiskov = {
  ok: boolean;
  /** Polna pot (nikoli ~). Pri privzeti mapi je to mapa zapiski v podatkovni mapi. */
  mapa: string;
  jePrivzeta: boolean;
  razlog: string;
  opozorila: string[];
};

export type ZapisekVsebina = { id: string; naslov: string; cas: string; vsebina: string };

const NEVARNI = /[\\/:*?"<>|]/g;
// Kontrolni znaki, nevidni znaki in znaki za smer pisave (lahko skrijejo koncnico imena).
const KONTROLNI = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;
const REZERVIRANO = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

function odrezi(besedilo: string, bajtov: number): string {
  let skupaj = 0;
  let izhod = "";
  for (const znak of besedilo) {
    skupaj += Buffer.byteLength(znak, "utf8");
    if (skupaj > bajtov) break;
    izhod += znak;
  }
  return izhod;
}

/**
 * Ime, ki je lahko samo ime datoteke: brez poti, brez .., brez posebnih znakov in ne predolgo.
 * Unikodne crke ostanejo (sumniki so v imenih ljudi). Prazen niz: iz vhoda ni nastalo nic uporabnega.
 */
export function varnoIme(surovo: unknown, bajtov = NAJVEC_BAJTOV_IMENA): string {
  if (typeof surovo !== "string") return "";
  let s = surovo.normalize("NFC").replace(KONTROLNI, " ").replace(NEVARNI, " ");
  s = s.replace(/\.{2,}/g, ".").replace(/\s+/g, " ").trim();
  s = s.replace(/^[.\s]+/, "");
  s = odrezi(s, bajtov).replace(/[.\s]+$/, "");
  if (REZERVIRANO.test(s)) s = `_${s}`;
  return s;
}

function dvomestno(n: number): string {
  return String(n).padStart(2, "0");
}

/** »2026-11-11 07-45« v lokalnem casu racunalnika (kot ga uporabnik vidi); locilo minut je »-«, ker »:« v imenih ni varen. */
export function casZaIme(iso: string, locilo = "-"): string {
  const d = new Date(iso);
  const ok = Number.isFinite(d.getTime()) ? d : new Date(0);
  return `${ok.getFullYear()}-${dvomestno(ok.getMonth() + 1)}-${dvomestno(ok.getDate())} ${dvomestno(ok.getHours())}${locilo}${dvomestno(ok.getMinutes())}`;
}

/** Ime klicatelja, kot ga je povedal Lini; brez imena (ali »ni podatka«) je klicatelj neznan. */
export function imeKlicatelja(call: CallSession, zStevilko = false): string {
  const kandidati = [call.order?.customerName, call.stik?.ime];
  for (const kandidat of kandidati) {
    const ime = varnoIme(kandidat ?? "");
    if (ime && ime.toLowerCase() !== t("niPodatka").toLowerCase()) return ime;
  }
  // Osebna tajnica: brez imena je naslov zapiska stevilka klicatelja, ne »Neznan klicatelj«.
  if (zStevilko && call.nacin === "osebna") {
    const stevilka = varnoIme(call.order?.phone || call.stik?.telefon || call.from || "");
    if (stevilka && !/^anonymous$/i.test(stevilka)) return stevilka;
  }
  return t("zapisekNeznan");
}

/**
 * Kljuc stevilke za primerjavo (isti postopek kot telefon, KlicateljiSkupine.kt): samo stevke; mednarodna oblika (+ ali 00)
 * s slovensko kodo 386 se zamenja z narodno 0, druge drzave ostanejo s +. Brez stevk prazen niz.
 */
export function kljucStevilke(stevilka: string): string {
  const t0 = stevilka.trim();
  let s = t0.replace(/\D/g, "");
  if (!s) return "";
  const mednarodna = t0.startsWith("+") || s.startsWith("00");
  if (!mednarodna) return s;
  if (s.startsWith("00")) s = s.slice(2);
  return s.startsWith("386") ? `0${s.slice(3)}` : `+${s}`;
}

function stevilkaKlica(call: CallSession): string {
  const s = varnoIme(call.order?.phone || call.stik?.telefon || call.from || "");
  return /^anonymous$/i.test(s) ? "" : s;
}

/** Kljuc klicatelja za glavo zapiska: stevilka ali ime (brez presledkov, da ostane ena beseda v oznaki). */
export function kljucKlicatelja(call: CallSession): string {
  const st = kljucStevilke(stevilkaKlica(call));
  if (st) return `st:${st}`;
  const ime = imeKlicatelja(call);
  return ime === t("zapisekNeznan") ? "" : `ime:${encodeURIComponent(ime.toLowerCase())}`;
}

/**
 * »Ana Novak - 2026-11-11 07-45 - 041123456« (brez koncnice). Lastnik 22. 11. 2026: datoteka nosi ime klicatelja, cas klica
 * in telefonsko stevilko (prej G5 11. 11. 2026 brez stevilke). Ce je ime ze stevilka (osebna tajnica brez imena), je ne ponovimo.
 */
export function naslovZapiska(call: CallSession): string {
  const ime = imeKlicatelja(call, true);
  const st = stevilkaKlica(call);
  return st && st !== ime ? `${ime} - ${casZaIme(call.startedAt)} - ${st}` : `${ime} - ${casZaIme(call.startedAt)}`;
}

/** Ime datoteke; pripona 2, 3 ... za enako ime v istem trenutku. */
export function imeDatoteke(naslov: string, pripona = 1): string {
  // Ime klicatelja je ze odrezano na 100 bajtov; cel naslov (z casom) ima rezervo, da cas ni nikoli odrezan.
  const osnova = varnoIme(naslov, NAJVEC_BAJTOV_IMENA * 2) || t("zapisekNeznan");
  return pripona > 1 ? `${osnova}-${pripona}${KONCNICA}` : `${osnova}${KONCNICA}`;
}

function vVrstico(besedilo: unknown): string {
  return typeof besedilo === "string" ? besedilo.replace(/\s+/g, " ").trim() : "";
}

const IZID_DOGODKA = {
  poslano: "nujniIzidPoslano",
  napaka: "nujniIzidNapaka",
  poskus: "nujniIzidPoskus",
  oglasil: "nujniIzidOglasil",
  neodgovor: "nujniIzidNeodgovor",
  omejeno: "nujniIzidOmejeno",
} as const;

const OZNAKA_CASA = /^<!--\s*lina-cas:\s*([0-9TZ:.+-]+)\s*-->\s*$/m;
const OZNAKA_ZDRUZEN = /^<!--\s*lina-zdruzen:\s*\d+\s*-->\s*$/m;
const OZNAKA_NUJNO = /^<!--\s*lina-nujno:\s*1\s*-->\s*$/m;
const OZNAKA_KLICATELJ = /^<!--\s*lina-klicatelj:\s*((?:st|ime):[^\s>]{1,200})\s*-->\s*$/m;

/** Kljuc klicatelja iz glave; starejsi zapiski brez oznake vrnejo null. */
export function klicateljIzVsebine(vsebina: string): string | null {
  return OZNAKA_KLICATELJ.exec(vsebina)?.[1] ?? null;
}

/** Kljuc za zapisek brez oznake (starejsi zapiski): ime pred prvim » - « v naslovu. */
export function klicateljIzNaslova(naslov: string): string {
  const ime = naslov.split(" - ")[0]?.trim().toLowerCase() ?? "";
  const st = kljucStevilke(ime);
  return st && /^[+\d\s/-]+$/.test(ime) ? `st:${st}` : `ime:${encodeURIComponent(ime)}`;
}

/** Zapisek je nujen klic (strojna oznaka v glavi; besedilo »Nujno« je poleg nje v telesu, ne samo barva). */
export function jeNujenZapisek(vsebina: string): boolean {
  return OZNAKA_NUJNO.test(vsebina);
}

/** Cas klica iz glave zapiska; null, ce glave ni ali ni veljavna. */
export function casIzVsebine(vsebina: string): string | null {
  const m = OZNAKA_CASA.exec(vsebina);
  if (!m) return null;
  const ms = Date.parse(m[1]);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function jeZdruzen(vsebina: string): boolean {
  return OZNAKA_ZDRUZEN.test(vsebina);
}

/** Zapisek klica, berljiv cloveku (markdown). Brez skrivnosti: samo zapis klica, kot ga ze hrani calls.json. */
export function vsebinaZapiska(call: CallSession): string {
  const o = call.order;
  const ime = imeKlicatelja(call);
  const polja: Array<[string, string]> = [
    [t("zapisekIme"), ime === t("zapisekNeznan") ? "" : ime],
    [t("zapisekPodjetje"), vVrstico(o.podjetjeKlicatelja)],
    [t("zapisekTelefon"), vVrstico(o.phone || call.stik?.telefon || call.from)],
    [t("zapisekEposta"), vVrstico(o.email || call.stik?.email)],
    [t("zapisekIzdelek"), vVrstico(o.productName || o.requestedProduct || o.povprasevanje)],
    [t("zapisekMaterial"), vVrstico(o.materialName || o.requestedMaterial)],
    [t("zapisekKolicina"), o.quantity ? String(o.quantity) : ""],
    [t("zapisekMere"), vVrstico(o.notes)],
    [t("rok"), vVrstico(o.deadline)],
    [t("zapisekDosegljiv"), vVrstico(o.dosegljiv)],
    [t("zapisekOznaka"), vVrstico(o.oznaka)],
    [t("zapisekRazlog"), vVrstico(o.tajnica?.razlog)],
    [t("zapisekSporocilo"), vVrstico(o.tajnica?.sporocilo)],
    [t("zapisekOdsotnost"), vVrstico((call.odsotnostPovedana ?? []).join(" "))],
    // Fable 7 (14. 11. 2026): lastnik dobi tudi surovo besedilo prepoznave, ce se razlikuje od ociscenega (STT zna zgresiti; lastnik presodi sam).
    [t("zapisekIzrek"), o.tajnica?.izrek && o.tajnica.izrek !== o.tajnica.sporocilo ? vVrstico(o.tajnica.izrek) : ""],
    [t("zapisekDobesedno"), vVrstico(call.dobesedno)],
  ].filter(([naziv]) => call.nacin !== "osebna" || [t("zapisekIme"), t("zapisekTelefon"), t("zapisekSporocilo"), t("zapisekIzrek"), t("zapisekOdsotnost"), t("zapisekDobesedno")].includes(naziv)) as Array<[string, string]>;
  const vrstice = [
    `# ${naslovZapiska(call)}`,
    `<!-- lina-cas: ${new Date(call.startedAt).toISOString()} -->`,
    ...(kljucKlicatelja(call) ? [`<!-- lina-klicatelj: ${kljucKlicatelja(call)} -->`] : []),
    ...(o.tajnica?.nujno ? ["<!-- lina-nujno: 1 -->"] : []),
    // Rok hrambe (lastnik 22. 11. 2026): samo zapiski nacina podjetje se po roku izbrisejo sami (snemanje.server.ts pospraviPosnetke).
    ...(call.nacin !== "osebna" ? ["<!-- lina-nacin: podjetje -->"] : []),
    "",
    // Nujen klic: napis na prvem mestu (ne samo barva ali oznaka: crno-beli izpis, bralnik zaslona).
    ...(o.tajnica?.nujno ? [`${t("nujnoOznaka").toUpperCase()}: ${t("zapisekDa")}`] : []),
    `${t("zapisekCas")}: ${casZaIme(call.startedAt, ":")}`,
    ...polja.filter(([, vrednost]) => vrednost).map(([naziv, vrednost]) => `${naziv}: ${vrednost}`),
    ...(call.nacin === "osebna" ? [] : [`${t("zapisekPotrjeno")}: ${o.confirmed ? t("zapisekDa") : t("zapisekNe")}`]),
    // Obvestila in prevezave na osebni telefon: cas in izid; stevilke tu NI (zaupna).
    ...(call.nujniDogodki ?? []).map(
      (d) =>
        `${t("zapisekNujniDogodki")} - ${t(d.vrsta === "obvestilo" ? "nujniDogodekObvestilo" : "nujniDogodekPrevezava")} (${casZaIme(d.cas, ":")}): ${t(IZID_DOGODKA[d.izid])}`,
    ),
    "",
    // Klic s telefona (naloga 17): izvor in povzetek telefona; stari zapisi nimajo prepisa (nic se ne izmisli).
    ...(call.izvor === "telefon" ? [`${t("zapisekIzvor")}: ${t("klicIzvorTelefon")}`, ...(call.povzetek?.zelel ? [`${t("zapisekPovzetek")}: ${vVrstico(call.povzetek.zelel)}`] : []), ""] : []),
    `## ${t("zapisekPogovor")}`,
    "",
    ...(call.izvor === "telefon" && call.transcript.length === 0 ? [t("klicPrepisNi")] : []),
    ...(call.prepisOkrnjen ? [t("klicPrepisOkrnjen")] : []),
    ...call.transcript.map((v) => `- ${v.role === "stranka" ? t("zapisekKlicatelj") : t("zapisekLina")}: ${vVrstico(v.text)}${v.razumljeno ? ` (${t("zapisekRazumljeno")}: ${vVrstico(v.razumljeno)})` : ""}`),
    "",
  ];
  return vrstice.join("\n");
}

/** Telo zapiska brez naslova in strojne glave (za zdruzevanje). */
function telo(vsebina: string): string {
  return vsebina
    .split("\n")
    .filter((v, i) => !(i === 0 && v.startsWith("# ")) && !/^<!--\s*lina-(cas|zdruzen|nujno|klicatelj):/.test(v))
    // Naslovi v telesu se znizajo za eno raven, da razdelek z naslovom izvirnika ostane najvisji.
    .map((v) => (/^#{2,5} /.test(v) ? `#${v}` : v))
    .join("\n")
    .trim();
}

/**
 * Zdruzen zapisek: razdelki z naslovi izvirnikov, urejeni po casu klica (od najstarejsega); isti cas po imenu.
 * Naslov razdelka je ime izvirnega zapiska, da se vidi, od kod je kaj.
 */
export function zdruziVsebine(zapiski: ZapisekVsebina[], zdaj: string): { naslov: string; vsebina: string } {
  const urejeni = [...zapiski].sort((a, b) => a.cas.localeCompare(b.cas) || a.id.localeCompare(b.id));
  const naslov = `${t("zapisekZdruzeni")} - ${casZaIme(zdaj)}`;
  const deli = urejeni.map((z) => `## ${z.naslov}\n\n${telo(z.vsebina)}\n`);
  const vsebina = [
    `# ${naslov}`,
    `<!-- lina-cas: ${new Date(zdaj).toISOString()} -->`,
    `<!-- lina-zdruzen: ${urejeni.length} -->`,
    // Zdruzen zapisek, ki vsebuje nujen klic, je tudi sam nujen (nic se ne skrije).
    ...(urejeni.some((z) => jeNujenZapisek(z.vsebina)) ? ["<!-- lina-nujno: 1 -->"] : []),
    "",
    `${t("zapisekZdruzenoSteje")}: ${urejeni.length}`,
    "",
    ...deli,
  ].join("\n");
  return { naslov, vsebina };
}
