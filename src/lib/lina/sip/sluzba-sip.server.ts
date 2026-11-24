/**
 * SIP-2: zivljenjski cikel poti SIP. Odjemalec se zazene iz shranjenih nastavitev (sipKonfiguracija), registracija se po
 * padcu obnovi sama (odjemalec ponavlja z narascajocim zamikom; po vec zaporednih neuspehih ga sluzba zazene na novo, z novim
 * DNS in izhodnim naslovom), ob izklopu streznika se odjavi in zapre vse vticnice in casovnike.
 * Sprejem klica sledi poti Twilio Live: linija odprta, nacin podjetja, prijava Google Cloud (Vertex), pripravljen posnetek
 * pozdrava z razkritjem UI in prosta linija (isti zemljevid zasedenosti kot Twilio). Sicer klic dobi zavrnitev SIP brez govora.
 */
import { requireOwner } from "../auth.server.ts";
import { glasNaVoljo, pripravljeniKljuci } from "../glas.server.ts";
import { activeBrain } from "../keys.server.ts";
import { pravaOdvisnost } from "../live/vstop.server.ts";
import { opozoriloPotrjeno } from "../opozorilo.server.ts";
import { uvodKlica } from "../povzetek.ts";
import { loadPravila } from "../pravila.server.ts";
import { loadLine } from "../service.server.ts";
import { resolveDataDir } from "../store.server.ts";
import { osveziAktivniKlic, sprostiAktivniKlic, zasediAktivniKlic } from "../voice.server.ts";
import { MostSip, novSidSip, type MoznostiMostaSip, type OdvisnostiMostaSip } from "./most-sip.server.ts";
import { pozabiSip, preberiSip, shraniSip, sipKonfiguracija, type SipJavno, type SipVnos } from "./nastavitve.server.ts";
import { SipOdjemalec, type DohodniKlic, type SipKonfiguracija } from "./odjemalec.server.ts";

export type StanjeRegistracije = {
  /** izklopljen: ni nastavitev; zaganjam: vrata odprta, registracija tece; registriran; ponovno: napaka, nov poskus sledi. */
  stanje: "izklopljen" | "zaganjam" | "registriran" | "ponovno";
  /** Razlog zadnje napake (brez gesla in brez vsebine sporocil). */
  razlog: string;
  /** Odobrena veljavnost registracije (s). */
  expires: number | null;
  /** Cez koliko ms sledi nov poskus. */
  poskusCez: number | null;
  klicTece: boolean;
  /** Stevilo zavrnjenih datagramov SIP (brez osebnih podatkov). */
  zavrnjenih?: number;
};

export type Sprejem = { ok: true } | { ok: false; status: number; razlog: string };

export type OdvisnostiSluzbe = {
  konfiguracija(): Promise<SipKonfiguracija | null>;
  /** Ustvari odjemalca (preizkusi dodajo 127.0.0.1 in kratke casovnike). */
  odjemalec?(k: SipKonfiguracija): SipOdjemalec;
  /** Ali Lina klic sprejme (zasede linijo); sicer status SIP. */
  sprejem(callSid: string): Promise<Sprejem>;
  odvisnostiMosta(): OdvisnostiMostaSip;
  /** Sprosti linijo po koncu klica (idempotentno). */
  sprosti(callSid: string): void;
  dnevnik?(koda: string): void;
  /** Zamik ponovnega zagona odjemalca (ms). */
  zamik?: { zacetni: number; najvecji: number };
  /** Po toliko zaporednih neuspehih registracije se odjemalec zazene na novo. */
  najvecNeuspehov?: number;
  moznostiMosta?: MoznostiMostaSip;
};

export class SipSluzba {
  private readonly odv: OdvisnostiSluzbe;
  private odjemalec: SipOdjemalec | null = null;
  private readonly mostovi = new Set<MostSip>();
  private casovnik: ReturnType<typeof setTimeout> | null = null;
  private veriga: Promise<unknown> = Promise.resolve();
  private generacija = 0;
  private neuspehiZagona = 0;
  private neuspehiRegistracije = 0;
  private s: Omit<StanjeRegistracije, "klicTece"> = { stanje: "izklopljen", razlog: "", expires: null, poskusCez: null };
  /** Stevilo zagonov odjemalca (preizkusi). */
  zagonov = 0;
  /** Stevilo zavrnjenih datagramov SIP (brez osebnih podatkov). */
  zavrnjenih = 0;

