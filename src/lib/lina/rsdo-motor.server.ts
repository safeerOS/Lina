import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, readFile, unlink, writeFile } from "node:fs/promises";
import { freemem, homedir, tmpdir } from "node:os";
import path from "node:path";
import { odlociPotPrepisa, type PotPrepisa } from "./live/rsdo-namig.ts";
import { ocistiBesedilo, prepisiPrekStreznika, rsdoNalaga, rsdoPripravljen, rsdoVklopljen } from "./rsdo-streznik.server.ts";
import { nalozRnnoise, ocistiWav16k, type RnnoiseModul } from "./zvok-rnnoise.server.ts";

/**
 * Lokalni slovenski prepoznavalnik RSDO (dodatek »slovenski«). Lastnik 19. 11. 2026: »Gemini + namig RSDO«; 23. 11. 2026: »moral bi
 * delovati, ce je vklopljen« - po obnovi 20. 11. odlocitev (odlociPotPrepisa) ni bila povezana nikamor.
 * Posnetek -> ffmpeg (16 kHz mono WAV) -> stalni proces RSDO, ce je nalozen (rsdo-streznik.server.ts), sicer
 * cli-anything-linuxmint model slovenski -> besedilo, ki gre Geminiju kot namig.
 * Izmerjeno 23. 11. 2026: 29 s posnetka v 11,2 s, najvec 1,65 GB RAM (vecino casa nalaganje modela). Brez omrezja;
 * zacasni datoteki se po prepisu odstranita.
 */
export const ROK_PRETVORBE_MS = 15_000;
export const ROK_RSDO_MS = 25_000;
const NAJVEC_IZHODA = 1024 * 1024;
const VELJAVNOST_STANJA_MS = 10 * 60_000;

export type Izvajalec = (program: string, args: string[], rokMs: number) => Promise<{ koda: number; izhod: string }>;

const izvajalecPrivzeti: Izvajalec = (program, args, rokMs) =>
  new Promise((resolve) => {
    execFile(program, args, { timeout: rokMs, maxBuffer: NAJVEC_IZHODA }, (napaka, stdout) => {
      const koda = napaka ? (typeof (napaka as { code?: unknown }).code === "number" ? (napaka as { code: number }).code : 1) : 0;
      resolve({ koda, izhod: String(stdout ?? "") });
    });
  });

/** Stalni proces RSDO (rsdo-streznik.server.ts); v preizkusih nadomestek. */
export type StreznikRsdo = { pripravljen: () => boolean; prepisi: (wav: string) => Promise<string | null>; nalaga?: () => boolean; vklopljen?: () => boolean };
const streznikPrivzeti: StreznikRsdo = { pripravljen: rsdoPripravljen, prepisi: prepisiPrekStreznika, nalaga: rsdoNalaga, vklopljen: rsdoVklopljen };
/** Najdaljsi posnetek za prepis (s): dolg izrek ali sum ne zadrzi procesa do roka (pregled 029, najdba 6). */
export const NAJDALJSI_POSNETEK_S = 60;

export type OdvisnostiRsdo = {
  izvajalec?: Izvajalec;
  dom?: string;
  prostiRamMB?: () => number | null;
  ffmpeg?: string;
  streznik?: StreznikRsdo;
  /** Stikalo »Zmanjsanje hrupa« (zvok.json): RNNoise na 16 kHz WAV pred RSDO (naloga 17a). Ni podano = brez ciscenja. */
  ciscenje?: boolean;
  /** RNNoise (preizkusi); privzeto modul procesa. */
  rnnoise?: () => Promise<RnnoiseModul | null>;
};

/** RNNoise na WAV za RSDO; ob kakrsni koli napaki ostane izhod ffmpeg (prepis gre naprej). */
async function ocistiZaRsdo(wav: string, odv: OdvisnostiRsdo): Promise<void> {
  if (odv.ciscenje !== true) return;
  try {
    const modul = await (odv.rnnoise ?? nalozRnnoise)();
    if (!modul) return;
    const ociscen = await ocistiWav16k(modul, await readFile(wav));
    if (ociscen) await writeFile(wav, ociscen, { mode: 0o600 });
  } catch {
    /* izvirnik ffmpeg ostane */
  }
}

export function potCli(dom: string = homedir()): string {
  return path.join(dom, ".local", "bin", "cli-anything-linuxmint");
}

let stanje: { cas: number; namescen: boolean } | null = null;

