/**
 * Razclenjevanje in sestavljanje sporocil SIP (RFC 3261, prenos UDP). Ciste funkcije brez izjem.
 * Vsak datagram je nezaupan: omejitve velikosti, stevila glav, dolzine vrstice in skladnost Content-Length.
 */
import { napaka, uspeh, type Izid } from "./izid.ts";

export const SIP_OMEJITVE = {
  /** Najvec bajtov v enem datagramu SIP (RFC 3261 18.1.1 priporoca do 1300 B za UDP brez TCP; sprejmemo vec za vecje SDP). */
  najvecBajtov: 8192,
  /** Najvec vrstic glav (po zdruzitvi prelomljenih vrstic). */
  najvecGlav: 64,
  /** Najvec znakov v eni vrstici (zacetna vrstica ali glava). */
  najvecDolzinaVrstice: 1024,
  /** Najvec bajtov telesa (SDP). */
  najvecTelo: 4096,
} as const;

export type Glava = { ime: string; vrednost: string };

export type SipZahteva = {
  vrsta: "zahteva";
  metoda: string;
  uri: string;
  glave: Glava[];
  telo: string;
};

export type SipOdgovor = {
  vrsta: "odgovor";
  status: number;
  razlog: string;
  glave: Glava[];
  telo: string;
};

export type SipSporocilo = SipZahteva | SipOdgovor;

/** Kratke oblike imen glav (RFC 3261 7.3.3, 20). */
const KRATKA: Record<string, string> = {
  v: "via",
  f: "from",
  t: "to",
  i: "call-id",
  m: "contact",
  l: "content-length",
  c: "content-type",
  k: "supported",
  s: "subject",
  e: "content-encoding",
  o: "event",
  u: "allow-events",
  r: "refer-to",
  b: "referred-by",
  x: "session-expires",
};

