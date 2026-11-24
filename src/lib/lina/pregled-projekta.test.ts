/**
 * Preizkusi za tocko 5 (claude-code-setup -> kratek »pregled projekta« ob prvem odprtju agenta v novem projektu).
 * Strogo samo branje, brez namescanja vticnikov, brez omrezja, brez auth/adc.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";
import { vsebinaNaloge } from "./claude-naloge.ts";
import {
  jeNovProjekt,
  jePregledProjektaVklopljen,
  nastaviPregledProjekta,
  sestaviPregledProjekta,
  zaznajPregledProjekta,
} from "./pregled-projekta.server.ts";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function novaMapa(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-pregled-projekta-"));
  temps.push(dir);
  return dir;
}

describe("pregled-projekta (claude-code-setup): zaznava in prvi zagon", () => {
  it("zazna TypeScript/Node projekt iz package.json (testi, typecheck, vitest) in zavrne skrivnosti v skriptah", async () => {
    const proj = await novaMapa();
    await writeFile(path.join(proj, "tsconfig.json"), "{}");
    await writeFile(
      path.join(proj, "package.json"),
      JSON.stringify({
        name: "primer",
        scripts: {
          test: "node --experimental-strip-types --test src/*.test.ts",
          typecheck: "tsc --noEmit",
          lint: "eslint .",
          check: "API_KEY=sk-tajni1234567890abcdef12 npm test",
        },
        devDependencies: { typescript: "^5.0.0", vitest: "^2.0.0" },
      }),
    );

    const p = await zaznajPregledProjekta(proj);
    assert.ok(p.jeziki.includes("TypeScript"));
    assert.ok(p.testnaOrodja.includes("Vitest"));
    assert.ok(p.testnaOrodja.includes("node:test"));
    assert.ok(p.ukaziZaPreverbo.some((u) => u.startsWith("npm test")));
    assert.ok(p.ukaziZaPreverbo.some((u) => u.startsWith("npm run typecheck")));
    assert.ok(!p.ukaziZaPreverbo.some((u) => u.includes("sk-tajni")), "skrivnost v skripti ne sme v pregled");

    const blok = await sestaviPregledProjekta(proj);
    assert.match(blok, /TypeScript/);
    assert.match(blok, /npm test/);
    assert.match(blok, /brez nameščanja vtičnikov/);

    const md = vsebinaNaloge({ id: "0123456789abcdef", izvor: "lastnik", besedilo: "Popravi test" }, new Date(0), {
      pregledProjekta: blok,
    });
    assert.match(md, /## Pregled projekta/);
    assert.match(md, /npm run typecheck/);
  });

  it("zazna Gradle (Android/Kotlin) in Python/Rust/Go projekte", async () => {
    const android = await novaMapa();
    await mkdir(path.join(android, "app"), { recursive: true });
    await writeFile(path.join(android, "gradlew"), "#!/bin/sh\n");
    await writeFile(path.join(android, "app", "build.gradle.kts"), 'plugins { id("com.android.application"); kotlin("android") }\ndependencies { testImplementation("junit:junit:4.13.2") }');
    const pa = await zaznajPregledProjekta(android);
    assert.ok(pa.jeziki.includes("Kotlin"));
    assert.ok(pa.testnaOrodja.includes("Gradle / JUnit"));
    assert.ok(pa.ukaziZaPreverbo.includes("./gradlew test"));
    assert.ok(pa.ukaziZaPreverbo.includes("./gradlew testDebugUnitTest"));

    const py = await novaMapa();
    await writeFile(path.join(py, "pyproject.toml"), "[tool.pytest.ini_options]\ntestpaths = ['tests']\n");
    const pp = await zaznajPregledProjekta(py);
    assert.ok(pp.jeziki.includes("Python"));
    assert.ok(pp.ukaziZaPreverbo.includes("pytest"));

    const rs = await novaMapa();
    await writeFile(path.join(rs, "Cargo.toml"), '[package]\nname = "demo"\n');
    assert.ok((await zaznajPregledProjekta(rs)).ukaziZaPreverbo.includes("cargo test"));
  });

  it("jeNovProjekt: true ob prvem odprtju, false po prvi potrjeni nalogi v isti mapi", () => {
    assert.equal(jeNovProjekt([], "/home/a/p", "1111111111111111"), true);
    assert.equal(
      jeNovProjekt([{ id: "1111111111111111", mapa: "/home/a/p", potrjeno: null }], "/home/a/p", "1111111111111111"),
      true,
      "nepotrjen predlog se ne steje kot ze odprt projekt",
    );
    assert.equal(
      jeNovProjekt(
        [{ id: "aaaa111111111111", mapa: "/home/a/p", potrjeno: "2026-11-24T01:00:00Z" }],
        "/home/a/p",
        "bbbb222222222222",
      ),
      false,
      "druga naloga v isti mapi ni vec nov projekt",
    );
    assert.equal(
      jeNovProjekt(
        [{ id: "aaaa111111111111", mapa: "/home/a/p1", potrjeno: "2026-11-24T01:00:00Z" }],
        "/home/a/p2",
        "bbbb222222222222",
      ),
      true,
      "druga mapa je nov projekt",
    );
  });

  it("stikalo privzeto VKLOPLJENO; ob izklopu ne doda pregleda; simbolna povezava za package.json se prezre", async () => {
    const dir = await novaMapa();
    const proj = await novaMapa();
    await writeFile(path.join(proj, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));

    assert.equal(await jePregledProjektaVklopljen(dir), true);
    const blok = await sestaviPregledProjekta(proj, { dir });
    assert.match(blok, /Vitest/);
    assert.match(blok, /npm test/);
    assert.equal(blok.includes("vitest run"), false);

    await nastaviPregledProjekta(false, dir);
    assert.equal(await jePregledProjektaVklopljen(dir), false);
    assert.equal(await sestaviPregledProjekta(proj, { dir }), "");

    const projSym = await novaMapa();
    await symlink(path.join(proj, "package.json"), path.join(projSym, "package.json"));
    const ps = await zaznajPregledProjekta(projSym);
    assert.deepEqual(ps.ukaziZaPreverbo, [], "simbolna povezava za package.json se ne bere");
  });

  it("locitev: tajnica (klici) ne uvaza pregled-projekta; claude-naloge.server.ts ga uporablja", async () => {
    const srv = await readFile(path.join(SRC, "lib/lina/claude-naloge.server.ts"), "utf8");
    assert.match(srv, /pregled-projekta\.server\.ts/);
    assert.match(srv, /jeNovProjekt/);
    assert.match(srv, /sestaviPregledProjekta/);

    for (const rel of ["lib/lina/service.server.ts", "lib/lina/brain.ts", "lib/lina/govor.ts", "lib/lina/guards.ts", "lib/lina/tajnica.ts"]) {
      const v = await readFile(path.join(SRC, rel), "utf8");
      assert.doesNotMatch(v, /pregled-projekta/, `${rel} ne sme uvazati pregled-projekta`);
    }
  });
});
