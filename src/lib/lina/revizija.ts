/**
 * Revizijska veriga (naloga #45, lastnik 21. 11. 2026; ideja: AgenticOS, Apache-2.0, revizijski dnevnik z zgoscenimi
 * vrednostmi). Vsak vnos nosi SHA-256 prejsnjega vnosa, zato poznejsi poseg v dnevnik (sprememba, brisanje ali
 * vrinjen vnos) pokvari verigo in se pozna. Cista logika brez datotek; zapis na disk je v revizija.server.ts.
 *
 * Meje (pošteno): veriga sama ne ubrani nekomu, ki prepise CELOTNO datoteko in vse zgoscene vrednosti izracuna znova.
 * Zato obstaja SIDRO (zadnji n + zgoscena vrednost), ki ga lastnik izvozi in hrani drugje; preverba s sidrom ujame
 * okrnitev in prepis. Dnevnik ne sme vsebovati skrivnosti (kljuci, zetoni): vnos z njimi se zavrne.
 * Komentarji so brez sumnikov.
 */
import { createHash } from "node:crypto";

export const NICELNA_ZGOSCENA = "0".repeat(64);
export const NAJVEC_OPISA = 300;
export const NAJVEC_KLJUCEV_PODATKOV = 12;
export const NAJVEC_VREDNOSTI = 200;
const VRSTA = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const KLJUC_PODATKA = /^[a-zA-Z][a-zA-Z0-9_]{0,29}$/;
// Samo stirimestna leta (razsirjena leta niso dovoljena); natancna oblika izhaja iz obhodnega preverjanja toISOString.
const CAS = /^\d{4}-/;
const HEX64 = /^[a-f0-9]{64}$/;
// eslint-disable-next-line no-control-regex
const KONTROLNI_ZNAKI = /[\u0000-\u001f\u007f]/;

export type Podatki = Record<string, string | number | boolean | null>;
export type VhodVnosa = { vrsta: string; opis: string; podatki?: Podatki };
export type Vnos = { n: number; cas: string; vrsta: string; opis: string; podatki: Podatki; prejsnja: string; zgoscena: string };
export type Sidro = { n: number; zgoscena: string };

export type IzidSestave = { ok: true; vnos: Vnos } | { ok: false; razlog: string };
export type RazlogPokvarjene = "oblika" | "zaporedje" | "povezava" | "zgoscena" | "cas" | "vsebina" | "sidro";
export type IzidPreverbe = { ok: true; stevilo: number; zadnja: string } | { ok: false; n: number; razlog: RazlogPokvarjene };

// Oblike znanih skrivnosti. Namenoma samo izrecne oblike: dolga zgoscena vrednost vsebine (64 hex) ni skrivnost.
const SKRIVNOSTI: RegExp[] = [
  /freellmapi-[A-Za-z0-9_-]{16,}/,
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export function vsebujeSkrivnost(besedilo: string): boolean {
  return SKRIVNOSTI.some((r) => r.test(besedilo));
}

function jeNiz(v: unknown): v is string {
  return typeof v === "string";
}

/** Vsebinska pravila, enaka pri sestavi in pri preverbi (kar je bilo zapisano, mora spet iti skozi). */
function napakaVsebine(vrsta: unknown, opis: unknown, podatki: unknown): string | null {
  if (!jeNiz(vrsta) || !VRSTA.test(vrsta)) return "vrsta";
  if (!jeNiz(opis) || opis.trim().length === 0 || opis.length > NAJVEC_OPISA || KONTROLNI_ZNAKI.test(opis)) return "opis";
  if (vsebujeSkrivnost(opis)) return "skrivnost";
  if (typeof podatki !== "object" || podatki === null || Array.isArray(podatki)) return "podatki";
  const kljuci = Object.keys(podatki);
  if (kljuci.length > NAJVEC_KLJUCEV_PODATKOV) return "podatki";
  for (const k of kljuci) {
    if (!KLJUC_PODATKA.test(k)) return "podatki";
    const v = (podatki as Record<string, unknown>)[k];
    if (v === null || typeof v === "boolean") continue;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return "podatki";
      continue;
    }
    if (!jeNiz(v) || v.length > NAJVEC_VREDNOSTI || KONTROLNI_ZNAKI.test(v)) return "podatki";
    if (vsebujeSkrivnost(v)) return "skrivnost";
  }
  return null;
}

/** Kanonicna oblika: polje, ne objekt, da vrstni red kljucev in dvoumnosti ne vplivajo na zgoscevanje. */
export function izracunajZgosceno(v: Omit<Vnos, "zgoscena">): string {
  const kanon = JSON.stringify([v.n, v.cas, v.vrsta, v.opis, Object.keys(v.podatki).sort().map((k) => [k, v.podatki[k]]), v.prejsnja]);
  return createHash("sha256").update(kanon, "utf8").digest("hex");
}

