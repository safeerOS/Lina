import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    nitro({ plugins: ["./server/plugins/lina-zagon.ts", "./server/plugins/lina-izhod.ts"] }),
    viteReact(),
  ],
});
