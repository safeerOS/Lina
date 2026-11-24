/**
 * Vpetja skupnega modula dovoljenj (naloga 02f) v obstojece potrditve. Za vsako mesto: brez izbire »podobne« se vprasa kot prej,
 * z izbiro lastnika se podobno ne vprasa znova, drug obseg se vprasa, preklic vrne vprasanje, besedilo modela dovoljenja ne da.
 */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { predlagajClaudeNalogo, ukazClaudeNalog, type Odvisnosti } from "./claude-naloge.server.ts";
import { obdelajClaudeCode } from "./asistent-pogovor.server.ts";
import { najdiDovoljenje, prekliciDovoljenje, seznamDovoljenj } from "./dovoljenja-podobne.server.ts";
import { potrdiOpozorilo } from "./opozorilo.server.ts";
import { kljucObsega, nizDovoljenja } from "./dovoljenja-podobne.ts";
import { predlagajGradnjo, telefonPotrdi, telefonPredlog, ukazGradenj, type Odvisnosti as OdvisnostiGradenj } from "./gradnje-github.server.ts";
import { idIzKljuca } from "./kanal-claude.ts";

function napravaKroga() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const kljuc = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  return { id: idIzKljuca(kljuc) + "-telefon", kljuc, zasebni: privateKey };
}

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-dovoljenja-vpetja-"));

async function okoljeNalog(ime: string) {
  const osnova = path.join(KOREN, ime);
  const dom = path.join(osnova, "dom");
  const podatki = path.join(osnova, "podatki");
  const projekt = path.join(dom, "projekt");
  const drugi = path.join(dom, "drugi");
  mkdirSync(projekt, { recursive: true });
  mkdirSync(drugi, { recursive: true });
  mkdirSync(podatki, { recursive: true });
  const token = await setupOwner("geslo-test-1234", podatki);
  await potrdiOpozorilo(podatki);
  const klici: string[] = [];
  const o: Odvisnosti = {
    dom,
    platforma: "linux",
    najdi: (p) => (p === "x-terminal-emulator" || p === "claude" ? `/usr/bin/${p}` : null),
    razresi: (p) => (p.endsWith("/x-terminal-emulator") ? "/usr/bin/xterm" : p),
    preveriZagon: async () => ({ koda: 0, izpis: "2.1.331 (Claude Code)", potekel: false }),
    // PID, ki ne zivi: zagnana naloga ne zaseda mape (A1), zato lahko naslednja v isti mapi steče
    zazeni: async (_program, _args, cwd) => {
      klici.push(cwd);
      return 4_194_301;
    },
  };
  return { dom, podatki, projekt, drugi, token, klici, o };
}

