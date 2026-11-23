// 22. 11. 2026 lastnik: »Pogovor se zapisuje more povedati, ker je takšen zakon« - pozdrav ima stavek o zapisovanju.
/**
 * Osebna tajnica (lastnik, 14. 11. 2026): razkritje UI, »Poklicali ste <ime>«, edino vprasanje je sporocilo, zahvala in slovo;
 * nic o podjetju, izdelkih, materialu, telefonu, e-posti ali roku. Razkritje UI je v VSEH nacinih prvi stavek (trdo pravilo).
 * Ime lastnika je nastavitev; v preizkusih izmisljeno (Ana).
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { stalniStavki } from "./glas.ts";
import { nastaviSintezoZaPreizkus, pocakajDnevnikGlasu, pocakajGlas, pripraviStalne, ustaviCiscenjeZvoka } from "./glas.server.ts";
import { defaultPravila, loadPravila, normalizePravila } from "./pravila.server.ts";
import { osebniZakljucek, uvodKlica } from "./povzetek.ts";
import type { ModelRazumevanja } from "./razumevanje.server.ts";
import { preberiKlic, recordCaller } from "./service.server.ts";
import { naslovZapiska, vsebinaZapiska } from "./zapiski.ts";
import { writeJson } from "./store.server.ts";
import type { Catalog } from "./types.ts";
import { handleVoiceRequest } from "./voice.server.ts";

process.env.LINA_LLM = "0";
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-osebna-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const dirs: string[] = [];
afterEach(async () => {
  nastaviSintezoZaPreizkus(null);
  delete process.env.TWILIO_AUTH_TOKEN;
  while (dirs.length) {
    const dir = dirs.pop() as string;
    await pocakajGlas(dir);
    await pocakajDnevnikGlasu(dir);
    ustaviCiscenjeZvoka(dir);
  }
});

const katalog: Catalog = {
  company: { name: "Podjetje Primer", trade: "", phone: "+386 1 555 09 00", address: "", hours: "", about: "" },
  materials: [{ id: "m1", name: "Hrast", note: "" }],
  products: [{ id: "p1", name: "Alfa", kind: "miza", summary: "", materialIds: ["m1"] }],
  zapiski: [],
  znanje: "Delamo mize.",
};

async function nov(pravila: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  dirs.push(dir);
  await writeJson(dir, "line.json", { open: true, catalog: katalog, updatedAt: null });
  await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi", ...pravila });
  return dir;
}

const PREPOVEDANO = /podjetj|izdel|katalog|material|telefon|po[sš]t|rok\b|povratn|cen[ae]\b|miz/i;
/** Sporocilo, nato »ne, hvala« (Lina po zapisanem sporocilu vpraša, ali ima klicatelj se vprasanje): vrne zadnji obrat (konec klica). */
async function sporociloInKonec(sid: string, dir: string, m: object, text: string) {
  const prvi = await recordCaller({ callSid: sid, text }, dir, undefined, m);
  assert.match(prvi.reply, /^Zapisala sem: .* Ali sem prav razumela\?$/);
  assert.notEqual(prvi.call.status, "zakljucen");
  // 15. 11. 2026: »da« na potrditev; brez imena Lina enkrat vpraša za ime, klicatelj ga ne pove.
  const da = await recordCaller({ callSid: sid, text: "da" }, dir, undefined, m);
  if (da.reply !== "Kako vam je ime?") return da;
  assert.notEqual(da.call.status, "zakljucen");
  return recordCaller({ callSid: sid, text: "ne, hvala" }, dir, undefined, m);
}
const nikoliModel: ModelRazumevanja = async () => {
  throw new Error("model ne sme biti poklican v osebnem nacinu");
};

