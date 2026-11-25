/**
 * Dodelitev naloge agentu s telefona (lastnik 24. 11. 2026): isti podpisni mehanizem kot dejanja Claude Code in gradnje (podpis naprave
 * ozjega kroga, okno casa, enkratni niz). Podpis veze zgostitev dodelitve (agent, mapa, besedilo, pogoj), ker besedilo lahko vsebuje
 * nove vrstice. Zaledje je lazno, razen zadnjega preizkusa (prava vrsta nalog z izvorom »telefon«). Dobesedni nizi so vektor za Kotlin.
 */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { mkdirSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { request } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Izvajalec } from "./asistent.server.ts";
import { AsistentStreznik, POT, POTI_ODDALJENO, potrdiloAsistenta } from "./asistent-streznik.server.ts";
import { setupOwner } from "./auth.server.ts";
import { potrdiOpozorilo } from "./opozorilo.server.ts";
import { AGENTI } from "./claude-naloge.ts";
import { stanjeClaudeNalog, telefonDodeli, telefonPreklici, telefonStanjeNalog, type Odvisnosti } from "./claude-naloge.server.ts";
import { idIzKljuca, nizDodelitveAgentNaloge, nizPreklicaAgentNaloge, nizStanjaAgentNalog, zgostitevDodelitve, type Dokaz } from "./kanal-claude.ts";
import { pripraviKanal } from "./kanal-claude.server.ts";

type Naprava = { id: string; kljuc: string; zasebni: KeyObject };
function naprava(): Naprava {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const kljuc = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  return { id: idIzKljuca(kljuc), kljuc, zasebni: privateKey };
}
const ANA = naprava();
const TUJA = naprava();
const enkratni = () => randomBytes(16).toString("base64url");
function podpisi(d: Naprava, niz: (c: number, e: string) => string, cas = Date.now(), e = enkratni()): Dokaz {
  return { cas, enkratni: e, podpis: sign("sha256", Buffer.from(niz(cas, e)), d.zasebni).toString("base64") };
}

type Odgovor = { status: number; telo: Buffer };
function zahteva(vrata: number, cert: string, odtis: string, metoda: string, pot: string, telo?: unknown): Promise<Odgovor> {
  return new Promise((ok, ne) => {
    const r = request({
      host: "127.0.0.1", port: vrata, method: metoda, path: pot, ca: cert, rejectUnauthorized: true,
      checkServerIdentity: (_h, c) => (c.fingerprint256.replace(/:/g, "").toLowerCase() === odtis ? undefined : new Error("odtis")),
      headers: telo === undefined ? {} : { "content-type": "application/json" },
    }, (res) => {
      const k: Buffer[] = [];
      res.on("data", (d) => k.push(d));
      res.on("end", () => ok({ status: res.statusCode ?? 0, telo: Buffer.concat(k) }));
    });
    r.on("error", ne);
    r.end(telo === undefined ? undefined : JSON.stringify(telo));
  });
}
const json = (o: Odgovor) => JSON.parse(o.telo.toString("utf8"));
const neIzvajalec: Izvajalec = { ime: "lazni", razpolozljiv: async () => true, zacni: async () => {}, odobri: async () => {}, ustavi: async () => {} };

async function streznik(o: { brez?: boolean } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-agenti-"));
  await pripraviKanal([{ id: ANA.id, kljuc: ANA.kljuc }], dir);
  const klici: string[] = [];
  const s = new AsistentStreznik({
    root: dir, izvajalec: neIzvajalec, dnevnik: () => {},
    agentiNaloge: o.brez ? undefined : {
      stanje: async () => { klici.push("stanje"); return { naloge: [] }; },
      dodeli: async (agent, mapa, besedilo, pogoj) => {
        klici.push(`dodeli ${String(agent)} ${String(mapa)} ${JSON.stringify(besedilo)} ${String(pogoj)}`);
        if (agent === "kimi") throw Object.assign(new Error("x"), { razlog: "agent-brez-poziva" });
        return { id: "0123456789abcdef" };
      },
      preklici: async (id) => { klici.push(`preklici ${String(id)}`); },
    },
  });
  const { vrata, odtis } = await s.zazeni();
  const { cert } = await potrdiloAsistenta(dir);
  return { z: (metoda: string, pot: string, telo?: unknown) => zahteva(vrata, cert, odtis, metoda, pot, telo), klici, ustavi: () => s.ustavi() };
}
const q = (pot: string, d: Naprava, p: Dokaz) => `${POT}${pot}?posiljatelj=${d.id}&cas=${p.cas}&enkratni=${p.enkratni}&podpis=${encodeURIComponent(p.podpis)}`;

