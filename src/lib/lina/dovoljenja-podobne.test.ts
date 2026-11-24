/**
 * Skupni modul dovoljenj »velja tudi za vse podobne« (naloga 02f, lastnik 24. 11. 2026). Vsako varovalo ima preizkus, ki brez
 * varovala pade: zaprt seznam vrst, nedvoumen kljuc obsega, lastnik/naprava locena, podpis naprave se preveri ob VSAKI uporabi,
 * rocni vpis brez podpisa ne velja, pokvarjena datoteka = ni dovoljeno, preklic, dnevnik, zapis samo iz dovoljenih datotek.
 */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import {
  VRSTE_DOVOLJENJ, kljucObsega, nizDovoljenja, nizDovoljenjaOdobritve, normirajObseg,
} from "./dovoljenja-podobne.ts";
import {
  obsegIzPrikaza,
  DATOTEKA_DNEVNIKA, DATOTEKA_DOVOLJENJ, najdiDovoljenje, prekliciDovoljenje, seznamDovoljenj, zapisiDovoljenje,
} from "./dovoljenja-podobne.server.ts";
import { idIzKljuca, ORODJE_DODATKI, predogledDodatka, zgostitevPrikaza } from "./kanal-claude.ts";

const mapa = () => mkdtemp(path.join(tmpdir(), "lina-dovoljenja-"));
type Naprava = { id: string; kljuc: string; zasebni: KeyObject };
function naprava(): Naprava {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const kljuc = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  return { id: idIzKljuca(kljuc) + "-telefon", kljuc, zasebni: privateKey };
}
const podpisi = (n: Naprava, niz: string) => sign("sha256", Buffer.from(niz), n.zasebni).toString("base64");
const enkratni = () => randomBytes(16).toString("base64url");

describe("dovoljenja-podobne: cisti del", () => {
  it("zaprt seznam vrst: namestitev, placilo, brisanje, sporocilo, sistem nimajo vrste", () => {
    assert.deepEqual([...VRSTE_DOVOLJENJ], ["naloga-agentu", "gradnja", "dodatek", "program", "avtonomija", "narocila-uvoz", "n8n-zagon"]);
    for (const v of ["namestitev", "namestitev-deb", "placilo", "nakup", "brisanje", "sporocilo", "sistem", "dostop"]) {
      assert.equal(kljucObsega(v, { x: "y" }), null, v);
    }
  });

  it("kljuc obsega je nedvoumen: prelom, nevidni znaki, odvecna ali manjkajoca polja se zavrnejo", () => {
    assert.equal(kljucObsega("naloga-agentu", { agent: "claude", mapa: "/dom/a" }), "naloga-agentu\nclaude\n/dom/a");
    assert.equal(kljucObsega("naloga-agentu", { agent: "claude\n/dom", mapa: "a" }), null);
    assert.equal(kljucObsega("naloga-agentu", { agent: "claude", mapa: "/dom/a​" }), null);
    assert.equal(kljucObsega("naloga-agentu", { agent: "claude", mapa: "/dom/a", vse: "da" }), null);
    assert.equal(kljucObsega("naloga-agentu", { agent: "claude" }), null);
    assert.equal(kljucObsega("dodatek", { dodatek: "n8n", smer: "izbrisi" }), null);
    assert.ok(normirajObseg("dodatek", { dodatek: "n8n", smer: "vklopi" }));
  });

  it("obseg iz prikaza: samo preprost ukaz programa ali orodje dodatki; poljuben ukaz nima obsega", () => {
    assert.deepEqual(obsegIzPrikaza("Bash", "cli-anything-gimp --help"), { vrsta: "program", obseg: { program: "gimp", podukaz: "--help" } });
    assert.deepEqual(obsegIzPrikaza(ORODJE_DODATKI, predogledDodatka("n8n", true)), { vrsta: "dodatek", obseg: { dodatek: "n8n", smer: "vklopi" } });
    assert.equal(obsegIzPrikaza("Bash", "rm -rf /"), null);
    assert.equal(obsegIzPrikaza("Bash", "cli-anything-gimp --help; rm -rf ~"), null);
    assert.equal(obsegIzPrikaza("Write", "cli-anything-gimp"), null);
  });
});

