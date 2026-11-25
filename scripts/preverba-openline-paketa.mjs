// Naloga 16: preverba razpakiranega paketa (deb in NSIS) - zaganjalnik OpenLine je v paketu in OpenLine iz paketa javi pripravljenost.
// Zagon je enak kot v Lini (openline-zagon.server.ts): <lupina z ELECTRON_RUN_AS_NODE> <koren>/openline-start.mjs <koren>/dist/index.js,
// delovna mapa koren, okolje samo s kljuci Line (nic iz okolja tekaca), ustavitev z zaprtjem stdin. Razlika: 127.0.0.1 namesto
// zasebnega naslova (tekac nima domacega omrezja) in brez glasu Line (OpenLine se zazene tudi brez njega).
// Uporaba: ELECTRON_RUN_AS_NODE=1 <lupina> scripts/preverba-openline-paketa.mjs <resources/lina>
// Izhod 0 = OK; 1 = napaka (izpis pove, katera). V paket ne pise (DATA_DIR je zacasna mapa).
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

// Isto ime kot IME_ZAGANJALNIKA v src/lib/lina/openline-zagon.server.ts (zaklene naloga-16-zaganjalnik.test.ts).
const IME_ZAGANJALNIKA = "openline-start.mjs";
const ROK_PRIPRAVLJENOSTI_MS = 30_000;
const ROK_USTAVITVE_MS = 5_000;

const viri = process.argv[2];
if (!viri || !path.isAbsolute(viri)) {
  console.error("Uporaba: preverba-openline-paketa.mjs <absolutna pot do resources/lina>");
  process.exit(2);
}
const koren = path.join(viri, "openline");
const zaganjalnik = path.join(koren, IME_ZAGANJALNIKA);
const vstopna = path.join(koren, "dist", "index.js");
if (!existsSync(vstopna)) {
  console.error(`NAPAKA: v paketu ni ${vstopna}`);
  process.exit(1);
}
if (!existsSync(zaganjalnik)) {
  console.error(`NAPAKA: v paketu ni zaganjalnika ${zaganjalnik} (Lina bi javila »OpenLine se ni pripravil pravocasno«)`);
  process.exit(1);
}

const vrata = await new Promise((ok, ne) => {
  const s = net.createServer();
  s.once("error", ne);
  s.listen(0, "127.0.0.1", () => {
    const { port } = s.address();
    s.close(() => ok(port));
  });
});

const okolje = {
  ELECTRON_RUN_AS_NODE: "1",
  HTTP_GATEWAY_API_KEY: randomBytes(32).toString("base64url"),
  HOST: "127.0.0.1",
  PORT: String(vrata),
  DATA_DIR: mkdtempSync(path.join(tmpdir(), "lina-openline-preverba-")),
  PUBLIC_URL: `https://127.0.0.1:${vrata}`,
  LINA_ALLOWLIST_MODE: "off",
};

const otrok = spawn(process.execPath, [zaganjalnik, vstopna], {
  cwd: koren,
  env: okolje,
  stdio: ["pipe", "pipe", "pipe"],
  shell: false,
  windowsHide: true,
});
let izpis = "";
let napake = "";
otrok.stdout.on("data", (k) => { izpis += k; });
otrok.stderr.on("data", (k) => { napake += k; });

const pripravljen = () =>
  izpis.split(/\r?\n/).some((v) => v.trim() === `OpenLine slusa na https://127.0.0.1:${vrata}`)
  && /Odtis certifikata SHA-256: [0-9A-F:]{95}/.test(izpis);

const izid = await new Promise((ok) => {
  const rok = setTimeout(() => ok("rok"), ROK_PRIPRAVLJENOSTI_MS);
  otrok.stdout.on("data", () => { if (pripravljen()) { clearTimeout(rok); ok("pripravljen"); } });
  otrok.once("exit", (koda, signal) => { clearTimeout(rok); ok(`izhod ${koda ?? signal}`); });
  otrok.once("error", () => { clearTimeout(rok); ok("napaka zagona"); });
});

// ustavitev kot v Lini: zapri stdin, zaganjalnik se konca sam
const konec = new Promise((ok) => {
  if (otrok.exitCode !== null || otrok.signalCode !== null) return ok(true);
  const rok = setTimeout(() => ok(false), ROK_USTAVITVE_MS);
  otrok.once("exit", () => { clearTimeout(rok); ok(true); });
});
otrok.stdin.end();
const ustavljen = await konec;
if (!ustavljen) otrok.kill("SIGKILL");

if (izid !== "pripravljen") {
  console.error(`NAPAKA: OpenLine iz paketa ni javil pripravljenosti (${izid}).`);
  console.error(`stdout:\n${izpis.slice(0, 4000)}\nstderr:\n${napake.slice(0, 4000)}`);
  process.exit(1);
}
if (!ustavljen) {
  console.error("NAPAKA: OpenLine se po zaprtju stdin ni ustavil v 5 s.");
  process.exit(1);
}
console.log(`OK: zaganjalnik ${IME_ZAGANJALNIKA} je v paketu, OpenLine je javil pripravljenost na 127.0.0.1:${vrata} in se ustavil.`);
