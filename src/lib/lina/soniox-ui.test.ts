import { test } from "node:test";
import assert from "node:assert";
import { jeVeljavenKljucSoniox, stanjeBesedilo } from "./soniox-ui.ts";

test("jeVeljavenKljucSoniox meje in znaki", () => {
    assert.strictEqual(jeVeljavenKljucSoniox("1234567"), false, "Prekratek (7)");
    assert.strictEqual(jeVeljavenKljucSoniox("12345678"), true, "Meja (8)");
    assert.strictEqual(jeVeljavenKljucSoniox("a".repeat(200)), true, "Meja (200)");
    assert.strictEqual(jeVeljavenKljucSoniox("a".repeat(201)), false, "Predolg (201)");
    assert.strictEqual(jeVeljavenKljucSoniox("abc defg"), false, "Presledek");
    assert.strictEqual(jeVeljavenKljucSoniox("abcdefg\n"), false, "Nadzorni znak");
    assert.strictEqual(jeVeljavenKljucSoniox(""), false, "Prazno");
});

test("stanjeBesedilo vsa stiri stanja", () => {
    assert.strictEqual(stanjeBesedilo(null), "sonioxStanjeNalaga");
    assert.strictEqual(stanjeBesedilo({ vklop: false, kljucShranjen: false }), "sonioxStanjeIzklopljen");
    assert.strictEqual(stanjeBesedilo({ vklop: false, kljucShranjen: true }), "sonioxStanjeIzklopljen");
    assert.strictEqual(stanjeBesedilo({ vklop: true, kljucShranjen: false }), "sonioxStanjeBrezKljuca");
    assert.strictEqual(stanjeBesedilo({ vklop: true, kljucShranjen: true }), "sonioxStanjeAktiven");
});