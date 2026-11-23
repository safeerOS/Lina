/**
 * Spomin lastnika, faza 1 (lastnik 15. 11. 2026): stikalo »Spomin« (privzeto IZKLOPLJENO) in dejstva, ki jih uporabnik sam napise.
 * Dodaj, uredi, izbrisi posamicno, izbrisi vse, izvozi; najvec 100 dejstev po 300 znakov; brez skrivnosti. Brez samodejnega
 * izluscanja iz klicev (faza 2 je samo nacrt). Zapis lokalno v mapi podatkov (atomarno, pravice 0600) kot vsi ostali podatki.
 * Dejstva so po privzetku SAMO za Lino pri odlocanju; klicatelju jih Lina pove samo, ce je uporabnik pri dejstvu izrecno vklopil
 * »Lina sme to povedati klicatelju«. V dnevnik gre samo STEVILO dejstev, nikoli vsebina.
 */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { requireOwner } from "./auth.server.ts";
import { t } from "./besedila.ts";
import { SPOMIN_NAJVEC_DEJSTEV, SPOMIN_NAJVEC_ZNAKOV, preveriDejstvo, type Dejstvo } from "./spomin.ts";
import { resolveDataDir, writeJson } from "./store.server.ts";

const DATOTEKA = "spomin.json";
/** M2 popravki F8: najvec 100 dejstev po 300 znakov je dalec pod 1 MB; vecja datoteka je pokvarjena ali tuja (60 MB je pobralo ~320 ms na obrat). */
const MEJA_DATOTEKE_B = 1_000_000;
/** M2 popravki F7: najvec toliko kopij pokvarjene datoteke (najnovejse); »izbrisi vsa dejstva« izbrise vse. */
const KOPIJ_POKVARJENIH = 3;
const RE_KOPIJA = /^spomin\.pokvarjen-\d+\.json$/;

/** spomin.json ni obicajna datoteka (simbolna povezava, mapa, cev) ali je prevelika. */
class SpominNeveljaven extends Error {}

/**
 * M2 krog 3 N-5: branje se ustavi pri meji (stat pred branjem ne zadostuje: datoteka lahko med stat in branjem zraste). Vec kot meja = SpominNeveljaven.
 * Rocaj je samo tisto, kar read vrne (strukturni tip), da ga preizkus preizkusi z lazno datoteko.
 */
export async function preberiOmejeno(h: { read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }> }, meja: number): Promise<string> {
  const kosi: Buffer[] = [];
  let skupaj = 0;
  for (;;) {
    const kos = Buffer.allocUnsafe(65536);
    const { bytesRead } = await h.read(kos, 0, kos.length, skupaj);
    if (bytesRead === 0) break;
    skupaj += bytesRead;
    if (skupaj > meja) throw new SpominNeveljaven();
    kosi.push(kos.subarray(0, bytesRead));
  }
  return Buffer.concat(kosi).toString("utf8");
}

/**
 * M2 krog 3 N-1/N-2: pravice 0600 samo na OBICAJNI datoteki, prek deskriptorja (fchmod) in brez sledenja povezavi. chmod po poti je sledil simbolni povezavi
 * (tuja datoteka je dobila 0600), na mapi pa je odvzel x, zato kopije ni bilo mogoce izbrisati. Povezava, mapa ali cev ostanejo, kakrsne so.
 */
