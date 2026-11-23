/**
 * Cista enota protokola Soniox STT WebSocket (brez uvozov streznika in omrezja).
 * Gradi zacetno sporocilo, obdeluje odgovore z zetoni (zakljuceni + nezakljuceni),
 * izloci posebni zeton konca izreka <end> in razvrsca tipe napak po dokumentaciji Soniox.
 */

export const SONIOX_WS_URL = "wss://stt-rt.soniox.com/transcribe-websocket";
export const SONIOX_KEEPALIVE_JSON = '{"type":"keepalive"}';
export const SONIOX_ZETON_KONCA_IZREKA = "<end>";
const SONIOX_ZETON_ROCNE_ZAKLJUCITVE = "<fin>";

const KODA_JEZIKA = /^[a-z]{2}$/i;

const PONOVLJIVE_NAPAKE = new Set<string>([
  "service_unavailable",
  "internal_error",
  "request_timeout",
  "max_duration_reached",
]);

export interface SonioxZacetnoSporocilo {
  model: "stt-rt-v6";
  audio_format: "pcm_s16le";
  sample_rate: 16000;
  num_channels: 1;
  language_hints: [string];
  enable_endpoint_detection: true;
}

export interface SonioxStanje {
  zakljuceno: string;
  nezakljuceno: string;
}

export interface SonioxNapakaOdgovora {
  tip: string;
  ponovljivo: boolean;
}

export interface SonioxIzidOdgovora {
  zakljuceno: string;
  nezakljuceno: string;
  konec: boolean;
  napaka?: SonioxNapakaOdgovora;
}

function jeZapis(vrednost: unknown): vrednost is Record<string, unknown> {
  return typeof vrednost === "object" && vrednost !== null && !Array.isArray(vrednost);
}

/**
 * Zgradi zacetno konfiguracijsko sporocilo Soniox brez osebnih podatkov in brez api_key.
 * Koda jezika mora biti dvocrkovna (privzeto "sl").
 */
export function sonioxZacetnoSporocilo(moznosti?: { jezik?: string }): SonioxZacetnoSporocilo {
  const suroviJezik = moznosti?.jezik === undefined ? "sl" : moznosti.jezik;
  if (typeof suroviJezik !== "string" || !KODA_JEZIKA.test(suroviJezik)) {
    throw new RangeError("Koda jezika mora biti dvocrkovna (ISO 639-1).");
  }
  return {
    model: "stt-rt-v6",
    audio_format: "pcm_s16le",
    sample_rate: 16000,
    num_channels: 1,
    language_hints: [suroviJezik.toLowerCase()],
    enable_endpoint_detection: true,
  };
}

/** Ustvari prazno zacetno stanje prepisa za eno sejo Soniox. */
export function novoStanje(): SonioxStanje {
  return {
    zakljuceno: "",
    nezakljuceno: "",
  };
}

/** Razvrsti tip napake Soniox (error_type): true pomeni, da je nova povezava smiselna. */
export function jePonovljivaNapaka(tip: string): boolean {
  return PONOVLJIVE_NAPAKE.has(tip);
}

/** Izvlece request_id iz odgovora streznika, ce obstaja kot neprazen niz. */
export function izvleciRequestId(odgovor: unknown): string | undefined {
  if (!jeZapis(odgovor)) return undefined;
  return typeof odgovor.request_id === "string" && odgovor.request_id.length > 0
    ? odgovor.request_id
    : undefined;
}

/**
 * Obdela en JSON odgovor streznika Soniox nad tekocim stanjem prepisa.
 * Nikoli ne vrze za nepricakovano obliko (neznan odgovor vrne prazen rezultat in ne spremeni stanja).
 */
export function obdelajOdgovor(stanje: SonioxStanje, odgovor: unknown): SonioxIzidOdgovora {
  if (!jeZapis(odgovor)) {
    return { zakljuceno: "", nezakljuceno: "", konec: false };
  }

  if (typeof odgovor.error_type === "string" && odgovor.error_type.length > 0) {
    const tip = odgovor.error_type;
    stanje.nezakljuceno = "";
    return {
      zakljuceno: stanje.zakljuceno,
      nezakljuceno: "",
      konec: false,
      napaka: {
        tip,
        ponovljivo: jePonovljivaNapaka(tip),
      },
    };
  }

  const imaZetone = Array.isArray(odgovor.tokens);
  const konec = odgovor.finished === true;
  if (!imaZetone && !konec) {
    return { zakljuceno: "", nezakljuceno: "", konec: false };
  }

  if (imaZetone) {
    const zetoni = odgovor.tokens as unknown[];
    let dodanoZakljuceno = "";
    let novoNezakljuceno = "";

    for (const element of zetoni) {
      if (!jeZapis(element)) continue;
      if (typeof element.text !== "string" || typeof element.is_final !== "boolean") continue;
      const besedilo = element.text;
      if (besedilo === SONIOX_ZETON_KONCA_IZREKA || besedilo === SONIOX_ZETON_ROCNE_ZAKLJUCITVE) {
        continue;
      }
      if (element.is_final) {
        dodanoZakljuceno += besedilo;
      } else {
        novoNezakljuceno += besedilo;
      }
    }

    stanje.zakljuceno += dodanoZakljuceno;
    stanje.nezakljuceno = novoNezakljuceno;
  } else {
    stanje.nezakljuceno = "";
  }

  return {
    zakljuceno: stanje.zakljuceno,
    nezakljuceno: stanje.nezakljuceno,
    konec,
  };
}
