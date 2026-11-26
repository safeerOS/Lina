/**
 * Zagon, nadzor in ustavitev streznika OpenLine kot otroka racunalniske Line.
 * Proces se zazene prek zaganjalnika openline-start.mjs s strogo omejenim okoljem
 * (brez dedovanja process.env in brez shell: true). Stanje procesa in tekoca obljuba
 * sta shranjena v globalThis pod Symbol.for("lina.openline.zagon"), tako da si ga
 * delita oba sveznja kode (vticnik in obdelava zahtev).
 */
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  novKljucApi,
  PRIVZETA_VRATA_OPENLINE,
  sestaviOkoljeOpenLine,
  ZbiralnikIzpisa,
  type DovoljeniKlici,
} from "./openline-zagon-cista.ts";
import { zapisiOpenLineNotranje } from "./openline-povabilo.server.ts";
import { zasebenNaslov } from "./zasebno-omrezje.server.ts";

const KLJUC_STANJA = Symbol.for("lina.openline.zagon");
const VZOREC_IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const PRIVZETI_ROK_PRIPRAVLJENOSTI_MS = 15000;
const PRIVZETI_ROK_USTAVITVE_MS = 3000;
const STEVILO_POSKUSOV_VRAT = 8;

/** Kar potrebuje zagon od Line (Lina pripravi glas telefona in vrne podatke za otroka). Vrstni red dela vodja; v preizkusih lazni. */
export type PripravaLine = { naslov: string; vrata: number; odtis: string; zeton: string };

export type Odvisnosti = {
  zazeni: (ukaz: string, args: string[], opcije: SpawnOptions) => ChildProcess;
  izvrsljivo: () => string;
  korenOpenLine: () => string | null;
  /** Pot zaganjalnika za koren paketa OpenLine (brez korena: razvojna pot). */
  zaganjalnik: (koren?: string) => string;
  pripraviLino: (root: string) => Promise<PripravaLine>;
  dataDir: (root: string) => string;
  prostaVrata: (naslov: string) => Promise<number>;
  dovoljeni: (root: string) => Promise<DovoljeniKlici>;
  rokPripravljenostiMs: number;
  rokUstavitveMs: number;
  dnevnik: (dogodek: string) => void;
};

export type StanjeOpenLine = { tece: boolean; vrata: number; naslov: string; odtis: string };

type TekociProces = {
  otrok: ChildProcess;
  naslov: string;
  vrata: number;
  odtis: string;
  rokUstavitveMs: number;
  dnevnik: (dogodek: string) => void;
};

type GlobalnoStanje = {
  tekoci: TekociProces | null;
  vTeku: { naslov: string; obljuba: Promise<StanjeOpenLine> } | null;
  ustavljanje: Promise<void> | null;
  generacija: number;
};

function dobiStanje(): GlobalnoStanje {
  const g = globalThis as { [KLJUC_STANJA]?: GlobalnoStanje };
  g[KLJUC_STANJA] ??= {
    tekoci: null,
    vTeku: null,
    ustavljanje: null,
    generacija: 0,
  };
  return g[KLJUC_STANJA];
}

function jeZasebenIpv4(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = VZOREC_IPV4.exec(v);
  if (!m) return false;
  for (let i = 1; i <= 4; i += 1) {
    const del = m[i];
    if (del.length > 1 && del.startsWith("0")) return false;
    if (Number(del) > 255) return false;
  }
  return zasebenNaslov(v);
}

/** Ime zaganjalnika: v paketu je v korenu OpenLine (extraResources lupine -> lina/openline/), v razvoju ob tej datoteki. */
export const IME_ZAGANJALNIKA = "openline-start.mjs";

/**
 * Naloga 16: zaganjalnik iz korena OpenLine (LINA_OPENLINE_DIR), ne iz import.meta.url. Po gradnji je ta koda v svezenju
 * (.output/server/_ssr/router-*.mjs), kjer zaganjalnika ni; otrok se je takoj koncal (»OpenLine se ni pripravil pravocasno«).
 */
