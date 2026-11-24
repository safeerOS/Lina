// Pregled RAC-B (slepi pregled): preizkusi najdb. Samo v kopiji.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { activeBrain, nastaviBrezplacneModele, pogovorBrain, saveBrain, shraniKljucAsistentke } from "./keys.server.ts";

process.env.LINA_LLM = "0";
for (const k of ["OPENROUTER_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) delete process.env[k];
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-rac-b-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));

describe("B9 asistentka", () => {
  it("izklop stikala brezplacnih: asistentka (izbran OpenRouter :free) ne sme tiho k ponudniku klicev", async () => {
    const dir = await mkdtemp(path.join(KOREN, "d-"));
    process.env.LINA_DATA = dir;
    const token = await setupOwner("geslo-test-1234", dir);
    await saveBrain({ provider: "grok", key: "xai-izmisljen-kljuc-za-klice-1111", model: "grok-4" }, token, dir);
    await shraniKljucAsistentke({ key: "sk-or-v1-izmisljen-kljuc-asistentke-3333", model: "google/gemma-4-31b-it:free", soglasje: true }, token, dir);
    await nastaviBrezplacneModele(false, token, dir);
    const b = await pogovorBrain(dir);
    console.log("pogovorBrain po izklopu:", b?.provider, b?.model);
    assert.notEqual(b?.provider, "grok", "vsebina asistentke gre k ponudniku klicev (B9)");
  });

  it("kljuc klicev neberljiv (.kljuc zamenjan): activeBrain ne sme k drugemu ponudniku iz okolja", async () => {
    const dir = await mkdtemp(path.join(KOREN, "d-"));
    process.env.LINA_DATA = dir;
    const token = await setupOwner("geslo-test-1234", dir);
    await saveBrain({ provider: "claude", key: "sk-ant-izmisljen-kljuc-4444", model: "claude-sonnet-5-5" }, token, dir);
    await writeFile(path.join(dir, ".kljuc"), Buffer.alloc(32, 7));
    process.env.XAI_API_KEY = "xai-iz-okolja-5555";
    try {
      const b = await activeBrain(dir);
      console.log("activeBrain:", b?.provider);
      assert.notEqual(b?.provider, "grok", "klici gredo k ponudniku iz okolja, ki ga lastnik ni izbral (B9)");
    } finally {
      delete process.env.XAI_API_KEY;
    }
  });
});

import { apkZaTelefon } from "./gradnje-github.server.ts";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";

describe("APK veja", () => {
  it("apkZaTelefon ne sme ponuditi APK iz veje, ki ni dovoljena za namestitev (kot deb, A-3)", async () => {
    const dir = await mkdtemp(path.join(KOREN, "g-"));
    const mapa = path.join(dir, "prejemi", "gradnja");
    await mkdir(mapa, { recursive: true });
    const vsebina = Buffer.from("lazni apk");
    await writeFile(path.join(mapa, "app.apk"), vsebina);
    const sha256 = createHash("sha256").update(vsebina).digest("hex");
    const g = { id: "0123456789abcdef", izvor: "lina", tok: "gradnja.yml", veja: "tuja-veja", commit: "a".repeat(40), zgostitev: "x", stanje: "koncano",
      ustvarjeno: new Date().toISOString(), potrjeno: new Date().toISOString(), prejsnjiTek: 1, tekId: 2, zacetekTeka: null, konec: null, zakljucek: "success",
      anotacije: [], mapa, datoteke: [], paket: { pot: "app.apk", sha256, velikost: vsebina.length }, podpis: "ujema", razlog: null, obvesceno: true, poskusiPrenosa: 1 };
    await writeFile(path.join(dir, "gradnje-github.json"), JSON.stringify({ v: 1, veje: ["main", "tuja-veja"], vejeCas: 0, privzeta: "main", gradnje: [g] }));
    await writeFile(path.join(dir, "gradnje-github-nastavitve.json"), JSON.stringify({ vklopljeno: true, namestitevVeje: ["main"] }));
    const a = await apkZaTelefon(dir);
    console.log("apkZaTelefon:", a?.id ?? null);
    assert.equal(a, null, "APK iz veje zunaj namestitevVeje gre na telefon");
  });
});

