import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, link, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { obnoviOsvezevanjePoMenjavi, pozabiZeton } from "./adc.server.ts";
import { requireOwner } from "./auth.server.ts";
import { callProvider, gcpLocation, gcpProject, hideSecret, razlogVzroka } from "./providers.ts";
import { normirajNaslov } from "./lastni-streznik.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";
import {
  BREZPLACNI_SAMO_ASISTENTKA,
  DEFAULT_BRAIN_MODELS,
  jeBrezplacenModel,
  jeTocnoBrezplacen,
  PRIVZETI_BREZPLACNI,
  type BrainProvider,
  type BrainPublic,
  type ShranjenPonudnik,
} from "./types.ts";

const PROVIDERS = new Set<BrainProvider>(["gemini", "openai", "claude", "grok", "vertex", "openrouter", "custom"]);

type KeyFile = {
  provider: BrainProvider;
  model: string;
  iv?: string;
  tag?: string;
  ciphertext?: string;
  project?: string;
  location?: string;
};

function isProvider(value: string): value is BrainProvider {
  return PROVIDERS.has(value as BrainProvider);
}

async function lock(file: string): Promise<void> {
  // Na Windows chmod ne velja. Podatki so v mapi uporabnika, ključ ostane šifriran.
  if (process.platform === "win32") return;
  await chmod(file, 0o600);
}

