/**
 * Popravki pregleda 029 (prevezava med klicem, RSDO, Dodatki). Vsak preizkus brez popravka pade (mutacije v POROCILO.md).
 * Brez omrezja in brez pravega RSDO; samo izmisljene stevilke. Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, describe, it } from "node:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setupOwner } from "./auth.server.ts";
import { en, sl, t, type Beseda } from "./besedila.ts";
import { poNamestitviSlovenskega, savePravila, uskladiRsdoObPoizvedbi } from "./pravila.server.ts";
import { izklopiRsdo, nastaviOdvisnostiRsdoStreznika, stanjeRsdo, uskladiRsdo, type RazlogRsdo } from "./rsdo-streznik.server.ts";
import { stanjeNamestitveSlovenskega, zazeniNamestitevSlovenskega } from "./slovenski-modul.server.ts";
import { nastaviSintezoZaPreizkus, pocakajGlas, predpripraviOdgovor, pripravljeniKljuci, ustaviCiscenjeZvoka } from "./glas.server.ts";
import { formaCatalog } from "./catalog.ts";
import { defaultPravila } from "./pravila.server.ts";
import { pripraviGlasObZagonu } from "./service.server.ts";
import { writeJson } from "./store.server.ts";

process.env.LINA_LLM = "0";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-popravki-029-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));

describe("16: posnetek, pripravljen med zvonjenjem, se po vrnitvi klica najde", () => {
  it("predpripraviOdgovor (brez posebni) in pripravljeniKljuci (posebni [del], CallSid) dajo iste kljuce", async () => {
    const dir = await mkdtemp(path.join(KOREN, "g-"));
    let sintez = 0;
    nastaviSintezoZaPreizkus(async () => {
      sintez += 1;
      return Buffer.alloc(4800);
    });
    try {
      for (const stavek of [t("nujniNeOglasi"), t("osebnaSporocilo")]) {
        await predpripraviOdgovor(stavek, dir, "CA-KLJUC-1");
        assert.notEqual(await pripravljeniKljuci(stavek, dir, [stavek], "CA-KLJUC-1"), null, stavek);
        // posnetek je res posnetek klica (kljuc s CallSid), ne stalni
        assert.equal(await pripravljeniKljuci(stavek, dir), null, stavek);
        assert.equal(await pripravljeniKljuci(stavek, dir, [stavek], "CA-DRUGI"), null, stavek);
      }
      assert.ok(sintez >= 2);
    } finally {
      nastaviSintezoZaPreizkus(null);
    }
  });

  it("tudi s pripravljenimi stalnimi stavki (podjetje in osebna): iskanje kot v voice.server po vrnitvi klica najde posnetek", async () => {
    nastaviSintezoZaPreizkus(async () => Buffer.alloc(4800));
    try {
      for (const nacin of ["podjetje", "osebna"] as const) {
        const dir = await mkdtemp(path.join(KOREN, `s-${nacin}-`));
        await writeJson(dir, "line.json", { open: true, catalog: formaCatalog(), updatedAt: null });
        await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi", nacinKlica: nacin, imeLastnika: "Ana" });
        await pripraviGlasObZagonu(dir);
        await pocakajGlas(dir);
        const sid = `CA-KLJUC-${nacin}`;
        for (const stavek of [t("nujniNeOglasi"), t("osebnaSporocilo")]) {
          await predpripraviOdgovor(stavek, dir, sid);
          const najden = (await pripravljeniKljuci(stavek, dir)) ?? (await pripravljeniKljuci(stavek, dir, [stavek], sid));
          assert.notEqual(najden, null, `${nacin}: ${stavek}`);
        }
        ustaviCiscenjeZvoka(dir);
      }
    } finally {
      nastaviSintezoZaPreizkus(null);
    }
  });
});

// Lazni RSDO (posnema protokol scripts/rsdo-streznik.py): takoj pripravljen; pravega modela ni.
const LAZNI = path.join(KOREN, "lazni-rsdo.mjs");
writeFileSync(LAZNI, 'process.stdout.write(JSON.stringify({ pripravljen: true }) + "\\n"); process.stdin.on("data", () => {}); process.stdin.on("end", () => process.exit(0));');
const lazniUkaz = async () => ({ program: process.execPath, args: [LAZNI] });

async function pocakaj(pogoj: () => boolean, ms = 3000): Promise<void> {
  const konec = Date.now() + ms;
  while (!pogoj()) {
    if (Date.now() > konec) throw new Error(`pogoj ni izpolnjen (stanje ${JSON.stringify(stanjeRsdo())})`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Mapa z vklopljenim stikalom »slovenski«; RSDO po shranjevanju spet izklopljen (stanje kot po zagonu brez nalozenega modela). */
