import { requireOwner } from "./auth.server.ts";
import { ponudnikNeposredno, preveriPotrdilo, veljavnaDomena, zunanjiPreizkus, type IzidPreizkusa } from "./neposredno.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";
import { Upravljalec, izprazniSinhrono as izprazniSinhronoNaslov, ponudnikCloudflared, zapisiNaslov, type KljukeNaslova, type PonudnikTunela, type StanjeTunela } from "./tunel.server.ts";

/**
 * Izbira poti javnega naslova (lastnik 12. 11. 2026, kot Safeer Link: neposredno privzeto, rezerva samo ob izpadu):
 *  - neposredno: domena uporabnika + javno potrdilo + preusmerjena vrata (Caddy),
 *  - tunel: hitri tunel Cloudflare (rezerva, brez racuna),
 *  - samodejno: najprej neposredno (ce je domena nastavljena in preizkus uspe), sicer tunel; ob izpadu preklop na tunel in nazaj.
 * Algoritem izpada (vzorec iz lina-ponovna-raba-porocilo.md): kratek preizkus 1,5 s, ob neuspehu takoj rezerva, neuspeh se zapomni
 * s premorom 300 s, podvojenim do 1800 s, nato ponovno preverjanje; uspeh premor zbrise.
 */
export type NacinPoti = "samodejno" | "neposredno" | "tunel";
export type AktivnaPot = "neposredno" | "tunel" | null;
export type KodaRazloga =
  | "izklopljeno"
  | "neposredno-deluje"
  | "neposredno-izbrano"
  | "tunel-izbran"
  | "ni-domene"
  | "neposredno-napaka"
  | "neposredno-pauza"
  | "neposredno-izpad"
  | "neposredno-spet";

export type StanjePoti = {
  nacin: NacinPoti;
  domena: string;
  vklopljeno: boolean;
  aktivna: AktivnaPot;
  naslov: string | null;
  razlog: KodaRazloga;
  podrobnost: string | null;
  /** Nasvet iz zunanjega preizkusa (ni pogoj in ne preklaplja poti): npr. usmerjevalnik brez dostopa iz notranjega omrezja. */
  nasvet: string | null;
  pauzaSek: number | null;
  neposredno: StanjeTunela;
  tunel: StanjeTunela;
};

const DATOTEKA = "tunel-nastavitve.json";
export const PAUZA_PRVA_SEK = 300;
export const PAUZA_NAJVEC_SEK = 1800;
const NASTAVITVE_PRIVZETE = { nacin: "samodejno" as NacinPoti, domena: "" };
const NACINI = new Set<string>(["samodejno", "neposredno", "tunel"]);

export type OdvisnostiPoti = {
  zdaj?: () => number;
  ponudnikNeposredno?: (domena: string) => PonudnikTunela;
  ponudnikTunel?: () => PonudnikTunela;
  /** Zunanji preizkus: SAMO nasvet (ne preklaplja poti). */
  preizkus?: (domena: string) => Promise<IzidPreizkusa>;
  /** Lokalno zdravje neposredne poti: Caddy streze veljavno javno potrdilo na 127.0.0.1:8443. Ta odloca o preklopu. */
  lokalniPreizkus?: (domena: string) => Promise<boolean>;
  vrataLine?: number;
  /** Interval nadzora v ms; 0 = brez casovnika (preizkusi pokliceio pregled sami). */
  intervalMs?: number;
};

export async function preberiNastavitvePoti(root: string): Promise<{ nacin: NacinPoti; domena: string }> {
  const raw = await readJsonFile<{ nacin?: unknown; domena?: unknown }>(root, DATOTEKA);
  const nacin = typeof raw?.nacin === "string" && NACINI.has(raw.nacin) ? (raw.nacin as NacinPoti) : NASTAVITVE_PRIVZETE.nacin;
  const domena = typeof raw?.domena === "string" ? (veljavnaDomena(raw.domena) ?? "") : "";
  return { nacin, domena };
}

export async function nastaviPot(token: string | null, vnos: { nacin?: unknown; domena?: unknown }, dir?: string): Promise<{ nacin: NacinPoti; domena: string }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (typeof vnos.nacin !== "string" || !NACINI.has(vnos.nacin)) throw new Error("Neveljavna izbira poti.");
  const surova = typeof vnos.domena === "string" ? vnos.domena.trim() : "";
  const domena = surova === "" ? "" : veljavnaDomena(surova);
  if (domena === null) throw new Error("Domena ni veljavna (na primer lina.moja-domena.si, brez https:// in poti).");
  const nastavitve = { nacin: vnos.nacin as NacinPoti, domena };
  await writeJson(root, DATOTEKA, nastavitve);
  return nastavitve;
}

