// T6-04 (15. 11. 2026): id telefona v skupinah po 4 pri »Dodaj« (obe poti), isti niz kot na telefonu. Skupni vektorji
// vektorji-id-v1.json so ISTA datoteka kot v Androidu (skupni-vektorji); Android test (IdNaprave) bere isto datoteko.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { besedila, t } from "./besedila.ts";
import { idVSkupinah } from "./id-naprave.ts";

/** Kopija v Androidu (openline/android/skupni-vektorji) mora imeti ISTO vsoto; spremeni se skupaj z datoteko. */
const SHA256_VEKTORJEV_ID = "a8432e8d7ddb79a79bd601169ca1ea4b249d926830db7505c6f0c0faa486bcaa";
const surovo = readFileSync(new URL("./vektorji-id-v1.json", import.meta.url));
const V = JSON.parse(surovo.toString("utf8")) as { veljavni: Array<{ ime: string; vhod: string; izhod: string }>; neveljavni: Array<{ ime: string; vhod: string }> };

test("vektorji id: vsota datoteke je pripeta (Android ima isto kopijo)", () => {
  assert.equal(createHash("sha256").update(surovo).digest("hex"), SHA256_VEKTORJEV_ID, "datoteka se je spremenila: posodobi vsoto v obeh preizkusih in kopijo v Androidu");
  assert.ok(V.veljavni.length >= 5 && V.neveljavni.length >= 10);
});

test("idVSkupinah: veljavni vhodi dajo natanko izhod iz vektorja, neveljavni null", () => {
  for (const v of V.veljavni) assert.equal(idVSkupinah(v.vhod), v.izhod, v.ime);
  for (const v of V.neveljavni) assert.equal(idVSkupinah(v.vhod), null, v.ime);
});

test("idVSkupinah: nakljucni id-ji iz kljuca ostanejo isti znaki v skupinah po 4 (nic ne izgine, nic ne pride zraven)", () => {
  for (let i = 0; i < 200; i++) {
    const hex = randomBytes(8).toString("hex");
    const niz = idVSkupinah("n-" + hex);
    assert.ok(niz && /^[0-9a-f]{4}( [0-9a-f]{4}){3}$/.test(niz), niz ?? "null");
    assert.equal(niz!.replaceAll(" ", ""), hex);
  }
});

test("besedilo ob Dodaj je v vseh jezikih, ki jih Lina ima (sl, en), in ni prazno", () => {
  for (const j of Object.keys(besedila) as Array<"sl" | "en">) {
    assert.ok(t("telIdPreveri", j).length > 20, j);
  }
  assert.match(t("telIdPreveri", "sl"), /telefon/i);
  assert.match(t("telIdPreveri", "en"), /phone/i);
});

test("vmesnik: id v skupinah se pokaze pri Dodaj (QR) IN pri vnosu kode telefona; streznik poslje id kode-poti", () => {
  const tsx = readFileSync(new URL("../../components/povezi-telefon.tsx", import.meta.url), "utf8");
  assert.equal(tsx.split("<IdTelefona id={c.id} />").length - 1, 2, "obe poti (QR in koda) kazeta id");
  assert.match(tsx, /idVSkupinah\(id\)/);
  assert.match(tsx, /t\("telIdPreveri"\)/);
  // pot QR: blok z gumbom Dodaj mora vsebovati IdTelefona pred gumbom
  const qr = tsx.slice(tsx.indexOf("s.cakajo.map"), tsx.indexOf('t("telDodaj")'));
  assert.ok(qr.includes("<IdTelefona"), "Dodaj brez id");
  const koda = tsx.slice(tsx.indexOf("s.sKodo.cakajoKodo.map"), tsx.indexOf('t("telKodaPotrdi")'));
  assert.ok(koda.includes("<IdTelefona"), "vnos kode brez id");
  const streznik = readFileSync(new URL("./asistent-telefon.server.ts", import.meta.url), "utf8");
  assert.match(streznik, /cakajoKodo: k\.cakajoKodo\.map\(\(\{ pairId, id, ime, napacna \}\) => \(\{ pairId, id, ime, napacna \}\)\)/);
});
