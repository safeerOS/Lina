/**
 * Nastavitve > GitHub, streznik (github-dostop.server.ts). Vse omrezje in gh sta vbrizgana: noben preizkus ne doseze GitHuba.
 * Kljuc/zeton (strazar) nikoli v odgovor, napako, dnevnik ali datoteko v cistem besedilu; vse zahteva lastnika; tajnica modula ne uvaza.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { setupOwner } from "./auth.server.ts";
import {
  DATOTEKA_DOSTOPA,
  DATOTEKA_IZBIRE,
  dovoljeniTokovi,
  githubZahteva,
  odjavaGithub,
  okoljeZaGh,
  preveriPrijavoGithub,
  seznamRepozitorijev,
  shraniIzbiroGithub,
  shraniKljucGithub,
  stanjeGithub,
  tokoviRepozitorija,
  uporabiGh,
  zacniPrijavoGithub,
  type OdvisnostiGithub,
  type ZahtevaHttp,
} from "./github-dostop.server.ts";
import { VRSTE_KLJUCEV } from "./kljuci-sinhron.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-github-dostop-"));
after(() => rmSync(KOREN, { recursive: true, force: true }));
let st = 0;
async function okolje() {
  const dir = path.join(KOREN, `p${st++}`);
  mkdirSync(dir, { recursive: true });
  const token = await setupOwner("geslo-test-1234", dir);
  return { dir, token };
}

const KLJUC = `github_pat_${"STRAZAR".repeat(6)}_kljuc`;
const ZETON_OAUTH = `gho_${"Z9".repeat(20)}`;
type Klic = { url: string; method: string; headers: Record<string, string>; body?: string };

/** Lazni GitHub: /user vrne racun samo za znan zeton; repozitoriji, tokovi in vsebine iz tabele. */
function lazniGithub(m: { repov?: number; zavrni?: boolean; tokovi?: Record<string, string> } = {}) {
  const klici: Klic[] = [];
  const http: ZahtevaHttp = async (url, init) => {
    klici.push({ url, ...init });
    const u = new URL(url);
    const avt = init.headers.Authorization ?? "";
    const pravi = avt === `Bearer ${KLJUC}` || avt === `Bearer ${ZETON_OAUTH}`;
    if (u.hostname === "api.github.com" && !pravi) return { status: 401, json: { message: "Bad credentials" } };
    if (u.pathname === "/user") return m.zavrni ? { status: 401, json: {} } : { status: 200, json: { login: "ana-dev", id: 1 } };
    if (u.pathname === "/user/repos") {
      const stran = Number(u.searchParams.get("page"));
      const vseh = m.repov ?? 3;
      const od = (stran - 1) * 100;
      const n = Math.max(0, Math.min(100, vseh - od));
      return { status: 200, json: Array.from({ length: n }, (_, i) => ({ full_name: `ana-dev/r${od + i}`, private: i % 2 === 0 })) };
    }
    const wf = /^\/repos\/([^/]+\/[^/]+)\/actions\/workflows$/.exec(u.pathname);
    if (wf) {
      return {
        status: 200,
        json: {
          workflows: [
            { path: ".github/workflows/gradnja.yml", name: "APK", state: "active" },
            { path: ".github/workflows/ci.yml", name: "CI", state: "active" },
            { path: ".github/workflows/staro.yml", name: "Staro", state: "disabled_manually" },
            { path: "dynamic/pages/pages-build-deployment", name: "pages", state: "active" },
            { path: ".github/workflows/../../zlo.yml", name: "zlo", state: "active" },
          ],
        },
      };
    }
    const vs = /^\/repos\/[^/]+\/[^/]+\/contents\/\.github\/workflows\/(.+)$/.exec(u.pathname);
    if (vs) {
      const yml = (m.tokovi ?? { "gradnja.yml": "on:\n  workflow_dispatch:\n", "ci.yml": "on: [push]\n" })[vs[1]];
      return yml ? { status: 200, json: { encoding: "base64", content: Buffer.from(yml).toString("base64") } } : { status: 404, json: {} };
    }
    if (u.pathname.endsWith("/dispatches")) return { status: 204, json: null };
    return { status: 404, json: {} };
  };
  return { http, klici };
}

