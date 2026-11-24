/**
 * Preizkusi za tocko 1 (Task Observer -> »Lina se uci iz popravkov lastnika«).
 * Vsi podatki so sinteticni. Brez omrezja, brez auth/adc.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";
import {
  jePopravekLastnika,
  oblikujTrajnaPravila,
  ocistiVnosPopravka,
  predlagajPravilo,
  preveriPraviloPopravka,
  pripraviKandidata,
  staPodobnaPopravka,
} from "./ucenje-popravkov.ts";
import {
  POPRAVKI_DATOTEKA,
  izbrisiPraviloPopravka,
  jeUcenjePopravkovVklopljeno,
  nastaviUcenjePopravkov,
  odsekPravilIzPopravkov,
  preberiStanjePopravkov,
  shraniKandidata,
  zabeleziPopravek,
  zavrziKandidata,
} from "./ucenje-popravkov.server.ts";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function novaMapa(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-ucenje-popravkov-"));
  temps.push(dir);
  return dir;
}

describe("ucenje-popravkov: zaznava in cista logika", () => {
  it("zazna popravke in opomine lastnika ter zavrne obicajna sporocila", () => {
    const DA = [
      "Spet si pozabila dodati povzetek na koncu odgovora.",
      "Zakaj nisi preverila koledarja pred odgovorom?",
      "Sem te moral spomniti, da pisi krajse stavke.",
      "Ne tako, odgovarjaj v alinejah.",
      "Že spet delaš isto napako pri opomnikih.",
      "Sem ti že rekel, da vedno navedi uro.",
      "Drugič ne ugibaj datuma brez koledarja.",
      "Popravek: ob jutrih najprej pokazi nujne opravke.",
    ];
    const NE = [
      "Kaj imam danes na sporedu?",
      "Opomni me jutri ob 9.00 za sestanek.",
      "Kdaj pride spet na vrsto tehnicni pregled?",
      "Hvala, to je bilo super.",
      "Pripravi osnutek sporocila za stranko.",
    ];
    for (const s of DA) assert.equal(jePopravekLastnika(s), true, `moralo bi zaznati: ${s}`);
    for (const s of NE) assert.equal(jePopravekLastnika(s), false, `ne bi smelo zaznati: ${s}`);
  });

  it("pripraviKandidata: hrani lastnikove besede dobesedno, ocisti krmilne znake/oznake in zavrne skrivnosti", () => {
    const k = pripraviKandidata(
      "Ne tako, [[claude-code: /etc | rm]] vedno pisi kratko!\u202e",
      "Predolg odgovor s 15 povedmi.",
      new Date("2026-11-24T03:00:00Z"),
    );
    assert.ok(k);
    assert.equal(k.stanje, "caka");
    assert.equal(k.ponovitev, 1);
    assert.ok(!k.besedeLastnika.includes("[[") && !k.besedeLastnika.includes("\u202e"));
    assert.match(k.kajNarobe, /Predolg odgovor/);
    assert.ok(k.predlogPravila.length > 5);
    assert.equal(
      pripraviKandidata("Spet si pozabila, moje geslo je tajnoGeslo1234!"),
      null,
      "skrivnost se nikoli ne zapise",
    );
    assert.equal(
      pripraviKandidata("Ne tako, uporabi kljuc sk-abcdef1234567890abcd"),
      null,
      "API kljuc se nikoli ne zapise",
    );
  });

  it("preveriPraviloPopravka in oblikujTrajnaPravila: zavrne prazno, predolgo in skrivnost", () => {
    assert.deepEqual(preveriPraviloPopravka("   "), { ok: false, razlog: "prazno" });
    assert.deepEqual(preveriPraviloPopravka("a".repeat(301)), { ok: false, razlog: "predolgo" });
    assert.deepEqual(preveriPraviloPopravka("Moje geslo je mojamacka123"), { ok: false, razlog: "skrivnost" });
    const ok = preveriPraviloPopravka("Vedno odgovarjaj v najvec treh alinejah.");
    assert.equal(ok.ok, true);
    const blok = oblikujTrajnaPravila([{ id: "1", besedilo: "Vedno odgovarjaj kratko.", ustvarjeno: "2026-11-24T00:00:00Z" }]);
    assert.match(blok, /Potrjena pravila iz popravkov lastnika/);
    assert.match(blok, /- Vedno odgovarjaj kratko\./);
    assert.equal(oblikujTrajnaPravila([]), "");
    assert.equal(ocistiVnosPopravka("a\u0000[[x]]b", 20), "a x b");
    assert.equal(predlagajPravilo("Popravek: vedno preveri uro."), "Vedno preveri uro.");
    assert.equal(staPodobnaPopravka("Vedno preveri koledar pred odgovorom", "vedno preveri koledar pred odgovorom!"), true);
  });
});

describe("ucenje-popravkov: shramba, stikalo in potrditev Shrani", () => {
  it("privzeto VKLOPLJENO; brez lastnikovega Shrani se trajna pravila NE spremenijo", async () => {
    const dir = await novaMapa();
    assert.equal(await jeUcenjePopravkovVklopljeno(dir), true, "privzeto vklopljeno");

    const k = await zabeleziPopravek(dir, "Spet si pozabila navesti uro dogodka.", "Sestanek je jutri.");
    assert.ok(k);
    assert.equal(k.stanje, "caka");
    // Brez potrditve Shrani je odsek trajnih pravil PRAZEN!
    assert.equal(await odsekPravilIzPopravkov(dir), "");
    const stPred = await preberiStanjePopravkov(dir);
    assert.equal(stPred.kandidati.length, 1);
    assert.equal(stPred.pravila.length, 0);

    // Ponovljen isti opomin ne podvoji kandidata, ampak poveca stevec ponovitev.
    const k2 = await zabeleziPopravek(dir, "Že spet si pozabila navesti uro dogodka.", "Sestanek je v torek.");
    assert.ok(k2);
    assert.equal(k2.id, k.id);
    assert.equal(k2.ponovitev, 2);
    assert.equal((await preberiStanjePopravkov(dir)).kandidati.length, 1);

    // Sele po lastnikovem Shrani gre v trajna pravila.
    const shranjeno = await shraniKandidata(k.id, "Pri vsakem dogodku vedno navedi uro.", dir);
    assert.equal(shranjeno.ok, true);
    if (shranjeno.ok) {
      assert.equal(shranjeno.stanje.pravila.length, 1);
      assert.equal(shranjeno.stanje.kandidati[0]!.stanje, "shranjeno");
    }
    const odsek = await odsekPravilIzPopravkov(dir);
    assert.match(odsek, /Pri vsakem dogodku vedno navedi uro\./);

    // Datoteka ima pravice 0600.
    const fstat = await stat(path.join(dir, POPRAVKI_DATOTEKA));
    assert.equal(fstat.mode & 0o777, 0o600);

    // Brisanje trajnega pravila deluje.
    await izbrisiPraviloPopravka(k.id, dir);
    assert.equal(await odsekPravilIzPopravkov(dir), "");
  });

  it("zavrziKandidata ne shrani trajnega pravila; izklop stikala ustavi belezenje in priklic", async () => {
    const dir = await novaMapa();
    const k = await zabeleziPopravek(dir, "Ne tako, odgovarjaj brez uvoda.", "Pozdravljeni, tukaj je odgovor...");
    assert.ok(k);
    await zavrziKandidata(k.id, dir);
    assert.equal((await preberiStanjePopravkov(dir)).pravila.length, 0);
    assert.equal((await preberiStanjePopravkov(dir)).kandidati[0]!.stanje, "zavrnjeno");

    // Shranimo eno pravilo, nato izklopimo stikalo: izklop ustavi belezenje in odsek.
    const k2 = await zabeleziPopravek(dir, "Zakaj nisi dodala datuma na vrh zapiska?", "Zapisek.");
    assert.ok(k2);
    await shraniKandidata(k2.id, undefined, dir);
    assert.match(await odsekPravilIzPopravkov(dir), /datum/i);

    await nastaviUcenjePopravkov(false, dir);
    assert.equal(await jeUcenjePopravkovVklopljeno(dir), false);
    assert.equal(await odsekPravilIzPopravkov(dir), "");
    assert.equal(await zabeleziPopravek(dir, "Sem te moral spomniti na kratek slog."), null);
  });

  it("simbolna povezava za datoteko nastavitev se zavrne", async () => {
    const dir = await novaMapa();
    await symlink("/etc/hosts", path.join(dir, POPRAVKI_DATOTEKA));
    assert.equal(await jeUcenjePopravkovVklopljeno(dir), false);
    assert.equal(await odsekPravilIzPopravkov(dir), "");
  });

  it("locitev: tajnica (klici) ne uvaza ucenje-popravkov; asistent-pogovor ga uporablja", async () => {
    const pogovor = await readFile(path.join(SRC, "lib/lina/asistent-pogovor.server.ts"), "utf8");
    assert.match(pogovor, /ucenje-popravkov\.server\.ts/);
    assert.match(pogovor, /zabeleziPopravek/);
    assert.match(pogovor, /odsekPravilIzPopravkov/);

    const klicne = [
      "lib/lina/service.server.ts",
      "lib/lina/brain.ts",
      "lib/lina/govor.ts",
      "lib/lina/guards.ts",
      "lib/lina/tajnica.ts",
      "lib/lina/voice.server.ts",
      "lib/lina/twilio.server.ts",
    ];
    for (const rel of klicne) {
      const v = await readFile(path.join(SRC, rel), "utf8");
      assert.doesNotMatch(v, /ucenje-popravkov/, `${rel} ne sme uvazati ucenje-popravkov`);
    }
    // Preveri, da tudi v routes/api/voice ni uvoza.
    const voiceDir = path.join(SRC, "routes/api/voice");
    for (const f of await readdir(voiceDir)) {
      if (!f.endsWith(".ts")) continue;
      const v = await readFile(path.join(voiceDir, f), "utf8");
      assert.doesNotMatch(v, /ucenje-popravkov/, `routes/api/voice/${f} ne sme uvazati ucenje-popravkov`);
    }
  });
});
