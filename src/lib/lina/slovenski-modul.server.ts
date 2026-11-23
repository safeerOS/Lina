import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Namestitev slovenskega govornega modula (RSDO + NeMo) prek cli-anything-linuxmint. Klic je dovoljen SAMO po izrecnem
 * uporabnikovem vklopu stikala v Dodatkih (pojasnilo: namen, ~3 GB, ~1,6 GB RAM, samo lokalno). Brez skrbniških pravic;
 * CLI sam ob že nameščenem modulu ne naredi ničesar. Neuspeh ne podre shranjevanja pravil.
 *
 * REKONSTRUKCIJA (20. 11. 2026): telo je prepisano iz prevoda nameščene Line (sluzba-sip.server, vrstice 6449-6471);
 * izvirni .ts je bil izbrisan.
 */
export function zazeniNamestitevSlovenskega(dom: string = homedir(), obKoncu?: (uspeh: boolean) => void): boolean {
  try {
    const cli = path.join(dom, ".local", "bin", "cli-anything-linuxmint");
    const otrok = spawn(cli, ["--json", "model", "slovenski-namesti", "--soglasam"], { detached: true, stdio: "ignore" });
    namestitev = "tece";
    // Izid namestitve (pregled 029, najdbi 12 in 13): napaka je vidna v Dodatkih, ob uspehu se model nalozi takoj (obKoncu).
    let koncano = false;
    const konec = (uspeh: boolean) => {
      if (koncano) return;
      koncano = true;
      namestitev = uspeh ? "uspela" : "napaka";
      obKoncu?.(uspeh);
    };
    otrok.on("error", () => konec(false));
    otrok.on("exit", (koda) => konec(koda === 0));
    otrok.unref();
    return true;
  } catch {
    namestitev = "napaka";
    return false;
  }
}

let namestitev: "tece" | "uspela" | "napaka" | null = null;
/** Izid zadnje namestitve v tem zagonu Line (null = ni bila zagnana). */
export function stanjeNamestitveSlovenskega(): "tece" | "uspela" | "napaka" | null {
  return namestitev;
}