async function zapisiKljuc(file: string, key: Buffer, flags: "w" | "wx"): Promise<void> {
  const handle = await open(file, flags, 0o600);
  try {
    await handle.writeFile(key);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Ustvarjanje kljuca v teku po poti: hkratni klici v istem procesu dobijo isti kljuc. */
const kljuciVTeku = new Map<string, Promise<Buffer>>();

/**
 * Nov kljuc atomarno (NAP10, 22. 11. 2026: preizkus 20 hkratnih sifriranj je padel, ker je vsak klic prepisal .kljuc z drugim
 * kljucem in prej sifrirane skrivnosti so bile izgubljene). Kljuc se zapise v zacasno datoteko in poveze z link(), ki ne prepise:
 * drugi proces, ki izgubi tekmo, prebere zmagovalni kljuc. Pokvarjen obstojec kljuc (ne 32 bajtov) se prepise kot prej.
 */
async function ustvariKljuc(file: string): Promise<Buffer> {
  const key = randomBytes(32);
  const zacasna = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.nov`;
  await zapisiKljuc(zacasna, key, "wx");
  try {
    await link(zacasna, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    await unlink(zacasna).catch(() => undefined);
  }
  const koncni = await readFile(file);
  if (koncni.length === 32) {
    await lock(file);
    return koncni;
  }
  await zapisiKljuc(file, key, "w");
  await lock(file);
  return key;
}

/** Naključen ključ za šifriranje, samo na disku, pravice 0600. */
async function masterKey(dir: string): Promise<Buffer> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, ".kljuc");
  try {
    const existing = await readFile(file);
    if (existing.length === 32) {
      await lock(file);
      return existing;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let vTeku = kljuciVTeku.get(file);
  if (!vTeku) {
    vTeku = ustvariKljuc(file).finally(() => kljuciVTeku.delete(file));
    kljuciVTeku.set(file, vTeku);
  }
  return vTeku;
}

function encrypt(secret: string, key: Buffer, aad?: string): Pick<KeyFile, "iv" | "tag" | "ciphertext"> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad !== undefined) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decrypt(file: KeyFile, key: Buffer, aad?: string): string | null {
  if (!file.iv || !file.tag || !file.ciphertext) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(file.iv, "base64"));
    if (aad !== undefined) decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(file.tag, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(file.ciphertext, "base64")),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch {
    return null;
  }
}

/** Splosno sifriranje skrivnosti z isto glavno kljuco (Twilio API kljuc ipd.): samo na disku, pravice 0600. */
export async function sifrirajSkrivnost(secret: string, dir?: string, aad?: string): Promise<{ iv: string; tag: string; ciphertext: string }> {
  const root = resolveDataDir(dir);
  const sifra = encrypt(secret, await masterKey(root), aad);
  return { iv: sifra.iv ?? "", tag: sifra.tag ?? "", ciphertext: sifra.ciphertext ?? "" };
}

export async function odsifrirajSkrivnost(
  sifra: { iv?: string; tag?: string; ciphertext?: string },
  dir?: string,
  aad?: string,
): Promise<string | null> {
  const root = resolveDataDir(dir);
  return decrypt({ provider: "gemini", model: "", ...sifra }, await masterKey(root), aad);
}

function hint(secret: string | null): string | null {
  if (!secret) return null;
  return secret.slice(-4);
}

async function readFileState(dir: string): Promise<KeyFile | null> {
  return readJsonFile<KeyFile>(dir, "kljuci.json");
}

// ---- Vec ponudnikov hkrati (ponudniki.json) ---------------------------------------------------------------
// Vsak ponudnik ima svoj sifriran kljuc (ista glavna kljuc in sifra kot kljuci.json) in seznam modelov. kljuci.json ostane
// »aktivni ponudnik za klice«; izbira modela za pogovor z asistentko je locena (pogovor) in ne vpliva na klice.

type PonudnikZapis = {
  model: string;
  modeli?: string[];
  iv?: string;
  tag?: string;
  ciphertext?: string;
  project?: string;
  location?: string;
  /** Naslov lastnega streznika (samo ponudnik »custom«). */
  naslov?: string;
  /** Kljuc za asistentko (lastnik 24. 11. 2026, C1): samo v ponudniki.json, klici ga nikoli ne dobijo (ne prek saveBrain). */
  samoAsistentka?: boolean;
};

type PonudnikiFile = {
  ponudniki?: Partial<Record<BrainProvider, PonudnikZapis>>;
  pogovor?: { provider: BrainProvider; model: string } | null;
  /** B1: stikalo »brezplacni modeli (samo asistentka)«, privzeto izklopljeno. NIKOLI v kljuci.json. */
  brezplacniModeli?: boolean;
  /**
   * Zadnja samodejna zamenjava modela (ena vrstica za lastnika).
   * shortcut: izgine ob naslednjem zapisu ponudnikov (ne podajo ga), ce bi lastnik zelel zgodovino zamenjav - dnevnik.
   */
  zamenjavaModela?: string;
};

const PONUDNIKI_DATOTEKA = "ponudniki.json";
const NAJVEC_MODELOV = 12;
const VELJAVEN_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,79}$/;
const RED_PONUDNIKOV: BrainProvider[] = ["gemini", "vertex", "openai", "claude", "grok", "openrouter", "custom"];

function skrivnostZapisa(provider: BrainProvider, zapis: PonudnikZapis, kljuc: Buffer): string | null {
  return decrypt({ provider, model: zapis.model, iv: zapis.iv, tag: zapis.tag, ciphertext: zapis.ciphertext }, kljuc);
}

function modeliZapisa(provider: BrainProvider, zapis: PonudnikZapis): string[] {
  const seznam = zapis.modeli && zapis.modeli.length > 0 ? zapis.modeli : [zapis.model || DEFAULT_BRAIN_MODELS[provider]];
  return [...new Set(seznam)];
}

/** Starejsa namestitev ima samo kljuci.json: aktivni ponudnik velja, dokler ga ni v novi shrambi. */
async function preberiPonudnike(root: string): Promise<{
  ponudniki: Partial<Record<BrainProvider, PonudnikZapis>>;
  pogovor: { provider: BrainProvider; model: string } | null;
  brezplacniModeli: boolean;
  zamenjavaModela?: string;
}> {
  const datoteka = (await readJsonFile<PonudnikiFile>(root, PONUDNIKI_DATOTEKA).catch(() => null)) ?? {};
  const ponudniki = { ...(datoteka.ponudniki ?? {}) };
  const aktivni = await readFileState(root);
  if (aktivni && isProvider(aktivni.provider) && aktivni.provider !== "custom" && !ponudniki[aktivni.provider]) {
    const { provider: _ponudnik, ...zapis } = aktivni;
    ponudniki[aktivni.provider] = zapis;
  }
  const p = datoteka.pogovor;
  const pogovor = p && isProvider(String(p.provider)) && typeof p.model === "string" ? { provider: p.provider, model: p.model } : null;
  const zamenjava = typeof datoteka.zamenjavaModela === "string" ? { zamenjavaModela: datoteka.zamenjavaModela.slice(0, 300) } : {};
  return { ponudniki, pogovor, brezplacniModeli: datoteka.brezplacniModeli === true, ...zamenjava };
}

async function zapisiPonudnike(root: string, datoteka: PonudnikiFile): Promise<void> {
  // Klicatelji sestavijo samo {ponudniki, pogovor}: stikalo brezplacnih modelov se ohrani z diska, ce ga ne podajo izrecno.
  const brezplacniModeli = datoteka.brezplacniModeli ?? (await preberiPonudnike(root)).brezplacniModeli;
  await writeJson(root, PONUDNIKI_DATOTEKA, { ...datoteka, brezplacniModeli });
  await lock(path.join(root, PONUDNIKI_DATOTEKA));
}

/** Shrani (ali posodobi) ponudnika; model gre na zacetek seznama modelov (najvec 12, brez dvojnikov). */
async function vpisiPonudnika(root: string, provider: BrainProvider, zapis: PonudnikZapis): Promise<void> {
  const trenutno = await preberiPonudnike(root);
  const prej = trenutno.ponudniki[provider];
  const modeli = [zapis.model, ...(prej ? modeliZapisa(provider, prej) : [])].filter((m) => VELJAVEN_MODEL.test(m));
  const edinstveni = [...new Set(modeli)].slice(0, NAJVEC_MODELOV);
  await zapisiPonudnike(root, {
    ponudniki: { ...trenutno.ponudniki, [provider]: { ...zapis, modeli: edinstveni } },
    pogovor: trenutno.pogovor,
  });
}

/** Javni pogled: samo ponudniki z uporabnim kljucem (ali projektom Vertex); ključ ostane zunaj, vidni so zadnji stirje znaki. */
async function pogledPonudnikov(root: string): Promise<{
  shranjeni: ShranjenPonudnik[];
  pogovor: { provider: BrainProvider; model: string } | null;
  brezplacniModeli: boolean;
  zamenjavaModela?: string;
}> {
  const { ponudniki, pogovor, brezplacniModeli, zamenjavaModela } = await preberiPonudnike(root);
  const kljuc = await masterKey(root);
  const shranjeni: ShranjenPonudnik[] = [];
  for (const provider of RED_PONUDNIKOV) {
    const zapis = ponudniki[provider];
    if (!zapis) continue;
    const modeli = modeliZapisa(provider, zapis);
    const model = zapis.model || DEFAULT_BRAIN_MODELS[provider];
    if (provider === "custom") {
      // Kljuc je neobvezen; ponudnik je viden samo z veljavnim naslovom.
      const n = normirajNaslov(zapis.naslov);
      if (n.ok) shranjeni.push({ provider, namig: hint(skrivnostZapisa(provider, zapis, kljuc)), model, modeli, naslov: n.naslov });
      continue;
    }
    if (provider === "vertex") {
      if (zapis.project) shranjeni.push({ provider, namig: null, model, modeli, projekt: zapis.project });
      continue;
    }
    const skrivnost = skrivnostZapisa(provider, zapis, kljuc);
    if (skrivnost) shranjeni.push({ provider, namig: hint(skrivnost), model, modeli, ...(zapis.samoAsistentka ? { samoAsistentka: true } : {}) });
  }
  const veljavna = pogovor && shranjeni.some((p) => p.provider === pogovor.provider && p.modeli.includes(pogovor.model)) ? pogovor : null;
  return { shranjeni, pogovor: veljavna, brezplacniModeli, ...(zamenjavaModela ? { zamenjavaModela } : {}) };
}

/**
 * Lastnik 24. 11. 2026: model, ki ga ponudnik ne pozna vec, Lina med delovanjem zamenja z delujocim ISTEGA ponudnika in ga shrani.
 * Zamenja samo zapise, ki se uporabljajo model »staro« (klici v kljuci.json, ponudnik in izbira asistentke v ponudniki.json).
 * Brezplacen model nikoli v kljuci.json (B3). Klicatelj je strezniski del (callProvider), zato brez preverbe lastnika.
 */
/** Ali je model shranjen za klice, kot model ponudnika ali kot izbira asistentke (samo take Lina sama zamenja). */
export async function jeShranjenModel(provider: BrainProvider, model: string, dir?: string): Promise<boolean> {
  const root = resolveDataDir(dir);
  const saved = await readFileState(root);
  if (saved && saved.provider === provider && (saved.model || DEFAULT_BRAIN_MODELS[provider]) === model) return true;
  const t = await preberiPonudnike(root);
  const z = t.ponudniki[provider];
  if (z && (z.model || DEFAULT_BRAIN_MODELS[provider]) === model) return true;
  return t.pogovor?.provider === provider && t.pogovor.model === model;
}

export async function zamenjajModel(provider: BrainProvider, staro: string, novo: string, obvestilo: string, dir?: string): Promise<boolean> {
  if (provider === "custom" || !VELJAVEN_MODEL.test(novo) || staro === novo) return false;
  const root = resolveDataDir(dir);
  const saved = await readFileState(root);
  let spremenjeno = false;
  if (saved && saved.provider === provider && (saved.model || DEFAULT_BRAIN_MODELS[provider]) === staro && !jeBrezplacenModel(novo)) {
    await writeJson(root, "kljuci.json", { ...saved, model: novo });
    await lock(path.join(root, "kljuci.json"));
    spremenjeno = true;
  }
  const t = await preberiPonudnike(root);
  const zapis = t.ponudniki[provider];
  const pogovorStar = t.pogovor?.provider === provider && t.pogovor.model === staro;
  let ponudniki = t.ponudniki;
  if (zapis && ((zapis.model || DEFAULT_BRAIN_MODELS[provider]) === staro || pogovorStar)) {
    const prej = modeliZapisa(provider, zapis);
    const modeli = (prej.includes(staro) ? prej.map((m) => (m === staro ? novo : m)) : [novo, ...prej]).filter((m) => VELJAVEN_MODEL.test(m));
    const model = (zapis.model || DEFAULT_BRAIN_MODELS[provider]) === staro ? novo : zapis.model;
    ponudniki = { ...ponudniki, [provider]: { ...zapis, model, modeli: [...new Set(modeli)].slice(0, NAJVEC_MODELOV) } };
    spremenjeno = true;
  }
  const pogovor = pogovorStar ? { provider, model: novo } : t.pogovor;
  // Obvestilo samo, ce je bil res zamenjan shranjen zapis.
  if (spremenjeno || pogovorStar) await zapisiPonudnike(root, { ponudniki, pogovor, zamenjavaModela: obvestilo.slice(0, 300) });
  return spremenjeno || pogovorStar;
}

/** Samo kljuc, ki ga je lastnik shranil. Kljuc iz okolja se ne uporabi. */
export async function kljucLastnika(
  dir?: string,
): Promise<{ provider: BrainProvider; model: string; key: string } | null> {
  const root = resolveDataDir(dir);
  const saved = await readFileState(root);
  if (!saved || !isProvider(saved.provider) || saved.provider === "vertex" || saved.provider === "custom") return null;
  const key = decrypt(saved, await masterKey(root));
  if (!key) return null;
  return { provider: saved.provider, model: saved.model || DEFAULT_BRAIN_MODELS[saved.provider], key };
}

export function emptyBrain(): BrainPublic {
  return { provider: null, model: "", nastavljen: false, namig: null, projekt: null, lokacija: null };
}

/** Zaslon kaze placljivi privzeti model, ce je v zapisu shranjen brezplacni (klici ga ne uporabljajo). */
function modelZaZaslon(provider: BrainProvider, model: string | undefined): string {
  const izbran = model || DEFAULT_BRAIN_MODELS[provider];
  return jeBrezplacenModel(izbran) ? DEFAULT_BRAIN_MODELS[provider] : izbran;
}

function publicVertex(saved: KeyFile): BrainPublic {
  return {
    provider: "vertex",
    model: modelZaZaslon("vertex", saved.model),
    nastavljen: Boolean(saved.project),
    namig: null,
    projekt: saved.project ?? null,
    lokacija: saved.location || "global",
  };
}

/** Javni pogled: ponudnik, model in zadnji štirje znaki. Cel ključ in žeton ostaneta zunaj brskalnika. */
export async function readBrain(token: string | null, dir?: string): Promise<BrainPublic> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return { ...(await readBrainOsnova(root)), ...(await pogledPonudnikov(root)) };
}

async function readBrainOsnova(root: string): Promise<BrainPublic> {
  const saved = await readFileState(root);
  if (!saved || !isProvider(saved.provider) || saved.provider === "custom") return emptyBrain();
  if (saved.provider === "vertex") return publicVertex(saved);
  const secret = decrypt(saved, await masterKey(root));
  return {
    provider: saved.provider,
    model: modelZaZaslon(saved.provider, saved.model),
    nastavljen: Boolean(secret),
    namig: hint(secret),
    projekt: null,
    lokacija: null,
  };
}

function parseProvider(value: unknown): BrainProvider {
  if (typeof value !== "string" || !isProvider(value)) throw new Error("Izberite ponudnika.");
  return value;
}

/**
 * Samodejna izbira ob shranjevanju (lastnik 24. 11. 2026). Odlocitev: kljuc, ki ga ponudnik zavrne (kljuc, dobroimetje, omejitev,
 * noben model), se NE shrani - prejsnja delujoca nastavitev klicev ostane, uporabnik vidi pravi vzrok. Ce ponudnik ni dosegljiv
 * (omrezje), se shrani privzeti model z opozorilom; med delovanjem ga Lina po potrebi zamenja sama (callProvider).
 */
async function samodejniModel(o: { provider: BrainProvider; key: string; project?: string; location?: string }): Promise<{ model: string; sporocilo: string } | null> {
  const { izberiDelujocModel } = await import("./samodejni-model.server.ts");
  const izid = await izberiDelujocModel({ ...o, zaKlice: true });
  if (izid.ok) return { model: izid.model, sporocilo: `Lina je izbrala model ${izid.model} (preizkusni klic je uspel).` };
  if (izid.vzrok) throw new Error(izid.sporocilo);
  return { model: DEFAULT_BRAIN_MODELS[o.provider], sporocilo: `Modela ni bilo mogoče preveriti (${izid.sporocilo.slice(0, 120)}); shranjen je privzeti ${DEFAULT_BRAIN_MODELS[o.provider]}.` };
}

export async function saveBrain(
  input: { provider?: unknown; model?: unknown; key?: unknown; project?: unknown; location?: unknown; samodejno?: unknown },
  token: string | null,
  dir?: string,
): Promise<BrainPublic> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  // Menjava mozganov ali projekta: zeton prejsnjega racuna ne sme veljati se do izteka (pregled G2, S3).
  pozabiZeton();
  obnoviOsvezevanjePoMenjavi(root);
  const provider = parseProvider(input.provider);
  // Lastnik 21. 11. 2026: lasten streznik je samo za pogovor; kljuci.json (mozgani za klice) ga ne sme vsebovati.
  if (provider === "custom") throw new Error("Lasten strežnik se nastavi v svojem razdelku (samo za pogovor).");
  const rocni = typeof input.model === "string" && input.model.trim() ? input.model.trim().slice(0, 80) : "";
  // Samodejno samo, ce uporabnik modela ni vpisal sam (Napredno); saveBrain brez zastavice ostane brez omrezja.
  const samodejno = input.samodejno === true && !rocni;
  let model = rocni || DEFAULT_BRAIN_MODELS[provider];
  // B3 (lastnik 24. 11. 2026): kljuci.json doloca mozgane za KLICE; brezplacen model (lahko uci na pozivih) tja ne sme.
  if (jeBrezplacenModel(model)) throw new Error(BREZPLACNI_SAMO_ASISTENTKA);
  let sporociloModela: string | undefined;
  if (provider === "vertex") {
    const project = gcpProject(input.project);
    if (!project) throw new Error("Vpišite ID projekta Google Cloud.");
    const location = gcpLocation(input.location);
    // Vertex: samodejne izbire ob shranjevanju NI (prijava Google shrani projekt tudi, ce API se ni vklopljen); med delovanjem velja zamenjava.
    const next: KeyFile = { provider, model, project, location };
    await writeJson(root, "kljuci.json", next);
    await lock(path.join(root, "kljuci.json"));
    await vpisiPonudnika(root, provider, { model, project, location });
    return { ...publicVertex(next), ...(await pogledPonudnikov(root)), ...(sporociloModela ? { sporociloModela } : {}) };
  }
  // Kljuc velja samo za ponudnika, ki mu pripada: stari kljuc drugega ponudnika se NE prenese (xAI kljuc ne sme k OpenAI).
  // Kljuc za asistentko (samoAsistentka) se za klice NIKOLI ne podeduje iz praznega polja: velja kljuc klicev iz kljuci.json.
  const prejsnji = (await preberiPonudnike(root)).ponudniki[provider];
  const zaKlice = await readFileState(root);
  const previous =
    prejsnji && !prejsnji.samoAsistentka
      ? skrivnostZapisa(provider, prejsnji, await masterKey(root))
      : zaKlice && zaKlice.provider === provider
        ? decrypt(zaKlice, await masterKey(root))
        : null;
  const typed = typeof input.key === "string" ? input.key.trim() : "";
  if (typed && (typed.length < 8 || typed.length > 400)) {
    throw new Error("Ključ mora imeti med 8 in 400 znakov.");
  }
  const secret = typed || previous;
  if (samodejno && secret) {
    const izbira = await samodejniModel({ provider, key: secret });
    if (izbira) ({ model, sporocilo: sporociloModela } = izbira);
  }
  const next: KeyFile = {
    provider,
    model,
    ...(secret ? encrypt(secret, await masterKey(root)) : {}),
  };
  await writeJson(root, "kljuci.json", next);
  await lock(path.join(root, "kljuci.json"));
  // Zapis asistentke ostane nedotaknjen (svoj kljuc); kljuc klicev je v kljuci.json.
  if (next.ciphertext && !prejsnji?.samoAsistentka) await vpisiPonudnika(root, provider, { model, iv: next.iv, tag: next.tag, ciphertext: next.ciphertext });
  return {
    provider,
    model,
    nastavljen: Boolean(secret),
    namig: hint(secret),
    projekt: null,
    lokacija: null,
    ...(await pogledPonudnikov(root)),
    ...(sporociloModela ? { sporociloModela } : {}),
  };
}

/** Rezerva, če lastnik ključa ni vpisal. Vrednosti ne zapisuje. Vertex nima ključa v okolju. */
export function envKey(provider: BrainProvider): string | null {
  if (provider === "vertex" || provider === "custom") return null;
  const value =
    provider === "gemini"
      ? process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
      : provider === "openai"
        ? process.env.OPENAI_API_KEY
        : provider === "claude"
          ? process.env.ANTHROPIC_API_KEY
          : provider === "openrouter"
            ? process.env.OPENROUTER_API_KEY
            : process.env.XAI_API_KEY;
  const trimmed = value?.trim();
  return trimmed || null;
}

export async function activeBrain(
  dir?: string,
): Promise<{ provider: BrainProvider; model: string; key: string; project?: string; location?: string } | null> {
  const root = resolveDataDir(dir);
  const saved = await readFileState(root);
  // B9: custom (lasten streznik) je samo za asistentko; izbran v kljuci.json (rocno) = brez mozganov za klice, ne ponudnik iz okolja.
  if (saved && isProvider(saved.provider) && saved.provider === "custom") return null;
  if (saved && isProvider(saved.provider)) {
    // Brezplacen zapis: samo kljuc istega ponudnika in placljivi privzeti model. Tuj kljuc iz okolja ne pride v postev.
    if (jeBrezplacenModel(saved.model || "")) {
      if (saved.provider === "vertex") {
        const project = saved.project ? gcpProject(saved.project) : "";
        if (!project) return null;
        return {
          provider: "vertex",
          model: DEFAULT_BRAIN_MODELS.vertex,
          key: "",
          project,
          location: gcpLocation(saved.location),
        };
      }
      const stored = decrypt(saved, await masterKey(root));
      const key = stored || envKey(saved.provider);
      if (!key) return null;
      return { provider: saved.provider, model: DEFAULT_BRAIN_MODELS[saved.provider], key };
    }
    if (saved.provider === "vertex") {
      const project = saved.project ? gcpProject(saved.project) : "";
      if (!project) return null;
      return {
        provider: "vertex",
        model: saved.model || DEFAULT_BRAIN_MODELS.vertex,
        key: "",
        project,
        location: gcpLocation(saved.location),
      };
    }
    const stored = decrypt(saved, await masterKey(root));
    const key = stored || envKey(saved.provider);
    // B9: lastnik je izbral ponudnika za klice; brez njegovega kljuca ni mozganov (nikoli drug ponudnik iz okolja).
    return key ? { provider: saved.provider, model: saved.model || DEFAULT_BRAIN_MODELS[saved.provider], key } : null;
  }
  // Zanka po okolju samo, ce lastnik v kljuci.json ni izbral ponudnika.
  const order: BrainProvider[] = ["grok", "openai", "claude", "gemini", "openrouter"];
  for (const provider of order) {
    const key = envKey(provider);
    if (key) return { provider, model: DEFAULT_BRAIN_MODELS[provider], key };
  }
  return null;
}

export async function checkBrain(
  input: { provider?: unknown; model?: unknown; key?: unknown; project?: unknown; location?: unknown },
  token: string | null,
  dir?: string,
): Promise<{ ok: boolean; sporocilo: string }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const provider = parseProvider(input.provider);
  const model = typeof input.model === "string" && input.model.trim() ? input.model.trim().slice(0, 80) : DEFAULT_BRAIN_MODELS[provider];
  if (provider === "custom") return { ok: false, sporocilo: "Lasten strežnik preverite v njegovem razdelku." };
  const saved = await readFileState(root);
  // Preverba prijave Google Cloud je trenutek (ponovne) prijave: stari zeton ne sme odgovoriti namesto novega racuna.
  if (provider === "vertex") pozabiZeton();
  if (provider === "vertex") {
    const project = gcpProject(input.project ?? saved?.project);
    const location = gcpLocation(input.location ?? saved?.location);
    if (!project) return { ok: false, sporocilo: "Vpišite ID projekta Google Cloud." };
    const result = await callProvider({
      provider,
      model,
      key: "",
      project,
      location,
      text: "Odgovori samo z besedo: da.",
      maxTokens: 8,
      brezZamenjave: true,
    });
    if (!result.ok) return { ok: false, sporocilo: result.sporocilo };
    return { ok: true, sporocilo: "Prijava Google Cloud deluje." };
  }
  const typed = typeof input.key === "string" ? input.key.trim() : "";
  const stored = saved && saved.provider === provider ? decrypt(saved, await masterKey(root)) : null;
  const key = typed || stored || envKey(provider);
  if (!key) return { ok: false, sporocilo: "Ključ ni nastavljen." };
  const result = await callProvider({
    provider,
    model,
    key,
    text: "Odgovori samo z besedo: da.",
    maxTokens: 8,
    // Preverba ne zamenja shranjenega modela; vzrok pove razumljivo (model, kljuc, dobroimetje, omejitev).
    brezZamenjave: true,
  });
  // Samo »model ni na voljo« dobi novo besedilo; ostala sporocila (in podrobna OpenRouter) ostanejo kot prej.
  if (!result.ok) return { ok: false, sporocilo: result.vzrok === "model" ? razlogVzroka(provider, "model") : result.sporocilo };
  return { ok: true, sporocilo: "Ključ deluje." };
}

/**
 * Izbira modela za pogovor z asistentko (kot izbirnik modela pri Claudu ali ChatGPT): samo med shranjenimi ponudniki in njihovimi
 * modeli. Prazen ponudnik pomeni »privzeto« (isti model kot za klice). Klice (telefonska tajnica) izbira ne spremeni.
 */
export async function izberiModelPogovora(
  input: { provider?: unknown; model?: unknown },
  token: string | null,
  dir?: string,
): Promise<BrainPublic> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const trenutno = await preberiPonudnike(root);
  let pogovor: { provider: BrainProvider; model: string } | null = null;
  const zeljen = typeof input.provider === "string" ? input.provider.trim() : "";
  if (zeljen) {
    const provider = parseProvider(zeljen);
    const model = typeof input.model === "string" ? input.model.trim() : "";
    const pogled = (await pogledPonudnikov(root)).shranjeni.find((p) => p.provider === provider);
    if (!pogled) throw new Error("Za tega ponudnika še ni shranjenega ključa.");
    if (!pogled.modeli.includes(model)) throw new Error("Izberite model s seznama shranjenih modelov.");
    pogovor = { provider, model };
  }
  await zapisiPonudnike(root, { ponudniki: trenutno.ponudniki, pogovor });
  return readBrain(token, dir);
}

/**
 * Možgani za pogovor z asistentko. B9: ce je asistentka izrecno izbrana (ponudniki.json -> pogovor), samo ta ponudnik; ce ni
 * uporaben (brez placljivega modela po izklopu stikala, neberljiv kljuc, neveljaven naslov ali projekt) null, nikoli drug ponudnik.
 * Na mozgane za klice (activeBrain) pade SAMO, ce asistentka ni posebej izbrana (privzeto = isti kot klici).
 */
export async function pogovorBrain(
  dir?: string,
): Promise<{
  provider: BrainProvider;
  model: string;
  key: string;
  project?: string;
  location?: string;
  naslov?: string;
  brezplacniDovoljeni?: boolean;
  rezervniBrezplacni?: string;
} | null> {
  const root = resolveDataDir(dir);
  const { ponudniki, pogovor, brezplacniModeli } = await preberiPonudnike(root);
  // B2 in C6: stikalo brezplacnih modelov velja samo za OpenRouter in samo prek te poti (asistentka); klici (activeBrain) ga ne dobijo.
  const zastavice = (provider: BrainProvider): { brezplacniDovoljeni?: boolean; rezervniBrezplacni?: string } => {
    if (provider !== "openrouter" || !brezplacniModeli) return {};
    const z = ponudniki.openrouter;
    const rezerva = (z ? modeliZapisa("openrouter", z) : []).find(jeTocnoBrezplacen) ?? PRIVZETI_BREZPLACNI;
    return { brezplacniDovoljeni: true, rezervniBrezplacni: rezerva };
  };
  if (!pogovor) {
    const aktivni = await activeBrain(root);
    return aktivni ? { ...aktivni, ...zastavice(aktivni.provider) } : null;
  }
  const zapis = ponudniki[pogovor.provider];
  if (!zapis || !modeliZapisa(pogovor.provider, zapis).includes(pogovor.model)) return null;
  // Izklop stikala: ne vrni :free. Prejsnji placljivi model istega ponudnika, sicer null (B9).
  const prostoInIzklopljeno = jeBrezplacenModel(pogovor.model) && !brezplacniModeli;
  const model = prostoInIzklopljeno ? modeliZapisa(pogovor.provider, zapis).find((m) => !jeBrezplacenModel(m)) : pogovor.model;
  if (!model) return null;
  try {
    if (pogovor.provider === "vertex") {
      const project = zapis.project ? gcpProject(zapis.project) : "";
      return project ? { provider: "vertex", model, key: "", project, location: gcpLocation(zapis.location) } : null;
    }
    if (pogovor.provider === "custom") {
      const n = normirajNaslov(zapis.naslov);
      if (!n.ok) return null;
      const kljuc = skrivnostZapisa("custom", zapis, await masterKey(root)) ?? "";
      return { provider: "custom", model, key: kljuc, naslov: n.naslov };
    }
    const key = skrivnostZapisa(pogovor.provider, zapis, await masterKey(root));
    return key ? { provider: pogovor.provider, model, key, ...zastavice(pogovor.provider) } : null;
  } catch {
    return null; // neveljaven projekt ali shramba: izbran ponudnik ni na voljo (B9: brez padca na drugega)
  }
}

/** Razlog, zakaj asistentka nima mozganov (pogovorBrain je vrnil null), v besedilu za lastnika. */
export async function razlogBrezAsistentke(dir?: string): Promise<string> {
  const stanje = await preberiPonudnike(resolveDataDir(dir));
  if (!stanje.pogovor) return "Lina še nima možganov. Izberite ponudnika v Nastavitve → Računalnik in ključi.";
  if (jeBrezplacenModel(stanje.pogovor.model) && !stanje.brezplacniModeli) {
    return "OpenRouter: vklopite stikalo za brezplačne modele.";
  }
  return "Izbrani ponudnik asistentke ni na voljo (ključ ali nastavitev ni veljavna). Shranite ključ znova ali izberite drug model v Nastavitve → Računalnik in ključi.";
}

// ---- Lasten OpenAI-zdruzljiv streznik (freellmapi, LM Studio, Ollama): SAMO pogovor z asistentko (naloga #43, 21. 11. 2026) -----
// Zapis je samo v ponudniki.json, nikoli v kljuci.json (ta doloca mozgane za klice): tajnica ga ne dobi (callProvider ga zavrne).

function modelLastnega(vhod: unknown): string {
  const model = typeof vhod === "string" && vhod.trim() ? vhod.trim().slice(0, 80) : DEFAULT_BRAIN_MODELS.custom;
  if (!VELJAVEN_MODEL.test(model)) throw new Error("Ime modela ni veljavno.");
  return model;
}

/**
 * Shrani lasten streznik. Kljuc je neobvezen in velja SAMO za streznik, ki mu pripada: ob spremembi naslova se stari kljuc
 * NE prenese (ne sme k drugemu gostitelju) in seznam modelov se zacne znova.
 */
export async function shraniLastniStreznik(
  input: { naslov?: unknown; model?: unknown; key?: unknown; uporabiZaPogovor?: unknown },
  token: string | null,
  dir?: string,
): Promise<BrainPublic> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const n = normirajNaslov(input.naslov);
  if (!n.ok) throw new Error(n.razlog);
  const model = modelLastnega(input.model);
  const typed = typeof input.key === "string" ? input.key.trim() : "";
  if (typed && (typed.length < 8 || typed.length > 400)) throw new Error("Ključ mora imeti med 8 in 400 znakov.");
  const trenutno = await preberiPonudnike(root);
  const prejsnji = trenutno.ponudniki.custom;
  const istiStreznik = Boolean(prejsnji) && prejsnji?.naslov === n.naslov;
  const previous = prejsnji && istiStreznik ? skrivnostZapisa("custom", prejsnji, await masterKey(root)) : null;
  const secret = typed || previous;
  if (prejsnji && !istiStreznik) {
    const { custom: _stari, ...drugi } = trenutno.ponudniki;
    await zapisiPonudnike(root, { ponudniki: drugi, pogovor: trenutno.pogovor?.provider === "custom" ? null : trenutno.pogovor });
  }
  await vpisiPonudnika(root, "custom", { model, naslov: n.naslov, ...(secret ? encrypt(secret, await masterKey(root)) : {}) });
  if (input.uporabiZaPogovor === true) {
    const po = await preberiPonudnike(root);
    await zapisiPonudnike(root, { ponudniki: po.ponudniki, pogovor: { provider: "custom", model } });
  }
  return readBrain(token, dir);
}

/** Preveri lasten streznik z enim kratkim pogovorom (ne za klice). */
export async function preveriLastniStreznik(
  input: { naslov?: unknown; model?: unknown; key?: unknown },
  token: string | null,
  dir?: string,
): Promise<{ ok: boolean; sporocilo: string }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const n = normirajNaslov(input.naslov);
  if (!n.ok) return { ok: false, sporocilo: n.razlog };
  const model = modelLastnega(input.model);
  const typed = typeof input.key === "string" ? input.key.trim() : "";
  const prejsnji = (await preberiPonudnike(root)).ponudniki.custom;
  const stored = prejsnji && prejsnji.naslov === n.naslov ? skrivnostZapisa("custom", prejsnji, await masterKey(root)) : null;
  const result = await callProvider({
    provider: "custom",
    model,
    key: typed || stored || "",
    naslov: n.naslov,
    text: "Odgovori samo z besedo: da.",
    maxTokens: 8,
    vsebinaKlica: false,
    timeoutMs: 20_000,
  });
  if (!result.ok) return { ok: false, sporocilo: result.sporocilo };
  return { ok: true, sporocilo: "Strežnik deluje." };
}

/** Odstrani lasten streznik iz nastavitev (ne brise datotek namestitve); izbira pogovora se vrne na privzeto. */
export async function odstraniLastniStreznik(token: string | null, dir?: string): Promise<BrainPublic> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const trenutno = await preberiPonudnike(root);
  const { custom: _stari, ...drugi } = trenutno.ponudniki;
  await zapisiPonudnike(root, { ponudniki: drugi, pogovor: trenutno.pogovor?.provider === "custom" ? null : trenutno.pogovor });
  return readBrain(token, dir);
}

// ---- Kljuc OpenRouter SAMO za asistentko (lastnik 24. 11. 2026, naloga C) ---------------------------------------------------------
// Zapis je samo v ponudniki.json z oznako samoAsistentka, nikoli v kljuci.json: ponudnik za klice ostane, kot ga je izbral uporabnik.

export const SOGLASJE_BREZPLACNI = "Za brezplačne modele potrdite obvestilo (ponudnik lahko sporočila uporabi za učenje).";

/**
 * C1, C2, C4: shrani kljuc za asistentko in nastavi pogovor na OpenRouter (privzeto prvi preverjeni brezplacni model).
 * Prazen kljuc ohrani ze shranjen kljuc asistentke (menjava modela). Brezplacen model brez potrditve (ali prej dane) ni sprejet;
 * potrditev vklopi stikalo brezplacnih modelov (B1). Placljiv model deluje tudi brez potrditve, vedno z deny.
 */
export async function shraniKljucAsistentke(
  input: { key?: unknown; model?: unknown; soglasje?: unknown },
  token: string | null,
  dir?: string,
): Promise<BrainPublic> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const model = typeof input.model === "string" && input.model.trim() ? input.model.trim().slice(0, 80) : PRIVZETI_BREZPLACNI;
  if (!VELJAVEN_MODEL.test(model)) throw new Error("Ime modela ni veljavno.");
  const trenutno = await preberiPonudnike(root);
  const prejsnji = trenutno.ponudniki.openrouter;
  const typed = typeof input.key === "string" ? input.key.trim() : "";
  if (typed && (typed.length < 8 || typed.length > 400)) throw new Error("Ključ mora imeti med 8 in 400 znakov.");
  // Prazno polje: ze shranjen kljuc OpenRouter (asistentke ali, ce ga ni, klicev) - uporabnik z obstojecim kljucem ga ne vpisuje znova.
  // kljuci.json se ne spremeni; zapis za asistentko dobi svojo kopijo (samoAsistentka), klici ostanejo na svojem.
  const zaKlice = await readFileState(root);
  const previous =
    (prejsnji ? skrivnostZapisa("openrouter", prejsnji, await masterKey(root)) : null) ??
    (zaKlice?.provider === "openrouter" ? decrypt(zaKlice, await masterKey(root)) : null);
  const secret = typed || previous;
  if (!secret) throw new Error("Vpišite ključ OpenRouter.");
  const soglasje = input.soglasje === true;
  if (jeBrezplacenModel(model) && !soglasje && !trenutno.brezplacniModeli) throw new Error(SOGLASJE_BREZPLACNI);
  await vpisiPonudnika(root, "openrouter", { model, samoAsistentka: true, ...encrypt(secret, await masterKey(root)) });
  const po = await preberiPonudnike(root);
  await zapisiPonudnike(root, {
    ponudniki: po.ponudniki,
    pogovor: { provider: "openrouter", model },
    brezplacniModeli: soglasje || po.brezplacniModeli,
  });
  return readBrain(token, dir);
}

/** A3, C2: odstranitev kljuca za asistentko vrne asistentko na privzeto (isti kot klici). Klicev ne spremeni. */
export async function odstraniKljucAsistentke(token: string | null, dir?: string): Promise<BrainPublic> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const trenutno = await preberiPonudnike(root);
  if (trenutno.ponudniki.openrouter?.samoAsistentka) {
    const { openrouter: _asistentka, ...drugi } = trenutno.ponudniki;
    await zapisiPonudnike(root, { ponudniki: drugi, pogovor: trenutno.pogovor?.provider === "openrouter" ? null : trenutno.pogovor });
  }
  return readBrain(token, dir);
}

/** B1, B5: stikalo »Dovoli brezplacne modele (samo asistentka)«. Hrani se v ponudniki.json, nikoli v kljuci.json. */
export async function nastaviBrezplacneModele(vklop: unknown, token: string | null, dir?: string): Promise<BrainPublic> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (typeof vklop !== "boolean") throw new Error("Neveljavna nastavitev.");
  const trenutno = await preberiPonudnike(root);
  await zapisiPonudnike(root, { ponudniki: trenutno.ponudniki, pogovor: trenutno.pogovor, brezplacniModeli: vklop });
  return readBrain(token, dir);
}

/** Preverba asistentke (pot pogovora, vsebinaKlica false): kot checkBrain, a z modelom in kljucem asistentke. */
export async function preveriAsistentko(token: string | null, dir?: string): Promise<{ ok: boolean; sporocilo: string; opozorilo?: string }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const brain = await pogovorBrain(root);
  if (!brain) {
    const stanje = await preberiPonudnike(root);
    return { ok: false, sporocilo: stanje.pogovor ? await razlogBrezAsistentke(root) : "Ključ ni nastavljen." };
  }
  const result = await callProvider({ ...brain, text: "Odgovori samo z besedo: da.", maxTokens: 8, vsebinaKlica: false, timeoutMs: 20_000 });
  if (!result.ok) return { ok: false, sporocilo: hideSecret(result.sporocilo, brain.key) };
  return { ok: true, sporocilo: `Asistentka deluje (${brain.model}).`, ...(result.povratek ? { opozorilo: result.povratek } : {}) };
}

/**
 * C3, C8: stanje racuna za kljuc asistentke (GET /api/v1/key) in seznam modelov: brez dobroimetja samo brezplacni z orodji,
 * z dobroimetjem vsi (javni GET /api/v1/models). Kljuc ostane na strezniku.
 */
export async function stanjeAsistentkeOpenRouter(
  token: string | null,
  dir?: string,
): Promise<{ ok: boolean; sporocilo: string; brezplacniRacun: boolean | null; dnevnoPreostalo: number | null; dnevnoMeja: number | null; modeli: string[] }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const { stanjeOpenRouter, modeliOpenRouter } = await import("./openrouter.server.ts");
  const zapis = (await preberiPonudnike(root)).ponudniki.openrouter;
  const kljuc = zapis ? skrivnostZapisa("openrouter", zapis, await masterKey(root)) : null;
  if (!kljuc) return { ok: false, sporocilo: "Ključ ni nastavljen.", brezplacniRacun: null, dnevnoPreostalo: null, dnevnoMeja: null, modeli: [] };
  const st = await stanjeOpenRouter(kljuc);
  const brezplacniRacun = st.ok ? st.stanje.brezplacniRacun : null;
  // Neznano stanje = previdno: samo brezplacni (placljiv model brez dobroimetja vrne 402).
  const seznam = await modeliOpenRouter(brezplacniRacun !== false);
  return {
    ok: st.ok,
    sporocilo: hideSecret(st.ok ? "" : st.sporocilo, kljuc),
    brezplacniRacun,
    dnevnoPreostalo: st.ok ? (st.stanje.dnevno?.preostalo ?? null) : null,
    dnevnoMeja: st.ok ? (st.stanje.dnevno?.meja ?? null) : null,
    modeli: seznam.ok ? seznam.modeli : [],
  };
}
