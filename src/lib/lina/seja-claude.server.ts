/**
 * Naloga 18 (lastnik 25. 11. 2026 23:25 »Da«): Lina sama odpre stalno sejo Claude Code s kanalom Line (kanal-claude), ko lastnik na telefonu
 * potrdi (podpise) nalogo in seje ni. Klice jo SAMO asistent-streznik.server.ts v poti /naloga PO preverbi podpisa naprave ozjega kroga.
 *
 * Ukaz je stalen: terminal (ukazTerminala, argv brez lupine) -> claude <stalen poziv> --mcp-config <podatki>/kanal/seja-mcp.json
 * --dangerously-load-development-channels server:lina. Besedilo naloge NIKOLI ni v argv, okolju ali mapi: naloga gre v sejo
 * po kanalu (podpis naprave preveri kanal znova). Mapa seje: <dom>/Lina-Claude (navadna mapa, ni povezava, ne v podatkih Line), 0700.
 * Ena seja naenkrat (rezervacija »zaganja« pred zagonom, PID), omejitev poskusov (brez zanke ob napaki), razlog ni-terminala / ni-claude.
 * Naloga se seji NE preda od tu: kanal zavrne podpis, starejsi od svojega zagona, telefon nalogo po odprtju seje podpise in poslje znova.
 * Zastavica --dangerously-load-development-channels: kanal brez nje ne deluje (kanal-claude.mts); ob zagonu Claude Code pokaze opozorilo
 * (DevChannelsDialog), ki ga lastnik potrdi v terminalu - NEPREVERJENO s pravim Claude Code.
 */
import { lstat, mkdir, realpath, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { najdiNaPoti, okoljeZaAgenta, privzetiZagonTerminala, type Zagon } from "./claude-naloge.server.ts";
import { KOREN_PROGRAMA, nastavitevMcp } from "./kanal-claude.server.ts";
import { MAPA_KANALA } from "./kanal-claude.ts";
import { platformaZdaj, ukazTerminala, type Platforma } from "./platforma.server.ts";

export type RazlogSeje = "ni-terminala" | "ni-claude" | "izklopljeno" | "opozorilo" | "omejitev" | "napaka";
export type IzidOdpiranjaSeje = { ok: true } | { ok: false; razlog: RazlogSeje };

/** Stalen poziv seji (brez besedila naloge). */
export const POZIV_SEJE = "Seja kanala Line: cakaj na naloge s telefona prek kanala lina in na vsako odgovori z orodjem reply.";
export const IME_MAPE_SEJE = "Lina-Claude";
/** Po zagonu terminala Lina toliko casa ne zazene nove seje (seja se se odpira ali caka lastnikovo potrditev opozorila v terminalu). */
export const ROK_ODPIRANJA_MS = 3 * 60_000;
/** Najvec poskusov v oknu (napaka terminala, seja se ne poveze): brez zanke zagonov. */
export const NAJVEC_POSKUSOV = 3;
export const OKNO_POSKUSOV_MS = 60 * 60_000;

export type OdvisnostiSeje = {
  najdi?: (ime: string) => string | null;
  zazeni?: Zagon;
  platforma?: Platforma;
  dom?: string;
  zdaj?: () => number;
  /** Za preizkuse: ali proces s tem PID zivi. */
  zivi?: (pid: number) => boolean;
};

type StanjeZagona = { zaganja: Promise<IzidOdpiranjaSeje> | null; odprto: number; pid: number | null; poskusi: number[]; razlog: RazlogSeje | "" };
const stanja = new Map<string, StanjeZagona>();
const stanjeZa = (root: string) => {
  let s = stanja.get(root);
  if (!s) stanja.set(root, (s = { zaganja: null, odprto: 0, pid: null, poskusi: [], razlog: "" }));
  return s;
};
/** Zadnji neuspel samodejni zagon (za sporocilo na racunalniku); prazno po uspehu ali brez poskusa. */
export function zadnjiRazlogSeje(root: string): RazlogSeje | "" {
  return stanja.get(path.resolve(root))?.razlog ?? "";
}

/** Razlog, ki ga ugotovi klicatelj pred zagonom (opozorilo agentov ni potrjeno), da ga racunalnik pokaze kot ostale. */
export function zapisiRazlogSeje(root: string, razlog: RazlogSeje): void {
  stanjeZa(path.resolve(root)).razlog = razlog;
}

/** Za preizkuse: pozabi stanje zagonov tega korena. */
export function ponastaviSejo(root: string): void {
  stanja.delete(path.resolve(root));
}

const zivPid = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Mapa seje: navadna mapa tega uporabnika pod domom (ustvari 0700), ne simbolna povezava in ne v podatkih Line. */
async function mapaSeje(dom: string, root: string): Promise<string> {
  const mapa = path.join(dom, IME_MAPE_SEJE);
  await mkdir(mapa, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "EEXIST") throw e;
  });
  const st = await lstat(mapa);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error("mapa seje ni navadna mapa");
  // slepi pregled 18 N4: mapa tega uporabnika, brez pisanja za skupino in druge (kot preveriKoren za podatke Line)
  if (typeof process.getuid === "function" && st.uid !== process.getuid()) throw new Error("mapa seje ni od tega uporabnika");
  if (st.mode & 0o022) throw new Error("v mapo seje lahko pisejo drugi");
  const prava = await realpath(mapa);
  const podatki = await realpath(root);
  if (prava === podatki || prava.startsWith(podatki + path.sep) || podatki.startsWith(prava + path.sep)) throw new Error("mapa seje v podatkih Line");
  return prava;
}

