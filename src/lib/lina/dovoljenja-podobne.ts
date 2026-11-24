/**
 * Skupni modul dovoljenj »velja tudi za vse podobne« (lastnik 19. 11. in 24. 11. 2026), cisti del brez streznika.
 *
 * Ko lastnik enkrat potrdi vrsto dejanja, se podobno dejanje ne vprasa znova. PODOBNO = ista vrsta dejanja v ISTEM obsegu:
 * - naloga-agentu: isti agent in ista (kanonicna) mapa; podmapa je drug obseg,
 * - gradnja: isti tok in ista veja (samo ZAGON gradnje; namestitev deb/APK se vprasa vsakic in tu nima vrste),
 * - dodatek: isti dodatek in ista smer (vklopi/izklopi),
 * - program: isti program cli-anything-<ime> in isti podukaz (prvi argument brez »-« ali natancen nabor zastavic brez vrednosti; en preprost ukaz brez tveganih besed in poti
 *   zunaj projekta, najdba B2 1750),
 * - avtonomija: isto opravilo na isti povezavi (povezava doloca prejemnika in predlogo; nov prejemnik = nova povezava),
 * - n8n-zagon: zagon ISTEGA toka v lokalnem n8n (obseg je ID toka, ne ime); ustvarjanje novega toka vrste nima in se vedno vprasa,
 * - narocila-uvoz: branje (samo branje) iste kanonicne mape narocil podjetja; podmapa ali druga mapa je drug obseg.
 * Vedno znova se vprasa: denar/nakupi, brisanje podatkov, sporocila NOVIM prejemnikom, spremembe dostopa ali nastavitev sistema,
 * sprememba obsega. Teh dejanj zaprti seznam VRSTE_DOVOLJENJ sploh ne vsebuje, zato zanje dovoljenja ni mogoce zapisati.
 *
 * Dovoljenje nastane SAMO iz izrecne izbire lastnika v vmesniku (seja lastnika) ali s podpisom naprave ozjega kroga; nikoli iz
 * besedila modela, agenta, klicatelja ali spleta (preizkus uvozov v dovoljenja-podobne.test.ts).
 */
// Brez uvozov iz Node ali streznika: datoteko uvaza tudi vmesnik (Nastavitve > Dovoljenja). Id in obseg iz prikaza sta v .server.ts.

export const VRSTE_DOVOLJENJ = ["naloga-agentu", "gradnja", "dodatek", "program", "avtonomija", "narocila-uvoz", "n8n-zagon"] as const;
export type VrstaDovoljenja = (typeof VRSTE_DOVOLJENJ)[number];

/** Polja obsega po vrsti; vrstni red doloca kljuc. */
export const POLJA_OBSEGA: Record<VrstaDovoljenja, readonly string[]> = {
  "naloga-agentu": ["agent", "mapa"],
  gradnja: ["tok", "veja"],
  dodatek: ["dodatek", "smer"],
  program: ["program", "podukaz"],
  avtonomija: ["opravilo", "povezava"],
  "narocila-uvoz": ["mapa"],
  "n8n-zagon": ["tok"],
};

/** ID toka n8n (enako kot veljavenIdTokaN8n v n8n.ts; tu brez uvoza, ker datoteko uvaza vmesnik). */
const ID_TOKA_N8N = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Kar se VEDNO vprasa znova (samo za razlago v vmesniku; uveljavlja ga zaprti seznam vrst). */
export const VEDNO_VPRASA = ["denar", "brisanje", "nov-prejemnik", "dostop-sistem", "sprememba-obsega", "namestitev"] as const;

export type Obseg = Record<string, string>;

/**
 * Besedilo, ki opisuje dejanje, ki se VEDNO vprasa (brisanje, potisk, posiljanje, placilo, kljuci, sudo, namestitev; najdbi B1, B2 1750).
 * Za Linin predlog naloge in argumente ukaza programa: zadetek = dovoljenje za podobne se ne uporabi, lastnik potrdi sam.
 * shortcut: seznam besed (sl + en) brez razumevanja namena - raje vprasa prevec; ob novem jeziku ali vrsti dejanja razsiri seznam.
 */
const TVEGANO = new RegExp(
  [
    "(?<![a-z])(izbri|zbri|pobri|brisi|brise|brisa|odstrani|pocisti|unici|unicu)",
    "(?<![a-z])(delete|remove|erase|wipe|purge|truncate|drop(?!down)|destroy|unlink|rmdir|shred|clean)",
    "(?<![a-z])rm(?![a-z])",
    "(?<![a-z])(push|force|reset|rebase|publish|deploy|release|objav)",
    "(?<![a-z])(poslj|posl(i|ati|al|an)(?![a-z])|posilj|posreduj|send|mail|email|upload|nalozi na|share)",
    "(?<![a-z])(plac(?!e)|nakup|kupi|nakaz|denar|pay(?![a-z]*load)|purchase|buy|transfer|invoice|racun za)",
    "(?<![a-z])(kljuc(?!n)|geslo|gesla|gesl(?![a-z])|zeton|token|secret|skrivnost|password|passwd|credential|api key|apikey|keys?(?![a-z])|ssh|gpg|\\.env(?![a-z]))",
    "(?<![a-z])(sudo|su -|chmod|chown|namesti|namescen|install|uninstall|apt(?![a-z])|dnf(?![a-z])|pip(?![a-z])|npm i(?![a-z])|brew(?![a-z]))",
    // R2 (24. 11. 2026): potisk, praznjenje, premik, prepis, nalaganje kode s spleta, cron, ustavljanje procesov, formatiranje
    "(?<![a-z])(potisn|izprazn|sprazn|premakn|premest|prepis(i|e|at|al|an|uj)|move|overwrite|mv(?![a-z])|curl|wget|cron|p?kill|formatir|mkfs)",
    "\\|\\s*(ba|z)?sh(?![a-z])",
  ].join("|"),
);
// crka zunaj latinice (cirilica, grscina ...) ali znak oblike (nevidni presledek, smer): homoglif skrije besedo pred seznamom
const NE_LATINICA = /(?=\p{L})\P{Script=Latin}|\p{Cf}/u;
export function jeTveganoDejanje(besedilo: string): boolean {
  const s = besedilo.normalize("NFKC");
  return NE_LATINICA.test(s) || TVEGANO.test(s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase());
}

