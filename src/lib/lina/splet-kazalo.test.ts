/**
 * Ucenje o podjetju s strani (lastnik 23. 11. 2026): »lina naj prebere stvari ki so kljucne od podjetja in ki klicatelja
 * najbolj zanimajo«. splet.ts prebere kazalo (sitemap iz robots.txt ali /sitemap.xml, indeks en nivo), strani razvrsti po
 * pomembnosti (o nas, storitve, cenik, kontakt ... pred novicami) in ohrani mejo MEJA_STRANI. Brez kazala ostane branje po
 * povezavah. Lazni streznik, brez omrezja; tudi zlonamerna kazala (ogromno, tuj gostitelj, preusmeritev drugam, zanka).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MEJA_KAZALO_BAJTOV,
  MEJA_KAZALO_DATOTEK,
  MEJA_STRANI,
  preberiStran,
  ROK_KAZALA_MS,
  ROK_SKUPAJ_MS,
  ROK_ZAHTEVE_MS,
  razvrstiPoPomembnosti,
  type SpletOdgovor,
  type SpletOdv,
  type SpletZahteva,
} from "./splet.ts";

const H = "mizar.example";

function odgovor(status: number, glave: Record<string, string>, telo: string): SpletOdgovor {
  return { status, glave, telo: (async function* () { yield new TextEncoder().encode(telo); })(), prekini: () => undefined };
}

const html = (naslov: string, povezave: string[] = []) =>
  `<html><head><title>${naslov}</title></head><body><h1>${naslov}</h1><p>Besedilo strani ${naslov} za klicatelje.</p>${povezave
    .map((p) => `<a href="${p}">${p}</a>`)
    .join(" ")}</body></html>`;
const urlset = (poti: string[], gost = H) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${poti.map((p) => `<url><loc>https://${gost}${p}</loc></url>`).join("")}</urlset>`;
const indeks = (poti: string[], gost = H) =>
  `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${poti.map((p) => `<sitemap><loc>https://${gost}${p}</loc></sitemap>`).join("")}</sitemapindex>`;

type Streznik = Record<string, () => SpletOdgovor>;

function lazni(poti: Streznik): { odv: SpletOdv; zahteve: SpletZahteva[] } {
  const zahteve: SpletZahteva[] = [];
  return {
    zahteve,
    odv: {
      razresi: async () => ["93.184.216.34"],
      povezava: async (z) => {
        zahteve.push(z);
        const f = poti[`${z.gostitelj}${z.pot}`];
        if (f) return f();
        if (z.pot.endsWith(".xml") || z.pot === "/robots.txt") return odgovor(404, { "content-type": "text/plain" }, "");
        return odgovor(200, { "content-type": "text/html" }, html(z.pot));
      },
    },
  };
}

/** Poti HTML strani v vrstnem redu zahtev (brez robots.txt in kazal). */
const straniZahtev = (z: SpletZahteva[]) => z.filter((x) => x.pot !== "/robots.txt" && !x.pot.endsWith(".xml")).map((x) => x.pot);

const NOVICE = Array.from({ length: 30 }, (_, i) => `/novice/clanek-${i + 1}`);
const KLJUCNE = ["/o-nas", "/storitve", "/cenik", "/kontakt", "/delovni-cas", "/pogosta-vprasanja", "/lokacija", "/dostava", "/izdelki/mize"];

describe("razvrstiPoPomembnosti", () => {
  it("kljucne strani prve, novice/blog/reference zadnje, sicer plitvejsa pot in vrstni red kazala", () => {
    const vhod = [`${H}/novice/nov-cenik`, `${H}/galerija/slike/stare`, `${H}/blog/a`, `${H}/kontakt`, `${H}/galerija`, `${H}/o-nas`, `${H}/reference`, `${H}/storitve/rezanje`];
    assert.deepEqual(razvrstiPoPomembnosti(vhod), [
      `${H}/kontakt`,
      `${H}/o-nas`,
      `${H}/storitve/rezanje`,
      `${H}/galerija`,
      `${H}/galerija/slike/stare`,
      `${H}/reference`,
      `${H}/novice/nov-cenik`,
      `${H}/blog/a`,
    ]);
  });

  it("anglesko in s sumniki ter kodiranimi znaki", () => {
    const vhod = [`${H}/news/x`, `${H}/about-us`, `${H}/pogosta-vpra%C5%A1anja`, `${H}/en/contact`];
    assert.deepEqual(razvrstiPoPomembnosti(vhod), [`${H}/about-us`, `${H}/pogosta-vpra%C5%A1anja`, `${H}/en/contact`, `${H}/news/x`]);
  });
});

