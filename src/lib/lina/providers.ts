import { createHash, randomUUID } from "node:crypto";
import { ADC_MANJKA, pozabiZeton, vertexAccessToken } from "./adc.server.ts";
import {
  filtrirajIzhod,
  imaNajdeneKategorije,
  ustvariStanjePsevdonimov,
  zdruziKategorije,
  type Kategorija,
} from "./izhodni-filter.ts";
import { zapisiDnevnikFiltra } from "./izhodni-filter.server.ts";
import { BREZPLACNI_SAMO_ASISTENTKA, DEFAULT_BRAIN_MODELS, DEFAULT_VERTEX_LOCATION, IME_PONUDNIKA, jeBrezplacenModel, jeTocnoBrezplacen, type BrainProvider } from "./types.ts";
import { zabeleziOdgovor } from "./meritve.server.ts";
import { topliFetch } from "./povezave.server.ts";
import { naslovKlica, OMNIROUTE_PRIVZETI_NASLOV, smePrekPrehoda, veljavenNaslovOmniroute, veljavenNaslovPrehoda, type PrehodNastavitve } from "./omniroute.ts";
import { prehodZaKlic } from "./omniroute.server.ts";
import { lastniOdgovor, lastniZahtevek, normirajNaslov } from "./lastni-streznik.ts";
import {
  pocistiPorabo,
  posnetekPorabe,
  razberiPorabo,
  razberiPoraboIzBesedila,
  zabeleziPorabo,
  type PorabaZetonov,
  type PosnetekPorabe,
  type ZapisPorabe,
} from "./poraba-modelov.ts";

export { pocistiPorabo, posnetekPorabe, razberiPorabo, type PorabaZetonov, type PosnetekPorabe, type ZapisPorabe };

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
  /** Naslov lastnega streznika (»custom«, samo pogovor z asistentko) ali prehoda OmniRoute (»omniroute«; brez njega shranjeni). */
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
  /** Stikalo »brezplacni modeli (samo asistentka)« (pogovorBrain). Deny izpade SAMO z vsebinaKlica === false in modelom :free. */
  brezplacniDovoljeni?: boolean;
  /** C6: brezplacni model OpenRouter, ki enkrat odgovori, ce placljiv vrne 402 (samo asistentka, samo s stikalom). */
  rezervniBrezplacni?: string;
  /** Brez samodejne zamenjave modela (preizkusni klic, preverba kljuca): napaka »model ni na voljo« se samo vrne. */
  brezZamenjave?: boolean;
  /** Naloga 9 V11: vsebina ni pogovor lastnika (npr. izid orkestratorja) - deny tudi za :free s stikalom (izjema B2 ne velja). */
  vednoDeny?: boolean;
};

export const PRIVZETA_MEJA_ZNAKOV = 500;
const NAJVEC_ZNAKOV = 6000;

/** M5 (slepi pregled mozganov): najvec bajtov odgovora ponudnika ali prehoda; vecji odgovor se prekine (pomnilnik streznika). */
export const NAJVEC_BAJTOV_ODGOVORA = 2 * 1024 * 1024;

/** Telo odgovora kot besedilo, najvec `meja` bajtov; vecje telo prekine branje in vrze napako. */
export async function besediloZMejo(odg: Response, meja: number): Promise<string> {
  const dolzina = Number(odg.headers?.get("content-length") ?? NaN);
  if (Number.isFinite(dolzina) && dolzina > meja) {
    await odg.body?.cancel().catch(() => undefined);
    throw new Error("Odgovor ponudnika je prevelik.");
  }
  if (!odg.body) {
    const besedilo = await odg.text();
    if (Buffer.byteLength(besedilo) > meja) throw new Error("Odgovor ponudnika je prevelik.");
    return besedilo;
  }
  const bralnik = odg.body.getReader();
  const kosi: Uint8Array[] = [];
  let skupaj = 0;
  for (;;) {
    const { done, value } = await bralnik.read();
    if (done) break;
    skupaj += value.byteLength;
    if (skupaj > meja) {
      await bralnik.cancel().catch(() => undefined);
      throw new Error("Odgovor ponudnika je prevelik.");
    }
    kosi.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(kosi));
}

/** Veljavna meja odgovora: celo stevilo med 1 in 6000, sicer privzeta. */
export function mejaZnakov(vrednost: number | undefined): number {
  if (typeof vrednost !== "number" || !Number.isFinite(vrednost)) return PRIVZETA_MEJA_ZNAKOV;
  return Math.min(NAJVEC_ZNAKOV, Math.max(1, Math.floor(vrednost)));
}

/** povratek (C6): odgovoril je rezervni brezplacni model istega ponudnika - uporabnik mora to izvedeti. */
export type RezultatPonudnika =
  | { ok: true; text: string; opozorilo?: string; povratek?: string }
  | { ok: false; sporocilo: string; vzrok?: VzrokNapake };

/** Pravi vzrok zavrnitve ponudnika (lastnik 24. 11. 2026: uporabnik mora izvedeti pravi vzrok, ne »model: <ime>«). */
export type VzrokNapake = "model" | "kljuc" | "dobroimetje" | "omejitev";

/**
 * Vzrok iz statusa IN telesa napake (nikoli samo iz 404: pri OpenRouter in Vertex 404 pomeni tudi drugo).
 * Oblike: Anthropic {error:{type:"not_found_error",message:"model: x"}}, OpenAI {error:{code:"model_not_found"}},
 * Google {error:{status:"NOT_FOUND"}}, OpenRouter/xAI sporocilo o neveljavnem modelu.
 */
export function vzrokNapake(status: number, surovo: string): VzrokNapake | null {
  let e: Record<string, unknown> = {};
  try {
    const j = JSON.parse(surovo) as unknown;
    const x = (Array.isArray(j) ? (j[0] as { error?: unknown } | undefined)?.error : (j as { error?: unknown } | null)?.error) ?? null;
    if (typeof x === "string") e = { message: x };
    else if (x && typeof x === "object") e = x as Record<string, unknown>;
  } catch {
    /* telo ni JSON */
  }
  const niz = (v: unknown): string => (typeof v === "string" ? v : "");
  const tip = niz(e.type);
  const koda = niz(e.code);
  const sporocilo = niz(e.message).slice(0, 500);
  if (status === 401 || status === 403) return "kljuc";
  if (status === 402 || koda === "insufficient_quota" || /credit balance|insufficient (credit|fund|balance)|billing/i.test(sporocilo)) return "dobroimetje";
  if (status === 429) return "omejitev";
  if (status !== 400 && status !== 404) return null;
  if (tip === "not_found_error" || koda === "model_not_found") return "model";
  if (status === 404 && niz(e.status) === "NOT_FOUND") return "model";
  // Ozko: napaka parametra (»'max_tokens' is not supported with this model«) NI »model ne obstaja«.
  if (/not a valid model|invalid model|model\b[^\n]{0,80}\b(does not exist|not found|no longer available|has been retired)|(does not exist|not found)[^\n]{0,40}\bmodel/i.test(sporocilo)) {
    return "model";
  }
  return null;
}

