import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isIPv6 } from "node:net";
import { odsifrirajSkrivnost, sifrirajSkrivnost } from "./keys.server.ts";
import { izvorIzGlav, jeLokalnaZahteva } from "./origin.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";
import { glava, preberi, zahtevaTwilio, type ZahtevaTwilio } from "./twilio-racun.server.ts";

const DATOTEKA = "napake.json";
const OSNOVA = "https://api.twilio.com/2010-04-01/";
const SID_TELEFONA = /^\+[1-9][0-9]{7,14}$/;
const URA_MS = 3600_000;
const DAN_MS = 24 * URA_MS;
const NAJVEC_SMS_URA = 3;
const NAJVEC_SMS_DAN = 10;

export type VnosNapake = {
  naprava: string;
  cas: string;
  vrsta: string;
  proces: string;
  izjema: string;
  stevec: number;
};

type Shranjeno = {
  zetonSifra?: { iv: string; tag: string; ciphertext: string };
  obvesti: boolean;
  iv?: string;
  tag?: string;
  ciphertext?: string;
  vnosi: VnosNapake[];
  zadnjeZahteve?: number[];
  obvestilaDana?: number[];
  zadnjaNapakaSms?: string;
};

export type NapakeStanje = {
  obvesti: boolean;
  stevilkaVpisana: boolean;
  zetonZnan: boolean;
  vnosi: VnosNapake[];
  zadnjaNapakaSms?: string;
};

export type PosljiSms = (stevilka: string, sporocilo: string, root: string) => Promise<boolean | void>;

const znaniZetoni = new Map<string, { iv: string; tag: string; ciphertext: string }>();

export function obreziObvestila(seznam: unknown, zdaj = Date.now()): number[] {
  if (!Array.isArray(seznam)) return [];
  return seznam
    .filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x <= zdaj && zdaj - x < DAN_MS)
    .slice(-NAJVEC_SMS_DAN);
}

function privzeto(root?: string): Shranjeno {
  const zetonSifra = root ? znaniZetoni.get(root) : undefined;
  return { ...(zetonSifra ? { zetonSifra } : {}), obvesti: false, vnosi: [], obvestilaDana: [] };
}

async function beri(root: string, zdaj = Date.now()): Promise<Shranjeno> {
  const f = await readJsonFile<Partial<Shranjeno>>(root, DATOTEKA, { premakniPokvarjen: true });
  if (!f || typeof f !== "object" || Array.isArray(f)) return privzeto(root);
  if (f.zetonSifra && typeof f.zetonSifra === "object") {
    znaniZetoni.set(root, f.zetonSifra);
  }
  const vnosi = Array.isArray(f.vnosi) ? f.vnosi : [];
  return {
    zetonSifra: f.zetonSifra ?? znaniZetoni.get(root),
    obvesti: Boolean(f.obvesti) && Boolean(f.ciphertext),
    iv: f.iv,
    tag: f.tag,
    ciphertext: f.ciphertext,
    vnosi,
    obvestilaDana: obreziObvestila(f.obvestilaDana, zdaj),
    ...(typeof f.zadnjaNapakaSms === "string" && f.zadnjaNapakaSms ? { zadnjaNapakaSms: f.zadnjaNapakaSms } : {}),
  };
}

export async function pridobiStanjeNapak(dir?: string): Promise<NapakeStanje> {
  const root = resolveDataDir(dir);
  const s = await beri(root);
  return {
    obvesti: s.obvesti,
    stevilkaVpisana: Boolean(s.ciphertext),
    zetonZnan: Boolean(s.zetonSifra),
    vnosi: s.vnosi,
    ...(s.zadnjaNapakaSms ? { zadnjaNapakaSms: s.zadnjaNapakaSms } : {}),
  };
}

export function pridobiZetonNapake(dir?: string): Promise<string> {
  return vVrsti(() => pridobiZetonNotranje(dir));
}

async function pridobiZetonNotranje(dir?: string): Promise<string> {
  const root = resolveDataDir(dir);
  const s = await beri(root);
  if (s.zetonSifra) {
    const z = await odsifrirajSkrivnost(s.zetonSifra, root);
    if (z) {
      znaniZetoni.set(root, s.zetonSifra);
      await writeJson(root, DATOTEKA, s);
      return z;
    }
  }
  const zeton = randomBytes(32).toString("base64url");
  s.zetonSifra = await sifrirajSkrivnost(zeton, root);
  znaniZetoni.set(root, s.zetonSifra);
  await writeJson(root, DATOTEKA, s);
  return zeton;
}

