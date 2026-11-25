/**
 * Vstop modula ucenje-lh (edina datoteka, ki jo Lina uvozi, prek ucenje-lh-vrata.server.ts): Lina se iz lastnikovega navodila nauci
 * postopka kot ucne enote, jo uporabi v naslednjih pogovorih, izmeri mejo znanja, preveri razumevanje po koraku in ponavlja.
 *
 * Metoda: LearnHarness (github.com/amosblomqvist/learnharness, commit 069a6a1), Copyright (C) Amos Blomqvist, AGPL-3.0-only
 * - izmeri, nato nacrtuj, nato poucuj (src/agent/system-prompt.md); en korak, ena preverba (teacher/20-teaching.md).
 * Spremenil Safeer (team@safeer.si), 25. 11. 2026: nova koda okoli prirejenih navodil (pozivi.ts); modul NIMA omrezja - model klice
 * samo prek funkcije, ki jo poda Lina (Linin izbrani ponudnik); brez spletnega iskanja, narekovanja, posodobitev (B9).
 * Licenca: AGPL-3.0 (LICENSE v tej mapi).
 */
import { randomUUID } from "node:crypto";
import {
  NAJVEC_ENOT,
  NAJVEC_IZKUSENJ,
  NAJVEC_IZKUSENJ_NA_TIP,
  ROK_SEJE_MS,
  besediloEnote,
  cisto,
  jeKonec,
  jeNameraSestave,
  jeNameraUre,
  jeRelevantna,
  najdiEnoto,
  naslednjaPonovitev,
  oceniRezerva,
  poMerjenju,
  poPreverbi,
  predstaviKorak,
  razberiOceno,
  sestaviEnoto,
  sredina,
  zapadliKoraki,
  znanih,
  type Enota,
  type IzkusnjaLH,
  type StanjeLH,
} from "./enota.ts";
import { BESEDILO_MERJENJA, BESEDILO_NEPREVERJENO, NAVODILO_OCENE, NAVODILO_SESTAVE, UVOD_ODSEKA } from "./pozivi.ts";
import { UCENJE_LH_DATOTEKA, preberiStanjeLH, vVrsti, zapisiStanjeLH } from "./shramba.server.ts";

export { UCENJE_LH_DATOTEKA };

/** Klic modela, ki ga poda Lina (Linin ponudnik). Modul sam nima nobene poti v omrezje. */
export type KlicModela = (z: { system: string; text: string; maxTokens: number; najvecZnakov: number }) => Promise<string | null>;

export type PregledEnote = { id: string; naslov: string; korakov: number; znanih: number; ustvarjeno: string; koraki: string[] };
export type PregledLH = { vklopljen: boolean; enote: PregledEnote[]; izkusenj: number };

const pregled = (s: StanjeLH): PregledLH => ({
  vklopljen: s.vklopljen,
  enote: s.enote.map((e) => ({ id: e.id, naslov: e.naslov, korakov: e.koraki.length, znanih: znanih(e), ustvarjeno: e.ustvarjeno, koraki: e.koraki.map((k) => k.besedilo) })),
  izkusenj: s.izkusnje.length,
});

const UKAZ_KOLEDARJU = /^\s*(lina[,:]?\s*)?(opomni me|dodaj (dogodek|opomnik|zapisek)|nov (dogodek|opomnik|zapisek)|zapi[sš]i si)/i;
const IZHOD = "Uro kadarkoli končate z »konec«";
const datum = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("sl-SI", { timeZone: "Europe/Ljubljana" }) : "");

async function oceni(klic: KlicModela, e: Enota, i: number, odgovor: string): Promise<{ razume: boolean; manjka: string }> {
  const k = e.koraki[i]!;
  const text =
    `POSTOPEK: ${e.naslov}\nKORAK ${i + 1}: ${k.besedilo}\nRAZLAGA: ${k.razlaga}\nVPRAŠANJE: ${k.vprasanje}\nBISTVO: ${k.bistvo.join(", ")}\n` +
    `ODGOVOR UČENCA: ${odgovor.slice(0, 1500)}`;
  try {
    const r = await klic({ system: NAVODILO_OCENE, text, maxTokens: 300, najvecZnakov: 600 });
    const o = r ? razberiOceno(r) : null;
    if (o) return o;
  } catch {
    // rezerva spodaj
  }
  return oceniRezerva(odgovor, k.bistvo);
}

