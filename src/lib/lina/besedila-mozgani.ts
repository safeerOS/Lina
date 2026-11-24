import { jezikVmesnika } from "./besedila.ts";
/**
 * Besedila nastavitev »Model za klice« in »Model za asistentko« ter kljuca OpenRouter samo za asistentko (lastnik 24. 11. 2026,
 * NALOGA-LINA-MODELI-KLICI-IN-ASISTENTKA.md A1, A6, B5, C1, C4). Locena datoteka (kot besedila-avtonomija.ts), da se zdruzitev
 * z besedila.ts ne zaplete; sest jezikov: sl, en, de, es, fr, it. Manjkajoce besedilo pade na slovenscino.
 */
export const slM = {
  naslovKlici: "Model za klice",
  naslovAsistentka: "Model za asistentko",
  istiKotKlici: "Isti kot klici",
  enPonudnik:
    "Z enim ponudnikom Lina uporablja isti model za klice in asistentko. Drugi izbirnik se pojavi, ko shranite ključ drugega ponudnika.",
  asistentkaOpis: "Izbira velja za pogovor z asistentko in naloge agentu, ne za klice.",
  samoBrezplacniZaKlice: "Za klice potrebujete model brez :free (brezplačni modeli so samo za asistentko).",
  kljucAsistentke: "Ključ OpenRouter samo za asistentko (neobvezno)",
  kljucAsistentkeOpis:
    "Ključ se uporabi samo za pogovor z asistentko in naloge agentu. Ponudnik za klice ostane nespremenjen.",
  soglasje:
    "Brezplačni modeli: ponudnik lahko vaša sporočila uporabi za učenje. Velja samo za asistentko, nikoli za klice. V računu OpenRouter vklopite Settings → Privacy → Enable free endpoints that may train on inputs.",
  soglasjePotrdi: "Razumem in dovolim brezplačne modele za asistentko",
  shraniKljuc: "Shrani ključ za asistentko",
  odstraniKljuc: "Odstrani ključ za asistentko",
  preveri: "Preveri asistentko",
  stikalo: "Dovoli brezplačne modele (samo asistentka)",
  stikaloOpis:
    "Ponudnik brezplačnega modela lahko vaša sporočila uporabi za učenje. Velja samo za pogovor z asistentko, nikoli za klice. V računu OpenRouter morate vklopiti tudi Settings → Privacy → Enable free endpoints that may train on inputs.",
  modelAsistentke: "Model asistentke (OpenRouter)",
  racunBrezplacen: "Račun brez dobroimetja: na voljo so samo brezplačni modeli.",
  racunPlacljiv: "Račun z dobroimetjem: izberete lahko katerikoli model.",
  dnevno: "Brezplačni zahtevki danes: še {preostalo} od {meja}.",
  osveziStanje: "Preberi stanje računa",
  shranjeno: "Shranjeno.",
};

export type BesedaM = keyof typeof slM;

export const enM: { [K in BesedaM]: string } = {
  naslovKlici: "Model for calls",
  naslovAsistentka: "Model for the assistant",
  istiKotKlici: "Same as calls",
  enPonudnik:
    "With one provider, Lina uses the same model for calls and the assistant. The second picker appears when you save a key for another provider.",
  asistentkaOpis: "The choice applies to conversations with the assistant and agent tasks, not to calls.",
  samoBrezplacniZaKlice: "Calls need a model without :free (free models are for the assistant only).",
  kljucAsistentke: "OpenRouter key for the assistant only (optional)",
  kljucAsistentkeOpis: "The key is used only for conversations with the assistant and agent tasks. The provider for calls stays unchanged.",
  soglasje:
    "Free models: the provider may use your messages for training. Applies to the assistant only, never to calls. In your OpenRouter account enable Settings → Privacy → Enable free endpoints that may train on inputs.",
  soglasjePotrdi: "I understand and allow free models for the assistant",
  shraniKljuc: "Save assistant key",
  odstraniKljuc: "Remove assistant key",
  preveri: "Test the assistant",
  stikalo: "Allow free models (assistant only)",
  stikaloOpis:
    "The provider of a free model may use your messages for training. Applies only to conversations with the assistant, never to calls. In your OpenRouter account you must also enable Settings → Privacy → Enable free endpoints that may train on inputs.",
  modelAsistentke: "Assistant model (OpenRouter)",
  racunBrezplacen: "Account without credit: only free models are available.",
  racunPlacljiv: "Account with credit: you can choose any model.",
  dnevno: "Free requests today: {preostalo} of {meja} left.",
  osveziStanje: "Read account status",
  shranjeno: "Saved.",
};

