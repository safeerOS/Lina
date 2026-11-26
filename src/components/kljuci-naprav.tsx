import { useEffect, useId, useState } from "react";
import { GUMB, GUMB_OBROBA, NAMIG, OZNAKA_POLJA, POLJE, Podrazdelek, Razdelek } from "@/components/ui-lina.tsx";
import { tK } from "@/lib/lina/besedila-kljuci.ts";
import { dodajKljucMozganovFn, pregledKljucevFn, readBrainFn, urediKljucMozganovFn } from "@/lib/lina/functions.ts";
import { IME_PONUDNIKA, type BrainPublic } from "@/lib/lina/types.ts";

/**
 * NALOGA-35 (lastnik 26. 11. 2026): kljuci za mozgane na vseh seznanjenih napravah. Vec kljucev hkrati (tudi istega ponudnika, z
 * oznako); na zaslonu samo oznaka, ponudnik in zadnji 4 znaki. »Uporabi« velja za ta racunalnik; odstranitev na vseh napravah.
 * Izbira ponudnika za klice in asistentko ostane v razdelkih nad tem (ta razdelek je ne spremeni).
 */
type Pregled = Awaited<ReturnType<typeof pregledKljucevFn>>;
const PONUDNIKI = ["gemini", "openai", "claude", "grok", "openrouter"] as const;

