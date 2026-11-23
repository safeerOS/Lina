/**
 * SIP-2: pot SIP od konca do konca samo na 127.0.0.1: lazni ponudnik SIP (node:dgram) in lazni klicatelj RTP v preizkusu,
 * pravi SipOdjemalec, RtpSeja, MostSip in LiveMost, lazni Gemini Live. Klic -> zvok v Live in nazaj, konec klica sprosti vse
 * (vticnice, casovniki, Live), omejitev dolzine, ponovna registracija po padcu, zaustavitev, strezniske funkcije nastavitev.
 * Izmisljena imena, stevilke in gesla; komentarji brez sumnikov.
 */
import { createSocket, type Socket } from "node:dgram";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setupOwner } from "../auth.server.ts";
import { t } from "../besedila.ts";
import { formaCatalog } from "../catalog.ts";
import type { LiveSeja, LiveSporocilo, NastavitveMosta, OdvisnostiMosta, ZapisnikLive } from "../live/most.ts";
import { pcmVMulaw } from "../live/zvok.ts";
import { sprostiAktivniKlic, zasediAktivniKlic } from "../voice.server.ts";
import { ulawVLinear } from "./g711.ts";
import type { OdvisnostiMostaSip } from "./most-sip.server.ts";
import { SipOdjemalec, type SipKonfiguracija } from "./odjemalec.server.ts";
import { razcleniRtp, sestaviRtp } from "./rtp.ts";
import {
  pozabiNastavitveSip,
  pravaOdvisnostSluzbe,
  preberiNastavitveSip,
  shraniNastavitveSip,
  SipSluzba,
  sluzbaSip,
  sprejemKlicaSip,
  stanjeRegistracijeSip,
  type OdvisnostiSluzbe,
  type Sprejem,
} from "./sluzba-sip.server.ts";
import { parametri, prvaGlava, razcleniSip, type SipSporocilo, type SipZahteva } from "./sporocilo.ts";

const IP = "127.0.0.1";
const GESLO = "izmisljeno-geslo-sip2";
const CRLF = "\r\n";
const CASOVNIKI = { t1: 20, t2: 160, zamikZacetni: 100, zamikNajvecji: 400 };

const pocakaj = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function cakajDo(pogoj: () => boolean, ms = 5000, opis = "pogoj"): Promise<void> {
  const rok = Date.now() + ms;
  while (!pogoj()) {
    if (Date.now() > rok) throw new Error(`cakanje poteklo: ${opis}`);
    await pocakaj(10);
  }
}
const udp = () => process.getActiveResourcesInfo().filter((r) => r === "UDPWrap").length;

function sinus(frekvenca: number, hz: number, vzorcev: number, amplituda = 8000): Int16Array {
  const ven = new Int16Array(vzorcev);
  for (let i = 0; i < vzorcev; i++) ven[i] = Math.round(amplituda * Math.sin((2 * Math.PI * hz * i) / frekvenca));
  return ven;
}
const rms = (pcm: ArrayLike<number>) => {
  let v = 0;
  for (let i = 0; i < pcm.length; i++) v += (pcm[i] as number) ** 2;
  return Math.sqrt(v / Math.max(1, pcm.length));
};

const zapri: (() => unknown)[] = [];
afterEach(async () => {
  for (const z of zapri.splice(0).reverse()) await z();
});

// ------------------------------------------------------------------------------------------ lazni ponudnik SIP

type Prejeto = { s: SipSporocilo; vrata: number };

function odgovor(z: SipZahteva, status: number, razlog: string, glave: string[] = []): string {
  const kopija = z.glave.filter((g) => ["via", "from", "to", "call-id", "cseq"].includes(g.ime)).map((g) => `${g.ime}: ${g.vrednost}`);
  return [`SIP/2.0 ${status} ${razlog}`, ...kopija, ...glave, "Content-Length: 0"].join(CRLF) + CRLF + CRLF;
}

