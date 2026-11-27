/**
 * NALOGA-35 na racunalniku s pravo podatkovno mapo: prehod obstojecih kljucev, izmenjava s telefonom (ovojnica para), oddaljen
 * izbris, tuja naprava, vec kljucev istega ponudnika in izbira, ki je prejet zapis ne spremeni. Brez omrezja; kljuci so izmisljeni.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { activeBrain, readBrain, saveBrain } from "./keys.server.ts";
import { javniKljucPara, kljucPara, noviParKljucev, zZice, zaZico, type ZapisKljuca, type ZapisNaZici } from "./kljuci-mozganov.ts";
import {
  DATOTEKA_KLJUCEV,
  dodajKljucMozganov,
  izmenjajKljuce,
  odstraniKljucMozganov,
  pregledKljucev,
  preimenujKljucMozganov,
  uporabiKljucMozganov,
} from "./kljuci-mozganov.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-n35-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const OKOLJE = ["XAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY", "LINA_DATA"];
const shranjeno: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const ime of OKOLJE) {
    shranjeno[ime] = process.env[ime];
    delete process.env[ime];
  }
});
afterEach(() => {
  for (const ime of OKOLJE) {
    if (shranjeno[ime] === undefined) delete process.env[ime];
    else process.env[ime] = shranjeno[ime];
  }
});

const K1 = "AIzaTEST-racunalnik-1111";
const K2 = "AIzaTEST-telefon-2222";
const K3 = "sk-TEST-openai-3333";
const TEL = "n-0123456789abcdef";

async function nova() {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  process.env.LINA_DATA = dir;
  const token = await setupOwner("geslo-test-1234", dir);
  return { dir, token };
}

/** Telefon na zici: zapise ovije s kljucem para, odgovor odpre. */
function telefon() {
  const par = noviParKljucev();
  return {
    par,
    async izmenjaj(dir: string, zapisi: ZapisKljuca[], javniR: string | null, dovoljene = new Set([TEL]), zdaj = Date.now()) {
      const k = javniR ? kljucPara(par.zasebni, javniKljucPara(javniR)!, TEL) : null;
      const naZici: ZapisNaZici[] = k ? zapisi.map((z) => zaZico(z, k, "telefon-racunalnik")) : [];
      const odg = await izmenjajKljuce(TEL, par.javni, naZici, dovoljene, dir, { zdaj: () => zdaj });
      const kk = kljucPara(par.zasebni, javniKljucPara(odg.javni)!, TEL);
      return { odg, zapisi: odg.zapisi.map((z) => zZice(z, kk, "racunalnik-telefon")).filter((z): z is ZapisKljuca => z !== null) };
    },
  };
}

test("naloga 35 (racunalnik): prehod - obstojeci kljuc ostane, telefon ga dobi v ovojnici; datoteka 0600 brez kljuca v cistem besedilu", async () => {
  const { dir, token } = await nova();
  await saveBrain({ provider: "gemini", key: K1 }, token, dir);
  const t = telefon();
  const { odg, zapisi } = await t.izmenjaj(dir, [], null);
  assert.equal(zapisi.length, 1);
  assert.equal(zapisi[0].vrednost, K1);
  assert.equal(zapisi[0].ponudnik, "gemini");
  assert.ok(!JSON.stringify(odg).includes(K1), "kljuc ne sme biti v odgovoru v cistem besedilu");
  const datoteka = await readFile(path.join(dir, DATOTEKA_KLJUCEV), "utf8");
  assert.ok(!datoteka.includes(K1));
  if (process.platform !== "win32") assert.equal(statSync(path.join(dir, DATOTEKA_KLJUCEV)).mode & 0o777, 0o600);
  assert.equal((await activeBrain(dir))?.key, K1, "mozgani za klice nespremenjeni");
});