/** Lazni gh: belezi argv; auth status uspe ali ne; api user vrne racun. */
function lazniGh(prijavljen = true) {
  const klici: Array<{ program: string; args: readonly string[]; env: NodeJS.ProcessEnv; cwd: string }> = [];
  const o: OdvisnostiGithub = {
    najdiGh: () => "/usr/bin/gh",
    izvedi: async (program, args, m) => {
      klici.push({ program, args, env: m.env, cwd: m.cwd });
      if (args[0] === "auth") return { koda: prijavljen ? 0 : 1, izpis: "" };
      if (args[0] === "api" && args[1] === "user") return { koda: 0, izpis: "gh-racun\n" };
      if (args[0] === "api") return { koda: 0, izpis: '{"workflows":[]}' };
      return { koda: 1, izpis: "" };
    },
  };
  return { o, klici };
}

/** Vse datoteke v mapi podatkov (rekurzivno) kot besedilo. */
function vseDatoteke(dir: string): string {
  let izid = "";
  for (const ime of readdirSync(dir, { recursive: true }) as string[]) {
    const p = path.join(dir, ime);
    if (statSync(p).isFile()) izid += readFileSync(p, "latin1");
  }
  return izid;
}

describe("github-dostop: kljuc", () => {
  it("napacna oblika se ne poslje na GitHub in ne shrani; zavrnjen kljuc se ne shrani", async () => {
    const e = await okolje();
    const g = lazniGithub();
    await assert.rejects(shraniKljucGithub(e.token, "ghp_kratek", e.dir, { http: g.http }), /oblike/);
    assert.equal(g.klici.length, 0);
    const z = lazniGithub({ zavrni: true });
    await assert.rejects(shraniKljucGithub(e.token, KLJUC, e.dir, { http: z.http }), (n: Error) => !n.message.includes(KLJUC) && /ni sprejel/.test(n.message));
    assert.equal(existsSync(path.join(e.dir, DATOTEKA_DOSTOPA)), false);
  });

  it("veljaven kljuc: preverba GET /user, stanje »Povezano kot« brez kljuca, sifrirano 0600, kljuc nikjer v cistem besedilu", async () => {
    const e = await okolje();
    const g = lazniGithub();
    const izpisi: string[] = [];
    const prej = { log: console.log, info: console.info, warn: console.warn, error: console.error };
    for (const k of ["log", "info", "warn", "error"] as const) console[k] = (...a: unknown[]) => void izpisi.push(a.map(String).join(" "));
    let s;
    try {
      s = await shraniKljucGithub(e.token, `  ${KLJUC}  `, e.dir, { http: g.http, najdiGh: () => null });
    } finally {
      Object.assign(console, prej);
    }
    assert.deepEqual(s, { nacin: "kljuc", racun: "ana-dev", oauthNaVoljo: false, ghNaVoljo: false });
    assert.equal(g.klici[0].url, "https://api.github.com/user");
    assert.equal(g.klici[0].headers.Authorization, `Bearer ${KLJUC}`);
    assert.equal(statSync(path.join(e.dir, DATOTEKA_DOSTOPA)).mode & 0o777, 0o600);
    assert.ok(!vseDatoteke(e.dir).includes("STRAZAR"), "kljuc ni v nobeni datoteki v cistem besedilu");
    assert.ok(!izpisi.join("\n").includes("STRAZAR"), "kljuc ni v dnevniku");
    assert.ok(!JSON.stringify(await stanjeGithub(e.token, e.dir, { najdiGh: () => null })).includes("STRAZAR"));
    // Zahteve z zetonom gredo samo na api.github.com
    const r = await githubZahteva("repos/ana-dev/r1/actions/workflows?per_page=100", {}, e.dir, { http: g.http });
    assert.equal(r.status, 200);
    assert.ok(!JSON.stringify(r).includes("STRAZAR"));
    assert.equal(new URL(g.klici.at(-1)!.url).hostname, "api.github.com");
  });

  it("odjava odstrani dostop; nato githubZahteva zavrne", async () => {
    const e = await okolje();
    const g = lazniGithub();
    await shraniKljucGithub(e.token, KLJUC, e.dir, { http: g.http });
    const s = await odjavaGithub(e.token, e.dir, { najdiGh: () => null });
    assert.equal(s.nacin, null);
    assert.equal(existsSync(path.join(e.dir, DATOTEKA_DOSTOPA)), false);
    await assert.rejects(githubZahteva("user", {}, e.dir, { http: g.http }), /ni povezan/);
  });

  it("vsi javni vhodi zahtevajo lastnika", async () => {
    const e = await okolje();
    const g = lazniGithub();
    const o = { http: g.http, clientId: "Iv1.test", ...lazniGh().o };
    for (const klic of [
      () => stanjeGithub("napacen", e.dir, o),
      () => shraniKljucGithub("napacen", KLJUC, e.dir, o),
      () => uporabiGh(null, e.dir, o),
      () => zacniPrijavoGithub("napacen", e.dir, o),
      () => preveriPrijavoGithub("napacen", e.dir, o),
      () => odjavaGithub("napacen", e.dir, o),
      () => seznamRepozitorijev("napacen", e.dir, o),
      () => tokoviRepozitorija("napacen", "a/b", e.dir, o),
      () => shraniIzbiroGithub("napacen", [], e.dir, o),
    ]) {
      await assert.rejects(klic());
    }
    assert.equal(g.klici.length, 0);
  });
});