class LazniPonudnik {
  readonly prejeto: Prejeto[] = [];
  odgovarjaj = true;
  odjemalecVrata = 0;
  private constructor(readonly socket: Socket) {
    socket.on("message", (b, r) => {
      const izid = razcleniSip(b);
      if (!izid.ok) return;
      const s = izid.vrednost;
      this.prejeto.push({ s, vrata: r.port });
      if (s.vrsta !== "zahteva") return;
      if (s.metoda === "REGISTER") {
        if (!this.odgovarjaj) return;
        this.odjemalecVrata = r.port;
        const expires = prvaGlava(s, "expires") ?? "60";
        this.poslji(odgovor(s, 200, "OK", expires === "0" ? [] : [`Contact: ${prvaGlava(s, "contact")};expires=${expires}`]), r.port);
      } else if (s.metoda === "BYE") this.poslji(odgovor(s, 200, "OK"), r.port);
    });
  }
  static async odpri(): Promise<LazniPonudnik> {
    const s = createSocket("udp4");
    await new Promise<void>((r) => s.bind(0, IP, r));
    const p = new LazniPonudnik(s);
    zapri.push(() => p.socket.close());
    return p;
  }
  get vrata(): number {
    return this.socket.address().port;
  }
  poslji(b: string, vrata = this.odjemalecVrata): void {
    this.socket.send(Buffer.from(b), vrata, IP);
  }
  zahteve(metoda: string): SipZahteva[] {
    return this.prejeto.flatMap((p) => (p.s.vrsta === "zahteva" && p.s.metoda === metoda ? [p.s] : []));
  }
  registracijeIz(): number[] {
    return this.prejeto.flatMap((p) => (p.s.vrsta === "zahteva" && p.s.metoda === "REGISTER" && prvaGlava(p.s, "expires") !== "0" ? [p.vrata] : []));
  }
}

let stevec = 0;
type Klic = { callId: string; tag: string; branch: string; toTag: string; linaRtp: number };

/** Ponudnik poslje INVITE (ponudba PCMU + telephone-event) in na 200 OK odgovori z ACK. */
async function poklici(p: LazniPonudnik, rtpVrata: number, cakajNa200 = true): Promise<Klic> {
  stevec += 1;
  const callId = `sip2-${stevec}@${IP}`;
  const tag = `klicatelj${stevec}`;
  const branch = `z9hG4bKsip2inv${stevec}`;
  const telo = ["v=0", `o=- 1 1 IN IP4 ${IP}`, "s=-", `c=IN IP4 ${IP}`, "t=0 0", `m=audio ${rtpVrata} RTP/AVP 0 101`, "a=rtpmap:0 PCMU/8000", "a=rtpmap:101 telephone-event/8000", "a=ptime:20", ""].join(CRLF);
  p.poslji(
    [
      `INVITE sip:lina@${IP}:${p.odjemalecVrata} SIP/2.0`,
      `Via: SIP/2.0/UDP ${IP}:${p.vrata};branch=${branch}`,
      "Max-Forwards: 70",
      `From: <sip:+38640000002@example.invalid>;tag=${tag}`,
      "To: <sip:lina@example.invalid>",
      `Call-ID: ${callId}`,
      "CSeq: 1 INVITE",
      `Contact: <sip:+38640000002@${IP}:${p.vrata}>`,
      "Content-Type: application/sdp",
      `Content-Length: ${Buffer.byteLength(telo)}`,
    ].join(CRLF) + CRLF + CRLF + telo,
  );
  if (!cakajNa200) return { callId, tag, branch, toTag: "", linaRtp: 0 };
  let ok: SipSporocilo | undefined;
  await cakajDo(() => {
    ok = p.prejeto.find((x) => x.s.vrsta === "odgovor" && x.s.status === 200 && prvaGlava(x.s, "call-id") === callId)?.s;
    return Boolean(ok);
  }, 5000, "200 OK na INVITE");
  const s = ok as SipSporocilo;
  const toTag = parametri(prvaGlava(s, "to") ?? "").get("tag") ?? "";
  const linaRtp = Number(/m=audio (\d+)/.exec(s.telo)?.[1] ?? 0);
  p.poslji(
    [
      `ACK sip:lina@${IP}:${p.odjemalecVrata} SIP/2.0`,
      `Via: SIP/2.0/UDP ${IP}:${p.vrata};branch=${branch}ack`,
      "Max-Forwards: 70",
      `From: <sip:+38640000002@example.invalid>;tag=${tag}`,
      `To: <sip:lina@example.invalid>;tag=${toTag}`,
      `Call-ID: ${callId}`,
      "CSeq: 1 ACK",
      "Content-Length: 0",
    ].join(CRLF) + CRLF + CRLF,
  );
  return { callId, tag, branch, toTag, linaRtp };
}

