import { createFileRoute } from "@tanstack/react-router";
import { odgovorLive } from "@/lib/lina/live/vstop.server.ts";
import { POT_LIVE } from "@/lib/lina/live/twiml.ts";
import { opozoriloPotrjeno } from "@/lib/lina/opozorilo.server.ts";
import { soglasjeDano } from "@/lib/lina/soglasje.server.ts";
import { resolveDataDir } from "@/lib/lina/store.server.ts";
import { handleVoiceGet, handleVoiceRequest, osveziAktivniKlic, sprostiAktivniKlic } from "@/lib/lina/voice.server.ts";

/** Telefonski vhod. Prijava ni potrebna; POST zahteva podpis Twilio, GET vrne samo posnetek z neuganljivim kljucem. */
export const Route = createFileRoute("/api/voice/$")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await soglasjeDano()) || !(await opozoriloPotrjeno())) return new Response("Lina se brez soglasja ne uporablja.", { status: 503 });
        return handleVoiceRequest(request);
      },
      // GET: posnetek Lininega glasu za Twilio <Play>; na poti Live nadgradnja v WebSocket za Twilio Media Streams
      // (zeton v dogodku 'start', glej live/vstop.server.ts); GET na vhode klica je 403.
      GET: async ({ request }) => {
        if (!(await soglasjeDano()) || !(await opozoriloPotrjeno())) return new Response("Lina se brez soglasja ne uporablja.", { status: 503 });
        if (new URL(request.url).pathname === POT_LIVE && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
          const root = resolveDataDir();
          return odgovorLive(
            request,
            {
              osvezi: (sid) => osveziAktivniKlic(root, sid),
              sprosti: (sid) => sprostiAktivniKlic(root, sid),
            },
            root,
            (koda) => console.info(`[lina] live: ${koda}`),
          );
        }
        return handleVoiceGet(request);
      },
    },
  },
});
