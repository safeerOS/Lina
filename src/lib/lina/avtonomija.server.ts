import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ownerExists, requireOwner } from "./auth.server.ts";
import {
  NACINI,
  NAJVEC_NA_DAN_TRDO,
  NAJVEC_NA_PREJEMNIKA_DAN,
  NAJVEC_POVEZAV,
  NAJVEC_PREDLOG,
  NAJVEC_PREJEMNIKOV,
  NAJDALJSI_IZTEK_DNI,
  VRSTE_OPRAVIL,
  danKljuc,
  jeVrstaOpravila,
  maskirajStevilko,
  ocistiIme,
  porabaDanes,
  pripraviPredlogo,
  preveriStevilkoPrejemnika,
  ukazZahtevaGeslo,
  veljavenCas,
  type Nacin,
  type Okno,
  type VrstaOpravila,
  type ZapisDnevnika,
} from "./avtonomija.ts";
import { odkloniCakajoce, odobriCakajoce, type IzidIzvedbe } from "./avtonomija-izvedba.server.ts";
import {
  AvtonomijaNapaka,
  ponastaviStanje,
  preberiDnevnikZapisov,
  preberiNastavitvePravil,
  preberiStanje,
  spremeniStanje,
  zapisiDnevnik,
} from "./avtonomija-stanje.server.ts";
import { tA } from "./besedila-avtonomija.ts";
import { zapisiDovoljenje } from "./dovoljenja-podobne.server.ts";
import { obsegAvtonomije } from "./avtonomija-izvedba.server.ts";
import { resolveDataDir } from "./store.server.ts";

/**
 * Vmesnik za lastnika (okno Line): VSAK ukaz zahteva sejo lastnika (requireOwner). Tu je edino mesto, kjer se spreminjajo pravila,
 * prejemniki, predloge in sprozilci. Klic, SMS, e-posta, splet in asistentka te datoteke ne uvazajo (preizkus uvozov), zato iz
 * dohodnega sporocila ni poti do sprememb (isto nacelo kot core/link_dostop.py: odloca samo uporabnik na tej napravi).
 */
const ID = /^[a-f0-9]{16}$/;
const DATUM = /^(\d{4})-(\d{2})-(\d{2})$/;

export type JavnoStanje = {
  ustavljeno: boolean;
  ustavljenoOd: string | null;
  pokvarjeno: boolean;
  trdoIzklopljeno: boolean;
  /** Geslo Line je nastavljeno. Brez njega samodejnih opravil ni mogoce vklopiti ali spreminjati (ogled in izklop sta mogoca). */
  gesloNastavljeno: boolean;
  /** `dosezeno`: danes je dosezena dnevna omejitev opravila ali omejitev na prejemnika, zato naslednji (tudi resnicno nujni) klici danes ne sprozijo opravila. */
  pravila: Record<VrstaOpravila, { nacin: Nacin; veljaDo: string | null; najvecNaDan: number; okno: Okno | null; danes: number; dosezeno: boolean }>;
  povzetekUra: string;
  prejemniki: Array<{ id: string; ime: string; maska: string }>;
  predloge: Array<{ id: string; besedilo: string }>;
  povezave: Array<{ id: string; predlogaId: string; prejemnikId: string }>;
  cakajoca: Array<{ id: string; vrsta: VrstaOpravila; predloga: string; prejemnik: string; poteceDo: string }>;
  meje: { najvecNaDan: number; najvecNaPrejemnika: number; najdaljsiIztekDni: number; prejemnikov: number; predlog: number; povezav: number };
};

export type OdgovorUkaza = JavnoStanje & { rezultat?: IzidIzvedbe };

const napaka = (koda: string): AvtonomijaNapaka => new AvtonomijaNapaka(koda, tA(`napaka_${koda}`));
const nov = (): string => randomBytes(8).toString("hex");

/** Lokalni dan YYYY-MM-DD za prikaz datuma izteka. */
function datumIzteka(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? danKljuc(d) : null;
}