describe("kazalo strani (sitemap)", { concurrency: 1 }, () => {
  it("indeks iz robots.txt: page-sitemap pred post-sitemap, kljucne strani pred novicami, meja strani ostane", async () => {
    const { odv, zahteve } = lazni({
      [`${H}/robots.txt`]: () => odgovor(200, { "content-type": "text/plain" }, `User-agent: *\nDisallow: /skrito\n\nSitemap: https://${H}/sitemap_index.xml\n`),
      [`${H}/sitemap_index.xml`]: () => odgovor(200, { "content-type": "application/xml" }, indeks(["/post-sitemap.xml", "/page-sitemap.xml"])),
      [`${H}/post-sitemap.xml`]: () => odgovor(200, { "content-type": "application/xml" }, urlset(NOVICE)),
      [`${H}/page-sitemap.xml`]: () => odgovor(200, { "content-type": "application/xml" }, urlset(["/", "/skrito/x", ...KLJUCNE.slice().reverse(), "/galerija"])),
      [`${H}/`]: () => odgovor(200, { "content-type": "text/html" }, html("Mizarstvo", ["/novice/clanek-99", "/blog/b"])),
    });
    const branje = await preberiStran(`https://${H}/`, odv);
    const kazala = zahteve.filter((z) => z.pot.endsWith(".xml")).map((z) => z.pot);
    assert.deepEqual(kazala, ["/sitemap_index.xml", "/page-sitemap.xml", "/post-sitemap.xml"]);
    const strani = straniZahtev(zahteve);
    assert.equal(strani[0], "/", "zacetna stran je prva (ime podjetja)");
    assert.deepEqual(new Set(strani.slice(1, 1 + KLJUCNE.length)), new Set(KLJUCNE), "takoj za zacetno vse kljucne");
    assert.ok(!strani.includes("/skrito/x"), "robots.txt velja tudi za strani iz kazala");
    assert.equal(strani.length, MEJA_STRANI);
    assert.equal(branje.predlog.strani, MEJA_STRANI);
    assert.equal(branje.predlog.podjetje.ime, "Mizarstvo");
    assert.ok(strani.indexOf("/galerija") < strani.findIndex((p) => p.startsWith("/novice/")), "novice zadnje");
  });

  it("pocasna zacetna stran: strani iz kazala cakajo nanjo, ime podjetja ostane z zacetne strani", async () => {
    const { odv, zahteve } = lazni({
      [`${H}/sitemap.xml`]: () => odgovor(200, { "content-type": "application/xml" }, urlset(["/kontakt", "/o-nas"])),
    });
    const povezava = odv.povezava;
    let zacetnaKoncana = false;
    const prezgodaj: string[] = [];
    odv.povezava = async (z, s) => {
      if (z.pot === "/") {
        await new Promise((r) => setTimeout(r, 50));
        zacetnaKoncana = true;
        return odgovor(200, { "content-type": "text/html" }, html("Mizarstvo"));
      }
      if (!z.pot.endsWith(".xml") && z.pot !== "/robots.txt" && !zacetnaKoncana) prezgodaj.push(z.pot);
      return povezava(z, s);
    };
    const branje = await preberiStran(`https://${H}/`, odv);
    assert.deepEqual(prezgodaj, [], "zahteve iz kazala so sele po koncu zacetne strani");
    assert.deepEqual(straniZahtev(zahteve), ["/kontakt", "/o-nas"]);
    assert.equal(branje.predlog.podjetje.ime, "Mizarstvo");
  });

  it("brez kazala (404): dosedanje branje po povezavah, v vrstnem redu povezav", async () => {
    const { odv, zahteve } = lazni({
      [`${H}/`]: () => odgovor(200, { "content-type": "text/html" }, html("Mizarstvo", ["/novice/a", "/kontakt", "/o-nas"])),
    });
    await preberiStran(`https://${H}/`, odv);
    assert.deepEqual(straniZahtev(zahteve), ["/", "/novice/a", "/kontakt", "/o-nas"]);
    assert.deepEqual(zahteve.filter((z) => z.pot.endsWith(".xml")).map((z) => z.pot), ["/sitemap.xml"]);
  });

  it("odgovor brez <urlset> ali <sitemapindex> (npr. HTML na vsako pot) ni kazalo", async () => {
    const { odv, zahteve } = lazni({
      [`${H}/sitemap.xml`]: () => odgovor(200, { "content-type": "text/html" }, html("Ni kazalo", ["/o-nas"]) + "<loc>https://mizar.example/skrivno</loc>"),
      [`${H}/`]: () => odgovor(200, { "content-type": "text/html" }, html("Mizarstvo", ["/novice/a"])),
    });
    await preberiStran(`https://${H}/`, odv);
    assert.deepEqual(straniZahtev(zahteve), ["/", "/novice/a"]);
  });
});