/**
 * Sestavi naslednji vnos. Ura, ki bi skocila nazaj, se ne vpise nazaj: cas ostane enak casu prejsnjega vnosa
 * (veriga mora ostati nepadajoca).
 */
export function sestaviVnos(prejsnji: Vnos | null, vhod: VhodVnosa, zdaj: Date): IzidSestave {
  // Samo manjkajoci podatki (undefined) pomenijo prazne; null ali drugo se zavrne.
  const podatki = vhod.podatki === undefined ? {} : vhod.podatki;
  const napaka = napakaVsebine(vhod.vrsta, vhod.opis, podatki);
  if (napaka) return { ok: false, razlog: napaka };
  const ms = zdaj.getTime();
  if (!Number.isFinite(ms)) return { ok: false, razlog: "cas" };
  const prejsnjiMs = prejsnji ? Date.parse(prejsnji.cas) : -Infinity;
  const cas = new Date(Math.max(ms, prejsnjiMs)).toISOString();
  const brez: Omit<Vnos, "zgoscena"> = {
    n: prejsnji ? prejsnji.n + 1 : 1,
    cas,
    vrsta: vhod.vrsta,
    opis: vhod.opis,
    podatki: { ...podatki },
    prejsnja: prejsnji ? prejsnji.zgoscena : NICELNA_ZGOSCENA,
  };
  return { ok: true, vnos: { ...brez, zgoscena: izracunajZgosceno(brez) } };
}

const KLJUCI_VNOSA = ["cas", "n", "opis", "podatki", "prejsnja", "vrsta", "zgoscena"];

function jeOblikaVnosa(v: unknown): v is Vnos {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).sort().join(",") !== KLJUCI_VNOSA.join(",")) return false;
  return Number.isInteger(o.n) && jeNiz(o.cas) && jeNiz(o.vrsta) && jeNiz(o.opis) && typeof o.podatki === "object" && jeNiz(o.prejsnja) && jeNiz(o.zgoscena);
}

/** Preveri celotno verigo; ob prvi napaki pove, pri katerem vnosu (n) in zakaj. Sidro je neobvezno. */
export function preveriVerigo(vnosi: unknown, sidro?: Sidro): IzidPreverbe {
  if (!Array.isArray(vnosi)) return { ok: false, n: 0, razlog: "oblika" };
  let prejsnja = NICELNA_ZGOSCENA;
  let prejsnjiMs = -Infinity;
  for (let i = 0; i < vnosi.length; i++) {
    const v: unknown = vnosi[i];
    const n = i + 1;
    if (!jeOblikaVnosa(v)) return { ok: false, n, razlog: "oblika" };
    if (v.n !== n) return { ok: false, n, razlog: "zaporedje" };
    if (!HEX64.test(v.prejsnja) || !HEX64.test(v.zgoscena)) return { ok: false, n, razlog: "oblika" };
    if (v.prejsnja !== prejsnja) return { ok: false, n, razlog: "povezava" };
    if (!CAS.test(v.cas)) return { ok: false, n, razlog: "cas" };
    const ms = Date.parse(v.cas);
    if (!Number.isFinite(ms) || new Date(ms).toISOString() !== v.cas || ms < prejsnjiMs) return { ok: false, n, razlog: "cas" };
    if (napakaVsebine(v.vrsta, v.opis, v.podatki)) return { ok: false, n, razlog: "vsebina" };
    const { zgoscena, ...brez } = v;
    if (izracunajZgosceno(brez) !== zgoscena) return { ok: false, n, razlog: "zgoscena" };
    prejsnja = zgoscena;
    prejsnjiMs = ms;
  }
  if (sidro !== undefined) {
    const ujema =
      Number.isInteger(sidro.n) && sidro.n >= 1 && HEX64.test(sidro.zgoscena) && vnosi.length >= sidro.n && (vnosi[sidro.n - 1] as Vnos).zgoscena === sidro.zgoscena;
    if (!ujema) return { ok: false, n: Number.isInteger(sidro.n) ? sidro.n : 0, razlog: "sidro" };
  }
  return { ok: true, stevilo: vnosi.length, zadnja: prejsnja };
}

/** Sidro za izvoz (zadnji vnos). Prazna veriga sidra nima. */
export function sidroIzVerige(vnosi: Vnos[]): Sidro | null {
  const zadnji = vnosi[vnosi.length - 1];
  return zadnji ? { n: zadnji.n, zgoscena: zadnji.zgoscena } : null;
}
