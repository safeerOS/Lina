/**
 * Most Twilio Media Streams <-> Gemini Live (naloga-live, lastnik 11. 11. 2026). Ena instanca LiveMost na klic.
 * Cista logika brez omrezja in diska: vse zunanje (zeton, Live, zapisnik, posnetki, zasedenost, ura) je vbrizgano, zato
 * preizkusi tecejo brez Twilia in brez pravega modela.
 *
 * Model govori NEPOSREDNO (zvok iz modela gre v klic), zato PRED izgovorom ni besedila, ki bi ga koda preverila. Varovalke
 * so zato v kodi in delujejo med govorom: (1) pozdrav z razkritjem UI je stalni posnetek, ne model; (2) prepis izhoda se
 * preverja sproti in ob denarnem signalu, obljubi, roku, garanciji ali dostavi most poslje Twilio 'clear', zavrze preostanek
 * odgovora in predvaja stalni posnetek; (3) uro (opozorilo 30 s pred iztekom, slovo) vodi koda; (4) podatke povprasevanja
 * zapise koda (absorbUtterance ... nad prepisom klicatelja), funkcijo zakljuci_povprasevanje koda potrdi.
 * Live zvok pogosto tece hitreje od realnega casu in ga Twilio shrani v medpomnilnik: 'clear' zato pogosto ujame odgovor
 * prej, kot je izgovorjen (izmerjeno v porocilu most-porocilo.md; ni zagotovljeno za prvih nekaj besed).
 */
import { razlogVarovalkeGovora } from "../odgovor-znanje.ts";
import { fazaTrajanja } from "../trajanje.ts";
import type { Catalog } from "../types.ts";
import { IzhodLiveVTwilio, OKVIR_BAJTOV, VhodTwilioVLive, bajtiVPcm, pcmVBajte, razrezi, type CistilnikPcm } from "./zvok.ts";
import { MEJA_SPOROCILA_TWILIO, razberiTwilio, twilioClear, twilioMark, twilioMedia } from "./twilio-sporocila.ts";

export type TwilioVrata = {
  poslji(besedilo: string): void;
  zapri(koda?: number, razlog?: string): void;
};

export type LiveSporocilo = Record<string, unknown>;

export type LiveSeja = {
  poslji(sporocilo: object): void;
  zapri(): void;
};

export type LiveOdpri = (povezava: {
  setup: object;
  onSporocilo(sporocilo: LiveSporocilo): void;
  onZaprto(razlog: string): void;
}) => Promise<LiveSeja>;

export type PoljaIzOrodja = {
  ime?: string;
  podjetje?: string;
  telefon?: string;
  eposta?: string;
  izdelek?: string;
  rok?: string;
  povratniKlic?: string;
  sporocilo?: string;
  potrdil?: boolean;
};

export type SonioxMostSeja = {
  poslji(pcm16k: Uint8Array): void;
  zakljuci(): Promise<void>;
  zapri(): void;
};

export type ZapisnikLive = {
  zacni(vhod: { callSid: string; from: string; pozdrav: string }): Promise<void>;
  izrek(callSid: string, besedilo: string): Promise<void>;
  odgovor(callSid: string, besedilo: string): Promise<void>;
  vrzel(vprasanje: string): Promise<void>;
  cas(callSid: string, faza: "opozorilo" | "potek"): Promise<{ besedilo: string; konec: boolean } | null>;
  povprasevanje(callSid: string, polja: PoljaIzOrodja, izreki: readonly string[], zadnjiIzrek: string): Promise<{ sprejeto: string[]; zavrnjeno: string[] }>;
  zakljuci(callSid: string): Promise<void>;
  dobesedno?(callSid: string, besedilo: string): Promise<void>;
};

export type NastavitveMosta = {
  /** Celotno sporocilo setup za Live (sistemsko navodilo, glas, orodja ...). Gradi ga navodilo.ts. */
  setup: object;
  katalog: Catalog;
  /** Linin pozdrav z razkritjem UI; predvaja ga koda (stalni posnetek), ne model. */
  pozdrav: string;
  /** Stalni stavek ob varovalki (nastavitev uporabnika, privzeto »Na to vprasanje vam bo odgovoril sodelavec ...«). */
  temaOdgovor: string;
  /** Stavek, ko Live ne dela (ni povezave, seja se je zaprla). */
  oprostilo: string;
  najdaljsiMinut: number | null;
  /** Ciscenje stalnega suma pri zvoku klicatelja; privzeto VKLOPLJENO, samo izrecni false izklopi (zvok-ciscenje.server.ts). */
  ciscenjeZvoka?: boolean;
};

export type OdvisnostiMosta = {
  /** Preveri in porabi zeton; vrne izid in stevilko klicatelja. */
  porabiZeton(zeton: string, callSid: string): { izid: string; from: string };
  nalozi(): Promise<NastavitveMosta>;
  odpriLive: LiveOdpri;
  zapisnik: ZapisnikLive;
  zasedenost: { osvezi(callSid: string): void; sprosti(callSid: string): void };
  /** Stalni posnetek besedila kot mu-law 8 kHz; null, ce ga ni (potem velja nadomestek). */
  posnetek(besedilo: string): Promise<Uint8Array | null>;
  /**
   * Pot telefona (L3): zacetek klica opravi prilagodilnik (live/telefon-prikljucek.ts): pozdrav z razkritjem UI je PRVI zvok
   * (surov PCM 16 kHz, zacniKlicTelefon iz L4) in sele nato poklice `odpri` (Live seja; trajanje pozdrava v ms drzi vhod do
   * njegovega konca). Vrne false = pozdrav zavrnjen (brez razkritja ali posnetka), klic se konca in Live se NE odpre.
   * Brez te odvisnosti velja pot Twilio (posnetek mu-law, ta datoteka).
   */
  zacetekKlica?(pozdrav: string, odpri: (trajanjeMs: number) => Promise<void>): Promise<boolean>;
  /** Ura v ms (vbrizgana v preizkusih). */
  ura?: () => number;
  /** Korak ure mosta (ms); preizkusi ga skrajsajo. */
  tikMs?: number;
  /** Dnevnik brez vsebine pogovora in brez skrivnosti: samo koda dogodka. */
  dnevnik?: (koda: string) => void;
  /** Izbirni dodatek Soniox za dobesedni zapis govora klicatelja; brez te odvisnosti se obnasanje ne spremeni. */
  soniox?: {
    odpri(callSid: string, naBesedilo: (kos: string) => void): SonioxMostSeja | null | Promise<SonioxMostSeja | null>;
  };
  /** Najdaljsi rok cakanja zakljucka Soniox v ms (privzeto 3000 ms; preizkusi ga lahko skrajsajo). */
  sonioxRokZakljuckaMs?: number;
  /**
   * RNNoise pred Live (naloga 17a, za stikalom »Zmanjsanje hrupa«): nov cistilnik za en klic pri 8 kHz (Twilio/SIP) ali 16 kHz
   * (telefon kot prehod). null ali napaka = kot prej (Twilio/SIP samo Wiener, telefon brez filtra). Brez te odvisnosti nic novega.
   */
  ciscenjeRnnoise?: (frekvenca: 8000 | 16000) => CistilnikPcm | null;
};

