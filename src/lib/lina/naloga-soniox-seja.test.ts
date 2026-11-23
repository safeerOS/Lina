/**
 * Preizkusi seje odjemalca Soniox (soniox-seja.server.ts) z lazno vticnico, brez omrezja.
 * Pokriva: avtentikacijo prek podprotokolov, zacetno sporocilo, vrsto pred odprtjem (96000 B),
 * keepalive, prazen besedilni okvir in finished pri zakljuci(), ponovljive in neponovljive napake,
 * nepricakovane/ne-JSON okvirje ter zascito skrivnega kljuca pred izpisom v napake in console.*.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CAS_KEEPALIVE_MS,
  NAJVEC_VRSTA_BAJTOV,
  ROK_ZAKLJUCKA_MS,
  ZAKASNITVE_PONOVITEV_MS,
  odpriSonioxSejo,
  type SonioxVticnica,
} from "./soniox-seja.server.ts";

class LaznaVticnica implements SonioxVticnica {
  readyState = 0; // CONNECTING
  readonly url: string;
  readonly protokoli: string[];
  readonly poslano: Array<string | Uint8Array> = [];
  zaprto = false;
  kodaZaprtja?: number;
  vrziPriPosiljanju = false;
  vrziPriZapiranju = false;

  private readonly openPoslusalci: Array<() => void> = [];
  private readonly messagePoslusalci: Array<(dogodek: { data: unknown }) => void> = [];
  private readonly errorPoslusalci: Array<(dogodek: unknown) => void> = [];
  private readonly closePoslusalci: Array<(dogodek: { code?: number; reason?: string }) => void> = [];

  constructor(url: string, protokoli: string[]) {
    this.url = url;
    this.protokoli = [...protokoli];
  }

  send(podatki: string | Uint8Array): void {
    if (this.vrziPriPosiljanju) throw new Error("posiljanje spodletelo");
    this.poslano.push(podatki instanceof Uint8Array ? podatki.slice() : podatki);
  }

  close(koda?: number): void {
    if (this.vrziPriZapiranju) throw new Error("zapiranje spodletelo");
    if (this.zaprto) return;
    this.zaprto = true;
    this.kodaZaprtja = koda;
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
    this.readyState = 1; // OPEN
    for (const fn of [...this.openPoslusalci]) fn();
  }

  prejmi(podatki: unknown): void {
    for (const fn of [...this.messagePoslusalci]) fn({ data: podatki });
  }

  prejmiJson(objekt: unknown): void {
    this.prejmi(JSON.stringify(objekt));
  }

  sproziNapako(podrobnost: unknown): void {
    for (const fn of [...this.errorPoslusalci]) fn(podrobnost);
  }

  sproziZaprtje(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.zaprto = true;
    for (const fn of [...this.closePoslusalci]) fn({ code, reason });
  }
}

function pocakajMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function napolniKos(dolzina: number, oznaka: number): Uint8Array {
  const kos = new Uint8Array(dolzina);
  kos.fill(oznaka & 0xff);
  return kos;
}

describe("soniox-seja.server: povezava, avtentikacija in zacetno sporocilo", () => {
  it("uporablja privzete meje protokola (96000 B, 20 s keepalive, 300/900 ms ponovitve, 3 s zakljucek)", () => {
    assert.equal(NAJVEC_VRSTA_BAJTOV, 96_000);
    assert.equal(CAS_KEEPALIVE_MS, 20_000);
    assert.deepEqual([...ZAKASNITVE_PONOVITEV_MS], [300, 900]);
    assert.equal(ROK_ZAKLJUCKA_MS, 3_000);
  });

  it("poslje kljuc izkljucno v podprotokolih [soniox-api-key, kljuc] in cisto zacetno sporocilo brez osebnih polj", () => {
    const kljuc = "skrivni-kljuc-soniox-998877";
    const vticnice: LaznaVticnica[] = [];
    const seja = odpriSonioxSejo({
      kljuc,
      naZakljuceno: () => {},
      naNapaka: () => {},
      naKonec: () => {},
      ustvariVticnico: (url, protokoli) => {
        const v = new LaznaVticnica(url, protokoli);
        vticnice.push(v);
        return v;
      },
    });

    assert.equal(vticnice.length, 1);
    const ws = vticnice[0];
    assert.equal(ws.url, "wss://stt-rt.soniox.com/transcribe-websocket");
    assert.deepEqual(ws.protokoli, ["soniox-api-key", kljuc]);

    ws.odpri();
    assert.equal(ws.poslano.length, 1);
    assert.equal(typeof ws.poslano[0], "string");
    const prvo = ws.poslano[0] as string;
    assert.equal(prvo.includes(kljuc), false, "kljuc ne sme v zacetno sporocilo");

    const parsed = JSON.parse(prvo) as Record<string, unknown>;
    assert.deepEqual(parsed, {
      model: "stt-rt-v6",
      audio_format: "pcm_s16le",
      sample_rate: 16000,
      num_channels: 1,
      language_hints: ["sl"],
      enable_endpoint_detection: true,
    });
    assert.equal("api_key" in parsed, false);
    assert.equal("context" in parsed, false);
    assert.equal("client_reference_id" in parsed, false);
    assert.equal("enable_speaker_diarization" in parsed, false);

    seja.zapri();
  });
});

describe("soniox-seja.server: vrsta pred odprtjem (najvec 96000 B)", () => {
  it("hrani najvec 96000 bajtov, zavrze najstarejse in ohrani vrstni red po odprtju", () => {
    const vticnice: LaznaVticnica[] = [];
    const seja = odpriSonioxSejo({
      kljuc: "test-kljuc-vrsta",
      naZakljuceno: () => {},
      naNapaka: () => {},
      naKonec: () => {},
      ustvariVticnico: (url, protokoli) => {
        const v = new LaznaVticnica(url, protokoli);
        vticnice.push(v);
        return v;
      },
    });

    // 4 kosi po 32000 B = 128000 B -> najstarejsi (oznaka 1) mora odpasti, ostanejo 2, 3, 4 (= 96000 B).
    seja.poslji(napolniKos(32_000, 1));
    seja.poslji(napolniKos(32_000, 2));
    seja.poslji(napolniKos(32_000, 3));
    seja.poslji(napolniKos(32_000, 4));

    const ws = vticnice[0];
    assert.equal(ws.poslano.length, 0, "pred odprtjem ne posilja");

    ws.odpri();
    // Prvi okvir je zacetni JSON, nato 3 dvojiski okvirji v vrstnem redu 2, 3, 4.
    assert.equal(ws.poslano.length, 4);
    assert.equal(typeof ws.poslano[0], "string");

    const dvojiski = ws.poslano.slice(1) as Uint8Array[];
    const skupajBajtov = dvojiski.reduce((s, k) => s + k.byteLength, 0);
    assert.equal(skupajBajtov, 96_000);
    assert.deepEqual(
      dvojiski.map((k) => k[0]),
      [2, 3, 4],
    );

    seja.zapri();
  });

  it("pri enem kosu vecjem od 96000 bajtov obdrzi zadnjih 96000 bajtov", () => {
    const vticnice: LaznaVticnica[] = [];
    const seja = odpriSonioxSejo({
      kljuc: "test-kljuc-velik",
      naZakljuceno: () => {},
      naNapaka: () => {},
      naKonec: () => {},
      ustvariVticnico: (url, protokoli) => {
        const v = new LaznaVticnica(url, protokoli);
        vticnice.push(v);
        return v;
      },
    });

    const velik = new Uint8Array(110_000);
    velik.fill(7, 0, 14_000);
    velik.fill(9, 14_000, 110_000);
    seja.poslji(velik);

    const ws = vticnice[0];
    ws.odpri();
    assert.equal(ws.poslano.length, 2);
    const poslani = ws.poslano[1] as Uint8Array;
    assert.equal(poslani.byteLength, 96_000);
    assert.equal(poslani[0], 9);
    assert.equal(poslani[poslani.byteLength - 1], 9);

    seja.zapri();
  });
});

describe("soniox-seja.server: prepis, keepalive in zakljuci()", () => {
  it("posreduje zakljucene zetone brez podvajanja in brez <end> ter zakljuci s praznim besedilnim okvirjem pred iztekom 3 s", async () => {
    const vticnice: LaznaVticnica[] = [];
    const zakljuceno: string[] = [];
    let koncev = 0;

    const seja = odpriSonioxSejo({
      kljuc: "test-kljuc-zakljuci",
      naZakljuceno: (b) => zakljuceno.push(b),
      naNapaka: () => assert.fail("nepricakovana napaka"),
      naKonec: () => {
        koncev += 1;
      },
      ustvariVticnico: (url, protokoli) => {
        const v = new LaznaVticnica(url, protokoli);
        vticnice.push(v);
        return v;
      },
    });

    const ws = vticnice[0];
    ws.odpri();

    ws.prejmiJson({
      tokens: [
        { text: "Dober", is_final: true },
        { text: " da", is_final: false },
      ],
    });
    ws.prejmiJson({
      tokens: [
        { text: " dan.", is_final: true },
        { text: "<end>", is_final: true },
      ],
    });
    ws.prejmiJson({
      tokens: [{ text: " samo-osnutek", is_final: false }],
    });

    assert.equal(zakljuceno.join(""), "Dober dan.");
    assert.equal(zakljuceno.length, 2);

    const zacetek = Date.now();
    const obljuba = seja.zakljuci();

    // Zadnji poslani okvir mora biti PRAZEN BESEDILNI okvir (""), ne prazen Uint8Array.
    const zadnji = ws.poslano[ws.poslano.length - 1];
    assert.equal(typeof zadnji, "string");
    assert.equal(zadnji, "");

    ws.prejmiJson({ tokens: [], finished: true });
    await obljuba;
    const trajanje = Date.now() - zacetek;

    assert.ok(trajanje < 1000, `zakljuci mora koncati takoj ob finished (trajalo ${trajanje} ms)`);
    assert.equal(koncev, 1);
    assert.equal(ws.zaprto, true);
  });

  it("zakljuci() se iztece brez napake, ce streznik ne poslje finished", async () => {
    const vticnice: LaznaVticnica[] = [];
    let koncev = 0;
    const seja = odpriSonioxSejo({
      kljuc: "test-kljuc-rok",
      rokZakljuckaMs: 40,
      naZakljuceno: () => {},
      naNapaka: () => assert.fail("rok zakljucka ne sme sproziti naNapaka"),
      naKonec: () => {
        koncev += 1;
      },
      ustvariVticnico: (url, protokoli) => {
        const v = new LaznaVticnica(url, protokoli);
        vticnice.push(v);
        return v;
      },
    });

    const ws = vticnice[0];
    ws.odpri();
    await seja.zakljuci();
    assert.equal(ws.zaprto, true);
    assert.equal(koncev, 1);
  });

  it("posilja keepalive ob tisini in ga prekine po zaprtju", async () => {
    const vticnice: LaznaVticnica[] = [];
    const seja = odpriSonioxSejo({
      kljuc: "test-kljuc-keepalive",
      casKeepaliveMs: 25,
      naZakljuceno: () => {},
      naNapaka: () => {},
      naKonec: () => {},
      ustvariVticnico: (url, protokoli) => {
        const v = new LaznaVticnica(url, protokoli);
        vticnice.push(v);
        return v;
      },
    });

    const ws = vticnice[0];
    ws.odpri();
    await pocakajMs(70);

    const keepalivi = ws.poslano.filter((x) => x === '{"type":"keepalive"}');
    assert.ok(keepalivi.length >= 1, "v tisini mora poslati najmanj en keepalive");

    seja.zapri();
    const steviloPoZaprtju = ws.poslano.length;
    await pocakajMs(60);
    assert.equal(ws.poslano.length, steviloPoZaprtju, "po zaprtju ne sme vec posiljati keepalive");
  });
});

describe("soniox-seja.server: ponovljive in neponovljive napake", () => {
  it("ob eni ponovljivi napaki odpre eno novo povezavo brez ponavljanja preteklega zvoka in seja zivi", async () => {
    const vticnice: LaznaVticnica[] = [];
    const napake: string[] = [];
    const zakljuceno: string[] = [];

    const seja = odpriSonioxSejo({
      kljuc: "test-kljuc-ponovi-1",
      zakasnitvePonovitevMs: [15, 30],
      naZakljuceno: (b) => zakljuceno.push(b),
      naNapaka: (tip) => napake.push(tip),
      naKonec: () => {},
      ustvariVticnico: (url, protokoli) => {
        const v = new LaznaVticnica(url, protokoli);
        vticnice.push(v);
        return v;
      },
    });

    const ws1 = vticnice[0];
    ws1.odpri();
    seja.poslji(napolniKos(640, 11));
    ws1.prejmiJson({ tokens: [{ text: "Prvi", is_final: true }] });

    // Ponovljiva napaka na prvi povezavi -> streznik zapre povezavo.
    ws1.prejmiJson({
      tokens: [],
      error_code: 503,
      error_type: "service_unavailable",
      error_message: "temporary",
      request_id: "req-pon-1",
    });
    ws1.sproziZaprtje(1011);

    assert.deepEqual(napake, [], "prva ponovljiva napaka ne sme klicati naNapaka");

    await pocakajMs(40);
    assert.equal(vticnice.length, 2, "odpreti mora tocno eno novo povezavo");

    const ws2 = vticnice[1];
    ws2.odpri();
    // Na novi povezavi sme biti samo zacetno sporocilo, NE pa pretekli kos zvoka (oznaka 11).
    assert.equal(ws2.poslano.length, 1);
    assert.equal(typeof ws2.poslano[0], "string");

    seja.poslji(napolniKos(640, 22));
    assert.equal(ws2.poslano.length, 2);
    assert.equal((ws2.poslano[1] as Uint8Array)[0], 22);

    ws2.prejmiJson({ tokens: [{ text: " drugi", is_final: true }] });
    assert.equal(zakljuceno.join(""), "Prvi drugi");
    assert.deepEqual(napake, []);

    seja.zapri();
  });

  it("ob treh zaporednih ponovljivih napakah konca ponavljanje in poklice naNapaka", async () => {
    const vticnice: LaznaVticnica[] = [];
    const napake: string[] = [];

    const seja = odpriSonioxSejo({
      kljuc: "test-kljuc-ponovi-3",
      zakasnitvePonovitevMs: [10, 20],
      naZakljuceno: () => {},
      naNapaka: (tip) => napake.push(tip),
      naKonec: () => {},
      ustvariVticnico: (url, protokoli) => {
        const v = new LaznaVticnica(url, protokoli);
        vticnice.push(v);
        return v;
      },
    });

    // 1. napaka (prvotna povezava) -> ponovitev 1
    vticnice[0].odpri();
    vticnice[0].prejmiJson({ tokens: [], error_code: 503, error_type: "service_unavailable", request_id: "r1" });
    vticnice[0].sproziZaprtje(1011);
    assert.deepEqual(napake, []);

    await pocakajMs(25);
    assert.equal(vticnice.length, 2);

    // 2. napaka (1. ponovitev) -> ponovitev 2
    vticnice[1].odpri();
    vticnice[1].prejmiJson({ tokens: [], error_code: 500, error_type: "internal_error", request_id: "r2" });
    vticnice[1].sproziZaprtje(1011);
    assert.deepEqual(napake, []);

    await pocakajMs(40);
    assert.equal(vticnice.length, 3);

    // 3. napaka (2. ponovitev) -> konec ponovitev, naNapaka
    vticnice[2].odpri();
    vticnice[2].prejmiJson({ tokens: [], error_code: 408, error_type: "request_timeout", request_id: "r3" });
    vticnice[2].sproziZaprtje(1011);

    assert.deepEqual(napake, ["request_timeout"]);

    await pocakajMs(40);
    assert.equal(vticnice.length, 3, "po 2 ponovitvah ne sme odpreti 4. povezave");

    assert.doesNotThrow(() => seja.poslji(napolniKos(320, 1)));
    await seja.zakljuci();
    assert.doesNotThrow(() => seja.zapri());
  });

  it("ob neponovljivi napaki takoj poklice naNapaka brez ponovne povezave in poslji ne vrze", async () => {
    const vticnice: LaznaVticnica[] = [];
    const napake: string[] = [];

    const seja = odpriSonioxSejo({
      kljuc: "test-kljuc-nepon",
      zakasnitvePonovitevMs: [10, 20],
      naZakljuceno: () => {},
      naNapaka: (tip) => napake.push(tip),
      naKonec: () => {},
      ustvariVticnico: (url, protokoli) => {
        const v = new LaznaVticnica(url, protokoli);
        vticnice.push(v);
        return v;
      },
    });

    const ws = vticnice[0];
    ws.odpri();
    ws.prejmiJson({
      tokens: [],
      error_code: 402,
      error_type: "organization_balance_exhausted",
      error_message: "no funds",
      request_id: "req-bal",
    });
    ws.sproziZaprtje(1008);

    assert.deepEqual(napake, ["organization_balance_exhausted"]);

    await pocakajMs(35);
    assert.equal(vticnice.length, 1, "neponovljiva napaka ne sme odpreti nove povezave");

    const poslanoPred = ws.poslano.length;
    assert.doesNotThrow(() => seja.poslji(napolniKos(640, 3)));
    assert.equal(ws.poslano.length, poslanoPred, "mirujoca seja ne posilja vec zvoka");
    await assert.doesNotReject(() => seja.zakljuci());
    assert.doesNotThrow(() => seja.zapri());
  });
});

describe("soniox-seja.server: odpornost in zascita skrivnega kljuca", () => {
  it("nepricakovan JSON, ne-JSON ali dvojiski okvir streznika ne podre seje", () => {
    const vticnice: LaznaVticnica[] = [];
    const zakljuceno: string[] = [];
    const napake: string[] = [];

    const seja = odpriSonioxSejo({
      kljuc: "test-kljuc-odpornost",
      naZakljuceno: (b) => zakljuceno.push(b),
      naNapaka: (tip) => napake.push(tip),
      naKonec: () => {},
      ustvariVticnico: (url, protokoli) => {
        const v = new LaznaVticnica(url, protokoli);
        vticnice.push(v);
        return v;
      },
    });

    const ws = vticnice[0];
    ws.odpri();
    ws.prejmi("{to ni veljaven json");
    ws.prejmi("");
    ws.prejmi(new Uint8Array([1, 2, 3]));
    ws.prejmi(null);
    ws.prejmiJson({ cudno: true, tokens: "napacen-tip" });
    ws.prejmiJson([1, 2, 3]);

    ws.prejmiJson({ tokens: [{ text: "Deluje naprej", is_final: true }] });
    assert.equal(zakljuceno.join(""), "Deluje naprej");
    assert.deepEqual(napake, []);

    seja.zapri();
  });

  it("kljuc se nikoli ne pojavi v sporocilih napak, izjemah ali console.* (spy na console.*)", async () => {
    const tajniKljuc = "TAJNI-SONIOX-KLJUC-XYZ-774411";
    const izpisi: string[] = [];
    const metode = ["log", "info", "warn", "error", "debug"] as const;
    const izvirniki = new Map<(typeof metode)[number], (...args: unknown[]) => void>();
    for (const m of metode) {
      izvirniki.set(m, console[m]);
      console[m] = (...args: unknown[]) => {
        izpisi.push(args.map((a) => String(a)).join(" "));
      };
    }

    try {
      const napake: string[] = [];
      const vticnice: LaznaVticnica[] = [];
      const seja = odpriSonioxSejo({
        kljuc: tajniKljuc,
        naZakljuceno: () => {},
        naNapaka: (tip, podrobnost) => {
          napake.push(podrobnost ? `${tip}:${podrobnost}` : tip);
        },
        naKonec: () => {},
        ustvariVticnico: (url, protokoli) => {
          const v = new LaznaVticnica(url, protokoli);
          vticnice.push(v);
          return v;
        },
      });

      const ws = vticnice[0];
      ws.odpri();
      // Tudi ce streznik vrne kljuc v error_message ali vticnica vrze ob send/close, kljuc ne sme nikamor.
      ws.vrziPriPosiljanju = true;
      assert.doesNotThrow(() => seja.poslji(napolniKos(320, 5)));
      ws.vrziPriPosiljanju = false;

      ws.prejmiJson({
        tokens: [],
        error_code: 401,
        error_type: "unauthenticated",
        error_message: `Invalid key ${tajniKljuc}`,
        request_id: "req-tajni-1",
      });
      ws.vrziPriZapiranju = true;
      ws.sproziZaprtje(1008);
      assert.doesNotThrow(() => seja.zapri());
      await assert.doesNotReject(() => seja.zakljuci());

      for (const vrstica of izpisi) {
        assert.equal(vrstica.includes(tajniKljuc), false, "kljuc se ne sme pojaviti v console.*");
      }
      for (const n of napake) {
        assert.equal(n.includes(tajniKljuc), false, "kljuc se ne sme pojaviti v naNapaka");
      }
      for (const okvir of ws.poslano) {
        if (typeof okvir === "string") {
          assert.equal(okvir.includes(tajniKljuc), false, "kljuc se ne sme pojaviti v poslanih okvirjih");
        }
      }
      assert.equal(napake.length, 1);
      assert.equal(napake[0], "unauthenticated:req-tajni-1");
    } finally {
      for (const m of metode) {
        const fn = izvirniki.get(m);
        if (fn) console[m] = fn;
      }
    }
  });
});