describe("github-dostop: gh", () => {
  it("uporabiGh: izhodna koda auth status, racun iz gh api user; zeton gh se ne bere; okolje brez skrivnosti Line", async () => {
    const e = await okolje();
    const gh = lazniGh();
    const s = await uporabiGh(e.token, e.dir, gh.o);
    assert.deepEqual(s, { nacin: "gh", racun: "gh-racun", oauthNaVoljo: false, ghNaVoljo: true });
    assert.deepEqual(gh.klici.map((k) => k.args), [["auth", "status", "--hostname", "github.com"], ["api", "user", "--jq", ".login"]]);
    for (const k of gh.klici) {
      assert.equal(k.program, "/usr/bin/gh");
      assert.equal(k.cwd, e.dir);
      assert.ok(!k.args.some((a) => /token|show-token/.test(a)), "nikoli gh auth token / --show-token");
    }
    const env = okoljeZaGh({ PATH: "/usr/bin", TWILIO_AUTH_TOKEN: "x", LINA_X: "y", GH_TOKEN: "z", GITHUB_TOKEN: "w", HOME: "/h" });
    assert.equal(env.TWILIO_AUTH_TOKEN, undefined);
    assert.equal(env.LINA_X, undefined);
    assert.equal(env.GH_TOKEN, undefined);
    assert.equal(env.GITHUB_TOKEN, undefined);
    assert.equal(env.GH_PROMPT_DISABLED, "1");
    assert.equal(env.HOME, "/h");
  });

  it("gh ne dobi kljucev ponudnikov (seznam dovoljenega, pregled 24. 11. 2026 B-4)", () => {
    const env = okoljeZaGh({ PATH: "/usr/bin", HOME: "/h", OPENAI_API_KEY: "a", ANTHROPIC_API_KEY: "b", XAI_API_KEY: "c", OPENROUTER_API_KEY: "d", GEMINI_API_KEY: "e", GOOGLE_API_KEY: "f", GH_HOST: "github.com", XDG_CONFIG_HOME: "/h/.config" });
    for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) assert.equal(env[k], undefined, k);
    assert.equal(env.GH_HOST, "github.com");
    assert.equal(env.XDG_CONFIG_HOME, "/h/.config");
    assert.equal(env.PATH, "/usr/bin");
  });

  it("gh brez prijave: zavrne in nic ne shrani", async () => {
    const e = await okolje();
    await assert.rejects(uporabiGh(e.token, e.dir, lazniGh(false).o), /gh/);
    assert.equal(existsSync(path.join(e.dir, DATOTEKA_DOSTOPA)), false);
  });

  it("githubZahteva prek gh: argv brez lupine, pot kot en argument, telo samo z -f (nikoli -F)", async () => {
    const e = await okolje();
    const gh = lazniGh();
    await uporabiGh(e.token, e.dir, gh.o);
    gh.klici.length = 0;
    const r = await githubZahteva("repos/a/b/actions/workflows/gradnja.yml/dispatches", { metoda: "POST", telo: { ref: "main", inputs: { tip: "@/etc/passwd" } } }, e.dir, gh.o);
    assert.equal(r.status, 200);
    assert.deepEqual(gh.klici[0].args, [
      "api", "--method", "POST", "-H", "Accept: application/vnd.github+json", "repos/a/b/actions/workflows/gradnja.yml/dispatches",
      "-f", "ref=main", "-f", "inputs[tip]=@/etc/passwd",
    ]);
    assert.ok(!gh.klici[0].args.includes("-F"));
  });
});

