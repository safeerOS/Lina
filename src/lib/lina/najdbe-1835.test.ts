// Popravki najdb slepega pregleda (pregled-zdruzitev-1750/NAJDBE-RAC-A.md: N1, N2, N3, N4, N5, N8, N9).
// Uvoz z imenskim prostorom in await import(): na izvirniku pade vsak preizkus posebej, ne cela datoteka.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { deflateSync } from "node:zlib";
import { setupOwner } from "./auth.server.ts";
import * as KS from "./kontrola-tiska.server.ts";
import * as K from "./kontrola-tiska.ts";
import { sl2, en2 } from "../../components/lina2/besedila.ts";

const SKRIPTE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts");
const PY = process.env.LINA_KONTROLA_TISKA_PYTHON?.trim() ?? "";
const brezPythona = !PY || !existsSync(PY) ? "LINA_KONTROLA_TISKA_PYTHON ni nastavljen: pravi Python z OpenCV NI preizkusen" : false;
const X = KS as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
const XK = K as unknown as Record<string, unknown>;

afterEach(() => KS.nastaviOdvisnostiKontrole(null));

async function okolje() {
  const dir = mkdtempSync(path.join(tmpdir(), "lina-n1835-"));
  return { dir, token: await setupOwner("geslo-test-1234", dir) };
}

/** Veljavna glava PNG (podpis + IHDR) z izmisljenimi merami; podatkov slike ni (dekodirati se ne da, mere pa so v glavi). */
function glavaPng(w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "latin1");
  ihdr.writeUInt32BE(w, 8);
  ihdr.writeUInt32BE(h, 12);
  ihdr[16] = 8;
  ihdr[17] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr]);
}

