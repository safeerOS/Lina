/**
 * Naloga G4f (lastnik 11. 11. 2026: >>kolicina dva<< ni dobro): Lina rece >>Naročate dve mizi iz materiala hrast.<<.
 * Sklanjanje naredi model (tu lazni), izhod gre skozi varovala; sicer oblika B iz G4e. Stavek se pripravi vnaprej,
 * povzetek ga samo prebere iz pomnilnika (brez cakanja). Brez pravega omrezja; komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { formaCatalog } from "./catalog.ts";
import {
  mapaZvoka,
  nastaviSintezoZaPreizkus,
  pocakajDnevnikGlasu,
  pocakajGlas,
  ponastaviOdklopnik,
  ustaviCiscenjeZvoka,
} from "./glas.server.ts";
import { pocistiStavkeNarocila, preveriStavekNarocila } from "./narocilo-stavek.ts";
import {
  NAVODILO_STAVKA,
  nastaviModelStavkaZaPreizkus,
  pocistiZavrnjeneStavke,
  pripraviStavekNarocila,
} from "./narocilo-stavek.server.ts";
import { defaultPravila } from "./pravila.server.ts";
import { deliPovzetka, deliZaPredpripravo, povzetekZaPotrditev, stavekNarocila } from "./povzetek.ts";
import { pripraviGlasObZagonu, recordCaller } from "./service.server.ts";
import { writeJson } from "./store.server.ts";
import type { CallSession } from "./types.ts";
import { handleVoiceRequest, pocakajOzadjeKlicev, ustaviCiscenjeOpravil } from "./voice.server.ts";

process.env.LINA_LLM = "0";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-g4f-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const temps: string[] = [];

afterEach(async () => {
  await pocakajOzadjeKlicev();
  delete process.env.TWILIO_AUTH_TOKEN;
  nastaviSintezoZaPreizkus(null);
  nastaviModelStavkaZaPreizkus(null);
  pocistiStavkeNarocila();
  pocistiZavrnjeneStavke();
  ponastaviOdklopnik();
  ustaviCiscenjeOpravil();
  while (temps.length) {
    const dir = temps.pop();
    if (!dir) continue;
    await pocakajGlas(dir);
    await pocakajDnevnikGlasu(dir);
    ustaviCiscenjeZvoka(dir);
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

/** Klic z izmisljenimi podatki (brez omrezja in brez pravih oseb). */
function klicZ(order: Partial<CallSession["order"]>, ime = ""): CallSession {
  return {
    order: {
      customerName: "ni podatka",
      phone: "",
      productName: null,
      materialName: null,
      requestedProduct: null,
      requestedMaterial: null,
      quantity: null,
      notes: "",
      deadline: null,
      ...order,
    },
    stik: { ime },
  } as unknown as CallSession;
}

const MIZE = (kolicina: number | null) =>
  klicZ({ requestedProduct: "miza", requestedMaterial: "hrast", quantity: kolicina, deadline: "petka" }, "Ana Primer");
/** Oblika B iz G4e: pricakovan nadomestek ob vsaki zavrnitvi. */
const B = "Naročate izdelek miza iz materiala hrast, v količini 2, rok pa je do petka.";

function stevecModela(odgovor: string | (() => string)) {
  const stanje = { klici: 0, vhodi: [] as string[], sistemi: [] as string[] };
  nastaviModelStavkaZaPreizkus(async (sistem, besedilo) => {
    stanje.klici += 1;
    stanje.vhodi.push(besedilo);
    stanje.sistemi.push(sistem);
    return typeof odgovor === "function" ? odgovor() : odgovor;
  });
  return stanje;
}

