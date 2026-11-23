// Mejni preizkusi vodje za openline-zagon-cista.ts (poleg agentovih): resnicna oblika izpisa OpenLine (index.ts: »OpenLine slusa na <PUBLIC_URL>«,
// »Odtis certifikata SHA-256: <tls.fingerprintColon>« z velikimi crkami in dvopicji), razrezan izpis, nakljucni kosi in lastnost »razclenjen naslov je vedno cist«.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ZbiralnikIzpisa, razcleniVrsticoOpenLine, sestaviOkoljeOpenLine, type VhodOkolja } from "./openline-zagon-cista.ts";

const BAJTI = Array.from({ length: 32 }, (_, i) => (0x10 + i * 7) & 0xff);
const ODTIS_VELIKI = BAJTI.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
const ODTIS_MALI = BAJTI.map((b) => b.toString(16).padStart(2, "0")).join("");

const REALEN_IZPIS = [
  "OpenLine slusa na https://192.168.1.5:8787",
  `Odtis certifikata SHA-256: ${ODTIS_VELIKI}`,
  "Dohodni zvok gre na Lino (wss://127.0.0.1:8080/api/voice/stream). Zeton je v glavi, ne v naslovu.",
  "LINA_ALLOWLIST_MODE=off: Lina prevzame vse dohodne, tudi neznane. Stevilke v sili ne.",
  "Gemini je izklopljen.",
  "",
].join("\n");

const vhod = (): VhodOkolja => ({
  kljucApi: "k".repeat(43), naslov: "192.168.1.5", vrata: 8787, dataDir: "/var/tmp/izmisljena-mapa/openline",
  linaNaslov: "127.0.0.1", linaVrata: 8447, linaZeton: "z".repeat(43), linaOdtis: ODTIS_MALI, dovoljeni: { nacin: "vse", stevilke: [] },
});

test("resnicna oblika izpisa OpenLine: oba podatka razclenjena, ostale vrstice ignorirane", () => {
  assert.deepEqual(razcleniVrsticoOpenLine("OpenLine slusa na https://192.168.1.5:8787"), { vrsta: "naslov", url: "https://192.168.1.5:8787", vrata: 8787 });
  assert.deepEqual(razcleniVrsticoOpenLine(`Odtis certifikata SHA-256: ${ODTIS_VELIKI}\r`), { vrsta: "odtis", odtis: ODTIS_MALI });
  for (const vrstica of REALEN_IZPIS.split("\n").slice(2)) assert.equal(razcleniVrsticoOpenLine(vrstica), null, vrstica);
});

test("zbiralnik: cel resnicni izpis, razrezan na kose po 1..13 bajtov (tudi z \\r\\n), da isti rezultat", () => {
  for (const velikost of [1, 2, 3, 5, 7, 13, 64, 4096]) {
    for (const izpis of [REALEN_IZPIS, REALEN_IZPIS.replace(/\n/g, "\r\n")]) {
      const z = new ZbiralnikIzpisa();
      const b = Buffer.from(izpis, "utf8");
      for (let i = 0; i < b.length; i += velikost) z.dodaj(b.subarray(i, i + velikost));
      assert.equal(z.pripravljen(), true, `kosi po ${velikost}`);
      assert.deepEqual(z.naslov(), { url: "https://192.168.1.5:8787", vrata: 8787 });
      assert.equal(z.odtis(), ODTIS_MALI);
    }
  }
});

test("zbiralnik: nepopolna zadnja vrstica (brez \\n) se NE steje, dokler ni dokoncana", () => {
  const z = new ZbiralnikIzpisa();
  z.dodaj("OpenLine slusa na https://192.168.1.5:8787");
  assert.equal(z.naslov(), null);
  z.dodaj("\n");
  assert.deepEqual(z.naslov(), { url: "https://192.168.1.5:8787", vrata: 8787 });
});

test("zbiralnik: izpis, ki je ZNAN SAM po sebi kot ponarejen (npr. v sporocilu napake) ne prepise prve veljavne vrednosti", () => {
  const z = new ZbiralnikIzpisa();
  z.dodaj(REALEN_IZPIS);
  z.dodaj("OpenLine slusa na https://10.0.0.9:9999\nOdtis certifikata SHA-256: " + ODTIS_VELIKI.replace(/1/g, "2") + "\n");
  assert.deepEqual(z.naslov(), { url: "https://192.168.1.5:8787", vrata: 8787 });
  assert.equal(z.odtis(), ODTIS_MALI);
});

test("zbiralnik: nakljucni bajti nikoli ne vrzejo in ne dajo veljavnega naslova ali odtisa", () => {
  let x = 123456789;
  const nakljucno = () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x; };
  for (let k = 0; k < 300; k++) {
    const z = new ZbiralnikIzpisa();
    for (let j = 0; j < 8; j++) {
      const b = Buffer.alloc(1 + (nakljucno() % 200));
      for (let i = 0; i < b.length; i++) b[i] = nakljucno() & 0xff;
      assert.doesNotThrow(() => z.dodaj(b));
    }
    assert.equal(z.pripravljen(), false);
  }
});

