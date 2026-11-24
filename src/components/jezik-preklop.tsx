import { useEffect, useState } from "react";
import { preberiJezikFn, shraniJezikFn } from "@/lib/lina/functions.ts";
import { KLJUC_JEZIKA, jezikVmesnika, razberiIzbiroJezika, razresiJezik, t, type IzbiraJezika, type Jezik } from "@/lib/lina/besedila.ts";

function shranjenaIzbira(): IzbiraJezika {
  try {
    return razberiIzbiroJezika(localStorage.getItem(KLJUC_JEZIKA));
  } catch {
    return "sistem";
  }
}

function sistemski(): string | undefined {
  return navigator.languages?.[0] ?? navigator.language;
}

/** Koliko caka zagon na streznik, preden vzame lokalni predpomnilnik (vmesnik se ne sme obesiti). */
const CAKAJ_STREZNIK_MS = 1500;

/**
 * Jezik ob zagonu v brskalniku: izbira na strezniku (prezivi nova vrata namizne lupine), sicer localStorage (predpomnilnik),
 * sicer jezik sistema (privzeto »Kot sistem«).
 */
export async function zacetniJezik(): Promise<Jezik> {
  const streznik = await Promise.race([
    preberiJezikFn().catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), CAKAJ_STREZNIK_MS)),
  ]);
  if (streznik) {
    try {
      localStorage.setItem(KLJUC_JEZIKA, streznik);
    } catch {
      /* predpomnilnik ni nujen */
    }
  }
  return razresiJezik(streznik ?? shranjenaIzbira(), sistemski());
}

/** Izbira jezika vmesnika v Nastavitvah (vzorec telefona AppLocale.kt: Sistem / Slovenščina / English). */
export function JezikPreklop() {
  const [izbira, setIzbira] = useState<IzbiraJezika>("sistem");
  useEffect(() => setIzbira(shranjenaIzbira()), []);
  const izberi = async (nova: IzbiraJezika) => {
    const prej = izbira;
    setIzbira(nova);
    try {
      // Najprej streznik, pred ponovnim nalaganjem: sicer nalaganje prekine zahtevo in izbira ob naslednjem zagonu (nova vrata) izgine.
      await shraniJezikFn({ data: { izbira: nova } });
    } catch {
      // Ni shranjeno: ob nalaganju bi streznik vrnil staro izbiro, zato izbira ostane, kot je bila (vidno, ne tiho).
      setIzbira(prej);
      return;
    }
    try {
      localStorage.setItem(KLJUC_JEZIKA, nova);
    } catch {
      /* predpomnilnik ni nujen */
    }
    // Ponovno nalaganje izrise vse zaslone v novem jeziku (tudi besedila, izracunana ob prvem izrisu).
    if (razresiJezik(nova, sistemski()) !== jezikVmesnika()) location.reload();
  };
  return (
    <label className="flex items-center gap-2 text-sm text-[var(--color-moss)]">
      <span>{t("jezik")}</span>
      <select
        value={izbira}
        onChange={(e) => void izberi(e.target.value as IzbiraJezika)}
        className="rounded-full border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-ink)]"
      >
        <option value="sistem">{t("jezikSistem")}</option>
        <option value="sl" lang="sl">Slovenščina</option>
        <option value="en" lang="en">English</option>
      </select>
    </label>
  );
}
