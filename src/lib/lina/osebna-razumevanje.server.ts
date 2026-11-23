import { fold } from "./guards.ts";
import { imeVTozilniku } from "./ime-tozilnik.ts";
import { activeBrain } from "./keys.server.ts";
import { llmOn } from "./llm.server.ts";
import { jePonovitev, jeSamoPozdravnoPolnilo, popraviPrepoznavo, vsebinskeBesede } from "./osebna-polnila.ts";
import { PRAVILA_RAZUMEVANJA } from "./skil-lina.ts";
import { callProvider } from "./providers.ts";
import { zabeleziVbrizg, zaznajVbrizg } from "./vbrizg.ts";
import type { ModelRazumevanja } from "./razumevanje.server.ts";

/**
 * Razumevanje IZREKA v nacinu osebna tajnica (14. 11. 2026): en strukturiran klic modela za vsak izrek, ki ga hitre poti pravil
 * (stevilka, slovo, cakaj, pozdrav, pogovor) ne odlocijo same. Trda meja 1,5 s (lastnik 14. 11. 2026; preizkusni racun Twilio zahteva TwiML v ~5 s): ob preseganju,
 * napaki ali neveljavnem izidu vrne null in velja pravilo kode - nic se ne poslabsa. Model SME napisati kratek odgovor na vprasanje
 * klicatelja, vendar SAMO iz dejstev, ki jih da koda, in odgovor gre skozi varovalo DOVOLJENEGA (varenOdgovorOsebna).
 */
/** Skupni rok modela (ms). Nastavljivo z LINA_OSEBNI_ROK_MS (100-5000); privzeto 1500. */
const rokIzOkolja = Number(process.env.LINA_OSEBNI_ROK_MS);
export const ROK_OSEBNEGA_RAZUMEVANJA_MS = Number.isFinite(rokIzOkolja) && rokIzOkolja >= 100 && rokIzOkolja <= 5_000 ? Math.round(rokIzOkolja) : 1_500;

export type VrstaOsebnega = "sporocilo" | "dopolnilo" | "pozdrav" | "vprasanje" | "slovo" | "cakaj" | "pogovor" | "nedokoncano" | "nerazumljivo" | "nejasno";
/** negotovo: model ni preprican, kaj je klicatelj rekel (polje confident=false; Fable 7): Lina enkrat prosi za ponovitev, nic se ne dopise. */
/**
 * ponovitev: model je izrek prebral kot prosnjo, naj Lina pove ali ponovi zapisano. Velja samo za NAMEN (koda sporocilo ponovi). Izmerjeno 14. 11. 2026:
 * gemini-3-flash-preview je s skilom vprasanje vracal kot »ali si razumela (sporočilo)« za odrezan »razumela«, kar dobesedna preverba zavrne.
 * Besedilo modela NE gre nikamor (ne v prepis ne v polja; neodvisni pregled 14. 11. 2026: besedilo, ki ga klicatelj ni izrekel, je prislo v prepis kot
 * »razumljeno« in sprozilo ponovitev). Ostane samo oznaka, od kod branje izhaja: »izrek« = dobesedno iz izreka, iz izreka s popravljeno ZNANO napako
 * prepoznave ali dopolnitev ODREZANEGA izreka; »branje« = vse drugo (obrat ga uposteva samo, kadar pravila izreka ne bi dopisala).
 */
export type OsebnoRazumevanje = { vrsta: VrstaOsebnega; sporocilo: string; ime: string; vprasanje: string | null; odgovor: string | null; negotovo?: true; ponovitev?: "izrek" | "branje" };

const VRSTE: readonly VrstaOsebnega[] = ["sporocilo", "dopolnilo", "pozdrav", "vprasanje", "slovo", "cakaj", "pogovor", "nedokoncano", "nerazumljivo", "nejasno"];

/** Dejstva, ki jih ima Lina res: iz njih (in samo iz njih) sme model sestaviti odgovor. */
export type DejstvaOsebna = { imeLastnika: string; imeTozilnik?: string; stevilkaBesedno: string; izrek: string; zapisano: boolean; odsotnost?: string };

/**
 * Navodilo modela = pogodba NACINA (oblika JSON, nameni, polja, varovala odgovora) + splosna pravila razumevanja in zapisa iz skila
 * lina-slovenski-klici (en vir; lastnik 14. 11. 2026). Kjer se skil in pravilo nacina izkljucujeta, velja pravilo nacina (AGENTS.md).
 */