describe("dovoljenja-podobne: shramba", { concurrency: 1 }, () => {
  it("dovoljenje lastnika velja za isti obseg (in se zabelezi), za drug obseg in za zahtevo naprave ne", async () => {
    const dir = await mapa();
    await zapisiDovoljenje(dir, "naloga-agentu", { agent: "claude", mapa: "/dom/projekt" }, { kdo: "lastnik" });
    assert.ok(await najdiDovoljenje(dir, "naloga-agentu", { agent: "claude", mapa: "/dom/projekt" }));
    assert.equal(await najdiDovoljenje(dir, "naloga-agentu", { agent: "claude", mapa: "/dom/projekt/pod" }), null, "podmapa = sprememba obsega");
    assert.equal(await najdiDovoljenje(dir, "naloga-agentu", { agent: "codex", mapa: "/dom/projekt" }), null, "drug agent");
    const n = naprava();
    assert.equal(await najdiDovoljenje(dir, "naloga-agentu", { agent: "claude", mapa: "/dom/projekt" }, { naprava: n.id, kljuci: new Map([[n.id, n.kljuc]]) }), null);
    const dn = JSON.parse(await readFile(path.join(dir, DATOTEKA_DNEVNIKA), "utf8"));
    assert.equal(dn.dnevnik.length, 1);
    assert.deepEqual(Object.keys(dn.dnevnik[0]).sort(), ["id", "kdaj", "naprava", "vrsta"], "v dnevniku ni besedila naloge");
  });

  it("dovoljenje naprave: samo ta naprava, samo v ozjem krogu, samo z veljavnim podpisom; rocni vpis brez podpisa ne velja", async () => {
    const dir = await mapa();
    const ana = naprava();
    const bor = naprava();
    const kljuc = kljucObsega("gradnja", { tok: "lina.yml", veja: "main" })!;
    const cas = Date.now();
    const e = enkratni();
    const dokaz = { cas, enkratni: e, podpis: podpisi(ana, nizDovoljenja(ana.id, kljuc, cas, e)) };
    await zapisiDovoljenje(dir, "gradnja", { tok: "lina.yml", veja: "main" }, { kdo: "naprava", naprava: ana.id, dokaz });
    const krog = new Map([[ana.id, ana.kljuc], [bor.id, bor.kljuc]]);
    assert.ok(await najdiDovoljenje(dir, "gradnja", { tok: "lina.yml", veja: "main" }, { naprava: ana.id, kljuci: krog }));
    assert.equal(await najdiDovoljenje(dir, "gradnja", { tok: "lina.yml", veja: "main" }, { naprava: bor.id, kljuci: krog }), null, "druga naprava");
    assert.equal(await najdiDovoljenje(dir, "gradnja", { tok: "lina.yml", veja: "main" }), null, "racunalnik ne podeduje telefonskega");
    assert.equal(await najdiDovoljenje(dir, "gradnja", { tok: "lina.yml", veja: "main" }, { naprava: ana.id, kljuci: new Map([[bor.id, bor.kljuc]]) }), null, "umaknjena naprava");
    // napadalec z dostopom do mape: prepise obseg na drugo vejo ali vpise dovoljenje brez podpisa
    const surovo = JSON.parse(await readFile(path.join(dir, DATOTEKA_DOVOLJENJ), "utf8"));
    surovo.dovoljenja[0].obseg.veja = "napad";
    surovo.dovoljenja.push({ vrsta: "gradnja", obseg: { tok: "x.yml", veja: "main" }, kdo: "naprava", naprava: ana.id, kdaj: "x", dokaz: { cas, enkratni: e, podpis: "AAAA" } });
    await writeFile(path.join(dir, DATOTEKA_DOVOLJENJ), JSON.stringify(surovo));
    assert.equal(await najdiDovoljenje(dir, "gradnja", { tok: "lina.yml", veja: "napad" }, { naprava: ana.id, kljuci: krog }), null);
    assert.equal(await najdiDovoljenje(dir, "gradnja", { tok: "x.yml", veja: "main" }, { naprava: ana.id, kljuci: krog }), null);
  });

  it("dovoljenje iz odobritve: podpis veze prikaz; zamenjan predogled (drug program) ne velja", async () => {
    const dir = await mapa();
    const ana = naprava();
    const prikaz = { zahtevaId: "abcde", chatId: "n1", orodje: "Bash", predogled: "cli-anything-gimp --help", opis: "gimp" };
    const cas = Date.now();
    const e = enkratni();
    const zg = zgostitevPrikaza(prikaz.orodje, prikaz.predogled, prikaz.opis);
    const dokaz = { cas, enkratni: e, podpis: podpisi(ana, nizDovoljenjaOdobritve(ana.id, prikaz.zahtevaId, prikaz.chatId, zg, cas, e)) };
    await zapisiDovoljenje(dir, "program", { program: "gimp", podukaz: "--help" }, { kdo: "naprava", naprava: ana.id, dokaz, prikaz });
    const krog = new Map([[ana.id, ana.kljuc]]);
    assert.ok(await najdiDovoljenje(dir, "program", { program: "gimp", podukaz: "--help" }, { naprava: ana.id, kljuci: krog }));
    const surovo = JSON.parse(await readFile(path.join(dir, DATOTEKA_DOVOLJENJ), "utf8"));
    surovo.dovoljenja[0].obseg.program = "blender";
    surovo.dovoljenja[0].prikaz.predogled = "cli-anything-blender --help";
    await writeFile(path.join(dir, DATOTEKA_DOVOLJENJ), JSON.stringify(surovo));
    assert.equal(await najdiDovoljenje(dir, "program", { program: "blender", podukaz: "--help" }, { naprava: ana.id, kljuci: krog }), null);
  });

  it("pokvarjena datoteka pomeni »ni dovoljeno«; preklic in seznam samo za lastnika", async () => {
    const dir = await mapa();
    await writeFile(path.join(dir, DATOTEKA_DOVOLJENJ), "{ni json");
    assert.equal(await najdiDovoljenje(dir, "program", { program: "gimp", podukaz: "--help" }), null);
    const token = await setupOwner("geslo-test-1234", dir);
    const d = await zapisiDovoljenje(dir, "program", { program: "gimp", podukaz: "--help" }, { kdo: "lastnik" });
    await assert.rejects(seznamDovoljenj(null, dir));
    await assert.rejects(prekliciDovoljenje("tuj-zeton", d.id, dir));
    assert.equal((await seznamDovoljenj(token, dir)).dovoljenja.length, 1);
    assert.equal(await prekliciDovoljenje(token, d.id, dir), true);
    assert.equal(await najdiDovoljenje(dir, "program", { program: "gimp", podukaz: "--help" }), null, "po preklicu se spet vprasa");
  });
});