function zacniUro(s: StanjeLH, e: Enota, zdaj: Date): string {
  const zapadli = zapadliKoraki(e, zdaj);
  const zePreverjen = e.napredek.some((n) => n.preverjen);
  if (zePreverjen && zapadli.length > 0) {
    s.seja = { enotaId: e.id, faza: "ponavljanje", lo: 0, hi: e.koraki.length, korak: zapadli[0]!, vrsta: zapadli, zadnjic: zdaj.toISOString() };
    return `Ponoviva »${e.naslov}« (najprej najšibkejši koraki: ${zapadli.length}). ${IZHOD}\n${predstaviKorak(e, zapadli[0]!)}`;
  }
  if (zePreverjen) return `»${e.naslov}« znate; naslednja ponovitev: ${datum(naslednjaPonovitev(e))}.`;
  const n = e.koraki.length;
  s.seja = { enotaId: e.id, faza: "merjenje", lo: 0, hi: n, korak: 0, vrsta: [], zadnjic: zdaj.toISOString() };
  const m = sredina(0, n);
  return `${BESEDILO_MERJENJA} ${IZHOD}\nVprašanje (korak ${m + 1}/${n}): ${e.koraki[m]!.vprasanje}`;
}

function konecUre(s: StanjeLH, e: Enota): string {
  s.seja = null;
  return `Konec ure »${e.naslov}«: preverjenih korakov ${znanih(e)}/${e.koraki.length}. Naslednjič ponoviva ${datum(naslednjaPonovitev(e))} (recite »ponoviva ${e.naslov}«).`;
}

async function odgovorNaUro(s: StanjeLH, e: Enota, besedilo: string, klic: KlicModela, zdaj: Date): Promise<string> {
  const seja = s.seja!;
  seja.zadnjic = zdaj.toISOString();
  const n = e.koraki.length;
  if (seja.faza === "merjenje") {
    const m = sredina(seja.lo, seja.hi);
    const o = await oceni(klic, e, m, besedilo);
    if (o.razume) e.napredek[m] = poPreverbi(e.napredek[m]!, true, zdaj);
    const p = poMerjenju(seja.lo, seja.hi, o.razume);
    seja.lo = p.lo;
    seja.hi = p.hi;
    if (!p.konec) return `${o.razume ? "Prav." : "Zabeleženo."} Vprašanje (korak ${sredina(p.lo, p.hi) + 1}/${n}): ${e.koraki[sredina(p.lo, p.hi)]!.vprasanje}`;
    if (p.lo >= n) {
      const nepreverjeni = e.napredek.some((x) => !x.preverjen);
      return `${konecUre(s, e)}${nepreverjeni ? ` ${BESEDILO_NEPREVERJENO}` : ""}`;
    }
    seja.faza = "pouk";
    seja.korak = p.lo;
    const nepreverjeni = e.napredek.slice(0, p.lo).some((x) => !x.preverjen);
    return `Meja: vaše znanje postopka se konča pri ${p.lo + 1}. koraku, tam začneva.${nepreverjeni ? ` ${BESEDILO_NEPREVERJENO}` : ""}\n\n${predstaviKorak(e, p.lo)}`;
  }
  const i = seja.faza === "pouk" ? seja.korak : seja.vrsta[0]!;
  const o = await oceni(klic, e, i, besedilo);
  e.napredek[i] = poPreverbi(e.napredek[i]!, o.razume, zdaj);
  // en korak, ena preverba: brez dokaza ni naslednjega koraka (LearnHarness teacher/20-teaching.md)
  if (!o.razume) return `Ni še čisto.${o.manjka ? ` ${o.manjka}` : ""} Še enkrat (${IZHOD.toLowerCase()}):\n${predstaviKorak(e, i)}`;
  let naslednji: number | undefined;
  if (seja.faza === "pouk") {
    seja.korak = i + 1;
    naslednji = seja.korak < n ? seja.korak : undefined;
  } else {
    seja.vrsta = seja.vrsta.slice(1);
    naslednji = seja.vrsta[0];
  }
  if (naslednji === undefined) return konecUre(s, e);
  return `Prav.\n\n${predstaviKorak(e, naslednji)}`;
}