test("naloga 35 (racunalnik): nov kljuc s telefona zapolni prazno mesto ponudnika, izbira za klice ostane", async () => {
  const { dir, token } = await nova();
  await saveBrain({ provider: "gemini", key: K1 }, token, dir);
  const t = telefon();
  const prvi = await t.izmenjaj(dir, [], null);
  const z: ZapisKljuca = { id: "aaaaaaaaaaaaaaaa", ponudnik: "openai", oznaka: "OpenAI telefon", cas: Date.now(), naprava: TEL, izbrisan: false, prej: "", vrednost: K3 };
  const drugi = await t.izmenjaj(dir, [z], prvi.odg.javni);
  assert.ok(drugi.zapisi.some((x) => x.id === z.id && x.vrednost === K3));
  const javno = await readBrain(token, dir);
  assert.equal(javno.provider, "gemini", "klici ostanejo na gemini");
  assert.ok(javno.shranjeni?.some((p) => p.provider === "openai" && p.namig === "3333"));
  const p = await pregledKljucev(dir);
  assert.ok(p.kljuci.some((k) => k.oznaka === "OpenAI telefon" && k.namig === "…3333" && k.vUporabi));
  assert.ok(!JSON.stringify(p).includes(K3), "vmesnik nikoli ne dobi celega kljuca");
});

test("naloga 35 (racunalnik): izbris s telefona odstrani kljuc v uporabi (vidno obvestilo, brez samodejnega preklopa)", async () => {
  const { dir, token } = await nova();
  await saveBrain({ provider: "gemini", key: K1 }, token, dir);
  const t = telefon();
  const prvi = await t.izmenjaj(dir, [], null);
  const g = prvi.zapisi[0];
  const grob: ZapisKljuca = { ...g, cas: Date.now(), naprava: TEL, izbrisan: true, prej: `${g.cas}/${g.naprava}`, vrednost: "" };
  await t.izmenjaj(dir, [grob], prvi.odg.javni);
  assert.equal(await activeBrain(dir), null, "brez kljuca ni mozganov (ne drug ponudnik)");
  assert.equal((await readBrain(token, dir)).provider, "gemini", "izbira ponudnika za klice ostane");
  assert.deepEqual((await pregledKljucev(dir)).odstranjeni, ["gemini"]);
});

test("naloga 35 (racunalnik): tuja (neseznanjena) naprava ne dobi nicesar in nic ne spremeni", async () => {
  const { dir, token } = await nova();
  await saveBrain({ provider: "gemini", key: K1 }, token, dir);
  const t = telefon();
  await assert.rejects(t.izmenjaj(dir, [], null, new Set(["n-ffffffffffffffff"])), /ni-dovoljen/);
  assert.equal((await activeBrain(dir))?.key, K1);
});

test("naloga 35 (racunalnik): prejet zapis z neznanim ponudnikom ali dodatnim poljem se prezre; izbira asistentke ostane", async () => {
  const { dir, token } = await nova();
  await saveBrain({ provider: "gemini", key: K1 }, token, dir);
  const t = telefon();
  const prvi = await t.izmenjaj(dir, [], null);
  const zdaj = Date.now();
  const slabi = [
    { id: "bbbbbbbbbbbbbbbb", ponudnik: "omniroute", oznaka: "x", cas: zdaj, naprava: TEL, izbrisan: false, prej: "", vrednost: K3 },
    { id: "cccccccccccccccc", ponudnik: "openai", oznaka: "x", cas: zdaj, naprava: TEL, izbrisan: false, prej: "", vrednost: K3, naslov: "https://x.invalid" },
  ] as unknown as ZapisKljuca[];
  const drugi = await t.izmenjaj(dir, slabi, prvi.odg.javni);
  assert.equal(drugi.zapisi.length, 1);
  const javno = await readBrain(token, dir);
  assert.ok(!javno.shranjeni?.some((p) => p.provider === "openai" || p.provider === "omniroute"));
});

