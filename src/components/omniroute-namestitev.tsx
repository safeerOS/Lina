/**
 * Naloga 31 (lastnik 26. 11. 2026 18:36): v Mozganih Lina vpraša »OmniRoute še ni nameščen. Ga namestim?« in pokaže korake
 * (prenos, namestitev, zagon, preverba modelov) s stanjem in napako v navadnem jeziku. Samo prikaz (stanje pride s streznika).
 */
import { t, type Beseda } from "@/lib/lina/besedila.ts";
import type { Korak, StanjeKoraka, StanjeNamestitve } from "@/lib/lina/omniroute-namestitev.server.ts";
import { veljavenNaslovOmniroute } from "@/lib/lina/omniroute.ts";
import { vstavi } from "@/lib/lina/ui-videz.ts";
import { GUMB, GUMB_OBROBA } from "@/components/ui-lina.tsx";

/**
 * Namestitev Lina ponudi samo za lokalni privzeti naslov (127.0.0.1 ali localhost, vrata 20128). Za drug naslov (lasten streznik)
 * samo pove, da ne tece: namestitev ne sme tiho zamenjati OmniRoute, ki ga je uporabnik izbral (svetovalec, naloga 31).
 */
export function jeLokalniPrivzeti(naslov: string): boolean {
  const n = veljavenNaslovOmniroute(naslov);
  return n === "http://127.0.0.1:20128/v1" || n === "http://localhost:20128/v1";
}

const IME_KORAKA: Record<Korak, Beseda> = {
  prenos: "omKorakPrenos",
  namestitev: "omKorakNamestitev",
  zagon: "omKorakZagon",
  preverba: "omKorakPreverba",
};
const IME_STANJA: Record<StanjeKoraka, Beseda> = {
  caka: "omStanjeCaka",
  tece: "omStanjeTece",
  uspeh: "omStanjeUspeh",
  napaka: "omStanjeNapaka",
};

export function OmniRouteNamestitev({
  stanje,
  vprasaj,
  busy,
  onDa,
  onNe,
  onOdstrani,
}: {
  stanje: StanjeNamestitve | null;
  vprasaj: boolean;
  busy: boolean;
  onDa: () => void;
  onNe: () => void;
  onOdstrani: () => void;
}) {
  const potek = stanje && (stanje.vTeku || stanje.napaka || stanje.pripravljeno);
  return (
    <div className="sm:col-span-2 grid gap-3">
      {vprasaj && !stanje?.vTeku ? (
        <div role="group" aria-labelledby="om-vprasanje" className="rounded-lg border border-[var(--color-rule)] p-3">
          <p id="om-vprasanje" className="font-medium text-[var(--color-ink)]">
            {stanje?.namescen ? t("omVprasanjeZagon") : t("omVprasanje")}
          </p>
          <p className="mt-1 text-sm text-[var(--color-ink)]">{t("omVprasanjeOpis")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={GUMB} disabled={busy} onClick={onDa}>
              {stanje?.namescen ? t("omDaZagon") : t("omDa")}
            </button>
            <button type="button" className={GUMB_OBROBA} disabled={busy} onClick={onNe}>
              {t("omNe")}
            </button>
          </div>
        </div>
      ) : null}
      {potek ? (
        <section aria-labelledby="om-koraki" aria-live="polite">
          <h4 id="om-koraki" className="text-sm font-semibold text-[var(--color-ink)]">
            {t("omKoraki")}
          </h4>
          <ol className="mt-1 grid list-decimal gap-1 pl-5 text-sm text-[var(--color-ink)]">
            {stanje.koraki.map((k) => (
              <li key={k.korak} data-korak={k.korak} data-stanje={k.stanje}>
                {t(IME_KORAKA[k.korak])}: {t(IME_STANJA[k.stanje])}
              </li>
            ))}
          </ol>
          {stanje.napaka ? (
            <p role="alert" className="mt-2 text-sm text-[var(--color-signal)]">
              {stanje.napaka}
            </p>
          ) : null}
          {stanje.pripravljeno ? <p className="mt-2 text-sm text-[var(--color-ink)]">{t("omPripravljeno")}</p> : null}
        </section>
      ) : null}
      {stanje?.namescen && !stanje.vTeku ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-ink)]">
          <span>{vstavi(t("omNamescen"), { razlicica: stanje.razlicica })}</span>
          <button type="button" className={GUMB_OBROBA} disabled={busy} onClick={onOdstrani}>
            {t("omOdstrani")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
