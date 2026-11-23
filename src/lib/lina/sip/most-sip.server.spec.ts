/**
 * SIP-2: most SIP <-> Live brez omrezja (lazni klic SIP in lazni Live). Preverja prenos (klicatelj -> Live, Live -> klicatelj),
 * takt oddaje, 'mark' in 'clear' kot pri Twiliu, konec klica z obeh strani, omejitev dolzine in sprostitev vsega.
 * Izmisljena imena in stevilke; komentarji brez sumnikov.
 */
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../besedila.ts";
import { formaCatalog } from "../catalog.ts";
import type { LiveSeja, LiveSporocilo, NastavitveMosta, OdvisnostiMosta, ZapisnikLive } from "../live/most.ts";
import { pcmVMulaw } from "../live/zvok.ts";
import { MostSip, novSidSip, stevilkaKlicatelja, type KlicZaMost, type OdvisnostiMostaSip } from "./most-sip.server.ts";
import type { DohodniKlicDogodki, RazlogKonca } from "./odjemalec.server.ts";

const pocakaj = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function cakajDo(pogoj: () => boolean, ms = 4000): Promise<void> {
  const rok = Date.now() + ms;
  while (!pogoj()) {
    if (Date.now() > rok) throw new Error("cakanje poteklo");
    await pocakaj(5);
  }
}

function sinus(frekvenca: number, hz: number, vzorcev: number, amplituda = 8000): Int16Array {
  const ven = new Int16Array(vzorcev);
  for (let i = 0; i < vzorcev; i++) ven[i] = Math.round(amplituda * Math.sin((2 * Math.PI * hz * i) / frekvenca));
  return ven;
}
const rms = (pcm: Int16Array) => Math.sqrt(pcm.reduce((v, x) => v + x * x, 0) / Math.max(1, pcm.length));

class LazniKlic extends EventEmitter<DohodniKlicDogodki> implements KlicZaMost {
  klicatelj = "+38640000002";
  sprejet = 0;
  odlozen = 0;
  zavrnjen: number[] = [];
  prekinitev = 0;
  poslano: Int16Array[] = [];
  napakaSprejema = false;
  async sprejmi(): Promise<void> {
    if (this.napakaSprejema) throw new Error("rtp");
    this.sprejet += 1;
  }
  zavrni(status = 486): void {
    this.zavrnjen.push(status);
  }
  odlozi(): void {
    this.odlozen += 1;
    this.emit("konec", "odlozeno");
  }
  poslji(pcm24k: Int16Array): void {
    this.poslano.push(pcm24k);
  }
  prekiniPredvajanje(): void {
    this.prekinitev += 1;
  }
  /** Klicatelj govori: 20 ms, 24 kHz. */
  govori(n = 1): void {
    for (let i = 0; i < n; i++) this.emit("zvok", sinus(24000, 440, 480));
  }
  odlozilKlicatelj(razlog: RazlogKonca = "bye"): void {
    this.emit("konec", razlog);
  }
}

type Dogodek = [string, ...unknown[]];

function laznLive() {
  const poslano: Record<string, unknown>[] = [];
  let naSporocilo: ((m: LiveSporocilo) => void) | null = null;
  let zaprtih = 0;
  let odprtij = 0;
  const seja: LiveSeja = { poslji: (m) => void poslano.push(m as Record<string, unknown>), zapri: () => void (zaprtih += 1) };
  return {
    poslano,
    get zaprtih() {
      return zaprtih;
    },
    get odprtij() {
      return odprtij;
    },
    odpriLive: (async (p: { setup: object; onSporocilo(m: LiveSporocilo): void }) => {
      odprtij += 1;
      naSporocilo = p.onSporocilo;
      return seja;
    }) as OdvisnostiMosta["odpriLive"],
    emit: (m: LiveSporocilo) => naSporocilo?.(m),
    zvokVhoda: () => poslano.filter((m) => (m.realtimeInput as { audio?: unknown } | undefined)?.audio),
  };
}

