import { defineConfig } from "vitest/config";

/** Samostojna nastavitev, da se ne prime nadrejenega Vite projekta. */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
