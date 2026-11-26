/**
 * Seznanjanje telefona s 6-mestno kodo (lastnik 14. 11. 2026: koda se vnese na racunalniku ALI na telefonu, rezultat je isti
 * kot s QR). Postopek je postopek Safeer Linka (core/link_hub_streznik.py: zacni_seznanitev, spake_korak1, spake_korak2):
 * SPAKE2 (spake2.ts) s soljo pair_id in AAD = odtis potrdila TLS asistentke, varovalka kode (varovalka-kode.ts), koda velja
 * KODA_VELJA_MS, najvec NAJVEC_POSKUSOV krogov in napacnih potrditev na prijavo.
 *
 * Nacin A: lastnik v Lini klikne »Povezi s kodo«, Lina pokaze kodo, telefon jo vtipka.
 * Nacin B: telefon pokaze kodo, lastnik jo vtipka v Lini pri cakajocem telefonu.
 * Oba nacina zahtevata, da je lastnik okno odprl (gumb); ena uspesna seznanitev okno zapre (koda za en telefon). Uspeh
 * dostopa NE podeli: klicatelj (asistent-streznik) prijavo preda lastniku, ki jo doda z gumbom »Dodaj« (pogodba v AGENTS.md).
 */
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { Spake2 } from "./spake2.ts";
import { VarovalkaKode } from "./varovalka-kode.ts";

/** Kot PIN_VELJA_S, NAJVEC_POSKUSOV in NAJVEC_CAKAJOCIH v core/link_hub_streznik.py. */
export const KODA_VELJA_MS = 300_000;
export const NAJVEC_POSKUSOV = 5;
export const NAJVEC_CAKAJOCIH = 8;
/** Krogov na eno kodo nacina A cez vse prijave (vec kot v Linku: tam ima vsaka prijava svojo kodo); nato se okno zapre. */
export const NAJVEC_KROGOV_KODE = 10;
/**
 * Rok za /koda/potrdi po krogu /koda/spake. Telefon, ki cA zavrne (napacna koda), po pogodbi ne poslje nic vec; po roku ali
 * ob /koda/odpovej Lina krog steje kot neuspel in v nacinu B lastniku spet odpre vnos kode (najdba telefona 414b526).
 */
export const ROK_POTRDI_MS = 10_000;
/**
 * Naloga 21 (N2): vsak vir (naslov odjemalca ali kanal releja) ima svojo varovalko z mejami Linka in BREZ kredita vabila (okno se odpira
 * samo, zato vabilo ne dokazuje lastnika); skupna varovalka (koda-varovalka.json) je visja meja cez vse vire. Tujec z enim naslovom tako
 * zaklene samo sebe, ne prave seznanitve. Najvec toliko virov v pomnilniku (najstarejsi odpade, skupna meja ostane).
 */
export const NAJVEC_VIROV_VAROVALKE = 256;
/** Kljuc vira za varovalko: IPv6 (brez ::ffff:) po prvih 4 skupinah, sicer nespremenjen (IPv4, kanal releja r:...). */
export function kljucVira(vir: string): string {
  const a = vir.toLowerCase();
  if (!a.includes(":") || a.startsWith("::ffff:") || a.startsWith("r:")) return vir;
  const [glava, rep] = a.split("%")[0].split("::");
  const g = glava ? glava.split(":") : [];
  const r = rep === undefined ? [] : rep ? rep.split(":") : [];
  const vse = [...g, ...Array<string>(Math.max(0, 8 - g.length - r.length)).fill("0"), ...r];
  return `${vse.slice(0, 4).map((x) => x.padStart(4, "0")).join(":")}::/64`;
}

/** Identiteta strani A v SPAKE2 (v Linku "safeer-link-hub"); stran B je id telefona. */
export const ID_LINE = "lina-asistent";
export const PAIR_ID = /^[A-Za-z0-9_-]{22}$/;
export const KODA = /^\d{6}$/;
/** Predpona MAC, s katerim telefon kljuc naprave veze na skupni kljuc Ke (zamenjava kljuca v zahtevi ne gre skozi). */
export const NIZ_MAC = "safeer-lina-koda-v1";

