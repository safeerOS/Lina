/** SDP (RFC 4566, ponudba/odgovor RFC 3264) samo za en zvocni tok G.711 + telephone-event (RFC 4733). */
import { isIP } from "node:net";
import type { G711 } from "./g711.ts";
import { napaka, uspeh, type Izid } from "./izid.ts";

export const SDP_NAJVEC_BAJTOV = 4096;
const SDP_NAJVEC_VRSTIC = 128;

export type SdpPonudba = {
  naslov: string;
  vrata: number;
  /** Tipi koristne vsebine v vrstnem redu ponudbe. */
  tipi: number[];
  rtpmap: Map<number, { ime: string; hitrost: number }>;
  smer: "sendrecv" | "sendonly" | "recvonly" | "inactive";
};

export type SdpDogovor = {
  naslov: string;
  vrata: number;
  kodek: G711;
  tipKodeka: number;
  /** Tip za telephone-event (null, ce ga ponudba nima). */
  tipDtmf: number | null;
  smer: "sendrecv" | "sendonly" | "recvonly" | "inactive";
};

export function razcleniSdp(telo: string): Izid<SdpPonudba> {
  if (typeof telo !== "string" || Buffer.byteLength(telo, "utf8") > SDP_NAJVEC_BAJTOV) return napaka("prevelik SDP");
  const vrstice = telo.split(/\r?\n/).filter((v) => v.length > 0);
  if (vrstice.length === 0 || vrstice.length > SDP_NAJVEC_VRSTIC) return napaka("napacno stevilo vrstic SDP");
  if (vrstice[0] !== "v=0") return napaka("ni v=0");
  let sejniNaslov: string | null = null;
  let medijskiNaslov: string | null = null;
  let vrata = -1;
  let tipi: number[] = [];
  let vMediju = false;
  let vZvoku = false;
  let zvokNajden = false;
  let smer: SdpPonudba["smer"] = "sendrecv";
  const rtpmap = new Map<number, { ime: string; hitrost: number }>();
  for (const v of vrstice) {
    if (!/^[a-z]=/.test(v)) return napaka("napacna vrstica SDP");
    const vrsta = v[0];
    const vsebina = v.slice(2);
    if (vrsta === "m") {
      vMediju = true;
      const m = /^(\w+) (\d{1,5})(?:\/\d+)? (RTP\/AVP|RTP\/AVPF|RTP\/SAVP|RTP\/SAVPF) ([\d ]+)$/.exec(vsebina);
      vZvoku = false;
      if (zvokNajden) {
        // Drugi tokovi (video ...) se v odgovoru ne uporabijo; prvi zvocni tok je nas.
        continue;
      }
      if (!m || m[1] !== "audio") continue;
      vZvoku = true;
      if (m[3] !== "RTP/AVP") return napaka("nepodprt profil (SRTP/AVPF)");
      vrata = Number(m[2]);
      tipi = (m[4] ?? "").trim().split(/\s+/).map(Number);
      if (tipi.some((t) => !Number.isInteger(t) || t < 0 || t > 127) || tipi.length > 32) return napaka("napacni tipi");
      zvokNajden = true;
      continue;
    }
    if (vrsta === "c") {
      const m = /^IN (IP4|IP6) ([^\s/]+)$/.exec(vsebina);
      if (!m) return napaka("napacna vrstica c=");
      const naslov = m[2] ?? "";
      if (isIP(naslov) === 0) return napaka("c= ni naslov IP");
      if (vMediju) {
        if (vZvoku && medijskiNaslov === null) medijskiNaslov = naslov;
      } else sejniNaslov = naslov;
      continue;
    }
    if (vrsta === "a" && (!vMediju || vZvoku)) {
      const rm = /^rtpmap:(\d{1,3}) ([A-Za-z0-9\-_.]+)\/(\d+)(?:\/\d+)?$/.exec(vsebina);
      if (rm && vZvoku) {
        rtpmap.set(Number(rm[1]), { ime: (rm[2] ?? "").toLowerCase(), hitrost: Number(rm[3]) });
        continue;
      }
      if (vsebina === "sendrecv" || vsebina === "sendonly" || vsebina === "recvonly" || vsebina === "inactive") smer = vsebina;
    }
  }
  if (!zvokNajden) return napaka("ni zvocnega toka");
  const naslov = medijskiNaslov ?? sejniNaslov;
  if (!naslov) return napaka("ni naslova c=");
  if (vrata < 0 || vrata > 65535) return napaka("napacna vrata");
  return uspeh({ naslov, vrata, tipi, rtpmap, smer });
}

