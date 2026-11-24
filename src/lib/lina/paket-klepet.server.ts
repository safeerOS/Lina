/**
 * Navodilo za dostavo iz klepeta ali glasu z Lino (lastnik 23. 11. 2026: »Lina, pricakujem paket, naj ga pustijo pri sosedu«).
 * OZKA pot samo za paketNavodilo/paketDo, ne splosno spreminjanje pravil (avtonomija ima sprememba-pravil se vedno med prepovedanimi).
 * Odloca koda, ne model: namero razbere razberiPaketKlepet iz BESEDILA LASTNIKA (asistentPogovor po requireOwner, brez priponk); predlog
 * se preveri z isto preverbo kot paket.ts in se shrani sele po lastnikovem »da« (ali gumbu Potrdi) v roku PAKET_PREDLOG_MS. Vsak drug
 * lastnikov izrek predlog zavrze, da »da« na drugo vprasanje ne shrani starega predloga. Preklic in prikaz brez potrditve.
 */
import { t } from "./besedila.ts";
import { loadPravila, savePravila } from "./pravila.server.ts";
import { aktivnoNavodiloPaketa, mestoPaketa, odgovorDostavljalcu, paketDoNeveljaven, razlogPaketa } from "./paket.ts";
import { readJsonFile, writeJson } from "./store.server.ts";

export const PAKET_PREDLOG_MS = 10 * 60_000;
const DATOTEKA = "paket-predlog.json";
const PAS = "Europe/Ljubljana";

export type NameraPaketa = { vrsta: "nastavi"; mesto: string; do: string } | { vrsta: "preklic" } | { vrsta: "prikaz" };
type Predlog = { mesto: string; do: string; cas: number };

/** Datum v Ljubljani (LLLL-MM-DD), po potrebi zamaknjen za dni. */
function datum(zdaj: Date, zamik = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PAS, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(zdaj.getTime() + zamik * 86_400_000));
}

/** »do 30. 11.« / »do 30. 11. 2026« -> LLLL-MM-DD (leto: tekoce ali naslednje, ce je dan ze mimo); neveljaven datum ostane, da ga zavrne preverba. */
function datumDo(d: string, m: string, l: string | undefined, zdaj: Date): string {
  const dd = d.padStart(2, "0");
  const mm = m.padStart(2, "0");
  if (l) return `${l}-${mm}-${dd}`;
  const leto = Number(datum(zdaj).slice(0, 4));
  const letos = `${leto}-${mm}-${dd}`;
  return letos < datum(zdaj) ? `${leto + 1}-${mm}-${dd}` : letos;
}

const KONTEKST = /(?:paket|pošiljk|posiljk|dostav|kurir|\bdpd\b|\bgls\b|\bdhl\b|\bups\b|pošt|post[aeio]\b)/iu;
// »naj ga (kurir) pustijo/pusti ...«, »pustite/pustijo ga ...«, »paket naj pustijo ...«, »navodilo za dostavo: ...«
const NASTAVI = /(?:\bnaj\s+(?:ga|jo|paket|pošiljko)\s+(?:\p{L}+\s+)?pust(?:ijo|i|ite)|\bpust(?:ite|ijo|i)\s+(?:naj\s+)?(?:ga|jo|paket|pošiljko)|\b(?:paket|pošiljko)\s+naj\s+pust(?:ijo|i|ite)|\bnavodilo\s+za\s+dostavo\s*:)\s+(.+)$/iu;
// Ves izrek (»Paket je prišel poškodovan, kaj naj naredim?« ni preklic).
const PREKLIC =
  /^(?:(?:prekliči|preklici|izbriši|izbrisi|odstrani|pobriši|pobrisi|izklopi)\s+(?:to\s+)?navodil\w*\s+za\s+(?:dostav\w*|paket\w*)|paket\s+je\s+(?:že\s+|ze\s+)?(?:prišel|prisel|dostavljen|tu)|ne\s+pričakujem\s+(?:več\s+|vec\s+)?(?:paketa|pošiljke))(?:,?\s+hvala)?[.!]*$/iu;
const PRIKAZ = /^(?:(?:kakšn\w*|kaksn\w*|katero|kaj)\s+(?:je\s+)?(?:moje\s+)?navodil\w*\s+za\s+dostav\w*|navodilo\s+za\s+dostavo|kje\s+naj\s+pust(?:ijo|ite|i)\s+(?:paket|pošiljko))\s*\??$/iu;
// Govorjena potrditev je redko samo »da«: »Da, prosim.«, »Ja, lahko.«, »Lina, da, shrani.«
const VLJUDNO = "(?:[,.!]?\\s*(?:prosim|shrani|lahko|hvala|seveda|kar|potrdi|please|save it))*[.!]*$";
const DA = new RegExp(`^(?:da|ja|potrdi|potrjujem|shrani|v redu|ok|yes)${VLJUDNO}`, "iu");
const NE = new RegExp(`^(?:ne|nikar|prekliči|preklici|no)(?:[,.!]?\\s*(?:hvala|ne shrani|pusti))*[.!]*$`, "iu");
/** Nagovor na zacetku (»Lina, ...«) ne spremeni namere. */
const brezNagovora = (s: string) => s.normalize("NFKC").replace(/\s+/gu, " ").trim().replace(/^lina\s*[,!:]?\s+/iu, "");

