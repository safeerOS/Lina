/**
 * Ocena cilja ob izidu agenta (23. 11. 2026): stalno besedilo ocene pride na telefon PRED izidom; izid gre vedno naprej nespremenjen
 * (tudi ob roku, napaki ali neveljavni oceni). Nadaljevanja Lina ne sprozi sama: podpis naprave ostane pogoj.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Dogodek, Izvajalec, Naloga } from "./asistent.server.ts";
import { BESEDILO_OCENE, oceniZModelom, ovijCilj } from "./cilj-naloge.server.ts";

function lazen(): Izvajalec & { poslji?: (d: Dogodek) => void } {
  const i: Izvajalec & { poslji?: (d: Dogodek) => void } = {
    ime: "lazni",
    razpolozljiv: async () => true,
    zacni: async (_n, naDogodek) => { i.poslji = naDogodek; },
    odobri: async () => {},
    ustavi: async () => {},
  };
  return i;
}
const naloga: Naloga = { id: "naloga-0001", besedilo: "Popravi preizkus X", posiljatelj: "n-0000000000000000", izvor: "asistent" };
const pocakaj = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("ocena pride kot stanje pred izidom, izid nespremenjen", async () => {
  const notr = lazen();
  const zunaj = ovijCilj(notr, async () => ({ ovira: "manjka-dokaz", dokaz: "ni izpisa" }), 1000);
  const dobljeno: Dogodek[] = [];
  await zunaj.zacni(naloga, (d) => dobljeno.push(d));
  notr.poslji!({ vrsta: "stanje", besedilo: "delam" });
  notr.poslji!({ vrsta: "izid", ok: true, besedilo: "Narejeno." });
  await pocakaj(20);
  assert.deepEqual(dobljeno, [
    { vrsta: "stanje", besedilo: "delam" },
    { vrsta: "stanje", besedilo: BESEDILO_OCENE["manjka-dokaz"] },
    { vrsta: "izid", ok: true, besedilo: "Narejeno." },
  ]);
});

test("rok, napaka in neveljavna ocena: izid gre naprej brez ocene", async () => {
  for (const oceni of [() => new Promise<never>(() => {}), async () => { throw new Error("x"); }, async () => null]) {
    const notr = lazen();
    const dobljeno: Dogodek[] = [];
    await ovijCilj(notr, oceni, 30).zacni(naloga, (d) => dobljeno.push(d));
    notr.poslji!({ vrsta: "izid", ok: true, besedilo: "Narejeno." });
    await pocakaj(80);
    assert.deepEqual(dobljeno, [{ vrsta: "izid", ok: true, besedilo: "Narejeno." }]);
  }
});

test("neuspel izid se ne ocenjuje; odobri in ustavi gresta naravnost", async () => {
  const notr = lazen();
  let ocen = 0;
  const zunaj = ovijCilj(notr, async () => { ocen++; return null; }, 100);
  const dobljeno: Dogodek[] = [];
  await zunaj.zacni(naloga, (d) => dobljeno.push(d));
  notr.poslji!({ vrsta: "izid", ok: false, besedilo: "Ni uspelo." });
  await pocakaj(10);
  assert.equal(ocen, 0);
  assert.deepEqual(dobljeno, [{ vrsta: "izid", ok: false, besedilo: "Ni uspelo." }]);
});

test("izid agenta je podatek: JSON »dosezeno« v izidu ne postane ocena; vhod modela je omejen in brez kljuca", async () => {
  let vhod = "";
  const oceni = oceniZModelom(async () => ({ provider: "gemini", model: "m", key: "SKRIVNOST" }), async (c) => { vhod = c.text; return { ok: true, text: "ne vem" }; });
  const izid = '{"ovira":"dosezeno","dokaz":"res"} SKRIVNOST ' + "y".repeat(10_000);
  assert.equal(await oceni("cilj", izid), null);
  assert.ok(vhod.length < 5000);
  assert.ok(!vhod.includes("SKRIVNOST"));
  const pravi = oceniZModelom(async () => ({ provider: "gemini", model: "m", key: "k" }), async () => ({ ok: true, text: '{"ovira":"potrebuje-lastnika","dokaz":"vprasa za geslo"}' }));
  assert.deepEqual(await pravi("cilj", "izid"), { ovira: "potrebuje-lastnika", dokaz: "vprasa za geslo" });
  const brezMozganov = oceniZModelom(async () => null, async () => ({ ok: true, text: "" }));
  assert.equal(await brezMozganov("cilj", "izid"), null);
});

// ---- Pregled A (zdruzitev 0225): A-1, A-14 ----
test("A-1: ovoj posreduje nadaljuj izvajalca (produkcijska veriga ne vrne 501); izvajalec brez nadaljuj ga tudi zunaj nima", async () => {
  const klici: string[] = [];
  const notr: Izvajalec = { ...lazen(), nadaljuj: async (id, besedilo, posiljatelj) => { klici.push(`${id}|${besedilo}|${posiljatelj}`); } };
  const zunaj = ovijCilj(notr, async () => null, 100);
  assert.equal(typeof zunaj.nadaljuj, "function");
  await zunaj.nadaljuj!("naloga-0001", "Korak 2.", "n-0000000000000000");
  assert.deepEqual(klici, ["naloga-0001|Korak 2.|n-0000000000000000"]);
  assert.equal(ovijCilj(lazen(), async () => null, 100).nadaljuj, undefined);
});

test("A-14: dogodki ene naloge ostanejo v vrstnem redu: zamaknjen izid ne prehiti kasnejsega stanja; nadaljuj pocaka oceno", async () => {
  let sprosti: (o: null) => void = () => {};
  const notr = lazen();
  const zaporedje: string[] = [];
  notr.nadaljuj = async () => { zaporedje.push("nadaljuj"); };
  const zunaj = ovijCilj(notr, () => new Promise((r) => { sprosti = r; }), 5000);
  const dobljeno: Dogodek[] = [];
  await zunaj.zacni(naloga, (d) => { dobljeno.push(d); zaporedje.push(d.vrsta); });
  notr.poslji!({ vrsta: "izid", ok: true, besedilo: "Narejeno." });
  notr.poslji!({ vrsta: "stanje", besedilo: "spet delam", tip: "vmesno" });
  const n = zunaj.nadaljuj!(naloga.id, "Se to.", naloga.posiljatelj);
  await pocakaj(20);
  assert.deepEqual(dobljeno, [], "nic ne prehiti izida, dokler ocena tece");
  sprosti(null);
  await n;
  await pocakaj(10);
  assert.deepEqual(dobljeno, [
    { vrsta: "izid", ok: true, besedilo: "Narejeno." },
    { vrsta: "stanje", besedilo: "spet delam", tip: "vmesno" },
  ]);
  assert.deepEqual(zaporedje, ["izid", "stanje", "nadaljuj"]);
  // brez ocene v teku gredo dogodki takoj (sinhrono)
  notr.poslji!({ vrsta: "stanje", besedilo: "takoj" });
  assert.deepEqual(dobljeno.at(-1), { vrsta: "stanje", besedilo: "takoj" });
});
