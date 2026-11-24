/**
 * Samodejni pregled projekta ob prvem odprtju agenta v novem projektu.
 * Ideja: claude-code-setup (anthropics/claude-plugins-official, Apache-2.0); lastna koda po ideji.
 *
 * Pravila:
 * - Privzeto VKLOPLJENO s stikalom (pregled-projekta.json; manjkajoca datoteka = true; izklopi samo izrecni false).
 * - Strogo SAMO BRANJE: brez namescanja vticnikov, brez izvajanja ukazov, brez branja .env ali skrivnosti.
 * - Brez sledenja simbolnim povezavam (lstat + O_NOFOLLOW) in z mejo velikosti branja (64 KB).
 * - Tajnica (klici) te datoteke ne uvaza.
 */
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";
import { jeSkrivnost } from "./spomin.ts";
import { resolveDataDir, writeJson } from "./store.server.ts";

export const PREGLED_PROJEKTA_NASTAVITVE = "pregled-projekta.json";
export const MEJA_ZNAKOV_PREGLEDA = 1200;
const MEJA_BRANJA_B = 64 * 1024;
const MEJA_NASTAVITEV_B = 4096;
const O_VARNO_BRANJE = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

export type PregledProjekta = {
  jeziki: string[];
  testnaOrodja: string[];
  ukaziZaPreverbo: string[];
};

function ocistiVrstico(s: string, najvec = 140): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, " ")
    .replace(/\[\[|\]\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, najvec);
}

