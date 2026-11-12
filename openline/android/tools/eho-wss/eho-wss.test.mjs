import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import https from 'node:https';
import crypto from 'node:crypto';
import { fork } from 'node:child_process';
import fs from 'node:fs';

const VRATA = 8787;
const NASLOV = '127.0.0.1';
const ZETON = 'skrivnost123';

let streznikProces;
let zacasnaMapaIzStreznika = null;

function cakaj(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function zazeniStreznik(zeton = ZETON, vrata = VRATA) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (zeton !== null) {
      env.EHO_ZETON = zeton;
    } else {
      delete env.EHO_ZETON;
    }

    const p = fork(new URL('./eho-wss.mjs', import.meta.url).pathname, ['--vrata', vrata.toString()], {
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

  it('6. zacasna mapa po koncu ne obstaja', async () => {
    streznikProces.zaprtoNamerno = true;
    streznikProces.kill('SIGTERM');
    await cakaj(500); // Počakamo na pocisti()
    
    assert.ok(zacasnaMapaIzStreznika);
    assert.strictEqual(fs.existsSync(zacasnaMapaIzStreznika), false);
    
    streznikProces = null; // Preprecimo dvojno ubijanje v after
  });
});
