/**
 * Oddaljeni prehod (F5, lastnik 18. 11. 2026; nacrt nacrti/lina-ukaz-prek-global-linka.md, DOPOLNILO 12:40): zahteva, ki jo
 * transport Global Linka (neposredno ali rele) prinese s telefona zunaj doma, gre na strezniek asistentke SAMO prek tega
 * prehoda. Streznik ostane na 127.0.0.1 ali zasebnem naslovu (javne izpostavitve ni); prehod:
 *  - je privzeto IZKLOPLJEN (vklop samo z lastnikovo nastavitvijo; pred vklopom neodvisni varnostni pregled);
 *  - prepusti samo BELI SEZNAM poti (naloga, odobritev, ustavi, dogodki, stanje); seznanjanje (/seznani, /koda/*) nikoli;
 *  - omeji zahteve PO VIRU (vir = overjena seja transporta ali naslov odjemalca na relu), ne po naslovu 127.0.0.1, sicer bi
 *    ena naprava ali napadalec izpraznil kvoto vseh;
 *  - posreduje samo prek TLS s pripetim odtisom Lininega potrdila (prehod in streznik tecejo v istem procesu);
 *  - ne odloca o zaupanju: podpis naprave, okno casa in enkratni niz preveri streznik kot pri domaci povezavi.
 */
import { timingSafeEqual } from "node:crypto";
import { request } from "node:https";
import {
  GLAVA_PREHOD, GLAVA_VIR, NAJVEC_ODGOVOR_DOGODKOV_B, NAJVEC_TELO, NAJVEC_ZAHTEV_NA_MINUTO, POTI_ODDALJENO, VIR_PREHODA,
} from "./asistent-streznik.server.ts";

export const NAJVEC_HKRATI_PREHOD = 24;
export const NAJVEC_HKRATI_NA_VIR = 3;
export const NAJDLJA_POT_PREHOD = 2048;
/** Najdlje caka na odgovor streznika (dolgo poizvedovanje dogodkov do 25 s + rezerva). */
export const ROK_PREHODA_MS = 35_000;

export type ZahtevaPrehoda = { metoda: string; pot: string; telo?: Buffer; vir: string };
export type OdgovorPrehoda = { status: number; telo: Buffer; tip: string };
export type CiljPrehoda = { naslov: string; vrata: number; cert: string; odtis: string; zeton: string };
export type MoznostiPrehoda = {
  /** Privzeto false: prehod ne posreduje nicesar in ne dotakne streznika. */
  vklopljeno?: boolean;
  /** Naslov in zeton streznika (AsistentStreznik.ciljPrehoda()); poklican samo ob posredovanju. */
  cilj: () => CiljPrehoda;
  zdaj?: () => number;
};

const napaka = (status: number, koda: string, sporocilo: string): OdgovorPrehoda =>
  ({ status, telo: Buffer.from(JSON.stringify({ napaka: koda, sporocilo })), tip: "application/json; charset=utf-8" });

export class OddaljeniPrehod {
  private readonly m: MoznostiPrehoda;
  private readonly zdaj: () => number;
  private readonly zahteve = new Map<string, number[]>();
  private readonly hkrati = new Map<string, number>();
  private skupaj = 0;

  constructor(m: MoznostiPrehoda) {
    this.m = m;
    this.zdaj = m.zdaj ?? Date.now;
  }

  get vklopljen(): boolean {
    return this.m.vklopljeno === true;
  }

  async posreduj(z: ZahtevaPrehoda): Promise<OdgovorPrehoda> {
    if (!this.vklopljen) return napaka(503, "izklopljeno", "Oddaljena pot do Line je izklopljena.");
    if (typeof z.vir !== "string" || !VIR_PREHODA.test(z.vir)) return napaka(400, "oblika", "Neveljaven vir.");
    const pot = this.preveriPot(z.metoda, z.pot);
    if (typeof pot === "object") return pot;
    if (z.telo && z.telo.length > NAJVEC_TELO) return napaka(413, "prevelik", "Telo je preveliko.");
    if (z.metoda === "POST" && !z.telo) return napaka(400, "oblika", "Manjka telo.");
    if (!this.vrsta(z.vir)) return napaka(429, "prevec", "Prevec zahtev.");
    this.skupaj++;
    this.hkrati.set(z.vir, (this.hkrati.get(z.vir) ?? 0) + 1);
    try {
      return await this.poslji(z, pot);
    } finally {
      this.skupaj--;
      const n = (this.hkrati.get(z.vir) ?? 1) - 1;
      if (n <= 0) this.hkrati.delete(z.vir); else this.hkrati.set(z.vir, n);
    }
  }

