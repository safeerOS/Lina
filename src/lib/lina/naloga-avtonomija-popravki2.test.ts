/**
 * Popravki po 2. slepem pregledu avtonomije Line (lastnik 15. 11. 2026): N1 (geslo kot pogoj se ne sme obiti z setupOwner), N2 (zastarela
 * kljucavnica), N3 (kazalo nujnih klicev ob skoku ure), N4 (retroaktivni SMS ob dodajanju sprozilca), N5 (pokvarjena datoteka = ustavljeno),
 * N7 (premijske predpone), N15 (pravice mape podatkov). Vsak preizkus je napisan tako, da brez popravka pade (dokazi: dokazi/).
 * Brez omrezja: Twilio je nadomescen. Samo izmisljene stevilke in imena brez pravih oseb.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { odpriLokalnoSejo, ownerExists, setupOwner } from "./auth.server.ts";
import { tikAvtonomije, nastaviZahtevoAvtonomije } from "./avtonomija-izvedba.server.ts";
import { ukazAvtonomije } from "./avtonomija.server.ts";
import { DATOTEKA_KLJUCAVNICE, DATOTEKA_STANJA, jeUstavljeno, jeUstavljenoNujno, preberiDnevnikZapisov, preberiStanje, spremeniStanje } from "./avtonomija-stanje.server.ts";
import { jeNedovoljenaPreusmeritev, jePremiumAliKratka } from "./preusmeritev.ts";
import { nastaviZahtevoNujnih, pocakajNujne, pozabiObvescene } from "./nujni.server.ts";
import { readJsonFile, writeJson } from "./store.server.ts";
import { povezi as poveziTwilio, type ZahtevaTwilio } from "./twilio-racun.server.ts";

process.env.LINA_LLM = "0";
process.env.LINA_AVTONOMIJA = "1";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-avtonomija-popravki2-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const temps: string[] = [];

const PREJEMNIK = "+38640000001";
const PREDLOGA = "Nujen klic, poglejte zapisnik.";
const DAN = 86_400_000;

type Zahtevek = { url: string; method: string; body: string };
let zahtevki: Zahtevek[] = [];
const lazniTwilio: ZahtevaTwilio = async (url, init) => {
  zahtevki.push({ url, method: init.method, body: init.body ?? "" });
  if (url.includes("/IncomingPhoneNumbers.json")) return { status: 200, json: { incoming_phone_numbers: [{ phone_number: "+38615550123" }] } };
  if (url.endsWith("/Messages.json")) return { status: 201, json: { sid: `SM${"c".repeat(32)}` } };
  return { status: 200, json: {} };
};
const sms = (): Zahtevek[] => zahtevki.filter((z) => z.url.endsWith("/Messages.json"));

beforeEach(() => {
  zahtevki = [];
  nastaviZahtevoAvtonomije(lazniTwilio);
  nastaviZahtevoNujnih(lazniTwilio);
  pozabiObvescene();
});

afterEach(async () => {
  nastaviZahtevoAvtonomije(null);
  nastaviZahtevoNujnih(null);
  process.env.LINA_AVTONOMIJA = "1";
  await pocakajNujne();
  while (temps.length) {
    const dir = temps.pop();
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

async function novaMapa(): Promise<string> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  temps.push(dir);
  return dir;
}

async function pripravi(): Promise<{ dir: string; token: string }> {
  const dir = await novaMapa();
  const token = await setupOwner("geslo-test-1234", dir);
  await poveziTwilio(token, { sid: `AC${"a".repeat(32)}`, kljucSid: `SK${"b".repeat(32)}`, skrivnost: "skrivnost-preizkusa-1234567890" }, dir, lazniTwilio);
  zahtevki = [];
  return { dir, token };
}

function datum(dniNaprej: number): string {
  const d = new Date(Date.now() + dniNaprej * DAN);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const pravilo = (nacin: "izklopljeno" | "potrditev" | "samodejno", meja = 5) => ({ ukaz: "pravilo", vrsta: "sms-predloga", nacin, veljaDo: nacin === "izklopljeno" ? null : datum(2), najvecNaDan: meja, okno: null });

/** Prejemnik + predloga (+ po zelji sprozilec) + pravilo sms-predloga (samodejno). */
async function nastaviSms(dir: string, token: string, zSprozilcem = true): Promise<void> {
  await ukazAvtonomije(token, { ukaz: "prejemnik-dodaj", ime: "Ana", stevilka: PREJEMNIK }, dir);
  await ukazAvtonomije(token, { ukaz: "predloga-dodaj", besedilo: PREDLOGA }, dir);
  if (zSprozilcem) await dodajSprozilec(dir, token);
  await ukazAvtonomije(token, pravilo("samodejno", 10), dir);
}