describe("dovoljenja-podobne: dovoljenje nikoli iz besedila modela, agenta, klicatelja ali spleta", () => {
  const KOREN_SRC = path.resolve(import.meta.dirname, "..", "..");
  function izvorna(m: string, izhod: string[] = []): string[] {
    for (const ime of readdirSync(m)) {
      const p = path.join(m, ime);
      if (statSync(p).isDirectory()) izvorna(p, izhod);
      else if (/\.(ts|tsx)$/.test(ime) && !/\.(test|spec)\.(ts|tsx)$/.test(ime)) izhod.push(p);
    }
    return izhod;
  }
  it("zapisiDovoljenje klicejo samo ukazi seje lastnika in podpisane poti naprave", () => {
    const klicatelji = izvorna(KOREN_SRC)
      .filter((d) => /\bzapisiDovoljenje\s*\(/.test(readFileSync(d, "utf8")))
      .map((d) => path.relative(KOREN_SRC, d).split(path.sep).join("/"))
      .sort();
    assert.deepEqual(klicatelji, [
      "lib/lina/asistent-streznik.server.ts", // podpis naprave (odobritev, potrditev gradnje)
      "lib/lina/avtonomija.server.ts", // ukaz odobri (requireOwner)
      "lib/lina/claude-naloge.server.ts", // ukaz potrdi/dodeli (requireOwner)
      "lib/lina/dovoljenja-podobne.server.ts",
      "lib/lina/gradnje-github.server.ts", // ukaz potrdi (requireOwner) in telefonPotrdi (podpis)
      "lib/lina/n8n.server.ts", // ukazN8n potrdi zagona (requireOwner, podobne === true; obseg = ID toka)
      "lib/lina/narocila.server.ts", // uvoziNarocilaLastnik (requireOwner, potrjeno === true in podobne === true)
    ]);
  });
});
