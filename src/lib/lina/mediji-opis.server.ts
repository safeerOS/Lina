/**
 * Priprava opisa za generator slik in videa (lastnik 22. 11. 2026: »imager pa more razumeti slovenscino, ce jo za govor preko telefona
 * razume«). Imagen in Veo slovenscine uradno ne podpirata (dokumentacija Vertex nastavi le anglescino in nekaj predogledanih jezikov),
 * zato Google (Translation LLM in klasicni prevajalnik) v LASTNIKOVEM projektu opis najprej prevede v angleski poziv. Uporabnik pise
 * slovensko, v knjiznici ostaneta oba (opis in poziv). B9 (lastnik 26. 11. 2026, »Se strinjam z tvojimi predlogi«): ce prevod prek
 * Googla ne uspe, opis ne gre nobenemu drugemu ponudniku (ne mozganom asistentke) in slika/video se ne ustvari (generator vrze).
 * Izid prevajalnika je NEZAUPANJA vreden: ena vrstica, brez oznak, dolzinska meja. Komentarji brez sumnikov.
 */

/** Meja poziva: opis ima najvec 2000 znakov (NAJVEC_ZNAKOV_OPISA), prevod je lahko nekoliko daljsi - ne sme pasti zaradi meje. */
export const NAJVEC_ZNAKOV_POZIVA = 2400;
export const ROK_PREVODA_MS = 15_000;
/** Odgovor prevajalnika Google: en prevod do NAJVEC_ZNAKOV_POZIVA, ovoj JSON je majhen. */
export const NAJVEC_BAJTOV_PREVODA = 64 * 1024;

/** Telo odgovora po kosih z mejo znakov (UTF-8 bajti): pokvarjen ali zlonameren odgovor ne napolni pomnilnika procesa. */
export async function teloZMejo(odg: Response, meja: number, sporocilo: string): Promise<string> {
  if (!odg.body) return "";
  const kosi: Buffer[] = [];
  let n = 0;
  for await (const k of odg.body as unknown as AsyncIterable<Uint8Array>) {
    n += k.byteLength;
    if (n > meja) {
      await odg.body.cancel().catch(() => undefined);
      throw new Error(sporocilo);
    }
    kosi.push(Buffer.from(k));
  }
  return Buffer.concat(kosi).toString("utf8");
}

/**
 * namig: drugi prepis istega GOVORJENEGA opisa iz lokalnega slovenskega modela RSDO (lastnik 22. 11. 2026: »svetovalec za slovenscino
 * ... ga lahko vprasa za dodatno mnenje«). Nezaupan podatek (ocistiNamig), samo za pomoc pri razumevanju; brez njega velja opis.
 */
export type Prevajalnik = (opis: string, root: string, namig?: string) => Promise<string | null>;

