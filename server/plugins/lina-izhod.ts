import { definePlugin } from "nitro";

const KLJUC = Symbol.for("lina.izhod.prijavljen");
const ROK_MS = 3000;

/**
 * Konec procesa po signalu (23. 11. 2026). srvx ob SIGTERM/SIGINT zapre samo glavni streznik HTTP; streznika za telefon
 * (8446) in glas (8447) ter casovniki drzijo proces ziv, zato je star streznik ostal brez lupine in drzal vrata telefona
 * (izmerjeno: pid 613310 in 732071 sta SIGTERM prezrla). Po signalu damo zapiranju ROK_MS, nato proces konca;
 * pospravljanje ob »exit« (tunel, opravila) se izvede. Lupina po 6 s poslje SIGKILL, zato je rok krajsi.
 */
export default definePlugin(() => {
  const g = globalThis as { [KLJUC]?: boolean };
  if (g[KLJUC]) return;
  g[KLJUC] = true;
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(signal, () => {
      setTimeout(() => process.exit(0), ROK_MS).unref();
    });
  }
});
