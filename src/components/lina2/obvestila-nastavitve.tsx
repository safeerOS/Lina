import { useEffect, useState } from "react";
import { nastavitveObvestilFn, shraniObvestilaFn } from "@/lib/lina/functions.ts";
import type { NastavitveObvestil, RavenObvestil, VrstaDogodka } from "@/lib/lina/obvestila-odlocitev.ts";
import { t2, type Beseda2 } from "./besedila.ts";

/** Nastavitve obvestil (22. 11. 2026, enotna odlocitev obvestil): ne moti, ure miru, raven po vrsti, pomembni stiki, kljucne besede. */
const VRSTE: Array<{ id: VrstaDogodka; oznaka: Beseda2 }> = [
  { id: "klic", oznaka: "obvKlic" },
  { id: "sporocilo", oznaka: "obvSporocilo" },
  { id: "opomnik", oznaka: "obvOpomnik" },
  { id: "novica", oznaka: "obvNovica" },
  { id: "motivacija", oznaka: "obvMotivacija" },
];
const POLJE = "rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-2 py-1 text-sm";
const URE = Array.from({ length: 24 }, (_, i) => i);
const vSeznam = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function ObvestilaNastavitve({ razred }: { razred: string }) {
  const [n, setN] = useState<NastavitveObvestil | null>(null);
  const [vip, setVip] = useState("");
  const [kljucne, setKljucne] = useState("");
  const [napaka, setNapaka] = useState(false);
  useEffect(() => {
    let zivo = true;
    nastavitveObvestilFn()
      .then((x) => {
        if (!zivo) return;
        setN(x);
        setVip(x.vip.join(", "));
        setKljucne(x.kljucneBesede.join(", "));
      })
      .catch(() => undefined);
    return () => {
      zivo = false;
    };
  }, []);
  async function shrani(popravek: Partial<NastavitveObvestil>) {
    setNapaka(false);
    try {
      setN(await shraniObvestilaFn({ data: { popravek } }));
    } catch {
      setNapaka(true);
    }
  }
  if (!n) return null;
  const raven = (r: RavenObvestil | undefined) => r ?? "privzeto";
  return (
    <fieldset className="mt-5" aria-label={t2("obvNaslov")}>
      <legend className="text-sm font-semibold">{t2("obvNaslov")}</legend>
      <p className="mt-1 text-xs text-[var(--color-moss)]">{t2("obvOpis")}</p>
      <label className={`${razred} mt-2`}>
        <input type="checkbox" checked={n.neMoti} onChange={(e) => void shrani({ neMoti: e.target.checked })} />
        {t2("obvNeMoti")}
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={Boolean(n.ureMiru)} onChange={(e) => void shrani({ ureMiru: e.target.checked ? { od: 22, do: 7 } : null })} />
          {t2("obvUreMiru")}
        </label>
        {n.ureMiru ? (
          <>
            <label className="flex items-center gap-1">
              {t2("obvOd")}
              <select className={POLJE} value={n.ureMiru.od} onChange={(e) => void shrani({ ureMiru: { od: Number(e.target.value), do: n.ureMiru?.do ?? 7 } })}>
                {URE.map((u) => (
                  <option key={u} value={u}>
                    {String(u).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              {t2("obvDo")}
              <select className={POLJE} value={n.ureMiru.do} onChange={(e) => void shrani({ ureMiru: { od: n.ureMiru?.od ?? 22, do: Number(e.target.value) } })}>
                {URE.map((u) => (
                  <option key={u} value={u}>
                    {String(u).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
      </div>
      <label className={`${razred} mt-2`}>
        <input type="checkbox" checked={n.nujnoPrebijeNeMoti} onChange={(e) => void shrani({ nujnoPrebijeNeMoti: e.target.checked })} />
        {t2("obvNujno")}
      </label>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <label className="flex items-center justify-between gap-2">
          {t2("obvSplosno")}
          <select className={POLJE} aria-label={`${t2("obvNaslov")}: ${t2("obvSplosno")}`} value={n.globalno} onChange={(e) => void shrani({ globalno: e.target.value as NastavitveObvestil["globalno"] })}>
            <option value="vse">{t2("obvVse")}</option>
            <option value="pomembno">{t2("obvPomembno")}</option>
            <option value="nic">{t2("obvNic")}</option>
          </select>
        </label>
        {VRSTE.map((v) => (
          <label key={v.id} className="flex items-center justify-between gap-2">
            {t2(v.oznaka)}
            <select className={POLJE} aria-label={`${t2("obvNaslov")}: ${t2(v.oznaka)}`} value={raven(n.poVrsti[v.id])} onChange={(e) => void shrani({ poVrsti: { [v.id]: e.target.value as RavenObvestil } })}>
              <option value="privzeto">{t2("obvKotSplosno")}</option>
              <option value="vse">{t2("obvVse")}</option>
              <option value="pomembno">{t2("obvPomembno")}</option>
              <option value="nic">{t2("obvNic")}</option>
            </select>
          </label>
        ))}
      </div>
      <label className="mt-3 flex flex-col gap-1 text-sm">
        {t2("obvVip")}
        <input className={POLJE} value={vip} maxLength={2000} onChange={(e) => setVip(e.target.value)} onBlur={() => void shrani({ vip: vSeznam(vip) })} />
      </label>
      <label className="mt-2 flex flex-col gap-1 text-sm">
        {t2("obvKljucne")}
        <input className={POLJE} value={kljucne} maxLength={2000} onChange={(e) => setKljucne(e.target.value)} onBlur={() => void shrani({ kljucneBesede: vSeznam(kljucne) })} />
      </label>
      {napaka ? (
        <p role="alert" className="text-xs text-[var(--color-signal)]">
          {t2("obvNapaka")}
        </p>
      ) : null}
    </fieldset>
  );
}
