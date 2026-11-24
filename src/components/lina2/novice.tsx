import { useCallback, useEffect, useState } from "react";
import { jezikVmesnika, t } from "@/lib/lina/besedila.ts";
import { noviceBeriFn, noviceDodajVirFn, noviceOceniFn, noviceOdstraniVirFn, noviceOsveziFn, noviceShraniFn } from "@/lib/lina/functions.ts";
import { MEJA_KATEGORIJE, MEJA_ZANIMANJ, ocenaPostavke, relativniCas, type Postavka, type VrstaVira } from "@/lib/lina/novice.ts";

type Pogled = Awaited<ReturnType<typeof noviceBeriFn>>;
type Zavihek = "pregled" | "vse" | "viri";
type Zaposlen = "" | "osvezi" | "oceni" | "dodaj" | "shrani";

const VRSTE: Array<{ id: VrstaVira; oznaka: () => string }> = [
  { id: "rss", oznaka: () => t("novVrstaRss") },
  { id: "reddit", oznaka: () => t("novVrstaReddit") },
  { id: "youtube", oznaka: () => t("novVrstaYoutube") },
  { id: "hn", oznaka: () => t("novVrstaHn") },
];

function oznakaVrste(v: VrstaVira): string {
  return VRSTE.find((x) => x.id === v)?.oznaka() ?? v;
}

function namigVnosa(v: VrstaVira): string {
  return v === "reddit" ? t("novVnosReddit") : v === "youtube" ? t("novVnosYoutube") : t("novVnosRss");
}

/** Razlog napake vira v ljudski besedi (kode so iz strezniskega prenosa). */
function opisNapake(koda: string, status?: number): string {
  switch (koda) {
    case "naslov":
      return t("novNapNaslov");
    case "zasebno":
      return t("novNapZasebno");
    case "rok":
      return t("novNapRok");
    case "status":
      return status ? `${t("novNapStatus")} (${status})` : t("novNapStatus");
    case "oblika":
      return t("novNapOblika");
    case "skoki":
      return t("novNapSkoki");
    default:
      return t("novNapOmrezje");
  }
}

/** Povezava se pokaze kot povezava samo, ce je http(s); sicer kot navadno besedilo. */
const jeSpletna = (s: string): boolean => /^https?:\/\//i.test(s);

function Vrstica({ p, zdaj }: { p: Postavka; zdaj: Date | null }) {
  const ocena = zdaj ? ocenaPostavke(p, zdaj) : (p.ocena ?? 0);
  const meta = [
    p.vir,
    p.kategorija,
    zdaj ? relativniCas(p.cas, zdaj, jezikVmesnika()) : "",
    p.tocke !== null ? `${p.tocke} ${t("novTocke")}` : "",
    p.komentarji !== null ? `${p.komentarji} ${t("novKomentarji")}` : "",
    p.tudi.length ? `${t("novTudi")} ${p.tudi.join(", ")}` : "",
  ].filter(Boolean);
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <span className="lina-znacka shrink-0" title={p.ocena !== null ? t("novOcenaModela") : t("novOsnovnaOcena")} data-ocenjeno={p.ocena !== null}>
          {ocena.toFixed(1)}
        </span>
        <div className="min-w-0 flex-1">
          {jeSpletna(p.povezava) ? (
            <a href={p.povezava} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold hover:underline">
              {p.naslov}
            </a>
          ) : (
            <span className="text-sm font-semibold">{p.naslov}</span>
          )}
          {p.povzetek ? <p className="mt-0.5 text-sm text-[var(--color-moss)]">{p.povzetek}</p> : null}
          <p className="mt-0.5 text-xs text-[var(--color-brass)]">{meta.join(" · ")}</p>
        </div>
      </div>
    </li>
  );
}

