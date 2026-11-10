import { defineConfig } from "vitest/config";

/** Samostojna nastavitev, da se ne prime nadrejenega Vite projekta. */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Preizkusi zaganjajo procese in ustvarjajo kljuce RSA. Privzetih 5 s je na zasedenem racunalniku
    // premalo: 10. 11. 2026 sta dva obstojeca preizkusa v security.test.ts padla v 3 od 15 celih tekov
    // (5,0 do 5,2 s; obremenitev 6 do 10 na dveh jedrih). Rok ni trditev; trditve so nespremenjene.
    testTimeout: 20_000,
  },
});
