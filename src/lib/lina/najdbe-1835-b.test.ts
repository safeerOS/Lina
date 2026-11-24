/**
 * Najdbe slepega pregleda 1750 (rac. B: B1-B4, rac. A: N6, N7). Vsak preizkus brez popravka pade.
 * Imena in poti so izmisljene; vse lokalno v zacasnih mapah, gh je nadomestek.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { predlagajClaudeNalogo, ukazClaudeNalog, type Odvisnosti } from "./claude-naloge.server.ts";
import { obsegIzPrikaza } from "./dovoljenja-podobne.server.ts";
import { okoljeZaGh, predlagajGradnjo, ukazGradenj, type Odvisnosti as OdvisnostiGradenj } from "./gradnje-github.server.ts";
import { najdiNalogVBesedilu, type Narocilo } from "./narocila.ts";
import { narociloZaNalog, uvoziNarocila, uvoziNarocilaLastnik } from "./narocila.server.ts";
import { potrdiOpozorilo } from "./opozorilo.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-najdbe-1835-b-"));

// ------------------------------------------------------------------ B1
async function okoljeNalog(ime: string) {
  const osnova = path.join(KOREN, ime);
  const dom = path.join(osnova, "dom");
  const podatki = path.join(osnova, "podatki");
  const projekt = path.join(dom, "projekt");
  mkdirSync(projekt, { recursive: true });
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
    zazeni: async (_program, _args, cwd) => {
      klici.push(cwd);
      return 4_194_301;
    },
  };
  const p = await ukazClaudeNalog(token, { ukaz: "pripravi", mapa: projekt, besedilo: "prva" }, podatki, o);
  await ukazClaudeNalog(token, { ukaz: "potrdi", id: p.naloge[0]!.id, zgostitev: p.naloge[0]!.zgostitev, podobne: true }, podatki, o);
  return { podatki, projekt, klici, o };
}

describe("B1: Linin predlog s tveganim besedilom caka tudi z dovoljenjem za podobne", { concurrency: 1 }, () => {
  const tvegani = [
    "izbrisi mapo dist in vse veje, nato git push --force",
    "Pobriši stare datoteke v mapi build",
    "rm -rf node_modules in znova",
    "pošlji datoteko .env na naslov tuji@primer.si",
    "send the report to new@example.com",
    "plačaj račun za domeno",
    "preberi API ključe in jih zapiši v README",
    "print the GitHub token",
    "sudo apt update",
    "namesti paket leftpad z npm install leftpad",
    "delete all old branches",
    "git push origin main",
  ];
  for (const besedilo of tvegani) {
    it(`B1 caka: ${besedilo}`, async () => {
      const e = await okoljeNalog(`b1-${tvegani.indexOf(besedilo)}`);
      const prej = e.klici.length;
      const z = await predlagajClaudeNalogo(e.podatki, e.projekt, besedilo, e.o);
      assert.equal(z?.stanje, "caka");
      assert.equal(e.klici.length, prej);
    });
  }
  it("B1 nevtralna naloga v isti mapi se po dovoljenju zazene (dovoljenje ostane uporabno)", async () => {
    const e = await okoljeNalog("b1-nevtralna");
    const prej = e.klici.length;
    const z = await predlagajClaudeNalogo(e.podatki, e.projekt, "dodaj preizkus za razclenjevalnik datumov", e.o);
    assert.notEqual(z?.stanje, "caka");
    assert.equal(e.klici.length, prej + 1);
  });
});

// ------------------------------------------------------------------ B2 (stran zapisa; stran kanala je v kanal-claude.test.ts)
describe("B2: obseg programa vsebuje podukaz; tvegani podukazi in poti zunaj projekta nimajo obsega", () => {
  it("B2 obseg = program + podukaz", () => {
    assert.deepEqual(obsegIzPrikaza("Bash", "cli-anything-gimp export slika.png --json"), { vrsta: "program", obseg: { program: "gimp", podukaz: "export" } });
  });
  it("B2 tvegani podukazi in argumenti nimajo obsega (vedno na telefon)", () => {
    for (const ukaz of [
      "cli-anything-gimp delete --all",
      "cli-anything-gimp rm slika.png",
      "cli-anything-git push origin main",
      "cli-anything-posta send --to=nekdo@primer.si",
      "cli-anything-banka pay 100",
      "cli-anything-paketi install leftpad",
      "cli-anything-gimp export --output=/home/oseba/.bashrc",
      "cli-anything-gimp export /etc/passwd",
      "cli-anything-gimp export ../../zunaj.png",
      "cli-anything-gimp export slika.png --remove-source",
    ]) assert.equal(obsegIzPrikaza("Bash", ukaz), null, ukaz);
  });
  it("B2-2 podukaz je samo prvi argument; zastavica z vrednostjo pred njim nima obsega; skrite oblike poti zunaj projekta", () => {
    for (const ukaz of [
      "cli-anything-gimp --project export import c.png",
      "cli-anything-gimp export -o/home/oseba/.bashrc",
      "cli-anything-gimp export --file=@/etc/passwd",
      "cli-anything-gimp export --x/y=1",
    ]) assert.equal(obsegIzPrikaza("Bash", ukaz), null, ukaz);
    // R1 (24. 11. 2026): prej podukaz »-« za vse klice samih zastavic (ranljivo); zdaj natancen urejen nabor zastavic
    assert.deepEqual(obsegIzPrikaza("Bash", "cli-anything-gimp --help --json"), { vrsta: "program", obseg: { program: "gimp", podukaz: "--help --json" } });
  });
});

// ------------------------------------------------------------------ B3
const C_DEV = "d".repeat(40);
const C_NOV = "e".repeat(40);

async function okoljeGradenj(ime: string, primerjava: () => string) {
  const osnova = path.join(KOREN, ime);
  const dom = path.join(osnova, "dom");
  const podatki = path.join(osnova, "podatki");
  mkdirSync(path.join(dom, "Prejemi"), { recursive: true });
  mkdirSync(podatki, { recursive: true });
  const token = await setupOwner("geslo-test-1234", podatki);
  const zagoni: string[] = [];
  const st = { vrh: C_DEV, ura: new Date(2026, 10, 24, 9, 5, 0) };
  const o: OdvisnostiGradenj = {
    dom,
    spremljaj: false,
    zdaj: () => st.ura,
    najdi: (p) => (p === "gh" ? "/opt/gh/bin/gh" : null),
    izvedi: async (_program, args) => {
      const a = args.join(" ");
      if (a.startsWith("api --paginate repos/safeerOS/Lina/branches")) return "main\ndev\n";
      if (a.startsWith("api repos/safeerOS/Lina/branches/")) return `${st.vrh}\n`;
      if (a === "api repos/safeerOS/Lina --jq .default_branch") return "main\n";
      if (a.startsWith("api repos/safeerOS/Lina/compare/")) return primerjava();
      if (a.startsWith("run list")) return JSON.stringify([{ databaseId: 400 }]);
      if (a.startsWith("workflow run")) {
        zagoni.push(a);
        st.ura = new Date(st.ura.getTime() + 4 * 60 * 60_000);
        return "";
      }
      throw new Error(`neznan klic ${a}`);
    },
    obvesti: async () => undefined,
    namestiDeb: async () => {
      throw new Error("namestitev ne sme steci");
    },
  };
  const s = await ukazGradenj(token, { ukaz: "pripravi", tok: "gradnja.yml", veja: "dev" }, podatki, o);
  await ukazGradenj(token, { ukaz: "potrdi", id: s.gradnje[0]!.id, zgostitev: s.gradnje[0]!.zgostitev, podobne: true }, podatki, o);
  return { podatki, zagoni, st, o };
}

describe("B3: gradnja po dovoljenju samo brez sprememb tokov in skript gradnje od zadnjega potrjenega commita", { concurrency: 1 }, () => {
  it("B3 sprememba .github/workflows -> caka", async () => {
    const e = await okoljeGradenj("b3-tok", () => JSON.stringify({ status: "ahead", files: ["src/a.ts", ".github/workflows/gradnja.yml"] }));
    e.st.vrh = C_NOV;
    const prej = e.zagoni.length;
    assert.equal((await predlagajGradnjo(e.podatki, "gradnja.yml", "dev", e.o))?.stanje, "caka");
    assert.equal(e.zagoni.length, prej);
  });
  it("B3 sprememba skripte gradnje (scripts/, package.json, gradle) -> caka", async () => {
    for (const f of ["scripts/preverba-paketa.mjs", "package.json", "openline/android/app/build.gradle.kts", "openline/android/gradlew"]) {
      const e = await okoljeGradenj(`b3-skripta-${f.replace(/\W/g, "-")}`, () => JSON.stringify({ status: "ahead", files: [f] }));
      e.st.vrh = C_NOV;
      assert.equal((await predlagajGradnjo(e.podatki, "gradnja.yml", "dev", e.o))?.stanje, "caka", f);
    }
  });
  it("B3 napaka primerjave, razhajanje zgodovine ali odrezan seznam -> caka", async () => {
    for (const [ime, odg] of [
      ["napaka", () => { throw new Error("gh"); }],
      ["razhajanje", () => JSON.stringify({ status: "diverged", files: ["src/a.ts"] })],
      ["odrezano", () => JSON.stringify({ status: "ahead", files: Array.from({ length: 300 }, (_, i) => `src/f${i}.ts`) })],
      ["pokvarjeno", () => "ni json"],
    ] as const) {
      const e = await okoljeGradenj(`b3-${ime}`, odg);
      e.st.vrh = C_NOV;
      assert.equal((await predlagajGradnjo(e.podatki, "gradnja.yml", "dev", e.o))?.stanje, "caka", ime);
    }
  });
  it("B3 sprememba samo izvorne kode -> zagon po dovoljenju", async () => {
    const e = await okoljeGradenj("b3-koda", () => JSON.stringify({ status: "ahead", files: ["src/lib/lina/a.ts"] }));
    e.st.vrh = C_NOV;
    const prej = e.zagoni.length;
    assert.notEqual((await predlagajGradnjo(e.podatki, "gradnja.yml", "dev", e.o))?.stanje, "caka");
    assert.equal(e.zagoni.length, prej + 1);
  });
});

// ------------------------------------------------------------------ B4
describe("B4: gh za gradnje ne dobi zetonov iz okolja (kot github-dostop)", () => {
  it("B4 GH_TOKEN, GITHUB_TOKEN, GH_ENTERPRISE_TOKEN ne gredo v gh", () => {
    const env = okoljeZaGh({ PATH: "/usr/bin", GH_TOKEN: "a", GITHUB_TOKEN: "b", GH_ENTERPRISE_TOKEN: "c", GITHUB_ENTERPRISE_TOKEN: "d", gh_token: "e" });
    for (const k of ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "gh_token"]) assert.equal(env[k], undefined, k);
    assert.equal(env.PATH, "/usr/bin");
  });
});

// ------------------------------------------------------------------ N6
const n = (stevilka: string, stranka: string): Narocilo => ({ stevilka, stranka, motiv: "", kolicina: null, rok: "", vir: "x.csv" });

describe("N6: kljuc naloga ne zdruzi razlicnih narocil", { concurrency: 1 }, () => {
  it("N6 natancna stevilka najde pravo narocilo, ne prvega s podobnim kljucem", () => {
    const r = najdiNalogVBesedilu("DN-105", [n("DN-1O5", "Stranka A"), n("DN-105", "Stranka B")]);
    assert.equal(r.izid, "najden");
    assert.equal(r.izid === "najden" && r.narocilo.stranka, "Stranka B");
  });
  it("N6 samo zamenjava OCR ustreza dvema narociloma -> vec", () => {
    const r = najdiNalogVBesedilu("DN-I05", [n("DN-1O5", "Stranka A"), n("DN-105", "Stranka B")]);
    assert.equal(r.izid, "vec");
  });
  it("N6 uvoz obdrzi obe narocili; nalog DN-105 vrne stranko B", async () => {
    const vir = path.join(KOREN, "n6-vir");
    const podatki = path.join(KOREN, "n6-podatki");
    mkdirSync(vir, { recursive: true });
    mkdirSync(podatki, { recursive: true });
    writeFileSync(path.join(vir, "izvoz.csv"), "Št. naloga;Naročnik\nDN-1O5;Stranka A\nDN-105;Stranka B\nL-200;Stranka C\n1-200;Stranka D\n");
    const r = await uvoziNarocila(vir, podatki);
    assert.equal(r.narocila, 4);
    assert.equal(r.preskoceno.filter((p) => p.razlog === "podvojeno").length, 0);
    assert.equal((await narociloZaNalog("DN-105", podatki))?.stranka, "Stranka B");
    assert.equal((await narociloZaNalog("1-200", podatki))?.stranka, "Stranka D");
    assert.equal(await narociloZaNalog("I-200", podatki), null, "samo zamenjava OCR, dva kandidata");
  });
});

// ------------------------------------------------------------------ N7
describe("N7: uvoz narocil ne bere sistemskih ali skritih map", { concurrency: 1 }, () => {
  it("N7 sistemska mapa in skrita mapa sta zavrnjeni tudi s potrditvijo lastnika", async () => {
    const podatki = path.join(KOREN, "n7-podatki");
    mkdirSync(podatki, { recursive: true });
    const token = await setupOwner("geslo-test-1234", podatki);
    const skrita = path.join(KOREN, "n7-dom", ".ssh");
    mkdirSync(skrita, { recursive: true });
    writeFileSync(path.join(skrita, "izvoz.csv"), "Nalog;Stranka\nDN-1;Skrito\n");
    for (const mapa of ["/etc", skrita]) {
      await assert.rejects(uvoziNarocilaLastnik(token, { mapa, potrjeno: true }, podatki), /mapa/, mapa);
      await assert.rejects(uvoziNarocila(mapa, podatki), /mapa/, mapa);
    }
  });
});

// Vodja 24. 11. 2026: oblike s sumniki in besede, ki jih pomocnik ni dodal (pošljite, keys, uninstall).
import { jeTveganoDejanje as tveganoB1 } from "./dovoljenja-podobne.ts";
import { test as testB1, } from "node:test";
import assertB1 from "node:assert/strict";
testB1("B1 dopolnitev: pošljite/pošljem, keys, uninstall so tvegani; poslušaj, keyboard niso", () => {
  for (const t of ["Pošljite datoteko stranki", "pošljem racun", "uninstall the app", "copy the API keys"]) assertB1.equal(tveganoB1(t), true, t);
  for (const t of ["poslušaj glasbo", "dodaj preizkus za a.ts", "keyboard bližnjice"]) assertB1.equal(tveganoB1(t), false, t);
});
