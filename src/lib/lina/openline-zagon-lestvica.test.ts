/**
 * Dopolnilni preizkusi zagona OpenLine (lestvica ustavljanja, zivost otroka, praznjenje cevi, razveljavitev priprave).
 * Dopolnjujejo openline-zagon.test.ts: tam je dokaz le, da otrok na koncu umre, tukaj je dokaz, KATERI signal ga je ustavil
 * (SIGTERM ali SIGKILL), da stanje ne trdi "tece" za mrtvega otroka, da otrok z veliko izpisa ne obvisi in da ustavitev
 * med pripravo ne pusti novega procesa. Prave podprocese na 127.0.0.1, vse vrednosti izmisljene.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import type { Odvisnosti, PripravaLine } from "./openline-zagon.server.ts";

// Enako kot v openline-zagon.test.ts: nadomestek za adc.server.ts, ce je izlocen iz drevesa.
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

const { stanjeOpenLineProcesa, ustaviOpenLine, zagotoviOpenLine } = await import("./openline-zagon.server.ts");

const ODTIS_OTROK =
  "11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00";
const ODTIS_LINA = "0123456789abcdef".repeat(4);
const ZETON_LINA = "ZetonIzmisljen_9876543210-._~+/=Primer";

function aliProcesZivi(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function pocakajPogoj(pogoj: () => boolean, rokMs: number): Promise<boolean> {
  const konec = Date.now() + rokMs;
  while (Date.now() < konec) {
    if (pogoj()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return pogoj();
}

function laznaPripravaLine(): () => Promise<PripravaLine> {
  return async () => ({ naslov: "127.0.0.1", vrata: 8447, odtis: ODTIS_LINA, zeton: ZETON_LINA });
}

/** Navadna lazna vstopna datoteka OpenLine: izpise obe vrstici in caka. */
const VSTOPNA_NAVADNA = [
  'import { mkdirSync, writeFileSync } from "node:fs";',
  'import path from "node:path";',
  "if (process.env.DATA_DIR) {",
  "  mkdirSync(process.env.DATA_DIR, { recursive: true });",
  '  writeFileSync(path.join(process.env.DATA_DIR, "cwd.txt"), process.cwd(), "utf8");',
  "}",
  'process.stdout.write("OpenLine slusa na https://" + process.env.HOST + ":" + process.env.PORT + "\\n");',
  `process.stdout.write("Odtis certifikata SHA-256: ${ODTIS_OTROK}\\n");`,
  "setInterval(() => {}, 60000);",
].join("\n");

/** Vstopna datoteka, ki 400 ms po pripravljenosti izpisuje po 1 MB na stderr in stdout in nato zapise oznako. */
const VSTOPNA_HRUPNA = [
  'import { mkdirSync, writeFileSync } from "node:fs";',
  'import path from "node:path";',
  "const dir = process.env.DATA_DIR;",
  "mkdirSync(dir, { recursive: true });",
  'process.stdout.write("OpenLine slusa na https://" + process.env.HOST + ":" + process.env.PORT + "\\n");',
  `process.stdout.write("Odtis certifikata SHA-256: ${ODTIS_OTROK}\\n");`,
  'const kos = "x".repeat(1023) + "\\n";',
  "let n = 0;",
  "function naprej() {",
  '  if (n >= 1024) { writeFileSync(path.join(dir, "izpis-konec.txt"), "ok"); return; }',
  "  n += 1;",
  "  process.stderr.write(kos, () => process.stdout.write(kos, naprej));",
  "}",
  "setTimeout(naprej, 400);",
  "setInterval(() => {}, 60000);",
].join("\n");

/** Zaganjalnik, ki prezre zaprtje stdin; na SIGTERM zapise oznako in se konca sam. */
const ZAGANJALNIK_TERM = [
  'import { writeFileSync } from "node:fs";',
  'import path from "node:path";',
  'import { pathToFileURL } from "node:url";',
  "process.stdin.resume();",
  'process.on("SIGTERM", () => {',
  '  writeFileSync(path.join(process.env.DATA_DIR, "sigterm.txt"), "1");',
  "  process.exit(0);",
  "});",
  "await import(pathToFileURL(process.argv[2]).href);",
].join("\n");

/** Zaganjalnik, ki prezre zaprtje stdin IN SIGTERM: ustavi ga lahko samo SIGKILL. */
const ZAGANJALNIK_TRMAST = [
  'import { pathToFileURL } from "node:url";',
  "process.stdin.resume();",
  'process.on("SIGTERM", () => {});',
  "await import(pathToFileURL(process.argv[2]).href);",
].join("\n");

