import { ADC_MANJKA, pozabiZeton, vertexAccessToken } from "./adc.server.ts";
import {
  filtrirajIzhod,
  imaNajdeneKategorije,
  ustvariStanjePsevdonimov,
  zdruziKategorije,
  type Kategorija,
} from "./izhodni-filter.ts";
import { zapisiDnevnikFiltra } from "./izhodni-filter.server.ts";
import { DEFAULT_BRAIN_MODELS, DEFAULT_VERTEX_LOCATION, type BrainProvider } from "./types.ts";
import { zabeleziOdgovor } from "./meritve.server.ts";
import { topliFetch } from "./povezave.server.ts";
import { naslovKlica, smePrekPrehoda, type PrehodNastavitve } from "./omniroute.ts";
import { prehodZaKlic } from "./omniroute.server.ts";
import { lastniOdgovor, lastniZahtevek, normirajNaslov } from "./lastni-streznik.ts";

/** Klici ponudnikov so omejeni, da obešena povezava ne drži tajnice. */
export const PROVIDER_TIMEOUT_MS = 25_000;
/** Branje priponk (video, daljsi PDF) traja dlje kot obrat pogovora; rok velja samo za klice s priponkami. */
export const PROVIDER_TIMEOUT_PRIPONKE_MS = 120_000;
/** Najvec znakov vhoda: privzeto 4000 (klici, kratek pogovor); besedilne priponke smejo vec. */
export const NAJVEC_ZNAKOV_VHODA = 100_000;

let izhodniFilterZaPreizkus: typeof filtrirajIzhod | null = null;

/** Samo za preizkuse: zamenja izhodni filter v callProvider. Brez argumenta ali z null povrne privzetega. */
export function nastaviIzhodniFilterZaPreizkus(filter: typeof filtrirajIzhod | null = null): void {
  izhodniFilterZaPreizkus = filter;
}

export type ProviderCall = {
  provider: BrainProvider;
  model: string;
  key: string;
  text: string;
  system?: string;
  maxTokens?: number;
  project?: string;
  location?: string;
  /** Naslov lastnega streznika (samo ponudnik »custom«, samo pogovor z asistentko). */
  naslov?: string;
  /** Rok klica v ms. Privzeto 25 s; obrat telefonskega pogovora ima krajsega, da klic ne molci. */
  timeoutMs?: number;
  /** Prekinitev od zunaj (npr. spekulativni klic, ki ni vec potreben). */
  signal?: AbortSignal;
  /** Zvok za prepis govora (samo Gemini in Vertex): base64 brez predpone. */
  audio?: { mime: string; data: string };
  /** Neobvezen prehod OmniRoute (privzeto izklopljen). Kljuc prehoda je locen od kljuca ponudnika. */
  prehod?: PrehodNastavitve & { kljuc: string };
  /** Zahteva nosi vsebino klica (govor, prepis, sporocilo klicatelja): prek prehoda samo z locenim soglasjem za klice. */
  vsebinaKlica?: boolean;
  /** Najvec znakov odgovora. Privzeto 500 (kratki obrati klica); daljsi pogovor in Novice zahtevajo vec, zgornja meja 6000. */
  najvecZnakov?: number;
  /** Priponke lastnika (slika, PDF, video, zvok), ze preverjene s pripraviPriponke (priponke.ts). Samo pogovor z asistentko. */
  priponke?: ReadonlyArray<{ ime: string; mime: string; podatki: string; vrsta: string }>;
  /** Najvec znakov vhoda (privzeto 4000, zgornja meja NAJVEC_ZNAKOV_VHODA). */
  najvecVhoda?: number;
};

export const PRIVZETA_MEJA_ZNAKOV = 500;
const NAJVEC_ZNAKOV = 6000;

/** Veljavna meja odgovora: celo stevilo med 1 in 6000, sicer privzeta. */
export function mejaZnakov(vrednost: number | undefined): number {
  if (typeof vrednost !== "number" || !Number.isFinite(vrednost)) return PRIVZETA_MEJA_ZNAKOV;
  return Math.min(NAJVEC_ZNAKOV, Math.max(1, Math.floor(vrednost)));
}

