import { useCallback, useEffect, useRef, useState } from "react";
import { zdruziOsnutke } from "./avtonomija-osnutek.ts";
import { NACINI, VRSTE_OPRAVIL, type Nacin, type VrstaOpravila, type ZapisDnevnika } from "@/lib/lina/avtonomija.ts";
import type { JavnoStanje } from "@/lib/lina/avtonomija.server.ts";
import { tA } from "@/lib/lina/besedila-avtonomija.ts";
import { PodobneIzbira } from "@/components/podobne-izbira.tsx";
import { dnevnikAvtonomijeFn, stanjeAvtonomijeFn, ukazAvtonomijeFn } from "@/lib/lina/functions.ts";

/**
 * Samostojna opravila Line (lastnik 15. 11. 2026): uporabnik SAM doloci, kaj sme Lina opraviti brez vprasanja. Vse privzeto
 * izklopljeno; vsako pravilo ima datum izteka; »Ustavi vse« takoj ustavi vse. Pravila in seznam prejemnikov se spreminjajo samo
 * tukaj (seja lastnika); stevilke prejemnikov so prikazane maskirane. Kar ni povezano na delovanje, se ne prikaze.
 */
type Osnutek = { nacin: Nacin; veljaDo: string; najvecNaDan: string; okno: boolean; od: string; do: string };
type Dnevnik = { dnevnik: ZapisDnevnika[]; povzetek: { datum: string; besedilo: string } | null };

