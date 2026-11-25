import { t } from "../besedila.ts";
import { activeBrain } from "../keys.server.ts";
import { loadPravila } from "../pravila.server.ts";
import { obIzrekuKlicatelja } from "../snemanje.server.ts";
import { uvodKlica, zRazkritjem } from "../povzetek.ts";
import {
  casLive,
  dopolniKlicDobesedno,
  izrekKlicateljaLive,
  loadLine,
  odgovorLinaLive,
  povprasevanjeLive,
  vrzelLive,
  zacniKlicLive,
  zakljuciKlic,
} from "../service.server.ts";
import { MEJA_DOBESEDNO } from "../dobesedno-meja.ts";
import { preberiSonioxKljuc } from "../soniox-kljuc.server.ts";
import { odpriSonioxSejo, type MoznostiSonioxSeje } from "../soniox-seja.server.ts";
import { resolveDataDir } from "../store.server.ts";
import { ciscenjeKlicevVklopljeno } from "../zvok-ciscenje.server.ts";
import { CiscenjeRnnoise, nalozRnnoise, rnnoisePripravljen } from "../zvok-rnnoise.server.ts";
import { LiveMost, type NacinBesedila, type OdvisnostiMosta, type TwilioVrata, type ZapisnikLive } from "./most.ts";
import { setupLive, sistemskoNavodilo } from "./navodilo.ts";
import { odsekStrokKlic } from "../stroke.server.ts";
import { odpriLiveWs } from "./odjemalec.server.ts";
import { zRezervoSetupa } from "./odpri-rezerva.ts";
import { posnetekMulaw } from "./posnetek.server.ts";
import { POT_LIVE } from "./twiml.ts";
import { porabiZetonLive, steviloCakajocihZetonov } from "./zeton.ts";

/** Najvec hkrati odprtih povezav: en klic naenkrat (+1 rezerve za prehod med klicema). */
export const NAJVEC_POVEZAV_LIVE = 2;

/**
 * Nacin vbrizgavanja besedila v Live med klicem (opozorilo o izteku casa). Doloci meritev pri pravem modelu
 * (most-porocilo.md); do takrat velja clientContent, kot je zahteval lastnik.
 */
export const NACIN_BESEDILA_LIVE: NacinBesedila = "clientContent";

