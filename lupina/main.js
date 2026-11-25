// Lupina programa Lina (Electron): zazene lokalni streznik, odpre okno, tece v ozadju (ikona v pladnju).
// Streznik poslusa samo 127.0.0.1; zeton lupine je nakljucen ob vsakem zagonu in ne zapusti procesa.
const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, session } = require("electron");
const { spawn } = require("child_process");
const crypto = require("crypto");
const http = require("http");
const net = require("net");
const path = require("path");
const fs = require("fs");
const { APP_ID, mapaPodatkov, prosiZaKonec, glaveZaStreznik, izGlavnegaOkvirja, prisilniKonec, koncajDovoljen } = require("./pomocniki");

const NAMESTITEV = app.isPackaged ? path.join(process.resourcesPath, "lina") : path.join(__dirname, "..");
const IKONA = path.join(__dirname, "ikona.png");
let strez = null;
let okno = null;
let pladenj = null;
let koncujem = false;
let naslov = "";
// Zeton lupine (nakljucen ob zagonu): streznik ga dobi v okolju, okno ga posilja samo strezniku (naloga 9, V6).
const zetonLupine = crypto.randomBytes(24).toString("hex");
// Zeton za »--koncaj« (naloga 9, V10): streznik ga da samo skripti posodobitve. Ni meja proti procesu istega uporabnika (meja je geslo).
const zetonKoncaja = crypto.randomBytes(24).toString("hex");

app.commandLine.appendSwitch("lang", "sl"); // datum in ura v slovenski obliki
if (process.platform === "win32") app.setAppUserModelId(APP_ID); // obvestila Windows (bliznjica NSIS ima isti appId)
// »lina-lupina --koncaj«: tekoco Lino zapre cisto (glavni proces ustavi streznik in sam konca).
// Ne s pkill: ta poslje SIGTERM tudi notranjim procesom Chromiuma (GPU, omrezje, zygote) in glavni proces se
// sesuje (FATAL »GPU process isn't usable«, jedro: trap int3; izmerjeno 23. 11. 2026).
const SAMO_KONCAJ = process.argv.includes("--koncaj");
if (!app.requestSingleInstanceLock({ koncaj: process.env.LINA_KONCAJ_ZETON || "" })) {
  app.quit();
} else if (SAMO_KONCAJ) {
  app.quit(); // Lina ne tece: ni kaj zapreti
} else {
  app.on("second-instance", (_dogodek, argv, _mapa, dodatno) => {
    if (!argv.includes("--koncaj")) pokazi();
    else if (koncajDovoljen(argv, dodatno, zetonKoncaja)) app.quit();
  });
}

function prostaVrata() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function pocakajStreznik(vrata, rok = 30000) {
  const zacetek = Date.now();
  return new Promise((resolve, reject) => {
    const ponovi = () => (Date.now() - zacetek > rok ? reject(new Error("streznik se ni zagnal")) : setTimeout(poskus, 150));
    const poskus = () => {
      const z = http.get({ host: "127.0.0.1", port: vrata, path: "/", timeout: 1000 }, (odg) => { odg.resume(); resolve(); });
      z.on("error", ponovi);
      z.on("timeout", () => { z.destroy(); });
    };
    poskus();
  });
}

