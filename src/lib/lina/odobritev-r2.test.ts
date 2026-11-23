// R2 (15. 11. 2026): strežniška stran odobritve (kanal-claude.server.ts, asistent.server.ts). Vsak preizkus z oznako
// »NAJDBA« brez popravka pade; preizkusi z oznako »OK« potrjujejo obstoječe varovalo (padejo, če varovalo odstraniš).
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { IzvajalecClaudeCode, type Dogodek } from "./asistent.server.ts";
import {
  NAJVEC_PREDOGLED, dokazPrijave, idIzKljuca, nizNaloge, nizOdobritve, ocistiZaTelefon, potVticnice, zgostitevPrikaza, type Dokaz,
} from "./kanal-claude.ts";
import { preberiKanal, pripraviKanal, type NapravaKroga } from "./kanal-claude.server.ts";

const KOREN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SKRIPTA = path.join(KOREN, "scripts", "kanal-claude.mts");

type Naprava = NapravaKroga & { zasebni: KeyObject };
function naprava(pripona = ""): Naprava {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const kljuc = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  return { id: idIzKljuca(kljuc) + pripona, kljuc, zasebni: privateKey };
}
const ANA = naprava("-telefon");
const enkratni = () => randomBytes(16).toString("base64url");
function dokaz(d: Naprava, niz: (cas: number, e: string) => string, cas = Date.now(), e = enkratni()): Dokaz {
  return { cas, enkratni: e, podpis: sign("sha256", Buffer.from(niz(cas, e)), d.zasebni).toString("base64") };
}
const naloga = (d: Naprava, id: string, besedilo: string) => ({
  id, besedilo, posiljatelj: d.id, izvor: "asistent" as const, dokaz: dokaz(d, (c, e) => nizNaloge(id, d.id, besedilo, c, e)),
});
const dokazOdobritve = (d: Naprava, zahtevaId: string, dovoli: boolean, chatId: string, zgostitev: string, cas = Date.now(), e = enkratni()) =>
  dokaz(d, (c, x) => nizOdobritve(zahtevaId, dovoli, d.id, c, x, chatId, zgostitev), cas, e);

async function caka(pogoj: () => boolean, ms = 5000): Promise<void> {
  const konec = Date.now() + ms;
  while (!pogoj()) {
    if (Date.now() > konec) throw new Error("rok cakanja potekel");
    await new Promise((r) => setTimeout(r, 20));
  }
}
const premor = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Kanal = { p: ChildProcess; dir: string; pot: string; izhod: Array<Record<string, any>>; poslji: (o: unknown) => void;
  obvestila: (m: string) => Array<Record<string, any>>; pospravi: () => Promise<void> };

async function zazeniKanal(): Promise<Kanal> {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-r2-"));
  await pripraviKanal([ANA], dir);
  const p = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", SKRIPTA], {
    cwd: KOREN, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LINA_DATA: dir }, stdio: ["pipe", "pipe", "pipe"],
  });
  const izhod: Array<Record<string, any>> = [];
  let ost = "";
  p.stdout!.setEncoding("utf8");
  p.stdout!.on("data", (k: string) => {
    ost += k;
    let i: number;
    while ((i = ost.indexOf("\n")) >= 0) { izhod.push(JSON.parse(ost.slice(0, i))); ost = ost.slice(i + 1); }
  });
  p.stderr!.on("data", () => {});
  const poslji = (x: unknown) => { p.stdin!.write(JSON.stringify(x) + "\n"); };
  const k: Kanal = {
    p, dir, pot: potVticnice(dir), izhod, poslji, obvestila: (m) => izhod.filter((x) => x.method === m),
    pospravi: async () => {
      if (p.exitCode === null && p.signalCode === null) { p.kill("SIGTERM"); await new Promise((r) => p.once("exit", r)); }
      await rm(dir, { recursive: true, force: true });
    },
  };
  poslji({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "r2", version: "0" } } });
  await caka(() => izhod.some((x) => x.id === 1), 15000);
  poslji({ jsonrpc: "2.0", method: "notifications/initialized" });
  await caka(() => existsSync(k.pot));
  return k;
}

