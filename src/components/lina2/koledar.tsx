import { useCallback, useEffect, useState } from "react";
import { sporociloNapake, sporociloStreznika, t } from "@/lib/lina/besedila.ts";
import { koledarDodajFn, koledarIzbrisiFn, koledarSeznamFn, koledarSpremeniFn } from "@/lib/lina/functions.ts";
import { MEJA_ZAPISOV, lokalniCas, razberiCas, uraBesedilo, type VrstaKoledar, type ZapisKoledar } from "@/lib/lina/koledar.ts";
import { datumDanes, vstavi } from "@/lib/lina/ui-videz.ts";
import { DOGODEK_KOLEDAR } from "@/components/lina2/pogovor.tsx";

function naslednjaUra(): string {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return lokalniCas(d);
}

const VRSTE: Array<{ id: VrstaKoledar; oznaka: () => string }> = [
  { id: "opomnik", oznaka: () => t("vrstaOpomnik") },
  { id: "dogodek", oznaka: () => t("vrstaDogodek") },
  { id: "zapisek", oznaka: () => t("vrstaZapisek") },
];

function oznakaVrste(v: VrstaKoledar): string {
  return VRSTE.find((x) => x.id === v)?.oznaka() ?? v;
}

/** Zavihek Koledar: dodajanje in pregled opomnikov, dogodkov in zapiskov (lokalno, koledar.json). */
export function KoledarPanel() {
  const [zapisi, setZapisi] = useState<ZapisKoledar[] | null>(null);
  const [vrsta, setVrsta] = useState<VrstaKoledar>("opomnik");
  const [naslov, setNaslov] = useState("");
  const [cas, setCas] = useState("");
  const [napaka, setNapaka] = useState("");
  const [zasedeno, setZasedeno] = useState(false);

  const osvezi = useCallback(() => {
    void koledarSeznamFn().then(setZapisi).catch(() => setZapisi([]));
  }, []);
  useEffect(() => {
    setCas(naslednjaUra());
    osvezi();
    window.addEventListener(DOGODEK_KOLEDAR, osvezi);
    return () => window.removeEventListener(DOGODEK_KOLEDAR, osvezi);
  }, [osvezi]);

  async function dodaj() {
    setNapaka("");
    setZasedeno(true);
    try {
      const izid = await koledarDodajFn({ data: { vrsta, naslov, cas: cas || null } });
      if (!izid.ok) {
        setNapaka(izid.razlog ? vstavi(t(izid.razlog), { n: MEJA_ZAPISOV }) : sporociloStreznika(izid.sporocilo));
        return;
      }
      setZapisi(izid.zapisi);
      setNaslov("");
      window.dispatchEvent(new Event(DOGODEK_KOLEDAR));
    } catch (e) {
      setNapaka(sporociloNapake(e));
    } finally {
      setZasedeno(false);
    }
  }

  async function preklopi(z: ZapisKoledar) {
    setZapisi(await koledarSpremeniFn({ data: { id: z.id, opravljeno: !z.opravljeno } }));
    window.dispatchEvent(new Event(DOGODEK_KOLEDAR));
  }
  async function izbrisi(z: ZapisKoledar) {
    setZapisi(await koledarIzbrisiFn({ data: { id: z.id } }));
    window.dispatchEvent(new Event(DOGODEK_KOLEDAR));
  }

  const odprti = (zapisi ?? []).filter((z) => !z.opravljeno).sort((a, b) => (a.cas ?? "9999").localeCompare(b.cas ?? "9999"));
  const opravljeni = (zapisi ?? []).filter((z) => z.opravljeno).sort((a, b) => (b.cas ?? "").localeCompare(a.cas ?? ""));
  const skupine: Array<{ dan: string; zapisi: ZapisKoledar[] }> = [];
  for (const z of odprti) {
    const d = razberiCas(z.cas);
    const dan = d ? datumDanes(d, undefined, true) : t("vrstaZapisek");
    const zadnja = skupine[skupine.length - 1];
    if (zadnja?.dan === dan) zadnja.zapisi.push(z);
    else skupine.push({ dan, zapisi: [z] });
  }

  const vrstica = (z: ZapisKoledar) => (
    <li key={z.id} className="flex items-center gap-3 py-2.5">
      <button type="button" onClick={() => void preklopi(z)} aria-label={`${t("koledarOpravljeno")}: ${z.naslov}`} aria-pressed={z.opravljeno} className="lina-kljukica shrink-0" data-opravljeno={z.opravljeno} />
      <span className="w-12 shrink-0 text-sm tabular-nums text-[var(--color-brass)]">{uraBesedilo(z.cas)}</span>
      <span className={`min-w-0 flex-1 text-sm ${z.opravljeno ? "line-through opacity-60" : ""}`}>
        {z.naslov}
        <span className="ml-2 text-xs text-[var(--color-brass)]">{oznakaVrste(z.vrsta)}</span>
      </span>
      <button type="button" onClick={() => void izbrisi(z)} className="rounded-full px-3 py-1 text-xs text-[var(--color-signal)] hover:bg-[var(--color-surface)]">
        {t("koledarIzbrisi")}
      </button>
    </li>
  );

  return (
    <section className="mt-5 grid max-w-6xl gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <form
        className="flex flex-col gap-4 self-start rounded-3xl bg-[var(--color-sheet)] p-5 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void dodaj();
        }}
      >
        <h2 className="display text-2xl">{t("koledarNaslov")}</h2>
        <p className="text-sm text-[var(--color-moss)]">{t("koledarNamig")}</p>
        <fieldset className="flex gap-2" aria-label={t("koledarVrsta")}>
          {VRSTE.map((v) => (
            <label key={v.id} className="lina-izbira">
              <input type="radio" name="vrsta" value={v.id} checked={vrsta === v.id} onChange={() => setVrsta(v.id)} className="sr-only" />
              <span>{v.oznaka()}</span>
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1 text-sm">
          {t("koledarNaslovPolje")}
          <input value={naslov} maxLength={200} onChange={(e) => setNaslov(e.target.value)} className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {vrsta === "zapisek" ? t("koledarCasZapisek") : t("koledarCas")}
          <input type="datetime-local" value={cas} onChange={(e) => setCas(e.target.value)} className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2" />
        </label>
        {napaka ? <p role="alert" className="text-sm text-[var(--color-signal)]">{napaka}</p> : null}
        <button type="submit" disabled={zasedeno || !naslov.trim()} className="self-start rounded-full bg-[var(--color-ink)] px-6 py-2.5 text-sm text-[var(--color-on-ink)] disabled:opacity-50">
          {t("koledarDodaj")}
        </button>
      </form>

      <div className="min-w-0 rounded-3xl bg-[var(--color-sheet)] p-5 sm:p-6">
        {zapisi && zapisi.length === 0 ? <p className="text-sm text-[var(--color-brass)]">{t("koledarPrazno")}</p> : null}
        {skupine.length > 0 ? <h3 className="display text-xl">{t("koledarPrihodnje")}</h3> : null}
        {skupine.map((s) => (
          <div key={s.dan} className="mt-4">
            <h4 className="text-sm font-semibold">{s.dan}</h4>
            <ul className="mt-1 divide-y divide-[var(--color-rule)]">{s.zapisi.map(vrstica)}</ul>
          </div>
        ))}
        {opravljeni.length > 0 ? (
          <div className="mt-8">
            <h3 className="display text-xl">{t("koledarPreteklo")}</h3>
            <ul className="mt-2 divide-y divide-[var(--color-rule)]">{opravljeni.map(vrstica)}</ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