describe("zlonamerno kazalo", { concurrency: 1 }, () => {
  it("ogromno kazalo brez konca: branje ustavi pri meji bajtov, tok zapre, strani so omejene", async () => {
    let poslano = 0;
    let zaprto = false;
    const kos = new TextEncoder().encode(`<url><loc>https://${H}/stran-${"x".repeat(60)}</loc></url>`);
    const { odv, zahteve } = lazni({
      [`${H}/sitemap.xml`]: () => ({
        status: 200,
        glave: { "content-type": "application/xml" },
        telo: (async function* () {
          yield new TextEncoder().encode("<urlset>");
          for (;;) {
            poslano += kos.length;
            yield kos;
          }
        })(),
        prekini: () => {
          zaprto = true;
        },
      }),
    });
    await preberiStran(`https://${H}/`, odv);
    assert.ok(zaprto, "tok kazala je zaprt");
    assert.ok(poslano <= MEJA_KAZALO_BAJTOV + kos.length * 2, `prebrano ${poslano} B`);
    assert.ok(straniZahtev(zahteve).length <= MEJA_STRANI);
  });

  it("tuj gostitelj: Sitemap v robots.txt in <loc> na tujem gostitelju se ne bereta; poddomena ni isti gostitelj", async () => {
    const { odv, zahteve } = lazni({
      [`${H}/robots.txt`]: () =>
        odgovor(200, { "content-type": "text/plain" }, `Sitemap: https://napad.example/sitemap.xml\nSitemap: http://${H}/http.xml\nSitemap: https://${H}:8443/vrata.xml\n`),
      [`${H}/sitemap.xml`]: () =>
        odgovor(200, { "content-type": "application/xml" }, urlset(["/tuje"], "napad.example") + urlset(["/pod"], `cdn.${H}`) + urlset(["/kontakt"])),
    });
    await preberiStran(`https://${H}/`, odv);
    assert.ok(zahteve.every((z) => z.gostitelj === H || z.gostitelj === `www.${H}`), zahteve.map((z) => z.gostitelj).join(","));
    assert.ok(!zahteve.some((z) => z.pot === "/http.xml" || z.pot === "/vrata.xml"));
    assert.ok(straniZahtev(zahteve).includes("/kontakt"));
    assert.ok(!straniZahtev(zahteve).some((p) => p === "/tuje" || p === "/pod"));
  });

  it("preusmeritev kazala na tuj gostitelj: nobene zahteve tja, branje strani gre naprej", async () => {
    const { odv, zahteve } = lazni({
      [`${H}/sitemap.xml`]: () => odgovor(302, { location: "https://napad.example/sitemap.xml" }, ""),
      [`${H}/`]: () => odgovor(200, { "content-type": "text/html" }, html("Mizarstvo", ["/kontakt"])),
    });
    const branje = await preberiStran(`https://${H}/`, odv);
    assert.equal(zahteve.filter((z) => z.gostitelj === "napad.example").length, 0);
    assert.deepEqual(straniZahtev(zahteve), ["/", "/kontakt"]);
    assert.equal(branje.predlog.podjetje.ime, "Mizarstvo");
  });

  it("indeks, ki kaze nase in na tisoc podkazal: najvec MEJA_KAZALO_DATOTEK zahtev za kazala, brez zanke", async () => {
    const pod = ["/sitemap.xml", ...Array.from({ length: 1000 }, (_, i) => `/sm-${i}.xml`)];
    const { odv, zahteve } = lazni({
      [`${H}/sitemap.xml`]: () => odgovor(200, { "content-type": "application/xml" }, indeks(pod)),
    });
    await preberiStran(`https://${H}/`, odv);
    assert.ok(zahteve.filter((z) => z.pot.endsWith(".xml")).length <= MEJA_KAZALO_DATOTEK);
  });

  it("indeks v podkazalu se ne odpre (en nivo)", async () => {
    const { odv, zahteve } = lazni({
      [`${H}/sitemap.xml`]: () => odgovor(200, { "content-type": "application/xml" }, indeks(["/a.xml"])),
      [`${H}/a.xml`]: () => odgovor(200, { "content-type": "application/xml" }, indeks(["/b.xml"])),
    });
    await preberiStran(`https://${H}/`, odv);
    assert.deepEqual(zahteve.filter((z) => z.pot.endsWith(".xml")).map((z) => z.pot), ["/sitemap.xml", "/a.xml"]);
  });

  it("zasebni naslov gostitelja: kazalo ne spremeni zavrnitve", async () => {
    const zahteve: SpletZahteva[] = [];
    await assert.rejects(
      preberiStran(`https://${H}/`, { razresi: async () => ["10.0.0.5"], povezava: async (z) => (zahteve.push(z), odgovor(200, {}, "")) }),
    );
    assert.equal(zahteve.length, 0);
  });
});