/** Koliko zaporednih neuspelih LOKALNIH preizkusov pred preklopom na tunel (pregled P4: napadalec ne sme preklopa izsiliti z enim izpadom). */
export const NEUSPEHOV_ZA_PREKLOP = 3;

export class IzbiraPoti {
  private readonly zdaj: () => number;
  private readonly odv: OdvisnostiPoti;
  private readonly nep: Upravljalec;
  private readonly tun: Upravljalec;
  private nacin: NacinPoti = "samodejno";
  private domena = "";
  private root: string | null = null;
  private vklopljeno = false;
  /** Stevec vklopov/izklopov: asinhrona dela (vklop, nadzor) po vsakem await preverijo, da je njihov zagon se veljaven (pregled P5). */
  private gen = 0;
  private zdravo = true;
  private neuspehov = 0;
  private pauzaSek = 0;
  private pauzaDo = 0;
  private razlog: KodaRazloga = "izklopljeno";
  private podrobnost: string | null = null;
  private nasvet: string | null = null;
  private vpisan = "";
  private casovnik: NodeJS.Timeout | null = null;
  private pregledTece = false;

  constructor(odv: OdvisnostiPoti = {}) {
    this.odv = odv;
    this.zdaj = odv.zdaj ?? Date.now;
    const kljuke: KljukeNaslova = {
      zapisi: (root) => this.uskladi(root),
      // Izprazni TA naslov v pravilih (samo ce ga polje se nosi; pregled P2), nato uskladi z drugo potjo.
      izprazni: async (root, naslov) => {
        if (this.vpisan === naslov) this.vpisan = "";
        await zapisiNaslov(root, "", naslov);
        await this.uskladi(root);
      },
      // Ob izhodu procesa: vsak upravljalec izprazni polje samo, ce nosi njegov naslov (sinhrono, brez seje).
      izprazniSinhrono: (root, naslov) => izprazniSinhronoNaslov(root, naslov),
    };
    this.nep = new Upravljalec("neposredno", kljuke);
    this.tun = new Upravljalec("tunel", kljuke);
  }

  private pNep(): PonudnikTunela {
    return (this.odv.ponudnikNeposredno ?? ((d: string) => ponudnikNeposredno(d)))(this.domena);
  }
  private pTun(): PonudnikTunela {
    return (this.odv.ponudnikTunel ?? (() => ponudnikCloudflared()))();
  }
  private preizkus(domena: string): Promise<IzidPreizkusa> {
    return (this.odv.preizkus ?? ((d: string) => zunanjiPreizkus(d, 5000)))(domena);
  }
  private lokalno(domena: string): Promise<boolean> {
    return (this.odv.lokalniPreizkus ?? preveriPotrdilo)(domena);
  }

  /** Kateri naslov mora biti zdaj v pravilih (cista odlocitev iz stanja). */
  zeljenaPot(): { pot: AktivnaPot; naslov: string | null } {
    const n = this.nep.naslovTece();
    const t = this.tun.naslovTece();
    if (!this.vklopljeno) return { pot: null, naslov: null };
    if (this.nacin === "tunel") return t ? { pot: "tunel", naslov: t } : { pot: null, naslov: null };
    if (this.nacin === "neposredno") return n ? { pot: "neposredno", naslov: n } : { pot: null, naslov: null };
    if (n && this.zdravo) return { pot: "neposredno", naslov: n };
    if (t) return { pot: "tunel", naslov: t };
    if (n) return { pot: "neposredno", naslov: n };
    return { pot: null, naslov: null };
  }

  private async uskladi(root: string): Promise<void> {
    const naslov = this.zeljenaPot().naslov ?? "";
    if (naslov === this.vpisan) return;
    const prej = this.vpisan;
    this.vpisan = naslov;
    if (naslov) await zapisiNaslov(root, naslov);
    else if (prej) await zapisiNaslov(root, "", prej);
  }

  private zapomniNeuspeh(): void {
    this.pauzaSek = this.pauzaSek === 0 ? PAUZA_PRVA_SEK : Math.min(this.pauzaSek * 2, PAUZA_NAJVEC_SEK);
    this.pauzaDo = this.zdaj() + this.pauzaSek * 1000;
  }
  private pobrisiNeuspeh(): void {
    this.pauzaSek = 0;
    this.pauzaDo = 0;
    this.neuspehov = 0;
  }

  private async naloziNastavitve(root: string): Promise<void> {
    const n = await preberiNastavitvePoti(root);
    this.nacin = n.nacin;
    this.domena = n.domena;
  }

