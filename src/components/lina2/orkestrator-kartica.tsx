import { useCallback, useEffect, useState } from "react";
import { t, type Beseda } from "@/lib/lina/besedila.ts";
import { stanjeOrkestratorjaFn, ukazOrkestratorjaFn } from "@/lib/lina/functions.ts";
import type { StanjeOrkestratorja } from "@/lib/lina/orkestrator.server.ts";
import { datumInUra } from "@/lib/lina/ui-videz.ts";
import { Ikona } from "./domov.tsx";

const POLJE = "rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--aurora-1)]";
const KONCNE = ["koncano", "ustavljeno", "napaka"];

type Naloga = StanjeOrkestratorja["naloge"][number];

/**
 * Orkestrator (25. 11. 2026): kartica naloge z zivim seznamom korakov in vmesnimi izidi, Ustavi / Potrdi / Zavrni. Potrditev gre po poti
 * vprasanj agentov (zgostitev prikazanega vnosa, »Potrdi« z geslom). Med delom se osvezuje vsake 2 s, sicer vsakih 30 s.
 */
export function OrkestratorKartica() {
  const [st, setSt] = useState<StanjeOrkestratorja | null>(null);
  const [cilj, setCilj] = useState("");
  const [napaka, setNapaka] = useState("");
  const [zaposlen, setZaposlen] = useState(false);
  const osvezi = useCallback(() => {
    void stanjeOrkestratorjaFn().then(setSt).catch(() => undefined);
  }, []);
  useEffect(osvezi, [osvezi]);
  const dejavno = !!st?.naloge.some((n) => !KONCNE.includes(n.faza) && !n.nepreverjeno);
  useEffect(() => {
    const c = setInterval(osvezi, dejavno ? 2000 : 30_000);
    return () => clearInterval(c);
  }, [dejavno, osvezi]);

  async function ukaz(u: Record<string, unknown>): Promise<boolean> {
    setNapaka("");
    setZaposlen(true);
    try {
      const r = await ukazOrkestratorjaFn({ data: { ukaz: u } });
      if (r.ok) {
        setSt(r.stanje);
        return true;
      }
      setNapaka(r.razlog === "izklopljeno" ? t("orkIzklopljeno") : r.razlog === "geslo" ? t("vaGeslo") : t("orkNapaka"));
      osvezi();
      return false;
    } catch {
      setNapaka(t("orkNapaka"));
      return false;
    } finally {
      setZaposlen(false);
    }
  }

  if (!st) return null;
  return (
    <div className="lina-kartica min-w-0">
      <h3><Ikona ime="racunalnik" /> {t("orkNaslov")}</h3>
      <p className="text-sm text-[var(--color-moss)]">{st.vklopljen ? t("orkNamig") : t("orkIzklopljeno")}</p>
      {st.indeksObnovljen ? <p role="note" className="mt-2 text-sm text-[var(--color-signal)]">{t("orkIndeksObnovljen")}</p> : null}
      {st.vklopljen ? (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (cilj.trim()) void ukaz({ vrsta: "nova", cilj }).then((ok) => ok && setCilj(""));
          }}
        >
          <label className="grid gap-1 text-sm" htmlFor="ork-cilj">
            {t("orkNovaNamig")}
            <textarea id="ork-cilj" value={cilj} onChange={(e) => setCilj(e.target.value)} rows={2} maxLength={4000} className={POLJE} />
          </label>
          <button type="submit" disabled={zaposlen || !cilj.trim()} className="lina-gumb-majhen self-start">{t("orkZacni")}</button>
        </form>
      ) : null}
      {napaka ? <p role="alert" className="mt-2 text-sm text-[var(--color-signal)]">{napaka}</p> : null}
      {st.naloge.length === 0 ? <p className="mt-3 text-sm text-[var(--color-moss)]">{t("orkPrazno")}</p> : (
        <ul className="mt-3 flex flex-col gap-3">
          {st.naloge.map((n) => <NalogaOrk key={n.id} n={n} zaposlen={zaposlen} onUkaz={ukaz} />)}
        </ul>
      )}
    </div>
  );
}

