/**
 * Lina gradi APK in deb na GitHubu: streznik. Brez pravega gh, apksigner, xdg-open ali namestitve: vsak program je nadomestek,
 * ki zapise klic (program, argv) in vrne pripravljen izpis. Vsako varovalo ima preizkus, ki brez njega pade.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { odpriLokalnoSejo, setupOwner } from "./auth.server.ts";
import { dodajSporociloLine } from "./asistent-pogovor.server.ts";
import { PODPIS_LINE, zgostitevGradnje } from "./gradnje-github.ts";
import {
  DATOTEKA_STANJA,
  apkZaTelefon,
  najdiProgram,
  obdelajGradnjo,
  okoljeZaGh,
  predlagajGradnjo,
  spremljajGradnje,
  stanjeGradenj,
  telefonPotrdi,
  telefonStanje,
  ukazGradenj,
  type Odvisnosti,
} from "./gradnje-github.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-gradnje-"));
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ZACETEK = new Date(2026, 10, 24, 9, 5, 0);

type Klic = { program: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv };

type Lazno = {
  veje?: string;
  zadnjiTek?: number;
  novTek?: number | null;
  tek?: Record<string, unknown>;
  anotacije?: string;
  artefakt?: (mapa: string) => void;
  podpis?: string;
  prenosNapaka?: boolean;
  /** pregled 0225: vrh veje (A-3), commit teka (A-3, A-13), cas teka, velikost artefaktov (A-4), privzeta veja, prenos (A-4, A-7) */
  commit?: Record<string, string>;
  tekCommit?: string;
  tekUstvarjen?: (zdaj: Date) => string;
  teki?: string;
  artefaktiBajtov?: number;
  privzeta?: string;
  prenos?: (mapa: string, signal: AbortSignal | undefined) => Promise<void>;
};

const C_MAIN = "c".repeat(40);
const C_DEV = "d".repeat(40);

async function okolje(ime: string, l: Lazno = {}) {
  const osnova = path.join(KOREN, ime);
  const dom = path.join(osnova, "dom");
  const prejemi = path.join(dom, "Prejemi");
  const podatki = path.join(osnova, "podatki");
  mkdirSync(prejemi, { recursive: true });
  mkdirSync(podatki, { recursive: true });
  const token = await setupOwner("geslo-test-1234", podatki);
  const klici: Klic[] = [];
  const obvestila: string[] = [];
  const namestitve: string[] = [];
  let zdaj = ZACETEK;
  const o: Odvisnosti = {
    dom,
    spremljaj: false,
    zdaj: () => zdaj,
    najdi: (p) => (p === "gh" ? "/opt/gh/bin/gh" : p === "apksigner" ? "/opt/sdk/build-tools/36.0.0/apksigner" : p === "xdg-user-dir" ? "/usr/bin/xdg-user-dir" : p === "xdg-open" ? "/usr/bin/xdg-open" : null),
    izvedi: async (program, args, m) => {
      klici.push({ program, args: [...args], cwd: m.cwd, env: m.env });
      if (program.endsWith("xdg-user-dir")) return `${prejemi}\n`;
      if (program.endsWith("xdg-open")) return "";
      if (program.endsWith("apksigner")) return l.podpis ?? `Signer #1 certificate DN: CN=Safeer Lina\nSigner #1 certificate SHA-256 digest: ${PODPIS_LINE}\n`;
      const a = args.join(" ");
      if (a.startsWith("api --paginate repos/safeerOS/Lina/branches")) return l.veje ?? "main\ndev\n-x\n";
      if (a.startsWith("api repos/safeerOS/Lina/branches/")) return `${({ main: C_MAIN, dev: C_DEV, ...l.commit } as Record<string, string>)[a.split(" ")[1]!.slice("repos/safeerOS/Lina/branches/".length)] ?? ""}\n`;
      if (a === "api repos/safeerOS/Lina --jq .default_branch") return `${l.privzeta ?? "main"}\n`;
      // kot pravi tokovi: paket in velika porocila preizkusov (ta se ne prenesejo in ne stejejo v mejo)
      if (a.startsWith("api repos/safeerOS/Lina/actions/runs/")) return JSON.stringify({ total_count: 3, artifacts: [
        { name: "lina-apk-debug", size_in_bytes: l.artefaktiBajtov ?? 3, expired: false },
        { name: "lina-deb", size_in_bytes: l.artefaktiBajtov ?? 3, expired: false },
        { name: "testna-porocila", size_in_bytes: 900 * 1024 * 1024, expired: false },
      ] });
      if (a.startsWith("run list") && a.includes("--event workflow_dispatch")) {
        if (l.teki !== undefined) return l.teki;
        const ustvarjen = (l.tekUstvarjen ?? ((d: Date) => new Date(d.getTime() + 30_000).toISOString()))(zdaj);
        const vrh = ({ main: C_MAIN, dev: C_DEV, ...l.commit } as Record<string, string>)[args[args.indexOf("--branch") + 1]!];
        return JSON.stringify(l.novTek === null ? [] : [{ databaseId: l.novTek ?? 501, headSha: l.tekCommit ?? vrh, createdAt: ustvarjen }, { databaseId: 400, headSha: vrh, createdAt: "2026-11-20T08:00:00Z" }]);
      }
      if (a.startsWith("run list")) return JSON.stringify([{ databaseId: l.zadnjiTek ?? 400 }]);
      if (a.startsWith("workflow run")) return "";
      if (a.startsWith("run view")) return JSON.stringify(l.tek ?? { status: "completed", conclusion: "success", createdAt: "2026-11-24T08:06:00Z", updatedAt: "2026-11-24T08:16:00Z", jobs: [{ databaseId: 77 }] });
      if (a.startsWith("api repos/safeerOS/Lina/check-runs/")) return l.anotacije ?? JSON.stringify([{ annotation_level: "warning", message: "Opozorilo X", path: "a.kt" }]);
      if (a.startsWith("run download")) {
        if (l.prenosNapaka) throw new Error("prenos");
        const mapa = args[args.indexOf("-D") + 1]!;
        if (l.prenos) {
          await l.prenos(mapa, m.signal);
          return "";
        }
        (l.artefakt ?? ((m: string) => {
          mkdirSync(path.join(m, "lina-apk-debug"), { recursive: true });
          writeFileSync(path.join(m, "lina-apk-debug", "app-debug.apk"), "APK");
        }))(mapa);
        return "";
      }
      throw new Error(`neznan klic ${program} ${a}`);
    },
    obvesti: async (_root, besedilo) => {
      obvestila.push(besedilo);
    },
    namestiDeb: async (_t, deb) => {
      namestitve.push(`${deb.pot} ${deb.sha256}`);
      return { ok: true, razlicica: "0.2.11" };
    },
  };
  return { osnova, dom, prejemi, podatki, token, klici, obvestila, namestitve, o, nastaviCas: (d: Date) => { zdaj = d; } };
}