export const deM: { [K in BesedaM]: string } = {
  naslovKlici: "Modell für Anrufe",
  naslovAsistentka: "Modell für die Assistentin",
  istiKotKlici: "Wie bei Anrufen",
  enPonudnik:
    "Mit einem Anbieter verwendet Lina dasselbe Modell für Anrufe und die Assistentin. Die zweite Auswahl erscheint, wenn Sie einen Schlüssel eines weiteren Anbieters speichern.",
  asistentkaOpis: "Die Auswahl gilt für Gespräche mit der Assistentin und Agentenaufgaben, nicht für Anrufe.",
  samoBrezplacniZaKlice: "Für Anrufe brauchen Sie ein Modell ohne :free (kostenlose Modelle nur für die Assistentin).",
  kljucAsistentke: "OpenRouter-Schlüssel nur für die Assistentin (optional)",
  kljucAsistentkeOpis: "Der Schlüssel wird nur für Gespräche mit der Assistentin und Agentenaufgaben verwendet. Der Anbieter für Anrufe bleibt unverändert.",
  soglasje:
    "Kostenlose Modelle: Der Anbieter kann Ihre Nachrichten zum Training verwenden. Gilt nur für die Assistentin, nie für Anrufe. Aktivieren Sie im OpenRouter-Konto Settings → Privacy → Enable free endpoints that may train on inputs.",
  soglasjePotrdi: "Ich verstehe und erlaube kostenlose Modelle für die Assistentin",
  shraniKljuc: "Schlüssel der Assistentin speichern",
  odstraniKljuc: "Schlüssel der Assistentin entfernen",
  preveri: "Assistentin prüfen",
  stikalo: "Kostenlose Modelle erlauben (nur Assistentin)",
  stikaloOpis:
    "Der Anbieter eines kostenlosen Modells kann Ihre Nachrichten zum Training verwenden. Gilt nur für Gespräche mit der Assistentin, nie für Anrufe. Im OpenRouter-Konto müssen Sie auch Settings → Privacy → Enable free endpoints that may train on inputs aktivieren.",
  modelAsistentke: "Modell der Assistentin (OpenRouter)",
  racunBrezplacen: "Konto ohne Guthaben: nur kostenlose Modelle verfügbar.",
  racunPlacljiv: "Konto mit Guthaben: Sie können jedes Modell wählen.",
  dnevno: "Kostenlose Anfragen heute: noch {preostalo} von {meja}.",
  osveziStanje: "Kontostand lesen",
  shranjeno: "Gespeichert.",
};

export const esM: { [K in BesedaM]: string } = {
  naslovKlici: "Modelo para llamadas",
  naslovAsistentka: "Modelo para la asistente",
  istiKotKlici: "El mismo que para llamadas",
  enPonudnik:
    "Con un solo proveedor, Lina usa el mismo modelo para llamadas y para la asistente. El segundo selector aparece al guardar la clave de otro proveedor.",
  asistentkaOpis: "La elección se aplica a las conversaciones con la asistente y a las tareas del agente, no a las llamadas.",
  samoBrezplacniZaKlice: "Las llamadas necesitan un modelo sin :free (los modelos gratuitos son solo para la asistente).",
  kljucAsistentke: "Clave de OpenRouter solo para la asistente (opcional)",
  kljucAsistentkeOpis: "La clave se usa solo para conversaciones con la asistente y tareas del agente. El proveedor de llamadas no cambia.",
  soglasje:
    "Modelos gratuitos: el proveedor puede usar sus mensajes para entrenamiento. Solo para la asistente, nunca para llamadas. En su cuenta de OpenRouter active Settings → Privacy → Enable free endpoints that may train on inputs.",
  soglasjePotrdi: "Entiendo y permito modelos gratuitos para la asistente",
  shraniKljuc: "Guardar clave de la asistente",
  odstraniKljuc: "Quitar clave de la asistente",
  preveri: "Probar la asistente",
  stikalo: "Permitir modelos gratuitos (solo asistente)",
  stikaloOpis:
    "El proveedor de un modelo gratuito puede usar sus mensajes para entrenamiento. Solo para conversaciones con la asistente, nunca para llamadas. En su cuenta de OpenRouter también debe activar Settings → Privacy → Enable free endpoints that may train on inputs.",
  modelAsistentke: "Modelo de la asistente (OpenRouter)",
  racunBrezplacen: "Cuenta sin saldo: solo hay modelos gratuitos.",
  racunPlacljiv: "Cuenta con saldo: puede elegir cualquier modelo.",
  dnevno: "Solicitudes gratuitas hoy: quedan {preostalo} de {meja}.",
  osveziStanje: "Leer estado de la cuenta",
  shranjeno: "Guardado.",
};

