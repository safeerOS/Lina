// Deklaracije za scripts/sluzba.mjs (cisti Node); uporablja jih preizkus src/lib/lina/cr-popravki.test.ts.
type Okolje = NodeJS.ProcessEnv | Record<string, string | undefined>;
export function namesti(env?: Okolje): string;
export function odstrani(env?: Okolje, ctl?: (...args: string[]) => { koda: number; izpis: string }): string;
export function stanje(env?: Okolje): string;
