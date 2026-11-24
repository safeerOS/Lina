import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DATOTEKA_NAROCIL, besediloEposte, poveziSlikoZNarocili, uvoziNarocila, zapisiOdtisMotiva } from "./narocila.server.ts";

// Stranke so izmisljene. Mapa vira je zacasna; podatki Line v svoji zacasni mapi (vse lokalno).
async function pripravi() {
  const koren = await mkdtemp(path.join(tmpdir(), "lina-narocila-"));
  const vir = path.join(koren, "vir");
  const podatki = path.join(koren, "podatki");
  await mkdir(path.join(vir, "podmapa"), { recursive: true });
  await writeFile(path.join(vir, "izvoz.csv"), "Št. naloga;Naročnik;Motiv;Količina;Rok\nDN-0153;Kolesarski klub Primer;logo-kk.png;120;2026-12-01\nDN-0154;Šola Vzorec;../zunaj.png;35;2026-12-05\n");
  await writeFile(path.join(vir, "nalog-0155.txt"), "DELOVNI NALOG\nŠtevilka naloga: DN-0155\nStranka: Gasilci Test\nMotiv: Plamen\nKoličina: 40\n");
  await writeFile(path.join(vir, "podvojen.txt"), "Nalog: DN-0153\nStranka: Nekdo drug\n");
  await writeFile(path.join(vir, "dopis.txt"), "Pozdravljeni, hvala za sodelovanje.\n");
  await writeFile(path.join(vir, "neznana-glava.csv"), "a;b;c\n1;2;3\n");
  await writeFile(path.join(vir, "pokvarjen.pdf"), "%PDF-1.4 to ni pravi pdf");
  await writeFile(path.join(vir, "logo-kk.png"), "png");
  await writeFile(path.join(vir, "DN-0155.jpg"), "jpg");
  await writeFile(path.join(koren, "zunaj.png"), "png");
  await writeFile(path.join(koren, "skrivno.csv"), "Nalog;Stranka\nX-999;Skrita\n");
  await symlink(path.join(koren, "skrivno.csv"), path.join(vir, "povezava.csv"));
  await writeFile(path.join(vir, "podmapa", "v-podmapi.csv"), "Nalog;Stranka\nP-1;Podmapa\n");
  await writeFile(
    path.join(vir, "posta.eml"),
    "From: kupec@primer.si\r\nSubject: =?UTF-8?Q?Naro=C4=8Dilo?=\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nNalog: DN-0160\r\nStranka: =C5=A0portno dru=C5=A1tvo =\r\nPrimer\r\nMotiv: Lev\r\n",
  );
  return { koren, vir, podatki };
}

test("uvoz iz mape: CSV, delovni nalog, e-posta; razlogi za preskocene; motiv samo znotraj mape; brez povezav in podmap", async () => {
  const { vir, podatki } = await pripravi();
  const r = await uvoziNarocila(vir, podatki);
  const shranjeno = JSON.parse(await readFile(path.join(podatki, DATOTEKA_NAROCIL), "utf8"));
  const po = (s: string) => shranjeno.narocila.find((n: { stevilka: string }) => n.stevilka === s);
  assert.deepEqual(shranjeno.narocila.map((n: { stevilka: string }) => n.stevilka).sort(), ["DN-0153", "DN-0154", "DN-0155", "DN-0160"]);
  assert.equal(r.narocila, 4);
  assert.equal(po("DN-0153").stranka, "Kolesarski klub Primer"); // prvi vir velja, podvojeni nalog ne prepise stranke
  assert.equal(po("DN-0153").motivDatoteka, "logo-kk.png");
  assert.equal(po("DN-0154").motivDatoteka, undefined); // ../zunaj.png je zunaj mape vira
  assert.equal(po("DN-0155").motivDatoteka, "DN-0155.jpg"); // slika z imenom po nalogu
  assert.equal(po("DN-0160").stranka, "Športno društvo Primer");
  const razlog = (d: string) => r.preskoceno.find((p) => p.datoteka === d)?.razlog;
  assert.equal(razlog("podvojen.txt"), "podvojeno");
  assert.equal(razlog("dopis.txt"), "brez-narocila");
  assert.equal(razlog("pokvarjen.pdf"), "poskodovan");
  assert.equal(razlog("povezava.csv"), "ni-datoteka");
  assert.deepEqual(r.neprepoznaneGlave, [{ datoteka: "neznana-glava.csv", stolpci: ["a", "b", "c"] }]);
  assert.ok(!JSON.stringify(shranjeno).includes("Skrita") && !JSON.stringify(shranjeno).includes("Podmapa"));
});

test("uvoz: mapa mora biti absolutna obstojeca mapa", async () => {
  await assert.rejects(uvoziNarocila("relativna/mapa", "/tmp/x"), /mapa/);
  await assert.rejects(uvoziNarocila(path.join(tmpdir(), "ne-obstaja-lina-narocila"), "/tmp/x"), /mapa/);
});