describe("github-dostop: githubZahteva zavrne nedovoljeno (pred kakrsnokoli zahtevo)", () => {
  it("poti, metode in telesa zunaj seznama", async () => {
    const e = await okolje();
    const g = lazniGithub();
    await shraniKljucGithub(e.token, KLJUC, e.dir, { http: g.http });
    const pred = g.klici.length;
    const gh = lazniGh();
    for (const [pot, init] of [
      ["repos/a/b/actions/secrets", {}],
      ["-X", {}],
      ["https://evil.example/user", {}],
      ["repos/{owner}/{repo}/branches", {}],
      ["repos/a/b/actions/workflows/x.yml/dispatches", { metoda: "POST", telo: { ref: "main", x: 1 } }],
      ["repos/a/b/actions/workflows/x.yml/dispatches", { metoda: "POST" }],
      ["user", { telo: { ref: "main" } }],
    ] as const) {
      await assert.rejects(githubZahteva(pot, init as never, e.dir, { http: g.http, ...gh.o }), /ne pošlje/, pot);
    }
    assert.equal(g.klici.length, pred);
    assert.equal(gh.klici.length, 0);
  });
});

describe("github-dostop: OAuth device flow", () => {
  it("brez client id pot ni na voljo (stanje in zacetek)", async () => {
    const e = await okolje();
    const g = lazniGithub();
    assert.equal((await stanjeGithub(e.token, e.dir, { najdiGh: () => null })).oauthNaVoljo, false);
    await assert.rejects(zacniPrijavoGithub(e.token, e.dir, { http: g.http }), /še ni na voljo/);
    assert.equal(g.klici.length, 0);
  });

  it("koda -> cakaj -> slow_down -> zeton: device_code nikoli v odgovor; interval spostovan; zeton sifriran", async () => {
    const e = await okolje();
    const api = lazniGithub();
    let cas = 1_000_000;
    const odgovori: unknown[] = [{ error: "authorization_pending" }, { error: "slow_down", interval: 10 }, { access_token: ZETON_OAUTH, token_type: "bearer" }];
    const klici: Klic[] = [];
    const http: ZahtevaHttp = async (url, init) => {
      klici.push({ url, ...init });
      if (url === "https://github.com/login/device/code") {
        return { status: 200, json: { device_code: "DEVICECODESKRIVNOST123456", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 } };
      }
      if (url === "https://github.com/login/oauth/access_token") return { status: 200, json: odgovori.shift() };
      return api.http(url, init);
    };
    const o: OdvisnostiGithub = { http, clientId: "Iv1.test", zdaj: () => cas, najdiGh: () => null };
    const z = await zacniPrijavoGithub(e.token, e.dir, o);
    assert.deepEqual(z, { koda: "ABCD-1234", naslov: "https://github.com/login/device", poteceSek: 900, intervalSek: 5 });
    assert.ok(!JSON.stringify(z).includes("DEVICECODE"));
    assert.match(klici[0].body ?? "", /client_id=Iv1.test/);
    // prezgodaj: na GitHub ne gre nic
    assert.deepEqual(await preveriPrijavoGithub(e.token, e.dir, o), { izid: "cakaj", intervalSek: 5 });
    assert.equal(klici.length, 1);
    cas += 5_000;
    assert.deepEqual(await preveriPrijavoGithub(e.token, e.dir, o), { izid: "cakaj", intervalSek: 5 });
    assert.match(klici[1].body ?? "", /device_code=DEVICECODESKRIVNOST123456/);
    cas += 5_000;
    assert.deepEqual(await preveriPrijavoGithub(e.token, e.dir, o), { izid: "cakaj", intervalSek: 10 });
    cas += 5_000; // manj od novega intervala: ni zahteve
    await preveriPrijavoGithub(e.token, e.dir, o);
    assert.equal(klici.filter((k) => k.url.endsWith("access_token")).length, 2);
    cas += 5_000;
    const p = await preveriPrijavoGithub(e.token, e.dir, o);
    assert.equal(p.izid, "povezano");
    assert.deepEqual(p.stanje, { nacin: "oauth", racun: "ana-dev", oauthNaVoljo: true, ghNaVoljo: false });
    assert.ok(!JSON.stringify(p).includes(ZETON_OAUTH));
    assert.ok(!vseDatoteke(e.dir).includes(ZETON_OAUTH));
    assert.deepEqual(await preveriPrijavoGithub(e.token, e.dir, o), { izid: "ni-prijave" });
  });

  it("potekla koda: »poteklo« brez zahteve; zavrnjena: »zavrnjeno«", async () => {
    const e = await okolje();
    let cas = 0;
    let odgovor: unknown = { error: "access_denied" };
    const http: ZahtevaHttp = async (url) =>
      url.endsWith("/device/code")
        ? { status: 200, json: { device_code: "DEVICECODESKRIVNOST123456", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 60, interval: 5 } }
        : { status: 400, json: odgovor };
    const o: OdvisnostiGithub = { http, clientId: "Iv1.test", zdaj: () => cas, najdiGh: () => null };
    await zacniPrijavoGithub(e.token, e.dir, o);
    cas = 61_000;
    assert.deepEqual(await preveriPrijavoGithub(e.token, e.dir, o), { izid: "poteklo" });
    await zacniPrijavoGithub(e.token, e.dir, o);
    cas += 5_000;
    assert.deepEqual(await preveriPrijavoGithub(e.token, e.dir, o), { izid: "zavrnjeno" });
    odgovor = null;
  });
});

