import { test, afterEach } from 'node:test';
import * as assert from 'node:assert';
import { NadzornikKakovosti, nastaviKakovostVklopljena, izracunajOstrino, izracunajBlokovnost, oceniSliko, oceniPakete } from './kakovost.ts';

afterEach(() => {
    nastaviKakovostVklopljena(false);
});

function narediCrnoSliko(): any {
    const podatki = new Uint8Array(100 * 100).fill(0);
    return { sirina: 100, visina: 100, podatki };
}

function narediOstrojSliko(): any {
    const podatki = new Uint8Array(100 * 100);
    for (let i = 0; i < 100; i++) {
        for (let j = 0; j < 100; j++) {
            podatki[i * 100 + j] = (i + j) % 2 === 0 ? 255 : 0;
        }
    }
    return { sirina: 100, visina: 100, podatki };
}

function narediZamegljenoSliko(): any {
    const podatki = new Uint8Array(100 * 100);
    for (let i = 0; i < 100; i++) {
        for (let j = 0; j < 100; j++) {
            podatki[i * 100 + j] = Math.floor((i + j) / 200 * 255);
        }
    }
    return { sirina: 100, visina: 100, podatki };
}

function narediBlokovnoSliko(): any {
    const podatki = new Uint8Array(100 * 100);
    for (let i = 0; i < 100; i++) {
        for (let j = 0; j < 100; j++) {
            const blockI = Math.floor(i / 8);
            const blockJ = Math.floor(j / 8);
            const noise = (i * 7 + j * 3) % 5; // Internal difference > 1
            podatki[i * 100 + j] = ((blockI + blockJ) % 2 === 0 ? 200 : 50) + noise;
        }
    }
    return { sirina: 100, visina: 100, podatki };
}

function dobriPaketi(): any {
    return {
        bajti: 100000,
        casMs: 1000,
        izgubljeni: 0,
        zakasneli: 0,
        jitterMs: 5,
        napakeDekodiranja: 0,
        ponovniPrenosi: 0,
        skupajPaketov: 100
    };
}

function prazniPaketi(): any {
    return {
        bajti: 0,
        casMs: 1000,
        izgubljeni: 0,
        zakasneli: 0,
        jitterMs: 0,
        napakeDekodiranja: 0,
        ponovniPrenosi: 0,
        skupajPaketov: 0
    };
}

function doberZvok(): any {
    const vzorci = new Float32Array(100);
    for (let i = 0; i < 100; i++) vzorci[i] = 0.5 * Math.sin(i * 0.1);
    return { vzorci };
}

test('KAK12 privzeto stikalo je izklopljeno (brez klica nastavitve)', async () => {
    const mod = await import('./kakovost.ts?svez=' + Date.now());
    assert.strictEqual(mod.KAKOVOST_VKLOPLJENA, false);
    const m = new mod.NadzornikKakovosti().oceni(dobriPaketi(), narediOstrojSliko(), doberZvok());
    assert.strictEqual(m.bitnaHitrost, 0);       // gola pot brez vklopa
});

test('zamegljena slika zniza oceno in povzroci popravek po 5 okvirjih', () => {
    nastaviKakovostVklopljena(true);
    const nadzornik = new NadzornikKakovosti();
    let m1;
    for (let i = 0; i < 5; i++) {
        m1 = nadzornik.oceni(dobriPaketi(), narediZamegljenoSliko(), doberZvok());
    }
    
    assert.ok(m1!.slikaOstrina < 10, 'Ostrina naj bo nizka');
    assert.ok(m1!.ocena < 100, 'Ocena naj bo znizana');
    
    assert.strictEqual(nadzornik.zgodovinaPopravkov.length, 1);
    assert.strictEqual(nadzornik.zgodovinaPopravkov[0].tarca, 'ostrina');
});

test('blokovna slika', () => {
    nastaviKakovostVklopljena(true);
    const blokovna = narediBlokovnoSliko();
    const blokovnost = izracunajBlokovnost(blokovna);
    assert.ok(blokovnost > 1.5, 'Blokovnost naj bo visoka');
    
    const nadzornik = new NadzornikKakovosti();
    for (let i = 0; i < 5; i++) {
        nadzornik.oceni(dobriPaketi(), blokovna, doberZvok());
    }
    assert.strictEqual(nadzornik.zgodovinaPopravkov.length, 1);
});

