/**
 * Dopolnilni preizkusi mehanizma skilov za asistentko (po mutacijski preverbi agentovih preizkusov):
 * prepovedano ime skila mora res biti na seznamu, razclenitev .ts mora preveriti velja, modul z neujemajocim imenom mora pasti,
 * in celotna pot do sistemskega besedila: skil, ki ga generator zapise v generirani modul, mora brez posebnega parametra
 * priti v sestaviAsistenta (preizkus v zacasni kopiji drevesa, ker je pravi generirani modul lahko prazen).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { razcleniSkilAsistentke } from "./skili-asistentka.ts";

const KOREN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const POT_GENERATORJA: string = "../../../scripts/skili-asistentka-v-modul.mjs";

type Rez = { md: string; ime: string; razlicica: number; oznaka: string; pravila: string };
type Generator = {
  PREPOVEDANA_IMENA: string[];
  preveriSkilAsistentke: (surovo: string, imeMape: string) => Rez;
  modulSkilovAsistentke: (skili: Rez[]) => string;
};
const uvoziGenerator = async (): Promise<Generator> => (await import(POT_GENERATORJA)) as unknown as Generator;

function skil(ime: string, velja: string, pravila: string): string {
  return `---\nname: ${ime}\nrazlicica: 1\nvelja: ${velja}\n---\n\n# Naslov\n\n## PRAVILA [ASISTENTKA]\n\n${pravila}\n\n## REFERENCA\n\nPodrobnosti.\n`;
}

describe("skili za asistentko: dopolnilni preizkusi", () => {
  it("skil o lokaciji kljucev je na seznamu prepovedanih imen in ga generator zavrne", async () => {
    const g = await uvoziGenerator();
    assert.ok(g.PREPOVEDANA_IMENA.includes("safeer-kljuci-lokacija"), "seznam prepovedanih imen mora vsebovati skil o kljucih");
    assert.throws(
      () => g.preveriSkilAsistentke(skil("safeer-kljuci-lokacija", "asistentka", "Pravilo."), "safeer-kljuci-lokacija"),
      /prepovedano ime/,
    );
  });

  it("razclenitev .ts zavrne skil, katerega velja ni natanko asistentka", async () => {
    const g = await uvoziGenerator();
    const dober = g.preveriSkilAsistentke(skil("primer-skil", "asistentka", "Pravilo."), "primer-skil");
    const mdKlici = skil("primer-skil", "klici", "Pravilo.");
    assert.throws(() => razcleniSkilAsistentke(mdKlici, dober.oznaka), /velja/);
    const mdBrez = mdKlici.replace("velja: klici\n", "");
    assert.throws(() => razcleniSkilAsistentke(mdBrez, dober.oznaka), /velja/);
  });

  it("generirani modul: ime v modulu mora ustrezati glavi (neujemanje vrze ob nalaganju), ujemajoce se normalno nalozi in je zamrznjeno", async () => {
    const g = await uvoziGenerator();
    const dober = g.preveriSkilAsistentke(skil("primer-skil", "asistentka", "Prvo pravilo."), "primer-skil");
    const veljavenModul = g.modulSkilovAsistentke([dober]);
    const mapa = mkdtempSync(path.join(tmpdir(), "lina-asist-dod-"));
    try {
      const vir = path.join(KOREN, "src/lib/lina/skili-asistentka.ts");
      const naredi = (podmapa: string, modul: string): string => {
        const d = path.join(mapa, podmapa);
        mkdirSync(d, { recursive: true });
        copyFileSync(vir, path.join(d, "skili-asistentka.ts"));
        writeFileSync(path.join(d, "skili-asistentka.generated.ts"), modul);
        return path.join(d, "skili-asistentka.ts");
      };

      const potDober = naredi("dober", veljavenModul);
      const uvozen = (await import(pathToFileURL(potDober).href)) as {
        SKILI_ASISTENTKE: ReadonlyArray<{ ime: string; razlicica: number; pravila: string }>;
      };
      assert.equal(uvozen.SKILI_ASISTENTKE.length, 1);
      assert.equal(uvozen.SKILI_ASISTENTKE[0]!.ime, "primer-skil");
      assert.equal(uvozen.SKILI_ASISTENTKE[0]!.pravila, "Prvo pravilo.");
      assert.ok(Object.isFrozen(uvozen.SKILI_ASISTENTKE), "seznam skilov mora biti zamrznjen");

      const neujemajoc = veljavenModul.replace('{ ime: "primer-skil"', '{ ime: "drugo-ime"');
      assert.notEqual(neujemajoc, veljavenModul, "preizkus mora res spremeniti ime v modulu");
      const potSlab = naredi("slab", neujemajoc);
      await assert.rejects(() => import(pathToFileURL(potSlab).href), /ne ujema/);
    } finally {
      rmSync(mapa, { recursive: true, force: true });
    }
  });

  it("celotna pot: skil v generiranem modulu pride brez posebnega parametra v sistemsko besedilo asistentke (pred ton), ne v besedilo uporabnika", async () => {
    const g = await uvoziGenerator();
    const dober = g.preveriSkilAsistentke(
      skil("primer-skil", "asistentka", "Najprej opravi delo, potem porocaj.\n- Ne trdi neizvedenega."),
      "primer-skil",
    );
    const mapa = mkdtempSync(path.join(tmpdir(), "lina-asist-pot-"));
    try {
      const lina = path.join(mapa, "src/lib/lina");
      mkdirSync(path.join(mapa, "src/lib"), { recursive: true });
      cpSync(path.join(KOREN, "src/lib/lina"), lina, { recursive: true });
      symlinkSync(path.join(KOREN, "node_modules"), path.join(mapa, "node_modules"));
      copyFileSync(path.join(KOREN, "package.json"), path.join(mapa, "package.json"));
      writeFileSync(path.join(lina, "skili-asistentka.generated.ts"), g.modulSkilovAsistentke([dober]));
      writeFileSync(
        path.join(mapa, "izpis.mts"),
        [
          'import { sestaviAsistenta } from "./src/lib/lina/asistent-pogovor.server.ts";',
          'const r = sestaviAsistenta([], "Pozdravljena", "uradno", undefined);',
          "process.stdout.write(JSON.stringify(r));",
        ].join("\n"),
      );
      const izid = spawnSync(process.execPath, ["--experimental-strip-types", path.join(mapa, "izpis.mts")], {
        cwd: mapa,
        encoding: "utf8",
        timeout: 60_000,
      });
      assert.equal(izid.status, 0, izid.stderr);
      const r = JSON.parse(izid.stdout) as { system: string; text: string };
      assert.ok(r.system.includes("[primer-skil] Najprej opravi delo, potem porocaj. - Ne trdi neizvedenega."), r.system);
      assert.ok(r.system.endsWith("Govori uradno in vljudno."), "ton mora ostati na koncu");
      assert.ok(!r.text.includes("primer-skil"), "skil ne sme v besedilo uporabnika");
    } finally {
      rmSync(mapa, { recursive: true, force: true });
    }
  });
});
