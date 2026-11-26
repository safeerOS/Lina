/**
 * Naloga 28 (lastnik 26. 11. 2026): Lina sama preveri izdajo na GitHubu (ob zagonu z zamikom, nato vsakih 6 h), z ETag in
 * eksponentnim odmikom po napakah (brez hitrega ponavljanja), stikalo privzeto vklopljeno; obvestilo nosi samo novejso razlicico
 * in ocisceno besedilo opomb izdaje. Brez omrezja: fetch, casovnik in sistem so vbrizgani.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createPublicKey } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setupOwner } from "./auth.server.ts";
import { JAVNI_KLJUC_IZDAJ, podpisVeljaven, ponastaviPredpomnilnik, type Odvisnosti } from "./posodobitev.server.ts";
import {
  NAJVEC_OPOMB,
  OBDOBJE_PREVERBE_MS,
  ZAMIK_ZAGONA_MS,
  nastaviSamodejno,
  obvestiloPosodobitve,
  ocistiOpombe,
  preveriEnkrat,
  samodejnoVklopljeno,
  stanjeSamodejne,
  ustaviSamodejnoPreverbo,
  zamikPoNapakah,
  zazeniSamodejnoPreverbo,
} from "./posodobitev-samodejno.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-pos-samodejno-"));
after(() => rmSync(KOREN, { recursive: true, force: true }));

async function novaMapa(): Promise<{ dir: string; token: string }> {
  const dir = mkdtempSync(path.join(KOREN, "p-"));
  return { dir, token: await setupOwner("geslo-test-1234", dir) };
}

type Klic = { url: string; glave: Record<string, string> };
/** GitHub v preizkusu: zaporedje odgovorov; vsak klic zapise naslov in glave. */
function laznGithub(odgovori: Array<() => Response>) {
  const klici: Klic[] = [];
  const fetchFn = (async (u: string | URL, init?: RequestInit) => {
    const glave: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (glave[k] = v));
    klici.push({ url: String(u), glave });
    const naslednji = odgovori.shift();
    if (!naslednji) throw new Error("ni vec odgovorov");
    return naslednji();
  }) as typeof fetch;
  return { fetchFn, klici };
}

const izdaja = (razlicica: string, body = "Novo: hitrejsi odziv.", etag = '"e1"') => () =>
  new Response(
    JSON.stringify({
      tag_name: `v${razlicica}`,
      body,
      assets: [{ name: `lina-lupina_${razlicica}_amd64.deb` }, { name: "SHA256SUMS" }, { name: "SHA256SUMS.sig" }],
    }),
    { status: 200, headers: { etag } },
  );

function sistem(namescena: string, fetchFn: typeof fetch, dodatno: Partial<Odvisnosti> = {}): Odvisnosti {
  return {
    platforma: "linux",
    arh: "x64",
    skripta: "/opt/Lina/resources/lina/posodobi.sh",
    obstaja: () => true,
    izvedi: async (program) => {
      if (program === "/usr/bin/dpkg-query") return namescena;
      throw new Error(`nepricakovan program ${program}`);
    },
    fetchFn,
    ...dodatno,
  };
}

test("n28: stikalo je privzeto vklopljeno, izklop se shrani, napacna vrednost in tuj zeton sta zavrnjena", async () => {
  const { dir, token } = await novaMapa();
  assert.equal(await samodejnoVklopljeno(dir), true);
  assert.deepEqual(await nastaviSamodejno(token, false, dir), { samodejno: false });
  assert.equal(await samodejnoVklopljeno(dir), false);
  await assert.rejects(nastaviSamodejno(token, "ne", dir));
  await assert.rejects(nastaviSamodejno("tuj-zeton", true, dir));
  assert.equal(await samodejnoVklopljeno(dir), false, "zavrnjena zahteva ne spremeni stikala");
  assert.deepEqual(await nastaviSamodejno(token, true, dir), { samodejno: true });
  assert.equal(await samodejnoVklopljeno(dir), true);
});

test("n28: novejsa izdaja da obvestilo z razlicico in opombami; enaka ali starejsa ne", async () => {
  ponastaviPredpomnilnik();
  const { dir, token } = await novaMapa();
  const gh = laznGithub([izdaja("0.2.14", "Kaj je novega:\nposodobitev z enim klikom")]);
  assert.equal(await preveriEnkrat(dir, sistem("0.2.13", gh.fetchFn)), "ok");
  assert.equal(gh.klici[0]!.url, "https://api.github.com/repos/safeerOS/Lina/releases/latest");
  const o = await obvestiloPosodobitve(token, dir);
  assert.equal(o.samodejno, true);
  assert.equal(o.razlicica, "0.2.14");
  assert.equal(o.opombe, "Kaj je novega:\nposodobitev z enim klikom");

  ponastaviPredpomnilnik();
  const { dir: d2, token: t2 } = await novaMapa();
  const enaka = laznGithub([izdaja("0.2.13")]);
  assert.equal(await preveriEnkrat(d2, sistem("0.2.13", enaka.fetchFn)), "ok");
  assert.equal((await obvestiloPosodobitve(t2, d2)).razlicica, null, "enaka razlicica ni posodobitev");
  ponastaviPredpomnilnik();
  const starejsa = laznGithub([izdaja("0.2.9")]);
  assert.equal(await preveriEnkrat(d2, sistem("0.2.13", starejsa.fetchFn)), "ok");
  assert.equal((await obvestiloPosodobitve(t2, d2)).razlicica, null, "0.2.9 je starejsa od 0.2.13 (ne abecedno)");
  await assert.rejects(obvestiloPosodobitve("tuj-zeton", d2));
});

