import { vertexAccessToken } from "../adc.server.ts";
import type { LiveOdpri, LiveSporocilo } from "./most.ts";
import { LIVE_LOKACIJA } from "./navodilo.ts";

/** Koncna tocka Live (Vertex): lokacija us-central1 (izmerjeno 11. 11. 2026; eu/global nista merjena). */
export function naslovLive(lokacija = LIVE_LOKACIJA): string {
  return `wss://${lokacija}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`;
}

const ROK_SETUPA_MS = 10_000;
/** En odgovor Live je zvok po ~40-100 KB; nad 8 MiB je napaka. */
const NAJVEC_SPOROCILA_LIVE = 8 * 1024 * 1024;

type OdjemalecWs = {
  send(podatki: string): void;
  close(koda?: number, razlog?: string): void;
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: { code?: number }) => void) | null;
  onerror: (() => void) | null;
  readyState: number;
};

/**
 * Odjemalec Live prek vgrajenega WebSocketa Node (brez dodatnih paketov). Authorization (Bearer ADC) gre v glavo
 * zahteve in nikoli v naslov, dnevnik ali napako. naslov in zeton sta vbrizgana (preizkusi: lokalni lazni streznik).
 * Seja je pripravljena, ko streznik vrne setupComplete; sporocila (tudi setupComplete) gredo v onSporocilo.
 */
export function odpriLiveWs(moznosti: { naslov?: string; zeton?: () => Promise<string> } = {}): LiveOdpri {
  return async ({ setup, onSporocilo, onZaprto }) => {
    const zeton = await (moznosti.zeton ?? (() => vertexAccessToken()))();
    const Ctor = WebSocket as unknown as new (url: string, opcije: { headers: Record<string, string> }) => OdjemalecWs;
    const ws = new Ctor(moznosti.naslov ?? naslovLive(), { headers: { authorization: `Bearer ${zeton}` } });
    ws.binaryType = "arraybuffer";
    let zaprto = false;
    const zapri = (razlog: string) => {
      if (zaprto) return;
      zaprto = true;
      try {
        onZaprto(razlog);
      } catch {
        /* klicatelj je ze zakljucen */
      }
    };
    await new Promise<void>((resolve, reject) => {
      const rok = setTimeout(() => reject(new Error("rok")), ROK_SETUPA_MS);
      ws.onopen = () => {
        clearTimeout(rok);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(rok);
        reject(new Error("povezava"));
      };
      ws.onclose = () => {
        clearTimeout(rok);
        reject(new Error("zaprto"));
      };
    }).catch((napaka) => {
      try {
        ws.close();
      } catch {
        /* ze zaprto */
      }
      throw new Error(napaka instanceof Error ? napaka.message : "povezava");
    });
    let setupRok: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      try {
        ws.close(1000, "setup-rok");
      } catch {
        /* ze zaprto */
      }
      zapri("setup-rok");
    }, ROK_SETUPA_MS);
    ws.onmessage = (e) => {
      let besedilo = "";
      const d = e.data;
      if (typeof d === "string") besedilo = d;
      else if (d instanceof ArrayBuffer) {
        if (d.byteLength > NAJVEC_SPOROCILA_LIVE) return zapri("prevelik");
        besedilo = new TextDecoder().decode(d);
      } else return;
      if (besedilo.length > NAJVEC_SPOROCILA_LIVE) return zapri("prevelik");
      let m: LiveSporocilo;
      try {
        m = JSON.parse(besedilo) as LiveSporocilo;
      } catch {
        return;
      }
      if (m.setupComplete !== undefined && setupRok) {
        clearTimeout(setupRok);
        setupRok = undefined;
      }
      onSporocilo(m);
    };
    ws.onclose = (e) => {
      if (setupRok) clearTimeout(setupRok);
      zapri(`koda-${e.code ?? 0}`);
    };
    ws.onerror = () => zapri("napaka");
    ws.send(JSON.stringify(setup));
    return {
      poslji(sporocilo: object) {
        if (zaprto || ws.readyState !== 1) return;
        ws.send(JSON.stringify(sporocilo));
      },
      zapri() {
        zaprto = true;
        if (setupRok) clearTimeout(setupRok);
        try {
          ws.close(1000, "konec");
        } catch {
          /* ze zaprto */
        }
      },
    };
  };
}
