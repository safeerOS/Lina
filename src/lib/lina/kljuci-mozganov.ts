import { createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { izpeljiKljucOvoja, odpakiraj, zapakiraj, type Ovojnica } from "./kljuci-sinhron.ts";

/**
 * Kljuci za mozgane na vseh seznanjenih napravah (lastnik 26. 11. 2026, NALOGA-35): vec kljucev hkrati (tudi istega ponudnika, z
 * oznako), dodan, spremenjen ali odstranjen kljuc gre na vse naprave. Cista logika (brez diska in omrezja); enako v Kotlinu
 * (samostojna/KljuciMozganov.kt), skupni vektorji v obeh preizkusih.
 *
 * Pravilo kot Safeer secrets.sync (core/uskladitev_kljucev_pravila.py): velja novejsi po (cas, naprava, izbrisan); izbris je grob.
 * Brez izgube: vrednost, ki je zmagovalec ni videl (prej != njena razlicica), ostane kot nov zapis z oznako »(spor)«; id kopije je
 * izpeljan, zato vse naprave pridejo do istega nabora ne glede na vrstni red sporocil.
 */
export const PONUDNIKI_KLJUCEV = ["gemini", "openai", "claude", "grok", "openrouter"] as const;
export type PonudnikKljuca = (typeof PONUDNIKI_KLJUCEV)[number];
export const jePonudnikKljuca = (v: unknown): v is PonudnikKljuca => typeof v === "string" && (PONUDNIKI_KLJUCEV as readonly string[]).includes(v);

/** Cas uvozenega kljuca (obstajal pred prvo uskladitvijo): vsaka kasnejsa sprememba ga preglasi (Safeer CAS_UVOZA). */
export const CAS_UVOZA = 1;
/** Cas iz prihodnosti (napacna ura druge naprave) najvec toliko naprej (Safeer NAJVEC_NAPREJ_MS). */
export const NAJVEC_NAPREJ_MS = 10 * 60 * 1000;
/** Meje: odgovor mora ostati pod 64 KiB telefona (zapis z ovojnico ~400 B, grob ~200 B). */
export const NAJVEC_ZIVIH = 40;
export const NAJVEC_GROBOV = 100;
export const NAJVEC_OZNAKA = 40;
const ID = /^[0-9a-f]{16}$/;
const NAPRAVA = /^[A-Za-z0-9._-]{1,80}$/;
const PREJ = /^$|^[0-9]{1,16}\/[A-Za-z0-9._-]{1,80}$/;

export type ZapisKljuca = {
  id: string;
  ponudnik: PonudnikKljuca;
  oznaka: string;
  /** ms; CAS_UVOZA za uvozenega */
  cas: number;
  /** id naprave, ki je zapis nazadnje spremenila */
  naprava: string;
  izbrisan: boolean;
  /** razlicica, ki jo je ta sprememba zamenjala (»cas/naprava«), "" za nov zapis */
  prej: string;
  /** "" pri grobu */
  vrednost: string;
};

export const razlicica = (z: Pick<ZapisKljuca, "cas" | "naprava">): string => `${z.cas}/${z.naprava}`;

export function novejsi(a: Pick<ZapisKljuca, "cas" | "naprava" | "izbrisan">, b: Pick<ZapisKljuca, "cas" | "naprava" | "izbrisan">): boolean {
  if (a.cas !== b.cas) return a.cas > b.cas;
  if (a.naprava !== b.naprava) return a.naprava > b.naprava;
  return a.izbrisan && !b.izbrisan;
}

export function veljavnaOznaka(o: unknown): o is string {
  // eslint-disable-next-line no-control-regex
  return typeof o === "string" && o.trim().length > 0 && o.length <= NAJVEC_OZNAKA && !/[\x00-\x1F\x7F\u2028\u2029\u202A-\u202E\u2066-\u2069]/.test(o);
}

/** Kljuc API: samo natisljiv ASCII brez presledka (enako v Kotlinu - \\s se med JS in Androidom razlikuje). */
export function veljavnaVrednost(v: unknown): v is string {
  return typeof v === "string" && /^[\x21-\x7E]{8,400}$/.test(v);
}

/** Zapis, ki ga ta naprava sprejme; vse drugo se prezre (nikoli ne podre uskladitve). */
export function veljavenZapis(z: unknown, zdaj: number): z is ZapisKljuca {
  if (!z || typeof z !== "object") return false;
  const o = z as Record<string, unknown>;
  const dovoljena = new Set(["id", "ponudnik", "oznaka", "cas", "naprava", "izbrisan", "prej", "vrednost"]);
  if (Object.keys(o).some((k) => !dovoljena.has(k))) return false;
  if (typeof o.id !== "string" || !ID.test(o.id) || !jePonudnikKljuca(o.ponudnik) || !veljavnaOznaka(o.oznaka)) return false;
  if (typeof o.cas !== "number" || !Number.isSafeInteger(o.cas) || o.cas < CAS_UVOZA || o.cas > zdaj + NAJVEC_NAPREJ_MS) return false;
  if (typeof o.naprava !== "string" || !NAPRAVA.test(o.naprava) || typeof o.prej !== "string" || !PREJ.test(o.prej)) return false;
  if (typeof o.izbrisan !== "boolean") return false;
  return o.izbrisan ? o.vrednost === "" : veljavnaVrednost(o.vrednost);
}

export const idSpora = (z: Pick<ZapisKljuca, "id" | "cas" | "naprava">): string =>
  createHash("sha256").update(`lina-kljuci-spor-v1|${z.id}|${z.cas}|${z.naprava}`, "utf8").digest("hex").slice(0, 16);

export function oznakaSpora(oznaka: string): string {
  const pripona = " (spor)";
  return oznaka.endsWith(pripona) ? oznaka : `${oznaka.slice(0, NAJVEC_OZNAKA - pripona.length).trimEnd()}${pripona}`;
}

/** Zgubljena vrednost brez izgube: kopija z izpeljanim id (enaka na vseh napravah), brez povezave na prejsnje razlicice. */
function kopijaSpora(z: ZapisKljuca): ZapisKljuca {
  return { ...z, id: idSpora(z), oznaka: oznakaSpora(z.oznaka), prej: "" };
}

/** Ali zgubljeni zapis nosi vrednost, ki je zmagovalec ni videl (hkratna sprememba). */
function izgubljenaVrednost(zmagovalec: ZapisKljuca, porazen: ZapisKljuca): boolean {
  if (porazen.izbrisan) return false;
  if (!zmagovalec.izbrisan && zmagovalec.vrednost === porazen.vrednost) return false;
  return zmagovalec.prej !== razlicica(porazen);
}

export type IzidZdruzitve = { zapisi: ZapisKljuca[]; spremenjeni: string[]; spori: string[] };

/**
 * Zdruzi prejete zapise v lokalne. Neveljavni prejeti se prezrejo. Rezultat je urejen po id (enak na vseh napravah).
 * [kopije]: kopije spora dela samo racunalnik (zvezdisce), ki od telefona dobi samo NEPOSLANE spremembe; telefon dobi celoten nabor
 * racunalnika, njegova zastarela razlicica pa ni hkratna sprememba (sicer bi nastala lazna kopija).
 * shortcut: meja zivih zapisov zavrne NOVE id nad mejo; grobovi nad mejo izpadejo najstarejsi (star grob lahko obudi zapis naprave,
 * ki je bila izklopljena dlje kot NAJVEC_GROBOV izbrisov) - ce bi bilo to pogosto, grobovi z rokom namesto stevila.
 * shortcut: telefon, ki je spremembo poslal, a odgovora ni dobil, jo poslje znova; ce se je vmes zapis dvakrat spremenil drugje,
 * nastane odvecna kopija spora (nic se ne izgubi) - za natancnost bi racunalnik hranil zadnje razlicice vsakega id.
 */
export function zdruzi(lokalni: readonly ZapisKljuca[], prejeti: readonly unknown[], zdaj: number, kopije = true): IzidZdruzitve {
  const m = new Map(lokalni.map((z) => [z.id, z]));
  const spremenjeni = new Set<string>();
  const spori: string[] = [];
  const zivih = () => [...m.values()].filter((z) => !z.izbrisan).length;
  const dodaj = (z: ZapisKljuca): boolean => {
    if (m.has(z.id)) return false;
    if (!z.izbrisan && zivih() >= NAJVEC_ZIVIH) return false;
    m.set(z.id, z);
    spremenjeni.add(z.id);
    return true;
  };
  for (const surov of prejeti.slice(0, NAJVEC_ZIVIH + NAJVEC_GROBOV)) {
    if (!veljavenZapis(surov, zdaj)) continue;
    const z: ZapisKljuca = { ...surov };
    const l = m.get(z.id);
    if (!l) {
      dodaj(z);
      continue;
    }
    if (l.ponudnik !== z.ponudnik) continue; // id ne menja ponudnika (kljuc enega ponudnika ne sme k drugemu)
    if (razlicica(l) === razlicica(z) && l.izbrisan === z.izbrisan) continue;
    const zmaga = novejsi(z, l);
    const [zm, po] = zmaga ? [z, l] : [l, z];
    if (kopije && izgubljenaVrednost(zm, po) && dodaj(kopijaSpora(po))) spori.push(idSpora(po));
    if (zmaga) {
      m.set(z.id, z);
      spremenjeni.add(z.id);
    }
  }
  const grobovi = [...m.values()].filter((z) => z.izbrisan).sort((a, b) => b.cas - a.cas || (a.id < b.id ? -1 : 1));
  for (const g of grobovi.slice(NAJVEC_GROBOV)) m.delete(g.id);
  const zapisi = [...m.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { zapisi, spremenjeni: [...spremenjeni].filter((id) => m.has(id)), spori };
}

export const novCas = (zdaj: number, prejsnji: number): number => Math.max(zdaj, prejsnji + 1);
export const novId = (): string => randomBytes(8).toString("hex");

export type Sloti = Partial<Record<PonudnikKljuca, string>>;
export type Aktivni = Partial<Record<PonudnikKljuca, string>>;
/** aktivni[p] = BREZ: kljuc v uporabi je bil odstranjen; prazno mesto se NE zapolni samo z drugim kljucem (brez samodejnega preklopa). */
export const BREZ = "-";

/**
 * Lastne spremembe: [sloti] = kljuc, ki ga ta naprava ta hip uporablja za ponudnika (obstojeca shramba: ponudniki.json / Keystore).
 * Primerja jih z aktivnim zapisom ponudnika: nov ali drugacen kljuc = sprememba (ali uvoz ob [uvoz]), prazen slot ob zivem zapisu =
 * lokalna odstranitev. Isti kljuc istega ponudnika, ki ze obstaja (npr. s telefona), ne naredi dvojnika (primerja vrednost, ne zgostitev).
 */
export function lokalneSpremembe(
  zapisi: readonly ZapisKljuca[],
  aktivni: Aktivni,
  sloti: Sloti,
  jaz: string,
  zdaj: number,
  uvoz: boolean,
  privzetaOznaka: (p: PonudnikKljuca) => string,
  neznani: ReadonlySet<PonudnikKljuca> = new Set(),
): { zapisi: ZapisKljuca[]; aktivni: Aktivni; spremenjeni: string[] } {
  const m = new Map(zapisi.map((z) => [z.id, z]));
  const akt: Aktivni = { ...aktivni };
  const spremenjeni: string[] = [];
  for (const p of PONUDNIKI_KLJUCEV) {
    // slot, ki ga ta hip ni mogoce prebrati (zamenjan glavni kljuc, Keystore): ni ne sprememba ne izbris (Safeer »neznani«)
    if (neznani.has(p)) continue;
    const v = sloti[p];
    const a = akt[p] !== undefined ? m.get(akt[p] as string) : undefined;
    if (v !== undefined && v !== "") {
      if (!veljavnaVrednost(v)) continue;
      if (a && !a.izbrisan && a.vrednost === v) continue;
      const enak = [...m.values()].find((z) => z.ponudnik === p && !z.izbrisan && z.vrednost === v);
      if (enak) {
        akt[p] = enak.id;
        continue;
      }
      if (a && !a.izbrisan) {
        const n: ZapisKljuca = { ...a, cas: novCas(zdaj, a.cas), naprava: jaz, prej: razlicica(a), vrednost: v };
        m.set(a.id, n);
        spremenjeni.push(a.id);
        continue;
      }
      if ([...m.values()].filter((z) => !z.izbrisan).length >= NAJVEC_ZIVIH) continue;
      const n: ZapisKljuca = { id: novId(), ponudnik: p, oznaka: privzetaOznaka(p), cas: uvoz ? CAS_UVOZA : zdaj, naprava: jaz, izbrisan: false, prej: "", vrednost: v };
      m.set(n.id, n);
      akt[p] = n.id;
      spremenjeni.push(n.id);
    } else if (a && !a.izbrisan) {
      m.set(a.id, { ...a, cas: novCas(zdaj, a.cas), naprava: jaz, izbrisan: true, prej: razlicica(a), vrednost: "" });
      spremenjeni.push(a.id);
    }
  }
  return { zapisi: [...m.values()], aktivni: akt, spremenjeni };
}

export type Uporaba = {
  /** novi sloti (samo spremenjeni): vrednost = vpisi, null = odstrani (oddaljen izbris kljuca v uporabi) */
  sloti: Partial<Record<PonudnikKljuca, string | null>>;
  aktivni: Aktivni;
  /** ponudniki, katerih kljuc v uporabi je bil odstranjen na drugi napravi (vidno obvestilo; brez samodejnega preklopa) */
  odstranjeni: PonudnikKljuca[];
};

/**
 * Kaj iz nabora gre v sloto te naprave. Prejet zapis NIKOLI ne izbere ponudnika za klice ali asistentko in ne doda rezervnega
 * ponudnika (B9): spremeni samo kljuc ze aktivnega zapisa, ga odstrani ob izbrisu ali zapolni PRAZNO mesto ponudnika.
 */
export function zaUporabo(zapisi: readonly ZapisKljuca[], aktivni: Aktivni, sloti: Sloti, neznani: ReadonlySet<PonudnikKljuca> = new Set()): Uporaba {
  const m = new Map(zapisi.map((z) => [z.id, z]));
  const akt: Aktivni = { ...aktivni };
  const izid: Uporaba = { sloti: {}, aktivni: akt, odstranjeni: [] };
  for (const p of PONUDNIKI_KLJUCEV) {
    if (neznani.has(p)) continue;
    const a = akt[p] !== undefined ? m.get(akt[p] as string) : undefined;
    const v = sloti[p] ?? "";
    if (a && a.izbrisan) {
      akt[p] = BREZ;
      if (v !== "") {
        izid.sloti[p] = null;
        izid.odstranjeni.push(p);
      }
      continue;
    }
    if (a) {
      if (a.vrednost !== v) izid.sloti[p] = a.vrednost;
      continue;
    }
    if (v !== "") continue; // slot brez zapisa: lokalna sprememba jo zajame (lokalneSpremembe), ne prepisemo je
    if (akt[p] === BREZ) continue; // po odstranitvi kljuca v uporabi lastnik izbere sam (slepi pregled S1)
    const kandidat = [...m.values()].filter((z) => z.ponudnik === p && !z.izbrisan).reduce<ZapisKljuca | undefined>((a, b) => (!a || novejsi(b, a) ? b : a), undefined);
    if (kandidat) {
      akt[p] = kandidat.id;
      izid.sloti[p] = kandidat.vrednost;
    }
  }
  return izid;
}

// ---- Koraka protokola (racunalnik = zvezdisce, telefon pošlje samo neposlane spremembe) ------------------------------------

export type StanjeNabora = { zapisi: ZapisKljuca[]; aktivni: Aktivni; uvozeno: boolean };
export type StanjeTelefona = StanjeNabora & { neposlani: string[] };

/** Racunalnik ob zahtevi telefona ali spremembi v vmesniku: lastne spremembe, prejeti zapisi (s kopijami spora), uporaba v slotih. */
export function korakRacunalnika(
  st: StanjeNabora,
  sloti: Sloti,
  prejeti: readonly unknown[],
  jaz: string,
  zdaj: number,
  privzetaOznaka: (p: PonudnikKljuca) => string,
  neznani: ReadonlySet<PonudnikKljuca> = new Set(),
): { stanje: StanjeNabora; uporaba: Uporaba; spori: string[] } {
  const l = lokalneSpremembe(st.zapisi, st.aktivni, sloti, jaz, zdaj, !st.uvozeno, privzetaOznaka, neznani);
  const z = zdruzi(l.zapisi, prejeti, zdaj, true);
  const uporaba = zaUporabo(z.zapisi, l.aktivni, sloti, neznani);
  // ob neberljivem slotu uvoz se ni koncan (ta kljuc bi sicer ob prvem branju dobil cas zdaj namesto CAS_UVOZA)
  return { stanje: { zapisi: z.zapisi, aktivni: uporaba.aktivni, uvozeno: st.uvozeno || neznani.size === 0 }, uporaba, spori: z.spori };
}

/** Telefon pred zahtevo: lastne spremembe -> kaj poslati. Pred prvo izmenjavo ne uvaza (najprej dobi nabor, da ne podvoji kljuca). */
export function pripraviTelefon(st: StanjeTelefona, sloti: Sloti, jaz: string, zdaj: number, privzetaOznaka: (p: PonudnikKljuca) => string): { stanje: StanjeTelefona; poslji: ZapisKljuca[] } {
  if (!st.uvozeno) return { stanje: st, poslji: [] };
  const l = lokalneSpremembe(st.zapisi, st.aktivni, sloti, jaz, zdaj, false, privzetaOznaka);
  const neposlani = [...new Set([...st.neposlani, ...l.spremenjeni])];
  const m = new Map(l.zapisi.map((z) => [z.id, z]));
  return { stanje: { ...st, zapisi: l.zapisi, aktivni: l.aktivni, neposlani }, poslji: neposlani.flatMap((id) => (m.has(id) ? [m.get(id) as ZapisKljuca] : [])) };
}

/**
 * Telefon po odgovoru: nabor racunalnika velja (zvezdisce), plus lastne spremembe, ki jih racunalnik se ni videl (zavrnjene ali
 * izgubljene). Ob prvi izmenjavi uvoz obstojecih kljucev (isti kljuc = isti zapis). [slotiPrej] = sloti ob pripravi zahteve,
 * [slotiZdaj] = sloti zdaj: kljuc, ki ga je lastnik spremenil MED izmenjavo, se ne prepise (znova = se en krog, ki ga zajame).
 */
export function poOdgovoruTelefona(
  st: StanjeTelefona,
  poslani: readonly ZapisKljuca[],
  odgovor: readonly unknown[],
  slotiPrej: Sloti,
  slotiZdaj: Sloti,
  jaz: string,
  zdaj: number,
  privzetaOznaka: (p: PonudnikKljuca) => string,
): { stanje: StanjeTelefona; uporaba: Uporaba; znova: boolean } {
  const nabor = zdruzi([], odgovor, zdaj, false).zapisi;
  const potrjeni = new Set(poslani.filter((p) => nabor.some((z) => z.id === p.id && razlicica(z) === razlicica(p) && z.izbrisan === p.izbrisan)).map((p) => p.id));
  const vNaboru = new Set(nabor.map((z) => z.id));
  // zivi zapis telefona, ki ga racunalnik nima (nov ali obnovljen racunalnik, izgubljena datoteka): ne zavrzi ga, poslji ga znova
  const svoji = st.zapisi.filter((z) => (st.neposlani.includes(z.id) && !potrjeni.has(z.id)) || (!z.izbrisan && !vNaboru.has(z.id)));
  const z = zdruzi(nabor, svoji, zdaj, false);
  // svoja sprememba, ki jo je nabor preglasil (novejsa drugje), ni vec neposlana; tista, ki je zmagala, ostane za naslednji krog
  let neposlani = svoji.filter((s) => z.zapisi.some((x) => x.id === s.id && razlicica(x) === razlicica(s) && x.izbrisan === s.izbrisan)).map((s) => s.id);
  let zapisi = z.zapisi;
  const uporaba = zaUporabo(zapisi, st.aktivni, slotiPrej);
  let znova = neposlani.length > 0;
  for (const p of PONUDNIKI_KLJUCEV) {
    if ((slotiZdaj[p] ?? "") === (slotiPrej[p] ?? "")) continue;
    delete uporaba.sloti[p];
    uporaba.odstranjeni = uporaba.odstranjeni.filter((x) => x !== p);
    znova = true;
  }
  if (!st.uvozeno) {
    // prvi krog: obstojeci kljuci telefona (pravilo naloge 28 - ostanejo) gredo v nabor; enak kljuc se pripne na obstojeci zapis
    const efektivni: Sloti = { ...slotiPrej };
    for (const [p, v] of Object.entries(uporaba.sloti) as Array<[PonudnikKljuca, string | null]>) {
      if (v === null) delete efektivni[p];
      else efektivni[p] = v;
    }
    const l = lokalneSpremembe(zapisi, uporaba.aktivni, efektivni, jaz, zdaj, true, privzetaOznaka);
    zapisi = l.zapisi;
    uporaba.aktivni = l.aktivni;
    neposlani = [...new Set([...neposlani, ...l.spremenjeni])];
    znova = znova || l.spremenjeni.length > 0;
  }
  return { stanje: { zapisi, aktivni: uporaba.aktivni, uvozeno: true, neposlani }, uporaba, znova };
}

// ---- Ovoj od naprave do naprave ---------------------------------------------------------------------------------------
// Vrednost potuje v AES-256-GCM s kljucem para (ECDH P-256 med telefonom in racunalnikom, HKDF iz kljuci-sinhron.ts). Pripet TLS
// ze sifrira, ovoj pa velja tudi, ce gre zahteva prek releja ali v dnevnik posrednika: rele vidi samo ovojnico.

export type Smer = "telefon-racunalnik" | "racunalnik-telefon";
export const NAMEN_KLJUCEV = "lina-kljuci-mozganov-v1";

export function solPara(idTelefona: string): Buffer {
  return createHash("sha256").update(`${NAMEN_KLJUCEV}|${idTelefona}`, "utf8").digest();
}

export function aadZapisa(z: Pick<ZapisKljuca, "id" | "ponudnik" | "cas" | "naprava">, smer: Smer): Buffer {
  return Buffer.from(`${NAMEN_KLJUCEV}|${z.id}|${z.ponudnik}|${z.cas}|${z.naprava}|${smer}`, "utf8");
}

export function noviParKljucev(): { zasebni: string; javni: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    zasebni: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    javni: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
}

/** Javni kljuc P-256 (SPKI DER, base64) ali null. */
export function javniKljucPara(b64: unknown): KeyObject | null {
  if (typeof b64 !== "string" || b64.length > 200 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) return null;
  try {
    const k = createPublicKey({ key: Buffer.from(b64, "base64"), format: "der", type: "spki" });
    return k.asymmetricKeyType === "ec" && k.asymmetricKeyDetails?.namedCurve === "prime256v1" ? k : null;
  } catch {
    return null;
  }
}

export function kljucPara(zasebniB64: string, javniDrugega: KeyObject, idTelefona: string): Buffer {
  const zasebni = createPrivateKey({ key: Buffer.from(zasebniB64, "base64"), format: "der", type: "pkcs8" });
  return izpeljiKljucOvoja(diffieHellman({ privateKey: zasebni, publicKey: javniDrugega }), solPara(idTelefona));
}

/** Zapis na zici: brez vrednosti, z ovojnico pri zivem zapisu. */
export type ZapisNaZici = Omit<ZapisKljuca, "vrednost"> & { ovoj?: Ovojnica };

export function zaZico(z: ZapisKljuca, kljuc: Buffer, smer: Smer): ZapisNaZici {
  const { vrednost, ...brez } = z;
  return z.izbrisan ? brez : { ...brez, ovoj: zapakiraj(kljuc, vrednost, aadZapisa(z, smer)) };
}

/** Prejet zapis z zice -> zapis z vrednostjo; null = neveljaven ali ovojnica se ne odpre (zapis se prezre). */
export function zZice(v: unknown, kljuc: Buffer, smer: Smer): ZapisKljuca | null {
  if (!v || typeof v !== "object") return null;
  const { ovoj, ...o } = v as Record<string, unknown>;
  if ("vrednost" in o) return null; // vrednost v cistem besedilu se ne sprejme
  if (o.izbrisan === true) return ovoj === undefined ? ({ ...o, vrednost: "" } as ZapisKljuca) : null;
  if (!ovoj || typeof ovoj !== "object" || typeof o.id !== "string" || typeof o.ponudnik !== "string" || typeof o.cas !== "number" || typeof o.naprava !== "string") return null;
  try {
    const vrednost = odpakiraj(kljuc, ovoj as Ovojnica, aadZapisa(o as ZapisKljuca, smer));
    return { ...o, vrednost } as ZapisKljuca;
  } catch {
    return null;
  }
}

/** Za vmesnik: nikoli cel kljuc (zadnji 4 znaki). */
export const namigKljuca = (v: string): string => (v.length >= 8 ? `…${v.slice(-4)}` : "");