describe("naloga G4f (1): pravilen izhod modela se izgovori", { concurrency: 1 }, () => {
  it("dve mizi: stavek je >>Naročate dve mizi iz materiala hrast, rok pa je do petka.<<, ne >>količina 2<<", async () => {
    const model = stevecModela("Naročate dve mizi iz materiala hrast.");
    const klic = MIZE(2);
    assert.equal(stavekNarocila(klic), B, "dokler ni pripravljen, oblika B");
    assert.equal(await pripraviStavekNarocila(klic), "uporabljen");
    assert.equal(stavekNarocila(klic), "Naročate dve mizi iz materiala hrast, rok pa je do petka.");
    assert.doesNotMatch(stavekNarocila(klic), /količin|\d/);
    assert.equal(model.klici, 1);
    // Navodilo modela: samo en stavek, besedno stevilo, lastno ime ostane; vhod nima roka ne imena klicatelja.
    assert.match(model.sistemi[0], /SAMO en stavek/);
    assert.match(model.sistemi[0], /lastno ime/);
    assert.equal(model.vhodi[0], "izdelek: miza\nkolicina: 2\nmaterial: hrast");
  });

  it("dvojina, mnozina, spol in sklon: tri mize, pet miz, ena in dvajset miz, dva stola, dve nalepki, pet nalepk", async () => {
    const primeri: Array<[string, number, string, string]> = [
      ["miza", 1, "Naročate eno mizo iz materiala hrast.", "Naročate eno mizo iz materiala hrast, rok pa je do petka."],
      ["miza", 3, "Naročate tri mize iz materiala hrast.", "Naročate tri mize iz materiala hrast, rok pa je do petka."],
      ["miza", 5, "Naročate pet miz iz materiala hrast.", "Naročate pet miz iz materiala hrast, rok pa je do petka."],
      ["miza", 21, "Naročate ena in dvajset miz iz materiala hrast.", "Naročate ena in dvajset miz iz materiala hrast, rok pa je do petka."],
      ["miza", 22, "Naročate dvaindvajset miz iz materiala hrast.", "Naročate dvaindvajset miz iz materiala hrast, rok pa je do petka."],
      ["stol", 2, "Naročate dva stola iz materiala hrast.", "Naročate dva stola iz materiala hrast, rok pa je do petka."],
      ["nalepka", 2, "Naročate dve nalepki iz materiala hrast.", "Naročate dve nalepki iz materiala hrast, rok pa je do petka."],
      ["nalepka", 5, "Naročate pet nalepk iz materiala hrast.", "Naročate pet nalepk iz materiala hrast, rok pa je do petka."],
    ];
    for (const [izdelek, kolicina, izhod, pricakovano] of primeri) {
      pocistiStavkeNarocila();
      pocistiZavrnjeneStavke();
      stevecModela(izhod);
      const klic = klicZ({ requestedProduct: izdelek, requestedMaterial: "hrast", quantity: kolicina, deadline: "petka" });
      assert.equal(await pripraviStavekNarocila(klic), "uporabljen", izhod);
      assert.equal(stavekNarocila(klic), pricakovano);
    }
  });

  it("21 miz: >>ena in dvajset<< in >>enaindvajset<< sta pravilni, >>eno in dvajset miz<< (napaka modela, izmerjena) -> oblika B", async () => {
    for (const [izhod, ok] of [["Naročate ena in dvajset miz iz materiala hrast.", true], ["Naročate enaindvajset miz iz materiala hrast.", true], ["Naročate eno in dvajset miz iz materiala hrast.", false], ["Naročate en in dvajset miz iz materiala hrast.", false]] as const) {
      pocistiStavkeNarocila();
      pocistiZavrnjeneStavke();
      stevecModela(izhod);
      const klic = klicZ({ requestedProduct: "miza", requestedMaterial: "hrast", quantity: 21, deadline: "petka" });
      assert.equal((await pripraviStavekNarocila(klic)) === "uporabljen", ok, izhod);
      if (!ok) assert.equal(stavekNarocila(klic), "Naročate izdelek miza iz materiala hrast, v količini 21, rok pa je do petka.");
    }
  });

  it("rok dodamo sami (model ga ne dobi): >>pojutrisnjem<< je popravljen kot v G4c", async () => {
    stevecModela("Naročate dve mizi iz materiala hrast.");
    const klic = klicZ({ requestedProduct: "miza", requestedMaterial: "hrast", quantity: 2, deadline: "pojutrišnjem" });
    await pripraviStavekNarocila(klic);
    assert.equal(stavekNarocila(klic), "Naročate dve mizi iz materiala hrast, rok pa je čez dva dni.");
  });

  it("brez materiala: >>Naročate dve mizi.<< (model ne sme izmisliti materiala)", async () => {
    stevecModela("Naročate dve mizi.");
    const klic = klicZ({ requestedProduct: "miza", quantity: 2 });
    assert.equal(await pripraviStavekNarocila(klic), "uporabljen");
    assert.equal(stavekNarocila(klic), "Naročate dve mizi.");
    pocistiStavkeNarocila();
    pocistiZavrnjeneStavke();
    stevecModela("Naročate dve mizi iz materiala hrast.");
    assert.match(await pripraviStavekNarocila(klic), /^zavrnjen/);
    assert.equal(stavekNarocila(klic), "Naročate izdelek miza, v količini 2.");
  });
});

