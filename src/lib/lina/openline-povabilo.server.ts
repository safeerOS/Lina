/**
 * Pot klicev v zdruzenem QR (lastnik 14. 11. 2026: en QR in ena potrditev za obe poti). Lina na tem racunalniku vprasa
 * streznik OpenLine za enkratno kodo seznanitve, kot jo danes izda konzola (POST /v1/pairing, glava x-api-key): telefon jo
 * zamenja za svoj zeton naprave neposredno pri OpenLine (POST /v1/pair). Lina zetona naprave nikoli ne vidi.
 *
 * Locitev: ta modul pozna samo upravni vmesnik OpenLine; ne uvaza poti klica ne asistentke. Kljuc API OpenLine je sifriran
 * (keys.server.ts), zahteva gre samo na 127.0.0.1 prek TLS s pripetim odtisom potrdila OpenLine (preverjen PRED posiljanjem
 * kljuca), brez preusmeritev.
 */
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { requireOwner } from "./auth.server.ts";
import { enakoKonstantno } from "./kanal-claude.ts";
import { odsifrirajSkrivnost, sifrirajSkrivnost } from "./keys.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";
import { zasebenNaslov } from "./zasebno-omrezje.server.ts";

export const NASTAVITVE_OPENLINE = "openline-povabilo.json";
const ODTIS = /^[0-9a-f]{64}$/;
/** Koda OpenLine (pairing.ts: 8 znakov brez 0/O/1/I/L). */
export const KODA_OPENLINE = /^[A-HJ-KMNP-Z2-9]{8}$/;
const NAJVEC_ODGOVOR = 64 * 1024;
const ROK_MS = 5000;

type Sifra = { iv: string; tag: string; ciphertext: string };
/** `naslov`: naslov IPv4, na katerega se OpenLine veze (zasebni naslov racunalnika); brez njega (rocni vnos iz konzole) 127.0.0.1. */
type Nastavitve = { vrata: number; odtis: string; kljuc: Sifra; naslov?: string };
const NASLOV_IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const jeNaslovOpenLine = (v: unknown): v is string => typeof v === "string" && NASLOV_IPV4.test(v) && zasebenNaslov(v);

export const normalizirajOdtis = (o: string) => o.replace(/[:\s]/g, "").toLowerCase();

export async function nastavitveOpenLine(root: string): Promise<{ vrata: number; odtis: string; kljuc: string; naslov: string } | null> {
  const n = await readJsonFile<Nastavitve>(root, NASTAVITVE_OPENLINE).catch(() => null);
  if (!n || !Number.isInteger(n.vrata) || !ODTIS.test(n.odtis) || !n.kljuc) return null;
  const kljuc = await odsifrirajSkrivnost(n.kljuc, root);
  return kljuc ? { vrata: n.vrata, odtis: n.odtis, kljuc, naslov: jeNaslovOpenLine(n.naslov) ? n.naslov : "127.0.0.1" } : null;
}

/** Lastnik vpise vrata OpenLine na tem racunalniku, odtis potrdila in kljuc API (iz konzole OpenLine). Kljuc ne gre nazaj. */
export async function shraniOpenLine(token: string | null, vnos: { vrata?: unknown; odtis?: unknown; kljuc?: unknown; pozabi?: unknown }, dir?: string): Promise<{ povezan: boolean }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (vnos.pozabi === true) {
    await writeJson(root, NASTAVITVE_OPENLINE, {});
    return { povezan: false };
  }
  const vrata = Number(vnos.vrata);
  const odtis = typeof vnos.odtis === "string" ? normalizirajOdtis(vnos.odtis) : "";
  const kljuc = typeof vnos.kljuc === "string" ? vnos.kljuc.trim() : "";
  await zapisiOpenLineNotranje(root, { vrata, odtis, kljuc });
  return { povezan: true };
}

/**
 * NOTRANJI zapis nastavitev: pokliche ga samo program sam, ko je OpenLine v isti aplikaciji zagnal on (lastnik ne vpise nic). Brez preverjanja
 * lastnika, zato se ne sme izpostaviti kot funkcija strezniku (functions.ts) ali pot. Preverjanje vnosa je isto kot pri rocnem vnosu.
 */
