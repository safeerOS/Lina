/**
 * Naloga 11, N6: lupina doda zeton lupine samo zahtevam, ki jih sprozi glavni okvir lastnega okna z izvorom streznika Line
 * (ne iframe, delavec, druga okna ali stran v isti seji). Platforma je lazna (predmeti kot v Electronu). Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

const zahtevaj = createRequire(import.meta.url);
const { izGlavnegaOkvirja } = zahtevaj("../../../lupina/pomocniki.js") as {
  izGlavnegaOkvirja: (podrobnosti: unknown, okno: unknown, naslov: string) => boolean;
};

const NASLOV = "http://127.0.0.1:41234";
const glavni = { parent: null, url: `${NASLOV}/` };
const okno = (unicen = false) => ({ isDestroyed: () => unicen, webContents: { id: 7, mainFrame: glavni } });

describe("N6: zeton samo za glavni okvir lastnega okna", () => {
  it("glavni okvir okna Line z izvorom streznika: da", () => {
    assert.equal(izGlavnegaOkvirja({ webContentsId: 7, frame: glavni }, okno(), NASLOV), true);
  });

  it("vdelan okvir (iframe), tudi z izvorom streznika: ne", () => {
    assert.equal(izGlavnegaOkvirja({ webContentsId: 7, frame: { parent: glavni, url: `${NASLOV}/x` } }, okno(), NASLOV), false);
  });

  it("drugo okno ali webview (drug webContents), delavec brez okvirja, tuj izvor, uniceno okno: ne", () => {
    assert.equal(izGlavnegaOkvirja({ webContentsId: 8, frame: glavni }, okno(), NASLOV), false);
    assert.equal(izGlavnegaOkvirja({ webContentsId: 7, frame: null }, okno(), NASLOV), false);
    assert.equal(izGlavnegaOkvirja({ webContentsId: 7 }, okno(), NASLOV), false);
    assert.equal(izGlavnegaOkvirja({ webContentsId: 7, frame: { parent: null, url: "https://zlo.example/" } }, okno(), NASLOV), false);
    assert.equal(izGlavnegaOkvirja({ webContentsId: 7, frame: { parent: null, url: "http://127.0.0.1:41235/" } }, okno(), NASLOV), false);
    assert.equal(izGlavnegaOkvirja({ webContentsId: 7, frame: glavni }, okno(true), NASLOV), false);
    assert.equal(izGlavnegaOkvirja({ webContentsId: 7, frame: glavni }, null, NASLOV), false);
    assert.equal(izGlavnegaOkvirja({ webContentsId: 7, frame: glavni }, okno(), ""), false);
  });

  it("unicen okvir (getter Electrona vrze) ne vrze iz obdelovalca zahteve: ne", () => {
    const unicen = { get parent(): never { throw new Error("Render frame was disposed before WebFrameMain could be accessed"); }, get url(): never { throw new Error("disposed"); } };
    assert.equal(izGlavnegaOkvirja({ webContentsId: 7, frame: unicen }, okno(), NASLOV), false);
  });

  it("main.js: zeton gre v glave samo po izGlavnegaOkvirja (sicer se glava samo odstrani)", async () => {
    const m = await readFile(path.join(import.meta.dirname, "../../../lupina/main.js"), "utf8");
    assert.match(m, /glaveZaStreznik\(podrobnosti\.url, naslov, izGlavnegaOkvirja\(podrobnosti, okno, naslov\) \? zetonLupine : "", podrobnosti\.requestHeaders\)/);
  });
});
