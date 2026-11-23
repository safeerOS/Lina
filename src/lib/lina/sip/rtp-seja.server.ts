/**
 * Seja RTP (RFC 3550) za pot SIP: sprejem in oddaja zvoka G.711 (8 kHz) prek UDP (node:dgram).
 * Rekonstruirano iz prevoda nameščene Line (21. 11. 2026): v drevesu je bila ta datoteka po pomoti zamenjana z vsebino kazala modula.
 * - Sprejem: samo z dogovorjenega naslova in vrat, omejitev hitrosti, nepravilni paketi se štejejo in zavržejo (nikoli izjema), en SSRC.
 * - Oddaja: Linin govor (PCM 24 kHz) se prevzorči na 8 kHz in oddaja v paketih po 20 ms; DTMF po RFC 4733.
 * Dogodki: "zvok" (Int16Array, 24 kHz, 20 ms), "dtmf" (znak).
 */
import { randomInt } from "node:crypto";
import { createSocket, type Socket } from "node:dgram";
import { EventEmitter } from "node:events";
import { isIP } from "node:net";
import { paketiDtmf, SprejemnikDtmf, razcleniDtmf } from "./dtmf.ts";
import { dekodirajG711, kodirajG711, tisinaG711, type G711 } from "./g711.ts";
import { OmejevalnikHitrosti } from "./omejitve.ts";
import { razcleniRtp, sestaviRtp } from "./rtp.ts";
import { zrcaliSmer, type SmerMedija } from "./sdp.ts";
import { Navzdol24v8, Navzgor8v24 } from "./vzorcenje.ts";

const PAKET_MS = 20;
/** Vzorcev 8 kHz v enem paketu (20 ms). */
export const VZORCEV_V_PAKETU = 160;
/** Vzorcev 24 kHz v enem paketu (20 ms). */
export const VZORCEV_24K_V_PAKETU = 480;

export type MoznostiRtp = {
  lokalniNaslov: string;
  lokalnaVrata?: number;
  oddaljeno: { naslov: string; vrata: number };
  kodek: G711;
  tipKodeka: number;
  tipDtmf: number | null;
  smer?: SmerMedija;
  /** Ko ni zvoka, oddaja tisino (privzeto da), sicer oznaka za naslednji govor ostane. */
  tisinaKoNiZvoka?: boolean;
  /** Največ vzorcev 8 kHz v vrsti za oddajo (privzeto 80000). */
  najvecVrsta?: number;
  /** Največ sprejetih paketov na sekundo z dogovorjenega vira. Privzeto 150 (normalno 50). */
  najvecPaketovNaSekundo?: number;
};

export type StatistikaRtp = {
  prejeto: number;
  poslano: number;
  zavrnjenTujVir: number;
  zavrnjenSsrc: number;
  zavrnjenNapacen: number;
  zavrnjenTip: number;
  zavrnjenHitrost: number;
};

function normalizirajNaslov(n: string): string {
  return n.startsWith("::ffff:") && isIP(n.slice(7)) === 4 ? n.slice(7) : n;
}

export class RtpSeja extends EventEmitter {
  readonly statistika: StatistikaRtp = {
    prejeto: 0,
    poslano: 0,
    zavrnjenTujVir: 0,
    zavrnjenSsrc: 0,
    zavrnjenNapacen: 0,
    zavrnjenTip: 0,
    zavrnjenHitrost: 0,
  };
  private readonly socket: Socket;
  private readonly m: MoznostiRtp;
  private readonly navzgor = new Navzgor8v24();
  private readonly navzdol = new Navzdol24v8();
  private readonly dtmfSprejem = new SprejemnikDtmf();
  private readonly omejevalnik: OmejevalnikHitrosti;
  private oddaljeniSsrc: number | null = null;
  private zadnjaZaporedna: number | null = null;
  private kandidatZaporedna: number | null = null;
  private vrsta: Int16Array[] = [];
  private vVrsti = 0;
  private dtmfVrsta: { oznaka: boolean; koristno: Uint8Array; zig: number }[] = [];
  private readonly ssrc = randomInt(0, 2 ** 32 - 1);
  private zaporedna = randomInt(0, 65535);
  private zig = randomInt(0, 2 ** 31);
  private oznakaNaslednji = true;
  private casovnik: ReturnType<typeof setTimeout> | null = null;
  private zacetek = 0;
  private takt = 0;
  private zaprta = false;

  constructor(socket: Socket, m: MoznostiRtp) {
    super();
    this.socket = socket;
    this.m = { ...m, oddaljeno: { ...m.oddaljeno } };
    this.omejevalnik = new OmejevalnikHitrosti({
      kapaciteta: m.najvecPaketovNaSekundo ?? 150,
      napolnitev: m.najvecPaketovNaSekundo ?? 150,
      najvecVirov: 1,
    });
    socket.on("message", (msg, rinfo) => this.sprejmi(msg, rinfo.address, rinfo.port));
    socket.on("error", () => undefined);
  }

