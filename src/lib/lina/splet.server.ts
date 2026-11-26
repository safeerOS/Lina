/**
 * Predlog kataloga iz strani podjetja.
 * Shrani se loceno od line.json. Velja sele po potrditvi.
 * Model, ce ga lastnik ima, vidi stran samo kot oznacene podatke.
 */
import { unlink } from "node:fs/promises";
import path from "node:path";
import { requireOwner } from "./auth.server.ts";
import { t } from "./besedila.ts";
import { kljucLastnika } from "./keys.server.ts";
import { callProvider } from "./providers.ts";
import { loadLine, publishLine } from "./service.server.ts";
import { zapisiRevizijo } from "./revizija.server.ts";
import { jeVeljavenEnaslov } from "./eposta.ts";
import { loadPravila, savePravila } from "./pravila.server.ts";
import {
  LINA_AGENT,
  oznaciPodatke,
  predlogIzModela,
  jeVrinjenoNavodilo,
  preberiStran,
  znanjeIzMarkdowna,
  type SpletOdgovor,
  type SpletOdv,
  type SpletZahteva,
} from "./splet.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";
import type { Catalog, Predlog } from "./types.ts";
import { razlogPolja } from "./plast.ts";
import { dodajBesedilo } from "./znanje-besedilo.ts";
import { preberiPrekTinyFish, type ZahtevaTinyFish } from "./tinyfish.server.ts";
import { preveriCitate } from "./citat.ts";
import { brezVbrizga, zabeleziVbrizg } from "./vbrizg.ts";

export const PREDLOG_DATOTEKA = "predlog.json";
const POTEK_DATOTEKA = "splet-potek.json";
const DNEVNIK_DATOTEKA = "splet-dnevnik.json";

// Naloga 32 (kanal-claude T1-S2): DNS in HTTPS na preverjen IP sta v splet-povezava.server.ts, da jih novice uvozijo brez poti klica
// (ta modul uvaza service.server.ts); tu ostaneta izvozena za obstojece klicatelje.
export { poveziHttps, razresiDns } from "./splet-povezava.server.ts";
import { poveziHttps, razresiDns } from "./splet-povezava.server.ts";

async function odstrani(dir: string, ime: string): Promise<void> {
  try {
    await unlink(path.join(dir, ime));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function razbijStik(stik: string): { telefon: string; naslov: string; post: string } {
  const kosi = stik.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  let telefon = "";
  let naslov = "";
  const post: string[] = [];
  for (const kos of kosi) {
    const stevke = kos.replace(/\D/g, "");
    if (!telefon && stevke.length >= 8 && stevke.length <= 15 && !/\p{L}/u.test(kos)) telefon = kos;
    else if (kos.includes("@")) post.push(kos);
    else if (!naslov && /\d/.test(kos)) naslov = kos;
    else post.push(kos);
  }
  return { telefon, naslov, post: post.join(", ") };
}

/** Izbrane vrstice se prilepijo na obstojeci katalog. Nepotrjene ostanejo zunaj. */
export function zdruziKatalog(catalog: Catalog, predlog: Predlog, ids: string[]): Catalog {
  const izbrani = new Set(ids);
  const next: Catalog = {
    company: { ...catalog.company },
    products: catalog.products.map((p) => ({ ...p })),
    materials: catalog.materials.map((m) => ({ ...m })),
    zapiski: [...(catalog.zapiski ?? [])],
    znanje: catalog.znanje ?? "",
  };
  // Besedilo strani se doda znanju, ki ga je uporabnik ze vpisal (ne prepise); isto besedilo dvakrat ne.
  if (izbrani.has("znanje") && predlog.znanje?.besedilo && !next.znanje?.includes(predlog.znanje.besedilo)) {
    next.znanje = dodajBesedilo(next.znanje ?? "", predlog.znanje.besedilo).besedilo;
  }
  if (izbrani.has(predlog.podjetje.id)) {
    const p = predlog.podjetje;
    if (p.ime) next.company.name = p.ime;
    if (p.opis) next.company.about = p.opis;
    if (p.ure) next.company.hours = p.ure;
    const stik = razbijStik(p.stik);
    if (stik.telefon) next.company.phone = stik.telefon;
    if (stik.naslov) next.company.address = stik.naslov;
    if (stik.post && !razlogPolja("opis", stik.post)) {
      next.company.about = [next.company.about, stik.post].filter(Boolean).join(" ").slice(0, 2000);
    }
  }
  for (const v of predlog.vrstice) {
    if (!izbrani.has(v.id)) continue;
    if (v.vrsta === "material") {
      if (!next.materials.some((m) => m.name.toLowerCase() === v.ime.toLowerCase())) {
        next.materials.push({ id: "", name: v.ime, note: v.opis });
      }
      continue;
    }
    if (v.material && !next.materials.some((m) => m.name.toLowerCase() === v.material.toLowerCase())) {
      next.materials.push({ id: "", name: v.material, note: "" });
    }
    if (next.products.some((p) => p.name.toLowerCase() === v.ime.toLowerCase())) continue;
    next.products.push({
      id: "",
      name: v.ime,
      kind: "",
      summary: v.opis,
      materialIds: v.material ? [v.material] : [],
    });
  }
  return next;
}

export async function preberiPredlog(token: string | null, dir?: string): Promise<Predlog | null> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return readJsonFile<Predlog>(root, PREDLOG_DATOTEKA);
}

export async function preberiPotek(token: string | null, dir?: string): Promise<{ gostitelj: string; strani: number }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const raw = await readJsonFile<{ gostitelj?: unknown; strani?: unknown }>(root, POTEK_DATOTEKA);
  return {
    gostitelj: typeof raw?.gostitelj === "string" ? raw.gostitelj : "",
    strani: typeof raw?.strani === "number" ? raw.strani : 0,
  };
}