  /** Samo natancna pot iz belega seznama z ustrezno metodo; kodirani znaki, »..«, poseve crte in nadzorni znaki so zavrnjeni. */
  private preveriPot(metoda: string, pot: string): string | OdgovorPrehoda {
    if (typeof pot !== "string" || pot.length > NAJDLJA_POT_PREHOD || !pot.startsWith("/") || pot.startsWith("//") || /[\\\u0000- \u007f-\u009f#]/.test(pot)) {
      return napaka(400, "oblika", "Neveljavna pot.");
    }
    const q = pot.indexOf("?");
    const ime = q < 0 ? pot : pot.slice(0, q);
    if (ime.includes("%") || ime.includes("..") || POTI_ODDALJENO.get(ime) !== metoda) {
      return napaka(403, "zavrnjeno", "Pot ni dovoljena prek oddaljene poti.");
    }
    return pot;
  }

  /** Omejitev po viru (drseče okno 60 s) in hkratnih zahtev; zavrnjena zahteva ne dobi mesta v vrsti. */
  private vrsta(vir: string): boolean {
    const t = this.zdaj();
    const s = (this.zahteve.get(vir) ?? []).filter((x) => t - x < 60_000);
    if (s.length >= NAJVEC_ZAHTEV_NA_MINUTO) { this.zahteve.set(vir, s); return false; }
    if (this.skupaj >= NAJVEC_HKRATI_PREHOD || (this.hkrati.get(vir) ?? 0) >= NAJVEC_HKRATI_NA_VIR) return false;
    s.push(t);
    this.zahteve.set(vir, s);
    if (this.zahteve.size > 2000) for (const [k, v] of this.zahteve) if (!v.some((x) => t - x < 60_000)) this.zahteve.delete(k);
    return true;
  }

  private poslji(z: ZahtevaPrehoda, pot: string): Promise<OdgovorPrehoda> {
    const c = this.m.cilj();
    const odtis = c.odtis.toLowerCase();
    return new Promise((ok) => {
      const glave: Record<string, string | number> = { [GLAVA_PREHOD]: c.zeton, [GLAVA_VIR]: z.vir };
      if (z.metoda === "POST") { glave["content-type"] = "application/json"; glave["content-length"] = z.telo!.length; }
      const r = request({
        host: c.naslov, port: c.vrata, method: z.metoda, path: pot, ca: c.cert, rejectUnauthorized: true, headers: glave, timeout: ROK_PREHODA_MS,
        // pripet odtis lista (ime gostitelja se ne gleda); primerjava v konstantnem casu
        checkServerIdentity: (_h, l) => {
          const a = Buffer.from(l.fingerprint256.replace(/:/g, "").toLowerCase());
          const b = Buffer.from(odtis);
          return a.length === b.length && timingSafeEqual(a, b) ? undefined : new Error("odtis se ne ujema");
        },
      }, (res) => {
        const kosi: Buffer[] = [];
        let n = 0;
        res.on("data", (d: Buffer) => {
          n += d.length;
          if (n > NAJVEC_ODGOVOR_DOGODKOV_B + 4096) { r.destroy(); ok(napaka(502, "odgovor", "Odgovor Line je prevelik.")); return; }
          kosi.push(d);
        });
        res.on("end", () => ok({ status: res.statusCode ?? 502, telo: Buffer.concat(kosi), tip: String(res.headers["content-type"] ?? "application/json; charset=utf-8") }));
        res.on("error", () => ok(napaka(502, "streznik-ni", "Lina ni dosegljiva.")));
      });
      r.on("timeout", () => { r.destroy(); ok(napaka(504, "cas", "Lina ni odgovorila pravocasno.")); });
      r.on("error", () => ok(napaka(502, "streznik-ni", "Lina ni dosegljiva.")));
      r.end(z.metoda === "POST" ? z.telo : undefined);
    });
  }
}
