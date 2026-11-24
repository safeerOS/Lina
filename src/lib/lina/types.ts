/** Oblike, ki jih delita vmesnik in strežnik. Brez skrivnosti. */

import type { NastavitveOdsotnosti } from "./odsotnost.ts";
import type { NacinPrevzema } from "./ure.ts";

export type Company = {
  name: string;
  trade: string;
  phone: string;
  address: string;
  hours: string;
  about: string;
};

export type Material = {
  id: string;
  name: string;
  note: string;
};

export type Product = {
  id: string;
  name: string;
  kind: string;
  summary: string;
  /** Id materialov, iz katerih izdelek sploh delamo. */
  materialIds: string[];
};

export type Catalog = {
  company: Company;
  products: Product[];
  materials: Material[];
  /** Odgovori, ki jih lastnik doda iz seznama manjkajocih vprasanj. */
  zapiski?: Zapisek[];
  /**
   * Znanje o podjetju kot prosto besedilo (lastnik 11. 11. 2026): uporabnik ga vpise, nalozi (.txt, .md) ali ga predlaga
   * branje spletne strani. Najvec 20000 znakov. Je podatek, nikoli navodilo.
   */
  znanje?: string;
};

export type Zapisek = {
  id: string;
  vprasanje: string;
  odgovor: string;
};