function bye(p: LazniPonudnik, k: Klic): void {
  p.poslji(
    [
      `BYE sip:lina@${IP}:${p.odjemalecVrata} SIP/2.0`,
      `Via: SIP/2.0/UDP ${IP}:${p.vrata};branch=z9hG4bKsip2bye${stevec}`,
      "Max-Forwards: 70",
      `From: <sip:+38640000002@example.invalid>;tag=${k.tag}`,
      `To: <sip:lina@example.invalid>;tag=${k.toTag}`,
      `Call-ID: ${k.callId}`,
      "CSeq: 2 BYE",
      "Content-Length: 0",
    ].join(CRLF) + CRLF + CRLF,
  );
}

// ------------------------------------------------------------------------------------------ lazni klicatelj RTP

class Klicatelj {
  readonly glasnost: number[] = [];
  private zaporedna = 1;
  private constructor(readonly socket: Socket) {
    socket.on("message", (b) => {
      const izid = razcleniRtp(b);
      if (!izid.ok || izid.vrednost.tip !== 0) return;
      this.glasnost.push(rms(Array.from(izid.vrednost.koristno, ulawVLinear)));
    });
  }
  static async odpri(): Promise<Klicatelj> {
    const s = createSocket("udp4");
    await new Promise<void>((r) => s.bind(0, IP, r));
    const k = new Klicatelj(s);
    zapri.push(() => {
      try {
        k.socket.close();
      } catch {
        /* ze zaprto */
      }
    });
    return k;
  }
  get vrata(): number {
    return this.socket.address().port;
  }
  glasnih(od = 0): number {
    return this.glasnost.slice(od).filter((g) => g > 1000).length;
  }
  /** n paketov po 20 ms tona 440 Hz (PCMU). */
  govori(vrata: number, n: number): void {
    const mulaw = pcmVMulaw(sinus(8000, 440, 160));
    for (let i = 0; i < n; i++) {
      this.socket.send(sestaviRtp({ oznaka: i === 0, tip: 0, zaporedna: this.zaporedna, casovniZig: this.zaporedna * 160, ssrc: 0x1234, koristno: mulaw }), vrata, IP);
      this.zaporedna += 1;
    }
  }
}

// ------------------------------------------------------------------------------------------ lazni Live in odvisnosti

function laznLive() {
  const poslano: Record<string, unknown>[] = [];
  let naSporocilo: ((m: LiveSporocilo) => void) | null = null;
  let zaprtih = 0;
  let odprtij = 0;
  const seja: LiveSeja = { poslji: (m) => void poslano.push(m as Record<string, unknown>), zapri: () => void (zaprtih += 1) };
  return {
    poslano,
    get zaprtih() {
      return zaprtih;
    },
    get odprtij() {
      return odprtij;
    },
    odpriLive: (async (p: { onSporocilo(m: LiveSporocilo): void }) => {
      odprtij += 1;
      naSporocilo = p.onSporocilo;
      return seja;
    }) as OdvisnostiMosta["odpriLive"],
    emit: (m: LiveSporocilo) => naSporocilo?.(m),
    zvokVhoda: () =>
      poslano.flatMap((m) => {
        const a = (m.realtimeInput as { audio?: { data: string } } | undefined)?.audio;
        return a ? [new Int16Array(new Uint8Array(Buffer.from(a.data, "base64")).buffer)] : [];
      }),
  };
}

