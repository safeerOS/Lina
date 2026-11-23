import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Lastnik 22. 11. 2026 (fotografija Mozgani): gumb »Zamenjaj racun« se v temni temi ni videl - belo besedilo na --color-ink,
// ki je v temi Lina 2.0 svetel. Pravilo: belo besedilo (text-white) samo na temnih *-fill barvah (ink-fill, signal-fill).
const koren = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../components");

function datoteke(mapa: string): string[] {
  return readdirSync(mapa).flatMap((ime) => {
    const pot = path.join(mapa, ime);
    if (statSync(pot).isDirectory()) return datoteke(pot);
    return /\.tsx$/.test(ime) && !/\.test\./.test(ime) ? [pot] : [];
  });
}

export function krsiteljiBarv(viri: Record<string, string>): string[] {
  return Object.entries(viri)
    .filter(([, s]) => /\btext-white\b/.test(s) && /bg-\[var\(--color-(ink|signal)\)\]/.test(s))
    .map(([ime]) => ime);
}

test("belo besedilo nikoli na svetlem --color-ink ali --color-signal (temna tema)", () => {
  const viri = Object.fromEntries(datoteke(koren).map((p) => [path.relative(koren, p), readFileSync(p, "utf8")]));
  assert.ok(Object.keys(viri).length > 10);
  assert.deepEqual(krsiteljiBarv(viri), []);
});

test("preverba ujame staro napako GooglePrijava", () => {
  const staro = 'const gumb = "rounded-full text-white"; <button className={`${gumb} bg-[var(--color-ink)]`} />';
  assert.deepEqual(krsiteljiBarv({ "google-prijava.tsx": staro }), ["google-prijava.tsx"]);
  assert.deepEqual(krsiteljiBarv({ "x.tsx": 'className="bg-[var(--color-ink-fill)] text-white"' }), []);
});