/** Nastavitve, ki jih lastnik vidi pod Znanjem ali Nastavitvami. */
export type Pravila = Omit<NastavitveOdsotnosti, "nacinKlica" | "imeLastnika"> & {
  povprasevanje: string;
  prevzem: NacinPrevzema;
  cakanjeSekund: number;
  pozdrav: string;
  /** Lastnikova stevilka. Javne stevilke podjetja ne klicemo, ker je To in bi se zanka. */
  preusmeritev: string;
  /** Dodatne predpone, na primer +44. Prazno pomeni samo +386. Ni obvezno. */
  dovoljenePredpone?: string;
  /** Javni https naslov za action URL. Prazno pomeni naslov zahteve. Ni obvezno. */
  javniNaslov?: string;
  /** Lina garancije ne doloca sama. Privzeto izklopljeno. */
  garancijaVklop: boolean;
  garancijaBesedilo: string;
  /** Lina dostave ne doloca sama. Privzeto izklopljeno. */
  dostavaVklop: boolean;
  dostavaBesedilo: string;
  /** Lina roka izdelave ne doloca sama. Privzeto izklopljeno. */
  rokVklop: boolean;
  rokBesedilo: string;
  /** Odgovor, ko stikalo teme ni vklopljeno. Velja za garancijo, dostavo in rok. */
  temaOdgovor: string;
  /** Slog govora Line: samo ton in izbira besed, nikoli dejstva. */
  slog: "prijazno" | "uradno";
  /** Lastnikova navodila za pogovor (ton, vrstni red vprasanj). Ne spreminjajo dejstev, cen, rokov in razkritja UI. */
  navodila: string;
  /** Najdaljsi pogovor v minutah. Null pomeni brez omejitve. */
  najdaljsiPogovorMinut: number | null;
  /** Tisina po govoru klicatelja v sekundah (1-5), po kateri Lina odgovori. Privzeto 1. */
  tisinaPoGovoruSek: number;
  /** Uporabnik je tisino sam spremenil: v nacinu osebna potem velja njegova vrednost, sicer privzeto 3 s (14. 11. 2026). */
  tisinaNastavil?: boolean;
  /** Ogrete povezave do Googla in vnaprejsnje osvezevanje zetona (hitrejsi odgovori). Privzeto vklopljeno (izmerjeno: 160-320 ms na zahtevo). */
  toplePovezave?: boolean;
  /** Prevezava klica na stevilko za preusmeritev, ko klicatelj zeli pravo osebo ali pove nujnost (lastnik 23. 11. 2026). Privzeto vklopljeno. */
  prevezaNaZahtevo?: boolean;
  /** Prevezava med klicem samo v delovnem casu (nacin podjetje, lastnik 23. 11. 2026; urnik.ts). Privzeto vklopljeno; izklopi samo izrecen false. */
  prevezavaUrnikVklop?: boolean;
  /** Delovni cas prevezave (»pon-pet 07.00-15.00«, ura v Ljubljani); prazno = privzeto. */
  prevezavaUrnik?: string;
  /** Prosti dnevi uporabnika (LLLL-MM-DD, loceni z vejico). */
  prevezavaProstiDnevi?: string;
  /**
   * Enkratno obvestilo po posodobitvi na urnik prevezave (pregled 0.2.10, najdba 3): namestitev iz izdaje pred urnikom (v pravila.json ni
   * kljuca prevezavaUrnikVklop). Vmesnik ga pokaze samo ob vklopljeni nujni prevezavi (pravilaZaVmesnik); potrditev zapise false.
   */
  urnikObvestilo?: boolean;
  /** Osebna tajnica: navodilo za dostavo paketa (paket.ts); prazno = izklopljeno. Pove se SAMO klicatelju, ki se predstavi kot dostava. */
  paketNavodilo?: string;
  /** Navodilo za dostavo velja do vkljucno tega dne (LLLL-MM-DD); prazno = brez konca. */
  paketDo?: string;
  /** Meritev partialResultCallback (Fable 4, 14. 11. 2026): na Gather pozdrava osebnega nacina; privzeto izklopljeno. Samo stetje, brez odgovora. */
  merjenjeDelnih?: boolean;
  /** Meritev prepoznave (23. 11. 2026): izrazi kataloga NE gredo v namige; samo v pravila.json, privzeto izklopljeno. */
  izrazeKatalogaIzklop?: boolean;
  /** Pred slovesom prosi klicatelja za potrditev povprasevanja po e-posti. Privzeto izklopljeno. */
  potrditevEposta: boolean;
  /** Naslov podjetja za povprasevanja. Brez veljavnega naslova se moznost ne vklopi. */
  potrditevNaslov: string;
  /**
   * Snemanje klica v nacinu podjetje (lastnik 22. 11. 2026): privzeto vklopljeno; osebni nacin nikoli (pravila.server.ts, snemanje.server.ts).
   * Napoved pove namen in rok hrambe; posnetek ostane samo pri klicu z narocilom.
   */
  snemanjeVklop: boolean;
  /** Klicatelj lahko zavrne snemanje in Lina nadaljuje brez posnetka. Privzeto izklopljeno. */
  snemanjeZavrnitev: boolean;
  /** Hramba posnetka klica v dneh (1 do 90, privzeto 30); nato se izbrise samo posnetek. */
  snemanjeHrambaDni: number;
  /** Hramba zapiska klica nacina podjetje v dneh (1 do 3650, privzeto 90); osebni zapiski se ne brisejo sami. */
  zapiskiHrambaDni: number;
  /**
   * Pot klica: »gather« (privzeto: Twilio Gather + besedilo + sinteza) ali »live« (Twilio Media Streams <-> Gemini Live,
   * model govori neposredno; naloga-live 11. 11. 2026). Privzeto gather; live je izbira, dokler ni izmerjen z resnicnim klicem.
   */
  naPot?: "gather" | "live";
  /** Nacin klica: »podjetje« (privzeto) ali »osebna« tajnica (samo sporocilo; lastnik 14. 11. 2026). */
  nacinKlica?: "podjetje" | "osebna";
  /** Model prepoznave govora v Twilio Gather (speechModel); prazno = brez atributa. Seznam: govor-model.ts. */
  govorModel?: string;
  /** Namigi za prepoznavo (hints), vejice ali nove vrstice; samo ob izbranem modelu. */
  hintsGovor?: string;
  /**
   * Gemini + namig lokalnega prepoznavalnika RSDO (~1,6 GB RAM). Privzeto vklopljeno, ko je motor na voljo; uporabnik z malo
   * RAM ga izklopi in uporablja samo izbrani API model (lastnik 19. 11. 2026). Glej live/rsdo-namig.ts.
   */
  rsdoNamig?: boolean;
  /**
   * Dodatki na racunalniku (lastnik 19. 11. 2026): stikala so PRIVZETO IZKLOPLJENA. Vklopi jih samo uporabnik; Lina ustvari
   * osnutke neaktivne. Vklop je dovoljen sele, ko preizkus izmeri nic zunanjih povezav (telemetrija; glej dodatki.ts).
   */
  dodatki?: { paperclip: boolean; n8n: boolean; affine: boolean; programi: boolean; slovenski: boolean };
  /**
   * Nacin podjetja: podroben potek (kolicina, rok, telefon, povzetek in potrditev na koncu) namesto kratkega zakljucka po
   * povedani potrebi (lastnik 14. 11. 2026). Privzeto izklopljeno; stari potek ostane za uporabnike, ki ga zelijo.
   */
  podrobniPotek?: boolean;
  /** Ime, ki ga Lina v osebnem nacinu pove klicatelju (nastavitev uporabnika; v kodi ga ni). */
  imeLastnika?: string;
  /** Ime lastnika v tozilniku (»Poklicali ste Petra«); prazno = samodejno sklanjanje (ime-tozilnik.ts). */
  imeLastnikaTozilnik?: string;
  /** Mapa zapiskov pogovorov (G5): polna pot, ki jo izbere uporabnik. Prazno = mapa »zapiski« v podatkovni mapi Line. */
  mapaZapiskov: string;
  /** Izbirni dodatek Soniox za dobesedni zapis govora klicatelja. Privzeto izklopljeno; ucinkovito samo z lastnim kljucem. */
  sonioxVklop?: boolean;
};

