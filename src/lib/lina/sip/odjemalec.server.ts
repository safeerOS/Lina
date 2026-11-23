/**
 * Odjemalec SIP prek UDP (node:dgram): registracija z digest (401/407), obnova pred iztekom, 423 Min-Expires,
 * ponovni poskus z narascajocim zamikom; sprejem klica (INVITE -> 100, 180, 200 + SDP; ACK, BYE, CANCEL, OPTIONS).
 * Vsak datagram je nezaupan: velikost, hitrost po viru, dovoljeni viri, najvec dialogov, razclenitev brez izjem.
 * Besedil za klicatelja tu NI: kaj Lina pove (tudi razkritje UI v prvem stavku), ostane v obstojeci logiki klica.
 */
import { randomBytes, randomInt } from "node:crypto";
import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import { lookup } from "node:dns/promises";
import { EventEmitter } from "node:events";
import { isIP } from "node:net";
import { glavaAvtorizacije, izberiIzziv, type DigestIzziv } from "./digest.ts";
import { OmejevalnikHitrosti } from "./omejitve.ts";
import { RtpSeja } from "./rtp-seja.server.ts";
import { dogovoriSe, razcleniSdp, razredNaslova, sestaviSdpOdgovor, type SdpDogovor } from "./sdp.ts";
import {
  odgovorNa,
  parametri,
  prvaGlava,
  razcleniCSeq,
  razcleniSip,
  razcleniVia,
  sestaviSip,
  SIP_OMEJITVE,
  uriIzNaslova,
  vseVrednosti,
  type Glava,
  type SipOdgovor,
  type SipZahteva,
} from "./sporocilo.ts";

export type SipKonfiguracija = {
  /** Registrar/posrednik ponudnika (ime ali IP). V kodi in preizkusih samo example.invalid ali 127.0.0.1. */
  registrar: string;
  vrata?: number;
  /** Domena naslova (AOR); privzeto registrar. */
  domena?: string;
  uporabnik: string;
  /** Uporabnisko ime za avtentikacijo, ce se razlikuje. */
  avtUporabnik?: string;
  /** Geslo iz nastavitev uporabnika (nastavitve.server.ts), nikoli iz kode. */
  geslo: string;
  lokalniNaslov?: string;
  lokalnaVrata?: number;
  /** Naslov v Via/Contact/SDP; privzeto naslov, s katerim sistem doseze registrar. */
  oglasevaniNaslov?: string;
  /** Zahtevana veljavnost registracije v sekundah (privzeto 300). */
  expires?: number;
  /** Najvec hkratnih klicev (privzeto 1: en klic naenkrat). */
  najvecDialogov?: number;
  /** Viri zahtev ("ip" ali "ip:vrata"); privzeto samo naslov registrarja. Zahteve drugih virov se tiho zavrzejo. */
  dovoljeniViri?: string[];
  casovniki?: Partial<Casovniki>;
  hitrost?: { kapaciteta: number; napolnitev: number };
  /** Naslovi IP medijskih streznikov ponudnika, ki se razlikujejo od naslova signalizacije. */
  dovoljeniMedijskiViri?: string[];
  /** Klic brez sprejema v tem casu dobi 480 (ms, privzeto 60 s). */
  rokSprejema?: number;
  rtpTisina?: boolean;
  /** Ce je true, morajo odgovori na odhodne zahteve priti z istih ali konfiguriranih vrat; privzeto false (NAT/SBC). */
  strogaVrataOdgovora?: boolean;
};

export type Casovniki = {
  /** RFC 3261 T1 (ms), privzeto 500. */
  t1: number;
  /** RFC 3261 T2 (ms), privzeto 4000. */
  t2: number;
  /** Prvi zamik po neuspehu registracije (ms), privzeto 2000. */
  zamikZacetni: number;
  /** Najvecji zamik (ms), privzeto 300 000. */
  zamikNajvecji: number;
};

export type RazlogKonca = "bye" | "preklic" | "odlozeno" | "brez-ack" | "neodgovorjeno" | "zavrnjeno" | "ustavljeno" | "napaka";

export interface DohodniKlicDogodki {
  /** Klicateljev glas, 16-bit PCM, 24 kHz, mono, 20 ms (480 vzorcev). */
  zvok: [pcm24k: Int16Array];
  dtmf: [znak: string];
  konec: [razlog: RazlogKonca];
}

export interface SipOdjemalecDogodki {
  registriran: [podatki: { expires: number }];
  napakaRegistracije: [podatki: { razlog: string; poskusCez: number }];
  klic: [klic: DohodniKlic];
  /** Zavrnjen datagram (samo razlog; vsebine ne belezimo). */
  zavrnjeno: [razlog: string];
}

type StreznikTransakcija = { branch: string; metoda: string; zadnji: Buffer | null; cilj: RemoteInfo; casovnik: NodeJS.Timeout | null; konec: NodeJS.Timeout | null };

const ALLOW = "INVITE, ACK, CANCEL, BYE, OPTIONS";
const NAJVEC_TRANSAKCIJ = 64;

function nakljucno(n = 8): string {
  return randomBytes(n).toString("hex");
}

function normalizirajNaslov(n: string): string {
  return n.startsWith("::ffff:") && isIP(n.slice(7)) === 4 ? n.slice(7) : n;
}

