import { useState } from "react";
import { t } from "@/lib/lina/besedila.ts";
import { savePravilaFn } from "@/lib/lina/functions.ts";
import { imeVTozilniku } from "@/lib/lina/ime-tozilnik.ts";
import { t2 } from "./besedila.ts";

/**
 * Enkratna kartica na Domovu (osebni nacin, ime se ni vpisano; lastnik 22. 11. 2026): vprasa »Kako vam je ime?«, takoj pokaze
 * predlog tozilnika (»Poklicali ste Ano«), ki ga je mogoce popraviti, in shrani ime in tozilnik v pravila. Po shranjevanju
 * kartice ni vec (ime je vpisano); »Ne zdaj« jo skrije do naslednjega zagona (brez shrambe brskalnika).
 */
export function ImeKartica({ onShranjeno }: { onShranjeno: () => void | Promise<void> }) {
  const [ime, setIme] = useState("");
  const [tozilnik, setTozilnik] = useState("");
  const [skrita, setSkrita] = useState(false);
  const [zasedeno, setZasedeno] = useState(false);
  const [napaka, setNapaka] = useState(false);
  if (skrita) return null;
  const predlog = imeVTozilniku(ime);
  const koncni = imeVTozilniku(ime, tozilnik);
  const cisto = ime.replace(/\s+/g, " ").trim();

  async function shrani() {
    if (!cisto) return;
    setNapaka(false);
    setZasedeno(true);
    try {
      await savePravilaFn({ data: { imeLastnika: cisto, imeLastnikaTozilnik: tozilnik.replace(/\s+/g, " ").trim() } });
      await onShranjeno();
    } catch {
      setNapaka(true);
    } finally {
      setZasedeno(false);
    }
  }

  return (
    <form
      className="lina-ime-kartica"
      aria-label={t2("imeKartNaslov")}
      onSubmit={(e) => {
        e.preventDefault();
        void shrani();
      }}
    >
      <div className="lina-ime-besedilo">
        <strong>{t2("imeKartNaslov")}</strong>
        {cisto ? (
          <span className="lina-ime-predogled" role="status">
            {t2("imeKartPredogled")} »{t("osebnaPoklicali").replace("{ime}", () => koncni)}«
          </span>
        ) : (
          <span>{t2("imeKartOpis")}</span>
        )}
      </div>
      <label className="lina-ime-polje">
        {t2("imeKartIme")}
        <input value={ime} maxLength={60} autoComplete="given-name" onChange={(e) => setIme(e.target.value)} />
      </label>
      <label className="lina-ime-polje">
        {t2("imeKartTozilnik")}
        <input value={tozilnik} maxLength={60} placeholder={predlog} onChange={(e) => setTozilnik(e.target.value)} />
      </label>
      <div className="lina-ime-gumbi">
        <button type="submit" disabled={zasedeno || !cisto} className="lina-ime-shrani">
          {t2("imeKartShrani")}
        </button>
        <button type="button" className="lina-mot-gumb" onClick={() => setSkrita(true)}>
          {t2("imeKartPozneje")}
        </button>
      </div>
      {napaka ? (
        <p role="alert" className="lina-ime-napaka">
          {t2("imeKartNapaka")}
        </p>
      ) : null}
    </form>
  );
}
