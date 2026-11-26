import { jezikVmesnika } from "./besedila.ts";
/**
 * Besedila razdelka »Kljuci za mozgane na vseh napravah« (NALOGA-35, lastnik 26. 11. 2026). Locena datoteka kot besedila-mozgani.ts;
 * sest jezikov: sl, en, de, es, fr, it. Manjkajoce besedilo pade na slovenscino.
 */
export const slK = {
  naslov: "Ključi za možgane na vseh napravah",
  opis: "Ključ, ki ga dodate, spremenite ali odstranite tu ali na drugi seznanjeni napravi z Lino (računalnik ali telefon), se šifrirano prenese na vse vaše naprave. Prikazana sta samo oznaka in zadnji 4 znaki.",
  prazno: "Ni shranjenih ključev.",
  vUporabi: "v uporabi na tem računalniku",
  taRacunalnik: "ta računalnik",
  drugaNaprava: "druga naprava",
  spremenil: "Zadnja sprememba: {naprava}",
  uporabi: "Uporabi na tem računalniku",
  preimenuj: "Preimenuj",
  shraniOznako: "Shrani oznako",
  preklici: "Prekliči",
  odstrani: "Odstrani",
  potrdiOdstranitev: "Odstranim ključ »{oznaka}« na vseh vaših napravah?",
  dodajNaslov: "Dodaj ključ",
  ponudnik: "Ponudnik",
  oznaka: "Oznaka",
  oznakaNamig: "Npr. Gemini služba. Več ključev istega ponudnika loči oznaka.",
  kljuc: "Ključ API",
  dodaj: "Dodaj ključ",
  odstranjen: "Ključ za {ponudniki} je bil odstranjen na drugi napravi. Lina zanj nima več ključa: dodajte novega ali uporabite drugega s seznama.",
  vRedu: "V redu",
};

export type BesedaK = keyof typeof slK;

export const enK: { [K in BesedaK]: string } = {
  naslov: "Brain keys on all devices",
  opis: "A key you add, change or remove here or on another paired device with Lina (computer or phone) is sent encrypted to all your devices. Only the label and the last 4 characters are shown.",
  prazno: "No saved keys.",
  vUporabi: "in use on this computer",
  taRacunalnik: "this computer",
  drugaNaprava: "another device",
  spremenil: "Last change: {naprava}",
  uporabi: "Use on this computer",
  preimenuj: "Rename",
  shraniOznako: "Save label",
  preklici: "Cancel",
  odstrani: "Remove",
  potrdiOdstranitev: "Remove the key “{oznaka}” on all your devices?",
  dodajNaslov: "Add key",
  ponudnik: "Provider",
  oznaka: "Label",
  oznakaNamig: "E.g. Gemini work. Several keys of the same provider are told apart by the label.",
  kljuc: "API key",
  dodaj: "Add key",
  odstranjen: "The key for {ponudniki} was removed on another device. Lina no longer has a key for it: add a new one or use another one from the list.",
  vRedu: "OK",
};

export const deK: { [K in BesedaK]: string } = {
  naslov: "KI-Schlüssel auf allen Geräten",
  opis: "Ein Schlüssel, den Sie hier oder auf einem anderen gekoppelten Gerät mit Lina (Computer oder Telefon) hinzufügen, ändern oder entfernen, wird verschlüsselt an alle Ihre Geräte übertragen. Angezeigt werden nur die Bezeichnung und die letzten 4 Zeichen.",
  prazno: "Keine gespeicherten Schlüssel.",
  vUporabi: "auf diesem Computer verwendet",
  taRacunalnik: "dieser Computer",
  drugaNaprava: "anderes Gerät",
  spremenil: "Letzte Änderung: {naprava}",
  uporabi: "Auf diesem Computer verwenden",
  preimenuj: "Umbenennen",
  shraniOznako: "Bezeichnung speichern",
  preklici: "Abbrechen",
  odstrani: "Entfernen",
  potrdiOdstranitev: "Schlüssel „{oznaka}“ auf allen Ihren Geräten entfernen?",
  dodajNaslov: "Schlüssel hinzufügen",
  ponudnik: "Anbieter",
  oznaka: "Bezeichnung",
  oznakaNamig: "Z. B. Gemini Arbeit. Mehrere Schlüssel desselben Anbieters unterscheidet die Bezeichnung.",
  kljuc: "API-Schlüssel",
  dodaj: "Schlüssel hinzufügen",
  odstranjen: "Der Schlüssel für {ponudniki} wurde auf einem anderen Gerät entfernt. Lina hat dafür keinen Schlüssel mehr: Fügen Sie einen neuen hinzu oder verwenden Sie einen anderen aus der Liste.",
  vRedu: "OK",
};

