/**
 * Naloga prijava (lastnik 11. 11. 2026): prijava v Google Cloud z uporabnikovim PRIVZETIM brskalnikom, en gumb.
 * Preizkusi jedra: povezava samo z accounts.google.com, iskanje gcloud, brez --no-launch-browser, projekti, zagon
 * lazne gcloud skripte (Linux). Brez omrezja; komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  imeGcloud,
  kandidatiGcloud,
  ocistiIzpis,
  okoljeGcloud,
  potAdc,
  pozabiGoogle,
  poisciGcloud,
  preklicPrijave,
  razberiPovezavoPrijave,
  razberiProjekte,
  razvrstiNapako,
  stanjePrijave,
  ukazPrijave,
  vnesiKodoPrijave,
  zacniPrijavo,
} from "./prijava-google.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-prijava-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));

// Edinstveno ime po PID-u preizkusa: ostanek procesa drugega zagona ne more motiti preverbe.
const KONF = path.join(KOREN, "konf");
const IME_DOLG = `gcloud-dolg-${process.pid}`;

const pocakaj = async (pogoj: () => boolean, ms = 4000) => {
  const do_ = Date.now() + ms;
  while (!pogoj() && Date.now() < do_) await new Promise((r) => setTimeout(r, 25));
};

describe("povezava prijave", () => {
  it("sprejme povezavo z accounts.google.com iz izpisa gcloud", () => {
    const izpis = "Your browser has been opened to visit:\n\n    https://accounts.google.com/o/oauth2/auth?client_id=x&state=y\n";
    assert.equal(razberiPovezavoPrijave(izpis), "https://accounts.google.com/o/oauth2/auth?client_id=x&state=y");
  });
  it("zavrne tuj gostitelj, http in zvijaco z uporabnikom v povezavi", () => {
    assert.equal(razberiPovezavoPrijave("https://evil.example/o/oauth2/auth"), null);
    assert.equal(razberiPovezavoPrijave("http://accounts.google.com/o/oauth2/auth"), null);
    assert.equal(razberiPovezavoPrijave("https://accounts.google.com@evil.example/x"), null);
    assert.equal(razberiPovezavoPrijave("https://accounts.google.com.evil.example/x"), null);
    assert.equal(razberiPovezavoPrijave(""), null);
  });
  it("izbere prvo veljavno povezavo, ce je pred njo tuja", () => {
    const izpis = "https://evil.example/a https://accounts.google.com/o/oauth2/auth?z=1";
    assert.equal(razberiPovezavoPrijave(izpis), "https://accounts.google.com/o/oauth2/auth?z=1");
  });
});

describe("iskanje gcloud in ukaz", () => {
  it("najprej Linina mapa, v PATH samo absolutne poti", () => {
    const poti = kandidatiGcloud("/lina", ".:rel/bin::/usr/bin", "linux");
    assert.equal(poti[0], path.join("/lina", "google-cloud-sdk", "bin", "gcloud"));
    assert.deepEqual(poti.slice(1), [path.join("/usr/bin", "gcloud")]);
  });
  it("na Windows gcloud.cmd in samo poti z crko pogona", () => {
    assert.equal(imeGcloud("win32"), "gcloud.cmd");
    const poti = kandidatiGcloud("C:\\Lina", "rel;C:\\Tools\\bin", "win32");
    assert.equal(poti.length, 2);
    assert.ok(poti[1].toLowerCase().includes("tools"));
  });
  it("poisciGcloud vrne prvi obstojeci", () => {
    const najden = poisciGcloud("/lina", (p) => p.includes("google-cloud-sdk"));
    assert.ok(najden?.includes("google-cloud-sdk"));
    assert.equal(poisciGcloud("/lina", () => false), null);
  });
  it("prijava uporablja privzeti brskalnik (brez --no-launch-browser)", () => {
    const { args } = ukazPrijave("/x/gcloud");
    assert.deepEqual(args.slice(0, 3), ["auth", "application-default", "login"]);
    assert.ok(!args.includes("--no-launch-browser"));
  });
});

describe("projekti", () => {
  it("vzame samo veljavne ID-je", () => {
    const json = JSON.stringify([
      { projectId: "moj-projekt-123", name: "Moj projekt" },
      { projectId: "Napacen ID", name: "x" },
      { projectId: "ab", name: "kratek" },
      { name: "brez id" },
    ]);
    assert.deepEqual(razberiProjekte(json), [{ id: "moj-projekt-123", ime: "Moj projekt" }]);
    assert.deepEqual(razberiProjekte("ni json"), []);
    assert.deepEqual(razberiProjekte("{}"), []);
  });
});

describe("zagon prijave z lazno gcloud skripto", { skip: process.platform === "win32" }, () => {
  const skripta = (ime: string, telo: string): string => {
    const pot = path.join(KOREN, ime);
    writeFileSync(pot, `#!/bin/sh\n${telo}\n`);
    chmodSync(pot, 0o755);
    return pot;
  };
  it("ujame povezavo in po izhodu 0 javi uspeh", async () => {
    const gcloud = skripta("gcloud-ok", 'echo "Your browser has been opened to visit: https://accounts.google.com/o/oauth2/auth?s=1"; sleep 0.4; exit 0');
    const prvo = zacniPrijavo(gcloud, KONF);
    assert.equal(prvo.faza, "caka");
    await pocakaj(() => stanjePrijave().povezava !== null);
    assert.equal(stanjePrijave().povezava, "https://accounts.google.com/o/oauth2/auth?s=1");
    await pocakaj(() => stanjePrijave().faza === "uspeh");
    assert.equal(stanjePrijave().faza, "uspeh");
    assert.equal(stanjePrijave().povezava, null);
  });
  it("izhod brez 0 je napaka; izpis gcloud se pokaze, a brez zetonov (od 15. 11. 2026)", async () => {
    const gcloud = skripta("gcloud-napaka", 'echo "napaka-v-izpisu ya29.A0ARrdaMsecretTOKENvalue1234567890" 1>&2; exit 3');
    zacniPrijavo(gcloud, KONF, { dnevnik: () => {} });
    await pocakaj(() => stanjePrijave().faza === "napaka");
    const st = stanjePrijave();
    assert.equal(st.faza, "napaka");
    assert.equal(st.vzrok, "neznano");
    assert.ok(st.podrobnosti.some((v) => v.includes("napaka-v-izpisu")));
    assert.ok(!JSON.stringify(st).includes("secretTOKEN"));
  });
  it("druga prijava med prvo ne zazene novega procesa; preklic konca proces", async () => {
    const gcloud = skripta(IME_DOLG, "sleep 30");
    zacniPrijavo(gcloud, KONF);
    const drugo = zacniPrijavo(gcloud, KONF);
    assert.equal(drugo.faza, "caka");
    assert.equal(preklicPrijave().faza, "mirno");
    // Podproces lupine (sleep 30) mora tudi koncati: brez ubitja skupine je ostal zivo in drzal cevi.
    await new Promise((r) => setTimeout(r, 300));
    const { execFileSync } = await import("node:child_process");
    const ostanek = (() => { try { return execFileSync("pgrep", ["-f", IME_DOLG]).toString().trim(); } catch { return ""; } })();
    assert.equal(ostanek, "");
  });
  it("gcloud dobi CLOUDSDK_CONFIG z Lino mapo, ne uporabnikove", async () => {
    const izhod = path.join(KOREN, "okolje.txt");
    const gcloud = skripta("gcloud-okolje", `echo "$CLOUDSDK_CONFIG" > "${izhod}"; exit 0`);
    zacniPrijavo(gcloud, KONF);
    await pocakaj(() => stanjePrijave().faza === "uspeh");
    assert.equal(readFileSync(izhod, "utf8").trim(), KONF);
  });
  it("neobstojec gcloud je napaka, ne izjema", async () => {
    zacniPrijavo(path.join(KOREN, "ne-obstaja"), KONF);
    await pocakaj(() => stanjePrijave().faza === "napaka");
    assert.equal(stanjePrijave().faza, "napaka");
  });
});

describe("lastna mapa in pozabi racun", () => {
  it("okoljeGcloud prepise CLOUDSDK_CONFIG in ne spremeni osnove", () => {
    const osnova = { HOME: "/h", CLOUDSDK_CONFIG: "/uporabnikova" } as NodeJS.ProcessEnv;
    assert.equal(okoljeGcloud("/lina", osnova).CLOUDSDK_CONFIG, "/lina");
    assert.equal(osnova.CLOUDSDK_CONFIG, "/uporabnikova");
  });
  it("pozabiGoogle: preklic z Lino mapo, brisanje mape, pozabi zeton; sosednja mapa ostane", async () => {
    const mapa = path.join(KOREN, "pozabi-lina");
    const sosednja = path.join(KOREN, "pozabi-uporabnik");
    mkdirSync(mapa, { recursive: true });
    mkdirSync(sosednja, { recursive: true });
    writeFileSync(potAdc(mapa), "{}");
    writeFileSync(path.join(sosednja, "x"), "1");
    let zeton = 0;
    let env: NodeJS.ProcessEnv | null = null;
    await pozabiGoogle("/g", mapa, () => zeton++, async (_g, e) => { env = e; });
    assert.equal(existsSync(mapa), false);
    assert.equal(existsSync(path.join(sosednja, "x")), true);
    assert.equal(zeton, 1);
    assert.equal((env as NodeJS.ProcessEnv | null)?.CLOUDSDK_CONFIG, mapa);
  });
  it("pozabiGoogle: brez omrezja (preklic pade) se mapa vseeno pobrise", async () => {
    const mapa = path.join(KOREN, "pozabi-offline");
    mkdirSync(mapa, { recursive: true });
    writeFileSync(potAdc(mapa), "{}");
    await pozabiGoogle("/g", mapa, () => {}, async () => {});
    assert.equal(existsSync(mapa), false);
  });
  it("pozabiGoogle brez ADC datoteke ne klice gcloud", async () => {
    const mapa = path.join(KOREN, "pozabi-prazno");
    mkdirSync(mapa, { recursive: true });
    let klic = 0;
    await pozabiGoogle("/g", mapa, () => {}, async () => { klic++; });
    assert.equal(klic, 0);
  });
});

describe("prijava brez brskalnika: povezava, polje za kodo, koda na stdin (15. 11. 2026)", { skip: process.platform === "win32" }, () => {
  // Izmerjeno 15. 11. 2026 (dnevnik gcloud): proces Line brez DISPLAY/BROWSER, gcloud izpise povezavo in »enter the verification code«,
  // nato pade z EOFError, ker je stdin zaprt. Lazna skripta posnema isti izpis in prebere vrstico s stdin.
  const KODA = "4/0AtestKoda-123_xyz";
  const skripta = (ime: string, telo: string): string => {
    const pot = path.join(KOREN, ime);
    writeFileSync(pot, `#!/bin/sh\n${telo}\n`);
    chmodSync(pot, 0o755);
    return pot;
  };
  const GLAVA = `echo "Go to the following link in your browser, and complete the sign-in prompts:" 1>&2
echo "" 1>&2
echo "    https://accounts.google.com/o/oauth2/auth?client_id=x&state=abc" 1>&2
printf "Once finished, enter the verification code provided in your browser: "`;
  const sKodo = (ime: string) =>
    skripta(
      ime,
      `${GLAVA}
IFS= read -r KODA || { echo "EOFError: EOF when reading a line" 1>&2; exit 1; }
if [ "$KODA" = "${KODA}" ]; then exit 0; fi
echo "ERROR: invalid_grant Bad Request ya29.A0SECRETtokenVALUE1234567890abcdefghij code=$KODA" 1>&2
exit 1`,
    );

  it("zahteva kodo, pokaze povezavo, kodo zapise na stdin in javi uspeh; kode ni v stanju", async () => {
    zacniPrijavo(sKodo("gcloud-koda-ok"), KONF, { dnevnik: () => {} });
    await pocakaj(() => stanjePrijave().potrebnaKoda);
    const caka = stanjePrijave();
    assert.equal(caka.faza, "caka");
    assert.equal(caka.potrebnaKoda, true);
    assert.equal(caka.povezava, "https://accounts.google.com/o/oauth2/auth?client_id=x&state=abc");
    const po = vnesiKodoPrijave(KODA);
    assert.equal(po.kodaPoslana, true);
    assert.equal(po.potrebnaKoda, false);
    assert.ok(!JSON.stringify(po).includes(KODA));
    await pocakaj(() => stanjePrijave().faza === "uspeh");
    assert.equal(stanjePrijave().faza, "uspeh");
    assert.ok(!JSON.stringify(stanjePrijave()).includes(KODA));
    assert.throws(() => vnesiKodoPrijave(KODA), /ni potrebna/);
  });

  it("napacna koda: vzrok koda, zadnje vrstice brez zetonov, kod in povezav, tudi v dnevniku", async () => {
    const dnevnik: string[] = [];
    zacniPrijavo(sKodo("gcloud-koda-napacna"), KONF, { dnevnik: (v) => dnevnik.push(v) });
    await pocakaj(() => stanjePrijave().potrebnaKoda);
    vnesiKodoPrijave("4/0ANapacnaKoda-999_abcdef");
    await pocakaj(() => stanjePrijave().faza === "napaka");
    const st = stanjePrijave();
    assert.equal(st.faza, "napaka");
    assert.equal(st.vzrok, "koda");
    assert.ok(st.podrobnosti.length > 0 && st.podrobnosti.length <= 20);
    assert.ok(st.podrobnosti.some((v) => v.includes("invalid_grant")));
    const vse = `${JSON.stringify(st)}\n${dnevnik.join("\n")}`;
    for (const prepovedano of ["ya29.A0SECRET", "SECRETtokenVALUE", "NapacnaKoda", "accounts.google.com", "client_id"]) {
      assert.ok(!vse.includes(prepovedano), `v stanju ali dnevniku ni smelo biti: ${prepovedano}`);
    }
    assert.equal(dnevnik.length, 1);
    assert.ok(dnevnik[0].includes("vzrok koda"));
  });

  it("gcloud pade po zahtevi kode, preden jo uporabnik vnese: vzrok brskalnik (izpis ob izhodu se ne izgubi)", async () => {
    const gcloud = skripta("gcloud-eof", `${GLAVA}\necho "EOFError: EOF when reading a line" 1>&2\nexit 1`);
    zacniPrijavo(gcloud, KONF, { dnevnik: () => {} });
    await pocakaj(() => stanjePrijave().faza === "napaka");
    const st = stanjePrijave();
    assert.equal(st.vzrok, "brskalnik");
    assert.ok(st.podrobnosti.some((v) => v.includes("EOFError")));
    assert.ok(st.podrobnosti.some((v) => v.includes("verification code")));
  });

  it("zavrnitev v brskalniku je vzrok preklicana", async () => {
    const gcloud = skripta("gcloud-zavrnjena", 'echo "ERROR: access_denied" 1>&2; exit 1');
    zacniPrijavo(gcloud, KONF, { dnevnik: () => {} });
    await pocakaj(() => stanjePrijave().faza === "napaka");
    assert.equal(stanjePrijave().vzrok, "preklicana");
  });

  it("rok prijave: vzrok potekla, proces ustavljen", async () => {
    const ime = `gcloud-potek-${process.pid}`;
    const gcloud = skripta(ime, "sleep 30");
    zacniPrijavo(gcloud, KONF, { rokMs: 300, dnevnik: () => {} });
    await pocakaj(() => stanjePrijave().faza === "napaka");
    assert.equal(stanjePrijave().vzrok, "potekla");
    await new Promise((r) => setTimeout(r, 300));
    const { execFileSync } = await import("node:child_process");
    const ostanek = (() => { try { return execFileSync("pgrep", ["-f", ime]).toString().trim(); } catch { return ""; } })();
    assert.equal(ostanek, "");
  });

  it("neobstojec gcloud: vzrok zagon", async () => {
    zacniPrijavo(path.join(KOREN, "ne-obstaja"), KONF, { dnevnik: () => {} });
    await pocakaj(() => stanjePrijave().faza === "napaka");
    assert.equal(stanjePrijave().vzrok, "zagon");
  });

  it("kode ni mogoce poslati, ce je gcloud ne zahteva ali je oblika napacna", async () => {
    assert.throws(() => vnesiKodoPrijave(KODA), /ni potrebna/); // stanje po prejsnjem preizkusu: ni procesa
    zacniPrijavo(sKodo("gcloud-koda-oblika"), KONF, { dnevnik: () => {} });
    assert.throws(() => vnesiKodoPrijave(KODA), /ni potrebna/); // gcloud kode se ni zahteval
    await pocakaj(() => stanjePrijave().potrebnaKoda);
    for (const slaba of ["", "kratko", "z presledkom 123456", `${KODA}\nsecond-line-vnos`, 12345, null, "a".repeat(600)]) {
      assert.throws(() => vnesiKodoPrijave(slaba), /oblik/);
    }
    assert.equal(stanjePrijave().kodaPoslana, false);
    preklicPrijave();
  });
});

describe("izpis gcloud za uporabnika: ocistiIzpis in razvrstiNapako", () => {
  it("izrezi zetone, kode, povezave, kljuce in domaco mapo; ohrani razlog", () => {
    const izpis = [
      "\u001b[31mERROR\u001b[0m: (gcloud.auth) invalid_grant",
      "  File \"/home/uporabnik/.local/share/lina/gcloud/lib/x.py\", line 9",
      "Visit https://accounts.google.com/o/oauth2/auth?client_id=1&state=zzz now",
      "Authorization: Bearer ya29.A0ARrdaM-abcdefghijklmnopqrstuvwxyz",
      "refresh_token: 1//0gLongRefreshTokenValue-abcdef",
      "access_token=abc123",
      "code 4/0AVeryLongAuthorizationCode_12345",
      "jwt eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig_nature-xyz",
      "AIzaSyD-abcdefghijklmnopqrstuvwxyz012345",
      "hex 0123456789abcdef0123456789abcdef0123",
    ].join("\n");
    const izid = ocistiIzpis(izpis, "/home/uporabnik").join("\n");
    for (const prepovedano of ["ya29", "LongRefresh", "abc123", "VeryLong", "eyJhbGci", "AIzaSyD", "0123456789abcdef0123", "accounts.google.com", "client_id", "/home/uporabnik", "\u001b"]) {
      assert.ok(!izid.includes(prepovedano), `ni smelo ostati: ${prepovedano}`);
    }
    assert.ok(izid.includes("invalid_grant"));
    assert.ok(izid.includes("<domača mapa>"));
    assert.ok(izid.includes("ERROR"));
  });
  it("zadnjih 20 nepraznih vrstic, vsaka najvec 240 znakov", () => {
    const izpis = Array.from({ length: 50 }, (_, i) => `vrstica ${i}`).join("\n\n") + `\n${"x ".repeat(300)}`;
    const izid = ocistiIzpis(izpis, "/h");
    assert.equal(izid.length, 20);
    assert.ok(izid.every((v) => v.length <= 240 && v.trim() !== ""));
    assert.ok(izid.includes("vrstica 49"));
    assert.ok(!izid.includes("vrstica 0"));
  });
  it("vzrok: koda poslana, kodo zahteval, zavrnitev, signal, drugo", () => {
    assert.equal(razvrstiNapako({ izpis: "", zahtevalaKodo: true, kodaPoslana: true }), "koda");
    assert.equal(razvrstiNapako({ izpis: "", zahtevalaKodo: true, kodaPoslana: false }), "brskalnik");
    assert.equal(razvrstiNapako({ izpis: "access_denied", zahtevalaKodo: false, kodaPoslana: false }), "preklicana");
    assert.equal(razvrstiNapako({ izpis: "", zahtevalaKodo: false, kodaPoslana: false, signal: "SIGTERM" }), "preklicana");
    assert.equal(razvrstiNapako({ izpis: "nekaj", zahtevalaKodo: false, kodaPoslana: false }), "neznano");
    // 22. 11. 2026, izpis gcloud 593 na lastnikovem racunalniku: soglasje brez Google Cloud.
    assert.equal(razvrstiNapako({ izpis: "ERROR: (gcloud.auth.application-default.login) https://www.googleapis.com/auth/cloud-platform scope is required but not consented.", zahtevalaKodo: false, kodaPoslana: false }), "dovoljenje");
  });
});
