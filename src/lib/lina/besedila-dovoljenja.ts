/**
 * Besedila skupnega modula dovoljenj »velja tudi za vse podobne« (naloga 02f): slovenscina in anglescina z enakimi kljuci.
 * Locena datoteka, da se zdruzitev z besedila.ts (drugi agenti dodajajo jezike) ne zaplete.
 */
import { jezikVmesnika } from "./besedila.ts";
import type { VrstaDovoljenja } from "./dovoljenja-podobne.ts";

export const slD = {
  izbira: "Velja tudi za vse podobne",
  izbiraPojasnilo: "Podobno: ista vrsta dejanja v istem obsegu. Preklic v Nastavitvah > Dovoljenja.",
  razlaga:
    "Dejanja, ki ste jih enkrat potrdili z izbiro »Velja tudi za vse podobne«. Lina podobnih ne vprašuje znova. Vedno znova vpraša za plačila in nakupe, brisanje podatkov, sporočila novim prejemnikom, spremembe dostopa ali nastavitev sistema, namestitve in vsako spremembo obsega.",
  prazno: "Ni shranjenih dovoljenj. Lina vpraša za vsako dejanje.",
  nalaga: "Nalagam …",
  zastarela: "Nekaj starejših dovoljenj ne velja več (spremenjena oblika obsega). Lina bo za ta dejanja vprašala znova; po potrditvi izberite »Velja tudi za vse podobne«. Število:",
  preklici: "Prekliči",
  napravaOznaka: "s telefona",
  racunalnikOznaka: "na računalniku",
  uporab: "uporab",
  zadnjic: "zadnjič",
  dnevnik: "Zadnje uporabe dovoljenj",
  vrsta_naloga_agentu: "Naloga agentu (agent, mapa)",
  vrsta_gradnja: "Zagon gradnje na GitHubu (tok, veja)",
  vrsta_dodatek: "Dodatek (dodatek, vklop/izklop)",
  vrsta_program: "Program v računalniku (CLI-Anything)",
  vrsta_avtonomija: "Samostojno opravilo (opravilo, povezava)",
  vrsta_narocila_uvoz: "Uvoz naročil podjetja (mapa, samo branje)",
  vrsta_n8n_zagon: "Zagon toka n8n (isti tok po ID)",
};

export const enD: Record<keyof typeof slD, string> = {
  izbira: "Also applies to all similar ones",
  izbiraPojasnilo: "Similar: the same kind of action in the same scope. Revoke in Settings > Permissions.",
  razlaga:
    "Actions you confirmed once with »Also applies to all similar ones«. Lina does not ask again for similar ones. It always asks again for payments and purchases, deleting data, messages to new recipients, changes to access or system settings, installations and any change of scope.",
  prazno: "No saved permissions. Lina asks for every action.",
  nalaga: "Loading …",
  zastarela: "Some older permissions no longer apply (the scope format changed). Lina will ask again for these actions; after confirming, choose »Also applies to all similar ones«. Count:",
  preklici: "Revoke",
  napravaOznaka: "from the phone",
  racunalnikOznaka: "on the computer",
  uporab: "uses",
  zadnjic: "last",
  dnevnik: "Recent permission uses",
  vrsta_naloga_agentu: "Agent task (agent, folder)",
  vrsta_gradnja: "GitHub build start (workflow, branch)",
  vrsta_dodatek: "Add-on (add-on, on/off)",
  vrsta_program: "Computer program (CLI-Anything)",
  vrsta_avtonomija: "Autonomous task (task, link)",
  vrsta_narocila_uvoz: "Company order import (folder, read only)",
  vrsta_n8n_zagon: "n8n workflow run (same workflow by ID)",
};

export function tD(kljuc: keyof typeof slD): string {
  return (jezikVmesnika() === "en" ? enD : slD)[kljuc];
}

export function imeVrste(v: VrstaDovoljenja): string {
  return tD(`vrsta_${v.replace("-", "_")}` as keyof typeof slD);
}
