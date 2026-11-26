// Naloga 32: preverba privzetih javnih virov novic po PRAVI poti Line (prenesiBesedilo + preberiVir: samo https 443, javni IP, 1 MB,
// 8 s, 3 preusmeritve, znacke feeda). Zagon (testni PC, omrezje, PRED gradnjo 0.2.14):
//   node --experimental-strip-types scripts/preveri-privzete-novice.mts
// Za vsak vir: OK/PRAZNO/NAPAKA, stevilo postavk, najnovejsi cas. Telefon (AndroidPrenos) NE sledi preusmeritvam in bere vedno UTF-8:
// PREUSMERITEV ali KODIRANJE != utf-8 je napaka za telefon -> koncni naslov vpisi v novice-pogovor.ts IN NoviceTelefon.kt.
// Izhod 0 samo, ce vsi viri delujejo na obeh napravah.
import { prenesiBesedilo, preberiVir } from "../src/lib/lina/novice.server.ts";
import { PRIVZETI_VIRI_NOVIC } from "../src/lib/lina/novice-pogovor.ts";
import { poveziHttps, razresiDns } from "../src/lib/lina/splet-povezava.server.ts";

const odv = { razresi: razresiDns, povezava: poveziHttps };
let napak = 0;
for (const v of PRIVZETI_VIRI_NOVIC) {
  try {
    const { besedilo, url } = await prenesiBesedilo(v.vnos, odv);
    const kodiranje = (/<\?xml[^>]*encoding=["']([^"']+)["']/i.exec(besedilo.slice(0, 300))?.[1] ?? "utf-8").toLowerCase();
    if (url !== v.vnos) {
      napak++;
      console.log(`PREUSMERITEV ${v.ime} ${v.vnos} -> ${url} (telefon preusmeritvi ne sledi)`);
    }
    if (kodiranje !== "utf-8") {
      napak++;
      console.log(`KODIRANJE ${v.ime} ${kodiranje} (telefon bere UTF-8)`);
    }
    const p = await preberiVir(v, odv, new Date());
    const cas = p.map((x) => x.cas ?? "").sort().pop() || "brez casa";
    console.log(`${p.length ? "OK" : "PRAZNO"} ${v.ime} ${url} postavk=${p.length} najnovejsa=${cas}${p[0] ? ` prva="${p[0].naslov.slice(0, 80)}"` : ""}`);
    if (!p.length) napak++;
  } catch (e) {
    napak++;
    const o = e as { koda?: string; status?: number };
    console.log(`NAPAKA ${v.ime} ${v.vnos} ${o.koda ?? String(e)}${o.status ? ` status=${o.status}` : ""}`);
  }
}
console.log(`KONEC ${napak}`);
process.exit(napak ? 1 : 0);