/** Glava JPEG s SOF0 (mere) za preverbo branja mer. */
function glavaJpg(w: number, h: number): Buffer {
  const sof = Buffer.from([0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0]);
  const app0 = Buffer.from([0xff, 0xe0, 0, 4, 0, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

/** Pravi majhen PNG (RGB, ena barva) za normalno pot. */
function majhenPng(w = 4, h = 4): Buffer {
  const vrstica = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 200)]);
  const surovo = Buffer.concat(Array.from({ length: h }, () => vrstica));
  const kos = (tip: string, d: Buffer) => {
    const t = Buffer.from(tip, "latin1");
    const dol = Buffer.alloc(4);
    dol.writeUInt32BE(d.length);
    return Buffer.concat([dol, t, d, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), kos("IHDR", ihdr), kos("IDAT", deflateSync(surovo)), kos("IEND", Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- N1: slika-bomba

test("N1: mere slike se preberejo iz glave PNG in JPEG", () => {
  const mere = XK.mereSlike as (b: Buffer) => { sirina: number; visina: number } | null;
  assert.equal(typeof mere, "function");
  assert.deepEqual(mere(glavaPng(32767, 32767)), { sirina: 32767, visina: 32767 });
  assert.deepEqual(mere(glavaJpg(4000, 3000)), { sirina: 4000, visina: 3000 });
  assert.equal(mere(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])), null);
});

test("N1: referenca 32767 x 32767 (majhna datoteka) se zavrne PRED zagonom Pythona", async () => {
  const { dir, token } = await okolje();
  const klici: string[][] = [];
  KS.nastaviOdvisnostiKontrole({ zagon: async (_p, a) => (klici.push(a), { koda: 0, stdout: "{}", stderr: "", casovnaMeja: false }), python: () => "/lazni/python" });
  const r = await KS.izmeriTisk(token, { fotografija: majhenPng().toString("base64"), referenca: glavaPng(32767, 32767).toString("base64"), vrstaReference: "motiv" }, dir);
  assert.equal(r.izid.ocena, "NI MOGOCE IZMERITI");
  assert.equal(klici.length, 0, "Python se ne sme zagnati za sliko-bombo");
});

test("N1: fotografija s telefona z mero nad mejo se ne shrani v prejete", async () => {
  const { dir } = await okolje();
  const r = (await KS.shraniPrejetoSliko(dir, glavaPng(32767, 32767))) as { ok: boolean; razlog?: string };
  assert.equal(r.ok, false);
  assert.equal(r.razlog, "prevelika");
});

test("N1: Python zavrne sliko nad mejo tock, PREDEN jo dekodira (pomnilnik ostane nizek)", { skip: brezPythona, timeout: 300_000 }, () => {
  const mapa = mkdtempSync(path.join(tmpdir(), "lina-n1-py-"));
  // 12000 x 12000 RGB = 144 MP (> 60 MP) = 432 MB ob dekodiranju; datoteka je nekaj sto kB
  const koda = `
import sys, zlib, struct
w = h = 12000
def ch(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
c = zlib.compressobj(1); vr = b'\\x00' + b'\\xc8' * (3 * w); kosi = [c.compress(vr) for _ in range(h)]; kosi.append(c.flush())
open(sys.argv[1], 'wb').write(b'\\x89PNG\\r\\n\\x1a\\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + ch(b'IDAT', b''.join(kosi)) + ch(b'IEND', b''))
`;
  execFileSync(PY, ["-B", "-I", "-c", koda, path.join(mapa, "bomba.png")], { timeout: 120_000 });
  const meri = `
import sys, json, resource, runpy
sys.argv = [sys.argv[1], "izmeri", "--fotografija", sys.argv[2], "--referenca", sys.argv[2]]
try:
    runpy.run_path(sys.argv[0], run_name="__main__")
except SystemExit:
    pass
print(json.dumps({"rss_mb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024}))
`;
  const izhod = execFileSync(PY, ["-B", "-I", "-c", meri, path.join(SKRIPTE, "kontrola_tiska.py"), path.join(mapa, "bomba.png")], { timeout: 240_000, encoding: "utf8" });
  const vrstice = izhod.trim().split("\n");
  const izid = JSON.parse(vrstice[vrstice.length - 2]) as { ocena: string; razlogi: string[] };
  const { rss_mb } = JSON.parse(vrstice[vrstice.length - 1]) as { rss_mb: number };
  assert.equal(izid.ocena, "NI MOGOCE IZMERITI");
  assert.ok(rss_mb < 380, `najvec RSS ${Math.round(rss_mb)} MB: slika je bila dekodirana pred preverbo mere`);
});

// ---------------------------------------------------------------- N2: namestitev knjiznic

test("N2: pip tece izoliran, samo z uradnega PyPI, samo kolesa; venv z -I", () => {
  const pip = K.argumentiPip();
  assert.equal(pip[0], "-I", "python -I: trenutna mapa ne sme v sys.path");
  assert.ok(pip.includes("--isolated"), "pip --isolated: brez PIP_* okolja in pip.conf");
  const i = pip.indexOf("--index-url");
  assert.ok(i > 0 && pip[i + 1] === "https://pypi.org/simple");
  assert.ok(!pip.some((a) => /extra-index/.test(a)));
  assert.ok(pip.includes("--only-binary=:all:"));
  assert.ok(pip.includes("pip") && pip.includes("install"));
  assert.deepEqual(K.argumentiVenv("/m").slice(0, 3), ["-I", "-m", "venv"]);
});

test("N2: besedilo soglasja ne obljublja tocnih razlicic za odvisnosti", () => {
  for (const b of [sl2.ktSoglasjeOpis, en2.ktSoglasjeOpis]) {
    assert.match(b, /pypi\.org/i);
    assert.match(b, /odvisnost|dependenc/i, "pove, da odvisnosti niso pripete");
  }
});

// ---------------------------------------------------------------- N3: nikoli lazni OK

const POLOZAJ = { zgoraj_sredina_mm: [0, 75], odmik_x_mm: 0, odmik_y_mm: 0, zasuk_deg: 0, sirina_mm: 250, sirina_odstopanje_rel: 0 };

test("N3: OK brez izmerjene barve je NI MOGOCE IZMERITI (TS varovalo)", () => {
  const i = K.preveriIzid({ ocena: "OK", razlogi: [], napake: [], polozaj: POLOZAJ, barva: null, registracija: null });
  assert.notEqual(i.ocena, "OK");
  const z = K.preveriIzid({ ocena: "OK", razlogi: [], napake: [], polozaj: POLOZAJ, barva: { dE00_povprecje: 1, dE00_p95: 2 } });
  assert.equal(z.ocena, "OK", "enobarven motiv brez registracije je z barvo se vedno OK");
});

test("N3: tanek napis v napacni barvi ni nikoli OK (pravi Python)", { skip: brezPythona, timeout: 300_000 }, () => {
  const mapa = mkdtempSync(path.join(tmpdir(), "lina-n3-py-"));
  const koda = `
import sys, json, cv2, numpy as np
sys.path.insert(0, sys.argv[1])
import kontrola_tiska_sinteticno as sn
izh = sys.argv[2]
STIRI = {"0": [0.0, -40.0, 50.0], "1": [-200.0, 100.0, 50.0], "2": [200.0, 100.0, 50.0], "3": [0.0, 460.0, 50.0]}
def napis(bgr):
    m = np.zeros((760, 1000, 4), np.uint8)
    for i, t in enumerate(("LINA TISK", "KONTROLA", "1234567")):
        cv2.putText(m, t, (40, 200 + i * 220), cv2.FONT_HERSHEY_SIMPLEX, 5.0, (*bgr, 255), 6, cv2.LINE_8)
    return m
rdec, crn = napis((30, 30, 200)), napis((20, 20, 20))
cv2.imwrite(izh + "/motiv.png", rdec)
pl, _ = sn.ravnina(crn, STIRI, (0.0, 75.0), 0.0, 250.0, seme=11)
cv2.imwrite(izh + "/foto.jpg", sn.fotografiraj(pl, seme=12))
`;
  execFileSync(PY, ["-B", "-I", "-c", koda, SKRIPTE, mapa], { timeout: 120_000 });
  const nast = JSON.stringify({ oznake: { "0": [0, -40, 50], "1": [-200, 100, 50], "2": [200, 100, 50], "3": [0, 460, 50] }, obmocje_mm: [-260, -90, 260, 520] });
  const izhod = execFileSync(PY, ["-B", "-I", path.join(SKRIPTE, "kontrola_tiska.py"), "izmeri", "--fotografija", path.join(mapa, "foto.jpg"), "--referenca", path.join(mapa, "motiv.png"), "--nastavitve-json", nast], { timeout: 240_000, encoding: "utf8" });
  const izid = KS.zadnjiJson(izhod) as { ocena: string; barva?: unknown; razlogi: string[] };
  assert.notEqual(izid.ocena, "OK", `crn napis namesto rdecega: ${JSON.stringify({ ocena: izid.ocena, barva: izid.barva, razlogi: izid.razlogi })}`);
  assert.notEqual(K.preveriIzid(izid).ocena, "OK");
});

// ---------------------------------------------------------------- N4: stevilke iz besedila modela

test("N4: stevilke v besedah, druge pisave in ocena OK/NI OK se odstranijo; navadne besede ostanejo", () => {
  const o = K.odstraniStevilke("Zamik je približno pet milimetrov in dve stopinji. Tisk je OK. Ni OK? ５ mm, ٥ cm. Desno pol centimetra. Tri pike.");
  for (const x of ["pet", "dve", "OK", "５", "٥", " pol ", "Tri"]) assert.ok(!o.includes(x), `ostalo: ${x} v »${o}«`);
  assert.ok(!/five|two/i.test(K.odstraniStevilke("five millimetres, two degrees")));
  assert.ok(!/\p{N}/u.test(K.odstraniStevilke("zamik 5mm, 1,5mm, 2x, dE00")), "stevke ob crkah se odstranijo kot prej");
  const ohrani = K.odstraniStevilke("Razmaz zgoraj levo, nitka na sredini, petelin in dvorišče.");
  assert.match(ohrani, /petelin/);
  assert.match(ohrani, /dvorišče/);
  assert.match(ohrani, /Razmaz zgoraj levo/);
});

// ---------------------------------------------------------------- N5: B9 - slika motiva samo izbranemu placljivemu modelu

test("N5: opis tiska ne gre prek OmniRoute in nikoli k samodejno zamenjanemu modelu", () => {
  const klic = XK.klicOpisa as (brain: Record<string, unknown>, slika: Buffer) => Record<string, unknown> | null;
  assert.equal(typeof klic, "function");
  const slika = Buffer.from("png");
  assert.equal(klic({ provider: "omniroute", model: "auto", key: "k" }, slika), null, "OmniRoute posreduje neznanim ponudnikom");
  const v = klic({ provider: "openai", model: "gpt-x", key: "k" }, slika);
  assert.ok(v);
  assert.equal(v!.brezZamenjave, true);
  assert.equal(v!.vsebinaKlica, false);
  assert.equal(v!.prehod, undefined);
  assert.equal(v!.brezplacniDovoljeni, undefined);
});

// ---------------------------------------------------------------- N8: prejete slike - lastnikovo izrecno ciscenje

test("N8: lastnik z izrecno potrditvijo pocisti prejete; brez potrditve ali prijave nic", async () => {
  const { dir, token } = await okolje();
  const pocisti = X.pocistiPrejete;
  assert.equal(typeof pocisti, "function");
  KS.nastaviOdvisnostiKontrole({ zdaj: () => new Date(Date.UTC(2026, 10, 24, 18, 35, 0)) });
  for (let i = 0; i < KS.NAJVEC_PREJETIH; i++) assert.equal((await KS.shraniPrejetoSliko(dir, majhenPng())).ok, true);
  assert.deepEqual(await KS.shraniPrejetoSliko(dir, majhenPng()), { ok: false, razlog: "polno" });
  const mapa = path.join(dir, KS.MAPA_PREJETIH);
  writeFileSync(path.join(mapa, "tuja.txt"), "ostane");
  await assert.rejects(pocisti(null, true, dir));
  assert.deepEqual(await pocisti(token, "da", dir), { ok: false, razlog: "brez-potrditve" });
  assert.equal(readdirSync(mapa).length, KS.NAJVEC_PREJETIH + 1);
  assert.deepEqual(await pocisti(token, true, dir), { ok: true, izbrisano: KS.NAJVEC_PREJETIH });
  assert.deepEqual(readdirSync(mapa), ["tuja.txt"], "brise samo lastna imena prejetih slik");
  assert.equal((await KS.shraniPrejetoSliko(dir, majhenPng())).ok, true);
});

test("N8: vmesnik ima gumb za ciscenje z dvema korakoma, besedila v obeh jezikih, streznisko funkcijo", () => {
  const ui = readFileSync(new URL("../../components/lina2/kontrola-tiska.tsx", import.meta.url), "utf8");
  const fn = readFileSync(new URL("./functions.ts", import.meta.url), "utf8");
  assert.match(fn, /pocistiPrejeteKontroleFn[\s\S]{0,400}pocistiPrejete\(await sessionToken\(\), data\?\.potrditev\)/);
  assert.match(ui, /pocistiPrejeteKontroleFn\(\{ data: \{ potrditev: true \} \}\)/);
  const b = (sl2 as Record<string, string>);
  const e = (en2 as Record<string, string>);
  for (const k of ["ktPocistiPrejete", "ktPocistiPotrdi"]) assert.ok(b[k] && e[k], k);
});

// ---------------------------------------------------------------- N9: mikrofon

type Sled = { ustavljena: boolean; stop(): void };
function lazniTok(): { tok: MediaStream; sledi: Sled[] } {
  const sledi: Sled[] = [{ ustavljena: false, stop() { this.ustavljena = true; } }];
  return { tok: { getTracks: () => sledi } as unknown as MediaStream, sledi };
}
type Odpiranje = {
  odpriSnemanje: <T>(o: { zaklep: { zaseden: boolean }; odpri: () => Promise<MediaStream>; nastavitev: Promise<boolean>; ziv: () => boolean; pripravi: (tok: MediaStream, zmanjsanje: boolean) => T }) => Promise<{ ok: true; tok: MediaStream; vrednost: T } | { ok: false; razlog: string }>;
};
const odpiranje = () => import("../../components/lina2/odpiranje-mikrofona.ts" as string) as Promise<Odpiranje>;

test("N9 A: drugi zagon med odpiranjem mikrofona se zavrne (ena sama snemanja)", async () => {
  const { odpriSnemanje } = await odpiranje();
  const zaklep = { zaseden: false };
  const a = lazniTok();
  let spusti!: () => void;
  const nastavitev = new Promise<boolean>((r) => (spusti = () => r(true)));
  const prvi = odpriSnemanje({ zaklep, odpri: async () => a.tok, nastavitev, ziv: () => true, pripravi: () => "prvi" });
  const drugi = await odpriSnemanje({ zaklep, odpri: async () => lazniTok().tok, nastavitev: Promise.resolve(true), ziv: () => true, pripravi: () => "drugi" });
  assert.deepEqual(drugi, { ok: false, razlog: "ze-tece" });
  spusti();
  const p = await prvi;
  assert.equal(p.ok, true);
  assert.equal(zaklep.zaseden, true, "zaklep ostane, dokler snemanje ne konca");
});

test("N9 B: odklop med cakanjem na nastavitev ustavi mikrofon in ne pripravi snemanja", async () => {
  const { odpriSnemanje } = await odpiranje();
  const a = lazniTok();
  let ziv = true;
  let pripravljeno = false;
  const zaklep = { zaseden: false };
  const r = await odpriSnemanje({ zaklep, odpri: async () => a.tok, nastavitev: Promise.resolve(true).then((v) => ((ziv = false), v)), ziv: () => ziv, pripravi: () => (pripravljeno = true) });
  assert.deepEqual(r, { ok: false, razlog: "odklop" });
  assert.equal(a.sledi[0].ustavljena, true);
  assert.equal(pripravljeno, false);
  assert.equal(zaklep.zaseden, false);
});

test("N9 C: napaka pri pripravi (AudioContext, MediaRecorder) ustavi sledi mikrofona", async () => {
  const { odpriSnemanje } = await odpiranje();
  const a = lazniTok();
  const zaklep = { zaseden: false };
  const r = await odpriSnemanje({ zaklep, odpri: async () => a.tok, nastavitev: Promise.resolve(true), ziv: () => true, pripravi: () => { throw new Error("MediaRecorder"); } });
  assert.deepEqual(r, { ok: false, razlog: "priprava" });
  assert.equal(a.sledi[0].ustavljena, true);
  assert.equal(zaklep.zaseden, false);
});

test("N9: pogovor.tsx uporablja skupno odpiranje (zaklep in sprostitev ob koncu snemanja)", () => {
  const p = readFileSync(new URL("../../components/lina2/pogovor.tsx", import.meta.url), "utf8");
  assert.match(p, /odpriSnemanje\(\{/);
  assert.match(p, /zaklepMikrofona\.current\.zaseden = false/);
});
