import { useEffect, useState } from "react";
import {
  dodajIzrazStrokeFn,
  izberiStrokoFn,
  izbrisiIzrazStrokeFn,
  nastaviStrokeFn,
  potrdiIzrazStrokeFn,
  pozabiStrokeFn,
  stanjeStrokFn,
} from "@/lib/lina/functions.ts";
import type { PogledStrok } from "@/lib/lina/stroke.server.ts";
import { jezikVmesnika } from "@/lib/lina/besedila.ts";
import { t2, type Beseda2 } from "./besedila.ts";

const VIR: Record<PogledStrok["izrazi"][number]["vir"], Beseda2> = {
  vgrajen: "strVirVgrajen",
  dokument: "strVirDokument",
  pogovor: "strVirPogovor",
  rocno: "strVirRocno",
};

/**
 * Nastavitve »Prilagodljivi kontekst« (lastnik 23. 11. 2026: privzeto vklopljeno, s stikalom za izklop): izbira stroke, predlog Line,
 * vsi izrazi z virom in rabo (oznaka »znate«), potrditev predlogov, izbris posameznega izraza ali vsega.
 */
export function StrokeKartica({ razred }: { razred: string }) {
  const [p, setP] = useState<PogledStrok | null>(null);
  const [sporocilo, setSporocilo] = useState("");
  const [zaposlen, setZaposlen] = useState(false);
  const [potrdi, setPotrdi] = useState(false);
  const [nov, setNov] = useState({ izraz: "", razlaga: "" });
  const en = jezikVmesnika() === "en";

  useEffect(() => {
    let zivo = true;
    stanjeStrokFn()
      .then((x) => {
        if (zivo) setP(x);
      })
      .catch(() => undefined);
    return () => {
      zivo = false;
    };
  }, []);

  async function izvedi(delo: () => Promise<PogledStrok>) {
    setSporocilo("");
    setZaposlen(true);
    try {
      setP(await delo());
    } catch {
      setSporocilo(t2("strNapaka"));
    } finally {
      setZaposlen(false);
    }
  }

  async function dodaj() {
    setSporocilo("");
    setZaposlen(true);
    try {
      const r = await dodajIzrazStrokeFn({ data: nov });
      setP(r.pogled);
      if (r.ok) setNov({ izraz: "", razlaga: "" });
      else setSporocilo(t2("strZavrnjen"));
    } catch {
      setSporocilo(t2("strNapaka"));
    } finally {
      setZaposlen(false);
    }
  }

  if (!p) return null;
  const imeStroke = (k: string) => p.stroke.find((s) => s.kljuc === k)?.ime[en ? "en" : "sl"] ?? k;
  const nobenaIzbrana = !p.stroke.some((s) => s.izbrana);
  const gumb = "rounded-full px-3 py-1 hover:bg-[var(--color-surface)] disabled:opacity-50";

  return (
    <div className="mt-4">
      <h4 className="text-sm font-semibold">{t2("strNaslov")}</h4>
      <label className={razred}>
        <input type="checkbox" checked={p.vklopljen} disabled={zaposlen} onChange={(e) => void izvedi(() => nastaviStrokeFn({ data: { vklop: e.target.checked } }))} />
        {t2("strStikalo")}
      </label>
      <p className="mt-1 text-xs text-[var(--color-moss)]">{t2("strOpis")}</p>

      <fieldset className="mt-2 text-xs">
        <legend className="font-medium">{t2("strStroke")}</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {p.stroke.map((s) => (
            <label key={s.kljuc} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={s.izbrana}
                disabled={zaposlen}
                onChange={(e) => void izvedi(() => izberiStrokoFn({ data: { kljuc: s.kljuc, izbrana: e.target.checked } }))}
              />
              {s.ime[en ? "en" : "sl"]}
            </label>
          ))}
        </div>
        {p.predlaganaStroka ? (
          <p className="mt-1 text-[var(--color-brass)]">
            {t2("strPredlagana")}: {imeStroke(p.predlaganaStroka)} {nobenaIzbrana ? t2("strSamodejno") : ""}
          </p>
        ) : null}
      </fieldset>

      <details className="mt-2 text-xs">
        <summary className="cursor-pointer font-medium">
          {t2("strIzrazi")} ({p.izrazi.length})
        </summary>
        {p.izrazi.length === 0 ? <p className="mt-1">{t2("strPrazno")}</p> : null}
        <ul className="mt-1.5 grid gap-1">
          {p.izrazi.map((i) => (
            <li key={i.izraz} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-rule)] p-1.5">
              <strong>{i.izraz}</strong>
              {i.razlaga ? <span className="text-[var(--color-moss)]">{i.razlaga}</span> : null}
              <span className="text-[var(--color-brass)]">
                {t2("strVir")}: {t2(VIR[i.vir])}
                {i.izvor ? ` (${i.izvor})` : ""} · {t2("strRabljeno")}: {i.n}
                {i.znano ? ` · ${t2("strZnano")}` : ""}
                {i.predlog ? ` · ${t2("strPredlog")}` : ""}
              </span>
              {i.predlog && i.id ? (
                <button type="button" disabled={zaposlen} className={gumb} onClick={() => void izvedi(() => potrdiIzrazStrokeFn({ data: { id: i.id! } }))}>
                  {t2("strPotrdi")}
                </button>
              ) : null}
              <button type="button" disabled={zaposlen} className={`${gumb} text-[var(--color-signal)]`} onClick={() => void izvedi(() => izbrisiIzrazStrokeFn({ data: { izraz: i.izraz } }))}>
                {t2("strIzbrisi")}
              </button>
            </li>
          ))}
        </ul>
        {p.skritih > 0 ? (
          <p className="mt-1 text-[var(--color-moss)]">
            {t2("strSkritih")}: {p.skritih}
          </p>
        ) : null}
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void dodaj();
          }}
        >
          <label className="grid gap-0.5">
            <span>{t2("strDodajIzraz")}</span>
            <input value={nov.izraz} maxLength={60} onChange={(e) => setNov((x) => ({ ...x, izraz: e.target.value }))} className="rounded-lg border border-[var(--color-rule)] bg-[var(--color-sheet)] p-1" />
          </label>
          <label className="grid gap-0.5">
            <span>{t2("strDodajRazlaga")}</span>
            <input value={nov.razlaga} maxLength={160} onChange={(e) => setNov((x) => ({ ...x, razlaga: e.target.value }))} className="rounded-lg border border-[var(--color-rule)] bg-[var(--color-sheet)] p-1" />
          </label>
          <button type="submit" disabled={zaposlen || !nov.izraz.trim()} className={gumb}>
            {t2("strDodaj")}
          </button>
        </form>
      </details>

      {potrdi ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {t2("strPotrdiPozabo")}
          <button
            type="button"
            className={`${gumb} text-[var(--color-signal)]`}
            onClick={() => {
              setPotrdi(false);
              void izvedi(() => pozabiStrokeFn());
            }}
          >
            {t2("strIzbrisi")}
          </button>
          <button type="button" className={gumb} onClick={() => setPotrdi(false)}>
            {t2("spominNe")}
          </button>
        </p>
      ) : (
        <button type="button" className={`mt-2 text-xs text-[var(--color-signal)] ${gumb}`} onClick={() => setPotrdi(true)}>
          {t2("strPozabiVse")}
        </button>
      )}
      {sporocilo ? (
        <p role="status" className="text-xs text-[var(--color-brass)]">
          {sporocilo}
        </p>
      ) : null}
    </div>
  );
}