test("naloga 35 (racunalnik): vec kljucev istega ponudnika z oznako; uporabi, preimenuj, odstrani", async () => {
  const { dir, token } = await nova();
  await saveBrain({ provider: "gemini", key: K1 }, token, dir);
  let p = await dodajKljucMozganov({ ponudnik: "gemini", oznaka: "Gemini sluzba", kljuc: K2 }, dir);
  assert.equal(p.kljuci.filter((k) => k.ponudnik === "gemini").length, 2);
  assert.equal((await activeBrain(dir))?.key, K1, "drugi kljuc istega ponudnika ne zamenja kljuca v uporabi");
  await assert.rejects(dodajKljucMozganov({ ponudnik: "gemini", oznaka: "Dvojnik", kljuc: K2 }, dir), /že shranjen/);
  const drugi = p.kljuci.find((k) => k.oznaka === "Gemini sluzba")!;
  await uporabiKljucMozganov(drugi.id, dir);
  assert.equal((await activeBrain(dir))?.key, K2);
  p = await preimenujKljucMozganov(drugi.id, "Gemini podjetje", dir);
  assert.ok(p.kljuci.some((k) => k.oznaka === "Gemini podjetje" && k.vUporabi));
  const prvi = p.kljuci.find((k) => !k.vUporabi)!;
  p = await odstraniKljucMozganov(prvi.id, dir);
  assert.equal(p.kljuci.length, 1);
  assert.equal((await activeBrain(dir))?.key, K2, "odstranitev kljuca, ki ni v uporabi, ne spremeni mozganov");
  p = await odstraniKljucMozganov(drugi.id, dir);
  assert.equal(p.kljuci.length, 0);
  assert.equal(await activeBrain(dir), null);
  assert.deepEqual(p.odstranjeni, [], "lokalna odstranitev ni obvestilo »z druge naprave«");
  const t = telefon();
  const { zapisi } = await t.izmenjaj(dir, [], null);
  assert.ok(zapisi.every((z) => z.izbrisan), "odstranitev gre telefonu kot grob");
  void token;
});

test("naloga 35 (racunalnik): kljuc, ki ga lastnik zamenja v Mozganih, gre telefonu kot sprememba istega zapisa", async () => {
  const { dir, token } = await nova();
  await saveBrain({ provider: "gemini", key: K1 }, token, dir);
  const t = telefon();
  const prvi = await t.izmenjaj(dir, [], null);
  await saveBrain({ provider: "gemini", key: K2 }, token, dir);
  const drugi = await t.izmenjaj(dir, [], prvi.odg.javni);
  assert.equal(drugi.zapisi.length, 1);
  assert.equal(drugi.zapisi[0].id, prvi.zapisi[0].id);
  assert.equal(drugi.zapisi[0].vrednost, K2);
});

// ---- slepi pregled 1 (S1, N2, S4/S5) ----

test("naloga 35 (slepi S1): po odstranitvi kljuca v uporabi Lina ne preklopi sama na drug kljuc istega ponudnika", async () => {
  const { dir, token } = await nova();
  await saveBrain({ provider: "gemini", key: K1 }, token, dir);
  let p = await dodajKljucMozganov({ ponudnik: "gemini", oznaka: "Drugi", kljuc: K2 }, dir);
  const vUporabi = p.kljuci.find((k) => k.vUporabi)!;
  p = await odstraniKljucMozganov(vUporabi.id, dir);
  assert.equal(await activeBrain(dir), null);
  await pregledKljucev(dir);
  assert.equal(await activeBrain(dir), null, "naslednji korak prazno mesto ne zapolni z drugim kljucem");
  assert.ok(!(await readBrain(token, dir)).shranjeni?.some((x) => x.provider === "gemini"), "tudi ne za asistentko");
  assert.ok(!(await pregledKljucev(dir)).kljuci.some((k) => k.vUporabi));
  // oddaljeno: telefon odstrani kljuc v uporabi, drugi kljuc istega ponudnika ostane neuporabljen
  const { dir: dir2, token: t2 } = await nova();
  await saveBrain({ provider: "gemini", key: K1 }, t2, dir2);
  await dodajKljucMozganov({ ponudnik: "gemini", oznaka: "Drugi", kljuc: K2 }, dir2);
  const t = telefon();
  const prvi = await t.izmenjaj(dir2, [], null);
  const g = prvi.zapisi.find((z) => z.vrednost === K1)!;
  await t.izmenjaj(dir2, [{ ...g, cas: Date.now(), naprava: TEL, izbrisan: true, prej: `${g.cas}/${g.naprava}`, vrednost: "" }], prvi.odg.javni);
  await pregledKljucev(dir2);
  assert.equal(await activeBrain(dir2), null);
  assert.ok(!(await readBrain(t2, dir2)).shranjeni?.some((x) => x.provider === "gemini"));
  assert.deepEqual((await pregledKljucev(dir2)).odstranjeni, ["gemini"]);
});

