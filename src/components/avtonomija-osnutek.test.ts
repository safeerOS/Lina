import assert from "node:assert/strict";
import test from "node:test";
import { zdruziOsnutke } from "./avtonomija-osnutek.ts";

type O = { nacin: string; najvecNaDan: string };
const s = (n: string, m = "5"): O => ({ nacin: n, najvecNaDan: m });

test("N11: umazan osnutek ostane, ostali se osvezijo s streznika", () => {
  const prej = { klic: s("vklopljeno", "9"), sms: s("izklopljeno") };
  const streznik = { klic: s("izklopljeno"), sms: s("vklopljeno", "3") };
  const izid = zdruziOsnutke(prej, streznik, new Set(["klic"]));
  assert.deepEqual(izid.klic, prej.klic);
  assert.deepEqual(izid.sms, streznik.sms);
});

test("brez umazanih osnutkov je izid enak streznikovemu stanju", () => {
  const streznik = { klic: s("izklopljeno") };
  assert.deepEqual(zdruziOsnutke({ klic: s("vklopljeno") }, streznik, new Set()), streznik);
});

test("umazan kljuc brez lokalnega osnutka vzame streznikov; opravilo, ki ga streznik ne pozna, odpade", () => {
  const izid = zdruziOsnutke({ staro: s("vklopljeno") }, { novo: s("izklopljeno") }, new Set(["novo", "staro"]));
  assert.deepEqual(Object.keys(izid), ["novo"]);
  assert.deepEqual(izid.novo, s("izklopljeno"));
});

test("kljuc »ura« med opravili ne vpliva na izid; vhoda se ne spremenita", () => {
  const prej = { klic: s("vklopljeno") };
  const streznik = { klic: s("izklopljeno") };
  const kopijaPrej = structuredClone(prej);
  const kopijaStreznik = structuredClone(streznik);
  const izid = zdruziOsnutke(prej, streznik, new Set(["ura"]));
  assert.deepEqual(izid, streznik);
  assert.notEqual(izid, streznik);
  assert.deepEqual(prej, kopijaPrej);
  assert.deepEqual(streznik, kopijaStreznik);
});

test("kljuc »__proto__« ne onesnazi prototipa", () => {
  const streznik = JSON.parse('{"__proto__": {"nacin": "x", "najvecNaDan": "1"}, "klic": {"nacin": "a", "najvecNaDan": "2"}}');
  const izid = zdruziOsnutke({}, streznik, new Set(["__proto__"]));
  assert.equal(({} as Record<string, unknown>).nacin, undefined);
  assert.equal(Object.getPrototypeOf(izid), Object.prototype);
});
