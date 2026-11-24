import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { pocistiPolje } from "./splet.ts";
import { MEJA_ZNANJA } from "./znanje-besedilo.ts";
import type { VrstaDokumenta } from "./znanje-viri.ts";

/**
 * Izvlecek besedila iz dokumenta podjetja (lastnik 23. 11. 2026, AGENTS.md »Znanje iz datotek podjetja"). Vse LOKALNO, brez sistemskih
 * orodij in brez omrezja: DOCX, ODT, XLSX (ZIP + XML), CSV, TXT/MD, PDF (unpdf). Vrsta se doloci po vsebini (magicni bajti), ne po
 * koncnici. Besedilo je PODATEK.
 *
 * Pregled 0.2.10 (najdba 1) in drugi pregled (CodeRabbit CR3): razclemba VSEH vrst tece v LOCENEM PROCESU (isti izvrsljivi Node/Electron
 * z ELECTRON_RUN_AS_NODE) z mejo kopice V8 (--max-old-space-size) in strazo RSS otroka; ob roku ali preseganju se otrok ubije. Pokvarjen ali
 * zlonameren dokument (tudi zunanji pomnilnik, ki ga resourceLimits delavca ne steje) sesuje kvecjemu otroka, nikoli procesa, ki streze klice. Meja znakov velja SPROTI, celica je najvec CELICA_NAJVEC znakov, vrstica najvec CELIC_V_VRSTICI celic, rok se preveri po vsaki
 * celici in vrstici. Ciscenje celic (pocistiPolje) je v glavni niti, na ze omejenih vrsticah.
 */

export type Meje = {
  bajtov: number; // najvecja datoteka
  razpakirano: number; // skupaj razpakiranih bajtov vseh prebranih vnosov
  razmerje: number; // najvecje razmerje razpakirano / stisnjeno na vnos
  vnosov: number; // najvec vnosov v imeniku ZIP
  listov: number; // najvec listov XLSX
  casMs: number; // rok razclembe (delavec se ob roku ustavi)
  znakov: number; // najvec izvlecenih znakov (sproti; vec ne gre v znanje)
  pomnilnikMb?: number; // kopica V8 otroka (privzeto 512)
  zunanjiMb?: number; // dovoljen RSS otroka nad kopico (ArrayBuffer, tokovi PDF), privzeto 512
};

export const MEJE_DOKUMENTA: Meje = {
  bajtov: 15 * 1024 * 1024,
  razpakirano: 40 * 1024 * 1024,
  razmerje: 200,
  vnosov: 5000,
  listov: 30,
  casMs: 8000,
  znakov: MEJA_ZNANJA,
  pomnilnikMb: 512,
};

/** Meje tabel (odlocitev vodje 0.2.10): daljsa celica ali vec celic v vrstici = »bomba«. Enaki vrednosti sta v jedru (samostojno). */
export const CELICA_NAJVEC = 10_000;
export const CELIC_V_VRSTICI = 1000;
export const NAJVEC_STRANI_PDF = 300;

export type Vrsta = VrstaDokumenta;

/** Razlog zavrnitve kot kljuc; besedilo za uporabnika je v znanje-datoteke-besedila.ts. */
export type RazlogDokumenta = "vrsta" | "velik" | "bomba" | "poskodovan" | "sifriran" | "cas" | "prazen" | "kodiranje" | "pdfSken";

export class NapakaDokumenta extends Error {
  readonly razlog: RazlogDokumenta;
  constructor(razlog: RazlogDokumenta) {
    super(razlog);
    this.razlog = razlog;
  }
}

export type Izvlecek = { vrsta: Vrsta; besedilo: string; tabela: boolean; skrajsano: boolean };
type IzidJedra = { vrsta: Vrsta; tabela: boolean; skrajsano: boolean; besedilo?: string; vrstice?: string[][] };
type Napihni = (b: Uint8Array, o: { maxOutputLength: number }) => Uint8Array;
/** Nalozi knjiznico PDF; v delavcu jo poda koda delavca (import() ni v jedru: gradnja bi ga lahko prepisala v zunanjo pomozno funkcijo). */
type NaloziPdf = () => Promise<unknown>;

/**
 * Jedro razclembe. SAMOSTOJNA funkcija (brez sklicev na karkoli zunaj nje): delavec jo dobi kot besedilo (Function.toString), zato deluje
 * enako v izvorni kodi in v zgrajenem paketu. Ista koda tece v glavni niti samo za neposredne klice besedilo* (preizkusi, majhni nizi).
 */
