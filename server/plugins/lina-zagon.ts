import { randomBytes } from "node:crypto";
import { definePlugin } from "nitro";

const KLJUC = Symbol.for("lina.zagon.zeton");
const GLAVA = "x-lina-zagon";
const NASLOV = "http://127.0.0.1/api/zagon";

type Globalno = { [KLJUC]?: string };

/**
 * Priprava glasu ob zagonu programa. Vticnik ne uvozi kode Line (imel bi svojo kopijo stanja v pomnilniku),
 * ampak poslje eno notranjo zahtevo POST na /api/zagon z enkratnim zetonom prek globalThis.
 */
export default definePlugin((nitroApp) => {
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