function cezDni(dni: number): string {
  const d = new Date(Date.now() + dni * 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function osnutekIz(p: JavnoStanje["pravila"][VrstaOpravila]): Osnutek {
  return { nacin: p.nacin, veljaDo: p.veljaDo ?? "", najvecNaDan: String(p.najvecNaDan), okno: Boolean(p.okno), od: p.okno?.od ?? "08:00", do: p.okno?.do ?? "18:00" };
}

const polje = "mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-[var(--color-sheet)] text-[var(--color-ink)] px-3 py-2";
const gumb = "w-fit rounded-xl border border-[var(--color-rule)] px-4 py-2 text-sm disabled:opacity-50";

export function Avtonomija({ onError }: { onError: (m: string) => void }) {
  const [s, setS] = useState<JavnoStanje | null>(null);
  const [dn, setDn] = useState<Dnevnik | null>(null);
  const [osnutki, setOsnutki] = useState<Record<string, Osnutek>>({});
  const [ura, setUra] = useState("08:00");
  const [zaposlen, setZaposlen] = useState(false);
  // »Velja tudi za vse podobne« (isto opravilo, ista povezava = isti prejemnik), privzeto obkljukano
  const [podobne, setPodobne] = useState(true);
  const [sporocilo, setSporocilo] = useState("");
  const [pIme, setPIme] = useState("");
  const [pStevilka, setPStevilka] = useState("");
  const [predloga, setPredloga] = useState("");
  const [izbPredloga, setIzbPredloga] = useState("");
  const [izbPrejemnik, setIzbPrejemnik] = useState("");
  // kljuci opravil (in »ura«), ki jih je lastnik spremenil, a jih se ni shranil: osvezitev jih ne sme prepisati (N11)
  const umazano = useRef<Set<string>>(new Set());

  const prevzemi = useCallback((n: JavnoStanje) => {
    setS(n);
    const streznik: Record<string, Osnutek> = Object.fromEntries(VRSTE_OPRAVIL.map((v) => [v, osnutekIz(n.pravila[v])]));
    setOsnutki((prej) => zdruziOsnutke(prej, streznik, umazano.current));
    if (!umazano.current.has("ura")) setUra(n.povzetekUra);
  }, []);

  const osvezi = useCallback(async () => {
    try {
      const [novo, dnevnik] = await Promise.all([stanjeAvtonomijeFn(), dnevnikAvtonomijeFn()]);
      prevzemi(novo);
      setDn(dnevnik as Dnevnik);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "");
    }
  }, [onError, prevzemi]);

  useEffect(() => {
    void osvezi();
    const id = setInterval(() => void osvezi(), 15_000);
    return () => clearInterval(id);
  }, [osvezi]);

  async function ukaz(u: Record<string, unknown>, uspeh = true): Promise<boolean> {
    setZaposlen(true);
    setSporocilo("");
    onError("");
    try {
      const novo = await ukazAvtonomijeFn({ data: { ukaz: u } });
      // shranjeno polje ni vec osnutek; ostali osnutki ostanejo
      if (u.ukaz === "pravilo") umazano.current.delete(String(u.vrsta));
      if (u.ukaz === "ura") umazano.current.delete("ura");
      prevzemi(novo);
      setDn((await dnevnikAvtonomijeFn()) as Dnevnik);
      if (uspeh) setSporocilo(tA("shranjeno"));
      return true;
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "");
      return false;
    } finally {
      setZaposlen(false);
    }
  }

  function shraniPravilo(v: VrstaOpravila) {
    const o = osnutki[v];
    if (!o) return;
    void ukaz({ ukaz: "pravilo", vrsta: v, nacin: o.nacin, veljaDo: o.nacin === "izklopljeno" ? null : o.veljaDo, najvecNaDan: o.najvecNaDan, okno: o.okno ? { od: o.od, do: o.do } : null });
  }

  function spremeni(v: VrstaOpravila, d: Partial<Osnutek>) {
    umazano.current.add(v);
    setOsnutki((prej) => {
      const nov = { ...prej[v], ...d };
      // pri vklopu ponudi datum izteka cez 30 dni; uporabnik ga lahko spremeni
      if (d.nacin && d.nacin !== "izklopljeno" && !nov.veljaDo) nov.veljaDo = cezDni(30);
      return { ...prej, [v]: nov };
    });
  }

  const imePredloge = (idp: string) => s?.predloge.find((p) => p.id === idp)?.besedilo ?? "";
  const imePrejemnika = (idp: string) => s?.prejemniki.find((p) => p.id === idp)?.ime ?? "";

  if (!s) return null;
  return (
    <section aria-labelledby="av-naslov" className="grid gap-3">
      <h3 id="av-naslov" className="text-lg">{tA("naslov")}</h3>
      <p className="text-sm text-[var(--color-moss)]">{tA("razlaga")}</p>
      {s.trdoIzklopljeno ? <p role="note" className="rounded-xl bg-[var(--color-sheet)] p-3 text-sm">{tA("trdoIzklopljeno")}</p> : null}
      {s.pokvarjeno ? (
        <div role="alert" className="grid gap-2 rounded-xl bg-[var(--color-sheet)] p-3 text-sm">
          <p>{tA("pokvarjeno")}</p>
          <button type="button" className={gumb} disabled={zaposlen} onClick={() => void ukaz({ ukaz: "ponastavi" })}>{tA("ponastavi")}</button>
        </div>
      ) : null}
      {!s.gesloNastavljeno ? <p role="note" className="rounded-xl bg-[var(--color-sheet)] p-3 text-sm">{tA("gesloPotrebno")}</p> : null}
      {s.ustavljeno && !s.pokvarjeno ? (
        <div role="alert" className="grid gap-2 rounded-xl border border-[var(--color-signal)] p-3 text-sm">
          <p>{tA("ustavljenoOpozorilo")}</p>
          <button type="button" className={gumb} disabled={zaposlen} onClick={() => void ukaz({ ukaz: "nadaljuj" })}>{tA("nadaljuj")}</button>
        </div>
      ) : (
        <button type="button" disabled={zaposlen || s.pokvarjeno} onClick={() => void ukaz({ ukaz: "ustavi" }, false)} className="w-fit rounded-xl border border-[var(--color-signal)] px-4 py-2 text-sm text-[var(--color-signal)] disabled:opacity-50">
          {tA("ustaviVse")}
        </button>
      )}

      {s.cakajoca.length > 0 ? (
        <div className="grid gap-2" aria-live="polite">
          <h4 className="text-base">{tA("cakajoca")}</h4>
          <ul className="grid gap-2 text-sm">
            {s.cakajoca.map((c) => (
              <li key={c.id} className="grid gap-1 rounded-xl border border-[var(--color-rule)] p-3">
                <span>{tA(`opravilo_${c.vrsta}`)}{c.prejemnik ? `: ${c.prejemnik}` : ""}</span>
                {c.predloga ? <span className="text-[var(--color-moss)]">»{c.predloga}«</span> : null}
                <span className="text-xs text-[var(--color-moss)]">{tA("poteceDo")}: {new Date(c.poteceDo).toLocaleTimeString()}</span>
                <span className="flex gap-2">
                  <button type="button" className={gumb} disabled={zaposlen} onClick={() => void ukaz({ ukaz: "odobri", id: c.id, podobne }, false)}>{tA("odobri")}</button>
                  <button type="button" className={gumb} disabled={zaposlen} onClick={() => void ukaz({ ukaz: "odkloni", id: c.id }, false)}>{tA("odkloni")}</button>
                </span>
                <PodobneIzbira id={`podobne-avt-${c.id}`} izbrano={podobne} onIzbira={setPodobne} onemogoceno={zaposlen} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {VRSTE_OPRAVIL.map((v) => {
        const o = osnutki[v];
        if (!o) return null;
        return (
          <form key={v} className="grid gap-2 rounded-xl border border-[var(--color-rule)] p-3 text-sm" onSubmit={(e) => { e.preventDefault(); shraniPravilo(v); }}>
            <h4 className="text-base">{tA(`opravilo_${v}`)}</h4>
            <p className="text-[var(--color-moss)]">{tA(`opis_${v}`)}</p>
            <label htmlFor={`av-${v}-nacin`}>
              {tA("nacin")}
              <select id={`av-${v}-nacin`} className={polje} value={o.nacin} onChange={(e) => spremeni(v, { nacin: e.target.value as Nacin })}>
                {NACINI.map((n) => <option key={n} value={n}>{tA(`nacin_${n}`)}</option>)}
              </select>
            </label>
            {o.nacin === "samodejno" ? <p role="note" className="rounded-xl bg-[var(--color-sheet)] p-3">{tA("samodejnoOpozorilo")}</p> : null}
            {o.nacin !== "izklopljeno" ? (
              <>
                <label htmlFor={`av-${v}-do`}>
                  {tA("veljaDo")}
                  <input id={`av-${v}-do`} type="date" required className={polje} value={o.veljaDo} min={cezDni(0)} max={cezDni(s.meje.najdaljsiIztekDni)} onChange={(e) => spremeni(v, { veljaDo: e.target.value })} />
                </label>
                <label htmlFor={`av-${v}-meja`}>
                  {tA("najvecNaDan")}
                  <input id={`av-${v}-meja`} type="number" inputMode="numeric" min={1} max={s.meje.najvecNaDan} step={1} className={polje} value={o.najvecNaDan} onChange={(e) => spremeni(v, { najvecNaDan: e.target.value })} />
                </label>
                <label className="flex items-start gap-2" htmlFor={`av-${v}-okno`}>
                  <input id={`av-${v}-okno`} type="checkbox" className="mt-1 h-5 w-5" checked={o.okno} onChange={(e) => spremeni(v, { okno: e.target.checked })} />
                  <span>{tA("okno")}</span>
                </label>
                {o.okno ? (
                  <div className="grid grid-cols-2 gap-2">
                    <label htmlFor={`av-${v}-od`}>{tA("oknoOd")}<input id={`av-${v}-od`} type="time" className={polje} value={o.od} onChange={(e) => spremeni(v, { od: e.target.value })} /></label>
                    <label htmlFor={`av-${v}-oknodo`}>{tA("oknoDo")}<input id={`av-${v}-oknodo`} type="time" className={polje} value={o.do} onChange={(e) => spremeni(v, { do: e.target.value })} /></label>
                  </div>
                ) : null}
              </>
            ) : null}
            {s.pravila[v].dosezeno ? <p role="note" className="rounded-xl bg-[var(--color-sheet)] p-3">{tA("omejitevDosezena")}</p> : null}
            <p className="text-xs text-[var(--color-moss)]">{tA("poraba")}: {s.pravila[v].danes}</p>
            <button type="submit" disabled={zaposlen || s.pokvarjeno} className={gumb}>{tA("shrani")}</button>
          </form>
        );
      })}

      <form className="grid gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); void ukaz({ ukaz: "ura", ura }); }}>
        <label htmlFor="av-ura">
          {tA("uraPovzetka")}
          <input id="av-ura" type="time" className={polje} value={ura} onChange={(e) => { umazano.current.add("ura"); setUra(e.target.value); }} />
        </label>
        <button type="submit" disabled={zaposlen || s.pokvarjeno} className={gumb}>{tA("shrani")}</button>
      </form>

      <div className="grid gap-2 text-sm">
        <h4 className="text-base">{tA("prejemniki")}</h4>
        <p className="text-[var(--color-moss)]">{tA("prejemnikiNamig")}</p>
        {s.prejemniki.length === 0 ? <p>{tA("prejemnikiPrazno")}</p> : (
          <ul className="grid gap-1">
            {s.prejemniki.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span>{p.ime} ({p.maska})</span>
                <button type="button" className={gumb} disabled={zaposlen} onClick={() => void ukaz({ ukaz: "prejemnik-odstrani", id: p.id })}>{tA("odstrani")}</button>
              </li>
            ))}
          </ul>
        )}
        <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); void ukaz({ ukaz: "prejemnik-dodaj", ime: pIme, stevilka: pStevilka }).then((ok) => { if (ok) { setPIme(""); setPStevilka(""); } }); }}>
          <label htmlFor="av-pime">{tA("prejemnikIme")}<input id="av-pime" className={polje} autoComplete="off" value={pIme} onChange={(e) => setPIme(e.target.value)} /></label>
          <label htmlFor="av-pstev">{tA("prejemnikStevilka")}<input id="av-pstev" type="tel" inputMode="tel" autoComplete="off" className={polje} value={pStevilka} onChange={(e) => setPStevilka(e.target.value)} /></label>
          <button type="submit" disabled={zaposlen || s.pokvarjeno || s.prejemniki.length >= s.meje.prejemnikov} className={gumb}>{tA("dodaj")}</button>
        </form>
      </div>

      <div className="grid gap-2 text-sm">
        <h4 className="text-base">{tA("predloge")}</h4>
        {s.predloge.length === 0 ? <p>{tA("predlogePrazno")}</p> : (
          <ul className="grid gap-1">
            {s.predloge.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span>»{p.besedilo}«</span>
                <button type="button" className={gumb} disabled={zaposlen} onClick={() => void ukaz({ ukaz: "predloga-odstrani", id: p.id })}>{tA("odstrani")}</button>
              </li>
            ))}
          </ul>
        )}
        <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); void ukaz({ ukaz: "predloga-dodaj", besedilo: predloga }).then((ok) => { if (ok) setPredloga(""); }); }}>
          <label htmlFor="av-pred">{tA("predlogaBesedilo")}<input id="av-pred" className={polje} maxLength={160} autoComplete="off" value={predloga} onChange={(e) => setPredloga(e.target.value)} /></label>
          <button type="submit" disabled={zaposlen || s.pokvarjeno || s.predloge.length >= s.meje.predlog} className={gumb}>{tA("dodaj")}</button>
        </form>
      </div>

      <div className="grid gap-2 text-sm">
        <h4 className="text-base">{tA("povezave")}</h4>
        {s.povezave.length === 0 ? <p>{tA("povezavePrazno")}</p> : (
          <ul className="grid gap-1">
            {s.povezave.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span>{tA("povezavaNaslov")} »{imePredloge(p.predlogaId)}« {tA("povezavaPrejemniku")} {imePrejemnika(p.prejemnikId)}</span>
                <button type="button" className={gumb} disabled={zaposlen} onClick={() => void ukaz({ ukaz: "povezava-odstrani", id: p.id })}>{tA("odstrani")}</button>
              </li>
            ))}
          </ul>
        )}
        {s.predloge.length > 0 && s.prejemniki.length > 0 ? (
          <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); void ukaz({ ukaz: "povezava-dodaj", predlogaId: izbPredloga || s.predloge[0].id, prejemnikId: izbPrejemnik || s.prejemniki[0].id }); }}>
            <label htmlFor="av-izbpred">{tA("povezavaNaslov")}
              <select id="av-izbpred" className={polje} value={izbPredloga || s.predloge[0].id} onChange={(e) => setIzbPredloga(e.target.value)}>
                {s.predloge.map((p) => <option key={p.id} value={p.id}>{p.besedilo}</option>)}
              </select>
            </label>
            <label htmlFor="av-izbprej">{tA("povezavaPrejemniku")}
              <select id="av-izbprej" className={polje} value={izbPrejemnik || s.prejemniki[0].id} onChange={(e) => setIzbPrejemnik(e.target.value)}>
                {s.prejemniki.map((p) => <option key={p.id} value={p.id}>{p.ime}</option>)}
              </select>
            </label>
            <button type="submit" disabled={zaposlen || s.pokvarjeno || s.povezave.length >= s.meje.povezav} className={gumb}>{tA("dodaj")}</button>
          </form>
        ) : <p className="text-[var(--color-moss)]">{tA("povezaveNamig")}</p>}
      </div>

      {sporocilo ? <p role="status" className="text-sm">{sporocilo}</p> : null}

      {dn?.povzetek ? (
        <div className="grid gap-1 text-sm">
          <h4 className="text-base">{tA("zadnjiPovzetek")} ({dn.povzetek.datum})</h4>
          <pre className="whitespace-pre-wrap rounded-xl bg-[var(--color-sheet)] p-3 text-xs">{dn.povzetek.besedilo}</pre>
        </div>
      ) : null}

      <div className="grid gap-1 text-sm">
        <h4 className="text-base">{tA("dnevnik")}</h4>
        <p className="text-xs text-[var(--color-moss)]">{tA("dnevnikNamig")}</p>
        {!dn || dn.dnevnik.length === 0 ? <p>{tA("dnevnikPrazno")}</p> : (
          <ul className="grid gap-1 text-xs">
            {dn.dnevnik.slice(0, 20).map((z) => (
              <li key={z.id}>
                {new Date(z.t).toLocaleString()} - {z.opravilo === "sistem" ? tA("sistem") : tA(`opravilo_${z.opravilo}`)}: {tA(`izid_${z.izid}`)}{z.razlog ? ` (${tA(`razlog_${z.razlog}`)})` : ""}
              </li>
            ))}
          </ul>
        )}
        <button type="button" className={gumb} onClick={() => void osvezi()}>{tA("osvezi")}</button>
      </div>
    </section>
  );
}
