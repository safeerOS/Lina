import { useCallback, useEffect, useState, type ReactNode } from "react";
import { sporociloStreznika, t } from "@/lib/lina/besedila.ts";
import { imenikIzbrisiFn, imenikSeznamFn, imenikShraniFn } from "@/lib/lina/functions.ts";
import { kliciZaPrikaz, normalizirajTelefon, steviloNovih, type StikImenik } from "@/lib/lina/imenik.ts";
import { lokalniCas, uraBesedilo } from "@/lib/lina/koledar.ts";
import { datumDanes, vLjubljani } from "@/lib/lina/ui-videz.ts";
import { delPozdrava, type DelPozdrava } from "@/lib/lina/motivacija.ts";
import type { BrainPublic, CallSession } from "@/lib/lina/types.ts";
import { AsistentPanel, DanesKartica } from "@/components/lina2/pogovor.tsx";
import { MotivacijaBesedilo } from "./mediji.tsx";
import {
  KLJUC_IZBIRE, NAJVEC_PLOSCIC, STRAN_PLOSCICE, izbirnePloscice, jeOknoVidno, preklopiOkno, preklopiPloscico, privzetaIzbira,
  razberiIzbiro, serializirajIzbiro, vidnePloscice, zadnjiKliciDomov, type IdOkna, type IdPloscice, type IzbiraDomov,
} from "./domov-izbira.ts";

const OGLED = "lina-klici-ogled";

export const IKONE: Record<string, ReactNode> = {
  domov: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  pogovor: <path d="M4 5h16v11H9l-5 4z" />,
  koledar: <path d="M5 5h14v15H5zM5 10h14M9 3v4M15 3v4" />,
  imenik: <path d="M6 3h12v18H6zM9 9a3 3 0 1 0 6 0 3 3 0 0 0-6 0M9 17c0-2 6-2 6 0" />,
  novice: <path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM18 8h2v10a2 2 0 0 1-2 2M8 8h7M8 12h7M8 16h4" />,
  klic: <path d="M5 4l4 1 1 4-2 1.5a11 11 0 0 0 5.5 5.5L15 14l4 1 1 4c-8 3-17-6-15-15z" />,
  znanje: <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11" />,
  narocila: <path d="M8 4h8l3 3v13H5V4zM9 11h6M9 15h6" />,
  dnevnik: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />,
  zapiski: <path d="M6 3h9l3 3v15H6zM9 10h6M9 14h6" />,
  telefon: <path d="M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2" />,
  linija: <path d="M4 12h3l2-6 4 12 2-6h5" />,
  nastavitve: <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 12l2-.6.6-1.6-1-1.8 1.8-1.8 1.8 1 1.6-.6L12 4l.2 2.6 1.6.6 1.8-1 1.8 1.8-1 1.8.6 1.6L20 12l-2.6.2-.6 1.6 1 1.8-1.8 1.8-1.8-1-1.6.6L12 20l-.2-2.6-1.6-.6-1.8 1-1.8-1.8 1-1.8-.6-1.6z" />,
  mediji: <path d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01" />,
  racunalnik: <path d="M3 5h18v11H3zM8 20h8M12 16v4" />,
  kontrola: <path d="M4 4h11v11H4zM7 8h5M7 11h3M14 14l6 6M3 20h6" />,
  mik: <path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4" />,
};

export function Ikona({ ime }: { ime: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {IKONE[ime] ?? IKONE.domov}
    </svg>
  );
}

/** Znak Line (cvet): logotip v levi vrstici. */
export function Cvet() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="lina-cvet" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d9ccff" />
        </linearGradient>
      </defs>
      <g fill="url(#lina-cvet)" stroke="#ffffff" strokeWidth="1.2" transform="translate(24 25)">
        {[0, 72, 144, 216, 288].map((r) => (
          <ellipse key={r} cx="0" cy="-11" rx="6.5" ry="11" transform={`rotate(${r})`} />
        ))}
      </g>
      <circle cx="24" cy="25" r="4" fill="#ffd36e" />
    </svg>
  );
}