export const NAVODILO_OSEBNEGA =
  "Si razumevalnik izrekov za OSEBNO telefonsko tajnico z umetno inteligenco (kataloga izdelkov ni). Klicatelj lahko pusti sporocilo osebi, ki jo je poklical. " +
  "Dobis dejstva, zapisano sporocilo, zadnje izreke klicatelja, prejsnji stavek Line in izrek klicatelja. Odgovori SAMO z JSON: " +
  '{"namen":"sporocilo|dopolnilo|pozdrav|vprasanje|slovo|cakaj|pogovor|nedokoncano|nerazumljivo|nejasno","sporocilo":"...","ime":"...","vprasanje":null,"odgovor":null,"confident":true}. ' +
  "namen: sporocilo = klicatelj sporoca nekaj osebi (sporocilo se se ni zapisano); dopolnilo = novo sporocilo PO ze zapisanem; pozdrav = samo pozdrav; " +
  "vprasanje = sprasuje Lino ali sporocilo ni v prvem planu, tudi prosnja, naj Lina pove ali ponovi zapisano (koda sporocilo ponovi); slovo = poslavlja se; " +
  "cakaj = prosi, naj pocaka (tudi »počakaj, preden odgovoriš«); pogovor = klepet (npr. kako si); nedokoncano = stavek je odrezan; nerazumljivo/nejasno = popacen prepis govora. " +
  "confident = false, ce nisi preprican, kaj je klicatelj hotel reci; takrat ne izmisljuj sporocila. " +
  "Zadnji izreki so samo kontekst: sporocilo, ime in vprasanje vzemi SAMO iz trenutnega izreka. " +
  "sporocilo = izrek, ociscen po pravilih ZAPIS; samo pri sporocilo/dopolnilo. ime = prazno, ce ga ni. " +
  "vprasanje = ce klicatelj sprasuje Lino (tudi v istem izreku kot sporocilo; tudi brez vprasaja), kratko iz izreka; znano napako prepoznave smes popraviti SAMO v vprasanju; sicer null. " +
  "odgovor = SAMO ce je vprasanje: kratek odgovor (najvec 2 kratka stavka, slovensko, preprosta beseda) " +
  "IZKLJUCNO iz dejstev; ce odgovora v dejstvih ni, vrni null. V odgovoru: brez stevk (stevilko klicatelja prepisi natancno z besedami iz dejstev), brez cen, " +
  "rokov, brez obljub klica nazaj, brez izmisljenih podatkov o lastniku (o odsotnosti samo, ce je v dejstvih, in natancno s temi besedami), brez trditve, da si razumela vsebino. " +
  "ODGOVOR NAJ BO CIM VEC TOCNO ENA ALI DVE OD TEH PREDPRIPRAVLJENIH FRAZ (so ze posnete, zato je odgovor takojsen): " +
  "»Sem pomočnica z umetno inteligenco.« / »Da, sporočilo je zapisano in bo posredovano.« / »Tega ne vem.« / »Dobro, hvala.«; " +
  "svojih stavkov uporabi le, ce nobena fraza ne ustreza (ti so pocasnejsi).\n\n" +
  PRAVILA_RAZUMEVANJA;

/** Najvec prejsnjih izrekov klicatelja v vhodu modela (kratek ali odrezan izrek se presodi z njimi; vhod ostane kratek). */
export const PREJSNJIH_IZREKOV = 3;