/** Zavihek Novice: viri (RSS/Atom, Reddit, YouTube, Hacker News), dnevni pregled in ocene z modelom, ki ga je uporabnik izbral. Vse lokalno. */
export function NovicePanel() {
  const [pogled, setPogled] = useState<Pogled | null>(null);
  const [zavihek, setZavihek] = useState<Zavihek>("pregled");
  const [zaposlen, setZaposlen] = useState<Zaposlen>("");
  const [napaka, setNapaka] = useState("");
  const [zdaj, setZdaj] = useState<Date | null>(null);
  const [vrsta, setVrsta] = useState<VrstaVira>("rss");
  const [vnos, setVnos] = useState("");
  const [ime, setIme] = useState("");
  const [kategorija, setKategorija] = useState("");
  const [zanimanja, setZanimanja] = useState("");
  const [najvec, setNajvec] = useState(20);
  const [naKategorijo, setNaKategorijo] = useState(5);
  const [prag, setPrag] = useState(4);

  const uporabi = useCallback((p: Pogled) => {
    setPogled(p);
    setZdaj(new Date());
  }, []);

  const osvezi = useCallback(
    async (sila: boolean) => {
      setNapaka("");
      setZaposlen("osvezi");
      try {
        uporabi(await noviceOsveziFn({ data: { sila } }));
      } catch (e) {
        setNapaka(e instanceof Error ? e.message : t("novNapaka"));
      } finally {
        setZaposlen("");
      }
    },
    [uporabi],
  );

  // Najprej shranjeno stanje (takoj), nato tiho osvezitev; streznik sam ne prenasa znova, dokler je predpomnilnik svez.
  useEffect(() => {
    let zivo = true;
    void (async () => {
      try {
        const p = await noviceBeriFn();
        if (!zivo) return;
        uporabi(p);
        setZanimanja(p.zanimanja);
        setNajvec(p.nastavitve.najvec);
        setNaKategorijo(p.nastavitve.najvecNaKategorijo);
        setPrag(p.nastavitve.prag);
        if (p.viri.length) await osvezi(false);
      } catch (e) {
        if (zivo) setNapaka(e instanceof Error ? e.message : t("novNapaka"));
      }
    })();
    return () => {
      zivo = false;
    };
  }, [osvezi, uporabi]);

  async function izvedi<T extends { ok: boolean }>(kaj: Zaposlen, delo: () => Promise<T>, poUspehu?: () => void): Promise<void> {
    setNapaka("");
    setZaposlen(kaj);
    try {
      const izid = await delo();
      if (izid.ok) {
        const p = (izid as unknown as { pogled: Pogled }).pogled;
        uporabi(p);
        poUspehu?.();
      } else {
        setNapaka((izid as unknown as { sporocilo: string }).sporocilo);
      }
    } catch (e) {
      setNapaka(e instanceof Error ? e.message : t("novNapaka"));
    } finally {
      setZaposlen("");
    }
  }

  const dodaj = () =>
    izvedi("dodaj", () => noviceDodajVirFn({ data: { vrsta, vnos, ime, kategorija } }), () => {
      setVnos("");
      setIme("");
      // Nov vir se takoj prebere, da uporabnik vidi rezultat (in morebitno napako).
      void osvezi(false);
    });
  const odstrani = (id: string) => izvedi("dodaj", () => noviceOdstraniVirFn({ data: { id } }));
  const shrani = () => izvedi("shrani", () => noviceShraniFn({ data: { zanimanja, nastavitve: { najvec, najvecNaKategorijo: naKategorijo, prag } } }));
  const oceni = () => izvedi("oceni", () => noviceOceniFn());

  const viri = pogled?.viri ?? [];
  const napakePoViru = new Map((pogled?.napake ?? []).map((n) => [n.virId, n]));
  const seznam = zavihek === "vse" ? (pogled?.postavke ?? []) : (pogled?.pregled ?? []);
  const zasedeno = zaposlen !== "";

  return (
    <section className="mt-5 grid max-w-6xl gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]" aria-label={t("novAria")}>
      <div className="flex flex-col gap-5 self-start">
        <form
          className="flex flex-col gap-4 rounded-3xl bg-[var(--color-sheet)] p-5 sm:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            void dodaj();
          }}
        >
          <h2 className="display text-2xl">{t("novNaslov")}</h2>
          <p className="text-sm text-[var(--color-moss)]">{t("novNamig")}</p>
          <fieldset className="flex flex-wrap gap-2" aria-label={t("novVrsta")}>
            {VRSTE.map((v) => (
              <label key={v.id} className="lina-izbira">
                <input type="radio" name="novice-vrsta" value={v.id} checked={vrsta === v.id} onChange={() => setVrsta(v.id)} className="sr-only" />
                <span>{v.oznaka()}</span>
              </label>
            ))}
          </fieldset>
          {vrsta === "hn" ? null : (
            <label className="flex flex-col gap-1 text-sm">
              {t("novVnos")}
              <input value={vnos} maxLength={500} placeholder={namigVnosa(vrsta)} onChange={(e) => setVnos(e.target.value)} className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2" />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            {t("novIme")}
            <input value={ime} maxLength={60} onChange={(e) => setIme(e.target.value)} className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("novKategorija")}
            <input value={kategorija} maxLength={MEJA_KATEGORIJE} placeholder={t("novKategorijaNamig")} onChange={(e) => setKategorija(e.target.value)} className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2" />
          </label>
          <button type="submit" disabled={zasedeno || (vrsta !== "hn" && !vnos.trim())} className="self-start rounded-full bg-[var(--color-ink)] px-6 py-2.5 text-sm text-[var(--color-on-ink)] disabled:opacity-50">
            {t("novDodaj")}
          </button>
        </form>

        <form
          className="flex flex-col gap-3 rounded-3xl bg-[var(--color-sheet)] p-5 sm:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            void shrani();
          }}
        >
          <h3 className="display text-xl">{t("novZanimanja")}</h3>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--color-moss)]">{t("novZanimanjaNamig")}</span>
            <textarea value={zanimanja} maxLength={MEJA_ZANIMANJ} rows={3} onChange={(e) => setZanimanja(e.target.value)} className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2" />
          </label>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <label className="flex flex-col gap-1">
              {t("novNajvec")}
              <input type="number" min={5} max={50} value={najvec} onChange={(e) => setNajvec(Number(e.target.value))} className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-2 py-2" />
            </label>
            <label className="flex flex-col gap-1">
              {t("novNaKategorijo")}
              <input type="number" min={1} max={20} value={naKategorijo} onChange={(e) => setNaKategorijo(Number(e.target.value))} className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-2 py-2" />
            </label>
            <label className="flex flex-col gap-1">
              {t("novPrag")}
              <input type="number" min={0} max={9.5} step={0.5} value={prag} onChange={(e) => setPrag(Number(e.target.value))} className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-2 py-2" />
            </label>
          </div>
          <button type="submit" disabled={zasedeno} className="lina-gumb-majhen self-start">
            {t("novShrani")}
          </button>
        </form>
        <p className="px-2 text-xs text-[var(--color-brass)]">{t("novZasebnost")}</p>
      </div>

      <div className="min-w-0 rounded-3xl bg-[var(--color-sheet)] p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <fieldset className="flex gap-2" aria-label={t("novZavihki")}>
            {(["pregled", "vse", "viri"] as const).map((z) => (
              <label key={z} className="lina-izbira">
                <input type="radio" name="novice-zavihek" value={z} checked={zavihek === z} onChange={() => setZavihek(z)} className="sr-only" />
                <span>{z === "pregled" ? t("novZavPregled") : z === "vse" ? t("novZavVse") : t("novZavViri")}</span>
              </label>
            ))}
          </fieldset>
          <div className="ml-auto flex gap-2">
            <button type="button" disabled={zasedeno || viri.length === 0} onClick={() => void osvezi(true)} className="lina-gumb-majhen">
              {zaposlen === "osvezi" ? t("novOsvezuje") : t("novOsvezi")}
            </button>
            <button type="button" disabled={zasedeno || viri.length === 0} onClick={() => void oceni()} className="lina-gumb-majhen">
              {zaposlen === "oceni" ? t("novOcenjujem") : t("novOceni")}
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--color-brass)]">
          {pogled?.osvezeno && zdaj ? `${t("novOsvezeno")} ${relativniCas(pogled.osvezeno, zdaj, jezikVmesnika())}` : t("novNikoli")}
          {pogled && pogled.ocenjenih > 0 ? ` · ${pogled.ocenjenih} ${t("novOcenjenih")}` : ""}
        </p>
        {napaka ? (
          <p role="alert" className="mt-3 text-sm text-[var(--color-signal)]">
            {napaka}
          </p>
        ) : null}

        {zavihek === "viri" ? (
          <div className="mt-4">
            {viri.length === 0 ? <p className="text-sm text-[var(--color-brass)]">{t("novBrezVirov")}</p> : null}
            <ul className="divide-y divide-[var(--color-rule)]">
              {viri.map((v) => {
                const n = napakePoViru.get(v.id);
                return (
                  <li key={v.id} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="font-semibold">{v.ime}</span>
                      <span className="ml-2 text-xs text-[var(--color-brass)]">
                        {oznakaVrste(v.vrsta)} · {v.kategorija}
                      </span>
                      <span className="block truncate text-xs text-[var(--color-moss)]">{v.vrsta === "hn" ? "" : v.vnos}</span>
                      {n ? (
                        <span role="status" className="block text-xs text-[var(--color-signal)]">
                          {t("novTezava")}: {opisNapake(n.koda, n.status)}
                        </span>
                      ) : null}
                    </span>
                    <button type="button" disabled={zasedeno} onClick={() => void odstrani(v.id)} className="rounded-full px-3 py-1 text-xs text-[var(--color-signal)] hover:bg-[var(--color-surface)]">
                      {t("novOdstrani")}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="mt-4">
            {pogled && viri.length === 0 ? <p className="text-sm text-[var(--color-brass)]">{t("novBrezVirov")}</p> : null}
            {pogled && viri.length > 0 && seznam.length === 0 ? (
              <p className="text-sm text-[var(--color-brass)]">{zavihek === "pregled" ? t("novPregledPrazen") : t("novPrazno")}</p>
            ) : null}
            {(pogled?.napake.length ?? 0) > 0 ? (
              <p role="status" className="mb-2 text-xs text-[var(--color-signal)]">
                {t("novNekajVirovNeDela")}
              </p>
            ) : null}
            <ul className="divide-y divide-[var(--color-rule)]">
              {seznam.map((p) => (
                <Vrstica key={p.kljuc} p={p} zdaj={zdaj} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
