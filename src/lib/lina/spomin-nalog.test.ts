/**
 * Preizkusi za tocko 2 (claude-mem -> spomin nalog agentov v FTS5 shrambo po projektu + postopno razkrivanje).
 * Vsi podatki so sinteticni. Brez omrezja, brez auth/adc.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";
import { vsebinaNaloge } from "./claude-naloge.ts";
import {
  MEJA_ZNAKOV_KAZALA,
  filtrirajSkrivnosti,
  izlusciOpazanje,
  oblikujKazalo,
  oblikujPodrobnostiOpazanja,
} from "./spomin-nalog.ts";
import {
  SPOMIN_NALOG_DATOTEKA,
  SpominNalogNeveljaven,
  SpominNalogPokvarjen,
  isciOpazanja,
  jeSpominNalogVklopljen,
  kazaloZaProjekt,
  nastaviSpominNalog,
  podrobnostiOpazanja,
  zapisiOpazanjeNaloge,
} from "./spomin-nalog.server.ts";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function novaMapa(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-spomin-nalog-"));
  temps.push(dir);
  return dir;
}

describe("spomin-nalog: cista logika in izlocanje skrivnosti", () => {
  it("izlusciOpazanje: razbere narejeno, odlocitve, datoteke in odprto ter izloci skrivnosti", () => {
    const porocilo = [
      "## Kaj je narejeno",
      "- Dodan FTS5 indeks v src/lib/lina/spomin-nalog.server.ts",
      "- Skrivna vrstica: api_key = sk-tajniKljuc1234567890abcdef",
      "## Odločitve",
      "- Izbral sem SQLite WAL namesto JSON zaradi hitrosti iskanja.",
      "## Odprto",
      "- Windows zaklep se ni preverjen.",
    ].join("\n");
    const op = izlusciOpazanje("0123456789abcdef", "/home/a/projekt", "Dodaj spomin nalog", porocilo, 1_700_000_000_000);
    assert.ok(op);
    assert.equal(op.naslov, "Dodaj spomin nalog");
    assert.match(op.kajNarejeno, /FTS5/);
    assert.ok(!op.kajNarejeno.includes("sk-tajniKljuc"), "skrivnost mora biti izlocena");
    assert.match(op.odlocitve, /SQLite WAL/);
    assert.ok(op.datoteke.includes("src/lib/lina/spomin-nalog.server.ts"));
    assert.match(op.odprto, /Windows/);
    assert.equal(filtrirajSkrivnosti("normalno\ngeslo je mojamacka123\nok"), "normalno\nok");
  });

  it("oblikujKazalo: postopno razkrivanje (samo naslovi, brez podrobnosti) in stroga meja znakov", () => {
    const vrstice = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      nalogaId: `00000000000000${String(i).padStart(2, "0")}`,
      naslov: `Naloga stevilka ${i + 1} za izboljsavo iskanja in predpomnjenja`,
      cas: 1_700_000_000_000 + i * 1000,
      steviloDatotek: 2,
    }));
    const kazalo = oblikujKazalo(vrstice, 500);
    assert.ok(kazalo.length <= 500, `dolzina kazala ${kazalo.length} > 500`);
    assert.match(kazalo, /\[#1 \|/);
    assert.match(kazalo, /starejsih opazanj/);
    assert.ok(MEJA_ZNAKOV_KAZALA >= 800);
  });
});

describe("spomin-nalog: FTS5 shramba po projektu in postopno razkrivanje", () => {
  it("zapise opazanje, isce prek FTS5 (tudi brez stresic), loci po projektu in priklicuje podrobnosti po ID", async () => {
    const dir = await novaMapa();
    assert.equal(await jeSpominNalogVklopljen(dir), true, "privzeto vklopljeno");

    const r1 = await zapisiOpazanjeNaloge(dir, {
      nalogaId: "aaaa1111bbbb2222",
      projekt: "/home/a/projekt-1",
      naloga: "Dodaj čiščenje zvoka",
      porocilo: "Narejeno: dodan filter šuma v src/lib/lina/zvok.ts.\nOdločitve: izbran spektralni prag.\nOdprto: preizkus na telefonu.",
      cas: 1_700_000_000_000,
    });
    assert.deepEqual(r1, { zapisano: true, id: 1, novo: true });

    // Enaka nalogaId se ne podvoji.
    const r1Dup = await zapisiOpazanjeNaloge(dir, {
      nalogaId: "aaaa1111bbbb2222",
      projekt: "/home/a/projekt-1",
      naloga: "Dodaj čiščenje zvoka",
      porocilo: "Ponovni zapis.",
    });
    assert.deepEqual(r1Dup, { zapisano: true, id: 1, novo: false });

    // Drug projekt ne mesamo v kazalo prvega.
    await zapisiOpazanjeNaloge(dir, {
      nalogaId: "cccc3333dddd4444",
      projekt: "/home/a/projekt-2",
      naloga: "Popravi Android APK",
      porocilo: "Narejeno: posodobljena gradnja v app/build.gradle.kts.",
      cas: 1_700_000_005_000,
    });

    // FTS5 iskanje brez stresic najde zapis s stresicami (»ciscenje« -> »čiščenje«).
    const najdeno = await isciOpazanja(dir, "/home/a/projekt-1", "ciscenje suma");
    assert.equal(najdeno.length, 1);
    assert.equal(najdeno[0]!.nalogaId, "aaaa1111bbbb2222");

    // 1. stopnja: kazalo vsebuje SAMO naslov in ID (brez polnih podrobnosti »spektralni prag«).
    const kazalo = await kazaloZaProjekt(dir, "/home/a/projekt-1", { poizvedba: "ciscenje" });
    assert.match(kazalo, /Dodaj čiščenje zvoka/);
    assert.match(kazalo, /#1/);
    assert.ok(!kazalo.includes("spektralni prag"), "kazalo ne sme izpisovati podrobnosti");
    assert.ok(!kazalo.includes("Android APK"), "kazalo ne sme mesati drugega projekta");

    // 2. stopnja: podrobnosti na zahtevo po ID vrnejo vse podatke.
    const pod = await podrobnostiOpazanja(dir, 1);
    assert.ok(pod);
    assert.match(oblikujPodrobnostiOpazanja(pod), /spektralni prag/);
    assert.match(oblikujPodrobnostiOpazanja(pod), /preizkus na telefonu/);
    assert.ok(pod.datoteke.includes("src/lib/lina/zvok.ts"));

    // Povezava z vsebinaNaloge: kazalo gre v NALOGA.md.
    const md = vsebinaNaloge({ id: "eeee5555ffff6666", izvor: "lastnik", besedilo: "Nova naloga" }, new Date(0), { spominKazalo: kazalo });
    assert.match(md, /## Spomin prejsnjih nalog v projektu \(kazalo\)/);
    assert.match(md, /Dodaj čiščenje zvoka/);

    // Datoteka baze ima pravice 0600.
    const st = await stat(path.join(dir, SPOMIN_NALOG_DATOTEKA));
    assert.equal(st.mode & 0o777, 0o600);
  });

  it("izklop stikala ustavi zapis, kazalo in priklic; pokvarjena baza in simbolna povezava se zavrneta", async () => {
    const dir = await novaMapa();
    await nastaviSpominNalog(false, dir);
    assert.equal(await jeSpominNalogVklopljen(dir), false);
    assert.deepEqual(
      await zapisiOpazanjeNaloge(dir, { nalogaId: "1111222233334444", projekt: "/home/a/p", naloga: "Test", porocilo: "OK" }),
      { zapisano: false, razlog: "izklopljeno" },
    );
    assert.equal(await kazaloZaProjekt(dir, "/home/a/p"), "");
    assert.equal(await podrobnostiOpazanja(dir, 1), null);

    // Pokvarjena datoteka SQLite vrze SpominNalogPokvarjen.
    const dirPokv = await novaMapa();
    await writeFile(path.join(dirPokv, SPOMIN_NALOG_DATOTEKA), "ni-sqlite-datoteka-12345");
    await assert.rejects(() => isciOpazanja(dirPokv, "/home/a/p"), SpominNalogPokvarjen);

    // Simbolna povezava vrze SpominNalogNeveljaven.
    const dirSym = await novaMapa();
    await symlink("/etc/hosts", path.join(dirSym, SPOMIN_NALOG_DATOTEKA));
    await assert.rejects(() => isciOpazanja(dirSym, "/home/a/p"), SpominNalogNeveljaven);
  });

  it("locitev: tajnica (klici) ne uvaza spomin-nalog; claude-naloge.server.ts ga uporablja", async () => {
    const srv = await readFile(path.join(SRC, "lib/lina/claude-naloge.server.ts"), "utf8");
    assert.match(srv, /spomin-nalog\.server\.ts/);
    assert.match(srv, /zapisiOpazanjeNaloge/);
    assert.match(srv, /kazaloZaProjekt/);

    for (const rel of ["lib/lina/service.server.ts", "lib/lina/brain.ts", "lib/lina/govor.ts", "lib/lina/guards.ts", "lib/lina/tajnica.ts"]) {
      const v = await readFile(path.join(SRC, rel), "utf8");
      assert.doesNotMatch(v, /spomin-nalog/, `${rel} ne sme uvazati spomin-nalog`);
    }
  });
});
