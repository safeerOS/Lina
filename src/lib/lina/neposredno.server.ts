import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { lookup } from "node:dns/promises";
import { connect as tlsConnect } from "node:tls";
import { isIP } from "node:net";
import { join } from "node:path";
import { poisciProgram, potTar, prenesiPreverjeno, vsotaEnaka, type NajdenProgram, type NaVoljo, type PonudnikTunela, type RezultatNamestitve, type ZagnanTunel } from "./tunel.server.ts";

/**
 * Neposredna pot (lastnik 12. 11. 2026, »kot Safeer Link: neposredno privzeto, rele samo kot rezerva«): uporabnikova domena,
 * javno veljavno potrdilo (Let's Encrypt, samodejno prek Caddy), usmerjevalnik preusmeri zunanji 443 -> 8443 in 80 -> 8081
 * (Lina ne zahteva root: nizka vrata ostanejo usmerjevalniku). Caddy kaze na ISTI posrednik kot tunel (samo /api/voice/).
 * Domaci IP se ne zapisuje v dnevnik; Lina ga sploh ne pozna (domena se razresi ob preverbi in se ne shrani).
 */
export const CADDY_VERZIJA = "2.11.9";
const OSNOVA = `https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERZIJA}/`;
export const VRATA_HTTP = 8081;
export const VRATA_HTTPS = 8443;
const ROK_POTRDILA_MS = 60_000;
const ROK_PREIZKUSA_MS = 1500;

/** sha256 = vsota ARHIVA (preveri se ob prenosu); sha256Program = vsota IZPAKIRANEGA programa (preveri se pred vsakim zagonom, pregled P1). */
export type ArhivCaddy = { datoteka: string; sha256: string; sha256Program: string; url: string };
/** Vsote izmerjene 12. 11. 2026 na dejansko preneseni datoteki (arhiv = digest uradne izdaje GitHub API) in na razpakiranem programu. */
const ARHIVI: Record<string, ArhivCaddy> = {
  "linux-x64": { datoteka: `caddy_${CADDY_VERZIJA}_linux_amd64.tar.gz`, sha256: "5b8cb7faf8726a2028ad96a66e54e6e81e8f361bc6175e5d22bbd997cc5177fb", sha256Program: "a563843e11cbce39c557bd429ebb787d56f49d51d9bbb3292cd9b36b37a60cdf", url: "" },
  "linux-arm64": { datoteka: `caddy_${CADDY_VERZIJA}_linux_arm64.tar.gz`, sha256: "5e377cff994fc9362a6fcf695c53f226cfca3a3ef85bd3a3687cf252d6310165", sha256Program: "762d7763ed8e303d50bf11fb0274627266907ea8c170720d7d9a6fd0b9bf5c65", url: "" },
  "win32-x64": { datoteka: `caddy_${CADDY_VERZIJA}_windows_amd64.zip`, sha256: "ad93112d335ee687100c4c9f11bced16ca590377976b7fe7883882b9e797e472", sha256Program: "2622e239c79df700b0eb92cbd950d1edee365e155a7859f358f0e55f002df591", url: "" },
};
export function arhivCaddy(platform: NodeJS.Platform = process.platform, arch: string = process.arch): ArhivCaddy | null {
  const a = ARHIVI[`${platform}-${arch}`];
  return a ? { ...a, url: OSNOVA + a.datoteka } : null;
}

export function mapaNeposredno(root: string): string {
  return join(root, "neposredno");
}
const imeCaddy = (platform: NodeJS.Platform): string => (platform === "win32" ? "caddy.exe" : "caddy");

/** Domena: majhne crke, vsaj ena pika, brez poti, vrat in IP; dolzine po RFC. */
export function veljavnaDomena(vnos: string): string | null {
  const d = vnos.trim().toLowerCase();
  if (d.length < 4 || d.length > 253 || isIP(d)) return null;
  return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d) ? d : null;
}

/** Naslov v DNS, ki z interneta ni dosegljiv: zasebni, CGNAT, povezava-lokalni, loopback, dokumentacijski/testni, multicast, rezervirani, ::ffff:v4. */
export function jeNejavenNaslov(ip: string): boolean {
  const n = ip.trim().toLowerCase();
  if (n.includes(":")) {
    const preslikan = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(n);
    if (preslikan) return jeNejavenNaslov(preslikan[1]);
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(n);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return jeNejavenNaslov(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return n === "::1" || n === "::" || /^fe[89ab]/.test(n) || /^fe[c-f]/.test(n) || /^f[cd]/.test(n) || /^ff/.test(n) || n.startsWith("2001:db8");
  }
  const d = n.split(".").map(Number);
  if (d.length !== 4 || d.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b, c] = d;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)
  );
}

