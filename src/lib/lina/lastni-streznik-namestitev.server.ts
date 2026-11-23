/**
 * Namestitev in upravljanje lastnega streznika freellmapi (naloga #43, lastnik 21. 11. 2026): ko uporabnik vklopi moznost,
 * Lina streznik NAMESTI sama (Docker), ga zazene, vzame enotni kljuc in ga shrani KOT MOZGANE ZA POGOVOR (nikoli za klice).
 *
 * Pravila:
 * - samo lastnik (requireOwner); obstojecih datotek ne prepisujemo (flag wx); nepopolna mapa = ustavimo in povemo;
 * - docker iscemo na znanih absolutnih poteh (ne po PATH uporabnika: ~/.local/bin je pred /usr/bin); ukazi brez lupine;
 * - pred VSAKIM zagonom se datoteka compose ponovno preveri (jeVarenCompose);
 * - ob napaki po zagonu se vsebnik ustavi (strezniki, ki jih ne potrebujemo, so zaprti);
 * - Docker se NE namesti sam (potrebuje skrbnika sistema): Lina pove, kaj naj uporabnik naredi.
 * Windows (Docker Desktop): NEPREVERJENO do preizkusa na testnem racunalniku.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { requireOwner } from "./auth.server.ts";
import { shraniLastniStreznik } from "./keys.server.ts";
import {
  MAPA_NAMESTITVE,
  MODEL_PRIVZETI,
  PRIVZETA_VRATA,
  STEVILO_POSKUSOV_VRAT,
  argumentiCompose,
  gesloIzBajtov,
  izberiVrata,
  jeVarenCompose,
  jeVeljavnaVrata,
  naslovIzVrat,
  razberiAdminIzKonfiguracije,
  razberiEnotniKljuc,
  razberiVrataIzEnv,
  razberiZetonPrijave,
  sestaviCompose,
  sestaviEnv,
  sestaviKonfiguracijo,
  sifrirniKljucIzBajtov,
} from "./lastni-streznik-namestitev.ts";
import { jeWindows } from "./platforma.server.ts";
import { resolveDataDir } from "./store.server.ts";

export const ROK_POVLEKA_MS = 15 * 60_000;
export const ROK_PRIPRAVLJENOSTI_MS = 120_000;
const ROK_UKAZA_MS = 60_000;
/** Sporocilo, ko uporabnik opozorila o zasebnosti ni izrecno potrdil. */
export const SPOROCILO_BREZ_SOGLASJA = "Brez potrditve opozorila o zasebnosti namestitve ne začnem.";
const ROK_DOCKER_INFO_MS = 8_000;

export type IzidZagona = { koda: number | null; izhod: string };

export type Odvisnosti = {
  najdiDocker: () => string | null;
  zagon: (ukaz: string, args: string[], opcije: { timeoutMs: number }) => Promise<IzidZagona>;
  fetch: typeof fetch;
  prostaVrata: (zacetek: number) => Promise<number | null>;
  nakljucno: (stevilo: number) => Uint8Array;
  pocakaj: (ms: number) => Promise<void>;
  zdaj: () => number;
};

const DOCKER_POTI_POSIX = ["/usr/bin/docker", "/usr/local/bin/docker", "/snap/bin/docker"];
const DOCKER_POTI_WINDOWS = ["C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe"];

function najdiDockerPrivzeto(): string | null {
  for (const pot of jeWindows() ? DOCKER_POTI_WINDOWS : DOCKER_POTI_POSIX) {
    if (existsSync(pot)) return pot;
  }
  return null;
}

function zagonPrivzeto(ukaz: string, args: string[], opcije: { timeoutMs: number }): Promise<IzidZagona> {
  return new Promise((resolve) => {
    execFile(ukaz, args, { timeout: opcije.timeoutMs, windowsHide: true, maxBuffer: 2_000_000 }, (napaka, stdout, stderr) => {
      const izhod = `${stdout ?? ""}${stderr ?? ""}`;
      if (!napaka) return resolve({ koda: 0, izhod });
      const koda = typeof (napaka as { code?: unknown }).code === "number" ? ((napaka as { code: number }).code) : null;
      resolve({ koda, izhod });
    });
  });
}