export class NapakaKode extends Error {
  readonly status: number;
  readonly koda: string;
  constructor(status: number, koda: string, sporocilo: string) {
    super(sporocilo);
    this.status = status;
    this.koda = koda;
  }
}

type Par = {
  id: string; ime: string; vir: string; cas: number; naTelefonu: boolean; koda: string | null; krogov: number; napak: number; s: Spake2 | null;
  krogCas: number;
  /** Nacin B: zadnja lastnikova koda ni bila prava - zaslon to pove ob ponovnem vnosu. */
  napacna: boolean;
};

export function macKljuca(ke: Buffer, pairId: string, id: string, kljuc: string): Buffer {
  return createHmac("sha256", ke).update(`${NIZ_MAC}\n${pairId}\n${id}\n${kljuc}`).digest();
}

/** Nova koda kot v Linku: 100000 + nakljucno < 900000 (vedno 6 mest). */
export const novaKoda = () => String(100000 + randomInt(900000));

export class SeznanitevSKodo {
  private okno: { koda: string; do: number; krogov: number } | null = null;
  private readonly pari = new Map<string, Par>();
  private readonly varovalka: VarovalkaKode;
  private readonly odtis: () => string;
  private readonly zdaj: () => number;
  private readonly koda: () => string;
  private readonly nakljucno?: { pairId?: () => string; skalar?: () => bigint };
  private rok: ReturnType<typeof setTimeout> | null = null;
  private readonly viri = new Map<string, VarovalkaKode>();
  /** Klic ob odprtju in zaprtju okna (uspeh, preklic, iztek): oglas DNS-SD tece samo vmes (mdns-oglas.server.ts). */
  obOdprtju?: () => void;
  obZaprtju?: () => void;

  /** `nakljucno` je SAMO za preizkus (skupni vektorji TS <-> Kotlin): znan pair_id in skalar SPAKE2 namesto nakljucnih. */
  constructor(o: { varovalka: VarovalkaKode; odtis: () => string; zdaj?: () => number; koda?: () => string; nakljucno?: { pairId?: () => string; skalar?: () => bigint } }) {
    this.varovalka = o.varovalka;
    this.odtis = o.odtis;
    this.zdaj = o.zdaj ?? Date.now;
    this.koda = o.koda ?? novaKoda;
    this.nakljucno = o.nakljucno;
  }

  /** Lastnik odpre okno (gumb »Povezi s kodo«): nova koda za nacin A; prejsnja koda in prijave ne veljajo vec. */
  odpri(): { koda: string; do: number } {
    this.pari.clear();
    this.okno = { koda: this.koda(), do: this.zdaj() + KODA_VELJA_MS, krogov: 0 };
    if (this.rok) clearTimeout(this.rok);
    // iztek okna zapre tudi, ce ga nihce ne vprasa (oglas se ustavi po 5 min)
    this.rok = setTimeout(() => this.odprto(), KODA_VELJA_MS + 50);
    this.rok.unref?.();
    try { this.obOdprtju?.(); } catch { /* oglas ni pogoj za seznanitev */ }
    return { koda: this.okno.koda, do: this.okno.do };
  }

  zapri(): void {
    const bilo = !!this.okno;
    this.okno = null;
    this.pari.clear();
    if (this.rok) clearTimeout(this.rok);
    this.rok = null;
    if (bilo) try { this.obZaprtju?.(); } catch { /* oglas ni pogoj za seznanitev */ }
  }

  /** Varovalka enega vira (N2); nov vir izrine najstarejsega, ko jih je NAJVEC_VIROV_VAROVALKE. IPv6 po predponi /64 (SLAAC: naslovov je brez meje). */
  private varovalkaVira(vir0: string): VarovalkaKode {
    const vir = kljucVira(vir0);
    let v = this.viri.get(vir);
    if (!v) {
      if (this.viri.size >= NAJVEC_VIROV_VAROVALKE) this.viri.delete(this.viri.keys().next().value as string);
      this.viri.set(vir, (v = new VarovalkaKode({ ura: () => this.zdaj() / 1000 })));
    }
    return v;
  }

