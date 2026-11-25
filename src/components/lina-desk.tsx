import { TinyFishKljuc } from "@/components/tinyfish-kljuc.tsx";
import { GithubDostop } from "@/components/github-dostop.tsx";
import { NacrtStikalo } from "@/components/nacrt-stikalo.tsx";
import { OLiniPanel } from "@/components/opozorilo.tsx";
import { imeVTozilniku } from "@/lib/lina/ime-tozilnik.ts";
import { zaShranjevanje } from "@/lib/lina/pravila-shranjevanje.ts";
import { BraveKljuc } from "@/components/brave-kljuc.tsx";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { dodajBesedilo, MEJA_DOKUMENTA_BAJTOV, MEJA_ZNANJA, preberiDokument } from "@/lib/lina/znanje-besedilo.ts";
import { ZnanjeDatoteke } from "@/components/znanje-datoteke.tsx";
import { sporociloNapake, sporociloStreznika, t, type Beseda } from "@/lib/lina/besedila.ts";
import { jePredHiso, PRED_HISO } from "@/lib/lina/paket.ts";
import { PoveziTelefon } from "@/components/povezi-telefon.tsx";
import { oznakaLinije, type TelefonLinije } from "@/lib/lina/oznaka-linije.ts";
import { casKlica, korakiNastavitve, uraGlave, stanjeKlica, vstavi, type RazdelekLine } from "@/lib/lina/ui-videz.ts";
import { FOKUS, GUMB, GUMB_OBROBA, GUMB_SIGNAL, IZBIRA, NAMIG, OZNAKA_POLJA, PLOSCA, POLJE, Podrazdelek, Razdelek, StanjeNalaganja, StanjeNapaka, StanjePrazno, Znacka } from "@/components/ui-lina.tsx";
import { SpominLastnika } from "@/components/spomin-lastnika.tsx";
import { TemaPreklop } from "@/components/tema-preklop.tsx";
import { JezikPreklop } from "@/components/jezik-preklop.tsx";
import { GooglePrijava } from "@/components/google-prijava.tsx";
import { PotNaslova } from "@/components/pot-naslova.tsx";
import { TwilioRacun } from "@/components/twilio-racun.tsx";
import { NujnoOznaka } from "@/components/nujno-oznaka.tsx";
import { NujniKlici } from "@/components/nujni-klici.tsx";
import { Avtonomija } from "@/components/avtonomija.tsx";
import { ModelAsistentke } from "@/components/model-asistentke.tsx";
import { tM } from "@/lib/lina/besedila-mozgani.ts";
import { SonioxNastavitve } from "@/components/soniox-nastavitve.tsx";
import { posodobiLinoFn, posodobiPaketFn, stanjeDodatkovFn, stanjeDrugihPaketovFn, stanjePosodobitveFn } from "@/lib/lina/functions.ts";
import { StraniNastavitve } from "@/components/strani-nastavitve.tsx";
import { DovoljenjaNastavitve } from "@/components/dovoljenja-nastavitve.tsx";
import { NarocilaNastavitve } from "@/components/narocila-nastavitve.tsx";
import type { IzidPosodobitve, RazlogZavrnitve, StanjePaketa, StanjePosodobitve } from "@/lib/lina/posodobitev.server.ts";
import { GOVOR_MODELI } from "@/lib/lina/govor-model.ts";
import { razvrstiKlice } from "@/lib/lina/tajnica.ts";
import { OMNIROUTE_PRIVZETI_NASLOV } from "@/lib/lina/omniroute.ts";
import { stanjeOmnirouteFn, shraniOmnirouteFn, pozabiOmnirouteFn, logoutFn, setupOwnerFn, phoneTurn, publishLine, speak, saveBrainFn, checkBrainFn, chooseStorageFn, savePravilaFn, dodajVrzelFn, vajaKlicaFn, preberiSpletFn, preberiPredlogFn, potekSpletaFn, potrdiPredlogFn, zavrziPredlogFn, pogledMapeZapiskovFn, izberiMapoZapiskovFn, odpriMapoZapiskovFn, seznamZapiskovFn, preberiZapisekFn, preberiPosnetekFn, zdruziZapiskeFn, povzetekKlicateljaFn } from "@/lib/lina/functions.ts";
import type { MapaZapiskov, Zapisek, ZapisekVsebina } from "@/lib/lina/zapiski.ts";
import { delezKratkih } from "@/lib/lina/povzetek.ts";
import { DEFAULT_BRAIN_MODELS, DEFAULT_VERTEX_LOCATION, IME_PONUDNIKA, type BrainProvider, type BrainPublic, type CallSession, type Catalog, type LinijaZGlasom, type Material, type Pravila, type Predlog, type Product, type StorageView, type Vrzel, type ZapisVaje } from "@/lib/lina/types.ts";
import { jeVeljavenEnaslov, naslovJeTezakZaGovor, naslovNaDomeni } from "@/lib/lina/eposta.ts";
import { kazatiNamigZaVajo } from "@/lib/lina/vaja-namig.ts";
import { RAZLOGI_KATALOG, razlogOdsotnosti, type NastavitveOdsotnosti } from "@/lib/lina/odsotnost.ts";
import { obveznoBesedilo, prazenSeznamBesedilo, razdelekViden, vajaNamigBesedilo, veljavenZavihek, zavihki, type ZavihekId } from "@/lib/lina/osebni-nacin.ts";
import { nizZaVklop, PREVERJENI_OPERATERJI, type Operater, type VrstaPreusmeritve } from "@/lib/lina/iphone.ts";
import { Podokna } from "@/components/podokna.tsx";
import { CiscenjeZvokaStikalo, MotivacijaStikalo, SamodejniZagonStikalo, SamoucenjeStikalo, SpominPogovorovStikalo } from "@/components/lina2/mediji.tsx";
import { StrokeKartica } from "@/components/lina2/stroke-kartica.tsx";
import { UcenjeLHStikalo } from "@/components/lina2/ucenje-lh-kartica.tsx";
import { GradnjeStikalo } from "@/components/lina2/racunalnik.tsx";
import { ObvestilaNastavitve } from "@/components/lina2/obvestila-nastavitve.tsx";
import {
  NASTAVITVE,
  ZNANJE,
  podoknoZaRazdelek,
  type PodoknoNastavitev,
  type PodoknoZnanja,
} from "@/lib/lina/podokna-definicije.ts";

type Tab = RazdelekLine;

/** Razdelki programa; napisi so v datoteki besedil (sl, en), ne v kodi. »Telefon« (QR in koda za povezavo telefona) je razdelek takoj za Klicem. */
const TABS: Array<{ id: Tab; label: Beseda }> = [
  { id: "klic", label: "uiTabKlic" },
  { id: "telefon", label: "uiTabTelefon" },
  { id: "znanje", label: "uiTabZnanje" },
  { id: "narocila", label: "uiTabNarocila" },
  { id: "dnevnik", label: "uiTabDnevnik" },
  { id: "zapiski", label: "zapiskiTab" },
  { id: "linija", label: "uiTabLinija" },
  { id: "nastavitve", label: "uiTabNastavitve" },
];

function fault(cause: unknown): string {
  return sporociloNapake(cause);
}