type E = Awaited<ReturnType<typeof okolje>>;
const gh = (e: E) => e.klici.filter((k) => k.program === "/opt/gh/bin/gh").map((k) => k.args.join(" "));

async function zgradi(e: E, tok = "gradnja.yml", veja = "main") {
  let s = await ukazGradenj(e.token, { ukaz: "pripravi", tok, veja }, e.podatki, e.o);
  const g = s.gradnje[0]!;
  s = await ukazGradenj(e.token, { ukaz: "potrdi", id: g.id, zgostitev: g.zgostitev }, e.podatki, e.o);
  await spremljajGradnje(e.podatki, e.o);
  await spremljajGradnje(e.podatki, e.o);
  return (await stanjeGradenj(e.token, e.podatki, e.o)).gradnje.find((x) => x.id === g.id)!;
}

describe("gradnje-github.server: dostop in predlog", () => {
  it("brez seje lastnika nic; brez gesla (lokalna seja) priprava in zagon zavrnjena", async () => {
    const e = await okolje("dostop");
    await assert.rejects(stanjeGradenj(null, e.podatki, e.o));
    await assert.rejects(ukazGradenj("napacen", { ukaz: "pripravi", tok: "gradnja.yml", veja: "main" }, e.podatki, e.o));
    const podatki = path.join(e.osnova, "brez-gesla");
    mkdirSync(podatki);
    const seja = await odpriLokalnoSejo({ address: "127.0.0.1", forwardedFor: null, forwarded: null, host: "localhost:3000", origin: null, fetchSite: null }, podatki);
    assert.ok(seja);
    await assert.rejects(ukazGradenj(seja, { ukaz: "pripravi", tok: "gradnja.yml", veja: "main" }, podatki, e.o), { razlog: "geslo" });
    assert.deepEqual(gh(e), []);
  });

  it("tok samo s seznama, veja samo s seznama GitHuba (neveljavna imena z GitHuba zavrzena)", async () => {
    const e = await okolje("tok-veja");
    await assert.rejects(ukazGradenj(e.token, { ukaz: "pripravi", tok: "deploy.yml", veja: "main" }, e.podatki, e.o), { razlog: "tok" });
    await assert.rejects(ukazGradenj(e.token, { ukaz: "pripravi", tok: "gradnja.yml", veja: "drugo" }, e.podatki, e.o), { razlog: "veja" });
    await assert.rejects(ukazGradenj(e.token, { ukaz: "pripravi", tok: "gradnja.yml", veja: "-x" }, e.podatki, e.o), { razlog: "veja" });
    const s = await ukazGradenj(e.token, { ukaz: "veje" }, e.podatki, e.o);
    assert.deepEqual(s.veje, ["main", "dev"]);
    assert.deepEqual(gh(e)[0], "api --paginate repos/safeerOS/Lina/branches?per_page=100 --jq .[].name");
  });

  it("predlog nicesar ne zazene; Lina predlaga z izvorom lina; izklop v Nastavitvah zavrne predlog", async () => {
    const e = await okolje("predlog");
    const z = await predlagajGradnjo(e.podatki, "racunalnik.yml", "dev", e.o);
    assert.equal(z?.stanje, "caka");
    assert.equal(z?.izvor, "lina");
    assert.ok(!gh(e).some((a) => a.startsWith("workflow run")));
    await ukazGradenj(e.token, { ukaz: "vklop", vklop: false }, e.podatki, e.o);
    assert.equal(await predlagajGradnjo(e.podatki, "racunalnik.yml", "dev", e.o), null);
    const s = await stanjeGradenj(e.token, e.podatki, e.o);
    assert.equal(s.vklopljeno, false);
    await assert.rejects(ukazGradenj(e.token, { ukaz: "potrdi", id: z!.id, zgostitev: z!.zgostitev }, e.podatki, e.o), { razlog: "izklopljeno" });
  });

  it("stikalo je privzeto vklopljeno", async () => {
    const e = await okolje("privzeto");
    assert.equal((await stanjeGradenj(e.token, e.podatki, e.o)).vklopljeno, true);
  });
});