test("n28: druga preverba poslje If-None-Match; 304 obdrzi znano izdajo", async () => {
  ponastaviPredpomnilnik();
  const { dir, token } = await novaMapa();
  const gh = laznGithub([izdaja("0.2.14", "x", 'W/"abc"'), () => new Response(null, { status: 304 })]);
  const s = sistem("0.2.13", gh.fetchFn);
  assert.equal(await preveriEnkrat(dir, s), "ok");
  assert.equal(gh.klici[0]!.glave["if-none-match"], undefined, "prva zahteva nima ETag");
  assert.equal(await preveriEnkrat(dir, s), "ok");
  assert.equal(gh.klici.length, 2, "druga preverba res vprasa GitHub (ne samo predpomnilnik)");
  assert.equal(gh.klici[1]!.glave["if-none-match"], 'W/"abc"');
  assert.equal((await obvestiloPosodobitve(token, dir)).razlicica, "0.2.14");
});

test("n28: napaka omrezja, 403 in 429 so napake z odmikom; uspeh odmik ponastavi", async () => {
  ponastaviPredpomnilnik();
  const { dir } = await novaMapa();
  const gh = laznGithub([
    () => {
      throw new Error("ECONNRESET");
    },
    () => new Response("rate", { status: 403 }),
    () => new Response("rate", { status: 429 }),
    izdaja("0.2.14"),
  ]);
  const s = sistem("0.2.13", gh.fetchFn);
  assert.equal(await preveriEnkrat(dir, s), "napaka");
  assert.equal(stanjeSamodejne(dir).napakZapored, 1);
  assert.equal(await preveriEnkrat(dir, s), "napaka");
  assert.equal(await preveriEnkrat(dir, s), "napaka");
  assert.equal(stanjeSamodejne(dir).napakZapored, 3);
  assert.equal(await preveriEnkrat(dir, s), "ok");
  assert.equal(stanjeSamodejne(dir).napakZapored, 0);
});

test("n28: odmik po napakah je eksponenten, nikoli krajsi od obdobja in omejen", () => {
  assert.equal(OBDOBJE_PREVERBE_MS, 6 * 3600_000);
  assert.equal(zamikPoNapakah(0), OBDOBJE_PREVERBE_MS);
  assert.equal(zamikPoNapakah(1), 2 * OBDOBJE_PREVERBE_MS);
  assert.equal(zamikPoNapakah(2), 4 * OBDOBJE_PREVERBE_MS);
  assert.equal(zamikPoNapakah(50), 4 * OBDOBJE_PREVERBE_MS);
});

test("n28: izklopljeno stikalo in vir »mapa« ne vprasata GitHuba", async () => {
  ponastaviPredpomnilnik();
  const { dir, token } = await novaMapa();
  await nastaviSamodejno(token, false, dir);
  const gh = laznGithub([]);
  assert.equal(await preveriEnkrat(dir, sistem("0.2.13", gh.fetchFn)), "preskoceno");
  assert.equal(gh.klici.length, 0);
  assert.equal((await obvestiloPosodobitve(token, dir)).samodejno, false);

  const { dir: d2, token: t2 } = await novaMapa();
  const mapa = mkdtempSync(path.join(KOREN, "gradnje-"));
  writeFileSync(path.join(d2, "posodobitev.json"), JSON.stringify({ mapa }));
  const gh2 = laznGithub([]);
  assert.equal(await preveriEnkrat(d2, sistem("0.2.13", gh2.fetchFn, { beriMapo: async () => ["lina-lupina_0.2.20_amd64.deb"] })), "ok");
  assert.equal(gh2.klici.length, 0, "vir mapa: brez omrezja");
  assert.equal((await obvestiloPosodobitve(t2, d2)).razlicica, "0.2.20");
});

test("n28: izklop pobrise ze najdeno obvestilo", async () => {
  ponastaviPredpomnilnik();
  const { dir, token } = await novaMapa();
  await preveriEnkrat(dir, sistem("0.2.13", laznGithub([izdaja("0.2.14")]).fetchFn));
  assert.equal((await obvestiloPosodobitve(token, dir)).razlicica, "0.2.14");
  await nastaviSamodejno(token, false, dir);
  assert.equal((await obvestiloPosodobitve(token, dir)).razlicica, null);
});

