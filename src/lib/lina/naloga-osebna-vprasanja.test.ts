/**
 * Osebna tajnica, klic K3 (14. 11. 2026): (a) model samo kadar so pravila neodlocilna (brez nepotrebnih 2,5 s), (b) po zapisanem
 * sporocilu Lina vprasa »Imate se kaksno vprasanje?« in ne zakljuci takoj, (c) odgovori na vprasanja SAMO iz dejstev (stevilka klicatelja,
 * ime lastnika, UI), sicer »Tega ne vem«, (d) vprasanje v ISTEM izreku kot sporocilo. Ime in stevilka v preizkusih sta izmisljena.
 *
 * POSODOBLJENO 21. 11. 2026 na kasnejse odlocitve (dokaz v kodi): slovo brez »lep dan« in variante fraz (lastnik 14. 11. 2026, besedila.ts),
 * po zapisu potrditev »Zapisala sem: ... Ali sem prav razumela?« in pritrditev -> vprasanje za ime (15. 11. 2026, service.server.ts),
 * pravilo C: odgovor po zapisu dobi slovo, Lina poslusa naprej (lastnik 15. 11. 2026, osebna-slovo.ts), »Imate se kaksno vprasanje?« samo
 * enkrat na klic (lastnik po klicu K5), preostale izreke razume model z mejo 2,5 s (CodeRabbit 14. 11. 2026), model mora vrniti »vrsta«.
 * Kopija pred posodobitvijo: kopije-pred-popravki/osebna-vprasanja-1/.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { pocakajDnevnikGlasu, pocakajGlas, ustaviCiscenjeZvoka } from "./glas.server.ts";
import { stevilkaBesedno, vrstaVgrajenega } from "./osebna-polnila.ts";
import { razumiOsebniIzrek, varenOdgovorOsebna } from "./osebna-razumevanje.server.ts";
import { defaultPravila } from "./pravila.server.ts";
import type { ModelRazumevanja } from "./razumevanje.server.ts";
import { recordCaller } from "./service.server.ts";
import { writeJson } from "./store.server.ts";

process.env.LINA_LLM = "0";
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-osebna-vpr-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length) {
    const dir = dirs.pop() as string;
    await pocakajGlas(dir);
    await pocakajDnevnikGlasu(dir);
    ustaviCiscenjeZvoka(dir);
  }
});

const STEVILKA = "+38641123456";
const GOVOR = "nič štiri ena, ena dve tri, štiri pet šest";
const KONEC = "Hvala za klic, nasvidenje.";
const POTRDI = (s: string) => `Zapisala sem: ${s}. Ali sem prav razumela?`;
const SPOR = "pozdravite jo lepo in ji povejte da pridem v ponedeljek";
const VPRASANJE = "Imate še kakšno vprašanje?";

async function klic(sid: string, model: ModelRazumevanja | null) {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  dirs.push(dir);
  await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi", nacinKlica: "osebna", imeLastnika: "Ana" });
  const klicov = { n: 0 };
  const m: ModelRazumevanja =
    model === null
      ? async () => {
          klicov.n += 1;
          throw new Error("model ni na voljo");
        }
      : async (a, b) => {
          klicov.n += 1;
          return model(a, b);
        };
  await recordCaller({ callSid: sid, from: STEVILKA, text: "" }, dir, undefined, { razumevanje: m });
  const reci = (text: string, zaupanje?: number) => recordCaller({ callSid: sid, from: STEVILKA, text, ...(zaupanje ? { zaupanje } : {}) }, dir, undefined, { razumevanje: m });
  return { dir, klicov, reci };
}

describe("(a) model samo kadar so pravila neodlocilna", () => {
  it("jasno sporocilo (>= 4 vsebinske besede, brez vprasalnice): model NI poklican in obrat je hiter", async () => {
    const pocasen: ModelRazumevanja = () => new Promise((resolve) => setTimeout(() => resolve('{"vrsta":"pozdrav"}'), 2_000));
    const { klicov, reci } = await klic("CA-VPR-A1", pocasen);
    const zacetek = performance.now();
    const r = await reci("pozdravite jo lepo in ji povejte da pridem v ponedeljek");
    const ms = performance.now() - zacetek;
    console.log(`obrat brez modela: ${Math.round(ms)} ms`);
    // CodeRabbit 14. 11. 2026: preostale izreke razume model, meja 2,5 s (pocasen model tu vrne po 2 s).
    assert.equal(klicov.n, 1);
    assert.ok(ms < 2600, `obrat ${ms} ms`);
    assert.equal(r.reply, POTRDI(SPOR));
  });

  it("dvoumen izrek (1-3 besede) gre skozi model, izrek z vprasalnico tudi", async () => {
    const a = await klic("CA-VPR-A2", async () => '{"vrsta":"pozdrav","sporocilo":"","ime":""}');
    assert.equal((await a.reci("lepo pozdravljeni")).reply, "Izvolite, poslušam.");
    assert.equal(a.klicov.n, 1);
    const b = await klic("CA-VPR-A3", async () => '{"vrsta":"sporocilo","sporocilo":"pozdravite jo","ime":"","vprasanje":null}');
    await b.reci("pozdravite jo lepo prosim kaj delate");
    assert.equal(b.klicov.n, 1);
  });
});

describe("(b) po sporocilu Lina vprasa in ne zakljuci takoj", () => {
  it("sporocilo -> vprasanje; »ne, hvala« -> zahvala, slovo, konec; tisina -> konec", async () => {
    const { reci } = await klic("CA-VPR-B1", null);
    const a = await reci("pozdravite jo lepo in ji povejte da pridem v ponedeljek");
    assert.equal(a.reply, POTRDI(SPOR));
    assert.notEqual(a.call.status, "zakljucen");
    const k = await reci("ne, hvala");
    assert.equal(k.reply, KONEC);
    assert.equal(k.call.status, "zakljucen");
    const tisina = await klic("CA-VPR-B2", null);
    await tisina.reci("pozdravite jo lepo in ji povejte da pridem v ponedeljek");
    const t = await recordCaller({ callSid: "CA-VPR-B2", text: "" }, tisina.dir, undefined, { razumevanje: async () => null });
    assert.equal(t.reply, KONEC);
    assert.equal(t.call.status, "zakljucen");
  });

  it("dodatno sporocilo dopolni zapisek; po 3 dodatnih obratih zahvala in slovo", async () => {
    const { reci } = await klic("CA-VPR-B3", null);
    await reci("pozdravite jo lepo in ji povejte da pridem v ponedeljek");
    const a = await reci("pa naj prinese tudi mapo z dokumenti");
    assert.equal(a.reply, "Sporočilo sem zapisala. " + KONEC, "pravilo C: slovo, Lina poslusa naprej");
    assert.notEqual(a.call.status, "zakljucen");
    assert.match(a.call.order.tajnica?.sporocilo ?? "", /pridem v ponedeljek\. pa naj prinese tudi mapo z dokumenti/, "dopolnilo z locilom, ne zlepek");
    assert.match(a.call.order.tajnica?.izrek ?? "", /pridem v ponedeljek.*mapo z dokumenti/);
    await reci("in se kljuce od pisarne");
    const tretji = await reci("ter jopo ki sem jo pozabil");
    assert.equal(tretji.call.status, "zakljucen");
    assert.match(tretji.call.order.tajnica?.sporocilo ?? "", /jopo/);
  });
});

describe("(c) odgovori SAMO iz dejstev", () => {
  it("»Ali imate mojo stevilko?« -> stevilka po slovensko iz From (brez stevk), brez obljube klica, klic ostane odprt", async () => {
    const { reci } = await klic("CA-VPR-C1", null);
    await reci("pozdravite jo lepo in ji povejte da pridem v ponedeljek");
    const r = await reci("Ali imate mojo številko?");
    assert.equal(r.reply, `Da, vidim, da ste poklicali s številke ${GOVOR}. Sporočilo in vašo številko bom posredovala. ${KONEC}`);
    assert.doesNotMatch(r.reply, /\d|pokličem|pokliče/);
    assert.notEqual(r.call.status, "zakljucen");
  });

  it("izven dejstev (kdaj, kje, cene) -> stalno »Tega ne vem«, brez modela", async () => {
    const { reci, klicov } = await klic("CA-VPR-C2", null);
    await reci("pozdravite jo lepo in ji povejte da pridem v ponedeljek");
    const r = await reci("Kdaj me bo poklicala nazaj?");
    assert.equal(r.reply, `Tega ne vem, sporočilo pa bom posredovala. ${KONEC}`);
    assert.equal(klicov.n, 1, "model samo za sporocilo, vprasanje gre po hitri poti");
  });

  it("prosto vprasanje: model dobi samo dejstva; veljaven odgovor gre skozi, izmisljen ne", async () => {
    const VPR = "Ali ste vi ena od teh novih tajnic?";
    const izid = (odgovor: string) => JSON.stringify({ vrsta: "vprasanje", sporocilo: "", ime: "", vprasanje: "ali ste vi ena od teh novih tajnic", odgovor });
    // Model se poklice tudi za sporocilo; takrat vrze (pravila kode zapisejo sporocilo), za vprasanje vrne izid.
    const dobri = await klic("CA-VPR-C3", async (sistem, vhod) => {
      if (!/novih tajnic/.test(vhod)) throw new Error("ni vprasanje");
      assert.match(vhod, /Ana/);
      assert.match(vhod, new RegExp(GOVOR));
      assert.doesNotMatch(vhod, /\+386|41123456/);
      return izid("Sem pomočnica z umetno inteligenco.");
    });
    await dobri.reci(SPOR);
    const r = await dobri.reci(VPR);
    assert.match(r.reply, /^Sem pomočnica z umetno inteligenco\./);
    for (const [i, slab] of [izid("Ana vas bo poklicala jutri ob 9."), izid("Peter je v službi."), izid("Vaša številka je 041."), "ni json"].entries()) {
      const k = await klic(`CA-VPR-C4${i}`, async (_s, vhod) => {
        if (!/novih tajnic/.test(vhod)) throw new Error("ni vprasanje");
        return slab;
      });
      await k.reci(SPOR);
      const o = await k.reci(VPR);
      assert.doesNotMatch(o.reply, /jutri|Peter|041|službi/, slab);
      assert.match(o.reply, /nasvidenje\.$/, slab);
    }
  });

  it("varovalo odgovora in izgovor stevilke", async () => {
    const d = { imeLastnika: "Ana", stevilkaBesedno: GOVOR, izrek: "x", zapisano: false };
    // API: varenOdgovorOsebna dobi ze razbrano besedilo odgovora (JSON razbere razberiOsebno).
    assert.equal(varenOdgovorOsebna("Sem pomočnica z umetno inteligenco.", d), "Sem pomočnica z umetno inteligenco.");
    assert.equal(varenOdgovorOsebna(null, d), null);
    assert.equal(varenOdgovorOsebna("Ana je odsotna.", d), null);
    assert.equal(await razumiOsebniIzrek("kdo", "", { dejstva: { ...d, zapisano: false }, model: () => new Promise(() => undefined), rokMs: 30 }), null, "rok");
    assert.equal(stevilkaBesedno("+38641123456"), GOVOR);
    assert.equal(stevilkaBesedno("+4930123456"), "plus štiri devet tri, nič ena dve, tri štiri pet, šest");
    assert.equal(stevilkaBesedno(""), "");
  });
});

describe("(d) vprasanje v ISTEM izreku kot sporocilo (klic K3)", () => {
  const IZREK = "zdravo oprostite samo rad bi pozdravil da ga pozdravila ampak imam lepo pa da naj me pokliče kaj številke";
  const NEJASNO = `Nisem prepričana, da sem vas prav razumela. Imam vašo številko ${GOVOR}, sporočilo sem zapisala. ${VPRASANJE}`;

  it("brez modela (pade): sporocilo zapisano dobesedno, nejasno vprasanje -> iskren odgovor s stevilko iz From", async () => {
    const { dir, reci } = await klic("CA-VPR-D1", null);
    const r = await reci(IZREK);
    assert.equal(r.reply, NEJASNO);
    assert.notEqual(r.call.status, "zakljucen");
    assert.match(r.call.order.tajnica?.izrek ?? "", /pozdravil da ga pozdravila ampak imam lepo/);
    assert.match(r.call.order.tajnica?.izrek ?? "", /kaj številke/);
    void dir;
  });

  it("lazen model z vprasanjem iz izreka: isti odgovor; vprasanje, ki ga v izreku ni, model ne more dodati", async () => {
    const m1 = await klic("CA-VPR-D2", async () => JSON.stringify({ vrsta: "sporocilo", sporocilo: "pozdravil naj me pokliče", ime: "", vprasanje: "kaj številke" }));
    assert.equal((await m1.reci(IZREK)).reply, NEJASNO);
    const m2 = await klic("CA-VPR-D3", async () => JSON.stringify({ vrsta: "sporocilo", sporocilo: "pozdravil naj me pokliče", ime: "", vprasanje: "ali imate mojo telefonsko kodo" }));
    // vprasanje ni dobesedno iz izreka -> null -> pravila izreka dajo isti nejasen odgovor
    assert.equal((await m2.reci(IZREK)).reply, NEJASNO);
  });

  it("jasno vprasanje v izreku (»ali imate mojo stevilko«) brez modela: odgovor iz From", async () => {
    const { reci } = await klic("CA-VPR-D4", null);
    const r = await reci("pozdravite jo lepo in ji povejte da pridem v ponedeljek ali imate mojo številko");
    assert.equal(r.reply, `Da, vidim, da ste poklicali s številke ${GOVOR}. Sporočilo in vašo številko bom posredovala. ${VPRASANJE}`);
  });

  it("vzorci brez modela", () => {
    assert.equal(vrstaVgrajenega("ali imate mojo številko"), "stevilka");
    assert.equal(vrstaVgrajenega("naj me pokliče kaj številke"), "stevilkaNejasno");
    assert.equal(vrstaVgrajenega("naj me pokliče na številko"), null, "sporocilo, ki omenja stevilko, ni vprasanje");
    assert.equal(vrstaVgrajenega("kdo ste"), "ai");
    assert.equal(vrstaVgrajenega("koliko je ura"), "nevem");
    assert.equal(vrstaVgrajenega("pridem v ponedeljek"), null);
  });
});

describe("klic K4: hitrost in smeti po sporocilu", () => {
  const pocasen: ModelRazumevanja = () => new Promise((resolve) => setTimeout(() => resolve('{"vrsta":"pozdrav"}'), 2_000));
  const SPOROCILO = "pozdravite jo lepo in ji povejte da pridem v ponedeljek";

  it("sporocilo + popacena stevilka (»a imas moj stevilk«, »stevilko«, »stevilke«): model NI poklican, obrat < 500 ms, odgovor s stevilko", async () => {
    for (const [i, vpr] of ["a imas moj stevilk", "ali imate mojo številko", "imaš mojo številke", "a imas moje stevilko"].entries()) {
      const { klicov, reci, dir } = await klic(`CA-VPR-E${i}`, pocasen);
      const zacetek = performance.now();
      const r = await reci(`pozdravite jo lepo ${vpr}`);
      const ms = performance.now() - zacetek;
      console.log(`obrat sporocilo + »${vpr}«: ${Math.round(ms)} ms, klicev modela ${klicov.n}`);
      assert.equal(klicov.n, 0, vpr);
      assert.ok(ms < 500, `${vpr}: ${ms} ms`);
      assert.match(r.reply, new RegExp(`^Da, vidim, da ste poklicali s številke ${GOVOR}\\.`), vpr);
      assert.match(r.call.order.tajnica?.izrek ?? "", /pozdravite jo lepo/);
      void dir;
    }
  });

  it("samo vprasanje o stevilki pred sporocilom: odgovor in nazaj k sporocilu", async () => {
    const { klicov, reci } = await klic("CA-VPR-E5", pocasen);
    const r = await reci("a imas moj stevilk");
    assert.equal(r.reply, `Da, vidim, da ste poklicali s številke ${GOVOR}. Sporočilo in vašo številko bom posredovala. Katero sporočilo želite pustiti?`);
    assert.equal(klicov.n, 0);
    assert.equal(r.call.order.tajnica, undefined);
  });

  it("po sporocilu: vprasanje o stevilki dobi odgovor brez modela, STT-smeti se ne dopisejo, drugic slovo", async () => {
    const { klicov, reci } = await klic("CA-VPR-E6", pocasen);
    const a = await reci(SPOROCILO);
    const izvirno = a.call.order.tajnica?.sporocilo;
    const stev = await reci("a imas moj stevilk");
    assert.match(stev.reply, /^Da, vidim, da ste poklicali s številke/);
    assert.equal(klicov.n, 1, "model samo za sporocilo");
    const smet1 = await reci("tako tako pa");
    assert.equal(smet1.reply, "Izvolite.");
    assert.equal(smet1.call.order.tajnica?.sporocilo, izvirno, "smeti niso v sporocilu");
    assert.equal(smet1.call.order.tajnica?.izrek?.includes("tako tako"), false, "tudi ne v izreku");
    const smet2 = await reci("evo tako pa");
    assert.match(smet2.reply, /^Hvala(, | za klic, )nasvidenje\.$/, "varianta slovesa");
    assert.equal(smet2.call.status, "zakljucen");
    assert.equal(smet2.call.order.tajnica?.sporocilo, izvirno);
    assert.ok(smet2.call.transcript.some((v) => v.role === "stranka" && /evo tako pa/.test(v.text)), "ostane v transcriptu");
  });

  it("»super/hvala« po sporocilu = konec; pritrditev »aha/v redu/ok« na »Ali sem prav razumela?« = enkrat vprasanje za ime", async () => {
    for (const [i, beseda] of ["super", "hvala", "super hvala"].entries()) {
      const { reci } = await klic(`CA-VPR-F${i}`, null);
      await reci(SPOROCILO);
      const k = await reci(beseda);
      assert.equal(k.reply, KONEC, beseda);
      assert.equal(k.call.status, "zakljucen");
    }
    for (const [i, beseda] of ["Aha.", "v redu", "ok"].entries()) {
      const { reci } = await klic(`CA-VPR-F${i + 3}`, null);
      await reci(SPOROCILO);
      const k = await reci(beseda);
      assert.equal(k.reply, "Kako vam je ime?", beseda);
      assert.notEqual(k.call.status, "zakljucen");
    }
  });
});

describe("lastnikova ocena K4: prosnja za cakanje in tisina po sporocilu", () => {
  const SPOROCILO = "pozdravite jo lepo in ji povejte da pridem v ponedeljek";
  it("»pocakaj / trenutek / je preden odgovoris« po sporocilu: samo »Izvolite.«, brez dopisa in zakljucka", async () => {
    const { reci } = await klic("CA-VPR-G1", null);
    const prvi = await reci(SPOROCILO);
    const izvirno = prvi.call.order.tajnica?.sporocilo;
    for (const [i, izrek] of ["je preden odgovoriš", "počakaj", "trenutek prosim"].entries()) {
      const r = await reci(izrek);
      if (i < 2) {
        assert.match(r.reply, /^(Izvolite|Prosim|Poslušam)\.$/, izrek);
        assert.notEqual(r.call.status, "zakljucen");
      }
      assert.equal(r.call.order.tajnica?.sporocilo, izvirno, izrek);
    }
    // po mejnem stevilu prosenj ne cakamo v nedogled: tretja je navadna smet (vprasanje ali slovo), nikoli dopis
  });

  it("tisina osebne tajnice je privzeto 2 s (17. 11. 2026: tudi pred sporocilom); lastnikova vrednost ostane", async () => {
    const { createHmac } = await import("node:crypto");
    const naredi = async (sid: string, extra: Record<string, unknown>) => {
      const dir = await mkdtemp(path.join(KOREN, "d-"));
      dirs.push(dir);
      await writeJson(dir, "line.json", { open: true, catalog: { company: { name: "Podjetje Primer", trade: "", phone: "", address: "", hours: "", about: "" }, materials: [], products: [], zapiski: [], znanje: "" }, updatedAt: null });
      await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi", nacinKlica: "osebna", imeLastnika: "Ana", ...extra });
      process.env.TWILIO_AUTH_TOKEN = "zeton-preizkusa";
      const { handleVoiceRequest } = await import("./voice.server.ts");
      const k = async (pot: string, params: Record<string, string>) => {
        const url = `https://lina.primer${pot}`;
        const podpis = createHmac("sha1", "zeton-preizkusa").update(Object.keys(params).sort().reduce((a, key) => a + key + params[key], url)).digest("base64");
        const r = await handleVoiceRequest(new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": podpis }, body: new URLSearchParams(params).toString() }), dir, undefined, { razumevanje: async () => null } as never);
        return r.text();
      };
      const a = await k("/api/voice/incoming", { CallSid: sid, From: STEVILKA });
      const b = await k("/api/voice/turn?obr=1", { CallSid: sid, From: STEVILKA, SpeechResult: SPOROCILO });
      delete process.env.TWILIO_AUTH_TOKEN;
      return { a, b };
    };
    const privzeto = await naredi("CA-VPR-G2", {});
    assert.match(privzeto.a, /speechTimeout="2"/, "pravila.server.ts 17. 11. 2026: osebna privzeto 2 s");
    assert.match(privzeto.b, /Ali sem prav razumela\?/);
    assert.match(privzeto.b, /speechTimeout="2"/);
    const lastnik = await naredi("CA-VPR-G3", { tisinaPoGovoruSek: 4, tisinaNastavil: true });
    assert.match(lastnik.b, /speechTimeout="4"/);
  });
});

describe("smeti po sporocilu: najvec enkrat vprasanje, drugic slovo", () => {
  it("dva zaporedna izreka brez vsebine -> prvic vprasanje, drugic zahvala in slovo", async () => {
    const { reci } = await klic("CA-VPR-H1", null);
    const prvi = await reci("pozdravite jo lepo in ji povejte da pridem v ponedeljek");
    const a = await reci("tako tako pa");
    assert.equal(a.reply, "Izvolite.");
    const b = await reci("evo tako pa");
    assert.equal(b.reply, KONEC);
    assert.equal(b.call.status, "zakljucen");
    assert.equal(b.call.order.tajnica?.sporocilo, prvi.call.order.tajnica?.sporocilo);
  });
});
