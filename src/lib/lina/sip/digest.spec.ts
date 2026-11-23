/**
 * SIP-1: integracija samo na 127.0.0.1 z lastnim laznim streznikom SIP (node:dgram) v preizkusu.
 * REGISTER (401 -> digest -> 200, obnova, 407, 423, narascajoc zamik), INVITE (100/180/200 + SDP, ACK), RTP v obe smeri,
 * DTMF, BYE, CANCEL, OPTIONS, nepravilna sporocila, omejitve (hitrost, vir, dialogi, tuj RTP, SSRC).
 */
import { createHash } from "node:crypto";
import { createSocket, type Socket } from "node:dgram";
import { inspect } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { razcleniParametre } from "./digest.ts";
import { paketiDtmf, razcleniDtmf } from "./dtmf.ts";
import { alawVLinear, linearVAlaw } from "./g711.ts";
import { stevilkaKlicatelja } from "./most-sip.server.ts";
import { SipOdjemalec, type DohodniKlic, type SipKonfiguracija } from "./odjemalec.server.ts";
import { razcleniRtp, sestaviRtp, type RtpPaket } from "./rtp.ts";
import { dogovoriSe, razcleniSdp } from "./sdp.ts";
import { parametri, prvaGlava, razcleniSip, vseVrednosti, type SipOdgovor, type SipSporocilo, type SipZahteva } from "./sporocilo.ts";

const IP = "127.0.0.1";
const GESLO = "izmisljeno-geslo-preizkusa";
const CRLF = "\r\n";

type Prejeto = { s: SipSporocilo; vrata: number; cas: number };

class Vticnica {
  readonly socket: Socket;
  readonly prejeto: Prejeto[] = [];
  readonly surovo: { b: Buffer; vrata: number; cas: number }[] = [];
  private cakajoci: (() => void)[] = [];

  private constructor(s: Socket) {
    this.socket = s;
    s.on("message", (b, r) => {
      this.surovo.push({ b, vrata: r.port, cas: performance.now() });
      const izid = razcleniSip(b);
      if (izid.ok) this.prejeto.push({ s: izid.vrednost, vrata: r.port, cas: performance.now() });
      for (const c of this.cakajoci.splice(0)) c();
    });
  }

  static async odpri(): Promise<Vticnica> {
    const s = createSocket("udp4");
    await new Promise<void>((r) => s.bind(0, IP, r));
    return new Vticnica(s);
  }

  get vrata(): number {
    return this.socket.address().port;
  }

  poslji(b: Buffer | string, vrata: number): void {
    this.socket.send(typeof b === "string" ? Buffer.from(b) : b, vrata, IP);
  }

  /** Caka na sporocilo, ki ustreza pogoju in se ni bilo vzeto (od indeksa od). */
  async caka<T>(pogoj: (p: Prejeto) => T | null | false | undefined, rok = 4000, seznam: () => Prejeto[] = () => this.prejeto): Promise<T> {
    const konec = performance.now() + rok;
    for (;;) {
      for (const p of seznam()) {
        const r = pogoj(p);
        if (r) return r;
      }
      if (performance.now() > konec) throw new Error("ni pricakovanega sporocila");
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 50);
        this.cakajoci.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }

  zapri(): void {
    this.socket.close();
  }
}

const odprto: { zapri: () => void | Promise<void> }[] = [];
afterEach(async () => {
  for (const o of odprto.splice(0).reverse()) await o.zapri();
});

async function vticnica(): Promise<Vticnica> {
  const v = await Vticnica.odpri();
  odprto.push(v);
  return v;
}

async function odjemalec(streznik: Vticnica, dodatno: Partial<SipKonfiguracija> = {}): Promise<SipOdjemalec> {
  const o = new SipOdjemalec({
    registrar: IP,
    vrata: streznik.vrata,
    domena: "example.invalid",
    uporabnik: "lina",
    geslo: GESLO,
    lokalniNaslov: IP,
    expires: 2,
    casovniki: { t1: 20, t2: 160, zamikZacetni: 100, zamikNajvecji: 2000 },
    ...dodatno,
  });
  await o.zazeni();
  odprto.push({ zapri: () => o.ustavi() });
  return o;
}

function jeZahteva(p: Prejeto, metoda: string): SipZahteva | null {
  return p.s.vrsta === "zahteva" && p.s.metoda === metoda ? p.s : null;
}

function odgovor(z: SipZahteva, status: number, razlog: string, glave: string[] = []): string {
  const kopija = z.glave.filter((g) => ["via", "from", "to", "call-id", "cseq"].includes(g.ime)).map((g) => `${g.ime}: ${g.vrednost}`);
  return [`SIP/2.0 ${status} ${razlog}`, ...kopija, ...glave, "Content-Length: 0"].join(CRLF) + CRLF + CRLF;
}

function h(alg: "md5" | "sha256", s: string): string {
  return createHash(alg).update(s).digest("hex");
}

/** Neodvisen izracun (ne uporablja digest.ts). */
function pricakovanOdgovor(alg: "md5" | "sha256", p: Map<string, string>, metoda: string, geslo: string): string {
  const ha1 = h(alg, `${p.get("username")}:${p.get("realm")}:${geslo}`);
  const ha2 = h(alg, `${metoda}:${p.get("uri")}`);
  return h(alg, `${ha1}:${p.get("nonce")}:${p.get("nc")}:${p.get("cnonce")}:auth:${ha2}`);
}

function ponudbaSdp(rtpVrata: number): string {
  return ["v=0", `o=- 1 1 IN IP4 ${IP}`, "s=-", `c=IN IP4 ${IP}`, "t=0 0", `m=audio ${rtpVrata} RTP/AVP 8 0 101`, "a=rtpmap:8 PCMA/8000", "a=rtpmap:0 PCMU/8000", "a=rtpmap:101 telephone-event/8000", "a=fmtp:101 0-16", "a=ptime:20", ""].join(CRLF);
}

let stevec = 0;
function invite(streznik: Vticnica, cilj: number, rtpVrata: number, callId = `klic-${++stevec}@${IP}`, branch = `z9hG4bKinv${stevec}`): { besedilo: string; callId: string; branch: string } {
  const telo = ponudbaSdp(rtpVrata);
  const besedilo =
    [
      `INVITE sip:lina@${IP}:${cilj} SIP/2.0`,
      `Via: SIP/2.0/UDP ${IP}:${streznik.vrata};branch=${branch}`,
      "Max-Forwards: 70",
      `From: <sip:100@example.invalid>;tag=klicatelj${stevec}`,
      "To: <sip:lina@example.invalid>",
      `Call-ID: ${callId}`,
      "CSeq: 1 INVITE",
      `Contact: <sip:100@${IP}:${streznik.vrata}>`,
      "Content-Type: application/sdp",
      `Content-Length: ${Buffer.byteLength(telo)}`,
    ].join(CRLF) +
    CRLF +
    CRLF +
    telo;
  return { besedilo, callId, branch };
}