/** Vhod modela: dejstva + zapisano sporocilo + zadnji izreki klicatelja + prejsnji stavek Line + izrek. */
export function sestaviVhod(izrek: string, zadnjaLina: string, d: DejstvaOsebna, prejsnji: readonly string[] = []): string {
  // Vsako besedilo klicatelja je ENA vrstica (neodvisni pregled 14. 11. 2026): izrek z novimi vrsticami bi sicer v vhodu naredil svoj blok
  // »Dejstva:« ali »Lina je rekla:«.
  const vrstica = (besedilo: string, najvec: number) => besedilo.replace(/\s+/g, " ").trim().slice(0, najvec);
  // M2 popravki F6: izrek z vrinjenim navodilom v PREJSNJEM obratu (ali v zapisanem izreku) modela ne doseze, kot ga ne doseze zadnji izrek (N9);
  // brez tega je model v naslednjem obratu dobil »- <navodilo>« med zadnjimi izreki, ceprav je bil ta izrek sam nedolzen.
  const varen = (besedilo: string): boolean => !zaznajVbrizg(besedilo).nezaupano;
  const zadnji = prejsnji.filter(varen).map((p) => vrstica(p, 200)).filter(Boolean).slice(-PREJSNJIH_IZREKOV);
  return (
    // Ime v tozilniku (lastnik 21. 11. 2026: »Poklicali ste Petra«); brez besede »osebo«, ki je osebna tajnica ne sme ponoviti.
    `Dejstva:\n- Klicatelj je poklical (tozilnik): ${vrstica(d.imeTozilnik || d.imeLastnika, 80) || "(ime ni podano)"}${d.imeLastnika ? `; imenovalnik: ${vrstica(d.imeLastnika, 80)}` : ""}\n- Lina je umetna inteligenca.\n` +
    `- Stevilka klicatelja (z besedami): ${vrstica(d.stevilkaBesedno, 200) || "(ni znana)"}\n` +
    `- Sporocilo klicatelja je ${d.zapisano ? "ze zapisano in bo posredovano" : "se NI zapisano"}.\n` +
    (d.odsotnost ? `- Odsotnost osebe (dejstvo iz nastavitev; povej natancno s temi besedami, brez obljube povratnega klica): ${vrstica(d.odsotnost, 200)}\n` : "") +
    (d.zapisano && varen(d.izrek) ? `- Zapisan izrek (dobesedno): ${vrstica(d.izrek, 300)}\n` : "") +
    (zadnji.length > 0 ? `\nZadnji izreki klicatelja:\n${zadnji.map((p) => `- ${p}`).join("\n")}\n` : "") +
    `\nLina je rekla: ${vrstica(zadnjaLina, 200)}\nKlicatelj: ${vrstica(izrek, 300)}`
  );
}

/**
 * Varovalo odgovora = seznam DOVOLJENEGA (skil safeer-lina: seznam prepovedanih besed trikrat ni uspel). Vsaka beseda odgovora mora biti na seznamu
 * dovoljenih besed ali ime lastnika (s sklonom) ali del tocnega izgovora klicateljeve stevilke; stevk ni; najvec 2 stavka in 160 znakov;
 * pred zapisom sporocila ne sme trditi, da je zapisano/posredovano. Karkoli drugega: null (velja stalni odgovor pravil).
 */
const DOVOLJENE = new Set(
  (
    "da ne ni sem je bo bom bi ste si me mi vam vas vasa vaso vase vasega vasim vaso ga jo ji mu to tega tem te ta o v z s na za in ali pa tudi se le samo zal hvala prosim " +
    "tukaj lina jaz vi mogoce lahko morem ne vem vidim vidimo povedati povem " +
    "sporocilo sporocila sporocilu sporocilom zapisano zapisan zapisala posredovano posredovan posredovala posredujem prejeto prejel prejela " +
    "stevilka stevilko stevilke stevilki stevilkah lastnik lastnika lastniku lastnica lastnice lastnici " +
    "pomocnica pomocnico pomocnici umetna umetno umetne inteligenca inteligenco inteligence tajnica tajnico tajnice glasovna glasovno telefonska telefonsko " +
    "klic klica klicali poklicali poklicala klicatelj klicateljica dobro lepo"
  ).split(/\s+/),
);

export function varenOdgovorOsebna(odgovor: string | null | undefined, d: DejstvaOsebna): string | null {
  if (typeof odgovor !== "string") return null;
  const besedilo = odgovor.replace(/\s+/g, " ").trim();
  if (!besedilo || besedilo.length > 160 || /\d/.test(besedilo)) return null;
  if ((besedilo.match(/[.!?](\s|$)/g) ?? []).length > 2) return null;
  // Ime tudi v tozilniku (21. 11. 2026: »Poklicali ste Ano«); kratka imena (Ana -> Ano) sicer ne bi prestala primerjave po predponi.
  const imena = [d.imeLastnika, imeVTozilniku(d.imeLastnika, "")].flatMap((x) => fold(x).split(/[^\p{L}]+/u)).filter((b) => b.length >= 3);
  const stevilka = fold(d.stevilkaBesedno).replace(/[^\p{L}\s]+/gu, " ").replace(/\s+/g, " ").trim();
  const odsotnost = fold(d.odsotnost ?? "").replace(/[^\p{L}\s]+/gu, " ").replace(/\s+/g, " ").trim();
  const zloga = fold(besedilo).replace(/[^\p{L}\s]+/gu, " ").replace(/\s+/g, " ").trim();
  // Izgovor stevilke in stavek odsotnosti: samo kot TOCEN stavek iz dejstev (brez ugibanja ali obljub).
  let ostanek = ` ${zloga} `;
  if (stevilka && ostanek.includes(` ${stevilka} `)) ostanek = ostanek.replace(` ${stevilka} `, " ");
  if (odsotnost && ostanek.includes(` ${odsotnost} `)) ostanek = ostanek.replace(` ${odsotnost} `, " ");
  for (const beseda of ostanek.split(" ").filter(Boolean)) {
    if (DOVOLJENE.has(beseda)) {
      if (!d.zapisano && /^(zapis|posredova|prejet|prejel|prejela)/.test(beseda)) return null;
      continue;
    }
    if (imena.some((ime) => beseda.length >= 3 && beseda.startsWith(ime.slice(0, Math.max(3, ime.length - 2))))) continue;
    return null;
  }
  return besedilo;
}

