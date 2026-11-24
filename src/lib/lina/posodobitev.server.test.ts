/**
 * Vgrajena posodobitev Line (23. 11. 2026). Brez omrezja, brez pravega pkexec/dpkg: vse odvisnosti so vbrizgane, pravi spawn se
 * ne sme sproziti. Skripta se preizkusi samo z bash -n in --preveri (na tem racunalniku je Lina lahko namescena: brez --preveri
 * bi jo zaprla in odprla pkexec).
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setupOwner } from "./auth.server.ts";
import {
  najnovejsiPaket,
  okoljeSkripte,
  ponastaviPredpomnilnik,
  posodobitevTece,
  primerjajRazlicici,
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
  const { odv, zagoni } = lazno({ namescena: "0.2.8", paketi: { [deb]: { paket: "lina-lupina", razlicica: "0.2.10" } } });

  const stanje = await stanjePosodobitve(token, dir, odv);
  assert.deepEqual(stanje, { naVoljo: true, namescena: "0.2.8", razpolozljiva: "0.2.10", vir: "mapa", novejsa: true, tece: false, napakaVira: false, zadnjiIzid: null });

  const izid = await zacniPosodobitev(token, dir, odv);
  assert.deepEqual(izid, { ok: true, razlicica: "0.2.10" });
  assert.equal(zagoni.length, 1);
  assert.equal(zagoni[0]!.program, "/bin/bash");
  assert.deepEqual(zagoni[0]!.argumenti, ["/opt/Lina/resources/lina/posodobi.sh", deb, path.resolve(dir), sha("paket 0.2.10")]);
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
function github(o: { deb: Buffer; vsote: string; preusmeri?: string; downloadUrl?: string; status?: number }) {
  const klici: string[] = [];
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
        ],
      });
    }
    const gost = new URL(url).hostname;
    if (gost === "github.com") {
      const kam = o.preusmeri ?? "https://release-assets.githubusercontent.com/";
      return new Response(null, { status: 302, headers: { location: kam + path.basename(new URL(url).pathname) } });
    }
    if (gost === "release-assets.githubusercontent.com") {
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
