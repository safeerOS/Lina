import { useCallback, useEffect, useState } from "react";
import { t } from "@/lib/lina/besedila.ts";
import { KorakiSlika } from "@/components/koraki-slika.tsx";
import { naslovTwilioFn, pozabiTwilioFn, poveziTwilioFn, stanjePodpisaFn, stanjeTwilioFn, stevilkeTwilioFn, testniKlicFn, vklopiPodpisFn } from "@/lib/lina/functions.ts";
import { jeTunelskiNaslov, stanjeSprejema } from "@/lib/lina/sprejem-klicev.ts";
import type { StanjeTwilio, StevilkaTwilio } from "@/lib/lina/twilio-racun.server.ts";

/**
 * Racun Twilio (lastnik 12. 11. 2026, »dovolj je API«): Account SID + API kljuc, izbira stevilke, naslov klicev, pozabi.
 * Skrivnost gre samo na streznik in se ne vrne ali prikaze nazaj; polje se po uspehu izprazni.
 */
export function TwilioRacun({ naslovKlicev, onError }: { naslovKlicev: string; onError: (m: string) => void }) {
  const [s, setS] = useState<StanjeTwilio | null>(null);
  const [stevilke, setStevilke] = useState<StevilkaTwilio[]>([]);
  const [izbrana, setIzbrana] = useState("");
  const [sid, setSid] = useState("");
  const [kljucSid, setKljucSid] = useState("");
  const [skrivnost, setSkrivnost] = useState("");
  const [odstrani, setOdstrani] = useState(true);
  const [sporocilo, setSporocilo] = useState("");
  const [zaposlen, setZaposlen] = useState(false);
  const [podpis, setPodpis] = useState(false);
  const [kam, setKam] = useState("");

  const [lokalna, setLokalna] = useState("");
  // Napaka se pokaze TUDI tik ob obrazcu: skupno sporocilo je na vrhu strani in ga uporabnik, ki je pri obrazcu, ne vidi (12. 11. 2026).
  const napaka = useCallback(
    (cause: unknown) => {
      const m = cause instanceof Error ? cause.message : t("twNapaka");
      setLokalna(m);
      onError(m);
    },
    [onError],
  );

  useEffect(() => {
    void stanjeTwilioFn().then(setS).catch(napaka);
  }, [napaka]);

  useEffect(() => {
    if (!s?.povezan) {
      setPodpis(false);
      return;
    }
    void stanjePodpisaFn().then((x) => setPodpis(x.vklopljen)).catch(napaka);
  }, [s?.povezan, napaka]);

  useEffect(() => {
    if (!s?.povezan) {
      setStevilke([]);
      return;
    }
    let preklic = false;
    void stevilkeTwilioFn()
      .then((x) => !preklic && setStevilke(x))
      .catch(napaka);
    return () => {
      preklic = true;
    };
  }, [s?.povezan, napaka]);

  async function izvedi(delo: () => Promise<void>) {
    setZaposlen(true);
    onError("");
    setLokalna("");
    setSporocilo("");
    try {
      await delo();
    } catch (cause) {
      napaka(cause);
    } finally {
      setZaposlen(false);
    }
  }

  const izbranaStevilka = stevilke.find((x) => x.sid === izbrana) ?? null;
  const tunelski = jeTunelskiNaslov(naslovKlicev);
  const sprejem = izbranaStevilka ? stanjeSprejema(izbranaStevilka.glasUrl, naslovKlicev) : null;
  const polje = "mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2";
  return (
    <section aria-labelledby="tw-naslov" className="mt-6">
      <h3 id="tw-naslov" className="display text-2xl">{t("twNaslov")}</h3>
      {s?.povezan ? (
        <div className="mt-3 space-y-3 text-sm">
          <p>{t("twPovezan")} <code>{s.sid}</code></p>
          <label className="block" htmlFor="tw-stevilka">
            {t("twStevilka")}
            <select id="tw-stevilka" className={polje} value={izbrana} onChange={(e) => setIzbrana(e.target.value)}>
              <option value="" />
              {stevilke.map((x) => (
                <option key={x.sid} value={x.sid}>{x.stevilka}{x.ime ? ` (${x.ime})` : ""}</option>
              ))}
            </select>
          </label>
          <div className="space-y-2 rounded-xl border border-[var(--color-rule)] p-3">
            <h4 className="font-semibold">{t("skNaslov")}</h4>
            <p className="text-[var(--color-moss)]">{t("skRazlaga")}</p>
            {izbranaStevilka ? (
              <p role="status">
                {sprejem === "vklopljen" ? (
                  <>{t("skVklopljen")} <strong>{izbranaStevilka.stevilka}</strong></>
                ) : sprejem === "drug" ? (
                  t("skDrug")
                ) : (
                  t("skIzklopljen")
                )}
              </p>
            ) : (
              <p>{t("skIzberi")}</p>
            )}
            {tunelski && stevilke.length > 0 ? <p role="alert" className="text-[var(--color-signal)]">{t("skTunel")}</p> : null}
            {tunelski && stevilke.length === 0 ? (
              <div className="space-y-2" aria-labelledby="tw-test-naslov">
                <h5 id="tw-test-naslov" className="font-semibold">{t("tvTestNaslov")}</h5>
                <p className="text-[var(--color-moss)]">{t("tvTestRazlaga")}</p>
                <label className="block" htmlFor="tw-test-naslov-polje">
                  {t("tvTestNaslov2")}
                  <input id="tw-test-naslov-polje" className={polje} readOnly value={`${naslovKlicev.replace(/\/+$/, "")}/api/voice/incoming`} onFocus={(e) => e.currentTarget.select()} />
                </label>
                <button
                  type="button"
                  className="rounded-xl border border-[var(--color-rule)] px-3 py-2"
                  onClick={() => {
                    void navigator.clipboard?.writeText(`${naslovKlicev.replace(/\/+$/, "")}/api/voice/incoming`).then(() => setSporocilo(t("tvTestKopirano")), () => undefined);
                  }}
                >
                  {t("tvTestKopiraj")}
                </button>
                <KorakiSlika naslov={t("tvTestNaslov")} vrstice={[{ besedilo: t("tvTestK1") }, { besedilo: t("tvTestK2") }, { besedilo: t("tvTestK3") }]} />
              </div>
            ) : null}
            <button
              type="button"
              disabled={zaposlen || !izbrana || sprejem === "vklopljen" || tunelski}
              className="rounded-xl border border-[var(--color-rule)] px-4 py-2 disabled:opacity-50"
              onClick={() =>
                izvedi(async () => {
                  if (!naslovKlicev) throw new Error(t("twNiNaslova"));
                  await naslovTwilioFn({ data: { stevilkaSid: izbrana, naslov: naslovKlicev } });
                  setStevilke(await stevilkeTwilioFn());
                  setSporocilo(t("skVklopljenoSp"));
                })
              }
            >
              {t("skVklopi")}
            </button>{" "}
            <button
              type="button"
              disabled={zaposlen || !izbrana || sprejem === "izklopljen"}
              className="rounded-xl border border-[var(--color-rule)] px-4 py-2 disabled:opacity-50"
              onClick={() =>
                izvedi(async () => {
                  await naslovTwilioFn({ data: { stevilkaSid: izbrana, naslov: "" } });
                  setStevilke(await stevilkeTwilioFn());
                  setSporocilo(t("skIzklopljenoSp"));
                })
              }
            >
              {t("skIzklopi")}
            </button>
          </div>
          {podpis ? (
            <p>{t("twPodpisVklopljen")}</p>
          ) : (
            <button
              type="button"
              disabled={zaposlen}
              className="rounded-xl border border-[var(--color-rule)] px-4 py-2 disabled:opacity-50"
              onClick={() =>
                izvedi(async () => {
                  if (!naslovKlicev) throw new Error(t("twNiNaslova"));
                  await vklopiPodpisFn({ data: { naslov: naslovKlicev } });
                  setPodpis(true);
                })
              }
            >
              {t("twPodpis")}
            </button>
          )}
          <div className="mt-4 space-y-2 border-t border-[var(--color-rule)] pt-4">
            <h4 className="font-semibold">{t("tkNaslov")}</h4>
            <p className="text-[var(--color-moss)]">{t("tkRazlaga")}</p>
            <label className="block" htmlFor="tk-stevilka">
              {t("tkStevilka")}
              <input id="tk-stevilka" type="tel" inputMode="tel" className={polje} value={kam} autoComplete="tel" onChange={(e) => setKam(e.target.value)} />
            </label>
            <button
              type="button"
              disabled={zaposlen || !kam.trim()}
              className="rounded-xl border border-[var(--color-rule)] px-4 py-2 disabled:opacity-50"
              onClick={() =>
                izvedi(async () => {
                  if (!naslovKlicev) throw new Error(t("twNiNaslova"));
                  await testniKlicFn({ data: { kam } });
                  setSporocilo(t("tkKlice"));
                })
              }
            >
              {t("tkGumb")}
            </button>
          </div>
          <label className="flex items-center gap-2" htmlFor="tw-odstrani">
            <input id="tw-odstrani" type="checkbox" checked={odstrani} onChange={(e) => setOdstrani(e.target.checked)} />
            {t("twOdstraniNaslov")}
          </label>
          <button
            type="button"
            disabled={zaposlen}
            className="rounded-xl border border-[var(--color-rule)] px-4 py-2 disabled:opacity-50"
            onClick={() =>
              izvedi(async () => {
                if (odstrani && izbrana) await naslovTwilioFn({ data: { stevilkaSid: izbrana, naslov: "" } });
                setS(await pozabiTwilioFn());
                setIzbrana("");
              })
            }
          >
            {t("twPozabi")}
          </button>
        </div>
      ) : (
        <form
          className="mt-3 space-y-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void izvedi(async () => {
              setS(await poveziTwilioFn({ data: { sid, kljucSid, skrivnost } }));
              setSkrivnost("");
            });
          }}
        >
          <p className="whitespace-pre-line text-[var(--color-moss)]">{t("twRazlaga")}</p>
          <KorakiSlika naslov={t("shTw")} vrstice={[{ besedilo: t("shTw1") }, { besedilo: t("shTw2") }, { besedilo: t("shTw3") }, { besedilo: t("shTw4"), ne: true }]} />
          <label className="block" htmlFor="tw-sid">
            {t("twSid")}
            <input id="tw-sid" className={polje} value={sid} autoComplete="off" onChange={(e) => setSid(e.target.value)} />
          </label>
          <label className="block" htmlFor="tw-kljuc">
            {t("twKljucSid")}
            <input id="tw-kljuc" className={polje} value={kljucSid} autoComplete="off" onChange={(e) => setKljucSid(e.target.value)} />
          </label>
          <label className="block" htmlFor="tw-skrivnost">
            {t("twSkrivnost")}
            <input id="tw-skrivnost" type="password" className={polje} value={skrivnost} autoComplete="off" onChange={(e) => setSkrivnost(e.target.value)} />
          </label>
          <button type="submit" disabled={zaposlen || !sid || !kljucSid || !skrivnost} className="rounded-xl border border-[var(--color-rule)] px-4 py-2 disabled:opacity-50">
            {t("twPovezi")}
          </button>
        </form>
      )}
      {lokalna ? <p role="alert" className="mt-2 text-sm text-[var(--color-signal)]">{lokalna}</p> : null}
      {sporocilo ? <p role="status" className="mt-2 text-sm">{sporocilo}</p> : null}
    </section>
  );
}
