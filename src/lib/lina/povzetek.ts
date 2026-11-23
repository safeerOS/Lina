import { t } from "./besedila.ts";
import { imeVTozilniku } from "./ime-tozilnik.ts";
import { brezZneska, fold, imaZnesek } from "./guards.ts";
import { signalDenarja } from "./plast.ts";
import { odsotnostStavek, type NastavitveOdsotnosti } from "./odsotnost.ts";
import { najdiStavekNarocila, NAJVECJA_KOLICINA } from "./narocilo-stavek.ts";
import { jeVidnaStevilka } from "./stik.ts";
import { sporociloBrezZneska } from "./tajnica.ts";
import type { CallSession } from "./types.ts";

/** Stavek, ki ga uporabnik ne more zbrisati. */
export const OBVEZNI_POZDRAV = t("obvezniPozdrav");

/** Nastavitve snemanja, ki dolocajo napoved (nacin podjetje). */
export type SnemanjePozdrava = { nacinKlica?: string; snemanjeVklop?: boolean; snemanjeHrambaDni?: number } | null | undefined;

/**
 * Stavek o zapisovanju v nacinu podjetje. S snemanjem (lastnik 22. 11. 2026, ZEKom-2 clen 214) napoved pove namen IN rok hrambe;
 * rok je vedno iz nastavitve snemanjeHrambaDni (preizkus zaklene, da se ujemata). Brez snemanja ostane »Pogovor zapisujem za narocilo.«.
 */
export function stavekZapisa(snemanje?: SnemanjePozdrava): string {
  if (snemanje && snemanje.nacinKlica !== "osebna" && snemanje.snemanjeVklop === true) {
    const dni = Math.max(1, Math.round(Number(snemanje.snemanjeHrambaDni) || 30));
    return t("pozdravSnemaZapis").replace("{dni}", () => String(dni));
  }
  return t("pozdravZapis");
}

/** Klic, ki se konca v prvih 10 sekundah po zacetku (pozdrav). */
export const KRATEK_KLIC_MS = 10_000;

/**
 * Lastnikov dodatek k pozdravu brez obveznega stavka in brez vsakega stavka o pomoci.
 * Pregled 10. 11. 2026: dodatek »Kako vam lahko pomagamo?« je prehitel vprasanje po imenu, ker smo
 * odrezali samo natancni niz. Vrstni red doloci koda: razkritje, ime in podjetje, sele nato pomoc.
 */
