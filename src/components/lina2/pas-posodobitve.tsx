import { useState } from "react";
import { posodobiLinoFn } from "@/lib/lina/functions.ts";
import { t2 } from "./besedila.ts";

/**
 * Naloga 28: pas na Domovu, ko je na voljo novejsa Lina. Posodobi zazene obstojeco pot (zacniPosodobitev: podpis -> vsota -> pkexec);
 * kaj in od kod namestiti, odloci streznik. Opombe izdaje so ze ociscene na strezniku in se izrisejo samo kot besedilo.
 * Razredi so od kartice imena (ime-kartica.tsx), da pas na Domovu izgleda enako.
 */
export function PasPosodobitve({ razlicica, opombe }: { razlicica: string; opombe: string }) {
  const [stanje, setStanje] = useState<"" | "delam" | "zacela" | "napaka">("");
  const naslov = t2("posPasNaslov").replace("{r}", () => razlicica);
  const posodobi = () => {
    setStanje("delam");
    posodobiLinoFn()
      .then((izid) => setStanje(izid.ok ? "zacela" : "napaka"))
      .catch(() => setStanje("napaka"));
  };
  return (
    <section className="lina-ime-kartica" aria-label={naslov}>
      <div className="lina-ime-besedilo">
        <strong>{naslov}</strong>
        {opombe ? (
          <details>
            <summary>{t2("posPasNovo")}</summary>
            <p className="whitespace-pre-line">{opombe}</p>
          </details>
        ) : null}
      </div>
      <div className="lina-ime-gumbi">
        <button type="button" className="lina-ime-shrani" disabled={stanje === "delam" || stanje === "zacela"} onClick={posodobi}>
          {t2("posPasGumb")}
        </button>
      </div>
      <p role="status" aria-live="polite">
        {stanje === "delam" ? t2("posPasZacenjam") : stanje === "zacela" ? t2("posPasZacela") : stanje === "napaka" ? t2("posPasNapaka") : ""}
      </p>
    </section>
  );
}