describe("github-dostop: repozitoriji, tokovi, izbira", () => {
  it("repozitoriji stran po stran, najvec 300", async () => {
    const e = await okolje();
    const g = lazniGithub({ repov: 450 });
    await shraniKljucGithub(e.token, KLJUC, e.dir, { http: g.http });
    const r = await seznamRepozitorijev(e.token, e.dir, { http: g.http });
    assert.equal(r.length, 300);
    assert.equal(g.klici.filter((k) => k.url.includes("/user/repos")).length, 3);
    const m = lazniGithub({ repov: 7 });
    assert.equal((await seznamRepozitorijev(e.token, e.dir, { http: m.http })).length, 7);
    assert.equal(m.klici.filter((k) => k.url.includes("/user/repos")).length, 1);
  });

  it("tokovi: samo aktivni iz .github/workflows, rocni zagon iz vsebine .yml; poti zunaj se ne berejo", async () => {
    const e = await okolje();
    const g = lazniGithub();
    await shraniKljucGithub(e.token, KLJUC, e.dir, { http: g.http });
    const t = await tokoviRepozitorija(e.token, "ana-dev/r1", e.dir, { http: g.http });
    assert.deepEqual(t, [
      { tok: "gradnja.yml", ime: "APK", rocniZagon: true },
      { tok: "ci.yml", ime: "CI", rocniZagon: false },
    ]);
    assert.ok(!g.klici.some((k) => k.url.includes("zlo") || k.url.includes("staro")));
    await assert.rejects(tokoviRepozitorija(e.token, "../x", e.dir, { http: g.http }), /ni veljavno/);
  });

  it("izbira: shrani samo tokove z rocnim zagonom na GitHubu (0600); dovoljeniTokovi za gradnjo; brez izbire prazno", async () => {
    const e = await okolje();
    const g = lazniGithub();
    assert.deepEqual(await dovoljeniTokovi(e.dir), []);
    await shraniKljucGithub(e.token, KLJUC, e.dir, { http: g.http });
    const shranjeno = await shraniIzbiroGithub(
      e.token,
      [{ repozitorij: "ana-dev/r1", tokovi: [{ tok: "gradnja.yml", vrsta: "apk" }, { tok: "ci.yml", vrsta: "deb" }, { tok: "izmisljen.yml", vrsta: "deb" }] }],
      e.dir,
      { http: g.http },
    );
    assert.deepEqual(shranjeno, [{ repozitorij: "ana-dev/r1", tokovi: [{ tok: "gradnja.yml", vrsta: "apk" }] }]);
    assert.equal(statSync(path.join(e.dir, DATOTEKA_IZBIRE)).mode & 0o777, 0o600);
    assert.deepEqual(await dovoljeniTokovi(e.dir), [{ repozitorij: "ana-dev/r1", tok: "gradnja.yml", vrsta: "apk" }]);
    await shraniIzbiroGithub(e.token, [], e.dir, { http: g.http });
    assert.deepEqual(await dovoljeniTokovi(e.dir), []);
  });
});