test("vektor nizov za Kotlin (dobesedno)", () => {
  const zg = zgostitevDodelitve("pi", "/home/a/p", "vrstica 1\nvrstica 2", "zdaj");
  assert.equal(zg, zgostitevDodelitve("pi", "/home/a/p", "vrstica 1\nvrstica 2", "zdaj"));
  assert.notEqual(zg, zgostitevDodelitve("pi", "/home/a/p\nvrstica 1", "vrstica 2", "zdaj"), "meje polj ne smejo zdrsniti");
  assert.match(zg, /^[a-f0-9]{64}$/);
  // doslovni vektor za Kotlin: SHA-256 (UTF-8) niza JSON ["pi","/home/a/čaj","naloga \"x\"\\y\nkonec","zdaj"]
  // (č ostane UTF-8, narekovaj in poševnica ubezna, nova vrstica kot \n - tu se implementacije JSON najlaze razlikujejo)
  assert.equal(zgostitevDodelitve("pi", "/home/a/čaj", 'naloga "x"\\y\nkonec', "zdaj"), "d7047e26de2a47d4722c5d3f50d03aaa5bb4eb5b7255b44c3cb9cd7a01e0c3e5");
  assert.equal(nizStanjaAgentNalog("n-0123456789abcdef", 1, "e".repeat(16)), "safeer-lina-agenti-stanje-v1\nn-0123456789abcdef\n1\neeeeeeeeeeeeeeee");
  assert.equal(nizDodelitveAgentNaloge("n-0123456789abcdef", "f".repeat(64), 1, "e".repeat(16)), `safeer-lina-agent-dodeli-v1\nn-0123456789abcdef\n${"f".repeat(64)}\n1\neeeeeeeeeeeeeeee`);
  assert.equal(nizPreklicaAgentNaloge("n-0123456789abcdef", "0123456789abcdef", 1, "e".repeat(16)), "safeer-lina-agent-preklici-v1\nn-0123456789abcdef\n0123456789abcdef\n1\neeeeeeeeeeeeeeee");
});

test("dodelitev s telefona: samo podpisana naprava; podpis veze agenta, mapo, besedilo in pogoj; napaka zaledja 409 s kodo", async () => {
  const s = await streznik();
  try {
    const telo = { agent: "pi", mapa: "/home/a/p", besedilo: "Naloga\nz dvema vrsticama", pogoj: "zdaj" };
    const zg = zgostitevDodelitve(telo.agent, telo.mapa, telo.besedilo, telo.pogoj);
    const r = await s.z("POST", `${POT}/agent-naloga/dodeli`, { posiljatelj: ANA.id, ...telo, ...podpisi(ANA, (c, e) => nizDodelitveAgentNaloge(ANA.id, zg, c, e)) });
    assert.equal(r.status, 202);
    assert.equal(json(r).id, "0123456789abcdef");
    // isti podpis, drugo besedilo / druga mapa / drug pogoj: 403, zaledje ne dobi nicesar
    for (const sprememba of [{ besedilo: "Drugo" }, { mapa: "/home/a/scit" }, { pogoj: "po:0123456789abcdef" }, { agent: "opencode" }]) {
      const p = podpisi(ANA, (c, e) => nizDodelitveAgentNaloge(ANA.id, zg, c, e));
      assert.equal((await s.z("POST", `${POT}/agent-naloga/dodeli`, { posiljatelj: ANA.id, ...telo, ...sprememba, ...p })).status, 403);
    }
    const tuja = podpisi(TUJA, (c, e) => nizDodelitveAgentNaloge(TUJA.id, zg, c, e));
    assert.equal((await s.z("POST", `${POT}/agent-naloga/dodeli`, { posiljatelj: TUJA.id, ...telo, ...tuja })).status, 403);
    // ponovitev enkratnega niza
    const p1 = podpisi(ANA, (c, e) => nizDodelitveAgentNaloge(ANA.id, zg, c, e));
    assert.equal((await s.z("POST", `${POT}/agent-naloga/dodeli`, { posiljatelj: ANA.id, ...telo, ...p1 })).status, 202);
    assert.equal((await s.z("POST", `${POT}/agent-naloga/dodeli`, { posiljatelj: ANA.id, ...telo, ...p1 })).status, 403);
    const tk = { ...telo, agent: "kimi" };
    const zk = zgostitevDodelitve(tk.agent, tk.mapa, tk.besedilo, tk.pogoj);
    const rk = await s.z("POST", `${POT}/agent-naloga/dodeli`, { posiljatelj: ANA.id, ...tk, ...podpisi(ANA, (c, e) => nizDodelitveAgentNaloge(ANA.id, zk, c, e)) });
    assert.equal(rk.status, 409);
    assert.equal(json(rk).napaka, "agent-brez-poziva");
    assert.equal((await s.z("POST", `${POT}/agent-naloga/dodeli`, { posiljatelj: ANA.id, ...telo })).status, 400);
    assert.deepEqual(s.klici.filter((k) => k.startsWith("dodeli")).length, 3);
  } finally {
    await s.ustavi();
  }
});

