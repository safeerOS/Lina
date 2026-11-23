/**
 * Model za stavek narocila (G4f). Isti model in ista prijava kot pri polishReply (activeBrain/callProvider): brez novih
 * kljucev ali ponudnikov. Izhod gre skozi varovala (narocilo-stavek.ts); ob kakrsnikoli napaki ostane oblika B iz G4e.
 */
import { activeBrain } from "./keys.server.ts";
import { llmOn } from "./llm.server.ts";
import { hideSecret, callProvider } from "./providers.ts";
import { najdiStavekNarocila, NAJVECJA_KOLICINA, kljucStavka, sklanjanjeMozno, preveriStavekNarocila, shraniStavekNarocila, type VhodStavka } from "./narocilo-stavek.ts";
import { imaPodatek } from "./povzetek.ts";
import type { CallSession } from "./types.ts";

/** Rok modela: priprava je v ozadju, a dolga naj ne bo (meritev v porocilu G4f). */
export const ROK_STAVKA_MS = 5_000;

export const NAVODILO_STAVKA =
  "Si slovnicar za govorjeno slovenscino. Vrni SAMO en stavek, brez narekovajev, oznak, razlage in alternativ. " +
  "Oblika: Naročate <število z BESEDO> <izdelek> iz materiala <material>. " +
  "Pravila: 1) Stavek se začne z »Naročate« in konča s piko. " +
  "2) Količino napiši z besedo, nikoli s števko, v pravem spolu (en, ena, eno; dva, dve) in samostalnik v tožilniku pravega števila " +
  "(ednina, dvojina, množina), npr. ena miza, dve mizi, tri mize, pet miz, ena in dvajset miz, dva stola, dve nalepki, pet nalepk. " +
  "3) Če izdelek izgleda kot lastno ime ali blagovna znamka (napisan z veliko začetnico, npr. Alba), ga NE sklanjaj in ne spreminjaj: " +
  "»Naročate izdelek Alba iz materiala hrast, v količini dva.« (količina z besedo; ob vrstici »lastno ime: da« to velja vedno). " +
  "4) Materiala ne sklanjaj in ne spreminjaj; če materiala ni, izpusti »iz materiala«. " +
  "5) Množinski samostalniki (škarje, hlače, očala, vrata, pljuča, vilice): zbirni števnik, npr. »Naročate dvoje škarje iz materiala nerjaveče jeklo.«, " +
  "»troje hlače«, ne »dve škarji«. " +
  "6) Snovni samostalniki, ki se ne štejejo (moka, olje, voda, sol, sadje): vrni samo besedo NI. " +
  "7) Dvojina po spolu: srednji »dve jabolki« (ne »dva jabolka«), ženski »dve hruški« (ne »dve hruške«), moški »dva stola«; od pet naprej rodilnik množine (pet miz). " +
  "8) Ne dodaj nobenega drugega podatka (rok, ime, cena, telefon). Vhod so vrstice: izdelek, količina, material (in po potrebi »lastno ime: da«).";

export type ModelStavka = (sistem: string, besedilo: string) => Promise<string>;
let modelZaPreizkus: ModelStavka | null = null;

/** Samo za preizkuse: lazni model namesto prave poti. */
export function nastaviModelStavkaZaPreizkus(model: ModelStavka | null): void {
  modelZaPreizkus = model;
}

async function pravModel(sistem: string, besedilo: string, dir?: string): Promise<string> {
  if (!llmOn()) return "";
  const brain = await activeBrain(dir);
  if (!brain) return "";
  const rezultat = await callProvider({ ...brain, text: besedilo, system: sistem, maxTokens: 120, timeoutMs: ROK_STAVKA_MS });
  return rezultat.ok ? hideSecret(rezultat.text, brain.key) : "";
}

/** Zavrnjeni in v teku: isti podatki ne sprozijo drugega klica modela (stevilo klicev modela na klic ostane majhno). */
const zavrnjeni = new Set<string>();
const vTeku = new Map<string, Promise<string>>();

export function pocistiZavrnjeneStavke(): void {
  zavrnjeni.clear();
  vTeku.clear();
}

/** Vhod stavka iz klica; null, ce stavek brez sklanjanja ni potreben ali mozen (brez kolicine ali izdelka). */
export function vhodStavka(call: CallSession): VhodStavka | null {
  const o = call.order;
  const izdelek = o.productName ?? o.requestedProduct;
  if (!imaPodatek(izdelek)) return null;
  const kolicina = o.quantity;
  if (typeof kolicina !== "number" || !Number.isInteger(kolicina) || kolicina < 1 || kolicina > NAJVECJA_KOLICINA) return null;
  if (!sklanjanjeMozno(izdelek, kolicina)) return null;
  const material = o.materialName ?? o.requestedMaterial;
  return { izdelek: izdelek.trim(), material: imaPodatek(material) ? material.trim() : "", kolicina };
}

/**
 * Pripravi stavek vnaprej (predpriprava, ko so izdelek, kolicina in material znani). Rok v model ne gre: dodamo ga
 * sami (govorjenRok), da model ne more popaciti dneva ali datuma. Vrne razlog; napake ne mece.
 */
export async function pripraviStavekNarocila(call: CallSession, dir?: string): Promise<string> {
  const vhod = vhodStavka(call);
  if (!vhod) return "preskoceno";
  // Stikalo za meritev (izmenicni A/B) in za nujen izklop: LINA_STAVEK_MODEL=0 -> vedno oblika B.
  if (process.env.LINA_STAVEK_MODEL === "0") return "izklopljeno";
  const kljuc = kljucStavka(vhod);
  if (najdiStavekNarocila(vhod)) return "ze pripravljen";
  if (zavrnjeni.has(kljuc)) return "zavrnjen";
  const tekoc = vTeku.get(kljuc);
  if (tekoc) return tekoc;
  const delo = (async () => {
    let izhod = "";
    try {
      // Z veliko zacetnico (npr. Alba iz kataloga) je lastno ime: namig modelu; odlocitev varoval je neodvisna od njega.
      const lastno = /^\p{Lu}/u.test(vhod.izdelek) ? "\nlastno ime: da" : "";
      const besedilo = `izdelek: ${vhod.izdelek}\nkolicina: ${vhod.kolicina}\nmaterial: ${vhod.material || "(ni)"}${lastno}`;
      izhod = modelZaPreizkus ? await modelZaPreizkus(NAVODILO_STAVKA, besedilo) : await pravModel(NAVODILO_STAVKA, besedilo, dir);
    } catch {
      izhod = "";
    }
    const ime = call.stik?.ime ?? "";
    const preverba = preveriStavekNarocila(izhod, vhod, [ime, call.order.customerName ?? "", call.order.podjetjeKlicatelja ?? ""]);
    if (!preverba.ok) {
      zavrnjeni.add(kljuc);
      return `zavrnjen: ${preverba.razlog}`;
    }
    shraniStavekNarocila(vhod, preverba.stavek);
    return "uporabljen";
  })().finally(() => vTeku.delete(kljuc));
  vTeku.set(kljuc, delo);
  return delo;
}
