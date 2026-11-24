/**
 * N9 (pregled 1750): varno odpiranje mikrofona za pogovor z asistentko. Mikrofon nikoli ne ostane prizgan brez prikaza:
 * - zaklep: drugi zagon (glas, bliznjica, klik) med odpiranjem ali snemanjem se zavrne (ena sama snemanja);
 * - po vsakem await preveri, ali je komponenta se priklopljena; ce ni, ustavi sledi;
 * - napaka pri pripravi (AudioContext, MediaRecorder) ustavi sledi.
 * Ob uspehu zaklep OSTANE zaseden; sprosti ga klicatelj, ko snemanje konca (rec.onstop).
 */
export type Zaklep = { zaseden: boolean };

export type IzidOdpiranja<T> = { ok: true; tok: MediaStream; vrednost: T } | { ok: false; razlog: "ze-tece" | "mikrofon" | "odklop" | "priprava" };

export async function odpriSnemanje<T>(o: {
  zaklep: Zaklep;
  odpri: () => Promise<MediaStream>;
  /** Nastavitev zmanjsanja hrupa (beri jo pred odpiranjem mikrofona, da tece hkrati). */
  nastavitev: Promise<boolean>;
  ziv: () => boolean;
  pripravi: (tok: MediaStream, zmanjsanje: boolean) => T;
}): Promise<IzidOdpiranja<T>> {
  if (o.zaklep.zaseden) return { ok: false, razlog: "ze-tece" };
  o.zaklep.zaseden = true;
  let tok: MediaStream | null = null;
  const ustaviSledi = () => tok?.getTracks().forEach((s) => s.stop());
  try {
    try {
      tok = await o.odpri();
    } catch {
      o.zaklep.zaseden = false;
      return { ok: false, razlog: "mikrofon" };
    }
    if (!o.ziv()) throw new Error("odklop");
    const zmanjsanje = await o.nastavitev.catch(() => true);
    if (!o.ziv()) throw new Error("odklop");
    return { ok: true, tok, vrednost: o.pripravi(tok, zmanjsanje) };
  } catch (e) {
    ustaviSledi();
    o.zaklep.zaseden = false;
    return { ok: false, razlog: e instanceof Error && e.message === "odklop" ? "odklop" : "priprava" };
  }
}
