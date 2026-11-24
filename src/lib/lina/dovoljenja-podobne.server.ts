/**
 * Shramba dovoljenj »velja tudi za vse podobne« (dovoljenja-podobne.json, pravice 0600) - skupni modul za vse potrditve Line.
 * - zapisiDovoljenje: klicejo ga SAMO ukazi seje lastnika (requireOwner) in poti s preverjenim podpisom naprave ozjega kroga.
 * - najdiDovoljenje: ali je podobno dejanje ze dovoljeno; vsaka uporaba gre v dnevnik (brez besedila naloge).
 * - seznamDovoljenj / prekliciDovoljenje: Nastavitve > Dovoljenja (samo lastnik).
 * Pokvarjena ali neberljiva datoteka pomeni »ni dovoljeno« (fail-closed). Dovoljenje naprave velja samo za TO napravo, samo dokler je
 * v ozjem krogu, in samo ce njen shranjeni podpis znova velja: rocni vpis v datoteko brez kljuca naprave ne da nicesar.
 */
import { requireOwner } from "./auth.server.ts";
import { createHash } from "node:crypto";
import {
  kljucObsega,
  nizDovoljenja,
  nizDovoljenjaOdobritve,
  normirajObseg,
  jeVrstaDovoljenja,
  type DokazDovoljenja,
  type Dovoljenje,
  type Obseg,
  type PrikazOdobritve,
  type UporabaDovoljenja,
  type VrstaDovoljenja,
} from "./dovoljenja-podobne.ts";
import { DODATKI_TELEFONA, ORODJE_DODATKI, predogledDodatka, predogledN8nZagon, preveriPodpisNaprave, programIzUkaza, zgostitevPrikaza } from "./kanal-claude.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

/**
 * Obseg iz prikaza zahteve Claude Code: program in podukaz (en preprost ukaz cli-anything-<ime> brez tveganih argumentov) ali dodatek (orodje dodatki, predogled pise koda).
 * Vse drugo (poljuben ukaz, urejanje datotek ...) nima obsega: za tako zahtevo dovoljenja za podobne ni.
 */
export function obsegIzPrikaza(orodje: string, predogled: unknown): { vrsta: "program" | "dodatek" | "n8n-zagon"; obseg: Obseg } | null {
  const program = programIzUkaza(orodje, predogled);
  if (program) return { vrsta: "program", obseg: program };
  if (orodje !== ORODJE_DODATKI || typeof predogled !== "string") return null;
  for (const dodatek of DODATKI_TELEFONA) {
    for (const vklop of [true, false]) {
      if (predogled === predogledDodatka(dodatek, vklop)) return { vrsta: "dodatek", obseg: { dodatek, smer: vklop ? "vklopi" : "izklopi" } };
    }
  }
  // Zagon n8n toka po ID (predogled sestavi koda kanala); ustvarjanje toka (predogledN8nUstvari) obsega nima in se vedno vprasa.
  const PREDPONA_ZAGONA = "n8n zazeni: ";
  if (predogled.startsWith(PREDPONA_ZAGONA)) {
    const tok = predogled.slice(PREDPONA_ZAGONA.length);
    if (predogled === predogledN8nZagon(tok) && normirajObseg("n8n-zagon", { tok })) return { vrsta: "n8n-zagon", obseg: { tok } };
  }
  return null;
}

/** Stabilen id dovoljenja iz kljuca in naprave (isto dovoljenje drugic ne podvoji vnosa). */
export function idDovoljenja(kljuc: string, naprava: string | null): string {
  return createHash("sha256").update(`${kljuc}\u0000${naprava ?? ""}`, "utf8").digest("hex").slice(0, 16);
}

export const DATOTEKA_DOVOLJENJ = "dovoljenja-podobne.json";
/** Dnevnik uporabe v LOCENI datoteki: kanal (drug proces) dovoljenja samo bere in pise samo dnevnik, zato ne more povoziti preklica. */
export const DATOTEKA_DNEVNIKA = "dovoljenja-podobne-dnevnik.json";
export const NAJVEC_DOVOLJENJ = 200;
export const NAJVEC_ZAPISOV_DNEVNIKA = 300;

