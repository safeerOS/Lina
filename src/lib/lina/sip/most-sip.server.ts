/**
 * SIP-2: most klic SIP (DohodniKlic + RtpSeja) <-> Gemini Live. Logika klica je ISTA kot pri Twilio: seja, pozdrav z razkritjem
 * UI (stalni posnetek), varovalke govora, zapisnik, ura (opozorilo, slovo) in orodje vodi obstojeci LiveMost (live/most.ts),
 * ki ga tu ne spreminjamo. Zamenjan je samo prenos: ta datoteka posnema Twilio Media Streams (connected, start, media, mark,
 * clear, stop) nad zvokom SIP, zato pot Twilio ostane nespremenjena in obe poti tecejo skozi isto kodo.
 * Besedil za klicatelja tu NI (brez cen, obljub in novih stavkov): vse pove LiveMost iz obstojecih nastavitev.
 */
import { randomBytes } from "node:crypto";
import { LiveMost, type NacinBesedila, type OdvisnostiMosta, type TwilioVrata } from "../live/most.ts";
import { mulawVPcm, OKVIR_BAJTOV, pcmVMulaw } from "../live/zvok.ts";
import type { RazlogKonca } from "./odjemalec.server.ts";
import { Navzdol24v8, Navzgor8v24 } from "./vzorcenje.ts";

/** Del klica SIP, ki ga most potrebuje: DohodniKlic iz odjemalec.server.ts ustreza (sluzba-sip ga poda neposredno); v preizkusih lazni. */
export interface KlicZaMost {
  readonly klicatelj: string;
  sprejmi(): Promise<void>;
  zavrni(status?: number, razlog?: string): void;
  odlozi(): void;
  poslji(pcm24k: Int16Array): void;
  prekiniPredvajanje(): void;
  on(dogodek: "zvok", poslusalec: (pcm24k: Int16Array) => void): unknown;
  on(dogodek: "konec", poslusalec: (razlog: RazlogKonca) => void): unknown;
  off(dogodek: "zvok", poslusalec: (pcm24k: Int16Array) => void): unknown;
  off(dogodek: "konec", poslusalec: (razlog: RazlogKonca) => void): unknown;
}

/** Odvisnosti mosta SIP: iste kot pri Twilio, le zeton izda in porabi most sam (klic SIP nima spletnega zetona). */
export type OdvisnostiMostaSip = Omit<OdvisnostiMosta, "porabiZeton">;

export type MoznostiMostaSip = {
  nacin?: NacinBesedila;
  /** Koliko zvoka (ms) most drzi naprej v vrsti RTP; ostalo caka pri mostu (clear ga zavrze takoj). */
  naprejMs?: number;
  /** Korak oddaje proti RTP (ms). */
  korakMs?: number;
  /** Rezerva za predvajanje v RtpSeja, preden most vrne 'mark' (ms). */
  rezervaMarkMs?: number;
  /** Najvec cakajocega Lininega zvoka pri mostu (okvirji po 20 ms); privzeto 3 min. */
  najvecOkvirjev?: number;
};

/** Stevilka klicatelja v zapis klica samo, ce je videti kot stevilka (From pri SIP ni preverjen; skrita ali ime -> prazno). */
export function stevilkaKlicatelja(klicatelj: string): string {
  const s = klicatelj.replace(/^tel:/i, "").replace(/[\s.()-]/g, "");
  return /^\+?[0-9]{3,20}$/.test(s) ? s : "";
}

/** Oznaka klica SIP v zapisu klicev (ista oblika kot pri Twiliu dovoljena: crke, stevke, 3-64 znakov). */
export function novSidSip(): string {
  return `SIP${randomBytes(12).toString("hex")}`;
}

type Postavka = { vrsta: "zvok"; okvir: Uint8Array } | { vrsta: "mark"; ime: string };

/**
 * En klic SIP <-> en LiveMost. Smer klicatelj -> Live: 24 kHz PCM iz RTP -> 8 kHz mu-law kot Twilio 'media' (LiveMost ga
 * pretvori v 16 kHz za Live, kot pri Twiliu). Smer Live -> klicatelj: okvirji mu-law iz LiveMost -> 24 kHz PCM -> RTP, v
 * taktu predvajanja; 'mark' se vrne, ko je zvok pred njim predvajan, 'clear' zavrze cakajoci zvok (kot Twilio).
 */
