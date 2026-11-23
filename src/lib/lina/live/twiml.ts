/**
 * TwiML za pot Live: <Connect><Stream> z enkratnim zetonom kot <Parameter>, nato <Hangup/> (po koncu toka Twilio izvede
 * naslednji element; brez njega bi klic ostal odprt). Samo wss: Twilio drugega ne sprejme in zeton ne sme po cistem besedilu.
 */
function pobegni(vrednost: string): string {
  return vrednost.replace(/[&<>"']/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "'" ? "&apos;" : "&quot;"));
}

export const POT_LIVE = "/api/voice/live";

/** origin: javni naslov https://gostitelj[:vrata]. Vrne telo TwiML elementov (brez <Response>). */
export function twimlLive(origin: string, zeton: string): string {
  const wss = origin.replace(/^http(s?):\/\//i, (_m, s: string) => (s ? "wss://" : "ws://"));
  return `<Connect><Stream url="${pobegni(`${wss}${POT_LIVE}`)}"><Parameter name="zeton" value="${pobegni(zeton)}"/></Stream></Connect><Hangup/>`;
}
