import { test } from 'node:test';
import * as assert from 'node:assert';
import { NadzornikKakovosti, nastaviKakovostVklopljena } from './kakovost.ts';
import { zabeleziKakovostnoNapako, objaviPredloge } from './kakovost-napake.server.ts';
import { readJsonFile } from './store.server.ts';
import { pridobiStanjeNapak } from './napake.server.ts';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';

function dobriPaketi(): any {
    return { bajti: 100000, casMs: 1000, izgubljeni: 0, zakasneli: 0, jitterMs: 5, napakeDekodiranja: 0, ponovniPrenosi: 0, skupajPaketov: 100 };
}

function slabiPaketi(): any {
    return { bajti: 100000, casMs: 1000, izgubljeni: 5, zakasneli: 0, jitterMs: 60, napakeDekodiranja: 0, ponovniPrenosi: 0, skupajPaketov: 100 };
}

function narediCrnoSliko(): any {
    const podatki = new Uint8Array(100 * 100).fill(0);
    return { sirina: 100, visina: 100, podatki };
}

function doberZvok(): any {
    const vzorci = new Float32Array(100);
    for (let i = 0; i < 100; i++) vzorci[i] = 0.5 * Math.sin(i * 0.1);
    return { vzorci };
}

test('zapis napake prek injekcije', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lina-kakovost-test-'));
    try {
        let napakaPoslana = false;
        nastaviKakovostVklopljena(true);
        const nadzornik = new NadzornikKakovosti(async (n) => {
            napakaPoslana = true;
            try {
                await zabeleziKakovostnoNapako(n.opis, dir);
            } catch (e) {
                console.error("Error in zabeleziKakovostnoNapako", e);
            }
        });
        
        for (let i = 0; i < 5; i++) {
            nadzornik.oceni(slabiPaketi(), narediCrnoSliko(), doberZvok());
        }
        
        assert.strictEqual(napakaPoslana, true, 'Napaka ni bila poslana');
        
        // Wait briefly for handleNapakeRequest to finish since it's async but not awaited inside nadzornik.oceni (which is sync)
        await new Promise(r => setTimeout(r, 200));
        
        const stanje = await pridobiStanjeNapak(dir);
        assert.ok(stanje.vnosi.length > 0, `Napaka ni bila zapisana v napake.json, stanje: ${JSON.stringify(stanje)}`);
        const zadnja = stanje.vnosi[stanje.vnosi.length - 1];
        assert.strictEqual(zadnja.vrsta, 'kakovost');
        assert.strictEqual(zadnja.proces, 'kakovost');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('stikalo izklopljeno = nic zapisano', async () => {
    let napakaPoslana = false;
    nastaviKakovostVklopljena(false);
    const nadzornik = new NadzornikKakovosti((n) => {
        napakaPoslana = true;
    });
    
    nadzornik.oceni(slabiPaketi(), narediCrnoSliko(), doberZvok());
    
    assert.strictEqual(napakaPoslana, false, 'Napaka je bila poslana ceprav je stikalo izklopljeno');
});

test('omejitev 50 predlogov in ciscenje', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lina-kakovost-test-'));
    nastaviKakovostVklopljena(true);
    try {
        const predlogi = [];
        for (let i = 0; i < 60; i++) {
            predlogi.push({ ime: `Predlog ${i}`, opis: `Predlog ${i} z e-posto test@test.com` });
        }
        
        await objaviPredloge(predlogi, dir);
        
        const stored = await readJsonFile<any[]>(dir, 'kakovost-predlogi.json');
        assert.ok(stored);
        assert.strictEqual(stored.length, 50, 'Ni omejeno na 50 zapisov');
        assert.ok(stored[0].opis.includes('EMAIL@DOMAIN.COM'), 'Osebni podatki niso bili ocisceni');
        assert.ok(!stored[0].opis.includes('test@test.com'), 'Email je se vedno prisoten');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('KAK2-14 cistiObject ne unici DAG instanc, rokuje z Date in posodobi predloge', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lina-kakovost-test-2-'));
    nastaviKakovostVklopljena(true);
    try {
        const obj = { shared: true };
        const date = new Date('2026-01-01T00:00:00.000Z');
        const predlogi = [
            { ime: 'Predlog A', vrednost: 1, dag1: obj, dag2: obj, datum: date, typed: new Uint8Array([1, 2, 3]) }
        ];
        
        await objaviPredloge(predlogi, dir);
        await objaviPredloge([{ ime: 'Predlog A', vrednost: 2 }], dir);
        
        const stored = await readJsonFile<any[]>(dir, 'kakovost-predlogi.json');
        assert.strictEqual(stored![0].vrednost, 2, 'Predlog A ni bil posodobljen');
        assert.strictEqual(stored!.length, 1, 'Predlog se je podvojil');
        
        await objaviPredloge(predlogi, dir); // Write back the full one
        const stored2 = await readJsonFile<any[]>(dir, 'kakovost-predlogi.json');
        assert.deepStrictEqual(stored2![0].dag1, { shared: true });
        assert.deepStrictEqual(stored2![0].dag2, { shared: true });
        assert.strictEqual(stored2![0].datum, '2026-01-01T00:00:00.000Z');
        assert.deepStrictEqual(stored2![0].typed, [1, 2, 3]);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