export class MostSip {
  readonly callSid: string;
  readonly most: LiveMost;
  private readonly klic: KlicZaMost;
  private readonly zeton = randomBytes(24).toString("hex");
  private zetonPorabljen = false;
  private readonly from: string;
  private readonly navzdol = new Navzdol24v8();
  private readonly navzgor = new Navzgor8v24();
  private vrsta: Postavka[] = [];
  private okvirjevVVrsti = 0;
  private predvajanoDo = 0;
  private takt: ReturnType<typeof setInterval> | null = null;
  private readonly markCasovniki = new Map<ReturnType<typeof setTimeout>, string>();
  private zaprt = false;
  private konecObljuba: Promise<void> | null = null;
  private razresiKonec: (() => void) | null = null;
  private readonly m: Required<MoznostiMostaSip>;
  /** Statistika brez vsebine (preizkusi). */
  readonly stat = { vLive: 0, izLive: 0, markov: 0, clear: 0 };
  private readonly naZvok = (pcm24k: Int16Array) => this.zvokKlicatelja(pcm24k);
  private readonly naKonec = (_razlog: RazlogKonca) => this.klicKoncan();

  constructor(klic: KlicZaMost, odv: OdvisnostiMostaSip, moznosti: MoznostiMostaSip = {}, callSid = novSidSip()) {
    this.klic = klic;
    this.callSid = callSid;
    this.from = stevilkaKlicatelja(klic.klicatelj);
    this.m = { nacin: "clientContent", naprejMs: 60, korakMs: 20, rezervaMarkMs: 80, najvecOkvirjev: 9000, ...moznosti };
    const vrata: TwilioVrata = { poslji: (b) => this.odMosta(b), zapri: () => this.zapriOdMosta() };
    this.most = new LiveMost(
      vrata,
      {
        ...odv,
        // Zeton je enkraten in velja samo za ta klic (most ga da LiveMost v 'start'); brez njega LiveMost ne odpre seje.
        porabiZeton: (z, sid) => {
          if (this.zetonPorabljen || z !== this.zeton || sid !== this.callSid) return { izid: "neveljaven", from: "" };
          this.zetonPorabljen = true;
          return { izid: "ok", from: this.from };
        },
      },
      this.m.nacin,
    );
  }

  /** Obljuba, ki se izpolni, ko je klic koncan in je vse sproscemo (LiveMost, casovniki, poslusalci). */
  get koncan(): Promise<void> {
    return (this.konecObljuba ??= new Promise<void>((r) => (this.razresiKonec = r)));
  }

  /** Aktivni casovniki mosta (za preizkus sprostitve). */
  get steviloCasovnikov(): number {
    return (this.takt ? 1 : 0) + this.markCasovniki.size;
  }

  /** Sprejme klic SIP (200 OK + RTP) in zacne sejo, kot Twilio 'connected' + 'start'. */
  async zacni(): Promise<void> {
    void this.koncan;
    this.klic.on("konec", this.naKonec);
    try {
      await this.klic.sprejmi();
    } catch {
      this.klicKoncan();
      return;
    }
    if (this.zaprt) return;
    this.klic.on("zvok", this.naZvok);
    this.takt = setInterval(() => this.oddaj(), this.m.korakMs);
    this.takt.unref?.();
    this.most.naSporocilo(JSON.stringify({ event: "connected" }));
    this.most.naSporocilo(
      JSON.stringify({
        event: "start",
        start: {
          streamSid: `MZ${this.callSid}`.slice(0, 64),
          callSid: this.callSid,
          mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
          customParameters: { zeton: this.zeton },
        },
      }),
    );
  }

  // ------------------------------------------------------------------------------------------- klicatelj -> Live

  private zvokKlicatelja(pcm24k: Int16Array): void {
    if (this.zaprt || this.most.konec) return;
    const pcm8 = this.navzdol.obdelaj(pcm24k);
    if (pcm8.length === 0) return;
    const mulaw = pcmVMulaw(pcm8);
    this.stat.vLive += 1;
    this.most.naSporocilo(JSON.stringify({ event: "media", media: { track: "inbound", payload: Buffer.from(mulaw).toString("base64") } }));
  }

  // ------------------------------------------------------------------------------------------- Live -> klicatelj