/**
 * Pot Twilio/SIP z RNNoise: tudi Wiener pred njim (true) ali samo RNNoise (false). Prava odvisnost (vstop.server.ts) za 8 kHz zdaj
 * vrne null: po meritvi WER (naloga 17a, POROCILO.md) ostane samo Wiener; vezava ostane za meritev na pravem hrupu tiskarne.
 */
export const WIENER_Z_RNNOISE = true;

export const OPOZORILO_PRED_IZTEKOM_MS = 30_000;
export const ROK_ZAKLJUCKA_SONIOX_MS = 3_000;
const NAJVEC_SONIOX_VRSTA_BAJTOV = 96_000;
const NAJVEC_PREDPOMNILNIKA_VHODA = 250;
const NAJVEC_IZREKOV = 60;
const ROK_ODPRTJA_LIVE_MS = 12_000;
const ROK_ORODJA_MS = 12_000;
const ROK_ZAPORE_VAROVALKE_MS = 20_000;
const MIRNO_PRED_OPOZORILOM_MS = 800;
const NAJVEC_ZAMIKA_SLOVA_MS = 5_000;
const OSVEZI_ZASEDENOST_MS = 30_000;
const MIRNO_ZAKLJUCEK_IZREKA_MS = 2_500;
const NAJVEC_PREPISA = 4_000;

/**
 * Kos prepisa Live doda za prejsnjim. Gemini kos z novim stavkom vcasih poslje brez presledka (»...dneDober«):
 * kos z veliko zacetnico za crko ali za .!? dobi presledek; nadaljevanje besede (mala crka) ali kos s presledkom ostane.
 * Enak popravek kot v telefonu (SejaKlica.dodajLocenoZaNovStavek, 23. 11. 2026).
 */
export function dodajKosPrepisa(prej: string, kos: string): string {
  if (prej && /^\p{Lu}/u.test(kos) && /[\p{L}.!?]$/u.test(prej)) return `${prej} ${kos}`;
  return `${prej}${kos}`;
}

/** Kako se besedilo (opozorilo o izteku) vbrizga v Live. Doloceno z meritvijo pri pravem modelu (most-porocilo.md). */
export type NacinBesedila = "clientContent" | "realtimeInput";

export const ORODJE_ZAKLJUCEK = "zakljuci_povprasevanje";

function normaliziraj(besedilo: string): string {
  return besedilo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Razbrani dogodek Twilio (oblika iz razberiTwilio v twilio-sporocila.ts). */
type DogodekTwilio =
  | { event: "connected" }
  | { event: "stop" }
  | { event: "dtmf" }
  | { event: "mark"; ime: string }
  | { event: "start"; start: { streamSid: string; callSid: string; zeton: string } }
  | { event: "media"; zvok: Uint8Array; sled: string };

/** Privzeti rok za Twilio start v ms: povezava brez starta v tem casu se zapre (ne zaseda mesta). */
const ROK_STARTA_MS = 10_000;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);
const niz = (v: unknown): string => (typeof v === "string" ? v : "");

export class LiveMost {
  private faza: "caka" | "zacenjam" | "dela" | "konec" = "caka";
  private streamSid = "";
  private callSid = "";
  private from = "";
  private nastavitve: NastavitveMosta | null = null;
  private live: LiveSeja | null = null;
  private liveNared = false;
  private cas0 = 0;
  private vhodPretvornik = new VhodTwilioVLive(true);
  /** RNNoise za telefon kot prehod (16 kHz): ustvari se ob prvem kosu, ce je stikalo vklopljeno; null = brez filtra. */
  private ciscenje16k: CistilnikPcm | null = null;
  private ciscenje16kDovoljeno = false;
  private readonly izhodPretvornik = new IzhodLiveVTwilio();
  private predpomnilnikVhoda: Uint8Array[] = [];
  /** Do kdaj predvajamo pozdrav (vhod ne gre v Live, dokler traja). */
  private pozdravDo = 0;
  /** Do kdaj Twilio predvaja ze poslani zvok (ura mosta). */
  private predvajanoDo = 0;
  private vhodPrepis = "";
  private vhodZadnji = 0;
  private izhodPrepis = "";
  private izreki: string[] = [];
  private zadnjiIzrek = "";
  private blokiran = false;
  private zapora: ReturnType<typeof setTimeout> | null = null;
  private stevecMark = 0;
  private cakamMark: { ime: string; potem: () => void } | null = null;
  private zakljucekPoTurnu = false;
  private slovoVTeku = false;
  private opozorjen = false;
  private potekPo = 0;
  private zadnjeOsvezevanje = 0;
  private dovoljeni: string[] = [];
  private tikCasovnik: ReturnType<typeof setInterval> | null = null;
  private zakljucekCasovnik: ReturnType<typeof setTimeout> | null = null;
  private startCasovnik: ReturnType<typeof setTimeout> | null = null;
  private vrsta: Promise<unknown> = Promise.resolve();
  private konecObljuba: Promise<void> | null = null;
  private zapisnikZacet = false;
  private varovalke = 0;
  private soniox: SonioxMostSeja | null = null;
  private sonioxZacet = false;
  private sonioxPripravljen = false;
  private sonioxOdpiranje: Promise<SonioxMostSeja | null> | null = null;
  private sonioxVrsta: Uint8Array[] = [];
  private sonioxVrstaBajtov = 0;
  private sonioxKosi: string[] = [];
  private sonioxDobesednoPoslano = false;
  /** Statistika brez vsebine za preizkuse in porocilo. */
  readonly stat = { okvirjevIzhoda: 0, okvirjevVhoda: 0, varovalke: 0, prekinitve: 0, izrekov: 0, prviOkvirIzhoda: 0 };

