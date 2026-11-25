import { useEffect, useState } from "react";
import { izbrisiEnotoLHFn, izbrisiVseLHFn, nastaviUcenjeLHFn, stanjeUcenjaLHFn } from "@/lib/lina/functions.ts";
import type { StanjeUcenjaLH } from "@/lib/lina/ucenje-lh-vrata.server.ts";
import { t2 } from "./besedila.ts";

/**
 * Stikalo v Nastavitvah: ucenje postopkov (modul ucenje-lh, AGPL; lastnik 25. 11. 2026: privzeto vklopljeno). Seznam ucnih enot
 * s koraki (vidno), izbris posamezne ali vseh. Brez modula v gradnji se kartica ne prikaze. Lastna koda Safeer.
 */
export function UcenjeLHStikalo({ razred }: { razred: string }) {
  const [s, setS] = useState<StanjeUcenjaLH | null>(null);
  const [potrdi, setPotrdi] = useState(false);
  const [sporocilo, setSporocilo] = useState("");
  useEffect(() => {
    let zivo = true;
    stanjeUcenjaLHFn()
      .then((n) => {
        if (zivo) setS(n);
      })
      .catch(() => undefined);
    return () => {
      zivo = false;
    };
  }, []);
  async function izvedi(delo: () => Promise<StanjeUcenjaLH>, ok = "") {
    setSporocilo("");
    setPotrdi(false);
    try {
      setS(await delo());
      setSporocilo(ok);
    } catch {
      setSporocilo(t2("lhNapaka"));
    }
  }
  if (s === null || !s.naVoljo) return null;
  return (
    <div className="mt-4">
      <label className={razred}>
        <input type="checkbox" checked={s.vklopljen} onChange={(e) => void izvedi(() => nastaviUcenjeLHFn({ data: { vklop: e.target.checked } }))} />
        {t2("lhNaslov")}
      </label>
      <p className="mt-1 text-xs text-[var(--color-moss)]">{t2("lhOpis")}</p>
      {s.enote.length === 0 ? <p className="mt-1 text-xs">{t2("lhPrazno")}</p> : null}
      <ul className="mt-1 grid gap-1 text-xs">
        {s.enote.map((e) => (
          <li key={e.id} className="flex items-start gap-2">
            <details className="min-w-0 flex-1">
              <summary className="cursor-pointer">
                {e.naslov} ({e.znanih}/{e.korakov} {t2("lhPreverjenih")})
              </summary>
              <ol className="ml-5 mt-1 list-decimal">
                {e.koraki.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ol>
            </details>
            <button
              type="button"
              aria-label={`${t2("lhIzbrisi")}: ${e.naslov}`}
              className="shrink-0 rounded-full px-3 py-1 text-[var(--color-signal)] hover:bg-[var(--color-surface)]"
              onClick={() => void izvedi(() => izbrisiEnotoLHFn({ data: { id: e.id } }), t2("lhIzbrisano"))}
            >
              {t2("lhIzbrisi")}
            </button>
          </li>
        ))}
      </ul>
      {s.enote.length > 0 ? (
        potrdi ? (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {t2("lhPotrdi")}
            <button type="button" className="rounded-full px-3 py-1 text-[var(--color-signal)] hover:bg-[var(--color-surface)]" onClick={() => void izvedi(() => izbrisiVseLHFn(), t2("lhIzbrisano"))}>
              {t2("spominDa")}
            </button>
            <button type="button" className="rounded-full px-3 py-1 hover:bg-[var(--color-surface)]" onClick={() => setPotrdi(false)}>
              {t2("spominNe")}
            </button>
          </p>
        ) : (
          <button type="button" className="mt-2 rounded-full px-3 py-1 text-xs text-[var(--color-signal)] hover:bg-[var(--color-surface)]" onClick={() => setPotrdi(true)}>
            {t2("lhIzbrisiVse")}
          </button>
        )
      ) : null}
      {sporocilo ? (
        <p role="status" className="mt-1 text-xs text-[var(--color-brass)]">
          {sporocilo}
        </p>
      ) : null}
    </div>
  );
}