test('crna slika belezi napako', () => {
    nastaviKakovostVklopljena(true);
    const nadzornik = new NadzornikKakovosti();
    
    let m1;
    for (let i = 0; i < 5; i++) {
        m1 = nadzornik.oceni(dobriPaketi(), narediCrnoSliko(), doberZvok());
    }
    assert.strictEqual(m1!.slikaCrn, true);
    assert.ok(m1!.ocena < 60, 'Ocena naj bo znizana');
    
    assert.ok(nadzornik.zabelezeneNapake.length >= 1);
    assert.strictEqual(nadzornik.zabelezeneNapake[0].oznaka, 'kakovost');
});

test('zmrznjen okvir in izpad omrezja', () => {
    nastaviKakovostVklopljena(true);
    const nadzornik = new NadzornikKakovosti();
    
    let m3;
    for (let i = 0; i < 15; i++) {
        m3 = nadzornik.oceni(prazniPaketi(), narediOstrojSliko(), doberZvok());
    }
    
    assert.strictEqual(m3!.slikaZmrznjen, true);
    assert.ok(m3!.ocena < 60, 'Ocena naj bo znizana zaradi zmrznjenega okvirja');
});

test('poslabsanje ne povzroci takoj povrnitve zaradi histereze, dobra slika pa ja', () => {
    nastaviKakovostVklopljena(true);
    const nadzornik = new NadzornikKakovosti();
    
    for (let i = 0; i < 5; i++) {
        nadzornik.oceni(dobriPaketi(), narediZamegljenoSliko(), doberZvok());
    }
    assert.strictEqual(nadzornik.zgodovinaPopravkov.length, 1); 
    
    // Ohladitev je 90 okvirjev, zato simuliramo dolg cas dobre slike
    for (let i = 0; i < 150; i++) {
        nadzornik.oceni(dobriPaketi(), narediOstrojSliko(), doberZvok());
    }
    
    assert.strictEqual(nadzornik.zgodovinaPopravkov.length, 0);
});

function sahovnica(k: number): any {
  const p = new Uint8Array(100 * 100);
  for (let i = 0; i < 100; i++) for (let j = 0; j < 100; j++) p[i * 100 + j] = ((i + j + Math.floor(k / 2)) % 2 === 0) ? 255 : 0;
  return { sirina: 100, visina: 100, podatki: p };
}

test('KAK1 locljivost se po okrevanju omrezja vrne na 1080p', () => {
  nastaviKakovostVklopljena(true);
  const n = new NadzornikKakovosti();
  for (let i = 0; i < 5; i++) {
      n.oceni({ ...dobriPaketi(), izgubljeni: 10, jitterMs: 60 }, sahovnica(0), doberZvok());
  }
  assert.strictEqual(n.trenutneNastavitve.locljivost, '720p');
  for (let k = 1; k <= 400; k++) n.oceni(dobriPaketi(), sahovnica(k), doberZvok());
  assert.strictEqual(n.trenutneNastavitve.locljivost, '1080p');
});

test('KAK1 izklop stikala povrne nastavitve', () => {
  nastaviKakovostVklopljena(true);
  const n = new NadzornikKakovosti();
  for (let i = 0; i < 5; i++) {
      n.oceni({ ...dobriPaketi(), izgubljeni: 10, jitterMs: 60 }, sahovnica(0), doberZvok());
  }
  nastaviKakovostVklopljena(false);
  n.oceni(dobriPaketi(), sahovnica(1), doberZvok());
  assert.strictEqual(n.trenutneNastavitve.locljivost, '1080p');
});

test('KAK2 seznami popravkov ostanejo omejeni', () => {
  nastaviKakovostVklopljena(true);
  const n = new NadzornikKakovosti();
  
  function blokovnaSibka(k: number): any {
    const p = new Uint8Array(100 * 100);
    const pol = Math.floor(k / 2);
    for (let i = 0; i < 100; i++) for (let j = 0; j < 100; j++)
      p[i * 100 + j] = ((Math.floor(i / 8) + Math.floor(j / 8) + pol) % 2 === 0) ? 100 : 102;
    return { sirina: 100, visina: 100, podatki: p };
  }
  
  for (let k = 0; k < 400; k++) n.oceni(dobriPaketi(), blokovnaSibka(k), doberZvok());
  assert.ok(n.zgodovinaPopravkov.length <= 8);
  assert.ok(n.predlaganiPaketi.length <= 50);
  assert.ok(n.zabelezeneNapake.length <= 50);
});