test("naloga 35 (slepi N2): telefon ne more spremeniti obstojecega zapisa v imenu druge naprave", async () => {
  const { dir, token } = await nova();
  await saveBrain({ provider: "gemini", key: K1 }, token, dir);
  const t = telefon();
  const prvi = await t.izmenjaj(dir, [], null);
  const g = prvi.zapisi[0];
  const tuj: ZapisKljuca = { ...g, cas: Date.now(), naprava: "n-ffffffffffffffff", prej: `${g.cas}/${g.naprava}`, vrednost: K3 };
  const drugi = await t.izmenjaj(dir, [tuj], prvi.odg.javni);
  assert.equal(drugi.zapisi.find((z) => z.id === g.id)?.vrednost, K1);
  assert.equal((await activeBrain(dir))?.key, K1);
});

test("naloga 35 (slepi S4/S5): neberljiv kljuc v slotu ni izbris; pokvarjena datoteka nabora se ne prepise", async () => {
  const { dir, token } = await nova();
  await saveBrain({ provider: "openai", key: K3 }, token, dir);
  const t = telefon();
  const prvi = await t.izmenjaj(dir, [], null);
  assert.equal(prvi.zapisi.length, 1);
  // sifra kljuca v ponudniki.json se ne odpre vec (npr. zamenjan .kljuc): zapis mora ostati ziv na vseh napravah
  const pot = path.join(dir, "ponudniki.json");
  const pon = JSON.parse(await readFile(pot, "utf8"));
  pon.ponudniki.openai.ciphertext = Buffer.from("pokvarjeno-pokvarjeno").toString("base64");
  await writeFile(pot, JSON.stringify(pon));
  const drugi = await t.izmenjaj(dir, [], prvi.odg.javni);
  assert.ok(drugi.zapisi.some((z) => z.id === prvi.zapisi[0].id && !z.izbrisan && z.vrednost === K3));
  // pokvarjena datoteka nabora: napaka, brez novega praznega stanja
  await writeFile(path.join(dir, DATOTEKA_KLJUCEV), "{");
  await assert.rejects(pregledKljucev(dir));
  assert.equal(await readFile(path.join(dir, DATOTEKA_KLJUCEV), "utf8"), "{");
});

test("naloga 35 (slepi 2): oddaljen izbris ohrani model ponudnika; »Uporabi« drugega kljuca vrne mozgane za klice", async () => {
  const { dir, token } = await nova();
  await saveBrain({ provider: "gemini", key: K1, model: "gemini-test-model" }, token, dir);
  const p0 = await dodajKljucMozganov({ ponudnik: "gemini", oznaka: "Drugi", kljuc: K2 }, dir);
  const t = telefon();
  const prvi = await t.izmenjaj(dir, [], null);
  const g = prvi.zapisi.find((z) => z.vrednost === K1)!;
  await t.izmenjaj(dir, [{ ...g, cas: Date.now(), naprava: TEL, izbrisan: true, prej: `${g.cas}/${g.naprava}`, vrednost: "" }], prvi.odg.javni);
  assert.equal(await activeBrain(dir), null);
  const pon = JSON.parse(await readFile(path.join(dir, "ponudniki.json"), "utf8"));
  assert.equal(pon.ponudniki.gemini.model, "gemini-test-model", "model ostane");
  assert.equal(pon.ponudniki.gemini.ciphertext, undefined);
  const drugi = p0.kljuci.find((k) => k.oznaka === "Drugi")!;
  await uporabiKljucMozganov(drugi.id, dir);
  const m = await activeBrain(dir);
  assert.equal(m?.key, K2, "klici spet imajo mozgane");
  assert.equal(m?.model, "gemini-test-model");
});

// ---- svetovalec: pravi izmenjajKljuce ----