  /** Lastnik je odklenil povezovanje s kodo: tudi zapore posameznih virov se pocistijo. */
  ponastaviVire(): void {
    this.viri.clear();
  }

  odprto(): boolean {
    if (this.okno && this.zdaj() >= this.okno.do) this.zapri();
    return !!this.okno;
  }

  private pocisti(): void {
    const t = this.zdaj();
    for (const [k, p] of this.pari) {
      if (t - p.cas > KODA_VELJA_MS) this.pari.delete(k);
      else if (p.s && t - p.krogCas > ROK_POTRDI_MS) this.neuspel(p);
    }
  }

  /** Krog brez potrditve: steje ze ob /koda/spake (krogov, varovalka); v nacinu B lastnik kodo vtipka znova. */
  private neuspel(p: Par): void {
    p.s = null;
    if (p.naTelefonu) {
      p.koda = null;
      p.napacna = true;
    }
  }

  /** Telefon zacne prijavo; id in ime je klicatelj ze preveril. */
  zacni(vir: string, id: string, ime: string, naTelefonu: boolean) {
    if (!this.odprto()) throw new NapakaKode(403, "ni_odprto", "Na racunalniku najprej kliknite Povezi s kodo.");
    this.pocisti();
    if (this.pari.size >= NAJVEC_CAKAJOCIH) throw new NapakaKode(429, "prevec_cakajocih", "Prevec cakajocih prijav.");
    // okno je odprl lastnik sam: to je »vabilo« v smislu link_varovalka (med zaporo najvec KREDIT_VABILA poskusov)
    if (!this.varovalkaVira(vir).zacetek(vir) || !this.varovalka.zacetek(vir, true)) throw new NapakaKode(429, "seznanitev_zaprta", "Povezovanje s kodo je zaradi prevec poskusov zaprto.");
    const pairId = this.nakljucno?.pairId?.() ?? randomBytes(16).toString("base64url");
    this.pari.set(pairId, { id, ime, vir, cas: this.zdaj(), naTelefonu, koda: null, krogov: 0, napak: 0, s: null, krogCas: 0, napacna: false });
    return { pair_id: pairId, nacin: "spake2", hub_id: ID_LINE, fp: this.odtis(), expires_in_seconds: Math.max(0, Math.trunc(((this.okno as { do: number }).do - this.zdaj()) / 1000)) };
  }

  /** Telefoni nacina B, ki cakajo, da lastnik vtipka kodo z njihovega zaslona. */
  cakajoKodo(): Array<{ pairId: string; id: string; ime: string; napacna: boolean }> {
    if (!this.odprto()) return [];
    this.pocisti();
    return [...this.pari].filter(([, p]) => p.naTelefonu && p.koda === null).map(([pairId, p]) => ({ pairId, id: p.id, ime: p.ime, napacna: p.napacna }));
  }

  /** Lastnik vtipka kodo, ki jo kaze telefon (nacin B). */
  vnesiKodo(pairId: string, koda: string): void {
    const p = this.odprto() ? this.pari.get(pairId) : undefined;
    if (!p || !p.naTelefonu || p.koda !== null) throw new Error("Ta telefon ne caka vec na kodo.");
    const k = koda.replace(/\s+/g, "");
    if (!KODA.test(k)) throw new Error("Koda ima 6 stevk.");
    p.koda = k;
    p.napacna = false;
  }

  private par(pairId: string, id: string): Par {
    this.pocisti();
    const p = this.odprto() ? this.pari.get(pairId) : undefined;
    if (!p || p.id !== id) throw new NapakaKode(404, "prijava_ne_obstaja", "Prijava ne obstaja ali je potekla.");
    return p;
  }