export function shraniNastavitveNapak(vnos: { obvesti?: boolean; stevilka?: string; pozabiStevilko?: boolean }, dir?: string): Promise<NapakeStanje> {
  return vVrsti(() => shraniNotranje(vnos, dir));
}

async function shraniNotranje(vnos: { obvesti?: boolean; stevilka?: string; pozabiStevilko?: boolean }, dir?: string): Promise<NapakeStanje> {
  const root = resolveDataDir(dir);
  const s = await beri(root);
  if (vnos.pozabiStevilko) {
    s.iv = undefined;
    s.tag = undefined;
    s.ciphertext = undefined;
    s.obvesti = false;
  } else if (vnos.stevilka) {
    const e164 = vnos.stevilka.trim();
    if (!SID_TELEFONA.test(e164)) throw new Error("Stevilka mora biti v obliki +386...");
    const sifra = await sifrirajSkrivnost(e164, root);
    s.iv = sifra.iv;
    s.tag = sifra.tag;
    s.ciphertext = sifra.ciphertext;
  }
  if (typeof vnos.obvesti === "boolean") {
    s.obvesti = vnos.obvesti && Boolean(s.ciphertext);
  }
  await writeJson(root, DATOTEKA, s);
  return pridobiStanjeNapak(dir);
}

export function cistiOsebnePodatke(besedilo: string, najvec = 200): string {
  let c = besedilo.slice(0, 2000);
  c = c.replace(/(?<![\w.-])\/var\/home\/[^/\s\\]+/g, "/home/USER");
  c = c.replace(/(?<![\w.-])\/mnt\/[a-z]\/Users\/[^/\s\\]+/gi, "/mnt/c/Users/USER");
  c = c.replace(/(?<![\w.-])\/(?:home|Users)\/[^/\s\\]+/g, (m) => (m.startsWith("/home") ? "/home/USER" : "/Users/USER"));
  c = c.replace(/(?<![\w.-])\/root(?:\/[^/\s\\]+)?/g, "/root");
  c = c.replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/:*?"<>|\r\n]+/gi, "C:\\Users\\USER");
  c = c.replace(/\/storage\/emulated\/\d+/g, "/storage/emulated/N");
  c = c.replace(/\b([a-z][a-z0-9+.-]{1,15}:\/\/)[^\s/?#@]{1,2000}@/gi, "$1USER:PASS@");
  c = c.replace(/(?<![^\s@<("'])(?!\S*USER:PASS@)[^\s@<>()"']{1,2000}@[^\s@<>()"']{1,255}\.[^\s@<>()"']{1,63}/g, "EMAIL@DOMAIN.COM");
  c = c.replace(/(?<![\w.:/-])(?!EMAIL@)[\w.-]{1,64}@[\w-]{1,63}(?=[\s:;,)]|$)/g, "USER@HOST");
  c = c.replace(/\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi, "MAC");
  c = c.replace(/(?<![\w:])([0-9a-f:]*:[0-9a-f:]*(?:\.\d{1,3}){0,3})(\/\d{1,3})?(?![\w:])/gi, (m, naslov: string, predpona?: string) => {
    if (!isIPv6(naslov)) return m;
    if (predpona !== undefined) {
      const p = Number(predpona.slice(1));
      if (p < 0 || p > 128) return m;
      return "IPV6";
    }
    if (!/[0-9a-f]/i.test(naslov)) return m;
    return "IPV6";
  });
  c = c.replace(/(?<![\w./-])(?:(?=[0-9a-f]*[a-f])[0-9a-f]{12}|(?:[0-9a-f]{4}\.){2}[0-9a-f]{4})(?![\w./:-])/gi, "MAC");
  c = c.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "IP.AD.DR.ESS");
  c = c.replace(/\?[^\s]*/g, "?...");
  c = c.replace(/(?<![A-Za-z0-9+/_.:-])[A-Za-z0-9+_-]+(?:\/[A-Za-z0-9+_-]+)+={0,2}(?![A-Za-z0-9+/_.:-])/g, (m) => {
    if (m.length < 24) return m;
    if (/USER|EMAIL|IPV6|PHONE_NUMBER|MAC/.test(m)) return m;
    if (/[+=]/.test(m)) return "SECRET";
    if (!/[A-Za-z]/.test(m) || !/\d/.test(m)) return m;
    const deli = m.split("/");
    const imaDolgDel = deli.some((d) => d.length >= 10);
    const deliZMesanico = deli.filter((d) => /[A-Za-z]/.test(d) && /\d/.test(d)).length;
    if (imaDolgDel || deliZMesanico >= 2) return "SECRET";
    return m;
  });
  c = c.replace(/(?<![A-Za-z0-9+_-])(?:(?=[A-Za-z0-9+_-]*[A-Za-z])(?=[A-Za-z0-9+_-]*[\d+])[A-Za-z0-9+_-]{24,}={0,2}|[A-Za-z0-9+_-]{24,}={1,2})(?![A-Za-z0-9+_-])/g, "SECRET");
  c = c.replace(/(?<![\w.:/-])(?:\+|00)[1-9][0-9 .\-/()]{5,18}[0-9](?![\w.])/g, (m) => {
    const stevk = m.replace(/\D/g, "").length;
    return stevk >= 8 && stevk <= 15 ? "PHONE_NUMBER" : m;
  });
  c = c.replace(/(?<![\w.:/+-])0[1-9][0-9]?(?:[ .\-/]?[0-9]{2,4}){2,3}(?![\w.])/g, (m) => {
    if (/^\d{2}[./-]\d{2}[./-]\d{4}$/.test(m)) return m;
    const stevk = m.replace(/\D/g, "").length;
    return stevk >= 9 && stevk <= 11 ? "PHONE_NUMBER" : m;
  });
  c = c.replace(/[\u0000-\u001f\u007f]+/g, " ");
  return c.slice(0, najvec);
}

const vseZahteve: number[] = [];
const neuspeli: number[] = [];
const notranjeZahteve = new Map<string, number[]>();

export function ponastaviOmejitveNapak(): void {
  vseZahteve.length = 0;
  neuspeli.length = 0;
  notranjeZahteve.clear();
}

function omejitev(seznam: number[], najvec: number, casMs: number, zdaj: number, vpisi = true): boolean {
  while (seznam.length && zdaj - seznam[0] >= casMs) seznam.shift();
  if (seznam.length >= najvec) return false;
  if (vpisi) seznam.push(zdaj);
  return true;
}

const vZaklepu = new AsyncLocalStorage<boolean>();
let zaklep: Promise<unknown> = Promise.resolve();

/**
 * Zaporedno izvajanje operacij nad datoteko napake.json.
 * Opomba: zaklep ni namenjen gnezdenju; ce se vVrsti poklice znotraj ze aktivnega
 * konteksta vVrsti, se funkcija izvede neposredno v obstojecem zaklepu brez mrtvega zastoja.
 */
export function vVrsti<T>(f: () => Promise<T>): Promise<T> {
  if (vZaklepu.getStore()) {
    return f();
  }
  const r = zaklep.then(() => vZaklepu.run(true, f));
  zaklep = r.then(
    () => undefined,
    () => undefined,
  );
  return r;
}

function enakoCasovno(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

const SPOROCILO_SMS = "Lina: nova napaka naprave. Poglej razdelek Napake naprav v programu.";

export async function posljiSmsTwilio(
  stevilka: string,
  sporocilo: string,
  root: string,
  zahteva: ZahtevaTwilio = zahtevaTwilio,
): Promise<boolean> {
  const r = await preberi(root);
  if (!r) return false;
  const headers = glava(r.sid, r.kljucSid, r.skrivnost);
  const sez = await zahteva(`${OSNOVA}Accounts/${r.sid}/IncomingPhoneNumbers.json?PageSize=20`, { method: "GET", headers });
  if (sez.status !== 200) {
    throw new Error(`Twilio stevilke HTTP ${sez.status}`);
  }
  const stevilke = (sez.json as { incoming_phone_numbers?: Array<Record<string, unknown>> } | null)?.incoming_phone_numbers ?? [];
  const prva = stevilke.find(
    (x) => typeof x.phone_number === "string" && SID_TELEFONA.test(x.phone_number) && (x.capabilities as { sms?: unknown } | undefined)?.sms !== false,
  );
  const od = typeof prva?.phone_number === "string" ? prva.phone_number : "";
  if (!SID_TELEFONA.test(od)) {
    throw new Error("Twilio nima stevilke za SMS");
  }
  const telo = new URLSearchParams({ To: stevilka, From: od, Body: sporocilo }).toString();
  const odg = await zahteva(`${OSNOVA}Accounts/${r.sid}/Messages.json`, { method: "POST", headers, body: telo });
  if (odg.status < 200 || odg.status >= 300) {
    throw new Error(`Twilio SMS HTTP ${odg.status}`);
  }
  return true;
}

let posiljanjePreizkusa: PosljiSms | null = null;
export function nastaviPosiljanjeSms(fn: PosljiSms | null = null): void {
  posiljanjePreizkusa = fn;
}

export async function handleNapakeRequest(
  request: Request,
  naslov: string | null | undefined,
  dir?: string,
  posljiSms?: PosljiSms,
): Promise<Response> {
  const izid = await vVrsti(() => obdelajNapakoZaklenjeno(request, naslov, dir));
  if (izid.stevilka && izid.root !== undefined && izid.zdaj !== undefined) {
    await izvediSmsZunajZaklepa(izid.stevilka, izid.root, izid.zdaj, posljiSms ?? posiljanjePreizkusa ?? posljiSmsTwilio);
  }
  return izid.odg;
}

async function obdelajNapakoZaklenjeno(
  request: Request,
  naslov: string | null | undefined,
  dir: string | undefined,
): Promise<{ odg: Response; stevilka?: string; root?: string; zdaj?: number }> {
  const glave = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  if (!jeLokalnaZahteva(izvorIzGlav(naslov, request.headers))) {
    return { odg: new Response('{"napaka":"prepovedano"}', { status: 403, headers: glave }) };
  }
  const root = resolveDataDir(dir);
  const zdaj = Date.now();
  const s = await beri(root, zdaj);
  // omejitev velja za VSE zahteve (tudi neveljavne), v pomnilniku, brez zapisa na disk
  if (!omejitev(vseZahteve, 60, 60_000, zdaj)) return { odg: new Response('{"napaka":"prevec_zahtev"}', { status: 429, headers: glave }) };
  const auth = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || request.headers.get("x-lina-zeton")?.trim();
  if (!s.zetonSifra) return { odg: new Response('{"napaka":"zeton ni nastavljen"}', { status: 403, headers: glave }) };
  if (!omejitev(neuspeli, 10, 60_000, zdaj, false)) return { odg: new Response('{"napaka":"prevec_zahtev"}', { status: 429, headers: glave }) };
  const praviZeton = await odsifrirajSkrivnost(s.zetonSifra, root);
  if (!auth || !praviZeton || !enakoCasovno(auth, praviZeton)) {
    neuspeli.push(zdaj);
    return { odg: new Response('{"napaka":"prepovedano"}', { status: 403, headers: glave }) };
  }
  if (request.method !== "POST") return { odg: new Response('{"napaka":"nedovoljena_metoda"}', { status: 405, headers: glave }) };
  const vel = Number(request.headers.get("content-length") ?? "0");
  if (vel > 2048) return { odg: new Response('{"napaka":"preveliko"}', { status: 413, headers: glave }) };
  const text = await request.text();
  if (text.length > 2048) return { odg: new Response('{"napaka":"preveliko"}', { status: 413, headers: glave }) };
  let body: Record<string, unknown>;
  try {
    const j = JSON.parse(text);
    if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("oblika");
    body = j as Record<string, unknown>;
  } catch {
    return { odg: new Response('{"napaka":"napacna_oblika"}', { status: 400, headers: glave }) };
  }

  const v: VnosNapake = {
    naprava: cistiOsebnePodatke(String(body.naprava ?? ""), 60),
    cas: /^[0-9T:. +\-Z]{1,40}$/.test(String(body.cas ?? "")) ? String(body.cas) : new Date().toISOString(),
    vrsta: cistiOsebnePodatke(String(body.vrsta ?? ""), 60),
    proces: cistiOsebnePodatke(String(body.proces ?? ""), 120),
    izjema: cistiOsebnePodatke(String(body.izjema ?? ""), 200),
    stevec: 1,
  };
  if (!v.naprava || !v.proces || !v.izjema) return { odg: new Response('{"napaka":"manjka_podatek"}', { status: 400, headers: glave }) };

  const { stevilka } = await notranjiZapisZaklenjeno(v, root, zdaj);
  return { odg: new Response('{"ok":true}', { status: 200, headers: glave }), stevilka, root, zdaj };
}

async function notranjiZapisZaklenjeno(v: VnosNapake, root: string, zdaj: number): Promise<{ stevilka?: string }> {
  const sveze = await beri(root, zdaj);
  let jeNov = false;
  const obstojec = sveze.vnosi.find((x) => x.naprava === v.naprava && x.proces === v.proces && x.izjema === v.izjema);
  if (obstojec) {
    obstojec.stevec++;
    obstojec.cas = v.cas;
  } else {
    jeNov = true;
    sveze.vnosi.push(v);
    if (sveze.vnosi.length > 200) sveze.vnosi.shift();
  }
  const ob = obreziObvestila(sveze.obvestilaDana, zdaj);
  sveze.obvestilaDana = ob;

  let izbranaStevilka: string | undefined;
  if (jeNov && v.vrsta !== "kakovost" && sveze.obvesti && sveze.ciphertext) {
    const naUro = ob.filter((x) => zdaj - x < URA_MS).length;
    if (naUro < NAJVEC_SMS_URA && ob.length < NAJVEC_SMS_DAN) {
      const stevilka = await odsifrirajSkrivnost({ iv: sveze.iv, tag: sveze.tag, ciphertext: sveze.ciphertext }, root);
      if (stevilka && SID_TELEFONA.test(stevilka)) {
        izbranaStevilka = stevilka;
        ob.push(zdaj);
        sveze.obvestilaDana = obreziObvestila(ob, zdaj);
        delete sveze.zadnjaNapakaSms;
      }
    }
  }
  await writeJson(root, DATOTEKA, sveze);
  return { stevilka: izbranaStevilka };
}

async function izvediSmsZunajZaklepa(stevilka: string, root: string, zdaj: number, posljiSms: PosljiSms): Promise<void> {
  try {
    const izid = await posljiSms(stevilka, SPOROCILO_SMS, root);
    if (izid === false) {
      await vVrsti(async () => {
        const sveze = await beri(root, Date.now());
        const ob = sveze.obvestilaDana ?? [];
        const idx = ob.indexOf(zdaj);
        if (idx !== -1) ob.splice(idx, 1);
        sveze.obvestilaDana = ob;
        await writeJson(root, DATOTEKA, sveze);
      });
    }
  } catch (err) {
    const surovo = err instanceof Error ? err.message : String(err);
    const razlog = cistiOsebnePodatke(surovo || "napaka pri posiljanju SMS", 120);
    console.warn(`[lina] napake SMS: ${razlog}`);
    await vVrsti(async () => {
      const sveze = await beri(root, Date.now());
      const ob = sveze.obvestilaDana ?? [];
      const idx = ob.indexOf(zdaj);
      if (idx !== -1) ob.splice(idx, 1);
      sveze.obvestilaDana = ob;
      sveze.zadnjaNapakaSms = razlog;
      await writeJson(root, DATOTEKA, sveze);
    });
  }
}

export async function sprejmiNotranjo(body: Record<string, unknown>, dir?: string): Promise<boolean> {
  const izid = await vVrsti(async () => {
    const root = resolveDataDir(dir);
    const zdaj = Date.now();
    const v: VnosNapake = {
      naprava: cistiOsebnePodatke(String(body.naprava ?? ""), 60),
      cas: /^[0-9T:. +\-Z]{1,40}$/.test(String(body.cas ?? "")) ? String(body.cas) : new Date().toISOString(),
      vrsta: cistiOsebnePodatke(String(body.vrsta ?? ""), 60),
      proces: cistiOsebnePodatke(String(body.proces ?? ""), 120),
      izjema: cistiOsebnePodatke(String(body.izjema ?? ""), 200),
      stevec: 1,
    };
    if (!v.naprava || !v.proces || !v.izjema) return { ok: false as const };

    const kljuc = `${root}\0${v.izjema}`;
    for (const [k, s] of notranjeZahteve) {
      while (s.length && zdaj - s[0] >= 60_000) s.shift();
      if (!s.length) notranjeZahteve.delete(k);
    }
    if (notranjeZahteve.size >= 100 && !notranjeZahteve.has(kljuc)) return { ok: false as const };
    const seznam = notranjeZahteve.get(kljuc) ?? [];
    if (!omejitev(seznam, 1, 60_000, zdaj, false)) return { ok: false as const };

    const { stevilka } = await notranjiZapisZaklenjeno(v, root, zdaj);
    seznam.push(zdaj);
    notranjeZahteve.set(kljuc, seznam);
    return { ok: true as const, stevilka, root, zdaj };
  });
  if (!izid.ok) return false;
  if (izid.stevilka) {
    await izvediSmsZunajZaklepa(izid.stevilka, izid.root, izid.zdaj, posiljanjePreizkusa ?? posljiSmsTwilio);
  }
  return true;
}
