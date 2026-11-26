/**
 * Naloga 18 (lastnik 25. 11. 2026 23:25 »Da«): ko lastnik na telefonu potrdi nalogo za Claude Code in seja kanala ni odprta, jo Lina na
 * racunalniku odpre sama (terminal, stalen ukaz) in nalogo preda, ko se seja poveze; racunalnik ga ne caka se enkrat. Zagon sprozi SAMO
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
import { idIzKljuca, nizDogodkov, nizNaloge, nizStanja, type Dokaz } from "./kanal-claude.ts";
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
async function caka(pogoj: () => boolean, ms = 5000): Promise<void> {
  const konec = Date.now() + ms;
  while (!pogoj()) {
    if (Date.now() > konec) throw new Error("rok cakanja potekel");
    await premor(20);
  }
}

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

async function streznik(o: { odpri?: () => Promise<IzidOdpiranjaSeje>; iz: Izvajalec; rokCakanjaSeje?: number }) {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-n18-"));
  await pripraviKanal([{ id: ANA.id, kljuc: ANA.kljuc }], dir);
  const s = new AsistentStreznik({ root: dir, izvajalec: o.iz, dnevnik: () => {}, odpriSejoClaude: o.odpri, rokCakanjaSeje: o.rokCakanjaSeje });
  const { vrata, odtis } = await s.zazeni();
  const { cert } = await potrdiloAsistenta(dir);
  await premor(5); // podpis mora biti po zagonu streznika
  return { z: (m: string, p: string, t?: unknown) => zahteva(vrata, cert, odtis, m, p, t), pospravi: async () => { await s.ustavi(); await rm(dir, { recursive: true, force: true }); } };
}
const dogodkiUrl = (d: Naprava, id: string) => {
  const p = podpisi(d, (c, e) => nizDogodkov(id, d.id, c, e));
  return `${POT}/dogodki?id=${id}&posiljatelj=${d.id}&cas=${p.cas}&enkratni=${p.enkratni}&podpis=${encodeURIComponent(p.podpis)}`;
};

test("podpisana naloga, seja zaprta: Lina odpre sejo ENKRAT, sprejme nalogo (202) in jo preda, ko se seja poveze", async () => {
  const sj = seja();
  const { z, pospravi } = await streznik({ odpri: sj.odpri, iz: sj.iz });
  try {
    const id = idNaloge();
    const r = await z("POST", `${POT}/naloga`, naloga(ANA, id, "preveri git status"));
    assert.equal(r.status, 202, JSON.stringify(r.telo));
    assert.equal(sj.st.zagonov, 1);
    // druga naloga med odpiranjem: tudi zadrzana (en terminal naenkrat zagotovi seja-claude.server.ts, naloga-18-odpri-sejo.test.ts)
    const id2 = idNaloge();
    assert.equal((await z("POST", `${POT}/naloga`, naloga(ANA, id2, "druga naloga"))).status, 202);
    assert.equal(sj.st.predane.length, 0, "pred odprtjem seje se nic ne preda");
    // telefon vidi, da Lina odpira sejo
    const d = await z("GET", dogodkiUrl(ANA, id));
    assert.match(JSON.stringify(d.telo), /odpira/i);
    sj.st.odprta = true;
    await caka(() => sj.st.predane.length === 2);
    assert.deepEqual(sj.st.predane.map((n) => n.id).sort(), [id, id2].sort());
    assert.equal(sj.st.predane.find((n) => n.id === id)!.besedilo, "preveri git status");
  } finally {
    await pospravi();
  }
});

test("seja se ne odpre v roku: izid z razlogom na telefonu, naloga ni predana (podpis naloge velja samo 2 min)", async () => {
  const sj = seja();
  const { z, pospravi } = await streznik({ odpri: sj.odpri, iz: sj.iz, rokCakanjaSeje: 300 });
  try {
    const id = idNaloge();
    assert.equal((await z("POST", `${POT}/naloga`, naloga(ANA, id, "x"))).status, 202);
    await premor(700);
    const d = await z("GET", dogodkiUrl(ANA, id));
    const izid = (d.telo.dogodki as Array<{ vrsta: string; ok?: boolean }>).find((x) => x.vrsta === "izid");
    assert.ok(izid && izid.ok === false, JSON.stringify(d.telo));
    sj.st.odprta = true;
    await premor(100);
    assert.equal(sj.st.predane.length, 0);
  } finally {
    await pospravi();
  }
});

test("ni terminala / ni claude: 503 z razlogom zagona za telefon; brez odpiranja (stikalo izklopljeno) 503 kot prej", async () => {
  for (const razlog of ["ni-terminala", "ni-claude"] as const) {
    const sj = seja({ ok: false, razlog });
    const { z, pospravi } = await streznik({ odpri: sj.odpri, iz: sj.iz });
    try {
      const r = await z("POST", `${POT}/naloga`, naloga(ANA, idNaloge(), "x"));
      assert.equal(r.status, 503);
      assert.equal(r.telo.napaka, "claude-code-ni");
      assert.equal(r.telo.stanje?.claudeCode, "zaprta");
      assert.equal(r.telo.stanje?.zagon, razlog);
    } finally {
      await pospravi();
    }
  }
  const sj = seja();
  const { z, pospravi } = await streznik({ iz: sj.iz });
  try {
    const r = await z("POST", `${POT}/naloga`, naloga(ANA, idNaloge(), "x"));
    assert.equal(r.status, 503);
  } finally {
    await pospravi();
  }
});

test("varnost: nepodpisana, tuja naprava, napacen podpis, ponovljena zahteva in podpisan /stanje ne odprejo seje", async () => {
  const sj = seja();
  const { z, pospravi } = await streznik({ odpri: sj.odpri, iz: sj.iz });
  try {
    const id = idNaloge();
    // nepodpisana
    assert.notEqual((await z("POST", `${POT}/naloga`, { id, posiljatelj: ANA.id, besedilo: "x" })).status, 202);
    // tuja naprava (ni v ozjem krogu) s svojim podpisom
    assert.equal((await z("POST", `${POT}/naloga`, naloga(TUJA, idNaloge(), "x"))).status, 403);
    // tuja naprava podpise v imenu ANE
    assert.equal((await z("POST", `${POT}/naloga`, naloga(ANA, idNaloge(), "x", TUJA))).status, 403);
    // podpisana poizvedba stanja ne odpre seje
    const p = podpisi(ANA, (c, e) => nizStanja(ANA.id, c, e));
    const st = await z("GET", `${POT}/stanje?posiljatelj=${ANA.id}&cas=${p.cas}&enkratni=${p.enkratni}&podpis=${encodeURIComponent(p.podpis)}`);
    assert.equal(st.telo.claudeCode, "zaprta");
    assert.equal(sj.st.zagonov, 0);
    // ponovljena podpisana zahteva (isti enkratni niz): druga ne odpre seje znova
    const telo = naloga(ANA, idNaloge(), "x");
    assert.equal((await z("POST", `${POT}/naloga`, telo)).status, 202);
    assert.equal(sj.st.zagonov, 1);
    assert.notEqual((await z("POST", `${POT}/naloga`, { ...telo, id: idNaloge() })).status, 202);
    assert.equal(sj.st.zagonov, 1);
  } finally {
    await pospravi();
  }
});