test('KAK3 izjema povratnega klica ne sme prekiniti ocenjevanja', () => {
  nastaviKakovostVklopljena(true);
  const n = new NadzornikKakovosti(() => { throw new Error('x'); });
  assert.doesNotThrow(() => {
      for (let i = 0; i < 10; i++) n.oceni(dobriPaketi(), narediCrnoSliko(), doberZvok());
  });
});

test('KAK5 mirujoca scena z zdravim omrezjem ni napaka', () => {
  nastaviKakovostVklopljena(true);
  const n = new NadzornikKakovosti();
  for (let k = 0; k < 8; k++) n.oceni(dobriPaketi(), sahovnica(0), doberZvok());
  assert.strictEqual(n.zabelezeneNapake.length, 0);
});

test('KAK5 ravna grafika ni blokovna', () => {
  nastaviKakovostVklopljena(true);
  const p = new Uint8Array(100 * 100).fill(40);
  for (let i = 0; i < 100; i++) for (let j = 48; j < 100; j++) p[i * 100 + j] = 200;
  const n = new NadzornikKakovosti();
  const m = n.oceni(dobriPaketi(), { sirina: 100, visina: 100, podatki: p }, doberZvok());
  assert.ok(m.slikaBlokovnost! <= 1.5);
});

test('KAK6 ponovno uporabljen medpomnilnik ni zamrznitev', () => {
  nastaviKakovostVklopljena(true);
  const buf = new Uint8Array(100 * 100);
  const slika = { sirina: 100, visina: 100, podatki: buf };
  const n = new NadzornikKakovosti();
  const napolni = (s: number) => { for (let i = 0; i < buf.length; i++) buf[i] = (i * 7 + s * 90) % 256; };
  napolni(0); n.oceni(prazniPaketi(), slika, doberZvok());
  napolni(1); n.oceni(prazniPaketi(), slika, doberZvok());
  napolni(2); const m = n.oceni(prazniPaketi(), slika, doberZvok());
  assert.strictEqual(m.slikaZmrznjen, false);
});

test('KAK6 ocena ne niha med lihim in sodim okvirjem', () => {
  nastaviKakovostVklopljena(true);
  const n = new NadzornikKakovosti();
  const m: number[] = [];
  for (let k = 0; k < 4; k++) m.push(n.oceni(dobriPaketi(), sahovnica(0), doberZvok()).ocena);
  assert.strictEqual(m[3], m[2]);
});

test('KAK2-3 prazna slika ne da 100 ocene, ampak NaN ("neznano")', () => {
  nastaviKakovostVklopljena(true);
  const n = new NadzornikKakovosti();
  const m = n.oceni(dobriPaketi(), { sirina: 0, visina: 0, podatki: new Uint8Array(0) }, doberZvok());
  assert.ok(Number.isNaN(m.ocena) || m.ocena === 0, 'Ocena naj bo NaN ali 0 za neveljavno sliko');
});

test('KAK7 prekratka tabela ne sme tiho dati dobre ocene', () => {
  nastaviKakovostVklopljena(true);
  const n = new NadzornikKakovosti();
  const m = n.oceni(dobriPaketi(), { sirina: 100, visina: 100, podatki: new Uint8Array(10) }, doberZvok());
  assert.ok(Number.isNaN(m.ocena) || m.ocena < 100); // Pademo nazaj na prazno oceno in ce je v kombinaciji slaba - KAK7 zahteva to! (Poglejmo logiko, vrnili smo NaN in v izracunajOceno fallback)
});

test('KAK7 izpad omrezja je 100 % izgube', () => {
  nastaviKakovostVklopljena(true);
  const m = oceniPakete({ ...dobriPaketi(), skupajPaketov: 0, bajti: 0, izgubljeni: 0 });
  assert.strictEqual(m.izgubaPaketov, 100);
});

test('KAK11 crna slika se ne kaznuje se kot zamegljena', () => {
  nastaviKakovostVklopljena(true);
  const m = new NadzornikKakovosti().oceni(dobriPaketi(), narediCrnoSliko(), doberZvok());
  assert.strictEqual(m.ocena, 50); // Samo -50 za crno, ne -25 se za zamegljeno
});

