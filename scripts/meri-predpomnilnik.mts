// Predpomnilnik poziva (lastnik 14. 11. 2026: cim vec poziva naj pride iz predpomnilnika modela, da je obrat cenejsi in hitrejsi).
// MERITEV brez spremembe vedenja Line: zahteva je natanko taka kot v klicu (providerRequest: systemInstruction = stalno navodilo nacina s skilom,
// contents = spremenljivi vhod obrata), iz odgovora se prebere samo polje porabe (usageMetadata). Zaporedni obrati ISTEGA klica, oba nacina.
// Izreki so izmisljeni. Izpise: imena polj porabe, ki jih je odgovor res imel, zetone poziva, zetone iz predpomnilnika, delez, ms in dolzino
// skupne predpone zaporednih zahtev (znaki telesa zahteve, ki so med obratoma enaki).
// KOPIJ=n (samo meritev, Lina tega ne dela): stalnemu navodilu doda n kopij pravil skila, da poziv preseze najmanjso velikost za predpomnilnik
// (dokumentacija Vertex 14. 11. 2026: Gemini 3 praviloma 4096 zetonov, Gemini 3 Flash Preview 6144) - pove, ali bi daljsa stalna predpona sploh
// prisla iz predpomnilnika in kaj se zgodi s casom odziva.
// LOKACIJA=<regija> (samo meritev): namesto lokacije, ki jo uporablja Lina (osebna: global), da se vidi, ali je predpomnilnik odvisen od lokacije.
// Zagon (NE med klicem lastnika): LINA_DATA=<mapa> [OBRATOV=5] [PREMOR_MS=2000] [MODELI=a,b] [KOPIJ=0] [NACINI=osebna,podjetje] [LOKACIJA=]
//   node --experimental-strip-types scripts/meri-predpomnilnik.mts
import { vertexAccessToken } from "../src/lib/lina/adc.server.ts";
import { formaCatalog } from "../src/lib/lina/catalog.ts";
import { activeBrain } from "../src/lib/lina/keys.server.ts";
import { NAVODILO_OSEBNEGA, OSEBNI_MODELI, sestaviVhod } from "../src/lib/lina/osebna-razumevanje.server.ts";
import { providerRequest } from "../src/lib/lina/providers.ts";
import { navodiloRazumevanja } from "../src/lib/lina/razumevanje.server.ts";
import { PRAVILA_RAZUMEVANJA } from "../src/lib/lina/skil-lina.ts";

const b0 = await activeBrain(process.env.LINA_DATA);
if (!b0 || b0.provider !== "vertex") throw new Error("brez Vertex");
const OBRATOV = Number(process.env.OBRATOV ?? 5);
const PREMOR_MS = Number(process.env.PREMOR_MS ?? 2000);
const MODELI = (process.env.MODELI ?? OSEBNI_MODELI.join(",")).split(",").filter(Boolean);
const KOPIJ = Number(process.env.KOPIJ ?? 0);
const NACINI = (process.env.NACINI ?? "osebna,podjetje").split(",");
/** Podaljsek stalnega navodila za meritev (kopije pravil skila); prazen pri KOPIJ=0, torej zahteva natanko kot v klicu. */
const PODALJSEK = KOPIJ > 0 ? `\n\n${Array.from({ length: KOPIJ }, () => PRAVILA_RAZUMEVANJA).join("\n\n")}` : "";
const mediana = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
const premor = (ms: number) => new Promise((konec) => setTimeout(konec, ms));

type Poraba = Record<string, unknown>;
async function klic(model: string, lokacija: string, system: string, text: string): Promise<{ ms: number; status: number; poraba: Poraba; telo: string }> {
  const { url, init } = providerRequest({ ...b0!, location: lokacija, key: await vertexAccessToken(), model, text, system: `${system}${PODALJSEK}`, maxTokens: 220 });
  const t0 = performance.now();
  const odgovor = await fetch(url, init);
  const json = (await odgovor.json().catch(() => ({}))) as { usageMetadata?: Poraba };
  return { ms: Math.round(performance.now() - t0), status: odgovor.status, poraba: json.usageMetadata ?? {}, telo: String(init.body) };
}
const skupnaPredpona = (a: string, b: string): number => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
};

