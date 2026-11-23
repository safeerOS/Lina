/** SIP-1: nastavitve SIP (geslo samo iz nastavitev uporabnika, sifrirano, nikoli nazaj v brskalnik). */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setupOwner } from "../auth.server.ts";
import { pozabiSip, preberiSip, preveriSipVnos, shraniSip, SIP_DATOTEKA, sipKonfiguracija } from "./nastavitve.server.ts";

const mape: string[] = [];
afterEach(async () => {
  for (const m of mape.splice(0)) await rm(m, { recursive: true, force: true });
});

async function lastnik(): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-sip-"));
  mape.push(dir);
  const token = await setupOwner("geslo-test-1234", dir, { address: "127.0.0.1" });
  return { dir, token };
}

const GESLO = "izmisljeno-geslo-preizkusa";

describe("nastavitve SIP", () => {
  it("geslo je na disku sifrirano, v javnem pogledu ga ni, streznik ga dobi odsifriranega", async () => {
    const { dir, token } = await lastnik();
    const javno = await shraniSip(token, { registrar: "sip.example.invalid", uporabnik: "100", geslo: GESLO }, dir);
    expect(javno).toEqual({ nastavljen: true, registrar: "sip.example.invalid", vrata: 5060, domena: "sip.example.invalid", uporabnik: "100", avtUporabnik: "100", expires: 300, imaGeslo: true });
    expect(JSON.stringify(javno)).not.toContain(GESLO);
    const disk = await readFile(path.join(dir, SIP_DATOTEKA), "utf8");
    expect(disk).not.toContain(GESLO);
    expect(JSON.stringify(await preberiSip(token, dir))).not.toContain(GESLO);
    expect(await sipKonfiguracija(dir)).toMatchObject({ registrar: "sip.example.invalid", uporabnik: "100", geslo: GESLO, vrata: 5060 });
  });

  it("prazno geslo ob spremembi obdrzi shranjeno; pozabi izbrise", async () => {
    const { dir, token } = await lastnik();
    await shraniSip(token, { registrar: "127.0.0.1", uporabnik: "100", geslo: GESLO }, dir);
    await shraniSip(token, { registrar: "127.0.0.1", vrata: 5080, uporabnik: "100" }, dir);
    expect(await sipKonfiguracija(dir)).toMatchObject({ vrata: 5080, geslo: GESLO });
    expect((await pozabiSip(token, dir)).nastavljen).toBe(false);
    expect(await sipKonfiguracija(dir)).toBeNull();
  });

  it("brez prijave lastnika ni branja ne zapisa", async () => {
    const { dir } = await lastnik();
    await expect(shraniSip(null, { registrar: "127.0.0.1", uporabnik: "100", geslo: GESLO }, dir)).rejects.toThrow();
    await expect(preberiSip("napacen", dir)).rejects.toThrow();
  });

  it.each([
    [{ registrar: "sip:127.0.0.1", uporabnik: "100", geslo: "x" }],
    [{ registrar: "127.0.0.1:5060", uporabnik: "100", geslo: "x" }],
    [{ registrar: "127.0.0.1", vrata: 70000, uporabnik: "100", geslo: "x" }],
    [{ registrar: "127.0.0.1", uporabnik: "a b", geslo: "x" }],
    [{ registrar: "127.0.0.1", uporabnik: "100", geslo: "x\r\ny" }],
    [{ registrar: "127.0.0.1", uporabnik: "100", geslo: "x", expires: 10 }],
  ])("zavrne napacen vnos %#", (vnos) => {
    expect(preveriSipVnos(vnos).ok).toBe(false);
  });
});
