/**
 * Samodejna izbira delujocega modela (lastnik 24. 11. 2026: »že pri api pri tem ponudniku more izbrati delujoč model«).
 * Prebere seznam modelov ponudnika (uradni naslov, https, brez preusmeritev, kljuc samo v glavi), izbere priporocenega, ki je na
 * seznamu, naredi kratek preizkusni klic in vrne SAMO model, ki je odgovoril. Vedno isti ponudnik in isti kljuc (B9).
 * Brezplacni (:free) modeli se samodejno nikoli ne izberejo (za klice so prepovedani, za asistentko zahtevajo soglasje).
 */
import { besediloZMejo, httpsFetch, omnirouteFetch, preizkusiModel, razlogVzroka, type VzrokNapake } from "./providers.ts";
import { OMNIROUTE_PRIVZETI_NASLOV, veljavenNaslovOmniroute } from "./omniroute.ts";
import { IME_PONUDNIKA, jeBrezplacenModel, PRIPOROCENI_MODELI, type BrainProvider } from "./types.ts";

/** Najvec preizkusnih klicev na izbiro (vsak stane zeton ali dva). */
export const NAJVEC_POSKUSOV = 3;
const ROK_SEZNAMA_MS = 8_000;
const ROK_PREIZKUSA_MS = 15_000;
const VELJAVEN_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,79}$/;
/** M5: najvec bajtov seznama modelov (seznam OpenRouter je velik, zato velikodusno); vecji odgovor = ni seznama. */
export const NAJVEC_BAJTOV_SEZNAMA = 8 * 1024 * 1024;

/** Druzine modelov za pogovor, ce noben priporocen ni na seznamu (seznam doloci vrstni red). */
const DRUZINA: Record<Exclude<BrainProvider, "custom">, RegExp> = {
  claude: /^claude-(sonnet|haiku|opus)-/,
  openai: /^gpt-\d/,
  grok: /^grok-\d/,
  gemini: /^gemini-\d/,
  vertex: /^gemini-\d/,
  openrouter: /^(openai\/gpt-|anthropic\/claude-|google\/gemini-)/,
  // OmniRoute: modeli so imena prehoda (npr. kr/claude-sonnet); vrstni red doloci seznam prehoda.
  omniroute: /./,
};
/** Modeli, ki niso za besedilni pogovor (glas, slika, iskanje, vdelave ...). */
export const NI_ZA_POGOVOR = /(audio|realtime|transcribe|tts|image|imagine|search|embedding|live|voice|vision|instruct|codex|native)/i;

export type IzbiraModela = { ok: true; model: string; seznam?: string[] } | { ok: false; sporocilo: string; vzrok?: VzrokNapake };

/** Uradni naslov in glave za seznam modelov; null = ponudnik seznama nima (Vertex: preizkusijo se priporoceni). */
export function zahtevaSeznama(provider: BrainProvider, key: string, naslov?: string): { url: string; headers: Record<string, string> } | null {
  if (provider === "omniroute") {
    const osnova = veljavenNaslovOmniroute(naslov ?? OMNIROUTE_PRIVZETI_NASLOV);
    return osnova ? { url: `${osnova}/models`, headers: { authorization: `Bearer ${key}` } } : null;
  }
  if (provider === "claude") return { url: "https://api.anthropic.com/v1/models?limit=100", headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } };
  if (provider === "openai") return { url: "https://api.openai.com/v1/models", headers: { authorization: `Bearer ${key}` } };
  if (provider === "grok") return { url: "https://api.x.ai/v1/models", headers: { authorization: `Bearer ${key}` } };
  // Javni seznam OpenRouter: kljuca ne posljemo (ni potreben).
  if (provider === "openrouter") return { url: "https://openrouter.ai/api/v1/models", headers: {} };
  if (provider === "gemini") return { url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", headers: { "x-goog-api-key": key } };
  return null;
}

/**
 * ID-ji iz seznama: {data:[{id}]} (Anthropic, OpenAI, xAI, OpenRouter) ali {models:[{name:"models/x"}]} (Gemini).
 * BREZ zgornje meje (OpenRouter ima vec kot 500 modelov): priporocen model za mejo bi sicer veljal za »ni na seznamu«.
 */