type BarvnaIme = "pogovor" | "koledar" | "opravilo" | "sporocila" | "klic" | "nastavitve" | "imenik" | "zapiski" | "dnevnik" | "telefon" | "linija" | "znanje";
/** Ikone z lastno barvno risbo; ostale (imenik, zapiski, ...) so barvni obrisi osnovnih ikon menija. */
const ZNACILNE: BarvnaIme[] = ["pogovor", "koledar", "opravilo", "sporocila", "klic", "nastavitve"];
const BARVE_IKON: Record<BarvnaIme, [string, string]> = {
  pogovor: ["#58b0ff", "#2f62ff"],
  koledar: ["#ff8fc8", "#c45bd8"],
  opravilo: ["#4be39a", "#14b86a"],
  sporocila: ["#5bb6ff", "#3a6bff"],
  klic: ["#3fe0b0", "#10a58a"],
  nastavitve: ["#8b9ad6", "#5a67ad"],
  imenik: ["#ffb347", "#ff7a3d"],
  zapiski: ["#ffd34d", "#f0a31a"],
  dnevnik: ["#7fe0ff", "#2aa6d6"],
  telefon: ["#9a8cff", "#5b4de0"],
  linija: ["#ff7a9a", "#d6285a"],
  znanje: ["#7ee08a", "#2f9e5a"],
};

