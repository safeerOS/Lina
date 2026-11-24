/**
 * Kanal Lina <-> Claude Code (NALOGA-lina-kanal-claude-code.md, razdelki 1-6; lastnik 13. 11. 2026).
 *
 * Skupni deli protokola, brez stanja in brez omrezja. Kanal je MCP streznik, ki ga Claude Code zazene kot podproces (stdio);
 * Lina se nanj poveze prek Unix vticnice v svoji mapi podatkov (mapa 0700, vticnica 0600, BREZ vrat TCP). Prijava je
 * VZAJEMNA (izziv HMAC z zetonom v obe smeri, zeton nikoli ne gre po vticnici): Lina najprej preveri, da streznik zeton pozna.
 *
 * Kar da dostop (naloga, odobritev), mora PODPISATI naprava ozjega kroga s svojim kljucem Safeer Linka (EC P-256,
 * SHA256withECDSA DER, javni kljuc base64 SPKI DER, id n-<16 hex SHA-256 kljuca> - ista oblika kot core/link_krog.py in
 * KrogZaupanja.kt). Lina in kanal podpisa ne moreta ponarediti: zasebni kljuc je na napravi. Zeton samo odpre vticnico;
 * program, ki zeton ukrade (prebere mapo Line), brez kljuca naprave ne da ne naloge ne odobritve (pregled 14. 11. 2026, N1).
 * Podpis ima cas (okno 2 min) in enkratni niz (ponovitev se zavrne).
 */
import { createHash, createHmac, createPublicKey, timingSafeEqual, verify } from "node:crypto";
import path from "node:path";

/** Ime streznika v .mcp.json; Claude Code ga pokaze kot source="lina". */
export const IME_KANALA = "lina";
export const KONFIG_KANALA = "kanal-claude.json";
/** Zadnja znana odtisa programa kanala in seznama naprav - loceno od seznama (lastnik 14. 11. 2026). */
export const ODTIS_KANALA = "kanal-odtis.json";
export const MAPA_KANALA = "kanal";
export const NAJKRAJSI_ZETON_KANALA = 32;
/** Najdaljsa vrstica na vticnici in na stdio; daljsa se zavrze (proces tece naprej). */
export const NAJVEC_VRSTICA = 64 * 1024;
/** Rok za prijavo na vticnico: povezava brez prijave ne sme visiti. */
export const ROK_PRIJAVE_MS = 3000;
/** Najvec hkratnih neprijavljenih povezav; nova izrine najstarejso (Lina se prijavi v nekaj ms). */
export const NAJVEC_NEPRIJAVLJENIH = 16;
/** Najvec hkrati odprtih zahtev za odobritev (Claude Code jih odpira eno za drugo). */
export const NAJVEC_ODPRTIH = 20;
/** Odobritev, starejsa od tega, ne velja vec. */
export const ROK_ODOBRITVE_MS = 15 * 60_000;
/** Najvec pogovorov (chat_id), ki jih kanal pozna za orodje reply. */
export const NAJVEC_POGOVOROV = 100;
/** Najdaljse besedilo odgovora Claude Code (orodje reply); daljse se zavrne z napako, ne odreze. */
export const NAJVEC_ODGOVOR_ZNAKOV = 8000;
/** Najdaljsi opis/predogled odobritve, ki gre na telefon (Claude Code poslje do 3500 znakov na polje). */
export const NAJVEC_PREDOGLED = 4000;
/** SR-5: najvec sporocil »odobritev samo v terminalu« na nalogo (ponavljanje ne sme preplaviti telefona). */
export const NAJVEC_OBVESTIL_TERMINAL = 3;
/** Podpis naprave velja toliko casa okoli ure racunalnika (ura telefona in racunalnika se lahko malo razlikujeta). */
export const OKNO_PODPISA_MS = 2 * 60_000;
export const ENKRATNI = /^[A-Za-z0-9_-]{16,64}$/;