describe("gradnje-github.server: potrditev in zagon", () => {
  it("potrditev zahteva pravo zgostitev; zagon je argv brez lupine, stalen repozitorij, cwd = podatki, okolje brez skrivnosti Line", async () => {
    const e = await okolje("zagon");
    process.env.LINA_SKRIVNOST_PREIZKUS = "x";
    const s = await ukazGradenj(e.token, { ukaz: "pripravi", tok: "gradnja.yml", veja: "main" }, e.podatki, e.o);
    const g = s.gradnje[0]!;
    assert.equal(g.zgostitev, zgostitevGradnje("gradnja.yml", "main", C_MAIN));
    await assert.rejects(ukazGradenj(e.token, { ukaz: "potrdi", id: g.id, zgostitev: "0".repeat(64) }, e.podatki, e.o), { razlog: "zgostitev" });
    await ukazGradenj(e.token, { ukaz: "potrdi", id: g.id, zgostitev: g.zgostitev }, e.podatki, e.o);
    const zagon = e.klici.find((k) => k.args[0] === "workflow")!;
    assert.deepEqual(zagon.args, ["workflow", "run", "gradnja.yml", "-R", "safeerOS/Lina", "--ref", "main"]);
    assert.equal(zagon.cwd, e.podatki);
    assert.equal(zagon.env.LINA_SKRIVNOST_PREIZKUS, undefined);
    assert.equal(zagon.env.GH_PROMPT_DISABLED, "1");
    delete process.env.LINA_SKRIVNOST_PREIZKUS;
    // potrditev je enkratna
    await assert.rejects(ukazGradenj(e.token, { ukaz: "potrdi", id: g.id, zgostitev: g.zgostitev }, e.podatki, e.o), { razlog: "ni-najdeno" });
  });

  it("predlog po 15 min ugasne", async () => {
    const e = await okolje("potek");
    const g = (await ukazGradenj(e.token, { ukaz: "pripravi", tok: "gradnja.yml", veja: "main" }, e.podatki, e.o)).gradnje[0]!;
    e.nastaviCas(new Date(ZACETEK.getTime() + 16 * 60_000));
    await assert.rejects(ukazGradenj(e.token, { ukaz: "potrdi", id: g.id, zgostitev: g.zgostitev }, e.podatki, e.o), { razlog: "poteklo" });
  });

  it("veja, ki je na GitHubu ni vec, se ob potrditvi zavrne (seznam se osvezi)", async () => {
    const l: Lazno = {};
    const e = await okolje("veja-izginila", l);
    const g = (await ukazGradenj(e.token, { ukaz: "pripravi", tok: "gradnja.yml", veja: "dev" }, e.podatki, e.o)).gradnje[0]!;
    l.veje = "main\n";
    await assert.rejects(ukazGradenj(e.token, { ukaz: "potrdi", id: g.id, zgostitev: g.zgostitev }, e.podatki, e.o), { razlog: "veja" });
    assert.ok(!gh(e).some((a) => a.startsWith("workflow run")));
  });

  it("najvec en tek na tok: dva hkratna potrdila zazeneta en tek; drug tok sme", async () => {
    const e = await okolje("zaklep");
    await ukazGradenj(e.token, { ukaz: "pripravi", tok: "gradnja.yml", veja: "main" }, e.podatki, e.o);
    await ukazGradenj(e.token, { ukaz: "pripravi", tok: "gradnja.yml", veja: "dev" }, e.podatki, e.o);
    const s = await ukazGradenj(e.token, { ukaz: "pripravi", tok: "racunalnik.yml", veja: "main" }, e.podatki, e.o);
    const [deb, apk2, apk1] = s.gradnje;
    const izidi = await Promise.allSettled([
      ukazGradenj(e.token, { ukaz: "potrdi", id: apk1!.id, zgostitev: apk1!.zgostitev }, e.podatki, e.o),
      ukazGradenj(e.token, { ukaz: "potrdi", id: apk2!.id, zgostitev: apk2!.zgostitev }, e.podatki, e.o),
    ]);
    assert.equal(izidi.filter((i) => i.status === "fulfilled").length, 1);
    assert.equal((izidi.find((i) => i.status === "rejected") as PromiseRejectedResult).reason.razlog, "tok-zaseden");
    await ukazGradenj(e.token, { ukaz: "potrdi", id: deb!.id, zgostitev: deb!.zgostitev }, e.podatki, e.o);
    assert.equal(gh(e).filter((a) => a.startsWith("workflow run")).length, 2);
  });

  it("brez gh: razlog ni-gh, nic se ne zazene", async () => {
    const e = await okolje("brez-gh");
    const o = { ...e.o, najdi: () => null };
    const g = (await ukazGradenj(e.token, { ukaz: "pripravi", tok: "gradnja.yml", veja: "main" }, e.podatki, e.o)).gradnje[0]!;
    await assert.rejects(ukazGradenj(e.token, { ukaz: "potrdi", id: g.id, zgostitev: g.zgostitev }, e.podatki, o), { razlog: "ni-gh" });
  });
});

describe("gradnje-github.server: spremljanje, prenos, podpis", () => {
  it("najde tek z id vecjim od zadnjega pred zagonom, prebere anotacije opravil in prenese v novo vidno mapo", async () => {
    const e = await okolje("polno");
    const g = await zgradi(e);
    assert.equal(g.stanje, "koncano");
    assert.equal(g.tekId, 501);
    assert.ok(gh(e).includes("run view 501 -R safeerOS/Lina --json status,conclusion,createdAt,updatedAt,jobs"));
    assert.ok(gh(e).includes("api repos/safeerOS/Lina/check-runs/77/annotations"));
    assert.equal(g.anotacije.length, 1);
    const mapa = path.join(e.prejemi, "Lina gradnje", "2026-11-24 0905-gradnja-main");
    assert.equal(g.mapa, mapa);
    // prenos gre v skrito zacasno mapo (A-4); v vidno mapo se premakne sele po pregledu
    const prenos = gh(e).find((a) => a.startsWith("run download 501 -R safeerOS/Lina -n lina-apk-debug -D "))!;
    const zacasna = prenos.slice("run download 501 -R safeerOS/Lina -n lina-apk-debug -D ".length);
    assert.equal(path.dirname(zacasna), path.join(e.prejemi, "Lina gradnje"));
    assert.match(path.basename(zacasna), /^\./);
    assert.equal(existsSync(zacasna), false);
    assert.equal(g.paket?.pot, "lina-apk-debug/app-debug.apk");
    assert.equal(g.paket?.sha256, createHash("sha256").update("APK").digest("hex"));
    assert.equal(g.paket?.velikost, 3);
    assert.equal(g.podpis, "ujema");
    assert.equal(g.lahkoNamesti, true);
    // Lina sama pove izid enkrat: polna pot in sha256
    assert.equal(e.obvestila.length, 1);
    assert.ok(e.obvestila[0]!.includes(`${mapa}/lina-apk-debug/app-debug.apk`));
    assert.ok(e.obvestila[0]!.includes(g.paket!.sha256));
    assert.ok(!e.obvestila[0]!.includes("Opozorilo X"));
    await spremljajGradnje(e.podatki, e.o);
    assert.equal(e.obvestila.length, 1);
  });

  it("obstojeca mapa se nikoli ne prepise (pripona -2)", async () => {
    const e = await okolje("pripona");
    mkdirSync(path.join(e.prejemi, "Lina gradnje", "2026-11-24 0905-gradnja-main"), { recursive: true });
    writeFileSync(path.join(e.prejemi, "Lina gradnje", "2026-11-24 0905-gradnja-main", "moje.txt"), "ne prepisi");
    const g = await zgradi(e);
    assert.equal(g.mapa, path.join(e.prejemi, "Lina gradnje", "2026-11-24 0905-gradnja-main-2"));
    assert.equal(readFileSync(path.join(e.prejemi, "Lina gradnje", "2026-11-24 0905-gradnja-main", "moje.txt"), "utf8"), "ne prepisi");
  });

  it("artefakt s simbolno povezavo ali vec APK: napaka, brez namestitve", async () => {
    const e = await okolje("povezava", {
      artefakt: (m) => {
        mkdirSync(path.join(m, "a"), { recursive: true });
        writeFileSync(path.join(m, "a", "app.apk"), "APK");
        symlinkSync("/etc/passwd", path.join(m, "a", "passwd"));
      },
    });
    const g = await zgradi(e);
    assert.equal(g.stanje, "napaka");
    assert.equal(g.razlog, "artefakt");
    assert.equal(g.lahkoNamesti, false);
    const e2 = await okolje("dva-apk", {
      artefakt: (m) => {
        writeFileSync(path.join(m, "a.apk"), "A");
        writeFileSync(path.join(m, "b.apk"), "B");
      },
    });
    const g2 = await zgradi(e2);
    assert.equal(g2.razlog, "ni-paketa");
    assert.equal(g2.lahkoNamesti, false);
  });

  it("podpis drugacen ali dva podpisnika: ne-ujema, brez namestitve; brez apksigner: ni-preverjen", async () => {
    const e = await okolje("tuj-podpis", { podpis: `Signer #1 certificate SHA-256 digest: ${"b".repeat(64)}\n` });
    const g = await zgradi(e);
    assert.equal(g.podpis, "ne-ujema");
    assert.equal(g.lahkoNamesti, false);
    assert.equal(await apkZaTelefon(e.podatki), null);
    const e2 = await okolje("brez-apksigner");
    const najdi = e2.o.najdi!;
    e2.o.najdi = (p) => (p === "apksigner" ? null : najdi(p));
    const g2 = await zgradi(e2);
    assert.equal(g2.podpis, "ni-preverjen");
    assert.equal(g2.lahkoNamesti, false);
    assert.ok(e2.obvestila[0]!.includes("NI preverjen"));
  });

  it("neuspesen tek: stanje neuspesno, anotacije prebrane, brez prenosa", async () => {
    const e = await okolje("neuspeh", { tek: { status: "completed", conclusion: "failure", jobs: [{ databaseId: 9 }] } });
    const g = await zgradi(e);
    assert.equal(g.stanje, "neuspesno");
    assert.ok(gh(e).includes("api repos/safeerOS/Lina/check-runs/9/annotations"));
    assert.ok(!gh(e).some((a) => a.startsWith("run download")));
    assert.match(e.obvestila[0]!, /ni uspela/);
  });

  it("tek, ki ga GitHub ne pokaze v 10 min, je napaka in sprosti tok", async () => {
    const e = await okolje("ni-teka", { novTek: null });
    const g = (await ukazGradenj(e.token, { ukaz: "pripravi", tok: "gradnja.yml", veja: "main" }, e.podatki, e.o)).gradnje[0]!;
    await ukazGradenj(e.token, { ukaz: "potrdi", id: g.id, zgostitev: g.zgostitev }, e.podatki, e.o);
    await spremljajGradnje(e.podatki, e.o);
    assert.equal((await stanjeGradenj(e.token, e.podatki, e.o)).gradnje[0]!.stanje, "zaganja");
    e.nastaviCas(new Date(ZACETEK.getTime() + 11 * 60_000));
    await spremljajGradnje(e.podatki, e.o);
    const s = await stanjeGradenj(e.token, e.podatki, e.o);
    assert.equal(s.gradnje[0]!.stanje, "napaka");
    assert.equal(s.gradnje[0]!.razlog, "ni-teka");
  });
});

