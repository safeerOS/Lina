import { t } from "@/lib/lina/besedila.ts";

/**
 * Oznaka nujnega klica (lastnik 10. 11. 2026): rdeca oznaka IN napis »Nujno«. Barva ni edini nosilec pomena (dostopnost,
 * crno-beli izpis, bralnik zaslona): napis je vedno viden, pri tiskanju je crn okvir z napisom na belem.
 */
export function NujnoOznaka() {
  return (
    <span
      data-nujno="1"
      className="inline-flex items-center gap-1 rounded-full border-2 border-[var(--color-signal)] bg-[var(--color-signal-fill)] px-2.5 py-0.5 text-xs font-bold tracking-wide text-white uppercase print:border-black print:bg-white print:text-black"
    >
      <span aria-hidden="true">!</span>
      {t("nujnoOznaka")}
    </span>
  );
}
