/**
 * Naloga 18 (lastnik 25. 11. 2026 23:25 »Da«): ko lastnik na telefonu potrdi nalogo za Claude Code in seja kanala ni odprta, jo Lina na
 * racunalniku odpre sama (terminal, stalen ukaz). Naloga se ne zadrzi (kanal zavrne podpis, starejsi od svojega zagona, kanal-claude.server.ts
 * preveriDokaz »dokaz.cas < this.zagnan«): odgovor 503 s stanje.zagon = "odpira", telefon jo po odprtju podpise in poslje znova. Zagon sprozi SAMO
 * podpisana naloga naprave ozjega kroga (pot /naloga, po preverbi podpisa); nepodpisana, tuja, ponovljena zahteva ali poizvedba /stanje
 * ne zazene nicesar. Pravi TLS in podpisi kot asistent-streznik.test.ts; izvajalec in zagon seje sta lazna.
 */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Dogodek, Izvajalec, Naloga } from "./asistent.server.ts";
import { AsistentStreznik, POT, potrdiloAsistenta, type IzidOdpiranjaSeje } from "./asistent-streznik.server.ts";
import { idIzKljuca, nizDodelitveAgentNaloge, nizNaloge, nizStanja, zgostitevDodelitve, type Dokaz } from "./kanal-claude.ts";
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
const idNaloge = () => randomBytes(18).toString("base64url");
function podpisi(d: Naprava, niz: (c: number, e: string) => string, cas = Date.now()): Dokaz {
  const e = enkratni();
  return { cas, enkratni: e, podpis: sign("sha256", Buffer.from(niz(cas, e)), d.zasebni).toString("base64") };
}
const naloga = (d: Naprava, id: string, besedilo: string, podpisnik = d) =>
  ({ id, posiljatelj: d.id, besedilo, ...podpisi(podpisnik, (c, e) => nizNaloge(id, d.id, besedilo, c, e)) });
const premor = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Odgovor = { status: number; telo: any };
function zahteva(vrata: number, cert: string, odtis: string, metoda: string, pot: string, telo?: unknown): Promise<Odgovor> {
  return new Promise((ok, ne) => {
    const r = request({
      host: "127.0.0.1", port: vrata, method: metoda, path: pot, ca: cert, rejectUnauthorized: true,
      checkServerIdentity: (_h, c) => (c.fingerprint256.replace(/:/g, "").toLowerCase() === odtis ? undefined : new Error("odtis")),
      headers: telo === undefined ? {} : { "content-type": "application/json" },
    }, (res) => {
      const k: Buffer[] = [];
      res.on("data", (x) => k.push(x));
      res.on("end", () => {
        const s = Buffer.concat(k).toString("utf8");
        let j: unknown = s;
        try { j = JSON.parse(s); } catch { /* ni JSON */ }
        ok({ status: res.statusCode ?? 0, telo: j });
      });
    });
    r.on("error", ne);
    r.end(telo === undefined ? undefined : JSON.stringify(telo));
  });
}

/** Seja je zaprta, dokler je lazni zagon ne »odpre« (odpri = true). */
function seja(izid: IzidOdpiranjaSeje = { ok: true }) {
  const st = { odprta: false, zagonov: 0, predane: [] as Naloga[], dogodek: new Map<string, (d: Dogodek) => void>() };
  const iz: Izvajalec = {
    ime: "lazni",
    razpolozljiv: async () => st.odprta,
    zacni: async (n, cb) => {
      if (!st.odprta) throw new Error("seja ni odprta");
      st.predane.push(n);
      st.dogodek.set(n.id, cb);
    },
    odobri: async () => {},
    ustavi: async () => {},
  };
  const odpri = async (): Promise<IzidOdpiranjaSeje> => {
    st.zagonov++;
    return izid;
  };
  return { st, iz, odpri };
}

async function streznik(o: { odpri?: () => Promise<IzidOdpiranjaSeje>; iz: Izvajalec; dodeljene?: string[] }) {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-n18-"));
  await pripraviKanal([{ id: ANA.id, kljuc: ANA.kljuc }], dir);
  const s = new AsistentStreznik({
    root: dir, izvajalec: o.iz, dnevnik: () => {}, odpriSejoClaude: o.odpri,
    agentiNaloge: {
      stanje: async () => ({ naloge: [] }),
      dodeli: async (agent) => { o.dodeljene?.push(String(agent)); return { id: "0123456789abcdef" }; },
      preklici: async () => {},
    },
  });
  const { vrata, odtis } = await s.zazeni();
  const { cert } = await potrdiloAsistenta(dir);
  await premor(5); // podpis mora biti po zagonu streznika
  return { z: (m: string, p: string, t?: unknown) => zahteva(vrata, cert, odtis, m, p, t), pospravi: async () => { await s.ustavi(); await rm(dir, { recursive: true, force: true }); } };
}

test("podpisana naloga, seja zaprta: Lina odpre sejo, odgovor 503 »odpira« (nic se ne preda); po odprtju sveze podpisana naloga 202", async () => {
  const sj = seja();
  const { z, pospravi } = await streznik({ odpri: sj.odpri, iz: sj.iz });
  try {
    const r = await z("POST", `${POT}/naloga`, naloga(ANA, idNaloge(), "preveri git status"));
    assert.equal(r.status, 503, JSON.stringify(r.telo));
    assert.equal(r.telo.napaka, "claude-code-ni");
    assert.deepEqual(r.telo.stanje, { claudeCode: "zaprta", zagon: "odpira" });
    assert.equal(sj.st.zagonov, 1);
    assert.equal(sj.st.predane.length, 0, "naloga podpisana pred zagonom kanala se ne preda (kanal bi jo zavrnil)");
    sj.st.odprta = true;
    const id = idNaloge();
    assert.equal((await z("POST", `${POT}/naloga`, naloga(ANA, id, "preveri git status"))).status, 202);
    assert.deepEqual(sj.st.predane.map((n) => n.id), [id]);
    assert.equal(sj.st.zagonov, 1, "odprta seja: brez novega zagona");
  } finally {
    await pospravi();
  }
});

