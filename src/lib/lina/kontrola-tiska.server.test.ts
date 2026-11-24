import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { setupOwner } from "./auth.server.ts";
import {
  DATOTEKA_NASTAVITEV,
  izmeriTisk,
  namestiKnjizniceVida,
  nastaviOdvisnostiKontrole,
  opisiNapake,
  oznakePdf,
  prejetaSlika,
  prejeteSlike,
  shraniPrejetoSliko,
  shraniNastavitveKontrole,
  zadnjeKontrole,
  zadnjiJson,
  type Zagon,
} from "./kontrola-tiska.server.ts";
import { GLAVA_CSV, PAKETI_VIDA, STIRI_OZNAKE } from "./kontrola-tiska.ts";
import { zapisiDovoljenje } from "./dovoljenja-podobne.server.ts";
import { uvoziNarocila } from "./narocila.server.ts";

const SKRIPTE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts");
// N1 (1835): meritev zahteva berljive mere iz glave, zato lazni sliki nosita glavo z merami (JPEG SOF0 640x480, PNG IHDR 4x4)
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 1, 0xe0, 2, 0x80, 1, 1, 0x11, 0, 1, 2, 3]).toString("base64");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 4, 0, 0, 0, 4, 8, 2, 1, 2]).toString("base64");

async function okolje() {
  const dir = mkdtempSync(path.join(tmpdir(), "lina-kt-"));
  return { dir, token: await setupOwner("geslo-test-1234", dir) };
}

afterEach(() => nastaviOdvisnostiKontrole(null));

const IZID_NI_OK = {
  ocena: "NI OK",
  razlogi: ["navpicni odmik +7.0 mm (meja 5.0 mm)"],
  napake: [],
  oznake_najdene: [0],
  polozaj: { zgoraj_sredina_mm: [0, 82], odmik_x_mm: 0, odmik_y_mm: 7, zasuk_deg: 0, sirina_mm: 250, sirina_odstopanje_rel: 0 },
};

function lazniZagon(izid: unknown, klici: Array<{ program: string; args: string[] }> = []): Zagon {
  return async (program, args) => {
    klici.push({ program, args });
    const i = args.indexOf("--slika");
    if (i >= 0) writeFileSync(args[i + 1], Buffer.from(PNG, "base64"));
    return { koda: 0, stdout: `opozorilo knjiznice\n${JSON.stringify(izid)}\n`, stderr: "", casovnaMeja: false };
  };
}

test("meritev: brez prijave lastnika ni meritve", async () => {
  const { dir } = await okolje();
  await assert.rejects(izmeriTisk(null, { fotografija: JPG, referenca: PNG, vrstaReference: "motiv" }, dir));
});

test("meritev: izid NI OK gre v dnevnik CSV in JSONL, oznacena slika v mapo dnevnika; zacasne datoteke pospravljene", async () => {
  const { dir, token } = await okolje();
  const klici: Array<{ program: string; args: string[] }> = [];
  nastaviOdvisnostiKontrole({ zagon: lazniZagon(IZID_NI_OK, klici), python: () => "/lazni/python" });
  const r = await izmeriTisk(token, { fotografija: JPG, referenca: PNG, vrstaReference: "motiv", nalog: "N-42", imeReference: "motiv.png" }, dir);
  assert.equal(r.izid.ocena, "NI OK");
  assert.equal(r.izid.polozaj?.odmik_y_mm, 7);
  assert.ok(r.zapisano && r.mapaDnevnika && r.slika);
  const csv = readFileSync(path.join(r.mapaDnevnika!, "kontrola-tiska.csv"), "utf8");
  assert.ok(csv.startsWith(`\ufeff${GLAVA_CSV}\n`));
  assert.ok(csv.includes(`"N-42"`) && csv.includes(`"NI OK"`));
  assert.ok(existsSync(path.join(r.mapaDnevnika!, r.slika!)));
  // ukaz brez lupine: python -B -I skripta izmeri ... z nastavitvami kot JSON
  const a = klici[0].args;
  assert.deepEqual(a.slice(0, 2), ["-B", "-I"]);
  assert.ok(a[2].endsWith("kontrola_tiska.py") && a[3] === "izmeri");
  assert.equal(JSON.parse(a[a.indexOf("--nastavitve-json") + 1]).tolerance.odmik_y_mm, 5);
  assert.deepEqual(readdirSync(path.join(dir, "kontrola-tiska-zacasno")), [], "zacasne datoteke meritve pobrisane");
  const z = await zadnjeKontrole(token, 10, dir);
  assert.equal(z.zapisi.length, 1);
  assert.equal(z.zapisi[0].nalog, "N-42");
});

