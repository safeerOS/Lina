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

/** Kljuc tabele arhivov, npr. "linux-x64" ali "win32-x64" (tabele so podatki, ne vejitve po platformi). */
export function kljucPlatforme(platforma: Platforma = platformaZdaj(), arh: string = process.arch): string {
  return `${platforma}-${arh}`;
}
