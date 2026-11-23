import { useEffect, useState } from "react";
import { t } from "@/lib/lina/besedila.ts";
import { nujniNastavitveFn, shraniNujneFn, napakeNastavitveFn, shraniNapakeFn, zetonNapakeFn } from "@/lib/lina/functions.ts";
import type { NapakeStanje } from "@/lib/lina/napake.server.ts";
import type { NujniNastavitve } from "@/lib/lina/nujni.server.ts";

/**
 * Nujni klici na osebni telefon (lastnik 10. 11. 2026): DVE LOCENI STIKALI (obvestilo, prevezava), obe privzeto izklopljeni.
 * Stevilka osebnega telefona gre samo na streznik (sifrirana) in se po shranjevanju ne vrne ali prikaze nazaj: polje se izprazni,
 * odjemalec ve samo, da je stevilka vpisana. Ob vklopljeni prevezavi je opozorilo o posredniku in obracunu stalno vidno.
 */
export function NujniKlici({ onError }: { onError: (m: string) => void }) {
  const [ns, setNs] = useState<NapakeStanje | null>(null);
  const [napakeObvesti, setNapakeObvesti] = useState(false);
  const [napakeStevilka, setNapakeStevilka] = useState("");
  const [napakePozabi, setNapakePozabi] = useState(false);
  const [napakeZaposlen, setNapakeZaposlen] = useState(false);
  const [napakeLokalna, setNapakeLokalna] = useState("");
  const [napakeShranjeno, setNapakeShranjeno] = useState(false);
  const [napakeZeton, setNapakeZeton] = useState("");
  const [zetonKopiran, setZetonKopiran] = useState(false);

  function prevzemiNapake(n: NapakeStanje) {
    setNs(n);
    setNapakeObvesti(n.obvesti);
    setNapakeStevilka("");
    setNapakePozabi(false);
  }

  useEffect(() => {
    void napakeNastavitveFn()
      .then(prevzemiNapake)
      .catch((cause) => onError(cause instanceof Error ? cause.message : ""));
  }, []);

  async function shraniNapakeSubmit() {
    setNapakeZaposlen(true);
    setNapakeShranjeno(false);
    setNapakeLokalna("");
    onError("");
    try {
      prevzemiNapake(
        await shraniNapakeFn({
          data: {
            obvesti: napakePozabi ? false : napakeObvesti,
            ...(napakeStevilka.trim() ? { stevilka: napakeStevilka.trim() } : {}),
            ...(napakePozabi ? { pozabiStevilko: true } : {}),
          },
        })
      );
      setNapakeShranjeno(true);
    } catch (cause) {
      const m = cause instanceof Error ? cause.message : "";
      setNapakeLokalna(m);
      onError(m);
    } finally {
      setNapakeZaposlen(false);
    }
  }

  async function pridobiZeton() {
    setNapakeLokalna("");
    try {
      const z = await zetonNapakeFn();
      setNapakeZeton(z);
    } catch (cause) {
      setNapakeLokalna(cause instanceof Error ? cause.message : "");
    }
  }

  async function kopirajZeton() {
    try {
      await navigator.clipboard.writeText(napakeZeton);
      setZetonKopiran(true);
      setTimeout(() => setZetonKopiran(false), 2000);
    } catch (e) {
      // ignore
    }
  }

  const [s, setS] = useState<NujniNastavitve | null>(null);
  const [obvesti, setObvesti] = useState(false);
  const [prevezi, setPrevezi] = useState(false);
  const [stevilka, setStevilka] = useState("");
  const [cakanje, setCakanje] = useState("20");
  const [omejitevUra, setOmejitevUra] = useState("3");
  const [omejitevDan, setOmejitevDan] = useState("10");
  const [pozabi, setPozabi] = useState(false);
  const [zaposlen, setZaposlen] = useState(false);
  const [lokalna, setLokalna] = useState("");
  const [shranjeno, setShranjeno] = useState(false);

  function prevzemi(n: NujniNastavitve) {
    setS(n);
    setObvesti(n.obvesti);
    setPrevezi(n.prevezi);
    setCakanje(String(n.cakanjeSek));
    setOmejitevUra(String(n.omejitevUra));
    setOmejitevDan(String(n.omejitevDan));
    setStevilka("");
    setPozabi(false);
  }

  useEffect(() => {
    void nujniNastavitveFn()
      .then(prevzemi)
      .catch((cause) => onError(cause instanceof Error ? cause.message : ""));
  }, []);

  async function shrani() {
    setZaposlen(true);
    setShranjeno(false);
    setLokalna("");
    onError("");
    try {
      prevzemi(
        await shraniNujneFn({
          data: { obvesti: pozabi ? false : obvesti, prevezi: pozabi ? false : prevezi, cakanjeSek: Number(cakanje), omejitevUra: Number(omejitevUra), omejitevDan: Number(omejitevDan), ...(stevilka.trim() ? { stevilka: stevilka.trim() } : {}), ...(pozabi ? { pozabiStevilko: true } : {}) },
        }),
      );
      setShranjeno(true);
    } catch (cause) {
      const m = cause instanceof Error ? cause.message : "";
      setLokalna(m);
      onError(m);
    } finally {
      setZaposlen(false);
    }
  }

  const polje = "mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2";
  const gumb = "w-fit rounded-xl border border-[var(--color-rule)] px-4 py-2 text-sm disabled:opacity-50";
  const imaStevilko = Boolean(s?.stevilkaVpisana) && !pozabi;
  const imaNapakeStevilko = Boolean(ns?.stevilkaVpisana) && !napakePozabi;
  return (
    <>
    <section aria-labelledby="nu-naslov" className="grid gap-2">
      <h3 id="nu-naslov" className="text-lg">{t("nujniNaslov")}</h3>
      <p className="text-sm text-[var(--color-moss)]">{t("nujniRazlaga")}</p>
      <form
        className="grid gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void shrani();
        }}
      >
        <label className="flex items-start gap-2" htmlFor="nu-obvesti">
          <input id="nu-obvesti" type="checkbox" className="mt-1 h-5 w-5" checked={obvesti} onChange={(e) => setObvesti(e.target.checked)} />
          <span>{t("nujniObvesti")}</span>
        </label>
        <label className="flex items-start gap-2" htmlFor="nu-prevezi">
          <input id="nu-prevezi" type="checkbox" className="mt-1 h-5 w-5" checked={prevezi} onChange={(e) => setPrevezi(e.target.checked)} />
          <span>{t("nujniPrevezi")}</span>
        </label>
        {prevezi ? (
          <p role="note" className="rounded-xl bg-[var(--color-sheet)] p-3 text-[var(--color-ink)]">
            {t("nujniPrevezaOpozorilo")}
          </p>
        ) : null}
        <label htmlFor="nu-stevilka">
          {t("nujniStevilka")}
          <input
            id="nu-stevilka"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={stevilka}
            onChange={(e) => setStevilka(e.target.value)}
            className={polje}
          />
        </label>
        <p className="text-xs text-[var(--color-moss)]">{imaStevilko ? t("nujniStevilkaVpisana") : t("nujniStevilkaPrazna")}</p>
        {s?.stevilkaVpisana ? (
          <label className="flex items-start gap-2" htmlFor="nu-pozabi">
            <input id="nu-pozabi" type="checkbox" className="mt-1 h-5 w-5" checked={pozabi} onChange={(e) => setPozabi(e.target.checked)} />
            <span>{t("nujniPozabiStevilko")}</span>
          </label>
        ) : null}
        <label htmlFor="nu-cakanje">
          {t("nujniCakanje")}
          <input id="nu-cakanje" type="number" inputMode="numeric" min={10} max={60} step={1} value={cakanje} onChange={(e) => setCakanje(e.target.value)} className={polje} />
        </label>
        <label htmlFor="nu-omejitev-ura">
          {t("nujniOmejitevUra")}
          <input id="nu-omejitev-ura" type="number" inputMode="numeric" min={1} max={20} step={1} value={omejitevUra} onChange={(e) => setOmejitevUra(e.target.value)} className={polje} />
        </label>
        <label htmlFor="nu-omejitev-dan">
          {t("nujniOmejitevDan")}
          <input id="nu-omejitev-dan" type="number" inputMode="numeric" min={1} max={100} step={1} value={omejitevDan} onChange={(e) => setOmejitevDan(e.target.value)} className={polje} />
        </label>
        <button type="submit" disabled={zaposlen} className={gumb}>
          {t("nujniShrani")}
        </button>
      </form>
      {shranjeno ? (
        <p role="status" className="text-sm">
          {t("nujniShranjeno")}
        </p>
      ) : null}
      {lokalna ? (
        <p role="alert" className="text-sm text-[var(--color-signal)]">
          {lokalna}
        </p>
      ) : null}
    </section>

    <hr className="my-4 border-[var(--color-rule)]" />
    <section aria-labelledby="napake-naslov" className="grid gap-2">
      <h3 id="napake-naslov" className="text-lg">{t("napakeNaslov")}</h3>
      <p className="text-sm text-[var(--color-moss)]">{t("napakeRazlaga")}</p>
      <form
        className="grid gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void shraniNapakeSubmit();
        }}
      >
        <label className="flex items-start gap-2" htmlFor="na-obvesti">
          <input id="na-obvesti" type="checkbox" className="mt-1 h-5 w-5" checked={napakeObvesti} onChange={(e) => setNapakeObvesti(e.target.checked)} />
          <span>{t("napakeObvesti")}</span>
        </label>
        
        <label htmlFor="na-stevilka">
          {t("napakeStevilka")}
          <input
            id="na-stevilka"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={napakeStevilka}
            onChange={(e) => setNapakeStevilka(e.target.value)}
            className={polje}
          />
        </label>
        <p className="text-xs text-[var(--color-moss)]">{imaNapakeStevilko ? t("napakeStevilkaVpisana") : t("napakeStevilkaPrazna")}</p>
        
        {ns?.stevilkaVpisana ? (
          <label className="flex items-start gap-2" htmlFor="na-pozabi">
            <input id="na-pozabi" type="checkbox" className="mt-1 h-5 w-5" checked={napakePozabi} onChange={(e) => setNapakePozabi(e.target.checked)} />
            <span>{t("napakePozabiStevilko")}</span>
          </label>
        ) : null}

        <button type="submit" disabled={napakeZaposlen} className={gumb}>
          {t("napakeShrani")}
        </button>
      </form>

      {ns?.stevilkaVpisana ? (
        <div className="mt-4 grid gap-2 text-sm">
          <p>{t("napakeZeton")}</p>
          {napakeZeton ? (
            <div className="flex gap-2 items-center">
              <code className="bg-[var(--color-surface)] px-2 py-1 rounded-md text-xs">{napakeZeton}</code>
              <button type="button" onClick={kopirajZeton} className={gumb}>
                {zetonKopiran ? t("napakeZetonKopiran") : t("napakeKopirajZeton")}
              </button>
            </div>
          ) : (
            <button type="button" onClick={pridobiZeton} className={gumb}>
              {t("napakeZeton")}
            </button>
          )}
        </div>
      ) : null}

      <div className="mt-4 text-sm">
        <h4 className="font-semibold mb-2">{t("napakeSeznam")}</h4>
        {ns?.vnosi && ns.vnosi.length > 0 ? (
          <ul className="grid gap-2">
            {ns.vnosi.map((v, i) => (
              <li key={i} className="rounded-xl border border-[var(--color-rule)] p-3">
                <div className="flex justify-between text-xs text-[var(--color-moss)]">
                  <span>{v.naprava}</span>
                  <span>{new Date(v.cas).toLocaleString()}</span>
                </div>
                <div className="mt-1 text-sm font-medium">{v.proces}</div>
                <div className="text-xs text-[var(--color-signal)]">{v.izjema}</div>
                <div className="mt-1 text-xs text-[var(--color-moss)]">{t("napakeStevec")}: {v.stevec}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[var(--color-moss)]">{t("napakeSeznamPrazno")}</p>
        )}
      </div>

      {napakeShranjeno ? (
        <p role="status" className="text-sm">
          {t("napakeShranjeno")}
        </p>
      ) : null}
      {napakeLokalna ? (
        <p role="alert" className="text-sm text-[var(--color-signal)]">
          {napakeLokalna}
        </p>
      ) : null}
    </section>
    </>
  );
}