describe("naloga G4f (2): varovala, sicer oblika B", { concurrency: 1 }, () => {
  const slabi: Array<[string, string | (() => string)]> = [
    ["brez izdelka", "Naročate dve stvari iz materiala hrast."],
    ["s stevko", "Naročate 2 mizi iz materiala hrast."],
    ["dolg", `Naročate dve mizi iz materiala hrast ${"in še marsikaj drugega ".repeat(12)}.`],
    ["z imenom klicatelja", "Naročate dve mizi iz materiala hrast za Ano Primer."],
    ["s telefonom", "Naročate dve mizi iz materiala hrast, kličite nas na nič štiri nič."],
    ["z e-posto", "Naročate dve mizi iz materiala hrast na ana@primer.si."],
    ["prazen", ""],
    ["samo presledki", "   \n "],
    ["izjema modela", () => { throw new Error("model ni dosegljiv"); }],
    ["napacno stevilo", "Naročate tri mize iz materiala hrast."],
    ["stevilo ni beseda, a tudi ni stevka (zgresen stevnik)", "Naročate nekaj miz iz materiala hrast."],
    ["dva stavka", "Naročate dve mizi iz materiala hrast. Hvala lepa."],
    ["nerazumljivi znaki", "Naročate dve mizi iz materiala hrast <<<>>>."],
    ["angleski stavek", "You are ordering two tables made of oak."],
    ["spremenjen material", "Naročate dve mizi iz materiala oreh."],
    ["razlaga namesto stavka", "Seveda! Tukaj je stavek: Naročate dve mizi iz materiala hrast."],
  ];
  for (const [ime, izhod] of slabi) {
    it(`model vrne ${ime} -> oblika B (iz G4e), nic iz izhoda`, async () => {
      stevecModela(izhod);
      const klic = MIZE(2);
      const izid = await pripraviStavekNarocila(klic);
      assert.match(izid, /^zavrnjen/, ime);
      assert.equal(stavekNarocila(klic), B);
    });
  }

  it("brez kolicine: modela ne kliceva in stavek ostane brez nje", async () => {
    const model = stevecModela("Naročate mizo iz materiala hrast.");
    const klic = MIZE(null);
    assert.equal(await pripraviStavekNarocila(klic), "preskoceno");
    assert.equal(model.klici, 0);
    assert.equal(stavekNarocila(klic), "Naročate izdelek miza iz materiala hrast, rok pa je do petka.");
  });

  it("zavrnitev se ne ponavlja: isti podatki ne sprozijo drugega klica modela; pripravljen stavek tudi ne", async () => {
    const slab = stevecModela("Naročate 2 mizi.");
    const klic = MIZE(2);
    await pripraviStavekNarocila(klic);
    await pripraviStavekNarocila(klic);
    assert.equal(slab.klici, 1);
    pocistiZavrnjeneStavke();
    const dober = stevecModela("Naročate dve mizi iz materiala hrast.");
    await pripraviStavekNarocila(klic);
    assert.equal(await pripraviStavekNarocila(klic), "ze pripravljen");
    assert.equal(dober.klici, 1);
  });

  it("brez priprave povzetek ne caka na model: stavekNarocila je sinhron in vrne obliko B", () => {
    const model = stevecModela("Naročate dve mizi iz materiala hrast.");
    assert.equal(stavekNarocila(MIZE(2)), B);
    assert.equal(model.klici, 0);
  });
});

