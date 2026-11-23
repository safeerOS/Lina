/**
 * Pot SIP (enakovredna Twiliu): javni vmesnik modula. Vezava v klic Live: most-sip.server.ts (SIP-2), zivljenjski cikel: sluzba-sip.server.ts.
 * - SipOdjemalec: zazeni(), ustavi(); dogodki "registriran", "napakaRegistracije", "klic" (DohodniKlic), "zavrnjeno".
 * - DohodniKlic: sprejmi(), zavrni(), odlozi(), poslji(pcm24k), prekiniPredvajanje(), posljiDtmf();
 *   dogodki "zvok" (Int16Array, 24 kHz, 20 ms), "dtmf" (znak), "konec" (razlog).
 * Besedila klica (razkritje UI v prvem stavku, brez cen in obljub) ostanejo v obstojeci logiki klica.
 */
export { DohodniKlic, SipOdjemalec, type Casovniki, type RazlogKonca, type SipKonfiguracija } from "./odjemalec.server.ts";
export { RtpSeja, VZORCEV_24K_V_PAKETU, VZORCEV_V_PAKETU } from "./rtp-seja.server.ts";
export { preberiSip, pozabiSip, shraniSip, sipKonfiguracija, type SipJavno, type SipVnos } from "./nastavitve.server.ts";
export { MostSip, stevilkaKlicatelja, type KlicZaMost, type OdvisnostiMostaSip } from "./most-sip.server.ts";
export {
  pozabiNastavitveSip,
  preberiNastavitveSip,
  shraniNastavitveSip,
  SipSluzba,
  sluzbaSip,
  stanjeRegistracijeSip,
  uskladiSip,
  ustaviVseSip,
  type StanjeRegistracije,
} from "./sluzba-sip.server.ts";