  private readonly twilio: TwilioVrata;
  private readonly odv: OdvisnostiMosta;
  private readonly nacinBesedila: NacinBesedila;

  constructor(twilio: TwilioVrata, odv: OdvisnostiMosta, nacinBesedila: NacinBesedila = "clientContent") {
    this.twilio = twilio;
    this.odv = odv;
    this.nacinBesedila = nacinBesedila;
  }

  private ura(): number {
    return (this.odv.ura ?? Date.now)();
  }

  private dnevnik(koda: string): void {
    try {
      this.odv.dnevnik?.(koda);
    } catch {
      /* dnevnik ne sme podreti klica */
    }
  }

  get konec(): boolean {
    return this.faza === "konec";
  }

  get koncan(): Promise<void> {
    return this.konecObljuba ?? Promise.resolve();
  }

  /** Zapisi v knjigo klicev gredo po vrsti; napaka enega ne ustavi naslednjih. */
  private vVrsto(delo: () => Promise<unknown>): void {
    this.vrsta = this.vrsta.then(delo, delo).then(
      () => undefined,
      () => this.dnevnik("zapisnik-napaka"),
    );
  }

  private posljiTwilio(besedilo: string): void {
    if (this.konec) return;
    try {
      this.twilio.poslji(besedilo);
    } catch {
      void this.zakljuci("twilio-pisanje");
    }
  }

  // ---------------------------------------------------------------------------------------------------- Twilio

  /** Sporocilo od Twilia (besedilo JSON). Vse, kar ni veljavno, zapre povezavo; vsebine sporocil ne dnevnikamo. */
  naSporocilo(surovo: string | Uint8Array): void {
    if (this.konec) return;
    const velikost = typeof surovo === "string" ? Buffer.byteLength(surovo, "utf8") : surovo.length;
    if (velikost > MEJA_SPOROCILA_TWILIO) {
      this.dnevnik("twilio-prevelik");
      this.twilio.zapri(1009, "prevelik");
      void this.zakljuci("prevelik");
      return;
    }
    const r = razberiTwilio(surovo);
    if (!r.ok) {
      this.dnevnik(`twilio-${r.razlog}`);
      if (r.razlog === "dogodek") return;
      this.twilio.zapri(1008, "oblika");
      void this.zakljuci("oblika");
      return;
    }
    const d = r.dogodek as DogodekTwilio;
    if (this.faza === "caka") {
      if (d.event === "connected") return;
      if (d.event !== "start") {
        this.twilio.zapri(1008, "pricakovan-start");
        void this.zakljuci("brez-starta");
        return;
      }
      this.naStart(d.start);
      return;
    }
    switch (d.event) {
      case "start":
        this.twilio.zapri(1008, "dvojni-start");
        void this.zakljuci("dvojni-start");
        return;
      case "media":
        this.naMedia(d.zvok);
        return;
      case "mark":
        if (this.cakamMark && this.cakamMark.ime === d.ime) {
          const potem = this.cakamMark.potem;
          this.cakamMark = null;
          potem();
        }
        return;
      case "stop":
        void this.zakljuci("stop");
        return;
      default:
        return;
    }
  }

  /** Zacne rok za Twilio start: povezava, ki v roku ne poslje veljavnega starta, se zapre. Klice hookiLive ob odprtju povezave. */
  cakajStart(rokMs: number = ROK_STARTA_MS): void {
    if (this.konec || this.faza !== "caka" || this.startCasovnik) return;
    this.startCasovnik = setTimeout(() => {
      this.startCasovnik = null;
      if (this.faza !== "caka") return;
      this.dnevnik("twilio-rok-starta");
      this.twilio.zapri(1008, "rok-starta");
      void this.zakljuci("rok-starta");
    }, rokMs);
    this.startCasovnik.unref?.();
  }

  private ustaviRokStarta(): void {
    if (this.startCasovnik) clearTimeout(this.startCasovnik);
    this.startCasovnik = null;
  }

  /** Povezava s Twilijem je padla ali je bila zaprta. */
  naOdklop(): void {
    void this.zakljuci("twilio-odklop");
  }

  private naStart(start: { streamSid: string; callSid: string; zeton: string }): void {
    this.ustaviRokStarta();
    const izid = this.odv.porabiZeton(start.zeton, start.callSid);
    if (izid.izid !== "ok") {
      // Brez zapisa klica in brez Live: povezava ni od nas izdanega klica.
      this.dnevnik(`zeton-${izid.izid}`);
      this.twilio.zapri(1008, "zeton");
      this.faza = "konec";
      this.konecObljuba = Promise.resolve();
      return;
    }
    this.faza = "zacenjam";
    this.streamSid = start.streamSid;
    this.callSid = start.callSid;
    this.from = izid.from;
    this.cas0 = this.ura();
    this.zadnjeOsvezevanje = this.cas0;
    this.odv.zasedenost.osvezi(this.callSid);
    this.tikCasovnik = setInterval(() => void this.tik(), this.odv.tikMs ?? 500);
    this.tikCasovnik.unref?.();
    void this.zacni();
  }