test("stanje in preklic s telefona: podpisana poizvedba in podpis veze id", async () => {
  const s = await streznik();
  try {
    assert.equal((await s.z("GET", q("/agent-naloge", ANA, podpisi(ANA, (c, e) => nizStanjaAgentNalog(ANA.id, c, e))))).status, 200);
    assert.equal((await s.z("GET", q("/agent-naloge", TUJA, podpisi(TUJA, (c, e) => nizStanjaAgentNalog(TUJA.id, c, e))))).status, 403);
    const p = podpisi(ANA, (c, e) => nizPreklicaAgentNaloge(ANA.id, "0123456789abcdef", c, e));
    assert.equal((await s.z("POST", `${POT}/agent-naloga/preklici`, { posiljatelj: ANA.id, id: "fedcba9876543210", ...p })).status, 403);
    const p2 = podpisi(ANA, (c, e) => nizPreklicaAgentNaloge(ANA.id, "0123456789abcdef", c, e));
    assert.equal((await s.z("POST", `${POT}/agent-naloga/preklici`, { posiljatelj: ANA.id, id: "0123456789abcdef", ...p2 })).status, 202);
    assert.deepEqual(s.klici, ["stanje", "preklici 0123456789abcdef"]);
  } finally {
    await s.ustavi();
  }
});

test("brez zaledja poti ne obstajajo (404); poti niso dovoljene prek oddaljenega prehoda", async () => {
  const s = await streznik({ brez: true });
  try {
    assert.equal((await s.z("GET", q("/agent-naloge", ANA, podpisi(ANA, (c, e) => nizStanjaAgentNalog(ANA.id, c, e))))).status, 404);
  } finally {
    await s.ustavi();
  }
  for (const [p, m] of [["/agent-naloge", "GET"], ["/agent-naloga/dodeli", "POST"], ["/agent-naloga/preklici", "POST"]]) assert.equal(POTI_ODDALJENO.get(`${POT}${p}`), m); // lastnik 25. 11. 2026: tudi prek Global Linka
});

test("zaledje telefona: prava vrsta, izvor »telefon«, ocena in opomnik v stanju za telefon, preklic", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-agenti-vrsta-"));
  const dom = path.join(dir, "dom");
  const projekt = path.join(dom, "projekt");
  const podatki = path.join(dir, "podatki");
  mkdirSync(projekt, { recursive: true });
  mkdirSync(podatki, { recursive: true });
  const token = await setupOwner("geslo-test-1234", podatki);
  await potrdiOpozorilo(podatki); // brez potrditve opozorila Lina agentov ne zaganja (opozorilo.test.ts)
  const o: Odvisnosti = {
    dom, platforma: "linux", najdi: (x) => (["xterm", "bwrap", ...AGENTI].includes(x as never) ? `/usr/bin/${x}` : null),
    preveriZagon: async () => ({ koda: 0, izpis: "1.0", potekel: false }), zazeni: async () => 1,
  };
  const ura = new Date(Date.now() + 60 * 60_000).toISOString();
  const { id } = await telefonDodeli(podatki, "pi", projekt, "S telefona.", `ura:${ura}`, o);
  const st = (await telefonStanjeNalog(podatki, o)) as { naloge: Array<{ id: string; izvor: string; stanje: string; agent: string; pogoj: unknown }> };
  assert.equal(st.naloge[0]!.id, id);
  assert.equal(st.naloge[0]!.izvor, "telefon");
  assert.equal(st.naloge[0]!.stanje, "dodeljeno");
  assert.equal(st.naloge[0]!.agent, "pi");
  assert.ok(!("porocilo" in st.naloge[0]!), "porocilo agenta ne gre na telefon");
  await telefonPreklici(podatki, id, o);
  assert.equal((await stanjeClaudeNalog(token, podatki, o)).naloge[0]!.stanje, "preklicano");
  await assert.rejects(telefonDodeli(podatki, "opencode", "../x", "x", "zdaj", o), { razlog: "mapa" });
});
