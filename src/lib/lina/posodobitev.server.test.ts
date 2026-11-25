/**
 * Vgrajena posodobitev Line (23. 11. 2026). Brez omrezja, brez pravega pkexec/dpkg: vse odvisnosti so vbrizgane, pravi spawn se
 * ne sme sproziti. Skripta se preizkusi samo z bash -n in --preveri (na tem racunalniku je Lina lahko namescena: brez --preveri
 * bi jo zaprla in odprla pkexec).
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setupOwner } from "./auth.server.ts";
import {
  JAVNI_KLJUC_IZDAJ,
  najnovejsiPaket,
  okoljeSkripte,
  podpisVeljaven,
  ponastaviPredpomnilnik,
  posodobitevTece,
  primerjajRazlicici,
  stanjeDrugihPaketov,
  stanjePosodobitve,
  vsotaIzSeznama,
  zacniPosodobitev,
  zacniPosodobitevIzGradnje,
  type Odvisnosti,
} from "./posodobitev.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-posodobitev-"));
after(() => rmSync(KOREN, { recursive: true, force: true }));
const SKRIPTA = path.resolve("scripts/lina-posodobi.sh");
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
/** Preizkusni kljuc izdaj (pregled 0213 A7): ustvarjen v preizkusu, nikoli pravi. */
const PREIZKUSNI = generateKeyPairSync("ed25519");
const PREIZKUSNI_JAVNI = PREIZKUSNI.publicKey.export({ type: "spki", format: "pem" }).toString();
const podpisi = (b: Buffer | string, kljuc = PREIZKUSNI.privateKey) => sign(null, Buffer.from(b), kljuc);

async function novaMapa(): Promise<{ dir: string; token: string }> {
  const dir = mkdtempSync(path.join(KOREN, "p-"));
  return { dir, token: await setupOwner("geslo-test-1234", dir) };
}

type Zagon = { program: string; argumenti: string[]; env: Record<string, string>; otrok: EventEmitter & { unref(): void } };