function surovo(pot: string) {
  const s = net.connect(pot);
  const prejeto: Array<Record<string, any>> = [];
  let zaprta = false;
  let ost = "";
  s.setEncoding("utf8");
  s.on("data", (d: string) => {
    ost += d;
    let i: number;
    while ((i = ost.indexOf("\n")) >= 0) { prejeto.push(JSON.parse(ost.slice(0, i))); ost = ost.slice(i + 1); }
  });
  s.on("error", () => { zaprta = true; });
  s.on("close", () => { zaprta = true; });
  const vrstica = (o: unknown) => s.write(JSON.stringify(o) + "\n");
  return {
    s, prejeto, vrstica,
    async prijavi(zeton: string) {
      const c = randomBytes(24).toString("base64url");
      vrstica({ vrsta: "pozdrav", c });
      await caka(() => prejeto.some((x) => x.vrsta === "izziv") || zaprta);
      const iz = prejeto.find((x) => x.vrsta === "izziv")!;
      vrstica({ vrsta: "prijava", dokaz: dokazPrijave(zeton, "odjemalec", c, iz.s) });
      await caka(() => prejeto.some((x) => x.vrsta === "pozdravljen") || zaprta);
    },
  };
}

const KANALSKO = "notifications/claude/channel";
const DOVOLJENJE = "notifications/claude/channel/permission";
const zahteva = (k: Kanal, id: string, opis = "Pokaze stanje", orodje = "Bash", predogled = '{"command":"git status"}') =>
  k.poslji({ jsonrpc: "2.0", method: "notifications/claude/channel/permission_request", params: { request_id: id, tool_name: orodje, description: opis, input_preview: predogled } });

/** Kanal z eno nalogo ANE in surovo prijavljeno »Lino« (preizkus vidi vse, kar kanal poslje Lini). */
async function kanalZNalogo(id: string) {
  const k = await zazeniKanal();
  const r = surovo(k.pot);
  await r.prijavi((await preberiKanal(k.dir)).zeton!);
  r.vrstica({ vrsta: "naloga", naloga: naloga(ANA, id, "naredi nekaj") });
  await caka(() => k.obvestila(KANALSKO).length === 1);
  const odobritve = () => r.prejeto.filter((x) => x.vrsta === "odobritev");
  const zavrnjeno = () => r.prejeto.filter((x) => x.vrsta === "zavrnjeno");
  const odgovori = (zahtevaId: string, dovoli: boolean, zg: string, d?: Dokaz, dodatno: Record<string, unknown> = {}) =>
    r.vrstica({ vrsta: "odobritev", zahtevaId, dovoli, posiljatelj: ANA.id, dokaz: d ?? dokazOdobritve(ANA, zahtevaId, dovoli, id, zg), ...dodatno });
  return { k, r, odobritve, zavrnjeno, odgovori };
}

test("R2-1 OK: streznik zgostitev vzame iz SVOJE shranjene vsebine; polje zgostitev v zahtevku se ne uposteva", async () => {
  const { k, r, odobritve, zavrnjeno, odgovori } = await kanalZNalogo("naloga-r2-0001");
  try {
    zahteva(k, "abcde", "Brise", "Bash", '{"command":"rm -rf ~"}');
    await caka(() => odobritve().length === 1);
    const prava = zgostitevPrikaza("Bash", '{"command":"rm -rf ~"}', "Brise");
    assert.equal(odobritve()[0].zgostitev, prava);
    // napadalec: lastnik je videl/podpisal »ls«; zahtevek prinese polje zgostitev za »ls« - streznik ga ne sme uporabiti
    const lazna = zgostitevPrikaza("Bash", '{"command":"ls"}', "Pokaze");
    odgovori("abcde", true, lazna, undefined, { zgostitev: lazna, orodje: "Bash", predogled: '{"command":"ls"}', opis: "Pokaze" });
    await caka(() => zavrnjeno().length === 1);
    assert.equal(k.obvestila(DOVOLJENJE).length, 0);
    odgovori("abcde", true, prava);
    await caka(() => k.obvestila(DOVOLJENJE).length === 1);
  } finally {
    r.s.destroy();
    await k.pospravi();
  }
});