/** Vprasanje, na katero katalog ni imel odgovora. */
export type Vrzel = {
  id: string;
  vprasanje: string;
  at: string;
  dodano: boolean;
};

export type LineState = {
  open: boolean;
  /** Uporabnik je zahteval odprtje; linija se odpre, ko so stalni stavki glasu pripravljeni. */
  caka?: boolean;
  /** Uporabnik je izrecno potrdil odprtje brez pripravljenega glasu. */
  brezGlasu?: boolean;
  catalog: Catalog;
  /** Null, dokler lastnik znanja še ni shranil. */
  updatedAt: string | null;
};

/** Razlog, zakaj glas Gemini ni na voljo. Hkrati kljuc besedila v besedila.ts. */
export type KodaGlasu = "glasNiVertex" | "glasNiPrijave" | "glasNapaka" | "glasPrepozen" | "glasOmejitev" | "glasOdklop";

/** Stanje glasu za vmesnik: ali so stalni stavki poteka klica pripravljeni in zakaj ne. */
export type StanjeGlasu = {
  pripravljen: boolean;
  vTeku: boolean;
  razlog: KodaGlasu | "";
  pripravljenih: number;
  vseh: number;
};

/** Stanje linije, kot ga dobi vmesnik. */
export type StanjeOdprtja = "odprta" | "odprtaBrezGlasu" | "cakaGlas" | "zaprta";

export type LinijaZGlasom = LineState & { glas: StanjeGlasu; odprtje: { stanje: StanjeOdprtja; razlog: KodaGlasu | "" } };

export type Violation = "izdelek" | "material" | "par";

export type GuardResult = {
  confirmed: boolean;
  product: Product | null;
  material: Material | null;
  requestedProduct: string | null;
  requestedMaterial: string | null;
  violations: Violation[];
  /** Očiščen odgovor, ce je klicatelj podal vprasanje in osnutek modela. */
  answer?: string;
};

/** Tajniski del zapisa klica. nujno velja samo, ce je nujnost povedal klicatelj (Lina vpraša, ne ugiba). */
export type TajniskiZapis = {
  /** Sporocilo za direktorja z besedami klicatelja (brez stika, najvec 300 znakov). */
  sporocilo: string;
  /** Osebna tajnica: DOBESEDEN izrek klicatelja (vir, brez stika); sporocilo je ocisceno. */
  izrek?: string;
  /** Zakaj klice (»klicem zaradi ...«), ce je povedal. */
  razlog: string;
  nujno: boolean;
  /** Nujnost je ze znana (klicatelj jo je povedal ali odgovoril na vprasanje): ne vprasamo znova. */
  nujnostZnana: boolean;
};

/**
 * Dogodek nujnega klica na osebnem telefonu uporabnika (obvestilo, prevezava): cas in izid, NIKOLI stevilka ali besedilo napake.
 * poskus = prevezava se je zacela, izid sledi (oglasil / neodgovor).
 */
export type NujniDogodek = {
  cas: string;
  vrsta: "obvestilo" | "prevezava";
  izid: "poslano" | "napaka" | "poskus" | "oglasil" | "neodgovor" | "omejeno";
};