describe("naloga G4f (3): lastno ime ostane v imenovalniku", { concurrency: 1 }, () => {
  it("Alba: >>Naročate izdelek Alba iz materiala hrast, v količini dva<< (stevilo z besedo, ime nespremenjeno)", async () => {
    stevecModela("Naročate izdelek Alba iz materiala hrast, v količini dva.");
    const klic = klicZ({ productName: "Alba", materialName: "Hrast", quantity: 2, deadline: "petka" });
    assert.equal(await pripraviStavekNarocila(klic), "uporabljen");
    assert.equal(stavekNarocila(klic), "Naročate izdelek Alba iz materiala hrast, v količini dva, rok pa je do petka.");
  });

  it("model sklanja lastno ime (>>dve albi<<, >>izdelek Albo<<) -> oblika B", async () => {
    for (const izhod of ["Naročate dve albi iz materiala hrast.", "Naročate izdelek Albo iz materiala hrast, v količini dva.", "Naročate izdelek alba iz materiala hrast, v količini dva."]) {
      pocistiStavkeNarocila();
      pocistiZavrnjeneStavke();
      stevecModela(izhod);
      const klic = klicZ({ productName: "Alba", materialName: "Hrast", quantity: 2, deadline: "petka" });
      assert.match(await pripraviStavekNarocila(klic), /^zavrnjen/, izhod);
      assert.equal(stavekNarocila(klic), "Naročate izdelek Alba iz materiala Hrast, v količini 2, rok pa je do petka.");
    }
  });

  it("izdelek, ki je soroden stevniku (>>Petra<<, >>Stol<<), ne zmede preverbe stevila", () => {
    const vhod = { izdelek: "Petra", material: "hrast", kolicina: 5 };
    assert.equal(preveriStavekNarocila("Naročate izdelek Petra iz materiala hrast, v količini pet.", vhod).ok, true);
    assert.equal(preveriStavekNarocila("Naročate izdelek Petra iz materiala hrast.", vhod).ok, false);
  });
});