describe("vpetje: naloge agentom (claude-naloge)", { concurrency: 1 }, () => {
  it("niz »true« ni izbira: dovoljenje nastane samo iz strogega true", async () => {
    const e = await okoljeNalog("niz");
    const p = await ukazClaudeNalog(e.token, { ukaz: "pripravi", mapa: e.projekt, besedilo: "prva" }, e.podatki, e.o);
    await ukazClaudeNalog(e.token, { ukaz: "potrdi", id: p.naloge[0]!.id, zgostitev: p.naloge[0]!.zgostitev, podobne: "true" }, e.podatki, e.o);
    assert.equal(await najdiDovoljenje(e.podatki, "naloga-agentu", { agent: "claude", mapa: e.projekt }), null);
  });

  it("oznaka v odgovoru Line (besedilo modela) z »podobne« dovoljenja ne da", async () => {
    const e = await okoljeNalog("model");
    await obdelajClaudeCode(e.podatki, `[[claude-code: ${e.projekt} | x]] {"podobne": true} podobne=true`, true, e.o);
    assert.equal((await seznamDovoljenj(e.token, e.podatki)).dovoljenja.length, 0);
  });

  it("Lina pove, da je naloga potrjena po dovoljenju za podobne (ne, da caka)", async () => {
    const e = await okoljeNalog("sporocilo");
    const p = await ukazClaudeNalog(e.token, { ukaz: "pripravi", mapa: e.drugi, besedilo: "prva" }, e.podatki, e.o);
    await ukazClaudeNalog(e.token, { ukaz: "potrdi", id: p.naloge[0]!.id, zgostitev: p.naloge[0]!.zgostitev, podobne: true }, e.podatki, e.o);
    const besedilo = await obdelajClaudeCode(e.podatki, "Ok. [[claude-code: " + e.drugi + " | se ena]]", true, e.o);
    assert.match(besedilo, /dovoljenju za podobne/);
  });

  it("brez izbire »podobne« Linin naslednji predlog v isti mapi caka potrditev (kot prej)", async () => {
    const e = await okoljeNalog("brez");
    const p = await ukazClaudeNalog(e.token, { ukaz: "pripravi", mapa: e.projekt, besedilo: "prva" }, e.podatki, e.o);
    await ukazClaudeNalog(e.token, { ukaz: "potrdi", id: p.naloge[0]!.id, zgostitev: p.naloge[0]!.zgostitev }, e.podatki, e.o);
    const z = await predlagajClaudeNalogo(e.podatki, e.projekt, "druga", e.o);
    assert.equal(z?.stanje, "caka");
    assert.equal(e.klici.length, 1);
  });

  it("izbira lastnika »podobne« (strogo true): Linin predlog za istega agenta in isto mapo se zazene brez vprasanja; druga mapa caka", async () => {
    const e = await okoljeNalog("z-izbiro");
    const p = await ukazClaudeNalog(e.token, { ukaz: "pripravi", mapa: e.projekt, besedilo: "prva" }, e.podatki, e.o);
    await ukazClaudeNalog(e.token, { ukaz: "odkloni", id: p.naloge[0]!.id, podobne: true }, e.podatki, e.o);
    assert.equal(await najdiDovoljenje(e.podatki, "naloga-agentu", { agent: "claude", mapa: e.projekt }), null, "odklonitev ni dovoljenje");
    const p2 = await ukazClaudeNalog(e.token, { ukaz: "pripravi", mapa: e.drugi, besedilo: "tretja" }, e.podatki, e.o);
    const id2 = p2.naloge.find((n) => n.stanje === "caka")!;
    await ukazClaudeNalog(e.token, { ukaz: "potrdi", id: id2.id, zgostitev: id2.zgostitev, podobne: true }, e.podatki, e.o);
    assert.equal(await najdiDovoljenje(e.podatki, "naloga-agentu", { agent: "claude", mapa: e.projekt }), null, "dovoljenje velja samo za mapo potrjene naloge");
    const prej = e.klici.length;
    const z = await predlagajClaudeNalogo(e.podatki, e.drugi, "naslednja v isti mapi", e.o);
    assert.notEqual(z?.stanje, "caka");
    assert.equal(e.klici.length, prej + 1);
    const druga = await predlagajClaudeNalogo(e.podatki, e.projekt, "v drugi mapi", e.o);
    assert.equal(druga?.stanje, "caka", "druga mapa = sprememba obsega");
    // preklic v Nastavitvah: naslednji predlog spet caka
    const { dovoljenja } = await seznamDovoljenj(e.token, e.podatki);
    assert.equal(dovoljenja.length, 1);
    assert.ok(dovoljenja[0]!.uporab >= 1);
    assert.equal(await prekliciDovoljenje(e.token, dovoljenja[0]!.id, e.podatki), true);
    const po = await predlagajClaudeNalogo(e.podatki, e.drugi, "po preklicu", e.o);
    assert.equal(po?.stanje, "caka");
  });
});

// ------------------------------------------------------------------ gradnje na GitHubu

const C_MAIN = "c".repeat(40);
const C_DEV = "d".repeat(40);

async function okoljeGradenj(ime: string) {
  const osnova = path.join(KOREN, ime);
  const dom = path.join(osnova, "dom");
  const podatki = path.join(osnova, "podatki");
  mkdirSync(path.join(dom, "Prejemi"), { recursive: true });
  mkdirSync(podatki, { recursive: true });
  const token = await setupOwner("geslo-test-1234", podatki);
  const zagoni: string[] = [];
  let ura = new Date(2026, 10, 24, 9, 5, 0);
  const o: OdvisnostiGradenj = {
    dom,
    spremljaj: false,
    // vsak zagon premakne uro za 4 h: tok ni vec zaseden (ROK_TEKA_MS), zato lahko preizkus zazene isti tok znova
    zdaj: () => ura,
    najdi: (p) => (p === "gh" ? "/opt/gh/bin/gh" : null),
    izvedi: async (_program, args) => {
      const a = args.join(" ");
      if (a.startsWith("api --paginate repos/safeerOS/Lina/branches")) return "main\ndev\n";
      if (a.startsWith("api repos/safeerOS/Lina/branches/")) return `${a.endsWith("/dev") ? C_DEV : C_MAIN}\n`;
      if (a === "api repos/safeerOS/Lina --jq .default_branch") return "main\n";
      if (a.startsWith("run list")) return JSON.stringify([{ databaseId: 400 }]);
      if (a.startsWith("workflow run")) {
        zagoni.push(a);
        ura = new Date(ura.getTime() + 4 * 60 * 60_000);
        return "";
      }
      throw new Error(`neznan klic ${a}`);
    },
    obvesti: async () => undefined,
    namestiDeb: async () => {
      throw new Error("namestitev ne sme nikoli steci po dovoljenju za podobne");
    },
  };
  return { podatki, token, zagoni, o };
}