/** Lazni sistem: namescena razlicica, dpkg-deb za podane datoteke, zagon zapise argumente. */
function lazno(o: { namescena?: string; paketi?: Record<string, { paket: string; razlicica: string }>; dodatno?: Partial<Odvisnosti> } = {}) {
  const zagoni: Zagon[] = [];
  const odv: Odvisnosti = {
    platforma: "linux",
    arh: "x64",
    skripta: "/opt/Lina/resources/lina/posodobi.sh",
    obstaja: () => true,
    izvedi: async (program, argumenti) => {
      if (program === "/usr/bin/dpkg-query") {
        if (!o.namescena) throw new Error("ni namescena");
        return o.namescena;
      }
      if (program === "/usr/bin/dpkg-deb") {
        const p = o.paketi?.[argumenti[1]!];
        if (!p) throw new Error("ni paketa");
        return `Package: ${p.paket}\nVersion: ${p.razlicica}\n`;
      }
      throw new Error(`nepricakovan program ${program}`);
    },
    env: { DISPLAY: ":0", DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1/bus", HOME: "/tmp/h", ELECTRON_RUN_AS_NODE: "1", LINA_LUPINA_ZETON: "z".repeat(64), TWILIO_AUTH_TOKEN: "x", PATH: "/tmp/zlonamerno:/usr/bin" },
    zazeni: (program, argumenti, env) => {
      const otrok = Object.assign(new EventEmitter(), { unref() {} });
      zagoni.push({ program, argumenti, env, otrok });
      return otrok;
    },
    fetchFn: async () => {
      throw new Error("omrezje v preizkusu ni dovoljeno");
    },
    javniKljuc: PREIZKUSNI_JAVNI,
    ...o.dodatno,
  };
  return { odv, zagoni };
}

test("primerjava razlicic kot dpkg: 0.2.10 > 0.2.9, enaka, starejsa, epoha, revizija, tilda", () => {
  assert.ok(primerjajRazlicici("0.2.10", "0.2.9") > 0);
  assert.ok(primerjajRazlicici("0.2.9", "0.2.10") < 0);
  assert.equal(primerjajRazlicici("0.2.8", "0.2.8"), 0);
  assert.ok(primerjajRazlicici("0.2.5", "0.2.8") < 0);
  assert.ok(primerjajRazlicici("1.0", "0.99.99") > 0);
  assert.ok(primerjajRazlicici("1:0.1", "0.9") > 0);
  assert.ok(primerjajRazlicici("0.2.8-2", "0.2.8-1") > 0);
  assert.ok(primerjajRazlicici("1.0~rc1", "1.0") < 0);
  // Preverba z dpkg samim, ce je na voljo (samo branje).
  if (existsSync("/usr/bin/dpkg")) {
    for (const [a, b] of [["0.2.10", "0.2.9"], ["0.2.9", "0.2.10"], ["1.0~rc1", "1.0"], ["0.2.8-2", "0.2.8-1"], ["2.0a", "2.0"]]) {
      const gt = spawnSync("/usr/bin/dpkg", ["--compare-versions", a, "gt", b]).status === 0;
      assert.equal(primerjajRazlicici(a, b) > 0, gt, `${a} gt ${b}`);
    }
  }
});

test("lokalna mapa izbere najnovejso razlicico po dpkg, ne abecedno; tuje datoteke se prezrejo", () => {
  const n = najnovejsiPaket(["lina-lupina_0.2.9_amd64.deb", "lina-lupina_0.2.10_amd64.deb", "lina-lupina_0.2.8_amd64.deb", "drugo_9.9_amd64.deb", "lina-lupina_9.9_arm64.deb", "lina-lupina_x_amd64.deb"]);
  assert.deepEqual(n, { ime: "lina-lupina_0.2.10_amd64.deb", razlicica: "0.2.10" });
  assert.equal(najnovejsiPaket([]), null);
});

test("okolje skripte: samo namizje in jezik; XDG_ in LC_ ostaneta", () => {
  assert.deepEqual(okoljeSkripte({ XDG_RUNTIME_DIR: "/run/user/1", LC_ALL: "C", ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: "--require x" }), { XDG_RUNTIME_DIR: "/run/user/1", LC_ALL: "C", PATH: "/usr/bin:/bin" });
});

test("SHA256SUMS: vrstica za tocno ime (oba zapisa), tuje ime ne velja", () => {
  const h = "a".repeat(64);
  assert.equal(vsotaIzSeznama(`${"b".repeat(64)}  drugo.deb\n${h}  lina-lupina_0.3.0_amd64.deb\n`, "lina-lupina_0.3.0_amd64.deb"), h);
  assert.equal(vsotaIzSeznama(`${h} *lina-lupina_0.3.0_amd64.deb`, "lina-lupina_0.3.0_amd64.deb"), h);
  assert.equal(vsotaIzSeznama(`${h}  lina-lupina_0.3.0_amd64.deb.zlonamerno`, "lina-lupina_0.3.0_amd64.deb"), null);
});

test("vir B: novejsi paket iz mape -> zagon locenega procesa z absolutnimi potmi in preverjeno vsoto", async () => {
  const { dir, token } = await novaMapa();
  const mapa = mkdtempSync(path.join(KOREN, "izhod-"));
  for (const v of ["0.2.8", "0.2.9", "0.2.10"]) writeFileSync(path.join(mapa, `lina-lupina_${v}_amd64.deb`), `paket ${v}`);
  writeFileSync(path.join(dir, "posodobitev.json"), JSON.stringify({ mapa }));
  const deb = path.join(mapa, "lina-lupina_0.2.10_amd64.deb");
  // pregled 0213 A6: tudi vir »mapa« namesti zasebno kopijo v <podatki>/posodobitev (kot A-15 za gradnjo)
  const kopija = path.join(path.resolve(dir), "posodobitev", "lina-lupina_0.2.10_amd64.deb");
  const { odv, zagoni } = lazno({ namescena: "0.2.8", paketi: { [deb]: { paket: "lina-lupina", razlicica: "0.2.10" }, [kopija]: { paket: "lina-lupina", razlicica: "0.2.10" } } });

  const stanje = await stanjePosodobitve(token, dir, odv);
  assert.deepEqual(stanje, { naVoljo: true, namescena: "0.2.8", razpolozljiva: "0.2.10", vir: "mapa", novejsa: true, tece: false, napakaVira: false, zadnjiIzid: null });

  const izid = await zacniPosodobitev(token, dir, odv);
  assert.deepEqual(izid, { ok: true, razlicica: "0.2.10" });
  assert.equal(zagoni.length, 1);
  assert.equal(zagoni[0]!.program, "/bin/bash");
  assert.deepEqual(zagoni[0]!.argumenti, ["/opt/Lina/resources/lina/posodobi.sh", kopija, path.resolve(dir), sha("paket 0.2.10")]);
  assert.deepEqual(zagoni[0]!.env, { DISPLAY: ":0", DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1/bus", HOME: "/tmp/h", PATH: "/usr/bin:/bin" }, "brez ELECTRON_RUN_AS_NODE, zetona lupine in kljucev");
  assert.equal(posodobitevTece(), true, "dokler skripta tece, je zaklep zaprt");
  assert.deepEqual(await zacniPosodobitev(token, dir, odv), { ok: false, razlog: "ze_tece" });
  zagoni[0]!.otrok.emit("exit", 0);
  assert.equal(posodobitevTece(), false);
});

test("zavrnitev enake ali starejse razlicice (nikoli 0.2.5 cez 0.2.8)", async () => {
  const { dir, token } = await novaMapa();
  const mapa = mkdtempSync(path.join(KOREN, "izhod-"));
  writeFileSync(path.join(mapa, "lina-lupina_0.2.5_amd64.deb"), "star");
  writeFileSync(path.join(dir, "posodobitev.json"), JSON.stringify({ mapa }));
  for (const namescena of ["0.2.8", "0.2.5"]) {
    const { odv, zagoni } = lazno({ namescena, paketi: { [path.join(mapa, "lina-lupina_0.2.5_amd64.deb")]: { paket: "lina-lupina", razlicica: "0.2.5" } } });
    assert.equal((await stanjePosodobitve(token, dir, odv) as { novejsa: boolean }).novejsa, false);
    assert.deepEqual(await zacniPosodobitev(token, dir, odv), { ok: false, razlog: "ni_novejsa" });
    assert.equal(zagoni.length, 0);
  }
  assert.equal(posodobitevTece(), false, "zavrnitev sprosti zaklep");
});

test("napacno ime paketa ali razlicica v kontrolni datoteki se razlikuje od imena datoteke -> zavrnitev", async () => {
  const { dir, token } = await novaMapa();
  const mapa = mkdtempSync(path.join(KOREN, "izhod-"));
  const deb = path.join(mapa, "lina-lupina_0.3.0_amd64.deb");
  writeFileSync(deb, "x");
  writeFileSync(path.join(dir, "posodobitev.json"), JSON.stringify({ mapa }));
  for (const p of [{ paket: "zlonamerno", razlicica: "0.3.0" }, { paket: "lina-lupina", razlicica: "0.2.1" }]) {
    const { odv, zagoni } = lazno({ namescena: "0.2.8", paketi: { [deb]: p } });
    assert.deepEqual(await zacniPosodobitev(token, dir, odv), { ok: false, razlog: "napacen_paket" });
    assert.equal(zagoni.length, 0);
  }
});

test("gradnja na GitHubu (24. 11. 2026): namestitev iz mape gradnje s presledki gre skozi ista varovala; enaka razlicica = ni_novejsa", async () => {
  const { dir, token } = await novaMapa();
  const mapa = path.join(mkdtempSync(path.join(KOREN, "Lina gradnje-")), "2026-11-24 0905-racunalnik-main", "lina-deb");
  mkdirSync(mapa, { recursive: true });
  const deb = path.join(mapa, "lina-lupina_0.2.11_amd64.deb");
  writeFileSync(deb, "deb-gradnje");
  // posodobitev.json NE vpliva: vir je mapa gradnje, ki jo da streznik
  writeFileSync(path.join(dir, "posodobitev.json"), JSON.stringify({ mapa: "/etc" }));
  // pregled 0225 A-15: skripta dobi zasebno kopijo v <podatki>/posodobitev (0700), ne datoteke iz vidne mape gradnje
  const kopija = path.join(dir, "posodobitev", "lina-lupina_0.2.11_amd64.deb");
  const paketi = { [deb]: { paket: "lina-lupina", razlicica: "0.2.11" }, [kopija]: { paket: "lina-lupina", razlicica: "0.2.11" } };
  const a = lazno({ namescena: "0.2.10", paketi });
  const gradnja = { pot: deb, sha256: sha("deb-gradnje") };
  assert.deepEqual(await zacniPosodobitevIzGradnje(token, gradnja, dir, a.odv), { ok: true, razlicica: "0.2.11" });
  assert.deepEqual(a.zagoni[0]!.argumenti, ["/opt/Lina/resources/lina/posodobi.sh", kopija, dir, sha("deb-gradnje")]);
  assert.equal(readFileSync(kopija, "utf8"), "deb-gradnje");
  assert.equal(statSync(path.dirname(kopija)).mode & 0o777, 0o700);
  a.zagoni[0]!.otrok.emit("exit");
  const b = lazno({ namescena: "0.2.11", paketi });
  assert.deepEqual(await zacniPosodobitevIzGradnje(token, gradnja, dir, b.odv), { ok: false, razlog: "ni_novejsa" });
  assert.equal(b.zagoni.length, 0);
  await assert.rejects(zacniPosodobitevIzGradnje(null, gradnja, dir, b.odv));
  assert.deepEqual(await zacniPosodobitevIzGradnje(token, { pot: "relativna", sha256: gradnja.sha256 }, dir, b.odv), { ok: false, razlog: "pot" });
  // datoteka, spremenjena po gradnji, ali novejsa datoteka, dodana v mapo: nic se ne zazene
  const c = lazno({ namescena: "0.2.10", paketi: { ...paketi, [path.join(mapa, "lina-lupina_0.2.12_amd64.deb")]: { paket: "lina-lupina", razlicica: "0.2.12" } } });
  writeFileSync(deb, "podtaknjeno");
  assert.deepEqual(await zacniPosodobitevIzGradnje(token, gradnja, dir, c.odv), { ok: false, razlog: "vsota" });
  writeFileSync(deb, "deb-gradnje");
  writeFileSync(path.join(mapa, "lina-lupina_0.2.12_amd64.deb"), "drug");
  assert.deepEqual(await zacniPosodobitevIzGradnje(token, gradnja, dir, c.odv), { ok: false, razlog: "vsota" });
  // tudi z ENAKO vsebino: namesti se samo datoteka gradnje, ne druga datoteka v mapi
  writeFileSync(path.join(mapa, "lina-lupina_0.2.12_amd64.deb"), "deb-gradnje");
  assert.deepEqual(await zacniPosodobitevIzGradnje(token, gradnja, dir, c.odv), { ok: false, razlog: "vsota" });
  assert.equal(c.zagoni.length, 0);
});

test("pot z nadzornim znakom se ne preda skripti", async () => {
  const { dir, token } = await novaMapa();
  const mapa = mkdtempSync(path.join(KOREN, "izhod\n-"));
  writeFileSync(path.join(mapa, "lina-lupina_0.3.0_amd64.deb"), "x");
  writeFileSync(path.join(dir, "posodobitev.json"), JSON.stringify({ mapa }));
  const { odv, zagoni } = lazno({ namescena: "0.2.8" });
  assert.deepEqual(await zacniPosodobitev(token, dir, odv), { ok: false, razlog: "ni_vira" });
  assert.equal(zagoni.length, 0);
});

// --- Vir A: GitHub prek laznega fetch, pravi prenesiPreverjeno (dovoljeni gostitelji, preusmeritve).
/** podpis: privzeto preizkusni podpis cez vsote; null = izdaja brez SHA256SUMS.sig. */
function github(o: { deb: Buffer; vsote: string; preusmeri?: string; downloadUrl?: string; status?: number; podpis?: Buffer | null }) {
  const klici: string[] = [];
  const podpis = o.podpis === undefined ? podpisi(o.vsote) : o.podpis;
  const fetchFn = (async (u: string | URL) => {
    const url = String(u);
    klici.push(url);
    if (url === "https://api.github.com/repos/safeerOS/Lina/releases/latest") {
      if (o.status) return new Response("{}", { status: o.status });
      return Response.json({
        tag_name: "v0.3.0",
        assets: [
          { name: "lina-lupina_0.3.0_amd64.deb", browser_download_url: o.downloadUrl ?? "https://zlonamerno.example/x.deb" },
          { name: "SHA256SUMS", browser_download_url: "https://zlonamerno.example/SHA256SUMS" },
          ...(podpis ? [{ name: "SHA256SUMS.sig" }] : []),
        ],
      });
    }
    const gost = new URL(url).hostname;
    if (gost === "github.com") {
      const kam = o.preusmeri ?? "https://release-assets.githubusercontent.com/";
      return new Response(null, { status: 302, headers: { location: kam + path.basename(new URL(url).pathname) } });
    }
    if (gost === "release-assets.githubusercontent.com") {
      if (url.endsWith("SHA256SUMS.sig")) return podpis ? new Response(new Uint8Array(podpis)) : new Response("ni", { status: 404 });
      return new Response(url.endsWith("SHA256SUMS") ? o.vsote : new Uint8Array(o.deb));
    }
    if (gost === "zlonamerno.example") return new Response(new Uint8Array(o.deb));
    return new Response("ni", { status: 404 });
  }) as typeof fetch;
  return { fetchFn, klici };
}

test("vir A: prenos samo z github.com/safeerOS/Lina (ne browser_download_url), vsota se ujema -> zagon", async () => {
  ponastaviPredpomnilnik();
  const { dir, token } = await novaMapa();
  const deb = Buffer.from("pravi paket 0.3.0");
  const { fetchFn, klici } = github({ deb, vsote: `${sha(deb)}  lina-lupina_0.3.0_amd64.deb\n` });
  const koncna = path.join(path.resolve(dir), "posodobitev", "lina-lupina_0.3.0_amd64.deb");
  const { odv, zagoni } = lazno({ namescena: "0.2.8", paketi: { [koncna]: { paket: "lina-lupina", razlicica: "0.3.0" } }, dodatno: { fetchFn } });
  const izid = await zacniPosodobitev(token, dir, odv);
  assert.deepEqual(izid, { ok: true, razlicica: "0.3.0" });
  assert.ok(klici.includes("https://github.com/safeerOS/Lina/releases/download/v0.3.0/lina-lupina_0.3.0_amd64.deb"));
  assert.ok(klici.includes("https://github.com/safeerOS/Lina/releases/download/v0.3.0/SHA256SUMS"));
  assert.ok(!klici.some((k) => k.includes("zlonamerno")), "browser_download_url iz odgovora API se ne uporabi");
  assert.equal(readFileSync(koncna, "utf8"), "pravi paket 0.3.0");
  assert.deepEqual(zagoni[0]!.argumenti, ["/opt/Lina/resources/lina/posodobi.sh", koncna, path.resolve(dir), sha(deb)]);
  zagoni[0]!.otrok.emit("exit", 0);
});

test("vir A: neujemanje SHA-256 -> zavrnitev, prenesena datoteka se pobrise, ni zagona", async () => {
  ponastaviPredpomnilnik();
  const { dir, token } = await novaMapa();
  const deb = Buffer.from("podtaknjen paket");
  const { fetchFn } = github({ deb, vsote: `${"0".repeat(64)}  lina-lupina_0.3.0_amd64.deb\n` });
  const { odv, zagoni } = lazno({ namescena: "0.2.8", dodatno: { fetchFn } });
  assert.deepEqual(await zacniPosodobitev(token, dir, odv), { ok: false, razlog: "vsota" });
  assert.equal(zagoni.length, 0);
  assert.equal(existsSync(path.join(dir, "posodobitev", "lina-lupina_0.3.0_amd64.deb")), false);
  assert.equal(posodobitevTece(), false);
});

test("vir A: preusmeritev na nedovoljen gostitelj -> prenos zavrnjen", async () => {
  ponastaviPredpomnilnik();
  const { dir, token } = await novaMapa();
  const deb = Buffer.from("x");
  const { fetchFn, klici } = github({ deb, vsote: `${sha(deb)}  lina-lupina_0.3.0_amd64.deb\n`, preusmeri: "https://zlonamerno.example/" });
  const { odv, zagoni } = lazno({ namescena: "0.2.8", dodatno: { fetchFn } });
  assert.deepEqual(await zacniPosodobitev(token, dir, odv), { ok: false, razlog: "prenos" });
  assert.ok(!klici.some((k) => k.startsWith("https://zlonamerno.example")), "nedovoljen gostitelj ni bil poklican");
  assert.equal(zagoni.length, 0);
});

test("vir A: repozitorij brez izdaj (404) je miren izid, ne napaka", async () => {
  ponastaviPredpomnilnik();
  const { dir, token } = await novaMapa();
  const { fetchFn } = github({ deb: Buffer.from(""), vsote: "", status: 404 });
  const { odv } = lazno({ namescena: "0.2.8", dodatno: { fetchFn } });
  const s = await stanjePosodobitve(token, dir, odv);
  assert.equal(s.naVoljo && s.razpolozljiva, null);
  assert.equal(s.naVoljo && s.napakaVira, false);
});

test("ena posodobitev naenkrat: drugi klik med prenosom dobi ze_tece; napaka prenosa zaklep sprosti", async () => {
  ponastaviPredpomnilnik();
  const { dir, token } = await novaMapa();
  let sprosti!: () => void;
  const visi = new Promise<void>((r) => { sprosti = r; });
  const prenesi = async () => { await visi; throw new Error("prekinjeno"); };
  const { fetchFn } = github({ deb: Buffer.from("x"), vsote: "" });
  const { odv, zagoni } = lazno({ namescena: "0.2.8", dodatno: { fetchFn, prenesi } });
  const prvi = zacniPosodobitev(token, dir, odv);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(await zacniPosodobitev(token, dir, odv), { ok: false, razlog: "ze_tece" });
  sprosti();
  assert.deepEqual(await prvi, { ok: false, razlog: "prenos" });
  assert.equal(posodobitevTece(), false);
  assert.equal(zagoni.length, 0);
});

test("ne-Linux platforma: stanje »ni na voljo«, zagon nic ne zazene", async () => {
  const { dir, token } = await novaMapa();
  for (const [platforma, arh] of [["win32", "x64"], ["darwin", "arm64"], ["linux", "arm64"]] as const) {
    const { odv, zagoni } = lazno({ namescena: "0.2.8", dodatno: { platforma, arh } });
    assert.deepEqual(await stanjePosodobitve(token, dir, odv), { naVoljo: false, razlog: "platforma", zadnjiIzid: null });
    assert.deepEqual(await zacniPosodobitev(token, dir, odv), { ok: false, razlog: "platforma" });
    assert.equal(zagoni.length, 0);
  }
});

test("razvojni zagon brez skripte ali brez namescenega paketa: ni na voljo", async () => {
  const { dir, token } = await novaMapa();
  assert.equal((await stanjePosodobitve(token, dir, lazno({ namescena: "0.2.8", dodatno: { obstaja: () => false } }).odv) as { razlog: string }).razlog, "ni_skripte");
  assert.equal((await stanjePosodobitve(token, dir, lazno({}).odv) as { razlog: string }).razlog, "ni_namescena");
});

test("brez prijave lastnika ni ne stanja ne zagona", async () => {
  const { dir } = await novaMapa();
  const { odv, zagoni } = lazno({ namescena: "0.2.8" });
  await assert.rejects(() => stanjePosodobitve(null, dir, odv));
  await assert.rejects(() => zacniPosodobitev("napacen-zeton", dir, odv));
  assert.equal(zagoni.length, 0);
  assert.equal(posodobitevTece(), false);
});

test("zadnji izid iz posodobitev-izid.json; neveljavna vsebina se prezre", async () => {
  const { dir, token } = await novaMapa();
  const { odv } = lazno({ dodatno: { platforma: "win32" } });
  writeFileSync(path.join(dir, "posodobitev-izid.json"), JSON.stringify({ cas: "2026-11-23T10:00:00Z", razlicica: "0.2.9", ok: true, koda: "namesceno" }));
  assert.deepEqual((await stanjePosodobitve(token, dir, odv)).zadnjiIzid, { cas: "2026-11-23T10:00:00Z", razlicica: "0.2.9", ok: true, koda: "namesceno" });
  writeFileSync(path.join(dir, "posodobitev-izid.json"), JSON.stringify({ cas: "x", razlicica: "<script>", ok: true, koda: "namesceno" }));
  assert.equal((await stanjePosodobitve(token, dir, odv)).zadnjiIzid, null);
});

// --- Skripta: bash -n in --preveri na nadomestnih paketih (samo control, zgrajeni v zacasni mapi).
test("skripta: sintaksa, absolutni pkexec in dpkg, --koncaj namesto pkill", () => {
  execFileSync("/bin/bash", ["-n", SKRIPTA]);
  const besedilo = readFileSync(SKRIPTA, "utf8");
  assert.match(besedilo, /\/usr\/bin\/pkexec \/usr\/bin\/dpkg -i "\$DEB"/);
  assert.match(besedilo, /\/opt\/Lina\/lina-lupina --koncaj/);
  assert.doesNotMatch(besedilo, /^[^#]*\bpkill\b/m);
  assert.doesNotMatch(besedilo, /\/home\//);
  assert.match(besedilo, /unset ELECTRON_RUN_AS_NODE/);
  assert.match(besedilo, /setsid \/opt\/Lina\/lina-lupina [^\n]*9>&- &/, "nova Lina ne podeduje zaklepa flock");
});

function zgradiDeb(mapa: string, paket: string, razlicica: string): string {
  const koren = path.join(mapa, `${paket}-${razlicica}`);
  mkdirSync(path.join(koren, "DEBIAN"), { recursive: true });
  writeFileSync(path.join(koren, "DEBIAN", "control"), `Package: ${paket}\nVersion: ${razlicica}\nArchitecture: amd64\nMaintainer: Preizkus <preizkus@example.invalid>\nDescription: preizkus\n`);
  const deb = path.join(mapa, `lina-lupina_${razlicica}_amd64.deb`);
  execFileSync("/usr/bin/dpkg-deb", ["--root-owner-group", "-b", koren, deb], { stdio: "ignore" });
  return deb;
}

test("skripta --preveri: novejsi paket gre, tuje ime, napacna vsota in starejsa razlicica ne", { skip: !existsSync("/usr/bin/dpkg-deb") && "dpkg-deb ni na voljo" }, () => {
  const mapa = mkdtempSync(path.join(KOREN, "deb-"));
  const podatki = mkdtempSync(path.join(KOREN, "podatki-"));
  // Minimalno okolje: brez DISPLAY in DBUS, da --preveri zagotovo ne doseze namizja.
  const pozeni = (args: string[]) => spawnSync("/bin/bash", [SKRIPTA, "--preveri", ...args], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } });
  const nov = zgradiDeb(mapa, "lina-lupina", "999.0.0");
  const vsota = sha(readFileSync(nov));
  const namescena = spawnSync("/usr/bin/dpkg-query", ["-W", "-f=${Version}", "lina-lupina"], { encoding: "utf8" });
  const jeNamescena = namescena.status === 0 && namescena.stdout.trim() !== "";

  const r = pozeni([nov, podatki, vsota]);
  if (jeNamescena) {
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /nova: 999\.0\.0 .*ukaz: \/usr\/bin\/pkexec \/usr\/bin\/dpkg -i/);
  } else {
    assert.equal(r.status, 1, "brez namescene Line skripta nic ne namesti");
  }
  assert.notEqual(pozeni([nov, podatki, "f".repeat(64)]).status, 0, "napacna vsota");
  const tuj = zgradiDeb(mkdtempSync(path.join(KOREN, "deb-")), "drug-paket", "999.0.1");
  assert.notEqual(pozeni([tuj, podatki, sha(readFileSync(tuj))]).status, 0, "tuje ime paketa");
  const star = zgradiDeb(mkdtempSync(path.join(KOREN, "deb-")), "lina-lupina", "0.0.1");
  const rs = pozeni([star, podatki, sha(readFileSync(star))]);
  assert.notEqual(rs.status, 0, "starejsa razlicica");
  if (jeNamescena) assert.match(rs.stdout, /ni novejsi/);
  assert.equal(pozeni(["relativna.deb", podatki, vsota]).status, 2, "relativna pot");
  assert.equal(pozeni([nov, podatki]).status, 2, "manjka argument");
  // --preveri ne pise nicesar v podatkovno mapo (ne dnevnika ne izida).
  assert.deepEqual(execFileSync("/bin/ls", ["-A", podatki], { encoding: "utf8" }), "");
});

// --- 25. 11. 2026: Lina posodablja tudi druge Safeer programe (seznam dovoljenih), samo ce so namesceni.
/** Lazni sistem za vec paketov: namescene razlicice po imenu, izpis ps (etimes + ukaz). */
function laznoVec(o: { namescene: Record<string, string>; paketi?: Record<string, { paket: string; razlicica: string }>; ps?: string; dodatno?: Partial<Odvisnosti> }) {
  const zagoni: Zagon[] = [];
  const odv: Odvisnosti = {
    ...lazno().odv,
    izvedi: async (program, argumenti) => {
      if (program === "/usr/bin/dpkg-query") {
        const v = o.namescene[argumenti.at(-1)!];
        if (!v) throw new Error("ni namescen");
        return v;
      }
      if (program === "/usr/bin/dpkg-deb") {
        const p = o.paketi?.[argumenti[1]!];
        if (!p) throw new Error("ni paketa");
        return `Package: ${p.paket}\nVersion: ${p.razlicica}\n`;
      }
      if (program === "/usr/bin/ps") return o.ps ?? "";
      throw new Error(`nepricakovan program ${program}`);
    },
    zazeni: (program, argumenti, env) => {
      const otrok = Object.assign(new EventEmitter(), { unref() {} });
      zagoni.push({ program, argumenti, env, otrok });
      return otrok;
    },
    ...o.dodatno,
  };
  return { odv, zagoni };
}

test("neznan paket je zavrnjen (tudi imena lastnosti objekta), nic se ne zazene", async () => {
  const { dir, token } = await novaMapa();
  const { odv, zagoni } = laznoVec({ namescene: { "lina-lupina": "0.2.8", "drug-paket": "1.0" } });
  for (const ime of ["drug-paket", "constructor", "__proto__", "toString", "", "lina-lupina "]) {
    assert.deepEqual(await zacniPosodobitev(token, dir, odv, ime), { ok: false, razlog: "neznan_paket" }, ime);
  }
  assert.equal(zagoni.length, 0);
  assert.equal(posodobitevTece(), false);
});

test("safeer-os: starejsa ali enaka razlicica je zavrnjena", async () => {
  const { dir, token } = await novaMapa();
  const mapa = mkdtempSync(path.join(KOREN, "izhod-"));
  const deb = path.join(mapa, "safeer-os_0.4.95_amd64.deb");
  writeFileSync(deb, "star safeer");
  writeFileSync(path.join(dir, "posodobitev.json"), JSON.stringify({ mapa }));
  for (const v of ["0.4.96", "0.4.95"]) {
    const { odv, zagoni } = laznoVec({ namescene: { "lina-lupina": "0.2.11", "safeer-os": v }, paketi: { [deb]: { paket: "safeer-os", razlicica: "0.4.95" } } });
    assert.deepEqual(await zacniPosodobitev(token, dir, odv, "safeer-os"), { ok: false, razlog: "ni_novejsa" });
    assert.equal(zagoni.length, 0);
  }
});

test("safeer-os: paket Line v mapi ne velja za safeer-os in obratno (ime iz dpkg-deb -f)", async () => {
  const { dir, token } = await novaMapa();
  const mapa = mkdtempSync(path.join(KOREN, "izhod-"));
  const deb = path.join(mapa, "safeer-os_0.4.97_amd64.deb");
  writeFileSync(deb, "x");
  writeFileSync(path.join(mapa, "lina-lupina_9.9.9_amd64.deb"), "lina");
  writeFileSync(path.join(dir, "posodobitev.json"), JSON.stringify({ mapa }));
  const kopija = path.join(path.resolve(dir), "posodobitev", "safeer-os_0.4.97_amd64.deb");
  const napacen = { paket: "lina-lupina", razlicica: "0.4.97" };
  const { odv, zagoni } = laznoVec({ namescene: { "lina-lupina": "0.2.11", "safeer-os": "0.4.96" }, paketi: { [deb]: napacen, [kopija]: napacen } });
  assert.deepEqual(await zacniPosodobitev(token, dir, odv, "safeer-os"), { ok: false, razlog: "napacen_paket" });
  assert.equal(zagoni.length, 0);
});

test("pregled 0213 A6: vir »mapa« za safeer-os - skripta dobi zasebno kopijo (0700); zamenjava datoteke v vidni mapi po preverbi ne vpliva", async () => {
  const { dir, token } = await novaMapa();
  const mapa = mkdtempSync(path.join(KOREN, "izhod-"));
  const deb = path.join(mapa, "safeer-os_0.4.97_amd64.deb");
  writeFileSync(deb, "pravi safeer");
  writeFileSync(path.join(dir, "posodobitev.json"), JSON.stringify({ mapa }));
  const kopija = path.join(path.resolve(dir), "posodobitev", "safeer-os_0.4.97_amd64.deb");
  const p = { paket: "safeer-os", razlicica: "0.4.97" };
  const { odv, zagoni } = laznoVec({ namescene: { "lina-lupina": "0.2.11", "safeer-os": "0.4.96" }, paketi: { [deb]: p, [kopija]: p } });
  assert.deepEqual(await zacniPosodobitev(token, dir, odv, "safeer-os"), { ok: true, razlicica: "0.4.97" });
  assert.equal(zagoni[0]!.argumenti[1], kopija, "skripta (pkexec dpkg -i) dobi kopijo, ne datoteke v vidni mapi");
  assert.equal(zagoni[0]!.argumenti[3], sha("pravi safeer"));
  // napadalec zamenja datoteko v vidni mapi med preverbo in vnosom gesla v pkexec: namesti se vseeno preverjena kopija
  writeFileSync(deb, "tuj paket");
  assert.equal(readFileSync(kopija, "utf8"), "pravi safeer");
  assert.equal(statSync(path.dirname(kopija)).mode & 0o777, 0o700);
  zagoni[0]!.otrok.emit("exit", 0);
});

function githubSafeer(o: { deb: Buffer; vsote: string; podpis?: Buffer | null }) {
  const klici: string[] = [];
  const podpis = o.podpis === undefined ? podpisi(o.vsote) : o.podpis;
  const fetchFn = (async (u: string | URL) => {
    const url = String(u);
    klici.push(url);
    if (url === "https://api.github.com/repos/safeerOS/Safeer-linux/releases/latest") {
      return Response.json({ tag_name: "v0.4.97", assets: [{ name: "safeer-os-tema_9.9.9_all.deb" }, { name: "safeer-os_0.4.97_amd64.deb" }, { name: "lina-lupina_9.9.9_amd64.deb" }, { name: "SHA256SUMS" }, ...(podpis ? [{ name: "SHA256SUMS.sig" }] : [])] });
    }
    const gost = new URL(url).hostname;
    if (gost === "github.com") return new Response(null, { status: 302, headers: { location: "https://release-assets.githubusercontent.com/" + path.basename(new URL(url).pathname) } });
    if (gost === "release-assets.githubusercontent.com") {
      if (url.endsWith("SHA256SUMS.sig")) return podpis ? new Response(new Uint8Array(podpis)) : new Response("ni", { status: 404 });
      return new Response(url.endsWith("SHA256SUMS") ? o.vsote : new Uint8Array(o.deb));
    }
    return new Response("ni", { status: 404 });
  }) as typeof fetch;
  return { fetchFn, klici };
}

test("safeer-os z GitHuba (safeerOS/Safeer-linux): napacna SHA je zavrnjena, prava gre v skripto z imenom paketa", async () => {
  ponastaviPredpomnilnik();
  const { dir, token } = await novaMapa();
  const deb = Buffer.from("safeer-os 0.4.97");
  const koncna = path.join(path.resolve(dir), "posodobitev", "safeer-os_0.4.97_amd64.deb");
  const slab = githubSafeer({ deb, vsote: `${"0".repeat(64)}  safeer-os_0.4.97_amd64.deb\n` });
  const a = laznoVec({ namescene: { "lina-lupina": "0.2.11", "safeer-os": "0.4.96" }, paketi: { [koncna]: { paket: "safeer-os", razlicica: "0.4.97" } }, dodatno: { fetchFn: slab.fetchFn } });
  assert.deepEqual(await zacniPosodobitev(token, dir, a.odv, "safeer-os"), { ok: false, razlog: "vsota" });
  assert.equal(a.zagoni.length, 0);
  assert.equal(existsSync(koncna), false);

  ponastaviPredpomnilnik();
  const dober = githubSafeer({ deb, vsote: `${sha(deb)}  safeer-os_0.4.97_amd64.deb\n` });
  const b = laznoVec({ namescene: { "lina-lupina": "0.2.11", "safeer-os": "0.4.96" }, paketi: { [koncna]: { paket: "safeer-os", razlicica: "0.4.97" } }, dodatno: { fetchFn: dober.fetchFn } });
  assert.deepEqual(await zacniPosodobitev(token, dir, b.odv, "safeer-os"), { ok: true, razlicica: "0.4.97" });
  assert.ok(dober.klici.includes("https://github.com/safeerOS/Safeer-linux/releases/download/v0.4.97/safeer-os_0.4.97_amd64.deb"));
  assert.ok(!dober.klici.some((k) => k.includes("/safeerOS/Lina/")), "vir safeer-os ni repozitorij Line");
  assert.deepEqual(b.zagoni[0]!.argumenti, ["/opt/Lina/resources/lina/posodobi.sh", koncna, path.resolve(dir), sha(deb), "safeer-os"]);
  b.zagoni[0]!.otrok.emit("exit", 0);
});

test("nenamescen paket se ne prikaze; Lina brez drugih Safeer programov nima ne napake ne praznih vrstic", async () => {
  ponastaviPredpomnilnik();
  const { dir, token } = await novaMapa();
  const fetchFn = (async () => { throw new Error("omrezje ni dovoljeno"); }) as typeof fetch;
  const brez = laznoVec({ namescene: { "lina-lupina": "0.2.11" }, dodatno: { fetchFn } });
  assert.deepEqual(await stanjeDrugihPaketov(token, dir, brez.odv), []);
  assert.equal((await stanjePosodobitve(token, dir, brez.odv)).naVoljo, true, "posodobitev Line deluje brez Safeer OS");
  const z = laznoVec({ namescene: { "lina-lupina": "0.2.11", "safeer-os": "0.4.96" }, dodatno: { fetchFn } });
  const s = await stanjeDrugihPaketov(token, dir, z.odv);
  assert.equal(s.length, 1);
  assert.equal(s[0]!.paket, "safeer-os");
  assert.equal(s[0]!.namescena, "0.4.96");
  assert.equal(s[0]!.napakaVira, true);
  assert.equal(s[0]!.zamenjava, null, "brez namestitve iz Line ni cakanja na zamenjavo");
  // ne-Linux: nic
  assert.deepEqual(await stanjeDrugihPaketov(token, dir, laznoVec({ namescene: { "safeer-os": "0.4.96" }, dodatno: { platforma: "win32" } }).odv), []);
  await assert.rejects(() => stanjeDrugihPaketov(null, dir, z.odv));
});

test("izid safeer-os je v svoji datoteki (ne kaze se kot izid Line)", async () => {
  const { dir, token } = await novaMapa();
  writeFileSync(path.join(dir, "posodobitev-izid-safeer-os.json"), JSON.stringify({ cas: "2026-11-25T05:43:00Z", razlicica: "0.4.96", ok: true, koda: "namesceno" }));
  const { odv } = laznoVec({ namescene: { "lina-lupina": "0.2.11" } });
  assert.equal((await stanjePosodobitve(token, dir, odv)).zadnjiIzid, null);
});

test("Safeer OS po namestitvi: caka 120 s, nato brez novega procesa gumb; nov proces = zaznana zamenjava", async () => {
  ponastaviPredpomnilnik();
  const { dir, token } = await novaMapa();
  const T = Date.parse("2026-11-25T05:43:00Z");
  writeFileSync(path.join(dir, "posodobitev-izid-safeer-os.json"), JSON.stringify({ cas: "2026-11-25T05:43:00Z", razlicica: "0.4.96", ok: true, koda: "namesceno" }));
  const fetchFn = (async () => { throw new Error("omrezje ni dovoljeno"); }) as typeof fetch;
  const stari = "  6300 /usr/bin/python3 -s /usr/lib/safeer-os/core/varuh_procesov.py --delovna\n  6300 /usr/bin/python3 -s /usr/lib/safeer-os/safeer_os.py --delovna\n";
  const zamenjava = async (zdaj: number, ps: string) =>
    (await stanjeDrugihPaketov(token, dir, laznoVec({ namescene: { "safeer-os": "0.4.96" }, ps, dodatno: { fetchFn, zdaj: () => zdaj } }).odv))[0]!.zamenjava;
  assert.equal(await zamenjava(T + 60_000, stari), "caka");
  assert.equal(await zamenjava(T + 121_000, stari), "ni_zaznana");
  assert.equal(await zamenjava(T + 121_000, ""), "ne_tece", "Safeer OS ne tece: ne trdimo, da ni preklopil");
  // varuh (isti PID zaganjalnika) ne steje; steje samo safeer_os.py, zagnan po namestitvi
  assert.equal(await zamenjava(T + 300_000, "  10 /usr/bin/python3 -s /usr/lib/safeer-os/core/varuh_procesov.py --delovna\n  6600 /usr/bin/python3 -s /usr/lib/safeer-os/safeer_os.py --delovna\n"), "ni_zaznana");
  assert.equal(await zamenjava(T + 300_000, "  200 /usr/bin/python3 -s /usr/lib/safeer-os/safeer_os.py --delovna\n"), "zaznana");
});

test("Safeer OS: ko ne tece, ni »ni preklopil«; napaka ps ni »ne tece«; v strezniku ni signalov ne zagona Safeer OS", async () => {
  const { dir, token } = await novaMapa();
  const T = Date.parse("2026-11-25T05:43:00Z");
  writeFileSync(path.join(dir, "posodobitev-izid-safeer-os.json"), JSON.stringify({ cas: "2026-11-25T05:43:00Z", razlicica: "0.4.96", ok: true, koda: "namesceno" }));
  const fetchFn = (async () => { throw new Error("omrezje ni dovoljeno"); }) as typeof fetch;
  const ne = laznoVec({ namescene: { "safeer-os": "0.4.96" }, ps: "  6300 /usr/bin/python3 -s /usr/lib/safeer-os/core/varuh_procesov.py --delovna\n", dodatno: { fetchFn, zdaj: () => T + 300_000 } });
  assert.equal((await stanjeDrugihPaketov(token, dir, ne.odv))[0]!.zamenjava, "ne_tece");
  const brezPs = laznoVec({ namescene: { "safeer-os": "0.4.96" }, dodatno: { fetchFn, zdaj: () => T + 300_000 } });
  const izvedi = brezPs.odv.izvedi!;
  brezPs.odv.izvedi = async (program, argumenti) => { if (program === "/usr/bin/ps") throw new Error("ps ni uspel"); return izvedi(program, argumenti); };
  assert.equal((await stanjeDrugihPaketov(token, dir, brezPs.odv))[0]!.zamenjava, "ni_zaznana");
  assert.equal(ne.zagoni.length + brezPs.zagoni.length, 0);
  const koda = readFileSync(path.resolve("src/lib/lina/posodobitev.server.ts"), "utf8");
  assert.doesNotMatch(koda, /process\.kill|\bpkill\b|SIGTERM|SIGKILL|"\/usr\/bin\/safeer-os"/);
});

test("skripta --preveri za safeer-os: neznan paket (4. argument), tuje ime v paketu, napacna vsota", { skip: !existsSync("/usr/bin/dpkg-deb") && "dpkg-deb ni na voljo" }, () => {
  const mapa = mkdtempSync(path.join(KOREN, "deb-"));
  const podatki = mkdtempSync(path.join(KOREN, "podatki-"));
  const pozeni = (args: string[]) => spawnSync("/bin/bash", [SKRIPTA, "--preveri", ...args], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } });
  const nov = zgradiDeb(mapa, "safeer-os", "999.0.0");
  const vsota = sha(readFileSync(nov));
  assert.equal(pozeni([nov, podatki, vsota, "drug-paket"]).status, 2, "paket ni na seznamu");
  assert.notEqual(pozeni([nov, podatki, vsota]).status, 0, "deb safeer-os ni paket Line");
  assert.notEqual(pozeni([nov, podatki, "f".repeat(64), "safeer-os"]).status, 0, "napacna vsota");
  const lina = zgradiDeb(mkdtempSync(path.join(KOREN, "deb-")), "lina-lupina", "999.0.0");
  assert.notEqual(pozeni([lina, podatki, sha(readFileSync(lina)), "safeer-os"]).status, 0, "deb Line ni safeer-os");
  const namescen = spawnSync("/usr/bin/dpkg-query", ["-W", "-f=${Version}", "safeer-os"], { encoding: "utf8" });
  const r = pozeni([nov, podatki, vsota, "safeer-os"]);
  if (namescen.status === 0 && namescen.stdout.trim() !== "") {
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /paket: safeer-os .*nova: 999\.0\.0 .*ukaz: \/usr\/bin\/pkexec \/usr\/bin\/dpkg -i/);
    assert.doesNotMatch(r.stdout, /lina-lupina --koncaj/);
  } else {
    assert.equal(r.status, 1, "nenamescen safeer-os se ne namesti");
  }
  assert.deepEqual(execFileSync("/bin/ls", ["-A", podatki], { encoding: "utf8" }), "");
});

