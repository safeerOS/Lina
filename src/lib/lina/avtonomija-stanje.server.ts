import { randomBytes } from "node:crypto";
import { appendFile, open, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import {
  normalizirajStanje,
  preveriZapisDnevnika,
  privzetoStanje,
  type Izid,
  type Razlog,
  type StanjeAvtonomije,
  type VrstaOpravila,
  type ZapisDnevnika,
} from "./avtonomija.ts";
import { readJsonFile, writeJson } from "./store.server.ts";

/**
 * Stanje pravil avtonomije na disku, dnevnik in bralno stikalo »ustavi vse«. Ta datoteka NI vrata za spreminjanje pravil
 * uporabnika (to je avtonomija.server.ts z lastnikovo sejo); uvazata jo lahko nujni.server.ts (samo jeUstavljenoNujno) in izvajalec.
 * Poti klica, spleta in asistentke je NE smejo uvoziti (preizkus naloga-avtonomija-uvozi.test.ts).
 */
export const DATOTEKA_STANJA = "avtonomija.json";
export const DATOTEKA_DNEVNIKA = "avtonomija-dnevnik.jsonl";
export const DATOTEKA_KLJUCAVNICE = "avtonomija.lock";
/** Dnevnik se ob tej velikosti prestavi v .1 (en stari dnevnik ostane); pomnilnik in disk ostaneta omejena. */
const NAJVEC_DNEVNIKA_BAJTOV = 256 * 1024;
const NAJVEC_BRANJA_BAJTOV = 128 * 1024;

export class AvtonomijaNapaka extends Error {
  readonly koda: string;
  constructor(koda: string, sporocilo: string) {
    super(sporocilo);
    this.name = "AvtonomijaNapaka";
    this.koda = koda;
  }
}

export type Branje = { stanje: StanjeAvtonomije; pokvarjeno: false } | { stanje: null; pokvarjeno: true };

/**
 * Manjkajoca datoteka (ENOENT) = vse izklopljeno (privzeto; nic ni vklopljeno, zato je to varno). Vse drugo, kar ni veljavno
 * stanje (nebranljiva datoteka, neveljaven JSON, vsebina `null`, napacna oblika), je pokvarjeno (fail-closed, nic se ne izvede
 * in »ustavljeno« se NE izgubi). Prej je vsebina `null` veljala za »ni datoteke« in je pobrisala stanje »ustavljeno« (N9).
 */
export async function preberiStanje(root: string): Promise<Branje> {
  let besedilo: string;
  try {
    besedilo = await readFile(path.join(root, DATOTEKA_STANJA), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { stanje: privzetoStanje(), pokvarjeno: false };
    return { stanje: null, pokvarjeno: true };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(besedilo);
  } catch {
    return { stanje: null, pokvarjeno: true };
  }
  const stanje = normalizirajStanje(raw);
  return stanje ? { stanje, pokvarjeno: false } : { stanje: null, pokvarjeno: true };
}

/**
 * Nastavitve iz pravil Line, ki jih avtonomija potrebuje, brez uvoza pravila.server.ts (ta vleče klic, model in glas; avtonomija
 * jih ne sme uvoziti): dodatne dovoljene predpone prejemnikov (isti razclen kot pravila: niz, najvec 80 znakov) in rok hrambe v
 * dneh (snemanjeHrambaDni: 1 do 90, privzeto 30, kot v pravila.server.ts dniHrambe). Nebranljiva datoteka = privzeto in stroge vrednosti.
 */
export async function preberiNastavitvePravil(root: string): Promise<{ dovoljenePredpone: string; hrambaDni: number }> {
  let raw: { dovoljenePredpone?: unknown; snemanjeHrambaDni?: unknown } | null = null;
  try {
    raw = await readJsonFile<{ dovoljenePredpone?: unknown; snemanjeHrambaDni?: unknown }>(root, "pravila.json");
  } catch {
    raw = null;
  }
  const predpone = typeof raw?.dovoljenePredpone === "string" ? raw.dovoljenePredpone.trim().slice(0, 80) : "";
  const n = typeof raw?.snemanjeHrambaDni === "number" ? raw.snemanjeHrambaDni : Number(raw?.snemanjeHrambaDni);
  // Isto kot pravila.server.ts dniHrambe (lastnik 22. 11. 2026: 1 do 90, privzeto 30).
  const dni = Number.isFinite(n) && n >= 1 ? Math.min(90, Math.round(n)) : 30;
  return { dovoljenePredpone: predpone, hrambaDni: dni };
}

const vrste = new Map<string, Promise<unknown>>();

function vVrsti<T>(root: string, delo: () => Promise<T>): Promise<T> {
  const prej = vrste.get(root) ?? Promise.resolve();
  const naslednji = prej.catch(() => undefined).then(delo);
  const rep = naslednji.catch(() => undefined);
  vrste.set(root, rep);
  void rep.then(() => {
    if (vrste.get(root) === rep) vrste.delete(root);
  });
  return naslednji;
}

/**
 * Ključavnica med PROCESI (N3 slepega pregleda: dva procesa z isto mapo podatkov, npr. dvojen zagon ali preklop ob posodobitvi, sta
 * vsak v svojem pomnilniku preverila mejo in oba izvedla; 6 procesov je dalo 17 do 20 izvedb namesto 3). Datoteka se ustvari z
 * `wx` (atomarno: obstaja ali jo ustvarimo mi). Stara ključavnica (proces je umrl) se po `staraMs` odstrani pod drugo atomarno
 * znacko (`avtonomija.lock.prekinitev`, `wx`): odstranjuje lahko samo en cakalec naenkrat in pred odstranitvijo ponovno preveri, da je
 * ključavnica se vedno stara (2. slepi pregled N2: prej je drugi cakalec s starim `stat` z rename odnesel SVEZO ključavnico prvega,
 * dva imetnika, izguba zapisa v 5 od 10 tekov z 8 procesi).
 * Ce ključavnice ni mogoce dobiti v `rokMs`, se operacija zavrne (fail-closed), nikoli ne steje mimo ključavnice.
 */
export const nastavitveKljucavnice = { rokMs: 10_000, staraMs: 15_000 };
/** Samo za preizkuse: kolikokrat je ključavnica ze bila zasedena. Znotraj enega procesa vrsta vVrsti to prepreci (nikoli ne bo vec 0). */
export const statistikaKljucavnice = { zasedeno: 0 };

/**
 * Odstrani ZASTARELO ključavnico. Znacka `prekinitev` (`wx`) zagotovi, da to dela samo en cakalec; ta ponovno prebere starost
 * ključavnice in jo odstrani samo, ce je se vedno stara. Cakalec, ki mu znacke ne uspe dobiti, ne odstrani nicesar (poskusi znova).
 * Ostane zanemarljivo okno: znacka sama zastara (proces je umrl v mikrosekundah odstranjevanja) in jo odstranita dva hkrati.
 */
async function odstraniZastarelo(pot: string): Promise<void> {
  const znacka = `${pot}.prekinitev`;
  try {
    await (await open(znacka, "wx", 0o600)).close();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const sz = await stat(znacka).catch(() => null);
    if (sz && Date.now() - sz.mtimeMs > nastavitveKljucavnice.staraMs) await unlink(znacka).catch(() => undefined);
    return;
  }
  try {
    const znova = await stat(pot).catch(() => null);
    if (znova && Date.now() - znova.mtimeMs > nastavitveKljucavnice.staraMs) await unlink(pot).catch(() => undefined);
  } finally {
    await unlink(znacka).catch(() => undefined);
  }
}

async function zakleni(root: string): Promise<() => Promise<void>> {
  const pot = path.join(root, DATOTEKA_KLJUCAVNICE);
  const moj = `${process.pid}.${randomBytes(8).toString("hex")}`;
  const konec = Date.now() + nastavitveKljucavnice.rokMs;
  for (;;) {
    try {
      const f = await open(pot, "wx", 0o600);
      try {
        await f.writeFile(moj, "utf8");
      } finally {
        await f.close();
      }
      return async () => {
        try {
          if ((await readFile(pot, "utf8")) === moj) await unlink(pot);
        } catch {
          // ključavnico je ze odstranil, kdor jo je imel za staro: nic ne storimo
        }
      };
    } catch (e) {
      const koda = (e as NodeJS.ErrnoException).code;
      if (koda !== "EEXIST") throw e;
    }
    statistikaKljucavnice.zasedeno += 1;
    const s = await stat(pot).catch(() => null);
    if (s && Date.now() - s.mtimeMs > nastavitveKljucavnice.staraMs) {
      await odstraniZastarelo(pot);
      continue;
    }
    if (Date.now() > konec) throw new AvtonomijaNapaka("stanje", "Stanje pravil avtonomije je zaklenjeno.");
    await new Promise((r) => setTimeout(r, 5 + Math.floor(Math.random() * 20)));
  }
}

async function zZaklepom<T>(root: string, delo: () => Promise<T>): Promise<T> {
  return vVrsti(root, async () => {
    const odkleni = await zakleni(root);
    try {
      return await delo();
    } finally {
      await odkleni();
    }
  });
}

/**
 * Edina pot pisanja: branje, sprememba osnutka, preverba CELEGA stanja, atomarni zapis. Vse v vrsti po mapi IN pod ključavnico
 * med procesi (preverba omejitve in rezervacija sta ena operacija: dva hitra sprozilca, tudi iz dveh procesov, ne moreta oba
 * vzeti zadnjega mesta v dnevni meji). Neveljaven rezultat se ne zapise.
 */
export async function spremeniStanje<T>(root: string, sprememba: (osnutek: StanjeAvtonomije) => T | Promise<T>): Promise<T> {
  return zZaklepom(root, async () => {
    const branje = await preberiStanje(root);
    if (branje.pokvarjeno) throw new AvtonomijaNapaka("stanje", "Stanje pravil avtonomije je pokvarjeno.");
    const osnutek = structuredClone(branje.stanje);
    const izid = await sprememba(osnutek);
    const preverjeno = normalizirajStanje(osnutek);
    if (!preverjeno) throw new AvtonomijaNapaka("stanje", "Stanje pravil avtonomije po spremembi ni veljavno.");
    if (JSON.stringify(preverjeno) !== JSON.stringify(branje.stanje)) await writeJson(root, DATOTEKA_STANJA, preverjeno);
    return izid;
  });
}

/** Zapis privzetega stanja (izklopljeno), uporabi se samo za ponastavitev pokvarjene datoteke; ustavljeno ostane do »Nadaljuj«. */
export async function ponastaviStanje(root: string, zdaj: Date): Promise<void> {
  await zZaklepom(root, async () => {
    const s = privzetoStanje();
    s.ustavljeno = true;
    s.ustavljenoOd = zdaj.toISOString();
    await writeJson(root, DATOTEKA_STANJA, s);
  });
}

/**
 * Bralno stikalo »ustavi vse«. true, ce je ustavljeno z gumbom, s spremenljivko LINA_AVTONOMIJA=0 ali ce je stanje pokvarjeno
 * (fail-closed za avtonomijo). Brez datoteke = ni ustavljeno.
 */
export async function jeUstavljeno(root: string): Promise<boolean> {
  if (process.env.LINA_AVTONOMIJA === "0") return true;
  const branje = await preberiStanje(root);
  return branje.pokvarjeno ? true : branje.stanje.ustavljeno;
}

/**
 * Stikalo za OBSTOJECE nujno obvestilo in prevezavo (nujni.server.ts): ustavita ju »Ustavi vse«, LINA_AVTONOMIJA=0 in pokvarjena ali
 * nebranljiva datoteka (2. slepi pregled N5: stikalo, ki ga izklopi vsak program z dostopom do mape ali prehodna napaka branja,
 * ni stikalo; zato pokvarjeno = ustavljeno, fail-closed). Prejsnja odlocitev (1. pregled N9: pokvarjeno ne ustavi nujnega) je
 * umaknjena; ukaz »Ustavi« deluje tudi na pokvarjeni datoteki in jo ponastavi v ustavljeno stanje, »Ponastavi« in »Nadaljuj«
 * ostaneta lastnikova odlocitev.
 */
export async function jeUstavljenoNujno(root: string): Promise<boolean> {
  return jeUstavljeno(root);
}

/** Dnevnik: samo fiksne kode in id-ji. Napaka zapisa nikoli ne podre dejanja (dnevnik je sled, ne pogoj). */
export async function zapisiDnevnik(
  root: string,
  zapis: { opravilo: VrstaOpravila | "sistem"; izid: Izid; razlog?: Razlog; povezavaId?: string },
  zdaj: Date = new Date(),
): Promise<void> {
  const vrstica: ZapisDnevnika = {
    t: zdaj.toISOString(),
    id: randomBytes(8).toString("hex"),
    opravilo: zapis.opravilo,
    izid: zapis.izid,
    ...(zapis.razlog ? { razlog: zapis.razlog } : {}),
    ...(zapis.povezavaId && /^[a-f0-9]{16}$/.test(zapis.povezavaId) ? { povezavaId: zapis.povezavaId } : {}),
  };
  const pot = path.join(root, DATOTEKA_DNEVNIKA);
  try {
    const velikost = await stat(pot).then((s) => s.size).catch(() => 0);
    if (velikost > NAJVEC_DNEVNIKA_BAJTOV) await rename(pot, `${pot}.1`);
    await appendFile(pot, `${JSON.stringify(vrstica)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    // sled je koristna, ne pogoj: dejanje se je ze zgodilo ali zavrnilo
  }
}

/** Zadnjih `n` zapisov, najnovejsi prvi. Vsaka vrstica gre skozi preverbo oblike; karkoli drugega se zavrze. */
export async function preberiDnevnikZapisov(root: string, n = 50): Promise<ZapisDnevnika[]> {
  let besedilo = "";
  try {
    const vse = await readFile(path.join(root, DATOTEKA_DNEVNIKA));
    besedilo = vse.subarray(Math.max(0, vse.length - NAJVEC_BRANJA_BAJTOV)).toString("utf8");
  } catch {
    return [];
  }
  const izhod: ZapisDnevnika[] = [];
  for (const vrstica of besedilo.split("\n").reverse()) {
    if (!vrstica.trim()) continue;
    try {
      const z = preveriZapisDnevnika(JSON.parse(vrstica));
      if (z) izhod.push(z);
    } catch {
      // odrezana prva vrstica ali pokvarjen zapis
    }
    if (izhod.length >= n) break;
  }
  return izhod;
}
