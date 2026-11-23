/**
 * Cista enota izhodnega filtra (brez uvozov streznika, brez omrezja):
 * doloca, kaj sme iti iz Line k oblacnemu modelu.
 *
 * - Vedno (tudi pri klicu) zakrije: kljuce/zetone, gesla, kartice (Luhn), IBAN (dolzina + mod 97).
 *   Te vrednosti se nikoli ne obnovijo v odgovoru modela.
 * - Samo ko je vsebinaKlica === false (pogovor lastnika z asistentko): psevdonimizira stike
 *   (e-naslovi, telefonske stevilke) in jih v odgovoru modela obnovi z obnovi(odgovor).
 * - Pri klicu (vsebinaKlica !== false) se stiki ne zakrijejo (so vsebina klica).
 */

export const KATEGORIJE = ["kljuc", "geslo", "kartica", "iban", "eposta", "telefon"] as const;
export type Kategorija = (typeof KATEGORIJE)[number];

export type StanjePsevdonimov = {
  epostaPoKljucu: Map<string, string>;
  telefonPoKljucu: Map<string, string>;
  izvirnikPoOznaki: Map<string, string>;
};

export type MoznostiFiltra = {
  vsebinaKlica: boolean;
  /** Neobvezno deljeno stanje psevdonimov za zaporedne klice (npr. text in system v istem klicu modela). */
  stanje?: StanjePsevdonimov;
};

export type IzidFiltra = {
  besedilo: string;
  kategorije: Record<Kategorija, number>;
  obnovi: (odgovor: string) => string;
};

/** Ustvari prazno stanje psevdonimov za skupno rabo med besedilom in sistemskim navodilom istega klica. */
export function ustvariStanjePsevdonimov(): StanjePsevdonimov {
  return {
    epostaPoKljucu: new Map<string, string>(),
    telefonPoKljucu: new Map<string, string>(),
    izvirnikPoOznaki: new Map<string, string>(),
  };
}

export function prazneKategorije(): Record<Kategorija, number> {
  return {
    kljuc: 0,
    geslo: 0,
    kartica: 0,
    iban: 0,
    eposta: 0,
    telefon: 0,
  };
}

export function zdruziKategorije(
  a: Record<Kategorija, number>,
  b?: Record<Kategorija, number> | null,
): Record<Kategorija, number> {
  const izid = prazneKategorije();
  for (const k of KATEGORIJE) {
    izid[k] = a[k] + (b ? b[k] : 0);
  }
  return izid;
}

export function imaNajdeneKategorije(kategorije: Record<Kategorija, number>): boolean {
  for (const k of KATEGORIJE) {
    if (kategorije[k] > 0) return true;
  }
  return false;
}

/** Uradne dolzine IBAN po ISO 13616 (drzava -> skupno stevilo znakov brez presledkov). */
const IBAN_DOLZINE: Readonly<Record<string, number>> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29,
  BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29,
  ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28,
  HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20,
  LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27, MD: 24, ME: 22,
  MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25,
  QA: 29, RO: 24, RS: 22, SA: 24, SC: 31, SD: 18, SE: 24, SI: 19, SK: 24, SM: 27,
  ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20,
};

/** Preveri kontrolno stevilko IBAN po mod 97 (ISO 13616). */
export function veljavenIban(surovo: string): boolean {
  const cisto = surovo.replace(/[ \t-]+/g, "").toUpperCase();
  if (cisto.length < 15 || cisto.length > 34) return false;
  const drzava = cisto.slice(0, 2);
  const pricakovana = IBAN_DOLZINE[drzava];
  if (pricakovana === undefined || cisto.length !== pricakovana) return false;
  const kontrolna = cisto.slice(2, 4);
  if (!/^\d{2}$/.test(kontrolna) || kontrolna === "00" || kontrolna === "01" || kontrolna === "99") return false;
  const bban = cisto.slice(4);
  if (!/^[A-Z0-9]+$/.test(bban)) return false;
  // Preuredimo prve 4 znake na konec in izracunamo ostanek pri deljenju s 97 brez BigInt.
  const preurejeno = `${bban}${drzava}${kontrolna}`;
  let ostanek = 0;
  for (let i = 0; i < preurejeno.length; i += 1) {
    const koda = preurejeno.charCodeAt(i);
    if (koda >= 48 && koda <= 57) {
      ostanek = (ostanek * 10 + (koda - 48)) % 97;
    } else if (koda >= 65 && koda <= 90) {
      const vrednost = koda - 55; // A=10 .. Z=35
      ostanek = (ostanek * 100 + vrednost) % 97;
    } else {
      return false;
    }
  }
  return ostanek === 1;
}