  /** En krog SPAKE2 = en poskus kode (tudi v skupni varovalki). Vrne pA in potrditev cA. */
  spake(pairId: string, id: string, pb: Buffer): { pa: Buffer; ca: Buffer } {
    const p = this.par(pairId, id);
    const okno = this.okno as { koda: string; krogov: number };
    const koda = p.naTelefonu ? p.koda : okno.koda;
    if (koda === null) throw new NapakaKode(409, "caka_kodo", "Lastnik kode s telefona se ni vtipkal.");
    p.krogov += 1;
    if (!p.naTelefonu) okno.krogov += 1;
    if (p.krogov > NAJVEC_POSKUSOV || okno.krogov > NAJVEC_KROGOV_KODE) {
      this.pari.delete(pairId);
      if (okno.krogov > NAJVEC_KROGOV_KODE) this.zapri();
      throw new NapakaKode(429, "prevec_poskusov", "Prevec poskusov; na racunalniku kliknite Povezi s kodo znova.");
    }
    if (!this.varovalkaVira(p.vir).poskus(p.vir) || !this.varovalka.poskus(p.vir, true)) {
      this.pari.delete(pairId);
      throw new NapakaKode(429, "seznanitev_zaprta", "Povezovanje s kodo je zaradi prevec poskusov zaprto.");
    }
    try {
      const s = Spake2.streznik(koda, ID_LINE, p.id, Buffer.from(this.odtis(), "utf8"), Buffer.from(pairId, "utf8"), this.nakljucno?.skalar?.());
      const { potrditev } = s.zakljuci(pb);
      p.s = s;
      p.krogCas = this.zdaj();
      return { pa: s.sporocilo(), ca: potrditev };
    } catch {
      p.s = null;
      throw new NapakaKode(400, "neveljavna_tocka", "Tocka pB ni veljavna.");
    }
  }

  /**
   * Potrditev telefona cB in MAC kljuca naprave s Ke. Uspeh pomeni isto kodo IN isto potrdilo TLS (AAD); okno se zapre
   * (ena koda, en telefon). Vrne Ke za klicatelja; dostopa ne podeli.
   */
  potrdi(pairId: string, id: string, kljuc: string, cb: Buffer, mac: Buffer): void {
    const p = this.par(pairId, id);
    const s = p.s;
    p.s = null;
    if (!s || !s.ke) throw new NapakaKode(409, "manjka_korak", "Najprej korak spake.");
    const pricakovan = macKljuca(s.ke, pairId, id, kljuc);
    const dober = s.preveri(cb) && mac.length === pricakovan.length && timingSafeEqual(mac, pricakovan);
    if (!dober) {
      p.napak += 1;
      if (p.napak >= NAJVEC_POSKUSOV) {
        this.pari.delete(pairId);
        throw new NapakaKode(429, "prevec_poskusov", "Prevec poskusov; na racunalniku kliknite Povezi s kodo znova.");
      }
      this.neuspel(p); // lastnik se je morda zatipkal: kodo vtipka znova
      throw new NapakaKode(401, "napacna_koda", "Koda ni prava.");
    }
    this.varovalkaVira(p.vir).uspeh(p.vir);
    this.varovalka.uspeh(p.vir);
    this.zapri();
  }

  /**
   * Telefon javi, da cA ni veljal (napacna koda ali drug odtis): isto kot iztek ROK_POTRDI_MS, le takoj. Krog je ze stet;
   * odpoved ne podeli nicesar in ne vrne poskusa.
   */
  odpovej(pairId: string, id: string): void {
    const p = this.par(pairId, id);
    if (!p.s) throw new NapakaKode(409, "manjka_korak", "Ni kroga za odpoved.");
    this.neuspel(p);
  }

  stanje(): { odprto: boolean; koda: string; do: number; cakajoKodo: Array<{ pairId: string; id: string; ime: string; napacna: boolean }> } {
    const o = this.odprto() ? this.okno : null;
    return { odprto: !!o, koda: o?.koda ?? "", do: o?.do ?? 0, cakajoKodo: this.cakajoKodo() };
  }
}
