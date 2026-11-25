import { randomBytes } from "node:crypto";
import { definePlugin } from "nitro";

const KLJUC = Symbol.for("lina.zagon.zeton");
const GLAVA = "x-lina-zagon";
const NASLOV = "http://127.0.0.1/api/zagon";

const ZETONI = Symbol.for("lina.zetoni.lupine");

type Globalno = { [KLJUC]?: string; [ZETONI]?: { lupina?: string; koncaj?: string } };

/** Naloga 11 N2: kot prevzemiZetone v zetoni-lupine.server.ts (isti kljuc); vticnik ne uvaza kode Line (G3b). */
function prevzemiZetone(): void {
  const z = ((globalThis as Globalno)[ZETONI] ??= {});
  if (process.env.LINA_LUPINA_ZETON) z.lupina = process.env.LINA_LUPINA_ZETON;
  if (process.env.LINA_KONCAJ_ZETON) z.koncaj = process.env.LINA_KONCAJ_ZETON;
  delete process.env.LINA_LUPINA_ZETON;
  delete process.env.LINA_KONCAJ_ZETON;
}

/**
 * Priprava glasu ob zagonu programa. Vticnik ne uvozi kode Line (imel bi svojo kopijo stanja v pomnilniku),
 * ampak poslje eno notranjo zahtevo POST na /api/zagon z enkratnim zetonom prek globalThis.
 */
export default definePlugin((nitroApp) => {
  // naloga 11 N2: zetona lupine iz okolja v pomnilnik, preden streznik zazene kateregakoli otroka (otroci ju ne podedujejo)
  prevzemiZetone();
  const zeton = randomBytes(32).toString("hex");
  (globalThis as Globalno)[KLJUC] = zeton;
  void Promise.resolve()
    .then(() =>
      nitroApp.fetch(
        new Request(NASLOV, {
          method: "POST",
          headers: { [GLAVA]: zeton },
        }),
      ),
    )
    .catch(() => undefined);
});
