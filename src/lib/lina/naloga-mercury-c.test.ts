/**
 * Mercury C. Pogoj dobesednosti: podatek, ki ga model izlusci iz strani, se zapise samo, ce je dobesedno v besedilu strani.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { besedeSoVViru, epostaJeVViru, preveriCitate, stevilkeSoVViru, telefonJeVViru } from "./citat.ts";
import { saveBrain } from "./keys.server.ts";
import { publishLine } from "./service.server.ts";
import { preberiStranPodjetja } from "./splet.server.ts";
import type { SpletOdgovor } from "./splet.ts";
import type { Catalog, Predlog } from "./types.ts";

const VIR = "Mizarstvo Les d.o.o. Obrtna ulica 9, Ljubljana. Telefon 01 555 09 00. info@les.example. Odprto pon-pet 8.00-16.00. Izdelujemo mize iz hrasta.";

describe("Mercury C: dobesedno v viru", () => {
  it("besede: vse pomembne besede morajo biti v viru", () => {
    assert.equal(besedeSoVViru("Mizarstvo Les", VIR), true);
    assert.equal(besedeSoVViru("mizarstvo les", VIR), true);
    assert.equal(besedeSoVViru("Mizarstvo Kovač", VIR), false);
    assert.equal(besedeSoVViru("", VIR), false);
    assert.equal(besedeSoVViru("miza iz hrast", VIR), true); // drug sklon iste besede
    assert.equal(besedeSoVViru("ab", VIR), false);
  });
  it("telefon: stevke so v viru, 0 ali +386 je isto, izmisljena stevilka ne", () => {
    assert.equal(telefonJeVViru("01 555 09 00", VIR), true);
    assert.equal(telefonJeVViru("+386 1 555 09 00", VIR), true);
    assert.equal(telefonJeVViru("01 555 09 01", VIR), false);
    assert.equal(telefonJeVViru("123", VIR), false);
  });
  it("e-posta in stevila", () => {
    assert.equal(epostaJeVViru("info@les.example", VIR), true);
    assert.equal(epostaJeVViru("INFO@les.example", VIR), true);
    assert.equal(epostaJeVViru("prodaja@les.example", VIR), false);
    assert.equal(epostaJeVViru("ni-eposte", VIR), false);
    assert.equal(stevilkeSoVViru("8.00-16.00", VIR), true);
    assert.equal(stevilkeSoVViru("7.00-18.00", VIR), false);
  });
});

function predlog(p: Partial<Predlog["podjetje"]>, vrstice: Predlog["vrstice"] = []): Predlog {
  return {
    gostitelj: "les.example",
    strani: 1,
    prazno: false,
    sporocilo: "",
    podjetje: { id: "podjetje", izbrano: true, ime: "", opis: "", material: "", ure: "", stik: "", ...p },
    vrstice,
  };
}

describe("Mercury C: preveriCitate", () => {
  it("izmisljena polja padejo, dobesedna ostanejo", () => {
    const r = preveriCitate(
      predlog(
        { ime: "Mizarstvo Les", stik: "01 555 09 00\n01 555 77 77\nprodaja@les.example\nObrtna ulica 9, Ljubljana\nTrubarjeva 3", ure: "pon-pet 7.00-18.00", opis: "Delavnica." },
        [
          { id: "a", izbrano: true, vrsta: "izdelek", ime: "Mize", opis: "x", material: "hrast" },
          { id: "b", izbrano: true, vrsta: "izdelek", ime: "Zofe", opis: "x", material: "" },
        ],
      ),
      VIR,
    );
    assert.equal(r.predlog.podjetje.ime, "Mizarstvo Les");
    assert.equal(r.predlog.podjetje.stik, "01 555 09 00\nObrtna ulica 9, Ljubljana");
    assert.equal(r.predlog.podjetje.ure, "");
    assert.deepEqual(r.predlog.vrstice.map((v) => v.ime), ["Mize"]);
    assert.deepEqual([...new Set(r.zavrnjeno)].sort(), ["izdelek", "stik", "ure"]);
  });
  it("izmisljeno ime podjetja ne ostane", () => {
    const r = preveriCitate(predlog({ ime: "Alpski les Kovač" }), VIR);
    assert.equal(r.predlog.podjetje.ime, "");
    assert.deepEqual(r.zavrnjeno, ["ime"]);
  });
});

const temps: string[] = [];
let originalFetch: typeof globalThis.fetch | null = null;

afterEach(async () => {
  if (originalFetch) globalThis.fetch = originalFetch;
  originalFetch = null;
  await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const katalog: Catalog = {
  company: { name: "Stara", trade: "Mizarstvo", phone: "", address: "", hours: "", about: "" },
  materials: [],
  products: [],
};

const STRAN =
  "<html><head><title>Mizarstvo Les</title></head><body><h1>Mizarstvo Les</h1>" +
  "<p>Telefon 01 555 09 00. Obrtna ulica 9, Ljubljana. Odprto pon-pet 8.00-16.00.</p><h2>Izdelki</h2><h3>Miza Qzx</h3></body></html>";

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

describe("Mercury C: stran in model", () => {
  it("model izmisli ime, ure in izdelek: ne zapise se kot dejstvo; dobesedno ostane; dnevnik ima samo stevilo", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lina-mercury-c-"));
    temps.push(dir);
    const token = await setupOwner("geslo-test-1234", dir);
    await publishLine({ open: true, brezGlasu: true, catalog: katalog }, { token }, dir);
    await saveBrain({ provider: "grok", model: "grok-2", key: "kljuc-lastnika-12345678" }, token, dir);
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      const vsebina = JSON.stringify({
        podjetje: { ime: "Mizarstvo Kovac", opis: "Delavnica miz.", material: "", ure: "pon-pet 7.00-18.00", stik: "" },
        vrstice: [
          { vrsta: "izdelek", ime: "Miza Qzx", opis: "Miza.", material: "" },
          { vrsta: "izdelek", ime: "Skrinja Zzz", opis: "Skrinja.", material: "" },
        ],
      });
      return new Response(JSON.stringify({ choices: [{ message: { content: vsebina } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const p = await preberiStranPodjetja("https://les.example/", token, dir, {
      razresi: async () => ["93.184.216.34"],
      povezava: async (z) => (z.pot === "/robots.txt" ? odgovor(404, {}, "") : odgovor(200, { "content-type": "text/html" }, STRAN)),
    });
    assert.equal(p.podjetje.ime, "Mizarstvo Les");
    assert.equal(p.podjetje.ure.includes("18.00"), false);
    assert.deepEqual(p.vrstice.map((v) => v.ime), ["Miza Qzx"]);
    const dnevnik = await readFile(path.join(dir, "splet-dnevnik.json"), "utf8");
    assert.match(dnevnik, /"zavrnjenaPolja":\s*[2-9]/);
    assert.equal(dnevnik.includes("Zzz"), false);
    assert.equal(dnevnik.includes("Kovac"), false);
  });
});
