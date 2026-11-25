/**
 * Modul ucenje-lh (AGPL, prirejeno po LearnHarness): cista logika enote, licencne oznake, brez omrezja, edini vhod in zastavica
 * gradnje za izpust. Merilo naloge s pogovorom je v naloga-ucenje-lh.test.ts.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  INTERVALI_DNI,
  cisto,
  jeKonec,
  jeNameraSestave,
  jeNameraUre,
  najdiEnoto,
  oceniRezerva,
  poMerjenju,
  poPreverbi,
  razberiKorake,
  razberiOceno,
  sestaviEnoto,
  sredina,
  zacetniNapredek,
  zapadliKoraki,
} from "./ucenje-lh/enota.ts";
// @ts-expect-error - .mjs brez tipov
import { VHOD_UCENJA_LH, aliasUcenjaLH } from "../../../scripts/ucenje-lh-zastavica.mjs";

const TU = path.dirname(fileURLToPath(import.meta.url));
const KOREN = path.resolve(TU, "../../..");
const MODUL = path.join(TU, "ucenje-lh");
const NAVODILO = "Nauči se postopka kontrola tiska na majice:\n1. Preveri, da je majica suha.\n2) Primerjaj barvo z vzorcem.\n- Preveri robove.";

describe("ucenje-lh: enota (cista logika)", () => {
  it("koraki iz ostevilcenega navodila in alinej; naslov brez ukaza", () => {
    const r = razberiKorake(NAVODILO);
    assert.deepEqual(r.koraki, ["Preveri, da je majica suha.", "Primerjaj barvo z vzorcem.", "Preveri robove."]);
    assert.equal(r.naslov, "kontrola tiska na majice");
  });

  it("namere odloca koda iz besedila: sestava rabi vsaj 2 koraka", () => {
    assert.equal(jeNameraSestave(NAVODILO), true);
    assert.equal(jeNameraSestave("Nauči se postopka kontrole."), false);
    assert.equal(jeNameraSestave("1. a\n2. b"), false, "brez namere ni sestave");
    assert.equal(jeNameraUre("Preveri me iz kontrole tiska"), true);
    assert.equal(jeNameraUre("Preverimo menjavo"), false);
    assert.equal(jeKonec("konec"), true);
    assert.equal(jeKonec(" Stop! "), true);
    assert.equal(jeKonec("Konec tiska je pri robu."), false, "odgovor, ki se zacne s »konec«, ni izhod");
    assert.equal(jeKonec("Na koncu zapisem"), false);
  });

  it("cisto: brez nevidnih in smernih znakov ter oznak [[ ]]", () => {
    assert.equal(cisto("a\u202eb [[uci: x]] c\u200b", 100), "a b uci: x c");
  });

  it("koraki so lastnikove besede; model da samo preverbe in samo ob enakem stevilu korakov", () => {
    const model = JSON.stringify({ naslov: "Kontrola", koraki: [1, 2, 3].map((i) => ({ razlaga: `r${i}`, vprasanje: `v${i}?`, bistvo: [`b${i}`] })) });
    const e = sestaviEnoto(NAVODILO, model, "id-1", new Date(0))!;
    assert.deepEqual(e.koraki.map((k) => k.besedilo), razberiKorake(NAVODILO).koraki);
    assert.deepEqual(e.koraki.map((k) => k.vprasanje), ["v1?", "v2?", "v3?"]);
    const zdruzil = JSON.stringify({ naslov: "X", koraki: [{ vprasanje: "eno?" }] });
    const e2 = sestaviEnoto(NAVODILO, zdruzil, "id-2", new Date(0))!;
    assert.equal(e2.koraki.length, 3);
    assert.match(e2.koraki[0]!.vprasanje, /1\. koraku/);
    assert.equal(sestaviEnoto(NAVODILO, "ni json", "id-3", new Date(0))!.koraki.length, 3, "brez modela deluje");
  });

  it("merjenje meje: dvojisko iskanje najde prvi korak brez dokaza", () => {
    // ucenec zna korake 0..2 od 7 (meja = 3)
    const zna = (i: number) => i < 3;
    let lo = 0;
    let hi = 7;
    let vprasanj = 0;
    for (;;) {
      const p = poMerjenju(lo, hi, zna(sredina(lo, hi)));
      vprasanj++;
      lo = p.lo;
      hi = p.hi;
      if (p.konec) break;
    }
    assert.equal(lo, 3);
    assert.ok(vprasanj <= 3, `najvec log2(8)=3 vprasanja, bilo ${vprasanj}`);
  });

  it("ocena: model JSON ali rezerva po bistvu; »ne vem« ni razumevanje", () => {
    assert.deepEqual(razberiOceno('```json\n{"razume": true, "manjka": ""}\n```'), { razume: true, manjka: "" });
    assert.equal(razberiOceno('{"razume": "da"}'), null);
    assert.equal(oceniRezerva("Primerjam z vzorcem pod dnevno svetlobo", ["vzorec", "dnevna"]).razume, true);
    assert.equal(oceniRezerva("ne vem, vzorec dnevna", ["vzorec", "dnevna"]).razume, false);
  });

  it("ponavljanje: skatle 1/3/7/14/30, zgresek nazaj na 0; zapadli najsibkejsi najprej", () => {
    const zdaj = new Date("2026-11-25T10:00:00Z");
    let n = zacetniNapredek();
    for (let i = 0; i < 6; i++) n = poPreverbi(n, true, zdaj);
    assert.equal(n.skatla, INTERVALI_DNI.length);
    assert.equal(Date.parse(n.naslednjic!) - zdaj.getTime(), 30 * 86_400_000);
    n = poPreverbi(n, false, zdaj);
    assert.equal(n.skatla, 0);
    const e = sestaviEnoto(NAVODILO, null, "id-4", zdaj)!;
    e.napredek = [poPreverbi(poPreverbi(zacetniNapredek(), true, zdaj), true, zdaj), poPreverbi(zacetniNapredek(), true, zdaj), zacetniNapredek()];
    assert.deepEqual(zapadliKoraki(e, zdaj), [2]);
    assert.deepEqual(zapadliKoraki(e, new Date(zdaj.getTime() + 2 * 86_400_000)), [2, 1]);
  });

  it("najdiEnoto po naslovu (koreni besed)", () => {
    const a = sestaviEnoto(NAVODILO, null, "id-a", new Date(0))!;
    const b = sestaviEnoto("Nauči se postopka menjava barve na stroju:\n1. a\n2. b", null, "id-b", new Date(0))!;
    assert.equal(najdiEnoto([a, b], "preveri me iz kontrole tiska")?.id, "id-a");
    assert.equal(najdiEnoto([a, b], "ponoviva menjavo barve")?.id, "id-b");
    assert.equal(najdiEnoto([a, b], "nauči me kuhati"), null);
  });
});

describe("ucenje-lh: licenca, izvor, brez omrezja, izpust pri gradnji", () => {
  const datoteke = readdirSync(MODUL).filter((f) => f.endsWith(".ts"));

  it("LICENSE (AGPL-3.0), README z avtorjem in NOTICE v korenu", () => {
    assert.match(readFileSync(path.join(MODUL, "LICENSE"), "utf8"), /GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3/);
    const readme = readFileSync(path.join(MODUL, "README.md"), "utf8");
    assert.match(readme, /Amos Blomqvist/);
    assert.match(readme, /069a6a1/);
    const notice = readFileSync(path.join(KOREN, "NOTICE"), "utf8");
    assert.match(notice, /src\/lib\/lina\/ucenje-lh\//);
    assert.match(notice, /LearnHarness/);
    assert.match(notice, /Affero/);
  });

  it("vsaka datoteka modula ima izvor, AGPL in »spremenil Safeer«", () => {
    assert.ok(datoteke.length >= 4, datoteke.join(","));
    for (const f of datoteke) {
      const glava = readFileSync(path.join(MODUL, f), "utf8").slice(0, 1500);
      assert.match(glava, /LearnHarness/, f);
      assert.match(glava, /AGPL-3\.0/, f);
      assert.match(glava, /[Ss]premenil Safeer/, f);
    }
  });

  it("modul nima poti v omrezje (B9) in ne zaganja procesov", () => {
    for (const f of datoteke) {
      const koda = readFileSync(path.join(MODUL, f), "utf8");
      assert.doesNotMatch(koda, /\bfetch\s*\(|https?:\/\/(?!github\.com\/amosblomqvist)|wss?:\/\/|node:(net|http|https|tls|dgram|child_process)|providers\.ts|tavily|brave|exa\.ai|firecrawl|deepgram|jina/i, f);
    }
  });

  it("edini vhod v modul je ucenje-lh-vrata.server.ts (en specifikator)", () => {
    const zadetki: string[] = [];
    const preglej = (d: string) => {
      for (const ime of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, ime.name);
        if (ime.isDirectory()) {
          if (p !== MODUL && ime.name !== "node_modules") preglej(p);
        } else if (/\.(ts|tsx|mjs|js)$/.test(ime.name) && !ime.name.endsWith(".test.ts")) {
          for (const v of readFileSync(p, "utf8").split("\n")) if (/["']\.{1,2}\/(?:lib\/lina\/)?ucenje-lh\//.test(v) || /@\/lib\/lina\/ucenje-lh\//.test(v)) zadetki.push(`${path.relative(KOREN, p)}: ${v.trim()}`);
        }
      }
    };
    preglej(path.join(KOREN, "src"));
    assert.equal(zadetki.length, 1, zadetki.join("\n"));
    assert.match(zadetki[0]!, /^src\/lib\/lina\/ucenje-lh-vrata\.server\.ts: .*import\("\.\/ucenje-lh\/vstop\.server\.ts"\)/);
    assert.ok(VHOD_UCENJA_LH.test("./ucenje-lh/vstop.server.ts"));
  });

  it("zastavica gradnje: LINA_BREZ_UCENJA_LH=1 preslika vhod v nadomestek (ki obstaja in je null); vite.config jo uporablja", async () => {
    assert.deepEqual(aliasUcenjaLH({}, KOREN), []);
    const a = aliasUcenjaLH({ LINA_BREZ_UCENJA_LH: "1" }, KOREN) as Array<{ find: RegExp; replacement: string }>;
    assert.equal(a.length, 1);
    assert.ok(existsSync(a[0]!.replacement));
    assert.ok(!a[0]!.replacement.includes(`${path.sep}ucenje-lh${path.sep}`), "nadomestek je zunaj AGPL mape");
    assert.equal((await import(a[0]!.replacement)).ucenjeLH, null);
    const vite = readFileSync(path.join(KOREN, "vite.config.ts"), "utf8");
    assert.match(vite, /aliasUcenjaLH\(process\.env/);
  });
});