/** Ali sta CLI in model namescena; izid velja 10 minut (preverba zazene Python in traja). */
export async function rsdoNamescen(odv: OdvisnostiRsdo = {}, zdaj = Date.now()): Promise<boolean> {
  if (stanje && zdaj - stanje.cas < VELJAVNOST_STANJA_MS) return stanje.namescen;
  const izv = odv.izvajalec ?? izvajalecPrivzeti;
  let namescen = false;
  try {
    await access(potCli(odv.dom), constants.X_OK);
    const r = await izv(potCli(odv.dom), ["--json", "model", "slovenski-stanje"], 20_000);
    namescen = r.koda === 0 && (JSON.parse(r.izhod) as { namescen?: unknown }).namescen === true;
  } catch {
    namescen = false;
  }
  stanje = { cas: zdaj, namescen };
  return namescen;
}

/** Samo za preizkuse: pozabi shranjeno stanje namestitve. */
export function ponastaviStanjeRsdo(): void {
  stanje = null;
}

/** Pot prepisa: stikalo dodatka »slovenski«, uporabnikova izbira namiga, namescen motor in dovolj prostega RAM. */
export async function potPrepisaZa(v: { dodatekVklopljen: boolean; rsdoNamig?: boolean }, odv: OdvisnostiRsdo = {}): Promise<PotPrepisa> {
  if (!v.dodatekVklopljen) return { pot: "gemini", razlog: "uporabnik-izklopil" };
  // nalozen stalni proces: model je ze v pomnilniku, zato preverba namestitve in prostega RAM odpade
  if (v.rsdoNamig !== false && (odv.streznik ?? streznikPrivzeti).pripravljen()) return { pot: "gemini-rsdo", razlog: "ok" };
  const namescen = await rsdoNamescen(odv);
  const ram = (odv.prostiRamMB ?? (() => Math.round(freemem() / 1048576)))();
  return odlociPotPrepisa({ rsdoNamig: v.rsdoNamig, rsdoNaVoljo: namescen, prostiRamMB: ram });
}

const KONCNICE: Record<string, string> = { webm: "webm", ogg: "ogg", wav: "wav", "x-wav": "wav", mp4: "m4a", mpeg: "mp3" };

export function koncnicaZa(mime: string): string {
  const podvrsta = /^audio\/([\w-]+)/i.exec(mime)?.[1]?.toLowerCase() ?? "";
  return KONCNICE[podvrsta] ?? "bin";
}

/** Prepis z RSDO; ob kakrsni koli napaki null (prepis z Gemini gre naprej brez namiga). */
export async function prepisiRsdo(zvok: Buffer, mime: string, odv: OdvisnostiRsdo = {}): Promise<string | null> {
  const izv = odv.izvajalec ?? izvajalecPrivzeti;
  const streznik = odv.streznik ?? streznikPrivzeti;
  // Stalni proces se nalaga (vklop ali ponoven zagon po padcu): CLI bi nalozil DRUG model (dvojni RAM), zato brez namiga (pregled 029, najdba 6).
  // Enako ob vklopljenem stikalu, ki se ni pripravljeno (napaka, cakanje na ponoven zagon): stalni proces je pot, ne CLI (CodeRabbit 029b).
  if (!streznik.pripravljen() && (streznik.nalaga?.() || streznik.vklopljen?.())) return null;
  const ime = path.join(tmpdir(), `lina-rsdo-${randomBytes(8).toString("hex")}`);
  const vhod = `${ime}.${koncnicaZa(mime)}`;
  const wav = `${ime}-16k.wav`;
  try {
    await writeFile(vhod, zvok, { mode: 0o600 });
    const p = await izv(odv.ffmpeg ?? "ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", vhod, "-t", String(NAJDALJSI_POSNETEK_S), "-ac", "1", "-ar", "16000", wav], ROK_PRETVORBE_MS);
    if (p.koda !== 0) return null;
    await ocistiZaRsdo(wav, odv);
    if (streznik.pripravljen()) {
      // napaka stalnega procesa ne sprozi se CLI (dvojni cas in dvojni RAM): prepis gre naprej brez namiga
      const b = ocistiBesedilo((await streznik.prepisi(wav)) ?? "").trim();
      return b || null;
    }
    // Znova tik pred CLI (CodeRabbit 029b): vklop med pretvorbo ffmpeg ali vklopljeno stikalo = stalni proces je pot, CLI bi nalozil DRUG model.
    if (streznik.nalaga?.() || streznik.vklopljen?.()) return null;
    const r = await izv(potCli(odv.dom), ["--json", "model", "slovenski", wav], ROK_RSDO_MS);
    if (r.koda !== 0) return null;
    const besedilo = (JSON.parse(r.izhod) as { besedilo?: unknown }).besedilo;
    const cisto = typeof besedilo === "string" ? ocistiBesedilo(besedilo).trim() : "";
    return cisto || null;
  } catch {
    return null;
  } finally {
    await unlink(vhod).catch(() => undefined);
    await unlink(wav).catch(() => undefined);
  }
}