  private async zacni(): Promise<void> {
    try {
      this.nastavitve = await this.odv.nalozi();
      if (this.nastavitve.ciscenjeZvoka === false) this.vhodPretvornik = new VhodTwilioVLive(false);
      else if (!this.konec) {
        // Po koncu klica (zakljuci med nalozi) se nic ne ustvari: zakljuci je cistilnike ze pospravil.
        this.ciscenje16kDovoljeno = true;
        // Pot telefona (zacetekKlica) ima zvok 16 kHz (naPcm16k); 8 kHz cistilnik ustvari samo pot Twilio/SIP.
        const c8 = this.odv.zacetekKlica ? null : this.novCistilnik(8000);
        if (c8) this.vhodPretvornik = new VhodTwilioVLive(WIENER_Z_RNNOISE, c8);
      }
    } catch {
      this.dnevnik("nastavitve-napaka");
      this.twilio.zapri(1011, "nastavitve");
      void this.zakljuci("nastavitve");
      return;
    }
    if (this.konec) return;
    const n = this.nastavitve;
    this.zapisnikZacet = true;
    this.vVrsto(() => this.odv.zapisnik.zacni({ callSid: this.callSid, from: this.from, pozdrav: n.pozdrav }));
    if (this.odv.zacetekKlica) {
      // Pot telefona: pozdrav je prvi zvok in Live se odpre sele po njem (isto pravilo kot spodaj, izvede ga prilagodilnik).
      let sprejeto = false;
      try {
        sprejeto = await this.odv.zacetekKlica(n.pozdrav, async (trajanjeMs) => {
          if (this.konec) return;
          this.predvajanoDo = this.ura() + trajanjeMs;
          this.pozdravDo = this.predvajanoDo;
          this.dovoljeni = [];
          await this.odpriLiveSejo(n);
        });
      } catch {
        sprejeto = false;
      }
      if (!sprejeto && !this.konec) {
        this.dnevnik("pozdrav-brez-posnetka");
        this.twilio.zapri(1011, "pozdrav");
        void this.zakljuci("pozdrav-zavrnjen");
      }
      return;
    }
    // Pozdrav (razkritje UI) je stalni posnetek in gre PRVI, ne glede na to, kdaj je Live pripravljen.
    const pozdrav = await this.odv.posnetek(n.pozdrav).catch(() => null);
    if (this.konec) return;
    // Brez posnetka pozdrava z razkritjem UI se Live NE odpre (navodilo modela pravi, da je pozdrav ze izrecen, zato ga model ne bi povedal):
    // razkritje je trdo pravilo (lastnik 14. 11. 2026). voice.server na Live sploh ne preusmeri brez posnetka; to je varovalo za tekmo.
    if (!pozdrav) {
      this.dnevnik("pozdrav-brez-posnetka");
      this.twilio.zapri(1011, "pozdrav");
      void this.zakljuci("pozdrav-brez-posnetka");
      return;
    }
    this.predvajajPosnetek(pozdrav, "pozdrav");
    this.pozdravDo = this.predvajanoDo;
    this.dovoljeni = [];
    await this.odpriLiveSejo(n);
  }

  /** Odpre sejo Live z rokom; napaka ali pozen konec seje ne pusti osirotele seje (skupno za obe poti). */
  private async odpriLiveSejo(n: NastavitveMosta): Promise<void> {
    this.odpriSoniox();
    try {
      let odprt = false;
      const odpiranje = this.odv.odpriLive({
        setup: n.setup,
        onSporocilo: (m) => this.naLive(m),
        onZaprto: (razlog) => this.naLiveZaprt(razlog),
      });
      let casovnik: ReturnType<typeof setTimeout> | undefined;
      const rok = new Promise<never>((_, zavrni) => {
        casovnik = setTimeout(() => zavrni(new Error("rok")), ROK_ODPRTJA_LIVE_MS);
      });
      try {
        this.live = await Promise.race([odpiranje, rok]);
        odprt = true;
      } finally {
        if (casovnik) clearTimeout(casovnik);
        // Pozna seja po roku ali po koncu klica se zapre (brez osirotele seje, ki bi trosila).
        odpiranje.then((seja) => {
          if (!odprt || this.konec) seja.zapri();
        }, () => undefined);
      }
    } catch {
      this.dnevnik("live-odprtje-napaka");
      await this.napakaLive();
      return;
    }
    if (this.konec) {
      this.live?.zapri();
    }
  }

  /** Nov RNNoise cistilnik iz odvisnosti; napaka ali null = brez (klic gre naprej po stari poti). */
  private novCistilnik(frekvenca: 8000 | 16000): CistilnikPcm | null {
    try {
      return this.odv.ciscenjeRnnoise?.(frekvenca) ?? null;
    } catch {
      this.dnevnik("rnnoise-napaka");
      return null;
    }
  }

  private naMedia(zvok: Uint8Array): void {
    this.naVhodPcm(this.vhodPretvornik.process(zvok));
  }

  /** Pot telefona: surov PCM 16 kHz od telefona (brez mu-law) gre po isti poti kot Twilio vhod. Po koncu klica ali pred startom se zavrze. */
  naPcm16k(pcm: Uint8Array): void {
    if (this.faza !== "zacenjam" && this.faza !== "dela") return;
    if (this.ciscenje16kDovoljeno) {
      this.ciscenje16kDovoljeno = false;
      this.ciscenje16k = this.novCistilnik(16000);
      // Stikalo vklopljeno, RNNoise ni (npr. vendor manjka v svezenju): klic gre brez filtra, a to mora biti vidno v dnevniku.
      if (!this.ciscenje16k) this.dnevnik("rnnoise-ni-na-voljo");
    }
    this.naVhodPcm(this.ciscenje16k ? pcmVBajte(this.ciscenje16k.obdelaj(bajtiVPcm(pcm))) : pcm);
  }

  private naVhodPcm(pcm: Uint8Array): void {
    this.stat.okvirjevVhoda += 1;
    this.posljiSoniox(pcm);
    if (!this.liveNared || this.ura() < this.pozdravDo || this.slovoVTeku) {
      // Klicatelj lahko govori ze med pozdravom ali odpiranjem seje: ne izgubimo ga, pogovor se zacne z njim.
      if (!this.slovoVTeku) {
        this.predpomnilnikVhoda.push(pcm);
        if (this.predpomnilnikVhoda.length > NAJVEC_PREDPOMNILNIKA_VHODA) this.predpomnilnikVhoda.shift();
      }
      if (this.liveNared && !this.slovoVTeku && this.ura() >= this.pozdravDo) this.izprazniPredpomnilnik();
      return;
    }
    this.izprazniPredpomnilnik();
    this.posljiVhod(pcm);
  }

