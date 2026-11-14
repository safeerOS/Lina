import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import https from 'node:https';
import crypto from 'node:crypto';
import { fork } from 'node:child_process';
import fs from 'node:fs';

const VRATA = 8787;
const NASLOV = '127.0.0.1';
const ZETON = 'skrivnost-preizkusa-eho-0123456789abcdef';

let streznikProces;
let zacasnaMapaIzStreznika = null;

function cakaj(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function zazeniStreznik(zeton = ZETON, vrata = VRATA, dodatniArgumenti = []) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (zeton !== null) {
      env.EHO_ZETON = zeton;
    } else {
      delete env.EHO_ZETON;
    }

    const p = fork(new URL('./eho-wss.mjs', import.meta.url).pathname, ['--vrata', vrata.toString(), ...dodatniArgumenti], {
      env,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });

    let stdout = '';
    let stderr = '';
    let mapa = null;
    let odtis = null;
    
    const preveriPripravljenost = () => {
      if (odtis && mapa) resolve({ proces: p, odtis, mapa });
    };

    p.on('message', (msg) => {
      if (msg && msg.tip === 'mapa') {
        mapa = msg.pot;
        preveriPripravljenost();
      }
    });

    p.stdout.on('data', d => {
      stdout += d.toString();
      if (stdout.includes(':') && !odtis) {
        odtis = stdout.trim();
        preveriPripravljenost();
      }
    });

    p.stderr.on('data', d => {
      stderr += d.toString();
    });

    p.on('exit', (koda) => {
      if (koda !== 0 && !p.zaprtoNamerno) {
        reject(new Error(`Proces se je zaprl s kodo ${koda}: ${stderr}`));
      }
    });
    
    setTimeout(() => {
       if (stderr.length > 0) reject(new Error(stderr));
    }, 1000);
  });
}

/** Zagon mora spodleteti; ce kljub temu stece (stara koda), proces ustavimo - preizkus ne pusti streznika. */
async function zagonSpodleti(zeton, vrata, argumenti, vzorec) {
  let r;
  try {
    r = await zazeniStreznik(zeton, vrata, argumenti);
  } catch (e) {
    assert.match(e.message, vzorec);
    return;
  }
  r.proces.zaprtoNamerno = true;
  r.proces.kill('SIGTERM');
  await cakaj(200);
  assert.fail(`zagon je uspel: ${argumenti.join(' ') || zeton}`);
}

function poveziWS(zeton, vrata = VRATA) {
  return new Promise((resolve, reject) => {
    const moznosti = {
      hostname: NASLOV,
      port: vrata,
      path: '/v1/device-channel',
      rejectUnauthorized: false,
      headers: {
        'Connection': 'Upgrade',
        'Upgrade': 'websocket',
        'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
        'Sec-WebSocket-Version': '13'
      }
    };

    if (zeton) {
      moznosti.headers['Authorization'] = `Bearer ${zeton}`;
    }

    const req = https.request(moznosti);
    
    req.on('upgrade', (res, socket, head) => {
      resolve(socket);
    });

    req.on('response', (res) => {
       reject(new Error(`Zavrnjeno: ${res.statusCode}`));
    });

    req.on('error', reject);
    req.end();
  });
}

function posljiOkvir(socket, tovor, opcode) {
  const dolz = tovor.length;
  let glava;
  const maska = crypto.randomBytes(4);
  
  if (dolz <= 125) {
    glava = Buffer.alloc(2);
    glava[0] = 0x80 | opcode;
    glava[1] = 0x80 | dolz;
  } else {
    glava = Buffer.alloc(4);
    glava[0] = 0x80 | opcode;
    glava[1] = 0x80 | 126;
    glava.writeUInt16BE(dolz, 2);
  }
  
  const payload = Buffer.alloc(dolz);
  for(let i = 0; i < dolz; i++) {
     payload[i] = tovor[i] ^ maska[i%4];
  }
  
  socket.write(Buffer.concat([glava, maska, payload]));
}