export type OrderSlip = {
  customerName: string;
  phone: string;
  productName: string | null;
  materialName: string | null;
  requestedProduct: string | null;
  requestedMaterial: string | null;
  quantity: number | null;
  notes: string;
  /** Rok, ki ga je povedala stranka. Lina ga sama ne izmisli. */
  deadline?: string | null;
  /** Kdaj je klicatelj dosegljiv za povratni klic. Ni telefonska stevilka. */
  dosegljiv?: string;
  /** Podjetje, v imenu katerega klice. Prazno, ce je fizicna oseba. */
  podjetjeKlicatelja?: string;
  /**
   * Tajnica direktorja (lastnik 10. 11. 2026): sporocilo za direktorja, razlog klica in nujnost, kot jih je povedal klicatelj.
   * Zapise v istem klicu kot povprasevanje; ime, podjetje in dosegljivost so v obstojecih poljih.
   */
  tajnica?: TajniskiZapis;
  /** E-posta samo na zapisniku. V vrzeli in v dnevnik se ne pise. */
  email?: string;
  /** Oznaka, na primer ko cas pogovora potece. */
  oznaka?: string;
  /** Povprasevanje z besedami klicatelja, ko ne ustreza natanko izdelku iz kataloga. Brez stika. */
  povprasevanje?: string;
  /** Klicatelj je bil naprosen za potrditev povprasevanja po e-posti. */
  potrditevEposta?: boolean;
  confirmed: boolean;
  violations: Violation[];
};

/** Stopnje obrata klica, ki jih merimo (ms). Samo stevila, nikoli vsebina klica. */
/** zvokPrislo = od pripravljenega prvega posnetka do GET /zvok (tunel + Twilio); zvokPoslan = strezba posnetka (branje + odgovor). */
export type ImeStopnje = "podpis" | "twilioRest" | "zeton" | "razumevanje" | "parafraza" | "tts" | "zapisWav" | "zvokPrislo" | "zvokPoslan";

/** Meritev enega obrata po stopnjah. Povezava: ali je zahteva do Googla uporabila ze odprto (topla) ali novo (hladna). */
export type MerjenjeObrata = {
  ms: Partial<Record<ImeStopnje, number>>;
  povezava?: "hladna" | "topla";
  /** Stevilo odgovorov 429 in skupni cas, porabljen zanje (ms). */
  n429?: number;
  ms429?: number;
};

export type TranscriptLine = {
  role: "stranka" | "lina";
  text: string;
  /** Twilio Confidence (0-1) prepoznave govora klicatelja; primerjava modelov po klicu. Brez vsebine. */
  zaupanje?: number;
  /** Stevilo znakov, ki jih je vrnila prepoznava (pred skrivanjem stika). */
  znakov?: number;
  at: string;
  /** Cas Lininega odgovora v ms (od prejema izreka do besedila). Brez vsebine. */
  ms?: number;
  /** Cas do pripravljenega glasu v ms, ce je bil odgovor sintetiziran. */
  glasMs?: number;
  /** Cas po stopnjah (samo stevila), za p50/p95 v pregledu hitrosti. */
  merjenje?: MerjenjeObrata;
  /** Branje izreka z znano napako prepoznave (npr. »ali si« za »aleš si«), ce je Lina izrek tako razumela; izvirnik ostane v text. */
  razumljeno?: string;
  /** Del izreka, ki ga je premor odrezal (Lina je tiho cakala nadaljevanje): naslednja vrstica klicatelja ga nadaljuje. Stik se skrije po ZDRUZENEM izreku. */
  del?: true;
  /** Kdo je odlocil o odgovoru (osebna, zapisnik po obratu, Fable 2): pravila (hitra pot), model, ali rezerva (model ni odgovoril v roku ali neveljavno). */
  odlocil?: "pravila" | "model" | "rezerva";
};

export type StikKlica = {
  vprasan: boolean;
  konec: boolean;
  ime: string;
  telefon: string;
  email: string;
};

