import { normirajZnanje } from "./znanje-besedilo.ts";

/** Vrste dokumentov in javni podatki vira; tu (brez streznika), da jih uvozi tudi vmesnik. */
export type VrstaDokumenta = "docx" | "odt" | "xlsx" | "csv" | "txt" | "pdf";
/** objavljen: blok je v znanju za klice (lastnik je potrdil; drugi pregled 0.2.10, N9). Star vnos brez polja je objavljen. */
export type VirJavno = { id: string; ime: string; vrsta: VrstaDokumenta; bajtov: number; znakov: number; dodano: string; objavljen?: boolean };

/** Blok znanja za en vir (»Vir: <ime>« + besedilo). Isti niz vmesnik doda v znanje in ga ob izbrisu isce. Brez odvisnosti od streznika. */
export function blokVira(ime: string, besedilo: string): string {
  return normirajZnanje(`Vir: ${ime}\n${besedilo}`);
}

/**
 * Odstrani blok vira iz znanja. Ce ga je uporabnik spremenil, ga ne najde (najdeno=false) in znanja ne spremeni. Blok mora biti CEL
 * odstavek (CodeRabbit 0.2.10): pred njim zacetek ali prazna vrstica, za njim konec ali prazna vrstica - podaljsan blok ni najden.
 */
export function odstraniBlok(znanje: string, blok: string): { znanje: string; najdeno: boolean } {
  let i = blok ? znanje.indexOf(blok) : -1;
  while (i >= 0 && !((i === 0 || znanje.endsWith("\n\n", i)) && (i + blok.length === znanje.length || znanje.startsWith("\n\n", i + blok.length)))) {
    i = znanje.indexOf(blok, i + 1);
  }
  if (i < 0) return { znanje, najdeno: false };
  return { znanje: normirajZnanje(znanje.slice(0, i) + "\n\n" + znanje.slice(i + blok.length)), najdeno: true };
}
