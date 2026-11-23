/**
 * Kanal Lina -> Claude Code: nastavitve (zeton, javni kljuci naprav ozjega kroga) in MCP streznik, ki ga zazene Claude Code.
 * Protokol in varovala: kanal-claude.ts. Zagon: scripts/kanal-claude.mts (stdio; nic drugega ne sme pisati na stdout).
 *
 * Zeton je v mapi podatkov Line SIFRIRAN z glavnim kljucem Line (keys.server.ts) in odpre samo vticnico. Dostop (naloga,
 * odobritev) da samo PODPIS naprave ozjega kroga z njenim kljucem Linka; javni kljuci so v kanal-claude.json (niso skrivnost).
 * Seznam se prebere ob vsakem sporocilu in vsakih nekaj sekund: umik naprave takoj ustavi njene naloge (pravilo Linka).
 * V seznam ne dodaj kljuca TEGA racunalnika: njegov zasebni kljuc je na istem disku kot Lina (glej AGENTS.md).
 */
import { createHash, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import net from "node:net";
import path from "node:path";
import { dovoljenaNaloga, type Naloga } from "./asistent.server.ts";
import {
  ID_ODOBRITVE,
  IME_KANALA,
  IME_ORODJA,
  IZZIV,
  KONFIG_KANALA,
  MAPA_KANALA,
  NAJVEC_NEPRIJAVLJENIH,
  NAJVEC_ODGOVOR_ZNAKOV,
  NAJVEC_ODPRTIH,
  NAJVEC_IZDANIH,
  IZDANI_ZIVLJENJE_MS,
  IME_CEVI,
  ODTIS_KANALA,
  ROK_NALOGE_KANAL_MS,
  SPOROCILO_ODOBRITEV_Z_GUMBOM,
  SPOROCILO_USTAVITEV_BREZ_PODPISA,
  NAJVEC_POGOVOROV,
  NAVODILO_KANALA,
  OKNO_PODPISA_MS,
  ROK_ODOBRITVE_MS,
  ROK_PRIJAVE_MS,
  SPOROCILO_ODOBRITEV_TERMINAL,
  SPOROCILO_ODOBRITEV_SAMO_TERMINAL,
  Vrstice,
  dokazPrijave,
  enakoKonstantno,
  idPripadaKljucu,
  nizNaloge,
  nizOdobritve,
  nizUstavitve,
  programIzUkaza,
  praviUnicode,
  zgostitevPrikaza,
  oblikaDokaza,
  ocistiZaSejo,
  ocistiZaTelefon,
  potVticnice,
  NAJVEC_PREDOGLED,
  predogledSkrajsan,
  NAJVEC_OBVESTIL_TERMINAL,
  predolgaPot,
  preveriPodpisNaprave,
  razberiOdobritev,
  razcleniVrstico,
  veljavenKljucNaprave,
  veljavenZetonKanala,
  type IzKanala,
} from "./kanal-claude.ts";
import { odsifrirajSkrivnost, sifrirajSkrivnost } from "./keys.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

// ------------------------------------------------------------------ nastavitve

type Sifra = { iv: string; tag: string; ciphertext: string };
/** dovoljene: id naprave -> javni kljuc (base64 SPKI DER), kot clani v krog.json Safeer Linka. */
type Konfig = { zeton?: Sifra; dovoljene?: Record<string, string>; imeCevi?: string };
export type NapravaKroga = { id: string; kljuc: string };

function cistSeznam(v: unknown): Map<string, string> {
  const izid = new Map<string, string>();
  const vnosi = Array.isArray(v)
    ? v.map((x) => [(x as NapravaKroga)?.id, (x as NapravaKroga)?.kljuc] as const)
    : v && typeof v === "object" ? Object.entries(v as Record<string, unknown>) : [];
  for (const [id, kljuc] of vnosi) {
    // id mora biti izpeljan iz kljuca: tuj kljuc ne more prevzeti id-ja druge naprave
    if (typeof id === "string" && veljavenKljucNaprave(kljuc) && idPripadaKljucu(id, kljuc)) izid.set(id, kljuc);
  }
  return izid;
}

/**
 * Mapa podatkov Line mora biti navadna mapa tega uporabnika brez pisanja za skupino in druge; ce je ni, jo ustvarimo 0700
 * (sicer bi jo glavni kljuc ustvaril 0755). Pregled 14. 11. 2026, N8.
 */
export async function preveriKoren(root: string): Promise<void> {
  if (process.platform === "win32") return;
  await mkdir(root, { recursive: true, mode: 0o700 });
  const st = await lstat(root);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("Mapa podatkov Line ni navadna mapa.");
  if (typeof process.getuid === "function" && st.uid !== process.getuid()) throw new Error("Mapa podatkov Line ni od tega uporabnika.");
  if (st.mode & 0o022) throw new Error("V mapo podatkov Line lahko pisejo drugi uporabniki.");
}

/**
 * Pripravi kanal: ustvari zeton (32 nakljucnih bajtov), ce ga se ni, in zapise javne kljuce naprav ozjega kroga, ki jih je
 * preveril Safeer Link (klicatelj jih dobi iz Linka, nikoli iz dohodnega sporocila). Zetona ne vrne.
 */
export async function pripraviKanal(dovoljene: readonly NapravaKroga[], dir?: string): Promise<{ pot: string }> {
  const root = resolveDataDir(dir);
  await preveriKoren(root);
  const star = (await readJsonFile<Konfig>(root, KONFIG_KANALA)) ?? {};
  const zeton = star.zeton ?? (await sifrirajSkrivnost(randomBytes(32).toString("base64url"), root));
  const imeCevi = typeof star.imeCevi === "string" && IME_CEVI.test(star.imeCevi) ? star.imeCevi : randomBytes(16).toString("base64url");
  const seznam = cistSeznam(dovoljene);
  await writeJson(root, KONFIG_KANALA, { zeton, dovoljene: Object.fromEntries(seznam), imeCevi } satisfies Konfig);
  // spremembo seznama prek Line zapisemo tudi v odtis; sprememba mimo Line ostane vidna ob zagonu kanala
  const znan = (await readJsonFile<Odtis>(root, ODTIS_KANALA).catch(() => null)) ?? {};
  if (typeof znan.program === "string") await writeJson(root, ODTIS_KANALA, { program: znan.program, seznam: odtisSeznama(seznam) } satisfies Odtis);
  return { pot: potVticnice(root, process.platform, imeCevi) };
}

// ------------------------------------------------------------------ odtis programa in seznama (zaznava sprememb)

/** Koren programa Line, iz katerega tece ta kanal (src/lib/lina -> koren). */
export const KOREN_PROGRAMA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const VSTOP_KANALA = path.join("scripts", "kanal-claude.mts");

/**
 * SHA-256 programa kanala: vstop scripts/kanal-claude.mts in vse datoteke, ki jih ta z relativnimi uvozi doseze (ne node_modules).
 * Ni zascita pred odlocnim napadalcem istega uporabnika (ta lahko zapise tudi nov odtis), zazna pa nenamerno ali delno spremembo.
 */
export async function odtisPrograma(koren = KOREN_PROGRAMA): Promise<string> {
  const videno = new Map<string, string>();
  const vrsta = [path.join(koren, VSTOP_KANALA)];
  while (vrsta.length) {
    const f = vrsta.pop()!;
    if (videno.has(f)) continue;
    const vsebina = await readFile(f);
    videno.set(f, createHash("sha256").update(vsebina).digest("hex"));
    for (const m of vsebina.toString("utf8").matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      vrsta.push(path.resolve(path.dirname(f), m[1]));
    }
  }
  const h = createHash("sha256");
  for (const f of [...videno.keys()].sort()) h.update(`${path.relative(koren, f)}\n${videno.get(f)}\n`);
  return h.digest("hex");
}

/** SHA-256 seznama naprav (id -> kljuc), neodvisno od vrstnega reda. */
export function odtisSeznama(dovoljene: Map<string, string>): string {
  const h = createHash("sha256");
  for (const [id, kljuc] of [...dovoljene].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) h.update(`${id}\n${kljuc}\n`);
  return h.digest("hex");
}

type Odtis = { program?: string; seznam?: string };

/** Lastnik potrdi trenutno stanje (nova razlicica programa): zapise oba odtisa. */
export async function potrdiOdtisKanala(dir?: string, koren = KOREN_PROGRAMA): Promise<void> {
  const root = resolveDataDir(dir);
  const { dovoljene } = await preberiKanal(root);
  await writeJson(root, ODTIS_KANALA, { program: await odtisPrograma(koren), seznam: odtisSeznama(dovoljene) } satisfies Odtis);
}

/**
 * Ob zagonu kanala: primerja program in seznam z zadnjima znanima odtisoma. Prvi zagon odtisa zapise (brez opozorila);
 * razlika vrne opozorila za lastnika (Lina jih poslje na telefon), kanal pa tece naprej - odlocitev je lastnikova.
 */
export async function preveriOdtisKanala(dir?: string, koren = KOREN_PROGRAMA): Promise<string[]> {
  const root = resolveDataDir(dir);
  const zdaj: Odtis = { program: await odtisPrograma(koren), seznam: odtisSeznama((await preberiKanal(root)).dovoljene) };
  const znan = await readJsonFile<Odtis>(root, ODTIS_KANALA).catch(() => null);
  if (!znan || typeof znan.program !== "string" || typeof znan.seznam !== "string") {
    await writeJson(root, ODTIS_KANALA, zdaj);
    return [];
  }
  const opozorila: string[] = [];
  if (znan.program !== zdaj.program) opozorila.push("Program kanala se je spremenil od zadnjega potrjenega stanja. Ce tega niste storili vi, ne odobravajte nalog.");
  if (znan.seznam !== zdaj.seznam) opozorila.push("Seznam naprav kanala se je spremenil mimo Line. Ce tega niste storili vi, ne odobravajte nalog.");
  return opozorila;
}

/** Nov zeton (npr. ce je bil razkrit); stara prijava ob naslednji povezavi ne velja vec. */
export async function zamenjajZetonKanala(dir?: string): Promise<void> {
  const root = resolveDataDir(dir);
  await preveriKoren(root);
  const star = (await readJsonFile<Konfig>(root, KONFIG_KANALA)) ?? {};
  const zeton = await sifrirajSkrivnost(randomBytes(32).toString("base64url"), root);
  await writeJson(root, KONFIG_KANALA, { zeton, dovoljene: Object.fromEntries(cistSeznam(star.dovoljene)), imeCevi: star.imeCevi } satisfies Konfig);
}

export async function preberiKanal(dir?: string): Promise<{ zeton: string | null; dovoljene: Map<string, string>; imeCevi: string }> {
  const root = resolveDataDir(dir);
  const k = (await readJsonFile<Konfig>(root, KONFIG_KANALA).catch(() => null)) ?? {};
  const zeton = k.zeton ? await odsifrirajSkrivnost(k.zeton, root) : null;
  return { zeton, dovoljene: cistSeznam(k.dovoljene), imeCevi: typeof k.imeCevi === "string" ? k.imeCevi : "" };
}

/** Vnos za .mcp.json (ali ~/.claude.json) z absolutnimi potmi; Claude Code ga zazene kot podproces. */
export function nastavitevMcp(root: string, korenLine: string, node = process.execPath) {
  return {
    mcpServers: {
      [IME_KANALA]: {
        command: node,
        args: ["--experimental-strip-types", "--no-warnings", path.join(korenLine, "scripts", "kanal-claude.mts")],
        env: { LINA_DATA: path.resolve(root) },
      },
    },
  };
}

// ------------------------------------------------------------------ streznik kanala

type Odprta = { cas: number; orodje: string; opis: string; predogled: string; chatId: string; naprava: string; zgostitev: string; izvirniPredogled?: unknown };
type Pogovor = { naprava: string; koncan: boolean; zacel: number };

/** Najvec nalog in odobritev na minuto: zloraba ne sme zasuti seje ali poskusati odobritev (N7). */
export const NAJVEC_NALOG_NA_MINUTO = 30;
export const NAJVEC_ODOBRITEV_NA_MINUTO = 30;
/** Kako pogosto kanal sam preveri, ali je bila katera naprava umaknjena iz kroga. */
export const PREVERBA_UMIKOV_MS = 3000;

export type MoznostiKanala = {
  root: string;
  /** Zapis na stdout (MCP do Claude Code). */
  izhod: (vrstica: string) => void;
  okolje?: Record<string, string | undefined>;
  zdaj?: () => number;
  dnevnik?: (s: string) => void;
  /** Rok naloge v kanalu (privzeto ROK_NALOGE_KANAL_MS); po izteku kanal nalogo v seji ustavi sam. */
  rokNalogeMs?: number;
  /** Klice se, ko kanal zazna podtaknjeno vticnico ali mapo in se ustavi (zagon: konec procesa). */
  naUstavitev?: (razlog: string) => void;
  korenPrograma?: string;
};

export class KanalStreznik {
  private readonly root: string;
  private readonly izhod: (v: string) => void;
  private readonly zdaj: () => number;
  private readonly dnevnik: (s: string) => void;
  readonly apiKljuc: boolean;
  private streznik: net.Server | null = null;
  private pot = "";
  private odjemalec: net.Socket | null = null;
  private neprijavljene = new Set<net.Socket>();
  private stdio = new Vrstice();
  private mcpVeriga: Promise<void> = Promise.resolve();
  private seja = false;
  private obvestilaTerminal = new Map<string, number>();
  private odprte = new Map<string, Odprta>();
  /** Programi (cli-anything-<ime>), ki jih je lastnik z ENO podpisano odobritvijo dovolil do konca te seje kanala. */
  private odobreniProgrami = new Set<string>();
  /** ID-ji zahtev, ki jih je kanal ze izdal (odprte, odgovorjene, potekle ali izrinjene): isti ID se ne odpre znova (R2-2). */
  private izdane = new Map<string, number>();
  private pogovori = new Map<string, Pogovor>();
  private videni = new Map<string, number>();
  private naloge: number[] = [];
  private odobritve: number[] = [];
  private umiki: ReturnType<typeof setInterval> | null = null;
  /** Dokaz s casom pred zagonom procesa se zavrne: enkratni nizi so samo v pomnilniku (ponovni pregled N-C). */
  private readonly zagnan: number;
  private readonly rokNalogeMs: number;
  private readonly naUstavitev: (razlog: string) => void;
  /** Zeton, s katerim se je prijavila trenutna Lina; zamenjava zetona prijavo prekine (N-E). */
  private zetonOdjemalca = "";
  private istovetnost: { vticnica: string; mapa: string } | null = null;
  /** Opozorila ob zagonu (spremenjen program ali seznam); gredo Lini ob vsaki prijavi. */
  opozorila: string[] = [];
  private readonly korenPrograma: string;

  constructor(m: MoznostiKanala) {
    this.root = path.resolve(m.root);
    this.izhod = m.izhod;
    this.zdaj = m.zdaj ?? Date.now;
    this.dnevnik = m.dnevnik ?? ((s) => process.stderr.write(`[lina-kanal] ${s}\n`));
    // Claude Code z ANTHROPIC_API_KEY bremeni API namesto narocnine (naloga, razdelek 3) - povemo Lini, vrednosti nikoli.
    this.apiKljuc = Boolean(m.okolje?.ANTHROPIC_API_KEY?.trim());
    this.zagnan = this.zdaj();
    this.rokNalogeMs = m.rokNalogeMs ?? ROK_NALOGE_KANAL_MS;
    this.naUstavitev = m.naUstavitev ?? (() => {});
    this.korenPrograma = m.korenPrograma ?? KOREN_PROGRAMA;
  }

  get potVticnice(): string {
    return this.pot;
  }

  /** Preveri mapo podatkov, pripravi mapo kanala 0700 in vticnico 0600. Brez veljavnega zetona se kanal NE zazene. */
  async zazeni(): Promise<void> {
    await preveriKoren(this.root);
    const { zeton, imeCevi } = await preberiKanal(this.root);
    if (!veljavenZetonKanala(zeton)) {
      throw new Error("Kanal nima veljavnega zetona: Lina mora kanal najprej pripraviti (pripraviKanal).");
    }
    this.opozorila = await preveriOdtisKanala(this.root, this.korenPrograma);
    for (const o of this.opozorila) this.dnevnik(`OPOZORILO: ${o}`);
    const pot = potVticnice(this.root, process.platform, imeCevi);
    if (predolgaPot(pot)) throw new Error("Pot do mape podatkov Line je predolga za vticnico.");
    if (process.platform !== "win32") {
      const mapa = path.join(this.root, MAPA_KANALA);
      await mkdir(mapa, { recursive: true, mode: 0o700 });
      const st = await lstat(mapa);
      // simbolna povezava ali tuja mapa bi vticnico postavila tja, kamor seze kdo drug
      if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("Mapa kanala ni navadna mapa.");
      if (typeof process.getuid === "function" && st.uid !== process.getuid()) throw new Error("Mapa kanala ni od tega uporabnika.");
      await chmod(mapa, 0o700);
      await this.pocistiStaroVticnico(pot);
    }
    const s = net.createServer((sock) => this.novaPovezava(sock));
    await new Promise<void>((ok, ne) => {
      s.once("error", ne);
      s.listen(pot, () => {
        s.off("error", ne);
        ok();
      });
    });
    if (process.platform !== "win32") await chmod(pot, 0o600);
    this.streznik = s;
    this.pot = pot;
    this.istovetnost = await this.istovetnostPoti();
    this.umiki = setInterval(() => { this.obcasno().catch(() => undefined); }, PREVERBA_UMIKOV_MS);
    this.umiki.unref();
  }

  private async pocistiStaroVticnico(pot: string): Promise<void> {
    let st;
    try {
      st = await lstat(pot);
    } catch {
      return;
    }
    if (!st.isSocket()) throw new Error("Na mestu vticnice kanala je druga datoteka.");
    const zivi = await new Promise<boolean>((ok) => {
      const c = net.connect(pot);
      const t = setTimeout(() => { c.destroy(); ok(false); }, 300);
      c.once("connect", () => { clearTimeout(t); c.destroy(); ok(true); });
      c.once("error", () => { clearTimeout(t); ok(false); });
    });
    if (zivi) throw new Error("Kanal Line ze tece v drugi seji Claude Code.");
    await unlink(pot);
  }

  /** dev:ino vticnice in mape kanala; zamenjana ali preimenovana mapa pomeni, da ta pot ni vec nasa (N-E). */
  private async istovetnostPoti(): Promise<{ vticnica: string; mapa: string } | null> {
    if (process.platform === "win32") return null;
    const v = await lstat(this.pot);
    const m = await lstat(path.dirname(this.pot));
    if (!v.isSocket() || m.isSymbolicLink()) throw new Error("Vticnica kanala ni nasa.");
    return { vticnica: `${v.dev}:${v.ino}`, mapa: `${m.dev}:${m.ino}` };
  }

  /** Vsakih nekaj sekund: umiki naprav, zamenjan zeton, rok nalog, podtaknjena vticnica. */
  private async obcasno(): Promise<void> {
    if (!this.streznik) return;
    if (this.istovetnost) {
      let zdaj: { vticnica: string; mapa: string } | null = null;
      try {
        zdaj = await this.istovetnostPoti();
      } catch {
        zdaj = null;
      }
      if (!zdaj || zdaj.vticnica !== this.istovetnost.vticnica || zdaj.mapa !== this.istovetnost.mapa) {
        const razlog = "Vticnica ali mapa kanala je bila zamenjana - kanal se ustavi.";
        this.dnevnik(razlog);
        this.ustavi(false);
        this.naUstavitev(razlog);
        return;
      }
    }
    const k = await this.preveriUmike();
    if (this.odjemalec && !enakoKonstantno(k.zeton ?? "", this.zetonOdjemalca)) {
      this.dnevnik("zeton kanala je zamenjan - prijava prekinjena");
      this.odjemalec.destroy();
      this.odjemalec = null;
    }
    const t = this.zdaj();
    for (const [id, p] of this.pogovori) if (!p.koncan && this.seja && t - p.zacel > this.rokNalogeMs) this.ustaviPogovor(id, p);
  }

  /** `pocistiPot=false`, ko pot ni vec nasa: tuje datoteke na njenem mestu ne brisemo. */
  ustavi(pocistiPot = true): void {
    if (this.umiki) clearInterval(this.umiki);
    this.umiki = null;
    this.odjemalec?.destroy();
    this.odjemalec = null;
    for (const s of this.neprijavljene) s.destroy();
    this.neprijavljene.clear();
    const s = this.streznik;
    this.streznik = null;
    if (s) {
      s.close();
      if (pocistiPot && this.pot && process.platform !== "win32") unlink(this.pot).catch(() => undefined);
    }
  }

  // ---------------------------------------------------------------- vticnica (Lina)

  private poslji(sock: net.Socket | null, s: IzKanala): void {
    if (sock && !sock.destroyed) sock.write(JSON.stringify(s) + "\n");
  }

  private aktivneIds(): string[] {
    return [...this.pogovori].filter(([, p]) => !p.koncan).map(([id]) => id);
  }

  private novaPovezava(sock: net.Socket): void {
    // neprijavljene povezave imajo mejo; nova izrine najstarejso, zato zasedenje ne zaklene Line (N3)
    this.neprijavljene.add(sock);
    if (this.neprijavljene.size > NAJVEC_NEPRIJAVLJENIH) {
      const najstarejsa = this.neprijavljene.values().next().value as net.Socket;
      this.neprijavljene.delete(najstarejsa);
      najstarejsa.destroy();
    }
    const vrstice = new Vrstice();
    let stanje: "pozdrav" | "prijava" | "prijavljen" = "pozdrav";
    let c = "";
    let s = "";
    let veriga: Promise<void> = Promise.resolve();
    const casovnik = setTimeout(() => sock.destroy(), ROK_PRIJAVE_MS);
    sock.setEncoding("utf8");
    sock.on("error", () => sock.destroy());
    sock.on("close", () => {
      clearTimeout(casovnik);
      this.neprijavljene.delete(sock);
      if (this.odjemalec === sock) this.odjemalec = null;
    });
    const zavrni = () => {
      this.dnevnik("povezava brez veljavne prijave zavrnjena");
      this.poslji(sock, { vrsta: "napaka", razlog: "zavrnjeno" });
      sock.destroy();
    };
    sock.on("data", (kos: string) => {
      vrstice.dodaj(kos, (v) => {
        // vrstice obdelamo po vrsti, tudi ce je preverba asinhrona (branje nastavitev)
        veriga = veriga.then(async () => {
          if (sock.destroyed) return;
          const sp = razcleniVrstico(v);
          if (stanje === "pozdrav") {
            const { zeton } = await preberiKanal(this.root);
            if (!sp || sp.vrsta !== "pozdrav" || typeof sp.c !== "string" || !IZZIV.test(sp.c) || !veljavenZetonKanala(zeton)) return zavrni();
            c = sp.c;
            s = randomBytes(24).toString("base64url");
            // streznik prvi dokaze, da pozna zeton; Lina brez tega ne poslje svojega dokaza
            this.poslji(sock, { vrsta: "izziv", s, dokaz: dokazPrijave(zeton, "streznik", c, s) });
            stanje = "prijava";
            return;
          }
          if (stanje === "prijava") {
            const { zeton } = await preberiKanal(this.root);
            if (!sp || sp.vrsta !== "prijava" || !veljavenZetonKanala(zeton)
              || !enakoKonstantno(sp.dokaz, dokazPrijave(zeton, "odjemalec", c, s))) return zavrni();
            // dokler je prijavljena Lina ziva, druga prijava ne izrine nje (N-E); Lina po ponovnem zagonu zapre staro povezavo
            if (this.odjemalec && !this.odjemalec.destroyed && this.odjemalec !== sock) return zavrni();
            stanje = "prijavljen";
            clearTimeout(casovnik);
            this.neprijavljene.delete(sock);
            this.odjemalec = sock;
            this.zetonOdjemalca = zeton;
            await this.preveriUmike();
            this.poslji(sock, { vrsta: "pozdravljen", seja: this.seja, apiKljuc: this.apiKljuc, aktivne: this.aktivneIds(), opozorila: this.opozorila });
            this.pocistiOdprte();
            for (const [zahtevaId, o] of this.odprte) {
              this.poslji(sock, { vrsta: "odobritev", zahtevaId, chatId: o.chatId, orodje: o.orodje, opis: o.opis, predogled: o.predogled, zgostitev: o.zgostitev });
            }
            return;
          }
          if (sp) await this.odLine(sock, sp);
        }).catch(() => { sock.destroy(); });
      }, () => { sock.destroy(); });
    });
  }

  /** Podpis naprave iz seznama, v casovnem oknu, z enkratnim nizom, ki se ni bil uporabljen. */
  private preveriDokaz(posiljatelj: string, dokaz: unknown, niz: (cas: number, enkratni: string) => string, dovoljene: Map<string, string>): boolean {
    const kljuc = dovoljene.get(posiljatelj);
    if (!kljuc || !oblikaDokaza(dokaz)) return false;
    const t = this.zdaj();
    if (Math.abs(t - dokaz.cas) > OKNO_PODPISA_MS) return false;
    // podpis s casom pred zagonom tega procesa bi bil po ponovnem zagonu spet nov (videni so v pomnilniku) - N-C
    if (dokaz.cas < this.zagnan) return false;
    // enkratni niz se pozabi sele, ko njegov podpis zaradi okna ne more vec veljati (po casu podpisa, ne po prejemu)
    for (const [e, cas] of this.videni) if (t - cas > OKNO_PODPISA_MS) this.videni.delete(e);
    if (this.videni.has(dokaz.enkratni)) return false;
    if (!preveriPodpisNaprave(kljuc, niz(dokaz.cas, dokaz.enkratni), dokaz.podpis)) return false;
    this.videni.set(dokaz.enkratni, dokaz.cas);
    return true;
  }

  private async odLine(sock: net.Socket, s: Record<string, unknown>): Promise<void> {
    const { dovoljene } = await this.preveriUmike();
    const zavrni = (id: unknown, razlog?: string) =>
      this.poslji(sock, { vrsta: "zavrnjeno", id: typeof id === "string" ? id.slice(0, 64) : "", ...(razlog ? { razlog } : {}) });

    if (s.vrsta === "naloga") {
      const n = (s.naloga ?? null) as Partial<Naloga> | null;
      // dovoljenaNaloga: izvor »asistent«, veljaven ID, besedilo, posiljatelj na seznamu ozjega kroga - sicer NIC v sejo
      if (!dovoljenaNaloga(n, new Set(dovoljene.keys())) || !this.seja || !praviUnicode(n.besedilo)) return zavrni(n?.id);
      // podpis naprave: zeton sam (ki ga lahko prebere program istega uporabnika) ne da naloge (N1)
      if (!this.preveriDokaz(n.posiljatelj, n.dokaz, (cas, e) => nizNaloge(n.id, n.posiljatelj, n.besedilo, cas, e), dovoljene)) return zavrni(n.id);
      if (!this.vMeji(this.naloge, NAJVEC_NALOG_NA_MINUTO)) return zavrni(n.id);
      // besedilna odobritev ne podpise prikazane vsebine (N-D): ne uporabi se, ne gre v sejo, Lina dobi razlog (C3)
      if (razberiOdobritev(n.besedilo)) return zavrni(n.id, SPOROCILO_ODOBRITEV_Z_GUMBOM);
      if (this.pogovori.has(n.id)) return zavrni(n.id);
      this.zapomniPogovor(n.id, n.posiljatelj);
      this.obvesti("notifications/claude/channel", {
        content: ocistiZaSejo(n.besedilo),
        meta: { chat_id: n.id, naprava: n.posiljatelj },
      });
      return;
    }
    if (s.vrsta === "odobritev") {
      const { posiljatelj, zahtevaId, dovoli } = s;
      // podpis velja za to zahtevo, to nalogo in to prikazano vsebino (N-D)
      // meja steje vsak poskus (tudi neodprt ID), da ugibanje ID-jev ni neomejeno (N7)
      const o = typeof zahtevaId === "string" ? this.odprte.get(zahtevaId) : undefined;
      if (typeof posiljatelj !== "string" || typeof zahtevaId !== "string" || typeof dovoli !== "boolean"
        || !this.vMeji(this.odobritve, NAJVEC_ODOBRITEV_NA_MINUTO) || !o
        || !this.preveriDokaz(posiljatelj, s.dokaz, (cas, e) => nizOdobritve(zahtevaId, dovoli, posiljatelj, cas, e, o.chatId, o.zgostitev), dovoljene)
        || !this.uporabiOdobritev(zahtevaId, dovoli, posiljatelj)) return zavrni(zahtevaId);
      return;
    }
    if (s.vrsta === "ustavi") {
      // ustavitev podpise naprava, ki je nalogo dala (N-E); rok in umik ustavi kanal sam
      const id = s.id;
      const p = typeof id === "string" ? this.pogovori.get(id) : undefined;
      if (!p || p.koncan || !this.seja) return zavrni(id);
      if (s.posiljatelj !== p.naprava
        || !this.preveriDokaz(p.naprava, s.dokaz, (cas, e) => nizUstavitve(id as string, p.naprava, cas, e), dovoljene)) {
        // naloga tece naprej; Lina to pove lastniku (ne konca je kot zavrnjeno)
        this.poslji(sock, { vrsta: "odgovor", chatId: id as string, besedilo: SPOROCILO_USTAVITEV_BREZ_PODPISA, koncano: false });
        return;
      }
      this.ustaviPogovor(id as string, p);
    }
  }

  private ustaviPogovor(id: string, p: Pogovor): void {
    p.koncan = true;
    for (const [z, o] of this.odprte) if (o.chatId === id) this.odprte.delete(z);
    this.obvesti("notifications/claude/channel", {
      content: "Naloga je ustavljena.",
      meta: { chat_id: id, naprava: p.naprava, ustavi: "da" },
    });
  }

  /** Prebere seznam naprav; naloge in odobritve umaknjenih naprav takoj ustavi in odstrani (N2). */
  private async preveriUmike(): Promise<{ dovoljene: Map<string, string>; zeton: string | null }> {
    const k = await preberiKanal(this.root);
    for (const [id, p] of [...this.pogovori]) {
      if (k.dovoljene.has(p.naprava)) continue;
      if (!p.koncan && this.seja) this.ustaviPogovor(id, p);
      this.pogovori.delete(id);
      this.poslji(this.odjemalec, { vrsta: "umaknjeno", id });
    }
    for (const [z, o] of this.odprte) if (!k.dovoljene.has(o.naprava)) this.odprte.delete(z);
    return k;
  }

  private vMeji(seznam: number[], najvec: number): boolean {
    const t = this.zdaj();
    while (seznam.length && t - seznam[0] >= 60_000) seznam.shift();
    if (seznam.length >= najvec) return false;
    seznam.push(t);
    return true;
  }

  private zapomniPogovor(id: string, naprava: string): void {
    this.pogovori.set(id, { naprava, koncan: false, zacel: this.zdaj() });
    while (this.pogovori.size > NAJVEC_POGOVOROV) this.pogovori.delete(this.pogovori.keys().next().value as string);
  }

  private pocistiOdprte(): void {
    const t = this.zdaj();
    for (const [id, o] of this.odprte) if (t - o.cas > ROK_ODOBRITVE_MS) this.odprte.delete(id);
  }

  /** Odlocitev velja samo za odprt ID, ki ga je izdal Claude Code, samo od naprave, ki je dala nalogo, in samo enkrat (N7). */
  private uporabiOdobritev(zahtevaId: string, dovoli: boolean, naprava: string): boolean {
    this.pocistiOdprte();
    const o = ID_ODOBRITVE.test(zahtevaId) ? this.odprte.get(zahtevaId) : undefined;
    if (!o || o.naprava !== naprava) return false;
    this.odprte.delete(zahtevaId);
    if (dovoli) {
      const p = programIzUkaza(o.orodje, o.izvirniPredogled);
      if (p) this.odobreniProgrami.add(p);
    }
    this.obvesti("notifications/claude/channel/permission", { request_id: zahtevaId, behavior: dovoli ? "allow" : "deny" });
    return true;
  }

  // ---------------------------------------------------------------- stdio (Claude Code)

  private obvesti(method: string, params: unknown): void {
    this.izhod(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  private odgovori(id: unknown, result: unknown): void {
    this.izhod(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  }

  private napaka(id: unknown, code: number, message: string): void {
    this.izhod(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
  }

  /** Vhod s stdin. Predolga vrstica dobi napako JSON-RPC (ce ima ID), proces tece naprej (N5). */
  prejmiStdio(kos: string): void {
    this.stdio.dodaj(kos, (v) => {
      // po vrsti: odgovor in naslednja zahteva ne smeta zamenjati mesta (nekatere obdelave berejo nastavitve)
      this.mcpVeriga = this.mcpVeriga.then(() => this.mcp(razcleniVrstico(v)))
        .catch((e) => this.dnevnik(`napaka obdelave: ${(e as Error).message}`));
    }, (zacetek) => {
      const m = /"id"\s*:\s*(\d{1,15}|"[^"\\]{1,64}")/.exec(zacetek);
      if (m) this.napaka(JSON.parse(m[1]), -32600, "Sporocilo je predolgo.");
    });
  }

  private async mcp(z: Record<string, unknown> | null): Promise<void> {
    if (!z || z.jsonrpc !== "2.0" || typeof z.method !== "string") return;
    const imaId = typeof z.id === "number" || typeof z.id === "string";
    const params = (z.params && typeof z.params === "object" ? z.params : {}) as Record<string, unknown>;
    switch (z.method) {
      case "initialize": {
        const zelena = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
        const znane = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
        this.odgovori(z.id, {
          protocolVersion: znane.includes(zelena) ? zelena : znane[1],
          capabilities: {
            // dovoljenje za odobritve samo, ker kanal preverja podpis naprave ozjega kroga - channels-reference
            experimental: { "claude/channel": {}, "claude/channel/permission": {} },
            tools: {},
          },
          serverInfo: { name: IME_KANALA, version: "1.1.0" },
          instructions: NAVODILO_KANALA,
        });
        return;
      }
      case "notifications/initialized":
        this.seja = true;
        this.poslji(this.odjemalec, { vrsta: "pozdravljen", seja: true, apiKljuc: this.apiKljuc, aktivne: this.aktivneIds(), opozorila: this.opozorila });
        return;
      case "ping":
        if (imaId) this.odgovori(z.id, {});
        return;
      case "tools/list":
        this.odgovori(z.id, {
          tools: [{
            name: "reply",
            description: "Poslji odgovor ali izid naloge nazaj v Lino (na napravo ozjega kroga, ki je nalogo dala).",
            inputSchema: {
              type: "object",
              properties: {
                chat_id: { type: "string", description: "chat_id iz oznake <channel>" },
                text: { type: "string", description: `Kratko besedilo v slovenscini (najvec ${NAJVEC_ODGOVOR_ZNAKOV} znakov)` },
                koncano: { type: "boolean", description: "true, ko je naloga koncana (privzeto); false za vmesno stanje" },
              },
              required: ["chat_id", "text"],
            },
          }],
        });
        return;
      case "tools/call": {
        const a = (params.arguments ?? {}) as Record<string, unknown>;
        const izid = (besedilo: string, napaka = false) =>
          this.odgovori(z.id, { content: [{ type: "text", text: besedilo }], isError: napaka });
        if (params.name !== "reply") return izid("Neznano orodje.", true);
        const { dovoljene } = await this.preveriUmike();
        const p = typeof a.chat_id === "string" ? this.pogovori.get(a.chat_id) : undefined;
        if (!p) return izid("Neznan chat_id: odgovor gre samo na nalogo iz Line.", true);
        if (!dovoljene.has(p.naprava)) return izid("Naprava te naloge ni vec v ozjem krogu.", true);
        if (typeof a.text !== "string" || !a.text.trim()) return izid("Prazno besedilo.", true);
        if (a.text.length > NAJVEC_ODGOVOR_ZNAKOV) return izid(`Besedilo je predolgo (najvec ${NAJVEC_ODGOVOR_ZNAKOV} znakov).`, true);
        if (!this.odjemalec) return izid("Lina ni povezana; odgovor ni dostavljen.", true);
        const koncano = a.koncano !== false;
        // P1 (r3): ko je naloga koncana, se njene odprte odobritve zaprejo (pozen podpis ne sme dati allow za ukaz, ki je
        // potem prisel z druge naloge ali iz terminala).
        if (koncano) {
          p.koncan = true;
          for (const [z, o] of this.odprte) if (o.chatId === a.chat_id) this.odprte.delete(z);
        }
        this.poslji(this.odjemalec, { vrsta: "odgovor", chatId: a.chat_id as string, besedilo: ocistiZaTelefon(a.text, NAJVEC_ODGOVOR_ZNAKOV), koncano });
        return izid("poslano");
      }
      case "notifications/claude/channel/permission_request": {
        const id = params.request_id;
        if (typeof id !== "string" || !ID_ODOBRITVE.test(id)) return;
        const { dovoljene } = await this.preveriUmike();
        // odobritev gre samo napravi nekoncanih nalog, ki je se v krogu; brez nje odobri samo terminal (N2, N7). Claude Code
        // zahteve ne veze na nalogo: ce tecejo naloge z vec naprav, ne vemo, cigava je - odobri samo terminal (CodeRabbit C5)
        // SR-4: ID se porabi tudi, ko zahteva ostane v terminalu (brez aktivne naloge ali z vec napravami): ponovitev z drugo
        // vsebino se pozneje ne sme odpreti na telefonu.
        const porabi = () => { if (!this.izdane.has(id) && this.izdane.size < NAJVEC_IZDANIH) this.izdane.set(id, Date.now()); };
        const aktivne = [...this.pogovori].filter(([, p]) => !p.koncan && dovoljene.has(p.naprava));
        // P2 (r3): brez aktivne naloge odprte zahteve nimajo vec lastnika - vse se zaprejo.
        if (!aktivne.length) { porabi(); this.odprte.clear(); return; }
        if (new Set(aktivne.map(([, p]) => p.naprava)).size > 1) {
          porabi();
          this.odprte.clear(); // P2 (r3): z vec napravami ni vec znano, cigava je odprta zahteva
          for (const [chatId] of aktivne) this.poslji(this.odjemalec, { vrsta: "odgovor", chatId, besedilo: SPOROCILO_ODOBRITEV_TERMINAL, koncano: false });
          return;
        }
        const zadnja = aktivne[aktivne.length - 1];
        // SR-5: sporocilo »samo v terminalu« najvec NAJVEC_OBVESTIL_TERMINAL krat na nalogo, da ponavljanje ne preplavi telefona.
        const vTerminal = () => {
          const n = this.obvestilaTerminal.get(zadnja[0]) ?? 0;
          if (n >= NAJVEC_OBVESTIL_TERMINAL) return;
          this.obvestilaTerminal.set(zadnja[0], n + 1);
          this.poslji(this.odjemalec, { vrsta: "odgovor", chatId: zadnja[0], besedilo: SPOROCILO_ODOBRITEV_SAMO_TERMINAL, koncano: false });
        };
        // R2-5a: orodje mora biti veljavno ime (brez preloma, Cc/Cf); »neznano orodje« lastnik ne bi smel odobriti na slepo.
        if (typeof params.tool_name !== "string" || !IME_ORODJA.test(params.tool_name)) {
          this.dnevnik("zahteva za odobritev ni poslana na napravo (neveljavno orodje)");
          porabi();
          vTerminal();
          return;
        }
        const orodje = params.tool_name;
        // SR-2: besedilo se ocisti PRED porabo ID; neveljaven opis ali predogled (npr. objekt brez toString) ne sme
        // porabiti ID in pustiti lastnika brez obvestila.
        let opis: string;
        let predogled: string;
        let predogledSkrajsanje: boolean;
        try {
          opis = ocistiZaTelefon(params.description);
          const pr = programIzUkaza(typeof params.tool_name === "string" ? params.tool_name : "", params.input_preview);
          if (pr && !this.odobreniProgrami.has(pr)) opis = ocistiZaTelefon(`${opis} [Odobritev velja za program ${pr} do konca seje.]`);
          predogled = ocistiZaTelefon(params.input_preview);
          predogledSkrajsanje = predogledSkrajsan(params.input_preview);
        } catch {
          this.dnevnik("zahteva za odobritev ni poslana na napravo (neveljaven opis ali predogled)");
          vTerminal();
          return;
        }
        // R2-2 + SR-3: ID je enkraten. Ista vsebina pod odprtim ID se prezre brez novega sporocila (SR-5); DRUGA vsebina pod
        // odprtim ID pomeni spor: prvotna zahteva se zapre (nikoli ne dobi »allow«), odobritev je samo v terminalu.
        const odprta = this.odprte.get(id);
        if (odprta) {
          if (odprta.zgostitev === zgostitevPrikaza(orodje, predogled, opis)) return;
          this.dnevnik("zahteva za odobritev: isti ID z drugo vsebino, odprta zahteva je zaprta");
          this.odprte.delete(id);
          vTerminal();
          return;
        }
        if (this.izdane.has(id)) {
          this.dnevnik("zahteva za odobritev ni poslana na napravo (porabljen ID)");
          vTerminal();
          return;
        }
        if (this.izdane.size >= NAJVEC_IZDANIH) {
          const meja = Date.now() - IZDANI_ZIVLJENJE_MS;
          for (const [i, t] of this.izdane) if (t < meja) this.izdane.delete(i);
        }
        if (this.izdane.size >= NAJVEC_IZDANIH) {
          // Poln seznam: nov ID ne sme izriniti starega (ponovitev bi se odprla znova), zato nova zahteva ostane v terminalu.
          this.dnevnik("zahteva za odobritev ni poslana na napravo (seznam porabljenih ID je poln)");
          vTerminal();
          return;
        }
        // SR-1: podpis velja za prikazano besedilo; Claude Code pa izvede CEL vnos. Odrezanega predogleda lastnik ne sme
        // odobriti na slepo (rep ukaza bi ostal skrit), zato se taka odobritev opravi samo v terminalu.
        if (predogledSkrajsanje) {
          this.dnevnik("zahteva za odobritev ni poslana na napravo (predogled je predolg za varno odobritev)");
          this.izdane.set(id, Date.now());
          vTerminal();
          return;
        }
        // Ena odobritev na program: program je ze dovolil lastnik s podpisom, ukaz je en sam preprost klic -> allow brez novega vprasanja.
        const program = programIzUkaza(orodje, params.input_preview);
        if (program && this.odobreniProgrami.has(program)) {
          this.izdane.set(id, Date.now());
          this.dnevnik(`program ${program}: ze odobren v tej seji, ukaz dovoljen brez novega vprasanja`);
          this.obvesti("notifications/claude/channel/permission", { request_id: id, behavior: "allow" });
          return;
        }
        this.pocistiOdprte();
        // SR-9 (Lina): polna vrsta odprtih zahtev ne izrine starejse - nova ostane v terminalu.
        if (this.odprte.size >= NAJVEC_ODPRTIH) {
          this.dnevnik("zahteva za odobritev ni poslana na napravo (preveliko odprtih zahtev)");
          vTerminal();
          return;
        }
        this.izdane.set(id, Date.now());
        const o: Odprta = {
          cas: this.zdaj(), orodje, opis, predogled, chatId: zadnja[0], naprava: zadnja[1].naprava,
          zgostitev: zgostitevPrikaza(orodje, predogled, opis), izvirniPredogled: params.input_preview,
        };
        this.odprte.set(id, o);
        this.poslji(this.odjemalec, { vrsta: "odobritev", zahtevaId: id, chatId: o.chatId, orodje, opis, predogled, zgostitev: o.zgostitev });
        return;
      }
      default:
        if (imaId && !z.method.startsWith("notifications/")) this.napaka(z.id, -32601, "Metoda ni podprta.");
    }
  }
}

/** Zagon iz scripts/kanal-claude.mts: stdout je samo MCP, vse drugo na stderr. */
export async function zazeniKanal(): Promise<void> {
  const piši = process.stdout.write.bind(process.stdout);
  // nic iz uvozenih modulov ne sme pokvariti MCP toka na stdout
  console.log = console.info = console.debug = (...a: unknown[]) => process.stderr.write(a.map(String).join(" ") + "\n");
  const rok = Number(process.env.LINA_KANAL_ROK_MS);
  const k = new KanalStreznik({
    root: resolveDataDir(), izhod: (v) => { piši(v); }, okolje: process.env,
    rokNalogeMs: Number.isSafeInteger(rok) && rok > 0 ? rok : undefined,
    naUstavitev: () => process.exit(3),
  });
  try {
    await k.zazeni();
  } catch (e) {
    process.stderr.write(`[lina-kanal] ${(e as Error).message}\n`);
    process.exit(2);
  }
  if (k.apiKljuc) process.stderr.write("[lina-kanal] ANTHROPIC_API_KEY je nastavljen: Claude Code bremeni API, ne narocnine.\n");
  const konec = () => {
    k.ustavi();
    process.exit(0);
  };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (kos: string) => k.prejmiStdio(kos));
  process.stdin.on("end", konec);
  process.on("SIGTERM", konec);
  process.on("SIGINT", konec);
}
