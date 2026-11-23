/**
 * Lina brez Safeer OS in ob njem (lastnik 14. 11. 2026: »Lina naj deluje tudi, ce uporabnik nima namescenega Safeer OS; ce ga
 * ima, je popolnoma zdruzljiva in se procesi med seboj ne motijo«). Dvoprocesni preizkusi: vsak zagon ima SVOJE okolje (env=
 * podprocesu, os.environ se ne spreminja), lasten dbus-daemon in lasten lazni streznik; Safeer OS je samo oseba, ki zaseda
 * ime aplikacije na zasebnem vodilu (pravi Safeer OS na testnem PC ni preizkusen).
 */
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { mapaJeSafeerjeva, mapaPodatkov, privzetaMapa, SAFEER_OS_IME, sestaviEnoto, zaznajSafeerOs } from "../../../scripts/zagon-lina.mjs";
import { defaultDataDir } from "./store.server.ts";

const KOREN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const START = path.join(KOREN, "scripts", "start.mjs");
const TMP = mkdtempSync(path.join(tmpdir(), "lina-samostojna-"));
const otroci = new Set<ChildProcess>();

after(() => {
  for (const o of otroci) {
    if (o.exitCode === null) o.kill("SIGKILL");
  }
  rmSync(TMP, { recursive: true, force: true });
});

const LAZNI = path.join(TMP, "lazni-streznik.mjs");
writeFileSync(LAZNI, `import http from "node:http";\nhttp.createServer((q, r) => r.end("lina")).listen(Number(process.env.PORT), "127.0.0.1");\n`);

let stevec = 0;
const novaMapa = (ime: string) => {
  const mapa = path.join(TMP, `${ime}-${(stevec += 1)}`);
  mkdirSync(mapa, { recursive: true });
  return mapa;
};

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

/** Zagon scripts/start.mjs z lastnim okoljem (env=), samo s spremenljivkami, ki jih Lina potrebuje. */
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

async function pocakaj(pogoj: () => boolean | Promise<boolean>, ms = 8000): Promise<void> {
  const rok = Date.now() + ms;
  while (Date.now() < rok) {
    if (await pogoj()) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error("Cakanje je poteklo.");
}

function pridobi(vrata: number): Promise<string> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: vrata, path: "/" }, (odg) => {
        let telo = "";
        odg.on("data", (b) => (telo += String(b)));
        odg.on("end", () => resolve(telo));
      })
      .on("error", reject);
  });
}

const preberiZaklep = (mapa: string) => JSON.parse(readFileSync(path.join(mapa, "lina.lock"), "utf8")) as { pid: number; vrata: number | null; safeerOs: boolean };

function okoljeLine(mapa: string, vrata: number, dodatno: Record<string, string> = {}): Record<string, string> {
  return { HOME: TMP, XDG_RUNTIME_DIR: TMP, LINA_DATA: mapa, LINA_VRATA: String(vrata), LINA_STREZNIK: LAZNI, ...dodatno };
}

/** Zasebno vodilo (lasten dbus-daemon) in »Safeer OS«: ime aplikacije na vodilu + lastna vrata. */
async function zazeniVodiloInOs(prednostnaVrata: number) {
  const mapa = novaMapa("vodilo");
  const vticnica = path.join(mapa, "bus");
  const naslov = `unix:path=${vticnica}`;
  const konfig = path.join(mapa, "bus.conf");
  writeFileSync(
    konfig,
    `<busconfig><type>session</type><listen>${naslov}</listen><auth>EXTERNAL</auth><policy context="default"><allow send_destination="*" eavesdrop="true"/><allow eavesdrop="true"/><allow own="*"/></policy></busconfig>`,
  );
  const vodilo = spawn("dbus-daemon", ["--config-file", konfig, "--nofork"], { stdio: "ignore", env: { PATH: process.env.PATH ?? "" } });
  otroci.add(vodilo);
  await pocakaj(() => existsSync(vticnica));
  const okolje = { PATH: process.env.PATH ?? "", DBUS_SESSION_BUS_ADDRESS: naslov, XDG_RUNTIME_DIR: TMP, HOME: TMP };
  const skripta = [
    "import socket, gi",
    "gi.require_version('Gio', '2.0')",
    "from gi.repository import Gio, GLib",
    `s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(('127.0.0.1', ${prednostnaVrata})); s.listen(5)`,
    `Gio.bus_own_name(Gio.BusType.SESSION, '${SAFEER_OS_IME}', Gio.BusNameOwnerFlags.NONE, None, None, None)`,
    "GLib.MainLoop().run()",
  ].join("\n");
  const os = spawn("python3", ["-c", skripta], { env: okolje, stdio: "ignore" });
  otroci.add(os);
  await pocakaj(() => zaznajSafeerOs(okolje));
  return { naslov, os, vodilo, okolje };
}