  constructor(odv: OdvisnostiSluzbe) {
    this.odv = odv;
  }

  get stanje(): StanjeRegistracije {
    return { ...this.s, klicTece: this.mostovi.size > 0, zavrnjenih: this.zavrnjenih };
  }

  /** Aktivni mostovi (preizkusi). */
  get steviloKlicev(): number {
    return this.mostovi.size;
  }

  private dnevnik(koda: string): void {
    try {
      this.odv.dnevnik?.(koda);
    } catch {
      /* dnevnik ne sme podreti sluzbe */
    }
  }

  private vVrsto<T>(delo: () => Promise<T>): Promise<T> {
    const izid = this.veriga.then(delo, delo);
    this.veriga = izid.catch(() => undefined);
    return izid;
  }

  /** (Ponovni) zagon iz shranjenih nastavitev; brez nastavitev je pot SIP izklopljena. */
  uskladi(): Promise<void> {
    return this.vVrsto(async () => {
      await this.ustaviNotranje();
      await this.zazeniNotranje(++this.generacija);
    });
  }

  /** Odjava, konec klicev, zaprte vticnice in casovniki. */
  ustavi(): Promise<void> {
    return this.vVrsto(async () => {
      this.generacija += 1;
      await this.ustaviNotranje();
      this.s = { stanje: "izklopljen", razlog: "", expires: null, poskusCez: null };
    });
  }

  private nacrtujZagon(generacija: number, razlog: string, cez?: number): void {
    const z = this.odv.zamik ?? { zacetni: 2000, najvecji: 300_000 };
    const ms = cez ?? Math.min(z.najvecji, z.zacetni * 2 ** Math.min(this.neuspehiZagona, 20));
    this.neuspehiZagona += 1;
    this.s = { stanje: "ponovno", razlog, expires: null, poskusCez: ms };
    if (this.casovnik) clearTimeout(this.casovnik);
    this.casovnik = setTimeout(() => {
      this.casovnik = null;
      void this.vVrsto(async () => {
        if (generacija !== this.generacija) return;
        await this.ustaviNotranje();
        if (generacija === this.generacija) await this.zazeniNotranje(generacija);
      });
    }, ms);
    this.casovnik.unref?.();
  }

  private async zazeniNotranje(generacija: number): Promise<void> {
    let k: SipKonfiguracija | null;
    try {
      k = await this.odv.konfiguracija();
    } catch {
      k = null;
    }
    if (generacija !== this.generacija) return;
    if (!k) {
      this.s = { stanje: "izklopljen", razlog: "", expires: null, poskusCez: null };
      return;
    }
    let o: SipOdjemalec;
    try {
      o = this.odv.odjemalec ? this.odv.odjemalec(k) : new SipOdjemalec(k);
    } catch {
      this.s = { stanje: "izklopljen", razlog: "nastavitve SIP niso popolne", expires: null, poskusCez: null };
      return;
    }
    this.neuspehiRegistracije = 0;
    o.on("registriran", ({ expires }) => {
      if (this.odjemalec !== o) return;
      // Registracija je spet uspela: nacrtovan ponovni zagon ni vec potreben.
      if (this.casovnik) clearTimeout(this.casovnik);
      this.casovnik = null;
      this.neuspehiZagona = 0;
      this.neuspehiRegistracije = 0;
      this.s = { stanje: "registriran", razlog: "", expires, poskusCez: null };
      this.dnevnik("registriran");
    });
    o.on("napakaRegistracije", ({ razlog, poskusCez }) => {
      if (this.odjemalec !== o) return;
      this.neuspehiRegistracije += 1;
      this.dnevnik("registracija-napaka");
      const najvec = this.odv.najvecNeuspehov ?? 3;
      // Po vec zaporednih neuspehih (npr. nov naslov po menjavi omrezja) odjemalca zazenemo na novo, z istim zamikom.
      if (this.neuspehiRegistracije >= najvec) this.nacrtujZagon(this.generacija, razlog, poskusCez);
      else this.s = { stanje: "ponovno", razlog, expires: null, poskusCez };
    });
    o.on("klic", (klic) => void this.naKlic(klic));
    o.on("zavrnjeno", (razlog) => {
      if (this.odjemalec !== o) return;
      this.zavrnjenih += 1;
      const koda = razlog.replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "neznano";
      this.dnevnik(`sip-zavrnjeno-${koda}`);
    });
    this.odjemalec = o;
    this.zagonov += 1;
    this.s = { stanje: "zaganjam", razlog: "", expires: null, poskusCez: null };
    try {
      await o.zazeni();
    } catch (e) {
      this.dnevnik("zagon-napaka");
      if (this.odjemalec === o) this.odjemalec = null;
      await o.ustavi().catch(() => undefined);
      if (generacija === this.generacija) this.nacrtujZagon(generacija, `zagon: ${String((e as Error)?.message ?? "napaka").slice(0, 120)}`);
    }
  }