/** Razumljivo besedilo za vzrok (brez imena modela iz telesa napake). */
export function razlogVzroka(provider: BrainProvider, vzrok: VzrokNapake): string {
  const ime = IME_PONUDNIKA[provider];
  if (vzrok === "kljuc") return `${ime}: ključ ni veljaven ali nima dovoljenja.`;
  if (vzrok === "dobroimetje") return `${ime}: na računu ni dobroimetja.`;
  if (vzrok === "omejitev") return `${ime}: dosežena omejitev zahtevkov, poskusite čez trenutek.`;
  return `${ime}: izbrani model ni na voljo; ob shranjevanju ključa Lina sama izbere delujočega.`;
}

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
    const surovo = await besediloZMejo(odg, NAJVEC_BAJTOV_ODGOVORA);
    let besedilo = "";
    try {
      const parsed = JSON.parse(surovo) as Parameters<typeof readText>[0];
      besedilo = readText(parsed);
      zabeleziPorabo(input.provider, cleanModel(input.model, input.provider), razberiPorabo(parsed), "pogovor");
    } catch { /* ni JSON */ }
    return besedilo ? { text: hideSecret(besedilo.slice(0, mejaZnakov(input.najvecZnakov)), prehod.kljuc) } : { napaka: "Prehod ni vrnil besedila." };
  } catch (error) {
    const besedilo = String(error);
    return { napaka: hideSecret(/redirect/i.test(besedilo) ? "Preusmeritev ni dovoljena." : /prevelik/.test(besedilo) ? "Odgovor prehoda je prevelik." : "Prehod ni dosegljiv.", prehod.kljuc) };
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
  } else if (input.provider === "openai" || input.provider === "grok" || input.provider === "openrouter" || input.provider === "omniroute") {
    const omniroute = input.provider === "omniroute" ? veljavenNaslovOmniroute(input.naslov ?? OMNIROUTE_PRIVZETI_NASLOV) : null;
    if (input.provider === "omniroute" && !omniroute) throw new Error("Naslov OmniRoute ni veljaven: http samo za 127.0.0.1 ali localhost, sicer https.");
    url = omniroute
      ? `${omniroute}/chat/completions`
      : input.provider === "openai"
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
      ...(input.provider === "openrouter" && !smeBrezDeny(input, model) ? { provider: { data_collection: "deny" } } : {}),
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
  // OmniRoute: http samo na zanki (preverjeno z veljavenNaslovOmniroute zgoraj); vsi ostali samo https.
  if (parsed.protocol !== "https:" && input.provider !== "omniroute") throw new Error("Klic ponudnika je dovoljen samo prek https.");
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

/**
 * Klic prehoda OmniRoute: http samo na 127.0.0.1/localhost (sicer https), brez preusmeritev, z istim rokom kot httpsFetch.
 * Brez toplega bazena (ta je samo za Googlove gostitelje).
 */
export async function omnirouteFetch(url: string, init: RequestInit = {}, timeoutMs = PROVIDER_TIMEOUT_MS, zgornjaMeja = PROVIDER_TIMEOUT_MS): Promise<Response> {
  if (!veljavenNaslovOmniroute(url)) throw new Error("Naslov OmniRoute ni veljaven: http samo za 127.0.0.1 ali localhost, sicer https.");
  const rok = Math.max(500, Math.min(Math.min(zgornjaMeja, PROVIDER_TIMEOUT_PRIPONKE_MS), Math.round(timeoutMs)));
  const zacetek = performance.now();
  const odgovor = await fetch(url, {
    ...init,
    redirect: "error",
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(rok)]) : AbortSignal.timeout(rok),
  });
  zabeleziOdgovor(odgovor.status, performance.now() - zacetek);
  return odgovor;
}