test("meritev: neveljaven vhod (ni slika, prevelik) ne zazene Pythona", async () => {
  const { dir, token } = await okolje();
  const klici: Array<{ program: string; args: string[] }> = [];
  nastaviOdvisnostiKontrole({ zagon: lazniZagon(IZID_NI_OK, klici), python: () => "/lazni/python" });
  const pdf = Buffer.from("%PDF-1.4 ...").toString("base64");
  assert.equal((await izmeriTisk(token, { fotografija: pdf, referenca: PNG, vrstaReference: "motiv" }, dir)).izid.napaka, "fotografija-neveljavna");
  assert.equal((await izmeriTisk(token, { fotografija: JPG, referenca: 42, vrstaReference: "motiv" }, dir)).izid.napaka, "referenca-neveljavna");
  const velika = "/9j/" + "A".repeat(41 * 1024 * 1024);
  assert.equal((await izmeriTisk(token, { fotografija: velika, referenca: PNG, vrstaReference: "motiv" }, dir)).izid.napaka, "fotografija-neveljavna");
  assert.equal(klici.length, 0);
});

test("meritev: rok, padec Pythona, smeti na izhodu in lazni OK so NI MOGOCE IZMERITI", async () => {
  const { dir, token } = await okolje();
  const primeri: Array<[Awaited<ReturnType<Zagon>>, string]> = [
    [{ koda: null, stdout: "", stderr: "", casovnaMeja: true }, "rok-meritve"],
    [{ koda: 1, stdout: "", stderr: "ModuleNotFoundError: No module named 'cv2'", casovnaMeja: false }, "knjiznice-manjkajo"],
    [{ koda: 0, stdout: "ni json", stderr: "", casovnaMeja: false }, "izid-neveljaven"],
    [{ koda: 0, stdout: JSON.stringify({ ocena: "OK" }), stderr: "", casovnaMeja: false }, "izid-nepopoln"],
  ];
  for (const [izhod, koda] of primeri) {
    nastaviOdvisnostiKontrole({ zagon: async () => izhod, python: () => "/lazni/python" });
    const r = await izmeriTisk(token, { fotografija: JPG, referenca: PNG, vrstaReference: "motiv" }, dir);
    assert.equal(r.izid.ocena, "NI MOGOCE IZMERITI", koda);
    assert.equal(r.izid.napaka, koda);
    assert.equal(r.slika, null, "brez meritve ni oznacene slike");
  }
});

test("nastavitve: shrani v datoteko, izbrana mapa dnevnika se preveri; sistemska mapa je zavrnjena", async () => {
  const { dir, token } = await okolje();
  const mapa = path.join(dir, "moj-dnevnik");
  const r = await shraniNastavitveKontrole(token, { meritev: { oznake: STIRI_OZNAKE }, mapaDnevnika: mapa }, dir);
  assert.ok(r.ok);
  assert.ok(existsSync(mapa));
  assert.equal(JSON.parse(readFileSync(path.join(dir, DATOTEKA_NASTAVITEV), "utf8")).mapaDnevnika, mapa);
  const s = await shraniNastavitveKontrole(token, { mapaDnevnika: "/etc" }, dir);
  assert.equal(s.ok, false);
  const t = await shraniNastavitveKontrole(token, { meritev: { tolerance: { odmik_x_mm: 0 } } }, dir);
  assert.equal(t.ok, false);
});