function prostaVrataPrivzeto(zacetek: number): Promise<number | null> {
  const preizkusi = (vrata: number): Promise<boolean> =>
    new Promise((resolve) => {
      const streznik = net.createServer();
      streznik.once("error", () => resolve(false));
      streznik.listen(vrata, "127.0.0.1", () => streznik.close(() => resolve(true)));
    });
  return (async () => {
    for (let i = 0; i < STEVILO_POSKUSOV_VRAT; i++) {
      const vrata = zacetek + i;
      if (!jeVeljavnaVrata(vrata)) return null;
      if (await preizkusi(vrata)) return vrata;
    }
    return null;
  })();
}

function privzete(): Odvisnosti {
  return {
    najdiDocker: najdiDockerPrivzeto,
    zagon: zagonPrivzeto,
    fetch: (...args) => globalThis.fetch(...args),
    prostaVrata: prostaVrataPrivzeto,
    nakljucno: (n) => new Uint8Array(randomBytes(n)),
    pocakaj: (ms) => new Promise((r) => setTimeout(r, ms)),
    zdaj: () => Date.now(),
  };
}

function poti(root: string): { mapa: string; compose: string; env: string; config: string } {
  const mapa = path.join(root, MAPA_NAMESTITVE);
  return { mapa, compose: path.join(mapa, "docker-compose.yml"), env: path.join(mapa, ".env"), config: path.join(mapa, "freellmapi.config.json") };
}

function popolna(p: { compose: string; env: string; config: string }): boolean {
  return existsSync(p.compose) && existsSync(p.env) && existsSync(p.config);
}

/** Zadnja vrstica izhoda docker, skrajsana (brez skrivnosti: docker jih ne izpisuje). */
function kratekRazlog(izhod: string): string {
  const vrstice = izhod.split("\n").map((v) => v.trim()).filter(Boolean);
  return (vrstice[vrstice.length - 1] ?? "").slice(0, 200);
}

async function pingaj(odv: Odvisnosti, vrata: number): Promise<boolean> {
  try {
    const odg = await odv.fetch(`http://127.0.0.1:${vrata}/api/ping`, { redirect: "error", signal: AbortSignal.timeout(3000) });
    return odg.ok;
  } catch {
    return false;
  }
}

async function pocakajPripravljenost(odv: Odvisnosti, vrata: number): Promise<boolean> {
  const zacetek = odv.zdaj();
  while (odv.zdaj() - zacetek < ROK_PRIPRAVLJENOSTI_MS) {
    if (await pingaj(odv, vrata)) return true;
    await odv.pocakaj(2000);
  }
  return false;
}

async function jsonKlic(odv: Odvisnosti, url: string, init: RequestInit): Promise<{ ok: boolean; telo: unknown }> {
  try {
    const odg = await odv.fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(10_000) });
    const besedilo = await odg.text();
    let telo: unknown = null;
    try {
      telo = JSON.parse(besedilo);
    } catch {
      telo = null;
    }
    return { ok: odg.ok, telo };
  } catch {
    return { ok: false, telo: null };
  }
}