function vDialogu(metoda: "ACK" | "BYE" | "CANCEL", streznik: Vticnica, cilj: number, inv: { callId: string; branch: string }, toTag: string | null, cseq: number): string {
  const branch = metoda === "BYE" ? `z9hG4bKbye${stevec}` : inv.branch;
  return (
    [
      `${metoda} sip:lina@${IP}:${cilj} SIP/2.0`,
      `Via: SIP/2.0/UDP ${IP}:${streznik.vrata};branch=${branch}`,
      "Max-Forwards: 70",
      `From: <sip:100@example.invalid>;tag=klicatelj${inv.callId.split("@")[0]?.split("-")[1]}`,
      `To: <sip:lina@example.invalid>${toTag ? `;tag=${toTag}` : ""}`,
      `Call-ID: ${inv.callId}`,
      `CSeq: ${cseq} ${metoda}`,
      "Content-Length: 0",
    ].join(CRLF) +
    CRLF +
    CRLF
  );
}

function cseqOf(s: SipSporocilo): string {
  return prvaGlava(s, "cseq") ?? "";
}

describe("SIP-1 integracija na 127.0.0.1", () => {
  it("REGISTER: 401 -> digest SHA-256 -> 200, nato samodejna obnova pred iztekom (z istim Call-ID)", async () => {
    const reg = await vticnica();
    const nonce = "nonce-preizkus-1";
    reg.socket.on("message", (b, r) => {
      const izid = razcleniSip(b);
      if (!izid.ok || izid.vrednost.vrsta !== "zahteva" || izid.vrednost.metoda !== "REGISTER") return;
      const z = izid.vrednost;
      const avt = prvaGlava(z, "authorization");
      if (!avt) {
        reg.poslji(
          odgovor(z, 401, "Unauthorized", [
            `WWW-Authenticate: Digest realm="example.invalid", nonce="${nonce}", algorithm=MD5, qop="auth"`,
            `WWW-Authenticate: Digest realm="example.invalid", nonce="${nonce}", algorithm=SHA-256, qop="auth", opaque="op1"`,
          ]),
          r.port,
        );
        return;
      }
      const p = razcleniParametre(avt.replace(/^Digest\s+/, "")) ?? new Map<string, string>();
      const prav = p.get("algorithm") === "SHA-256" && p.get("opaque") === "op1" && p.get("response") === pricakovanOdgovor("sha256", p, "REGISTER", GESLO);
      reg.poslji(prav ? odgovor(z, 200, "OK", [`Contact: ${prvaGlava(z, "contact")};expires=2`]) : odgovor(z, 403, "Forbidden"), r.port);
    });
    const o = await odjemalec(reg);
    const registracije: number[] = [];
    o.on("registriran", (d) => registracije.push(d.expires));
    const napake: string[] = [];
    o.on("napakaRegistracije", (d) => napake.push(d.razlog));
    await reg.caka(() => registracije.length >= 2 || null, 4000);
    expect(registracije.slice(0, 2)).toEqual([2, 2]);
    expect(napake).toEqual([]);
    const regs = reg.prejeto.flatMap((p) => (jeZahteva(p, "REGISTER") ? [p] : []));
    const avtorizirani = regs.filter((p) => prvaGlava(p.s, "authorization"));
    expect(avtorizirani.length).toBeGreaterThanOrEqual(2);
    const ncs = avtorizirani.map((p) => razcleniParametre((prvaGlava(p.s, "authorization") ?? "").replace(/^Digest\s+/, ""))?.get("nc"));
    expect(ncs.slice(0, 2)).toEqual(["00000001", "00000002"]);
    expect(new Set(regs.map((p) => prvaGlava(p.s, "call-id"))).size).toBe(1);
    const cseqs = regs.map((p) => Number(cseqOf(p.s).split(" ")[0]));
    expect(cseqs).toEqual([...cseqs].sort((a, b) => a - b));
    // obnova po ~60 % veljavnosti (1,2 s), ne sele po izteku
    const prvi200 = avtorizirani[0] as Prejeto;
    const obnova = avtorizirani[1] as Prejeto;
    expect(obnova.cas - prvi200.cas).toBeGreaterThan(900);
    expect(obnova.cas - prvi200.cas).toBeLessThan(2000);
  }, 10_000);

  it("REGISTER: 423 Min-Expires poveca veljavnost, 407 -> Proxy-Authorization (MD5)", async () => {
    const reg = await vticnica();
    reg.socket.on("message", (b, r) => {
      const izid = razcleniSip(b);
      if (!izid.ok || izid.vrednost.vrsta !== "zahteva") return;
      const z = izid.vrednost;
      if (prvaGlava(z, "expires") === "2") return reg.poslji(odgovor(z, 423, "Interval Too Brief", ["Min-Expires: 120"]), r.port);
      const avt = prvaGlava(z, "proxy-authorization");
      if (!avt) return reg.poslji(odgovor(z, 407, "Proxy Authentication Required", ['Proxy-Authenticate: Digest realm="example.invalid", nonce="n407", qop="auth"']), r.port);
      const p = razcleniParametre(avt.replace(/^Digest\s+/, "")) ?? new Map<string, string>();
      const prav = p.get("response") === pricakovanOdgovor("md5", p, "REGISTER", GESLO);
      reg.poslji(prav ? odgovor(z, 200, "OK", ["Expires: 120"]) : odgovor(z, 403, "Forbidden"), r.port);
    });
    const o = await odjemalec(reg);
    const reg200 = await new Promise<number>((resolve) => o.once("registriran", (d) => resolve(d.expires)));
    expect(reg200).toBe(120);
    const expires = reg.prejeto.flatMap((p) => (jeZahteva(p, "REGISTER") ? [prvaGlava(p.s, "expires")] : []));
    expect(expires).toEqual(["2", "120", "120"]);
  }, 10_000);

  it("REGISTER: napacno geslo se ne ponavlja v nedogled; zamik po neuspehih narasca (100, 200, 400 ms)", async () => {
    const reg = await vticnica();
    reg.socket.on("message", (b, r) => {
      const izid = razcleniSip(b);
      if (!izid.ok || izid.vrednost.vrsta !== "zahteva") return;
      reg.poslji(odgovor(izid.vrednost, 401, "Unauthorized", ['WWW-Authenticate: Digest realm="example.invalid", nonce="vedno-isti", qop="auth"']), r.port);
    });
    const o = await odjemalec(reg);
    const napake: { razlog: string; poskusCez: number; cas: number }[] = [];
    o.on("napakaRegistracije", (d) => napake.push({ ...d, cas: performance.now() }));
    await reg.caka(() => napake.length >= 4 || null, 5000);
    expect(napake.slice(0, 4).map((n) => n.poskusCez)).toEqual([100, 200, 400, 800]);
    expect(napake[0]?.razlog).toContain("prijava zavrnjena");
    const razmiki = napake.slice(1, 4).map((n, i) => n.cas - (napake[i] as { cas: number }).cas);
    expect(razmiki[0]).toBeGreaterThanOrEqual(90);
    expect(razmiki[1]).toBeGreaterThan(razmiki[0] as number);
    expect(razmiki[2]).toBeGreaterThan(razmiki[1] as number);
    // en poskus = najvec dve zahtevi (brez in z avtorizacijo)
    const regs = reg.prejeto.filter((p) => jeZahteva(p, "REGISTER")).length;
    expect(regs).toBeLessThanOrEqual(2 * napake.length + 2);
  }, 10_000);

  it("REGISTER brez odgovora: ponovitve po T1 (UDP), nato casovna omejitev in nov poskus", async () => {
    const reg = await vticnica();
    const o = await odjemalec(reg);
    const napaka = await new Promise<string>((resolve) => o.once("napakaRegistracije", (d) => resolve(d.razlog)));
    expect(napaka).toBe("casovna omejitev");
    const regs = reg.prejeto.filter((p) => jeZahteva(p, "REGISTER"));
    const prviBranch = vseVrednosti(regs[0]?.s ?? { glave: [] }, "via")[0];
    expect(regs.filter((p) => vseVrednosti(p.s, "via")[0] === prviBranch).length).toBeGreaterThanOrEqual(5);
  }, 10_000);

  async function pripravljenKlic(dodatno: Partial<SipKonfiguracija> = {}) {
    const streznik = await vticnica();
    const rtp = await vticnica();
    streznik.socket.on("message", (b, r) => {
      const izid = razcleniSip(b);
      if (izid.ok && izid.vrednost.vrsta === "zahteva" && izid.vrednost.metoda === "REGISTER") streznik.poslji(odgovor(izid.vrednost, 200, "OK", ["Expires: 300"]), r.port);
    });
    const o = await odjemalec(streznik, { expires: 300, ...dodatno });
    const klici: DohodniKlic[] = [];
    o.on("klic", (k) => klici.push(k));
    return { streznik, rtp, o, klici, cilj: o.naslov.vrata };
  }

  function odgovorNaInvite(streznik: Vticnica, callId: string, status: number): Promise<SipOdgovor> {
    return streznik.caka((p) => (p.s.vrsta === "odgovor" && p.s.status === status && prvaGlava(p.s, "call-id") === callId && cseqOf(p.s).endsWith("INVITE") ? p.s : null));
  }

  it("INVITE -> 100, 180, 200 s SDP; ACK; RTP v obe smeri; DTMF v obe smeri; tuj vir in tuj SSRC zavrnjena; BYE", async () => {
    const { streznik, rtp, o, klici, cilj } = await pripravljenKlic();
    const inv = invite(streznik, cilj, rtp.vrata);
    streznik.poslji(inv.besedilo, cilj);
    await odgovorNaInvite(streznik, inv.callId, 100);
    const zvonjenje = await odgovorNaInvite(streznik, inv.callId, 180);
    const toTag = parametri(prvaGlava(zvonjenje, "to") ?? "").get("tag") ?? "";
    expect(toTag).not.toBe("");
    await streznik.caka(() => klici.length > 0 || null);
    const klic = klici[0] as DohodniKlic;
    expect(klic.klicatelj).toBe("100");
    expect(o.steviloKlicev).toBe(1);

    const zvok: Int16Array[] = [];
    const dtmf: string[] = [];
    let konec = "";
    klic.on("zvok", (p) => zvok.push(p));
    klic.on("dtmf", (z) => dtmf.push(z));
    klic.on("konec", (r) => (konec = r));
    await klic.sprejmi();
    const ok = await odgovorNaInvite(streznik, inv.callId, 200);
    expect(prvaGlava(ok, "content-type")).toBe("application/sdp");
    const odg = razcleniSdp(ok.telo);
    if (!odg.ok) throw new Error(odg.napaka);
    const dogovor = dogovoriSe(odg.vrednost);
    expect(dogovor.ok && dogovor.vrednost).toMatchObject({ kodek: "PCMA", tipKodeka: 8, tipDtmf: 101, naslov: IP });
    const linaRtp = odg.vrednost.vrata;
    streznik.poslji(vDialogu("ACK", streznik, cilj, inv, toTag, 1), cilj);

    // klicatelj -> Lina: 1 kHz v PCMA, 10 paketov po 20 ms
    const ssrc = 0x11223344;
    for (let i = 0; i < 10; i++) {
      const koristno = Uint8Array.from({ length: 160 }, (_v, n) => linearVAlaw(8000 * Math.sin((2 * Math.PI * 1000 * (i * 160 + n)) / 8000)));
      rtp.poslji(sestaviRtp({ oznaka: i === 0, tip: 8, zaporedna: 100 + i, casovniZig: 5000 + i * 160, ssrc, koristno }), linaRtp);
    }
    // DTMF "5" (7 paketov istega dogodka) -> en znak
    for (const [i, p] of paketiDtmf("5", 100).entries()) rtp.poslji(sestaviRtp({ oznaka: p.oznaka, tip: 101, zaporedna: 200 + i, casovniZig: 9000, ssrc, koristno: p.koristno }), linaRtp);
    // tuj vir (druga vrata) in tuj SSRC se zavrzeta
    const tuj = await vticnica();
    tuj.poslji(sestaviRtp({ oznaka: false, tip: 8, zaporedna: 500, casovniZig: 1, ssrc, koristno: new Uint8Array(160) }), linaRtp);
    rtp.poslji(sestaviRtp({ oznaka: false, tip: 8, zaporedna: 501, casovniZig: 1, ssrc: 0x99, koristno: new Uint8Array(160) }), linaRtp);
    rtp.poslji(sestaviRtp({ oznaka: false, tip: 0, zaporedna: 502, casovniZig: 1, ssrc, koristno: new Uint8Array(160) }), linaRtp);
    await streznik.caka(() => (zvok.length >= 10 && dtmf.length >= 1 && (klic.rtp?.statistika.zavrnjenTip ?? 0) >= 1) || null);
    expect(zvok.length).toBe(10);
    expect(zvok.every((z) => z.length === 480)).toBe(true);
    expect(dtmf).toEqual(["5"]);
    expect(klic.rtp?.statistika).toMatchObject({ zavrnjenTujVir: 1, zavrnjenSsrc: 1, zavrnjenTip: 1 });
    // ton 1 kHz v 24 kHz: preckanja nicle ~ 2000/s
    const skupaj = Int16Array.from(zvok.slice(3).flatMap((z) => Array.from(z)));
    let preckanja = 0;
    for (let i = 1; i < skupaj.length; i++) if (((skupaj[i - 1] as number) < 0) !== ((skupaj[i] as number) < 0)) preckanja++;
    expect(preckanja / (skupaj.length / 24000)).toBeGreaterThan(1900);
    expect(preckanja / (skupaj.length / 24000)).toBeLessThan(2100);

    // Lina -> klicatelj: 200 ms 24 kHz govora (1 kHz) v pakete po 20 ms
    const rtpPaketi: RtpPaket[] = [];
    rtp.socket.on("message", (b) => {
      const p = razcleniRtp(b);
      if (p.ok) rtpPaketi.push(p.vrednost);
    });
    klic.poslji(Int16Array.from({ length: 4800 }, (_v, n) => Math.round(8000 * Math.sin((2 * Math.PI * 1000 * n) / 24000))));
    expect(klic.posljiDtmf("#", 60)).toBe(true);
    await rtp.caka(() => rtpPaketi.filter((p) => p.tip === 101).length >= 5 || null, 4000, () => []).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 400));
    const zvocni = rtpPaketi.filter((p) => p.tip === 8);
    expect(zvocni.length).toBeGreaterThanOrEqual(10);
    expect(zvocni.every((p) => p.koristno.length === 160)).toBe(true);
    expect(new Set(rtpPaketi.map((p) => p.ssrc)).size).toBe(1);
    const vsi = [...rtpPaketi].sort((a, b) => a.zaporedna - b.zaporedna);
    for (let i = 1; i < vsi.length; i++) expect(((vsi[i] as RtpPaket).zaporedna - (vsi[i - 1] as RtpPaket).zaporedna) & 0xffff).toBe(1);
    const glasni = zvocni.filter((p) => Math.max(...Array.from(p.koristno, (b) => Math.abs(alawVLinear(b)))) > 4000);
    expect(glasni.length).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < zvocni.length; i++) {
      const d = ((zvocni[i] as RtpPaket).casovniZig - (zvocni[i - 1] as RtpPaket).casovniZig) >>> 0;
      expect(d % 160).toBe(0);
    }
    const dtmfPaketi = rtpPaketi.filter((p) => p.tip === 101);
    const dogodki = dtmfPaketi.map((p) => razcleniDtmf(p.koristno)).map((r) => (r.ok ? r.vrednost : null));
    expect(dogodki.every((d) => d?.znak === "#")).toBe(true);
    expect(dogodki.filter((d) => d?.konec).length).toBe(3);
    expect(new Set(dtmfPaketi.map((p) => p.casovniZig)).size).toBe(1);
    expect(dtmfPaketi[0]?.oznaka).toBe(true);

    // BYE od klicatelja
    streznik.poslji(vDialogu("BYE", streznik, cilj, inv, toTag, 2), cilj);
    await streznik.caka((p) => p.s.vrsta === "odgovor" && p.s.status === 200 && cseqOf(p.s) === "2 BYE");
    expect(konec).toBe("bye");
    expect(o.steviloKlicev).toBe(0);
  }, 15_000);

  it("CANCEL pred sprejemom: 200 na CANCEL, 487 na INVITE, konec 'preklic'; ACK ustavi ponovitve 487", async () => {
    const { streznik, rtp, klici, cilj } = await pripravljenKlic();
    const inv = invite(streznik, cilj, rtp.vrata);
    streznik.poslji(inv.besedilo, cilj);
    await odgovorNaInvite(streznik, inv.callId, 180);
    await streznik.caka(() => klici.length > 0 || null);
    let konec = "";
    (klici[0] as DohodniKlic).on("konec", (r) => (konec = r));
    streznik.poslji(vDialogu("CANCEL", streznik, cilj, inv, null, 1), cilj);
    await streznik.caka((p) => p.s.vrsta === "odgovor" && p.s.status === 200 && cseqOf(p.s) === "1 CANCEL");
    const z487 = await odgovorNaInvite(streznik, inv.callId, 487);
    expect(konec).toBe("preklic");
    streznik.poslji(vDialogu("ACK", streznik, cilj, inv, parametri(prvaGlava(z487, "to") ?? "").get("tag") ?? "", 1), cilj);
    await new Promise((r) => setTimeout(r, 150));
    const prej = streznik.prejeto.filter((p) => p.s.vrsta === "odgovor" && p.s.status === 487).length;
    await new Promise((r) => setTimeout(r, 400));
    expect(streznik.prejeto.filter((p) => p.s.vrsta === "odgovor" && p.s.status === 487).length).toBe(prej);
    // CANCEL za neznano transakcijo -> 481
    streznik.poslji(vDialogu("CANCEL", streznik, cilj, { callId: "neznan@x", branch: "z9hG4bKneznan" }, null, 1), cilj);
    await streznik.caka((p) => p.s.vrsta === "odgovor" && p.s.status === 481);
  }, 10_000);

  it("OPTIONS -> 200 z Allow; neznana metoda -> 405; ponovljen INVITE dobi isti odgovor; drugi klic -> 486", async () => {
    const { streznik, rtp, cilj, klici } = await pripravljenKlic();
    const options = (cs: number, metoda = "OPTIONS") =>
      [`${metoda} sip:lina@${IP} SIP/2.0`, `Via: SIP/2.0/UDP ${IP}:${streznik.vrata};branch=z9hG4bKopt${cs}`, "From: <sip:p@example.invalid>;tag=o", "To: <sip:lina@example.invalid>", `Call-ID: opt-${cs}`, `CSeq: ${cs} ${metoda}`, "Content-Length: 0"].join(CRLF) + CRLF + CRLF;
    streznik.poslji(options(1), cilj);
    const opt = await streznik.caka((p) => (p.s.vrsta === "odgovor" && cseqOf(p.s) === "1 OPTIONS" ? p.s : null));
    expect(opt.vrsta === "odgovor" && opt.status).toBe(200);
    expect(prvaGlava(opt, "allow")).toContain("INVITE");
    streznik.poslji(options(2, "MESSAGE"), cilj);
    const msg = await streznik.caka((p) => (p.s.vrsta === "odgovor" && cseqOf(p.s) === "2 MESSAGE" ? p.s : null));
    expect(msg.vrsta === "odgovor" && msg.status).toBe(405);

    const prvi = invite(streznik, cilj, rtp.vrata);
    streznik.poslji(prvi.besedilo, cilj);
    await odgovorNaInvite(streznik, prvi.callId, 180);
    streznik.poslji(prvi.besedilo, cilj); // ponovitev istega INVITE
    await streznik.caka(() => streznik.prejeto.filter((p) => p.s.vrsta === "odgovor" && p.s.status === 180).length >= 2 || null);
    expect(klici.length).toBe(1);
    const drugi = invite(streznik, cilj, rtp.vrata);
    streznik.poslji(drugi.besedilo, cilj);
    await odgovorNaInvite(streznik, drugi.callId, 486);
    expect(klici.length).toBe(1);
  }, 10_000);

  it("brez ACK po 200 OK: ponovitve 200, nato BYE in konec 'brez-ack'", async () => {
    const { streznik, rtp, klici, cilj } = await pripravljenKlic();
    const inv = invite(streznik, cilj, rtp.vrata);
    streznik.poslji(inv.besedilo, cilj);
    await streznik.caka(() => klici.length > 0 || null);
    const klic = klici[0] as DohodniKlic;
    const konec = new Promise<string>((r) => klic.once("konec", r));
    await klic.sprejmi();
    expect(await konec).toBe("brez-ack");
    expect(streznik.prejeto.filter((p) => p.s.vrsta === "odgovor" && p.s.status === 200 && prvaGlava(p.s, "call-id") === inv.callId).length).toBeGreaterThanOrEqual(3);
    await streznik.caka((p) => jeZahteva(p, "BYE"));
  }, 10_000);

  it("Lina odlozi: BYE s pravimi tagi, Request-URI = Contact klicatelja", async () => {
    const { streznik, rtp, klici, cilj } = await pripravljenKlic();
    const inv = invite(streznik, cilj, rtp.vrata);
    streznik.poslji(inv.besedilo, cilj);
    await streznik.caka(() => klici.length > 0 || null);
    const klic = klici[0] as DohodniKlic;
    await klic.sprejmi();
    const ok = await odgovorNaInvite(streznik, inv.callId, 200);
    const toTag = parametri(prvaGlava(ok, "to") ?? "").get("tag") ?? "";
    streznik.poslji(vDialogu("ACK", streznik, cilj, inv, toTag, 1), cilj);
    klic.odlozi();
    const bye = await streznik.caka((p) => jeZahteva(p, "BYE"));
    expect(bye.uri).toBe(`sip:100@${IP}:${streznik.vrata}`);
    expect(parametri(prvaGlava(bye, "from") ?? "").get("tag")).toBe(toTag);
    expect(parametri(prvaGlava(bye, "to") ?? "").get("tag")).toBe(`klicatelj${stevec}`);
    expect(prvaGlava(bye, "call-id")).toBe(inv.callId);
  }, 10_000);

  it("nepravilna sporocila se zavrzejo brez izjeme in brez odgovora; odjemalec dela naprej", async () => {
    const { streznik, cilj, o } = await pripravljenKlic();
    const zavrnjeno: string[] = [];
    o.on("zavrnjeno", (r) => zavrnjeno.push(r));
    const pred = streznik.surovo.length;
    streznik.poslji(Buffer.from([0, 1, 2, 3, 255, 254]), cilj);
    streznik.poslji(Buffer.alloc(9000, 0x41), cilj);
    streznik.poslji(`OPTIONS sip:lina@${IP} SIP/2.0\r\n${Array.from({ length: 100 }, (_v, i) => `X-${i}: 1`).join("\r\n")}\r\n\r\n`, cilj);
    streznik.poslji(`OPTIONS sip:lina@${IP} SIP/2.0\r\nVia: SIP/2.0/UDP ${IP}:1;branch=z9hG4bKx\r\nFrom: <sip:a@b>;tag=1\r\nTo: <sip:a@b>\r\nCall-ID: c\r\nCSeq: 1 OPTIONS\r\nContent-Length: 999\r\n\r\nabc`, cilj);
    streznik.poslji(`INVITE sip:lina@${IP} SIP/2.0\r\nVia: SIP/2.0/UDP ${IP}:1\r\nFrom: <sip:a@b>;tag=1\r\nTo: <sip:a@b>\r\nCall-ID: c\r\nCSeq: 1 INVITE\r\nContent-Length: 0\r\n\r\n`, cilj);
    streznik.poslji("\r\n\r\n", cilj); // ohranjanje NAT
    await streznik.caka(() => zavrnjeno.length >= 5 || null);
    expect(zavrnjeno).toEqual(expect.arrayContaining(["prevelik datagram", "prevec glav", "Content-Length se ne ujema s telesom", "napacna Via"]));
    await new Promise((r) => setTimeout(r, 150));
    // nobenega odgovora na nepravilna sporocila (brez ojacevanja); zahteve REGISTER odjemalca niso odgovori
    expect(streznik.surovo.slice(pred).filter((s) => s.b.toString("latin1").startsWith("SIP/2.0")).length).toBe(0);
    streznik.poslji([`OPTIONS sip:lina@${IP} SIP/2.0`, `Via: SIP/2.0/UDP ${IP}:${streznik.vrata};branch=z9hG4bKok`, "From: <sip:p@x>;tag=o", "To: <sip:lina@x>", "Call-ID: ok", "CSeq: 9 OPTIONS", "", ""].join(CRLF), cilj);
    await streznik.caka((p) => p.s.vrsta === "odgovor" && cseqOf(p.s) === "9 OPTIONS");
  }, 10_000);

  it("omejitev hitrosti po viru: izbruh 30 OPTIONS dobi najvec kapaciteto odgovorov", async () => {
    const { streznik, cilj } = await pripravljenKlic({ hitrost: { kapaciteta: 5, napolnitev: 1 } });
    // en zeton je porabil 200 OK na REGISTER; pocakaj na napolnitev
    await new Promise((r) => setTimeout(r, 1100));
    for (let i = 0; i < 30; i++)
      streznik.poslji([`OPTIONS sip:lina@${IP} SIP/2.0`, `Via: SIP/2.0/UDP ${IP}:${streznik.vrata};branch=z9hG4bKr${i}`, "From: <sip:p@x>;tag=o", "To: <sip:lina@x>", `Call-ID: r${i}`, `CSeq: ${i + 1} OPTIONS`, "", ""].join(CRLF), cilj);
    await new Promise((r) => setTimeout(r, 400));
    const odgovori = streznik.prejeto.filter((p) => p.s.vrsta === "odgovor" && cseqOf(p.s).endsWith("OPTIONS")).length;
    expect(odgovori).toBeGreaterThanOrEqual(4);
    expect(odgovori).toBeLessThanOrEqual(6);
  }, 10_000);

  it("ustavi: odjava z Expires: 0 in konec klica, ki zvoni (480)", async () => {
    const { streznik, rtp, o, klici, cilj } = await pripravljenKlic();
    if (o.registriranDo === null) await new Promise((r) => o.once("registriran", r));
    const inv = invite(streznik, cilj, rtp.vrata);
    streznik.poslji(inv.besedilo, cilj);
    await streznik.caka(() => klici.length > 0 || null);
    await o.ustavi();
    await odgovorNaInvite(streznik, inv.callId, 480);
    await streznik.caka((p) => (jeZahteva(p, "REGISTER") && prvaGlava(p.s, "expires") === "0") || null);
  }, 10_000);

  it("zahteve z vira, ki ni dovoljen (druga vrata), se tiho zavrzejo", async () => {
    const streznik = await vticnica();
    streznik.socket.on("message", (b, r) => {
      const izid = razcleniSip(b);
      if (izid.ok && izid.vrednost.vrsta === "zahteva") streznik.poslji(odgovor(izid.vrednost, 200, "OK", ["Expires: 300"]), r.port);
    });
    const o = await odjemalec(streznik, { expires: 300, dovoljeniViri: [`${IP}:${streznik.vrata}`] });
    const tuj = await vticnica();
    const klici: DohodniKlic[] = [];
    o.on("klic", (k) => klici.push(k));
    const inv = invite(tuj, o.naslov.vrata, 40000);
    tuj.poslji(inv.besedilo, o.naslov.vrata);
    await new Promise((r) => setTimeout(r, 300));
    expect(tuj.surovo.length).toBe(0);
    expect(klici.length).toBe(0);
    const prav = invite(streznik, o.naslov.vrata, 40000);
    streznik.poslji(prav.besedilo, o.naslov.vrata);
    await streznik.caka(() => klici.length > 0 || null);
  }, 10_000);
  it("SIP1-1: tok nerazclenljivih datagramov z naslova registrarja ne utisa pravega prometa (OPTIONS dobi odgovor)", async () => {
    const { streznik, cilj } = await pripravljenKlic({ hitrost: { kapaciteta: 5, napolnitev: 1 } });
    for (let i = 0; i < 80; i++) streznik.poslji(`navlaka ${i}`, cilj);
    await new Promise((r) => setTimeout(r, 300));
    streznik.poslji(
      [`OPTIONS sip:lina@${IP} SIP/2.0`, `Via: SIP/2.0/UDP ${IP}:${streznik.vrata};branch=z9hG4bKpo1`, "From: <sip:p@x>;tag=o", "To: <sip:lina@x>", "Call-ID: po-1", "CSeq: 1 OPTIONS", "Content-Length: 0"].join(CRLF) + CRLF + CRLF,
      cilj,
    );
    const opt = await streznik.caka((p) => (p.s.vrsta === "odgovor" && cseqOf(p.s) === "1 OPTIONS" ? p.s : null), 2000);
    expect(opt.vrsta === "odgovor" && opt.status).toBe(200);
  }, 10_000);

  it("SIP1-1: BYE v obstojecem dialogu ni omejen z vedrom novih zahtev", async () => {
    const { streznik, rtp, o, klici, cilj } = await pripravljenKlic({ hitrost: { kapaciteta: 3, napolnitev: 0.001 } });
    const inv = invite(streznik, cilj, rtp.vrata);
    streznik.poslji(inv.besedilo, cilj);
    await odgovorNaInvite(streznik, inv.callId, 180);
    await streznik.caka(() => klici.length > 0 || null);
    const klic = klici[0] as DohodniKlic;
    const ok = odgovorNaInvite(streznik, inv.callId, 200);
    await klic.sprejmi();
    const o200 = await ok;
    const toTag = parametri(prvaGlava(o200, "to") ?? "").get("tag") ?? "";
    // vedro novih zahtev izpraznimo z OPTIONS
    for (let i = 0; i < 10; i++)
      streznik.poslji([`OPTIONS sip:lina@${IP} SIP/2.0`, `Via: SIP/2.0/UDP ${IP}:${streznik.vrata};branch=z9hG4bKpb${i}`, "From: <sip:p@x>;tag=o", "To: <sip:lina@x>", `Call-ID: pb${i}`, `CSeq: ${i + 1} OPTIONS`, "Content-Length: 0"].join(CRLF) + CRLF + CRLF, cilj);
    await new Promise((r) => setTimeout(r, 300));
    streznik.poslji(vDialogu("ACK", streznik, cilj, inv, toTag, 1), cilj);
    streznik.poslji(vDialogu("BYE", streznik, cilj, inv, toTag, 2), cilj);
    const bye = await streznik.caka((p) => (p.s.vrsta === "odgovor" && cseqOf(p.s) === "2 BYE" ? p.s : null), 2000);
    expect(bye.vrsta === "odgovor" && bye.status).toBe(200);
    expect(o.naslov.vrata).toBe(cilj);
  }, 12_000);

  it("SIP1-2: INVITE s c= na link-local ali multicast naslov dobi 488 in ne ustvari klica", async () => {
    const { streznik, rtp, klici, cilj } = await pripravljenKlic();
    for (const naslov of ["169.254.169.254", "224.0.0.251", "255.255.255.255"]) {
      const inv = invite(streznik, cilj, rtp.vrata);
      const telo = inv.besedilo.split(CRLF + CRLF)[1] ?? "";
      const novoTelo = telo.replace(`c=IN IP4 ${IP}`, `c=IN IP4 ${naslov}`);
      const glava = (inv.besedilo.split(CRLF + CRLF)[0] ?? "").replace(/Content-Length: \d+/, `Content-Length: ${Buffer.byteLength(novoTelo)}`);
      streznik.poslji(glava + CRLF + CRLF + novoTelo, cilj);
      const o = await odgovorNaInvite(streznik, inv.callId, 488);
      expect(o.vrsta === "odgovor" && o.status).toBe(488);
    }
    expect(klici.length).toBe(0);
  }, 10_000);
  it("SIP1-3: zakasnela ponovitev istega INVITE po ACK in BYE ne ustvari novega klica", async () => {
    const { streznik, rtp, klici, cilj } = await pripravljenKlic();
    const inv = invite(streznik, cilj, rtp.vrata);
    streznik.poslji(inv.besedilo, cilj);
    await streznik.caka(() => klici.length > 0 || null);
    const klic = klici[0] as DohodniKlic;
    await klic.sprejmi();
    const ok = await odgovorNaInvite(streznik, inv.callId, 200);
    const toTag = parametri(prvaGlava(ok, "to") ?? "").get("tag") ?? "";
    streznik.poslji(vDialogu("ACK", streznik, cilj, inv, toTag, 1), cilj);
    await new Promise((r) => setTimeout(r, 100));
    streznik.poslji(vDialogu("BYE", streznik, cilj, inv, toTag, 2), cilj);
    await streznik.caka((p) => (p.s.vrsta === "odgovor" && cseqOf(p.s) === "2 BYE" ? p.s : null), 2000);
    streznik.poslji(inv.besedilo, cilj); // zakasnela kopija prvotnega INVITE
    await new Promise((r) => setTimeout(r, 400));
    expect(klici.length).toBe(1);
    const trying = streznik.prejeto.filter((p) => p.s.vrsta === "odgovor" && p.s.status === 100 && prvaGlava(p.s, "call-id") === inv.callId).length;
    expect(trying).toBe(1);
  }, 10_000);

  it("SIP3-1: odgovor registrarja z drugih vrat za NAT/SBC (ujemajo se branch, Call-ID in CSeq) uspe; odgovor na BYE z drugih vrat uspe", async () => {
    const reg = await vticnica();
    const drugaVrata = await vticnica();
    let poslanoDruga = false;
    reg.socket.on("message", (b, r) => {
      const izid = razcleniSip(b);
      if (!izid.ok || izid.vrednost.vrsta !== "zahteva") return;
      const z = izid.vrednost;
      if (z.metoda === "REGISTER" || z.metoda === "BYE") {
        drugaVrata.poslji(odgovor(z, 200, "OK", z.metoda === "REGISTER" ? ["Expires: 300"] : []), r.port);
        poslanoDruga = true;
      }
    });
    const o = await odjemalec(reg, { expires: 300 });
    await reg.caka(() => o.registriranDo !== null || null, 2000);
    expect(poslanoDruga).toBe(true);
    expect(o.registriranDo).toBe(300);
    expect(o.zavrnjenih).toBe(0);

    // Preizkus odgovora na BYE z drugih vrat istega IP
    const rtp = await vticnica();
    const klici: DohodniKlic[] = [];
    o.on("klic", (k) => klici.push(k));
    const inv = invite(reg, o.naslov.vrata, rtp.vrata);
    reg.poslji(inv.besedilo, o.naslov.vrata);
    await reg.caka(() => klici.length > 0 || null);
    const klic = klici[0] as DohodniKlic;
    await klic.sprejmi();
    const ok = await odgovorNaInvite(reg, inv.callId, 200);
    const toTag = parametri(prvaGlava(ok, "to") ?? "").get("tag") ?? "";
    reg.poslji(vDialogu("ACK", reg, o.naslov.vrata, inv, toTag, 1), o.naslov.vrata);
    klic.odlozi();
    await reg.caka((p) => jeZahteva(p, "BYE"));
    await new Promise((r) => setTimeout(r, 80));
    // Ker je odgovor 200 OK z drugaVrata sprejet, se BYE ne ponavlja
    expect(reg.prejeto.filter((p) => jeZahteva(p, "BYE")).length).toBe(1);
    expect(o.zavrnjenih).toBe(0);
  }, 10_000);

  it("(1) SIP3-1/SIP3-2: ponarejen odgovor s tretjih vrat brez ujemajocega branch ali Call-ID/CSeq je zavrnjen in zabelezen", async () => {
    const reg = await vticnica();
    const tujaVrata = await vticnica();
    let poslanoTuja = false;
    reg.socket.on("message", (b, r) => {
      const izid = razcleniSip(b);
      if (!izid.ok || izid.vrednost.vrsta !== "zahteva") return;
      const z = izid.vrednost;
      if (z.metoda === "REGISTER" && !poslanoTuja) {
        // 1) Odgovor z napacnim branch
        const ponarejenBranch = odgovor(z, 200, "OK", ["Expires: 300"]).replace(/branch=z9hG4bK[0-9a-f]+/i, "branch=z9hG4bKponarejen");
        tujaVrata.poslji(ponarejenBranch, r.port);
        // 2) Odgovor z ujemajocim branch, a napacnim Call-ID
        const ponarejenCallId = odgovor(z, 200, "OK", ["Expires: 300"]).replace(/call-id:\s*[^\r\n]+/i, "call-id: ponarejen@lina");
        tujaVrata.poslji(ponarejenCallId, r.port);
        // 3) Odgovor z ujemajocim branch in Call-ID, a napacnim CSeq
        const ponarejenCSeq = odgovor(z, 200, "OK", ["Expires: 300"]).replace(/cseq:\s*[^\r\n]+/i, "cseq: 999999 REGISTER");
        tujaVrata.poslji(ponarejenCSeq, r.port);
        poslanoTuja = true;
      }
    });
    const zavrnjeno: string[] = [];
    const o = await odjemalec(reg, { expires: 300 });
    o.on("zavrnjeno", (razlog) => zavrnjeno.push(razlog));
    await reg.caka(() => (poslanoTuja && o.zavrnjenih >= 3) || null, 2000);
    expect(reg.prejeto.some((p) => jeZahteva(p, "REGISTER"))).toBe(true);
    expect(poslanoTuja).toBe(true);
    expect(o.registriranDo).toBeNull();
    expect(o.zavrnjenih).toBeGreaterThanOrEqual(3);
    expect(o.zavrnjeniPoRazlogu["odgovor brez transakcije"]).toBeGreaterThanOrEqual(1);
    expect(o.zavrnjeniPoRazlogu["tuj vir"]).toBeGreaterThanOrEqual(2);
  }, 10_000);

  it("SIP3-2/SIP3-9: strogaVrataOdgovora zavrne odgovor s tretjih vrat kljub ujemajocemu branch, dovoli pa konfigurirana vrata", async () => {
    const reg = await vticnica();
    const tujaVrata = await vticnica();
    let poslanoTuja = false;
    reg.socket.on("message", (b, r) => {
      const izid = razcleniSip(b);
      if (!izid.ok || izid.vrednost.vrsta !== "zahteva") return;
      const z = izid.vrednost;
      if (z.metoda === "REGISTER" && !poslanoTuja) {
        tujaVrata.poslji(odgovor(z, 200, "OK", ["Expires: 300"]), r.port);
        poslanoTuja = true;
      }
    });
    const o = await odjemalec(reg, { expires: 300, strogaVrataOdgovora: true });
    await reg.caka(() => (poslanoTuja && o.zavrnjenih >= 1) || null, 2000);
    expect(poslanoTuja).toBe(true);
    expect(o.registriranDo).toBeNull();
    expect(o.zavrnjeniPoRazlogu["tuj vir"]).toBeGreaterThanOrEqual(1);
  }, 10_000);

  it("SIP3-5: re-INVITE (zadrzanje sendonly, inactive, recvonly in nadaljevanje sendrecv) prebere novo SDP in odgovori z zrcaljeno smerjo", async () => {
    const { streznik, rtp, klici, cilj } = await pripravljenKlic();
    const inv = invite(streznik, cilj, rtp.vrata);
    streznik.poslji(inv.besedilo, cilj);
    const zvonjenje = await odgovorNaInvite(streznik, inv.callId, 180);
    const toTag = parametri(prvaGlava(zvonjenje, "to") ?? "").get("tag") ?? "";
    await streznik.caka(() => klici.length > 0 || null);
    const klic = klici[0] as DohodniKlic;
    await klic.sprejmi();
    await odgovorNaInvite(streznik, inv.callId, 200);
    streznik.poslji(vDialogu("ACK", streznik, cilj, inv, toTag, 1), cilj);

    const posljiReInvite = async (cseq: number, smerPonudbe: string, pricakovanaSmerOdgovora: string) => {
      const telo = ponudbaSdp(rtp.vrata).replace("a=ptime:20", `a=ptime:20${CRLF}a=${smerPonudbe}`);
      const reinv =
        [
          `INVITE sip:lina@${IP}:${cilj} SIP/2.0`,
          `Via: SIP/2.0/UDP ${IP}:${streznik.vrata};branch=z9hG4bKreinv${stevec}-${cseq}`,
          "Max-Forwards: 70",
          `From: <sip:100@example.invalid>;tag=klicatelj${inv.callId.split("@")[0]?.split("-")[1]}`,
          `To: <sip:lina@example.invalid>;tag=${toTag}`,
          `Call-ID: ${inv.callId}`,
          `CSeq: ${cseq} INVITE`,
          `Contact: <sip:100@${IP}:${streznik.vrata}>`,
          "Content-Type: application/sdp",
          `Content-Length: ${Buffer.byteLength(telo)}`,
        ].join(CRLF) +
        CRLF +
        CRLF +
        telo;
      streznik.poslji(reinv, cilj);
      const ok = await streznik.caka((p) => (p.s.vrsta === "odgovor" && p.s.status === 200 && cseqOf(p.s) === `${cseq} INVITE` ? p.s : null));
      expect(ok.telo).toContain(`a=${pricakovanaSmerOdgovora}\r\n`);
      expect(klic.dogovor.smer).toBe(smerPonudbe);
      streznik.poslji(vDialogu("ACK", streznik, cilj, inv, toTag, cseq), cilj);
    };

    await posljiReInvite(2, "sendonly", "recvonly");
    expect(klic.posljiDtmf("1")).toBe(false);
    await posljiReInvite(3, "inactive", "inactive");
    expect(klic.posljiDtmf("1")).toBe(false);
    await posljiReInvite(4, "recvonly", "sendonly");
    expect(klic.posljiDtmf("1")).toBe(true);
    await posljiReInvite(5, "sendrecv", "sendrecv");
    expect(klic.posljiDtmf("2")).toBe(true);
  }, 10_000);

  it("(9) SIP3-9: klicatelj iz From je nezaupan vnos: ociscen kontrolnih in dvosmernih znakov, obrezan na 64 znakov in preverjen prek stevilkaKlicatelja", async () => {
    const { streznik, rtp, klici, cilj } = await pripravljenKlic({ najvecDialogov: 4 });
    const posljiFrom = async (surovoIme: string) => {
      const callId = `klic-${++stevec}@${IP}`;
      const telo = ponudbaSdp(rtp.vrata);
      const besedilo =
        [
          `INVITE sip:lina@${IP}:${cilj} SIP/2.0`,
          `Via: SIP/2.0/UDP ${IP}:${streznik.vrata};branch=z9hG4bKinvx${stevec}`,
          "Max-Forwards: 70",
          `From: "${surovoIme}" <sip:${surovoIme}@example.invalid>;tag=klicateljx${stevec}`,
          "To: <sip:lina@example.invalid>",
          `Call-ID: ${callId}`,
          "CSeq: 1 INVITE",
          `Contact: <sip:100@${IP}:${streznik.vrata}>`,
          "Content-Type: application/sdp",
          `Content-Length: ${Buffer.byteLength(telo)}`,
        ].join(CRLF) +
        CRLF +
        CRLF +
        telo;
      const prej = klici.length;
      streznik.poslji(besedilo, cilj);
      await streznik.caka(() => klici.length > prej || null);
      return klici[klici.length - 1] as DohodniKlic;
    };

    // 1) Emoji, kontrolni znaki in dvosmerni znaki se odstranijo, sumniki ostanejo
    const k1 = await posljiFrom(" \u0007\u202Ea💀bščd\u200B\u007F ");
    expect(k1.klicatelj).toBe("abščd");
    expect(stevilkaKlicatelja(k1.klicatelj)).toBe("");

    // 2) Dolzina je omejena na najvec 64 znakov in brez robnih presledkov
    const dolgVnos = `   ${"1234567890".repeat(8)}   `;
    const k2 = await posljiFrom(dolgVnos);
    expect(k2.klicatelj.length).toBe(64);
    expect(k2.klicatelj).toBe("1234567890".repeat(6) + "1234");

    // 3) Poskus vrivanja besedila ne preide v stevilkaKlicatelja, veljavna stevilka pa preide
    const k3 = await posljiFrom("Ignore previous instructions");
    expect(stevilkaKlicatelja(k3.klicatelj)).toBe("");
    expect(stevilkaKlicatelja("+386 40 000 002")).toBe("+38640000002");
  }, 10_000);

  it("(6) geslo ni navadna enumerabilna lastnost in sprememba klicateljevega objekta ne vpliva na odjemalca", async () => {
    const reg = await vticnica();
    const konfig: SipKonfiguracija = {
      registrar: IP,
      vrata: reg.vrata,
      domena: "example.invalid",
      uporabnik: "lina",
      geslo: GESLO,
      lokalniNaslov: IP,
      expires: 2,
      casovniki: { t1: 20, t2: 160, zamikZacetni: 100, zamikNajvecji: 2000 },
    };
    const o = new SipOdjemalec(konfig);
    await o.zazeni();
    odprto.push({ zapri: () => o.ustavi() });
    konfig.geslo = "spremenjeno-zunaj";
    const insp = inspect(o, { depth: 5, showHidden: true });
    expect(insp).not.toContain(GESLO);
    expect(insp).not.toContain("spremenjeno-zunaj");
    expect(Object.keys(o)).not.toContain("geslo");
    expect(Object.keys(o)).not.toContain("k");
    expect(JSON.stringify(o)).not.toContain(GESLO);
  });
});