export async function zavrziPredlog(token: string | null, dir?: string): Promise<{ ok: true }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  await odstrani(root, PREDLOG_DATOTEKA);
  await odstrani(root, POTEK_DATOTEKA);
  return { ok: true };
}

export async function potrdiPredlog(ids: string[], token: string | null, dir?: string): Promise<Catalog> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (!ids.length) throw new Error(t("spletIzbor"));
  const predlog = await readJsonFile<Predlog>(root, PREDLOG_DATOTEKA);
  if (!predlog?.podjetje) throw new Error(t("spletNiPredloga"));
  // E-posta za povprasevanja s strani: samo ob izrecni izbiri in samo, ce uporabnik naslova se nima (vpisanega ne prepise).
  // savePravila ga preveri in ob prvem veljavnem naslovu vklopi stikalo.
  const line = await loadLine(root);
  const catalog = zdruziKatalog(line.catalog, predlog, ids);
  const saved = await publishLine({ catalog }, { token }, root);
  // Pregled 0.2.10 (najdba 10, CodeRabbit): e-posta SELE po objavi kataloga; napaka pri njej (npr. nepovezana pokvarjena nastavitev) potrditve
  // kataloga ne ustavi in ga ne prehiti; uporabnik naslov v tem primeru vpise rocno.
  const eposta = predlog.eposta?.naslov?.trim().toLowerCase() ?? "";
  if (predlog.eposta && ids.includes(predlog.eposta.id) && jeVeljavenEnaslov(eposta)) {
    try {
      if (!jeVeljavenEnaslov((await loadPravila(root)).potrditevNaslov)) await savePravila({ potrditevNaslov: eposta }, token, root);
    } catch {
      // namerno tiho: katalog je ze objavljen
    }
  }
  // Revizija (naloga #44): od kod je znanje (samo gostitelj, ki je ze bil preverjen pri branju, in stevilo potrjenih vrstic).
  const gostitelj = /^[a-z0-9.-]{1,120}$/i.test(predlog.gostitelj) ? predlog.gostitelj.toLowerCase() : "nepravilen";
  await zapisiRevizijo(root, {
    vrsta: "znanje.iz-strani",
    opis: "Podatki s spletne strani so potrjeni in dodani v znanje.",
    podatki: { gostitelj, izbranih: ids.length, idn: gostitelj.includes("xn--") ? 1 : 0 },
  });
  await odstrani(root, PREDLOG_DATOTEKA);
  await odstrani(root, POTEK_DATOTEKA);
  return saved.catalog;
}

