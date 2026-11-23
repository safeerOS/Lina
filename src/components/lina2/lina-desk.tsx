import { TinyFishKljuc } from "@/components/tinyfish-kljuc.tsx";
import { BraveKljuc } from "@/components/brave-kljuc.tsx";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { dodajBesedilo, MEJA_DOKUMENTA_BAJTOV, MEJA_ZNANJA, preberiDokument } from "@/lib/lina/znanje-besedilo.ts";
import { t } from "@/lib/lina/besedila.ts";
import { GooglePrijava } from "@/components/google-prijava.tsx";
import { PotNaslova } from "@/components/pot-naslova.tsx";
import { TwilioRacun } from "@/components/twilio-racun.tsx";
import { NujnoOznaka } from "@/components/nujno-oznaka.tsx";
import { NujniKlici } from "@/components/nujni-klici.tsx";
import { SpominLastnika } from "@/components/spomin-lastnika.tsx";
import { Podokna } from "@/components/podokna.tsx";
import { NASTAVITVE, ZNANJE, type PodoknoNastavitev, type PodoknoZnanja } from "@/lib/lina/podokna-definicije.ts";
import { GOVOR_MODELI } from "@/lib/lina/govor-model.ts";
import { razvrstiKlice } from "@/lib/lina/tajnica.ts";
import { logoutFn, setupOwnerFn, phoneTurn, publishLine, speak, saveBrainFn, checkBrainFn, chooseStorageFn, savePravilaFn, dodajVrzelFn, vajaKlicaFn, preberiSpletFn, preberiPredlogFn, potekSpletaFn, potrdiPredlogFn, zavrziPredlogFn, pogledMapeZapiskovFn, izberiMapoZapiskovFn, odpriMapoZapiskovFn, seznamZapiskovFn, preberiZapisekFn, zdruziZapiskeFn } from "@/lib/lina/functions.ts";
import type { MapaZapiskov, Zapisek, ZapisekVsebina } from "@/lib/lina/zapiski.ts";
import { delezKratkih } from "@/lib/lina/povzetek.ts";
import { DEFAULT_BRAIN_MODELS, DEFAULT_VERTEX_LOCATION, type BrainProvider, type BrainPublic, type CallSession, type Catalog, type LinijaZGlasom, type Material, type Pravila, type Predlog, type Product, type StorageView, type Vrzel, type ZapisVaje } from "@/lib/lina/types.ts";
import { jeVeljavenEnaslov, naslovJeTezakZaGovor } from "@/lib/lina/eposta.ts";
import { kazatiNamigZaVajo } from "@/lib/lina/vaja-namig.ts";
import { nizZaVklop, PREVERJENI_OPERATERJI, type Operater, type VrstaPreusmeritve } from "@/lib/lina/iphone.ts";

type Tab = "klic" | "znanje" | "narocila" | "dnevnik" | "zapiski" | "linija" | "nastavitve";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "klic", label: "Klic" },
  { id: "znanje", label: "Znanje" },
  { id: "narocila", label: "Naročila" },
  { id: "dnevnik", label: "Dnevnik" },
  { id: "zapiski", label: t("zapiskiTab") },
  { id: "linija", label: "Linija" },
  { id: "nastavitve", label: "Nastavitve" },
];

function fault(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Nekaj je šlo narobe.";
}

