/**
 * Preizkusi mehanizma skilov za asistentko Line: generator (.mjs), razclenitev (.ts),
 * vstavitev v sestaviAsistenta, locenost od skila za klice, skladnost generiranega modula in postbuild.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NAVODILO_ASISTENTA, sestaviAsistenta } from "./asistent-pogovor.server.ts";
import { navodiloSkilov, razcleniSkilAsistentke, SKILI_ASISTENTKE, type SkilAsistentke } from "./skili-asistentka.ts";
import { SKILI_ASISTENTKE_MD } from "./skili-asistentka.generated.ts";

const KOREN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const vLf = (besedilo: string) => besedilo.replace(/\r\n?/g, "\n");

type RezultatPreverbe = { md: string; ime: string; razlicica: number; oznaka: string; pravila: string };
type GeneratorAsistentke = {
  MEJA_PRAVIL_SKILA: number;
  MEJA_PRAVIL_SKUPAJ: number;
  PREPOVEDANA_IMENA: string[];
  PREPOVEDANI_VZORCI: Array<[string, RegExp]>;
  POT_MODULA: string;
  preveriSkilAsistentke: (surovo: string, imeMape: string) => RezultatPreverbe;
  modulSkilovAsistentke: (skili: RezultatPreverbe[]) => string;
  preberiSkiliAsistentke: (korenSkilov: string) => RezultatPreverbe[];
};

const POT_GENERATORJA: string = "../../../scripts/skili-asistentka-v-modul.mjs";
const uvoziGenerator = async (): Promise<GeneratorAsistentke> =>
  (await import(POT_GENERATORJA)) as unknown as GeneratorAsistentke;

function zgradiSkil({
  ime = "primer-skil",
  razlicica = "1",
  velja = "asistentka",
  pravila = "- Kratko pravilo dela.\n- Drugo pravilo.",
  dodatno = "\n## REFERENCA\n\nPodrobnosti, ki ne gredo v kratki povzetek.\n",
}: {
  ime?: string | null;
  razlicica?: string | null;
  velja?: string | null;
  pravila?: string | null;
  dodatno?: string;
} = {}): string {
  const glava: string[] = [];
  if (ime !== null) glava.push(`name: ${ime}`);
  if (razlicica !== null) glava.push(`razlicica: ${razlicica}`);
  if (velja !== null) glava.push(`velja: ${velja}`);
  const razdelekPravil = pravila === null ? "" : `\n## PRAVILA [ASISTENTKA]\n\n${pravila}\n`;
  return `---\n${glava.join("\n")}\n---\n\n# Primer skila\n${razdelekPravil}${dodatno}`;
}

describe("skili za asistentko Line (mehanizem)", () => {
  it("veljaven skil da pravilno ime, razlicico, oznako in pravila; CRLF da isto oznako kot LF", async () => {
    const g = await uvoziGenerator();
    const lf = zgradiSkil();
    const crlf = lf.replace(/\n/g, "\r\n");

    const rLf = g.preveriSkilAsistentke(lf, "primer-skil");
    const rCrlf = g.preveriSkilAsistentke(crlf, "primer-skil");

    assert.equal(rLf.ime, "primer-skil");
    assert.equal(rLf.razlicica, 1);
    assert.match(rLf.oznaka, /^primer-skil@1\+[0-9a-f]{12}$/);
    assert.equal(rLf.pravila, "- Kratko pravilo dela.\n- Drugo pravilo.");
    assert.equal(rCrlf.oznaka, rLf.oznaka);
    assert.equal(rCrlf.md, rLf.md);
    assert.equal(rCrlf.pravila, rLf.pravila);
  });

  it("zavrne neveljavno glavo, ime, razlicico, velja, razdelek in mejo dolzine (tocno meja uspe)", async () => {
    const g = await uvoziGenerator();

    // Brez glave
    assert.throws(() => g.preveriSkilAsistentke("# Brez glave\n## PRAVILA [ASISTENTKA]\nPravilo.\n", "primer-skil"), /glava/);
    // ime != imeMape
    assert.throws(() => g.preveriSkilAsistentke(zgradiSkil({ ime: "drugo-ime" }), "primer-skil"), /ime|mape/i);
    // Neveljavno ime (velike crke)
    assert.throws(() => g.preveriSkilAsistentke(zgradiSkil({ ime: "Primer-Skil" }), "Primer-Skil"), /name/);
    // Manjka razlicica / ni celo stevilo >= 1
    assert.throws(() => g.preveriSkilAsistentke(zgradiSkil({ razlicica: null }), "primer-skil"), /razlicica/);
    assert.throws(() => g.preveriSkilAsistentke(zgradiSkil({ razlicica: "0" }), "primer-skil"), /razlicica/);
    assert.throws(() => g.preveriSkilAsistentke(zgradiSkil({ razlicica: "1.5" }), "primer-skil"), /razlicica/);
    assert.throws(() => g.preveriSkilAsistentke(zgradiSkil({ razlicica: "abc" }), "primer-skil"), /razlicica/);
    // velja manjka ali drugacen
    assert.throws(() => g.preveriSkilAsistentke(zgradiSkil({ velja: null }), "primer-skil"), /velja/);
    assert.throws(() => g.preveriSkilAsistentke(zgradiSkil({ velja: "klici" }), "primer-skil"), /velja/);
    // Razdelek manjka
    assert.throws(() => g.preveriSkilAsistentke(zgradiSkil({ pravila: null }), "primer-skil"), /PRAVILA \[ASISTENTKA\]/);
    // Razdelek prazen
    assert.throws(() => g.preveriSkilAsistentke(zgradiSkil({ pravila: "   \n  " }), "primer-skil"), /prazen/);
    // Razdelek podvojen
    assert.throws(
      () => g.preveriSkilAsistentke(zgradiSkil({ dodatno: "\n## PRAVILA [ASISTENTKA]\nDrugo.\n" }), "primer-skil"),
      /podvojen/,
    );
    // Drug razdelek z oznako [ASISTENTKA]
    assert.throws(
      () => g.preveriSkilAsistentke(zgradiSkil({ dodatno: "\n## DRUGO [ASISTENTKA]\nNekaj.\n" }), "primer-skil"),
      /DRUGO \[ASISTENTKA\]/,
    );
    // Dolzina pravila: tocno MEJA_PRAVIL_SKILA uspe, MEJA_PRAVIL_SKILA + 1 pade
    const tocnoMeja = "a".repeat(g.MEJA_PRAVIL_SKILA);
    const ok = g.preveriSkilAsistentke(zgradiSkil({ pravila: tocnoMeja }), "primer-skil");
    assert.equal(ok.pravila.length, g.MEJA_PRAVIL_SKILA);
    const cezMejo = "a".repeat(g.MEJA_PRAVIL_SKILA + 1);
    assert.throws(() => g.preveriSkilAsistentke(zgradiSkil({ pravila: cezMejo }), "primer-skil"), /mejo/);
  });

  it("zavrne vsak PREPOVEDAN_VZOREC posebej (sporocilo ima ime vzorca in skila, nima ujemajocega besedila) ter prepovedano ime", async () => {
    const g = await uvoziGenerator();
    // Primeri za vse vzorce, sestavljeni brez dobesednih oznak klicev ali osebnih podatkov v viru.
    const primeri: Record<string, string> = {
      "osebno-ime-j": ["Ja", "nez"].join(""),
      "osebno-ime-m": ["Ma", "tej"].join(""),
      "domaca-pot": ["/", "ho", "me/", "primer"].join(""),
      "naslov-ipv4": "192.0.2.44",
      "kljuc-google": "AIza" + "AbCdEf0123456789_-XY",
      "kljuc-zeton": "sk-" + "aB12cD34eF56gH78",
      "kljuc-slack": "xoxb-" + "1234567890-abc",
      "oznaka-klica": ["C", "A", "a1b2c3d4"].join(""),
      "prepovedana-tema": "YouTube",
    };

    assert.deepEqual(
      Object.keys(primeri).sort(),
      g.PREPOVEDANI_VZORCI.map(([ime]) => ime).sort(),
      "preizkus mora pokriti vsak vzorec v PREPOVEDANI_VZORCI",
    );

    for (const [imeVzorca] of g.PREPOVEDANI_VZORCI) {
      const ujemanje = primeri[imeVzorca]!;
      // Vstavimo v referencni del, da preverimo pregled CELEGA besedila (md).
      const md = zgradiSkil({ dodatno: `\n## REFERENCA\n\nPrimer vsebine ${ujemanje} konec.\n` });
      assert.throws(
        () => g.preveriSkilAsistentke(md, "primer-skil"),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes("primer-skil"), `manjka ime skila: ${err.message}`);
          assert.ok(err.message.includes(imeVzorca), `manjka ime vzorca ${imeVzorca}: ${err.message}`);
          assert.ok(!err.message.toLowerCase().includes(ujemanje.toLowerCase()), `ujemanje ne sme biti v sporocilu: ${err.message}`);
          return true;
        },
      );
    }

    // Dodatni varianti prepovedanih tem in kljucev
    for (const besedilo of ["Ščit", "Scit", "Googlova prijava", "Google sign", "ghp_" + "A1b2C3d4E5f6G7h8"]) {
      const md = zgradiSkil({ dodatno: `\n## REFERENCA\n\n${besedilo}\n` });
      assert.throws(() => g.preveriSkilAsistentke(md, "primer-skil"), /prepovedan vzorec/);
    }

    // Prepovedano ime skila
    for (const prepovedano of g.PREPOVEDANA_IMENA) {
      assert.throws(() => g.preveriSkilAsistentke(zgradiSkil({ ime: prepovedano }), prepovedano), /prepovedano ime/);
    }
  });

  it("modulSkilovAsistentke: sortira po imenu, zavrne podvojeno ime in preseg skupne meje, izda veljaven TS", async () => {
    const g = await uvoziGenerator();
    const sB = g.preveriSkilAsistentke(zgradiSkil({ ime: "beta-skil", pravila: "Pravilo B." }), "beta-skil");
    const sA = g.preveriSkilAsistentke(zgradiSkil({ ime: "alfa-skil", pravila: "Pravilo A." }), "alfa-skil");

    // Vrstni red vhoda ne vpliva na izhod
    const mod1 = g.modulSkilovAsistentke([sB, sA]);
    const mod2 = g.modulSkilovAsistentke([sA, sB]);
    assert.equal(mod1, mod2);
    assert.ok(mod1.indexOf("alfa-skil") < mod1.indexOf("beta-skil"));

    // Podvojeno ime = napaka
    assert.throws(() => g.modulSkilovAsistentke([sA, sA]), /podvojeno ime/);

    // Skupna meja: 7 * 1200 = 8400 OK, 8 * 1200 = 9600 napaka; 7 * 1200 + 600 = 9000 OK, 9001 napaka
    const polni = (n: number) =>
      Array.from({ length: n }, (_, i) => {
        const ime = `skil-${i + 1}`;
        return g.preveriSkilAsistentke(zgradiSkil({ ime, pravila: "x".repeat(g.MEJA_PRAVIL_SKILA) }), ime);
      });
    assert.ok(g.modulSkilovAsistentke(polni(7)).includes("skil-7"));
    assert.throws(() => g.modulSkilovAsistentke(polni(8)), /skupna dolzina/);
    const ostanek = g.MEJA_PRAVIL_SKUPAJ - 7 * g.MEJA_PRAVIL_SKILA;
    const osmiTocno = g.preveriSkilAsistentke(zgradiSkil({ ime: "skil-8", pravila: "y".repeat(ostanek) }), "skil-8");
    assert.ok(g.modulSkilovAsistentke([...polni(7), osmiTocno]).includes("skil-8"));
    const osmiCez = g.preveriSkilAsistentke(zgradiSkil({ ime: "skil-8", pravila: "y".repeat(ostanek + 1) }), "skil-8");
    assert.throws(() => g.modulSkilovAsistentke([...polni(7), osmiCez]), /skupna dolzina/);

    // Prazen seznam da []
    const prazen = g.modulSkilovAsistentke([]);
    assert.ok(prazen.includes("= [];"));

    // Generirani izhod je veljaven TS (uvoz iz zacasne mape z --experimental-strip-types)
    const mapa = mkdtempSync(path.join(tmpdir(), "lina-asist-mod-"));
    try {
      const potTs = path.join(mapa, "generiran.ts");
      writeFileSync(potTs, mod1);
      const uvozeno = (await import(pathToFileURL(potTs).href)) as {
        SKILI_ASISTENTKE_MD: ReadonlyArray<{ ime: string; oznaka: string; md: string }>;
      };
      assert.equal(uvozeno.SKILI_ASISTENTKE_MD.length, 2);
      assert.equal(uvozeno.SKILI_ASISTENTKE_MD[0]!.ime, "alfa-skil");
      assert.equal(uvozeno.SKILI_ASISTENTKE_MD[0]!.oznaka, sA.oznaka);
      assert.equal(uvozeno.SKILI_ASISTENTKE_MD[1]!.ime, "beta-skil");
      assert.equal(uvozeno.SKILI_ASISTENTKE_MD[1]!.oznaka, sB.oznaka);
    } finally {
      rmSync(mapa, { recursive: true, force: true });
    }
  });

  it("preberiSkiliAsistentke: preskoci skil brez velja, mapo brez SKILL.md in simbolne povezave; zazna neveljaven skil", async () => {
    const g = await uvoziGenerator();
    const mapa = mkdtempSync(path.join(tmpdir(), "lina-asist-beri-"));
    try {
      // Skil brez velja (kot skil za klice)
      mkdirSync(path.join(mapa, "klicni-skil"));
      writeFileSync(path.join(mapa, "klicni-skil", "SKILL.md"), zgradiSkil({ ime: "klicni-skil", velja: null }));
      // Skil z drugacnim velja
      mkdirSync(path.join(mapa, "drugi-skil"));
      writeFileSync(path.join(mapa, "drugi-skil", "SKILL.md"), zgradiSkil({ ime: "drugi-skil", velja: "klici" }));
      // Podmapa brez SKILL.md
      mkdirSync(path.join(mapa, "prazna-mapa"));
      writeFileSync(path.join(mapa, "prazna-mapa", "README.md"), "nic");
      // Veljaven skil za asistentko
      mkdirSync(path.join(mapa, "dober-skil"));
      writeFileSync(path.join(mapa, "dober-skil", "SKILL.md"), zgradiSkil({ ime: "dober-skil" }));
      // Simbolna povezava na mapo in na SKILL.md (nobena ne sme biti sledena)
      symlinkSync(path.join(mapa, "dober-skil"), path.join(mapa, "povezava-mapa"));
      mkdirSync(path.join(mapa, "povezava-datoteka"));
      symlinkSync(path.join(mapa, "dober-skil", "SKILL.md"), path.join(mapa, "povezava-datoteka", "SKILL.md"));

      const prebrano = g.preberiSkiliAsistentke(mapa);
      assert.equal(prebrano.length, 1);
      assert.equal(prebrano[0]!.ime, "dober-skil");

      // Neveljaven skil z velja: asistentka vrze napako z imenom mape
      mkdirSync(path.join(mapa, "pokvarjen-skil"));
      writeFileSync(path.join(mapa, "pokvarjen-skil", "SKILL.md"), zgradiSkil({ ime: "pokvarjen-skil", pravila: null }));
      assert.throws(() => g.preberiSkiliAsistentke(mapa), /pokvarjen-skil/);
    } finally {
      rmSync(mapa, { recursive: true, force: true });
    }
  });

  it("skladnost obeh razclenitev (.mjs in .ts): za isti vhod enaki ime, razlicica, oznaka in pravila", async () => {
    const g = await uvoziGenerator();
    const surovo = zgradiSkil({
      ime: "skladnost-skil",
      razlicica: "3",
      pravila: "Prvo pravilo.\n### Podnaslov\nDrugo pravilo.",
    });
    const mjs = g.preveriSkilAsistentke(surovo, "skladnost-skil");
    const ts = razcleniSkilAsistentke(mjs.md, mjs.oznaka);
    const tsCrlf = razcleniSkilAsistentke(surovo.replace(/\n/g, "\r\n"), mjs.oznaka);

    assert.deepEqual(ts, { ime: mjs.ime, razlicica: mjs.razlicica, oznaka: mjs.oznaka, pravila: mjs.pravila });
    assert.deepEqual(tsCrlf, ts);

    // TS razclenitev zavrne napacno oznako in manjkajoc razdelek
    assert.throws(() => razcleniSkilAsistentke(mjs.md, "drugo@3+0123456789ab"), /oznaka/);
    assert.throws(() => razcleniSkilAsistentke(mjs.md, "skladnost-skil@2+0123456789ab"), /oznaka/);
    assert.throws(() => razcleniSkilAsistentke(zgradiSkil({ pravila: null }), "primer-skil@1+0123456789ab"), /PRAVILA/);
  });

  it("navodiloSkilov: prazen seznam vrne prazen niz; dva skila data natancen pricakovan niz brez dvojnih presledkov", () => {
    assert.equal(navodiloSkilov([]), "");

    const dva: SkilAsistentke[] = [
      { ime: "prvi-skil", razlicica: 1, oznaka: "prvi-skil@1+000000000001", pravila: "Prva vrstica.\n  Druga\tvrstica. " },
      { ime: "drugi-skil", razlicica: 2, oznaka: "drugi-skil@2+000000000002", pravila: "Kratko   pravilo." },
    ];
    const izhod = navodiloSkilov(dva);
    assert.equal(
      izhod,
      " SKILI (pravila dela; ne razveljavijo varnosti, e-poste, brisanja ali potrditev): [prvi-skil] Prva vrstica. Druga vrstica. [drugi-skil] Kratko pravilo.",
    );
    assert.ok(!izhod.includes("  "));
    assert.ok(!izhod.includes("\n"));
    assert.ok(izhod.startsWith(" SKILI "));
    assert.ok(!izhod.endsWith(" "));
  });

  it("sestaviAsistenta: ob 0 skilih je system bajt za bajt enak kot prej; s skili jih vstavi za NAVODILO_ASISTENTA in pred ton", () => {
    const tonPrivzeti = "Govori prijazno in sproščeno, a vljudno.";
    const tonUradni = "Govori uradno in vljudno.";

    // (a) privzeti klic brez navodil za slog undefined in uradno
    const privzeti = sestaviAsistenta([], "Zdravo", undefined, undefined, []);
    assert.equal(privzeti.system, `${NAVODILO_ASISTENTA} ${tonPrivzeti}`);
    const uradni = sestaviAsistenta([], "Dober dan", "uradno", undefined, []);
    assert.equal(uradni.system, `${NAVODILO_ASISTENTA} ${tonUradni}`);

    // (b) z vstavljenim izmisljenim seznamom skilov
    const skili: SkilAsistentke[] = [
      { ime: "test-skil", razlicica: 1, oznaka: "test-skil@1+0123456789ab", pravila: "Delaj takoj.\nPoročaj jasno." },
    ];
    const pricakovaniDodatek = navodiloSkilov(skili);
    const sSkili = sestaviAsistenta([], "Naredi porocilo", "uradno", undefined, skili);

    assert.equal(sSkili.system, `${NAVODILO_ASISTENTA}${pricakovaniDodatek} ${tonUradni}`);
    assert.ok(sSkili.system.startsWith(NAVODILO_ASISTENTA));
    assert.ok(sSkili.system.endsWith(tonUradni));
    assert.ok(sSkili.system.includes("Delaj takoj. Poročaj jasno."));
    assert.ok(!sSkili.system.includes("  "));
    assert.ok(!sSkili.text.includes("Delaj takoj"));
    assert.ok(!sSkili.text.includes("test-skil"));
  });

  it("locenost od klicev: uvoz skili-asistentka nastopa samo v asistent-pogovor.server.ts; skil-lina ga ne omenja", () => {
    const mapaLina = path.join(KOREN, "src/lib/lina");
    const uvoziSkiliAsistentka: string[] = [];

    const obhod = (mapa: string) => {
      for (const vnos of readdirSync(mapa, { withFileTypes: true })) {
        const pot = path.join(mapa, vnos.name);
        if (vnos.isDirectory()) {
          obhod(pot);
        } else if (vnos.isFile() && vnos.name.endsWith(".ts") && !vnos.name.endsWith(".test.ts")) {
          const vsebina = readFileSync(pot, "utf8");
          const rel = path.relative(mapaLina, pot).replace(/\\/g, "/");
          if (/from\s+["'][^"']*skili-asistentka(?:\.ts)?["']/.test(vsebina)) {
            uvoziSkiliAsistentka.push(rel);
          }
          if (rel !== "skili-asistentka.ts" && /from\s+["'][^"']*skili-asistentka\.generated(?:\.ts)?["']/.test(vsebina)) {
            uvoziSkiliAsistentka.push(rel);
          }
        }
      }
    };
    obhod(mapaLina);
    assert.deepEqual(uvoziSkiliAsistentka, ["asistent-pogovor.server.ts"]);

    assert.ok(!readFileSync(path.join(mapaLina, "skil-lina.ts"), "utf8").includes("skili-asistentka"));
    assert.ok(!readFileSync(path.join(mapaLina, "skil-lina.generated.ts"), "utf8").includes("skili-asistentka"));
  });

  it("generirana datoteka v drevesu je enaka izhodu generatorja iz mape skili", async () => {
    const g = await uvoziGenerator();
    const skili = g.preberiSkiliAsistentke(path.join(KOREN, "skili"));
    const pricakovano = g.modulSkilovAsistentke(skili);
    const vDrevesu = vLf(readFileSync(g.POT_MODULA, "utf8"));
    assert.equal(vDrevesu, pricakovano);
    if (skili.length === 0) {
      assert.deepEqual(SKILI_ASISTENTKE_MD, []);
      assert.deepEqual(SKILI_ASISTENTKE, []);
    }
  });

  it("postbuild skripta: ob 0 skilih uspe brez mape gradnje; z >= 1 skilom preveri modul in oznako v gradnji", () => {
    const skriptaKoren = path.join(KOREN, "scripts/preveri-skile-asistentke-v-gradnji.mjs");
    const mapa = mkdtempSync(path.join(tmpdir(), "lina-asist-postbuild-"));
    try {
      // Ob 0 skilih (prazna zacasna kopija projekta) uspe brez mape gradnje
      const prazna = path.join(mapa, "prazno");
      mkdirSync(path.join(prazna, "scripts"), { recursive: true });
      mkdirSync(path.join(prazna, "skili"), { recursive: true });
      mkdirSync(path.join(prazna, "src/lib/lina"), { recursive: true });
      copyFileSync(
        path.join(KOREN, "scripts/skili-asistentka-v-modul.mjs"),
        path.join(prazna, "scripts/skili-asistentka-v-modul.mjs"),
      );
      copyFileSync(skriptaKoren, path.join(prazna, "scripts/preveri-skile-asistentke-v-gradnji.mjs"));
      const praznaGen = spawnSync(process.execPath, [path.join(prazna, "scripts/skili-asistentka-v-modul.mjs")], {
        cwd: prazna,
        encoding: "utf8",
      });
      assert.equal(praznaGen.status, 0, praznaGen.stderr);
      const prazenIzhod = spawnSync(process.execPath, [path.join(prazna, "scripts/preveri-skile-asistentke-v-gradnji.mjs")], {
        cwd: prazna,
        env: { ...process.env, LINA_IZHOD: path.join(mapa, "ne-obstaja") },
        encoding: "utf8",
      });
      assert.equal(prazenIzhod.status, 0, prazenIzhod.stderr);
      assert.match(prazenIzhod.stdout, /skilov za asistentko ni/);

      // Zacasna kopija z 1 skilom za asistentko
      const kopija = path.join(mapa, "projekt");
      mkdirSync(path.join(kopija, "scripts"), { recursive: true });
      mkdirSync(path.join(kopija, "skili/primer-asist"), { recursive: true });
      mkdirSync(path.join(kopija, "src/lib/lina"), { recursive: true });
      copyFileSync(
        path.join(KOREN, "scripts/skili-asistentka-v-modul.mjs"),
        path.join(kopija, "scripts/skili-asistentka-v-modul.mjs"),
      );
      copyFileSync(skriptaKoren, path.join(kopija, "scripts/preveri-skile-asistentke-v-gradnji.mjs"));
      writeFileSync(
        path.join(kopija, "skili/primer-asist/SKILL.md"),
        zgradiSkil({ ime: "primer-asist", pravila: "Pravilo za preizkus gradnje." }),
      );

      // Pognan generator v kopiji
      const gen = spawnSync(process.execPath, [path.join(kopija, "scripts/skili-asistentka-v-modul.mjs")], {
        cwd: kopija,
        encoding: "utf8",
      });
      assert.equal(gen.status, 0, gen.stderr);
      assert.match(gen.stdout, /skili za asistentko: 1, \d+ znakov pravil/);

      const potModula = path.join(kopija, "src/lib/lina/skili-asistentka.generated.ts");
      const vsebinaModula = readFileSync(potModula, "utf8");
      const ujemanjeOznake = /primer-asist@1\+[0-9a-f]{12}/.exec(vsebinaModula);
      assert.ok(ujemanjeOznake, "generirani modul mora vsebovati oznako");
      const oznaka = ujemanjeOznake[0];

      const skriptaKopija = path.join(kopija, "scripts/preveri-skile-asistentke-v-gradnji.mjs");
      const pozeni = (izhod: string) =>
        spawnSync(process.execPath, [skriptaKopija], {
          cwd: kopija,
          env: { ...process.env, LINA_IZHOD: izhod },
          encoding: "utf8",
        });

      // Brez mape gradnje -> koda 1
      const brezGradnje = pozeni(path.join(mapa, "ni-gradnje"));
      assert.equal(brezGradnje.status, 1);
      assert.match(brezGradnje.stderr, /mape gradnje/);

      // Z mapo gradnje brez oznake -> koda 1 in ime skila v stderr
      const gradnja = path.join(mapa, "gradnja");
      mkdirSync(gradnja);
      writeFileSync(path.join(gradnja, "x.js"), "console.log('brez oznake');\n");
      const manjkaOznaka = pozeni(gradnja);
      assert.equal(manjkaOznaka.status, 1);
      assert.ok(manjkaOznaka.stderr.includes("primer-asist"), manjkaOznaka.stderr);

      // Z mapo gradnje z oznako -> koda 0
      writeFileSync(path.join(gradnja, "x.js"), `export const s = ${JSON.stringify(oznaka)};\n`);
      const dobraGradnja = pozeni(gradnja);
      assert.equal(dobraGradnja.status, 0, dobraGradnja.stderr);

      // Spremenjen generirani modul (en znak) -> koda 1
      writeFileSync(potModula, `${vsebinaModula}// dodatek\n`);
      const neusklajen = pozeni(gradnja);
      assert.equal(neusklajen.status, 1);
      assert.match(neusklajen.stderr, /skili-asistentka-v-modul\.mjs/);

      // Generator ob napaki ne prepise obstojecega modula in vrne kodo 1 z NAPAKA: na stderr
      const predNapako = readFileSync(potModula, "utf8");
      mkdirSync(path.join(kopija, "skili/slabi-skil"), { recursive: true });
      writeFileSync(path.join(kopija, "skili/slabi-skil/SKILL.md"), zgradiSkil({ ime: "slabi-skil", pravila: null }));
      const padecGen = spawnSync(process.execPath, [path.join(kopija, "scripts/skili-asistentka-v-modul.mjs")], {
        cwd: kopija,
        encoding: "utf8",
      });
      assert.equal(padecGen.status, 1);
      assert.match(padecGen.stderr, /^NAPAKA:.*slabi-skil/);
      assert.equal(readFileSync(potModula, "utf8"), predNapako);
    } finally {
      rmSync(mapa, { recursive: true, force: true });
    }
  });
});