/**
 * Razbere in PREVERI izid modela: model nikoli ne doda podatka, ki ga klicatelj ni povedal. Vsaka beseda ocisceno sporocila (3+ znakov)
 * mora biti v izreku, ime prav tako; vprasanje dobesedno iz izreka; odgovor skozi varovalo DOVOLJENEGA; sicer je izid (ali polje) neveljaven.
 */
export function razberiOsebno(surovo: string | null, izrek: string, dejstva?: DejstvaOsebna): OsebnoRazumevanje | null {
  // Izrek iz samih pozdravnih/polnilnih besed je pozdrav, ne glede na to, kaj misli model (in tudi brez modela).
  if (jeSamoPozdravnoPolnilo(izrek)) return { vrsta: "pozdrav", sporocilo: "", ime: "", vprasanje: null, odgovor: null };
  if (!surovo) return null;
  const odsek = /\{[\s\S]*\}/.exec(surovo)?.[0];
  if (!odsek) return null;
  let polje: { vrsta?: unknown; namen?: unknown; sporocilo?: unknown; ime?: unknown; vprasanje?: unknown; odgovor?: unknown; confident?: unknown };
  try {
    polje = JSON.parse(odsek) as typeof polje;
  } catch {
    return null;
  }
  const vrsta = VRSTE.find((v) => v === (polje.namen ?? polje.vrsta));
  if (!vrsta) return null;
  const besede = (t: string) => fold(t).split(/[^\p{L}\d]+/u).filter(Boolean);
  // Znana napaka prepoznave (napake-prepoznave.json: »aleš si« = »ali si«) velja SAMO za vprasanje (namen); sporocilo in ime ostaneta strogo
  // dobesedna proti surovemu izreku (skil, ZAPIS). Izmerjeno 14. 11. 2026: z novim pozivom je model vprasanje vrnil kot »ali si razumela moje
  // sporočilo«, kar dobesedna preverba brez popravka zavrne.
  const izrekBesede = besede(izrek);
  const popravljeneBesede = besede(popraviPrepoznavo(izrek));
  // CodeRabbit 14. 11. 2026: »ne pridem jutri k vam« -> model zapise »pridem jutri k vam« (obratni pomen). Zato VSE besede modela morajo biti
  // v izreku kot CELE besede in v ISTEM VRSTNEM REDU (podzaporedje), nikalnica iz izreka pa ne sme manjkati v besedilu modela. Sicer je izid
  // neveljaven in velja dobesedni izrek. Neodvisni pregled 14. 11. 2026: primerjava po PODNIZU besede je sprejela »ima« za »nima«, »sedem« za
  // »sedemnajstih«, »mogoče« za »nemogoče«, »tri« za »tristo« (nikalnica, ura in stevilo so se spremenili), zato podniz ne velja vec.
  const NIKALNICE = new Set([
    "ne", "ni", "nikoli", "brez", "nikar", "nic", "noben", "nobena", "nobeno", "nobenega", "nobene", "nisem", "nisi", "nismo", "nista", "niste", "niso",
    "nimam", "nimas", "nima", "nimamo", "nimata", "nimate", "nimajo", "nocem", "noces", "noce", "nocemo", "nocete", "nocejo", "nece", "nikakor",
    "nikamor", "nikjer", "nihce", "nikogar", "nikomur",
  ]);
  /** Ali so vse besede `iskane` v `celota` kot cele besede in v istem vrstnem redu (podzaporedje). */
  const jePodzaporedje = (iskane: string[], celota: string[]): boolean => {
    let pos = 0;
    for (const b of iskane) {
      while (pos < celota.length && celota[pos] !== b) pos += 1;
      if (pos >= celota.length) return false;
      pos += 1;
    }
    return true;
  };
  const vSporocilu = (besedilo: string, brezNikalnic = false): boolean => vZaporedju(besedilo, izrekBesede, brezNikalnic);
  const vVprasanju = (besedilo: string): boolean =>
    vZaporedju(besedilo, izrekBesede, false) || (popravljeneBesede.join(" ") !== izrekBesede.join(" ") && vZaporedju(besedilo, popravljeneBesede, false));
  function vZaporedju(besedilo: string, izrekBesede: string[], brezNikalnic: boolean): boolean {
    const mb = besede(besedilo);
    if (!jePodzaporedje(mb, izrekBesede)) return false;
    if (!brezNikalnic) {
      const stIzrek = izrekBesede.filter((b) => NIKALNICE.has(b)).length;
      const stModel = mb.filter((b) => NIKALNICE.has(b)).length;
      if (stModel < stIzrek) return false;
    }
    return true;
  }
  let sporocilo = "";
  if (vrsta === "sporocilo" || vrsta === "dopolnilo") {
    sporocilo = typeof polje.sporocilo === "string" ? polje.sporocilo.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    if (!sporocilo || !vSporocilu(sporocilo)) return null;
  }
  const imeSurovo = typeof polje.ime === "string" ? polje.ime.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  const ime = imeSurovo && vSporocilu(imeSurovo, true) ? imeSurovo : "";
  // Vprasanje v izreku: kratko in dobesedno iz izreka (cele besede izreka v istem vrstnem redu), sicer null.
  const vprSurovo = typeof polje.vprasanje === "string" ? polje.vprasanje.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const vprasanje = vprSurovo && vVprasanju(vprSurovo) ? vprSurovo : null;
  // Odgovor samo ob vprasanju in samo skozi varovalo; neveljaven odgovor = null (velja stalni odgovor pravil).
  const odgovor = vprasanje && dejstva ? varenOdgovorOsebna(typeof polje.odgovor === "string" ? polje.odgovor : null, dejstva) : null;
  // Prosnja za ponovitev po branju modela: »izrek«, ce branje izhaja iz izreka - dobesedno ali s popravljeno znano napako prepoznave (vVprasanju)
  // ali kot dopolnitev ODREZANEGA izreka (izrek ima najvec 3 besede in je cel, v istem vrstnem redu, v branju z najvec 6 besedami: »ali si
  // razumela« za »razumela«); sicer »branje«.
  const branjeBesede = besede(vprSurovo);
  const dopolnitevOdrezanega = izrekBesede.length > 0 && izrekBesede.length <= 3 && branjeBesede.length <= 6 && jePodzaporedje(izrekBesede, branjeBesede);
  const ponovitev = vrsta === "vprasanje" && vprSurovo !== "" && jePonovitev(vprSurovo) ? (vprasanje !== null || dopolnitevOdrezanega ? ("izrek" as const) : ("branje" as const)) : null;
  // Model je daljsi izrek razvrstil kot vprasanje, njegovega vprasanja pa v izreku NI: razvrstitev ni preverljiva (zmota ali navodilo v izreku),
  // zato velja pravilo kode - daljsi izrek brez vprasalnice se dopise in se ne izgubi.
  if (vrsta === "vprasanje" && vprSurovo !== "" && vprasanje === null && ponovitev === null && vsebinskeBesede(izrek).length >= 4) return null;
  return { vrsta, sporocilo, ime, vprasanje, odgovor, ...(polje.confident === false ? { negotovo: true as const } : {}), ...(ponovitev ? { ponovitev } : {}) };
}

