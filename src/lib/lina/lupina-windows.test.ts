import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { jeProsnjaZaKonec, prijaviKonecLupine } from "../izhod-lupine.ts";

// Naloga 15 (prvi paket za Windows): lupina na Windows. Platforma je lazna (win32) - na pravem Windows NI preverjeno.
const zahtevaj = createRequire(import.meta.url);
const { APP_ID, mapaPodatkov, prosiZaKonec } = zahtevaj("../../../lupina/pomocniki.js") as {
  APP_ID: string;
  mapaPodatkov: (platforma: string, env: Record<string, string | undefined>, userData: string) => string;
  prosiZaKonec: (otrok: { connected: boolean; send(m: unknown): unknown; kill(s: string): unknown }, platforma: string) => "ipc" | "signal";
};
const beri = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("Windows: podatki v %LOCALAPPDATA%\\Lina\\podatki (lokalni profil), ne v gostujocem %APPDATA%", () => {
  const userData = "C:\\Users\\Ana Novak\\AppData\\Roaming\\Lina";
  assert.equal(mapaPodatkov("win32", { LOCALAPPDATA: "C:\\Users\\Ana Novak\\AppData\\Local" }, userData), "C:\\Users\\Ana Novak\\AppData\\Local\\Lina\\podatki");
  // brez ali z relativno LOCALAPPDATA: mapa programa (nikoli trenutna mapa procesa)
  assert.equal(mapaPodatkov("win32", {}, userData), `${userData}\\podatki`);
  assert.equal(mapaPodatkov("win32", { LOCALAPPDATA: "  " }, userData), `${userData}\\podatki`);
  assert.equal(mapaPodatkov("win32", { LOCALAPPDATA: "Local" }, userData), `${userData}\\podatki`);
});

test("Linux: mapa podatkov ostane userData/podatki (namescena Lina ne izgubi podatkov)", () => {
  assert.equal(mapaPodatkov("linux", { LOCALAPPDATA: "C:\\x" }, "/home/u/.config/Lina"), "/home/u/.config/Lina/podatki");
});

test("ustavitev na Windows: prosnja prek IPC (SIGTERM bi bil trd konec), signal samo brez kanala ali ob napaki kanala; Linux: SIGTERM kot doslej", () => {
  const klici: string[] = [];
  const otrok = (connected: boolean, sendVrze = false) => ({
    connected,
    send: (m: unknown) => {
      if (sendVrze) throw new Error("kanal zaprt");
      klici.push(`send:${JSON.stringify(m)}`);
    },
    kill: (s: string) => klici.push(`kill:${s}`),
  });
  assert.equal(prosiZaKonec(otrok(true), "win32"), "ipc");
  assert.deepEqual(klici.splice(0), ['send:{"lina":"koncaj"}'], "na Windows bi SIGTERM pomenil trd konec brez pospravljanja");
  assert.equal(prosiZaKonec(otrok(false), "win32"), "signal");
  assert.deepEqual(klici.splice(0), ["kill:SIGTERM"]);
  assert.equal(prosiZaKonec(otrok(true, true), "win32"), "signal");
  assert.deepEqual(klici.splice(0), ["kill:SIGTERM"]);
  // Linux: signal deluje tudi med zagonom (prosnja IPC bi se izgubila, preden je vticnik prijavljen)
  assert.equal(prosiZaKonec(otrok(true), "linux"), "signal");
  assert.deepEqual(klici.splice(0), ["kill:SIGTERM"]);
});

test("streznik: prosnja lupine sprozi poslusalce SIGTERM enkrat; zaprt kanal (lupina umrla) prav tako", () => {
  const p = Object.assign(new EventEmitter(), { channel: {} });
  let n = 0;
  p.on("SIGTERM", () => n++);
  assert.equal(prijaviKonecLupine(p as never), true);
  p.emit("message", { lina: "drugo" });
  p.emit("message", "koncaj");
  assert.equal(n, 0, "samo natancna prosnja");
  p.emit("message", { lina: "koncaj" });
  p.emit("disconnect");
  p.emit("message", { lina: "koncaj" });
  assert.equal(n, 1, "pospravljanje steče enkrat");

  const q = Object.assign(new EventEmitter(), { channel: {} });
  let m = 0;
  q.on("SIGTERM", () => m++);
  prijaviKonecLupine(q as never);
  q.emit("disconnect");
  assert.equal(m, 1);

  assert.equal(prijaviKonecLupine(Object.assign(new EventEmitter(), { channel: undefined }) as never), false, "brez IPC (razvoj, CI) nic");
  assert.equal(jeProsnjaZaKonec(null), false);
});

function otrokZIpc(): ReturnType<typeof spawn> {
  const modul = new URL("../izhod-lupine.ts", import.meta.url).href;
  const koda = `import { prijaviKonecLupine } from ${JSON.stringify(modul)};
process.on("SIGTERM", () => { process.stdout.write("pospravljeno"); setTimeout(() => process.exit(0), 20); });
prijaviKonecLupine(); process.send({ pripravljen: true });`;
  return spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", koda], { stdio: ["ignore", "pipe", "inherit", "ipc"], windowsHide: true });
}