describe('Eho WSS Streznik', () => {
  before(async () => {
    const rezultat = await zazeniStreznik();
    streznikProces = rezultat.proces;
    zacasnaMapaIzStreznika = rezultat.mapa;
  });

  after(async () => {
    if (streznikProces) {
      streznikProces.zaprtoNamerno = true;
      streznikProces.kill('SIGTERM');
      await cakaj(500); // Počakamo, da se ustavi
    }
  });

  it('1. brez/napacen zeton -> zavrnjeno', async () => {
    await assert.rejects(poveziWS(null), /Zavrnjeno: 401/);
    await assert.rejects(poveziWS('napacen'), /Zavrnjeno: 401/);
  });

  it('2. pravi zeton + binarni okvir -> isti okvir nazaj', async () => {
    const socket = await poveziWS(ZETON);
    
    const odgovor = await new Promise((resolve) => {
      socket.once('data', (podatki) => {
         const opcode = podatki[0] & 0x0F;
         const dolz = podatki[1] & 0x7F;
         const tovor = podatki.subarray(2, 2 + dolz);
         resolve({ opcode, tovor });
      });
      posljiOkvir(socket, Buffer.from('test binarni'), 0x2);
    });

    assert.strictEqual(odgovor.opcode, 0x2);
    assert.strictEqual(odgovor.tovor.toString(), 'test binarni');
    socket.destroy();
  });

  it('3. besedilni okvir zavrnjen', async () => {
    const socket = await poveziWS(ZETON);
    socket.resume(); // Nujno, da tok tece in se zazna close/end
    
    const zaprto = new Promise((resolve) => {
      socket.on('close', resolve);
      socket.on('error', resolve);
      socket.on('end', resolve);
    });

    posljiOkvir(socket, Buffer.from('test besedilo'), 0x1);
    
    await zaprto;
    assert.ok(true);
  });

  it('4. druga povezava hkrati zavrnjena', async () => {
    const socket1 = await poveziWS(ZETON);
    socket1.resume();
    await assert.rejects(poveziWS(ZETON), /Zavrnjeno: 429/);
    socket1.destroy();
  });

  it('5. strezniku brez EHO_ZETON zagon spodleti', async () => {
    await assert.rejects(zazeniStreznik(null, 8788), /manjka EHO_ZETON/);
  });

  it('5b. N10: kratek zeton, javni naslov, vsi vmesniki in ime gostitelja zavrnjeni', async () => {
    await zagonSpodleti('kratek', 8788, [], /vsaj 32 bajtov/);
    for (const naslov of ['0.0.0.0', '::', '203.0.113.5', '100.64.0.1', 'localhost', '192.169.0.1']) {
      await zagonSpodleti(ZETON, 8788, ['--naslov', naslov], /naslov mora biti/);
    }
    await zagonSpodleti(ZETON, 8788, ['--neznano', 'x'], /neznan argument/);
  });

  it('7. N11: kljuc ni na disku ze med tekom (izbrisan takoj po branju)', async () => {
    assert.ok(zacasnaMapaIzStreznika);
    assert.strictEqual(fs.existsSync(zacasnaMapaIzStreznika), false);
  });

  it('8. N11: openssl brez lupine (execFileSync, ne execSync)', () => {
    const vir = fs.readFileSync(new URL('./eho-wss.mjs', import.meta.url), 'utf8');
    assert.ok(!/\bexecSync\s*\(/.test(vir), 'execSync z ukazno vrstico lupine');
    assert.ok(/execFileSync\('\/usr\/bin\/openssl'/.test(vir));
  });

  it('9. N12: razdeljen okvir (FIN=0) in predolg ping se zavrneta', async () => {
    for (const [prvi, tovor] of [[0x02, Buffer.alloc(10)], [0x89, Buffer.alloc(126)], [0x80, Buffer.alloc(4)]]) {
      const socket = await poveziWS(ZETON);
      const prejeto = [];
      socket.on('data', (d) => prejeto.push(d));
      const zaprto = new Promise((r) => { socket.on('close', r); socket.on('error', r); socket.on('end', r); });
      const maska = crypto.randomBytes(4);
      const d = tovor.length;
      const glava = d <= 125 ? Buffer.from([prvi, 0x80 | d]) : Buffer.from([prvi, 0x80 | 126, d >> 8, d & 0xff]);
      socket.write(Buffer.concat([glava, maska, tovor.map((b, i) => b ^ maska[i % 4])]));
      const izid = await Promise.race([zaprto.then(() => 'zaprto'), cakaj(2000).then(() => 'odprto')]);
      if (izid !== 'zaprto') socket.destroy();
      assert.strictEqual(izid, 'zaprto', `prvi=${prvi.toString(16)}: povezava ostane odprta`);
      const vse = Buffer.concat(prejeto);
      // Edini odgovor je okvir zapri (0x88), nikoli eho ali pong.
      assert.ok(vse.length === 0 || vse[0] === 0x88, `prvi=${prvi.toString(16)} odgovor=${vse.subarray(0, 2).toString('hex')}`);
      await cakaj(50);
    }
  });

  it('10. N12: okvir, poslan skupaj z zahtevo za nadgradnjo, se vrne', async () => {
    const tls = await import('node:tls');
    const odgovor = await new Promise((resolve, reject) => {
      const s = tls.connect({ host: NASLOV, port: VRATA, rejectUnauthorized: false }, () => {
        const maska = crypto.randomBytes(4);
        const tovor = Buffer.from('prvi okvir');
        const okvir = Buffer.concat([Buffer.from([0x82, 0x80 | tovor.length]), maska, tovor.map((b, i) => b ^ maska[i % 4])]);
        s.write(Buffer.concat([Buffer.from(
          `GET /v1/device-channel HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n` +
          `Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nAuthorization: Bearer ${ZETON}\r\n\r\n`
        ), okvir]));
      });
      let bafer = Buffer.alloc(0);
      const rok = setTimeout(() => { s.destroy(); resolve(null); }, 2000);
      s.on('data', (d) => {
        bafer = Buffer.concat([bafer, d]);
        const konecGlave = bafer.indexOf('\r\n\r\n');
        if (konecGlave >= 0 && bafer.length >= konecGlave + 4 + 2 + 10) {
          clearTimeout(rok);
          const o = bafer.subarray(konecGlave + 4);
          s.destroy();
          resolve(o.subarray(2, 2 + (o[1] & 0x7f)).toString());
        }
      });
      s.on('error', reject);
    });
    assert.strictEqual(odgovor, 'prvi okvir');
    await cakaj(50);
  });

  it('6. zacasna mapa po koncu ne obstaja', async () => {
    streznikProces.zaprtoNamerno = true;
    streznikProces.kill('SIGTERM');
    await cakaj(500); // Počakamo na pocisti()
    
    assert.ok(zacasnaMapaIzStreznika);
    assert.strictEqual(fs.existsSync(zacasnaMapaIzStreznika), false);
    
    streznikProces = null; // Preprecimo dvojno ubijanje v after
  });
});