/**
 * Lastnikovo sporocilo: vrne odgovor Line, ce ga obdela modul (sestava enote, ura, odgovor v uri), sicer null (obicajen pogovor).
 * Odloca koda iz lastnikovega besedila, nikoli oznaka modela.
 */
async function obdelajSporocilo(root: string, besedilo: string, klic: KlicModela, zdaj: Date = new Date(), odrezano = false, koledar = false): Promise<string | null> {
  return vVrsti(root, async () => {
    const s = await preberiStanjeLH(root);
    if (!s.vklopljen) return null;
    if (s.seja && zdaj.getTime() - Date.parse(s.seja.zadnjic) > ROK_SEJE_MS) s.seja = null;
    // nova enota ali ura za drugo/isto enoto ima prednost pred odgovorom v uri (sicer bi jo ura ocenila kot odgovor)
    const nova = jeNameraSestave(besedilo) || (jeNameraUre(besedilo) && najdiEnoto(s.enote, besedilo) !== null);
    // izrecen ukaz za koledar med uro (»opomni me ...«) gre koledarju, ura ostane na istem koraku; odgovor, ki samo omeni opomnik, se oceni
    if (s.seja && !nova && koledar && UKAZ_KOLEDARJU.test(besedilo)) return null;
    if (s.seja && !nova) {
      const e = s.enote.find((x) => x.id === s.seja!.enotaId);
      if (e && jeKonec(besedilo)) {
        s.seja = null;
        await zapisiStanjeLH(root, s);
        return `Prekinila sem uro »${e.naslov}«. Napredek je shranjen.`;
      }
      if (e) {
        const odg = await odgovorNaUro(s, e, besedilo, klic, zdaj);
        await zapisiStanjeLH(root, s);
        return odg;
      }
      s.seja = null;
    }
    if (jeNameraSestave(besedilo)) {
      let odgovorModela: string | null = null;
      try {
        odgovorModela = await klic({ system: NAVODILO_SESTAVE, text: besedilo, maxTokens: 2000, najvecZnakov: 6000 });
      } catch {
        odgovorModela = null;
      }
      const enota = sestaviEnoto(besedilo, odgovorModela, randomUUID(), zdaj);
      if (!enota) return null;
      const ista = s.enote.findIndex((e) => e.naslov.toLowerCase() === enota.naslov.toLowerCase());
      if (ista < 0 && s.enote.length >= NAJVEC_ENOT) return `Učnih enot je že ${NAJVEC_ENOT}; izbrišite kakšno v Nastavitvah, pa shranim novo.`;
      if (ista >= 0) s.enote[ista] = { ...enota, id: s.enote[ista]!.id };
      else s.enote.push(enota);
      s.seja = null;
      await zapisiStanjeLH(root, s);
      console.info(`lina ucenje-lh: enota shranjena (korakov=${enota.koraki.length}, enot=${s.enote.length}, model=${odgovorModela ? 1 : 0})`);
      return (
        `Shranila sem učno enoto »${enota.naslov}« (${enota.koraki.length} korakov${odgovorModela ? "" : ", preverbe brez modela"}). ` +
        `Vidna je v Nastavitvah, kjer jo lahko izbrišete. Ko želite, recite »preveri me iz ${enota.naslov.toLowerCase()}«: najprej izmerim, kaj že znate, nato greva korak za korakom.` +
        (odrezano ? ` Opozorilo: sporočilo je bilo daljše od dovoljenega in je odrezano; preverite v Nastavitvah, ali so shranjeni vsi koraki.` : "")
      );
    }
    if (jeNameraUre(besedilo)) {
      const e = najdiEnoto(s.enote, besedilo);
      if (!e) return null;
      const odg = zacniUro(s, e, zdaj);
      await zapisiStanjeLH(root, s);
      return odg;
    }
    return null;
  });
}