export function dodatekLastnika(dodatek: string): string {
  if (!dodatek.trim() || signalDenarja(dodatek)) return "";
  const stavki = dodatek.split(OBVEZNI_POZDRAV).join(" ").split(t("pozdravZapis")).join(" ").replace(/Pogovor snemam in zapisujem[^.]*\.(?:[^.]*\bdni\.)?/g, " ").match(/[^.!?]+[.!?]*/g) ?? [];
  return stavki
    .filter((stavek) => !/\bpomaga\w*|\bpomoc(?:i|jo)?\b/.test(fold(stavek)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Lina v prvem stavku ze pozdravi (»Dober dan, tukaj Lina ...«). Ce uporabnik v dodatku zacne z istim pozdravom,
 * se ta na zacetku dodatka izpusti (lastnik 11. 11. 2026: »brez dvojnega pozdrava«); ostalo besedilo ostane
 * dobesedno, samo z veliko zacetnico. Razkritje umetne inteligence ostane v prvem stavku.
 */
const UVODNI_POZDRAV = /^\s*(?:dober dan|dobro jutro|dober ve[cč]er|good (?:day|morning|afternoon|evening))\b[\s,.!:;-]*/i;
export function brezPonovljenegaPozdrava(extra: string): string {
  const brez = extra.replace(UVODNI_POZDRAV, "").replace(/\s+/g, " ").trim();
  return brez ? brez[0].toLocaleUpperCase("sl-SI") + brez.slice(1) : brez;
}

/**
 * Prvi stavek predstavitve. Ce je uporabnik napisal SVOJ pozdrav (dodatek), ta odloca, kako se klic zacne
 * (lastnik 11. 11. 2026, izbira C: »Dober dan, tukaj Lina, pomocnica z umetno inteligenco« in za njim uporabnikov
 * pozdrav DOBESEDNO, brez »pri {podjetje iz kataloga}«, ker je uporabnik podjetje ze povedal po svoje). Brez dodatka
 * ostane privzeta predstavitev s podjetjem.
 */
function prviStavekPredstavitve(extra: string, podjetje: string): string {
  if (extra) return t("predstavitevBrez");
  return podjetje.trim() ? `${t("predstavitev")} ${podjetje.trim()}.` : t("predstavitevBrez");
}

/**
 * Privzeti pozdrav: »Dober dan, {podjetje}«, obvezni stavek, »Kako vam lahko pomagam?«.
 * Dodatek lastnika gre namesto uvodnega stavka, obveznega dela ne zbrise.
 */
export function sestaviPozdrav(dodatek: string, podjetje = ""): string {
  const konec = t("kakoPomagam");
  const extra = dodatekLastnika(dodatek);
  const uvod = extra || (podjetje.trim() ? `Dober dan, ${podjetje.trim()}.` : "Dober dan.");
  return `${uvod} ${OBVEZNI_POZDRAV} ${konec}`.replace(/\s+/g, " ").trim();
}

/**
 * Prvi stavek vedno razkrije umetno inteligenco.
 * Lastnikov pozdrav gre za njim, da razkritja ne more zbrisati.
 * Kako pomagam pride sele po imenu, zato ga tu ni.
 */
export function predstavitevKlica(dodatek: string, podjetje = "", snemanje?: SnemanjePozdrava): string {
  return deliPredstavitve(dodatek, podjetje, snemanje).join(" ");
}

/**
 * Isti stavki kot v predstavitvi, vsak zase: glas jih pripravi vnaprej in predvaja brez cakanja.
 * Razkritje UI je ze v prvem stavku (»pomocnica z umetno inteligenco«); drugi stavek pove samo se zapisovanje.
 * Prej je sledil se »Sem AI asistentka ...« (lastnik, 10. 11. 2026, po drugem pravem klicu: predstavitev samo enkrat).
 */
export function deliPredstavitve(dodatek: string, podjetje = "", snemanje?: SnemanjePozdrava): string[] {
  const extra = brezPonovljenegaPozdrava(dodatekLastnika(dodatek));
  const prvi = prviStavekPredstavitve(extra, podjetje);
  return [prvi, extra, stavekZapisa(snemanje), t("prosiImeInPodjetje")]
    .map((kos) => kos.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Osebna tajnica (lastnik, 14. 11. 2026): samo razkritje UI, »Poklicali ste ...« in edino vprasanje. */
export function jeOsebna(pravila: { nacinKlica?: string }): boolean {
  return pravila.nacinKlica === "osebna";
}

export function osebniDeli(dodatek: string, imeLastnika: string, odsotnost = "", imeTozilnik = "", snemanje = false): string[] {
  const extra = brezPonovljenegaPozdrava(dodatekLastnika(dodatek));
  const ime = imeLastnika.replace(/\s+/g, " ").trim();
  // Ime v tozilniku (lastnik 21. 11. 2026: »Poklicali ste Petra«, ne »Peter«); rocni zapis uporabnika ima prednost (ime-tozilnik.ts).
  const poklicali = ime ? t("osebnaPoklicali").replace("{ime}", () => imeVTozilniku(ime, imeTozilnik)) : t("osebnaPoklicaliBrez");
  // Razkritje UI je vedno prvi stavek; pozdrav po meri gre za njim. Besedilo: lastnik 14. 11. 2026 (brez »Dober dan«, »Kaj naj sporočim?«).
  // Odsotnost uporabnika (15. 11. 2026, odsotnost.ts): dejstvo iz nastavitev takoj po »Poklicali ste ...«, pred edinim vprasanjem; prazno, ce ne velja.
  // Obvestilo o zapisovanju (lastnik 22. 11. 2026, zakon) takoj za razkritjem UI; s snemanjem zvoka »snema in zapisuje«.
  const zapis = t(snemanje ? "osebnaSnemaZapis" : "osebnaZapis");
  return [t("osebnaPredstavitev"), zapis, extra, poklicali, odsotnost, t("osebnaKajSporocim")].map((k) => k.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** Zakljucek osebne tajnice: zahvala in slovo v enem stavku za glas (en sam zahtevek sinteze). */
export function osebniZakljucek(): string {
  // Brez »lep dan« (lastnik 14. 11. 2026).
  return [t("osebnaHvala"), t("osebnaKonec")].join(" ");
}

/**
 * Razkritje UI spredaj (lastnik: »vedno pove, da je AI asistentka, tak je zakon«; 14. 11. 2026): stavki, ki so lahko PRVI v klicu (zasedeno, zaprto,
 * napaka, oprostilo), se zacnejo z zacetkom pozdrava nacina. Ce prvi stavek razkritje ze ima, ostane, kot je.
 */
export function zRazkritjem(pravila: { nacinKlica?: string } | null, besedilo: string): string {
  const prvi = besedilo.trim().split(/(?<=[.!?])\s/)[0] ?? "";
  if (/umetno inteligenco|artificial intelligence/i.test(prvi)) return besedilo;
  const razkritje = pravila && jeOsebna(pravila) ? t("osebnaPredstavitev") : t("predstavitevBrez");
  return `${razkritje} ${besedilo}`.replace(/\s+/g, " ").trim();
}

/** Prvi govor klica: predstavitev glede na nacin. Razkritje UI je vedno prvi stavek. */
export function uvodKlica(
  pravila: { pozdrav: string; nacinKlica?: string; imeLastnika?: string; imeLastnikaTozilnik?: string; snemanjeVklop?: boolean; snemanjeHrambaDni?: number } & NastavitveOdsotnosti,
  podjetje = "",
  zdaj: Date = new Date(),
): string {
  return jeOsebna(pravila) ? osebniDeli(pravila.pozdrav, pravila.imeLastnika ?? "", odsotnostStavek(pravila, zdaj), pravila.imeLastnikaTozilnik ?? "").join(" ") : predstavitevKlica(pravila.pozdrav, podjetje, pravila);
}

/** Razkritje spredaj, ce prva replika ni bila prazen pozdrav. Vprasanja ne doda. */
export function razkritjeSpredaj(reply: string, dodatek: string, podjetje = "", snemanje?: SnemanjePozdrava): string {
  const extra = brezPonovljenegaPozdrava(dodatekLastnika(dodatek));
  const prvi = prviStavekPredstavitve(extra, podjetje);
  const stavek = reply.trim().split(/(?<=[.!?])\s/)[0] ?? "";
  if (/umetno inteligenco|artificial intelligence/i.test(stavek)) return reply;
  const zapis = stavekZapisa(snemanje);
  const obv = reply.includes(OBVEZNI_POZDRAV) || reply.includes(zapis) ? "" : zapis;
  return [prvi, extra, obv, reply].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function jeKratekKlic(startedAt: string, endedAt: string): boolean {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const diff = end - start;
  return diff >= 0 && diff <= KRATEK_KLIC_MS;
}

/** Vzorcni in lokalni klic iz vmesnika ne gresta v delez. */
export function jeKlicIzVmesnika(call: { callSid?: string; from?: string }): boolean {
  const sid = (call.callSid ?? "").toLowerCase();
  if (sid === "preizkus" || sid.startsWith("lokalno-") || sid.startsWith("vzorec-") || sid.startsWith("pisarna-")) {
    return true;
  }
  const from = (call.from ?? "").trim().toLowerCase();
  return from === "pisarna" || from === "vzorec";
}

export function delezKratkih(
  calls: Array<{ callSid?: string; from?: string; startedAt: string; updatedAt: string; status: string; kratek?: boolean }>,
): { kratki: number; koncani: number; delez: number; odstotki: number } {
  const done = calls.filter((call) => call.status === "zakljucen" && !jeKlicIzVmesnika(call));
  const kratki = done.filter((call) =>
    typeof call.kratek === "boolean" ? call.kratek : jeKratekKlic(call.startedAt, call.updatedAt),
  ).length;
  const delez = done.length === 0 ? 0 : kratki / done.length;
  return {
    kratki,
    koncani: done.length,
    delez,
    odstotki: Math.round(delez * 100),
  };
}

export type Povzetek = {
  kdo: string;
  zelel: string;
  obljubila: string;
  narediti: string;
  /** Nujen klic: v povzetku na prvem mestu (lastnik 10. 11. 2026). */
  nujno?: boolean;
  /** Sporocilo za direktorja, brez zneskov in stika. */
  sporocilo?: string;
  /** Osebna tajnica: cas klica (ISO). */
  cas?: string;
};

function brezPoste(text: string): string {
  return text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, " ").replace(/\s+/g, " ").trim();
}

function brez(text: string): string {
  const cisto = brezPoste(text);
  if (!imaZnesek(cisto)) return cisto;
  return brezPoste(brezZneska(cisto));
}

/**
 * Besedilo povzetka. Brez zvoka in brez cene v obljubi.
 * Rok se pojavi samo, ce ga je stranka sama povedala.
 */
export function povzetekKlica(call: CallSession, inquiry?: string): Povzetek {
  const order = call.order;
  if (call.nacin === "osebna") {
    // Osebna tajnica (lastnik, 14. 11. 2026): samo kdo (ime, sicer stevilka), sporocilo in cas. Brez ponudbe, narocila, cen.
    const ime = order.customerName && order.customerName !== t("niDan") && order.customerName !== t("niPodatka") ? order.customerName : "";
    const stevilka = order.phone || call.stik?.telefon || (jeVidnaStevilka(call.from) ? call.from : "");
    const sporociloOsebno = order.tajnica?.sporocilo ? sporociloBrezZneska(order.tajnica.sporocilo) : "";
    return {
      kdo: brez(ime || stevilka || t("neznanKlicatelj")),
      zelel: sporociloOsebno || t("osebnaBrezSporocila"),
      obljubila: "",
      narediti: "",
      ...(sporociloOsebno ? { sporocilo: sporociloOsebno } : {}),
      cas: call.startedAt,
    };
  }
  const brezImena = order.customerName === t("niDan") || order.customerName === t("niPodatka");
  const ime = order.customerName && !brezImena ? order.customerName : "";
  const kdo = brez(ime || t("neznanKlicatelj"));
  const kosi = [
    order.productName || order.requestedProduct,
    order.materialName || order.requestedMaterial,
    order.quantity ? `${order.quantity} kos` : "",
    order.notes,
    order.deadline ? `rok ${order.deadline}` : "",
  ].filter(Boolean);
  const imaIzdelek = Boolean(order.productName || order.requestedProduct);
  if (!imaIzdelek && order.povprasevanje) kosi.unshift(`»${order.povprasevanje}«`);
  // Povprasevanje z besedami klicatelja, ko izdelka iz kataloga ni izbral.
  const sporocilo = order.tajnica?.sporocilo ? sporociloBrezZneska(order.tajnica.sporocilo) : "";
  const zelel = brez(kosi.join(", ") || order.povprasevanje || sporocilo || "Ni povedal izdelka.");
  const obljuba = order.confirmed
    ? `Potrdila sem ${order.productName ?? "izdelek"}${order.materialName ? ` iz materiala ${order.materialName}` : ""}. Cene nisem navedla.`
    : "Nisem potrdila narocila in nisem obljubila cene ali roka.";
  const narediti = brez((inquiry ?? "").trim() || t("povprasevanje"));
  return {
    kdo,
    zelel,
    obljubila: brez(obljuba),
    narediti,
    ...(order.tajnica?.nujno ? { nujno: true } : {}),
    ...(sporocilo ? { sporocilo } : {}),
  };
}

/**
 * Povzetek na koncu klica (lastnik, 10. 11. 2026): Lina ponovi, kar je razumela, in nato vprasa »Ali potrjujete
 * naročilo?«. Uvod in vprasanje sta stalna stavka (pripravljen posnetek); vmes je samo zbrano, brez izmisljanja.
 * Polja brez podatka (»ni podatka«, »ni dan«) se ne ponavljajo. E-naslova ne bere. Stavek o povratnem klicu (G4g, lastnik
 * 11. 11. 2026) je PO potrditvi, skupaj s prosnjo za e-posto (service.server.ts: zakljucekZbiranja), ne v povzetku.
 */
export function povzetekZaPotrditev(call: CallSession): string {
  return [t("povzetekUvod"), ...deliPovzetka(call), t("potrditevVprasanje")].join(" ");
}

/** Klic s skrito številko: obljube »poklicali vas bomo na številko, s katere kličete« ne moremo izpolniti. */

/**
 * Telefonske številke povzetek NE bere (G4c, lastnik 11. 11. 2026: glas Kore sl-SI jo bere z angleškimi števkami).
 * Namesto nje stalni stavek (pripravljen posnetek, brez sinteze med klicem). Številka, ki jo klicatelj pove, ostane v zapisu klica.
 */
export function stalniStikPovzetka(call: CallSession): string[] {
  // G4d: klicatelj je povedal drugo stevilko -> povratni klic gre nanjo, stavka »s katere klicete« ni.
  const tel = call.stik?.telefon ?? "";
  const drugaStevilka = tel !== "" && tel !== call.from && jeVidnaStevilka(tel);
  return jeVidnaStevilka(call.from) && !drugaStevilka ? [t("povzetekStik")] : [];
}

/**
 * Besede dneva, ki jih glas izgovori napačno, v enakovredno obliko (meritev 11. 11. 2026, 4 od 4 ponovitev): »pojutrišnjem«
 * glas razdeli v »po jutrišnjem«; »čez dva dni« je bilo v vseh ponovitvah slišano prav. Ostale dni (danes, jutri,
 * v ponedeljek) glas v naravnem stavku bere prav in ostanejo. Nov popravek izgovora dodaj SEM.
 */
export function govorjenCas(besedilo: string): string {
  return besedilo.replace(/pojutri[sš]njem/giu, "čez dva dni");
}

/**
 * Govorjeno besedilo za rok izdelave (G4c, G4e): kos stavka narocila (>>, rok pa je do petka<<); sam (brez izdelka, na zacetku)
 * je svoj stavek (>>Rok je do petka.<<). Zapis >>Rok: petka.<< je glas izgovoril brez oznake (>>Petka.<<, >>Pentka<<).
 * Dan v rodilniku (shranjen brez >>do<<) in datum dobita >>do<<.
 */
export function govorjenRok(rok: string, sam = false, jezik: "sl" | "en" = "sl"): string {
  const cas = govorjenCas(rok.replace(/\s+/g, " ").trim().replace(/[.!?]+$/g, ""));
  // G4g: datum z mesecem (>>petnajstega decembra<<) dobi >>do<< tako kot dan v tednu; izrazi z lastnim predlogom ali
  // casovno besedo (>>do 15. decembra<<, >>konec decembra<<) ostanejo, kot so.
  const mesec = /\b(?:januarja|februarja|marca|aprila|maja|junija|julija|avgusta|septembra|oktobra|novembra|decembra)\b/iu.test(cas);
  const lastniPredlog = /^(?:do|po|[cč]ez|v|ob|na|pred|konec|sredi|za[cč]etek)\b/iu.test(cas);
  const rodilnik = /^(?:ponedeljka|torka|srede|[cč]etrtka|petka|sobote|nedelje)$/iu.test(cas) || /^\d/.test(cas) || (mesec && !lastniPredlog);
  return t(sam ? "povzetekRokSam" : "povzetekRok", jezik).replace("{rok}", () => (rodilnik ? `${t("povzetekRokDo", jezik)} ${cas}` : cas));
}

/**
 * Govorjeno besedilo za dan in čas povratnega klica (G4c). ENA točka za zamenjavo izgovora: meritev 11. 11. 2026 (glej
 * poročilo G4c): zapis »Povratni klic: Jutri popoldne.« glas izgovori brez oznake in s kratko besedo na začetku;
 * v naravnem stavku (»Poklicali vas bomo jutri popoldne.«) je bila beseda ob vsaki ponovitvi izgovorjena prav.
 * Začetnica besede dneva je mala, ker stoji sredi stavka. Prazno, ko v besedilu ni časa.
 */
export function govorjenDosegljiv(dosegljiv: string, brezObljube = false): string {
  let cas = govorjenCas(dosegljiv).replace(/\s+/g, " ").trim().replace(/[.!?]+$/g, "");
  // Izrecen stavek klicatelja (»pokličite me jutri popoldne«, »dosegljiv sem po 15. uri«): ostane samo čas.
  cas = cas.replace(/^pokli[cč]ite(?:\s+(?:me|nas|naju))?(?:\s+nazaj)?(?:\s+|$)/iu, "").replace(/^dosegljiv\w*(?:\s+sem)?\s+/iu, "");
  if (!cas || /^pokli[cč]\w*$/iu.test(cas)) return "";
  const mala = cas.charAt(0).toLocaleLowerCase("sl") + cas.slice(1);
  return t(brezObljube ? "povzetekDosegljivZapis" : "povzetekDosegljiv").replace("{rok}", () => mala);
}

/** Klicatelj je ze povedal, kaj zeli (izdelek, material, kolicina ali prosto povprasevanje). */
export function imaPovprasevanje(call: CallSession): boolean {
  const o = call.order;
  return Boolean(o.requestedProduct || o.productName || o.quantity || o.requestedMaterial || o.materialName || o.povprasevanje);
}

function prazniPodatki(): Set<string> {
  return new Set([t("niPodatka"), t("niDan"), ""]);
}

export function imaPodatek(v: string | null | undefined): v is string {
  return typeof v === "string" && !prazniPodatki().has(v.trim());
}

/**
 * Stavek narocila (G4e, lastnik 11. 11. 2026: naj narocilo lepse izgovori): izdelek, material, kolicina in rok so EN
 * tekoc stavek, kot bi ga povedala tajnica (>>Narocate izdelek Alba iz materiala Hrast, v kolicini 2, rok pa je do petka.<<),
 * ne vrsta kratkih stavkov z oznakami. Imena izdelka in materiala se ne sklanjajo (tvegano): ostanejo v imenovalniku za
 * stalnim besedilom. Prazno, ko ni ne izdelka ne prostega povprasevanja ne roka.
 */
export function stavekNarocila(call: CallSession, jezik: "sl" | "en" = "sl"): string {
  const o = call.order;
  const izdelek = o.productName ?? o.requestedProduct;
  const material = o.materialName ?? o.requestedMaterial;
  let stavek = "";
  if (imaPodatek(izdelek)) {
    // G4f: stavek s sklonjenim izdelkom in besedno kolicino (>>Narocate dve mizi iz materiala hrast<<), ce ga je predpriprava
    // pripravila in prestal varovala. Tu samo bere pomnilnik (brez cakanja, brez modela); sicer oblika B.
    const kolicina = o.quantity;
    const pripravljen =
      jezik === "sl" && typeof kolicina === "number" && kolicina >= 1 && kolicina <= NAJVECJA_KOLICINA
        ? najdiStavekNarocila({ izdelek: izdelek.trim(), material: imaPodatek(material) ? material.trim() : "", kolicina })
        : undefined;
    if (pripravljen) {
      stavek = pripravljen;
    } else {
      stavek = t("povzetekIzdelek", jezik).replace("{izdelek}", () => izdelek);
      if (imaPodatek(material)) stavek += t("povzetekMaterial", jezik).replace("{material}", () => material);
      if (o.quantity) stavek += t("povzetekKolicina", jezik).replace("{kolicina}", () => String(o.quantity));
    }
  } else if (imaPodatek(o.povprasevanje)) {
    stavek = o.povprasevanje.replace(/[.!?\s]+$/g, "");
  }
  if (!imaPodatek(o.deadline)) return stavek ? `${stavek}.` : "";
  return stavek ? `${stavek}${govorjenRok(o.deadline, false, jezik)}.` : govorjenRok(o.deadline, true, jezik);
}

/**
 * Podatki povzetka, vsak kot svoj kos glasu (G4b): stavek narocila (G4e: izdelek, material, kolicina, rok), ime, povratni
 * klic (telefon od G4c ne vec). Vsak kos je svoj posnetek, zato se lahko sintetizira ze takrat, ko je podatek zbran, in
 * ne sele ob zadnjem obratu. Povratni klic je zadnji, ker ga klicatelj pove kot zadnjega. Polja brez podatka se ne ponavljajo.
 */
export function deliPovzetka(call: CallSession): string[] {
  const stik = call.stik;
  const o = call.order;
  const deli: string[] = [];
  const narocilo = stavekNarocila(call);
  if (narocilo) deli.push(narocilo);
  if (imaPodatek(stik?.ime)) deli.push(t("povzetekIme").replace("{ime}", () => stik?.ime ?? ""));
  // Telefona ni (G4c): namesto njega stalni stavek v povzetekZaPotrditev.
  if (imaPodatek(o.dosegljiv) && o.dosegljiv !== "ni-nujno") {
    // Pri sporocilu za direktorja Lina NE obljubi, da bo direktor poklical ob tem casu (lastnik 10. 11. 2026): samo zapis.
    const dosegljiv = govorjenDosegljiv(o.dosegljiv, Boolean(o.tajnica?.sporocilo));
    if (dosegljiv) deli.push(dosegljiv);
  }
  // Tajniski del: sporocila ne beremo (stik, zneski, glas); povemo samo, da je zapisano in ali je nujno.
  if (o.tajnica?.sporocilo) deli.push(t("povzetekSporocilo"));
  if (o.tajnica?.nujno) deli.push(t("nujnoZapisano"));
  return deli;
}

/**
 * Podatki povzetka, ki jih je smiselno pripraviti vnaprej: samo klic, ki ima povprasevanje (sicer povzetka ni). Stavek
 * narocila (G4e) je en kos, ki se s podatki spreminja: dokler roka ni, bi bila predpriprava zavrzena sinteza ob
 * vsakem novem podatku, zato se pripravi sele z rokom; brez roka se sintetizira ob povzetku (kot pred G4b).
 */
export function deliZaPredpripravo(call: CallSession): string[] {
  if (!imaPovprasevanje(call)) return [];
  const narocilo = stavekNarocila(call);
  const brezRoka = !imaPodatek(call.order.deadline);
  return deliPovzetka(call).filter((kos) => !(brezRoka && kos === narocilo));
}

/** Ali je odgovor povzetek na koncu klica (uvod in vprasanje sta stalna stavka). */
export function jePovzetek(odgovor: string): boolean {
  return odgovor.includes(t("povzetekUvod")) && odgovor.includes(t("potrditevVprasanje"));
}

/** Povzetek za potrditev v dnevniku brez podatkov klicatelja (ime, telefon): ostane uvod in vprasanje. */
export function povzetekBrezPodatkov(besedilo: string): string {
  const uvod = t("povzetekUvod");
  const vprasanje = t("potrditevVprasanje");
  const od = besedilo.indexOf(uvod);
  const do_ = besedilo.lastIndexOf(vprasanje);
  if (od < 0 || do_ < od) return besedilo;
  return `${besedilo.slice(0, od)}${uvod} ${t("povzetekVZapisniku")} ${besedilo.slice(do_)}`.replace(/\s+/g, " ").trim();
}
