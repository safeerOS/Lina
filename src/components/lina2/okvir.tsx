import { useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { LinaDesk } from "@/components/lina-desk.tsx";
import { izberiModelFn, logoutFn } from "@/lib/lina/functions.ts";
import { IME_PONUDNIKA } from "@/lib/lina/types.ts";
import { kliciZaPrikaz, steviloNovih } from "@/lib/lina/imenik.ts";
import type { RazdelekLine } from "@/lib/lina/ui-videz.ts";
import { Cvet, DomovPanel, Ikona, ImenikPanel } from "./domov.tsx";
import { KoledarPanel } from "./koledar.tsx";
import { ImeKartica } from "./ime-kartica.tsx";
import { MedijiPanel } from "./mediji.tsx";
import { NovicePanel } from "./novice.tsx";
import { AsistentPanel } from "./pogovor.tsx";
import { t2 } from "./besedila.ts";
import { jeStran, menijStrani, najdiStran, veljavnaStran, type Stran } from "./okvir-meni.ts";

/**
 * Lina 2.0: lupina programa (leva zlozljiva navigacija, zgornja vrstica, vsebina). Zasloni z lastnimi podatki
 * (Domov, Pogovor, Koledar, Imenik) so nove komponente; klici, znanje, narocila, dnevnik, zapiski, linija in nastavitve
 * so obstojeci LinaDesk v vdelanem nacinu (nic ni odstranjeno). Strani brez pravega vira podatkov se ne pokazejo.
 */
type Props = Parameters<typeof LinaDesk>[0];

const LASTNI: ReadonlyArray<Stran> = ["domov", "pogovor", "koledar", "imenik", "novice", "mediji"];
const KLJUC_MENIJA = "lina2-menu-zmanjsan";
const KLJUC_OGLED = "lina-klici-ogled";

export function Lina2Okvir(props: Props) {
  const router = useRouter();
  const nacin = props.pravila.nacinKlica;
  const meni = useMemo(() => menijStrani(nacin), [nacin]);
  const [stran, setStran] = useState<Stran>("domov");
  const aktivnaStran = veljavnaStran(stran, nacin);
  const [zmanjsan, setZmanjsan] = useState(false);
  const [iskanje, setIskanje] = useState("");
  const [ukaz, setUkaz] = useState<{ id: number; besedilo: string } | null>(null);
  const [glas, setGlas] = useState(0);
  const [zdaj, setZdaj] = useState<Date | null>(null);
  const [ogled, setOgled] = useState<string | null>(null);
  const vnosRef = useRef<HTMLInputElement>(null);
  // Izbirnik modela za pogovor (kot pri Claudu in ChatGPT): izbira velja za odgovore asistentke, ne za klice.
  const [pogovorModel, setPogovorModel] = useState(props.brain.pogovor ?? null);
  useEffect(() => {
    setPogovorModel(props.brain.pogovor ?? null);
  }, [props.brain.pogovor?.provider, props.brain.pogovor?.model]);
  const izbireModelov = (props.brain.shranjeni ?? []).flatMap((p) => p.modeli.map((m) => ({ provider: p.provider, model: m })));
  async function izberiModel(vrednost: string) {
    const [provider, ...ostalo] = vrednost.split("|");
    const model = ostalo.join("|");
    try {
      const izid = await izberiModelFn({ data: vrednost ? { provider, model } : { provider: "", model: "" } });
      setPogovorModel(izid.pogovor ?? null);
      await router.invalidate();
    } catch {
      setPogovorModel(props.brain.pogovor ?? null);
    }
  }

  // Shramba brskalnika je samo udobje (zmanjsan meni); brez nje ostane privzeto.
  useEffect(() => {
    try {
      setZmanjsan(localStorage.getItem(KLJUC_MENIJA) === "1");
    } catch {
      /* privzeto razsirjen */
    }
  }, []);
  function preklopiMeni() {
    setZmanjsan((v) => {
      try {
        localStorage.setItem(KLJUC_MENIJA, v ? "0" : "1");
      } catch {
        /* velja do zaprtja */
      }
      return !v;
    });
  }

  // Ura in datum: osvezitev na pol minute (ne vsako sekundo), ustavi se, ko je zavihek skrit.
  useEffect(() => {
    setZdaj(new Date());
    const c = setInterval(() => {
      if (!document.hidden) setZdaj(new Date());
    }, 30_000);
    return () => clearInterval(c);
  }, []);

  useEffect(() => {
    setStran((s) => veljavnaStran(s, nacin));
  }, [nacin]);

  useEffect(() => {
    try {
      setOgled(localStorage.getItem(KLJUC_OGLED));
    } catch {
      setOgled(null);
    }
  }, [aktivnaStran]);

  const novihKlicev = useMemo(() => steviloNovih(kliciZaPrikaz(props.calls, [], 50), ogled), [props.calls, ogled]);

  function pojdi(cilj: Stran) {
    setStran(veljavnaStran(cilj, nacin));
    window.scrollTo({ top: 0 });
  }

  /** Zaslon je prevzel ukaz ali glasovno zahtevo: pozabi ju, da se ob vrnitvi na zaslon ne ponovita. */
  function prevzeto() {
    setUkaz(null);
    setGlas(0);
  }

  function posljiUkaz() {
    const q = iskanje.trim();
    if (!q) return;
    // Ime strani (npr. »koledar«) odpre stran; vse drugo je ukaz Lini.
    const zadetek = najdiStran(q, nacin);
    if (zadetek) pojdi(zadetek);
    else {
      // Na Domovu odgovori okno za odgovore (brez menjave zaslona); drugje se odpre Pogovor.
      setUkaz({ id: Date.now(), besedilo: q });
      if (aktivnaStran !== "domov") pojdi("pogovor");
    }
    setIskanje("");
  }

  const ura = zdaj?.toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit" }) ?? "";
  const datum = zdaj?.toLocaleDateString("sl-SI", { weekday: "short", day: "numeric", month: "short" }) ?? "";
  const odprta = props.line.open;
  const mozgani = props.brain.nastavljen || props.llm;

  return (
    <div className="lina2">
      <div className="lina2-okvir" data-zmanjsan={zmanjsan ? "1" : "0"}>
        <aside className="lina2-stranska">
          <div className="lina2-logo">
            <span className="lina2-logo-znak" aria-hidden="true">
              <Cvet />
            </span>
            <span className="lina2-logo-besedilo">
              <span className="lina2-logo-ime">Lina</span>
              <span className="lina2-logo-podnaslov">{t2("logoPodnaslov")}</span>
            </span>
          </div>
          <nav aria-label={t2("navAria")}>
            <ul className="lina2-nav">
              {meni.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className="lina2-nav-gumb"
                    aria-current={aktivnaStran === n.id ? "page" : undefined}
                    title={zmanjsan ? n.oznaka : undefined}
                    onClick={() => pojdi(n.id)}
                  >
                    <Ikona ime={n.ikona} />
                    <span className="lina2-nav-besedilo">{n.oznaka}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="lina2-stranska-dno">
            <div className="lina2-online" role="status">
              <span className={`lina2-pika ${odprta ? "lina2-pika-ok" : "lina2-pika-slaba"}`} aria-hidden="true" />
              <span className="lina2-online-besedilo">
                <strong>{odprta ? t2("online") : t2("offline")}</strong>
                <span>{odprta ? t2("onlineOpis") : t2("offlineOpis")}</span>
              </span>
            </div>
            <button type="button" className="lina2-nav-gumb" aria-expanded={!zmanjsan} onClick={preklopiMeni}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={zmanjsan ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} />
              </svg>
              <span className="lina2-nav-besedilo">{zmanjsan ? t2("navRazsiri") : t2("navZmanjsaj")}</span>
            </button>
          </div>
        </aside>

        <div className="lina2-glavni">
          <header className="lina2-vrh" aria-label={t2("vrhAria")}>
            <div className="lina2-vrh-desno">
              <button type="button" className="lina2-ikona-gumb lina2-zvonec" aria-label={`${t2("obvestilaAria")}: ${novihKlicev > 0 ? `${novihKlicev} ${t2("obvestilaKlici")}` : t2("obvestilaNic")}`} title={novihKlicev > 0 ? `${novihKlicev} ${t2("obvestilaKlici")}` : t2("obvestilaNic")} onClick={() => pojdi("domov")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" />
                </svg>
                {novihKlicev > 0 ? <span className="lina2-znacka-st">{novihKlicev}</span> : null}
              </button>
              <p className="lina2-stanje" role="status">
                <span className={`lina2-pika ${odprta ? "lina2-pika-ok" : "lina2-pika-slaba"}`} aria-hidden="true" />
                <span>{odprta ? t2("linijaOdprta") : t2("linijaZaprta")}</span>
                <span className="lina2-loci" aria-hidden="true">·</span>
                <span>{mozgani ? `${t2("mozganiDa")}: ${props.brain.provider ?? "OK"}` : t2("mozganiNe")}</span>
              </p>
              <p className="lina2-ura" suppressHydrationWarning>
                <strong>{ura}</strong>
                <span>{datum}</span>
              </p>
            </div>
          </header>

          <div className="lina2-vsebina">
            {aktivnaStran === "domov" && nacin === "osebna" && !(props.pravila.imeLastnika ?? "").trim() ? (
              <ImeKartica onShranjeno={() => router.invalidate()} />
            ) : null}
            {aktivnaStran === "domov" ? (
              <DomovPanel
                calls={props.calls}
                podjetje={props.line.catalog.company.name}
                linijaOdprta={odprta}
                onOdpri={(z) => (jeStran(z, nacin) ? pojdi(z) : undefined)}
                brain={props.brain}
                ukaz={ukaz}
                glas={glas}
                onPrevzeto={prevzeto}
                strani={meni.map((m) => m.id)}
              />
            ) : null}
            {aktivnaStran === "pogovor" ? <AsistentPanel brain={props.brain} ukaz={ukaz} glas={glas} onPrevzeto={prevzeto} /> : null}
            {aktivnaStran === "koledar" ? <KoledarPanel /> : null}
            {aktivnaStran === "imenik" ? <ImenikPanel calls={props.calls} /> : null}
            {aktivnaStran === "novice" ? <NovicePanel /> : null}
            {aktivnaStran === "mediji" ? <MedijiPanel /> : null}
            {LASTNI.includes(aktivnaStran) ? null : <LinaDesk {...props} zacetniZavihek={aktivnaStran as RazdelekLine} vdelan />}
          </div>

          <form
            className="lina2-iskanje lina2-ukazna"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              posljiUkaz();
            }}
          >
            <svg className="lina2-ukazna-lupa" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" />
            </svg>
            <input
              ref={vnosRef}
              value={iskanje}
              onChange={(e) => setIskanje(e.target.value)}
              placeholder={t2("iskanjeNamig")}
              aria-label={t2("iskanjeAria")}
              maxLength={500}
            />
            {izbireModelov.length > 1 ? (
              <select
                className="lina2-model"
                aria-label={t2("modelAria")}
                title={t2("modelAria")}
                value={pogovorModel ? `${pogovorModel.provider}|${pogovorModel.model}` : ""}
                onChange={(e) => void izberiModel(e.target.value)}
              >
                <option value="">{t2("modelPrivzeto")}</option>
                {(props.brain.shranjeni ?? []).map((p) => (
                  <optgroup key={p.provider} label={IME_PONUDNIKA[p.provider]}>
                    {p.modeli.map((m) => (
                      <option key={m} value={`${p.provider}|${m}`}>
                        {m}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            ) : null}
            {iskanje.trim() ? (
              <button type="submit" className="lina2-poslji" aria-label={t2("iskanjePosli")} title={t2("iskanjePosli")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 12h15M13 6l6 6-6 6" />
                </svg>
              </button>
            ) : null}
            <button
              type="button"
              className="lina2-ikona-gumb"
              aria-label={t2("mikAria")}
              title={t2("mikAria")}
              onClick={() => {
                setGlas(Date.now());
                if (aktivnaStran !== "domov") pojdi("pogovor");
              }}
            >
              <Ikona ime="mik" />
            </button>
            <button type="button" className="lina2-ikona-gumb" aria-label={t2("tipkanjeAria")} title={t2("tipkanjeAria")} onClick={() => vnosRef.current?.focus()}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 7h18v11H3zM7 11h.01M11 11h.01M15 11h.01M19 11h.01M7 15h10" />
              </svg>
            </button>
            {props.brezGesla ? null : (
              <button
                type="button"
                className="lina2-ikona-gumb"
                aria-label={t2("navOdjava")}
                title={t2("navOdjava")}
                onClick={async () => {
                  await logoutFn();
                  await router.invalidate();
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3v8M6.3 6.8a8 8 0 1 0 11.4 0" />
                </svg>
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
