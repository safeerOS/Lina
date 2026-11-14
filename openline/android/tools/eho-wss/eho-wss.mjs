// Razvojno orodje (stopnja 1 preizkusa): wss eho za binarne okvirje s pripetim odtisom. Ni del izdelka.
import https from 'node:https';
import crypto from 'node:crypto';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const NAJKRAJSI_ZETON_BAJTOV = 32; // kot sprejemnik zvoka (pregled 15, N5)
const NAJVEC_TOVORA = 65536;

function napaka(sporocilo) {
  console.error(`Napaka: ${sporocilo}`);
  process.exit(1);
}

let argVrednosti;
try {
  ({ values: argVrednosti } = parseArgs({
    options: {
      naslov: { type: 'string', default: '127.0.0.1' },
      vrata: { type: 'string', default: '8787' }
    },
    strict: true
  }));
} catch (e) {
  napaka(`neznan argument (${e.code ?? 'parse'})`);
}

// Pregled 15, N10: eho poslusa samo na zanki ali zasebnem naslovu domacega omrezja - nikoli na javnem
// naslovu, 0.0.0.0 ali :: (vsi vmesniki) in ne na imenu gostitelja (ime lahko razresi kamorkoli).
const ZASEBNI = new net.BlockList();
ZASEBNI.addSubnet('127.0.0.0', 8, 'ipv4');
ZASEBNI.addSubnet('10.0.0.0', 8, 'ipv4');
ZASEBNI.addSubnet('172.16.0.0', 12, 'ipv4');
ZASEBNI.addSubnet('192.168.0.0', 16, 'ipv4');
ZASEBNI.addAddress('::1', 'ipv6');
ZASEBNI.addSubnet('fc00::', 7, 'ipv6');

function jeDovoljenNaslov(naslov) {
  const druzina = net.isIP(naslov);
  if (druzina === 4) return ZASEBNI.check(naslov, 'ipv4');
  if (druzina === 6) return ZASEBNI.check(naslov, 'ipv6');
  return false;
}

if (!jeDovoljenNaslov(argVrednosti.naslov)) {
  napaka('naslov mora biti 127.0.0.1 ali zaseben IP domacega omrezja (ne 0.0.0.0, ne javni, ne ime)');
}
const vrata = Number(argVrednosti.vrata);
if (!Number.isInteger(vrata) || vrata < 1 || vrata > 65535) napaka('neveljavna vrata');

const zahtevanZeton = process.env.EHO_ZETON;
if (!zahtevanZeton) napaka('manjka EHO_ZETON');
if (Buffer.byteLength(zahtevanZeton, 'utf8') < NAJKRAJSI_ZETON_BAJTOV) {
  napaka(`EHO_ZETON mora imeti vsaj ${NAJKRAJSI_ZETON_BAJTOV} bajtov`);
}
const zgoscenZahtevan = crypto.createHash('sha256').update(zahtevanZeton).digest();