export function zaganjalnikZaKoren(koren?: string): string {
  if (koren) {
    const vPaketu = path.join(koren, IME_ZAGANJALNIKA);
    if (fs.existsSync(vPaketu)) return vPaketu;
  }
  return privzetiZaganjalnik();
}

function privzetiZaganjalnik(): string {
  const url = new URL("./openline-start.mjs", import.meta.url);
  let pot = decodeURIComponent(url.pathname);
  if (process.platform === "win32" && /^\/[A-Za-z]:\//.test(pot)) {
    pot = pot.slice(1);
  }
  return path.resolve(pot);
}

function preveriVrata(naslov: string, vrata: number): Promise<boolean> {
  return new Promise((resolve) => {
    const streznik = net.createServer();
    let koncano = false;
    const zakljuci = (prosta: boolean) => {
      if (koncano) return;
      koncano = true;
      resolve(prosta);
    };
    streznik.unref();
    streznik.once("error", () => {
      zakljuci(false);
    });
    streznik.once("listening", () => {
      streznik.close(() => zakljuci(true));
    });
    try {
      streznik.listen({ host: naslov, port: vrata, exclusive: true });
    } catch {
      zakljuci(false);
    }
  });
}

async function najdiProstaVrata(naslov: string): Promise<number> {
  for (let zamik = 0; zamik < STEVILO_POSKUSOV_VRAT; zamik += 1) {
    const vrata = PRIVZETA_VRATA_OPENLINE + zamik;
    if (await preveriVrata(naslov, vrata)) return vrata;
  }
  throw new Error("vrata");
}

function varnoZabelezi(dnevnik: (dogodek: string) => void, dogodek: string): void {
  try {
    dnevnik(dogodek);
  } catch {
    // dnevnik ne sme prekiniti zagona ali ustavitve
  }
}

function jeOtrokZiv(otrok: ChildProcess): boolean {
  return otrok.exitCode === null && otrok.signalCode === null && !otrok.killed;
}

function pocakajIzhod(otrok: ChildProcess, rokMs: number): Promise<boolean> {
  if (otrok.exitCode !== null || otrok.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let koncano = false;
    const zakljuci = (izsel: boolean) => {
      if (koncano) return;
      koncano = true;
      clearTimeout(casovnik);
      otrok.removeListener("exit", obIzhodu);
      otrok.removeListener("close", obIzhodu);
      otrok.removeListener("error", obIzhodu);
      resolve(izsel);
    };
    const obIzhodu = () => zakljuci(true);
    const casovnik = setTimeout(() => zakljuci(false), Math.max(1, rokMs));
    casovnik.unref?.();
    otrok.once("exit", obIzhodu);
    otrok.once("close", obIzhodu);
    otrok.once("error", obIzhodu);
  });
}

async function ustaviOtroka(otrok: ChildProcess, rokMs: number): Promise<void> {
  const cas = Number.isFinite(rokMs) && rokMs > 0 ? rokMs : PRIVZETI_ROK_USTAVITVE_MS;
  if (otrok.exitCode !== null || otrok.signalCode !== null) return;

  // 1. Zapri stdin: zaganjalnik se ob EOF na stdin konca sam.
  const cakanjeStdin = pocakajIzhod(otrok, cas);
  try {
    otrok.stdin?.end();
  } catch {
    // cev je morda ze zaprta
  }
  if (await cakanjeStdin) return;

  // 2. Poslji SIGTERM in pocakaj se rokMs.
  const cakanjeTerm = pocakajIzhod(otrok, cas);
  try {
    otrok.kill("SIGTERM");
  } catch {
    // proces morda ze ne obstaja
  }
  if (await cakanjeTerm) return;

  // 3. Zadnja moznost: SIGKILL.
  const cakanjeKill = pocakajIzhod(otrok, Math.min(cas, 1000));
  try {
    otrok.kill("SIGKILL");
  } catch {
    // proces morda ze ne obstaja
  }
  await cakanjeKill;
}

/** Okno zivosti po zapisu nastavitev (ms): otrok, ki v tem casu umre, ni javljen kot pripravljen. */
const OKNO_ZIVOSTI_MS = 150;

