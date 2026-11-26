/**
 * Naloga 19 (lastnik 25. 11. 2026, F2): prava orodja orkestratorja. Vsako ima definicijo (JSON shema), razred tveganja in potrditev:
 * - branje brez potrditve: seznam_mape, preberi_datoteko (samo dovoljene mape lastnika, brez skritih poti in mape podatkov Line,
 *   meja velikosti), poisci_v_znanju (naucena znanja in spomin pogovorov, samo branje);
 * - splet (razred zunanje, brez potrditve): isci_splet (Brave), preberi_stran (splet.ts: javni https, IP preverjen pred povezavo,
 *   robots, meje; prazna stran prek TinyFish, ce je kljuc). Zahteva na splet nese podatke VEN (naslov, poizvedba), zato caka lastnika,
 *   ko je naloga okuzena ali je ze prebrala zasebne lokalne podatke (potrditevPoZasebnih);
 * - pisanje (vedno enkratna potrditev lastnika): zapisi_datoteko (nikoli prepis brez izrecnega prepisi, brez brisanja), ustvari_opomnik.
 * Izvedbe ukazov ni (ukazi lupine samo prek agentov s peskovnikom). Izid je nezaupan podatek: ovije in preveri ga orkestrator.
 * Komentarji brez sumnikov.
 */