describe("osebna tajnica: potek klica", () => {
  it("pozdrav, edino vprasanje je sporocilo, zahvala in slovo; nic o podjetju", async () => {
    const dir = await nov({ nacinKlica: "osebna", imeLastnika: "Ana" });
    const sid = "CA-OSEBNA-1";
    const m = { razumevanje: nikoliModel };
    const pozdrav = await recordCaller({ callSid: sid, from: "+38640000000", text: "" }, dir, undefined, m);
    assert.equal(
      pozdrav.reply,
      "Tukaj Lina, pomočnica z umetno inteligenco. Pogovor se zapisuje. Poklicali ste Ano. Kaj naj sporočim?",
    );
    assert.equal((pozdrav.reply.match(/\?/g) ?? []).length, 1, "edino vprasanje je sporocilo");
    const nazaj = await recordCaller({ callSid: sid, text: "kakšne izdelke imate" }, dir, undefined, m);
    assert.match(nazaj.reply, /Katero sporočilo želite pustiti\?/);
    const konec = await sporociloInKonec(sid, dir, m, "sem Jan Primer in prosim da mi poveste da je sestanek prestavljen");
    assert.equal(konec.call.status, "zakljucen");
    assert.equal(konec.reply, "Hvala za klic, nasvidenje.");
    assert.match(konec.reply, /Hvala/);
    assert.match(konec.call.order.tajnica?.sporocilo ?? "", /sestanek prestavljen/);
    assert.match(konec.call.stik?.ime ?? "", /Jan/);
    for (const odgovor of [pozdrav.reply.replace(/Poklicali ste Ano\./, ""), nazaj.reply, konec.reply]) assert.doesNotMatch(odgovor, PREPOVEDANO, odgovor);
    const zapis = await preberiKlic(sid, dir);
    assert.match(JSON.stringify(zapis), /sestanek prestavljen/);
  });

  it("brez imena lastnika: nevtralna oblika brez ugibanja spola", () => {
    const uvod = uvodKlica({ pozdrav: "", nacinKlica: "osebna", imeLastnika: "" });
    assert.match(uvod, /^Tukaj Lina, pomočnica z umetno inteligenco\. Pogovor se zapisuje\. Dosegli ste glasovno tajnico\. Kaj naj sporočim\?$/);
    assert.doesNotMatch(uvod, /\b(mu|ji)\b/);
  });

  it("klic v osebnem nacinu preko Twilio: Say znotraj Gather s pozdravom, po sporocilu zahvala in Hangup", async () => {
    const dir = await nov({ nacinKlica: "osebna", imeLastnika: "Ana" });
    process.env.TWILIO_AUTH_TOKEN = "zeton-preizkusa";
    const klic = async (pot: string, params: Record<string, string>) => {
      const url = `https://lina.primer${pot}`;
      const podpis = createHmac("sha1", "zeton-preizkusa").update(Object.keys(params).sort().reduce((a, k) => a + k + params[k], url)).digest("base64");
      const r = await handleVoiceRequest(
        new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": podpis }, body: new URLSearchParams(params).toString() }),
        dir,
        undefined,
        { razumevanje: nikoliModel } as never,
      );
      return r.text();
    };
    const a = await klic("/api/voice/incoming", { CallSid: "CA-OSEBNA-2", From: "+38640000000" });
    assert.match(a, /<Gather [^>]*><Say language="sl-SI">Tukaj Lina, pomočnica z umetno inteligenco\. Pogovor se zapisuje\. Poklicali ste Ano\. Kaj naj sporočim\?<\/Say>/);
    const b = await klic("/api/voice/turn?obr=1", { CallSid: "CA-OSEBNA-2", From: "+38640000000", SpeechResult: "Naj me jutri pokliče nazaj ker je urgenca." });
    assert.match(b, /Zapisala sem: Naj me jutri pokliče nazaj ker je urgenca\. Ali sem prav razumela\?/);
    assert.doesNotMatch(b, /<Hangup\/>/);
    const c0 = await klic("/api/voice/turn?obr=2", { CallSid: "CA-OSEBNA-2", From: "+38640000000", SpeechResult: "Da." });
    assert.match(c0, /Kako vam je ime\?/);
    assert.doesNotMatch(c0, /<Hangup\/>/);
    const c = await klic("/api/voice/turn?obr=3", { CallSid: "CA-OSEBNA-2", From: "+38640000000", SpeechResult: "Ne, hvala." });
    assert.match(c, /Hvala za klic, nasvidenje\./);
    assert.match(c, /<Hangup\/>/);
    assert.doesNotMatch(b.replace(/<[^>]*>/g, " "), PREPOVEDANO);
  });

  it("stalni stavki: pozdrav in zakljucek sta vsak ENA sinteza; brez kataloga", async () => {
    const pravila = { ...defaultPravila(), nacinKlica: "osebna" as const, imeLastnika: "Ana" };
    const stavki = stalniStavki(pravila, "Podjetje Primer", katalog);
    assert.ok(stavki.includes(uvodKlica(pravila)));
    assert.ok(stavki.includes(osebniZakljucek()));
    assert.ok(stavki.every((s) => !/Alfa|Hrast/.test(s)));
    const dir = await mkdtemp(path.join(KOREN, "g-"));
    dirs.push(dir);
    const besedila: string[] = [];
    nastaviSintezoZaPreizkus(async (b) => {
      besedila.push(b);
      return Buffer.alloc(4800);
    });
    await pripraviStalne(dir, stavki);
    assert.equal(besedila.filter((b) => b.startsWith("Tukaj Lina") && b.includes("Poklicali ste")).length, 1, "pozdrav = en zahtevek");
    assert.equal(besedila.filter((b) => b.includes(osebniZakljucek())).length, 1, "zakljucek = en zahtevek");
    assert.equal(besedila.filter((b) => b.includes("Imate še kakšno vprašanje")).length, 2, "vprasanje in zapisana = vsak en zahtevek");
  });

  it("privzeto ostane nacin podjetja; osebna ne gre po poti Live", () => {
    assert.equal(defaultPravila().nacinKlica, "podjetje");
    assert.equal(normalizePravila({ nacinKlica: "karkoli" as never }).nacinKlica, "podjetje");
    const p = normalizePravila({ nacinKlica: "osebna", naPot: "live", imeLastnika: "  Ana  " });
    assert.equal(p.naPot, "gather");
    assert.equal(p.imeLastnika, "Ana");
  });
});