function laznZapisnik(dogodki: Dogodek[], cas: { opozorilo: string; potek: string } = { opozorilo: "Cas se izteka.", potek: "Nasvidenje." }): ZapisnikLive {
  return {
    zacni: async (v) => void dogodki.push(["zacni", v.callSid, v.from, v.pozdrav]),
    izrek: async (sid, b) => void dogodki.push(["izrek", sid, b]),
    odgovor: async (sid, b) => void dogodki.push(["odgovor", sid, b]),
    vrzel: async (v) => void dogodki.push(["vrzel", v]),
    cas: async (sid, faza) => {
      dogodki.push(["cas", sid, faza]);
      return { besedilo: faza === "opozorilo" ? cas.opozorilo : cas.potek, konec: faza === "potek" };
    },
    povprasevanje: async (sid, polja) => {
      dogodki.push(["povprasevanje", sid, polja]);
      return { sprejeto: Object.keys(polja), zavrnjeno: [] };
    },
    zakljuci: async (sid) => void dogodki.push(["zakljuci", sid]),
  };
}

const POZDRAV = "Pozdravljeni, tukaj Lina, asistentka z umetno inteligenco.";

function nastavitve(sprememba: Partial<NastavitveMosta> = {}): NastavitveMosta {
  return {
    setup: { setup: { model: "test" } },
    katalog: { ...formaCatalog(), znanje: "Izdelujemo pohistvo po meri." },
    pozdrav: POZDRAV,
    temaOdgovor: t("temaPrivzeto"),
    oprostilo: t("oprostiteSlovo"),
    najdaljsiMinut: null,
    ...sprememba,
  };
}

/** Stalni posnetek: ton 1 kHz, `ms` dolg (mu-law 8 kHz). */
function posnetek(ms: number): Uint8Array {
  return pcmVMulaw(sinus(8000, 1000, (8000 * ms) / 1000));
}

const mostovi: MostSip[] = [];
afterEach(async () => {
  for (const m of mostovi.splice(0)) await m.ustavi();
});

function okolje(moznosti: { nastavitve?: Partial<NastavitveMosta>; ura?: { zdaj: number }; posnetekMs?: number } = {}) {
  const klic = new LazniKlic();
  const live = laznLive();
  const dogodki: Dogodek[] = [];
  const zasedenost = { osvezi: [] as string[], sprosti: [] as string[] };
  const posnetki: string[] = [];
  const odv: OdvisnostiMostaSip = {
    nalozi: async () => nastavitve(moznosti.nastavitve),
    odpriLive: live.odpriLive,
    zapisnik: laznZapisnik(dogodki),
    zasedenost: { osvezi: (s) => void zasedenost.osvezi.push(s), sprosti: (s) => void zasedenost.sprosti.push(s) },
    posnetek: async (b) => {
      posnetki.push(b);
      return posnetek(moznosti.posnetekMs ?? 200);
    },
    ura: moznosti.ura ? () => (moznosti.ura as { zdaj: number }).zdaj : undefined,
    tikMs: 5,
  };
  const most = new MostSip(klic, odv);
  mostovi.push(most);
  return { klic, live, dogodki, zasedenost, posnetki, most };
}

/** Zvok Live: 24 kHz PCM 16-bit LE, base64. */
function zvokLive(ms: number): LiveSporocilo {
  const pcm = sinus(24000, 440, (24000 * ms) / 1000);
  return { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: Buffer.from(pcm.buffer).toString("base64") } }] } } };
}