/** Barvne ikone ploscic (skica lastnika 21. 11. 2026); so okras, pomen nosi besedilo ploscice. */
function BarvnaIkona({ ime }: { ime: BarvnaIme }) {
  const g = `lina-bi-${ime}`;
  const [a, b] = BARVE_IKON[ime];
  const polnilo = `url(#${g})`;
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
      </defs>
      {ime === "pogovor" ? (
        <>
          <path d="M9 8h30a5 5 0 0 1 5 5v16a5 5 0 0 1-5 5H23l-10 8v-8H9a5 5 0 0 1-5-5V13a5 5 0 0 1 5-5z" fill={polnilo} />
          <g fill="#ffffff">
            <circle cx="16" cy="21" r="2.6" />
            <circle cx="24" cy="21" r="2.6" />
            <circle cx="32" cy="21" r="2.6" />
          </g>
        </>
      ) : null}
      {ime === "koledar" ? (
        <>
          <rect x="6" y="9" width="36" height="33" rx="7" fill="#ffffff" stroke={a} strokeWidth="2" />
          <path d="M6 16a7 7 0 0 1 7-7h22a7 7 0 0 1 7 7v3H6z" fill={polnilo} />
          <path d="M16 5v8M32 5v8" stroke={b} strokeWidth="3" strokeLinecap="round" />
          <g fill={a}>
            <rect x="12" y="25" width="6" height="5" rx="1.5" />
            <rect x="21" y="25" width="6" height="5" rx="1.5" />
            <rect x="30" y="25" width="6" height="5" rx="1.5" />
            <rect x="12" y="33" width="6" height="5" rx="1.5" />
            <rect x="21" y="33" width="6" height="5" rx="1.5" />
          </g>
        </>
      ) : null}
      {ime === "opravilo" ? (
        <>
          <circle cx="24" cy="24" r="19" fill={polnilo} />
          <path d="M15 25l6 6 12-13" fill="none" stroke="#ffffff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : null}
      {ime === "sporocila" ? (
        <>
          <rect x="5" y="9" width="38" height="30" rx="6" fill={polnilo} />
          <path d="M7 14l17 13 17-13" fill="none" stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : null}
      {ime === "klic" ? (
        <g transform="translate(2 2) scale(1.9)">
          <path d="M5 4l4 1 1 4-2 1.5a11 11 0 0 0 5.5 5.5L15 14l4 1 1 4c-8 3-17-6-15-15z" fill={polnilo} />
        </g>
      ) : null}
      {ime === "nastavitve" ? (
        <g transform="scale(2)">
          <path
            fillRule="evenodd"
            fill={polnilo}
            d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 12l2-.6.6-1.6-1-1.8 1.8-1.8 1.8 1 1.6-.6L12 4l.2 2.6 1.6.6 1.8-1 1.8 1.8-1 1.8.6 1.6L20 12l-2.6.2-.6 1.6 1 1.8-1.8 1.8-1.8-1-1.6.6L12 20l-.2-2.6-1.6-.6-1.8 1-1.8-1.8 1-1.8-.6-1.6z"
          />
        </g>
      ) : null}
      {!ZNACILNE.includes(ime) ? (
        <g transform="translate(6 6) scale(1.5)" fill="none" stroke={polnilo} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          {IKONE[ime]}
        </g>
      ) : null}
    </svg>
  );
}

/** Pozdrav po ljubljanski uri; isti vir ure kot misel dneva (motivacija.ts delPozdrava, URA_VECERA). */
const POZDRAV: Record<DelPozdrava, "d2LahkoNoc" | "d2DoberJutro" | "d2DoberDan" | "d2DoberVecer"> = {
  noc: "d2LahkoNoc", jutro: "d2DoberJutro", dan: "d2DoberDan", vecer: "d2DoberVecer",
};
function pozdrav(zdaj: Date): string {
  return t(POZDRAV[delPozdrava(zdaj)]);
}

function kdajBesedilo(iso: string, zdaj: Date): string {
  const t0 = new Date(iso);
  if (Number.isNaN(t0.getTime())) return "";
  // trenutek klica in »zdaj« v ljubljanskem stenskem casu, ne v pasu sistema
  const d = vLjubljani(t0);
  const cas = uraBesedilo(lokalniCas(d));
  const isti = d.toDateString() === vLjubljani(zdaj).toDateString();
  return isti ? `${t("d2Danes")}, ${cas}` : `${datumDanes(d)}, ${cas}`;
}

function oblikujTelefon(tel: string): string {
  return tel.replace(/^(\+386)(\d{2})(\d{3})(\d{3})$/, "$1 $2 $3 $4");
}

function stKlicevBesedilo(n: number): string {
  const m100 = n % 100;
  const m10 = n % 10;
  const kljuc = n === 1 ? "d2Klic1" : m100 === 2 ? "d2Klic2" : m100 === 3 || m100 === 4 ? "d2Klic34" : m10 === 1 && m100 !== 11 ? "d2Klic1" : "d2KlicN";
  return `${n} ${t(kljuc)}`;
}

function useImenik() {
  const [imenik, setImenik] = useState<StikImenik[]>([]);
  const osvezi = useCallback(() => {
    void imenikSeznamFn().then(setImenik).catch(() => setImenik([]));
  }, []);
  useEffect(osvezi, [osvezi]);
  return { imenik, setImenik, osvezi };
}

type Odpri = (zavihek: string) => void;

/** Opis ploscic hitrih dejanj (ikona, besedilo); katere se prikazejo, izbere uporabnik (domov-izbira.ts, nacelo priljubljenih). */
type BesediloPloscice = "d2PlVprasanje" | "d2PlKoledar" | "d2PlOpravilo" | "d2PlSporocila" | "d2PlKlici" | "d2PlNastavitve"
  | "d2PlImenik" | "d2PlZapiski" | "d2PlDnevnik" | "d2PlTelefon" | "d2PlLinija" | "d2PlZnanje";
const OPIS_PLOSCIC: Record<IdPloscice, { ikona: BarvnaIme; besedilo: BesediloPloscice }> = {
  vprasanje: { ikona: "pogovor", besedilo: "d2PlVprasanje" },
  koledar: { ikona: "koledar", besedilo: "d2PlKoledar" },
  opravilo: { ikona: "opravilo", besedilo: "d2PlOpravilo" },
  sporocila: { ikona: "sporocila", besedilo: "d2PlSporocila" },
  klici: { ikona: "klic", besedilo: "d2PlKlici" },
  nastavitve: { ikona: "nastavitve", besedilo: "d2PlNastavitve" },
  imenik: { ikona: "imenik", besedilo: "d2PlImenik" },
  zapiski: { ikona: "zapiski", besedilo: "d2PlZapiski" },
  dnevnik: { ikona: "dnevnik", besedilo: "d2PlDnevnik" },
  telefon: { ikona: "telefon", besedilo: "d2PlTelefon" },
  linija: { ikona: "linija", besedilo: "d2PlLinija" },
  znanje: { ikona: "znanje", besedilo: "d2PlZnanje" },
};
const OPIS_OKEN: Record<IdOkna, "d2OknoDanes" | "d2Hitre" | "d2OknoMajhni"> = { danes: "d2OknoDanes", hitre: "d2Hitre", majhni: "d2OknoMajhni" };

/** Izbira oken na Domovu: privzeto kot po skici, shranjena izbira (lokalna shramba) se prebere po nalozitvi strani. */
function useIzbiraDomov() {
  const [izbira, nastavi] = useState<IzbiraDomov>(privzetaIzbira);
  useEffect(() => {
    try {
      nastavi(razberiIzbiro(localStorage.getItem(KLJUC_IZBIRE)));
    } catch {
      /* shramba ni na voljo */
    }
  }, []);
  const shrani = useCallback((n: IzbiraDomov) => {
    nastavi(n);
    try {
      localStorage.setItem(KLJUC_IZBIRE, serializirajIzbiro(n));
    } catch {
      /* shramba ni na voljo */
    }
  }, []);
  return [izbira, shrani] as const;
}

/** Zacetna stran: pozdrav, klici, ki jih je prevzela Lina (s povzetkom), dnevni pregled in imenik. */
export function DomovPanel({ calls, podjetje, linijaOdprta, onOdpri, brain, ukaz, glas, onPrevzeto, strani }: {
  calls: CallSession[];
  podjetje: string;
  linijaOdprta: boolean;
  onOdpri: Odpri;
  brain: BrainPublic;
  ukaz?: { id: number; besedilo: string } | null;
  glas?: number;
  onPrevzeto?: () => void;
  /** Id-ji strani, ki so v meniju tega nacina (npr. brez Znanja v osebnem nacinu); ploscice brez strani se ne ponudijo. */
  strani?: string[];
}) {
  const { imenik, setImenik } = useImenik();
  const [izbira, shraniIzbiro] = useIzbiraDomov();
  const [urejanje, setUrejanje] = useState(false);
  const [zdaj, setZdaj] = useState<Date | null>(null);
  const [ogled, setOgled] = useState<string | null>(null);
  const [shranjujem, setShranjujem] = useState<string | null>(null);
  const [ime, setIme] = useState("");
  const [napaka, setNapaka] = useState("");

  useEffect(() => {
    setZdaj(new Date());
    try {
      setOgled(localStorage.getItem(OGLED));
    } catch {
      /* shramba ni na voljo */
    }
    // Ob odhodu z domace strani so klici "ogledani".
    return () => {
      try {
        localStorage.setItem(OGLED, new Date().toISOString());
      } catch {
        /* shramba ni na voljo */
      }
    };
  }, []);

  const klici = kliciZaPrikaz(calls, imenik, 6);
  const novih = steviloNovih(klici, ogled);
  const zadnji = zadnjiKliciDomov(klici);

  async function shrani(telefon: string) {
    setNapaka("");
    const r = await imenikShraniFn({ data: { ime, telefon } });
    if (r.ok) {
      setImenik(r.stiki);
      setShranjujem(null);
      setIme("");
    } else setNapaka(sporociloStreznika(r.sporocilo));
  }

  return (
    <section className="mt-5 flex flex-col gap-5">
      <div className="lina-scena">
        <img className="lina-scena-lik" src="/lina/lina-domov.webp" alt="" width={802} height={1100} loading="eager" decoding="async" />
        <div className="lina-scena-sredina">
          <div className="lina-scena-glava">
          <div className="lina-hero-oblacek">
            {podjetje ? <p className="lina-hero-podjetje">{podjetje}</p> : null}
            <h2>{zdaj ? pozdrav(zdaj) : t("d2Pozdravljeni")}!</h2>
            <p>{t("d2HeroVprasanje")}</p>
          </div>
          <button type="button" className="lina-priljubljeno" aria-expanded={urejanje} onClick={() => setUrejanje((v) => !v)}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7z" fill="#ffc531" /></svg>
            <span className="lina-priljubljeno-besedilo">{urejanje ? t("d2Koncano") : t("d2Priljubljeno")}</span>
          </button>
          </div>
          {urejanje ? (
            <section className="lina-domov-izbira" aria-label={t("d2PrilagodiNaslov")}>
              <h3>{t("d2PrilagodiNaslov")}</h3>
              <p className="lina-domov-izbira-podnaslov">{t("d2PrilagodiPloscice")}</p>
              <ul className="lina-cipi">
                {izbirnePloscice(strani).map((id) => {
                  const vkljucena = izbira.ploscice.includes(id);
                  const poln = !vkljucena && izbira.ploscice.length >= NAJVEC_PLOSCIC;
                  return (
                    <li key={id}>
                      <button type="button" className="lina-cip" aria-pressed={vkljucena} disabled={poln} title={poln ? t("d2PrilagodiMeja") : t(OPIS_PLOSCIC[id].besedilo)}
                        onClick={() => shraniIzbiro(preklopiPloscico(izbira, id))}>
                        <BarvnaIkona ime={OPIS_PLOSCIC[id].ikona} />
                        <span>{t(OPIS_PLOSCIC[id].besedilo)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {izbira.ploscice.length >= NAJVEC_PLOSCIC ? <p className="lina-domov-izbira-opomba">{t("d2PrilagodiMeja")}</p> : null}
              <p className="lina-domov-izbira-podnaslov">{t("d2PrilagodiOkna")}</p>
              <ul className="lina-cipi lina-cipi-okna">
                {(["danes", "hitre", "majhni"] as IdOkna[]).map((id) => (
                  <li key={id}>
                    <button type="button" className="lina-cip lina-cip-okno" aria-pressed={jeOknoVidno(izbira, id)}
                      onClick={() => shraniIzbiro(preklopiOkno(izbira, id))}>
                      <span>{t(OPIS_OKEN[id])}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="lina-domov-izbira-gumbi">
                <button type="button" className="lina-gumb-majhen" onClick={() => shraniIzbiro(privzetaIzbira())}>{t("d2Ponastavi")}</button>
              </div>
            </section>
          ) : (
          <ul className="lina-plosce" aria-label={t("d2PlosciceSkupina")}>
            {vidnePloscice(izbira, strani).map((id) => (
              <li key={id}>
                <button type="button" className="lina-plosca" onClick={() => onOdpri(STRAN_PLOSCICE[id])}>
                  <BarvnaIkona ime={OPIS_PLOSCIC[id].ikona} />
                  <span>{t(OPIS_PLOSCIC[id].besedilo)}</span>
                </button>
              </li>
            ))}
          </ul>
          )}
        </div>
        <AsistentPanel kompakt brain={brain} ukaz={ukaz} glas={glas} onPrevzeto={onPrevzeto} onOdpriPogovor={() => onOdpri("pogovor")} />
        <div className="lina-scena-desno">
          {/* Vedno prva in vedno vidna (ni v izbiri oken): sprejeti klici brez drsenja pri 1366x768 in 1920x1080. */}
          <section className="lina-karta lina-zadnji-klici" aria-labelledby="lina-zadnji-klici-naslov">
            <h3 className="lina-karta-naslov" id="lina-zadnji-klici-naslov">
              <span className="lina-naslov-z-ikono"><Ikona ime="klic" /> {t("d2ZadnjiKlici")}</span>
              <button type="button" className="lina-karta-vec" onClick={() => onOdpri("klic")}>{t("d2VsiKlici")}</button>
            </h3>
            {zadnji.length === 0 ? (
              <p className="lina-karta-prazno">{t("d2KliciPrazno")}</p>
            ) : (
              <ul className="lina-zadnji-seznam">
                {zadnji.map((k) => (
                  <li key={k.sid}>
                    <button type="button" className="lina-zadnji-klic" onClick={() => onOdpri("klic")}>
                      <span className="lina-zadnji-vrh">
                        <span className="lina-zadnji-ime">{k.ime || oblikujTelefon(k.telefon) || t("d2NeznanKlicatelj")}</span>
                        <span className="lina-zadnji-cas">{zdaj ? kdajBesedilo(k.kdaj, zdaj) : ""}{k.zakljucen ? "" : ` · ${t("d2VTeku")}`}</span>
                      </span>
                      {k.ime && k.telefon ? <span className="lina-zadnji-tel">{oblikujTelefon(k.telefon)}</span> : null}
                      <span className="lina-zadnji-kaj">{k.kaj || t("d2BrezPovzetka")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {jeOknoVidno(izbira, "danes") ? <DanesKartica onVec={() => onOdpri("koledar")} /> : null}
          {jeOknoVidno(izbira, "hitre") ? (
          <section className="lina-karta" aria-label={t("d2Hitre")}>
            <h3 className="lina-karta-naslov">
              <span className="lina-naslov-z-ikono">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M12 2a7 7 0 0 0-4 12.7V18h8v-3.3A7 7 0 0 0 12 2z" fill="#ffd34d" />
                  <path d="M9 21h6" stroke="#c9a227" strokeWidth="2" strokeLinecap="round" />
                </svg>
                {t("d2Hitre")}
              </span>
            </h3>
            <div className="lina-hitro">
              <p className="lina-hitro-stevilo">{novih}</p>
              <div>
                <p className="lina-hitro-opis">{t("d2HitreKlici")}</p>
                <p className="lina-hitro-vrstica">
                  <span className={`lina2-pika ${linijaOdprta ? "lina2-pika-ok" : "lina2-pika-slaba"}`} aria-hidden="true" />
                  {t("d2HitreLinija")}: {linijaOdprta ? t("d2HitreOdprta") : t("d2HitreZaprta")}
                </p>
              </div>
            </div>
          </section>
          ) : null}
          {/* Izklopljena misel dneva: kartice ni (MotivacijaBesedilo vrne null). */}
          {jeOknoVidno(izbira, "majhni") ? <MotivacijaBesedilo rezerva={t("d2MajhniKoraki")} /> : null}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="lina-kartica">
          <h3>
            <Ikona ime="klic" /> {t("d2KliciNaslov")}
            {novih > 0 ? <span className="lina-znacka">{novih} {t("d2NovihKlicev")}</span> : null}
            <button type="button" className="lina-gumb-majhen ml-auto" onClick={() => onOdpri("klic")}>{t("d2Odpri")}</button>
          </h3>
          {klici.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--color-moss)]">{t("d2KliciPrazno")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--color-rule)]">
              {klici.map((k) => (
                <li key={k.sid} className="py-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-semibold">{k.ime || oblikujTelefon(k.telefon) || t("d2NeznanKlicatelj")}</span>
                    {k.ime && k.telefon ? <span className="text-[0.8125rem] tabular-nums text-[var(--color-moss)]">{oblikujTelefon(k.telefon)}</span> : null}
                    <span className="ml-auto text-[0.8125rem] text-[var(--color-brass)]">{zdaj ? kdajBesedilo(k.kdaj, zdaj) : ""}{k.zakljucen ? "" : ` · ${t("d2VTeku")}`}</span>
                  </div>
                  <button type="button" className="mt-1 block w-full text-left text-sm text-[var(--color-moss)] hover:text-[var(--color-ink)]" onClick={() => onOdpri("klic")}>{k.kaj || t("d2BrezPovzetka")}</button>
                  {k.telefon ? (
                    <div className="mt-2">
                      {k.shranjen ? (
                        <span className="text-[0.8125rem] text-[var(--color-moss)]">{t("d2VImeniku")}</span>
                      ) : shranjujem === k.sid ? (
                        <form
                          className="flex flex-wrap items-center gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void shrani(k.telefon);
                          }}
                        >
                          <label className="sr-only" htmlFor={`ime-${k.sid}`}>{t("d2ImeStika")}</label>
                          <input id={`ime-${k.sid}`} autoFocus value={ime} onChange={(e) => setIme(e.target.value)} placeholder={t("d2ImeStika")} maxLength={80} className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--aurora-1)]" />
                          <button type="submit" className="lina-gumb-majhen">{t("d2Shrani")}</button>
                          <button type="button" className="lina-gumb-majhen" onClick={() => { setShranjujem(null); setNapaka(""); }}>{t("d2Preklici")}</button>
                          {napaka ? <span role="alert" className="text-[0.8125rem] text-[var(--color-signal)]">{napaka}</span> : null}
                        </form>
                      ) : (
                        <button type="button" className="lina-gumb-majhen" onClick={() => { setShranjujem(k.sid); setIme(k.ime); setNapaka(""); }}>
                          {t("d2ShraniVImenik")}
                        </button>
                      )}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <div className="lina-kartica">
            <h3>
              <Ikona ime="imenik" /> {t("d2Imenik")}
              <button type="button" className="lina-gumb-majhen ml-auto" onClick={() => onOdpri("imenik")}>{t("d2Odpri")}</button>
            </h3>
            {imenik.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--color-moss)]">{t("d2ImenikPrazenKlic")}</p>
            ) : (
              <ul className="mt-2 divide-y divide-[var(--color-rule)]">
                {imenik.slice(0, 5).map((s) => (
                  <li key={s.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 truncate">{s.ime}</span>
                    <span className="shrink-0 text-[0.8125rem] tabular-nums text-[var(--color-moss)]">{oblikujTelefon(s.telefon)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Zavihek Imenik: shranjeni klicatelji; iskanje, dodajanje, brisanje. Stevilo klicev iz zgodovine. */
export function ImenikPanel({ calls }: { calls: CallSession[] }) {
  const { imenik, setImenik } = useImenik();
  const [iskanje, setIskanje] = useState("");
  const [ime, setIme] = useState("");
  const [telefon, setTelefon] = useState("");
  const [opomba, setOpomba] = useState("");
  const [napaka, setNapaka] = useState("");

  const q = iskanje.trim().toLowerCase();
  const qStev = normalizirajTelefon(iskanje);
  const prikaz = imenik.filter((s) => !q || s.ime.toLowerCase().includes(q) || s.opomba.toLowerCase().includes(q) || (qStev.length > 3 && s.telefon.includes(qStev)));
  const stKlicev = (tel: string) => calls.filter((c) => !c.vaja && normalizirajTelefon(c.stik?.telefon || c.order.phone || c.from || "") === tel).length;

  async function dodaj() {
    setNapaka("");
    const r = await imenikShraniFn({ data: { ime, telefon, opomba } });
    if (r.ok) {
      setImenik(r.stiki);
      setIme("");
      setTelefon("");
      setOpomba("");
    } else setNapaka(sporociloStreznika(r.sporocilo));
  }

  const polje = "rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--aurora-1)]";
  return (
    <section className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <form
        className="lina-kartica flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void dodaj();
        }}
      >
        <h3><Ikona ime="imenik" /> {t("d2NovStik")}</h3>
        <label className="grid gap-1 text-sm">{t("d2Ime")}<input value={ime} onChange={(e) => setIme(e.target.value)} maxLength={80} className={polje} /></label>
        <label className="grid gap-1 text-sm">{t("d2Telefon")}<input value={telefon} onChange={(e) => setTelefon(e.target.value)} inputMode="tel" placeholder="041 123 456" className={polje} /></label>
        <label className="grid gap-1 text-sm">{t("d2Opomba")}<input value={opomba} onChange={(e) => setOpomba(e.target.value)} maxLength={300} className={polje} /></label>
        {napaka ? <p role="alert" className="text-sm text-[var(--color-signal)]">{napaka}</p> : null}
        <button type="submit" className="self-start rounded-full bg-[var(--color-signal)] px-5 py-2 text-sm text-[var(--color-on-ink)]">{t("d2ShraniStik")}</button>
      </form>

      <div className="lina-kartica">
        <h3><Ikona ime="imenik" /> {t("d2Stiki")} <span className="lina-znacka">{imenik.length}</span></h3>
        <label className="sr-only" htmlFor="imenik-iskanje">{t("d2IskanjeImenik")}</label>
        <input id="imenik-iskanje" value={iskanje} onChange={(e) => setIskanje(e.target.value)} placeholder={t("d2IskanjeNamig")} className={`${polje} mt-3 w-full`} />
        {prikaz.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--color-moss)]">{imenik.length === 0 ? t("d2ImenikPrazen") : t("d2NiZadetkov")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--color-rule)]">
            {prikaz.map((s) => {
              const n = stKlicev(s.telefon);
              return (
                <li key={s.id} className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{s.ime}</p>
                    <p className="text-[0.8125rem] tabular-nums text-[var(--color-moss)]">{oblikujTelefon(s.telefon)}{n > 0 ? ` · ${stKlicevBesedilo(n)}` : ""}</p>
                    {s.opomba ? <p className="mt-1 text-sm text-[var(--color-moss)]">{s.opomba}</p> : null}
                  </div>
                  <button
                    type="button"
                    className="lina-gumb-majhen"
                    aria-label={`${t("d2IzbrisiStik")} ${s.ime}`}
                    onClick={async () => {
                      const r = await imenikIzbrisiFn({ data: { id: s.id } });
                      if (r.ok) setImenik(r.stiki);
                    }}
                  >
                    {t("d2Izbrisi")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