function izid(otrok: ReturnType<typeof spawn>, dejanje: () => void): Promise<{ izpis: string; koda: number | null; signal: string | null }> {
  return new Promise((ok, ne) => {
    let izpis = "";
    const rok = setTimeout(() => {
      otrok.kill("SIGKILL");
      ne(new Error("otrok ni koncal v 10 s"));
    }, 10_000);
    // izid sele, ko je proces koncal IN je izpis prebran do konca (»close« po disconnect() ne pride vedno; »exit« lahko prehiti izpis)
    let konec: { koda: number | null; signal: string | null } | null = null;
    let izpisPrebran = false;
    const morda = () => {
      if (!konec || !izpisPrebran) return;
      clearTimeout(rok);
      ok({ izpis, ...konec });
    };
    otrok.stdout!.on("data", (b: Buffer) => (izpis += b.toString("utf8")));
    otrok.stdout!.once("end", () => ((izpisPrebran = true), morda()));
    otrok.once("message", dejanje);
    otrok.once("exit", (koda, signal) => ((konec = { koda, signal }), morda()));
  });
}

test("pravi proces: prosnja prek IPC pozene pospravljanje in proces konca sam (ne s signalom)", async () => {
  const otrok = otrokZIpc();
  const r = await izid(otrok, () => assert.equal(prosiZaKonec(otrok as never, "win32"), "ipc"));
  assert.deepEqual(r, { izpis: "pospravljeno", koda: 0, signal: null });
});

test("pravi proces: lupina zapre kanal (umrla) - streznik pospravi in konca, ne ostane brez starsa", async () => {
  const otrok = otrokZIpc();
  const r = await izid(otrok, () => otrok.disconnect());
  assert.deepEqual(r, { izpis: "pospravljeno", koda: 0, signal: null });
});

test("lupina: appId za obvestila Windows je enak build.appId; pomocniki so v paketu in main.js jih uporablja", () => {
  const pkg = JSON.parse(beri("../../../lupina/package.json")) as { build: { appId: string; files: string[] } };
  assert.equal(APP_ID, pkg.build.appId);
  assert.ok(pkg.build.files.includes("pomocniki.js"), "brez pomocniki.js v files se namescena lupina ne zazene");
  const main = beri("../../../lupina/main.js");
  assert.match(main, /require\("\.\/pomocniki"\)/);
  assert.match(main, /app\.setAppUserModelId\(APP_ID\)/);
  assert.match(main, /mapaPodatkov\(process\.platform, process\.env, app\.getPath\("userData"\)\)/);
  assert.match(main, /stdio: \["ignore", "ignore", "ignore", "ipc"\]/);
  assert.doesNotMatch(main, /s\.kill\("SIGTERM"\)/, "ustavitev gre prek prosiZaKonec");
  assert.match(beri("../../../server/plugins/lina-izhod.ts"), /prijaviKonecLupine\(\);/);
});

test("tok Windows: akcije pripete na SHA, samo branje, brez skrivnosti; paket NSIS x64 s sha256 in preizkusi z LINA_PODROBNI_POTEK", () => {
  const yml = beri("../../../.github/workflows/windows.yml");
  const uses = [...yml.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
  assert.ok(uses.length >= 4);
  for (const u of uses) assert.match(u, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `ni pripeta na SHA: ${u}`);
  assert.deepEqual([...yml.matchAll(/^\s*(contents|actions|packages|id-token|pull-requests|issues|deployments|statuses|checks|attestations|security-events):\s*(\w+)/gm)].map((m) => `${m[1]}:${m[2]}`), ["contents:read"]);
  assert.doesNotMatch(yml, /secrets\.|pull_request_target|\$\{\{\s*github\.event\./, "brez skrivnosti in brez vnosa iz dogodka v ukaze");
  assert.equal((yml.match(/runs-on: windows-latest/g) ?? []).length, 2);
  for (const k of ["npm ci", "npx tsc --noEmit", "npm test", "npx vitest run", 'LINA_PODROBNI_POTEK: "1"', "--max-old-space-size", "electron-builder --win nsis --x64 --publish never", "sha256sum Lina-*-x64-namestitev.exe", "openline/node_modules/express/package.json"]) {
    assert.ok(yml.includes(k), k);
  }
  const pkg = JSON.parse(beri("../../../lupina/package.json")) as { build: { win: { target: { target: string; arch: string[] }[] }; nsis: Record<string, unknown>; linux: { target: string[] } } };
  assert.deepEqual(pkg.build.win.target, [{ target: "nsis", arch: ["x64"] }]);
  assert.deepEqual(pkg.build.linux.target, ["deb"], "deb ostane nespremenjen");
  // namestitev za uporabnika brez skrbniskih pravic (vzorec Safeer za Windows: PrivilegesRequired=lowest), podatki ostanejo
  assert.equal(pkg.build.nsis.perMachine, false);
  assert.equal(pkg.build.nsis.allowElevation, false);
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false);
});
