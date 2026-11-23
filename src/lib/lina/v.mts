// Pomozni modul pregleda: klic skozi webhook (handleVoiceRequest) z laznim glasom in laznim podpisom; brez omrezja.
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
process.env.LINA_LLM = "0";
export const BAZA = process.env.BAZA ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
import { tmpdir } from "node:os";
const LASTEN_TMPD = !process.env.TMPD;
export const TMPD = process.env.TMPD ?? mkdtempSync(path.join(tmpdir(), "lina-pregled-"));
process.on("exit", () => { if (LASTEN_TMPD) rmSync(TMPD, { recursive: true, force: true }); });
export const lib = (f: string) => import(path.join(BAZA, "src/lib/lina", f));
const IZVOR = "https://lina.primer";
const SKRIVNOST = "zeton-pregleda-ni-pravi";
export const OD = process.env.OD ?? "+38640000111";
const dirs: string[] = [];
export async function linija(nacin: "osebna" | "podjetje", razumevanje?: (s: string, v: string) => Promise<string | null>, pravilaDodatno: Record<string, unknown> = {}) {
  const g = await lib("glas.server.ts");
  const { formaCatalog } = await lib("catalog.ts");
  const { defaultPravila } = await lib("pravila.server.ts");
  const { pripraviGlasObZagonu } = await lib("service.server.ts");
  const { writeJson } = await lib("store.server.ts");
  const v = await lib("voice.server.ts");
  if (!process.env.BREZ_GLASU) g.nastaviSintezoZaPreizkus(async () => Buffer.alloc(4800));
  const dir = mkdtempSync(path.join(TMPD, "v-"));
  dirs.push(dir);
  await writeJson(dir, "line.json", { open: true, catalog: formaCatalog(), updatedAt: null });
  await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi", ...(nacin === "osebna" ? { nacinKlica: "osebna", imeLastnika: "Ana" } : {}), ...pravilaDodatno });
  if (!process.env.BREZ_GLASU) { await pripraviGlasObZagonu(dir); await g.pocakajGlas(dir); }
  const moznosti = { razumevanje: razumevanje ?? (async () => null), ...(process.env.CAKAJ_MS ? { cakajMs: Number(process.env.CAKAJ_MS), cakajBrezGlasuMs: Number(process.env.CAKAJ_MS) } : {}) } as never;
  let zahtev = 0;
  const poslji = async (pot: string, params: Record<string, string>) => {
    process.env.TWILIO_AUTH_TOKEN = SKRIVNOST;
    const signed = Object.keys(params).sort().reduce((acc, key) => acc + key + params[key], `${IZVOR}${pot}`);
    const zac = performance.now();
    const odgovor = await v.handleVoiceRequest(new Request(`${IZVOR}${pot}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": createHmac("sha1", SKRIVNOST).update(signed).digest("base64") }, body: new URLSearchParams(params).toString() }), dir, undefined, moznosti);
    zahtev += 1;
    const twiml = await odgovor.text();
    return { status: odgovor.status, twiml, ms: Math.round(performance.now() - zac) };
  };
  const klic = async (sid: string) => {
    const prvi = await poslji("/api/voice/incoming", { CallSid: sid, From: OD });
    await v.pocakajOzadjeKlicev();
    // naslednji naslov (action) iz TwiML: obr in nad
    let naprej = /action="([^"]+)"/.exec(prvi.twiml)?.[1]?.replace(/&amp;/g, "&") ?? "";
    const reci = async (izrek: string) => {
      const pot = naprej ? new URL(naprej).pathname + new URL(naprej).search : "/api/voice/turn?obr=1";
      let r = await poslji(pot, { CallSid: sid, From: OD, ...(izrek ? { SpeechResult: izrek } : {}) });
      if (process.env.RAZHROSCI) console.log("TWIML", pot, r.twiml.slice(0, 400));
      // sledi Redirectom (vmesni stavek) do Gather ali Hangup
      let skokov = 0;
      while (/<Redirect/.test(r.twiml) && !/<Gather/.test(r.twiml) && skokov < 6) {
        const kam = /<Redirect[^>]*>([^<]+)<\/Redirect>/.exec(r.twiml)?.[1]?.replace(/&amp;/g, "&") ?? "";
        r = await poslji(new URL(kam).pathname + new URL(kam).search, { CallSid: sid, From: OD });
        if (process.env.RAZHROSCI) console.log("TWIML-skok", kam, r.twiml.slice(0, 400));
        skokov += 1;
      }
      await v.pocakajOzadjeKlicev();
      naprej = /action="([^"]+)"/.exec(r.twiml)?.[1]?.replace(/&amp;/g, "&") ?? naprej;
      return { ...r, naprej, tiho: /<Gather [^>]*><\/Gather>/.test(r.twiml) && !/<Play>|<Say/.test(r.twiml), hangup: /<Hangup/.test(r.twiml) };
    };
    return { prvi, reci };
  };
  const zapis = (sid: string) => (JSON.parse(readFileSync(path.join(dir, "calls.json"), "utf8")) as Record<string, any>)[sid];
  return { dir, klic, zapis, stZahtev: () => zahtev, v };
}
export async function konec() {
  const g = await lib("glas.server.ts");
  const v = await lib("voice.server.ts");
  await v.pocakajOzadjeKlicev();
  delete process.env.TWILIO_AUTH_TOKEN;
  g.nastaviSintezoZaPreizkus(null);
  g.ponastaviOdklopnik();
  v.ustaviCiscenjeOpravil();
  for (const dir of dirs) {
    await g.pocakajGlas(dir).catch(() => undefined);
    await g.pocakajDnevnikGlasu(dir).catch(() => undefined);
    g.ustaviCiscenjeZvoka(dir);
    rmSync(dir, { recursive: true, force: true });
  }
  if (LASTEN_TMPD) rmSync(TMPD, { recursive: true, force: true });
}
export function zapiski(dir: string): string[] {
  const ven: string[] = [];
  const isci = (m: string) => { for (const i of readdirSync(m, { withFileTypes: true })) { const p = path.join(m, i.name); if (i.isDirectory()) isci(p); else if (i.name.endsWith(".md")) ven.push(readFileSync(p, "utf8")); } };
  if (existsSync(dir)) isci(dir);
  return ven;
}
