/**
 * Naloga lina-strani-dovoljenja: strezniska shramba (strani-dovoljenja.json),
 * overitev lastnika, dodajanje, podvojitev, preklic, meja 200, poskodovana datoteka,
 * pravice 0600 in obvezno potrjevanje za obcutljive strani.
 * Vsi podatki so izmisljeni. Brez omrezja.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { access, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { LinaAuthError, setupOwner } from "./auth.server.ts";
import { t } from "./besedila.ts";
import {
  dovoliStran,
  odlocitevZaStran,
  preklicStran,
  seznamStrani,
  STRANI_DATOTEKA,
  STRANI_NAJVEC,
} from "./strani-dovoljenja.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-strani-dovoljenja-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));

async function novaMapa(): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  const token = await setupOwner("geslo-strani-1234", dir);
  return { dir, token };
}

describe("overitev lastnika in prazno zacetno stanje", () => {
  it("privzeti seznam je prazen (brez samodejnih dovoljenj) in branje ne ustvari datoteke", async () => {
    const { dir } = await novaMapa();
    assert.deepEqual(await seznamStrani(dir), []);
    assert.deepEqual(await odlocitevZaStran("https://primer.si", dir), {
      sme: false,
      potrebnaPotrditevZaVsakoDejanje: false,
      razlog: "ni-dovoljeno",
    });
    await assert.rejects(access(path.join(dir, STRANI_DATOTEKA)));
  });

  it("brez zetona lastnika (ali z napacnim) sta dodajanje in preklic zavrnjena", async () => {
    const { dir, token } = await novaMapa();
    for (const slabZeton of [null, "", "napacen-zeton-1234"]) {
      await assert.rejects(
        dovoliStran("https://primer.si", slabZeton, dir),
        (err: unknown) => err instanceof LinaAuthError,
      );
      await assert.rejects(
        preklicStran("https://primer.si", slabZeton, dir),
        (err: unknown) => err instanceof LinaAuthError,
      );
    }
    assert.deepEqual(await seznamStrani(dir), []);

    // Tudi ko zapis ze obstaja, preklic brez zetona ne odstrani vnosa.
    await dovoliStran("https://primer.si", token, dir);
    await assert.rejects(
      preklicStran("https://primer.si", null, dir),
      (err: unknown) => err instanceof LinaAuthError,
    );
    assert.equal((await seznamStrani(dir)).length, 1);
  });
});

describe("dodaj, podvojitev, preklic, pravice 0600 in LINA_DATA", () => {
  it("dodajanje, brez podvojitve, preklic in pravice 0600", async () => {
    const { dir, token } = await novaMapa();

    const dodan = await dovoliStran("HTTPS://Primer.SI:443", token, dir);
    assert.equal(dodan.izvor, "https://primer.si");
    assert.equal(dodan.obcutljiva, false);
    assert.ok(!Number.isNaN(Date.parse(dodan.dodano)), `veljaven ISO cas: ${dodan.dodano}`);

    // Pravice datoteke morajo biti 0600
    const st = await stat(path.join(dir, STRANI_DATOTEKA));
    assert.equal(st.mode & 0o777, 0o600, "strani-dovoljenja.json mora imeti pravice 0600");

    // Isti izvor drugic: brez podvojitve
    const ponovno = await dovoliStran("https://primer.si", token, dir);
    assert.equal(ponovno.izvor, "https://primer.si");
    assert.equal(ponovno.dodano, dodan.dodano);
    const seznamPo = await seznamStrani(dir);
    assert.equal(seznamPo.length, 1);

    assert.deepEqual(await odlocitevZaStran("https://primer.si", dir), {
      sme: true,
      potrebnaPotrditevZaVsakoDejanje: false,
      razlog: "dovoljeno",
    });

    // Preklic vrne true, ponovni preklic false
    assert.equal(await preklicStran("HTTPS://PRIMER.SI:443", token, dir), true);
    assert.equal(await preklicStran("https://primer.si", token, dir), false);
    assert.deepEqual(await seznamStrani(dir), []);
    assert.deepEqual(await odlocitevZaStran("https://primer.si", dir), {
      sme: false,
      potrebnaPotrditevZaVsakoDejanje: false,
      razlog: "ni-dovoljeno",
    });
  });

  it("deluje tudi prek process.env.LINA_DATA brez izrecnega parametra dir", async () => {
    const { dir, token } = await novaMapa();
    const prej = process.env.LINA_DATA;
    process.env.LINA_DATA = dir;
    try {
      const vpis = await dovoliStran("https://trgovina.example", token);
      assert.equal(vpis.izvor, "https://trgovina.example");
      assert.equal((await seznamStrani()).length, 1);
      assert.equal((await odlocitevZaStran("https://trgovina.example")).razlog, "dovoljeno");
      assert.equal(await preklicStran("https://trgovina.example", token), true);
      assert.deepEqual(await seznamStrani(), []);
    } finally {
      if (prej === undefined) delete process.env.LINA_DATA;
      else process.env.LINA_DATA = prej;
    }
  });

  it("zavrne neveljaven izvor z razlogom iz besedila.ts", async () => {
    const { dir, token } = await novaMapa();
    await assert.rejects(
      dovoliStran("http://primer.si", token, dir),
      (err: unknown) => err instanceof Error && err.message === t("straniIzvorShema"),
    );
    await assert.rejects(
      dovoliStran("https://primer.si/pot", token, dir),
      (err: unknown) => err instanceof Error && err.message === t("straniIzvorBrezPoti"),
    );
    await assert.rejects(
      dovoliStran("https://*.primer.si", token, dir),
      (err: unknown) => err instanceof Error && err.message === t("straniIzvorNadomestni"),
    );
  });
});

describe("meja 200 vnosov", () => {
  it("dovoli do 200 razlicnih izvorov, 201. zavrne z razlogom; podvojitev na meji uspe", async () => {
    const { dir, token } = await novaMapa();
    assert.equal(STRANI_NAJVEC, 200);
    for (let i = 1; i <= 200; i += 1) {
      await dovoliStran(`https://stran-${i}.example`, token, dir);
    }
    assert.equal((await seznamStrani(dir)).length, 200);

    // Isti izvor na meji ne podvoji in ne vrze napake
    const obstojeci = await dovoliStran("https://stran-1.example", token, dir);
    assert.equal(obstojeci.izvor, "https://stran-1.example");
    assert.equal((await seznamStrani(dir)).length, 200);

    // 201. nov izvor zavrne z razlogom
    await assert.rejects(
      dovoliStran("https://stran-201.example", token, dir),
      (err: unknown) => err instanceof Error && err.message === t("straniMeja"),
    );
    assert.equal((await seznamStrani(dir)).length, 200);

    // Po preklicu enega se spet sprosti mesto
    assert.equal(await preklicStran("https://stran-1.example", token, dir), true);
    await dovoliStran("https://stran-201.example", token, dir);
    assert.equal((await seznamStrani(dir)).length, 200);
  });
});

describe("poskodovana datoteka", () => {
  it("neveljavna vsebina ne podre branja, vrne prazen seznam in NE prepise datoteke dokler uporabnik nic ne spremeni", async () => {
    const pokvarjene = [
      "{ pokvarjen json",
      "[]",
      '"samo-niz"',
      "123",
      "null",
      JSON.stringify({ strani: "ni-seznam" }),
      JSON.stringify({ strani: [null, 42, { izvor: 123, dodano: 456, obcutljiva: "da" }, { izvor: "http://neveljavna.example", dodano: "2026-11-21T00:00:00.000Z", obcutljiva: false }] }),
    ];

    for (const vsebina of pokvarjene) {
      const { dir, token } = await novaMapa();
      const pot = path.join(dir, STRANI_DATOTEKA);
      await writeFile(pot, vsebina, "utf8");

      assert.deepEqual(await seznamStrani(dir), [], vsebina);
      assert.deepEqual(await odlocitevZaStran("https://primer.si", dir), {
        sme: false,
        potrebnaPotrditevZaVsakoDejanje: false,
        razlog: "ni-dovoljeno",
      });
      // Datoteka ostane nedotaknjena dokler uporabnik nic ne spremeni
      assert.equal(await readFile(pot, "utf8"), vsebina, `datoteka se ne sme prepisati pri branju: ${vsebina}`);

      // Preklic neobstojecega prav tako ne prepise poskodovane datoteke
      assert.equal(await preklicStran("https://primer.si", token, dir), false);
      assert.equal(await readFile(pot, "utf8"), vsebina);

      // Ko uporabnik doda stran, se shrani veljavna datoteka s pravicami 0600
      const dodano = await dovoliStran("https://primer.si", token, dir);
      assert.equal(dodano.izvor, "https://primer.si");
      assert.equal((await seznamStrani(dir)).length, 1);
      assert.equal((await stat(pot)).mode & 0o777, 0o600);
    }
  });
});

describe("obcutljiva stran po dodajanju", () => {
  it("obcutljiva stran ostane z obveznim potrjevanjem za vsako dejanje tudi po dodajanju ali rocnem posegu v datoteko", async () => {
    const { dir, token } = await novaMapa();
    const vpis = await dovoliStran("https://nlb.si", token, dir);
    assert.equal(vpis.izvor, "https://nlb.si");
    assert.equal(vpis.obcutljiva, true);

    assert.deepEqual(await odlocitevZaStran("https://nlb.si", dir), {
      sme: true,
      potrebnaPotrditevZaVsakoDejanje: true,
      razlog: "obcutljiva",
    });

    // Tudi ce kdo rocno spremeni obcutljiva -> false v datoteki, preverba ostane obvezna
    const pot = path.join(dir, STRANI_DATOTEKA);
    await writeFile(
      pot,
      JSON.stringify({ strani: [{ izvor: "https://nlb.si", dodano: vpis.dodano, obcutljiva: false }] }),
      "utf8",
    );
    const seznam = await seznamStrani(dir);
    assert.equal(seznam.length, 1);
    assert.equal(seznam[0].obcutljiva, true);
    assert.deepEqual(await odlocitevZaStran("https://nlb.si", dir), {
      sme: true,
      potrebnaPotrditevZaVsakoDejanje: true,
      razlog: "obcutljiva",
    });
  });
});