function NalogaOrk({ n, zaposlen, onUkaz }: { n: Naloga; zaposlen: boolean; onUkaz: (u: Record<string, unknown>) => Promise<boolean> }) {
  const [odgovor, setOdgovor] = useState("");
  // naloga 14 N3: nepreverjena naloga je samo za branje (brez ustavi/odgovor/potrdi), izbris mozen
  const tece = !KONCNE.includes(n.faza) && !n.nepreverjeno;
  const ukazi = !n.nepreverjeno;
  return (
    <li className="rounded-xl border border-[var(--color-rule)] p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm font-medium">{n.cilj}</p>
        <span className="text-xs text-[var(--color-moss)]">{t(`orkF${n.faza}` as Beseda)}</span>
      </div>
      <p className="mt-1 text-xs text-[var(--color-moss)]">
        {datumInUra(new Date(n.zacetek))} · {t("orkKoraki")}: {n.koraki}/{n.proracun.najvecKorakov} · {t("orkPoraba")}: {n.poraba.vhod + n.poraba.izhod} {t("orkZetonov")}
        {n.poraba.ocenjeno ? ` (${t("orkOcena")})` : ""}
      </p>
      {n.okuzeno ? <p className="mt-1 text-xs text-[var(--color-signal)]">{t("orkOkuzeno")}</p> : null}
      {n.nepreverjeno ? <p className="mt-1 text-xs text-[var(--color-signal)]">{t("orkNepreverjeno")}</p> : null}
      <ol className="mt-2 max-h-64 overflow-auto text-xs" aria-live="polite">
        {n.dogodki.filter((d) => d.vrsta !== "korak-zacet" || d.orodje).slice(-30).map((d) => (
          <li key={d.st} className={d.vrsta === "vmesno" || d.vrsta === "nacrt" ? "font-medium" : "text-[var(--color-moss)]"}>
            {d.orodje ? `${d.orodje}: ` : ""}{d.besedilo}
          </li>
        ))}
      </ol>
      {n.potrditev ? (
        <div className="mt-2 rounded-lg border border-[var(--color-rule)] p-2">
          <p className="text-sm">{n.faza === "caka-lastnika" ? t("orkCakaLastnika") : t("orkCakaPotrditev")}: {n.cakanje?.orodje}</p>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs">{n.potrditev.predogled}</pre>
        </div>
      ) : null}
      {ukazi && n.faza === "caka-pomocnika" ? <p className="mt-2 text-sm">{t("orkCakaPomocnika")}</p> : null}
      {n.odgovor ? (
        <div className="mt-2">
          <p className="text-sm font-medium">{t("orkOdgovor")}</p>
          <p className="whitespace-pre-wrap break-words text-sm">{n.odgovor}</p>
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {ukazi && n.faza === "caka-potrditev" && n.potrditev ? (
          <>
            {n.potrditev.odrezano ? null : (
              <button type="button" disabled={zaposlen} className="rounded-full bg-[var(--color-signal)] px-4 py-1.5 text-sm text-[var(--color-on-ink)] disabled:opacity-50"
                onClick={() => void onUkaz({ vrsta: "potrdi", id: n.id, vprasanjeId: n.potrditev!.vprasanjeId, zgostitev: n.potrditev!.zgostitev })}>
                {t("orkPotrdi")}
              </button>
            )}
            <button type="button" disabled={zaposlen} className="lina-gumb-majhen"
              onClick={() => void onUkaz({ vrsta: "zavrni", id: n.id, vprasanjeId: n.potrditev!.vprasanjeId, zgostitev: n.potrditev!.zgostitev })}>
              {t("orkZavrni")}
            </button>
          </>
        ) : null}
        {ukazi && n.faza === "caka-lastnika" ? (
          <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); if (odgovor.trim()) void onUkaz({ vrsta: "odgovor", id: n.id, besedilo: odgovor }).then((ok) => ok && setOdgovor("")); }}>
            <label className="sr-only" htmlFor={`ork-odg-${n.id}`}>{t("orkOdgovorNamig")}</label>
            <input id={`ork-odg-${n.id}`} value={odgovor} onChange={(e) => setOdgovor(e.target.value)} maxLength={2000} placeholder={t("orkOdgovorNamig")} className={`${POLJE} min-w-0 flex-1`} />
            <button type="submit" disabled={zaposlen || !odgovor.trim()} className="lina-gumb-majhen">{t("orkOdgovori")}</button>
          </form>
        ) : null}
        {tece ? <button type="button" disabled={zaposlen} className="lina-gumb-majhen" onClick={() => void onUkaz({ vrsta: "ustavi", id: n.id })}>{t("orkUstavi")}</button>
          : <button type="button" disabled={zaposlen} className="lina-gumb-majhen" onClick={() => void onUkaz({ vrsta: "izbrisi", id: n.id })}>{t("orkIzbrisi")}</button>}
      </div>
    </li>
  );
}
