import { useCallback, useEffect, useRef, useState } from "react";
import { t, type Beseda } from "@/lib/lina/besedila.ts";
import {
  nastaviPregledProjektaFn,
  nastaviSpominNalogFn,
  stanjeAgentPomociFn,
  stanjeClaudeNalogFn,
  stanjeGradenjFn,
  ukazClaudeNalogFn,
  ukazGradenjFn,
} from "@/lib/lina/functions.ts";
import { t2 } from "./besedila.ts";
import type { JavnaNaloga, JavnoStanjeNalog, StanjeAgenta } from "@/lib/lina/claude-naloge.server.ts";
import type { AgentId, RazlogNaloge, StanjeNaloge } from "@/lib/lina/claude-naloge.ts";
import type { JavnaGradnja, JavnoStanjeGradenj } from "@/lib/lina/gradnje-github.server.ts";
import type { RazlogGradnje, StanjeGradnje, Tok } from "@/lib/lina/gradnje-github.ts";
import { Ikona } from "./domov.tsx";
import { StanjeNapaka } from "./ui-lina.tsx";

/**
 * Zavihek Racunalnik (lastnik 23. 11. 2026): naloge za Claude Code. Lastnik vidi mapo in CELO besedilo naloge, preden jo potrdi;
 * porocilo agenta je samo besedilo (<pre>), nikoli HTML ali navodilo.
 */
const STANJE: Record<StanjeNaloge, Beseda> = {
  caka: "rcCaka",
  zaganja: "rcZaganja",
  tece: "rcTece",
  koncano: "rcKoncano",
  odklonjeno: "rcOdklonjeno",
  poteklo: "rcPoteklo",
  napaka: "rcNapaka",
  dodeljeno: "agDodeljeno",
  zamujeno: "agZamujeno",
  preklicano: "agPreklicano",
};

function opisRazloga(r: RazlogNaloge): string {
  switch (r) {
    case "mapa-prepovedana":
      return t("agRPrepovedana");
    case "mapa-povezava":
      return t("agRPovezava");
    case "mapa-zasedena":
      return t("agRMapaZasedena");
    case "besedilo-nevidni":
      return t("rcRNevidni");
    case "agent":
    case "agent-ni-pripravljen":
      return t("agRNiPripravljen");
    case "agent-izklopljen":
      return t("agRIzklopljen");
    case "agent-brez-poziva":
      return t("agKimiBrezPoziva");
    case "pogoj":
      return t("agRPogoj");
    case "mapa":
    case "mapa-zunaj":
    case "mapa-skrita":
    case "mapa-podatki":
    case "mapa-ni":
      return t("rcRMapa");
    case "besedilo":
      return t("rcRBesedilo");
    case "polno-cakajoce":
    case "polno-hkratne":
      return t("rcRPolno");
    case "zgostitev":
      return t("rcRZgostitev");
    case "poteklo":
      return t("rcRPoteklo");
    case "geslo":
      return t("rcBrezGesla");
    case "ni-na-voljo":
      return t("rcNiNaVoljo");
    case "ni-terminala":
      return t("rcNiTerminala");
    case "ni-claude":
      return t("rcNiClaude");
    case "opozorilo":
      return t("rcROpozorilo");
    default:
      return `${t("rcRSplosno")} (${r})`;
  }
}

const POLJE = "rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--aurora-1)]";