describe("gradnje-github.server: namestitev in telefon", () => {
  it("deb: namesti prek vgrajene posodobitve z mapo zadnje gradnje (brskalnik ne da poti)", async () => {
    const e = await okolje("deb", {
      artefakt: (m) => {
        mkdirSync(path.join(m, "lina-deb"));
        writeFileSync(path.join(m, "lina-deb", "lina-lupina_0.2.11_amd64.deb"), "DEB");
      },
    });
    const g = await zgradi(e, "racunalnik.yml", "main");
    assert.equal(g.stanje, "koncano");
    assert.equal(g.lahkoNamesti, true);
    await ukazGradenj(e.token, { ukaz: "namesti", id: g.id, mapa: "/etc", sha256: g.paket!.sha256, commit: g.commit }, e.podatki, e.o);
    assert.deepEqual(e.namestitve, [`${path.join(g.mapa!, "lina-deb", "lina-lupina_0.2.11_amd64.deb")} ${createHash("sha256").update("DEB").digest("hex")}`]);
  });

  it("APK za telefon: samo zadnja koncana gradnja s preverjenim podpisom, vsota se preveri ob branju", async () => {
    const e = await okolje("apk-telefon");
    assert.equal(await apkZaTelefon(e.podatki), null);
    const g = await zgradi(e);
    const a = await apkZaTelefon(e.podatki);
    assert.equal(a?.id, g.id);
    assert.equal(a?.sha256, g.paket!.sha256);
    assert.equal(a?.pot, path.join(g.mapa!, "lina-apk-debug", "app-debug.apk"));
    assert.equal(a?.paket, "si.safeer.lina");
    writeFileSync(a!.pot, "PODTAKNJEN");
    assert.equal(await apkZaTelefon(e.podatki), null);
  });

  it("APK, zamenjan s simbolno povezavo, se ne vrne", async () => {
    const e = await okolje("apk-povezava");
    const g = await zgradi(e);
    const pot = path.join(g.mapa!, "lina-apk-debug", "app-debug.apk");
    const kopija = path.join(e.osnova, "kopija.apk");
    writeFileSync(kopija, readFileSync(pot));
    // zamenjava datoteke s povezavo na enako vsebino: vsota bi se ujemala, O_NOFOLLOW jo zavrne
    const { renameSync } = await import("node:fs");
    renameSync(pot, `${pot}.x`);
    symlinkSync(kopija, pot);
    assert.equal(await apkZaTelefon(e.podatki), null);
  });

  it("telefon potrdi z zgostitvijo (tok+veja+commit); zgostitev drugega toka se zavrne", async () => {
    const e = await okolje("telefon-potrdi");
    const z = await predlagajGradnjo(e.podatki, "gradnja.yml", "main", e.o);
    await assert.rejects(telefonPotrdi(e.podatki, z!.id, zgostitevGradnje("racunalnik.yml", "main", C_MAIN), e.o), { razlog: "zgostitev" });
    await telefonPotrdi(e.podatki, z!.id, z!.zgostitev, e.o);
    assert.ok(gh(e).some((a) => a.startsWith("workflow run gradnja.yml")));
  });

  it("telefon: stanje samo osvezi zastarel seznam vej (gh), brez gesla ali ob izklopu ne klice gh", async () => {
    const e = await okolje("telefon-veje");
    assert.deepEqual((await telefonStanje(e.podatki, e.o)).veje, ["main", "dev"]);
    assert.equal(gh(e).length, 1);
    await telefonStanje(e.podatki, e.o);
    assert.equal(gh(e).length, 1, "svez seznam se ne bere znova");
    await ukazGradenj(e.token, { ukaz: "vklop", vklop: false }, e.podatki, e.o);
    e.nastaviCas(new Date(ZACETEK.getTime() + 6 * 60_000));
    await telefonStanje(e.podatki, e.o);
    assert.equal(gh(e).length, 1);
  });

  it("odpri mapo: samo mapa gradnje iz stanja prek xdg-open (argv)", async () => {
    const e = await okolje("odpri");
    const g = await zgradi(e);
    await ukazGradenj(e.token, { ukaz: "odpri", id: g.id, mapa: "/etc" }, e.podatki, e.o);
    const k = e.klici.find((x) => x.program === "/usr/bin/xdg-open")!;
    assert.deepEqual(k.args, [g.mapa]);
  });
});