export async function zapisiOpenLineNotranje(root: string, vnos: { vrata: number; odtis: string; kljuc: string; naslov?: string }): Promise<void> {
  const vrata = Number(vnos.vrata);
  const odtis = typeof vnos.odtis === "string" ? normalizirajOdtis(vnos.odtis) : "";
  const kljuc = typeof vnos.kljuc === "string" ? vnos.kljuc.trim() : "";
  if (!Number.isInteger(vrata) || vrata < 1 || vrata > 65535) throw new Error("Vrata OpenLine morajo biti od 1 do 65535.");
  if (!ODTIS.test(odtis)) throw new Error("Odtis potrdila OpenLine ima 64 sestnajstiskih znakov (SHA-256).");
  if (kljuc.length < 16 || kljuc.length > 512 || /\s/.test(kljuc)) throw new Error("Kljuc API OpenLine ni veljaven.");
  if (vnos.naslov !== undefined && !jeNaslovOpenLine(vnos.naslov)) throw new Error("Naslov OpenLine mora biti zasebni naslov IPv4 tega racunalnika.");
  await writeJson(root, NASTAVITVE_OPENLINE, {
    vrata, odtis, kljuc: await sifrirajSkrivnost(kljuc, root), ...(vnos.naslov !== undefined ? { naslov: vnos.naslov } : {}),
  } satisfies Nastavitve);
}

export async function stanjeOpenLine(root: string): Promise<{ povezan: boolean; vrata: number; odtis: string }> {
  const n = await nastavitveOpenLine(root);
  return { povezan: !!n, vrata: n?.vrata ?? 0, odtis: n?.odtis ?? "" };
}

export type PovabiloOpenLine = { url: string; koda: string; odtis: string };
export type PovezavaTls = (vrata: number, naslov?: string) => TLSSocket;

/**
 * Ena zahteva HTTP na upravni vmesnik OpenLine prek TLS: odtis potrdila se preveri PRED posiljanjem zahteve (v njej je kljuc API),
 * odgovor je omejen na NAJVEC_ODGOVOR, preusmeritvam se ne sledi (klicatelj preveri status).
 */
function zahtevaOpenLine(n: { vrata: number; odtis: string; naslov: string }, zahteva: string, povezi: PovezavaTls): Promise<{ status: number; telo: string }> {
  return new Promise<{ status: number; telo: string }>((ok, ne) => {
    const s = povezi(n.vrata, n.naslov);
    const kosi: Buffer[] = [];
    let dolzina = 0;
    const t = setTimeout(() => { s.destroy(); ne(new Error("OpenLine ne odgovori.")); }, ROK_MS);
    s.once("error", () => { clearTimeout(t); ne(new Error("Povezava z OpenLine ni uspela.")); });
    s.once("secureConnect", () => {
      const fp = normalizirajOdtis(s.getPeerCertificate()?.fingerprint256 ?? "");
      if (!enakoKonstantno(fp, n.odtis)) {
        clearTimeout(t);
        s.destroy();
        ne(new Error("Odtis potrdila OpenLine se ne ujema."));
        return;
      }
      s.write(zahteva);
    });
    s.on("data", (k: Buffer) => {
      dolzina += k.length;
      if (dolzina > NAJVEC_ODGOVOR) { clearTimeout(t); s.destroy(); ne(new Error("Odgovor OpenLine je predolg.")); return; }
      kosi.push(k);
    });
    s.once("end", () => {
      clearTimeout(t);
      const vse = Buffer.concat(kosi).toString("utf8");
      const m = /^HTTP\/1\.[01] (\d{3})[^\r\n]*\r\n([\s\S]*?)\r\n\r\n([\s\S]*)$/.exec(vse);
      if (!m) { ne(new Error("Odgovor OpenLine ni HTTP.")); return; }
      if (/^transfer-encoding:\s*chunked/im.test(m[2])) {
        // telo po kosih: dolzine kosov odstranimo (odgovor je kratek JSON)
        let ostanek = m[3];
        let izid = "";
        for (;;) {
          const i = ostanek.indexOf("\r\n");
          const d = parseInt(ostanek.slice(0, i), 16);
          if (!Number.isFinite(d) || d === 0) break;
          izid += ostanek.slice(i + 2, i + 2 + d);
          ostanek = ostanek.slice(i + 2 + d + 2);
        }
        ok({ status: Number(m[1]), telo: izid });
        return;
      }
      ok({ status: Number(m[1]), telo: m[3] });
    });
  });
}