/** Datoteke, dosegljive z uvozi iz danih vstopov (relativni in @/ uvozi); isti postopek kot kanal-claude.test.ts 4.4. */
const KOREN_PROJEKTA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
function dosegljive(vstopi: string[]): Set<string> {
  const videno = new Set<string>();
  const vrsta = vstopi.map((v) => path.join(KOREN_PROJEKTA, v));
  while (vrsta.length) {
    const f = vrsta.pop()!;
    if (videno.has(f) || !existsSync(f)) continue;
    videno.add(f);
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["']((?:\.{1,2}|@)\/[^"']+)["']/g)) {
      const osnova = m[1].startsWith("@/") ? path.join(KOREN_PROJEKTA, "src", m[1].slice(2)) : path.resolve(path.dirname(f), m[1]);
      for (const kand of [osnova, osnova + ".ts", osnova + ".tsx", path.join(osnova, "index.ts")]) {
        if (existsSync(kand) && statSync(kand).isFile()) {
          vrsta.push(kand);
          break;
        }
      }
    }
  }
  return videno;
}

it("tajnica (vsi vhodi klica: Twilio/Live, SIP, telefon) ne uvaza modula GitHub", () => {
  const tajnica = dosegljive([
    "src/routes/api/voice/$.ts",
    "src/lib/lina/voice.server.ts",
    "src/lib/lina/service.server.ts",
    "src/lib/lina/twilio.server.ts",
    "src/lib/lina/tajnica.ts",
    "src/lib/lina/live/vstop.server.ts",
    "src/lib/lina/live/most.ts",
    "src/lib/lina/live/telefon-zagon.server.ts",
    "src/lib/lina/sip/sluzba-sip.server.ts",
  ]);
  assert.ok(tajnica.size > 20, `premalo datotek (${tajnica.size})`);
  assert.deepEqual([...tajnica].filter((f) => /github-dostop|components\/github/.test(f)), []);
  assert.ok([...tajnica].some((f) => f.endsWith("opozorilo.server.ts")), "vrata opozorila so na poti klica");
});

it("kljuc GitHub nikoli na telefon ali v izvoz: ni med kljuci za sinhronizacijo, datoteke dostopa ne bere noben drug modul", () => {
  assert.deepEqual(VRSTE_KLJUCEV.filter((v) => /git/i.test(v)), [], "GitHub ni na seznamu kljucev za telefon");
  const src = path.join(KOREN_PROJEKTA, "src");
  const bralci = (readdirSync(src, { recursive: true }) as string[])
    .filter((f) => /\.(ts|tsx|mts)$/.test(f) && !/\.(test|spec)\.(ts|tsx)$/.test(f) && !f.endsWith("github-dostop.server.ts"))
    .filter((f) => /DATOTEKA_DOSTOPA|github-dostop\.json/.test(readFileSync(path.join(src, f), "utf8")));
  assert.deepEqual(bralci, [], "github-dostop.json bere samo github-dostop.server.ts");
});