async function javno(root: string, zdaj: Date): Promise<JavnoStanje> {
  const branje = await preberiStanje(root);
  const trdo = process.env.LINA_AVTONOMIJA === "0";
  const geslo = await ownerExists(root);
  const meje = {
    najvecNaDan: NAJVEC_NA_DAN_TRDO,
    najvecNaPrejemnika: NAJVEC_NA_PREJEMNIKA_DAN,
    najdaljsiIztekDni: NAJDALJSI_IZTEK_DNI,
    prejemnikov: NAJVEC_PREJEMNIKOV,
    predlog: NAJVEC_PREDLOG,
    povezav: NAJVEC_POVEZAV,
  };
  if (branje.pokvarjeno) {
    const prazno = { nacin: "izklopljeno" as const, veljaDo: null, najvecNaDan: 1, okno: null, danes: 0, dosezeno: false };
    return {
      ustavljeno: true, ustavljenoOd: null, pokvarjeno: true, trdoIzklopljeno: trdo, gesloNastavljeno: geslo,
      pravila: { "sms-predloga": prazno, "povzetek-dneva": prazno }, povzetekUra: "08:00",
      prejemniki: [], predloge: [], povezave: [], cakajoca: [], meje,
    };
  }
  const s = branje.stanje;
  const poraba = porabaDanes(s, zdaj);
  const dosezeno = (v: VrstaOpravila): boolean => {
    if (s.pravila[v].nacin === "izklopljeno") return false;
    if ((poraba.vrste[v] ?? 0) >= Math.min(s.pravila[v].najvecNaDan, NAJVEC_NA_DAN_TRDO)) return true;
    return v === "sms-predloga" && Object.values(poraba.prejemniki).some((n) => n >= NAJVEC_NA_PREJEMNIKA_DAN);
  };
  const pravila = Object.fromEntries(
    VRSTE_OPRAVIL.map((v) => [v, { nacin: s.pravila[v].nacin, veljaDo: datumIzteka(s.pravila[v].veljaDo), najvecNaDan: s.pravila[v].najvecNaDan, okno: s.pravila[v].okno, danes: poraba.vrste[v] ?? 0, dosezeno: dosezeno(v) }]),
  ) as JavnoStanje["pravila"];
  return {
    ustavljeno: s.ustavljeno,
    ustavljenoOd: s.ustavljenoOd,
    pokvarjeno: false,
    trdoIzklopljeno: trdo,
    gesloNastavljeno: geslo,
    pravila,
    povzetekUra: s.povzetekUra,
    // Stevilka prejemnika gre odjemalcu samo maskirana.
    prejemniki: s.prejemniki.map((p) => ({ id: p.id, ime: p.ime, maska: maskirajStevilko(p.stevilka) })),
    predloge: s.predloge.map((p) => ({ id: p.id, besedilo: p.besedilo })),
    povezave: s.povezave.map((p) => ({ id: p.id, predlogaId: p.predlogaId, prejemnikId: p.prejemnikId })),
    cakajoca: s.cakajoca.map((c) => {
      const pov = s.povezave.find((p) => p.id === c.povezavaId);
      return {
        id: c.id,
        vrsta: c.vrsta,
        predloga: s.predloge.find((p) => p.id === pov?.predlogaId)?.besedilo ?? "",
        prejemnik: s.prejemniki.find((p) => p.id === pov?.prejemnikId)?.ime ?? "",
        poteceDo: c.poteceDo,
      };
    }),
    meje,
  };
}

export async function stanjeAvtonomije(token: string | null, dir?: string, zdaj: Date = new Date()): Promise<JavnoStanje> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return javno(root, zdaj);
}

/** Dnevnik (zadnjih 50) in zadnji povzetek dneva. Samo fiksne kode; brez vsebine klicev, besedil in stevilk. */
export async function dnevnikAvtonomije(token: string | null, dir?: string): Promise<{ dnevnik: ZapisDnevnika[]; povzetek: { datum: string; besedilo: string } | null }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const dnevnik = await preberiDnevnikZapisov(root, 50);
  let povzetek: { datum: string; besedilo: string } | null = null;
  try {
    const mapa = path.join(root, "povzetki");
    const imena = (await readdir(mapa)).filter((i) => /^povzetek-\d{4}-\d{2}-\d{2}\.txt$/.test(i)).sort();
    const zadnje = imena[imena.length - 1];
    if (zadnje) povzetek = { datum: zadnje.slice(9, 19), besedilo: (await readFile(path.join(mapa, zadnje), "utf8")).slice(0, 20_000) };
  } catch {
    povzetek = null;
  }
  return { dnevnik, povzetek };
}