/** Dokaz naprave ozjega kroga (kot Dokaz v kanal-claude.ts). */
export type DokazDovoljenja = { cas: number; enkratni: string; podpis: string };

/** Kar je naprava videla ob odobritvi zahteve Claude Code (program, dodatek): podpis veze zgostitev tega prikaza. */
export type PrikazOdobritve = { zahtevaId: string; chatId: string; orodje: string; predogled: string; opis: string };

export type Dovoljenje = {
  id: string;
  vrsta: VrstaDovoljenja;
  obseg: Obseg;
  /** "lastnik" = seja lastnika na racunalniku; "naprava" = podpisano s telefona ozjega kroga (velja samo za to napravo). */
  kdo: "lastnik" | "naprava";
  naprava: string | null;
  kdaj: string;
  dokaz?: DokazDovoljenja;
  prikaz?: PrikazOdobritve;
};

export type UporabaDovoljenja = { id: string; vrsta: VrstaDovoljenja; kdaj: string; naprava: string | null };

export function jeVrstaDovoljenja(v: unknown): v is VrstaDovoljenja {
  return typeof v === "string" && (VRSTE_DOVOLJENJ as readonly string[]).includes(v);
}

const NAJVEC_ZNAKOV_POLJA = 512;
// kontrolni, nevidni in znaki za smer: prelom bi naredil kljuc dvoumen, nevidni bi skrili drug obseg pod istim prikazom
const NEDOVOLJENI = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/;

/** Normiran obseg (samo polja vrste, nizi brez kontrolnih znakov) ali null. */
export function normirajObseg(vrsta: unknown, obseg: unknown): Obseg | null {
  if (!jeVrstaDovoljenja(vrsta) || !obseg || typeof obseg !== "object" || Array.isArray(obseg)) return null;
  const o = obseg as Record<string, unknown>;
  const polja = POLJA_OBSEGA[vrsta];
  if (Object.keys(o).length !== polja.length) return null;
  const izid: Obseg = {};
  for (const p of polja) {
    const v = o[p];
    if (typeof v !== "string" || !v || v.length > NAJVEC_ZNAKOV_POLJA || NEDOVOLJENI.test(v) || v !== v.normalize("NFC")) return null;
    izid[p] = v;
  }
  if (vrsta === "dodatek" && izid.smer !== "vklopi" && izid.smer !== "izklopi") return null;
  // obseg zagona je ID toka: ime bi se lahko kasneje ujemalo z drugim tokom
  if (vrsta === "n8n-zagon" && !ID_TOKA_N8N.test(izid.tok)) return null;
  return izid;
}

/** Kljuc obsega (vrsta + polja, locena s prelomom, ki ga polja ne smejo vsebovati) ali null. */
export function kljucObsega(vrsta: unknown, obseg: unknown): string | null {
  const o = normirajObseg(vrsta, obseg);
  if (!o) return null;
  return [vrsta as string, ...POLJA_OBSEGA[vrsta as VrstaDovoljenja].map((p) => o[p])].join("\n");
}

/** Kar podpise naprava, ko izbere »Velja tudi za vse podobne« za obseg, ki ga pozna (gradnja: tok in veja). */
export function nizDovoljenja(posiljatelj: string, kljuc: string, cas: number, enkratni: string): string {
  return `safeer-lina-dovoljenje-v1\n${posiljatelj}\n${cas}\n${enkratni}\n${kljuc}`;
}

/**
 * Kar podpise naprava, ko pri odobritvi zahteve Claude Code (program, dodatek) izbere »Velja tudi za vse podobne«. Podpis veze isto
 * zgostitev prikaza kot odobritev (nizOdobritve); obseg izpelje streznik iz prikaza, zato ga telefonu ni treba razclenjevati.
 * Locena predpona: navadna odobritev (enkratna) ni nikoli dovoljenje za podobne in obratno.
 */
export function nizDovoljenjaOdobritve(
  posiljatelj: string, zahtevaId: string, chatId: string, zgostitev: string, cas: number, enkratni: string,
): string {
  return `safeer-lina-dovoljenje-odobritev-v1\n${posiljatelj}\n${zahtevaId}\n${chatId}\n${zgostitev}\n${cas}\n${enkratni}`;
}

/** Kratek opis obsega za seznam v Nastavitvah (brez skrivnosti; mapa in imena so lastnikovi podatki). */
export function opisObsega(d: Pick<Dovoljenje, "vrsta" | "obseg">): string {
  return POLJA_OBSEGA[d.vrsta].map((p) => d.obseg[p]).join(" · ");
}
