// Brez uvoza kode Line (src/lib/lina): vticnik streznika ne sme imeti svoje kopije stanja Line (naloga-g3b.test.ts).
// Konec streznika na prosnjo lupine (Linux in Windows enako, 25. 11. 2026). Lupina poslje {lina: "koncaj"} prek kanala IPC namesto
// signala: na Windows je SIGTERM trd konec (TerminateProcess), zato poslusalci SIGTERM (zapiranje HTTP, tunel, agenti, rok izhoda v
// server/plugins/lina-izhod.ts) ne bi stekli in OpenLine, tunel ter RSDO bi ostali brez starsa. Prosnja sprozi iste poslusalce.
// Ce se kanal zapre (lupina je umrla, npr. koncana v upravitelju opravil), streznik prav tako konca - nikoli ne ostane brez lupine.

type ProcesZIpc = {
  on(dogodek: "message", f: (sporocilo: unknown) => void): unknown;
  on(dogodek: "disconnect", f: () => void): unknown;
  emit(dogodek: "SIGTERM", signal: "SIGTERM"): boolean;
  channel?: unknown;
};

export function jeProsnjaZaKonec(sporocilo: unknown): boolean {
  return typeof sporocilo === "object" && sporocilo !== null && (sporocilo as { lina?: unknown }).lina === "koncaj";
}

/** Prijavi konec na prosnjo lupine. Brez kanala IPC (razvojni zagon, CI) ne naredi nicesar in vrne false. */
export function prijaviKonecLupine(p: ProcesZIpc = process as unknown as ProcesZIpc): boolean {
  if (!p.channel) return false;
  let zacet = false;
  const koncaj = () => {
    if (zacet) return;
    zacet = true;
    p.emit("SIGTERM", "SIGTERM");
  };
  p.on("message", (m) => {
    if (jeProsnjaZaKonec(m)) koncaj();
  });
  p.on("disconnect", koncaj);
  return true;
}