async function zapriKopijo(kopija: string): Promise<void> {
  let h;
  try {
    h = await open(kopija, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch {
    return;
  }
  try {
    if ((await h.stat()).isFile()) await h.chmod(0o600);
  } catch {
    // brez pravic ni napaka, kopija je ze prestavljena
  } finally {
    await h.close().catch(() => undefined);
  }
}

/**
 * M2 popravki F8: berljiva je samo obicajna datoteka do 1 MB, brez sledenja simbolni povezavi (prej je readFile sledil povezavi na tujo JSON datoteko in
 * jo vzel za spomin; mapa je z EISDIR zaklenila vse operacije). Vrne null, ce datoteke ni; SyntaxError ob pokvarjeni vsebini; SpominNeveljaven ob drugi vrsti.
 */
async function preberiDatoteko<T>(root: string): Promise<T | null> {
  const file = path.join(root, DATOTEKA);
  let st;
  try {
    st = await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!st.isFile() || st.size > MEJA_DATOTEKE_B) throw new SpominNeveljaven();
  let h;
  try {
    // O_NOFOLLOW (na Windows ga ni; tam je lstat zgoraj) in O_NONBLOCK: zamenjava z povezavo ali cevjo med lstat in odpiranjem ne zaklene niti ne sledi.
    h = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP" || code === "EISDIR" || code === "ENXIO") throw new SpominNeveljaven();
    if (code === "ENOENT") return null;
    throw error;
  }
  try {
    const st2 = await h.stat();
    if (!st2.isFile() || st2.size > MEJA_DATOTEKE_B) throw new SpominNeveljaven();
    return JSON.parse(await preberiOmejeno(h, MEJA_DATOTEKE_B)) as T;
  } finally {
    await h.close().catch(() => undefined);
  }
}

/** Kopije pokvarjenih datotek: pravice 0600, najvec KOPIJ_POKVARJENIH najnovejsih (F7). */
async function pospraviKopije(root: string, vse = false): Promise<void> {
  let imena: string[];
  try {
    imena = (await readdir(root)).filter((i) => RE_KOPIJA.test(i)).sort();
  } catch {
    return;
  }
  for (const ime of vse ? imena : imena.slice(0, Math.max(0, imena.length - KOPIJ_POKVARJENIH))) {
    await rm(path.join(root, ime), { recursive: true, force: true }).catch(() => undefined);
  }
}

type Shranjeno = { vklopljen: boolean; dejstva: Dejstvo[] };

/** Kar vidi odjemalec (lastnik): stikalo, dejstva in meje. */
export type SpominPogled = { vklopljen: boolean; dejstva: Dejstvo[]; najvecDejstev: number; najvecZnakov: number };

let vrsta: Promise<unknown> = Promise.resolve();
/** Zapisi gredo po vrsti, da dva hkratna vnosa ne izgubita drug drugega. */
function vVrsti<T>(f: () => Promise<T>): Promise<T> {
  const naslednji = vrsta.then(f, f);
  vrsta = naslednji.catch(() => undefined);
  return naslednji;
}

function pogled(s: Shranjeno): SpominPogled {
  return { vklopljen: s.vklopljen, dejstva: s.dejstva.map((d) => ({ ...d })), najvecDejstev: SPOMIN_NAJVEC_DEJSTEV, najvecZnakov: SPOMIN_NAJVEC_ZNAKOV };
}

const PRAZEN: Shranjeno = { vklopljen: false, dejstva: [] };

/**
 * M2 N3: pokvarjen spomin.json (rocna napaka, prekinjen zapis) ne sme zakleniti vseh operacij (prej so preberi, nastavi, dodaj in
 * dejstvaZaModel vsi vrgli napako razclembe, lastnik prek vmesnika ni mogel ne izklopiti ne izbrisati). Vrne prazen seznam in zabelezi
 * napako BREZ vsebine. Pred pisanjem se pokvarjena datoteka prestavi v spomin.pokvarjen-<cas>.json, da se vsebina ne izgubi.
 */
async function beri(root: string, predPisanjem = false): Promise<Shranjeno> {
  try {
    return await beriSurovo(root);
  } catch (error) {
    if (!(error instanceof SyntaxError) && !(error instanceof SpominNeveljaven)) throw error;
    console.warn("lina spomin: spomin.json ni berljiv, uporabljen je prazen seznam");
    if (predPisanjem) {
      const kopija = path.join(root, `spomin.pokvarjen-${Date.now()}.json`);
      // F7: kopija ima pravice 0600 (izvirnik je imel lahko 0644); tu ostane samo najnovejsih nekaj.
      const prestavljeno = await rename(path.join(root, DATOTEKA), kopija).then(() => true, () => false);
      if (prestavljeno) await zapriKopijo(kopija);
      await pospraviKopije(root);
    }
    return { ...PRAZEN, dejstva: [] };
  }
}

async function beriSurovo(root: string): Promise<Shranjeno> {
  const f = await preberiDatoteko<Partial<Shranjeno>>(root);
  const surova = Array.isArray(f?.dejstva) ? f.dejstva : [];
  const dejstva: Dejstvo[] = [];
  for (const d of surova.slice(0, SPOMIN_NAJVEC_DEJSTEV)) {
    if (!d || typeof d !== "object") continue;
    const p = preveriDejstvo((d as Dejstvo).besedilo);
    // Rocno popravljena datoteka ne more pripeljati skrivnosti ali predolgega dejstva v model.
    if (!p.ok || typeof (d as Dejstvo).id !== "string") continue;
    dejstva.push({
      id: (d as Dejstvo).id,
      besedilo: p.besedilo,
      klicatelju: (d as Dejstvo).klicatelju === true,
      ustvarjeno: typeof (d as Dejstvo).ustvarjeno === "string" ? (d as Dejstvo).ustvarjeno : "",
    });
  }
  // Privzeto IZKLOPLJENO: samo izrecen true vklopi.
  return { vklopljen: f?.vklopljen === true, dejstva };
}

function razlog(r: "prazno" | "predolgo" | "skrivnost"): string {
  return t(r === "prazno" ? "spominNapakaPrazno" : r === "predolgo" ? "spominNapakaPredolgo" : "spominNapakaSkrivnost");
}

export async function preberiSpomin(token: string | null, dir?: string): Promise<SpominPogled> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return pogled(await beri(root));
}

export async function nastaviSpomin(vklopljen: unknown, token: string | null, dir?: string): Promise<SpominPogled> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return vVrsti(async () => {
    const s = await beri(root, true);
    s.vklopljen = vklopljen === true;
    await writeJson(root, DATOTEKA, s);
    return pogled(s);
  });
}

