/**
 * Strezniski preizkusi za Klici.txt (klici-datoteka.server.ts in vgradnja v service.server.ts).
 * Vsi podatki (imena, stevilke, zetoni) so izmisljeni. Brez omrezja, LINA_LLM=0.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { pocakajDnevnikGlasu, pocakajGlas, ustaviCiscenjeZvoka } from "./glas.server.ts";
import { DATOTEKA_KLICEV, idKlica, zapisiKlicVDatoteko } from "./klici-datoteka.server.ts";
import { defaultPravila } from "./pravila.server.ts";
import type { ModelRazumevanja } from "./razumevanje.server.ts";
import { preberiKlic, recordCaller, zakljuciKlic } from "./service.server.ts";
import { writeJson } from "./store.server.ts";
import type { CallSession } from "./types.ts";

process.env.LINA_LLM = "0";
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-klici-datoteka-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const dirs: string[] = [];
const zaklenjene: string[] = [];

afterEach(async () => {
  delete process.env.TWILIO_AUTH_TOKEN;
  while (zaklenjene.length) {
    const p = zaklenjene.pop() as string;
    await chmod(p, 0o700).catch(() => undefined);
  }
  while (dirs.length) {
    const dir = dirs.pop() as string;
    await pocakajGlas(dir);
    await pocakajDnevnikGlasu(dir);
    ustaviCiscenjeZvoka(dir);
  }
});

const BREZ_MODELA: ModelRazumevanja = async () => null;

async function novaMapa(pravila: Record<string, unknown> = {}): Promise<string> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  dirs.push(dir);
  await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi", ...pravila });
  return dir;
}

function vzorcnik(sid: string, deli: Partial<CallSession> = {}): CallSession {
  return {
    callSid: sid,
    from: "+38640000111",
    startedAt: "2026-11-21T10:00:00.000Z",
    updatedAt: "2026-11-21T10:01:30.000Z",
    status: "zakljucen",
    nacin: "osebna",
    transcript: [
      { role: "lina", text: "Tukaj Lina, pomočnica z umetno inteligenco.", at: "2026-11-21T10:00:00.000Z" },
      { role: "stranka", text: "Tukaj Jana Primer, pridem jutri.", at: "2026-11-21T10:00:15.000Z" },
    ],
    order: {
      customerName: "Jana Primer",
      phone: "+38640000111",
      productName: null,
      materialName: null,
      requestedProduct: null,
      requestedMaterial: null,
      quantity: null,
      notes: "",
      tajnica: { sporocilo: "Pridem jutri ob devetih.", razlog: "", nujno: false, nujnostZnana: false },
      confirmed: false,
      violations: [],
    },
    ...deli,
  };
}

describe("klici-datoteka.server: pisanje, posodabljanje, dovoljenja in varnost", () => {
  it("ob koncu klica nastane Klici.txt v mapi zapiskov z dovoljenji 0600", async () => {
    const dir = await novaMapa({ nacinKlica: "osebna", imeLastnika: "Ana" });
    const pot = path.join(dir, "zapiski", DATOTEKA_KLICEV);

    const r = await recordCaller({ callSid: "CA-KLIC-1", from: "+38640000201", hangup: true }, dir);
    assert.equal(r.call.status, "zakljucen");

    const vsebina = await readFile(pot, "utf8");
    const vrstice = vsebina.trimEnd().split("\n");
    assert.equal(vrstice.length, 1);
    assert.match(vrstice[0], new RegExp(`\\| id:${idKlica("CA-KLIC-1")}$`));
    assert.equal((await lstat(pot)).mode & 0o777, 0o600);
  });

  it("upošteva uporabnikovo izbrano mapo zapiskov (mapaZapiskov)", async () => {
    const dir = await novaMapa();
    const izbrana = path.join(dir, "moji-zapiski");
    await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi", mapaZapiskov: izbrana });

    const ok = await zapisiKlicVDatoteko(vzorcnik("CA-IZBRANA-1"), dir);
    assert.equal(ok, true);
    const vsebina = await readFile(path.join(izbrana, DATOTEKA_KLICEV), "utf8");
    assert.match(vsebina, /Jana Primer \| 1:30 \| Pridem jutri ob devetih\. \| id:/);
  });

  it("drugi zapis istega klica ne podvoji vrstice; dva klica = dve vrstici", async () => {
    const dir = await novaMapa();
    const c1 = vzorcnik("CA-DUP-1");
    assert.equal(await zapisiKlicVDatoteko(c1, dir), true);

    const c1Pos = vzorcnik("CA-DUP-1", {
      updatedAt: "2026-11-21T10:02:00.000Z",
      order: {
        ...c1.order,
        tajnica: { sporocilo: "Posodobljeno sporočilo.", razlog: "", nujno: false, nujnostZnana: false },
      },
    });
    assert.equal(await zapisiKlicVDatoteko(c1Pos, dir), true);

    const c2 = vzorcnik("CA-DUP-2", {
      order: {
        ...c1.order,
        customerName: "Marko Primer",
        tajnica: { sporocilo: "Drugi klic.", razlog: "", nujno: false, nujnostZnana: false },
      },
    });
    assert.equal(await zapisiKlicVDatoteko(c2, dir), true);

    const pot = path.join(dir, "zapiski", DATOTEKA_KLICEV);
    const vrstice = (await readFile(pot, "utf8")).trimEnd().split("\n");
    assert.equal(vrstice.length, 2);
    assert.match(vrstice[0], /Posodobljeno sporočilo\./);
    assert.match(vrstice[0], /2:00/);
    assert.match(vrstice[1], /Marko Primer/);
    assert.match(vrstice[1], /Drugi klic\./);
  });

  it("vzporedni zapisi za isto mapo se serializirajo brez izgube vrstic in brez zacasnih datotek", async () => {
    const dir = await novaMapa();
    const klici = Array.from({ length: 8 }, (_, i) =>
      vzorcnik(`CA-VZPOREDNO-${i}`, {
        order: {
          ...vzorcnik(`CA-VZPOREDNO-${i}`).order,
          customerName: `Klicatelj ${i}`,
          tajnica: { sporocilo: `Sporočilo ${i}`, razlog: "", nujno: false, nujnostZnana: false },
        },
      }),
    );
    const izidi = await Promise.all(klici.map((c) => zapisiKlicVDatoteko(c, dir)));
    assert.ok(izidi.every(Boolean));

    const mapa = path.join(dir, "zapiski");
    const datoteke = await readdir(mapa);
    assert.deepEqual(datoteke, [DATOTEKA_KLICEV]);
    const vrstice = (await readFile(path.join(mapa, DATOTEKA_KLICEV), "utf8")).trimEnd().split("\n");
    assert.equal(vrstice.length, 8);
  });

  it("nepisljiva mapa ne vrze in zapisekOdKlica konca; napaka Klici.txt ne prepreci zapiska", async () => {
    const dir1 = await novaMapa();
    // Primer 1: mapa zapiskov je datoteka (nepisljiva mapa) -> zapisiKlicVDatoteko vrne false, klic se zakljuci.
    await writeFile(path.join(dir1, "zapiski"), "ni mapa");
    assert.equal(await zapisiKlicVDatoteko(vzorcnik("CA-NEPIS-1"), dir1), false);
    const r1 = await recordCaller({ callSid: "CA-NEPIS-2", from: "+38640000202", hangup: true }, dir1);
    assert.equal(r1.call.status, "zakljucen");
    assert.ok(await preberiKlic("CA-NEPIS-2", dir1));

    // Primer 2: mapa zapiskov obstaja z dovoljenjem 0500 (branje brez pisanja).
    const dir2 = await novaMapa();
    const zapiski2 = path.join(dir2, "zapiski");
    await mkdir(zapiski2, { recursive: true });
    await chmod(zapiski2, 0o500);
    zaklenjene.push(zapiski2);
    assert.equal(await zapisiKlicVDatoteko(vzorcnik("CA-NEPIS-3"), dir2), false);
    const r2 = await recordCaller({ callSid: "CA-NEPIS-4", from: "+38640000203", hangup: true }, dir2);
    assert.equal(r2.call.status, "zakljucen");

    // Primer 3: Klici.txt je imenik (napaka pri Klici.txt), mapa zapiskov pa je pisljiva -> .md zapisek vseeno nastane.
    const dir3 = await novaMapa();
    await mkdir(path.join(dir3, "zapiski", DATOTEKA_KLICEV), { recursive: true });
    const r3 = await recordCaller({ callSid: "CA-NEPIS-5", from: "+38640000204", hangup: true }, dir3);
    assert.equal(r3.call.status, "zakljucen");
    assert.ok(r3.call.zapisek?.endsWith(".md"), "zapisek mora nastati tudi ob napaki Klici.txt");
  });

  it("simbolna povezava Klici.txt ne prepise tuje datoteke", async () => {
    const dir = await novaMapa();
    const mapa = path.join(dir, "zapiski");
    await mkdir(mapa, { recursive: true });
    const tuja = path.join(dir, "tuja.txt");
    await writeFile(tuja, "NEDOTAKNJENO");
    await symlink(tuja, path.join(mapa, DATOTEKA_KLICEV));

    assert.equal(await zapisiKlicVDatoteko(vzorcnik("CA-SYMLINK-1"), dir), false);
    assert.equal(await readFile(tuja, "utf8"), "NEDOTAKNJENO");
  });

  it("vaja klica ne ustvari Klici.txt", async () => {
    const dir = await novaMapa({ nacinKlica: "osebna", imeLastnika: "Ana" });
    const r = await recordCaller({ callSid: "CA-VAJA-1", from: "+38640000205", hangup: true }, dir, undefined, { vaja: true });
    assert.equal(r.call.status, "zakljucen");
    const datoteke = await readdir(path.join(dir, "zapiski")).catch(() => []);
    assert.deepEqual(datoteke, []);
  });

  it("osebna tajnica: v Klici.txt ni telefonske stevilke osebne tajnice niti kljucev/zetonov", async () => {
    const tajnaStevilkaLastnika = "+38640999888";
    const tajniZeton = "SK_IZMISLJEN_ZETON_99887766";
    const skrivniSid = "CA-SKRIVNI-SID-ZETON-123456";
    process.env.TWILIO_AUTH_TOKEN = tajniZeton;

    const dir = await novaMapa({
      nacinKlica: "osebna",
      imeLastnika: "Ana",
      preusmeritev: tajnaStevilkaLastnika,
    });
    const m = { razumevanje: BREZ_MODELA, osebnaRokMs: 200 };
    // Klic 1: klicatelj z imenom (stevilke ni povedal) -> v Klici.txt je ime, ne njegova ali lastnikova stevilka.
    await recordCaller({ callSid: skrivniSid, from: "+38641777666", text: "" }, dir, undefined, m);
    await recordCaller({ callSid: skrivniSid, from: "+38641777666", text: "Sem Peter Primer, prosim sporočite da pridem v torek." }, dir, undefined, m);
    const konec = await zakljuciKlic(skrivniSid, dir);
    assert.equal(konec?.status, "zakljucen");

    // Klic 2: anonimen klic brez povedane stevilke -> nobene telefonske stevilke v vrstici.
    const sidAnon = "CA-ANON-777";
    await recordCaller({ callSid: sidAnon, from: "anonymous", text: "" }, dir, undefined, m);
    await zakljuciKlic(sidAnon, dir);

    const vsebina = await readFile(path.join(dir, "zapiski", DATOTEKA_KLICEV), "utf8");
    const vrstice = vsebina.trimEnd().split("\n");
    assert.equal(vrstice.length, 2);
    assert.ok(!vsebina.includes(tajnaStevilkaLastnika), "brez lastnikove stevilke");
    assert.ok(!vsebina.includes("+38641777666"), "z imenom klicatelja se njegova stevilka ne zapise v Klici.txt");
    assert.ok(!vsebina.includes(tajniZeton), "brez zetona iz okolja");
    assert.ok(!vsebina.includes(skrivniSid), "brez surovega CallSid (samo 8-znakovni sha256)");
    assert.match(vrstice[0], new RegExp(`\\| id:${idKlica(skrivniSid)}$`));
    assert.match(vrstice[1], /Neznan klicatelj/);
  });
});