  private izprazniPredpomnilnik(): void {
    const kosi = this.predpomnilnikVhoda;
    this.predpomnilnikVhoda = [];
    for (const kos of kosi) this.posljiVhod(kos);
  }

  private posljiVhod(pcm16k: Uint8Array): void {
    if (!this.live) return;
    try {
      this.live.poslji({ realtimeInput: { audio: { data: Buffer.from(pcm16k).toString("base64"), mimeType: "audio/pcm;rate=16000" } } });
    } catch {
      this.dnevnik("live-pisanje-napaka");
    }
  }

  private odpriSoniox(): void {
    if (this.sonioxZacet || this.konec || !this.odv.soniox) return;
    this.sonioxZacet = true;
    const naBesedilo = (kos: string) => {
      if (typeof kos === "string" && kos.length > 0) this.sonioxKosi.push(kos);
    };
    let izid: SonioxMostSeja | null | Promise<SonioxMostSeja | null>;
    try {
      izid = this.odv.soniox.odpri(this.callSid, naBesedilo);
    } catch {
      this.sonioxPripravljen = true;
      this.sonioxVrsta = [];
      this.sonioxVrstaBajtov = 0;
      this.dnevnik("soniox-odprtje-napaka");
      return;
    }
    if (izid && typeof (izid as PromiseLike<SonioxMostSeja | null>).then === "function") {
      this.sonioxOdpiranje = Promise.resolve(izid).then(
        (seja) => {
          this.sonioxPripravljen = true;
          if (this.konec) {
            this.sonioxVrsta = [];
            this.sonioxVrstaBajtov = 0;
            if (seja) {
              try {
                seja.zapri();
              } catch {
                /* ze zaprto */
              }
            }
            return null;
          }
          this.soniox = seja ?? null;
          this.izprazniSonioxVrsto();
          return this.soniox;
        },
        () => {
          this.sonioxPripravljen = true;
          this.sonioxVrsta = [];
          this.sonioxVrstaBajtov = 0;
          this.dnevnik("soniox-odprtje-napaka");
          return null;
        },
      );
    } else {
      this.sonioxPripravljen = true;
      this.soniox = (izid as SonioxMostSeja | null) ?? null;
      this.izprazniSonioxVrsto();
    }
  }

  private posljiSoniox(pcm16k: Uint8Array): void {
    if (!this.odv.soniox || this.konec || pcm16k.byteLength === 0) return;
    if (this.soniox) {
      try {
        this.soniox.poslji(pcm16k);
      } catch {
        /* napaka seje Soniox ne sme ustaviti ali upocasniti klica */
      }
      return;
    }
    if (this.sonioxPripravljen) return;
    const kopija = pcm16k.slice();
    if (kopija.byteLength >= NAJVEC_SONIOX_VRSTA_BAJTOV) {
      this.sonioxVrsta = [kopija.slice(kopija.byteLength - NAJVEC_SONIOX_VRSTA_BAJTOV)];
      this.sonioxVrstaBajtov = this.sonioxVrsta[0].byteLength;
      return;
    }
    this.sonioxVrsta.push(kopija);
    this.sonioxVrstaBajtov += kopija.byteLength;
    while (this.sonioxVrstaBajtov > NAJVEC_SONIOX_VRSTA_BAJTOV && this.sonioxVrsta.length > 0) {
      const najstarejsi = this.sonioxVrsta.shift();
      if (najstarejsi) this.sonioxVrstaBajtov -= najstarejsi.byteLength;
    }
  }

  private izprazniSonioxVrsto(): void {
    const kosi = this.sonioxVrsta;
    this.sonioxVrsta = [];
    this.sonioxVrstaBajtov = 0;
    if (!this.soniox || kosi.length === 0) return;
    for (const kos of kosi) {
      try {
        this.soniox.poslji(kos);
      } catch {
        /* napaka seje Soniox ne sme ustaviti ali upocasniti klica */
      }
    }
  }

  private zakljuciSonioxNeodvisno(
    sid: string,
    seja: SonioxMostSeja | null,
    odpiranje: Promise<SonioxMostSeja | null> | null,
    poKoncuKlica: Promise<void>,
  ): void {
    if (!seja && !odpiranje) return;
    const rokMs = this.odv.sonioxRokZakljuckaMs ?? ROK_ZAKLJUCKA_SONIOX_MS;
    void (async () => {
      let casovnikOdprtja: ReturnType<typeof setTimeout> | null = null;
      const aktivna =
        seja ??
        (odpiranje
          ? await Promise.race([
              odpiranje,
              new Promise<null>((r) => {
                casovnikOdprtja = setTimeout(() => r(null), rokMs);
                casovnikOdprtja.unref?.();
              }),
            ])
          : null);
      if (casovnikOdprtja) {
        clearTimeout(casovnikOdprtja);
        casovnikOdprtja = null;
      }
      if (aktivna) {
        let koncal = false;
        let casovnikZakljucka: ReturnType<typeof setTimeout> | null = null;
        try {
          const obljuba = Promise.resolve().then(() => aktivna.zakljuci());
          const rok = new Promise<void>((r) => {
            casovnikZakljucka = setTimeout(() => r(), rokMs);
            casovnikZakljucka.unref?.();
          });
          await Promise.race([
            obljuba.then(
              () => {
                koncal = true;
              },
              () => {
                koncal = true;
              },
            ),
            rok,
          ]);
        } catch {
          /* napaka zakljucka Soniox ne sme vplivati na klic */
        } finally {
          if (casovnikZakljucka) clearTimeout(casovnikZakljucka);
          if (!koncal) {
            try {
              aktivna.zapri();
            } catch {
              /* ze zaprto */
            }
          }
        }
      }
      await poKoncuKlica.catch(() => undefined);
      if (this.sonioxDobesednoPoslano || !sid || !this.zapisnikZacet) return;
      this.sonioxDobesednoPoslano = true;
      const besedilo = this.sonioxKosi.join("");
      if (besedilo && this.odv.zapisnik.dobesedno) {
        try {
          await this.odv.zapisnik.dobesedno(sid, besedilo);
        } catch {
          this.dnevnik("zapisnik-napaka");
        }
      }
    })();
  }

