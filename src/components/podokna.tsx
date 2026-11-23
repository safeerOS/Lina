import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { t } from "@/lib/lina/besedila.ts";
import {
  filtrirajPodokna,
  jePodoknoId,
  naslednjePodokno,
  podoknoZaRazdelek,
  preberiPodokno,
  shraniPodokno,
  type DefinicijaPodoken,
} from "@/lib/lina/podokna-definicije.ts";

/**
 * Skupna podokna za zavihke Line, ki so daljsi od enega zaslona (lastnik 15. 11. 2026: »Nastavitve so dolgo brskanje po
 * strani dol, zato je bolj smiselno narediti vec podoken«; pravilo velja za vsako dolgo stran).
 * Definicija (podokna-definicije.ts) je edini vir: kateri razdelek je pod katerim podoknom. Tip zahteva, da vsak razdelek
 * dobi vsebino (noben ne izgine), vsak je samo pod enim podoknom (ne podvoji se). Podokno, katerega vsi razdelki so skriti
 * (null/false, npr. poslovni razdelki v osebnem nacinu), se v traku ne prikaze.
 * Neizbrana podokna ostanejo v strani s `hidden`: stanje polj (vnesen kljuc, neshranjena pravila) se ob preklopu ne izgubi,
 * bralnik zaslona jih ne bere. Tipkovnica po vzorcu WAI-ARIA tablist (puscice, Home, End), izbira se zapomni v localStorage,
 * globoke povezave (#sidro in hashchange) odprejo pravo podokno.
 */
const FOKUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)]";

export function Podokna<D extends DefinicijaPodoken>({
  def,
  razdelki,
  zacetno,
  podnozje,
}: {
  def: D;
  razdelki: Record<D["podokna"][number]["razdelki"][number], ReactNode>;
  zacetno?: D["podokna"][number]["id"];
  podnozje?: Partial<Record<D["podokna"][number]["id"], ReactNode>>;
}) {
  const vsebina = razdelki as Record<string, ReactNode>;
  const vidna = filtrirajPodokna(def, vsebina);
  const vidniIdji = vidna.podokna.map((p) => p.id).join(",");
  const prvoVidno = vidna.podokna[0]?.id ?? def.podokna[0].id;
  const [aktivno, setAktivno] = useState<string>(() => (zacetno && jePodoknoId(vidna, zacetno) ? zacetno : prvoVidno));
  const izbranoAktivno = jePodoknoId(vidna, aktivno) ? aktivno : prvoVidno;
  const gumbi = useRef<Record<string, HTMLButtonElement | null>>({});
  const vidnaRef = useRef(vidna);
  vidnaRef.current = vidna;

  useEffect(() => {
    if (zacetno && jePodoknoId(vidnaRef.current, zacetno)) {
      setAktivno(zacetno);
      shraniPodokno(def, zacetno);
    }
  }, [def, vidniIdji, zacetno]);

  // Globoke povezave (#sidro ob odprtju in ob hashchange) ter zapomnjena izbira v localStorage.
  useEffect(() => {
    const odpriSidro = (): boolean => {
      if (typeof window === "undefined") return false;
      const sidro = window.location.hash;
      if (!sidro) return false;
      const cilj = podoknoZaRazdelek(vidnaRef.current, sidro);
      if (!cilj) return false;
      setAktivno(cilj);
      shraniPodokno(def, cilj);
      const id = sidro.replace(/^#/, "");
      window.requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ block: "nearest" });
      });
      return true;
    };

    if (!odpriSidro() && !zacetno) {
      const shranjeno = preberiPodokno(vidnaRef.current);
      if (shranjeno) setAktivno(shranjeno);
    }

    const obSpremembiSidra = () => {
      odpriSidro();
    };
    window.addEventListener("hashchange", obSpremembiSidra);
    return () => window.removeEventListener("hashchange", obSpremembiSidra);
  }, [def, vidniIdji, zacetno]);

  function izberi(id: string, zFokusom: boolean) {
    if (!jePodoknoId(vidna, id)) return;
    setAktivno(id);
    shraniPodokno(def, id);
    if (!zFokusom) return;
    const gumb = gumbi.current[id];
    gumb?.focus();
    gumb?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function tipka(event: KeyboardEvent<HTMLDivElement>) {
    const naslednji = naslednjePodokno(vidna, izbranoAktivno, event.key);
    if (!naslednji) return;
    event.preventDefault();
    izberi(naslednji, true);
  }

  return (
    <div className="mt-5 grid items-start gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]" data-podokna={def.predpona}>
      <div
        role="tablist"
        aria-label={t(def.naziv)}
        onKeyDown={tipka}
        className="flex gap-2 overflow-x-auto pb-1 lg:sticky lg:top-20 lg:flex-col lg:overflow-visible lg:pb-0"
      >
        {vidna.podokna.map((podokno) => {
          const izbrano = podokno.id === izbranoAktivno;
          return (
            <button
              key={podokno.id}
              ref={(el) => {
                gumbi.current[podokno.id] = el;
              }}
              type="button"
              role="tab"
              id={`${def.predpona}-zavihek-${podokno.id}`}
              aria-selected={izbrano}
              aria-controls={`${def.predpona}-podokno-${podokno.id}`}
              tabIndex={izbrano ? 0 : -1}
              onClick={() => izberi(podokno.id, false)}
              className={`rounded-full px-4 py-2 text-sm whitespace-nowrap transition-colors motion-reduce:transition-none lg:rounded-2xl lg:text-left lg:whitespace-normal ${FOKUS} ${
                izbrano
                  ? "bg-[var(--color-ink-fill)] font-medium text-white"
                  : "bg-[var(--color-surface)] text-[var(--color-ink)] hover:border-[var(--color-ink)]"
              }`}
            >
              {t(podokno.oznaka)}
            </button>
          );
        })}
      </div>
      <div className="min-w-0">
        {vidna.podokna.map((podokno) => {
          const noga = podnozje?.[podokno.id as D["podokna"][number]["id"]];
          return (
            <div
              key={podokno.id}
              role="tabpanel"
              id={`${def.predpona}-podokno-${podokno.id}`}
              aria-labelledby={`${def.predpona}-zavihek-${podokno.id}`}
              hidden={podokno.id !== izbranoAktivno}
            >
              {podokno.razdelki.map((razdelek) => {
                const del = vsebina[razdelek];
                if (del === null || del === undefined || del === false) return null;
                return (
                  <div key={razdelek} data-razdelek={razdelek} className="mt-5 first:mt-0">
                    {del}
                  </div>
                );
              })}
              {noga ? <div className="mt-5">{noga}</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
