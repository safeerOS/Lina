import { requireOwner } from "./auth.server.ts";
import { odsifrirajSkrivnost, sifrirajSkrivnost } from "./keys.server.ts";
import { glava, preberi, type ZahtevaTwilio, zahtevaTwilio } from "./twilio-racun.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

/**
 * Podpis klicev z lastnim SharedKey (lastnik 12. 11. 2026: dovolj je API kljuc, Auth Tokena ne zahtevamo). Pravilo velja SAMO za
 * naslove Line (PREFIX_MATCH), ne za vse klice racuna, da ne pokvari drugih uporabnikovih aplikacij na istem racunu.
 * NEPREVERJENO z pravim Twilio: oblika odgovora Setting in Rule ter potek operacije nista v dokumentaciji; napaka pri
 * kateremkoli koraku vrne razlago in se nic ne shrani kot uspeh.
 */
const DATOTEKA = "twilio-podpis.json";
const WEBHOOKS = "https://webhooks.twilio.com/v1/Webhooks/";

type ShranjenKljuc = { kljucId: string; iv: string; tag: string; ciphertext: string; prefiks: string };

export async function sharedKeyLine(dir?: string): Promise<{ kljucId: string; skrivnost: string; prefiks: string } | null> {
  const root = resolveDataDir(dir);
  const f = await readJsonFile<ShranjenKljuc>(root, DATOTEKA);
  if (!f?.kljucId) return null;
  const skrivnost = await odsifrirajSkrivnost(f, root);
  return skrivnost ? { kljucId: f.kljucId, skrivnost, prefiks: f.prefiks } : null;
}

function poljeId(json: unknown, imena: string[]): string {
  if (json && typeof json === "object") {
    for (const ime of imena) {
      const v = (json as Record<string, unknown>)[ime];
      if (typeof v === "string" && v) return v;
    }
  }
  return "";
}

/** Ustvari SharedKey, nastavitev in pravilo za prefiks Line. Prefiks mora biti https. Vrne id kljuca (skrivnosti ne). */
export async function vklopiPodpisSharedKey(
  token: string | null,
  prefiks: string,
  dir?: string,
  zahteva: ZahtevaTwilio = zahtevaTwilio,
): Promise<{ kljucId: string }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[^\s]*)?$/i.test(prefiks)) throw new Error("Javni naslov Line mora biti https.");
  const r = await preberi(root);
  if (!r) throw new Error("Twilio ni povezan.");
  const g = { ...glava(r.sid, r.kljucSid, r.skrivnost), "Content-Type": "application/json" };
  const json = (telo: unknown): string => JSON.stringify(telo);

  const k = await zahteva(`${WEBHOOKS}SharedKeys`, { method: "POST", headers: g, body: json({ friendlyName: "Lina" }) });
  const kljucId = poljeId(k.json, ["id"]);
  const skrivnost = poljeId(k.json, ["secret"]);
  if (k.status !== 201 || !kljucId || !skrivnost) throw new Error("Twilio ni ustvaril kljuca za podpis.");

  const nastavitev = await zahteva(`${WEBHOOKS}Settings`, {
    method: "POST",
    headers: g,
    body: json({
      friendlyName: "Lina",
      auth: { source: "INLINE", value: { scheme: "NONE" } },
      signature: { type: "SHARED_KEY", sharedKeyId: kljucId, algorithm: "HMAC_SHA256" },
    }),
  });
  const settingId = poljeId(nastavitev.json, ["id", "settingId", "setting_id"]);
  if (nastavitev.status !== 201 && nastavitev.status !== 200) throw new Error("Twilio ni ustvaril nastavitve podpisa.");
  if (!settingId) throw new Error("Twilio ni vrnil oznake nastavitve podpisa.");

  const pravilo = await zahteva(`${WEBHOOKS}Rules`, {
    method: "POST",
    headers: g,
    body: json({ matchType: "PREFIX_MATCH", prefix: prefiks, settings: [{ settingId, percentage: 100 }] }),
  });
  if (pravilo.status !== 202 && pravilo.status !== 201 && pravilo.status !== 200) throw new Error("Twilio ni ustvaril pravila podpisa.");

  const sifra = await sifrirajSkrivnost(skrivnost, root);
  await writeJson(root, DATOTEKA, { kljucId, ...sifra, prefiks } satisfies ShranjenKljuc);
  return { kljucId };
}

/** Pozabi lokalni kljuc podpisa (pravilo na Twilio ostane, dokler ga uporabnik ne odstrani; brez kljuca Lina klice zavrne). */
export async function pozabiPodpisSharedKey(token: string | null, dir?: string): Promise<void> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const { rm } = await import("node:fs/promises");
  const path = await import("node:path");
  await rm(path.join(root, DATOTEKA), { force: true });
}