// --- Pregled 0213 A7 (25. 11. 2026): SHA256SUMS mora biti podpisan s kljucem Safeer (Ed25519), preden se uporabi katerakoli vsota.
const ODTIS_KLJUCA = "a3ae3bcb5b6de559199ee5212bf04d9b25c9e45ea499b635f7869821971a0b56";
const URL_DEB_LINE = "https://github.com/safeerOS/Lina/releases/download/v0.3.0/lina-lupina_0.3.0_amd64.deb";

test("A7: vgrajeni javni kljuc izdaj je Ed25519 s pricakovanim odtisom (SHA-256 DER)", () => {
  const k = createPublicKey(JAVNI_KLJUC_IZDAJ);
  assert.equal(k.asymmetricKeyType, "ed25519");
  assert.equal(sha(k.export({ type: "spki", format: "der" })), ODTIS_KLJUCA);
});

test("A7: podpisVeljaven - samo surov 64-bajtni podpis pravega kljuca cez tocne bajte", () => {
  const vsote = Buffer.from(`${"a".repeat(64)}  lina-lupina_0.3.0_amd64.deb\n`);
  const pravi = podpisi(vsote);
  assert.equal(podpisVeljaven(vsote, pravi, PREIZKUSNI_JAVNI), true);
  assert.equal(podpisVeljaven(Buffer.concat([vsote, Buffer.from("\n")]), pravi, PREIZKUSNI_JAVNI), false, "spremenjen SHA256SUMS");
  assert.equal(podpisVeljaven(vsote, podpisi(vsote, generateKeyPairSync("ed25519").privateKey), PREIZKUSNI_JAVNI), false, "drug kljuc");
  assert.equal(podpisVeljaven(vsote, Buffer.alloc(64, 7), PREIZKUSNI_JAVNI), false, "nakljucni podpis");
  assert.equal(podpisVeljaven(vsote, pravi.subarray(0, 63), PREIZKUSNI_JAVNI), false, "prekratek");
  assert.equal(podpisVeljaven(vsote, Buffer.from(pravi.toString("base64")), PREIZKUSNI_JAVNI), false, "base64 ni dogovorjena oblika");
  assert.equal(podpisVeljaven(vsote, Buffer.alloc(0), PREIZKUSNI_JAVNI), false, "prazen");
  assert.equal(podpisVeljaven(vsote, pravi, "ni kljuc"), false, "pokvarjen kljuc ne vrze");
  const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 }).publicKey.export({ type: "spki", format: "pem" }).toString();
  assert.equal(podpisVeljaven(vsote, pravi, rsa), false, "samo Ed25519");
});