/**
 * Datoteka Caddyfile: posrednik je edini cilj; podatki potrdil v Lininih mapah (brez ~/.local/share). Obramba v globino
 * (pregled P9): Caddy sam prepusti samo /api/voice/*, vse drugo je 404; telo najvec 1 MB, casovne meje, brez HTTP/3 (UDP).
 * Veljavnost konfiguracije potrjena s `caddy validate` (Caddy 2.11.9, 12. 11. 2026).
 */
export function caddyfile(domena: string, vrataPosrednika: number, mapaPodatkov: string): string {
  if (!veljavnaDomena(domena) || !Number.isInteger(vrataPosrednika)) throw new Error("Neveljavna domena.");
  // V Caddyfile se {$VAR} in { } razsirijo: poti s temi znaki ne sprejmemo (pregled P9a).
  if (/[{}$"\n\r\\]/.test(mapaPodatkov)) throw new Error("Neveljavna pot podatkov.");
  return `{
	admin off
	http_port ${VRATA_HTTP}
	https_port ${VRATA_HTTPS}
	skip_install_trust
	storage file_system "${mapaPodatkov}"
	cert_issuer acme {
		alt_http_port ${VRATA_HTTP}
		alt_tlsalpn_port ${VRATA_HTTPS}
	}
	servers {
		protocols h1 h2
		max_header_size 16KB
		timeouts {
			read_header 10s
			read_body 30s
			write 60s
			idle 2m
		}
	}
}
${domena} {
	request_body {
		max_size 1MB
	}
	handle /api/voice/* {
		reverse_proxy 127.0.0.1:${vrataPosrednika}
	}
	handle {
		respond 404
	}
}
`;
}

function razpakiraj(ukaz: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => execFile(ukaz, args, { windowsHide: true, timeout: 5 * 60_000 }, (napaka) => resolve(!napaka)));
}

/** Namestitev Caddy v Linino mapo: prenos z github.com, SHA-256 celega arhiva PRED razpakiranjem, brez root. */
export async function namestiCaddy(
  mapa: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  odv: { prenesi?: (url: string, cilj: string) => Promise<string>; razpakiraj?: (ukaz: string, args: string[]) => Promise<boolean> } = {},
): Promise<RezultatNamestitve> {
  const arhiv = arhivCaddy(platform, arch);
  if (!arhiv) return { uspeh: false, sporocilo: "Za ta sistem Lina ne more sama namestiti programa Caddy." };
  const prenesi = odv.prenesi ?? ((u, c) => prenesiPreverjeno(u, c));
  const razp = odv.razpakiraj ?? razpakiraj;
  mkdirSync(mapa, { recursive: true, mode: 0o700 });
  if (platform !== "win32") chmodSync(mapa, 0o700);
  const zacasna = mkdtempSync(join(mapa, "namestitev-"));
  try {
    const datoteka = join(zacasna, "arhiv");
    let vsota: string;
    try {
      vsota = await prenesi(arhiv.url, datoteka);
    } catch {
      return { uspeh: false, sporocilo: "Prenos programa Caddy ni uspel. Preverite internetno povezavo." };
    }
    if (!vsotaEnaka(vsota, arhiv.sha256)) return { uspeh: false, sporocilo: "Preneseni arhiv ne ustreza pričakovani vsoti, zato ga nisem razpakirala." };
    const izhod = join(zacasna, "izhod");
    mkdirSync(izhod);
    // tar z absolutno potjo (pregled P7): ne po PATH uporabnika.
    const tar = potTar(platform);
    const ukaz = platform === "win32" ? { u: tar, a: ["-xf", datoteka, "-C", izhod] } : { u: tar, a: ["-xzf", datoteka, "--no-same-owner", "-C", izhod] };
    if (!(await razp(ukaz.u, ukaz.a))) return { uspeh: false, sporocilo: "Razpakiranje programa Caddy ni uspelo." };
    const program = join(izhod, imeCaddy(platform));
    if (!existsSync(program)) return { uspeh: false, sporocilo: "Arhiv ne vsebuje programa Caddy." };
    if (platform !== "win32") chmodSync(program, 0o700);
    renameSync(program, join(mapa, imeCaddy(platform)));
    return { uspeh: true };
  } catch {
    return { uspeh: false, sporocilo: "Namestitev programa Caddy ni uspela." };
  } finally {
    rmSync(zacasna, { recursive: true, force: true });
  }
}

/** Caddy: NAJPREJ pripeta kopija v Lini (vsota programa preverjena pred zagonom), nato varen program iz PATH (ne na Windows). */
export function poisciCaddy(root: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): NajdenProgram | null {
  return poisciProgram(imeCaddy(platform), mapaNeposredno(root), env, platform);
}

/** Pripeta kopija: vsota IZPAKIRANEGA programa se mora ujemati (ne vsota arhiva: pregled P1). */
export async function lastnaKopijaVeljavna(pot: string, arhiv: ArhivCaddy | null): Promise<boolean> {
  if (!arhiv) return false;
  const vsota = createHash("sha256").update(await readFile(pot)).digest("hex");
  return vsotaEnaka(vsota, arhiv.sha256Program);
}

export type IzidPreizkusa = { ok: true } | { ok: false; razlog: string };

/**
 * Zunanji preizkus dosegljivosti (SAMO NASVET, ne pogoj za zagon: pregled P4): pravi https na domena:443 s preverjenim potrdilom; kakrsen koli
 * odgovor pomeni, da zahteva pride do posrednika. Teče iz domacega omrezja: usmerjevalnik brez »hairpin NAT« ga zavrne, ceprav je pot od
 * zunaj odprta. Domena se razresi ENKRAT, vsak naslov preveri (en nejaven = zavrni) in povezava gre na preverjen naslov (brez ponovnega DNS).
 */
export async function zunanjiPreizkus(
  domena: string,
  rokMs: number = ROK_PREIZKUSA_MS,
  razresi: (d: string) => Promise<string[]> = razresiJavno,
): Promise<IzidPreizkusa> {
  let naslovi: string[];
  try {
    naslovi = await razresi(domena);
  } catch {
    return { ok: false, razlog: "Domene ni mogoče razrešiti." };
  }
  if (naslovi.length === 0 || naslovi.some(jeNejavenNaslov)) return { ok: false, razlog: "Zapis DNS vsebuje zasebni ali neveljaven naslov." };
  return new Promise((resolve) => {
    const r = httpsRequest({ host: naslovi[0], port: 443, path: "/api/voice/lina-zivi", method: "GET", timeout: rokMs, servername: domena, headers: { host: domena } }, (o) => {
      o.resume();
      resolve({ ok: true });
    });
    r.on("timeout", () => {
      r.destroy();
      resolve({ ok: false, razlog: "Preizkus iz tega omrežja ne dobi odgovora po vratih 443. Če neposredna pot deluje, je to lahko le usmerjevalnik brez dostopa iz notranjega omrežja; preizkusite s telefonom v mobilnem omrežju." });
    });
    r.on("error", (e: NodeJS.ErrnoException) => {
      const k = e.code ?? "";
      if (k === "ECONNREFUSED" || k === "EHOSTUNREACH" || k === "ENETUNREACH") resolve({ ok: false, razlog: "Vrata 443 so iz tega omrežja zaprta. Preusmerite zunanji 443 na 8443 in 80 na 8081 na ta računalnik (ali pa usmerjevalnik ne podpira dostopa iz notranjega omrežja)." });
      else resolve({ ok: false, razlog: "Domene ni mogoče doseči po vratih 443 iz tega omrežja." });
    });
    r.end();
  });
}

/** Ali Caddy ze streze veljavno javno potrdilo za domeno (lokalna prisluskovalka 8443 s SNI; Node preveri verigo in ime). */
export function preveriPotrdilo(domena: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = tlsConnect({ host: "127.0.0.1", port: VRATA_HTTPS, servername: domena, timeout: 3000 }, () => {
      const ok = s.authorized;
      s.destroy();
      resolve(ok);
    });
    s.on("error", () => resolve(false));
    s.on("timeout", () => {
      s.destroy();
      resolve(false);
    });
  });
}