const ZETON = /^[A-Za-z0-9\-.!%*_+`'~]+$/;
const OBVEZNE_ZAHTEVA = ["via", "from", "to", "call-id", "cseq"] as const;

/** Ime glave v enotni obliki (male crke, kratke oblike razsirjene). */
export function normaliziranoIme(ime: string): string {
  const m = ime.toLowerCase();
  return KRATKA[m] ?? m;
}

function najdiKonecGlav(b: Uint8Array): number {
  for (let i = 0; i + 3 < b.length; i++) {
    if (b[i] === 13 && b[i + 1] === 10 && b[i + 2] === 13 && b[i + 3] === 10) return i;
  }
  return -1;
}

/**
 * Razcleni datagram SIP. Nikoli ne vrze izjeme; nepravilno sporocilo vrne { ok: false }.
 * Content-Length: ce je, mora biti natancno dolzina telesa v bajtih (vec ali manj je zavrnjeno).
 */
export function razcleniSip(podatki: Uint8Array, omejitve: typeof SIP_OMEJITVE = SIP_OMEJITVE): Izid<SipSporocilo> {
  try {
    return razcleni(podatki, omejitve);
  } catch {
    // Varovalo: tudi nepricakovana napaka ne sme podreti odjemalca.
    return napaka("notranja napaka razclenjevanja");
  }
}

function razcleni(podatki: Uint8Array, omejitve: typeof SIP_OMEJITVE): Izid<SipSporocilo> {
  if (!(podatki instanceof Uint8Array)) return napaka("ni bajtov");
  if (podatki.length === 0) return napaka("prazno");
  if (podatki.length > omejitve.najvecBajtov) return napaka("prevelik datagram");
  const konec = najdiKonecGlav(podatki);
  if (konec < 0) return napaka("ni konca glav");
  const glavaDel = Buffer.from(podatki.buffer, podatki.byteOffset, konec).toString("utf8");
  const teloBajti = podatki.subarray(konec + 4);
  if (teloBajti.length > omejitve.najvecTelo) return napaka("preveliko telo");
  if (/[\0]/.test(glavaDel)) return napaka("nicelni znak v glavah");

  const vrstice = glavaDel.split("\r\n");
  const zacetna = vrstice[0] ?? "";
  if (zacetna.length === 0 || zacetna.length > omejitve.najvecDolzinaVrstice) return napaka("napacna zacetna vrstica");

  // Glave: zdruzi prelomljene vrstice (zacetek s presledkom ali tabulatorjem).
  const surove: string[] = [];
  for (let i = 1; i < vrstice.length; i++) {
    const v = vrstice[i] ?? "";
    if (v.length > omejitve.najvecDolzinaVrstice) return napaka("predolga vrstica");
    if (v.includes("\n") || v.includes("\r")) return napaka("osamljen konec vrstice");
    if (v.length === 0) return napaka("prazna vrstica v glavah");
    if (v[0] === " " || v[0] === "\t") {
      if (surove.length === 0) return napaka("prelom brez glave");
      const zdruzena = `${surove[surove.length - 1]} ${v.trim()}`;
      if (zdruzena.length > omejitve.najvecDolzinaVrstice) return napaka("predolga vrstica");
      surove[surove.length - 1] = zdruzena;
      continue;
    }
    surove.push(v);
    if (surove.length > omejitve.najvecGlav) return napaka("prevec glav");
  }

  const glave: Glava[] = [];
  for (const v of surove) {
    const dvopicje = v.indexOf(":");
    if (dvopicje <= 0) return napaka("glava brez dvopicja");
    const ime = v.slice(0, dvopicje).trim();
    if (!ZETON.test(ime)) return napaka("napacno ime glave");
    glave.push({ ime: normaliziranoIme(ime), vrednost: v.slice(dvopicje + 1).trim() });
  }

  // Content-Length: vse ponovitve morajo biti enake in enake dolzini telesa.
  const dolzine = glave.filter((g) => g.ime === "content-length").map((g) => g.vrednost);
  if (dolzine.length > 0) {
    if (dolzine.some((d) => !/^\d{1,6}$/.test(d))) return napaka("napacen Content-Length");
    if (new Set(dolzine.map(Number)).size !== 1) return napaka("razlicni Content-Length");
    if (Number(dolzine[0]) !== teloBajti.length) return napaka("Content-Length se ne ujema s telesom");
  }
  const telo = Buffer.from(teloBajti.buffer, teloBajti.byteOffset, teloBajti.length).toString("utf8");

  if (zacetna.startsWith("SIP/2.0 ")) {
    const m = /^SIP\/2\.0 ([1-6]\d\d) ([^\r\n]*)$/.exec(zacetna);
    if (!m) return napaka("napacna statusna vrstica");
    const cseq = preveriSkupne(glave, false);
    if (!cseq.ok) return napaka(cseq.napaka);
    return uspeh({ vrsta: "odgovor", status: Number(m[1]), razlog: m[2] ?? "", glave, telo });
  }
  const m = /^([A-Za-z0-9\-.!%*_+`'~]+) (\S+) SIP\/2\.0$/.exec(zacetna);
  if (!m) return napaka("napacna vrstica zahteve");
  const metoda = m[1] ?? "";
  const uri = m[2] ?? "";
  if (!/^sips?:/i.test(uri)) return napaka("nepodprt URI zahteve");
  const preverba = preveriSkupne(glave, true);
  if (!preverba.ok) return napaka(preverba.napaka);
  const cseqMetoda = preverba.vrednost;
  // ACK in CANCEL nosita metodo izvirne zahteve? Ne: CSeq ACK je "n ACK", CANCEL "n CANCEL" (RFC 3261 9.1, 17.1.1.3).
  if (cseqMetoda !== metoda) return napaka("metoda v CSeq se ne ujema");
  return uspeh({ vrsta: "zahteva", metoda, uri, glave, telo });
}

