/**
 * UI-1 (videz, 16. 11. 2026): skupni gradniki zaslonov. Ena paleta iz obstojecih zetonov (--color-*), brez novih barv in pisav,
 * brez prelivov in okrasnih ikon. Kartica je samo zunanji razdelek; v njem so deli loceni s crto, ne z novo kartico.
 * Vsak gumb ima najmanj 44 px (min-h-11) in viden fokus (styles.css, :focus-visible).
 */
import type { ReactNode } from "react";
import { t } from "@/lib/lina/besedila.ts";

export const FOKUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)]";
const OSNOVA_GUMBA =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50";
/** Glavno dejanje razdelka (eno na razdelek). */
export const GUMB = `${OSNOVA_GUMBA} bg-[var(--color-ink-fill)] text-white hover:opacity-90 ${FOKUS}`;
/** Dejanje, ki nekaj zacne ali odpre navzven (sprejem klica, odprtje linije). */
export const GUMB_SIGNAL = `${OSNOVA_GUMBA} bg-[var(--color-signal-fill)] text-white hover:opacity-90 ${FOKUS}`;
/** Drugotno dejanje. */
export const GUMB_OBROBA = `${OSNOVA_GUMBA} border border-[var(--color-rule)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:border-[var(--color-ink)] ${FOKUS}`;
/** Vnosno polje (input, select, textarea). */
export const POLJE =
  "mt-1.5 block w-full min-h-11 rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2.5 text-base text-[var(--color-ink)] sm:text-sm hover:border-[var(--color-brass)] focus:border-[var(--color-ink)]";
export const OZNAKA_POLJA = "block text-sm font-medium text-[var(--color-ink)]";
export const NAMIG = "mt-1.5 block text-xs leading-relaxed text-[var(--color-moss)]";
/** Zunanji razdelek (edina »kartica« na zaslonu). */
export const PLOSCA = "rounded-3xl border border-[var(--color-rule)] bg-[var(--color-sheet)]";

export function Razdelek({
  id,
  naslov,
  opis,
  children,
  className = "",
}: {
  id: string;
  naslov: string;
  opis?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-naslov`}
      className={`${PLOSCA} scroll-mt-6 p-5 sm:p-7 ${className}`}
    >
      <h2 id={`${id}-naslov`} className="display text-2xl leading-tight sm:text-3xl">
        {naslov}
      </h2>
      {opis ? (
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-[var(--color-moss)]">{opis}</p>
      ) : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** Del razdelka: locen s crto, brez lastnega ozadja (ne kartica v kartici). */
export function Podrazdelek({
  naslov,
  opis,
  children,
  id,
}: {
  naslov: string;
  opis?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <div
      className="mt-6 border-t border-[var(--color-rule)] pt-6 first:mt-0 first:border-t-0 first:pt-0"
      role="group"
      aria-labelledby={id}
    >
      <h3 id={id} className="text-base font-semibold text-[var(--color-ink)]">
        {naslov}
      </h3>
      {opis ? (
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-[var(--color-moss)]">{opis}</p>
      ) : null}
      <div className="mt-3">{children}</div>
    </div>
  );
}

export type Ton = "signal" | "moss" | "brass" | "ink";
const BARVA_TONA: Record<Ton, string> = {
  signal: "text-[var(--color-signal)]",
  moss: "text-[var(--color-moss)]",
  brass: "text-[var(--color-brass)]",
  ink: "text-[var(--color-ink)]",
};

/** Oznaka stanja: vedno z napisom; barva je samo dodatek. */
export function Znacka({ ton, children }: { ton: Ton; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-current px-2.5 py-0.5 text-xs font-semibold ${BARVA_TONA[ton]}`}
    >
      {children}
    </span>
  );
}

export function StanjeNalaganja({ besedilo = t("uiNalagam") }: { besedilo?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-stanje="nalaganje"
      className="flex min-h-11 items-center gap-3 py-4 text-sm text-[var(--color-moss)]"
    >
      <span
        aria-hidden="true"
        className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-rule)] border-t-[var(--color-ink)] motion-reduce:animate-none"
      />
      <span>{besedilo}</span>
    </div>
  );
}

export function StanjePrazno({
  naslov,
  opis,
  dejanje,
}: {
  naslov: string;
  opis: string;
  dejanje?: { oznaka: string; onClick: () => void };
}) {
  return (
    <div
      data-stanje="prazno"
      className="rounded-3xl border border-dashed border-[var(--color-rule)] px-6 py-10 text-center"
    >
      <p className="display text-xl">{naslov}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--color-moss)]">
        {opis}
      </p>
      {dejanje ? (
        <button type="button" onClick={dejanje.onClick} className={`${GUMB} mt-5`}>
          {dejanje.oznaka}
        </button>
      ) : null}
    </div>
  );
}

/** Napaka z razlogom: kaj se je zgodilo (naslov), zakaj (razlog) in kaj lahko uporabnik naredi (gumba). */
export function StanjeNapaka({
  naslov = t("uiNapakaNaslov"),
  razlog,
  onZapri,
  onPonovi,
}: {
  naslov?: string;
  razlog: string;
  onZapri?: () => void;
  onPonovi?: () => void;
}) {
  return (
    <div
      role="alert"
      data-stanje="napaka"
      className="flex flex-wrap items-start gap-x-4 gap-y-2 rounded-2xl border border-[var(--color-signal)] bg-[var(--color-surface)] px-4 py-3"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-signal-fill)] text-sm font-bold text-white"
      >
        !
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--color-signal)]">{naslov}</p>
        <p className="mt-0.5 text-sm break-words text-[var(--color-ink)]">
          {razlog.trim() || t("uiNapakaBrezRazloga")}
        </p>
      </div>
      {onPonovi || onZapri ? (
        <div className="flex shrink-0 gap-2">
          {onPonovi ? (
            <button type="button" onClick={onPonovi} className={GUMB_OBROBA}>
              {t("uiPoskusiZnova")}
            </button>
          ) : null}
          {onZapri ? (
            <button type="button" onClick={onZapri} className={GUMB_OBROBA}>
              {t("uiZapri")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Vrstica s potrditvenim poljem ali izbirnim gumbom: cela vrstica je tarca dotika (najmanj 44 px). */
export const IZBIRA = "izbira text-sm text-[var(--color-ink)]";
