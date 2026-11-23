/**
 * Naloga lina-podokna (lastnik 15. 11. 2026: »Nastavitve so dolgo brskanje po strani dol, zato je bolj smiselno narediti
 * vec podoken«; pravilo velja za vsako stran, ki je daljsa od enega zaslona - Nastavitve in Znanje).
 * Preizkus bere izvorno kodo in preverja tabelo podokna-definicije.ts, komponento podokna.tsx ter lina-desk.tsx.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { en, sl } from "./besedila.ts";
import * as definicije from "./podokna-definicije.ts";
import { NASTAVITVE, ZNANJE, jePodoknoId, kljucPodokna, naslednjePodokno, preberiPodokno, shraniPodokno, type DefinicijaPodoken } from "./podokna-definicije.ts";

const beri = (pot: string) => readFileSync(new URL(pot, import.meta.url), "utf8");

/** Najde telo `razdelki={{ ... }}` znotraj klica `<Podokna def={imeDef} ...>`. */
function izvleciRazdelkeBlok(vir: string, imeDef: "NASTAVITVE" | "ZNANJE"): string {
  const zacetek = vir.search(new RegExp(`<Podokna[\\s\\S]{0,200}?def=\\{${imeDef}\\}`));
  assert.ok(zacetek >= 0, `lina-desk.tsx mora vsebovati <Podokna def={${imeDef}} ...>`);
  const odRazdelki = vir.indexOf("razdelki={{", zacetek);
  assert.ok(odRazdelki >= 0, `klic <Podokna def={${imeDef}}> mora imeti razdelki={{ ... }}`);
  let globina = 0;
  let i = odRazdelki + "razdelki={".length;
  for (; i < vir.length; i++) {
    const ch = vir[i];
    if (ch === "{") globina++;
    else if (ch === "}") {
      globina--;
      if (globina === 0) return vir.slice(odRazdelki, i + 1);
    }
  }
  assert.fail(`nezaključen objekt razdelki za ${imeDef}`);
}

