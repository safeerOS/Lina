import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
// @ts-expect-error - .mjs brez tipov
import { aliasUcenjaLH } from "./scripts/ucenje-lh-zastavica.mjs";

export default defineConfig({
  // LINA_BREZ_UCENJA_LH=1: gradnja brez AGPL modula ucenje-lh (nadomestek ucenje-lh-prazno.server.ts)
  resolve: { alias: [{ find: "@", replacement: path.resolve(import.meta.dirname, "src") }, ...aliasUcenjaLH(process.env, import.meta.dirname)] },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    nitro({ plugins: ["./server/plugins/lina-zagon.ts", "./server/plugins/lina-izhod.ts"] }),
    viteReact(),
  ],
});
