/**
 * Cisti gradniki za zagon OpenLine kot otroka racunalniske Line:
 * izdelava in preverba kljuca API, sestava strogo omejenega okolja otroka
 * (brez dedovanja process.env) ter razclenjevanje in zbiranje izpisa otroka.
 * Brez diska, omrezja in zagona procesov.
 */
import { randomBytes } from "node:crypto";
import path from "node:path";
import { zasebenNaslov } from "./zasebno-omrezje.server.ts";

export const PRIVZETA_VRATA_OPENLINE = 8787;

const VZOREC_KLJUCA_API = /^[A-Za-z0-9_-]{32,128}$/;
const VZOREC_IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const VZOREC_ZETONA = /^[A-Za-z0-9._~+/=-]{16,512}$/;
const VZOREC_ODTISA = /^[0-9a-fA-F]{64}$/;
const VZOREC_STEVILKE = /^[0-9+*#() -]{3,32}$/;
const VZOREC_NADZORNIH = /[\u0000-\u001f\u007f-\u009f]/;
const VZOREC_ODTISA_Z_DVOPICJI = /^[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){31}$/;

const MAX_DOLZINA_POTI = 400;
const MAX_STEVILK_SEZNAMA = 200;
const MAX_DOLZINA_RAZCLENJENE_VRSTICE = 300;
const MAX_DOLZINA_VRSTICE_ZBIRALNIKA = 1024;
const MAX_BAJTOV_ZBIRALNIKA = 65536;

const PREDPONA_NASLOV = "OpenLine slusa na ";
const PREDPONA_ODTIS = "Odtis certifikata SHA-256: ";

/** 32 nakljucnih bajtov kot base64url (43 znakov). Skrivnost: nikoli v dnevnik ali napako. */
export function novKljucApi(): string {
  return randomBytes(32).toString("base64url");
}

/** niz dolzine 32..128, samo [A-Za-z0-9_-], ni "change-me" */
export function jeVeljavenKljucApi(v: unknown): v is string {
  if (typeof v !== "string" || v === "change-me") return false;
  return VZOREC_KLJUCA_API.test(v);
}

export type DovoljeniKlici = { nacin: "vse" | "seznam"; stevilke: string[] };

export type VhodOkolja = {
  kljucApi: string;
  naslov: string;
  vrata: number;
  dataDir: string;
  linaNaslov: string;
  linaVrata: number;
  linaZeton: string;
  linaOdtis: string;
  dovoljeni: DovoljeniKlici;
};

function napakaPolja(ime: string): Error {
  return new Error(`neveljavno polje: ${ime}`);
}

function jeZasebenIpv4(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = VZOREC_IPV4.exec(v);
  if (!m) return false;
  for (let i = 1; i <= 4; i += 1) {
    const del = m[i];
    if (del.length > 1 && del.startsWith("0")) return false;
    if (Number(del) > 255) return false;
  }
  return zasebenNaslov(v);
}

function jeVeljavnaVrata(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1024 && v <= 65535;
}

function jeVeljavnaMapaPodatkov(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (v.length === 0 || v.length > MAX_DOLZINA_POTI) return false;
  if (v.includes("\0")) return false;
  if (!path.isAbsolute(v)) return false;
  const odseki = v.split(/[\\/]/);
  if (odseki.includes("..")) return false;
  return true;
}

function preveriDovoljene(v: unknown): { mode: "off" | "on"; seznam: string | null } {
  if (v === null || typeof v !== "object") throw napakaPolja("dovoljeni");
  const d = v as { nacin?: unknown; stevilke?: unknown };
  if (d.nacin !== "vse" && d.nacin !== "seznam") throw napakaPolja("dovoljeni");
  if (!Array.isArray(d.stevilke)) throw napakaPolja("dovoljeni");
  if (d.nacin === "vse") return { mode: "off", seznam: null };
  if (d.stevilke.length > MAX_STEVILK_SEZNAMA) throw napakaPolja("dovoljeni");
  const videne = new Set<string>();
  const ciste: string[] = [];
  for (const surova of d.stevilke) {
    if (typeof surova !== "string" || /[\r\n]/.test(surova)) throw napakaPolja("dovoljeni");
    const cista = surova.trim();
    if (!VZOREC_STEVILKE.test(cista)) throw napakaPolja("dovoljeni");
    if (!videne.has(cista)) {
      videne.add(cista);
      ciste.push(cista);
    }
  }
  return { mode: "on", seznam: ciste.length > 0 ? ciste.join(",") : null };
}

/** Okolje otroka: SAMO ti kljuci (ob veljavnem vhodu), nikoli ni dedovano iz process.env. Vrne nov objekt. */
export function sestaviOkoljeOpenLine(v: VhodOkolja): Record<string, string> {
  if (v === null || typeof v !== "object") throw napakaPolja("vhod");
  if (!jeVeljavenKljucApi(v.kljucApi)) throw napakaPolja("kljucApi");
  if (!jeZasebenIpv4(v.naslov)) throw napakaPolja("naslov");
  if (!jeVeljavnaVrata(v.vrata)) throw napakaPolja("vrata");
  if (!jeVeljavnaMapaPodatkov(v.dataDir)) throw napakaPolja("dataDir");
  if (!jeZasebenIpv4(v.linaNaslov)) throw napakaPolja("linaNaslov");
  if (!jeVeljavnaVrata(v.linaVrata)) throw napakaPolja("linaVrata");
  if (typeof v.linaZeton !== "string" || !VZOREC_ZETONA.test(v.linaZeton)) throw napakaPolja("linaZeton");
  if (typeof v.linaOdtis !== "string" || !VZOREC_ODTISA.test(v.linaOdtis)) throw napakaPolja("linaOdtis");
  const { mode, seznam } = preveriDovoljene(v.dovoljeni);

  const okolje: Record<string, string> = {
    ELECTRON_RUN_AS_NODE: "1",
    HTTP_GATEWAY_API_KEY: v.kljucApi,
    HOST: v.naslov,
    PORT: String(v.vrata),
    DATA_DIR: v.dataDir,
    PUBLIC_URL: `https://${v.naslov}:${v.vrata}`,
    LINA_STREAM_URL: `wss://${v.linaNaslov}:${v.linaVrata}/api/voice/telefon`,
    LINA_STREAM_TOKEN: v.linaZeton,
    LINA_CERT_SHA256: v.linaOdtis.toLowerCase(),
    LINA_ALLOWLIST_MODE: mode,
  };
  if (seznam !== null) {
    okolje.LINA_ALLOWLIST = seznam;
  }
  return okolje;
}

export type RazclenjenaVrstica =
  | { vrsta: "naslov"; url: string; vrata: number }
  | { vrsta: "odtis"; odtis: string };

/** Razcleni eno vrstico izpisa OpenLine v naslov ali odtis potrdila; vse ostalo vrne null. */
export function razcleniVrsticoOpenLine(vrstica: string): RazclenjenaVrstica | null {
  if (typeof vrstica !== "string") return null;
  const cista = vrstica.trim();
  if (cista.length === 0 || cista.length > MAX_DOLZINA_RAZCLENJENE_VRSTICE) return null;
  if (VZOREC_NADZORNIH.test(cista)) return null;

  if (cista.startsWith(PREDPONA_NASLOV)) {
    const surovUrl = cista.slice(PREDPONA_NASLOV.length);
    if (!surovUrl.startsWith("https://")) return null;
    if (/[\s@?#]/.test(surovUrl)) return null;

    const brezSheme = surovUrl.slice("https://".length);
    const brezKoncne = brezSheme.endsWith("/") ? brezSheme.slice(0, -1) : brezSheme;
    if (brezKoncne.length === 0 || brezKoncne.includes("/")) return null;

    // Vrata morajo biti izrecno navedena (tudi ce gre za privzeta 443).
    const ujemVrat = /:(\d+)$/.exec(brezKoncne);
    if (!ujemVrat) return null;
    const nizVrat = ujemVrat[1];
    if (nizVrat.startsWith("0")) return null;
    const vrata = Number(nizVrat);
    if (!Number.isInteger(vrata) || vrata < 1 || vrata > 65535) return null;

    let u: URL;
    try {
      u = new URL(surovUrl);
    } catch {
      return null;
    }
    if (u.protocol !== "https:") return null;
    if (u.hostname.length === 0) return null;
    if (u.username !== "" || u.password !== "") return null;
    if (u.pathname !== "/" || u.search !== "" || u.hash !== "") return null;
    if (u.port !== "" && Number(u.port) !== vrata) return null;

    const url = u.port !== "" ? u.origin : `${u.origin}:${vrata}`;
    return { vrsta: "naslov", url, vrata };
  }

  if (cista.startsWith(PREDPONA_ODTIS)) {
    const surovOdtis = cista.slice(PREDPONA_ODTIS.length);
    if (!VZOREC_ODTISA_Z_DVOPICJI.test(surovOdtis)) return null;
    return { vrsta: "odtis", odtis: surovOdtis.replace(/:/g, "").toLowerCase() };
  }

  return null;
}

/** Zbiralnik kosov izpisa otroka z omejitvijo dolzine vrstice in skupnih bajtov. */
export class ZbiralnikIzpisa {
  #dekoder = new TextDecoder("utf-8", { fatal: false });
  #medpomnilnik = "";
  #zavrziDoNl = false;
  #obdelanihBajtov = 0;
  #naslov: { url: string; vrata: number } | null = null;
  #odtis: string | null = null;

  dodaj(kos: Buffer | string): void {
    try {
      if (this.#obdelanihBajtov >= MAX_BAJTOV_ZBIRALNIKA) return;
      const ostalo = MAX_BAJTOV_ZBIRALNIKA - this.#obdelanihBajtov;

      let bajti: Uint8Array;
      if (kos instanceof Uint8Array) {
        bajti = kos.byteLength > ostalo ? kos.subarray(0, ostalo) : kos;
      } else if (typeof kos === "string") {
        // Najvec ostalo kodnih enot UTF-16 vedno pokrije vsaj ostalo bajtov UTF-8.
        const omejenNiz = kos.length > ostalo ? kos.slice(0, ostalo) : kos;
        const buf = Buffer.from(omejenNiz, "utf8");
        bajti = buf.byteLength > ostalo ? buf.subarray(0, ostalo) : buf;
      } else {
        return;
      }

      if (bajti.byteLength === 0) return;
      this.#obdelanihBajtov += bajti.byteLength;

      const besedilo = this.#dekoder.decode(bajti, { stream: true });
      this.#obdelajBesedilo(besedilo);
    } catch {
      // dodaj nikoli ne vrze
    }
  }

  naslov(): { url: string; vrata: number } | null {
    return this.#naslov ? { url: this.#naslov.url, vrata: this.#naslov.vrata } : null;
  }

  odtis(): string | null {
    return this.#odtis;
  }

  pripravljen(): boolean {
    return this.#naslov !== null && this.#odtis !== null;
  }

  #obdelajBesedilo(besedilo: string): void {
    let zac = 0;
    while (zac < besedilo.length) {
      const konec = besedilo.indexOf("\n", zac);
      if (konec === -1) {
        if (!this.#zavrziDoNl) {
          const ostanek = besedilo.slice(zac);
          const skupaj = this.#medpomnilnik.length + ostanek.length;
          if (skupaj > MAX_DOLZINA_VRSTICE_ZBIRALNIKA + 1) {
            this.#medpomnilnik = "";
            this.#zavrziDoNl = true;
          } else if (skupaj === MAX_DOLZINA_VRSTICE_ZBIRALNIKA + 1) {
            const cel = this.#medpomnilnik + ostanek;
            if (cel.endsWith("\r")) {
              this.#medpomnilnik = cel;
            } else {
              this.#medpomnilnik = "";
              this.#zavrziDoNl = true;
            }
          } else {
            this.#medpomnilnik += ostanek;
          }
        }
        return;
      }

      if (this.#zavrziDoNl) {
        this.#zavrziDoNl = false;
        this.#medpomnilnik = "";
      } else {
        const del = besedilo.slice(zac, konec);
        const skupaj = this.#medpomnilnik.length + del.length;
        if (skupaj <= MAX_DOLZINA_VRSTICE_ZBIRALNIKA + 1) {
          let vrstica = this.#medpomnilnik + del;
          if (vrstica.endsWith("\r")) vrstica = vrstica.slice(0, -1);
          if (vrstica.length <= MAX_DOLZINA_VRSTICE_ZBIRALNIKA) {
            this.#zabeleziVrstico(vrstica);
          }
        }
        this.#medpomnilnik = "";
      }
      zac = konec + 1;
    }
  }

  #zabeleziVrstico(vrstica: string): void {
    const izid = razcleniVrsticoOpenLine(vrstica);
    if (!izid) return;
    if (izid.vrsta === "naslov" && this.#naslov === null) {
      this.#naslov = { url: izid.url, vrata: izid.vrata };
    } else if (izid.vrsta === "odtis" && this.#odtis === null) {
      this.#odtis = izid.odtis;
    }
  }
}
