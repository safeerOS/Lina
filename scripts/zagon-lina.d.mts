// Deklaracije za scripts/zagon-lina.mjs (cisti Node, brez paketov); uporablja jih store.server.test.ts.
export const SAFEER_OS_IME: string;
export const ZAKLEP_DATOTEKA: string;
export const PRIVZETA_VRATA: number;
export function privzetaMapa(env?: NodeJS.ProcessEnv | Record<string, string | undefined>, platform?: string): string;
export function mapaPodatkov(env?: NodeJS.ProcessEnv | Record<string, string | undefined>, platform?: string): string;
export function mapaJeSafeerjeva(mapa: string, domaca?: string): boolean;
export function zaznajSafeerOs(env?: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean;
export function zakleni(mapa: string, moj?: { pid: number }): { ok: boolean; pid?: number | null; vrata?: number | null; posodobi: (podatki: { vrata?: number | null; safeerOs?: boolean; otrok?: number; otrokZacetek?: string | null }) => void; sprosti: () => void };
export function izberiVrata(prednostna?: number, gostitelj?: string): Promise<number>;
export function sestaviEnoto(moznosti: { node: string; koren: string }): string;
export function pripraviZagon(env?: NodeJS.ProcessEnv | Record<string, string | undefined>): Promise<
  | { napaka: string }
  | { ostani: false; sporocilo: string }
  | { ostani: true; mapa: string; vrata: number; safeerOs: boolean; sprosti: () => void; zabeleziOtroka: (pid: number) => void }
>;
