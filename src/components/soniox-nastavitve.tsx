import { useEffect, useState } from "react";
import { t } from "@/lib/lina/besedila.ts";
import { jeVeljavenKljucSoniox, stanjeBesedilo } from "@/lib/lina/soniox-ui.ts";
import { stanjeSonioxFn, shraniSonioxKljucFn, pozabiSonioxKljucFn } from "@/lib/lina/functions.ts";

export function SonioxNastavitve({
  vklop,
  busy,
  onVklop,
  onError,
}: {
  vklop: boolean;
  busy: boolean;
  onVklop: (vklop: boolean) => void;
  onError: (sporocilo: string) => void;
}) {
  const [stanje, setStanje] = useState<{ vklop: boolean; kljucShranjen: boolean } | null>(null);
  const [kljuc, setKljuc] = useState("");
  const [zaposlen, setZaposlen] = useState(false);

  useEffect(() => {
    stanjeSonioxFn()
      .then(setStanje)
      .catch(() => setStanje({ vklop: false, kljucShranjen: false }));
  }, []);

  async function shrani(e: React.FormEvent) {
    e.preventDefault();
    if (!jeVeljavenKljucSoniox(kljuc)) return;
    
    setZaposlen(true);
    onError("");
    try {
      const novo = await shraniSonioxKljucFn({ data: { kljuc } });
      setStanje(novo);
      setKljuc("");
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "");
    } finally {
      setZaposlen(false);
    }
  }

  async function pozabi() {
    setZaposlen(true);
    onError("");
    try {
      const novo = await pozabiSonioxKljucFn();
      setStanje(novo);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "");
    } finally {
      setZaposlen(false);
    }
  }

  const polje = "mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2";

  return (
    <section aria-labelledby="soniox-naslov" className="mt-4 grid gap-2 text-sm">
      <h3 id="soniox-naslov" className="text-lg">
        {t("sonioxNaslov")}
      </h3>
      <p className="text-[var(--color-moss)]">{t("sonioxRazlaga")}</p>
      
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          checked={vklop}
          disabled={busy || zaposlen}
          onChange={(e) => onVklop(e.target.checked)}
        />
        {t("sonioxVklopOznaka")}
      </label>

      {vklop === true ? (
        <p role="note" className="max-w-prose text-xs text-[var(--color-moss)]">
          {t("sonioxObvestilo")}
        </p>
      ) : null}

      <form className="grid gap-2" onSubmit={shrani}>
        <label htmlFor="soniox-kljuc">
          {t("sonioxKljucPolje")}
          <input
            id="soniox-kljuc"
            type="password"
            value={kljuc}
            onChange={(e) => setKljuc(e.target.value)}
            className={polje}
            autoComplete="off"
          />
        </label>
        
        <div className="flex items-center gap-3">
          <button 
            type="submit" 
            className="lina-gumb-majhen w-fit" 
            disabled={zaposlen || busy || !jeVeljavenKljucSoniox(kljuc)}
          >
            {t("sonioxShrani")}
          </button>
        </div>
      </form>

      <div className="flex items-center gap-3 mt-2">
        <p>{t(stanjeBesedilo(stanje ? { vklop, kljucShranjen: stanje.kljucShranjen } : null))}</p>
        
        {stanje?.kljucShranjen ? (
          <button 
            type="button"
            className="lina-gumb-majhen w-fit" 
            disabled={zaposlen || busy}
            onClick={pozabi}
          >
            {t("sonioxPozabi")}
          </button>
        ) : null}
      </div>
    </section>
  );
}