/** ID zahteve za odobritev: 5 malih crk brez »l« (dokumentacija channels-reference, prebrano 14. 11. 2026). */
export const ID_ODOBRITVE = /^[a-km-z]{5}$/;
/** »yes abcde«, »y abcde«, »no abcde«, »n abcde«; velike crke dovoljene (samopopravek na telefonu). */
export const ODGOVOR_ODOBRITVE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i;
/** Ime orodja Claude Code (Bash, Write, mcp__lina__reply ...); drugo se pokaze kot »neznano orodje«. */
export const IME_ORODJA = /^[A-Za-z0-9_.:-]{1,100}$/;
/** ID naprave Safeer Linka: n-<16 hex>, po zelji pripona programa (core/link_krog.py je_id_iz_kljuca). */
export const ID_NAPRAVE = /^n-[0-9a-f]{16}(-[A-Za-z0-9._-]{1,100})?$/;
/**
 * ID telefona pri seznanjanju: SAMO n-<16 hex>, brez pripone (N1 slepega pregleda SAS, 15. 11. 2026). Telefon ima id natanko
 * iz svojega kljuca; pripono (-os, -control) imajo samo druge naprave Safeerja. Pri ID_NAPRAVE je pripona poljubna in jo
 * napadalec, ki ima svoj kljuc (jedro id-ja ze veljavno), zapolni z nizom, ki je na zaslonu videti kot id drugega telefona.
 */
export const ID_TELEFONA = /^n-[0-9a-f]{16}$/;

export type Odobritev = { zahtevaId: string; dovoli: boolean };
/** Dokaz naprave: cas podpisa (ms), enkratni niz in podpis (base64 DER) niza iz nizNaloge/nizOdobritve. */
export type Dokaz = { cas: number; enkratni: string; podpis: string };

/** Besedilo, ki je odobritev, vrne odlocitev; drugo besedilo je navadno sporocilo (null). */
export function razberiOdobritev(besedilo: string): Odobritev | null {
  const m = ODGOVOR_ODOBRITVE.exec(besedilo);
  if (!m) return null;
  return { zahtevaId: m[2].toLowerCase(), dovoli: m[1].toLowerCase().startsWith("y") };
}

/** Kar podpise naprava za nalogo (vzorec podatki_clana v core/link_krog.py: oznaka, polja, besedilo zadnje). */
export function nizNaloge(id: string, posiljatelj: string, besedilo: string, cas: number, enkratni: string): string {
  return `safeer-lina-naloga-v1\n${id}\n${posiljatelj}\n${cas}\n${enkratni}\n${besedilo}`;
}

/**
 * Kar podpise naprava za odobritev ene zahteve Claude Code. Podpis vezan na nalogo (chatId) in na TO, kar je lastnik videl na
 * zaslonu (zgostitev orodja, predogleda in opisa): odobritev ni prenosljiva na drugo vsebino (ponovni pregled 14. 11. 2026, N-D).
 */
export function nizOdobritve(
  zahtevaId: string, dovoli: boolean, posiljatelj: string, cas: number, enkratni: string, chatId: string, zgostitev: string,
): string {
  return `safeer-lina-odobritev-v3\n${zahtevaId}\n${dovoli ? "allow" : "deny"}\n${posiljatelj}\n${cas}\n${enkratni}\n${chatId}\n${zgostitev}`;
}

/**
 * SHA-256 (hex) prikazane vsebine zahteve; telefon jo izracuna iz istih treh polj, ki jih pokaze.
 * v3 (slepi pregled BBB1): vsako polje ima pred seboj dolzino v bajtih UTF-8 (`dolzina:vsebina`), zato razrez na polja ni
 * dvoumen niti ob prelomih vrstic, stevilkah in dvopicjih v vsebini (v2 je polja spajal z "\n": predogled/opis sta bila zamenljiva).
 */
export function zgostitevPrikaza(orodje: string, predogled: string, opis: string): string {
  const polje = (s: string) => `${Buffer.byteLength(s, "utf8")}:${s}`;
  return createHash("sha256").update(`safeer-lina-zgostitev-v3\n${polje(orodje)}${polje(predogled)}${polje(opis)}`, "utf8").digest("hex");
}

/**
 * Kar podpise naprava za NADALJEVANJE obstojece naloge (lastnik 23. 11. 2026: »Lina sama odgovori Claude Code«): odgovor na
 * vprasanje ali nadaljnje navodilo gre v ISTI pogovor (chat_id = id naloge), ne v novo nalogo. Lastna predpona: podpis naloge ali
 * ustavitve ni prenosljiv sem in obratno; enkratni niz se steje skupaj z ostalimi.
 */
export function nizNadaljevanja(id: string, posiljatelj: string, besedilo: string, cas: number, enkratni: string): string {
  return `safeer-lina-nadaljuj-v1\n${id}\n${posiljatelj}\n${cas}\n${enkratni}\n${besedilo}`;
}

