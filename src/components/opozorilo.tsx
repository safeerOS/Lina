import { useEffect, useState } from "react";
import { GUMB, Razdelek, StanjeNapaka } from "@/components/ui-lina.tsx";
import { t } from "@/lib/lina/besedila.ts";
import { opozoriloFn, potrdiOpozoriloFn } from "@/lib/lina/functions.ts";

/** Besedilo opozorila (lastnik 24. 11. 2026; isto kot na safeer.si). */
export function OpozoriloBesedilo() {
  return (
    <ul className="grid list-disc gap-2 pl-5 text-sm leading-relaxed">
      <li>{t("opozT1")}</li>
      <li>{t("opozT2")}</li>
      <li>{t("opozT3")}</li>
      <li>{t("opozT4")}</li>
      <li>{t("opozT5")}</li>
    </ul>
  );
}

function GumbRazumem({ onDone }: { onDone: () => void }) {
  const [napaka, setNapaka] = useState("");
  const [zaposlen, setZaposlen] = useState(false);
  return (
    <>
      {napaka ? <StanjeNapaka razlog={napaka} /> : null}
      <button
        type="button"
        disabled={zaposlen}
        className={`${GUMB} w-fit`}
        onClick={async () => {
          setNapaka("");
          setZaposlen(true);
          try {
            await potrdiOpozoriloFn();
            onDone();
          } catch (cause) {
            setNapaka(cause instanceof Error ? cause.message : "");
          } finally {
            setZaposlen(false);
          }
        }}
      >
        {t("opozRazumem")}
      </button>
    </>
  );
}

/** Okno ob prvem zagonu (in ob novi razlicici besedila): brez »Razumem« Lina ne sprejema klicev in ne zaganja agentov. */
export function OpozoriloPrviZagon({ onDone }: { onDone: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-5 py-10">
      <h1 className="display text-4xl">{t("opozNaslov")}</h1>
      <OpozoriloBesedilo />
      <p role="note" className="text-sm text-[var(--color-moss)]">{t("opozBrez")}</p>
      <GumbRazumem onDone={onDone} />
    </main>
  );
}

/** Nastavitve > O Lini: opozorilo je vedno dosegljivo; ce ni potrjeno (nova razlicica), ga je mogoce potrditi tu. */
export function OLiniPanel({ id }: { id: string }) {
  const [potrjeno, setPotrjeno] = useState<boolean | null>(null);
  useEffect(() => {
    void opozoriloFn()
      .then((s) => setPotrjeno(s.potrjeno))
      .catch(() => setPotrjeno(false));
  }, []);
  return (
    <Razdelek id={id} naslov={t("nastPodOLini")}>
      <div className="grid max-w-prose gap-3">
        <h3 className="text-lg">{t("opozNaslov")}</h3>
        <OpozoriloBesedilo />
        {potrjeno ? (
          <p role="status" className="text-sm text-[var(--color-moss)]">{t("opozPotrjeno")}</p>
        ) : potrjeno === false ? (
          <>
            <p role="note" className="text-sm text-[var(--color-signal)]">{t("opozBrez")}</p>
            <GumbRazumem onDone={() => setPotrjeno(true)} />
          </>
        ) : null}
      </div>
    </Razdelek>
  );
}
