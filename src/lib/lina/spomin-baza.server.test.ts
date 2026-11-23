/**
 * Preizkusi modula spomin-baza.server.ts (SQLite + FTS5, node:sqlite).
 * Vsi podatki v preizkusih so SINTETICNI.
 */
import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "node:test";
import {
  SPOMIN_BAZA_DATOTEKA,
  SpominBazaNeveljavna,
  SpominBazaPokvarjena,
  isci,
  izbrisiVse,
  jeSpominBazeVklopljen,
  nastaviSpominBaze,
  ubeziPoizvedboFts,
  zapisiObrat,
  zapriSpominBazo,
  zapriVseSpominBaze,
} from "./spomin-baza.server.ts";

const temps: string[] = [];

afterEach(async () => {
  zapriVseSpominBaze();
  await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function novaMapa(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-spomin-baza-"));
  temps.push(dir);
  return dir;
}

describe("spomin-baza: transakcija zapisa obrata", () => {
  it("ob napaki sredi obrata ne ostane polovicen zapis v obrati ali obrati_fts", async () => {
    const dir = await novaMapa();
    await nastaviSpominBaze(true, dir);

    const zacetni = await zapisiObrat(
      {
        seja: "seja-osnova",
        vloga: "klicatelj",
        besedilo: "Zacetno povprasevanje za jedilno mizo iz hrasta.",
        cas: 1_700_000_000_000,
      },
      { dir },
    );
    assert.equal(zacetni.zapisano, true);

    zapriSpominBazo(dir);
    const dbSetup = new DatabaseSync(path.join(dir, SPOMIN_BAZA_DATOTEKA));
    try {
      dbSetup.exec(
        "CREATE TRIGGER test_napaka_seje BEFORE INSERT ON seje " +
          "WHEN NEW.seja = 'seja-napaka' " +
          "BEGIN SELECT RAISE(ABORT, 'simulirana-napaka'); END;",
      );
    } finally {
      dbSetup.close();
    }

    await assert.rejects(() =>
      zapisiObrat(
        {
          seja: "seja-napaka",
          vloga: "klicatelj",
          besedilo: "Polovicen zapis ksilofon ne sme ostati v bazi.",
          cas: 1_700_000_010_000,
        },
        { dir },
      ),
    );

    const najdeno = await isci("ksilofon", 10, { dir });
    assert.deepEqual(najdeno, []);

    zapriSpominBazo(dir);
    const dbCheck = new DatabaseSync(path.join(dir, SPOMIN_BAZA_DATOTEKA));
    try {
      const nObrati = Number(
        dbCheck.prepare("SELECT COUNT(*) AS n FROM obrati WHERE seja = ?").get("seja-napaka")?.n ??
          -1,
      );
      const nFts = Number(
        dbCheck
          .prepare("SELECT COUNT(*) AS n FROM obrati_fts WHERE obrati_fts MATCH ?")
          .get('"ksilofon"*')?.n ?? -1,
      );
      const nSeje = Number(
        dbCheck.prepare("SELECT COUNT(*) AS n FROM seje WHERE seja = ?").get("seja-napaka")?.n ??
          -1,
      );
      const nOsnova = Number(
        dbCheck.prepare("SELECT COUNT(*) AS n FROM obrati WHERE seja = ?").get("seja-osnova")?.n ??
          -1,
      );
      assert.equal(nObrati, 0);
      assert.equal(nFts, 0);
      assert.equal(nSeje, 0);
      assert.equal(nOsnova, 1);
    } finally {
      dbCheck.close();
    }
  });
});

describe("spomin-baza: FTS5 iskanje z diakritiko, predpono in ubezanjem", () => {
  it("iskanje brez stresic najde zapis s stresicami (č, š, ž) in obratno ter po predponi", async () => {
    const dir = await novaMapa();
    await nastaviSpominBaze(true, dir);

    await zapisiObrat(
      {
        seja: "seja-1",
        vloga: "klicatelj",
        besedilo: "Zanima me čokoladna potica, štruklji in domače žito.",
        cas: 1_700_000_001_000,
      },
      { dir },
    );
    await zapisiObrat(
      {
        seja: "seja-2",
        vloga: "lina",
        besedilo: "Pecemo cesnjeve struklje in zitarice po narocilu.",
        cas: 1_700_000_002_000,
      },
      { dir },
    );

    // Brez stresic najde zapis s stresicami (tudi predpona)
    const brezStresic = await isci("cokolad struklj zito", 10, { dir });
    assert.equal(brezStresic.length, 1);
    assert.equal(brezStresic[0].seja, "seja-1");

    // S stresicami najde zapis brez stresic (tudi predpona)
    const sStresicami = await isci("češnjev štruklj žitar", 10, { dir });
    assert.equal(sStresicami.length, 1);
    assert.equal(sStresicami[0].seja, "seja-2");

    // Skupna predpona ujame oba zapisa
    const oba = await isci("štruklj", 10, { dir });
    assert.equal(oba.length, 2);
  });

  it('operatorji FTS v poizvedbi (", *, NEAR, OR, NOT, :) ne spremenijo pomena in ne vrzejo napake', async () => {
    const dir = await novaMapa();
    await nastaviSpominBaze(true, dir);

    await zapisiObrat(
      {
        seja: "s-hrast",
        vloga: "klicatelj",
        besedilo: "Masivna jedilna miza iz hrasta po meri.",
        cas: 1_700_000_010_000,
      },
      { dir },
    );
    await zapisiObrat(
      {
        seja: "s-bukev",
        vloga: "klicatelj",
        besedilo: "Garderobna omara iz bukve z drsnimi vrati.",
        cas: 1_700_000_020_000,
      },
      { dir },
    );

    // OR ne deluje kot FTS operator (samo hrast ali samo bukev ne ustreza)
    assert.deepEqual(await isci("hrast OR bukev", 10, { dir }), []);

    // NEAR ne deluje kot FTS operator
    assert.deepEqual(await isci("NEAR(hrast miza, 3)", 10, { dir }), []);
    assert.deepEqual(await isci("hrast NEAR miza", 10, { dir }), []);

    // NOT ne deluje kot FTS operator
    assert.deepEqual(await isci("hrast NOT bukev", 10, { dir }), []);

    // Nezaprti narekovaji, zvezdice in stolpec:vrednost ne vrzejo napake
    const zNarekovajem = await isci('"hrast', 10, { dir });
    assert.equal(zNarekovajem.length, 1);
    assert.equal(zNarekovajem[0].seja, "s-hrast");

    assert.deepEqual(await isci("*", 10, { dir }), []);
    assert.deepEqual(await isci('""" *** () : ^', 10, { dir }), []);
    const zZvezdico = await isci("hrast *", 10, { dir });
    assert.equal(zZvezdico.length, 1);
    assert.equal(zZvezdico[0].seja, "s-hrast");

    // Neobstojec stolpec v poizvedbi ne vrze "no such column"
    assert.deepEqual(await isci("neobstojec:hrast", 10, { dir }), []);

    // Cista funkcija ubeziPoizvedboFts ovije besede v narekovaje s predpono
    assert.equal(ubeziPoizvedboFts('hrast" OR * bukev'), '"hrast"* "OR"* "bukev"*');
    assert.equal(ubeziPoizvedboFts('"""***'), "");
  });
});

describe("spomin-baza: brez skrivnosti in brez vsebine v dnevniku", () => {
  it("skrivnosti (geslo, PIN, API kljuc, zeton) se ne shranijo v bazo", async () => {
    const dir = await novaMapa();
    await nastaviSpominBaze(true, dir);

    const skrivnosti = [
      "Geslo za wifi je Zima2026x",
      "PIN koda 4821",
      "Moj kljuc je sk-projektniTestniKljuc1234567890",
      "Zeton ghp_1234567890abcdefghijklmnop",
      "-----BEGIN PRIVATE KEY----- vsebina",
    ];
    for (const besedilo of skrivnosti) {
      const r = await zapisiObrat({ seja: "seja-tajno", vloga: "uporabnik", besedilo }, { dir });
      assert.deepEqual(r, { zapisano: false, razlog: "skrivnost" });
    }

    assert.deepEqual(await isci("Zima2026x", 10, { dir }), []);
    assert.deepEqual(await isci("4821", 10, { dir }), []);
    assert.deepEqual(await isci("PRIVATE", 10, { dir }), []);
  });

  it("dnevnik vsebuje samo stevila, nikoli vsebine zapisov ali poizvedbe", async () => {
    const dir = await novaMapa();
    await nastaviSpominBaze(true, dir);

    const zapisiDnevnika: string[] = [];
    const origInfo = console.info;
    const origWarn = console.warn;
    const origError = console.error;
    console.info = (...a: unknown[]) => void zapisiDnevnika.push(a.join(" "));
    console.warn = (...a: unknown[]) => void zapisiDnevnika.push(a.join(" "));
    console.error = (...a: unknown[]) => void zapisiDnevnika.push(a.join(" "));

    const posebnaBeseda = "ZelenaOrhidejaTest";
    const posebnaSeja = "SejniIdSinteticni";
    const skrivnoGeslo = "Geslo za racun je SkrivnostTest9988";

    try {
      await zapisiObrat(
        { seja: posebnaSeja, vloga: "klicatelj", besedilo: `Narocilo za ${posebnaBeseda}.` },
        { dir },
      );
      await zapisiObrat(
        { seja: posebnaSeja, vloga: "klicatelj", besedilo: skrivnoGeslo },
        { dir },
      );
      const zadetki = await isci(posebnaBeseda, 5, { dir });
      assert.equal(zadetki.length, 1);
    } finally {
      console.info = origInfo;
      console.warn = origWarn;
      console.error = origError;
    }

    const celDnevnik = zapisiDnevnika.join("\n");
    assert.ok(zapisiDnevnika.length >= 2);
    assert.equal(celDnevnik.includes(posebnaBeseda), false);
    assert.equal(celDnevnik.includes(posebnaSeja), false);
    assert.equal(celDnevnik.includes("SkrivnostTest9988"), false);
    assert.match(celDnevnik, /zapisano=1/);
    assert.match(celDnevnik, /velikost_b=\d+/);
    assert.match(celDnevnik, /zadetkov=1/);
  });
});

describe("spomin-baza: pravice 0600, simbolne povezave in pokvarjena datoteka", () => {
  it("datoteka, -wal in -shm imajo pravice 0600 in ohlapne pravice se poostrjo", async (t) => {
    if (process.platform === "win32") {
      t.skip("POSIX pravice 0600 ne veljajo na Windows");
      return;
    }
    const dir = await novaMapa();
    await nastaviSpominBaze(true, dir);

    const r1 = await zapisiObrat(
      { seja: "s-pravice", vloga: "klicatelj", besedilo: "Preverba pravic baze." },
      { dir },
    );
    assert.equal(r1.zapisano, true);

    const glavna = path.join(dir, SPOMIN_BAZA_DATOTEKA);
    const wal = `${glavna}-wal`;
    const shm = `${glavna}-shm`;

    assert.equal((await lstat(glavna)).mode & 0o777, 0o600);
    assert.equal((await lstat(wal)).mode & 0o777, 0o600);
    assert.equal((await lstat(shm)).mode & 0o777, 0o600);

    // Namerno razrahljamo pravice in preverimo, da naslednji zapis vse tri povrne na 0600
    await chmod(glavna, 0o644);
    await chmod(wal, 0o644);
    await chmod(shm, 0o644);

    const r2 = await zapisiObrat(
      { seja: "s-pravice", vloga: "lina", besedilo: "Drugi zapis poostri pravice." },
      { dir },
    );
    assert.equal(r2.zapisano, true);

    assert.equal((await lstat(glavna)).mode & 0o777, 0o600);
    assert.equal((await lstat(wal)).mode & 0o777, 0o600);
    assert.equal((await lstat(shm)).mode & 0o777, 0o600);
  });

  it("simbolna povezava na spomin.sqlite, -wal ali -shm ni sledena in tarca ostane nedotaknjena", async (t) => {
    if (process.platform === "win32") {
      t.skip("Simbolne povezave brez skrbniskih pravic na Windows niso vedno podprte");
      return;
    }
    const dir = await novaMapa();
    await nastaviSpominBaze(true, dir);

    const tarca = path.join(dir, "tarca-nedotaknjena.txt");
    await writeFile(tarca, "NEDOTAKNJENA-VSEBINA", "utf8");
    await chmod(tarca, 0o644);

    // 1. Simbolna povezava na glavno datoteko
    const glavna = path.join(dir, SPOMIN_BAZA_DATOTEKA);
    await symlink(tarca, glavna);
    await assert.rejects(
      () => zapisiObrat({ seja: "s-sym", vloga: "klicatelj", besedilo: "Poskus zapisa." }, { dir }),
      SpominBazaNeveljavna,
    );
    await assert.rejects(() => isci("Poskus", 5, { dir }), SpominBazaNeveljavna);
    assert.equal(await readFile(tarca, "utf8"), "NEDOTAKNJENA-VSEBINA");
    assert.equal((await lstat(tarca)).mode & 0o777, 0o644);
    await unlink(glavna);

    // 2. Ustvarimo pravo bazo, nato podtaknemo simbolno povezavo na -wal in -shm
    const ok = await zapisiObrat(
      { seja: "s-sym", vloga: "klicatelj", besedilo: "Veljaven zapis pred povezavo." },
      { dir },
    );
    assert.equal(ok.zapisano, true);
    zapriSpominBazo(dir);

    for (const pripona of ["-wal", "-shm"]) {
      const pot = `${glavna}${pripona}`;
      await rm(pot, { force: true });
      await symlink(tarca, pot);
      await assert.rejects(
        () => zapisiObrat({ seja: "s-sym", vloga: "lina", besedilo: "Ne sme slediti." }, { dir }),
        SpominBazaNeveljavna,
      );
      await assert.rejects(() => isci("Veljaven", 5, { dir }), SpominBazaNeveljavna);
      assert.equal(await readFile(tarca, "utf8"), "NEDOTAKNJENA-VSEBINA");
      assert.equal((await lstat(tarca)).mode & 0o777, 0o644);
      await unlink(pot);
    }
  });

  it("mapa na mestu spomin.sqlite se zavrne", async () => {
    const dir = await novaMapa();
    await nastaviSpominBaze(true, dir);
    await mkdir(path.join(dir, SPOMIN_BAZA_DATOTEKA));

    await assert.rejects(
      () => zapisiObrat({ seja: "s-mapa", vloga: "klicatelj", besedilo: "Test mape." }, { dir }),
      SpominBazaNeveljavna,
    );
    await assert.rejects(() => isci("Test", 5, { dir }), SpominBazaNeveljavna);
  });

  it("pokvarjena datoteka (napacna glava ali pokvarjena stran) se zavrne in se ne prepise tiho", async () => {
    const dir = await novaMapa();
    await nastaviSpominBaze(true, dir);

    const dbPath = path.join(dir, SPOMIN_BAZA_DATOTEKA);
    const smeti = Buffer.from("TO-NI-SQLITE-POKVARJENA-VSEBINA-987654321", "utf8");
    await writeFile(dbPath, smeti);

    await assert.rejects(
      () => zapisiObrat({ seja: "s-pokv", vloga: "klicatelj", besedilo: "Zapis v pokvarjeno." }, { dir }),
      SpominBazaPokvarjena,
    );
    await assert.rejects(() => isci("Zapis", 5, { dir }), SpominBazaPokvarjena);
    assert.deepEqual(await readFile(dbPath), smeti);

    // Zamenjamo s pravo bazo, nato pokvarimo strani po 16-bajtni glavi
    await rm(dbPath, { force: true });
    await zapisiObrat(
      { seja: "s-ok", vloga: "klicatelj", besedilo: "Veljaven zapis pred poskodbo." },
      { dir },
    );
    zapriSpominBazo(dir);

    const bajti = await readFile(dbPath);
    assert.ok(bajti.length >= 4096);
    const pokvarjeno = Buffer.from(bajti);
    pokvarjeno.fill(0xff, 100, Math.min(pokvarjeno.length, 4096));
    await writeFile(dbPath, pokvarjeno);

    await assert.rejects(() => isci("Veljaven", 5, { dir }), SpominBazaPokvarjena);
    await assert.rejects(
      () => zapisiObrat({ seja: "s-ok", vloga: "lina", besedilo: "Novi zapis." }, { dir }),
      SpominBazaPokvarjena,
    );
    assert.deepEqual(await readFile(dbPath), pokvarjeno);
  });

  it("0-bajtna spomin.sqlite + zapisiObrat: ustvari bazo z auto_vacuum=INCREMENTAL in WAL, isci najde zapis", async () => {
    const dir = await novaMapa();
    await nastaviSpominBaze(true, dir);

    const dbPath = path.join(dir, SPOMIN_BAZA_DATOTEKA);
    await writeFile(dbPath, Buffer.alloc(0));
    if (process.platform !== "win32") {
      await chmod(dbPath, 0o644);
    }

    const r = await zapisiObrat(
      {
        seja: "s-prazna",
        vloga: "klicatelj",
        besedilo: "Zapis v prvotno prazno datoteko marjetica.",
        cas: 1_700_000_050_000,
      },
      { dir },
    );
    assert.equal(r.zapisano, true);

    const najdeno = await isci("marjetica", 5, { dir });
    assert.equal(najdeno.length, 1);
    assert.equal(najdeno[0].seja, "s-prazna");

    if (process.platform !== "win32") {
      assert.equal((await lstat(dbPath)).mode & 0o777, 0o600);
      assert.equal((await lstat(`${dbPath}-wal`)).mode & 0o777, 0o600);
      assert.equal((await lstat(`${dbPath}-shm`)).mode & 0o777, 0o600);
    }

    zapriSpominBazo(dir);
    const dbCheck = new DatabaseSync(dbPath);
    try {
      const avRow = dbCheck.prepare("PRAGMA auto_vacuum").get() as Record<string, unknown> | undefined;
      assert.equal(Number(avRow?.auto_vacuum), 2, "auto_vacuum mora biti INCREMENTAL (2)");
      const jmRow = dbCheck.prepare("PRAGMA journal_mode").get() as Record<string, unknown> | undefined;
      assert.equal(String(jmRow?.journal_mode ?? "").toLowerCase(), "wal");
    } finally {
      dbCheck.close();
    }
  });

  it("0-bajtna spomin.sqlite + isci: vrne [] brez napake in pusti datoteko 0 bajtov", async () => {
    const dir = await novaMapa();
    await nastaviSpominBaze(true, dir);

    const dbPath = path.join(dir, SPOMIN_BAZA_DATOTEKA);
    await writeFile(dbPath, Buffer.alloc(0));

    const najdeno = await isci("marjetica", 5, { dir });
    assert.deepEqual(najdeno, []);

    const st = await lstat(dbPath);
    assert.equal(st.size, 0);
    if (process.platform !== "win32") {
      assert.equal(st.mode & 0o777, 0o600);
    }
    await assert.rejects(() => lstat(`${dbPath}-wal`), { code: "ENOENT" });
    await assert.rejects(() => lstat(`${dbPath}-shm`), { code: "ENOENT" });
  });

  it("5-bajtna spomin.sqlite se zavrne kot SpominBazaPokvarjena in vsebina ostane nespremenjena", async () => {
    const dir = await novaMapa();
    await nastaviSpominBaze(true, dir);

    const dbPath = path.join(dir, SPOMIN_BAZA_DATOTEKA);
    const petBajtov = Buffer.from("SQLit", "ascii");
    assert.equal(petBajtov.length, 5);
    await writeFile(dbPath, petBajtov);

    await assert.rejects(
      () => zapisiObrat({ seja: "s-pet", vloga: "klicatelj", besedilo: "Ne sme prepisati." }, { dir }),
      SpominBazaPokvarjena,
    );
    await assert.rejects(() => isci("prepisati", 5, { dir }), SpominBazaPokvarjena);
    assert.deepEqual(await readFile(dbPath), petBajtov);
    await assert.rejects(() => lstat(`${dbPath}-wal`), { code: "ENOENT" });
    await assert.rejects(() => lstat(`${dbPath}-shm`), { code: "ENOENT" });
  });
});

describe("spomin-baza: meja velikosti", () => {
  it("nad mejo velikosti brise najstarejse obrate in ohrani najnovejse", async () => {
    const dir = await novaMapa();
    await nastaviSpominBaze(true, dir);

    const mejaB = 96 * 1024;
    const polnilo = "sinteticno besedilo za preverbo meje velikosti baze ".repeat(48);
    let skupajIzbrisanih = 0;

    for (let i = 1; i <= 80; i++) {
      const oznaka = `obrat${String(i).padStart(4, "0")}`;
      const r = await zapisiObrat(
        {
          seja: `seja-${i}`,
          vloga: i % 2 === 0 ? "lina" : "klicatelj",
          besedilo: `${oznaka} ${polnilo}`,
          cas: 1_700_000_000_000 + i * 1000,
        },
        { dir, mejaVelikostiB: mejaB },
      );
      assert.equal(r.zapisano, true);
      if (r.zapisano) skupajIzbrisanih += r.izbrisanihStarih;
    }

    assert.ok(skupajIzbrisanih > 0, "pricakovan izbris najstarejsih obratov");

    // Najstarejsi obrati so izbrisani
    assert.deepEqual(await isci("obrat0001", 5, { dir }), []);
    assert.deepEqual(await isci("obrat0002", 5, { dir }), []);
    assert.deepEqual(await isci("obrat0003", 5, { dir }), []);

    // Najnovejsi obrati so ohranjeni
    const zadnji = await isci("obrat0080", 5, { dir });
    assert.equal(zadnji.length, 1);
    assert.equal(zadnji[0].seja, "seja-80");

    const predzadnji = await isci("obrat0079", 5, { dir });
    assert.equal(predzadnji.length, 1);
    assert.equal(predzadnji[0].seja, "seja-79");

    // Skupna velikost glavne datoteke in WAL je znotraj meje
    const dbPath = path.join(dir, SPOMIN_BAZA_DATOTEKA);
    const stMain = await lstat(dbPath);
    const stWal = await lstat(`${dbPath}-wal`).catch(() => null);
    const skupajB = stMain.size + (stWal?.isFile() ? stWal.size : 0);
    assert.ok(skupajB <= mejaB, `velikost ${skupajB} B presega mejo ${mejaB} B`);
  });
});

describe("spomin-baza: privzeto vklopljeno (lastnik 22. 11. 2026), izrecni izklop in izbrisi vse", () => {
  it("privzeto je vklopljeno; izrecni izklop: zapisiObrat in isci ne ustvarita nobene datoteke", async () => {
    const prazna = await novaMapa();
    // Lastnik 22. 11. 2026: »More biti vklopljeno da si lina zapomni pogovore« (prej privzeto izklopljeno).
    assert.equal(await jeSpominBazeVklopljen(prazna), true);
    const zapis = await zapisiObrat({ seja: "s-on", vloga: "uporabnik", besedilo: "Privzeto se zapise." }, { dir: prazna });
    assert.equal(zapis.zapisano, true);
    assert.equal((await isci("zapise", 10, { dir: prazna })).length, 1);

    const dir = await novaMapa();
    // Izrecni izklop ne ustvari baze
    await nastaviSpominBaze(false, dir);
    assert.equal(await jeSpominBazeVklopljen(dir), false);
    const r2 = await zapisiObrat(
      { seja: "s-off", vloga: "lina", besedilo: "Se vedno izklopljeno." },
      { dir },
    );
    assert.deepEqual(r2, { zapisano: false, razlog: "izklopljeno" });
    const datoteke = await readdir(dir);
    assert.equal(datoteke.includes(SPOMIN_BAZA_DATOTEKA), false);
    assert.equal(datoteke.includes(`${SPOMIN_BAZA_DATOTEKA}-wal`), false);
    assert.equal(datoteke.includes(`${SPOMIN_BAZA_DATOTEKA}-shm`), false);
  });

  it("izbrisiVse izbrise spomin.sqlite, -wal in -shm (odprta baza in osirotele datoteke)", async () => {
    const dir = await novaMapa();
    await nastaviSpominBaze(true, dir);

    const r = await zapisiObrat(
      { seja: "s-brisi", vloga: "klicatelj", besedilo: "Zapis pred popolnim izbrisom." },
      { dir },
    );
    assert.equal(r.zapisano, true);

    const glavna = path.join(dir, SPOMIN_BAZA_DATOTEKA);
    const wal = `${glavna}-wal`;
    const shm = `${glavna}-shm`;

    // Vse tri datoteke obstajajo med odprto povezavo WAL
    assert.equal((await lstat(glavna)).isFile(), true);
    assert.equal((await lstat(wal)).isFile(), true);
    assert.equal((await lstat(shm)).isFile(), true);

    await izbrisiVse({ dir });

    for (const pot of [glavna, wal, shm]) {
      await assert.rejects(() => lstat(pot), { code: "ENOENT" });
    }
    assert.deepEqual(await isci("izbrisom", 10, { dir }), []);

    // Osirotele datoteke (tudi pri izklopljenem stikalu) se vse tri izbrisejo
    await nastaviSpominBaze(false, dir);
    await writeFile(glavna, "osirotela-glavna");
    await writeFile(wal, "osiroteli-wal");
    await writeFile(shm, "osiroteli-shm");

    const izid = await izbrisiVse({ dir });
    assert.equal(izid.izbrisanihDatotek, 3);
    for (const pot of [glavna, wal, shm]) {
      await assert.rejects(() => lstat(pot), { code: "ENOENT" });
    }

    // Ponovni klic na prazni mapi ne vrze napake
    const prazno = await izbrisiVse({ dir });
    assert.equal(prazno.izbrisanihDatotek, 0);

    // Po izbrisu ponoven vklop in zapis delata normalno
    await nastaviSpominBaze(true, dir);
    const nov = await zapisiObrat(
      { seja: "s-nov", vloga: "lina", besedilo: "Sveza baza po izbrisu." },
      { dir },
    );
    assert.equal(nov.zapisano, true);
    assert.equal((await isci("sveza", 5, { dir })).length, 1);
  });
});