test("namestitev: brez soglasja === true se ne zazene nic; s soglasjem venv in pip samo s kolesi", async () => {
  const { dir, token } = await okolje();
  const klici: Array<{ program: string; args: string[] }> = [];
  nastaviOdvisnostiKontrole({
    platforma: "linux",
    zagon: async (program, args) => {
      klici.push({ program, args });
      if (args.includes("preveri")) return { koda: 0, stdout: JSON.stringify({ ok: true, opencv: "5.1.0" }), stderr: "", casovnaMeja: false };
      return { koda: 0, stdout: "", stderr: "", casovnaMeja: false };
    },
  });
  for (const s of [undefined, "da", 1, false]) assert.deepEqual(await namestiKnjizniceVida(token, s, dir), { ok: false, razlog: "brez-soglasja" });
  assert.equal(klici.length, 0);
  const r = await namestiKnjizniceVida(token, true, dir);
  assert.deepEqual(r, { ok: true, razlog: "" });
  assert.equal(klici[0].program, "python3");
  assert.deepEqual(klici[0].args, ["-I", "-m", "venv", path.join(dir, "kontrola-tiska-python")]);
  assert.equal(klici[1].program, path.join(dir, "kontrola-tiska-python", "bin", "python"));
  assert.ok(klici[1].args.includes("--only-binary=:all:") && PAKETI_VIDA.every((p) => klici[1].args.includes(p)));
});

test("opis z modelom: izklopljen privzeto; vklopljen poslje samo oznaceno sliko in odstrani stevilke", async () => {
  const { dir, token } = await okolje();
  let poslano = 0;
  nastaviOdvisnostiKontrole({
    zagon: lazniZagon(IZID_NI_OK),
    python: () => "/lazni/python",
    opis: async () => {
      poslano++;
      return { ok: true, besedilo: "- madez 3 mm levo zgoraj\n- zasuk 2°" };
    },
  });
  const r = await izmeriTisk(token, { fotografija: JPG, referenca: PNG, vrstaReference: "motiv" }, dir);
  assert.deepEqual(await opisiNapake(token, r.id, dir), { ok: false, razlog: "opis-izklopljen" });
  assert.equal(poslano, 0);
  assert.ok((await shraniNastavitveKontrole(token, { opisZModelom: true }, dir)).ok);
  assert.deepEqual(await opisiNapake(token, "../../etc/passwd", dir), { ok: false, razlog: "slike-ni" });
  const o = await opisiNapake(token, r.id, dir);
  assert.ok(o.ok && !/[0-9]/.test(o.besedilo));
  assert.equal(poslano, 1);
});

test("prejete s telefona: shrani samo JPEG/PNG, seznam in branje samo po veljavnem imenu, najvec 100", async () => {
  const { dir, token } = await okolje();
  assert.deepEqual(await shraniPrejetoSliko(dir, Buffer.from("%PDF-1.4")), { ok: false, razlog: "vrsta" });
  const r = await shraniPrejetoSliko(dir, Buffer.from(JPG, "base64"));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(await prejeteSlike(token, dir), [r.id]);
  assert.equal(await prejetaSlika(token, r.id, dir), JPG);
  for (const slab of ["../kontrola-tiska.json", "/etc/passwd", r.id.replace(".jpg", ".exe"), 7]) assert.equal(await prejetaSlika(token, slab, dir), null);
  await assert.rejects(prejeteSlike(null, dir));
  for (let i = 0; i < 99; i++) assert.ok((await shraniPrejetoSliko(dir, Buffer.from(PNG, "base64"))).ok);
  assert.deepEqual(await shraniPrejetoSliko(dir, Buffer.from(PNG, "base64")), { ok: false, razlog: "polno" });
});

test("zadnjiJson: zadnja vrstica JSON, smeti pred njo se preskocijo", () => {
  assert.deepEqual(zadnjiJson("x\n{\"a\":1}\nkonec\n{\"b\":2}\n"), { b: 2 });
  assert.equal(zadnjiJson("brez"), null);
  assert.equal(zadnjiJson("{pokvarjen"), null);
});

// ---------------------------------------------------------------- pravi Python (sinteticne slike iz prototipa)

const PY = process.env.LINA_KONTROLA_TISKA_PYTHON?.trim() ?? "";
const brezPythona = !PY || !existsSync(PY) ? "LINA_KONTROLA_TISKA_PYTHON ni nastavljen: pravi Python z OpenCV NI preizkusen" : false;