export function razberiSeznam(provider: BrainProvider, json: unknown): string[] {
  if (provider !== "gemini") {
    const data = (json as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) return [];
    return [...new Set((data as Array<{ id?: unknown }>).map((m) => (typeof m?.id === "string" ? m.id : "")).filter((id) => VELJAVEN_MODEL.test(id)))];
  }
  const modeli = (json as { models?: unknown } | null)?.models;
  if (!Array.isArray(modeli)) return [];
  const izid: string[] = [];
  for (const m of modeli as Array<{ name?: unknown; supportedGenerationMethods?: unknown }>) {
    const ime = typeof m?.name === "string" ? m.name.replace(/^models\//, "") : "";
    const metode = Array.isArray(m?.supportedGenerationMethods) ? m.supportedGenerationMethods : ["generateContent"];
    if (VELJAVEN_MODEL.test(ime) && metode.includes("generateContent")) izid.push(ime);
  }
  return izid;
}

/** Seznam modelov ponudnika; null = ni na voljo (napaka, ni seznama) - takrat se preizkusijo priporoceni. */
export async function seznamModelov(provider: BrainProvider, key: string, f?: typeof httpsFetch, naslov?: string): Promise<string[] | null> {
  const z = zahtevaSeznama(provider, key, naslov);
  f ??= provider === "omniroute" ? omnirouteFetch : httpsFetch;
  if (!z) return null;
  try {
    const odg = await f(z.url, { method: "GET", headers: z.headers }, ROK_SEZNAMA_MS, ROK_SEZNAMA_MS);
    if (!odg.ok) return null;
    const ids = razberiSeznam(provider, JSON.parse(await besediloZMejo(odg, NAJVEC_BAJTOV_SEZNAMA)) as unknown);
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

/** Predpona izdelovalca modela pri prehodih (»anthropic/claude-x« -> »anthropic/«); null = ime brez predpone. */
export function izdelovalecModela(model: string): string | null {
  const i = model.indexOf("/");
  return i > 0 ? model.slice(0, i + 1) : null;
}

/**
 * Kandidati po vrstnem redu priporocil; brez seznama samo priporoceni. Brez brezplacnih, brez izkljucenih, najvec NAJVEC_POSKUSOV.
 * istiIzdelovalecKot (samo zamenjava med delovanjem, slepi pregled M1/M2): pri OpenRouter in OmniRoute samo modeli z ISTO predpono
 * izdelovalca kot zavrnjeni model (vsebina ne gre samodejno k drugemu izdelovalcu ali ponudniku prehoda; »auto« zato nikoli).
 * Zavrnjeni model brez predpone: ni kandidatov (fail-closed).
 */
export function kandidati(
  provider: Exclude<BrainProvider, "custom">,
  seznam: string[] | null,
  izkljuci: readonly string[] = [],
  istiIzdelovalecKot?: string,
): string[] {
  const prehod = provider === "openrouter" || provider === "omniroute";
  const predpona = prehod && istiIzdelovalecKot !== undefined ? izdelovalecModela(istiIzdelovalecKot) : undefined;
  if (predpona === null) return [];
  const priporoceni = PRIPOROCENI_MODELI[provider];
  // OmniRoute: »auto« (izbira prehoda) je vedno prvi, tudi ce ga seznam ne navaja.
  const izSeznama = seznam && provider !== "omniroute" ? priporoceni.filter((m) => seznam.includes(m)) : [...priporoceni];
  const rezerva = seznam ? seznam.filter((m) => DRUZINA[provider].test(m) && !NI_ZA_POGOVOR.test(m)) : [];
  return [...new Set([...izSeznama, ...rezerva])]
    .filter((m) => VELJAVEN_MODEL.test(m) && !jeBrezplacenModel(m) && !izkljuci.includes(m))
    .filter((m) => predpona === undefined || m.startsWith(predpona))
    .slice(0, NAJVEC_POSKUSOV);
}

/**
 * Izbere model, ki je na preizkusni klic res odgovoril. Napaka kljuca, dobroimetja ali omejitve ustavi iskanje in vrne pravi vzrok
 * (nikoli »model ne obstaja«). vzrok ni nastavljen, ce ponudnik ni dosegljiv (omrezje) - klicatelj se odloci sam.
 */
export async function izberiDelujocModel(o: {
  provider: BrainProvider;
  key: string;
  project?: string;
  location?: string;
  /** Naslov prehoda (samo »omniroute«). */
  naslov?: string;
  zaKlice: boolean;
  izkljuci?: readonly string[];
  /** Zamenjava med delovanjem: samo model istega izdelovalca kot ta (OpenRouter, OmniRoute). */
  istiIzdelovalecKot?: string;
}): Promise<IzbiraModela> {
  if (o.provider === "custom") return { ok: false, sporocilo: "Lasten strežnik nima samodejne izbire modela." };
  const provider = o.provider;
  const seznam = await seznamModelov(provider, o.key, undefined, o.naslov);
  const izbor = kandidati(provider, seznam, o.izkljuci ?? [], o.istiIzdelovalecKot);
  for (const model of izbor) {
    const r = await preizkusiModel({
      provider,
      model,
      key: o.key,
      ...(o.project !== undefined ? { project: o.project } : {}),
      ...(o.location !== undefined ? { location: o.location } : {}),
      ...(o.naslov !== undefined ? { naslov: o.naslov } : {}),
      text: "Odgovori samo z besedo: da.",
      maxTokens: 8,
      vsebinaKlica: o.zaKlice,
      timeoutMs: ROK_PREIZKUSA_MS,
    });
    if (r.ok) return { ok: true, model, ...(seznam ? { seznam } : {}) };
    if (r.vzrok === "model") continue;
    if (r.vzrok) return { ok: false, sporocilo: razlogVzroka(provider, r.vzrok), vzrok: r.vzrok };
    return { ok: false, sporocilo: r.sporocilo };
  }
  return {
    ok: false,
    sporocilo: `${IME_PONUDNIKA[provider]}: noben preizkušen model ni odgovoril; preverite račun pri ponudniku.`,
    vzrok: "model",
  };
}
