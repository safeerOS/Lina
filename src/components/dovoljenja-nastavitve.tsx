import { useEffect, useState } from "react";
import { imeVrste, tD } from "@/lib/lina/besedila-dovoljenja.ts";
import { lokalizacija } from "@/lib/lina/besedila.ts";
import { opisObsega } from "@/lib/lina/dovoljenja-podobne.ts";
import { prekliciDovoljenjeFn, seznamDovoljenjFn } from "@/lib/lina/functions.ts";
import type { JavnoDovoljenje } from "@/lib/lina/dovoljenja-podobne.server.ts";
import type { UporabaDovoljenja } from "@/lib/lina/dovoljenja-podobne.ts";

/** Nastavitve > Dovoljenja (02f): seznam dovoljenj »velja tudi za vse podobne«, stetje uporab, dnevnik in preklic. Dodajanja tu ni. */
export function DovoljenjaNastavitve({ onError }: { onError: (sporocilo: string) => void }) {
  const [seznam, setSeznam] = useState<JavnoDovoljenje[] | null>(null);
  const [dnevnik, setDnevnik] = useState<UporabaDovoljenja[]>([]);
  const [zastarela, setZastarela] = useState(0);
  const [zaposlen, setZaposlen] = useState(false);

  async function nalozi() {
    try {
      const s = await seznamDovoljenjFn();
      setSeznam(s.dovoljenja);
      setDnevnik(s.dnevnik);
      setZastarela(s.zastarela);
    } catch (e) {
      setSeznam([]);
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void nalozi();
  }, []);

  async function preklici(id: string) {
    setZaposlen(true);
    onError("");
    try {
      await prekliciDovoljenjeFn({ data: { id } });
      await nalozi();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setZaposlen(false);
    }
  }

  const cas = (iso: string) => new Date(iso).toLocaleString(lokalizacija());
  const ime = new Map((seznam ?? []).map((d) => [d.id, `${imeVrste(d.vrsta)}: ${opisObsega(d)}`]));

  return (
    <div className="space-y-3 text-sm">
      <p className="text-[var(--color-moss)]">{tD("razlaga")}</p>
      {zastarela > 0 ? <p role="status">{tD("zastarela")} {zastarela}</p> : null}
      {seznam === null ? (
        <p>{tD("nalaga")}</p>
      ) : seznam.length === 0 ? (
        <p>{tD("prazno")}</p>
      ) : (
        <ul className="space-y-2" aria-live="polite">
          {seznam.map((d) => (
            <li key={d.id} className="flex min-h-11 items-center justify-between gap-4 rounded-xl border border-[var(--color-rule)] p-3 focus-within:ring-2 focus-within:ring-[var(--color-moss)]">
              <div className="min-w-0">
                <p className="font-semibold">{imeVrste(d.vrsta)}</p>
                <p className="break-words"><code>{opisObsega(d)}</code></p>
                <p className="mt-1 text-xs text-[var(--color-moss)]">
                  {d.kdo === "naprava" ? tD("napravaOznaka") : tD("racunalnikOznaka")} · {cas(d.kdaj)} · {d.uporab} {tD("uporab")}
                  {d.zadnjaUporaba ? ` · ${tD("zadnjic")} ${cas(d.zadnjaUporaba)}` : ""}
                </p>
              </div>
              <button
                type="button"
                disabled={zaposlen}
                onClick={() => void preklici(d.id)}
                aria-label={`${tD("preklici")}: ${imeVrste(d.vrsta)} ${opisObsega(d)}`}
                className="min-h-11 shrink-0 rounded-xl border border-[var(--color-rule)] px-4 py-2 disabled:opacity-50"
              >
                {tD("preklici")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {dnevnik.length > 0 ? (
        <details className="border-t border-[var(--color-rule)] pt-3">
          <summary className="min-h-11 cursor-pointer">{tD("dnevnik")}</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {dnevnik.map((u, i) => (
              <li key={`${u.id}-${i}`}>{cas(u.kdaj)} · {ime.get(u.id) ?? imeVrste(u.vrsta)}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
