// @ts-nocheck
// Rekonstruirano iz prevoda nameščene Line (20. 11. 2026): izvirni .ts je bil izbrisan; tipi niso ohranjeni.
import type { CallSession } from "./types.ts";
var MEJA_STIKOV = 1e3;
var MEJA_IMENA = 80;
var MEJA_OPOMBE = 300;
/** Telefon v primerljivo obliko: samo stevke in vodilni +; 00 -> +, vodilna 0 -> +386 (slovenska stevilka). */
function normalizirajTelefon(vhod) {
	let s = vhod.trim().replace(/[^\d+]/g, "");
	if (s.startsWith("00")) s = `+${s.slice(2)}`;
	else if (/^0\d/.test(s)) s = `+386${s.slice(1)}`;
	return (s.startsWith("+") ? "+" : "") + s.replace(/\D/g, "");
}
function ocistiStik(vhod) {
	const ime = typeof vhod.ime === "string" ? vhod.ime.replace(/\s+/g, " ").trim() : "";
	const telefon = typeof vhod.telefon === "string" ? normalizirajTelefon(vhod.telefon) : "";
	const opomba = typeof vhod.opomba === "string" ? vhod.opomba.trim() : "";
	if (!ime) return "Vpišite ime stika.";
	if (ime.length > MEJA_IMENA) return `Ime je predolgo (največ ${MEJA_IMENA} znakov).`;
	if (telefon.replace(/\D/g, "").length < 6) return "Vpišite veljavno telefonsko številko.";
	if (opomba.length > MEJA_OPOMBE) return `Opomba je predolga (največ ${MEJA_OPOMBE} znakov).`;
	return {
		ime,
		telefon,
		opomba
	};
}
function poisciStik(imenik, telefon) {
	const t = normalizirajTelefon(telefon);
	if (t.replace(/\D/g, "").length < 6) return void 0;
	return imenik.find((s) => s.telefon === t);
}
function kajJeHotel(c) {
	const o = c.order;
	const delo = [
		o.quantity ? `${o.quantity}×` : "",
		o.productName ?? o.requestedProduct ?? "",
		o.materialName ?? o.requestedMaterial ?? ""
	].filter(Boolean).join(" ").trim();
	const zelel = c.povzetek?.zelel && c.povzetek.zelel !== "Ni povedal izdelka." ? c.povzetek.zelel : "";
	const besede = c.transcript.filter((l) => l.role === "stranka").map((l) => l.text).sort((a, b) => b.length - a.length)[0] ?? "";
	const besedilo = (o.povprasevanje || delo || zelel || besede || o.notes || "").replace(/\s+/g, " ").trim();
	return besedilo.length > 160 ? `${besedilo.slice(0, 157)}…` : besedilo;
}
/** Prevzeti klici za zacetno stran: najnovejsi najprej, brez vaj, ime iz imenika ima prednost. */
function kliciZaPrikaz(klici: CallSession[], imenik: StikImenik[], najvec = 20) {
	return klici.filter((c) => !c.vaja).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, najvec).map((c) => {
		const telefon = normalizirajTelefon(c.stik?.telefon || c.order.phone || c.from || "");
		const stik = poisciStik(imenik, telefon);
		const ime = stik?.ime || c.stik?.ime || c.order.customerName || c.povzetek?.kdo || "";
		return {
			sid: c.callSid,
			kdaj: c.updatedAt,
			ime,
			telefon,
			shranjen: Boolean(stik),
			kaj: kajJeHotel(c),
			zakljucen: c.status === "zakljucen"
		};
	});
}
/** Koliko klicev je novih od zadnjega ogleda (ISO cas); brez ogleda so vsi novi. */
function steviloNovih(klici, zadnjiOgled) {
	if (!zadnjiOgled) return klici.length;
	return klici.filter((k) => k.kdaj > zadnjiOgled).length;
}
export { steviloNovih, ocistiStik, kliciZaPrikaz, normalizirajTelefon, MEJA_STIKOV };
export type StikImenik = any;
export type VhodStika = any;
