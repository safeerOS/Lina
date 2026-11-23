import { useCallback, useEffect, useState } from "react";
import { KorakiSlika } from "@/components/koraki-slika.tsx";
import { t } from "@/lib/lina/besedila.ts";
import { izklopiPotFn, namestiPotFn, nastaviPotFn, stanjePotiFn, vklopiPotFn } from "@/lib/lina/functions.ts";

type StanjePoti = Awaited<ReturnType<typeof stanjePotiFn>>;
const RAZLOG = {
  izklopljeno: "ptRIzklopljeno",
  "neposredno-deluje": "ptRNeposrednoDeluje",
  "neposredno-izbrano": "ptRNeposrednoIzbrano",
  "tunel-izbran": "ptRTunelIzbran",
  "ni-domene": "ptRNiDomene",
  "neposredno-napaka": "ptRNeposrednoNapaka",
  "neposredno-pauza": "ptRNeposrednoNapaka",
  "neposredno-izpad": "ptRNeposrednoIzpad",
  "neposredno-spet": "ptRNeposrednoSpet",
} as const;
/**
 * Pot javnega naslova (lastnik 12. 11. 2026): samodejno / samo neposredna / samo hitri tunel, domena, vklop in stanje.
 * Pokaze, katera pot je zdaj aktivna in zakaj. Rocni vnos polja javniNaslov ostane enakovredna moznost (opis spodaj).
 * Napake so tik ob obrazcu (role=alert); barve samo prek var(--color-*).
 */