/**
 * Vrsta odgovora Claude Code (orodje reply, polje »vrsta«; lastnik 23. 11. 2026 »Stanje naloge v Lini«): samo »koncano« konca
 * nalogo; »vprasanje« pomeni, da Claude Code caka navodilo (Lina na telefonu odgovori sama ali vprasa lastnika). Brez polja =
 * »vmesno« (prej je bil prvi odgovor brez polja napacno konec naloge).
 */
export const VRSTE_ODGOVORA = ["vprasanje", "vmesno", "koncano"] as const;
export type VrstaOdgovora = (typeof VRSTE_ODGOVORA)[number];

/** Kar podpise naprava, ki nalogo ustavi (N-E: ustavitev brez podpisa bi lahko poslal vsak z zetonom). */
export function nizUstavitve(id: string, posiljatelj: string, cas: number, enkratni: string): string {
  return `safeer-lina-ustavi-v1\n${id}\n${posiljatelj}\n${cas}\n${enkratni}`;
}

/**
 * Kar podpise telefon ob seznanjanju (QR iz Line): dokaz, da ima zasebni kljuc za javni kljuc, ki ga prinasa, vezan na enkratno
 * kodo iz QR. Podpis NE podeli dostopa: napravo v seznam doda samo lastnik z gumbom v Lini.
 */
export function nizSeznanitve(koda: string, id: string, kljuc: string, ime: string, cas: number, enkratni: string): string {
  return `safeer-lina-seznani-v1\n${koda}\n${id}\n${kljuc}\n${cas}\n${enkratni}\n${ime}`;
}

/** Kar podpise telefon za poizvedbo o stanju seje Claude Code. */
export function nizStanja(posiljatelj: string, cas: number, enkratni: string): string {
  return `safeer-lina-stanje-v1\n${posiljatelj}\n${cas}\n${enkratni}`;
}

/** Kar podpise telefon za branje dogodkov naloge (T1-N3: samo naprava, ki je dala nalogo; id naloge ni vec skrivnost). */
export function nizDogodkov(id: string, posiljatelj: string, cas: number, enkratni: string): string {
  return `safeer-lina-dogodki-v1\n${id}\n${posiljatelj}\n${cas}\n${enkratni}`;
}

/** Kar podpise telefon, ko po lastnikovem »Dodaj« prevzame razdelek poti klicev OpenLine (T1-S1; koda = koda QR ali pair_id). */
export function nizKlici(koda: string, posiljatelj: string, cas: number, enkratni: string): string {
  return `safeer-lina-klici-v1\n${koda}\n${posiljatelj}\n${cas}\n${enkratni}`;
}

/** SHA-256 (hex) niza `vsebina` (JSON besedilo sinhronizacije), ki ga telefon pošlje; podpis je vezan nanjo (isto kot zgostitevPrikaza). */
export function zgostitevSinhron(vsebina: string): string {
  return createHash("sha256").update(vsebina, "utf8").digest("hex");
}

/** Kar podpise telefon za sinhronizacijo klicev, pogovora in navodil (20. 11. 2026): podpis pokriva zgostitev celotne vsebine. */
export function nizSinhron(posiljatelj: string, cas: number, enkratni: string, zgostitev: string): string {
  return `safeer-lina-sinhron-v1\n${posiljatelj}\n${cas}\n${enkratni}\n${zgostitev}`;
}

/** Dodatki na racunalniku, ki jih sme naprava ozjega kroga videti in preklopiti (lastnik 23. 11. 2026); zaprt seznam. */
export const DODATKI_TELEFONA = ["paperclip", "n8n", "affine", "slovenski"] as const;
export type DodatekTelefona = (typeof DODATKI_TELEFONA)[number];
export function jeDodatekTelefona(x: unknown): x is DodatekTelefona {
  return typeof x === "string" && (DODATKI_TELEFONA as readonly string[]).includes(x);
}

/** Kar podpise telefon za branje stanja dodatkov na racunalniku (GET /dodatki). */
export function nizStanjaDodatkov(posiljatelj: string, cas: number, enkratni: string): string {
  return `safeer-lina-dodatki-stanje-v1\n${posiljatelj}\n${cas}\n${enkratni}`;
}