function sinteticne(mapa: string): void {
  // sinteticne slike z znano resnico (kontrola_tiska_sinteticno.py, prenos iz prototipa); stiri oznake
  const koda = `
import sys, json, cv2
sys.path.insert(0, sys.argv[1])
import kontrola_tiska_sinteticno as sn
izh = sys.argv[2]
STIRI = {"0": [0.0, -40.0, 50.0], "1": [-200.0, 100.0, 50.0], "2": [200.0, 100.0, 50.0], "3": [0.0, 460.0, 50.0]}
m = sn.motiv()
cv2.imwrite(izh + "/motiv.png", m)
for ime, zg, zas, kw in (("ok", (1.0, 76.0), 0.5, {}), ("odmik", (7.0, 75.0), 0.0, {}), ("prvi", (0.0, 75.0), 0.0, {}),
                         ("madez", (0.0, 75.0), 0.0, {"madezi": [(-140.0, 150.0, 3.0, (90, 90, 120))]})):
    pl, _ = sn.ravnina(m, STIRI, zg, zas, 250.0, seme=11, **kw)
    cv2.imwrite(izh + "/" + ime + ".jpg", sn.fotografiraj(pl, seme=12))
`;
  execFileSync(PY, ["-B", "-I", "-c", koda, SKRIPTE, mapa], { timeout: 120_000 });
}

test("pravi Python: OK, odmik 7 mm = NI OK, madez najden, prvi kos, PDF oznak", { skip: brezPythona, timeout: 600_000 }, async () => {
  const { dir, token } = await okolje();
  const slike = mkdtempSync(path.join(tmpdir(), "lina-kt-slike-"));
  sinteticne(slike);
  nastaviOdvisnostiKontrole({ python: () => PY });
  assert.ok((await shraniNastavitveKontrole(token, { meritev: { oznake: STIRI_OZNAKE, obmocje_mm: [-260, -90, 260, 520] } }, dir)).ok);
  const b64 = (ime: string) => readFileSync(path.join(slike, ime)).toString("base64");

  const ok = await izmeriTisk(token, { fotografija: b64("ok.jpg"), referenca: b64("motiv.png"), vrstaReference: "motiv" }, dir);
  assert.equal(ok.izid.ocena, "OK", JSON.stringify(ok.izid.razlogi));
  assert.ok(Math.abs(ok.izid.polozaj!.odmik_x_mm - 1) < 0.1 && Math.abs(ok.izid.polozaj!.odmik_y_mm - 1) < 0.1, JSON.stringify(ok.izid.polozaj));
  assert.ok(Math.abs(ok.izid.polozaj!.zasuk_deg - 0.5) < 0.05);
  assert.ok(ok.izid.barva && ok.izid.barva.dE00_povprecje < 5);
  assert.deepEqual(ok.izid.oznakeNajdene.sort(), [0, 1, 2, 3]);

  const odmik = await izmeriTisk(token, { fotografija: b64("odmik.jpg"), referenca: b64("motiv.png"), vrstaReference: "motiv" }, dir);
  assert.equal(odmik.izid.ocena, "NI OK");
  assert.ok(Math.abs(odmik.izid.polozaj!.odmik_x_mm - 7) < 0.1, JSON.stringify(odmik.izid.polozaj));
  assert.ok(odmik.izid.razlogi.some((r) => r.includes("vodoravni odmik")));

  const madez = await izmeriTisk(token, { fotografija: b64("madez.jpg"), referenca: b64("motiv.png"), vrstaReference: "motiv" }, dir);
  assert.equal(madez.izid.ocena, "NI OK");
  assert.ok(madez.izid.napake.some((n) => n.okvir_mm[0] - 6 <= -140 && -140 <= n.okvir_mm[0] + n.okvir_mm[2] + 6), JSON.stringify(madez.izid.napake));

  // prvi kos: referenca = fotografija odobrenega kosa na (0, 75); kos z odmikom 7 mm v X
  const pk = await izmeriTisk(token, { fotografija: b64("odmik.jpg"), referenca: b64("prvi.jpg"), vrstaReference: "prvi-kos" }, dir);
  assert.equal(pk.izid.referenca.vrsta, "prvi-kos");
  assert.ok(Math.abs(pk.izid.polozaj!.odmik_x_mm - 7) < 0.5 && Math.abs(pk.izid.polozaj!.odmik_y_mm) < 0.5, JSON.stringify(pk.izid.polozaj));

  // brez oznake v kadru: NI MOGOCE IZMERITI (motiv kot fotografija nima oznak)
  const brez = await izmeriTisk(token, { fotografija: b64("motiv.png"), referenca: b64("motiv.png"), vrstaReference: "motiv" }, dir);
  assert.equal(brez.izid.ocena, "NI MOGOCE IZMERITI");

  const pdf = await oznakePdf(token, dir);
  assert.ok(pdf.ok);
  if (pdf.ok) assert.equal(Buffer.from(pdf.pdf, "base64").subarray(0, 8).toString("latin1"), "%PDF-1.4");
  const dnevnik = await zadnjeKontrole(token, 10, dir);
  assert.equal(dnevnik.zapisi.length, 5);
});