  // ---------------------------------------------------------------------------------------------------- izhod proti Twiliu

  private posljiOkvirje(okvirji: Uint8Array[]): void {
    for (const okvir of okvirji) {
      this.posljiTwilio(twilioMedia(this.streamSid, okvir));
      this.stat.okvirjevIzhoda += 1;
      const zdaj = this.ura();
      this.predvajanoDo = Math.max(this.predvajanoDo, zdaj) + (OKVIR_BAJTOV / 8000) * 1000;
    }
  }

  private predvajajPosnetek(mulaw: Uint8Array, ime: string): void {
    this.posljiOkvirje(razrezi(mulaw));
    this.stevecMark += 1;
    this.posljiTwilio(twilioMark(this.streamSid, `${ime}-${this.stevecMark}`));
  }

  private clear(): void {
    this.posljiTwilio(twilioClear(this.streamSid));
    this.predvajanoDo = this.ura();
  }

  // ---------------------------------------------------------------------------------------------------- Live

  private naLiveZaprt(razlog: string): void {
    if (this.konec) return;
    this.dnevnik(`live-zaprt-${razlog.slice(0, 40)}`);
    this.live = null;
    void this.napakaLive();
  }

  /** Live ne dela (odprtje ni uspelo ali seja se je zaprla sredi klica): stalno opravicilo in konec; klic se ne izgubi. */
  private async napakaLive(): Promise<void> {
    if (this.slovoVTeku || this.konec) return;
    this.slovoVTeku = true;
    this.liveNared = false;
    const n = this.nastavitve;
    if (n) {
      this.clear();
      const posnetek = await this.odv.posnetek(n.oprostilo).catch(() => null);
      if (posnetek) this.predvajajPosnetek(posnetek, "oprostilo");
      this.vVrsto(() => this.odv.zapisnik.odgovor(this.callSid, n.oprostilo));
    }
    this.pocakajPredvajanje("oprostilo-konec", () => void this.zakljuci("live-napaka"));
  }

  private naLive(m: LiveSporocilo): void {
    if (this.konec) return;
    if (m.setupComplete !== undefined) {
      this.liveNared = true;
      if (this.ura() >= this.pozdravDo) this.izprazniPredpomnilnik();
      return;
    }
    if (m.goAway !== undefined) {
      this.dnevnik("live-goaway");
      return;
    }
    const orodje = obj(m.toolCall);
    if (orodje) {
      void this.naOrodje(orodje);
      return;
    }
    const sc = obj(m.serverContent);
    if (!sc) return;
    if (sc.interrupted === true) this.naPrekinitev();
    const vhod = obj(sc.inputTranscription);
    if (vhod && niz(vhod.text)) this.naVhodPrepis(niz(vhod.text));
    const tok = obj(sc.modelTurn);
    const deli = Array.isArray(tok?.parts) ? (tok.parts as unknown[]) : [];
    for (const del of deli) {
      const podatki = obj(obj(del)?.inlineData);
      if (podatki && niz(podatki.data)) this.naIzhodZvok(niz(podatki.data));
    }
    const izhod = obj(sc.outputTranscription);
    if (izhod && niz(izhod.text)) this.naIzhodPrepis(niz(izhod.text));
    if (sc.turnComplete === true) this.naKonecObrata();
  }

  private naVhodPrepis(besedilo: string): void {
    this.vhodPrepis = dodajKosPrepisa(this.vhodPrepis, besedilo).slice(-NAJVEC_PREPISA);
    this.vhodZadnji = this.ura();
  }

  /** Izrek klicatelja je zakljucen (model zacne odgovarjati, obrat se konca ali dolgo ni novega prepisa). */
  private zakljuciIzrek(): void {
    const izrek = this.vhodPrepis.replace(/\s+/g, " ").trim();
    this.vhodPrepis = "";
    if (!izrek) return;
    this.zadnjiIzrek = izrek;
    this.izreki.push(izrek);
    if (this.izreki.length > NAJVEC_IZREKOV) this.izreki.shift();
    this.stat.izrekov += 1;
    this.vVrsto(() => this.odv.zapisnik.izrek(this.callSid, izrek));
  }

  private naIzhodZvok(base64: string): void {
    if (this.blokiran || this.slovoVTeku) return;
    if (this.vhodPrepis) this.zakljuciIzrek();
    let bajti: Uint8Array;
    try {
      bajti = new Uint8Array(Buffer.from(base64, "base64"));
    } catch {
      return;
    }
    const okvirji = this.izhodPretvornik.process(bajti);
    if (okvirji.length > 0 && this.stat.prviOkvirIzhoda === 0) this.stat.prviOkvirIzhoda = this.ura();
    this.posljiOkvirje(okvirji);
  }

