/**
 * Glas Line: cisti del brez omrezja in brez diska.
 * Twiliov <Say language="sl-SI"> slovenscine ne zna (pravi klic 10. 11. 2026: lastnik govora ni razumel),
 * zato Lina govori z Gemini TTS (gemini-2.5-flash-tts, glas Kore, sl-SI - izbral lastnik 10. 11. 2026).
 */
import { createHmac } from "node:crypto";
import { t, type Beseda } from "./besedila.ts";
import { stavekPotrditve } from "./eposta.ts";
import { stavkiIzKataloga } from "./brain.ts";
import { odsotnostStavek, type NastavitveOdsotnosti } from "./odsotnost.ts";
import { deliPredstavitve, jeOsebna, osebniDeli, osebniZakljucek, predstavitevKlica, zRazkritjem } from "./povzetek.ts";
import type { Catalog } from "./types.ts";
import { OBDELAVA_ZVOKA } from "./glas-izenacenje.ts";
import { TABELA_SEMEN } from "./tabela_semen.ts";

export const GLAS_MODEL = "gemini-2.5-flash-tts";
export const GLAS_IME = "Kore";
export const GLAS_JEZIK = "sl-SI";

/**
 * Navodilo sloga (G4i, lastnik 11. 11. 2026: glas ne sme mesati slovenskega in hrvaskega naglasa).
 * Vir oblike: Google Cloud, Gemini TTS (https://docs.cloud.google.com/text-to-speech/docs/gemini-tts): v Vertex je
 * poziv del besedila v obliki »{poziv}: {besedilo}« (npr. »Say the following in a curious way: ...«); Cloud TTS API ima
 * locena polja prompt in text. Navodilo je angleško, ker je tako v dokumentaciji; besedilo klica ostane slovensko.
 * Dokumentacija NE pove, da model poziva ne bi prebral: to preverja A/B meritev (prepis posnetka) in lastnikov posluh.
 * Del kljuca posnetka in podpisa stalnih stavkov: ob vsaki spremembi besedila se posnetki pripravijo znova.
 */
export const NAVODILO_SLOGA =
  "Say the following in standard literary Slovenian with a Slovenian accent, not Croatian or Serbian; pronounce l at the end of a word or before a consonant as u, and v before a consonant as u, use the Slovenian schwa, at a natural pace, calm, without dramatization";

/**
 * Hitrejsi slog za VSE fraze Line (lastnik 14. 11. 2026 po posluhu pozdrava: »Vse naj bo v tem tempu, če bom želel drugače, bom sporočil.«;
 * pozdrav 6,84 s po rezanju proti 7,71 s). Isti glas (Kore), jezik in obdelava; en slog za vse, da ne zveni kot vec oseb.
 */
export const NAVODILO_SLOGA_HITREJE = NAVODILO_SLOGA.replace("at a natural pace", "at a natural, slightly faster pace");

/** Variante fraz osebnega nacina (lastnik 14. 11. 2026): prva je osnovna; v istem klicu se ponovijo sele, ko so porabljene vse. */
export const VARIANTE_OSEBNE = [
  ["osebnaIzvoliteKratko", "osebnaIzvoliteKratko2", "osebnaIzvoliteKratko3"],
  ["osebnaZapisanaKratko", "osebnaZapisanaKratko2", "osebnaZapisanaKratko3"],
  ["osebnaDobro", "osebnaDobro2", "osebnaDobro3"],
  ["osebnaTegaNevem", "osebnaTegaNevem2", "osebnaTegaNevem3"],
  ["osebnaDaZapisano", "osebnaDaZapisano2"],
  // Brez »lep dan« (lastnik 14. 11. 2026): dve varianti slovesa.
  ["osebnaKonec", "osebnaKonec3"],
] as const;

/**
 * Kosi vsebine ponovitve »Zapisala sem: ...« (lastnik 14. 11. 2026: »9 s je preveč«). Izmerjeno 14. 11. 2026 (scripts/meri-ponovitev.mts, 8 ponovitev,
 * izmenicno, 0 odgovorov 429): en zahtevek vse pripravljeno mediana 3556 ms, p95 6667 ms; dva enaka hkrati 3214 / 4801 ms (2x kvota); kosi hkrati
 * 2293 / 2952 ms (2,6x kvota, 100 % pod 3 s); kosi + dva hkrati 2240 / 2845 ms (5,3x kvota). Vgrajeni so kosi hkrati: prve 4 besede (najhitrejsi kos),
 * nato do 8 besed ali do vejice iz izreka; brez dodanih locil (besedilo ostane klicateljevo), zadnji s piko; robovi kosov <= 30 ms (ROB_KOSA_PONOVITVE_MS).
 */