function napaka(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function KljuciNaprav({
  busy,
  onBrain,
  onError,
  onBusy,
}: {
  busy: boolean;
  onBrain: (brain: BrainPublic) => void;
  onError: (message: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [pregled, setPregled] = useState<Pregled | null>(null);
  const [ponudnik, setPonudnik] = useState<(typeof PONUDNIKI)[number]>("gemini");
  const [oznaka, setOznaka] = useState("");
  const [kljuc, setKljuc] = useState("");
  const [ureja, setUreja] = useState<{ id: string; oznaka: string } | null>(null);
  const idPonudnik = useId();
  const idOznaka = useId();
  const idKljuc = useId();

  useEffect(() => {
    let konec = false;
    pregledKljucevFn().then((p) => !konec && setPregled(p), (e) => !konec && onError(napaka(e)));
    // kljuc, dodan ali odstranjen na telefonu, se pokaze brez gumba (zahteva: sprememba se zazna sama); napaka osvezitve je tiha
    const t = window.setInterval(() => void pregledKljucevFn().then((p) => !konec && setPregled(p), () => undefined), 30_000);
    return () => {
      konec = true;
      window.clearInterval(t);
    };
  }, [onError]);

  /** true = uspelo (urejanje se zapre samo takrat, sicer vnos ostane). */
  async function izvedi(delo: () => Promise<Pregled>): Promise<boolean> {
    onBusy(true);
    onError("");
    try {
      setPregled(await delo());
      onBrain(await readBrainFn());
      return true;
    } catch (cause) {
      onError(napaka(cause));
      return false;
    } finally {
      onBusy(false);
    }
  }

  const uredi = (dejanje: "uporabi" | "odstrani" | "preimenuj" | "potrdi", id?: string, nova?: string) =>
    izvedi(() => urediKljucMozganovFn({ data: { dejanje, id, oznaka: nova } }));

  const kljuci = pregled?.kljuci ?? [];
  const odstranjeni = pregled?.odstranjeni ?? [];

  return (
    <Razdelek id="nast-kljuci-naprav" naslov={tK("naslov")} opis={tK("opis")}>
      {odstranjeni.length > 0 ? (
        <div className="mb-4" role="alert">
          <p className="text-sm text-[var(--color-signal)]">{tK("odstranjen", { ponudniki: odstranjeni.map((p) => IME_PONUDNIKA[p] ?? p).join(", ") })}</p>
          <button type="button" className={`${GUMB_OBROBA} mt-2`} disabled={busy} onClick={() => uredi("potrdi")}>
            {tK("vRedu")}
          </button>
        </div>
      ) : null}
      {kljuci.length === 0 ? (
        <p className="text-sm text-[var(--color-moss)]">{tK("prazno")}</p>
      ) : (
        <ul className="grid gap-3">
          {kljuci.map((k) => (
            <li key={k.id} className="border-t border-[var(--color-rule)] pt-3 first:border-t-0 first:pt-0">
              <p className="text-sm text-[var(--color-ink)]">
                <span className="font-medium">{k.oznaka}</span> · {IME_PONUDNIKA[k.ponudnik] ?? k.ponudnik} · <span className="font-mono">{k.namig}</span>
                {k.vUporabi ? <span className="ml-2 text-[var(--color-moss)]">({tK("vUporabi")})</span> : null}
              </p>
              <p className="text-xs text-[var(--color-moss)]">
                {tK("spremenil", { naprava: k.naprava === "jaz" ? tK("taRacunalnik") : k.naprava || tK("drugaNaprava") })}
              </p>
              {ureja?.id === k.id ? (
                <form
                  className="mt-2 flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void uredi("preimenuj", k.id, ureja.oznaka).then((ok) => ok && setUreja(null));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setUreja(null);
                  }}
                >
                  <label className={OZNAKA_POLJA}>
                    {tK("oznaka")}
                    {/* eslint-disable-next-line jsx-a11y/no-autofocus -- fokus gre v polje, ki ga je odprl gumb Preimenuj */}
                    <input className={POLJE} value={ureja.oznaka} maxLength={40} autoFocus onChange={(e) => setUreja({ id: k.id, oznaka: e.target.value })} />
                  </label>
                  <button type="submit" className={GUMB} disabled={busy}>
                    {tK("shraniOznako")}
                  </button>
                  <button type="button" className={GUMB_OBROBA} onClick={() => setUreja(null)}>
                    {tK("preklici")}
                  </button>
                </form>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {!k.vUporabi ? (
                    <button type="button" className={GUMB_OBROBA} disabled={busy} onClick={() => uredi("uporabi", k.id)} aria-label={`${tK("uporabi")}: ${k.oznaka}`}>
                      {tK("uporabi")}
                    </button>
                  ) : null}
                  <button type="button" className={GUMB_OBROBA} disabled={busy} onClick={() => setUreja({ id: k.id, oznaka: k.oznaka })} aria-label={`${tK("preimenuj")}: ${k.oznaka}`}>
                    {tK("preimenuj")}
                  </button>
                  <button
                    type="button"
                    className={GUMB_OBROBA}
                    disabled={busy}
                    aria-label={`${tK("odstrani")}: ${k.oznaka}`}
                    onClick={() => {
                      if (window.confirm(tK("potrdiOdstranitev", { oznaka: k.oznaka }))) void uredi("odstrani", k.id);
                    }}
                  >
                    {tK("odstrani")}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Podrazdelek naslov={tK("dodajNaslov")} id="kljuci-naprav-dodaj">
        <form
          className="grid gap-3 sm:max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            void izvedi(() => dodajKljucMozganovFn({ data: { ponudnik, oznaka, kljuc } })).then((ok) => {
              if (!ok) return;
              setOznaka("");
              setKljuc("");
            });
          }}
        >
          <label htmlFor={idPonudnik} className={OZNAKA_POLJA}>
            {tK("ponudnik")}
          </label>
          <select id={idPonudnik} className={POLJE} value={ponudnik} onChange={(e) => setPonudnik(e.target.value as (typeof PONUDNIKI)[number])}>
            {PONUDNIKI.map((p) => (
              <option key={p} value={p}>
                {IME_PONUDNIKA[p] ?? p}
              </option>
            ))}
          </select>
          <label htmlFor={idOznaka} className={OZNAKA_POLJA}>
            {tK("oznaka")}
          </label>
          <input id={idOznaka} className={POLJE} value={oznaka} maxLength={40} onChange={(e) => setOznaka(e.target.value)} aria-describedby={`${idOznaka}-namig`} />
          <span id={`${idOznaka}-namig`} className={NAMIG}>
            {tK("oznakaNamig")}
          </span>
          <label htmlFor={idKljuc} className={OZNAKA_POLJA}>
            {tK("kljuc")}
          </label>
          <input id={idKljuc} className={POLJE} type="password" autoComplete="off" value={kljuc} maxLength={400} onChange={(e) => setKljuc(e.target.value)} />
          <div>
            <button type="submit" className={GUMB} disabled={busy || !oznaka.trim() || kljuc.trim().length < 8}>
              {tK("dodaj")}
            </button>
          </div>
        </form>
      </Podrazdelek>
    </Razdelek>
  );
}
