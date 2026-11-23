/**
 * Preizkusi motivacija.server.ts (dnevna motivacija): ena misel na del dneva, samo lastnik, nastavitve, varnost odgovora,
 * hkratni klici, omejitev zgodovine, pokvarjena datoteka, pot do lastnega streznika (laznj fetch, brez omrezja).
 * Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { shraniLastniStreznik } from "./keys.server.ts";
import { VNAPREJ, VNAPREJ_VECER, izberiVnaprej, type Navodilo } from "./motivacija.ts";
import { DATOTEKA_MOTIVACIJE, dnevnaMotivacija, nastaviMotivacijo, preberiMotivacijo } from "./motivacija.server.ts";

process.env.LINA_LLM = "0";
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-motivacija-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const praviFetch = globalThis.fetch;
const staroOkolje = process.env.LINA_DATA;
let klicovFetch = 0;

beforeEach(() => {
  klicovFetch = 0;
  globalThis.fetch = (async () => {
    klicovFetch += 1;
    throw new Error("omrezje v preizkusu ni dovoljeno");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = praviFetch;
  if (staroOkolje === undefined) delete process.env.LINA_DATA;
  else process.env.LINA_DATA = staroOkolje;
});

async function nova(): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  process.env.LINA_DATA = dir;
  return { dir, token: await setupOwner("geslo-test-1234", dir) };
}

const LJ = "Europe/Ljubljana";
const JUTRO = new Date(Date.UTC(2026, 10, 21, 8)); // sobota 09:00 po ljubljanski uri
const VECER = new Date(Date.UTC(2026, 10, 21, 17)); // sobota 18:00
const MOZN = (zdaj: Date, generiraj?: (n: Navodilo) => Promise<string | null>) => ({ zdaj, pas: LJ, generiraj });
const datoteka = (dir: string) => path.join(dir, DATOTEKA_MOTIVACIJE);
const shramba = (dir: string) => JSON.parse(readFileSync(datoteka(dir), "utf8")) as Record<string, unknown> & { zgodovina: Array<Record<string, unknown>> };

const A = "Majhen korak danes naredi večjo razliko, kot si misliš.";
const B = "Vsak dan ima prostor za droben napredek, ki ga opaziš zvečer.";
const C = "Počasen začetek je še vedno začetek, zato ga naredi danes.";

function izvor(odgovori: Array<string | null | Error>): { gen: (n: Navodilo) => Promise<string | null>; navodila: Navodilo[] } {
  const navodila: Navodilo[] = [];
  return {
    navodila,
    gen: async (n) => {
      navodila.push(n);
      const o = odgovori.shift() ?? null;
      if (o instanceof Error) throw o;
      return o;
    },
  };
}

describe("dnevna motivacija: dostop", () => {
  it("brez prijave ali z napacnim zetonom zavrne vse tri klice", async () => {
    const { dir } = await nova();
    for (const zeton of [null, "napacen"]) {
      await assert.rejects(dnevnaMotivacija(zeton, dir, MOZN(JUTRO)));
      await assert.rejects(preberiMotivacijo(zeton, dir, MOZN(JUTRO)));
      await assert.rejects(nastaviMotivacijo({ humor: "vec" }, zeton, dir));
    }
    assert.equal(existsSync(datoteka(dir)), false);
  });
});

describe("dnevna motivacija: ustvarjanje", () => {
  it("jutro: model je poklican enkrat, misel je shranjena s temo dneva in casom", async () => {
    const { dir, token } = await nova();
    const { gen, navodila } = izvor([A]);
    const p = await dnevnaMotivacija(token, dir, MOZN(JUTRO, gen));
    assert.deepEqual(p.jutro, { dan: "2026-11-21", del: "jutro", tema: "produktivnost", besedilo: A, vir: "model", ustvarjeno: JUTRO.toISOString() });
    assert.equal(p.vecer, null);
    assert.deepEqual(p.prejsnje, []);
    assert.deepEqual(p.nastavitve, { vklopljena: true, vecer: true, slog: "citat", humor: "malo" });
    assert.equal(navodila.length, 1);
    assert.ok(navodila[0].system.includes("jutranjo"));
    assert.equal(navodila[0].text, "Dan v tednu: sobota.\nNapiši novo misel.");
    assert.equal(shramba(dir).zgodovina.length, 1);
  });

  it("isti del dneva: druga zahteva vrne isto misel brez klica modela", async () => {
    const { dir, token } = await nova();
    const { gen, navodila } = izvor([A, B]);
    const prvi = await dnevnaMotivacija(token, dir, MOZN(JUTRO, gen));
    const drugi = await dnevnaMotivacija(token, dir, MOZN(new Date(JUTRO.getTime() + 3_600_000), gen));
    assert.equal(navodila.length, 1);
    assert.deepEqual(drugi, prvi);
  });

  it("vecer (po 17. uri): vecerna misel z zakljuckom, jutranja ostane", async () => {
    const { dir, token } = await nova();
    const { gen, navodila } = izvor([A, B]);
    await dnevnaMotivacija(token, dir, MOZN(JUTRO, gen));
    const p = await dnevnaMotivacija(token, dir, MOZN(VECER, gen));
    assert.equal(p.jutro?.besedilo, A);
    assert.deepEqual(p.vecer, { dan: "2026-11-21", del: "vecer", tema: "zaključek", besedilo: B, vir: "model", ustvarjeno: VECER.toISOString() });
    assert.ok(navodila[1].system.includes("večerno"));
    assert.ok(navodila[1].text.includes(A), "jutranja misel je med tistimi, ki se ne smejo ponoviti");
  });

  it("prvi odprtje sele zvecer: nastane samo vecerna, jutranje ni (zgresena se ne nadomesti)", async () => {
    const { dir, token } = await nova();
    const { gen, navodila } = izvor([B]);
    const p = await dnevnaMotivacija(token, dir, MOZN(VECER, gen));
    assert.equal(p.jutro, null);
    assert.equal(p.vecer?.besedilo, B);
    assert.equal(navodila.length, 1);
  });

  it("naslednji dan: vcerajsnji dve misli so med prejsnjimi (vecer pred jutrom), nova misel ni ponovitev", async () => {
    const { dir, token } = await nova();
    const { gen, navodila } = izvor([A, B, C]);
    await dnevnaMotivacija(token, dir, MOZN(JUTRO, gen));
    await dnevnaMotivacija(token, dir, MOZN(VECER, gen));
    const naslednji = new Date(JUTRO.getTime() + 24 * 3_600_000);
    const p = await dnevnaMotivacija(token, dir, MOZN(naslednji, gen));
    assert.equal(p.jutro?.dan, "2026-11-22");
    assert.equal(p.jutro?.tema, "mir in ravnovesje");
    assert.deepEqual(
      p.prejsnje.map((m) => [m.dan, m.del, m.besedilo]),
      [
        ["2026-11-21", "vecer", B],
        ["2026-11-21", "jutro", A],
      ],
    );
    assert.ok(navodila[2].text.startsWith("Dan v tednu: nedelja.\nTeh misli ne ponovi:\n"));
    assert.ok(navodila[2].text.includes(A) && navodila[2].text.includes(B));
  });
});

describe("dnevna motivacija: nevaren ali manjkajoc odgovor modela", () => {
  it("model vrne null: vnaprej pripravljena misel za ta dan", async () => {
    const { dir, token } = await nova();
    const p = await dnevnaMotivacija(token, dir, MOZN(JUTRO, izvor([null]).gen));
    assert.equal(p.jutro?.vir, "vnaprej");
    assert.equal(p.jutro?.besedilo, izberiVnaprej("2026-11-21"));
  });

  it("vecer brez modela: vecerna vnaprej pripravljena misel", async () => {
    const { dir, token } = await nova();
    const p = await dnevnaMotivacija(token, dir, MOZN(VECER, izvor([null]).gen));
    assert.equal(p.vecer?.vir, "vnaprej");
    assert.equal(p.vecer?.besedilo, izberiVnaprej("2026-11-21", [], "vecer"));
    assert.ok(VNAPREJ_VECER.includes(p.vecer!.besedilo));
    assert.equal(VNAPREJ.includes(p.vecer!.besedilo), false);
  });

  it("model vrze napako: vnaprej pripravljena misel, klic ne odpove", async () => {
    const { dir, token } = await nova();
    const p = await dnevnaMotivacija(token, dir, MOZN(JUTRO, izvor([new Error("padec")]).gen));
    assert.equal(p.jutro?.vir, "vnaprej");
  });

  it("povezava, skrivnost, obljuba in ponovitev v odgovoru: vnaprej pripravljena misel", async () => {
    for (const slab of ["Obišči https://primer.si in naredi majhen korak.", "Tvoje geslo je abc123xyz, uporabi ga vsak dan.", "Garantiram, da te majhen korak pripelje do cilja."]) {
      const { dir, token } = await nova();
      const p = await dnevnaMotivacija(token, dir, MOZN(JUTRO, izvor([slab]).gen));
      assert.equal(p.jutro?.vir, "vnaprej", slab);
      assert.equal(VNAPREJ.includes(p.jutro!.besedilo), true);
    }
    const { dir, token } = await nova();
    const { gen } = izvor([A, A]);
    await dnevnaMotivacija(token, dir, MOZN(JUTRO, gen));
    const p = await dnevnaMotivacija(token, dir, MOZN(VECER, gen));
    assert.equal(p.vecer?.vir, "vnaprej", "vecerna ponovitev jutranje misli je zavrnjena");
  });

  it("vnaprej pripravljena jutranja misel preskoci tisto iz zgodovine", async () => {
    const { dir, token } = await nova();
    const osnovna = izberiVnaprej("2026-11-21");
    writeFileSync(
      datoteka(dir),
      JSON.stringify({ zgodovina: [{ dan: "2026-11-20", del: "jutro", tema: "vztrajnost", besedilo: osnovna, vir: "vnaprej", ustvarjeno: "2026-11-20T08:00:00.000Z" }] }),
    );
    const p = await dnevnaMotivacija(token, dir, MOZN(JUTRO, izvor([null]).gen));
    assert.notEqual(p.jutro?.besedilo, osnovna);
  });
});

describe("dnevna motivacija: nastavitve", () => {
  it("izklopljena: modela ne pokliče in nic ne ustvari; ponovni vklop ustvari", async () => {
    const { dir, token } = await nova();
    const { gen, navodila } = izvor([A]);
    const izklop = await nastaviMotivacijo({ vklopljena: false }, token, dir, MOZN(JUTRO));
    assert.equal(izklop.nastavitve.vklopljena, false);
    const p = await dnevnaMotivacija(token, dir, MOZN(JUTRO, gen));
    assert.equal(p.jutro, null);
    assert.equal(navodila.length, 0);
    await nastaviMotivacijo({ vklopljena: true }, token, dir, MOZN(JUTRO));
    const znova = await dnevnaMotivacija(token, dir, MOZN(JUTRO, gen));
    assert.equal(znova.jutro?.besedilo, A);
  });

  it("vecer izklopljen: vecerne misli ni in model ni poklican; jutro dela naprej", async () => {
    const { dir, token } = await nova();
    const { gen, navodila } = izvor([A, B]);
    await nastaviMotivacijo({ vecer: false }, token, dir, MOZN(JUTRO));
    const jutro = await dnevnaMotivacija(token, dir, MOZN(JUTRO, gen));
    assert.equal(jutro.jutro?.besedilo, A);
    const vecer = await dnevnaMotivacija(token, dir, MOZN(VECER, gen));
    assert.equal(vecer.vecer, null);
    assert.equal(navodila.length, 1);
  });

  it("vecer izklopljen skrije ze shranjeno vecerno misel", async () => {
    const { dir, token } = await nova();
    await dnevnaMotivacija(token, dir, MOZN(VECER, izvor([B]).gen));
    const p = await nastaviMotivacijo({ vecer: false }, token, dir, MOZN(VECER));
    assert.equal(p.vecer, null);
  });

  it("humor in slog se shranita in vplivata na navodilo", async () => {
    const { dir, token } = await nova();
    const p = await nastaviMotivacijo({ humor: "vec", slog: "oboje" }, token, dir, MOZN(JUTRO));
    assert.deepEqual(p.nastavitve, { vklopljena: true, vecer: true, slog: "oboje", humor: "vec" });
    const { gen, navodila } = izvor([A]);
    await dnevnaMotivacija(token, dir, MOZN(JUTRO, gen));
    assert.ok(navodila[0].system.includes("igriva"));
    const f = shramba(dir);
    assert.equal(f.humor, "vec");
    assert.equal(f.slog, "oboje");
    assert.equal(f.vklopljena, true);
    assert.equal(f.vecer, true);
  });

  it("neveljaven popravek vrze in datoteke ne spremeni", async () => {
    const { dir, token } = await nova();
    await nastaviMotivacijo({ humor: "brez" }, token, dir, MOZN(JUTRO));
    const prej = readFileSync(datoteka(dir), "utf8");
    for (const p of ["da", {}, [], null, { humor: "zelo" }, { neznano: 1 }, { slog: "x" }]) {
      await assert.rejects(nastaviMotivacijo(p, token, dir, MOZN(JUTRO)), /Neveljavna nastavitev/);
    }
    assert.equal(readFileSync(datoteka(dir), "utf8"), prej);
  });

  it("preberiMotivacijo ne ustvari ničesar", async () => {
    const { dir, token } = await nova();
    const p = await preberiMotivacijo(token, dir, MOZN(JUTRO));
    assert.equal(p.jutro, null);
    assert.equal(existsSync(datoteka(dir)), false);
  });
});

describe("dnevna motivacija: osebni slog (zapiski o lastniku)", () => {
  async function z(slog: string): Promise<{ dir: string; token: string }> {
    const n = await nova();
    await nastaviMotivacijo({ slog }, n.token, n.dir, MOZN(JUTRO));
    return n;
  }

  it("citat: zapiski se ne preberejo in ne gredo v navodilo", async () => {
    const { dir, token } = await z("citat");
    let klicov = 0;
    const { gen, navodila } = izvor([A]);
    await dnevnaMotivacija(token, dir, { ...MOZN(JUTRO, gen), zapiski: async () => ((klicov += 1), "Delam na projektu Safeer.") });
    assert.equal(klicov, 0);
    assert.equal(navodila[0].text.includes("Zapiski"), false);
  });

  it("osebno: zapiski gredo v navodilo", async () => {
    const { dir, token } = await z("osebno");
    const { gen, navodila } = izvor([A]);
    await dnevnaMotivacija(token, dir, { ...MOZN(JUTRO, gen), zapiski: async () => "Delam na projektu Safeer." });
    assert.ok(navodila[0].text.includes("Zapiski o uporabniku: Delam na projektu Safeer."));
    assert.ok(navodila[0].system.includes("samo za navdih"));
  });

  it("oboje: sobota (sodo) zjutraj brez zapiskov, zvecer z njimi", async () => {
    const { dir, token } = await z("oboje");
    const { gen, navodila } = izvor([A, B]);
    const zapiski = async () => "Rad imam hribe.";
    await dnevnaMotivacija(token, dir, { ...MOZN(JUTRO, gen), zapiski });
    await dnevnaMotivacija(token, dir, { ...MOZN(VECER, gen), zapiski });
    assert.equal(navodila[0].text.includes("Rad imam hribe."), false);
    assert.ok(navodila[1].text.includes("Rad imam hribe."));
  });

  it("zapiski vrzejo napako ali vsebujejo skrivnost: misel se vseeno ustvari brez njih", async () => {
    const { dir, token } = await z("osebno");
    const { gen, navodila } = izvor([A]);
    await dnevnaMotivacija(token, dir, { ...MOZN(JUTRO, gen), zapiski: async () => { throw new Error("spomin pokvarjen"); } });
    assert.equal(navodila.length, 1);
    assert.equal(navodila[0].text.includes("Zapiski"), false);
    const n2 = await z("osebno");
    const g2 = izvor([A]);
    await dnevnaMotivacija(n2.token, n2.dir, { ...MOZN(JUTRO, g2.gen), zapiski: async () => "Moje geslo je abc123xyz" });
    assert.equal(g2.navodila[0].text.includes("abc123xyz"), false);
  });
});

describe("dnevna motivacija: hkratnost, zgodovina, datoteka", () => {
  it("pet hkratnih zahtev za isti del dneva: model enkrat, en vnos", async () => {
    const { dir, token } = await nova();
    let klicov = 0;
    const gen = async () => {
      klicov += 1;
      await new Promise((r) => setTimeout(r, 25));
      return A;
    };
    const izidi = await Promise.all(Array.from({ length: 5 }, () => dnevnaMotivacija(token, dir, MOZN(JUTRO, gen))));
    assert.equal(klicov, 1);
    for (const i of izidi) assert.equal(i.jutro?.besedilo, A);
    assert.equal(shramba(dir).zgodovina.length, 1);
  });

  it("zgodovina je omejena na 60 vnosov (30 dni po dve)", async () => {
    const { dir, token } = await nova();
    for (let i = 0; i < 31; i++) {
      const dan = Date.UTC(2026, 9, 1 + i);
      await dnevnaMotivacija(token, dir, MOZN(new Date(dan + 8 * 3_600_000), async () => `Majhen korak naredi razliko, dan ${i} je tvoj.`));
      await dnevnaMotivacija(token, dir, MOZN(new Date(dan + 17 * 3_600_000), async () => `Večer ${i} je čas za mir in zadovoljstvo.`));
    }
    const f = shramba(dir);
    assert.equal(f.zgodovina.length, 60);
    assert.equal(f.zgodovina[0].dan, "2026-10-31");
    assert.equal(f.zgodovina[0].del, "vecer");
    assert.equal(f.zgodovina[59].dan, "2026-10-02");
  });

  it("pokvarjena datoteka (ni JSON) velja za prazno in se nadomesti", async () => {
    const { dir, token } = await nova();
    writeFileSync(datoteka(dir), "to ni json");
    const p = await dnevnaMotivacija(token, dir, MOZN(JUTRO, izvor([A]).gen));
    assert.equal(p.jutro?.besedilo, A);
    assert.equal(shramba(dir).zgodovina.length, 1);
  });

  it("nepravilni vnosi se odstranijo, podvojen (dan, del) ostane prvi, nastavitve imajo privzete vrednosti", async () => {
    const { dir, token } = await nova();
    const v = { dan: "2026-11-20", del: "jutro", tema: "vztrajnost", besedilo: "Včerajšnja misel o vztrajnosti je lahko tudi tvoja.", vir: "vnaprej", ustvarjeno: "2026-11-20T08:00:00.000Z" };
    const ve = { ...v, del: "vecer", tema: "zaključek", besedilo: "Včerajšnji večer je bil miren." };
    writeFileSync(
      datoteka(dir),
      JSON.stringify({
        vklopljena: true,
        vecer: true,
        slog: "x",
        humor: 5,
        zgodovina: [
          { ...v, dan: "2026-02-30" },
          { ...v, besedilo: "x".repeat(281) },
          { ...v, besedilo: "" },
          { ...v, vir: "x" },
          { ...v, tema: "x" },
          { ...v, del: "noč" },
          5,
          null,
          "niz",
          v,
          { ...v, besedilo: "Drugi vnos za isti dan in del." },
          ve,
        ],
      }),
    );
    const p = await preberiMotivacijo(token, dir, MOZN(JUTRO));
    assert.deepEqual(p.nastavitve, { vklopljena: true, vecer: true, slog: "citat", humor: "malo" });
    assert.equal(p.jutro, null);
    assert.deepEqual(
      p.prejsnje.map((m) => m.besedilo),
      [ve.besedilo, v.besedilo],
    );
  });

  it("vrstni red prejsnjih: najnovejsi dan prvi, v dnevu vecer pred jutrom", async () => {
    const { dir, token } = await nova();
    const vnos = (dan: string, del: string, besedilo: string) => ({
      dan,
      del,
      tema: del === "vecer" ? "zaključek" : "vztrajnost",
      besedilo,
      vir: "vnaprej",
      ustvarjeno: `${dan}T08:00:00.000Z`,
    });
    writeFileSync(
      datoteka(dir),
      JSON.stringify({ zgodovina: [vnos("2026-11-18", "jutro", "Misel osemnajstega zjutraj."), vnos("2026-11-19", "jutro", "Misel devetnajstega zjutraj."), vnos("2026-11-19", "vecer", "Misel devetnajstega zvecer."), vnos("2026-11-20", "jutro", "Misel dvajsetega zjutraj.")] }),
    );
    const p = await preberiMotivacijo(token, dir, MOZN(JUTRO));
    assert.deepEqual(
      p.prejsnje.map((m) => m.besedilo),
      ["Misel dvajsetega zjutraj.", "Misel devetnajstega zvecer.", "Misel devetnajstega zjutraj.", "Misel osemnajstega zjutraj."],
    );
  });

  it("v pogledu je najvec 6 prejsnjih", async () => {
    const { dir, token } = await nova();
    const zgodovina = Array.from({ length: 10 }, (_, i) => ({
      dan: `2026-11-${String(10 + i).padStart(2, "0")}`,
      del: "jutro",
      tema: "vztrajnost",
      besedilo: `Misel za dan številka ${i} je tukaj.`,
      vir: "vnaprej",
      ustvarjeno: "2026-11-10T08:00:00.000Z",
    }));
    writeFileSync(datoteka(dir), JSON.stringify({ zgodovina }));
    const p = await preberiMotivacijo(token, dir, MOZN(JUTRO));
    assert.equal(p.prejsnje.length, 6);
    assert.equal(p.prejsnje[0].dan, "2026-11-19");
  });
});

describe("dnevna motivacija: privzeti generator (lasten streznik, brez omrezja)", () => {
  const NASLOV = "http://127.0.0.1:3193/v1";
  const KLJUC = "freellmapi-izmisljen-kljuc-za-preizkus-9012";

  async function sLastnim(): Promise<{ dir: string; token: string }> {
    const n = await nova();
    await shraniLastniStreznik({ naslov: NASLOV, key: KLJUC, model: "auto", uporabiZaPogovor: true }, n.token, n.dir);
    return n;
  }

  it("zahteva gre na lasten naslov, nosi samo dan, temo in ton; odgovor se shrani kot misel modela", async () => {
    const { dir, token } = await sLastnim();
    const klici: Array<{ url: string; telo: string }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      klici.push({ url: String(url), telo: String(init?.body ?? "") });
      return new Response(JSON.stringify({ choices: [{ message: { content: A }, finish_reason: "stop" }] }), { status: 200 });
    }) as typeof fetch;
    const p = await dnevnaMotivacija(token, dir, { zdaj: JUTRO, pas: LJ });
    assert.equal(p.jutro?.vir, "model");
    assert.equal(p.jutro?.besedilo, A);
    assert.deepEqual(
      klici.map((k) => k.url),
      ["http://127.0.0.1:3193/v1/chat/completions"],
    );
    const telo = klici[0].telo;
    assert.ok(telo.includes("Dan v tednu: sobota"));
    assert.ok(telo.includes("Majhni koraki delajo velike razlike"));
    assert.equal(telo.includes("geslo-test-1234"), false, "geslo lastnika ni v zahtevi");
    assert.equal(telo.includes(KLJUC), false, "kljuc ni v telesu zahteve");
  });

  it("streznik vrne napako: vnaprej pripravljena misel", async () => {
    const { dir, token } = await sLastnim();
    globalThis.fetch = (async () => new Response("napaka", { status: 500 })) as typeof fetch;
    const p = await dnevnaMotivacija(token, dir, { zdaj: JUTRO, pas: LJ });
    assert.equal(p.jutro?.vir, "vnaprej");
  });

  it("brez nastavljenega modela: vnaprej pripravljena misel, nobenega pravega omrezja", async () => {
    const { dir, token } = await nova();
    const p = await dnevnaMotivacija(token, dir, { zdaj: JUTRO, pas: LJ });
    assert.equal(p.jutro?.vir, "vnaprej");
    assert.ok(klicovFetch <= 1);
  });
});