export type RezultatPonudnika = { ok: true; text: string; opozorilo?: string } | { ok: false; sporocilo: string };

function jeOpenRouterPrehod(input: ProviderCall, url: string): boolean {
  if (input.provider === "openrouter") return true;
  if (cleanModel(input.model, input.provider).toLowerCase().startsWith("openrouter/")) return true;
  try {
    const gostitelj = new URL(url).hostname.toLowerCase();
    return gostitelj === "openrouter.ai" || gostitelj.endsWith(".openrouter.ai");
  } catch {
    return false;
  }
}

/** Klic prek prehoda (oblika OpenAI): brez preusmeritev, rok kot pri ponudnikih. null = prehod ni uspel (razlog v opozorilo). */
async function klicPrekPrehoda(input: ProviderCall): Promise<{ text: string } | { napaka: string }> {
  const prehod = input.prehod;
  const url = prehod ? naslovKlica(prehod) : null;
  if (!prehod || !url) return { napaka: "Naslov prehoda ni veljaven." };
  try {
    const odg = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json", authorization: `Bearer ${prehod.kljuc}` },
      body: JSON.stringify({
        model: cleanModel(input.model, input.provider),
        max_tokens: input.maxTokens ?? 32,
        temperature: 0,
        messages: [...(input.system ? [{ role: "system", content: input.system }] : []), { role: "user", content: input.text.slice(0, 4000) }],
        ...(jeOpenRouterPrehod(input, url) ? { provider: { data_collection: "deny" } } : {}),
      }),
      signal: AbortSignal.timeout(Math.max(500, Math.min(PROVIDER_TIMEOUT_MS, Math.round(input.timeoutMs ?? PROVIDER_TIMEOUT_MS)))),
    });
    if (!odg.ok) return { napaka: `Prehod je zavrnil klic (${odg.status}).` };
    const surovo = await odg.text();
    let besedilo = "";
    try { besedilo = readText(JSON.parse(surovo) as Parameters<typeof readText>[0]); } catch { /* ni JSON */ }
    return besedilo ? { text: hideSecret(besedilo.slice(0, mejaZnakov(input.najvecZnakov)), prehod.kljuc) } : { napaka: "Prehod ni vrnil besedila." };
  } catch (error) {
    return { napaka: hideSecret(/redirect/i.test(String(error)) ? "Preusmeritev ni dovoljena." : "Prehod ni dosegljiv.", prehod.kljuc) };
  }
}

function cleanModel(model: string, provider: BrainProvider): string {
  const value = model.trim().slice(0, 80);
  return value || DEFAULT_BRAIN_MODELS[provider];
}

/** ID projekta ne sme spremeniti poti URL. */
export function gcpProject(value: unknown): string {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!id) return "";
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(id)) throw new Error("ID projekta Google Cloud ni veljaven.");
  return id;
}

/** Prazen vnos pomeni global. */
export function gcpLocation(value: unknown): string {
  const loc = typeof value === "string" && value.trim() ? value.trim().toLowerCase() : DEFAULT_VERTEX_LOCATION;
  if (!/^[a-z][a-z0-9-]{0,38}[a-z0-9]$/.test(loc)) throw new Error("Lokacija Google Cloud ni veljavna.");
  return loc;
}

/** Skrije ključ ali žeton, če bi se pojavil v napaki ali odgovoru. */
export function hideSecret(message: string, secret: string): string {
  if (!secret) return message;
  return message.split(secret).join("••••");
}

