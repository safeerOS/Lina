import { Znacka } from "@/components/ui-lina.tsx";
import { t } from "@/lib/lina/besedila.ts";
import type { CallSession } from "@/lib/lina/types.ts";

/** Oznaka klica, ki ga je sprejela Lina na telefonu (naloga 17). */
export function ZnackaTelefon({ call }: { call: Pick<CallSession, "izvor"> }) {
  return call.izvor === "telefon" ? <Znacka ton="moss">{t("klicIzvorTelefon")}</Znacka> : null;
}

/** Prepis klica na zaslonu klica; klic s telefona brez prepisa (stari zapisi) pove, da prepisa ni, namesto »pogovor se začne«. */
export function PrepisKlica({ call }: { call: CallSession | null | undefined }) {
  const vrstice = call?.transcript ?? [];
  return (
    // klic s telefona nima gumbov pod prepisom: prepis dobi njihov prostor
    <div className={`mt-4 flex ${call?.izvor === "telefon" ? "max-h-[26rem]" : "max-h-64"} min-h-24 flex-col gap-2 overflow-y-auto text-sm`} aria-live="polite" data-prepis-klica="1">
      {vrstice.length === 0 ? (
        <p className="m-auto max-w-[16rem] text-center text-xs text-[var(--color-moss)]">
          {call?.izvor === "telefon" ? t("klicPrepisNi") : t("uiPogovorPrazen")}
        </p>
      ) : null}
      {vrstice.map((item, index) => (
        <p
          className={`max-w-[90%] rounded-2xl px-3 py-2 ${item.role === "lina" ? "self-start bg-[var(--color-surface)]" : "self-end bg-[var(--color-ink-fill)] text-white"}`}
          key={`${item.at}-${index}`}
        >
          {item.text}
          {item.razumljeno ? (
            <span className="ml-2 text-xs opacity-70">
              ({t("zapisekRazumljeno")}
              {": "}
              {item.razumljeno})
            </span>
          ) : null}
          {typeof item.zaupanje === "number" ? (
            <span className="ml-2 text-xs opacity-70">
              {t("zaupanjeOznaka")} {item.zaupanje.toFixed(2)}
            </span>
          ) : null}
        </p>
      ))}
      {call?.prepisOkrnjen ? <p className="text-xs text-[var(--color-brass)]">{t("klicPrepisOkrnjen")}</p> : null}
    </div>
  );
}
