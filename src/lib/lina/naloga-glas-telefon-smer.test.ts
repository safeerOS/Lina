// Pot telefona: smer klica v sporocilu `start` (#17, vgradnja OpenLine v racunalniski program).
// OpenLine (openline/server/src/types.ts) poslje smer kot "incoming" / "outgoing", prejemnik Line je do zdaj sprejel samo "inbound" / "outbound",
// zato bi vsak pravi klic koncal z »neveljaven start« (koda pravilnik). Smer se samo preverja (nikjer se ne uporablja), zato sta obe obliki dovoljeni.
// Pravi TLS in pravi WebSocket (odjemalec kot telefon), samo 127.0.0.1, nakljucna vrata.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { GlasTelefonStreznik, primerjajZeton, type PrikljucekTelefona, type RazlogKonca, type VrataTelefona } from "./glas-telefon.server.ts";
import { KODA } from "./glas-telefon-ws.ts";
import { ZETON, caka, odpriWs } from "./glas-telefon-odjemalec.preizkus.ts";

const PREDPONA = "glas-tel-smer-";

type Dnevnik = { zacni: Array<{ callId: string; remoteNumber: string }>; zvok: Buffer[]; ustavi: RazlogKonca[]; vrata: VrataTelefona | null };
function lazniPriklop(): { priklop: PrikljucekTelefona; d: Dnevnik } {
  const d: Dnevnik = { zacni: [], zvok: [], ustavi: [], vrata: null };
  return { d, priklop: { zacni: (k, v) => { d.zacni.push(k); d.vrata = v; }, zvok: (p) => void d.zvok.push(p), ustavi: (r) => void d.ustavi.push(r) } };
}
type Zagon = { s: GlasTelefonStreznik; dir: string; vrata: number; odtis: string; cert: string; d: Dnevnik; zapri: () => Promise<void> };
async function zazeni(): Promise<Zagon> {
  const dir = await mkdtemp(path.join(tmpdir(), PREDPONA));
  const { priklop, d } = lazniPriklop();
  const s = new GlasTelefonStreznik({ root: dir, zeton: () => ZETON, vklopljeno: () => true, prikljucek: () => priklop, dnevnik: () => undefined, primerjaj: primerjajZeton });
  const { vrata, odtis } = await s.zazeni();
  const cert = readFileSync(path.join(dir, "glas-telefon-tls", "potrdilo.pem"), "utf8");
  return { s, dir, vrata, odtis, cert, d, zapri: async () => { await s.ustavi(); await rm(dir, { recursive: true, force: true }); } };
}

test("smer: OpenLine poslje incoming / outgoing, Lina ju sprejme (klic se zacne), kanonicni inbound / outbound tudi", async () => {
  const z = await zazeni();
  try {
    let n = 0;
    for (const smer of ["incoming", "outgoing", "inbound", "outbound"]) {
      const od = await odpriWs(z);
      od.besedilo({ type: "start", callId: `klic-smer-${n}`, direction: smer, remoteNumber: "+38640123456", deviceId: "naprava-1", format: { encoding: "pcm_s16le", sampleRate: 16000, channels: 1 } });
      n += 1;
      await caka(() => z.d.zacni.length >= n);
      assert.equal(z.d.zacni.length, n, `smer ${smer}`);
      assert.equal(z.d.zacni[n - 1].callId, `klic-smer-${n - 1}`);
      od.zapri();
    }
  } finally { await z.zapri(); }
});

test("smer: smer ni obvezna (start brez direction ostane veljaven)", async () => {
  const z = await zazeni();
  try {
    const od = await odpriWs(z);
    od.besedilo({ type: "start", callId: "klic-brez-smeri", remoteNumber: "+38640123456" });
    await caka(() => z.d.zacni.length >= 1);
    assert.equal(z.d.zacni.length, 1);
    od.zapri();
  } finally { await z.zapri(); }
});

test("smer: neveljavne vrednosti se se vedno zavrnejo (koda pravilnik), priklop nic ne dobi", async () => {
  const z = await zazeni();
  try {
    const slabe: unknown[] = ["sideways", "", "INCOMING", "Inbound", "incoming ", " outgoing", "in", "incoming\n", "__proto__", "incoming|outgoing", 1, true, null, {}, ["incoming"]];
    for (const slaba of slabe) {
      const od = await odpriWs(z);
      od.besedilo({ type: "start", callId: "klic-slaba-smer", direction: slaba, remoteNumber: "+38640123456" });
      await od.cakajZaprtje();
      assert.equal(od.koda(), KODA.pravilnik, `smer ${JSON.stringify(slaba)}`);
    }
    assert.equal(z.d.zacni.length, 0);
  } finally { await z.zapri(); }
});