  /** Odpre vtičnico UDP na lokalnem naslovu (vrata 0 = prosta) in vrne sejo. */
  static odpri(m: MoznostiRtp): Promise<RtpSeja> {
    return new Promise((resolve, reject) => {
      const socket = createSocket({ type: isIP(m.lokalniNaslov) === 6 ? "udp6" : "udp4" });
      const napaka = (e: Error): void => reject(e);
      socket.once("error", napaka);
      socket.bind(m.lokalnaVrata ?? 0, m.lokalniNaslov, () => {
        socket.off("error", napaka);
        resolve(new RtpSeja(socket, m));
      });
    });
  }

  get lokalnaVrata(): number {
    return this.socket.address().port;
  }

  get dogovorjeniSsrc(): number | null {
    return this.oddaljeniSsrc;
  }

  /** Sprejem enega datagrama; vse, kar ni z dogovorjenega vira in v pravi obliki, se samo prešteje in zavrže. */
  sprejmi(msg: Uint8Array, naslov: string, vrata: number): void {
    if (this.zaprta) return;
    if (normalizirajNaslov(naslov) !== normalizirajNaslov(this.m.oddaljeno.naslov) || vrata !== this.m.oddaljeno.vrata) {
      this.statistika.zavrnjenTujVir++;
      return;
    }
    if (!this.omejevalnik.dovoli("vir")) {
      this.statistika.zavrnjenHitrost++;
      return;
    }
    if (msg.length > 1500) {
      this.statistika.zavrnjenNapacen++;
      return;
    }
    const izid = razcleniRtp(msg);
    if (!izid.ok) {
      this.statistika.zavrnjenNapacen++;
      return;
    }
    const p = izid.vrednost;
    if (p.tip !== this.m.tipKodeka && p.tip !== this.m.tipDtmf) {
      this.statistika.zavrnjenTip++;
      return;
    }
    if (!(p.tip === this.m.tipDtmf ? razcleniDtmf(p.koristno).ok : p.koristno.length > 0 && p.koristno.length <= 960)) {
      this.statistika.zavrnjenNapacen++;
      return;
    }
    if (this.oddaljeniSsrc !== null && p.ssrc !== this.oddaljeniSsrc) {
      this.statistika.zavrnjenSsrc++;
      return;
    }
    if (this.zadnjaZaporedna !== null && p.tip === this.m.tipKodeka) {
      const razlika = (p.zaporedna - this.zadnjaZaporedna) & 0xffff;
      if (razlika === 0 || razlika >= 0x8000) {
        // Podvojen ali zakasnel paket; dva zaporedna »nazaj« pomenita, da se je pošiljatelj vrnil (prehod na novo zaporedje).
        if (razlika !== 0 && this.kandidatZaporedna !== null && p.zaporedna === ((this.kandidatZaporedna + 1) & 0xffff)) {
          this.kandidatZaporedna = null;
        } else {
          this.kandidatZaporedna = razlika === 0 ? null : p.zaporedna;
          this.statistika.zavrnjenNapacen++;
          return;
        }
      } else {
        this.kandidatZaporedna = null;
      }
    }
    if (this.oddaljeniSsrc === null) this.oddaljeniSsrc = p.ssrc;
    this.statistika.prejeto++;
    if (p.tip === this.m.tipDtmf) {
      const znak = this.dtmfSprejem.sprejmi(p.casovniZig, p.koristno);
      if (znak) this.emit("dtmf", znak);
      return;
    }
    this.zadnjaZaporedna = p.zaporedna;
    const pcm8 = dekodirajG711(this.m.kodek, p.koristno);
    this.emit("zvok", this.navzgor.obdelaj(pcm8));
  }

  /** Posodobi smer ponudbe (npr. ob re-INVITE za zadrzanje ali nadaljevanje klica). */
  nastaviSmer(smer: SmerMedija | undefined): void {
    this.m.smer = smer;
    const nasaSmer = zrcaliSmer(smer);
    if (nasaSmer === "recvonly" || nasaSmer === "inactive") {
      this.dtmfVrsta = [];
      this.oznakaNaslednji = true;
    }
  }

  /** Posodobi oddaljeni naslov in vrata medija (ob re-INVITE). */
  nastaviOddaljeno(oddaljeno: { naslov: string; vrata: number }): void {
    if (normalizirajNaslov(oddaljeno.naslov) !== normalizirajNaslov(this.m.oddaljeno.naslov) || oddaljeno.vrata !== this.m.oddaljeno.vrata) {
      this.m.oddaljeno = { ...oddaljeno };
      this.oddaljeniSsrc = null;
      this.zadnjaZaporedna = null;
      this.kandidatZaporedna = null;
    }
  }

  /** Začne oddajo v taktu 20 ms. */
  zacni(): void {
    if (this.casovnik || this.zaprta) return;
    this.zacetek = performance.now();
    this.takt = 0;
    this.naslednjiTakt();
  }

