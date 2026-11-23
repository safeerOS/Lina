/**
 * Branje vodnika teme iz Learn Anything (MIT, github.com/gendotnew/attempt) BREZ TinyFisha: anonimni gost v Jazz (cojson), enako kot
 * jo bere spletna stran learn-anything.xyz v brskalniku. Preverjeno 22. 11. 2026: povezava ~0,3 do 0,6 s, tema »zeromq« 2 razdelka
 * v ~1 s, tema »networking« 1 razdelek z 611 povezavami v ~38 s (zato casovna omejitev in omejitev stevila povezav).
 *
 * Zasebnost: na streznik gre SAMO veljaven kljuc teme iz indeksa (najdiTemo), nikoli besedilo uporabnika. Vsebina je nezaupan podatek.
 * Odvisnosti (jazz-tools, cojson, cojson-transport-ws, vse 0.8.23, MIT) se nalozijo sele ob uporabi (dinamicni uvoz): brez njih ali brez
 * omrezja bralnik vrne napako in samoucenje ne podre pogovora. Komentarji so brez sumnikov.
 */
import { najdiTemo } from "./samoucenje-teme.ts";

export const JAZZ_SKUPINA = "co_z6pTJeuwVQhUd1irSLciRUFCGRk";
export const JAZZ_STREZNIK = "wss://sync-la.jazz.tools/?key=client@learn-anything.xyz";
export const JAZZ_CASOVNA_OMEJITEV_MS = 60_000;
export const NAJVEC_RAZDELKOV = 12;
export const NAJVEC_POVEZAV_NA_RAZDELEK = 40;

export type VodnikPovezava = { title: string; url: string };
export type VodnikRazdelek = { title: string; links: VodnikPovezava[] };
export type Vodnik = { tema: string; prettyName: string; razdelki: VodnikRazdelek[] };

/** Bralnik vodnika po kljucu teme; v preizkusih ga zamenja lazni bralnik. */
export type BralnikVodnika = (tema: string, signal?: AbortSignal) => Promise<Vodnik>;

function niz(x: unknown, najvec: number): string {
  return typeof x === "string" ? x.slice(0, najvec) : "";
}

export const preberiVodnikJazz: BralnikVodnika = async (kljuc, signal) => {
  const tema = najdiTemo(kljuc);
  if (!tema) throw new Error("Tema ni v indeksu Learn Anything.");
  // Spremenljiv podolgi uvoz: ne gre skozi bundler in ne skozi tsc (tipi paketov niso del nasega projekta).
  const uvozi = (ime: string): Promise<any> => import(/* @vite-ignore */ ime);
  const jazz = await uvozi("jazz-tools");
  const ws = await uvozi("cojson-transport-ws");
  const { createAnonymousJazzContext, CoMap, CoList, co, WasmCrypto } = jazz;
  if (typeof WebSocket === "undefined") throw new Error("WebSocket ni na voljo.");

  class Link extends CoMap {
    title = co.string;
    url = co.string;
  }
  class ListOfLinks extends CoList.Of(co.ref(Link)) {}
  class Section extends CoMap {
    title = co.string;
    links = co.ref(ListOfLinks);
  }
  class ListOfSections extends CoList.Of(co.ref(Section)) {}
  class LatestGlobalGuide extends CoMap {
    sections = co.ref(ListOfSections);
  }
  class Topic extends CoMap {
    name = co.string;
    prettyName = co.string;
    latestGlobalGuide = co.ref(LatestGlobalGuide);
  }

  let casovnik: ReturnType<typeof setTimeout> | undefined;
  const crypto = await WasmCrypto.create();
  const socket = new WebSocket(JAZZ_STREZNIK);
  const zapri = () => {
    try {
      socket.close();
    } catch {
      /* ze zaprto */
    }
  };
  try {
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error("Povezava z Learn Anything ni uspela (casovna omejitev).")), 15_000);
      socket.addEventListener("open", () => {
        clearTimeout(t);
        res();
      });
      socket.addEventListener("error", () => {
        clearTimeout(t);
        rej(new Error("Povezava z Learn Anything ni uspela."));
      });
    });
    const peer = ws.createWebSocketPeer({ id: "learn-anything", websocket: socket, role: "server" });
    const ctx = await createAnonymousJazzContext({ peersToLoadFrom: [peer], crypto });
    const preklic = new Promise<never>((_, rej) => {
      const t = setTimeout(() => rej(new Error("Branje vodnika je preseglo casovno omejitev.")), JAZZ_CASOVNA_OMEJITEV_MS);
      casovnik = t;
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        rej(new Error("Branje vodnika je preklicano."));
      });
    });
    const delo = (async (): Promise<Vodnik> => {
      const id = await Topic.findUnique({ topicName: tema.name }, JAZZ_SKUPINA, ctx.agent);
      const t = await Topic.load(id, ctx.agent, { latestGlobalGuide: { sections: [{ links: [{}] }] } });
      if (!t) throw new Error("Tema v Learn Anything ni naložena.");
      const razdelki: VodnikRazdelek[] = [];
      for (const r of (t.latestGlobalGuide?.sections ?? []).slice(0, NAJVEC_RAZDELKOV)) {
        if (!r) continue;
        const povezave: VodnikPovezava[] = [];
        for (const l of (r.links ?? []).slice(0, NAJVEC_POVEZAV_NA_RAZDELEK)) {
          if (!l) continue;
          const title = niz(l.title, 200);
          const url = niz(l.url, 500);
          if (title && url) povezave.push({ title, url });
        }
        razdelki.push({ title: niz(r.title, 200), links: povezave });
      }
      return { tema: tema.name, prettyName: tema.prettyName, razdelki };
    })();
    return await Promise.race([delo, preklic]);
  } finally {
    if (casovnik) clearTimeout(casovnik);
    zapri();
  }
};
