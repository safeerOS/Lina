/**
 * DNS in HTTPS na tocno podan (preverjen) IP za varen prenos s spleta (splet.ts, novice). Naloga 32: loceno od splet.server.ts, ker ta
 * uvaza pot klica (service.server.ts), pot pogovora in telefona pa je ne sme doseci (kanal-claude.test.ts T1-S2). Komentarji brez sumnikov.
 */
import { lookup } from "node:dns/promises";
import https from "node:https";
import { t } from "./besedila.ts";
import { LINA_AGENT, type SpletOdgovor, type SpletZahteva } from "./splet.ts";

export async function razresiDns(gostitelj: string): Promise<string[]> {
  const zapisi = await lookup(gostitelj, { all: true, verbatim: true });
  return zapisi.map((z) => z.address);
}

/** HTTPS na tocno podan IP. SNI ostane gostitelj. Drugega DNS ni. */
export function poveziHttps(zahteva: SpletZahteva, signal: AbortSignal): Promise<SpletOdgovor> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error(t("spletRok")));
      return;
    }
    const family = zahteva.ip.includes(":") ? 6 : 4;
    const req = https.request(
      {
        host: zahteva.ip,
        servername: zahteva.gostitelj,
        port: zahteva.vrata,
        path: zahteva.pot || "/",
        method: "GET",
        family,
        headers: {
          host: zahteva.gostitelj,
          "user-agent": zahteva.agent || LINA_AGENT,
          accept: zahteva.sprejmi || "text/html, application/xhtml+xml;q=0.9",
        },
        rejectUnauthorized: true,
        timeout: zahteva.rokMs,
      },
      (res) => {
        const glave: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          glave[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v ?? "");
        }
        resolve({
          status: res.statusCode ?? 0,
          glave,
          telo: res,
          prekini: () => {
            res.destroy();
            req.destroy();
          },
        });
      },
    );
    const ustavi = () => req.destroy(new Error(t("spletRok")));
    signal.addEventListener("abort", ustavi, { once: true });
    req.on("timeout", ustavi);
    req.on("error", (error) => {
      signal.removeEventListener("abort", ustavi);
      reject(error);
    });
    req.end();
  });
}