test("A7: podpis iz `openssl pkeyutl -sign -rawin` (kot v podpis-izdaje.yml) Lina sprejme", { skip: !existsSync("/usr/bin/openssl") && "openssl ni na voljo" }, () => {
  const mapa = mkdtempSync(path.join(KOREN, "openssl-"));
  const zasebni = path.join(mapa, "k.pem");
  const vsote = path.join(mapa, "SHA256SUMS");
  writeFileSync(vsote, `${"b".repeat(64)}  safeer-os_0.4.97_amd64.deb\n`);
  execFileSync("/usr/bin/openssl", ["genpkey", "-algorithm", "ed25519", "-out", zasebni]);
  execFileSync("/usr/bin/openssl", ["pkeyutl", "-sign", "-rawin", "-inkey", zasebni, "-in", vsote, "-out", vsote + ".sig"]);
  const javni = execFileSync("/usr/bin/openssl", ["pkey", "-in", zasebni, "-pubout"], { encoding: "utf8" });
  assert.equal(readFileSync(vsote + ".sig").length, 64);
  assert.equal(podpisVeljaven(readFileSync(vsote), readFileSync(vsote + ".sig"), javni), true);
  assert.equal(podpisVeljaven(readFileSync(vsote), readFileSync(vsote + ".sig"), PREIZKUSNI_JAVNI), false);
});