export function RacunalnikPanel() {
  const [stanje, setStanje] = useState<JavnoStanjeNalog | null>(null);
  const [mapa, setMapa] = useState("");
  const [besedilo, setBesedilo] = useState("");
  const [mape, setMape] = useState("");
  const [napaka, setNapaka] = useState("");
  const [zaposlen, setZaposlen] = useState(false);

  const osvezi = useCallback(() => {
    void stanjeClaudeNalogFn()
      .then((s) => {
        setStanje(s);
        setMape(s.mape.join("\n"));
      })
      .catch(() => setNapaka(t("rcRSplosno")));
  }, []);
  useEffect(osvezi, [osvezi]);
  // vrsta se med tekom in cakanjem na pogoj osvezuje sama (stanje, opomnik, zagon ob uri)
  const dejavna = !!stanje?.naloge.some((n) => ["dodeljeno", "zaganja", "tece"].includes(n.stanje));
  useEffect(() => {
    if (!dejavna) return;
    const c = setInterval(osvezi, 30_000);
    return () => clearInterval(c);
  }, [dejavna, osvezi]);

  async function ukaz(u: Record<string, unknown>): Promise<boolean> {
    setNapaka("");
    setZaposlen(true);
    try {
      const r = await ukazClaudeNalogFn({ data: { ukaz: u } });
      if (!r.ok) {
        setNapaka(opisRazloga(r.razlog));
        osvezi();
        return false;
      }
      setStanje(r.stanje);
      return true;
    } catch {
      setNapaka(t("rcRSplosno"));
      return false;
    } finally {
      setZaposlen(false);
    }
  }

  const niNaVoljo = stanje && !stanje.naVoljo && stanje.razlogNiNaVoljo ? opisRazloga(stanje.razlogNiNaVoljo) : "";

  return (
    <section className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="flex min-w-0 flex-col gap-5">
        <form
          className="lina-kartica flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void ukaz({ ukaz: "pripravi", mapa, besedilo }).then((ok) => {
              if (ok) setBesedilo("");
            });
          }}
        >
          <h3><Ikona ime="racunalnik" /> {t("rcNaslov")}</h3>
          <p className="text-sm text-[var(--color-moss)]">{t("rcNamig")}</p>
          {stanje && !stanje.geslo ? <p className="text-sm text-[var(--color-signal)]">{t("rcBrezGesla")}</p> : null}
          {niNaVoljo ? <p className="text-sm text-[var(--color-signal)]">{niNaVoljo}</p> : null}
          <label className="grid gap-1 text-sm">
            {t("rcMapa")}
            <input value={mapa} onChange={(e) => setMapa(e.target.value)} maxLength={512} spellCheck={false} autoComplete="off" className={POLJE} />
          </label>
          <label className="grid gap-1 text-sm">
            {t("rcBesedilo")}
            <textarea value={besedilo} onChange={(e) => setBesedilo(e.target.value)} maxLength={8000} rows={6} className={POLJE} />
          </label>
          {napaka ? <p role="alert" className="text-sm text-[var(--color-signal)]">{napaka}</p> : null}
          <button type="submit" disabled={zaposlen || !mapa.trim() || !besedilo.trim()} className="self-start rounded-full bg-[var(--color-signal)] px-5 py-2 text-sm text-[var(--color-on-ink)] disabled:opacity-50">
            {t("rcPripravi")}
          </button>
        </form>
        <form
          className="lina-kartica flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void ukaz({ ukaz: "mape", mape: mape.split("\n").map((m) => m.trim()).filter(Boolean) });
          }}
        >
          <label className="grid gap-1 text-sm">
            {t("rcMape")}
            <textarea value={mape} onChange={(e) => setMape(e.target.value)} rows={3} spellCheck={false} className={POLJE} />
          </label>
          <button type="submit" disabled={zaposlen} className="lina-gumb-majhen self-start">{t("rcShraniMape")}</button>
        </form>
        {stanje ? <AgentiKartica stanje={stanje} zaposlen={zaposlen} onUkaz={ukaz} /> : null}
        <AgentPomocStikala />
        <GradnjeKartica />
      </div>

      <div className="lina-kartica min-w-0">
        <h3><Ikona ime="racunalnik" /> {t("rcNaslov")}</h3>
        {!stanje || stanje.naloge.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--color-moss)]">{t("rcPrazno")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--color-rule)]">
            {stanje.naloge.map((n) => (
              <NalogaVrstica key={n.id} n={n} zaposlen={zaposlen} onUkaz={ukaz} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Ura v ljubljanskem casu (lastnik je v Sloveniji; tudi ce brskalnik ali streznik tece v drugem pasu). */
const URA = new Intl.DateTimeFormat("sl-SI", { timeZone: "Europe/Ljubljana", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
function ura(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? URA.format(d) : "";
}

export function NalogaVrstica({ n, zaposlen, onUkaz }: { n: JavnaNaloga; zaposlen: boolean; onUkaz: (u: Record<string, unknown>) => Promise<boolean> }) {
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold">{t(STANJE[n.stanje])}</span>
        <span className="text-sm">{n.agent}</span>
        <span className="text-xs text-[var(--color-moss)]">{n.izvor === "lina" ? t("rcIzvorLina") : n.izvor === "telefon" ? t("agIzvorTelefon") : t("rcIzvorLastnik")}</span>
        <span className="ml-auto text-xs tabular-nums text-[var(--color-brass)]">{ura(n.ustvarjeno)}</span>
      </div>
      <p className="mt-1 break-all font-mono text-xs">{n.mapa}</p>
      {n.pogoj && n.pogoj.vrsta !== "zdaj" ? (
        <p className="mt-1 text-xs">
          {t("agKdaj")}: {n.pogoj.vrsta === "ura" ? ura(n.pogoj.cas) : `${t("agKdajPo")} ${n.pogoj.id}`}
        </p>
      ) : null}
      {n.ocena && (n.stanje === "tece" || n.stanje === "zaganja") ? (
        <p className="mt-1 text-xs">
          {t("agOcena")}: {ura(n.ocena.konec)}
          {n.ocena.groba ? ` (${t("agGroba")})` : ""}
        </p>
      ) : null}
      {n.opomnik && n.opomnik.krog > 0 && (n.stanje === "tece" || n.stanje === "zaganja") ? (
        <p className="mt-1 text-xs text-[var(--color-signal)]">
          {t("agOpomnik")}: {ura(n.opomnik.cas)} · {n.opomnik.razlog === "terminal-zaprt" ? t("agROpTerminal") : n.opomnik.razlog === "brez-porocila" ? t("agROpBrez") : t("agROpTece")}
        </p>
      ) : null}
      {n.razlog && n.stanje === "napaka" ? <p className="mt-1 text-xs text-[var(--color-signal)]">{opisRazloga(n.razlog)}</p> : null}
      {n.stanje === "dodeljeno" || n.stanje === "zamujeno" ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {n.stanje === "zamujeno" ? (
            <button type="button" className="lina-gumb-majhen" disabled={zaposlen} onClick={() => void onUkaz({ ukaz: "potrdi", id: n.id, zgostitev: n.zgostitev })}>
              {t("agZamujenoPotrdi")}
            </button>
          ) : null}
          <button type="button" className="lina-gumb-majhen" disabled={zaposlen} onClick={() => void onUkaz({ ukaz: "preklici", id: n.id })}>
            {t("agPreklici")}
          </button>
        </div>
      ) : null}
      {n.izvor === "lina" && n.stanje === "caka" ? <p className="mt-1 text-xs text-[var(--color-signal)]">{t("rcLinaPodatek")}</p> : null}
      {/* Celo besedilo brez drsnika (drugi pregled 0.2.10, S2): lastnik pred potrditvijo vidi vse, tudi konec dolgega predloga. */}
      <pre className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-[var(--color-surface)] p-2 text-sm">{n.besedilo}</pre>
      {n.stanje === "caka" ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="lina-gumb-majhen" disabled={zaposlen} onClick={() => void onUkaz({ ukaz: "potrdi", id: n.id, zgostitev: n.zgostitev })}>
            {n.agent === "claude" ? t("rcPotrdi") : `${t("agPotrdiAgent")} ${n.agent}`}
          </button>
          <button type="button" className="lina-gumb-majhen" disabled={zaposlen} onClick={() => void onUkaz({ ukaz: "odkloni", id: n.id })}>
            {t("rcOdkloni")}
          </button>
        </div>
      ) : null}
      {n.stanje === "tece" || n.stanje === "zaganja" || n.stanje === "koncano" ? (
        <details className="mt-2" open={n.porocilo !== null}>
          <summary className="cursor-pointer text-sm">{t("rcPorocilo")}</summary>
          {n.porocilo !== null ? (
            <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap text-sm">{n.porocilo}</pre>
          ) : (
            <p className="mt-1 text-sm text-[var(--color-moss)]">{t("rcBrezPorocila")}</p>
          )}
        </details>
      ) : null}
    </li>
  );
}

// ------------------------------------------------------------------ Agenti na racunalniku (lastnik 24. 11. 2026)

function opisStanjaAgenta(a: StanjeAgenta): string {
  if (a.stanje === "ni-najden") return t("agNiNajden");
  if (a.stanje === "izklopljen") return t("agIzklopljen");
  if (a.stanje === "ne-deluje") return t("agNeDeluje");
  if (a.stanje === "prijava") return `${t("agPrijava")} (${a.id} login)`;
  return a.razlicica ? `${t("agPripravljen")} · ${a.razlicica}` : t("agPripravljen");
}

/**
 * Zaznani agenti s stikali, prepovedane mape (Gemini/Google agenti) in »Dodeli nalogo« (agent, mapa, besedilo, kdaj). V izbiri so samo
 * vklopljeni, preverjeni agenti z zacetnim pozivom (»ne ponujamo, kar ne deluje«). Kanal in samodejni odgovor ima samo Claude Code.
 */
export function AgentiKartica({ stanje, zaposlen, onUkaz }: { stanje: JavnoStanjeNalog; zaposlen: boolean; onUkaz: (u: Record<string, unknown>) => Promise<boolean> }) {
  const izbira = stanje.agenti.filter((a) => a.vklopljen && a.stanje === "pripravljen" && a.zacetniPoziv);
  const [agent, setAgent] = useState<AgentId | "">(izbira[0]?.id ?? "");
  const [mapa, setMapa] = useState("");
  const [besedilo, setBesedilo] = useState("");
  const [kdaj, setKdaj] = useState<"zdaj" | "ura" | "po">("zdaj");
  const [cas, setCas] = useState("");
  const [po, setPo] = useState("");
  const [prepovedane, setPrepovedane] = useState(stanje.prepovedane.join("\n"));
  const prednice = stanje.naloge.filter((n) => ["dodeljeno", "zaganja", "tece"].includes(n.stanje));
  const izbran = izbira.some((a) => a.id === agent) ? agent : izbira[0]?.id ?? "";
  const pogoj = kdaj === "zdaj" ? "zdaj" : kdaj === "ura" ? (cas && Number.isFinite(new Date(cas).getTime()) ? `ura:${new Date(cas).toISOString()}` : "") : po ? `po:${po}` : "";

  return (
    <div className="lina-kartica flex flex-col gap-3">
      <h3><Ikona ime="racunalnik" /> {t("agNaslov")}</h3>
      <p className="text-sm text-[var(--color-moss)]">{t("agNamig")}</p>
      <p className="text-sm">{t("agSamoClaudeKanal")}</p>
      <ul className="grid gap-2">
        {stanje.agenti.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {a.stanje === "ni-najden" ? (
              <span className="font-semibold text-[var(--color-moss)]">{a.ime}</span>
            ) : (
              <label className="flex items-center gap-2 font-semibold">
                <input type="checkbox" aria-label={a.ime} checked={a.vklopljen} disabled={zaposlen} onChange={(e) => void onUkaz({ ukaz: "agenti", agenti: { [a.id]: e.target.checked } })} />
                {a.ime}
              </label>
            )}
            <span className={a.stanje === "pripravljen" ? "text-xs" : "text-xs text-[var(--color-signal)]"}>{opisStanjaAgenta(a)}</span>
            {a.kanal ? <span className="text-xs text-[var(--color-brass)]">{t("agKanalDa")}</span> : null}
            {a.omejeneMape ? <span className="text-xs text-[var(--color-moss)]">{t("agOmejene")}</span> : null}
            {!a.zacetniPoziv && a.stanje !== "ni-najden" ? <span className="text-xs text-[var(--color-moss)]">{t("agKimiBrezPoziva")}</span> : null}
          </li>
        ))}
      </ul>
      <button type="button" className="lina-gumb-majhen self-start" disabled={zaposlen} onClick={() => void onUkaz({ ukaz: "preveri-agente" })}>
        {t("agPreveri")}
      </button>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void onUkaz({ ukaz: "dodeli", agent: izbran, mapa, besedilo, pogoj }).then((ok) => {
            if (ok) setBesedilo("");
          });
        }}
      >
        <h4 className="font-semibold">{t("agDodeli")}</h4>
        <label className="grid gap-1 text-sm">
          {t("agAgent")}
          <select value={izbran} onChange={(e) => setAgent(e.target.value as AgentId)} className={POLJE}>
            {izbira.map((a) => (
              <option key={a.id} value={a.id}>
                {a.ime}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          {t("agMapa")}
          <input value={mapa} onChange={(e) => setMapa(e.target.value)} maxLength={512} spellCheck={false} autoComplete="off" className={POLJE} />
        </label>
        <label className="grid gap-1 text-sm">
          {t("agBesedilo")}
          <textarea value={besedilo} onChange={(e) => setBesedilo(e.target.value)} maxLength={8000} rows={4} className={POLJE} />
        </label>
        <fieldset className="grid gap-1 text-sm">
          <legend>{t("agKdaj")}</legend>
          <div className="flex flex-wrap gap-3">
            {(["zdaj", "ura", "po"] as const).map((k) => (
              <label key={k} className="flex items-center gap-1">
                <input type="radio" name="ag-kdaj" value={k} checked={kdaj === k} onChange={() => setKdaj(k)} />
                {t(k === "zdaj" ? "agKdajZdaj" : k === "ura" ? "agKdajUra" : "agKdajPo")}
              </label>
            ))}
          </div>
          {kdaj === "ura" ? <input type="datetime-local" aria-label={t("agKdajUra")} value={cas} onChange={(e) => setCas(e.target.value)} className={POLJE} /> : null}
          {kdaj === "po" ? (
            <select aria-label={t("agKdajPo")} value={po} onChange={(e) => setPo(e.target.value)} className={POLJE}>
              <option value="">—</option>
              {prednice.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.agent} · {n.besedilo.slice(0, 40)}
                </option>
              ))}
            </select>
          ) : null}
        </fieldset>
        <button type="submit" disabled={zaposlen || !izbran || !mapa.trim() || !besedilo.trim() || !pogoj || !stanje.geslo} className="self-start rounded-full bg-[var(--color-signal)] px-5 py-2 text-sm text-[var(--color-on-ink)] disabled:opacity-50">
          {t("agDodeli")}
        </button>
      </form>

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void onUkaz({ ukaz: "prepovedane", mape: prepovedane.split("\n").map((m) => m.trim()).filter(Boolean) });
        }}
      >
        <label className="grid gap-1 text-sm">
          {t("agPrepovedane")}
          <textarea value={prepovedane} onChange={(e) => setPrepovedane(e.target.value)} rows={3} spellCheck={false} className={POLJE} />
        </label>
        <button type="submit" disabled={zaposlen} className="lina-gumb-majhen self-start">{t("agShraniPrepovedane")}</button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ Gradnje na GitHubu (lastnik 24. 11. 2026)

