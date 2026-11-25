/**
 * Priprava glasu ob zagonu programa. Vticnik streznika (server/plugins/lina-zagon.ts) tece v drugem svezenju kode
 * kot obdelava zahtev in ima zato svoje kopije stanja v pomnilniku; ce bi glas pripravil sam, bi prvi klic pognal
 * drugo pripravo. Vticnik zato poslje eno notranjo zahtevo sem, da priprava tece v ISTI kopiji kot klici.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { registrirajVezoKlicev, uskladiAsistenta } from "./asistent-telefon.server.ts";
// locen uvoz: preizkus naloga-veza-openline zaklepa zgornjo vrstico dobesedno
import { registrirajRele } from "./asistent-telefon.server.ts";
import { zazeniAvtonomijo } from "./avtonomija-izvedba.server.ts";
import { zazeniRazporejevalnik } from "./claude-naloge.server.ts";
import { uskladiGlasTelefona } from "./glas-telefon.server.ts";
import { registrirajPrikljucekTelefona } from "./live/telefon-zagon.server.ts";
import { ustvariVezoKlicev } from "./openline-veza.server.ts";
import { loadPravila } from "./pravila.server.ts";
import { uskladiRsdo } from "./rsdo-streznik.server.ts";
import { pripraviGlasObZagonu, type StanjeZagona } from "./service.server.ts";
import { uskladiSamodejniZagon } from "./samodejni-zagon.server.ts";
import { resolveDataDir } from "./store.server.ts";

const KLJUC = Symbol.for("lina.zagon.zeton");
export const GLAVA_ZAGONA = "x-lina-zagon";
export const POT_ZAGONA = "/api/zagon";

type Globalno = { [KLJUC]?: string };

/** Enkratni zeton zagona v pomnilniku procesa (globalThis je skupen obema svezenjema). Nikoli na disk ali v dnevnik. */
export function novZetonZagona(): string {
  const zeton = randomBytes(32).toString("hex");
  (globalThis as Globalno)[KLJUC] = zeton;
  return zeton;
}

function porabiZeton(dan: string): boolean {
  const shranjen = (globalThis as Globalno)[KLJUC];
  if (!shranjen || dan.length !== shranjen.length) return false;
  if (!timingSafeEqual(Buffer.from(dan), Buffer.from(shranjen))) return false;
  // En zagon, ena zahteva: ponovitev ali ugibanje od zunaj nima vec cesa zadeti.
  delete (globalThis as Globalno)[KLJUC];
  return true;
}

/**
 * Notranja zahteva zagona. Brez veljavnega enkratnega zetona 403 - pot je sicer dosegljiva vsakomur, ki doseze
 * streznik, zato brez zetona ne naredi nicesar. Odgovor pove samo stanje linije.
 */
export async function handleZagonRequest(request: Request, dir?: string): Promise<Response> {
  const glave = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" };
  if (request.method !== "POST" || !porabiZeton(request.headers.get(GLAVA_ZAGONA) ?? "")) {
    return new Response("Prepovedano", { status: 403, headers: glave });
  }
  const stanje: StanjeZagona = await pripraviGlasObZagonu(dir);
  // pot klicev (OpenLine) za telefon asistentke: ob vklopu telefona se zazene sama (#17, uporabnik ne vpise nic); vezava sama nic ne vklopi
  registrirajVezoKlicev(ustvariVezoKlicev());
  registrirajRele({}); // Global Link do pravega releja samo v tekocem programu, nikoli v preizkusih
  // vnaprej dodeljene naloge agentov (24. 11. 2026): casovnik razporejevalnika; zamujene ob zagonu se NE zazenejo (»zamujeno, potrdi«)
  zazeniRazporejevalnik(dir);
  // telefon za asistentko: zazene se samo, ce ga je lastnik vklopil (privzeto izklopljeno); napaka ne podre zagona glasu
  await uskladiAsistenta(dir).catch(() => undefined);
  // priklop mosta Live (L3) za ta streznik; sam nic ne vklopi, brez vklopljenega stikala pot telefona ne tece
  registrirajPrikljucekTelefona(dir);
  // glas telefona (/api/voice/telefon, L2): zazene se samo, ce ga je lastnik vklopil (privzeto izklopljeno)
  await uskladiGlasTelefona(dir).catch(() => undefined);
  // slovenski model RSDO: ce je stikalo vklopljeno, se nalozi v ozadju (zagona ne zadrzi)
  void loadPravila(dir)
    .then((p) => (p.dodatki?.slovenski === true ? uskladiRsdo(true) : undefined))
    .catch(() => undefined);
  // urnik samostojnih opravil (pravila avtonomije): sam nic ne vklopi; brez vklopljenih pravil obhod ne naredi nicesar
  zazeniAvtonomijo(resolveDataDir(dir));
  // zagon ob prijavi (naloga 21): privzeto vklopljen; vnos XDG zapise samo streznik, ki ga je zagnala lupina; napaka ne podre zagona
  await uskladiSamodejniZagon(dir).catch(() => undefined);
  return new Response(stanje, { status: 200, headers: glave });
}