/** Odsek za sistemsko navodilo obicajnega pogovora: relevantne enote kot podatek. Prazno ob izklopu ali brez zadetka. */
async function odsekPogovora(root: string, besedilo: string): Promise<string> {
  const s = await preberiStanjeLH(root);
  if (!s.vklopljen) return "";
  const rel = s.enote.filter((e) => jeRelevantna(e, besedilo)).slice(-2);
  if (!rel.length) return "";
  return `\n\n${UVOD_ODSEKA} (lastnik jih lahko vadi z »preveri me iz <postopek>«):\n${rel.map(besediloEnote).join("\n\n")}`;
}

/**
 * Orkestrator (naloga 8): ucne enote lastnika, ki ustrezajo cilju, in zadnje izkusnje istega tipa naloge, kot podatek. Prazno ob izklopu.
 * Tip je ze normiran (Linina koda), besedila so ociscena ob branju (shramba).
 */
async function zaNalogo(root: string, tip: string, cilj: string): Promise<Array<{ naslov: string; besedilo: string }>> {
  const s = await preberiStanjeLH(root);
  if (!s.vklopljen) return [];
  const enote = s.enote.filter((e) => jeRelevantna(e, cilj)).slice(-2).map((e) => ({ naslov: `Postopek ${e.naslov}`, besedilo: besediloEnote(e) }));
  const izk = s.izkusnje.filter((i) => i.tip === tip).slice(-5).reverse().map((i) => ({ naslov: i.naslov, besedilo: i.besedilo }));
  return [...enote, ...izk];
}

/** Zapis izkusnje orkestratorja (besedilo sestavi Linina koda iz polj). Ob izklopu ali nepricakovani datoteki nic. */
function zapisiIzkusnjo(root: string, i: IzkusnjaLH): Promise<boolean> {
  return vVrsti(root, async () => {
    const s = await preberiStanjeLH(root);
    const besedilo = cisto(i.besedilo, 600);
    if (!s.vklopljen || !/^[a-z0-9-]{1,40}$/.test(i.tip) || !besedilo) return false;
    const istega = s.izkusnje.filter((x) => x.tip === i.tip).slice(-(NAJVEC_IZKUSENJ_NA_TIP - 1));
    const drugi = s.izkusnje.filter((x) => x.tip !== i.tip);
    s.izkusnje = [...drugi, ...istega, { tip: i.tip, naslov: cisto(i.naslov, 80) || "Izkusnja", besedilo }].slice(-NAJVEC_IZKUSENJ);
    await zapisiStanjeLH(root, s);
    return true;
  });
}

export const ucenjeLH = {
  obdelajSporocilo,
  odsekPogovora,
  zaNalogo,
  zapisiIzkusnjo,
  stanje: async (root: string): Promise<PregledLH> => pregled(await preberiStanjeLH(root)),
  nastavi: (root: string, vklop: boolean): Promise<PregledLH> =>
    vVrsti(root, async () => {
      const s = await preberiStanjeLH(root);
      s.vklopljen = vklop;
      if (!vklop) s.seja = null;
      await zapisiStanjeLH(root, s);
      return pregled(s);
    }),
  izbrisi: (root: string, id: string): Promise<PregledLH> =>
    vVrsti(root, async () => {
      const s = await preberiStanjeLH(root);
      const prej = s.enote.length;
      s.enote = s.enote.filter((e) => e.id !== id);
      if (s.seja?.enotaId === id) s.seja = null;
      if (s.enote.length !== prej) await zapisiStanjeLH(root, s);
      return pregled(s);
    }),
  izbrisiVse: (root: string): Promise<PregledLH> =>
    vVrsti(root, async () => {
      const s = await preberiStanjeLH(root);
      s.enote = [];
      s.seja = null;
      s.izkusnje = [];
      await zapisiStanjeLH(root, s);
      return pregled(s);
    }),
};