  private async ustaviNotranje(): Promise<void> {
    if (this.casovnik) clearTimeout(this.casovnik);
    this.casovnik = null;
    const o = this.odjemalec;
    this.odjemalec = null;
    const mostovi = [...this.mostovi];
    // Odjemalec ob ustavitvi konca klice (BYE / 480) in se odjavi; mostovi to vidijo kot konec klica.
    if (o) await o.ustavi().catch(() => undefined);
    await Promise.all(mostovi.map((m) => m.ustavi().catch(() => undefined)));
  }

  private async naKlic(klic: DohodniKlic): Promise<void> {
    if (this.mostovi.size > 0) return klic.zavrni(486, "Busy Here");
    const callSid = novSidSip();
    let sprejem: Sprejem;
    try {
      sprejem = await this.odv.sprejem(callSid);
    } catch {
      sprejem = { ok: false, status: 500, razlog: "Server Internal Error" };
    }
    if (!sprejem.ok) {
      this.dnevnik(`klic-zavrnjen-${sprejem.status}`);
      return klic.zavrni(sprejem.status, sprejem.razlog);
    }
    if (klic.stanje !== "zvoni") {
      // Klicatelj je odlozil med preverbo.
      this.odv.sprosti(callSid);
      return;
    }
    const most = new MostSip(klic, this.odv.odvisnostiMosta(), this.odv.moznostiMosta, callSid);
    this.mostovi.add(most);
    void most.koncan.then(() => {
      this.mostovi.delete(most);
      this.odv.sprosti(callSid);
      this.dnevnik("klic-konec");
    });
    await most.zacni();
  }
}

// ----------------------------------------------------------------------------------------------- prave odvisnosti

const NI_NA_VOLJO: Sprejem = { ok: false, status: 480, razlog: "Temporarily Unavailable" };
const BREZ_OPOZORILA: Sprejem = { ok: false, status: 503, razlog: "Service Unavailable" };

/**
 * Sprejem klica SIP po istih pogojih kot pot Twilio Live (voice.server.ts): linija odprta, nacin podjetja (Live v osebnem
 * nacinu ni dovoljen), prijava Vertex, glas in pripravljen posnetek pozdrava z razkritjem UI; nato zasedenost linije.
 */
export async function sprejemKlicaSip(root: string, callSid: string): Promise<Sprejem> {
  const [line, pravila, brain] = await Promise.all([loadLine(root), loadPravila(root), activeBrain(root)]);
  if (!line.open) return NI_NA_VOLJO;
  if (pravila.nacinKlica === "osebna") return NI_NA_VOLJO;
  if (brain?.provider !== "vertex" || !brain.project) return NI_NA_VOLJO;
  if (!(await glasNaVoljo(root))) return NI_NA_VOLJO;
  if ((await pripravljeniKljuci(uvodKlica(pravila, line.catalog.company.name), root)) === null) return NI_NA_VOLJO;
  if (!(await zasediAktivniKlic(root, callSid))) return { ok: false, status: 486, razlog: "Busy Here" };
  return { ok: true };
}