async function razresiJavno(domena: string): Promise<string[]> {
  const naslovi = await lookup(domena, { all: true });
  return naslovi.map((n) => n.address);
}

export type OdvisnostiNeposredno = {
  poisci?: (root: string) => NajdenProgram | null;
  razresi?: (domena: string) => Promise<string[]>;
  preveriPotrdilo?: (domena: string) => Promise<boolean>;
  /** Za preizkuse: pripeti podatki arhiva (vsota izpakiranega programa). */
  arhiv?: ArhivCaddy | null;
  rokPotrdilaMs?: number;
};

export function ponudnikNeposredno(domenaVnos: string, odv: OdvisnostiNeposredno = {}): PonudnikTunela {
  const poisci = odv.poisci ?? ((root: string) => poisciCaddy(root));
  const razresi = odv.razresi ?? razresiJavno;
  const potrdilo = odv.preveriPotrdilo ?? preveriPotrdilo;
  const rok = odv.rokPotrdilaMs ?? ROK_POTRDILA_MS;
  const domena = veljavnaDomena(domenaVnos);
  return {
    id: "neposredno",
    program: "caddy",
    veljavenNaslov: (n) => (domena && n === `https://${domena}` ? n : null),
    naVoljo(root): NaVoljo {
      return { najden: poisci(root) !== null, namestljiv: arhivCaddy() !== null };
    },
    namesti: (root) => namestiCaddy(mapaNeposredno(root)),
    async zazeni(vrata, root, naZagon): Promise<ZagnanTunel> {
      if (!domena) throw new Error("Vpišite veljavno domeno (na primer lina.moja-domena.si).");
      const program = poisci(root);
      if (!program) throw new Error("Program Caddy ni nameščen.");
      if (program.vir === "lastna") {
        if (!(await lastnaKopijaVeljavna(program.pot, odv.arhiv !== undefined ? odv.arhiv : arhivCaddy()))) {
          throw new Error("Nameščen program Caddy ne ustreza pričakovani vsoti, zato ga ne zaženem.");
        }
      }
      // DNS pred zagonom: brez javnega naslova ne bo ne potrdila ne dosegljivosti (CGNAT: zapis kaze na zasebni naslov).
      let naslovi: string[];
      try {
        naslovi = await razresi(domena);
      } catch {
        throw new Error("Domena nima zapisa A/AAAA. Nastavite DNS, da kaže na javni naslov vašega priključka.");
      }
      if (naslovi.length === 0 || naslovi.some(jeNejavenNaslov)) {
        throw new Error("Zapis DNS vsebuje zasebni ali CGNAT naslov, ki z interneta ni dosegljiv (mešan zapis ni dovoljen). Pri ponudniku zahtevajte javni naslov ali uporabite hitri tunel.");
      }
      const mapa = mapaNeposredno(root);
      mkdirSync(mapa, { recursive: true, mode: 0o700 });
      if (process.platform !== "win32") chmodSync(mapa, 0o700);
      const podatki = join(mapa, "podatki");
      mkdirSync(podatki, { recursive: true, mode: 0o700 });
      const konfig = join(mapa, "Caddyfile");
      writeFileSync(konfig, caddyfile(domena, vrata, join(podatki, "caddy")), { mode: 0o600 });
      const okolje: NodeJS.ProcessEnv = {};
      for (const k of ["PATH", "Path", "HOME", "USERPROFILE", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "LANG", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "SSL_CERT_FILE"]) {
        if (process.env[k] !== undefined) okolje[k] = process.env[k];
      }
      okolje.XDG_DATA_HOME = join(podatki, "xdg-podatki");
      okolje.XDG_CONFIG_HOME = join(podatki, "xdg-nastavitve");
      const otrok = spawn(program.pot, ["run", "--config", konfig, "--adapter", "caddyfile"], { env: okolje, stdio: ["ignore", "ignore", "ignore"], windowsHide: true });
      let konec = false;
      const poKoncu: Array<() => void> = [];
      otrok.once("exit", () => {
        konec = true;
        for (const cb of poKoncu.splice(0)) cb();
      });
      const ustavi = (): void => {
        if (otrok.exitCode !== null || otrok.signalCode !== null || !otrok.pid) return;
        if (process.platform === "win32") execFile("taskkill", ["/pid", String(otrok.pid), "/T", "/F"], { windowsHide: true }, () => undefined);
        else {
          try {
            process.kill(otrok.pid, "SIGTERM");
          } catch {
            /* ze koncan */
          }
          const sila = setTimeout(() => {
            if (otrok.exitCode === null && otrok.signalCode === null && otrok.pid) {
              try {
                process.kill(otrok.pid, "SIGKILL");
              } catch {
                /* ze koncan */
              }
            }
          }, 3000);
          sila.unref?.();
        }
      };
      // PID takoj (pregled P3): ACME okno traja do 60 s, v tem casu proces ze obstaja.
      if (otrok.pid) naZagon?.(otrok.pid, ustavi);
      try {
        const rokKonec = Date.now() + rok;
        let potrjeno = false;
        while (Date.now() < rokKonec) {
          if (konec) throw new Error(`Caddy se je ustavil, preden je dobil potrdilo. Preverite, ali sta vrati ${VRATA_HTTP} in ${VRATA_HTTPS} prosti.`);
          if (await potrdilo(domena)) {
            potrjeno = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
        if (!potrjeno) throw new Error("Javnega potrdila (Let's Encrypt) ni bilo mogoče dobiti. Zunanja vrata 80 in 443 morajo biti preusmerjena na ta računalnik (80 -> " + VRATA_HTTP + ", 443 -> " + VRATA_HTTPS + ").");
      } catch (napaka) {
        ustavi();
        throw napaka;
      }
      return {
        naslov: `https://${domena}`,
        pid: otrok.pid ?? null,
        ustavi,
        poKoncu: (cb) => (konec ? cb() : void poKoncu.push(cb)),
      };
    },
  };
}