type Shramba = { v: 1; dovoljenja: Dovoljenje[] };

const vrste = new Map<string, Promise<unknown>>();
function vVrsti<T>(kljuc: string, delo: () => Promise<T>): Promise<T> {
  const tek = (vrste.get(kljuc) ?? Promise.resolve()).then(delo, delo);
  vrste.set(kljuc, tek.then(() => undefined, () => undefined));
  return tek;
}

function jeObjekt(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function jeDokaz(v: unknown): v is DokazDovoljenja {
  return jeObjekt(v) && Number.isSafeInteger(v.cas) && typeof v.enkratni === "string" && typeof v.podpis === "string";
}

function jePrikaz(v: unknown): v is PrikazOdobritve {
  return jeObjekt(v) && ["zahtevaId", "chatId", "orodje", "predogled", "opis"].every((k) => typeof v[k] === "string");
}

/** Normiran obseg, ki se lahko se ujame; program s podukazom »-« (pred R1 1950: vsi klici samih zastavic) se ne ujame vec. */
function veljavenObseg(vrsta: VrstaDovoljenja, obseg: unknown): Obseg | null {
  const o = normirajObseg(vrsta, obseg);
  return o && !(vrsta === "program" && o.podukaz === "-") ? o : null;
}

function razcleni(surovo: unknown): Shramba {
  const s: Shramba = { v: 1, dovoljenja: [] };
  if (!jeObjekt(surovo)) return s;
  if (Array.isArray(surovo.dovoljenja)) {
    for (const d of surovo.dovoljenja) {
      if (s.dovoljenja.length >= NAJVEC_DOVOLJENJ) break;
      if (!jeObjekt(d) || !jeVrstaDovoljenja(d.vrsta) || typeof d.kdaj !== "string") continue;
      const obseg = veljavenObseg(d.vrsta, d.obseg);
      if (!obseg) continue;
      if (d.kdo === "lastnik") {
        s.dovoljenja.push({ id: idDovoljenja(kljucObsega(d.vrsta, obseg)!, null), vrsta: d.vrsta, obseg, kdo: "lastnik", naprava: null, kdaj: d.kdaj });
      } else if (d.kdo === "naprava" && typeof d.naprava === "string" && jeDokaz(d.dokaz)) {
        s.dovoljenja.push({
          id: idDovoljenja(kljucObsega(d.vrsta, obseg)!, d.naprava), vrsta: d.vrsta, obseg, kdo: "naprava", naprava: d.naprava, kdaj: d.kdaj,
          dokaz: { cas: d.dokaz.cas, enkratni: d.dokaz.enkratni, podpis: d.dokaz.podpis },
          ...(jePrikaz(d.prikaz) ? { prikaz: d.prikaz } : {}),
        });
      }
    }
  }
  return s;
}

async function preberi(root: string): Promise<Shramba> {
  try {
    return razcleni(await readJsonFile<unknown>(root, DATOTEKA_DOVOLJENJ));
  } catch {
    return { v: 1, dovoljenja: [] };
  }
}

async function preberiDnevnik(root: string): Promise<UporabaDovoljenja[]> {
  const surovo = await readJsonFile<unknown>(root, DATOTEKA_DNEVNIKA).catch(() => null);
  if (!jeObjekt(surovo) || !Array.isArray(surovo.dnevnik)) return [];
  const izid: UporabaDovoljenja[] = [];
  for (const u of surovo.dnevnik.slice(-NAJVEC_ZAPISOV_DNEVNIKA)) {
    if (jeObjekt(u) && typeof u.id === "string" && jeVrstaDovoljenja(u.vrsta) && typeof u.kdaj === "string") {
      izid.push({ id: u.id, vrsta: u.vrsta, kdaj: u.kdaj, naprava: typeof u.naprava === "string" ? u.naprava : null });
    }
  }
  return izid;
}

/** Izvor dovoljenja: seja lastnika ali podpisana izbira naprave (podpis je klicatelj ze preveril; tu se samo shrani za ponovno preverbo). */
export type IzvorDovoljenja =
  | { kdo: "lastnik" }
  | { kdo: "naprava"; naprava: string; dokaz: DokazDovoljenja; prikaz?: PrikazOdobritve };

/**
 * Zapise dovoljenje za podobna dejanja. Klicati SAMO iz ukaza seje lastnika (po requireOwner) ali iz poti, ki je podpis naprave
 * preverila. Isti obseg in ista naprava drugic ne podvojita vnosa; nad mejo zavrne (lastnik najprej preklice katero staro).
 */
export async function zapisiDovoljenje(dir: string | undefined, vrsta: VrstaDovoljenja, obsegVhod: Obseg, izvor: IzvorDovoljenja, zdaj = new Date()): Promise<Dovoljenje> {
  const root = resolveDataDir(dir);
  const obseg = normirajObseg(vrsta, obsegVhod);
  const kljuc = kljucObsega(vrsta, obseg);
  if (!obseg || !kljuc) throw new Error("Neveljaven obseg dovoljenja.");
  const naprava = izvor.kdo === "naprava" ? izvor.naprava : null;
  const d: Dovoljenje = {
    id: idDovoljenja(kljuc, naprava), vrsta, obseg, kdo: izvor.kdo, naprava, kdaj: zdaj.toISOString(),
    ...(izvor.kdo === "naprava" ? { dokaz: izvor.dokaz, ...(izvor.prikaz ? { prikaz: izvor.prikaz } : {}) } : {}),
  };
  return vVrsti(root, async () => {
    const s = await preberi(root);
    const ostala = s.dovoljenja.filter((x) => x.id !== d.id);
    if (ostala.length >= NAJVEC_DOVOLJENJ) throw new Error("Dovoljenj je prevec; v Nastavitvah > Dovoljenja preklicite katero staro.");
    await writeJson(root, DATOTEKA_DOVOLJENJ, { ...s, dovoljenja: [...ostala, d] } satisfies Shramba);
    return d;
  });
}

/** Ali podpis dovoljenja naprave se velja (naprava v ozjem krogu, podpis njenega kljuca, prikaz se ujema z obsegom). */
function podpisVelja(d: Dovoljenje, kljuci: ReadonlyMap<string, string>): boolean {
  if (d.kdo !== "naprava" || !d.naprava || !d.dokaz) return false;
  const kljuc = kljuci.get(d.naprava);
  if (!kljuc) return false;
  const { cas, enkratni, podpis } = d.dokaz;
  if (d.prikaz) {
    const p = d.prikaz;
    const izp = obsegIzPrikaza(p.orodje, p.predogled);
    if (!izp || izp.vrsta !== d.vrsta || kljucObsega(izp.vrsta, izp.obseg) !== kljucObsega(d.vrsta, d.obseg)) return false;
    const zg = zgostitevPrikaza(p.orodje, p.predogled, p.opis);
    return preveriPodpisNaprave(kljuc, nizDovoljenjaOdobritve(d.naprava, p.zahtevaId, p.chatId, zg, cas, enkratni), podpis);
  }
  return preveriPodpisNaprave(kljuc, nizDovoljenja(d.naprava, kljucObsega(d.vrsta, d.obseg)!, cas, enkratni), podpis);
}

/**
 * Ali je dejanje te vrste v tem obsegu ze dovoljeno. Brez `naprava` (racunalnik, Lina): samo dovoljenje seje lastnika. Z `naprava`
 * (zahteva naprave ozjega kroga): samo dovoljenje, ki ga je dala TA naprava, s podpisom, ki znova velja s kljucem iz `kljuci`.
 * Najdeno dovoljenje se zabelezi v dnevnik uporabe. Vsaka napaka = ni dovoljeno.
 */
export async function najdiDovoljenje(
  dir: string | undefined, vrsta: VrstaDovoljenja, obsegVhod: unknown,
  moznosti: { naprava?: string; kljuci?: ReadonlyMap<string, string>; zabelezi?: boolean } = {}, zdaj = new Date(),
): Promise<Dovoljenje | null> {
  try {
    const root = resolveDataDir(dir);
    const kljuc = kljucObsega(vrsta, obsegVhod);
    if (!kljuc) return null;
    const s = await preberi(root);
    const d = s.dovoljenja.find((x) => {
      if (kljucObsega(x.vrsta, x.obseg) !== kljuc) return false;
      if (moznosti.naprava === undefined) return x.kdo === "lastnik";
      return x.kdo === "naprava" && x.naprava === moznosti.naprava && !!moznosti.kljuci && podpisVelja(x, moznosti.kljuci);
    });
    if (!d) return null;
    // brez zapisa samo predpreverba (kanal pred dodatkom); uporabo zabelezi Lina, ki dejanje izvede
    if (moznosti.zabelezi === false) return d;
    // dnevnik je obvezen: dejanje, katerega uporabe ni mogoce zapisati, se ne izvede brez vprasanja
    await vVrsti(`${root}\u0000dnevnik`, async () => {
      const dnevnik = [...(await preberiDnevnik(root)), { id: d.id, vrsta: d.vrsta, kdaj: zdaj.toISOString(), naprava: d.naprava }];
      await writeJson(root, DATOTEKA_DNEVNIKA, { v: 1, dnevnik: dnevnik.slice(-NAJVEC_ZAPISOV_DNEVNIKA) });
    });
    return d;
  } catch {
    return null;
  }
}

export type JavnoDovoljenje = Omit<Dovoljenje, "dokaz" | "prikaz"> & { uporab: number; zadnjaUporaba: string | null };

/**
 * R4 (24. 11. 2026): dovoljenja znane vrste z obsegom stare oblike (npr. program brez podukaza) ne veljajo vec (fail-closed); lastnik
 * mora vedeti, da jih da znova. shortcut: samo stevilo iz trenutne datoteke - ob naslednjem zapisu dovoljenj jih razcleni ne ohrani.
 */
async function steviloZastarelih(root: string): Promise<number> {
  try {
    const s = await readJsonFile<unknown>(root, DATOTEKA_DOVOLJENJ);
    if (!jeObjekt(s) || !Array.isArray(s.dovoljenja)) return 0;
    return s.dovoljenja.filter((d) => jeObjekt(d) && jeVrstaDovoljenja(d.vrsta) && !veljavenObseg(d.vrsta, d.obseg)).length;
  } catch {
    return 0;
  }
}

/** Seznam za Nastavitve > Dovoljenja (samo lastnik): brez podpisov in prikazov, s stetjem uporab in zastarelih. */
export async function seznamDovoljenj(
  token: string | null, dir?: string,
): Promise<{ dovoljenja: JavnoDovoljenje[]; dnevnik: UporabaDovoljenja[]; zastarela: number }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const s = await preberi(root);
  const dnevnik = await preberiDnevnik(root);
  return {
    zastarela: await steviloZastarelih(root),
    dovoljenja: s.dovoljenja.map(({ dokaz: _d, prikaz: _p, ...d }) => {
      const uporabe = dnevnik.filter((u) => u.id === d.id);
      return { ...d, uporab: uporabe.length, zadnjaUporaba: uporabe.at(-1)?.kdaj ?? null };
    }),
    dnevnik: dnevnik.slice(-50).reverse(),
  };
}

/** Preklic (samo lastnik). Vrne true, ce je bilo dovoljenje odstranjeno. Dnevnik uporabe ostane. */
export async function prekliciDovoljenje(token: string | null, id: unknown, dir?: string): Promise<boolean> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (typeof id !== "string" || !/^[a-f0-9]{16}$/.test(id)) return false;
  return vVrsti(root, async () => {
    const s = await preberi(root);
    const ostala = s.dovoljenja.filter((x) => x.id !== id);
    if (ostala.length === s.dovoljenja.length) return false;
    await writeJson(root, DATOTEKA_DOVOLJENJ, { ...s, dovoljenja: ostala } satisfies Shramba);
    return true;
  });
}
