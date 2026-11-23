/**
 * Rok dosegljivosti hitrega tunela. Izmerjeno 16. 11. 2026 na prenosniku s Scitom in systemd-resolved: DNS cona
 * trycloudflare.com ima negativni TTL 60 s (SOA), Lina pa preverja takoj po izpisu naslova, zato sistemski razresevalnik
 * prvi neuspeh obdrzi 60 s. Rok 30 s je bil prekratek (»Naslov se ni postal dosegljiv v dolocenem casu«), testni klic
 * brez javnega naslova ni mogel steci. Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROK_DOSEGLJIVOSTI_MS } from "./tunel.server.ts";

describe("rok dosegljivosti tunela", () => {
  it("je daljsi od negativnega TTL DNS (60 s) skupaj z razsirjanjem DNS", () => {
    assert.ok(ROK_DOSEGLJIVOSTI_MS >= 120_000, `rok ${ROK_DOSEGLJIVOSTI_MS} ms je prekratek`);
  });
});