// Osebni nacin: en klic, 5 zaporednih obratov (sporocilo, nato vprasanja in dopolnila); vhod raste kot v klicu (zadnji izreki, zapisan izrek).
const SPOROCILO = "pozdravite jo lepo in ji povejte da pridem v ponedeljek";
const OSEBNI_IZREKI = [SPOROCILO, "ali boste to res povedali Ani", "pa naj prinese tudi mapo z dokumenti", "kdaj bo poklicala nazaj", "mhm kaj pa tisto", "ne hvala to je vse"];
const osebniObrat = (i: number): { system: string; text: string } => {
  const zapisano = i > 0;
  return {
    system: NAVODILO_OSEBNEGA,
    text: sestaviVhod(
      OSEBNI_IZREKI[i % OSEBNI_IZREKI.length] ?? "",
      i === 0 ? "Tukaj Lina, pomočnica z umetno inteligenco. Poklicali ste Ana. Kaj naj sporočim?" : "Sporočilo sem zapisala. Imate še kakšno vprašanje?",
      { imeLastnika: "Ana", stevilkaBesedno: "nič štiri ena, ena dve tri, štiri pet šest", izrek: zapisano ? SPOROCILO : "", zapisano },
      OSEBNI_IZREKI.slice(0, i),
    ),
  };
};
// Poslovni nacin: navodilo je navodiloRazumevanja(katalog, izrek) - stalni del in na koncu odseki znanja, izbrani po izreku.
const katalog = formaCatalog();
const POSLOVNI_IZREKI = ["kaj pa delate pri vas", "ali imate mize iz hrasta", "nisem razumel lahko ponovite", "kdaj ste odprti", "zanima me miza Alba", "kje ste doma"];
const poslovniObrat = (i: number): { system: string; text: string } => {
  const izrek = POSLOVNI_IZREKI[i % POSLOVNI_IZREKI.length] ?? "";
  return { system: navodiloRazumevanja(katalog, izrek), text: `Lina je rekla: Kako vam lahko pomagam?\nKlicatelj: ${izrek}` };
};

const polja = new Set<string>();
for (const [nacin, obrat, lokacija] of [
  ["osebna", osebniObrat, process.env.LOKACIJA || "global"],
  ["podjetje", poslovniObrat, process.env.LOKACIJA || (b0.location ?? "global")],
] as const) {
  if (!NACINI.includes(nacin)) continue;
  for (const model of MODELI) {
    const casi: number[] = [];
    let poziv = 0;
    let izPredpomnilnika = 0;
    let prejsnje = "";
    const vrstice: string[] = [];
    for (let i = 0; i < OBRATOV; i += 1) {
      const { system, text } = obrat(i);
      const r = await klic(model, lokacija, system, text);
      for (const k of Object.keys(r.poraba)) polja.add(k);
      const p = Number(r.poraba.promptTokenCount ?? 0);
      const c = Number(r.poraba.cachedContentTokenCount ?? 0);
      if (r.status === 200) {
        casi.push(r.ms);
        poziv += p;
        izPredpomnilnika += c;
      }
      vrstice.push(`  obrat ${i + 1}: stanje ${r.status} ${r.ms} ms, zetonov poziva ${p}, iz predpomnilnika ${c}${prejsnje ? `, skupna predpona zahteve ${skupnaPredpona(prejsnje, r.telo)} od ${r.telo.length} znakov` : ""}`);
      prejsnje = r.telo;
      await premor(PREMOR_MS);
    }
    const delez = poziv > 0 ? Math.round((1000 * izPredpomnilnika) / poziv) / 10 : 0;
    console.log(`== ${nacin} ${model} (lokacija ${lokacija}, kopij pravil ${KOPIJ}): delez iz predpomnilnika ${delez} % (${izPredpomnilnika} od ${poziv} zetonov), mediana ${mediana(casi)} ms, n=${casi.length}`);
    for (const v of vrstice) console.log(v);
  }
}
console.log(`polja usageMetadata v odgovorih: ${[...polja].sort().join(", ") || "(nobeno)"}`);
