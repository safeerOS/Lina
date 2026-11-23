/**
 * Pravilo C (lastnik 15. 11. 2026: »klic ne sme koncati z odgovorom brez slovesa«), glasovni sloj (21. 11. 2026):
 * odgovor po zapisanem sporocilu dobi slovo, klic ostane odprt; tisina po slovesu klic TIHO konca (samo <Hangup/>, brez drugega slovesa
 * in brez praznega <Say>).
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { nastaviSintezoZaPreizkus, pocakajDnevnikGlasu, pocakajGlas, ustaviCiscenjeZvoka } from "./glas.server.ts";
import { defaultPravila } from "./pravila.server.ts";
import { writeJson } from "./store.server.ts";
import type { Catalog } from "./types.ts";
import { handleVoiceRequest } from "./voice.server.ts";

process.env.LINA_LLM = "0";
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-slovo-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const dirs: string[] = [];
afterEach(async () => {
  nastaviSintezoZaPreizkus(null);
  delete process.env.TWILIO_AUTH_TOKEN;
  while (dirs.length) {
    const dir = dirs.pop() as string;
    await pocakajGlas(dir);
    await pocakajDnevnikGlasu(dir);
    ustaviCiscenjeZvoka(dir);
  }
});

const katalog: Catalog = {
  company: { name: "Podjetje Primer", trade: "", phone: "+386 1 555 09 00", address: "", hours: "", about: "" },
  materials: [],
  products: [],
  zapiski: [],
  znanje: "",
};

describe("pravilo C v glasovnem sloju: slovo po odgovoru, tiho slovo ob tisini", () => {
  it("odgovor po zapisu ima slovo in klic ostane odprt; tisina potem samo tiho konca (Hangup, brez drugega slovesa in praznega Say)", async () => {
    const dir = await mkdtemp(path.join(KOREN, "d-"));
    dirs.push(dir);
    await writeJson(dir, "line.json", { open: true, catalog: katalog, updatedAt: null });
    await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi", nacinKlica: "osebna", imeLastnika: "Ana" });
    process.env.TWILIO_AUTH_TOKEN = "zeton-preizkusa";
    const klic = async (pot: string, params: Record<string, string>) => {
      const url = `https://lina.primer${pot}`;
      const podpis = createHmac("sha1", "zeton-preizkusa").update(Object.keys(params).sort().reduce((a, k) => a + k + params[k], url)).digest("base64");
      const r = await handleVoiceRequest(
        new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": podpis }, body: new URLSearchParams(params).toString() }),
        dir,
        undefined,
        { razumevanje: async () => null } as never,
      );
      return r.text();
    };
    const sid = "CA-SLOVO-TISINA-1";
    const od = { CallSid: sid, From: "+38640000000" };
    await klic("/api/voice/incoming", od);
    const b = await klic("/api/voice/turn?obr=1", { ...od, SpeechResult: "Naj me jutri pokliče nazaj ker je urgenca." });
    assert.match(b, /Zapisala sem: .+ Ali sem prav razumela\?/);
    const c = await klic("/api/voice/turn?obr=2", { ...od, SpeechResult: "Pa še to da pridem jutri ob devetih zjutraj v pisarno." });
    const govorC = [...c.matchAll(/<Say[^>]*>([^<]*)<\/Say>/g)].map((m) => m[1]).join(" ").replace(/\s+/g, " ").trim();
    assert.match(govorC, /nasvidenje\.$/, `odgovor po zapisu ima slovo: ${govorC}`);
    assert.doesNotMatch(c, /<Hangup\/>/, "klic ostane odprt, Lina poslusa naprej");
    const d = await klic("/api/voice/turn?obr=3", od);
    assert.match(d, /<Hangup\/>/, "tisina po slovesu klic konca");
    assert.doesNotMatch(d, /nasvidenje/, "brez drugega slovesa");
    assert.doesNotMatch(d, /<Say[^>]*>\s*<\/Say>/, "brez praznega <Say>");
  });
});