/**
 * Modeli po vrsti (lastnik 14. 11. 2026: lite zaradi hitrosti in porabe). Izmerjeno 14. 11. 2026 (Linin projekt Vertex, lokacija global, 5 x 4 izreki):
 * gemini-3.1-flash-lite mediana ~0,8 s, p95 ~4 s (2 od 20 timeout); gemini-3-flash-preview mediana 1,1-1,8 s, p95 1,6-5 s, 0 napak. Drugi model
 * je poskus SAMO, ce prvi odpove hitro (napaka, neveljaven izid) in v skupnem roku (1,5 s) ostane cas; po izteku roka drugega modela ne poskusimo; sicer pravila kode.
 * Imena gemini-2.5-*, gemini-2.0-flash-001 in gemini-3.1-flash-lite-preview v tem projektu vrnejo 404.
 */
export const OSEBNI_MODELI = ["gemini-3.1-flash-lite", "gemini-3-flash-preview"] as const;
/** Najmanj preostalega casa, da se splaci drugi poskus. */
export const NAJMANJ_ZA_DRUGI_POSKUS_MS = 700;

/**
 * Poskusi po vrsti v SKUPNEM roku: vsak poskus je omejen s preostankom roka; prvi veljaven izid (razberiOsebno) velja. Drugi poskus samo,
 * ce ostane vsaj najmanjMs; sicer null (pravila kode).
 */
