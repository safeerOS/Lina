import { useEffect, useState } from "react";
import { GUMB, GUMB_OBROBA, NAMIG, OZNAKA_POLJA, POLJE } from "@/components/ui-lina.tsx";
import { lokalizacija } from "@/lib/lina/besedila.ts";
import { tD } from "@/lib/lina/besedila-dovoljenja.ts";
import { razlogUvoza, tN } from "@/lib/lina/besedila-narocila.ts";
import { stanjeNarocilFn, uvoziNarocilaFn } from "@/lib/lina/functions.ts";
import type { IzidUvoza } from "@/lib/lina/narocila.server.ts";

type Stanje = { mapa: string | null; posodobljeno: string | null; narocila: number; podobne: boolean };

/**
 * Nastavitve > Narocila podjetja: izbira mape, Uvozi, stevilo narocil in opozorila zadnjega uvoza. Prvi uvoz mape (ali mape brez
 * dovoljenja za podobne) zahteva potrditev; »Velja tudi za vse podobne« je privzeto obkljukano (skupni modul dovoljenj 02f).
 */
export function NarocilaNastavitve({ onError }: { onError: (sporocilo: string) => void }) {
  const [stanje, setStanje] = useState<Stanje | null>(null);
  const [mapa, setMapa] = useState("");
  const [potrditev, setPotrditev] = useState<string | null>(null);
  const [podobne, setPodobne] = useState(true);
  const [zaposlen, setZaposlen] = useState(false);
  const [izid, setIzid] = useState<IzidUvoza | null>(null);

  async function nalozi() {
    try {
      const s = await stanjeNarocilFn();
      setStanje(s);
      if (s.mapa) setMapa((m) => m || s.mapa || "");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void nalozi();
  }, []);

  async function uvozi(potrjeno: boolean) {
    setZaposlen(true);
    onError("");
    try {
      // potrditev velja za kanonicno mapo, ki jo je lastnik videl v vprasanju (ne za morebiti spremenjeno vneseno pot)
      const r = await uvoziNarocilaFn({ data: potrjeno && potrditev ? { mapa: potrditev, potrjeno: true, podobne } : { mapa } });
      if (r.stanje === "potrebna-potrditev") {
        setPotrditev(r.mapa);
        setPodobne(true);
        return;
      }
      setPotrditev(null);
      setIzid(r.izid);
      await nalozi();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setZaposlen(false);
    }
  }

  const opozorila = izid
    ? [
        ...izid.preskoceno.map((p) => `${p.datoteka}: ${razlogUvoza(p.razlog)}`),
        ...izid.neprepoznaneGlave.map((g) => `${g.datoteka}: ${tN("neprepoznanaGlava")} (${g.stolpci.slice(0, 8).join(", ")})`),
      ]
    : [];

  return (
    <div className="space-y-3 text-sm">
      <p className="text-[var(--color-moss)]">{tN("razlaga")}</p>
      <label className={OZNAKA_POLJA} htmlFor="narocila-mapa">
        {tN("mapa")}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="narocila-mapa"
          value={mapa}
          onChange={(e) => {
            setMapa(e.target.value);
            setPotrditev(null);
          }}
          maxLength={1024}
          spellCheck={false}
          autoComplete="off"
          className={`${POLJE} min-w-0 flex-1`}
        />
        <button type="button" disabled={zaposlen || !mapa.trim()} onClick={() => void uvozi(false)} className={GUMB}>
          {zaposlen ? tN("uvazam") : tN("uvozi")}
        </button>
      </div>

      {potrditev ? (
        <div role="alertdialog" aria-labelledby="narocila-potrdi" className="space-y-2 rounded-xl border border-[var(--color-rule)] p-3">
          <p id="narocila-potrdi" className="font-semibold">{tN("potrdiVprasanje")}</p>
          <p className="break-all font-mono text-xs">{potrditev}</p>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={podobne} onChange={(e) => setPodobne(e.target.checked)} />
            <span>{tD("izbira")}</span>
          </label>
          <p className={NAMIG}>{tD("izbiraPojasnilo")}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={zaposlen} onClick={() => void uvozi(true)} className={GUMB}>
              {tN("potrdi")}
            </button>
            <button type="button" disabled={zaposlen} onClick={() => setPotrditev(null)} className={GUMB_OBROBA}>
              {tN("preklici")}
            </button>
          </div>
        </div>
      ) : null}

      <div aria-live="polite" className="space-y-1">
        {stanje && stanje.posodobljeno ? (
          <>
            <p>
              {tN("stevilo")}: <strong>{stanje.narocila}</strong> · {tN("zadnjic")}: {new Date(stanje.posodobljeno).toLocaleString(lokalizacija())}
            </p>
            {stanje.mapa ? <p className="break-all font-mono text-xs">{stanje.mapa}</p> : null}
            {stanje.podobne ? <p className={NAMIG}>{tN("podobneVelja")}</p> : null}
          </>
        ) : stanje ? (
          <p>{tN("niUvoza")}</p>
        ) : null}
      </div>

      {opozorila.length > 0 ? (
        <details open className="border-t border-[var(--color-rule)] pt-3">
          <summary className="min-h-11 cursor-pointer">
            {tN("opozorila")} ({opozorila.length})
          </summary>
          <ul className="mt-2 space-y-1 text-xs">
            {opozorila.slice(0, 100).map((o, i) => (
              <li key={i} className="break-words">{o}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