describe("razkritje UI je prvi stavek v vseh nacinih (trdo pravilo)", () => {
  const prvi = (besedilo: string) => besedilo.split(/(?<=[.!?])\s/)[0] ?? "";
  for (const nacinKlica of ["podjetje", "osebna"] as const) {
    it(`${nacinKlica}: tudi s pozdravom po meri je razkritje prvi stavek`, () => {
      const uvod = uvodKlica({ pozdrav: "Pozdravljeni pri nas doma.", nacinKlica, imeLastnika: "Ana" }, "Podjetje Primer");
      assert.match(prvi(uvod), /umetno inteligenco/);
      assert.match(uvod, /Pozdravljeni pri nas doma\./, "pozdrav po meri je za razkritjem");
      assert.ok(uvod.indexOf("Pozdravljeni pri nas doma.") > uvod.indexOf("umetno inteligenco"));
    });

    it(`${nacinKlica}: rezervna pot brez posnetka (<Say>) ima razkritje v prvem stavku`, async () => {
      const dir = await nov({ nacinKlica, imeLastnika: "Ana", pozdrav: "Pozdravljeni pri nas doma." });
      process.env.TWILIO_AUTH_TOKEN = "zeton-preizkusa";
      const url = "https://lina.primer/api/voice/incoming";
      const params: Record<string, string> = { CallSid: `CA-RAZKRITJE-${nacinKlica}`, From: "+38640000000" };
      const podpis = createHmac("sha1", "zeton-preizkusa").update(Object.keys(params).sort().reduce((a, k) => a + k + params[k], url)).digest("base64");
      const r = await handleVoiceRequest(
        new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": podpis }, body: new URLSearchParams(params).toString() }),
        dir,
      );
      const xml = await r.text();
      const govor = /<Say[^>]*>([^<]+)<\/Say>/.exec(xml)?.[1] ?? "";
      assert.match(prvi(govor), /umetno inteligenco/, xml);
    });
  }
});

