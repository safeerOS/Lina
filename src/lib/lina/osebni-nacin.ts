/**
 * Osebni nacin (lastnik 15. 11. 2026): osebna tajnica NIMA narocil, dostave, kataloga in drugih znacilnosti, ki so samo za podjetja. Klicatelj pusti
 * SPOROCILO (ime, telefon, kaj sporoca, kdaj naj ga lastnik poklice nazaj). Ta modul je EN vir odlocitve, kaj vmesnik v osebnem nacinu skrije in
 * kako ga poimenuje; vmesnik (lina-desk.tsx) ga uporablja za vsak poslovni razdelek, preizkus (naloga-osebni-nacin.test.ts) preveri modul in da
 * vmesnik ne izpusti nobenega poslovnega razdelka. Nacin podjetje ostane nespremenjen (besedila in razdelki enaki kot prej).
 * Cista koda (brez omrezja in datotek): enaka na Linuxu in Windows.
 */
import { t } from "./besedila.ts";

export type NacinKlica = "podjetje" | "osebna" | undefined;

/**
 * Poslovni razdelki vmesnika: v osebnem nacinu SKRITI. Popis (15. 11. 2026, pregled vsakega zavihka, polja in besedila v lina-desk.tsx):
 * - znanje: zavihek Znanje (cena in sporocilo po povprasevanju, materiali, izdelki, spletna stran podjetja, vrzeli v znanju);
 * - tema: besedilo za garancijo, dostavo in rok izdelave (temaOdgovor);
 * - garancija, dostava: stikali in besedili;
 * - potrditevEposta: prosnja, naj klicatelj narocilo poslje se po e-posti (vklop, naslov);
 * - zapisekIzdelki: vrstice Izdelek, Material, Kolicina, Mere, Rok in Podjetje klicatelja v zapisniku klica, oznaka »Potrjeno/Osnutek«, »Zunaj kataloga«;
 * - dnevnikIzdelek: v dnevniku klicev oznaka narocila (»Potrjeno«, izdelek, material zavrnjen).
 * Podrobni potek povprasevanja (podrobniPotek) je ze bil skrit v osebnem nacinu.
 */
export const POSLOVNI_RAZDELKI = ["znanje", "tema", "garancija", "dostava", "potrditevEposta", "zapisekIzdelki", "dnevnikIzdelek"] as const;
export type PoslovniRazdelek = (typeof POSLOVNI_RAZDELKI)[number];

export const jeOsebniNacin = (nacin: NacinKlica | string | undefined): boolean => nacin === "osebna";

/** Razdelek je viden: poslovni razdelek se v osebnem nacinu NE pokaze. */
export function razdelekViden(razdelek: PoslovniRazdelek, nacin: NacinKlica | string | undefined): boolean {
  void razdelek;
  return !jeOsebniNacin(nacin);
}

export type ZavihekId = "klic" | "znanje" | "narocila" | "dnevnik" | "zapiski" | "linija" | "nastavitve";

/**
 * Zavihki vmesnika glede na nacin. Podjetje: kot prej (Klic, Znanje, Naročila, Dnevnik, zapiski, Linija, Nastavitve). Osebna: brez Znanja, zavihek
 * Naročila je »Sporočila« (isti id: stanje vmesnika se ne spremeni).
 */
export function zavihki(nacin: NacinKlica | string | undefined): Array<{ id: ZavihekId; label: string }> {
  const osebno = jeOsebniNacin(nacin);
  const vsi: Array<{ id: ZavihekId; label: string }> = [
    { id: "klic", label: "Klic" },
    { id: "znanje", label: "Znanje" },
    { id: "narocila", label: osebno ? t("zavihekSporocila") : "Naročila" },
    { id: "dnevnik", label: "Dnevnik" },
    { id: "zapiski", label: t("zapiskiTab") },
    { id: "linija", label: "Linija" },
    { id: "nastavitve", label: "Nastavitve" },
  ];
  return vsi.filter((z) => z.id !== "znanje" || razdelekViden("znanje", nacin));
}

/** Zavihek, ki ga v tem nacinu ni, pade na »Klic« (uporabnik je zavihek odprl, nato preklopil nacin). */
export function veljavenZavihek(tab: ZavihekId, nacin: NacinKlica | string | undefined): ZavihekId {
  return zavihki(nacin).some((z) => z.id === tab) ? tab : "klic";
}

/** »Obvezni del« v nastavitvah pozdrava: kar Lina res izgovori vedno (osebna: razkritje UI v prvem stavku, brez besede o narocilu). */
export function obveznoBesedilo(nacin: NacinKlica | string | undefined): string {
  return jeOsebniNacin(nacin) ? `${t("osebnaPredstavitev")} ${t("osebnaZapis")}` : t("obvezniPozdrav");
}

export function vajaNamigBesedilo(nacin: NacinKlica | string | undefined): string {
  return jeOsebniNacin(nacin) ? t("osebnaVajaNamig") : t("vajaNamig");
}

/** Prazen seznam v zavihku Naročila/Sporočila. */
export function prazenSeznamBesedilo(nacin: NacinKlica | string | undefined): string {
  return jeOsebniNacin(nacin) ? t("sporocilaPrazno") : "Potrjenih naročil še ni.";
}