/**
 * Ali model sprejme thinkingConfig.thinkingLevel "minimal".
 * Izmerjeno 10. 11. 2026 na gemini-3-flash-preview (Vertex): z minimal 0 zetonov razmisleka in 2,1 s,
 * brez nastavitve 191 zetonov razmisleka za isti kratek poziv. Pravilo je namenoma ozko: samo druzina
 * Gemini 3 Flash. Gemini 3 Pro stopnje minimal nima, modeli 2.x pa poznajo thinkingBudget, ne thinkingLevel -
 * nepodprto polje bi vrnilo napako 400, zato ga drugim ne posiljamo.
 */
export function podpiraMinimalniRazmislek(model: string): boolean {
  return /^gemini-3(?:\.\d+)?-flash(?:-|$)/.test(model.trim().toLowerCase());
}

function geminiBody(input: ProviderCall, text: string, model: string): unknown {
  return {
    ...(input.system ? { systemInstruction: { parts: [{ text: input.system }] } } : {}),
    contents: [
      {
        role: "user",
        parts: [
          ...(input.audio ? [{ inlineData: { mimeType: input.audio.mime, data: input.audio.data } }] : []),
          ...(input.priponke ?? []).map((p) => ({ inlineData: { mimeType: p.mime, data: p.podatki } })),
          { text },
        ],
      },
    ],
    ...(podpiraMinimalniRazmislek(model) ? { generationConfig: { thinkingConfig: { thinkingLevel: "minimal" } } } : {}),
  };
}

/**
 * Oblika zahteve. Ključ in žeton sta v glavi, nikoli v naslovu. Samo https.
 * Gemini AI Studio ostane na generativelanguage.googleapis.com.
 * Vertex uporablja aiplatform.googleapis.com in žeton ADC.
 */
