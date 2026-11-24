import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireOwner } from "./auth.server.ts";
import { preveriCitate } from "./citat.ts";
import { izvleciBesedilo, MEJE_DOKUMENTA, NapakaDokumenta, type Meje, type Vrsta } from "./dokument-izvlecek.server.ts";
import { kljucLastnika } from "./keys.server.ts";
import { callProvider } from "./providers.ts";
import { zapisiRevizijo } from "./revizija.server.ts";
import { loadLine, publishLine } from "./service.server.ts";
import { zdruziKatalog } from "./splet.server.ts";
import { jeVrinjenoNavodilo, oznaciPodatke, predlogIzModela, skoziShranjevanje, znanjeIzStraniPoKoscih } from "./splet.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";
import type { Catalog, Predlog } from "./types.ts";
import { brezVbrizga } from "./vbrizg.ts";
import { besedaDatotek } from "./znanje-datoteke-besedila.ts";
import { dodajBesedilo } from "./znanje-besedilo.ts";
import { blokVira, odstraniBlok, type VirJavno } from "./znanje-viri.ts";

/**
 * Viri znanja iz datotek podjetja (AGENTS.md »Znanje iz datotek podjetja«). Izvirnik se hrani v podatkih Line pod nakljucnim
 * imenom (nikoli ime iz brskalnika), seznam v znanje-viri.json. Besedilo gre v znanje kot blok »Vir: <ime>«, a SELE po lastnikovi potrditvi
 * (objaviVir; drugi pregled 0.2.10, N9: lastnik najprej vidi, kaj bo Lina povedala klicateljem); streznik ga takrat doda v SHRANJENO znanje
 * in ga ob izbrisu odstrani (vmesnik samo uskladi svoje stanje). Izdelki gredo v katalog SAMO prek predloga in potrditve. Besedilo je
 * podatek, nikoli navodilo.
 */
export const MAPA_VIROV = "znanje-viri";
export const SEZNAM_VIROV = "znanje-viri.json";
export const PREDLOG_DATOTEKE = "znanje-predlog.json";
const NAJVEC_VIROV = 50;
/**
 * Malo vec od izseka, ki ga oznaciPodatke poslje modelu (3500): brezVbrizga porabi ~14 us na znak (izmerjeno), zato vecji izsek pomeni
 * zastoj glavne niti. Ce brezVbrizga vrstice odstrani, model dobi manj kot 3500 znakov (samo krajsi predlog).
 */
const IZSEK_ZA_MODEL = 4000;

export type Vir = VirJavno & { blok: string };
/** Predlog na disku pozna svoj vir: ob izbrisu vira se zavrze (najdba 7). */
type PredlogVira = Predlog & { virId?: string };

/**
 * Spremembe seznama virov, znanja in kataloga istega korena tecejo ena za drugo (pregled 0.2.10, najdba 6 in CodeRabbit): branje seznama,
 * preverba meje in zapis so v isti vrsti, zato socasna nalaganja ne izgubijo vnosa in ne obidejo meje.
 */
const vrste = new Map<string, Promise<unknown>>();
function zaporedno<T>(root: string, delo: () => Promise<T>): Promise<T> {
  const prej = vrste.get(root) ?? Promise.resolve();
  const zdaj = prej.then(delo, delo);
  const rep = zdaj.catch(() => undefined);
  vrste.set(root, rep);
  void rep.then(() => {
    if (vrste.get(root) === rep) vrste.delete(root);
  });
  return zdaj;
}
export type IzidNalaganja = { vir: VirJavno; blok: string; predlog: Predlog | null; brezModela: boolean; skrajsano: boolean };

/** Rod nalaganja na koren (CodeRabbit): predlog zapise ali pocisti samo zadnje zaceto nalaganje, starejse ga ne povozi. */
const rodovi = new Map<string, number>();

const ID = /^[0-9a-f-]{36}$/;
const javno = ({ blok: _b, ...v }: Vir): VirJavno => v;

