/**
 * Strezniska seja WebSocket za Soniox STT (izbirni dodatek za dobesedni zapis klicatelja).
 * Avtentikacija gre prek podprotokolov ["soniox-api-key", kljuc], brez Authorization glave in brez api_key v JSON.
 * Napaka seje nikoli ne vrze iz poslji, zakljuci ali zapri in nikoli ne izpise skrivnega kljuca.
 */
import {
  SONIOX_KEEPALIVE_JSON,
  SONIOX_WS_URL,
  izvleciRequestId,
  novoStanje,
  obdelajOdgovor,
  sonioxZacetnoSporocilo,
} from "./soniox-prepis.ts";

/** Najvec 3 s zvoka PCM 16 kHz mono 16-bit pred odprtjem povezave (16000 * 2 * 3). */
export const NAJVEC_VRSTA_BAJTOV = 96_000;

/** Interval posiljanja {"type":"keepalive"} ob tisini (ms). */
export const CAS_KEEPALIVE_MS = 20_000;

/** Zakasnitve pred ponovnim odprtjem povezave pri ponovljivi napaki (najvec 2 ponovitvi). */
export const ZAKASNITVE_PONOVITEV_MS: readonly number[] = [300, 900];

/** Najdaljsi cas cakanja na odgovor finished: true po zakljuci() (ms). */
export const ROK_ZAKLJUCKA_MS = 3_000;

const WS_OPEN = 1;
const WS_CLOSING = 2;

export interface SonioxVticnica {
  readonly readyState: number;
  send(podatki: string | Uint8Array<ArrayBuffer>): void;
  close(koda?: number, razlog?: string): void;
  addEventListener(tip: "open", poslusalec: () => void): void;
  addEventListener(tip: "message", poslusalec: (dogodek: { data: unknown }) => void): void;
  addEventListener(tip: "error", poslusalec: (dogodek: unknown) => void): void;
  addEventListener(tip: "close", poslusalec: (dogodek: { code?: number; reason?: string }) => void): void;
}

export interface MoznostiSonioxSeje {
  kljuc: string;
  jezik?: string;
  /** Prejme vsak novo zakljucen kos besedila (brez podvajanja in brez <end>). */
  naZakljuceno: (besedilo: string) => void;
  /** Prejme samo error_type (in opcijsko request_id), nikoli kljuca ali error_message. */
  naNapaka: (tip: string, requestId?: string) => void;
  naKonec: () => void;
  ustvariVticnico?: (url: string, protokoli: string[]) => SonioxVticnica;
  /** Opcijske casovne meje za preizkuse (privzeto po specifikaciji). */
  casKeepaliveMs?: number;
  zakasnitvePonovitevMs?: readonly number[];
  rokZakljuckaMs?: number;
}

export interface SonioxSeja {
  poslji(pcm16k: Uint8Array): void;
  zakljuci(): Promise<void>;
  zapri(): void;
}

function privzetaVticnica(url: string, protokoli: string[]): SonioxVticnica {
  return new WebSocket(url, protokoli);
}

function kopijaBajtov(kos: Uint8Array): Uint8Array<ArrayBuffer> {
  const izid = new Uint8Array(new ArrayBuffer(kos.byteLength));
  izid.set(kos);
  return izid;
}

function zaPosiljanje(kos: Uint8Array): Uint8Array<ArrayBuffer> {
  if (kos.buffer instanceof ArrayBuffer) {
    return new Uint8Array(kos.buffer, kos.byteOffset, kos.byteLength);
  }
  return kopijaBajtov(kos);
}

function unrefCasovnik(casovnik: ReturnType<typeof setTimeout>): void {
  if (typeof casovnik === "object" && casovnik !== null && "unref" in casovnik && typeof casovnik.unref === "function") {
    casovnik.unref();
  }
}

/**
 * Odpre sejo Soniox STT WebSocket.
 * Kljuca nikoli ne zapise v dnevnik, napake ali sporocila WebSocket; napaka nikoli ne prekine klica.
 */