/**
 * Enkratna koda OpenLine za telefon. `javniNaslov` = https://<zasebni naslov>:<vrata> (telefon ga doseze v domacem omrezju).
 * Odtis potrdila se preveri, preden gre kljuc API po povezavi; odgovor 3xx se ne sledi.
 */
export async function povabiloOpenLine(root: string, javniNaslov: string, povezi: PovezavaTls = (v, naslov = "127.0.0.1") => tlsConnect({ host: naslov, port: v, rejectUnauthorized: false, servername: "localhost" })): Promise<PovabiloOpenLine> {
  const n = await nastavitveOpenLine(root);
  if (!n) throw new Error("Streznik OpenLine ni nastavljen.");
  const telo = JSON.stringify({ publicUrl: javniNaslov });
  const odgovor = await zahtevaOpenLine(n, `POST /v1/pairing HTTP/1.1\r\nHost: localhost:${n.vrata}\r\nx-api-key: ${n.kljuc}\r\ncontent-type: application/json\r\n` +
    `content-length: ${Buffer.byteLength(telo)}\r\nconnection: close\r\n\r\n${telo}`, povezi);
  if (odgovor.status >= 300 && odgovor.status < 400) throw new Error("OpenLine je odgovoril s preusmeritvijo; ne sledimo.");
  if (odgovor.status === 401 || odgovor.status === 403) throw new Error("OpenLine kljuca API ni sprejel.");
  if (odgovor.status !== 201) throw new Error(`OpenLine je odgovoril ${odgovor.status}.`);
  let j: { code?: unknown; publicUrl?: unknown; certSha256?: unknown };
  try {
    j = JSON.parse(odgovor.telo);
  } catch {
    throw new Error("Odgovor OpenLine ni JSON.");
  }
  if (typeof j.code !== "string" || !KODA_OPENLINE.test(j.code)) throw new Error("OpenLine ni vrnil veljavne kode.");
  if (typeof j.certSha256 !== "string" || !enakoKonstantno(normalizirajOdtis(j.certSha256), n.odtis)) throw new Error("OpenLine je vrnil drug odtis.");
  if (j.publicUrl !== javniNaslov) throw new Error("OpenLine je vrnil drug naslov.");
  return { url: javniNaslov, koda: j.code, odtis: n.odtis };
}

/**
 * Naloga 16 (oznaka linije): koliko telefonov ima OpenLine zapisanih in koliko jih je ZDAJ povezanih s potjo klicev. OpenLine pozna
 * zivo vticnico naprave (`connected`; ping vsakih 20 s, ob zaprti vticnici se takoj pobrise). Ne pove, ali Lina na telefonu klice
 * sprejema. null = ne vemo (OpenLine ni nastavljen, ne odgovori ali odgovori nepricakovano).
 */
export async function telefoniOpenLine(root: string, povezi: PovezavaTls = (v, naslov = "127.0.0.1") => tlsConnect({ host: naslov, port: v, rejectUnauthorized: false, servername: "localhost" })): Promise<{ naprav: number; povezanih: number } | null> {
  const n = await nastavitveOpenLine(root).catch(() => null);
  if (!n) return null;
  try {
    const odgovor = await zahtevaOpenLine(n, `GET /v1/devices HTTP/1.1\r\nHost: localhost:${n.vrata}\r\nx-api-key: ${n.kljuc}\r\nconnection: close\r\n\r\n`, povezi);
    if (odgovor.status !== 200) return null;
    const j = JSON.parse(odgovor.telo) as { devices?: unknown };
    if (!Array.isArray(j.devices)) return null;
    const povezanih = j.devices.filter((d) => !!d && typeof d === "object" && (d as { connected?: unknown }).connected === true).length;
    return { naprav: j.devices.length, povezanih };
  } catch {
    return null;
  }
}