function zvokLive(ms: number): LiveSporocilo {
  const pcm = sinus(24000, 440, (24000 * ms) / 1000);
  return { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: Buffer.from(pcm.buffer).toString("base64") } }] } } };
}

type Dogodek = [string, ...unknown[]];

function okolje(moznosti: { najdaljsiMinut?: number | null; ura?: { zdaj: number }; sprejem?: (sid: string) => Promise<Sprejem>; konfiguracija?: () => Promise<SipKonfiguracija | null>; najvecNeuspehov?: number } = {}) {
  const live = laznLive();
  const dogodki: Dogodek[] = [];
  const sproscene: string[] = [];
  const nastavitve: NastavitveMosta = {
    setup: { setup: { model: "test" } },
    katalog: { ...formaCatalog(), znanje: "Izdelujemo pohistvo po meri." },
    pozdrav: "Pozdravljeni, tukaj Lina, asistentka z umetno inteligenco.",
    temaOdgovor: t("temaPrivzeto"),
    oprostilo: t("oprostiteSlovo"),
    najdaljsiMinut: moznosti.najdaljsiMinut ?? null,
  };
  const zapisnik: ZapisnikLive = {
    zacni: async (v) => void dogodki.push(["zacni", v.callSid, v.from]),
    izrek: async () => undefined,
    odgovor: async (sid, b) => void dogodki.push(["odgovor", sid, b]),
    vrzel: async () => undefined,
    cas: async (sid, faza) => {
      dogodki.push(["cas", sid, faza]);
      return { besedilo: faza === "opozorilo" ? "Cas se izteka." : "Nasvidenje.", konec: faza === "potek" };
    },
    povprasevanje: async () => ({ sprejeto: [], zavrnjeno: [] }),
    zakljuci: async (sid) => void dogodki.push(["zakljuci", sid]),
  };
  const odvMosta: OdvisnostiMostaSip = {
    nalozi: async () => nastavitve,
    odpriLive: live.odpriLive,
    zapisnik,
    zasedenost: { osvezi: () => undefined, sprosti: (s) => void sproscene.push(s) },
    posnetek: async () => pcmVMulaw(sinus(8000, 1000, 1600)), // 200 ms tona
    ura: moznosti.ura ? () => (moznosti.ura as { zdaj: number }).zdaj : undefined,
    tikMs: 5,
  };
  return { live, dogodki, sproscene, odvMosta };
}

async function sluzba(p: LazniPonudnik, o: ReturnType<typeof okolje>, dodatno: Partial<OdvisnostiSluzbe> = {}, konfig: Partial<SipKonfiguracija> = {}): Promise<SipSluzba> {
  const s = new SipSluzba({
    konfiguracija: async () => ({ registrar: IP, vrata: p.vrata, domena: "example.invalid", uporabnik: "lina", geslo: GESLO, lokalniNaslov: IP, expires: 60, casovniki: CASOVNIKI, ...konfig }),
    sprejem: async () => ({ ok: true }),
    odvisnostiMosta: () => o.odvMosta,
    sprosti: (sid) => void o.sproscene.push(sid),
    zamik: { zacetni: 100, najvecji: 400 },
    ...dodatno,
  });
  zapri.push(() => s.ustavi());
  await s.uskladi();
  await cakajDo(() => s.stanje.stanje === "registriran", 5000, "registracija");
  return s;
}

// ------------------------------------------------------------------------------------------ preizkusi

