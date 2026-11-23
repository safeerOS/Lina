import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NAJVEC_PLOSCIC, PRIVZETE_PLOSCICE, STRAN_PLOSCICE, VSE_PLOSCICE, VSA_OKNA,
  izbirnePloscice, jeOknoVidno, preklopiOkno, preklopiPloscico, privzetaIzbira, razberiIzbiro, serializirajIzbiro, vidnePloscice,
} from "./domov-izbira.ts";

test("privzeto: 6 ploscic po skici in vsa tri okna", () => {
  const i = privzetaIzbira();
  assert.deepEqual(i.ploscice, ["vprasanje", "koledar", "opravilo", "sporocila", "klici", "nastavitve"]);
  assert.deepEqual(i.okna, ["danes", "hitre", "majhni"]);
});

test("razberiIzbiro: prazno, pokvarjeno in tuje ne podre Domova", () => {
  for (const s of [null, undefined, "", "{", "[]", "5", "null", '{"ploscice":"x"}', '{"ploscice":[]}', '{"ploscice":["ni-take"]}']) {
    assert.deepEqual(razberiIzbiro(s as string | null).ploscice, [...PRIVZETE_PLOSCICE], String(s));
  }
  assert.deepEqual(razberiIzbiro("{").okna, [...VSA_OKNA]);
});

test("razberiIzbiro: neznani id-ji in dvojniki se zavrzejo, najvec 6, vrstni red izbire ostane", () => {
  const i = razberiIzbiro(JSON.stringify({ ploscice: ["imenik", "ni-take", "imenik", "zapiski", "dnevnik", "telefon", "linija", "znanje", "klici", "koledar"], okna: ["danes", "x", "danes"] }));
  assert.deepEqual(i.ploscice, ["imenik", "zapiski", "dnevnik", "telefon", "linija", "znanje"]);
  assert.equal(i.ploscice.length, NAJVEC_PLOSCIC);
  assert.deepEqual(i.okna, ["danes"]);
});

test("prazen seznam oken je veljavna izbira (skrita vsa), manjkajoc pomeni vsa", () => {
  assert.deepEqual(razberiIzbiro('{"ploscice":["klici"],"okna":[]}').okna, []);
  assert.deepEqual(razberiIzbiro('{"ploscice":["klici"]}').okna, [...VSA_OKNA]);
});

test("preklopiPloscico: dodaj, odstrani, meja 6, vsaj ena ostane", () => {
  let i = privzetaIzbira();
  assert.deepEqual(preklopiPloscico(i, "imenik"), i, "pri 6 ploscicah se 7. ne doda");
  i = preklopiPloscico(i, "koledar");
  assert.equal(i.ploscice.includes("koledar"), false);
  i = preklopiPloscico(i, "imenik");
  assert.equal(i.ploscice.at(-1), "imenik");
  let ena = { ploscice: ["klici"] as ReturnType<typeof privzetaIzbira>["ploscice"], okna: [] as ReturnType<typeof privzetaIzbira>["okna"] };
  ena = preklopiPloscico(ena, "klici");
  assert.deepEqual(ena.ploscice, ["klici"], "zadnje ploscice ni mogoce odstraniti");
});

test("preklopiPloscico: tuj id nic ne spremeni; preklopiOkno skrije in pokaze", () => {
  const i = privzetaIzbira();
  assert.deepEqual(preklopiPloscico(i, "x" as never), i);
  const brez = preklopiOkno(i, "hitre");
  assert.equal(jeOknoVidno(brez, "hitre"), false);
  assert.equal(jeOknoVidno(preklopiOkno(brez, "hitre"), "hitre"), true);
  assert.deepEqual(preklopiOkno(i, "x" as never), i);
});

test("vidnePloscice: stran, ki je v tem nacinu skrita (Znanje), se ne prikaze; prazno pade na privzete", () => {
  const osebno = ["domov", "pogovor", "koledar", "imenik", "klic", "narocila", "dnevnik", "zapiski", "telefon", "linija", "nastavitve"];
  const i = { ...privzetaIzbira(), ploscice: ["znanje", "imenik"] as ReturnType<typeof privzetaIzbira>["ploscice"] };
  assert.deepEqual(vidnePloscice(i, osebno), ["imenik"]);
  assert.deepEqual(vidnePloscice({ ...i, ploscice: ["znanje"] }, osebno), [...PRIVZETE_PLOSCICE]);
  assert.equal(izbirnePloscice(osebno).includes("znanje"), false);
  assert.equal(izbirnePloscice(undefined).length, VSE_PLOSCICE.length);
});

test("vsaka ploscica odpre stran, ki jo meni res ima", () => {
  const meni = ["domov", "pogovor", "koledar", "imenik", "klic", "narocila", "znanje", "dnevnik", "zapiski", "telefon", "linija", "nastavitve"];
  for (const id of VSE_PLOSCICE) assert.ok(meni.includes(STRAN_PLOSCICE[id]), id);
});

test("serializacija in ponovno branje sta enaki", () => {
  const i = preklopiOkno(preklopiPloscico(privzetaIzbira(), "klici"), "majhni");
  assert.deepEqual(razberiIzbiro(serializirajIzbiro(i)), i);
});