/** Naloga 33: vzrok iz stderr otroka - samo znani vzorci postanejo kratka koda, besedilo stderr se nikoli ne shrani (lahko ima skrivnost). */
export function vzrokIzStderr(kos: string): string | null {
  if (/EADDRINUSE/.test(kos)) return "vrata zasedena";
  if (/EACCES|EPERM/.test(kos)) return "dovoljenje";
  if (/ERR_MODULE_NOT_FOUND|Cannot find (module|package)/.test(kos)) return "manjka modul";
  return null;
}

/**
 * Naloga 33: vzrok, zakaj se otrok ni pripravil (lastnik na testnem PC je videl samo »se ni pripravil pravocasno«): izhodna koda
 * zaganjalnika (2 = brez poti, 3 = uvoz OpenLine ni uspel), znan vzorec v stderr, rok ali napaka zagona. Vedno kratka koda.
 */
export function vzrokIzhoda(koda: number | null, signal: NodeJS.Signals | null, stderr: string | null): string {
  if (stderr) return stderr;
  if (koda === 2) return "zaganjalnik";
  if (koda === 3) return "uvoz";
  return signal ? "ustavljen" : "izhod";
}

function pocakajPripravljenost(
  otrok: ChildProcess,
  zbiralnik: ZbiralnikIzpisa,
  rokMs: number,
  vzrokStderr: () => string | null = () => null,
): Promise<void> {
  if (!otrok.stdout || otrok.exitCode !== null || otrok.signalCode !== null) {
    return Promise.reject(new Error(otrok.exitCode !== null || otrok.signalCode !== null ? vzrokIzhoda(otrok.exitCode, otrok.signalCode, vzrokStderr()) : "OpenLine se ni pripravil"));
  }
  const stdout = otrok.stdout;
  return new Promise((resolve, reject) => {
    let koncano = false;
    const pocisti = () => {
      clearTimeout(casovnik);
      stdout.removeListener("data", obPodatkih);
      otrok.removeListener("exit", obIzhodu);
      otrok.removeListener("error", obNapaki);
    };
    const uspeh = () => {
      if (koncano) return;
      koncano = true;
      pocisti();
      resolve();
    };
    const neuspeh = (vzrok: string) => {
      if (koncano) return;
      koncano = true;
      pocisti();
      reject(new Error(vzrok));
    };
    const obPodatkih = (kos: Buffer | string) => {
      zbiralnik.dodaj(kos);
      if (zbiralnik.pripravljen()) {
        uspeh();
      }
    };
    // stderr pride lahko za dogodkom exit: kratko okno, da se vzorec (npr. EADDRINUSE) se prebere
    const obIzhodu = (koda: number | null, signal: NodeJS.Signals | null) => {
      setTimeout(() => neuspeh(vzrokIzhoda(koda, signal, vzrokStderr())), 50); // brez unref: sicer se zanka dogodkov konca pred zavrnitvijo
    };
    const obNapaki = () => neuspeh("zagon");

    const rok = Number.isFinite(rokMs) && rokMs > 0 ? rokMs : PRIVZETI_ROK_PRIPRAVLJENOSTI_MS;
    const casovnik = setTimeout(() => neuspeh("rok"), rok);
    casovnik.unref?.();

    stdout.on("data", obPodatkih);
    otrok.once("exit", obIzhodu);
    otrok.once("error", obNapaki);
  });
}

