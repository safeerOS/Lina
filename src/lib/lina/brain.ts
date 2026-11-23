import { t } from "./besedila.ts";
import { fold, imaZnesek, uporabljaMateriale } from "./guards.ts";
import { poisciTelefon, razberiIme } from "./stik.ts";
import { normaliziraj, skrci, stevniki } from "./stevilke.ts";
import type { CallSession, Catalog, GuardResult, OrderSlip } from "./types.ts";

/** Besede, ki jih stranka pogosto zamenja z nasim seznamom. Niso v katalogu. */
const OUTSIDE_MATERIALS: Record<string, string> = {
  bor: "Bor",
  smreka: "Smreka",
  bukev: "Bukev",
  plastika: "Plastika",
  mdf: "MDF",
  iverka: "Iverka",
  marmor: "Marmor",
  steklo: "Steklo",
};

const OUTSIDE_PRODUCTS: Record<string, string> = {
  jahta: "Jahta",
  kavc: "Kavč",
  stol: "Stol",
  postelja: "Postelja",
  vrata: "Vrata",
};

export type Draft = {
  customerName: string;
  phone: string;
  requestedProduct: string | null;
  requestedMaterial: string | null;
  quantity: number | null;
  notes: string;
  deadline: string | null;
  confirmAsked: boolean;
};

export function emptyDraft(): Draft {
  return {
    customerName: "",
    phone: "",
    requestedProduct: null,
    requestedMaterial: null,
    quantity: null,
    notes: "",
    deadline: null,
    confirmAsked: false,
  };
}

export function draftFromOrder(order: OrderSlip): Draft {
  return {
    customerName: order.customerName,
    phone: order.phone,
    requestedProduct: order.requestedProduct ?? order.productName,
    requestedMaterial: order.requestedMaterial ?? order.materialName,
    quantity: order.quantity,
    notes: order.notes,
    deadline: order.deadline ?? null,
    confirmAsked: order.confirmed,
  };
}

/** Meja dolzine izreka. Velja tudi tu, ne samo na robu storitve. */
export const MEJA_IZREKA = 2000;

/** Rok stranke. Vprasanje in znesek nista rok narocila. Datum s pikami ni telefon. */
/** Stavek o povratnem klicu ni rok narocila (pregled G2, S5: »Pokličite me jutri popoldne.« je dal rok »jutri«). */
function jeOPovratnemKlicu(text: string): boolean {
  return /(?<![a-z])(poklic|klicite|dosegljiv|dobite me|dobim se)/.test(fold(text));
}

function zajemiRok(text: string, samoIzrecno = false): string | null {
  if (text.includes("?")) return null;
  if (jeOPovratnemKlicu(text)) return null;
  const key = fold(text);
  // Odgovor na drugo vprasanje (telefon, e-posta, povratni klic) je rok samo, ce klicatelj rece »rok«.
  if (samoIzrecno && !/\brok\b/.test(key)) return null;
  if (/^(ali|kaks|kdaj|kje|kako|zakaj|koliko|kolk)\b/.test(key)) return null;
  if (/\b(do kdaj|delate|odprti|delovni cas)\b/.test(key) && !/\brok\b/.test(key)) return null;
  if (/\brok\b/i.test(text)) {
    const datum = text.match(/\b(\d{1,2}[./]\d{1,2}[./]\d{2,4})\b/);
    if (datum && !imaZnesek(datum[1])) return datum[1];
  }
  const zRokom = text.match(/\brok\s+([^.,;?]{2,40})/i);
  if (zRokom) {
    const vrednost = zRokom[1].replace(/\s+/g, " ").trim();
    if (vrednost && !imaZnesek(vrednost) && !/^(kdaj|kje|kako|kaks)\b/i.test(vrednost)) return vrednost;
  }
  const dnevi =
    "ponedeljk\\w*|tork\\w*|sred\\w*|cetrtk\\w*|cetrtek\\w*|petk\\w*|sobot\\w*|nedelj\\w*|jutri|pojutrisnjem";
  const m = text.match(new RegExp(`\\bdo\\s+(${dnevi})\\b`, "iu"));
  if (!m || imaZnesek(m[1])) return null;
  return m[1];
}