/** Ime za prikaz in za oznako vira v znanju: brez poti, krmilnih znakov in vrinjenih navodil, najvec 80 znakov. */
export function imeVira(ime: string, vrsta: Vrsta): string {
  const osnova = (ime.split(/[\\/]/).pop() ?? "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} ._()-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return osnova && !jeVrinjenoNavodilo(osnova) ? osnova : `dokument.${vrsta}`;
}

async function seznam(root: string): Promise<Vir[]> {
  const v = await readJsonFile<Vir[]>(root, SEZNAM_VIROV);
  return Array.isArray(v) ? v.filter((x) => x && ID.test(x.id)) : [];
}

function napaka(razlog: Parameters<typeof besedaDatotek>[0]): Error {
  return new Error(besedaDatotek(razlog));
}

export type OdvisnostiVirov = { meje?: Meje; zdaj?: () => Date };

export async function naloziVir(
  ime: string,
  b64: string,
  token: string | null,
  dir?: string,
  odv: OdvisnostiVirov = {},
): Promise<IzidNalaganja> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const meje = odv.meje ?? MEJE_DOKUMENTA;
  // Dolzina base64 pred dekodiranjem: prevelika datoteka se ne nalozi v pomnilnik.
  if (typeof b64 !== "string" || b64.length > Math.ceil(meje.bajtov / 3) * 4 + 4) throw napaka("velik");
  const bajti = new Uint8Array(Buffer.from(b64, "base64"));
  // Hitra zavrnitev pred razclembo; odlocilna preverba je v vrsti spodaj.
  if ((await seznam(root)).length >= NAJVEC_VIROV) throw napaka("prevec");
  let izvlecek;
  try {
    izvlecek = await izvleciBesedilo(String(ime), bajti, meje);
  } catch (e) {
    throw napaka(e instanceof NapakaDokumenta ? e.razlog : "poskodovan");
  }
  // Iste varovalke kot besedilo strani: vrstice z zneskom ali »brezplacno« in vrinjena navodila padejo.
  const vrstice = izvlecek.besedilo.split(/\n+/).map((v) => v.trim()).filter(Boolean);
  const znanje = await znanjeIzStraniPoKoscih([{ naslov: "", odstavki: vrstice, seznami: [], naslovi: [], jsonld: [], povezave: [] }]);
  if (!znanje) throw napaka("prazen");
  const prikaz = imeVira(String(ime), izvlecek.vrsta);
  const vir: Vir = {
    id: randomUUID(),
    ime: prikaz,
    vrsta: izvlecek.vrsta,
    bajtov: bajti.byteLength,
    znakov: znanje.length,
    dodano: (odv.zdaj?.() ?? new Date()).toISOString(),
    objavljen: false,
    blok: blokVira(prikaz, znanje),
  };
  const mapa = path.join(root, MAPA_VIROV);
  const datoteka = path.join(mapa, `${vir.id}.${vir.vrsta}`);
  // Rod nalaganja se poveca sele, ko je vir sprejet in zapisan (pregled 0225 B6): zavrnjeno poznejse nalaganje ne zavrze predloga.
  const rod = await zaporedno(root, async () => {
    const obstojeci = await seznam(root);
    if (obstojeci.length >= NAJVEC_VIROV) throw napaka("prevec");
    // N9: vir se shrani NEOBJAVLJEN; v znanje za klice gre sele z objaviVir (lastnikova potrditev po pregledu besedila).
    await mkdir(mapa, { recursive: true, mode: 0o700 });
    await writeFile(datoteka, bajti, { mode: 0o600 });
    try {
      await writeJson(root, SEZNAM_VIROV, [...obstojeci, vir]);
    } catch (e) {
      // Brez osirotelega vnosa ali datoteke: seznam nazaj, izvirnik stran.
      await writeJson(root, SEZNAM_VIROV, obstojeci).catch(() => undefined);
      await unlink(datoteka).catch(() => undefined);
      throw e;
    }
    const rod = (rodovi.get(root) ?? 0) + 1;
    rodovi.set(root, rod);
    return rod;
  });

  // Predlog izdelkov: isti potek kot pri spletni strani; brez kljuca lastnika (ali Vertex/lasten streznik) samo znanje.
  const kljuc = await kljucLastnika(root);
  let predlog: Predlog | null = null;
  // Model dobi najvec 3500 znakov (oznaciPodatke), zato se vbrizg isce in citati preverjajo samo v izseku; nad celim znanjem
  // (do 500 000 znakov) je brezVbrizga drzal glavno nit ~7 s (drugi pregled 0.2.10, dodatno). Brez kljuca se ne racuna.
  const varno = kljuc ? brezVbrizga(znanje.slice(0, IZSEK_ZA_MODEL), jeVrinjenoNavodilo) : { besedilo: "" };
  if (kljuc && varno.besedilo.trim()) {
    const vhod = oznaciPodatke(varno.besedilo);
    // Vir je ze shranjen: napaka modela ali omrezja ne sme zavrniti nalaganja (sicer vir ostane brez obvestila); samo brez predloga.
    const odgovor = await callProvider({ provider: kljuc.provider, model: kljuc.model, key: kljuc.key, system: vhod.sistem, text: vhod.podatki, maxTokens: 800 }).catch(
      () => ({ ok: false }) as const,
    );
    if (odgovor.ok) {
      const surovo = predlogIzModela(odgovor.text, "datoteka", 1);
      const preverjeno = surovo ? preveriCitate(surovo, varno.besedilo) : null;
      if (preverjeno && preverjeno.predlog.vrstice.length) {
        const p = skoziShranjevanje(preverjeno.predlog);
        // Podatke podjetja (ime, ure, stik) iz dokumenta ne predlagamo: dokument opisuje izdelke in storitve.
        predlog = { ...p, gostitelj: "datoteka", sporocilo: prikaz, podjetje: { ...p.podjetje, izbrano: false }, znanje: undefined };
      }
    }
  }
  // Predlog velja za zadnji nalozeni dokument; brez novega predloga star (drug dokument) ne ostane (najdba 7). Zapis je v vrsti in samo,
  // ce vir se obstaja in je to zadnje zaceto nalaganje (CodeRabbit: izbris med cakanjem na model, starejse nalaganje ne povozi novejsega).
  predlog = await zaporedno(root, async () => {
    const zadnje = rodovi.get(root) === rod;
    const obstaja = (await seznam(root)).some((v) => v.id === vir.id);
    if (!zadnje || !obstaja) return null;
    if (predlog && predlog.vrstice.length) {
      await writeJson(root, PREDLOG_DATOTEKE, { ...predlog, virId: vir.id } satisfies PredlogVira);
      return predlog;
    }
    await zavrzi(root);
    return null;
  });
  await zapisiRevizijo(root, {
    vrsta: "znanje.iz-datoteke",
    opis: "Dokument podjetja je nalozen (v znanje gre po potrditvi lastnika).",
    podatki: { vrsta: vir.vrsta, znakov: vir.znakov, predlaganih: predlog?.vrstice.length ?? 0 },
  });
  return { vir: javno(vir), blok: vir.blok, predlog, brezModela: !kljuc, skrajsano: izvlecek.skrajsano };
}

