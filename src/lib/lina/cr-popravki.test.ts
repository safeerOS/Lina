/**
 * Popravki po pregledu kode CodeRabbit (rezina 1, 21. 11. 2026). Vsak preizkus je napisan tako, da brez popravka PADE:
 * systemd (% in $ v poteh), ime uporabnika »safeer«, tekma pri obnovi zastarelega zaklepa, streznik ob ubitem ovoju,
 * nepricakovan signal streznika (koda izhoda), odstranitev storitve, ki je ni mogoce ustaviti.
 */
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { odstrani } from "../../../scripts/sluzba.mjs";
import { mapaJeSafeerjeva, sestaviEnoto, zakleni } from "../../../scripts/zagon-lina.mjs";

const KOREN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const START = path.join(KOREN, "scripts", "start.mjs");
const TMP = mkdtempSync(path.join(tmpdir(), "lina-cr-"));
const otroci = new Set<ChildProcess>();

after(() => {
  for (const o of otroci) {
    if (o.exitCode === null && o.signalCode === null) o.kill("SIGKILL");
  }
  rmSync(TMP, { recursive: true, force: true });
});

let stevec = 0;
const novaMapa = (ime: string) => {
  const mapa = path.join(TMP, `${ime}-${(stevec += 1)}`);
  mkdirSync(mapa, { recursive: true });
  return mapa;
};

/** PID procesa, ki ga ni vec (zaklep s takim PID je zastarel). */
async function mrtevPid(): Promise<number> {
  const p = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((resolve) => p.on("exit", resolve));
  return p.pid as number;
}

/** Zivi proces (nadomesti streznik, ki tece naprej po ubitem ovoju). */
function ziviProces(): number {
  const p = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  otroci.add(p);
  return p.pid as number;
}

function prostaVrata(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const v = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(v));
    });
  });
}

type Zagnan = { proces: ChildProcess; izpis: () => string; konec: Promise<number | null> };

function zazeniLino(okolje: Record<string, string>): Zagnan {
  const proces = spawn(process.execPath, [START], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...okolje },
    stdio: ["ignore", "pipe", "pipe"],
  });
  otroci.add(proces);
  let izpis = "";
  proces.stdout?.on("data", (b) => (izpis += String(b)));
  proces.stderr?.on("data", (b) => (izpis += String(b)));
  const konec = new Promise<number | null>((resolve) => proces.on("exit", (koda) => resolve(koda)));
  return { proces, izpis: () => izpis, konec };
}

const koncaSe = (z: Zagnan) => Promise.race([z.konec, new Promise<string>((r) => setTimeout(() => r("ne-konca-se"), 10000))]);

