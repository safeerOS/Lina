import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, link, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { obnoviOsvezevanjePoMenjavi, pozabiZeton } from "./adc.server.ts";
import { requireOwner } from "./auth.server.ts";
import { callProvider, gcpLocation, gcpProject } from "./providers.ts";
import { normirajNaslov } from "./lastni-streznik.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";
import { DEFAULT_BRAIN_MODELS, type BrainProvider, type BrainPublic, type ShranjenPonudnik } from "./types.ts";

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
};

type PonudnikiFile = {
  ponudniki?: Partial<Record<BrainProvider, PonudnikZapis>>;
  pogovor?: { provider: BrainProvider; model: string } | null;
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
  return { ponudniki, pogovor };
}

async function zapisiPonudnike(root: string, datoteka: PonudnikiFile): Promise<void> {
  await writeJson(root, PONUDNIKI_DATOTEKA, datoteka);
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
}> {
  const { ponudniki, pogovor } = await preberiPonudnike(root);
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
    if (skrivnost) shranjeni.push({ provider, namig: hint(skrivnost), model, modeli });
  }
  const veljavna = pogovor && shranjeni.some((p) => p.provider === pogovor.provider && p.modeli.includes(pogovor.model)) ? pogovor : null;
  return { shranjeni, pogovor: veljavna };
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

function publicVertex(saved: KeyFile): BrainPublic {
  return {
    provider: "vertex",
    model: saved.model || DEFAULT_BRAIN_MODELS.vertex,
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
    model: saved.model || DEFAULT_BRAIN_MODELS[saved.provider],
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

export async function saveBrain(
  input: { provider?: unknown; model?: unknown; key?: unknown; project?: unknown; location?: unknown },
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
  const model = typeof input.model === "string" && input.model.trim() ? input.model.trim().slice(0, 80) : DEFAULT_BRAIN_MODELS[provider];
  if (provider === "vertex") {
    const project = gcpProject(input.project);
    if (!project) throw new Error("Vpišite ID projekta Google Cloud.");
    const location = gcpLocation(input.location);
    const next: KeyFile = { provider, model, project, location };
    await writeJson(root, "kljuci.json", next);
    await lock(path.join(root, "kljuci.json"));
    await vpisiPonudnika(root, provider, { model, project, location });
    return { ...publicVertex(next), ...(await pogledPonudnikov(root)) };
  }
  // Kljuc velja samo za ponudnika, ki mu pripada: stari kljuc drugega ponudnika se NE prenese (xAI kljuc ne sme k OpenAI).
  const prejsnji = (await preberiPonudnike(root)).ponudniki[provider];
  const previous = prejsnji ? skrivnostZapisa(provider, prejsnji, await masterKey(root)) : null;
  const typed = typeof input.key === "string" ? input.key.trim() : "";
  if (typed && (typed.length < 8 || typed.length > 400)) {
    throw new Error("Ključ mora imeti med 8 in 400 znakov.");
  }
  const secret = typed || previous;
  const next: KeyFile = {
    provider,
    model,
    ...(secret ? encrypt(secret, await masterKey(root)) : {}),
  };
  await writeJson(root, "kljuci.json", next);
  await lock(path.join(root, "kljuci.json"));
  if (next.ciphertext) await vpisiPonudnika(root, provider, { model, iv: next.iv, tag: next.tag, ciphertext: next.ciphertext });
  return {
    provider,
    model,
    nastavljen: Boolean(secret),
    namig: hint(secret),
    projekt: null,
    lokacija: null,
    ...(await pogledPonudnikov(root)),
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
  if (saved && isProvider(saved.provider) && saved.provider !== "custom") {
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
    if (key) return { provider: saved.provider, model: saved.model || DEFAULT_BRAIN_MODELS[saved.provider], key };
  }
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
  });
  if (!result.ok) return { ok: false, sporocilo: result.sporocilo };
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

/** Možgani za pogovor z asistentko: izbrani model, ce je izbran in uporaben, sicer aktivni ponudnik (kot za klice). */
export async function pogovorBrain(
  dir?: string,
): Promise<{ provider: BrainProvider; model: string; key: string; project?: string; location?: string; naslov?: string } | null> {
  const root = resolveDataDir(dir);
  const { ponudniki, pogovor } = await preberiPonudnike(root);
  const zapis = pogovor ? ponudniki[pogovor.provider] : undefined;
  if (pogovor && zapis && modeliZapisa(pogovor.provider, zapis).includes(pogovor.model)) {
    try {
      if (pogovor.provider === "vertex") {
        const project = zapis.project ? gcpProject(zapis.project) : "";
        if (project) return { provider: "vertex", model: pogovor.model, key: "", project, location: gcpLocation(zapis.location) };
      } else if (pogovor.provider === "custom") {
        const n = normirajNaslov(zapis.naslov);
        if (n.ok) {
          const kljuc = skrivnostZapisa("custom", zapis, await masterKey(root)) ?? "";
          return { provider: "custom", model: pogovor.model, key: kljuc, naslov: n.naslov };
        }
      } else {
        const key = skrivnostZapisa(pogovor.provider, zapis, await masterKey(root));
        if (key) return { provider: pogovor.provider, model: pogovor.model, key };
      }
    } catch {
      /* neveljaven projekt ali shramba: nazaj na aktivnega ponudnika */
    }
  }
  return activeBrain(root);
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
