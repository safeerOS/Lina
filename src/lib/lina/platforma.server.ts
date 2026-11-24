import { realpathSync } from "node:fs";
// Eno jedro za Windows in Linux (lastnik, 21. 11. 2026): platformne razlike so na ENEM mestu, z vbrizgljivo platformo,
// da jih preizkus preveri za obe. Nova koda NE sme brati process.platform ali primerjati z "win32" drugje (glej platforma-ena.test.ts).
// Windows brez prave naprave je NEPREVERJENO: pomocniki so preizkusljivi z lazno platformo, vedenje na pravem Windows se ne trdi.

export type Platforma = NodeJS.Platform;

export function platformaZdaj(): Platforma {
  return process.platform;
}

export function jeWindows(platforma: Platforma = platformaZdaj()): boolean {
  return platforma === "win32";
}

/** Linux na amd64: edina platforma, za katero obstaja paket lina-lupina_<razlicica>_amd64.deb (posodobitev.server.ts). */
export function jeLinuxAmd64(platforma: Platforma = platformaZdaj(), arh: string = process.arch): boolean {
  return platforma === "linux" && arh === "x64";
}

/** POSIX dovoljenja (chmod, uid, mode) imajo pomen samo zunaj Windows; tam jih ne uporabljaj kot varnostno mejo. */
export function imaPosixDovoljenja(platforma: Platforma = platformaZdaj()): boolean {
  return !jeWindows(platforma);
}

/** Koncnica izvedljive datoteke: ".exe" na Windows, sicer prazno. */
export function koncnicaIzvedljive(platforma: Platforma = platformaZdaj()): string {
  return jeWindows(platforma) ? ".exe" : "";
}

/** Terminali za zagon Claude Code (claude-naloge.server.ts), po vrsti; predpona je zastavica pred ukazom in njegovimi argumenti. */
const TERMINALI: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["x-terminal-emulator", ["-e"]],
  ["gnome-terminal", ["--"]],
  ["konsole", ["-e"]],
  ["xfce4-terminal", ["-x"]],
  ["xterm", ["-e"]],
];

export type UkazTerminala = { program: string; predpona: readonly string[] } | { razlog: "ni-na-voljo" | "ni-terminala" };

/**
 * Terminal za zagon programa v novem oknu. Na Windows zagon iz Line NI NA VOLJO (ni preverjeno na pravi napravi; jasno sporocilo
 * namesto ugibanja). `najdi` vrne polno pot programa na PATH ali null (vbrizgljivo, da preizkus ne zazene nicesar).
 */
export function ukazTerminala(
  najdi: (ime: string) => string | null,
  platforma: Platforma = platformaZdaj(),
  razresi: (pot: string) => string = razresiPot,
): UkazTerminala {
  if (jeWindows(platforma)) return { razlog: "ni-na-voljo" };
  for (const [ime, predpona] of TERMINALI) {
    const program = najdi(ime);
    if (!program) continue;
    if (ime !== "x-terminal-emulator") return { program, predpona };
    // x-terminal-emulator je alternativa (N7, drugi pregled 0.2.10): pomen -e ni enoten (terminator, lxterminal, qterminal vzamejo en niz).
    // Uporabi se samo, ce kaze na terminal, ki -e razume kot argv; sicer naslednji terminal s seznama.
    const pravi = PRAVI_E.get(razresi(program).split(/[\\/]/).pop() ?? "");
    if (pravi) return { program, predpona: pravi };
  }
  return { razlog: "ni-terminala" };
}

/** Terminali, kamor sme kazati x-terminal-emulator, in njihova predpona za ukaz z argumenti. */
const PRAVI_E: ReadonlyMap<string, readonly string[]> = new Map([
  ["xterm", ["-e"]],
  ["uxterm", ["-e"]],
  ["konsole", ["-e"]],
  ["xfce4-terminal", ["-x"]],
  ["xfce4-terminal.wrapper", ["-x"]],
]);

function razresiPot(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** Kljuc tabele arhivov, npr. "linux-x64" ali "win32-x64" (tabele so podatki, ne vejitve po platformi). */
export function kljucPlatforme(platforma: Platforma = platformaZdaj(), arh: string = process.arch): string {
  return `${platforma}-${arh}`;
}
