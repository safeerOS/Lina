import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type AdcBox = { mode: "ok" | "missing"; token: string; scopes: string[] | null };

vi.mock("google-auth-library", () => {
  class GoogleAuth {
    constructor(opts?: { scopes?: string[] }) {
      const box = (globalThis as { __linaAdc?: AdcBox }).__linaAdc;
      if (box) box.scopes = opts?.scopes ?? null;
    }
    async getClient() {
      const box = (globalThis as { __linaAdc?: AdcBox }).__linaAdc;
      if (!box || box.mode === "missing") throw new Error("Could not load the default credentials.");
      const token = box.token;
      return { getAccessToken: async () => ({ token }) };
    }
  }
  return { GoogleAuth };
});

import { setupOwner } from "./auth.server.ts";
import { readBrain, saveBrain } from "./keys.server.ts";
import { ADC_MANJKA } from "./adc.server.ts";
import { callProvider } from "./providers.ts";

const TOKEN = "YA29.taJni-ZETON-ki-ga-ni-v-odgovoru";
const STUDIO = "AI-STUDIO-KLJUC-9999";

function box(): AdcBox {
  const current = (globalThis as { __linaAdc?: AdcBox }).__linaAdc ?? { mode: "ok" as const, token: TOKEN, scopes: null };
  (globalThis as { __linaAdc?: AdcBox }).__linaAdc = current;
  return current;
}

function header(init: RequestInit | undefined, name: string): string {
  const headers = init?.headers;
  if (!headers) return "";
  if (headers instanceof Headers) return headers.get(name) ?? "";
  const record = headers as Record<string, string>;
  const found = Object.entries(record).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return found?.[1] ?? "";
}

describe("naloga D", () => {
  const logs: string[] = [];
  const originals = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  afterEach(() => {
    console.log = originals.log;
    console.info = originals.info;
    console.warn = originals.warn;
    console.error = originals.error;
    console.debug = originals.debug;
    logs.length = 0;
    vi.unstubAllGlobals();
    const current = box();
    current.mode = "ok";
    current.token = TOKEN;
    current.scopes = null;
  });

  function spyLogs(): void {
    const push = (...args: unknown[]) => {
      logs.push(args.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(" "));
    };
    console.log = push;
    console.info = push;
    console.warn = push;
    console.error = push;
    console.debug = push;
  }

  it("izbira ponudnika vertex sestavi pravi URL in glave", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const current = box();
    current.mode = "ok";
    current.token = TOKEN;
    current.scopes = null;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      seen.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "da" }] } }] }), { status: 200 });
    });
    const result = await callProvider({
      provider: "vertex",
      model: "gemini-3-flash-preview",
      key: "",
      project: "moj-projekt",
      location: "global",
      text: "Pozdrav",
    });
    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(
      "https://aiplatform.googleapis.com/v1beta1/projects/moj-projekt/locations/global/publishers/google/models/gemini-3-flash-preview:generateContent",
    );
    expect(header(seen[0].init, "authorization")).toBe(`Bearer ${TOKEN}`);
    expect(header(seen[0].init, "x-goog-user-project")).toBe("moj-projekt");
    expect(seen[0].init.redirect).toBe("error");
    expect(current.scopes).toEqual(["https://www.googleapis.com/auth/cloud-platform"]);
    expect(seen[0].url.includes(TOKEN)).toBe(false);
  });

  it("brez ADC jasna napaka", async () => {
    box().mode = "missing";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await callProvider({
      provider: "vertex",
      model: "gemini-3-flash-preview",
      key: "",
      project: "moj-projekt",
      location: "global",
      text: "Pozdrav",
    });
    expect(result).toEqual({ ok: false, sporocilo: ADC_MANJKA });
    expect(result.ok === false && result.sporocilo).toBe(
      "Na tem računalniku ni prijave Google Cloud. Poženi: gcloud auth application-default login",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("žeton ni v dnevniku, odgovoru ali datoteki", async () => {
    spyLogs();
    box().mode = "ok";
    box().token = TOKEN;
    vi.stubGlobal("fetch", async () => {
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: `odgovor ${TOKEN}` }] } }] }), {
        status: 200,
      });
    });
    const ok = await callProvider({
      provider: "vertex",
      model: "",
      key: TOKEN,
      project: "moj-projekt",
      text: "Pozdrav",
    });
    expect(JSON.stringify(ok).includes(TOKEN)).toBe(false);
    expect(ok.ok).toBe(true);

    vi.stubGlobal("fetch", async () => new Response(`napaka ${TOKEN}`, { status: 500 }));
    const bad = await callProvider({
      provider: "vertex",
      model: "gemini-3-flash-preview",
      key: "",
      project: "moj-projekt",
      location: "global",
      text: "Pozdrav",
    });
    expect(JSON.stringify(bad).includes(TOKEN)).toBe(false);

    const dir = await mkdtemp(path.join(tmpdir(), "lina-d-"));
    try {
      const session = await setupOwner("geslo-test-1234", dir, { address: "127.0.0.1" });
      const saved = await saveBrain(
        { provider: "vertex", model: "gemini-3-flash-preview", key: TOKEN, project: "moj-projekt", location: "global" },
        session,
        dir,
      );
      const again = await readBrain(session, dir);
      const disk = await readFile(path.join(dir, "kljuci.json"), "utf8");
      const packed = JSON.stringify({ saved, again, disk, logs });
      expect(packed.includes(TOKEN)).toBe(false);
      expect(disk.includes("moj-projekt")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    expect(logs.join("\n").includes(TOKEN)).toBe(false);
  });

  it("obstojeci AI Studio ponudnik nespremenjen", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const current = box();
    current.scopes = null;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      seen.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "da" }] } }] }), { status: 200 });
    });
    const result = await callProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      key: STUDIO,
      text: "Pozdrav",
    });
    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(1);
    const url = new URL(seen[0].url);
    expect(url.hostname).toBe("generativelanguage.googleapis.com");
    expect(url.pathname).toBe("/v1beta/models/gemini-2.0-flash:generateContent");
    expect(header(seen[0].init, "x-goog-api-key")).toBe(STUDIO);
    expect(header(seen[0].init, "authorization")).toBe("");
    expect(seen[0].url.includes("aiplatform.googleapis.com")).toBe(false);
    expect(seen[0].url.includes(STUDIO)).toBe(false);
    expect(current.scopes).toBeNull();
  });
});
