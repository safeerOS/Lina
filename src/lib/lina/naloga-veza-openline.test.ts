/**
 * Preizkusi vezave OpenLine (openline-veza.server.ts) in njene vgradnje v zagon programa (zagon.server.ts).
 * Prave podprocese na 127.0.0.1 z lazno vstopno datoteko OpenLine; vse vrednosti so izmisljene.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// Nadomestek za adc.server.ts v okrnjenih kopijah drevesa (v polnem repozitoriju datoteka obstaja in se kavelj ne registrira).
if (!existsSync(new URL("./adc.server.ts", import.meta.url))) {
  const reg = (
    nodeModule as unknown as {
      registerHooks?: (hooks: {
        resolve?: (
          specifier: string,
          context: { parentURL?: string },
          next: (s: string, c: { parentURL?: string }) => { url: string; shortCircuit?: boolean },
        ) => { url: string; shortCircuit?: boolean };
      }) => unknown;
    }
  ).registerHooks;
  const nadomestekUrl =
    'data:text/javascript,export const ADC_MANJKA="ADC";export function pozabiZeton(){}export function obnoviOsvezevanjePoMenjavi(){}export async function vertexAccessToken(){return "";}';
  reg?.({
    resolve(specifier, context, next) {
      if (specifier === "./adc.server.ts" && context.parentURL?.includes("/src/lib/lina/")) {
        return { url: nadomestekUrl, shortCircuit: true };
      }
      return next(specifier, context);
    },
  });
}

const { slovenskoSporociloOpenLine, ustvariVezoKlicev } = await import("./openline-veza.server.ts");
const { stanjeOpenLineProcesa, ustaviOpenLine } = await import("./openline-zagon.server.ts");

const MAPA_LINA = path.dirname(fileURLToPath(import.meta.url));
const ODTIS_OTROK =
  "11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00";
const ODTIS_LINA = "0123456789abcdef".repeat(4);
const ZETON_LINA = "ZetonIzmisljen_9876543210-._~+/=Primer";
const SKRIVNOST = "TajniKljuc_NeSmeNaZaslon_4711";

const VSTOPNA = [
  'import { mkdirSync } from "node:fs";',
  "if (process.env.DATA_DIR) mkdirSync(process.env.DATA_DIR, { recursive: true });",
  'process.stdout.write("OpenLine slusa na https://" + process.env.HOST + ":" + process.env.PORT + "\\n");',
  `process.stdout.write("Odtis certifikata SHA-256: ${ODTIS_OTROK}\\n");`,
  "setInterval(() => {}, 60000);",
].join("\n");

async function narediOkolje(): Promise<{ baza: string; root: string; koren: string; pocisti: () => Promise<void> }> {
  const baza = await mkdtemp(path.join(tmpdir(), "openline-veza-test-"));
  const root = path.join(baza, "lina-podatki");
  const koren = path.join(baza, "openline-paket");
  mkdirSync(root, { recursive: true });
  mkdirSync(path.join(koren, "dist"), { recursive: true });
  writeFileSync(path.join(koren, "dist", "index.js"), VSTOPNA, "utf8");
  return {
    baza,
    root,
    koren,
    pocisti: async () => {
      await ustaviOpenLine(1500);
      await rm(baza, { recursive: true, force: true });
    },
  };
}

const laznaPriprava = async () => ({ naslov: "127.0.0.1", vrata: 8447, odtis: ODTIS_LINA, zeton: ZETON_LINA });

function brezOkoljaOpenLine<T>(vrednost: string | undefined, delo: () => Promise<T>): Promise<T> {
  const staro = process.env.LINA_OPENLINE_DIR;
  if (vrednost === undefined) delete process.env.LINA_OPENLINE_DIR;
  else process.env.LINA_OPENLINE_DIR = vrednost;
  return delo().finally(() => {
    if (staro === undefined) delete process.env.LINA_OPENLINE_DIR;
    else process.env.LINA_OPENLINE_DIR = staro;
  });
}

afterEach(async () => {
  await ustaviOpenLine(1500);
});

describe("openline-veza.server: slovenska sporocila in vezava zagona", () => {
  it("slovenskoSporociloOpenLine: vsaka kratka koda zagona ima svoje slovensko sporocilo, neznano je obce in nikoli ne vsebuje izvirnega besedila", () => {
    const pricakovano: Record<string, string> = {
      naslov: "računalnik nima zasebnega naslova v domačem omrežju",
      "OpenLine ni v paketu": "v namestitvi Line manjka del OpenLine (zaganjalnik ali dist/index.js); namestite Lino znova",
      vrata: "ni prostih vrat za OpenLine",
      izpis: "OpenLine je izpisal nepričakovane podatke",
      // naloga 33: vzroki namesto »se ni pripravil pravočasno«
      "OpenLine se ni pripravil": "zagon OpenLine je prekinila ustavitev ali nov zagon; Lina poskusi znova",
      rok: "OpenLine se ni javil v 15 sekundah (računalnik je morda preobremenjen); Lina poskusi znova",
      zagon: "programa za zagon OpenLine ni bilo mogoče zagnati",
      zaganjalnik: "zaganjalnik OpenLine ni dobil poti do programa (napaka namestitve)",
      uvoz: "OpenLine se ni naložil (poškodovana ali nepopolna namestitev); namestite Lino znova",
      "vrata zasedena": "vrata OpenLine so zasedena (teče drug program)",
      dovoljenje: "OpenLine nima dovoljenja za vrata ali mapo",
      "manjka modul": "v namestitvi OpenLine manjka knjižnica; namestite Lino znova",
      ustavljen: "OpenLine je ustavil sistem ali drug program, preden je bil pripravljen",
      izhod: "OpenLine se je ustavil takoj ob zagonu",
      zapis: "Lina ni mogla zapisati nastavitev OpenLine v svojo mapo podatkov",
      "disk poln": "disk računalnika je poln; sprostite prostor, nato Lina poskusi znova",
      "glas telefona": "glas telefona se ni zagnal",
      odvisnost: "notranja napaka priprave",
    };
    for (const [koda, sporocilo] of Object.entries(pricakovano)) {
      assert.equal(slovenskoSporociloOpenLine(new Error(koda)), sporocilo, koda);
    }
    const obce = "OpenLine se ni zagnal";
    for (const neznano of [new Error(SKRIVNOST), new Error(""), "niz", null, undefined, 42, { message: "naslov" }]) {
      const s = slovenskoSporociloOpenLine(neznano);
      assert.equal(s, obce);
      assert.equal(s.includes(SKRIVNOST), false);
    }
    // lastnosti prototipa niso kode
    for (const koda of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      assert.equal(slovenskoSporociloOpenLine(new Error(koda)), obce, koda);
    }
  });

  it("zagotovi: brez LINA_OPENLINE_DIR in z mapo brez dist/index.js je sporocilo 'OpenLine ni v programu', ne surova napaka", async () => {
    const ok = await narediOkolje();
    try {
      const veza = ustvariVezoKlicev({ pripraviLino: laznaPriprava });
      await brezOkoljaOpenLine(undefined, async () => {
        await assert.rejects(() => veza.zagotovi(ok.root, "127.0.0.1"), { message: "v namestitvi Line manjka del OpenLine (zaganjalnik ali dist/index.js); namestite Lino znova" });
      });
      const prazna = path.join(ok.baza, "prazna-mapa");
      mkdirSync(prazna, { recursive: true });
      await brezOkoljaOpenLine(prazna, async () => {
        await assert.rejects(() => veza.zagotovi(ok.root, "127.0.0.1"), { message: "v namestitvi Line manjka del OpenLine (zaganjalnik ali dist/index.js); namestite Lino znova" });
      });
      assert.equal(stanjeOpenLineProcesa().tece, false);
    } finally {
      await ok.pocisti();
    }
  });

  it("zagotovi: javni naslov in pokvarjena priprava Line dasta slovenski sporocili brez skrivnosti", async () => {
    const ok = await narediOkolje();
    try {
      const veza = ustvariVezoKlicev({ pripraviLino: laznaPriprava });
      await brezOkoljaOpenLine(ok.koren, async () => {
        await assert.rejects(() => veza.zagotovi(ok.root, "8.8.8.8"), {
          message: "računalnik nima zasebnega naslova v domačem omrežju",
        });
      });

      const pokvarjena = ustvariVezoKlicev({
        pripraviLino: async () => {
          throw new Error(SKRIVNOST);
        },
      });
      await brezOkoljaOpenLine(ok.koren, async () => {
        await assert.rejects(
          () => pokvarjena.zagotovi(ok.root, "127.0.0.1"),
          (napaka: unknown) => {
            assert.ok(napaka instanceof Error);
            assert.equal(napaka.message, "OpenLine se ni zagnal");
            assert.equal(napaka.message.includes(SKRIVNOST), false);
            return true;
          },
        );
      });
      assert.equal(stanjeOpenLineProcesa().tece, false);
    } finally {
      await ok.pocisti();
    }
  });

  it("zagotovi in ustavi: koren paketa pride iz LINA_OPENLINE_DIR, proces tece in se po ustavi() ustavi", async () => {
    const ok = await narediOkolje();
    try {
      const veza = ustvariVezoKlicev({ pripraviLino: laznaPriprava });
      await brezOkoljaOpenLine(ok.koren, async () => {
        await veza.zagotovi(ok.root, "127.0.0.1");
        const stanje = stanjeOpenLineProcesa();
        assert.equal(stanje.tece, true);
        assert.equal(stanje.naslov, "127.0.0.1");
        // drugi klic je idempotenten
        await veza.zagotovi(ok.root, "127.0.0.1");
        assert.deepEqual(stanjeOpenLineProcesa(), stanje);
        await veza.ustavi();
        assert.equal(stanjeOpenLineProcesa().tece, false);
        // ustavi je idempotenten in ne vrze
        await veza.ustavi();
      });
    } finally {
      await ok.pocisti();
    }
  });

  it("zagon.server.ts vpise vezavo natanko enkrat in PRED uskladiAsistenta (sicer bi telefon ob zagonu ostal brez poti klicev)", () => {
    const vir = readFileSync(path.join(MAPA_LINA, "zagon.server.ts"), "utf8");
    const registracije = vir.match(/registrirajVezoKlicev\(ustvariVezoKlicev\(\)\)/g) ?? [];
    assert.equal(registracije.length, 1);
    const mestoRegistracije = vir.indexOf("registrirajVezoKlicev(ustvariVezoKlicev())");
    const mestoUskladitve = vir.indexOf("await uskladiAsistenta(dir)");
    assert.ok(mestoUskladitve > 0, "uskladiAsistenta mora biti v zagonu");
    assert.ok(mestoRegistracije > 0 && mestoRegistracije < mestoUskladitve, "vezava mora biti vpisana pred uskladitvijo telefona");
    assert.match(vir, /import \{ registrirajVezoKlicev, uskladiAsistenta \} from "\.\/asistent-telefon\.server\.ts";/);
    assert.match(vir, /import \{ ustvariVezoKlicev \} from "\.\/openline-veza\.server\.ts";/);
  });
});
