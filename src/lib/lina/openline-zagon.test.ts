/**
 * Preizkusi zagona, idempotentnosti, varnosti in ustavitve OpenLine kot otroka Line.
 * Uporablja prave podprocese (child_process) na 127.0.0.x z laznimi vstopnimi datotekami
 * v zacasnih mapah. Vse vrednosti so izmisljene (brez osebnih podatkov in brez nizov CA+hex).
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import * as nodeModule from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { PRIVZETA_VRATA_OPENLINE } from "./openline-zagon-cista.ts";
import type { Odvisnosti, PripravaLine } from "./openline-zagon.server.ts";

// Ce v delovnem drevesu manjka adc.server.ts (.izloceno-po-vsebini.txt), registriramo
// zacasni nadomestek samo za neuporabljena uvoza v auth.server.ts in keys.server.ts.
// V polnem repozitoriju, kjer adc.server.ts obstaja, se kavelj ne registrira.
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

const { nastavitveOpenLine } = await import("./openline-povabilo.server.ts");
const { privzeteOdvisnosti, stanjeOpenLineProcesa, ustaviOpenLine, zagotoviOpenLine } = await import(
  "./openline-zagon.server.ts"
);

const ODTIS_OTROK_DVOPICJA =
  "11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00";
const ODTIS_OTROK_MALI = ODTIS_OTROK_DVOPICJA.replace(/:/g, "").toLowerCase();
const ODTIS_LINA = "0123456789abcdef".repeat(4);
const ZETON_LINA = "ZetonIzmisljen_9876543210-._~+/=Primer";

const PRICAKOVANI_KLJUCI_OKOLJA = [
  "DATA_DIR",
  "ELECTRON_RUN_AS_NODE",
  "HOST",
  "HTTP_GATEWAY_API_KEY",
  "LINA_ALLOWLIST_MODE",
  "LINA_CERT_SHA256",
  "LINA_STREAM_TOKEN",
  "LINA_STREAM_URL",
  "PORT",
  "PUBLIC_URL",
];

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

function laznaPripravaLine(popravki: Partial<PripravaLine> = {}): () => Promise<PripravaLine> {
  return async () => ({
    naslov: "127.0.0.1",
    vrata: 8447,
    odtis: ODTIS_LINA,
    zeton: ZETON_LINA,
    ...popravki,
  });
}

function vsebinaLaznegaOpenLine(opcije?: {
  vrataIzpis?: number;
  naslovIzpis?: string;
  odtisIzpis?: string;
}): string {
  const odtis = opcije?.odtisIzpis ?? ODTIS_OTROK_DVOPICJA;
  const hostExpr = opcije?.naslovIzpis ? JSON.stringify(opcije.naslovIzpis) : "process.env.HOST";
  const portExpr = opcije?.vrataIzpis !== undefined ? String(opcije.vrataIzpis) : "process.env.PORT";
  return [
    'import { mkdirSync, writeFileSync } from "node:fs";',
    'import path from "node:path";',
    "const dir = process.env.DATA_DIR;",
    "if (dir) {",
    "  mkdirSync(dir, { recursive: true });",
    '  writeFileSync(path.join(dir, "okolje.json"), JSON.stringify(Object.keys(process.env).sort()), "utf8");',
    "}",
    `process.stdout.write("OpenLine slusa na https://" + ${hostExpr} + ":" + ${portExpr} + "\\n");`,
    `process.stdout.write("Odtis certifikata SHA-256: " + ${JSON.stringify(odtis)} + "\\n");`,
    "setInterval(() => {}, 60000);",
  ].join("\n");
}

async function narediOkoljePreizkusa(
  vsebinaVstopne: string | null = vsebinaLaznegaOpenLine(),
): Promise<{
  baza: string;
  root: string;
  koren: string;
  vstopna: string;
  pocisti: () => Promise<void>;
}> {
  const baza = await mkdtemp(path.join(tmpdir(), "openline-zagon-test-"));
  const root = path.join(baza, "lina-podatki");
  const koren = path.join(baza, "openline-paket");
  const dist = path.join(koren, "dist");
  const vstopna = path.join(dist, "index.js");
  mkdirSync(root, { recursive: true });
  mkdirSync(dist, { recursive: true });
  if (vsebinaVstopne !== null) {
    writeFileSync(vstopna, vsebinaVstopne, "utf8");
  }
  return {
    baza,
    root,
    koren,
    vstopna,
    pocisti: async () => {
      await ustaviOpenLine(1500);
      await rm(baza, { recursive: true, force: true });
    },
  };
}

function ovitiZazeni(): {
  zazeni: Odvisnosti["zazeni"];
  stKlicev: () => number;
  pidi: number[];
  zadnjeOpcije: () => SpawnOptions | undefined;
} {
  let klici = 0;
  const pidi: number[] = [];
  let zadnje: SpawnOptions | undefined;
  const zazeni: Odvisnosti["zazeni"] = (ukaz, args, opcije) => {
    klici += 1;
    zadnje = opcije;
    const otrok = spawn(ukaz, args, opcije);
    if (typeof otrok.pid === "number") pidi.push(otrok.pid);
    return otrok;
  };
  return {
    zazeni,
    stKlicev: () => klici,
    pidi,
    zadnjeOpcije: () => zadnje,
  };
}

afterEach(async () => {
  await ustaviOpenLine(1500);
});

describe("openline-zagon.server in openline-start.mjs", () => {
  it("srecna pot: zazene otroka, zapise nastavitve in strogo omeji okolje otroka", async () => {
    const ok = await narediOkoljePreizkusa();
    const stariGemini = process.env.GEMINI_API_KEY;
    const stariTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    const dnevnikDogodki: string[] = [];
    const sled = ovitiZazeni();

    process.env.GEMINI_API_KEY = "IzmisljenGeminiKljuc_NeSmeVOtroka_999";
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    try {
      const stanje = await zagotoviOpenLine(ok.root, "127.0.0.1", {
        korenOpenLine: () => ok.koren,
        pripraviLino: laznaPripravaLine(),
        zazeni: sled.zazeni,
        dnevnik: (d) => dnevnikDogodki.push(d),
      });

      assert.equal(stanje.tece, true);
      assert.equal(stanje.naslov, "127.0.0.1");
      assert.ok(stanje.vrata >= PRIVZETA_VRATA_OPENLINE && stanje.vrata <= PRIVZETA_VRATA_OPENLINE + 7);
      assert.equal(stanje.odtis, ODTIS_OTROK_MALI);
      assert.deepEqual(stanjeOpenLineProcesa(), stanje);
      assert.equal(sled.stKlicev(), 1);
      assert.equal(sled.zadnjeOpcije()?.shell, false);
      assert.equal(sled.pidi.length, 1);
      assert.equal(aliProcesZivi(sled.pidi[0]), true);

      const shranjeno = await nastavitveOpenLine(ok.root);
      assert.ok(shranjeno !== null);
      assert.equal(shranjeno.vrata, stanje.vrata);
      assert.equal(shranjeno.odtis, stanje.odtis);
      assert.equal(shranjeno.naslov, "127.0.0.1");
      assert.ok(shranjeno.kljuc.length >= 32);
      assert.equal(shranjeno.kljuc, sled.zadnjeOpcije()?.env?.HTTP_GATEWAY_API_KEY);
      const suroveNastavitve = readFileSync(path.join(ok.root, "openline-povabilo.json"), "utf8");
      assert.equal(suroveNastavitve.includes(shranjeno.kljuc), false, "kljuc API mora biti sifriran na disku");

      // Okolje otroka ima tocno 10 pricakovanih imen, brez GEMINI_API_KEY in NODE_TLS_REJECT_UNAUTHORIZED.
      const potOkolja = path.join(ok.root, "openline", "okolje.json");
      const surovoOkolje = readFileSync(potOkolja, "utf8");
      const kljuciOkolja = JSON.parse(surovoOkolje) as string[];
      assert.deepEqual(kljuciOkolja, PRICAKOVANI_KLJUCI_OKOLJA);
      assert.equal(surovoOkolje.includes(shranjeno.kljuc), false, "kljuc API ne sme biti zapisan kot vrednost");
      assert.equal(surovoOkolje.includes(ZETON_LINA), false, "zeton ne sme biti zapisan");

      // Dnevnik ne vsebuje skrivnosti ali poti.
      const celDnevnik = dnevnikDogodki.join("\n");
      assert.equal(celDnevnik.includes(shranjeno.kljuc), false);
      assert.equal(celDnevnik.includes(ZETON_LINA), false);
      assert.equal(celDnevnik.includes(ODTIS_LINA), false);
      assert.equal(celDnevnik.includes(ok.baza), false);
    } finally {
      if (stariGemini === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = stariGemini;
      if (stariTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = stariTls;
      await ok.pocisti();
    }
  });

  it("idempotentnost: drugi klic in dva hkratna klica za isti naslov zazenejo en sam proces", async () => {
    const ok = await narediOkoljePreizkusa();
    const sled = ovitiZazeni();
    let stPriprav = 0;
    let stVrat = 0;

    const odv: Partial<Odvisnosti> = {
      korenOpenLine: () => ok.koren,
      zazeni: sled.zazeni,
      pripraviLino: async () => {
        stPriprav += 1;
        await new Promise((r) => setTimeout(r, 80));
        return laznaPripravaLine()();
      },
      prostaVrata: async (naslov) => {
        stVrat += 1;
        return privzeteOdvisnosti().prostaVrata(naslov);
      },
    };

    try {
      // Dva hkratna klica si delita eno obljubo.
      const [prvi, drugi] = await Promise.all([
        zagotoviOpenLine(ok.root, "127.0.0.1", odv),
        zagotoviOpenLine(ok.root, "127.0.0.1", odv),
      ]);
      assert.deepEqual(prvi, drugi);
      assert.equal(sled.stKlicev(), 1);
      assert.equal(stPriprav, 1);
      assert.equal(stVrat, 1);

      // Zaporedni klic za isti naslov ne klice pripraviLino, prostaVrata niti zazeni.
      const tretji = await zagotoviOpenLine(ok.root, "127.0.0.1", odv);
      assert.deepEqual(tretji, prvi);
      assert.equal(sled.stKlicev(), 1);
      assert.equal(stPriprav, 1);
      assert.equal(stVrat, 1);
    } finally {
      await ok.pocisti();
    }
  });

  it("drug naslov (127.0.0.2 ob prvem 127.0.0.1): ustavi star proces in zazene novega", async () => {
    const ok = await narediOkoljePreizkusa();
    const sled = ovitiZazeni();
    try {
      const s1 = await zagotoviOpenLine(ok.root, "127.0.0.1", {
        korenOpenLine: () => ok.koren,
        pripraviLino: laznaPripravaLine(),
        zazeni: sled.zazeni,
      });
      assert.equal(sled.pidi.length, 1);
      const pid1 = sled.pidi[0];
      assert.equal(aliProcesZivi(pid1), true);
      const n1 = await nastavitveOpenLine(ok.root);
      assert.ok(n1 !== null);

      const s2 = await zagotoviOpenLine(ok.root, "127.0.0.2", {
        korenOpenLine: () => ok.koren,
        pripraviLino: laznaPripravaLine(),
        zazeni: sled.zazeni,
      });
      assert.equal(sled.pidi.length, 2);
      const pid2 = sled.pidi[1];
      assert.notEqual(pid2, pid1);
      assert.equal(s2.tece, true);
      assert.equal(s2.naslov, "127.0.0.2");
      assert.equal(s1.naslov, "127.0.0.1");

      // Star proces ne obstaja vec.
      assert.equal(await pocakajPogoj(() => !aliProcesZivi(pid1), 2000), true, "star proces mora izginiti");
      assert.equal(aliProcesZivi(pid2), true, "nov proces mora teci");

      const n2 = await nastavitveOpenLine(ok.root);
      assert.ok(n2 !== null);
      assert.equal(n2.naslov, "127.0.0.2");
      assert.notEqual(n2.kljuc, n1.kljuc, "vsak zagon ustvari nov kljuc API");
    } finally {
      await ok.pocisti();
    }
  });

  it("napake: paket, manjkajoca vstopna, neveljaven naslov, manjkajoca pripraviLino", async () => {
    const okBrezVstopne = await narediOkoljePreizkusa(null);
    const okZ = await narediOkoljePreizkusa();
    try {
      await assert.rejects(
        zagotoviOpenLine(okZ.root, "127.0.0.1", {
          korenOpenLine: () => null,
          pripraviLino: laznaPripravaLine(),
        }),
        { message: "OpenLine ni v paketu" },
      );

      await assert.rejects(
        zagotoviOpenLine(okBrezVstopne.root, "127.0.0.1", {
          korenOpenLine: () => okBrezVstopne.koren,
          pripraviLino: laznaPripravaLine(),
        }),
        { message: "OpenLine ni v paketu" },
      );

      for (const slabNaslov of ["8.8.8.8", "0.0.0.0", "localhost", "::1", "127.0.0.01", "256.0.0.1"]) {
        await assert.rejects(
          zagotoviOpenLine(okZ.root, slabNaslov, {
            korenOpenLine: () => okZ.koren,
            pripraviLino: laznaPripravaLine(),
          }),
          (err: unknown) => {
            assert.ok(err instanceof Error);
            assert.equal(err.message, "naslov");
            assert.equal(err.message.includes(slabNaslov), false);
            return true;
          },
          `naslov ${slabNaslov} mora pasti`,
        );
      }

      // pripraviLino ni podana -> Error("odvisnost").
      await assert.rejects(
        zagotoviOpenLine(okZ.root, "127.0.0.1", {
          korenOpenLine: () => okZ.koren,
        }),
        { message: "odvisnost" },
      );

      assert.equal(stanjeOpenLineProcesa().tece, false);
      assert.equal(await nastavitveOpenLine(okZ.root), null);
      assert.equal(await nastavitveOpenLine(okBrezVstopne.root), null);
    } finally {
      await okBrezVstopne.pocisti();
      await okZ.pocisti();
    }
  });

  it("napake otroka: takoj pade, molci do roka, napacna vrata ali gostitelj; brez ostalih procesov in brez skrivnosti v napakah", async () => {
    const okPadec = await narediOkoljePreizkusa("process.exit(1);\n");
    const okMolci = await narediOkoljePreizkusa("setInterval(() => {}, 60000);\n");
    const okNapacnaVrata = await narediOkoljePreizkusa(vsebinaLaznegaOpenLine({ vrataIzpis: 9999 }));
    const okNapacenHost = await narediOkoljePreizkusa(vsebinaLaznegaOpenLine({ naslovIzpis: "127.0.0.9" }));

    const preveriBrezSkrivnosti = (sporocilo: string, baza: string, kljucApi?: string) => {
      if (kljucApi) {
        assert.equal(sporocilo.includes(kljucApi), false, "sporocilo ne sme vsebovati kljuca API");
      }
      assert.equal(sporocilo.includes(ZETON_LINA), false, "sporocilo ne sme vsebovati zetona");
      assert.equal(sporocilo.includes(ODTIS_LINA), false, "sporocilo ne sme vsebovati odtisa Line");
      assert.equal(sporocilo.includes(ODTIS_OTROK_MALI), false, "sporocilo ne sme vsebovati odtisa otroka");
      assert.equal(sporocilo.includes(baza), false, "sporocilo ne sme vsebovati poti");
    };

    try {
      // 1. Otrok pade takoj (process.exit(1)) -> Error brez cakanja celotnega roka (10 s).
      const sled1 = ovitiZazeni();
      const t0 = Date.now();
      await assert.rejects(
        zagotoviOpenLine(okPadec.root, "127.0.0.1", {
          korenOpenLine: () => okPadec.koren,
          pripraviLino: laznaPripravaLine(),
          zazeni: sled1.zazeni,
          rokPripravljenostiMs: 10000,
        }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.equal(err.message, "izhod");
          const kljuc = sled1.zadnjeOpcije()?.env?.HTTP_GATEWAY_API_KEY;
          assert.ok(typeof kljuc === "string" && kljuc.length >= 32);
          preveriBrezSkrivnosti(err.message, okPadec.baza, kljuc);
          return true;
        },
      );
      assert.ok(Date.now() - t0 < 3000, "predcasni izhod ne sme cakati celotnega roka");
      assert.equal(await pocakajPogoj(() => sled1.pidi.every((p) => !aliProcesZivi(p)), 2000), true);
      assert.equal(await nastavitveOpenLine(okPadec.root), null);

      // 2. Otrok ne izpise nic (rok 300 ms) -> Error in proces je ustavljen.
      const sled2 = ovitiZazeni();
      await assert.rejects(
        zagotoviOpenLine(okMolci.root, "127.0.0.1", {
          korenOpenLine: () => okMolci.koren,
          pripraviLino: laznaPripravaLine(),
          zazeni: sled2.zazeni,
          rokPripravljenostiMs: 300,
        }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.equal(err.message, "rok");
          const kljuc = sled2.zadnjeOpcije()?.env?.HTTP_GATEWAY_API_KEY;
          assert.ok(typeof kljuc === "string" && kljuc.length >= 32);
          preveriBrezSkrivnosti(err.message, okMolci.baza, kljuc);
          return true;
        },
      );
      assert.equal(sled2.pidi.length, 1);
      assert.equal(await pocakajPogoj(() => !aliProcesZivi(sled2.pidi[0]), 2000), true, "molceci otrok mora biti ustavljen");
      assert.equal(await nastavitveOpenLine(okMolci.root), null);

      // 3. Izpis z drugimi vrati -> Error("izpis") in proces ustavljen.
      const sled3 = ovitiZazeni();
      await assert.rejects(
        zagotoviOpenLine(okNapacnaVrata.root, "127.0.0.1", {
          korenOpenLine: () => okNapacnaVrata.koren,
          pripraviLino: laznaPripravaLine(),
          zazeni: sled3.zazeni,
        }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.equal(err.message, "izpis");
          const kljuc = sled3.zadnjeOpcije()?.env?.HTTP_GATEWAY_API_KEY;
          assert.ok(typeof kljuc === "string" && kljuc.length >= 32);
          preveriBrezSkrivnosti(err.message, okNapacnaVrata.baza, kljuc);
          return true;
        },
      );
      assert.equal(sled3.pidi.length, 1);
      assert.equal(await pocakajPogoj(() => !aliProcesZivi(sled3.pidi[0]), 2000), true, "otrok z napacnimi vrati mora biti ustavljen");
      assert.equal(await nastavitveOpenLine(okNapacnaVrata.root), null);

      // 4. Izpis z drugim gostiteljem -> Error("izpis") in proces ustavljen.
      const sled4 = ovitiZazeni();
      await assert.rejects(
        zagotoviOpenLine(okNapacenHost.root, "127.0.0.1", {
          korenOpenLine: () => okNapacenHost.koren,
          pripraviLino: laznaPripravaLine(),
          zazeni: sled4.zazeni,
        }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.equal(err.message, "izpis");
          const kljuc = sled4.zadnjeOpcije()?.env?.HTTP_GATEWAY_API_KEY;
          assert.ok(typeof kljuc === "string" && kljuc.length >= 32);
          preveriBrezSkrivnosti(err.message, okNapacenHost.baza, kljuc);
          return true;
        },
      );
      assert.equal(sled4.pidi.length, 1);
      assert.equal(await pocakajPogoj(() => !aliProcesZivi(sled4.pidi[0]), 2000), true, "otrok z napacnim naslovom mora biti ustavljen");
      assert.equal(await nastavitveOpenLine(okNapacenHost.root), null);
      assert.equal(stanjeOpenLineProcesa().tece, false);
    } finally {
      await okPadec.pocisti();
      await okMolci.pocisti();
      await okNapacnaVrata.pocisti();
      await okNapacenHost.pocisti();
    }
  });

  it("ustaviOpenLine: ustavi proces v <= 3 s, drugi klic ne vrze, stanje tece postane false", async () => {
    const ok = await narediOkoljePreizkusa();
    const sled = ovitiZazeni();
    try {
      await zagotoviOpenLine(ok.root, "127.0.0.1", {
        korenOpenLine: () => ok.koren,
        pripraviLino: laznaPripravaLine(),
        zazeni: sled.zazeni,
      });
      const pid = sled.pidi[0];
      assert.equal(aliProcesZivi(pid), true);

      const t0 = Date.now();
      await ustaviOpenLine();
      assert.ok(Date.now() - t0 <= 3000, "ustavitev mora koncati v <= 3 s");
      assert.equal(aliProcesZivi(pid), false, "proces mora izginiti");
      assert.equal(stanjeOpenLineProcesa().tece, false);

      // Drugi klic je idempotenten in nikoli ne vrze.
      await ustaviOpenLine();
      assert.equal(stanjeOpenLineProcesa().tece, false);
    } finally {
      await ok.pocisti();
    }
  });

  it("dve instanci modula (?instanca-a in ?instanca-b) si delita stanje, obljubo in ustavitev", async () => {
    const ok = await narediOkoljePreizkusa();
    type ZagonMod = typeof import("./openline-zagon.server.ts");
    const spA = "./openline-zagon.server.ts?instanca-a";
    const spB = "./openline-zagon.server.ts?instanca-b";
    const A = (await import(spA)) as ZagonMod;
    const B = (await import(spB)) as ZagonMod;
    const sledA = ovitiZazeni();
    const sledB = ovitiZazeni();

    try {
      assert.notEqual(A.zagotoviOpenLine, B.zagotoviOpenLine, "potrebujemo dve loceni instanci modula");

      const sA = await A.zagotoviOpenLine(ok.root, "127.0.0.1", {
        korenOpenLine: () => ok.koren,
        pripraviLino: laznaPripravaLine(),
        zazeni: sledA.zazeni,
      });
      assert.equal(sA.tece, true);
      assert.equal(B.stanjeOpenLineProcesa().tece, true);
      assert.deepEqual(B.stanjeOpenLineProcesa(), sA);

      let pripraviBKlici = 0;
      const sB = await B.zagotoviOpenLine(ok.root, "127.0.0.1", {
        korenOpenLine: () => ok.koren,
        pripraviLino: async () => {
          pripraviBKlici += 1;
          return laznaPripravaLine()();
        },
        zazeni: sledB.zazeni,
      });
      assert.deepEqual(sB, sA);
      assert.equal(sledA.stKlicev(), 1);
      assert.equal(sledB.stKlicev(), 0, "instanca B ne sme zagnati novega procesa");
      assert.equal(pripraviBKlici, 0, "instanca B ne sme klicati pripraviLino");

      const pid = sledA.pidi[0];
      await B.ustaviOpenLine();
      assert.equal(A.stanjeOpenLineProcesa().tece, false);
      assert.equal(B.stanjeOpenLineProcesa().tece, false);
      assert.equal(await pocakajPogoj(() => !aliProcesZivi(pid), 2000), true);

      // Hkratni zagon iz A in B hkrati si deli eno obljubo in en proces.
      const sledSkupaj = ovitiZazeni();
      const odvSkupaj: Partial<Odvisnosti> = {
        korenOpenLine: () => ok.koren,
        zazeni: sledSkupaj.zazeni,
        pripraviLino: async () => {
          await new Promise((r) => setTimeout(r, 60));
          return laznaPripravaLine()();
        },
      };
      const [rA, rB] = await Promise.all([
        A.zagotoviOpenLine(ok.root, "127.0.0.1", odvSkupaj),
        B.zagotoviOpenLine(ok.root, "127.0.0.1", odvSkupaj),
      ]);
      assert.deepEqual(rA, rB);
      assert.equal(sledSkupaj.stKlicev(), 1, "hkratna klica iz A in B morata zagnati en proces");
    } finally {
      await B.ustaviOpenLine(1500);
      await A.ustaviOpenLine(1500);
      await ok.pocisti();
    }
  });

  it("sirota (openline-start.mjs): zaprtje stdin konca s kodo 0, brez poti koda 2, napaka uvoza koda 3 brez skrivnosti", async () => {
    const ok = await narediOkoljePreizkusa();
    const zaganjalnik = privzeteOdvisnosti().zaganjalnik();
    const SKRIVNOST = "SkrivnostUvoza_NeSmeVStderr_778899";
    const potNapake = path.join(ok.baza, "vrzi-napako.mjs");
    writeFileSync(potNapake, `throw new Error("padec z " + ${JSON.stringify(SKRIVNOST)});\n`, "utf8");

    const zivi: ChildProcess[] = [];
    try {
      // 1. Zaprtje stdin -> izhod s kodo 0 v <= 2 s.
      const otrok1 = spawn(process.execPath, [zaganjalnik, ok.vstopna], {
        env: { HOST: "127.0.0.1", PORT: "8790", DATA_DIR: path.join(ok.root, "sirota") },
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      });
      zivi.push(otrok1);
      await new Promise<void>((resolve, reject) => {
        const cas = setTimeout(() => reject(new Error("otrok ni izpisal")), 4000);
        let buf = "";
        otrok1.stdout?.on("data", (k: Buffer) => {
          buf += k.toString("utf8");
          if (buf.includes("Odtis certifikata SHA-256:")) {
            clearTimeout(cas);
            resolve();
          }
        });
        otrok1.once("exit", () => {
          clearTimeout(cas);
          reject(new Error("predcasen izhod"));
        });
      });

      const t0 = Date.now();
      const koda1 = await new Promise<number | null>((resolve) => {
        otrok1.once("exit", (code) => resolve(code));
        otrok1.stdin?.end();
      });
      assert.equal(koda1, 0);
      assert.ok(Date.now() - t0 <= 2000, "zaganjalnik se mora koncati v <= 2 s po zaprtju stdin");

      // 2. Brez poti in z relativno potjo -> koda 2 in stderr "zaganjalnik: manjka pot".
      for (const args of [[zaganjalnik], [zaganjalnik, "relativna/index.js"]]) {
        const izid = await new Promise<{ koda: number | null; stderr: string }>((resolve) => {
          const p = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"], shell: false });
          zivi.push(p);
          let stderr = "";
          p.stderr?.on("data", (k: Buffer) => {
            stderr += k.toString("utf8");
          });
          p.once("close", (koda) => resolve({ koda, stderr }));
        });
        assert.equal(izid.koda, 2);
        assert.equal(izid.stderr.trim(), "zaganjalnik: manjka pot");
      }

      // 3. Vstopna datoteka vrze napako s skrivnostjo -> koda 3, skrivnosti NI v stderr.
      const izidNapake = await new Promise<{ koda: number | null; stderr: string }>((resolve) => {
        const p = spawn(process.execPath, [zaganjalnik, potNapake], {
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
        });
        zivi.push(p);
        let stderr = "";
        p.stderr?.on("data", (k: Buffer) => {
          stderr += k.toString("utf8");
        });
        p.once("close", (koda) => resolve({ koda, stderr }));
      });
      assert.equal(izidNapake.koda, 3);
      assert.equal(izidNapake.stderr.trim(), "zaganjalnik: uvoz ni uspel");
      assert.equal(izidNapake.stderr.includes(SKRIVNOST), false, "skrivnost ne sme pricurljati v stderr");
    } finally {
      for (const p of zivi) {
        if (p.exitCode === null && p.signalCode === null) {
          try {
            p.kill("SIGKILL");
          } catch {
            // ze koncan
          }
        }
      }
      await ok.pocisti();
    }
  });

  it("nepricakovan izhod (SIGKILL): stanje postane false v <= 2 s, naslednji zagon zazene nov proces", async () => {
    const ok = await narediOkoljePreizkusa();
    const sled = ovitiZazeni();
    try {
      await zagotoviOpenLine(ok.root, "127.0.0.1", {
        korenOpenLine: () => ok.koren,
        pripraviLino: laznaPripravaLine(),
        zazeni: sled.zazeni,
      });
      const pid1 = sled.pidi[0];
      const n1 = await nastavitveOpenLine(ok.root);
      assert.ok(n1 !== null);
      assert.equal(stanjeOpenLineProcesa().tece, true);

      process.kill(pid1, "SIGKILL");
      assert.equal(
        await pocakajPogoj(() => !stanjeOpenLineProcesa().tece, 2000),
        true,
        "stanje mora postati false v <= 2 s po SIGKILL",
      );

      // Naslednji klic zazene nov proces z novim kljucem.
      const s2 = await zagotoviOpenLine(ok.root, "127.0.0.1", {
        korenOpenLine: () => ok.koren,
        pripraviLino: laznaPripravaLine(),
        zazeni: sled.zazeni,
      });
      assert.equal(s2.tece, true);
      assert.equal(sled.pidi.length, 2);
      assert.notEqual(sled.pidi[1], pid1);
      assert.equal(aliProcesZivi(sled.pidi[1]), true);
      const n2 = await nastavitveOpenLine(ok.root);
      assert.ok(n2 !== null);
      assert.notEqual(n2.kljuc, n1.kljuc);
    } finally {
      await ok.pocisti();
    }
  });

  it("privzeta prostaVrata: preskoci zasedena privzeta vrata in najde naslednja prosta", async () => {
    const zasedi = net.createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        zasedi.once("error", reject);
        zasedi.listen({ host: "127.0.0.1", port: PRIVZETA_VRATA_OPENLINE, exclusive: true }, () => resolve());
      });
      const vrata = await privzeteOdvisnosti().prostaVrata("127.0.0.1");
      assert.ok(vrata > PRIVZETA_VRATA_OPENLINE && vrata <= PRIVZETA_VRATA_OPENLINE + 7);
    } finally {
      await new Promise<void>((resolve) => zasedi.close(() => resolve()));
    }
  });

  it("napaka pri zapisu nastavitev ustavi zagnanega otroka in ne pusti stanja tece", async () => {
    const ok = await narediOkoljePreizkusa();
    const sled = ovitiZazeni();
    const slabRoot = path.join(ok.baza, "ni-mapa");
    writeFileSync(slabRoot, "datoteka-namesto-mape", "utf8");
    const dataMapa = path.join(ok.baza, "podatki-ol");
    try {
      await assert.rejects(
        zagotoviOpenLine(slabRoot, "127.0.0.1", {
          korenOpenLine: () => ok.koren,
          pripraviLino: laznaPripravaLine(),
          dataDir: () => dataMapa,
          zazeni: sled.zazeni,
        }),
        Error,
      );
      assert.equal(sled.pidi.length, 1);
      assert.equal(await pocakajPogoj(() => !aliProcesZivi(sled.pidi[0]), 2000), true, "otrok mora biti ustavljen");
      assert.equal(stanjeOpenLineProcesa().tece, false);
    } finally {
      await ok.pocisti();
    }
  });

  it("ustaviOpenLine: ce otrok ignorira zaprtje stdin, ga ustavi s SIGTERM", async () => {
    const ok = await narediOkoljePreizkusa();
    const sled = ovitiZazeni();
    const trmastZaganjalnik = path.join(ok.baza, "trmast-zaganjalnik.mjs");
    writeFileSync(
      trmastZaganjalnik,
      [
        'import { pathToFileURL } from "node:url";',
        "process.stdin.resume();",
        "// Namenoma prezre end/close na stdin, odzove se sele na SIGTERM.",
        "await import(pathToFileURL(process.argv[2]).href);",
      ].join("\n"),
      "utf8",
    );
    try {
      await zagotoviOpenLine(ok.root, "127.0.0.1", {
        korenOpenLine: () => ok.koren,
        pripraviLino: laznaPripravaLine(),
        zaganjalnik: () => trmastZaganjalnik,
        rokUstavitveMs: 150,
        zazeni: sled.zazeni,
      });
      const pid = sled.pidi[0];
      assert.equal(aliProcesZivi(pid), true);

      await ustaviOpenLine(150);
      assert.equal(await pocakajPogoj(() => !aliProcesZivi(pid), 2000), true, "SIGTERM mora ustaviti otroka");
      assert.equal(stanjeOpenLineProcesa().tece, false);
    } finally {
      await ok.pocisti();
    }
  });
});