  /** Dovoljen stavek (opozorilo o izteku), ki ga model izreka dobesedno: iz preverbe se odstrani, ostalo se preveri. */
  private brezDovoljenih(besedilo: string): string {
    let ostanek = besedilo;
    const norm = normaliziraj(besedilo);
    for (const stavek of this.dovoljeni) {
      const ns = normaliziraj(stavek);
      if (ns && ns.startsWith(norm)) return "";
      const vzorec = ns
        .split(" ")
        .map((beseda) => beseda.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("\\W+");
      ostanek = ostanek.replace(new RegExp(vzorec.replace(/\d+/g, "\\d+"), "gi"), " ");
    }
    return ostanek;
  }

  private naIzhodPrepis(besedilo: string): void {
    if (this.slovoVTeku) return;
    if (this.vhodPrepis) this.zakljuciIzrek();
    if (this.blokiran) return;
    this.izhodPrepis = dodajKosPrepisa(this.izhodPrepis, besedilo).slice(-NAJVEC_PREPISA);
    const preveri = this.dovoljeni.length > 0 ? this.brezDovoljenih(this.izhodPrepis) : this.izhodPrepis;
    const n = this.nastavitve;
    if (!n) return;
    const razlog = razlogVarovalkeGovora(preveri, n.katalog);
    if (razlog) this.varovalka(razlog);
  }

  /**
   * Varovalka: model je rekel (ali pravkar govori) nekaj, kar Lina ne sme. Twilio 'clear' (ujame, kar se ni izgovorjeno),
   * preostanek odgovora se zavrze, namesto njega stalni posnetek; prepovedanega besedila ne zapisemo v dnevnik klica.
   */
  private varovalka(razlog: string): void {
    const n = this.nastavitve;
    if (!n) return;
    this.blokiran = true;
    this.varovalke += 1;
    this.stat.varovalke += 1;
    this.dnevnik(`varovalka-${razlog}`);
    this.izhodPrepis = "";
    this.izhodPretvornik.zavrzi();
    this.clear();
    const vprasanje = this.zadnjiIzrek;
    const klic = this.callSid;
    this.vVrsto(async () => {
      await this.odv.zapisnik.odgovor(klic, n.temaOdgovor);
      if (vprasanje) await this.odv.zapisnik.vrzel(vprasanje);
    });
    void this.odv.posnetek(n.temaOdgovor).then(
      (posnetek) => {
        if (this.konec || this.slovoVTeku) return;
        if (posnetek) this.predvajajPosnetek(posnetek, "varovalka");
        else this.dnevnik("varovalka-brez-posnetka");
      },
      () => this.dnevnik("varovalka-posnetek-napaka"),
    );
    if (this.zapora) clearTimeout(this.zapora);
    this.zapora = setTimeout(() => {
      this.blokiran = false;
      this.zapora = null;
    }, ROK_ZAPORE_VAROVALKE_MS);
    this.zapora.unref?.();
  }

  private sprostiZaporo(): void {
    this.blokiran = false;
    if (this.zapora) clearTimeout(this.zapora);
    this.zapora = null;
  }

  private naPrekinitev(): void {
    this.stat.prekinitve += 1;
    // Klicatelj je spregovoril med odgovorom: ujeti zvok pri Twiliu gre ven, preostanek odgovora tudi.
    this.clear();
    this.izhodPretvornik.zavrzi();
    this.zapisiIzhod();
    this.sprostiZaporo();
  }

  private zapisiIzhod(): void {
    const izhod = this.izhodPrepis.replace(/\s+/g, " ").trim();
    this.izhodPrepis = "";
    if (izhod && !this.blokiran) this.vVrsto(() => this.odv.zapisnik.odgovor(this.callSid, izhod));
  }

  private naKonecObrata(): void {
    if (this.vhodPrepis) this.zakljuciIzrek();
    this.zapisiIzhod();
    this.sprostiZaporo();
    if (!this.slovoVTeku) this.posljiOkvirje(this.izhodPretvornik.izprazni());
    if (this.zakljucekPoTurnu && !this.slovoVTeku) {
      this.slovoVTeku = true;
      this.pocakajPredvajanje("slovo", () => void this.zakljuci("zakljucek"));
    }
  }

  /** Poslje 'mark' za zadnjim zvokom in caka, da ga Twilio vrne (vse predvajano); varnostni rok, ce odmeva ne bo. */
  private pocakajPredvajanje(ime: string, potem: () => void): void {
    this.stevecMark += 1;
    const oznaka = `${ime}-${this.stevecMark}`;
    this.posljiTwilio(twilioMark(this.streamSid, oznaka));
    let narejeno = false;
    const naredi = () => {
      if (narejeno) return;
      narejeno = true;
      if (rok) clearTimeout(rok);
      potem();
    };
    this.cakamMark = { ime: oznaka, potem: naredi };
    const caka = Math.max(1500, this.predvajanoDo - this.ura() + 2500);
    const rok: ReturnType<typeof setTimeout> | undefined = setTimeout(naredi, caka);
    rok.unref?.();
  }

  // ---------------------------------------------------------------------------------------------------- orodje

  private async naOrodje(klic: Obj): Promise<void> {
    const funkcije = Array.isArray(klic.functionCalls) ? (klic.functionCalls as unknown[]) : [];
    const odgovori: Array<{ id: string; name: string; response: Obj }> = [];
    for (const f of funkcije) {
      const fo = obj(f);
      if (!fo) continue;
      const id = niz(fo.id);
      const ime = niz(fo.name);
      if (ime !== ORODJE_ZAKLJUCEK) {
        odgovori.push({ id, name: ime, response: { napaka: "neznana funkcija" } });
        continue;
      }
      const a = obj(fo.args) ?? {};
      const polje = (k: string): string | undefined => (typeof a[k] === "string" ? (a[k] as string) : undefined);
      const polja: PoljaIzOrodja = {
        ime: polje("ime"),
        podjetje: polje("podjetje"),
        telefon: polje("telefon"),
        eposta: polje("eposta"),
        izdelek: polje("izdelek"),
        rok: polje("rok"),
        povratniKlic: polje("povratni_klic"),
        sporocilo: polje("sporocilo"),
        potrdil: typeof a.klicatelj_potrdil === "boolean" ? a.klicatelj_potrdil : undefined,
      };
      // Izrek, ki je se v prepisu (klicatelj je ravnokar rekel »da«), se zakljuci pred potrditvijo polj.
      if (this.vhodPrepis) this.zakljuciIzrek();
      await this.vrsta;
      try {
        const izid = await Promise.race([
          this.odv.zapisnik.povprasevanje(this.callSid, polja, [...this.izreki], this.zadnjiIzrek),
          new Promise<never>((_, zavrni) => setTimeout(() => zavrni(new Error("rok")), ROK_ORODJA_MS).unref?.()),
        ]);
        odgovori.push({ id, name: ime, response: { rezultat: "zapisano", sprejeta_polja: izid.sprejeto, zavrnjena_polja: izid.zavrnjeno } });
      } catch {
        this.dnevnik("orodje-napaka");
        odgovori.push({ id, name: ime, response: { rezultat: "napaka" } });
      }
      this.zakljucekPoTurnu = true;
    }
    try {
      this.live?.poslji({ toolResponse: { functionResponses: odgovori } });
    } catch {
      this.dnevnik("live-pisanje-napaka");
    }
    if (this.zakljucekPoTurnu) {
      // Varnostni rok, ce model po funkciji ne rece nicesar: klic se vseeno zakljuci.
      this.zakljucekCasovnik = setTimeout(() => {
        if (this.konec || this.slovoVTeku) return;
        this.slovoVTeku = true;
        this.pocakajPredvajanje("slovo", () => void this.zakljuci("zakljucek"));
      }, ROK_ORODJA_MS);
      this.zakljucekCasovnik.unref?.();
    }
  }

  // ---------------------------------------------------------------------------------------------------- ura

  private posljiBesediloVLive(besedilo: string): void {
    if (!this.live) return;
    try {
      if (this.nacinBesedila === "realtimeInput") this.live.poslji({ realtimeInput: { text: besedilo } });
      else this.live.poslji({ clientContent: { turns: [{ role: "user", parts: [{ text: besedilo }] }], turnComplete: true } });
    } catch {
      this.dnevnik("live-pisanje-napaka");
    }
  }

  private async tik(): Promise<void> {
    if (this.faza !== "zacenjam" && this.faza !== "dela") return;
    const zdaj = this.ura();
    if (zdaj - this.zadnjeOsvezevanje >= OSVEZI_ZASEDENOST_MS) {
      this.zadnjeOsvezevanje = zdaj;
      this.odv.zasedenost.osvezi(this.callSid);
    }
    if (this.vhodPrepis && zdaj - this.vhodZadnji >= MIRNO_ZAKLJUCEK_IZREKA_MS) this.zakljuciIzrek();
    if (this.liveNared && this.ura() >= this.pozdravDo && this.predpomnilnikVhoda.length > 0 && !this.slovoVTeku) this.izprazniPredpomnilnik();
    const n = this.nastavitve;
    if (!n || this.slovoVTeku) return;
    const faza = fazaTrajanja(new Date(this.cas0).toISOString(), new Date(zdaj).toISOString(), n.najdaljsiMinut);
    if (faza === "brez") return;
    const ostane = (n.najdaljsiMinut ?? 0) * 60_000 - (zdaj - this.cas0);
    const klicateljGovori = zdaj - this.vhodZadnji < MIRNO_PRED_OPOZORILOM_MS && this.vhodPrepis !== "";
    if (!this.opozorjen) {
      // Klicatelja ne prekinemo sredi stavka, razen ce je do izteka manj kot 8 s.
      if (klicateljGovori && ostane > 8_000) return;
      this.opozorjen = true;
      this.potekPo = zdaj + NAJVEC_ZAMIKA_SLOVA_MS;
      const r = await this.odv.zapisnik.cas(this.callSid, "opozorilo");
      if (r && !this.konec && !this.slovoVTeku) {
        this.dovoljeni = [r.besedilo, ...r.besedilo.split(/(?<=[.!?])\s+/)];
        this.posljiBesediloVLive(`Klicatelju zdaj povej natanko to, brez kakrsnihkoli dodatkov: ${r.besedilo}`);
      }
      return;
    }
    if (faza === "potek" && zdaj >= this.potekPo) {
      // Slovo ob izteku: ne sredi stavka klicatelja (najvec 5 s zamika), nato stalni posnetek in konec; modela ni vec.
      if (klicateljGovori && zdaj < this.potekPo + NAJVEC_ZAMIKA_SLOVA_MS) return;
      this.slovoVTeku = true;
      const r = await this.odv.zapisnik.cas(this.callSid, "potek");
      this.live?.zapri();
      this.live = null;
      this.clear();
      this.izhodPretvornik.zavrzi();
      if (r) {
        const posnetek = await this.odv.posnetek(r.besedilo).catch(() => null);
        if (posnetek) this.predvajajPosnetek(posnetek, "slovo");
      }
      this.pocakajPredvajanje("potek-konec", () => void this.zakljuci("cas-potekel"));
    }
  }

  // ---------------------------------------------------------------------------------------------------- konec

  /** Zakljucek klica (idempotenten): casovniki, Live seja, zapis klica, zasedenost, povezava s Twilijem. */
  zakljuci(razlog: string): Promise<void> {
    if (this.konecObljuba) return this.konecObljuba;
    const bilaZacetaFaza = this.faza;
    this.faza = "konec";
    this.ustaviRokStarta();
    this.dnevnik(`konec-${razlog}`);
    this.sonioxVrsta = [];
    this.sonioxVrstaBajtov = 0;
    // Vbrizgana cistilnika (WASM) se sprostita na tem enem mestu; po unici() zvok ne gre vec nikamor (faza konec).
    this.ciscenje16kDovoljeno = false;
    this.ciscenje16k?.unici();
    this.ciscenje16k = null;
    this.vhodPretvornik.unici();
    const sidSoniox = this.callSid;
    const sejaSoniox = this.soniox;
    const odpiranjeSoniox = this.sonioxOdpiranje;
    this.soniox = null;
    this.sonioxOdpiranje = null;
    this.konecObljuba = (async () => {
      if (this.tikCasovnik) clearInterval(this.tikCasovnik);
      this.tikCasovnik = null;
      if (this.zapora) clearTimeout(this.zapora);
      if (this.zakljucekCasovnik) clearTimeout(this.zakljucekCasovnik);
      this.cakamMark = null;
      if (this.vhodPrepis) this.zakljuciIzrek();
      this.zapisiIzhod();
      try {
        this.live?.zapri();
      } catch {
        /* ze zaprto */
      }
      this.live = null;
      await this.vrsta;
      if (bilaZacetaFaza !== "caka" && this.callSid) {
        if (this.zapisnikZacet) await this.odv.zapisnik.zakljuci(this.callSid).catch(() => this.dnevnik("zapisnik-napaka"));
        this.odv.zasedenost.sprosti(this.callSid);
      }
      try {
        this.twilio.zapri(1000, "konec");
      } catch {
        /* ze zaprto */
      }
    })();
    this.zakljuciSonioxNeodvisno(sidSoniox, sejaSoniox, odpiranjeSoniox, this.konecObljuba);
    return this.konecObljuba;
  }
}