function oznakaNaslova(n: string, vrata: number): string {
  return isIP(n) === 6 ? `[${n}]:${vrata}` : `${n}:${vrata}`;
}

/** Dohodni klic: aplikacija ga sprejme (sprejmi) ali zavrne; zvok 24 kHz gre v obe smeri. */
export class DohodniKlic extends EventEmitter<DohodniKlicDogodki> {
  readonly callId: string;
  /** Uporabniski del From (stevilka klicatelja, kot jo poda ponudnik); ni preverjen. */
  readonly klicatelj: string;
  dogovor: SdpDogovor;
  stanje: "zvoni" | "sprejet" | "potrjen" | "koncan" = "zvoni";
  /** @internal */ rtp: RtpSeja | null = null;
  /** @internal */ readonly lokalniTag: string;
  /** @internal */ readonly oddaljeniTag: string;
  /** @internal */ readonly invite: SipZahteva;
  /** @internal */ readonly vir: RemoteInfo;
  #odjemalec: SipOdjemalec;

  /** @internal */
  constructor(odjemalec: SipOdjemalec, invite: SipZahteva, vir: RemoteInfo, dogovor: SdpDogovor) {
    super();
    this.#odjemalec = odjemalec;
    this.invite = invite;
    this.vir = vir;
    this.dogovor = dogovor;
    this.callId = prvaGlava(invite, "call-id") ?? "";
    this.lokalniTag = nakljucno(6);
    this.oddaljeniTag = parametri(prvaGlava(invite, "from") ?? "").get("tag") ?? "";
    const uri = uriIzNaslova(prvaGlava(invite, "from") ?? "");
    this.klicatelj = (/^sips?:([^@;]+)@/i.exec(uri)?.[1] ?? "")
      .replace(/[^\x20-\x7E\u0100-\u017F]/g, "")
      .trim()
      .slice(0, 64)
      .trim();
  }

  /** @internal */
  posodobiDogovor(d: SdpDogovor): void {
    this.dogovor = d;
    this.rtp?.nastaviSmer(d.smer);
    this.rtp?.nastaviOddaljeno({ naslov: d.naslov, vrata: d.vrata });
  }

  /** Sprejme klic: odpre RTP, poslje 200 OK s SDP odgovorom. */
  sprejmi(): Promise<void> {
    return this.#odjemalec.sprejmiKlic(this);
  }

  /** Zavrne klic, ki se zvoni (privzeto 486 Busy Here). */
  zavrni(status = 486, razlog = "Busy Here"): void {
    this.#odjemalec.zavrniKlic(this, status, razlog);
  }

  /** Konca sprejet klic (BYE). */
  odlozi(): void {
    this.#odjemalec.odloziKlic(this);
  }

  /** Linin govor: 16-bit PCM, 24 kHz, mono. */
  poslji(pcm24k: Int16Array): void {
    this.rtp?.poslji(pcm24k);
  }

  prekiniPredvajanje(): void {
    this.rtp?.prekiniPredvajanje();
  }

  posljiDtmf(znak: string, trajanjeMs?: number): boolean {
    return this.rtp?.posljiDtmf(znak, trajanjeMs) ?? false;
  }
}

export class SipOdjemalec extends EventEmitter<SipOdjemalecDogodki> {
  readonly #k: SipKonfiguracija;
  private readonly c: Casovniki;
  private socket: Socket | null = null;
  private registrarIp = "";
  private oglasevani = "";
  private lokalnaVrata = 0;
  private readonly callIdRegistracije = `${nakljucno(12)}@lina`;
  private cseqRegistracije = randomInt(1, 10000);
  private expires: number;
  private izziv: { glava: "authorization" | "proxy-authorization"; izziv: DigestIzziv; nc: number } | null = null;
  private neuspehi = 0;
  private casovnikRegistracije: NodeJS.Timeout | null = null;
  private ustavljen = false;
  private registracijaTece = false;
  private readonly odjemalskeTransakcije = new Map<
    string,
    { naslov: string; vrata: number; callId: string; cseq: string; obOdgovoru: (o: SipOdgovor) => void; prekini: () => void }
  >();
  private readonly streznikTransakcije = new Map<string, StreznikTransakcija>();
  private readonly klici = new Map<string, DohodniKlic>();
  private readonly omejevalnik: OmejevalnikHitrosti;
  /** Locen omejevalnik za neveljavne datagrame: ponarejena navlaka ne porabi zetonov pravega prometa. */
  private readonly omejevalnikSmeti: OmejevalnikHitrosti;
  /** Nedavno videni INVITE (branch + Call-ID) do izteka 64*T1: zakasnela ponovitev po koncu transakcije ni nov klic (SIP1-3). */
  private readonly nedavniInviti = new Map<string, number>();
  private readonly casovnikiKlicev = new Map<DohodniKlic, NodeJS.Timeout>();
  private cseqLokalni = randomInt(1, 10000);
  /** Zadnja dosezena veljavnost registracije (s) ali null. */
  registriranDo: number | null = null;
  /** Stevec zavrnjenih datagramov (brez osebnih podatkov). */
  zavrnjenih = 0;
  readonly zavrnjeniPoRazlogu: Record<string, number> = {};