/** Drugi zagon se mora koncati sam; brez zaklepa bi tekel naprej (preizkus mora pasti, ne obvisati). */
const koncaSe = (z: Zagnan) => Promise.race([z.konec, new Promise<string>((r) => setTimeout(() => r("ne-konca-se"), 10000))]);

function ustavi(...ps: ChildProcess[]) {
  for (const p of ps) {
    if (p.exitCode === null) p.kill("SIGTERM");
  }
}

describe("Lina sama: mapa, zaklep, vrata (brez Safeer OS)", { concurrency: 1 }, () => {
  it("mapa podatkov enaka kot v aplikaciji; mapa Safeerja je zavrnjena", () => {
    const env = { HOME: "/home/uporabnik", XDG_DATA_HOME: "" };
    assert.equal(privzetaMapa(env, "linux"), defaultDataDir("linux", env));
    assert.equal(privzetaMapa({ LOCALAPPDATA: "C:\\L" }, "win32"), defaultDataDir("win32", { LOCALAPPDATA: "C:\\L" }));
    assert.equal(mapaPodatkov({ LINA_DATA: "/tmp/x/../lina-a" }, "linux"), "/tmp/lina-a");
    for (const slaba of ["/home/u/.config/safeer-mint/lina", "/home/u/.local/share/SafeerOS/podatki", "/home/u/.local/share/safeer"]) assert.equal(mapaJeSafeerjeva(slaba), true, slaba);
    for (const dobra of ["/home/u/.local/share/lina", "/home/u/antigravity-safeer/lina"]) assert.equal(mapaJeSafeerjeva(dobra), false, dobra);
  });

  it("zagon brez Safeer OS: lastna mapa, zaklep s PID in vrati, vrata iz LINA_VRATA, ob SIGTERM se zaklep sprosti", async () => {
    const mapa = novaMapa("sama");
    const vrata = await prostaVrata();
    const lina = zazeniLino(okoljeLine(mapa, vrata));
    await pocakaj(() => lina.izpis().includes("poslusa"));
    await pocakaj(async () => (await pridobi(vrata).catch(() => "")) === "lina");
    const zaklep = preberiZaklep(mapa);
    assert.deepEqual([zaklep.pid, zaklep.vrata, zaklep.safeerOs], [lina.proces.pid, vrata, false]);
    assert.match(lina.izpis(), /Safeer OS: ni, Lina tece sama/);
    assert.deepEqual(readdirSync(mapa), ["lina.lock"]);
    lina.proces.kill("SIGTERM");
    assert.equal(await lina.konec, 0);
    assert.equal(existsSync(path.join(mapa, "lina.lock")), false);
  });

  it("zasedena prednostna vrata: Lina vzame druga prosta vrata (ne trci)", async () => {
    const mapa = novaMapa("vrata");
    const zasedena = net.createServer();
    await new Promise<void>((r) => zasedena.listen(0, "127.0.0.1", r));
    const vrata = (zasedena.address() as net.AddressInfo).port;
    const lina = zazeniLino(okoljeLine(mapa, vrata));
    try {
      await pocakaj(() => lina.izpis().includes("poslusa"));
      const izbrana = preberiZaklep(mapa).vrata as number;
      assert.notEqual(izbrana, vrata);
      await pocakaj(async () => (await pridobi(izbrana).catch(() => "")) === "lina");
    } finally {
      zasedena.close();
      ustavi(lina.proces);
      await lina.konec;
    }
  });

  it("drugi zagon iste Line ne ustvari druge instance: javi, da ze tece, koda 0, prvi tece naprej", async () => {
    const mapa = novaMapa("dvakrat");
    const vrata = await prostaVrata();
    const prva = zazeniLino(okoljeLine(mapa, vrata));
    await pocakaj(() => prva.izpis().includes("poslusa"));
    const zaklepPrej = preberiZaklep(mapa);
    const druga = zazeniLino(okoljeLine(mapa, await prostaVrata()));
    assert.equal(await koncaSe(druga), 0);
    assert.match(druga.izpis(), new RegExp(`Lina ze tece \\(PID ${prva.proces.pid}, vrata ${vrata}\\)`));
    assert.doesNotMatch(druga.izpis(), /poslusa/);
    assert.deepEqual(preberiZaklep(mapa), zaklepPrej);
    assert.equal(await pridobi(vrata), "lina");
    ustavi(prva.proces);
    await prva.konec;
  });

  it("zastarel zaklep (proces ne tece) se prevzame", async () => {
    const mapa = novaMapa("zastarel");
    const mrtev = spawn(process.execPath, ["-e", "0"]);
    await new Promise((r) => mrtev.on("exit", r));
    writeFileSync(path.join(mapa, "lina.lock"), JSON.stringify({ pid: mrtev.pid, zacetek: "1", zeton: "stari", vrata: 1, safeerOs: false }));
    const vrata = await prostaVrata();
    const lina = zazeniLino(okoljeLine(mapa, vrata));
    await pocakaj(() => lina.izpis().includes("poslusa"));
    assert.equal(preberiZaklep(mapa).pid, lina.proces.pid);
    ustavi(lina.proces);
    await lina.konec;
  });

  it("podatki v mapi Safeerja: zagon se zavrne, nic se ne ustvari", async () => {
    const slaba = path.join(TMP, "safeer-mint", "lina");
    const lina = zazeniLino(okoljeLine(slaba, await prostaVrata()));
    assert.equal(await lina.konec, 1);
    assert.match(lina.izpis(), /v mapi Safeerja/);
    assert.equal(existsSync(slaba), false);
  });
});

