import assert from "node:assert/strict";
import { test } from "node:test";
import { veljavenNaslovPrehoda } from "./omniroute.ts";

// Napaka 21. 11. 2026: omniroute.ts je uporabljal ZASEBNI_IPV4, a ga ni definiral (rekonstrukcija iz prevoda),
// zato je vsak http naslov prehoda koncal z »ZASEBNI_IPV4 is not defined«.
test("http je dovoljen za zanko in zasebno domace omrezje", () => {
  for (const naslov of ["http://127.0.0.1:20128", "http://localhost:20128", "http://192.168.1.10:20128", "http://10.0.0.5", "http://172.20.1.1:8080", "http://[::1]:20128"]) {
    assert.ok(veljavenNaslovPrehoda(naslov), naslov);
  }
});

test("http ni dovoljen za javne naslove in imena, ki le zacnejo kot zasebni naslov", () => {
  for (const naslov of ["http://8.8.8.8", "http://172.32.0.1", "http://10.evil.example.com", "http://127.evil.com", "http://192.168.evil.org", "http://example.com"]) {
    assert.equal(veljavenNaslovPrehoda(naslov), null, naslov);
  }
});

test("https je dovoljen, geslo in iskalni niz v naslovu pa ne", () => {
  assert.ok(veljavenNaslovPrehoda("https://prehod.example.com/v1"));
  assert.equal(veljavenNaslovPrehoda("https://uporabnik:geslo@prehod.example.com"), null);
  assert.equal(veljavenNaslovPrehoda("https://prehod.example.com/?kljuc=1"), null);
});