// SR-3 (kanal-claude.server.ts): druga vsebina pod odprtim ID je spor - prvotna zahteva se ZAPRE in nikoli ne dobi »allow«,
// odobritev ostane samo v terminalu. Prej (R2-2a) je prvotna ostala odobrljiva; strozje pravilo velja od SR-3 (22. 11. 2026 preizkus usklajen).
test("R2-2a/SR-3: isti zahtevaId z drugo vsebino zapre odprto zahtevo; druga ne gre na telefon, odobritev prve ne da allow", async () => {
  const { k, r, odobritve, zavrnjeno, odgovori } = await kanalZNalogo("naloga-r2-0002");
  try {
    zahteva(k, "abcde", "Pokaze stanje", "Bash", '{"command":"git status"}');
    await caka(() => odobritve().length === 1);
    const prva = odobritve()[0].zgostitev;
    zahteva(k, "abcde", "Pokaze stanje", "Bash", '{"command":"rm -rf ~"}');            // isti ID, druga vsebina
    await premor(300);
    assert.equal(odobritve().length, 1, "druga zahteva z istim ID ne sme na telefon");
    odgovori("abcde", true, prva);
    await caka(() => zavrnjeno().length === 1, 2000);
    assert.equal(k.obvestila(DOVOLJENJE).filter((o) => o.params?.behavior === "allow").length, 0, "zaprta zahteva ne sme dobiti allow");
  } finally {
    r.s.destroy();
    await k.pospravi();
  }
});

test("R2-2b NAJDBA: po odgovoru se isti zahtevaId ne odpre znova (ne z isto ne z drugo vsebino)", async () => {
  const { k, r, odobritve, zavrnjeno, odgovori } = await kanalZNalogo("naloga-r2-0003");
  try {
    zahteva(k, "abcde");
    await caka(() => odobritve().length === 1);
    odgovori("abcde", false, odobritve()[0].zgostitev);
    await caka(() => k.obvestila(DOVOLJENJE).length === 1);
    zahteva(k, "abcde", "Brise", "Bash", '{"command":"rm -rf ~"}');
    zahteva(k, "abcde");
    await premor(300);
    assert.equal(odobritve().length, 1, "porabljen ID se ne sme odpreti znova");
    odgovori("abcde", true, zgostitevPrikaza("Bash", '{"command":"rm -rf ~"}', "Brise"));
    await caka(() => zavrnjeno().length === 1);
    assert.equal(k.obvestila(DOVOLJENJE).length, 1);
  } finally {
    r.s.destroy();
    await k.pospravi();
  }
});

test("R2-3 OK: odobritev s casom zunaj okna ali z ze uporabljenim enkratnim nizom se zavrne (tudi z novim, pravim podpisom)", async () => {
  const { k, r, odobritve, zavrnjeno, odgovori } = await kanalZNalogo("naloga-r2-0004");
  try {
    zahteva(k, "abcde");
    await caka(() => odobritve().length === 1);
    const zg = odobritve()[0].zgostitev;
    const id = "naloga-r2-0004";
    odgovori("abcde", true, zg, dokazOdobritve(ANA, "abcde", true, id, zg, Date.now() - 3 * 60_000));     // prestar
    odgovori("abcde", true, zg, dokazOdobritve(ANA, "abcde", true, id, zg, Date.now() + 3 * 60_000));     // iz prihodnosti
    await caka(() => zavrnjeno().length === 2);
    assert.equal(k.obvestila(DOVOLJENJE).length, 0);
    const e = enkratni();
    odgovori("abcde", true, zg, dokazOdobritve(ANA, "abcde", true, id, zg, Date.now(), e));
    await caka(() => k.obvestila(DOVOLJENJE).length === 1);
    zahteva(k, "bcdef");
    await caka(() => odobritve().length === 2);
    const zg2 = odobritve()[1].zgostitev;
    // NOV veljaven podpis za bcdef, a z enkratnim nizom, ki je ze bil uporabljen: zavrne ga samo preverba enkratnosti
    odgovori("bcdef", true, zg2, dokazOdobritve(ANA, "bcdef", true, id, zg2, Date.now(), e));
    await caka(() => zavrnjeno().length === 3);
    assert.equal(k.obvestila(DOVOLJENJE).length, 1);
  } finally {
    r.s.destroy();
    await k.pospravi();
  }
});

