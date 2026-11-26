/**
 * Varovalka 6-mestne kode za seznanjanje telefona. PREPIS core/link_varovalka.py (Safeer Link, isto kot HubVarovalka.kt):
 * steje VSE poskuse kode (en krog SPAKE2 = en poskus) in VSE zacetke prijave skupaj, ne glede na vir. V eni uri najvec
 * POSKUSOV neuspelih poskusov in ZACETKOV zacetkov; ob meji se povezovanje s kodo zapre za 1 h, nato 1 dan, nato 1 teden,
 * po zapori veljata manjsi meji, dokler ne mine POZABI_S brez nove zapore. Med zaporo gre naprej samo »vabilo« (lastnik je
 * sam odprl »Povezi s kodo«), in tudi takrat najvec KREDIT_VABILA poskusov na zaporo. Uspesna seznanitev svoj poskus in
 * zacetek vrne. Stanje prezivi ponovni zagon (shrani/izvozi), sicer bi vsak zagon napadalcu vrnil polno mejo.
 * Cas je v sekundah kot v Pythonu.
 * Naloga 21 (N2, namerna razlika od Linka): `krat` pomnozi meje poskusov in zacetkov - Lina ima varovalko na vir (koda-seznanitev.ts)
 * z mejami Linka in skupno varovalko s krat = SKUPNO_KRAT kot zgornjo mejo cez vse vire. Privzeto 1 = natanko Link.
 * SKUPNO_KRAT 3 (slepi pregled 21, najdba 1): tujec potrebuje vsaj 3 naslove, da zaklene seznanitev s kodo (lastnik jo odklene z gumbom,
 * QR ni prizadet), ugibanj kode na leto je najvec ~3x vec kot v Linku; uspeh dostopa ne da (»Dodaj« z vidnim id-jem). Odlocitev lastnika.
 */
export const SKUPNO_KRAT = 3;
export const OKNO_S = 3600;
export const POSKUSOV = 20;
export const POSKUSOV_PO_ZAPORI = 5;
export const ZACETKOV = 30;
export const ZACETKOV_PO_ZAPORI = 10;
export const ZAPORE_S = [3600, 86400, 7 * 86400] as const;
export const POZABI_S = 30 * 86400;
export const KREDIT_VABILA = 10;
export const NAJVEC_VIROV = 3;

type Zapis = [number, string];
export type StanjeVarovalke = { poskusi: Zapis[]; zacetki: Zapis[]; zaprto_do: number; ponovitev: number; kredit: number };
export type DogodekZapore = { trajanje_s: number; razlog: "kode" | "zacetki"; ponovitev: number; viri: Array<[string, number]> };

export class VarovalkaKode {
  private poskusi: Zapis[] = [];
  private zacetki: Zapis[] = [];
  private zaprtoDo = 0;
  private ponovitev = 0;
  private kredit = 0;
  private readonly ura: () => number;
  private readonly shrani?: (s: StanjeVarovalke) => void;
  private readonly krat: number;
  obZapori?: (d: DogodekZapore) => void;

  constructor(o: { ura?: () => number; stanje?: unknown; shrani?: (s: StanjeVarovalke) => void; obZapori?: (d: DogodekZapore) => void; krat?: number } = {}) {
    this.ura = o.ura ?? (() => Date.now() / 1000);
    this.krat = Number.isInteger(o.krat) && (o.krat as number) >= 1 ? (o.krat as number) : 1;
    this.shrani = o.shrani;
    this.obZapori = o.obZapori;
    this.uvozi(o.stanje);
  }

  private uvozi(stanje: unknown): void {
    if (!stanje || typeof stanje !== "object" || Array.isArray(stanje)) return;
    const s = stanje as Record<string, unknown>;
    const zapisi = (k: string): Zapis[] => {
      const izid: Zapis[] = [];
      for (const z of Array.isArray(s[k]) ? (s[k] as unknown[]) : []) {
        if (!Array.isArray(z) || z.length < 2) continue;
        const t = Number(z[0]);
        if (Number.isFinite(t)) izid.push([t, String(z[1]).slice(0, 64)]);
      }
      return izid.slice(-Math.max(POSKUSOV, ZACETKOV) * this.krat);
    };
    const st = (v: unknown) => (Number.isFinite(Number(v ?? 0)) ? Number(v ?? 0) : NaN);
    const zd = st(s.zaprto_do), po = st(s.ponovitev), kr = st(s.kredit);
    if ([zd, po, kr].some(Number.isNaN)) return;
    this.poskusi = zapisi("poskusi");
    this.zacetki = zapisi("zacetki");
    this.zaprtoDo = zd;
    this.ponovitev = Math.max(0, Math.min(Math.trunc(po), 1000));
    this.kredit = Math.max(0, Math.min(Math.trunc(kr), KREDIT_VABILA));
  }

  izvozi(): StanjeVarovalke {
    return { poskusi: this.poskusi.map((z) => [...z] as Zapis), zacetki: this.zacetki.map((z) => [...z] as Zapis), zaprto_do: this.zaprtoDo, ponovitev: this.ponovitev, kredit: this.kredit };
  }

  private zapisi(): void {
    try { this.shrani?.(this.izvozi()); } catch { /* napaka pri pisanju varovalke ne ustavi */ }
  }

