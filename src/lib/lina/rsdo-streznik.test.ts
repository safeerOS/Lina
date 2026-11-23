import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, afterEach, mock, test } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { savePravila } from "./pravila.server.ts";
import { NAJDALJSI_POSNETEK_S, potPrepisaZa, ponastaviStanjeRsdo, prepisiRsdo, type Izvajalec, type StreznikRsdo } from "./rsdo-motor.server.ts";
import {
  NAJVEC_BESEDILA,
  izklopiRsdo,
  nastaviOdvisnostiRsdoStreznika,
  prepisiPrekStreznika,
  stanjeRsdo,
  uskladiRsdo,
  vklopiRsdo,
  type OdvisnostiStreznika,
} from "./rsdo-streznik.server.ts";

/** Nadomestni »python«: Node skripta, ki posnema protokol scripts/rsdo-streznik.py (pravi NeMo se ne zazene). */
const LAZNI = `
import { appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
const [nacin, dnevnik] = process.argv.slice(2);
appendFileSync(dnevnik, "zagon " + process.pid + "\\n");
const zagonov = readFileSync(dnevnik, "utf8").split("\\n").filter((v) => v.startsWith("zagon")).length;
const posli = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
if (nacin === "pade" || (nacin === "pade-enkrat" && zagonov === 1)) process.exit(1);
if (nacin === "trmast") setInterval(() => {}, 1000);
if (nacin === "pocasi-ugasne") { setInterval(() => {}, 1000); process.on("SIGTERM", () => setTimeout(() => process.exit(0), 400)); }
if (nacin === "neubogljiv") { setInterval(() => {}, 1000); process.on("SIGTERM", () => {}); }
if (nacin !== "pocasi-nalaga") posli({ pripravljen: true });
let zaseden = false;
const rl = createInterface({ input: process.stdin });
rl.on("line", (vrstica) => {
  const z = JSON.parse(vrstica);
  if (zaseden) { appendFileSync(dnevnik, "prekrivanje\\n"); posli({ id: z.id, napaka: "prekrivanje" }); return; }
  if (nacin === "visi" || z.wav.includes("/visi")) return;
  if (nacin === "velik") { process.stdout.write("x".repeat(2 * 1024 * 1024)); return; }
  if (nacin === "dolg") { posli({ id: z.id, besedilo: "a" + String.fromCharCode(7) + "b" + String.fromCharCode(10) + "c" + String.fromCharCode(8232) + "d".repeat(5000) }); return; }
  zaseden = true;
  setTimeout(() => { zaseden = false; appendFileSync(dnevnik, "zahteva\\n"); posli({ id: "tuj", besedilo: "ne" }); posli({ id: z.id, besedilo: "prepis:" + z.wav.split("/").pop() }); }, nacin === "pocasen" ? 200 : 40);
});
rl.on("close", () => { if (nacin !== "trmast" && nacin !== "pocasi-ugasne" && nacin !== "neubogljiv") process.exit(0); });
`;

const mapa = mkdtempSync(path.join(tmpdir(), "lina-rsdo-str-"));
const lazni = path.join(mapa, "lazni-python.mjs");
writeFileSync(lazni, LAZNI);
let stevec = 0;

