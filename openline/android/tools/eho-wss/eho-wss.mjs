import https from 'node:https';
import crypto from 'node:crypto';
import { execSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: argVrednosti } = parseArgs({
  options: {
    naslov: { type: 'string', default: '127.0.0.1' },
    vrata: { type: 'string', default: '8787' }
  },
  strict: false
});

if (!process.env.EHO_ZETON) {
  console.error("Napaka: manjka EHO_ZETON");
  process.exit(1);
}
const zahtevanZeton = process.env.EHO_ZETON;

if (argVrednosti.naslov === '0.0.0.0') {
  console.error("Napaka: naslov 0.0.0.0 ni dovoljen");
  process.exit(1);
}

const zacasnaMapa = execFileSync('/usr/bin/mktemp', ['-d']).toString().trim();
const kljucPot = path.join(zacasnaMapa, 'kljuc.pem');
const potrdiloPot = path.join(zacasnaMapa, 'potrdilo.pem');

execSync(`/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -keyout "${kljucPot}" -out "${potrdiloPot}" -days 1 -subj "/CN=localhost" 2>/dev/null`);

const potrdiloBajtov = fs.readFileSync(potrdiloPot);
const potrdiloDer = new crypto.X509Certificate(potrdiloBajtov);

let aktivnaPovezava = null;

const streznik = https.createServer({
  key: fs.readFileSync(kljucPot),
  cert: potrdiloBajtov
});

streznik.on('request', (req, res) => {
  res.writeHead(426, { 'Content-Type': 'text/plain' });
  res.end('Zahtevana nadgradnja');
});

streznik.on('upgrade', (req, socket, head) => {
  if (req.url !== '/v1/device-channel') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  const authGlava = req.headers['authorization'];
  if (!authGlava || !authGlava.startsWith('Bearer ')) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  const podanZeton = authGlava.slice(7);
  // Zgoscena vrednost: enaka dolzina, zato ne izda dolzine zetona (primerjava v stalnem casu).
  const bufZahtevan = crypto.createHash('sha256').update(zahtevanZeton).digest();
  const bufPodan = crypto.createHash('sha256').update(podanZeton).digest();

  if (!crypto.timingSafeEqual(bufZahtevan, bufPodan)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  if (aktivnaPovezava) {
    socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
    socket.destroy();
    return;
  }

  const kljucWS = req.headers['sec-websocket-key'];
  if (!kljucWS) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  const sprejemKljuc = crypto.createHash('sha1').update(kljucWS + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  const odziv = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${sprejemKljuc}`,
    '\r\n'
  ].join('\r\n');

  socket.write(odziv);
  aktivnaPovezava = socket;
  let casovnik = null;

  const ponastaviCasovnik = () => {
    if (casovnik) clearTimeout(casovnik);
    casovnik = setTimeout(() => {
      socket.destroy();
    }, 30000);
  };
  ponastaviCasovnik();

  let bafer = Buffer.alloc(0);

  socket.on('data', (podatki) => {
    ponastaviCasovnik();
    bafer = Buffer.concat([bafer, podatki]);

    while (bafer.length >= 2) {
      const prviBajt = bafer[0];
      const drugiBajt = bafer[1];
      const opcode = prviBajt & 0x0F;
      const maskiran = (drugiBajt & 0x80) !== 0;
      let dolzina = drugiBajt & 0x7F;
      let zamik = 2;
      
      if (dolzina === 126) {
        if (bafer.length < 4) return;
        dolzina = bafer.readUInt16BE(2);
        zamik = 4;
      } else if (dolzina === 127) {
        if (bafer.length < 10) return;
        const visja = bafer.readUInt32BE(2);
        const nizja = bafer.readUInt32BE(6);
        if (visja > 0 || nizja > 65536) {
           zapriZNapako();
           return;
        }
        dolzina = nizja;
        zamik = 10;
      }

      if (dolzina > 65536) {
        zapriZNapako();
        return;
      }

      if (!maskiran) {
        zapriZNapako();
        return;
      }

      if (bafer.length < zamik + 4 + dolzina) {
        return;
      }

      const maska = bafer.subarray(zamik, zamik + 4);
      const tovor = bafer.subarray(zamik + 4, zamik + 4 + dolzina);
      const odmaskiran = Buffer.alloc(dolzina);
      
      for (let i = 0; i < dolzina; i++) {
        odmaskiran[i] = tovor[i] ^ maska[i % 4];
      }

      bafer = bafer.subarray(zamik + 4 + dolzina);

      if (opcode === 0x8) {
        socket.destroy();
        break;
      }

      if (opcode === 0x1) {
        zapriZNapako();
        break;
      }

      if (opcode === 0x2) {
        posljiOkvir(odmaskiran, 0x2);
      }
      
      if (opcode === 0x9) {
         posljiOkvir(odmaskiran, 0xA);
      }
    }
  });

  const zapriZNapako = () => {
    const buf = Buffer.alloc(4);
    buf[0] = 0x88; 
    buf[1] = 0x02; 
    buf.writeUInt16BE(1002, 2);
    socket.write(buf);
    socket.destroy();
  };

  const posljiOkvir = (tovor, vOpcode) => {
    const d = tovor.length;
    let glava;
    if (d <= 125) {
      glava = Buffer.alloc(2);
      glava[0] = 0x80 | vOpcode;
      glava[1] = d; 
    } else if (d <= 65535) {
      glava = Buffer.alloc(4);
      glava[0] = 0x80 | vOpcode;
      glava[1] = 126;
      glava.writeUInt16BE(d, 2);
    } else {
      glava = Buffer.alloc(10);
      glava[0] = 0x80 | vOpcode;
      glava[1] = 127;
      glava.writeUInt32BE(0, 2);
      glava.writeUInt32BE(d, 6);
    }
    socket.write(Buffer.concat([glava, tovor]));
  };

  socket.on('close', () => {
    aktivnaPovezava = null;
    if (casovnik) clearTimeout(casovnik);
  });
  
  socket.on('error', () => {
    aktivnaPovezava = null;
    if (casovnik) clearTimeout(casovnik);
  });
});

streznik.listen(parseInt(argVrednosti.vrata, 10), argVrednosti.naslov, () => {
  console.log(potrdiloDer.fingerprint256);
  if (process.send) {
    process.send({ tip: 'mapa', pot: zacasnaMapa });
  }
});

const pocisti = () => {
  streznik.close();
  if (aktivnaPovezava) {
    aktivnaPovezava.destroy();
  }
  try {
    fs.rmSync(zacasnaMapa, { recursive: true, force: true });
  } catch (e) {}
  process.exit(0);
};

process.on('SIGINT', pocisti);
process.on('SIGTERM', pocisti);