// ---------------------------------------------------------------- povezava z narocili (stevilka naloga -> nalog in stranka)

async function zNarocili() {
  const o = await okolje();
  const vir = mkdtempSync(path.join(tmpdir(), "lina-kt-vir-"));
  writeFileSync(path.join(vir, "izvoz.csv"), "Nalog;Stranka;Motiv\nDN-0153;Kolesarski klub Primer;Kolo\nDN-0154;Sola Vzorec;Sova\n");
  await uvoziNarocila(vir, o.dir);
  nastaviOdvisnostiKontrole({ zagon: lazniZagon(IZID_NI_OK), python: () => "/lazni/python" });
  return { ...o, vir };
}

function zadnjiZapis(mapa: string): Record<string, unknown> {
  const v = readFileSync(path.join(mapa, "kontrola-tiska.jsonl"), "utf8").trim().split("\n");
  return JSON.parse(v[v.length - 1]);
}

test("meritev z znano stevilko naloga: dnevnik (JSONL, CSV, zadnje kontrole) dobi nalog in stranko", async () => {
  const { dir, token } = await zNarocili();
  const r = await izmeriTisk(token, { fotografija: JPG, referenca: PNG, vrstaReference: "motiv", nalog: " dn 0153 " }, dir);
  assert.deepEqual(zadnjiZapis(r.mapaDnevnika!).narocilo, { stevilka: "DN-0153", stranka: "Kolesarski klub Primer" });
  const csv = readFileSync(path.join(r.mapaDnevnika!, "kontrola-tiska.csv"), "utf8");
  assert.ok(GLAVA_CSV.endsWith(";narocilo;stranka"));
  assert.ok(csv.trim().endsWith(`;"DN-0153";"Kolesarski klub Primer"`));
  assert.deepEqual((await zadnjeKontrole(token, 5, dir)).zapisi[0].narocilo, { stevilka: "DN-0153", stranka: "Kolesarski klub Primer" });
});

test("meritev brez ugibanja: neznana, delna ali prazna stevilka naloga ne dobi stranke", async () => {
  const { dir, token } = await zNarocili();
  for (const nalog of ["DN-9999", "0153", "DN-015", "", "Kolesarski klub Primer", "DN-0153 DN-0154"]) {
    const r = await izmeriTisk(token, { fotografija: JPG, referenca: PNG, vrstaReference: "motiv", nalog }, dir);
    assert.equal(zadnjiZapis(r.mapaDnevnika!).narocilo, undefined, nalog);
    const csv = readFileSync(path.join(r.mapaDnevnika!, "kontrola-tiska.csv"), "utf8");
    assert.ok(csv.trim().endsWith(`;"";""`), nalog);
  }
});

test("neznan nalog: ponovni uvoz shranjene mape samo z dovoljenjem za podobne (narocila-uvoz, ista mapa)", async () => {
  const { dir, token, vir } = await zNarocili();
  writeFileSync(path.join(vir, "nov.txt"), "Nalog: DN-0160\nStranka: Novi kupec\n");
  const brez = await izmeriTisk(token, { fotografija: JPG, referenca: PNG, vrstaReference: "motiv", nalog: "DN-0160" }, dir);
  assert.equal(zadnjiZapis(brez.mapaDnevnika!).narocilo, undefined);
  await zapisiDovoljenje(dir, "narocila-uvoz", { mapa: vir }, { kdo: "lastnik" });
  const z = await izmeriTisk(token, { fotografija: JPG, referenca: PNG, vrstaReference: "motiv", nalog: "DN-0160" }, dir);
  assert.deepEqual(zadnjiZapis(z.mapaDnevnika!).narocilo, { stevilka: "DN-0160", stranka: "Novi kupec" });
});