function nastavi(nacin: string, dodatno: Partial<OdvisnostiStreznika> = {}): string {
  const dnevnik = path.join(mapa, `dnevnik-${++stevec}.txt`);
  writeFileSync(dnevnik, "");
  nastaviOdvisnostiRsdoStreznika({ ukaz: async () => ({ program: process.execPath, args: [lazni, nacin, dnevnik] }), premorPonovitveMs: 10, ...dodatno });
  return dnevnik;
}
const vrstice = (dnevnik: string, zacetek: string) => readFileSync(dnevnik, "utf8").split("\n").filter((v) => v.startsWith(zacetek));
const ziv = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function pocakaj(pogoj: () => boolean, ms = 5000): Promise<void> {
  const konec = Date.now() + ms;
  while (!pogoj()) {
    if (Date.now() > konec) throw new Error(`pogoj ni izpolnjen v ${ms} ms (stanje ${JSON.stringify(stanjeRsdo())})`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

afterEach(() => {
  izklopiRsdo();
  nastaviOdvisnostiRsdoStreznika(null);
  ponastaviStanjeRsdo();
});
after(() => izklopiRsdo());

test("vklop zazene proces, prepis gre prek njega, izklop ga ustavi", async () => {
  const dnevnik = nastavi("ok");
  assert.equal(stanjeRsdo().stanje, "izklopljen");
  const zagon = uskladiRsdo(true);
  assert.equal(stanjeRsdo().stanje, "nalaga");
  await zagon;
  await pocakaj(() => stanjeRsdo().stanje === "pripravljen");
  const pid = stanjeRsdo().pid!;
  assert.equal(await prepisiPrekStreznika("/tmp/a-16k.wav"), "prepis:a-16k.wav");
  await uskladiRsdo(false);
  assert.equal(stanjeRsdo().stanje, "izklopljen");
  await pocakaj(() => !ziv(pid));
  assert.equal(vrstice(dnevnik, "zagon").length, 1);
});

test("ena zahteva naenkrat: socasni prepisi gredo po vrsti, tuj id se prezre", async () => {
  const dnevnik = nastavi("ok");
  await vklopiRsdo();
  await pocakaj(() => stanjeRsdo().stanje === "pripravljen");
  const izidi = await Promise.all(["a", "b", "c", "d"].map((x) => prepisiPrekStreznika(`/tmp/${x}.wav`)));
  assert.deepEqual(izidi, ["prepis:a.wav", "prepis:b.wav", "prepis:c.wav", "prepis:d.wav"]);
  assert.equal(vrstice(dnevnik, "prekrivanje").length, 0);
  assert.equal(vrstice(dnevnik, "zahteva").length, 4);
});

test("brez ustavitve ob nedejavnosti: po 3 urah brez zahtev proces tece", async () => {
  // casovniki so lazni ze pred vklopom, da tick doseze vsak casovnik modula (tudi rok nalaganja)
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let pid: number;
  try {
    nastavi("ok");
    await vklopiRsdo();
    const konec = Date.now() + 5000;
    while (stanjeRsdo().stanje !== "pripravljen" && Date.now() < konec) await new Promise((r) => setImmediate(r));
    assert.equal(stanjeRsdo().stanje, "pripravljen");
    pid = stanjeRsdo().pid!;
    mock.timers.tick(3 * 3600_000);
  } finally {
    mock.timers.reset();
  }
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(stanjeRsdo().stanje, "pripravljen");
  assert.equal(stanjeRsdo().pid, pid);
  assert.ok(ziv(pid));
  assert.equal(await prepisiPrekStreznika("/tmp/e.wav"), "prepis:e.wav");
});

test("po padcu se zazene znova; po 3 ponovitvah v 5 min stanje napaka z razlogom", async () => {
  let dnevnik = nastavi("pade-enkrat");
  await vklopiRsdo();
  await pocakaj(() => stanjeRsdo().stanje === "pripravljen");
  assert.equal(vrstice(dnevnik, "zagon").length, 2);
  izklopiRsdo();

  dnevnik = nastavi("pade");
  await vklopiRsdo();
  await pocakaj(() => stanjeRsdo().stanje === "napaka");
  assert.equal(stanjeRsdo().razlog, "proces-pada");
  assert.equal(vrstice(dnevnik, "zagon").length, 4, "prvi zagon + 3 ponovitve");
  // poizvedba stanja (uskladi) po ponavljajocih padcih ne zaganja znova; izklop in vklop stikala da
  await uskladiRsdo(true);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(vrstice(dnevnik, "zagon").length, 4);
  await uskladiRsdo(false);
  await uskladiRsdo(true);
  await pocakaj(() => vrstice(dnevnik, "zagon").length >= 5);
});

test("padci izven okna 5 min se ne stejejo", async () => {
  let ura = 1_000_000;
  const dnevnik = nastavi("pade", { zdaj: () => (ura += 2 * 60_000) });
  await vklopiRsdo();
  await pocakaj(() => vrstice(dnevnik, "zagon").length >= 8);
  assert.notEqual(stanjeRsdo().stanje, "napaka");
  izklopiRsdo();
});

test("rok zahteve: null, proces se zazene znova; rok nalaganja in prevelik izhod koncata s padcem", async () => {
  let dnevnik = nastavi("visi", { rokZahteveMs: 150 });
  await vklopiRsdo();
  await pocakaj(() => stanjeRsdo().stanje === "pripravljen");
  const zacetek = Date.now();
  assert.equal(await prepisiPrekStreznika("/tmp/v.wav"), null);
  assert.ok(Date.now() - zacetek < 2000);
  await pocakaj(() => vrstice(dnevnik, "zagon").length === 2 && stanjeRsdo().stanje === "pripravljen");
  izklopiRsdo();

  dnevnik = nastavi("pocasi-nalaga", { rokNalaganjaMs: 100 });
  await vklopiRsdo();
  await pocakaj(() => stanjeRsdo().stanje === "napaka");
  assert.equal(stanjeRsdo().razlog, "nalaganje-predolgo");
  izklopiRsdo();

  dnevnik = nastavi("velik");
  await vklopiRsdo();
  await pocakaj(() => stanjeRsdo().stanje === "pripravljen");
  assert.equal(await prepisiPrekStreznika("/tmp/x.wav"), null);
  await pocakaj(() => vrstice(dnevnik, "zagon").length === 2);
});

test("modul ni namescen: napaka ni-namescen, uskladi poskusi znova sele po minuti", async () => {
  let ura = 0;
  let klicev = 0;
  nastaviOdvisnostiRsdoStreznika({ ukaz: async () => (klicev++, { napaka: "ni-namescen" }), zdaj: () => ura });
  await uskladiRsdo(true);
  assert.deepEqual([stanjeRsdo().stanje, stanjeRsdo().razlog], ["napaka", "ni-namescen"]);
  await uskladiRsdo(true);
  assert.equal(klicev, 1);
  ura += 61_000;
  await uskladiRsdo(true);
  assert.equal(klicev, 2);
});

test("prepisiRsdo: pripravljen proces nadomesti CLI; potPrepisaZa ne zahteva prostega RAM", async () => {
  nastavi("ok");
  const klici: string[][] = [];
  const izv: Izvajalec = async (program, args) => {
    klici.push([program, ...args]);
    return program === "ffmpeg" ? { koda: 0, izhod: "" } : { koda: 0, izhod: '{"besedilo": "iz cli"}' };
  };
  const dom = mkdtempSync(path.join(tmpdir(), "lina-rsdo-dom-"));
  // ni pripravljen: dosedanja pot prek CLI
  assert.equal(await prepisiRsdo(Buffer.from("x"), "audio/ogg", { izvajalec: izv, dom }), "iz cli");
  assert.ok(klici.some((k) => k.includes("slovenski")));
  await vklopiRsdo();
  await pocakaj(() => stanjeRsdo().stanje === "pripravljen");
  klici.length = 0;
  const b = await prepisiRsdo(Buffer.from("x"), "audio/ogg", { izvajalec: izv, dom });
  assert.match(b ?? "", /^prepis:lina-rsdo-[0-9a-f]+-16k\.wav$/);
  assert.equal(klici.length, 1, "samo ffmpeg, brez CLI");
  assert.equal(klici[0][0], "ffmpeg");
  assert.deepEqual(await potPrepisaZa({ dodatekVklopljen: true }, { izvajalec: izv, dom, prostiRamMB: () => 100 }), { pot: "gemini-rsdo", razlog: "ok" });
  assert.equal((await potPrepisaZa({ dodatekVklopljen: true, rsdoNamig: false }, { izvajalec: izv, dom })).razlog, "uporabnik-izklopil");
  assert.equal((await potPrepisaZa({ dodatekVklopljen: false }, { izvajalec: izv, dom })).razlog, "uporabnik-izklopil");
});

test("stikalo v pravilih: vklop nalozi, shranjevanje brez spremembe ne ustavi, izklop ustavi", async () => {
  const dnevnik = nastavi("ok");
  const dir = mkdtempSync(path.join(tmpdir(), "lina-rsdo-pravila-"));
  const zeton = await setupOwner("geslo-test-1234", dir);
  const dodatki = { paperclip: false, n8n: false, affine: false, programi: false, slovenski: true };
  await savePravila({ dodatki }, zeton, dir);
  await pocakaj(() => stanjeRsdo().stanje === "pripravljen");
  const pid = stanjeRsdo().pid!;
  await savePravila({ dodatki, tisinaPoGovoruSek: 2 }, zeton, dir);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(stanjeRsdo().pid, pid);
  await savePravila({ dodatki: { ...dodatki, slovenski: false } }, zeton, dir);
  await pocakaj(() => stanjeRsdo().stanje === "izklopljen" && !ziv(pid));
  assert.equal(vrstice(dnevnik, "zagon").length, 1);
});

test("privzeti ukaz v preizkusu pravega RSDO ne zazene (tudi ce je CLI namescen)", async () => {
  const dom = mkdtempSync(path.join(tmpdir(), "lina-rsdo-cli-"));
  mkdirSync(path.join(dom, ".local", "bin"), { recursive: true });
  const oznaka = path.join(dom, "klican");
  const cli = path.join(dom, ".local", "bin", "cli-anything-linuxmint");
  writeFileSync(cli, `#!/bin/sh\ntouch ${JSON.stringify(oznaka)}\necho '{"namescen": true, "python": "${process.execPath}", "model": "/m.nemo"}'\n`);
  chmodSync(cli, 0o755);
  const prej = process.env.HOME;
  process.env.HOME = dom;
  try {
    nastaviOdvisnostiRsdoStreznika(null);
    await vklopiRsdo();
    assert.deepEqual([stanjeRsdo().stanje, stanjeRsdo().razlog, stanjeRsdo().pid], ["napaka", "ni-namescen", null]);
    // shranjevanje stikala v preizkusu tudi namestitve ne sprozi
    const dir = mkdtempSync(path.join(tmpdir(), "lina-rsdo-pravila-"));
    const zeton = await setupOwner("geslo-test-1234", dir);
    await savePravila({ dodatki: { paperclip: false, n8n: false, affine: false, programi: false, slovenski: true } }, zeton, dir);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(existsSync(oznaka), false, "CLI ne sme biti poklican");
  } finally {
    process.env.HOME = prej;
  }
});

/** Starsevski proces Line (samo modul stalnega procesa) za preizkus sirote. */
const STARS = (modul: string, nacin: string, dnevnik: string) => `
import { nastaviOdvisnostiRsdoStreznika, stanjeRsdo, vklopiRsdo } from ${JSON.stringify(modul)};
nastaviOdvisnostiRsdoStreznika({ ukaz: async () => ({ program: process.execPath, args: [${JSON.stringify(lazni)}, ${JSON.stringify(nacin)}, ${JSON.stringify(dnevnik)}] }) });
await vklopiRsdo();
const t = setInterval(() => { if (stanjeRsdo().stanje === "pripravljen") { clearInterval(t); process.stdout.write("PID " + stanjeRsdo().pid + "\\n"); } }, 10);
process.stdin.on("data", () => process.exit(0));
setInterval(() => {}, 1000);
`;

async function zazeniStarsa(nacin: string): Promise<{ stars: ReturnType<typeof spawn>; otrok: number }> {
  const modul = path.join(path.dirname(fileURLToPath(import.meta.url)), "rsdo-streznik.server.ts");
  const dnevnik = path.join(mapa, `stars-${++stevec}.txt`);
  writeFileSync(dnevnik, "");
  const skripta = path.join(mapa, `stars-${stevec}.mts`);
  writeFileSync(skripta, STARS(modul, nacin, dnevnik));
  const stars = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", skripta], { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, NODE_TEST_CONTEXT: "" } });
  const otrok = await new Promise<number>((resolve, reject) => {
    let izhod = "";
    stars.stdout!.on("data", (k) => {
      izhod += String(k);
      const m = /PID (\d+)/.exec(izhod);
      if (m) resolve(Number(m[1]));
    });
    stars.on("exit", () => reject(new Error(`stars je koncal brez PID: ${izhod}`)));
    setTimeout(() => reject(new Error("stars ni javil PID")), 10_000).unref();
  });
  return { stars, otrok };
}

test("konec Line (process.exit): otrok, ki konca vhoda ne uposteva, se vedno ne ostane siroce", async () => {
  const { stars, otrok } = await zazeniStarsa("trmast");
  assert.ok(ziv(otrok));
  stars.stdin!.write("konec\n");
  await new Promise((r) => stars.once("exit", r));
  await pocakaj(() => !ziv(otrok));
});

test("Lina ubita s SIGKILL: otrok konca ob koncu vhoda", async () => {
  const { stars, otrok } = await zazeniStarsa("ok");
  stars.kill("SIGKILL");
  await new Promise((r) => stars.once("exit", r));
  await pocakaj(() => !ziv(otrok));
});

test("prava skripta scripts/rsdo-streznik.py z nadomestnim NeMo: protokol, dnevnik knjiznice ne pokvari stdout, konec ob koncu vhoda", async (t) => {
  if (spawnSync("python3", ["--version"]).status !== 0) return t.skip("python3 ni na voljo");
  const nemo = path.join(mapa, "pynemo");
  const asr = path.join(nemo, "nemo", "collections", "asr");
  mkdirSync(asr, { recursive: true });
  writeFileSync(path.join(nemo, "nemo", "__init__.py"), "");
  writeFileSync(path.join(nemo, "nemo", "collections", "__init__.py"), "");
  writeFileSync(
    path.join(asr, "__init__.py"),
    [
      'print("NeMo dnevnik na stdout")',
      "import os",
      "class _M:",
      "    def eval(self): pass",
      "    def transcribe(self, s, batch_size=1, verbose=False):",
      '        print("dnevnik med prepisom")',
      '        if s[0].endswith("napaka.wav"): raise FileNotFoundError(s[0])',
      '        return ["zdravo " + os.path.basename(s[0])]',
      "class models:",
      "    class ASRModel:",
      "        @staticmethod",
      "        def restore_from(p, map_location=None): return _M()",
      "",
    ].join("\n"),
  );
  const skripta = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts", "rsdo-streznik.py");
  const prej = process.env.PYTHONPATH;
  process.env.PYTHONPATH = nemo;
  try {
    nastaviOdvisnostiRsdoStreznika({ ukaz: async () => ({ program: "python3", args: ["-B", skripta, "/ni/model.nemo"] }) });
    await vklopiRsdo();
    await pocakaj(() => stanjeRsdo().stanje === "pripravljen", 10_000);
    const pid = stanjeRsdo().pid!;
    assert.equal(await prepisiPrekStreznika("/tmp/b-16k.wav"), "zdravo b-16k.wav");
    assert.equal(await prepisiPrekStreznika("/tmp/napaka.wav"), null);
    assert.equal(await prepisiPrekStreznika("/tmp/c.wav"), "zdravo c.wav", "napaka ene zahteve ne konca procesa");
    assert.equal(stanjeRsdo().pid, pid);
    izklopiRsdo();
    await pocakaj(() => !ziv(pid));
  } finally {
    if (prej === undefined) delete process.env.PYTHONPATH;
    else process.env.PYTHONPATH = prej;
  }
});

test("pregled 029, najdba 5: rok velja od klica, cakanje v vrsti se ne sesteva", async () => {
  const dnevnik = nastavi("pocasen", { rokZahteveMs: 300 });
  await vklopiRsdo();
  await pocakaj(() => stanjeRsdo().stanje === "pripravljen");
  const zacetek = Date.now();
  const casi: number[] = [];
  const izidi = await Promise.all(["a", "b", "c"].map((x) => prepisiPrekStreznika(`/tmp/${x}.wav`).then((b) => (casi.push(Date.now() - zacetek), b))));
  assert.equal(izidi[0], "prepis:a.wav");
  assert.deepEqual(izidi.slice(1), [null, null]);
  assert.ok(Math.max(...casi) < 300 + 150, `najdaljse cakanje ${Math.max(...casi)} ms`);
  // tretja zahteva, ki ji je rok potekel v vrsti, ni bila poslana procesu; zdrav model ni bil ubit (ni ponovnega zagona)
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(vrstice(dnevnik, "zahteva").length <= 2);
  assert.equal(vrstice(dnevnik, "zagon").length, 1);
});

test("pregled 029, najdba 6: rok zahteve ni padec (po 5 rokih, vsak za uspesnim odgovorom, RSDO ni v napaki)", async () => {
  const dnevnik = nastavi("obicajen", { rokZahteveMs: 150 });
  await vklopiRsdo();
  for (let i = 0; i < 5; i += 1) {
    await pocakaj(() => stanjeRsdo().stanje === "pripravljen");
    assert.equal(await prepisiPrekStreznika(`/tmp/visi-${i}.wav`), null);
    await pocakaj(() => vrstice(dnevnik, "zagon").length === i + 2 && stanjeRsdo().stanje === "pripravljen");
    // pregled 029b, najdba 2: uspesen odgovor vmes - proces ne visi
    assert.equal(await prepisiPrekStreznika(`/tmp/ok-${i}.wav`), `prepis:ok-${i}.wav`);
  }
  await pocakaj(() => stanjeRsdo().stanje === "pripravljen");
  assert.notEqual(stanjeRsdo().stanje, "napaka");
});

test("pregled 029, najdba 6: med nalaganjem prepis ne zazene CLI (drugi model); posnetek je omejen", async () => {
  nastavi("pocasi-nalaga");
  const klici: string[][] = [];
  const izv: Izvajalec = async (program, args) => {
    klici.push([program, ...args]);
    return program === "ffmpeg" ? { koda: 0, izhod: "" } : { koda: 0, izhod: '{"besedilo": "iz cli"}' };
  };
  const dom = mkdtempSync(path.join(tmpdir(), "lina-rsdo-dom-"));
  await vklopiRsdo();
  assert.equal(stanjeRsdo().stanje, "nalaga");
  assert.equal(await prepisiRsdo(Buffer.from("x"), "audio/ogg", { izvajalec: izv, dom }), null);
  assert.ok(!klici.some((k) => k.includes("slovenski")), "CLI ne sme biti poklican");
  assert.equal(klici.length, 0, "med nalaganjem niti ffmpeg");
  izklopiRsdo();
  // izklopljen: CLI pot ostane; ffmpeg reze posnetek na NAJDALJSI_POSNETEK_S
  assert.equal(await prepisiRsdo(Buffer.from("x"), "audio/ogg", { izvajalec: izv, dom }), "iz cli");
  const ff = klici.find((k) => k[0] === "ffmpeg") ?? [];
  assert.equal(ff[ff.indexOf("-t") + 1], String(NAJDALJSI_POSNETEK_S));
});

test("pregled 029, najdba 14: izklop in takojsen vklop - nov model sele po koncu starega procesa", async () => {
  const dnevnik = nastavi("pocasi-ugasne");
  await vklopiRsdo();
  await pocakaj(() => stanjeRsdo().stanje === "pripravljen");
  const star = stanjeRsdo().pid!;
  izklopiRsdo();
  const vklop = vklopiRsdo();
  // med cakanjem na konec starega procesa velja »nalaga« (prepis ne gre v CLI)
  assert.equal(stanjeRsdo().stanje, "nalaga");
  await vklop;
  assert.equal(ziv(star), false, "star proces je ze koncal, ko se zacne nov");
  await pocakaj(() => vrstice(dnevnik, "zagon").length === 2 && stanjeRsdo().stanje === "pripravljen");
});

test("pregled 029, najdba 15: besedilo procesa brez krmilnih znakov in najvec NAJVEC_BESEDILA", async () => {
  nastavi("dolg");
  await vklopiRsdo();
  await pocakaj(() => stanjeRsdo().stanje === "pripravljen");
  const b = (await prepisiPrekStreznika("/tmp/d.wav")) ?? "";
  assert.ok(b.length <= NAJVEC_BESEDILA, `dolzina ${b.length}`);
  assert.doesNotMatch(b, /[\u0000-\u001f\u2028]/);
  assert.match(b, /^a b c d/);
});

test("pregled 029, najdba 18: rsdo-streznik.py zazna siroto tudi pod subreaperjem (stars ni 1)", async (t) => {
  if (spawnSync("python3", ["--version"]).status !== 0) return t.skip("python3 ni na voljo");
  const skripta = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts", "rsdo-streznik.py");
  const koda = [
    "import importlib.util, os, sys",
    `spec = importlib.util.spec_from_file_location("rs", ${JSON.stringify(skripta)})`,
    "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
    "os.getppid = lambda: 4242",
    "try:",
    "    m._ob_smrti_starsa(1000)",
    "    print('ZIV')",
    "except SystemExit:",
    "    print('KONEC')",
    "try:",
    "    m._ob_smrti_starsa(4242)",
    "    print('ZIV')",
    "except SystemExit:",
    "    print('KONEC')",
  ].join("\n");
  const r = spawnSync("python3", ["-B", "-I", "-c", koda], { encoding: "utf8" });
  assert.equal(r.stdout.trim().split("\n").join(","), "KONEC,ZIV", r.stderr);
});

test("CodeRabbit 029 (naloga 2, B5): hiter izklop in vklop med iskanjem ukaza - zagon je last rodu, nov rod se zazene", async () => {
  const dnevnik = path.join(mapa, `dnevnik-${++stevec}.txt`);
  writeFileSync(dnevnik, "");
  const iskanja: Promise<unknown>[] = [];
  // zakasnjeno iskanje ukaza (kot pocasen cli-anything-linuxmint)
  nastaviOdvisnostiRsdoStreznika({
    ukaz: () => {
      const p = new Promise<{ program: string; args: string[] }>((r) => setTimeout(() => r({ program: process.execPath, args: [lazni, "obicajen", dnevnik] }), 300));
      iskanja.push(p);
      return p;
    },
    premorPonovitveMs: 10,
  });
  const prvi = vklopiRsdo();
  izklopiRsdo();
  const drugi = vklopiRsdo();
  assert.equal(stanjeRsdo().stanje, "nalaga", "nov rod se nalaga, ne ostane izklopljen");
  await Promise.all([prvi, drugi, ...iskanja]);
  await pocakaj(() => stanjeRsdo().stanje === "pripravljen", 3000);
  assert.equal(vrstice(dnevnik, "zagon").length, 1, "en sam proces");
});

test("CodeRabbit 029 (naloga 2, B5): izklop med cakanjem na konec starega procesa - zastarelo cakanje ne zazene drugega iskanja", async () => {
  const dnevnik = path.join(mapa, `dnevnik-${++stevec}.txt`);
  writeFileSync(dnevnik, "");
  let iskanj = 0;
  nastaviOdvisnostiRsdoStreznika({ ukaz: async () => (iskanj++, { program: process.execPath, args: [lazni, "pocasi-ugasne", dnevnik] }), premorPonovitveMs: 10 });
  await vklopiRsdo();
  await pocakaj(() => stanjeRsdo().stanje === "pripravljen");
  izklopiRsdo();
  const prvi = vklopiRsdo(); // caka na konec starega procesa (400 ms po SIGTERM)
  izklopiRsdo();
  const drugi = vklopiRsdo();
  await Promise.all([prvi, drugi]);
  await pocakaj(() => stanjeRsdo().stanje === "pripravljen");
  assert.equal(iskanj, 2, "prvi zagon + EN zagon po hitrem izklopu in vklopu");
  assert.equal(vrstice(dnevnik, "zagon").length, 2);
});

test("naloga 3, pregled 029b najdba 2: 3 zaporedni roki brez odgovora vmes = napaka »proces-visi«; po 2 se se zazene znova", async () => {
  const dnevnik = nastavi("visi", { rokZahteveMs: 40 });
  await vklopiRsdo();
  for (let i = 0; i < 2; i += 1) {
    await pocakaj(() => stanjeRsdo().stanje === "pripravljen");
    assert.equal(await prepisiPrekStreznika(`/tmp/r${i}.wav`), null);
    await pocakaj(() => vrstice(dnevnik, "zagon").length === i + 2);
  }
  await pocakaj(() => stanjeRsdo().stanje === "pripravljen");
  assert.equal(await prepisiPrekStreznika("/tmp/r2.wav"), null);
  await pocakaj(() => stanjeRsdo().stanje === "napaka");
  assert.equal(stanjeRsdo().razlog, "proces-visi");
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(vrstice(dnevnik, "zagon").length, 3, "brez cetrtega nalaganja");
  // izklop in vklop zacne znova (stevec je pociscen)
  izklopiRsdo();
  await vklopiRsdo();
  await pocakaj(() => stanjeRsdo().stanje === "pripravljen");
});

test("naloga 3, CodeRabbit 029b: vklop med pretvorbo ffmpeg - tik pred CLI znova preveri, CLI ne zazene drugega modela", async () => {
  let nalaga = false;
  const streznik: StreznikRsdo = { pripravljen: () => false, prepisi: async () => null, nalaga: () => nalaga, vklopljen: () => nalaga };
  const klici: string[][] = [];
  const izv: Izvajalec = async (program, args) => {
    klici.push([program, ...args]);
    if (program === "ffmpeg") {
      nalaga = true; // uporabnik vklopi stikalo med pretvorbo
      return { koda: 0, izhod: "" };
    }
    return { koda: 0, izhod: '{"besedilo": "iz cli"}' };
  };
  const dom = mkdtempSync(path.join(tmpdir(), "lina-rsdo-dom-"));
  assert.equal(await prepisiRsdo(Buffer.from("x"), "audio/ogg", { izvajalec: izv, dom, streznik }), null);
  assert.ok(!klici.some((k) => k.includes("slovenski")), "CLI ne sme biti poklican");
});

test("naloga 3, CodeRabbit 029b: stikalo vklopljeno, proces v napaki - prepis prek privzetega streznika ne zazene CLI", async () => {
  nastaviOdvisnostiRsdoStreznika({ ukaz: async () => ({ napaka: "zagon-ni-uspel" }) });
  await vklopiRsdo();
  assert.equal(stanjeRsdo().stanje, "napaka");
  const klici: string[][] = [];
  const izv: Izvajalec = async (program, args) => (klici.push([program, ...args]), program === "ffmpeg" ? { koda: 0, izhod: "" } : { koda: 0, izhod: '{"besedilo": "iz cli"}' });
  const dom = mkdtempSync(path.join(tmpdir(), "lina-rsdo-dom-"));
  assert.equal(await prepisiRsdo(Buffer.from("x"), "audio/ogg", { izvajalec: izv, dom }), null);
  assert.ok(!klici.some((k) => k.includes("slovenski")), "CLI ne sme biti poklican");
  // stikalo izklopljeno: CLI ostane pot
  izklopiRsdo();
  assert.equal(await prepisiRsdo(Buffer.from("x"), "audio/ogg", { izvajalec: izv, dom }), "iz cli");
});

const omejeno = <T>(p: Promise<T>, ms: number): Promise<T | "rok"> => Promise.race([p, new Promise<"rok">((r) => setTimeout(() => r("rok"), ms))]);

test("naloga 3, pregled 029b najdba 6: izklop takoj po neuspelem zagonu (ENOENT, brez dogodka exit) - nov vklop ne visi", async () => {
  nastaviOdvisnostiRsdoStreznika({ ukaz: async () => ({ program: path.join(mapa, "ni-takega-pythona"), args: [] }), premorPonovitveMs: 10 });
  await vklopiRsdo();
  izklopiRsdo();
  assert.notEqual(await omejeno(vklopiRsdo(), 1500), "rok", "vklop caka na konec procesa, ki ga ni bilo");
});

test("naloga 3, pregled 029b najdba 6: proces, ki SIGTERM ne uposteva - po roku ugasanja SIGKILL in vklop gre naprej", async () => {
  const dnevnik = nastavi("neubogljiv", { rokUgasanjaMs: 100 });
  await vklopiRsdo();
  await pocakaj(() => stanjeRsdo().stanje === "pripravljen");
  const star = stanjeRsdo().pid!;
  izklopiRsdo();
  const zacetek = Date.now();
  assert.notEqual(await omejeno(vklopiRsdo(), 5000), "rok");
  assert.ok(Date.now() - zacetek < 1500, `vklop je cakal ${Date.now() - zacetek} ms`);
  await pocakaj(() => !ziv(star));
  await pocakaj(() => vrstice(dnevnik, "zagon").length === 2 && stanjeRsdo().stanje === "pripravljen");
});

test("naloga 3, pregled 029b najdba 5: rsdo-streznik.py prebere starsa ob nalaganju modula (Lina umre med zagonom)", (t) => {
  if (spawnSync("python3", ["--version"]).status !== 0) return t.skip("python3 ni na voljo");
  const skripta = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts", "rsdo-streznik.py");
  const koda = [
    "import importlib.util, os, sys",
    "os.getppid = lambda: 4242",
    `spec = importlib.util.spec_from_file_location("rs", ${JSON.stringify(skripta)})`,
    "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
    "os.getppid = lambda: 1",
    "sys.argv = ['rsdo-streznik.py', '/ni/model.nemo']",
    "try:",
    "    m.main()",
    "    print('ZIV')",
    "except SystemExit:",
    "    print('KONEC')",
    "except Exception as e:",
    "    print('ZIV ' + type(e).__name__)",
  ].join("\n");
  const r = spawnSync("python3", ["-B", "-I", "-c", koda], { encoding: "utf8" });
  assert.equal(r.stdout.trim(), "KONEC", r.stdout + r.stderr);
});