  /** Sporocilo, ki bi ga LiveMost poslal Twiliu (nase lastno, oblika je znana). */
  private odMosta(besedilo: string): void {
    if (this.zaprt) return;
    let s: { event?: unknown; media?: { payload?: unknown }; mark?: { name?: unknown } };
    try {
      s = JSON.parse(besedilo) as typeof s;
    } catch {
      return;
    }
    if (s.event === "media" && typeof s.media?.payload === "string") {
      const okvir = new Uint8Array(Buffer.from(s.media.payload, "base64"));
      if (okvir.length === 0) return;
      if (this.okvirjevVVrsti >= this.m.najvecOkvirjev) return;
      this.vrsta.push({ vrsta: "zvok", okvir });
      this.okvirjevVVrsti += 1;
      this.stat.izLive += 1;
    } else if (s.event === "mark" && typeof s.mark?.name === "string") {
      this.vrsta.push({ vrsta: "mark", ime: s.mark.name });
    } else if (s.event === "clear") {
      this.pocisti();
    }
  }

  /** Takt oddaje: v RTP gre le toliko zvoka, kolikor ga je do `naprejMs` naprej (clear tako ujame skoraj vse). */
  private oddaj(): void {
    if (this.zaprt) return;
    const zdaj = performance.now();
    while (this.vrsta.length > 0) {
      const p = this.vrsta[0] as Postavka;
      if (p.vrsta === "mark") {
        this.vrsta.shift();
        this.vrniMark(p.ime, Math.max(0, this.predvajanoDo - zdaj) + this.m.rezervaMarkMs);
        continue;
      }
      if (Math.max(this.predvajanoDo, zdaj) - zdaj >= this.m.naprejMs) break;
      this.vrsta.shift();
      this.okvirjevVVrsti -= 1;
      const pcm8 = mulawVPcm(p.okvir);
      this.klic.poslji(this.navzgor.obdelaj(pcm8));
      this.predvajanoDo = Math.max(this.predvajanoDo, zdaj) + (p.okvir.length / OKVIR_BAJTOV) * 20;
    }
  }

  private vrniMark(ime: string, cezMs: number): void {
    const t = setTimeout(() => {
      this.markCasovniki.delete(t);
      if (this.zaprt) return;
      this.stat.markov += 1;
      this.most.naSporocilo(JSON.stringify({ event: "mark", mark: { name: ime } }));
    }, cezMs);
    t.unref?.();
    this.markCasovniki.set(t, ime);
  }

  /** Twilio 'clear': cakajoci zvok gre ven, cakajoci 'mark' se vrnejo takoj (kot pri Twiliu). */
  private pocisti(): void {
    this.stat.clear += 1;
    const marki = this.vrsta.filter((p): p is Extract<Postavka, { vrsta: "mark" }> => p.vrsta === "mark").map((p) => p.ime);
    for (const [t, ime] of this.markCasovniki) {
      clearTimeout(t);
      marki.push(ime);
    }
    this.markCasovniki.clear();
    this.vrsta = [];
    this.okvirjevVVrsti = 0;
    this.predvajanoDo = performance.now();
    try {
      this.klic.prekiniPredvajanje();
    } catch {
      /* klic je ze koncan */
    }
    for (const ime of marki) this.vrniMark(ime, 0);
  }

  // ------------------------------------------------------------------------------------------- konec

  /** LiveMost zapira povezavo (konec klica, napaka, iztek): klic SIP dobi BYE, vse se sprosti. */
  private zapriOdMosta(): void {
    if (this.zaprt) return;
    try {
      this.klic.odlozi();
    } catch {
      /* ze koncan */
    }
    this.sprosti();
  }

  /** Klicatelj je odlozil (BYE/CANCEL) ali je odjemalec ustavljen: kot odklop Twilia. */
  private klicKoncan(): void {
    this.most.naOdklop();
    this.sprosti();
  }

  /** Konca klic od zunaj (zaustavitev streznika). */
  async ustavi(): Promise<void> {
    if (!this.zaprt) {
      try {
        this.klic.odlozi();
      } catch {
        /* ze koncan */
      }
      this.klicKoncan();
    }
    await this.koncan;
  }

  private sprosti(): void {
    if (this.zaprt) return;
    this.zaprt = true;
    if (this.takt) clearInterval(this.takt);
    this.takt = null;
    for (const t of this.markCasovniki.keys()) clearTimeout(t);
    this.markCasovniki.clear();
    this.vrsta = [];
    this.okvirjevVVrsti = 0;
    this.klic.off("zvok", this.naZvok);
    this.klic.off("konec", this.naKonec);
    // LiveMost zakljuci sam (zapisnik, zasedenost, Live); most pocaka nanj, da je ob 'koncan' res vse sproscemo.
    void this.most.naOdklop();
    void this.koncan;
    void this.most.koncan.then(() => this.razresiKonec?.());
  }
}