export function kosiPonovitve(vsebina: string): string[] {
  // Besede ostanejo DOBESEDNO klicateljeve (14. 11. 2026: brez dodanih locil); samo zadnji kos dobi piko konca stavka.
  const besede = vsebina.replace(/[\s.!?…,;:]+$/u, "").split(/\s+/).filter(Boolean);
  if (besede.length === 0) return [];
  const kosi: string[][] = [besede.slice(0, 4)];
  let trenutni: string[] = [];
  for (const b of besede.slice(4)) {
    trenutni.push(b);
    if (trenutni.length >= 8 || /,$/.test(b)) {
      kosi.push(trenutni);
      trenutni = [];
    }
  }
  if (trenutni.length) kosi.push(trenutni);
  return kosi.map((k, i) => `${k.join(" ")}${i === kosi.length - 1 ? "." : ""}`);
}

/**
 * Seme sinteze (G4l, meritev 11. 11. 2026): z istim semenom Vertex vrne ISTE bajte (2 ponovitvi x 19 stavkov, cmp: identicni);
 * brez njega se isti stavek med ponovitvami razlikuje za 1,0 pt visine in 0,77 LU glasnosti. Temperatura nima
 * vpliva (temperature 0 in 0,3 sta dala identicen posnetek), zato je ne posiljamo.
 * Del kljuca posnetka: ob spremembi semena se posnetki pripravijo znova.
 */
export const SEME_SINTEZE = 42;

/** Najvec znakov na eno sintezo. 150 znakov je brez pretoka trajalo 9,0 s (10. 11. 2026), daljse besedilo razrezemo. */
export const MEJA_SINTEZE = 600;

/** Vertex vrne PCM 16-bit mono 24 kHz brez glave; Twilio <Play> predvaja WAV 8 kHz. */
export const VHODNA_FREKVENCA = 24_000;
export const IZHODNA_FREKVENCA = 8_000;

const KLJUC = /^[0-9a-f]{32}$/;
/** Edina oblika poti, ki jo javna pot zvoka sprejme. Nic iz zahteve ne gre v pot na disku razen teh 32 znakov. */
const POT_ZVOKA = /^\/api\/voice\/zvok\/([0-9a-f]{32})\.wav$/;
const PROJEKT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

export function jeKljucZvoka(value: string): boolean {
  return KLJUC.test(value);
}

/** Kljuc iz poti zahteve ali null. Velike crke, daljsi ali krajsi kljuc in vsaka druga pot odpadejo. */
export function kljucIzPoti(pathname: string): string | null {
  const zadetek = POT_ZVOKA.exec(pathname);
  return zadetek ? zadetek[1] : null;
}

export function potZvoka(kljuc: string): string {
  if (!jeKljucZvoka(kljuc)) throw new Error("Neveljaven kljuc zvoka.");
  return `/api/voice/zvok/${kljuc}.wav`;
}

/** Besedilo, kot gre v sintezo in v kljuc: en presledek, brez robov. */
export function cistoBesedilo(besedilo: string): string {
  return besedilo.replace(/\s+/g, " ").trim();
}

/** Seme za dolocen stavek (G4m). Ce ga ni v tabeli, vrne privzeto seme. */
export function semeZaBesedilo(besedilo: string): number {
  return TABELA_SEMEN[cistoBesedilo(besedilo)] ?? SEME_SINTEZE;
}

/**
 * Kljuc posnetka: prvih 32 hex znakov HMAC-SHA256(sol namestitve, model|glas|besedilo).
 * Brez soli bi kdorkoli iz uganjenega stavka izracunal naslov posnetka (v njem je lahko ime klicatelja).
 */
export function kljucZvoka(
  sol: Buffer,
  besedilo: string,
  model = GLAS_MODEL,
  glas = GLAS_IME,
  klic = "",
  navodilo = NAVODILO_SLOGA,
  seme = semeZaBesedilo(besedilo),
): string {
  if (sol.length < 32) throw new Error("Sol zvoka je prekratka.");
  // Nestalni posnetek (lahko ima ime klicatelja) dobi v kljuc se CallSid: isti stavek v dveh klicih nima istega
  // naslova (pregled G2, V2). Stalni stavki so brez klica, da jih delijo vsi klici.
  // Navodilo sloga je v kljucu (G4i): po spremembi navodila stari (hrvasko zveneci) posnetki nimajo istega kljuca.
  // Obdelava in seme (G4l, G4m) sta v kljucu: stari posnetki brez izenacenja nimajo istega naslova.
  const jedro = `${model}|${glas}|${cistoBesedilo(navodilo)}|${OBDELAVA_ZVOKA}|${seme}|${cistoBesedilo(besedilo)}`;
  const vhod = klic ? `klic|${klic}|${jedro}` : jedro;
  return createHmac("sha256", sol).update(vhod, "utf8").digest("hex").slice(0, 32);
}

/**
 * PCM 16-bit mono 24 kHz -> WAV 16-bit mono 8 kHz z glavo RIFF.
 * Pred decimacijo 3:1 povprecimo tri sosednje vzorce (preprosto nizko sito), da visoki toni ne zrcalijo v govor.
 * Cisti JS, brez ffmpeg: dela enako na Linuxu in Windows.
 */
