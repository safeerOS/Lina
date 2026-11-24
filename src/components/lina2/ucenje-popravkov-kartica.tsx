import { useCallback, useEffect, useState } from "react";
import {
  izbrisiPraviloPopravkaFn,
  nastaviPopravkeFn,
  potrdiPopravekFn,
  stanjePopravkovFn,
  zavrziPopravekFn,
} from "@/lib/lina/functions.ts";
import type { StanjePopravkov } from "@/lib/lina/ucenje-popravkov.server.ts";
import { t2 } from "./besedila.ts";

/**
 * Kartica »Učenje iz popravkov« (Task Observer ideja, 24. 11. 2026):
 * prikazuje cakajoce kandidate pravil iz lastnikovih popravkov; trajna pravila se spremenijo SAMO po kliku »Shrani«.
 */
export function UcenjePopravkovKartica({ osveziZnak }: { osveziZnak?: number }) {
  const [stanje, setStanje] = useState<StanjePopravkov | null>(null);
  const [urejanja, setUrejanja] = useState<Record<string, string>>({});
  const [napaka, setNapaka] = useState("");
  const [zaposlen, setZaposlen] = useState(false);

  const osvezi = useCallback(() => {
    void stanjePopravkovFn()
      .then(setStanje)
      .catch(() => undefined);
  }, []);

  useEffect(osvezi, [osvezi, osveziZnak]);

  async function preklopi(vklop: boolean) {
    setNapaka("");
    setZaposlen(true);
    try {
      setStanje(await nastaviPopravkeFn({ data: { vklop } }));
    } catch {
      setNapaka(t2("popNapaka"));
    } finally {
      setZaposlen(false);
    }
  }

  async function shrani(id: string, privzeto: string) {
    setNapaka("");
    setZaposlen(true);
    try {
      const r = await potrdiPopravekFn({ data: { id, predlog: urejanja[id] ?? privzeto } });
      if (r.ok) setStanje(r.stanje);
      else setNapaka(t2("popNapaka"));
    } catch {
      setNapaka(t2("popNapaka"));
    } finally {
      setZaposlen(false);
    }
  }

  async function zavrzi(id: string) {
    setNapaka("");
    setZaposlen(true);
    try {
      setStanje(await zavrziPopravekFn({ data: { id } }));
    } catch {
      setNapaka(t2("popNapaka"));
    } finally {
      setZaposlen(false);
    }
  }

  async function pozabi(id: string) {
    setNapaka("");
    setZaposlen(true);
    try {
      setStanje(await izbrisiPraviloPopravkaFn({ data: { id } }));
    } catch {
      setNapaka(t2("popNapaka"));
    } finally {
      setZaposlen(false);
    }
  }

  if (!stanje) return null;
  const cakajoci = stanje.kandidati.filter((k) => k.stanje === "caka");

  return (
    <div className="flex flex-col gap-2 border-t border-[var(--color-rule)] pt-4">
      <h4 className="text-sm font-semibold">{t2("popNaslov")}</h4>
      <label className="flex cursor-pointer items-start gap-2 text-xs">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-[var(--aurora-1)]"
          checked={stanje.vklopljen}
          disabled={zaposlen}
          onChange={(e) => void preklopi(e.target.checked)}
        />
        <span>{t2("popStikalo")}</span>
      </label>
      <p className="text-xs text-[var(--color-moss)]">{t2("popOpis")}</p>
      {napaka ? <p role="alert" className="text-xs text-[var(--color-signal)]">{napaka}</p> : null}
      {cakajoci.length === 0 ? (
        <p className="text-xs text-[var(--color-brass)]">{t2("popPrazno")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {cakajoci.map((k) => (
            <li key={k.id} className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] p-2.5 text-xs">
              <p className="text-[var(--color-moss)]">{k.kajNarobe}</p>
              <p className="mt-1">
                <strong>{t2("popBesede")}:</strong> {k.besedeLastnika}
              </p>
              <label className="mt-1.5 grid gap-1">
                <span>{t2("popPredlog")}</span>
                <textarea
                  rows={2}
                  maxLength={300}
                  value={urejanja[k.id] ?? k.predlogPravila}
                  onChange={(e) => setUrejanja((p) => ({ ...p, [k.id]: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--color-rule)] bg-[var(--color-sheet)] p-1.5 text-xs"
                />
              </label>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={zaposlen}
                  className="rounded-full bg-[var(--color-ink)] px-3 py-1 text-xs text-[var(--color-on-ink)] disabled:opacity-50"
                  onClick={() => void shrani(k.id, k.predlogPravila)}
                >
                  {t2("popShrani")}
                </button>
                <button
                  type="button"
                  disabled={zaposlen}
                  className="rounded-full border border-[var(--color-rule)] px-3 py-1 text-xs disabled:opacity-50"
                  onClick={() => void zavrzi(k.id)}
                >
                  {t2("popZavrzi")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {stanje.pravila.length > 0 ? (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer font-medium">
            {t2("popShranjena")} ({stanje.pravila.length})
          </summary>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {stanje.pravila.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-2 rounded-lg border border-[var(--color-rule)] p-2">
                <span>{p.besedilo}</span>
                <button type="button" disabled={zaposlen} className="shrink-0 underline" onClick={() => void pozabi(p.id)}>
                  {t2("popPozabi")}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