const MESECI =
  "januar\\p{L}*|februar\\p{L}*|marc\\p{L}*|marec|april\\p{L}*|maj\\p{L}*|junij\\p{L}*|julij\\p{L}*|avgust\\p{L}*|septemb\\p{L}*|oktob\\p{L}*|novemb\\p{L}*|decemb\\p{L}*";
const DNEVI_TEDNA =
  "ponedelj\\p{L}*|tork\\p{L}*|torek|sred\\p{L}*|[cč]etrt\\p{L}*|pet(?:ek|ka|ku)|sobot\\p{L}*|nedelj\\p{L}*|jutri|pojutri[sš]njem";
const DATUM = `\\d{1,2}\\.\\s*(?:\\d{1,2}\\.(?:\\s*\\d{2,4})?|(?:${MESECI}))`;
/** Ura, ne rok: »do petih«, »do poldneva« je odgovor na vprasanje, kdaj lahko poklicemo. */
const URA = /^(kdaj|ene|enih|dveh|treh|stirih|petih|sestih|sedmih|osmih|devetih|desetih|enajstih|dvanajstih|poldne|opoldne|vecera|zdaj|sedaj|vas|tega)\b/;

const VZORCI_ROKA: RegExp[] = [
  new RegExp(`(?<![\\p{L}\\d])do\\s+(${DATUM}|\\p{L}+(?:\\s+\\p{L}+){0,2})`, "iu"),
  new RegExp(`(?<![\\d.])(${DATUM})`, "iu"),
  /(?<![\p{L}])((?:v|[cč]ez)\s+(?:\p{L}+|\d{1,2})\s+(?:dn\p{L}*|ted\p{L}*|mesec\p{L}*))/iu,
  new RegExp(
    `(?<![\\p{L}])([cč]im\\s?prej|takoj|(?:naslednji|prihodnji|ta|drugi)\\s+(?:teden|mesec)|(?:konec|sredi|za[cč]etek)\\s+(?:tedna|meseca|leta|${MESECI}))(?![\\p{L}])`,
    "iu",
  ),
  new RegExp(`(?<![\\p{L}])((?:v|za)\\s+(?:${DNEVI_TEDNA})|jutri|pojutri[sš]njem)(?![\\p{L}])`, "iu"),
];

/**
 * Rok kot ODGOVOR na Linino vprasanje »Do kdaj potrebujete izdelano narocilo?«.
 * Pregled 10. 11. 2026: »Do 15. decembra.« in »Do petka.« brez besede »rok« se nista zapisala in Lina je
 * sprasevala znova. Velja samo, ko je bil rok vprasan in se ni zapisan; vprasanje in znesek nista rok.
 */
export function razberiRokOdgovora(text: string): string | null {
  if (text.includes("?") || jeOPovratnemKlicu(text)) return null;
  for (const vzorec of VZORCI_ROKA) {
    const zadetek = vzorec.exec(text);
    if (!zadetek) continue;
    const surovo = zadetek[1].replace(/\s+/g, " ").trim();
    // Pika za stevko je del datuma (»15. 12.«), drugo koncno locilo ne.
    const vrednost = /\d\.$/.test(surovo) ? surovo : surovo.replace(/[.,;]+$/g, "");
    if (!vrednost || URA.test(fold(vrednost)) || imaZnesek(vrednost)) continue;
    return vrednost.slice(0, 40);
  }
  return null;
}

function mentioned(text: string, label: string): boolean {
  const hay = fold(text);
  const needle = fold(label);
  return needle.length > 0 && hay.includes(needle);
}

function captureName(text: string): string | null {
  return razberiIme(text, false);
}

function captureOutside(text: string, table: Record<string, string>): string | null {
  const folded = fold(text);
  for (const [key, label] of Object.entries(table)) {
    if (folded.includes(key)) return label;
  }
  return null;
}

