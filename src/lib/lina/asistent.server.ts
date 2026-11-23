/**
 * Asistentka Line: skupni vmesnik izvajalcev in naprave Safeer Linka (lastnik 13. 11. 2026: »Zdruzimo najboljse iz Safeer
 * agenta in OpenHands v Lino, da bo res moj osebni asistent in tajnica«; naloga NALOGA-lina-kanal-claude-code.md, razdelek 9).
 *
 * - Vrata: nalogo sme dati SAMO naprava ozjega kroga Safeer Linka (ID preveri Link, ne sporocilo). Pot tajnice (klic
 *   neznanca) nima nobene poti sem - zahteva z izvorom »tajnica« se zavrne vedno, tudi z veljavnim ID.
 * - Izvajalci (Claude Code prek kanala, OpenHands z Geminijem) imajo isti vmesnik; telefon ne ve, kdo dela.
 * - Naprave: MCP streznik safeer-naprave (core/agent/mcp_naprave.py iz Safeer Agenta) prek stdio; Lina ga uporabi za hitro
 *   pot (»ustavi film na TV«) brez agenta za kodo.
 */
import { spawn as nodeSpawn } from "node:child_process";
import net from "node:net";
import { randomBytes } from "node:crypto";
import {
  ID_ODOBRITVE,
  IME_ORODJA,
  IZZIV,
  Vrstice,
  dokazPrijave,
  enakoKonstantno,
  ocistiZaTelefon,
  razcleniVrstico,
  zgostitevPrikaza,
  type Dokaz,
  type ZaKanal,
} from "./kanal-claude.ts";

export type Izvor = "asistent" | "tajnica";

/**
 * `dokaz` je podpis naprave ozjega kroga (kljuc Safeer Linka, kanal-claude.ts nizNaloge); Lina ga samo posreduje, ponarediti ga
 * ne more. Izvajalec Claude Code brez veljavnega dokaza naloge ne sprejme.
 */
export type Naloga = { id: string; besedilo: string; posiljatelj: string; izvor: Izvor; dokaz?: Dokaz };

export type Dogodek =
  | { vrsta: "stanje"; besedilo: string }
  /** orodje in predogled (argumenti) sta od Claude Code; opis je besedilo MODELA - na telefonu loceno in kot nezaupljivo. */
  | { vrsta: "odobritev"; zahtevaId: string; orodje: string; opis: string; predogled: string; zgostitev?: string }
  | { vrsta: "izid"; ok: boolean; besedilo: string };

export interface Izvajalec {
  readonly ime: string;
  razpolozljiv(): Promise<boolean>;
  zacni(naloga: Naloga, naDogodek: (d: Dogodek) => void): Promise<void>;
  /**
   * `posiljatelj` je naprava, ki je odobrila, `dokaz` njen podpis (kanal-claude.ts nizOdobritve). Odobritev s tuje naprave ali
   * brez podpisa nima ucinka.
   */
  odobri(nalogaId: string, zahtevaId: string, dovoli: boolean, posiljatelj: string, dokaz?: Dokaz): Promise<void>;
  /** `dokaz` je podpis naprave, ki je nalogo dala (kanal-claude.ts nizUstavitve); rok in umik ustavi kanal sam. */
  ustavi(nalogaId: string, dokaz?: Dokaz): Promise<void>;
}

/** Najdaljse navodilo, ki ga sprejmemo (glas ali besedilo); daljse je napaka ali zloraba. */
export const NAJVEC_ZNAKOV = 4000;

/**
 * Ali sme naloga naprej. `ozjiKrog` so ID-ji naprav, ki jih je Safeer Link preveril kot clane ozjega kroga s polnim
 * zaupanjem (core/link_dostop.py); nic iz sporocila samega ne podeli dostopa.
 */
export function dovoljenaNaloga(n: Partial<Naloga> | null | undefined, ozjiKrog: ReadonlySet<string>): n is Naloga {
  if (!n || n.izvor !== "asistent") return false;
  if (typeof n.id !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(n.id)) return false;
  if (typeof n.besedilo !== "string" || !n.besedilo.trim() || n.besedilo.length > NAJVEC_ZNAKOV) return false;
  if (typeof n.posiljatelj !== "string" || !ozjiKrog.has(n.posiljatelj)) return false;
  return true;
}

