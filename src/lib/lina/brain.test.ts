/**
 * Popravki po pravem preizkusnem klicu (lastnik, 14. 11. 2026): (A) Lina se da prekiniti, (B) se ne ponavlja,
 * (C) po materialu sprasuje samo, ce ga katalog ima. Brez pravega omrezja in modela; imena izmisljena.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { renderReply, stavekBrezIzdelka } from "./brain.ts";
import { applyGuards } from "./guards.ts";
import { stalniStavki } from "./glas.ts";
import { skrajsajZnanje, zadnjiStavek } from "./odgovor-znanje.ts";
import { povzetekKlica } from "./povzetek.ts";
import type { ModelRazumevanja } from "./razumevanje.server.ts";
import { loadPravila } from "./pravila.server.ts";
import { preberiKlic, recordCaller } from "./service.server.ts";
import { writeJson } from "./store.server.ts";
import type { Catalog } from "./types.ts";
import { handleVoiceRequest } from "./voice.server.ts";

process.env.LINA_LLM = "0";
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-popravki-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));

function katalog(materiali: boolean): Catalog {
  return {
    company: { name: "Primer Safeer", trade: "", phone: "", address: "", hours: "", about: "" },
    materials: materiali ? [{ id: "m1", name: "Hrast", note: "" }] : [],
    products: [
      { id: "p1", name: "Alfa", kind: "program", summary: "", materialIds: materiali ? ["m1"] : [] },
      { id: "p2", name: "Beta", kind: "program", summary: "", materialIds: materiali ? ["m1"] : [] },
    ],
    zapiski: [],
    znanje: "Alfa vsebuje e-pošto, klepet in en skupni nabiralnik. Nekatera napredna preverjanja prijave včasih potrebujejo zunanji sistem. Beta je predvajalnik.",
  };
}

async function nov(k: Catalog, pravila: Record<string, unknown> | null = null): Promise<string> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  await writeJson(dir, "line.json", { open: true, catalog: k, updatedAt: null });
  if (pravila) await writeJson(dir, "pravila.json", { ...(await loadPravila(dir)), ...pravila });
  return dir;
}

describe("A: govor je znotraj Gather (prekinljiv)", () => {
  it("TwiML pozdrava ima Play ali Say znotraj Gather, za njim Redirect", async () => {
    const dir = await nov(katalog(false));
    await writeJson(dir, "pravila.json", { ...(await loadPravila(dir)), prevzem: "vsi" });
    process.env.TWILIO_AUTH_TOKEN = "zeton-preizkusa";
    try {
      const url = "https://lina.primer/api/voice/incoming";
      const params: Record<string, string> = { CallSid: "CA-PREKINI", From: "+38640000000" };
      const podpis = createHmac("sha1", "zeton-preizkusa")
        .update(Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url))
        .digest("base64");
      const odgovor = await handleVoiceRequest(
        new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": podpis }, body: new URLSearchParams(params).toString() }),
        dir,
      );
      const xml = await odgovor.text();
      assert.match(xml, /<Gather [^>]*input="speech"[^>]*>\s*<(Play|Say)[ >]/, xml);
      const predGather = xml.slice(xml.indexOf("<Response>") + "<Response>".length, xml.indexOf("<Gather"));
      assert.doesNotMatch(predGather, /<(Play|Say)/, "govor ne sme biti pred Gather");
      assert.match(xml, /<\/Gather><Redirect method="POST">/);
    } finally {
      delete process.env.TWILIO_AUTH_TOKEN;
    }
  });
});

const dolg =
  "Alfa vsebuje e-pošto, klepet in en skupni nabiralnik. Nekatera napredna preverjanja prijave včasih potrebujejo zunanji sistem. Beta je predvajalnik. Alfa in Beta sta programa.";
const vprasanje: ModelRazumevanja = async () => JSON.stringify({ namen: "vprasanje", material: "", odgovor: dolg });
const ponovi: ModelRazumevanja = async () => JSON.stringify({ namen: "ponovi", material: "", odgovor: "" });

describe("B: brez ponavljanja", () => {
  it("odgovor iz znanja je kratek, brez fiksnega »Povejte izdelek ...«, in isti odgovor drugic ni ponovljen dolg", async () => {
    const dir = await nov(katalog(false));
    const sid = "CA-PONOVI";
    await recordCaller({ callSid: sid, from: "+38640000000", text: "" }, dir, undefined, { razumevanje: vprasanje });
    await recordCaller({ callSid: sid, text: "ana primer" }, dir, undefined, { razumevanje: vprasanje });
    const prvi = await recordCaller({ callSid: sid, text: "kakšna je prijava?" }, dir, undefined, { razumevanje: vprasanje });
    const drugi = await recordCaller({ callSid: sid, text: "kakšna je prijava?" }, dir, undefined, { razumevanje: vprasanje });
    const tretji = await recordCaller({ callSid: sid, text: "kakšna je prijava?" }, dir, undefined, { razumevanje: vprasanje });
    assert.ok(prvi.reply.includes("Alfa vsebuje"), prvi.reply);
    assert.ok(!prvi.reply.includes("Beta je predvajalnik"), "najvec dva stavka: " + prvi.reply);
    for (const r of [prvi.reply, drugi.reply, tretji.reply]) assert.doesNotMatch(r, /Povejte izdelek/);
    // Prekinjen odgovor ni slisan: drugic pride prvi stavek (vsebina ostane), sele tretjic »Kaj vas se zanima?«.
    assert.ok(drugi.reply.startsWith("Alfa vsebuje e-pošto, klepet in en skupni nabiralnik."), drugi.reply);
    assert.ok(!drugi.reply.includes("Nekatera napredna"), "skrajsan na prvi stavek: " + drugi.reply);
    assert.ok(drugi.reply.length < prvi.reply.length);
    assert.equal(tretji.reply, "Kaj vas še zanima?");
  });

  it("»Ponovim« po odgovoru iz znanja ponovi kratek odgovor (ne dolgega, ne pripetega)", async () => {
    const dir = await nov(katalog(false));
    const sid = "CA-PONOVI2";
    await recordCaller({ callSid: sid, from: "+38640000000", text: "" }, dir, undefined, { razumevanje: vprasanje });
    await recordCaller({ callSid: sid, text: "ana primer" }, dir, undefined, { razumevanje: vprasanje });
    const odgovor = await recordCaller({ callSid: sid, text: "kakšna je prijava?" }, dir, undefined, { razumevanje: vprasanje });
    const kratek = skrajsajZnanje(dolg);
    assert.ok(odgovor.reply.startsWith(kratek));
    const p = await recordCaller({ callSid: sid, text: "ponovite prosim" }, dir, undefined, { razumevanje: ponovi });
    assert.ok(p.reply.startsWith("Ponovim. "), p.reply);
    // Odgovor iz znanja je kratek in ga je klicatelj morda prekinil: ponovi se cel kratek odgovor, ne dolg in ne pripet stavek.
    assert.equal(p.reply, `Ponovim. ${odgovor.reply}`);
    assert.ok(!p.reply.includes("Beta je predvajalnik"));
    // Brez odgovora iz znanja ostane samo zadnji stavek.
    assert.equal(zadnjiStavek("Prvi stavek. Drugi stavek."), "Drugi stavek.");
  });

  it("po ze zapisanem povprasevanju odgovor iz znanja ne vleče za sabo zadnjega Lininega stavka", async () => {
    const dir = await nov(katalog(false), { podrobniPotek: true });
    const sid = "CA-DODATEK";
    const drugo: ModelRazumevanja = async () => '{"namen":"drugo","material":"","odgovor":""}';
    await recordCaller({ callSid: sid, from: "+38640000000", text: "" }, dir, undefined, { razumevanje: drugo });
    await recordCaller({ callSid: sid, text: "ana primer" }, dir, undefined, { razumevanje: drugo });
    const naroceno = await recordCaller({ callSid: sid, text: "rad bi naročil Alfa" }, dir, undefined, { razumevanje: drugo });
    assert.ok(naroceno.reply.length > 0);
    const odgovor = await recordCaller({ callSid: sid, text: "kakšna je prijava?" }, dir, undefined, { razumevanje: vprasanje });
    assert.equal(odgovor.reply, skrajsajZnanje(dolg));
  });

  it("skrajsajZnanje: najvec 2 stavka in meja znakov", () => {
    assert.equal(skrajsajZnanje(dolg), "Alfa vsebuje e-pošto, klepet in en skupni nabiralnik. Nekatera napredna preverjanja prijave včasih potrebujejo zunanji sistem.");
    assert.equal(skrajsajZnanje("Eden."), "Eden.");
    assert.equal(skrajsajZnanje(`${"beseda ".repeat(30).trim()}. ${"Druga ".repeat(30).trim()}.`).split(". ").length, 1);
  });
});

describe("C: material samo, ce ga katalog ima", () => {
  const prazen = { requestedProduct: null, requestedMaterial: null };
  it("katalog brez materialov: noben stavek ne vsebuje »material«", async () => {
    const k = katalog(false);
    assert.doesNotMatch(stavekBrezIzdelka("Alfa, Beta", false), /material/i);
    const osnutek = (izdelek: string | null) => ({ requestedProduct: izdelek, requestedMaterial: null, confirmAsked: false }) as never;
    assert.doesNotMatch(renderReply(k, osnutek(null), applyGuards(prazen, k), false), /material/i);
    assert.doesNotMatch(renderReply(k, osnutek("Alfa"), applyGuards({ requestedProduct: "Alfa", requestedMaterial: null }, k), false), /material/i);
    assert.equal(applyGuards({ requestedProduct: "Alfa", requestedMaterial: null }, k).confirmed, true);
    const pravila = await loadPravila(await nov(k));
    for (const s of stalniStavki(pravila, k.company.name, k)) assert.doesNotMatch(s, /material/i, s);

    const dir = await nov(k);
    const sid = "CA-BREZ-MAT";
    const odgovori: string[] = [];
    const korak = async (text: string) => {
      const r = await recordCaller({ callSid: sid, from: "+38640000000", text }, dir, undefined, { razumevanje: async () => '{"namen":"drugo","material":"","odgovor":""}' });
      odgovori.push(r.reply);
      return r;
    };
    await korak("");
    await korak("ana primer");
    await korak("zanima me");
    await korak("rad bi naročil Alfa");
    const zadnji = await korak("da");
    const klic = await preberiKlic(sid, dir);
    const povzetek = klic ? JSON.stringify(povzetekKlica(klic)) : "";
    for (const o of [...odgovori, povzetek, zadnji.reply]) assert.doesNotMatch(o, /material/i, o);
  });

  it("katalog z materiali ostane pri starem vprasanju", () => {
    const k = katalog(true);
    assert.match(stavekBrezIzdelka("Alfa, Beta"), /izdelek in material/);
    const osnutek = { requestedProduct: "Alfa", requestedMaterial: null, confirmAsked: false } as never;
    assert.match(renderReply(k, osnutek, applyGuards({ requestedProduct: "Alfa", requestedMaterial: null }, k), false), /material/i);
    assert.equal(applyGuards({ requestedProduct: "Alfa", requestedMaterial: null }, k).confirmed, false);
  });
});

describe("npm test je prenosen (Windows)", () => {
  it("skript test ne uporablja predpone VAR=vrednost in okolje poda podprocesu z env=", async () => {
    const { readFileSync } = await import("node:fs");
    const paket = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
    assert.doesNotMatch(paket.scripts.test, /^\s*[A-Z_]+=/, paket.scripts.test);
    assert.doesNotMatch(paket.scripts.test, /\*/, "brez glob razsiritve lupine");
    const zagon = readFileSync(new URL("../../../scripts/test.mjs", import.meta.url), "utf8");
    assert.match(zagon, /env: \{ \.\.\.process\.env, LINA_PODROBNI_POTEK: "1" \}/);
  });
});
