import { useCallback, useEffect, useRef, useState } from "react";
import { t, type Beseda } from "@/lib/lina/besedila.ts";
import { PodobneIzbira } from "@/components/podobne-izbira.tsx";
import {
  nacrtClaudeNalogeFn,
  nastaviPregledProjektaFn,
  nastaviSpominNalogFn,
  odgovorVprasanjaAgentaFn,
  stanjeVprasanjAgentovFn,
  stanjeAgentPomociFn,
  stanjeClaudeNalogFn,
  stanjeGradenjFn,
  stanjeN8nFn,
  ukazClaudeNalogFn,
  ukazGradenjFn,
  ukazN8nFn,
} from "@/lib/lina/functions.ts";
import { t2 } from "./besedila.ts";
import type { JavnaNaloga, JavnaZdruzitev, JavnoStanjeNalog, StanjeAgenta } from "@/lib/lina/claude-naloge.server.ts";
import { OZNAKA_NACRTA, type AgentId, type RazlogNaloge, type StanjeNaloge } from "@/lib/lina/claude-naloge.ts";
import type { PovzetekTock, RazlogTocke } from "@/lib/lina/tocke-naloge.ts";
import type { JavnoVprasanje, StanjeVprasanj } from "@/lib/lina/vprasanja-agentov.server.ts";
import type { RazlogNevarnosti } from "@/lib/lina/vprasanja-agentov.ts";
import type { FazaVodje, OpisNapake, RazlogVodje, VlogaNaloge, VodjaNaloge } from "@/lib/lina/claude-naloge-vodja.ts";
import type { JavnaGradnja, JavnoStanjeGradenj } from "@/lib/lina/gradnje-github.server.ts";
import type { RazlogGradnje, StanjeGradnje, Tok } from "@/lib/lina/gradnje-github.ts";
import type { JavnoStanjeN8n } from "@/lib/lina/n8n.server.ts";
import { opisRazlogaN8n, type RazlogN8n } from "@/lib/lina/n8n.ts";
import { jezikVmesnika } from "@/lib/lina/besedila.ts";
import { Ikona } from "./domov.tsx";
import { OrkestratorKartica } from "./orkestrator-kartica.tsx";
import { StanjeNapaka } from "./ui-lina.tsx";
import { datumInUra, uraGlave } from "@/lib/lina/ui-videz.ts";

/**
 * Zavihek Racunalnik (lastnik 23. 11. 2026): naloge za Claude Code. Lastnik vidi mapo in CELO besedilo naloge, preden jo potrdi;
 * porocilo agenta je samo besedilo (<pre>), nikoli HTML ali navodilo.
 */
const STANJE: Record<StanjeNaloge, Beseda> = {
  caka: "rcCaka",
  zaganja: "rcZaganja",
  tece: "rcTece",
  koncano: "rcKoncano",
  nepopolno: "rcNepopolno",
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
    case "peskovnik":
      return t("agRPeskovnik");
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
    case "kopija":
      return t("vdRKopija");
    case "izvirnik":
      return t("vdRIzvirnik");
    case "zaposleno":
      return t("vdRZaposleno");
    case "ni-zdruzitve":
      return t("vdRNiZdruzitve");
    default:
      return `${t("rcRSplosno")} (${r})`;
  }
}

const POLJE = "rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--aurora-1)]";