test("naloga 35: nov racunalnik sprejme zapis druge naprave, ki ga se nima; obstojecega telefon ne spremeni v imenu druge naprave", async () => {
  const { dir } = await nova();
  const t = telefon();
  const prvi = await t.izmenjaj(dir, [], null);
  const tuj: ZapisKljuca = { id: "eeeeeeeeeeeeeeee", ponudnik: "claude", oznaka: "S starega racunalnika", cas: 5000, naprava: "r-0011223344556677", izbrisan: false, prej: "", vrednost: K3 };
  const drugi = await t.izmenjaj(dir, [tuj], prvi.odg.javni);
  assert.ok(drugi.zapisi.some((z) => z.id === tuj.id && z.vrednost === K3), "zapis, ki ga racunalnik nima, pride");
  const ponaredek: ZapisKljuca = { ...tuj, cas: Date.now(), prej: "5000/r-0011223344556677", vrednost: K2 };
  const tretji = await t.izmenjaj(dir, [ponaredek], prvi.odg.javni);
  assert.equal(tretji.zapisi.find((z) => z.id === tuj.id)?.vrednost, K3, "obstojecega ne spremeni v imenu druge naprave");
});

test("naloga 35: neveljaven kljuc v slotu se ne prepise s staro vrednostjo; dodan kljuc po odstranitvi gre v uporabo", async () => {
  const { dir, token } = await nova();
  await saveBrain({ provider: "gemini", key: K1 }, token, dir);
  await pregledKljucev(dir);
  const SLAB = "AIza z presledkom-1111";
  await saveBrain({ provider: "gemini", key: SLAB }, token, dir).catch(() => undefined);
  const zdaj = (await activeBrain(dir))?.key;
  await pregledKljucev(dir);
  assert.equal((await activeBrain(dir))?.key, zdaj, "uskladitev ne prepise lastnikovega vnosa");
  // po odstranitvi kljuca v uporabi: izrecno dodan kljuc istega ponudnika gre v uporabo
  const { dir: d2, token: t2 } = await nova();
  await saveBrain({ provider: "gemini", key: K1 }, t2, d2);
  const p = await pregledKljucev(d2);
  await odstraniKljucMozganov(p.kljuci[0].id, d2);
  await dodajKljucMozganov({ ponudnik: "gemini", oznaka: "Nov", kljuc: K2 }, d2);
  assert.equal((await activeBrain(d2))?.key, K2);
});

test("naloga 35: neberljiv zapis na disku ne zamenja zapis z zice; tuj grob za neznan id se ne sprejme; dodaj ne prepise kljuca v slotu", async () => {
  const { dir, token } = await nova();
  await saveBrain({ provider: "gemini", key: K1 }, token, dir);
  const t = telefon();
  const prvi = await t.izmenjaj(dir, [], null);
  const g = prvi.zapisi[0];
  // sifra zapisa v naboru se ne odpre vec (zamenjan glavni kljuc): telefon poslje svojo kopijo, disk mora ostati nespremenjen
  const pot = path.join(dir, DATOTEKA_KLJUCEV);
  const d = JSON.parse(await readFile(pot, "utf8"));
  d.zapisi[0].sifra.ciphertext = Buffer.from("drugo-drugo-drugo").toString("base64");
  await writeFile(pot, JSON.stringify(d));
  await t.izmenjaj(dir, [{ ...g, cas: Date.now(), naprava: TEL, prej: `${g.cas}/${g.naprava}`, vrednost: K2 }], prvi.odg.javni);
  const po = JSON.parse(await readFile(pot, "utf8"));
  assert.equal(po.zapisi.find((z: { id: string }) => z.id === g.id)?.sifra?.ciphertext, d.zapisi[0].sifra.ciphertext, "neberljiv izvirnik ostane");
  // tuj grob za id, ki ga racunalnik nima
  const grob: ZapisKljuca = { id: "abababababababab", ponudnik: "grok", oznaka: "x", cas: Date.now(), naprava: "n-ffffffffffffffff", izbrisan: true, prej: "", vrednost: "" };
  const drugi = await t.izmenjaj(dir, [grob], prvi.odg.javni);
  assert.ok(!drugi.zapisi.some((z) => z.id === grob.id));
  // dodaj: kljuc v slotu, ki ga uskladitev ne sprejme (presledek), ostane
  const { dir: d2, token: t2 } = await nova();
  await saveBrain({ provider: "openai", key: "sk-z presledkom-3333" }, t2, d2);
  await dodajKljucMozganov({ ponudnik: "openai", oznaka: "Nov", kljuc: K3 }, d2);
  assert.equal((await activeBrain(d2))?.key, "sk-z presledkom-3333");
});
