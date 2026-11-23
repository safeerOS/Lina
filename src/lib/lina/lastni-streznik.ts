/**
 * Lasten OpenAI-zdruzljiv streznik kot MOZGANI ZA POGOVOR (naloga #43, lastnik 21. 11. 2026): freellmapi, LM Studio, Ollama ...
 * Cista enota brez omrezja in datotek (preizkusljiva brez strezniskih uvozov):
 * - normirajNaslov: kam sme Lina poslati pogovor (http samo na tem racunalniku ali v domacem omrezju, sicer https),
 * - lastniZahtevek: zahtevek POST /chat/completions,
 * - lastniOdgovor: razbere odgovor; sklepalni modeli vracajo polje reasoning in ob premajhnem max_tokens je odgovor odrezan med
 *   sklepanjem (izmerjeno 21. 11. 2026: finish_reason=length, content = reasoning), tega NE smemo imeti za odgovor.
 * Omejitev lastnika: tajnica (klici) ne dobi tega ponudnika (to zagotavlja callProvider: vsebinaKlica mora biti izrecno false).
 */

export const NAJVEC_NASLOV = 200;
/** Sklepalni modeli porabijo del zetonov za razmislek; pri manjsi meji odgovora pogosto ni. */
export const NAJMANJ_ZETONOV_LASTNI = 1024;
export const NAJVEC_ZETONOV_LASTNI = 4096;
export const PRIVZETI_MODEL_LASTNI = "auto";

export type IzidNaslova = { ok: true; naslov: string; lokalen: boolean } | { ok: false; razlog: string };

function ipv4(gostitelj: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(gostitelj);
  if (!m) return null;
  const deli = m.slice(1).map(Number);
  return deli.every((d) => d <= 255) ? deli : null;
}

/** Vedno prepovedano: nikjer (0.0.0.0/8), povezovalni naslovi z metapodatki oblaka (169.254/16), rezervirano (224+). */
function jePrepovedan(deli: number[]): boolean {
  const [a, b] = deli;
  return a === 0 || (a === 169 && b === 254) || a >= 224;
}

function jeLoopback(gostitelj: string, deli: number[] | null): boolean {
  if (gostitelj === "localhost" || gostitelj === "[::1]") return true;
  return deli !== null && deli[0] === 127;
}

