/**
 * Namestitev freellmapi (MIT, github.com/tashfeenahmed/freellmapi) kot lasten OpenAI-zdruzljiv streznik ZA POGOVOR
 * (naloga #43, lastnik 21. 11. 2026). CISTA enota: samo gradniki datotek in razclenjevalniki, brez omrezja, diska in procesov.
 * Streznik (lastni-streznik-namestitev.server.ts) jih uporabi in poklice docker.
 *
 * Varnostne meje (vsaka ima preizkus):
 * - slika je PRIPETA po vsoti (digest), ne po oznaki »latest«: namestimo samo tisto, kar smo preizkusili;
 * - vrata so vezana na 127.0.0.1 (nikoli 0.0.0.0), brez docker.sock, brez privileged, brez host omrezja, brez watchtowerja;
 * - skrbnik in ENCRYPTION_KEY sta nakljucna in sta samo v datotekah z dovoljenji 600 v Linini podatkovni mapi;
 * - compose se pred vsakim zagonom ponovno preveri (jeVarenCompose), ker bi ga lahko kdo spremenil na disku.
 */

export const SLIKA = "ghcr.io/tashfeenahmed/freellmapi@sha256:de0bdc3f40e546bd8b639eae87dacca24ba0714ca26587262197865733f1e3d5";
export const IME_PROJEKTA = "lina-freellmapi";
export const MAPA_NAMESTITVE = "freellmapi";
export const PRIVZETA_VRATA = 3191;
export const STEVILO_POSKUSOV_VRAT = 20;
export const ADMIN_EPOSTA = "lina@localhost.invalid";
export const POMNILNIK_MEJA = "768m";
export const NAJVEC_PROCESOV = 256;
export const MODEL_PRIVZETI = "auto";

const SLIKA_VZOREC = /^ghcr\.io\/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const GESLO = /^[A-Za-z0-9_-]{24,128}$/;
const ZETON_PRIJAVE = /^[A-Za-z0-9._~-]{16,600}$/;
const ENOTNI_KLJUC = /^freellmapi-[A-Za-z0-9_-]{16,160}$/;

export function jeVeljavnaSlika(vrednost: unknown): vrednost is string {
  return typeof vrednost === "string" && SLIKA_VZOREC.test(vrednost);
}

export function jeVeljavnaVrata(vrednost: unknown): vrednost is number {
  return typeof vrednost === "number" && Number.isInteger(vrednost) && vrednost >= 1024 && vrednost <= 65535;
}

/** Prva prosta vrata od zacetnih naprej (najvec STEVILO_POSKUSOV_VRAT); null, ce so vsa zasedena ali je zacetek neveljaven. */
export function izberiVrata(zasedena: ReadonlyArray<number>, zacetek: number = PRIVZETA_VRATA): number | null {
  const zasedeno = new Set(zasedena);
  for (let i = 0; i < STEVILO_POSKUSOV_VRAT; i++) {
    const vrata = zacetek + i;
    if (!jeVeljavnaVrata(vrata)) return null;
    if (!zasedeno.has(vrata)) return vrata;
  }
  return null;
}

/** Naslov za Lino (shraniLastniStreznik): lokalni naslov z vrati. */
export function naslovIzVrat(vrata: number): string {
  if (!jeVeljavnaVrata(vrata)) throw new Error("Neveljavna vrata.");
  return `http://127.0.0.1:${vrata}/v1`;
}

/** Datoteka .env: sifrirni kljuc (64 sestnajstiskih), vrata in vezava SAMO na ta racunalnik. */
export function sestaviEnv(vhod: { sifrirniKljuc: string; vrata: number }): string {
  if (!HEX64.test(vhod.sifrirniKljuc)) throw new Error("Sifrirni kljuc mora imeti 64 malih sestnajstiskih znakov.");
  if (!jeVeljavnaVrata(vhod.vrata)) throw new Error("Neveljavna vrata.");
  return `ENCRYPTION_KEY=${vhod.sifrirniKljuc}\nPORT=${vhod.vrata}\nHOST_BIND=127.0.0.1\n`;
}

/** Deklarativna nastavitev: skrbnik vnaprej, da se prvi zagon z odprto registracijo ne zgodi nikoli. */
export function sestaviKonfiguracijo(vhod: { geslo: string; eposta?: string }): string {
  if (!GESLO.test(vhod.geslo)) throw new Error("Geslo skrbnika mora imeti 24 do 128 znakov (crke, stevke, _ in -).");
  const eposta = vhod.eposta ?? ADMIN_EPOSTA;
  if (!/^[a-z0-9._-]+@[a-z0-9.-]+$/.test(eposta)) throw new Error("Neveljavna e-posta skrbnika.");
  return `${JSON.stringify({ admin: { email: eposta, password: vhod.geslo } })}\n`;
}

/** Datoteka docker-compose.yml. Vsebuje samo, kar jeVarenCompose dovoli. */
export function sestaviCompose(vhod: { slika?: string } = {}): string {
  const slika = vhod.slika ?? SLIKA;
  if (!jeVeljavnaSlika(slika)) throw new Error("Slika mora biti pripeta po vsoti (@sha256:...).");
  return `name: ${IME_PROJEKTA}
services:
  freellmapi:
    image: ${slika}
    env_file:
      - .env
    environment:
      NODE_ENV: production
      PORT: 3001
      FREEAPI_CONFIG_PATH: /config/freellmapi.config.json
    ports:
      - "127.0.0.1:\${PORT:-${PRIVZETA_VRATA}}:3001"
    volumes:
      - freellmapi-data:/app/server/data
      - ./freellmapi.config.json:/config/freellmapi.config.json:ro
    restart: "no"
    mem_limit: ${POMNILNIK_MEJA}
    pids_limit: ${NAJVEC_PROCESOV}
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3001/api/ping').then((res) => { if (!res.ok) process.exit(1); }).catch(() => process.exit(1));"]
      interval: 30s
      timeout: 5s
      start_period: 15s
      retries: 3
volumes:
  freellmapi-data:
`;
}