/** Zavrnjena izdaja: razlog podpis, paket .deb se NE prenese (vsota se ni uporabila), ni zagona, zaklep sproscen. */
async function zavrnjenoZaradiPodpisa(gh: { podpis?: Buffer | null; vsote?: string; deb?: Buffer }, dodatno: Partial<Odvisnosti> = {}) {
  ponastaviPredpomnilnik();
  const { dir, token } = await novaMapa();
  const deb = gh.deb ?? Buffer.from("paket 0.3.0");
  const { fetchFn, klici } = github({ deb, vsote: gh.vsote ?? `${sha(deb)}  lina-lupina_0.3.0_amd64.deb\n`, podpis: gh.podpis });
  const koncna = path.join(path.resolve(dir), "posodobitev", "lina-lupina_0.3.0_amd64.deb");
  const { odv, zagoni } = lazno({ namescena: "0.2.8", paketi: { [koncna]: { paket: "lina-lupina", razlicica: "0.3.0" } }, dodatno: { fetchFn, ...dodatno } });
  assert.deepEqual(await zacniPosodobitev(token, dir, odv), { ok: false, razlog: "podpis" });
  assert.ok(!klici.includes(URL_DEB_LINE), "paket se ne prenese pred veljavnim podpisom");
  assert.equal(zagoni.length, 0);
  assert.equal(existsSync(koncna), false);
  assert.equal(posodobitevTece(), false);
  return klici;
}

