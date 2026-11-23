import { useEffect, useState } from "react";
import { t } from "@/lib/lina/besedila.ts";
import { nastaviMejoBraveFn, pozabiBraveFn, poveziBraveFn, stanjeBraveFn } from "@/lib/lina/functions.ts";

type Stanje = { povezan: boolean; porabljenoVMesecu: number; meja: number };

/** Kljuc Brave Search in mesecna meja iskanj (privzeto 900, uporabnik jo spremeni sam). Kljuc gre samo na streznik. */
export function BraveKljuc({ onError }: { onError: (m: string) => void }) {
  const [stanje, setStanje] = useState<Stanje | null>(null);
  const [kljuc, setKljuc] = useState("");
  const [meja, setMeja] = useState("");
  const [zaposlen, setZaposlen] = useState(false);
  const [lokalna, setLokalna] = useState("");

  function prevzemi(s: Stanje) {
    setStanje(s);
    setMeja(String(s.meja));
  }

  useEffect(() => {
    void stanjeBraveFn()
      .then(prevzemi)
      .catch(() => setStanje({ povezan: false, porabljenoVMesecu: 0, meja: 0 }));
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
  const polje = "mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2";
  return (
    <section aria-labelledby="br-naslov" className="grid gap-2">
      <h3 id="br-naslov" className="text-lg">{t("brNaslov")}</h3>
      <p className="text-sm text-[var(--color-moss)]">{t("brRazlaga")}</p>
      {stanje?.povezan ? (
        <>
          <p className="text-sm">{t("brPovezan")}</p>
          <p className="text-sm">{t("brPoraba")}: {stanje.porabljenoVMesecu} / {stanje.meja}</p>
          <form
            className="grid gap-2 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void izvedi(async () => prevzemi(await nastaviMejoBraveFn({ data: { meja: Number(meja) } })));
            }}
          >
            <label htmlFor="br-meja">
              {t("brMeja")}
              <input id="br-meja" type="number" inputMode="numeric" min={0} step={1} value={meja} onChange={(e) => setMeja(e.target.value)} className={polje} />
            </label>
            <button type="submit" disabled={zaposlen || meja === ""} className={gumb}>{t("brMejaShrani")}</button>
          </form>
          <button type="button" disabled={zaposlen} className={gumb} onClick={() => izvedi(async () => prevzemi(await pozabiBraveFn()))}>
            {t("brPozabi")}
          </button>
        </>
      ) : (
        <form
          className="grid gap-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void izvedi(async () => {
              prevzemi(await poveziBraveFn({ data: { kljuc } }));
              setKljuc("");
            });
          }}
        >
          <p className="whitespace-pre-line text-[var(--color-moss)]">{t("brKako")}</p>
          <label htmlFor="br-kljuc">
            {t("brKljuc")}
            <input id="br-kljuc" type="password" autoComplete="off" value={kljuc} onChange={(e) => setKljuc(e.target.value)} className={polje} />
          </label>
          <button type="submit" disabled={zaposlen || !kljuc} className={gumb}>{t("brPovezi")}</button>
        </form>
      )}
      {lokalna ? <p role="alert" className="text-sm text-[var(--color-signal)]">{lokalna}</p> : null}
    </section>
  );
}
