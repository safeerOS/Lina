import { useCallback, useEffect, useState } from "react";
import {
  dnevnaMotivacijaFn,
  izbrisiSpominPogovorovFn,
  nastaviSpominPogovorovFn,
  spominPogovorovFn,
  samoucenjeFn,
  nastaviSamoucenjeFn,
  pozabiTemoFn,
  pozabiVseSamoucenjeFn,
  generirajSlikoFn,
  generirajVideoFn,
  knjiznicaSlikFn,
  medijPodatkiFn,
  nastaviCiscenjeKlicevFn,
  nastaviMotivacijoFn,
  nastavitveZvokaFn,
} from "@/lib/lina/functions.ts";
import { t2 } from "./besedila.ts";

/**
 * Lina 2.0, 22. 11. 2026: okno Slike in video (generator Imagen/Veo iz slike-generator.server.ts in video-generator.server.ts),
 * kartica dnevne motivacije (Domov) in stikalo cistenja zvoka klicev (Nastavitve). Vse samo za lastnika; strezniske funkcije
 * so v functions.ts. Slike in video se berejo kot data URL na zahtevo (medijPodatkiFn), nikoli v klicih tajnice.
 */

type Zapis = { id: string; serija: string; cas: string; opis: string; prevedeno: boolean; vrsta?: "video"; sekund?: number };

const RAZMERJA_SLIKE = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;
const RAZMERJA_VIDEA = ["16:9", "9:16"] as const;
const DOLZINE = [4, 6, 8] as const;
const OZNAKA = "flex flex-col gap-1 text-sm";
const POLJE = "rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2";

function sporocilo(e: unknown): string {
  return e instanceof Error && e.message ? e.message : t2("medNapaka");
}

