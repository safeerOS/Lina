// Zastavica gradnje za modul ucenje-lh (AGPL-3.0): LINA_BREZ_UCENJA_LH=1 (ali katera koli neprazna vrednost razen 0) preslika edini vhod modula v nadomestek, zato koda modula
// ne pride v paket (komercialna zaprta raba). Lastna koda Safeer. Uporablja vite.config.ts; preizkus: ucenje-lh.test.ts.
import path from "node:path";

export const VHOD_UCENJA_LH = /^\.\/ucenje-lh\/vstop\.server\.ts$/;

/** Vite alias (seznam) za gradnjo brez modula; prazen seznam = modul je vgrajen. */
export function aliasUcenjaLH(env, koren) {
  // pregled V9 (naloga 8): fail-closed - vsaka neprazna vrednost razen »0« izpusti modul (»true«, »yes« ne smeta tiho vkljuciti AGPL)
  const v = String(env.LINA_BREZ_UCENJA_LH ?? "").trim();
  if (v === "" || v === "0") return [];
  return [{ find: VHOD_UCENJA_LH, replacement: path.join(koren, "src", "lib", "lina", "ucenje-lh-prazno.server.ts") }];
}
