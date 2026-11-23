/**
 * 112 v osebni tajnici (lastnik 22. 11. 2026): nevarnost prepozna koda, Lina takoj napoti na sto dvanajst in izrek zapise kot nujno.
 * Panel klicateljev (v mislih): prestrasen klicatelj, starejsi klicatelj, obicajen poslovni klic, sala; napacen alarm je slabsi od
 * zgresenega pri obicajnem sporocilu, zato so vzorci ozki.
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { t } from "./besedila.ts";
import { jeNevarnost } from "./nevarnost.ts";
import { varenOdgovorOsebna } from "./osebna-razumevanje.server.ts";
import { defaultPravila } from "./pravila.server.ts";
import { recordCaller } from "./service.server.ts";
import { readJsonFile, writeJson } from "./store.server.ts";
import type { CallSession } from "./types.ts";

describe("jeNevarnost", () => {
  it("prepozna nesreco, pozar, nasilje in nujno zdravstveno stanje", () => {
    for (const izrek of [
      "Imeli smo prometno nesrečo, sin je poškodovan",
      "Pri nas gori kuhinja",
      "Oče ne diha, kaj naj naredim",
      "Mama se je zgrudila in se ne odziva",
      "Mislim, da imam srčni napad",
      "Napadel me je sosed z nožem",
      "Hudo krvavi iz glave",
      "V nevarnosti sem, prosim pomagajte",
      "Pokličite reševalce, hitro",
    ]) assert.equal(jeNevarnost(izrek), true, izrek);
  });
  it("obicajna sporocila niso alarm", () => {
    for (const izrek of [
      "Povejte ji, da pridem v ponedeljek",
      "Kapa mi je ostala pri vas",
      "Na avtu mi gori lučka za olje, naj me pokliče",
      "Ali mi lahko pomagate pri naročilu",
      "Včeraj je bil dober napad naše ekipe",
      "Kličem zaradi ponudbe za zavarovanje za nesreče",
      "",
    ]) assert.equal(jeNevarnost(izrek), false, izrek);
  });
  it("stavek je brez stevk in pove sto dvanajst", () => {
    assert.match(t("osebnaNevarnost"), /sto dvanajst/);
    assert.doesNotMatch(t("osebnaNevarnost"), /\d/);
    assert.ok(t("osebnaNevarnost").length <= 160);
    void varenOdgovorOsebna;
  });
});

describe("osebna tajnica: potek klica z nevarnostjo", () => {
  async function klic(sid: string) {
    const dir = await mkdtemp(path.join(tmpdir(), "lina-112-"));
    await writeJson(dir, "pravila.json", { ...defaultPravila(), prevzem: "vsi", nacinKlica: "osebna", imeLastnika: "Ana" });
    let model = 0;
    const m = async () => {
      model += 1;
      throw new Error("model ni na voljo");
    };
    await recordCaller({ callSid: sid, from: "+38641123456", text: "" }, dir, undefined, { razumevanje: m });
    const reci = (text: string) => recordCaller({ callSid: sid, from: "+38641123456", text }, dir, undefined, { razumevanje: m });
    return { dir, reci, model: () => model };
  }

  it("takoj napotitev na 112 brez modela, izrek zapisan kot nujno, klic tece naprej; drugic se stavek ne ponovi", async () => {
    const { dir, reci, model } = await klic("CA-112-1");
    const r = await reci("Oče ne diha, povejte Ani naj takoj pride");
    // Pravilo C (15. 11. 2026): odgovor po zapisanem sporocilu dobi zakljucni stavek; klicatelj naj odlozi in poklice 112.
    assert.ok(r.reply.startsWith(t("osebnaNevarnost")), r.reply);
    assert.equal(model(), 0, "o nevarnosti odloca koda, ne model");
    assert.notEqual(r.call.status, "zakljucen");
    assert.equal(r.call.order.tajnica?.nujno, true);
    assert.match(r.call.order.tajnica?.sporocilo ?? "", /ne diha/i);
    const knjiga = await readJsonFile<Record<string, CallSession>>(dir, "calls.json");
    assert.equal(knjiga?.["CA-112-1"].order.tajnica?.nujno, true);
    const r2 = await reci("Še vedno ne diha, pohitite prosim");
    assert.doesNotMatch(r2.reply, /sto dvanajst/);
  });

  it("obicajno sporocilo ne sprozi napotitve", async () => {
    const { reci } = await klic("CA-112-2");
    const r = await reci("pozdravite jo lepo in ji povejte da pridem v ponedeljek");
    assert.doesNotMatch(r.reply, /sto dvanajst/);
    assert.notEqual(r.call.order.tajnica?.nujno, true);
  });
});