test("ponovni uvoz ohrani shranjene odtise motivov; povezava s kodo in motivom iz shranjenega seznama", async () => {
  const { vir, podatki } = await pripravi();
  await uvoziNarocila(vir, podatki);
  const s = 32, p = new Uint8Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) p[y * s + x] = (x - 16) ** 2 + (y - 16) ** 2 < 100 ? 30 : 220;
  assert.equal(await zapisiOdtisMotiva("DN-0155", { sirina: s, visina: s, podatki: p }, podatki), true);
  assert.equal(await zapisiOdtisMotiva("NI-TAKEGA", { sirina: s, visina: s, podatki: p }, podatki), false);
  await uvoziNarocila(vir, podatki);
  const k = await poveziSlikoZNarocili({ prebrano: "QR: DN-0153" }, podatki);
  assert.equal(k.izid === "najden" && k.narocilo.stranka, "Kolesarski klub Primer");
  const m = await poveziSlikoZNarocili({ slika: { sirina: s, visina: s, podatki: p } }, podatki);
  assert.equal(m.izid === "najden" && m.nacin, "motiv");
  assert.equal(m.izid === "najden" && m.narocilo.stevilka, "DN-0155");
  assert.equal((await poveziSlikoZNarocili({ prebrano: "brez stevilke" }, podatki)).izid, "ni");
});

test("brez uvozenega seznama povezava vrne »ni«", async () => {
  const podatki = await mkdtemp(path.join(tmpdir(), "lina-narocila-prazno-"));
  assert.equal((await poveziSlikoZNarocili({ prebrano: "DN-0153" }, podatki)).izid, "ni");
});

test("e-posta: quoted-printable in base64 telo, glave odstranjene", () => {
  assert.equal(besediloEposte("Subject: x\nContent-Transfer-Encoding: base64\n\n" + Buffer.from("Nalog: A-1\nStranka: Žiga").toString("base64")), "Nalog: A-1\nStranka: Žiga");
  assert.equal(besediloEposte("Subject: x\n\nNalog: A-2"), "Nalog: A-2");
});

test("isti nalog iz vec virov: prazna polja se dopolnijo iz poznejsega vira, nasprotje ostane prvo (»podvojeno«)", async () => {
  const koren = await mkdtemp(path.join(tmpdir(), "lina-narocila-zdruzi-"));
  const vir = path.join(koren, "vir");
  await mkdir(vir, { recursive: true });
  await writeFile(path.join(vir, "a-izvoz.csv"), "Nalog;Stranka\nDN-0200;Klub Primer\n");
  await writeFile(path.join(vir, "b-nalog.txt"), "Nalog: DN 0200\nStranka: Klub Primer\nMotiv: Orel\nKoličina: 80\nRok: 2026-12-10\n");
  await writeFile(path.join(vir, "c-nalog.txt"), "Nalog: DN-0200\nStranka: Nekdo drug\n");
  const r = await uvoziNarocila(vir, path.join(koren, "podatki"));
  const n = JSON.parse(await readFile(path.join(koren, "podatki", DATOTEKA_NAROCIL), "utf8")).narocila;
  assert.equal(n.length, 1);
  assert.deepEqual([n[0].stevilka, n[0].stranka, n[0].motiv, n[0].kolicina, n[0].rok], ["DN-0200", "Klub Primer", "Orel", 80, "2026-12-10"]);
  assert.equal(r.preskoceno.find((p) => p.datoteka === "b-nalog.txt"), undefined);
  assert.equal(r.preskoceno.find((p) => p.datoteka === "c-nalog.txt")?.razlog, "podvojeno");
});

test("e-posta: stevilka naloga iz zadeve (tudi kodirane =?UTF-8?Q?), ce je v telesu ni; zadeva brez stevilke ne ugiba", async () => {
  const koren = await mkdtemp(path.join(tmpdir(), "lina-narocila-zadeva-"));
  const vir = path.join(koren, "vir");
  await mkdir(vir, { recursive: true });
  await writeFile(path.join(vir, "a.eml"), "From: k@primer.si\r\nSubject: =?UTF-8?Q?Naro=C4=8Dilo_DN-0170?=\r\n\r\nStranka: Klub Lev\r\nMotiv: Lev\r\n");
  await writeFile(path.join(vir, "b.eml"), "From: k@primer.si\r\nSubject: Re: Nalog st. 2026/44\r\n\r\nStranka: Pekarna\r\n");
  await writeFile(path.join(vir, "c.eml"), "From: k@primer.si\r\nSubject: Pozdrav iz pisarne\r\n\r\nStranka: Nihce\r\n");
  const r = await uvoziNarocila(vir, path.join(koren, "podatki"));
  const n = JSON.parse(await readFile(path.join(koren, "podatki", DATOTEKA_NAROCIL), "utf8")).narocila;
  assert.deepEqual(n.map((x: { stevilka: string; stranka: string }) => `${x.stevilka}|${x.stranka}`).sort(), ["2026/44|Pekarna", "DN-0170|Klub Lev"]);
  assert.equal(r.preskoceno.find((p) => p.datoteka === "c.eml")?.razlog, "brez-narocila");
});