function preveriSkupne(glave: Glava[], zahteva: boolean): Izid<string> {
  for (const ime of OBVEZNE_ZAHTEVA) {
    if (!glave.some((g) => g.ime === ime)) {
      if (zahteva || ime !== "via") return napaka(`manjka glava ${ime}`);
    }
  }
  for (const ime of ["from", "to", "call-id", "cseq"]) {
    if (glave.filter((g) => g.ime === ime).length > 1) return napaka(`podvojena glava ${ime}`);
  }
  const cseq = razcleniCSeq(prvaGlava({ glave }, "cseq") ?? "");
  if (!cseq) return napaka("napacen CSeq");
  if (!(prvaGlava({ glave }, "call-id") ?? "").length) return napaka("prazen Call-ID");
  return uspeh(cseq.metoda);
}

export function razcleniCSeq(v: string): { stevilka: number; metoda: string } | null {
  const m = /^(\d{1,10})\s+([A-Za-z0-9\-.!%*_+`'~]+)$/.exec(v.trim());
  if (!m) return null;
  const stevilka = Number(m[1]);
  if (stevilka >= 2 ** 31) return null;
  return { stevilka, metoda: m[2] ?? "" };
}

export function prvaGlava(s: { glave: Glava[] }, ime: string): string | undefined {
  const iskano = normaliziranoIme(ime);
  return s.glave.find((g) => g.ime === iskano)?.vrednost;
}

/** Vse vrednosti glave; vejice zunaj narekovajev in <> locijo vec vrednosti (npr. vec Via v eni vrstici). */
export function vseVrednosti(s: { glave: Glava[] }, ime: string): string[] {
  const iskano = normaliziranoIme(ime);
  const izid: string[] = [];
  for (const g of s.glave) {
    if (g.ime !== iskano) continue;
    if (iskano === "www-authenticate" || iskano === "proxy-authenticate" || iskano === "authorization" || iskano === "proxy-authorization") {
      izid.push(g.vrednost);
      continue;
    }
    izid.push(...razdeliPoVejicah(g.vrednost));
  }
  return izid;
}

export function razdeliPoVejicah(v: string): string[] {
  const deli: string[] = [];
  let trenutni = "";
  let narekovaj = false;
  let kotni = false;
  for (let i = 0; i < v.length; i++) {
    const z = v[i];
    if (narekovaj && z === "\\" && i + 1 < v.length) {
      trenutni += z + v[i + 1];
      i++;
      continue;
    }
    if (z === '"') narekovaj = !narekovaj;
    else if (!narekovaj && z === "<") kotni = true;
    else if (!narekovaj && z === ">") kotni = false;
    if (z === "," && !narekovaj && !kotni) {
      if (trenutni.trim()) deli.push(trenutni.trim());
      trenutni = "";
      continue;
    }
    trenutni += z;
  }
  if (trenutni.trim()) deli.push(trenutni.trim());
  return deli;
}

/** Parametri za podpicjem (";tag=abc;rport"). Kljuci z malimi crkami; parameter brez vrednosti dobi "". */
export function parametri(v: string): Map<string, string> {
  const izid = new Map<string, string>();
  // Parametri po zapiralnem > (name-addr) ali po prvem ; (addr-spec brez <>).
  const zapiralni = v.lastIndexOf(">");
  const rep = zapiralni >= 0 ? v.slice(zapiralni + 1) : v.slice(Math.max(0, v.indexOf(";")));
  for (const del of rep.split(";")) {
    const d = del.trim();
    if (!d) continue;
    const enacaj = d.indexOf("=");
    if (enacaj < 0) izid.set(d.toLowerCase(), "");
    else izid.set(d.slice(0, enacaj).trim().toLowerCase(), d.slice(enacaj + 1).trim().replace(/^"(.*)"$/, "$1"));
  }
  return izid;
}

/** URI iz name-addr ("Ime" <sip:a@b>;tag=x) ali addr-spec (sip:a@b;tag=x). */
export function uriIzNaslova(v: string): string {
  const odpri = v.indexOf("<");
  const zapri = v.indexOf(">", odpri + 1);
  if (odpri >= 0 && zapri > odpri) return v.slice(odpri + 1, zapri).trim();
  return (v.split(";")[0] ?? "").trim();
}

export type ViaPodatki = { protokol: string; gostitelj: string; vrata: number | null; branch: string | null; parametri: Map<string, string> };

export function razcleniVia(v: string): ViaPodatki | null {
  const m = /^SIP\s*\/\s*2\.0\s*\/\s*([A-Za-z]+)\s+([^;\s]+)(.*)$/i.exec(v.trim());
  if (!m) return null;
  const naslov = m[2] ?? "";
  let gostitelj = naslov;
  let vrata: number | null = null;
  const v6 = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(naslov);
  if (v6) {
    gostitelj = v6[1] ?? "";
    vrata = v6[2] ? Number(v6[2]) : null;
  } else {
    const d = /^([^:]+)(?::(\d{1,5}))?$/.exec(naslov);
    if (!d) return null;
    gostitelj = d[1] ?? "";
    vrata = d[2] ? Number(d[2]) : null;
  }
  if (vrata !== null && (vrata < 1 || vrata > 65535)) return null;
  const p = parametri(`x${m[3] ?? ""}`);
  return { protokol: (m[1] ?? "").toUpperCase(), gostitelj, vrata, branch: p.get("branch") ?? null, parametri: p };
}

/** Sestavi datagram; Content-Length se vedno izracuna iz telesa (stara vrednost se zavrze). */
export function sestaviSip(s: SipSporocilo): Buffer {
  const telo = Buffer.from(s.telo, "utf8");
  const zacetna = s.vrsta === "zahteva" ? `${s.metoda} ${s.uri} SIP/2.0` : `SIP/2.0 ${s.status} ${s.razlog}`;
  const vrstice = [zacetna];
  for (const g of s.glave) {
    if (g.ime === "content-length") continue;
    if (/[\r\n]/.test(g.vrednost) || /[\r\n:]/.test(g.ime)) continue; // brez vrivanja glav
    vrstice.push(`${zapisIme(g.ime)}: ${g.vrednost}`);
  }
  vrstice.push(`Content-Length: ${telo.length}`);
  return Buffer.concat([Buffer.from(`${vrstice.join("\r\n")}\r\n\r\n`, "utf8"), telo]);
}

const ZAPIS: Record<string, string> = {
  via: "Via",
  from: "From",
  to: "To",
  "call-id": "Call-ID",
  cseq: "CSeq",
  contact: "Contact",
  "content-type": "Content-Type",
  "max-forwards": "Max-Forwards",
  "www-authenticate": "WWW-Authenticate",
  "proxy-authenticate": "Proxy-Authenticate",
  authorization: "Authorization",
  "proxy-authorization": "Proxy-Authorization",
  "user-agent": "User-Agent",
  "min-expires": "Min-Expires",
  "record-route": "Record-Route",
};

function zapisIme(ime: string): string {
  return ZAPIS[ime] ?? ime.replace(/(^|-)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
}

/** Odgovor na zahtevo po RFC 3261 8.2.6: kopija Via, From, To (z oznako), Call-ID, CSeq. */
export function odgovorNa(z: SipZahteva, status: number, razlog: string, dodatno: { toTag?: string; glave?: Glava[]; telo?: string } = {}): SipOdgovor {
  const glave: Glava[] = [];
  for (const g of z.glave) {
    if (g.ime === "via" || g.ime === "from" || g.ime === "call-id" || g.ime === "cseq") glave.push({ ...g });
    else if (g.ime === "to") {
      const imaTag = parametri(g.vrednost).has("tag");
      glave.push({ ime: "to", vrednost: imaTag || !dodatno.toTag || status === 100 ? g.vrednost : `${g.vrednost};tag=${dodatno.toTag}` });
    } else if (g.ime === "record-route" && status > 100 && status < 300) glave.push({ ...g });
  }
  glave.push(...(dodatno.glave ?? []));
  return { vrsta: "odgovor", status, razlog, glave, telo: dodatno.telo ?? "" };
}