/** Nastavitev MCP za sejo (samo poti in mapa podatkov, brez skrivnosti), 0600, zapis prek zacasne datoteke. */
async function zapisiNastavitevMcp(root: string): Promise<string> {
  const mapa = path.join(root, MAPA_KANALA);
  await mkdir(mapa, { recursive: true, mode: 0o700 });
  const cilj = path.join(mapa, "seja-mcp.json");
  const tmp = `${cilj}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(nastavitevMcp(root, KOREN_PROGRAMA)), { mode: 0o600, flag: "wx" });
  await rename(tmp, cilj);
  return cilj;
}

/**
 * Odpre sejo Claude Code s kanalom Line (ena naenkrat). ok = terminal je zagnan ali se seja ze odpira (klicatelj caka, da se kanal poveze).
 * Stikalo (samodejno) preveri klicatelj; tu se ne bere nic iz zahteve telefona.
 */
export async function odpriSejoClaude(root0: string, o: OdvisnostiSeje = {}): Promise<IzidOdpiranjaSeje> {
  const s = stanjeZa(path.resolve(root0));
  const izid = await odpri(path.resolve(root0), s, o);
  s.razlog = izid.ok ? "" : izid.razlog;
  return izid;
}

function odpri(root: string, s: StanjeZagona, o: OdvisnostiSeje): Promise<IzidOdpiranjaSeje> {
  if (s.zaganja) return s.zaganja;
  const zdaj = (o.zdaj ?? Date.now)();
  // ena seja naenkrat: terminal je bil pravkar odprt (ali PID se zivi) - ne odpri druge
  if (zdaj - s.odprto < ROK_ODPIRANJA_MS || (s.pid !== null && (o.zivi ?? zivPid)(s.pid))) return Promise.resolve({ ok: true });
  s.poskusi = s.poskusi.filter((t) => zdaj - t < OKNO_POSKUSOV_MS);
  if (s.poskusi.length >= NAJVEC_POSKUSOV) return Promise.resolve({ ok: false, razlog: "omejitev" });
  const najdi = o.najdi ?? ((ime: string) => najdiNaPoti(ime));
  const terminal = ukazTerminala(najdi, o.platforma ?? platformaZdaj());
  if ("razlog" in terminal) return Promise.resolve({ ok: false, razlog: "ni-terminala" });
  const claude = najdi("claude");
  if (!claude) return Promise.resolve({ ok: false, razlog: "ni-claude" });
  // rezervacija PRED zagonom: socasna naloga caka isti izid, ne zazene drugega terminala
  s.poskusi.push(zdaj);
  s.zaganja = (async (): Promise<IzidOdpiranjaSeje> => {
    try {
      const mapa = await mapaSeje(o.dom ?? homedir(), root);
      const mcp = await zapisiNastavitevMcp(root);
      // poziv PRED moznostmi: --mcp-config in --dangerously-load-development-channels sta variadicni (poziv za njima bi bil se en streznik)
      const argv = [...terminal.predpona, claude, POZIV_SEJE, "--mcp-config", mcp, "--dangerously-load-development-channels", "server:lina"];
      const pid = await (o.zazeni ?? privzetiZagonTerminala)(terminal.program, argv, mapa, okoljeZaAgenta());
      s.odprto = (o.zdaj ?? Date.now)();
      s.pid = typeof pid === "number" ? pid : null;
      return { ok: true };
    } catch {
      return { ok: false, razlog: "napaka" };
    } finally {
      s.zaganja = null;
    }
  })();
  return s.zaganja;
}