// Pregled 15, N11: openssl brez lupine (execFileSync, absolutna pot) in zasebni kljuc samo v pomnilniku:
// datoteki se izbriseta takoj po branju, ne sele ob SIGTERM - tudi kill -9 ali sesutje ne pusti kljuca na disku.
const zacasnaMapa = execFileSync('/usr/bin/mktemp', ['-d']).toString().trim();
const pocistiMapo = () => {
  try { fs.rmSync(zacasnaMapa, { recursive: true, force: true }); } catch {}
};
process.on('exit', pocistiMapo);
let kljucBajtov;
let potrdiloBajtov;
try {
  const kljucPot = path.join(zacasnaMapa, 'kljuc.pem');
  const potrdiloPot = path.join(zacasnaMapa, 'potrdilo.pem');
  execFileSync('/usr/bin/openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', kljucPot, '-out', potrdiloPot,
    '-days', '1', '-subj', '/CN=localhost'
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  kljucBajtov = fs.readFileSync(kljucPot);
  potrdiloBajtov = fs.readFileSync(potrdiloPot);
} finally {
  pocistiMapo();
}
const potrdilo = new crypto.X509Certificate(potrdiloBajtov);

let aktivnaPovezava = null;

const streznik = https.createServer({ key: kljucBajtov, cert: potrdiloBajtov });

streznik.on('request', (req, res) => {
  res.writeHead(426, { 'Content-Type': 'text/plain' });
  res.end('Zahtevana nadgradnja');
});

function zavrni(socket, statusnaVrstica) {
  socket.write(`HTTP/1.1 ${statusnaVrstica}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

streznik.on('upgrade', (req, socket, head) => {
  if (req.url !== '/v1/device-channel') return zavrni(socket, '404 Not Found');

  const authGlava = req.headers['authorization'];
  if (!authGlava || !authGlava.startsWith('Bearer ')) return zavrni(socket, '401 Unauthorized');
  // Zgoscena vrednost: enaka dolzina, zato ne izda dolzine zetona (primerjava v stalnem casu).
  const zgoscenPodan = crypto.createHash('sha256').update(authGlava.slice(7)).digest();
  if (!crypto.timingSafeEqual(zgoscenZahtevan, zgoscenPodan)) return zavrni(socket, '401 Unauthorized');

  if (aktivnaPovezava) return zavrni(socket, '429 Too Many Requests');

  const kljucWS = req.headers['sec-websocket-key'];
  if (!kljucWS) return zavrni(socket, '400 Bad Request');

  const sprejemKljuc = crypto.createHash('sha1').update(kljucWS + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${sprejemKljuc}`,
    '\r\n'
  ].join('\r\n'));
  aktivnaPovezava = socket;
  let casovnik = null;
  let zaprto = false;

  const ponastaviCasovnik = () => {
    if (casovnik) clearTimeout(casovnik);
    casovnik = setTimeout(() => socket.destroy(), 30000);
  };
  ponastaviCasovnik();

  const zapriZNapako = (koda = 1002) => {
    if (zaprto) return;
    zaprto = true;
    const buf = Buffer.alloc(4);
    buf[0] = 0x88;
    buf[1] = 0x02;
    buf.writeUInt16BE(koda, 2);
    socket.end(buf);
    socket.destroy();
  };

  const posljiOkvir = (tovor, vOpcode) => {
    const d = tovor.length;
    let glava;
    if (d <= 125) {
      glava = Buffer.from([0x80 | vOpcode, d]);
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

  let bafer = Buffer.alloc(0);

  const obdelaj = (podatki) => {
    if (zaprto) return;
    ponastaviCasovnik();
    bafer = Buffer.concat([bafer, podatki]);

    while (!zaprto && bafer.length >= 2) {
      const prviBajt = bafer[0];
      const drugiBajt = bafer[1];
      const fin = (prviBajt & 0x80) !== 0;
      const opcode = prviBajt & 0x0F;
      const maskiran = (drugiBajt & 0x80) !== 0;
      let dolzina = drugiBajt & 0x7F;
      let zamik = 2;

      // Samo celi okvirji znanih vrst (RFC 6455): binarni, zapri, ping, pong. Razdeljeni okvirji (FIN=0,
      // nadaljevanje 0x0), rezervirani biti in neznane vrste se zavrnejo, sicer bi eho vracal nepopolne okvirje.
      if (!fin || (prviBajt & 0x70) !== 0 || ![0x1, 0x2, 0x8, 0x9, 0xA].includes(opcode)) return zapriZNapako();
      if (!maskiran) return zapriZNapako();

      if (dolzina === 126) {
        if (bafer.length < 4) return;
        dolzina = bafer.readUInt16BE(2);
        zamik = 4;
      } else if (dolzina === 127) {
        if (bafer.length < 10) return;
        const visja = bafer.readUInt32BE(2);
        const nizja = bafer.readUInt32BE(6);
        if (visja > 0 || nizja > NAJVEC_TOVORA) return zapriZNapako(1009);
        dolzina = nizja;
        zamik = 10;
      }
      if (dolzina > NAJVEC_TOVORA) return zapriZNapako(1009);
      // Nadzorni okvir ima najvec 125 B tovora (RFC 6455 5.5); daljsi ping bi dal neveljaven pong.
      if (opcode >= 0x8 && dolzina > 125) return zapriZNapako();

      if (bafer.length < zamik + 4 + dolzina) return;

      const maska = bafer.subarray(zamik, zamik + 4);
      const tovor = bafer.subarray(zamik + 4, zamik + 4 + dolzina);
      const odmaskiran = Buffer.alloc(dolzina);
      for (let i = 0; i < dolzina; i++) odmaskiran[i] = tovor[i] ^ maska[i % 4];
      bafer = bafer.subarray(zamik + 4 + dolzina);

      if (opcode === 0x8) { zaprto = true; socket.destroy(); return; }
      if (opcode === 0x1) return zapriZNapako(1003);
      if (opcode === 0x2) posljiOkvir(odmaskiran, 0x2);
      if (opcode === 0x9) posljiOkvir(odmaskiran, 0xA);
      // pong (0xA): brez odgovora
    }
  };

  socket.on('data', obdelaj);
  const ob_koncu = () => {
    zaprto = true;
    if (aktivnaPovezava === socket) aktivnaPovezava = null;
    if (casovnik) clearTimeout(casovnik);
  };
  socket.on('close', ob_koncu);
  socket.on('error', ob_koncu);
  // Bajti, ki so prisli skupaj z zahtevo za nadgradnjo, so ze prvi okvirji - ne smejo se izgubiti.
  if (head && head.length > 0) obdelaj(head);
});

streznik.on('error', (e) => napaka(`streznik (${e.code ?? 'neznano'})`));

streznik.listen(vrata, argVrednosti.naslov, () => {
  console.log(potrdilo.fingerprint256);
  if (process.send) process.send({ tip: 'mapa', pot: zacasnaMapa });
});

const ustavi = () => {
  streznik.close();
  if (aktivnaPovezava) aktivnaPovezava.destroy();
  process.exit(0);
};
process.on('SIGINT', ustavi);
process.on('SIGTERM', ustavi);