/** Prvi razpolozljiv izvajalec po vrstnem redu (Claude Code, nato OpenHands kot rezerva). */
export async function izberiIzvajalca(izvajalci: readonly Izvajalec[]): Promise<Izvajalec | null> {
  for (const i of izvajalci) {
    try {
      if (await i.razpolozljiv()) return i;
    } catch {
      // nedosegljiv izvajalec ni napaka asistentke - poskusi naslednjega
    }
  }
  return null;
}

// ------------------------------------------------------------------ MCP odjemalec za safeer-naprave (stdio)

type Proces = {
  stdin: { write(s: string): unknown; end(): unknown };
  stdout: { on(d: "data", f: (b: Buffer | string) => void): unknown };
  on(d: "exit", f: () => void): unknown;
  kill(): unknown;
};
export type Zagon = () => Proces;

/** Rok za en klic orodja: dejanje na napravi (Link) traja najvec nekaj sekund. */
export const ROK_ORODJA_MS = 20_000;
/** Odgovor, daljsi od tega, je napaka (nasi odgovori so kratki stavki). */
export const NAJVEC_ODGOVOR = 256 * 1024;

export const zagonSafeerNaprave = (koren = "/usr/lib/safeer-control"): Zagon => () =>
  nodeSpawn("python3", ["-I", "-c", "import sys; sys.path.insert(0, sys.argv[1]); from core.agent import mcp_naprave; mcp_naprave.main()", koren], {
    stdio: ["pipe", "pipe", "ignore"],
    env: {
      PATH: "/usr/bin:/bin", LANG: "C.UTF-8", HOME: process.env.HOME ?? "",
      // gdbus do Safeer Control potrebuje sejno vodilo uporabnika
      DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS ?? "", XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? "",
    },
  }) as unknown as Proces;

export class McpNaprave {
  private proces: Proces | null = null;
  private naslednji = 1;
  private medpomnilnik = "";
  private caka = new Map<number, { ok: (v: unknown) => void; ne: (e: Error) => void; casovnik: ReturnType<typeof setTimeout> }>();

  private readonly zagon: Zagon;
  private readonly rokMs: number;

  constructor(zagon: Zagon, rokMs = ROK_ORODJA_MS) {
    this.zagon = zagon;
    this.rokMs = rokMs;
  }

  private zazeni(): Proces {
    if (this.proces) return this.proces;
    const p = this.zagon();
    p.stdout.on("data", (b) => this.prejmi(String(b)));
    p.on("exit", () => this.zavrziVse("Streznik naprav se je ustavil."));
    this.proces = p;
    return p;
  }

  private prejmi(kos: string): void {
    this.medpomnilnik += kos;
    if (this.medpomnilnik.length > NAJVEC_ODGOVOR) {
      this.ustavi();
      return;
    }
    let i: number;
    while ((i = this.medpomnilnik.indexOf("\n")) >= 0) {
      const vrstica = this.medpomnilnik.slice(0, i);
      this.medpomnilnik = this.medpomnilnik.slice(i + 1);
      let sporocilo: { id?: unknown; result?: unknown; error?: { message?: unknown } };
      try {
        sporocilo = JSON.parse(vrstica);
      } catch {
        continue;
      }
      if (typeof sporocilo.id !== "number") continue;
      const c = this.caka.get(sporocilo.id);
      if (!c) continue;
      this.caka.delete(sporocilo.id);
      clearTimeout(c.casovnik);
      if (sporocilo.error) c.ne(new Error(String(sporocilo.error.message ?? "napaka")));
      else c.ok(sporocilo.result);
    }
  }

  private zavrziVse(razlog: string): void {
    this.proces = null;
    this.medpomnilnik = "";
    for (const [id, c] of this.caka) {
      clearTimeout(c.casovnik);
      c.ne(new Error(razlog));
      this.caka.delete(id);
    }
  }

