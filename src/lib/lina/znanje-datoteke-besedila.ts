/** Besedila za znanje iz datotek podjetja (sl + en). Locena datoteka, da se ne prekriva z besedila.ts (vzporedno delo). */
const sl = {
  vrsta: "Dokument mora biti PDF, DOCX, ODT, XLSX, CSV, TXT ali MD.",
  velik: "Dokument je večji od 15 MB.",
  bomba: "Dokument je po razpakiranju prevelik ali ima preveč delov, zato ga nisem prebrala.",
  poskodovan: "Dokumenta ne morem prebrati: datoteka je poškodovana ali v nepodprti obliki.",
  sifriran: "Dokument je zaščiten z geslom. Shranite ga brez gesla in ga naložite znova.",
  cas: "Branje dokumenta je trajalo predolgo, zato sem ga ustavila.",
  prazen: "V dokumentu ni besedila, ki bi ga lahko dodala v znanje (vrstice s cenami in zneski izpustim).",
  kodiranje: "Dokumenta ne morem prebrati kot besedila.",
  pdfSken:
    "Ta PDF je videti kot skeniran dokument (slike brez besedila), zato besedila ne morem prebrati. Besedilo shranite kot DOCX, ODT ali TXT in ga naložite.",
  prevec: "Naloženih je že 50 dokumentov. Izbrišite katerega, preden dodate novega.",
  niVira: "Tega dokumenta ni več.",
  niPredloga: "Predloga iz dokumenta ni ali ni nič izbrano.",
  naslov: "Dokumenti podjetja",
  namig:
    "Naložite PDF, DOCX, ODT, XLSX, CSV, TXT ali MD (do 15 MB). Besedilo se prebere na tem računalniku; preberete ga s »Pregled« in ga z »Dodaj v znanje« dodate v znanje z imenom datoteke (šele takrat ga Lina uporablja v klicih); vrstice s cenami izpustim. Če imate shranjen ključ modela, gre izsek besedila (do 3500 znakov) vašemu ponudniku modela, ki predlaga izdelke za katalog; v katalog pridejo šele po vaši potrditvi.",
  nalozi: "Naloži PDF, DOCX, ODT, XLSX ali CSV",
  skrajsano: "Dokument je daljši od 500.000 znakov; v znanje je šel samo začetek.",
  polno: "V znanju ni dovolj prostora za ta dokument (največ 500.000 znakov). Skrajšajte znanje ali izbrišite drug dokument.",
  nalagam: "Berem dokument …",
  ni: "Ni naloženih dokumentov.",
  pregled: "Pregled",
  skrij: "Skrij",
  izbrisi: "Izbriši",
  znakov: "znakov",
  urejeno: "Dokument je izbrisan. Besedilo v znanju ste spremenili, zato ga odstranite ročno.",
  izbrisano: "Dokument in njegovo besedilo sta odstranjena iz znanja.",
  brezModela: "Za predlog izdelkov shranite ključ modela v nastavitvah.",
  objavi: "Dodaj v znanje",
  neobjavljen: "še ni v znanju",
  objavljeno: "Besedilo je dodano v znanje; Lina ga zdaj uporablja v klicih.",
  predlogNaslov: "Predlog izdelkov iz dokumenta",
  potrdi: "Dodaj izbrane v katalog",
  zavrzi: "Zavrzi predlog",
  shrani: "Dokument je prebran. Besedilo preverite s »Pregled« in ga potrdite z »Dodaj v znanje«; šele potem ga Lina uporablja v klicih.",
};

const en: Record<keyof typeof sl, string> = {
  vrsta: "The document must be PDF, DOCX, ODT, XLSX, CSV, TXT or MD.",
  velik: "The document is larger than 15 MB.",
  bomba: "The document is too large when unpacked or has too many parts, so I did not read it.",
  poskodovan: "I cannot read the document: the file is damaged or in an unsupported format.",
  sifriran: "The document is password protected. Save it without a password and upload it again.",
  cas: "Reading the document took too long, so I stopped.",
  prazen: "The document has no text I could add to the knowledge (lines with prices and amounts are left out).",
  kodiranje: "I cannot read the document as text.",
  pdfSken:
    "This PDF looks like a scanned document (images without text), so I cannot read its text. Save the text as DOCX, ODT or TXT and upload it.",
  prevec: "50 documents are already uploaded. Delete one before adding a new one.",
  niVira: "This document no longer exists.",
  niPredloga: "There is no proposal from the document or nothing is selected.",
  naslov: "Company documents",
  namig:
    "Upload PDF, DOCX, ODT, XLSX, CSV, TXT or MD (up to 15 MB). The text is read on this computer; check it with »Preview« and add it to the knowledge with »Add to knowledge« (only then does Lina use it in calls); lines with prices are left out. If you have a saved model key, an excerpt (up to 3500 characters) goes to your model provider, which suggests products for the catalogue; they are added only after you confirm.",
  nalozi: "Upload PDF, DOCX, ODT, XLSX or CSV",
  skrajsano: "The document is longer than 500,000 characters; only the beginning was added to the knowledge.",
  polno: "There is not enough room in the knowledge for this document (500,000 characters at most). Shorten the knowledge or delete another document.",
  nalagam: "Reading document …",
  ni: "No documents uploaded.",
  pregled: "Preview",
  skrij: "Hide",
  izbrisi: "Delete",
  znakov: "characters",
  urejeno: "The document is deleted. You changed its text in the knowledge, so remove it manually.",
  izbrisano: "The document and its text are removed from the knowledge.",
  brezModela: "To get product suggestions, save a model key in the settings.",
  objavi: "Add to knowledge",
  neobjavljen: "not in the knowledge yet",
  objavljeno: "The text is added to the knowledge; Lina now uses it in calls.",
  predlogNaslov: "Products suggested from the document",
  potrdi: "Add selected to catalogue",
  zavrzi: "Discard suggestion",
  shrani: "The document is read. Check the text with »Preview« and confirm it with »Add to knowledge«; only then does Lina use it in calls.",
};

export type BesedaDatotek = keyof typeof sl;
export const besedilaDatotek = { sl, en };

export function besedaDatotek(kljuc: BesedaDatotek, jezik: "sl" | "en" = "sl"): string {
  return besedilaDatotek[jezik][kljuc];
}
