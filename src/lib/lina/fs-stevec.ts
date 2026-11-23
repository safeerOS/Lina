/**
 * Števec branj in pisanj calls.json za preverbo najdb H2/H4/H5 (fs-stevec.test.ts). MORA biti prvi uvoz v preizkusu,
 * ker zamenja funkcije node:fs/promises, preden jih drugi moduli uvozijo (syncBuiltinESMExports posodobi poimenovane uvoze).
 * REKONSTRUKCIJA (20. 11. 2026): izvirna datoteka je bila izbrisana; napisana po uporabi v preizkusu (ponastavi, st.beri/pisi/jsonlPisi)
 * in po tem, kako store.server.ts piše (pisanje v začasno datoteko + rename na calls.json).
 */
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

export const st = { beri: 0, pisi: 0, jsonlPisi: 0 };

export function ponastavi(): void {
  st.beri = 0;
  st.pisi = 0;
  st.jsonlPisi = 0;
}

const ime = (p: unknown): string => (typeof p === "string" ? path.basename(p) : p instanceof URL ? path.basename(p.pathname) : "");

const readFile0 = fsp.readFile.bind(fsp) as (...a: unknown[]) => Promise<unknown>;
const rename0 = fsp.rename.bind(fsp) as (...a: unknown[]) => Promise<unknown>;
const appendFile0 = fsp.appendFile.bind(fsp) as (...a: unknown[]) => Promise<unknown>;

const patch = fsp as unknown as Record<string, unknown>;
patch.readFile = (p: unknown, ...r: unknown[]) => {
  if (ime(p) === "calls.json") st.beri += 1;
  return readFile0(p, ...r);
};
patch.rename = (a: unknown, b: unknown, ...r: unknown[]) => {
  if (ime(b) === "calls.json") st.pisi += 1;
  return rename0(a, b, ...r);
};
patch.appendFile = (p: unknown, ...r: unknown[]) => {
  if (ime(p) === "delni-rezultati.jsonl") st.jsonlPisi += 1;
  return appendFile0(p, ...r);
};
syncBuiltinESMExports();
