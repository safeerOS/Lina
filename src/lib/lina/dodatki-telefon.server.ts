/**
 * Dodatki na racunalniku za telefon ozjega kroga (lastnik 23. 11. 2026: »ali lina preko telefona ze zna upravljati dodatke, ki so na
 * racunalniku? ce ne, ji prosim to omogoci«). Stanje je isto kot v namiznih Dodatkih (stanjeDodatkovFn), preklop gre skozi isti potek
 * kot shranjevanje nastavitev (pravila.server.ts nastaviDodatekIzTelefona). Branje stanja nicesar ne zazene in ne namesti.
 */
import { stanjaDodatkov, type Izvajalec, type StanjeDodatka } from "./dodatki.server.ts";
import { DODATKI_TELEFONA, type DodatekTelefona } from "./kanal-claude.ts";
import { loadPravila, nastaviDodatekIzTelefona, type UskladitevDodatkov } from "./pravila.server.ts";
import { stanjeRsdo } from "./rsdo-streznik.server.ts";
import { stanjeNamestitveSlovenskega } from "./slovenski-modul.server.ts";
import { resolveDataDir } from "./store.server.ts";

/** Stanje slovenskega modela v obliki ostalih dodatkov; neuspela namestitev je vidna (pregled 029, najdba 12). */
export function stanjeSlovenskega(): { stanje: StanjeDodatka; razlog: string } {
  const rsdo = stanjeRsdo();
  const stanje = ({ izklopljen: "izklopljen", nalaga: "se_zaganja", pripravljen: "deluje", napaka: "napaka" } as const)[rsdo.stanje];
  const razlog = rsdo.razlog === "ni-namescen" && stanjeNamestitveSlovenskega() === "napaka" ? "namestitev-ni-uspela" : (rsdo.razlog ?? "");
  return { stanje, razlog };
}

export type DodatekZaTelefon = { id: DodatekTelefona; vklopljen: boolean; stanje: StanjeDodatka; razlog: string };

/** Za preizkuse: Docker in slovenski model brez pravih procesov. */
export type OdvisnostiDodatkov = { docker?: Izvajalec; slovenski?: () => { stanje: StanjeDodatka; razlog: string }; uskladitev?: UskladitevDodatkov };

/** Stikalo (kar je shranjeno) in dejansko stanje vsakega dodatka; samo branje. */
export async function stanjeDodatkovZaTelefon(dir?: string, o: OdvisnostiDodatkov = {}): Promise<{ dodatki: DodatekZaTelefon[] }> {
  const root = resolveDataDir(dir);
  const p = await loadPravila(root).catch(() => null);
  const docker = await stanjaDodatkov(o.docker);
  const slo = (o.slovenski ?? stanjeSlovenskega)();
  return {
    dodatki: DODATKI_TELEFONA.map((id) => ({
      id,
      vklopljen: p?.dodatki?.[id] === true,
      stanje: id === "slovenski" ? slo.stanje : docker[id],
      razlog: id === "slovenski" ? slo.razlog : "",
    })),
  };
}

/** Preklop enega dodatka; vrne novo stanje (zagon tece v ozadju, zato je takoj po vklopu obicajno »se_zaganja« ali se »izklopljen«). */
export async function nastaviDodatekZaTelefon(dodatek: DodatekTelefona, vklop: boolean, dir?: string, o: OdvisnostiDodatkov = {}): Promise<{ dodatki: DodatekZaTelefon[] }> {
  await nastaviDodatekIzTelefona(dodatek, vklop, dir, o.uskladitev);
  return stanjeDodatkovZaTelefon(dir, o);
}

/** Kratko besedilo za Claude Code (orodje dodatki): stikalo in dejansko stanje vsakega dodatka. */
export function opisStanjaDodatkov(s: { dodatki: DodatekZaTelefon[] }): string {
  return s.dodatki.map((d) => `${d.id}: stikalo ${d.vklopljen ? "vklopljeno" : "izklopljeno"}, stanje ${d.stanje}${d.razlog ? ` (${d.razlog})` : ""}`).join("\n");
}
