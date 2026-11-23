import { useEffect, useState } from "react";
import { t } from "@/lib/lina/besedila.ts";
import { KorakiSlika } from "@/components/koraki-slika.tsx";
import { pozabiTinyFishFn, poveziTinyFishFn, stanjeTinyFishFn } from "@/lib/lina/functions.ts";

/** Neobvezen kljuc TinyFish za strani, ki brez JavaScripta ne pokazejo vsebine. Kljuc gre samo na streznik; polje se izprazni. */
export function TinyFishKljuc({ onError }: { onError: (m: string) => void }) {
  const [povezan, setPovezan] = useState<boolean | null>(null);
  const [kljuc, setKljuc] = useState("");
  const [zaposlen, setZaposlen] = useState(false);
  const [lokalna, setLokalna] = useState("");

  useEffect(() => {
    void stanjeTinyFishFn()
      .then((s) => setPovezan(s.povezan))
      .catch(() => setPovezan(false));
  }, []);

  async function izvedi(delo: () => Promise<void>) {
    setZaposlen(true);
    onError("");
    setLokalna("");
    try {
      await delo();
    } catch (cause) {
      const m = cause instanceof Error ? cause.message : "";
      setLokalna(m);
      onError(m);
    } finally {
      setZaposlen(false);
    }
  }

  const gumb = "w-fit rounded-xl border border-[var(--color-rule)] px-4 py-2 text-sm disabled:opacity-50";
  return (
    <section aria-labelledby="tf-naslov" className="grid gap-2">
      <h3 id="tf-naslov" className="text-lg">{t("tfNaslov")}</h3>
      {povezan ? (
        <>
          <p className="text-sm">{t("tfPovezan")}</p>
          <button type="button" disabled={zaposlen} className={gumb} onClick={() => izvedi(async () => setPovezan((await pozabiTinyFishFn()).povezan))}>
            {t("tfPozabi")}
          </button>
        </>
      ) : (
        <form
          className="grid gap-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void izvedi(async () => {
              setPovezan((await poveziTinyFishFn({ data: { kljuc } })).povezan);
              setKljuc("");
            });
          }}
        >
          <p className="text-[var(--color-moss)]">{t("tfRazlaga")}</p>
          <p className="whitespace-pre-line text-[var(--color-moss)]">{t("tfKako")}</p>
          <KorakiSlika naslov={t("shTf")} vrstice={[{ besedilo: t("shTf1") }, { besedilo: t("shTf2") }, { besedilo: t("shTf3") }]} />
          <label htmlFor="tf-kljuc">
            {t("tfKljuc")}
            <input id="tf-kljuc" type="password" autoComplete="off" value={kljuc} onChange={(e) => setKljuc(e.target.value)} className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2" />
          </label>
          <button type="submit" disabled={zaposlen || !kljuc} className={gumb}>{t("tfPovezi")}</button>
        </form>
      )}
      {lokalna ? <p role="alert" className="text-sm text-[var(--color-signal)]">{lokalna}</p> : null}
    </section>
  );
}
