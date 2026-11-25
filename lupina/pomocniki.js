// Pomocniki lupine (Linux in Windows), loceni od Electrona, da jih preizkus pozene z lazno platformo (src/lib/lina/lupina-windows.test.ts).
// Lupina ne more uvoziti src/lib/lina/platforma.server.ts (TypeScript v svezenju streznika), zato je ta datoteka edina izjema
// zaklepa platforma-ena.test.ts; vejitve po platformi v lupini so samo tu.
const crypto = require("crypto");
const { execFile } = require("child_process");
const path = require("path");

/** Enak appId kot build.appId v package.json: Windows z njim poveze obvestila z bliznjico, ki jo naredi namestitev NSIS. */
const APP_ID = "si.safeer.lina.lupina";

/**
 * Mapa podatkov Line. Windows: %LOCALAPPDATA%\Lina\podatki (pravilo Line in vzorec Safeer za Windows: lokalni profil, ne
 * gostujoci %APPDATA%, ki se v domeni prenasa med racunalniki). Linux ostane, kot je bil (userData/podatki), da namescena Lina
 * ne izgubi podatkov.
 */
function mapaPodatkov(platforma, env, userData) {
  if (platforma === "win32") {
    const lokalno = (env.LOCALAPPDATA || "").trim();
    if (lokalno && path.win32.isAbsolute(lokalno)) return path.win32.join(lokalno, "Lina", "podatki");
    return path.win32.join(userData, "podatki");
  }
  return path.posix.join(userData, "podatki");
}

/**
 * Ustavitev streznika. Windows: prosnja prek kanala IPC (streznik pospravi kot ob SIGTERM: OpenLine, tunel, RSDO), ker je tam
 * kill("SIGTERM") trd konec (TerminateProcess) - pospravljanje ne bi steklo in otroci bi ostali brez starsa. Linux: SIGTERM kot
 * doslej (deluje tudi med zagonom, preden je vticnik streznika prijavljen; prosnja IPC bi se takrat izgubila - pregled naloge 15).
 * Vrne, kako je bil streznik zaprosen: "ipc" ali "signal".
 */
function prosiZaKonec(otrok, platforma) {
  if (platforma === "win32" && otrok.connected) {
    try {
      otrok.send({ lina: "koncaj" });
      return "ipc";
    } catch {
      /* kanal se je ravno zaprl: signal */
    }
  }
  try {
    otrok.kill("SIGTERM");
  } catch {
    /* ze koncan */
  }
  return "signal";
}

/** Glava z zetonom lupine (isto ime kot GLAVA_LUPINE v src/lib/lina/lupina.server.ts). */
const GLAVA_LUPINE = "x-lina-lupina";

/**
 * Glave zahteve iz okna Line (naloga 9, V6): zeton lupine dobi SAMO lokalni streznik Line (isti izvor kot naslov); vsakemu drugemu
 * izvoru se glava odstrani, tudi ce bi jo nastavila stran. Brez gesla streznik po tem zetonu loci okno Line od drugih lokalnih procesov
 * (ne od zlonamernega procesa istega uporabnika: meja je geslo lastnika, naloga 11 N2).
 */
function glaveZaStreznik(url, naslov, zeton, glave) {
  const izid = {};
  for (const [k, v] of Object.entries(glave || {})) if (k.toLowerCase() !== GLAVA_LUPINE) izid[k] = v;
  let izvor = "";
  try {
    izvor = new URL(url).origin;
  } catch {
    /* neveljaven naslov: brez zetona */
  }
  if (zeton && naslov && izvor === naslov) izid[GLAVA_LUPINE] = zeton;
  return izid;
}

/**
 * Naloga 11 N6: ali je zahtevo sprozil glavni okvir okna Line z izvorom streznika (ne iframe, delavec, drugo okno ali webview v isti
 * seji). Samo takrat lupina doda zeton; ciljni naslov sam ni dovolj (vdelana tuja vsebina ali XSS bi zeton dobila).
 */
function izGlavnegaOkvirja(podrobnosti, okno, naslov) {
  const wc = okno && !okno.isDestroyed() ? okno.webContents : null;
  const okvir = podrobnosti && podrobnosti.frame;
  if (!wc || !naslov || podrobnosti.webContentsId !== wc.id || !okvir || okvir.parent !== null) return false;
  try {
    return new URL(okvir.url).origin === naslov;
  } catch {
    return false;
  }
}

/**
 * Prisilni konec streznika (naloga 9, V10). Windows: kill() je TerminateProcess samo za streznik - OpenLine, tunel in RSDO bi ostali
 * brez starsa; zato taskkill /T /F po PID (celo drevo, vzorec tunel.server.ts). Linux: SIGKILL kot doslej.
 * Naloga 11 N7: samo, ce otrok se tece (tudi signalCode: otrok, ki ga je ubil signal, ima exitCode null, njegov PID pa je lahko ze
 * tuj); izid taskkill gre v dnevnik. Node drzi rocaj procesa do dogodka exit, zato Windows PID-a pred tem ne dodeli znova.
 */
function prisilniKonec(otrok, platforma, zazeni = execFile, dnevnik = (v) => console.error(v)) {
  if (!otrok || otrok.exitCode !== null || (otrok.signalCode !== undefined && otrok.signalCode !== null)) return;
  try {
    if (platforma === "win32" && otrok.pid) {
      const pid = otrok.pid;
      zazeni("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, (napaka) =>
        dnevnik(`lina-lupina: taskkill ${pid}: ${napaka ? `napaka ${napaka.code ?? napaka.message}` : "uspeh"}`));
    } else otrok.kill("SIGKILL");
  } catch {
    /* ze koncan */
  }
}

/** Najkrajsi zeton za --koncaj (lupina ustvari 24 bajtov = 48 znakov hex). */
const NAJKRAJSI_ZETON_KONCAJ = 32;

/**
 * »lina-lupina --koncaj« iz drugega primerka (naloga 9, V10): Lino zapre samo, ce drugi primerek poslje zeton, ki ga je ta lupina
 * dala strezniku (LINA_KONCAJ_ZETON), streznik pa samo skripti posodobitve. To ni meja proti procesu istega uporabnika (ta lahko
 * bere pomnilnik streznika ali Lino ustavi s SIGTERM); varuje pred procesi drugega uporabnika in pred nakljucnim zapiranjem.
 */
function koncajDovoljen(argv, dodatno, zeton) {
  if (!Array.isArray(argv) || !argv.includes("--koncaj")) return false;
  const dan = dodatno && typeof dodatno === "object" ? dodatno.koncaj : undefined;
  if (typeof zeton !== "string" || zeton.length < NAJKRAJSI_ZETON_KONCAJ || typeof dan !== "string" || dan.length !== zeton.length) return false;
  return crypto.timingSafeEqual(Buffer.from(dan), Buffer.from(zeton));
}

module.exports = { APP_ID, mapaPodatkov, prosiZaKonec, glaveZaStreznik, izGlavnegaOkvirja, prisilniKonec, koncajDovoljen };