test("R2-4 OK: dva veljavna odgovora za isti ID hkrati (allow + deny v istem paketu): velja natanko prvi", async () => {
  const { k, r, odobritve, zavrnjeno } = await kanalZNalogo("naloga-r2-0005");
  try {
    zahteva(k, "abcde");
    await caka(() => odobritve().length === 1);
    const zg = odobritve()[0].zgostitev;
    const id = "naloga-r2-0005";
    const vrsta = (dovoli: boolean) => JSON.stringify({ vrsta: "odobritev", zahtevaId: "abcde", dovoli, posiljatelj: ANA.id, dokaz: dokazOdobritve(ANA, "abcde", dovoli, id, zg) });
    r.s.write(vrsta(true) + "\n" + vrsta(false) + "\n" + vrsta(true) + "\n");
    await caka(() => zavrnjeno().length === 2);
    await premor(100);
    assert.deepEqual(k.obvestila(DOVOLJENJE).map((x) => x.params), [{ request_id: "abcde", behavior: "allow" }]);
  } finally {
    r.s.destroy();
    await k.pospravi();
  }
});

test("R2-5a NAJDBA: orodje s prelomom vrstice ali znaki Cc/Cf ne gre na telefon kot »neznano orodje« (odobritev samo v terminalu)", async () => {
  const { k, r, odobritve } = await kanalZNalogo("naloga-r2-0006");
  try {
    const slaba = ["Bash\n", "Bash\nrm", "Bash\u202e", "Ba\u200bsh", "Bash\u2028", "Bash\u0085", "Bash\ufeff", "Bash\r"];
    slaba.forEach((o, i) => zahteva(k, "abcd" + "efghijkmn"[i], "opis", o, "ls"));
    await caka(() => r.prejeto.filter((x) => x.vrsta === "odgovor").length >= slaba.length, 3000).catch(() => undefined);
    await premor(200);
    assert.deepEqual(odobritve().map((x) => x.orodje), [], "zahteva z neveljavnim orodjem ne sme na telefon");
    // lastnik izve, da odobritev caka v terminalu (naloga ne visi brez sledu)
    assert.ok(r.prejeto.some((x) => x.vrsta === "odgovor" && x.koncano === false && /racunalnik/.test(x.besedilo)));
    zahteva(k, "bcdfg", "opis", "mcp__lina__reply", "ls");                                       // veljavno ime gre naprej
    await caka(() => odobritve().length === 1);
    assert.equal(odobritve()[0].orodje, "mcp__lina__reply");
  } finally {
    r.s.destroy();
    await k.pospravi();
  }
});

test("R2-5b NAJDBA: predogled in opis brez nevidnih znakov (Default_Ignorable), vedno dobro oblikovan UTF-16 in vidno odrezan", () => {
  // OK (obstojece): Cc, Cf, U+2028/2029/0085 se zamenjajo s presledkom, prelom vrstice ostane
  assert.equal(ocistiZaTelefon("a\u202eb\u200bc\u200cd\u200de\ufefff\u2028g\u2029h\u0085i\u0000j\tk\rl\nm"), "a b c d e f g h i j k l\nm");
  // NAJDBA: nevidni znaki, ki niso Cc/Cf (Hangul filler, variation selector, combining grapheme joiner, Mongolian FVS)
  for (const z of ["\u3164", "\u115f", "\u1160", "\uffa0", "\ufe0f", "\u034f", "\u180b", "\u{e0100}"]) {
    assert.equal(ocistiZaTelefon(`rm${z}x`), "rm x", `U+${z.codePointAt(0)!.toString(16)} mora biti viden`);
  }
  // NAJDBA: rez sredi para nadomestnih znakov je dal osamljen nadomestni znak (Node in Kotlin ga kodirata razlicno -> zgostitev)
  const dolgo = "a".repeat(NAJVEC_PREDOGLED - 1) + "😀" + "konec";
  const o = ocistiZaTelefon(dolgo);
  assert.ok((o as string & { isWellFormed(): boolean }).isWellFormed(), "rez ne sme pustiti osamljenega nadomestnega znaka");
  assert.ok(o.length <= NAJVEC_PREDOGLED, "trda zgornja meja");
  assert.ok(o.endsWith("…"), "odrezano besedilo mora imeti viden znak, da ni celo");
  assert.equal(ocistiZaTelefon("x\ud800y"), "x\ufffdy");
  // kratko besedilo ostane nespremenjeno (brez oznake)
  assert.equal(ocistiZaTelefon("git status"), "git status");
});