/** Privzete odvisnosti zagona OpenLine z morebitnimi prepisi iz `delne`. */
export function privzeteOdvisnosti(delne?: Partial<Odvisnosti>): Odvisnosti {
  return {
    zazeni: delne?.zazeni ?? ((ukaz, args, opcije) => spawn(ukaz, args, opcije)),
    izvrsljivo: delne?.izvrsljivo ?? (() => process.execPath),
    korenOpenLine: delne?.korenOpenLine ?? (() => null),
    zaganjalnik: delne?.zaganjalnik ?? zaganjalnikZaKoren,
    pripraviLino:
      delne?.pripraviLino ??
      (async () => {
        throw new Error("odvisnost");
      }),
    dataDir: delne?.dataDir ?? ((root) => path.join(root, "openline")),
    prostaVrata: delne?.prostaVrata ?? najdiProstaVrata,
    dovoljeni: delne?.dovoljeni ?? (async () => ({ nacin: "vse", stevilke: [] })),
    rokPripravljenostiMs: delne?.rokPripravljenostiMs ?? PRIVZETI_ROK_PRIPRAVLJENOSTI_MS,
    rokUstavitveMs: delne?.rokUstavitveMs ?? PRIVZETI_ROK_USTAVITVE_MS,
    dnevnik: delne?.dnevnik ?? (() => undefined),
  };
}

/**
 * Zagotovi, da OpenLine tece za dani zasebni naslov racunalnika, in da so njegove nastavitve zapisane v Lini (zapisiOpenLineNotranje).
 * Idempotentno: ce ze tece za ISTI naslov in je pripravljen, vrne obstojece stanje brez novega procesa. Hkratni klici si delijo ENO obljubo
 * (en proces). Ce tece za DRUG naslov, ga ustavi in zazene znova. Napaka -> Error s sporocilom brez skrivnosti.
 */