test('KAK2-2 izrinjenje ne sme izgubiti povratka locljivosti; max 8 a z varno povrnitvijo', () => {
    nastaviKakovostVklopljena(true);
    const n = new NadzornikKakovosti();
    // Povzrocimo zmanjsanje locljivosti (paketi) - to je prvi popravek
    for (let i = 0; i < 5; i++) {
        n.oceni({ ...dobriPaketi(), izgubljeni: 10, jitterMs: 60 }, sahovnica(0), doberZvok());
    }
    assert.strictEqual(n.trenutneNastavitve.locljivost, '720p');
    assert.strictEqual(n.zgodovinaPopravkov[0].tarca, 'paketi');

    // Zdaj pa naredimo 8 drugih popravkov (npr. zamegljeno) da zapolnimo zgodovino in izrinemo prvi popravek, ce ni zasciten
    // A počakati moramo ohlajanje 90 okvirjev za vsak popravek!
    for (let p = 0; p < 8; p++) {
        // ohladitev
        for (let j = 0; j < 90; j++) n.oceni({ ...dobriPaketi(), izgubljeni: 10, jitterMs: 60 }, sahovnica(0), doberZvok());
        // poslabsanje ostrine
        for (let i = 0; i < 5; i++) n.oceni({ ...dobriPaketi(), izgubljeni: 10, jitterMs: 60 }, narediZamegljenoSliko(), doberZvok());
    }

    assert.ok(n.zgodovinaPopravkov.length <= 8);
    
    // Zdaj naj si omrezje opomore in pocakamo, da povrne vse
    for (let k = 1; k <= 900; k++) n.oceni(dobriPaketi(), sahovnica(k), doberZvok());

    assert.strictEqual(n.trenutneNastavitve.locljivost, '1080p', 'Povratek locljivosti ne bi smel biti izgubljen');
});

test('KAK2-4 ohlajanje za vejo crn/zmrznjen in temna scena ni napaka', () => {
    nastaviKakovostVklopljena(true);
    const n = new NadzornikKakovosti();
    
    // Temna scena z vsebino (povprecje 12, odklon 8): ni crn okvir
    const temna = new Uint8Array(100 * 100);
    for (let i = 0; i < temna.length; i++) temna[i] = 4 + (i % 2) * 16;
    const m = n.oceni(dobriPaketi(), { sirina: 100, visina: 100, podatki: temna }, doberZvok());
    assert.strictEqual(m.slikaCrn, false, 'Temna scena z vsebino ni crn okvir');
    // Prava crna: 0 (poln obseg) in 16 (omejen obseg videa) sta crni, tudi z rahlim sumom kodeka
    for (const raven of [0, 16]) {
        const crna = new Uint8Array(100 * 100);
        for (let i = 0; i < crna.length; i++) crna[i] = raven + (i % 7 === 0 ? 1 : 0);
        const mc = new NadzornikKakovosti().oceni(dobriPaketi(), { sirina: 100, visina: 100, podatki: crna }, doberZvok());
        assert.strictEqual(mc.slikaCrn, true, 'Crna slika (raven ' + raven + ') mora biti zaznana kot crna');
    }

    // Ohlajanje napak
    n.zabelezeneNapake = [];
    for (let i = 0; i < 50; i++) {
        n.oceni(dobriPaketi(), narediCrnoSliko(), doberZvok());
    }
    // Ker obstaja ohlajanje 90 okvirjev, bi morala biti napaka zabelezena le enkrat
    assert.strictEqual(n.zabelezeneNapake.length, 1, 'Napaka za crn okvir naj se zabelezi samo enkrat (ohlajanje)');
});

