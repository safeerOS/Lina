import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  cistiOsebnePodatke,
  handleNapakeRequest,
  ponastaviOmejitveNapak,
  pridobiStanjeNapak,
  pridobiZetonNapake,
  shraniNastavitveNapak,
  sprejmiNotranjo,
  vVrsti,
} from "./napake.server.ts";

describe("LINA-CIST-1: cistilnik in notranja pot", () => {
  it("KAK2-1a: poverilnice v URL brez pike v gostitelju", () => {
    const u = cistiOsebnePodatke("connect failed http://uporabnik:geslo123@localhost:3000/x");
    assert.ok(!u.includes("geslo123"), `geslo ne sme ostati: ${u}`);
    assert.ok(!u.includes("uporabnik"), `uporabnik ne sme ostati: ${u}`);
  });

  it("KAK2-1b: dolga e-posta cez 64 znakov zamaskirana v celoti", () => {
    const dolgaPosta = "mail " + "uporabnik.".repeat(8) + "oseba@example.com konec";
    const e = cistiOsebnePodatke(dolgaPosta);
    assert.ok(!e.includes("uporabnik"), `dolg lokalni del e-poste mora biti v celoti zamaskiran: ${e}`);
    assert.ok(e.includes("EMAIL@DOMAIN.COM"), `pricakovan EMAIL@DOMAIN.COM: ${e}`);
  });

  it("KAK2-7a: :: ne maskira C++ std::vector", () => {
    assert.equal(cistiOsebnePodatke("Napaka std::vector in Foo::bar"), "Napaka std::vector in Foo::bar");
    assert.equal(cistiOsebnePodatke("ob 12:34:56 je padlo"), "ob 12:34:56 je padlo");
  });

  it("KAK2-7b: maskira prave IPv6 naslove in predpone vkljucno z ::/64", () => {
    const predpona = cistiOsebnePodatke("prefix 2001:db8:abcd:12::/64 in privzeto ::/64");
    assert.ok(!predpona.includes("abcd"), `IPv6 predpona mora biti zamaskirana: ${predpona}`);
    assert.ok(!predpona.includes("::/64"), `predpona ::/64 mora biti zamaskirana: ${predpona}`);
    assert.equal(cistiOsebnePodatke("naslov 2001:db8::1 pad"), "naslov IPV6 pad");
  });

  it("KAK2-8a: ne maskira datumov in dolgih nesmiselnih stevilk po nepotrebnem", () => {
    const datumInId = cistiOsebnePodatke("Napaka ob 2026-11-17 12:34 id 1763380000000");
    assert.ok(datumInId.includes("2026-11-17 12:34"), `datum in ura morata ostati: ${datumInId}`);
    assert.ok(datumInId.includes("1763380000000"), `dolga stevilka mora ostati: ${datumInId}`);
  });

  it("KAK2-8b: maskira telefone z / in presledki ter pikami", () => {
    const tel1 = cistiOsebnePodatke("klic +386 41/123 456");
    assert.ok(!tel1.includes("123 456"), `mednarodni telefon z / mora biti zamaskiran: ${tel1}`);
    const tel2 = cistiOsebnePodatke("klic 041/234 567 in 041 234 567 ter 041.234.567");
    assert.ok(!tel2.includes("234"), `nacionalni telefoni morajo biti zamaskirani: ${tel2}`);
  });

  it("KAK2-9a: imena izjem kot IllegalArgumentException se ne zamenjajo s SECRET", () => {
    const izjema = cistiOsebnePodatke("java.lang.IllegalArgumentException: ConcurrentModificationException");
    assert.ok(izjema.includes("IllegalArgumentException"), `ime izjeme mora ostati: ${izjema}`);
    assert.ok(izjema.includes("ConcurrentModificationException"), `ime izjeme mora ostati: ${izjema}`);
  });

  it("KAK2-9b: skrivnosti 24+ z mesanico crk in stevk ali base64 z +/ se maskirajo", () => {
    const b64Plus = cistiOsebnePodatke("kljuc AbCdEfGh+IjKlMnOp+QrStUvWx1234");
    assert.ok(!b64Plus.includes("QrStUvWx1234"), `base64 s + mora biti zamaskiran: ${b64Plus}`);
    const b64Slash = cistiOsebnePodatke("aws wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
    assert.ok(!b64Slash.includes("EXAMPLEKEY"), `base64 z / mora biti zamaskiran: ${b64Slash}`);
  });

  it("KAK2-12a: /var/home/uporabnik in /mnt/c/Users/uporabnik", () => {
    const poti = cistiOsebnePodatke("odprem /var/home/uporabnik/x in /mnt/c/Users/uporabnik/y");
    assert.ok(!poti.includes("uporabnik"), `uporabnisko ime v poti ne sme ostati: ${poti}`);
  });

  it("KAK2-12b: uporabnik@gostitelj brez pike", () => {
    const ssh = cistiOsebnePodatke("ssh uporabnik@moj-streznik failed");
    assert.ok(!ssh.includes("uporabnik"), `uporabnik@gostitelj mora biti zamaskiran: ${ssh}`);
    assert.ok(!ssh.includes("moj-streznik"), `gostitelj mora biti zamaskiran: ${ssh}`);
  });

  it("KAK2-12c: MAC brez locil in s pikami", () => {
    const mac = cistiOsebnePodatke("mac aabbccddeeff in aabb.ccdd.eeff");
    assert.ok(!mac.includes("aabbccddeeff"), `MAC brez locil mora biti zamaskiran: ${mac}`);
    assert.ok(!mac.includes("ccdd"), `MAC s pikami mora biti zamaskiran: ${mac}`);
  });

  it("KAK2-6a: notranjeZahteve uporablja ociscen kljuc", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lina-cist-k6a-"));
    try {
      ponastaviOmejitveNapak();
      let sprejeto = 0;
      for (let i = 0; i < 40; i++) {
        const ok = await sprejmiNotranjo(
          {
            naprava: "Lina Kakovost",
            proces: "kakovost",
            vrsta: "kakovost",
            izjema: `Napaka pri klicu +38640${100000 + i}`,
          },
          dir,
        );
        if (ok) sprejeto++;
      }
      assert.equal(sprejeto, 1, `omejitev mora veljati za ociscen niz (sprejeto: ${sprejeto})`);
    } finally {
      ponastaviOmejitveNapak();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("KAK2-6b: notranjeZahteve omeji velikost Map na 100", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lina-cist-k6b-"));
    try {
      ponastaviOmejitveNapak();
      let sprejetoRazlicnih = 0;
      for (let i = 0; i < 120; i++) {
        const ok = await sprejmiNotranjo(
          {
            naprava: "Lina Kakovost",
            proces: "kakovost",
            vrsta: "kakovost",
            izjema: `Razlicna napaka vrstice #${i}`,
          },
          dir,
        );
        if (ok) sprejetoRazlicnih++;
      }
      assert.equal(sprejetoRazlicnih, 100, `Map mora sprejeti najvec 100 razlicnih kljucev (sprejeto: ${sprejetoRazlicnih})`);
    } finally {
      ponastaviOmejitveNapak();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("KAK2-6c: notranjeZahteve porabi omejitev sele po uspesnem zapisu", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lina-cist-k6c-"));
    try {
      ponastaviOmejitveNapak();
      const neveljaven = await sprejmiNotranjo(
        { naprava: "", proces: "kakovost", vrsta: "kakovost", izjema: "Enaka napaka" },
        dir,
      );
      assert.equal(neveljaven, false);
      const veljaven = await sprejmiNotranjo(
        { naprava: "Lina Kakovost", proces: "kakovost", vrsta: "kakovost", izjema: "Enaka napaka" },
        dir,
      );
      assert.equal(veljaven, true, "neveljaven klic ne sme porabiti omejitve");
    } finally {
      ponastaviOmejitveNapak();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("KAK2-15a: zaklep vVrsti ne drzi med posiljanjem SMS", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lina-cist-k15a-"));
    try {
      ponastaviOmejitveNapak();
      const zeton = await pridobiZetonNapake(dir);
      await shraniNastavitveNapak({ obvesti: true, stevilka: "+38640123456" }, dir);

      let smsZacet!: () => void;
      const pocakajNaVstopVSms = new Promise<void>((r) => {
        smsZacet = r;
      });
      let sprostiSms!: () => void;
      const pocakajNaSprostiSms = new Promise<void>((r) => {
        sprostiSms = r;
      });

      const zahtevaSms = handleNapakeRequest(
        new Request("http://localhost:8080/api/napake", {
          method: "POST",
          headers: { authorization: `Bearer ${zeton}`, host: "localhost:8080" },
          body: JSON.stringify({ naprava: "TV", proces: "predvajalnik", izjema: "prva napaka" }),
        }),
        "127.0.0.1",
        dir,
        async () => {
          smsZacet();
          await pocakajNaSprostiSms;
          return true;
        },
      );

      await pocakajNaVstopVSms;
      const medSms = await Promise.race([
        vVrsti(() => pridobiStanjeNapak(dir)),
        new Promise<string>((r) => setTimeout(() => r("zaklenjeno"), 300)),
      ]);
      sprostiSms();
      const odg = await zahtevaSms;
      assert.equal(odg.status, 200);
      assert.notEqual(medSms, "zaklenjeno", "zaklep vVrsti ne sme drzati med cakanjem na SMS");
    } finally {
      ponastaviOmejitveNapak();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("KAK2-15b: razlog napake SMS v dnevniku brez novih vrstic", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lina-cist-k15b-"));
    try {
      ponastaviOmejitveNapak();
      const zeton = await pridobiZetonNapake(dir);
      await shraniNastavitveNapak({ obvesti: true, stevilka: "+38640123456" }, dir);

      const opozorila: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: unknown[]) => opozorila.push(args.map(String).join(" "));
      try {
        const odg = await handleNapakeRequest(
          new Request("http://localhost:8080/api/napake", {
            method: "POST",
            headers: { authorization: `Bearer ${zeton}`, host: "localhost:8080" },
            body: JSON.stringify({ naprava: "TV", proces: "predvajalnik", izjema: "druga napaka" }),
          }),
          "127.0.0.1",
          dir,
          async () => {
            throw new Error("Napaka SMS vrstica 1\nvrstica 2\r\nponarejen dnevnik");
          },
        );
        assert.equal(odg.status, 200);
      } finally {
        console.warn = origWarn;
      }

      const stanje = await pridobiStanjeNapak(dir);
      assert.ok(stanje.zadnjaNapakaSms, "zadnjaNapakaSms mora biti zapisana");
      assert.ok(!/[\r\n]/.test(stanje.zadnjaNapakaSms!), `zadnjaNapakaSms ne sme imeti novih vrstic: ${JSON.stringify(stanje.zadnjaNapakaSms)}`);
      assert.equal(opozorila.length, 1);
      assert.ok(!/[\r\n]/.test(opozorila[0]), `dnevnik ne sme imeti novih vrstic: ${JSON.stringify(opozorila[0])}`);
    } finally {
      ponastaviOmejitveNapak();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("KAK2-15c: vVrsti ne zastoji ob gnezdenju", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lina-cist-k15c-"));
    try {
      ponastaviOmejitveNapak();
      const izidGnezdenja = await Promise.race([
        vVrsti(() => sprejmiNotranjo({ naprava: "TV", proces: "p", vrsta: "c", izjema: "gnezdeno" }, dir)),
        new Promise<string>((r) => setTimeout(() => r("zastoj"), 300)),
      ]);
      assert.equal(izidGnezdenja, true, "gnezden klic vVrsti ne sme zastojiti");
    } finally {
      ponastaviOmejitveNapak();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