export async function zagotoviOpenLine(
  root: string,
  naslov: string,
  odv?: Partial<Odvisnosti>,
): Promise<StanjeOpenLine> {
  // 1. Naslov mora biti zasebni IPv4.
  if (!jeZasebenIpv4(naslov)) {
    throw new Error("naslov");
  }

  const o = privzeteOdvisnosti(odv);

  // 2. Paket OpenLine in vstopna datoteka dist/index.js morata obstajati.
  const surovKoren = o.korenOpenLine();
  if (typeof surovKoren !== "string" || surovKoren.length === 0) {
    throw new Error("OpenLine ni v paketu");
  }
  const koren = path.resolve(surovKoren);
  const vstopna = path.join(koren, "dist", "index.js");
  if (!fs.existsSync(vstopna)) {
    throw new Error("OpenLine ni v paketu");
  }
  // naloga 16: brez zaganjalnika se otrok takoj konca; jasna napaka namesto cakanja na rok pripravljenosti
  const zaganjalnik = o.zaganjalnik(koren);
  if (!fs.existsSync(zaganjalnik)) {
    throw new Error("OpenLine ni v paketu");
  }

  const s = dobiStanje();

  for (;;) {
    // Ce se ravno izvaja ustavitev, pocakaj na njen konec.
    if (s.ustavljanje) {
      await s.ustavljanje.catch(() => undefined);
      continue;
    }

    // Hkratni klici si delijo ENO obljubo za isti naslov; za drug naslov pocakajo, da se prejsnji zagon zakljuci.
    if (s.vTeku) {
      if (s.vTeku.naslov === naslov) {
        return s.vTeku.obljuba;
      }
      await s.vTeku.obljuba.catch(() => undefined);
      continue;
    }

    // Idempotenca (PRED korakom 3): ce proces ze tece za ISTI naslov, vrni obstojece stanje brez pripraviLino/prostaVrata/zazeni.
    if (s.tekoci && jeOtrokZiv(s.tekoci.otrok) && s.tekoci.naslov === naslov) {
      return {
        tece: true,
        vrata: s.tekoci.vrata,
        naslov: s.tekoci.naslov,
        odtis: s.tekoci.odtis,
      };
    }

    const mojaGeneracija = ++s.generacija;
    let obljubaKoncana = false;
    let obljuba!: Promise<StanjeOpenLine>;

    obljuba = (async (): Promise<StanjeOpenLine> => {
      let otrok: ChildProcess | null = null;
      try {
        // Ce tece proces za drug naslov (ali mrtev zapis), ga najprej cisto ustavi.
        if (s.tekoci) {
          const stari = s.tekoci;
          s.tekoci = null;
          if (jeOtrokZiv(stari.otrok)) {
            varnoZabelezi(stari.dnevnik, "openline:zamenjava");
            await ustaviOtroka(stari.otrok, stari.rokUstavitveMs);
          }
        }

        if (s.generacija !== mojaGeneracija) {
          throw new Error("OpenLine se ni pripravil");
        }

        // 3. Priprava Line (glas telefona).
        const p = await o.pripraviLino(root);

        if (s.generacija !== mojaGeneracija) {
          throw new Error("OpenLine se ni pripravil");
        }

        // 4. Prosta vrata in nov kljuc API (vsak zagon nov).
        const vrata = await o.prostaVrata(naslov);
        const kljuc = novKljucApi();

        // 5. Strogo omejeno okolje otroka (brez dedovanja process.env).
        const dovoljeni = await o.dovoljeni(root);
        const okolje = sestaviOkoljeOpenLine({
          kljucApi: kljuc,
          naslov,
          vrata,
          dataDir: o.dataDir(root),
          linaNaslov: p.naslov,
          linaVrata: p.vrata,
          linaZeton: p.zeton,
          linaOdtis: p.odtis,
          dovoljeni,
        });

        if (s.generacija !== mojaGeneracija) {
          throw new Error("OpenLine se ni pripravil");
        }

        // 6. Zagon otroka prek zaganjalnika (shell: false, samo sestavljeno okolje).
        varnoZabelezi(o.dnevnik, "openline:zagon");
        try {
          otrok = o.zazeni(o.izvrsljivo(), [zaganjalnik, vstopna], {
            env: okolje,
            cwd: koren,
            stdio: ["pipe", "pipe", "pipe"],
            shell: false,
            windowsHide: true,
          });
        } catch {
          throw new Error("OpenLine se ni pripravil");
        }

        let otrokKoncan = otrok.exitCode !== null || otrok.signalCode !== null;
        const oznaciKonec = () => {
          otrokKoncan = true;
        };
        otrok.once("exit", oznaciKonec);
        otrok.once("error", oznaciKonec);
        otrok.stdin?.on("error", () => undefined);
        otrok.stdout?.on("error", () => undefined);
        otrok.stderr?.on("error", () => undefined);

        // 7. Stdout v ZbiralnikIzpisa, stderr se samo prazni brez shranjevanja.
        // naloga 33: stderr se ne shrani; prvih 8 KB se samo pregleda za znan vzorec (kratka koda vzroka)
        let vzrokStderr: string | null = null;
        let pregledano = 0;
        if (otrok.stderr) {
          otrok.stderr.on("data", (kos: Buffer | string) => {
            if (vzrokStderr || pregledano > 8192) return;
            const del = String(kos).slice(0, 8192);
            pregledano += del.length;
            vzrokStderr = vzrokIzStderr(del);
          });
        }
        const zbiralnik = new ZbiralnikIzpisa();
        try {
          await pocakajPripravljenost(otrok, zbiralnik, o.rokPripravljenostiMs, () => vzrokStderr);
        } catch (e) {
          varnoZabelezi(o.dnevnik, `openline:ni-pripravljen:${e instanceof Error ? e.message : "?"}`);
          throw e;
        }

        // Po pripravljenosti nadaljnji stdout praznimo, da se cev ne zapolni.
        if (otrok.stdout) {
          otrok.stdout.on("data", () => undefined);
        }

        if (s.generacija !== mojaGeneracija) throw new Error("OpenLine se ni pripravil");
        if (otrokKoncan) throw new Error("izhod"); // naloga 33: otrok je umrl, ne prekinitev

        // 8. Preverbe razclenjenega izpisa (vrata in gostitelj se morata ujemati).
        const najdenNaslov = zbiralnik.naslov();
        const najdenOdtis = zbiralnik.odtis();
        if (!najdenNaslov || !najdenOdtis) {
          throw new Error("izpis");
        }
        let gostitelj = "";
        try {
          gostitelj = new URL(najdenNaslov.url).hostname;
        } catch {
          gostitelj = "";
        }
        if (najdenNaslov.vrata !== vrata || gostitelj !== naslov) {
          throw new Error("izpis");
        }

        // 9. Zapis nastavitev OpenLine v Lino (ob napaki ustavi otroka in vrzi naprej).
        await zapisiOpenLineNotranje(root, {
          vrata,
          odtis: najdenOdtis,
          kljuc,
          naslov,
        });

        // Dogodek 'exit' pride sele v naslednjih krogih zanke dogodkov: otrok, ki umre med zapisom, je lahko se »ziv«
        // (CI 24. 11. 2026: zapis je trajal manj kot izhod). Kratko okno zivosti, preden ga razglasimo za pripravljenega.
        const zivOtrok = otrok;
        const umrlVOknu = await new Promise<boolean>((koncaj) => {
          if (otrokKoncan || !jeOtrokZiv(zivOtrok)) return koncaj(true);
          const obIzhoduOkna = () => {
            clearTimeout(okno);
            koncaj(true);
          };
          const okno = setTimeout(() => {
            zivOtrok.removeListener("exit", obIzhoduOkna);
            koncaj(false);
          }, OKNO_ZIVOSTI_MS);
          zivOtrok.once("exit", obIzhoduOkna);
        });
        if (s.generacija !== mojaGeneracija) throw new Error("OpenLine se ni pripravil");
        if (otrokKoncan || umrlVOknu || !jeOtrokZiv(otrok)) throw new Error("izhod");

        // 10. Zapomni stanje; ob poznejsem izhodu tece postane false (brez ponovnega zagona).
        const zapis: TekociProces = {
          otrok,
          naslov,
          vrata,
          odtis: najdenOdtis,
          rokUstavitveMs: o.rokUstavitveMs,
          dnevnik: o.dnevnik,
        };
        s.tekoci = zapis;
        const pocistiObIzhodu = () => {
          if (s.tekoci === zapis) {
            s.tekoci = null;
            varnoZabelezi(o.dnevnik, "openline:izhod");
          }
        };
        otrok.once("exit", pocistiObIzhodu);
        otrok.once("close", pocistiObIzhodu);

        varnoZabelezi(o.dnevnik, "openline:pripravljen");
        otrok = null;
        return { tece: true, vrata, naslov, odtis: najdenOdtis };
      } catch (e) {
        if (otrok) {
          await ustaviOtroka(otrok, o.rokUstavitveMs).catch(() => undefined);
        }
        throw e;
      } finally {
        obljubaKoncana = true;
        if (s.vTeku?.obljuba === obljuba) {
          s.vTeku = null;
        }
      }
    })();

    if (!obljubaKoncana) {
      s.vTeku = { naslov, obljuba };
    }
    return obljuba;
  }
}

