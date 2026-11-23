import test from "node:test";
import assert from "node:assert/strict";
import { naloziIndeksTem, kljucTeme, jeVeljavenKljucTeme, najdiTemo, povezaneTeme } from "./samoucenje-teme.ts";

test("indeks Learn Anything ima 931 tem in so vsi kljuci veljavni", () => {
  const i = naloziIndeksTem();
  assert.equal(i.size, 931);
  for (const k of i.keys()) assert.match(k, /^[A-Za-z0-9][A-Za-z0-9-]*$/);
});

test("kljucTeme: normalizacija in odrez, brez nevarnih znakov", () => {
  assert.equal(kljucTeme("  Music Playlists "), "music-playlists");
  assert.equal(kljucTeme("../etc/passwd"), "etc-passwd");
  assert.equal(kljucTeme("a".repeat(200)).length, 80);
  assert.equal(kljucTeme("???"), "");
});

test("najdiTemo: po kljucu, po prikaznem imenu, neznano je null", () => {
  assert.equal(najdiTemo("zeromq")?.prettyName, "ZeroMQ");
  assert.equal(najdiTemo("ZeroMQ")?.name, "zeromq");
  assert.equal(najdiTemo("Music playlists")?.name, "music-playlists");
  assert.equal(najdiTemo("macos")?.name, "macOS");
  assert.equal(najdiTemo("moje geslo je 12345678"), null);
  assert.equal(najdiTemo(""), null);
});

test("povezaneTeme: ZeroMQ je povezan z omrezjem; manjkajoci kazalci se zavrzejo", () => {
  const t = najdiTemo("zeromq")!;
  assert.ok(povezaneTeme(t).some((x) => x.name === "networking"));
  const i = naloziIndeksTem(JSON.stringify([{ name: "a", prettyName: "A", connectedTopics: ["b", "c"] }, { name: "b", prettyName: "B", connectedTopics: [] }]));
  assert.deepEqual(povezaneTeme(i.get("a")!, i).map((x) => x.name), ["b"]);
});

test("indeks zavrne slabe vnose in neseznam", () => {
  const i = naloziIndeksTem(JSON.stringify([{ name: "../x", prettyName: "x" }, { name: "ok", prettyName: "Ok" }, null, 5]));
  assert.deepEqual([...i.keys()], ["ok"]);
  assert.throws(() => naloziIndeksTem("{}"));
  assert.equal(jeVeljavenKljucTeme("ok", i), true);
  assert.equal(jeVeljavenKljucTeme("zeromq", i), false);
});