test("n28: opombe izdaje so golo besedilo brez nadzornih in nevidnih znakov, omejene dolzine", () => {
  const z = (...k: number[]) => String.fromCodePoint(...k);
  assert.equal(ocistiOpombe(`a${z(0x202e)}b${z(0x200b)}c${z(0x07)}d${z(0xfeff)}e${z(0x2066)}f${z(0xe0041)}g${z(0xad)}h`), "abcdefgh");
  assert.equal(ocistiOpombe("vrstica 1\r\nvrstica 2\tx"), "vrstica 1\nvrstica 2 x");
  assert.equal(ocistiOpombe(`a${z(0x2028)}b`), "a\nb");
  assert.equal(ocistiOpombe("a\n\n\n\n\nb"), "a\n\nb");
  assert.equal(ocistiOpombe(`a${String.fromCharCode(0xd800)}b`), "ab", "osamljen nadomestek");
  assert.equal(ocistiOpombe(42), "");
  assert.equal(ocistiOpombe(null), "");
  const dolgo = ocistiOpombe("x".repeat(NAJVEC_OPOMB * 3));
  assert.ok(dolgo.length <= NAJVEC_OPOMB, `dolzina ${dolgo.length}`);
  assert.ok(dolgo.endsWith("…"));
});

test("n28: skupni vektor podpisa (isti kot PosodobitevGithubTest.kt na telefonu) in odtis vgrajenega kljuca", () => {
  const v = JSON.parse(readFileSync(new URL("./vektorji-posodobitev-v1.json", import.meta.url), "utf8")) as Record<string, string>;
  const pem = `-----BEGIN PUBLIC KEY-----\n${v.javniSpkiB64}\n-----END PUBLIC KEY-----\n`;
  const vsebina = Buffer.from(v.vsebinaB64!, "base64");
  const podpis = Buffer.from(v.podpisB64!, "base64");
  assert.equal(podpisVeljaven(vsebina, podpis, pem), true);
  const spremenjeno = Buffer.from(vsebina);
  spremenjeno[3] = (spremenjeno[3]! + 1) & 0xff;
  assert.equal(podpisVeljaven(spremenjeno, podpis, pem), false);
  assert.equal(podpisVeljaven(vsebina, podpis, JAVNI_KLJUC_IZDAJ), false, "tuj kljuc");
  const der = createPublicKey(JAVNI_KLJUC_IZDAJ).export({ type: "spki", format: "der" });
  assert.equal(createHash("sha256").update(der).digest("hex"), v.odtisPravegaKljuca);
});

test("n28: casovnik - prva preverba z zamikom po zagonu, po napaki ne prej kot odmik; samo namescena lupina", async () => {
  ponastaviPredpomnilnik();
  const { dir } = await novaMapa();
  const zamiki: number[] = [];
  const cakajoci: Array<() => void> = [];
  const casovnik = {
    nastavi: (fn: () => void, ms: number) => {
      zamiki.push(ms);
      cakajoci.push(fn);
      return { unref() {} };
    },
    pocisti: () => undefined,
  };
  const gh = laznGithub([() => {
    throw new Error("omrezje");
  }]);
  // razvojni streznik (brez lupine): nic se ne zazene
  assert.equal(zazeniSamodejnoPreverbo(dir, { odvisnosti: sistem("0.2.13", gh.fetchFn), casovnik, env: {}, izvedljiva: "/usr/bin/node" }), false);
  assert.equal(zamiki.length, 0);
  assert.equal(zazeniSamodejnoPreverbo(dir, { odvisnosti: sistem("0.2.13", gh.fetchFn), casovnik, env: { ELECTRON_RUN_AS_NODE: "1" }, izvedljiva: "/opt/Lina/lina-lupina" }), true);
  assert.equal(zazeniSamodejnoPreverbo(dir, { odvisnosti: sistem("0.2.13", gh.fetchFn), casovnik, env: { ELECTRON_RUN_AS_NODE: "1" }, izvedljiva: "/opt/Lina/lina-lupina" }), false, "drugic za isto mapo ne");
  assert.deepEqual(zamiki, [ZAMIK_ZAGONA_MS]);
  assert.equal(gh.klici.length, 0, "ob zagonu se GitHub ne vprasa takoj");
  cakajoci.shift()!();
  for (let i = 0; i < 50 && zamiki.length < 2; i++) await new Promise((r) => setImmediate(r));
  assert.equal(gh.klici.length, 1);
  assert.deepEqual(zamiki, [ZAMIK_ZAGONA_MS, zamikPoNapakah(1)], "po napaki omrezja naslednja preverba sele po odmiku");
  ustaviSamodejnoPreverbo(dir);
});