/** Naslov OmniRoute za klic: iz vhoda, sicer shranjen (klicatelji activeBrain ga ne podajo vsi), sicer privzeti. */
async function zNaslovomOmniroute(input: ProviderCall): Promise<ProviderCall> {
  if (input.provider !== "omniroute" || input.naslov) return input;
  const { naslovOmniroute } = await import("./keys.server.ts");
  return { ...input, naslov: (await naslovOmniroute().catch(() => null)) ?? OMNIROUTE_PRIVZETI_NASLOV };
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

/** B2: deny izpade samo, ce so izpolnjeni VSI pogoji: OpenRouter, stikalo, izrecno pogovor z asistentko, tocen brezplacen model. */
function smeBrezDeny(input: ProviderCall, model: string): boolean {
  return input.provider === "openrouter" && input.brezplacniDovoljeni === true && input.vsebinaKlica === false && !input.audio && input.vednoDeny !== true && jeTocnoBrezplacen(model);
}

export async function callProvider(input: ProviderCall): Promise<RezultatPonudnika> {
  const modelKlica = cleanModel(input.model, input.provider);
  // B3 (lastnik 24. 11. 2026): brezplacen model (lahko uci na pozivih) nikoli ne dobi vsebine klica, ne glede na ponudnika ali prehod.
  if (jeBrezplacenModel(modelKlica) && (input.vsebinaKlica !== false || input.audio)) {
    return { ok: false, sporocilo: BREZPLACNI_SAMO_ASISTENTKA };
  }
  // Brez stikala brezplacni model ne gre v omrezje, tudi ko vsebinaKlica === false.
  if (jeBrezplacenModel(modelKlica) && input.brezplacniDovoljeni !== true) {
    return { ok: false, sporocilo: "OpenRouter: vklopite stikalo za brezplačne modele." };
  }
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
  // OmniRoute kot ponudnik je ze prehod: ne gre se enkrat prek prehoda.
  const brezPrehoda = filtriranVhod.provider === "custom" || filtriranVhod.provider === "omniroute";
  const sPriponkami = (filtriranVhod.priponke?.length ?? 0) > 0;
  const prehod = filtriranVhod.prehod ?? (filtriranVhod.audio || sPriponkami || brezPrehoda ? undefined : await prehodZaKlic().catch(() => undefined));
  if (!filtriranVhod.audio && !sPriponkami && !brezPrehoda && smePrekPrehoda(prehod, vsebinaKlica)) {
    const izid = await klicPrekPrehoda({ ...filtriranVhod, prehod });
    if ("text" in izid) return { ok: true, text: obnovi(izid.text) };
    // Ne tiho na tretjega: vrnemo se na izbranega ponudnika in uporabniku pokazemo razlog.
    opozorilo = `${izid.napaka} Uporabljen je izbrani ponudnik.`;
  } else if (prehod?.vklop === true && !veljavenNaslovPrehoda(prehod.naslov)) {
    // M8: vklopljen prehod z naslovom, ki ni vec dovoljen (http v domace omrezje) - brez prehoda, a uporabnik izve zakaj.
    opozorilo = "Naslov prehoda ni dovoljen (http samo za ta računalnik, sicer https). Uporabljen je izbrani ponudnik.";
  }
  const izidPonudnika = await callProviderNeposredno(filtriranVhod);
  if (!izidPonudnika.ok) return izidPonudnika;
  const obnovljeno = obnovi(izidPonudnika.text);
  const povratek = izidPonudnika.povratek ? { povratek: izidPonudnika.povratek } : {};
  return opozorilo ? { ok: true, text: obnovljeno, opozorilo, ...povratek } : { ok: true, text: obnovljeno, ...povratek };
}

/**
 * Razumljiv razlog zavrnitve OpenRouter. 401 pri neveljavnem kljucu je izmerjen 21. 11. 2026 (telo »User not found.«);
 * ostali statusi so po dokumentaciji OpenRouter (errors-and-debugging): 402 premalo dobroimetja, 429 omejitev,
 * 404 in 503 pa ob »data_collection: deny« najpogosteje pomenita, da model nima ponudnika brez zbiranja podatkov.
 */
export function razlogOpenRouter(status: number, kontekst?: { model: string; brezplacniDovoljeni?: boolean; asistentka?: boolean; vednoDeny?: boolean }): string | null {
  if (status === 401) return "OpenRouter: ključ ni veljaven.";
  // B6 in C8 (24. 11. 2026): sporocila za brezplacne modele in stanje racuna; brez konteksta ostanejo stara besedila.
  if (kontekst) {
    const brezplacen = jeBrezplacenModel(kontekst.model);
    if (status === 402 && (brezplacen || kontekst.asistentka)) {
      return "OpenRouter: na računu OpenRouter ni dobroimetja ali je negativen; izberite brezplačen model ali dodajte kredit.";
    }
    if (brezplacen && status === 429) {
      return "OpenRouter: dosežena omejitev brezplačnih modelov (20 zahtevkov na minuto; 50 na dan, z vsaj 10 kupljenimi krediti 1000).";
    }
    if (brezplacen && (status === 404 || status === 503)) {
      // naloga 11 N4: deny je vsilila Lina (orodja, tuja vsebina) - nastavitev racuna napake ne odpravi
      if (kontekst.vednoDeny) return "OpenRouter: za naloge in tujo vsebino Lina zahteva ponudnika, ki ne zbira podatkov; ta brezplačni model ga nima. Izberite plačljiv ali drug model.";
      return kontekst.brezplacniDovoljeni
        ? "OpenRouter: vklopite brezplačne modele v računu OpenRouter (Privacy) ali izberite drug model."
        : "OpenRouter: vklopite stikalo za brezplačne modele.";
    }
  }
  if (status === 402) return "OpenRouter: na računu ni dovolj dobroimetja.";
  if (status === 429) return "OpenRouter: preveč zahtevkov, poskusite čez trenutek.";
  if (status === 404 || status === 503) {
    return "OpenRouter: model ne obstaja ali nima ponudnika, ki ne zbira podatkov (Lina to zahteva). Izberite drug model.";
  }
  return null;
}

/** Lasten streznik: http samo na tem racunalniku ali v domacem omrezju (normirajNaslov), brez preusmeritev, rok kot pri drugih. */
async function lastniFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
  zgornjaMeja: number = PROVIDER_TIMEOUT_MS,
): Promise<Response> {
  const osnova = normirajNaslov(url.replace(/\/chat\/completions$/, ""));
  if (!osnova.ok) throw new Error(osnova.razlog);
  const rok = Math.max(500, Math.min(Math.min(zgornjaMeja, PROVIDER_TIMEOUT_PRIPONKE_MS), Math.round(timeoutMs)));
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
    const raw = await besediloZMejo(response, NAJVEC_BAJTOV_ODGOVORA);
    if (!response.ok) return { ok: false, sporocilo: hideSecret(`Strežnik je zavrnil klic (${response.status}).`, secret) };
    const izid = lastniOdgovor(raw);
    if (!izid.ok) return { ok: false, sporocilo: hideSecret(izid.sporocilo, secret) };
    zabeleziPorabo("custom", cleanModel(input.model, "custom"), razberiPoraboIzBesedila(raw), "pogovor");
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

/**
 * Napaka OpenRouter. C6: placljiv model z 402 enkrat poskusi izbrani brezplacni model (samo asistentka, samo s stikalom), nikoli
 * drugega ponudnika (B9). C8: pri 429 brezplacnega modela pove, koliko zahtevkov je danes se ostalo (GET /api/v1/key).
 */
async function napakaOpenRouter(input: ProviderCall, status: number, secret: string): Promise<RezultatPonudnika> {
  const model = cleanModel(input.model, input.provider);
  const rezerva = input.rezervniBrezplacni?.trim() ?? "";
  if (status === 402 && !jeBrezplacenModel(model) && input.vsebinaKlica === false && input.brezplacniDovoljeni === true && jeTocnoBrezplacen(rezerva)) {
    const izid = await callProviderNeposredno({ ...input, model: rezerva, rezervniBrezplacni: undefined });
    if (izid.ok) return { ...izid, povratek: `Na računu OpenRouter ni dobroimetja, zato je odgovoril brezplačni model ${rezerva}.` };
    return izid;
  }
  const kontekst = { model, brezplacniDovoljeni: input.brezplacniDovoljeni === true, asistentka: input.vsebinaKlica === false, vednoDeny: input.vednoDeny === true };
  let sporocilo = razlogOpenRouter(status, kontekst) ?? `Ponudnik je zavrnil klic (${status}).`;
  if (status === 429 && jeBrezplacenModel(model)) {
    const { stanjeOpenRouter } = await import("./openrouter.server.ts");
    const st = await stanjeOpenRouter(input.key).catch(() => null);
    const d = st?.ok ? st.stanje.dnevno : null;
    if (d && d.preostalo !== null) sporocilo += ` Danes še ${d.preostalo}${d.meja !== null ? ` od ${d.meja}` : ""}.`;
  }
  return { ok: false, sporocilo: hideSecret(sporocilo, secret) };
}

/**
 * Model, ki ga ponudnik ne pozna vec -> delujoc model istega ponudnika (v tem procesu; trajno ga zapise keys.server.ts).
 * Kljuc zamenjave (slepi pregled M3): ponudnik + naslov + odtis kljuca racuna + model - zamenjava enega racuna nikoli ne preusmeri
 * drugega mimo preizkusa. Vloga je v kljucu samo pri OmniRoute (klici tam nimajo samodejne zamenjave, M2); drugje velja ista izbira
 * za obe vlogi, zato tekoci klic istega racuna s starim modelom dobi zamenjavo asistentke.
 */
function kljucZamenjaveModela(input: ProviderCall, model: string): string {
  const odtis = createHash("sha256").update(input.key ?? "").digest("hex").slice(0, 16);
  const vloga = input.provider === "omniroute" ? (input.vsebinaKlica === false ? "asistentka" : "klici") : "";
  return [input.provider, input.naslov ?? "", odtis, vloga, model].join("|");
}
const zamenjaniModeli = new Map<string, string>();
const izbireVTeku = new Map<string, Promise<{ ok: true; model: string } | { ok: false; sporocilo: string; vzrok?: VzrokNapake }>>();

/** Samo za preizkuse: pozabi zamenjave modelov v tem procesu. */
export function pozabiZamenjaveModelov(): void {
  zamenjaniModeli.clear();
  izbireVTeku.clear();
}

/** Preizkusni klic za samodejno izbiro: neposredno na uradni naslov (brez prehoda), brez zamenjave, brezplacen model ne za klice. */
export async function preizkusiModel(input: ProviderCall): Promise<RezultatPonudnika> {
  if (input.provider === "custom") return { ok: false, sporocilo: "Lasten strežnik nima samodejne izbire modela." };
  const modelKlica = cleanModel(input.model, input.provider);
  if (jeBrezplacenModel(modelKlica) && (input.vsebinaKlica !== false || input.audio)) {
    return { ok: false, sporocilo: BREZPLACNI_SAMO_ASISTENTKA };
  }
  if (jeBrezplacenModel(modelKlica) && input.brezplacniDovoljeni !== true) {
    return { ok: false, sporocilo: "OpenRouter: vklopite stikalo za brezplačne modele." };
  }
  return callProviderNeposredno({ ...input, brezZamenjave: true, prehod: undefined });
}

/**
 * Lastnik 24. 11. 2026: ce ponudnik vrne »model ne obstaja/ni na voljo«, Lina SAMA preklopi na delujoc model ISTEGA ponudnika
 * (isti kljuc; nikoli drug ponudnik, B9), ponovi zahtevo, shrani nov model in lastniku v eni vrstici pove, da ga je zamenjala.
 */
async function poZamenjaviModela(input: ProviderCall, model: string, secret: string, status: number): Promise<RezultatPonudnika> {
  if (input.brezZamenjave) return { ok: false, sporocilo: razlogVzroka(input.provider, "model"), vzrok: "model" };
  const zaKlice = input.vsebinaKlica !== false;
  // M2 (slepi pregled): OmniRoute posreduje k razlicnim (tudi brezplacnim, tretjim) ponudnikom; vsebine klica Lina ne preusmeri sama.
  if (input.provider === "omniroute" && zaKlice) {
    return { ok: false, sporocilo: hideSecret(`${razlogVzroka(input.provider, "model")} Za klice izberite model sami.`, secret), vzrok: "model" };
  }
  // Samo shranjen model (klici, ponudnik, izbira asistentke); klicatelj s stalnim, izmerjenim modelom (npr. razumevanje) ga obdrzi.
  const kljuci = await import("./keys.server.ts");
  if (!(await kljuci.jeShranjenModel(input.provider, model).catch(() => false))) {
    return { ok: false, sporocilo: hideSecret(`Ponudnik je zavrnil klic (${status}).`, secret), vzrok: "model" };
  }
  const kljucZamenjave = kljucZamenjaveModela(input, model);
  let izbira = izbireVTeku.get(kljucZamenjave);
  if (!izbira) {
    const { izberiDelujocModel } = await import("./samodejni-model.server.ts");
    izbira = izberiDelujocModel({
      provider: input.provider,
      key: input.key,
      ...(input.project !== undefined ? { project: input.project } : {}),
      ...(input.location !== undefined ? { location: input.location } : {}),
      ...(input.naslov !== undefined ? { naslov: input.naslov } : {}),
      zaKlice,
      izkljuci: [model],
      istiIzdelovalecKot: model,
    }).finally(() => izbireVTeku.delete(kljucZamenjave));
    izbireVTeku.set(kljucZamenjave, izbira);
  }
  const izid = await izbira;
  if (!izid.ok) return { ok: false, sporocilo: hideSecret(izid.sporocilo, secret), ...(izid.vzrok ? { vzrok: izid.vzrok } : {}) };
  zamenjaniModeli.set(kljucZamenjave, izid.model);
  const ponovno = await callProviderNeposredno({ ...input, model: izid.model, brezZamenjave: true });
  if (!ponovno.ok) return ponovno;
  const obvestilo = `Model ${model} pri ponudniku ${IME_PONUDNIKA[input.provider]} ni več na voljo, zato je Lina preklopila na ${izid.model}.`;
  await kljuci.zamenjajModel(input.provider, model, izid.model, obvestilo, undefined, { zaKlice, kljuc: input.key }).catch(() => undefined);
  return { ...ponovno, povratek: obvestilo };
}

async function callProviderNeposredno(vhod: ProviderCall): Promise<RezultatPonudnika> {
  if (vhod.provider === "custom") return callLastni(vhod);
  // Model, ki ga je ponudnik ze zavrnil: takoj nadomestni (tekoci klic ima stari model v pomnilniku); samo isti racun, naslov in vloga.
  const zNaslovom = await zNaslovomOmniroute(vhod);
  const nadomestni = vhod.brezZamenjave ? undefined : zamenjaniModeli.get(kljucZamenjaveModela(zNaslovom, cleanModel(vhod.model, vhod.provider)));
  const input = nadomestni ? { ...zNaslovom, model: nadomestni } : zNaslovom;
  let secret = input.key;
  try {
    if (input.provider === "vertex") {
      secret = await vertexAccessToken();
    }
    const { url, init } = providerRequest(input.provider === "vertex" ? { ...input, key: secret } : input);
    const zgornjaMeja = input.priponke?.length ? PROVIDER_TIMEOUT_PRIPONKE_MS : PROVIDER_TIMEOUT_MS;
    const response = await (input.provider === "omniroute" ? omnirouteFetch : httpsFetch)(url, input.signal ? { ...init, signal: input.signal } : init, input.timeoutMs, zgornjaMeja);
    if (input.provider === "vertex" && response.status === 401) pozabiZeton();
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, sporocilo: "Preusmeritev ni dovoljena." };
    }
    const raw = await besediloZMejo(response, NAJVEC_BAJTOV_ODGOVORA);
    if (!response.ok) {
      const vzrok = vzrokNapake(response.status, raw);
      const model = cleanModel(input.model, input.provider);
      // Brezplacni modeli OpenRouter imajo svoja sporocila (B6); zamenjava samo za placljive.
      if (vzrok === "model" && !(input.provider === "openrouter" && jeBrezplacenModel(model))) return poZamenjaviModela(input, model, secret, response.status);
      if (input.provider === "openrouter") {
        const r = await napakaOpenRouter(input, response.status, secret);
        return !r.ok && vzrok ? { ...r, vzrok } : r;
      }
      return { ok: false, sporocilo: hideSecret(`Ponudnik je zavrnil klic (${response.status}).`, secret), ...(vzrok ? { vzrok } : {}) };
    }
    let text = raw.trim();
    try {
      const parsed = JSON.parse(raw) as Parameters<typeof readText>[0];
      text = readText(parsed) || text;
      zabeleziPorabo(input.provider, cleanModel(input.model, input.provider), razberiPorabo(parsed), "pogovor");
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

// --- Klic modela z orodji (Lina programerka F1: vecobratni pogovor, orodja, poraba zetonov) ---------------------------

/** Privzeta meja izhodnih zetonov za klic z orodji (DIZAJN.md razdelek 3). */
export const PRIVZETI_MAX_ZETONOV_ORODJA = 8_000;
export const NAJVEC_ZETONOV_ORODJA = 16_384;

export type PonudnikZOrodji = {
  provider: BrainProvider;
  model: string;
  key: string;
  project?: string;
  location?: string;
  /** Naslov za »custom« ali »omniroute«. */
  naslov?: string;
  /** Stikalo »brezplacni modeli (samo asistentka)« za OpenRouter :free modele. */
  brezplacniDovoljeni?: boolean;
};

export type JsonShemaOrodja = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: ReadonlyArray<string>;
  additionalProperties?: boolean;
  [kljuc: string]: unknown;
};

export type DefinicijaOrodja = {
  ime: string;
  opis: string;
  parametri: JsonShemaOrodja;
};

export type KlicOrodja = {
  /** Enolicen ID klica orodja. */
  id: string;
  /** Ime orodja. */
  ime: string;
  /** Preverjeni argumenti kot JSON objekt (nikoli polje ali primitiv). */
  argumenti: Record<string, unknown>;
  /** Gemini 3 thoughtSignature: mora se vrniti v naslednjem obratu, sicer Vertex/Gemini vrne 400. */
  podpis?: string;
};

/** Gemini functionDeclarations so OpenAPI shema: kljuca additionalProperties ne pozna; preverbo naredi orkestrator. */
function shemaZaGemini(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(shemaZaGemini);
  if (!jeJsonObjekt(v)) return v;
  const izhod: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) if (k !== "additionalProperties" && k !== "$schema") izhod[k] = shemaZaGemini(x);
  return izhod;
}

