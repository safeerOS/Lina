/**
 * Preizkusi F1 (Lina programerka): klic modela z orodji (Vertex/Gemini, OpenAI-zdruzljivi, Claude)
 * in belezenje porabe zetonov za callProvider ter callProviderZOrodji.
 * Nikjer pravega omrezja (samo lazen fetch), kljuci so izmisljeni.
 * Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { nastaviPridobitevZaPreizkus, pozabiZeton } from "./adc.server.ts";
import { pocistiPorabo, posnetekPorabe } from "./poraba-modelov.ts";
import {
  callProvider,
  callProviderZOrodji,
  NAJVEC_ZNAKOV_VHODA,
  type DefinicijaOrodja,
  type SporociloOrodja,
} from "./providers.ts";

const praviFetch = globalThis.fetch;

const ORODJA: DefinicijaOrodja[] = [
  {
    ime: "beri",
    opis: "Prebere datoteko v kopiji projekta.",
    parametri: {
      type: "object",
      properties: {
        pot: { type: "string", description: "Relativna pot datoteke." },
        od: { type: "integer" },
      },
      required: ["pot"],
      additionalProperties: false,
    },
  },
  {
    ime: "isci",
    opis: "Poisce vzorec v projektu.",
    parametri: {
      type: "object",
      properties: {
        vzorec: { type: "string" },
      },
      required: ["vzorec"],
    },
  },
];

type ZajetaZahteva = {
  url: string;
  metoda: string;
  glave: Record<string, string>;
  telo: Record<string, unknown>;
};

function lazniFetch(
  odgovori: Array<{ status?: number; telo: unknown }>,
  zajeto: ZajetaZahteva[],
): typeof fetch {
  let i = 0;
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const glaveObj: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      glaveObj[k.toLowerCase()] = v;
    });
    zajeto.push({
      url: String(url),
      metoda: init?.method ?? "GET",
      glave: glaveObj,
      telo: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    const trenutni = odgovori[Math.min(i, odgovori.length - 1)]!;
    i += 1;
    const status = trenutni.status ?? 200;
    const vsebina = typeof trenutni.telo === "string" ? trenutni.telo : JSON.stringify(trenutni.telo);
    return new Response(vsebina, { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

beforeEach(() => {
  pocistiPorabo();
  pozabiZeton();
  nastaviPridobitevZaPreizkus(null);
});

afterEach(() => {
  globalThis.fetch = praviFetch;
  nastaviPridobitevZaPreizkus(null);
  pozabiZeton();
  pocistiPorabo();
});

describe("F1: callProviderZOrodji — Vertex in Gemini", () => {
  it("Gemini: poslje functionDeclarations in večobratni functionCall/functionResponse ter vrne klic orodja in usage", async () => {
    const zajeto: ZajetaZahteva[] = [];
    globalThis.fetch = lazniFetch(
      [
        {
          telo: {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    { text: "Preberem datoteko." },
                    { functionCall: { name: "beri", args: { pot: "src/index.ts", od: 1 } } },
                  ],
                },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 240,
              candidatesTokenCount: 35,
              cachedContentTokenCount: 100,
              totalTokenCount: 275,
            },
          },
        },
      ],
      zajeto,
    );

    const sporocila: SporociloOrodja[] = [
      { vloga: "uporabnik", besedilo: "Popravi napako v index.ts." },
      {
        vloga: "asistent",
        besedilo: "Najprej poiscem.",
        klici: [
          { id: "g-1", ime: "isci", argumenti: { vzorec: "napaka" } },
          { id: "g-2", ime: "beri", argumenti: { pot: "README.md" } },
        ],
      },
      { vloga: "orodje", id: "g-1", ime: "isci", rezultat: "src/index.ts:12" },
      { vloga: "orodje", id: "g-2", ime: "beri", rezultat: { vrstice: 10 } },
    ];

    const r = await callProviderZOrodji(
      { provider: "gemini", model: "gemini-3.8-flash", key: "AIza-testni-kljuc-gemini" },
      sporocila,
      ORODJA,
      { system: "Si programerka.", maxTokens: 4000 },
    );

    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.besedilo, "Preberem datoteko.");
    assert.equal(r.razlogKonca, "orodje");
    assert.equal(r.klici.length, 1);
    assert.equal(r.klici[0]!.ime, "beri");
    assert.deepEqual(r.klici[0]!.argumenti, { pot: "src/index.ts", od: 1 });
    assert.ok(r.klici[0]!.id.length > 0);
    assert.deepEqual(r.usage, { vhod: 240, izhod: 35, predpomnjeni: 100 });

    assert.equal(zajeto.length, 1);
    assert.equal(zajeto[0]!.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    assert.equal(zajeto[0]!.glave["x-goog-api-key"], "AIza-testni-kljuc-gemini");
    assert.equal(zajeto[0]!.url.includes("AIza-testni-kljuc-gemini"), false);

    const telo = zajeto[0]!.telo as {
      systemInstruction?: { parts?: Array<{ text?: string }> };
      tools?: Array<{ functionDeclarations?: Array<{ name?: string }> }>;
      contents?: Array<{ role?: string; parts?: Array<Record<string, unknown>> }>;
      generationConfig?: { maxOutputTokens?: number };
    };
    assert.equal(telo.systemInstruction?.parts?.[0]?.text, "Si programerka.");
    assert.equal(telo.tools?.[0]?.functionDeclarations?.length, 2);
    assert.equal(telo.tools?.[0]?.functionDeclarations?.[0]?.name, "beri");
    assert.equal(telo.generationConfig?.maxOutputTokens, 4000);
    // Dva zaporedna rezultata orodij sta zdruzena v en obrat user z dvema functionResponse deloma.
    assert.equal(telo.contents?.length, 3);
    assert.equal(telo.contents?.[1]?.role, "model");
    assert.equal(telo.contents?.[2]?.role, "user");
    assert.equal(telo.contents?.[2]?.parts?.length, 2);
    assert.deepEqual(telo.contents?.[2]?.parts?.[0], {
      functionResponse: { name: "isci", response: { result: "src/index.ts:12" } },
    });
    assert.deepEqual(telo.contents?.[2]?.parts?.[1], {
      functionResponse: { name: "beri", response: { vrstice: 10 } },
    });
  });

  it("Vertex: odgovor brez klica orodja uporabi ADC zeton, projekt in vrne besedilo, prazen seznam klicev in usage", async () => {
    const zajeto: ZajetaZahteva[] = [];
    nastaviPridobitevZaPreizkus(async () => ({ token: "ya29.testni-vertex-zeton", pretece: Date.now() + 600_000 }));
    globalThis.fetch = lazniFetch(
      [
        {
          telo: {
            candidates: [
              {
                content: { role: "model", parts: [{ text: "Naloga je koncana." }] },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 110,
              candidatesTokenCount: 18,
            },
          },
        },
      ],
      zajeto,
    );

    const r = await callProviderZOrodji(
      { provider: "vertex", model: "gemini-3-flash-preview", key: "", project: "moj-projekt-12", location: "global" },
      [{ vloga: "uporabnik", besedilo: "Povej stanje." }],
      ORODJA,
    );

    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.besedilo, "Naloga je koncana.");
    assert.deepEqual(r.klici, []);
    assert.equal(r.razlogKonca, "konec");
    assert.deepEqual(r.usage, { vhod: 110, izhod: 18, predpomnjeni: 0 });
    assert.equal(zajeto[0]!.url, "https://aiplatform.googleapis.com/v1beta1/projects/moj-projekt-12/locations/global/publishers/google/models/gemini-3-flash-preview:generateContent");
    assert.equal(zajeto[0]!.glave.authorization, "Bearer ya29.testni-vertex-zeton");
    assert.equal(zajeto[0]!.glave["x-goog-user-project"], "moj-projekt-12");
  });

  it("Gemini: napacni argumenti functionCall (ne-objekt) ali MALFORMED_FUNCTION_CALL vrnejo napako brez izvedbe", async () => {
    const zajeto: ZajetaZahteva[] = [];
    globalThis.fetch = lazniFetch(
      [
        {
          telo: {
            candidates: [
              {
                content: { role: "model", parts: [{ functionCall: { name: "beri", args: "{pokvarjen json" } }] },
                finishReason: "STOP",
              },
            ],
          },
        },
        {
          telo: {
            candidates: [
              {
                content: { role: "model", parts: [{ functionCall: { name: "beri", args: ["ni", "objekt"] } }] },
                finishReason: "STOP",
              },
            ],
          },
        },
        {
          telo: {
            candidates: [{ content: { role: "model", parts: [] }, finishReason: "MALFORMED_FUNCTION_CALL" }],
          },
        },
      ],
      zajeto,
    );

    const ponudnik = { provider: "gemini" as const, model: "gemini-3.8-flash", key: "AIza-testni" };
    const r1 = await callProviderZOrodji(ponudnik, [{ vloga: "uporabnik", besedilo: "test" }], ORODJA);
    const r2 = await callProviderZOrodji(ponudnik, [{ vloga: "uporabnik", besedilo: "test" }], ORODJA);
    const r3 = await callProviderZOrodji(ponudnik, [{ vloga: "uporabnik", besedilo: "test" }], ORODJA);

    assert.equal(r1.ok, false);
    assert.equal(r2.ok, false);
    assert.equal(r3.ok, false);
  });
});

describe("F1: callProviderZOrodji — OpenAI-zdruzljivi (OpenRouter, OmniRoute, custom)", () => {
  it("OpenRouter: poslje tools, data_collection=deny, tool_calls + tool sporočila, vrne klic orodja in usage", async () => {
    const zajeto: ZajetaZahteva[] = [];
    globalThis.fetch = lazniFetch(
      [
        {
          telo: {
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_abc1",
                      type: "function",
                      function: { name: "beri", arguments: '{"pot":"src/app.ts","od":5}' },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: {
              prompt_tokens: 512,
              completion_tokens: 42,
              prompt_tokens_details: { cached_tokens: 256 },
            },
          },
        },
      ],
      zajeto,
    );

    const sporocila: SporociloOrodja[] = [
      { vloga: "uporabnik", besedilo: "Preveri app.ts" },
      {
        vloga: "asistent",
        klici: [{ id: "call_0", ime: "isci", argumenti: { vzorec: "export" } }],
      },
      { vloga: "orodje", id: "call_0", ime: "isci", rezultat: "src/app.ts:1" },
    ];

    const r = await callProviderZOrodji(
      { provider: "openrouter", model: "openai/gpt-4o", key: "sk-or-test-1234" },
      sporocila,
      ORODJA,
      { system: "Sistem." },
    );

    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.besedilo, "");
    assert.equal(r.razlogKonca, "orodje");
    assert.deepEqual(r.klici, [{ id: "call_abc1", ime: "beri", argumenti: { pot: "src/app.ts", od: 5 } }]);
    assert.deepEqual(r.usage, { vhod: 512, izhod: 42, predpomnjeni: 256 });

    assert.equal(zajeto[0]!.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(zajeto[0]!.glave["x-title"], "Lina");
    assert.deepEqual(zajeto[0]!.telo.provider, { data_collection: "deny" });
    const msgs = zajeto[0]!.telo.messages as Array<Record<string, unknown>>;
    assert.equal(msgs[0]!.role, "system");
    assert.equal(msgs[2]!.role, "assistant");
    assert.equal(msgs[3]!.role, "tool");
    assert.equal(msgs[3]!.tool_call_id, "call_0");
  });

  it("OmniRoute in custom: odgovor brez klica orodja deluje na lokalnem naslovu in prebere usage", async () => {
    const zajeto: ZajetaZahteva[] = [];
    globalThis.fetch = lazniFetch(
      [
        {
          telo: {
            choices: [{ message: { role: "assistant", content: "Vse je v redu." }, finish_reason: "stop" }],
            usage: { prompt_tokens: 80, completion_tokens: 12 },
          },
        },
        {
          telo: {
            choices: [{ message: { role: "assistant", content: "Lokalni odgovor." }, finish_reason: "stop" }],
            usage: { prompt_tokens: 60, completion_tokens: 9 },
          },
        },
      ],
      zajeto,
    );

    const rOmni = await callProviderZOrodji(
      { provider: "omniroute", model: "auto", key: "om-test-1", naslov: "http://127.0.0.1:20128/v1" },
      [{ vloga: "uporabnik", besedilo: "Pozdrav" }],
      ORODJA,
    );
    const rCustom = await callProviderZOrodji(
      { provider: "custom", model: "qwen3-coder", key: "", naslov: "http://127.0.0.1:11434/v1" },
      [{ vloga: "uporabnik", besedilo: "Pozdrav" }],
      ORODJA,
    );

    assert.equal(rOmni.ok, true);
    if (rOmni.ok) {
      assert.equal(rOmni.besedilo, "Vse je v redu.");
      assert.deepEqual(rOmni.klici, []);
      assert.equal(rOmni.razlogKonca, "konec");
      assert.deepEqual(rOmni.usage, { vhod: 80, izhod: 12, predpomnjeni: 0 });
    }
    assert.equal(rCustom.ok, true);
    if (rCustom.ok) {
      assert.equal(rCustom.besedilo, "Lokalni odgovor.");
      assert.deepEqual(rCustom.klici, []);
      assert.equal(rCustom.razlogKonca, "konec");
      assert.deepEqual(rCustom.usage, { vhod: 60, izhod: 9, predpomnjeni: 0 });
    }
    assert.equal(zajeto[0]!.url, "http://127.0.0.1:20128/v1/chat/completions");
    assert.equal(zajeto[1]!.url, "http://127.0.0.1:11434/v1/chat/completions");
  });

  it("OpenAI-zdruzljivi: napacen JSON ali ne-objekt v tool_calls.function.arguments -> napaka, ne izvedba", async () => {
    const zajeto: ZajetaZahteva[] = [];
    globalThis.fetch = lazniFetch(
      [
        {
          telo: {
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [{ id: "c1", type: "function", function: { name: "beri", arguments: '{"pot": ' } }],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        },
        {
          telo: {
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [{ id: "c2", type: "function", function: { name: "beri", arguments: "[1, 2, 3]" } }],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        },
        {
          telo: {
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [{ id: "c3", type: "function", function: { name: "beri", arguments: "null" } }],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        },
        {
          telo: {
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [{ id: "c4", type: "function", function: { name: "beri", arguments: "" } }],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        },
      ],
      zajeto,
    );

    const ponudnik = { provider: "openai" as const, model: "gpt-6-luna", key: "sk-test-openai" };
    for (let k = 0; k < 4; k += 1) {
      const r = await callProviderZOrodji(ponudnik, [{ vloga: "uporabnik", besedilo: "test" }], ORODJA);
      assert.equal(r.ok, false, `Poskus ${k + 1} mora vrniti napako.`);
    }
  });
});

describe("F1: callProviderZOrodji — Claude", () => {
  it("Claude: poslje tools (input_schema), cache_control in zdruzene tool_result bloke ter vrne tool_use in usage", async () => {
    const zajeto: ZajetaZahteva[] = [];
    globalThis.fetch = lazniFetch(
      [
        {
          telo: {
            id: "msg_1",
            type: "message",
            role: "assistant",
            stop_reason: "tool_use",
            content: [
              { type: "text", text: "Odprem datoteko." },
              { type: "tool_use", id: "toolu_01", name: "beri", input: { pot: "src/main.ts" } },
            ],
            usage: {
              input_tokens: 300,
              output_tokens: 55,
              cache_read_input_tokens: 180,
              cache_creation_input_tokens: 40,
            },
          },
        },
      ],
      zajeto,
    );

    const sporocila: SporociloOrodja[] = [
      { vloga: "uporabnik", besedilo: "Preglej kodo." },
      {
        vloga: "asistent",
        besedilo: "Iscem.",
        klici: [
          { id: "toolu_a", ime: "isci", argumenti: { vzorec: "foo" } },
          { id: "toolu_b", ime: "beri", argumenti: { pot: "a.ts" } },
        ],
      },
      { vloga: "orodje", id: "toolu_a", ime: "isci", rezultat: "src/main.ts:3" },
      { vloga: "orodje", id: "toolu_b", ime: "beri", rezultat: "Datoteka ne obstaja", napaka: true },
    ];

    const r = await callProviderZOrodji(
      { provider: "claude", model: "claude-sonnet-5-5", key: "sk-ant-test-kljuc" },
      sporocila,
      ORODJA,
      { system: "Si Lina programerka.", predpomniPredpono: true },
    );

    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.besedilo, "Odprem datoteko.");
    assert.equal(r.razlogKonca, "orodje");
    assert.deepEqual(r.klici, [{ id: "toolu_01", ime: "beri", argumenti: { pot: "src/main.ts" } }]);
    assert.deepEqual(r.usage, { vhod: 300, izhod: 55, predpomnjeni: 180, zapisPredpomnilnika: 40 });

    assert.equal(zajeto[0]!.url, "https://api.anthropic.com/v1/messages");
    assert.equal(zajeto[0]!.glave["x-api-key"], "sk-ant-test-kljuc");
    assert.equal(zajeto[0]!.glave["anthropic-version"], "2023-06-01");
    const telo = zajeto[0]!.telo as {
      system?: Array<{ type: string; text: string; cache_control?: { type: string } }>;
      tools?: Array<{ name: string; input_schema: unknown; cache_control?: { type: string } }>;
      messages?: Array<{ role: string; content: unknown }>;
    };
    assert.deepEqual(telo.system?.[0]?.cache_control, { type: "ephemeral" });
    assert.equal(telo.tools?.length, 2);
    assert.deepEqual(telo.tools?.[1]?.cache_control, { type: "ephemeral" });
    // Dva zaporedna rezultata orodij sta zdruzena v ENO user sporocilo z dvema tool_result blokoma.
    assert.equal(telo.messages?.length, 3);
    assert.equal(telo.messages?.[2]?.role, "user");
    const bloki = telo.messages?.[2]?.content as Array<Record<string, unknown>>;
    assert.equal(bloki.length, 2);
    assert.deepEqual(bloki[0], { type: "tool_result", tool_use_id: "toolu_a", content: "src/main.ts:3" });
    assert.deepEqual(bloki[1], { type: "tool_result", tool_use_id: "toolu_b", content: "Datoteka ne obstaja", is_error: true });
  });

  it("Claude: odgovor brez klica orodja in napacni argumenti tool_use", async () => {
    const zajeto: ZajetaZahteva[] = [];
    globalThis.fetch = lazniFetch(
      [
        {
          telo: {
            stop_reason: "end_turn",
            content: [{ type: "text", text: "Koncano brez orodij." }],
            usage: { input_tokens: 90, output_tokens: 20 },
          },
        },
        {
          telo: {
            stop_reason: "tool_use",
            content: [{ type: "tool_use", id: "toolu_bad", name: "beri", input: "{neveljaven" }],
          },
        },
        {
          telo: {
            stop_reason: "tool_use",
            content: [{ type: "tool_use", id: "toolu_arr", name: "beri", input: ["seznam"] }],
          },
        },
      ],
      zajeto,
    );

    const ponudnik = { provider: "claude" as const, model: "claude-sonnet-5-5", key: "sk-ant-test" };
    const ok = await callProviderZOrodji(ponudnik, [{ vloga: "uporabnik", besedilo: "Zivjo" }], ORODJA);
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.besedilo, "Koncano brez orodij.");
      assert.deepEqual(ok.klici, []);
      assert.equal(ok.razlogKonca, "konec");
      assert.deepEqual(ok.usage, { vhod: 90, izhod: 20, predpomnjeni: 0 });
    }

    const bad1 = await callProviderZOrodji(ponudnik, [{ vloga: "uporabnik", besedilo: "test" }], ORODJA);
    const bad2 = await callProviderZOrodji(ponudnik, [{ vloga: "uporabnik", besedilo: "test" }], ORODJA);
    assert.equal(bad1.ok, false);
    assert.equal(bad2.ok, false);
  });
});

describe("F1: varovala in belezenje porabe (callProvider in callProviderZOrodji)", () => {
  it("callProviderZOrodji ne reze odgovora pri 6000 znakih, zavrne prevelik vhod in skrije kljuc ob napaki", async () => {
    const dolgo = "x".repeat(9000);
    const zajeto: ZajetaZahteva[] = [];
    globalThis.fetch = lazniFetch(
      [
        {
          telo: {
            choices: [{ message: { role: "assistant", content: dolgo }, finish_reason: "stop" }],
            usage: { prompt_tokens: 50, completion_tokens: 2200 },
          },
        },
        {
          status: 401,
          telo: { error: { message: "Invalid key sk-tajni-kljuc-9999" } },
        },
      ],
      zajeto,
    );

    const rDolgo = await callProviderZOrodji(
      { provider: "openai", model: "gpt-6-luna", key: "sk-tajni-kljuc-9999" },
      [{ vloga: "uporabnik", besedilo: "Napisi kodo." }],
      ORODJA,
    );
    assert.equal(rDolgo.ok, true);
    if (rDolgo.ok) assert.equal(rDolgo.besedilo.length, 9000);

    const rNapaka = await callProviderZOrodji(
      { provider: "openai", model: "gpt-6-luna", key: "sk-tajni-kljuc-9999" },
      [{ vloga: "uporabnik", besedilo: "Napisi kodo." }],
      ORODJA,
    );
    assert.equal(rNapaka.ok, false);
    if (!rNapaka.ok) {
      assert.equal(rNapaka.vzrok, "kljuc");
      assert.equal(rNapaka.sporocilo.includes("sk-tajni-kljuc-9999"), false);
    }

    const rPrevelik = await callProviderZOrodji(
      { provider: "openai", model: "gpt-6-luna", key: "sk-tajni-kljuc-9999" },
      [{ vloga: "uporabnik", besedilo: "a".repeat(NAJVEC_ZNAKOV_VHODA + 1) }],
      ORODJA,
    );
    assert.equal(rPrevelik.ok, false);
    assert.equal(zajeto.length, 2, "prevelik vhod ne sme klicati fetch");
  });

  it("belezenje usage za obstojeci callProvider (OpenAI, Claude, Gemini, custom) in callProviderZOrodji brez vsebine sporocil", async () => {
    const zajeto: ZajetaZahteva[] = [];
    const SKRIVNA_VSEBINA = "Zelo zaupno sporocilo stranke Novak 12345";
    globalThis.fetch = lazniFetch(
      [
        {
          telo: {
            choices: [{ message: { content: "Odgovor OpenAI." } }],
            usage: { prompt_tokens: 100, completion_tokens: 25, prompt_tokens_details: { cached_tokens: 40 } },
          },
        },
        {
          telo: {
            content: [{ text: "Odgovor Claude." }],
            usage: { input_tokens: 200, output_tokens: 50, cache_read_input_tokens: 60, cache_creation_input_tokens: 15 },
          },
        },
        {
          telo: {
            candidates: [{ content: { parts: [{ text: "Odgovor Gemini." }] } }],
            usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 30, cachedContentTokenCount: 20 },
          },
        },
        {
          telo: {
            choices: [{ message: { content: "Odgovor custom." }, finish_reason: "stop" }],
            usage: { prompt_tokens: 70, completion_tokens: 10 },
          },
        },
        {
          telo: {
            choices: [{ message: { content: "Odgovor orodja." }, finish_reason: "stop" }],
            usage: { prompt_tokens: 300, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 100 } },
          },
        },
      ],
      zajeto,
    );

    const r1 = await callProvider({ provider: "openai", model: "gpt-6-luna", key: "sk-1", text: SKRIVNA_VSEBINA });
    const r2 = await callProvider({ provider: "claude", model: "claude-sonnet-5-5", key: "sk-ant-1", text: SKRIVNA_VSEBINA });
    const r3 = await callProvider({ provider: "gemini", model: "gemini-3.8-flash", key: "AIza-1", text: SKRIVNA_VSEBINA });
    const r4 = await callProvider({
      provider: "custom",
      model: "llama-lokalni",
      key: "",
      naslov: "http://127.0.0.1:11434/v1",
      vsebinaKlica: false,
      text: SKRIVNA_VSEBINA,
    });
    const r5 = await callProviderZOrodji(
      { provider: "openai", model: "gpt-6-luna", key: "sk-1" },
      [{ vloga: "uporabnik", besedilo: SKRIVNA_VSEBINA }],
      ORODJA,
    );

    assert.deepEqual(r1, { ok: true, text: "Odgovor OpenAI." });
    assert.deepEqual(r2, { ok: true, text: "Odgovor Claude." });
    assert.deepEqual(r3, { ok: true, text: "Odgovor Gemini." });
    assert.deepEqual(r4, { ok: true, text: "Odgovor custom." });
    assert.equal(r5.ok, true);

    const posnetek = posnetekPorabe();
    assert.equal(posnetek.skupaj.klici, 5);
    assert.equal(posnetek.skupaj.vhod, 100 + 200 + 150 + 70 + 300);
    assert.equal(posnetek.skupaj.izhod, 25 + 50 + 30 + 10 + 80);
    assert.equal(posnetek.skupaj.predpomnjeni, 40 + 60 + 20 + 0 + 100);
    assert.equal(posnetek.skupaj.zapisPredpomnilnika, 15);
    assert.equal(posnetek.poModelu.length, 5);

    const jsonPosnetek = JSON.stringify(posnetek);
    assert.equal(jsonPosnetek.includes(SKRIVNA_VSEBINA), false, "posnetek porabe ne sme vsebovati vsebine sporocil");
    assert.equal(jsonPosnetek.includes("Odgovor OpenAI"), false);
    assert.equal(jsonPosnetek.includes("sk-1"), false);
  });
});