/** Preveri Luhn za stevilke placilnih kartic (13 do 19 stevk, ne samih nicel). */
export function veljaLuhn(stevke: string): boolean {
  if (!/^\d{13,19}$/.test(stevke) || /^0+$/.test(stevke)) return false;
  let vsota = 0;
  let podvoji = false;
  for (let i = stevke.length - 1; i >= 0; i -= 1) {
    let d = stevke.charCodeAt(i) - 48;
    if (podvoji) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    vsota += d;
    podvoji = !podvoji;
  }
  return vsota % 10 === 0;
}

function jeAlfanumericni(znak: string): boolean {
  if (!znak) return false;
  const k = znak.charCodeAt(0);
  return (k >= 48 && k <= 57) || (k >= 65 && k <= 90) || (k >= 97 && k <= 122);
}

/** Znanih oblik kljucev/zetonov: sk-ant-..., sk-..., AIza..., ya29...., ghp_..., github_pat_..., xox?-..., AKIA..., JWT. */
const ZNANI_KLJUCI =
  /(?<![A-Za-z0-9_])(?:sk-ant-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|ya29\.[0-9A-Za-z._-]{15,}[0-9A-Za-z_-]|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{20,}|xox[A-Za-z]-[0-9A-Za-z-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})(?![A-Za-z0-9_-])/g;

