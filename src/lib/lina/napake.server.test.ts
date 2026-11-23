import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  handleNapakeRequest,
  pridobiZetonNapake,
  pridobiStanjeNapak,
  shraniNastavitveNapak,
} from "./napake.server.ts";
import * as napakeModul from "./napake.server.ts";
import { writeJson, readJsonFile } from "./store.server.ts";
import { odsifrirajSkrivnost, sifrirajSkrivnost } from "./keys.server.ts";

describe("Napake API", () => {
  it("izvede osnovne preizkuse", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lina-napake-test-"));
    try {
      const zeton = await pridobiZetonNapake(dir);
      
      const reqLocal = (body: string, token: string = zeton, naslov = "127.0.0.1") => {
        const headers = new Headers();
        if (token) headers.set("authorization", `Bearer ${token}`);
        headers.set("host", "localhost:8080");
        return { req: new Request("http://localhost:8080/api/napake", { method: "POST", headers, body }), naslov };
      };

      // Zavrnitev brez zetona
      const rBrez = await handleNapakeRequest(reqLocal("{}", "").req, "127.0.0.1", dir);
      assert.equal(rBrez.status, 403);

      // Tuji naslov
      const rTuj = await handleNapakeRequest(reqLocal("{}", zeton, "203.0.113.7").req, "203.0.113.7", dir);
      assert.equal(rTuj.status, 403);

      // Preveliko
      const velika = "A".repeat(3000);
      const rVelika = await handleNapakeRequest(reqLocal(velika).req, "127.0.0.1", dir);
      assert.equal(rVelika.status, 413);

      // Ciscenje podatkov in prvi vnos
      const body1 = JSON.stringify({
        naprava: "OnePlus", cas: "10:00", vrsta: "crash",
        proces: "test.app", izjema: "Error at /home/uporabnik/foo and email oseba@example.com with IP 192.168.1.1 and phone +38640123456"
      });
      const r1 = await handleNapakeRequest(reqLocal(body1).req, "127.0.0.1", dir);
      assert.equal(r1.status, 200);

      let data = await readJsonFile<any>(dir, "napake.json");
      assert.equal(data.vnosi.length, 1);
      assert.equal(data.vnosi[0].stevec, 1);
      assert.ok(data.vnosi[0].izjema.includes("USER"));
      assert.ok(data.vnosi[0].izjema.includes("EMAIL@DOMAIN.COM"));
      assert.ok(data.vnosi[0].izjema.includes("IP.AD.DR.ESS"));
      assert.ok(data.vnosi[0].izjema.includes("PHONE_NUMBER"));

      // Zdruzevanje
      const r2 = await handleNapakeRequest(reqLocal(body1).req, "127.0.0.1", dir);
      assert.equal(r2.status, 200);
      data = await readJsonFile<any>(dir, "napake.json");
      assert.equal(data.vnosi.length, 1);
      assert.equal(data.vnosi[0].stevec, 2);

    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("NAP1/NAP5: hkratni zahtevki ne izgubijo vnosov in nastavitev", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lina-napake-test-"));
    try {
      const zeton = await pridobiZetonNapake(dir);
      const mk = (i: number) => handleNapakeRequest(new Request("http://localhost:8080/api/napake", {
        method: "POST", headers: { authorization: `Bearer ${zeton}`, host: "localhost:8080" },
        body: JSON.stringify({ naprava: "TV", cas: "10:00", vrsta: "crash", proces: `p${i}`, izjema: "x" }),
      }), "127.0.0.1", dir);
      const r = await Promise.all(Array.from({ length: 20 }, (_, i) => mk(i)));
      assert.ok(r.every((x) => x.status === 200));
      const data = await readJsonFile<any>(dir, "napake.json");
      assert.equal(data.vnosi.length, 20);
      assert.ok(data.zetonSifra, "zeton ostane");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("NAP4/NAP9: cistenje ne pusti delckov, JSON null je 400, napacen zeton 403", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lina-napake-test-"));
    try {
      const zeton = await pridobiZetonNapake(dir);
      const post = (body: string, tk = zeton) => handleNapakeRequest(new Request("http://localhost:8080/api/napake", {
        method: "POST", headers: { authorization: `Bearer ${tk}`, host: "localhost:8080" }, body,
      }), "127.0.0.1", dir);
      assert.equal((await post("null")).status, 400);
      assert.equal((await post("[]")).status, 400);
      assert.equal((await post("{}", "napacen")).status, 403);
      await post(JSON.stringify({ naprava: "TV", proces: "p", izjema: "x /home/ime.priimek/f in C:\\Users\\Ime Priimek\\f in /home/mi\u0161o/g ?token=abc123 in 02:00:11:22:33:44" }));
      await post(JSON.stringify({ naprava: "TV", proces: "q", izjema: "y".repeat(190) + " ime.priimek@example.com" }));
      const f = await readJsonFile<any>(dir, "napake.json");
      const vse = JSON.stringify(f.vnosi);
      assert.ok(!/priimek|Priimek|\u0161o|abc123|02:00:11/i.test(vse), vse);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("nastavitve napak: branje, shranjevanje, zeton, pozabi; napacna stevilka zavrnjena", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lina-napake-nastavitve-"));
    try {
      const zacetno = await pridobiStanjeNapak(dir);
      assert.equal(zacetno.obvesti, false);
      assert.equal(zacetno.stevilkaVpisana, false);
      await assert.rejects(() => shraniNastavitveNapak({ obvesti: true, stevilka: "ni stevilka" }, dir));
      const s1 = await shraniNastavitveNapak({ obvesti: true, stevilka: "+38640123456" }, dir);
      assert.equal(s1.obvesti, true);
      assert.equal(s1.stevilkaVpisana, true);
      const zeton = await pridobiZetonNapake(dir);
      assert.ok(zeton.length > 10);
      assert.equal((await pridobiStanjeNapak(dir)).zetonZnan, true);
      assert.equal((await pridobiStanjeNapak(dir)).stevilkaVpisana, true, "zeton ne povozi stevilke");
      const s2 = await shraniNastavitveNapak({ pozabiStevilko: true }, dir);
      assert.equal(s2.obvesti, false);
      assert.equal(s2.stevilkaVpisana, false);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("NAP10/NAP12: masterKey atomarnost (dva procesa in 20 klicev) ter 20 vzporednih zapisov", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lina-napake-race-"));
    try {
      // 1. Tekmovanje 20 hkratnih klicev sifrirajSkrivnost na svezi mapi brez .kljuc
      const sifre = await Promise.all(Array.from({ length: 20 }, (_, i) => sifrirajSkrivnost(`skrivnost-${i}`, dir)));
      for (let i = 0; i < 20; i++) {
        assert.equal(await odsifrirajSkrivnost(sifre[i], dir), `skrivnost-${i}`, `odsifriranje ${i} mora uspeti (brez tihe zamenjave kljuca)`);
      }
      const kljuc1 = await readFile(path.join(dir, ".kljuc"));
      assert.equal(kljuc1.length, 32);

      // 2. Tekmovanje dveh locenih procesov ob ustvarjanju .kljuc v novi mapi
      const dirProc = await mkdtemp(path.join(tmpdir(), "lina-napake-proc-"));
      try {
        const zaženiProces = (i: number) =>
          new Promise<string>((resolve, reject) => {
            const p = spawn(
              process.execPath,
              [
                "--experimental-strip-types",
                "-e",
                `import { sifrirajSkrivnost } from "./src/lib/lina/keys.server.ts"; sifrirajSkrivnost("vrednost-" + process.argv[2], process.argv[1]).then(s => process.stdout.write(JSON.stringify(s)));`,
                dirProc,
                String(i),
              ],
              { cwd: path.resolve(import.meta.dirname, "..", "..", "..") },
            );
            let out = "";
            let err = "";
            p.stdout.on("data", (d) => (out += String(d)));
            p.stderr.on("data", (d) => (err += String(d)));
            p.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err || `koda ${code}`))));
          });
        const [sA, sB] = await Promise.all([zaženiProces(1), zaženiProces(2)]);
        assert.equal(await odsifrirajSkrivnost(JSON.parse(sA), dirProc), "vrednost-1", "prvi proces mora imeti veljavno sifro");
        assert.equal(await odsifrirajSkrivnost(JSON.parse(sB), dirProc), "vrednost-2", "drugi proces mora imeti veljavno sifro");
      } finally {
        await rm(dirProc, { recursive: true, force: true });
      }

      // 3. 20 vzporednih zapisov napak z vstavljivim SMS posiljanjem
      const zeton = await pridobiZetonNapake(dir);
      await shraniNastavitveNapak({ obvesti: true, stevilka: "+38640123456" }, dir);
      let smsStevec = 0;
      const odgovori = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          handleNapakeRequest(
            new Request("http://localhost:8080/api/napake", {
              method: "POST",
              headers: { authorization: `Bearer ${zeton}`, host: "localhost:8080" },
              body: JSON.stringify({ naprava: "TV", cas: "10:00", vrsta: "crash", proces: `vzporedno-${i}`, izjema: `napaka-${i}` }),
            }),
            "127.0.0.1",
            dir,
            async () => {
              smsStevec++;
            },
          ),
        ),
      );
      assert.ok(odgovori.every((r) => r.status === 200));
      const koncno = await readJsonFile<any>(dir, "napake.json");
      assert.equal(koncno.vnosi.length, 20);
      assert.equal(smsStevec, 3, "omejitev 3/uro velja tudi ob 20 vzporednih zapisih");
      const datoteke = await readdir(dir);
      assert.ok(!datoteke.some((f) => f.endsWith(".tmp") || f.endsWith(".lock")), "brez ostankov tmp ali lock datotek");
    } finally {
      napakeModul.ponastaviOmejitveNapak?.();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("NAP10/NAP12: neveljaven JSON v napake.json se premakne v napake.json.pokvarjen in zacne cisto (brez 500)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lina-napake-pokvarjen-"));
    try {
      const zeton = await pridobiZetonNapake(dir);
      const pokvarjenoBesedilo = "{ neveljaven JSON: [1, 2";
      await writeFile(path.join(dir, "napake.json"), pokvarjenoBesedilo, "utf8");

      // Branje stanja ne vrze 500, temvec premakne datoteko v napake.json.pokvarjen in vrne cisto stanje
      const stanje = await pridobiStanjeNapak(dir);
      assert.deepEqual(stanje.vnosi, []);
      assert.equal(stanje.obvesti, false);
      assert.equal(await readFile(path.join(dir, "napake.json.pokvarjen"), "utf8"), pokvarjenoBesedilo);

      // Tudi zapis nove napake po pokvarjeni datoteki uspe z 200 in zacne cisto
      await writeFile(path.join(dir, "napake.json"), "pokvarjeno-2", "utf8");
      const r = await handleNapakeRequest(
        new Request("http://localhost:8080/api/napake", {
          method: "POST",
          headers: { authorization: `Bearer ${zeton}`, host: "localhost:8080" },
          body: JSON.stringify({ naprava: "Tel", proces: "app", izjema: "nova napaka" }),
        }),
        "127.0.0.1",
        dir,
      );
      assert.equal(r.status, 200);
      assert.equal(await readFile(path.join(dir, "napake.json.pokvarjen"), "utf8"), "pokvarjeno-2");
      const cisto = await readJsonFile<any>(dir, "napake.json");
      assert.equal(cisto.vnosi.length, 1);
      assert.equal(cisto.vnosi[0].izjema, "nova napaka");
    } finally {
      napakeModul.ponastaviOmejitveNapak?.();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("NAP11/NAP12: kvota SMS (3/uro, 10/dan), vstavljivo posiljanje in obrezovanje obvestilaDana", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lina-napake-kvota-"));
    try {
      const zeton = await pridobiZetonNapake(dir);
      await shraniNastavitveNapak({ obvesti: true, stevilka: "+38640123456" }, dir);

      const posli = (proces: string, smsFn: (stevilka: string, sporocilo: string) => Promise<boolean | void>) =>
        handleNapakeRequest(
          new Request("http://localhost:8080/api/napake", {
            method: "POST",
            headers: { authorization: `Bearer ${zeton}`, host: "localhost:8080" },
            body: JSON.stringify({ naprava: "TV", proces, izjema: "napaka" }),
          }),
          "127.0.0.1",
          dir,
          smsFn,
        );

      // 1. Ce posiljanje vrne false (npr. Twilio ni povezan), se kvota NE porabi
      const rBrez = await posli("brez-twilio", async () => false);
      assert.equal(rBrez.status, 200);
      let shranjeno = await readJsonFile<any>(dir, "napake.json");
      assert.equal(shranjeno.obvestilaDana.length, 0, "kvota se brez poskusa posiljanja ne steje");

      // 2. Vstavimo 50 starih zapisov (> 24h) v obvestilaDana in preverimo obrezovanje ter mejo 3/uro
      const zdaj = Date.now();
      shranjeno.obvestilaDana = Array.from({ length: 50 }, (_, i) => zdaj - (25 + i) * 3600_000);
      await writeJson(dir, "napake.json", shranjeno);

      const poslanaSporocila: Array<{ stevilka: string; sporocilo: string }> = [];
      for (let i = 1; i <= 5; i++) {
        const odg = await posli(`proc-ura-${i}`, async (stevilka, sporocilo) => {
          poslanaSporocila.push({ stevilka, sporocilo });
        });
        assert.equal(odg.status, 200);
      }
      assert.equal(poslanaSporocila.length, 3, "najvec 3 SMS na uro");
      assert.equal(poslanaSporocila[0].stevilka, "+38640123456");
      shranjeno = await readJsonFile<any>(dir, "napake.json");
      assert.equal(shranjeno.obvestilaDana.length, 3, "stari zapisi so obrezani, ostanejo samo 3 novi");

      // 3. Meja 10/dan: 9 zapisov izpred 2 ur + novi zapisi -> dovoli samo se 1 SMS (skupaj 10)
      shranjeno.obvestilaDana = Array.from({ length: 9 }, (_, i) => Date.now() - (2 * 3600_000 + i * 1000));
      await writeJson(dir, "napake.json", shranjeno);
      let dnevniStevec = 0;
      for (let i = 1; i <= 3; i++) {
        const odg = await posli(`proc-dan-${i}`, async () => {
          dnevniStevec++;
        });
        assert.equal(odg.status, 200);
      }
      assert.equal(dnevniStevec, 1, "najvec 10 SMS na dan");
      shranjeno = await readJsonFile<any>(dir, "napake.json");
      assert.equal(shranjeno.obvestilaDana.length, 10);
    } finally {
      napakeModul.ponastaviOmejitveNapak?.();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("NAP11/NAP12: napaka Twilio ne podre zapisa in se zabelezi brez osebnih podatkov", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lina-napake-twilio-"));
    try {
      const zeton = await pridobiZetonNapake(dir);
      await shraniNastavitveNapak({ obvesti: true, stevilka: "+38640123456" }, dir);

      const opozorila: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: unknown[]) => opozorila.push(args.map(String).join(" "));
      try {
        const r = await handleNapakeRequest(
          new Request("http://localhost:8080/api/napake", {
            method: "POST",
            headers: { authorization: `Bearer ${zeton}`, host: "localhost:8080" },
            body: JSON.stringify({ naprava: "TV", proces: "predvajalnik", izjema: "padec kodeka" }),
          }),
          "127.0.0.1",
          dir,
          async () => {
            throw new Error("Twilio HTTP 503 za +38640999888 in oseba@example.com v /home/uporabnik/skrivnost");
          },
        );
        assert.equal(r.status, 200, "napaka Twilio ne podre zapisa napake");
      } finally {
        console.warn = origWarn;
      }

      const shranjeno = await readJsonFile<any>(dir, "napake.json");
      assert.equal(shranjeno.vnosi.length, 1);
      assert.equal(shranjeno.vnosi[0].proces, "predvajalnik");
      assert.ok(typeof shranjeno.zadnjaNapakaSms === "string" && shranjeno.zadnjaNapakaSms.length > 0, "razlog napake Twilio je zabelezen");
      assert.ok(!/\+38640999888|oseba@example\.com|uporabnik\/skrivnost/i.test(shranjeno.zadnjaNapakaSms), "brez osebnih podatkov v zabelezeni napaki");
      assert.equal(opozorila.length, 1);
      assert.ok(!/\+38640999888|oseba@example\.com|uporabnik\/skrivnost/i.test(opozorila[0]), "brez osebnih podatkov v dnevniku");

      // Preverba posljiSmsTwilio ob napaki HTTP
      const sifra = await sifrirajSkrivnost("skrivnost-kljuca-1234567890", dir);
      await writeJson(dir, "twilio.json", {
        sid: "AC" + "0".repeat(32),
        kljucSid: "SK" + "1".repeat(32),
        ...sifra,
      });
      await assert.rejects(
        () =>
          napakeModul.posljiSmsTwilio("+38640123456", "test", dir, async () => ({
            status: 500,
            json: { message: "Internal error" },
          })),
        /Twilio stevilke HTTP 500/,
      );
    } finally {
      napakeModul.ponastaviOmejitveNapak?.();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("NAP12: rebinding (Host ni localhost -> zavrnjeno)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lina-napake-rebind-"));
    try {
      const zeton = await pridobiZetonNapake(dir);
      const telo = JSON.stringify({ naprava: "TV", proces: "p", izjema: "x" });

      const seznamGlav: Array<Record<string, string>> = [
        { authorization: `Bearer ${zeton}`, host: "napadalec.example.com" },
        { authorization: `Bearer ${zeton}`, host: "napadalec.example.com:8080" },
        { authorization: `Bearer ${zeton}`, host: "192.168.1.50:8080" },
        { authorization: `Bearer ${zeton}`, host: "localhost:8080", origin: "http://napadalec.example.com" },
        { authorization: `Bearer ${zeton}`, host: "localhost:8080", "x-forwarded-for": "203.0.113.5" },
      ];
      for (const glave of seznamGlav) {
        const odg = await handleNapakeRequest(
          new Request("http://localhost:8080/api/napake", {
            method: "POST",
            headers: glave,
            body: telo,
          }),
          "127.0.0.1",
          dir,
        );
        assert.equal(odg.status, 403, `glave ${JSON.stringify(glave)} morajo biti zavrnjene`);
      }

      const stanje = await pridobiStanjeNapak(dir);
      assert.equal(stanje.vnosi.length, 0, "noben vnos ob rebinding poskusu");

      // Veljavna lokalna zahteva z localhost pa uspe in sprozi vstavljivo posiljanje SMS
      await shraniNastavitveNapak({ obvesti: true, stevilka: "+38640123456" }, dir);
      let poslanSms = false;
      const odgOk = await handleNapakeRequest(
        new Request("http://localhost:8080/api/napake", {
          method: "POST",
          headers: { authorization: `Bearer ${zeton}`, host: "localhost:8080" },
          body: telo,
        }),
        "127.0.0.1",
        dir,
        async () => {
          poslanSms = true;
        },
      );
      assert.equal(odgOk.status, 200);
      assert.equal(poslanSms, true, "veljavna lokalna zahteva sprozi SMS");
    } finally {
      napakeModul.ponastaviOmejitveNapak?.();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("NAP12: 429 (omejitev zahtev za napacne zetone in skupno stevilo zahtev)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lina-napake-429-"));
    try {
      napakeModul.ponastaviOmejitveNapak?.();
      const zeton = await pridobiZetonNapake(dir);
      const telo = JSON.stringify({ naprava: "TV", proces: "p", izjema: "x" });
      const klic = (tk: string) =>
        handleNapakeRequest(
          new Request("http://localhost:8080/api/napake", {
            method: "POST",
            headers: { authorization: `Bearer ${tk}`, host: "localhost:8080" },
            body: telo,
          }),
          "127.0.0.1",
          dir,
        );

      // 1. 10 neuspelih poskusov z napacnim zetonom da 403, 11. da 429
      for (let i = 0; i < 10; i++) {
        assert.equal((await klic("napacen-zeton")).status, 403);
      }
      assert.equal((await klic("napacen-zeton")).status, 429);

      // 2. Skupna omejitev 60 zahtev/min: prvih 60 da 200, 61. da 429
      napakeModul.ponastaviOmejitveNapak?.();
      for (let i = 0; i < 60; i++) {
        assert.equal((await klic(zeton)).status, 200);
      }
      assert.equal((await klic(zeton)).status, 429);
    } finally {
      napakeModul.ponastaviOmejitveNapak?.();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
