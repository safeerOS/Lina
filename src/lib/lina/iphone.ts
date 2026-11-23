// @ts-nocheck
// Rekonstruirano iz prevoda nameščene Line (20. 11. 2026): izvirni .ts je bil izbrisan; tipi niso ohranjeni.
function kazatiNamigZaVajo(stanje) {
	return !stanje.odprta && stanje.steviloKlicev === 0;
}
var PREVERJENI_OPERATERJI = [{
	id: "telekom",
	vklop: {
		neodgovor: "*61*",
		zasedeno: "*67*"
	},
	izklop: {},
	vir: "https://www.telekom.si/tehnik/tehnologija/kako-urediti-preusmeritev-klicev",
	preverjeno: "2026-11-11"
}, {
	id: "telemach",
	vklop: {
		neodgovor: "**61*",
		zasedeno: "**67*",
		nedosegljiv: "**62*"
	},
	izklop: {
		neodgovor: "##61#",
		zasedeno: "##67#",
		nedosegljiv: "##62#"
	},
	vir: "https://telemach.si/pomoc/mobilna-telefonija/mobilne-storitve",
	preverjeno: "2026-11-11"
}];
/** Niz za vklop, na primer **61*stevilka#. Stevilko vpise uporabnik sam, zato je to besedilo mesta. */
function nizZaVklop(predpona, mestoStevilke) {
	return `${predpona}${mestoStevilke}#`;
}
/** Vstavi vrednosti v besedilo z oznakami {ime}. Manjkajoca vrednost ostane kot oznaka (napaka je vidna, ne tiha). */
function vstavi(besedilo, vrednosti) {
	return besedilo.replace(/\{(\w+)\}/g, (cel, ime) => ime in vrednosti ? String(vrednosti[ime]) : cel);
}
/**
* Prvi koraki (AGENTS.md »Nastavitev mora biti zelo enostavna«: vsak korak en gumb in en stavek). Stanje vsakega koraka je iz
* pravih podatkov: možgani (shranjen ponudnik ali kljuc iz okolja), znanje (podjetje, izdelek ali besedilo znanja), vaja (vsaj
* en klic v dnevniku, enako kot kazatiNamigZaVajo) in odprta linija.
*/
function korakiNastavitve(stanje) {
	const c = stanje.catalog;
	const imaZnanje = Boolean(c.company.name?.trim()) || c.products.length > 0 || Boolean(c.znanje?.trim());
	return [
		{
			id: "mozgani",
			naslov: "uiKorakMozganiNaslov",
			opis: "uiKorakMozganiOpis",
			gumb: "uiKorakMozganiGumb",
			cilj: "nastavitve",
			koncan: stanje.mozganiNastavljeni
		},
		{
			id: "znanje",
			naslov: "uiKorakZnanjeNaslov",
			opis: "uiKorakZnanjeOpis",
			gumb: "uiKorakZnanjeGumb",
			cilj: "znanje",
			koncan: imaZnanje
		},
		{
			id: "vaja",
			naslov: "uiKorakVajaNaslov",
			opis: "uiKorakVajaOpis",
			gumb: "uiKorakVajaGumb",
			cilj: "linija",
			koncan: stanje.steviloKlicev > 0
		},
		{
			id: "linija",
			naslov: "uiKorakLinijaNaslov",
			opis: "uiKorakLinijaOpis",
			gumb: "uiKorakLinijaGumb",
			cilj: "linija",
			koncan: stanje.odprta
		}
	];
}
/** Oznaka stanja klica: vedno napis, barva je samo dodatek (dostopnost, crno-beli izpis). */
export { kazatiNamigZaVajo, PREVERJENI_OPERATERJI, nizZaVklop, vstavi, korakiNastavitve };
export type StanjeVaje = any;
/** Vrsta preusmeritve klicev pri operaterju (GSM: ob neodgovoru, zasedenosti ali nedosegljivosti). */
export type VrstaPreusmeritve = "neodgovor" | "zasedeno" | "nedosegljiv";
/** Preverjen operater: predpone za vklop (in izklop, ce je znan) po vrstah preusmeritve, vir in datum preverbe. */
export type Operater = {
  id: string;
  vklop: Partial<Record<VrstaPreusmeritve, string>>;
  izklop: Partial<Record<VrstaPreusmeritve, string>>;
  vir: string;
  preverjeno: string;
};