test("A7: izdaja brez SHA256SUMS.sig -> zavrnjeno (podpis), paket se ne prenese", async () => {
  const klici = await zavrnjenoZaradiPodpisa({ podpis: null });
  assert.ok(!klici.some((k) => k.endsWith(".sig")), "sredstva .sig ni, zato ga ne prenasamo");
});

test("A7: napacen podpis (nakljucni bajti) -> zavrnjeno", async () => {
  await zavrnjenoZaradiPodpisa({ podpis: Buffer.alloc(64, 1) });
});

test("A7: podpis drugega kljuca -> zavrnjeno", async () => {
  const deb = Buffer.from("paket 0.3.0");
  const vsote = `${sha(deb)}  lina-lupina_0.3.0_amd64.deb\n`;
  await zavrnjenoZaradiPodpisa({ deb, vsote, podpis: podpisi(vsote, generateKeyPairSync("ed25519").privateKey) });
});

test("A7: spremenjen SHA256SUMS (podpis je za izvirnik) -> zavrnjeno, ceprav nova vsota ustreza paketu", async () => {
  const pravi = Buffer.from("pravi paket");
  const podtaknjen = Buffer.from("podtaknjen paket");
  const podpis = podpisi(`${sha(pravi)}  lina-lupina_0.3.0_amd64.deb\n`);
  await zavrnjenoZaradiPodpisa({ deb: podtaknjen, vsote: `${sha(podtaknjen)}  lina-lupina_0.3.0_amd64.deb\n`, podpis });
});

