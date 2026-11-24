/**
 * M6, M7 (pregled-vecer-1405/mozgani/NAJDBE.md): orodji za preverbo paketa.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SKRIPTE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../scripts");
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-preverba-paketa-"));
after(() => {
  spawnSync("chmod", ["-R", "u+w", KOREN]);
  rmSync(KOREN, { recursive: true, force: true });
});

function pdf(besedilo: string): { koda: number | null; err: string; vsebina: string } {
  const izhod = path.join(KOREN, `v-${Math.random().toString(36).slice(2)}.pdf`);
  const r = spawnSync("python3", ["-I", path.join(SKRIPTE, "preverba-paketa-pdf.py"), izhod, besedilo], { encoding: "utf8" });
  let vsebina = "";
  try {
    vsebina = readFileSync(izhod, "latin1");
  } catch {
    /* ni datoteke */
  }
  return { koda: r.status, err: r.stderr, vsebina };
}

describe("M6: preverba-paketa-pdf.py", () => {
  it("oklepaji in poševnica so ubežani (veljaven operator Tj)", () => {
    const r = pdf("a) b (c) \\d");
    assert.equal(r.koda, 0, r.err);
    assert.ok(r.vsebina.includes("(a\\) b \\(c\\) \\\\d) Tj"), r.vsebina);
  });

  it("sumniki: jasna zavrnitev (izhod 2, brez sledi sklada, brez datoteke)", () => {
    const r = pdf("Pozdrav Čas");
    assert.equal(r.koda, 2);
    assert.doesNotMatch(r.err, /Traceback/);
    assert.match(r.err, /ASCII/);
    assert.equal(r.vsebina, "");
  });
});

describe("M7: preverba-paketa.mjs ne pise v paket", () => {
  it("deluje na paketu samo za branje in ne pusti datotek v svezenju", () => {
    const koren = path.join(KOREN, "lina");
    const ssr = path.join(koren, ".output/server/_ssr");
    mkdirSync(ssr, { recursive: true });
    for (const ime of ["unpdf", "jazz-tools", "cojson", "cojson-transport-ws", "lazni-modul"]) {
      const m = path.join(koren, ".output/server/node_modules", ime);
      mkdirSync(m, { recursive: true });
      writeFileSync(path.join(m, "package.json"), JSON.stringify({ name: ime, type: "module", exports: "./index.js" }));
      writeFileSync(path.join(m, "index.js"), "export const x = 1;\n");
    }
    writeFileSync(path.join(ssr, "pomoc.mjs"), "export const PREDPONA = 'Pozdrav';\n");
    writeFileSync(
      path.join(ssr, "kos.mjs"),
      [
        "import { PREDPONA } from './pomoc.mjs';",
        "const uvozi = (n) => import(n);",
        "void import.meta.resolve('lazni-modul');",
        "async function izvleciBesedilo(ime, bajti) { return { besedilo: PREDPONA + ' Lina ' + bajti.length }; }",
        "export { uvozi };",
        "",
      ].join("\n"),
    );
    const vzorec = path.join(KOREN, "vzorec.pdf");
    writeFileSync(vzorec, "%PDF-1.4\n");
    spawnSync("chmod", ["-R", "a-w", koren]);
    const r = spawnSync(process.execPath, [path.join(SKRIPTE, "preverba-paketa.mjs"), koren, vzorec, "Pozdrav Lina"], { encoding: "utf8" });
    spawnSync("chmod", ["-R", "u+w", koren]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /OK modul lazni-modul/);
    assert.match(r.stdout, /PREVERBA PAKETA: OK/);
    assert.deepEqual(readdirSync(ssr).sort(), ["kos.mjs", "pomoc.mjs"]);
  });
});