  /** Zapis iz »prihodnosti« (ura je sla nazaj) velja za pravkar narejenega. */
  private pocisti(zdaj: number): void {
    const meja = zdaj - OKNO_S;
    const f = (s: Zapis[]) => s.map(([t, v]) => [Math.min(t, zdaj), v] as Zapis).filter(([t]) => t > meja);
    this.poskusi = f(this.poskusi);
    this.zacetki = f(this.zacetki);
    const najdlje = ZAPORE_S[ZAPORE_S.length - 1];
    if (this.zaprtoDo > zdaj + najdlje) this.zaprtoDo = zdaj + najdlje;
    if (this.ponovitev && this.zaprtoDo <= zdaj && zdaj - this.zaprtoDo > POZABI_S) this.ponovitev = 0;
  }

  private meji(): [number, number] {
    return (this.ponovitev ? [POSKUSOV_PO_ZAPORI, ZACETKOV_PO_ZAPORI] : [POSKUSOV, ZACETKOV]).map((x) => x * this.krat) as [number, number];
  }

  private zapri(zdaj: number, razlog: "kode" | "zacetki"): DogodekZapore {
    const trajanje = ZAPORE_S[Math.min(this.ponovitev, ZAPORE_S.length - 1)];
    const stetje = new Map<string, number>();
    for (const [, vir] of razlog === "kode" ? this.poskusi : this.zacetki) if (vir) stetje.set(vir, (stetje.get(vir) ?? 0) + 1);
    const viri = [...stetje].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(0, NAJVEC_VIROV);
    this.ponovitev += 1;
    this.zaprtoDo = zdaj + trajanje;
    this.kredit = KREDIT_VABILA;
    this.poskusi = [];
    this.zacetki = [];
    this.zapisi();
    return { trajanje_s: trajanje, razlog, ponovitev: this.ponovitev, viri };
  }

  private sporoci(d: DogodekZapore | null): void {
    if (!d) return;
    try { this.obZapori?.(d); } catch { /* klicatelj ne ustavi varovalke */ }
  }

  zaprto(): boolean {
    return this.ura() < this.zaprtoDo;
  }

  /** Ali sme nova naprava zdaj zaceti prijavo s kodo (brez stetja). */
  smeZaceti(vabilo = false): boolean {
    const zdaj = this.ura();
    this.pocisti(zdaj);
    return zdaj >= this.zaprtoDo || (vabilo && this.kredit > 0);
  }

  /** Nova naprava zacenja prijavo s kodo. false = povezovanje s kodo je zaprto. */
  zacetek(vir = "", vabilo = false): boolean {
    const zdaj = this.ura();
    this.pocisti(zdaj);
    if (zdaj < this.zaprtoDo) return vabilo && this.kredit > 0;
    this.zacetki.push([zdaj, String(vir).slice(0, 64)]);
    let d: DogodekZapore | null = null;
    if (this.zacetki.length >= this.meji()[1]) d = this.zapri(zdaj, "zacetki");
    else this.zapisi();
    this.sporoci(d);
    return d ? vabilo : true;
  }

  /** En krog SPAKE2 = en poskus kode. false = poskusa ne izvedemo. */
  poskus(vir = "", vabilo = false): boolean {
    const zdaj = this.ura();
    this.pocisti(zdaj);
    if (zdaj < this.zaprtoDo) {
      if (!vabilo || this.kredit <= 0) return false;
      this.kredit -= 1;
      this.zapisi();
      return true;
    }
    this.poskusi.push([zdaj, String(vir).slice(0, 64)]);
    let d: DogodekZapore | null = null;
    if (this.poskusi.length >= this.meji()[0]) {
      d = this.zapri(zdaj, "kode");
      if (vabilo) {
        this.kredit -= 1;
        this.zapisi();
      }
    } else this.zapisi();
    this.sporoci(d);
    return d ? vabilo : true;
  }

  /** Seznanitev je uspela: njen poskus in njen zacetek ne stejeta. */
  uspeh(vir = ""): void {
    const zdaj = this.ura();
    this.pocisti(zdaj);
    const v = String(vir).slice(0, 64);
    if (zdaj < this.zaprtoDo) this.kredit = Math.min(KREDIT_VABILA, this.kredit + 1);
    for (const s of [this.poskusi, this.zacetki]) {
      for (let i = s.length - 1; i >= 0; i--) if (s[i][1] === v) { s.splice(i, 1); break; }
    }
    this.zapisi();
  }

  /** Lastnik je zaporo sam koncal; stetje ponovitev ostane (naslednja zapora je daljsa). */
  odpri(): void {
    const zdaj = this.ura();
    if (zdaj < this.zaprtoDo) {
      this.zaprtoDo = zdaj;
      this.kredit = 0;
      this.zapisi();
    }
  }

  /**
   * Lastnik je zaporo preklical z izrecnim dejanjem (T1-N1): zapora, kredit, stetje poskusov in ponovitev se pocistijo.
   * Razlika od odpri(): tudi ponovitev gre na 0, da neznanec z naslednjimi krogi ne dobi daljse zapore (1 dan, 1 teden) in
   * lastnik ne obtici brez poti nazaj.
   */
  ponastavi(): void {
    this.zaprtoDo = 0;
    this.kredit = 0;
    this.ponovitev = 0;
    this.poskusi = [];
    this.zacetki = [];
    this.zapisi();
  }

  stanje() {
    const zdaj = this.ura();
    this.pocisti(zdaj);
    const [mp, mz] = this.meji();
    const zaprto = zdaj < this.zaprtoDo;
    return { zaprto, se_s: zaprto ? Math.trunc(this.zaprtoDo - zdaj) : 0, poskusov: this.poskusi.length, meja_poskusov: mp, zacetkov: this.zacetki.length, meja_zacetkov: mz, ponovitev: this.ponovitev, kredit: zaprto ? this.kredit : 0 };
  }
}