export function MedijiPanel() {
  const [video, setVideo] = useState(false);
  const [opis, setOpis] = useState("");
  const [stevilo, setStevilo] = useState(1);
  const [razmerje, setRazmerje] = useState<string>("1:1");
  const [sekund, setSekund] = useState<number>(8);
  const [zvok, setZvok] = useState(true);
  const [serija, setSerija] = useState<string | null>(null);
  const [zasedeno, setZasedeno] = useState(false);
  const [napaka, setNapaka] = useState("");
  const [zavrnjenih, setZavrnjenih] = useState(0);
  const [zapisi, setZapisi] = useState<Zapis[] | null>(null);
  const [podatki, setPodatki] = useState<Record<string, { mime: string; url: string } | "napaka" | "nalagam">>({});

  const osvezi = useCallback(async () => {
    try {
      setZapisi((await knjiznicaSlikFn()).slike as Zapis[]);
    } catch {
      setZapisi([]);
    }
  }, []);
  useEffect(() => {
    void osvezi();
  }, [osvezi]);

  const nalozi = useCallback(async (id: string) => {
    setPodatki((p) => ({ ...p, [id]: "nalagam" }));
    try {
      const m = await medijPodatkiFn({ data: { id } });
      setPodatki((p) => ({ ...p, [id]: { mime: m.mime, url: m.podatki } }));
    } catch {
      setPodatki((p) => ({ ...p, [id]: "napaka" }));
    }
  }, []);

  function preklopiVrsto(v: boolean) {
    setVideo(v);
    setRazmerje(v ? "16:9" : "1:1");
  }

  async function ustvari() {
    setNapaka("");
    setZavrnjenih(0);
    setZasedeno(true);
    try {
      if (video) {
        const z = await generirajVideoFn({ data: { opis, sekund, razmerje, zvok, serija: serija ?? undefined } });
        setSerija(z.serija);
        await osvezi();
        void nalozi(z.id);
      } else {
        const izid = await generirajSlikoFn({ data: { opis, stevilo, razmerje, serija: serija ?? undefined } });
        setZavrnjenih(izid.zavrnjenih);
        if (izid.slike[0]) setSerija(izid.slike[0].serija);
        await osvezi();
        for (const s of izid.slike) void nalozi(s.id);
      }
    } catch (e) {
      setNapaka(sporocilo(e));
    } finally {
      setZasedeno(false);
    }
  }

  const razmerja = video ? RAZMERJA_VIDEA : RAZMERJA_SLIKE;

  return (
    <section className="mt-5 grid max-w-6xl gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]" aria-label={t2("medNaslov")}>
      <form
        className="flex flex-col gap-4 self-start rounded-3xl bg-[var(--color-sheet)] p-5 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void ustvari();
        }}
      >
        <h2 className="display text-2xl">{t2("medNaslov")}</h2>
        <p className="text-sm text-[var(--color-moss)]">{t2("medNamig")}</p>
        <fieldset className="flex gap-2" aria-label={t2("medVrsta")}>
          {[false, true].map((v) => (
            <label key={String(v)} className="lina-izbira">
              <input type="radio" name="med-vrsta" checked={video === v} onChange={() => preklopiVrsto(v)} className="sr-only" />
              <span>{v ? t2("medVideo") : t2("medSlika")}</span>
            </label>
          ))}
        </fieldset>
        <label className={OZNAKA}>
          {t2("medOpis")}
          <textarea value={opis} maxLength={2000} rows={4} placeholder={t2("medOpisNamig")} onChange={(e) => setOpis(e.target.value)} className={`${POLJE} resize-y`} />
        </label>
        <label className={OZNAKA}>
          {t2("medRazmerje")}
          <select value={razmerje} onChange={(e) => setRazmerje(e.target.value)} className={POLJE}>
            {razmerja.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        {video ? (
          <>
            <label className={OZNAKA}>
              {t2("medDolzina")}
              <select value={sekund} onChange={(e) => setSekund(Number(e.target.value))} className={POLJE}>
                {DOLZINE.map((d) => (
                  <option key={d} value={d}>
                    {d} {t2("medSekund")}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={zvok} onChange={(e) => setZvok(e.target.checked)} />
              {t2("medZvok")}
            </label>
          </>
        ) : (
          <label className={OZNAKA}>
            {t2("medStevilo")}
            <select value={stevilo} onChange={(e) => setStevilo(Number(e.target.value))} className={POLJE}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        {serija ? (
          <p className="flex items-center gap-2 text-xs text-[var(--color-brass)]">
            {t2("medNizAktiven")}
            <button type="button" className="rounded-full px-3 py-1 text-xs text-[var(--color-signal)] hover:bg-[var(--color-surface)]" onClick={() => setSerija(null)}>
              {t2("medNizPrekini")}
            </button>
          </p>
        ) : null}
        {napaka ? (
          <p role="alert" className="text-sm text-[var(--color-signal)]">
            {napaka}
          </p>
        ) : null}
        {zavrnjenih > 0 ? (
          <p role="status" className="text-sm text-[var(--color-brass)]">
            {t2("medZavrnjenih")} {zavrnjenih}
          </p>
        ) : null}
        {zasedeno && video ? <p className="text-xs text-[var(--color-moss)]">{t2("medVideoCaka")}</p> : null}
        <button type="submit" disabled={zasedeno || !opis.trim()} className="self-start rounded-full bg-[var(--color-ink)] px-6 py-2.5 text-sm text-[var(--color-on-ink)] disabled:opacity-50">
          {zasedeno ? t2("medUstvarjam") : t2("medUstvari")}
        </button>
      </form>

      <div className="min-w-0 rounded-3xl bg-[var(--color-sheet)] p-5 sm:p-6">
        <h3 className="display text-xl">{t2("medKnjiznica")}</h3>
        {zapisi && zapisi.length === 0 ? <p className="mt-3 text-sm text-[var(--color-brass)]">{t2("medPrazno")}</p> : null}
        <ul className="lina-med-mreza mt-3">
          {(zapisi ?? []).map((z) => {
            const p = podatki[z.id];
            return (
              <li key={z.id} className="lina-med-kartica">
                <div className="lina-med-okvir">
                  {p && p !== "napaka" && p !== "nalagam" ? (
                    p.mime.startsWith("video/") ? (
                      <video src={p.url} controls preload="metadata" />
                    ) : (
                      <img src={p.url} alt={z.opis} />
                    )
                  ) : p === "napaka" ? (
                    <span className="text-xs text-[var(--color-signal)]">{t2("medNalaganjeNapaka")}</span>
                  ) : (
                    <button type="button" className="rounded-full px-3 py-1 text-xs hover:bg-[var(--color-surface)]" disabled={p === "nalagam"} onClick={() => void nalozi(z.id)}>
                      {p === "nalagam" ? t2("medNaklada") : `${t2("medPrikazi")} ${z.vrsta === "video" ? t2("medVideo").toLowerCase() : t2("medSlika").toLowerCase()}`}
                    </button>
                  )}
                </div>
                <p className="lina-med-opis" title={z.opis}>
                  {z.opis}
                </p>
                <p className="flex items-center justify-between gap-2 text-xs text-[var(--color-brass)]">
                  <span>{z.vrsta === "video" ? `${t2("medVideo")} · ${z.sekund ?? ""} ${t2("medSekund")}` : t2("medSlika")}</span>
                  <button type="button" className="rounded-full px-2 py-0.5 hover:bg-[var(--color-surface)]" onClick={() => setSerija(z.serija)}>
                    {t2("medNiz")}
                  </button>
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

type PogledMotivacije = Awaited<ReturnType<typeof dnevnaMotivacijaFn>>;

/** Kartica na Domovu: misel dneva (jutro, po 17. uri vecer). Ob napaki ali izklopu ostane stalno besedilo (podano kot `rezerva`). */
export function MotivacijaBesedilo({ rezerva }: { rezerva: string }) {
  const [pogled, setPogled] = useState<PogledMotivacije | null>(null);
  useEffect(() => {
    let zivo = true;
    dnevnaMotivacijaFn()
      .then((p) => {
        if (zivo) setPogled(p);
      })
      .catch(() => undefined);
    return () => {
      zivo = false;
    };
  }, []);
  async function nastavi(vklopljena: boolean) {
    try {
      await nastaviMotivacijoFn({ data: { popravek: { vklopljena } } });
      setPogled(await dnevnaMotivacijaFn());
    } catch {
      /* ostane staro stanje */
    }
  }
  if (!pogled) return <em>{rezerva}</em>;
  if (!pogled.nastavitve.vklopljena) {
    return (
      <span className="lina-mot">
        <em>{rezerva}</em>
        <button type="button" className="lina-mot-gumb" onClick={() => void nastavi(true)}>
          {t2("motStikalo")}
        </button>
      </span>
    );
  }
  const m = pogled.vecer ?? pogled.jutro;
  if (!m) return <em>{rezerva}</em>;
  return (
    <span className="lina-mot">
      <small>
        {t2("motNaslov")} · {m.del === "vecer" ? t2("motVecer") : t2("motJutro")}
      </small>
      <em>{m.besedilo}</em>
      <button type="button" className="lina-mot-gumb" onClick={() => void nastavi(false)}>
        {t2("motStikalo")}: ✓
      </button>
    </span>
  );
}

/** Stikalo v Nastavitvah: ciscenje zvoka klicev (privzeto vklopljeno, izklop vedno na voljo). */
export function CiscenjeZvokaStikalo({ razred }: { razred: string }) {
  const [vklop, setVklop] = useState<boolean | null>(null);
  const [napaka, setNapaka] = useState(false);
  useEffect(() => {
    let zivo = true;
    nastavitveZvokaFn()
      .then((n) => {
        if (zivo) setVklop(n.ciscenjeKlicev);
      })
      .catch(() => undefined);
    return () => {
      zivo = false;
    };
  }, []);
  async function spremeni(nov: boolean) {
    setNapaka(false);
    const prej = vklop;
    setVklop(nov);
    try {
      setVklop((await nastaviCiscenjeKlicevFn({ data: { vklop: nov } })).ciscenjeKlicev);
    } catch {
      setVklop(prej);
      setNapaka(true);
    }
  }
  if (vklop === null) return null;
  return (
    <div className="mt-4">
      <label className={razred}>
        <input type="checkbox" checked={vklop} onChange={(e) => void spremeni(e.target.checked)} />
        {t2("zvokCiscenje")}
      </label>
      <p className="mt-1 text-xs text-[var(--color-moss)]">{t2("zvokCiscenjeOpis")}</p>
      {napaka ? (
        <p role="alert" className="text-xs text-[var(--color-signal)]">
          {t2("zvokNapaka")}
        </p>
      ) : null}
    </div>
  );
}

/** Stikalo v Nastavitvah: spomin pogovorov (lastnik 22. 11. 2026: privzeto vklopljeno, brez potrjevanja) in brisanje z dvostopenjsko potrditvijo. */
export function SpominPogovorovStikalo({ razred }: { razred: string }) {
  const [vklop, setVklop] = useState<boolean | null>(null);
  const [potrdi, setPotrdi] = useState(false);
  const [sporocilo, setSporocilo] = useState("");
  useEffect(() => {
    let zivo = true;
    spominPogovorovFn()
      .then((n) => {
        if (zivo) setVklop(n.vklopljen);
      })
      .catch(() => undefined);
    return () => {
      zivo = false;
    };
  }, []);
  async function spremeni(nov: boolean) {
    setSporocilo("");
    const prej = vklop;
    setVklop(nov);
    try {
      setVklop((await nastaviSpominPogovorovFn({ data: { vklop: nov } })).vklopljen);
    } catch {
      setVklop(prej);
      setSporocilo(t2("spominNapaka"));
    }
  }
  async function izbrisi() {
    setPotrdi(false);
    try {
      await izbrisiSpominPogovorovFn();
      setSporocilo(t2("spominIzbrisano"));
    } catch {
      setSporocilo(t2("spominNapaka"));
    }
  }
  if (vklop === null) return null;
  return (
    <div className="mt-4">
      <label className={razred}>
        <input type="checkbox" checked={vklop} onChange={(e) => void spremeni(e.target.checked)} />
        {t2("spominNaslov")}
      </label>
      <p className="mt-1 text-xs text-[var(--color-moss)]">{t2("spominOpis")}</p>
      {potrdi ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {t2("spominPotrdi")}
          <button type="button" className="rounded-full px-3 py-1 text-[var(--color-signal)] hover:bg-[var(--color-surface)]" onClick={() => void izbrisi()}>
            {t2("spominDa")}
          </button>
          <button type="button" className="rounded-full px-3 py-1 hover:bg-[var(--color-surface)]" onClick={() => setPotrdi(false)}>
            {t2("spominNe")}
          </button>
        </p>
      ) : (
        <button type="button" className="mt-2 rounded-full px-3 py-1 text-xs text-[var(--color-signal)] hover:bg-[var(--color-surface)]" onClick={() => setPotrdi(true)}>
          {t2("spominIzbrisi")}
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

/** Stikalo v Nastavitvah: samoucenje Line (lastnik 22. 11. 2026: privzeto vklopljeno), seznam naucenih tem, pozabi posamezno ali vse. */
export function SamoucenjeStikalo({ razred }: { razred: string }) {
  const [s, setS] = useState<{ vklopljen: boolean; teme: Array<{ tema: string; poglavij: number }> } | null>(null);
  const [potrdi, setPotrdi] = useState(false);
  const [sporocilo, setSporocilo] = useState("");
  useEffect(() => {
    let zivo = true;
    samoucenjeFn()
      .then((n) => {
        if (zivo) setS(n);
      })
      .catch(() => undefined);
    return () => {
      zivo = false;
    };
  }, []);
  async function osvezi(sporoc = "") {
    try {
      setS(await samoucenjeFn());
      setSporocilo(sporoc);
    } catch {
      setSporocilo(t2("uciNapaka"));
    }
  }
  async function spremeni(nov: boolean) {
    setSporocilo("");
    try {
      await nastaviSamoucenjeFn({ data: { vklop: nov } });
      await osvezi();
    } catch {
      setSporocilo(t2("uciNapaka"));
    }
  }
  async function pozabi(tema?: string) {
    setPotrdi(false);
    try {
      if (tema) await pozabiTemoFn({ data: { tema } });
      else await pozabiVseSamoucenjeFn();
      await osvezi(t2("uciIzbrisano"));
    } catch {
      setSporocilo(t2("uciNapaka"));
    }
  }
  if (s === null) return null;
  return (
    <div className="mt-4">
      <label className={razred}>
        <input type="checkbox" checked={s.vklopljen} onChange={(e) => void spremeni(e.target.checked)} />
        {t2("uciNaslov")}
      </label>
      <p className="mt-1 text-xs text-[var(--color-moss)]">{t2("uciOpis")}</p>
      {s.teme.length === 0 ? <p className="mt-1 text-xs">{t2("uciPrazno")}</p> : null}
      <ul className="mt-1 grid gap-1 text-xs">
        {s.teme.map((x) => (
          <li key={x.tema} className="flex items-center gap-2">
            <span>
              {x.tema} ({x.poglavij})
            </span>
            <button type="button" className="rounded-full px-3 py-1 text-[var(--color-signal)] hover:bg-[var(--color-surface)]" onClick={() => void pozabi(x.tema)}>
              {t2("uciPozabi")}
            </button>
          </li>
        ))}
      </ul>
      {s.teme.length > 0 ? (
        potrdi ? (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {t2("uciPotrdi")}
            <button type="button" className="rounded-full px-3 py-1 text-[var(--color-signal)] hover:bg-[var(--color-surface)]" onClick={() => void pozabi()}>
              {t2("spominDa")}
            </button>
            <button type="button" className="rounded-full px-3 py-1 hover:bg-[var(--color-surface)]" onClick={() => setPotrdi(false)}>
              {t2("spominNe")}
            </button>
          </p>
        ) : (
          <button type="button" className="mt-2 rounded-full px-3 py-1 text-xs text-[var(--color-signal)] hover:bg-[var(--color-surface)]" onClick={() => setPotrdi(true)}>
            {t2("uciPozabiVse")}
          </button>
        )
      ) : null}
      {sporocilo ? (
        <p role="status" className="text-xs text-[var(--color-brass)]">
          {sporocilo}
        </p>
      ) : null}
    </div>
  );
}