export type CallSession = {
  callSid: string;
  from: string;
  startedAt: string;
  updatedAt: string;
  status: "v-teku" | "zakljucen";
  transcript: TranscriptLine[];
  order: OrderSlip;
  /** True, ce se je klic koncal v prvih 10 s po zacetku. */
  kratek?: boolean;
  /** Koliko praznih obratov je bilo po pozdravu. */
  tisine?: number;
  /** Zaporedna stevilka zadnjega obrata. Naslednji Gather gre na to stevilko. */
  obrat?: number;
  /** Zbrani stik. Vidna stevilka iz From je telefon od zacetka klica (G4d); skrita ostane prazna, dokler je klicatelj ne pove. Povedana stevilka prepise From. */
  stik?: StikKlica;
  /** True, ko je opozorilo o izteku casa ze bilo izreceno. Slovo pride sele nato. */
  opozorjen?: boolean;
  /** Korak, ki ga vodi koda: ime, nato pomoc, nato podatki. */
  korak?: "ime" | "pomoc" | "podatki" | "potrditev";
  /** Podjetje smo vprasali najvec enkrat. */
  podjetjeVprasan?: boolean;
  /** Podatki, po katerih je Lina ze vprasala. Vsako vprasanje najvec enkrat (lastnik 10. 11. 2026). */
  vprasano?: Array<"ime" | "telefon" | "eposta" | "rok" | "dosegljiv" | "kolicina" | "izdelek" | "material" | "nujnost">;
  /** Vprasanje, na katero caka odgovor v naslednjem obratu. Odgovor na X se zapise samo v polje X. */
  caka?: "ime" | "telefon" | "eposta" | "rok" | "dosegljiv" | "kolicina" | "nujnost";
  /** Lina je v prejsnjem obratu vprasala za potrditev zapisnika: samo odgovor na to vprasanje lahko potrdi. */
  cakaPotrditev?: boolean;
  /** Kolikokrat je Lina vprasala za potrditev (prvic in najvec enkrat po popravku). */
  potrditevVprasanj?: number;
  /** Na zanikanje brez popravka je Lina ze vprasala, kaj naj popravi. */
  popravekVprasan?: boolean;
  /** Zadnji stavek, ki ga je Lina izrekla (brez povzetka s podatki): za ponovitev ob »nisem razumel«. */
  zadnjaLina?: string;
  /** Odgovori iz znanja, ki jih je Lina v tem klicu ze izrekla (zloženi): isti odgovor drugic ni ponovljen. */
  znanjePovedano?: string[];
  /** Zadnji Linin odgovor je bil kratek odgovor iz znanja (»Ponovim« ga ponovi v celoti). */
  zadnjaZnanje?: boolean;
  /** Klic je tekel v nacinu osebna tajnica: povzetek in zapisek govorita samo o kdo, sporocilu in casu. */
  nacin?: "osebna";
  /** Osebna tajnica: kolikokrat je Lina klicatelja vljudno vrnila k sporocilu. */
  osebnoNazaj?: number;
  /** Osebna tajnica je klicatelja ze enkrat prosila, naj ponovi sporocilo (slabo razumljeno). */
  osebnoPonovljeno?: boolean;
  /** Osebna tajnica: kolikokrat je klicatelj samo pozdravil (»dober dan«) in je Lina rekla »Izvolite, poslusam.«. */
  osebnoPozdravov?: number;
  /** Osebna tajnica: kolikokrat je govor med pozdravom ostal brez sporocila (najvec 2). */
  osebnoPredhodnih?: number;
  /** Osebna tajnica: stevilo obratov po zapisanem sporocilu (vprasanja, dopolnila; najvec 3). */
  osebnoDodatnih?: number;
  /** Osebna tajnica: kolikokrat je po sporocilu prisel izrek, ki ni ne vprasanje ne sporocilo (STT-smeti; drugic slovo). */
  osebnoSmeti?: number;
  /** Osebna tajnica: napotitev na 112 je bila v tem klicu ze izrecena (najvec enkrat). */
  osebnoNevarnost?: boolean;
  /** Osebna tajnica: kolikokrat je klicatelj po sporocilu prosil za cakanje (najvec 2). */
  osebnoCakanj?: number;
  /** Osebna tajnica: kolikokrat je klicatelj naredil pogovor (»kako si«; najvec 2). */
  osebnoMalo?: number;
  /** Osebna tajnica: kolikokrat je model zaznal slovo, ki ga pravila ne poznajo (prvic samo »Izvolite.«). */
  osebnoSlovoModel?: number;
  /** Stevec rabe variant fraz v tem klicu (brez ponovitve, dokler niso porabljene vse). */
  osebnoVariante?: Record<string, number>;
  /** Ponovitev je bila zaprosena, kosi se niso bili pripravljeni: predvaja se v naslednjem obratu. */
  osebnoPonovitevCaka?: boolean;
  /** Razlicica skila lina-slovenski-klici, s katero je Lina razumela klic (samo stevilka; skil, ZAPIS POGOVORA). */
  skilRazlicica?: number;
  /** Lina je vprasala »Želite, da ponovim sporočilo?« v prejsnjem obratu (pritrditev = ponovitev). */
  osebnoPonudilPonovitev?: boolean;
  /** Vprasanje o ponovitvi je bilo v klicu ze postavljeno (najvec enkrat na klic). */
  osebnoPonudilaZe?: boolean;
  /** Osebna tajnica: stanje potrditve zapisanega sporocila (»Ali sem prav razumela?«): »caka« = vprasanje je postavljeno, odgovor se caka. */
  osebnoPotrdi?: "caka" | "potrjeno" | "popravek";
  /** Osebna tajnica: zadnji Linin odgovor se je koncal s slovesom (pravilo C); tisina klic potem samo tiho konca. */
  osebnoSlovoPovedano?: boolean;
  /** Osebna tajnica: stavki o odsotnosti lastnika, ki jih je Lina v tem klicu ze izrekla (zapisek jih izpise v vrstici Odsotnost). */
  odsotnostPovedana?: string[];
  /** Vaja klica iz programa: ne gre med prave klice in narocila. */
  vaja?: boolean;
  /** Ime datoteke zapiska tega klica v mapi zapiskov (samo ime, brez poti); dopolnitev klica prepise isti zapisek. */
  zapisek?: string;
  /** Dobeseden zapis govora klicatelja (izbirni dodatek Soniox). */
  dobesedno?: string;
  /** Stavek »v najkrajsem moznem casu« je bil ze izrecen. */
  niNujnoPovedano?: boolean;
  /** Obvestila in prevezave nujnega klica na osebni telefon: cas in izid, brez stevilke (lastnik 10. 11. 2026). */
  nujniDogodki?: NujniDogodek[];
  /** Prevezava nujnega klica je bila ze poskusena (najvec enkrat na klic). */
  nujnoPrevezano?: boolean;
  /** Navodilo za dostavo paketa je bilo v tem klicu ze povedano (najvec enkrat na klic). */
  paketPovedan?: boolean;
  /**
   * Oznaka NUJNO je samo posledica neuspele prevezave na zahtevo (klicatelj nujnosti ni povedal): SMS o nujnem klicu se ne poslje in kvota
   * nujnih se ne porabi (vodja, pregled 029). Pocisti se, ko klicatelj nujnost pove.
   */
  nujnoBrezIzjave?: boolean;
  /** Po neuspeli prevezavi na zahtevo je Lina vprasala po sporocilu: naslednji izrek je sporocilo (nacin podjetje). */
  cakaSporocilo?: boolean;
  /** Uporabnik je na osebnem telefonu pritisnil 1 (sprejem nujnega klica): samo to je »oglasil« (odzivnik tipke ne pritisne). */
  nujniSprejeto?: boolean;
  povzetek?: {
    kdo: string;
    zelel: string;
    obljubila: string;
    narediti: string;
    /** Nujen klic: v povzetku in na seznamu na prvem mestu (lastnik 10. 11. 2026). */
    nujno?: boolean;
    /** Sporocilo za direktorja; brez zneskov. */
    sporocilo?: string;
    /** Osebna tajnica: cas klica (ISO). */
    cas?: string;
  };
};

