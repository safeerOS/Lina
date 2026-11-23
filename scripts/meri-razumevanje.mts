// Meritev zakasnitve Gemini modelov za kratko klasifikacijo izreka (osebna tajnica). Zagon:
// LINA_DATA=<mapa> node --experimental-strip-types scripts/meri-razumevanje.mts
// Izpise samo ms in vrsto; vsebine klicev ne. Spostuje 429 (preskoci model).
import { activeBrain } from "../src/lib/lina/keys.server.ts";
import { callProvider } from "../src/lib/lina/providers.ts";

const dir = process.env.LINA_DATA;
const brain0 = await activeBrain(dir);
const brain = brain0 && process.env.LOKACIJA ? { ...brain0, location: process.env.LOKACIJA } : brain0;
if (!brain) {
  console.log("brez prijave");
  process.exit(0);
}
const sistem =
  "Razvrsti izrek klicatelja pri osebni telefonski tajnici. Odgovori SAMO z JSON: " +
  '{"vrsta":"sporocilo|pozdrav|vprasanje|nedokoncano|nerazumljivo","sporocilo":"ocisceno dobesedno besedilo brez izmisljevanja","ime":"ime ali prazno"}.';
const izreki = ["dober dan", "tukaj Ana, klicem iz podjetja in da jo lepo pozdravim", "prosim povejte da pridem v ponedeljek ob", "kakšne izdelke imate", "povejte mate"];
const modeli = (process.env.MODELI ?? "gemini-2.5-flash-lite,gemini-2.5-flash,gemini-3-flash-preview").split(",");
for (const model of modeli) {
  const ms: number[] = [];
  const vrste: string[] = [];
  let napake = 0;
  for (const izrek of izreki) {
    const t0 = performance.now();
    const r = await callProvider({ ...brain, model, text: `Lina je rekla: Katero sporočilo želite pustiti?\nKlicatelj: ${izrek}`, system: sistem, maxTokens: 120, timeoutMs: 6000 });
    const d = Math.round(performance.now() - t0);
    if (r.ok) {
      ms.push(d);
      vrste.push(/"vrsta"\s*:\s*"(\w+)"/.exec(r.text)?.[1] ?? "?");
    } else {
      napake += 1;
      console.log(model, "napaka", r.sporocilo.slice(0, 60));
      if (/429/.test(r.sporocilo)) break;
    }
  }
  console.log(model, "ms", JSON.stringify(ms), "vrste", vrste.join(","), "napak", napake);
}