async function slovenskiVklopljen(): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "r-"));
  const token = await setupOwner("geslo-test-1234", dir);
  nastaviOdvisnostiRsdoStreznika({ ukaz: async () => ({ napaka: "ni-namescen" }) });
  await savePravila({ dodatki: { paperclip: false, n8n: false, affine: false, programi: false, slovenski: true } }, token, dir);
  await new Promise((r) => setTimeout(r, 30));
  izklopiRsdo();
  return { dir, token };
}

describe("11: poizvedba Dodatkov zazene RSDO samo za prijavljenega lastnika", { concurrency: 1 }, () => {
  afterEach(() => {
    izklopiRsdo();
    nastaviOdvisnostiRsdoStreznika(null);
  });
  it("brez veljavne seje ni zagona procesa; z njo je", async () => {
    const { dir, token } = await slovenskiVklopljen();
    nastaviOdvisnostiRsdoStreznika({ ukaz: lazniUkaz });
    await uskladiRsdoObPoizvedbi(null, dir);
    await uskladiRsdoObPoizvedbi("ponarejen-zeton", dir);
    assert.equal(stanjeRsdo().stanje, "izklopljen");
    await uskladiRsdoObPoizvedbi(token, dir);
    await pocakaj(() => stanjeRsdo().stanje === "pripravljen");
  });
});

describe("13: po koncani namestitvi se model nalozi takoj (brez minutnega premora)", { concurrency: 1 }, () => {
  afterEach(() => {
    izklopiRsdo();
    nastaviOdvisnostiRsdoStreznika(null);
  });
  it("ni-namescen tik pred koncem namestitve: uspeh nalozi model; neuspeh in izklopljeno stikalo ne", async () => {
    const { dir, token } = await slovenskiVklopljen();
    nastaviOdvisnostiRsdoStreznika({ ukaz: async () => ({ napaka: "ni-namescen" }) });
    await uskladiRsdo(true);
    assert.deepEqual([stanjeRsdo().stanje, stanjeRsdo().razlog], ["napaka", "ni-namescen"]);
    nastaviOdvisnostiRsdoStreznika({ ukaz: lazniUkaz });
    await poNamestitviSlovenskega(false, dir);
    assert.equal(stanjeRsdo().stanje, "napaka", "neuspela namestitev ne zaganja");
    await poNamestitviSlovenskega(true, dir);
    await pocakaj(() => stanjeRsdo().stanje === "pripravljen");
    // stikalo vmes izklopljeno: konec namestitve modela ne nalozi
    await savePravila({ dodatki: { paperclip: false, n8n: false, affine: false, programi: false, slovenski: false } }, token, dir);
    await pocakaj(() => stanjeRsdo().stanje === "izklopljen");
    await poNamestitviSlovenskega(true, dir);
    assert.equal(stanjeRsdo().stanje, "izklopljen");
  });

  it("zazeniNamestitevSlovenskega javi izid (uspeh in napaka) in ga hrani za Dodatke (najdba 12)", async () => {
    for (const [koda, uspeh, stanje] of [[0, true, "uspela"], [3, false, "napaka"]] as const) {
      const dom = await mkdtemp(path.join(KOREN, "dom-"));
      mkdirSync(path.join(dom, ".local", "bin"), { recursive: true });
      const cli = path.join(dom, ".local", "bin", "cli-anything-linuxmint");
      writeFileSync(cli, `#!/bin/sh\nexit ${koda}\n`);
      chmodSync(cli, 0o755);
      // proces namestitve je unref (Lina ga ne caka): casovnik drzi zanko dogodkov zivo do izida
      const drzi = setInterval(() => undefined, 20);
      const izid = await new Promise<boolean>((resolve) => zazeniNamestitevSlovenskega(dom, resolve)).finally(() => clearInterval(drzi));
      assert.equal(izid, uspeh);
      assert.equal(stanjeNamestitveSlovenskega(), stanje);
    }
  });
});