export function RacunalnikPanel() {
  const [stanje, setStanje] = useState<JavnoStanjeNalog | null>(null);
  const [mapa, setMapa] = useState("");
  const [besedilo, setBesedilo] = useState("");
  const [najprejNacrt, setNajprejNacrt] = useState(false);
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
  const dejavna = !!stanje?.naloge.some((n) => ["dodeljeno", "zaganja", "tece"].includes(n.stanje) || (n.vodja && !KONCNE.includes(n.vodja.faza)));
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
            // oznaka gre v besedilo: lastnik jo vidi v predlogu, zgostitev jo pokrije
            const b = najprejNacrt && !besedilo.trimStart().startsWith(OZNAKA_NACRTA) ? `${OZNAKA_NACRTA} ${besedilo.trimStart()}` : besedilo;
            void ukaz({ ukaz: "pripravi", mapa, besedilo: b }).then((ok) => {
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
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={najprejNacrt} onChange={(e) => setNajprejNacrt(e.target.checked)} />
            {t("rcNajprejNacrt")}
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
        {stanje ? <VodjaKartica stanje={stanje} zaposlen={zaposlen} onUkaz={ukaz} /> : null}
        <AgentPomocStikala />
        <N8nKartica />
        <GradnjeKartica />
      </div>

      <div className="flex min-w-0 flex-col gap-5">
      <OrkestratorKartica />
      <VprasanjaAgentaKartica />
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
      </div>
    </section>
  );
}

const RAZLOG_NEVARNOSTI: Record<RazlogNevarnosti, Beseda> = {
  brisanje: "vaRbrisanje", "git-push": "vaRgitPush", sudo: "vaRsudo", omrezje: "vaRomrezje", namescanje: "vaRnamescanje",
  "zunaj-mape": "vaRzunajMape", nastavitve: "vaRnastavitve", sestavljen: "vaRsestavljen", neznano: "vaRneznano",
};

/**
 * Naloga 23: vprasanja Claude Code (Dovoli/Zavrni) in dnevnik dela. Med delom ali cakanjem se osvezuje vsake 3 s (agent stoji, dokler
 * lastnik ne odgovori), sicer vsakih 30 s. Predogled je samo besedilo (React ga ubeze).
 */
export function VprasanjaAgentaKartica() {
  const [st, setSt] = useState<StanjeVprasanj | null>(null);
  const [napaka, setNapaka] = useState("");
  const [zaposlen, setZaposlen] = useState(false);
  const osvezi = useCallback(() => {
    void stanjeVprasanjAgentovFn().then(setSt).catch(() => undefined);
  }, []);
  useEffect(osvezi, [osvezi]);
  const dejavno = !!st && (st.teki.some((x) => x.stanje === "tece") || st.vprasanja.some((v) => v.stanje === "caka"));
  useEffect(() => {
    const c = setInterval(osvezi, dejavno ? 3000 : 30_000);
    return () => clearInterval(c);
  }, [dejavno, osvezi]);

  async function odgovori(v: JavnoVprasanje, odlocitev: "dovoli" | "zavrni") {
    setNapaka("");
    setZaposlen(true);
    try {
      const r = await odgovorVprasanjaAgentaFn({ data: { id: v.id, odlocitev, zgostitev: v.zgostitev } });
      if (r.ok) setSt(r.stanje);
      else {
        setNapaka(r.razlog === "geslo" ? t("vaGeslo") : r.razlog === "odrezano" ? t("vaOdrezano") : t("vaZastarelo"));
        osvezi();
      }
    } catch {
      setNapaka(t("rcRSplosno"));
    } finally {
      setZaposlen(false);
    }
  }

  const odprta = st?.vprasanja.filter((v) => v.stanje === "caka") ?? [];
  const teki = st?.teki ?? [];
  if (!teki.length && !odprta.length) return null;
  return (
    <div className="lina-kartica min-w-0">
      <h3><Ikona ime="racunalnik" /> {t("vaNaslov")}</h3>
      <p className="text-sm text-[var(--color-moss)]">{t("vaNamig")}</p>
      {napaka ? <p role="alert" className="mt-2 text-sm text-[var(--color-signal)]">{napaka}</p> : null}
      {odprta.length === 0 ? <p className="mt-3 text-sm text-[var(--color-moss)]">{t("vaPrazno")}</p> : (
        <ul className="mt-3 flex flex-col gap-3" aria-live="polite">
          {odprta.map((v) => (
            <li key={v.id} className="rounded-xl border border-[var(--color-rule)] p-3">
              <p className="text-sm font-medium">
                {v.orodje}
                {v.nevarno ? <span className="ml-2 text-[var(--color-signal)]">{t("vaNevarno")}: {v.razlogi.map((r) => t(RAZLOG_NEVARNOSTI[r])).join(", ")}</span> : null}
              </p>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{v.predogled}</pre>
              <p className="mt-1 text-xs text-[var(--color-moss)]">{t("vaRok")}: {ura(v.rok)}</p>
              <div className="mt-2 flex gap-2">
                {v.odrezano ? <p className="text-sm text-[var(--color-signal)]">{t("vaOdrezano")}</p> : (
                  <button type="button" disabled={zaposlen} onClick={() => void odgovori(v, "dovoli")} className="rounded-full bg-[var(--color-signal)] px-4 py-1.5 text-sm text-[var(--color-on-ink)] disabled:opacity-50">
                    {t("vaDovoli")}
                  </button>
                )}
                <button type="button" disabled={zaposlen} onClick={() => void odgovori(v, "zavrni")} className="lina-gumb-majhen">
                  {t("vaZavrni")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {teki.map((x) => (
        <details key={x.naloga} className="mt-3" open={x.stanje === "tece"}>
          <summary className="cursor-pointer text-sm">
            {t("vaDnevnik")} {x.naloga} - {t(x.stanje === "tece" ? "vaTece" : x.stanje === "koncano" ? "vaKoncano" : "vaNapaka")}
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{x.vrstice.slice(-40).join("\n")}</pre>
        </details>
      ))}
    </div>
  );
}

/** Ura v ljubljanskem casu (lastnik je v Sloveniji; tudi ce brskalnik ali streznik tece v drugem pasu), v jeziku vmesnika. */
function ura(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? datumInUra(d) : "";
}

export function NalogaVrstica({ n, zaposlen, onUkaz }: { n: JavnaNaloga; zaposlen: boolean; onUkaz: (u: Record<string, unknown>) => Promise<boolean> }) {
  // »Velja tudi za vse podobne« (isti agent, ista mapa), privzeto obkljukano; preklic v Nastavitvah > Dovoljenja
  const [podobne, setPodobne] = useState(true);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold">{t(STANJE[n.stanje])}</span>
        <span className="text-sm">{n.agent}</span>
        <span className="text-xs text-[var(--color-moss)]">{n.izvor === "lina" ? t("rcIzvorLina") : n.izvor === "telefon" ? t("agIzvorTelefon") : t("rcIzvorLastnik")}</span>
        <span className="ml-auto text-xs tabular-nums text-[var(--color-brass)]">{ura(n.ustvarjeno)}</span>
      </div>
      <p className="mt-1 break-all font-mono text-xs">{n.mapa}</p>
      {n.vloga ? (
        <p className="mt-1 text-xs">
          {t(VLOGA[n.vloga])} · {t("vdZa")} <span className="font-mono">{n.za}</span>
        </p>
      ) : null}
      {n.kopija ? (
        <p className="mt-1 break-all text-xs">
          {t("vdKopija")}: <span className="font-mono">{n.kopija}</span>
        </p>
      ) : null}
      {n.vodja ? <VodjaStanje v={n.vodja} /> : null}
      {n.vodja?.faza === "lastnik" && n.vodja.razlog === "krogi" ? (
        <button type="button" className="lina-gumb-majhen mt-2" disabled={zaposlen} onClick={() => void onUkaz({ ukaz: "vodja-zdruzi", id: n.id })}>
          {t("vdZdruziKljub")}
        </button>
      ) : null}
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
          <button type="button" className="lina-gumb-majhen" disabled={zaposlen} onClick={() => void onUkaz({ ukaz: "potrdi", id: n.id, zgostitev: n.zgostitev, podobne })}>
            {n.agent === "claude" ? t("rcPotrdi") : `${t("agPotrdiAgent")} ${n.agent}`}
          </button>
          <PodobneIzbira id={`podobne-naloga-${n.id}`} izbrano={podobne} onIzbira={setPodobne} onemogoceno={zaposlen} />
          <button type="button" className="lina-gumb-majhen" disabled={zaposlen} onClick={() => void onUkaz({ ukaz: "odkloni", id: n.id })}>
            {t("rcOdkloni")}
          </button>
        </div>
      ) : null}
      {n.nacrt ? <NacrtOgled id={n.id} cakaOdgovor={n.stanje === "tece" || n.stanje === "zaganja"} /> : null}
      {n.tocke ? <TockeNaloge tocke={n.tocke} predlog={n.predlogTock} zaposlen={zaposlen} onPredlagaj={() => void onUkaz({ ukaz: "predlagaj-tocke", id: n.id })} /> : null}
      {n.stanje === "tece" || n.stanje === "zaganja" || n.stanje === "koncano" || n.stanje === "nepopolno" ? (
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

const RAZLOG_TOCKE: Record<RazlogTocke, Beseda> = {
  manjka: "rcTRManjka",
  "ni-narejeno": "rcTRNiNarejeno",
  "brez-dokaza": "rcTRBrezDokaza",
  "dokaz-ni-najden": "rcTRDokazNiNajden",
};

/** Tocke naloge s preverjenimi dokazi (24. 11. 2026): »3/5 narejeno«, manjkajoce z razlogom; predlog za manjkajoce samo po potrditvi. */
function TockeNaloge({ tocke, predlog, zaposlen, onPredlagaj }: { tocke: PovzetekTock; predlog: string | null; zaposlen: boolean; onPredlagaj: () => void }) {
  return (
    <div className="mt-2 text-sm">
      <p className={tocke.popolno ? "font-semibold" : "font-semibold text-[var(--color-signal)]"} role="status">
        {tocke.narejeno}/{tocke.skupaj} {t("rcTockeNarejeno")}
      </p>
      {tocke.manjkajoce.length ? (
        <>
          <p className="mt-1 text-xs">{t("rcTockeManjkajo")}:</p>
          <ul className="mt-1 list-none space-y-1 pl-0 text-xs">
            {tocke.manjkajoce.map((m) => (
              <li key={m.st} className="break-words">
                <span className="font-mono">T{m.st}</span> {m.besedilo} <span className="text-[var(--color-moss)]">({t(RAZLOG_TOCKE[m.razlog])})</span>
              </li>
            ))}
          </ul>
          {predlog && predlog !== "napaka" ? (
            <p className="mt-1 text-xs text-[var(--color-moss)]">{t("rcTockePredlog")}</p>
          ) : (
            <button type="button" className="lina-gumb-majhen mt-2" disabled={zaposlen} onClick={onPredlagaj}>
              {t("rcTockePredlagaj")}
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}

/**
 * Nacrt agenta (nacrt.html): HTML pripravi streznik (varno branje, CSP kot prvi del dokumenta). Prikaz samo v okvirju s praznim
 * sandbox (brez skript, obrazcev, vtickov in brez istega izvora), nalozi se sele na lastnikov klik.
 */
function NacrtOgled({ id, cakaOdgovor }: { id: string; cakaOdgovor: boolean }) {
  const [html, setHtml] = useState<string | null>(null);
  const [napaka, setNapaka] = useState(false);
  return (
    <details className="mt-2" onToggle={(e) => {
      if (!(e.currentTarget as HTMLDetailsElement).open || html !== null) return;
      void nacrtClaudeNalogeFn({ data: { id } })
        .then((r) => {
          setNapaka(r.html === null);
          if (r.html !== null) setHtml(r.html);
        })
        .catch(() => setNapaka(true));
    }}>
      <summary className="cursor-pointer text-sm">{t("rcNacrt")} · {t("rcNacrtPokazi")}</summary>
      {cakaOdgovor ? <p className="mt-1 text-sm">{t("rcNacrtOdgovor")}</p> : null}
      {napaka ? <p role="alert" className="mt-1 text-sm text-[var(--color-signal)]">{t("rcNacrtNi")}</p> : null}
      {html !== null ? (
        <iframe sandbox="" srcDoc={html} title={t("rcNacrtOkvir")} referrerPolicy="no-referrer" className="mt-2 h-[32rem] w-full rounded-xl border border-[var(--color-rule)]" />
      ) : null}
    </details>
  );
}

// ------------------------------------------------------------------ Lina kot vodja: pregled in zdruzitev (lastnik 24. 11. 2026)

const KONCNE: readonly FazaVodje[] = ["zdruzeno", "prazno", "lastnik", "uveljavljeno"];
const VLOGA: Record<VlogaNaloge, Beseda> = { pregled: "vdVlogaPregled", popravek: "vdVlogaPopravek", spor: "vdVlogaSpor" };
const FAZA: Record<FazaVodje, Beseda> = {
  dela: "vdFazaDela",
  pregled: "vdFazaPregled",
  popravek: "vdFazaPopravek",
  zdruzi: "vdFazaZdruzi",
  spor: "vdFazaSpor",
  zdruzeno: "vdFazaZdruzeno",
  prazno: "vdFazaPrazno",
  lastnik: "vdFazaLastnik",
  uveljavljeno: "vdFazaUveljavljeno",
};
const RAZLOG_VODJE: Record<RazlogVodje, Beseda> = {
  diff: "vdRDiff",
  korak: "vdRKorak",
  krogi: "vdRKrogi",
  spor: "vdFazaSpor",
  preizkusi: "vdRPreizkusi",
  "brez-meje": "vdRBrezMeje",
  "brez-preizkusov": "vdRPreizkusi",
  zdruzitev: "vdRZdruzitev",
  "brez-peskovnika": "vdRBrezPeskovnika",
};

/** Tocka 7: besedilo razloga (SL/EN) namesto kode. */
const OPIS_NAPAKE: Record<OpisNapake, Beseda> = {
  "git-nastavitve": "vdOpisGitNastavitve",
  "git-kopije": "vdOpisGitKopije",
  povezava: "vdOpisPovezava",
  binarno: "vdOpisBinarno",
  diff: "vdOpisDiff",
  "kopija-velika": "vdOpisKopijaVelika",
  veja: "vdOpisVeja",
  premaknjen: "vdOpisPremaknjen",
  umazan: "vdOpisUmazan",
  spremenjen: "vdOpisSpremenjen",
  patch: "vdOpisPatch",
  neznano: "vdOpisNeznano",
};

function OpisRazloga({ opis, podrobnost }: { opis: OpisNapake | null | undefined; podrobnost: string | null | undefined }) {
  if (!opis) return null;
  return (
    <span className="block">
      {t(OPIS_NAPAKE[opis] ?? "vdOpisNeznano")}
      {podrobnost ? <> (<span className="font-mono">{podrobnost}</span>)</> : null}
    </span>
  );
}

const RAZLOG_ZDRUZITVE: Record<NonNullable<JavnaZdruzitev["razlog"]>, Beseda> = {
  spor: "vdFazaSpor",
  padlo: "vdRPreizkusi",
  "brez-meje": "vdRBrezMeje",
  vrnjen: "vdRVrnjen",
  "brez-peskovnika": "vdRBrezPeskovnika",
  uveljavi: "vdRUveljavi",
};

/** Faza pregleda in zdruzitve: krog N od 3, najdbe zadnjega pregleda, razlog, zakaj odloci lastnik. */
export function VodjaStanje({ v }: { v: VodjaNaloge }) {
  return (
    <p className={`mt-1 text-xs ${v.faza === "lastnik" ? "text-[var(--color-signal)]" : ""}`}>
      {t(FAZA[v.faza])}
      {v.krog > 0 ? ` · ${t("vdKrog")} ${v.krog}/3` : ""}
      {v.najdbe !== null ? ` · ${v.najdbe < 0 ? t("vdNajdbeNeberljivo") : `${t("vdNajdbe")}: ${v.najdbe}`}` : ""}
      {v.razlog ? ` · ${t(RAZLOG_VODJE[v.razlog])}` : ""}
      <OpisRazloga opis={v.opis} podrobnost={v.podrobnost} />
    </p>
  );
}

/**
 * Projekti z vec agenti: vrsta agentov po projektu (stanje, faza, krog, najdbe, polne poti), pregledovalec, ukazi preizkusov in
 * zdruzeno delo z gumbom »Uveljavi« (poslje zgostitev, ki jo lastnik vidi).
 */
export function VodjaKartica({ stanje, zaposlen, onUkaz }: { stanje: JavnoStanjeNalog; zaposlen: boolean; onUkaz: (u: Record<string, unknown>) => Promise<boolean> }) {
  const projekti = [...new Set([...stanje.naloge.flatMap((n) => (n.vodja ? [n.vodja.projekt] : [])), ...stanje.zdruzitve.map((z) => z.projekt)])];
  const pregledovalci = stanje.agenti.filter((a) => a.vklopljen && a.stanje === "pripravljen" && a.zacetniPoziv);
  return (
    <div className="lina-kartica flex flex-col gap-3">
      <h3><Ikona ime="racunalnik" /> {t("vdNaslov")}</h3>
      <p className="text-sm text-[var(--color-moss)]">{t("vdNamig")}</p>
      <label className="grid gap-1 text-sm">
        {t("vdPregledovalec")}
        <select
          value={stanje.pregledovalec}
          disabled={zaposlen}
          onChange={(e) => void onUkaz({ ukaz: "pregledovalec", agent: e.target.value })}
          className={POLJE}
        >
          {[...new Set([stanje.pregledovalec, ...pregledovalci.map((a) => a.id)])].map((id) => (
            <option key={id} value={id}>
              {stanje.agenti.find((a) => a.id === id)?.ime ?? id}
            </option>
          ))}
        </select>
      </label>
      {projekti.map((p) => (
        <ProjektVodje
          key={p}
          projekt={p}
          naloge={stanje.naloge.filter((n) => n.mapa === p)}
          zdruzitev={stanje.zdruzitve.find((z) => z.projekt === p) ?? null}
          preizkusi={stanje.preizkusi[p] ?? []}
          zaposlen={zaposlen}
          onUkaz={onUkaz}
        />
      ))}
    </div>
  );
}

/** Naloga 30: »Potrdi seznam« podpise natanko prikazani seznam s streznika (ne polja za urejanje); ukaz zahteva geslo lastnika (Z_GESLOM). */
export function ukazPotrdiPrepovedane(s: JavnoStanjeNalog): Record<string, unknown> {
  return { ukaz: "prepovedane", mape: s.prepovedane };
}

/** Ukaz »Uveljavi« veze zgostitev, ki jo lastnik vidi (streznik jo izracuna znova in brez nje zavrne). */
export function ukazUveljavi(z: JavnaZdruzitev): Record<string, unknown> {
  return { ukaz: "uveljavi", projekt: z.projekt, zgostitev: z.zgostitev };
}

function ProjektVodje({ projekt, naloge, zdruzitev, preizkusi, zaposlen, onUkaz }: {
  projekt: string; naloge: JavnaNaloga[]; zdruzitev: JavnaZdruzitev | null; preizkusi: string[][]; zaposlen: boolean;
  onUkaz: (u: Record<string, unknown>) => Promise<boolean>;
}) {
  const [ukazi, setUkazi] = useState(preizkusi.map((a) => a.join(" ")).join("\n"));
  return (
    <section className="border-t border-[var(--color-rule)] pt-3" aria-label={projekt}>
      <p className="break-all font-mono text-xs">{projekt}</p>
      <ul className="mt-1 text-sm">
        {naloge.map((n) => (
          <li key={n.id} className="py-1">
            <span className="font-semibold">{n.agent}</span> · {t(STANJE[n.stanje])}
            {n.vodja ? <VodjaStanje v={n.vodja} /> : null}
            {n.kopija ? <p className="break-all font-mono text-xs">{n.kopija}</p> : null}
          </li>
        ))}
      </ul>
      {zdruzitev ? (
        <div className="mt-2 grid gap-1 text-xs">
          <p className="font-semibold">{t("vdZdruzitev")}</p>
          <p className="break-all font-mono">{zdruzitev.pot}</p>
          {zdruzitev.veja ? <p>{t("vdVeja")}: <span className="font-mono">{zdruzitev.veja}</span></p> : null}
          {zdruzitev.diff ? <p className="break-all">{t("vdDiff")}: <span className="font-mono">{zdruzitev.diff}</span></p> : null}
          {zdruzitev.zgostitev ? <p className="break-all">{t("vdZgostitev")}: <span className="font-mono">{zdruzitev.zgostitev}</span></p> : null}
          {zdruzitev.osvezi ? <p>{t("vdOsvezuje")}</p> : null}
          {zdruzitev.razlog ? (
            <p className="text-[var(--color-signal)]">
              {t(RAZLOG_ZDRUZITVE[zdruzitev.razlog])}
              <OpisRazloga opis={zdruzitev.opis} podrobnost={zdruzitev.podrobnost} />
            </p>
          ) : null}
          {/* git nastavitev in neshranjene spremembe lastnik odpravi sam; ponovna zdruzitev bi naletela na isto zavrnitev */}
          {zdruzitev.razlog && zdruzitev.opis !== "git-nastavitve" && zdruzitev.opis !== "umazan" ? (
            <>
              <p className="text-[var(--color-moss)]">{t("vdZnovaNamig")}</p>
              <button type="button" className="lina-gumb-majhen self-start" disabled={zaposlen} onClick={() => void onUkaz({ ukaz: "zdruzitev-znova", projekt: zdruzitev.projekt })}>
                {t("vdZnova")}
              </button>
            </>
          ) : null}
          {zdruzitev.diff ? (
            <button type="button" className="lina-gumb-majhen self-start" disabled={zaposlen} onClick={() => void onUkaz({ ukaz: "izvozi-zdruzitev", projekt: zdruzitev.projekt })}>
              {t("vdIzvozi")}
            </button>
          ) : null}
          {zdruzitev.izvoz ? (
            <p className="break-all">
              {t("vdIzvozeno")}: <span className="font-mono">{zdruzitev.izvoz}</span>
            </p>
          ) : null}
          <button type="button" className="lina-gumb-majhen self-start" disabled={zaposlen} onClick={() => void onUkaz({ ukaz: "opusti-zdruzitev", projekt: zdruzitev.projekt })}>
            {t("vdOpusti")}
          </button>
          {zdruzitev.zgostitev && zdruzitev.naloge.length && !zdruzitev.osvezi ? (
            <>
              <p className="text-[var(--color-moss)]">{t("vdUveljaviNamig")}</p>
              <button
                type="button"
                className="lina-gumb-majhen self-start"
                disabled={zaposlen}
                onClick={() => void onUkaz(ukazUveljavi(zdruzitev))}
              >
                {t("vdUveljavi")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      <form
        className="mt-2 grid gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          // argv brez lupine: presledki locijo dele ukaza
          void onUkaz({ ukaz: "preizkusi", projekt, ukazi: ukazi.split("\n").map((v) => v.trim().split(/\s+/).filter(Boolean)).filter((a) => a.length) });
        }}
      >
        <label className="grid gap-1 text-sm">
          {t("vdPreizkusi")}
          <textarea value={ukazi} onChange={(e) => setUkazi(e.target.value)} rows={2} spellCheck={false} className={POLJE} />
        </label>
        <button type="submit" disabled={zaposlen} className="lina-gumb-majhen self-start">{t("vdShraniPreizkuse")}</button>
      </form>
    </section>
  );
}

// ------------------------------------------------------------------ Agenti na racunalniku (lastnik 24. 11. 2026)

function opisStanjaAgenta(a: StanjeAgenta): string {
  if (a.stanje === "ni-najden") return t("agNiNajden");
  if (a.stanje === "izklopljen") return t("agIzklopljen");
  if (a.stanje === "ne-deluje") return t("agNeDeluje");
  if (a.stanje === "brez-peskovnika") return t("agBrezPeskovnika");
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
  const [podobne, setPodobne] = useState(true);
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
      {stanje.omrezjeAgentov === "gostitelj" ? (
        <p role="note" className="text-sm text-[var(--color-signal)]">
          {t("rcOmrezjePasta")}
        </p>
      ) : null}
      <button type="button" className="lina-gumb-majhen self-start" disabled={zaposlen} onClick={() => void onUkaz({ ukaz: "preveri-agente" })}>
        {t("agPreveri")}
      </button>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void onUkaz({ ukaz: "dodeli", agent: izbran, mapa, besedilo, pogoj, podobne }).then((ok) => {
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
        <PodobneIzbira id="podobne-dodeli" izbrano={podobne} onIzbira={setPodobne} onemogoceno={zaposlen} />
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
      {/* vedno vidno, tudi brez gesla (geslo doloca datoteka v mapi podatkov - skrivanje bi lahko izzval pisalec datotek); gumb brez gesla onemogocen, razlog je rcBrezGesla */}
      {stanje.prepovedaneNepotrjene ? (
        <div className="flex flex-col gap-2 text-sm">
          <p role="alert" className="font-semibold text-[var(--color-signal)]">{t("agPrepovedaneNepotrjene")}</p>
          <p>{t("agPrepovedaneNepotrjeneNamig")}</p>
          {stanje.prepovedane.length ? (
            <ul className="list-disc pl-5 font-mono text-xs">{stanje.prepovedane.map((m, i) => <li key={`${i}-${m}`}>{m}</li>)}</ul>
          ) : (
            <p className="text-xs">{t("agPrepovedanePrazen")}</p>
          )}
          <button type="button" disabled={zaposlen || !stanje.geslo} onClick={() => void onUkaz(ukazPotrdiPrepovedane(stanje))} className="lina-gumb-majhen self-start">
            {t("agPotrdiSeznam")}
          </button>
        </div>
      ) : null}
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
  // »Velja tudi za vse podobne« (isti tok, ista veja) velja samo za ZAGON; namestitev se vedno potrdi posebej
  const [podobne, setPodobne] = useState(true);
  const debNiDovoljen = !apk && g.stanje === "koncano" && g.paket !== null && g.commit !== null && !g.lahkoNamesti;
  return (
    <li className="py-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold">{t(STANJE_GRADNJE[g.stanje])}</span>
        <span>{apk ? t("ghTokApk") : t("ghTokDeb")} · {g.veja}</span>
        <span className="text-xs text-[var(--color-moss)]">{g.izvor === "lina" ? t("ghIzvorLina") : g.izvor === "telefon" ? t("ghIzvorTelefon") : t("ghIzvorLastnik")}</span>
        <span className="ml-auto text-xs tabular-nums text-[var(--color-brass)]">{ura(g.konec ?? g.ustvarjeno)}</span>
      </div>
      {g.razlog ? <p className="mt-1 text-[var(--color-signal)]">{opisRazlogaGradnje(g.razlog)}</p> : null}
      {g.ocenaKonca ? <p className="mt-1 text-xs">{t("ghOcena")}: {uraGlave(new Date(g.ocenaKonca))}</p> : null}
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
            <button type="button" className="lina-gumb-majhen" disabled={zaposlen} onClick={() => void onUkaz({ ukaz: "potrdi", id: g.id, zgostitev: g.zgostitev, podobne })}>
              {t("ghPotrdi")}
            </button>
            <PodobneIzbira id={`podobne-gradnja-${g.id}`} izbrano={podobne} onIzbira={setPodobne} onemogoceno={zaposlen} />
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

/** Lokalni n8n tokovi (24. 11. 2026): seznam, predlogi ustvarjanja/zagona in potrditev lastnika z zgostitvijo. */
function N8nKartica() {
  const [stanje, setStanje] = useState<JavnoStanjeN8n | null>(null);
  const [opis, setOpis] = useState("");
  const [ime, setIme] = useState("");
  const [napaka, setNapaka] = useState("");
  const [zaposlen, setZaposlen] = useState(false);
  // »Velja tudi za vse podobne« samo za ZAGON istega toka (po ID); ustvarjanje toka se vedno potrdi posebej
  const [podobne, setPodobne] = useState(true);

  const osvezi = useCallback(() => {
    void stanjeN8nFn()
      .then((s) => {
        setStanje(s);
        setNapaka(s.napaka ? opisRazlogaN8n(s.napaka, jezikVmesnika()) : "");
      })
      .catch(() => setNapaka(t("n8nNiPovezave")));
  }, []);
  useEffect(osvezi, [osvezi]);

  async function ukaz(u: Record<string, unknown>): Promise<boolean> {
    setNapaka("");
    setZaposlen(true);
    try {
      const r = await ukazN8nFn({ data: { ukaz: u } });
      if (!r.ok) {
        setNapaka(opisRazlogaN8n(r.razlog as RazlogN8n, jezikVmesnika()));
        osvezi();
        return false;
      }
      setStanje(r.stanje);
      return true;
    } catch {
      setNapaka(t("n8nNiPovezave"));
      return false;
    } finally {
      setZaposlen(false);
    }
  }

  if (!stanje) return null;
  return (
    <div className="lina-kartica flex flex-col gap-3">
      <h3><Ikona ime="racunalnik" /> {t("n8nNaslov")}</h3>
      <p className="text-sm text-[var(--color-moss)]">{t("n8nNamig")}</p>
      {!stanje.vklopljeno ? <p className="text-sm text-[var(--color-signal)]">{t("n8nIzklopljeno")}</p> : null}
      {stanje.vklopljeno && !stanje.povezan ? <p className="text-sm text-[var(--color-signal)]">{t("n8nNiPovezave")}</p> : null}
      {stanje.vklopljeno ? (
        <>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ukaz({ ukaz: "predlog_ustvari", opis, ...(ime.trim() ? { ime: ime.trim() } : {}) }).then((ok) => {
                if (ok) {
                  setOpis("");
                  setIme("");
                }
              });
            }}
          >
            <label className="grid gap-1 text-sm">
              {t("n8nOpisPolje")}
              <input value={opis} onChange={(e) => setOpis(e.target.value)} maxLength={400} className={POLJE} />
            </label>
            <label className="grid gap-1 text-sm">
              {t("n8nImePolje")}
              <input value={ime} onChange={(e) => setIme(e.target.value)} maxLength={80} className={POLJE} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={zaposlen || opis.trim().length < 3} className="rounded-full bg-[var(--color-signal)] px-4 py-1.5 text-sm text-[var(--color-on-ink)] disabled:opacity-50">
                {t("n8nUstvariPredlog")}
              </button>
              <button type="button" disabled={zaposlen} className="lina-gumb-majhen" onClick={() => void ukaz({ ukaz: "seznam" })}>
                {t("n8nOsvezi")}
              </button>
              {!stanje.pripravljen ? (
                <button type="button" disabled={zaposlen} className="lina-gumb-majhen" onClick={() => void ukaz({ ukaz: "pripravi" })}>
                  {t("n8nPripravi")}
                </button>
              ) : null}
            </div>
          </form>
          {napaka ? <p role="alert" className="text-sm text-[var(--color-signal)]">{napaka}</p> : null}
          {stanje.tokovi.length === 0 ? (
            <p className="text-sm text-[var(--color-moss)]">{t("n8nPraznoTokovi")}</p>
          ) : (
            <ul className="divide-y divide-[var(--color-rule)] text-sm">
              {stanje.tokovi.map((tok) => (
                <li key={tok.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{tok.ime}</span>{" "}
                    <span className="text-xs text-[var(--color-moss)]">({tok.id}, {tok.aktiven ? t("n8nAktiven") : t("n8nNeaktiven")})</span>
                  </span>
                  <button type="button" disabled={zaposlen} className="lina-gumb-majhen" onClick={() => void ukaz({ ukaz: "predlog_zazeni", cilj: tok.id })}>
                    {t("n8nZazeniPredlog")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {stanje.predlogi.length > 0 ? (
            <div className="mt-1">
              <h4 className="text-sm font-semibold">{t("n8nPredlogiNaslov")}</h4>
              <ul className="mt-1 divide-y divide-[var(--color-rule)] text-sm">
                {stanje.predlogi.slice(0, 10).map((p) => (
                  <li key={p.id} className="py-2">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium">{p.imeToka}</span>
                      <span className="text-xs text-[var(--color-moss)]">{p.stanje}</span>
                      <span className="ml-auto text-xs tabular-nums text-[var(--color-brass)]">{ura(p.ustvarjeno)}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--color-moss)]">{p.rezultat ?? p.povzetek}</p>
                    {p.stanje === "caka" ? (
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        <button type="button" disabled={zaposlen} className="lina-gumb-majhen" onClick={() => void ukaz({ ukaz: "potrdi", id: p.id, zgostitev: p.zgostitev, podobne: p.vrsta === "zazeni" && podobne })}>
                          {t("n8nPotrdi")}
                        </button>
                        {p.vrsta === "zazeni" ? <PodobneIzbira id={`podobne-n8n-${p.id}`} izbrano={podobne} onIzbira={setPodobne} onemogoceno={zaposlen} /> : null}
                        <button type="button" disabled={zaposlen} className="lina-gumb-majhen" onClick={() => void ukaz({ ukaz: "odkloni", id: p.id })}>
                          {t("n8nOdkloni")}
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
