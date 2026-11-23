/**
 * Zaganjalnik za zunanji proces OpenLine (otrok racunalniske Line).
 * Spremlja svoj stdin: ko mati zapre cev ali se konca, se zaganjalnik takoj ustavi,
 * da za Lino nikoli ne ostane siroteni proces. Ob napaki uvoza ne izpise sporocila
 * napake, ki bi lahko vsebovalo skrivnosti iz okolja.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const pot = process.argv[2];
if (typeof pot !== "string" || pot.length === 0 || pot.includes("\0") || !path.isAbsolute(pot)) {
  process.stderr.write("zaganjalnik: manjka pot\n");
  process.exit(2);
}

const koncaj = () => {
  process.exit(0);
};

process.stdin.once("end", koncaj);
process.stdin.once("close", koncaj);
process.stdin.once("error", koncaj);
process.stdin.resume();

try {
  await import(pathToFileURL(pot).href);
} catch {
  process.stderr.write("zaganjalnik: uvoz ni uspel\n");
  process.exit(3);
}
