/**
 * Lina M2, S4 (slepi varnostni pregled 15. 11. 2026): preizkus, ki varuje PRIPETJE povezave na preverjeni naslov (DNS rebinding).
 * Prej je mutacija »ponovno razresevanje tik pred povezavo« (M8) preziveta vseh 98 preizkusov, ker so uporabljali stalen razresevalnik.
 * Razresevalnik tu ob drugem klicu za isto ime vrne zasebni naslov (127.0.0.1): kdor razresuje znova, se poveze na zasebni naslov.
 */
import assert from "node:assert/strict";
import net from "node:net";
import { describe, it } from "node:test";
import { preberiStran, type SpletOdgovor, type SpletZahteva } from "./splet.ts";
import { poveziHttps } from "./splet.server.ts";

const STRAN = "<html><head><title>Les</title></head><body><h1>Les</h1><p>Izdelujemo mize iz hrasta za dom v Sloveniji.</p></body></html>";

function odgovor(status: number, glave: Record<string, string>, telo: string): SpletOdgovor {
  return {
    status,
    glave,
    telo: (async function* () {
      yield new TextEncoder().encode(telo);
    })(),
    prekini: () => undefined,
  };
}

/** Rebinding razresevalnik: prvi klic za ime je javni naslov, vsak naslednji zasebni 127.0.0.1. */
function rebinding(javni: string): { razresi: (g: string) => Promise<string[]>; klici: Map<string, number> } {
  const klici = new Map<string, number>();
  return {
    klici,
    razresi: async (g) => {
      const n = (klici.get(g) ?? 0) + 1;
      klici.set(g, n);
      return n === 1 ? [javni] : ["127.0.0.1"];
    },
  };
}

describe("M2 S4: povezava je pripeta na preverjeni naslov (rebinding)", () => {
  // Koda razresuje ime pri VSAKI zahtevi (robots.txt, stran, skok) in vsakic preveri ter pripne; ob rebindingu sme druga zahteva
  // biti zavrnjena (zasebni naslov), nikoli pa se ne sme povezati na naslov, ki ni bil preverjen tik pred povezavo.
  async function brani(url: string, odv: Parameters<typeof preberiStran>[1]): Promise<string> {
    try {
      await preberiStran(url, odv);
      return "uspelo";
    } catch (e) {
      return e instanceof Error ? e.message : "napaka";
    }
  }

  it("rebinding razresevalnik: nobena zahteva ne gre na zasebni naslov in prva je pripeta na preverjeni javni naslov", async () => {
    const r = rebinding("93.184.216.34");
    const zahteve: SpletZahteva[] = [];
    await brani("https://les.example/", {
      razresi: r.razresi,
      povezava: async (z) => {
        zahteve.push(z);
        if (z.pot === "/robots.txt") return odgovor(404, { "content-type": "text/plain" }, "");
        return odgovor(200, { "content-type": "text/html" }, STRAN);
      },
    });
    assert.ok(zahteve.length >= 1, "vsaj prva zahteva (robots.txt) je bila poslana");
    for (const z of zahteve) assert.equal(z.ip, "93.184.216.34", `zahteva ${z.pot}: povezava je pripeta na preverjeni naslov, ne na ponovno razresenega`);
  });

  it("izmenicni razresevalnik (liho javni, sodo zasebni) na vseh skokih: nikoli povezave na 127.0.0.1", async () => {
    const klici = new Map<string, number>();
    const zahteve: SpletZahteva[] = [];
    await brani("https://les.example/", {
      razresi: async (g) => {
        const n = (klici.get(g) ?? 0) + 1;
        klici.set(g, n);
        return n % 2 === 1 ? [g === "les.example" ? "93.184.216.34" : "93.184.216.35"] : ["127.0.0.1"];
      },
      povezava: async (z) => {
        zahteve.push(z);
        if (z.pot === "/robots.txt") return odgovor(404, {}, "");
        if (z.gostitelj === "les.example") return odgovor(301, { location: "https://www.les.example/domov" }, "");
        return odgovor(200, { "content-type": "text/html" }, STRAN);
      },
    });
    assert.ok(zahteve.length >= 1);
    for (const z of zahteve) assert.ok(z.ip === "93.184.216.34" || z.ip === "93.184.216.35", `${z.gostitelj}${z.pot} -> ${z.ip}`);
  });

  it("razresevalnik, ki je ves cas javni: zahteve nosijo natanko razresen naslov (kontrola, da preizkus ni prazen)", async () => {
    const zahteve: SpletZahteva[] = [];
    const izid = await brani("https://les.example/", {
      razresi: async () => ["93.184.216.34"],
      povezava: async (z) => {
        zahteve.push(z);
        if (z.pot === "/robots.txt") return odgovor(404, {}, "");
        return odgovor(200, { "content-type": "text/html" }, STRAN);
      },
    });
    assert.equal(izid, "uspelo");
    assert.ok(zahteve.length >= 2);
    for (const z of zahteve) assert.equal(z.ip, "93.184.216.34");
  });

  it("poveziHttps se poveze na dani naslov in ne razresuje imena (nikoli drugega DNS)", async () => {
    // Lokalni TCP streznik samo na 127.0.0.1: sprejme povezavo in jo takoj zapre (TLS rokovanje ne uspe, kar je tu v redu).
    let povezav = 0;
    const streznik = net.createServer((sock) => {
      povezav += 1;
      sock.destroy();
    });
    await new Promise<void>((resolve) => streznik.listen(0, "127.0.0.1", resolve));
    const vrata = (streznik.address() as net.AddressInfo).port;
    try {
      // Ime .invalid se nikoli ne razresi: povezava lahko uspe samo, ce poveziHttps uporabi dani naslov.
      await assert.rejects(
        poveziHttps({ ip: "127.0.0.1", vrata, gostitelj: "ni-razresljivo.invalid", pot: "/", rokMs: 3000, agent: "preizkus" }, new AbortController().signal),
      );
      assert.equal(povezav, 1, "TCP povezava je na dani naslov");
    } finally {
      await new Promise<void>((resolve) => streznik.close(() => resolve()));
    }
  });
});
