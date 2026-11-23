/**
 * Najvecja dolzina dobesednega zapisa govora (izbirni dodatek Soniox).
 * V svoji datoteki, ker jo uporablja tudi pot klica (live/vstop.server.ts), ta pa ne sme dosegati poti telefona
 * (sinhron-telefon.server.ts uvaza kanal-claude.ts in asistent-pogovor.server.ts; preizkus kanal-claude 4.4).
 */
export const MEJA_DOBESEDNO = 6000;
