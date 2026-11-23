/**
 * Pravi priklop poti telefona (L3): prilagodilnik (telefon-prikljucek.ts) z resnicnimi odvisnostmi mosta (zeton procesa ni
 * potreben, Live prek Vertex, stalni posnetki Line, zapis klica v knjigi, zasedenost linije kot pri poti Twilio).
 * Registracija sama NIC ne vklopi: streznik poti /api/voice/telefon tece samo, ce je lastnik vklopil stikalo (privzeto
 * izklopljeno; neodvisni varnostni pregled pred vklopom se ni opravljen), brez priklopa povezava dobi 503.
 * Varovalke kot pot Twilio (L-04): linija odprta, nacin prevzema in ura, »en klic naenkrat« (sprejemKlicaTelefona).
 */
import { nastaviPrikljucekTelefona } from "../glas-telefon.server.ts";
import { loadPravila } from "../pravila.server.ts";
import { loadLine } from "../service.server.ts";
import { resolveDataDir } from "../store.server.ts";
import { odlocitevLinije } from "../ure.ts";
import { osveziAktivniKlic, prevzemiLinijo, sprostiAktivniKlic } from "../voice.server.ts";
import { prikljucekZaMost } from "./telefon-prikljucek.ts";
import { posnetekPcm16 } from "./posnetek.server.ts";
import { pravaOdvisnost } from "./vstop.server.ts";

export type IzidSprejema = "zaprto" | "prevzem" | "zasedeno";

/**
 * Ali Lina klic telefona sprejme: null = da (linija je zasedena za ta sid), sicer razlog. Enaki pogoji kot pri Twiliu:
 * line.open; odlocitevLinije (nacin prevzema in ura; telefon je klic ze preusmeril, zato je cakanje zvonjenja izpolnjeno);
 * zasedenost (en klic naenkrat, skupaj s potjo Twilio). Nastavitev naPot tu NE velja: stikalo glasu telefona je locena odlocitev lastnika.
 */
export async function sprejemKlicaTelefona(root: string, sid: string, zdaj: () => Date = () => new Date()): Promise<IzidSprejema | null> {
  const [line, pravila] = await Promise.all([loadLine(root), loadPravila(root)]);
  if (!line.open) return "zaprto";
  const odlocitev = odlocitevLinije({
    nacin: pravila.prevzem, cakanjeSekund: pravila.cakanjeSekund, zvonjenjeSekund: pravila.cakanjeSekund, now: zdaj(), hours: line.catalog.company.hours,
  });
  if (odlocitev !== "lina") return "prevzem";
  return (await prevzemiLinijo(root, sid)) ? null : "zasedeno";
}

export function registrirajPrikljucekTelefona(dir?: string): void {
  const root = resolveDataDir(dir);
  const dnevnik = (koda: string) => console.info(`[lina] glas telefona: ${koda}`);
  nastaviPrikljucekTelefona(prikljucekZaMost({
    odvisnosti: () => pravaOdvisnost(root, { osvezi: (sid) => osveziAktivniKlic(root, sid), sprosti: (sid) => sprostiAktivniKlic(root, sid) }, dnevnik),
    posnetekPcm16: posnetekPcm16(root),
    dnevnik,
    sprejem: (sid) => sprejemKlicaTelefona(root, sid),
    sprosti: (sid) => sprostiAktivniKlic(root, sid),
  }));
}
