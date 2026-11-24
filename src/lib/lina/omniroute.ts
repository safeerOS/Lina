// @ts-nocheck
// Rekonstruirano iz prevoda nameščene Line (20. 11. 2026): izvirni .ts je bil izbrisan; tipi niso ohranjeni.
/** Zanka IPv4 v CELOTI, da ime gostitelja kot 127.evil.example ne velja za ta racunalnik. */
var ZANKA_IPV4 = /^127(\.\d{1,3}){3}$/;
/**
 * http je dovoljen samo za zanko (ta racunalnik); vse drugo, tudi domace omrezje, samo https; brez gesla v naslovu.
 * Slepi pregled mozganov M8 (24. 11. 2026): po golem http v domacem omrezju bi kljuc prehoda (Bearer) in vsebina klicev potovala
 * nesifrirano (prisluskovanje, ARP); enako pravilo kot ponudnik OmniRoute (http samo zanka).
 */
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
	const lokalno = gostitelj === "localhost" || gostitelj === "::1" || ZANKA_IPV4.test(gostitelj);
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
/**
 * Naslov ponudnika OmniRoute v Mozganih (AGENTS.md »OmniRoute kot ponudnik mozganov«): strozje od prehoda - http SAMO za
 * 127.0.0.1 in localhost, vse drugo samo https. Vrne osnovo brez koncne poševnice (npr. http://127.0.0.1:20128/v1) ali null.
 */
function veljavenNaslovOmniroute(vnos) {
	const url = veljavenNaslovPrehoda(vnos);
	if (!url) return null;
	if (url.protocol === "http:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return null;
	return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
export { veljavenNaslovPrehoda, smePrekPrehoda, naslovKlica, veljavenNaslovOmniroute };
export type PrehodNastavitve = any;
export const OMNIROUTE_PRIVZETI_NASLOV = "http://127.0.0.1:20128/v1";