export function pravaOdvisnostSluzbe(root: string): OdvisnostiSluzbe {
  const dnevnik = (koda: string) => console.info(`[lina] sip: ${koda}`);
  const zasedenost = { osvezi: (sid: string) => osveziAktivniKlic(root, sid), sprosti: (sid: string) => sprostiAktivniKlic(root, sid) };
  return {
    konfiguracija: () => sipKonfiguracija(root),
    // Opozorilo ob prvem zagonu (lastnik 24. 11. 2026): brez potrditve »Razumem« Lina klica ne sprejme.
    sprejem: async (sid) => ((await opozoriloPotrjeno(root)) ? sprejemKlicaSip(root, sid) : BREZ_OPOZORILA),
    odvisnostiMosta: () => {
      // Iste odvisnosti kot most Twilio (nastavitve, Live prek Vertex, posnetki, zapisnik, zasedenost); zeton izda most SIP.
      const { porabiZeton: _neRabimo, ...odv } = pravaOdvisnost(root, zasedenost, dnevnik);
      return odv;
    },
    sprosti: zasedenost.sprosti,
    dnevnik,
  };
}

// ----------------------------------------------------------------------------------------------- sluzba procesa

const sluzbe = new Map<string, SipSluzba>();
const USTAVI = Symbol.for("lina.sip.ustavi");

/** Zaustavitev vseh sluzb SIP (scripts/start.mjs ob SIGINT/SIGTERM prek globalThis, ker je zagon v drugem svezenju). */
export async function ustaviVseSip(): Promise<void> {
  const vse = [...sluzbe.values()];
  sluzbe.clear();
  await Promise.all(vse.map((s) => s.ustavi()));
}

(globalThis as { [USTAVI]?: () => Promise<void> })[USTAVI] = ustaviVseSip;

/** Sluzba za mapo podatkov (ena na proces); `odvisnosti` samo za preizkuse. */
export function sluzbaSip(dir?: string, odvisnosti?: (root: string) => OdvisnostiSluzbe): SipSluzba {
  const root = resolveDataDir(dir);
  let s = sluzbe.get(root);
  if (!s) {
    s = new SipSluzba((odvisnosti ?? pravaOdvisnostSluzbe)(root));
    sluzbe.set(root, s);
  }
  return s;
}

/** Ob zagonu streznika in po spremembi nastavitev: zazene, zamenja ali ustavi odjemalca SIP. */
export function uskladiSip(dir?: string): Promise<void> {
  return sluzbaSip(dir).uskladi();
}

// ----------------------------------------------------------------------------------------------- za streznisko funkcijo

/** Nastavitve SIP za brskalnik: brez gesla, samo »geslo nastavljeno: da/ne« (imaGeslo). */
export function preberiNastavitveSip(token: string | null, dir?: string): Promise<SipJavno> {
  return preberiSip(token, dir);
}

/** Stanje registracije za brskalnik (samo prijavljen lastnik). */
export async function stanjeRegistracijeSip(token: string | null, dir?: string): Promise<StanjeRegistracije> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return sluzbe.get(root)?.stanje ?? { stanje: "izklopljen", razlog: "", expires: null, poskusCez: null, klicTece: false };
}

/** Shrani nastavitve in odjemalca zazene na novo z njimi. */
export async function shraniNastavitveSip(token: string | null, vnos: SipVnos, dir?: string): Promise<SipJavno> {
  const javno = await shraniSip(token, vnos, dir);
  await sluzbaSip(dir).uskladi();
  return javno;
}

/** Pozabi nastavitve (geslo z diska) in ustavi odjemalca. */
export async function pozabiNastavitveSip(token: string | null, dir?: string): Promise<SipJavno> {
  const javno = await pozabiSip(token, dir);
  await sluzbaSip(dir).ustavi();
  return javno;
}