/** Dolgi nizi 32+ znakov hex/base64 takoj za besedami kljuc/ključ/token/key/secret/zeton/žeton. */
const KLJUC_PO_BESEDI =
  /(?<![A-Za-z0-9_])((?:api[_ -]?)?(?:klju[cč]|žeton|zeton|token|key|secret)["']?[ \t]*(?:[:=][ \t]*|[ \t]+)["']?)([A-Za-z0-9+/=_-]{32,})(?![A-Za-z0-9+/=_-])/gi;

/** Gesla po vzorcih geslo:, password=, pass:, passwd:, pwd: do konca besede. */
const GESLO_VZOREC =
  /(?<![A-Za-z0-9_])((?:geslo|password|passwd|pass|pwd)["']?[ \t]*[:=][ \t]*["']?)([^\s]+)/gi;

const ZAKLJUCNI_ZNAKI_GESLA = /[,;.)}\]"']+$/;
const ZE_OZNAKA = /^\[[A-Z0-9-]+\]$/;

/** Kandidati placilnih kartic (13 do 19 stevk z ali brez presledkov/pomislajev). */
const KARTICA_KANDIDAT = /(?<![0-9A-Za-z+])(\d(?:[ -]?\d){12,18})(?![0-9A-Za-z])/g;

/** E-naslovi za psevdonimizacijo pri asistentki. */
const EPOSTA_VZOREC =
  /(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})(?![A-Za-z0-9_@-])/g;

/** Telefonske stevilke (mednarodne +... / 00... in slovenske 9-mestne 0XX XXX XXX / 0XXXXXXXX). */
const TELEFON_VZOREC =
  /(?<![0-9A-Za-z+])(?:\+[1-9]\d{0,2}(?:[ \t()-]*\d){7,13}|00[1-9]\d{0,2}(?:[ \t()-]*\d){7,13}|0[1-9](?:[ \t/-]?\d){7})(?![0-9A-Za-z])/g;

const PSEVDONIM_VZOREC = /\[(?:E-POSTA|TELEFON)-\d+\]/g;

function zakrijIban(besedilo: string, kategorije: Record<Kategorija, number>): string {
  const zacetekVzorec = /(?<![A-Za-z0-9])([A-Za-z]{2})(\d{2})/g;
  let izid = "";
  let kazalec = 0;
  let zadetek: RegExpExecArray | null;
  while ((zadetek = zacetekVzorec.exec(besedilo)) !== null) {
    const start = zadetek.index;
    if (start < kazalec) continue;
    const drzava = zadetek[1].toUpperCase();
    const dolzina = IBAN_DOLZINE[drzava];
    if (dolzina === undefined) continue;
    const potrebni = dolzina - 4;
    let i = start + 4;
    let zbranih = 0;
    let bban = "";
    while (i < besedilo.length && zbranih < potrebni) {
      const ch = besedilo[i];
      if (ch === " " || ch === "-") {
        if (i + 1 < besedilo.length && jeAlfanumericni(besedilo[i + 1])) {
          i += 1;
          continue;
        }
        break;
      }
      if (!jeAlfanumericni(ch)) break;
      bban += ch;
      zbranih += 1;
      i += 1;
    }
    if (zbranih !== potrebni) continue;
    if (i < besedilo.length && jeAlfanumericni(besedilo[i])) continue;
    const suroviIban = besedilo.slice(start, i);
    // Preprecimo nakljucno ujemanje malih besed, ce ni niti drzava z velikimi crkami niti stevilski BBAN.
    if (zadetek[1] !== drzava && !/^\d+$/.test(bban)) continue;
    if (!veljavenIban(suroviIban)) continue;
    izid += besedilo.slice(kazalec, start) + "[IBAN]";
    kazalec = i;
    zacetekVzorec.lastIndex = i;
    kategorije.iban += 1;
  }
  return kazalec === 0 ? besedilo : izid + besedilo.slice(kazalec);
}

function jeVeljavenTelefon(ujem: string): boolean {
  const stevke = ujem.replace(/\D/g, "");
  if (ujem.startsWith("+")) return stevke.length >= 8 && stevke.length <= 16;
  if (ujem.startsWith("00")) return stevke.length >= 10 && stevke.length <= 17;
  return stevke.length === 9 && ujem.startsWith("0") && ujem[1] !== "0";
}

function normalizirajTelefon(ujem: string): string {
  return ujem.replace(/[\s()/-]+/g, "").replace(/^00/, "+");
}

/**
 * Filtrira besedilo pred posiljanjem oblacnemu modelu.
 * Vrze TypeError, ce vhod ni niz (klicatelj v callProvider zavrne klic fail-closed).
 */
export function filtrirajIzhod(besedilo: string, moznosti: MoznostiFiltra): IzidFiltra {
  if (typeof besedilo !== "string") {
    throw new TypeError("Besedilo za izhodni filter mora biti niz.");
  }
  const kategorije = prazneKategorije();
  const stanje = moznosti.stanje ?? ustvariStanjePsevdonimov();
  let izhod = besedilo;

  // 1. Znani kljuci in zetoni (vedno, brez obnove).
  izhod = izhod.replace(ZNANI_KLJUCI, () => {
    kategorije.kljuc += 1;
    return "[KLJUC]";
  });

  // 2. Dolgi hex/base64 nizi (32+ znakov) takoj za besedami kljuc/token/key/secret (vedno, brez obnove).
  izhod = izhod.replace(KLJUC_PO_BESEDI, (_celota, predpona: string) => {
    kategorije.kljuc += 1;
    return `${predpona}[KLJUC]`;
  });

  // 3. Gesla po vzorcih geslo:, password=, pass: do konca besede (vedno, brez obnove).
  izhod = izhod.replace(GESLO_VZOREC, (celota, predpona: string, surovaVrednost: string) => {
    const zakljucek = surovaVrednost.match(ZAKLJUCNI_ZNAKI_GESLA)?.[0] ?? "";
    const jedro = zakljucek ? surovaVrednost.slice(0, -zakljucek.length) : surovaVrednost;
    if (!jedro || ZE_OZNAKA.test(jedro)) return celota;
    kategorije.geslo += 1;
    return `${predpona}[GESLO]${zakljucek}`;
  });

  // 4. IBAN (veljavna dolzina in mod 97; pred karticami, da stevke IBAN ne postanejo kartica).
  izhod = zakrijIban(izhod, kategorije);

  // 5. Placljive kartice (13-19 stevk samo ce Luhn velja).
  izhod = izhod.replace(KARTICA_KANDIDAT, (celota) => {
    const stevke = celota.replace(/[ -]/g, "");
    if (!veljaLuhn(stevke)) return celota;
    kategorije.kartica += 1;
    return "[KARTICA]";
  });

  // 6. Stiki: SAMO ko vsebinaKlica === false (pogovor lastnika z asistentko).
  if (moznosti.vsebinaKlica === false) {
    izhod = izhod.replace(EPOSTA_VZOREC, (enaslov) => {
      const kljuc = enaslov.toLowerCase();
      let oznaka = stanje.epostaPoKljucu.get(kljuc);
      if (!oznaka) {
        oznaka = `[E-POSTA-${stanje.epostaPoKljucu.size + 1}]`;
        stanje.epostaPoKljucu.set(kljuc, oznaka);
        stanje.izvirnikPoOznaki.set(oznaka, enaslov);
      }
      kategorije.eposta += 1;
      return oznaka;
    });

    izhod = izhod.replace(TELEFON_VZOREC, (stevilka) => {
      if (!jeVeljavenTelefon(stevilka)) return stevilka;
      const kljuc = normalizirajTelefon(stevilka);
      let oznaka = stanje.telefonPoKljucu.get(kljuc);
      if (!oznaka) {
        oznaka = `[TELEFON-${stanje.telefonPoKljucu.size + 1}]`;
        stanje.telefonPoKljucu.set(kljuc, oznaka);
        stanje.izvirnikPoOznaki.set(oznaka, stevilka);
      }
      kategorije.telefon += 1;
      return oznaka;
    });
  }

  const obnovi = (odgovor: string): string => {
    if (stanje.izvirnikPoOznaki.size === 0 || !odgovor) return odgovor;
    return odgovor.replace(PSEVDONIM_VZOREC, (oznaka) => stanje.izvirnikPoOznaki.get(oznaka) ?? oznaka);
  };

  return { besedilo: izhod, kategorije, obnovi };
}