function jeZasebno(deli: number[] | null): boolean {
  if (!deli) return false;
  const [a, b] = deli;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * Normiran naslov strezniku (brez /chat/completions, brez zaklepnih posevnic). Prazna pot postane /v1.
 * http je dovoljen samo za localhost, 127.x, [::1] in zasebne naslove IPv4 (10/8, 172.16/12, 192.168/16); drugje samo https.
 */
export function normirajNaslov(vhod: unknown): IzidNaslova {
  if (typeof vhod !== "string" || !vhod.trim()) return { ok: false, razlog: "Vpišite naslov strežnika." };
  const besedilo = vhod.trim();
  if (besedilo.length > NAJVEC_NASLOV) return { ok: false, razlog: "Naslov strežnika je predolg." };
  let url: URL;
  try {
    url = new URL(besedilo);
  } catch {
    return { ok: false, razlog: "Naslov strežnika ni veljaven (primer: http://127.0.0.1:3001/v1)." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, razlog: "Naslov mora začeti s http:// ali https://." };
  }
  if (url.username || url.password) return { ok: false, razlog: "Naslov ne sme vsebovati uporabniškega imena ali gesla." };
  if (url.search || url.hash) return { ok: false, razlog: "Naslov ne sme vsebovati poizvedbe ali sidra." };
  const gostitelj = url.hostname.toLowerCase();
  if (!gostitelj) return { ok: false, razlog: "Naslov nima gostitelja." };
  const deli = ipv4(gostitelj);
  if (deli && jePrepovedan(deli)) return { ok: false, razlog: "Ta naslov ni dovoljen." };
  const lokalen = jeLoopback(gostitelj, deli) || jeZasebno(deli);
  if (url.protocol === "http:" && !lokalen) {
    return { ok: false, razlog: "Nešifriran http je dovoljen samo na tem računalniku ali v domačem omrežju; drugje uporabite https." };
  }
  let pot = url.pathname.replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(pot)) pot = pot.replace(/\/chat\/completions$/i, "");
  if (!pot) pot = "/v1";
  if (/[\s<>"\\^`{|}]/.test(pot)) return { ok: false, razlog: "Pot v naslovu vsebuje neveljavne znake." };
  return { ok: true, naslov: `${url.protocol}//${url.host}${pot}`, lokalen };
}

export type LastniZahtevek = {
  naslov: string;
  model: string;
  key: string;
  text: string;
  system?: string;
  maxTokens?: number;
};

/** Zahtevek za pogovor. Kljuc je neobvezen (lokalni streznik ga pogosto nima); gre samo v glavo Authorization, nikoli v naslov. */
export function lastniZahtevek(vhod: LastniZahtevek): { url: string; init: RequestInit } {
  const izid = normirajNaslov(vhod.naslov);
  if (!izid.ok) throw new Error(izid.razlog);
  if (vhod.key && izid.naslov.includes(vhod.key)) throw new Error("Ključ ne sme biti v naslovu.");
  const glave: Record<string, string> = { "content-type": "application/json" };
  if (vhod.key) glave.authorization = `Bearer ${vhod.key}`;
  const zetoni = Math.min(
    NAJVEC_ZETONOV_LASTNI,
    Math.max(NAJMANJ_ZETONOV_LASTNI, Math.floor(Number.isFinite(vhod.maxTokens) ? (vhod.maxTokens as number) : 0)),
  );
  const sporocila = [
    ...(vhod.system ? [{ role: "system", content: vhod.system }] : []),
    { role: "user", content: vhod.text.slice(0, 4000) },
  ];
  return {
    url: `${izid.naslov}/chat/completions`,
    init: {
      method: "POST",
      headers: glave,
      body: JSON.stringify({ model: vhod.model, max_tokens: zetoni, messages: sporocila }),
    },
  };
}

export type LastniOdgovor = { ok: true; text: string } | { ok: false; sporocilo: string };

function izDelov(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v
      .map((d) => (d && typeof d === "object" && typeof (d as { text?: unknown }).text === "string" ? (d as { text: string }).text : ""))
      .join("");
  }
  return "";
}

const BREZ_PRESLEDKOV = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Razbere telo odgovora OpenAI-zdruzljivega strezniska. Odrezan razmislek NI odgovor. */
export function lastniOdgovor(telo: string): LastniOdgovor {
  let json: unknown;
  try {
    json = JSON.parse(telo);
  } catch {
    return { ok: false, sporocilo: "Strežnik ni vrnil veljavnega odgovora." };
  }
  if (!json || typeof json !== "object") return { ok: false, sporocilo: "Strežnik ni vrnil veljavnega odgovora." };
  const o = json as {
    error?: { message?: unknown } | unknown;
    choices?: Array<{ message?: { content?: unknown; reasoning?: unknown; reasoning_content?: unknown }; finish_reason?: unknown }>;
  };
  const napaka = o.error && typeof o.error === "object" ? (o.error as { message?: unknown }).message : undefined;
  if (typeof napaka === "string" && napaka.trim()) return { ok: false, sporocilo: `Strežnik: ${napaka.trim().slice(0, 200)}` };
  const izbira = Array.isArray(o.choices) ? o.choices[0] : undefined;
  const sporocilo = izbira?.message;
  let vsebina = izDelov(sporocilo?.content);
  vsebina = vsebina.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const odprt = vsebina.search(/<think>/i);
  if (odprt >= 0) vsebina = vsebina.slice(0, odprt);
  vsebina = vsebina.trim();
  const razmislek = izDelov(sporocilo?.reasoning) || izDelov(sporocilo?.reasoning_content);
  const odrezan = izbira?.finish_reason === "length";
  if (odrezan && (!vsebina || (razmislek !== "" && BREZ_PRESLEDKOV(vsebina) === BREZ_PRESLEDKOV(razmislek)))) {
    return {
      ok: false,
      sporocilo: "Model je odgovor porabil za razmišljanje in ga ni dokončal. Izberite model brez razmišljanja ali poskusite znova.",
    };
  }
  if (!vsebina) return { ok: false, sporocilo: "Strežnik ni vrnil besedila." };
  return { ok: true, text: vsebina };
}
