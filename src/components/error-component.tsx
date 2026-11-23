import type { ErrorComponentProps } from "@tanstack/react-router";
import { t } from "@/lib/lina/besedila.ts";

/** Razlog napake za cloveka; brez sporocila pove, kaj naj uporabnik naredi (slog besedil, razdelek 3). */
function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return t("uiNapakaStran");
}

/**
 * Privzeta stran napake (UI-1): barve samo iz zetonov Line (svetla in temna tema), napis in razlog, gumb za ponovni poskus.
 * Brez ikon knjiznice in brez barv zunaj palete.
 */
export function AppErrorComponent({ error, reset }: ErrorComponentProps) {
  return (
    <main
      role="alert"
      className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--color-paper)] px-6 text-center text-[var(--color-ink)]"
    >
      <span
        aria-hidden="true"
        className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-signal-fill)] text-2xl font-bold text-white"
      >
        !
      </span>
      <h1 className="display text-2xl">{t("uiNapakaStranNaslov")}</h1>
      <p className="max-w-md text-sm break-words text-[var(--color-moss)]">{errorMessage(error)}</p>
      <button
        type="button"
        onClick={() => {
          reset();
          if (typeof window !== "undefined") window.location.reload();
        }}
        className="mt-2 inline-flex min-h-11 items-center rounded-full bg-[var(--color-ink-fill)] px-5 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)]"
      >
        {t("uiOsvezi")}
      </button>
    </main>
  );
}
