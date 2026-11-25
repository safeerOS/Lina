import { useEffect, useState } from "react";
import { t } from "@/lib/lina/besedila.ts";
import { idVSkupinah } from "@/lib/lina/id-naprave.ts";
import {
  odkleniPovezovanjeFn, odlociSeznanitevFn, potrdiIdSeznanitveFn, odstraniNapravoFn, shraniAsistentaFn, stanjeAsistentaFn, vnesiKodoTelefonaFn, zacniSeznanitevFn,
  zacniSeznanitevSKodoFn, zapriSeznanitevSKodoFn,
} from "@/lib/lina/functions.ts";

type Stanje = Awaited<ReturnType<typeof stanjeAsistentaFn>>;
type Povabilo = Awaited<ReturnType<typeof zacniSeznanitevFn>>;

/** Id telefona v skupinah po 4 (isti niz kot na telefonu, T6-04): lastnik pri »Dodaj« ne zaupa samo imenu. */
function IdTelefona({ id }: { id: string }) {
  const niz = idVSkupinah(id);
  // N2: neveljaven id se nikoli ne pokaze surov (bidi, nicelna sirina, cirilica ... bi ga naredili podobnega pravemu); opozorilo
  // namesto njega, gumb »Dodaj« pa je blokiran (idTelefonaVeljaven).
  if (niz === null) return <p role="alert" className="text-sm text-[var(--color-signal)]">{t("telIdNeveljaven")}</p>;
  return (
    <p className="text-sm">
      {t("telIdPreveri")}{" "}
      <strong className="font-mono text-lg tracking-wider" aria-label={niz.split("").join(" ")}>{niz}</strong>
    </p>
  );
}

/**
 * Zaslon »Poveži telefon« (lastnik 14. 11. 2026): en QR za obe poti (klici OpenLine in asistentka), potrditev telefona z enim
 * gumbom (ime in id n-...). Privzeto izklopljeno; naslov samo izmed zasebnih naslovov tega racunalnika.
 */