export async function prviVeljavni(
  poskusi: Array<(ostaneMs: number) => Promise<string | null>>,
  rokMs: number,
  izrek: string,
  dejstva: DejstvaOsebna,
  najmanjMs = NAJMANJ_ZA_DRUGI_POSKUS_MS,
): Promise<OsebnoRazumevanje | null> {
  const zacetek = Date.now();
  for (const [i, poskus] of poskusi.entries()) {
    const ostane = rokMs - (Date.now() - zacetek);
    if (ostane < (i === 0 ? 1 : najmanjMs)) return null;
    let casovnik: ReturnType<typeof setTimeout> | undefined;
    try {
      const meja = new Promise<null>((resolve) => {
        casovnik = setTimeout(() => resolve(null), ostane);
      });
      const surovo = await Promise.race([poskus(ostane).catch(() => null), meja]);
      const razum = razberiOsebno(surovo, izrek, dejstva);
      if (razum) return razum;
    } catch {
      // naslednji poskus
    } finally {
      if (casovnik) clearTimeout(casovnik);
    }
  }
  return null;
}

/** Null ob napaki, preseganju roka (1,5 s), neveljavnem izidu ali brez modela: takrat velja pravilo kode. */
export async function razumiOsebniIzrek(
  izrek: string,
  zadnjaLina: string,
  moznosti: { dir?: string; model?: ModelRazumevanja; rokMs?: number; dejstva?: DejstvaOsebna; prejsnji?: readonly string[]; poskusi?: Array<(ostaneMs: number) => Promise<string | null>> } = {},
): Promise<OsebnoRazumevanje | null> {
  // Pozdravna/polnila so pozdrav brez modela (in brez cakanja nanj).
  if (jeSamoPozdravnoPolnilo(izrek)) return { vrsta: "pozdrav", sporocilo: "", ime: "", vprasanje: null, odgovor: null };
  // M2 N9: izrek z vrinjenim navodilom modela sploh ne doseze (osebna pot je bila brez te zaznave); veljajo pravila kode, kot ob napaki modela.
  // Samo ta obrat: naslednji izrek brez vzorca gre normalno naprej.
  const vbrizg = zaznajVbrizg(izrek);
  if (vbrizg.nezaupano) {
    zabeleziVbrizg("izrek", vbrizg.vzorci);
    return null;
  }
  const dejstva = moznosti.dejstva ?? { imeLastnika: "", stevilkaBesedno: "", izrek: "", zapisano: false };
  const vhod = sestaviVhod(izrek, zadnjaLina, dejstva, moznosti.prejsnji ?? []);
  const rok = moznosti.rokMs ?? ROK_OSEBNEGA_RAZUMEVANJA_MS;
  if (moznosti.poskusi) return prviVeljavni(moznosti.poskusi, rok, izrek, dejstva, 50);
  const stub = moznosti.model;
  if (stub) return prviVeljavni([() => stub(NAVODILO_OSEBNEGA, vhod)], rok, izrek, dejstva);
  if (!llmOn()) return null;
  let brain: Awaited<ReturnType<typeof activeBrain>>;
  try {
    brain = await activeBrain(moznosti.dir);
  } catch {
    return null;
  }
  if (!brain) return null;
  const b = brain;
  const modeli = b.provider === "vertex" ? [...OSEBNI_MODELI] : [b.model];
  const poskusi = modeli.map(
    (model) => async (ostaneMs: number) => {
      const izid = await callProvider({ ...b, model, ...(b.provider === "vertex" ? { location: "global" } : {}), text: vhod, system: NAVODILO_OSEBNEGA, maxTokens: 220, timeoutMs: ostaneMs });
      return izid.ok ? izid.text : null;
    },
  );
  return prviVeljavni(poskusi, rok, izrek, dejstva);
}