/** Varno branje obicajne datoteke v mapi projekta (brez simbolnih povezav, z mejo bajtov). */
async function preberiDatotekoVarno(pot: string): Promise<string | null> {
  let st;
  try {
    st = await lstat(pot);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size > MEJA_BRANJA_B) return null;
  let h;
  try {
    h = await open(pot, O_VARNO_BRANJE);
  } catch {
    return null;
  }
  try {
    const st2 = await h.stat();
    if (!st2.isFile() || st2.size > MEJA_BRANJA_B) return null;
    const buf = Buffer.allocUnsafe(st2.size);
    const { bytesRead } = await h.read(buf, 0, st2.size, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await h.close().catch(() => undefined);
  }
}

async function jeDatoteka(pot: string): Promise<boolean> {
  try {
    return (await lstat(pot)).isFile();
  } catch {
    return false;
  }
}

/** Stikalo: privzeto VKLOPLJENO; samo izrecni false izklopi. */
export async function jePregledProjektaVklopljen(dir?: string): Promise<boolean> {
  const pot = path.join(resolveDataDir(dir), PREGLED_PROJEKTA_NASTAVITVE);
  let st;
  try {
    st = await lstat(pot);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw e;
  }
  if (!st.isFile() || st.size > MEJA_NASTAVITEV_B) return false;
  let h;
  try {
    h = await open(pot, O_VARNO_BRANJE);
  } catch {
    return false;
  }
  try {
    const buf = Buffer.alloc(MEJA_NASTAVITEV_B);
    const { bytesRead } = await h.read(buf, 0, buf.length, 0);
    const j = JSON.parse(buf.subarray(0, bytesRead).toString("utf8")) as { vklopljen?: unknown };
    return j.vklopljen !== false;
  } catch {
    return true;
  } finally {
    await h.close().catch(() => undefined);
  }
}

export async function nastaviPregledProjekta(vklopljen: boolean, dir?: string): Promise<boolean> {
  const v = vklopljen === true;
  await writeJson(resolveDataDir(dir), PREGLED_PROJEKTA_NASTAVITVE, { vklopljen: v });
  return v;
}

/** Ali Lina v tej projektni mapi se nikoli ni potrdila/odprla naloge (nov projekt). */
export function jeNovProjekt(naloge: ReadonlyArray<{ id: string; mapa: string; potrjeno: string | null }>, mapa: string, trenutniId?: string): boolean {
  const cilj = path.resolve(mapa);
  return !naloge.some((n) => n.id !== trenutniId && n.potrjeno !== null && path.resolve(n.mapa) === cilj);
}

const DOVOLJENI_SKRIPTI = /^(?:test(?::[a-z0-9_-]+)?|check|typecheck|tsc|lint|build|verify|e2e|unit)$/i;

/** Pregleda mapo projekta (samo branje) in vrne zaznane jezike, testna orodja in ukaze za preverbo. */
export async function zaznajPregledProjekta(mapa: string): Promise<PregledProjekta> {
  const jeziki = new Set<string>();
  const testnaOrodja = new Set<string>();
  const ukaziZaPreverbo: string[] = [];
  const dodajUkaz = (u: string) => {
    const c = ocistiVrstico(u, 140);
    if (!c || jeSkrivnost(c) || ukaziZaPreverbo.includes(c) || ukaziZaPreverbo.length >= 8) return;
    ukaziZaPreverbo.push(c);
  };

  let vnosi: string[] = [];
  try {
    vnosi = await readdir(mapa);
  } catch {
    return { jeziki: [], testnaOrodja: [], ukaziZaPreverbo: [] };
  }
  const ima = (ime: string) => vnosi.includes(ime);

  // 1. Node.js / TypeScript / JavaScript (package.json)
  const pkgRaw = ima("package.json") ? await preberiDatotekoVarno(path.join(mapa, "package.json")) : null;
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as {
        scripts?: Record<string, unknown>;
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
      };
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      if (ima("tsconfig.json") || "typescript" in deps) jeziki.add("TypeScript");
      jeziki.add("JavaScript (Node.js)");
      if ("vitest" in deps) testnaOrodja.add("Vitest");
      if ("jest" in deps) testnaOrodja.add("Jest");
      if ("@playwright/test" in deps || "playwright" in deps) testnaOrodja.add("Playwright");
      const upravljalnik = ima("pnpm-lock.yaml") ? "pnpm" : ima("yarn.lock") ? "yarn" : "npm run";
      const scripts = pkg.scripts ?? {};
      for (const [ime, vrednost] of Object.entries(scripts)) {
        if (!DOVOLJENI_SKRIPTI.test(ime) || typeof vrednost !== "string") continue;
        // Telo skripta je podatek iz repozitorija: samo za zaznavo orodja. V ukaz gre ime, nikoli telo.
        const cistSkript = ocistiVrstico(vrednost, 100);
        if (cistSkript && !jeSkrivnost(cistSkript)) {
          if (/node\s+.*--test/.test(cistSkript)) testnaOrodja.add("node:test");
          if (/\bvitest\b/.test(cistSkript)) testnaOrodja.add("Vitest");
          if (/\bjest\b/.test(cistSkript)) testnaOrodja.add("Jest");
          if (/\bplaywright\b/.test(cistSkript)) testnaOrodja.add("Playwright");
        }
        const klic = ime === "test" && upravljalnik === "npm run" ? "npm test" : `${upravljalnik} ${ime}`;
        dodajUkaz(klic);
      }
    } catch {
      /* neveljaven package.json */
    }
  } else if (ima("tsconfig.json")) {
    jeziki.add("TypeScript");
  }

  // 2. Gradle (Android / Kotlin / Java)
  const gradleDatoteka = ["build.gradle.kts", "build.gradle", "app/build.gradle.kts", "app/build.gradle"].find(
    (rel) => ima(rel.split("/")[0]!),
  );
  const gradleRaw =
    (await preberiDatotekoVarno(path.join(mapa, "build.gradle.kts"))) ??
    (await preberiDatotekoVarno(path.join(mapa, "build.gradle"))) ??
    (await preberiDatotekoVarno(path.join(mapa, "app", "build.gradle.kts"))) ??
    (await preberiDatotekoVarno(path.join(mapa, "app", "build.gradle")));
  if (gradleRaw || ima("settings.gradle") || ima("settings.gradle.kts") || (gradleDatoteka && (await jeDatoteka(path.join(mapa, gradleDatoteka))))) {
    const vsebina = gradleRaw ?? "";
    if (/kotlin|build\.gradle\.kts/i.test(vsebina) || ima("build.gradle.kts") || ima("settings.gradle.kts")) jeziki.add("Kotlin");
    if (/java|android/i.test(vsebina) || ima("build.gradle")) jeziki.add(/android/i.test(vsebina) ? "Android/Java" : "Java");
    testnaOrodja.add(/junit/i.test(vsebina) ? "Gradle / JUnit" : "Gradle test");
    const gw = ima("gradlew") ? "./gradlew" : "gradle";
    dodajUkaz(`${gw} test`);
    if (/android/i.test(vsebina)) dodajUkaz(`${gw} testDebugUnitTest`);
    else dodajUkaz(`${gw} check`);
  }

  // 3. Python
  const pyRaw = ima("pyproject.toml") ? await preberiDatotekoVarno(path.join(mapa, "pyproject.toml")) : null;
  if (pyRaw || ima("pytest.ini") || ima("requirements.txt") || ima("setup.py")) {
    jeziki.add("Python");
    if (ima("pytest.ini") || /pytest/i.test(pyRaw ?? "")) {
      testnaOrodja.add("pytest");
      dodajUkaz("pytest");
    } else {
      testnaOrodja.add("unittest");
      dodajUkaz("python3 -m unittest");
    }
  }

  // 4. Rust
  if (ima("Cargo.toml")) {
    jeziki.add("Rust");
    testnaOrodja.add("cargo test");
    dodajUkaz("cargo test");
  }

  // 5. Go
  if (ima("go.mod")) {
    jeziki.add("Go");
    testnaOrodja.add("go test");
    dodajUkaz("go test ./...");
  }

  return {
    jeziki: [...jeziki],
    testnaOrodja: [...testnaOrodja],
    ukaziZaPreverbo,
  };
}

/** Sestavi kratek razdelek »Pregled projekta« za NALOGA.md (prazno ob izklopu ali ce ni zaznanih podatkov). */
export async function sestaviPregledProjekta(
  mapa: string,
  moznosti: { dir?: string; vklopljen?: boolean } = {},
): Promise<string> {
  const vklopljen = moznosti.vklopljen ?? (moznosti.dir ? await jePregledProjektaVklopljen(moznosti.dir) : true);
  if (!vklopljen) return "";
  const p = await zaznajPregledProjekta(mapa);
  if (p.jeziki.length === 0 && p.testnaOrodja.length === 0 && p.ukaziZaPreverbo.length === 0) return "";
  const vrstice: string[] = [
    "Samodejni pregled novega projekta (samo branje, brez nameščanja vtičnikov):",
  ];
  if (p.jeziki.length > 0) vrstice.push(`- Jeziki/okolje: ${p.jeziki.join(", ")}`);
  if (p.testnaOrodja.length > 0) vrstice.push(`- Testi: ${p.testnaOrodja.join(", ")}`);
  if (p.ukaziZaPreverbo.length > 0) {
    vrstice.push("- Ukazi za preverbo dela:");
    for (const u of p.ukaziZaPreverbo) vrstice.push(`  - \`${u}\``);
  }
  return vrstice.join("\n").slice(0, MEJA_ZNAKOV_PREGLEDA);
}