export type TurnResult = {
  reply: string;
  call: CallSession;
  /** Cas obrata v ms (brez glasu). */
  ms?: number;
  /** True, ce je klic ze bil zakljucen: brez modela in brez novega zapisa. */
  nespremenjen?: boolean;
  /** Osebna: model je izrek oznacil kot nedokoncan; Lina ne odgovori in se obrat ni zapisal (voice poslusa nadaljevanje). */
  cakaNadaljevanje?: boolean;
  /** Nujen klic: Lina je povedala samo, da poskusa povezati; webhook doda Dial na osebni telefon (stevilka je samo tam). */
  prevezi?: boolean;
  /** Kosi odgovora, ki so vsak svoj posnetek (ponovitev »Zapisala sem: ...« po kosih); niso stalni. */
  posebni?: string[];
};

export type ZapisVaje = {
  ime: string;
  podjetje: string;
  povprasevanje: string;
  rok: string;
  telefon: string;
  eposta: string;
  povratniKlic: string;
  potrditevEposta: boolean;
  povzetek: NonNullable<CallSession["povzetek"]>;
};

export type OdgovorVaje = {
  id: string;
  /** Vedno true: odgovor je iz vaje in ni med pravimi klici. */
  vaja: true;
  reply: string;
  /** Cas celega odgovora v ms (besedilo in glas). */
  ms: number;
  /** Cas do besedila v ms (z modelom, brez glasu). */
  msBesedila: number;
  /** Naslovi posnetkov Lininega glasu po vrsti; prazno, ce glasu ni. */
  zvok: string[];
  koncano: boolean;
  /** Kaj bi Lina zapisala; na voljo ob koncu vaje. */
  zapis: ZapisVaje | null;
};