test("A7: privzeto velja SAMO vgrajeni kljuc Safeer (preizkusni podpis brez vbrizganega kljuca je zavrnjen)", async () => {
  await zavrnjenoZaradiPodpisa({}, { javniKljuc: undefined });
});

test("A7: safeer-os brez podpisa ali s tujim podpisom -> zavrnjeno, s pravim gre v skripto", async () => {
  const deb = Buffer.from("safeer-os 0.4.97");
  const vsote = `${sha(deb)}  safeer-os_0.4.97_amd64.deb\n`;
  for (const podpis of [null, podpisi(vsote, generateKeyPairSync("ed25519").privateKey)]) {
    ponastaviPredpomnilnik();
    const { dir, token } = await novaMapa();
    const koncna = path.join(path.resolve(dir), "posodobitev", "safeer-os_0.4.97_amd64.deb");
    const gh = githubSafeer({ deb, vsote, podpis });
    const a = laznoVec({ namescene: { "lina-lupina": "0.2.11", "safeer-os": "0.4.96" }, paketi: { [koncna]: { paket: "safeer-os", razlicica: "0.4.97" } }, dodatno: { fetchFn: gh.fetchFn } });
    assert.deepEqual(await zacniPosodobitev(token, dir, a.odv, "safeer-os"), { ok: false, razlog: "podpis" });
    assert.ok(!gh.klici.some((k) => k.endsWith(".deb")), "paket safeer-os se ne prenese");
    assert.equal(a.zagoni.length, 0);
  }
});

