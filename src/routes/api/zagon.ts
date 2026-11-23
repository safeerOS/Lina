import { createFileRoute } from "@tanstack/react-router";
import { handleZagonRequest } from "@/lib/lina/zagon.server.ts";

/** Notranja zahteva vticnika zagona: pripravi Linin glas. Brez enkratnega zetona iz pomnilnika procesa je 403. */
export const Route = createFileRoute("/api/zagon")({
  server: {
    handlers: {
      POST: async ({ request }) => handleZagonRequest(request),
      // GET nima kaj iskati tukaj: brez tega bi streznik vrnil stran programa.
      GET: async ({ request }) => handleZagonRequest(request),
    },
  },
});