describe("SIP-2 pot SIP na 127.0.0.1", () => {
  it("klic -> pozdrav (razkritje UI) v klic, zvok klicatelja v Live, odgovor Live nazaj v RTP", async () => {
    const p = await LazniPonudnik.odpri();
    const o = okolje();
    const s = await sluzba(p, o);
    const kl = await Klicatelj.odpri();
    const k = await poklici(p, kl.vrata);
    expect(k.linaRtp).toBeGreaterThan(0);
    // pozdrav (stalni posnetek) pride prvi, preden Live sploh odgovori
    await cakajDo(() => kl.glasnih() >= 5, 3000, "pozdrav v RTP");
    await cakajDo(() => o.live.odprtij === 1, 3000, "Live odprt");
    expect(s.stanje.klicTece).toBe(true);
    const zacni = o.dogodki.find((d) => d[0] === "zacni");
    expect(zacni?.[2]).toBe("+38640000002");
    expect(String(zacni?.[1])).toMatch(/^SIP/);
    o.live.emit({ setupComplete: {} });
    await pocakaj(300);
    kl.govori(k.linaRtp, 15);
    await cakajDo(() => o.live.zvokVhoda().filter((pcm) => rms(pcm) > 1000).length >= 5, 3000, "zvok v Live");
    const prej = kl.glasnost.length;
    o.live.emit(zvokLive(500));
    await cakajDo(() => kl.glasnih(prej) >= 15, 3000, "odgovor Live v RTP");
  }, 20_000);

  it("klicatelj odlozi (BYE): vticnica RTP zaprta, casovniki, Live seja, zapis in linija sprosceni", async () => {
    const p = await LazniPonudnik.odpri();
    const o = okolje();
    const s = await sluzba(p, o);
    const kl = await Klicatelj.odpri();
    const udpPred = udp();
    const k = await poklici(p, kl.vrata);
    await cakajDo(() => o.live.odprtij === 1, 3000, "Live odprt");
    o.live.emit({ setupComplete: {} });
    expect(udp()).toBe(udpPred + 1); // vticnica RTP klica
    bye(p, k);
    await cakajDo(() => s.steviloKlicev === 0, 3000, "konec klica");
    await cakajDo(() => o.dogodki.some((d) => d[0] === "zakljuci"), 3000, "zapis zakljucen");
    expect(p.prejeto.some((x) => x.s.vrsta === "odgovor" && x.s.status === 200 && prvaGlava(x.s, "cseq") === "2 BYE")).toBe(true);
    expect(o.live.zaprtih).toBeGreaterThanOrEqual(1);
    expect(o.sproscene.length).toBeGreaterThanOrEqual(1);
    expect(new Set(o.sproscene).size).toBe(1);
    expect(udp()).toBe(udpPred);
    expect(s.stanje.klicTece).toBe(false);
    // RTP po koncu ne gre nikamor vec
    const vLive = o.live.poslano.length;
    kl.govori(k.linaRtp, 5);
    await pocakaj(100);
    expect(o.live.poslano.length).toBe(vLive);
    // odjemalec ostane registriran za naslednji klic
    expect(s.stanje.stanje).toBe("registriran");
  }, 20_000);

  it("omejitev dolzine: ob izteku slovo in BYE od Line; zapis zakljucen, vticnica RTP zaprta", async () => {
    const ura = { zdaj: 1_800_000_000_000 };
    const p = await LazniPonudnik.odpri();
    const o = okolje({ najdaljsiMinut: 1, ura });
    const s = await sluzba(p, o);
    const kl = await Klicatelj.odpri();
    const udpPred = udp();
    await poklici(p, kl.vrata);
    await cakajDo(() => o.live.odprtij === 1, 3000, "Live odprt");
    o.live.emit({ setupComplete: {} });
    ura.zdaj += 31_000;
    await cakajDo(() => o.dogodki.some((d) => d[0] === "cas" && d[2] === "opozorilo"), 3000, "opozorilo");
    expect(p.zahteve("BYE")).toHaveLength(0);
    ura.zdaj += 35_000;
    await cakajDo(() => p.zahteve("BYE").length === 1, 5000, "BYE od Line");
    await cakajDo(() => s.steviloKlicev === 0 && o.dogodki.some((d) => d[0] === "zakljuci"), 3000, "konec");
    expect(o.dogodki.filter((d) => d[0] === "cas").map((d) => d[2])).toEqual(["opozorilo", "potek"]);
    expect(udp()).toBe(udpPred);
  }, 20_000);

  it("ponovna registracija: registrar utihne -> napaka, odjemalec se zazene na novo in se spet registrira", async () => {
    const p = await LazniPonudnik.odpri();
    const o = okolje();
    const s = await sluzba(p, o, { najvecNeuspehov: 1 }, { expires: 2 });
    const udpPred = udp();
    expect(s.zagonov).toBe(1);
    const prvaVrata = p.registracijeIz()[0];
    p.odgovarjaj = false;
    await cakajDo(() => s.stanje.stanje === "ponovno", 5000, "napaka registracije");
    expect(s.stanje.razlog).not.toContain(GESLO);
    p.odgovarjaj = true;
    await cakajDo(() => s.stanje.stanje === "registriran" && s.zagonov >= 2, 6000, "spet registriran");
    // nov odjemalec (nova vrata), stara vticnica zaprta: ni vec vticnic kot prej
    expect(p.registracijeIz().at(-1)).not.toBe(prvaVrata);
    expect(udp()).toBe(udpPred);
    // nov klic po ponovni registraciji deluje
    const kl = await Klicatelj.odpri();
    await poklici(p, kl.vrata);
    await cakajDo(() => o.live.odprtij === 1, 3000, "Live odprt");
  }, 25_000);

  it("zagon ne uspe (vrata zasedena): nov poskus z zamikom, nato registracija", async () => {
    const p = await LazniPonudnik.odpri();
    const o = okolje();
    const zasedena = createSocket("udp4");
    await new Promise<void>((r) => zasedena.bind(0, IP, r));
    const vrata = zasedena.address().port;
    let zaprta = false;
    zapri.push(() => !zaprta && zasedena.close());
    const s = new SipSluzba({
      konfiguracija: async () => ({ registrar: IP, vrata: p.vrata, domena: "example.invalid", uporabnik: "lina", geslo: GESLO, lokalniNaslov: IP, lokalnaVrata: vrata, expires: 60, casovniki: CASOVNIKI }),
      sprejem: async () => ({ ok: true }),
      odvisnostiMosta: () => o.odvMosta,
      sprosti: () => undefined,
      zamik: { zacetni: 150, najvecji: 400 },
    });
    zapri.push(() => s.ustavi());
    await s.uskladi();
    expect(s.stanje.stanje).toBe("ponovno");
    expect(s.stanje.razlog).toMatch(/^zagon/);
    expect(s.stanje.poskusCez).toBe(150);
    zasedena.close();
    zaprta = true;
    await cakajDo(() => s.stanje.stanje === "registriran", 5000, "registracija po ponovnem zagonu");
    expect(s.zagonov).toBeGreaterThanOrEqual(2);
  }, 15_000);

  it("zaustavitev streznika med klicem (globalThis, kot scripts/start.mjs): BYE, odjava Expires: 0, brez visecih vticnic", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lina-sip2-"));
    zapri.push(() => rm(dir, { recursive: true, force: true }));
    const p = await LazniPonudnik.odpri();
    const o = okolje();
    const udpPred = udp();
    const s = sluzbaSip(dir, () => ({
      konfiguracija: async () => ({ registrar: IP, vrata: p.vrata, domena: "example.invalid", uporabnik: "lina", geslo: GESLO, lokalniNaslov: IP, expires: 60, casovniki: CASOVNIKI }),
      sprejem: async () => ({ ok: true }),
      odvisnostiMosta: () => o.odvMosta,
      sprosti: (sid) => void o.sproscene.push(sid),
    }));
    await s.uskladi();
    await cakajDo(() => s.stanje.stanje === "registriran", 5000, "registracija");
    const kl = await Klicatelj.odpri();
    await poklici(p, kl.vrata);
    await cakajDo(() => o.live.odprtij === 1, 3000, "Live odprt");
    const ustavi = (globalThis as Record<symbol, unknown>)[Symbol.for("lina.sip.ustavi")] as () => Promise<void>;
    expect(typeof ustavi).toBe("function");
    await ustavi();
    expect(p.zahteve("BYE")).toHaveLength(1);
    expect(p.zahteve("REGISTER").some((z) => prvaGlava(z, "expires") === "0")).toBe(true);
    await cakajDo(() => o.dogodki.some((d) => d[0] === "zakljuci"), 3000, "zapis zakljucen");
    expect(o.live.zaprtih).toBeGreaterThanOrEqual(1);
    expect(s.stanje.stanje).toBe("izklopljen");
    expect(s.steviloKlicev).toBe(0);
    // zapiranje vticnice je asinhrono (dgram close): pocakamo najvec 1 s; ostane samo vticnica laznega klicatelja v preizkusu
    await cakajDo(() => udp() === udpPred + 1, 1000, `vticnice ${udp()} != ${udpPred + 1}`);
  }, 20_000);

  it("sprejem ne dovoli (npr. zasedeno): klic dobi 486 brez seje Live; drugi klic med klicem tudi 486", async () => {
    const p = await LazniPonudnik.odpri();
    const o = okolje();
    let dovoli = false;
    await sluzba(p, o, { sprejem: async () => (dovoli ? { ok: true } : { ok: false, status: 486, razlog: "Busy Here" }) });
    const kl = await Klicatelj.odpri();
    const k1 = await poklici(p, kl.vrata, false);
    await cakajDo(() => p.prejeto.some((x) => x.s.vrsta === "odgovor" && x.s.status === 486 && prvaGlava(x.s, "call-id") === k1.callId), 3000, "486");
    expect(o.live.odprtij).toBe(0);
    dovoli = true;
    await poklici(p, kl.vrata);
    await cakajDo(() => o.live.odprtij === 1, 3000, "Live odprt");
  }, 15_000);

  it("SIP3-1: zavrnjen datagram (ponarejen odgovor ali tuj vir) se zabelezi v stevec in dnevnik brez osebnih podatkov", async () => {
    const p = await LazniPonudnik.odpri();
    const o = okolje();
    const dnevnikZapis: string[] = [];
    const s = await sluzba(p, o, { dnevnik: (koda) => void dnevnikZapis.push(koda) });
    const tuj = createSocket("udp4");
    await new Promise<void>((r) => tuj.bind(0, IP, r));
    zapri.push(() => tuj.close());
    // Ponarejen odgovor brez transakcije
    tuj.send(
      Buffer.from(
        [
          "SIP/2.0 200 OK",
          `Via: SIP/2.0/UDP ${IP}:${p.odjemalecVrata};branch=z9hG4bKponarejen`,
          "From: <sip:+38640999888@example.invalid>;tag=x",
          "To: <sip:lina@example.invalid>;tag=y",
          "Call-ID: ponarejen-1",
          "CSeq: 1 REGISTER",
          "Content-Length: 0",
          "",
          "",
        ].join(CRLF),
      ),
      p.odjemalecVrata,
      IP,
    );
    await cakajDo(() => (s.stanje.zavrnjenih ?? 0) >= 1, 2000, "zavrnjen datagram zabelezen");
    expect(s.zavrnjenih).toBeGreaterThanOrEqual(1);
    expect(dnevnikZapis).toContain("sip-zavrnjeno-odgovor-brez-transakcije");
    expect(dnevnikZapis.join(" ")).not.toContain("38640999888");
    expect(dnevnikZapis.join(" ")).not.toContain(GESLO);
  }, 10_000);
});

