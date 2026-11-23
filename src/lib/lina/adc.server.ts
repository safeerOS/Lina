import { GoogleAuth } from "google-auth-library";
import { adcDatotekaLine } from "./google-poti.server.ts";

/**
 * Vmesnik je slovenski, zato je besedilo samo v slovenščini.
 * Če se jeziki kdaj dodajo, ostanejo tukaj.
 */
const ADC_BESEDILA = {
  sl: "Na tem računalniku ni prijave Google Cloud. Poženi: gcloud auth application-default login",
} as const;

export const ADC_MANJKA = ADC_BESEDILA.sl;

const OBSEG = "https://www.googleapis.com/auth/cloud-platform";

function manjkaPrijava(message: string): boolean {
  return /could not load the default credentials|application_default_credentials|enoent|no_adc|invalid_grant/i.test(message);
}

export type PridobljenZeton = { token: string; pretece: number | null };

async function izAdc(): Promise<PridobljenZeton> {
  // Lina lastna prijava (google-prijava) ima prednost; brez nje privzeti ADC uporabnika kot doslej.
  const lastna = adcDatotekaLine();
  const auth = new GoogleAuth(lastna ? { scopes: [OBSEG], keyFilename: lastna } : { scopes: [OBSEG] });
  const client = await auth.getClient();
  const got = await client.getAccessToken();
  const token = typeof got === "string" ? got : got?.token || "";
  const pretece = (client as { credentials?: { expiry_date?: number | null } }).credentials?.expiry_date;
  return { token, pretece: typeof pretece === "number" && Number.isFinite(pretece) ? pretece : null };
}

/** Zeton zivi samo v pomnilniku procesa, do dveh minut pred iztekom. */
const REZERVA_IZTEKA_MS = 120_000;
let shranjen: { token: string; do: number } | null = null;
/** Poveca se ob vsakem pozabiZeton: pridobitev, ki je tekla cez pozabo, zetona ne shrani. */
let rodZetona = 0;

/** Po zavrnitvi (401), odjavi, (ponovni) prijavi ali menjavi mozganov/projekta: naslednji klic zeton pridobi znova. */
export function pozabiZeton(): void {
  shranjen = null;
  rodZetona += 1;
  leti = null;
  prekliciOsvezitev();
}

/**
 * Po menjavi racuna ali mozganov (ne po pozabi racuna): veriga osvezitev in zeton se obnovita, da prvi klic po menjavi ni
 * hladen (pregled 12. 11. 2026, A3). Stikala in racuna ne ugibamo: ogrejZaKlic ju prebere iz nastavitev. Zakasnitev 1 s,
 * da je nova nastavitev ze zapisana; casovnik unref.
 */
export function obnoviOsvezevanjePoMenjavi(dir?: string): void {
  const c = setTimeout(() => {
    void import("./ogrevanje-klica.server.ts").then((m) => m.ogrejZaKlic(dir)).catch(() => undefined);
  }, 1_000);
  c.unref?.();
}

/** Ena pridobitev zetona naenkrat (pregled A4): hkratni klici (kosi TTS, hedge, osvezitev) dobijo isto obljubo. */
let leti: { rod: number; p: Promise<PridobljenZeton> } | null = null;

function enLet(pridobi: () => Promise<PridobljenZeton>): Promise<PridobljenZeton> {
  if (leti && leti.rod === rodZetona) return leti.p;
  const rod = rodZetona;
  const p = pridobi();
  const zapis = { rod, p };
  leti = zapis;
  const konec = (): void => {
    if (leti === zapis) leti = null;
  };
  p.then(konec, konec);
  return p;
}

/**
 * Vnaprejsnje osvezevanje (lastnik 12. 11. 2026: odzivnost): ko je zeton v uporabi, ga ob 80 % veljavnosti osvezimo v
 * ozadju, da noben klic ne caka na oauth2.googleapis.com. Stikalo »toplePovezave«, privzeto izklopljeno.
 * Neuporabljen zeton se ne osvezuje (brez praznega prometa); napaka osvezitve zetona ne podre, dokler ne poteče.
 */