export function odpriSonioxSejo(moznosti: MoznostiSonioxSeje): SonioxSeja {
  const kljuc = moznosti.kljuc;
  const ustvariVticnico = moznosti.ustvariVticnico ?? privzetaVticnica;
  const casKeepaliveMs = moznosti.casKeepaliveMs ?? CAS_KEEPALIVE_MS;
  const zakasnitvePonovitevMs = moznosti.zakasnitvePonovitevMs ?? ZAKASNITVE_PONOVITEV_MS;
  const rokZakljuckaMs = moznosti.rokZakljuckaMs ?? ROK_ZAKLJUCKA_MS;

  let zacetniJson: string;
  try {
    zacetniJson = JSON.stringify(sonioxZacetnoSporocilo({ jezik: moznosti.jezik }));
  } catch {
    try {
      moznosti.naNapaka("invalid_request");
    } catch {
      // Napaka povratnega klica nikoli ne sme podreti klicne poti.
    }
    return {
      poslji: () => {},
      zakljuci: () => Promise.resolve(),
      zapri: () => {},
    };
  }

  const stanje = novoStanje();
  const vrsta: Uint8Array<ArrayBuffer>[] = [];
  let vrstaBajtov = 0;

  let aktivnaVticnica: SonioxVticnica | null = null;
  let zacetnoPoslano = false;
  let ustavljeno = false;
  let zakljucujem = false;
  let konecSporocen = false;
  let zaporednihPonovitev = 0;

  let casovnikKeepalive: ReturnType<typeof setTimeout> | null = null;
  let casovnikPonovitve: ReturnType<typeof setTimeout> | null = null;
  let casovnikZakljucka: ReturnType<typeof setTimeout> | null = null;

  let obljubaZakljucka: Promise<void> | null = null;
  let razresiZakljucek: (() => void) | null = null;

  function pocistiKeepalive(): void {
    if (casovnikKeepalive !== null) {
      clearTimeout(casovnikKeepalive);
      casovnikKeepalive = null;
    }
  }

  function pocistiPonovitev(): void {
    if (casovnikPonovitve !== null) {
      clearTimeout(casovnikPonovitve);
      casovnikPonovitve = null;
    }
  }

  function pocistiCasovnikZakljucka(): void {
    if (casovnikZakljucka !== null) {
      clearTimeout(casovnikZakljucka);
      casovnikZakljucka = null;
    }
  }

  function razresiCakanjeZakljucka(): void {
    pocistiCasovnikZakljucka();
    const fn = razresiZakljucek;
    razresiZakljucek = null;
    if (fn) fn();
  }

  function pokliciKonec(): void {
    if (konecSporocen) return;
    konecSporocen = true;
    try {
      moznosti.naKonec();
    } catch {
      // Ne prekinjaj klica zaradi napake v povratnem klicu.
    }
  }

  function pokliciNapako(tip: string, requestId?: string): void {
    const varenTip = kljuc.length > 0 && tip.includes(kljuc) ? "error" : tip;
    const varenReq =
      requestId !== undefined && requestId.length > 0 && (kljuc.length === 0 || !requestId.includes(kljuc))
        ? requestId
        : undefined;
    try {
      moznosti.naNapaka(varenTip, varenReq);
    } catch {
      // Ne prekinjaj klica zaradi napake v povratnem klicu.
    }
  }

  function varnoZapri(ws: SonioxVticnica | null): void {
    if (!ws) return;
    try {
      if (ws.readyState < WS_CLOSING) {
        ws.close(1000);
      }
    } catch {
      // Napaka pri zapiranju nikoli ne sme uiti navzven.
    }
  }

  function ustaviTrajno(): void {
    ustavljeno = true;
    pocistiKeepalive();
    pocistiPonovitev();
    vrsta.length = 0;
    vrstaBajtov = 0;
    const ws = aktivnaVticnica;
    aktivnaVticnica = null;
    zacetnoPoslano = false;
    varnoZapri(ws);
    razresiCakanjeZakljucka();
  }

  function nacrtujKeepalive(ws: SonioxVticnica): void {
    pocistiKeepalive();
    if (ustavljeno || zakljucujem || ws !== aktivnaVticnica || ws.readyState !== WS_OPEN) return;
    casovnikKeepalive = setTimeout(() => {
      casovnikKeepalive = null;
      if (ustavljeno || zakljucujem || ws !== aktivnaVticnica || ws.readyState !== WS_OPEN) return;
      try {
        ws.send(SONIOX_KEEPALIVE_JSON);
      } catch {
        // Transportna napaka se obravnava ob dogodku error/close ali ob naslednji povezavi.
        return;
      }
      nacrtujKeepalive(ws);
    }, casKeepaliveMs);
    unrefCasovnik(casovnikKeepalive);
  }

  function dodajVVrsto(pcm: Uint8Array): void {
    const kopija = kopijaBajtov(pcm);
    if (kopija.byteLength >= NAJVEC_VRSTA_BAJTOV) {
      vrsta.length = 0;
      const ostanek = kopija.byteLength > NAJVEC_VRSTA_BAJTOV
        ? kopija.slice(kopija.byteLength - NAJVEC_VRSTA_BAJTOV)
        : kopija;
      vrsta.push(ostanek);
      vrstaBajtov = ostanek.byteLength;
      return;
    }

    vrsta.push(kopija);
    vrstaBajtov += kopija.byteLength;
    while (vrstaBajtov > NAJVEC_VRSTA_BAJTOV && vrsta.length > 0) {
      const najstarejsi = vrsta.shift();
      if (najstarejsi) vrstaBajtov -= najstarejsi.byteLength;
    }
  }

  function obdelajNapakoSeje(ws: SonioxVticnica, tip: string, ponovljivo: boolean, requestId?: string): void {
    if (ws !== aktivnaVticnica || ustavljeno) return;

    // Ce ze zakljucujemo, se ne ponavljamo; cisto koncamo.
    if (zakljucujem) {
      ustaviTrajno();
      pokliciKonec();
      return;
    }

    // Odklopimo staro vticnico, da njen kasnejsi dogodek close ne sprozi podvojene obravnave.
    aktivnaVticnica = null;
    zacetnoPoslano = false;
    pocistiKeepalive();
    vrsta.length = 0;
    vrstaBajtov = 0;
    varnoZapri(ws);

    if (ponovljivo && zaporednihPonovitev < zakasnitvePonovitevMs.length) {
      const zakasnitev = zakasnitvePonovitevMs[zaporednihPonovitev];
      zaporednihPonovitev += 1;
      pocistiPonovitev();
      casovnikPonovitve = setTimeout(() => {
        casovnikPonovitve = null;
        if (ustavljeno || zakljucujem) return;
        povezi();
      }, zakasnitev);
      return;
    }

    ustaviTrajno();
    pokliciNapako(tip, requestId);
  }

  function povezi(): void {
    if (ustavljeno) return;
    let ws: SonioxVticnica;
    try {
      ws = ustvariVticnico(SONIOX_WS_URL, ["soniox-api-key", kljuc]);
    } catch {
      ustaviTrajno();
      pokliciNapako("service_unavailable");
      return;
    }

    aktivnaVticnica = ws;
    zacetnoPoslano = false;

    ws.addEventListener("open", () => {
      if (ws !== aktivnaVticnica || ustavljeno) {
        varnoZapri(ws);
        return;
      }

      try {
        ws.send(zacetniJson);
        zacetnoPoslano = true;
      } catch {
        obdelajNapakoSeje(ws, "service_unavailable", true);
        return;
      }

      while (vrsta.length > 0) {
        const kos = vrsta.shift();
        if (!kos) continue;
        vrstaBajtov -= kos.byteLength;
        try {
          ws.send(kos);
        } catch {
          obdelajNapakoSeje(ws, "service_unavailable", true);
          return;
        }
      }
      vrstaBajtov = 0;

      if (zakljucujem) {
        try {
          ws.send("");
        } catch {
          ustaviTrajno();
          pokliciKonec();
        }
        return;
      }

      nacrtujKeepalive(ws);
    });

    ws.addEventListener("message", (dogodek) => {
      if (ws !== aktivnaVticnica || ustavljeno) return;
      if (typeof dogodek.data !== "string" || dogodek.data.length === 0) return;

      let podatki: unknown;
      try {
        podatki = JSON.parse(dogodek.data);
      } catch {
        return;
      }

      const prejDolzina = stanje.zakljuceno.length;
      const izid = obdelajOdgovor(stanje, podatki);

      if (izid.napaka) {
        obdelajNapakoSeje(ws, izid.napaka.tip, izid.napaka.ponovljivo, izvleciRequestId(podatki));
        return;
      }

      // Veljaven odgovor streznika (zetoni ali finished) ponastavi stevec zaporednih napak.
      if (typeof podatki === "object" && podatki !== null && !Array.isArray(podatki)) {
        const zapis = podatki as Record<string, unknown>;
        if (Array.isArray(zapis.tokens) || zapis.finished === true) {
          zaporednihPonovitev = 0;
        }
      }

      if (stanje.zakljuceno.length > prejDolzina) {
        const novKos = stanje.zakljuceno.slice(prejDolzina);
        try {
          moznosti.naZakljuceno(novKos);
        } catch {
          // Ne prekinjaj klica zaradi napake v povratnem klicu.
        }
      }

      if (izid.konec) {
        ustaviTrajno();
        pokliciKonec();
      }
    });

    ws.addEventListener("error", () => {
      if (ws !== aktivnaVticnica || ustavljeno) return;
      obdelajNapakoSeje(ws, "service_unavailable", true);
    });

    ws.addEventListener("close", () => {
      if (ws !== aktivnaVticnica || ustavljeno) return;
      if (zakljucujem) {
        ustaviTrajno();
        pokliciKonec();
        return;
      }
      obdelajNapakoSeje(ws, "service_unavailable", true);
    });
  }

  if (kljuc.trim().length === 0) {
    ustavljeno = true;
    pokliciNapako("unauthenticated");
  } else {
    povezi();
  }

  return {
    poslji(pcm16k: Uint8Array): void {
      if (ustavljeno || zakljucujem) return;
      if (!(pcm16k instanceof Uint8Array) || pcm16k.byteLength === 0) return;

      const ws = aktivnaVticnica;
      if (ws && ws.readyState === WS_OPEN && zacetnoPoslano) {
        try {
          ws.send(zaPosiljanje(pcm16k));
          nacrtujKeepalive(ws);
        } catch {
          // Napaka seje nikoli ne sme vreci iz poslji.
        }
        return;
      }

      dodajVVrsto(pcm16k);
    },

    zakljuci(): Promise<void> {
      if (ustavljeno) return Promise.resolve();
      if (obljubaZakljucka) return obljubaZakljucka;

      zakljucujem = true;
      pocistiKeepalive();
      pocistiPonovitev();

      const ws = aktivnaVticnica;
      if (!ws || ws.readyState >= WS_CLOSING) {
        ustaviTrajno();
        pokliciKonec();
        return Promise.resolve();
      }

      obljubaZakljucka = new Promise<void>((resolve) => {
        razresiZakljucek = resolve;
      });

      casovnikZakljucka = setTimeout(() => {
        casovnikZakljucka = null;
        ustaviTrajno();
        pokliciKonec();
      }, rokZakljuckaMs);

      if (ws.readyState === WS_OPEN && zacetnoPoslano) {
        try {
          ws.send("");
        } catch {
          ustaviTrajno();
          pokliciKonec();
        }
      }

      return obljubaZakljucka;
    },

    zapri(): void {
      if (ustavljeno) return;
      ustaviTrajno();
    },
  };
}