  /** Siroti obeh upravljalcev (padec Line, SIGKILL): ustavi po PID in izprazni star naslov; lastna zagnana procesa preskoci. */
  private async pospraviSirote(root: string): Promise<void> {
    await this.nep.pospraviSirote(root, "caddy").catch(() => undefined);
    await this.tun.pospraviSirote(root, "cloudflared").catch(() => undefined);
  }

  async stanje(token: string | null, dir?: string): Promise<StanjePoti> {
    const root = resolveDataDir(dir);
    await requireOwner(token, root);
    await this.naloziNastavitve(root);
    await this.pospraviSirote(root);
    return this.sestavi(root);
  }

  private sestavi(root: string): StanjePoti {
    const { pot, naslov } = this.zeljenaPot();
    const preostalo = this.pauzaDo > this.zdaj() ? Math.ceil((this.pauzaDo - this.zdaj()) / 1000) : null;
    return {
      nacin: this.nacin,
      domena: this.domena,
      vklopljeno: this.vklopljeno,
      aktivna: pot,
      naslov,
      razlog: this.razlog,
      podrobnost: this.podrobnost,
      nasvet: this.nasvet,
      pauzaSek: preostalo,
      neposredno: this.nep.stanje(root, this.pNep()),
      tunel: this.tun.stanje(root, this.pTun()),
    };
  }

  private async osveziNasvet(g: number): Promise<void> {
    if (!this.domena) return;
    const r = await this.preizkus(this.domena).catch(() => ({ ok: false as const, razlog: "Preizkus ni uspel." }));
    if (g === this.gen) this.nasvet = r.ok ? null : r.razlog;
  }

  async vklopi(token: string | null, dir?: string): Promise<StanjePoti> {
    const root = resolveDataDir(dir);
    await requireOwner(token, root);
    await this.naloziNastavitve(root);
    await this.pospraviSirote(root);
    this.root = root;
    const g = ++this.gen;
    this.vklopljeno = true;
    this.zdravo = true;
    this.podrobnost = null;
    this.nasvet = null;
    this.pobrisiNeuspeh();
    const vrata = this.odv.vrataLine;
    // Izklop med vklopom (pregled P5): vse, kar je ta vklop zagnal, takoj ustavimo.
    const zastarelo = async (): Promise<boolean> => {
      if (g === this.gen && this.vklopljeno) return false;
      await this.nep.izklopiInterno(root, this.pNep());
      await this.tun.izklopiInterno(root, this.pTun());
      return true;
    };
    if (this.nacin === "tunel") {
      await this.tun.vklopiInterno(root, this.pTun(), vrata);
      if (await zastarelo()) return this.sestavi(root);
      this.razlog = "tunel-izbran";
      this.podrobnost = this.tun.razlog;
    } else if (this.nacin === "neposredno") {
      if (!this.domena) {
        this.razlog = "ni-domene";
      } else {
        await this.nep.vklopiInterno(root, this.pNep(), vrata);
        if (await zastarelo()) return this.sestavi(root);
        this.razlog = this.nep.faza === "tece" ? "neposredno-izbrano" : "neposredno-napaka";
        this.podrobnost = this.nep.razlog;
        if (this.nep.faza === "tece") await this.osveziNasvet(g);
      }
    } else if (!this.domena) {
      this.razlog = "ni-domene";
      await this.tun.vklopiInterno(root, this.pTun(), vrata);
      if (await zastarelo()) return this.sestavi(root);
    } else {
      await this.nep.vklopiInterno(root, this.pNep(), vrata);
      if (await zastarelo()) return this.sestavi(root);
      if (this.nep.faza === "tece") {
        this.razlog = "neposredno-deluje";
        await this.osveziNasvet(g);
      } else {
        // Neposredna pot ni uspela: rezerva takoj, neuspeh se zapomni (premor 300 s -> 1800 s).
        this.podrobnost = this.nep.razlog;
        this.razlog = "neposredno-napaka";
        this.zapomniNeuspeh();
        await this.tun.vklopiInterno(root, this.pTun(), vrata);
        if (await zastarelo()) return this.sestavi(root);
      }
    }
    await this.uskladi(root);
    this.zazeniNadzor();
    return this.sestavi(root);
  }

  async izklopi(token: string | null, dir?: string): Promise<StanjePoti> {
    const root = resolveDataDir(dir);
    await requireOwner(token, root);
    this.gen++;
    this.vklopljeno = false;
    if (this.casovnik) clearInterval(this.casovnik);
    this.casovnik = null;
    await this.nep.izklopiInterno(root, this.pNep());
    await this.tun.izklopiInterno(root, this.pTun());
    // Tudi sirote iz prejsnjega teka (pregled P2): po izklopu ne sme ostati nobenega procesa ali naslova.
    await this.pospraviSirote(root);
    this.razlog = "izklopljeno";
    this.podrobnost = null;
    this.nasvet = null;
    this.pobrisiNeuspeh();
    await this.uskladi(root);
    return this.sestavi(root);
  }

