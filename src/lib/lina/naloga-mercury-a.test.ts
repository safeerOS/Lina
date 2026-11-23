/**
 * Mercury A. Razponi zasebnih naslovov za branje spletne strani podjetja (SSRF).
 * Tabela: zasebni, lokalni, rezervirani in prehodni naslovi z zasebnim IPv4 se zavrnejo, javni ostanejo dovoljeni.
 * Poleg tabele: preverba na VSEH razresenih naslovih, povezava pripeta na preverjeni naslov, vsak skok preusmeritve preverjen.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { t } from "./besedila.ts";
import { jeZasebniIp, preberiStran, type SpletOdgovor, type SpletZahteva } from "./splet.ts";

function samoNapaka(...sporocila: string[]): (e: unknown) => boolean {
  return (e) => e instanceof Error && sporocila.includes(e.message);
}

const ZASEBNI = [
  // IPv4
  "0.0.0.0", "0.1.2.3", "10.0.0.1", "127.0.0.1", "127.255.255.254",
  "100.64.0.1", "100.100.100.100", "100.127.255.254",
  "169.254.169.254", "172.16.0.1", "172.31.255.255",
  "192.0.0.1", "192.0.0.170", "192.0.2.1", "192.168.1.1",
  "198.18.0.1", "198.19.255.254", "198.51.100.7", "203.0.113.9",
  "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
  // zapisi istega naslova
  "2130706433", "0x7f.0.0.1", "0177.0.0.1", "127.1",
  // IPv6
  "::", "::1", "fe80::1", "fe80::1%eth0", "febf::1", "fc00::1", "fd12:3456::1",
  "fec0::1", "ff00::1", "ff02::1", "ff05::2",
  "::ffff:10.0.0.1", "::ffff:100.64.0.1", "::ffff:7f00:1", "::ffff:c0a8:101",
  "::127.0.0.1", "::ffff:0:10.0.0.1",
  "64:ff9b::7f00:1", "64:ff9b::10.0.0.1", "64:ff9b::a9fe:a9fe", "64:ff9b:1::1",
  "2002:7f00:1::1", "2002:0a00:0001::", "2002:c0a8:0101::1", "2002:6440:1::1", // 6to4 z 127.0.0.1, 10.0.0.1, 192.168.1.1, 100.64.0.1
  "2001:0:4136:e378:8000:63bf:80ff:fffe", // Teredo: javni streznik, odjemalec 127.0.0.1 (obrnjeno 7f00:0001 -> 80ff:fffe)
  "2001:0:7f00:1:0:0:0:0", // Teredo: streznik 127.0.0.1
  "2001:db8::1", "3fff::1", "100::1", "4000::1", "8000::1",
  // neveljavno ali nejasno
  "", "abc", "300.1.1.1", "::g",
];

const JAVNI = [
  "93.184.216.34", "8.8.8.8", "1.1.1.1", "100.63.255.255", "100.128.0.1",
  "172.15.255.255", "172.32.0.1", "192.0.1.1", "192.0.3.1", "198.17.255.255", "198.20.0.1",
  "198.51.99.1", "198.51.101.1", "203.0.112.1", "203.0.114.1", "223.255.255.254",
  "2606:4700:4700::1111", "2001:4860:4860::8888", "2a00:1450:4001::200e", "2001:1::1", "2001:200::1",
  "::ffff:93.184.216.34", "::ffff:808:808",
  "64:ff9b::808:808", "64:ff9b::93.184.216.34", // NAT64 z javnim v4
  "2002:5db8:d822::1", // 6to4 z 93.184.216.34
  "2001:0:5db8:d822:0:0:a247:27dd", // Teredo: streznik in odjemalec 93.184.216.34 (odjemalec obrnjen z XOR ffff)
  "3ffe::1", "3ffe:ffff::1", "2620:fe::fe",
];

describe("Mercury A: razponi zasebnih IP naslovov", () => {
  for (const ip of ZASEBNI) {
    it(`zavrne ${JSON.stringify(ip)}`, () => {
      assert.equal(jeZasebniIp(ip), true, ip);
    });
  }
  for (const ip of JAVNI) {
    it(`dovoli ${ip}`, () => {
      assert.equal(jeZasebniIp(ip), false, ip);
    });
  }
});

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

describe("Mercury A: preverba na vseh naslovih, pripetje in skoki", () => {
  it("en zaseben naslov med razresenimi zavrne branje, povezave sploh ni", async () => {
    let povezav = 0;
    await assert.rejects(
      preberiStran("https://les.example/", {
        razresi: async () => ["93.184.216.34", "100.64.0.5"],
        povezava: async () => {
          povezav += 1;
          return odgovor(200, { "content-type": "text/html" }, STRAN);
        },
      }),
      samoNapaka(t("spletZasebno")),
    );
    assert.equal(povezav, 0);
  });

  it("zasebni naslov na zadnjem mestu seznama zavrne enako (ni samo prvi)", async () => {
    for (const seznam of [["198.18.0.9", "93.184.216.34"], ["93.184.216.34", "2002:7f00:1::1"], ["93.184.216.34", "64:ff9b::a00:1"]]) {
      await assert.rejects(
        preberiStran("https://les.example/", {
          razresi: async () => seznam,
          povezava: async () => odgovor(200, { "content-type": "text/html" }, STRAN),
        }),
        samoNapaka(t("spletZasebno")),
      );
    }
  });

  it("povezava je pripeta na preverjeni naslov in vsak skok preusmeritve gre znova skozi razresevanje", async () => {
    const zahteve: SpletZahteva[] = [];
    const razresitve: string[] = [];
    const branje = await preberiStran("https://les.example/", {
      razresi: async (g) => {
        razresitve.push(g);
        return g === "les.example" ? ["93.184.216.34"] : ["93.184.216.35"];
      },
      povezava: async (z) => {
        zahteve.push(z);
        if (z.pot === "/") return odgovor(301, { location: "https://www.les.example/domov" }, "");
        if (z.pot === "/robots.txt") return odgovor(404, { "content-type": "text/plain" }, "");
        return odgovor(200, { "content-type": "text/html" }, STRAN);
      },
    });
    assert.ok(branje.besedilo.includes("hrasta"));
    for (const z of zahteve) assert.ok(z.ip === "93.184.216.34" || z.ip === "93.184.216.35", z.ip);
    assert.ok(razresitve.includes("www.les.example"), "skok na www se razresi sam in preveri");
    const nadaljnja = zahteve.find((z) => z.gostitelj === "www.les.example");
    assert.equal(nadaljnja?.ip, "93.184.216.35", "povezava skoka je pripeta na naslov, razresen za skok");
  });

  it("preusmeritev na gostitelja, ki se razresi v zasebni naslov, se zavrne", async () => {
    let drugiPoziv = 0;
    await assert.rejects(
      preberiStran("https://les.example/", {
        razresi: async (g) => (g === "les.example" ? ["93.184.216.34"] : ["100.64.1.1"]),
        povezava: async (z) => {
          if (z.gostitelj === "www.les.example") drugiPoziv += 1;
          if (z.pot === "/robots.txt") return odgovor(404, {}, "");
          return odgovor(302, { location: "https://www.les.example/x" }, "");
        },
      }),
      samoNapaka(t("spletZasebno")),
    );
    assert.equal(drugiPoziv, 0);
  });

  it("preusmeritev na literalni zasebni IP ali drugega gostitelja se zavrne", async () => {
    for (const cilj of ["https://100.64.0.1/", "https://[64:ff9b::7f00:1]/", "https://drug.example/"]) {
      await assert.rejects(
        preberiStran("https://les.example/", {
          razresi: async () => ["93.184.216.34"],
          povezava: async (z) => {
            if (z.pot === "/robots.txt") return odgovor(404, {}, "");
            return odgovor(302, { location: cilj }, "");
          },
        }),
        samoNapaka(t("spletTuj"), t("spletZasebno"), t("spletHttps")),
      );
    }
  });
});