/** Namera dostave v izreku lastnika ali null. Cista koda (ura vbrizgana). */
export function razberiPaketKlepet(besedilo: string, zdaj: Date): NameraPaketa | null {
  const v = brezNagovora(besedilo);
  if (!v) return null;
  if (PREKLIC.test(v)) return { vrsta: "preklic" };
  if (PRIKAZ.test(v)) return { vrsta: "prikaz" };
  if (!KONTEKST.test(v)) return null;
  const m = NASTAVI.exec(v);
  if (!m) return null;
  let mesto = m[1]!.trim();
  let doDne = "";
  const doDatum = /\s+do\s+(\d{1,2})\.\s*(\d{1,2})\.?(?:\s*(\d{4}))?\.?\s*$/u.exec(mesto);
  if (doDatum) {
    doDne = datumDo(doDatum[1]!, doDatum[2]!, doDatum[3], zdaj);
    mesto = mesto.slice(0, doDatum.index);
  }
  // shortcut: samo »danes«/»jutri« kjerkoli v izreku; dnevi v tednu (»v petek«) niso razbrani - nadgradi, ko lastnik to zeli.
  if (!doDne && /(?:^|\s)jutri\b/iu.test(v)) doDne = datum(zdaj, 1);
  else if (!doDne && /(?:^|\s)danes\b/iu.test(v)) doDne = datum(zdaj);
  mesto = mestoPaketa(mesto.replace(/\s+(?:danes|jutri)$/iu, ""));
  return mesto ? { vrsta: "nastavi", mesto, do: doDne } : null;
}

/** »LLLL-MM-DD« -> » do d. m. llll« ali "". */
function opisDo(doDne: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(doDne);
  return m ? t("paketKlepetDo").replace("{datum}", () => `${Number(m[3])}. ${Number(m[2])}. ${m[1]}`) : "";
}

function prikaz(navodilo: string, doDne: string): string {
  return t("paketKlepetPrikaz").replace("{mesto}", () => mestoPaketa(navodilo)).replace("{do}", () => opisDo(doDne));
}

/** Zavrze cakajoci predlog (samo, ce obstaja; napaka zapisa ne podre pogovora). */
export async function zavrziPaketPredlog(root: string): Promise<void> {
  if (await readJsonFile(root, DATOTEKA).catch(() => null)) await writeJson(root, DATOTEKA, null).catch(() => undefined);
}

/**
 * Obdela izrek lastnika (klicatelj je ze preveril lastnika z requireOwner). Vrne odgovor Line ali null, ce izrek ne zadeva dostave.
 * Ce izrek ni potrditev ali nova namera, se cakajoci predlog zavrze.
 */
export async function paketKlepet(root: string, token: string | null, besedilo: string, zdaj = new Date()): Promise<string | null> {
  const predlog = await readJsonFile<Predlog>(root, DATOTEKA).catch(() => null);
  const izrek = brezNagovora(besedilo);
  if (predlog && typeof predlog.mesto === "string" && typeof predlog.cas === "number") {
    const svez = zdaj.getTime() - predlog.cas >= 0 && zdaj.getTime() - predlog.cas <= PAKET_PREDLOG_MS;
    if (svez && DA.test(izrek)) {
      await zavrziPaketPredlog(root);
      try {
        await savePravila({ paketNavodilo: predlog.mesto, paketDo: predlog.do }, token, root);
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
      const p = await loadPravila(root);
      const odg = `${t("paketKlepetShranjeno")} ${prikaz(p.paketNavodilo ?? "", p.paketDo ?? "")}`;
      return aktivnoNavodiloPaketa(p, zdaj) ? odg : `${odg} ${t("paketKlepetNeVelja")}`;
    }
    await zavrziPaketPredlog(root);
    if (svez && NE.test(izrek)) return t("paketKlepetOpusceno");
  }
  const namera = razberiPaketKlepet(izrek, zdaj);
  if (!namera) return null;
  if (namera.vrsta === "preklic") {
    // Brez shranjenega navodila: izrecen preklic pove, da ga ni; »Paket je prišel« gre naprej k obicajnemu pogovoru.
    if (!(await loadPravila(root)).paketNavodilo) return /navodil/iu.test(izrek) ? t("paketKlepetNi") : null;
    await savePravila({ paketNavodilo: "", paketDo: "" }, token, root);
    return t("paketKlepetPreklic");
  }
  if (namera.vrsta === "prikaz") {
    const p = await loadPravila(root);
    return p.paketNavodilo ? prikaz(p.paketNavodilo, p.paketDo ?? "") : t("paketKlepetNi");
  }
  const razlog = razlogPaketa(namera.mesto) ?? (paketDoNeveljaven(namera.do) ? t("paketDoNeveljaven") : null);
  if (razlog) return razlog;
  await writeJson(root, DATOTEKA, { mesto: namera.mesto, do: namera.do, cas: zdaj.getTime() } satisfies Predlog);
  return `${t("paketKlepetPredlog")
    .replace("{mesto}", () => namera.mesto)
    .replace("{do}", () => opisDo(namera.do))
    .replace("{odgovor}", () => odgovorDostavljalcu(namera.mesto))} ${t("paketKlepetVprasanje")}`;
}
