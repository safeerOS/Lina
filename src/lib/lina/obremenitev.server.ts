// Naloga 34: obremenitev tega racunalnika za razdelitev dela (telefon jo bere iz podpisanega /stanje in izbere najmanj obremenjenega).
// Neznana vrednost se IZPUSTI, nikoli 0: os.loadavg() na Windows vrne [0, 0, 0] in tak racunalnik bi bil vedno "prazen".
// Na Linuxu je [0, 0, 0] prava vrednost (miren racunalnik) - slepi pregled 34.
import os from "node:os";
import { jeWindows } from "./platforma.server.ts";

export type ObremenitevRacunalnika = { ime: string; jedra?: number; obremenitev5?: number; prostMb?: number };

type Viri = { loadavg: () => number[]; jedra: () => number; prostB: () => number; ime: () => string; windows?: () => boolean };
const PRAVI: Viri = { loadavg: () => os.loadavg(), jedra: () => os.availableParallelism(), prostB: () => os.freemem(), ime: () => os.hostname(), windows: () => jeWindows() };

export function obremenitevRacunalnika(v: Viri = PRAVI): ObremenitevRacunalnika {
  let surovo = "";
  try { surovo = v.ime(); } catch { /* ime gostitelja ni berljivo: privzeto ime */ }
  const ime = [...surovo].filter((c) => !/[\p{Cc}\p{Cf}]/u.test(c)).join("").trim().slice(0, 60) || "Racunalnik";
  const o: ObremenitevRacunalnika = { ime };
  const jedra = v.jedra();
  if (Number.isInteger(jedra) && jedra > 0 && jedra <= 1024) o.jedra = jedra;
  const l = v.loadavg();
  const windowsNicle = (v.windows?.() ?? false) && l.every((x) => x === 0);
  if (l.length >= 2 && !windowsNicle && Number.isFinite(l[1]) && l[1] >= 0) o.obremenitev5 = Math.round(l[1] * 100) / 100;
  const prost = v.prostB();
  if (Number.isFinite(prost) && prost > 0) o.prostMb = Math.floor(prost / 1048576);
  return o;
}