export async function seznamVirov(token: string | null, dir?: string): Promise<{ viri: VirJavno[]; predlog: Predlog | null }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const predlog = await readJsonFile<Predlog>(root, PREDLOG_DATOTEKE);
  return { viri: (await seznam(root)).map(javno), predlog: predlog?.vrstice ? predlog : null };
}

/** Pregled: besedilo, ki ga je vir dodal v znanje. */
export async function pregledVira(id: string, token: string | null, dir?: string): Promise<{ blok: string }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const vir = (await seznam(root)).find((v) => v.id === id);
  if (!vir) throw napaka("niVira");
  return { blok: vir.blok };
}

/**
 * Lastnik potrdi besedilo vira (»Dodaj v znanje«, N9): blok gre v SHRANJENO znanje (velja za klice). Ponovna potrditev bloka ne podvoji.
 * Poln = zavrnitev »polno« (prerezan blok ob izbrisu ne bi bil najden); vir ostane neobjavljen.
 */
export async function objaviVir(id: string, token: string | null, dir?: string): Promise<{ blok: string }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (!ID.test(id)) throw napaka("niVira");
  const vir = await zaporedno(root, async () => {
    const viri = await seznam(root);
    const vir = viri.find((v) => v.id === id);
    if (!vir) throw napaka("niVira");
    if (vir.objavljen === false) {
      const line = await loadLine(root);
      const skupaj = dodajBesedilo(line.catalog.znanje ?? "", vir.blok);
      if (skupaj.skrajsano) throw napaka("polno");
      await publishLine({ catalog: { ...line.catalog, znanje: skupaj.besedilo } }, { token }, root);
      await writeJson(root, SEZNAM_VIROV, viri.map((v) => (v.id === id ? { ...v, objavljen: true } : v)));
    }
    return vir;
  });
  await zapisiRevizijo(root, { vrsta: "znanje.iz-datoteke", opis: "Lastnik je potrdil besedilo dokumenta za znanje.", podatki: { vrsta: vir.vrsta, znakov: vir.znakov } });
  return { blok: vir.blok };
}

