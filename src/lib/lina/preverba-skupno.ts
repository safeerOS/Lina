/** Skupno za preverbo najdb H in I (lina-pregled-hi-preverba). Brez omrezja, izmisljene stevilke, vse v mktemp mapi. */
import { createHmac } from "node:crypto";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setupOwner } from "./auth.server.ts";
import { formaCatalog } from "./catalog.ts";
import { savePravila } from "./pravila.server.ts";
import { publishLine } from "./service.server.ts";
import { handleVoiceRequest } from "./voice.server.ts";

process.env.LINA_LLM = "0";

export const KOREN = mkdtempSync(path.join(tmpdir(), "lina-hi-t-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));

const DNEVNIK = process.env.HI_DNEVNIK ?? "";
/** Izmerjena vrstica dokaza: gre na standardni izhod in v dnevnik (HI_DNEVNIK), ce je nastavljen. */
export function dokaz(vrstica: string): void {
  process.stdout.write(`DOKAZ ${vrstica}\n`);
  if (DNEVNIK) appendFileSync(DNEVNIK, `${vrstica}\n`);
}

export async function linija(pravila: Record<string, unknown> = { prevzem: "vsi" }): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  const token = await setupOwner("geslo-test-1234", dir);
  await publishLine({ open: true, brezGlasu: true, catalog: formaCatalog() }, { token }, dir);
  await savePravila({ dovoljenePredpone: "1", ...pravila } as never, token, dir);
  return { dir, token };
}

/** Podpisana zahteva Twilio (kot v obstojecih preizkusih): token samo v procesu preizkusa. */
export async function voice(dir: string, params: Record<string, string>, pot: string, now?: Date): Promise<string> {
  const skrivnost = "twilio-zeton-preizkusa";
  process.env.TWILIO_AUTH_TOKEN = skrivnost;
  const url = `https://lina.primer${pot}`;
  const podpisano = Object.keys(params).sort().reduce((acc, kljuc) => acc + kljuc + params[kljuc], url);
  const podpis = createHmac("sha1", skrivnost).update(podpisano).digest("base64");
  const odgovor = await handleVoiceRequest(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": podpis },
      body: new URLSearchParams(params).toString(),
    }),
    dir,
    now,
  );
  return odgovor.text();
}

export const ms = (t0: bigint): number => Number(process.hrtime.bigint() - t0) / 1e6;
export const OD = "+38640000000";