/**
 * Odgovor na Linino vprasanje »Ali potrjujete naročilo?« (povzetek na koncu klica): "da", "ne" ali null (ni odgovor).
 * Po vprasanju veljata OBA: »Da.« in »Potrjujem.« (lastnik, 10. 11. 2026).
 * Zanikanje ima prednost (»ne potrjujem«, »ni tako«, »ne drži«). »Da« in »ja« stejeta na zacetku izreka, da veznik
 * »da« sredi stavka ni potrditev. Namera (»naročila bi«, »želim naročiti«, »bi vzel«) ni potrditev.
 */
export function odgovorNaPotrditev(text: string): "da" | "ne" | null {
  const kljuc = fold(text).replace(/[.!?,;:]+/g, " ").replace(/\s+/g, " ").trim();
  if (!kljuc) return null;
  if (/^(ne|ni|nikakor)\b|\b(ne potrjujem|ne drzi|ni tako|ni prav|ni res|narobe|napacno|ne strinjam)\b/.test(kljuc)) return "ne";
  if (/^(da|ja|jap|seveda|tocno|drzi|velja|prav|ok|okej|lahko|v redu|tako je|potrjujem|potrdim|se strinjam|strinjam se)\b/.test(kljuc)) return "da";
  if (/\b(potrjujem|potrdim|drzi|tako je|v redu|se strinjam|strinjam se)\b/.test(kljuc)) return "da";
  return null;
}

/**
 * »Da, ampak ...« po povzetku je popravek, ne potrditev (lastnik, 10. 11. 2026): veznik ampak/vendar/toda ali
 * izrecen popravek. Veznik »da« sredi stavka ni signal; samo ti vezniki na zacetku ali za »da«.
 */
export function jeSignalPopravka(text: string): boolean {
  return /\b(ampak|vendar|toda|popravi|popravite|popravek|spremenite)\b/.test(fold(text));
}

/**
 * Kolicina z besedami (G4g, 5. klic: >>dve mizi<< ni bilo prepoznano, ker je stara preverba samo stevke). Dve poti:
 * (1) Lina je ravno vprasala po kolicini: prvo stevilo 1-99 v izreku (>>dve<<, >>deset kosov<<, >>5<<);
 * (2) sicer samo stevilo TAKOJ pred besedo izdelka (koren iz kataloga, >>kos<<): >>dve mizi<<, >>dva stola<<, >>pet kosov<<.
 * Mere (>>dva metra<<), roki (>>dva tedna<<) in telefon tako niso kolicina.
 */
export function zajemiKolicino(text: string, katalog: Catalog, vprasana: boolean): number | null {
  const f = skrci(normaliziraj(text));
  const korenih = [
    ...katalog.products.flatMap((izdelek) => [izdelek.name, izdelek.kind]),
    ...Object.keys(OUTSIDE_PRODUCTS),
  ]
    // Vrsta ima lahko vec besed (>>jedilna miza<<): koren vsake, ker klicatelj pove samo samostalnik.
    .flatMap((beseda) => skrci(beseda ?? "").split(/\s+/))
    .filter((beseda) => beseda.length >= 3)
    .map((beseda) => beseda.slice(0, Math.max(3, beseda.length - 1)));
  for (const s of stevniki(text)) {
    if (s.denar || !Number.isInteger(s.value) || s.value < 1 || s.value > 9999) continue;
    // Po vprasanju o kolicini samo 1-99 (kot prej); z izrecno enoto (»sto kosov«, »petsto nalepk«) tudi vec (14. 11. 2026).
    if (vprasana && s.value <= 99) return s.value;
    const naslednja = /^\s*([a-z0-9]+)/.exec(f.slice(s.end))?.[1] ?? "";
    if (!naslednja) continue;
    if (/^kos(?:a|e|ov|u|om)?$/.test(naslednja)) return s.value;
    if (korenih.some((koren) => naslednja.startsWith(koren) && naslednja.length <= koren.length + 3)) return s.value;
  }
  return null;
}