let osvezevanjeVklop = false;
/** Vedno: osvezuje tudi neuporabljen zeton, dokler Lina tece in ima racun (odlocitev vodje 12. 11. 2026). */
let osvezujVedno = false;
let nacrtovalnik: (naredi: () => void, po: number) => ReturnType<typeof setTimeout> = (naredi, po) => setTimeout(naredi, po);
let casovnikOsvezitve: ReturnType<typeof setTimeout> | null = null;
let uporabljen = false;
let osvezuje = false;
const DELEZ_OSVEZITVE = 0.8;
/** Ponovni poskus osvezitve po napaki, dokler je shranjen zeton se veljaven. */
const PONOVITEV_OSVEZITVE_MS = 60_000;

export function nastaviOsvezevanjeZetona(
  vklop: boolean,
  nov?: (naredi: () => void, po: number) => ReturnType<typeof setTimeout>,
  vedno = false,
): void {
  osvezevanjeVklop = vklop;
  osvezujVedno = vklop && vedno;
  nacrtovalnik = nov ?? ((naredi, po) => setTimeout(naredi, po));
  if (!vklop) prekliciOsvezitev();
}

function prekliciOsvezitev(): void {
  if (casovnikOsvezitve) clearTimeout(casovnikOsvezitve);
  casovnikOsvezitve = null;
}

/** Cez koliko ms osvezimo (80 % preostale veljavnosti); null, ce izteka ne poznamo ali je ze mimo. */
export function osvezitevPoMs(zdaj: number, pretece: number | null): number | null {
  if (pretece === null || pretece <= zdaj) return null;
  return Math.round(DELEZ_OSVEZITVE * (pretece - zdaj));
}

function postaviCasovnik(naredi: () => void, po: number): void {
  prekliciOsvezitev();
  const casovnik = nacrtovalnik(naredi, po);
  casovnikOsvezitve = casovnik;
  // Casovnik ne sme drzati procesa pri zivljenju: ob zaprtju Line se ustavi sam.
  (casovnik as { unref?: () => void } | undefined)?.unref?.();
}

function nacrtajOsvezitev(pridobi: () => Promise<PridobljenZeton>, zdaj: number, pretece: number | null, rod: number): void {
  if (!osvezevanjeVklop) return;
  const po = osvezitevPoMs(zdaj, pretece);
  if (po === null) return;
  uporabljen = false;
  const osvezi = (): void => {
    casovnikOsvezitve = null;
    // Brez neskoncne zanke: po izklopu stikala, odjavi ali menjavi racuna se veriga ustavi.
    if (!osvezevanjeVklop || rod !== rodZetona || osvezuje) return;
    if (!uporabljen && !osvezujVedno) return;
    osvezuje = true;
    void enLet(pridobi)
      .then(({ token, pretece: novi }) => {
        const t = Date.now();
        if (rod !== rodZetona || !osvezevanjeVklop || !token || novi === null || novi - REZERVA_IZTEKA_MS <= t) return;
        shranjen = { token, do: novi - REZERVA_IZTEKA_MS };
        nacrtajOsvezitev(pridobi, t, novi, rod);
      })
      .catch((napaka: unknown) => {
        // Preklicana ali neveljavna prijava (invalid_grant, brez ADC): ponavljanje ne pomaga in bi vsako minuto klicalo Google
        // do izteka zetona (pregled A5). Veriga se ustavi; nov klic ali ponovna prijava jo zazene znova.
        if (manjkaPrijava(napaka instanceof Error ? napaka.message : "")) return;
        // Druga napaka ne podre veljavnega zetona; pri »vedno« poskusimo znova, dokler zeton velja.
        if (osvezujVedno && osvezevanjeVklop && rod === rodZetona && shranjen && Date.now() + PONOVITEV_OSVEZITVE_MS < shranjen.do) {
          postaviCasovnik(osvezi, PONOVITEV_OSVEZITVE_MS);
        }
      })
      .finally(() => {
        osvezuje = false;
      });
  };
  postaviCasovnik(osvezi, po);
}

