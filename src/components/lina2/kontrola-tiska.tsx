import { useCallback, useEffect, useState } from "react";
import {
  izmeriTiskFn,
  namestiKnjizniceVidaFn,
  opisiNapakeTiskaFn,
  oznacenaSlikaKontroleFn,
  oznakePdfFn,
  pocistiPrejeteKontroleFn,
  prejetaSlikaKontroleFn,
  prejeteSlikeKontroleFn,
  shraniNastavitveKontroleFn,
  stanjeKontroleTiskaFn,
} from "@/lib/lina/functions.ts";
import { STIRI_OZNAKE, PRIVZETA_MERITEV, type IzidKontrole, type NastavitveKontrole } from "@/lib/lina/kontrola-tiska.ts";
import { datumInUra } from "@/lib/lina/ui-videz.ts";
import { t2 as t } from "./besedila.ts";
import { Ikona } from "./domov.tsx";

/**
 * Zavihek Kontrola tiska (lastnik 24. 11. 2026): fotografija + referenca -> izmerjene stevilke in oznacena slika.
 * Stevilke prikazemo dobesedno iz izida meritve; opis modela (ce je vklopljen) je samo besedilo poleg njih (<p>, nikoli HTML).
 */
const POLJE = "rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--aurora-1)]";

type Stanje = Awaited<ReturnType<typeof stanjeKontroleTiskaFn>>;

function vBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

const mm = (v: number | undefined) => (typeof v === "number" ? `${v >= 0 ? "+" : ""}${v.toFixed(2)} mm` : "–");

