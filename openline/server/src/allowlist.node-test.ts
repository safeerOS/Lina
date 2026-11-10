import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAllowlisted, isEmergencyNumber, mayTakeOver, parseAllowlist, parseAllowlistMode } from "./allowlist.ts";

describe("seznam dovoljenih", () => {
  const list = ["+99955501999"];

  it("dovoli stevilko na seznamu", () => {
    assert.equal(isAllowlisted("+99955501999", list), true);
    assert.equal(isAllowlisted("055501999", list), true);
  });

  it("prazen seznam ne dovoli nobene", () => {
    assert.equal(isAllowlisted("+99955501999", []), false);
    assert.equal(isAllowlisted("+99955501999", parseAllowlist("  ")), false);
    assert.equal(isAllowlisted("+99955501999", parseAllowlist(undefined)), false);
  });

  it("stevilka, ki ni na seznamu, ni dovoljena", () => {
    assert.equal(isAllowlisted("+99955501000", list), false);
    assert.equal(isAllowlisted("", list), false);
    assert.equal(isAllowlisted(undefined, list), false);
  });

  it("112 ni dovoljen, tudi ce je zapisan na seznamu", () => {
    assert.equal(isEmergencyNumber("112"), true);
    assert.equal(isEmergencyNumber("0112"), true);
    assert.equal(isEmergencyNumber("+911111111111"), false);
    assert.equal(isAllowlisted("112", ["112", "+99955501999"]), false);
  });

  it("parseAllowlist razbije vejice in vrstice", () => {
    assert.deepEqual(parseAllowlist("+99955501999, +99955501888\n055501999"), [
      "+99955501999",
      "+99955501888",
      "055501999",
    ]);
  });

  it("skrita stevilka ob izklopljenem seznamu se prevzame, 112 nikoli", () => {
    assert.equal(parseAllowlistMode(undefined), "on");
    assert.equal(parseAllowlistMode("off"), "off");
    assert.equal(parseAllowlistMode("ON"), "on");
    assert.equal(mayTakeOver("", list, "off"), true);
    assert.equal(mayTakeOver("unknown", [], "off"), true);
    assert.equal(mayTakeOver("hidden", [], "off"), true);
    assert.equal(mayTakeOver("", [], "on"), false);
    assert.equal(mayTakeOver("unknown", list, "on"), false);
    assert.equal(mayTakeOver("112", list, "off"), false);
    assert.equal(mayTakeOver("112", ["112"], "off"), false);
    assert.equal(mayTakeOver("+99955501999", list, "on"), true);
  });
});