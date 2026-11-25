/**
 * Seznam klicev za zaslon (naloga 17): klici racunalnika (calls.json) in klici, ki jih je sprejela Lina na telefonu (sinhron-telefon.json).
 * Locen modul, ker pot klica (service.server.ts) ne sme doseci modulov poti telefona (kanal-claude.test.ts 4.4); uvozi ga samo functions.ts.
 */
import { listCalls, type SessionContext } from "./service.server.ts";
import { kliciTelefona } from "./sinhron-telefon.server.ts";
import { razvrstiKlice } from "./tajnica.ts";
import type { CallSession } from "./types.ts";

export async function seznamKlicev(ctx: SessionContext, dir?: string): Promise<CallSession[]> {
  const klici = await listCalls(ctx, dir); // prijava lastnika najprej
  return razvrstiKlice([...klici, ...(await kliciTelefona(dir))]);
}