export function providerRequest(input: ProviderCall): { url: string; init: RequestInit } {
  const model = cleanModel(input.model, input.provider);
  const maxTokens = input.maxTokens ?? 32;
  const text = input.text.slice(0, Math.max(1, Math.min(NAJVEC_ZNAKOV_VHODA, input.najvecVhoda ?? 4000)));
  if (input.provider === "custom") throw new Error("Lasten strežnik ima svojo pot klica.");
  const priponke = input.priponke ?? [];
  let url = "";
  let body: unknown;
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (input.provider === "gemini") {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    headers["x-goog-api-key"] = input.key;
    body = geminiBody(input, text, model);
  } else if (input.provider === "vertex") {
    const project = gcpProject(input.project);
    if (!project) throw new Error("Vpišite ID projekta Google Cloud.");
    const location = gcpLocation(input.location);
    if (!input.key) throw new Error(ADC_MANJKA);
    // Polje thinkingLevel je izmerjeno na v1beta1 (10. 11. 2026); modeli brez njega ostanejo na v1 kot doslej.
    const razlicica = podpiraMinimalniRazmislek(model) ? "v1beta1" : "v1";
    url = `https://aiplatform.googleapis.com/${razlicica}/projects/${project}/locations/${location}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
    headers.authorization = `Bearer ${input.key}`;
    headers["x-goog-user-project"] = project;
    body = geminiBody(input, text, model);
  } else if (input.provider === "openai" || input.provider === "grok" || input.provider === "openrouter") {
    url =
      input.provider === "openai"
        ? "https://api.openai.com/v1/chat/completions"
        : input.provider === "openrouter"
          ? "https://openrouter.ai/api/v1/chat/completions"
          : "https://api.x.ai/v1/chat/completions";
    headers.authorization = `Bearer ${input.key}`;
    // Neobvezna oznaka aplikacije pri OpenRouter (brez osebnih podatkov in brez naslova uporabnika).
    if (input.provider === "openrouter") headers["X-Title"] = "Lina";
    // Slike kot data URL, PDF kot »file« (OpenAI in OpenRouter); ostale vrste zavrne ze pripraviPriponke.
    const vsebina = priponke.length
      ? [
          { type: "text", text },
          ...priponke.map((p) =>
            p.vrsta === "pdf"
              ? { type: "file", file: { filename: p.ime, file_data: `data:${p.mime};base64,${p.podatki}` } }
              : { type: "image_url", image_url: { url: `data:${p.mime};base64,${p.podatki}` } },
          ),
        ]
      : text;
    const messages = [
      ...(input.system ? [{ role: "system", content: input.system }] : []),
      { role: "user", content: vsebina },
    ];
    body = {
      model,
      max_tokens: maxTokens,
      temperature: 0,
      messages,
      ...(input.provider === "openrouter" ? { provider: { data_collection: "deny" } } : {}),
    };
  } else {
    url = "https://api.anthropic.com/v1/messages";
    headers["x-api-key"] = input.key;
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model,
      max_tokens: maxTokens,
      ...(input.system ? { system: input.system } : {}),
      messages: [
        {
          role: "user",
          content: priponke.length
            ? [
                ...priponke.map((p) =>
                  p.vrsta === "pdf"
                    ? { type: "document", source: { type: "base64", media_type: p.mime, data: p.podatki } }
                    : { type: "image", source: { type: "base64", media_type: p.mime, data: p.podatki } },
                ),
                { type: "text", text },
              ]
            : text,
        },
      ],
    };
  }

  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Klic ponudnika je dovoljen samo prek https.");
  if (input.key && parsed.href.includes(input.key)) throw new Error("Ključ ne sme biti v naslovu.");
  if (input.provider === "openrouter" && parsed.hostname !== "openrouter.ai") {
    throw new Error("OpenRouter sme klicati samo openrouter.ai.");
  }
  if (input.provider === "vertex" && parsed.hostname !== "aiplatform.googleapis.com") {
    throw new Error("Vertex sme klicati samo aiplatform.googleapis.com.");
  }
  return {
    url,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  };
}

/** Brez sledenja preusmeritvam in z omejitvijo (privzeto in najvec 25 s). */
export async function httpsFetch(url: string, init: RequestInit = {}, timeoutMs = PROVIDER_TIMEOUT_MS, zgornjaMeja = PROVIDER_TIMEOUT_MS): Promise<Response> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Klic je dovoljen samo prek https.");
  const rok = Math.max(500, Math.min(Math.min(zgornjaMeja, PROVIDER_TIMEOUT_PRIPONKE_MS), Math.round(timeoutMs)));
  const zacetek = performance.now();
  // Ogreti bazen samo za Googlove gostitelje in samo ob stikalu »toplePovezave«; sicer obicajni fetch.
  const odgovor = await topliFetch(parsed.toString(), {
    ...init,
    redirect: "error",
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(rok)]) : AbortSignal.timeout(rok),
  });
  zabeleziOdgovor(odgovor.status, performance.now() - zacetek);
  return odgovor;
}

function readText(json: {
  choices?: Array<{ message?: { content?: string } }>;
  content?: Array<{ text?: string }>;
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}): string {
  return (
    json.choices?.[0]?.message?.content ??
    json.content?.map((part) => part.text ?? "").join("") ??
    json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ??
    ""
  ).trim();
}

export async function callProvider(input: ProviderCall): Promise<RezultatPonudnika> {
  // Lastnik 21. 11. 2026: tajnica (klici) ne dobi lastnega streznika; velja samo za pogovor z asistentko (vsebinaKlica izrecno false).
  if (input.provider === "custom" && (input.vsebinaKlica !== false || input.audio)) {
    return { ok: false, sporocilo: "Lasten strežnik je dovoljen samo za pogovor z asistentko, ne za klice." };
  }
  if (input.priponke?.length && (input.provider === "custom" || input.vsebinaKlica !== false)) {
    return { ok: false, sporocilo: "Priponke so dovoljene samo v pogovoru z asistentko." };
  }
  const vsebinaKlica = input.vsebinaKlica !== false;
  let filtriranVhod: ProviderCall;
  let obnovi: (odgovor: string) => string;
  let skupneKategorije: Record<Kategorija, number>;
  try {
    const stanje = ustvariStanjePsevdonimov();
    const izidBesedila = izhodniFilterZaPreizkus
      ? izhodniFilterZaPreizkus(input.text, { vsebinaKlica, stanje })
      : filtrirajIzhod(input.text, { vsebinaKlica, stanje });
    const izidSistema =
      input.system !== undefined
        ? izhodniFilterZaPreizkus
          ? izhodniFilterZaPreizkus(input.system, { vsebinaKlica, stanje })
          : filtrirajIzhod(input.system, { vsebinaKlica, stanje })
        : null;
    filtriranVhod = {
      ...input,
      text: izidBesedila.besedilo,
      ...(izidSistema !== null ? { system: izidSistema.besedilo } : {}),
    };
    obnovi =
      izhodniFilterZaPreizkus && izidSistema !== null
        ? (odgovor: string) => izidSistema.obnovi(izidBesedila.obnovi(odgovor))
        : izidBesedila.obnovi;
    skupneKategorije = zdruziKategorije(izidBesedila.kategorije, izidSistema?.kategorije);
  } catch {
    return { ok: false, sporocilo: "Izhodni filter ni uspel." };
  }

  if (imaNajdeneKategorije(skupneKategorije)) {
    await zapisiDnevnikFiltra(skupneKategorije).catch(() => undefined);
  }

  let opozorilo: string | undefined;
  // Nastavitve prehoda iz shrambe, ce jih klicatelj ni podal. Varno privzeto: vsak klic nosi vsebino klica, razen ce klicatelj
  // izrecno poda vsebinaKlica: false (pogovor lastnika z asistentko).
  // Lasten streznik nikoli ne gre prek prehoda (tretja stran).
  const brezPrehoda = filtriranVhod.provider === "custom";
  const sPriponkami = (filtriranVhod.priponke?.length ?? 0) > 0;
  const prehod = filtriranVhod.prehod ?? (filtriranVhod.audio || sPriponkami || brezPrehoda ? undefined : await prehodZaKlic().catch(() => undefined));
  if (!filtriranVhod.audio && !sPriponkami && !brezPrehoda && smePrekPrehoda(prehod, vsebinaKlica)) {
    const izid = await klicPrekPrehoda({ ...filtriranVhod, prehod });
    if ("text" in izid) return { ok: true, text: obnovi(izid.text) };
    // Ne tiho na tretjega: vrnemo se na izbranega ponudnika in uporabniku pokazemo razlog.
    opozorilo = `${izid.napaka} Uporabljen je izbrani ponudnik.`;
  }
  const izidPonudnika = await callProviderNeposredno(filtriranVhod);
  if (!izidPonudnika.ok) return izidPonudnika;
  const obnovljeno = obnovi(izidPonudnika.text);
  return opozorilo ? { ok: true, text: obnovljeno, opozorilo } : { ok: true, text: obnovljeno };
}

/**
 * Razumljiv razlog zavrnitve OpenRouter. 401 pri neveljavnem kljucu je izmerjen 21. 11. 2026 (telo »User not found.«);
 * ostali statusi so po dokumentaciji OpenRouter (errors-and-debugging): 402 premalo dobroimetja, 429 omejitev,
 * 404 in 503 pa ob »data_collection: deny« najpogosteje pomenita, da model nima ponudnika brez zbiranja podatkov.
 */
export function razlogOpenRouter(status: number): string | null {
  if (status === 401) return "OpenRouter: ključ ni veljaven.";
  if (status === 402) return "OpenRouter: na računu ni dovolj dobroimetja.";
  if (status === 429) return "OpenRouter: preveč zahtevkov, poskusite čez trenutek.";
  if (status === 404 || status === 503) {
    return "OpenRouter: model ne obstaja ali nima ponudnika, ki ne zbira podatkov (Lina to zahteva). Izberite drug model.";
  }
  return null;
}

/** Lasten streznik: http samo na tem racunalniku ali v domacem omrezju (normirajNaslov), brez preusmeritev, rok kot pri drugih. */
async function lastniFetch(url: string, init: RequestInit, timeoutMs: number = PROVIDER_TIMEOUT_MS): Promise<Response> {
  const osnova = normirajNaslov(url.replace(/\/chat\/completions$/, ""));
  if (!osnova.ok) throw new Error(osnova.razlog);
  const rok = Math.max(500, Math.min(PROVIDER_TIMEOUT_MS, Math.round(timeoutMs)));
  return fetch(url, {
    ...init,
    redirect: "error",
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(rok)]) : AbortSignal.timeout(rok),
  });
}

async function callLastni(input: ProviderCall): Promise<RezultatPonudnika> {
  const secret = input.key;
  try {
    const naslov = normirajNaslov(input.naslov);
    if (!naslov.ok) return { ok: false, sporocilo: naslov.razlog };
    const { url, init } = lastniZahtevek({
      naslov: naslov.naslov,
      model: cleanModel(input.model, "custom"),
      key: input.key,
      text: input.text,
      ...(input.system !== undefined ? { system: input.system } : {}),
      ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
    });
    const response = await lastniFetch(url, input.signal ? { ...init, signal: input.signal } : init, input.timeoutMs);
    if (response.status >= 300 && response.status < 400) return { ok: false, sporocilo: "Preusmeritev ni dovoljena." };
    const raw = await response.text();
    if (!response.ok) return { ok: false, sporocilo: hideSecret(`Strežnik je zavrnil klic (${response.status}).`, secret) };
    const izid = lastniOdgovor(raw);
    if (!izid.ok) return { ok: false, sporocilo: hideSecret(izid.sporocilo, secret) };
    return { ok: true, text: hideSecret(izid.text.slice(0, mejaZnakov(input.najvecZnakov)), secret) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Klic strežnika ni uspel.";
    if (error instanceof Error && error.name === "TimeoutError") return { ok: false, sporocilo: "Strežnik ni odgovoril pravočasno." };
    if (/redirect/i.test(message)) return { ok: false, sporocilo: "Preusmeritev ni dovoljena." };
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(message)) {
      return { ok: false, sporocilo: "Strežnik ni dosegljiv. Preverite, ali je zagnan." };
    }
    return { ok: false, sporocilo: hideSecret(message, secret) };
  }
}

async function callProviderNeposredno(input: ProviderCall): Promise<RezultatPonudnika> {
  if (input.provider === "custom") return callLastni(input);
  let secret = input.key;
  try {
    if (input.provider === "vertex") {
      secret = await vertexAccessToken();
    }
    const { url, init } = providerRequest(input.provider === "vertex" ? { ...input, key: secret } : input);
    const zgornjaMeja = input.priponke?.length ? PROVIDER_TIMEOUT_PRIPONKE_MS : PROVIDER_TIMEOUT_MS;
    const response = await httpsFetch(url, input.signal ? { ...init, signal: input.signal } : init, input.timeoutMs, zgornjaMeja);
    if (input.provider === "vertex" && response.status === 401) pozabiZeton();
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, sporocilo: "Preusmeritev ni dovoljena." };
    }
    const raw = await response.text();
    if (!response.ok) {
      const razlog = input.provider === "openrouter" ? razlogOpenRouter(response.status) : null;
      return { ok: false, sporocilo: hideSecret(razlog ?? `Ponudnik je zavrnil klic (${response.status}).`, secret) };
    }
    let text = raw.trim();
    try {
      text = readText(JSON.parse(raw) as Parameters<typeof readText>[0]) || text;
    } catch {
      /* Kratek odgovor je lahko golo besedilo. */
    }
    return { ok: true, text: hideSecret(text.slice(0, input.audio ? 2000 : mejaZnakov(input.najvecZnakov)), secret) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Klic ponudnika ni uspel.";
    if (message === ADC_MANJKA) return { ok: false, sporocilo: ADC_MANJKA };
    if (/redirect/i.test(message)) return { ok: false, sporocilo: "Preusmeritev ni dovoljena." };
    return { ok: false, sporocilo: hideSecret(message, secret) };
  }
}