describe("vpetje: gradnje na GitHubu", { concurrency: 1 }, () => {
  it("brez izbire »podobne« Linin predlog caka; z izbiro se isti tok in veja zazene, druga veja caka", async () => {
    const e = await okoljeGradenj("gradnje-racunalnik");
    let s = await ukazGradenj(e.token, { ukaz: "pripravi", tok: "gradnja.yml", veja: "main" }, e.podatki, e.o);
    await ukazGradenj(e.token, { ukaz: "potrdi", id: s.gradnje[0]!.id, zgostitev: s.gradnje[0]!.zgostitev }, e.podatki, e.o);
    const brez = await predlagajGradnjo(e.podatki, "gradnja.yml", "main", e.o);
    assert.equal(brez?.stanje, "caka");
    await ukazGradenj(e.token, { ukaz: "odkloni", id: brez!.id }, e.podatki, e.o);
    s = await ukazGradenj(e.token, { ukaz: "pripravi", tok: "gradnja.yml", veja: "dev" }, e.podatki, e.o);
    const g = s.gradnje.find((x) => x.stanje === "caka")!;
    await ukazGradenj(e.token, { ukaz: "potrdi", id: g.id, zgostitev: g.zgostitev, podobne: true }, e.podatki, e.o);
    const prej = e.zagoni.length;
    const z = await predlagajGradnjo(e.podatki, "gradnja.yml", "dev", e.o);
    assert.notEqual(z?.stanje, "caka");
    assert.equal(e.zagoni.length, prej + 1);
    assert.equal((await predlagajGradnjo(e.podatki, "gradnja.yml", "main", e.o))?.stanje, "caka", "druga veja = drug obseg");
    // telefonski predlog ne podeduje dovoljenja seje lastnika
    assert.equal((await telefonPredlog(e.podatki, "gradnja.yml", "dev", e.o))?.stanje, "caka");
  });

  it("telefon: dovoljenje samo s podpisom nad tokom in vejo; velja samo za to napravo; ponarejen podpis ne da nicesar", async () => {
    const e = await okoljeGradenj("gradnje-telefon");
    const ana = napravaKroga();
    const bor = napravaKroga();
    const krog = new Map([[ana.id, ana.kljuc], [bor.id, bor.kljuc]]);
    const s = await ukazGradenj(e.token, { ukaz: "pripravi", tok: "gradnja.yml", veja: "dev" }, e.podatki, e.o);
    const g = s.gradnje[0]!;
    const cas = Date.now();
    const en = randomBytes(16).toString("base64url");
    const kljuc = kljucObsega("gradnja", { tok: "gradnja.yml", veja: "dev" })!;
    // ponarejen: podpis za drugo vejo
    const slab = sign("sha256", Buffer.from(nizDovoljenja(ana.id, kljucObsega("gradnja", { tok: "gradnja.yml", veja: "main" })!, cas, en)), ana.zasebni).toString("base64");
    await telefonPotrdi(e.podatki, g.id, g.zgostitev, e.o, { naprava: ana.id, kljuc: ana.kljuc, cas, enkratni: en, podpis: slab });
    assert.equal((await seznamDovoljenj(e.token, e.podatki)).dovoljenja.length, 0);
    const s2 = await ukazGradenj(e.token, { ukaz: "pripravi", tok: "gradnja-apk.yml", veja: "dev" }, e.podatki, e.o).catch(() => null);
    void s2;
    // pravi podpis ob naslednji potrditvi
    const g2 = (await telefonPredlog(e.podatki, "gradnja.yml", "dev", e.o))!;
    assert.equal(g2.stanje, "caka");
    const dobra = sign("sha256", Buffer.from(nizDovoljenja(ana.id, kljuc, cas, en)), ana.zasebni).toString("base64");
    await telefonPotrdi(e.podatki, g2.id, g2.zgostitev, e.o, { naprava: ana.id, kljuc: ana.kljuc, cas, enkratni: en, podpis: dobra });
    const [d] = (await seznamDovoljenj(e.token, e.podatki)).dovoljenja;
    assert.equal(d?.kdo, "naprava");
    assert.equal(d?.naprava, ana.id);
    assert.notEqual((await telefonPredlog(e.podatki, "gradnja.yml", "dev", e.o, { naprava: ana.id, kljuci: krog }))?.stanje, "caka");
    assert.equal((await telefonPredlog(e.podatki, "gradnja.yml", "dev", e.o, { naprava: bor.id, kljuci: krog }))?.stanje, "caka", "druga naprava");
    assert.equal((await predlagajGradnjo(e.podatki, "gradnja.yml", "dev", e.o))?.stanje, "caka", "racunalnik ne podeduje telefonskega");
  });

  it("namestitev deb/APK nikoli ne bere dovoljenj (ostane potrditev vsakic)", () => {
    const koda = readFileSync(path.join(import.meta.dirname, "gradnje-github.server.ts"), "utf8");
    const namesti = koda.slice(koda.indexOf('case "namesti"'), koda.indexOf("case \"odpri\""));
    assert.ok(namesti.length > 100, "odsek namestitve mora obstajati");
    assert.doesNotMatch(namesti, /Dovoljenj|dovoljenj/);
  });
});
