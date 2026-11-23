/**
 * Preizkusi cistega modula lastni-streznik-namestitev.ts (naloga #43): gradniki datotek za namestitev freellmapi.
 * Brez omrezja, diska in dockerja. Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMIN_EPOSTA,
  IME_PROJEKTA,
  NAJVEC_PROCESOV,
  POMNILNIK_MEJA,
  PRIVZETA_VRATA,
  SLIKA,
  STEVILO_POSKUSOV_VRAT,
  argumentiCompose,
  gesloIzBajtov,
  izberiVrata,
  jeVarenCompose,
  jeVeljavnaSlika,
  jeVeljavnaVrata,
  naslovIzVrat,
  razberiAdminIzKonfiguracije,
  razberiEnotniKljuc,
  razberiVrataIzEnv,
  razberiZetonPrijave,
  sestaviCompose,
  sestaviEnv,
  sestaviKonfiguracijo,
  sifrirniKljucIzBajtov,
} from "./lastni-streznik-namestitev.ts";

const HEX = "ab".repeat(32);
const GESLO = "Aa1_-Aa1_-Aa1_-Aa1_-Aa1_-Aa";

describe("konstante", () => {
  it("slika je pripeta po vsoti, projekt in vrata so dogovorjeni", () => {
    assert.equal(jeVeljavnaSlika(SLIKA), true);
    assert.match(SLIKA, /^ghcr\.io\/tashfeenahmed\/freellmapi@sha256:[a-f0-9]{64}$/);
    assert.equal(IME_PROJEKTA, "lina-freellmapi");
    assert.equal(PRIVZETA_VRATA, 3191);
    assert.equal(STEVILO_POSKUSOV_VRAT, 20);
    assert.equal(ADMIN_EPOSTA, "lina@localhost.invalid");
    assert.equal(POMNILNIK_MEJA, "768m");
    assert.equal(NAJVEC_PROCESOV, 256);
  });
});

describe("jeVeljavnaSlika", () => {
  it("zavrne oznako, kratko vsoto, velike crke, drug register in ne-niz", () => {
    assert.equal(jeVeljavnaSlika("ghcr.io/tashfeenahmed/freellmapi:latest"), false);
    assert.equal(jeVeljavnaSlika("ghcr.io/tashfeenahmed/freellmapi"), false);
    assert.equal(jeVeljavnaSlika(`ghcr.io/x/y@sha256:${"a".repeat(63)}`), false);
    assert.equal(jeVeljavnaSlika(`ghcr.io/x/y@sha256:${"A".repeat(64)}`), false);
    assert.equal(jeVeljavnaSlika(`docker.io/x/y@sha256:${"a".repeat(64)}`), false);
    assert.equal(jeVeljavnaSlika(`ghcr.io/x/y@sha256:${"a".repeat(64)} `), false);
    assert.equal(jeVeljavnaSlika(`ghcr.io/x/y@sha256:${"a".repeat(65)}`), false);
    assert.equal(jeVeljavnaSlika(undefined), false);
    assert.equal(jeVeljavnaSlika(5), false);
  });
});

describe("vrata", () => {
  it("meje 1024 do 65535, samo cela stevila", () => {
    assert.equal(jeVeljavnaVrata(1023), false);
    assert.equal(jeVeljavnaVrata(1024), true);
    assert.equal(jeVeljavnaVrata(65535), true);
    assert.equal(jeVeljavnaVrata(65536), false);
    assert.equal(jeVeljavnaVrata(3191.5), false);
    assert.equal(jeVeljavnaVrata("3191"), false);
  });
  it("izberiVrata: prva prosta od zacetka", () => {
    assert.equal(izberiVrata([]), 3191);
    assert.equal(izberiVrata([3191]), 3192);
    assert.equal(izberiVrata([3191, 3192, 3193, 3194]), 3195);
    assert.equal(izberiVrata([3192]), 3191);
    assert.equal(izberiVrata([], 4000), 4000);
  });
  it("izberiVrata: vseh 20 zasedenih ali neveljaven zacetek je null", () => {
    const vsa = Array.from({ length: STEVILO_POSKUSOV_VRAT }, (_, i) => PRIVZETA_VRATA + i);
    assert.equal(izberiVrata(vsa), null);
    assert.equal(izberiVrata(vsa.slice(0, -1)), PRIVZETA_VRATA + STEVILO_POSKUSOV_VRAT - 1);
    assert.equal(izberiVrata([], 80), null);
    assert.equal(izberiVrata([], 70000), null);
  });
  it("izberiVrata: konec obmocja vrat", () => {
    assert.equal(izberiVrata([], 65535), 65535);
    assert.equal(izberiVrata([65535], 65535), null);
    assert.equal(izberiVrata([65534], 65534), 65535);
  });
  it("naslovIzVrat", () => {
    assert.equal(naslovIzVrat(3191), "http://127.0.0.1:3191/v1");
    assert.throws(() => naslovIzVrat(80));
  });
});

describe("sestaviEnv", () => {
  it("natancna vsebina z vezavo na 127.0.0.1", () => {
    assert.equal(sestaviEnv({ sifrirniKljuc: HEX, vrata: 3191 }), `ENCRYPTION_KEY=${HEX}\nPORT=3191\nHOST_BIND=127.0.0.1\n`);
  });
  it("neveljaven kljuc ali vrata", () => {
    for (const k of ["ab".repeat(31), "AB".repeat(32), "zz".repeat(32), `${HEX}\nX=1`, ""]) {
      assert.throws(() => sestaviEnv({ sifrirniKljuc: k, vrata: 3191 }), k);
    }
    assert.throws(() => sestaviEnv({ sifrirniKljuc: HEX, vrata: 80 }));
  });
});

describe("sestaviKonfiguracijo", () => {
  it("JSON z e-posto in geslom skrbnika", () => {
    const j = JSON.parse(sestaviKonfiguracijo({ geslo: GESLO })) as { admin: { email: string; password: string } };
    assert.deepEqual(j, { admin: { email: ADMIN_EPOSTA, password: GESLO } });
    const j2 = JSON.parse(sestaviKonfiguracijo({ geslo: GESLO, eposta: "a.b@c.si" })) as { admin: { email: string } };
    assert.equal(j2.admin.email, "a.b@c.si");
  });
  it("kratko geslo, nedovoljeni znaki ali neveljavna e-posta", () => {
    assert.throws(() => sestaviKonfiguracijo({ geslo: "a".repeat(23) }));
    assert.throws(() => sestaviKonfiguracijo({ geslo: "a".repeat(129) }));
    assert.throws(() => sestaviKonfiguracijo({ geslo: `${"a".repeat(24)}"` }));
    assert.throws(() => sestaviKonfiguracijo({ geslo: `${"a".repeat(24)} ` }));
    assert.throws(() => sestaviKonfiguracijo({ geslo: GESLO, eposta: "brez-afne" }));
    assert.throws(() => sestaviKonfiguracijo({ geslo: GESLO, eposta: 'a"b@c.si' }));
  });
});

describe("sestaviCompose", () => {
  const compose = sestaviCompose();
  it("vsebuje pripeto sliko, vezavo na 127.0.0.1 in utrditev", () => {
    assert.ok(compose.includes(`image: ${SLIKA}`));
    assert.ok(compose.includes('"127.0.0.1:${PORT:-3191}:3001"'));
    assert.ok(compose.includes("name: lina-freellmapi"));
    assert.ok(compose.includes('restart: "no"'));
    assert.ok(compose.includes("mem_limit: 768m"));
    assert.ok(compose.includes("pids_limit: 256"));
    assert.ok(compose.includes("no-new-privileges:true"));
    assert.match(compose, /cap_drop:\n\s+- ALL/);
    assert.ok(compose.endsWith("\n"));
  });
  it("ne vsebuje nic nevarnega", () => {
    for (const prepovedano of ["docker.sock", "privileged", "network_mode", "watchtower", "0.0.0.0", "cap_add", "devices", "command:", "entrypoint"]) {
      assert.equal(compose.includes(prepovedano), false, prepovedano);
    }
  });
  it("slika brez vsote je napaka", () => {
    assert.throws(() => sestaviCompose({ slika: "ghcr.io/tashfeenahmed/freellmapi:latest" }), /pripeta/);
  });
});

describe("jeVarenCompose", () => {
  const compose = sestaviCompose();
  it("Linina datoteka je varna", () => {
    assert.deepEqual(jeVarenCompose(compose), { ok: true });
  });
  it("dodana prepovedana nastavitev", () => {
    const vstavi = (vrstica: string) => compose.replace("    restart: \"no\"\n", `    restart: "no"\n${vrstica}\n`);
    const primeri: Array<[string, RegExp]> = [
      ["    privileged: true", /privileged/],
      ["    network_mode: host", /network_mode/],
      ["    pid: host", /pid/],
      ["    ipc: host", /ipc/],
      ["    userns_mode: host", /userns_mode/],
      ["    cap_add:\n      - SYS_ADMIN", /cap_add/],
      ["    devices:\n      - /dev/mem", /devices/],
      ["    command: sh -c evil", /ukaz/],
      ["    entrypoint: sh", /ukaz/],
      ["    labels:\n      - com.centurylinklabs.watchtower.enable=true", /watchtower/],
    ];
    for (const [vrstica, razlog] of primeri) {
      const izid = jeVarenCompose(vstavi(vrstica));
      assert.equal(izid.ok, false, vrstica);
      if (!izid.ok) assert.match(izid.razlog, razlog, vrstica);
    }
  });
  it("vticnica docker, vezava na vse naslove", () => {
    const a = jeVarenCompose(compose.replace("      - freellmapi-data:/app/server/data", "      - /var/run/docker.sock:/var/run/docker.sock\n      - freellmapi-data:/app/server/data"));
    assert.equal(a.ok, false);
    if (!a.ok) assert.match(a.razlog, /docker vticnice/);
    const b = jeVarenCompose(compose.replace("127.0.0.1:${PORT:-3191}:3001", "0.0.0.0:${PORT:-3191}:3001"));
    assert.equal(b.ok, false);
    if (!b.ok) assert.match(b.razlog, /vse naslove/);
  });
  it("druga slika (tudi pripeta) ali oznaka ni dovoljena", () => {
    const druga = `ghcr.io/evil/freellmapi@sha256:${"c".repeat(64)}`;
    const a = jeVarenCompose(compose.replace(SLIKA, druga));
    assert.equal(a.ok, false);
    if (!a.ok) assert.match(a.razlog, /preizkusila/);
    const b = jeVarenCompose(compose.replace(SLIKA, "ghcr.io/tashfeenahmed/freellmapi:latest"));
    assert.equal(b.ok, false);
    if (!b.ok) assert.match(b.razlog, /pripeta/);
    const c = jeVarenCompose(compose.replace(`image: ${SLIKA}`, `image: ${SLIKA.replace("tashfeenahmed", "tashfeenahmed2")}`));
    assert.equal(c.ok, false);
  });
  it("kakrsnakoli drugacna vsebina (tudi neskodljiva) ni dovoljena", () => {
    assert.equal(jeVarenCompose(`${compose}# komentar\n`).ok, false);
    assert.equal(jeVarenCompose(compose.replace("interval: 30s", "interval: 31s")).ok, false);
    assert.equal(jeVarenCompose(compose.replace("mem_limit: 768m", "mem_limit: 8g")).ok, false);
    assert.equal(jeVarenCompose(compose.replace("    cap_drop:\n      - ALL\n", "")).ok, false);
  });
  it("prazno, predolgo, ne-niz", () => {
    for (const slabo of ["", `${compose}${"x".repeat(4000)}`, undefined as unknown as string]) {
      const izid = jeVarenCompose(slabo);
      assert.equal(izid.ok, false);
      if (!izid.ok) assert.match(izid.razlog, /ni veljavna/);
    }
  });
});

describe("razclenjevalniki odgovorov freellmapi", () => {
  it("zeton prijave", () => {
    assert.equal(razberiZetonPrijave({ token: "a".repeat(64), email: "x@y.si" }), "a".repeat(64));
    assert.equal(razberiZetonPrijave({ token: "kratek" }), null);
    assert.equal(razberiZetonPrijave({ token: `${"a".repeat(20)} x` }), null);
    assert.equal(razberiZetonPrijave({ token: "a".repeat(601) }), null);
    assert.equal(razberiZetonPrijave({}), null);
    assert.equal(razberiZetonPrijave({ token: 5 }), null);
    assert.equal(razberiZetonPrijave(null), null);
    assert.equal(razberiZetonPrijave("a".repeat(64)), null);
  });
  it("enotni kljuc", () => {
    const k = `freellmapi-${"Ab1_-".repeat(9)}`;
    assert.equal(razberiEnotniKljuc({ apiKey: k }), k);
    assert.equal(razberiEnotniKljuc({ apiKey: "sk-" + "a".repeat(40) }), null);
    assert.equal(razberiEnotniKljuc({ apiKey: "freellmapi-kratek" }), null);
    assert.equal(razberiEnotniKljuc({ apiKey: `${k} ` }), null);
    assert.equal(razberiEnotniKljuc({ apiKey: `${k}\n` }), null);
    assert.equal(razberiEnotniKljuc({}), null);
    assert.equal(razberiEnotniKljuc(undefined), null);
  });
});

describe("nakljucne vrednosti", () => {
  it("geslo iz 24 bajtov je 32 znakov in ga konfiguracija sprejme", () => {
    const g = gesloIzBajtov(Uint8Array.from({ length: 24 }, (_, i) => i * 10));
    assert.equal(g.length, 32);
    assert.doesNotThrow(() => sestaviKonfiguracijo({ geslo: g }));
    assert.equal(gesloIzBajtov(new Uint8Array(18).fill(255)).length, 24);
    assert.throws(() => gesloIzBajtov(new Uint8Array(17)));
  });
  it("sifrirni kljuc iz 32 bajtov je 64 sestnajstiskih in ga env sprejme", () => {
    const k = sifrirniKljucIzBajtov(Uint8Array.from({ length: 40 }, (_, i) => i));
    assert.equal(k.length, 64);
    assert.doesNotThrow(() => sestaviEnv({ sifrirniKljuc: k, vrata: 3191 }));
    assert.equal(sifrirniKljucIzBajtov(new Uint8Array(32).fill(1)), "01".repeat(32));
    assert.throws(() => sifrirniKljucIzBajtov(new Uint8Array(31)));
  });
});

describe("argumentiCompose", () => {
  it("projekt in datoteke so izrecni", () => {
    assert.deepEqual(argumentiCompose({ compose: "/a/docker-compose.yml", env: "/a/.env" }, ["up", "-d"]), [
      "compose",
      "-p",
      "lina-freellmapi",
      "-f",
      "/a/docker-compose.yml",
      "--env-file",
      "/a/.env",
      "up",
      "-d",
    ]);
  });
});

describe("branje lastnih datotek namestitve", () => {
  it("vrata iz .env", () => {
    assert.equal(razberiVrataIzEnv(sestaviEnv({ sifrirniKljuc: HEX, vrata: 3195 })), 3195);
    assert.equal(razberiVrataIzEnv("PORT=4000\nPORT=5000\n"), 4000);
  });
  it("vrata: manjka, neveljavna, ni na zacetku vrstice, ne-niz", () => {
    for (const slabo of ["", "ENCRYPTION_KEY=x\n", "PORT=80\n", "PORT=99999\n", "PORT=3191x\n", "XPORT=3191\n", "PORT= 3191\n", "PORT=\n"]) {
      assert.equal(razberiVrataIzEnv(slabo), null, JSON.stringify(slabo));
    }
    assert.equal(razberiVrataIzEnv(undefined as unknown as string), null);
  });
  it("skrbnik iz konfiguracije (kroznica z gradnikom)", () => {
    assert.deepEqual(razberiAdminIzKonfiguracije(sestaviKonfiguracijo({ geslo: GESLO })), { eposta: ADMIN_EPOSTA, geslo: GESLO });
  });
  it("skrbnik: slaba oblika ali neveljavno geslo", () => {
    for (const slabo of [
      "",
      "ni json",
      "null",
      "[]",
      "{}",
      '{"admin":null}',
      '{"admin":"x"}',
      '{"admin":{"email":"a@b.si"}}',
      '{"admin":{"email":5,"password":"' + GESLO + '"}}',
      '{"admin":{"email":"a@b.si","password":"kratko"}}',
      '{"admin":{"email":"a@b.si","password":"' + GESLO + ' "}}',
    ]) {
      assert.equal(razberiAdminIzKonfiguracije(slabo), null, slabo);
    }
    assert.equal(razberiAdminIzKonfiguracije(undefined as unknown as string), null);
  });
});
