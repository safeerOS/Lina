import { useEffect, useState } from "react";
import { t } from "@/lib/lina/besedila.ts";
import { seznamStraniFn, dovoliStranFn, preklicStranFn } from "@/lib/lina/functions.ts";
import { razvrstiStrani, preveriVnos, povzetekStrani } from "@/lib/lina/strani-ui.ts";
import type { DovoljenaStran } from "@/lib/lina/strani-dovoljenja.ts";

export function StraniNastavitve({ onError }: { onError: (sporocilo: string) => void }) {
  const [seznam, setSeznam] = useState<DovoljenaStran[] | null>(null);
  const [izvor, setIzvor] = useState("");
  const [zaposlen, setZaposlen] = useState(false);
  const [lokalnaNapaka, setLokalnaNapaka] = useState("");

  async function nalozi() {
    try {
      const s = await seznamStraniFn();
      setSeznam(s);
    } catch (e) {
      setSeznam([]);
      onError(e instanceof Error ? e.message : "Napaka pri nalaganju");
    }
  }

  useEffect(() => {
    void nalozi();
  }, []);

  async function dodaj(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (zaposlen || !izvor) return;
    
    const preverjeno = preveriVnos(izvor);
    if (!preverjeno.ok) {
      setLokalnaNapaka(preverjeno.razlog);
      return;
    }
    
    setZaposlen(true);
    setLokalnaNapaka("");
    onError("");
    try {
      await dovoliStranFn({ data: { izvor: preverjeno.izvor } });
      setIzvor("");
      await nalozi();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setZaposlen(false);
    }
  }

  async function preklici(izvorZaPreklic: string) {
    setZaposlen(true);
    onError("");
    setLokalnaNapaka("");
    try {
      await preklicStranFn({ data: { izvor: izvorZaPreklic } });
      await nalozi();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setZaposlen(false);
    }
  }

  const polje = "mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2";

  return (
    <div className="space-y-3 text-sm">
        <p className="text-[var(--color-moss)]">{t("straniRazlaga")}</p>
        <form onSubmit={dodaj}>
          <label className="block" htmlFor="strani-izvor">
            {t("straniIzvorPolje")}
            <input
              id="strani-izvor"
              type="text"
              inputMode="url"
              autoComplete="off"
              className={polje}
              value={izvor}
              onChange={(e) => setIzvor(e.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={zaposlen || !izvor.trim()}
            className="mt-2 min-h-11 rounded-xl border border-[var(--color-rule)] px-4 py-2 disabled:opacity-50"
          >
            {t("straniDovoli")}
          </button>
        </form>
        {lokalnaNapaka ? (
          <p role="alert" className="mt-2 text-sm text-[var(--color-signal)]">
            {lokalnaNapaka}
          </p>
        ) : null}

        <div className="mt-4 space-y-2 border-t border-[var(--color-rule)] pt-4">
          {seznam === null ? (
            <p>{t("straniNalaga")}</p>
          ) : seznam.length === 0 ? (
            <p>{t("straniPrazno")}</p>
          ) : (
            <>
              <p>
                {t("straniPovzetek")
                  .replace("{skupaj}", povzetekStrani(seznam).skupaj.toString())
                  .replace("{obcutljivih}", povzetekStrani(seznam).obcutljivih.toString())}
              </p>
              <ul className="space-y-2">
                {razvrstiStrani(seznam).map((s) => (
                  <li key={s.izvor} className="flex min-h-11 items-center justify-between gap-4 rounded-xl border border-[var(--color-rule)] p-3 focus-within:ring-2 focus-within:ring-[var(--color-moss)]">
                    <div>
                      <code>{s.izvor}</code>
                      {s.obcutljiva ? (
                        <p className="mt-1 text-[var(--color-signal)]">
                          {t("straniObcutljiva")}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-[var(--color-moss)]">
                        {new Date(s.dodano).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={zaposlen}
                      aria-label={`${t("straniPreklici")} ${s.izvor}`}
                      className="min-h-11 rounded-xl border border-[var(--color-rule)] px-3 py-2 disabled:opacity-50"
                      onClick={() => preklici(s.izvor)}
                    >
                      {t("straniPreklici")}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
    </div>
  );
}