/** Trenutno stanje procesa OpenLine (tece false, ce ni procesa ali je padel). */
export function stanjeOpenLineProcesa(): StanjeOpenLine {
  const t = dobiStanje().tekoci;
  if (!t || !jeOtrokZiv(t.otrok)) {
    return { tece: false, vrata: 0, naslov: "", odtis: "" };
  }
  return {
    tece: true,
    vrata: t.vrata,
    naslov: t.naslov,
    odtis: t.odtis,
  };
}

/** Ustavi proces OpenLine (idempotentno; nikoli ne vrze). */
export async function ustaviOpenLine(rokMs?: number): Promise<void> {
  try {
    const s = dobiStanje();
    s.generacija += 1;

    if (s.vTeku) {
      await s.vTeku.obljuba.catch(() => undefined);
    }

    const tekoci = s.tekoci;
    s.tekoci = null;
    if (tekoci) {
      const rok = rokMs ?? tekoci.rokUstavitveMs;
      varnoZabelezi(tekoci.dnevnik, "openline:ustavitev");
      const delo = ustaviOtroka(tekoci.otrok, rok).catch(() => undefined);
      s.ustavljanje = delo;
      try {
        await delo;
      } finally {
        if (s.ustavljanje === delo) s.ustavljanje = null;
      }
      return;
    }

    if (s.ustavljanje) {
      await s.ustavljanje.catch(() => undefined);
    }
  } catch {
    try {
      dobiStanje().tekoci = null;
    } catch {
      // ustaviOpenLine nikoli ne vrze
    }
  }
}