async function narediOkolje(vstopna: string = VSTOPNA_NAVADNA): Promise<{
  baza: string;
  root: string;
  koren: string;
  pocisti: () => Promise<void>;
}> {
  const baza = await mkdtemp(path.join(tmpdir(), "openline-lestvica-test-"));
  const root = path.join(baza, "lina-podatki");
  const koren = path.join(baza, "openline-paket");
  mkdirSync(root, { recursive: true });
  mkdirSync(path.join(koren, "dist"), { recursive: true });
  writeFileSync(path.join(koren, "dist", "index.js"), vstopna, "utf8");
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

function sledenje(izhodSlusalec?: () => void): {
  zazeni: Odvisnosti["zazeni"];
  pidi: number[];
  stKlicev: () => number;
} {
  const pidi: number[] = [];
  let klici = 0;
  return {
    zazeni: (ukaz, args, opcije) => {
      klici += 1;
      const otrok = spawn(ukaz, args, opcije);
      if (typeof otrok.pid === "number") pidi.push(otrok.pid);
      // Poslusalec je vezan PRED poslusalci modula, zato se sprozi prvi.
      if (izhodSlusalec) otrok.once("exit", izhodSlusalec);
      return otrok;
    },
    pidi,
    stKlicev: () => klici,
  };
}

function poskusiUbiti(pid: number | undefined): void {
  if (typeof pid !== "number") return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // ze ne obstaja
  }
}

afterEach(async () => {
  await ustaviOpenLine(1500);
});

