/**
 * Visina glasu stalnih stavkov osebnega nacina (lastnik 14. 11. 2026 po klicu K8: »Med klicem sem zaznal nižji ton glasu nekje.«).
 * Izmerjeno: vsi deli klica so imeli isti glas (Kore), slog (hitreje) in navodilo (kljuci posnetkov), mediana F0 pa je med stavki nihala od
 * 200 do 272 Hz (»Izvolite.« 236, »Da, sporočilo sem zapisala ...« 234, »Poslušam.« 272 proti mediani 214 Hz). Seme stavka izven pasu je izbrano
 * tako, da je mediana F0 v pasu (scripts/visina-stalnih.mts); preizkus pade, ce stalni stavek nima meritve ali seme ni tisto, ki je bilo izmerjeno.
 *
 * Obnova 22. 11. 2026: izvirni preizkus, skripta meritve in visina-stalnih.json so bili po izbrisu 20. 11. obnovljeni samo do konca tega
 * komentarja (enako v vseh kopijah). Ohranjeni zapis meritve so semena v tabela_semen.ts (komentar »Visina glasu ...«); preizkus zdaj
 * zaklene ta semena, da jih nihce ne spremeni brez nove meritve. Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { semeZaBesedilo } from "./glas.ts";
import { TABELA_SEMEN } from "./tabela_semen.ts";

// Seme z mediano F0 v pasu 213,6 +-12 Hz, izmerjeno 14. 11. 2026 (vir: tabela_semen.ts).
const IZMERJENA = {
  "Izvolite.": 3,
  "Dobro, hvala.": 1,
  "Da, sporočilo je zapisano in bo posredovano.": 3,
  "Da, sporočilo sem zapisala in ga bom posredovala.": 1,
  "Poslušam.": 1,
  "Imam zapisano.": 1,
  "Hvala, dobro.": 2,
} as const;

describe("visina glasu stalnih stavkov osebnega nacina", () => {
  it("vsak izmerjen stavek ima v tabeli natanko izmerjeno seme in sinteza ga uporabi", () => {
    for (const [stavek, seme] of Object.entries(IZMERJENA)) {
      assert.equal(TABELA_SEMEN[stavek], seme, stavek);
      assert.equal(semeZaBesedilo(stavek), seme, stavek);
    }
  });
});
