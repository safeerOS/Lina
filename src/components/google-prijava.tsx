import { useCallback, useEffect, useRef, useState } from "react";
import { samodejniProjekt } from "@/lib/lina/google-projekti.ts";
import { t } from "@/lib/lina/besedila.ts";
import { KorakiSlika } from "@/components/koraki-slika.tsx";
import { jeVeljavnaKodaPrijave } from "@/lib/lina/prijava-koda.ts";
import {
  kodaGoogleFn,
  namestiGcloudFn,
  pozabiGoogleFn,
  preklicGoogleFn,
  projektiGoogleFn,
  stanjeGoogleFn,
  zacniGoogleFn,
} from "@/lib/lina/functions.ts";
import type { StanjeGoogleRacuna } from "@/lib/lina/google-racun.server.ts";
import type { VzrokNapake } from "@/lib/lina/prijava-google.server.ts";

const BESEDILO_VZROKA = {
  brskalnik: "gpNapakaBrskalnik",
  koda: "gpNapakaKoda",
  preklicana: "gpNapakaPreklicana",
  potekla: "gpNapakaPotekla",
  zagon: "gpNapakaZagon",
  dovoljenje: "gpNapakaDovoljenje",
  neznano: "gpNapakaNeznano",
} as const;

/** Sporocilo napake v jeziku vmesnika po vzroku, ki ga javi streznik; brez vzroka privzeto besedilo. */
function besediloNapakePrijave(vzrok: VzrokNapake | null | undefined): string {
  return t(vzrok ? BESEDILO_VZROKA[vzrok] : "gpNapaka");
}

/**
 * Prijava v Google Cloud z enim gumbom (lastnik 11. 11. 2026): privzeti brskalnik, dovoljenje za namestitev gcloud z
 * razlago, pozabi/zamenjaj racun. Odjemalec ne poslje poti ali ukaza; povezava se pokaze samo z accounts.google.com.
 */