/**
 * Izbrise izvirnik in vnos ter blok iz shranjenega znanja (velja takoj, tudi za klice). Vrne blok, da ga vmesnik odstrani se iz
 * neshranjenega stanja; odstranjeno=false pomeni, da je bil blok spremenjen ali ni bil shranjen.
 */
export async function izbrisiVir(id: string, token: string | null, dir?: string): Promise<{ blok: string; odstranjeno: boolean }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (!ID.test(id)) throw napaka("niVira");
  const { vir, izid } = await zaporedno(root, async () => {
    const viri = await seznam(root);
    const vir = viri.find((v) => v.id === id);
    if (!vir) throw napaka("niVira");
    // Najprej znanje (CodeRabbit 0.2.10): ce odstranitev ne uspe, vnos in izvirnik ostaneta, izbris se lahko ponovi.
    // Neobjavljen vir v znanju ni bil (N9): znanja se ne dotaknemo - enak blok potrjene dvojnice ostane; izbris je popoln.
    const line = vir.objavljen === false ? null : await loadLine(root);
    const izid = line ? odstraniBlok(line.catalog.znanje ?? "", vir.blok) : { znanje: "", najdeno: true };
    if (line && izid.najdeno) await publishLine({ catalog: { ...line.catalog, znanje: izid.znanje } }, { token }, root);
    await writeJson(root, SEZNAM_VIROV, viri.filter((v) => v.id !== id));
    try {
      await unlink(path.join(root, MAPA_VIROV, `${vir.id}.${vir.vrsta}`));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const predlog = await readJsonFile<PredlogVira>(root, PREDLOG_DATOTEKE);
    if (predlog?.virId === vir.id) await zavrzi(root);
    return { vir, izid };
  });
  await zapisiRevizijo(root, { vrsta: "znanje.vir-izbrisan", opis: "Dokument podjetja je izbrisan.", podatki: { vrsta: vir.vrsta, odstranjeno: izid.najdeno } });
  return { blok: vir.blok, odstranjeno: izid.najdeno };
}

/** Potrditev izbranih vrstic predloga iz dokumenta (isti zdruziKatalog kot pri strani). Znanja ne spreminja. */
export async function potrdiPredlogDatoteke(ids: string[], token: string | null, dir?: string): Promise<Catalog> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (!ids.length) throw napaka("niPredloga");
  // Branje, preverba, objava in poraba predloga v ISTI vrsti (CodeRabbit, N12): izbris vira ali novo nalaganje vmes ne more pustiti
  // potrditve zastarelega predloga ali izbrisa novega.
  const { saved, veljavni } = await zaporedno(root, async () => {
    const predlog = await readJsonFile<PredlogVira>(root, PREDLOG_DATOTEKE);
    if (!predlog?.vrstice) throw napaka("niPredloga");
    if (predlog.virId && !(await seznam(root)).some((v) => v.id === predlog.virId)) throw napaka("niPredloga");
    const veljavni = ids.filter((id) => predlog.vrstice.some((v) => v.id === id));
    // Izbira brez vrstic trenutnega predloga (zastarel vmesnik, ponarejeni id) ni potrditev (CodeRabbit 0.2.10): predlog ostane.
    if (!veljavni.length) throw napaka("niPredloga");
    const line = await loadLine(root);
    const saved = await publishLine({ catalog: zdruziKatalog(line.catalog, { ...predlog, znanje: undefined }, veljavni) }, { token }, root);
    await zavrzi(root);
    return { saved, veljavni };
  });
  await zapisiRevizijo(root, { vrsta: "katalog.iz-datoteke", opis: "Izdelki iz dokumenta so potrjeni.", podatki: { izbranih: veljavni.length } });
  return saved.catalog;
}

async function zavrzi(root: string): Promise<void> {
  try {
    await unlink(path.join(root, PREDLOG_DATOTEKE));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

export async function zavrziPredlogDatoteke(token: string | null, dir?: string): Promise<{ ok: true }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  await zavrzi(root);
  return { ok: true };
}