describe("SIP-2 most: prenos in logika Live", () => {
  it("sprejem klica: pozdrav z razkritjem gre prvi (stalni posnetek), nato Live s setup; zapis klica s SIP oznako in stevilko", async () => {
    const o = okolje();
    await o.most.zacni();
    expect(o.klic.sprejet).toBe(1);
    await cakajDo(() => o.live.odprtij === 1);
    expect(o.posnetki[0]).toBe(POZDRAV);
    await cakajDo(() => o.dogodki.some((d) => d[0] === "zacni"));
    expect(o.dogodki.find((d) => d[0] === "zacni")).toEqual(["zacni", o.most.callSid, "+38640000002", POZDRAV]);
    expect(o.most.callSid).toMatch(/^SIP[0-9a-f]{24}$/);
    // pozdrav (200 ms) se predvaja v klic SIP v taktu 20 ms, z energijo tona
    await cakajDo(() => o.klic.poslano.length >= 10);
    expect(o.klic.poslano.every((p) => p.length === 480)).toBe(true);
    expect(rms(o.klic.poslano[5] as Int16Array)).toBeGreaterThan(1000);
  });

  it("klic -> zvok gre v Live (16 kHz, kot Twilio) in odgovor Live nazaj v klic (24 kHz PCM)", async () => {
    const o = okolje();
    await o.most.zacni();
    await cakajDo(() => o.live.odprtij === 1);
    o.live.emit({ setupComplete: {} });
    o.klic.govori(10);
    await cakajDo(() => o.live.zvokVhoda().length >= 10, 3000);
    const vhod = o.live.zvokVhoda().at(-1)?.realtimeInput as { audio: { data: string; mimeType: string } };
    expect(vhod.audio.mimeType).toBe("audio/pcm;rate=16000");
    const pcm16 = new Int16Array(new Uint8Array(Buffer.from(vhod.audio.data, "base64")).buffer);
    expect(pcm16.length).toBe(320);
    expect(rms(pcm16)).toBeGreaterThan(1000);
    const prej = o.klic.poslano.length;
    o.live.emit(zvokLive(400));
    await cakajDo(() => o.klic.poslano.length >= prej + 15, 3000);
    const izLive = o.klic.poslano.slice(prej + 2, prej + 15);
    expect(izLive.every((p) => p.length === 480 && rms(p) > 1000)).toBe(true);
  });

  it("takt: v klic gre najvec ~60 ms naprej, ostalo caka pri mostu (clear ga lahko zavrze)", async () => {
    const o = okolje({ posnetekMs: 2000 });
    await o.most.zacni();
    await cakajDo(() => o.klic.poslano.length >= 1);
    const zacetek = performance.now();
    await pocakaj(300);
    const cas = performance.now() - zacetek;
    // 2 s pozdrava je ze pri mostu; v 300 ms jih v klic gre ~ 300/20 + 3, ne 100
    expect(o.klic.poslano.length).toBeLessThan(cas / 20 + 8);
    expect(o.klic.poslano.length).toBeGreaterThan(cas / 20 - 6);
  });

  it("varovalka (cena): 'clear' zavrze cakajoci zvok Live in prekine predvajanje v RTP, nato stalni odgovor", async () => {
    const o = okolje();
    await o.most.zacni();
    await cakajDo(() => o.live.odprtij === 1);
    o.live.emit({ setupComplete: {} });
    await pocakaj(300);
    o.live.emit(zvokLive(2000));
    await cakajDo(() => o.most.stat.izLive >= 90);
    const prej = o.klic.poslano.length;
    o.live.emit({ serverContent: { outputTranscription: { text: "To stane 100 evrov." } } });
    expect(o.klic.prekinitev).toBeGreaterThanOrEqual(1);
    expect(o.most.stat.clear).toBeGreaterThanOrEqual(1);
    await cakajDo(() => o.posnetki.includes(t("temaPrivzeto")));
    await pocakaj(1000);
    // po clear ni vec 2 s zvoka Live: v 1 s je v klic slo samo se ~ stalni odgovor (200 ms = 10 okvirjev), ne 50 okvirjev Live
    expect(o.klic.poslano.length - prej).toBeLessThan(25);
    await cakajDo(() => o.dogodki.some((d) => d[0] === "odgovor" && d[2] === t("temaPrivzeto")));
  });

  it("orodje zakljuci_povprasevanje + konec obrata: 'mark' po predvajanju, nato BYE (odlozi) in vse sprosceno", async () => {
    const o = okolje();
    await o.most.zacni();
    await cakajDo(() => o.live.odprtij === 1);
    o.live.emit({ setupComplete: {} });
    o.live.emit({ toolCall: { functionCalls: [{ id: "f1", name: "zakljuci_povprasevanje", args: { ime: "Ana Test", klicatelj_potrdil: true } }] } });
    await cakajDo(() => o.live.poslano.some((m) => m.toolResponse));
    o.live.emit(zvokLive(300));
    const zacetek = performance.now();
    o.live.emit({ serverContent: { turnComplete: true } });
    await o.most.koncan;
    const trajalo = performance.now() - zacetek;
    expect(o.klic.odlozen).toBe(1);
    // mark se vrne po predvajanju (~300 ms + rezerva), ne sele po varnostnem roku LiveMost (>= 2,5 s)
    expect(trajalo).toBeGreaterThan(250);
    expect(trajalo).toBeLessThan(1500);
    expect(o.most.stat.markov).toBeGreaterThanOrEqual(1);
    expect(o.dogodki.some((d) => d[0] === "povprasevanje")).toBe(true);
    expect(o.dogodki.at(-1)).toEqual(["zakljuci", o.most.callSid]);
    expect(o.zasedenost.sprosti).toEqual([o.most.callSid]);
    expect(o.live.zaprtih).toBeGreaterThanOrEqual(1);
    expect(o.most.steviloCasovnikov).toBe(0);
    expect(o.klic.listenerCount("zvok") + o.klic.listenerCount("konec")).toBe(0);
  });

  it("klicatelj odlozi (BYE): Live zaprt, zapis zakljucen, linija sproscena, casovniki in poslusalci odstranjeni", async () => {
    const o = okolje();
    await o.most.zacni();
    await cakajDo(() => o.live.odprtij === 1);
    o.live.emit({ setupComplete: {} });
    o.klic.govori(3);
    o.klic.odlozilKlicatelj("bye");
    await o.most.koncan;
    expect(o.live.zaprtih).toBeGreaterThanOrEqual(1);
    expect(o.dogodki.at(-1)).toEqual(["zakljuci", o.most.callSid]);
    expect(o.zasedenost.sprosti).toEqual([o.most.callSid]);
    expect(o.most.steviloCasovnikov).toBe(0);
    expect(o.klic.listenerCount("zvok") + o.klic.listenerCount("konec")).toBe(0);
    expect(o.most.most.konec).toBe(true);
    // zvok po koncu ne gre vec v Live
    const prej = o.live.zvokVhoda().length;
    o.klic.govori(5);
    await pocakaj(50);
    expect(o.live.zvokVhoda().length).toBe(prej);
  });

  it("omejitev dolzine (1 min): opozorilo 30 s pred iztekom v Live, ob izteku slovo (stalni posnetek), brez modela in BYE", async () => {
    const ura = { zdaj: 1_800_000_000_000 };
    const o = okolje({ ura, nastavitve: { najdaljsiMinut: 1 } });
    await o.most.zacni();
    await cakajDo(() => o.live.odprtij === 1);
    o.live.emit({ setupComplete: {} });
    ura.zdaj += 31_000;
    await cakajDo(() => o.dogodki.some((d) => d[0] === "cas" && d[2] === "opozorilo"));
    await cakajDo(() => o.live.poslano.some((m) => JSON.stringify(m).includes("Cas se izteka.")));
    expect(o.klic.odlozen).toBe(0);
    ura.zdaj += 35_000;
    await cakajDo(() => o.dogodki.some((d) => d[0] === "cas" && d[2] === "potek"));
    await cakajDo(() => o.posnetki.includes("Nasvidenje."));
    await o.most.koncan;
    expect(o.klic.odlozen).toBe(1);
    expect(o.live.zaprtih).toBeGreaterThanOrEqual(1);
    // po izteku model nic vec ne dobi
    const vLive = o.live.poslano.length;
    o.klic.govori(5);
    await pocakaj(50);
    expect(o.live.poslano.length).toBe(vLive);
    expect(o.dogodki.at(-1)).toEqual(["zakljuci", o.most.callSid]);
  });

  it("brez posnetka pozdrava z razkritjem se Live ne odpre in klic se konca (isto varovalo kot Twilio)", async () => {
    const o = okolje();
    (o.most as unknown as { most: { odv: OdvisnostiMosta } }).most.odv.posnetek = async () => null;
    await o.most.zacni();
    await o.most.koncan;
    expect(o.live.odprtij).toBe(0);
    expect(o.klic.odlozen).toBe(1);
  });

  it("napaka sprejema (RTP): ni seje Live ne zapisa, most se sprosti", async () => {
    const o = okolje();
    o.klic.napakaSprejema = true;
    await o.most.zacni();
    await o.most.koncan;
    expect(o.live.odprtij).toBe(0);
    expect(o.dogodki).toEqual([]);
    expect(o.most.steviloCasovnikov).toBe(0);
  });
});

describe("SIP-2 most: ciste funkcije", () => {
  it("stevilka klicatelja: samo stevilka gre v zapis (skrita ali ime -> prazno)", () => {
    expect(stevilkaKlicatelja("+38640000002")).toBe("+38640000002");
    expect(stevilkaKlicatelja("040 000 002")).toBe("040000002");
    expect(stevilkaKlicatelja("anonymous")).toBe("");
    expect(stevilkaKlicatelja("100;x=<script>")).toBe("");
    expect(stevilkaKlicatelja("")).toBe("");
  });
  it("oznaka klica SIP je nakljucna in v obliki, ki jo sprejme zapis klica", () => {
    const a = novSidSip();
    expect(a).toMatch(/^[A-Za-z0-9_-]{3,64}$/);
    expect(novSidSip()).not.toBe(a);
  });
});