describe("gradnje-github.server: pomozno in locitev", () => {
  it("B-4: GH_TOKEN in kljuci ponudnikov: gh dobi GH_* brez zetonov (najdba B4 1750), xdg-user-dir, apksigner in xdg-open nic od tega", async () => {
    const e = await okolje("okolje-otrok");
    process.env.GH_TOKEN = "gh-preizkus";
    process.env.GH_CONFIG_DIR = "/tmp/gh-preizkus";
    process.env.OPENAI_API_KEY = "sk-preizkus";
    try {
      const g = await zgradi(e);
      await ukazGradenj(e.token, { ukaz: "odpri", id: g.id }, e.podatki, e.o);
    } finally {
      delete process.env.GH_TOKEN;
      delete process.env.GH_CONFIG_DIR;
      delete process.env.OPENAI_API_KEY;
    }
    const ghKlic = e.klici.find((k) => k.program === "/opt/gh/bin/gh")!;
    assert.equal(ghKlic.env.GH_TOKEN, undefined);
    assert.equal(ghKlic.env.GH_CONFIG_DIR, "/tmp/gh-preizkus");
    assert.equal(ghKlic.env.OPENAI_API_KEY, undefined);
    for (const p of ["/usr/bin/xdg-user-dir", "/opt/sdk/build-tools/36.0.0/apksigner", "/usr/bin/xdg-open"]) {
      const k = e.klici.find((x) => x.program === p);
      assert.ok(k, p);
      assert.equal(k.env.GH_TOKEN, undefined, p);
      assert.equal(k.env.OPENAI_API_KEY, undefined, p);
    }
  });

  it("okolje za gh nima TWILIO_/LINA_/NITRO_", () => {
    const o = okoljeZaGh({ PATH: "/usr/bin", TWILIO_X: "a", LINA_Y: "b", nitro_z: "c", HOME: "/h" });
    assert.deepEqual(Object.keys(o).sort(), ["GH_NO_UPDATE_NOTIFIER", "GH_PROMPT_DISABLED", "HOME", "NO_COLOR", "PATH"]);
  });

  it("najdiProgram isce gh tudi v ~/.local/bin in apksigner v build-tools SDK (najvisja razlicica)", () => {
    const dom = path.join(KOREN, "najdi");
    mkdirSync(path.join(dom, ".local", "bin"), { recursive: true });
    writeFileSync(path.join(dom, ".local", "bin", "gh"), "", { mode: 0o755 });
    for (const r of ["34.0.0", "36.0.0"]) {
      mkdirSync(path.join(dom, "Android", "Sdk", "build-tools", r), { recursive: true });
      writeFileSync(path.join(dom, "Android", "Sdk", "build-tools", r, "apksigner"), "", { mode: 0o755 });
    }
    assert.equal(najdiProgram("gh", dom, { PATH: "" }), path.join(dom, ".local", "bin", "gh"));
    assert.equal(najdiProgram("apksigner", dom, { PATH: "" }), path.join(dom, "Android", "Sdk", "build-tools", "36.0.0", "apksigner"));
    assert.equal(najdiProgram("rm", dom, { PATH: "" }), null);
  });

  it("stanje je v podatkovni mapi z dovoljenji 0600", async () => {
    const e = await okolje("dovoljenja");
    await zgradi(e);
    assert.equal(statSync(path.join(e.podatki, DATOTEKA_STANJA)).mode & 0o777, 0o600);
  });

  it("oznaka v pogovoru: obdelajGradnjo odstrani oznako in ustvari samo predlog; pri priponkah samo odstrani", async () => {
    const e = await okolje("oznaka");
    const r = await obdelajGradnjo(e.podatki, "Seveda. [[gradnja: gradnja.yml | main]]", true, e.o);
    assert.match(r, /^Seveda\.\n\n\(Predlog gradnje/);
    assert.equal((await stanjeGradenj(e.token, e.podatki, e.o)).gradnje[0]!.stanje, "caka");
    assert.equal(await obdelajGradnjo(e.podatki, "Da. [[gradnja: gradnja.yml | main]]", false, e.o), "Da.");
    assert.equal((await stanjeGradenj(e.token, e.podatki, e.o)).gradnje.length, 1);
    const r2 = await obdelajGradnjo(e.podatki, "X [[gradnja: deploy.yml | main]]", true, e.o);
    assert.match(r2, /ni dovoljen/);
  });

  it("Lina pove izid v pogovoru: sporocilo Line se doda na konec zgodovine asistentke (meja 200)", async () => {
    const e = await okolje("pogovor");
    const zacetna = Array.from({ length: 200 }, (_, i) => ({ vloga: "lastnik", besedilo: `s${i}`, cas: "2026-11-24T08:00:00Z" }));
    writeFileSync(path.join(e.podatki, "asistent.json"), JSON.stringify(zacetna));
    await dodajSporociloLine(e.podatki, "Gradnja je uspela.");
    const z = JSON.parse(readFileSync(path.join(e.podatki, "asistent.json"), "utf8")) as Array<{ vloga: string; besedilo: string }>;
    assert.equal(z.length, 200);
    assert.deepEqual(z.at(-1)!.vloga, "lina");
    assert.equal(z.at(-1)!.besedilo, "Gradnja je uspela.");
    assert.equal(z[0]!.besedilo, "s1");
  });

  function izvorna(mapa: string, izhod: string[] = []): string[] {
    for (const ime of readdirSync(mapa)) {
      const pot = path.join(mapa, ime);
      if (lstatSync(pot).isDirectory()) {
        if (ime !== "node_modules") izvorna(pot, izhod);
      } else if (/\.(ts|tsx)$/.test(ime) && !/\.(test|spec)\.(ts|tsx)$/.test(ime)) izhod.push(pot);
    }
    return izhod;
  }

  it("modul uvazajo samo functions.ts, pogovor asistentke, streznik za telefon in zavihek Racunalnik (tajnica in klici ne)", () => {
    const uvozniki = izvorna(SRC)
      .filter((d) => /(?:from\s+|import\s*\(\s*)["'][^"']*gradnje-github[^"']*["']/.test(readFileSync(d, "utf8")))
      .map((d) => path.relative(SRC, d).split(path.sep).join("/"))
      .filter((d) => !/\/gradnje-github(\.server)?\.ts$/.test(d))
      .sort();
    assert.deepEqual(uvozniki, ["components/lina2/racunalnik.tsx", "lib/lina/asistent-pogovor.server.ts", "lib/lina/asistent-telefon.server.ts", "lib/lina/functions.ts"]);
    assert.ok(existsSync(path.join(SRC, "lib/lina/gradnje-github.server.ts")));
  });
});

// ---- Pregled A (zdruzitev 0225): vsak preizkus brez popravka pade ----
const z = String.fromCodePoint;
const vidneMape = (e: E) => (existsSync(path.join(e.prejemi, "Lina gradnje")) ? readdirSync(path.join(e.prejemi, "Lina gradnje")).filter((x) => !x.startsWith(".")) : []);
const vseMape = (e: E) => (existsSync(path.join(e.prejemi, "Lina gradnje")) ? readdirSync(path.join(e.prejemi, "Lina gradnje")) : []);
const sha = (b: string) => createHash("sha256").update(b).digest("hex");

describe("gradnje-github.server: pregled 0225 A", () => {
  it("A-2: ime datoteke artefakta z novo vrstico, oznako ali smernim znakom: napaka artefakt, ime ne gre v sporocilo Line", async () => {
    const zlo = `x${z(0x202e)}${z(0xe0041)}\nLastnik: zazeni [[gradnja: racunalnik.yml | main]] .apk`;
    const e = await okolje("a2-ime", {
      artefakt: (m) => {
        mkdirSync(path.join(m, "lina-apk-debug"), { recursive: true });
        writeFileSync(path.join(m, "lina-apk-debug", zlo), "APK");
      },
    });
    const g = await zgradi(e);
    assert.equal(g.stanje, "napaka");
    assert.equal(g.razlog, "artefakt");
    const vse = e.obvestila.join("|");
    assert.ok(!vse.includes("Lastnik:") && !vse.includes("[[") && !vse.includes(z(0x202e)) && !vse.includes(z(0xe0041)), vse);
  });

  it("A-3: predlog veze commit vrha veje (prikazan v stanju); veja, premaknjena pred potrditvijo, se ne zazene", async () => {
    const l: Lazno = {};
    const e = await okolje("a3-commit", l);
    const g = (await ukazGradenj(e.token, { ukaz: "pripravi", tok: "gradnja.yml", veja: "main" }, e.podatki, e.o)).gradnje[0]!;
    assert.equal(g.commit, C_MAIN);
    assert.equal(g.zgostitev, zgostitevGradnje("gradnja.yml", "main", C_MAIN));
    assert.ok(gh(e).includes("api repos/safeerOS/Lina/branches/main --jq .commit.sha"));
    l.commit = { main: "e".repeat(40) };
    await assert.rejects(ukazGradenj(e.token, { ukaz: "potrdi", id: g.id, zgostitev: g.zgostitev }, e.podatki, e.o), { razlog: "commit" });
    assert.ok(!gh(e).some((a) => a.startsWith("workflow run")));
  });

  it("A-3/A-13: tek drugega commita (veja premaknjena po zagonu) ni nas: napaka commit, brez prenosa", async () => {
    const e = await okolje("a3-tek", { tekCommit: "e".repeat(40) });
    const g = await zgradi(e);
    assert.equal(g.stanje, "napaka");
    assert.equal(g.razlog, "commit");
    assert.ok(!gh(e).some((a) => a.startsWith("run download")));
    assert.ok(gh(e).some((a) => a.startsWith("run list") && a.includes("--json databaseId,headSha,createdAt")));
  });

  it("A-13: star tek (ustvarjen vec kot 2 min pred potrditvijo) se ne vzame; neveljaven izpis seznama tekov ustavi zagon", async () => {
    const e = await okolje("a13-star", { tekUstvarjen: (d) => new Date(d.getTime() - 10 * 60_000).toISOString() });
    const g = await zgradi(e);
    assert.equal(g.tekId, null);
    assert.ok(!gh(e).some((a) => a.startsWith("run view")));
    const l: Lazno = {};
    const e2 = await okolje("a13-json", l);
    const p = (await ukazGradenj(e2.token, { ukaz: "pripravi", tok: "gradnja.yml", veja: "main" }, e2.podatki, e2.o)).gradnje[0]!;
    const izvedi = e2.o.izvedi!;
    e2.o.izvedi = async (program, args, m) => (args[0] === "run" && args[1] === "list" ? "<html>" : izvedi(program, args, m));
    await ukazGradenj(e2.token, { ukaz: "potrdi", id: p.id, zgostitev: p.zgostitev }, e2.podatki, e2.o);
    const s = await stanjeGradenj(e2.token, e2.podatki, e2.o);
    assert.equal(s.gradnje[0]!.stanje, "napaka");
    assert.equal(s.gradnje[0]!.razlog, "zagon");
    assert.ok(!gh(e2).some((a) => a.startsWith("workflow run")));
  });

  it("A-3: deb iz neprivzete veje se ne namesti, dokler je lastnik ne dovoli; namestitev zahteva prikazani sha256 in commit", async () => {
    const deb = (m: string) => {
      mkdirSync(path.join(m, "lina-deb"));
      writeFileSync(path.join(m, "lina-deb", "lina-lupina_0.2.11_amd64.deb"), "DEB");
    };
    const e = await okolje("a3-namesti", { artefakt: deb });
    const g = await zgradi(e, "racunalnik.yml", "dev");
    assert.equal(g.stanje, "koncano");
    assert.equal(g.commit, C_DEV);
    const ukaz = { ukaz: "namesti", id: g.id, sha256: sha("DEB"), commit: C_DEV };
    await assert.rejects(ukazGradenj(e.token, ukaz, e.podatki, e.o), { razlog: "veja-namestitev" });
    assert.deepEqual(e.namestitve, []);
    let s = await ukazGradenj(e.token, { ukaz: "namestitevVeja", veja: "dev", dovoli: true }, e.podatki, e.o);
    assert.deepEqual(s.namestitevVeje, ["main", "dev"]);
    assert.equal(s.gradnje.find((x) => x.id === g.id)!.lahkoNamesti, true);
    await assert.rejects(ukazGradenj(e.token, { ...ukaz, sha256: "0".repeat(64) }, e.podatki, e.o), { razlog: "zgostitev" });
    await assert.rejects(ukazGradenj(e.token, { ...ukaz, commit: C_MAIN }, e.podatki, e.o), { razlog: "zgostitev" });
    await assert.rejects(ukazGradenj(e.token, { ukaz: "namesti", id: g.id }, e.podatki, e.o), { razlog: "zgostitev" });
    assert.deepEqual(e.namestitve, []);
    s = await ukazGradenj(e.token, ukaz, e.podatki, e.o);
    assert.equal(e.namestitve.length, 1);
    // izklop stikala ne izbrise seznama dovoljenih vej (nastavitve se berejo in dopolnijo)
    s = await ukazGradenj(e.token, { ukaz: "vklop", vklop: false }, e.podatki, e.o);
    s = await ukazGradenj(e.token, { ukaz: "vklop", vklop: true }, e.podatki, e.o);
    assert.deepEqual(s.namestitevVeje, ["main", "dev"]);
    s = await ukazGradenj(e.token, { ukaz: "namestitevVeja", veja: "dev", dovoli: false }, e.podatki, e.o);
    assert.deepEqual(s.namestitevVeje, ["main"]);
    await assert.rejects(ukazGradenj(e.token, ukaz, e.podatki, e.o), { razlog: "veja-namestitev" });
  });

  it("A-3: pokvarjena datoteka nastavitev: seznam dovoljenih vej je prazen (fail-closed)", async () => {
    const e = await okolje("a3-pokvarjeno", { artefakt: (m) => writeFileSync(path.join(m, "lina-lupina_0.2.11_amd64.deb"), "DEB") });
    const g = await zgradi(e, "racunalnik.yml", "main");
    writeFileSync(path.join(e.podatki, "gradnje-github-nastavitve.json"), "{");
    await assert.rejects(ukazGradenj(e.token, { ukaz: "namesti", id: g.id, sha256: sha("DEB"), commit: C_MAIN }, e.podatki, e.o), { razlog: "veja-namestitev" });
  });

  it("A-4: artefakti, vecji od meje, se ne prenesejo", async () => {
    const e = await okolje("a4-velikost", { artefaktiBajtov: 700 * 1024 * 1024 });
    const g = await zgradi(e);
    assert.equal(g.stanje, "napaka");
    assert.equal(g.razlog, "prevelik");
    assert.ok(gh(e).includes("api repos/safeerOS/Lina/actions/runs/501/artifacts?per_page=100"));
    assert.ok(!gh(e).some((a) => a.startsWith("run download")));
  });

  it("A-4: razpakiranje cez mejo se prekine; delni prenos ne ostane in ni vidne mape", async () => {
    let prekinjeno = false;
    const e = await okolje("a4-bomba", {
      prenos: async (mapa, signal) => {
        writeFileSync(path.join(mapa, "velika.bin"), Buffer.alloc(4096));
        // gh se razpakira: ustavi ga samo prekinitev (signal), sicer bi cakal do roka
        await new Promise<void>((ok, ne) => {
          const t = setTimeout(ok, 3000);
          signal?.addEventListener("abort", () => { clearTimeout(t); prekinjeno = true; ne(new Error("prekinjeno")); });
        });
      },
    });
    e.o.najvecPrenos = 1024;
    const g = await zgradi(e);
    assert.equal(prekinjeno, true);
    assert.equal(g.stanje, "napaka");
    assert.equal(g.razlog, "prevelik");
    assert.equal(g.mapa, null);
    assert.deepEqual(vseMape(e), []);
  });

  it("A-4: neuspel prenos ne pusti vidne mape in ne zapise poti", async () => {
    const e = await okolje("a4-napaka", { prenosNapaka: true });
    const g = await zgradi(e);
    assert.equal(g.razlog, "prenos");
    assert.equal(g.mapa, null);
    assert.deepEqual(vseMape(e), []);
  });

  it("A-7: prenos ne drzi vrste stanja: predlog in odklon delujeta med prenosom", async () => {
    let sprosti: () => void = () => {};
    const vrata = new Promise<void>((r) => { sprosti = r; });
    const e = await okolje("a7-vrsta", {
      prenos: async (mapa) => {
        await vrata;
        mkdirSync(path.join(mapa, "lina-apk-debug"));
        writeFileSync(path.join(mapa, "lina-apk-debug", "app-debug.apk"), "APK");
      },
    });
    const g = (await ukazGradenj(e.token, { ukaz: "pripravi", tok: "gradnja.yml", veja: "main" }, e.podatki, e.o)).gradnje[0]!;
    await ukazGradenj(e.token, { ukaz: "potrdi", id: g.id, zgostitev: g.zgostitev }, e.podatki, e.o);
    const krog = spremljajGradnje(e.podatki, e.o);
    await new Promise((r) => setTimeout(r, 100));
    const rok = new Promise<"visi">((r) => setTimeout(() => r("visi"), 1500));
    const predlog = ukazGradenj(e.token, { ukaz: "pripravi", tok: "racunalnik.yml", veja: "dev" }, e.podatki, e.o).then(() => "ok" as const);
    assert.equal(await Promise.race([predlog, rok]), "ok");
    const vmes = await stanjeGradenj(e.token, e.podatki, e.o);
    assert.equal(vmes.gradnje.find((x) => x.id === g.id)!.stanje, "prenasa");
    // drug krog (gumb Osvezi) med prenosom ne zacne drugega prenosa istega teka
    await spremljajGradnje(e.podatki, e.o);
    sprosti();
    await krog;
    assert.equal(gh(e).filter((a) => a.startsWith("run download")).length, 1);
    const s = await stanjeGradenj(e.token, e.podatki, e.o);
    assert.equal(s.gradnje.find((x) => x.id === g.id)!.stanje, "koncano");
    assert.equal(s.gradnje.filter((x) => x.stanje === "caka").length, 1, "predlog med prenosom ostane");
  });

  it("A-10: izklop stikala velja tudi za APK telefonu, namestitev, odpiranje mape in tek v spremljanju", async () => {
    const e = await okolje("a10-izklop");
    const g = await zgradi(e);
    assert.notEqual(await apkZaTelefon(e.podatki), null);
    await ukazGradenj(e.token, { ukaz: "vklop", vklop: false }, e.podatki, e.o);
    assert.equal(await apkZaTelefon(e.podatki), null);
    await assert.rejects(ukazGradenj(e.token, { ukaz: "odpri", id: g.id }, e.podatki, e.o), { razlog: "izklopljeno" });
    assert.ok(!e.klici.some((k) => k.program === "/usr/bin/xdg-open"));
    const d = await okolje("a10-deb", { artefakt: (m) => writeFileSync(path.join(m, "lina-lupina_0.2.11_amd64.deb"), "DEB") });
    const gd = await zgradi(d, "racunalnik.yml", "main");
    await ukazGradenj(d.token, { ukaz: "vklop", vklop: false }, d.podatki, d.o);
    await assert.rejects(ukazGradenj(d.token, { ukaz: "namesti", id: gd.id, sha256: sha("DEB"), commit: C_MAIN }, d.podatki, d.o), { razlog: "izklopljeno" });
    assert.deepEqual(d.namestitve, []);
    const t = await okolje("a10-tek");
    const p = (await ukazGradenj(t.token, { ukaz: "pripravi", tok: "gradnja.yml", veja: "main" }, t.podatki, t.o)).gradnje[0]!;
    await ukazGradenj(t.token, { ukaz: "potrdi", id: p.id, zgostitev: p.zgostitev }, t.podatki, t.o);
    await ukazGradenj(t.token, { ukaz: "vklop", vklop: false }, t.podatki, t.o);
    await spremljajGradnje(t.podatki, t.o);
    const st = (await stanjeGradenj(t.token, t.podatki, t.o)).gradnje[0]!;
    assert.equal(st.stanje, "napaka");
    assert.equal(st.razlog, "izklopljeno");
    assert.ok(!gh(t).some((a) => a.startsWith("run download")));
    assert.deepEqual(vidneMape(t), []);
  });
});

describe("gradnje-github.server: pregled 0225 A (dopolnitve)", () => {
  it("A-4: prenese se samo artefakt paketa (-n); velika porocila preizkusov ne stejejo v mejo; artefakta ni = napaka prenos", async () => {
    const e = await okolje("a4-ime");
    const g = await zgradi(e, "racunalnik.yml", "main");
    assert.ok(gh(e).some((a) => a.startsWith("run download 501 -R safeerOS/Lina -n lina-deb -D ")), gh(e).join("\n"));
    assert.notEqual(g.razlog, "prevelik");
    const e2 = await okolje("a4-brez-artefakta");
    const izvedi = e2.o.izvedi!;
    e2.o.izvedi = async (p, args, m) => (args[1]?.startsWith("repos/safeerOS/Lina/actions/runs/") ? JSON.stringify({ artifacts: [{ name: "drugo", size_in_bytes: 1 }] }) : izvedi(p, args, m));
    const g2 = await zgradi(e2);
    assert.equal(g2.razlog, "prenos");
    assert.ok(!gh(e2).some((a) => a.startsWith("run download")));
  });

  it("A-4: razpakiranje, koncano pred prvo preverbo nadzora, se preveri po prenosu", async () => {
    const e = await okolje("a4-hitro", { prenos: async (mapa) => { writeFileSync(path.join(mapa, "app.apk"), Buffer.alloc(4096)); } });
    e.o.najvecPrenos = 1024;
    const g = await zgradi(e);
    assert.equal(g.razlog, "prevelik");
    assert.deepEqual(vseMape(e), []);
  });

  it("A-4: prenos, prekinjen s ponovnim zagonom, se ponovi najvec dvakrat", async () => {
    const e = await okolje("a4-poskusi");
    const p = (await ukazGradenj(e.token, { ukaz: "pripravi", tok: "gradnja.yml", veja: "main" }, e.podatki, e.o)).gradnje[0]!;
    await ukazGradenj(e.token, { ukaz: "potrdi", id: p.id, zgostitev: p.zgostitev }, e.podatki, e.o);
    const f = path.join(e.podatki, DATOTEKA_STANJA);
    const st = JSON.parse(readFileSync(f, "utf8"));
    Object.assign(st.gradnje[0], { stanje: "prenasa", tekId: 501, poskusiPrenosa: 2 });
    writeFileSync(f, JSON.stringify(st));
    await spremljajGradnje(e.podatki, e.o);
    const g = (await stanjeGradenj(e.token, e.podatki, e.o)).gradnje[0]!;
    assert.equal(g.stanje, "napaka");
    assert.equal(g.razlog, "prenos");
    assert.ok(!gh(e).some((a) => a.startsWith("run download")));
  });

  it("A-3: zapis brez commita (starejsa Lina) se ne potrdi, ne spremlja in ne namesti (fail-closed)", async () => {
    const e = await okolje("a3-brez-commita", { artefakt: (m) => writeFileSync(path.join(m, "lina-lupina_0.2.11_amd64.deb"), "DEB") });
    const g = await zgradi(e, "racunalnik.yml", "main");
    const p = (await ukazGradenj(e.token, { ukaz: "pripravi", tok: "gradnja.yml", veja: "dev" }, e.podatki, e.o)).gradnje[0]!;
    const f = path.join(e.podatki, DATOTEKA_STANJA);
    const st = JSON.parse(readFileSync(f, "utf8"));
    for (const x of st.gradnje) {
      delete x.commit;
      if (x.id === p.id) x.zgostitev = createHash("sha256").update("safeerOS/Lina\u0000gradnja.yml\u0000dev", "utf8").digest("hex");
    }
    writeFileSync(f, JSON.stringify(st));
    const s = await stanjeGradenj(e.token, e.podatki, e.o);
    assert.equal(s.gradnje.find((x) => x.id === g.id)!.lahkoNamesti, false);
    await assert.rejects(ukazGradenj(e.token, { ukaz: "namesti", id: g.id, sha256: sha("DEB") }, e.podatki, e.o), { razlog: "zgostitev" });
    await assert.rejects(ukazGradenj(e.token, { ukaz: "potrdi", id: p.id, zgostitev: s.gradnje.find((x) => x.id === p.id)!.zgostitev }, e.podatki, e.o), { razlog: "zgostitev" });
    assert.deepEqual(e.namestitve, []);
    // aktiven tek brez commita: spremljanje ga konca z razlogom commit
    const st2 = JSON.parse(readFileSync(f, "utf8"));
    Object.assign(st2.gradnje.find((x: { id: string }) => x.id === p.id), { stanje: "zaganja", potrjeno: ZACETEK.toISOString(), prejsnjiTek: 400 });
    writeFileSync(f, JSON.stringify(st2));
    await spremljajGradnje(e.podatki, e.o);
    const a = (await stanjeGradenj(e.token, e.podatki, e.o)).gradnje.find((x) => x.id === p.id)!;
    assert.equal(a.razlog, "commit");
  });
});
