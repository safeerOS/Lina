import { useEffect, useState } from "react";
import { t } from "@/lib/lina/besedila.ts";
import { preberiSipFn, shraniSipFn, pozabiSipFn, stanjeSipFn } from "@/lib/lina/functions.ts";
import { GUMB, GUMB_OBROBA, OZNAKA_POLJA, POLJE, Razdelek, Znacka } from "@/components/ui-lina.tsx";
import type { StanjeRegistracije } from "@/lib/lina/sip/sluzba-sip.server.ts";

export function SipNastavitve({ onError }: { onError: (message: string) => void }) {
  const [registrar, setRegistrar] = useState("");
  const [vrata, setVrata] = useState(5060);
  const [domena, setDomena] = useState("");
  const [uporabnik, setUporabnik] = useState("");
  const [avtUporabnik, setAvtUporabnik] = useState("");
  const [geslo, setGeslo] = useState("");
  const [expires, setExpires] = useState(300);
  const [nastavljen, setNastavljen] = useState(false);
  const [imaGeslo, setImaGeslo] = useState(false);
  const [stanje, setStanje] = useState<StanjeRegistracije | null>(null);
  const [busy, setBusy] = useState(false);
  const [dela, setDela] = useState<"" | "shrani" | "pozabi">("");
  const [note, setNote] = useState("");

  useEffect(() => {
    let ziv = true;
    preberiSipFn().then((data) => {
      if (!ziv) return;
      setNastavljen(data.nastavljen);
      setRegistrar(data.registrar || "");
      setVrata(data.vrata || 5060);
      setDomena(data.domena || "");
      setUporabnik(data.uporabnik || "");
      setAvtUporabnik(data.avtUporabnik || "");
      setExpires(data.expires || 300);
      setImaGeslo(data.imaGeslo);
    }).catch((e) => onError(e.message || "Napaka pri branju SIP nastavitev"));
    return () => { ziv = false; };
  }, [onError]);

  useEffect(() => {
    let ziv = true;
    async function osvezi() {
      try {
        const s = await stanjeSipFn();
        if (ziv) setStanje(s);
      } catch (e) {
        // Prezri napake osvezevanja
      }
    }
    if (nastavljen) {
      void osvezi();
      const int = setInterval(() => void osvezi(), 3000);
      return () => { ziv = false; clearInterval(int); };
    }
    return () => { ziv = false; };
  }, [nastavljen]);

  async function shrani() {
    setBusy(true);
    setDela("shrani");
    onError("");
    setNote("");
    try {
      const izid = await shraniSipFn({ data: { registrar, vrata, domena, uporabnik, avtUporabnik, geslo, expires } });
      setNastavljen(izid.nastavljen);
      setRegistrar(izid.registrar || "");
      setVrata(izid.vrata || 5060);
      setDomena(izid.domena || "");
      setUporabnik(izid.uporabnik || "");
      setAvtUporabnik(izid.avtUporabnik || "");
      setExpires(izid.expires || 300);
      setImaGeslo(izid.imaGeslo);
      setGeslo("");
      setNote(t("sipShranjeno"));
      
      const s = await stanjeSipFn();
      setStanje(s);
    } catch (cause: any) {
      onError(cause.message || "Napaka");
    } finally {
      setBusy(false);
      setDela("");
    }
  }

  async function pozabi() {
    setBusy(true);
    setDela("pozabi");
    onError("");
    setNote("");
    try {
      const izid = await pozabiSipFn();
      setNastavljen(izid.nastavljen);
      setRegistrar(izid.registrar || "");
      setVrata(izid.vrata || 5060);
      setDomena(izid.domena || "");
      setUporabnik(izid.uporabnik || "");
      setAvtUporabnik(izid.avtUporabnik || "");
      setExpires(izid.expires || 300);
      setImaGeslo(izid.imaGeslo);
      setGeslo("");
      setStanje(null);
    } catch (cause: any) {
      onError(cause.message || "Napaka");
    } finally {
      setBusy(false);
      setDela("");
    }
  }

  function opisStanja(s: StanjeRegistracije | null) {
    if (!s) return "";
    let base = "";
    if (s.stanje === "izklopljen") base = t("sipIzklopljen");
    else if (s.stanje === "zaganjam") base = t("sipZaganjam");
    else if (s.stanje === "registriran") base = t("sipRegistriran");
    else if (s.stanje === "ponovno") base = t("sipPonovno");
    if (s.razlog) return `${base} (${s.razlog})`;
    return base;
  }

  return (
    <Razdelek id="nast-sip" naslov={t("sipNaslov")} opis={t("sipUvod")}>
      {nastavljen && stanje ? (
        <div className="mb-5 flex items-center gap-2">
          <span className="text-sm font-medium">{t("sipStanje")}</span>
          <Znacka ton={stanje.stanje === "registriran" ? "moss" : stanje.stanje === "ponovno" ? "signal" : "brass"}>
            {opisStanja(stanje)}
          </Znacka>
        </div>
      ) : null}
      
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={OZNAKA_POLJA} htmlFor="sip-registrar">
          {t("sipRegistrar")}
          <input
            id="sip-registrar"
            value={registrar}
            onChange={(e) => setRegistrar(e.target.value)}
            className={POLJE}
            autoComplete="off"
          />
        </label>
        <label className={OZNAKA_POLJA} htmlFor="sip-vrata">
          {t("sipVrata")}
          <input
            id="sip-vrata"
            type="number"
            value={vrata}
            onChange={(e) => setVrata(Number(e.target.value))}
            className={POLJE}
            min={1}
            max={65535}
          />
        </label>
        <label className={OZNAKA_POLJA} htmlFor="sip-domena">
          {t("sipDomena")}
          <input
            id="sip-domena"
            value={domena}
            onChange={(e) => setDomena(e.target.value)}
            className={POLJE}
            autoComplete="off"
          />
        </label>
        <label className={OZNAKA_POLJA} htmlFor="sip-expires">
          {t("sipExpires")}
          <input
            id="sip-expires"
            type="number"
            value={expires}
            onChange={(e) => setExpires(Number(e.target.value))}
            className={POLJE}
            min={60}
            max={86400}
          />
        </label>
        <label className={OZNAKA_POLJA} htmlFor="sip-uporabnik">
          {t("sipUporabnik")}
          <input
            id="sip-uporabnik"
            value={uporabnik}
            onChange={(e) => setUporabnik(e.target.value)}
            className={POLJE}
            autoComplete="off"
          />
        </label>
        <label className={OZNAKA_POLJA} htmlFor="sip-avtUporabnik">
          {t("sipAvtUporabnik")}
          <input
            id="sip-avtUporabnik"
            value={avtUporabnik}
            onChange={(e) => setAvtUporabnik(e.target.value)}
            className={POLJE}
            autoComplete="off"
          />
        </label>
        <label className={`${OZNAKA_POLJA} sm:col-span-2`} htmlFor="sip-geslo">
          {t("sipGeslo")}
          <input
            id="sip-geslo"
            type="password"
            value={geslo}
            placeholder={imaGeslo ? t("sipShranjeno") : ""}
            onChange={(e) => setGeslo(e.target.value)}
            className={POLJE}
            autoComplete="new-password"
          />
        </label>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" disabled={busy} aria-busy={dela === "shrani"} onClick={() => void shrani()} className={GUMB}>
          {t("sipShrani")}
        </button>
        {nastavljen ? (
          <button type="button" disabled={busy} aria-busy={dela === "pozabi"} onClick={() => void pozabi()} className={GUMB_OBROBA}>
            {t("sipPozabi")}
          </button>
        ) : null}
      </div>
      {note ? (
        <p className="mt-3 text-sm" role="status">
          {note}
        </p>
      ) : null}
    </Razdelek>
  );
}