export type AuthView = {
  needsSetup: boolean;
  /** Geslo ni nastavljeno: vmesnik je odprt samo z istega racunalnika, geslo je neobvezno. */
  brezGesla: boolean;
  signedIn: boolean;
  /** Ali je v okolju na voljo zunanji model. Ključa ne vračamo. */
  llm: boolean;
};

export type BrainProvider = "gemini" | "vertex" | "openai" | "claude" | "grok" | "openrouter" | "omniroute" | "custom";

/**
 * Privzeti modeli, preverjeni proti javni dokumentaciji ponudnikov 24. 11. 2026: gemini-2.0-flash ugasnjen (1. 6. 2026),
 * gpt-4.1-mini zastarel (nadomestek gpt-6-luna), claude-sonnet-4-5 se umakne 30. 11. 2026 (lastnik: claude-sonnet-5-5).
 * Ce ponudnik model kljub temu ne pozna, Lina sama izbere delujocega (samodejni-model.server.ts).
 */
export const DEFAULT_BRAIN_MODELS: Record<BrainProvider, string> = {
  gemini: "gemini-3.8-flash",
  vertex: "gemini-3-flash-preview",
  openai: "gpt-6-luna",
  claude: "claude-sonnet-5-5",
  grok: "grok-4.5",
  /** ID modela ima predpono ponudnika, kot v dokumentaciji OpenRouter (npr. openai/gpt-4o). */
  openrouter: "openai/gpt-4o",
  /** Lokalni prehod OmniRoute: »auto« prepusti izbiro prehodu (seznam iz /v1/models). */
  omniroute: "auto",
  /** Lasten OpenAI-zdruzljiv streznik (freellmapi, LM Studio, Ollama): »auto« prepusti izbiro strezniku. Samo za pogovor. */
  custom: "auto",
};

/**
 * Vrstni red priporocil za samodejno izbiro modela (lastnik 24. 11. 2026: ob shranjevanju kljuca Lina sama izbere delujoc model).
 * Prvi je privzeti; seznam modelov ponudnika odloci, kateri od teh so na voljo. Imena iz javne dokumentacije 24. 11. 2026.
 */
export const PRIPOROCENI_MODELI: Record<Exclude<BrainProvider, "custom">, readonly string[]> = {
  gemini: [DEFAULT_BRAIN_MODELS.gemini, "gemini-3.6-flash", "gemini-3.5-flash-lite"],
  vertex: [DEFAULT_BRAIN_MODELS.vertex, "gemini-3.8-flash", "gemini-3.6-flash"],
  openai: [DEFAULT_BRAIN_MODELS.openai, "gpt-6.1-terra", "gpt-6.2-sol"],
  claude: [DEFAULT_BRAIN_MODELS.claude, "claude-haiku-5-5", "claude-sonnet-5", "claude-opus-5-5"],
  grok: [DEFAULT_BRAIN_MODELS.grok, "grok-4.7", "grok-4.6"],
  // Imena OpenRouter niso preverjena v dokumentaciji: drugi kandidati pridejo samo iz seznama modelov (samodejni-model.server.ts).
  openrouter: [DEFAULT_BRAIN_MODELS.openrouter],
  // OmniRoute: »auto« je vedno prvi kandidat, ostali pridejo samo s seznama prehoda (samodejni-model.server.ts).
  omniroute: [DEFAULT_BRAIN_MODELS.omniroute],
};

/**
 * Brezplacni modeli OpenRouter (lastnik 24. 11. 2026): ponudnik lahko pozive uporabi za ucenje, zato so SAMO za asistentko.
 * Siroko za zaporo klicev: vse, kar je videti brezplacno (":free" kjerkoli, openrouter/free...), velja za brezplacno.
 */
export function jeBrezplacenModel(model: string): boolean {
  const m = model.trim().toLowerCase();
  return m.includes(":free") || m.startsWith("openrouter/free");
}

/** Ozko za izpust »data_collection: deny«: samo tocen ID ponudnik/model:free ali openrouter/free. */
export function jeTocnoBrezplacen(model: string): boolean {
  return model === "openrouter/free" || /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*:free$/.test(model);
}

/**
 * Predlogi brezplacnih modelov z orodji (javni seznam openrouter.ai/api/v1/models, pricing 0, preverjeno 24. 11. 2026).
 * Seznam se hitro spreminja: rocni vnos ostane. Prvi je privzeti; kakovost slovenscine in oznak za agenta NI izmerjena (meritev C7).
 */