async function pocakaj(pogoj: () => boolean, ms = 8000): Promise<void> {
  const rok = Date.now() + ms;
  while (Date.now() < rok) {
    if (pogoj()) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error("Cakanje je poteklo.");
}

const LAZNI = path.join(TMP, "lazni-streznik.mjs");
writeFileSync(LAZNI, `import http from "node:http";\nhttp.createServer((q, r) => r.end("lina")).listen(Number(process.env.PORT), "127.0.0.1");\n`);
const UMIRA = path.join(TMP, "streznik-sigkill.mjs");
writeFileSync(UMIRA, `process.kill(process.pid, "SIGKILL");\n`);

const okoljeLine = (mapa: string, vrata: number, streznik: string): Record<string, string> => ({
  HOME: TMP,
  XDG_RUNTIME_DIR: TMP,
  LINA_DATA: mapa,
  LINA_VRATA: String(vrata),
  LINA_STREZNIK: streznik,
});

describe("Lina: popravki po pregledu kode (CodeRabbit)", { concurrency: 1 }, () => {
  it("enota systemd: % je %%, v ExecStart je $ tudi $$ (specifikatorji in spremenljivke)", () => {
    const enota = sestaviEnoto({ node: "/opt/a%b/node", koren: "/home/u/Lina%q$x" });
    assert.match(enota, /^WorkingDirectory="\/home\/u\/Lina%%q\$x"$/m);
    assert.match(enota, /^ExecStart="\/opt\/a%%b\/node" "\/home\/u\/Lina%%q\$\$x\/scripts\/start\.mjs"$/m);
  });

  it("ime uporabnika »safeer« ni mapa Safeerja; mapa Safeerja pod domaco mapo je se vedno zavrnjena", () => {
    assert.equal(mapaJeSafeerjeva("/home/safeer/.local/share/lina", "/home/safeer"), false);
    assert.equal(mapaJeSafeerjeva("/home/safeer/.config/safeer-mint/lina", "/home/safeer"), true);
    assert.equal(mapaJeSafeerjeva("/srv/safeer/lina", "/home/safeer"), true);
    assert.equal(mapaJeSafeerjeva("/home/safeer/.local/share/lina"), true, "brez domace mape velja staro pravilo");
  });

  it("zaklep: obnovo zastarelega zaklepa opravlja samo en zagon (drug zagon ne sme izbrisati zaklepa)", async () => {
    const mapa = novaMapa("obnova");
    const zaklep = path.join(mapa, "lina.lock");
    const stari = JSON.stringify({ pid: await mrtevPid(), zacetek: "1", zeton: "stari", vrata: 1, safeerOs: false });
    writeFileSync(zaklep, stari);
    writeFileSync(path.join(mapa, "lina.lock.obnova"), ""); // drug zagon ravnokar obnavlja
    assert.throws(() => zakleni(mapa), /Zaklepa instance Line ni bilo mogoce vzeti/);
    assert.equal(readFileSync(zaklep, "utf8"), stari, "zaklepa med tujo obnovo ne smemo brisati");
  });

  it("zaklep: ostanek obnove (proces je umrl vmes) ne blokira zagona; po obnovi ostane samo lina.lock", async () => {
    const mapa = novaMapa("ostanek");
    const obnova = path.join(mapa, "lina.lock.obnova");
    writeFileSync(path.join(mapa, "lina.lock"), JSON.stringify({ pid: await mrtevPid(), zacetek: "1", zeton: "stari", vrata: 1, safeerOs: false }));
    writeFileSync(obnova, "");
    const pred = new Date(Date.now() - 60_000);
    utimesSync(obnova, pred, pred);
    const z = zakleni(mapa);
    assert.equal(z.ok, true);
    assert.equal(existsSync(obnova), false);
    z.sprosti();
  });

  it("zaklep: streznik, ki tece naprej po ubitem ovoju, drzi zaklep (ovoj mrtev, otrok zivi)", async () => {
    const mapa = novaMapa("otrok");
    const zaklep = path.join(mapa, "lina.lock");
    const otrok = ziviProces();
    writeFileSync(zaklep, JSON.stringify({ pid: await mrtevPid(), zacetek: "1", zeton: "ovoj", otrok, otrokZacetek: null, vrata: 1, safeerOs: false }));
    assert.equal(zakleni(mapa).ok, false);
    // PID otroka je bil ponovno uporabljen (drug cas zacetka): zaklep je zastarel
    writeFileSync(zaklep, JSON.stringify({ pid: await mrtevPid(), zacetek: "1", zeton: "ovoj", otrok, otrokZacetek: "1", vrata: 1, safeerOs: false }));
    const z = zakleni(mapa);
    assert.equal(z.ok, true);
    z.sprosti();
  });

  it("start: nepricakovan signal streznika (SIGKILL) da kodo izhoda 137, da ga systemd znova zazene", async () => {
    const mapa = novaMapa("sigkill");
    const z = zazeniLino(okoljeLine(mapa, await prostaVrata(), UMIRA));
    assert.equal(await koncaSe(z), 137, z.izpis());
  });

  it("start: ubit ovoj (SIGKILL), streznik tece naprej: naslednji zagon se ne zazene, ker Lina ze tece", async () => {
    const mapa = novaMapa("ovoj");
    const vrata = await prostaVrata();
    const prvi = zazeniLino(okoljeLine(mapa, vrata, LAZNI));
    const preberi = (): { otrok?: number } => {
      try {
        return JSON.parse(readFileSync(path.join(mapa, "lina.lock"), "utf8"));
      } catch {
        return {};
      }
    };
    await pocakaj(() => typeof preberi().otrok === "number");
    const otrok = preberi().otrok as number;
    let drugi: Zagnan | null = null;
    try {
      prvi.proces.kill("SIGKILL");
      await prvi.konec;
      process.kill(otrok, 0); // streznik je ostal
      drugi = zazeniLino(okoljeLine(mapa, vrata, LAZNI));
      assert.equal(await koncaSe(drugi), 0, drugi.izpis());
      assert.match(drugi.izpis(), /Lina ze tece/);
    } finally {
      try {
        process.kill(otrok, "SIGKILL");
      } catch {
        // ze ustavljen
      }
      if (drugi && drugi.proces.exitCode === null) drugi.proces.kill("SIGKILL");
    }
  });

  describe("odstranitev storitve", () => {
    const enota = (mapa: string) => {
      const mapaEnot = path.join(mapa, "systemd", "user");
      mkdirSync(mapaEnot, { recursive: true });
      const datoteka = path.join(mapaEnot, "lina.service");
      writeFileSync(datoteka, "[Service]\n");
      return datoteka;
    };

    it("storitve ni mogoce ustaviti (upravitelj sej ni dosegljiv): enota ostane, napaka se vrne", () => {
      const mapa = novaMapa("sluzba");
      const datoteka = enota(mapa);
      const ctl = () => ({ koda: 1, izpis: "Failed to connect to bus" });
      assert.throws(() => odstrani({ XDG_CONFIG_HOME: mapa }, ctl), /enota je ohranjena/);
      assert.equal(existsSync(datoteka), true);
    });

    it("storitev ni nalozena ali je ze ustavljena: enota se odstrani (idempotentno)", () => {
      const mapa = novaMapa("sluzba");
      const datoteka = enota(mapa);
      const ctl = (...args: string[]) => (args[0] === "is-active" ? { koda: 3, izpis: "inactive" } : { koda: args[0] === "disable" ? 1 : 0, izpis: "" });
      assert.match(odstrani({ XDG_CONFIG_HOME: mapa }, ctl), /odstranjena/);
      assert.equal(existsSync(datoteka), false);
    });

    it("uspesen disable --now: enota se odstrani", () => {
      const mapa = novaMapa("sluzba");
      const datoteka = enota(mapa);
      assert.match(odstrani({ XDG_CONFIG_HOME: mapa }, () => ({ koda: 0, izpis: "" })), /odstranjena/);
      assert.equal(existsSync(datoteka), false);
    });
  });
});
