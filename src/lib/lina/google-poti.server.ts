import { existsSync } from "node:fs";
import path from "node:path";
import { potAdc } from "./prijava-google.server.ts";
import { resolveDataDir } from "./store.server.ts";

/** Lina lastna mapa za prijavo (CLOUDSDK_CONFIG) in za orodje gcloud; ob »pozabi« gre samo prva. Brez uvoza adc.server (krozni uvoz). */
export function mapaPrijave(root: string): string {
  return path.join(root, "google-prijava");
}
export function mapaOrodja(root: string): string {
  return path.join(root, "gcloud");
}

/** Pot do ADC datoteke Line, ce obstaja (za adc.server), sicer null. */
export function adcDatotekaLine(dir?: string): string | null {
  const pot = potAdc(mapaPrijave(resolveDataDir(dir)));
  return existsSync(pot) ? pot : null;
}