test("A7: nepodpisana izdaja se v stanju se vedno pokaze (razlog pove sele zagon), vir mapa ostane brez podpisa", async () => {
  ponastaviPredpomnilnik();
  const { dir, token } = await novaMapa();
  const { fetchFn } = github({ deb: Buffer.from("x"), vsote: "", podpis: null });
  const s = await stanjePosodobitve(token, dir, lazno({ namescena: "0.2.8", dodatno: { fetchFn } }).odv);
  assert.equal(s.naVoljo && s.razpolozljiva, "0.3.0");
  assert.equal(s.naVoljo && s.napakaVira, false);
});

test("A7: vmesnik - razlog podpis ima svoje besedilo (sl+en), vir mapa in gradnja povesta, da podpisa ni", () => {
  const besedila = readFileSync(path.resolve("src/lib/lina/besedila.ts"), "utf8");
  assert.match(besedila, /posNapakaPodpis: "Izdaja ni podpisana s ključem Safeer/);
  assert.match(besedila, /posNapakaPodpis: "The release is not signed with the Safeer key/);
  assert.equal(besedila.match(/posBrezPodpisa: "/g)?.length, 2);
  assert.match(besedila, /ghNamestiPotrdi: "[^"]*nima podpisa Safeer/);
  assert.match(besedila, /ghNamestiPotrdi: "[^"]*not signed with the Safeer key/);
  const desk = readFileSync(path.resolve("src/components/lina-desk.tsx"), "utf8");
  assert.match(desk, /r === "podpis" \? t\("posNapakaPodpis"\)/);
  assert.equal(desk.match(/t\("posBrezPodpisa"\)/g)?.length, 2, "Lina in drugi programi");
});

test("A7: podpis-izdaje.yml - okolje podpis-izdaj, odtis kljuca, oznaka ne gre v lupino neposredno, kljuc v trap", () => {
  const yml = readFileSync(path.resolve(".github/workflows/podpis-izdaje.yml"), "utf8");
  assert.match(yml, /environment: podpis-izdaj/);
  assert.match(yml, new RegExp(ODTIS_KLJUCA));
  assert.match(yml, /openssl pkeyutl -sign -rawin/);
  assert.match(yml, /trap /);
  assert.match(yml, /PODPIS_IZDAJ_KLJUC/);
  for (const v of yml.split("\n").filter((l) => /^\s+(run:|[^:#]*\$\{\{)/.test(l) && !/^\s+[A-Z_]+: \$\{\{/.test(l) && !/^\s+(if|group|environment|run-name):/.test(l))) {
    assert.doesNotMatch(v, /\$\{\{/, `izraz GitHub naravnost v ukazu: ${v.trim()}`);
  }
  for (const u of yml.match(/uses: \S+/g) ?? []) assert.match(u, /@[0-9a-f]{40}$/, `akcija ni pripeta na SHA: ${u}`);
});