async function playReply(callSid: string, text: string) {
  try {
    const spoken = await speak({ data: { callSid, text } });
    if (spoken.audioBase64 && spoken.mime) {
      const audio = new Audio(`data:${spoken.mime};base64,${spoken.audioBase64}`);
      await audio.play();
      return;
    }
  } catch {
    /* Brskalnik govori naprej, če strežnik glasu nima. */
  }
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
}: {
  line: LinijaZGlasom;
  calls: CallSession[];
  llm: boolean;
  brezGesla: boolean;
  brain: BrainPublic;
  storage: StorageView;
  pravila: Pravila;
  vrzeli: Vrzel[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("klic");
  const [log, setLog] = useState(calls);
  const [active, setActive] = useState<CallSession | null>(null);
  const [gesloOdprto, setGesloOdprto] = useState(false);
  const [novoGeslo, setNovoGeslo] = useState("");
  const [gesloNapaka, setGesloNapaka] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState<Catalog>(line.catalog);
  const [open, setOpen] = useState(line.open);
  const [seconds, setSeconds] = useState(0);
  const [mind, setMind] = useState(brain);
  const [place, setPlace] = useState(storage);
  const [pravila, setPravila] = useState(pravilaIn);
  const [vrzeli, setVrzeli] = useState(vrzeliIn);

  // Dokler se glas pripravlja, stanje osvezimo, da lastnik vidi napredek ali razlog napake.
  useEffect(() => {
    if (!line.glas.vTeku) return;
    const casovnik = setInterval(() => void router.invalidate(), 3000);
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
    setPravila(pravilaIn);
  }, [pravilaIn]);

  useEffect(() => {
    setVrzeli(vrzeliIn);
  }, [vrzeliIn]);

  useEffect(() => {
    if (!active || active.status !== "v-teku") return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  const orders = useMemo(() => log.filter((call) => call.order.confirmed), [log]);
  const delez = useMemo(() => delezKratkih(log), [log]);
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  async function refresh() {
    await router.invalidate();
  }

  async function turn(callSid: string, text: string, from = "pisarna") {
    const result = await phoneTurn({ data: { callSid, from, text } });
    setActive(result.call);
    setLog((prev) => [result.call, ...prev.filter((item) => item.callSid !== result.call.callSid)]);
    await playReply(result.call.callSid, result.reply);
    return result.call;
  }

  async function accept() {
    setError("");
    setBusy(true);
    setSeconds(0);
    try {
      const callSid = `lokalno-${crypto.randomUUID()}`;
      await turn(callSid, "");
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
      const callSid = active?.callSid ?? `lokalno-${crypto.randomUUID()}`;
      await turn(callSid, clean);
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
      const result = await phoneTurn({ data: { callSid: active.callSid, hangup: true } });
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
      const saved = await publishLine({ data: { open: nextOpen, catalog: nextCatalog, ...(brezGlasu ? { brezGlasu: true } : {}) } });
      // Linija se odpre sele, ko je glas pripravljen ali ko uporabnik potrdi odprtje brez glasu: velja stanje s streznika.
      setOpen(saved.open);
      setCatalog(nextCatalog);
      if (saved.opozorila?.length) setError(saved.opozorila.join(" "));
      await refresh();
    } catch (cause) {
      setError(fault(cause));
    } finally {
      setBusy(false);
    }
  }

  async function saveRules(next: Pravila = pravila) {
    setBusy(true);
    setError("");
    try {
      const saved = await savePravilaFn({ data: next });
      setPravila(saved);
      if (saved.opozorila?.length) setError(saved.opozorila.join(" "));
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
      setError("Ta brskalnik nima prepoznave govora. Pišite v polje.");
      return;
    }
    const rec = new Ctor();
    rec.lang = "sl-SI";
    rec.onresult = (event) => {
      const said = event.results[0]?.[0]?.transcript ?? "";
      if (said) void send(said);
    };
    rec.start();
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-5 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-4xl sm:text-5xl">Lina</h1>
          <p className="text-xs tracking-[0.28em] text-[var(--color-brass)] uppercase">{t("podnaslov")}</p>
          <p className="mt-1 max-w-xl text-sm text-[var(--color-moss)]">
            {catalog.company.name ? `${t("zaPodjetje")} ${catalog.company.name} · ` : ""}
            {open ? "linija je odprta" : "linija je zaprta"}
            {mind.nastavljen ? ` · ${mind.provider}` : llm ? " · možgani iz okolja" : " · odgovarja samo iz kataloga"}
          </p>
        </div>
        {brezGesla ? (
          <button
            type="button"
            className="rounded-full border border-[var(--color-ink)] px-4 py-2 text-sm"
            onClick={() => setGesloOdprto((v) => !v)}
          >
            {t("gesloNeobvezno")}
          </button>
        ) : (
          <button
            type="button"
            className="rounded-full border border-[var(--color-ink)] px-4 py-2 text-sm"
            onClick={async () => {
              await logoutFn();
              await refresh();
            }}
          >
            Odjava
          </button>
        )}
      </header>
      {brezGesla && gesloOdprto ? (
        <form
          className="mt-4 max-w-md rounded-2xl border border-[var(--color-rule)] bg-[var(--color-sheet)] p-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setGesloNapaka("");
            try {
              await setupOwnerFn({ data: { password: novoGeslo } });
              setNovoGeslo("");
              setGesloOdprto(false);
              await refresh();
            } catch (cause) {
              setGesloNapaka(cause instanceof Error ? cause.message : "Gesla ni bilo mogoče nastaviti.");
            }
          }}
        >
          <p className="text-sm text-[var(--color-moss)]">{t("gesloOpomba")}</p>
          <label className="mt-3 block text-sm" htmlFor="novo-geslo">
            {t("gesloNovo")}
          </label>
          <input
            id="novo-geslo"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={novoGeslo}
            onChange={(event) => setNovoGeslo(event.target.value)}
            className="mt-2 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2 outline-none focus:border-[var(--color-signal)]"
          />
          {gesloNapaka ? (
            <p role="alert" className="mt-2 text-sm text-[var(--color-signal)]">
              {gesloNapaka}
            </p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <button type="submit" className="rounded-full bg-[var(--color-signal)] px-4 py-2 text-sm text-white">
              {t("gesloShrani")}
            </button>
            <button type="button" className="rounded-full border border-[var(--color-ink)] px-4 py-2 text-sm" onClick={() => setGesloOdprto(false)}>
              {t("gesloPreklici")}
            </button>
          </div>
        </form>
      ) : null}

      <nav className="mt-6 flex gap-2 overflow-x-auto pb-1" aria-label="Razdelki">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded-full px-4 py-2 text-sm whitespace-nowrap ${
              tab === item.id ? "bg-[var(--color-ink)] text-[var(--color-sheet)]" : "bg-white/70"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {error ? <p className="mt-4 text-sm text-[var(--color-signal)]">{error}</p> : null}

      {tab === "klic" ? (
        <section className="mt-5 grid items-start gap-5 lg:grid-cols-[340px_1fr]">
          <div className="phone">
            <div className="phone-screen flex flex-col p-4">
              <div className="text-center">
                <p className="display text-lg tracking-wide">LINA</p>
                <p className="text-xs text-[var(--color-brass)]">
                  {active?.status === "v-teku" ? `Klic v teku · ${clock}` : "Slušalka je pripravljena"}
                </p>
                {active?.status === "v-teku" ? (
                  <div className="wave mx-auto mt-3 justify-center" aria-hidden="true">
                    {Array.from({ length: 7 }, (_, index) => (
                      <span key={index} />
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="mt-4 flex max-h-64 flex-col gap-2 overflow-y-auto text-sm">
                {(active?.transcript ?? []).map((item, index) => (
                  <p
                    key={`${item.at}-${index}`}
                    className={`max-w-[90%] rounded-2xl px-3 py-2 ${
                      item.role === "lina" ? "self-start bg-white" : "self-end bg-[var(--color-ink)] text-[var(--color-sheet)]"
                    }`}
                  >
                    {item.text}
                    {item.razumljeno ? (
                      <span className="ml-2 text-xs opacity-70">
                        ({t("zapisekRazumljeno")}: {item.razumljeno})
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
                    className="flex-1 rounded-full bg-[var(--color-signal)] py-3 text-sm text-white disabled:opacity-60"
                  >
                    Sprejmi
                  </button>
                  <button
                    type="button"
                    disabled={busy || !active}
                    onClick={() => void hangup()}
                    className="rounded-full border border-[var(--color-ink)] px-4 py-3 text-sm disabled:opacity-40"
                  >
                    Odloži
                  </button>
                </div>
                <form
                  className="mt-3 flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void send(draft);
                  }}
                >
                  <label className="sr-only" htmlFor="replika">
                    Replika stranke
                  </label>
                  <input
                    id="replika"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Govorite kot stranka…"
                    className="min-w-0 flex-1 rounded-full border border-[var(--color-rule)] bg-white px-4 py-3"
                  />
                  <button type="button" onClick={listen} className="rounded-full bg-white px-3 text-sm" aria-label="Govorite">
                    Glas
                  </button>
                  <button type="submit" disabled={busy} className="rounded-full bg-[var(--color-ink)] px-4 text-sm text-white">
                    Pošlji
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

      {tab === "narocila" ? (
        <section className="mt-5 grid gap-3">
          {orders.length === 0 ? <p className="text-sm">Potrjenih naročil še ni.</p> : null}
          {orders.map((call) => (
            <article key={call.callSid} className="rounded-2xl bg-[var(--color-sheet)] p-4">
              <h2 className="display text-2xl">{call.order.customerName || "Stranka"}</h2>
              <p className="text-sm">
                {call.order.productName} · {call.order.materialName}
                {call.order.quantity ? ` · ${call.order.quantity} kos` : ""}
              </p>
              <p className="text-xs text-[var(--color-brass)]">{call.order.notes || "Brez mer"}</p>
            </article>
          ))}
        </section>
      ) : null}

      {tab === "dnevnik" ? (
        <section className="mt-5 grid gap-3">
          <p className="text-sm text-[var(--color-moss)]">
            {t("kratkiKlici")}: {delez.odstotki} %
          </p>
          {log.length === 0 ? <p className="text-sm">Dnevnik je prazen.</p> : null}
          {razvrstiKlice(log).map((call) => (
            <button
              key={call.callSid}
              type="button"
              onClick={() => {
                setActive(call);
                setTab("klic");
              }}
              className="rounded-2xl bg-white/80 p-4 text-left"
            >
              <span className="flex flex-wrap items-center gap-2">
                {call.order.tajnica?.nujno ? <NujnoOznaka /> : null}
                <span className="text-xs text-[var(--color-brass)]">{call.callSid}</span>
              </span>
              <span className="mt-1 block text-sm">
                {call.order.confirmed ? "Potrjeno" : "Osnutek"} · {call.order.requestedProduct || "brez izdelka"}
                {call.order.violations.includes("material") ? " · material zavrnjen" : ""}
                {call.kratek ? ` · ${t("kratekOznaka")}` : ""}
                {call.order.potrditevEposta ? ` · ${t("potrditevOznaka")}` : ""}
              </span>
              <CasiKlica call={call} />
              {call.povzetek ? (
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  {call.povzetek.nujno ? (
                    <div className="sm:col-span-2">
                      <dt className="sr-only">{t("zapisekOznaka")}</dt>
                      <dd>
                        <NujnoOznaka />
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-xs text-[var(--color-brass)]">{t("povzetekKdo")}</dt>
                    <dd>{call.povzetek.kdo}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--color-brass)]">{t("povzetekZelel")}</dt>
                    <dd>{call.povzetek.zelel}</dd>
                  </div>
                  {call.povzetek.obljubila ? (
                    <div>
                      <dt className="text-xs text-[var(--color-brass)]">{t("povzetekObljubila")}</dt>
                      <dd>{call.povzetek.obljubila}</dd>
                    </div>
                  ) : null}
                  {call.povzetek.narediti ? (
                    <div>
                      <dt className="text-xs text-[var(--color-brass)]">{t("povzetekNarediti")}</dt>
                      <dd>{call.povzetek.narediti}</dd>
                    </div>
                  ) : null}
                  {call.povzetek.sporocilo ? (
                    <div className="sm:col-span-2">
                      <dt className="text-xs text-[var(--color-brass)]">{t("zapisekSporocilo")}</dt>
                      <dd className="break-words">{call.povzetek.sporocilo}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
            </button>
          ))}
        </section>
      ) : null}

      {tab === "zapiski" ? <ZapiskiPanel onError={setError} /> : null}

      {tab === "linija" ? (
        <section className="mt-5 max-w-xl rounded-3xl bg-[var(--color-sheet)] p-5">
          <h2 className="display text-3xl">{open ? t("linijaNaslovOdprta") : t("linijaNaslovZaprta")}</h2>
          <p className="mt-2 text-sm">{t("linijaPojasnilo")}</p>
          {kazatiNamigZaVajo({ odprta: open, steviloKlicev: log.length }) ? (
            <p className="mt-2 text-sm font-medium" role="status">
              {t("vajaPredOdprtjem")}
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy}
            className="mt-4 rounded-full bg-[var(--color-signal)] px-4 py-3 text-sm text-white"
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
                  if (window.confirm(t("odprtjePotrdi"))) void saveLine(true, catalog, true);
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
          <VajaKlica busy={busy} onError={setError} onBusy={setBusy} />
        </section>
      ) : null}

      {tab === "nastavitve" ? (
        <NastavitveVsebina
          pravila={pravila}
          mind={mind}
          place={place}
          busy={busy}
          onPravila={setPravila}
          onSave={() => void saveRules()}
          onBrain={setMind}
          onPlace={setPlace}
          onError={setError}
          onBusy={setBusy}
        />
      ) : null}
    </main>
  );
}

/** Zavihek Nastavitve: razdelki v podoknih (nastavitve-podokna.tsx). Izvozeno zaradi preizkusa. */
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
}: {
  pravila: Pravila;
  mind: BrainPublic;
  place: StorageView;
  busy: boolean;
  zacetno?: PodoknoNastavitev;
  onPravila: (pravila: Pravila) => void;
  onSave: () => void;
  onBrain: (brain: BrainPublic) => void;
  onPlace: (place: StorageView) => void;
  onError: (message: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const skupne = { pravila, busy, onChange: onPravila, onSave, onError };
  return (
    <Podokna
      def={NASTAVITVE}
      zacetno={zacetno}
      razdelki={{
        "pravila-prevzem": <PravilaPrevzem {...skupne} />,
        "pravila-pozdrav": <PravilaPozdrav {...skupne} />,
        "pravila-javni-naslov": <PravilaJavniNaslov {...skupne} />,
        "pravila-twilio": <PravilaTwilio {...skupne} />,
        iphone: <IphoneNavodila />,
        "pravila-odgovori": <PravilaOdgovori {...skupne} />,
        "pravila-potrditev": <PravilaPotrditev {...skupne} />,
        mozgani: <Settings brain={mind} busy={busy} onBrain={onBrain} onError={onError} onBusy={onBusy} />,
        "pravila-snemanje": <PravilaSnemanje {...skupne} />,
        shranjevanje: <StoragePanel place={place} busy={busy} onPlace={onPlace} onError={onError} onBusy={onBusy} />,
        "mapa-zapiskov": <MapaZapiskovPanel onError={onError} />,
      }}
    />
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
    <ul className="mt-1 grid gap-1 text-sm">
      {VRSTE_PREUSMERITVE.map(([vrsta, oznaka]) => {
        const predpona = operater.vklop[vrsta];
        if (!predpona) return null;
        const izklop = operater.izklop[vrsta];
        return (
          <li key={vrsta}>
            {t(oznaka)}: <code>{nizZaVklop(predpona, mesto)}</code>
            {izklop ? (
              <>
                {" "}
                ({t("iphoneIzklop")}: <code>{izklop}</code>)
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
    <section className="max-w-xl rounded-3xl bg-[var(--color-sheet)] p-5" aria-labelledby="iphone-naslov">
      <h2 id="iphone-naslov" className="display text-3xl">
        {t("iphoneNaslov")}
      </h2>
      <p className="mt-2 text-sm">{t("iphoneUvod")}</p>
      <ol className="mt-3 grid gap-3 text-sm">
        <li>{t("iphoneKorak1")}</li>
        <li>
          {t("iphoneKorak2")}
          <div className="mt-2 grid gap-3">
            {telekom ? (
              <div>
                <p>{t("iphoneTelekom")}</p>
                <NizOperaterja operater={telekom} />
              </div>
            ) : null}
            {telemach ? (
              <div>
                <p>{t("iphoneTelemach")}</p>
                <NizOperaterja operater={telemach} />
              </div>
            ) : null}
            <p>{t("iphoneA1")}</p>
            <p>{t("iphoneDrugi")}</p>
          </div>
        </li>
        <li>{t("iphoneKorak3")}</li>
      </ol>
      <h3 className="display mt-5 text-2xl">{t("iphoneOmejitveNaslov")}</h3>
      <ul className="mt-2 grid list-disc gap-2 pl-5 text-sm">
        <li>{t("iphoneOmej1")}</li>
        <li>{t("iphoneOmej2")}</li>
        <li>{t("iphoneOmej3")}</li>
        <li>{t("iphoneOmej4")}</li>
        <li>{t("iphoneOmej6")}</li>
        <li>{t("iphoneOmej5")}</li>
      </ul>
      <p className="mt-3 text-xs text-[var(--color-moss)]">{t("iphoneViri")}</p>
    </section>
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
  const [key, setKey] = useState("");
  const [project, setProject] = useState(brain.projekt ?? "");
  const [location, setLocation] = useState(brain.lokacija || DEFAULT_VERTEX_LOCATION);
  const [note, setNote] = useState("");
  const vertex = provider === "vertex";

  useEffect(() => {
    setProvider(brain.provider ?? "grok");
    setModel(brain.model || DEFAULT_BRAIN_MODELS[brain.provider ?? "grok"]);
    setProject(brain.projekt ?? "");
    setLocation(brain.lokacija || DEFAULT_VERTEX_LOCATION);
  }, [brain]);

  async function save() {
    onBusy(true);
    onError("");
    setNote("");
    try {
      const next = await saveBrainFn({ data: { provider, model, key, project, location } });
      onBrain(next);
      setKey("");
      setNote(
        vertex
          ? "Shranjeno. Žeton se ne shranjuje; prijava je na tem računalniku."
          : next.nastavljen
            ? "Shranjeno. Ključ ostane na strežniku."
            : "Ponudnik je shranjen, ključa še ni.",
      );
    } catch (cause) {
      onError(fault(cause));
    } finally {
      onBusy(false);
    }
  }

  async function probe() {
    onBusy(true);
    onError("");
    setNote("");
    try {
      const result = await checkBrainFn({ data: { provider, model, key, project, location } });
      setNote(result.sporocilo);
      if (!result.ok) onError(result.sporocilo);
    } catch (cause) {
      onError(fault(cause));
    } finally {
      onBusy(false);
    }
  }

  return (
    <section className="max-w-xl rounded-3xl bg-[var(--color-sheet)] p-5">
      <h2 className="display text-3xl">Možgani</h2>
      <p className="mt-2 text-sm">
        {vertex
          ? "Vertex uporablja prijavo Google Cloud na tem računalniku. Ključa API ni, žeton se ne shranjuje."
          : `Ključ se shrani šifriran in se v brskalnik ne vrača${brain.namig ? ` (…${brain.namig})` : ""}. Spremenljivke okolja ostanejo rezerva, če ključa ni.`}
      </p>
      <label className="mt-4 block text-sm">
        Ponudnik
        <select
          value={provider}
          onChange={(event) => {
            const next = event.target.value as BrainProvider;
            setProvider(next);
            setModel(DEFAULT_BRAIN_MODELS[next]);
            if (next === "vertex" && !location.trim()) setLocation(DEFAULT_VERTEX_LOCATION);
          }}
          className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
        >
          <option value="gemini">Gemini – ključ iz Google AI Studia</option>
          <option value="vertex">Google Cloud (Vertex AI) – prijava z računom</option>
          <option value="openai">OpenAI</option>
          <option value="claude">Claude</option>
          <option value="grok">Grok</option>
        </select>
      </label>
      <label className="mt-3 block text-sm">
        Model
        <input
          value={model}
          onChange={(event) => setModel(event.target.value)}
          className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
        />
      </label>
      {vertex ? (
        <>
          <label className="mt-3 block text-sm" htmlFor="projekt">
            ID projekta
            <input
              id="projekt"
              value={project}
              autoComplete="off"
              onChange={(event) => setProject(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
            />
          </label>
          <label className="mt-3 block text-sm" htmlFor="lokacija">
            Lokacija
            <input
              id="lokacija"
              value={location}
              autoComplete="off"
              onChange={(event) => setLocation(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
            />
          </label>
          <GooglePrijava project={project} onProject={setProject} onError={onError} />
        </>
      ) : (
        <label className="mt-3 block text-sm">
          Ključ
          <input
            type="password"
            autoComplete="off"
            value={key}
            placeholder={brain.nastavljen ? "Pustite prazno, če ostane shranjeni" : "Prilepite ključ"}
            onChange={(event) => setKey(event.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
          />
        </label>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void save()} className="rounded-full bg-[var(--color-ink)] px-4 py-3 text-sm text-white">
          Shrani
        </button>
        <button type="button" disabled={busy} onClick={() => void probe()} className="rounded-full bg-[var(--color-signal)] px-4 py-3 text-sm text-white">
          {vertex ? "Preveri prijavo" : "Preveri ključ"}
        </button>
      </div>
      {note ? <p className="mt-3 text-sm">{note}</p> : null}
    </section>
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
      else setNote("Mapa je preklopljena. Stara mapa je ostala nedotaknjena.");
    } catch (cause) {
      onError(fault(cause));
    } finally {
      onBusy(false);
    }
  }

  return (
    <section className="max-w-xl rounded-3xl bg-[var(--color-sheet)] p-5">
      <h2 className="display text-3xl">Shranjevanje</h2>
      <p className="mt-2 text-sm">Trenutna mapa</p>
      <p className="mt-1 break-all text-sm text-[var(--color-moss)]">{place.mapa}</p>
      <label className="mt-4 block text-sm" htmlFor="mapa">
        Nova mapa
        <input
          id="mapa"
          value={pathValue}
          onChange={(event) => setPathValue(event.target.value)}
          className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
        />
      </label>
      <button type="button" disabled={busy} onClick={() => void choose()} className="mt-4 rounded-full bg-[var(--color-ink)] px-4 py-3 text-sm text-white">
        Izberi mapo
      </button>
      {place.opozorila.map((item) => (
        <p key={item} className="mt-3 text-sm text-[var(--color-brass)]">
          {item}
        </p>
      ))}
      {note ? <p className="mt-3 text-sm">{note}</p> : null}
    </section>
  );
}

const GUMB = "rounded-full bg-[var(--color-ink)] px-4 py-3 text-sm text-white transition-colors motion-reduce:transition-none disabled:opacity-50";
const GUMB_OBROBA =
  "rounded-full border border-[var(--color-ink)] bg-white px-4 py-2 text-sm text-[var(--color-ink)] transition-colors motion-reduce:transition-none";
const FOKUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)]";

function casZapiska(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString("sl-SI") : "";
}

/** Oddelek »Zapiski«: seznam po casu, izbira vec zapiskov, Zdruzi in »Odpri« v vrstici vsakega zapiska. */
function ZapiskiPanel({ onError }: { onError: (message: string) => void }) {
  const [seznam, setSeznam] = useState<Zapisek[] | null>(null);
  const [izbrani, setIzbrani] = useState<string[]>([]);
  const [odstrani, setOdstrani] = useState(false);
  const [odprt, setOdprt] = useState<ZapisekVsebina | null>(null);
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
    void naloziSeznam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (odprt) naslovRef.current?.focus();
  }, [odprt]);

  function preklopi(id: string) {
    setIzbrani((prej) => (prej.includes(id) ? prej.filter((x) => x !== id) : [...prej, id]));
  }

  async function odpri(id: string) {
    onError("");
    try {
      setOdprt(await preberiZapisekFn({ data: { id } }));
    } catch (cause) {
      onError(fault(cause));
    }
  }

  async function zdruzi() {
    setBusy(true);
    onError("");
    setNote("");
    try {
      await zdruziZapiskeFn({ data: { ids: izbrani, odstrani } });
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
        <p className="text-sm">{t("zapiskiNamig")}</p>
        {seznam === null ? <p className="text-sm">{t("zapiskiNalaganje")}</p> : null}
        {seznam?.length === 0 ? <p className="text-sm">{t("zapiskiPrazno")}</p> : null}
        {seznam && seznam.length > 0 ? (
          <ul className="grid gap-2" aria-label={t("zapiskiSeznam")}>
            {seznam.map((z) => (
              <li key={z.id} className="flex items-start gap-3 rounded-2xl bg-white/80 p-3">
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
                  </p>
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
              {t("zapiskiIzbranih")}: {izbrani.length}
            </p>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className={`mt-1 h-5 w-5 ${FOKUS}`} checked={odstrani} onChange={(e) => setOdstrani(e.target.checked)} />
              <span>
                {t("zapiskiOdstrani")}
                <span className="block text-xs text-[var(--color-brass)]">{t("zapiskiOdstraniNamig")}</span>
              </span>
            </label>
            <div>
              <button type="button" disabled={busy || izbrani.length < 2} onClick={() => void zdruzi()} className={`${GUMB} ${FOKUS}`}>
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
            <button type="button" onClick={() => setOdprt(null)} className={`${GUMB_OBROBA} shrink-0 ${FOKUS}`}>
              {t("zapiskiZapri")}
            </button>
          </div>
          <pre className="mt-4 text-sm break-words whitespace-pre-wrap">{odprt.vsebina.replace(/^<!--\s*lina-[a-z]+:.*-->\n?/gm, "")}</pre>
        </article>
      ) : null}
    </section>
  );
}

/** Nastavitev mape zapiskov: polna pot (nikoli ~), »Odpri mapo« in, ce odpiranje ne gre, kopiranje poti. */
function MapaZapiskovPanel({ onError }: { onError: (message: string) => void }) {
  const [pogled, setPogled] = useState<MapaZapiskov | null>(null);
  const [vnos, setVnos] = useState("");
  const [note, setNote] = useState("");
  const [neOdpre, setNeOdpre] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let ziv = true;
    pogledMapeZapiskovFn()
      .then((p) => {
        if (!ziv) return;
        setPogled(p);
        setVnos(p.jePrivzeta ? "" : p.mapa);
      })
      .catch((cause) => onError(fault(cause)));
    return () => {
      ziv = false;
    };
  }, [onError]);

  async function shrani(izbira: string) {
    setBusy(true);
    onError("");
    setNote("");
    setNeOdpre(false);
    try {
      const izid = await izberiMapoZapiskovFn({ data: { mapa: izbira } });
      if (!izid.ok) {
        onError(izid.razlog);
      } else {
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

  if (!pogled) return null;
  return (
    <section className="max-w-xl rounded-3xl bg-[var(--color-sheet)] p-5" aria-labelledby="mapa-zapiskov">
      <h2 id="mapa-zapiskov" className="display text-3xl">
        {t("mapaNaslov")}
      </h2>
      <p className="mt-2 text-sm">{t("mapaTrenutna")}</p>
      <p className="mt-1 break-all text-sm text-[var(--color-moss)]">{pogled.mapa}</p>
      {pogled.jePrivzeta ? <p className="mt-1 text-xs text-[var(--color-brass)]">{t("mapaPrivzeta")}</p> : null}
      <label className="mt-4 block text-sm" htmlFor="mapa-zapiskov-vnos">
        {t("mapaNova")}
        <input
          id="mapa-zapiskov-vnos"
          value={vnos}
          onChange={(event) => setVnos(event.target.value)}
          className={`mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2 ${FOKUS}`}
        />
      </label>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void shrani(vnos)} className={`${GUMB} ${FOKUS}`}>
          {t("mapaShrani")}
        </button>
        <button type="button" onClick={() => void odpriMapo()} className={`${GUMB_OBROBA} ${FOKUS}`}>
          {t("mapaOdpri")}
        </button>
        {!pogled.jePrivzeta ? (
          <button type="button" disabled={busy} onClick={() => void shrani("")} className={`${GUMB_OBROBA} ${FOKUS}`}>
            {t("mapaPrivzetaGumb")}
          </button>
        ) : null}
        {neOdpre ? (
          <button type="button" onClick={() => void kopiraj()} className={`${GUMB_OBROBA} ${FOKUS}`}>
            {t("mapaKopiraj")}
          </button>
        ) : null}
      </div>
      {pogled.opozorila.map((item) => (
        <p key={item} className="mt-3 text-sm text-[var(--color-brass)]">
          {item}
        </p>
      ))}
      {note ? (
        <p className="mt-3 text-sm" role="status">
          {note}
        </p>
      ) : null}
    </section>
  );
}

function Slip({ call }: { call: CallSession | null }) {
  const order = call?.order;
  return (
    <aside className="slip min-w-0 rounded-2xl p-5 sm:p-7">
      <p className="text-xs tracking-[0.22em] text-[var(--color-brass)] uppercase">Zapisnik</p>
      {order?.tajnica?.nujno ? (
        <p className="mt-2">
          <NujnoOznaka />
        </p>
      ) : null}
      <h2 className="display mt-1 text-3xl">{order?.customerName || "Še brez imena"}</h2>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <Row label="Telefon" value={order?.phone || "—"} />
        <Row label="E-pošta" value={order?.email || "—"} />
        <Row label="Izdelek" value={order?.productName || order?.requestedProduct || "—"} bad={!order?.productName && Boolean(order?.requestedProduct)} />
        <Row label="Material" value={order?.materialName || order?.requestedMaterial || "—"} bad={!order?.materialName && Boolean(order?.requestedMaterial)} />
        <Row label="Količina" value={order?.quantity ? String(order.quantity) : "—"} />
        <Row label="Mere" value={order?.notes || "—"} />
        <Row label={t("rok")} value={order?.deadline || "—"} />
        <Row label="Klic" value={call?.callSid || "—"} />
        {order?.podjetjeKlicatelja ? <Row label={t("zapisekPodjetje")} value={order.podjetjeKlicatelja} /> : null}
        {order?.dosegljiv && order.dosegljiv !== "ni-nujno" ? <Row label={t("dosegljivOznaka")} value={order.dosegljiv} /> : null}
        {order?.tajnica?.razlog ? <Row label={t("zapisekRazlog")} value={order.tajnica.razlog} /> : null}
        {order?.tajnica?.sporocilo ? <Row label={t("zapisekSporocilo")} value={order.tajnica.sporocilo} dolg /> : null}
        {(call?.nujniDogodki ?? []).map((d, i) => (
          <Row
            key={`${d.cas}-${i}`}
            label={t(d.vrsta === "obvestilo" ? "nujniDogodekObvestilo" : "nujniDogodekPrevezava")}
            value={`${new Date(d.cas).toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit" })}: ${t(IZID_NUJNEGA[d.izid])}`}
            dolg
          />
        ))}
      </dl>
      <p className={`display mt-6 text-2xl ${order?.confirmed ? "text-[var(--color-signal)]" : "text-[var(--color-brass)]"}`}>
        {order?.confirmed ? "POTRJENO" : "OSNUTEK"}
      </p>
      {order?.oznaka ? <p className="mt-2 text-sm text-[var(--color-brass)]">{order.oznaka}</p> : null}
      {order?.violations.length ? (
        <p className="mt-2 text-sm text-[var(--color-signal)]">Zunaj kataloga: {order.violations.join(", ")}. Tega ne obljubim.</p>
      ) : null}
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
      <dd className={`${dolg ? "break-words" : "truncate"} ${bad ? "text-[var(--color-signal)]" : ""}`}>{value}</dd>
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
  const [naslov, setNaslov] = useState("");
  const [predlog, setPredlog] = useState<Predlog | null>(null);
  const [strani, setStrani] = useState(0);
  const [bere, setBere] = useState(false);

  useEffect(() => {
    void preberiPredlogFn()
      .then((next) => {
        if (!next) return;
        setPredlog(next);
        setStrani(next.strani);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!bere) return;
    const id = window.setInterval(() => {
      void potekSpletaFn()
        .then((stanje) => setStrani(stanje.strani))
        .catch(() => undefined);
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
      if (prev.znanje && prev.znanje.id === id) {
        return { ...prev, znanje: { ...prev.znanje, izbrano: !prev.znanje.izbrano } };
      }
      if (prev.podjetje.id === id) {
        return { ...prev, podjetje: { ...prev.podjetje, izbrano: !prev.podjetje.izbrano } };
      }
      return {
        ...prev,
        vrstice: prev.vrstice.map((vrstica) => (vrstica.id === id ? { ...vrstica, izbrano: !vrstica.izbrano } : vrstica)),
      };
    });
  }

  async function potrdi() {
    if (!predlog) return;
    const ids = [
      ...(predlog.podjetje.izbrano ? [predlog.podjetje.id] : []),
      ...(predlog.znanje?.izbrano && predlog.znanje.besedilo ? [predlog.znanje.id] : []),
      ...predlog.vrstice.filter((vrstica) => vrstica.izbrano).map((vrstica) => vrstica.id),
    ];
    onBusy(true);
    onError("");
    try {
      const catalog = await potrdiPredlogFn({ data: { ids } });
      onCatalog(catalog);
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
          className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
        />
      </label>
      <button type="button" disabled={busy} onClick={() => void preberi()} className="w-fit rounded-full bg-[var(--color-ink)] px-4 py-2 text-sm text-white">
        {bere ? t("spletBerem") : t("spletGumb")}
      </button>
      {bere || strani > 0 ? (
        <p className="text-sm">
          {t("spletNapredek")}: {strani}
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
                  {t("spletUre")}: {predlog.podjetje.ure}
                </span>
              ) : null}
              {predlog.podjetje.stik ? (
                <span className="mt-1 block">
                  {t("spletStik")}: {predlog.podjetje.stik}
                </span>
              ) : null}
            </span>
          </label>
          {predlog.znanje?.besedilo ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={predlog.znanje.izbrano} onChange={() => toggle(predlog.znanje?.id ?? "znanje")} />
              <span>
                <span className="text-[var(--color-brass)]">{t("spletZnanje")}</span>
                <span className="mt-1 block max-h-48 overflow-y-auto whitespace-pre-wrap">{predlog.znanje.besedilo}</span>
              </span>
            </label>
          ) : null}
          {predlog.vrstice.map((vrstica) => (
            <label key={vrstica.id} className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={vrstica.izbrano} onChange={() => toggle(vrstica.id)} />
              <span>
                <span className="text-[var(--color-brass)]">{vrstica.vrsta === "material" ? t("spletMaterial") : t("spletIzdelek")}</span>
                <span className="mt-1 block">
                  {t("spletIme")}: {vrstica.ime}
                </span>
                {vrstica.opis ? (
                  <span className="mt-1 block">
                    {t("spletOpis")}: {vrstica.opis}
                  </span>
                ) : null}
                {vrstica.material ? (
                  <span className="mt-1 block">
                    {t("spletMaterial")}: {vrstica.material}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void potrdi()} className="rounded-full bg-[var(--color-signal)] px-4 py-2 text-sm text-white">
              {t("spletPotrdi")}
            </button>
            <button type="button" disabled={busy} onClick={() => void zavrzi()} className="rounded-full bg-white px-4 py-2 text-sm">
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
  onChange: (catalog: Catalog) => void;
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
      onChange({ ...catalog, znanje: skupaj.besedilo });
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
        onChange={(event) => onChange({ ...catalog, znanje: event.target.value })}
        className="w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
      />
      <p className="text-xs text-[var(--color-moss)]">
        {znanje.length} / {MEJA_ZNANJA} {t("znanjeZnakov")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className={`w-fit cursor-pointer rounded-full bg-white px-4 py-2 text-sm ${busy ? "pointer-events-none opacity-60" : ""}`}>
          {t("znanjeDokument")}
          <input
            type="file"
            accept=".txt,.md,.markdown,text/plain,text/markdown"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void naloziDokument(file);
            }}
          />
        </label>
        {opomba ? <span className="text-sm">{opomba}</span> : null}
      </div>
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
  onChange: (catalog: Catalog) => void;
  onPravila: (pravila: Pravila) => void;
  onVrzeli: (vrzeli: Vrzel[]) => void;
  onSave: () => void;
  onSaveRules: () => void;
  onError: (message: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  function patchCompany(key: keyof Catalog["company"], value: string) {
    onChange({ ...catalog, company: { ...catalog.company, [key]: value } });
  }

  function patchMaterial(index: number, patch: Partial<Material>) {
    const materials = catalog.materials.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
    onChange({ ...catalog, materials });
  }

  function patchProduct(index: number, patch: Partial<Product>) {
    const products = catalog.products.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
    onChange({ ...catalog, products });
  }

  function toggleMaterial(productIndex: number, material: Material) {
    const product = catalog.products[productIndex];
    const keys = [material.id, material.name].filter(Boolean);
    const has = product.materialIds.some((id) => keys.includes(id) || id.toLowerCase() === material.name.toLowerCase());
    const materialIds = has
      ? product.materialIds.filter((id) => !keys.includes(id) && id.toLowerCase() !== material.name.toLowerCase())
      : [...product.materialIds, material.name || material.id];
    patchProduct(productIndex, { materialIds });
  }

  const shrani = (
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={onSave} className="rounded-full bg-[var(--color-ink)] px-4 py-2 text-sm text-white">
        Shrani znanje
      </button>
    </div>
  );
  return (
    <Podokna
      def={ZNANJE}
      zacetno={zacetno}
      razdelki={{
        podjetje: (
      <div className="grid gap-3 rounded-3xl bg-[var(--color-sheet)] p-4 sm:grid-cols-2">
        {(
          [
            ["name", "Podjetje"],
            ["trade", "Dejavnost"],
            ["phone", "Telefon"],
            ["address", "Naslov"],
            ["hours", "Ure"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="text-sm">
            {label}
            <input
              value={catalog.company[key]}
              onChange={(event) => patchCompany(key, event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
            />
          </label>
        ))}
        <label className="text-sm sm:col-span-2">
          O delavnici
          <textarea
            value={catalog.company.about}
            onChange={(event) => patchCompany("about", event.target.value)}
            rows={3}
            className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
          />
        </label>
      </div>
        ),
        informacije: (
      <ZnanjePolje catalog={catalog} busy={busy} onChange={onChange} onError={onError} />
        ),
        "shrani-podjetje": shrani,
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
            onChange={(event) => onPravila({ ...pravila, povprasevanje: event.target.value })}
            className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
          />
        </label>
        <button type="button" disabled={busy} onClick={onSaveRules} className="w-fit rounded-full bg-[var(--color-ink)] px-4 py-2 text-sm text-white">
          {t("shraniPravila")}
        </button>
      </div>
        ),
        "materiali-izdelki": (
      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <h2 className="display text-2xl">Materiali</h2>
          {catalog.materials.map((material, index) => (
            <div key={`${material.id}-${index}`} className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2">
              <input
                aria-label="Ime materiala"
                value={material.name}
                onChange={(event) => patchMaterial(index, { name: event.target.value })}
                className="rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
              />
              <input
                aria-label="Opomba materiala"
                value={material.note}
                onChange={(event) => patchMaterial(index, { note: event.target.value })}
                className="rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
              />
              <button
                type="button"
                className="rounded-xl px-3 text-sm"
                onClick={() => onChange({ ...catalog, materials: catalog.materials.filter((_, item) => item !== index) })}
              >
                Odstrani
              </button>
            </div>
          ))}
          <button
            type="button"
            className="mt-2 text-sm"
            onClick={() => onChange({ ...catalog, materials: [...catalog.materials, { id: "", name: "", note: "" }] })}
          >
            + material
          </button>
        </div>
        <div>
          <h2 className="display text-2xl">Izdelki</h2>
          {catalog.products.map((product, index) => (
            <fieldset key={`${product.id}-${index}`} className="mt-2 rounded-2xl border border-[var(--color-rule)] p-3">
              <input
                aria-label="Ime izdelka"
                value={product.name}
                onChange={(event) => patchProduct(index, { name: event.target.value })}
                className="w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
              />
              <input
                aria-label="Vrsta izdelka"
                value={product.kind}
                onChange={(event) => patchProduct(index, { kind: event.target.value })}
                placeholder="vrsta, npr. jedilna miza"
                className="mt-2 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {catalog.materials.map((material) => (
                  <label key={material.name} className="flex items-center gap-1 text-xs">
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
                products: [...catalog.products, { id: "", name: "", kind: "", summary: "", materialIds: [] }],
              })
            }
          >
            + izdelek
          </button>
        </div>
      </div>
        ),
        "shrani-izdelki": shrani,
        splet: (
      <SpletPanel busy={busy} onBusy={onBusy} onError={onError} onCatalog={onChange} />
        ),
        vrzeli: (
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
        "kljuci-splet": (
          <div className="grid gap-5 rounded-3xl bg-[var(--color-sheet)] p-4">
            <h2 className="display text-2xl">{t("znPodKljuci")}</h2>
            <TinyFishKljuc onError={onError} />
            <BraveKljuc onError={onError} />
          </div>
        ),
        "nujni-spomin": (
          <div className="grid gap-5 rounded-3xl bg-[var(--color-sheet)] p-4">
            <h2 className="display text-2xl">{t("znPodSpomin")}</h2>
            <NujniKlici onError={onError} />
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

type PravilaLastnosti = {
  pravila: Pravila;
  busy: boolean;
  onChange: (pravila: Pravila) => void;
  onSave: () => void;
  onError: (message: string) => void;
};

/** Vsi razdelki pravil (podokna Nastavitev) shranijo ista pravila z istim gumbom. */
function ShraniPravilaGumb({ busy, onSave }: { busy: boolean; onSave: () => void }) {
  return (
    <button type="button" disabled={busy} onClick={onSave} className="mt-4 rounded-full bg-[var(--color-ink)] px-4 py-3 text-sm text-white">
      {t("shraniPravila")}
    </button>
  );
}

export function PravilaPrevzem({ pravila, busy, onChange, onSave }: PravilaLastnosti) {
  return (
    <section className="max-w-xl rounded-3xl bg-[var(--color-sheet)] p-5" aria-labelledby="nast-prevzem">
      <h2 id="nast-prevzem" className="display text-3xl">
        {t("nastPodPrevzem")}
      </h2>
      <h3 className="display mt-4 text-2xl">{t("prevzemNaslov")}</h3>
      <fieldset className="mt-4 grid gap-2 text-sm">
        {(
          [
            ["vsi", t("prevzemVsi")],
            ["neodgovorjeni", t("prevzemNeodgovorjeni")],
            ["izven", t("prevzemIzven")],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2">
            <input
              type="radio"
              name="prevzem"
              checked={pravila.prevzem === value}
              onChange={() => onChange({ ...pravila, prevzem: value })}
            />
            {label}
          </label>
        ))}
      </fieldset>
      {pravila.prevzem === "neodgovorjeni" || pravila.prevzem === "izven" ? (
        <label className="mt-4 block text-sm" htmlFor="preusmeritev">
          {t("preusmeritevNaslov")}
          <input
            id="preusmeritev"
            value={pravila.preusmeritev ?? ""}
            onChange={(event) => onChange({ ...pravila, preusmeritev: event.target.value })}
            className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
            autoComplete="tel"
          />
          <span className="mt-1 block text-xs text-[var(--color-moss)]">{t("preusmeritevNamig")}</span>
        </label>
      ) : null}
      {pravila.prevzem === "neodgovorjeni" ? (
        <label className="mt-4 block text-sm" htmlFor="cakanje">
          {t("cakanje")}
          <input
            id="cakanje"
            type="number"
            min={10}
            max={60}
            value={pravila.cakanjeSekund}
            onChange={(event) => onChange({ ...pravila, cakanjeSekund: Number(event.target.value) })}
            className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
          />
        </label>
      ) : null}
      <h3 className="display mt-6 text-2xl">{t("nacinKlicaNaslov")}</h3>
      <fieldset className="mt-2 text-sm">
        <legend className="sr-only">{t("nacinKlicaNaslov")}</legend>
        {(["podjetje", "osebna"] as const).map((nacin) => (
          <label key={nacin} className="mt-1 flex items-center gap-2">
            <input
              type="radio"
              name="nacinKlica"
              checked={(pravila.nacinKlica ?? "podjetje") === nacin}
              onChange={() => onChange({ ...pravila, nacinKlica: nacin })}
            />
            {nacin === "osebna" ? t("nacinOsebna") : t("nacinPodjetje")}
          </label>
        ))}
        <span className="mt-1 block text-xs text-[var(--color-moss)]">{t("nacinNamig")}</span>
      </fieldset>
      {pravila.nacinKlica !== "osebna" ? (
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(pravila.podrobniPotek)}
            onChange={(event) => onChange({ ...pravila, podrobniPotek: event.target.checked })}
          />
          {t("podrobniPotekNaslov")}
        </label>
      ) : null}
      {pravila.nacinKlica === "osebna" ? (
        <label className="mt-3 block text-sm" htmlFor="imeLastnika">
          {t("imeLastnikaNaslov")}
          <input
            id="imeLastnika"
            value={pravila.imeLastnika ?? ""}
            maxLength={60}
            onChange={(event) => onChange({ ...pravila, imeLastnika: event.target.value })}
            className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
          />
        </label>
      ) : null}
      <label className="mt-4 block text-sm" htmlFor="predpone">
        {t("dovoljenePredponeNaslov")}
        <input
          id="predpone"
          value={pravila.dovoljenePredpone ?? ""}
          onChange={(event) => onChange({ ...pravila, dovoljenePredpone: event.target.value })}
          className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
        />
        <span className="mt-1 block text-xs text-[var(--color-moss)]">{t("dovoljenePredponeNamig")}</span>
      </label>
      <ShraniPravilaGumb busy={busy} onSave={onSave} />
    </section>
  );
}

export function PravilaPozdrav({ pravila, busy, onChange, onSave }: PravilaLastnosti) {
  return (
    <section className="max-w-xl rounded-3xl bg-[var(--color-sheet)] p-5" aria-labelledby="nast-pozdrav">
      <h2 id="nast-pozdrav" className="display text-3xl">
        {t("nastPodPozdrav")}
      </h2>
      <h3 className="display mt-4 text-2xl">{t("pozdravNaslov")}</h3>
      <p className="mt-2 text-sm text-[var(--color-moss)]">{t("pozdravNamig")}</p>
      <p className="mt-3 text-xs tracking-[0.14em] text-[var(--color-brass)] uppercase">{t("obvezniNaslov")}</p>
      <p className="mt-1 rounded-xl bg-white px-3 py-2 text-sm">{t("obvezniPozdrav")}</p>
      <label className="mt-3 block text-sm" htmlFor="pozdrav">
        {t("pozdravDodatek")}
        <textarea
          id="pozdrav"
          value={pravila.pozdrav}
          rows={3}
          onChange={(event) => onChange({ ...pravila, pozdrav: event.target.value })}
          className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
        />
      </label>
      <label className="mt-4 block text-sm" htmlFor="najdaljsi">
        {t("najdaljsiNaslov")}
        <input
          id="najdaljsi"
          inputMode="numeric"
          value={pravila.najdaljsiPogovorMinut ?? ""}
          onChange={(event) => {
            const raw = event.target.value.trim();
            onChange({ ...pravila, najdaljsiPogovorMinut: raw === "" ? null : Number(raw) });
          }}
          className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
        />
        <span className="mt-1 block text-xs text-[var(--color-moss)]">{t("najdaljsiNamig")}</span>
      </label>
      <label className="mt-4 block text-sm" htmlFor="govorModel">
        {t("govorModelNaslov")}
        <select
          id="govorModel"
          value={pravila.govorModel ?? ""}
          onChange={(event) => onChange({ ...pravila, govorModel: event.target.value })}
          className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
        >
          <option value="">{t("govorModelPrivzeto")}</option>
          {GOVOR_MODELI.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-[var(--color-moss)]">{t("govorModelNamig")}</span>
      </label>
      {pravila.govorModel ? (
        <label className="mt-3 block text-sm" htmlFor="hintsGovor">
          {t("hintsGovorNaslov")}
          <textarea
            id="hintsGovor"
            value={pravila.hintsGovor ?? ""}
            rows={2}
            onChange={(event) => onChange({ ...pravila, hintsGovor: event.target.value })}
            className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
          />
        </label>
      ) : null}
      <label className="mt-3 flex items-center gap-2 text-sm" htmlFor="tople-povezave-vklop">
        <input
          id="tople-povezave-vklop"
          type="checkbox"
          checked={pravila.toplePovezave !== false}
          aria-describedby="tople-povezave-namig"
          onChange={(event) => onChange({ ...pravila, toplePovezave: event.target.checked })}
        />
        {t("toplePovezaveVklop")}
      </label>
      <p id="tople-povezave-namig" className="mt-1 text-xs text-[var(--color-moss)]">
        {t("toplePovezaveNamig")}
      </p>
      <ShraniPravilaGumb busy={busy} onSave={onSave} />
    </section>
  );
}

export function PravilaJavniNaslov({ pravila, busy, onChange, onSave, onError }: PravilaLastnosti) {
  return (
    <section className="max-w-xl rounded-3xl bg-[var(--color-sheet)] p-5" aria-labelledby="nast-javni-naslov">
      <h2 id="nast-javni-naslov" className="display text-3xl">
        {t("nastPodJavni")}
      </h2>
      <label className="mt-4 block text-sm" htmlFor="javni-naslov">
        {t("javniNaslovNaslov")}
        <input
          id="javni-naslov"
          value={pravila.javniNaslov ?? ""}
          onChange={(event) => onChange({ ...pravila, javniNaslov: event.target.value })}
          className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
          inputMode="url"
        />
        <span className="mt-1 block text-xs text-[var(--color-moss)]">{t("javniNaslovNamig")}</span>
      </label>
      <PotNaslova trenutni={pravila.javniNaslov ?? ""} onNaslov={(javniNaslov) => onChange({ ...pravila, javniNaslov })} onError={onError} />
      <ShraniPravilaGumb busy={busy} onSave={onSave} />
    </section>
  );
}

export function PravilaTwilio({ pravila, onError }: PravilaLastnosti) {
  return (
    <section className="max-w-xl rounded-3xl bg-[var(--color-sheet)] p-5" aria-labelledby="nast-twilio">
      <h2 id="nast-twilio" className="display text-3xl">
        {t("nastPodTwilio")}
      </h2>
      <p className="mt-2 text-sm text-[var(--color-moss)]">{t("statusUrl")}</p>
      <TwilioRacun
        naslovKlicev={/^https:\/\//i.test((pravila.javniNaslov ?? "").trim()) ? `${(pravila.javniNaslov ?? "").trim().replace(/\/+$/, "")}/api/voice/incoming` : ""}
        onError={onError}
      />
    </section>
  );
}

export function PravilaOdgovori({ pravila, busy, onChange, onSave }: PravilaLastnosti) {
  return (
    <section className="max-w-xl rounded-3xl bg-[var(--color-sheet)] p-5" aria-labelledby="nast-odgovori">
      <h2 id="nast-odgovori" className="display text-3xl">
        {t("nastPodOdgovori")}
      </h2>
      <h3 className="display mt-6 text-2xl">{t("temaOdgovorNaslov")}</h3>
      <p className="mt-2 text-sm text-[var(--color-moss)]">{t("temaOdgovorNamig")}</p>
      <label className="mt-3 block text-sm" htmlFor="tema-odgovor">
        {t("temaOdgovorNaslov")}
        <textarea
          id="tema-odgovor"
          value={pravila.temaOdgovor}
          rows={3}
          onChange={(event) => onChange({ ...pravila, temaOdgovor: event.target.value })}
          className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
        />
      </label>
      <h3 className="display mt-6 text-2xl">{t("garancijaNaslov")}</h3>
      <p className="mt-2 text-sm text-[var(--color-moss)]">{t("garancijaNamig")}</p>
      <label className="mt-3 flex items-center gap-2 text-sm" htmlFor="garancija-vklop">
        <input
          id="garancija-vklop"
          type="checkbox"
          checked={pravila.garancijaVklop}
          onChange={(event) => onChange({ ...pravila, garancijaVklop: event.target.checked })}
        />
        {t("garancijaVklop")}
      </label>
      <label className="mt-3 block text-sm" htmlFor="garancija-besedilo">
        {t("garancijaNaslov")}
        <textarea
          id="garancija-besedilo"
          value={pravila.garancijaBesedilo}
          rows={3}
          onChange={(event) => onChange({ ...pravila, garancijaBesedilo: event.target.value })}
          className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
        />
      </label>
      <h3 className="display mt-6 text-2xl">{t("dostavaNaslov")}</h3>
      <p className="mt-2 text-sm text-[var(--color-moss)]">{t("dostavaNamig")}</p>
      <label className="mt-3 flex items-center gap-2 text-sm" htmlFor="dostava-vklop">
        <input
          id="dostava-vklop"
          type="checkbox"
          checked={pravila.dostavaVklop}
          onChange={(event) => onChange({ ...pravila, dostavaVklop: event.target.checked })}
        />
        {t("dostavaVklop")}
      </label>
      <label className="mt-3 block text-sm" htmlFor="dostava-besedilo">
        {t("dostavaNaslov")}
        <textarea
          id="dostava-besedilo"
          value={pravila.dostavaBesedilo}
          rows={3}
          onChange={(event) => onChange({ ...pravila, dostavaBesedilo: event.target.value })}
          className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
        />
      </label>
      <ShraniPravilaGumb busy={busy} onSave={onSave} />
    </section>
  );
}

export function PravilaPotrditev({ pravila, busy, onChange, onSave }: PravilaLastnosti) {
  return (
    <section className="max-w-xl rounded-3xl bg-[var(--color-sheet)] p-5" aria-labelledby="nast-potrditev">
      <h2 id="nast-potrditev" className="display text-3xl">
        {t("potrditevNaslov")}
      </h2>
      <p className="mt-2 text-sm text-[var(--color-moss)]">{t("potrditevNamig")}</p>
      <label className="mt-3 block text-sm" htmlFor="potrditev-naslov">
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
            // Brez veljavnega naslova se moznost ne da vklopiti; prvi veljavni vpis jo vklopi (G4g), stikalo za izklop ostane.
            const prvi = jeVeljavenEnaslov(naslov) && !jeVeljavenEnaslov(pravila.potrditevNaslov);
            onChange({ ...pravila, potrditevNaslov: naslov, potrditevEposta: jeVeljavenEnaslov(naslov) && (pravila.potrditevEposta || prvi) });
          }}
          className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
        />
      </label>
      <label className="mt-3 flex items-center gap-2 text-sm" htmlFor="potrditev-vklop">
        <input
          id="potrditev-vklop"
          type="checkbox"
          checked={pravila.potrditevEposta}
          disabled={!jeVeljavenEnaslov(pravila.potrditevNaslov)}
          aria-describedby="potrditev-razlog"
          onChange={(event) => onChange({ ...pravila, potrditevEposta: event.target.checked })}
        />
        {t("potrditevVklop")}
      </label>
      {naslovJeTezakZaGovor(pravila.potrditevNaslov) ? (
        <p id="potrditev-kratek" role="status" className="mt-1 text-xs text-[var(--color-moss)]">
          {t("potrditevKratek")}
        </p>
      ) : null}
      {pravila.potrditevNaslov && !jeVeljavenEnaslov(pravila.potrditevNaslov) ? (
        <p id="potrditev-razlog" className="mt-1 text-xs text-[var(--color-signal)]">
          {t("potrditevNeveljaven")}
        </p>
      ) : null}
      <ShraniPravilaGumb busy={busy} onSave={onSave} />
    </section>
  );
}

export function PravilaSnemanje({ pravila, busy, onChange, onSave }: PravilaLastnosti) {
  return (
    <section className="max-w-xl rounded-3xl bg-[var(--color-sheet)] p-5" aria-labelledby="nast-snemanje">
      <h2 id="nast-snemanje" className="display text-3xl">
        {t("snemanjeNaslov")}
      </h2>
      <p id="snemanje-razlog" className="mt-2 text-sm text-[var(--color-moss)]">
        {t("snemanjeNiNaVoljo")}
      </p>
      <label className="mt-3 flex items-center gap-2 text-sm text-[var(--color-moss)]" htmlFor="snemanje-vklop">
        <input id="snemanje-vklop" type="checkbox" checked={false} disabled aria-describedby="snemanje-razlog" readOnly />
        {t("snemanjeVklop")}
      </label>
      <label className="mt-3 flex items-center gap-2 text-sm" htmlFor="snemanje-zavrnitev">
        <input
          id="snemanje-zavrnitev"
          type="checkbox"
          checked={pravila.snemanjeZavrnitev}
          onChange={(event) => onChange({ ...pravila, snemanjeZavrnitev: event.target.checked })}
        />
        {t("snemanjeZavrnitev")}
      </label>
      <label className="mt-3 block text-sm" htmlFor="snemanje-hramba">
        {t("snemanjeHramba")}
        <input
          id="snemanje-hramba"
          type="number"
          min={1}
          max={30}
          value={pravila.snemanjeHrambaDni}
          onChange={(event) => onChange({ ...pravila, snemanjeHrambaDni: Number(event.target.value) || 1 })}
          className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
        />
      </label>
      <ShraniPravilaGumb busy={busy} onSave={onSave} />
    </section>
  );
}

/** Cas za cloveka: »1,2 s« (slog besedil, razdelek 3). */
function sekunde(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

/** Casi Lininih odgovorov v klicu: povprecje in najdaljsi. Samo stevila, brez vsebine pogovora. */
function CasiKlica({ call }: { call: CallSession }) {
  const casi = call.transcript.filter((vrstica) => vrstica.role === "lina" && typeof vrstica.ms === "number").map((vrstica) => vrstica.glasMs ?? vrstica.ms ?? 0);
  if (casi.length === 0) return null;
  const povprecje = casi.reduce((vsota, ms) => vsota + ms, 0) / casi.length;
  return (
    <span className="mt-1 block text-xs text-[var(--color-moss)]">
      {t("casOdgovora")}: {t("casPovprecno")} {sekunde(povprecje)}, {t("casNajdaljsi")} {sekunde(Math.max(...casi))}
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
      void audio.play().catch(() => resolve());
    });
  }
}

/** Vaja klica: uporabnik igra klicatelja in gre z Lino cez cel potek. Tece po isti kodi kot pravi klic. */
function VajaKlica({
  busy,
  onError,
  onBusy,
}: {
  busy: boolean;
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
      const izid = await vajaKlicaFn({ data: { id: vhod.nova ? undefined : id || undefined, text: vhod.text, konec: vhod.konec } });
      const prej: VrsticaVaje[] = vhod.nova ? [] : pogovor;
      const klicatelj: VrsticaVaje[] = vhod.text ? [{ kdo: "klicatelj", besedilo: vhod.text }] : [];
      const lina: VrsticaVaje[] = izid.reply ? [{ kdo: "lina", besedilo: izid.reply, ms: izid.ms, zvok: izid.zvok }] : [];
      setPogovor([...prej, ...klicatelj, ...lina]);
      setId(izid.koncano ? "" : izid.id);
      setZapis(izid.zapis);
      setText("");
      if (izid.zvok.length > 0) void predvajajZvok(izid.zvok);
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
        <span className="rounded-full border border-[var(--color-rule)] px-2 py-0.5 align-middle text-xs">{t("vajaOznaka")}</span>
      </h3>
      <p className="mt-2 text-sm text-[var(--color-moss)]">{t("vajaNamig")}</p>
      {!id ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void korak({ nova: true })}
          className="mt-3 rounded-full bg-[var(--color-ink)] px-4 py-3 text-sm text-white disabled:opacity-50"
        >
          {t("vajaZacni")}
        </button>
      ) : null}
      {pogovor.length > 0 ? (
        <ol className="mt-4 grid gap-2 text-sm" aria-live="polite">
          {pogovor.map((vrstica, i) => (
            <li key={i} className={vrstica.kdo === "lina" ? "rounded-xl bg-white px-3 py-2" : "px-3 py-1 text-[var(--color-moss)]"}>
              <span className="text-xs text-[var(--color-brass)]">{vrstica.kdo === "lina" ? "Lina" : t("vajaKlicatelj")}: </span>
              {vrstica.besedilo}
              {vrstica.kdo === "lina" && typeof vrstica.ms === "number" ? (
                <span className="mt-1 block text-xs text-[var(--color-moss)]">
                  {t("vajaCas")}: {sekunde(vrstica.ms)}
                  {vrstica.zvok && vrstica.zvok.length > 0 ? (
                    <button type="button" className="ml-3 underline" onClick={() => void predvajajZvok(vrstica.zvok ?? [])}>
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
            void korak({ text });
          }}
        >
          <label className="block text-sm" htmlFor="vaja-polje">
            {t("vajaPolje")}
            <input
              id="vaja-polje"
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-white px-3 py-2"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className="rounded-full bg-[var(--color-ink)] px-4 py-3 text-sm text-white disabled:opacity-50">
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
            {(
              [
                [t("povzetekKdo"), zapis.ime],
                [t("podjetjeOznaka"), zapis.podjetje],
                [t("povprasevanjeOznaka"), zapis.povprasevanje],
                [t("rok"), zapis.rok],
                [t("prosiTelefonOznaka"), zapis.telefon],
                [t("prosiEpostoOznaka"), zapis.eposta],
                [t("dosegljivOznaka"), zapis.povratniKlic],
                [t("povzetekNarediti"), zapis.povzetek.narediti],
              ] as Array<[string, string]>
            ).map(([oznaka, vrednost]) => (
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
    <div className="rounded-3xl bg-[var(--color-sheet)] p-4">
      <h2 className="display text-2xl">{t("vrzeliNaslov")}</h2>
      <p className="mt-1 text-xs text-[var(--color-moss)]">Odprtih: {openGaps.length}</p>
      {openGaps.length === 0 ? <p className="mt-2 text-sm">{t("vrzeliPrazno")}</p> : null}
      <div className="mt-3 grid gap-3">
        {openGaps.map((gap) => (
          <VrzelVrstica key={gap.id} gap={gap} busy={busy} onError={onError} onBusy={onBusy} onDone={onDone} />
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
      const result = await dodajVrzelFn({ data: { id: gap.id, odgovor } });
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
      className="rounded-2xl bg-white p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void add();
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
        className="mt-2 rounded-full bg-[var(--color-signal)] px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {t("vrzeliGumb")}
      </button>
    </form>
  );
}