  private naslednjiTakt(): void {
    if (this.zaprta) return;
    this.takt++;
    const zamik = Math.max(0, this.zacetek + this.takt * PAKET_MS - performance.now());
    this.casovnik = setTimeout(() => {
      this.oddajPaket();
      this.naslednjiTakt();
    }, zamik);
  }

  private oddajPaket(): void {
    const nasaSmer = zrcaliSmer(this.m.smer);
    if (nasaSmer === "recvonly" || nasaSmer === "inactive") {
      this.zig = (this.zig + VZORCEV_V_PAKETU) >>> 0;
      return;
    }
    const dtmf = this.dtmfVrsta.shift();
    if (dtmf && this.m.tipDtmf !== null) {
      this.posljiPaket(this.m.tipDtmf, dtmf.zig, dtmf.oznaka, dtmf.koristno);
      this.zig = (this.zig + VZORCEV_V_PAKETU) >>> 0;
      this.oznakaNaslednji = true;
      return;
    }
    const pcm = this.vzemi(VZORCEV_V_PAKETU);
    if (pcm) {
      this.posljiPaket(this.m.tipKodeka, this.zig, this.oznakaNaslednji, kodirajG711(this.m.kodek, pcm));
      this.oznakaNaslednji = false;
    } else if (this.m.tisinaKoNiZvoka ?? true) {
      this.posljiPaket(this.m.tipKodeka, this.zig, false, new Uint8Array(VZORCEV_V_PAKETU).fill(tisinaG711(this.m.kodek)));
    } else {
      this.oznakaNaslednji = true;
    }
    this.zig = (this.zig + VZORCEV_V_PAKETU) >>> 0;
  }

  private posljiPaket(tip: number, zig: number, oznaka: boolean, koristno: Uint8Array): void {
    const paket = sestaviRtp({ oznaka, tip, zaporedna: this.zaporedna, casovniZig: zig, ssrc: this.ssrc, koristno });
    this.zaporedna = (this.zaporedna + 1) & 0xffff;
    this.statistika.poslano++;
    this.socket.send(paket, this.m.oddaljeno.vrata, this.m.oddaljeno.naslov, () => undefined);
  }

  /** Vzame točno n vzorcev iz vrste ali nič, če jih ni dovolj. */
  private vzemi(n: number): Int16Array | null {
    if (this.vVrsti < n) return null;
    const izid = new Int16Array(n);
    let napolnjeno = 0;
    while (napolnjeno < n) {
      const prvi = this.vrsta[0] as Int16Array;
      const k = Math.min(n - napolnjeno, prvi.length);
      izid.set(prvi.subarray(0, k), napolnjeno);
      napolnjeno += k;
      if (k === prvi.length) this.vrsta.shift();
      else this.vrsta[0] = prvi.subarray(k);
    }
    this.vVrsti -= n;
    return izid;
  }

  /** Linin govor (16-bit PCM, 24 kHz, mono). Gre v vrsto in se oddaja v paketih po 20 ms. */
  poslji(pcm24k: Int16Array): void {
    if (this.zaprta || pcm24k.length === 0) return;
    const pcm8 = this.navzdol.obdelaj(pcm24k);
    if (pcm8.length === 0) return;
    this.vrsta.push(pcm8);
    this.vVrsti += pcm8.length;
    const meja = this.m.najvecVrsta ?? 80000;
    while (this.vVrsti > meja && this.vrsta.length > 0) {
      const odvec = this.vVrsti - meja;
      const prvi = this.vrsta[0] as Int16Array;
      if (prvi.length <= odvec) {
        this.vrsta.shift();
        this.vVrsti -= prvi.length;
      } else {
        this.vrsta[0] = prvi.subarray(odvec);
        this.vVrsti -= odvec;
      }
    }
  }

  /** Zavrže se neoddani govor (klicatelj je segel v besedo). Zadnji delni paket (< 20 ms) ostane do dopolnitve. */
  prekiniPredvajanje(): void {
    this.vrsta = [];
    this.vVrsti = 0;
    this.oznakaNaslednji = true;
  }

  /** Oddaja znaka DTMF (RFC 4733); zahteva dogovorjen telephone-event in oddajno smer. */
  posljiDtmf(znak: string, trajanjeMs = 100): boolean {
    const nasaSmer = zrcaliSmer(this.m.smer);
    if (this.m.tipDtmf === null || this.zaprta || nasaSmer === "recvonly" || nasaSmer === "inactive") return false;
    const zig = (this.zig + VZORCEV_V_PAKETU * this.dtmfVrsta.length) >>> 0;
    for (const p of paketiDtmf(znak, trajanjeMs)) this.dtmfVrsta.push({ ...p, zig });
    return true;
  }

  zapri(): void {
    if (this.zaprta) return;
    this.zaprta = true;
    if (this.casovnik) clearTimeout(this.casovnik);
    this.casovnik = null;
    this.removeAllListeners();
    try {
      this.socket.close();
    } catch {
      /* ze zaprta */
    }
  }
}