test("lastnost: kar razcleniVrsticoOpenLine vrne kot naslov, je vedno cisti https://gostitelj:vrata (brez uporabnika, poti, poizvedbe)", () => {
  const deli = ["https://", "http://", "user@", "user:pw@", "192.168.1.5", "[::1]", "host.name", ":8787", ":0", ":65536", ":443", "/", "/x", "?q=1", "#h", " ", "\t", "%40", "\\"];
  let x = 987654321;
  const nakljucno = () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x; };
  let veljavnih = 0;
  for (let k = 0; k < 4000; k++) {
    let vrstica = "OpenLine slusa na ";
    const n = 1 + (nakljucno() % 6);
    for (let i = 0; i < n; i++) vrstica += deli[nakljucno() % deli.length];
    const r = razcleniVrsticoOpenLine(vrstica);
    if (!r) continue;
    veljavnih += 1;
    assert.equal(r.vrsta, "naslov");
    if (r.vrsta !== "naslov") continue;
    assert.match(r.url, /^https:\/\/[^\s@/?#\\%]+:\d{1,5}$/, vrstica);
    assert.ok(r.vrata >= 1 && r.vrata <= 65535);
    assert.ok(r.url.endsWith(`:${r.vrata}`));
  }
  assert.ok(veljavnih > 0, "nakljucni vzorec je vseboval tudi veljavne vrstice (preizkus ni prazen)");
});

test("okolje: vhod z dodatnimi polji (npr. GEMINI_API_KEY) jih NE prenese v okolje otroka", () => {
  const v = { ...vhod(), GEMINI_API_KEY: "izmisljena-skrivnost", NODE_TLS_REJECT_UNAUTHORIZED: "0", PATH: "/usr/bin" } as VhodOkolja;
  const o = sestaviOkoljeOpenLine(v);
  assert.deepEqual(Object.keys(o).sort(), [
    "DATA_DIR", "ELECTRON_RUN_AS_NODE", "HOST", "HTTP_GATEWAY_API_KEY", "LINA_ALLOWLIST_MODE", "LINA_CERT_SHA256", "LINA_STREAM_TOKEN", "LINA_STREAM_URL", "PORT", "PUBLIC_URL",
  ]);
  assert.equal(o.PUBLIC_URL, "https://192.168.1.5:8787");
  assert.equal(o.LINA_STREAM_URL, "wss://127.0.0.1:8447/api/voice/telefon");
  assert.equal(o.LINA_ALLOWLIST_MODE, "off");
  assert.equal(o.LINA_CERT_SHA256, ODTIS_MALI);
});

test("okolje: IPv6 naslova in vrata kot niz se zavrnejo (OpenLine in Lina sta v tej razlicici samo IPv4)", () => {
  assert.throws(() => sestaviOkoljeOpenLine({ ...vhod(), naslov: "::1" }), /neveljavno polje: naslov/);
  assert.throws(() => sestaviOkoljeOpenLine({ ...vhod(), linaNaslov: "[::1]" }), /neveljavno polje: linaNaslov/);
  assert.throws(() => sestaviOkoljeOpenLine({ ...vhod(), vrata: "8787" as unknown as number }), /neveljavno polje: vrata/);
  assert.throws(() => sestaviOkoljeOpenLine({ ...vhod(), dovoljeni: { nacin: "seznam", stevilke: ["__proto__"] } }), /neveljavno polje: dovoljeni/);
});

test("okolje: seznam stevilk se zdruzi z vejicami, vrstni red ohranjen, mode on", () => {
  const o = sestaviOkoljeOpenLine({ ...vhod(), dovoljeni: { nacin: "seznam", stevilke: [" +38640123456 ", "040 123 456", "+38640123456"] } });
  assert.equal(o.LINA_ALLOWLIST_MODE, "on");
  assert.equal(o.LINA_ALLOWLIST, "+38640123456,040 123 456");
});

test("zbiralnik: pripravljen je SAMO, ko sta znana naslov IN odtis (en podatek ni dovolj)", () => {
  const samoNaslov = new ZbiralnikIzpisa();
  samoNaslov.dodaj("OpenLine slusa na https://192.168.1.5:8787\n");
  assert.equal(samoNaslov.pripravljen(), false);
  assert.notEqual(samoNaslov.naslov(), null);
  assert.equal(samoNaslov.odtis(), null);

  const samoOdtis = new ZbiralnikIzpisa();
  samoOdtis.dodaj(`Odtis certifikata SHA-256: ${ODTIS_VELIKI}\n`);
  assert.equal(samoOdtis.pripravljen(), false);
  assert.equal(samoOdtis.naslov(), null);
  assert.notEqual(samoOdtis.odtis(), null);
});

test("razclen: vrata z vodilno nicljo ali nicla se zavrnejo (strogo, ne normalizirajo)", () => {
  assert.equal(razcleniVrsticoOpenLine("OpenLine slusa na https://192.168.1.5:08787"), null);
  assert.equal(razcleniVrsticoOpenLine("OpenLine slusa na https://192.168.1.5:0"), null);
  assert.equal(razcleniVrsticoOpenLine("OpenLine slusa na https://192.168.1.5:65536"), null);
  assert.equal(razcleniVrsticoOpenLine("OpenLine slusa na http://192.168.1.5:8787"), null);
  assert.equal(razcleniVrsticoOpenLine("OpenLine slusa na https://192.168.1.5:8787/pot"), null);
  assert.equal(razcleniVrsticoOpenLine("OpenLine slusa na https://uporabnik@192.168.1.5:8787"), null);
});