describe("17: besedila stanja slovenskega pomocnika so v besedila.ts (sl in en)", () => {
  it("lina-desk.tsx nima trdih slovenskih nizov stanja; vsak razlog ima kljuc v sl in en", () => {
    const vir = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "components", "lina-desk.tsx"), "utf8");
    for (const niz of ["naložen v pomnilniku", "nalaga se v pomnilnik", "modul še ni nameščen", "izklopite in znova vklopite"]) {
      assert.ok(!vir.includes(niz), niz);
    }
    const blok = /const RAZLOG_SLOVENSKI[^{]*\{([^}]*)\}/.exec(vir)?.[1] ?? "";
    const pari = [...blok.matchAll(/"([a-z-]+)":\s*"(\w+)"/g)].map((m) => [m[1], m[2]] as const);
    const razlogi: Array<RazlogRsdo | "namestitev-ni-uspela"> = ["ni-namescen", "zagon-ni-uspel", "nalaganje-predolgo", "proces-pada", "proces-visi", "prevelik-izhod", "namestitev-ni-uspela"];
    assert.deepEqual(pari.map(([r]) => r).sort(), [...razlogi].sort());
    for (const [, kljuc] of pari) {
      assert.ok(sl[kljuc as Beseda] && en[kljuc as Beseda], kljuc);
      assert.notEqual(en[kljuc as Beseda], sl[kljuc as Beseda], kljuc);
    }
  });
});

after(() => izklopiRsdo());

describe("1: namig stikala »Preveži klic na zahtevo« pove strosek (sl in en)", () => {
  it("klic gre prek Twilia na racun lastnika; omejitev je navedena", () => {
    assert.match(t("prevezaNaZahtevoNamig"), /prek Twilia.*obračuna na vašem računu/);
    assert.match(t("prevezaNaZahtevoNamig"), /omejeno na uro in na dan/);
    assert.match(t("prevezaNaZahtevoNamig", "en"), /through Twilio.*billed to your Twilio account/);
    assert.match(t("prevezaNaZahtevoNamig", "en"), /limited per hour and per day/);
  });
});

describe("naloga 3: besedila (CodeRabbit 029b, 1; pregled 029b, 9)", () => {
  const OBNOVA: Beseda[] = ["uiSlovenskiNamestitevNiUspela", "uiSlovenskiNalaganjePredolgo", "uiSlovenskiProcesPada", "uiSlovenskiProcesVisi", "uiSlovenskiPrevelikIzhod"];
  it("CodeRabbit 1: navodila za obnovo povedo oba koraka shranjevanja (sl in en)", () => {
    for (const k of OBNOVA) {
      assert.match(sl[k], /izklopite stikalo, shranite, nato ga vklopite in znova shranite/, k);
      assert.match(en[k], /turn the switch off, save, then turn it on and save again/, k);
      assert.doesNotMatch(sl[k], /izklopite in znova vklopite/, k);
      assert.doesNotMatch(en[k], /off and on again/, k);
    }
  });
  it("pregled 9: namig ne obljublja meje, ki za nujno prevezavo ne drzi (sl in en)", () => {
    assert.doesNotMatch(t("prevezaNaZahtevoNamig"), /\(največ 2 prevezavi na uro za istega klicatelja in 6 na dan\)/);
    assert.match(t("prevezaNaZahtevoNamig"), /nikoli več od vaše dnevne meje nujnih klicev; nujni klic: po nastavitvi nujnih klicev/);
    assert.doesNotMatch(t("prevezaNaZahtevoNamig", "en"), /\(at most 2 transfers per hour for the same caller and 6 per day\)/);
    assert.match(t("prevezaNaZahtevoNamig", "en"), /never more than your daily limit for urgent calls; urgent call: according to the urgent call settings/);
  });
});