/** Kar podpise telefon za vklop ali izklop enega dodatka (POST /dodatek): podpis veze dodatek in smer. */
export function nizDodatka(posiljatelj: string, dodatek: DodatekTelefona, vklop: boolean, cas: number, enkratni: string): string {
  return `safeer-lina-dodatek-v1\n${posiljatelj}\n${dodatek}\n${vklop ? "vklopi" : "izklopi"}\n${cas}\n${enkratni}`;
}

/** Gradnje na GitHubu (24. 11. 2026, gradnje-github.server.ts): branje stanja (GET /gradnje). */
export function nizStanjaGradenj(posiljatelj: string, cas: number, enkratni: string): string {
  return `safeer-lina-gradnje-stanje-v1\n${posiljatelj}\n${cas}\n${enkratni}`;
}
/** Predlog gradnje s telefona (POST /gradnja/predlog): podpis veze tok in vejo; zagon se vedno potrdi posebej. */
export function nizPredlogaGradnje(posiljatelj: string, tok: string, veja: string, cas: number, enkratni: string): string {
  return `safeer-lina-gradnja-predlog-v1\n${posiljatelj}\n${tok}\n${veja}\n${cas}\n${enkratni}`;
}
/** Potrditev zagona s telefona (POST /gradnja/potrdi): podpis veze id predloga in zgostitev (repozitorij, tok, veja). */
export function nizPotrditveGradnje(posiljatelj: string, id: string, zgostitev: string, cas: number, enkratni: string): string {
  return `safeer-lina-gradnja-potrdi-v1\n${posiljatelj}\n${id}\n${zgostitev}\n${cas}\n${enkratni}`;
}
/** Naloge agentov s telefona (24. 11. 2026, claude-naloge.server.ts): branje vrste (GET /agent-naloge). */
export function nizStanjaAgentNalog(posiljatelj: string, cas: number, enkratni: string): string {
  return `safeer-lina-agenti-stanje-v1\n${posiljatelj}\n${cas}\n${enkratni}`;
}
/**
 * Zgostitev dodelitve (agent, mapa, besedilo, pogoj) kot JSON polje: besedilo lahko vsebuje nove vrstice, zato podpis veze zgostitev
 * (kot nizSinhron), ne surovih polj, in meje polj ne morejo zdrsniti.
 */
export function zgostitevDodelitve(agent: string, mapa: string, besedilo: string, pogoj: string): string {
  return createHash("sha256").update(JSON.stringify([agent, mapa, besedilo, pogoj]), "utf8").digest("hex");
}
/** Dodelitev naloge agentu s telefona (POST /agent-naloga/dodeli): dodelitev lastnika je potrditev za en zagon. */
export function nizDodelitveAgentNaloge(posiljatelj: string, zgostitev: string, cas: number, enkratni: string): string {
  return `safeer-lina-agent-dodeli-v1\n${posiljatelj}\n${zgostitev}\n${cas}\n${enkratni}`;
}
/** Preklic dodeljene naloge s telefona (POST /agent-naloga/preklici): podpis veze id. */
export function nizPreklicaAgentNaloge(posiljatelj: string, id: string, cas: number, enkratni: string): string {
  return `safeer-lina-agent-preklici-v1\n${posiljatelj}\n${id}\n${cas}\n${enkratni}`;
}
/** Prenos APK zadnje potrjene gradnje (GET /gradnja/apk). */
export function nizApkGradnje(posiljatelj: string, cas: number, enkratni: string): string {
  return `safeer-lina-gradnja-apk-v1\n${posiljatelj}\n${cas}\n${enkratni}`;
}

/** Orodje Claude Code za dodatke (kanal lina); to ime nosi zahteva za odobritev na telefonu. */
export const ORODJE_DODATKI = "mcp__lina__dodatki";
export type DejanjeDodatkov = "stanje" | "vklopi" | "izklopi";
/** Predogled na telefonu: dejanje in dodatek, ki ju podpis odobritve veze (prek zgostitevPrikaza). */
export function predogledDodatka(dodatek: DodatekTelefona, vklop: boolean): string {
  return `${vklop ? "vklopi" : "izklopi"} ${dodatek}`;
}
/** Opis zahteve pise koda, ne model: lastnik ve, kaj odobri (Docker, prenos modela). */
export function opisDodatka(dodatek: DodatekTelefona, vklop: boolean): string {
  if (!vklop) return `Izklop dodatka ${dodatek} na racunalniku (podatki ostanejo).`;
  return dodatek === "slovenski"
    ? "Vklop slovenskega modela na racunalniku: prvi vklop prenese in namesti priblizno 1,6 GB in zasede pomnilnik."
    : `Vklop dodatka ${dodatek} na racunalniku: zazene vsebnik Docker (samo 127.0.0.1).`;
}