  private klic(metoda: string, params: unknown): Promise<unknown> {
    const p = this.zazeni();
    const id = this.naslednji++;
    return new Promise((ok, ne) => {
      const casovnik = setTimeout(() => {
        this.caka.delete(id);
        ne(new Error("Naprava ni odgovorila pravocasno."));
      }, this.rokMs);
      this.caka.set(id, { ok, ne, casovnik });
      p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: metoda, params }) + "\n");
    });
  }

  private zacetek: Promise<unknown> | null = null;

  /** Izvede orodje (naprave_seznam, ukaz_napravi); vrne kratek izid. Neveljavno nalogo zavrne streznik (seznam dovoljenega). */
  async orodje(ime: "naprave_seznam" | "ukaz_napravi", argumenti: Record<string, unknown>): Promise<{ ok: boolean; besedilo: string }> {
    this.zacetek ??= this.klic("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "lina", version: "1" } })
      .catch((e) => { this.zacetek = null; throw e; });
    await this.zacetek;
    const r = (await this.klic("tools/call", { name: ime, arguments: argumenti })) as {
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
    };
    const besedilo = (r?.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").slice(0, 2000);
    return { ok: r?.isError !== true, besedilo };
  }

  ustavi(): void {
    const p = this.proces;
    this.zavrziVse("Streznik naprav je ustavljen.");
    this.zacetek = null;
    if (p) {
      try {
        p.stdin.end();
        p.kill();
      } catch {
        // ze ustavljen
      }
    }
  }
}

// ------------------------------------------------------------------ izvajalec Claude Code prek kanala (razdelki 1-6 naloge)

/** Rok za povezavo in prijavo na kanal: ce seja Claude Code ne tece, Lina to pove takoj, ne caka v tisini. */
export const ROK_KANALA_MS = 1500;
/** Privzeti rok naloge (gradnje in preizkusi trajajo dolgo); po izteku Lina nalogo ustavi in pove lastniku (N10). */
export const ROK_NALOGE_MS = 2 * 60 * 60_000;
/** Po izgubi povezave Lina vsakih toliko poskusi znova, dokler ima nalogo v teku (N4). */
export const PONOVNA_POVEZAVA_MS = 3000;

/** Pripis zmoznosti Programi (CLI-Anything): samo imena nameščenih CLI; vsako dejanje gre skozi podpisano odobritev na telefonu. */
export function besediloZPrograni(besedilo: string, programi: string[]): string {
  if (programi.length === 0) return besedilo;
  const seznam = programi.slice(0, 40).join(", ");
  return `${besedilo}\n\n[Lina: lastnik je vklopil Programe v racunalniku. Namesceni CLI: ${seznam}. Uporabi cli-anything-<program> z --json, kjer ustreza nalogi. Novega CLI ne gradi brez izrecne odobritve lastnika.]`;
}

export type MoznostiClaudeCode = {
  /** Pot vticnice kanala (kanal-claude.ts potVticnice). */
  pot: string;
  /** Zeton kanala iz sifrirane nastavitve (kanal-claude.server.ts preberiKanal); nikoli v dnevnik in nikoli po vticnici. */
  zeton: () => Promise<string | null>;
  /** ID-ji naprav, ki jih je Safeer Link preveril kot ozji krog (core/link_dostop.py). */
  ozjiKrog: () => ReadonlySet<string>;
  povezi?: (pot: string) => net.Socket;
  rokNalogeMs?: number;
  ponovnaPovezavaMs?: number;
  /** Opozorila kanala (spremenjen program ali seznam naprav) - Lina jih poslje lastniku na telefon (3b: se NI). */
  naOpozorilo?: (besedilo: string) => void;
  /** Imena nameščenih cli-anything-<program> (samo ce je dodatek Programi vklopljen; sicer prazen seznam). */
  programi?: () => Promise<string[]>;
};

type Aktivna = {
  naDogodek: (d: Dogodek) => void;
  posiljatelj: string;
  rok: ReturnType<typeof setTimeout>;
  povezana: boolean;
};

export const SPOROCILO_IZGUBLJENA = "Povezava s Claude Code je izgubljena; naloga morda tece naprej. Poskusam znova.";
export const SPOROCILO_OBNOVLJENA = "Povezava s Claude Code je spet vzpostavljena.";
export const SPOROCILO_SEJA_ZAPRTA = "Seja Claude Code se je zaprla, naloga ni koncana.";
export const SPOROCILO_ODOBRITEV_NEVELJAVNA = "Claude Code caka odobritev, ki je ni mogoce preveriti; odobrite ali zavrnite jo na racunalniku.";
export const SPOROCILO_UMAKNJENA = "Naprava ni vec v ozjem krogu; naloga je ustavljena.";

/**
 * Claude Code na lastnikovem racunalniku (narocnina ostane v Claude Code; Lina je samo kanal - odlocitev lastnika 13. 11.).
 * Seja tece interaktivno z `claude --dangerously-load-development-channels server:lina`; ko je ni, vticnice ni in
 * razpolozljiv() vrne false (izbira izvajalca gre na naslednjega).
 */
export class IzvajalecClaudeCode implements Izvajalec {
  readonly ime = "claude-code";
  private sock: net.Socket | null = null;
  private povezovanje: Promise<net.Socket> | null = null;
  /** Socket, ki se se prijavlja: zapri() ga unici, da ga cakajoca prijava pozneje ne nastavi (CodeRabbit C4). */
  private vPrijavi: net.Socket | null = null;
  private aktivne = new Map<string, Aktivna>();
  private ponovno: ReturnType<typeof setTimeout> | null = null;
  private zaprto = false;
  /** Opozorila kanala, ki jih je Lina ze javila (vsako enkrat na izvajalca). */
  private javljena = new Set<string>();
  /** Zadnje stanje seje iz kanala (seja odprta, ali je nastavljen ANTHROPIC_API_KEY). */
  stanje: { seja: boolean; apiKljuc: boolean } = { seja: false, apiKljuc: false };
  private readonly m: MoznostiClaudeCode;

  constructor(m: MoznostiClaudeCode) {
    this.m = m;
  }

  private povezi(): Promise<net.Socket> {
    if (this.sock && !this.sock.destroyed) return Promise.resolve(this.sock);
    this.povezovanje ??= (async () => {
      const zeton = await this.m.zeton();
      if (this.zaprto) throw new Error("Izvajalec je zaprt.");
      if (!zeton) throw new Error("Kanal ni pripravljen.");
      return await new Promise<net.Socket>((ok, ne) => {
        const s = (this.m.povezi ?? net.connect)(this.m.pot);
        this.vPrijavi = s;
        const vrstice = new Vrstice();
        const c = randomBytes(24).toString("base64url");
        let prijavljen = false;
        let izziv = false;
        const t = setTimeout(() => { s.destroy(); ne(new Error("Seja Claude Code se ne odziva.")); }, ROK_KANALA_MS);
        s.setEncoding("utf8");
        s.on("error", (e) => { clearTimeout(t); if (!prijavljen) ne(e); });
        s.on("close", () => {
          clearTimeout(t);
          if (!prijavljen) ne(new Error("Kanal je povezavo zavrnil."));
          if (this.sock === s) this.prekinjeno();
        });
        s.on("data", (kos: string) => {
          vrstice.dodaj(kos, (v) => {
            const sp = razcleniVrstico(v);
            if (!sp) return;
            if (!izziv) {
              // streznik mora prvi dokazati, da pozna zeton; sicer je to tuj program na mestu kanala (N3) in nic ne posljemo
              if (sp.vrsta !== "izziv" || typeof sp.s !== "string" || !IZZIV.test(sp.s)
                || !enakoKonstantno(sp.dokaz, dokazPrijave(zeton, "streznik", c, sp.s))) {
                s.destroy();
                return;
              }
              izziv = true;
              this.poslji(s, { vrsta: "prijava", dokaz: dokazPrijave(zeton, "odjemalec", c, sp.s) });
              return;
            }
            if (sp.vrsta === "pozdravljen") {
              this.stanje = { seja: sp.seja === true, apiKljuc: sp.apiKljuc === true };
              const opozorila = Array.isArray(sp.opozorila) ? sp.opozorila.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 300)) : [];
              for (const o of opozorila) {
                if (this.javljena.has(o)) continue;
                this.javljena.add(o);
                this.m.naOpozorilo?.(o);
              }
              if (!prijavljen) {
                if (this.zaprto) {
                  s.destroy();
                  return;
                }
                prijavljen = true;
                clearTimeout(t);
                this.vPrijavi = null;
                this.sock = s;
                this.poPrijavi(Array.isArray(sp.aktivne) ? sp.aktivne.filter((x): x is string => typeof x === "string") : []);
                ok(s);
              }
              return;
            }
            if (prijavljen) this.izKanala(sp);
          }, () => { s.destroy(); });
        });
        this.poslji(s, { vrsta: "pozdrav", c });
      });
    })().finally(() => {
      this.povezovanje = null;
      this.vPrijavi = null;
    });
    return this.povezovanje;
  }

  /** Po (ponovni) prijavi: naloge, ki jih kanal se pozna, so spet povezane; drugih ni vec (seja se je zaprla). */
  private poPrijavi(vKanalu: string[]): void {
    const znane = new Set(vKanalu);
    for (const [id, a] of [...this.aktivne]) {
      if (znane.has(id)) {
        if (!a.povezana) a.naDogodek({ vrsta: "stanje", besedilo: SPOROCILO_OBNOVLJENA });
        a.povezana = true;
      } else if (!a.povezana) {
        this.koncaj(id, { vrsta: "izid", ok: false, besedilo: SPOROCILO_SEJA_ZAPRTA });
      }
    }
  }

  /** Povezava izgubljena: naloge v seji morda tecejo naprej - lastniku resnica, ne laziv izid (N4). */
  private prekinjeno(): void {
    this.sock = null;
    this.stanje = { seja: false, apiKljuc: this.stanje.apiKljuc };
    for (const [, a] of this.aktivne) {
      if (a.povezana) a.naDogodek({ vrsta: "stanje", besedilo: SPOROCILO_IZGUBLJENA });
      a.povezana = false;
    }
    this.nacrtujPonovno();
  }

  private nacrtujPonovno(): void {
    if (this.zaprto || this.ponovno || this.aktivne.size === 0) return;
    this.ponovno = setTimeout(() => {
      this.ponovno = null;
      this.povezi().catch(() => {
        // seje ni: naloge, ki niso vec povezane, ne morejo nikoli dobiti izida
        for (const [id, a] of [...this.aktivne]) if (!a.povezana) this.koncaj(id, { vrsta: "izid", ok: false, besedilo: SPOROCILO_SEJA_ZAPRTA });
      });
    }, this.m.ponovnaPovezavaMs ?? PONOVNA_POVEZAVA_MS);
    this.ponovno.unref?.();
  }

  private koncaj(id: string, d: Dogodek): void {
    const a = this.aktivne.get(id);
    if (!a) return;
    clearTimeout(a.rok);
    this.aktivne.delete(id);
    a.naDogodek(d);
  }

  /** Naloga naprave, ki ni vec v ozjem krogu, se konca (kanal jo v seji ustavi sam). */
  private veljavna(id: string): Aktivna | null {
    const a = this.aktivne.get(id);
    if (!a) return null;
    if (!this.m.ozjiKrog().has(a.posiljatelj)) {
      // kanal ob umiku nalogo v seji ustavi sam (bere isti seznam); Lina samo konca cakanje
      this.koncaj(id, { vrsta: "izid", ok: false, besedilo: SPOROCILO_UMAKNJENA });
      return null;
    }
    return a;
  }

  private izKanala(sp: Record<string, unknown>): void {
    if (sp.vrsta === "odgovor" && typeof sp.chatId === "string" && typeof sp.besedilo === "string") {
      const a = this.veljavna(sp.chatId);
      if (!a) return;
      if (sp.koncano === false) a.naDogodek({ vrsta: "stanje", besedilo: sp.besedilo });
      else this.koncaj(sp.chatId, { vrsta: "izid", ok: true, besedilo: sp.besedilo });
      return;
    }
    if (sp.vrsta === "odobritev" && typeof sp.chatId === "string" && typeof sp.zahtevaId === "string" && ID_ODOBRITVE.test(sp.zahtevaId)) {
      // kanal odobritev veze na nalogo (in njeno napravo); ne ugibamo »zadnje« naloge
      const a = this.veljavna(sp.chatId);
      if (!a) return;
      const { orodje, opis, predogled, zgostitev } = sp;
      // R2-L: Lina zgostitev izracuna SAMA iz vsebine, ki jo poslje telefonu; polje kanala je samo za primerjavo. Neveljavno orodje
      // ali vsebina, ki ni ociscena kot v kanalu, ne gre na telefon (lazni ali spremenjen kanal).
      if (typeof orodje !== "string" || !IME_ORODJA.test(orodje) || typeof opis !== "string" || typeof predogled !== "string"
        || ocistiZaTelefon(opis) !== opis || ocistiZaTelefon(predogled) !== predogled
        || zgostitev !== zgostitevPrikaza(orodje, predogled, opis)) {
        a.naDogodek({ vrsta: "stanje", besedilo: SPOROCILO_ODOBRITEV_NEVELJAVNA });
        return;
      }
      // telefon podpise to zgostitev prikazanega (kanal-claude.ts zgostitevPrikaza, nizOdobritve)
      a.naDogodek({ vrsta: "odobritev", zahtevaId: sp.zahtevaId, orodje, opis, predogled, zgostitev });
      return;
    }
    if (sp.vrsta === "umaknjeno" && typeof sp.id === "string") {
      this.koncaj(sp.id, { vrsta: "izid", ok: false, besedilo: SPOROCILO_UMAKNJENA });
      return;
    }
    if (sp.vrsta === "zavrnjeno" && typeof sp.id === "string") {
      const razlog = typeof sp.razlog === "string" && sp.razlog ? sp.razlog.slice(0, 300) : "Claude Code naloge ni sprejel.";
      this.koncaj(sp.id, { vrsta: "izid", ok: false, besedilo: razlog });
    }
  }

  private poslji(s: net.Socket, sp: ZaKanal): void {
    s.write(JSON.stringify(sp) + "\n");
  }

  async razpolozljiv(): Promise<boolean> {
    try {
      await this.povezi();
      return this.stanje.seja;
    } catch {
      return false;
    }
  }

  async zacni(naloga: Naloga, naDogodek: (d: Dogodek) => void): Promise<void> {
    // varovalo tudi na strani Line: tujec ali pot tajnice ne pride niti do vticnice
    if (!dovoljenaNaloga(naloga, this.m.ozjiKrog())) throw new Error("Naloga ni dovoljena.");
    if (this.aktivne.has(naloga.id)) throw new Error("Naloga s tem ID ze tece.");
    const s = await this.povezi();
    const rokMs = this.m.rokNalogeMs ?? ROK_NALOGE_MS;
    const rok = setTimeout(() => {
      const minut = Math.max(1, Math.round(rokMs / 60_000));
      // kanal ima enak rok in nalogo v seji ustavi sam (ustavitev brez podpisa naprave ne velja)
      this.koncaj(naloga.id, { vrsta: "izid", ok: false, besedilo: `Naloga ni koncana v ${minut} min; ustavljena je.` });
    }, rokMs);
    rok.unref?.();
    this.aktivne.set(naloga.id, { naDogodek, posiljatelj: naloga.posiljatelj, rok, povezana: true });
    const programi = await this.m.programi?.().catch(() => [] as string[]) ?? [];
    this.poslji(s, {
      vrsta: "naloga",
      naloga: { id: naloga.id, besedilo: besediloZPrograni(naloga.besedilo, programi), posiljatelj: naloga.posiljatelj, izvor: naloga.izvor, dokaz: naloga.dokaz },
    });
  }

  async odobri(_nalogaId: string, zahtevaId: string, dovoli: boolean, posiljatelj: string, dokaz?: Dokaz): Promise<void> {
    if (!this.m.ozjiKrog().has(posiljatelj) || !ID_ODOBRITVE.test(zahtevaId)) throw new Error("Odobritev ni dovoljena.");
    const s = await this.povezi();
    this.poslji(s, { vrsta: "odobritev", zahtevaId, dovoli, posiljatelj, dokaz });
  }

  /** Ustavitev gre v sejo tudi po izgubljeni povezavi (ponovna povezava); ce seje ni, napaka pove resnico. */
  async ustavi(nalogaId: string, dokaz?: Dokaz): Promise<void> {
    const a = this.aktivne.get(nalogaId);
    if (!a) return;
    const s = await this.povezi().catch(() => {
      throw new Error("Ustavitve ni bilo mogoce poslati: seja Claude Code ni dosegljiva.");
    });
    // Claude Code sporocilo dobi ob naslednjem obratu (dogodki cakajo v vrsti); trenutnega orodja ne prekine
    this.poslji(s, { vrsta: "ustavi", id: nalogaId, posiljatelj: a.posiljatelj, dokaz });
  }

  zapri(): void {
    this.zaprto = true;
    this.vPrijavi?.destroy();
    this.vPrijavi = null;
    if (this.ponovno) clearTimeout(this.ponovno);
    for (const [, a] of this.aktivne) clearTimeout(a.rok);
    this.aktivne.clear();
    const s = this.sock;
    this.sock = null;
    s?.destroy();
  }
}
