// Skupna pomoc za dokazne skripte: lazna Lina na ravni TCP (zapise surove bajte vsake povezave) in posrednik iz tunel.server.ts.
// Uporaba: import { zagon, surovo } from "./pomoc.mjs"; modul tunel.server.ts naj bo v mapi, ki jo da okoljska spremenljivka KOPIJA.
import net from "node:net";
import { pathToFileURL } from "node:url";

export async function zagon(odgovorLine = "ok") {
  const kopija = process.env.KOPIJA;
  if (!kopija) throw new Error("Nastavi KOPIJA na mapo s kopijo tunel.server.ts");
  const t = await import(pathToFileURL(kopija + "/tunel.server.ts").href);
  const povezave = [];
  const lina = net.createServer((s) => {
    const zapis = { id: povezave.length + 1, raw: "", bajtov: 0 };
    povezave.push(zapis);
    let tihi;
    s.on("data", (b) => {
      zapis.raw += b.toString("latin1");
      zapis.bajtov += b.length;
      clearTimeout(tihi);
      tihi = setTimeout(() => {
        s.end(`HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ${odgovorLine.length}\r\nConnection: close\r\n\r\n${odgovorLine}`);
      }, 120);
    });
    s.on("error", () => undefined);
  });
  await new Promise((r) => lina.listen(0, "127.0.0.1", r));
  const vrataLine = lina.address().port;
  const posrednik = await t.zazeniPosrednik(vrataLine);
  const vrata = posrednik.address().port;
  return {
    t, posrednik, vrata, vrataLine, povezave,
    ustavi() {
      posrednik.close(); posrednik.closeAllConnections?.();
      lina.close(); lina.closeAllConnections?.();
    },
  };
}

/** Surov niz po TCP; vrne prejeti odgovor (latin1) ob zaprtju ali po rokMs. */
export function surovo(vrata, niz, rokMs = 500) {
  return new Promise((resolve) => {
    const s = net.connect(vrata, "127.0.0.1");
    let odg = "";
    let konec = false;
    const koncaj = () => { if (!konec) { konec = true; resolve(odg); } };
    s.on("data", (b) => (odg += b.toString("latin1")));
    s.on("error", () => undefined);
    s.on("close", koncaj);
    s.write(typeof niz === "string" ? Buffer.from(niz, "latin1") : niz);
    setTimeout(() => { s.destroy(); koncaj(); }, rokMs);
  });
}

export const kratko = (s, n = 300) => JSON.stringify(s.length > n ? s.slice(0, n) + "...[" + s.length + "]" : s);