import { lstat, open, readdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { OrodjeOrkestratorja } from "./orkestrator.ts";
import type { SpletOdv } from "./splet.ts";
import type { Vir } from "./brave.server.ts";
import { KAKOVOSTI_SLIK, RAZMERJA_SLIK, izberiGeneratorSlik, type KakovostSlike, type MoznostiGeneriranja } from "./slike-generator.server.ts";
import { resolveDataDir } from "./store.server.ts";
import { vidniZnaki } from "./claude-naloge.ts";
import { zakrijSkrivnosti } from "./cilj-naloge.ts";

export type OdvisnostiOrodij = {
  /** DNS in povezava HTTPS (preizkus: lazni splet); privzeto splet.server.ts. */
  splet?: Pick<SpletOdv, "razresi" | "povezava">;
  /** Spletno iskanje; privzeto iskanjeBrave z lastnikovim kljucem. */
  isci?: (poizvedba: string) => Promise<Vir[] | null>;
  /** Branje strani brez vidnega besedila; privzeto TinyFish z lastnikovim kljucem. */
  tinyfish?: (naslov: string) => Promise<string | null>;
  /** Naloga 20 (preizkus): nastavitev mozganov za izbiro generatorja in odvisnosti generatorja slik. */
  slike?: Pick<MoznostiGeneriranja, "fetch" | "zeton" | "prevedi" | "nakljucno"> & { mozgani?: () => Promise<{ provider?: unknown; project?: unknown } | null> };
};

/** Naloga 20: slik na nalogo (ustvari_sliko je brez potrditve, zato je meja edina zavora porabe kreditov). */
export const NAJVEC_SLIK_NA_NALOGO = 8;
const ROK_SLIKE_MS = 3 * 60_000;

/** Najvecja datoteka za branje (vecjo naj bere agent s peskovnikom). */
export const NAJVEC_BAJTOV_DATOTEKE = 2_000_000;
/** Znakov na en klic preberi_datoteko (pod mejo ovojnice orkestratorja 8000); naprej z argumentom od. */
export const KOS_DATOTEKE = 6000;
const NAJVEC_VNOSOV_MAPE = 200;
const NAJVEC_ZNAKOV_ZAPISA = 200_000;
const ROK_SPLETA_MS = 90_000;

const napaka = (n: string) => ({ ok: false as const, napaka: n });
const znotraj = (koren: string, p: string) => {
  const rel = path.relative(koren, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/** Naloga 19b N11: imena datotek s skrivnostmi (zasebni kljuci, poverilnice, stanje terraform, okolje) orodje ne bere. */
const SKRIVNOSTNO_IME = /^(?:id_(?:rsa|dsa|ecdsa|ed25519)|.+\.(?:pem|key|p12|pfx|kdbx|tfstate(?:\.backup)?)|credentials.*\.json|secrets?\..+|\.env.*|\.netrc|\.pgpass)$/i;

/**
 * Pot za orodje: absolutna, brez .. in kontrolnih znakov; v dovoljeni mapi lastnika, brez skritega dela, ne v mapi podatkov Line ali nad
 * njo, ne v prepovedani mapi, pri branju ne datoteka s skrivnostmi. Naloga 19b N7: vse preverbe NAJPREJ po zapisu (brez dostopa do diska),
 * sele nato po realpath (beri) ali realpath nadmape (pisi): odgovor za pot zunaj dovoljenih map ne izda, ali tam kaj obstaja.
 */
async function dovoljenaPot(root: string, surova: unknown, nacin: "beri" | "pisi"): Promise<{ pot: string; prepovedane: string[] } | { napaka: string }> {
  if (typeof surova !== "string" || !path.isAbsolute(surova) || /[\u0000-\u001f\u007f]/.test(surova) || surova.split(/[\\/]+/).includes("..")) {
    return { napaka: "Pot mora biti absolutna, brez .. in brez kontrolnih znakov." };
  }
  const { mejeOrodijOrkestratorja } = await import("./claude-naloge.server.ts");
  const m = await mejeOrodijOrkestratorja(root);
  if (!m.dovoljene.length) return { napaka: m.razlog ?? "Ni dovoljenih map: lastnik jih doda v zavihku Racunalnik (dovoljene mape)." };
  const preveri = (p: string): string | null => {
    const koren = m.dovoljene.find((k) => znotraj(k, p));
    if (!koren) return "Pot ni v dovoljeni mapi lastnika.";
    if (path.relative(koren, p).split(/[\\/]+/).some((d) => d.startsWith("."))) return "Skrite poti (ime s piko) niso dovoljene.";
    if (znotraj(m.podatki, p) || znotraj(p, m.podatki)) return "Mapa podatkov Line ni dovoljena.";
    if (m.prepovedane.some((x) => znotraj(x, p))) return "Mapa je prepovedana.";
    if (nacin === "beri" && SKRIVNOSTNO_IME.test(path.basename(p))) return "Datoteka s skrivnostmi (kljuc, poverilnice, okolje) ni dovoljena.";
    return null;
  };
  // shortcut: dovoljene so kanonicne poti, zato je pot prek druge povezave (alias) zavrnjena; model dobi prave poti iz seznam_mape
  const poZapisu = preveri(path.normalize(surova));
  if (poZapisu) return { napaka: poZapisu };
  let prava: string;
  if (nacin === "beri") {
    const r = await realpath(surova).catch(() => null);
    if (!r) return { napaka: "Pot ne obstaja." };
    prava = r;
  } else {
    const nad = await realpath(path.dirname(surova)).catch(() => null);
    if (!nad) return { napaka: "Nadmapa ne obstaja (mape orodje ne ustvarja)." };
    prava = path.join(nad, path.basename(surova));
  }
  const poRealpath = preveri(prava);
  if (poRealpath) return { napaka: poRealpath };
  return { pot: prava, prepovedane: m.prepovedane };
}

/**
 * Naloga 19b N5: razlog, zakaj izid preberi_datoteko NI dobesedna vsebina datoteke (null = je): daljsa od enega kosa, neveljaven UTF-8,
 * nevidni znaki ali oznake, ki jih ovojnica spremeni, ali zakrite skrivnosti. Brez stanja (velja tudi po ponovnem zagonu): pri prepisu se
 * preveri datoteka na disku, prepis take datoteke zahteva izrecno celotna: true (lastnik ga vidi v potrditvi pred vsebino).
 */
function nezvestoBranje(buf: Buffer): string | null {
  let besedilo: string;
  try {
    besedilo = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf);
  } catch {
    return "neveljaven UTF-8";
  }
  if (besedilo.length > KOS_DATOTEKE) return `daljsa od ${KOS_DATOTEKE} znakov, model vidi kos`;
  if (vidniZnaki(besedilo) !== besedilo || /\[\[|<<<|>>>/.test(besedilo)) return "nevidni znaki ali oznake, ki jih ovojnica spremeni";
  if (zakrijSkrivnosti(besedilo, { poti: false }) !== besedilo) return "skrivnosti v izidu so zakrite";
  return null;
}

export function orodjaLine(dir?: string, odv: OdvisnostiOrodij = {}): OrodjeOrkestratorja[] {
  const root = resolveDataDir(dir);
  const splet = async (): Promise<Pick<SpletOdv, "razresi" | "povezava">> => {
    if (odv.splet) return odv.splet;
    const s = await import("./splet.server.ts");
    return { razresi: s.razresiDns, povezava: s.poveziHttps };
  };
  return [
    {
      razred: "branje",
      zasebniIzid: true,
      definicija: {
        ime: "seznam_mape",
        opis: "Seznam datotek in podmap v mapi, ki jo je lastnik dovolil (absolutna pot). Skrite datoteke niso prikazane.",
        parametri: { type: "object", properties: { pot: { type: "string", maxLength: 512 } }, required: ["pot"] },
      },
      izvedi: async (a) => {
        const p = await dovoljenaPot(root, a.pot, "beri");
        if ("napaka" in p) return napaka(p.napaka);
        if (!(await lstat(p.pot)).isDirectory()) return napaka("Pot ni mapa.");
        const vnosi = (await readdir(p.pot, { withFileTypes: true }))
          .filter((v) => !v.name.startsWith(".") && !p.prepovedane.some((x) => znotraj(x, path.join(p.pot, v.name))))
          .sort((x, y) => x.name.localeCompare(y.name));
        const vrstice = vnosi.slice(0, NAJVEC_VNOSOV_MAPE).map((v) => (v.isDirectory() ? `${v.name}/` : v.isSymbolicLink() ? `${v.name} (povezava)` : v.name));
        return { ok: true, rezultat: `Mapa ${p.pot} (${vnosi.length} vnosov):\n${vrstice.join("\n")}${vnosi.length > NAJVEC_VNOSOV_MAPE ? "\n[odrezano]" : ""}` };
      },
    },
    {
      razred: "branje",
      zasebniIzid: true,
      definicija: {
        ime: "preberi_datoteko",
        opis: `Prebere besedilno datoteko v dovoljeni mapi lastnika (absolutna pot, najvec ${NAJVEC_BAJTOV_DATOTEKE / 1_000_000} MB). Vrne do ${KOS_DATOTEKE} znakov od znaka od (privzeto 0).`,
        parametri: {
          type: "object",
          properties: { pot: { type: "string", maxLength: 512 }, od: { type: "integer", minimum: 0, maximum: NAJVEC_BAJTOV_DATOTEKE } },
          required: ["pot"],
        },
      },
      izvedi: async (a) => {
        const p = await dovoljenaPot(root, a.pot, "beri");
        if ("napaka" in p) return napaka(p.napaka);
        const st = await lstat(p.pot);
        if (!st.isFile()) return napaka("Pot ni navadna datoteka.");
        if (st.size > NAJVEC_BAJTOV_DATOTEKE) return napaka(`Datoteka je prevelika (${st.size} B, najvec ${NAJVEC_BAJTOV_DATOTEKE} B).`);
        const buf = await readFile(p.pot);
        if (buf.subarray(0, NAJVEC_BAJTOV_DATOTEKE).includes(0)) return napaka("Binarna datoteka (ni besedilo).");
        const besedilo = buf.toString("utf8");
        const od = typeof a.od === "number" ? a.od : 0;
        const kos = besedilo.slice(od, od + KOS_DATOTEKE);
        const naprej = od + KOS_DATOTEKE < besedilo.length ? `\n[nadaljevanje: ponovi z od=${od + KOS_DATOTEKE}]` : "";
        // oznaka v glavi (ovojnica lahko odreze rep izida)
        const nezvesto = nezvestoBranje(buf);
        const oznaka = nezvesto ? ` [NI DOBESEDNO: ${nezvesto}; prepis te datoteke samo s celotna: true]` : "";
        return { ok: true, rezultat: `Datoteka ${p.pot} (${besedilo.length} znakov, od ${od})${oznaka}:\n${kos}${naprej}` };
      },
    },
    {
      razred: "branje",
      zasebniIzid: true,
      definicija: {
        ime: "poisci_v_znanju",
        opis: "Poisce v Lininem naucenem znanju in spominu pogovorov (samo branje; ob izklopljenem samoucenju ali spominu nic).",
        parametri: { type: "object", properties: { poizvedba: { type: "string", minLength: 2, maxLength: 500 } }, required: ["poizvedba"] },
      },
      izvedi: async (a) => {
        const q = String(a.poizvedba);
        const [{ isciZnanje }, { isci }, { SEJA_ASISTENTA }] = await Promise.all([import("./samoucenje-baza.server.ts"), import("./spomin-baza.server.ts"), import("./spomin-pogovor.server.ts")]);
        const [znanje, spomin] = await Promise.all([
          isciZnanje(q, { dir: root, najvec: 5 }).catch(() => []),
          // naloga 19b N12: samo pogovori asistentke (ne klicateljev, ko se bodo zapisovali)
          isci(q, 5, { dir: root, seja: SEJA_ASISTENTA, katerakoli: true }).catch(() => []),
        ]);
        const vrstice = [
          ...znanje.map((z) => `[znanje ${z.tema}] ${z.naslov}: ${z.besedilo.slice(0, 800)}`),
          ...spomin.map((o) => `[pogovor ${new Date(o.cas).toISOString().slice(0, 10)} ${o.vloga}] ${o.besedilo.slice(0, 800)}`),
        ];
        return { ok: true, rezultat: vrstice.length ? vrstice.join("\n") : "Ni zadetkov." };
      },
    },
    {
      razred: "zunanje",
      potrditev: false,
      potrditevPoZasebnih: true,
      rokMs: ROK_SPLETA_MS,
      definicija: {
        ime: "isci_splet",
        opis: "Spletno iskanje (Brave, lastnikov kljuc in mesecna meja). Vrne naslove, povezave in izvlecke. Poizvedba ne sme vsebovati zasebnih podatkov.",
        parametri: { type: "object", properties: { poizvedba: { type: "string", minLength: 2, maxLength: 600 } }, required: ["poizvedba"] },
      },
      izvedi: async (a) => {
        const isci = odv.isci ?? (async (q: string) => (await import("./brave.server.ts")).iskanjeBrave(q, root));
        const viri = await isci(String(a.poizvedba)).catch(() => null);
        if (!viri?.length) return napaka("Iskanje ni uspelo: ni kljuca Brave (Nastavitve), dosezena mesecna meja ali ni zadetkov.");
        return { ok: true, rezultat: viri.slice(0, 8).map((v) => `- ${v.naslov} (${v.url})\n  ${v.izvlecki.join(" ").slice(0, 600)}`).join("\n") };
      },
    },
    {
      razred: "zunanje",
      potrditev: false,
      potrditevPoZasebnih: true,
      rokMs: ROK_SPLETA_MS,
      definicija: {
        ime: "preberi_stran",
        opis: "Prebere eno javno spletno stran (samo https). Vrne vidno besedilo. Naslov ne sme vsebovati zasebnih podatkov.",
        parametri: { type: "object", properties: { naslov: { type: "string", maxLength: 2000 } }, required: ["naslov"] },
      },
      izvedi: async (a) => {
        const naslov = String(a.naslov);
        const { preberiEnoStran } = await import("./splet.ts");
        let s: { url: string; naslov: string; besedilo: string };
        try {
          s = await preberiEnoStran(naslov, await splet());
        } catch (e) {
          return napaka(`Strani ni mogoce prebrati: ${e instanceof Error ? e.message.slice(0, 200) : "napaka"}`);
        }
        let besedilo = s.besedilo.trim();
        if (!besedilo) {
          const tf = odv.tinyfish ?? (async (n: string) => (await import("./tinyfish.server.ts")).preberiPrekTinyFish(n, root));
          besedilo = ((await tf(s.url).catch(() => null)) ?? "").trim();
          if (!besedilo) return napaka("Stran nima vidnega besedila (JavaScript); TinyFish ni na voljo ali ni uspel.");
        }
        return { ok: true, rezultat: `Stran ${s.url}${s.naslov ? ` (${s.naslov})` : ""}:\n${besedilo.slice(0, 20_000)}` };
      },
    },
    {
      razred: "pisanje",
      potrditev: true,
      definicija: {
        ime: "zapisi_datoteko",
        opis: "Zapise besedilno datoteko v dovoljeni mapi lastnika (lastnik vsak zapis potrdi). Obstojece ne prepise, razen s prepisi: true. Datoteko, ki je preberi_datoteko ni vrnil dobesedno (NI DOBESEDNO), prepise samo z dodatnim celotna: true, ko je vsebina v celoti nova. Ne brise in ne ustvarja map.",
        parametri: {
          type: "object",
          properties: { pot: { type: "string", maxLength: 512 }, vsebina: { type: "string", maxLength: NAJVEC_ZNAKOV_ZAPISA }, prepisi: { type: "boolean" }, celotna: { type: "boolean" } },
          required: ["pot", "vsebina"],
        },
      },
      izvedi: async (a) => {
        const p = await dovoljenaPot(root, a.pot, "pisi");
        if ("napaka" in p) return napaka(p.napaka);
        const vsebina = String(a.vsebina);
        const st = await lstat(p.pot).catch(() => null);
        if (st && !st.isFile()) return napaka("Na poti je mapa ali povezava; zapis ni dovoljen.");
        if (!st) {
          // wx: nikoli cez obstojeco datoteko ali povezavo (tudi ce je nastala vmes); N14: 0600, delno zapisana nova datoteka se pocisti
          const f = await open(p.pot, "wx", 0o600);
          try {
            await f.writeFile(vsebina);
            await f.close();
          } catch (e) {
            await f.close().catch(() => undefined);
            await unlink(p.pot).catch(() => undefined);
            throw e;
          }
          return { ok: true, rezultat: `Zapisano: ${p.pot} (${vsebina.length} znakov, nova datoteka).` };
        }
        if (a.prepisi !== true) return napaka("Datoteka obstaja. Prepis samo z izrecnim prepisi: true (lastnik ga vidi v potrditvi).");
        // N5: datoteke, ki je model ni mogel videti dobesedno, ne prepise brez celotna: true (sicer bi zapisal odrezano ali spremenjeno vsebino)
        const nezvesto = nezvestoBranje(await readFile(p.pot));
        if (nezvesto && a.celotna !== true) {
          return napaka(`Datoteke ni mogoce prebrati dobesedno (${nezvesto}); prepis samo z celotna: true, ko je vsebina v celoti nova.`);
        }
        const zacasna = path.join(path.dirname(p.pot), `.${path.basename(p.pot)}.${randomBytes(6).toString("hex")}.lina-zapis`);
        try {
          await writeFile(zacasna, vsebina, { flag: "wx", mode: st.mode & 0o777 });
          await rename(zacasna, p.pot);
        } catch (e) {
          // N14: lastna zacasna datoteka ne ostane (ENOSPC, rename)
          await unlink(zacasna).catch(() => undefined);
          throw e;
        }
        return { ok: true, rezultat: `Prepisano: ${p.pot} (${vsebina.length} znakov).` };
      },
    },
    {
      razred: "pisanje",
      potrditev: true,
      definicija: {
        ime: "ustvari_opomnik",
        opis: "Doda opomnik ali dogodek v Linin koledar (lastnik potrdi). Cas je lokalni v obliki LLLL-MM-DDTHH:MM.",
        parametri: {
          type: "object",
          properties: {
            vrsta: { type: "string", enum: ["opomnik", "dogodek"] },
            naslov: { type: "string", minLength: 1, maxLength: 200 },
            cas: { type: "string", maxLength: 16 },
          },
          required: ["vrsta", "naslov", "cas"],
        },
      },
      izvedi: async (a) => {
        const { dodajZapis } = await import("./koledar.server.ts");
        const r = await dodajZapis(root, { vrsta: a.vrsta, naslov: a.naslov, cas: a.cas });
        return r.ok ? { ok: true, rezultat: `V koledar: ${r.zapis.vrsta} »${r.zapis.naslov}« ${r.zapis.cas ?? ""}`.trim() } : napaka(r.sporocilo);
      },
    },
    {
      // Naloga 20 (lastnik 25. 11. 2026): brez potrditve (krediti brezplacni). Opis gre samo v lastnikov projekt Vertex (isti kot za
      // mozgane), ne tretjemu in ne napadalcu, slika ostane lokalno - zato ne caka niti po branju zasebnih podatkov. Okuzena naloga
      // (zaznan vbrizg) vseeno caka lastnika (zahtevaPotrditev); poraba je omejena z NAJVEC_SLIK_NA_NALOGO.
      razred: "zunanje",
      potrditev: false,
      rokMs: ROK_SLIKE_MS,
      definicija: {
        ime: "ustvari_sliko",
        opis: `Ustvari sliko iz opisa z lastnikovim generatorjem (Google Vertex, modeli Gemini image) in jo shrani v Linino knjiznico (Mediji na racunalniku, na zahtevo tudi na telefon). Kakovost: hitri, standard (privzeto), ultra. Najvec ${NAJVEC_SLIK_NA_NALOGO} slik na nalogo. Vrne id slike.`,
        parametri: {
          type: "object",
          properties: {
            opis: { type: "string", minLength: 3, maxLength: 2000 },
            stevilo: { type: "integer", minimum: 1, maximum: 2 },
            razmerje: { type: "string", enum: [...RAZMERJA_SLIK] },
            kakovost: { type: "string", enum: [...KAKOVOSTI_SLIK] },
          },
          required: ["opis"],
        },
      },
      izvedi: async (a, k) => {
        const stevilo = typeof a.stevilo === "number" ? a.stevilo : 1;
        const porabljeno = slikNaNalogo.get(k.nalogaId) ?? 0;
        if (porabljeno + stevilo > NAJVEC_SLIK_NA_NALOGO) return napaka(`Dosezena meja ${NAJVEC_SLIK_NA_NALOGO} slik na nalogo.`);
        // rezervacija PRED prvim await (socasni klici iste naloge ne preberejo istega stanja); ponovni zagon stevec ponastavi,
        // a nadaljevana naloga je okuzena (vsako ne-bralno orodje caka lastnika)
        slikNaNalogo.set(k.nalogaId, porabljeno + stevilo);
        const mozgani = odv.slike?.mozgani ?? (async () => (await import("./keys.server.ts")).activeBrain(root));
        const izbira = izberiGeneratorSlik(await mozgani(), (a.kakovost as KakovostSlike | undefined) ?? "standard");
        if (!izbira.ok) {
          slikNaNalogo.set(k.nalogaId, (slikNaNalogo.get(k.nalogaId) ?? stevilo) - stevilo);
          return napaka(izbira.sporocilo);
        }
        const [{ ustvariSliko }, { googlePrevajalnik, verigaPrevajalnikov }] = await Promise.all([import("./slike-generator.server.ts"), import("./mediji-opis.server.ts")]);
        // prevod samo prek Googla v lastnikovem projektu; brez rezerve v mozgane asistentke (lahko tretji, npr. OpenRouter - B9)
        const g = { fetch: odv.slike?.fetch, zeton: odv.slike?.zeton };
        const prevedi = odv.slike?.prevedi ?? verigaPrevajalnikov(googlePrevajalnik(izbira.projekt, { ...g, model: "nmt" }), googlePrevajalnik(izbira.projekt, { ...g, model: "llm" }));
        let izid;
        try {
          izid = await ustvariSliko(root, a.opis, { ...odv.slike, prevedi, projekt: izbira.projekt, model: izbira.model, stevilo, razmerje: a.razmerje, signal: k.signal });
        } catch (e) {
          return napaka(`Slike ni bilo mogoce ustvariti: ${e instanceof Error ? e.message.slice(0, 200) : "napaka"}`);
        }
        if (!izid.slike.length) return napaka(`Generator ni vrnil slike (zavrnjenih ${izid.zavrnjenih}; morda filter vsebine). ${izbira.razlog}`);
        // izid sestavi koda (id, datoteka, bajti, model) - nikoli base64 ali besedilo modela slik
        const vrstice = izid.slike.map((s) => `- id ${s.id}, datoteka ${s.datoteka}, ${s.bajtov} B, model ${s.model}, serija ${s.serija}`);
        return { ok: true, rezultat: `Ustvarjenih slik: ${izid.slike.length}${izid.zavrnjenih ? ` (zavrnjenih ${izid.zavrnjenih})` : ""}; vidne v Medijih.\n${vrstice.join("\n")}\n${izbira.razlog}` };
      },
    },
  ];
}

/** Naloga 20: porabljene slike po nalogi (meja NAJVEC_SLIK_NA_NALOGO). */
const slikNaNalogo = new Map<string, number>();