const PREPOVEDANO_V_COMPOSE: ReadonlyArray<[RegExp, string]> = [
  [/docker\.sock/i, "dostop do docker vticnice"],
  [/privileged\s*:/i, "privileged"],
  [/network_mode\s*:/i, "network_mode"],
  [/\bpid\s*:/i, "pid"],
  [/\bipc\s*:/i, "ipc"],
  [/\buserns_mode\s*:/i, "userns_mode"],
  [/cap_add\s*:/i, "cap_add"],
  [/\bdevices\s*:/i, "devices"],
  [/watchtower/i, "watchtower"],
  [/0\.0\.0\.0/, "vezava na vse naslove"],
  [/\bcommand\s*:|\bentrypoint\s*:/i, "spremenjen ukaz"],
];

/**
 * Ali je compose datoteka natanko taka, kot jo sestavi Lina (z dovoljenim izborom slike in vrat)? Zahteva ujemanje celotne
 * vsebine, ne samo odsotnost prepovedanih besed: kar drugega Lina ne zazene. Razlog je za uporabnika.
 */
export function jeVarenCompose(besedilo: string): { ok: true } | { ok: false; razlog: string } {
  if (typeof besedilo !== "string" || besedilo.length === 0 || besedilo.length > 4000) return { ok: false, razlog: "Datoteka compose ni veljavna." };
  for (const [vzorec, ime] of PREPOVEDANO_V_COMPOSE) {
    if (vzorec.test(besedilo)) return { ok: false, razlog: `Datoteka compose vsebuje prepovedano nastavitev (${ime}).` };
  }
  const slika = /^\s{4}image:\s*(\S+)\s*$/m.exec(besedilo)?.[1];
  if (!slika || !jeVeljavnaSlika(slika)) return { ok: false, razlog: "Slika v datoteki compose ni pripeta po vsoti." };
  // Samo slika, ki jo je Lina preizkusila (SLIKA): nova razlicica pride z novo razlicico Line, ne z urejanjem datoteke.
  if (slika !== SLIKA) return { ok: false, razlog: "Slika ni tista, ki jo je Lina preizkusila." };
  if (besedilo !== sestaviCompose()) return { ok: false, razlog: "Datoteka compose ni takšna, kot jo sestavi Lina." };
  return { ok: true };
}

/** Odgovor POST /api/auth/login: {token, email}. */
export function razberiZetonPrijave(telo: unknown): string | null {
  if (typeof telo !== "object" || telo === null) return null;
  const zeton = (telo as { token?: unknown }).token;
  return typeof zeton === "string" && ZETON_PRIJAVE.test(zeton) ? zeton : null;
}

/** Odgovor GET /api/settings/api-key: {apiKey}. */
export function razberiEnotniKljuc(telo: unknown): string | null {
  if (typeof telo !== "object" || telo === null) return null;
  const kljuc = (telo as { apiKey?: unknown }).apiKey;
  return typeof kljuc === "string" && ENOTNI_KLJUC.test(kljuc) ? kljuc : null;
}

/** Nakljucno geslo skrbnika iz bajtov (klicatelj poda crypto.randomBytes(24)): 32 znakov base64url. */
export function gesloIzBajtov(bajti: Uint8Array): string {
  if (bajti.length < 18) throw new Error("Geslo potrebuje vsaj 18 nakljucnih bajtov.");
  return Buffer.from(bajti.slice(0, 24)).toString("base64url");
}

/** Sifrirni kljuc iz 32 nakljucnih bajtov. */
export function sifrirniKljucIzBajtov(bajti: Uint8Array): string {
  if (bajti.length < 32) throw new Error("Sifrirni kljuc potrebuje 32 nakljucnih bajtov.");
  return Buffer.from(bajti.slice(0, 32)).toString("hex");
}

/** Argumenti za docker compose (brez lupine): projekt in datoteke so vedno izrecni. */
export function argumentiCompose(vhod: { compose: string; env: string }, podukaz: ReadonlyArray<string>): string[] {
  return ["compose", "-p", IME_PROJEKTA, "-f", vhod.compose, "--env-file", vhod.env, ...podukaz];
}

/** Vrata iz datoteke .env (vrstica PORT=...); null, ce je ni ali ni veljavna. */
export function razberiVrataIzEnv(besedilo: string): number | null {
  if (typeof besedilo !== "string") return null;
  const zadetek = /^PORT=(\d{1,5})$/m.exec(besedilo);
  if (!zadetek) return null;
  const vrata = Number(zadetek[1]);
  return jeVeljavnaVrata(vrata) ? vrata : null;
}

/** Skrbnik iz freellmapi.config.json (kot ga je napisala Lina); null, ce oblika ni prava. */
export function razberiAdminIzKonfiguracije(besedilo: string): { eposta: string; geslo: string } | null {
  if (typeof besedilo !== "string") return null;
  let j: unknown;
  try {
    j = JSON.parse(besedilo);
  } catch {
    return null;
  }
  const admin = typeof j === "object" && j !== null ? (j as { admin?: unknown }).admin : null;
  if (typeof admin !== "object" || admin === null) return null;
  const { email, password } = admin as { email?: unknown; password?: unknown };
  if (typeof email !== "string" || typeof password !== "string" || !GESLO.test(password)) return null;
  return { eposta: email, geslo: password };
}