export function PoveziTelefon({ onError }: { onError: (m: string) => void }) {
  const [s, setS] = useState<Stanje | null>(null);
  const [naslov, setNaslov] = useState("");
  const [vrata, setVrata] = useState("");
  const [povabilo, setPovabilo] = useState<Povabilo | null>(null);
  const [zaposlen, setZaposlen] = useState(false);
  const [lokalna, setLokalna] = useState("");
  const [kodaTel, setKodaTel] = useState<Record<string, string>>({});

  function prevzemi(x: Stanje) {
    setS(x);
    setNaslov(x.naslov);
    setVrata(String(x.vrata));
  }

  useEffect(() => {
    void stanjeAsistentaFn().then(prevzemi).catch(() => setS(null));
  }, []);

  // med cakanjem na telefon osvezi stanje (prijava telefona, seja Claude Code)
  useEffect(() => {
    if (!s?.tece) return;
    const i = setInterval(() => { void stanjeAsistentaFn().then(setS).catch(() => undefined); }, 3000);
    return () => clearInterval(i);
  }, [s?.tece]);

  async function izvedi(delo: () => Promise<void>) {
    setZaposlen(true);
    onError("");
    setLokalna("");
    try {
      await delo();
    } catch (cause) {
      const m = cause instanceof Error ? cause.message : "";
      setLokalna(m);
      onError(m);
    } finally {
      setZaposlen(false);
    }
  }

  if (!s) return null;
  const gumb = "w-fit rounded-xl border border-[var(--color-rule)] px-4 py-2 text-sm disabled:opacity-50";
  const polje = "mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-[var(--color-sheet)] text-[var(--color-ink)] px-3 py-2";
  return (
    <section aria-labelledby="pt-naslov" className="grid gap-3">
      <h3 id="pt-naslov" className="text-lg">{t("telNaslov")}</h3>
      <p className="text-sm text-[var(--color-moss)]">{t("telRazlaga")}</p>
      <form
        className="grid gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void izvedi(async () => prevzemi(await shraniAsistentaFn({ data: { vklop: s.vklop, naslov, vrata: Number(vrata) } })));
        }}
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={s.vklop}
            disabled={zaposlen}
            onChange={(e) => void izvedi(async () => prevzemi(await shraniAsistentaFn({ data: { vklop: e.target.checked, naslov, vrata: Number(vrata) } })))}
          />
          {t("telVklop")}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={s.ocenaIzida}
            disabled={zaposlen}
            aria-describedby="pt-ocena-namig"
            onChange={(e) => void izvedi(async () => prevzemi(await shraniAsistentaFn({ data: { ocenaIzida: e.target.checked } })))}
          />
          {t("telOcenaIzida")}
        </label>
        <p id="pt-ocena-namig" className="text-xs text-[var(--color-moss)]">{t("telOcenaIzidaNamig")}</p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={s.globalLink}
            disabled={zaposlen}
            aria-describedby="pt-global-namig"
            onChange={(e) => void izvedi(async () => prevzemi(await shraniAsistentaFn({ data: { globalLink: e.target.checked } })))}
          />
          {t("telGlobalLink")}
        </label>
        <p id="pt-global-namig" className="text-xs text-[var(--color-moss)]">{t("telGlobalLinkNamig")}</p>
        {s.globalLink && (
          <p className="text-xs" role="status">{t("telGlobalLinkStanje")}{t(`telGlobalLink_${s.globalLinkStanje}`)}</p>
        )}
        <label htmlFor="pt-naslov-rac">
          {t("telNaslovRac")}
          <select id="pt-naslov-rac" value={naslov} onChange={(e) => setNaslov(e.target.value)} className={polje}>
            {s.naslovi.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label htmlFor="pt-vrata">
          {t("telVrata")}
          <input id="pt-vrata" type="number" inputMode="numeric" min={1024} max={65535} value={vrata} onChange={(e) => setVrata(e.target.value)} className={polje} />
        </label>
        <button type="submit" disabled={zaposlen} className={gumb}>{t("telShrani")}</button>
      </form>
      {s.tece ? (
        <>
          <p className="text-sm">{t("telTece")} {s.naslov}:{s.vrata}</p>
          <p className="text-sm">{s.claudeCode ? t("telClaudeOdprt") : t("telClaudeZaprt")}</p>
          <button type="button" disabled={zaposlen} className={gumb} onClick={() => izvedi(async () => setPovabilo(await zacniSeznanitevFn()))}>
            {t("telPokaziQr")}
          </button>
          <button type="button" disabled={zaposlen} className={gumb} onClick={() => izvedi(async () => { await zacniSeznanitevSKodoFn(); setS(await stanjeAsistentaFn()); })}>
            {t("telPoveziSKodo")}
          </button>
          {s.sKodo.zaprtoSe ? (
            <div className="grid gap-2">
              <p role="status" className="text-sm text-[var(--color-signal)]">{t("telKodaZaprto")} {Math.ceil(s.sKodo.zaprtoSe / 60)}</p>
              <button type="button" disabled={zaposlen} className={gumb} onClick={() => izvedi(async () => setS(await odkleniPovezovanjeFn()))}>
                {t("telOdkleni")}
              </button>
            </div>
          ) : null}
          {s.opozoriloKlicev ? <p role="alert" className="text-sm text-[var(--color-signal)]">{s.opozoriloKlicev}</p> : null}
          {s.sKodo.odprto ? (
            <div className="grid gap-2 text-sm">
              {/* koda v dveh skupinah po tri, bralnik zaslona jo prebere po stevkah */}
              <p className="text-3xl tracking-widest" aria-label={s.sKodo.koda.split("").join(" ")}>{s.sKodo.koda.slice(0, 3)} {s.sKodo.koda.slice(3)}</p>
              <p className="text-[var(--color-moss)]">{t("telKodaRazlaga")}</p>
              {s.sKodo.oglas ? <p>{t("telKodaOglas")} <strong>{s.sKodo.oglas}</strong></p> : null}
              <button type="button" disabled={zaposlen} className={gumb} onClick={() => izvedi(async () => setS(await zapriSeznanitevSKodoFn()))}>
                {t("telKodaZapri")}
              </button>
            </div>
          ) : null}
          {s.sKodo.cakajoKodo.map((c) => (
            <form
              key={c.pairId}
              className="grid gap-1 rounded-xl border border-[var(--color-rule)] p-3 text-sm"
              onSubmit={(e) => {
                e.preventDefault();
                void izvedi(async () => setS(await vnesiKodoTelefonaFn({ data: { pairId: c.pairId, koda: kodaTel[c.pairId] ?? "" } })));
              }}
            >
              <p>{t("telKodaCaka")}: <strong>{c.ime}</strong></p>
              <IdTelefona id={c.id} />
              {c.napacna ? <p role="alert" className="text-[var(--color-signal)]">{t("telKodaNapacna")}</p> : null}
              <label htmlFor={`pt-koda-${c.pairId}`}>
                {t("telKodaVnesi")}
                <input
                  id={`pt-koda-${c.pairId}`}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  value={kodaTel[c.pairId] ?? ""}
                  onChange={(e) => setKodaTel({ ...kodaTel, [c.pairId]: e.target.value })}
                  className={polje}
                />
              </label>
              <button type="submit" disabled={zaposlen || idVSkupinah(c.id) === null || !/^\d{3}\s?\d{3}$/.test(kodaTel[c.pairId] ?? "")} className={gumb}>{t("telKodaPotrdi")}</button>
            </form>
          ))}
          {povabilo ? (
            <figure className="grid gap-2">
              {/* SVG iz lastnega kodirnika (qr.ts): samo pravokotniki, brez skript */}
              <div aria-label={t("telPokaziQr")} className="w-fit" dangerouslySetInnerHTML={{ __html: povabilo.svg }} />
              <figcaption className="text-sm text-[var(--color-moss)]">
                {t("telQrRazlaga")} {povabilo.klici ? t("telQrKlici") : t("telQrBrezKlicev")}
              </figcaption>
              {povabilo.opozorilo ? <p role="alert" className="text-sm text-[var(--color-signal)]">{povabilo.opozorilo}</p> : null}
            </figure>
          ) : null}
        </>
      ) : (
        <p className="text-sm">{s.napaka || t("telNeTece")}</p>
      )}
      {s.cakajo.map((c) => {
        // N5d: tudi clan ozjega kroga Safeer Linka vidi id in ga potrdi (telefon za Lino vedno zahteva dotik »ID se ujema«, zato bi
        // bilo potrjevanje brez primerjave slepo); opomba samo pove, zakaj. Streznik preskoka ne dovoli (PRESKOK_PRIMERJAVE_ZA_CLANE).
        const clan = s.ozjiKrog.includes(c.koda);
        return (
        <div key={c.koda} role="group" aria-label={t("telCaka")} className="grid gap-1 rounded-xl border border-[var(--color-rule)] p-3 text-sm">
          <p>{t("telCaka")}: <strong>{c.ime}</strong></p>
          {clan ? <p className="text-sm text-[var(--color-moss)]">{t("telClanPrimerjaj")}</p> : null}
          <IdTelefona id={c.id} />
          <div className="flex gap-2">
            <button type="button" disabled={zaposlen || idVSkupinah(c.id) === null} className={gumb} onClick={() => izvedi(async () => { await potrdiIdSeznanitveFn({ data: { koda: c.koda, id: c.id } }); setS(await odlociSeznanitevFn({ data: { koda: c.koda, sprejmi: true } })); setPovabilo(null); })}>
              {t("telIdSeDujemaDodaj")}
            </button>
            <button type="button" disabled={zaposlen} className={gumb} onClick={() => izvedi(async () => setS(await odlociSeznanitevFn({ data: { koda: c.koda, sprejmi: false } })))}>
              {t("telZavrni")}
            </button>
          </div>
        </div>
        );
      })}
      <h4 className="text-base">{t("telNaprave")}</h4>
      {s.naprave.length ? (
        <ul className="grid gap-1 text-sm">
          {s.naprave.map((n) => (
            <li key={n.id} className="flex items-center gap-2">
              <span>{n.ime || t("telBrezImena")} ({n.id})</span>
              <button type="button" disabled={zaposlen} className={gumb} onClick={() => izvedi(async () => setS(await odstraniNapravoFn({ data: { id: n.id } })))}>
                {t("telOdstrani")}
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm">{t("telNiNaprav")}</p>}
      <h4 className="text-base">{t("telOpenLine")}</h4>
      {/* Pot klicev (OpenLine) tece v tej aplikaciji in se zazene sama ob dodajanju telefona: lastnik ne vpisuje nic (lastnik 21. 11. 2026). */}
      <p className="text-sm" role="status">
        {s.klicevSePripravlja ? t("telOpenLinePripravlja") : s.openLine.povezan ? `${t("telOpenLinePovezan")} (${s.openLine.vrata})` : t("telOpenLineSama")}
      </p>
      {lokalna ? <p role="alert" className="text-sm text-[var(--color-signal)]">{lokalna}</p> : null}
    </section>
  );
}