describe("naloga G4f (3b): slovnica stevnikov (AGENTS.md): mnozinski, snovni, spol dvojine", { concurrency: 1 }, () => {
  const z = (izdelek: string, kolicina: number, material = "") =>
    klicZ({ requestedProduct: izdelek, ...(material ? { requestedMaterial: material } : {}), quantity: kolicina, deadline: "petka" });

  it("mnozinski samostalniki dobijo zbirni stevnik: >>dvoje skarje<<, >>troje hlace<<", async () => {
    stevecModela("Naročate dvoje škarje iz materiala nerjaveče jeklo.");
    const skarje = z("škarje", 2, "nerjaveče jeklo");
    assert.equal(await pripraviStavekNarocila(skarje), "uporabljen");
    assert.equal(stavekNarocila(skarje), "Naročate dvoje škarje iz materiala nerjaveče jeklo, rok pa je do petka.");
    pocistiStavkeNarocila();
    pocistiZavrnjeneStavke();
    stevecModela("Naročate troje hlače iz materiala bombaž.");
    const hlace = z("hlače", 3, "bombaž");
    assert.equal(await pripraviStavekNarocila(hlace), "uporabljen");
    assert.equal(stavekNarocila(hlace), "Naročate troje hlače iz materiala bombaž, rok pa je do petka.");
  });

  it("mnozinski samostalnik z navadnim stevnikom (>>dve skarji<<, >>dve skarje<<) -> oblika B", async () => {
    for (const izhod of ["Naročate dve škarji iz materiala nerjaveče jeklo.", "Naročate dve škarje iz materiala nerjaveče jeklo."]) {
      pocistiStavkeNarocila();
      pocistiZavrnjeneStavke();
      stevecModela(izhod);
      const klic = z("škarje", 2, "nerjaveče jeklo");
      assert.match(await pripraviStavekNarocila(klic), /^zavrnjen/, izhod);
      assert.equal(stavekNarocila(klic), "Naročate izdelek škarje iz materiala nerjaveče jeklo, v količini 2, rok pa je do petka.");
    }
  });

  it("zbirni stevnik pri navadnem samostalniku (>>dvoje mizi<<) -> oblika B", async () => {
    stevecModela("Naročate dvoje mize iz materiala hrast.");
    const klic = z("miza", 2, "hrast");
    assert.match(await pripraviStavekNarocila(klic), /^zavrnjen/);
    assert.equal(stavekNarocila(klic), B);
  });

  it("mnozinski nad stiri (zbirni stevnik zgresljiv) in snovni (moka, olje): modela ne kliceva, ostane oblika B", async () => {
    const model = stevecModela("Naročate pet škarij iz materiala jeklo.");
    const skarje5 = z("škarje", 5, "jeklo");
    assert.equal(await pripraviStavekNarocila(skarje5), "preskoceno");
    assert.equal(stavekNarocila(skarje5), "Naročate izdelek škarje iz materiala jeklo, v količini 5, rok pa je do petka.");
    for (const snov of ["moka", "olje", "voda", "sadje"]) {
      const klic = z(snov, 2);
      assert.equal(await pripraviStavekNarocila(klic), "preskoceno", snov);
      assert.equal(stavekNarocila(klic), `Naročate izdelek ${snov}, v količini 2, rok pa je do petka.`);
    }
    assert.equal(model.klici, 0);
  });

  it("model za neznano snov vrne NI -> oblika B", async () => {
    stevecModela("NI");
    const klic = z("kreda", 2);
    assert.match(await pripraviStavekNarocila(klic), /^zavrnjen/);
    assert.equal(stavekNarocila(klic), "Naročate izdelek kreda, v količini 2, rok pa je do petka.");
  });

  it("spol dvojine: dve jabolki, dve hruski, dva stola; od pet naprej rodilnik (pet miz) - izhod z ustreznim stevnikom je sprejet", async () => {
    const primeri: Array<[string, number, string]> = [
      ["jabolko", 2, "Naročate dve jabolki."],
      ["hruška", 2, "Naročate dve hruški."],
      ["stol", 2, "Naročate dva stola."],
      ["miza", 5, "Naročate pet miz."],
    ];
    for (const [izdelek, kolicina, izhod] of primeri) {
      pocistiStavkeNarocila();
      pocistiZavrnjeneStavke();
      stevecModela(izhod);
      const klic = z(izdelek, kolicina);
      assert.equal(await pripraviStavekNarocila(klic), "uporabljen", izhod);
      assert.equal(stavekNarocila(klic), izhod.replace(/\.$/, ", rok pa je do petka."));
    }
  });

  it("navodilo modela vsebuje pravila slovnice (zbirni stevnik, snovni, spol dvojine); model ju ne more uporabiti brez njih", () => {
    assert.match(NAVODILO_STAVKA, /dvoje škarje/);
    assert.match(NAVODILO_STAVKA, /vrni samo besedo NI/);
    assert.match(NAVODILO_STAVKA, /dve jabolki.*dva jabolka/);
    assert.match(NAVODILO_STAVKA, /dve hruški.*dve hruške/);
  });
});

