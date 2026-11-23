/**
 * Preizkusi ciste enote protokola Soniox (soniox-prepis.ts): zacetno sporocilo, nabiranje zakljucenih
 * in nadomescanje nezakljucenih zetonov, zdruzevanje podbesed, zeton <end>, razvrscanje napak in
 * odpornost na nepricakovane oblike odgovorov. Brez omrezja in brez uvozov streznika.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  jePonovljivaNapaka,
  novoStanje,
  obdelajOdgovor,
  sonioxZacetnoSporocilo,
} from "./soniox-prepis.ts";

describe("sonioxZacetnoSporocilo", () => {
  it("vrne tocno zahtevana polja za privzeti jezik sl in nobenih osebnih ali zastarelih polj", () => {
    const sporocilo = sonioxZacetnoSporocilo();
    assert.deepEqual(Object.keys(sporocilo).sort(), [
      "audio_format",
      "enable_endpoint_detection",
      "language_hints",
      "model",
      "num_channels",
      "sample_rate",
    ]);
    assert.deepEqual(sporocilo, {
      model: "stt-rt-v6",
      audio_format: "pcm_s16le",
      sample_rate: 16000,
      num_channels: 1,
      language_hints: ["sl"],
      enable_endpoint_detection: true,
    });
    const kotZapis: Record<string, unknown> = { ...sporocilo };
    assert.equal("api_key" in kotZapis, false);
    assert.equal("context" in kotZapis, false);
    assert.equal("client_reference_id" in kotZapis, false);
    assert.equal("enable_speaker_diarization" in kotZapis, false);
  });

  it("sprejme veljavno dvocrkovno kodo jezika in zavrne neveljavne kode", () => {
    assert.deepEqual(sonioxZacetnoSporocilo({ jezik: "en" }).language_hints, ["en"]);
    assert.deepEqual(sonioxZacetnoSporocilo({ jezik: "DE" }).language_hints, ["de"]);

    for (const napacen of ["", "s", "slv", "sl-SI", "12", "s1", " sl", "sl "]) {
      assert.throws(() => sonioxZacetnoSporocilo({ jezik: napacen }), `pričakovana napaka za "${napacen}"`);
    }
  });
});

describe("obdelajOdgovor: zetoni, podbesede, <end> in finished", () => {
  it("nabira zakljucene zetone brez podvajanja in vsakic nadomesti nezakljucene", () => {
    const stanje = novoStanje();

    const r1 = obdelajOdgovor(stanje, {
      tokens: [
        { text: "Dober", is_final: true, confidence: 0.99 },
        { text: " da", is_final: false, confidence: 0.7 },
      ],
      final_audio_proc_ms: 400,
      total_audio_proc_ms: 600,
    });
    assert.deepEqual(r1, { zakljuceno: "Dober", nezakljuceno: " da", konec: false });

    const r2 = obdelajOdgovor(stanje, {
      tokens: [
        { text: " dan", is_final: true, confidence: 0.98 },
        { text: " želim", is_final: false, confidence: 0.8 },
      ],
      final_audio_proc_ms: 900,
      total_audio_proc_ms: 1200,
    });
    assert.deepEqual(r2, { zakljuceno: "Dober dan", nezakljuceno: " želim", konec: false });

    // Naslednji odgovor popravi nezakljuceni del brez novih zakljucenih zetonov: zakljuceno se ne podvoji.
    const r3 = obdelajOdgovor(stanje, {
      tokens: [{ text: ", kako ste", is_final: false, confidence: 0.85 }],
      final_audio_proc_ms: 900,
      total_audio_proc_ms: 1500,
    });
    assert.deepEqual(r3, { zakljuceno: "Dober dan", nezakljuceno: ", kako ste", konec: false });

    // Zakljucek brez nezakljucenih zetonov pocisti nezakljuceno.
    const r4 = obdelajOdgovor(stanje, {
      tokens: [{ text: ", kako ste?", is_final: true, confidence: 0.97 }],
      final_audio_proc_ms: 1600,
      total_audio_proc_ms: 1600,
      finished: true,
    });
    assert.deepEqual(r4, { zakljuceno: "Dober dan, kako ste?", nezakljuceno: "", konec: true });
  });

  it("stakne podbesede dobesedno brez dodatnih presledkov", () => {
    const stanje = novoStanje();
    const r = obdelajOdgovor(stanje, {
      tokens: [
        { text: "To", is_final: true, confidence: 0.95 },
        { text: "plot", is_final: true, confidence: 0.96 },
        { text: "na", is_final: true, confidence: 0.97 },
        { text: " čr", is_final: true, confidence: 0.92 },
        { text: "pal", is_final: false, confidence: 0.88 },
        { text: "ka", is_final: false, confidence: 0.89 },
      ],
    });
    assert.equal(r.zakljuceno, "Toplotna čr");
    assert.equal(r.nezakljuceno, "palka");
  });

  it("izloci poseben zeton konca izreka <end> iz zakljucenega in nezakljucenega besedila", () => {
    const stanje = novoStanje();
    const r1 = obdelajOdgovor(stanje, {
      tokens: [
        { text: "Prosim", is_final: true, confidence: 0.99 },
        { text: " za", is_final: true, confidence: 0.99 },
        { text: " klic.", is_final: true, confidence: 0.99 },
        { text: "<end>", is_final: true, confidence: 1.0 },
      ],
    });
    assert.equal(r1.zakljuceno, "Prosim za klic.");
    assert.equal(r1.nezakljuceno, "");
    assert.equal(r1.zakljuceno.includes("<end>"), false);

    const r2 = obdelajOdgovor(stanje, {
      tokens: [
        { text: " Hvala.", is_final: true, confidence: 0.98 },
        { text: "<end>", is_final: false, confidence: 1.0 },
      ],
    });
    assert.equal(r2.zakljuceno, "Prosim za klic. Hvala.");
    assert.equal(r2.nezakljuceno, "");
  });
});

describe("jePonovljivaNapaka in obdelava napak", () => {
  const PONOVLJIVE = [
    "service_unavailable",
    "internal_error",
    "request_timeout",
    "max_duration_reached",
  ];

  const NEPONOVLJIVE = [
    "unauthenticated",
    "permission_denied",
    "organization_balance_exhausted",
    "organization_monthly_budget_exhausted",
    "project_monthly_budget_exhausted",
    "invalid_request",
    "model_not_available",
    "limit_exceeded",
    "max_concurrent_connections_reached",
    "temp_api_key_session_expired",
  ];

  it("tocno razvrsti vse ponovljive, neponovljive in neznane tipe napak", () => {
    for (const tip of PONOVLJIVE) {
      assert.equal(jePonovljivaNapaka(tip), true, `${tip} mora biti ponovljiva`);
    }
    for (const tip of NEPONOVLJIVE) {
      assert.equal(jePonovljivaNapaka(tip), false, `${tip} ne sme biti ponovljiva`);
    }
    assert.equal(jePonovljivaNapaka("neznana_napaka"), false);
    assert.equal(jePonovljivaNapaka(""), false);
  });

  it("ravna po error_type in ne po error_message", () => {
    const stanje = novoStanje();
    const r1 = obdelajOdgovor(stanje, {
      tokens: [],
      error_code: 503,
      error_type: "service_unavailable",
      error_message: "unauthenticated invalid_request",
      request_id: "req-1",
    });
    assert.deepEqual(r1.napaka, { tip: "service_unavailable", ponovljivo: true });
    assert.equal(r1.konec, false);

    const r2 = obdelajOdgovor(stanje, {
      tokens: [],
      error_code: 401,
      error_type: "unauthenticated",
      error_message: "service_unavailable try again later",
      request_id: "req-2",
    });
    assert.deepEqual(r2.napaka, { tip: "unauthenticated", ponovljivo: false });
    assert.equal(r2.konec, false);
  });
});

describe("odpornost na nepricakovane oblike odgovora", () => {
  it("nikoli ne vrze in za neznano obliko vrne prazen rezultat ter ne pokvari stanja", () => {
    const stanje = novoStanje();
    const neveljavni: unknown[] = [
      null,
      undefined,
      0,
      42,
      "niz",
      true,
      [],
      {},
      { neznano: 123 },
      { tokens: "ni-seznam" },
      { tokens: 123 },
    ];
    for (const vhod of neveljavni) {
      const r = obdelajOdgovor(stanje, vhod);
      assert.deepEqual(r, { zakljuceno: "", nezakljuceno: "", konec: false });
    }

    // Po veljavnem odgovoru neznan odgovor ne izbrise nakopicenega stanja.
    obdelajOdgovor(stanje, { tokens: [{ text: "Zdravo", is_final: true }] });
    const neznan = obdelajOdgovor(stanje, { nakljucno: "polje" });
    assert.deepEqual(neznan, { zakljuceno: "", nezakljuceno: "", konec: false });

    const naslednji = obdelajOdgovor(stanje, {
      tokens: [
        null,
        123,
        { text: 456, is_final: true },
        { text: "!", is_final: true },
      ],
    });
    assert.equal(naslednji.zakljuceno, "Zdravo!");
    assert.equal(naslednji.nezakljuceno, "");
  });
});