async function dodajSprozilec(dir: string, token: string): Promise<void> {
  const raw = (await preberiStanje(dir)).stanje;
  assert.ok(raw);
  await ukazAvtonomije(token, { ukaz: "povezava-dodaj", predlogaId: raw.predloge[0].id, prejemnikId: raw.prejemniki[0].id }, dir);
}

async function zapisiKlice(dir: string, klici: Array<{ sid: string; cas: number }>): Promise<void> {
  const knjiga = (await readJsonFile<Record<string, unknown>>(dir, "calls.json")) ?? {};
  for (const k of klici) {
    knjiga[k.sid] = {
      callSid: k.sid,
      from: "+38640000002",
      startedAt: new Date(k.cas - 1000).toISOString(),
      updatedAt: new Date(k.cas).toISOString(),
      status: "zakljucen",
      order: { customerName: "Ana Preizkus", tajnica: { nujno: true } },
    };
  }
  await writeJson(dir, "calls.json", knjiga);
}

const napakaKoda = (koda: string) => (e: unknown): boolean => (e as { koda?: string }).koda === koda;

describe("popravki po 2. slepem pregledu avtonomije", { concurrency: 1 }, () => {
  it("N1: lokalni program brez gesla in brez glave Origin ne more nastaviti gesla, zato ne vklopi avtonomije", async () => {
    const dir = await novaMapa();
    // zahteva, kot jo poslje program brez brskalnika: vticnica 127.0.0.1, Host localhost, brez Origin in Sec-Fetch-Site
    const program = { address: "127.0.0.1", forwardedFor: null, forwarded: null, host: "localhost:3000", origin: null, fetchSite: null };
    await assert.rejects(setupOwner("geslo-napadalca-1234", dir, program), /brskalnik|izvor|Origin/i);
    assert.equal(await ownerExists(dir), false, "geslo ni nastavljeno");
    // brez gesla ostane lokalna seja, vendar vklop ostane zavrnjen (N2 1. pregleda)
    const seja = await odpriLokalnoSejo({ ...program }, dir);
    assert.ok(seja, "lokalna seja brez gesla");
    for (const ukaz of [pravilo("samodejno"), { ukaz: "prejemnik-dodaj", ime: "Ana", stevilka: PREJEMNIK }, { ukaz: "predloga-dodaj", besedilo: PREDLOGA }]) {
      await assert.rejects(ukazAvtonomije(seja, ukaz, dir), napakaKoda("geslo"));
    }
  });

  it("N1: brskalnik z Origin lokalnega naslova nastavi geslo (nadzor), tuj Origin ali tuj Sec-Fetch-Site pa ne", async () => {
    const brskalnik = { address: "127.0.0.1", forwardedFor: null, forwarded: null, host: "localhost:3000", origin: "http://localhost:3000", fetchSite: "same-origin" };
    const dir = await novaMapa();
    await assert.rejects(setupOwner("geslo-napadalca-1234", dir, { ...brskalnik, origin: "http://napadalec.primer" }), /izvor|Origin|Host/i);
    await assert.rejects(setupOwner("geslo-napadalca-1234", dir, { ...brskalnik, fetchSite: "cross-site" }), /izvor|Origin|Host/i);
    assert.equal(await ownerExists(dir), false);
    const token = await setupOwner("geslo-lastnika-1234", dir, brskalnik);
    assert.equal(await ownerExists(dir), true);
    const s = await ukazAvtonomije(token, pravilo("samodejno"), dir);
    assert.equal(s.pravila["sms-predloga"].nacin, "samodejno");
    // ob ze nastavljenem geslu ni nove seje (nadzor, ze prej)
    await assert.rejects(setupOwner("drugo-geslo-1234", dir, brskalnik), /že nastavljeno/);
  });

  it("N2: 8 procesov z zastarelo kljucavnico: noben zapis ni izgubljen (20 tekov)", { timeout: 240_000 }, async () => {
    const modul = new URL("./avtonomija-stanje.server.ts", import.meta.url).href;
    const koda = [
      "const { spremeniStanje } = await import(process.env.MODUL);",
      "while (Date.now() < Number(process.env.KDAJ)) { /* skupni zagon */ }",
      "for (let i = 0; i < 15; i++) await spremeniStanje(process.env.MAPA, (s) => { s.poraba.vrste['sms-predloga'] = (s.poraba.vrste['sms-predloga'] ?? 0) + 1; });",
      "console.log('KONEC');",
    ].join("\n");
    const izgube: number[] = [];
    for (let tek = 0; tek < 20; tek++) {
      const dir = await novaMapa();
      const kljucavnica = path.join(dir, DATOTEKA_KLJUCAVNICE);
      writeFileSync(kljucavnica, "mrtvi-proces.0000", { mode: 0o600 });
      const stara = new Date(Date.now() - 120_000);
      utimesSync(kljucavnica, stara, stara);
      const kdaj = String(Date.now() + 1500);
      const otroci = Array.from({ length: 8 }, (_, i) =>
        new Promise<string>((res) => {
          let izhod = "";
          const env = { ...process.env, MODUL: modul, KDAJ: kdaj, MAPA: dir, ID: `p${i}` };
          const p = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", koda], { env, stdio: ["ignore", "pipe", "ignore"] });
          p.stdout.on("data", (d) => {
            izhod += d;
          });
          p.on("exit", () => res(izhod));
        }),
      );
      const izhodi = await Promise.all(otroci);
      assert.equal(izhodi.filter((o) => o.includes("KONEC")).length, 8, `tek ${tek}: vsi otroci morajo koncati`);
      const stanje = (await preberiStanje(dir)).stanje;
      izgube.push(120 - (stanje?.poraba.vrste["sms-predloga"] ?? 0));
    }
    assert.deepEqual(izgube.filter((x) => x !== 0), [], `izgubljeni zapisi po tekih: ${izgube.join(",")}`);
  });

  it("N3: ura skoci naprej med »Ustavi vse« in se nato popravi: kazalo se vrne, nujni klic po »Nadaljuj« sprozi SMS, v dnevniku je koda", async () => {
    const { dir, token } = await pripravi();
    await nastaviSms(dir, token);
    const t = Date.now();
    await ukazAvtonomije(token, { ukaz: "ustavi" }, dir);
    await tikAvtonomije(dir, new Date(t + 3_600_000)); // ura skoci za 1 h
    await tikAvtonomije(dir, new Date(t + 60_000)); // ura popravljena
    await ukazAvtonomije(token, { ukaz: "nadaljuj" }, dir, new Date(t + 90_000));
    await zapisiKlice(dir, [{ sid: "CA-U1", cas: t + 5 * 60_000 }]);
    await tikAvtonomije(dir, new Date(t + 6 * 60_000));
    assert.equal(sms().length, 1, "klic po popravku ure ni preskocen");
    const kode = (await preberiDnevnikZapisov(dir)).map((z) => z.razlog);
    assert.ok(kode.includes("kazalo-ura"), `v dnevniku manjka koda kazalo-ura: ${kode.join(",")}`);
  });

  it("N3: kazalo, ki je v prihodnosti tudi brez ustavitve (ura popravljena nazaj), ne preskoci nujnih klicev", async () => {
    const { dir, token } = await pripravi();
    await nastaviSms(dir, token);
    const t = Date.now();
    await spremeniStanje(dir, (s) => {
      s.kazalec.nujniCas = t + 3_600_000;
      s.kazalec.nujniHash = "f".repeat(16);
    });
    await zapisiKlice(dir, [{ sid: "CA-U2", cas: t + 5 * 60_000 }]);
    await tikAvtonomije(dir, new Date(t + 6 * 60_000));
    assert.equal(sms().length, 1, "klic ni tiho preskocen");
  });

  it("N4: nujni klic, ki se konca, ko sprozilca se ni, ob kasnejsem dodajanju sprozilca ne sprozi SMS za nazaj", async () => {
    const { dir, token } = await pripravi();
    await nastaviSms(dir, token, false);
    const t = Date.now();
    await zapisiKlice(dir, [{ sid: "CA-R1", cas: t + 1000 }]);
    await tikAvtonomije(dir, new Date(t + 60_000));
    await dodajSprozilec(dir, token);
    await tikAvtonomije(dir, new Date(t + 90_000));
    assert.equal(sms().length, 0, "stari klic ne sprozi SMS");
    // nadzor: klic po dodanem sprozilcu sprozi natanko en SMS
    await zapisiKlice(dir, [{ sid: "CA-R2", cas: t + 120_000 }]);
    await tikAvtonomije(dir, new Date(t + 150_000));
    assert.equal(sms().length, 1);
  });

  it("N4: klic, ki se konca tik pred dodajanjem sprozilca (brez tika vmes), ne sprozi SMS za nazaj", async () => {
    const { dir, token } = await pripravi();
    await nastaviSms(dir, token, false);
    await zapisiKlice(dir, [{ sid: "CA-R3", cas: Date.now() }]);
    await dodajSprozilec(dir, token);
    await tikAvtonomije(dir, new Date(Date.now() + 60_000));
    assert.equal(sms().length, 0);
  });

  it("N5: pokvarjena datoteka avtonomije ustavi tudi nujno obvestilo in prevezavo (fail-closed)", async () => {
    for (const vsebina of ["{pokvarjeno", "null"]) {
      const { dir } = await pripravi();
      writeFileSync(path.join(dir, DATOTEKA_STANJA), vsebina);
      assert.equal((await preberiStanje(dir)).pokvarjeno, true, vsebina);
      assert.equal(await jeUstavljeno(dir), true);
      assert.equal(await jeUstavljenoNujno(dir), true, `nujno mora biti ustavljeno za ${vsebina}`);
    }
  });

  it("N5: ukaz »Ustavi« deluje tudi na pokvarjeni datoteki in stanje ostane ustavljeno", async () => {
    const { dir, token } = await pripravi();
    await nastaviSms(dir, token);
    writeFileSync(path.join(dir, DATOTEKA_STANJA), "{ to ni json");
    const s = await ukazAvtonomije(token, { ukaz: "ustavi" }, dir);
    assert.equal(s.ustavljeno, true);
    assert.equal((await preberiStanje(dir)).pokvarjeno, false, "datoteka je spet veljavna");
    assert.equal(await jeUstavljenoNujno(dir), true);
    assert.equal(await jeUstavljeno(dir), true);
  });

  it("N7: predpona »3« ali »38« ne odpre slovenskih 080/089/090; dodatne premijske smeri ostanejo zaprte", () => {
    for (const dodatne of ["3", "38", "386", "3,1"]) {
      for (const st of ["+38690123456", "+38689123456", "+38680123456"]) assert.equal(jeNedovoljenaPreusmeritev(st, dodatne), true, `${st} z ${dodatne}`);
    }
    for (const st of ["+447012345678", "+448412345678", "+445612345678", "+18765551234", "+18095551234", "+12645551234", "+439301234567", "+41900123456", "+41901123456", "+33899123456", "+34803123456", "+3856412345678", "+4913712345678"]) {
      assert.equal(jePremiumAliKratka(st, "44,1,43,41,33,34,385,49"), true, st);
    }
    // nadzor: navadna slovenska in britanska geografska (z dovoljeno predpono) ostaneta dovoljeni
    assert.equal(jeNedovoljenaPreusmeritev("+38640123456", ""), false);
    assert.equal(jeNedovoljenaPreusmeritev("+442071234567", "44"), false);
  });

  it("N15: mapa podatkov se ustvari brez pravic za druge uporabnike", async () => {
    const stara = process.umask(0o022);
    try {
      const dir = path.join(await novaMapa(), "podatki", "lina");
      await writeJson(dir, "preizkus.json", { a: 1 });
      assert.equal(statSync(dir).mode & 0o077, 0, `mapa ima pravice ${(statSync(dir).mode & 0o777).toString(8)}`);
      mkdirSync(path.join(dir, "x"), { recursive: true });
    } finally {
      process.umask(stara);
    }
  });
});