const STANJE_GRADNJE: Record<StanjeGradnje, Beseda> = {
  caka: "ghSCaka",
  odklonjeno: "ghSOdklonjeno",
  poteklo: "ghSPoteklo",
  zaganja: "ghSZaganja",
  tece: "ghSTece",
  prenasa: "ghSPrenasa",
  koncano: "ghSKoncano",
  neuspesno: "ghSNeuspesno",
  napaka: "ghSNapaka",
};

function opisRazlogaGradnje(r: RazlogGradnje): string {
  switch (r) {
    case "veja":
      return t("ghRVeja");
    case "tok-zaseden":
      return t("ghRZaseden");
    case "zgostitev":
      return t("ghRZgostitev");
    case "poteklo":
      return t("ghRPoteklo");
    case "geslo":
      return t("rcBrezGesla");
    case "izklopljeno":
      return t("ghIzklopljeno");
    case "ni-gh":
      return t("ghNiGh");
    case "ni-teka":
      return t("ghRNiTeka");
    case "artefakt":
      return t("ghRArtefakt");
    case "ni-paketa":
      return t("ghRNiPaketa");
    case "prenos":
      return t("ghRPrenos");
    case "rok":
      return t("ghRRok");
    case "zagon":
      return t("ghRZagon");
    case "polno-cakajoce":
      return t("ghRPolno");
    case "veje":
      return t("ghRVeje");
    case "commit":
      return t("ghRCommit");
    case "veja-namestitev":
      return t("ghRVejaNamestitev");
    case "prevelik":
      return t("ghRPrevelik");
    default:
      return `${t("ghRSplosno")} (${r})`;
  }
}