describe("SIP-2 sprejem in strezniske funkcije", () => {
  it("sprejem po pravilih poti Live: zaprta linija -> 480; zasedena linija -> drug klic ne dobi linije", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lina-sip2-"));
    zapri.push(() => rm(dir, { recursive: true, force: true }));
    expect(await sprejemKlicaSip(dir, "SIPpreizkus1")).toEqual({ ok: false, status: 480, razlog: "Temporarily Unavailable" });
    expect(await zasediAktivniKlic(dir, "SIPpreizkus1")).toBe(true);
    expect(await zasediAktivniKlic(dir, "SIPpreizkus2")).toBe(false);
    sprostiAktivniKlic(dir, "SIPpreizkus1");
    expect(await zasediAktivniKlic(dir, "SIPpreizkus2")).toBe(true);
    sprostiAktivniKlic(dir, "SIPpreizkus2");
  });

  it("preberi / shrani / stanje / pozabi: samo lastnik, geslo nikoli v odgovoru; shrani zazene odjemalca, pozabi ga ustavi", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lina-sip2-"));
    zapri.push(() => rm(dir, { recursive: true, force: true }));
    const token = await setupOwner("geslo-test-1234", dir, { address: "127.0.0.1" });
    const p = await LazniPonudnik.odpri();
    // prave odvisnosti; preizkus samo veze odjemalca na 127.0.0.1 in skrajsa casovnike
    const s = sluzbaSip(dir, (root) => ({ ...pravaOdvisnostSluzbe(root), odjemalec: (k) => new SipOdjemalec({ ...k, lokalniNaslov: IP, casovniki: CASOVNIKI }) }));
    zapri.push(() => s.ustavi());
    await expect(shraniNastavitveSip(null, { registrar: IP, vrata: p.vrata, uporabnik: "lina", geslo: GESLO }, dir)).rejects.toThrow();
    await expect(stanjeRegistracijeSip("napacen", dir)).rejects.toThrow();
    await expect(preberiNastavitveSip(null, dir)).rejects.toThrow();
    expect((await stanjeRegistracijeSip(token, dir)).stanje).toBe("izklopljen");
    const javno = await shraniNastavitveSip(token, { registrar: IP, vrata: p.vrata, domena: "example.invalid", uporabnik: "lina", geslo: GESLO, expires: 60 }, dir);
    expect(javno).toMatchObject({ nastavljen: true, imaGeslo: true, registrar: IP, vrata: p.vrata });
    expect(JSON.stringify(javno)).not.toContain(GESLO);
    await cakajDo(() => s.stanje.stanje === "registriran", 5000, "registracija");
    const stanje = await stanjeRegistracijeSip(token, dir);
    expect(stanje).toMatchObject({ stanje: "registriran", expires: 60, klicTece: false });
    expect(JSON.stringify(stanje)).not.toContain(GESLO);
    const prebrano = await preberiNastavitveSip(token, dir);
    expect(prebrano.imaGeslo).toBe(true);
    expect(JSON.stringify(prebrano)).not.toContain(GESLO);
    expect(p.zahteve("REGISTER").length).toBeGreaterThanOrEqual(1);
    const udpPred = udp();
    const pozabljeno = await pozabiNastavitveSip(token, dir);
    expect(pozabljeno).toMatchObject({ nastavljen: false, imaGeslo: false });
    expect((await stanjeRegistracijeSip(token, dir)).stanje).toBe("izklopljen");
    expect(p.zahteve("REGISTER").some((z) => prvaGlava(z, "expires") === "0")).toBe(true);
    expect(udp()).toBe(udpPred - 1);
  }, 20_000);
});