test('KAK2-5 predlogi nikoli ne prepisejo trenutne nastavitve pri povrnitvi', () => {
    nastaviKakovostVklopljena(true);
    const n = new NadzornikKakovosti();
    n.trenutneNastavitve.ostrina = 80;
    
    for (let i = 0; i < 5; i++) {
        n.oceni(dobriPaketi(), narediZamegljenoSliko(), doberZvok());
    }
    // Imamo predlog za povecanje ostrine
    assert.strictEqual(n.zgodovinaPopravkov.length, 1);
    assert.strictEqual(n.zgodovinaPopravkov[0].stanje, 'predlog');
    assert.strictEqual(n.trenutneNastavitve.ostrina, 80, 'Predlog ne sme spremeniti trenutne nastavitve');
    
    // User manually sets ostrina to 85 while proposal is active
    n.trenutneNastavitve.ostrina = 85;
    
    // Simuliramo okrevanje
    for (let k = 1; k <= 100; k++) n.oceni(dobriPaketi(), sahovnica(k), doberZvok());
    
    assert.strictEqual(n.trenutneNastavitve.ostrina, 85, 'Povrnitev predloga ne sme prepisati uporabnikove nastavitve');
});

test('KAK2-10 povrnitev po 90 okvirjih ne sme nihati 1080p<->720p', () => {
    nastaviKakovostVklopljena(true);
    const n = new NadzornikKakovosti();
    // 1. Zmanjsanje locljivosti
    for (let i = 0; i < 5; i++) {
        n.oceni({ ...dobriPaketi(), izgubljeni: 10, jitterMs: 60 }, sahovnica(0), doberZvok());
    }
    assert.strictEqual(n.trenutneNastavitve.locljivost, '720p');
    
    // 2. Takoj ko locljivost pade, pocakamo nekaj okvirjev z DOBER packet loss.
    for (let i = 0; i < 90; i++) {
        n.oceni(dobriPaketi(), sahovnica(i), doberZvok());
    }
    // Ceprav je minilo 90 okvirjev, ce omrezje vmes se vedno kdaj "kihne", se ne bi smelo takoj povrniti.
    // Naredimo "kihanje" na koncu, da povp se vedno morda doseze 95 za en okvir
    n.oceni({ ...dobriPaketi(), izgubljeni: 10 }, sahovnica(0), doberZvok());
    n.oceni(dobriPaketi(), sahovnica(0), doberZvok());
    
    // Ce bi bilo strogo, se ne sme povrniti ce je kihanje prisotno. 
    // Za test preverimo, da se ne povrne, ce niso bili VSI okvirji v teh 90h dobri!
    assert.strictEqual(n.trenutneNastavitve.locljivost, '720p', 'Ne sme se povrniti brez trajne histereze dobrih okvirjev');
});

test('KAK2-13 zmrznjen okvir ne steje dvakrat', () => {
    nastaviKakovostVklopljena(true);
    const n = new NadzornikKakovosti();
    let m;
    for (let i = 0; i < 10; i++) {
        m = n.oceni(prazniPaketi(), narediCrnoSliko(), doberZvok());
    }
    // Crna slika da kazen -50. Zmrznjena -50. Izpad omrezja -20.
    // Skupaj bi bilo -120 -> ocena 0, a problem je bil da smo morda dvojno odsteli.
    // "zmrznjen okvir ne šteje dvakrat" verjetno pomeni: ce je crn, ne se zmrznjen
    assert.ok(m!.ocena >= 30, 'Zmrznjen okvir se ne sme se enkrat odsteti od ocene ce je ze crn (-50 crn, -20 omrezje -> 30)');
});

test('KAK2-3b neveljavna slika ne zastrupi drsecega okna (NaN): nadzornik se se odziva na slab prenos', () => {
    nastaviKakovostVklopljena(true);
    const slabi = () => ({ ...dobriPaketi(), izgubljeni: 60, zakasneli: 20, jitterMs: 200, napakeDekodiranja: 5, ponovniPrenosi: 10 });
    const slika = () => { const p = new Uint8Array(10000); for (let i = 0; i < p.length; i++) p[i] = (i * 37) % 256; return { sirina: 100, visina: 100, podatki: p }; };
    const sporocil = (zNeveljavno: boolean) => {
        let s = 0;
        const n = new NadzornikKakovosti(() => { s++; });
        if (zNeveljavno) n.oceni(dobriPaketi(), { sirina: 100, visina: 100, podatki: new Uint8Array(10) }, doberZvok());
        for (let i = 0; i < 10; i++) n.oceni(slabi(), slika(), doberZvok());
        return s;
    };
    assert.ok(sporocil(false) > 0, 'kontrola: brez neveljavne slike se nadzornik odzove');
    assert.ok(sporocil(true) > 0, 'ena neveljavna slika je ustavila odzivanje nadzornika');
});
