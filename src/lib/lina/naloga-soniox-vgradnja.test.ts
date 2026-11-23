/**
 * Preizkusi vgradnje izbirnega dodatka Soniox v streznisko klicno pot (naloga-soniox-vgradnja).
 * Brez omrezja, z lazno sejo in lazno vticnico. Vsi podatki so izmisljeni.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { LinaAuthError, setupOwner } from "./auth.server.ts";
import { en, sl, t } from "./besedila.ts";
import { formaCatalog } from "./catalog.ts";
import { LiveMost, ROK_ZAKLJUCKA_SONIOX_MS, type LiveSeja, type LiveSporocilo, type NastavitveMosta, type OdvisnostiMosta, type SonioxMostSeja, type TwilioVrata, type ZapisnikLive } from "./live/most.ts";
import { sonioxZaKoren, zapisnikIzKnjige } from "./live/vstop.server.ts";
import { defaultPravila, loadPravila, normalizePravila, savePravila } from "./pravila.server.ts";
import { MEJA_DOBESEDNO } from "./sinhron-telefon.server.ts";
import type { SonioxVticnica } from "./soniox-seja.server.ts";
import { pozabiSonioxKljuc, preberiSonioxKljuc, shraniSonioxKljuc, stanjeSoniox } from "./soniox-kljuc.server.ts";
import type { CallSession } from "./types.ts";
import { vsebinaZapiska } from "./zapiski.ts";

process.env.LINA_LLM = "0";
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-soniox-vgradnja-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));

const SKRIVNI_KLJUC = "sx-tajni-kljuc-9876543210-ne-sme-ven";
const POZDRAV = "Dober dan, tukaj Lina, pomočnica z umetno inteligenco.";

async function novaMapa(): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  const token = await setupOwner("geslo-soniox-1234", dir);
  return { dir, token };
}

class LaznaVticnica implements SonioxVticnica {
  readyState = 0;
  readonly url: string;
  readonly protokoli: string[];
  readonly poslano: Array<string | Uint8Array> = [];
  zaprto = false;

  private readonly openPoslusalci: Array<() => void> = [];
  private readonly messagePoslusalci: Array<(dogodek: { data: unknown }) => void> = [];
  private readonly errorPoslusalci: Array<(dogodek: unknown) => void> = [];
  private readonly closePoslusalci: Array<(dogodek: { code?: number; reason?: string }) => void> = [];

  constructor(url: string, protokoli: string[]) {
    this.url = url;
    this.protokoli = [...protokoli];
  }

  send(podatki: string | Uint8Array): void {
    this.poslano.push(podatki instanceof Uint8Array ? podatki.slice() : podatki);
  }

  close(): void {
    if (this.zaprto) return;
    this.zaprto = true;
    this.readyState = 3;
  }

  addEventListener(tip: "open", poslusalec: () => void): void;
  addEventListener(tip: "message", poslusalec: (dogodek: { data: unknown }) => void): void;
  addEventListener(tip: "error", poslusalec: (dogodek: unknown) => void): void;
  addEventListener(tip: "close", poslusalec: (dogodek: { code?: number; reason?: string }) => void): void;
  addEventListener(tip: string, poslusalec: (...args: never[]) => void): void {
    if (tip === "open") this.openPoslusalci.push(poslusalec as () => void);
    else if (tip === "message") this.messagePoslusalci.push(poslusalec as (d: { data: unknown }) => void);
    else if (tip === "error") this.errorPoslusalci.push(poslusalec as (d: unknown) => void);
    else if (tip === "close") this.closePoslusalci.push(poslusalec as (d: { code?: number; reason?: string }) => void);
  }

  odpri(): void {
    this.readyState = 1;
    for (const fn of [...this.openPoslusalci]) fn();
  }

  prejmiJson(objekt: unknown): void {
    const data = JSON.stringify(objekt);
    for (const fn of [...this.messagePoslusalci]) fn({ data });
  }
}

async function cakajDo(pogoj: () => boolean, ms = 2000): Promise<void> {
  const rok = Date.now() + ms;
  while (!pogoj()) {
    if (Date.now() > rok) throw new Error("rok cakanja potekel");
    await new Promise((r) => setTimeout(r, 10));
  }
}

function pcmKos(vrednost: number, bajtov = 320): Uint8Array {
  const kos = new Uint8Array(bajtov);
  kos.fill(vrednost & 0xff);
  return kos;
}

function lazniMostOkolje(moznosti: {
  soniox?: OdvisnostiMosta["soniox"];
  sonioxRokZakljuckaMs?: number;
  zapisnik?: ZapisnikLive;
  ura?: () => number;
  pozdravBajtov?: number;
} = {}) {
  const twilioPoslano: string[] = [];
  let twilioZaprt = false;
  const twilio: TwilioVrata = {
    poslji: (b) => void twilioPoslano.push(b),
    zapri: () => {
      twilioZaprt = true;
    },
  };
  const livePoslano: object[] = [];
  let liveOnSporocilo: ((m: LiveSporocilo) => void) | null = null;
  let liveOdprt = false;
  let liveZaprt = false;
  const liveSeja: LiveSeja = {
    poslji: (m) => void livePoslano.push(m),
    zapri: () => {
      liveZaprt = true;
    },
  };
  const dobesednoKlici: Array<{ callSid: string; besedilo: string }> = [];
  const dnevniki: string[] = [];
  const zakljucenoKlici: string[] = [];
  const zapisnik: ZapisnikLive = moznosti.zapisnik ?? {
    zacni: async () => undefined,
    izrek: async () => undefined,
    odgovor: async () => undefined,
    vrzel: async () => undefined,
    cas: async () => null,
    povprasevanje: async () => ({ sprejeto: [], zavrnjeno: [] }),
    zakljuci: async (sid) => void zakljucenoKlici.push(sid),
    dobesedno: async (callSid, besedilo) => void dobesednoKlici.push({ callSid, besedilo }),
  };
  const nast: NastavitveMosta = {
    setup: { setup: { model: "test" } },
    katalog: formaCatalog(),
    pozdrav: POZDRAV,
    temaOdgovor: t("temaPrivzeto"),
    oprostilo: t("oprostiteSlovo"),
    najdaljsiMinut: null,
  };
  const odv: OdvisnostiMosta = {
    porabiZeton: (z) => (z === "ok-zeton" ? { izid: "ok", from: "+38640000001" } : { izid: "neveljaven", from: "" }),
    nalozi: async () => nast,
    odpriLive: async (p) => {
      liveOdprt = true;
      liveOnSporocilo = p.onSporocilo;
      return liveSeja;
    },
    zapisnik,
    zasedenost: { osvezi: () => undefined, sprosti: () => undefined },
    posnetek: async () => new Uint8Array(moznosti.pozdravBajtov ?? 1600), // 200 ms mu-law @ 8 kHz
    ura: moznosti.ura,
    tikMs: 10,
    dnevnik: (k) => void dnevniki.push(k),
    ...(moznosti.soniox ? { soniox: moznosti.soniox } : {}),
    ...(moznosti.sonioxRokZakljuckaMs !== undefined ? { sonioxRokZakljuckaMs: moznosti.sonioxRokZakljuckaMs } : {}),
  };
  const most = new LiveMost(twilio, odv);
  const zacni = (callSid = "klic-preizkus-0001") => {
    most.naSporocilo(JSON.stringify({ event: "connected" }));
    most.naSporocilo(
      JSON.stringify({
        event: "start",
        start: {
          streamSid: "MZ100000000000000000000000000001",
          callSid,
          mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
          customParameters: { zeton: "ok-zeton" },
        },
      }),
    );
  };
  return {
    most,
    zacni,
    dobesednoKlici,
    dnevniki,
    zakljucenoKlici,
    livePoslano,
    get liveOdprt() {
      return liveOdprt;
    },
    get liveZaprt() {
      return liveZaprt;
    },
    get twilioZaprt() {
      return twilioZaprt;
    },
    emitLive: (m: LiveSporocilo) => liveOnSporocilo?.(m),
  };
}

function vzorecKlica(dodatki: Partial<CallSession> = {}): CallSession {
  return {
    callSid: "klic-preizkus-0002",
    from: "+38640000001",
    startedAt: "2026-11-21T08:00:00.000Z",
    updatedAt: "2026-11-21T08:01:00.000Z",
    status: "zakljucen",
    transcript: [
      { role: "lina", text: POZDRAV, at: "2026-11-21T08:00:00.000Z" },
      { role: "stranka", text: "Pozdravljeni, rad bi naročil mizo.", at: "2026-11-21T08:00:10.000Z" },
    ],
    order: {
      customerName: "Marko Novak",
      phone: "+38640000001",
      productName: "miza",
      materialName: "hrast",
      requestedProduct: "miza",
      requestedMaterial: "hrast",
      quantity: 1,
      notes: "",
      confirmed: true,
      violations: [],
    },
    ...dodatki,
  };
}

afterEach(() => {
  // Brez globalnega stanja; zacasne mape pobrise exit hook.
});

describe("(a) privzeto brez vklopa se odpri ne poklice in noben bajt zvoka ne gre nikamor", () => {
  it("defaultPravila ima sonioxVklop: false in brez vklopa vticnica ni odprta tudi ob shranjenem kljucu", async () => {
    assert.equal(defaultPravila().sonioxVklop, false);
    const { dir, token } = await novaMapa();
    await shraniSonioxKljuc(SKRIVNI_KLJUC, token, dir);

    let odprtijVticnice = 0;
    const soniox = sonioxZaKoren(dir, () => undefined, (url, protokoli) => {
      odprtijVticnice += 1;
      return new LaznaVticnica(url, protokoli);
    });
    const seja = await soniox.odpri("CA-privzeto", () => undefined);
    assert.equal(seja, null);
    assert.equal(odprtijVticnice, 0);

    const ok = lazniMostOkolje({ soniox });
    ok.zacni("CA-privzeto-most");
    await cakajDo(() => ok.liveOdprt);
    ok.most.naPcm16k(pcmKos(11));
    ok.most.naPcm16k(pcmKos(22));
    await ok.most.zakljuci("stop");
    assert.equal(odprtijVticnice, 0, "noben bajt zvoka ne gre nikamor");
    assert.equal(ok.dobesednoKlici.length, 0);
  });

  it("LiveMost brez odvisnosti soniox deluje nespremenjeno", async () => {
    const ok = lazniMostOkolje();
    ok.zacni("CA-brez-odvisnosti");
    await cakajDo(() => ok.liveOdprt);
    ok.most.naPcm16k(pcmKos(5));
    await ok.most.zakljuci("stop");
    assert.equal(ok.dobesednoKlici.length, 0);
    assert.deepEqual(ok.zakljucenoKlici, ["CA-brez-odvisnosti"]);
  });
});

describe("(b) vklop brez kljuca = null; shramba kljuca 0600, preverba in pozabi", () => {
  it("sonioxVklop === true brez kljuca vrne null in ne odpre vticnice", async () => {
    const { dir, token } = await novaMapa();
    await savePravila({ sonioxVklop: true }, token, dir);

    const st = await stanjeSoniox(token, dir);
    assert.deepEqual(st, { vklop: true, kljucShranjen: false });
    assert.equal(await preberiSonioxKljuc(dir), null);

    let odprtijVticnice = 0;
    const soniox = sonioxZaKoren(dir, () => undefined, (url, protokoli) => {
      odprtijVticnice += 1;
      return new LaznaVticnica(url, protokoli);
    });
    const seja = await soniox.odpri("CA-brez-kljuca", () => undefined);
    assert.equal(seja, null);
    assert.equal(odprtijVticnice, 0);
  });

  it("shraniSonioxKljuc zahteva lastnika, preveri obliko, shrani 0600 sifriran; pozabi odstrani samo soniox.json", async () => {
    const { dir, token } = await novaMapa();
    await savePravila({ sonioxVklop: true }, token, dir);

    await assert.rejects(shraniSonioxKljuc(SKRIVNI_KLJUC, null, dir), LinaAuthError);
    await assert.rejects(shraniSonioxKljuc(SKRIVNI_KLJUC, "napacen-zeton", dir), LinaAuthError);
    await assert.rejects(stanjeSoniox(null, dir), LinaAuthError);
    await assert.rejects(pozabiSonioxKljuc(null, dir), LinaAuthError);

    for (const slab of ["", "   ", "1234567", "a".repeat(201), "abc defgh", "abcdefgh\nijkl", "abcdefgh\rijkl"]) {
      await assert.rejects(
        shraniSonioxKljuc(slab, token, dir),
        (err: unknown) => err instanceof Error && err.message === t("sonioxKljucOblika"),
      );
    }

    await shraniSonioxKljuc(`  ${SKRIVNI_KLJUC}  `, token, dir);
    const pot = path.join(dir, "soniox.json");
    if (process.platform !== "win32") {
      assert.equal((await stat(pot)).mode & 0o777, 0o600);
    }
    const vsebina = await readFile(pot, "utf8");
    assert.equal(vsebina.includes(SKRIVNI_KLJUC), false, "kljuc na disku mora biti sifriran");
    assert.equal(await preberiSonioxKljuc(dir), SKRIVNI_KLJUC);
    assert.deepEqual(await stanjeSoniox(token, dir), { vklop: true, kljucShranjen: true });

    // Odstrani samo soniox.json; pravila.json ostane nedotaknjena.
    await pozabiSonioxKljuc(token, dir);
    assert.equal(await preberiSonioxKljuc(dir), null);
    assert.deepEqual(await stanjeSoniox(token, dir), { vklop: true, kljucShranjen: false });
    assert.equal((await loadPravila(dir)).sonioxVklop, true);

    // Poskodovana datoteka ne vrze iz preberiSonioxKljuc.
    await writeFile(pot, "{ni-json", "utf8");
    assert.equal(await preberiSonioxKljuc(dir), null);
  });
});

describe("(c) vklop + kljuc: vsak PCM kos iz naPcm16k gre seji, vrstni red ohranjen", () => {
  it("odpre se ob zacetku klica (ne caka na pozdrav) in vsak kos PCM 16 kHz gre v istem vrstnem redu", async () => {
    let zdaj = 10_000;
    const prejetiKosi: number[] = [];
    let odprtoCallSid = "";
    const fakeSeja: SonioxMostSeja = {
      poslji: (pcm) => void prejetiKosi.push(pcm[0]),
      zakljuci: async () => undefined,
      zapri: () => undefined,
    };
    const ok = lazniMostOkolje({
      ura: () => zdaj,
      pozdravBajtov: 40_000, // 5000 ms pozdrava
      soniox: {
        odpri: (sid) => {
          odprtoCallSid = sid;
          return fakeSeja;
        },
      },
    });

    ok.zacni("CA-vrstni-red");
    await cakajDo(() => ok.liveOdprt);
    assert.equal(odprtoCallSid, "CA-vrstni-red", "Soniox se odpre takoj ob Live, ne caka na konec pozdrava");

    // Kosi pridejo MED pozdravom (zdaj < pozdravDo) in PRED setupComplete za Live.
    ok.most.naPcm16k(pcmKos(1));
    ok.most.naPcm16k(pcmKos(2));
    ok.most.naPcm16k(pcmKos(3));
    assert.deepEqual(prejetiKosi, [1, 2, 3], "kosi gredo Sonioxu takoj, pred predpomnjenjem za Live");
    assert.equal(ok.livePoslano.length, 0, "Live se caka na setupComplete in konec pozdrava");

    // Po koncu pozdrava in setupComplete gredo naslednji kosi se vedno tudi v Soniox.
    zdaj += 6_000;
    ok.emitLive({ setupComplete: {} });
    ok.most.naPcm16k(pcmKos(4));
    ok.most.naPcm16k(pcmKos(5));
    assert.deepEqual(prejetiKosi, [1, 2, 3, 4, 5]);
    await ok.most.zakljuci("stop");
  });

  it("povezava prek sonioxZaKoren + lazna vticnica posreduje PCM kose v vrstnem redu", async () => {
    const { dir, token } = await novaMapa();
    await savePravila({ sonioxVklop: true }, token, dir);
    await shraniSonioxKljuc(SKRIVNI_KLJUC, token, dir);

    const vticnice: LaznaVticnica[] = [];
    const soniox = sonioxZaKoren(dir, () => undefined, (url, protokoli) => {
      const v = new LaznaVticnica(url, protokoli);
      vticnice.push(v);
      return v;
    });
    const ok = lazniMostOkolje({ soniox });
    ok.zacni("CA-povezava");
    await cakajDo(() => vticnice.length === 1);
    const ws = vticnice[0];
    assert.deepEqual(ws.protokoli, ["soniox-api-key", SKRIVNI_KLJUC]);

    ok.most.naPcm16k(pcmKos(10));
    ok.most.naPcm16k(pcmKos(20));
    ok.most.naPcm16k(pcmKos(30));
    ws.odpri();
    await cakajDo(() => ws.poslano.length >= 4);

    const dvojiski = ws.poslano.slice(1) as Uint8Array[];
    assert.deepEqual(dvojiski.map((k) => k[0]), [10, 20, 30]);

    ws.prejmiJson({ tokens: [{ text: "Dober dan", is_final: true }] });
    const zak = ok.most.zakljuci("stop");
    await zak;
    ws.prejmiJson({ tokens: [{ text: "!", is_final: true }], finished: true });
    await cakajDo(() => ok.dobesednoKlici.length === 1);
    assert.deepEqual(ok.dobesednoKlici, [{ callSid: "CA-povezava", besedilo: "Dober dan!" }]);
  });
});

describe("(d) seja, ki vrze ali obvisi, ne ustavi in ne upocasni klica", () => {
  it("odpri(), poslji() in zakljuci(), ki vrzejo, ne prekinejo klica", async () => {
    // 1) odpri() vrze
    const ok1 = lazniMostOkolje({
      soniox: {
        odpri: () => {
          throw new Error("odpri spodletel");
        },
      },
    });
    ok1.zacni("CA-vrze-odpri");
    await cakajDo(() => ok1.liveOdprt);
    ok1.most.naPcm16k(pcmKos(1));
    await ok1.most.zakljuci("stop");
    assert.deepEqual(ok1.zakljucenoKlici, ["CA-vrze-odpri"]);

    // 2) poslji() in zakljuci() vrzeta
    let uraMs = 5_000;
    const ok2 = lazniMostOkolje({
      ura: () => uraMs,
      pozdravBajtov: 160,
      soniox: {
        odpri: () => ({
          poslji: () => {
            throw new Error("poslji spodletel");
          },
          zakljuci: async () => {
            throw new Error("zakljuci spodletel");
          },
          zapri: () => {
            throw new Error("zapri spodletel");
          },
        }),
      },
    });
    ok2.zacni("CA-vrze-poslji");
    await cakajDo(() => ok2.liveOdprt);
    uraMs += 1_000;
    ok2.emitLive({ setupComplete: {} });
    ok2.most.naPcm16k(pcmKos(7));
    assert.equal(ok2.livePoslano.length, 1, "Live kljub napaki Soniox prejme zvok");
    await ok2.most.zakljuci("stop");
    assert.deepEqual(ok2.zakljucenoKlici, ["CA-vrze-poslji"]);
  });

  it("seja, ki obvisi pri zakljuci(), ne zadrzi klica; po roku zapre sejo in odda zbrano besedilo enkrat", async () => {
    assert.equal(ROK_ZAKLJUCKA_SONIOX_MS, 3_000);
    let uraMs = 1_000;
    let zaprto = 0;
    let posljiBesedilo: ((kos: string) => void) | null = null;
    const ok = lazniMostOkolje({
      ura: () => uraMs,
      sonioxRokZakljuckaMs: 40,
      soniox: {
        odpri: (_sid, naBesedilo) => {
          posljiBesedilo = naBesedilo;
          return {
            poslji: () => undefined,
            zakljuci: () => new Promise<void>(() => undefined), // nikoli se ne razresi
            zapri: () => {
              zaprto += 1;
            },
          };
        },
      },
    });

    ok.zacni("CA-obvisi");
    await cakajDo(() => ok.liveOdprt && posljiBesedilo !== null);
    posljiBesedilo!("Delni ");
    posljiBesedilo!("zapis.");

    const t0 = performance.now();
    await ok.most.zakljuci("stop");
    const trajanjeMs = performance.now() - t0;
    assert.ok(trajanjeMs < 150, `klic se ne sme zadrzati (trajanje ${trajanjeMs.toFixed(1)} ms)`);
    assert.equal(ok.most.konec, true);
    assert.deepEqual(ok.zakljucenoKlici, ["CA-obvisi"]);

    // Po roku zakljucka se seja zapre in zbrano besedilo pride v dobesedno natanko enkrat.
    await cakajDo(() => ok.dobesednoKlici.length === 1);
    assert.equal(zaprto, 1);
    assert.deepEqual(ok.dobesednoKlici, [{ callSid: "CA-obvisi", besedilo: "Delni zapis." }]);
  });
});

describe("(e) zakljucek: zlozeni zapis pride v dobesedno tocno enkrat in se shrani v calls.json", () => {
  it("kosi iz naBesedilo se zlozijo dobesedno in gredo v zapisnik.dobesedno tocno enkrat", async () => {
    let razresiZakljucek = null as (() => void) | null;
    let posljiBesedilo = null as ((kos: string) => void) | null;
    const ok = lazniMostOkolje({
      soniox: {
        odpri: (_sid, naBesedilo) => {
          posljiBesedilo = naBesedilo;
          return {
            poslji: () => undefined,
            zakljuci: () =>
              new Promise<void>((r) => {
                razresiZakljucek = r;
              }),
            zapri: () => undefined,
          };
        },
      },
    });

    ok.zacni("CA-zlozeno");
    await cakajDo(() => ok.liveOdprt && posljiBesedilo !== null);
    posljiBesedilo!("To");
    posljiBesedilo!("plot");
    posljiBesedilo!("na črpalka, ");
    await ok.most.zakljuci("stop");
    await ok.most.zakljuci("stop"); // idempotenca ne podvoji dobesedno

    assert.ok(razresiZakljucek !== null);
    posljiBesedilo!("prosim.");
    razresiZakljucek!();

    await cakajDo(() => ok.dobesednoKlici.length === 1);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(ok.dobesednoKlici.length, 1);
    assert.deepEqual(ok.dobesednoKlici[0], { callSid: "CA-zlozeno", besedilo: "Toplotna črpalka, prosim." });
  });

  it("zapisnikIzKnjige(root).dobesedno ocisti nadzorne znake, omeji na MEJA_DOBESEDNO in zapise v calls.json", async () => {
    const { dir } = await novaMapa();
    const zap = zapisnikIzKnjige(dir);
    const sid = "CA-dobesedno-knjiga";
    await zap.zacni({ callSid: sid, from: "+38640000001", pozdrav: POZDRAV });
    await zap.zakljuci(sid);

    const dolgo = `Dober\u0000\u0007\u001b\ndan\t${"a".repeat(MEJA_DOBESEDNO + 500)}`;
    await zap.dobesedno!(sid, dolgo);

    const book = JSON.parse(await readFile(path.join(dir, "calls.json"), "utf8")) as Record<string, CallSession>;
    const klic = book[sid];
    assert.ok(klic);
    assert.equal(typeof klic.dobesedno, "string");
    assert.equal(klic.dobesedno!.length, MEJA_DOBESEDNO);
    assert.equal(/[\u0000-\u001f\u007f-\u009f]/.test(klic.dobesedno!), false, "brez nadzornih znakov");
    assert.ok(klic.dobesedno!.startsWith("Dober dan aaaa"));
    assert.ok(klic.zapisek, "zapisek datoteka mora obstajati");
    const zapisekMd = await readFile(path.join(dir, "zapiski", klic.zapisek!), "utf8");
    assert.equal(zapisekMd.includes("Dobeseden zapis (Soniox): Dober dan aaaa"), true);
  });
});

describe("(f) kljuc ni v calls.json, dnevniku, napaki, stanjeSoniox ali console", () => {
  it("skrivni kljuc nikoli ne uide v noben izhod ali datoteko", async () => {
    const { dir, token } = await novaMapa();
    await savePravila({ sonioxVklop: true }, token, dir);

    const izpisi: string[] = [];
    const origLog = console.log;
    const origWarn = console.warn;
    const origErr = console.error;
    const origInfo = console.info;
    const zajemi = (...args: unknown[]) => void izpisi.push(args.map(String).join(" "));
    console.log = zajemi;
    console.warn = zajemi;
    console.error = zajemi;
    console.info = zajemi;

    try {
      // Napaka pri neveljavnem kljucu ne sme vsebovati vnosa.
      const slabZMarkerjem = `slab ${SKRIVNI_KLJUC}`;
      await assert.rejects(
        shraniSonioxKljuc(slabZMarkerjem, token, dir),
        (err: unknown) => err instanceof Error && !err.message.includes(SKRIVNI_KLJUC),
      );

      await shraniSonioxKljuc(SKRIVNI_KLJUC, token, dir);
      const st = await stanjeSoniox(token, dir);
      assert.equal(JSON.stringify(st).includes(SKRIVNI_KLJUC), false);
      assert.deepEqual(Object.keys(st).sort(), ["kljucShranjen", "vklop"]);

      const dnevniki: string[] = [];
      const vticnice: LaznaVticnica[] = [];
      const soniox = sonioxZaKoren(dir, (koda) => void dnevniki.push(koda), (url, protokoli) => {
        const v = new LaznaVticnica(url, protokoli);
        vticnice.push(v);
        return v;
      });
      const zap = zapisnikIzKnjige(dir);
      const ok = lazniMostOkolje({ soniox, zapisnik: zap });
      ok.zacni("CA-tajnost");
      await cakajDo(() => vticnice.length === 1);
      const ws = vticnice[0];
      ws.odpri();
      ws.prejmiJson({ tokens: [{ text: "Tajna vsebina pogovora", is_final: true }] });
      ws.prejmiJson({
        error_type: `unauthenticated ${SKRIVNI_KLJUC}`,
        error_message: `Bad key ${SKRIVNI_KLJUC}`,
      });

      await ok.most.zakljuci("stop");
      await cakajDo(() => dnevniki.length > 0);
      await new Promise((r) => setTimeout(r, 30));

      for (const d of dnevniki) {
        assert.equal(d.includes(SKRIVNI_KLJUC), false, "kljuc ne sme v dnevnik");
        assert.equal(d.includes("Tajna vsebina"), false, "vsebina klica ne sme v dnevnik");
        assert.match(d, /^soniox-[a-z0-9_-]+$/i);
      }

      const callsRaw = await readFile(path.join(dir, "calls.json"), "utf8");
      assert.equal(callsRaw.includes(SKRIVNI_KLJUC), false, "kljuc ne sme v calls.json");
      const sonioxRaw = await readFile(path.join(dir, "soniox.json"), "utf8");
      assert.equal(sonioxRaw.includes(SKRIVNI_KLJUC), false, "kljuc ne sme v soniox.json v cistem besedilu");
      assert.equal(izpisi.join("\n").includes(SKRIVNI_KLJUC), false, "kljuc ne sme v console");
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origErr;
      console.info = origInfo;
    }
  });
});

describe("(g) savePravila brez zetona lastnika ne spremeni sonioxVklop; normalizePravila pri 'true' da false", () => {
  it("zahteva zeton lastnika in sprejme samo dobesedni boolean true", async () => {
    const { dir, token } = await novaMapa();
    await assert.rejects(savePravila({ sonioxVklop: true }, null, dir), LinaAuthError);
    await assert.rejects(savePravila({ sonioxVklop: true }, "tuj-zeton", dir), LinaAuthError);
    assert.equal((await loadPravila(dir)).sonioxVklop, false);

    assert.equal(normalizePravila({ sonioxVklop: "true" as unknown as boolean }).sonioxVklop, false);
    assert.equal(normalizePravila({ sonioxVklop: 1 as unknown as boolean }).sonioxVklop, false);
    assert.equal(normalizePravila({ sonioxVklop: null as unknown as boolean }).sonioxVklop, false);
    assert.equal(normalizePravila({ sonioxVklop: true }).sonioxVklop, true);

    await assert.rejects(
      savePravila({ sonioxVklop: "true" as unknown as boolean }, token, dir),
      (err: unknown) => err instanceof Error && err.message === t("pravilaVnosTip").replace("{polje}", "sonioxVklop"),
    );
    assert.equal((await loadPravila(dir)).sonioxVklop, false);

    const shranjeno = await savePravila({ sonioxVklop: true }, token, dir);
    assert.equal(shranjeno.sonioxVklop, true);
    assert.equal((await loadPravila(dir)).sonioxVklop, true);
  });
});

describe("(h) zapisek vsebuje vrstico, osebni nacin jo prikaze, brez dobesedno vrstice ni", () => {
  it("poslovni in osebni zapisek prikazeta vrstico Dobeseden zapis (Soniox) samo, ce obstaja call.dobesedno", () => {
    assert.deepEqual(Object.keys(sl).sort(), Object.keys(en).sort(), "sl in en imata enake kljuce");

    const poslovniBrez = vsebinaZapiska(vzorecKlica());
    assert.equal(poslovniBrez.includes("Dobeseden zapis (Soniox):"), false);

    const poslovniZ = vsebinaZapiska(vzorecKlica({ dobesedno: "Rad bi naročil hrastovo mizo." }));
    assert.equal(poslovniZ.includes("Dobeseden zapis (Soniox): Rad bi naročil hrastovo mizo."), true);
    assert.equal(poslovniZ.includes(`${t("zapisekPotrjeno")}: ${t("zapisekDa")}`), true);

    const osebniBrez = vsebinaZapiska(
      vzorecKlica({
        nacin: "osebna",
        order: {
          ...vzorecKlica().order,
          tajnica: { sporocilo: "Pridem ob treh.", razlog: "", nujno: false, nujnostZnana: false },
        },
      }),
    );
    assert.equal(osebniBrez.includes("Dobeseden zapis (Soniox):"), false);
    assert.equal(osebniBrez.includes(`${t("zapisekPotrjeno")}:`), false);

    const osebniZ = vsebinaZapiska(
      vzorecKlica({
        nacin: "osebna",
        dobesedno: "Povejte Ani da pridem ob treh.",
        order: {
          ...vzorecKlica().order,
          tajnica: { sporocilo: "Pridem ob treh.", razlog: "", nujno: false, nujnostZnana: false },
        },
      }),
    );
    assert.equal(osebniZ.includes("Dobeseden zapis (Soniox): Povejte Ani da pridem ob treh."), true);
    assert.equal(osebniZ.includes(`${t("zapisekSporocilo")}: Pridem ob treh.`), true);
    assert.equal(osebniZ.includes(`${t("zapisekPotrjeno")}:`), false);
  });
});
