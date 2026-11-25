import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { stanjeSlovenskega } from "./dodatki-telefon.server.ts";
import { t } from "./besedila.ts";
import { imaSlovenskiModul } from "./platforma.server.ts";
import { zazeniNamestitevSlovenskega } from "./slovenski-modul.server.ts";

// Naloga 15: slovenski govorni modul (RSDO) namesti orodje za Linux Mint (cli-anything-linuxmint). Na Windows ga ni, zato se
// modul ne ponudi kot »namestitev ni uspela, poskusite znova«, ampak jasno: na tem sistemu ni na voljo. Platforma je lazna (win32).

test("slovenski modul: samo Linux", () => {
  assert.equal(imaSlovenskiModul("linux"), true);
  assert.equal(imaSlovenskiModul("win32"), false);
  assert.equal(imaSlovenskiModul("darwin"), false);
});

test("Windows: stanje je »ni na voljo na tem sistemu« (ne »poskusite znova«), Linux nespremenjen", () => {
  assert.deepEqual(stanjeSlovenskega("win32"), { stanje: "napaka", razlog: "ni-na-voljo-sistem" });
  assert.notEqual(stanjeSlovenskega("linux").razlog, "ni-na-voljo-sistem");
});

test("Windows: vklop stikala ne zazene namestilnika", async () => {
  const dom = await mkdtemp(path.join(tmpdir(), "lina-slo-win-"));
  const oznaka = path.join(dom, "zagnan");
  await mkdir(path.join(dom, ".local", "bin"), { recursive: true });
  const cli = path.join(dom, ".local", "bin", "cli-anything-linuxmint");
  await writeFile(cli, `#!/bin/sh\necho x > "${oznaka}"\n`);
  await chmod(cli, 0o755);
  let poklican = false;
  assert.equal(zazeniNamestitevSlovenskega(dom, () => (poklican = true), "win32"), false);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(existsSync(oznaka), false, "na Windows se nic ne zazene");
  assert.equal(poklican, false);
});

test("vmesnik: razlog ima besedilo v sl in en ter je v preslikavi Dodatkov", () => {
  const sl = t("uiSlovenskiNiNaVoljoSistem", "sl");
  const en = t("uiSlovenskiNiNaVoljoSistem", "en");
  assert.ok(sl.length > 0 && en.length > 0 && sl !== en);
  assert.doesNotMatch(sl, /znova|ponovno/i, "ne svetuje ponovnega poskusa");
  const desk = readFileSync(new URL("../../components/lina-desk.tsx", import.meta.url), "utf8");
  assert.match(desk, /"ni-na-voljo-sistem": "uiSlovenskiNiNaVoljoSistem"/);
});

test("Windows: stalni proces RSDO se ob vklopu (tudi ob zagonu Line) ne zazene in ne poskusa znova", async () => {
  const { uskladiRsdo, stanjeRsdo, izklopiRsdo } = await import("./rsdo-streznik.server.ts");
  await uskladiRsdo(true, false, "win32");
  assert.equal(stanjeRsdo().stanje, "izklopljen");
  assert.equal(stanjeRsdo().pid, null);
  izklopiRsdo();
});