export function PotNaslova({
  trenutni,
  onNaslov,
  onError,
}: {
  trenutni: string;
  onNaslov: (naslov: string) => void;
  onError: (sporocilo: string) => void;
}) {
  const [s, setS] = useState<StanjePoti | null>(null);
  const [nacin, setNacin] = useState<StanjePoti["nacin"]>("samodejno");
  const [domena, setDomena] = useState("");
  const [zaposlen, setZaposlen] = useState(false);
  const [lokalna, setLokalna] = useState("");
  const [sporocilo, setSporocilo] = useState("");
  const [vprasaj, setVprasaj] = useState(false);
  const napaka = useCallback(
    (cause: unknown) => {
      const m = cause instanceof Error ? cause.message : t("tuNapaka");
      setLokalna(m);
      onError(m);
    },
    [onError],
  );
  const sprejmi = useCallback((x: StanjePoti) => {
    setS(x);
    setNacin(x.nacin);
    setDomena(x.domena);
  }, []);
  useEffect(() => {
    void stanjePotiFn().then(sprejmi).catch(napaka);
  }, [napaka, sprejmi]);
  // Med zagonom ali ko je vklopljeno, stanje osvezujemo (samodejni preklop poti se zgodi v ozadju).
  useEffect(() => {
    if (!s?.vklopljeno) return;
    const id = setInterval(
      () =>
        void stanjePotiFn()
          .then((x) => {
            setS(x);
            onNaslov(x.naslov ?? "");
          })
          .catch(() => undefined),
      15e3,
    );
    return () => clearInterval(id);
  }, [s?.vklopljeno, onNaslov]);
  const izvedi = async (delo: () => Promise<StanjePoti>, poUspehu?: (x: StanjePoti) => void) => {
    setZaposlen(true);
    setLokalna("");
    setSporocilo("");
    try {
      const x = await delo();
      sprejmi(x);
      poUspehu?.(x);
    } catch (cause) {
      napaka(cause);
    } finally {
      setZaposlen(false);
    }
  };
  const gumb =
    "rounded-xl border border-[var(--color-rule)] px-4 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-ink)] disabled:opacity-50";
  const polje = "mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-[var(--color-sheet)] text-[var(--color-ink)] px-3 py-2";
  const vklopljeno = s?.vklopljeno === true;
  const imaRocni = trenutni.trim() !== "" && trenutni.trim() !== (s?.naslov ?? "");
  const potrebujeCaddy =
    !!s && nacin !== "tunel" && domena.trim() !== "" && !s.neposredno.orodje.najden && s.neposredno.orodje.namestljiv;
  const potrebujeTunel = !!s && nacin !== "neposredno" && !s.tunel.orodje.najden && s.tunel.orodje.namestljiv;
  return (
    <section className="mt-3 space-y-3 text-sm" aria-labelledby="pt-naslov">
      <h4 id="pt-naslov" className="font-semibold">
        {t("ptNaslov")}
      </h4>
      <p className="text-[var(--color-moss)]">{t("ptRazlaga")}</p>
      <p className="text-[var(--color-moss)]">{t("tuRocno")}</p>
      <fieldset className="space-y-1" disabled={zaposlen || vklopljeno}>
        <legend>{t("ptNacin")}</legend>
        {(["samodejno", "neposredno", "tunel"] as const).map((n) => (
          <label className="flex items-center gap-2" htmlFor={`pt-nacin-${n}`} key={n}>
            <input
              id={`pt-nacin-${n}`}
              type="radio"
              name="pt-nacin"
              checked={nacin === n}
              onChange={() => setNacin(n)}
            />
            {t(n === "samodejno" ? "ptSamodejno" : n === "neposredno" ? "ptNeposredno" : "ptTunel")}
          </label>
        ))}
      </fieldset>
      <label className="block" htmlFor="pt-domena">
        {t("ptDomena")}
        <input
          id="pt-domena"
          className={polje}
          value={domena}
          autoComplete="off"
          inputMode="url"
          disabled={zaposlen || vklopljeno}
          onChange={(e) => setDomena(e.target.value)}
          aria-describedby="pt-domena-namig"
        />
        <span id="pt-domena-namig" className="mt-1 block text-xs text-[var(--color-moss)]">
          {t("ptDomenaNamig")}
        </span>
      </label>
      <button
        type="button"
        className={gumb}
        disabled={zaposlen || vklopljeno}
        onClick={() =>
          izvedi(
            async () => (
              await nastaviPotFn({
                data: {
                  nacin,
                  domena,
                },
              }),
              setSporocilo(t("ptShranjeno")),
              stanjePotiFn()
            ),
          )
        }
      >
        {t("ptShrani")}
      </button>
      {nacin !== "tunel" ? (
        <KorakiSlika
          naslov={t("ptKorakiNaslov")}
          vrstice={[{ besedilo: t("ptK1") }, { besedilo: t("ptK2") }, { besedilo: t("ptK3") }, { besedilo: t("ptK4") }]}
        />
      ) : null}
      {nacin !== "tunel" ? <p className="text-[var(--color-moss)]">{t("ptZasebnost")}</p> : null}
      {nacin !== "neposredno" ? <p className="text-[var(--color-moss)]">{t("tuRazlaga")}</p> : null}
      {potrebujeCaddy ? (
        <div className="space-y-2">
          <p>{t("ptNiCaddy")}</p>
          <button
            type="button"
            className={gumb}
            disabled={zaposlen}
            onClick={() =>
              izvedi(() =>
                namestiPotFn({
                  data: {
                    kaj: "neposredno",
                    soglasje: true,
                  },
                }),
              )
            }
          >
            {t("ptNamestiCaddy")}
          </button>
          {s?.neposredno.namestitev.faza === "napaka" && s.neposredno.namestitev.sporocilo ? (
            <p role="alert" className="text-[var(--color-signal)]">
              {s.neposredno.namestitev.sporocilo}
            </p>
          ) : null}
        </div>
      ) : null}
      {potrebujeTunel ? (
        <div className="space-y-2">
          <p>{t("tuNiOrodja")}</p>
          <button
            type="button"
            className={gumb}
            disabled={zaposlen}
            onClick={() =>
              izvedi(() =>
                namestiPotFn({
                  data: {
                    kaj: "tunel",
                    soglasje: true,
                  },
                }),
              )
            }
          >
            {t("tuNamesti")}
          </button>
          {s?.tunel.namestitev.faza === "napaka" && s.tunel.namestitev.sporocilo ? (
            <p role="alert" className="text-[var(--color-signal)]">
              {s.tunel.namestitev.sporocilo}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-2">
        {vprasaj ? (
          <p role="alert" className="text-[var(--color-signal)]">
            {t("ptPrepis")}
          </p>
        ) : null}
        {vklopljeno ? (
          <button
            type="button"
            className={gumb}
            disabled={zaposlen}
            onClick={() =>
              izvedi(
                () => izklopiPotFn(),
                () => onNaslov(""),
              )
            }
          >
            {t("ptIzklopi")}
          </button>
        ) : (
          <>
            <button
              type="button"
              className={gumb}
              disabled={zaposlen || !s}
              onClick={() => {
                if (imaRocni && !vprasaj) {
                  setVprasaj(true);
                  return;
                }
                setVprasaj(false);
                void izvedi(
                  async () => (
                    await nastaviPotFn({
                      data: {
                        nacin,
                        domena,
                      },
                    }),
                    vklopiPotFn()
                  ),
                  (x) => x.naslov && onNaslov(x.naslov),
                );
              }}
            >
              {vprasaj ? t("ptVseeno") : t("ptVklopi")}
            </button>
            {vprasaj ? (
              <button type="button" className={gumb} onClick={() => setVprasaj(false)}>
                {t("ptPreklici")}
              </button>
            ) : null}
          </>
        )}
      </div>
      <div role="status" className="space-y-1">
        {zaposlen ? <p>{t("tuZaganja")}</p> : null}
        {s && (s.tunel.faza === "caka" || s.neposredno.faza === "caka") ? <p>{t("ptCaka")}</p> : null}
        {s ? (
          <>
            <p>
              <strong>{t("ptAktivna")}:</strong>{" "}
              {s.aktivna === "neposredno"
                ? t("ptAktivnaNeposredno")
                : s.aktivna === "tunel"
                  ? t("ptAktivnaTunel")
                  : t("ptAktivnaNic")}
            </p>
            <p className="text-[var(--color-moss)]">{t(RAZLOG[s.razlog])}</p>
            {s.nasvet ? (
              <p className="text-[var(--color-moss)]">
                <strong>{t("ptNasvet")}:</strong> {s.nasvet}
              </p>
            ) : null}
            {s.pauzaSek !== null ? (
              <p className="text-[var(--color-moss)]">
                {t("ptPauza")} {s.pauzaSek}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
      {s?.podrobnost ? (
        <p role="alert" className="text-[var(--color-signal)]">
          {s.podrobnost}
        </p>
      ) : null}
      {s?.tunel.faza === "napaka" && s.tunel.razlog ? (
        <p role="alert" className="text-[var(--color-signal)]">
          {s.tunel.razlog}
        </p>
      ) : null}
      {s?.neposredno.faza === "napaka" && s.neposredno.razlog && s.neposredno.razlog !== s.podrobnost ? (
        <p role="alert" className="text-[var(--color-signal)]">
          {s.neposredno.razlog}
        </p>
      ) : null}
      {lokalna ? (
        <p role="alert" className="text-[var(--color-signal)]">
          {lokalna}
        </p>
      ) : null}
      {sporocilo ? <p role="status">{sporocilo}</p> : null}
    </section>
  );
}