/**
 * Lastnikov kljuc, ce je shranjen. Kljuc iz okolja se ne uporabi.
 * Odvisnosti so samo za preizkus (lokalni streznik in lazni DNS).
 */
export async function preberiStranPodjetja(
  naslov: string,
  token: string | null,
  dir?: string,
  odv?: Partial<SpletOdv>,
  tinyfish?: ZahtevaTinyFish,
): Promise<Predlog> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const povezava = odv?.povezava ?? poveziHttps;
  const razresi = odv?.razresi ?? razresiDns;
  let pisava = Promise.resolve();
  const branje = await preberiStran(naslov, {
    razresi,
    povezava,
    zdaj: odv?.zdaj,
    napredek: (strani) => {
      const gostitelj = "";
      pisava = pisava.then(() => writeJson(root, POTEK_DATOTEKA, { gostitelj, strani })).catch(() => undefined);
    },
  });
  await pisava.catch(() => undefined);

  let predlog = branje.predlog;
  // Stran brez vidne vsebine (JavaScript): ce ima uporabnik svoj kljuc TinyFish, jo prebere pravi brskalnik v oblaku.
  // Dobljeno besedilo gre samo v znanje (z istimi varovali kot navadno branje); katalog in cen iz strani ne prevzamemo.
  if (predlog.prazno) {
    const md = await preberiPrekTinyFish(naslov, root, tinyfish);
    const znanje = md ? znanjeIzMarkdowna(predlog.gostitelj, md) : "";
    if (znanje) predlog = { ...predlog, prazno: false, znanje: { id: "znanje", izbrano: true, besedilo: znanje } };
  }
  const kljuc = await kljucLastnika(root);
  // Mercury F: vrstice z vzorcem vbrizga navodil model ne dobi (podatek brez zaupanja); strani ne zavrnemo, v dnevnik gredo
  // samo imena vzorcev.
  const varno = brezVbrizga(branje.besedilo, jeVrinjenoNavodilo);
  zabeleziVbrizg("stran", varno.vzorci);
  let zavrnjenaPolja = 0;
  if (kljuc && varno.besedilo.trim()) {
    const vhod = oznaciPodatke(varno.besedilo);
    const odgovor = await callProvider({
      provider: kljuc.provider,
      model: kljuc.model,
      key: kljuc.key,
      system: vhod.sistem,
      text: vhod.podatki,
      maxTokens: 800,
    });
    if (odgovor.ok) {
      const surovo = predlogIzModela(odgovor.text, predlog.gostitelj, predlog.strani);
      // Mercury C: ime, stik, ure in izdelki iz modela veljajo samo, ce so DOBESEDNO v besedilu, ki ga je model dobil.
      const preverjeno = surovo ? preveriCitate(surovo, varno.besedilo) : null;
      zavrnjenaPolja = preverjeno?.zavrnjeno.length ?? 0;
      const izModela = preverjeno && (preverjeno.predlog.podjetje.ime || preverjeno.predlog.vrstice.length > 0) ? preverjeno.predlog : null;
      // Ime, ki ga model ni mogel dobesedno potrditi, ostane tisto, ki ga je iz strani prebrala koda.
      if (izModela) predlog = { ...izModela, podjetje: { ...izModela.podjetje, ime: izModela.podjetje.ime || predlog.podjetje.ime }, prazno: predlog.prazno, sporocilo: predlog.sporocilo, znanje: predlog.znanje, eposta: predlog.eposta };
    }
  }

  await writeJson(root, PREDLOG_DATOTEKA, predlog);
  await writeJson(root, POTEK_DATOTEKA, { gostitelj: predlog.gostitelj, strani: predlog.strani });
  await writeJson(root, DNEVNIK_DATOTEKA, { gostitelj: predlog.gostitelj, strani: predlog.strani, ...(varno.vzorci.length ? { vzorci: varno.vzorci } : {}), ...(zavrnjenaPolja ? { zavrnjenaPolja } : {}) });
  return predlog;
}