/**
 * Razvrsti naslov IP: "javen", "zasebni" (loopback, RFC 1918, CGNAT, ULA) ali "prepovedan"
 * (nedolocen, multicast, broadcast, link-local, rezervirano). Prepovedan naslov ni nikoli veljaven cilj RTP.
 */
export function razredNaslova(naslov: string): "javen" | "zasebni" | "prepovedan" {
  let n = naslov.toLowerCase();
  const preslikan = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(n);
  if (preslikan) n = preslikan[1] ?? n;
  if (isIP(n) === 4) {
    const o = n.split(".").map(Number);
    const a = o[0] ?? 0;
    const b = o[1] ?? 0;
    if (a === 0 || a >= 224) return "prepovedan";
    if (a === 169 && b === 254) return "prepovedan";
    if (a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return "zasebni";
    return "javen";
  }
  if (isIP(n) === 6) {
    if (n === "::") return "prepovedan";
    if (n === "::1") return "zasebni";
    const prva = parseInt(n.split(":")[0] || "0", 16);
    if ((prva & 0xff00) === 0xff00) return "prepovedan";
    if ((prva & 0xffc0) === 0xfe80) return "prepovedan";
    if ((prva & 0xfe00) === 0xfc00) return "zasebni";
    return "javen";
  }
  return "prepovedan";
}

/** Izbere kodek po vrstnem redu ponudbe (PCMU ali PCMA) in tip telephone-event/8000. */
export function dogovoriSe(p: SdpPonudba): Izid<SdpDogovor> {
  if (p.vrata === 0) return napaka("zvocni tok zavrnjen (vrata 0)");
  if (p.naslov === "0.0.0.0" || p.naslov === "::") return napaka("tok na cakanju");
  if (razredNaslova(p.naslov) === "prepovedan") return napaka("naslov medija ni dovoljen");
  let kodek: G711 | null = null;
  let tipKodeka = -1;
  for (const t of p.tipi) {
    const rm = p.rtpmap.get(t);
    const ime = rm ? rm.ime : t === 0 ? "pcmu" : t === 8 ? "pcma" : "";
    const hitrost = rm ? rm.hitrost : 8000;
    if (hitrost !== 8000) continue;
    if (ime === "pcmu" || ime === "pcma") {
      kodek = ime === "pcmu" ? "PCMU" : "PCMA";
      tipKodeka = t;
      break;
    }
  }
  if (!kodek) return napaka("ni skupnega kodeka");
  let tipDtmf: number | null = null;
  for (const t of p.tipi) {
    const rm = p.rtpmap.get(t);
    if (rm && rm.ime === "telephone-event" && rm.hitrost === 8000 && t >= 96) {
      tipDtmf = t;
      break;
    }
  }
  return uspeh({ naslov: p.naslov, vrata: p.vrata, kodek, tipKodeka, tipDtmf, smer: p.smer });
}

/** Smer medija v SDP (RFC 3264). */
export type SmerMedija = "sendrecv" | "sendonly" | "recvonly" | "inactive";

/** Nasa smer glede na smer iz ponudbe klicatelja (sendonly pri njem = recvonly pri nas in obratno). */
export function zrcaliSmer(smer?: SmerMedija): SmerMedija {
  if (smer === "sendonly") return "recvonly";
  if (smer === "recvonly") return "sendonly";
  if (smer === "inactive") return "inactive";
  return "sendrecv";
}

/** Odgovor SDP za dogovorjeni kodek. */
export function sestaviSdpOdgovor(d: { kodek: G711; tipKodeka: number; tipDtmf: number | null; smer?: SmerMedija }, lokalno: { naslov: string; vrata: number; sejaId: string }): string {
  const ip = isIP(lokalno.naslov) === 6 ? "IP6" : "IP4";
  const tipi = [d.tipKodeka, ...(d.tipDtmf !== null ? [d.tipDtmf] : [])].join(" ");
  const vrstice = [
    "v=0",
    `o=lina ${lokalno.sejaId} ${lokalno.sejaId} IN ${ip} ${lokalno.naslov}`,
    "s=Lina",
    `c=IN ${ip} ${lokalno.naslov}`,
    "t=0 0",
    `m=audio ${lokalno.vrata} RTP/AVP ${tipi}`,
    `a=rtpmap:${d.tipKodeka} ${d.kodek}/8000`,
  ];
  if (d.tipDtmf !== null) vrstice.push(`a=rtpmap:${d.tipDtmf} telephone-event/8000`, `a=fmtp:${d.tipDtmf} 0-15`);
  const nasaSmer = zrcaliSmer(d.smer);
  vrstice.push("a=ptime:20", `a=${nasaSmer}`);
  return `${vrstice.join("\r\n")}\r\n`;
}