describe("naloga G4f (4): predpriprava v pravem toku klica", { concurrency: 1 }, () => {
  const OD = "+38640000000";
  const IZVOR = "https://lina.primer";
  const SKRIVNOST = "twilio-zeton-preizkusa";
  let zahtevkov = 0;

  async function klic(dir: string, pot: string, params: Record<string, string>): Promise<string> {
    process.env.TWILIO_AUTH_TOKEN = SKRIVNOST;
    const signed = Object.keys(params).sort().reduce((acc, key) => acc + key + params[key], `${IZVOR}${pot}`);
    const odgovor = await handleVoiceRequest(
      new Request(`${IZVOR}${pot}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": createHmac("sha1", SKRIVNOST).update(signed).digest("base64") },
        body: new URLSearchParams(params).toString(),
      }),
      dir,
    );
    assert.equal(odgovor.status, 200, pot);
    zahtevkov += 1;
    return odgovor.text();
  }

  async function zGlasom(): Promise<string> {
    const dir = await mkdtemp(path.join(KOREN, "d-"));
    temps.push(dir);
    await writeJson(dir, "line.json", { open: true, catalog: formaCatalog(), updatedAt: null });
    await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi" });
    await pripraviGlasObZagonu(dir);
    await pocakajGlas(dir);
    return dir;
  }

  it("model se pokliče v ozadju ob obratu, sinteza dobi sklonjen stavek, zahtev Twilio je kot prej (7), povzetek ga bere", async () => {
    const sinteze: string[] = [];
    nastaviSintezoZaPreizkus(async (besedilo) => {
      sinteze.push(besedilo);
      return Buffer.alloc(4800);
    });
    const model = stevecModela("Naročate izdelek Alba iz materiala hrast, v količini dva.");
    const dir = await zGlasom();
    const sid = "CA-G4F-1";
    zahtevkov = 0;
    await klic(dir, "/api/voice/incoming", { CallSid: sid, From: OD });
    for (const [i, izrek] of ["Ana Primer.", "Mizo Alba iz hrasta, 2 kosa.", "Do petka.", "ana@primer.si", "Ne vem."].entries()) {
      await klic(dir, `/api/voice/turn?obr=${i + 1}`, { CallSid: sid, From: OD, SpeechResult: izrek });
      await pocakajOzadjeKlicev();
    }
    assert.equal(model.klici, 1, "model se poklice samo enkrat na klic (nato pomnilnik)");
    const pricakovano = "Naročate izdelek Alba iz materiala hrast, v količini dva, rok pa je do petka.";
    assert.ok(sinteze.includes(pricakovano), sinteze.join(" | "));
    assert.ok(!sinteze.some((s) => /v količini 2/.test(s)), "stavek B se ni sintetiziral");
    // Isti stavek je v povzetku (obrat 5) in v kosih glasu: besedilo in posnetek se ujemata.
    const zapis = await recordCaller({ callSid: sid, from: OD, text: "" }, dir);
    assert.match(povzetekZaPotrditev(zapis.call), new RegExp(pricakovano.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(deliPovzetka(zapis.call)[0], pricakovano);
    assert.equal(zahtevkov, 6, "pozdrav + 5 obratov; vec Twilio zahtev kot pri G4b ne");
    void mapaZvoka;
  });

  it("deliZaPredpripravo vsebuje sklonjen stavek, ko je v pomnilniku (isti kos kot v povzetku)", async () => {
    stevecModela("Naročate dve mizi iz materiala hrast.");
    const dir = await mkdtemp(path.join(KOREN, "d-"));
    temps.push(dir);
    await writeJson(dir, "line.json", { open: true, catalog: formaCatalog(), updatedAt: null });
    await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi" });
    const klicSeja = klicZ({ requestedProduct: "miza", requestedMaterial: "hrast", quantity: 2, deadline: "petka", povprasevanje: "miza" });
    await pripraviStavekNarocila(klicSeja);
    assert.deepEqual(deliZaPredpripravo(klicSeja), ["Naročate dve mizi iz materiala hrast, rok pa je do petka."]);
  });

  it("navodilo modela ne vsebuje podatkov klicatelja (samo pravila)", () => {
    assert.doesNotMatch(NAVODILO_STAVKA, /@|\+\d|\d{3}/);
  });
});