/** Besedilo brez osamljenih nadomestnih znakov (N-G); tako besedilo se zavrne, ne popravi. */
export function praviUnicode(s: string): boolean {
  return (s as string & { isWellFormed(): boolean }).isWellFormed();
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** n- + 16 hex SHA-256 javnega kljuca (core/link_krog.py id_iz_kljuca). */
export function idIzKljuca(kljucB64: string): string {
  return "n-" + createHash("sha256").update(Buffer.from(kljucB64, "base64")).digest("hex").slice(0, 16);
}

/** Veljaven javni kljuc naprave: base64 SPKI DER, EC P-256. */
export function veljavenKljucNaprave(kljucB64: unknown): kljucB64 is string {
  if (typeof kljucB64 !== "string" || kljucB64.length > 400 || !B64.test(kljucB64)) return false;
  try {
    const k = createPublicKey({ key: Buffer.from(kljucB64, "base64"), format: "der", type: "spki" });
    return k.asymmetricKeyType === "ec" && k.asymmetricKeyDetails?.namedCurve === "prime256v1";
  } catch {
    return false;
  }
}

/** Ali je id vezan na kljuc (jedro id-ja = id iz kljuca), kot pri clanih kroga Linka. */
export function idPripadaKljucu(id: string, kljucB64: string): boolean {
  return ID_NAPRAVE.test(id) && id.slice(0, 18) === idIzKljuca(kljucB64);
}

/** SHA256withECDSA (DER) - kot link_kripto.preveri; vsaka napaka je false. */
export function preveriPodpisNaprave(kljucB64: string, niz: string, podpisB64: unknown): boolean {
  if (typeof podpisB64 !== "string" || podpisB64.length > 200 || !B64.test(podpisB64)) return false;
  try {
    const k = createPublicKey({ key: Buffer.from(kljucB64, "base64"), format: "der", type: "spki" });
    return verify("sha256", Buffer.from(niz, "utf8"), k, Buffer.from(podpisB64, "base64"));
  } catch {
    return false;
  }
}

/** Oblika dokaza (brez preverbe podpisa). */
export function oblikaDokaza(d: unknown): d is Dokaz {
  const x = d as Partial<Dokaz> | null;
  return !!x && Number.isSafeInteger(x.cas) && typeof x.enkratni === "string" && ENKRATNI.test(x.enkratni) && typeof x.podpis === "string";
}

/** Primerjava v konstantnem casu; razlicni dolzini nista enaki. */
export function enakoKonstantno(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Zeton velja samo, ce ima vsaj 32 znakov. */
export function veljavenZetonKanala(zeton: string | null | undefined): zeton is string {
  return typeof zeton === "string" && zeton.length >= NAJKRAJSI_ZETON_KANALA;
}

/** HMAC-SHA256 z zetonom: vzajemna prijava (vloga | izziv odjemalca | izziv streznika). Zeton ne gre po vticnici. */
export function dokazPrijave(zeton: string, vloga: "streznik" | "odjemalec", c: string, s: string): string {
  return createHmac("sha256", zeton).update(`safeer-lina-kanal-prijava-v1\n${vloga}\n${c}\n${s}`).digest("base64url");
}
export const IZZIV = /^[A-Za-z0-9_-]{22,64}$/;

/** Ime cevi na Windows: 128 nakljucnih bitov (pripraviKanal), ne zgostitev poti, ki jo lahko izracuna vsak (N-H). */
export const IME_CEVI = /^[A-Za-z0-9_-]{22,64}$/;

/**
 * Pot vticnice; na Windows imenovana cev z nakljucnim imenom iz nastavitve kanala. Node ne zna nastaviti ACL cevi - na Windows
 * dostop varujeta samo vzajemna prijava z zetonom in podpis naprave; pravice cevi so NEPREVERJENE.
 */
export function potVticnice(root: string, platforma: NodeJS.Platform = process.platform, imeCevi = ""): string {
  if (platforma === "win32") {
    if (!IME_CEVI.test(imeCevi)) throw new Error("Kanal nima imena cevi (pripraviKanal).");
    return `\\\\?\\pipe\\lina-kanal-${imeCevi}`;
  }
  return path.join(root, MAPA_KANALA, "claude.sock");
}

/** Unix vticnica ima mejo ~107 bajtov (sun_path); daljso pot zavrnemo z jasnim razlogom, ne z nerazumljivo napako. */
export function predolgaPot(pot: string, platforma: NodeJS.Platform = process.platform): boolean {
  return platforma !== "win32" && Buffer.byteLength(pot) > 107;
}

/** Sporocila Lina -> kanal. */
export type ZaKanal =
  | { vrsta: "pozdrav"; c: string }
  | { vrsta: "prijava"; dokaz: string }
  | { vrsta: "naloga"; naloga: { id: string; besedilo: string; posiljatelj: string; izvor: string; dokaz?: Dokaz } }
  | { vrsta: "odobritev"; zahtevaId: string; dovoli: boolean; posiljatelj: string; dokaz?: Dokaz }
  | { vrsta: "ustavi"; id: string; posiljatelj: string; dokaz?: Dokaz }
  | { vrsta: "nadaljuj"; id: string; besedilo: string; posiljatelj: string; dokaz?: Dokaz }
  /** Izid orodja dodatki (Lina izvede, kanal vrne Claude Code). */
  | { vrsta: "dodatkiIzid"; zahteva: string; ok: boolean; besedilo: string };

/** Sporocila kanal -> Lina. `tip` je vrsta odgovora (VRSTE_ODGOVORA); `koncano` ostane za starejso Lino (koncano = tip »koncano«). */
export type IzKanala =
  | { vrsta: "izziv"; s: string; dokaz: string }
  | { vrsta: "pozdravljen"; seja: boolean; apiKljuc: boolean; aktivne: string[]; opozorila?: string[] }
  | { vrsta: "odgovor"; chatId: string; besedilo: string; koncano: boolean; tip?: VrstaOdgovora }
  | { vrsta: "odobritev"; chatId: string; zahtevaId: string; orodje: string; opis: string; predogled: string; zgostitev: string }
  | { vrsta: "umaknjeno"; id: string }
  /** Orodje dodatki: stanje brez odobritve; vklopi/izklopi samo po podpisani odobritvi naprave, ki je dala nalogo (zahteva = ID odobritve). */
  | { vrsta: "dodatki"; zahteva: string; chatId: string; dejanje: DejanjeDodatkov; dodatek?: DodatekTelefona }
  /** `nadaljevanje`: zavrnjen je bil odgovor v obstojeco nalogo - naloga sama tece naprej (Lina je ne konca). */
  | { vrsta: "zavrnjeno"; id: string; razlog?: string; nadaljevanje?: boolean }
  | { vrsta: "napaka"; razlog: string };

export const SPOROCILO_NADALJEVANJE_ZAVRNJENO = "Odgovor ni bil sprejet (naloga je ustavljena, podpis ali naprava ne ustreza ali prevec sporocil). Naloga tece naprej.";

/** Vec hkratnih nalog z razlicnih naprav: odobritev ne sme dobiti naprava, ki morda ni dala te naloge (CodeRabbit C5). */
export const SPOROCILO_ODOBRITEV_TERMINAL =
  "Claude Code caka odobritev. Ker hkrati tecejo naloge z vec naprav, jo je mogoce dati samo na racunalniku.";
/**
 * Besedilna odobritev (»yes abcde«) ne podpise prikazane vsebine (N-D), zato je kanal ne uporabi: lastnik odobri z gumbom na napravi.
 * Naloga s takim besedilom dobi ta zakljucni izid (CodeRabbit C3: klic ne sme viseti) in ne gre v sejo.
 */
export const SPOROCILO_ODOBRITEV_Z_GUMBOM = "Odobritev potrdite z gumbom »Dovoli« ali »Zavrni« na napravi.";
/**
 * Zahteva za odobritev, ki je na napravi ni mogoce varno pokazati (neveljavno ime orodja, ponovljen ali ze porabljen ID zahteve):
 * kanal je ne poslje na napravo, lastnik jo odobri v terminalu (R2-2, R2-5a).
 */
export const SPOROCILO_ODOBRITEV_SAMO_TERMINAL =
  "Claude Code caka odobritev, ki je ni mogoce varno pokazati na napravi; odobrite ali zavrnite jo na racunalniku.";
/** Najvec zapomnjenih ID-jev zahtev, ki jih je kanal ze izdal (ID se v kanalu ne ponovi, R2-2). */
export const NAJVEC_IZDANIH = 1000;
/** Porabljen ID zahteve velja tudi po izrinjenju iz odprtih; ob polnem seznamu se izrinejo samo vnosi starejsi od tega (24 h), sicer nova zahteva ostane v terminalu. */
export const IZDANI_ZIVLJENJE_MS = 24 * 60 * 60 * 1000;
/** Ustavitev brez podpisa naprave, ki je nalogo dala, ne velja; naloga tece naprej (N-E). */
export const SPOROCILO_USTAVITEV_BREZ_PODPISA = "Ustavitev ni sprejeta: potrdite jo na napravi, ki je nalogo dala. Naloga tece naprej.";
/** Rok naloge v kanalu (kanal jo ustavi sam, tudi brez Line); Lina ima enak privzeti rok za izid (N10, N-E). */
export const ROK_NALOGE_KANAL_MS = 2 * 60 * 60_000;

/** Navodilo, ki ga Claude Code ob povezavi da modelu (polje instructions). */
export const NAVODILO_KANALA =
  'Sporocila iz Line pridejo kot <channel source="lina" chat_id="..." naprava="...">. Vsako je podpisala naprava ozjega ' +
  "kroga Safeer Linka (lastnik), kanal je podpis preveril. Znaka < in > sta v besedilu zamenjana s ‹ in ›. Nalogo izvedi na " +
  "tem racunalniku po obicajnih pravilih projekta. Lini odgovarjaj z orodjem reply: chat_id iz oznake, kratko besedilo v " +
  'slovenscini in VEDNO polje vrsta: vrsta="vprasanje", ko potrebujes odgovor, odlocitev ali nadaljnje navodilo (tudi ko cakas ' +
  'navodila) - Lina ali lastnik odgovori v istem chat_id; vrsta="vmesno" za sprotno porocilo, ko delas naprej; vrsta="koncano" ' +
  "SAMO, ko je naloga v celoti koncana ali je ne mores narediti (takrat napisi izid). Brez polja vrsta Lina odgovor steje kot " +
  'vmesno in caka naprej. Oznaka nadaljevanje="da" je odgovor Line ali lastnika na tvoje vprasanje v isti nalogi. Oznaka ' +
  'ustavi="da" pomeni, da je naloga ustavljena (lastnik, rok ali umik naprave): prenehaj z delom na njej in poslji reply z vrsta="koncano". ' +
  "Dodatke na tem racunalniku (paperclip, n8n, affine, slovenski) upravljaj z orodjem dodatki (stanje, vklopi, izklopi), ne z Dockerjem " +
  "ali datotekami: vklop in izklop izvede Lina sele, ko ga lastnik odobri na napravi.";

/** Razcleni eno vrstico JSON; neveljavna ali predolga vrstica je null (nikoli izjema). */
export function razcleniVrstico(vrstica: string): Record<string, unknown> | null {
  if (vrstica.length > NAJVEC_VRSTICA) return null;
  try {
    const v = JSON.parse(vrstica) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Zbiralnik vrstic z mejo. Predolga vrstica se zavrze do naslednjega \n (naPredolgo dobi njen zacetek), naslednje vrstice
 * se obdelajo normalno: en predolg odgovor ne sme ustaviti kanala (pregled 14. 11. 2026, N5).
 */
export class Vrstice {
  private medpomnilnik = "";
  private preskakujem = false;
  private zacetek = "";
  dodaj(kos: string, naVrstico: (v: string) => void, naPredolgo: (zacetek: string) => void = () => {}): void {
    this.medpomnilnik += kos;
    for (;;) {
      const i = this.medpomnilnik.indexOf("\n");
      if (i < 0) break;
      const v = this.medpomnilnik.slice(0, i);
      this.medpomnilnik = this.medpomnilnik.slice(i + 1);
      if (this.preskakujem) {
        this.preskakujem = false;
        naPredolgo(this.zacetek);
        this.zacetek = "";
      } else if (v.length > NAJVEC_VRSTICA) {
        naPredolgo(v.slice(0, 512));
      } else if (v.trim()) {
        naVrstico(v);
      }
    }
    if (this.medpomnilnik.length > NAJVEC_VRSTICA) {
      if (!this.preskakujem) this.zacetek = this.medpomnilnik.slice(0, 512);
      this.preskakujem = true;
      this.medpomnilnik = "";
    }
  }
}

/**
 * Besedilo za telefon: brez nadzornih znakov (C0, C1), znakov za smer besedila, nicelne sirine in drugih oblikovnih znakov
 * (\p{Cf}), ki bi lastniku na zaslonu skrili ali obrnili ukaz (pregled 14. 11. 2026, N6). Prelom vrstice ostane.
 */
/**
 * SR-1 (r3): Claude Code dolg vnos skrajsa in izvede CEL ukaz. Od v. 2.1.211 nad 3500 kodnimi tockami izpusti SREDINO z
 * oznako »N code points elided«, prej je poslal 200 enot in »\u2026« na koncu. Tak predogled je kratek (pod mejo 4000),
 * a skriva del ukaza, zato ga lastnik na telefonu ne sme odobriti na slepo (samo terminal).
 */
export function predogledSkrajsan(surov: unknown): boolean {
  const t = String(surov ?? "");
  if (/code points? elided/i.test(t)) return true;
  if (t.length > 3500) return true;
  return t.length >= 200 && t.endsWith("\u2026");
}

export function ocistiZaTelefon(s: unknown, najvec = NAJVEC_PREDOGLED): string {
  // R2-5b: tudi nevidni znaki, ki niso Cc/Cf (Default_Ignorable: U+3164, U+115F, izbirniki razlicic, U+034F ...)
  // SR-12 (r3): ZWJ (U+200D) med dvema emoji in VS16 (U+FE0F) takoj za emoji sta del znaka (druzina, srce), ne skrivnost;
  // vsi drugi oblikovni znaki ostanejo nadomesceni.
  const sirina = String(s ?? "");
  let t = sirina.replace(
    /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]|\p{Cf}|\p{Default_Ignorable_Code_Point}/gu,
    (z: string, i: number) => {
      const pred = [...sirina.slice(Math.max(0, i - 2), i)].pop() ?? "";
      const po = [...sirina.slice(i + 1, i + 3)][0] ?? "";
      const piktogram = (c: string) => c !== "" && /^\p{Extended_Pictographic}$/u.test(c);
      if (z === "\u200d" && piktogram(pred) && piktogram(po)) return z;
      if (z === "\ufe0f" && piktogram(pred)) return z;
      return " ";
    },
  );
  if (t.length > najvec) {
    // R2-5b: trda meja; rez ne sme razpoloviti para nadomestnih znakov in odrezano besedilo ima vidno oznako »…«
    t = t.slice(0, najvec - 1);
    if (/[\ud800-\udbff]$/.test(t)) t = t.slice(0, -1);
    t += "…";
  }
  // osamljen nadomestni znak Node kodira kot U+FFFD, Kotlin kot »?«: zgostitev bi se razlikovala (R2-5b)
  // SR-10 (r3): toWellFormed je v Node >= 20; na starejsem Node enak izid z lastno zamenjavo osamljenih nadomestnih znakov
  const tw = t as string & { toWellFormed?: () => string };
  if (typeof tw.toWellFormed === "function") return tw.toWellFormed();
  return t.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd");
}

/** Besedilo naloge za sejo: ociscen kot za telefon, < in > zamenjana, da besedilo ne zapre ali ponaredi oznake <channel> (N9). */
export function ocistiZaSejo(s: string): string {
  return ocistiZaTelefon(s, NAJVEC_VRSTICA).replace(/</g, "‹").replace(/>/g, "›");
}

/**
 * Ena odobritev na program (lastnik, 20. 11. 2026): ce je ukaz Bash en sam preprost klic cli-anything-<program> z varnimi
 * argumenti (brez lupinskih znakov, ; | & $ ` < > ( ) { } \\ narekovajev, prelomov), vrne ime programa, sicer null.
 * input_preview je lahko JSON {"command": "..."} ali golo besedilo ukaza.
 */
const UKAZ_PROGRAMA = /^cli-anything-([a-z0-9][a-z0-9_.-]{0,60})(?: [A-Za-z0-9_./=:@%+,-]+)*$/;
export function programIzUkaza(orodje: string, predogled: unknown): string | null {
  if (orodje !== "Bash" || typeof predogled !== "string") return null;
  let ukaz = predogled.trim();
  if (ukaz.startsWith("{")) {
    try {
      const j = JSON.parse(ukaz) as { command?: unknown };
      if (typeof j.command !== "string") return null;
      ukaz = j.command.trim();
    } catch {
      return null;
    }
  }
  return UKAZ_PROGRAMA.exec(ukaz)?.[1] ?? null;
}