  private zazeniNadzor(): void {
    const ms = this.odv.intervalMs ?? 30_000;
    if (ms <= 0 || this.casovnik) return;
    this.casovnik = setInterval(() => void this.pregled().catch(() => undefined), ms);
    this.casovnik.unref?.();
  }

  /**
   * Nadzor (vsakih 30 s, v preizkusih rocno): samo v samodejnem nacinu. Zdravje neposredne poti merimo LOKALNO (Caddy streze veljavno
   * potrdilo na 127.0.0.1:8443, proces ziv); NEUSPEHOV_ZA_PREKLOP zaporednih neuspehov preklopi na tunel. Zunanji preizkus je samo nasvet
   * in ne preklaplja ter ne zadrzi tunela (pregled P4, hairpin NAT). Po premoru se neposredna pot preveri znova; ob uspehu se vrnemo
   * nanjo, tunel pa ustavimo.
   */
  async pregled(): Promise<void> {
    const root = this.root;
    if (!root || !this.vklopljeno || this.nacin !== "samodejno" || !this.domena || this.pregledTece) return;
    this.pregledTece = true;
    const g = this.gen;
    // Po vsakem await: ce je lastnik medtem izklopil, ustavimo, kar smo pravkar zagnali, in koncamo (pregled P5).
    const zastarelo = async (): Promise<boolean> => {
      if (g === this.gen && this.vklopljeno) return false;
      await this.nep.izklopiInterno(root, this.pNep());
      await this.tun.izklopiInterno(root, this.pTun());
      return true;
    };
    try {
      const vrata = this.odv.vrataLine;
      if (this.nep.faza === "tece") {
        const ok = await this.lokalno(this.domena);
        if (await zastarelo()) return;
        if (this.zdravo) {
          if (ok) this.neuspehov = 0;
          else if (++this.neuspehov >= NEUSPEHOV_ZA_PREKLOP) {
            this.zdravo = false;
            this.podrobnost = "Caddy ne streže več veljavnega potrdila za domeno.";
            this.razlog = "neposredno-izpad";
            this.zapomniNeuspeh();
            if (this.tun.faza !== "tece") {
              await this.tun.vklopiInterno(root, this.pTun(), vrata);
              if (await zastarelo()) return;
            }
          }
        } else if (this.zdaj() >= this.pauzaDo) {
          if (ok) {
            this.zdravo = true;
            this.razlog = "neposredno-spet";
            this.podrobnost = null;
            this.pobrisiNeuspeh();
            await this.tun.izklopiInterno(root, this.pTun());
          } else {
            this.zapomniNeuspeh();
          }
        }
        if (this.zdravo) {
          await this.osveziNasvet(g);
          if (await zastarelo()) return;
        }
      } else if (this.zdaj() >= this.pauzaDo) {
        await this.nep.vklopiInterno(root, this.pNep(), vrata);
        if (await zastarelo()) return;
        if ((this.nep.faza as string) === "tece") {
          this.zdravo = true;
          this.razlog = "neposredno-spet";
          this.podrobnost = null;
          this.pobrisiNeuspeh();
          await this.tun.izklopiInterno(root, this.pTun());
        } else {
          this.podrobnost = this.nep.razlog;
          this.zapomniNeuspeh();
          if (this.tun.faza !== "tece") {
            await this.tun.vklopiInterno(root, this.pTun(), vrata);
            if (await zastarelo()) return;
          }
        }
      }
      await this.uskladi(root);
    } finally {
      this.pregledTece = false;
    }
  }

  async namestiNeposredno(soglasje: unknown, token: string | null, dir?: string): Promise<StanjePoti> {
    const root = resolveDataDir(dir);
    await this.naloziNastavitve(root);
    await this.nep.namesti(soglasje, token, dir, this.pNep());
    return this.sestavi(root);
  }
  async namestiTunel(soglasje: unknown, token: string | null, dir?: string): Promise<StanjePoti> {
    const root = resolveDataDir(dir);
    await this.naloziNastavitve(root);
    await this.tun.namesti(soglasje, token, dir, this.pTun());
    return this.sestavi(root);
  }
}

/** Privzeta izbira poti procesa; funkcije streznika uporabljajo to. */
export const pot = new IzbiraPoti();