async function playReply(callSid: string, text: string) {
  try {
    const spoken = await speak({
      data: {
        callSid,
        text,
      },
    });
    if (spoken.audioBase64 && spoken.mime) {
      await new Audio(`data:${spoken.mime};base64,${spoken.audioBase64}`).play();
      return;
    }
  } catch {}
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "sl-SI";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

export function LinaDesk({
  line,
  calls,
  llm,
  brezGesla,
  brain,
  storage,
  pravila: pravilaIn,
  vrzeli: vrzeliIn,
  zacetniZavihek,
  vdelan = false,
  telefonLinije = null,
}: {
  line: LinijaZGlasom;
  calls: CallSession[];
  llm: boolean;
  brezGesla: boolean;
  brain: BrainPublic;
  storage: StorageView;
  pravila: Pravila & NastavitveOdsotnosti;
  vrzeli: Vrzel[];
  /** Okvir Line 2.0 izbere razdelek (levi meni); brez njega se zacne pri Klicu. */
  zacetniZavihek?: RazdelekLine;
  /** Vdelan v okvir: okvir ima lasten meni, zato se vrstica razdelkov ne prikaze. */
  vdelan?: boolean;
  /** Naloga 16: stanje telefona za oznako linije (okvir ga osvezuje); brez njega oznaka ne trdi »zaprta« pred odgovorom. */
  telefonLinije?: TelefonLinije | null;
}) {
  const router = useRouter();
  const [tabIzbran, setTab] = useState<Tab>(zacetniZavihek ?? "klic");
  const [podoknoNast, setPodoknoNast] = useState<PodoknoNastavitev | undefined>(undefined);
  const [podoknoZnanja, setPodoknoZnanja] = useState<PodoknoZnanja | undefined>(undefined);
  useEffect(() => {
    if (zacetniZavihek) setTab(zacetniZavihek);
  }, [zacetniZavihek]);
  useEffect(() => {
    const odpriPoSidru = () => {
      if (typeof window === "undefined") return;
      const sidro = window.location.hash;
      if (!sidro) return;
      const nast = podoknoZaRazdelek(NASTAVITVE, sidro);
      if (nast) {
        setPodoknoNast(nast as PodoknoNastavitev);
        setTab("nastavitve");
        return;
      }
      const zn = podoknoZaRazdelek(ZNANJE, sidro);
      if (zn) {
        setPodoknoZnanja(zn as PodoknoZnanja);
        setTab("znanje");
      }
    };
    odpriPoSidru();
    window.addEventListener("hashchange", odpriPoSidru);
    return () => window.removeEventListener("hashchange", odpriPoSidru);
  }, []);
  const [log, setLog] = useState(calls);
  const [active, setActive] = useState<CallSession | null>(null);
  const [izSeznama, setIzSeznama] = useState(false);
  const [gesloOdprto, setGesloOdprto] = useState(false);
  const [novoGeslo, setNovoGeslo] = useState("");
  const [gesloNapaka, setGesloNapaka] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [opozorilo, setOpozorilo] = useState("");
  const [catalog, setCatalog] = useState<Catalog>(line.catalog);
  const [open, setOpen] = useState(line.open);
  const oznaka = oznakaLinije(open, telefonLinije);
  const [seconds, setSeconds] = useState(0);
  const [mind, setMind] = useState(brain);
  const [place, setPlace] = useState(storage);
  const [pravila, setPravila] = useState<Pravila & NastavitveOdsotnosti>(pravilaIn);
  // Zadnji posnetek pravil s streznika: shrani se samo, kar je lastnik spremenil (pregled 0225 B3).
  const osnovaPravil = useRef(pravilaIn);
  // Osebni nacin nima zavihka Znanje (poslovno): izbran zavihek, ki ga v tem nacinu ni, pade na »Klic«; »telefon« je v obeh nacinih.
  const tab: Tab = tabIzbran === "telefon" ? "telefon" : veljavenZavihek(tabIzbran, pravila.nacinKlica);
  const [vrzeli, setVrzeli] = useState(vrzeliIn);
  useEffect(() => {
    if (!line.glas.vTeku) return;
    const casovnik = setInterval(() => void router.invalidate(), 3e3);
    return () => clearInterval(casovnik);
  }, [line.glas.vTeku, router]);
  useEffect(() => {
    setLog(calls);
    setCatalog(line.catalog);
    setOpen(line.open);
  }, [calls, line]);
  useEffect(() => {
    setMind(brain);
  }, [brain]);
  useEffect(() => {
    setPlace(storage);
  }, [storage]);
  useEffect(() => {
    osnovaPravil.current = pravilaIn;
    setPravila(pravilaIn);
  }, [pravilaIn]);
  useEffect(() => {
    setVrzeli(vrzeliIn);
  }, [vrzeliIn]);
  useEffect(() => {
    if (!active || active.status !== "v-teku") return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1e3);
    return () => window.clearInterval(timer);
  }, [active]);
  const orders = useMemo(() => log.filter((call) => call.order.confirmed), [log]);
  // Osebni nacin: namesto potrjenih narocil sporocila, ki jih je klicatelj pustil.
  const sporocila = useMemo(() => log.filter((call) => Boolean(call.order.tajnica?.sporocilo)), [log]);
  // Za podjetje ostanejo TABS in uiTab* nespremenjeni; za osebni nacin filtrira in preimenuje po zavihki().
  const vidniZavihki = useMemo(() => {
    const poNacinu = new Map<ZavihekId, string>(zavihki(pravila.nacinKlica).map((z) => [z.id, z.label]));
    return TABS.filter((item) => item.id === "telefon" || poNacinu.has(item.id)).map((item) => ({
      id: item.id,
      oznaka:
        pravila.nacinKlica === "osebna" && item.id === "narocila"
          ? (poNacinu.get("narocila") ?? t(item.label))
          : t(item.label),
    }));
  }, [pravila.nacinKlica]);
  const delez = useMemo(() => delezKratkih(log), [log]);
  const koraki = useMemo(
    () =>
      korakiNastavitve({
        mozganiNastavljeni: mind.nastavljen || llm,
        catalog,
        steviloKlicev: log.length,
        odprta: open,
      }).filter((k) => k.id !== "znanje" || razdelekViden("znanje", pravila.nacinKlica)),
    [mind.nastavljen, llm, catalog, log.length, open, pravila.nacinKlica],
  );
  const korakovKoncanih = koraki.filter((k) => k.koncan).length;
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  async function refresh() {
    await router.invalidate();
  }
  function pojdi(cilj: Tab, sidro?: string) {
    if (cilj === "nastavitve") {
      const p = sidro ? podoknoZaRazdelek(NASTAVITVE, sidro) : null;
      setPodoknoNast(p ? (p as PodoknoNastavitev) : undefined);
    } else if (cilj === "znanje") {
      const p = sidro ? podoknoZaRazdelek(ZNANJE, sidro) : null;
      setPodoknoZnanja(p ? (p as PodoknoZnanja) : undefined);
    }
    setTab(cilj);
    if (cilj !== "klic") setIzSeznama(false);
  }
  async function turn(callSid: string, text: string, from = "pisarna") {
    const result = await phoneTurn({
      data: {
        callSid,
        from,
        text,
      },
    });
    setActive(result.call);
    setLog((prev) => [result.call, ...prev.filter((item) => item.callSid !== result.call.callSid)]);
    await playReply(result.call.callSid, result.reply);
    return result.call;
  }
  async function accept() {
    setError("");
    setBusy(true);
    setSeconds(0);
    setIzSeznama(false);
    try {
      await turn(`lokalno-${crypto.randomUUID()}`, "");
      setTab("klic");
    } catch (cause) {
      setError(fault(cause));
    } finally {
      setBusy(false);
    }
  }
  async function send(text: string) {
    const clean = text.trim();
    if (!clean) return;
    setError("");
    setBusy(true);
    setDraft("");
    try {
      await turn(active?.callSid ?? `lokalno-${crypto.randomUUID()}`, clean);
    } catch (cause) {
      setError(fault(cause));
    } finally {
      setBusy(false);
    }
  }
  async function hangup() {
    if (!active) return;
    setBusy(true);
    try {
      const result = await phoneTurn({
        data: {
          callSid: active.callSid,
          hangup: true,
        },
      });
      setActive(result.call);
      await refresh();
    } catch (cause) {
      setError(fault(cause));
    } finally {
      setBusy(false);
    }
  }
  async function saveLine(nextOpen = open, nextCatalog = catalog, brezGlasu = false) {
    setBusy(true);
    setError("");
    try {
      const saved = await publishLine({
        data: {
          open: nextOpen,
          catalog: nextCatalog,
          ...(brezGlasu ? { brezGlasu: true } : {}),
        },
      });
      setOpen(saved.open);
      setCatalog(nextCatalog);
      setOpozorilo(saved.opozorila?.length ? saved.opozorila.join(" ") : "");
      await refresh();
    } catch (cause) {
      setError(fault(cause));
    } finally {
      setBusy(false);
    }
  }
  async function saveRules(next = pravila) {
    setBusy(true);
    setError("");
    try {
      const saved = await savePravilaFn({ data: zaShranjevanje(osnovaPravil.current, next) });
      osnovaPravil.current = saved;
      setPravila(saved);
      setOpozorilo(saved.opozorila?.length ? saved.opozorila.join(" ") : "");
    } catch (cause) {
      setError(fault(cause));
    } finally {
      setBusy(false);
    }
  }
  function listen() {
    const w = window as Window & { webkitSpeechRecognition?: new () => BrowserRec; SpeechRecognition?: new () => BrowserRec };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      setError(t("uiNiPrepoznave"));
      return;
    }
    const rec = new Ctor();
    rec.lang = "sl-SI";
    rec.onresult = (event) => {
      const said = event.results[0]?.[0]?.transcript ?? "";
      if (said) send(said);
    };
    rec.start();
  }
  const vTeku = active?.status === "v-teku";
  return (
    <main className={`mx-auto min-h-screen ${tab === "nastavitve" ? "max-w-[96rem]" : "max-w-6xl"} px-4 pt-5 pb-16 sm:px-6 sm:pt-8`}>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-[var(--color-brass)] uppercase">{t("podnaslov")}</p>
          <h1 className="display text-4xl leading-none sm:text-5xl">Lina</h1>
          {catalog.company.name ? (
            <p className="mt-2 truncate text-sm text-[var(--color-ink)]">
              {t("zaPodjetje")} <span className="font-medium">{catalog.company.name}</span>
            </p>
          ) : null}
          <p className="mt-2 flex flex-wrap gap-2" aria-live="polite">
            {oznaka.odpreLinijo ? (
              <button type="button" className={`rounded-full ${FOKUS}`} aria-label={t("linOznakaOdpri")} onClick={() => setTab("linija")}>
                <Znacka ton="brass">{t(oznaka.kljuc)}</Znacka>
              </button>
            ) : <Znacka ton={oznaka.ton === "ok" ? "moss" : "ink"}>{t(oznaka.kljuc)}</Znacka>}
            <Znacka ton="ink">
              {mind.nastavljen
                ? `${t("uiMozganiNaslov")}: ${mind.provider}`
                : llm
                  ? t("uiMozganiOkolje")
                  : t("uiSamoKatalog")}
            </Znacka>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <TemaPreklop />
          {brezGesla ? (
            <button
              type="button"
              className={GUMB_OBROBA}
              aria-expanded={gesloOdprto}
              onClick={() => setGesloOdprto((v) => !v)}
            >
              {t("gesloNeobvezno")}
            </button>
          ) : (
            <button
              type="button"
              className={GUMB_OBROBA}
              onClick={async () => {
                await logoutFn();
                await refresh();
              }}
            >
              {t("uiOdjava")}
            </button>
          )}
        </div>
      </header>
      {brezGesla && gesloOdprto ? (
        <form
          className={`${PLOSCA} mt-5 max-w-md p-5`}
          onSubmit={async (event) => {
            event.preventDefault();
            setGesloNapaka("");
            try {
              await setupOwnerFn({ data: { password: novoGeslo } });
              setNovoGeslo("");
              setGesloOdprto(false);
              await refresh();
            } catch (cause) {
              setGesloNapaka(fault(cause));
            }
          }}
        >
          <p className="text-sm text-[var(--color-moss)]">{t("gesloOpomba")}</p>
          <label className={`${OZNAKA_POLJA} mt-4`} htmlFor="novo-geslo">
            {t("gesloNovo")}
          </label>
          <input
            id="novo-geslo"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required={true}
            value={novoGeslo}
            onChange={(event) => setNovoGeslo(event.target.value)}
            className={POLJE}
          />
          {gesloNapaka ? (
            <div className="mt-3">
              <StanjeNapaka razlog={gesloNapaka} />
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="submit" className={GUMB}>
              {t("gesloShrani")}
            </button>
            <button type="button" className={GUMB_OBROBA} onClick={() => setGesloOdprto(false)}>
              {t("gesloPreklici")}
            </button>
          </div>
        </form>
      ) : null}
      {vdelan ? null : (
        <nav
          className="sticky top-0 z-20 -mx-4 mt-6 border-b border-[var(--color-rule)] bg-[var(--color-paper)] px-4 sm:-mx-6 sm:px-6"
          aria-label={t("uiRazdelki")}
        >
          <ul className="flex gap-1 overflow-x-auto py-2">
            {vidniZavihki.map((item) => (
              <li className="shrink-0" key={item.id}>
                <button
                  type="button"
                  onClick={() => pojdi(item.id)}
                  aria-current={tab === item.id ? "page" : void 0}
                  className={`min-h-11 rounded-full px-4 text-sm whitespace-nowrap transition-colors motion-reduce:transition-none ${FOKUS} ${tab === item.id ? "bg-[var(--color-ink-fill)] font-medium text-white" : "text-[var(--color-ink)] hover:bg-[var(--color-surface)]"}`}
                >
                  {item.oznaka}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {error ? (
        <div className="mt-5">
          <StanjeNapaka razlog={error} onZapri={() => setError("")} />
        </div>
      ) : null}
      {opozorilo ? (
        <div
          role="status"
          className="mt-5 flex flex-wrap items-start gap-x-4 gap-y-2 rounded-2xl border border-[var(--color-brass)] bg-[var(--color-surface)] px-4 py-3"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--color-brass)]">{t("uiOpozoriloNaslov")}</p>
            <p className="mt-0.5 text-sm break-words">{opozorilo}</p>
          </div>
          <button type="button" onClick={() => setOpozorilo("")} className={GUMB_OBROBA}>
            {t("uiZapri")}
          </button>
        </div>
      ) : null}
      {/* Enkratno obvestilo po posodobitvi (pregled 0.2.10, najdba 3): streznik ga pokaze samo, ce je bila nujna prevezava ze vklopljena. */}
      {pravila.urnikObvestilo ? (
        <div
          role="status"
          className="mt-5 flex flex-wrap items-start gap-x-4 gap-y-2 rounded-2xl border border-[var(--color-brass)] bg-[var(--color-surface)] px-4 py-3"
        >
          <p className="min-w-0 flex-1 text-sm break-words">{t("urnikObvestilo")}</p>
          <button type="button" disabled={busy} onClick={() => void saveRules({ ...pravila, urnikObvestilo: false })} className={GUMB_OBROBA}>
            {t("uiZapri")}
          </button>
        </div>
      ) : null}
      {tab === "klic" && !izSeznama && korakovKoncanih < koraki.length ? (
        <section className={`${PLOSCA} mt-6 p-5 sm:p-6`} aria-labelledby="prvi-koraki-naslov" data-prvi-koraki="1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="prvi-koraki-naslov" className="display text-2xl">
              {t("uiKorakiNaslov")}
            </h2>
            <p className="text-sm text-[var(--color-moss)]">
              {vstavi(t("uiKorakiNapredek"), {
                n: korakovKoncanih,
                vseh: koraki.length,
              })}
            </p>
          </div>
          <p className="mt-1 text-sm text-[var(--color-moss)]">{t("uiKorakiUvod")}</p>
          <ol className="mt-5 grid gap-0 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-[var(--color-rule)]">
            {koraki.map((k, i) => (
              <li
                className={
                  "flex flex-col border-t border-[var(--color-rule)] py-4 first:border-t-0 sm:px-4 sm:[&:nth-child(2)]:border-t-0 lg:border-t-0 lg:py-1 lg:first:pl-0"
                }
                key={k.id}
              >
                <p className="flex items-center gap-2 text-sm">
                  <span
                    aria-hidden="true"
                    className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${k.koncan ? "bg-[var(--color-ink-fill)] text-white" : "border border-[var(--color-rule)] text-[var(--color-ink)]"}`}
                  >
                    {k.koncan ? "✓" : i + 1}
                  </span>
                  <span className="font-semibold">{t(k.naslov)}</span>
                </p>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--color-moss)]">{t(k.opis)}</p>
                <p className="mt-3 flex flex-wrap items-center gap-3">
                  <Znacka ton={k.koncan ? "moss" : "brass"}>{k.koncan ? t("uiKorakKoncan") : t("uiKorakOdprt")}</Znacka>
                  {!k.koncan ? (
                    <button
                      type="button"
                      className={GUMB_OBROBA}
                      onClick={() =>
                        pojdi(k.cilj, k.id === "mozgani" ? "nast-mozgani" : k.id === "znanje" ? "zn-podjetje" : undefined)
                      }
                    >
                      {t(k.gumb)}
                    </button>
                  ) : null}
                </p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {tab === "klic" ? (
        <section
          className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]"
          aria-label={t("uiTabKlic")}
        >
          {izSeznama ? (
            <div className="lg:col-span-2">
              <button type="button" className={GUMB_OBROBA} onClick={() => pojdi("dnevnik")}>
                <span aria-hidden="true">←</span> {t("uiNazajNaSeznam")}
              </button>
            </div>
          ) : null}
          <div className={`phone ${izSeznama ? "order-last lg:order-none" : ""}`}>
            <div className="phone-screen flex flex-col p-4">
              <div className="text-center">
                <p className="display text-lg tracking-wide">LINA</p>
                <p className="text-xs text-[var(--color-brass)]" role="status">
                  {vTeku ? `${t("uiKlicVTeku")} · ${clock}` : t("uiSlusalkaPripravljena")}
                </p>
                {vTeku ? (
                  <div className="wave mx-auto mt-3 justify-center" aria-hidden="true">
                    {Array.from({ length: 7 }, (_, index) => (
                      <span key={index} />
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="mt-4 flex max-h-64 min-h-24 flex-col gap-2 overflow-y-auto text-sm" aria-live="polite">
                {(active?.transcript ?? []).length === 0 ? (
                  <p className="m-auto max-w-[16rem] text-center text-xs text-[var(--color-moss)]">
                    {t("uiPogovorPrazen")}
                  </p>
                ) : null}
                {(active?.transcript ?? []).map((item, index) => (
                  <p
                    className={`max-w-[90%] rounded-2xl px-3 py-2 ${item.role === "lina" ? "self-start bg-[var(--color-surface)]" : "self-end bg-[var(--color-ink-fill)] text-white"}`}
                    key={`${item.at}-${index}`}
                  >
                    {item.text}
                    {item.razumljeno ? (
                      <span className="ml-2 text-xs opacity-70">
                        ({t("zapisekRazumljeno")}
                        {": "}
                        {item.razumljeno})
                      </span>
                    ) : null}
                    {typeof item.zaupanje === "number" ? (
                      <span className="ml-2 text-xs opacity-70">
                        {t("zaupanjeOznaka")} {item.zaupanje.toFixed(2)}
                      </span>
                    ) : null}
                  </p>
                ))}
              </div>
              <div className="mt-auto pt-4">
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void accept()}
                    className={`${GUMB_SIGNAL} flex-1`}
                  >
                    {t("uiSprejmi")}
                  </button>
                  <button
                    type="button"
                    disabled={busy || !active}
                    onClick={() => void hangup()}
                    className={GUMB_OBROBA}
                  >
                    {t("uiOdlozi")}
                  </button>
                </div>
                <form
                  className="mt-3 flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    send(draft);
                  }}
                >
                  <label className="sr-only" htmlFor="replika">
                    {t("uiReplika")}
                  </label>
                  <input
                    id="replika"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={t("uiReplikaMesto")}
                    className="min-h-11 min-w-0 flex-1 rounded-full border border-[var(--color-rule)] bg-[var(--color-surface)] px-4 text-base sm:text-sm"
                  />
                  <button type="button" onClick={listen} className={`${GUMB_OBROBA} px-3`} aria-label={t("uiGlasOpis")}>
                    {t("uiGlas")}
                  </button>
                  <button type="submit" disabled={busy} className={`${GUMB} px-4`}>
                    {t("uiPoslji")}
                  </button>
                </form>
              </div>
            </div>
          </div>
          <Slip call={active} />
        </section>
      ) : null}
      {tab === "znanje" ? (
        <Knowledge
          catalog={catalog}
          zacetno={podoknoZnanja}
          busy={busy}
          pravila={pravila}
          vrzeli={vrzeli}
          onChange={setCatalog}
          onPravila={setPravila}
          onVrzeli={setVrzeli}
          onSave={() => void saveLine()}
          onSaveRules={() => void saveRules()}
          onError={setError}
          onBusy={setBusy}
        />
      ) : null}
      {tab === "narocila" && pravila.nacinKlica === "osebna" ? (
        <section className="mt-5 grid gap-3">
          {sporocila.length === 0 ? <p className="text-sm">{prazenSeznamBesedilo(pravila.nacinKlica)}</p> : null}
          {sporocila.map((call) => (
            <article className={`${PLOSCA} p-4`} key={call.callSid}>
              <h2 className="display text-2xl">{call.order.customerName || call.order.phone || t("neznanKlicatelj")}</h2>
              <p className="mt-1 text-sm break-words">{call.order.tajnica?.sporocilo}</p>
            </article>
          ))}
        </section>
      ) : null}
      {tab === "narocila" && pravila.nacinKlica !== "osebna" ? (
        <section className="mt-5 grid gap-3">
          {orders.length === 0 ? <p className="text-sm">{prazenSeznamBesedilo(pravila.nacinKlica)}</p> : null}
          {orders.map((call) => (
            <article className="rounded-2xl bg-[var(--color-sheet)] p-4" key={call.callSid}>
              <h2 className="display text-2xl">{call.order.customerName || "Stranka"}</h2>
              <p className="text-sm">
                {call.order.productName}
                {" · "}
                {call.order.materialName}
                {call.order.quantity ? ` · ${call.order.quantity} kos` : ""}
              </p>
              <p className="text-xs text-[var(--color-brass)]">{call.order.notes || "Brez mer"}</p>
            </article>
          ))}
        </section>
      ) : null}
      {tab === "dnevnik" ? (
        <section className="mt-6" aria-labelledby="klici-naslov">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h2 id="klici-naslov" className="display text-3xl">
              {t("uiKliciNaslov")}
            </h2>
            {log.length > 0 ? (
              <p className="text-sm text-[var(--color-moss)]">
                {vstavi(t("uiKliciStevilo"), { n: log.length })}
                {" · "}
                {t("kratkiKlici")}
                {": "}
                {delez.odstotki}
                {" %"}
              </p>
            ) : null}
          </div>
          {log.length === 0 ? (
            <div className="mt-5">
              <StanjePrazno
                naslov={t("uiKliciPraznoNaslov")}
                opis={t("uiKliciPraznoOpis")}
                dejanje={{
                  oznaka: t("uiKliciPraznoGumb"),
                  onClick: () => pojdi("klic"),
                }}
              />
            </div>
          ) : (
            <ul className={`${PLOSCA} mt-5 divide-y divide-[var(--color-rule)] overflow-hidden`} data-seznam-klicev="1">
              {razvrstiKlice(log).map((call) => (
                <VrsticaKlica
                  call={call}
                  onOdpri={() => {
                    setActive(call);
                    setIzSeznama(true);
                    setTab("klic");
                  }}
                  key={call.callSid}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}
      {tab === "zapiski" ? <ZapiskiPanel onError={setError} /> : null}
      {tab === "telefon" ? (
        // naloga 16: zaslon ima sam dva stolpca (levo nastavitve, desno QR, koda in vnos kode), zato ni ozke kartice
        <PoveziTelefon onError={setError} />
      ) : null}
      {tab === "linija" ? (
        <section className="mt-5 max-w-xl rounded-3xl bg-[var(--color-sheet)] p-5">
          <h2 className="display text-3xl">{open ? t("linijaNaslovOdprta") : t("linijaNaslovZaprta")}</h2>
          <p className="mt-2 text-sm">{t("linijaPojasnilo")}</p>
          {kazatiNamigZaVajo({
            odprta: open,
            steviloKlicev: log.length,
          }) ? (
            <p className="mt-2 text-sm font-medium" role="status">
              {t("vajaPredOdprtjem")}
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy}
            className="mt-4 rounded-full bg-[var(--color-signal-fill)] px-4 py-3 text-sm text-white"
            onClick={() => void saveLine(!open, catalog)}
          >
            {open ? t("linijaZapri") : t("linijaOdpri")}
          </button>
          {line.odprtje.stanje === "cakaGlas" ? (
            <div className="mt-3 text-sm" role="status" aria-live="polite">
              <p>{t("odprtjeCaka")}</p>
              <button
                type="button"
                disabled={busy}
                className="mt-2 rounded-full border border-[var(--color-rule)] px-4 py-2 text-sm"
                onClick={() => {
                  if (window.confirm(t("odprtjePotrdi"))) saveLine(true, catalog, true);
                }}
              >
                {t("odpriBrezGlasu")}
              </button>
            </div>
          ) : null}
          {line.odprtje.stanje === "odprtaBrezGlasu" ? (
            <p className="mt-3 text-sm" role="status">
              {t("odprtjeBrezGlasu")}
            </p>
          ) : null}
          <p className="mt-4 text-sm" role="status" aria-live="polite">
            <span className="font-medium">{t("glasNaslov")}:</span>{" "}
            {line.glas.pripravljen
              ? t("glasPripravljen")
              : line.glas.vTeku
                ? `${t("glasPripravljam")} ${line.glas.pripravljenih}/${line.glas.vseh}`
                : t(line.glas.razlog || "glasPripravljam")}
          </p>
          <VajaKlica busy={busy} nacin={pravila.nacinKlica} onError={setError} onBusy={setBusy} />
        </section>
      ) : null}
      {tab === "nastavitve" ? (
        <div className="mt-6">
          <div>
            <h2 className="display text-3xl">{t("uiNastavitveNaslov")}</h2>
            <p className="mt-1 max-w-prose text-sm text-[var(--color-moss)]">{t("uiNastavitveUvod")}</p>
            <div className="mt-3">
              <JezikPreklop />
            </div>
          </div>
          <NastavitveVsebina
            pravila={pravila}
            mind={mind}
            place={place}
            busy={busy}
            zacetno={podoknoNast}
            onPravila={setPravila}
            onNaslovStreznika={(javniNaslov) => {
              osnovaPravil.current = { ...osnovaPravil.current, javniNaslov };
            }}
            onSave={() => void saveRules()}
            onBrain={(b) => {
              setMind(b);
              void router.invalidate();
            }}
            onPlace={setPlace}
            onError={setError}
            onBusy={setBusy}
          />
        </div>
      ) : null}
    </main>
  );
}

const VRSTE_PREUSMERITVE: Array<[VrstaPreusmeritve, "iphoneNeodgovor" | "iphoneZasedeno" | "iphoneNedosegljiv"]> = [
  ["neodgovor", "iphoneNeodgovor"],
  ["zasedeno", "iphoneZasedeno"],
  ["nedosegljiv", "iphoneNedosegljiv"],
];

/** Ukazni nizi so iz preverjenega seznama (iphone.ts); operaterja brez vira pokaze samo napotek na njegova navodila. */
function NizOperaterja({ operater }: { operater: Operater }) {
  const mesto = t("iphoneStevilkaMesto");
  return (
    <ul className="mt-2 grid gap-1.5 text-sm">
      {VRSTE_PREUSMERITVE.map(([vrsta, oznaka]) => {
        const predpona = operater.vklop[vrsta];
        if (!predpona) return null;
        const izklop = operater.izklop[vrsta];
        return (
          <li className="break-words" key={vrsta}>
            {t(oznaka)}
            {": "}
            <code className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[0.85em]">
              {nizZaVklop(predpona, mesto)}
            </code>
            {izklop ? (
              <>
                {" "}
                ({t("iphoneIzklop")}
                {": "}
                <code className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[0.85em]">
                  {izklop}
                </code>
                )
              </>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function IphoneNavodila() {
  const telekom = PREVERJENI_OPERATERJI.find((o) => o.id === "telekom");
  const telemach = PREVERJENI_OPERATERJI.find((o) => o.id === "telemach");
  return (
    <Razdelek id="iphone" naslov={t("iphoneNaslov")} opis={t("iphoneUvod")}>
      <ol className="grid gap-4 text-sm leading-relaxed">
        <li>{t("iphoneKorak1")}</li>
        <li>
          {t("iphoneKorak2")}
          <div className="mt-3 grid gap-4 border-l-2 border-[var(--color-rule)] pl-4">
            {telekom ? (
              <div>
                <p className="font-medium">{t("iphoneTelekom")}</p>
                <NizOperaterja operater={telekom} />
              </div>
            ) : null}
            {telemach ? (
              <div>
                <p className="font-medium">{t("iphoneTelemach")}</p>
                <NizOperaterja operater={telemach} />
              </div>
            ) : null}
            <p>{t("iphoneA1")}</p>
            <p>{t("iphoneDrugi")}</p>
          </div>
        </li>
        <li>{t("iphoneKorak3")}</li>
      </ol>
      <Podrazdelek naslov={t("iphoneOmejitveNaslov")}>
        <ul className="grid list-disc gap-2 pl-5 text-sm leading-relaxed">
          <li>{t("iphoneOmej1")}</li>
          <li>{t("iphoneOmej2")}</li>
          <li>{t("iphoneOmej3")}</li>
          <li>{t("iphoneOmej4")}</li>
          <li>{t("iphoneOmej6")}</li>
          <li>{t("iphoneOmej5")}</li>
        </ul>
      </Podrazdelek>
      <p className="mt-4 text-xs text-[var(--color-moss)]">{t("iphoneViri")}</p>
    </Razdelek>
  );
}

function Settings({
  brain,
  busy,
  onBrain,
  onError,
  onBusy,
}: {
  brain: BrainPublic;
  busy: boolean;
  onBrain: (brain: BrainPublic) => void;
  onError: (message: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [provider, setProvider] = useState<BrainProvider>(brain.provider ?? "grok");
  const [model, setModel] = useState(brain.model || DEFAULT_BRAIN_MODELS[brain.provider ?? "grok"]);
  // Lastnik 24. 11. 2026: model izbere Lina sama; rocni vnos (Napredno) velja samo, ce ga uporabnik spremeni.
  const [rocniModel, setRocniModel] = useState(false);
  const [key, setKey] = useState("");
  const [project, setProject] = useState(brain.projekt ?? "");
  const [location, setLocation] = useState(brain.lokacija || "global");
  const [note, setNote] = useState("");
  const [dela, setDela] = useState("");
  const vertex = provider === "vertex";
  const omniroute = provider === "omniroute";
  const omZapis = brain.shranjeni?.find((p) => p.provider === "omniroute");
  const [omNaslovVnos, setOmNaslovVnos] = useState(omZapis?.naslov ?? OMNIROUTE_PRIVZETI_NASLOV);
  // Za klice samo izrecna izbira (AGENTS.md »OmniRoute kot ponudnik mozganov«): privzeto ne, razen ce je OmniRoute ze za klice.
  const [omZaKlice, setOmZaKlice] = useState(brain.provider === "omniroute");
  // Ključ velja za posameznega ponudnika: prazno polje ohrani shranjenega, ce ga ima IZBRANI ponudnik.
  const imaKljuc = brain.shranjeni ? brain.shranjeni.some((p) => p.provider === provider) : brain.provider === provider && brain.nastavljen;
  useEffect(() => {
    setProvider(brain.provider ?? "grok");
    setModel(brain.model || DEFAULT_BRAIN_MODELS[brain.provider ?? "grok"]);
    setProject(brain.projekt ?? "");
    setLocation(brain.lokacija || "global");
    setOmZaKlice(brain.provider === "omniroute");
    if (omZapis?.naslov) setOmNaslovVnos(omZapis.naslov);
    // Odvisnost so VREDNOSTI, ne predmet: osvezitev nalagalnika (vsake 3 s med pripravo glasu) ne sme pobrisati izbire v teku.
  }, [brain.provider, brain.model, brain.projekt, brain.lokacija, omZapis?.naslov]);
  async function save(samodejniProjekt?: string) {
    onBusy(true);
    setDela("shrani");
    onError("");
    setNote("");
    try {
      const next = await saveBrainFn({
        data: {
          provider,
          model: rocniModel ? model : "",
          key,
          project: samodejniProjekt ?? project,
          location,
          samodejno: !rocniModel,
          ...(omniroute ? { naslov: omNaslovVnos, zaKlice: omZaKlice } : {}),
        },
      });
      onBrain(next);
      setKey("");
      setRocniModel(false);
      const shranjeno = samodejniProjekt ? t("gpProjektSam") : vertex ? t("uiShranjenoVertex") : next.nastavljen ? t("uiShranjenoKljuc") : t("uiShranjenoBrezKljuca");
      setNote(next.sporociloModela ? `${shranjeno} ${next.sporociloModela}` : shranjeno);
    } catch (cause) {
      onError(fault(cause));
    } finally {
      onBusy(false);
      setDela("");
    }
  }
  async function probe() {
    onBusy(true);
    setDela("preveri");
    onError("");
    setNote("");
    try {
      const result = await checkBrainFn({
        data: {
          provider,
          model,
          key,
          project,
          location,
          ...(omniroute ? { naslov: omNaslovVnos } : {}),
        },
      });
      setNote(sporociloStreznika(result.sporocilo));
      if (!result.ok) onError(sporociloStreznika(result.sporocilo));
    } catch (cause) {
      onError(fault(cause));
    } finally {
      onBusy(false);
      setDela("");
    }
  }
  return (
    <Razdelek
      id="nast-mozgani"
      naslov={t("uiMozganiNaslov")}
      opis={
        vertex ? (
          t("uiMozganiVertex")
        ) : (
          <>
            {t("uiMozganiKljucOpis")}
            {provider === "openrouter" ? <span className="mt-1 block">{t("uiMozganiOpenRouter")}</span> : null}
            {omniroute ? <span className="mt-1 block">{t("omPonudnikOpis")}</span> : null}
            {brain.shranjeni && brain.shranjeni.length > 0 ? (
              <span className="mt-1 block">
                {t("uiMozganiShranjeni")}:{" "}
                {brain.shranjeni
                  .map((p) => `${IME_PONUDNIKA[p.provider]}${p.namig ? ` (…${p.namig})` : p.projekt ? ` (${p.projekt})` : ""}`)
                  .join(", ")}
              </span>
            ) : null}
            <span className="mt-1 block">{t("uiMozganiIzbira")}</span>
            {brain.namig ? (
              <span className="mt-1 block">{vstavi(t("uiMozganiShranjenKonec"), { namig: `…${brain.namig}` })}</span>
            ) : null}
            {brain.zamenjavaModela ? <span className="mt-1 block">{brain.zamenjavaModela}</span> : null}
          </>
        )
      }
    >
      {/* A1 (24. 11. 2026): ta izbira velja za KLICE; model za asistentko je v razdelku pod njim. */}
      <h3 className="mb-3 text-base font-semibold text-[var(--color-ink)]">{tM("naslovKlici")}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={OZNAKA_POLJA} htmlFor="ponudnik">
          {t("uiPonudnik")}
          <select
            id="ponudnik"
            value={provider}
            onChange={(event) => {
              const next = event.target.value as BrainProvider;
              setProvider(next);
              setModel(DEFAULT_BRAIN_MODELS[next]);
              setRocniModel(false);
              if (next === "vertex" && !location.trim()) setLocation(DEFAULT_VERTEX_LOCATION);
            }}
            className={POLJE}
          >
            <option value="gemini">{t("uiPonudnikGemini")}</option>
            <option value="vertex">{t("uiPonudnikVertex")}</option>
            <option value="openai">OpenAI</option>
            <option value="claude">Claude</option>
            <option value="grok">Grok</option>
            <option value="openrouter">OpenRouter</option>
            <option value="omniroute">OmniRoute</option>
          </select>
        </label>
        <details className="sm:col-span-2">
          <summary className="cursor-pointer text-sm font-medium text-[var(--color-ink)]">{t("uiNapredno")}</summary>
          <label className={`${OZNAKA_POLJA} mt-2`} htmlFor="model">
            {t("uiModel")}
            <input
              id="model"
              value={model}
              list={omniroute ? "omniroute-modeli" : undefined}
              aria-describedby="model-samodejno"
              onChange={(event) => {
                setModel(event.target.value);
                setRocniModel(true);
              }}
              className={POLJE}
            />
          </label>
          {omniroute ? (
            <datalist id="omniroute-modeli">
              {(omZapis?.modeli ?? []).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          ) : null}
          <p id="model-samodejno" className="mt-1 text-xs text-[var(--color-moss)]">
            {t("uiModelSamodejno")}
          </p>
        </details>
        {omniroute ? (
          <>
            <label className={`${OZNAKA_POLJA} sm:col-span-2`} htmlFor="omniroute-naslov">
              {t("omPonudnikNaslov")}
              <input
                id="omniroute-naslov"
                value={omNaslovVnos}
                autoComplete="off"
                inputMode="url"
                onChange={(event) => setOmNaslovVnos(event.target.value)}
                className={POLJE}
              />
            </label>
            <p role="note" className="sm:col-span-2 text-sm text-[var(--color-ink)]">
              {t("omPonudnikOpozorilo")}
            </p>
            <label className="sm:col-span-2 flex items-start gap-2 text-sm text-[var(--color-ink)]" htmlFor="omniroute-klici">
              <input id="omniroute-klici" type="checkbox" checked={omZaKlice} onChange={(event) => setOmZaKlice(event.target.checked)} className="mt-1" />
              {t("omPonudnikZaKlice")}
            </label>
          </>
        ) : null}
        {vertex ? (
          <>
            <label className={OZNAKA_POLJA} htmlFor="projekt">
              {t("uiProjekt")}
              <input
                id="projekt"
                value={project}
                autoComplete="off"
                onChange={(event) => setProject(event.target.value)}
                className={POLJE}
              />
            </label>
            <label className={OZNAKA_POLJA} htmlFor="lokacija">
              {t("uiLokacija")}
              <input
                id="lokacija"
                value={location}
                autoComplete="off"
                onChange={(event) => setLocation(event.target.value)}
                className={POLJE}
              />
            </label>
          </>
        ) : (
          <label className={`${OZNAKA_POLJA} sm:col-span-2`} htmlFor="kljuc">
            {t("uiKljuc")}
            <input
              id="kljuc"
              type="password"
              autoComplete="off"
              value={key}
              placeholder={imaKljuc ? t("uiKljucPusti") : t("uiKljucPrilepi")}
              onChange={(event) => setKey(event.target.value)}
              className={POLJE}
            />
          </label>
        )}
      </div>
      {vertex ? (
        <GooglePrijava
          project={project}
          onProject={setProject}
          onError={onError}
          onSamodejniProjekt={(id) => {
            setProject(id);
            void save(id);
          }}
        />
      ) : null}
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          aria-busy={dela === "shrani"}
          onClick={() => void save()}
          className={GUMB}
        >
          {dela === "shrani" ? t("uiShranjujem") : t("uiShrani")}
        </button>
        <button
          type="button"
          disabled={busy}
          aria-busy={dela === "preveri"}
          onClick={() => void probe()}
          className={GUMB_OBROBA}
        >
          {dela === "preveri" ? t("uiTrenutek") : vertex ? t("uiPreveriPrijavo") : t("uiPreveriKljuc")}
        </button>
      </div>
      {note ? (
        <p className="mt-3 text-sm" role="status">
          {note}
        </p>
      ) : null}
    </Razdelek>
  );
}

function StoragePanel({
  place,
  busy,
  onPlace,
  onError,
  onBusy,
}: {
  place: StorageView;
  busy: boolean;
  onPlace: (place: StorageView) => void;
  onError: (message: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [pathValue, setPathValue] = useState(place.mapa);
  const [note, setNote] = useState("");
  useEffect(() => {
    setPathValue(place.mapa);
  }, [place.mapa]);
  async function choose() {
    onBusy(true);
    onError("");
    setNote("");
    try {
      const next = await chooseStorageFn({ data: { mapa: pathValue } });
      onPlace(next);
      setPathValue(next.mapa);
      if (!next.ok) onError(next.razlog);
      else setNote(t("uiMapaPreklopljena"));
    } catch (cause) {
      onError(fault(cause));
    } finally {
      onBusy(false);
    }
  }
  return (
    <Razdelek id="nast-shranjevanje" naslov={t("uiShranjevanjeNaslov")}>
      <p className="text-xs font-medium text-[var(--color-brass)]">{t("uiTrenutnaMapa")}</p>
      <p className="mt-1 font-mono text-sm break-all text-[var(--color-ink)]">{place.mapa}</p>
      <label className={`${OZNAKA_POLJA} mt-5`} htmlFor="mapa">
        {t("uiNovaMapa")}
        <input id="mapa" value={pathValue} onChange={(event) => setPathValue(event.target.value)} className={POLJE} />
      </label>
      <button type="button" disabled={busy} onClick={() => void choose()} className={`${GUMB} mt-4`}>
        {t("uiIzberiMapo")}
      </button>
      {place.opozorila.map((item) => (
        <p className="mt-3 text-sm text-[var(--color-brass)]" role="note" key={item}>
          {item}
        </p>
      ))}
      {place.kljucBrezPravic ? <p className="mt-3 text-sm text-[var(--color-signal)]" role="note">{t("kljucBrezPravic")}</p> : null}
      {note ? (
        <p className="mt-3 text-sm" role="status">
          {note}
        </p>
      ) : null}
    </Razdelek>
  );
}

function casZapiska(iso: string): string {
  return casKlica(iso);
}

/** Oddelek »Zapiski«: seznam po casu, izbira vec zapiskov, Zdruzi in »Odpri« v vrstici vsakega zapiska. */
function ZapiskiPanel({ onError }: { onError: (message: string) => void }) {
  const [seznam, setSeznam] = useState<Zapisek[] | null>(null);
  const [izbrani, setIzbrani] = useState<string[]>([]);
  const [odstrani, setOdstrani] = useState(false);
  const [odprt, setOdprt] = useState<ZapisekVsebina | null>(null);
  // Posnetek odprtega klica (data URL) ali razlog, zakaj ga ni mogoce predvajati.
  const [posnetek, setPosnetek] = useState<{ url: string; razlog: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const naslovRef = useRef<HTMLHeadingElement | null>(null);
  async function naloziSeznam() {
    try {
      const vsi = await seznamZapiskovFn();
      setSeznam(vsi);
      setIzbrani((prej) => prej.filter((id) => vsi.some((z) => z.id === id)));
    } catch (cause) {
      onError(fault(cause));
    }
  }
  useEffect(() => {
    naloziSeznam();
  }, []);
  useEffect(() => {
    if (odprt) naslovRef.current?.focus();
  }, [odprt]);
  function preklopi(id: string) {
    setIzbrani((prej) => (prej.includes(id) ? prej.filter((x) => x !== id) : [...prej, id]));
  }
  async function odpri(id: string) {
    onError("");
    setPosnetek(null);
    try {
      setOdprt(await preberiZapisekFn({ data: { id } }));
      if (seznam?.find((z) => z.id === id)?.posnetek) {
        const p = await preberiPosnetekFn({ data: { id } });
        setPosnetek({ url: p.ok ? p.url : "", razlog: p.ok ? "" : p.razlog });
      }
    } catch (cause) {
      onError(fault(cause));
    }
  }
  // Stevilo klicev istega klicatelja (brez zdruzenih zapiskov); gumb za povzetek je pri najnovejsem zapisku klicatelja.
  const klicevKlicatelja = new Map<string, number>();
  for (const z of seznam ?? []) if (!z.zdruzen) klicevKlicatelja.set(z.klicatelj, (klicevKlicatelja.get(z.klicatelj) ?? 0) + 1);
  const prviKlicatelja = new Set<string>();
  const zGumbom = new Set<string>();
  for (const z of [...(seznam ?? [])].sort((a, b) => b.cas.localeCompare(a.cas))) {
    if (z.zdruzen || prviKlicatelja.has(z.klicatelj)) continue;
    prviKlicatelja.add(z.klicatelj);
    if ((klicevKlicatelja.get(z.klicatelj) ?? 0) > 1) zGumbom.add(z.id);
  }
  async function povzemi(kljuc: string) {
    setBusy(true);
    onError("");
    try {
      const izid = await povzetekKlicateljaFn({ data: { kljuc } });
      setOdprt({ id: `povzetek-${kljuc}`, naslov: izid.naslov, cas: new Date().toISOString(), vsebina: izid.besedilo });
    } catch (cause) {
      onError(fault(cause));
    } finally {
      setBusy(false);
    }
  }
  async function odpriMapo() {
    onError("");
    try {
      const izid = await odpriMapoZapiskovFn();
      if (!izid.ok) setNote(`${izid.razlog} ${izid.mapa}`);
    } catch (cause) {
      onError(fault(cause));
    }
  }
  async function zdruzi() {
    setBusy(true);
    onError("");
    setNote("");
    try {
      await zdruziZapiskeFn({
        data: {
          ids: izbrani,
          odstrani,
        },
      });
      setIzbrani([]);
      setOdstrani(false);
      setNote(t("zapiskiZdruzeno"));
      await naloziSeznam();
    } catch (cause) {
      onError(fault(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" aria-label={t("zapiskiTab")}>
      <div className="grid content-start gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">{t("zapiskiNamig")}</p>
          <button type="button" onClick={() => void odpriMapo()} className={`${GUMB_OBROBA} shrink-0 ${FOKUS}`}>
            {t("zapiskiOdpriMapo")}
          </button>
        </div>
        {seznam === null ? <p className="text-sm">{t("zapiskiNalaganje")}</p> : null}
        {seznam?.length === 0 ? <p className="text-sm">{t("zapiskiPrazno")}</p> : null}
        {seznam && seznam.length > 0 ? (
          <ul className="grid gap-2" aria-label={t("zapiskiSeznam")}>
            {seznam.map((z) => (
              <li className="flex items-start gap-3 rounded-2xl bg-[var(--color-surface)]/80 p-3" key={z.id}>
                <input
                  type="checkbox"
                  className={`mt-1 h-5 w-5 shrink-0 ${FOKUS}`}
                  checked={izbrani.includes(z.id)}
                  onChange={() => preklopi(z.id)}
                  aria-label={`${t("zapiskiIzberi")}: ${z.naslov}`}
                />
                <div className="min-w-0 flex-1">
                  {z.nujno ? (
                    <p className="mb-1">
                      <NujnoOznaka />
                    </p>
                  ) : null}
                  <p className="break-words text-sm">{z.naslov}</p>
                  <p className="text-xs text-[var(--color-brass)]">
                    {casZapiska(z.cas)}
                    {z.zdruzen ? ` · ${t("zapiskiZdruzenOznaka")}` : ""}
                    {!z.zdruzen && (klicevKlicatelja.get(z.klicatelj) ?? 0) > 1 ? ` · ${t("zapiskiKlicev")}: ${klicevKlicatelja.get(z.klicatelj)}` : ""}
                  </p>
                  {zGumbom.has(z.id) ? (
                    <button type="button" disabled={busy} onClick={() => void povzemi(z.klicatelj)} className={`mt-2 ${GUMB_OBROBA} ${FOKUS}`}>
                      {t("zapiskiPovzetek")}
                    </button>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void odpri(z.id)}
                  aria-label={`${t("zapiskiOdpri")}: ${z.naslov}`}
                  className={`${GUMB_OBROBA} shrink-0 ${FOKUS}`}
                >
                  {t("zapiskiOdpri")}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {seznam && seznam.length > 1 ? (
          <div className="grid gap-2 rounded-2xl bg-[var(--color-sheet)] p-4">
            <p className="text-sm" aria-live="polite">
              {t("zapiskiIzbranih")}
              {": "}
              {izbrani.length}
            </p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className={`mt-1 h-5 w-5 ${FOKUS}`}
                checked={odstrani}
                onChange={(e) => setOdstrani(e.target.checked)}
              />
              <span>
                {t("zapiskiOdstrani")}
                <span className="block text-xs text-[var(--color-brass)]">{t("zapiskiOdstraniNamig")}</span>
              </span>
            </label>
            <div>
              <button
                type="button"
                disabled={busy || izbrani.length < 2}
                onClick={() => void zdruzi()}
                className={`${GUMB} ${FOKUS}`}
              >
                {t("zapiskiZdruzi")}
              </button>
            </div>
            {izbrani.length < 2 ? <p className="text-xs text-[var(--color-brass)]">{t("zapiskiMalo")}</p> : null}
            {note ? (
              <p className="text-sm" role="status">
                {note}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {odprt ? (
        <article className="min-w-0 rounded-2xl bg-[var(--color-sheet)] p-5" aria-labelledby="zapisek-naslov">
          <div className="flex items-start justify-between gap-3">
            <h2 id="zapisek-naslov" ref={naslovRef} tabIndex={-1} className="display text-2xl break-words outline-none">
              {odprt.naslov}
            </h2>
            <button
              type="button"
              onClick={() => {
                setOdprt(null);
                setPosnetek(null);
              }}
              className={`${GUMB_OBROBA} shrink-0 ${FOKUS}`}
            >
              {t("zapiskiZapri")}
            </button>
          </div>
          {posnetek ? (
            <div className="mt-4">
              <p className="text-sm font-semibold">{t("posnetekKlica")}</p>
              {posnetek.url ? (
                <audio controls preload="none" src={posnetek.url} className="mt-2 w-full" aria-label={t("posnetekKlica")} />
              ) : (
                <p className="mt-1 text-sm">{posnetek.razlog}</p>
              )}
            </div>
          ) : null}
          <pre className="mt-4 text-sm break-words whitespace-pre-wrap">
            {odprt.vsebina.replace(/^<!--\s*lina-[a-z]+:.*-->\n?/gm, "")}
          </pre>
        </article>
      ) : null}
    </section>
  );
}

/** Nastavitev mape zapiskov: polna pot (nikoli ~), »Odpri mapo« in, ce odpiranje ne gre, kopiranje poti. */
function MapaZapiskovPanel({ onError }: { onError: (message: string) => void }) {
  const [pogled, setPogled] = useState<MapaZapiskov | null>(null);
  const [napakaNalaganja, setNapakaNalaganja] = useState("");
  const [poskus, setPoskus] = useState(0);
  const [vnos, setVnos] = useState("");
  const [note, setNote] = useState("");
  const [neOdpre, setNeOdpre] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let ziv = true;
    setNapakaNalaganja("");
    pogledMapeZapiskovFn()
      .then((p) => {
        if (!ziv) return;
        setPogled(p);
        setVnos(p.jePrivzeta ? "" : p.mapa);
      })
      .catch((cause) => {
        if (!ziv) return;
        setNapakaNalaganja(fault(cause));
        onError(fault(cause));
      });
    return () => {
      ziv = false;
    };
  }, [onError, poskus]);
  async function shrani(izbira: string) {
    setBusy(true);
    onError("");
    setNote("");
    setNeOdpre(false);
    try {
      const izid = await izberiMapoZapiskovFn({ data: { mapa: izbira } });
      if (!izid.ok) onError(izid.razlog);
      else {
        setPogled(izid);
        setVnos(izid.jePrivzeta ? "" : izid.mapa);
        setNote(t("mapaSpremenjena"));
      }
    } catch (cause) {
      onError(fault(cause));
    } finally {
      setBusy(false);
    }
  }
  async function odpriMapo() {
    onError("");
    setNote("");
    try {
      const izid = await odpriMapoZapiskovFn();
      setNeOdpre(!izid.ok);
      if (!izid.ok) setNote(izid.razlog);
    } catch (cause) {
      onError(fault(cause));
    }
  }
  async function kopiraj() {
    try {
      await navigator.clipboard.writeText(pogled?.mapa ?? "");
      setNote(t("mapaKopirano"));
    } catch {
      setNote("");
    }
  }
  return (
    <Razdelek id="mapa-zapiskov" naslov={t("mapaNaslov")}>
      {!pogled && napakaNalaganja ? (
        <StanjeNapaka
          naslov={t("uiNalaganjeNapaka")}
          razlog={napakaNalaganja}
          onPonovi={() => setPoskus((n) => n + 1)}
        />
      ) : null}
      {!pogled && !napakaNalaganja ? <StanjeNalaganja /> : null}
      {pogled ? (
        <>
          <p className="text-xs font-medium text-[var(--color-brass)]">{t("mapaTrenutna")}</p>
          <p className="mt-1 font-mono text-sm break-all text-[var(--color-ink)]">{pogled.mapa}</p>
          {pogled.jePrivzeta ? <p className="mt-1 text-xs text-[var(--color-moss)]">{t("mapaPrivzeta")}</p> : null}
          <label className={`${OZNAKA_POLJA} mt-5`} htmlFor="mapa-zapiskov-vnos">
            {t("mapaNova")}
            <input
              id="mapa-zapiskov-vnos"
              value={vnos}
              onChange={(event) => setVnos(event.target.value)}
              className={POLJE}
            />
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void shrani(vnos)} className={GUMB}>
              {t("mapaShrani")}
            </button>
            <button type="button" onClick={() => void odpriMapo()} className={GUMB_OBROBA}>
              {t("mapaOdpri")}
            </button>
            {!pogled.jePrivzeta ? (
              <button type="button" disabled={busy} onClick={() => void shrani("")} className={GUMB_OBROBA}>
                {t("mapaPrivzetaGumb")}
              </button>
            ) : null}
            {neOdpre ? (
              <button type="button" onClick={() => void kopiraj()} className={GUMB_OBROBA}>
                {t("mapaKopiraj")}
              </button>
            ) : null}
          </div>
          {pogled.opozorila.map((item) => (
            <p className="mt-3 text-sm text-[var(--color-brass)]" role="note" key={item}>
              {item}
            </p>
          ))}
          {note ? (
            <p className="mt-3 text-sm" role="status">
              {note}
            </p>
          ) : null}
        </>
      ) : null}
    </Razdelek>
  );
}

const DRUGI_KRAJ = "__kraj__";

/**
 * Razlog odsotnosti: izbira iz zaprtega kataloga ali kraj (predlog v, na ali pri in 1 do 3 besede z veliko zacetnico, samo crke). Prostega
 * besedila ni (pregled 15. 11. 2026). Shranjen razlog, ki ne prestane preverbe, se ne zavrze tiho: pokaze se »razlog ni veljaven, izberite iz seznama«.
 */
function OdsotnostRazlog({ vrednost, onChange }: { vrednost: string; onChange: (razlog: string) => void }) {
  const [drugKraj, setDrugKraj] = useState(false);
  const napaka = vrednost.trim() ? razlogOdsotnosti(vrednost) : null;
  const izKataloga = RAZLOGI_KATALOG.includes(vrednost);
  const jeKraj = vrednost.trim() !== "" && !izKataloga && napaka === null;
  const kazeKraj = drugKraj || jeKraj;
  const neveljavenShranjen = !kazeKraj && vrednost.trim() !== "" && napaka !== null;
  const izbira = izKataloga ? vrednost : kazeKraj ? DRUGI_KRAJ : "";
  return (
    <div className="mt-3">
      <label className={OZNAKA_POLJA} htmlFor="odsotnostRazlog">
        {t("odsotnostRazlogNaslov")}
        <select
          id="odsotnostRazlog"
          value={izbira}
          onChange={(event) => {
            const izbrano = event.target.value;
            if (izbrano === DRUGI_KRAJ) {
              setDrugKraj(true);
              onChange("");
              return;
            }
            setDrugKraj(false);
            onChange(izbrano);
          }}
          className={POLJE}
        >
          <option value="">{t("odsotnostRazlogIzberi")}</option>
          {RAZLOGI_KATALOG.map((razlog) => (
            <option key={razlog} value={razlog}>
              {razlog}
            </option>
          ))}
          <option value={DRUGI_KRAJ}>{t("odsotnostRazlogDrugKraj")}</option>
        </select>
      </label>
      {neveljavenShranjen ? (
        <p role="alert" className="mt-1.5 text-xs text-[var(--color-signal)]">
          {t("odsotnostRazlogShranjenNeveljaven")}
        </p>
      ) : null}
      {kazeKraj ? (
        <label className={`${OZNAKA_POLJA} mt-3`} htmlFor="odsotnostKraj">
          {t("odsotnostKrajNaslov")}
          <input
            id="odsotnostKraj"
            value={vrednost}
            maxLength={80}
            aria-invalid={napaka !== null}
            onChange={(event) => onChange(event.target.value)}
            className={POLJE}
          />
        </label>
      ) : null}
      {kazeKraj && napaka ? (
        <p role="alert" className="mt-1.5 text-xs text-[var(--color-signal)]">
          {napaka}
        </p>
      ) : null}
    </div>
  );
}

/** Casovni pas uporabnika (IANA); ura odsotnosti se izgovori po njem. */
function casovniPasUporabnika(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Ljubljana";
  } catch {
    return "Europe/Ljubljana";
  }
}

/** ISO (UTC) -> vrednost polja datetime-local v lokalnem casu uporabnika. */
function isoVLokalnoUro(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Vrednost polja datetime-local (lokalni cas uporabnika) -> ISO (UTC); prazno ostane prazno (brez konca). */
function lokalnoUroVIso(vrednost: string): string {
  if (!vrednost) return "";
  const d = new Date(vrednost);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/** Podrobnosti klica (zapisnik): glava s stanjem, nato klicatelj, povpraševanje, sporočilo in povzetek. Deli so loceni s crto. */
function Slip({ call }: { call: CallSession | null }) {
  // Osebni nacin: sporocilo, ne narocilo (brez izdelka, materiala, kolicine, mer, roka in »Potrjeno/Osnutek«).
  const osebno = call?.nacin === "osebna";
  if (!call)
    return (
      <aside className="min-w-0" aria-label={t("uiZapisnik")}>
        <StanjePrazno naslov={t("uiNiIzbranegaNaslov")} opis={t("uiNiIzbranegaOpis")} />
      </aside>
    );
  const order = call.order;
  const stanje = stanjeKlica(call);
  const cas = casKlica(call.startedAt);
  const imaSporocilo = Boolean(order.tajnica?.razlog || order.tajnica?.sporocilo || call.odsotnostPovedana?.length);
  return (
    <aside className={`${PLOSCA} min-w-0 p-5 sm:p-7`} aria-labelledby="zapisnik-naslov" data-podrobnosti-klica="1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium tracking-wide text-[var(--color-brass)] uppercase">{t("uiZapisnik")}</p>
        {osebno ? (
          <Znacka ton={call.status === "v-teku" ? "signal" : order.tajnica?.sporocilo ? "moss" : "brass"}>
            {call.status === "v-teku"
              ? t("uiStanjeVTeku")
              : order.tajnica?.sporocilo
                ? t("dnevnikSporocilo")
                : t("dnevnikBrezSporocila")}
          </Znacka>
        ) : (
          <Znacka ton={stanje.ton}>{t(stanje.oznaka)}</Znacka>
        )}
        {order.tajnica?.nujno ? <NujnoOznaka /> : null}
      </div>
      <h2 id="zapisnik-naslov" className="display mt-2 text-3xl leading-tight break-words">
        {order.customerName || t("uiBrezImena")}
      </h2>
      {cas ? <p className="mt-1 text-sm text-[var(--color-moss)]">{cas}</p> : null}
      <DelZapisnika naslov={t("uiStrankaNaslov")}>
        <Row label={t("uiTelefon")} value={order.phone || "—"} />
        <Row label={t("uiEposta")} value={order.email || "—"} />
        {!osebno && order.podjetjeKlicatelja ? <Row label={t("zapisekPodjetje")} value={order.podjetjeKlicatelja} /> : null}
        {order.dosegljiv && order.dosegljiv !== "ni-nujno" ? (
          <Row label={t("dosegljivOznaka")} value={order.dosegljiv} />
        ) : null}
      </DelZapisnika>
      {!osebno ? (
        <DelZapisnika naslov={t("uiPovprasevanjeNaslov")}>
          <Row
            label={t("uiIzdelek")}
            value={order.productName || order.requestedProduct || "—"}
            bad={!order.productName && Boolean(order.requestedProduct)}
          />
          <Row
            label={t("uiMaterial")}
            value={order.materialName || order.requestedMaterial || "—"}
            bad={!order.materialName && Boolean(order.requestedMaterial)}
          />
          <Row label={t("uiKolicina")} value={order.quantity ? String(order.quantity) : "—"} />
          <Row label={t("uiMere")} value={order.notes || "—"} />
          <Row label={t("rok")} value={order.deadline || "—"} />
        </DelZapisnika>
      ) : null}
      {!osebno && order.violations.length ? (
        <p
          className="mt-4 rounded-xl border border-[var(--color-signal)] px-3 py-2 text-sm text-[var(--color-signal)]"
          role="note"
        >
          {vstavi(t("uiZunajKataloga"), { seznam: order.violations.join(", ") })}
        </p>
      ) : null}
      {imaSporocilo ? (
        <DelZapisnika naslov={t("zapisekSporocilo")}>
          {order.tajnica?.razlog ? <Row label={t("zapisekRazlog")} value={order.tajnica.razlog} dolg={true} /> : null}
          {order.tajnica?.sporocilo ? (
            <Row label={t("zapisekSporocilo")} value={order.tajnica.sporocilo} dolg={true} />
          ) : null}
          {call.odsotnostPovedana?.length ? (
            <Row label={t("zapisekOdsotnost")} value={call.odsotnostPovedana.join(" ")} dolg={true} />
          ) : null}
        </DelZapisnika>
      ) : null}
      {(call.nujniDogodki ?? []).length > 0 ? (
        <DelZapisnika naslov={t("uiDogodkiNaslov")}>
          {(call.nujniDogodki ?? []).map((d, i) => (
            <Row
              label={t(d.vrsta === "obvestilo" ? "nujniDogodekObvestilo" : "nujniDogodekPrevezava")}
              value={`${uraGlave(new Date(d.cas))}: ${t(IZID_NUJNEGA[d.izid])}`}
              dolg={true}
              key={`${d.cas}-${i}`}
            />
          ))}
        </DelZapisnika>
      ) : null}
      {call.povzetek ? (
        <div className="mt-6 border-t border-[var(--color-rule)] pt-5">
          <h3 className="text-sm font-semibold">{t("povzetekNaslov")}</h3>
          <PovzetekKlica povzetek={call.povzetek} />
        </div>
      ) : null}
      <div className="mt-6 border-t border-[var(--color-rule)] pt-4 text-xs text-[var(--color-moss)]">
        {!osebno && order.oznaka ? <p className="mb-1 text-[var(--color-brass)]">{order.oznaka}</p> : null}
        <p className="break-all">
          {t("uiIdKlica")}
          {": "}
          <span className="font-mono">{call.callSid}</span>
        </p>
      </div>
    </aside>
  );
}

const IZID_NUJNEGA = {
  poslano: "nujniIzidPoslano",
  napaka: "nujniIzidNapaka",
  poskus: "nujniIzidPoskus",
  oglasil: "nujniIzidOglasil",
  neodgovor: "nujniIzidNeodgovor",
  omejeno: "nujniIzidOmejeno",
} as const;

function Row({ label, value, bad, dolg }: { label: string; value: string; bad?: boolean; dolg?: boolean }) {
  return (
    <div className={`min-w-0 ${dolg ? "sm:col-span-2" : ""}`}>
      <dt className="text-xs text-[var(--color-brass)]">{label}</dt>
      <dd className={`mt-0.5 break-words ${bad ? "text-[var(--color-signal)]" : "text-[var(--color-ink)]"}`}>
        {value}
      </dd>
    </div>
  );
}

function SpletPanel({
  busy,
  onBusy,
  onError,
  onCatalog,
}: {
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onError: (message: string) => void;
  onCatalog: (catalog: Catalog) => void;
}) {
  const router = useRouter();
  const [naslov, setNaslov] = useState("");
  const [predlog, setPredlog] = useState<Predlog | null>(null);
  const [strani, setStrani] = useState(0);
  const [bere, setBere] = useState(false);
  useEffect(() => {
    preberiPredlogFn()
      .then((next) => {
        if (!next) return;
        setPredlog(next);
        setStrani(next.strani);
      })
      .catch(() => void 0);
  }, []);
  useEffect(() => {
    if (!bere) return;
    const id = window.setInterval(() => {
      potekSpletaFn()
        .then((stanje) => setStrani(stanje.strani))
        .catch(() => void 0);
    }, 700);
    return () => window.clearInterval(id);
  }, [bere]);
  async function preberi() {
    const vrednost = naslov.trim();
    if (!vrednost) return;
    onBusy(true);
    setBere(true);
    onError("");
    try {
      const next = await preberiSpletFn({ data: { naslov: vrednost } });
      setPredlog(next);
      setStrani(next.strani);
    } catch (cause) {
      onError(fault(cause));
    } finally {
      setBere(false);
      onBusy(false);
    }
  }
  function toggle(id: string) {
    setPredlog((prev) => {
      if (!prev) return prev;
      if (prev.znanje && prev.znanje.id === id)
        return {
          ...prev,
          znanje: {
            ...prev.znanje,
            izbrano: !prev.znanje.izbrano,
          },
        };
      if (prev.eposta && prev.eposta.id === id) return { ...prev, eposta: { ...prev.eposta, izbrano: !prev.eposta.izbrano } };
      if (prev.podjetje.id === id)
        return {
          ...prev,
          podjetje: {
            ...prev.podjetje,
            izbrano: !prev.podjetje.izbrano,
          },
        };
      return {
        ...prev,
        vrstice: prev.vrstice.map((vrstica) =>
          vrstica.id === id
            ? {
                ...vrstica,
                izbrano: !vrstica.izbrano,
              }
            : vrstica,
        ),
      };
    });
  }
  async function potrdi() {
    if (!predlog) return;
    const ids = [
      ...(predlog.podjetje.izbrano ? [predlog.podjetje.id] : []),
      ...(predlog.znanje?.izbrano && predlog.znanje.besedilo ? [predlog.znanje.id] : []),
      ...(predlog.eposta?.izbrano && predlog.eposta.naslov ? [predlog.eposta.id] : []),
      ...predlog.vrstice.filter((vrstica) => vrstica.izbrano).map((vrstica) => vrstica.id),
    ];
    onBusy(true);
    onError("");
    try {
      onCatalog(await potrdiPredlogFn({ data: { ids } }));
      // Potrjena e-posta gre v pravila na strezniku: osvezi pravila, da jih naslednje shranjevanje ne prepise s staro kopijo.
      await router.invalidate();
      setPredlog(null);
      setStrani(0);
    } catch (cause) {
      onError(fault(cause));
    } finally {
      onBusy(false);
    }
  }
  async function zavrzi() {
    onBusy(true);
    onError("");
    try {
      await zavrziPredlogFn();
      setPredlog(null);
      setStrani(0);
    } catch (cause) {
      onError(fault(cause));
    } finally {
      onBusy(false);
    }
  }
  return (
    <div className="grid gap-3 rounded-3xl bg-[var(--color-sheet)] p-4">
      <h2 className="display text-2xl">{t("spletPolje")}</h2>
      <p className="text-sm text-[var(--color-moss)]">{t("spletNamig")}</p>
      <label className="text-sm" htmlFor="splet-naslov">
        {t("spletPolje")}
        <input
          id="splet-naslov"
          value={naslov}
          onChange={(event) => setNaslov(event.target.value)}
          className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2"
        />
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() => void preberi()}
        className="w-fit rounded-full bg-[var(--color-ink-fill)] px-4 py-2 text-sm text-white"
      >
        {bere ? t("spletBerem") : t("spletGumb")}
      </button>
      {bere || strani > 0 ? (
        <p className="text-sm">
          {t("spletNapredek")}
          {": "}
          {strani}
        </p>
      ) : null}
      {predlog?.sporocilo ? <p className="text-sm">{predlog.sporocilo}</p> : null}
      {predlog ? (
        <div className="grid gap-3">
          <h3 className="display text-xl">{t("spletPredlog")}</h3>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={predlog.podjetje.izbrano} onChange={() => toggle(predlog.podjetje.id)} />
            <span>
              <span className="text-[var(--color-brass)]">{t("spletPodjetje")}</span>
              <span className="mt-1 block">{predlog.podjetje.ime}</span>
              {predlog.podjetje.opis ? <span className="mt-1 block">{predlog.podjetje.opis}</span> : null}
              {predlog.podjetje.ure ? (
                <span className="mt-1 block">
                  {t("spletUre")}
                  {": "}
                  {predlog.podjetje.ure}
                </span>
              ) : null}
              {predlog.podjetje.stik ? (
                <span className="mt-1 block">
                  {t("spletStik")}
                  {": "}
                  {predlog.podjetje.stik}
                </span>
              ) : null}
            </span>
          </label>
          {predlog.znanje?.besedilo ? (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={predlog.znanje.izbrano}
                onChange={() => toggle(predlog.znanje?.id ?? "znanje")}
              />
              <span>
                <span className="text-[var(--color-brass)]">{t("spletZnanje")}</span>
                <span className="mt-1 block max-h-48 overflow-y-auto whitespace-pre-wrap">
                  {predlog.znanje.besedilo}
                </span>
              </span>
            </label>
          ) : null}
          {predlog.eposta?.naslov ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={predlog.eposta.izbrano} onChange={() => toggle(predlog.eposta?.id ?? "eposta")} />
              <span>
                <span className="text-[var(--color-brass)]">{t("spletEposta")}</span>
                <span className="mt-1 block">{predlog.eposta.naslov}</span>
                {!naslovNaDomeni(predlog.eposta.naslov, predlog.gostitelj) ? (
                  <span className="mt-1 block text-xs">{t("spletEpostaTuja")}</span>
                ) : null}
                <span className="mt-1 block text-xs">{t("spletEpostaImate")}</span>
              </span>
            </label>
          ) : null}
          {predlog.vrstice.map((vrstica) => (
            <label className="flex items-start gap-2 text-sm" key={vrstica.id}>
              <input type="checkbox" checked={vrstica.izbrano} onChange={() => toggle(vrstica.id)} />
              <span>
                <span className="text-[var(--color-brass)]">
                  {vrstica.vrsta === "material" ? t("spletMaterial") : t("spletIzdelek")}
                </span>
                <span className="mt-1 block">
                  {t("spletIme")}
                  {": "}
                  {vrstica.ime}
                </span>
                {vrstica.opis ? (
                  <span className="mt-1 block">
                    {t("spletOpis")}
                    {": "}
                    {vrstica.opis}
                  </span>
                ) : null}
                {vrstica.material ? (
                  <span className="mt-1 block">
                    {t("spletMaterial")}
                    {": "}
                    {vrstica.material}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void potrdi()}
              className="rounded-full bg-[var(--color-signal-fill)] px-4 py-2 text-sm text-white"
            >
              {t("spletPotrdi")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void zavrzi()}
              className="rounded-full bg-[var(--color-surface)] px-4 py-2 text-sm"
            >
              {t("spletZavrzi")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Veliko besedilno polje »Informacije o podjetju« in nalaganje dokumenta .txt ali .md (branje v brskalniku, nic se ne izvaja). */
function ZnanjePolje({
  catalog,
  busy,
  onChange,
  onError,
}: {
  catalog: Catalog;
  busy: boolean;
  onChange: Dispatch<SetStateAction<Catalog>>;
  onError: (message: string) => void;
}) {
  const [opomba, setOpomba] = useState("");
  const znanje = catalog.znanje ?? "";
  async function naloziDokument(file: File | undefined) {
    if (!file) return;
    onError("");
    setOpomba("");
    try {
      // Velikost se preveri pred branjem: prevelike datoteke se ne nalozi v pomnilnik.
      if (file.size > MEJA_DOKUMENTA_BAJTOV) throw new Error(t("znanjeDokumentVelik"));
      const dokument = preberiDokument(file.name, new Uint8Array(await file.arrayBuffer()));
      const skupaj = dodajBesedilo(znanje, dokument.besedilo);
      onChange({
        ...catalog,
        znanje: skupaj.besedilo,
      });
      if (dokument.skrajsano || skupaj.skrajsano) setOpomba(t("znanjeSkrajsano"));
    } catch (cause) {
      onError(fault(cause));
    }
  }
  return (
    <div className="grid gap-3 rounded-3xl bg-[var(--color-sheet)] p-4">
      <h2 className="display text-2xl">{t("znanjeNaslov")}</h2>
      <p className="text-sm text-[var(--color-moss)]">{t("znanjeNamig")}</p>
      <label className="sr-only" htmlFor="znanje-besedilo">
        {t("znanjeNaslov")}
      </label>
      <textarea
        id="znanje-besedilo"
        value={znanje}
        rows={10}
        maxLength={MEJA_ZNANJA}
        onChange={(event) =>
          onChange({
            ...catalog,
            znanje: event.target.value,
          })
        }
        className="w-full rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2"
      />
      <p className="text-xs text-[var(--color-moss)]">
        {znanje.length}
        {" / "}
        {MEJA_ZNANJA} {t("znanjeZnakov")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label
          className={`w-fit cursor-pointer rounded-full bg-[var(--color-surface)] px-4 py-2 text-sm ${busy ? "pointer-events-none opacity-60" : ""}`}
        >
          {t("znanjeDokument")}
          <input
            type="file"
            accept=".txt,.md,.markdown,text/plain,text/markdown"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              naloziDokument(file);
            }}
          />
        </label>
        {opomba ? <span className="text-sm">{opomba}</span> : null}
      </div>
      <ZnanjeDatoteke catalog={catalog} busy={busy} onChange={onChange} onError={onError} />
    </div>
  );
}

export function Knowledge({
  catalog,
  zacetno,
  busy,
  pravila,
  vrzeli,
  onChange,
  onPravila,
  onVrzeli,
  onSave,
  onSaveRules,
  onError,
  onBusy,
}: {
  catalog: Catalog;
  zacetno?: PodoknoZnanja;
  busy: boolean;
  pravila: Pravila;
  vrzeli: Vrzel[];
  onChange: Dispatch<SetStateAction<Catalog>>;
  onPravila: (pravila: Pravila) => void;
  onVrzeli: (vrzeli: Vrzel[]) => void;
  onSave: () => void;
  onSaveRules: () => void;
  onError: (message: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  function patchCompany(key: keyof Catalog["company"], value: string) {
    onChange({
      ...catalog,
      company: {
        ...catalog.company,
        [key]: value,
      },
    });
  }
  function patchMaterial(index: number, patch: Partial<Material>) {
    const materials = catalog.materials.map((item, itemIndex) =>
      itemIndex === index
        ? {
            ...item,
            ...patch,
          }
        : item,
    );
    onChange({
      ...catalog,
      materials,
    });
  }
  function patchProduct(index: number, patch: Partial<Product>) {
    const products = catalog.products.map((item, itemIndex) =>
      itemIndex === index
        ? {
            ...item,
            ...patch,
          }
        : item,
    );
    onChange({
      ...catalog,
      products,
    });
  }
  function toggleMaterial(productIndex: number, material: Material) {
    const product = catalog.products[productIndex];
    const keys = [material.id, material.name].filter(Boolean);
    patchProduct(productIndex, {
      materialIds: product.materialIds.some(
        (id) => keys.includes(id) || id.toLowerCase() === material.name.toLowerCase(),
      )
        ? product.materialIds.filter((id) => !keys.includes(id) && id.toLowerCase() !== material.name.toLowerCase())
        : [...product.materialIds, material.name || material.id],
    });
  }
  const shraniZnanje = (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={onSave}
        className="rounded-full bg-[var(--color-ink-fill)] px-4 py-2 text-sm text-white"
      >
        {t("uiShraniZnanje")}
      </button>
    </div>
  );
  return (
    <Podokna
      def={ZNANJE}
      zacetno={zacetno}
      podnozje={{
        podjetje: shraniZnanje,
        izdelki: shraniZnanje,
      }}
      razdelki={{
        "zn-podjetje": (
          <div id="zn-podjetje" className="grid gap-3 rounded-3xl bg-[var(--color-sheet)] p-4 sm:grid-cols-2">
            {[
              ["name", "Podjetje"],
              ["trade", "Dejavnost"],
              ["phone", "Telefon"],
              ["address", "Naslov"],
              ["hours", "Ure"],
            ].map(([key, label]) => (
              <label className="text-sm" key={key}>
                {label}
                <input
                  value={catalog.company[key as keyof Catalog["company"]]}
                  onChange={(event) => patchCompany(key as keyof Catalog["company"], event.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2"
                />
              </label>
            ))}
            <label className="text-sm sm:col-span-2">
              O delavnici
              <textarea
                value={catalog.company.about}
                onChange={(event) => patchCompany("about", event.target.value)}
                rows={3}
                className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2"
              />
            </label>
          </div>
        ),
        "znanje-besedilo": <ZnanjePolje catalog={catalog} busy={busy} onChange={onChange} onError={onError} />,
        povprasevanje: (
          <div className="grid gap-3 rounded-3xl bg-[var(--color-sheet)] p-4">
            <h2 className="display text-2xl">{t("cenaNaslov")}</h2>
            <p className="text-sm text-[var(--color-moss)]">{t("cenaNamig")}</p>
            <label className="text-sm" htmlFor="povprasevanje">
              {t("cenaNaslov")}
              <textarea
                id="povprasevanje"
                value={pravila.povprasevanje}
                rows={3}
                onChange={(event) =>
                  onPravila({
                    ...pravila,
                    povprasevanje: event.target.value,
                  })
                }
                className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2"
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={onSaveRules}
              className="w-fit rounded-full bg-[var(--color-ink-fill)] px-4 py-2 text-sm text-white"
            >
              {t("shraniPravila")}
            </button>
          </div>
        ),
        "zn-izdelki": (
          <div id="zn-izdelki" className="grid gap-3 lg:grid-cols-2">
            <div>
              <h2 className="display text-2xl">{t("uiKatMateriali")}</h2>
              {catalog.materials.map((material, index) => (
                <div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2" key={`${material.id}-${index}`}>
                  <input
                    aria-label={t("uiKatImeMateriala")}
                    value={material.name}
                    onChange={(event) => patchMaterial(index, { name: event.target.value })}
                    className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2"
                  />
                  <input
                    aria-label={t("uiKatOpombaMateriala")}
                    value={material.note}
                    onChange={(event) => patchMaterial(index, { note: event.target.value })}
                    className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2"
                  />
                  <button
                    type="button"
                    className="rounded-xl px-3 text-sm"
                    onClick={() =>
                      onChange({
                        ...catalog,
                        materials: catalog.materials.filter((_, item) => item !== index),
                      })
                    }
                  >
                    {t("telOdstrani")}
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="mt-2 text-sm"
                onClick={() =>
                  onChange({
                    ...catalog,
                    materials: [
                      ...catalog.materials,
                      {
                        id: "",
                        name: "",
                        note: "",
                      },
                    ],
                  })
                }
              >
                {t("uiKatDodajMaterial")}
              </button>
            </div>
            <div>
              <h2 className="display text-2xl">{t("uiKatIzdelki")}</h2>
              {catalog.products.map((product, index) => (
                <fieldset className="mt-2 rounded-2xl border border-[var(--color-rule)] p-3" key={`${product.id}-${index}`}>
                  <input
                    aria-label={t("uiKatImeIzdelka")}
                    value={product.name}
                    onChange={(event) => patchProduct(index, { name: event.target.value })}
                    className="w-full rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2"
                  />
                  <input
                    aria-label={t("uiKatVrstaIzdelka")}
                    value={product.kind}
                    onChange={(event) => patchProduct(index, { kind: event.target.value })}
                    placeholder={t("uiKatVrstaPrimer")}
                    className="mt-2 w-full rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {catalog.materials.map((material) => (
                      <label className="flex items-center gap-1 text-xs" key={material.name}>
                        <input
                          type="checkbox"
                          checked={product.materialIds.includes(material.id) || product.materialIds.includes(material.name)}
                          onChange={() => toggleMaterial(index, material)}
                        />
                        {material.name || "brez imena"}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <button
                type="button"
                className="mt-2 text-sm"
                onClick={() =>
                  onChange({
                    ...catalog,
                    products: [
                      ...catalog.products,
                      {
                        id: "",
                        name: "",
                        kind: "",
                        summary: "",
                        materialIds: [],
                      },
                    ],
                  })
                }
              >
                {t("uiKatDodajIzdelek")}
              </button>
            </div>
          </div>
        ),
        "splet-naslov": <SpletPanel busy={busy} onBusy={onBusy} onError={onError} onCatalog={onChange} />,
        "zn-vrzeli": (
          <Vrzeli
            vrzeli={vrzeli}
            busy={busy}
            onError={onError}
            onBusy={onBusy}
            onDone={(nextCatalog, nextGaps) => {
              onChange(nextCatalog);
              onVrzeli(nextGaps);
            }}
          />
        ),
        "zn-kljuci": (
          <div id="zn-kljuci" className="grid gap-5 rounded-3xl bg-[var(--color-sheet)] p-4">
            <h2 className="display text-2xl">{t("znPodKljuci")}</h2>
            <TinyFishKljuc onError={onError} />
            <BraveKljuc onError={onError} />
          </div>
        ),
        "zn-nujni": (
          <div id="zn-nujni" className="grid gap-5 rounded-3xl bg-[var(--color-sheet)] p-4">
            <h2 className="display text-2xl">{t("nujnoOznaka")}</h2>
            <NujniKlici onError={onError} />
            {/* Urnik prevezave velja tudi za nujne klice (pregled 0.2.10, najdba 3): isto stikalo kot v Pravilih klicev, tudi tu. */}
            {pravila.nacinKlica !== "osebna" ? (
              <div className="grid gap-1">
                <label className={IZBIRA} htmlFor="prevezava-urnik-vklop-nujni">
                  <input
                    id="prevezava-urnik-vklop-nujni"
                    type="checkbox"
                    checked={pravila.prevezavaUrnikVklop !== false}
                    aria-describedby="prevezava-urnik-nujni-namig"
                    onChange={(event) => onPravila({ ...pravila, prevezavaUrnikVklop: event.target.checked })}
                  />
                  {t("prevezavaUrnikVklop")}
                </label>
                <p id="prevezava-urnik-nujni-namig" className={NAMIG}>
                  {t("prevezavaUrnikNujniNamig")}
                </p>
                <ShraniPravilaGumb busy={busy} onSave={onSaveRules} />
              </div>
            ) : null}
          </div>
        ),
        "zn-avtonomija": (
          <div id="zn-avtonomija" className="grid gap-5 rounded-3xl bg-[var(--color-sheet)] p-4">
            <h2 className="display text-2xl">{t("samostojnoNaslov")}</h2>
            <Avtonomija onError={onError} />
          </div>
        ),
        "zn-spomin": (
          <div id="zn-spomin" className="grid gap-5 rounded-3xl bg-[var(--color-sheet)] p-4">
            <h2 className="display text-2xl">{t("znPodSpomin")}</h2>
            <SpominLastnika onError={onError} />
          </div>
        ),
      }}
    />
  );
}

type BrowserRec = {
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  start: () => void;
};

/** Vsi razdelki pravil (podokna Nastavitev) shranijo ista pravila z istim gumbom. */
function ShraniPravilaGumb({ busy, onSave }: { busy: boolean; onSave: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={busy} aria-busy={busy} onClick={onSave} className={GUMB}>
        {busy ? t("uiShranjujem") : t("shraniPravila")}
      </button>
    </div>
  );
}

/** Zavihek Nastavitve: vsi razdelki v podoknih (podokna-definicije.ts). Izvozeno zaradi preizkusa. */
export function NastavitveVsebina({
  pravila,
  mind,
  place,
  busy,
  zacetno,
  onPravila,
  onSave,
  onBrain,
  onPlace,
  onError,
  onBusy,
  onNaslovStreznika,
}: {
  pravila: Pravila & NastavitveOdsotnosti;
  mind: BrainPublic;
  place: StorageView;
  busy: boolean;
  zacetno?: PodoknoNastavitev;
  onPravila: (pravila: Pravila & NastavitveOdsotnosti) => void;
  onSave: () => void;
  onBrain: (brain: BrainPublic) => void;
  onPlace: (place: StorageView) => void;
  onError: (message: string) => void;
  onBusy: (busy: boolean) => void;
  /** Naslov, ki ga je zapisal streznik (pot/tunel): premakne tudi posnetek, da ga shranjevanje ne poslje kot spremembo (B3). */
  onNaslovStreznika?: (naslov: string) => void;
}) {
  const onChange = onPravila;
  // Shranjen razlog odsotnosti, ki ne prestane preverbe (stara datoteka): stikalo je izklopljeno, vmesnik pokaze razlog (pregled C8).
  const razlogShranjenNeveljaven =
    (pravila.odsotnostRazlog ?? "").trim() !== "" && razlogOdsotnosti(pravila.odsotnostRazlog) !== null;
  const shraniPravila = <ShraniPravilaGumb busy={busy} onSave={onSave} />;
  return (
    <Podokna
      def={NASTAVITVE}
      zacetno={zacetno}
      podnozje={{
        prevzem: shraniPravila,
        pozdrav: shraniPravila,
        javni: shraniPravila,
        odgovori: shraniPravila,
        potrditev: shraniPravila,
        podatki: shraniPravila,
      }}
      razdelki={{
        "pr-prevzem": (
          <Razdelek id="nast-pravila" naslov={t("uiPravilaKlicev")}>
            <Podrazdelek naslov={t("prevzemNaslov")} id="pr-prevzem">
              <fieldset className="grid gap-1">
                <legend className="sr-only">{t("prevzemNaslov")}</legend>
                {[
                  ["vsi", t("prevzemVsi")],
                  ["neodgovorjeni", t("prevzemNeodgovorjeni")],
                  ["izven", t("prevzemIzven")],
                ].map(([value, label]) => (
                  <label className={IZBIRA} key={value}>
                    <input
                      type="radio"
                      name="prevzem"
                      checked={pravila.prevzem === value}
                      onChange={() =>
                        onChange({
                          ...pravila,
                          prevzem: value as Pravila["prevzem"],
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              {pravila.prevzem === "neodgovorjeni" || pravila.prevzem === "izven" || pravila.prevezaNaZahtevo !== false ? (
                <label className={`${OZNAKA_POLJA} mt-4`} htmlFor="preusmeritev">
                  {t("preusmeritevNaslov")}
                  <input
                    id="preusmeritev"
                    value={pravila.preusmeritev ?? ""}
                    onChange={(event) =>
                      onChange({
                        ...pravila,
                        preusmeritev: event.target.value,
                      })
                    }
                    className={POLJE}
                    autoComplete="tel"
                  />
                  <span className={NAMIG}>{t("preusmeritevNamig")}</span>
                </label>
              ) : null}
              <label className={`${IZBIRA} mt-4`} htmlFor="preveza-na-zahtevo">
                <input
                  id="preveza-na-zahtevo"
                  type="checkbox"
                  checked={pravila.prevezaNaZahtevo !== false}
                  aria-describedby="preveza-na-zahtevo-namig"
                  onChange={(event) =>
                    onChange({
                      ...pravila,
                      prevezaNaZahtevo: event.target.checked,
                    })
                  }
                />
                {t("prevezaNaZahtevoVklop")}
              </label>
              <p id="preveza-na-zahtevo-namig" className={NAMIG}>
                {t("prevezaNaZahtevoNamig")}
              </p>
              {/* Delovni cas prevezave (lastnik 23. 11. 2026): samo nacin podjetje; osebna tajnica te omejitve nima. */}
              {pravila.nacinKlica !== "osebna" ? (
                <fieldset className="mt-4">
                  <label className={IZBIRA} htmlFor="prevezava-urnik-vklop">
                    <input
                      id="prevezava-urnik-vklop"
                      type="checkbox"
                      checked={pravila.prevezavaUrnikVklop !== false}
                      aria-describedby="prevezava-urnik-namig"
                      onChange={(event) => onChange({ ...pravila, prevezavaUrnikVklop: event.target.checked })}
                    />
                    {t("prevezavaUrnikVklop")}
                  </label>
                  <p id="prevezava-urnik-namig" className={NAMIG}>
                    {t("prevezavaUrnikNamig")}
                  </p>
                  {pravila.prevezavaUrnikVklop !== false ? (
                    <>
                      <label className={`${OZNAKA_POLJA} mt-3`} htmlFor="prevezava-urnik">
                        {t("prevezavaUrnikNaslov")}
                        <input
                          id="prevezava-urnik"
                          value={pravila.prevezavaUrnik ?? ""}
                          placeholder={t("uiUrnikPrimer")}
                          maxLength={120}
                          onChange={(event) => onChange({ ...pravila, prevezavaUrnik: event.target.value })}
                          className={POLJE}
                        />
                      </label>
                      <label className={`${OZNAKA_POLJA} mt-3`} htmlFor="prevezava-prosti">
                        {t("prevezavaProstiNaslov")}
                        <input
                          id="prevezava-prosti"
                          value={pravila.prevezavaProstiDnevi ?? ""}
                          placeholder="2026-12-24, 2026-12-31"
                          onChange={(event) => onChange({ ...pravila, prevezavaProstiDnevi: event.target.value })}
                          className={POLJE}
                        />
                      </label>
                    </>
                  ) : null}
                </fieldset>
              ) : null}
              {pravila.prevzem === "neodgovorjeni" ? (
                <label className={`${OZNAKA_POLJA} mt-4`} htmlFor="cakanje">
                  {t("cakanje")}
                  <input
                    id="cakanje"
                    type="number"
                    min={10}
                    max={60}
                    value={pravila.cakanjeSekund}
                    onChange={(event) =>
                      onChange({
                        ...pravila,
                        cakanjeSekund: Number(event.target.value),
                      })
                    }
                    className={`${POLJE} sm:max-w-40`}
                  />
                </label>
              ) : null}
            </Podrazdelek>
          </Razdelek>
        ),
        "pr-nacin": (
          <div className={`${PLOSCA} p-5 sm:p-7`}>
            <Podrazdelek naslov={t("nacinKlicaNaslov")} opis={t("nacinNamig")} id="pr-nacin">
              <fieldset className="grid gap-1">
                <legend className="sr-only">{t("nacinKlicaNaslov")}</legend>
                {["podjetje", "osebna"].map((nacin) => (
                  <label className={IZBIRA} key={nacin}>
                    <input
                      type="radio"
                      name="nacinKlica"
                      checked={(pravila.nacinKlica ?? "podjetje") === nacin}
                      onChange={() =>
                        onChange({
                          ...pravila,
                          nacinKlica: nacin as Pravila["nacinKlica"],
                        })
                      }
                    />
                    {nacin === "osebna" ? t("nacinOsebna") : t("nacinPodjetje")}
                  </label>
                ))}
              </fieldset>
              <SamodejniZagonStikalo razred={IZBIRA} />
              <CiscenjeZvokaStikalo razred={IZBIRA} />
              <SpominPogovorovStikalo razred={IZBIRA} />
              <SamoucenjeStikalo razred={IZBIRA} />
              <UcenjeLHStikalo razred={IZBIRA} />
              <MotivacijaStikalo razred={IZBIRA} />
              <StrokeKartica razred={IZBIRA} />
              <GradnjeStikalo razred={IZBIRA} />
              <ObvestilaNastavitve razred={IZBIRA} />
              {pravila.nacinKlica !== "osebna" ? (
                <label className={`${IZBIRA} mt-2`}>
                  <input
                    type="checkbox"
                    checked={Boolean(pravila.podrobniPotek)}
                    onChange={(event) =>
                      onChange({
                        ...pravila,
                        podrobniPotek: event.target.checked,
                      })
                    }
                  />
                  {t("podrobniPotekNaslov")}
                </label>
              ) : null}
              {pravila.nacinKlica === "osebna" ? (
                <>
                  <label className={`${OZNAKA_POLJA} mt-3`} htmlFor="imeLastnika">
                    {t("imeLastnikaNaslov")}
                    <input
                      id="imeLastnika"
                      value={pravila.imeLastnika ?? ""}
                      maxLength={60}
                      onChange={(event) =>
                        onChange({
                          ...pravila,
                          imeLastnika: event.target.value,
                        })
                      }
                      className={POLJE}
                    />
                  </label>
                  {/* Ime v tozilniku (lastnik 21. 11. 2026: »Poklicali ste Petra«): predlog je samodejno sklanjanje, rocni vnos ima prednost. */}
                  <label className={`${OZNAKA_POLJA} mt-3`} htmlFor="imeLastnikaTozilnik">
                    {t("imeTozilnikNaslov")}
                    <input
                      id="imeLastnikaTozilnik"
                      value={pravila.imeLastnikaTozilnik ?? ""}
                      placeholder={imeVTozilniku(pravila.imeLastnika ?? "")}
                      maxLength={60}
                      onChange={(event) => onChange({ ...pravila, imeLastnikaTozilnik: event.target.value })}
                      className={POLJE}
                    />
                  </label>
                  <fieldset className="mt-4">
                    <legend className={OZNAKA_POLJA}>{t("odsotnostNaslov")}</legend>
                    <label className={`${IZBIRA} mt-2`}>
                      <input
                        type="checkbox"
                        checked={Boolean(pravila.odsotnostVklop)}
                        onChange={(event) =>
                          onChange({
                            ...pravila,
                            odsotnostVklop: event.target.checked,
                            odsotnostCasovniPas: casovniPasUporabnika(),
                          })
                        }
                      />
                      {t("odsotnostVklopNaslov")}
                    </label>
                    {!pravila.odsotnostVklop && razlogShranjenNeveljaven ? (
                      <OdsotnostRazlog
                        vrednost={pravila.odsotnostRazlog ?? ""}
                        onChange={(razlog) =>
                          onChange({
                            ...pravila,
                            odsotnostRazlog: razlog,
                          })
                        }
                      />
                    ) : null}
                    {pravila.odsotnostVklop ? (
                      <>
                        <OdsotnostRazlog
                          vrednost={pravila.odsotnostRazlog ?? ""}
                          onChange={(razlog) =>
                            onChange({
                              ...pravila,
                              odsotnostRazlog: razlog,
                            })
                          }
                        />
                        <label className={`${OZNAKA_POLJA} mt-3`} htmlFor="odsotnostDo">
                          {t("odsotnostDoNaslov")}
                          <input
                            id="odsotnostDo"
                            type="datetime-local"
                            value={isoVLokalnoUro(pravila.odsotnostDo)}
                            onChange={(event) =>
                              onChange({
                                ...pravila,
                                odsotnostDo: lokalnoUroVIso(event.target.value),
                                odsotnostCasovniPas: casovniPasUporabnika(),
                              })
                            }
                            className={POLJE}
                          />
                        </label>
                        <span className={NAMIG}>{t("odsotnostNamig")}</span>
                      </>
                    ) : null}
                  </fieldset>
                  {/* Dostava paketa (lastnik 23. 11. 2026): navodilo slisi samo klicatelj, ki se predstavi kot dostava; prazno = izklopljeno. */}
                  <fieldset className="mt-4">
                    <legend className={OZNAKA_POLJA}>{t("paketNaslov")}</legend>
                    {/* Lastnik 24. 11. 2026: »Pred hišo« (ena kljukica) ali »Drugo mesto« (besedilo); oboje je paketNavodilo, prazno = izklopljeno. */}
                    <label className="mt-2 flex items-center gap-2 text-sm" htmlFor="paket-pred-hiso">
                      <input
                        id="paket-pred-hiso"
                        type="checkbox"
                        className={`h-5 w-5 ${FOKUS}`}
                        checked={jePredHiso(pravila.paketNavodilo)}
                        onChange={(event) => onChange({ ...pravila, paketNavodilo: event.target.checked ? PRED_HISO : "" })}
                      />
                      {t("paketPredHiso")}
                    </label>
                    {/* Polje ostane vedno prikazano: »pred hišo pod nadstreškom« med tipkanjem ne sme izginiti. */}
                    <label className={`${OZNAKA_POLJA} mt-2 block`} htmlFor="paket-navodilo">
                        {t("paketDrugoMesto")}
                        <textarea
                          id="paket-navodilo"
                          aria-describedby="paket-namig"
                          value={pravila.paketNavodilo ?? ""}
                          maxLength={160}
                          rows={2}
                          onChange={(event) => onChange({ ...pravila, paketNavodilo: event.target.value.replace(/\s*\n\s*/g, " ") })}
                          className={`${POLJE} mt-2`}
                        />
                    </label>
                    <p id="paket-namig" className={NAMIG}>
                      {t("paketNamig")}
                    </p>
                    <label className={`${OZNAKA_POLJA} mt-3`} htmlFor="paket-do">
                      {t("paketDoNaslov")}
                      <input
                        id="paket-do"
                        type="date"
                        value={pravila.paketDo ?? ""}
                        onChange={(event) => onChange({ ...pravila, paketDo: event.target.value })}
                        className={POLJE}
                      />
                    </label>
                  </fieldset>
                </>
              ) : null}
            </Podrazdelek>
          </div>
        ),
        "pr-predpone": (
          <div className={`${PLOSCA} p-5 sm:p-7`} id="pr-predpone">
            <label className={OZNAKA_POLJA} htmlFor="predpone">
              {t("dovoljenePredponeNaslov")}
              <input
                id="predpone"
                value={pravila.dovoljenePredpone ?? ""}
                onChange={(event) =>
                  onChange({
                    ...pravila,
                    dovoljenePredpone: event.target.value,
                  })
                }
                className={POLJE}
              />
              <span className={NAMIG}>{t("dovoljenePredponeNamig")}</span>
            </label>
          </div>
        ),
        "pr-pozdrav": (
          <div className={`${PLOSCA} p-5 sm:p-7`}>
            <Podrazdelek naslov={t("pozdravNaslov")} opis={t("pozdravNamig")} id="pr-pozdrav">
              <p className="text-xs font-medium text-[var(--color-brass)]">{t("obvezniNaslov")}</p>
              <p className="mt-1 border-l-2 border-[var(--color-brass)] pl-3 text-sm">{obveznoBesedilo(pravila.nacinKlica)}</p>
              <label className={`${OZNAKA_POLJA} mt-4`} htmlFor="pozdrav">
                {t("pozdravDodatek")}
                <textarea
                  id="pozdrav"
                  value={pravila.pozdrav}
                  rows={3}
                  onChange={(event) =>
                    onChange({
                      ...pravila,
                      pozdrav: event.target.value,
                    })
                  }
                  className={POLJE}
                />
              </label>
            </Podrazdelek>
          </div>
        ),
        "pr-pogovor": (
          <div className={`${PLOSCA} p-5 sm:p-7`}>
            <Podrazdelek naslov={t("uiPogovorNaslov")} id="pr-pogovor">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={OZNAKA_POLJA} htmlFor="najdaljsi">
                  {t("najdaljsiNaslov")}
                  <input
                    id="najdaljsi"
                    inputMode="numeric"
                    value={pravila.najdaljsiPogovorMinut ?? ""}
                    onChange={(event) => {
                      const raw = event.target.value.trim();
                      onChange({
                        ...pravila,
                        najdaljsiPogovorMinut: raw === "" ? null : Number(raw),
                      });
                    }}
                    className={POLJE}
                  />
                  <span className={NAMIG}>{t("najdaljsiNamig")}</span>
                </label>
                <label className={OZNAKA_POLJA} htmlFor="govorModel">
                  {t("govorModelNaslov")}
                  <select
                    id="govorModel"
                    value={pravila.govorModel ?? ""}
                    onChange={(event) =>
                      onChange({
                        ...pravila,
                        govorModel: event.target.value,
                      })
                    }
                    className={POLJE}
                  >
                    <option value="">{t("govorModelPrivzeto")}</option>
                    {GOVOR_MODELI.map((model) => (
                      <option value={model} key={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                  <span className={NAMIG}>{t("govorModelNamig")}</span>
                </label>
              </div>
              {pravila.govorModel ? (
                <label className={`${OZNAKA_POLJA} mt-4`} htmlFor="hintsGovor">
                  {t("hintsGovorNaslov")}
                  <textarea
                    id="hintsGovor"
                    value={pravila.hintsGovor ?? ""}
                    rows={2}
                    onChange={(event) =>
                      onChange({
                        ...pravila,
                        hintsGovor: event.target.value,
                      })
                    }
                    className={POLJE}
                  />
                </label>
              ) : null}
              <div className="mt-6 border-t border-[var(--color-rule)] pt-6">
                <label className={IZBIRA} htmlFor="tople-povezave-vklop">
                  <input
                    id="tople-povezave-vklop"
                    type="checkbox"
                    checked={pravila.toplePovezave !== false}
                    aria-describedby="tople-povezave-namig"
                    onChange={(event) =>
                      onChange({
                        ...pravila,
                        toplePovezave: event.target.checked,
                      })
                    }
                  />
                  {t("toplePovezaveVklop")}
                </label>
                <p id="tople-povezave-namig" className={NAMIG}>
                  {t("toplePovezaveNamig")}
                </p>
              </div>
            </Podrazdelek>
          </div>
        ),
        "pr-javni": (
          <div className={`${PLOSCA} p-5 sm:p-7`}>
            <Podrazdelek naslov={t("nastPodJavni")} id="pr-javni">
              <label className={OZNAKA_POLJA} htmlFor="javni-naslov">
                {t("javniNaslovNaslov")}
                <input
                  id="javni-naslov"
                  value={pravila.javniNaslov ?? ""}
                  onChange={(event) =>
                    onChange({
                      ...pravila,
                      javniNaslov: event.target.value,
                    })
                  }
                  className={POLJE}
                  inputMode="url"
                />
                <span className={NAMIG}>{t("javniNaslovNamig")}</span>
              </label>
              <PotNaslova
                trenutni={pravila.javniNaslov ?? ""}
                onNaslov={(javniNaslov) => {
                  onNaslovStreznika?.(javniNaslov);
                  onChange({
                    ...pravila,
                    javniNaslov,
                  });
                }}
                onError={onError}
              />
            </Podrazdelek>
          </div>
        ),
        "pr-twilio": (
          <div className={`${PLOSCA} p-5 sm:p-7`}>
            <Podrazdelek naslov={t("nastPodTwilio")} opis={t("statusUrl")} id="pr-twilio">
              <TwilioRacun
                naslovKlicev={
                  /^https:\/\//i.test((pravila.javniNaslov ?? "").trim())
                    ? `${(pravila.javniNaslov ?? "").trim().replace(/\/+$/, "")}/api/voice/incoming`
                    : ""
                }
                onError={onError}
              />
            </Podrazdelek>
          </div>
        ),
        "pr-tema": razdelekViden("tema", pravila.nacinKlica) ? (
          <div className={`${PLOSCA} p-5 sm:p-7`}>
            <Podrazdelek naslov={t("temaOdgovorNaslov")} opis={t("temaOdgovorNamig")} id="pr-tema">
              <label className="sr-only" htmlFor="tema-odgovor">
                {t("temaOdgovorNaslov")}
              </label>
              <textarea
                id="tema-odgovor"
                value={pravila.temaOdgovor}
                rows={3}
                onChange={(event) =>
                  onChange({
                    ...pravila,
                    temaOdgovor: event.target.value,
                  })
                }
                className={POLJE}
              />
            </Podrazdelek>
          </div>
        ) : null,
        "pr-garancija": razdelekViden("garancija", pravila.nacinKlica) ? (
          <div className={`${PLOSCA} p-5 sm:p-7`}>
            <Podrazdelek naslov={t("garancijaNaslov")} opis={t("garancijaNamig")} id="pr-garancija">
              <label className={IZBIRA} htmlFor="garancija-vklop">
                <input
                  id="garancija-vklop"
                  type="checkbox"
                  checked={pravila.garancijaVklop}
                  onChange={(event) =>
                    onChange({
                      ...pravila,
                      garancijaVklop: event.target.checked,
                    })
                  }
                />
                {t("garancijaVklop")}
              </label>
              <label className="sr-only" htmlFor="garancija-besedilo">
                {t("garancijaNaslov")}
              </label>
              <textarea
                id="garancija-besedilo"
                value={pravila.garancijaBesedilo}
                rows={3}
                onChange={(event) =>
                  onChange({
                    ...pravila,
                    garancijaBesedilo: event.target.value,
                  })
                }
                className={POLJE}
              />
            </Podrazdelek>
          </div>
        ) : null,
        "pr-dostava": razdelekViden("dostava", pravila.nacinKlica) ? (
          <div className={`${PLOSCA} p-5 sm:p-7`}>
            <Podrazdelek naslov={t("dostavaNaslov")} opis={t("dostavaNamig")} id="pr-dostava">
              <label className={IZBIRA} htmlFor="dostava-vklop">
                <input
                  id="dostava-vklop"
                  type="checkbox"
                  checked={pravila.dostavaVklop}
                  onChange={(event) =>
                    onChange({
                      ...pravila,
                      dostavaVklop: event.target.checked,
                    })
                  }
                />
                {t("dostavaVklop")}
              </label>
              <label className="sr-only" htmlFor="dostava-besedilo">
                {t("dostavaNaslov")}
              </label>
              <textarea
                id="dostava-besedilo"
                value={pravila.dostavaBesedilo}
                rows={3}
                onChange={(event) =>
                  onChange({
                    ...pravila,
                    dostavaBesedilo: event.target.value,
                  })
                }
                className={POLJE}
              />
            </Podrazdelek>
          </div>
        ) : null,
        "pr-potrditev": razdelekViden("potrditevEposta", pravila.nacinKlica) ? (
          <div className={`${PLOSCA} p-5 sm:p-7`}>
            <Podrazdelek naslov={t("potrditevNaslov")} opis={t("potrditevNamig")} id="pr-potrditev">
              <label className={OZNAKA_POLJA} htmlFor="potrditev-naslov">
                {t("potrditevPolje")}
                <input
                  id="potrditev-naslov"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  aria-describedby="potrditev-kratek"
                  value={pravila.potrditevNaslov}
                  onChange={(event) => {
                    const naslov = event.target.value;
                    const prvi = jeVeljavenEnaslov(naslov) && !jeVeljavenEnaslov(pravila.potrditevNaslov);
                    onChange({
                      ...pravila,
                      potrditevNaslov: naslov,
                      potrditevEposta: jeVeljavenEnaslov(naslov) && (pravila.potrditevEposta || prvi),
                    });
                  }}
                  className={POLJE}
                />
              </label>
              {naslovJeTezakZaGovor(pravila.potrditevNaslov) ? (
                <p id="potrditev-kratek" role="status" className={NAMIG}>
                  {t("potrditevKratek")}
                </p>
              ) : null}
              {pravila.potrditevNaslov && !jeVeljavenEnaslov(pravila.potrditevNaslov) ? (
                <p id="potrditev-razlog" className="mt-1.5 text-xs text-[var(--color-signal)]">
                  {t("potrditevNeveljaven")}
                </p>
              ) : null}
              <label className={`${IZBIRA} mt-2`} htmlFor="potrditev-vklop">
                <input
                  id="potrditev-vklop"
                  type="checkbox"
                  checked={pravila.potrditevEposta}
                  disabled={!jeVeljavenEnaslov(pravila.potrditevNaslov)}
                  aria-describedby="potrditev-razlog"
                  onChange={(event) =>
                    onChange({
                      ...pravila,
                      potrditevEposta: event.target.checked,
                    })
                  }
                />
                {t("potrditevVklop")}
              </label>
            </Podrazdelek>
          </div>
        ) : null,
        "pr-snemanje": (
          <div className={`${PLOSCA} p-5 sm:p-7`}>
            <Podrazdelek naslov={t("snemanjeNaslov")} id="pr-snemanje">
              {/* Lastnik 22. 11. 2026: snemanje v nacinu podjetje privzeto vklopljeno; osebni nacin ne snema (stikalo onemogoceno z razlago). */}
              <p id="snemanje-razlog" className="text-sm text-[var(--color-moss)]">
                {pravila.nacinKlica === "osebna" ? t("snemanjeOsebna") : t("snemanjeOpis")}
              </p>
              <label className={`${IZBIRA} mt-2`} htmlFor="snemanje-vklop">
                <input
                  id="snemanje-vklop"
                  type="checkbox"
                  checked={pravila.nacinKlica !== "osebna" && pravila.snemanjeVklop}
                  disabled={pravila.nacinKlica === "osebna"}
                  aria-describedby="snemanje-razlog"
                  onChange={(event) =>
                    onChange({
                      ...pravila,
                      snemanjeVklop: event.target.checked,
                    })
                  }
                />
                {t("snemanjeVklop")}
              </label>
              <label className={IZBIRA} htmlFor="snemanje-zavrnitev">
                <input
                  id="snemanje-zavrnitev"
                  type="checkbox"
                  checked={pravila.snemanjeZavrnitev}
                  onChange={(event) =>
                    onChange({
                      ...pravila,
                      snemanjeZavrnitev: event.target.checked,
                    })
                  }
                />
                {t("snemanjeZavrnitev")}
              </label>
              <label className={`${OZNAKA_POLJA} mt-3`} htmlFor="snemanje-hramba">
                {t("snemanjeHramba")}
                <input
                  id="snemanje-hramba"
                  type="number"
                  min={1}
                  max={90}
                  value={pravila.snemanjeHrambaDni}
                  onChange={(event) =>
                    onChange({
                      ...pravila,
                      snemanjeHrambaDni: Number(event.target.value) || 1,
                    })
                  }
                  className={`${POLJE} sm:max-w-40`}
                />
              </label>
              <label className={`${OZNAKA_POLJA} mt-3`} htmlFor="zapiski-hramba">
                {t("zapiskiHramba")}
                <input
                  id="zapiski-hramba"
                  type="number"
                  min={1}
                  max={3650}
                  value={pravila.zapiskiHrambaDni}
                  onChange={(event) =>
                    onChange({
                      ...pravila,
                      zapiskiHrambaDni: Number(event.target.value) || 1,
                    })
                  }
                  className={`${POLJE} sm:max-w-40`}
                />
              </label>
            </Podrazdelek>
          </div>
        ),
        "nast-dodatki": (
          <DodatkiPanel
            pravila={pravila}
            busy={busy}
            onChange={onChange}
            onSave={onSave}
            onError={onError}
          />
        ),
        "nast-strani": (
          <Razdelek id="nast-strani" naslov={t("straniNaslov")}>
            <StraniNastavitve onError={onError} />
          </Razdelek>
        ),
        "nast-narocila": (
          <Razdelek id="nast-narocila" naslov={t("nastPodNarocila")}>
            <NarocilaNastavitve onError={onError} />
          </Razdelek>
        ),
        "nast-dovoljenja": (
          <Razdelek id="nast-dovoljenja" naslov={t("dovoljenjaNaslov")}>
            <DovoljenjaNastavitve onError={onError} />
          </Razdelek>
        ),
        "nast-posodobitev": <PosodobitevPanel onError={onError} />,
        "nast-github": <GithubDostop id="nast-github" onError={onError} />,
        "nast-agenti": <NacrtStikalo id="nast-agenti" />,
        "nast-o-lini": <OLiniPanel id="nast-o-lini" />,
        "nast-iphone": <IphoneNavodila />,
        "nast-mozgani": (
          <div className="grid gap-6">
            <Settings brain={mind} busy={busy} onBrain={onBrain} onError={onError} onBusy={onBusy} />
            <ModelAsistentke brain={mind} busy={busy} onBrain={onBrain} onError={onError} onBusy={onBusy} />
          </div>
        ),
        "nast-shranjevanje": <StoragePanel place={place} busy={busy} onPlace={onPlace} onError={onError} onBusy={onBusy} />,
        "mapa-zapiskov": <MapaZapiskovPanel onError={onError} />,
      }}
    />
  );
}

/** Cas za cloveka: »1,2 s« (slog besedil, razdelek 3). */
function sekunde(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

/** Casi Lininih odgovorov v klicu: povprecje in najdaljsi. Samo stevila, brez vsebine pogovora. */
function CasiKlica({ call }: { call: CallSession }) {
  const casi = call.transcript
    .filter((vrstica) => vrstica.role === "lina" && typeof vrstica.ms === "number")
    .map((vrstica) => vrstica.glasMs ?? vrstica.ms ?? 0);
  if (casi.length === 0) return null;
  const povprecje = casi.reduce((vsota, ms) => vsota + ms, 0) / casi.length;
  return (
    <span className="mt-1 block text-xs text-[var(--color-moss)]">
      {t("casOdgovora")}
      {": "}
      {t("casPovprecno")} {sekunde(povprecje)}
      {", "}
      {t("casNajdaljsi")} {sekunde(Math.max(...casi))}
    </span>
  );
}

type VrsticaVaje = { kdo: "lina" | "klicatelj"; besedilo: string; ms?: number; zvok?: string[] };

/** Posnetke Lininega glasu predvaja po vrsti, kot jih slisi klicatelj. */
async function predvajajZvok(naslovi: string[]) {
  for (const naslov of naslovi) {
    const audio = new Audio(naslov);
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      audio.play().catch(() => resolve());
    });
  }
}

/** Vaja klica: uporabnik igra klicatelja in gre z Lino cez cel potek. Tece po isti kodi kot pravi klic. */
function VajaKlica({
  busy,
  nacin,
  onError,
  onBusy,
}: {
  busy: boolean;
  nacin?: string;
  onError: (message: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [id, setId] = useState("");
  const [text, setText] = useState("");
  const [pogovor, setPogovor] = useState<VrsticaVaje[]>([]);
  const [zapis, setZapis] = useState<ZapisVaje | null>(null);
  async function korak(vhod: { text?: string; konec?: boolean; nova?: boolean }) {
    onBusy(true);
    onError("");
    try {
      const izid = await vajaKlicaFn({
        data: {
          id: vhod.nova ? void 0 : id || void 0,
          text: vhod.text,
          konec: vhod.konec,
        },
      });
      const prej = vhod.nova ? [] : pogovor;
      const klicatelj = vhod.text
        ? [
            {
              kdo: "klicatelj" as const,
              besedilo: vhod.text,
            },
          ]
        : [];
      const lina = izid.reply
        ? [
            {
              kdo: "lina" as const,
              besedilo: izid.reply,
              ms: izid.ms,
              zvok: izid.zvok,
            },
          ]
        : [];
      setPogovor([...prej, ...klicatelj, ...lina]);
      setId(izid.koncano ? "" : izid.id);
      setZapis(izid.zapis);
      setText("");
      if (izid.zvok.length > 0) predvajajZvok(izid.zvok);
    } catch (cause) {
      onError(fault(cause));
    } finally {
      onBusy(false);
    }
  }
  return (
    <div className="mt-6 border-t border-[var(--color-rule)] pt-5">
      <h3 className="display text-2xl">
        {t("vajaNaslov")}{" "}
        <span className="rounded-full border border-[var(--color-rule)] px-2 py-0.5 align-middle text-xs">
          {t("vajaOznaka")}
        </span>
      </h3>
      <p className="mt-2 text-sm text-[var(--color-moss)]">{vajaNamigBesedilo(nacin)}</p>
      {!id ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void korak({ nova: true })}
          className="mt-3 rounded-full bg-[var(--color-ink-fill)] px-4 py-3 text-sm text-white disabled:opacity-50"
        >
          {t("vajaZacni")}
        </button>
      ) : null}
      {pogovor.length > 0 ? (
        <ol className="mt-4 grid gap-2 text-sm" aria-live="polite">
          {pogovor.map((vrstica, i) => (
            <li
              className={
                vrstica.kdo === "lina"
                  ? "rounded-xl bg-[var(--color-surface)] px-3 py-2"
                  : "px-3 py-1 text-[var(--color-moss)]"
              }
              key={i}
            >
              <span className="text-xs text-[var(--color-brass)]">
                {vrstica.kdo === "lina" ? "Lina" : t("vajaKlicatelj")}
                {": "}
              </span>
              {vrstica.besedilo}
              {vrstica.kdo === "lina" && typeof vrstica.ms === "number" ? (
                <span className="mt-1 block text-xs text-[var(--color-moss)]">
                  {t("vajaCas")}
                  {": "}
                  {sekunde(vrstica.ms)}
                  {vrstica.zvok && vrstica.zvok.length > 0 ? (
                    <button
                      type="button"
                      className="ml-3 underline"
                      onClick={() => void predvajajZvok(vrstica.zvok ?? [])}
                    >
                      {t("vajaPoslusaj")}
                    </button>
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {id ? (
        <form
          className="mt-3"
          onSubmit={(event) => {
            event.preventDefault();
            korak({ text });
          }}
        >
          <label className="block text-sm" htmlFor="vaja-polje">
            {t("vajaPolje")}
            <input
              id="vaja-polje"
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-[var(--color-ink-fill)] px-4 py-3 text-sm text-white disabled:opacity-50"
            >
              {t("vajaPoslji")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void korak({ konec: true })}
              className="rounded-full border border-[var(--color-rule)] px-4 py-3 text-sm"
            >
              {t("vajaKoncaj")}
            </button>
          </div>
        </form>
      ) : null}
      {zapis ? (
        <div className="mt-4 text-sm" aria-live="polite">
          <p>{t("vajaKonec")}</p>
          <h4 className="mt-2 font-medium">{t("vajaZapis")}</h4>
          <dl className="mt-2 grid gap-2 sm:grid-cols-2">
            {[
              [t("povzetekKdo"), zapis.ime],
              [t("podjetjeOznaka"), zapis.podjetje],
              [t("povprasevanjeOznaka"), zapis.povprasevanje],
              [t("rok"), zapis.rok],
              [t("prosiTelefonOznaka"), zapis.telefon],
              [t("prosiEpostoOznaka"), zapis.eposta],
              [t("dosegljivOznaka"), zapis.povratniKlic],
              [t("povzetekNarediti"), zapis.povzetek.narediti],
            ].map(([oznaka, vrednost]) => (
              <div key={oznaka}>
                <dt className="text-xs text-[var(--color-brass)]">{oznaka}</dt>
                <dd>{vrednost}</dd>
              </div>
            ))}
          </dl>
          {zapis.potrditevEposta ? <p className="mt-2">{t("potrditevOznaka")}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function Vrzeli({
  vrzeli,
  busy,
  onError,
  onBusy,
  onDone,
}: {
  vrzeli: Vrzel[];
  busy: boolean;
  onError: (message: string) => void;
  onBusy: (busy: boolean) => void;
  onDone: (catalog: Catalog, vrzeli: Vrzel[]) => void;
}) {
  const openGaps = vrzeli.filter((gap) => !gap.dodano);
  return (
    <div id="zn-vrzeli" className="rounded-3xl bg-[var(--color-sheet)] p-4">
      <h2 className="display text-2xl">{t("vrzeliNaslov")}</h2>
      <p className="mt-1 text-xs text-[var(--color-moss)]">
        {"Odprtih: "}
        {openGaps.length}
      </p>
      {openGaps.length === 0 ? <p className="mt-2 text-sm">{t("vrzeliPrazno")}</p> : null}
      <div className="mt-3 grid gap-3">
        {openGaps.map((gap) => (
          <VrzelVrstica gap={gap} busy={busy} onError={onError} onBusy={onBusy} onDone={onDone} key={gap.id} />
        ))}
      </div>
    </div>
  );
}

function VrzelVrstica({
  gap,
  busy,
  onError,
  onBusy,
  onDone,
}: {
  gap: Vrzel;
  busy: boolean;
  onError: (message: string) => void;
  onBusy: (busy: boolean) => void;
  onDone: (catalog: Catalog, vrzeli: Vrzel[]) => void;
}) {
  const [odgovor, setOdgovor] = useState("");
  async function add() {
    onBusy(true);
    onError("");
    try {
      const result = await dodajVrzelFn({
        data: {
          id: gap.id,
          odgovor,
        },
      });
      onDone(result.catalog, result.vrzeli);
      setOdgovor("");
    } catch (cause) {
      onError(fault(cause));
    } finally {
      onBusy(false);
    }
  }
  return (
    <form
      className="rounded-2xl bg-[var(--color-surface)] p-3"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <p className="text-sm">{gap.vprasanje}</p>
      <label className="mt-2 block text-sm" htmlFor={`vrzel-${gap.id}`}>
        {t("vrzeliOdgovor")}
        <input
          id={`vrzel-${gap.id}`}
          value={odgovor}
          onChange={(event) => setOdgovor(event.target.value)}
          className="mt-1 w-full rounded-xl border border-[var(--color-rule)] px-3 py-2"
        />
      </label>
      <button
        type="submit"
        disabled={busy || !odgovor.trim()}
        className="mt-2 rounded-full bg-[var(--color-signal-fill)] px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {t("vrzeliGumb")}
      </button>
    </form>
  );
}


type StanjeOmniroute = { povezan: boolean; vklop: boolean; naslov: string; klici: boolean };

/** Neobvezen prehod OmniRoute: privzeto izklopljen; ob vklopu obvestilo; klici imajo ločeno potrditev. Ključ gre samo na strežnik. */
function OmnirouteNastavitve({ onError }: { onError: (sporocilo: string) => void }) {
  const [stanje, setStanje] = useState<StanjeOmniroute | null>(null);
  const [naslov, setNaslov] = useState("");
  const [kljuc, setKljuc] = useState("");
  const [zaposlen, setZaposlen] = useState(false);
  function prevzemi(s: StanjeOmniroute) {
    setStanje(s);
    setNaslov(s.naslov);
    setKljuc("");
  }
  useEffect(() => {
    stanjeOmnirouteFn()
      .then(prevzemi)
      .catch(() =>
        setStanje({
          povezan: false,
          vklop: false,
          naslov: "",
          klici: false,
        }),
      );
  }, []);
  async function shrani(vnos: { vklop?: boolean; naslov?: string; klici?: boolean; kljuc?: string }) {
    setZaposlen(true);
    onError("");
    try {
      prevzemi(await shraniOmnirouteFn({ data: vnos }));
    } catch (cause) {
      onError(fault(cause));
    } finally {
      setZaposlen(false);
    }
  }
  const polje = "mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2";
  return (
    <section aria-labelledby="om-naslov" className="mt-4 grid gap-2 text-sm">
      <h3 id="om-naslov" className="text-lg">
        {t("omNaslov")}
      </h3>
      <p className="text-[var(--color-moss)]">{t("omRazlaga")}</p>
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          shrani({
            naslov,
            ...(kljuc ? { kljuc } : {}),
          });
        }}
      >
        <label htmlFor="om-naslov-polje">
          {t("omNaslovPolje")}
          <input
            id="om-naslov-polje"
            value={naslov}
            onChange={(e) => setNaslov(e.target.value)}
            placeholder="http://localhost:20128/v1"
            className={polje}
            autoComplete="off"
          />
        </label>
        <label htmlFor="om-kljuc">
          {t("omKljucPolje")}
          <input
            id="om-kljuc"
            type="password"
            value={kljuc}
            onChange={(e) => setKljuc(e.target.value)}
            className={polje}
            autoComplete="off"
          />
        </label>
        {stanje?.povezan ? <p>{t("omKljucShranjen")}</p> : null}
        <button type="submit" className="lina-gumb-majhen w-fit" disabled={zaposlen || (!naslov && !kljuc)}>
          {t("omShrani")}
        </button>
      </form>
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          checked={stanje?.vklop === true}
          disabled={zaposlen || !stanje?.povezan || !stanje?.naslov}
          onChange={(e) => void shrani({ vklop: e.target.checked })}
        />
        {t("omVklop")}
      </label>
      {stanje?.vklop ? (
        <>
          <p role="note" className="max-w-prose text-xs text-[var(--color-moss)]">
            {t("omObvestilo")}
          </p>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={stanje.klici}
              disabled={zaposlen}
              onChange={(e) => void shrani({ klici: e.target.checked })}
            />
            {t("omKlici")}
          </label>
        </>
      ) : null}
      {stanje?.povezan ? (
        <button
          type="button"
          className="lina-gumb-majhen w-fit"
          disabled={zaposlen}
          onClick={() =>
            void pozabiOmnirouteFn()
              .then(prevzemi)
              .catch((c) => onError(fault(c)))
          }
        >
          {t("omPozabi")}
        </button>
      ) : null}
    </section>
  );
}


/** Vrstica seznama klicev: glava je gumb do podrobnosti, povzetek je pod njo (ne v gumbu in ne v svoji kartici). */
function VrsticaKlica({ call, onOdpri }: { call: CallSession; onOdpri: () => void }) {
  const stanje = stanjeKlica(call);
  const cas = casKlica(call.startedAt);
  const osebno = call.nacin === "osebna";
  return (
    <li className="px-4 py-4 sm:px-6 sm:py-5" data-klic={call.callSid}>
      <button
        type="button"
        onClick={onOdpri}
        aria-label={`${t("uiPodrobnosti")}: ${call.order.customerName || t("uiKlicNeznan")}${cas ? `, ${cas}` : ""}`}
        className={`group flex w-full min-h-11 items-start justify-between gap-4 rounded-xl text-left ${FOKUS}`}
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            {call.order.tajnica?.nujno ? <NujnoOznaka /> : null}
            <span className="text-base font-semibold break-words text-[var(--color-ink)]">
              {call.order.customerName || (osebno ? call.order.phone || t("neznanKlicatelj") : t("uiKlicNeznan"))}
            </span>
            {osebno ? (
              <Znacka ton={call.status === "v-teku" ? "signal" : call.order.tajnica?.sporocilo ? "moss" : "brass"}>
                {call.status === "v-teku"
                  ? t("uiStanjeVTeku")
                  : call.order.tajnica?.sporocilo
                    ? t("dnevnikSporocilo")
                    : t("dnevnikBrezSporocila")}
              </Znacka>
            ) : (
              <Znacka ton={stanje.ton}>{t(stanje.oznaka)}</Znacka>
            )}
            {call.kratek ? <Znacka ton="brass">{t("kratekOznaka")}</Znacka> : null}
            {!osebno && call.order.potrditevEposta ? <Znacka ton="moss">{t("potrditevOznaka")}</Znacka> : null}
          </span>
          {!osebno ? (
            <span className="mt-1 block text-sm text-[var(--color-ink)]">
              {call.order.requestedProduct || call.order.productName || t("uiBrezIzdelka")}
              {call.order.violations.includes("material") ? (
                <span className="text-[var(--color-signal)]">
                  {" · "}
                  {t("uiMaterialZavrnjen")}
                </span>
              ) : null}
            </span>
          ) : null}
          {cas ? <span className="mt-0.5 block text-xs text-[var(--color-brass)]">{cas}</span> : null}
          <CasiKlica call={call} />
        </span>
        <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-sm font-medium text-[var(--color-ink)] group-hover:underline">
          {t("uiPodrobnosti")}
          <span aria-hidden="true">›</span>
        </span>
      </button>
      {call.povzetek ? <PovzetekKlica povzetek={call.povzetek} /> : null}
    </li>
  );
}


function PovzetekKlica({ povzetek }: { povzetek: NonNullable<CallSession["povzetek"]> }) {
  return (
    <dl className="mt-3 grid gap-x-6 gap-y-3 border-l-2 border-[var(--color-rule)] pl-4 text-sm sm:grid-cols-2">
      {povzetek.nujno ? (
        <div className="sm:col-span-2">
          <dt className="sr-only">{t("zapisekOznaka")}</dt>
          <dd>
            <NujnoOznaka />
          </dd>
        </div>
      ) : null}
      <div className="min-w-0">
        <dt className="text-xs text-[var(--color-brass)]">{t("povzetekKdo")}</dt>
        <dd className="break-words">{povzetek.kdo}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-[var(--color-brass)]">{t("povzetekZelel")}</dt>
        <dd className="break-words">{povzetek.zelel}</dd>
      </div>
      {povzetek.obljubila ? (
        <div className="min-w-0">
          <dt className="text-xs text-[var(--color-brass)]">{t("povzetekObljubila")}</dt>
          <dd className="break-words">{povzetek.obljubila}</dd>
        </div>
      ) : null}
      {povzetek.narediti ? (
        <div className="min-w-0">
          <dt className="text-xs text-[var(--color-brass)]">{t("povzetekNarediti")}</dt>
          <dd className="break-words">{povzetek.narediti}</dd>
        </div>
      ) : null}
      {povzetek.sporocilo ? (
        <div className="min-w-0 sm:col-span-2">
          <dt className="text-xs text-[var(--color-brass)]">{t("zapisekSporocilo")}</dt>
          <dd className="break-words">{povzetek.sporocilo}</dd>
        </div>
      ) : null}
    </dl>
  );
}


function DelZapisnika({ naslov, children }: { naslov: string; children: ReactNode }) {
  return (
    <div className="mt-6 border-t border-[var(--color-rule)] pt-5">
      <h3 className="text-sm font-semibold">{naslov}</h3>
      <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">{children}</dl>
    </div>
  );
}


/** Posodobitev Line iz programa (lastnik 23. 11. 2026): gumb samo zazene; kaj in od kod namestiti, odloci streznik. */
function PosodobitevPanel({ onError }: { onError: (sporocilo: string) => void }) {
  const [stanje, setStanje] = useState<StanjePosodobitve | null>(null);
  const [delam, setDelam] = useState(false);
  const [sporocilo, setSporocilo] = useState("");
  const osvezi = () => stanjePosodobitveFn().then(setStanje).catch(() => {});
  useEffect(() => {
    void osvezi();
  }, []);
  const napisIzida = (i: IzidPosodobitve): string => {
    const opis =
      i.koda === "namesceno" ? t("posIzidNamesceno") : i.koda === "preklicano" ? t("posIzidPreklicano") : i.koda === "napaka" ? t("posIzidNapaka") : t("posIzidZavrnjeno");
    const cas = new Date(i.cas);
    return `${t("posZadnjiIzid")}: ${i.razlicica}, ${opis}${Number.isNaN(cas.getTime()) ? "" : ` (${casKlica(i.cas)})`}`;
  };
  const napisNapake = (r: RazlogZavrnitve): string =>
    r === "neznan_paket" ? t("posNeznanPaket") : r === "ze_tece" ? t("posNapakaZeTece") : r === "podpis" ? t("posNapakaPodpis") : r === "napacen_paket" || r === "vsota" ? t("posNapakaPreverba") : r === "prenos" || r === "ni_vira" ? t("posNapakaPrenos") : r === "ni_novejsa" ? t("posNiNovejse") : t("posNapaka");
  const posodobi = () => {
    setDelam(true);
    setSporocilo(t("posZacenjam"));
    posodobiLinoFn()
      .then((izid) => {
        setSporocilo(izid.ok ? t("posZacela") : napisNapake(izid.razlog));
        void osvezi();
      })
      .catch(() => {
        setSporocilo("");
        onError(t("posNapaka"));
      })
      .finally(() => setDelam(false));
  };
  const naVoljo = stanje?.naVoljo === true ? stanje : null;
  return (
    <Razdelek id="nast-posodobitev" naslov={t("posNaslov")} opis={t("posUvod")}>
      {!stanje ? (
        <p className="text-sm text-[var(--color-moss)]" role="status">{t("posNalagam")}</p>
      ) : !naVoljo ? (
        <p className="max-w-prose text-sm text-[var(--color-moss)]">{t("posNiNaVoljo")}</p>
      ) : (
        <dl className="grid max-w-prose grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="font-medium">{t("posNamescena")}</dt>
          <dd>{naVoljo.namescena}</dd>
          <dt className="font-medium">{t("posRazpolozljiva")}</dt>
          <dd>
            {naVoljo.razpolozljiva && naVoljo.vir
              ? `${naVoljo.razpolozljiva} (${naVoljo.vir === "github" ? t("posVirGithub") : t("posVirMapa")})`
              : naVoljo.napakaVira
                ? t("posNiVira")
                : t("posNiNovejse")}
          </dd>
        </dl>
      )}
      {naVoljo && naVoljo.razpolozljiva && !naVoljo.novejsa ? <p className="mt-2 text-sm">{t("posNiNovejse")}</p> : null}
      {naVoljo?.vir === "mapa" ? <p className="mt-2 max-w-prose text-xs text-[var(--color-moss)]">{t("posBrezPodpisa")}</p> : null}
      <p className="mt-3 max-w-prose text-xs text-[var(--color-moss)]">{t("posPojasnilo")}</p>
      <button type="button" className="lina-gumb-majhen mt-3" disabled={delam || !naVoljo?.novejsa || naVoljo.tece} onClick={posodobi}>
        {t("posGumb")}
      </button>
      <p className="mt-2 text-sm" role="status" aria-live="polite">{sporocilo}</p>
      {stanje?.zadnjiIzid ? <p className="mt-1 text-xs text-[var(--color-moss)]">{napisIzida(stanje.zadnjiIzid)}</p> : null}
      <DrugiPaketi onError={onError} napisNapake={napisNapake} napisIzida={napisIzida} />
    </Razdelek>
  );
}

const IME_PROGRAMA: Record<StanjePaketa["paket"], string> = { "lina-lupina": "Lina", "safeer-os": "Safeer OS" };

/** Drugi programi Safeer (25. 11. 2026): samo namesceni (streznik jih izbere); brez njih se ne pokaze nic. */
function DrugiPaketi({ onError, napisNapake, napisIzida }: { onError: (s: string) => void; napisNapake: (r: RazlogZavrnitve) => string; napisIzida: (i: IzidPosodobitve) => string }) {
  const [paketi, setPaketi] = useState<StanjePaketa[]>([]);
  const [delam, setDelam] = useState(false);
  const [sporocilo, setSporocilo] = useState("");
  const [navodilo, setNavodilo] = useState(false);
  const osvezi = () => stanjeDrugihPaketovFn().then(setPaketi).catch(() => {});
  useEffect(() => {
    void osvezi();
  }, []);
  // med namestitvijo in cakanjem na zamenjavo Safeer OS (najvec 120 s) stanje osvezujemo, da se izid in gumb pokazeta sama
  const caka = paketi.some((p) => p.tece || p.zamenjava === "caka");
  useEffect(() => {
    if (!caka) return;
    const id = window.setInterval(() => void osvezi(), 15_000);
    return () => window.clearInterval(id);
  }, [caka]);
  if (paketi.length === 0) return null;
  const posodobi = (paket: string) => {
    setDelam(true);
    setSporocilo(t("posZacenjam"));
    posodobiPaketFn({ data: { paket } })
      .then((izid) => {
        setSporocilo(izid.ok ? t("posZacela") : napisNapake(izid.razlog));
        void osvezi();
      })
      .catch(() => {
        setSporocilo("");
        onError(t("posNapaka"));
      })
      .finally(() => setDelam(false));
  };
  return (
    <section className="mt-6" aria-labelledby="pos-drugi-naslov">
      <h3 id="pos-drugi-naslov" className="text-sm font-semibold">{t("posDrugiNaslov")}</h3>
      {paketi.map((p) => (
        <div key={p.paket} className="mt-3">
          <dl className="grid max-w-prose grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="font-medium">{IME_PROGRAMA[p.paket]}</dt>
            <dd>{p.namescena}</dd>
            <dt className="font-medium">{t("posRazpolozljiva")}</dt>
            <dd>
              {p.razpolozljiva && p.vir
                ? `${p.razpolozljiva} (${p.vir === "github" ? t("posVirGithub") : t("posVirMapa")})`
                : p.napakaVira
                  ? t("posNiVira")
                  : t("posNiNovejse")}
            </dd>
          </dl>
          {p.vir === "mapa" ? <p className="mt-2 max-w-prose text-xs text-[var(--color-moss)]">{t("posBrezPodpisa")}</p> : null}
          {p.paket === "safeer-os" ? <p className="mt-2 max-w-prose text-xs text-[var(--color-moss)]">{t("posPojasniloSafeerOs")}</p> : null}
          <button type="button" className="lina-gumb-majhen mt-2" disabled={delam || !p.novejsa || p.tece} onClick={() => posodobi(p.paket)}>
            {t("posGumbPaket")} {IME_PROGRAMA[p.paket]}
          </button>
          {p.zadnjiIzid ? <p className="mt-1 text-xs text-[var(--color-moss)]">{napisIzida(p.zadnjiIzid)}</p> : null}
          {p.zamenjava === "caka" ? <p className="mt-1 text-sm">{t("posZamenjavaCaka")}</p> : null}
          {p.zamenjava === "zaznana" ? <p className="mt-1 text-sm">{t("posZamenjavaZaznana")}</p> : null}
          {p.zamenjava === "ne_tece" ? <p className="mt-1 text-sm">{t("posZamenjavaNeTece")}</p> : null}
          {p.zamenjava === "ni_zaznana" ? (
            <>
              <p className="mt-1 text-sm">{t("posZamenjavaNi")}</p>
              {/* samo navodilo: Lina Safeer OS ne ustavlja in ne zaganja (posodobitev.server.ts) */}
              <button type="button" className="lina-gumb-majhen mt-2" aria-expanded={navodilo} aria-controls="pos-znova-navodilo" onClick={() => setNavodilo((v) => !v)}>
                {t("posZnovaZazeni")}
              </button>
              {navodilo ? <p id="pos-znova-navodilo" className="mt-2 max-w-prose text-sm">{t("posZnovaNavodilo")}</p> : null}
            </>
          ) : null}
        </div>
      ))}
      <p className="mt-2 text-sm" role="status" aria-live="polite">{sporocilo}</p>
    </section>
  );
}

/** Razlogi stalnega procesa RSDO (stalne kode iz rsdo-streznik.server.ts in functions.ts) -> kljuc besedila (sl in en v besedila.ts). */
const RAZLOG_SLOVENSKI: Record<string, Beseda> = {
  "ni-namescen": "uiSlovenskiNiNamescen",
  "namestitev-ni-uspela": "uiSlovenskiNamestitevNiUspela",
  "ni-na-voljo-sistem": "uiSlovenskiNiNaVoljoSistem",
  "zagon-ni-uspel": "uiSlovenskiZagonNiUspel",
  "nalaganje-predolgo": "uiSlovenskiNalaganjePredolgo",
  "proces-pada": "uiSlovenskiProcesPada",
  "proces-visi": "uiSlovenskiProcesVisi",
  "prevelik-izhod": "uiSlovenskiPrevelikIzhod",
};

/** Dodatki (Paperclip, n8n, AFFiNE): privzeto izklopljeni; vklop samo dovoli uporabo, zagon vrata telemetrija (glej pravila.dodatki). */
function DodatkiPanel({ pravila, busy, onChange, onSave, onError }: { pravila: Pravila; busy: boolean; onChange: (pravila: Pravila) => void; onSave: () => void; onError: (sporocilo: string) => void }) {
  const dodatki = pravila.dodatki ?? {
    paperclip: false,
    n8n: false,
    affine: false,
    programi: false,
    slovenski: false,
  };
  const [stanja, setStanja] = useState<Record<string, string>>({});
  useEffect(() => {
    let konec = false;
    // Poizvedbe se lahko prekrivajo (pocasen odgovor): uporabi se samo odgovor najnovejse poizvedbe.
    let zadnja = 0;
    let uporabljena = 0;
    const osvezi = () => {
      const moja = ++zadnja;
      return stanjeDodatkovFn().then((s) => { if (!konec && moja > uporabljena) { uporabljena = moja; setStanja(s); } }).catch(() => {});
    };
    osvezi();
    const id = setInterval(osvezi, 5000);
    return () => { konec = true; clearInterval(id); };
  }, []);
  const napisStanja = (k: string): string => {
    const s = stanja[k];
    // slovenski najprej: sicer ga splosni vrstici spodaj prekrijeta (pregled 23. 11. 2026)
    if (k === "slovenski" && s === "deluje") return t("uiSlovenskiNalozen");
    if (k === "slovenski" && s === "se_zaganja") return t("uiSlovenskiNalaga");
    if (k === "slovenski" && s === "napaka") return t(RAZLOG_SLOVENSKI[stanja.slovenskiRazlog ?? ""] ?? "uiSlovenskiNapaka");
    if (s === "deluje") return t("uiDodatekDeluje");
    if (s === "se_zaganja") return t("uiDodatekZaganja");
    if (s === "napaka") return t("uiDodatekNapaka");
    if (s === "ni_na_voljo") return t("uiDodatekNiNaVoljo");
    return "";
  };
  const vrstice: Array<[keyof NonNullable<Pravila["dodatki"]>, string]> = [
    ["paperclip", t("uiDodatkiPaperclip")],
    ["n8n", t("uiDodatkiN8n")],
    ["affine", t("uiDodatkiAffine")],
    ["programi", t("uiDodatkiProgrami")],
    ["slovenski", t("uiDodatkiSlovenski")],
  ];
  return (
    <Razdelek id="nast-dodatki" naslov={t("uiDodatkiNaslov")} className="pb-0 sm:pb-0">
      <p className="max-w-prose text-sm text-[var(--color-moss)]">{t("uiDodatkiUvod")}</p>
      <ul className="mt-3 grid gap-1">
        {vrstice.map(([kljuc, oznaka]) => (
          <li key={kljuc}>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={dodatki[kljuc] === true}
                disabled={busy}
                onChange={(e) =>
                  onChange({
                    ...pravila,
                    dodatki: {
                      ...dodatki,
                      [kljuc]: e.target.checked,
                    },
                  })
                }
              />
              {oznaka}
              {napisStanja(kljuc) ? <span className="ml-2 text-xs text-[var(--color-moss)]">({napisStanja(kljuc)})</span> : null}
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-2 max-w-prose text-xs text-[var(--color-moss)]">{t("uiDodatkiOpomba")}</p>
      <SonioxNastavitve
        vklop={pravila.sonioxVklop === true}
        busy={busy}
        onVklop={(vklop) => onChange({ ...pravila, sonioxVklop: vklop })}
        onError={onError}
      />
      <button type="button" className="lina-gumb-majhen mt-3" disabled={busy} onClick={onSave}>
        {t("shraniPravila")}
      </button>
      <OmnirouteNastavitve onError={onError} />
    </Razdelek>
  );
}
