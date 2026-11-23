import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("pravila o uvozih", () => {
  const file = fs.readFileSync(path.join(import.meta.dirname, "kljuci-sinhron.ts"), "utf-8");
  
  assert.equal(file.includes("console."), false, "ne sme vsebovati console");
  assert.equal(file.includes("process.env"), false, "ne sme vsebovati process.env");
  assert.equal(file.includes("Math.random"), false, "ne sme vsebovati Math.random");
  assert.equal(file.includes("Date.now"), false, "ne sme vsebovati Date.now");
  
  const imports = file.match(/import\s+.*?from\s+["'](.*?)["']/g) || [];
  for (const imp of imports) {
    if (imp.includes("node:test") || imp.includes("node:assert")) continue;
    assert.equal(imp.includes("node:crypto"), true, "dovoljen je samo node:crypto");
    assert.equal(imp.includes("./"), false, "prepovedani lokalni uvozi");
  }
});