/** Prijava skrbnika in enotni kljuc (skrbnik in geslo sta v Lininih datotekah). Kljuca nikoli ne izpisemo. */
async function vzemiEnotniKljuc(odv: Odvisnosti, vrata: number, configBesedilo: string): Promise<string | null> {
  const admin = razberiAdminIzKonfiguracije(configBesedilo);
  if (!admin) return null;
  const osnova = `http://127.0.0.1:${vrata}`;
  const prijava = await jsonKlic(odv, `${osnova}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: admin.eposta, password: admin.geslo }),
  });
  const zeton = prijava.ok ? razberiZetonPrijave(prijava.telo) : null;
  if (!zeton) return null;
  const kljuc = await jsonKlic(odv, `${osnova}/api/settings/api-key`, { method: "GET", headers: { authorization: `Bearer ${zeton}` } });
  return kljuc.ok ? razberiEnotniKljuc(kljuc.telo) : null;
}

export type IzidNamestitve = { ok: true; naslov: string; vrata: number; novoNamescen: boolean } | { ok: false; sporocilo: string };

let namestitevPoteka = false;

async function ustaviTiho(odv: Odvisnosti, docker: string, p: { compose: string; env: string }): Promise<void> {
  await odv.zagon(docker, argumentiCompose({ compose: p.compose, env: p.env }, ["stop"]), { timeoutMs: ROK_UKAZA_MS }).catch(() => undefined);
}

/**
 * Namesti (ali ponovno zazene ze nameščen) lasten streznik in ga shrani za pogovor.
 * Opozorilo: pozivi gredo prek strežnika k brezplačnim ponudnikom tretjih oseb; nikoli za klice.
 * Brez `soglasje: true` (izrecna potrditev uporabnika v vmesniku) se ne zgodi nič.
 */
export async function namestiLastniStreznik(
  vhod: { uporabiZaPogovor?: boolean; soglasje?: boolean },
  token: string | null,
  dir?: string,
  odvDel: Partial<Odvisnosti> = {},
): Promise<IzidNamestitve> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  // Brez izrecne potrditve opozorila (pozivi gredo k brezplacnim ponudnikom tretjih oseb) se ne zgodi nic:
  // ne docker, ne datoteke, ne shranjevanje kljuca. Samo natancno true (niz, stevilo, null ne veljajo).
  if (vhod.soglasje !== true) return { ok: false, sporocilo: SPOROCILO_BREZ_SOGLASJA };
  const odv = { ...privzete(), ...odvDel };
  if (namestitevPoteka) return { ok: false, sporocilo: "Namestitev že poteka." };
  namestitevPoteka = true;
  try {
    const docker = odv.najdiDocker();
    if (!docker) {
      return { ok: false, sporocilo: "Docker ni nameščen. Namestite Docker (docs.docker.com/engine/install) in poskusite znova; sam se ne namesti, ker potrebuje skrbnika sistema." };
    }
    const info = await odv.zagon(docker, ["info", "--format", "{{.ServerVersion}}"], { timeoutMs: ROK_DOCKER_INFO_MS });
    if (info.koda !== 0) {
      return { ok: false, sporocilo: "Docker ne odgovarja. Zaženite ga in preverite, da ga smete uporabljati (skupina docker), nato poskusite znova." };
    }
    const p = poti(root);
    let vrata: number;
    let novo = false;
    if (existsSync(p.mapa)) {
      if (!popolna(p)) {
        return { ok: false, sporocilo: `Mapa namestitve že obstaja, a ni popolna. Ničesar ne prepisujem; preglejte jo ročno: ${p.mapa}` };
      }
      const prebrana = razberiVrataIzEnv(await readFile(p.env, "utf8"));
      if (!prebrana) return { ok: false, sporocilo: `Datoteka ${p.env} nima veljavnih vrat. Ničesar ne prepisujem.` };
      vrata = prebrana;
    } else {
      const prosta = await odv.prostaVrata(PRIVZETA_VRATA);
      if (prosta === null) return { ok: false, sporocilo: `Ne najdem prostih vrat (${PRIVZETA_VRATA} do ${PRIVZETA_VRATA + STEVILO_POSKUSOV_VRAT - 1}).` };
      vrata = prosta;
      await mkdir(p.mapa, { mode: 0o700 });
      await writeFile(p.env, sestaviEnv({ sifrirniKljuc: sifrirniKljucIzBajtov(odv.nakljucno(32)), vrata }), { flag: "wx", mode: 0o600 });
      await writeFile(p.config, sestaviKonfiguracijo({ geslo: gesloIzBajtov(odv.nakljucno(24)) }), { flag: "wx", mode: 0o600 });
      await writeFile(p.compose, sestaviCompose(), { flag: "wx", mode: 0o600 });
      novo = true;
    }
    const varno = jeVarenCompose(await readFile(p.compose, "utf8"));
    if (!varno.ok) return { ok: false, sporocilo: `${varno.razlog} Zato ga ne zaženem.` };
    const gor = await odv.zagon(docker, argumentiCompose(p, ["up", "-d"]), { timeoutMs: ROK_POVLEKA_MS });
    if (gor.koda !== 0) {
      await ustaviTiho(odv, docker, p);
      return { ok: false, sporocilo: `Zagon strežnika ni uspel. ${kratekRazlog(gor.izhod)}`.trim() };
    }
    if (!(await pocakajPripravljenost(odv, vrata))) {
      await ustaviTiho(odv, docker, p);
      return { ok: false, sporocilo: "Strežnik se ni odzval v dveh minutah, zato sem ga ustavila." };
    }
    const kljuc = await vzemiEnotniKljuc(odv, vrata, await readFile(p.config, "utf8"));
    if (!kljuc) {
      await ustaviTiho(odv, docker, p);
      return { ok: false, sporocilo: "Prijava v strežnik ni uspela, zato sem ga ustavila." };
    }
    const naslov = naslovIzVrat(vrata);
    await shraniLastniStreznik({ naslov, model: MODEL_PRIVZETI, key: kljuc, uporabiZaPogovor: vhod.uporabiZaPogovor !== false }, token, root);
    return { ok: true, naslov, vrata, novoNamescen: novo };
  } finally {
    namestitevPoteka = false;
  }
}

/** Ustavi strezniik (podatki ostanejo). Brez namestitve ni kaj ustaviti. */
export async function ustaviLastniStreznik(token: string | null, dir?: string, odvDel: Partial<Odvisnosti> = {}): Promise<{ ok: boolean; sporocilo: string }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const odv = { ...privzete(), ...odvDel };
  const p = poti(root);
  if (!popolna(p)) return { ok: false, sporocilo: "Lasten strežnik še ni nameščen." };
  const docker = odv.najdiDocker();
  if (!docker) return { ok: false, sporocilo: "Docker ni najden." };
  const izid = await odv.zagon(docker, argumentiCompose(p, ["stop"]), { timeoutMs: ROK_UKAZA_MS });
  return izid.koda === 0 ? { ok: true, sporocilo: "Strežnik je ustavljen." } : { ok: false, sporocilo: `Ustavitev ni uspela. ${kratekRazlog(izid.izhod)}`.trim() };
}

export type StanjeLastnega = {
  namescen: boolean;
  tece: boolean;
  vrata: number | null;
  docker: "ni" | "ne-odgovarja" | "ok" | "nepreverjeno";
};

/** Stanje za vmesnik. Docker se preveri samo, ce je zahtevano (preverba je draga). */
export async function stanjeLastnegaStreznika(
  vhod: { preveriDocker?: boolean },
  token: string | null,
  dir?: string,
  odvDel: Partial<Odvisnosti> = {},
): Promise<StanjeLastnega> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const odv = { ...privzete(), ...odvDel };
  const p = poti(root);
  const namescen = popolna(p);
  const vrata = namescen ? razberiVrataIzEnv(await readFile(p.env, "utf8").catch(() => "")) : null;
  const tece = vrata !== null ? await pingaj(odv, vrata) : false;
  let docker: StanjeLastnega["docker"] = "nepreverjeno";
  if (vhod.preveriDocker) {
    const pot = odv.najdiDocker();
    if (!pot) docker = "ni";
    else docker = (await odv.zagon(pot, ["info", "--format", "{{.ServerVersion}}"], { timeoutMs: ROK_DOCKER_INFO_MS })).koda === 0 ? "ok" : "ne-odgovarja";
  }
  return { namescen, tece, vrata, docker };
}
