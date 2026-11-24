/**
 * Prilagodljivi kontekst - shramba (stroke.json) in priklopi v navodila modelu, klic in prepoznavo govora.
 * Vsi podatki so sinteticni; brez omrezja, brez auth.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";
import {
  STROKE_DATOTEKA,
  dodajIzraz,
  izberiStroko,
  izbrisiIzraz,
  namigiStrok,
  nastaviPrilagodljiviKontekst,
  naucIzDokumenta,
  odsekStrokKlic,
  odsekStrokPogovor,
  pogledStrok,
  potrdiIzraz,
  pozabiVseStroke,
  preberiStanjeStrok,
  zabeleziPogovorLastnika,
} from "./stroke.server.ts";
import { sistemskoNavodilo } from "./live/navodilo.ts";
import { navodiloRazumevanja } from "./razumevanje.server.ts";
import { navodiloPrepisa } from "./glas-pogovor.server.ts";
import { formaCatalog } from "./catalog.ts";

const LINA = path.dirname(fileURLToPath(import.meta.url));
const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function novaMapa(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "lina-stroke-"));
  temps.push(d);
  return d;
}

describe("shramba stroke.json", () => {
  it("privzeto VKLOPLJENO brez datoteke (ideja lastnika), izklop ostane shranjen, datoteka ima pravice 0600", async () => {
    const d = await novaMapa();
    assert.equal((await preberiStanjeStrok(d)).vklopljen, true);
    await nastaviPrilagodljiviKontekst(false, d);
    assert.equal((await preberiStanjeStrok(d)).vklopljen, false);
    assert.equal((await stat(path.join(d, STROKE_DATOTEKA))).mode & 0o777, 0o600);
  });
  it("izbira stroke: samo znani kljuci; odstranitev deluje", async () => {
    const d = await novaMapa();
    await izberiStroko("tisk", true, d);
    await izberiStroko("neobstojeca", true, d);
    assert.deepEqual((await preberiStanjeStrok(d)).izbrane, ["tisk"]);
    await izberiStroko("tisk", false, d);
    assert.deepEqual((await preberiStanjeStrok(d)).izbrane, []);
  });
  it("pokvarjena ali prevelika datoteka in simbolna povezava ne podreta Line (izklopljeno, brez izjeme)", async () => {
    const d = await novaMapa();
    await writeFile(path.join(d, STROKE_DATOTEKA), "{ni json");
    assert.equal((await preberiStanjeStrok(d)).vklopljen, true);
    const d2 = await novaMapa();
    await writeFile(path.join(d2, "drugo.json"), JSON.stringify({ vklopljen: true, izbrane: ["tisk"] }));
    await symlink(path.join(d2, "drugo.json"), path.join(d2, STROKE_DATOTEKA));
    const s = await preberiStanjeStrok(d2);
    assert.equal(s.vklopljen, false);
    assert.deepEqual(s.izbrane, []);
  });
});

describe("ucenje iz lastnikovega pogovora in dokumentov", () => {
  it("pogovor lastnika steje rabo, predlaga stroko in predlog »X pomeni Y«", async () => {
    const d = await novaMapa();
    await zabeleziPogovorLastnika(d, "Danes sitotisk na 100 majic, logotip v DTF.");
    await zabeleziPogovorLastnika(d, "Flok pomeni zametni tisk z dlacicami.");
    const s = await preberiStanjeStrok(d);
    assert.equal(s.predlaganaStroka, "tisk");
    assert.equal(s.uporaba["sitotisk"]?.n, 1);
    assert.ok(s.izrazi.some((i) => i.izraz === "Flok" && i.stanje === "predlog" && i.vir === "pogovor"));
  });
  it("dokument doda predloge z imenom vira; potrditev jih da v klic, izbris jih zavrne za vedno", async () => {
    const d = await novaMapa();
    await izberiStroko("tisk", true, d);
    const r = await naucIzDokumenta(d, "pojmi.txt", "Plastizol: barva za sitotisk na tekstil\nHTV - folija za vroci tisk");
    assert.equal(r.novih, 2);
    let s = await preberiStanjeStrok(d);
    const plast = s.izrazi.find((i) => i.izraz === "Plastizol")!;
    assert.equal(plast.izvor, "pojmi.txt");
    assert.doesNotMatch(await odsekStrokKlic(d, "plastizol"), /Plastizol/);
    await potrdiIzraz(plast.id, d);
    assert.match(await odsekStrokKlic(d, "plastizol"), /Plastizol/);
    await izbrisiIzraz("HTV", d);
    await naucIzDokumenta(d, "pojmi2.txt", "HTV - folija");
    s = await preberiStanjeStrok(d);
    assert.ok(!s.izrazi.some((i) => i.izraz === "HTV"));
  });
  it("dokument predlaga stroko, a ne steje rabe (raba = kar lastnik sam govori); velik dokument se obdela v kosih", async () => {
    const d = await novaMapa();
    const velik = `Sitotisk, DTF in termotransfer na majice.\n${"Vrstica cenika brez izrazov.\n".repeat(5_000)}Flok: zametni tisk\n`;
    const r = await naucIzDokumenta(d, "cenik.txt", velik);
    const s = await preberiStanjeStrok(d);
    assert.equal(s.predlaganaStroka, "tisk");
    assert.equal(r.stroka, "tisk");
    assert.deepEqual(s.uporaba, {});
    assert.ok(s.izrazi.some((i) => i.izraz === "Flok"), "predlog s konca velikega dokumenta");
  });
  it("izbris vgrajenega izraza ga skrije; rocno dodan izraz je takoj potrjen", async () => {
    const d = await novaMapa();
    await izberiStroko("tisk", true, d);
    await izbrisiIzraz("sitotisk", d);
    assert.doesNotMatch(await odsekStrokKlic(d, "sitotisk"), /sitotisk/);
    const dod = await dodajIzraz("Sublimacijski papir", "papir za prenos barve s toploto", d);
    assert.equal(dod.ok, true);
    assert.ok((await namigiStrok(d)).includes("Sublimacijski papir"));
    assert.equal((await dodajIzraz("ana@primer.si", "", d)).ok, false);
  });
  it("izklopljeno stikalo: nic se ne uci in nic ne gre v navodila ali namige", async () => {
    const d = await novaMapa();
    await izberiStroko("tisk", true, d);
    await nastaviPrilagodljiviKontekst(false, d);
    await zabeleziPogovorLastnika(d, "sitotisk sitotisk");
    assert.equal((await naucIzDokumenta(d, "a.txt", "Plastizol: barva")).novih, 0);
    const s = await preberiStanjeStrok(d);
    assert.deepEqual(s.uporaba, {});
    assert.equal(await odsekStrokPogovor(d, "sitotisk"), "");
    assert.equal(await odsekStrokKlic(d, "sitotisk"), "");
    assert.deepEqual(await namigiStrok(d), []);
  });
  it("pozabi vse izbrise datoteko in vse naucene podatke", async () => {
    const d = await novaMapa();
    await zabeleziPogovorLastnika(d, "sitotisk DTF termotransfer");
    await pozabiVseStroke(d);
    await assert.rejects(stat(path.join(d, STROKE_DATOTEKA)));
    const s = await preberiStanjeStrok(d);
    assert.deepEqual(s.uporaba, {});
    assert.equal(s.predlaganaStroka, null);
  });
  it("pogled za Nastavitve pokaze stroke (SL in EN ime), izraze z virom, rabo in oznako »znano«", async () => {
    const d = await novaMapa();
    await izberiStroko("tisk", true, d);
    for (let n = 0; n < 3; n++) await zabeleziPogovorLastnika(d, "sitotisk");
    const p = await pogledStrok(d);
    assert.ok(p.stroke.some((x) => x.kljuc === "tisk" && x.izbrana && x.ime.en));
    const sito = p.izrazi.find((i) => i.izraz === "sitotisk")!;
    assert.equal(sito.znano, true);
    assert.equal(sito.n, 3);
    assert.equal(sito.vir, "vgrajen");
  });
  it("zasebnost: shranjeni podatki ne vsebujejo celotnega besedila pogovora", async () => {
    const d = await novaMapa();
    await zabeleziPogovorLastnika(d, "Stranka Novak hoce sitotisk, njena stevilka je 041 555 123");
    const surovo = await readFile(path.join(d, STROKE_DATOTEKA), "utf8");
    assert.doesNotMatch(surovo, /Novak|041 555 123/);
  });
});

describe("priklopi v navodila modelu in prepoznavo", () => {
  it("Live: odsek strok gre v sistemsko navodilo samo, ce je podan", () => {
    const brez = sistemskoNavodilo({ podjetje: "Primer", katalog: formaCatalog(), pozdrav: "Pozdravljeni" });
    const z = sistemskoNavodilo({ podjetje: "Primer", katalog: formaCatalog(), pozdrav: "Pozdravljeni", stroke: "STROKOVNI SLOVAR: sitotisk" });
    assert.doesNotMatch(brez, /STROKOVNI SLOVAR/);
    assert.match(z, /STROKOVNI SLOVAR: sitotisk/);
  });
  it("razumevanje izreka v klicu: odsek strok je dodan kot podatek", () => {
    const n = navodiloRazumevanja(formaCatalog(), "cito tisk", [], "STROKOVNI SLOVAR: sitotisk");
    assert.match(n, /STROKOVNI SLOVAR: sitotisk/);
    assert.doesNotMatch(navodiloRazumevanja(formaCatalog(), "x", []), /STROKOVNI SLOVAR/);
  });
  it("prepis lastnikovega glasu: izrazi gredo v navodilo kot podatek; brez izrazov navodilo ostane enako", () => {
    const osnova = navodiloPrepisa([]);
    const z = navodiloPrepisa(["sitotisk", "DTF"]);
    assert.ok(z.startsWith(osnova));
    assert.match(z, /sitotisk, DTF/);
    assert.match(z, /podatek/);
  });
  it("koda klica in Live samo bere slovar; ucenje (zabeleziPogovorLastnika, naucIzDokumenta) je samo v lastnikovem pogovoru", async () => {
    const klic = ["voice.server.ts", "razumevanje.server.ts", "live/vstop.server.ts", "live/navodilo.ts", "live/most.ts"];
    for (const f of klic) {
      const src = await readFile(path.join(LINA, f), "utf8");
      assert.doesNotMatch(src, /zabeleziPogovorLastnika|naucIzDokumenta/, `${f} ne sme uciti iz klicev`);
    }
    const pog = await readFile(path.join(LINA, "asistent-pogovor.server.ts"), "utf8");
    assert.match(pog, /zabeleziPogovorLastnika/);
    assert.match(pog, /naucIzDokumenta/);
    assert.match(pog, /odsekStrokPogovor/);
    assert.match(await readFile(path.join(LINA, "znanje-viri.server.ts"), "utf8"), /naucIzDokumenta\(root, prikaz/);
    assert.match(await readFile(path.join(LINA, "voice.server.ts"), "utf8"), /namigiStrok/);
    assert.match(await readFile(path.join(LINA, "live/vstop.server.ts"), "utf8"), /odsekStrokKlic/);
    assert.match(await readFile(path.join(LINA, "razumevanje.server.ts"), "utf8"), /odsekStrokKlic/);
    assert.match(await readFile(path.join(LINA, "glas-pogovor.server.ts"), "utf8"), /navodiloPrepisa\(stroke \? namigiPrepoznave/);
  });
});