  constructor(k: SipKonfiguracija) {
    super();
    if (!k.registrar || !k.uporabnik || typeof k.geslo !== "string") throw new TypeError("nepopolna nastavitev SIP");
    this.#k = { ...k };
    this.c = { t1: 500, t2: 4000, zamikZacetni: 2000, zamikNajvecji: 300_000, ...k.casovniki };
    this.expires = Math.max(1, Math.min(86400, Math.trunc(k.expires ?? 300)));
    this.omejevalnik = new OmejevalnikHitrosti({ kapaciteta: k.hitrost?.kapaciteta ?? 40, napolnitev: k.hitrost?.napolnitev ?? 20, najvecVirov: 256 });
    this.omejevalnikSmeti = new OmejevalnikHitrosti({ kapaciteta: k.hitrost?.kapaciteta ?? 40, napolnitev: k.hitrost?.napolnitev ?? 20, najvecVirov: 256 });
  }

  get naslov(): { naslov: string; vrata: number } {
    return { naslov: this.oglasevani, vrata: this.lokalnaVrata };
  }

  get steviloKlicev(): number {
    return this.klici.size;
  }

  /** Odpre vrata UDP in zacne registracijo. */
  async zazeni(): Promise<void> {
    const vrata = this.#k.vrata ?? 5060;
    this.registrarIp = isIP(this.#k.registrar) ? this.#k.registrar : (await lookup(this.#k.registrar, { family: 4 })).address;
    const lokalni = this.#k.lokalniNaslov ?? "0.0.0.0";
    const socket = createSocket({ type: isIP(lokalni) === 6 ? "udp6" : "udp4" });
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(this.#k.lokalnaVrata ?? 0, lokalni, () => {
        socket.off("error", reject);
        resolve();
      });
    });
    socket.on("error", () => undefined);
    socket.on("message", (msg, rinfo) => this.prejeto(msg, rinfo));
    this.socket = socket;
    this.lokalnaVrata = socket.address().port;
    this.oglasevani = this.#k.oglasevaniNaslov ?? (lokalni !== "0.0.0.0" && lokalni !== "::" ? lokalni : await izhodniNaslov(this.registrarIp, vrata));
    void this.registriraj();
  }

  /** Odjava (Expires: 0, brez cakanja dlje kot 2 s), konec klicev in zaprtje vrat. */
  async ustavi(): Promise<void> {
    if (this.ustavljen) return;
    this.ustavljen = true;
    if (this.casovnikRegistracije) clearTimeout(this.casovnikRegistracije);
    for (const klic of [...this.klici.values()]) {
      if (klic.stanje === "zvoni") this.zavrniKlic(klic, 480, "Temporarily Unavailable");
      else this.odloziKlic(klic, "ustavljeno");
    }
    if (this.registriranDo !== null && this.socket) {
      await Promise.race([this.registracijskaZahteva(0).catch(() => undefined), new Promise((r) => setTimeout(r, 2000))]);
    }
    for (const t of this.streznikTransakcije.values()) {
      if (t.casovnik) clearTimeout(t.casovnik);
      if (t.konec) clearTimeout(t.konec);
    }
    this.streznikTransakcije.clear();
    for (const t of [...this.odjemalskeTransakcije.values()]) t.prekini();
    this.odjemalskeTransakcije.clear();
    try {
      this.socket?.close();
    } catch {
      // ze zaprto
    }
    this.socket = null;
  }

  // ---------------------------------------------------------------- prenos

  private poslji(b: Buffer, naslov: string, vrata: number): void {
    if (!this.socket) return;
    this.socket.send(b, vrata, naslov, () => undefined);
  }

  private via(branch: string): string {
    return `SIP/2.0/UDP ${oznakaNaslova(this.oglasevani, this.lokalnaVrata)};branch=${branch};rport`;
  }

  private contact(): string {
    const host = isIP(this.oglasevani) === 6 ? `[${this.oglasevani}]` : this.oglasevani;
    return `<sip:${this.#k.uporabnik}@${host}:${this.lokalnaVrata};transport=udp>`;
  }

  /**
   * Odjemalska transakcija brez INVITE (RFC 3261 17.1.2): ponovitve na T1, 2T1 ... do T2, rok 64*T1.
   * Vrne koncni odgovor (>= 200).
   */
  private transakcija(z: SipZahteva, naslov: string, vrata: number): Promise<SipOdgovor> {
    const via = razcleniVia(prvaGlava(z, "via") ?? "");
    const branch = via?.branch ?? "";
    const callId = prvaGlava(z, "call-id") ?? "";
    const cseqZ = razcleniCSeq(prvaGlava(z, "cseq") ?? "");
    const cseq = cseqZ ? `${cseqZ.stevilka} ${cseqZ.metoda}` : (prvaGlava(z, "cseq") ?? "").trim();
    const datagram = sestaviSip(z);
    return new Promise((resolve, reject) => {
      let interval = this.c.t1;
      let ponovitev: NodeJS.Timeout | null = null;
      const konec = setTimeout(() => {
        pocisti();
        reject(new Error("casovna omejitev"));
      }, 64 * this.c.t1);
      const pocisti = () => {
        clearTimeout(konec);
        if (ponovitev) clearTimeout(ponovitev);
        this.odjemalskeTransakcije.delete(branch);
      };
      const ponovi = () => {
        ponovitev = setTimeout(() => {
          this.poslji(datagram, naslov, vrata);
          interval = Math.min(interval * 2, this.c.t2);
          ponovi();
        }, interval);
      };
      this.odjemalskeTransakcije.set(branch, {
        naslov: normalizirajNaslov(naslov),
        vrata,
        callId,
        cseq,
        obOdgovoru: (o) => {
          if (o.status < 200) {
            interval = this.c.t2;
            return;
          }
          pocisti();
          resolve(o);
        },
        prekini: () => {
          pocisti();
          reject(new Error("ustavljeno"));
        },
      });
      this.poslji(datagram, naslov, vrata);
      ponovi();
    });
  }

  // ---------------------------------------------------------------- registracija

  private registracijskaZahteva(expires: number): Promise<SipOdgovor> {
    const domena = this.#k.domena ?? this.#k.registrar;
    const aor = `sip:${this.#k.uporabnik}@${domena}`;
    const uri = `sip:${domena}`;
    this.cseqRegistracije++;
    const glave: Glava[] = [
      { ime: "via", vrednost: this.via(`z9hG4bK${nakljucno()}`) },
      { ime: "max-forwards", vrednost: "70" },
      { ime: "from", vrednost: `<${aor}>;tag=${nakljucno(4)}` },
      { ime: "to", vrednost: `<${aor}>` },
      { ime: "call-id", vrednost: this.callIdRegistracije },
      { ime: "cseq", vrednost: `${this.cseqRegistracije} REGISTER` },
      { ime: "contact", vrednost: this.contact() },
      { ime: "expires", vrednost: String(expires) },
      { ime: "allow", vrednost: ALLOW },
      { ime: "user-agent", vrednost: "Lina" },
    ];
    if (this.izziv) {
      this.izziv.nc++;
      glave.push({
        ime: this.izziv.glava,
        vrednost: glavaAvtorizacije(this.izziv.izziv, { uporabnik: this.#k.avtUporabnik ?? this.#k.uporabnik, geslo: this.#k.geslo, metoda: "REGISTER", uri, nc: this.izziv.nc }),
      });
    }
    return this.transakcija({ vrsta: "zahteva", metoda: "REGISTER", uri, glave, telo: "" }, this.registrarIp, this.#k.vrata ?? 5060);
  }

  private async registriraj(): Promise<void> {
    if (this.ustavljen || this.registracijaTece) return;
    this.registracijaTece = true;
    try {
      const izid = await this.poskusRegistracije();
      if (this.ustavljen) return;
      this.neuspehi = 0;
      this.registriranDo = izid;
      this.emit("registriran", { expires: izid });
      // Obnova pred iztekom: pri dolgi veljavnosti 30 s prej, pri kratki pri 60 %.
      const cez = (izid >= 60 ? izid - 30 : izid * 0.6) * 1000;
      this.nacrtuj(cez);
    } catch (e) {
      if (this.ustavljen) return;
      this.registriranDo = null;
      const zamik = Math.min(this.c.zamikNajvecji, this.c.zamikZacetni * 2 ** this.neuspehi);
      this.neuspehi = Math.min(this.neuspehi + 1, 30);
      this.emit("napakaRegistracije", { razlog: (e as Error).message, poskusCez: zamik });
      this.nacrtuj(zamik);
    } finally {
      this.registracijaTece = false;
    }
  }

  private nacrtuj(ms: number): void {
    if (this.casovnikRegistracije) clearTimeout(this.casovnikRegistracije);
    this.casovnikRegistracije = setTimeout(() => void this.registriraj(), ms);
  }

  /** Ena registracija z odzivi 401/407/423; vrne odobreno veljavnost v sekundah. */
  private async poskusRegistracije(): Promise<number> {
    let nonceZadnji: string | null = null;
    for (let poskus = 0; poskus < 5; poskus++) {
      const o = await this.registracijskaZahteva(this.expires);
      if (o.status >= 200 && o.status < 300) return this.odobrenaVeljavnost(o);
      if (o.status === 401 || o.status === 407) {
        const glava = o.status === 401 ? "www-authenticate" : "proxy-authenticate";
        const izbran = izberiIzziv(vseVrednosti(o, glava));
        if (!izbran.ok) throw new Error(`izziv: ${izbran.napaka}`);
        const iz = izbran.vrednost;
        // Isti nonce brez stale=true po poslani avtorizaciji pomeni napacno ime ali geslo: ne ponavljamo v nedogled.
        if (this.izziv && nonceZadnji === iz.nonce && !iz.stale) {
          this.izziv = null;
          throw new Error("prijava zavrnjena (ime ali geslo)");
        }
        this.izziv = { glava: o.status === 401 ? "authorization" : "proxy-authorization", izziv: iz, nc: 0 };
        nonceZadnji = iz.nonce;
        continue;
      }
      if (o.status === 423) {
        const min = Number(prvaGlava(o, "min-expires") ?? "");
        if (!Number.isInteger(min) || min <= this.expires || min > 86400) throw new Error("423 brez veljavnega Min-Expires");
        this.expires = min;
        continue;
      }
      throw new Error(`registrar ${o.status}`);
    }
    throw new Error("prevec poskusov registracije");
  }

  private odobrenaVeljavnost(o: SipOdgovor): number {
    const nas = this.contact();
    let expires: number | null = null;
    for (const c of vseVrednosti(o, "contact")) {
      if (uriIzNaslova(c) !== uriIzNaslova(nas)) continue;
      const e = parametri(c).get("expires");
      if (e !== undefined && /^\d{1,10}$/.test(e)) expires = Number(e);
    }
    if (expires === null) {
      const e = prvaGlava(o, "expires");
      if (e !== undefined && /^\d{1,10}$/.test(e)) expires = Number(e);
    }
    const izid = expires ?? this.expires;
    if (izid <= 0) throw new Error("registrar ni odobril veljavnosti");
    return Math.min(izid, 86400);
  }

  // ---------------------------------------------------------------- sprejem

  private dovoljenVir(r: RemoteInfo): boolean {
    const naslov = normalizirajNaslov(r.address);
    const seznam = this.#k.dovoljeniViri ?? [this.registrarIp];
    return seznam.some((v) => v === naslov || v === `${naslov}:${r.port}` || v === `[${naslov}]:${r.port}`);
  }

  private zavrni(razlog: string): void {
    this.zavrnjenih += 1;
    this.zavrnjeniPoRazlogu[razlog] = (this.zavrnjeniPoRazlogu[razlog] ?? 0) + 1;
    this.emit("zavrnjeno", razlog);
  }

  private prejeto(msg: Buffer, r: RemoteInfo): void {
    try {
      this.obdelaj(msg, r);
    } catch {
      this.zavrni("notranja napaka");
    }
  }

  private obdelaj(msg: Buffer, r: RemoteInfo): void {
    if (msg.length > SIP_OMEJITVE.najvecBajtov) return void this.zavrni("prevelik datagram");
    // Ohranjanje NAT (RFC 5626 CRLF) ni sporocilo.
    if (msg.length <= 4 && msg.toString("latin1").replace(/\r\n/g, "") === "") return;
    const izid = razcleniSip(msg);
    if (!izid.ok) {
      // Nerazclenljivo navlako steje locen omejevalnik, da ponarejen tok z naslova registrarja ne utisa pravega prometa.
      if (!this.omejevalnikSmeti.dovoli(normalizirajNaslov(r.address))) return void this.zavrni("hitrost");
      return void this.zavrni(izid.napaka);
    }
    const s = izid.vrednost;
    if (s.vrsta === "odgovor") {
      const branch = razcleniVia(vseVrednosti(s, "via")[0] ?? "")?.branch ?? "";
      const t = this.odjemalskeTransakcije.get(branch);
      if (!t) return void this.zavrni("odgovor brez transakcije");
      const naslov = normalizirajNaslov(r.address);
      const odgCallId = prvaGlava(s, "call-id") ?? "";
      const odgCseqZ = razcleniCSeq(prvaGlava(s, "cseq") ?? "");
      const odgCseq = odgCseqZ ? `${odgCseqZ.stevilka} ${odgCseqZ.metoda}` : (prvaGlava(s, "cseq") ?? "").trim();
      const ujemaZahtevi = odgCallId === t.callId && odgCseq === t.cseq;
      // Odgovor velja z IP naslova zahteve: dovolimo vrata zahteve, konfigurirana vrata ali izrecno dovoljena vrata;
      // za druga vrata z istega IP (NAT/SBC) dovolimo, ko se ujemajo branch, Call-ID in CSeq poslane zahteve (ce ni strogaVrataOdgovora).
      const znanaVrata =
        r.port === t.vrata ||
        r.port === (this.#k.vrata ?? 5060) ||
        (this.#k.dovoljeniViri ?? []).some((v) => v === `${naslov}:${r.port}` || v === `[${naslov}]:${r.port}`);
      const dovoljenaVrata = znanaVrata || (!this.#k.strogaVrataOdgovora && ujemaZahtevi);
      if (naslov !== t.naslov || !ujemaZahtevi || !dovoljenaVrata) return void this.zavrni("tuj vir");
      t.obOdgovoru(s);
      return;
    }
    // Po ustavitvi se obdelajo samo se odgovori (odjava), nove zahteve ne.
    if (this.ustavljen) return;
    if (!this.dovoljenVir(r)) return void this.zavrni("tuj vir");
    const via = razcleniVia(vseVrednosti(s, "via")[0] ?? "");
    if (!via || !via.branch) return void this.zavrni("napacna Via");
    // Omejitev hitrosti velja za nove zahteve. Odgovori na nase transakcije (zgoraj) in zahteve znotraj znanega dialoga
    // ali transakcije (ACK, BYE, ponovitev INVITE) ne porabljajo zetonov: napadalec bi moral poznati Call-ID in oznake.
    if (!this.znanaZahteva(s, via.branch) && !this.omejevalnik.dovoli(normalizirajNaslov(r.address))) return void this.zavrni("hitrost");
    switch (s.metoda) {
      case "INVITE":
        return this.invite(s, r, via.branch);
      case "ACK":
        return this.ack(s);
      case "CANCEL":
        return this.cancel(s, r, via.branch);
      case "BYE":
        return this.bye(s, r);
      case "OPTIONS":
        this.odgovori(s, r, 200, "OK", { glave: [{ ime: "allow", vrednost: ALLOW }, { ime: "accept", vrednost: "application/sdp" }] });
        return;
      default:
        this.odgovori(s, r, 405, "Method Not Allowed", { glave: [{ ime: "allow", vrednost: ALLOW }] });
        return;
    }
  }

  private odgovori(z: SipZahteva, r: RemoteInfo, status: number, razlog: string, dodatno: { toTag?: string; glave?: Glava[]; telo?: string } = {}): Buffer {
    const b = sestaviSip(odgovorNa(z, status, razlog, dodatno));
    this.poslji(b, r.address, r.port);
    return b;
  }

  private kljucDialoga(callId: string, lokalni: string, oddaljeni: string): string {
    return `${callId}\u0000${lokalni}\u0000${oddaljeni}`;
  }

  /** Zahteva znotraj obstojecega dialoga ali transakcije. */
  private znanaZahteva(z: SipZahteva, branch: string): boolean {
    if (this.streznikTransakcije.has(`${branch}|INVITE`)) return true;
    if (z.metoda === "ACK" || z.metoda === "BYE" || (z.metoda === "INVITE" && parametri(prvaGlava(z, "to") ?? "").has("tag"))) return this.najdiKlic(z) !== undefined;
    return false;
  }

  /** Medijski naslov: naslov signalizacije, naveden medijski streznik, javen naslov ali zasebni iz zasebnega vira. */
  private dovoljenMedij(medij: string, vir: string): boolean {
    const m = normalizirajNaslov(medij);
    if (m === vir) return true;
    if ((this.#k.dovoljeniMedijskiViri ?? []).some((v) => normalizirajNaslov(v) === m)) return true;
    const razred = razredNaslova(m);
    if (razred === "javen") return true;
    return razred === "zasebni" && razredNaslova(vir) === "zasebni";
  }

  private najdiKlic(z: SipZahteva): DohodniKlic | undefined {
    const callId = prvaGlava(z, "call-id") ?? "";
    const lokalni = parametri(prvaGlava(z, "to") ?? "").get("tag") ?? "";
    const oddaljeni = parametri(prvaGlava(z, "from") ?? "").get("tag") ?? "";
    return this.klici.get(this.kljucDialoga(callId, lokalni, oddaljeni));
  }

  private invite(z: SipZahteva, r: RemoteInfo, branch: string): void {
    const obstojeca = this.streznikTransakcije.get(`${branch}|INVITE`);
    if (obstojeca) {
      // Ponovitev INVITE: ponovi zadnji odgovor.
      if (obstojeca.zadnji) this.poslji(obstojeca.zadnji, r.address, r.port);
      return;
    }
    if (parametri(prvaGlava(z, "to") ?? "").has("tag")) {
      // re-INVITE v obstojecem dialogu (zadrzanje/nadaljevanje, sendonly/inactive/recvonly/sendrecv): preberi novo SDP in odgovori z zrcaljeno smerjo.
      const klic = this.najdiKlic(z);
      if (!klic || !klic.rtp) return void this.odgovori(z, r, 481, "Call/Transaction Does Not Exist");
      if (z.telo) {
        const tipRe = (prvaGlava(z, "content-type") ?? "").split(";")[0]?.trim().toLowerCase();
        if (tipRe !== "application/sdp") return void this.odgovori(z, r, 488, "Not Acceptable Here");
        const sdpRe = razcleniSdp(z.telo);
        const dogovorRe = sdpRe.ok ? dogovoriSe(sdpRe.vrednost) : sdpRe;
        if (!dogovorRe.ok) return void this.odgovori(z, r, 488, "Not Acceptable Here");
        if (!this.dovoljenMedij(dogovorRe.vrednost.naslov, normalizirajNaslov(r.address))) return void this.odgovori(z, r, 488, "Not Acceptable Here");
        klic.posodobiDogovor(dogovorRe.vrednost);
      }
      this.odgovori(z, r, 200, "OK", {
        glave: [{ ime: "contact", vrednost: this.contact() }, { ime: "content-type", vrednost: "application/sdp" }],
        telo: this.sdpOdgovor(klic),
      });
      return;
    }
    const kljucInvite = `${branch}|${prvaGlava(z, "call-id") ?? ""}`;
    const zdajMs = performance.now();
    for (const [k, rok] of this.nedavniInviti) {
      if (rok > zdajMs) break;
      this.nedavniInviti.delete(k);
    }
    if (this.nedavniInviti.has(kljucInvite)) return void this.zavrni("ponovitev INVITE");
    if (this.streznikTransakcije.size >= NAJVEC_TRANSAKCIJ) return void this.zavrni("prevec transakcij");
    if (this.klici.size >= (this.#k.najvecDialogov ?? 1)) return void this.odgovori(z, r, 486, "Busy Here");
    const tip = (prvaGlava(z, "content-type") ?? "").split(";")[0]?.trim().toLowerCase();
    if (tip !== "application/sdp" || !z.telo) return void this.odgovori(z, r, 488, "Not Acceptable Here");
    const sdp = razcleniSdp(z.telo);
    const dogovor = sdp.ok ? dogovoriSe(sdp.vrednost) : sdp;
    if (!dogovor.ok) return void this.odgovori(z, r, 488, "Not Acceptable Here");
    if (!this.dovoljenMedij(dogovor.vrednost.naslov, normalizirajNaslov(r.address))) return void this.odgovori(z, r, 488, "Not Acceptable Here");
    const klic = new DohodniKlic(this, z, r, dogovor.vrednost);
    if (!klic.oddaljeniTag || !klic.callId) return void this.odgovori(z, r, 400, "Bad Request");
    const t: StreznikTransakcija = { branch, metoda: "INVITE", zadnji: null, cilj: r, casovnik: null, konec: null };
    this.streznikTransakcije.set(`${branch}|INVITE`, t);
    this.nedavniInviti.set(kljucInvite, zdajMs + 64 * this.c.t1);
    while (this.nedavniInviti.size > 256) {
      const prvi = this.nedavniInviti.keys().next().value;
      if (prvi === undefined) break;
      this.nedavniInviti.delete(prvi);
    }
    this.klici.set(this.kljucDialoga(klic.callId, klic.lokalniTag, klic.oddaljeniTag), klic);
    t.zadnji = this.odgovori(z, r, 100, "Trying");
    t.zadnji = this.odgovori(z, r, 180, "Ringing", { toTag: klic.lokalniTag, glave: [{ ime: "contact", vrednost: this.contact() }] });
    const rok = setTimeout(() => {
      if (klic.stanje === "zvoni") this.zavrniKlic(klic, 480, "Temporarily Unavailable", "neodgovorjeno");
    }, this.#k.rokSprejema ?? 60_000);
    this.casovnikiKlicev.set(klic, rok);
    this.emit("klic", klic);
  }

  private sdpOdgovor(klic: DohodniKlic): string {
    return sestaviSdpOdgovor(klic.dogovor, { naslov: this.oglasevani, vrata: klic.rtp?.lokalnaVrata ?? 0, sejaId: String(randomInt(1, 2 ** 31)) });
  }

  /** Koncni odgovor na INVITE s ponovitvami (T1 ... T2) do ACK ali roka 64*T1 (RFC 3261 13.3.1.4, 17.2.1). */
  private koncniNaInvite(klic: DohodniKlic, status: number, razlog: string, dodatno: { glave?: Glava[]; telo?: string }, obRoku: () => void): void {
    const branch = razcleniVia(vseVrednosti(klic.invite, "via")[0] ?? "")?.branch ?? "";
    const t = this.streznikTransakcije.get(`${branch}|INVITE`);
    const b = this.odgovori(klic.invite, klic.vir, status, razlog, { toTag: klic.lokalniTag, ...dodatno });
    if (!t) return;
    t.zadnji = b;
    let interval = this.c.t1;
    const ponovi = () => {
      t.casovnik = setTimeout(() => {
        this.poslji(b, klic.vir.address, klic.vir.port);
        interval = Math.min(interval * 2, this.c.t2);
        ponovi();
      }, interval);
    };
    ponovi();
    t.konec = setTimeout(() => {
      if (t.casovnik) clearTimeout(t.casovnik);
      this.streznikTransakcije.delete(`${branch}|INVITE`);
      obRoku();
    }, 64 * this.c.t1);
  }

  /** @internal */
  async sprejmiKlic(klic: DohodniKlic): Promise<void> {
    if (klic.stanje !== "zvoni") throw new Error("klic ne zvoni");
    klic.stanje = "sprejet";
    this.ustaviRok(klic);
    const lokalni = this.#k.lokalniNaslov ?? "0.0.0.0";
    let rtp: RtpSeja;
    try {
      rtp = await RtpSeja.odpri({
        lokalniNaslov: lokalni,
        oddaljeno: { naslov: klic.dogovor.naslov, vrata: klic.dogovor.vrata },
        kodek: klic.dogovor.kodek,
        tipKodeka: klic.dogovor.tipKodeka,
        tipDtmf: klic.dogovor.tipDtmf,
        tisinaKoNiZvoka: this.#k.rtpTisina,
        smer: klic.dogovor.smer,
      });
    } catch (e) {
      klic.stanje = "zvoni";
      this.zavrniKlic(klic, 500, "Server Internal Error", "napaka");
      throw e;
    }
    if (this.ustavljen || (klic.stanje as string) === "koncan") {
      rtp.zapri();
      return;
    }
    klic.rtp = rtp;
    rtp.on("zvok", (pcm) => klic.emit("zvok", pcm));
    rtp.on("dtmf", (z) => klic.emit("dtmf", z));
    this.koncniNaInvite(
      klic,
      200,
      "OK",
      { glave: [{ ime: "contact", vrednost: this.contact() }, { ime: "allow", vrednost: ALLOW }, { ime: "content-type", vrednost: "application/sdp" }], telo: this.sdpOdgovor(klic) },
      () => {
        if (klic.stanje === "sprejet") this.odloziKlic(klic, "brez-ack");
      },
    );
    rtp.zacni();
  }

  /** @internal */
  zavrniKlic(klic: DohodniKlic, status: number, razlog: string, razlogKonca: RazlogKonca = "zavrnjeno"): void {
    if (klic.stanje !== "zvoni") return;
    this.koncniNaInvite(klic, status, razlog, {}, () => undefined);
    this.koncaj(klic, razlogKonca);
  }

  /** @internal */
  odloziKlic(klic: DohodniKlic, razlog: RazlogKonca = "odlozeno"): void {
    if (klic.stanje === "zvoni") return this.zavrniKlic(klic, 480, "Temporarily Unavailable", razlog);
    if (klic.stanje === "koncan") return;
    const from = prvaGlava(klic.invite, "to") ?? "";
    const glave: Glava[] = [
      { ime: "via", vrednost: this.via(`z9hG4bK${nakljucno()}`) },
      { ime: "max-forwards", vrednost: "70" },
      { ime: "from", vrednost: parametri(from).has("tag") ? from : `${from};tag=${klic.lokalniTag}` },
      { ime: "to", vrednost: prvaGlava(klic.invite, "from") ?? "" },
      { ime: "call-id", vrednost: klic.callId },
      { ime: "cseq", vrednost: `${++this.cseqLokalni} BYE` },
      ...vseVrednosti(klic.invite, "record-route").map((v) => ({ ime: "route", vrednost: v })),
      { ime: "user-agent", vrednost: "Lina" },
    ];
    const cilj = uriIzNaslova(prvaGlava(klic.invite, "contact") ?? "") || klic.invite.uri;
    // BYE gre na vir INVITE (posrednik ponudnika; deluje tudi za NAT), Request-URI je klicateljev Contact.
    this.transakcija({ vrsta: "zahteva", metoda: "BYE", uri: cilj, glave, telo: "" }, klic.vir.address, klic.vir.port).catch(() => undefined);
    this.koncaj(klic, razlog);
  }

  private ustaviRok(klic: DohodniKlic): void {
    const t = this.casovnikiKlicev.get(klic);
    if (t) clearTimeout(t);
    this.casovnikiKlicev.delete(klic);
  }

  private koncaj(klic: DohodniKlic, razlog: RazlogKonca): void {
    if (klic.stanje === "koncan") return;
    klic.stanje = "koncan";
    this.ustaviRok(klic);
    klic.rtp?.zapri();
    this.klici.delete(this.kljucDialoga(klic.callId, klic.lokalniTag, klic.oddaljeniTag));
    klic.emit("konec", razlog);
  }

  private ack(z: SipZahteva): void {
    const klic = this.najdiKlic(z);
    if (!klic) {
      this.ackBrezDialoga(z);
      return;
    }
    const branch = razcleniVia(vseVrednosti(klic.invite, "via")[0] ?? "")?.branch ?? "";
    const t = this.streznikTransakcije.get(`${branch}|INVITE`);
    if (t) {
      if (t.casovnik) clearTimeout(t.casovnik);
      if (t.konec) clearTimeout(t.konec);
      this.streznikTransakcije.delete(`${branch}|INVITE`);
    }
    if (klic.stanje === "sprejet") klic.stanje = "potrjen";
  }

  /** ACK na koncni odgovor, ki ni 2xx (npr. 487 po CANCEL), nima dialoga: poisce se po branch. */
  private ackBrezDialoga(z: SipZahteva): boolean {
    const branch = razcleniVia(vseVrednosti(z, "via")[0] ?? "")?.branch ?? "";
    const t = this.streznikTransakcije.get(`${branch}|INVITE`);
    if (!t) return false;
    if (t.casovnik) clearTimeout(t.casovnik);
    if (t.konec) clearTimeout(t.konec);
    this.streznikTransakcije.delete(`${branch}|INVITE`);
    return true;
  }

  private cancel(z: SipZahteva, r: RemoteInfo, branch: string): void {
    const callId = prvaGlava(z, "call-id") ?? "";
    const klic = [...this.klici.values()].find((k) => k.callId === callId && razcleniVia(vseVrednosti(k.invite, "via")[0] ?? "")?.branch === branch);
    if (!klic) return void this.odgovori(z, r, 481, "Call/Transaction Does Not Exist");
    this.odgovori(z, r, 200, "OK", { toTag: klic.lokalniTag });
    if (klic.stanje === "zvoni") this.zavrniKlic(klic, 487, "Request Terminated", "preklic");
  }

  private bye(z: SipZahteva, r: RemoteInfo): void {
    const klic = this.najdiKlic(z);
    if (!klic || klic.stanje === "zvoni") return void this.odgovori(z, r, 481, "Call/Transaction Does Not Exist");
    const cseq = razcleniCSeq(prvaGlava(z, "cseq") ?? "");
    if (!cseq) return;
    this.odgovori(z, r, 200, "OK");
    // ACK lahko izostane (izgubljen); BYE dialog vseeno konca.
    this.ackBrezDialoga(klic.invite);
    this.koncaj(klic, "bye");
  }
}

/** Naslov lokalnega vmesnika, prek katerega sistem doseze cilj (UDP connect brez posiljanja). */
function izhodniNaslov(ip: string, vrata: number): Promise<string> {
  return new Promise((resolve) => {
    const s = createSocket({ type: isIP(ip) === 6 ? "udp6" : "udp4" });
    const koncaj = (n: string) => {
      try {
        s.close();
      } catch {
        // ze zaprto
      }
      resolve(n);
    };
    s.once("error", () => koncaj(isIP(ip) === 6 ? "::1" : "127.0.0.1"));
    s.connect(vrata, ip, () => koncaj(s.address().address));
  });
}
