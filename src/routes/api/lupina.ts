import { createFileRoute } from "@tanstack/react-router";
import { getRequestIP } from "@tanstack/react-start/server";
import { handleLupinaRequest } from "@/lib/lina/lupina.server.ts";

/** Stanje linije in klica za lupino programa (okno, ikona). Brez zetona lupine ali z drugega racunalnika je 403. */
export const Route = createFileRoute("/api/lupina")({
  server: {
    handlers: {
      GET: async ({ request }) => handleLupinaRequest(request, getRequestIP()),
      POST: async ({ request }) => handleLupinaRequest(request, getRequestIP()),
    },
  },
});