test("ni terminala / ni claude / opozorilo: 503 z razlogom zagona za telefon; brez odpiranja (stikalo izklopljeno) 503 brez razloga", async () => {
  for (const razlog of ["ni-terminala", "ni-claude", "opozorilo", "omejitev"] as const) {
    const sj = seja({ ok: false, razlog });
    const { z, pospravi } = await streznik({ odpri: sj.odpri, iz: sj.iz });
    try {
      const r = await z("POST", `${POT}/naloga`, naloga(ANA, idNaloge(), "x"));
      assert.equal(r.status, 503);
      assert.equal(r.telo.napaka, "claude-code-ni");
      assert.deepEqual(r.telo.stanje, { claudeCode: "zaprta", zagon: razlog });
    } finally {
      await pospravi();
    }
  }
  const sj = seja();
  const { z, pospravi } = await streznik({ iz: sj.iz });
  try {
    const r = await z("POST", `${POT}/naloga`, naloga(ANA, idNaloge(), "x"));
    assert.equal(r.status, 503);
    assert.deepEqual(r.telo.stanje, { claudeCode: "zaprta" });
  } finally {
    await pospravi();
  }
});

test("varnost: nepodpisana, tuja naprava, podpis v imenu druge, ponovljena IDENTICNA zahteva in podpisan /stanje ne odprejo seje", async () => {
  const sj = seja();
  const { z, pospravi } = await streznik({ odpri: sj.odpri, iz: sj.iz });
  try {
    assert.equal((await z("POST", `${POT}/naloga`, { id: idNaloge(), posiljatelj: ANA.id, besedilo: "x" })).status, 400);
    assert.equal((await z("POST", `${POT}/naloga`, naloga(TUJA, idNaloge(), "x"))).status, 403);
    assert.equal((await z("POST", `${POT}/naloga`, naloga(ANA, idNaloge(), "x", TUJA))).status, 403);
    const p = podpisi(ANA, (c, e) => nizStanja(ANA.id, c, e));
    const st = await z("GET", `${POT}/stanje?posiljatelj=${ANA.id}&cas=${p.cas}&enkratni=${p.enkratni}&podpis=${encodeURIComponent(p.podpis)}`);
    assert.equal(st.telo.claudeCode, "zaprta");
    assert.equal(sj.st.zagonov, 0);
    // prva podpisana zahteva odpre sejo; ista zahteva (isti enkratni niz) znova je zavrnjena in ne odpre nicesar
    const telo = naloga(ANA, idNaloge(), "x");
    assert.equal((await z("POST", `${POT}/naloga`, telo)).status, 503);
    assert.equal(sj.st.zagonov, 1);
    assert.equal((await z("POST", `${POT}/naloga`, telo)).status, 403);
    assert.equal(sj.st.zagonov, 1);
  } finally {
    await pospravi();
  }
});

for (const agent of ["claude", "agy", "opencode", "grok", "pi"]) {
  test(`varnost ${agent}: dodelitev s telefona - nepodpisana, tuja naprava in ponovitev ne dosezejo zaledja; podpisana da`, async () => {
    const sj = seja();
    const dodeljene: string[] = [];
    const { z, pospravi } = await streznik({ odpri: sj.odpri, iz: sj.iz, dodeljene });
    try {
      const telo = { agent, mapa: "/home/a/projekt", besedilo: "Naloga s telefona", pogoj: "zdaj" };
      const zg = zgostitevDodelitve(telo.agent, telo.mapa, telo.besedilo, telo.pogoj);
      assert.equal((await z("POST", `${POT}/agent-naloga/dodeli`, { posiljatelj: ANA.id, ...telo })).status, 400);
      const tuja = podpisi(TUJA, (c, e) => nizDodelitveAgentNaloge(TUJA.id, zg, c, e));
      assert.equal((await z("POST", `${POT}/agent-naloga/dodeli`, { posiljatelj: TUJA.id, ...telo, ...tuja })).status, 403);
      const vImenu = podpisi(TUJA, (c, e) => nizDodelitveAgentNaloge(ANA.id, zg, c, e));
      assert.equal((await z("POST", `${POT}/agent-naloga/dodeli`, { posiljatelj: ANA.id, ...telo, ...vImenu })).status, 403);
      assert.deepEqual(dodeljene, []);
      const ok = { posiljatelj: ANA.id, ...telo, ...podpisi(ANA, (c, e) => nizDodelitveAgentNaloge(ANA.id, zg, c, e)) };
      assert.equal((await z("POST", `${POT}/agent-naloga/dodeli`, ok)).status, 202);
      assert.equal((await z("POST", `${POT}/agent-naloga/dodeli`, ok)).status, 403, "ponovitev");
      assert.deepEqual(dodeljene, [agent]);
      assert.equal(sj.st.zagonov, 0, "dodelitev agentu ne odpre seje kanala");
    } finally {
      await pospravi();
    }
  });
}