/** Nadomestni id, kadar ga ponudnik ne da: enolicen tudi med obrati (prej se je stevilo zacelo z 1 v vsakem odgovoru). */
const nadomestniId = (pred: string, n: number) => `${pred}-${randomUUID().slice(0, 8)}-${n}`;

export type SporociloOrodja =
  | { vloga: "uporabnik"; besedilo: string }
  | { vloga: "asistent"; besedilo?: string; klici?: ReadonlyArray<KlicOrodja> }
  | { vloga: "orodje"; id: string; ime: string; rezultat: string | Record<string, unknown>; napaka?: boolean };

export type MoznostiOrodij = {
  system?: string;
  /** Najvec izhodnih zetonov (privzeto 8000, najvec 16384). */
  maxTokens?: number;
  /** Najvec skupnih znakov vhodnih sporocil in sistema (privzeto in najvec NAJVEC_ZNAKOV_VHODA). */
  najvecVhoda?: number;
  /** Temperatura (privzeto 0). */
  temperatura?: number;
  /** Rok klica v ms (privzeto PROVIDER_TIMEOUT_PRIPONKE_MS = 120 s). */
  timeoutMs?: number;
  /** Prekinitev od zunaj. */
  signal?: AbortSignal;
  /** Ali zahteva nosi vsebino telefonskega klica (privzeto false). */
  vsebinaKlica?: boolean;
  /** Pri Claude doda cache_control na system in zadnje orodje (predpomnjenje stalne predpone). */
  predpomniPredpono?: boolean;
};

