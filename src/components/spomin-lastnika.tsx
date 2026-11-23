import { useEffect, useState } from "react";
import { t } from "@/lib/lina/besedila.ts";
import {
  dodajDejstvoFn,
  izbrisiDejstvoFn,
  izbrisiVsaDejstvaFn,
  izvoziSpominFn,
  nastaviSpominFn,
  spominFn,
  urediDejstvoFn,
} from "@/lib/lina/functions.ts";
import type { SpominPogled } from "@/lib/lina/spomin.server.ts";

/**
 * Spomin lastnika, faza 1 (lastnik 15. 11. 2026): en gumb (stikalo, privzeto IZKLOPLJENO) z razlago v enem stavku, dejstva, ki jih
 * uporabnik napise sam, pregled, urejanje, brisanje posameznega in vseh, izvoz. Pri vsakem dejstvu stikalo »Lina sme to povedati
 * klicatelju« (privzeto NE). Samodejnega izluscanja iz klicev ni.
 */
export function SpominLastnika({ onError }: { onError: (m: string) => void }) {
  const [s, setS] = useState<SpominPogled | null>(null);
  const [novo, setNovo] = useState("");
  const [novoKlicatelju, setNovoKlicatelju] = useState(false);
  const [urejam, setUrejam] = useState<string | null>(null);
  const [urejanoBesedilo, setUrejanoBesedilo] = useState("");
  const [lokalna, setLokalna] = useState("");

  useEffect(() => {
    void spominFn()
      .then(setS)
      .catch((cause) => onError(cause instanceof Error ? cause.message : ""));
  }, []);

  async function izvedi(f: () => Promise<SpominPogled>, potem?: () => void) {
    setLokalna("");
    onError("");
    try {
      setS(await f());
      potem?.();
    } catch (cause) {
      const m = cause instanceof Error ? cause.message : "";
      setLokalna(m);
      onError(m);
    }
  }

  async function izvozi() {
    setLokalna("");
    try {
      const { besedilo } = await izvoziSpominFn();
      const url = URL.createObjectURL(new Blob([besedilo], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "lina-spomin.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setLokalna(cause instanceof Error ? cause.message : "");
    }
  }

  const polje = "mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-[var(--color-sheet)] text-[var(--color-ink)] px-3 py-2";
  const gumb = "w-fit rounded-xl border border-[var(--color-rule)] px-4 py-2 text-sm disabled:opacity-50";
  const dejstva = s?.dejstva ?? [];
  return (
    <section aria-labelledby="sp-naslov" className="grid gap-2">
      <h3 id="sp-naslov" className="text-lg">{t("spominNaslov")}</h3>
      <p className="text-sm text-[var(--color-moss)]">{t("spominRazlaga")}</p>
      <label className="flex items-start gap-2 text-sm" htmlFor="sp-stikalo">
        <input
          id="sp-stikalo"
          type="checkbox"
          className="mt-1 h-5 w-5"
          checked={s?.vklopljen ?? false}
          disabled={!s}
          onChange={(e) => void izvedi(() => nastaviSpominFn({ data: { vklopljen: e.target.checked } }))}
        />
        <span>{t("spominStikalo")}</span>
      </label>
      <form
        className="grid gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void izvedi(
            () => dodajDejstvoFn({ data: { besedilo: novo, klicatelju: novoKlicatelju } }),
            () => {
              setNovo("");
              setNovoKlicatelju(false);
            },
          );
        }}
      >
        <label htmlFor="sp-novo">
          {t("spominNovo")}
          <textarea id="sp-novo" rows={2} maxLength={s?.najvecZnakov ?? 300} value={novo} onChange={(e) => setNovo(e.target.value)} className={polje} />
        </label>
        <label className="flex items-start gap-2" htmlFor="sp-novo-klicatelju">
          <input id="sp-novo-klicatelju" type="checkbox" className="mt-1 h-5 w-5" checked={novoKlicatelju} onChange={(e) => setNovoKlicatelju(e.target.checked)} />
          <span>{t("spominKlicatelju")}</span>
        </label>
        <button type="submit" disabled={!novo.trim()} className={gumb}>
          {t("spominDodaj")}
        </button>
      </form>
      <p className="text-xs text-[var(--color-moss)]">
        {dejstva.length} / {s?.najvecDejstev ?? 100}
      </p>
      {dejstva.length === 0 ? <p className="text-sm">{t("spominPrazno")}</p> : null}
      <ul className="grid gap-2 text-sm">
        {dejstva.map((d) => (
          <li key={d.id} className="grid gap-1 rounded-xl border border-[var(--color-rule)] p-3">
            {urejam === d.id ? (
              <>
                <textarea
                  aria-label={t("spominUredi")}
                  rows={2}
                  maxLength={s?.najvecZnakov ?? 300}
                  value={urejanoBesedilo}
                  onChange={(e) => setUrejanoBesedilo(e.target.value)}
                  className={polje}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={gumb}
                    onClick={() => void izvedi(() => urediDejstvoFn({ data: { id: d.id, besedilo: urejanoBesedilo } }), () => setUrejam(null))}
                  >
                    {t("spominShrani")}
                  </button>
                  <button type="button" className={gumb} onClick={() => setUrejam(null)}>
                    {t("spominPreklici")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>{d.besedilo}</p>
                <label className="flex items-start gap-2" htmlFor={`sp-k-${d.id}`}>
                  <input
                    id={`sp-k-${d.id}`}
                    type="checkbox"
                    className="mt-1 h-5 w-5"
                    checked={d.klicatelju}
                    onChange={(e) => void izvedi(() => urediDejstvoFn({ data: { id: d.id, klicatelju: e.target.checked } }))}
                  />
                  <span>{t("spominKlicatelju")}</span>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={gumb}
                    onClick={() => {
                      setUrejam(d.id);
                      setUrejanoBesedilo(d.besedilo);
                    }}
                  >
                    {t("spominUredi")}
                  </button>
                  <button type="button" className={gumb} onClick={() => void izvedi(() => izbrisiDejstvoFn({ data: { id: d.id } }))}>
                    {t("spominIzbrisi")}
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={gumb} disabled={dejstva.length === 0} onClick={() => void izvozi()}>
          {t("spominIzvozi")}
        </button>
        <button
          type="button"
          className={gumb}
          disabled={dejstva.length === 0}
          onClick={() => {
            if (window.confirm(t("spominPotrdiVse"))) void izvedi(() => izbrisiVsaDejstvaFn());
          }}
        >
          {t("spominIzbrisiVse")}
        </button>
      </div>
      {lokalna ? (
        <p role="alert" className="text-sm text-[var(--color-signal)]">
          {lokalna}
        </p>
      ) : null}
    </section>
  );
}