export const PREDLOGI_BREZPLACNIH = [
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "inclusionai/ling-3.2-flash:free",
  "openrouter/free",
] as const;
export const PRIVZETI_BREZPLACNI = PREDLOGI_BREZPLACNIH[0];
export const BREZPLACNI_SAMO_ASISTENTKA = "Brezplačni modeli so samo za asistentko.";

/** Privzeta lokacija Vertex AI. global deluje za gemini-3-flash-preview. */
export const DEFAULT_VERTEX_LOCATION = "global";

/** Ponudnik z shranjenim ključem (ključ ostane na strežniku; vidni so samo zadnji štirje znaki) in seznam njegovih modelov. */
export type ShranjenPonudnik = {
  provider: BrainProvider;
  namig: string | null;
  model: string;
  modeli: string[];
  projekt?: string | null;
  /** Naslov lastnega streznika (»custom«) ali prehoda OmniRoute (»omniroute«). */
  naslov?: string | null;
  /** Kljuc velja samo za asistentko (Kljuc za asistentko); klici ga nikoli ne dobijo. */
  samoAsistentka?: boolean;
};

/** Imena ponudnikov za izbirnik modela in seznam v nastavitvah. */
export const IME_PONUDNIKA: Record<BrainProvider, string> = {
  gemini: "Gemini",
  vertex: "Vertex AI",
  openai: "OpenAI",
  claude: "Claude",
  grok: "Grok",
  openrouter: "OpenRouter",
  omniroute: "OmniRoute",
  custom: "Lasten strežnik",
};

/** Javno stanje možganov. Cel ključ in žeton se ne vračata. */
export type BrainPublic = {
  provider: BrainProvider | null;
  model: string;
  nastavljen: boolean;
  namig: string | null;
  /** ID projekta Vertex. Ni skrivnost, žeton pa ni. */
  projekt?: string | null;
  lokacija?: string | null;
  /** Vsi ponudniki z shranjenim ključem (več hkrati). */
  shranjeni?: ShranjenPonudnik[];
  /** Izbrani model za pogovor z asistentko; null = privzeto (kot za klice). */
  pogovor?: { provider: BrainProvider; model: string } | null;
  /** Stikalo »Dovoli brezplacne modele (samo asistentka)«; privzeto izklopljeno. */
  brezplacniModeli?: boolean;
  /** Samodejna izbira ob shranjevanju: katerega je Lina izbrala ali zakaj ni preverila (ena vrstica za lastnika). */
  sporociloModela?: string;
  /** Zadnja samodejna zamenjava modela med delovanjem (model ni bil vec na voljo), ena vrstica za lastnika. */
  zamenjavaModela?: string;
};

/** Trenutna mapa. Opozorilo ne pomeni zavrnitve. */
export type StorageView = {
  ok: boolean;
  mapa: string;
  razlog: string;
  opozorila: string[];
};

/** Predlog kataloga. Locen od veljavnega kataloga, dokler lastnik ne potrdi. */
export type PredlogPodjetje = {
  id: string;
  izbrano: boolean;
  ime: string;
  opis: string;
  material: string;
  ure: string;
  stik: string;
};

export type PredlogVrstica = {
  id: string;
  izbrano: boolean;
  vrsta: "izdelek" | "material";
  ime: string;
  opis: string;
  material: string;
};

/** Cisto besedilo prebranih strani kot predlog za znanje (lastnik 11. 11. 2026). Velja sele po potrditvi. */
export type PredlogZnanje = {
  id: string;
  izbrano: boolean;
  besedilo: string;
};

/** Naslov s strani podjetja (mailto ali JSON-LD); izbran samo, ce je na domeni strani (lastnik 23. 11. 2026). */
export type PredlogEposta = {
  id: string;
  izbrano: boolean;
  naslov: string;
};

export type Predlog = {
  /** Samo gostitelj, brez poti. */
  gostitelj: string;
  strani: number;
  prazno: boolean;
  sporocilo: string;
  podjetje: PredlogPodjetje;
  vrstice: PredlogVrstica[];
  /** Besedilo strani za polje znanje; brez cen. Ni v starih predlogih. */
  znanje?: PredlogZnanje;
  /** E-posta za povprasevanja iz kontakta na strani; v pravila gre sele po potrditvi. Ni v starih predlogih. */
  eposta?: PredlogEposta;
};