export type RazlogKoncaOrodij = "konec" | "orodje" | "dolzina" | "varnost" | "drugo";

export type RezultatOrodij =
  | {
      ok: true;
      besedilo: string;
      klici: KlicOrodja[];
      usage: PorabaZetonov | null;
      razlogKonca: RazlogKoncaOrodij;
    }
  | {
      ok: false;
      sporocilo: string;
      vzrok?: VzrokNapake;
    };

function jeJsonObjekt(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function dolzinaVhodaOrodij(sporocila: ReadonlyArray<SporociloOrodja>, system?: string): number {
  let skupaj = system ? system.length : 0;
  for (const s of sporocila) {
    if (s.vloga === "uporabnik") {
      skupaj += s.besedilo.length;
    } else if (s.vloga === "asistent") {
      if (s.besedilo) skupaj += s.besedilo.length;
      if (s.klici) {
        for (const k of s.klici) {
          skupaj += k.ime.length + JSON.stringify(k.argumenti).length;
        }
      }
    } else {
      skupaj += s.ime.length + (typeof s.rezultat === "string" ? s.rezultat.length : JSON.stringify(s.rezultat).length);
    }
  }
  return skupaj;
}

function sporocilaZaGemini(sporocila: ReadonlyArray<SporociloOrodja>): Array<{ role: string; parts: Array<Record<string, unknown>> }> {
  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];
  let i = 0;
  while (i < sporocila.length) {
    const s = sporocila[i]!;
    if (s.vloga === "uporabnik") {
      contents.push({ role: "user", parts: [{ text: s.besedilo }] });
      i += 1;
    } else if (s.vloga === "asistent") {
      const parts: Array<Record<string, unknown>> = [];
      if (s.besedilo) parts.push({ text: s.besedilo });
      for (const k of s.klici ?? []) {
        parts.push({ functionCall: { name: k.ime, args: k.argumenti }, ...(k.podpis ? { thoughtSignature: k.podpis } : {}) });
      }
      if (parts.length === 0) parts.push({ text: "" });
      contents.push({ role: "model", parts });
      i += 1;
    } else {
      // Zaporedni rezultati orodij gredo v en obrat user z vec functionResponse deli (zahteva Gemini/Vertex).
      const parts: Array<Record<string, unknown>> = [];
      while (i < sporocila.length && sporocila[i]!.vloga === "orodje") {
        const o = sporocila[i] as Extract<SporociloOrodja, { vloga: "orodje" }>;
        const response =
          typeof o.rezultat === "string"
            ? o.napaka
              ? { error: o.rezultat }
              : { result: o.rezultat }
            : o.napaka
              ? { error: o.rezultat }
              : o.rezultat;
        parts.push({ functionResponse: { name: o.ime, response } });
        i += 1;
      }
      contents.push({ role: "user", parts });
    }
  }
  return contents;
}

function sporocilaZaOpenAI(sporocila: ReadonlyArray<SporociloOrodja>, system?: string): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  if (system) messages.push({ role: "system", content: system });
  for (const s of sporocila) {
    if (s.vloga === "uporabnik") {
      messages.push({ role: "user", content: s.besedilo });
    } else if (s.vloga === "asistent") {
      messages.push({
        role: "assistant",
        content: s.besedilo ?? null,
        ...(s.klici?.length
          ? {
              tool_calls: s.klici.map((k) => ({
                id: k.id,
                type: "function",
                function: { name: k.ime, arguments: JSON.stringify(k.argumenti) },
              })),
            }
          : {}),
      });
    } else {
      messages.push({
        role: "tool",
        tool_call_id: s.id,
        name: s.ime,
        content: typeof s.rezultat === "string" ? s.rezultat : JSON.stringify(s.rezultat),
      });
    }
  }
  return messages;
}