function Izid({ izid, slika, opis }: { izid: IzidKontrole; slika: string | null; opis: string }) {
  const p = izid.polozaj;
  const barvaOcene = izid.ocena === "OK" ? "text-[var(--color-moss)]" : "text-[var(--color-signal)]";
  return (
    <section className="grid gap-2" aria-live="polite">
      <p className={`text-2xl font-semibold ${barvaOcene}`}>{izid.ocena}</p>
      {izid.referenca.vrsta === "prvi-kos" ? <p className="text-xs">{t("ktPrviKosOpomba")}</p> : null}
      {p ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt>{t("ktOdmikX")}</dt>
          <dd>{mm(p.odmik_x_mm)}</dd>
          <dt>{t("ktOdmikY")}</dt>
          <dd>{mm(p.odmik_y_mm)}</dd>
          <dt>{t("ktZasuk")}</dt>
          <dd>{`${p.zasuk_deg >= 0 ? "+" : ""}${p.zasuk_deg.toFixed(2)}°`}</dd>
          <dt>{t("ktSirina")}</dt>
          <dd>{`${p.sirina_mm.toFixed(1)} mm`}</dd>
          <dt>{t("ktMerilo")}</dt>
          <dd>{izid.merilo?.toFixed(4) ?? "–"}</dd>
          <dt>{t("ktDeltaE")}</dt>
          <dd>{izid.barva ? `${izid.barva.dE00_povprecje.toFixed(1)} / ${izid.barva.dE00_p95.toFixed(1)}` : "–"}</dd>
          <dt>{t("ktZamikBarv")}</dt>
          <dd>{izid.registracija ? `${izid.registracija.najvecji_zamik_mm.toFixed(2)} mm` : "–"}</dd>
        </dl>
      ) : null}
      {izid.razlogi.length ? (
        <div className="text-sm">
          <p className="font-semibold">{t("ktRazlogi")}</p>
          <ul className="list-disc pl-5">
            {izid.razlogi.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {p ? (
        <div className="text-sm">
          <p className="font-semibold">{t("ktNapake")}</p>
          {izid.napake.length ? (
            <ol className="list-decimal pl-5">
              {izid.napake.map((n, i) => (
                <li key={i}>
                  {n.vrsta}: {n.okvir_mm[0].toFixed(1)}, {n.okvir_mm[1].toFixed(1)} mm · {n.povrsina_mm2.toFixed(1)} mm² · ΔE00 {n.dE00_najvec.toFixed(0)}
                </li>
              ))}
            </ol>
          ) : (
            <p>{t("ktBrezNapak")}</p>
          )}
        </div>
      ) : null}
      {slika ? <img src={`data:image/png;base64,${slika}`} alt={t("ktNapake")} className="max-h-[70vh] w-auto rounded-xl border border-[var(--color-rule)]" /> : null}
      {opis ? <p className="whitespace-pre-wrap rounded-xl border border-[var(--color-rule)] p-3 text-sm">{opis}</p> : null}
    </section>
  );
}

function NastavitveKartica({ nastavitve, onShranjeno }: { nastavitve: NastavitveKontrole; onShranjeno: () => void }) {
  const m = nastavitve.meritev;
  const [odmik, setOdmik] = useState(String(m.tolerance.odmik_x_mm));
  const [zasuk, setZasuk] = useState(String(m.tolerance.zasuk_deg));
  const [sirina, setSirina] = useState(String(m.tolerance.sirina_rel * 100));
  const [dE, setDE] = useState(String(m.tolerance.dE00_povprecje));
  const [reg, setReg] = useState(String(m.tolerance.registracija_mm));
  const [prX, setPrX] = useState(String(m.pricakovano.zgoraj_sredina_mm[0]));
  const [prY, setPrY] = useState(String(m.pricakovano.zgoraj_sredina_mm[1]));
  const [prS, setPrS] = useState(String(m.pricakovano.sirina_mm));
  const zacetnoStiri = Object.keys(m.oznake).length === 4;
  const [stiri, setStiri] = useState(zacetnoStiri);
  const [mapa, setMapa] = useState(nastavitve.mapaDnevnika);
  const [opis, setOpis] = useState(nastavitve.opisZModelom);
  const [sporocilo, setSporocilo] = useState("");
  const st = (v: string) => Number(v.replace(",", "."));
  const shrani = async () => {
    const r = await shraniNastavitveKontroleFn({
      data: {
        nastavitve: {
          meritev: {
            ...m,
            // postavitev oznak se zamenja SAMO ob spremembi stikala (stiri: postavitev iz nacrta; ena: privzeto iz prototipa);
            // sicer ostane shranjena (lahko rocno izmerjena), da sprememba tolerance ne prepise polozajev
            oznake: stiri === zacetnoStiri ? m.oznake : stiri ? STIRI_OZNAKE : PRIVZETA_MERITEV.oznake,
            obmocje_mm: stiri === zacetnoStiri ? m.obmocje_mm : stiri ? [-260, -90, 260, 520] : PRIVZETA_MERITEV.obmocje_mm,
            pricakovano: { zgoraj_sredina_mm: [st(prX), st(prY)], sirina_mm: st(prS) },
            tolerance: { ...m.tolerance, odmik_x_mm: st(odmik), odmik_y_mm: st(odmik), zasuk_deg: st(zasuk), sirina_rel: st(sirina) / 100, dE00_povprecje: st(dE), registracija_mm: st(reg) },
          },
          mapaDnevnika: mapa,
          opisZModelom: opis,
        },
      },
    }).catch(() => null);
    if (r?.ok) {
      setSporocilo(t("ktShranjeno"));
      onShranjeno();
    } else setSporocilo(`${t("ktNapacnaPolja")} ${r && !r.ok ? r.napake.join(", ") : ""}`);
  };
  const polje = (oznaka: string, v: string, set: (s: string) => void) => (
    <label className="grid gap-1 text-sm">
      {oznaka}
      <input value={v} onChange={(e) => set(e.target.value)} inputMode="decimal" maxLength={12} className={POLJE} />
    </label>
  );
  return (
    <form
      className="lina-kartica flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void shrani();
      }}
    >
      <h3><Ikona ime="nastavitve" /> {t("ktNastavitve")}</h3>
      <p className="text-sm text-[var(--color-moss)]">{t("ktDomneva")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {polje(t("ktTolOdmik"), odmik, setOdmik)}
        {polje(t("ktTolZasuk"), zasuk, setZasuk)}
        {polje(t("ktTolSirina"), sirina, setSirina)}
        {polje(t("ktTolDeltaE"), dE, setDE)}
        {polje(t("ktTolRegistracija"), reg, setReg)}
      </div>
      <fieldset className="grid gap-2 text-sm">
        <legend>{t("ktPricakovano")}</legend>
        <div className="grid grid-cols-3 gap-2">
          <input aria-label="X" value={prX} onChange={(e) => setPrX(e.target.value)} inputMode="decimal" className={POLJE} />
          <input aria-label="Y" value={prY} onChange={(e) => setPrY(e.target.value)} inputMode="decimal" className={POLJE} />
          <input aria-label={t("ktSirina")} value={prS} onChange={(e) => setPrS(e.target.value)} inputMode="decimal" className={POLJE} />
        </div>
      </fieldset>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4" checked={stiri} onChange={(e) => setStiri(e.target.checked)} />
        {t("ktStiriOznake")}
      </label>
      <div className="text-xs">
        <p>{t("ktPolozajiOznak")}</p>
        <ul className="font-mono">
          {Object.entries(m.oznake).map(([id, [x, y, s]]) => (
            <li key={id}>{`#${id}: X ${x} mm, Y ${y} mm, ${s} mm`}</li>
          ))}
        </ul>
      </div>
      <label className="grid gap-1 text-sm">
        {t("ktMapa")}
        <input value={mapa} onChange={(e) => setMapa(e.target.value)} maxLength={1024} spellCheck={false} autoComplete="off" className={POLJE} />
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4" checked={opis} onChange={(e) => setOpis(e.target.checked)} />
        {t("ktOpisStikalo")}
      </label>
      {sporocilo ? <p role="status" className="text-sm">{sporocilo}</p> : null}
      <button type="submit" className="lina-gumb-majhen self-start">{t("ktShrani")}</button>
    </form>
  );
}

export function KontrolaTiskaPanel() {
  const [stanje, setStanje] = useState<Stanje | null>(null);
  const [foto, setFoto] = useState<File | null>(null);
  const [prejeta, setPrejeta] = useState<{ id: string; b64: string } | null>(null);
  const [prejete, setPrejete] = useState<string[]>([]);
  // N8: brisanje prejetih v dveh korakih (prvi klik pokaze potrditev, sele drugi brise)
  const [potrdiCiscenje, setPotrdiCiscenje] = useState(false);
  const [ref, setRef] = useState<File | null>(null);
  const [vrsta, setVrsta] = useState<"motiv" | "prvi-kos">("motiv");
  const [nalog, setNalog] = useState("");
  const [zaposlen, setZaposlen] = useState(false);
  const [izid, setIzid] = useState<{ id: string; izid: IzidKontrole; slika: string | null } | null>(null);
  const [opis, setOpis] = useState("");
  const [napaka, setNapaka] = useState("");

  const osvezi = useCallback(() => {
    void stanjeKontroleTiskaFn()
      .then(setStanje)
      .catch(() => setNapaka(t("ktNapaka")));
    void prejeteSlikeKontroleFn()
      .then((r) => setPrejete(r.slike))
      .catch(() => setPrejete([]));
  }, []);
  useEffect(() => osvezi(), [osvezi]);

  const izmeri = async () => {
    if ((!foto && !prejeta) || !ref) return;
    setZaposlen(true);
    setNapaka("");
    setOpis("");
    try {
      const r = await izmeriTiskFn({ data: { fotografija: prejeta?.b64 ?? (foto ? await vBase64(foto) : ""), referenca: await vBase64(ref), vrstaReference: vrsta, nalog, imeReference: ref.name } });
      const s = r.slika ? (await oznacenaSlikaKontroleFn({ data: { id: r.id } })).png : null;
      setIzid({ id: r.id, izid: r.izid, slika: s });
      osvezi();
    } catch {
      setNapaka(t("ktNapaka"));
    } finally {
      setZaposlen(false);
    }
  };

  const namesti = async () => {
    setZaposlen(true);
    try {
      const r = await namestiKnjizniceVidaFn({ data: { soglasje: true } });
      if (!r.ok) setNapaka(`${t("ktNamestitevNapaka")}: ${r.razlog}`);
    } finally {
      setZaposlen(false);
      osvezi();
    }
  };

  const pdf = async () => {
    const r = await oznakePdfFn().catch(() => null);
    if (!r?.ok) return setNapaka(`${t("ktNapaka")}${r && !r.ok ? `: ${r.razlog}` : ""}`);
    const a = document.createElement("a");
    a.href = `data:application/pdf;base64,${r.pdf}`;
    a.download = "lina-oznake-aruco.pdf";
    a.click();
  };

  const opisi = async () => {
    if (!izid) return;
    const r = await opisiNapakeTiskaFn({ data: { id: izid.id } }).catch(() => null);
    setOpis(r?.ok ? r.besedilo : r ? r.razlog : "");
  };

  return (
    <div className="flex flex-col gap-4">
      <form
        className="lina-kartica flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void izmeri();
        }}
      >
        <h3><Ikona ime="kontrola" /> {t("ktNaslov")}</h3>
        <p className="text-sm text-[var(--color-moss)]">{t("ktOpis")}</p>
        {stanje && !stanje.knjiznice ? (
          <div role="status" className="grid gap-2 rounded-xl border border-[var(--color-rule)] p-3 text-sm">
            <p className="font-semibold">{t("ktKnjizniceManjkajo")}</p>
            <p>{t("ktSoglasjeOpis")}</p>
            {stanje.namestitev.napaka ? <p className="text-[var(--color-signal)]">{`${t("ktNamestitevNapaka")}: ${stanje.namestitev.napaka}`}</p> : null}
            <button type="button" className="lina-gumb-majhen self-start" disabled={zaposlen || stanje.namestitev.tece} onClick={() => void namesti()}>
              {zaposlen || stanje.namestitev.tece ? t("ktNamestitevTece") : t("ktNamesti")}
            </button>
          </div>
        ) : null}
        <label className="grid gap-1 text-sm">
          {t("ktFotografija")}
          <input
            type="file"
            accept="image/jpeg,image/png"
            onChange={(e) => {
              setFoto(e.target.files?.[0] ?? null);
              setPrejeta(null);
            }}
            className="text-sm"
          />
        </label>
        {prejeta ? <p className="text-xs">{t("ktIzbranaPrejeta")} <span className="font-mono">{prejeta.id}</span></p> : null}
        {prejete.length ? <p className="text-xs text-[var(--color-moss)]">{t("ktTelefon")}</p> : null}
        {prejete.length ? (
          <label className="grid gap-1 text-sm">
            {t("ktPrejete")}
            <select
              className={POLJE}
              value={prejeta?.id ?? ""}
              onChange={(e) => {
                const id = e.target.value;
                if (!id) return setPrejeta(null);
                void prejetaSlikaKontroleFn({ data: { id } }).then((r) => setPrejeta(r.slika ? { id, b64: r.slika } : null));
              }}
            >
              <option value="">–</option>
              {prejete.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </label>
        ) : null}
        {prejete.length ? (
          <button
            type="button"
            className="lina-gumb-majhen self-start"
            disabled={zaposlen}
            onClick={() => {
              if (!potrdiCiscenje) return setPotrdiCiscenje(true);
              setPotrdiCiscenje(false);
              void pocistiPrejeteKontroleFn({ data: { potrditev: true } })
                .then((r) => {
                  if (!r.ok) return;
                  setPrejeta(null);
                  osvezi();
                })
                .catch(() => setNapaka(t("ktNapaka")));
            }}
            onBlur={() => setPotrdiCiscenje(false)}
          >
            {potrdiCiscenje ? t("ktPocistiPotrdi") : t("ktPocistiPrejete")}
          </button>
        ) : null}
        <fieldset className="grid gap-1 text-sm">
          <legend>{t("ktReferenca")}</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="kt-vrsta" checked={vrsta === "motiv"} onChange={() => setVrsta("motiv")} />
            {t("ktVrstaMotiv")}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="kt-vrsta" checked={vrsta === "prvi-kos"} onChange={() => setVrsta("prvi-kos")} />
            {t("ktVrstaPrviKos")}
          </label>
          <input type="file" accept="image/png,image/jpeg" aria-label={t("ktReferenca")} onChange={(e) => setRef(e.target.files?.[0] ?? null)} className="text-sm" />
        </fieldset>
        <label className="grid gap-1 text-sm">
          {t("ktNalog")}
          <input value={nalog} onChange={(e) => setNalog(e.target.value)} maxLength={80} autoComplete="off" className={POLJE} />
        </label>
        {napaka ? <p role="alert" className="text-sm text-[var(--color-signal)]">{napaka}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={zaposlen || (!foto && !prejeta) || !ref || !stanje?.knjiznice} className="rounded-full bg-[var(--color-signal)] px-5 py-2 text-sm text-[var(--color-on-ink)] disabled:opacity-50">
            {zaposlen ? t("ktMerim") : t("ktIzmeri")}
          </button>
          <button type="button" className="lina-gumb-majhen" disabled={!stanje?.knjiznice} onClick={() => void pdf()}>
            {t("ktPdf")}
          </button>
        </div>
        <p className="text-xs">{t("ktPdfOpomba")}</p>
        {izid ? <Izid izid={izid.izid} slika={izid.slika} opis={opis} /> : null}
        {izid?.slika && stanje?.nastavitve.opisZModelom ? (
          <div className="grid gap-1">
            <button type="button" className="lina-gumb-majhen self-start" onClick={() => void opisi()}>{t("ktOpisi")}</button>
            <p className="text-xs">{t("ktOpisOpomba")}</p>
          </div>
        ) : null}
      </form>
      {stanje ? <NastavitveKartica key={JSON.stringify(stanje.nastavitve)} nastavitve={stanje.nastavitve} onShranjeno={osvezi} /> : null}
      <section className="lina-kartica flex flex-col gap-2" aria-label={t("ktDnevnik")}>
        <h3><Ikona ime="dnevnik" /> {t("ktDnevnik")}</h3>
        {stanje?.dnevnik.mapa ? <p className="break-all font-mono text-xs">{stanje.dnevnik.mapa}</p> : null}
        {stanje?.dnevnik.zapisi.length ? (
          <ul className="text-sm">
            {stanje.dnevnik.zapisi.map((z) => (
              <li key={z.id} className="py-1">
                <span className="font-mono text-xs">{z.cas ? datumInUra(new Date(z.cas)) : ""}</span> · {z.nalog || z.referenca}{z.narocilo?.stranka ? ` · ${z.narocilo.stranka}` : ""} ·{" "}
                <span className={z.izid.ocena === "OK" ? "text-[var(--color-moss)]" : "text-[var(--color-signal)]"}>{z.izid.ocena}</span>
                {z.izid.polozaj ? ` · X ${mm(z.izid.polozaj.odmik_x_mm)} · Y ${mm(z.izid.polozaj.odmik_y_mm)}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">{t("ktDnevnikPrazen")}</p>
        )}
      </section>
    </div>
  );
}