export function GooglePrijava({ project, onProject, onError, onSamodejniProjekt }: {
  project: string;
  onProject: (id: string) => void;
  onError: (m: string) => void;
  /** Edini projekt z obracunom: Lina ga izbere in shrani sama (kot telefon), uporabnik lahko izbiro spremeni. */
  onSamodejniProjekt?: (id: string) => void;
}) {
  const [s, setS] = useState<StanjeGoogleRacuna | null>(null);
  const [projekti, setProjekti] = useState<{ id: string; ime: string; obracun?: boolean | null }[]>([]);
  const [zaposlen, setZaposlen] = useState(false);
  // Trenutni projekt za samodejno izbiro (ne v odvisnostih ucinka: izbira se ne sme ponoviti ob vsaki spremembi polja).
  const projectRef = useRef(project);
  projectRef.current = project;
  const [koda, setKoda] = useState("");

  const osvezi = useCallback(async () => {
    try {
      setS(await stanjeGoogleFn());
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [onError]);

  useEffect(() => {
    void osvezi();
  }, [osvezi]);

  // Vpisane kode ne hranimo dlje, kot je potrebno: po posiljanju ali ob koncu prijave se polje izprazni.
  const kodaSePotrebuje = s?.prijava.faza === "caka" && !s.prijava.kodaPoslana;
  useEffect(() => {
    if (!kodaSePotrebuje) setKoda("");
  }, [kodaSePotrebuje]);

  const caka = s?.prijava.faza === "caka" || s?.namestitev.faza === "tece";
  useEffect(() => {
    if (!caka) return;
    const id = setInterval(() => void osvezi(), 1500);
    return () => clearInterval(id);
  }, [caka, osvezi]);

  useEffect(() => {
    if (!s?.prijavljen) {
      setProjekti([]);
      return;
    }
    let preklic = false;
    void projektiGoogleFn()
      .then((p) => {
        if (preklic) return;
        setProjekti(p);
        const sam = samodejniProjekt(p.map((x) => ({ ...x, obracun: x.obracun ?? null })));
        if (sam && !projectRef.current) onSamodejniProjekt?.(sam);
      })
      .catch(() => undefined);
    return () => {
      preklic = true;
    };
  }, [s?.prijavljen]);

  async function izvedi(ukaz: () => Promise<StanjeGoogleRacuna>) {
    setZaposlen(true);
    onError("");
    try {
      setS(await ukaz());
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : t("gpNapaka"));
    } finally {
      setZaposlen(false);
    }
  }

  if (!s) return null;
  const blokirano = zaposlen || s.klicTece;
  // Belo besedilo samo na temnih *-fill barvah (temni v obeh temah); --color-ink je v temi Lina 2.0 svetel (lastnik 22. 11. 2026: gumb se slabo vidi).
  const gumb = "rounded-full px-4 py-3 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

  return (
    <div className="mt-3 rounded-2xl border border-[var(--color-rule)] bg-[var(--color-sheet)] text-[var(--color-ink)] p-4 text-sm" role="group" aria-label="Google">
      {s.klicTece ? <p className="mb-2 text-xs text-[var(--color-brass)]">{t("gpMedKlicem")}</p> : null}

      {s.prijava.faza === "caka" ? (
        <>
          {s.prijava.potrebnaKoda || s.prijava.kodaPoslana ? (
            <>
              <p role="status">{s.prijava.kodaPoslana ? t("gpKodaPreverjam") : t("gpBrezBrskalnika")}</p>
              {s.prijava.povezava && !s.prijava.kodaPoslana ? (
                <p className="mt-2 break-all text-xs">
                  <a href={s.prijava.povezava} target="_blank" rel="noopener noreferrer" className="underline">
                    {s.prijava.povezava}
                  </a>
                </p>
              ) : null}
              {!s.prijava.kodaPoslana ? (
                <form
                  className="mt-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (jeVeljavnaKodaPrijave(koda)) void izvedi(() => kodaGoogleFn({ data: { koda: koda.trim() } }));
                  }}
                >
                  <label className="block" htmlFor="gp-koda">
                    {t("gpKodaOznaka")}
                    <input
                      id="gp-koda"
                      name="gp-koda"
                      value={koda}
                      onChange={(event) => setKoda(event.target.value)}
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      aria-invalid={koda.trim() !== "" && !jeVeljavnaKodaPrijave(koda)}
                      aria-describedby={koda.trim() !== "" && !jeVeljavnaKodaPrijave(koda) ? "gp-koda-oblika" : undefined}
                      className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-[var(--color-sheet)] text-[var(--color-ink)] px-3 py-2"
                    />
                  </label>
                  {koda.trim() !== "" && !jeVeljavnaKodaPrijave(koda) ? (
                    <p id="gp-koda-oblika" className="mt-1 text-xs text-[var(--color-signal)]">
                      {t("gpKodaOblika")}
                    </p>
                  ) : null}
                  <button
                    type="submit"
                    disabled={zaposlen || !jeVeljavnaKodaPrijave(koda)}
                    className={`${gumb} mt-3 bg-[var(--color-ink-fill)] disabled:opacity-50`}
                  >
                    {t("gpKodaPotrdi")}
                  </button>
                </form>
              ) : null}
            </>
          ) : (
            <>
              <p role="status">{t("gpCaka")}</p>
              {s.prijava.povezava ? (
                <p className="mt-2 break-all text-xs">
                  {t("gpPovezava")}{" "}
                  <a href={s.prijava.povezava} target="_blank" rel="noopener noreferrer" className="underline">
                    {s.prijava.povezava}
                  </a>
                </p>
              ) : null}
            </>
          )}
          <button type="button" onClick={() => void izvedi(() => preklicGoogleFn())} className={`${gumb} mt-3 bg-[var(--color-ink-fill)]`}>
            {t("gpPreklici")}
          </button>
        </>
      ) : s.namestitev.faza === "tece" ? (
        <p role="status">{t("gpNamestitevTece")}</p>
      ) : s.prijavljen ? (
        <>
          <p>{t("gpPrijavljen")}</p>
          {projekti.length === 0 ? (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer font-semibold">{t("gpKakoNaslov")}</summary>
              <p className="mt-2 whitespace-pre-line">{t("gpKako")}</p>
            <KorakiSlika naslov={t("shGc")} vrstice={[{ besedilo: t("shGc1") }, { besedilo: t("shGc2") }, { besedilo: t("shGc3") }, { besedilo: t("shGc4") }, { besedilo: t("shGc5") }]} />
            </details>
          ) : null}
          {projekti.length > 0 ? (
            <label className="mt-3 block">
              {t("gpProjekt")}
              <select
                value={projekti.some((p) => p.id === project) ? project : ""}
                onChange={(event) => onProject(event.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-[var(--color-sheet)] text-[var(--color-ink)] px-3 py-2"
              >
                <option value="">{t("gpProjektIzberi")}</option>
                {projekti.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.ime} ({p.id}){p.obracun === true ? ` · ${t("gpObracunDa")}` : p.obracun === false ? ` · ${t("gpObracunNe")}` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={blokirano}
              onClick={() => void izvedi(async () => (await pozabiGoogleFn(), zacniGoogleFn()))}
              className={`${gumb} bg-[var(--color-ink-fill)] disabled:opacity-50`}
            >
              {t("gpZamenjaj")}
            </button>
            <button type="button" disabled={blokirano} onClick={() => void izvedi(() => pozabiGoogleFn())} className={`${gumb} bg-[var(--color-signal-fill)] disabled:opacity-50`}>
              {t("gpPozabi")}
            </button>
          </div>
          <p className="mt-2 text-xs">{t("gpPozabiNamig")}</p>
        </>
      ) : !s.gcloudNajden ? (
        s.namestljiv ? (
          <>
            <p className="font-medium">{t("gpNamestiNaslov")}</p>
            <p className="mt-1">{t("gpNamestiRazlaga")}</p>
            {s.namestitev.faza === "napaka" && s.namestitev.sporocilo ? <p className="mt-2 text-xs text-[var(--color-brass)]">{s.namestitev.sporocilo}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={blokirano}
                onClick={() => void izvedi(() => namestiGcloudFn({ data: { soglasje: true } }))}
                className={`${gumb} bg-[var(--color-ink-fill)] disabled:opacity-50`}
              >
                {t("gpNamestiDa")}
              </button>
            </div>
          </>
        ) : (
          <p>{t("gpNeDeluje")}</p>
        )
      ) : (
        <>
          {s.prijava.faza === "napaka" ? (
            <div className="mb-2 text-xs">
              <p role="alert" className="text-[var(--color-brass)]">
                {besediloNapakePrijave(s.prijava.vzrok)}
              </p>
              {s.prijava.podrobnosti.length > 0 ? (
                <details className="mt-1">
                  <summary className="cursor-pointer font-semibold">{t("gpPodrobnosti")}</summary>
                  <p className="mt-1 text-[var(--color-moss)]">{t("gpPodrobnostiNamig")}</p>
                  <pre className="mt-1 max-h-48 overflow-auto rounded-xl bg-[var(--color-sheet)] p-2 break-words whitespace-pre-wrap">
                    {s.prijava.podrobnosti.join("\n")}
                  </pre>
                </details>
              ) : null}
            </div>
          ) : null}
          <details className="mb-3 text-xs">
            <summary className="cursor-pointer font-semibold">{t("gpKakoNaslov")}</summary>
            <p className="mt-2 whitespace-pre-line">{t("gpKako")}</p>
            <KorakiSlika naslov={t("shGc")} vrstice={[{ besedilo: t("shGc1") }, { besedilo: t("shGc2") }, { besedilo: t("shGc3") }, { besedilo: t("shGc4") }, { besedilo: t("shGc5") }]} />
          </details>
          <button type="button" disabled={blokirano} onClick={() => void izvedi(() => zacniGoogleFn())} className={`${gumb} bg-[var(--color-ink-fill)] disabled:opacity-50`}>
            {t("gpGumb")}
          </button>
        </>
      )}
    </div>
  );
}