describe("razkritje UI v prvem stavku na vseh zgodnjih poteh prvega obrata", () => {
  const prvi = (besedilo: string) => besedilo.split(/(?<=[.!?])\s/)[0] ?? "";
  const vpr: ModelRazumevanja = async () => '{"namen":"vprasanje","material":"","odgovor":"Delamo mize. Delamo tudi stole."}';
  const primeri: Array<[string, string, string]> = [
    ["osebna", "sporocilo ze v prvem obratu", "Prosim povejte da sem klical glede sestanka."],
    ["osebna", "vprasanje v prvem obratu", "kakšne izdelke imate"],
    ["osebna", "samo ime v prvem obratu", "sem Jan Primer"],
    ["podjetje", "potreba v prvem obratu", "Jan Primer, mize sto kosov"],
    ["podjetje", "vprasanje o podjetju v prvem obratu", "kaj sploh delate"],
    ["podjetje", "ime v prvem obratu", "Jan Primer"],
  ];
  for (const [nacinKlica, opis, text] of primeri) {
    it(`${nacinKlica}: ${opis}`, async () => {
      const dir = await nov({ nacinKlica, imeLastnika: "Ana", podrobniPotek: false });
      const izid = await recordCaller({ callSid: `CA-ZGODNJI-${nacinKlica}-${opis.length}`, from: "+38640000000", text }, dir, undefined, { razumevanje: vpr });
      assert.ok(izid.reply.trim().length > 0);
      assert.match(prvi(izid.reply), /umetno inteligenco/, izid.reply);
      assert.equal((izid.reply.match(/umetno inteligenco/g) ?? []).length, 1, "razkritje samo enkrat: " + izid.reply);
    });
  }
});

describe("osebna tajnica: povzetek in zapisek govorita samo o kdo, sporocilu in casu", () => {
  const BREZ = /ponudb|naro[cč]il|\bcen[aeo]?\b|povpra[sš]evanj|obljub/i;
  it("brez imena: kdo je stevilka, sporocilo dobesedno, naslov zapiska ni »Neznan klicatelj«; brez ponudbe in narocila", async () => {
    const dir = await nov({ nacinKlica: "osebna", imeLastnika: "Ana" });
    const sid = "CA-OSEBNA-POVZETEK";
    const m = { razumevanje: nikoliModel };
    await recordCaller({ callSid: sid, from: "+38641123456", text: "" }, dir, undefined, m);
    const konec = await sporociloInKonec(sid, dir, m, "Prosim povejte da pridem v ponedeljek ob devetih.");
    assert.equal(konec.call.status, "zakljucen");
    const p = konec.call.povzetek;
    assert.ok(p);
    assert.equal(p.kdo, "+38641123456");
    assert.equal(p.zelel, "Prosim povejte da pridem v ponedeljek ob devetih.");
    assert.equal(p.sporocilo, "Prosim povejte da pridem v ponedeljek ob devetih.");
    assert.ok(p.cas);
    assert.equal(p.obljubila, "");
    assert.equal(p.narediti, "");
    assert.doesNotMatch(JSON.stringify([p.kdo, p.zelel, p.sporocilo, p.obljubila, p.narediti]), BREZ);
    const vsebina = vsebinaZapiska(konec.call);
    assert.doesNotMatch(naslovZapiska(konec.call), /Neznan/);
    assert.match(naslovZapiska(konec.call), /^\+38641123456 - /);
    assert.doesNotMatch(vsebina.split("## ")[0], BREZ, vsebina);
    assert.doesNotMatch(vsebina, /Potrjeno/);
    assert.match(vsebina, /Prosim povejte da pridem v ponedeljek ob devetih\./);
  });

  it("z imenom: kdo je ime", async () => {
    const dir = await nov({ nacinKlica: "osebna", imeLastnika: "Ana" });
    const sid = "CA-OSEBNA-POVZETEK2";
    const m = { razumevanje: nikoliModel };
    await recordCaller({ callSid: sid, from: "+38641123456", text: "" }, dir, undefined, m);
    const konec = await sporociloInKonec(sid, dir, m, "sem Jan Primer, prosim naj me pokliče nazaj danes");
    assert.match(konec.call.povzetek?.kdo ?? "", /Jan/);
    assert.match(naslovZapiska(konec.call), /^Jan/);
  });

  it("nacin podjetja ostane pri starem povzetku", async () => {
    const dir = await nov({ nacinKlica: "podjetje", podrobniPotek: false });
    const sid = "CA-PODJETJE-POVZETEK";
    const m = { razumevanje: nikoliModel };
    await recordCaller({ callSid: sid, from: "+38641123456", text: "" }, dir, undefined, m);
    const konec = await recordCaller({ callSid: sid, text: "Jan Primer, mize sto kosov" }, dir, undefined, m);
    assert.match(konec.call.povzetek?.obljubila ?? "", /Nisem potrdila narocila/);
  });
});