describe("openline-zagon.server: lestvica ustavljanja, zivost, cevi, razveljavitev", () => {
  it("SIGTERM: otrok, ki prezre zaprtje stdin, se ustavi s SIGTERM (oznaka), ustavitev pa pocaka rok", async () => {
    const ok = await narediOkolje();
    const sled = sledenje();
    const zaganjalnik = path.join(ok.baza, "zaganjalnik-term.mjs");
    writeFileSync(zaganjalnik, ZAGANJALNIK_TERM, "utf8");
    try {
      await zagotoviOpenLine(ok.root, "127.0.0.1", {
        korenOpenLine: () => ok.koren,
        pripraviLino: laznaPripravaLine(),
        zaganjalnik: () => zaganjalnik,
        rokUstavitveMs: 300,
        zazeni: sled.zazeni,
      });
      const pid = sled.pidi[0];
      assert.equal(aliProcesZivi(pid), true);

      const t0 = Date.now();
      await ustaviOpenLine(300);
      const trajanje = Date.now() - t0;

      assert.equal(
        existsSync(path.join(ok.root, "openline", "sigterm.txt")),
        true,
        "otrok mora dobiti SIGTERM in ga obdelati (z SIGKILL oznake ne bi bilo)",
      );
      assert.equal(await pocakajPogoj(() => !aliProcesZivi(pid), 1000), true);
      assert.ok(trajanje >= 250, `ustavitev mora najprej pocakati rok za zaprtje stdin (trajalo ${trajanje} ms)`);
      assert.ok(trajanje < 2500, `SIGTERM ne sme cakati se SIGKILL (trajalo ${trajanje} ms)`);
      assert.equal(stanjeOpenLineProcesa().tece, false);
    } finally {
      for (const pid of sled.pidi) poskusiUbiti(pid);
      await ok.pocisti();
    }
  });

  it("SIGKILL: otrok, ki prezre zaprtje stdin in SIGTERM, je po ustaviOpenLine res mrtev (zadnja stopnja lestvice)", async () => {
    const ok = await narediOkolje();
    const sled = sledenje();
    const zaganjalnik = path.join(ok.baza, "zaganjalnik-trmast.mjs");
    writeFileSync(zaganjalnik, ZAGANJALNIK_TRMAST, "utf8");
    try {
      await zagotoviOpenLine(ok.root, "127.0.0.1", {
        korenOpenLine: () => ok.koren,
        pripraviLino: laznaPripravaLine(),
        zaganjalnik: () => zaganjalnik,
        rokUstavitveMs: 300,
        zazeni: sled.zazeni,
      });
      const pid = sled.pidi[0];
      assert.equal(aliProcesZivi(pid), true);

      const t0 = Date.now();
      await ustaviOpenLine(300);
      const trajanje = Date.now() - t0;

      assert.equal(await pocakajPogoj(() => !aliProcesZivi(pid), 1000), true, "trmast otrok mora umreti od SIGKILL");
      assert.ok(trajanje >= 540, `pred SIGKILL morata preteci oba roka (trajalo ${trajanje} ms)`);
      assert.ok(trajanje < 4000, `ustavitev mora biti omejena (trajalo ${trajanje} ms)`);
      assert.equal(stanjeOpenLineProcesa().tece, false);
    } finally {
      for (const pid of sled.pidi) poskusiUbiti(pid);
      await ok.pocisti();
    }
  });

  it("zivost: ob zunanjem SIGKILL otroka stanje tece ze znotraj prvega poslusalca 'exit' ni vec true, naslednji zagon je nov proces", async () => {
    const ok = await narediOkolje();
    const vIzhodu: boolean[] = [];
    const sled = sledenje(() => {
      vIzhodu.push(stanjeOpenLineProcesa().tece);
    });
    try {
      const stanje = await zagotoviOpenLine(ok.root, "127.0.0.1", {
        korenOpenLine: () => ok.koren,
        pripraviLino: laznaPripravaLine(),
        zazeni: sled.zazeni,
      });
      assert.equal(stanje.tece, true);
      assert.equal(stanjeOpenLineProcesa().tece, true);
      const prvi = sled.pidi[0];

      process.kill(prvi, "SIGKILL");
      assert.equal(await pocakajPogoj(() => vIzhodu.length === 1, 3000), true, "otrok mora izstopiti");
      assert.deepEqual(vIzhodu, [false], "stanje ne sme trditi, da mrtev otrok tece");
      assert.equal(await pocakajPogoj(() => !stanjeOpenLineProcesa().tece, 1000), true);

      const novo = await zagotoviOpenLine(ok.root, "127.0.0.1", {
        korenOpenLine: () => ok.koren,
        pripraviLino: laznaPripravaLine(),
        zazeni: sled.zazeni,
      });
      assert.equal(novo.tece, true);
      assert.equal(sled.stKlicev(), 2, "po smrti otroka mora zagotoviOpenLine zagnati nov proces");
      assert.notEqual(sled.pidi[1], prvi);
      assert.equal(aliProcesZivi(sled.pidi[1]), true);
    } finally {
      for (const pid of sled.pidi) poskusiUbiti(pid);
      await ok.pocisti();
    }
  });

  it("cevi: otrok, ki po pripravljenosti izpise po 1 MB na stderr in stdout, ne obvisi (obe cevi se praznita)", async () => {
    const ok = await narediOkolje(VSTOPNA_HRUPNA);
    const sled = sledenje();
    try {
      const stanje = await zagotoviOpenLine(ok.root, "127.0.0.1", {
        korenOpenLine: () => ok.koren,
        pripraviLino: laznaPripravaLine(),
        zazeni: sled.zazeni,
      });
      assert.equal(stanje.tece, true);
      const oznaka = path.join(ok.root, "openline", "izpis-konec.txt");
      assert.equal(
        await pocakajPogoj(() => existsSync(oznaka), 8000),
        true,
        "otrok mora izpisati ves izpis; ce ne, se cev ne prazni in otrok obvisi",
      );
      assert.equal(stanjeOpenLineProcesa().tece, true);
    } finally {
      for (const pid of sled.pidi) poskusiUbiti(pid);
      await ok.pocisti();
    }
  });

  it("ustaviOpenLine med pripravo (pripraviLino se se izvaja): zagon se razveljavi, otrok se ne zazene", async () => {
    const ok = await narediOkolje();
    const sled = sledenje();
    let sprosti!: () => void;
    const vrata = new Promise<void>((r) => {
      sprosti = r;
    });
    try {
      const zagon = zagotoviOpenLine(ok.root, "127.0.0.1", {
        korenOpenLine: () => ok.koren,
        pripraviLino: async () => {
          await vrata;
          return { naslov: "127.0.0.1", vrata: 8447, odtis: ODTIS_LINA, zeton: ZETON_LINA };
        },
        zazeni: sled.zazeni,
      });
      const izid = zagon.then(
        () => null,
        (e: unknown) => e,
      );
      await new Promise((r) => setTimeout(r, 50));

      const ustavitev = ustaviOpenLine(1000);
      sprosti();
      await ustavitev;
      const napaka = await izid;

      assert.ok(napaka instanceof Error, "zagon, ki ga je ustavitev prehitela, mora vreci napako");
      assert.equal((napaka as Error).message, "OpenLine se ni pripravil");
      assert.equal(sled.stKlicev(), 0, "po ustavitvi se noben proces ne sme zagnati");
      assert.equal(stanjeOpenLineProcesa().tece, false);
    } finally {
      for (const pid of sled.pidi) poskusiUbiti(pid);
      await ok.pocisti();
    }
  });

  it("dnevnik, ki vedno vrze, ne prekine zagona, ustavitve ni ne zamenjave procesa", async () => {
    const ok = await narediOkolje();
    const sled = sledenje();
    let klicevDnevnika = 0;
    const dnevnik = () => {
      klicevDnevnika += 1;
      throw new Error("dnevnik pokvarjen");
    };
    try {
      const stanje = await zagotoviOpenLine(ok.root, "127.0.0.1", {
        korenOpenLine: () => ok.koren,
        pripraviLino: laznaPripravaLine(),
        zazeni: sled.zazeni,
        dnevnik,
      });
      assert.equal(stanje.tece, true, "zagon mora uspeti kljub pokvarjenemu dnevniku");
      assert.equal(stanjeOpenLineProcesa().tece, true);
      const pid = sled.pidi[0];
      assert.equal(aliProcesZivi(pid), true);

      // Zamenjava naslova prav tako zapise v dnevnik: tudi ta pot mora preziveti.
      const drugi = await zagotoviOpenLine(ok.root, "127.0.0.2", {
        korenOpenLine: () => ok.koren,
        pripraviLino: laznaPripravaLine(),
        zazeni: sled.zazeni,
        dnevnik,
      });
      assert.equal(drugi.tece, true);
      assert.equal(drugi.naslov, "127.0.0.2");
      assert.equal(await pocakajPogoj(() => !aliProcesZivi(pid), 3000), true, "prvi proces mora biti ustavljen");

      await ustaviOpenLine(1000);
      assert.equal(stanjeOpenLineProcesa().tece, false);
      assert.ok(klicevDnevnika >= 4, `dnevnik mora biti klican (klicev: ${klicevDnevnika})`);
    } finally {
      for (const pid of sled.pidi) poskusiUbiti(pid);
      await ok.pocisti();
    }
  });

  it("cwd otroka je koren paketa OpenLine (ne korenski imenik ali delovni imenik Line)", async () => {
    const ok = await narediOkolje();
    const sled = sledenje();
    try {
      await zagotoviOpenLine(ok.root, "127.0.0.1", {
        korenOpenLine: () => ok.koren,
        pripraviLino: laznaPripravaLine(),
        zazeni: sled.zazeni,
      });
      const oznaka = path.join(ok.root, "openline", "cwd.txt");
      assert.equal(await pocakajPogoj(() => existsSync(oznaka), 3000), true);
      assert.equal(realpathSync(readFileSync(oznaka, "utf8")), realpathSync(ok.koren));
    } finally {
      for (const pid of sled.pidi) poskusiUbiti(pid);
      await ok.pocisti();
    }
  });

  it("otrok, ki umre med zapisom nastavitev, ni 'pripravljen': zagon vrze, stanje je false", async () => {
    const ok = await narediOkolje();
    const pidi: number[] = [];
    const zazeni: Odvisnosti["zazeni"] = (ukaz, args, opcije) => {
      const otrok = spawn(ukaz, args, opcije);
      if (typeof otrok.pid === "number") pidi.push(otrok.pid);
      // Poslusalec je vezan pred poslusalcem modula: v trenutku, ko prispe izpis odtisa (pripravljenost), otroka ubije.
      otrok.stdout?.on("data", (kos: Buffer | string) => {
        if (String(kos).includes("Odtis certifikata") && typeof otrok.pid === "number") {
          poskusiUbiti(otrok.pid);
        }
      });
      return otrok;
    };
    try {
      let napaka: unknown = null;
      try {
        await zagotoviOpenLine(ok.root, "127.0.0.1", {
          korenOpenLine: () => ok.koren,
          pripraviLino: laznaPripravaLine(),
          zazeni,
        });
      } catch (e) {
        napaka = e;
      }
      assert.ok(napaka instanceof Error, "mrtev otrok ne sme biti javljen kot pripravljen");
      assert.equal((napaka as Error).message, "izhod"); // naloga 33: vzrok, ne obce »se ni pripravil«
      assert.equal(stanjeOpenLineProcesa().tece, false);
    } finally {
      for (const pid of pidi) poskusiUbiti(pid);
      await ok.pocisti();
    }
  });
});