/** Ocisti izid modela: ena vrstica, brez narekovajev okrog, brez oznak markdown, dolzinska meja. Prazno ali sumljivo = null. */
export function ocistiPoziv(surovo: unknown): string | null {
  if (typeof surovo !== "string") return null;
  let s = surovo.replace(/```[a-z]*|```/gi, " ").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  const brezNarekovajev = (x: string) => x.replace(/^["'“”„»«]+|["'“”„»«]+$/g, "").trim();
  s = brezNarekovajev(brezNarekovajev(s).replace(/^(prompt|poziv)\s*:\s*/i, ""));
  if (!s || s.length > NAJVEC_ZNAKOV_POZIVA) return null;
  return s;
}

/**
 * Rezerva (lastnik 22. 11. 2026: »ima pa google tudi razvit prevajalec«): Google Cloud Translation v3 prek ISTEGA projekta in zetona
 * Vertex (brez novega racuna). Edini prevajalnik opisa (B9, 26. 11. 2026). NEPREVERJENO: ali je API v projektu omogocen.
 */
/**
 * model "llm" (lastnik 22. 11. 2026): Googlov prevajalski LLM (Translation LLM, general/translation-llm, na tehnologiji Gemini) - prvi v verigi;
 * "nmt" = klasicni Googlov prevajalnik kot zadnja rezerva. NEPREVERJENO: razpolozljivost TLLM v regiji us-central1 za projekt.
 */
export function googlePrevajalnik(projekt: string, moznosti: { fetch?: typeof fetch; zeton?: () => Promise<string>; model?: "llm" | "nmt" } = {}): Prevajalnik {
  return async (opis) => {
    if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projekt)) return null;
    try {
      const { vertexAccessToken } = await import("./adc.server.ts");
      const zeton = await (moznosti.zeton ?? (() => vertexAccessToken()))();
      const llm = moznosti.model === "llm";
      // Dokumentacija TLLM (docs.cloud.google.com/translate/docs/translation-llm, preverjeno 22. 11. 2026): URL brez locations,
      // regija samo v polju model; glava x-goog-user-project doloci projekt za kvoto in obracun.
      const odg = await (moznosti.fetch ?? fetch)(`https://translation.googleapis.com/v3/projects/${projekt}:translateText`, {
        method: "POST",
        redirect: "error",
        headers: { authorization: `Bearer ${zeton}`, "x-goog-user-project": projekt, "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ contents: [opis], mimeType: "text/plain", sourceLanguageCode: "sl", targetLanguageCode: "en", ...(llm ? { model: `projects/${projekt}/locations/us-central1/models/general/translation-llm` } : {}) }),
        signal: AbortSignal.timeout(ROK_PREVODA_MS),
      });
      if (!odg.ok) return null;
      const j = JSON.parse(await teloZMejo(odg, NAJVEC_BAJTOV_PREVODA, "Odgovor prevajalnika je prevelik.")) as { translations?: Array<{ translatedText?: unknown }> };
      return ocistiPoziv(j.translations?.[0]?.translatedText);
    } catch {
      return null;
    }
  };
}

/** Veriga prevajalnikov: prvi, ki vrne veljaven poziv, zmaga. */
export function verigaPrevajalnikov(...cleni: Prevajalnik[]): Prevajalnik {
  return async (opis, root, namig) => {
    for (const p of cleni) {
      try {
        const r = ocistiPoziv(await p(opis, root, namig));
        if (r) return r;
      } catch {
        // naslednji clen
      }
    }
    return null;
  };
}

/**
 * Zahtevnost opisa (lastnik 22. 11. 2026: »Lina naj razume, ali gre za tezji stavek ali lazji; ce je lazji, uporabimo klasicni Google
 * Translate«). Lazji: kratek (do 12 besed), en stavek, brez odvisnikov, narekovajev (besedilo na sliki) in stevilk. Vse drugo je tezje
 * in gre najprej skozi Translation LLM. Hevristika je merljiva in ponovljiva; meje so ocena (NEPREVERJENO na pravih opisih).
 */
export const MEJA_BESED_LAZJI = 12;
const VEZNIKI_ODVISNIKOV = /\b(ki|ker|ko|ce|da|kot|ceprav|vendar|ampak|toda|medtem|kjer|kamor|dokler|preden|zato|ali|oziroma|kateri\w*|kater\w*)\b/;

export function jeLazjiOpis(opis: string): boolean {
  const besedilo = opis.trim();
  const zlozeno = besedilo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const besede = zlozeno.split(/[^\p{L}\d]+/u).filter(Boolean);
  if (besede.length === 0 || besede.length > MEJA_BESED_LAZJI) return false;
  if ((besedilo.match(/[.!?;:](\s|$)/g) ?? []).length > 1) return false;
  if (/["'“”„»«]/.test(besedilo) || /\d/.test(besedilo)) return false;
  if ((besedilo.match(/,/g) ?? []).length > 1) return false;
  return !VEZNIKI_ODVISNIKOV.test(zlozeno);
}

/**
 * Veriga po zahtevnosti, SAMO Google v lastnikovem projektu (B9, lastnik 26. 11. 2026: mozgani asistentke niso vec clen - tudi ne v
 * Medijih): lazji -> klasicni, nato TLLM; tezji -> TLLM, nato klasicni.
 */
export function prevajalnikPoZahtevnosti(projekt: string, moznosti: { fetch?: typeof fetch; zeton?: () => Promise<string> } = {}): Prevajalnik {
  const nmt = googlePrevajalnik(projekt, { ...moznosti, model: "nmt" });
  const llm = googlePrevajalnik(projekt, { ...moznosti, model: "llm" });
  return async (opis, root, namig) => (jeLazjiOpis(opis) ? verigaPrevajalnikov(nmt, llm) : verigaPrevajalnikov(llm, nmt))(opis, root, namig);
}

/** Opis -> poziv. Vrne poziv in ali je bil preveden (neprevedenega generator ne poslje: B9, glava). */
export async function pripraviPoziv(opis: string, root: string, prevedi: Prevajalnik, namig?: string): Promise<{ poziv: string; prevedeno: boolean }> {
  let preveden: string | null = null;
  try {
    preveden = ocistiPoziv(await prevedi(opis, root, namig));
  } catch {
    preveden = null;
  }
  return preveden ? { poziv: preveden, prevedeno: true } : { poziv: opis, prevedeno: false };
}