// Kasnejse pravilo (kanal-claude.server.ts, »predogled je predolg za varno odobritev«): odrezanega ukaza lastnik na telefonu ne
// odobri na slepo - gre samo v terminal. Dolg OPIS pri kratkem predogledu pa gre na telefon omejen; zgostitev je iz poslanega besedila.
test("R2-5c: odrezan predogled ne gre na telefon (samo terminal); dolg opis je omejen, zgostitev iz tocno poslanega besedila", async () => {
  const { k, r, odobritve, odgovori } = await kanalZNalogo("naloga-r2-0007");
  try {
    zahteva(k, "abcde", "o".repeat(20_000), "Bash", "p".repeat(NAJVEC_PREDOGLED - 1) + "😀rm -rf ~");
    await premor(300);
    assert.equal(odobritve().length, 0, "odrezan predogled ne sme na telefon");
    zahteva(k, "fghij", "o".repeat(20_000), "Bash", '{"command":"git status"}');
    await caka(() => odobritve().length === 1);
    const x = odobritve()[0];
    assert.ok(x.opis.length <= NAJVEC_PREDOGLED && x.predogled.length <= NAJVEC_PREDOGLED);
    assert.equal(x.zgostitev, zgostitevPrikaza(x.orodje, x.predogled, x.opis));
    odgovori("fghij", true, x.zgostitev);
    await caka(() => k.obvestila(DOVOLJENJE).length === 1);
  } finally {
    r.s.destroy();
    await k.pospravi();
  }
});

/** Lazni kanal (program z zetonom na mestu kanala): Lina mora sama preveriti, da se zgostitev ujema s poslano vsebino. */
test("R2-L NAJDBA: Lina ne posreduje telefonu odobritve, katere zgostitev ali orodje se ne ujema s poslano vsebino", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-r2l-"));
  const pot = path.join(dir, "lazni.sock");
  const zeton = randomBytes(32).toString("base64url");
  const poslji = (s: net.Socket, o: unknown) => s.write(JSON.stringify(o) + "\n");
  const srv = net.createServer((s) => {
    let ost = "";
    s.setEncoding("utf8");
    s.on("data", (d: string) => {
      ost += d;
      let i: number;
      while ((i = ost.indexOf("\n")) >= 0) {
        const m = JSON.parse(ost.slice(0, i));
        ost = ost.slice(i + 1);
        if (m.vrsta === "pozdrav") { const sv = randomBytes(24).toString("base64url"); poslji(s, { vrsta: "izziv", s: sv, dokaz: dokazPrijave(zeton, "streznik", m.c, sv) }); }
        if (m.vrsta === "prijava") poslji(s, { vrsta: "pozdravljen", seja: true, apiKljuc: false, aktivne: [] });
        if (m.vrsta === "naloga") {
          const chatId = m.naloga.id;
          const ok = zgostitevPrikaza("Bash", "ls", "Pokaze");
          poslji(s, { vrsta: "odobritev", chatId, zahtevaId: "abcde", orodje: "Bash", predogled: "ls", opis: "Pokaze", zgostitev: zgostitevPrikaza("Bash", "rm -rf ~", "Pokaze") });
          poslji(s, { vrsta: "odobritev", chatId, zahtevaId: "bcdef", orodje: "neznano orodje", predogled: "ls", opis: "Pokaze", zgostitev: zgostitevPrikaza("neznano orodje", "ls", "Pokaze") });
          poslji(s, { vrsta: "odobritev", chatId, zahtevaId: "cdefg", orodje: "Bash", predogled: "l\u202es", opis: "Pokaze", zgostitev: zgostitevPrikaza("Bash", "l\u202es", "Pokaze") });
          poslji(s, { vrsta: "odobritev", chatId, zahtevaId: "defgh", orodje: "Bash", predogled: "ls", opis: "Pokaze", zgostitev: ok });
        }
      }
    });
  });
  await new Promise<void>((ok) => srv.listen(pot, ok));
  const l = new IzvajalecClaudeCode({ pot, zeton: async () => zeton, ozjiKrog: () => new Set([ANA.id]) });
  try {
    const d: Dogodek[] = [];
    await l.zacni(naloga(ANA, "naloga-r2-l001", "pokazi datoteke"), (x) => d.push(x));
    await caka(() => d.some((x) => x.vrsta === "odobritev" && x.zahtevaId === "defgh"));
    await premor(100);
    assert.deepEqual(d.filter((x) => x.vrsta === "odobritev").map((x) => (x as { zahtevaId: string }).zahtevaId), ["defgh"]);
  } finally {
    l.zapri();
    srv.close();
    await rm(dir, { recursive: true, force: true });
  }
});
