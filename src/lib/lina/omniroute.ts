// @ts-nocheck
// Rekonstruirano iz prevoda nameščene Line (20. 11. 2026): izvirni .ts je bil izbrisan; tipi niso ohranjeni.
/** Zanka in zasebni naslovi IPv4 (RFC 1918) v CELOTI, da ime gostitelja kot 10.evil.example ne velja za domace omrezje. */
var ZASEBNI_IPV4 = /^(127(\.\d{1,3}){3}|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})$/;
/** http je dovoljen samo za zanko in zasebni naslov domacega omrezja; vse drugo samo https; brez gesla v naslovu. */
function veljavenNaslovPrehoda(vnos) {
	if (typeof vnos !== "string" || vnos.length === 0 || vnos.length > 300) return null;
	let url;
	try {
		url = new URL(vnos.trim());
	} catch {
		return null;
	}
	if (url.username || url.password || url.search || url.hash) return null;
	const gostitelj = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
	const lokalno = gostitelj === "localhost" || gostitelj === "::1" || ZASEBNI_IPV4.test(gostitelj) || /^f[cd][0-9a-f]{2}:/.test(gostitelj);
	if (url.protocol === "https:") return url;
	if (url.protocol === "http:" && lokalno) return url;
	return null;
}
/** Ali sme ta klic iti prek prehoda. Klici (vsebina klicatelja) samo z locenim soglasjem; sicer samo ob vklopu. */
function smePrekPrehoda(n, jeVsebinaKlica) {
	if (!n || n.vklop !== true) return false;
	if (!veljavenNaslovPrehoda(n.naslov)) return false;
	if (jeVsebinaKlica && n.klici !== true) return false;
	return true;
}
/** Naslov koncne tocke chat/completions (osnova je npr. http://localhost:20128/v1). */
function naslovKlica(n) {
	const url = veljavenNaslovPrehoda(n.naslov);
	if (!url) return null;
	return `${url.origin}${url.pathname.replace(/\/+$/, "")}/chat/completions`;
}
export { veljavenNaslovPrehoda, smePrekPrehoda, naslovKlica };
export type PrehodNastavitve = any;