describe("pregled 0.2.10 (CodeRabbit): branje kazala ima svoj proracun casa", () => {
  it("pocasna kazala porabijo najvec ROK_KAZALA_MS; rok zahteve kazala ne preseze preostanka; strani se se preberejo", async () => {
    let ura = 0;
    const { odv, zahteve } = lazni({
      [`${H}/robots.txt`]: () => odgovor(200, { "content-type": "text/plain" }, ["a", "b", "c"].map((x) => `Sitemap: https://${H}/${x}.xml`).join("\n")),
      ...Object.fromEntries(
        ["a", "b", "c"].map((x) => [
          `${H}/${x}.xml`,
          () => {
            ura += ROK_ZAHTEVE_MS; // vsako kazalo porabi cel rok zahteve
            return odgovor(200, { "content-type": "application/xml" }, urlset([`/${x}-stran`]));
          },
        ]),
      ),
    });
    await preberiStran(`https://${H}/`, { ...odv, zdaj: () => ura });
    const kazala = zahteve.filter((z) => z.pot.endsWith(".xml"));
    assert.ok(kazala.length * ROK_ZAHTEVE_MS <= ROK_KAZALA_MS + ROK_ZAHTEVE_MS, `kazal ${kazala.length}`);
    assert.ok(kazala.length < 3, "tretje kazalo bi preseglo proracun");
    for (const z of kazala) assert.ok(z.rokMs <= ROK_ZAHTEVE_MS);
    assert.ok(kazala[1] && kazala[1].rokMs <= ROK_KAZALA_MS - ROK_ZAHTEVE_MS, `rok druge zahteve ${kazala[1]?.rokMs} ne sme preseci preostanka`);
    assert.ok(ROK_KAZALA_MS < ROK_SKUPAJ_MS / 2, "kazalo ne sme porabiti vecine skupnega roka");
    assert.ok(straniZahtev(zahteve).length > 0, "po kazalu se strani se berejo");
  });
});