function datumVKonecDneva(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const m = DATUM.exec(v);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 0);
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}

function obj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw napaka("ukaz");
  return v as Record<string, unknown>;
}

function id(v: unknown): string {
  if (typeof v !== "string" || !ID.test(v)) throw napaka("ni-najdeno");
  return v;
}

/**
 * Ukazi lastnika. Vsak ukaz najprej preveri sejo lastnika, nato obliko vhoda; vsak ukaz, ki spremeni stanje, se zapise v dnevnik
 * (samo koda). Neznan ukaz = napaka. Vhod je lastnikov (okno Line), vendar se vseeno preverja strogo.
 */
export async function ukazAvtonomije(token: string | null, ukaz: unknown, dir?: string, zdaj: Date = new Date()): Promise<OdgovorUkaza> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const u = obj(ukaz);
  // Brez gesla vsak lokalni proces dobi sejo lastnika (origin.ts jeLokalnaZahteva): vklop in spreminjanje je takrat zavrnjeno (fail-closed).
  if (ukazZahtevaGeslo(u.ukaz, u.nacin) && !(await ownerExists(root))) throw napaka("geslo");
  let rezultat: IzidIzvedbe | undefined;
  switch (u.ukaz) {
    case "pravilo": {
      if (!jeVrstaOpravila(u.vrsta)) throw napaka("vrsta");
      const vrsta = u.vrsta;
      if (typeof u.nacin !== "string" || !(NACINI as readonly string[]).includes(u.nacin)) throw napaka("nacin");
      const nacin = u.nacin as Nacin;
      const meja = typeof u.najvecNaDan === "number" ? u.najvecNaDan : typeof u.najvecNaDan === "string" && u.najvecNaDan.trim() ? Number(u.najvecNaDan) : NaN;
      if (!Number.isInteger(meja) || meja < 1 || meja > NAJVEC_NA_DAN_TRDO) throw napaka("meja");
      let okno: Okno | null = null;
      if (u.okno !== null && u.okno !== undefined) {
        const o = obj(u.okno);
        if (!veljavenCas(o.od) || !veljavenCas(o.do) || o.od === o.do) throw napaka("okno");
        okno = { od: o.od, do: o.do };
      }
      let veljaDo: string | null = null;
      if (nacin !== "izklopljeno") {
        const konec = datumVKonecDneva(u.veljaDo);
        const najvec = new Date(zdaj.getFullYear(), zdaj.getMonth(), zdaj.getDate() + NAJDALJSI_IZTEK_DNI, 23, 59, 59, 0);
        if (!konec || konec.getTime() <= zdaj.getTime() || konec.getTime() > najvec.getTime()) throw napaka("iztek");
        veljaDo = konec.toISOString();
      }
      await spremeniStanje(root, (s) => {
        const p = s.pravila[vrsta];
        const prej = p.nacin;
        p.nacin = nacin;
        p.veljaDo = veljaDo;
        p.najvecNaDan = meja;
        p.okno = okno;
        // Vklop ali sprememba cas vklopa: dogodki izpred vklopa ne sprozijo nicesar (npr. stari nujni klici).
        p.aktivnoOd = nacin === "izklopljeno" ? null : prej === "izklopljeno" || !p.aktivnoOd ? zdaj.toISOString() : p.aktivnoOd;
        if (nacin === "izklopljeno") s.cakajoca = s.cakajoca.filter((c) => c.vrsta !== vrsta);
      });
      await zapisiDnevnik(root, { opravilo: vrsta, izid: "nastavitev", razlog: "nastavitev-pravilo" }, zdaj);
      break;
    }
    case "ura": {
      if (!veljavenCas(u.ura)) throw napaka("ura");
      const ura = u.ura;
      await spremeniStanje(root, (s) => {
        s.povzetekUra = ura;
      });
      await zapisiDnevnik(root, { opravilo: "povzetek-dneva", izid: "nastavitev", razlog: "nastavitev-ura" }, zdaj);
      break;
    }
    case "prejemnik-dodaj": {
      const ime = ocistiIme(u.ime);
      if (!ime) throw napaka("prejemnik-ime");
      const st = preveriStevilkoPrejemnika(u.stevilka, (await preberiNastavitvePravil(root)).dovoljenePredpone);
      if ("napaka" in st) throw napaka("prejemnik");
      await spremeniStanje(root, (s) => {
        if (s.prejemniki.length >= NAJVEC_PREJEMNIKOV) throw napaka("prejemnik-polno");
        if (s.prejemniki.some((p) => p.stevilka === st.stevilka)) throw napaka("prejemnik-obstaja");
        s.prejemniki.push({ id: nov(), ime, stevilka: st.stevilka });
      });
      await zapisiDnevnik(root, { opravilo: "sistem", izid: "nastavitev", razlog: "nastavitev-prejemnik" }, zdaj);
      break;
    }
    case "prejemnik-odstrani": {
      const i = id(u.id);
      await spremeniStanje(root, (s) => {
        if (!s.prejemniki.some((p) => p.id === i)) throw napaka("ni-najdeno");
        s.prejemniki = s.prejemniki.filter((p) => p.id !== i);
        const odpadle = new Set(s.povezave.filter((p) => p.prejemnikId === i).map((p) => p.id));
        s.povezave = s.povezave.filter((p) => !odpadle.has(p.id));
        s.cakajoca = s.cakajoca.filter((c) => !odpadle.has(c.povezavaId));
        delete s.poraba.prejemniki[i];
      });
      await zapisiDnevnik(root, { opravilo: "sistem", izid: "nastavitev", razlog: "nastavitev-prejemnik" }, zdaj);
      break;
    }
    case "predloga-dodaj": {
      const pripravljena = pripraviPredlogo(u.besedilo);
      if ("napaka" in pripravljena) throw napaka(pripravljena.napaka);
      const besedilo = pripravljena.besedilo;
      await spremeniStanje(root, (s) => {
        if (s.predloge.length >= NAJVEC_PREDLOG) throw napaka("predloga-polna");
        s.predloge.push({ id: nov(), besedilo });
      });
      await zapisiDnevnik(root, { opravilo: "sistem", izid: "nastavitev", razlog: "nastavitev-predloga" }, zdaj);
      break;
    }
    case "predloga-odstrani": {
      const i = id(u.id);
      await spremeniStanje(root, (s) => {
        if (!s.predloge.some((p) => p.id === i)) throw napaka("ni-najdeno");
        s.predloge = s.predloge.filter((p) => p.id !== i);
        const odpadle = new Set(s.povezave.filter((p) => p.predlogaId === i).map((p) => p.id));
        s.povezave = s.povezave.filter((p) => !odpadle.has(p.id));
        s.cakajoca = s.cakajoca.filter((c) => !odpadle.has(c.povezavaId));
      });
      await zapisiDnevnik(root, { opravilo: "sistem", izid: "nastavitev", razlog: "nastavitev-predloga" }, zdaj);
      break;
    }
    case "povezava-dodaj": {
      const predlogaId = id(u.predlogaId);
      const prejemnikId = id(u.prejemnikId);
      await spremeniStanje(root, (s) => {
        if (!s.predloge.some((p) => p.id === predlogaId) || !s.prejemniki.some((p) => p.id === prejemnikId)) throw napaka("povezava-neveljavna");
        if (s.povezave.length >= NAJVEC_POVEZAV) throw napaka("povezava-polna");
        if (s.povezave.some((p) => p.predlogaId === predlogaId && p.prejemnikId === prejemnikId)) throw napaka("povezava-obstaja");
        s.povezave.push({ id: nov(), vrsta: "sms-predloga", sprozilec: "nujen-klic", predlogaId, prejemnikId });
        // N4 2. pregleda: klici, ki so se koncali PRED sprozilcem, ne smejo sprozit SMS za nazaj (kazalo na zdaj, enako kot premakniKazaloNujnih).
        const cas = zdaj.getTime();
        if (Number.isSafeInteger(cas) && cas > s.kazalec.nujniCas) {
          s.kazalec.nujniCas = cas;
          s.kazalec.nujniHash = "f".repeat(16);
        }
      });
      await zapisiDnevnik(root, { opravilo: "sistem", izid: "nastavitev", razlog: "nastavitev-povezava" }, zdaj);
      break;
    }
    case "povezava-odstrani": {
      const i = id(u.id);
      await spremeniStanje(root, (s) => {
        if (!s.povezave.some((p) => p.id === i)) throw napaka("ni-najdeno");
        s.povezave = s.povezave.filter((p) => p.id !== i);
        s.cakajoca = s.cakajoca.filter((c) => c.povezavaId !== i);
      });
      await zapisiDnevnik(root, { opravilo: "sistem", izid: "nastavitev", razlog: "nastavitev-povezava" }, zdaj);
      break;
    }
    case "ustavi": {
      // Pokvarjena datoteka (N5 2. pregleda): spremeniStanje bi zavrnil in gumb ne bi deloval. Ker je pokvarjeno stanje ze neuporabno
      // (pravila se ne izvedejo), ga ponastavimo v ustavljeno; enkratno ponovno branje, da prehodna napaka branja ne zbrise veljavnega stanja.
      let branje = await preberiStanje(root);
      if (branje.pokvarjeno) {
        await new Promise((r) => setTimeout(r, 150));
        branje = await preberiStanje(root);
      }
      if (branje.pokvarjeno) {
        await ponastaviStanje(root, zdaj);
        await zapisiDnevnik(root, { opravilo: "sistem", izid: "nastavitev", razlog: "ustavi-vse" }, zdaj);
        break;
      }
      // Kill switch: od tega trenutka smeAvtonomno zavrne vse, nujni.server.ts ne obvesti in ne prevezuje, cakalna vrsta se izprazni.
      const preklicana = await spremeniStanje(root, (s) => {
        s.ustavljeno = true;
        s.ustavljenoOd = zdaj.toISOString();
        const stara = s.cakajoca.map((c) => ({ vrsta: c.vrsta, povezavaId: c.povezavaId }));
        s.cakajoca = [];
        return stara;
      });
      await zapisiDnevnik(root, { opravilo: "sistem", izid: "nastavitev", razlog: "ustavi-vse" }, zdaj);
      for (const c of preklicana) await zapisiDnevnik(root, { opravilo: c.vrsta, izid: "preklicano", razlog: "ustavljeno", povezavaId: c.povezavaId }, zdaj);
      break;
    }
    case "nadaljuj": {
      await spremeniStanje(root, (s) => {
        s.ustavljeno = false;
        s.ustavljenoOd = null;
        // Nujni klici med ustavitvijo ne smejo po »Nadaljuj« sprozit SMS za nazaj (N5): cas vklopa je zdaj.
        for (const vrsta of VRSTE_OPRAVIL) if (s.pravila[vrsta].nacin !== "izklopljeno") s.pravila[vrsta].aktivnoOd = zdaj.toISOString();
      });
      await zapisiDnevnik(root, { opravilo: "sistem", izid: "nastavitev", razlog: "nadaljuj" }, zdaj);
      break;
    }
    case "odobri": {
      const cid = id(u.id);
      // »Velja tudi za vse podobne« (samo strogo true iz seje lastnika): isto opravilo na isti povezavi (isti prejemnik in predloga);
      // nova povezava ali nov prejemnik je nov obseg in se vprasa znova. Obseg se prebere PRED odobritvijo (ta zapis odstrani).
      const c = u.podobne === true ? (await preberiStanje(root)).stanje?.cakajoca.find((x) => x.id === cid) : undefined;
      rezultat = await odobriCakajoce(root, cid, zdaj);
      if (c && rezultat.izid !== "zavrnjeno") {
        await zapisiDovoljenje(root, "avtonomija", obsegAvtonomije(c.vrsta, c.povezavaId), { kdo: "lastnik" }, zdaj);
      }
      break;
    }
    case "odkloni": {
      if (!(await odkloniCakajoce(root, id(u.id), zdaj))) throw napaka("ni-najdeno");
      break;
    }
    case "ponastavi": {
      if (!(await preberiStanje(root)).pokvarjeno) throw napaka("ponastavi-ni");
      await ponastaviStanje(root, zdaj);
      await zapisiDnevnik(root, { opravilo: "sistem", izid: "nastavitev", razlog: "ponastavi" }, zdaj);
      break;
    }
    default:
      throw napaka("ukaz");
  }
  return { ...(await javno(root, zdaj)), ...(rezultat ? { rezultat } : {}) };
}