/** Doda, kar je stranka povedala. Ne potrjuje nicesar mimo kataloga. */
export function absorbUtterance(
  prior: Draft,
  text: string,
  catalog: Catalog,
  moznosti: { rokVprasan?: boolean; drugoVprasanje?: boolean; potrditevVprasana?: boolean; kolicinaVprasana?: boolean } = {},
): Draft {
  const omejen = text.slice(0, MEJA_IZREKA);
  const next: Draft = { ...prior, confirmAsked: prior.confirmAsked };
  const name = captureName(omejen);
  if (name) next.customerName = name;

  const phone = poisciTelefon(omejen);
  if (phone && !prior.phone) next.phone = phone;

  const qty = omejen.match(/(\d{1,3})\s*(?:kos|kose|kosov|miz[ae]?)/i);
  if (qty) next.quantity = Number(qty[1]);
  else {
    const kolicina = zajemiKolicino(omejen, catalog, Boolean(moznosti.kolicinaVprasana));
    if (kolicina !== null) next.quantity = kolicina;
  }

  const size = omejen.match(
    /(\d+(?:[.,]\d+)?\s*(?:x|×)\s*\d+(?:[.,]\d+)?(?:\s*(?:x|×)\s*\d+(?:[.,]\d+)?)?\s*(?:cm|mm|m)?)/i,
  );
  if (size) {
    const note = size[1].replace(/\s+/g, " ").trim();
    if (!next.notes.includes(note)) next.notes = next.notes ? `${next.notes}; ${note}` : note;
  }

  const deadline = zajemiRok(omejen, moznosti.drugoVprasanje) ?? (moznosti.rokVprasan ? razberiRokOdgovora(omejen) : null);
  if (deadline) next.deadline = deadline;

  const products = [...catalog.products].sort((a, b) => b.name.length - a.name.length);
  const namedProduct = products.find((item) => mentioned(omejen, item.name));
  if (namedProduct) next.requestedProduct = namedProduct.name;
  else if (!next.requestedProduct) {
    const byKind = catalog.products.filter((item) => item.kind && mentioned(omejen, item.kind));
    if (byKind.length === 1) next.requestedProduct = byKind[0].name;
  }
  const outsideProduct = captureOutside(omejen, OUTSIDE_PRODUCTS);
  if (outsideProduct) next.requestedProduct = outsideProduct;

  const materials = [...catalog.materials].sort((a, b) => b.name.length - a.name.length);
  const namedMaterial = materials.find((item) => mentioned(omejen, item.name));
  const outsideMaterial = captureOutside(omejen, OUTSIDE_MATERIALS);
  if (outsideMaterial) next.requestedMaterial = outsideMaterial;
  else if (namedMaterial) next.requestedMaterial = namedMaterial.name;

  // Potrditev je samo odgovor NA Linino vprasanje (lastnik 10. 11. 2026). Zelja ali namera (»rada bi naročila«,
  // »naročil bi«) in »potrjujem«, izrecen pred vprasanjem, zapisnika ne potrdita: do G3e je ze beseda »naročila«
  // pri znanem izdelku in materialu dala »Zapisnik je potrjen«.
  if (moznosti.potrditevVprasana && odgovorNaPotrditev(omejen) === "da") next.confirmAsked = true;
  return next;
}

export function slipFromGuard(draft: Draft, guard: GuardResult, caller: string): OrderSlip {
  return {
    customerName: draft.customerName,
    phone: draft.phone,
    productName: guard.product?.name ?? null,
    materialName: guard.material?.name ?? null,
    requestedProduct: guard.requestedProduct,
    requestedMaterial: guard.requestedMaterial,
    quantity: draft.quantity,
    notes: draft.notes,
    deadline: draft.deadline,
    confirmed: guard.confirmed && draft.confirmAsked,
    violations: guard.violations,
  };
}

function listNames(items: Array<{ name: string }>): string {
  return items.map((item) => item.name).join(", ");
}

/** Stavek, ko sta izdelek in material znana iz kataloga. Stalni posnetek (glej stavkiIzKataloga). */
export function stavekZapisa(izdelek: string, material: string): string {
  return `Zapisala sem ${izdelek} iz materiala ${material}.`;
}

/** Katalog brez materialov: izdelek je dovolj, material se ne omenja. Stalni posnetek (glej stavkiIzKataloga). */
export function stavekZapisaBrezMateriala(izdelek: string): string {
  return `Zapisala sem ${izdelek}.`;
}

