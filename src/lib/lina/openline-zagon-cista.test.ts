/**
 * Preizkusi cistih gradnikov za zagon OpenLine kot otroka racunalniske Line.
 * Vse vrednosti so izmisljene (brez osebnih podatkov in brez nizov CA+hex).
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import {
  jeVeljavenKljucApi,
  novKljucApi,
  PRIVZETA_VRATA_OPENLINE,
  razcleniVrsticoOpenLine,
  sestaviOkoljeOpenLine,
  ZbiralnikIzpisa,
  type VhodOkolja,
} from "./openline-zagon-cista.ts";

const ODTIS_VELIKI = "0123456789ABCDEF".repeat(4);
const ODTIS_MALI = ODTIS_VELIKI.toLowerCase();
const ODTIS_DVOPICJA =
  "11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00";
const ODTIS_DVOPICJA_MALI = ODTIS_DVOPICJA.replace(/:/g, "").toLowerCase();
const ODTIS_DRUGI_DVOPICJA =
  "FF:EE:DD:CC:BB:AA:99:88:77:66:55:44:33:22:11:00:FF:EE:DD:CC:BB:AA:99:88:77:66:55:44:33:22:11:00";

function veljavenVhod(popravki: Partial<VhodOkolja> = {}): VhodOkolja {
  return {
    kljucApi: "aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5zA7bC9d",
    naslov: "192.168.1.5",
    vrata: PRIVZETA_VRATA_OPENLINE,
    dataDir: "/srv/primer/openline-podatki",
    linaNaslov: "127.0.0.1",
    linaVrata: 8443,
    linaZeton: "ZetonPrimer_0123456789-._~+/=",
    linaOdtis: ODTIS_VELIKI,
    dovoljeni: { nacin: "vse", stevilke: [] },
    ...popravki,
  };
}

describe("novKljucApi in jeVeljavenKljucApi", () => {
  it("ustvari 43-znakovni veljaven kljuc base64url in dva klica sta razlicna", () => {
    const k1 = novKljucApi();
    const k2 = novKljucApi();
    assert.equal(PRIVZETA_VRATA_OPENLINE, 8787);
    assert.equal(k1.length, 43);
    assert.equal(k2.length, 43);
    assert.equal(jeVeljavenKljucApi(k1), true);
    assert.equal(jeVeljavenKljucApi(k2), true);
    assert.notEqual(k1, k2);
  });

  it("zavrne prekratek, predolg, change-me, nedovoljene znake in ne-nize", () => {
    assert.equal(jeVeljavenKljucApi("a".repeat(32)), true);
    assert.equal(jeVeljavenKljucApi("a".repeat(128)), true);
    assert.equal(jeVeljavenKljucApi("a".repeat(31)), false);
    assert.equal(jeVeljavenKljucApi("a".repeat(129)), false);
    assert.equal(jeVeljavenKljucApi("change-me"), false);
    assert.equal(jeVeljavenKljucApi("a".repeat(31) + "+"), false);
    assert.equal(jeVeljavenKljucApi("a".repeat(31) + "/"), false);
    assert.equal(jeVeljavenKljucApi("a".repeat(31) + "="), false);
    assert.equal(jeVeljavenKljucApi("a".repeat(31) + " "), false);
    assert.equal(jeVeljavenKljucApi(null), false);
    assert.equal(jeVeljavenKljucApi(undefined), false);
    assert.equal(jeVeljavenKljucApi(1234567890), false);
    assert.equal(jeVeljavenKljucApi({}), false);
  });
});

describe("sestaviOkoljeOpenLine", () => {
  const OSNOVNI_KLJUCI = [
    "ELECTRON_RUN_AS_NODE",
    "HTTP_GATEWAY_API_KEY",
    "HOST",
    "PORT",
    "DATA_DIR",
    "PUBLIC_URL",
    "LINA_STREAM_URL",
    "LINA_STREAM_TOKEN",
    "LINA_CERT_SHA256",
    "LINA_ALLOWLIST_MODE",
  ];

  it("vrne tocno dogovorjene kljuce in vrednosti za nacin vse (brez LINA_ALLOWLIST, odtis v malih crkah)", () => {
    const vhod = veljavenVhod({
      dovoljeni: { nacin: "vse", stevilke: ["+38641000111", "neveljavna,ignorirana"] },
    });
    const okolje = sestaviOkoljeOpenLine(vhod);
    assert.deepEqual(Object.keys(okolje), OSNOVNI_KLJUCI);
    assert.equal(okolje.ELECTRON_RUN_AS_NODE, "1");
    assert.equal(okolje.HTTP_GATEWAY_API_KEY, vhod.kljucApi);
    assert.equal(okolje.HOST, "192.168.1.5");
    assert.equal(okolje.PORT, "8787");
    assert.equal(okolje.DATA_DIR, "/srv/primer/openline-podatki");
    assert.equal(okolje.PUBLIC_URL, "https://192.168.1.5:8787");
    assert.equal(okolje.LINA_STREAM_URL, "wss://127.0.0.1:8443/api/voice/telefon");
    assert.equal(okolje.LINA_STREAM_TOKEN, vhod.linaZeton);
    assert.equal(okolje.LINA_CERT_SHA256, ODTIS_MALI);
    assert.equal(okolje.LINA_ALLOWLIST_MODE, "off");
    assert.equal("LINA_ALLOWLIST" in okolje, false);
  });

  it("vrne tocno dogovorjene kljuce za nacin seznam, odstrani podvojene po trim in ohrani vrstni red", () => {
    const okolje = sestaviOkoljeOpenLine(
      veljavenVhod({
        dovoljeni: {
          nacin: "seznam",
          stevilke: [" +386 41 000 111 ", "040-111-222", "+386 41 000 111", "*31#0123456", "(01) 555 0100"],
        },
      }),
    );
    assert.deepEqual(Object.keys(okolje), [...OSNOVNI_KLJUCI, "LINA_ALLOWLIST"]);
    assert.equal(okolje.LINA_ALLOWLIST_MODE, "on");
    assert.equal(okolje.LINA_ALLOWLIST, "+386 41 000 111,040-111-222,*31#0123456,(01) 555 0100");
  });

  it("pri praznem seznamu v nacinu seznam nastavi mode on in izpusti LINA_ALLOWLIST", () => {
    const okolje = sestaviOkoljeOpenLine(
      veljavenVhod({ dovoljeni: { nacin: "seznam", stevilke: [] } }),
    );
    assert.deepEqual(Object.keys(okolje), OSNOVNI_KLJUCI);
    assert.equal(okolje.LINA_ALLOWLIST_MODE, "on");
    assert.equal("LINA_ALLOWLIST" in okolje, false);
  });

  it("dovoljuje 200 stevilk, pri 201 pa vrze napako", () => {
    const dvesto = Array.from({ length: 200 }, (_, i) => `+3864100${String(i).padStart(4, "0")}`);
    const ok = sestaviOkoljeOpenLine(veljavenVhod({ dovoljeni: { nacin: "seznam", stevilke: dvesto } }));
    assert.equal(ok.LINA_ALLOWLIST.split(",").length, 200);

    const prevec = [...dvesto, "+38641009999"];
    assert.throws(
      () => sestaviOkoljeOpenLine(veljavenVhod({ dovoljeni: { nacin: "seznam", stevilke: prevec } })),
      /^Error: neveljavno polje: dovoljeni$/,
    );
  });

  it("vrze tocno neveljavno polje za vsako neveljavno polje posebej", () => {
    const primeri: Array<[string, Partial<VhodOkolja>]> = [
      ["kljucApi", { kljucApi: "prekratek" }],
      ["kljucApi", { kljucApi: "change-me" }],
      ["naslov", { naslov: "0.0.0.0" }],
      ["naslov", { naslov: "8.8.8.8" }],
      ["naslov", { naslov: "localhost" }],
      ["naslov", { naslov: "192.168.001.005" }],
      ["naslov", { naslov: "192.168.1" }],
      ["naslov", { naslov: "::1" }],
      ["naslov", { naslov: " 192.168.1.5 " }],
      ["naslov", { naslov: "192.168.1.256" }],
      ["vrata", { vrata: 1023 }],
      ["vrata", { vrata: 65536 }],
      ["vrata", { vrata: 80.5 }],
      ["vrata", { vrata: "8787" as unknown as number }],
      ["dataDir", { dataDir: "relativna/pot" }],
      ["dataDir", { dataDir: "/srv/primer/../skrivnost" }],
      ["dataDir", { dataDir: "/srv/primer/podatki\0x" }],
      ["dataDir", { dataDir: "/" + "a".repeat(400) }],
      ["linaNaslov", { linaNaslov: "0.0.0.0" }],
      ["linaNaslov", { linaNaslov: "8.8.8.8" }],
      ["linaNaslov", { linaNaslov: "localhost" }],
      ["linaNaslov", { linaNaslov: "10.00.0.1" }],
      ["linaNaslov", { linaNaslov: "::1" }],
      ["linaVrata", { linaVrata: 1023 }],
      ["linaVrata", { linaVrata: 65536 }],
      ["linaVrata", { linaVrata: 8443.1 }],
      ["linaVrata", { linaVrata: "8443" as unknown as number }],
      ["linaZeton", { linaZeton: "a".repeat(15) }],
      ["linaZeton", { linaZeton: "a".repeat(513) }],
      ["linaZeton", { linaZeton: "zeton s presledkom 1234" }],
      ["linaOdtis", { linaOdtis: "0".repeat(63) }],
      ["linaOdtis", { linaOdtis: "0".repeat(65) }],
      ["linaOdtis", { linaOdtis: ODTIS_DVOPICJA }],
      ["dovoljeni", { dovoljeni: { nacin: "neznan" as "vse", stevilke: [] } }],
      ["dovoljeni", { dovoljeni: { nacin: "seznam", stevilke: ["+38641,000"] } }],
      ["dovoljeni", { dovoljeni: { nacin: "seznam", stevilke: ["+38641;000"] } }],
      ["dovoljeni", { dovoljeni: { nacin: "seznam", stevilke: ["+38641\n000"] } }],
      ["dovoljeni", { dovoljeni: { nacin: "seznam", stevilke: ["+38641000\n"] } }],
      ["dovoljeni", { dovoljeni: { nacin: "seznam", stevilke: ["+38641abc"] } }],
      ["dovoljeni", { dovoljeni: { nacin: "seznam", stevilke: ["12"] } }],
    ];

    for (const [polje, popravek] of primeri) {
      assert.throws(
        () => sestaviOkoljeOpenLine(veljavenVhod(popravek)),
        (napaka: unknown) => {
          assert.ok(napaka instanceof Error);
          assert.equal(napaka.message, `neveljavno polje: ${polje}`);
          return true;
        },
        `pricakovana napaka za polje ${polje}`,
      );
    }
  });

  it("sporocilo napake nikoli ne vsebuje kljuca, zetona, odtisa ali poti", () => {
    const skrivniKljuc = "KljucTajni_1234567890_neveljaven!";
    const skrivniZeton = "ZetonTajni 1234567890 neveljaven";
    const skrivniOdtis = "99:88:77:66:55:44:33:22:11:00";
    const skrivnaPot = "/srv/tajna-pot/../pobeg";

    const primeri: Array<[Partial<VhodOkolja>, string]> = [
      [{ kljucApi: skrivniKljuc }, skrivniKljuc],
      [{ linaZeton: skrivniZeton }, skrivniZeton],
      [{ linaOdtis: skrivniOdtis }, skrivniOdtis],
      [{ dataDir: skrivnaPot }, skrivnaPot],
    ];

    for (const [popravek, skrivnost] of primeri) {
      let sporocilo = "";
      try {
        sestaviOkoljeOpenLine(veljavenVhod(popravek));
        assert.fail("moralo bi vreci napako");
      } catch (e) {
        sporocilo = e instanceof Error ? e.message : String(e);
      }
      assert.equal(sporocilo.includes(skrivnost), false);
      assert.match(sporocilo, /^neveljavno polje: [a-zA-Z]+$/);
    }
  });

  it("ne deduje spremenljivk iz process.env (NODE_TLS_REJECT_UNAUTHORIZED, GEMINI_API_KEY, PATH, HOME)", () => {
    const kljuci = ["NODE_TLS_REJECT_UNAUTHORIZED", "GEMINI_API_KEY", "PATH", "HOME"] as const;
    const prej: Record<string, string | undefined> = {};
    for (const k of kljuci) prej[k] = process.env[k];
    try {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
      process.env.GEMINI_API_KEY = "izmisljen-kljuc-modela-12345";
      process.env.PATH = "/primer/bin";
      process.env.HOME = "/primer/dom";

      const okolje = sestaviOkoljeOpenLine(veljavenVhod());
      for (const k of kljuci) {
        assert.equal(k in okolje, false, `okolje ne sme vsebovati ${k}`);
      }
    } finally {
      for (const k of kljuci) {
        if (prej[k] === undefined) delete process.env[k];
        else process.env[k] = prej[k];
      }
    }
  });
});

describe("razcleniVrsticoOpenLine", () => {
  it("razcleni veljavni vrstici za naslov in odtis potrdila", () => {
    assert.deepEqual(
      razcleniVrsticoOpenLine("OpenLine slusa na https://192.168.1.5:8787"),
      { vrsta: "naslov", url: "https://192.168.1.5:8787", vrata: 8787 },
    );
    assert.deepEqual(
      razcleniVrsticoOpenLine("  OpenLine slusa na https://127.0.0.1:443/  "),
      { vrsta: "naslov", url: "https://127.0.0.1:443", vrata: 443 },
    );
    assert.deepEqual(
      razcleniVrsticoOpenLine(`Odtis certifikata SHA-256: ${ODTIS_DVOPICJA}`),
      { vrsta: "odtis", odtis: ODTIS_DVOPICJA_MALI },
    );
  });

  it("zavrne neveljavne vrstice naslova, odtisa, nadzorne znake, predolge in tuje vrstice", () => {
    const skupin31 = Array.from({ length: 31 }, () => "AB").join(":");
    const skupin33 = Array.from({ length: 33 }, () => "AB").join(":");
    const zavrnitve = [
      "",
      "   ",
      "Gemini je izklopljen.",
      "OpenLine slusa na http://192.168.1.5:8787",
      "OpenLine slusa na https://192.168.1.5",
      "OpenLine slusa na https://192.168.1.5:0",
      "OpenLine slusa na https://192.168.1.5:65536",
      "OpenLine slusa na https://192.168.1.5:8787/pot",
      "OpenLine slusa na https://192.168.1.5:8787/.",
      "OpenLine slusa na https://uporabnik@192.168.1.5:8787",
      "OpenLine slusa na https://uporabnik:geslo@192.168.1.5:8787",
      "OpenLine slusa na https://@192.168.1.5:8787",
      "OpenLine slusa na https://192.168.1.5:8787?a=1",
      "OpenLine slusa na https://192.168.1.5:8787?",
      "OpenLine slusa na https://192.168.1.5:8787#sidro",
      `Odtis certifikata SHA-256: ${skupin31}`,
      `Odtis certifikata SHA-256: ${skupin33}`,
      `Odtis certifikata SHA-256: ${ODTIS_MALI}`,
      `Odtis certifikata SHA-256: GG:${skupin31}`,
      "OpenLine slusa na https://192.168.1.5:8787\x1b[0m",
      "\x1b[32mOpenLine slusa na https://192.168.1.5:8787",
      "OpenLine slusa na https://192.168.1.5:8787\x07",
      "OpenLine slusa na https://192.168.1.5\t:8787",
      "OpenLine slusa na https://192.168.1.5\r:8787",
      `OpenLine slusa na https://192.168.1.5:8787\u0000`,
      `OpenLine slusa na https://${"a".repeat(55)}.${"b".repeat(55)}.${"c".repeat(55)}.${"d".repeat(55)}.${"e".repeat(55)}:8787`,
      "x".repeat(301),
    ];

    for (const v of zavrnitve) {
      assert.equal(razcleniVrsticoOpenLine(v), null, `moralo bi vrniti null za: ${JSON.stringify(v)}`);
    }
  });
});

describe("ZbiralnikIzpisa", () => {
  const VRSTICA_NASLOV = "OpenLine slusa na https://192.168.1.5:8787";
  const VRSTICA_ODTIS = `Odtis certifikata SHA-256: ${ODTIS_DVOPICJA}`;

  it("obdela obe vrstici v enem kosu in javi pripravljenost", () => {
    const z = new ZbiralnikIzpisa();
    assert.equal(z.naslov(), null);
    assert.equal(z.odtis(), null);
    assert.equal(z.pripravljen(), false);

    z.dodaj(`Gemini je izklopljen.\n${VRSTICA_NASLOV}\n${VRSTICA_ODTIS}\n`);
    assert.deepEqual(z.naslov(), { url: "https://192.168.1.5:8787", vrata: 8787 });
    assert.equal(z.odtis(), ODTIS_DVOPICJA_MALI);
    assert.equal(z.pripravljen(), true);
  });

  it("obdela vrstice z \\r\\n ter kose, razrezane na sredini vrstice in na sredini znaka UTF-8", () => {
    const z = new ZbiralnikIzpisa();
    const besedilo = `Zagon \u010d\u0161\u017e \u{1F512}\r\n${VRSTICA_NASLOV}\r\n${VRSTICA_ODTIS}\r\n`;
    const buf = Buffer.from(besedilo, "utf8");
    // 1-bajtni kosi zanesljivo prerezejo vecbajtne znake UTF-8, \r\n in besedilo vrstic.
    for (let i = 0; i < buf.length; i += 1) {
      z.dodaj(buf.subarray(i, i + 1));
    }
    assert.deepEqual(z.naslov(), { url: "https://192.168.1.5:8787", vrata: 8787 });
    assert.equal(z.odtis(), ODTIS_DVOPICJA_MALI);
    assert.equal(z.pripravljen(), true);
  });

  it("ne prepise prve veljavne vrednosti naslova in odtisa", () => {
    const z = new ZbiralnikIzpisa();
    z.dodaj(`${VRSTICA_NASLOV}\n${VRSTICA_ODTIS}\n`);
    z.dodaj(`OpenLine slusa na https://10.0.0.9:9999\nOdtis certifikata SHA-256: ${ODTIS_DRUGI_DVOPICJA}\n`);
    assert.deepEqual(z.naslov(), { url: "https://192.168.1.5:8787", vrata: 8787 });
    assert.equal(z.odtis(), ODTIS_DVOPICJA_MALI);
  });

  it("zavrze vrstico nad 1024 znakov (tudi v vec kosih) in normalno obdela naslednjo veljavno vrstico", () => {
    const z = new ZbiralnikIzpisa();
    // 1025 znakov: presledki + veljavna vrstica (brez omejitve 1024 bi razcleniVrsticoOpenLine po trim uspela!)
    const dolgaVeljavna = " ".repeat(1025 - VRSTICA_NASLOV.length) + VRSTICA_NASLOV;
    assert.equal(dolgaVeljavna.length, 1025);
    z.dodaj(dolgaVeljavna.slice(0, 500));
    z.dodaj(dolgaVeljavna.slice(500) + "\n");
    assert.equal(z.naslov(), null);

    // Naslednja veljavna vrstica (tudi tocno na meji 1024 znakov) se normalno obdela.
    const tocnoMeja = " ".repeat(1024 - "OpenLine slusa na https://127.0.0.1:8788".length) + "OpenLine slusa na https://127.0.0.1:8788";
    assert.equal(tocnoMeja.length, 1024);
    z.dodaj(`${tocnoMeja}\n${VRSTICA_ODTIS}\n`);
    assert.deepEqual(z.naslov(), { url: "https://127.0.0.1:8788", vrata: 8788 });
    assert.equal(z.odtis(), ODTIS_DVOPICJA_MALI);
  });

  it("po 65536 bajtih ne sprejme nic vec", () => {
    const z = new ZbiralnikIzpisa();
    z.dodaj(Buffer.alloc(65536, 0x41));
    z.dodaj(`\n${VRSTICA_NASLOV}\n${VRSTICA_ODTIS}\n`);
    assert.equal(z.naslov(), null);
    assert.equal(z.odtis(), null);
    assert.equal(z.pripravljen(), false);
  });

  it("nikoli ne vrze za nakljucne ali neveljavne bajte UTF-8", () => {
    const z = new ZbiralnikIzpisa();
    const neveljavenUtf8 = Buffer.from([0xff, 0xfe, 0x80, 0xc0, 0xaf, 0xed, 0xa0, 0x80, 0x0a]);
    assert.doesNotThrow(() => {
      z.dodaj(neveljavenUtf8);
      for (let i = 0; i < 20; i += 1) {
        z.dodaj(randomBytes(64));
      }
      z.dodaj(`\n${VRSTICA_NASLOV}\n${VRSTICA_ODTIS}\n`);
    });
    assert.deepEqual(z.naslov(), { url: "https://192.168.1.5:8787", vrata: 8787 });
    assert.equal(z.odtis(), ODTIS_DVOPICJA_MALI);
  });
});
