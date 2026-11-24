/**
 * Preizkusi za tocko 3 (Headroom -> reverzibilno CCR stiskanje velikih izhodov orodij: JSON, dnevniki, porocila agentov).
 * Vkljucuje meritev prihranka znakov na pravih primerih iz tega repozitorija. Brez omrezja, brez spremembe providers/keys/llm.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";
import {
  CCR_MAPA,
  izluciPriklicIzvirnika,
  jeStiskanjeVklopljeno,
  lokalnaShramba,
  nastaviStiskanje,
  pomnilniskaShramba,
  prikliciIzvirnik,
  stisniIzhod,
  zaznajVrstoIzhoda,
} from "./stiskanje-izhodov.ts";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function novaMapa(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-stiskanje-"));
  temps.push(dir);
  return dir;
}

describe("stiskanje-izhodov (Headroom CCR): stiskanje, meritev in reverzibilni priklic", () => {
  it("JSON: stisne velik seznam, ohrani shemo in anomalijo ter 100 % obnovi izvirnik po kljucu", async () => {
    const dir = await novaMapa();
    const zapisi = Array.from({ length: 80 }, (_, i) => ({
      id: i + 1,
      storitev: "lina-preizkus",
      status: i === 42 ? 500 : 200,
      ok: i !== 42,
      sporocilo: i === 42 ? "ERROR: povezava prekinjena na obratu 42" : `Obrat ${i + 1} uspesno obdelan brez napak`,
      trajanjeMs: 12 + (i % 7),
    }));
    const izvirnik = JSON.stringify(zapisi, null, 2);
    assert.equal(zaznajVrstoIzhoda(izvirnik), "json");

    const r = await stisniIzhod(izvirnik, { dir });
    assert.equal(r.stisnjeno, true);
    assert.equal(r.vrsta, "json");
    assert.equal(r.shranjenIzvirnik, true);
    assert.ok(r.kljuc);
    assert.ok(r.prihranekOdstotek >= 70, `pricakovan >=70 % prihranek na JSON, dobil ${r.prihranekOdstotek} %`);
    assert.match(r.besedilo, /obratu 42/, "anomalija mora ostati vidna v povzetku");
    assert.match(r.besedilo, /\[\[priklic-izvirnika: [a-f0-9]{16}\]\]/);

    // Reverzibilnost: exact byte-for-byte obnova po kljucu iz lokalne CCR shrambe (0600).
    const obnovljen = await prikliciIzvirnik(r.kljuc, { dir });
    assert.equal(obnovljen, izvirnik);
    const st = await stat(path.join(dir, CCR_MAPA, `${r.kljuc}.txt`));
    assert.equal(st.mode & 0o777, 0o600);

    // Iskanje znotraj izvirnika na zahtevo.
    const vrsticaNapake = await prikliciIzvirnik(r.kljuc, { dir, isci: "obratu 42" });
    assert.ok(vrsticaNapake && vrsticaNapake.includes("obratu 42"));
  });

  it("dnevnik: zdruzi ponovljene vrstice, ohrani napake in povzetek ter obnovi izvirnik", async () => {
    const shramba = pomnilniskaShramba();
    const vrstice = [
      "TAP version 13",
      ...Array.from({ length: 40 }, () => "2026-11-24T03:00:00Z INFO cakam na naslednji korak v vrsti"),
      "2026-11-24T03:00:12Z ERROR test spomin-baza je padel: pricakovano 2, dobljeno 1",
      ...Array.from({ length: 30 }, () => "2026-11-24T03:00:13Z INFO zakljucujem ciscenje zacasne mape"),
      "# tests 42",
      "# pass 41",
      "# fail 1",
      "KONEC 1",
    ];
    const izvirnik = vrstice.join("\n");
    assert.equal(zaznajVrstoIzhoda(izvirnik), "dnevnik");

    const r = await stisniIzhod(izvirnik, { shramba });
    assert.equal(r.stisnjeno, true);
    assert.equal(r.vrsta, "dnevnik");
    assert.ok(r.prihranekOdstotek >= 70, `pricakovan >=70 % prihranek na dnevniku, dobil ${r.prihranekOdstotek} %`);
    assert.match(r.besedilo, /ERROR test spomin-baza/);
    assert.match(r.besedilo, /# fail 1/);
    assert.match(r.besedilo, /×40/);
    assert.equal(await prikliciIzvirnik(r.kljuc!, { shramba }), izvirnik);
  });

  it("meritev prihranka znakov na pravih datotekah iz repozitorija (JSON + Markdown porocilo)", async () => {
    const dir = await novaMapa();
    // 1. Pravi JSON iz projekta: prvih 120 tem iz src/lib/lina/podatki/learn-anything-teme.json (pravi katalog tem Line).
    const vseTeme = JSON.parse(await readFile(path.join(SRC, "lib/lina/podatki/learn-anything-teme.json"), "utf8")) as unknown[];
    const praviJson = JSON.stringify(vseTeme.slice(0, 120), null, 2);
    const rJson = await stisniIzhod(praviJson, { dir });
    assert.equal(rJson.stisnjeno, true);
    assert.ok(rJson.prihranekOdstotek >= 70, `pravi JSON prihranek ${rJson.prihranekOdstotek} %`);
    assert.equal(await prikliciIzvirnik(rJson.kljuc!, { dir }), praviJson);

    // 2. Pravo besedilo iz repozitorija (src/components/lina2/besedila.ts, ~11 KB).
    const besedila = await readFile(path.join(SRC, "components/lina2/besedila.ts"), "utf8");
    const rPor = await stisniIzhod(besedila, { dir, vrsta: "porocilo" });
    assert.equal(rPor.stisnjeno, true);
    assert.ok(rPor.prihranekOdstotek >= 70, `pravo porocilo prihranek ${rPor.prihranekOdstotek} %`);
    assert.equal(await prikliciIzvirnik(rPor.kljuc!, { dir }), besedila);

    console.info(
      `MERITEV-STISKANJE: json=${rJson.izvirnikZnakov}->${rJson.stisnjenoZnakov} (-${rJson.prihranekOdstotek}%), ` +
        `porocilo=${rPor.izvirnikZnakov}->${rPor.stisnjenoZnakov} (-${rPor.prihranekOdstotek}%)`,
    );
  });

  it("stikalo privzeto VKLOPLJENO; ob izklopu vrne izvirnik nespremenjen; kratek izhod se ne stiska", async () => {
    const dir = await novaMapa();
    assert.equal(await jeStiskanjeVklopljeno(dir), true);

    const kratek = "Kratek izhod testa: OK (100 znakov).";
    const rk = await stisniIzhod(kratek, { dir });
    assert.equal(rk.stisnjeno, false);
    assert.equal(rk.besedilo, kratek);

    await nastaviStiskanje(false, dir);
    assert.equal(await jeStiskanjeVklopljeno(dir), false);
    const dolg = "A".repeat(4000);
    const ri = await stisniIzhod(dolg, { dir });
    assert.equal(ri.stisnjeno, false);
    assert.equal(ri.besedilo, dolg);
    assert.equal(ri.kljuc, null);
  });

  it("varnost: skrivnosti ne gredo na disk, pot z .. se zavrne, simbolna povezava se zavrne, oznaka priklica se izlusci", async () => {
    const dir = await novaMapa();
    const sSkrivnostjo = `${"vrstica porocila brez napak\n".repeat(80)}api_key = sk-zeloTajenKljuc1234567890abcd\n`;
    const r = await stisniIzhod(sSkrivnostjo, { dir });
    assert.equal(r.stisnjeno, true);
    assert.equal(r.shranjenIzvirnik, false, "izvirnik s skrivnostjo ne sme na disk");
    assert.equal(await prikliciIzvirnik(r.kljuc!, { dir }), null);

    // Preverba kljuca (prepreci pot traversal).
    assert.equal(await prikliciIzvirnik("../../etc/passwd", { dir }), null);
    assert.equal(await lokalnaShramba(dir).shrani("../zlo", "x"), false);

    // Simbolna povezava v mapi CCR se ne prebere.
    const ccrDir = path.join(dir, CCR_MAPA);
    await mkdir(ccrDir, { recursive: true });
    const zunanja = path.join(dir, "tuja.txt");
    await writeFile(zunanja, "TUJA");
    await symlink(zunanja, path.join(ccrDir, "0123456789abcdef.txt"));
    assert.equal(await prikliciIzvirnik("0123456789abcdef", { dir }), null);

    // Izluscanje oznak [[priklic-izvirnika: ...]].
    const iz = izluciPriklicIzvirnika("Potrebujem podrobnosti. [[priklic-izvirnika: 0123456789abcdef]] Hvala.");
    assert.equal(iz.besedilo, "Potrebujem podrobnosti. Hvala.");
    assert.deepEqual(iz.kljuci, ["0123456789abcdef"]);
  });

  it("locitev: tajnica (klici) ne uvaza stiskanje-izhodov", async () => {
    for (const rel of ["lib/lina/service.server.ts", "lib/lina/brain.ts", "lib/lina/govor.ts", "lib/lina/guards.ts", "lib/lina/tajnica.ts"]) {
      const v = await readFile(path.join(SRC, rel), "utf8");
      assert.doesNotMatch(v, /stiskanje-izhodov/, `${rel} ne sme uvazati stiskanje-izhodov`);
    }
  });
});