export function pcm24VWav8(pcm: Uint8Array): Buffer {
  const vhod = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const vzorcev = Math.floor(vhod.length / 2);
  const izhodnih = Math.floor(vzorcev / 3);
  const podatki = Buffer.alloc(izhodnih * 2);
  for (let i = 0; i < izhodnih; i += 1) {
    const a = vhod.readInt16LE(i * 6);
    const b = vhod.readInt16LE(i * 6 + 2);
    const c = vhod.readInt16LE(i * 6 + 4);
    podatki.writeInt16LE(Math.round((a + b + c) / 3), i * 2);
  }
  const glava = Buffer.alloc(44);
  glava.write("RIFF", 0, "ascii");
  glava.writeUInt32LE(36 + podatki.length, 4);
  glava.write("WAVE", 8, "ascii");
  glava.write("fmt ", 12, "ascii");
  glava.writeUInt32LE(16, 16);
  glava.writeUInt16LE(1, 20);
  glava.writeUInt16LE(1, 22);
  glava.writeUInt32LE(IZHODNA_FREKVENCA, 24);
  glava.writeUInt32LE(IZHODNA_FREKVENCA * 2, 28);
  glava.writeUInt16LE(2, 32);
  glava.writeUInt16LE(16, 34);
  glava.write("data", 36, "ascii");
  glava.writeUInt32LE(podatki.length, 40);
  return Buffer.concat([glava, podatki]);
}

/**
 * Stavki brez izgube besedila: rez samo na presledku za koncnim locilom. Prejsnji vzorec je pri piki sredi
 * stevila (»8.00-16.00«) besedilo razbil in del izpustil - delovni cas bi bil v posnetku popacen (najdeno 10. 11. 2026).
 */
function stavki(besedilo: string): string[] {
  return besedilo.split(/(?<=[.!?])\s+/).map((kos) => kos.trim()).filter(Boolean);
}

function poDolzini(besedilo: string, meja: number): string[] {
  const ven: string[] = [];
  let tek = "";
  const dodaj = (kos: string) => {
    if (!tek) tek = kos;
    else if (tek.length + 1 + kos.length <= meja) tek = `${tek} ${kos}`;
    else {
      ven.push(tek);
      tek = kos;
    }
  };
  for (const stavek of stavki(besedilo)) {
    if (stavek.length <= meja) {
      dodaj(stavek);
      continue;
    }
    // En sam stavek cez mejo: rez po besedah, zadnja moznost po znakih.
    for (const beseda of stavek.split(" ")) {
      if (beseda.length <= meja) dodaj(beseda);
      else for (let i = 0; i < beseda.length; i += meja) dodaj(beseda.slice(i, i + meja));
    }
  }
  if (tek) ven.push(tek);
  return ven;
}

/** Prvi stavek prostega besedila je svoj kos, ce je za njim se kaj. Krajsi od tega se zdruzi z naslednjim. */
export const NAJKRAJSI_PRVI_KOS = 20;

/**
 * Prosto besedilo (odgovor modela) razdeli na PRVI stavek in ostanek. Meritev vodje 10. 11. 2026: sinteza celega
 * odgovora (~110 znakov) je trajala tik ob roku in odgovor je koncal v glasu posrednika. Kratek prvi stavek je
 * pripravljen prej in se predvaja, medtem ko se ostanek se sintetizira. Najvec dva kosa, da en odgovor ne poslje
 * vec socasnih zahtev (omejitev 429). Meja stavka: locilo, presledek, velika zacetnica; pika za stevko je datum.
 */