describe("Lina ob Safeer OS: zaznava prek D-Bus, nobenega trcenja, obe smeri zagona", { concurrency: 1 }, () => {
  it("Safeer OS tece (in ima prednostna vrata): Lina ga zazna, vzame druga vrata, svoja mapa in zaklep; oba odgovarjata", async () => {
    const vrata = await prostaVrata();
    const os = await zazeniVodiloInOs(vrata);
    const mapa = novaMapa("ob-os");
    const lina = zazeniLino(okoljeLine(mapa, vrata, { DBUS_SESSION_BUS_ADDRESS: os.naslov }));
    try {
      await pocakaj(() => lina.izpis().includes("poslusa"));
      const zaklep = preberiZaklep(mapa);
      assert.equal(zaklep.safeerOs, true);
      assert.notEqual(zaklep.vrata, vrata);
      assert.match(lina.izpis(), /Safeer OS: zaznan, Lina tece loceno ob njem/);
      await pocakaj(async () => (await pridobi(zaklep.vrata as number).catch(() => "")) === "lina");
      assert.deepEqual(readdirSync(mapa), ["lina.lock"]);
    } finally {
      ustavi(lina.proces, os.os, os.vodilo);
      await lina.konec;
    }
  });

  it("obratni vrstni red: Lina tece, nato se zazene Safeer OS - nic se ne pokvari, drugi zagon Line se ne podvoji", async () => {
    const vrata = await prostaVrata();
    const mapa = novaMapa("lina-prej");
    const lina = zazeniLino(okoljeLine(mapa, vrata));
    await pocakaj(() => lina.izpis().includes("poslusa"));
    const zaklepPrej = preberiZaklep(mapa);
    const os = await zazeniVodiloInOs(await prostaVrata());
    try {
      assert.equal(await pridobi(vrata), "lina");
      assert.deepEqual(preberiZaklep(mapa), zaklepPrej);
      const druga = zazeniLino(okoljeLine(mapa, await prostaVrata(), { DBUS_SESSION_BUS_ADDRESS: os.naslov }));
      assert.equal(await koncaSe(druga), 0);
      assert.match(druga.izpis(), /Lina ze tece/);
      assert.equal(await pridobi(vrata), "lina");
      assert.equal(zaznajSafeerOs(os.okolje), true);
    } finally {
      ustavi(lina.proces, os.os, os.vodilo);
      await lina.konec;
    }
  });

  it("zaznava je samo ime na vodilu: brez vodila ali brez gdbus je odgovor »ne«", () => {
    assert.equal(zaznajSafeerOs({ PATH: process.env.PATH ?? "", XDG_RUNTIME_DIR: TMP, HOME: TMP }), false);
    assert.equal(zaznajSafeerOs({ PATH: "/nonexistent" }), false);
  });
});

describe("Lina: zagon kot storitev po izbiri in brez odvisnosti od Safeerja", () => {
  it("enota systemd --user: lastna pot, brez Safeer storitev, nic se ne vklopi sam", () => {
    const enota = sestaviEnoto({ node: "/usr/bin/node", koren: "/opt/lina" });
    assert.match(enota, /^ExecStart="\/usr\/bin\/node" "\/opt\/lina\/scripts\/start\.mjs"$/m);
    assert.match(enota, /^Restart=on-failure$/m);
    assert.doesNotMatch(enota, /safeer/i);
    assert.doesNotMatch(enota, /^(After|Requires|Wants|BindsTo)=/m);
  });

  it("koda zagona ne vsebuje poti ali modulov Safeerja (core/, /usr/lib/safeer*)", () => {
    for (const datoteka of ["start.mjs", "zagon-lina.mjs", "sluzba.mjs"]) {
      const vsebina = readFileSync(path.join(KOREN, "scripts", datoteka), "utf8").replace(/io\.github\.memelandfaner\.SafeerOS/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      assert.doesNotMatch(vsebina, /core\/|\/usr\/lib\/safeer|safeer-control|\.config\/safeer/i, datoteka);
    }
  });
});