/** Ocisti dobesedni zapis govora: odstrani nadzorne znake in skrajsa na MEJA_DOBESEDNO. */
export function ocistiDobesedno(besedilo: string): string {
  return besedilo
    .replace(/[\r\n\t]+/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim()
    .slice(0, MEJA_DOBESEDNO);
}

/** Zapisnik klica: tanek sloj nad funkcijami service.server.ts (isti zapis kot pot Gather). */
export function zapisnikIzKnjige(root: string): ZapisnikLive {
  return {
    zacni: async (v) => void (await zacniKlicLive(v, root)),
    izrek: (sid, besedilo) => {
      // Snemanje v nacinu podjetje (lastnik 22. 11. 2026): po pozdravu z napovedjo, ob izreku klicatelja (enkrat na klic).
      void loadPravila(root)
        .then((pravila) => obIzrekuKlicatelja(root, sid, besedilo.slice(0, 500), pravila))
        .catch(() => undefined);
      return izrekKlicateljaLive(sid, besedilo, root);
    },
    odgovor: (sid, besedilo) => odgovorLinaLive(sid, besedilo, root),
    vrzel: (vprasanje) => vrzelLive(vprasanje, root),
    cas: (sid, faza) => casLive(sid, faza, root),
    povprasevanje: (sid, polja, izreki, zadnji) => povprasevanjeLive(sid, polja, izreki, zadnji, root),
    zakljuci: async (sid) => void (await zakljuciKlic(sid, root)),
    dobesedno: async (sid, besedilo) => {
      const cisto = ocistiDobesedno(besedilo);
      if (cisto) await dopolniKlicDobesedno(sid, cisto, root);
    },
  };
}

/**
 * Povezava izbirnega dodatka Soniox za podatkovno mapo root.
 * Odpre sejo samo ob sonioxVklop === true IN shranjenem kljucu; sicer vrne null (zvok ne gre nikamor).
 */
export function sonioxZaKoren(
  root: string,
  dnevnik: (koda: string) => void,
  ustvariVticnico?: MoznostiSonioxSeje["ustvariVticnico"],
): NonNullable<OdvisnostiMosta["soniox"]> {
  return {
    odpri: async (_callSid, naBesedilo) => {
      try {
        const pravila = await loadPravila(root);
        if (pravila.sonioxVklop !== true) return null;
        const kljuc = await preberiSonioxKljuc(root);
        if (!kljuc) return null;
        return odpriSonioxSejo({
          kljuc,
          naZakljuceno: naBesedilo,
          naNapaka: (tip) => {
            const varno = tip.includes(kljuc) ? "error" : tip.replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "error";
            try {
              dnevnik(`soniox-${varno}`);
            } catch {
              /* dnevnik ne sme podreti klica */
            }
          },
          naKonec: () => undefined,
          ...(ustvariVticnico ? { ustvariVticnico } : {}),
        });
      } catch {
        return null;
      }
    },
  };
}

export type ZasedenostLive = { osvezi(callSid: string): void; sprosti(callSid: string): void };

/**
 * Delez ociscenega zvoka RNNoise (ostalo surovo) za telefon kot prehod 16 kHz; izbrano po meritvi WER (POROCILO.md naloge 17a).
 * Klic 8 kHz (Twilio/SIP) RNNoise NE dobi: meritev ni pokazala koristi pred obstojecim Wienerjem (pri 5 dB 30 proti 27 napak).
 */
export const MESANICA_RNNOISE_16K = 0.5;

/** Pravi odvisnosti mosta: zeton procesa, Live prek Vertex (ADC), stalni posnetki Line, zapis klica v knjigi. */
export function pravaOdvisnost(root: string, zasedenost: ZasedenostLive, dnevnik: (koda: string) => void): OdvisnostiMosta {
  return {
    porabiZeton: (zeton, callSid) => porabiZetonLive(zeton, callSid),
    nalozi: async () => {
      const [line, pravila, brain] = await Promise.all([loadLine(root), loadPravila(root), activeBrain(root)]);
      if (brain?.provider !== "vertex" || !brain.project) throw new Error("Live potrebuje prijavo Google Cloud (Vertex).");
      const pozdrav = uvodKlica(pravila, line.catalog.company.name);
      const sistemsko = sistemskoNavodilo({ podjetje: line.catalog.company.name, katalog: line.catalog, pozdrav, stroke: await odsekStrokKlic(root) });
      const ciscenjeZvoka = await ciscenjeKlicevVklopljeno(root);
      // RNNoise se nalozi enkrat na proces (prvic 72-96 ms, POROCILO.md naloge 17a); napaka = null in klic gre po stari poti.
      if (ciscenjeZvoka) await nalozRnnoise();
      return {
        setup: setupLive({ projekt: brain.project, sistemsko, zmanjsanjeHrupa: ciscenjeZvoka }),
        katalog: line.catalog,
        pozdrav,
        temaOdgovor: pravila.temaOdgovor,
        oprostilo: zRazkritjem(pravila, t("oprostiteSlovo")),
        najdaljsiMinut: pravila.najdaljsiPogovorMinut,
        ciscenjeZvoka,
      };
    },
    // v1 in START_SENSITIVITY_LOW nista preverjena skupaj: ob zavrnitvi setupa ena ponovitev brez polja (odpri-rezerva.ts).
    odpriLive: zRezervoSetupa(odpriLiveWs(), dnevnik),
    zapisnik: zapisnikIzKnjige(root),
    zasedenost,
    posnetek: posnetekMulaw(root),
    dnevnik,
    soniox: sonioxZaKoren(root, dnevnik),
    ciscenjeRnnoise: (frekvenca) => {
      const modul = frekvenca === 16000 ? rnnoisePripravljen() : null;
      return modul ? new CiscenjeRnnoise(modul, { frekvenca, mesanica: MESANICA_RNNOISE_16K }) : null;
    },
  };
}

/** Vse povezave, ki jih ta proces trenutno drzi (za mejo hkratnih povezav in za zaustavitev). */
const povezave = new Map<string, LiveMost>();

export function steviloPovezavLive(): number {
  return povezave.size;
}

type Peer = { id: string; send(podatki: string): unknown; close(koda?: number, razlog?: string): unknown };
type Sporocilo = { text(): string };

/**
 * Hooki crossws za pot /api/voice/live. Vrata so ozka: izvor (Origin) brezglavega odjemalca Twilio ni, zeton je ze izdan
 * (sicer 403 brez dviga seje), najvec 2 povezavi, brez stiskanja (permessage-deflate). Zeton se preveri ob 'start'.
 */
export function hookiLive(odvisnosti: (root: string) => OdvisnostiMosta, dir?: string, moznosti: { najvec?: number; nacin?: NacinBesedila; rokStartaMs?: number } = {}) {
  const root = resolveDataDir(dir);
  return {
    upgrade(request: Request) {
      const odbij = (): never => {
        throw new Response("Prepovedano", { status: 403, headers: { "cache-control": "no-store" } });
      };
      let pot = "";
      try {
        pot = new URL(request.url).pathname;
      } catch {
        return odbij();
      }
      if (pot !== POT_LIVE || request.headers.has("origin")) return odbij();
      if (steviloCakajocihZetonov() === 0 || povezave.size >= (moznosti.najvec ?? NAJVEC_POVEZAV_LIVE)) return odbij();
      return { perMessageDeflate: false };
    },
    open(peer: Peer) {
      const vrata: TwilioVrata = {
        poslji: (besedilo) => void peer.send(besedilo),
        zapri: (koda, razlog) => void peer.close(koda, razlog),
      };
      const most = new LiveMost(vrata, odvisnosti(root), moznosti.nacin ?? NACIN_BESEDILA_LIVE);
      povezave.set(peer.id, most);
      most.cakajStart(moznosti.rokStartaMs);
    },
    message(peer: Peer, sporocilo: Sporocilo) {
      povezave.get(peer.id)?.naSporocilo(sporocilo.text());
    },
    close(peer: Peer) {
      const most = povezave.get(peer.id);
      povezave.delete(peer.id);
      most?.naOdklop();
    },
    error(peer: Peer) {
      const most = povezave.get(peer.id);
      povezave.delete(peer.id);
      most?.naOdklop();
    },
  };
}

/**
 * Odgovor za crossws (isti dogovor kot defineWebSocketHandler v h3): Response 426 z lastnostjo crossws; Nitro (node-server,
 * features.websocket) na njej opravi nadgradnjo. Brez nadgradnje (navaden GET) je odgovor 426, ne 200.
 */
export function odgovorLive(request: Request, zasedenost: ZasedenostLive, dir?: string, dnevnik: (koda: string) => void = () => undefined): Response {
  const root = resolveDataDir(dir);
  const hooki = hookiLive(() => pravaOdvisnost(root, zasedenost, dnevnik), root);
  return Object.assign(new Response("WebSocket upgrade is required.", { status: 426 }), { crossws: hooki });
}
