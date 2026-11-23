import { createFileRoute } from "@tanstack/react-router";
import { getRequestIP } from "@tanstack/react-start/server";
import { handleNapakeRequest } from "@/lib/lina/napake.server.ts";

/** Napake vmesnika (brez osebnih podatkov) v dnevnik programa. */
export const Route = createFileRoute("/api/napake")({
  server: {
    handlers: {
      POST: async ({ request }) => handleNapakeRequest(request, getRequestIP()),
    },
  },
});
