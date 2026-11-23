/**
 * Naloga G5 (lastnik 11. 11. 2026): zapiski pogovorov - ime = ime klicatelja + cas, mapa po izbiri uporabnika,
 * zdruzevanje, gumb »Odpri« pri vsakem zapisku. Vsa imena in stevilke so izmisljena. Brez pravega omrezja.
 * Varnostni preizkusi poti (varno ime, ID z seznama, simbolne povezave, »wx«, sistemske mape) brez popravka padejo:
 * dokaz z mutacijo je v porocilu lina-g5-porocilo.md.
 */
import assert from "node:assert/strict";
import { lstatSync, readFileSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { LinaAuthError, setupOwner } from "./auth.server.ts";
import { freshCall } from "./brain.ts";
import { ustaviCiscenjeZvoka } from "./glas.server.ts";
import { recordCaller, zakljuciKlic } from "./service.server.ts";
import { readJsonFile, writeJson } from "./store.server.ts";
import { casZaIme, imeDatoteke, imeKlicatelja, naslovZapiska, varnoIme, vsebinaZapiska, zdruziVsebine } from "./zapiski.ts";
import { jeSistemskaMapa, preveriMapoZapiskov } from "./zapiski-mapa.server.ts";
import {
  izberiMapoZapiskov,
  odpriMapoZapiskov,
  pogledMapeZapiskov,
  preberiPosnetek,
  preberiZapisek,
  seznamZapiskov,
  zapisiZapisekKlica,
  zdruziZapiske,
} from "./zapiski.server.ts";
import type { CallSession } from "./types.ts";

process.env.LINA_LLM = "0";

/**
 * Mapa za vsak klic (lastnik 22. 11. 2026: »vsak klic mora dobiti svojo mapo, kjer bo zapisek klica in posnetek klica«):
 * ID zapiska klica je »<mapa klica>/zapisek.md«; v mapi zapiskov so mape klicev. Pomoznik da ime mape iz ID-ja.
 */
const mapaId = (id: string): string => id.split("/")[0];
const ZAP = "/zapisek.md";

const temps: string[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) ustaviCiscenjeZvoka(dir);
  while (temps.length) {
    const dir = temps.pop();
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-g5-"));
  temps.push(dir);
  dirs.push(dir);
  return dir;
}

async function lastnik(): Promise<{ dir: string; token: string }> {
  const dir = await scratch();
  const token = await setupOwner("geslo-test-1234", dir);
  return { dir, token };
}

/** Klic z imenom ob lokalnem casu (leto, mesec 0-11, dan, ura, minuta), da je ime neodvisno od casovnega pasu. */
function klic(sid: string, ime: string, ob: [number, number, number, number, number], dopolni: Partial<CallSession> = {}): CallSession {
  const cas = new Date(ob[0], ob[1], ob[2], ob[3], ob[4], 0).toISOString();
  const c = freshCall(sid, "+38640000000", cas);
  c.order.customerName = ime;
  c.status = "zakljucen";
  c.transcript.push({ role: "lina", text: "Kako vam lahko pomagam?", at: cas }, { role: "stranka", text: "Potrebujem mizo.", at: cas });
  return Object.assign(c, dopolni);
}

const NOV = [2026, 10, 11, 7, 45] as [number, number, number, number, number];

describe("G5: varno ime", () => {
  it("navadno ime ostane, unikodne crke tudi", () => {
    assert.equal(varnoIme("Ana Novak"), "Ana Novak");
    assert.equal(varnoIme("Žiga Škof"), "Žiga Škof");
    assert.equal(varnoIme("李 小龍"), "李 小龍");
  });

  it("pot ../../x ne da poti: ni ne / ne \\ ne ..", () => {
    for (const vhod of ["../../x", "..\\..\\x", "/etc/passwd", "C:\\Windows\\win.ini", "a/../../b", "....//x"]) {
      const ime = varnoIme(vhod);
      assert.ok(!/[\\/:]/.test(ime), `${vhod} -> ${ime}`);
      assert.ok(!ime.includes(".."), `${vhod} -> ${ime}`);
      assert.ok(!ime.startsWith("."), `${vhod} -> ${ime}`);
      const datoteka = imeDatoteke(`${ime} - 2026-11-11 07-45`);
      assert.equal(path.basename(datoteka), datoteka);
    }
    assert.equal(varnoIme("../../x"), "x");
  });

  it("posebni, kontrolni in nevidni znaki so odstranjeni", () => {
    const ime = varnoIme('A*B?C"D<E>F|G\u0000H\n\tI\u202eJ');
    assert.ok(!/[*?"<>|\u0000\n\t\u202e]/.test(ime), ime);
    assert.match(ime, /^A B C D E F G H I J$/);
  });

  it("prazno ime in samo pike dajo prazen niz; ne-niz tudi", () => {
    assert.equal(varnoIme(""), "");
    assert.equal(varnoIme("   "), "");
    assert.equal(varnoIme("..."), "");
    assert.equal(varnoIme(null), "");
    assert.equal(varnoIme(42), "");
  });

  it("dolgo ime se odreze po bajtih (ime datoteke najvec 255 bajtov)", () => {
    const dolgo = varnoIme("Ž".repeat(500));
    assert.ok(Buffer.byteLength(dolgo, "utf8") <= 100);
    const datoteka = imeDatoteke(`${dolgo} - 2026-11-11 07-45`, 2);
    assert.ok(Buffer.byteLength(datoteka, "utf8") <= 255);
    const emoji = varnoIme("😀".repeat(100));
    assert.ok(Buffer.byteLength(emoji, "utf8") <= 100);
  });

  it("rezervirana imena Windows dobijo predpono", () => {
    assert.equal(varnoIme("CON"), "_CON");
    assert.equal(varnoIme("nul.txt"), "_nul.txt");
  });
});

describe("G5: naslov zapiska", () => {
  it("ime klicatelja + cas klica", () => {
    const c = klic("a1", "Ana Novak", NOV);
    // Lastnik 22. 11. 2026: ime datoteke nosi tudi telefonsko stevilko (prej G5 11. 11. 2026 samo ime in cas).
    assert.equal(naslovZapiska(c), "Ana Novak - 2026-11-11 07-45 - +38640000000");
    assert.equal(casZaIme(new Date(2026, 10, 11, 7, 45).toISOString()), "2026-11-11 07-45");
    assert.equal(imeDatoteke(naslovZapiska(c)), "Ana Novak - 2026-11-11 07-45 - +38640000000.md");
  });

  it("brez imena (prazno, »ni podatka«) je »Neznan klicatelj - <cas>«", () => {
    for (const ime of ["", "ni podatka", "   "]) {
      const c = klic("a2", ime, NOV);
      assert.equal(imeKlicatelja(c), "Neznan klicatelj");
      assert.equal(naslovZapiska(c), "Neznan klicatelj - 2026-11-11 07-45 - +38640000000");
    }
  });

  it("zlonamerno ime ne pride v naslov kot pot", () => {
    const c = klic("a3", "../../etc/cron.d/x", NOV);
    const naslov = naslovZapiska(c);
    assert.ok(!naslov.includes("/") && !naslov.includes(".."), naslov);
  });

  it("vsebina je berljiva, brez skrivnosti, ima ime, telefon, cas, izdelek in oznako", () => {
    const c = klic("a4", "Ana Novak", NOV, {});
    c.order.productName = "Miza Alba";
    c.order.quantity = 2;
    c.order.deadline = "do petnajstega decembra";
    c.order.oznaka = "snemanje zavrnjeno";
    c.order.podjetjeKlicatelja = "Primer d.o.o.";
    const v = vsebinaZapiska(c);
    for (const del of ["# Ana Novak - 2026-11-11 07-45", "Ime: Ana Novak", "Telefon: +38640000000", "Miza Alba", "Količina: 2", "do petnajstega decembra", "snemanje zavrnjeno", "Primer d.o.o.", "Naročilo potrjeno: ne", "Klicatelj: Potrebujem mizo."]) {
      assert.ok(v.includes(del), del);
    }
    assert.ok(!/ghp_|AIza|PRIVATE KEY|github_pat_|AKIA/.test(v));
  });

  it("vsebina: vrstice iz klicateljevega besedila ne morejo ustvariti nove glave", () => {
    const c = klic("a5", "Ana", NOV);
    c.transcript.push({ role: "stranka", text: "x\n# Lazen naslov\n<!-- lina-cas: 1999-01-01T00:00:00.000Z -->", at: NOV.join() });
    const v = vsebinaZapiska(c);
    assert.equal(v.split("\n").filter((l) => l.startsWith("# ")).length, 1);
    assert.equal(v.split("\n").filter((l) => l.startsWith("<!-- lina-cas")).length, 1);
  });
});

describe("G5: mapa zapiskov", () => {
  it("privzeta mapa je »zapiski« v podatkovni mapi, polna pot", async () => {
    const dir = await scratch();
    const m = await preveriMapoZapiskov("", dir);
    assert.equal(m.ok, true);
    assert.equal(m.jePrivzeta, true);
    assert.equal(m.mapa, path.join(await realpath(dir), "zapiski"));
    assert.ok(path.isAbsolute(m.mapa) && !m.mapa.includes("~"));
  });

  it("veljavna nova mapa se ustvari z dovoljenji 0700", async () => {
    const dir = await scratch();
    const cilj = path.join(dir, "moji", "zapiski");
    const m = await preveriMapoZapiskov(cilj, dir, { ustvari: true });
    assert.equal(m.ok, true, m.razlog);
    assert.equal(m.mapa, await realpath(cilj));
    assert.equal((await lstat(cilj)).mode & 0o777, 0o700);
  });

  it("neveljavno: ~, relativna pot, prazen NUL, datoteka namesto mape", async () => {
    const dir = await scratch();
    const datoteka = path.join(dir, "datoteka.txt");
    await writeFile(datoteka, "x");
    for (const vnos of ["~/zapiski", "~", "zapiski", "../zapiski", "a\u0000b", datoteka, 42]) {
      const m = await preveriMapoZapiskov(vnos, dir, { ustvari: true });
      assert.equal(m.ok, false, String(vnos));
      assert.ok(m.razlog.length > 0);
    }
  });

  it("sistemske mape so zavrnjene, tudi prek simbolne povezave", async () => {
    const dir = await scratch();
    for (const vnos of ["/", "/etc", "/etc/lina", "/usr/share/x", "/proc/self", "/bin", "/home"]) {
      assert.equal((await preveriMapoZapiskov(vnos, dir, { ustvari: true })).ok, false, vnos);
    }
    const povezava = path.join(dir, "povezava");
    await symlink("/etc", povezava);
    assert.equal((await preveriMapoZapiskov(povezava, dir, { ustvari: true })).ok, false);
    // Brez ustvarjanja (samo prikaz): povezava na sistemski imenik je prav tako zavrnjena.
    assert.equal((await preveriMapoZapiskov(povezava, dir)).ok, false);
    // Tudi nova mapa pod povezavo, ki vodi v sistemski imenik.
    assert.equal((await preveriMapoZapiskov(path.join(povezava, "lina"), dir)).ok, false);
  });

  it("Windows: sistemske poti in omrezne mape so zavrnjene, uporabnikova mapa ni", () => {
    for (const p of ["C:\\Windows\\System32", "c:\\windows", "C:\\Program Files\\Lina", "C:\\", "C:\\Users", "\\\\streznik\\skupno\\zapiski", "D:\\ProgramData\\x"]) {
      assert.equal(jeSistemskaMapa(p, "win32"), true, p);
    }
    for (const p of ["C:\\Users\\Ana\\Dokumenti\\Zapiski", "D:\\Zapiski"]) assert.equal(jeSistemskaMapa(p, "win32"), false, p);
  });

  it("opozorilo za mapo v oblaku in za mapo, berljivo drugim", async () => {
    const dir = await scratch();
    const oblak = path.join(dir, "Dropbox", "zapiski");
    const m = await preveriMapoZapiskov(oblak, dir, { ustvari: true });
    assert.equal(m.ok, true);
    assert.ok(m.opozorila.some((o) => /oblaku/.test(o)));
    const odprta = path.join(dir, "odprta");
    await mkdir(odprta);
    await chmod(odprta, 0o755);
    assert.ok((await preveriMapoZapiskov(odprta, dir)).opozorila.some((o) => /drugim uporabnikom/.test(o)));
  });

  it("izbira mape: zapise se v pravila, stari zapiski ostanejo, novi gredo v novo mapo", async () => {
    const { dir, token } = await lastnik();
    const stara = path.join(await realpath(dir), "zapiski");
    const c1 = klic("m1", "Ana Novak", NOV);
    const ime1 = await zapisiZapisekKlica(c1, dir);
    assert.ok(ime1.endsWith(ZAP), ime1);
    assert.deepEqual(await readdir(stara), [mapaId(ime1)]);
    const nova = path.join(dir, "druga");
    const izid = await izberiMapoZapiskov(nova, token, dir);
    assert.equal(izid.ok, true, izid.razlog);
    assert.equal(izid.mapa, await realpath(nova));
    assert.equal((await pogledMapeZapiskov(token, dir)).mapa, await realpath(nova));
    const pravila = await readJsonFile<{ mapaZapiskov: string }>(dir, "pravila.json");
    assert.equal(pravila?.mapaZapiskov, await realpath(nova));
    const ime2 = await zapisiZapisekKlica(klic("m2", "Boris Kos", NOV), dir);
    assert.deepEqual(await readdir(nova), [mapaId(ime2)]);
    assert.deepEqual(await readdir(stara), [mapaId(ime1)], "stari zapisek ostane, ni prestavljen");
    // Povratek na privzeto.
    assert.equal((await izberiMapoZapiskov("", token, dir)).jePrivzeta, true);
    assert.equal((await readJsonFile<{ mapaZapiskov: string }>(dir, "pravila.json"))?.mapaZapiskov, "");
  });

  it("neveljavna izbira ne spremeni nastavitve", async () => {
    const { dir, token } = await lastnik();
    const izid = await izberiMapoZapiskov("~/zapiski", token, dir);
    assert.equal(izid.ok, false);
    assert.equal((await pogledMapeZapiskov(token, dir)).jePrivzeta, true);
    assert.equal((await izberiMapoZapiskov("/etc", token, dir)).ok, false);
  });
});

describe("G5: zapisek ob koncu klica", () => {
  it("konec klica (hangup brez imena): zapisek »Neznan klicatelj - <cas>« v privzeti mapi in ime v calls.json", async () => {
    const { dir, token } = await lastnik();
    const izid = await recordCaller({ callSid: "k1", from: "+38640000001", hangup: true }, dir);
    assert.equal(izid.call.status, "zakljucen");
    const mapa = path.join(await realpath(dir), "zapiski");
    // Od naloge #18 je v mapi zapiskov poleg zapiska tudi Klici.txt (pregled vseh klicev): tu štejejo samo zapiski.
    const datoteke = (await readdir(mapa)).filter((d) => d !== "Klici.txt");
    assert.equal(datoteke.length, 1);
    assert.match(datoteke[0], /^Neznan klicatelj - \d{4}-\d{2}-\d{2} \d{2}-\d{2} - \+38640000001$/);
    assert.equal(izid.call.zapisek, datoteke[0] + ZAP);
    const knjiga = await readJsonFile<Record<string, CallSession>>(dir, "calls.json");
    assert.equal(knjiga?.k1.zapisek, datoteke[0] + ZAP);
    assert.equal((await lstat(path.join(mapa, datoteke[0]))).mode & 0o777, 0o700, "mapa klica 0700");
    assert.equal((await lstat(path.join(mapa, datoteke[0], "zapisek.md"))).mode & 0o777, 0o600);
    assert.equal((await seznamZapiskov(token, dir)).length, 1);
  });

  it("statusni povratni klic zakljuci klic z imenom in napise zapisek; ponovitev ga ne podvoji", async () => {
    const { dir } = await lastnik();
    const c = klic("k2", "Ana Novak", NOV, { status: "v-teku" });
    await writeJson(dir, "calls.json", { k2: c });
    const prvi = await zakljuciKlic("k2", dir);
    assert.equal(prvi?.zapisek, "Ana Novak - 2026-11-11 07-45 - +38640000000/zapisek.md");
    await zakljuciKlic("k2", dir);
    assert.deepEqual((await readdir(path.join(await realpath(dir), "zapiski"))).filter((d) => d !== "Klici.txt"), ["Ana Novak - 2026-11-11 07-45 - +38640000000"]);
  });

  it("dopolnitev zapisa prepise SVOJ zapisek (brez pripone -2)", async () => {
    const { dir } = await lastnik();
    const c = klic("k3", "Ana Novak", NOV);
    const ime = await zapisiZapisekKlica(c, dir);
    c.zapisek = ime;
    c.order.deadline = "jutri";
    assert.equal(await zapisiZapisekKlica(c, dir), ime);
    const mapa = path.join(await realpath(dir), "zapiski");
    assert.deepEqual(await readdir(mapa), [mapaId(ime)]);
    assert.deepEqual(await readdir(path.join(mapa, mapaId(ime))), ["zapisek.md"], "brez zacasnih datotek");
    assert.match(await readFile(path.join(mapa, ...ime.split("/")), "utf8"), /jutri/);
  });

  it("enako ime v istem trenutku dobi pripono -2, -3 in nobenega ne prepise", async () => {
    const { dir } = await lastnik();
    const imena = [];
    for (const sid of ["e1", "e2", "e3"]) imena.push(await zapisiZapisekKlica(klic(sid, "Ana Novak", NOV, { transcript: [{ role: "stranka", text: sid, at: "x" }] }), dir));
    assert.deepEqual(imena, [
      "Ana Novak - 2026-11-11 07-45 - +38640000000/zapisek.md",
      "Ana Novak - 2026-11-11 07-45 - +38640000000-2/zapisek.md",
      "Ana Novak - 2026-11-11 07-45 - +38640000000-3/zapisek.md",
    ]);
    const mapa = path.join(await realpath(dir), "zapiski");
    assert.match(await readFile(path.join(mapa, ...imena[0].split("/")), "utf8"), /stranka|Klicatelj: e1/);
    assert.match(await readFile(path.join(mapa, ...imena[1].split("/")), "utf8"), /Klicatelj: e2/);
  });

  it("obstojec simbolna povezava z enakim imenom ne prepise tuje datoteke (wx)", async () => {
    const { dir } = await lastnik();
    const mapa = path.join(await realpath(dir), "zapiski");
    await mkdir(mapa, { recursive: true });
    // Mapa klica: simbolna povezava z enakim imenom kaze na tujo mapo; vanjo se ne sme nic zapisati.
    const zrtev = path.join(dir, "tuja-mapa");
    await mkdir(zrtev);
    await writeFile(path.join(zrtev, "zapisek.md"), "NEDOTAKNJENO");
    await symlink(zrtev, path.join(mapa, "Ana Novak - 2026-11-11 07-45 - +38640000000"));
    const ime = await zapisiZapisekKlica(klic("s1", "Ana Novak", NOV), dir);
    assert.equal(ime, "Ana Novak - 2026-11-11 07-45 - +38640000000-2/zapisek.md");
    assert.equal(await readFile(path.join(zrtev, "zapisek.md"), "utf8"), "NEDOTAKNJENO");
    assert.deepEqual(await readdir(zrtev), ["zapisek.md"]);
  });

  it("zlonamerno ime klicatelja ne ustvari datoteke zunaj mape", async () => {
    const { dir } = await lastnik();
    const ime = await zapisiZapisekKlica(klic("z1", "../../../zunaj", NOV), dir);
    assert.ok(ime.endsWith(ZAP), ime);
    assert.equal(path.basename(mapaId(ime)), mapaId(ime));
    assert.ok(!mapaId(ime).includes(".."));
    const mapa = path.join(await realpath(dir), "zapiski");
    assert.deepEqual(await readdir(mapa), [mapaId(ime)]);
    assert.deepEqual((await readdir(dir)).filter((x) => x.includes("zunaj")), []);
  });

  it("posnetek v mapi klica: na seznamu oznacen, predvajanje samo lastniku in samo navadna datoteka (22. 11. 2026)", async () => {
    const { dir, token } = await lastnik();
    const id = await zapisiZapisekKlica(klic("p1", "Ana Novak", NOV), dir);
    const mapa = path.join(await realpath(dir), "zapiski", mapaId(id));
    assert.equal((await seznamZapiskov(token, dir))[0].posnetek, undefined);
    await writeFile(path.join(mapa, "posnetek.wav"), "RIFF-test");
    const vnos = (await seznamZapiskov(token, dir))[0];
    assert.equal(vnos.posnetek, true);
    const p = await preberiPosnetek(id, token, dir);
    assert.equal(p.ok, true);
    assert.equal(p.url, `data:audio/wav;base64,${Buffer.from("RIFF-test").toString("base64")}`);
    await assert.rejects(preberiPosnetek(id, "napacen", dir));
    await assert.rejects(preberiPosnetek("../x/zapisek.md", token, dir));
    // Simbolna povezava namesto posnetka se ne bere.
    const drugi = await zapisiZapisekKlica(klic("p2", "Boris Kos", NOV), dir);
    const tuje = path.join(dir, "tuje.wav");
    await writeFile(tuje, "SKRIVNO");
    await symlink(tuje, path.join(await realpath(dir), "zapiski", mapaId(drugi), "posnetek.wav"));
    await assert.rejects(preberiPosnetek(drugi, token, dir));
  });

  it("vaja klica zapiska ne naredi", async () => {
    const { dir } = await lastnik();
    const izid = await recordCaller({ callSid: "vaja-0", hangup: true }, dir, undefined, { vaja: true });
    assert.equal(izid.call.status, "zakljucen");
    assert.equal(izid.call.zapisek, undefined);
    const mapa = path.join(await realpath(dir), "zapiski");
    assert.deepEqual(await readdir(mapa).catch(() => []), []);
  });

  it("napaka mape ne podre konca klica", async () => {
    const { dir } = await lastnik();
    // Privzeta mapa je datoteka: zapisek ne more nastati, klic pa se kljub temu zakljuci.
    await writeFile(path.join(dir, "zapiski"), "datoteka");
    const izid = await recordCaller({ callSid: "n1", from: "+38640000002", hangup: true }, dir);
    assert.equal(izid.call.status, "zakljucen");
    assert.equal(izid.call.zapisek, undefined);
  });
});

describe("G5: seznam, odpiranje enega zapiska in varnost poti", () => {
  async function trije(dir: string): Promise<string[]> {
    const a = await zapisiZapisekKlica(klic("l1", "Ana Novak", [2026, 10, 11, 7, 45]), dir);
    const b = await zapisiZapisekKlica(klic("l2", "Boris Kos", [2026, 10, 11, 9, 5]), dir);
    const c = await zapisiZapisekKlica(klic("l3", "", [2026, 10, 10, 16, 30]), dir);
    return [a, b, c];
  }

  it("seznam: najnovejsi zgoraj", async () => {
    const { dir, token } = await lastnik();
    await trije(dir);
    const seznam = await seznamZapiskov(token, dir);
    assert.deepEqual(seznam.map((z) => z.naslov), ["Boris Kos - 2026-11-11 09-05 - +38640000000", "Ana Novak - 2026-11-11 07-45 - +38640000000", "Neznan klicatelj - 2026-11-10 16-30 - +38640000000"]);
    assert.ok(seznam.every((z) => z.id.endsWith(".md") && z.zdruzen === false));
  });

  it("Odpri: vrne vsebino zapiska z seznama", async () => {
    const { dir, token } = await lastnik();
    const [a] = await trije(dir);
    const odprt = await preberiZapisek(a, token, dir);
    assert.equal(odprt.naslov, "Ana Novak - 2026-11-11 07-45 - +38640000000");
    assert.match(odprt.vsebina, /Klicatelj: Potrebujem mizo\./);
  });

  it("ID izven seznama, .., absolutna pot, tuje ime in ne-niz so zavrnjeni", async () => {
    const { dir, token } = await lastnik();
    await trije(dir);
    // Tuja datoteka .md ob mapi zapiskov: prek .. bi jo dosegli, ce streznik ne bi preveril seznama.
    await writeFile(path.join(dir, "skrivnost.md"), "TAJNO");
    const mapa = path.join(await realpath(dir), "zapiski");
    const tuja = path.join(dir, "tuja");
    await mkdir(tuja);
    await writeFile(path.join(tuja, "x.md"), "TAJNO");
    for (const id of ["../skrivnost.md", "..", "../../etc/passwd", "/etc/passwd", path.join(dir, "skrivnost.md"), path.join(tuja, "x.md"), "ni-na-seznamu.md", "", ".md", "a/b.md", "..\\skrivnost.md", "zapiski/../../skrivnost.md", null, undefined, 7, ["x"], { toString: () => "x.md" }]) {
      await assert.rejects(() => preberiZapisek(id, token, dir), /seznamu zapiskov/, String(JSON.stringify(id) ?? id));
    }
    assert.ok((await readdir(mapa)).length >= 3);
  });

  it("simbolna povezava iz mape zapiskov ni na seznamu in se ne bere", async () => {
    const { dir, token } = await lastnik();
    await trije(dir);
    const mapa = path.join(await realpath(dir), "zapiski");
    const zunaj = path.join(dir, "zunaj.md");
    await writeFile(zunaj, "TAJNO");
    await symlink(zunaj, path.join(mapa, "povezava.md"));
    await symlink("/etc/hostname", path.join(mapa, "sistem.md"));
    const seznam = await seznamZapiskov(token, dir);
    assert.ok(!seznam.some((z) => z.id === "povezava.md" || z.id === "sistem.md"));
    await assert.rejects(() => preberiZapisek("povezava.md", token, dir), /seznamu zapiskov/);
    await assert.rejects(() => preberiZapisek("sistem.md", token, dir), /seznamu zapiskov/);
    // Zdruzevanje simbolne povezave prav tako zavrne.
    const ena = seznam[0].id;
    await assert.rejects(() => zdruziZapiske([ena, "povezava.md"], false, token, dir), /seznamu zapiskov/);
  });

  it("imeniki in datoteke drugih koncnic niso zapiski", async () => {
    const { dir, token } = await lastnik();
    await trije(dir);
    const mapa = path.join(await realpath(dir), "zapiski");
    await mkdir(path.join(mapa, "podmapa.md"));
    await writeFile(path.join(mapa, "beležka.txt"), "x");
    await writeFile(path.join(mapa, ".skrita.md"), "x");
    assert.equal((await seznamZapiskov(token, dir)).length, 3);
  });
});

describe("G5: zdruzevanje", () => {
  async function pripravi(dir: string): Promise<{ ana: string; boris: string; neznan: string }> {
    return {
      // Namenoma ustvarjeno v drugem vrstnem redu od casa klica.
      boris: await zapisiZapisekKlica(klic("z2", "Boris Kos", [2026, 10, 11, 9, 5]), dir),
      ana: await zapisiZapisekKlica(klic("z1", "Ana Novak", [2026, 10, 11, 7, 45]), dir),
      neznan: await zapisiZapisekKlica(klic("z3", "", [2026, 10, 10, 16, 30]), dir),
    };
  }

  it("urejeno po casu klica, z naslovi izvirnikov; izvirniki ostanejo nedotaknjeni", async () => {
    const { dir, token } = await lastnik();
    const { ana, boris, neznan } = await pripravi(dir);
    const mapa = path.join(await realpath(dir), "zapiski");
    const prej = await Promise.all([ana, boris, neznan].map((i) => readFile(path.join(mapa, i), "utf8")));
    const zdaj = new Date(2026, 10, 11, 10, 0, 0).toISOString();
    const izid = await zdruziZapiske([boris, ana, neznan], false, token, dir, zdaj);
    assert.equal(izid.id, "Združeni zapisek - 2026-11-11 10-00.md");
    assert.equal(izid.odstranjeni, 0);
    const v = await readFile(path.join(mapa, izid.id), "utf8");
    const razdelki = [...v.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(razdelki, ["Neznan klicatelj - 2026-11-10 16-30 - +38640000000", "Ana Novak - 2026-11-11 07-45 - +38640000000", "Boris Kos - 2026-11-11 09-05 - +38640000000"]);
    assert.ok(v.indexOf("Klicatelj: Potrebujem mizo.") > 0);
    const potem = await Promise.all([ana, boris, neznan].map((i) => readFile(path.join(mapa, i), "utf8")));
    assert.deepEqual(potem, prej);
    const seznam = await seznamZapiskov(token, dir);
    assert.equal(seznam.length, 4);
    assert.equal(seznam.find((z) => z.id === izid.id)?.zdruzen, true);
  });

  it("ponovna zdruzitev v istem trenutku ne prepise obstojece datoteke", async () => {
    const { dir, token } = await lastnik();
    const { ana, boris } = await pripravi(dir);
    const zdaj = new Date(2026, 10, 11, 10, 0, 0).toISOString();
    const prvi = await zdruziZapiske([ana, boris], false, token, dir, zdaj);
    const mapa = path.join(await realpath(dir), "zapiski");
    const vsebina = await readFile(path.join(mapa, prvi.id), "utf8");
    const drugi = await zdruziZapiske([ana, boris], false, token, dir, zdaj);
    assert.notEqual(drugi.id, prvi.id);
    assert.equal(drugi.id, "Združeni zapisek - 2026-11-11 10-00-2.md");
    assert.equal(await readFile(path.join(mapa, prvi.id), "utf8"), vsebina);
  });

  it("vsaj 2 razlicna zapiska; neznan ID zavrne vse in nic ne nastane", async () => {
    const { dir, token } = await lastnik();
    const { ana, boris } = await pripravi(dir);
    const mapa = path.join(await realpath(dir), "zapiski");
    const stevilo = (await readdir(mapa)).length;
    for (const ids of [[], [ana], [ana, ana], "ana", null, [ana, 5]]) {
      await assert.rejects(() => zdruziZapiske(ids, false, token, dir), /vsaj dva/);
    }
    await assert.rejects(() => zdruziZapiske([ana, "../skrivnost.md"], false, token, dir), /seznamu zapiskov/);
    await assert.rejects(() => zdruziZapiske(Array.from({ length: 51 }, (_, i) => `x${i}.md`), false, token, dir), /50/);
    assert.equal((await readdir(mapa)).length, stevilo);
    assert.ok(boris);
  });

  it("odstranjevanje izvirnikov je samo izrecno (odstrani === true)", async () => {
    const { dir, token } = await lastnik();
    const { ana, boris, neznan } = await pripravi(dir);
    const mapa = path.join(await realpath(dir), "zapiski");
    let minuta = 0;
    for (const ne of [undefined, false, "da", 1, "true"]) {
      const izid = await zdruziZapiske([ana, boris], ne, token, dir, new Date(2026, 10, 11, 10, minuta++).toISOString());
      assert.equal(izid.odstranjeni, 0);
      assert.ok((await readdir(mapa)).includes(mapaId(ana)));
    }
    const izid = await zdruziZapiske([ana, boris], true, token, dir, new Date(2026, 10, 12, 11, 0).toISOString());
    assert.equal(izid.odstranjeni, 2);
    const ostalo = await readdir(mapa);
    assert.ok(!ostalo.includes(mapaId(ana)) && !ostalo.includes(mapaId(boris)), "mapa klica gre z zapiskom");
    assert.ok(ostalo.includes(mapaId(neznan)) && ostalo.includes(izid.id));
    assert.match(await readFile(path.join(mapa, izid.id), "utf8"), /## Ana Novak - 2026-11-11 07-45/);
  });

  it("cista logika: razdelki po casu, isti cas po imenu", () => {
    const { vsebina, naslov } = zdruziVsebine(
      [
        { id: "b.md", naslov: "B", cas: "2026-11-11T08:00:00.000Z", vsebina: "# B\n<!-- lina-cas: 2026-11-11T08:00:00.000Z -->\n\ntelo B\n" },
        { id: "a.md", naslov: "A", cas: "2026-11-11T08:00:00.000Z", vsebina: "# A\n\ntelo A\n" },
        { id: "c.md", naslov: "C", cas: "2026-11-11T07:00:00.000Z", vsebina: "telo C" },
      ],
      new Date(2026, 10, 11, 12, 0).toISOString(),
    );
    assert.equal(naslov, "Združeni zapisek - 2026-11-11 12-00");
    assert.deepEqual([...vsebina.matchAll(/^## (.+)$/gm)].map((m) => m[1]), ["C", "A", "B"]);
    assert.ok(!/^# B$/m.test(vsebina), "naslov izvirnika ni podvojen kot glava");
  });
});

describe("G5: Odpri mapo", () => {
  it("odpre samo mapo zapiskov, kanonicna pot, program brez lupine", async () => {
    const { dir, token } = await lastnik();
    const klici: Array<[string, string[]]> = [];
    const izid = await odpriMapoZapiskov(token, dir, async (u, a) => (klici.push([u, a]), true), "linux", { DISPLAY: ":0" });
    const mapa = path.join(await realpath(dir), "zapiski");
    assert.deepEqual(izid, { ok: true, mapa, razlog: "" });
    assert.deepEqual(klici, [["xdg-open", [mapa]]]);
    assert.equal((await lstat(mapa)).isDirectory(), true);
    const win = await odpriMapoZapiskov(token, dir, async (u, a) => (klici.push([u, a]), true), "win32", {});
    assert.equal(klici[1][0], "explorer.exe");
    assert.ok(win.ok);
  });

  it("brez namizja ali ob napaki zagona: ok false, razlog in pot za kopiranje", async () => {
    const { dir, token } = await lastnik();
    let klican = false;
    const brez = await odpriMapoZapiskov(token, dir, async () => ((klican = true), true), "linux", {});
    assert.equal(brez.ok, false);
    assert.equal(klican, false);
    assert.ok(path.isAbsolute(brez.mapa));
    const napaka = await odpriMapoZapiskov(token, dir, async () => false, "linux", { DISPLAY: ":0" });
    assert.equal(napaka.ok, false);
    assert.match(napaka.razlog, /ni mogoče odpreti/);
    const vrze = await odpriMapoZapiskov(token, dir, async () => Promise.reject(new Error("x")), "linux", { WAYLAND_DISPLAY: "w" });
    assert.equal(vrze.ok, false);
  });
});

describe("G5: API zavrne zahteve brez prijave", () => {
  it("vse funkcije zapiskov brez zetona ali z napacnim zetonom vrzejo LinaAuthError", async () => {
    const { dir } = await lastnik();
    const klici: Array<() => Promise<unknown>> = [
      () => seznamZapiskov(null, dir),
      () => preberiZapisek("a.md", null, dir),
      () => zdruziZapiske(["a.md", "b.md"], false, null, dir),
      () => pogledMapeZapiskov(null, dir),
      () => izberiMapoZapiskov(path.join(dir, "x"), null, dir),
      () => odpriMapoZapiskov(null, dir, async () => true),
      () => seznamZapiskov("napacen-zeton", dir),
      () => izberiMapoZapiskov(path.join(dir, "x"), "napacen-zeton", dir),
    ];
    for (const klic1 of klici) await assert.rejects(klic1, LinaAuthError);
    assert.equal(await readdir(path.join(dir, "x")).catch(() => "ni"), "ni", "brez prijave mapa ne nastane");
  });

  it("vsaka serverska funkcija zapiskov v functions.ts uporablja sejo lastnika (sessionToken)", () => {
    const vir = readFileSync(new URL("./functions.ts", import.meta.url), "utf8");
    const imena = ["pogledMapeZapiskovFn", "izberiMapoZapiskovFn", "odpriMapoZapiskovFn", "seznamZapiskovFn", "preberiZapisekFn", "zdruziZapiskeFn"];
    for (const ime of imena) {
      const zacetek = vir.indexOf(`export const ${ime} =`);
      assert.ok(zacetek >= 0, ime);
      const konec = vir.indexOf("\nexport const ", zacetek + 10);
      const telo = vir.slice(zacetek, konec < 0 ? undefined : konec);
      assert.match(telo, /sessionToken\(\)/, ime);
    }
  });

  it("odjemalec ne poslje poti: funkcije za branje in odpiranje imajo samo ID oziroma nic", () => {
    const vir = readFileSync(new URL("./functions.ts", import.meta.url), "utf8");
    const odpri = vir.slice(vir.indexOf("export const odpriMapoZapiskovFn"), vir.indexOf("export const seznamZapiskovFn"));
    assert.ok(!/validator|data/.test(odpri), "odpiranje mape ne sprejme nobenega vhoda");
    assert.ok(lstatSync(new URL("./zapiski.server.ts", import.meta.url)).isFile());
  });
});
