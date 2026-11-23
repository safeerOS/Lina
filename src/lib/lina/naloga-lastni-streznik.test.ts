/**
 * Preizkusi za lastni-streznik.ts (naloga #43, 21. 11. 2026): naslov, zahtevek, odgovor.
 * Odgovora »sklepalni model« sta POVZETA po resnicnem preizkusu freellmapi (vsebnik, 127.0.0.1:3191, 21. 11. 2026):
 *  1) model auto, max_tokens 60: finish_reason=length, content = reasoning (odrezan razmislek, NI odgovor);
 *  2) model auto:fast, max_tokens 500: finish_reason=stop, content »Nedelja.«.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  NAJMANJ_ZETONOV_LASTNI,
  NAJVEC_NASLOV,
  NAJVEC_ZETONOV_LASTNI,
  lastniOdgovor,
  lastniZahtevek,
  normirajNaslov,
} from "./lastni-streznik.ts";

describe("normirajNaslov: dovoljeni naslovi", () => {
  const dovoljeni: Array<[string, string, boolean]> = [
    ["http://127.0.0.1:3001/v1", "http://127.0.0.1:3001/v1", true],
    ["http://localhost:3191", "http://localhost:3191/v1", true],
    ["  http://localhost:3191/v1/  ", "http://localhost:3191/v1", true],
    ["http://[::1]:3001/v1", "http://[::1]:3001/v1", true],
    ["http://192.168.1.20:1234/v1/", "http://192.168.1.20:1234/v1", true],
    ["http://10.0.0.5:11434", "http://10.0.0.5:11434/v1", true],
    ["http://172.16.0.1/v1", "http://172.16.0.1/v1", true],
    ["http://172.31.255.254/v1", "http://172.31.255.254/v1", true],
    ["https://example.org/openai/v1/chat/completions", "https://example.org/openai/v1", false],
    ["https://example.org", "https://example.org/v1", false],
    ["HTTP://LocalHost:3001/V1", "http://localhost:3001/V1", true],
    // URL razclenjevalnik prevede stevilcne zapise v 127.0.0.1: preverimo normirani gostitelj.
    ["http://2130706433/v1", "http://127.0.0.1/v1", true],
    ["http://0177.0.0.1:3001/v1", "http://127.0.0.1:3001/v1", true],
  ];
  for (const [vhod, pricakovan, lokalen] of dovoljeni) {
    test(`sprejme ${vhod}`, () => {
      const izid = normirajNaslov(vhod);
      assert.equal(izid.ok, true, JSON.stringify(izid));
      if (izid.ok) {
        assert.equal(izid.naslov, pricakovan);
        assert.equal(izid.lokalen, lokalen);
      }
    });
  }
});

describe("normirajNaslov: zavrnjeni naslovi", () => {
  const zavrnjeni: Array<[unknown, RegExp]> = [
    ["", /Vpišite naslov/],
    ["   ", /Vpišite naslov/],
    [undefined, /Vpišite naslov/],
    [123, /Vpišite naslov/],
    ["ni naslov", /ni veljaven/],
    ["ftp://127.0.0.1/v1", /http:\/\/ ali https:\/\//],
    ["file:///etc/passwd", /http:\/\/ ali https:\/\//],
    ["http://example.org/v1", /Nešifriran http/],
    ["http://8.8.8.8/v1", /Nešifriran http/],
    ["http://172.32.0.1/v1", /Nešifriran http/],
    ["http://172.15.255.1/v1", /Nešifriran http/],
    ["http://192.169.1.1/v1", /Nešifriran http/],
    ["http://127.0.0.1.evil.com/v1", /Nešifriran http/],
    ["http://localhost.evil.com/v1", /Nešifriran http/],
    ["http://evillocalhost:3001/v1", /Nešifriran http/],
    ["http://moj.localhost/v1", /Nešifriran http/],
    ["http://[fd00::1]/v1", /Nešifriran http/],
    ["http://169.254.169.254/latest", /ni dovoljen/],
    ["https://169.254.169.254/v1", /ni dovoljen/],
    ["http://0.0.0.0:3001/v1", /ni dovoljen/],
    ["https://240.0.0.1/v1", /ni dovoljen/],
    ["https://uporabnik:geslo@example.org/v1", /uporabniškega imena/],
    ["http://192.168.1.1@evil.com/v1", /uporabniškega imena/],
    ["https://example.org/v1?kljuc=1", /poizvedbe/],
    ["https://example.org/v1#a", /poizvedbe/],
    [`https://example.org/${"a".repeat(NAJVEC_NASLOV)}`, /predolg/],
  ];
  for (const [vhod, vzorec] of zavrnjeni) {
    test(`zavrne ${String(vhod).slice(0, 50) || "(prazno)"}`, () => {
      const izid = normirajNaslov(vhod);
      assert.equal(izid.ok, false);
      if (!izid.ok) assert.match(izid.razlog, vzorec);
    });
  }
});

describe("lastniZahtevek", () => {
  const osnova = { naslov: "http://127.0.0.1:3191/v1", model: "auto", key: "freellmapi-testni-kljuc-123", text: "Pozdravljena" };

  test("naslov, glave in telo", () => {
    const { url, init } = lastniZahtevek({ ...osnova, system: "Si Lina.", maxTokens: 400 });
    assert.equal(url, "http://127.0.0.1:3191/v1/chat/completions");
    assert.equal(init.method, "POST");
    const glave = init.headers as Record<string, string>;
    assert.equal(glave["content-type"], "application/json");
    assert.equal(glave.authorization, "Bearer freellmapi-testni-kljuc-123");
    const telo = JSON.parse(String(init.body));
    assert.equal(telo.model, "auto");
    assert.deepEqual(telo.messages, [
      { role: "system", content: "Si Lina." },
      { role: "user", content: "Pozdravljena" },
    ]);
    assert.equal(url.includes(osnova.key), false);
  });

  test("brez kljuca ni glave Authorization", () => {
    const { init } = lastniZahtevek({ ...osnova, key: "" });
    assert.equal("authorization" in (init.headers as Record<string, string>), false);
  });

  test("meja zetonov: najmanj 1024 (sklepalni modeli), najvec 4096", () => {
    const meja = (maxTokens?: number) =>
      JSON.parse(String(lastniZahtevek({ ...osnova, ...(maxTokens === undefined ? {} : { maxTokens }) }).init.body)).max_tokens;
    assert.equal(NAJMANJ_ZETONOV_LASTNI, 1024);
    assert.equal(NAJVEC_ZETONOV_LASTNI, 4096);
    assert.equal(meja(undefined), 1024);
    assert.equal(meja(8), 1024);
    assert.equal(meja(1500), 1500);
    assert.equal(meja(99999), 4096);
    assert.equal(meja(Number.NaN), 1024);
  });

  test("besedilo se skrajsa na 4000 znakov", () => {
    const telo = JSON.parse(String(lastniZahtevek({ ...osnova, text: "x".repeat(5000) }).init.body));
    assert.equal(telo.messages[0].content.length, 4000);
  });

  test("neveljaven naslov in kljuc v naslovu vrneta napako", () => {
    assert.throws(() => lastniZahtevek({ ...osnova, naslov: "http://example.org/v1" }), /Nešifriran http/);
    assert.throws(
      () => lastniZahtevek({ ...osnova, naslov: "https://example.org/freellmapi-testni-kljuc-123", key: "freellmapi-testni-kljuc-123" }),
      /Ključ ne sme biti v naslovu/,
    );
  });
});

describe("lastniOdgovor", () => {
  const telo = (choice: unknown) => JSON.stringify({ choices: [choice] });

  test("obicajen odgovor", () => {
    const izid = lastniOdgovor(telo({ message: { role: "assistant", content: "  Nedelja.  " }, finish_reason: "stop" }));
    assert.deepEqual(izid, { ok: true, text: "Nedelja." });
  });

  test("resnicen primer 2: sklepanje + odgovor, finish_reason=stop", () => {
    const izid = lastniOdgovor(
      telo({ message: { content: "Nedelja.", reasoning: "Uporabnik vprasa, kateri dan je po soboti. To je nedelja." }, finish_reason: "stop" }),
    );
    assert.deepEqual(izid, { ok: true, text: "Nedelja." });
  });

  test("resnicen primer 1: odrezan razmislek (content = reasoning, length) NI odgovor", () => {
    const razmislek = 'We need to answer with only one Slovenian word: "kateri dan je po soboto?" ... But let\'s confirm';
    const izid = lastniOdgovor(telo({ message: { content: razmislek, reasoning: razmislek }, finish_reason: "length" }));
    assert.equal(izid.ok, false);
    if (!izid.ok) assert.match(izid.sporocilo, /porabil za razmišljanje/);
  });

  test("razlika v presledkih med content in reasoning ne pomaga odrezanemu razmisleku", () => {
    const izid = lastniOdgovor(telo({ message: { content: "a  b\n c", reasoning: "a b c" }, finish_reason: "length" }));
    assert.equal(izid.ok, false);
  });

  test("length z ALI prazno vsebino je napaka, polje reasoning_content enako", () => {
    for (const sporocilo of [
      { content: "", reasoning: "razmislek" },
      { content: null, reasoning_content: "razmislek" },
      { content: "   " },
    ]) {
      const izid = lastniOdgovor(telo({ message: sporocilo, finish_reason: "length" }));
      assert.equal(izid.ok, false, JSON.stringify(sporocilo));
    }
  });

  test("length z pravo (odrezano) vsebino, drugacno od razmisleka, je sprejeta", () => {
    const izid = lastniOdgovor(telo({ message: { content: "Zacetek odgovora, ki je", reasoning: "drug razmislek" }, finish_reason: "length" }));
    assert.deepEqual(izid, { ok: true, text: "Zacetek odgovora, ki je" });
  });

  test("bloki <think> se odstranijo, neprekinjen <think> odreze konec", () => {
    assert.deepEqual(lastniOdgovor(telo({ message: { content: "<think>razmisljam\nveckrat</think>\nDober dan." }, finish_reason: "stop" })), {
      ok: true,
      text: "Dober dan.",
    });
    assert.deepEqual(lastniOdgovor(telo({ message: { content: "Dober dan. <think>se razmisljam" }, finish_reason: "stop" })), {
      ok: true,
      text: "Dober dan.",
    });
    const samoRazmislek = lastniOdgovor(telo({ message: { content: "<think>samo razmislek" }, finish_reason: "stop" }));
    assert.equal(samoRazmislek.ok, false);
  });

  test("vsebina kot seznam delov", () => {
    const izid = lastniOdgovor(telo({ message: { content: [{ type: "text", text: "Dober " }, { type: "text", text: "dan." }, { type: "x" }] }, finish_reason: "stop" }));
    assert.deepEqual(izid, { ok: true, text: "Dober dan." });
  });

  test("napaka streznika se vrne skrajsana", () => {
    const izid = lastniOdgovor(JSON.stringify({ error: { message: `Ni modela. ${"x".repeat(400)}`, type: "invalid_request_error" } }));
    assert.equal(izid.ok, false);
    if (!izid.ok) {
      assert.match(izid.sporocilo, /^Strežnik: Ni modela\./);
      assert.ok(izid.sporocilo.length <= "Strežnik: ".length + 200);
    }
  });

  test("neveljaven JSON, prazna vsebina, brez izbir", () => {
    for (const vhod of ["", "<html>", "null", "[]", JSON.stringify({}), JSON.stringify({ choices: [] }), telo({ message: {}, finish_reason: "stop" })]) {
      const izid = lastniOdgovor(vhod);
      assert.equal(izid.ok, false, vhod);
    }
  });
});