export const esK: { [K in BesedaK]: string } = {
  naslov: "Claves de IA en todos los dispositivos",
  opis: "Una clave que añada, cambie o elimine aquí o en otro dispositivo vinculado con Lina (ordenador o teléfono) se envía cifrada a todos sus dispositivos. Solo se muestran la etiqueta y los 4 últimos caracteres.",
  prazno: "No hay claves guardadas.",
  vUporabi: "en uso en este ordenador",
  taRacunalnik: "este ordenador",
  drugaNaprava: "otro dispositivo",
  spremenil: "Último cambio: {naprava}",
  uporabi: "Usar en este ordenador",
  preimenuj: "Cambiar nombre",
  shraniOznako: "Guardar etiqueta",
  preklici: "Cancelar",
  odstrani: "Eliminar",
  potrdiOdstranitev: "¿Eliminar la clave «{oznaka}» en todos sus dispositivos?",
  dodajNaslov: "Añadir clave",
  ponudnik: "Proveedor",
  oznaka: "Etiqueta",
  oznakaNamig: "P. ej. Gemini trabajo. Varias claves del mismo proveedor se distinguen por la etiqueta.",
  kljuc: "Clave API",
  dodaj: "Añadir clave",
  odstranjen: "La clave de {ponudniki} se eliminó en otro dispositivo. Lina ya no tiene clave para él: añada una nueva o use otra de la lista.",
  vRedu: "Aceptar",
};

export const frK: { [K in BesedaK]: string } = {
  naslov: "Clés IA sur tous les appareils",
  opis: "Une clé ajoutée, modifiée ou supprimée ici ou sur un autre appareil associé à Lina (ordinateur ou téléphone) est transmise chiffrée à tous vos appareils. Seuls le libellé et les 4 derniers caractères sont affichés.",
  prazno: "Aucune clé enregistrée.",
  vUporabi: "utilisée sur cet ordinateur",
  taRacunalnik: "cet ordinateur",
  drugaNaprava: "un autre appareil",
  spremenil: "Dernière modification : {naprava}",
  uporabi: "Utiliser sur cet ordinateur",
  preimenuj: "Renommer",
  shraniOznako: "Enregistrer le libellé",
  preklici: "Annuler",
  odstrani: "Supprimer",
  potrdiOdstranitev: "Supprimer la clé « {oznaka} » sur tous vos appareils ?",
  dodajNaslov: "Ajouter une clé",
  ponudnik: "Fournisseur",
  oznaka: "Libellé",
  oznakaNamig: "P. ex. Gemini travail. Plusieurs clés du même fournisseur se distinguent par le libellé.",
  kljuc: "Clé API",
  dodaj: "Ajouter la clé",
  odstranjen: "La clé pour {ponudniki} a été supprimée sur un autre appareil. Lina n'a plus de clé pour ce fournisseur : ajoutez-en une nouvelle ou utilisez-en une autre de la liste.",
  vRedu: "OK",
};

export const itK: { [K in BesedaK]: string } = {
  naslov: "Chiavi IA su tutti i dispositivi",
  opis: "Una chiave aggiunta, modificata o rimossa qui o su un altro dispositivo associato a Lina (computer o telefono) viene inviata cifrata a tutti i tuoi dispositivi. Sono mostrati solo l'etichetta e gli ultimi 4 caratteri.",
  prazno: "Nessuna chiave salvata.",
  vUporabi: "in uso su questo computer",
  taRacunalnik: "questo computer",
  drugaNaprava: "un altro dispositivo",
  spremenil: "Ultima modifica: {naprava}",
  uporabi: "Usa su questo computer",
  preimenuj: "Rinomina",
  shraniOznako: "Salva etichetta",
  preklici: "Annulla",
  odstrani: "Rimuovi",
  potrdiOdstranitev: "Rimuovere la chiave «{oznaka}» su tutti i tuoi dispositivi?",
  dodajNaslov: "Aggiungi chiave",
  ponudnik: "Fornitore",
  oznaka: "Etichetta",
  oznakaNamig: "Es. Gemini lavoro. Più chiavi dello stesso fornitore si distinguono per l'etichetta.",
  kljuc: "Chiave API",
  dodaj: "Aggiungi chiave",
  odstranjen: "La chiave per {ponudniki} è stata rimossa su un altro dispositivo. Lina non ha più una chiave per questo fornitore: aggiungine una nuova o usane un'altra dall'elenco.",
  vRedu: "OK",
};

export const besedilaK = { sl: slK, en: enK, de: deK, es: esK, fr: frK, it: itK };
export type JezikK = keyof typeof besedilaK;

export function tK(kljuc: BesedaK, vstavi: Record<string, string> = {}, jezik: JezikK = jezikVmesnika() as JezikK): string {
  const b = besedilaK[jezik]?.[kljuc] ?? slK[kljuc];
  return b.replace(/\{(\w+)\}/g, (_, k: string) => vstavi[k] ?? `{${k}}`);
}