import { preveriAsistentko } from "./keys.server.ts";

describe("B9 preveriAsistentko", () => {
  it("po izklopu stikala preveriAsistentko ne poklice ponudnika klicev", async () => {
    const dir = await mkdtemp(path.join(KOREN, "p-"));
    process.env.LINA_DATA = dir;
    const token = await setupOwner("geslo-test-1234", dir);
    await saveBrain({ provider: "grok", key: "xai-izmisljen-kljuc-za-klice-1111", model: "grok-4" }, token, dir);
    await shraniKljucAsistentke({ key: "sk-or-v1-izmisljen-kljuc-asistentke-3333", model: "google/gemma-4-31b-it:free", soglasje: true }, token, dir);
    await nastaviBrezplacneModele(false, token, dir);
    const naslovi: string[] = [];
    const prej = globalThis.fetch;
    globalThis.fetch = (async (u: string | URL | Request) => {
      naslovi.push(String(u instanceof Request ? u.url : u));
      return new Response(JSON.stringify({ choices: [{ message: { content: "da" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const izid = await preveriAsistentko(token, dir);
      console.log("preveriAsistentko:", JSON.stringify(izid), "naslovi:", naslovi.join(","));
      assert.ok(naslovi.every((n) => !n.includes("api.x.ai")), "zahteva asistentke je sla na api.x.ai");
    } finally {
      globalThis.fetch = prej;
    }
  });
});

// ---- Popravki 0755: dodatni preizkusi (vsak brez popravka pade) ----
import { okoljeZaGh, predlagajGradnjo } from "./gradnje-github.server.ts";

describe("B9 dodatno", () => {
  it("preveriAsistentko po izklopu stikala (kljuc klicev obstaja) pove jasen razlog brez zahteve", async () => {
    const dir = await mkdtemp(path.join(KOREN, "r-"));
    process.env.LINA_DATA = dir;
    const token = await setupOwner("geslo-test-1234", dir);
    await saveBrain({ provider: "grok", key: "xai-izmisljen-kljuc-za-klice-1111", model: "grok-4" }, token, dir);
    await shraniKljucAsistentke({ key: "sk-or-v1-izmisljen-kljuc-asistentke-3333", model: "google/gemma-4-31b-it:free", soglasje: true }, token, dir);
    await nastaviBrezplacneModele(false, token, dir);
    const prej = globalThis.fetch;
    let zahtev = 0;
    globalThis.fetch = (async () => {
      zahtev++;
      return new Response("{}", { status: 500 });
    }) as typeof fetch;
    try {
      const izid = await preveriAsistentko(token, dir);
      assert.equal(izid.ok, false);
      assert.match(izid.sporocilo, /vklopite stikalo za brezplačne modele/);
      assert.equal(zahtev, 0);
    } finally {
      globalThis.fetch = prej;
    }
  });

  it("activeBrain: izbran ponudnik brez shranjenega kljuca vzame envKey ISTEGA ponudnika, nikoli drugega", async () => {
    const dir = await mkdtemp(path.join(KOREN, "e-"));
    const token = await setupOwner("geslo-test-1234", dir);
    await saveBrain({ provider: "claude", key: "sk-ant-izmisljen-kljuc-4444", model: "claude-sonnet-5-5" }, token, dir);
    await writeFile(path.join(dir, ".kljuc"), Buffer.alloc(32, 7));
    process.env.XAI_API_KEY = "xai-iz-okolja-5555";
    process.env.ANTHROPIC_API_KEY = "sk-ant-iz-okolja-6666";
    try {
      const b = await activeBrain(dir);
      assert.equal(b?.provider, "claude");
      assert.equal(b?.key, "sk-ant-iz-okolja-6666");
    } finally {
      delete process.env.XAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});

describe("APK dodatno", () => {
  it("apkZaTelefon ne ponudi zapisa brez commita (tudi iz dovoljene veje)", async () => {
    const dir = await mkdtemp(path.join(KOREN, "c-"));
    const mapa = path.join(dir, "prejemi", "gradnja");
    await mkdir(mapa, { recursive: true });
    const vsebina = Buffer.from("apk");
    await writeFile(path.join(mapa, "app.apk"), vsebina);
    const sha256 = createHash("sha256").update(vsebina).digest("hex");
    const g = { id: "fedcba9876543210", izvor: "lastnik", tok: "gradnja.yml", veja: "main", commit: null, zgostitev: "x", stanje: "koncano",
      ustvarjeno: new Date().toISOString(), potrjeno: new Date().toISOString(), prejsnjiTek: 1, tekId: 2, zacetekTeka: null, konec: null, zakljucek: "success",
      anotacije: [], mapa, datoteke: [], paket: { pot: "app.apk", sha256, velikost: vsebina.length }, podpis: "ujema", razlog: null, obvesceno: true, poskusiPrenosa: 1 };
    await writeFile(path.join(dir, "gradnje-github.json"), JSON.stringify({ v: 1, veje: ["main"], vejeCas: 0, privzeta: "main", gradnje: [g] }));
    await writeFile(path.join(dir, "gradnje-github-nastavitve.json"), JSON.stringify({ vklopljeno: true, namestitevVeje: ["main"] }));
    assert.equal(await apkZaTelefon(dir), null);
  });
});

describe("B-4 okoljeZaGh", () => {
  it("kljuci ponudnikov in neznane spremenljivke ne gredo v gh; GH_* samo za gh, ne za xdg/apksigner", () => {
    const vhod = { PATH: "/usr/bin", HOME: "/h", LANG: "sl_SI.UTF-8", XDG_RUNTIME_DIR: "/run/user/1", DISPLAY: ":0",
      OPENAI_API_KEY: "a", ANTHROPIC_API_KEY: "b", XAI_API_KEY: "c", OPENROUTER_API_KEY: "d", GEMINI_API_KEY: "e", GOOGLE_API_KEY: "f",
      AWS_SECRET_ACCESS_KEY: "g", GH_TOKEN: "t", GITHUB_TOKEN: "u", TWILIO_X: "v" };
    const zaGh = okoljeZaGh(vhod);
    for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "AWS_SECRET_ACCESS_KEY", "TWILIO_X"]) {
      assert.equal(zaGh[k], undefined, k);
    }
    for (const k of ["PATH", "HOME", "LANG", "XDG_RUNTIME_DIR", "DISPLAY", "GH_TOKEN", "GITHUB_TOKEN"]) assert.equal(zaGh[k], vhod[k as keyof typeof vhod], k);
    const brezGh = okoljeZaGh(vhod, false);
    assert.equal(brezGh.GH_TOKEN, undefined);
    assert.equal(brezGh.GITHUB_TOKEN, undefined);
    assert.equal(brezGh.HOME, "/h");
  });
});

describe("B-7 meja Lininih predlogov gradnje", () => {
  it("Lina ima najvec 1 cakajoc predlog; lastnikova mesta ostanejo prosta", async () => {
    const dom = await mkdtemp(path.join(KOREN, "b7-"));
    const podatki = path.join(dom, "podatki");
    await mkdir(path.join(dom, "Prejemi"), { recursive: true });
    await mkdir(podatki);
    const token = await setupOwner("geslo-test-1234", podatki);
    const { ukazGradenj } = await import("./gradnje-github.server.ts");
    const o = {
      dom,
      spremljaj: false,
      zdaj: () => new Date(2026, 10, 24, 9, 5, 0),
      najdi: (p: string) => (p === "gh" ? "/opt/gh/bin/gh" : null),
      izvedi: async (_p: string, args: readonly string[]) => {
        const a = args.join(" ");
        if (a.startsWith("api --paginate repos/safeerOS/Lina/branches")) return "main\n";
        if (a.startsWith("api repos/safeerOS/Lina/branches/")) return `${"c".repeat(40)}\n`;
        if (a === "api repos/safeerOS/Lina --jq .default_branch") return "main\n";
        throw new Error(`neznan klic ${a}`);
      },
    };
    assert.ok(await predlagajGradnjo(podatki, "gradnja.yml", "main", o));
    assert.equal(await predlagajGradnjo(podatki, "gradnja.yml", "main", o), null, "drugi Linin predlog zavrnjen");
    for (let i = 0; i < 3; i++) await ukazGradenj(token, { ukaz: "pripravi", tok: "gradnja.yml", veja: "main" }, podatki, o);
    await assert.rejects(ukazGradenj(token, { ukaz: "pripravi", tok: "gradnja.yml", veja: "main" }, podatki, o), { razlog: "polno-cakajoce" });
  });
});

describe("B-3 javna: lahkoNamesti za APK", () => {
  it("APK iz veje zunaj namestitevVeje ima lahkoNamesti false (kot deb)", async () => {
    const dom = await mkdtemp(path.join(KOREN, "b3-"));
    const podatki = path.join(dom, "podatki");
    await mkdir(path.join(dom, "Prejemi"), { recursive: true });
    await mkdir(podatki);
    const token = await setupOwner("geslo-test-1234", podatki);
    const { stanjeGradenj } = await import("./gradnje-github.server.ts");
    const mapa = path.join(dom, "Prejemi", "g");
    await mkdir(mapa, { recursive: true });
    await writeFile(path.join(mapa, "app.apk"), "apk");
    const osnova = { izvor: "lastnik", tok: "gradnja.yml", commit: "a".repeat(40), zgostitev: "x", stanje: "koncano",
      ustvarjeno: new Date().toISOString(), potrjeno: new Date().toISOString(), prejsnjiTek: 1, tekId: 2, zacetekTeka: null, konec: null, zakljucek: "success",
      anotacije: [], mapa, datoteke: [], paket: { pot: "app.apk", sha256: "0".repeat(64), velikost: 3 }, podpis: "ujema", razlog: null, obvesceno: true, poskusiPrenosa: 1 };
    await writeFile(path.join(podatki, "gradnje-github.json"), JSON.stringify({ v: 1, veje: ["main", "tuja"], vejeCas: Date.now(), privzeta: "main",
      gradnje: [{ ...osnova, id: "1111111111111111", veja: "tuja" }, { ...osnova, id: "2222222222222222", veja: "main" }] }));
    await writeFile(path.join(podatki, "gradnje-github-nastavitve.json"), JSON.stringify({ vklopljeno: true, namestitevVeje: ["main"] }));
    const o = { dom, spremljaj: false, najdi: () => null, izvedi: async () => { throw new Error("brez gh"); } };
    const s = await stanjeGradenj(token, podatki, o);
    assert.equal(s.gradnje.find((g) => g.id === "1111111111111111")?.lahkoNamesti, false);
    assert.equal(s.gradnje.find((g) => g.id === "2222222222222222")?.lahkoNamesti, true);
  });
});

describe("B-2 dodatno: custom v kljuci.json", () => {
  it("rocno vpisan custom v kljuci.json + kljuc drugega ponudnika v okolju: activeBrain null", async () => {
    const dir = await mkdtemp(path.join(KOREN, "k-"));
    await writeFile(path.join(dir, "kljuci.json"), JSON.stringify({ provider: "custom", model: "auto" }));
    process.env.XAI_API_KEY = "xai-iz-okolja-7777";
    try {
      assert.equal(await activeBrain(dir), null);
    } finally {
      delete process.env.XAI_API_KEY;
    }
  });
});