export async function dodajDejstvo(vnos: { besedilo?: unknown; klicatelju?: unknown }, token: string | null, dir?: string): Promise<SpominPogled> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return vVrsti(async () => {
    const s = await beri(root, true);
    const p = preveriDejstvo(vnos.besedilo);
    if (!p.ok) throw new Error(razlog(p.razlog));
    if (s.dejstva.length >= SPOMIN_NAJVEC_DEJSTEV) throw new Error(t("spominNapakaMeja"));
    s.dejstva.push({ id: randomUUID(), besedilo: p.besedilo, klicatelju: vnos.klicatelju === true, ustvarjeno: new Date().toISOString() });
    await writeJson(root, DATOTEKA, s);
    return pogled(s);
  });
}

export async function urediDejstvo(
  id: unknown,
  vnos: { besedilo?: unknown; klicatelju?: unknown },
  token: string | null,
  dir?: string,
): Promise<SpominPogled> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return vVrsti(async () => {
    const s = await beri(root, true);
    const d = s.dejstva.find((x) => x.id === id);
    if (!d) throw new Error(t("spominNapakaNiDejstva"));
    if (vnos.besedilo !== undefined) {
      const p = preveriDejstvo(vnos.besedilo);
      if (!p.ok) throw new Error(razlog(p.razlog));
      d.besedilo = p.besedilo;
    }
    if (typeof vnos.klicatelju === "boolean") d.klicatelju = vnos.klicatelju;
    await writeJson(root, DATOTEKA, s);
    return pogled(s);
  });
}

export async function izbrisiDejstvo(id: unknown, token: string | null, dir?: string): Promise<SpominPogled> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return vVrsti(async () => {
    const s = await beri(root, true);
    const n = s.dejstva.length;
    s.dejstva = s.dejstva.filter((x) => x.id !== id);
    if (s.dejstva.length === n) throw new Error(t("spominNapakaNiDejstva"));
    await writeJson(root, DATOTEKA, s);
    return pogled(s);
  });
}

/** Izbrise vsa dejstva; stikalo ostane, kakrsno je. */
export async function izbrisiVsaDejstva(token: string | null, dir?: string): Promise<SpominPogled> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return vVrsti(async () => {
    const s = await beri(root, true);
    s.dejstva = [];
    await writeJson(root, DATOTEKA, s);
    // M2 popravki F7: kopije pokvarjenih datotek vsebujejo stara dejstva; »izbrisi vse« jih izbrise tudi (prej so ostale brez prikaza in brez brisanja).
    await pospraviKopije(root, true);
    return pogled(s);
  });
}

/** Izvoz: JSON besedilo z dejstvi (za shranjevanje ali prenos); samo za lastnika. */
export async function izvoziSpomin(token: string | null, dir?: string): Promise<{ besedilo: string }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const s = await beri(root);
  return { besedilo: JSON.stringify({ verzija: 1, dejstva: s.dejstva.map((d) => ({ besedilo: d.besedilo, klicatelju: d.klicatelju, ustvarjeno: d.ustvarjeno })) }, null, 2) };
}

/**
 * Dejstva za kontekst modela: PRAZNO, ce je stikalo izklopljeno (dejstva so lahko shranjena, a v model ne gredo). Notranja pot
 * brez zetona, ker jo kliče samo kodo klica; vrnjeno gre samo v navodila modela, nikoli odjemalcu. V dnevnik gre samo stevilo.
 */
export async function dejstvaZaModel(dir?: string): Promise<Pick<Dejstvo, "besedilo" | "klicatelju">[]> {
  const root = resolveDataDir(dir);
  // M2 N4: ob izklopljenem stikalu se dejstva sploh ne razclenijo in ne preverjajo (prej do 100 dejstev ob vsakem izreku, ~3,7 ms).
  let surovo: { vklopljen?: unknown } | null = null;
  try {
    surovo = await preberiDatoteko<{ vklopljen?: unknown }>(root);
  } catch (error) {
    if (!(error instanceof SyntaxError) && !(error instanceof SpominNeveljaven)) throw error;
    console.warn("lina spomin: spomin.json ni berljiv, uporabljen je prazen seznam");
    return [];
  }
  if (surovo?.vklopljen !== true) return [];
  const s = await beri(root);
  if (!s.vklopljen || s.dejstva.length === 0) return [];
  console.info(`lina spomin: ${s.dejstva.length} dejstev v kontekstu`);
  return s.dejstva.map((d) => ({ besedilo: d.besedilo, klicatelju: d.klicatelju }));
}
