/**
 * Naloga 16: OpenLine se v namescenem paketu ni nikoli zagnal, ker zaganjalnika openline-start.mjs ni bilo v paketu, koda pa ga je
 * iskala ob import.meta.url svezenja (.output/server/_ssr). Zdaj: zaganjalnik je v korenu OpenLine (extraResources), koda ga
 * razresi iz korena, manjkajoc zaganjalnik je jasna napaka, CI (deb in NSIS) zazene OpenLine iz razpakiranega paketa.
 * Vse poti so zacasne; OpenLine je lazen (izpise vrstici pripravljenosti kot pravi dist/index.js).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { IME_ZAGANJALNIKA, zagotoviOpenLine, zaganjalnikZaKoren } from "./openline-zagon.server.ts";
import { datotekaPaketa, korenNamestitve } from "./viri-paketa.server.ts";

const KOREN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const beri = (p: string) => readFileSync(path.join(KOREN, p), "utf8");
const IZVOR = path.join(KOREN, "src", "lib", "lina", IME_ZAGANJALNIKA);
const PREVERBA = path.join(KOREN, "scripts", "preverba-openline-paketa.mjs");

// lazen OpenLine: vrstici pripravljenosti kot openline/server/src/index.ts, nato caka (zaganjalnik ga ustavi ob zaprtju stdin)
const LAZNI_OPENLINE = `console.log("OpenLine slusa na " + process.env.PUBLIC_URL);
console.log("Odtis certifikata SHA-256: " + Array.from({ length: 32 }, () => "AB").join(":"));
setInterval(() => {}, 1000);
`;

function paket(zZaganjalnikom: boolean): string {
  const viri = mkdtempSync(path.join(tmpdir(), "lina-n16-"));
  mkdirSync(path.join(viri, "openline", "dist"), { recursive: true });
  writeFileSync(path.join(viri, "openline", "dist", "index.js"), LAZNI_OPENLINE);
  writeFileSync(path.join(viri, "openline", "package.json"), '{"type":"module"}');
  if (zZaganjalnikom) copyFileSync(IZVOR, path.join(viri, "openline", IME_ZAGANJALNIKA));
  return viri;
}

describe("naloga 16: zaganjalnik OpenLine v paketu", () => {
  it("zaganjalnik se razresi iz korena OpenLine; brez njega razvojna pot ob viru", () => {
    const viri = paket(true);
    assert.equal(zaganjalnikZaKoren(path.join(viri, "openline")), path.join(viri, "openline", IME_ZAGANJALNIKA));
    assert.equal(zaganjalnikZaKoren(path.join(paket(false), "openline")), IZVOR);
    assert.equal(zaganjalnikZaKoren(), IZVOR);
  });

  it("manjkajoc zaganjalnik: takoj »OpenLine ni v paketu«, brez zagona otroka in brez cakanja na rok", async () => {
    const viri = paket(false);
    let zagnan = 0;
    const t0 = Date.now();
    await assert.rejects(
      zagotoviOpenLine(viri, "192.168.77.7", {
        korenOpenLine: () => path.join(viri, "openline"),
        zaganjalnik: () => path.join(viri, "openline", IME_ZAGANJALNIKA),
        zazeni: () => { zagnan += 1; throw new Error("ne sme"); },
        pripraviLino: async () => { throw new Error("ne sme"); },
      }),
      /^Error: OpenLine ni v paketu$/,
    );
    assert.equal(zagnan, 0);
    assert.ok(Date.now() - t0 < 1000);
  });

  it("lupina: zaganjalnik je v extraResources v korenu OpenLine (deb in NSIS imata isti seznam)", () => {
    const viri = (JSON.parse(beri("lupina/package.json")) as { build: { extraResources: { from: string; to: string }[] } }).build.extraResources;
    const vnos = viri.find((v) => v.to === `lina/openline/${IME_ZAGANJALNIKA}`);
    assert.ok(vnos, "zaganjalnik manjka v extraResources");
    assert.ok(existsSync(path.resolve(KOREN, "lupina", vnos.from)), "vir zaganjalnika ne obstaja");
  });

  it("CI: deb in NSIS preverita zaganjalnik in OpenLine iz paketa zazeneta s preverbo; ime v preverbi je isto kot v kodi", () => {
    const deb = beri(".github/workflows/racunalnik.yml");
    assert.match(deb, /grep -q 'resources\/lina\/openline\/openline-start\.mjs\$' vsebina-deb\.txt/);
    assert.match(deb, /scripts\/preverba-openline-paketa\.mjs" "\$X\/opt\/Lina\/resources\/lina"/);
    const win = beri(".github/workflows/windows.yml");
    assert.match(win, /test -f "\$R\/openline\/openline-start\.mjs"/);
    assert.match(win, /Lina\.exe scripts\/preverba-openline-paketa\.mjs/);
    assert.match(beri("scripts/preverba-openline-paketa.mjs"), new RegExp(`const IME_ZAGANJALNIKA = "${IME_ZAGANJALNIKA.replace(".", "\\.")}";`));
  });

  it("preverba paketa: brez zaganjalnika pade (izhod 1), z njim OpenLine javi pripravljenost in se ustavi (izhod 0)", () => {
    const tek = (viri: string) => spawnSync(process.execPath, [PREVERBA, viri], { encoding: "utf8", timeout: 40_000, env: { PATH: process.env.PATH ?? "" } });
    const rdece = tek(paket(false));
    assert.equal(rdece.status, 1, rdece.stderr);
    assert.match(rdece.stderr, /v paketu ni zaganjalnika/);
    const zeleno = tek(paket(true));
    assert.equal(zeleno.status, 0, zeleno.stderr);
    assert.match(zeleno.stdout, /^OK: zaganjalnik openline-start\.mjs je v paketu/);
  });
});

describe("naloga 16: druge datoteke ob paketu (Python skripte, podatki)", () => {
  it("koren namestitve iz vstopne datoteke streznika (<koren>/.output/server/index.mjs), datoteka iz paketa pred razvojno potjo", () => {
    const viri = mkdtempSync(path.join(tmpdir(), "lina-n16-viri-"));
    const vstop = path.join(viri, ".output", "server", "index.mjs");
    assert.equal(korenNamestitve(vstop), viri);
    assert.equal(korenNamestitve(path.join(viri, "node_modules", "vite", "bin", "vite.js")), null);
    assert.equal(korenNamestitve(undefined), korenNamestitve(process.argv[1]));
    mkdirSync(path.join(viri, "podatki"));
    writeFileSync(path.join(viri, "kontrola_tiska.py"), "");
    writeFileSync(path.join(viri, "podatki", "learn-anything-teme.json"), "[]");
    assert.equal(datotekaPaketa("kontrola_tiska.py", "/razvoj/k.py", vstop), path.join(viri, "kontrola_tiska.py"));
    assert.equal(datotekaPaketa(path.join("podatki", "learn-anything-teme.json"), "/razvoj/t.json", vstop), path.join(viri, "podatki", "learn-anything-teme.json"));
    assert.equal(datotekaPaketa("rsdo-streznik.py", "/razvoj/r.py", vstop), "/razvoj/r.py", "ni v paketu -> razvojna pot");
  });

  it("paket ima vse, kar koda bere ob sebi; brez trde poti /opt/Lina (Windows) v rsdo in kontroli tiska", () => {
    const viri = (JSON.parse(beri("lupina/package.json")) as { build: { extraResources: { from: string; to: string }[] } }).build.extraResources;
    for (const [od, cilj] of [["../scripts/rsdo-streznik.py", "lina/rsdo-streznik.py"], ["../scripts/kontrola_tiska.py", "lina/kontrola_tiska.py"], ["../src/lib/lina/podatki", "lina/podatki"]]) {
      assert.ok(viri.some((v) => v.from === od && v.to === cilj), `${od} -> ${cilj} manjka v extraResources`);
    }
    for (const f of ["src/lib/lina/rsdo-streznik.server.ts", "src/lib/lina/kontrola-tiska.server.ts", "src/lib/lina/samoucenje-teme.ts"]) {
      assert.doesNotMatch(beri(f), /"\/opt\/Lina\/resources/, f);
      assert.match(beri(f), /datotekaPaketa\(/, f);
    }
    const deb = beri(".github/workflows/racunalnik.yml");
    const win = beri(".github/workflows/windows.yml");
    for (const ime of ["kontrola_tiska.py", "podatki/learn-anything-teme.json", "podatki/LEARN-ANYTHING-MIT.txt"]) {
      assert.ok(deb.includes(`grep -q 'resources/lina/${ime}$' vsebina-deb.txt`), `deb: ${ime}`);
      assert.ok(win.includes(`test -f "$R/${ime}"`), `win: ${ime}`);
    }
  });
});