function sporocilaZaClaude(sporocila: ReadonlyArray<SporociloOrodja>): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  let i = 0;
  while (i < sporocila.length) {
    const s = sporocila[i]!;
    if (s.vloga === "uporabnik") {
      messages.push({ role: "user", content: s.besedilo });
      i += 1;
    } else if (s.vloga === "asistent") {
      if (!s.klici?.length) {
        messages.push({ role: "assistant", content: s.besedilo ?? "" });
      } else {
        const bloki: Array<Record<string, unknown>> = [];
        if (s.besedilo) bloki.push({ type: "text", text: s.besedilo });
        for (const k of s.klici) {
          bloki.push({ type: "tool_use", id: k.id, name: k.ime, input: k.argumenti });
        }
        messages.push({ role: "assistant", content: bloki });
      }
      i += 1;
    } else {
      // Zaporedni rezultati orodij gredo v ENO user sporocilo z vec tool_result bloki (zahteva Anthropic API).
      const bloki: Array<Record<string, unknown>> = [];
      while (i < sporocila.length && sporocila[i]!.vloga === "orodje") {
        const o = sporocila[i] as Extract<SporociloOrodja, { vloga: "orodje" }>;
        bloki.push({
          type: "tool_result",
          tool_use_id: o.id,
          content: typeof o.rezultat === "string" ? o.rezultat : JSON.stringify(o.rezultat),
          ...(o.napaka ? { is_error: true } : {}),
        });
        i += 1;
      }
      messages.push({ role: "user", content: bloki });
    }
  }
  return messages;
}