/** Stavek, ko je znan samo izdelek: Lina vprasa po materialu. Stalni posnetek (glej stavkiIzKataloga). */
export function stavekMateriala(izdelek: string, materiali: string[]): string {
  return `Za ${izdelek} potrebujem material. Na voljo je: ${materiali.join(", ")}.`;
}

/**
 * Odgovor, ko je znan samo material (G4k): stalni posnetek za vsak material. Izmerjeno 11. 11. 2026: ker ni bil
 * stalen, je sinteza trajala ~3,5 s (cela meja zahteve) + »Trenutek« - klicatelj je cakal na vsak povedan material.
 */
export function stavekSamoMaterial(material: string, izdelki: string): string {
  if (!izdelki.trim()) return `Material ${material} imamo. Kateri izdelek želite?`;
  return `Material ${material} imamo. Kateri izdelek želite? Delamo: ${izdelki}.`;
}

/** Odgovor, ko ni znan ne izdelek ne material (G4k): stalni posnetek, da klicatelj ne caka na sintezo. */
export function stavekBrezIzdelka(izdelki: string, zMateriali = true): string {
  // Prazen katalog: nobenega »Delamo: .«, Lina samo vabi k povprasevanju.
  if (!izdelki.trim()) return t("povejteNarocilo");
  return `${zMateriali ? "Povejte izdelek in material." : "Povejte izdelek."} Delamo: ${izdelki}.`;
}

/** Prava slovenska nanizanka: »a, b in c«. */
function nanizaj(deli: string[]): string {
  if (deli.length <= 1) return deli.join("");
  return `${deli.slice(0, -1).join(", ")} in ${deli[deli.length - 1]}`;
}

/** H1: odgovor iz kataloga (stalni posnetek, kot stavki G4k): vrsta izdelka in ime (ime samo je klicatelju nerazumljivo). Brez cen in rokov. */
export function odgovorKatalog(katalog: Catalog, materialId: string | null): string {
  const material = materialId ? katalog.materials.find((m) => m.id === materialId) : undefined;
  const izbrani = material ? katalog.products.filter((p) => p.materialIds.includes(material.id)) : katalog.products;
  const imena = (seznam: typeof katalog.products) => nanizaj(seznam.map((p) => [p.kind, p.name].filter(Boolean).join(" ")));
  if (material && izbrani.length === 0) {
    return `Materiala ${material.name} pri izdelkih nimamo. Izdelujemo: ${imena(katalog.products)}. Kateri izdelek vas zanima?`;
  }
  if (material) {
    return `Material ${material.name} uporabljamo pri teh izdelkih: ${imena(izbrani)}. Kateri izdelek vas zanima?`;
  }
  return `Izdelujemo: ${imena(izbrani)}. Kateri izdelek vas zanima?`;
}

/** Najvec toliko stavkov iz kataloga se pripravi vnaprej: sinteza stane, velik katalog ne sme zadrzati odprtja linije. */
export const NAJVEC_STALNIH_IZ_KATALOGA = 40;

/**
 * Znani odgovori iz kataloga kot stalni stavki (lastnik, 10. 11. 2026: predloge iz kataloga brez modela in kot stalne
 * posnetke): vsak dovoljen par izdelek+material in vsak izdelek, ki caka na material. Ti odgovori se tako predvajajo
 * takoj, brez sinteze med klicem in brez vmesnega stavka.
 */
export function stavkiIzKataloga(catalog: Catalog): string[] {
  const pari: string[] = [];
  const izdelki: string[] = [];
  for (const izdelek of catalog.products) {
    const materiali = catalog.materials.filter((material) => izdelek.materialIds.includes(material.id));
    if (!izdelek.name.trim() || materiali.length === 0) continue;
    for (const material of materiali) pari.push(stavekZapisa(izdelek.name, material.name));
    izdelki.push(stavekMateriala(izdelek.name, materiali.map((material) => material.name)));
  }
  // G4k: odgovora »samo material« in »nic znanega« (seznam vseh izdelkov); prednost imajo pari in izdelki.
  const imena = listNames(catalog.products);
  if (!uporabljaMateriale(catalog)) for (const izdelek of catalog.products) if (izdelek.name.trim()) pari.push(stavekZapisaBrezMateriala(izdelek.name));
  const splosni = imena ? [stavekBrezIzdelka(imena, uporabljaMateriale(catalog)), ...catalog.materials.filter((m) => m.name.trim()).map((m) => stavekSamoMaterial(m.name, imena))] : [];
  // H1: odgovor na vprasanje »kateri izdelki« (vsi in po materialu) je tudi stalni posnetek.
  const seznami = catalog.products.length ? [odgovorKatalog(catalog, null), ...catalog.materials.filter((m) => m.name.trim()).map((m) => odgovorKatalog(catalog, m.id))] : [];
  return [...pari, ...izdelki, ...splosni, ...seznami].slice(0, NAJVEC_STALNIH_IZ_KATALOGA);
}