async function zazeniStreznik() {
  const vrata = await prostaVrata();
  const podatki = mapaPodatkov(process.platform, process.env, app.getPath("userData"));
  fs.mkdirSync(podatki, { recursive: true, mode: 0o700 });
  strez = spawn(process.execPath, [path.join(NAMESTITEV, ".output/server/index.mjs")], {
    cwd: NAMESTITEV,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1",
      PORT: String(vrata), NITRO_PORT: String(vrata),
      LINA_DATA: podatki,
      // Pot klicev (OpenLine): paket je v resources/lina/openline (lastnik 22. 11. 2026: »OpenLine ni v programu (manjka paket)«).
      ...(fs.existsSync(path.join(NAMESTITEV, "openline", "dist", "index.js")) ? { LINA_OPENLINE_DIR: path.join(NAMESTITEV, "openline") } : {}),
      LINA_LUPINA_ZETON: zetonLupine,
      LINA_KONCAJ_ZETON: zetonKoncaja,
    },
    // kanal IPC: ustavitev s pospravljanjem tudi na Windows (tam je SIGTERM trd konec); streznik konca tudi, ce lupina umre
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  strez.on("exit", () => { strez = null; if (!koncujem) app.quit(); });
  await pocakajStreznik(vrata);
  naslov = `http://127.0.0.1:${vrata}`;
}

function pokazi() {
  if (!okno) ustvariOkno();
  if (okno.isMinimized()) okno.restore();
  okno.show();
  okno.focus();
}

// Mikrofon (samo zvok) in obvestila dovoli samo strani lokalnega streznika Line; vse drugo je zavrnjeno.
function dovoliDovoljenja() {
  const lokalno = (url) => typeof url === "string" && naslov !== "" && url.startsWith(naslov);
  session.defaultSession.setPermissionRequestHandler((wc, dovoljenje, odgovori, podrobnosti) => {
    const zvok = dovoljenje === "media" && Array.isArray(podrobnosti.mediaTypes) && podrobnosti.mediaTypes.every((m) => m === "audio");
    odgovori(lokalno(podrobnosti.requestingUrl) && (zvok || dovoljenje === "notifications"));
  });
  // Brez gesla streznik novo nalogo orkestratorja sprejme samo z zetonom lupine (proces drugega uporabnika ga nima; meja je geslo).
  session.defaultSession.webRequest.onBeforeSendHeaders((podrobnosti, odgovori) =>
    odgovori({ requestHeaders: glaveZaStreznik(podrobnosti.url, naslov, izGlavnegaOkvirja(podrobnosti, okno, naslov) ? zetonLupine : "", podrobnosti.requestHeaders) }));
  session.defaultSession.setPermissionCheckHandler((wc, dovoljenje, izvor) => lokalno(izvor) && (dovoljenje === "media" || dovoljenje === "notifications"));
}

function ustvariOkno() {
  okno = new BrowserWindow({
    width: 1100, height: 760, title: "Lina", icon: IKONA, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  okno.loadURL(naslov);
  okno.webContents.setWindowOpenHandler(({ url }) => { if (/^https:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  okno.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(naslov)) e.preventDefault(); });
  okno.on("close", (e) => { if (!koncujem) { e.preventDefault(); okno.hide(); } }); // Lina ostane v ozadju
  okno.on("closed", () => { okno = null; });
}

function ustvariPladenj() {
  pladenj = new Tray(nativeImage.createFromPath(IKONA).resize({ width: 22, height: 22 }));
  pladenj.setToolTip("Lina");
  pladenj.setContextMenu(Menu.buildFromTemplate([
    { label: "Odpri Lino", click: pokazi },
    { label: "Končaj (Lina ne bo več sprejemala klicev)", click: () => app.quit() },
  ]));
  pladenj.on("click", pokazi);
}

app.whenReady().then(async () => {
  if (SAMO_KONCAJ) return;
  try {
    await zazeniStreznik();
  } catch (e) {
    dialog.showErrorBox("Lina", "Lina se ni mogla zagnati: " + e.message);
    app.quit();
    return;
  }
  dovoliDovoljenja();
  ustvariPladenj();
  ustvariOkno();
});

// Ustavitev streznika (22. 11. 2026): star streznik 0.2.1 je ostal ziv brez starsa in drzal vrata 8446 za telefon.
// Windows: prosnja prek IPC (Linux in rezerva: SIGTERM), po 6 s SIGKILL; isto, ce lupina sama prejme SIGTERM/SIGINT/SIGHUP (pkill, odjava), ko before-quit ne pride.
function ustaviStreznik() {
  koncujem = true;
  const s = strez;
  if (!s || s.exitCode !== null) return;
  prosiZaKonec(s, process.platform);
  const prisilno = setTimeout(() => prisilniKonec(s, process.platform), 6000);
  prisilno.unref();
  s.once("exit", () => clearTimeout(prisilno));
}
app.on("before-quit", ustaviStreznik);
// Lupina ne konca, dokler streznik tece (najvec 6 s): sicer casovnik za SIGKILL ne bi stekel in streznik bi ostal brez starsa.
app.on("will-quit", (e) => {
  const s = strez;
  if (!s || s.exitCode !== null) return;
  e.preventDefault();
  const konec = () => { strez = null; app.quit(); };
  s.once("exit", konec);
  setTimeout(() => { prisilniKonec(s, process.platform); setTimeout(() => app.exit(0), 500); }, 6000);
});
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => { ustaviStreznik(); app.quit(); });
}
app.on("window-all-closed", () => { /* ostane v pladnju */ });
