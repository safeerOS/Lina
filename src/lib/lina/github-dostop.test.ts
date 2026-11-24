/** Cista logika dostopa do GitHuba (github-dostop.ts): oblike, zaprt seznam zahtev, device flow, workflow_dispatch, izbira. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GITHUB_CLIENT_ID,
  NAJVEC_IZBRANIH,
  NASLOV_POTRDITVE,
  datotekaIzPoti,
  imaRocniZagon,
  jeDovoljenaZahteva,
  jeDovoljenoTelo,
  jeOblikaKljuca,
  jeRepozitorij,
  normalizirajIzbiro,
  razberiKodoNaprave,
  razberiZeton,
  sploscenaIzbira,
  vsebinaDatoteke,
} from "./github-dostop.ts";

const PAT = `github_pat_${"A1b2".repeat(20)}`;
const GHP = `ghp_${"x9".repeat(18)}`;

describe("github-dostop: oblike", () => {
  it("client id je zaenkrat prazen (pot OAuth skrita, dokler ga vodja ne vpise)", () => {
    assert.equal(GITHUB_CLIENT_ID, "");
  });

  it("kljuc: samo github_pat_ in ghp_ z dovolj znaki, brez presledkov in drugih predpon", () => {
    assert.equal(jeOblikaKljuca(PAT), true);
    assert.equal(jeOblikaKljuca(GHP), true);
    for (const slab of ["", "ghp_kratek", `gho_${"a".repeat(36)}`, `${PAT} `, `${PAT}\n`, `x${GHP}`, `github_pat_${"a".repeat(10)}`, 42, null, `ghp_${"a".repeat(30)}-`]) {
      assert.equal(jeOblikaKljuca(slab), false, String(slab));
    }
  });

  it("repozitorij: lastnik/ime, brez .., vodilnega vezaja, tretjega dela", () => {
    assert.equal(jeRepozitorij("safeerOS/Lina"), true);
    assert.equal(jeRepozitorij("a-b/c.d_e"), true);
    for (const slab of ["safeerOS", "a/b/c", "-a/b", "a/..", "a/.", "a/-x", "a/b.git", "a /b", "a/b?x", "../b", "a/%2e%2e"]) {
      assert.equal(jeRepozitorij(slab), false, slab);
    }
  });

  it("pot toka iz API: samo .github/workflows/<ime>.yml, nikoli druga mapa", () => {
    assert.equal(datotekaIzPoti(".github/workflows/gradnja.yml"), "gradnja.yml");
    assert.equal(datotekaIzPoti(".github/workflows/x.yaml"), "x.yaml");
    for (const slab of [".github/workflows/../secrets.yml", ".github/workflows/a/b.yml", "workflows/a.yml", ".github/workflows/-x.yml", ".github/workflows/.x.yml", ".github/workflows/a.sh", "dynamic/pages/pages-build-deployment"]) {
      assert.equal(datotekaIzPoti(slab), null, slab);
    }
  });
});

describe("github-dostop: zaprt seznam zahtev (metoda + pot)", () => {
  it("dovoli branje uporabnika, repozitorijev, vej, tokov, tekov, anotacij in vsebine toka", () => {
    for (const p of [
      "user",
      "user/repos?per_page=100&page=3&sort=updated",
      "repos/safeerOS/Lina",
      "repos/safeerOS/Lina/branches?per_page=100&page=1",
      "repos/safeerOS/Lina/actions/workflows?per_page=100",
      "repos/safeerOS/Lina/actions/workflows/gradnja.yml",
      "repos/safeerOS/Lina/actions/workflows/gradnja.yml/runs?branch=main&event=workflow_dispatch&per_page=5",
      "repos/safeerOS/Lina/actions/runs/123456",
      "repos/safeerOS/Lina/actions/runs/123456/jobs",
      "repos/safeerOS/Lina/actions/runs/123456/artifacts",
      "repos/safeerOS/Lina/check-runs/77/annotations",
      "repos/safeerOS/Lina/contents/.github/workflows/gradnja.yml",
    ]) {
      assert.equal(jeDovoljenaZahteva("GET", p), true, p);
    }
    assert.equal(jeDovoljenaZahteva("POST", "repos/safeerOS/Lina/actions/workflows/gradnja.yml/dispatches"), true);
  });

  it("zavrne pisanje drugje, skrivnosti, poljubne poti, nadomestke gh, zastavice, .., kodiranje in tuje parametre", () => {
    const zavrnjene: Array<[string, string]> = [
      ["POST", "repos/a/b/actions/runs/1/rerun"],
      ["DELETE", "repos/a/b/actions/runs/1"],
      ["PUT", "repos/a/b/actions/secrets/X"],
      ["GET", "repos/a/b/actions/secrets"],
      ["GET", "repos/a/b/actions/variables"],
      ["GET", "repos/a/b/actions/runs/1/logs"],
      ["GET", "repos/a/b/actions/artifacts/5/zip"],
      ["GET", "repos/a/b/contents/README.md"],
      ["GET", "repos/a/b/contents/.github/workflows/../../x.yml"],
      ["GET", "repos/{owner}/{repo}/branches"],
      ["GET", "-X"],
      ["GET", "--hostname=evil/user"],
      ["GET", "/user"],
      ["GET", "user/"],
      ["GET", "https://evil.example/user"],
      ["GET", "user/repos?per_page=1000"],
      ["GET", "user/repos?visibility=all"],
      ["GET", "user/repos?page=1&page=2"],
      ["GET", "user/repos?"],
      ["GET", "repos/a/b/branches%2F.."],
      ["GET", "repos/a/b/branches?x"],
      ["GET", "repos/a/b//branches"],
      ["GET", "repos/a/../branches"],
      ["GET", "user repos"],
      ["GET", "orgs/x/repos"],
      ["GET", "repos/a/b/actions/workflows/123/runs"],
      ["POST", "repos/a/b/actions/workflows/x.sh/dispatches"],
      ["POST", "user"],
    ];
    for (const [m, p] of zavrnjene) assert.equal(jeDovoljenaZahteva(m, p), false, `${m} ${p}`);
  });

  it("telo samo { ref, inputs } z nizi; nic drugega", () => {
    assert.equal(jeDovoljenoTelo({ ref: "main" }), true);
    assert.equal(jeDovoljenoTelo({ ref: "veja/x", inputs: { tip: "apk" } }), true);
    for (const slab of [null, [], { ref: "-main" }, { ref: "a b" }, { ref: "main", x: 1 }, { ref: "main", inputs: { "a b": "x" } }, { ref: "main", inputs: { a: 1 } }, { ref: "main", inputs: { a: "x\ny" } }]) {
      assert.equal(jeDovoljenoTelo(slab), false, JSON.stringify(slab));
    }
  });
});

describe("github-dostop: OAuth device flow", () => {
  const dobra = { device_code: "3584d83530557fdd1f46af8289938c8ef79f9dc5", user_code: "WDJB-MJHT", verification_uri: NASLOV_POTRDITVE, expires_in: 900, interval: 5 };

  it("koda naprave: oblika kode, stalen naslov potrditve, meje intervala", () => {
    assert.deepEqual(razberiKodoNaprave(dobra), { deviceCode: dobra.device_code, userCode: "WDJB-MJHT", naslov: NASLOV_POTRDITVE, poteceSek: 900, intervalSek: 5 });
    assert.equal(razberiKodoNaprave({ ...dobra, verification_uri: "https://evil.example/login/device" }), null);
    assert.equal(razberiKodoNaprave({ ...dobra, user_code: "<script>" }), null);
    assert.equal(razberiKodoNaprave({ ...dobra, device_code: "a b" }), null);
    assert.equal(razberiKodoNaprave({ ...dobra, interval: 0 })?.intervalSek, 5);
    assert.equal(razberiKodoNaprave({ ...dobra, interval: 9999 })?.intervalSek, 5);
  });

  it("zeton: cakaj, pocasneje (+5 s ali dani interval), poteklo, zavrnjeno, napacen zeton = napaka", () => {
    assert.deepEqual(razberiZeton({ error: "authorization_pending" }, 5), { vrsta: "cakaj" });
    assert.deepEqual(razberiZeton({ error: "slow_down" }, 5), { vrsta: "pocasneje", intervalSek: 10 });
    assert.deepEqual(razberiZeton({ error: "slow_down", interval: 15 }, 5), { vrsta: "pocasneje", intervalSek: 15 });
    assert.deepEqual(razberiZeton({ error: "expired_token" }, 5), { vrsta: "poteklo" });
    assert.deepEqual(razberiZeton({ error: "access_denied" }, 5), { vrsta: "zavrnjeno" });
    assert.deepEqual(razberiZeton({ error: "incorrect_device_code" }, 5), { vrsta: "napaka" });
    const z = `gho_${"Q".repeat(36)}`;
    assert.deepEqual(razberiZeton({ access_token: z, token_type: "bearer" }, 5), { vrsta: "zeton", zeton: z });
    assert.deepEqual(razberiZeton({ access_token: "neveljaven" }, 5), { vrsta: "napaka" });
    assert.deepEqual(razberiZeton(null, 5), { vrsta: "napaka" });
  });
});

describe("github-dostop: workflow_dispatch", () => {
  const ja = [
    "on: workflow_dispatch\njobs: {}",
    "on: [push, workflow_dispatch]\n",
    "on: { push: { branches: [main] }, workflow_dispatch: {} }\n",
    "name: x\non:\n  push:\n    branches: [main]\n  workflow_dispatch:\n    inputs:\n      tip:\n        type: string\njobs:\n  a: {}\n",
    "on:\n  - push\n  - workflow_dispatch\n",
    "'on':\n  workflow_dispatch:\n",
    "on:\r\n  workflow_dispatch: # rocno\r\n",
  ];
  const ne = [
    "on: push\njobs:\n  a:\n    if: github.event_name == 'workflow_dispatch'\n",
    "on:\n  push:\n    branches: [main]\n# workflow_dispatch:\njobs: {}\n",
    "on:\n  push:\n    inputs:\n      workflow_dispatch: x\n",
    "on:\n  push:\njobs:\n  workflow_dispatch:\n    runs-on: x\n",
    "jobs:\n  a: {}\n",
    "on: [push]  # workflow_dispatch\n",
  ];
  it("prepozna rocni zagon samo kot neposreden otrok kljuca on:", () => {
    for (const y of ja) assert.equal(imaRocniZagon(y), true, y);
    for (const y of ne) assert.equal(imaRocniZagon(y), false, y);
    assert.equal(imaRocniZagon(42), false);
    assert.equal(imaRocniZagon("on: workflow_dispatch\n" + "#".repeat(300_000)), false);
  });

  it("vsebina datoteke iz contents API (base64 s prelomi)", () => {
    const b64 = Buffer.from("on: workflow_dispatch\n").toString("base64");
    assert.equal(vsebinaDatoteke({ encoding: "base64", content: `${b64.slice(0, 8)}\n${b64.slice(8)}` }), "on: workflow_dispatch\n");
    assert.equal(vsebinaDatoteke({ encoding: "utf8", content: "x" }), null);
  });
});

describe("github-dostop: izbira repozitorijev in tokov", () => {
  it("normalizacija: samo veljavno, brez podvojitev, prazni repozitoriji izpadejo, meja izbranih", () => {
    const vhod = [
      { repozitorij: "safeerOS/Lina", tokovi: [{ tok: "gradnja.yml", vrsta: "apk" }, { tok: "racunalnik.yml", vrsta: "deb" }, { tok: "gradnja.yml", vrsta: "deb" }, { tok: "../x.yml", vrsta: "apk" }, { tok: "a.yml", vrsta: "exe" }] },
      { repozitorij: "safeeros/lina", tokovi: [{ tok: "x.yml", vrsta: "drugo" }] },
      { repozitorij: "a/b", tokovi: [] },
      { repozitorij: "zlo/../x", tokovi: [{ tok: "a.yml", vrsta: "apk" }] },
      "niz",
    ];
    const izid = normalizirajIzbiro(vhod);
    assert.deepEqual(izid, [{ repozitorij: "safeerOS/Lina", tokovi: [{ tok: "gradnja.yml", vrsta: "apk" }, { tok: "racunalnik.yml", vrsta: "deb" }] }]);
    assert.deepEqual(sploscenaIzbira(izid), [
      { repozitorij: "safeerOS/Lina", tok: "gradnja.yml", vrsta: "apk" },
      { repozitorij: "safeerOS/Lina", tok: "racunalnik.yml", vrsta: "deb" },
    ]);
    const veliko = Array.from({ length: 50 }, (_, i) => ({ repozitorij: `a/r${i}`, tokovi: [{ tok: "x.yml", vrsta: "apk" }] }));
    assert.equal(normalizirajIzbiro(veliko).length, NAJVEC_IZBRANIH);
    assert.deepEqual(normalizirajIzbiro("x"), []);
  });
});