const AKTIVNA_GRADNJA: readonly StanjeGradnje[] = ["zaganja", "tece", "prenasa"];

/** Branje stanja gradenj brez DOM (pregled 0225 B7): napaka da razlog, nikoli tihe praznine. */
export async function preberiStanjeGradenj<T>(beri: () => Promise<T>): Promise<{ stanje: T | null; napaka: string }> {
  try {
    return { stanje: await beri(), napaka: "" };
  } catch {
    return { stanje: null, napaka: t("ghStanjeNapaka") };
  }
}

/** Stanja gradenj ni bilo mogoce prebrati: kartica z razlogom in »Poskusi znova« namesto praznega mesta. */
export function GradnjeNapaka({ razlog, onPonovi }: { razlog: string; onPonovi: () => void }) {
  return <StanjeNapaka naslov={t("ghNaslov")} razlog={razlog} onPonovi={onPonovi} />;
}

/** Kartica »Gradnje na GitHubu«: tok, veja (izbira s seznama GitHuba), Zgradi, stanje, ocena konca, polna pot, Odpri mapo, Namesti. */
export function GradnjeKartica() {
  const [stanje, setStanje] = useState<JavnoStanjeGradenj | null>(null);
  const [tok, setTok] = useState<Tok>("gradnja.yml");
  const [veja, setVeja] = useState("");
  const [napaka, setNapaka] = useState("");
  const [sporocilo, setSporocilo] = useState("");
  const [zaposlen, setZaposlen] = useState(false);

  const osvezi = useCallback(() => {
    void preberiStanjeGradenj(() => stanjeGradenjFn()).then((r) => {
      if (!r.stanje) return setNapaka(r.napaka);
      setStanje(r.stanje);
      // uspesna ponovitev pobrise samo napako branja; napaka ukaza (ukaz() spodaj osvezi po neuspehu) ostane vidna
      setNapaka((n) => (n === t("ghStanjeNapaka") ? "" : n));
    });
  }, []);
  useEffect(osvezi, [osvezi]);
  // seznam vej se ob prvem odprtju nalozi sam (sicer bi bila izbira prazna do »Osvezi veje«)
  const brezVej = !!stanje && stanje.veje.length === 0 && stanje.vklopljeno && stanje.geslo && stanje.gh;
  useEffect(() => {
    if (!brezVej) return;
    void ukazGradenjFn({ data: { ukaz: { ukaz: "veje" } } })
      .then((r) => {
        if (r.ok) setStanje(r.stanje);
      })
      .catch(() => undefined);
  }, [brezVej]);
  const aktivna = !!stanje?.gradnje.some((g) => AKTIVNA_GRADNJA.includes(g.stanje));
  useEffect(() => {
    if (!aktivna) return;
    const c = setInterval(osvezi, 30_000);
    return () => clearInterval(c);
  }, [aktivna, osvezi]);

  async function ukaz(u: Record<string, unknown>): Promise<boolean> {
    setNapaka("");
    setSporocilo("");
    setZaposlen(true);
    try {
      const r = await ukazGradenjFn({ data: { ukaz: u } });
      if (!r.ok) {
        setNapaka(opisRazlogaGradnje(r.razlog));
        osvezi();
        return false;
      }
      setStanje(r.stanje);
      const n = r.stanje.namestitev;
      if (n) setSporocilo(n.ok ? t("ghNamestitevZacela") : n.razlog === "ni_novejsa" ? t("ghNiNovejsa") : `${t("ghNamestitevNe")} (${n.razlog})`);
      return true;
    } catch {
      setNapaka(t("ghRSplosno"));
      return false;
    } finally {
      setZaposlen(false);
    }
  }

  if (!stanje) return napaka ? <GradnjeNapaka razlog={napaka} onPonovi={osvezi} /> : null;
  const veje = stanje.veje;
  return (
    <div className="lina-kartica flex flex-col gap-3">
      <h3><Ikona ime="racunalnik" /> {t("ghNaslov")}</h3>
      <p className="text-sm text-[var(--color-moss)]">{t("ghNamig")}</p>
      {!stanje.vklopljeno ? <p className="text-sm text-[var(--color-signal)]">{t("ghIzklopljeno")}</p> : null}
      {!stanje.geslo ? <p className="text-sm text-[var(--color-signal)]">{t("rcBrezGesla")}</p> : null}
      {!stanje.gh ? <p className="text-sm text-[var(--color-signal)]">{t("ghNiGh")}</p> : null}
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void ukaz({ ukaz: "pripravi", tok, veja });
        }}
      >
        <label className="grid gap-1 text-sm">
          {t("ghTok")}
          <select value={tok} onChange={(e) => setTok(e.target.value as Tok)} className={POLJE}>
            {stanje.tokovi.map((x) => (
              <option key={x.tok} value={x.tok}>
                {x.vrsta === "apk" ? t("ghTokApk") : t("ghTokDeb")}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          {t("ghVeja")}
          <select value={veja} onChange={(e) => setVeja(e.target.value)} className={POLJE}>
            <option value="">—</option>
            {veje.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={zaposlen || !veja || !stanje.vklopljeno} className="rounded-full bg-[var(--color-signal)] px-5 py-2 text-sm text-[var(--color-on-ink)] disabled:opacity-50">
            {t("ghPripravi")}
          </button>
          <button type="button" disabled={zaposlen || !stanje.vklopljeno} className="lina-gumb-majhen" onClick={() => void ukaz({ ukaz: "veje" })}>
            {t("ghOsveziVeje")}
          </button>
        </div>
      </form>
      {napaka ? <p role="alert" className="text-sm text-[var(--color-signal)]">{napaka}</p> : null}
      {sporocilo ? <p role="status" className="text-sm text-[var(--color-brass)]">{sporocilo}</p> : null}
      {stanje.gradnje.length === 0 ? (
        <p className="text-sm text-[var(--color-moss)]">{t("ghPrazno")}</p>
      ) : (
        <ul className="divide-y divide-[var(--color-rule)]">
          {stanje.gradnje.map((g) => (
            <GradnjaVrstica key={g.id} g={g} zaposlen={zaposlen} onUkaz={ukaz} onSporocilo={setSporocilo} />
          ))}
        </ul>
      )}
    </div>
  );
}

function GradnjaVrstica({ g, zaposlen, onUkaz, onSporocilo }: { g: JavnaGradnja; zaposlen: boolean; onUkaz: (u: Record<string, unknown>) => Promise<boolean>; onSporocilo: (s: string) => void }) {
  const apk = g.tok === "gradnja.yml";
  // pregled 0225 A-3: deb se namesti kot skrbnik; pred namestitvijo lastnik vidi vejo, commit in sha256 in potrdi se enkrat
  const [potrjujem, setPotrjujem] = useState(false);
  const debNiDovoljen = !apk && g.stanje === "koncano" && g.paket !== null && g.commit !== null && !g.lahkoNamesti;
  return (
    <li className="py-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold">{t(STANJE_GRADNJE[g.stanje])}</span>
        <span>{apk ? t("ghTokApk") : t("ghTokDeb")} · {g.veja}</span>
        <span className="text-xs text-[var(--color-moss)]">{g.izvor === "lina" ? t("ghIzvorLina") : g.izvor === "telefon" ? t("ghIzvorTelefon") : t("ghIzvorLastnik")}</span>
        <span className="ml-auto text-xs tabular-nums text-[var(--color-brass)]">{new Date(g.konec ?? g.ustvarjeno).toLocaleString()}</span>
      </div>
      {g.razlog ? <p className="mt-1 text-[var(--color-signal)]">{opisRazlogaGradnje(g.razlog)}</p> : null}
      {g.ocenaKonca ? <p className="mt-1 text-xs">{t("ghOcena")}: {new Date(g.ocenaKonca).toLocaleTimeString()}</p> : null}
      {g.mapa ? (
        <p className="mt-1 break-all font-mono text-xs">
          {t("ghMapa")}: {g.paket ? `${g.mapa}/${g.paket.pot}` : g.mapa}
        </p>
      ) : null}
      {g.commit ? <p className="mt-1 break-all font-mono text-xs">{t("ghCommit")} {g.commit}</p> : null}
      {g.paket ? <p className="mt-1 break-all font-mono text-xs">sha256 {g.paket.sha256}</p> : null}
      {debNiDovoljen ? <p className="mt-1 text-xs text-[var(--color-signal)]">{t("ghVejaNiZaNamestitev")}</p> : null}
      {apk && g.podpis ? (
        <p className={`mt-1 text-xs ${g.podpis === "ujema" ? "" : "text-[var(--color-signal)]"}`}>
          {g.podpis === "ujema" ? t("ghPodpisUjema") : g.podpis === "ne-ujema" ? t("ghPodpisNeUjema") : t("ghPodpisNiPreverjen")}
        </p>
      ) : null}
      {g.anotacije.length ? (
        <details className="mt-1">
          <summary className="cursor-pointer">{t("ghOpozorila")} ({g.anotacije.length})</summary>
          <ul className="mt-1 grid gap-1">
            {g.anotacije.map((a, i) => (
              <li key={i} className="whitespace-pre-wrap break-words text-xs">
                {a.raven}: {a.sporocilo}{a.pot ? ` (${a.pot})` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {g.stanje === "caka" ? (
          <>
            <button type="button" className="lina-gumb-majhen" disabled={zaposlen} onClick={() => void onUkaz({ ukaz: "potrdi", id: g.id, zgostitev: g.zgostitev })}>
              {t("ghPotrdi")}
            </button>
            <button type="button" className="lina-gumb-majhen" disabled={zaposlen} onClick={() => void onUkaz({ ukaz: "odkloni", id: g.id })}>
              {t("ghOdkloni")}
            </button>
          </>
        ) : null}
        {g.mapa ? (
          <button type="button" className="lina-gumb-majhen" disabled={zaposlen} onClick={() => void onUkaz({ ukaz: "odpri", id: g.id })}>
            {t("ghOdpriMapo")}
          </button>
        ) : null}
        {g.lahkoNamesti && !potrjujem ? (
          <button
            type="button"
            className="lina-gumb-majhen"
            disabled={zaposlen}
            onClick={() => (apk ? onSporocilo(t("ghNamestiTelefon")) : setPotrjujem(true))}
          >
            {t("ghNamesti")}
          </button>
        ) : null}
        {debNiDovoljen ? (
          <button type="button" className="lina-gumb-majhen" disabled={zaposlen} onClick={() => void onUkaz({ ukaz: "namestitevVeja", veja: g.veja, dovoli: true })}>
            {t("ghDovoliVejo")}
          </button>
        ) : null}
      </div>
      {potrjujem && g.paket && g.commit ? (
        <div role="group" aria-label={t("ghNamesti")} className="mt-2 grid gap-1 rounded border border-[var(--color-rule)] p-2 text-xs">
          <p>{t("ghNamestiPotrdi")}</p>
          <p className="break-all font-mono">{t("ghVeja")}: {g.veja}</p>
          <p className="break-all font-mono">{t("ghCommit")}: {g.commit}</p>
          <p className="break-all font-mono">sha256: {g.paket.sha256}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="button"
              className="lina-gumb-majhen"
              disabled={zaposlen}
              onClick={() => {
                setPotrjujem(false);
                void onUkaz({ ukaz: "namesti", id: g.id, sha256: g.paket!.sha256, commit: g.commit });
              }}
            >
              {t("ghPotrdiNamestitev")}
            </button>
            <button type="button" className="lina-gumb-majhen" disabled={zaposlen} onClick={() => setPotrjujem(false)}>
              {t("ghPreklici")}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** Stikalo v Nastavitvah: gradnje na GitHubu (lastnik 24. 11. 2026: privzeto vklopljeno). */
export function GradnjeStikalo({ razred }: { razred: string }) {
  const [vklop, setVklop] = useState<boolean | null>(null);
  const [napaka, setNapaka] = useState("");
  const zivo = useRef(true);
  const nalozi = useCallback(() => {
    void preberiStanjeGradenj(() => stanjeGradenjFn()).then((r) => {
      if (!zivo.current) return;
      if (r.stanje) setVklop(r.stanje.vklopljeno);
      setNapaka(r.napaka);
    });
  }, []);
  useEffect(() => {
    zivo.current = true;
    nalozi();
    return () => {
      zivo.current = false;
    };
  }, [nalozi]);
  async function spremeni(nov: boolean) {
    setNapaka("");
    try {
      const r = await ukazGradenjFn({ data: { ukaz: { ukaz: "vklop", vklop: nov } } });
      if (r.ok) setVklop(r.stanje.vklopljeno);
      else setNapaka(opisRazlogaGradnje(r.razlog));
    } catch {
      setNapaka(t("ghRSplosno"));
    }
  }
  if (vklop === null) return napaka ? <GradnjeNapaka razlog={napaka} onPonovi={nalozi} /> : null;
  return (
    <div className="mt-4">
      <label className={razred}>
        <input type="checkbox" checked={vklop} onChange={(e) => void spremeni(e.target.checked)} />
        {t("ghStikalo")}
      </label>
      <p className="mt-1 text-xs text-[var(--color-moss)]">{t("ghStikaloOpis")}</p>
      {napaka ? <p role="alert" className="text-xs text-[var(--color-signal)]">{napaka}</p> : null}
    </div>
  );
}

/** Stikali za spomin nalog agentov (claude-mem) in pregled novega projekta (claude-code-setup); obe privzeto vklopljeni. */
function AgentPomocStikala() {
  const [spomin, setSpomin] = useState<boolean | null>(null);
  const [pregled, setPregled] = useState<boolean | null>(null);
  useEffect(() => {
    let zivo = true;
    stanjeAgentPomociFn()
      .then((s) => {
        if (!zivo) return;
        setSpomin(s.spominNalog);
        setPregled(s.pregledProjekta);
      })
      .catch(() => undefined);
    return () => {
      zivo = false;
    };
  }, []);
  if (spomin === null || pregled === null) return null;
  return (
    <div className="lina-kartica flex flex-col gap-2 text-sm">
      <h4 className="font-semibold">{t2("agPomocNaslov")}</h4>
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={spomin}
          onChange={(e) => {
            const v = e.target.checked;
            setSpomin(v);
            void nastaviSpominNalogFn({ data: { vklop: v } }).then((r) => setSpomin(r.vklopljen)).catch(() => undefined);
          }}
        />
        <span>{t2("agSpominStikalo")}</span>
      </label>
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={pregled}
          onChange={(e) => {
            const v = e.target.checked;
            setPregled(v);
            void nastaviPregledProjektaFn({ data: { vklop: v } }).then((r) => setPregled(r.vklopljen)).catch(() => undefined);
          }}
        />
        <span>{t2("agPregledStikalo")}</span>
      </label>
    </div>
  );
}