function prviStavekPosebej(besedilo: string, mejaKosa: number = MEJA_SINTEZE): string[] {
  if (!besedilo) return [];
  const meja = /(?<=[.!?])(?<!\d\.)\s+(?=[\p{Lu}«„"])/gu;
  let prvi = besedilo;
  let mejaStavka = -1;
  let ostanekStavka = "";
  for (let zadetek = meja.exec(besedilo); zadetek; zadetek = meja.exec(besedilo)) {
    if (zadetek.index < NAJKRAJSI_PRVI_KOS) continue;
    prvi = besedilo.slice(0, zadetek.index).trim();
    mejaStavka = zadetek.index;
    ostanekStavka = besedilo.slice(zadetek.index + zadetek[0].length).trim();
    break;
  }
  // Dolg prvi stavek: sinteza traja priblizno sorazmerno z dolzino (izmerjeno 12. 11. 2026, Gemini TTS: 26 znakov 1,6 s,
  // 66 znakov 2,5-3,4 s, 105 znakov 3,5-6,6 s, 136 znakov 6,4-8,7 s), zato se prvi kos konca pri vejici in se predvaja prej.
  const staro = mejaStavka < 0 || !ostanekStavka ? [besedilo] : [prvi, ostanekStavka];
  const klavzula = rezKlavzule(prvi);
  if (klavzula !== null) {
    const novo = [besedilo.slice(0, klavzula).trim(), besedilo.slice(klavzula).trim()];
    // Rez ne sme povecati stevila kosov (ostanek blizu meje bi sicer dal en kos vec, torej en klic TTS vec): pregled C3.
    const kosov = (deli: string[]) => deli.reduce((vsota, del) => vsota + poDolzini(del, mejaKosa).length, 0);
    if (kosov(novo) <= Math.max(2, kosov(staro))) return novo;
  }
  return staro;
}

/** Najdaljsi prvi kos po stavkih (znakov); daljsi prvi stavek se razreze pri vejici. */
export const NAJVEC_PRVI_KOS = 50;
const NAJVEC_PRVI_KOS_REZERVA = 70;

/**
 * Indeks takoj za locilom (vejica, podpicje, dvopicje, pomislaj), kjer se dolg prvi stavek razreze, ali null.
 * Locilo mora biti pred presledkom (ne vejica v stevilu 1,5), prvi kos 20-50 znakov (zadnje locilo v oknu), sicer
 * prvo locilo do 70 znakov. Brez primernega locila razrez ostane, kot je bil (brez lomljenja sredi besedne zveze).
 */
function rezKlavzule(stavek: string): number | null {
  if (stavek.length <= NAJVEC_PRVI_KOS) return null;
  // Rez pri vejici/podpicju/dvopicju je za locilom, pri pomislaju PRED njim (kos ne sme koncati s pomislajem: pregled C2).
  const kandidati = [...stavek.matchAll(/[,;:](?=\s)|\s[–—-](?=\s)/g)].map((m) => ({ i: m[0].length === 1 ? m.index + 1 : m.index, vejica: m[0].length === 1, znak: m[0] }));
  const sprejemljivi = kandidati.filter((k, n) => {
    const pred = stavek.slice(0, k.i);
    // Pred locilom stevka (»od 8, 9, 10«, »Ulica 5, «), za njim stevka ali zacetek seznama: rez sredi seznama ali naslova (C1).
    if (/\d$/.test(pred.trimEnd()) || /^\s*[–—-]?\s*\d/.test(stavek.slice(k.i + (k.vejica ? 0 : 1)))) return false;
    // Dvopicje prej v stavku (»Naslov: ...«) pomeni oznako in seznam: vejic za njim ne rezemo.
    if (k.znak !== ":" && /:\s/.test(pred)) return false;
    // Kratek clen med dvema locilima je element seznama.
    const prejsnji = n > 0 ? kandidati[n - 1].i : 0;
    return k.i - prejsnji >= MIN_CLEN_MED_LOCILI;
  });
  const indeksi = sprejemljivi.map((k) => k.i);
  const vOknu = indeksi.filter((i) => i >= NAJKRAJSI_PRVI_KOS && i <= NAJVEC_PRVI_KOS);
  if (vOknu.length > 0) return vOknu[vOknu.length - 1];
  const pozneje = indeksi.find((i) => i > NAJVEC_PRVI_KOS && i <= NAJVEC_PRVI_KOS_REZERVA);
  return pozneje ?? null;
}

/** Najmanj znakov med dvema locilima, da clen ni element seznama. */
const MIN_CLEN_MED_LOCILI = 10;

/**
 * Razrez odgovora na kose za sintezo.
 * Stalni stavki poteka klica so svoj kos (posnetek je ze pripravljen, predvaja se takoj);
 * enako stavki povzetka (posebni), da se vsak sintetizira posebej in vnaprej;
 * ostalo se zdruzi do meje in razreze po stavkih. Vrstni red ostane.
 */
export function razdeliZaGlas(
  besedilo: string,
  stalni: Iterable<string> = [],
  meja = MEJA_SINTEZE,
  posebni: Iterable<string> = [],
): string[] {
  const cisto = cistoBesedilo(besedilo);
  if (!cisto) return [];
  // posebni (G4b): stavki povzetka s podatki klicatelja; vsak je svoj kos, a ni stalni (nestalni posnetek).
  const znani = [...new Set([...stalni, ...posebni].map(cistoBesedilo).filter((s) => s && s.length <= meja))].sort(
    (a, b) => b.length - a.length,
  );
  const kosi: string[] = [];
  let prosto = "";
  const izprazni = () => {
    for (const del of prviStavekPosebej(prosto.trim(), meja)) kosi.push(...poDolzini(del, meja));
    prosto = "";
  };
  let i = 0;
  while (i < cisto.length) {
    const ostanek = cisto.slice(i);
    const zadetek = znani.find((s) => ostanek.startsWith(s) && (ostanek.length === s.length || ostanek[s.length] === " "));
    if (zadetek) {
      izprazni();
      kosi.push(zadetek);
      i += zadetek.length + 1;
      continue;
    }
    // Do konca stavka; stalni stavek se lahko zacne sele za presledkom po locilu.
    const konec = /[.!?]+(?=\s)/.exec(ostanek);
    const dolzina = konec ? konec.index + konec[0].length : ostanek.length;
    prosto = `${prosto} ${ostanek.slice(0, dolzina)}`;
    i += dolzina + 1;
  }
  izprazni();
  return kosi;
}

/**
 * Naslov zahteve Vertex. Ista oblika kot v meritvi 10. 11. 2026 (v1beta1, lokacija global).
 * ID projekta je uporabnikov; preverimo ga, da ne more spremeniti poti.
 */
export function naslovGlasu(projekt: string, pretok: boolean): string {
  if (!PROJEKT.test(projekt)) throw new Error("ID projekta Google Cloud ni veljaven.");
  const nacin = pretok ? "streamGenerateContent?alt=sse" : "generateContent";
  return `https://aiplatform.googleapis.com/v1beta1/projects/${projekt}/locations/global/publishers/google/models/${GLAS_MODEL}:${nacin}`;
}

/** Besedilo zahteve: »{navodilo}: {besedilo}«; prazno navodilo = golo besedilo. */
export function besediloZaSintezo(besedilo: string, navodilo = NAVODILO_SLOGA): string {
  const cisto = cistoBesedilo(besedilo);
  const slog = cistoBesedilo(navodilo);
  return slog ? `${slog}: ${cisto}` : cisto;
}

/** seme: samo za izbiro semena stalnega stavka (scripts/visina-stalnih.mts); Lina uporablja seme iz tabele. */
export function teloGlasu(besedilo: string, navodilo = NAVODILO_SLOGA, seme = semeZaBesedilo(besedilo)): unknown {
  return {
    contents: [{ role: "user", parts: [{ text: besediloZaSintezo(besedilo, navodilo) }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      seed: seme,
      speechConfig: { languageCode: GLAS_JEZIK, voiceConfig: { prebuiltVoiceConfig: { voiceName: GLAS_IME } } },
    },
  };
}

type DelOdgovora = { inlineData?: { mimeType?: string; data?: string } };
type KosOdgovora = { candidates?: Array<{ content?: { parts?: DelOdgovora[] } }> };

function zvokKosa(kos: KosOdgovora, ven: Buffer[]): void {
  for (const del of kos.candidates?.[0]?.content?.parts ?? []) {
    const podatek = del.inlineData;
    if (!podatek?.data) continue;
    const vrsta = (podatek.mimeType ?? "").toLowerCase();
    // Druga frekvenca ali kodek bi se predvajal prehitro ali kot sum: raje rezerva kot popacen glas.
    if (!vrsta.startsWith("audio/l16") || !/rate=24000\b/.test(vrsta)) throw new Error("Nepodprta oblika zvoka.");
    ven.push(Buffer.from(podatek.data, "base64"));
  }
}

/** PCM iz odgovora: pretok SSE (vrstice »data: {...}«) ali en sam JSON. Brez zvoka vrze napako. */
export function pcmIzOdgovora(telo: string): Buffer {
  const kosi: Buffer[] = [];
  const cisto = telo.trim();
  if (cisto.startsWith("{") || cisto.startsWith("[")) {
    const json = JSON.parse(cisto) as KosOdgovora | KosOdgovora[];
    for (const kos of Array.isArray(json) ? json : [json]) zvokKosa(kos, kosi);
  } else {
    for (const vrstica of cisto.split(/\r?\n/)) {
      if (!vrstica.startsWith("data:")) continue;
      const vsebina = vrstica.slice(5).trim();
      if (!vsebina || vsebina === "[DONE]") continue;
      zvokKosa(JSON.parse(vsebina) as KosOdgovora, kosi);
    }
  }
  const pcm = Buffer.concat(kosi);
  if (pcm.length < 6) throw new Error("Odgovor nima zvoka.");
  return pcm;
}

/** Zgornja meja trajanja stalnega posnetka glede na pricakovano trajanje iz besedila. */
export const MEJA_TRAJANJA_FAKTOR = 1.6;
/** Tisina med govornimi deli v ms: premor > 150 ms loci govorne dele. */
export const TISINA_MED_DELI_MS = 150;
/** Najvec poskusov sinteze stalnega stavka (vsak z drugim semenom), ce posnetek ne prestane preverbe. */
export const NAJVEC_POSKUSOV_STALNEGA = 3;
/** Mediana osnovne frekvence stalnih stavkov (Hz, izmerjeno v visina-stalnih.json). */
export const MEDIANA_F0_STALNIH_HZ = 213.6;
/** Relativni odmik osnovne frekvence (20 %), nad katerim se doda opozorilo o globini glasu. */
export const MEJA_ODMIKA_F0 = 0.2;

export type VhodPcm = Uint8Array | Int16Array | Float32Array | Float64Array | readonly number[];

function vNormiraneVzorce(pcm: VhodPcm): Float64Array {
  if (pcm instanceof Uint8Array) {
    const n = Math.floor(pcm.byteLength / 2);
    const pogled = new DataView(pcm.buffer, pcm.byteOffset, n * 2);
    const ven = new Float64Array(n);
    for (let i = 0; i < n; i += 1) ven[i] = pogled.getInt16(i * 2, true) / 32768;
    return ven;
  }
  if (pcm instanceof Int16Array) {
    const ven = new Float64Array(pcm.length);
    for (let i = 0; i < pcm.length; i += 1) ven[i] = pcm[i]! / 32768;
    return ven;
  }
  const ven = new Float64Array(pcm.length);
  for (let i = 0; i < pcm.length; i += 1) ven[i] = pcm[i] ?? 0;
  return ven;
}

/**
 * Pricakovano trajanje (s) iz stevila znakov in besed, izpeljano iz preostalih stalnih stavkov
 * (39 do 47 stavkov, od ~0,6 s za najkrajse »Hvala.«/»Prosim.« do ~11 s za najdaljsi pozdrav;
 * 50 znakov / 7 besed za t("osebnaZapisana") = 3,5 s).
 */
export function pricakovanoTrajanjeSek(besedilo: string): number {
  const cisto = cistoBesedilo(besedilo);
  const besed = cisto ? cisto.split(/\s+/).filter(Boolean).length : 0;
  return Math.max(0.6, Math.round((0.15 + cisto.length * 0.053 + besed * 0.1) * 100) / 100);
}

/**
 * Osnovna frekvenca F0 (Hz) cistega PCM z normirano avtokorelacijo na govorjenih oknih (40 ms, korak 10 ms, 75-400 Hz).
 * Vrne mediano govorjenih oken ali null, ce je zvocnih oken premalo.
 */
export function osnovnaFrekvencaPcm(pcm: VhodPcm, frekvenca = VHODNA_FREKVENCA): number | null {
  const surovi = vNormiraneVzorce(pcm);
  if (surovi.length === 0 || frekvenca <= 0) return null;
  const korakDec = frekvenca >= 16_000 ? Math.max(1, Math.round(frekvenca / 8_000)) : 1;
  const sr = frekvenca / korakDec;
  const n = Math.floor(surovi.length / korakDec);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let vsota = 0;
    for (let j = 0; j < korakDec; j += 1) vsota += surovi[i * korakDec + j]!;
    x[i] = vsota / korakDec;
  }
  const okno = Math.max(16, Math.round(sr * 0.04));
  const korak = Math.max(4, Math.round(sr * 0.01));
  const lagMin = Math.max(2, Math.floor(sr / 400));
  const lagMax = Math.ceil(sr / 75);
  if (n < okno + lagMax) return null;
  const energije: number[] = [];
  for (let s = 0; s + okno + lagMax <= n; s += korak) {
    let e = 0;
    for (let i = s; i < s + okno; i += 1) e += x[i]! * x[i]!;
    energije.push(e);
  }
  let najvecja = 0;
  for (const e of energije) if (e > najvecja) najvecja = e;
  if (najvecja <= 1e-8) return null;
  const frekvence: number[] = [];
  energije.forEach((e, idx) => {
    if (e < najvecja * 10 ** (-30 / 10)) return;
    const s = idx * korak;
    const r: number[] = [];
    let najR = 0;
    for (let lag = lagMin; lag <= lagMax; lag += 1) {
      let ab = 0;
      let bb = 0;
      for (let i = s; i < s + okno; i += 1) {
        ab += x[i]! * x[i + lag]!;
        bb += x[i + lag]! * x[i + lag]!;
      }
      const v = ab / Math.sqrt(e * bb + 1e-12);
      r.push(v);
      if (v > najR) najR = v;
    }
    let najLag = 0;
    for (let k = 1; k < r.length - 1; k += 1) {
      if (r[k]! >= najR * 0.85 && r[k]! >= r[k - 1]! && r[k]! >= r[k + 1]!) {
        najLag = lagMin + k;
        break;
      }
    }
    if (najR >= 0.6 && najLag > 0) frekvence.push(sr / najLag);
  });
  if (frekvence.length < 4) return null;
  frekvence.sort((a, b) => a - b);
  const m = Math.floor(frekvence.length / 2);
  const mediana = frekvence.length % 2 ? frekvence[m]! : (frekvence[m - 1]! + frekvence[m]!) / 2;
  return Math.round(mediana * 10) / 10;
}

export type OcenaPosnetka = {
  sprejemljiv: boolean;
  trajanjeSek: number;
  pricakovanoSek: number;
  najvecSek: number;
  delov: number;
  stavkov: number;
  najvecDelov: number;
  f0Hz: number | null;
  opozoriloGlasu?: string;
  razlog?: "predolg" | "prevecDelov";
};

/**
 * Cista funkcija (LINA-GLAS-1): oceni, ali je posnetek sprejemljiv glede na besedilo.
 * - Pricakovano trajanje iz stevila znakov in besed, zgornja meja 1,6x pricakovanega.
 * - Stevilo govornih delov (tisina > 150 ms loci dele) ne sme presegati stevila stavkov v besedilu za vec kot 1.
 * - Globina glasu: ce F0 odstopa od mediane stalnih stavkov za vec kot 20 %, doda opozorilo (ne zavrnitev).
 */
export function oceniPosnetek(
  pcm: VhodPcm,
  besedilo: string,
  frekvenca = VHODNA_FREKVENCA,
  medianaF0Hz = MEDIANA_F0_STALNIH_HZ,
): OcenaPosnetka {
  const cisto = cistoBesedilo(besedilo);
  const stStavkov = Math.max(1, stavki(cisto).length);
  const najvecDelov = stStavkov + 1;
  const pricakovanoSek = pricakovanoTrajanjeSek(cisto);
  const najvecSek = Math.round(pricakovanoSek * MEJA_TRAJANJA_FAKTOR * 100) / 100;
  const vzorci = vNormiraneVzorce(pcm);
  const oknoMs = 10;
  const okno = Math.max(1, Math.round((frekvenca * oknoMs) / 1000));
  const oken = Math.floor(vzorci.length / okno);
  const rms: number[] = [];
  for (let k = 0; k < oken; k += 1) {
    let vsota = 0;
    for (let i = k * okno; i < (k + 1) * okno; i += 1) vsota += vzorci[i]! * vzorci[i]!;
    rms.push(Math.sqrt(vsota / okno));
  }
  const urejeno = [...rms].sort((a, b) => a - b);
  const ref = urejeno.length > 0 ? urejeno[Math.min(urejeno.length - 1, Math.floor(0.95 * (urejeno.length - 1)))]! : 0;
  const prag = Math.max(1e-4, ref * 10 ** (-30 / 20));
  const prvo = rms.findIndex((r) => r >= prag);
  let zadnje = rms.length - 1;
  while (zadnje > prvo && rms[zadnje]! < prag) zadnje -= 1;

  let delov = 0;
  let trajanjeSek = frekvenca > 0 ? Math.round((vzorci.length / frekvenca) * 100) / 100 : 0;
  if (prvo >= 0) {
    delov = 1;
    let tihaOkna = 0;
    for (let k = prvo; k <= zadnje; k += 1) {
      if (rms[k]! < prag) {
        tihaOkna += 1;
      } else {
        if (tihaOkna * oknoMs > TISINA_MED_DELI_MS) delov += 1;
        tihaOkna = 0;
      }
    }
    const zacetekSek = (prvo * okno) / frekvenca;
    const konecSek = (vzorci.length - (zadnje + 1) * okno) / frekvenca;
    const govorSpanSek = ((zadnje - prvo + 1) * okno) / frekvenca;
    const robZacetek = zacetekSek > 0.3 ? 0.15 : zacetekSek;
    const robKonec = konecSek > 0.3 ? 0.15 : konecSek;
    trajanjeSek = Math.round((govorSpanSek + robZacetek + robKonec) * 100) / 100;
  }

  const f0Hz = osnovnaFrekvencaPcm(vzorci, frekvenca);
  const opozoriloGlasu =
    f0Hz !== null && medianaF0Hz > 0 && Math.abs(f0Hz - medianaF0Hz) / medianaF0Hz > MEJA_ODMIKA_F0
      ? `Osnovna frekvenca ${f0Hz} Hz odstopa za vec kot 20 % od mediane ${medianaF0Hz} Hz.`
      : undefined;

  let sprejemljiv = true;
  let razlog: "predolg" | "prevecDelov" | undefined;
  if (delov > najvecDelov) {
    sprejemljiv = false;
    razlog = "prevecDelov";
  } else if (trajanjeSek > najvecSek) {
    sprejemljiv = false;
    razlog = "predolg";
  }

  return {
    sprejemljiv,
    trajanjeSek,
    pricakovanoSek,
    najvecSek,
    delov,
    stavkov: stStavkov,
    najvecDelov,
    f0Hz,
    ...(opozoriloGlasu ? { opozoriloGlasu } : {}),
    ...(razlog ? { razlog } : {}),
  };
}

/** Stavki poteka klica, ki se nikoli ne spremenijo (besedila.ts). Vmesni stavek je prvi, ker ga rabi vsako cakanje. */
const STALNE_BESEDE: Beseda[] = [
  "trenutek",
  "kakoPomagam",
  "kajSeZanima",
  "povzetekUvod",
  "povzetekStik",
  "potrditevVprasanje",
  "kajPopravim",
  "hvalaStik",
  "prosiKolicino",
  "prosiRok",
  "prosiIme",
  "prosiTelefon",
  "prosiNujnost",
  "sporociloZapisano",
  "nujnoZapisano",
  "nujniPovezujem",
  "nujniNeOglasi",
  "nujniPotrdi",
  "povzetekSporocilo",
  "povratniKlicSploh",
  "oprostiteNapaka",
  "oprostiteSlovo",
  "stikZakljucek",
  "slovo",
  "lepDan",
  "nisemSlisala",
  "slovoTisina",
  "casOmejitev",
  "casSodelavec",
  "casSlovo",
];

/**
 * Stavki, ki jih pripravimo vnaprej (pred odprtjem linije in ob spremembi pozdrava ali podjetja):
 * sinteza kratkega stavka traja 3 s, 150 znakov 9 s (10. 11. 2026) - med klicem bi bil to molk.
 * Mnozica je ista za odprto in zaprto linijo: zaprtje stalnih stavkov ne odznaci (pregled G2, N9),
 * ponovna sinteza je potrebna samo ob spremembi besedila, glasu ali modela.
 */
export function stalniStavki(
  pravila: { pozdrav: string; povprasevanje?: string; temaOdgovor?: string; potrditevEposta?: boolean; potrditevNaslov?: string; nacinKlica?: string; imeLastnika?: string; imeLastnikaTozilnik?: string } & NastavitveOdsotnosti,
  podjetje: string,
  katalog?: Catalog,
  zdaj: Date = new Date(),
): string[] {
  if (jeOsebna(pravila)) {
    // Osebna tajnica: samo to, kar sme povedati. Pozdrav in zakljucek sta vsak EN stavek = ena sinteza (en glas).
    const osebni = [
      t("trenutek"),
      osebniDeli(pravila.pozdrav, pravila.imeLastnika ?? "", odsotnostStavek(pravila, zdaj), pravila.imeLastnikaTozilnik ?? "").join(" "),
      t("osebnaSporocilo"),
      t("osebnaNevarnost"),
      t("osebnaNazaj"),
      t("osebnaPonovi"),
      t("osebnaIzvolite"),
      osebniZakljucek(),
      t("osebnaVprasanje"),
      t("osebnaIzvoliteKratko"),
      t("osebnaZapisanaKratko"),
      t("osebnaNevemKratko"),
      t("osebnaDobro"),
      t("osebnaDaZapisano"),
      t("osebnaTegaNevem"),
      t("osebnaZapisanaDa"),
      t("osebnaZapisana"),
      t("osebnaZapisalaSemUvod"),
      t("osebnaPonovitevVTrenutku"),
      t("osebnaSlovoTisina"),
      t("osebnaPonovimVprasanje"),
      t("osebnaPravRazumela"),
      t("osebnaKakoIme"),
      t("osebnaOprostiteSlovo"),
      zRazkritjem(pravila, t("osebnaOprostiteSlovo")),
      zRazkritjem(pravila, t("osebnaLinijaZasedena")),
      ...VARIANTE_OSEBNE.flatMap((v) => v.map((k) => t(k))),
      t("osebnaKonec"),
      t("osebnaNevem"),
      t("osebnaAI"),
      t("osebnaBrezStevilke"),
      t("osebnaNejasnoBrez"),
      t("slovoTisina"),
      t("casSlovo"),
      t("oprostiteNapaka"),
      t("oprostiteSlovo"),
      zRazkritjem(pravila, t("oprostiteNapaka")),
      zRazkritjem(pravila, t("oprostiteSlovo")),
      t("nisemSlisala"),
      zRazkritjem(pravila, t("linijaZaprta")),
      zRazkritjem(pravila, t("linijaZasedena")),
    ];
    return [...new Set(osebni.map(cistoBesedilo).filter((stavek) => stavek && stavek.length <= MEJA_SINTEZE))];
  }
  const vsi = [
    ...STALNE_BESEDE.slice(0, 1).map((kljuc) => t(kljuc)),
    // Pozdrav je ENA sinteza (lastnik, 14. 11. 2026: locene kratke zahteve zvenijo kot vec oseb, dolg odgovor kot ena).
    // Najdaljsi znani stavek se ujame prvi (razdeliZaGlas), zato klic predvaja pozdrav kot en kos; deli ostanejo
    // za razkritjeSpredaj, kjer za razkritjem sledi se odgovor.
    predstavitevKlica(pravila.pozdrav, podjetje, pravila),
    ...deliPredstavitve(pravila.pozdrav, podjetje, pravila),
    ...STALNE_BESEDE.slice(1).map((kljuc) => t(kljuc)),
    // Stavki, ki so lahko prvi v klicu, z razkritjem UI spredaj (zRazkritjem).
    zRazkritjem(pravila, t("linijaZaprta")),
    zRazkritjem(pravila, t("linijaZasedena")),
    zRazkritjem(pravila, t("oprostiteNapaka")),
    zRazkritjem(pravila, t("oprostiteSlovo")),
    // Kratek zakljucek po povprasevanju (en stavek = ena sinteza), z e-posto podjetja in brez nje.
    [stavekPotrditve(pravila), t("kratekZakljucek"), t("lepDan")].filter(Boolean).join(" "),
    [stavekPotrditve(pravila, true), t("kratekZakljucek"), t("lepDan")].filter(Boolean).join(" "),
    [t("kratekZakljucek"), t("lepDan")].join(" "),
    t("kratekZakljucek"),
    pravila.povprasevanje ?? "",
    pravila.temaOdgovor ?? "",
    stavekPotrditve(pravila),
    stavekPotrditve(pravila, true),
    // Znani odgovori iz kataloga (G4a): pripravljeni vnaprej, da se predvajajo brez cakanja.
    ...(katalog ? stavkiIzKataloga(katalog) : []),
  ];
  return [...new Set(vsi.map(cistoBesedilo).filter((stavek) => stavek && stavek.length <= MEJA_SINTEZE))];
}