function imaKljucRazdelka(blok: string, id: string): boolean {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:["']${esc}["']|\\b${esc})\\s*:`).test(blok);
}

describe("naloga-podokna: izvorna koda in definicije", { concurrency: 1 }, () => {
  it("(a) lina-desk.tsx uvozi Podokna ter NASTAVITVE in ZNANJE", () => {
    const desk = beri("../../components/lina-desk.tsx");
    assert.match(desk, /import\s*\{[^}]*\bPodokna\b[^}]*\}\s*from\s*["']@\/components\/podokna\.tsx["']/);
    assert.match(desk, /import\s*\{[^}]*\bNASTAVITVE\b[^}]*\bZNANJE\b[^}]*\}\s*from\s*["']@\/lib\/lina\/podokna-definicije\.ts["']/);
  });

  it("(b) vsak razdelek iz tabel NASTAVITVE in ZNANJE je v razdelki objektu v lina-desk.tsx", () => {
    const desk = beri("../../components/lina-desk.tsx");
    for (const [ime, def] of [
      ["NASTAVITVE", NASTAVITVE],
      ["ZNANJE", ZNANJE],
    ] as const) {
      const blok = izvleciRazdelkeBlok(desk, ime);
      for (const podokno of def.podokna) {
        assert.ok(podokno.razdelki.length > 0, `${ime}.${podokno.id} ne sme biti prazno`);
        for (const razdelek of podokno.razdelki) {
          assert.ok(imaKljucRazdelka(blok, razdelek), `${ime}: razdelek "${razdelek}" manjka v razdelki={{ ... }}`);
        }
      }
    }
  });

  it("(c) vsak id razdelka je v tabeli tocno enkrat (brez podvojitev) in obstaja kot id=\"...\" v lina-desk.tsx", () => {
    const desk = beri("../../components/lina-desk.tsx");
    const vsiNast = NASTAVITVE.podokna.flatMap((p) => [...p.razdelki]);
    const vsiZn = ZNANJE.podokna.flatMap((p) => [...p.razdelki]);
    const vsi = [...vsiNast, ...vsiZn];
    assert.equal(new Set(vsi).size, vsi.length, "id razdelka se v tabelah ne sme podvojiti");

    // Novi razdelki (Dodatki in nacin klica) morajo biti v tabeli Nastavitev.
    assert.ok(vsiNast.includes("nast-dodatki"), "NASTAVITVE mora vsebovati nast-dodatki");
    assert.ok(vsiNast.includes("pr-nacin"), "NASTAVITVE mora vsebovati pr-nacin");

    // Razdelek ima lahko id v kodi pod imenom sidra podokna (iPhone: id="iphone", ker besedila.spec pricakuje id="iphone-naslov").
    for (const podokno of [...NASTAVITVE.podokna, ...ZNANJE.podokna] as ReadonlyArray<{ razdelki: readonly string[]; sidra?: readonly string[] }>) {
      for (const id of podokno.razdelki) {
        const imaId = desk.includes(`id="${id}"`) || (podokno.sidra ?? []).some((sidro) => desk.includes(`id="${sidro}"`));
        assert.ok(imaId, `lina-desk.tsx mora imeti id="${id}" (ali sidro podokna)`);
      }
    }
    // Obstojec id nast-pravila ostane ohranjen za globoke povezave.
    assert.ok(desk.includes('id="nast-pravila"'), 'lina-desk.tsx mora ohraniti id="nast-pravila"');
  });

  it("(d) vsaka oznaka in naziv obstaja v sl IN en iz besedila.ts ter so imena znotraj zavihka razlicna", () => {
    const slMap = sl as Record<string, string>;
    const enMap = en as Record<string, string>;
    for (const def of [NASTAVITVE, ZNANJE] as readonly DefinicijaPodoken[]) {
      assert.ok(typeof slMap[def.naziv] === "string" && slMap[def.naziv].trim().length > 0, `sl.${def.naziv}`);
      assert.ok(typeof enMap[def.naziv] === "string" && enMap[def.naziv].trim().length > 0, `en.${def.naziv}`);
      const slOznake: string[] = [];
      const enOznake: string[] = [];
      for (const podokno of def.podokna) {
        const s = slMap[podokno.oznaka];
        const e = enMap[podokno.oznaka];
        assert.ok(typeof s === "string" && s.trim().length > 0, `sl.${podokno.oznaka}`);
        assert.ok(typeof e === "string" && e.trim().length > 0, `en.${podokno.oznaka}`);
        slOznake.push(s);
        enOznake.push(e);
      }
      assert.equal(new Set(slOznake).size, slOznake.length, `${def.predpona}: podvojena sl oznaka`);
      assert.equal(new Set(enOznake).size, enOznake.length, `${def.predpona}: podvojena en oznaka`);
    }
  });

  it("(e) sidrna navigacija nastavitve-kazalo ne obstaja vec", () => {
    const desk = beri("../../components/lina-desk.tsx");
    assert.ok(!desk.includes("nastavitve-kazalo"), "nastavitve-kazalo mora biti nadomesceno s Podokna");
  });

  it("(f) hashchange je v kodi podoken; hidden in aria tablist ohranjeni", () => {
    const podokna = beri("../../components/podokna.tsx");
    assert.ok(podokna.includes("hashchange"), "podokna.tsx mora poslusati hashchange");
    assert.ok(podokna.includes('role="tablist"'), 'podokna.tsx mora imeti role="tablist"');
    assert.ok(podokna.includes("hidden="), "podokna.tsx mora ohraniti vsebino s hidden");
    assert.ok(podokna.includes("focus-visible:outline-2"));
    assert.ok(podokna.includes("motion-reduce:transition-none"));
  });

  it("globoke povezave (podoknoZaRazdelek), osebni nacin (filtrirajPodokna), tipkovnica in shramba", () => {
    const { podoknoZaRazdelek, filtrirajPodokna } = definicije as typeof definicije & {
      podoknoZaRazdelek?: (def: DefinicijaPodoken, sidro: string) => string | null;
      filtrirajPodokna?: (def: DefinicijaPodoken, vidni: Readonly<Record<string, unknown>>) => DefinicijaPodoken;
    };
    assert.equal(typeof podoknoZaRazdelek, "function", "podokna-definicije.ts mora izvoziti podoknoZaRazdelek");
    assert.equal(typeof filtrirajPodokna, "function", "podokna-definicije.ts mora izvoziti filtrirajPodokna");

    assert.equal(podoknoZaRazdelek!(NASTAVITVE, "#nast-iphone"), "iphone");
    assert.equal(podoknoZaRazdelek!(NASTAVITVE, "nast-mozgani"), "mozgani");
    assert.equal(podoknoZaRazdelek!(NASTAVITVE, "#nast-pravila"), "prevzem");
    assert.equal(podoknoZaRazdelek!(NASTAVITVE, "#pr-nacin"), "prevzem");
    assert.equal(podoknoZaRazdelek!(NASTAVITVE, "#nast-dodatki"), "dodatki");
    assert.equal(podoknoZaRazdelek!(NASTAVITVE, "#mapa-zapiskov"), "podatki");
    assert.equal(podoknoZaRazdelek!(ZNANJE, "#povprasevanje"), "povprasevanje");
    assert.equal(podoknoZaRazdelek!(ZNANJE, "#splet-naslov"), "splet");
    assert.equal(podoknoZaRazdelek!(ZNANJE, "#znanje-besedilo"), "podjetje");
    assert.equal(podoknoZaRazdelek!(NASTAVITVE, "#neobstaja"), null);

    // Osebni nacin: podokno, katerega vsi razdelki so skriti (null), se ne prikaze v traku.
    const osebniRazdelki: Record<string, unknown> = Object.fromEntries(
      NASTAVITVE.podokna.flatMap((p) => p.razdelki.map((r) => [r, true])),
    );
    for (const poslovni of ["pr-tema", "pr-garancija", "pr-dostava", "pr-potrditev"]) {
      osebniRazdelki[poslovni] = null;
    }
    const vidnaOsebna = filtrirajPodokna!(NASTAVITVE, osebniRazdelki);
    assert.equal(jePodoknoId(vidnaOsebna, "odgovori"), false, "odgovori morajo biti skriti v osebnem nacinu");
    assert.equal(jePodoknoId(vidnaOsebna, "prevzem"), true);
    assert.equal(jePodoknoId(vidnaOsebna, "potrditev"), false, "potrditev mora biti skrita v osebnem nacinu");
    // Tipkovnica preskoci skrita podokna (odgovori, potrditev): iz iPhone na Mozgane.
    assert.equal(naslednjePodokno(vidnaOsebna, "iphone", "ArrowRight"), "mozgani");

    // Shramba brez izjeme.
    const zapisi: Record<string, string> = {};
    const shramba = { getItem: (k: string) => zapisi[k] ?? null, setItem: (k: string, v: string) => void (zapisi[k] = v) };
    shraniPodokno(NASTAVITVE, "mozgani", shramba);
    assert.equal(zapisi[kljucPodokna(NASTAVITVE)], "mozgani");
    assert.equal(preberiPodokno(NASTAVITVE, shramba), "mozgani");
    assert.equal(preberiPodokno(NASTAVITVE), null);
  });

  it("uvoz GooglePrijava (zamenljiv z nadomestkom) in GooglePrijava v lina-desk.tsx ostaneta nespremenjena", () => {
    const desk = beri("../../components/lina-desk.tsx");
    // 22. 11. 2026: preizkus je preverjal 12. vrstico; nad njo so bili kasneje dodani uvozi (TinyFish, Brave, tozilnik), zato se
    // vrstica isce po vsebini. Pogodba ostane: natanko en uvoz GooglePrijava v tej obliki (nadomestek prijava-stub ga lahko zamenja).
    const uvozi = desk.split("\n").filter((v) => /\bGooglePrijava \} from /.test(v));
    assert.equal(uvozi.length, 1, uvozi.join(" | "));
    assert.match(uvozi[0], /^import \{ (?:PrijavaStub as )?GooglePrijava \} from "@\/components\/(?:prijava-stub|google-prijava)\.tsx";$/);
    // Klic komponente ima od izbire edinega projekta (lastnik 9. 11. 2026, AGENTS.md »Izbira projekta«: en sam projekt izbere
    // sama; google-prijava.tsx onSamodejniProjekt) se neobvezen cetrti atribut in je v vec vrsticah. Pogodba ostane: trije
    // prvotni atributi v istem zaporedju, poleg njih samo onSamodejniProjekt.
    const zacetek = desk.indexOf("<GooglePrijava");
    assert.ok(zacetek >= 0);
    assert.equal(desk.indexOf("<GooglePrijava", zacetek + 1), -1);
    const jsx = desk.slice(zacetek, desk.indexOf("/>", zacetek) + 2).replace(/\s+/g, " ");
    assert.match(jsx, /^<GooglePrijava project=\{project\} onProject=\{setProject\} onError=\{onError\}(?: onSamodejniProjekt=\{.*\})? \/>$/);
  });
});