/** Sestavi HTTP zahtevo za klic modela z orodji (Vertex/Gemini, OpenAI-zdruzljivi, Claude). Kljuc je samo v glavi. */
export function providerRequestZOrodji(
  ponudnik: PonudnikZOrodji,
  sporocila: ReadonlyArray<SporociloOrodja>,
  orodja: ReadonlyArray<DefinicijaOrodja>,
  moznosti: MoznostiOrodij = {},
): { url: string; init: RequestInit } {
  const model = cleanModel(ponudnik.model, ponudnik.provider);
  const maxTokens = Math.max(
    1,
    Math.min(NAJVEC_ZETONOV_ORODJA, Math.floor(Number.isFinite(moznosti.maxTokens) ? (moznosti.maxTokens as number) : PRIVZETI_MAX_ZETONOV_ORODJA)),
  );
  const temperatura = typeof moznosti.temperatura === "number" && Number.isFinite(moznosti.temperatura) ? moznosti.temperatura : 0;
  const headers: Record<string, string> = { "content-type": "application/json" };
  let url = "";
  let body: unknown;

  if (ponudnik.provider === "gemini" || ponudnik.provider === "vertex") {
    if (ponudnik.provider === "gemini") {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      headers["x-goog-api-key"] = ponudnik.key;
    } else {
      const project = gcpProject(ponudnik.project);
      if (!project) throw new Error("Vpišite ID projekta Google Cloud.");
      const location = gcpLocation(ponudnik.location);
      if (!ponudnik.key) throw new Error(ADC_MANJKA);
      const razlicica = podpiraMinimalniRazmislek(model) ? "v1beta1" : "v1";
      url = `https://aiplatform.googleapis.com/${razlicica}/projects/${project}/locations/${location}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
      headers.authorization = `Bearer ${ponudnik.key}`;
      headers["x-goog-user-project"] = project;
    }
    body = {
      ...(moznosti.system ? { systemInstruction: { parts: [{ text: moznosti.system }] } } : {}),
      contents: sporocilaZaGemini(sporocila),
      ...(orodja.length > 0
        ? {
            tools: [
              {
                functionDeclarations: orodja.map((o) => ({
                  name: o.ime,
                  description: o.opis,
                  parameters: shemaZaGemini(o.parametri),
                })),
              },
            ],
          }
        : {}),
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: temperatura,
      },
    };
  } else if (
    ponudnik.provider === "openai" ||
    ponudnik.provider === "grok" ||
    ponudnik.provider === "openrouter" ||
    ponudnik.provider === "omniroute" ||
    ponudnik.provider === "custom"
  ) {
    if (ponudnik.provider === "custom") {
      const izid = normirajNaslov(ponudnik.naslov);
      if (!izid.ok) throw new Error(izid.razlog);
      url = `${izid.naslov}/chat/completions`;
      if (ponudnik.key) headers.authorization = `Bearer ${ponudnik.key}`;
    } else if (ponudnik.provider === "omniroute") {
      const omniroute = veljavenNaslovOmniroute(ponudnik.naslov ?? OMNIROUTE_PRIVZETI_NASLOV);
      if (!omniroute) throw new Error("Naslov OmniRoute ni veljaven: http samo za 127.0.0.1 ali localhost, sicer https.");
      url = `${omniroute}/chat/completions`;
      headers.authorization = `Bearer ${ponudnik.key}`;
    } else {
      url =
        ponudnik.provider === "openai"
          ? "https://api.openai.com/v1/chat/completions"
          : ponudnik.provider === "openrouter"
            ? "https://openrouter.ai/api/v1/chat/completions"
            : "https://api.x.ai/v1/chat/completions";
      headers.authorization = `Bearer ${ponudnik.key}`;
      if (ponudnik.provider === "openrouter") headers["X-Title"] = "Lina";
    }
    // naloga 9 V11 (B9): klic z orodji nosi izide orodij (datoteke, splet), ne samo pogovor lastnika - deny vedno, tudi za :free
    body = {
      model,
      max_tokens: maxTokens,
      temperature: temperatura,
      messages: sporocilaZaOpenAI(sporocila, moznosti.system),
      ...(orodja.length > 0
        ? {
            tools: orodja.map((o) => ({
              type: "function",
              function: { name: o.ime, description: o.opis, parameters: o.parametri },
            })),
          }
        : {}),
      ...(ponudnik.provider === "openrouter" ? { provider: { data_collection: "deny" } } : {}),
    };
  } else {
    url = "https://api.anthropic.com/v1/messages";
    headers["x-api-key"] = ponudnik.key;
    headers["anthropic-version"] = "2023-06-01";
    const predpomni = moznosti.predpomniPredpono === true;
    const systemField = moznosti.system
      ? predpomni
        ? [{ type: "text", text: moznosti.system, cache_control: { type: "ephemeral" } }]
        : moznosti.system
      : undefined;
    body = {
      model,
      max_tokens: maxTokens,
      temperature: temperatura,
      ...(systemField !== undefined ? { system: systemField } : {}),
      messages: sporocilaZaClaude(sporocila),
      ...(orodja.length > 0
        ? {
            tools: orodja.map((o, idx) => ({
              name: o.ime,
              description: o.opis,
              input_schema: o.parametri,
              ...(predpomni && idx === orodja.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
            })),
          }
        : {}),
    };
  }

  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && ponudnik.provider !== "omniroute" && ponudnik.provider !== "custom") {
    throw new Error("Klic ponudnika je dovoljen samo prek https.");
  }
  if (ponudnik.key && parsed.href.includes(ponudnik.key)) throw new Error("Ključ ne sme biti v naslovu.");
  if (ponudnik.provider === "openrouter" && parsed.hostname !== "openrouter.ai") {
    throw new Error("OpenRouter sme klicati samo openrouter.ai.");
  }
  if (ponudnik.provider === "vertex" && parsed.hostname !== "aiplatform.googleapis.com") {
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

function besediloIzOpenAIVsebine(vsebina: unknown): string {
  if (typeof vsebina === "string") return vsebina;
  if (Array.isArray(vsebina)) {
    return vsebina
      .map((d) => (jeJsonObjekt(d) && typeof d.text === "string" ? d.text : ""))
      .join("");
  }
  return "";
}

/**
 * Razbere odgovor klica z orodji v enotno obliko.
 * Ce so argumenti kateregakoli klica orodja napacen JSON ali ne-objekt, vrne { ok: false } (brez izvedbe orodij).
 */
export function razberiOdgovorZOrodji(provider: BrainProvider, surovo: string): RezultatOrodij {
  let json: unknown;
  try {
    json = JSON.parse(surovo);
  } catch {
    return { ok: false, sporocilo: "Ponudnik ni vrnil veljavnega JSON odgovora." };
  }
  if (!jeJsonObjekt(json)) {
    return { ok: false, sporocilo: "Ponudnik ni vrnil veljavnega JSON odgovora." };
  }
  const usage = razberiPorabo(json);

  if (provider === "gemini" || provider === "vertex") {
    const candidates = Array.isArray(json.candidates) ? json.candidates : null;
    const prvi = candidates && jeJsonObjekt(candidates[0]) ? candidates[0] : null;
    if (!prvi) return { ok: false, sporocilo: "Ponudnik ni vrnil odgovora." };
    const finishReason = typeof prvi.finishReason === "string" ? prvi.finishReason : "";
    if (finishReason === "MALFORMED_FUNCTION_CALL") {
      return { ok: false, sporocilo: "Model je vrnil neveljaven klic orodja." };
    }
    const content = jeJsonObjekt(prvi.content) ? prvi.content : null;
    const parts = content && Array.isArray(content.parts) ? content.parts : [];
    const besediloDeli: string[] = [];
    const klici: KlicOrodja[] = [];
    for (const part of parts) {
      if (!jeJsonObjekt(part)) continue;
      if (typeof part.text === "string") besediloDeli.push(part.text);
      if (part.functionCall !== undefined) {
        if (!jeJsonObjekt(part.functionCall)) {
          return { ok: false, sporocilo: "Klic orodja v odgovoru ni veljaven." };
        }
        const ime = typeof part.functionCall.name === "string" ? part.functionCall.name.trim() : "";
        if (!ime) return { ok: false, sporocilo: "Klic orodja nima imena." };
        const args = part.functionCall.args;
        if (args !== undefined && !jeJsonObjekt(args)) {
          return { ok: false, sporocilo: "Argumenti orodja morajo biti veljaven JSON objekt." };
        }
        const id =
          typeof part.functionCall.id === "string" && part.functionCall.id.trim()
            ? part.functionCall.id.trim()
            : nadomestniId("gemini", klici.length + 1);
        const podpis = typeof part.thoughtSignature === "string" && part.thoughtSignature ? part.thoughtSignature : undefined;
        klici.push({ id, ime, argumenti: args ?? {}, ...(podpis ? { podpis } : {}) });
      }
    }
    let razlogKonca: RazlogKoncaOrodij;
    if (finishReason === "STOP") {
      razlogKonca = klici.length > 0 ? "orodje" : "konec";
    } else if (finishReason === "MAX_TOKENS") {
      razlogKonca = "dolzina";
    } else if (/^(SAFETY|RECITATION|BLOCKLIST|PROHIBITED_CONTENT|SPII)$/.test(finishReason)) {
      razlogKonca = "varnost";
    } else {
      razlogKonca = klici.length > 0 ? "orodje" : "drugo";
    }
    return { ok: true, besedilo: besediloDeli.join("").trim(), klici, usage, razlogKonca };
  }

  if (provider === "claude") {
    const content = Array.isArray(json.content) ? json.content : null;
    if (!content) return { ok: false, sporocilo: "Ponudnik ni vrnil vsebine odgovora." };
    const besediloDeli: string[] = [];
    const klici: KlicOrodja[] = [];
    for (const blok of content) {
      if (!jeJsonObjekt(blok)) continue;
      if (blok.type === "text" && typeof blok.text === "string") {
        besediloDeli.push(blok.text);
      } else if (blok.type === "tool_use") {
        const ime = typeof blok.name === "string" ? blok.name.trim() : "";
        if (!ime) return { ok: false, sporocilo: "Klic orodja nima imena." };
        if (!jeJsonObjekt(blok.input)) {
          return { ok: false, sporocilo: "Argumenti orodja morajo biti veljaven JSON objekt." };
        }
        const id = typeof blok.id === "string" && blok.id.trim() ? blok.id.trim() : nadomestniId("claude", klici.length + 1);
        klici.push({ id, ime, argumenti: blok.input });
      }
    }
    const stopReason = typeof json.stop_reason === "string" ? json.stop_reason : "";
    let razlogKonca: RazlogKoncaOrodij;
    if (stopReason === "tool_use") {
      razlogKonca = "orodje";
    } else if (stopReason === "end_turn" || stopReason === "stop_sequence") {
      razlogKonca = klici.length > 0 ? "orodje" : "konec";
    } else if (stopReason === "max_tokens") {
      razlogKonca = "dolzina";
    } else if (stopReason === "refusal") {
      razlogKonca = "varnost";
    } else {
      razlogKonca = klici.length > 0 ? "orodje" : "drugo";
    }
    return { ok: true, besedilo: besediloDeli.join("").trim(), klici, usage, razlogKonca };
  }

  // OpenAI-zdruzljivi: openai, grok, openrouter, omniroute, custom.
  if (jeJsonObjekt(json.error) && typeof json.error.message === "string" && json.error.message.trim()) {
    return { ok: false, sporocilo: `Ponudnik: ${json.error.message.trim().slice(0, 200)}` };
  }
  const choices = Array.isArray(json.choices) ? json.choices : null;
  const izbira = choices && jeJsonObjekt(choices[0]) ? choices[0] : null;
  if (!izbira) return { ok: false, sporocilo: "Ponudnik ni vrnil odgovora." };
  const message = jeJsonObjekt(izbira.message) ? izbira.message : null;
  if (!message) return { ok: false, sporocilo: "Ponudnik ni vrnil sporočila." };

  const besedilo = besediloIzOpenAIVsebine(message.content).trim();
  const klici: KlicOrodja[] = [];
  if (message.tool_calls !== undefined && message.tool_calls !== null) {
    if (!Array.isArray(message.tool_calls)) {
      return { ok: false, sporocilo: "Polje tool_calls v odgovoru ni seznam." };
    }
    for (const tc of message.tool_calls) {
      if (!jeJsonObjekt(tc) || !jeJsonObjekt(tc.function)) {
        return { ok: false, sporocilo: "Klic orodja v odgovoru ni veljaven." };
      }
      const ime = typeof tc.function.name === "string" ? tc.function.name.trim() : "";
      if (!ime) return { ok: false, sporocilo: "Klic orodja nima imena." };
      const suroviArg = tc.function.arguments;
      let argumenti: Record<string, unknown>;
      if (typeof suroviArg === "string") {
        if (!suroviArg.trim()) {
          return { ok: false, sporocilo: "Argumenti orodja niso veljaven JSON." };
        }
        let razclenjeno: unknown;
        try {
          razclenjeno = JSON.parse(suroviArg);
        } catch {
          return { ok: false, sporocilo: "Argumenti orodja niso veljaven JSON." };
        }
        if (!jeJsonObjekt(razclenjeno)) {
          return { ok: false, sporocilo: "Argumenti orodja morajo biti veljaven JSON objekt." };
        }
        argumenti = razclenjeno;
      } else if (jeJsonObjekt(suroviArg)) {
        argumenti = suroviArg;
      } else {
        return { ok: false, sporocilo: "Argumenti orodja morajo biti veljaven JSON objekt." };
      }
      const id = typeof tc.id === "string" && tc.id.trim() ? tc.id.trim() : nadomestniId("openai", klici.length + 1);
      klici.push({ id, ime, argumenti });
    }
  }

  const finishReason = typeof izbira.finish_reason === "string" ? izbira.finish_reason : "";
  let razlogKonca: RazlogKoncaOrodij;
  if (finishReason === "tool_calls" || finishReason === "function_call") {
    razlogKonca = "orodje";
  } else if (finishReason === "stop") {
    razlogKonca = klici.length > 0 ? "orodje" : "konec";
  } else if (finishReason === "length") {
    razlogKonca = "dolzina";
  } else if (finishReason === "content_filter") {
    razlogKonca = "varnost";
  } else {
    razlogKonca = klici.length > 0 ? "orodje" : "drugo";
  }

  return { ok: true, besedilo, klici, usage, razlogKonca };
}

/**
 * Vecobratni klic modela z orodji za Vertex/Gemini, OpenAI-zdruzljive (OpenAI, Grok, OpenRouter, OmniRoute, custom) in Claude.
 * Ne uporablja 6000-znakovne meje pogovora (velja meja bajtov NAJVEC_BAJTOV_ODGOVORA); zabelezi porabo zetonov.
 */
export async function callProviderZOrodji(
  ponudnik: PonudnikZOrodji,
  sporocila: ReadonlyArray<SporociloOrodja>,
  orodja: ReadonlyArray<DefinicijaOrodja>,
  moznosti: MoznostiOrodij = {},
): Promise<RezultatOrodij> {
  if (!sporocila.length) {
    return { ok: false, sporocilo: "Manjkajo sporočila za klic modela." };
  }
  const mejaVhoda = Math.max(1, Math.min(NAJVEC_ZNAKOV_VHODA, Math.floor(moznosti.najvecVhoda ?? NAJVEC_ZNAKOV_VHODA)));
  if (dolzinaVhodaOrodij(sporocila, moznosti.system) > mejaVhoda) {
    return { ok: false, sporocilo: "Vhod presega največjo dovoljeno dolžino." };
  }

  const model = cleanModel(ponudnik.model, ponudnik.provider);
  const vsebinaKlica = moznosti.vsebinaKlica === true;
  if (jeBrezplacenModel(model) && vsebinaKlica) {
    return { ok: false, sporocilo: BREZPLACNI_SAMO_ASISTENTKA };
  }
  if (jeBrezplacenModel(model) && ponudnik.brezplacniDovoljeni !== true) {
    return { ok: false, sporocilo: "OpenRouter: vklopite stikalo za brezplačne modele." };
  }
  if (ponudnik.provider === "custom" && vsebinaKlica) {
    return { ok: false, sporocilo: "Lasten strežnik je dovoljen samo za pogovor z asistentko, ne za klice." };
  }

  let zNaslovom = ponudnik;
  if (ponudnik.provider === "omniroute" && !ponudnik.naslov) {
    const { naslovOmniroute } = await import("./keys.server.ts");
    zNaslovom = { ...ponudnik, naslov: (await naslovOmniroute().catch(() => null)) ?? OMNIROUTE_PRIVZETI_NASLOV };
  }

  let secret = zNaslovom.key;
  try {
    if (zNaslovom.provider === "vertex") {
      secret = await vertexAccessToken();
    }
    const { url, init } = providerRequestZOrodji(
      zNaslovom.provider === "vertex" ? { ...zNaslovom, key: secret } : zNaslovom,
      sporocila,
      orodja,
      moznosti,
    );
    const reqInit = moznosti.signal ? { ...init, signal: moznosti.signal } : init;
    const rok = moznosti.timeoutMs ?? PROVIDER_TIMEOUT_PRIPONKE_MS;
    const response =
      zNaslovom.provider === "custom"
        ? await lastniFetch(url, reqInit, rok, PROVIDER_TIMEOUT_PRIPONKE_MS)
        : zNaslovom.provider === "omniroute"
          ? await omnirouteFetch(url, reqInit, rok, PROVIDER_TIMEOUT_PRIPONKE_MS)
          : await httpsFetch(url, reqInit, rok, PROVIDER_TIMEOUT_PRIPONKE_MS);

    if (zNaslovom.provider === "vertex" && response.status === 401) pozabiZeton();
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, sporocilo: "Preusmeritev ni dovoljena." };
    }
    const raw = await besediloZMejo(response, NAJVEC_BAJTOV_ODGOVORA);
    if (!response.ok) {
      const vzrok = vzrokNapake(response.status, raw);
      if (zNaslovom.provider === "openrouter") {
        const sporocilo =
          razlogOpenRouter(response.status, {
            model,
            brezplacniDovoljeni: zNaslovom.brezplacniDovoljeni === true,
            asistentka: !vsebinaKlica,
            vednoDeny: true, // klic z orodji vedno z deny (V11)
          }) ?? `Ponudnik je zavrnil klic (${response.status}).`;
        return { ok: false, sporocilo: hideSecret(sporocilo, secret), ...(vzrok ? { vzrok } : {}) };
      }
      return {
        ok: false,
        sporocilo: hideSecret(`Ponudnik je zavrnil klic (${response.status}).`, secret),
        ...(vzrok ? { vzrok } : {}),
      };
    }

    const izid = razberiOdgovorZOrodji(zNaslovom.provider, raw);
    if (!izid.ok) {
      return { ok: false, sporocilo: hideSecret(izid.sporocilo, secret) };
    }
    zabeleziPorabo(zNaslovom.provider, model, izid.usage, "orodja");
    return {
      ...izid,
      besedilo: hideSecret(izid.besedilo, secret),
      // model lahko kljuc ponovi tudi v argumentih; JSON.stringify ubezi narekovaje, zato zamenjava ostane veljaven JSON
      klici: izid.klici.map((k) => ({ ...k, argumenti: JSON.parse(hideSecret(JSON.stringify(k.argumenti), secret)) as Record<string, unknown> })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Klic ponudnika ni uspel.";
    if (message === ADC_MANJKA) return { ok: false, sporocilo: ADC_MANJKA };
    if (error instanceof Error && error.name === "TimeoutError") return { ok: false, sporocilo: "Ponudnik ni odgovoril pravočasno." };
    if (/redirect/i.test(message)) return { ok: false, sporocilo: "Preusmeritev ni dovoljena." };
    return { ok: false, sporocilo: hideSecret(message, secret) };
  }
}
