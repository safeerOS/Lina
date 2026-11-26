// Naloga 32: preverba privzetih javnih virov novic po PRAVI poti Line (preberiVir: samo https 443, javni IP, 1 MB, 8 s, 3 preusmeritve,
// znacke feeda). Zagon (testni PC, omrezje): node --experimental-strip-types scripts/preveri-privzete-novice.mts
// Izpise za vsak vir: OK <ime> <stevilo postavk> <najnovejsi cas> ali NAPAKA <ime> <koda>. Izhod 0 samo, ce vsi viri delujejo.
import { preberiVir } from "../src/lib/lina/novice.server.ts";
import { PRIVZETI_VIRI_NOVIC } from "../src/lib/lina/novice-pogovor.ts";
import { poveziHttps, razresiDns } from "../src/lib/lina/splet.server.ts";

let napak = 0;
for (const v of PRIVZETI_VIRI_NOVIC) {
  try {
    const p = await preberiVir(v, { razresi: razresiDns, povezava: poveziHttps }, new Date());
    const cas = p.map((x) => x.cas ?? "").sort().pop() || "brez casa";
    console.log(`${p.length ? "OK" : "PRAZNO"} ${v.ime} ${v.vnos} postavk=${p.length} najnovejsa=${cas}${p[0] ? ` prva="${p[0].naslov.slice(0, 80)}"` : ""}`);
    if (!p.length) napak++;
  } catch (e) {
    napak++;
    console.log(`NAPAKA ${v.ime} ${v.vnos} ${(e as { koda?: string; status?: number }).koda ?? String(e)}${(e as { status?: number }).status ? ` status=${(e as { status?: number }).status}` : ""}`);
  }
}
console.log(`KONEC ${napak}`);
process.exit(napak ? 1 : 0);
