/**
 * Naloga 21 (25. 11. 2026): zagon ob prijavi. Vnos ~/.config/autostart/lina.desktop je privzeto vklopljen, zapise ga samo streznik,
 * ki ga je zagnala lupina (ELECTRON_RUN_AS_NODE), samo na Linuxu; izklop ga odstrani; tujega vnosa se ne dotakne.
 * Vse v zacasni mapi (HOME in XDG_CONFIG_HOME sta vbrizgana); pravi ~/.config se ne spreminja. Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import {
  DATOTEKA_NASTAVITVE, IME_VNOSA, OZNAKA_VNOSA, mapaSamodejnegaZagona, nastaviSamodejniZagon, stanjeSamodejnegaZagona,
  uskladiSamodejniZagon, vsebinaVnosa,
} from "./samodejni-zagon.server.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-samodejni-zagon-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const LUPINA = "/opt/Lina/lina-lupina";

async function nova() {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  const dom = path.join(dir, "dom");
  mkdirSync(dom);
  const token = await setupOwner("geslo-test-1234", dir);
  const o = { env: { HOME: dom, ELECTRON_RUN_AS_NODE: "1" } as NodeJS.ProcessEnv, izvedljiva: LUPINA, platforma: "linux" as const };
  return { dir, dom, token, o, vnos: path.join(dom, ".config", "autostart", IME_VNOSA) };
}

describe("zagon ob prijavi", () => {
  it("privzeto vklopljen: ob zagonu streznika lupine nastane vnos z --ozadje in naso oznako", async () => {
    const { dir, o, vnos } = await nova();
    const s = await uskladiSamodejniZagon(dir, o);
    assert.deepEqual(s, { vklop: true, naVoljo: true, vnos: true, tuj: false });
    const b = readFileSync(vnos, "utf8");
    assert.match(b, /^\[Desktop Entry\]\n/);
    assert.match(b, /\nExec="\/opt\/Lina\/lina-lupina" --ozadje\n/);
    assert.ok(b.includes(OZNAKA_VNOSA));
    assert.match(b, /\nX-GNOME-Autostart-enabled=true\n/);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, DATOTEKA_NASTAVITVE), "utf8")), { vklop: true, zapisan: true });
  });

  it("brez lupine (razvojni streznik) ali na Windows vnosa ni in stikalo pove, da ni na voljo", async () => {
    const { dir, dom, o, vnos } = await nova();
    assert.equal((await uskladiSamodejniZagon(dir, { ...o, env: { HOME: dom } })).naVoljo, false);
    assert.equal((await uskladiSamodejniZagon(dir, { ...o, platforma: "win32" })).naVoljo, false);
    assert.equal((await uskladiSamodejniZagon(dir, { ...o, izvedljiva: "lina-lupina" })).naVoljo, false, "relativna pot ni izvedljiva");
    assert.equal((await uskladiSamodejniZagon(dir, { ...o, izvedljiva: "/home/u/lina/lupina/node_modules/electron/dist/electron" })).naVoljo, false, "nezapakirana lupina");
    assert.equal(existsSync(vnos), false);
  });

  it("izklop v Nastavitvah odstrani vnos in ga naslednji zagon ne ustvari znova; vklop ga vrne", async () => {
    const { dir, token, o, vnos } = await nova();
    await uskladiSamodejniZagon(dir, o);
    const izklop = await nastaviSamodejniZagon(false, token, dir, o);
    assert.equal(izklop.vklop, false);
    assert.equal(existsSync(vnos), false);
    await uskladiSamodejniZagon(dir, o);
    assert.equal(existsSync(vnos), false, "izbira uporabnika velja tudi po ponovnem zagonu");
    assert.equal((await stanjeSamodejnegaZagona(token, dir, o)).vklop, false);
    const vklop = await nastaviSamodejniZagon(true, token, dir, o);
    assert.equal(vklop.vnos, true);
    assert.ok(readFileSync(vnos, "utf8").includes(OZNAKA_VNOSA));
  });

  it("izklop v orodju namizja (X-GNOME-Autostart-enabled=false ali Hidden=true) velja: Lina vnosa ne vklopi znova", async () => {
    for (const vrstica of ["X-GNOME-Autostart-enabled=false", "Hidden=true"]) {
      const { dir, token, o, vnos } = await nova();
      await uskladiSamodejniZagon(dir, o);
      const izklopljen = readFileSync(vnos, "utf8").replace("X-GNOME-Autostart-enabled=true", vrstica);
      writeFileSync(vnos, izklopljen);
      const s = await uskladiSamodejniZagon(dir, o);
      assert.equal(s.vklop, false, vrstica);
      assert.equal(readFileSync(vnos, "utf8"), izklopljen, `${vrstica}: vnos ostane, kot ga je pustilo orodje`);
      assert.equal((await stanjeSamodejnegaZagona(token, dir, o)).vklop, false);
      // izrecen vklop v Nastavitvah ga vrne
      await nastaviSamodejniZagon(true, token, dir, o);
      assert.match(readFileSync(vnos, "utf8"), /\nX-GNOME-Autostart-enabled=true\n/);
    }
  });

  it("vnos, ki ga je uporabnik odstranil, Lina ob naslednjem zagonu ne ustvari znova", async () => {
    const { dir, token, o, vnos } = await nova();
    await uskladiSamodejniZagon(dir, o);
    rmSync(vnos);
    const s = await uskladiSamodejniZagon(dir, o);
    assert.equal(s.vklop, false);
    assert.equal(existsSync(vnos), false);
    assert.equal((await uskladiSamodejniZagon(dir, o)).vnos, false);
    await nastaviSamodejniZagon(true, token, dir, o);
    assert.equal(existsSync(vnos), true);
  });

  it("tuj vnos z istim imenom ostane nedotaknjen (vklop in izklop)", async () => {
    const { dir, token, o, vnos } = await nova();
    mkdirSync(path.dirname(vnos), { recursive: true });
    const tuj = "[Desktop Entry]\nType=Application\nName=Nekaj drugega\nExec=/usr/bin/drugo\n";
    writeFileSync(vnos, tuj);
    assert.equal((await uskladiSamodejniZagon(dir, o)).tuj, true);
    assert.equal(readFileSync(vnos, "utf8"), tuj);
    await nastaviSamodejniZagon(false, token, dir, o);
    assert.equal(readFileSync(vnos, "utf8"), tuj);
    assert.equal((await stanjeSamodejnegaZagona(token, dir, o)).tuj, true);
  });

  it("nova pot lupine (posodobitev) popravi nas vnos", async () => {
    const { dir, o, vnos } = await nova();
    await uskladiSamodejniZagon(dir, o);
    await uskladiSamodejniZagon(dir, { ...o, izvedljiva: "/opt/Lina 2/lina-lupina" });
    assert.match(readFileSync(vnos, "utf8"), /\nExec="\/opt\/Lina 2\/lina-lupina" --ozadje\n/);
  });

  it("Exec: narekovaji, poševnice, $ in ` so ubezani (specifikacija Desktop Entry)", () => {
    assert.match(vsebinaVnosa('/x/a"b$c`d\\e'), /\nExec="\/x\/a\\"b\\\$c\\`d\\\\e" --ozadje\n/);
  });

  it("XDG_CONFIG_HOME (absolutna) ima prednost pred HOME/.config", () => {
    assert.equal(mapaSamodejnegaZagona({ HOME: "/home/u", XDG_CONFIG_HOME: "/cfg" }), path.join("/cfg", "autostart"));
    assert.equal(mapaSamodejnegaZagona({ HOME: "/home/u", XDG_CONFIG_HOME: "relativno" }), path.join("/home/u", ".config", "autostart"));
  });

  it("nastavitev samo za lastnika in samo logicna vrednost", async () => {
    const { dir, token, o } = await nova();
    await assert.rejects(nastaviSamodejniZagon(false, "napacen-zeton", dir, o));
    await assert.rejects(stanjeSamodejnegaZagona(null, dir, o));
    await assert.rejects(nastaviSamodejniZagon("ne", token, dir, o), /Neveljavna/);
  });

  it("zagon streznika (zagon.server.ts) uskladi vnos; stikalo je v Nastavitvah", () => {
    const koren = path.resolve(import.meta.dirname, "..", "..", "..");
    assert.match(readFileSync(path.join(koren, "src/lib/lina/zagon.server.ts"), "utf8"), /await uskladiSamodejniZagon\(dir\)\.catch/);
    assert.match(readFileSync(path.join(koren, "src/components/lina-desk.tsx"), "utf8"), /<SamodejniZagonStikalo razred=\{IZBIRA\} \/>/);
  });
});