/** Ogrevanje ob zacetku klica: ce zetona ni ali kmalu poteče, ga pridobi v ozadju. Napake ne vrze. */
export async function zagrejZeton(): Promise<void> {
  if (shranjen && Date.now() < shranjen.do) {
    // Zeton je ze v pomnilniku, a veriga osvezitev se ni stekla (npr. stikalo je bilo prej izklopljeno): zazeni jo.
    if (osvezujVedno && !casovnikOsvezitve && !osvezuje) nacrtajOsvezitev(pridobitevPreizkusa ?? izAdc, Date.now(), shranjen.do + REZERVA_IZTEKA_MS, rodZetona);
    return;
  }
  await vertexAccessToken().then(
    () => undefined,
    () => undefined,
  );
}

/** Za preizkus: ali je zeton v pomnilniku. Vrednosti ne vrne. */
export function zetonJeShranjen(): boolean {
  return shranjen !== null;
}

/** Rok pridobitve zetona. Osvezitev pri Googlu traja pod sekundo; visec oauth2 ne sme obesiti obrata klica. */
export const ROK_ZETONA_MS = 5_000;

/**
 * Žeton iz Application Default Credentials, obseg cloud-platform.
 * Knjižnica sama najde datoteko: na Linuxu v konfiguraciji gcloud,
 * na Windows v %APPDATA%\gcloud\application_default_credentials.json.
 * Osvežitev gre na oauth2.googleapis.com. Žeton se ne zapiše in ne vrne v besedilo napake.
 * Do 10. 11. 2026 je vsak klic modela in vsaka sinteza sestavila novega odjemalca in žeton osvežila
 * znova (dodaten omrežni krog na vsak obrat pogovora); zdaj velja isti žeton do izteka.
 * Brez znanega izteka žetona ne hranimo.
 * Pridobitev ima rok (pregled G2, S2): knjiznica svojega nima, visec klic je obesil obrat in opravilo.
 */
let pridobitevPreizkusa: (() => Promise<PridobljenZeton>) | null = null;

/** Samo za preizkuse: lazna pridobitev zetona namesto prave prijave (v preizkusih ni pravega omrezja). */
export function nastaviPridobitevZaPreizkus(pridobi: (() => Promise<PridobljenZeton>) | null): void {
  pridobitevPreizkusa = pridobi;
}

export async function vertexAccessToken(
  pridobi: () => Promise<PridobljenZeton> = pridobitevPreizkusa ?? izAdc,
  zdaj = Date.now(),
  rokMs = ROK_ZETONA_MS,
): Promise<string> {
  if (shranjen && zdaj < shranjen.do) {
    uporabljen = true;
    return shranjen.token;
  }
  shranjen = null;
  const rod = rodZetona;
  let casovnik: ReturnType<typeof setTimeout> | undefined;
  try {
    const rok = new Promise<never>((_, reject) => {
      casovnik = setTimeout(() => reject(new Error("Rok prijave Google Cloud je potekel.")), rokMs);
    });
    const tek = enLet(pridobi);
    // Pozen izid po roku ne sme postati neobravnavana zavrnitev.
    tek.catch(() => undefined);
    const { token, pretece } = await Promise.race([tek, rok]);
    if (!token) throw new Error("Could not load the default credentials.");
    // Ce je bil zeton medtem pozabljen (odjava, menjava projekta), ga ne shranimo nazaj.
    if (rod === rodZetona && pretece !== null && pretece - REZERVA_IZTEKA_MS > zdaj) {
      shranjen = { token, do: pretece - REZERVA_IZTEKA_MS };
      nacrtajOsvezitev(pridobi, zdaj, pretece, rod);
    }
    return token;
  } catch (error) {
    const raw = error instanceof Error ? error.message : "";
    if (!raw || manjkaPrijava(raw) || raw === ADC_MANJKA) throw new Error(ADC_MANJKA);
    throw new Error("Prijava Google Cloud ni uspela.");
  } finally {
    if (casovnik) clearTimeout(casovnik);
  }
}