function jedroRazclembe(napihni: Napihni, naloziPdf: NaloziPdf) {
  const CELICA = 10_000;
  const CELIC = 1000;
  const STRANI_PDF = 300;
  // Brez razreda (polja razreda bi gradnja lahko prepisala s pomocnikom zunaj jedra): napaka je Error z lastnostjo razlog.
  const Napaka = function (razlog: string): Error & { razlog: string } {
    return Object.assign(new Error(razlog), { razlog });
  } as unknown as new (razlog: string) => Error & { razlog: string };
  /** Ustavitev ob meji znakov (ni napaka: izvlecek je skrajsan). */
  const DOVOLJ = { dovolj: true };
  const preveriRok = (rok: number) => {
    if (Date.now() > rok) throw new Napaka("cas");
  };

  const zacne = (b: Uint8Array, ...z: number[]) => z.every((v, i) => b[i] === v);
  function vrstaDokumenta(ime: string, b: Uint8Array): string | null {
    if (zacne(b, 0x25, 0x50, 0x44, 0x46, 0x2d)) return "pdf"; // %PDF-
    if (zacne(b, 0x50, 0x4b, 0x03, 0x04)) return "zip";
    if (/\.csv$/i.test(ime)) return "csv";
    if (/\.(txt|md|markdown)$/i.test(ime)) return "txt";
    return null;
  }

  type Vnos = { ime: string; metoda: number; zastavice: number; stisnjeno: number; odmik: number };
  type M = { razpakirano: number; razmerje: number; vnosov: number; listov: number; casMs: number; znakov: number };

  /** Osrednji imenik ZIP (brez ZIP64, brez sifriranja). Velikosti iz glave so samo namig: meja velja pri napihovanju. */
  function imenikZip(b: Uint8Array, meje: M): Map<string, Vnos> {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
      if (v.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Napaka("poskodovan");
    const stevilo = v.getUint16(eocd + 10, true);
    const zacetek = v.getUint32(eocd + 16, true);
    if (stevilo === 0xffff || zacetek === 0xffffffff) throw new Napaka("poskodovan"); // ZIP64
    if (stevilo > meje.vnosov) throw new Napaka("bomba");
    const vnosi = new Map<string, Vnos>();
    let p = zacetek;
    for (let i = 0; i < stevilo; i++) {
      if (p + 46 > b.length || v.getUint32(p, true) !== 0x02014b50) throw new Napaka("poskodovan");
      const dIme = v.getUint16(p + 28, true);
      const dDodatno = v.getUint16(p + 30, true);
      const dKomentar = v.getUint16(p + 32, true);
      if (p + 46 + dIme > b.length) throw new Napaka("poskodovan");
      const ime = new TextDecoder().decode(b.subarray(p + 46, p + 46 + dIme));
      vnosi.set(ime, {
        ime,
        zastavice: v.getUint16(p + 8, true),
        metoda: v.getUint16(p + 10, true),
        stisnjeno: v.getUint32(p + 20, true),
        odmik: v.getUint32(p + 42, true),
      });
      p += 46 + dIme + dDodatno + dKomentar;
    }
    return vnosi;
  }

  type Branje = { b: Uint8Array; meje: M; porabljeno: number; rok: number };

  function preberiVnos(st: Branje, vnos: Vnos): string {
    preveriRok(st.rok);
    if (vnos.zastavice & 1) throw new Napaka("sifriran");
    const v = new DataView(st.b.buffer, st.b.byteOffset, st.b.byteLength);
    const p = vnos.odmik;
    if (p + 30 > st.b.length || v.getUint32(p, true) !== 0x04034b50) throw new Napaka("poskodovan");
    const od = p + 30 + v.getUint16(p + 26, true) + v.getUint16(p + 28, true);
    const do_ = od + vnos.stisnjeno;
    if (do_ > st.b.length) throw new Napaka("poskodovan");
    const stisnjeno = st.b.subarray(od, do_);
    const ostane = st.meje.razpakirano - st.porabljeno;
    // Meja velja za DEJANSKI izhod (glava lahko laze): najvec ostanek skupne meje in razmerje na vnos.
    const najvec = Math.min(ostane, Math.max(64 * 1024, stisnjeno.length * st.meje.razmerje));
    if (najvec <= 0) throw new Napaka("bomba");
    let izhod: Uint8Array;
    if (vnos.metoda === 0) {
      if (stisnjeno.length > najvec) throw new Napaka("bomba");
      izhod = stisnjeno;
    } else if (vnos.metoda === 8) {
      try {
        izhod = napihni(stisnjeno, { maxOutputLength: najvec });
      } catch (e) {
        throw new Napaka((e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE" ? "bomba" : "poskodovan");
      }
    } else throw new Napaka("poskodovan");
    st.porabljeno += izhod.length;
    preveriRok(st.rok);
    const xml = new TextDecoder().decode(izhod);
    // XML z DTD ali entitetami ni del teh formatov (napad z razsiritvijo entitet).
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Napaka("poskodovan");
    return xml;
  }

  const ENTITETE: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
  function odkodirajXml(s: string): string {
    return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|lt|gt|amp|quot|apos);/gi, (_: string, e: string) => {
      if (e[0] !== "#") return ENTITETE[e.toLowerCase()] ?? "";
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
    });
  }

  type Oznaka = { ime: string; zapira: boolean; prazna: boolean; notr: string };

  /** Imenski prostori po URI (CodeRabbit, drugi pregled 0.2.10): veljaven dokument sme uporabiti drugo predpono ali privzeti prostor. */
  const PROSTORI: Record<string, string> = {
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main": "w",
    "urn:oasis:names:tc:opendocument:xmlns:office:1.0": "office",
    "urn:oasis:names:tc:opendocument:xmlns:text:1.0": "text",
    "http://schemas.openxmlformats.org/spreadsheetml/2006/main": "",
  };
  /**
   * Predpona v dokumentu -> obicajna predpona, ki jo bralniki uporabljajo (null = nic za preimenovati).
   * shortcut: deklaracije se berejo iz prvih 64 KB (korenski element) in veljajo za ves del; drugacna predpona, deklarirana globlje, ni prevedena.
   */
  function predpone(xml: string): Map<string, string> | null {
    const m = new Map<string, string>();
    for (const d of xml.slice(0, 1 << 16).matchAll(/\sxmlns(?::([\w.-]+))?\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const kanon = PROSTORI[d[2] ?? d[3] ?? ""];
      const pred = d[1] ?? "";
      if (kanon !== undefined && pred !== kanon) m.set(pred, kanon);
    }
    return m.size ? m : null;
  }
  function preimenuj(m: Map<string, string>, ime: string): string {
    const i = ime.indexOf(":");
    const kanon = m.get(i < 0 ? "" : ime.slice(0, i));
    if (kanon === undefined || (i < 0 && ime === "xmlns")) return ime;
    const lokalno = i < 0 ? ime : ime.slice(i + 1);
    return kanon ? `${kanon}:${lokalno}` : lokalno;
  }

  /**
   * En linearen prehod cez XML (indexOf, brez regularnih izrazov nad celim dokumentom). Komentarji, CDATA, ukazi in deklaracije se
   * preskocijo; rok se preveri vsakih 2048 oznak.
   */
  function prehodiXml(xml: string, rok: number, oznaka: (o: Oznaka) => void, besedilo: (s: string) => void): void {
    const imena = predpone(xml);
    let i = 0;
    let n = 0;
    while (i < xml.length) {
      const lt = xml.indexOf("<", i);
      if (lt < 0) {
        besedilo(xml.slice(i));
        break;
      }
      if (lt > i) besedilo(xml.slice(i, lt));
      if (++n % 2048 === 0) preveriRok(rok);
      const konec = xml.startsWith("<!--", lt) ? "-->" : xml.startsWith("<![CDATA[", lt) ? "]]>" : ">";
      const gt = xml.indexOf(konec, lt + 1);
      if (gt < 0) break;
      if (konec === ">") {
        let notr = xml.slice(lt + 1, gt);
        let ime = /^\/?([^\s/>]*)/.exec(notr)?.[1] ?? "";
        if (imena && ime) {
          ime = preimenuj(imena, ime);
          notr = notr.replace(/(\s)([\w.-]+):(?=[\w.-]+\s*=)/g, (cel: string, pr: string, p: string) => (p === "xmlns" ? cel : `${pr}${preimenuj(imena, `${p}:x`).slice(0, -1)}`));
        }
        if (ime && notr[0] !== "?" && notr[0] !== "!") oznaka({ ime, zapira: notr[0] === "/", prazna: notr.endsWith("/"), notr });
      }
      i = gt + konec.length;
    }
    preveriRok(rok);
  }

  /**
   * Izhod z mejo znakov SPROTI: ko je meja presezena, se razclemba ustavi (vrnjeno besedilo je daljse od meje = skrajsano). Doda se samo
   * preostanek proracuna (+1 znak kot oznaka prereza), zato delavec nikoli ne poslje dolgega teka v celoti (CodeRabbit, drugi pregled 0.2.10).
   */
  function zbiralnik(znakov: number) {
    const deli: string[] = [];
    let dolzina = 0;
    return {
      dodaj(s: string) {
        const ostane = znakov + 1 - dolzina;
        if (s.length >= ostane) {
          deli.push(s.slice(0, ostane));
          dolzina += ostane;
          if (dolzina > znakov) throw DOVOLJ;
          return;
        }
        deli.push(s);
        dolzina += s.length;
      },
      zakljuci(delo: () => void): string {
        try {
          delo();
        } catch (e) {
          if (e !== DOVOLJ) throw e;
        }
        return deli.join("");
      },
    };
  }

  // Vrednost atributa v dvojnih ALI enojnih narekovajih, s presledki okoli = (XML 1.0; CodeRabbit, drugi pregled 0.2.10).
  const atribut = (notr: string, ime: string) => {
    const m = new RegExp(`\\s${ime}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(notr);
    return m ? (m[1] ?? m[2]) : undefined;
  };
  /** w:val="0|false|off" pomeni lastnost izklopljeno (»ni skrito«). */
  const vklopljeno = (notr: string) => !/^(0|false|off)$/i.test(atribut(notr, "w:val") ?? "true");

  /**
   * DOCX: samo besedilo v w:t (seznam dovoljenega). Kode polj (w:instrText), izbrisano (w:delText) in odmiki slik niso besedilo.
   * Skrito besedilo (pregled 0.2.10, najdba 5): tek z w:vanish, w:webHidden ali w:specVanish ali z belo pisavo (w:color FFFFFF) ni besedilo.
   */
  function besediloDocx(xml: string, rok = Infinity, znakov = Infinity): string {
    const ven = zbiralnik(znakov);
    let vT = false;
    let vR = false;
    let skrito = false;
    return ven.zakljuci(() =>
      prehodiXml(
        xml,
        rok,
        (o) => {
          if (o.ime === "w:r") {
            if (!o.prazna) vR = !o.zapira;
            skrito = false;
          } else if (o.ime === "w:t") {
            if (!o.prazna) vT = !o.zapira;
          } else if (vR && !o.zapira && (o.ime === "w:vanish" || o.ime === "w:webHidden" || o.ime === "w:specVanish")) {
            if (vklopljeno(o.notr)) skrito = true;
          } else if (vR && !o.zapira && o.ime === "w:color") {
            if (/^(ffffff|white)$/i.test(atribut(o.notr, "w:val") ?? "")) skrito = true;
          } else if (o.zapira) {
            if (o.ime === "w:p") ven.dodaj("\n");
          } else if (o.ime === "w:tab") ven.dodaj(" ");
          else if (o.ime === "w:br" || o.ime === "w:cr") ven.dodaj("\n");
        },
        (s) => {
          if (vT && !skrito) ven.dodaj(odkodirajXml(s));
        },
      ),
    );
  }

  /** Vsebina teh elementov ni besedilo: sledenje sprememb, komentarji, skriti odstavki in besedilo (pregled 0.2.10, najdba 5). */
  const PRESKOK_ODT = new Set(["text:tracked-changes", "office:annotation", "text:hidden-paragraph", "text:hidden-text"]);

  /** ODT: besedilo odstavkov in naslovov v office:body; sledenje sprememb, komentarji in skriti deli niso besedilo. */
  function besediloOdt(xml: string, rok = Infinity, znakov = Infinity): string {
    const ven = zbiralnik(znakov);
    let telo = false;
    let odst = 0;
    let preskok = 0;
    const skriteSekcije: boolean[] = [];
    return ven.zakljuci(() =>
      prehodiXml(
        xml,
        rok,
        (o) => {
          if (o.ime === "office:body") {
            if (!o.prazna) telo = !o.zapira;
          } else if (o.ime === "text:section") {
            // Skrita sekcija (text:display="none" ali pogojno): vsebina ni besedilo.
            if (o.prazna) return;
            if (o.zapira) {
              if (skriteSekcije.pop()) preskok = Math.max(0, preskok - 1);
            } else {
              const skrita = /^(none|condition)$/.test(atribut(o.notr, "text:display") ?? "");
              skriteSekcije.push(skrita);
              if (skrita) preskok++;
            }
          } else if (PRESKOK_ODT.has(o.ime)) {
            if (!o.prazna) preskok = Math.max(0, preskok + (o.zapira ? -1 : 1));
          } else if (o.ime === "text:p" || o.ime === "text:h") {
            if (!o.prazna) odst = Math.max(0, odst + (o.zapira ? -1 : 1));
            if ((o.zapira || o.prazna) && !preskok) ven.dodaj("\n");
          } else if (!o.zapira && odst && !preskok) {
            if (o.ime === "text:s" || o.ime === "text:tab") ven.dodaj(" ");
            else if (o.ime === "text:line-break") ven.dodaj("\n");
          }
        },
        (s) => {
          if (telo && odst && !preskok) ven.dodaj(odkodirajXml(s));
        },
      ),
    );
  }

  /** Tabela z mejami: celica najvec CELICA znakov, vrstica najvec CELIC celic, rok po vsaki celici in vrstici, znaki sproti. */
  function tabela(znakov: number, rok: number) {
    const vrstice: string[][] = [];
    let celice: string[] = [];
    let skupaj = 0;
    let skrajsano = false;
    return {
      vrstice,
      celica(c: string) {
        if (c.length > CELICA) throw new Napaka("bomba");
        if (celice.length >= CELIC) throw new Napaka("bomba");
        // Steje se izrisano besedilo (CodeRabbit): » | « samo med celicami, prelom samo med vrsticami.
        skupaj += c.length + (celice.length ? 3 : vrstice.length ? 1 : 0);
        celice.push(c);
        preveriRok(rok);
        if (skupaj > znakov) {
          skrajsano = true;
          throw DOVOLJ;
        }
      },
      vrstica() {
        if (celice.length) vrstice.push(celice);
        celice = [];
        preveriRok(rok);
      },
      zakljuci(delo: () => void): { vrstice: string[][]; skrajsano: boolean } {
        try {
          delo();
          if (celice.length) vrstice.push(celice);
        } catch (e) {
          if (e !== DOVOLJ) throw e;
          if (celice.length) vrstice.push(celice);
        }
        return { vrstice, skrajsano };
      },
    };
  }

  /** Deljeni nizi XLSX; niz daljsi od CELICA je null (sklic nanj je »bomba«), zbiranje se ustavi pri meji. */
  function niziXlsx(xml: string, rok: number): Array<string | null> {
    const nizi: Array<string | null> = [];
    let tren: string[] | null = null;
    let dolzina = 0;
    let vT = false;
    let rph = 0;
    prehodiXml(
      xml,
      rok,
      (o) => {
        if (o.ime === "si") {
          if (o.prazna) nizi.push("");
          else if (o.zapira) {
            nizi.push(dolzina > CELICA ? null : (tren ?? []).join(""));
            tren = null;
          } else {
            tren = [];
            dolzina = 0;
          }
        } else if (o.ime === "rPh") {
          if (!o.prazna) rph = Math.max(0, rph + (o.zapira ? -1 : 1));
        } else if (o.ime === "t" && !o.prazna) vT = !o.zapira;
      },
      (s) => {
        if (tren && vT && !rph) {
          dolzina += s.length;
          if (dolzina <= CELICA) tren.push(odkodirajXml(s));
        }
      },
    );
    return nizi;
  }

  function vrsticeXlsx(deljeni: string, listi: string[], rok = Infinity, znakov = Infinity): { vrstice: string[][]; skrajsano: boolean } {
    const nizi = niziXlsx(deljeni, rok);
    const t = tabela(znakov, rok);
    return t.zakljuci(() => {
      for (const list of listi) {
        let tip = "";
        let v = "";
        let s = "";
        let vC = false;
        let vV = false;
        let vT = false;
        prehodiXml(
          list,
          rok,
          (o) => {
            if (o.ime === "row") {
              if (o.zapira || o.prazna) t.vrstica();
            } else if (o.ime === "c") {
              if (!o.zapira) {
                tip = atribut(o.notr, "t") ?? "";
                v = "";
                s = "";
                vC = !o.prazna;
                return;
              }
              vC = false;
              if (tip === "s") {
                const niz = /^\d+$/.test(v.trim()) ? nizi[Number(v.trim())] : "";
                if (niz === null) throw new Napaka("bomba");
                t.celica(niz ?? "");
              } else if (tip === "inlineStr") t.celica(s);
              else if (tip === "str") t.celica(v);
              // Stevilke in datumi (brez t ali t="n") ostanejo zunaj: cene in kolicine niso znanje.
            } else if (vC && !o.prazna) {
              if (o.ime === "v") vV = !o.zapira;
              else if (o.ime === "t") vT = !o.zapira;
            }
          },
          (x) => {
            if (vV) v += x;
            else if (vT) s += odkodirajXml(x);
            if (v.length > CELICA || s.length > CELICA) throw new Napaka("bomba");
          },
        );
        // Vrstica brez zakljucne oznake ne prenese celic v naslednji list.
        t.vrstica();
      }
    });
  }

  /**
   * CSV (RFC 4180, locilo ; , ali tabulator po prvi vrstici, steto ZUNAJ narekovajev). UTF-8, sicer windows-1250 (slovenski Excel).
   */
  function vrsticeCsv(b: Uint8Array, znakov = Infinity, rok = Infinity): { vrstice: string[][]; skrajsano: boolean } {
    let s: string;
    try {
      s = new TextDecoder("utf-8", { fatal: true }).decode(b);
    } catch {
      s = new TextDecoder("windows-1250").decode(b);
    }
    if (s.includes("\u0000")) throw new Napaka("kodiranje");
    s = s.replace(/^﻿/, "");
    const stetje: Record<string, number> = { ";": 0, "\t": 0, ",": 0 };
    let vNar = false;
    for (let i = 0; i < s.length && i < CELICA * CELIC; i++) {
      const z = s[i];
      if (z === '"') vNar = !vNar;
      else if (!vNar && (z === "\n" || z === "\r")) break;
      else if (!vNar && z in stetje) stetje[z]++;
    }
    const locilo = [";", "\t", ","].reduce((a, c) => (stetje[c] > stetje[a] ? c : a), ",");
    const t = tabela(znakov, rok);
    return t.zakljuci(() => {
      let celica = "";
      let narekovaj = false;
      for (let i = 0; i < s.length; i++) {
        const z = s[i];
        if (narekovaj) {
          if (z === '"' && s[i + 1] === '"') (celica += '"'), i++;
          else if (z === '"') narekovaj = false;
          else celica += z;
        } else if (z === '"') narekovaj = true;
        else if (z === locilo) {
          t.celica(celica);
          celica = "";
          continue;
        } else if (z === "\n" || z === "\r") {
          if (z === "\r" && s[i + 1] === "\n") i++;
          t.celica(celica);
          t.vrstica();
          celica = "";
          continue;
        } else celica += z;
        if (celica.length > CELICA) throw new Napaka("bomba");
      }
      if (celica) t.celica(celica);
      t.vrstica();
    });
  }

  function besediloTxt(b: Uint8Array, znakov: number): string {
    let s: string;
    try {
      s = new TextDecoder("utf-8", { fatal: true }).decode(b);
    } catch {
      throw new Napaka("kodiranje");
    }
    // Nicelni bajt pomeni dvojisko datoteko s koncnico .txt.
    if (s.includes("\u0000")) throw new Napaka("kodiranje");
    return s.length > znakov ? s.slice(0, znakov + 1) : s;
  }

  function zip(bajti: Uint8Array, meje: M): IzidJedra {
    const vnosi = imenikZip(bajti, meje);
    const st: Branje = { b: bajti, meje, porabljeno: 0, rok: Date.now() + meje.casMs };
    const vnos = (ime: string) => vnosi.get(ime);
    const docx = vnos("word/document.xml");
    if (docx) return { vrsta: "docx", besedilo: besediloDocx(preberiVnos(st, docx), st.rok, meje.znakov), tabela: false, skrajsano: false };
    const odt = vnos("content.xml");
    const mime = vnos("mimetype");
    if (odt && mime && preberiVnos(st, mime).trim() === "application/vnd.oasis.opendocument.text") {
      return { vrsta: "odt", besedilo: besediloOdt(preberiVnos(st, odt), st.rok, meje.znakov), tabela: false, skrajsano: false };
    }
    const listi = [...vnosi.keys()]
      .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
      .sort((a, b) => Number(/\d+/.exec(a)?.[0]) - Number(/\d+/.exec(b)?.[0]));
    if (listi.length) {
      if (listi.length > meje.listov) throw new Napaka("bomba");
      const deljeni = vnos("xl/sharedStrings.xml");
      const nizi = deljeni ? preberiVnos(st, deljeni) : "";
      const xml: string[] = [];
      for (const l of listi) xml.push(preberiVnos(st, vnos(l)!));
      return { vrsta: "xlsx", tabela: true, ...vrsticeXlsx(nizi, xml, st.rok, meje.znakov) };
    }
    throw new Napaka("vrsta");
  }

  /**
   * PDF prek unpdf (MIT, ovoj za pdf.js Apache-2.0): lokalno, brez omrezja, brez eval. Najvec STRANI_PDF strani, besedilo do meje
   * znakov. Sken = knjiznica ne vrne nobenega besedila. Drobno besedilo (velikost pisave pod 1 pt) ni besedilo (najdba 5); barve in
   * nacina izrisa (bela pisava, Tr 3) getTextContent ne vrne - glej POROCILO (omejitev).
   */
  async function pdf(b: Uint8Array, meje: M): Promise<IzidJedra> {
    // Pravi tip knjiznice (ne rocni opis): opcije getDocumentProxy preveri tsc proti DocumentInitParameters (drugi pregled 0.2.10, tsc).
    const { getDocumentProxy } = (await naloziPdf()) as typeof import("unpdf");
    let dok;
    try {
      // isEvalSupported ni vec opcija pdf.js v unpdf 2.x (pdf.js ne uporablja eval/new Function; preizkus »pdf.js brez eval«).
      dok = await getDocumentProxy(b, { disableFontFace: true, useSystemFonts: false, stopAtErrors: false });
    } catch (e) {
      throw new Napaka((e as { name?: string })?.name === "PasswordException" ? "sifriran" : "poskodovan");
    }
    try {
      if (dok.numPages > STRANI_PDF) throw new Napaka("bomba");
      const deli: string[] = [];
      let dolzina = 0;
      for (let st = 1; st <= dok.numPages && dolzina <= meje.znakov; st++) {
        const vsebina = await (await dok.getPage(st)).getTextContent();
        const vrstice: string[] = [];
        let vrstica = "";
        let naStrani = 0;
        for (const el of vsebina.items as Array<{ str?: string; hasEOL?: boolean; transform?: number[] }>) {
          // Proracun porabljen: preostalih elementov strani ne zbiramo (CodeRabbit).
          if (dolzina + naStrani > meje.znakov) break;
          if (typeof el.str !== "string") continue;
          const t = el.transform ?? [];
          const velikost = Math.max(Math.hypot(t[0] ?? 0, t[1] ?? 0), Math.hypot(t[2] ?? 0, t[3] ?? 0));
          if (el.transform && velikost < 1) continue;
          vrstica += el.str;
          naStrani += el.str.length + (el.hasEOL ? 1 : 0);
          if (el.hasEOL) {
            vrstice.push(vrstica);
            vrstica = "";
          }
        }
        if (vrstica) vrstice.push(vrstica);
        const besedilo = vrstice.join("\n").trim();
        if (besedilo) {
          deli.push(besedilo);
          dolzina += besedilo.length + 2;
        }
      }
      // Najvec meja + 1 znak (oznaka prereza) gre iz delavca.
      const vse = deli.join("\n\n").trim().slice(0, meje.znakov + 1);
      if (!vse) throw new Napaka("pdfSken");
      return { vrsta: "pdf", besedilo: vse, tabela: false, skrajsano: false };
    } finally {
      void dok.loadingTask.destroy().catch(() => undefined);
    }
  }

  /** Celoten izvlecek (v delavcu). */
  async function izvleci(ime: string, bajti: Uint8Array, meje: M): Promise<IzidJedra> {
    const vrsta = vrstaDokumenta(ime, bajti);
    if (!vrsta) throw new Napaka("vrsta");
    if (vrsta === "pdf") return pdf(bajti, meje);
    if (vrsta === "txt") return { vrsta: "txt", besedilo: besediloTxt(bajti, meje.znakov), tabela: false, skrajsano: false };
    if (vrsta === "csv") return { vrsta: "csv", tabela: true, ...vrsticeCsv(bajti, meje.znakov, Date.now() + meje.casMs) };
    return zip(bajti, meje);
  }

  return { besediloDocx, besediloOdt, vrsticeXlsx, vrsticeCsv, izvleci };
}

/**
 * Koda otroskega procesa: jedro kot besedilo + sporocilo nazaj prek IPC ({ ok, izid } ali { ok: false, razlog }). __name: ce gradnja doda ovoj
 * imen. Otrok prejme eno nalogo in se konca.
 */
const KODA_OTROKA = `"use strict";
var __name = (f) => f;
const { inflateRawSync } = require("node:zlib");
process.once("message", (d) => {
  const jedro = (${jedroRazclembe.toString()})(inflateRawSync, () => import(d.unpdf));
  const poslji = (s) => process.send(s, () => process.exit(0));
  jedro.izvleci(d.ime, d.bajti, d.meje).then(
    (izid) => poslji({ ok: true, izid }),
    (e) =>
      poslji(
        e && typeof e.razlog === "string"
          ? { ok: false, razlog: e.razlog }
          : { ok: false, razlog: "poskodovan", opis: String((e && e.name) || "") + ": " + String((e && e.message) || "").slice(0, 160) },
      ),
  );
});`;

// V glavni niti samo neposredni klici besedilo* (brez PDF).
const jedro = jedroRazclembe(inflateRawSync, () => Promise.reject(new Error("PDF samo v delavcu")));
const RAZLOGI = new Set<string>(["vrsta", "velik", "bomba", "poskodovan", "sifriran", "cas", "prazen", "kodiranje", "pdfSken"]);

/** Napaka jedra v glavni niti postane NapakaDokumenta (klicatelji uporabljajo instanceof). */
function vGlavni<T>(delo: () => T): T {
  try {
    return delo();
  } catch (e) {
    const razlog = (e as { razlog?: unknown } | null)?.razlog;
    if (typeof razlog === "string" && RAZLOGI.has(razlog)) throw new NapakaDokumenta(razlog as RazlogDokumenta);
    throw e;
  }
}

/**
 * Vrstica tabele: vsaka celica posebej skozi pocistiPolje (kot besedilo strani): znesek ali gola stevilka pade, ostalo besedilo
 * celice (ime izdelka) ostane. Cenik ni vir znanja (AGENTS.md).
 */
function vrsticaTabele(celice: string[]): string {
  return celice
    .map((c) => pocistiPolje("znanje", c.replace(/\s+/g, " ").trim()))
    .filter(Boolean)
    .join(" | ");
}

const tabelaVBesedilo = (vrstice: string[][]) => vrstice.map(vrsticaTabele).filter(Boolean).join("\n");

/** Isto po odsekih: vsakih ~15 ms se zanka dogodkov sprosti (sprejeta tabela do meje znakov ima lahko 100 000 celic; izmerjeno 513 ms naenkrat). */
async function tabelaVBesediloPoKoscih(vrstice: string[][]): Promise<string> {
  const ven: string[] = [];
  let zacetek = Date.now();
  for (const v of vrstice) {
    const r = vrsticaTabele(v);
    if (r) ven.push(r);
    if (Date.now() - zacetek > 15) {
      await new Promise((resolve) => setImmediate(resolve));
      zacetek = Date.now();
    }
  }
  return ven.join("\n");
}

export function vrstaDokumenta(ime: string, b: Uint8Array): Vrsta | "zip" | null {
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "pdf";
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "zip";
  if (/\.csv$/i.test(ime)) return "csv";
  if (/\.(txt|md|markdown)$/i.test(ime)) return "txt";
  return null;
}

export const besediloDocx = (xml: string, rok = Infinity, znakov = Infinity): string => vGlavni(() => jedro.besediloDocx(xml, rok, znakov));
export const besediloOdt = (xml: string, rok = Infinity, znakov = Infinity): string => vGlavni(() => jedro.besediloOdt(xml, rok, znakov));
export const besediloXlsx = (deljeni: string, listi: string[], rok = Infinity, znakov = Infinity): string =>
  tabelaVBesedilo(vGlavni(() => jedro.vrsticeXlsx(deljeni, listi, rok, znakov)).vrstice);
export const besediloCsv = (b: Uint8Array, znakov = Infinity, rok = Infinity): string => tabelaVBesedilo(vGlavni(() => jedro.vrsticeCsv(b, znakov, rok)).vrstice);

/**
 * Staticno sidro za gradnjo: brez njega paket ne bi vedel, da unpdf potrebuje (delavec ga nalozi po naslovu). Klic se ne izvede.
 * NEPREVERJENO v zgrajenem paketu (POROCILO.md).
 */
export const sidroUnpdfZaGradnjo = () => import("unpdf");

/** Naslov knjiznice unpdf za delavca (eval delavec nima mape modula, zato razresi glavna nit). */
function naslovUnpdf(): string {
  try {
    return import.meta.resolve("unpdf");
  } catch {
    return "unpdf";
  }
}

/** RSS otroka nad kopico (ArrayBuffer, napihnjeni tokovi PDF niso v meji kopice): nad tem se otrok ubije kot »bomba«. */
const ZUNANJI_POMNILNIK_MB = 512;
/** RSS praznega procesa Node (izmerjeno ~45 MB) z rezervo. */
const OSNOVA_OTROKA_MB = 96;

/** Napaka otroka, ki ni razlog dokumenta (npr. pokvarjena koda v zgrajenem paketu), gre v dnevnik streznika brez vsebine dokumenta. */
function zabeleziNapakoDelavca(opis: string): void {
  console.error(`[lina] razclemba dokumenta: otrok - ${opis.slice(0, 200)}`);
}

/**
 * RSS otroka v bajtih (Linux /proc/<pid>/statm) ali null, kjer ga ni mogoce prebrati (Windows: velja samo meja kopice in izolacija procesa).
 * shortcut: stran je 4096 B (amd64); na sistemih z vecjimi stranmi je straza ohlapnejsa, ne strozja.
 */
function rssOtroka(pid: number | undefined): number | null {
  if (!pid) return null;
  try {
    const strani = Number(readFileSync(`/proc/${pid}/statm`, "utf8").split(" ")[1]);
    return Number.isFinite(strani) ? strani * 4096 : null;
  } catch {
    return null;
  }
}

/** Najvec ena razclemba hkrati (N11): vec socasnih nalaganj ne zazene vec otrok z do 1 GB vsak; naslednje caka v vrsti. */
let vrstaRazclemb: Promise<unknown> = Promise.resolve();
let aktivnih = 0;
/** Stevilo otrok, ki prav zdaj razclenjujejo (preizkusi). */
export const aktivneRazclembe = (): number => aktivnih;

function vDelavcu(ime: string, bajti: Uint8Array, meje: Meje): Promise<IzidJedra> {
  const delo = async () => {
    aktivnih++;
    try {
      return await vOtroku(ime, bajti, meje);
    } finally {
      aktivnih--;
    }
  };
  const zdaj = vrstaRazclemb.then(delo, delo);
  vrstaRazclemb = zdaj.catch(() => undefined);
  return zdaj;
}

/** Razclemba v otroskem procesu: konca se natanko enkrat (sporocilo, napaka, izhod, rok ali pomnilnik). Brez rezerve v glavni niti. */
function vOtroku(ime: string, bajti: Uint8Array, meje: Meje): Promise<IzidJedra> {
  if (!(meje.casMs > 0)) return Promise.reject(new NapakaDokumenta("cas"));
  return new Promise((resolve, reject) => {
    const pomnilnikMb = meje.pomnilnikMb ?? 512;
    let otrok: ChildProcess;
    try {
      otrok = spawn(process.execPath, [`--max-old-space-size=${pomnilnikMb}`, "-e", KODA_OTROKA], {
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        serialization: "advanced",
        // Brez okolja streznika (kljuci, zetoni); ELECTRON_RUN_AS_NODE: v namestitvi je izvrsljivi Electron (kot openline-zagon).
        env: { ELECTRON_RUN_AS_NODE: "1", ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
        windowsHide: true,
      });
    } catch {
      reject(new NapakaDokumenta("poskodovan"));
      return;
    }
    let napake = "";
    otrok.stderr?.on("data", (b: Buffer) => {
      if (napake.length < 4000) napake += b.toString("utf8");
    });
    let koncano = false;
    const zakljuci = (napaka: NapakaDokumenta | null, izid?: IzidJedra) => {
      if (koncano) return;
      koncano = true;
      clearTimeout(rok);
      clearInterval(pomnilnik);
      if (otrok.exitCode === null && otrok.signalCode === null) otrok.kill("SIGKILL");
      if (napaka) reject(napaka);
      else resolve(izid!);
    };
    const rok = setTimeout(() => zakljuci(new NapakaDokumenta("cas")), meje.casMs);
    const meja = (pomnilnikMb + (meje.zunanjiMb ?? ZUNANJI_POMNILNIK_MB) + OSNOVA_OTROKA_MB) * 1024 * 1024;
    const pomnilnik = setInterval(() => {
      const rss = rssOtroka(otrok.pid);
      if (rss !== null && rss > meja) zakljuci(new NapakaDokumenta("bomba"));
    }, 50);
    otrok.on("message", (s: { ok: boolean; izid?: IzidJedra; razlog?: string; opis?: string }) => {
      if (s.opis) zabeleziNapakoDelavca(s.opis);
      if (s.ok) zakljuci(null, s.izid);
      else zakljuci(new NapakaDokumenta(RAZLOGI.has(s.razlog ?? "") ? (s.razlog as RazlogDokumenta) : "poskodovan"));
    });
    otrok.on("error", (e: NodeJS.ErrnoException) => {
      zabeleziNapakoDelavca(`${e?.name ?? ""}: ${e?.message ?? ""}`);
      zakljuci(new NapakaDokumenta("poskodovan"));
    });
    // »close« (ne »exit«): sporocilo IPC in stderr sta takrat ze prebrana, zato uspeh ne postane »poskodovan«.
    otrok.on("close", (koda, signal) => {
      // Preseganje kopice: V8 izpise »heap out of memory« in se ustavi (SIGABRT); to je »bomba«, streznik zivi.
      if (/heap out of memory|Allocation failed/i.test(napake) || signal === "SIGABRT") return zakljuci(new NapakaDokumenta("bomba"));
      if (!koncano) zabeleziNapakoDelavca(`izhod ${koda ?? signal}: ${napake.slice(0, 160)}`);
      zakljuci(new NapakaDokumenta("poskodovan"));
    });
    otrok.send({ ime, bajti, meje: { ...meje }, unpdf: naslovUnpdf() }, (e) => {
      if (e) zakljuci(new NapakaDokumenta("poskodovan"));
    });
  });
}

/** Izid otroka brez obdelave v glavni niti (preizkusi: koliko besedila otrok poslje). */
export function surovIzvlecek(ime: string, bajti: Uint8Array, meje: Meje = MEJE_DOKUMENTA): Promise<IzidJedra> {
  return vDelavcu(ime, bajti, meje);
}

export async function izvleciBesedilo(ime: string, bajti: Uint8Array, meje: Meje = MEJE_DOKUMENTA): Promise<Izvlecek> {
  if (bajti.byteLength > meje.bajtov) throw new NapakaDokumenta("velik");
  if (!vrstaDokumenta(ime, bajti)) throw new NapakaDokumenta("vrsta");
  const izid = await vDelavcu(ime, bajti, meje);
  const besedilo = izid.vrstice ? await tabelaVBesediloPoKoscih(izid.vrstice) : (izid.besedilo ?? "");
  const vrsta = izid.vrsta;
  // Vec od meje znanja ne gre v znanje; prerez je oznacen, da ga vmesnik pove.
  if (besedilo.length <= meje.znakov && !izid.skrajsano) return { vrsta, besedilo, tabela: izid.tabela, skrajsano: false };
  return { vrsta, besedilo: besedilo.slice(0, meje.znakov), tabela: izid.tabela, skrajsano: true };
}
