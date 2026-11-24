/**
 * Besedila Nastavitve > Narocila podjetja (uvoz lokalnega seznama narocil za kontrolo tiska): slovenscina in anglescina z enakimi kljuci.
 * Locena datoteka kot besedila-dovoljenja.ts, da se zdruzitev z besedila.ts ne zaplete.
 */
import { jezikVmesnika } from "./besedila.ts";

export const slN = {
  naslov: "Naročila podjetja",
  razlaga:
    "Lina iz izbrane mape prebere naročila (izvoz CSV ali Excel, delovne naloge PDF, DOCX ali TXT, izvoženo e-pošto .eml) in jih shrani lokalno. Pri kontroli tiska tako dnevnik dobi nalog in stranko, kadar se številka naloga natančno ujema. Mapa se samo bere, nič se ne pošlje.",
  mapa: "Mapa z naročili (polna pot)",
  uvozi: "Uvozi",
  uvazam: "Uvažam …",
  potrdiVprasanje: "Lina naj prebere naročila iz te mape?",
  potrdi: "Potrdi in uvozi",
  preklici: "Prekliči",
  stevilo: "Število naročil",
  zadnjic: "Zadnji uvoz",
  podobneVelja: "Ponovni uvoz te mape je dovoljen brez vprašanja (preklic v Nastavitvah > Dovoljenja).",
  opozorila: "Opozorila uvoza",
  neprepoznanaGlava: "stolpci niso prepoznani",
  razlog_podvojeno: "isti nalog z drugačnimi podatki (velja prvi vir)",
  "razlog_brez-narocila": "ni številke naloga ali stranke/motiva",
  razlog_poskodovan: "datoteke ni mogoče prebrati",
  "razlog_ni-datoteka": "ni navadna datoteka (povezave in podmape se ne berejo)",
  razlog_pdfSken: "skeniran PDF brez besedila (potreben OCR)",
  razlog_velik: "prevelika datoteka",
  razlog_vrsta: "vrsta datoteke ni podprta",
  razlog_drugo: "ni prebrano",
  niUvoza: "Naročila še niso uvožena.",
};

export const enN: Record<keyof typeof slN, string> = {
  naslov: "Company orders",
  razlaga:
    "Lina reads orders from the chosen folder (CSV or Excel export, PDF, DOCX or TXT work orders, exported .eml e-mail) and stores them locally. In print control the log then gets the order and the customer when the order number matches exactly. The folder is only read; nothing is sent.",
  mapa: "Orders folder (full path)",
  uvozi: "Import",
  uvazam: "Importing …",
  potrdiVprasanje: "Should Lina read orders from this folder?",
  potrdi: "Confirm and import",
  preklici: "Cancel",
  stevilo: "Number of orders",
  zadnjic: "Last import",
  podobneVelja: "Re-importing this folder is allowed without asking (revoke in Settings > Permissions).",
  opozorila: "Import warnings",
  neprepoznanaGlava: "columns not recognised",
  razlog_podvojeno: "same order with different data (first source applies)",
  "razlog_brez-narocila": "no order number or customer/design",
  razlog_poskodovan: "file cannot be read",
  "razlog_ni-datoteka": "not a regular file (links and subfolders are not read)",
  razlog_pdfSken: "scanned PDF without text (OCR needed)",
  razlog_velik: "file too large",
  razlog_vrsta: "file type not supported",
  razlog_drugo: "not read",
  niUvoza: "No orders imported yet.",
};

export function tN(kljuc: keyof typeof slN): string {
  return (jezikVmesnika() === "en" ? enN : slN)[kljuc];
}

/** Razlog preskocene datoteke v jeziku vmesnika (neznan razlog = »ni prebrano«). */
export function razlogUvoza(razlog: string): string {
  const k = `razlog_${razlog}` as keyof typeof slN;
  return k in slN ? tN(k) : tN("razlog_drugo");
}
