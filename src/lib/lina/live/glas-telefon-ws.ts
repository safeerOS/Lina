// @ts-nocheck
// Rekonstruirano iz prevoda nameščene Line (20. 11. 2026): izvirni .ts je bil izbrisan; tipi niso ohranjeni.
var Spake2 = class Spake2 {
	moja;
	ke = null;
	kca = null;
	kcb = null;
	tt = null;
	w;
	x;
	jaz;
	oni;
	aad;
	strezniska;
	constructor(w, jaz, oni, aad, strezniska, x) {
		this.w = w;
		this.jaz = jaz;
		this.oni = oni;
		this.aad = aad;
		this.strezniska = strezniska;
		this.x = x ?? izBajtov(randomBytes(48)) % (115792089210356248762697446949407573529996955224135760342422259061068512044369n - 1n) + 1n;
		this.moja = sestej(pomnozi(this.x, G), pomnozi(this.w, strezniska ? TM : TN));
	}
	/** `x` je samo za preizkus (skupni vektorji TS <-> Kotlin): znan skalar namesto nakljucnega. */
	static odjemalec(koda, jaz, hub, aad = Buffer.alloc(0), sol = Buffer.alloc(0), x) {
		return new Spake2(wIzKode(koda, sol), Buffer.from(jaz), Buffer.from(hub), aad, false, x);
	}
	static streznik(koda, jaz, odjemalec, aad = Buffer.alloc(0), sol = Buffer.alloc(0), x) {
		return new Spake2(wIzKode(koda, sol), Buffer.from(jaz), Buffer.from(odjemalec), aad, true, x);
	}
	sporocilo() {
		return kodiraj(this.moja);
	}
	/** Skupni kljuc Ke in moja potrditev; neveljavna tocka je izjema. */
	zakljuci(njihovo) {
		const njihova = dekodiraj(njihovo);
		const k = pomnozi(this.x, sestej(njihova, negiraj(pomnozi(this.w, this.strezniska ? TN : TM))));
		if (!k) throw new Error("neveljaven skupni element");
		const [a, b, pa, pb] = this.strezniska ? [
			this.jaz,
			this.oni,
			this.moja,
			njihova
		] : [
			this.oni,
			this.jaz,
			njihova,
			this.moja
		];
		this.tt = Buffer.concat([
			dolz(a),
			dolz(b),
			dolz(kodiraj(pa)),
			dolz(kodiraj(pb)),
			dolz(kodiraj(k)),
			dolz(vBajte(mod(this.w, N)))
		]);
		const h = createHash("sha256").update(this.tt).digest();
		this.ke = h.subarray(0, 16);
		const kc = hkdf(h.subarray(16), Buffer.alloc(0), Buffer.concat([Buffer.from("ConfirmationKeys"), this.aad]), 32);
		this.kca = kc.subarray(0, 16);
		this.kcb = kc.subarray(16);
		const moj = this.strezniska ? this.kca : this.kcb;
		return {
			ke: this.ke,
			potrditev: createHmac("sha256", moj).update(this.tt).digest()
		};
	}
	preveri(njihovaPotrditev) {
		if (!this.tt) return false;
		const pricakovano = createHmac("sha256", this.strezniska ? this.kcb : this.kca).update(this.tt).digest();
		return njihovaPotrditev.length === pricakovano.length && timingSafeEqual(pricakovano, njihovaPotrditev);
	}
};
/**
* Seznanjanje telefona s 6-mestno kodo (lastnik 14. 11. 2026: koda se vnese na racunalniku ALI na telefonu, rezultat je isti
* kot s QR). Postopek je postopek Safeer Linka (core/link_hub_streznik.py: zacni_seznanitev, spake_korak1, spake_korak2):
* SPAKE2 (spake2.ts) s soljo pair_id in AAD = odtis potrdila TLS asistentke, varovalka kode (varovalka-kode.ts), koda velja
* KODA_VELJA_MS, najvec NAJVEC_POSKUSOV krogov in napacnih potrditev na prijavo.
*
* Nacin A: lastnik v Lini klikne »Povezi s kodo«, Lina pokaze kodo, telefon jo vtipka.
* Nacin B: telefon pokaze kodo, lastnik jo vtipka v Lini pri cakajocem telefonu.
* Oba nacina zahtevata, da je lastnik okno odprl (gumb); ena uspesna seznanitev okno zapre (koda za en telefon). Uspeh
* dostopa NE podeli: klicatelj (asistent-streznik) prijavo preda lastniku, ki jo doda z gumbom »Dodaj« (pogodba v AGENTS.md).
*/
/** Kot PIN_VELJA_S, NAJVEC_POSKUSOV in NAJVEC_CAKAJOCIH v core/link_hub_streznik.py. */
var KODA_VELJA_MS = 3e5;
/** Identiteta strani A v SPAKE2 (v Linku "safeer-link-hub"); stran B je id telefona. */
var ID_LINE = "lina-asistent";
var PAIR_ID = /^[A-Za-z0-9_-]{22}$/;
var KODA = /^\d{6}$/;
/** Predpona MAC, s katerim telefon kljuc naprave veze na skupni kljuc Ke (zamenjava kljuca v zahtevi ne gre skozi). */
var NIZ_MAC = "safeer-lina-koda-v1";
var NapakaKode = class extends Error {
	status;
	koda;
	constructor(status, koda, sporocilo) {
		super(sporocilo);
		this.status = status;
		this.koda = koda;
	}
};
function macKljuca(ke, pairId, id, kljuc) {
	return createHmac("sha256", ke).update(`${NIZ_MAC}\n${pairId}\n${id}\n${kljuc}`).digest();
}
/** Nova koda kot v Linku: 100000 + nakljucno < 900000 (vedno 6 mest). */
var novaKoda = () => String(1e5 + randomInt(9e5));
var SeznanitevSKodo = class {
	okno = null;
	pari = /* @__PURE__ */ new Map();
	varovalka;
	odtis;
	zdaj;
	koda;
	nakljucno;
	rok = null;
	/** Klic ob odprtju in zaprtju okna (uspeh, preklic, iztek): oglas DNS-SD tece samo vmes (mdns-oglas.server.ts). */
	obOdprtju;
	obZaprtju;
	/** `nakljucno` je SAMO za preizkus (skupni vektorji TS <-> Kotlin): znan pair_id in skalar SPAKE2 namesto nakljucnih. */
	constructor(o) {
		this.varovalka = o.varovalka;
		this.odtis = o.odtis;
		this.zdaj = o.zdaj ?? Date.now;
		this.koda = o.koda ?? novaKoda;
		this.nakljucno = o.nakljucno;
	}
	/** Lastnik odpre okno (gumb »Povezi s kodo«): nova koda za nacin A; prejsnja koda in prijave ne veljajo vec. */
	odpri() {
		this.pari.clear();
		this.okno = {
			koda: this.koda(),
			do: this.zdaj() + KODA_VELJA_MS,
			krogov: 0
		};
		if (this.rok) clearTimeout(this.rok);
		this.rok = setTimeout(() => this.odprto(), 300050);
		this.rok.unref?.();
		try {
			this.obOdprtju?.();
		} catch {}
		return {
			koda: this.okno.koda,
			do: this.okno.do
		};
	}
	zapri() {
		const bilo = !!this.okno;
		this.okno = null;
		this.pari.clear();
		if (this.rok) clearTimeout(this.rok);
		this.rok = null;
		if (bilo) try {
			this.obZaprtju?.();
		} catch {}
	}
	odprto() {
		if (this.okno && this.zdaj() >= this.okno.do) this.zapri();
		return !!this.okno;
	}
	pocisti() {
		const t = this.zdaj();
		for (const [k, p] of this.pari) if (t - p.cas > 3e5) this.pari.delete(k);
		else if (p.s && t - p.krogCas > 1e4) this.neuspel(p);
	}
	/** Krog brez potrditve: steje ze ob /koda/spake (krogov, varovalka); v nacinu B lastnik kodo vtipka znova. */
	neuspel(p) {
		p.s = null;
		if (p.naTelefonu) {
			p.koda = null;
			p.napacna = true;
		}
	}
	/** Telefon zacne prijavo; id in ime je klicatelj ze preveril. */
	zacni(vir, id, ime, naTelefonu) {
		if (!this.odprto()) throw new NapakaKode(403, "ni_odprto", "Na racunalniku najprej kliknite Povezi s kodo.");
		this.pocisti();
		if (this.pari.size >= 8) throw new NapakaKode(429, "prevec_cakajocih", "Prevec cakajocih prijav.");
		if (!this.varovalka.zacetek(vir, true)) throw new NapakaKode(429, "seznanitev_zaprta", "Povezovanje s kodo je zaradi prevec poskusov zaprto.");
		const pairId = this.nakljucno?.pairId?.() ?? randomBytes(16).toString("base64url");
		this.pari.set(pairId, {
			id,
			ime,
			vir,
			cas: this.zdaj(),
			naTelefonu,
			koda: null,
			krogov: 0,
			napak: 0,
			s: null,
			krogCas: 0,
			napacna: false
		});
		return {
			pair_id: pairId,
			nacin: "spake2",
			hub_id: ID_LINE,
			fp: this.odtis(),
			expires_in_seconds: Math.max(0, Math.trunc((this.okno.do - this.zdaj()) / 1e3))
		};
	}
	/** Telefoni nacina B, ki cakajo, da lastnik vtipka kodo z njihovega zaslona. */
	cakajoKodo() {
		if (!this.odprto()) return [];
		this.pocisti();
		return [...this.pari].filter(([, p]) => p.naTelefonu && p.koda === null).map(([pairId, p]) => ({
			pairId,
			id: p.id,
			ime: p.ime,
			napacna: p.napacna
		}));
	}
	/** Lastnik vtipka kodo, ki jo kaze telefon (nacin B). */
	vnesiKodo(pairId, koda) {
		const p = this.odprto() ? this.pari.get(pairId) : void 0;
		if (!p || !p.naTelefonu || p.koda !== null) throw new Error("Ta telefon ne caka vec na kodo.");
		const k = koda.replace(/\s+/g, "");
		if (!KODA.test(k)) throw new Error("Koda ima 6 stevk.");
		p.koda = k;
		p.napacna = false;
	}
	par(pairId, id) {
		this.pocisti();
		const p = this.odprto() ? this.pari.get(pairId) : void 0;
		if (!p || p.id !== id) throw new NapakaKode(404, "prijava_ne_obstaja", "Prijava ne obstaja ali je potekla.");
		return p;
	}
	/** En krog SPAKE2 = en poskus kode (tudi v skupni varovalki). Vrne pA in potrditev cA. */
	spake(pairId, id, pb) {
		const p = this.par(pairId, id);
		const okno = this.okno;
		const koda = p.naTelefonu ? p.koda : okno.koda;
		if (koda === null) throw new NapakaKode(409, "caka_kodo", "Lastnik kode s telefona se ni vtipkal.");
		p.krogov += 1;
		if (!p.naTelefonu) okno.krogov += 1;
		if (p.krogov > 5 || okno.krogov > 10) {
			this.pari.delete(pairId);
			if (okno.krogov > 10) this.zapri();
			throw new NapakaKode(429, "prevec_poskusov", "Prevec poskusov; na racunalniku kliknite Povezi s kodo znova.");
		}
		if (!this.varovalka.poskus(p.vir, true)) {
			this.pari.delete(pairId);
			throw new NapakaKode(429, "seznanitev_zaprta", "Povezovanje s kodo je zaradi prevec poskusov zaprto.");
		}
		try {
			const s = Spake2.streznik(koda, ID_LINE, p.id, Buffer.from(this.odtis(), "utf8"), Buffer.from(pairId, "utf8"), this.nakljucno?.skalar?.());
			const { potrditev } = s.zakljuci(pb);
			p.s = s;
			p.krogCas = this.zdaj();
			return {
				pa: s.sporocilo(),
				ca: potrditev
			};
		} catch {
			p.s = null;
			throw new NapakaKode(400, "neveljavna_tocka", "Tocka pB ni veljavna.");
		}
	}
	/**
	* Potrditev telefona cB in MAC kljuca naprave s Ke. Uspeh pomeni isto kodo IN isto potrdilo TLS (AAD); okno se zapre
	* (ena koda, en telefon). Vrne Ke za klicatelja; dostopa ne podeli.
	*/
	potrdi(pairId, id, kljuc, cb, mac) {
		const p = this.par(pairId, id);
		const s = p.s;
		p.s = null;
		if (!s || !s.ke) throw new NapakaKode(409, "manjka_korak", "Najprej korak spake.");
		const pricakovan = macKljuca(s.ke, pairId, id, kljuc);
		if (!(s.preveri(cb) && mac.length === pricakovan.length && timingSafeEqual(mac, pricakovan))) {
			p.napak += 1;
			if (p.napak >= 5) {
				this.pari.delete(pairId);
				throw new NapakaKode(429, "prevec_poskusov", "Prevec poskusov; na racunalniku kliknite Povezi s kodo znova.");
			}
			this.neuspel(p);
			throw new NapakaKode(401, "napacna_koda", "Koda ni prava.");
		}
		this.varovalka.uspeh(p.vir);
		this.zapri();
	}
	/**
	* Telefon javi, da cA ni veljal (napacna koda ali drug odtis): isto kot iztek ROK_POTRDI_MS, le takoj. Krog je ze stet;
	* odpoved ne podeli nicesar in ne vrne poskusa.
	*/
	odpovej(pairId, id) {
		const p = this.par(pairId, id);
		if (!p.s) throw new NapakaKode(409, "manjka_korak", "Ni kroga za odpoved.");
		this.neuspel(p);
	}
	stanje() {
		const o = this.odprto() ? this.okno : null;
		return {
			odprto: !!o,
			koda: o?.koda ?? "",
			do: o?.do ?? 0,
			cakajoKodo: this.cakajoKodo()
		};
	}
};
/**
* Koncna tocka asistentke za telefon (lastnik 13.-14. 11. 2026; NALOGA-lina-kanal-claude-code.md 3b): telefon v ozjem krogu
* Safeer Linka poslje PODPISANO nalogo, odobritev ali ustavitev (nizi iz kanal-claude.ts, Kotlin: si.safeer.lina.podpis);
* Lina jih preveri in preda izvajalcu (IzvajalecClaudeCode), telefon pa bere dogodke (izid, zahteve za odobritev).
*
* Pot ni nova: kot povezava telefon <-> OpenLine na racunalniku (openline/server: lan.ts, tls.ts, tls-pin.ts) - HTTPS s
* samopodpisanim potrdilom, telefon pripne odtis SHA-256 lista (PinnedHttp, TlsPin), brez preusmeritev, streznik samo na
* 127.0.0.1 ali zasebnem naslovu domacega omrezja (nikoli 0.0.0.0 ali javni IP). Locen streznik od poti klica (tajnica):
* nobena datoteka poti klica ga ne uvaza (preizkus v kanal-claude.test.ts).
*
* Dostop: vsako dejanje podpise naprava s seznama kanala (kanal-claude.json, isti javni kljuci); cas v oknu 2 min, ne pred
* zagonom; enkratni niz. Dogodke bere samo, kdor pozna id naloge (vsaj 128 bitov, poslan samo prek pripetega TLS) - telefon,
* ki jo je dal. Pogodba (poti, JSON, napake) je v AGENTS.md (»Koncna tocka asistentke za telefon«).
*/
export { Spake2, KODA_VELJA_MS, ID_LINE, PAIR_ID, KODA, NIZ_MAC, NapakaKode, macKljuca, novaKoda, SeznanitevSKodo };