/** Kratek, preverjen odgovor. Zunanji model ga sme samo parafrazirati. */
export function renderReply(catalog: Catalog, draft: Draft, guard: GuardResult, fresh: boolean): string {
  const hello = fresh ? "Dober dan, Lina pri telefonu. " : "";
  const products = listNames(catalog.products);
  const materials = listNames(catalog.materials);

  if (guard.violations.includes("izdelek")) {
    return `${hello}Izdelka ${guard.requestedProduct} ne izdelujemo. Delamo: ${products}.`;
  }
  if (guard.violations.includes("material")) {
    return `${hello}Materiala ${guard.requestedMaterial} ne uporabljamo in ga ne morem obljubiti. Na seznamu je: ${materials}.`;
  }
  if (guard.violations.includes("par") && guard.product && guard.material) {
    const allowed = catalog.materials.filter((item) => guard.product?.materialIds.includes(item.id));
    return `${hello}${guard.product.name} ne delamo iz materiala ${guard.material.name}. Na voljo je: ${listNames(allowed)}.`;
  }
  if (guard.confirmed && draft.confirmAsked) {
    // »ni dan« in »ni podatka« sta oznaki v zapisu, ne ime za izgovor.
    const who = draft.customerName && !/^ni (dan|podatka)$/.test(draft.customerName) ? ` za ${draft.customerName}` : "";
    const qty = draft.quantity ? `, ${draft.quantity} kos` : "";
    const izMateriala = guard.material ? ` iz materiala ${guard.material.name}` : "";
    return `${hello}Zapisnik je potrjen${who}: ${guard.product?.name}${izMateriala}${qty}.`;
  }
  if (guard.product && guard.material) {
    return `${hello}${stavekZapisa(guard.product.name, guard.material.name)}`;
  }
  if (guard.product && !uporabljaMateriale(catalog)) {
    return `${hello}${stavekZapisaBrezMateriala(guard.product.name)}`;
  }
  if (guard.product) {
    const allowed = catalog.materials.filter((item) => guard.product?.materialIds.includes(item.id));
    return `${hello}${stavekMateriala(guard.product.name, allowed.map((item) => item.name))}`;
  }
  if (guard.material) {
    return `${hello}${stavekSamoMaterial(guard.material.name, products)}`;
  }
  return `${hello}${stavekBrezIzdelka(products, uporabljaMateriale(catalog))}`;
}

export function wantsHangup(text: string): boolean {
  // »Ne, hvala.« in »To bo vse.« sta odgovor na ponudeno pomoc (meritev vodje 10. 11. 2026: klic se ni koncal).
  return /\b(nasvidenje|adijo|to je vse|to bo vse|nic vec|nic drugega|konec klica)\b/.test(fold(text)) || /^ne,?\s+hvala\b/.test(fold(text));
}

export function emptyOrder(caller: string): OrderSlip {
  return {
    customerName: "",
    phone: "",
    productName: null,
    materialName: null,
    requestedProduct: null,
    requestedMaterial: null,
    quantity: null,
    notes: "",
    deadline: null,
    confirmed: false,
    violations: [],
  };
}

export function freshCall(callSid: string, from: string, now: string): CallSession {
  return {
    callSid,
    from,
    startedAt: now,
    updatedAt: now,
    status: "v-teku",
    transcript: [],
    order: emptyOrder(from),
  };
}