export const frM: { [K in BesedaM]: string } = {
  naslovKlici: "Modèle pour les appels",
  naslovAsistentka: "Modèle pour l'assistante",
  istiKotKlici: "Le même que pour les appels",
  enPonudnik:
    "Avec un seul fournisseur, Lina utilise le même modèle pour les appels et l'assistante. Le second sélecteur apparaît lorsque vous enregistrez la clé d'un autre fournisseur.",
  asistentkaOpis: "Le choix s'applique aux conversations avec l'assistante et aux tâches de l'agent, pas aux appels.",
  samoBrezplacniZaKlice: "Les appels nécessitent un modèle sans :free (les modèles gratuits sont réservés à l'assistante).",
  kljucAsistentke: "Clé OpenRouter pour l'assistante uniquement (facultatif)",
  kljucAsistentkeOpis: "La clé sert uniquement aux conversations avec l'assistante et aux tâches de l'agent. Le fournisseur des appels ne change pas.",
  soglasje:
    "Modèles gratuits : le fournisseur peut utiliser vos messages pour l'entraînement. Uniquement pour l'assistante, jamais pour les appels. Dans votre compte OpenRouter, activez Settings → Privacy → Enable free endpoints that may train on inputs.",
  soglasjePotrdi: "Je comprends et j'autorise les modèles gratuits pour l'assistante",
  shraniKljuc: "Enregistrer la clé de l'assistante",
  odstraniKljuc: "Supprimer la clé de l'assistante",
  preveri: "Tester l'assistante",
  stikalo: "Autoriser les modèles gratuits (assistante uniquement)",
  stikaloOpis:
    "Le fournisseur d'un modèle gratuit peut utiliser vos messages pour l'entraînement. Uniquement pour les conversations avec l'assistante, jamais pour les appels. Dans votre compte OpenRouter, vous devez aussi activer Settings → Privacy → Enable free endpoints that may train on inputs.",
  modelAsistentke: "Modèle de l'assistante (OpenRouter)",
  racunBrezplacen: "Compte sans crédit : seuls les modèles gratuits sont disponibles.",
  racunPlacljiv: "Compte avec crédit : vous pouvez choisir n'importe quel modèle.",
  dnevno: "Requêtes gratuites aujourd'hui : encore {preostalo} sur {meja}.",
  osveziStanje: "Lire l'état du compte",
  shranjeno: "Enregistré.",
};

export const itM: { [K in BesedaM]: string } = {
  naslovKlici: "Modello per le chiamate",
  naslovAsistentka: "Modello per l'assistente",
  istiKotKlici: "Uguale alle chiamate",
  enPonudnik:
    "Con un solo fornitore, Lina usa lo stesso modello per le chiamate e per l'assistente. Il secondo selettore compare quando salvi la chiave di un altro fornitore.",
  asistentkaOpis: "La scelta vale per le conversazioni con l'assistente e i compiti dell'agente, non per le chiamate.",
  samoBrezplacniZaKlice: "Per le chiamate serve un modello senza :free (i modelli gratuiti sono solo per l'assistente).",
  kljucAsistentke: "Chiave OpenRouter solo per l'assistente (facoltativa)",
  kljucAsistentkeOpis: "La chiave si usa solo per le conversazioni con l'assistente e i compiti dell'agente. Il fornitore delle chiamate non cambia.",
  soglasje:
    "Modelli gratuiti: il fornitore può usare i tuoi messaggi per l'addestramento. Solo per l'assistente, mai per le chiamate. Nel tuo account OpenRouter attiva Settings → Privacy → Enable free endpoints that may train on inputs.",
  soglasjePotrdi: "Ho capito e consento i modelli gratuiti per l'assistente",
  shraniKljuc: "Salva la chiave dell'assistente",
  odstraniKljuc: "Rimuovi la chiave dell'assistente",
  preveri: "Verifica l'assistente",
  stikalo: "Consenti modelli gratuiti (solo assistente)",
  stikaloOpis:
    "Il fornitore di un modello gratuito può usare i tuoi messaggi per l'addestramento. Vale solo per le conversazioni con l'assistente, mai per le chiamate. Nel tuo account OpenRouter devi attivare anche Settings → Privacy → Enable free endpoints that may train on inputs.",
  modelAsistentke: "Modello dell'assistente (OpenRouter)",
  racunBrezplacen: "Account senza credito: solo modelli gratuiti disponibili.",
  racunPlacljiv: "Account con credito: puoi scegliere qualsiasi modello.",
  dnevno: "Richieste gratuite oggi: ne restano {preostalo} su {meja}.",
  osveziStanje: "Leggi lo stato dell'account",
  shranjeno: "Salvato.",
};

export const besedilaM = { sl: slM, en: enM, de: deM, es: esM, fr: frM, it: itM };
export type JezikM = keyof typeof besedilaM;

export function tM(kljuc: BesedaM, jezik: JezikM = jezikVmesnika()): string {
  return besedilaM[jezik]?.[kljuc] ?? slM[kljuc];
}
