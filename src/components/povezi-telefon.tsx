import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/lina/besedila.ts";
import { idVSkupinah } from "@/lib/lina/id-naprave.ts";
import {
  odkleniPovezovanjeFn, odlociSeznanitevFn, prekliciSeznanitevFn, potrdiIdSeznanitveFn, odstraniNapravoFn, shraniAsistentaFn, stanjeAsistentaFn, vnesiKodoTelefonaFn, zacniSeznanitevFn,
  zacniSeznanitevSKodoFn, zapriSeznanitevSKodoFn,
} from "@/lib/lina/functions.ts";

type Stanje = Awaited<ReturnType<typeof stanjeAsistentaFn>>;
type Povabilo = Awaited<ReturnType<typeof zacniSeznanitevFn>>;

/** Id telefona v skupinah po 4 (isti niz kot na telefonu, T6-04): lastnik pri »Dodaj« ne zaupa samo imenu. */
function IdTelefona({ id }: { id: string }) {
  const niz = idVSkupinah(id);
  // N2: neveljaven id se nikoli ne pokaze surov (bidi, nicelna sirina, cirilica ... bi ga naredili podobnega pravemu); opozorilo
  // namesto njega, gumb »Dodaj« pa je blokiran (idTelefonaVeljaven).
  if (niz === null) return <p role="alert" className="text-sm text-[var(--color-signal)]">{t("telIdNeveljaven")}</p>;
  return (
    <p className="text-sm">
      {t("telIdPreveri")}{" "}
      <strong className="font-mono text-lg tracking-wider" aria-label={niz.split("").join(" ")}>{niz}</strong>
    </p>
  );
}

/** Razlog, zakaj QR in koda se nista na voljo (null = sta na voljo); besedilo v jeziku vmesnika. */
export function razlogBrezKode(s: Stanje | null, povabilo: Povabilo | null): string | null {
  if (!s) return t("telPripravljam");
  if (!s.vklop) return t("telIzklopljeno");
  // naloga 21 (N2): na neodobrenem omrezju (N1) ni kode in ni QR - napis pove zakaj, ne »se pripravlja«
  if (s.napakaKoda === "omrezje") return t("telNeodobrenoOmrezje");
  if (s.samoGlobalLink) return t("telSamoGlobalLink");
  if (!s.tece) return s.napakaKoda ? `${t(`telNapaka_${s.napakaKoda}`)} ${t("telPoskusamZnova")}` : t("telZaganjam");
  if (!povabilo || !s.sKodo.odprto) return s.sKodo.zaprtoSe ? null : t("telPripravljam");
  return null;
}

export type PovezavaPloscaLastnosti = {
  s: Stanje | null;
  povabilo: Povabilo | null;
  zaposlen: boolean;
  kodaTel: Record<string, string>;
  onKodaTel: (pairId: string, vrednost: string) => void;
  onPotrdiKodo: (pairId: string) => void;
  onOdkleni: () => void;
  onVklopi: () => void;
  onDodaj: (c: { koda: string; id: string }) => void;
  onZavrni: (koda: string) => void;
  /** Napaka zadnjega dejanja ali samodejnega QR/kode (pregled 16): vidna ob QR, ne na dnu leve kartice. */
  napaka?: string;
};

/** Naslov zanke (enako kot naslovZanke v zasebno-omrezje.server.ts, ki ga odjemalec ne sme uvoziti). */
const ZANKA = /^(127\.0\.0\.1|::1|localhost)$/;
const GUMB = "w-fit rounded-xl border border-[var(--color-rule)] px-4 py-2 text-sm disabled:opacity-50";
const POLJE = "mt-1 w-full rounded-xl border border-[var(--color-rule)] bg-[var(--color-sheet)] text-[var(--color-ink)] px-3 py-2";
const GUMB_MAJHEN = "w-fit rounded-xl border border-[var(--color-rule)] px-3 py-1 text-sm disabled:opacity-50";
const POLJE_KODE = "w-28 rounded-xl border border-[var(--color-rule)] bg-[var(--color-sheet)] text-[var(--color-ink)] px-3 py-1.5 tracking-widest disabled:opacity-60";

/**
 * Naloga 16 (lastnik 25. 11. 2026: »vedno naj kaže QR kodo in 6-mestno kodo, prikaz in vnos«; »postavitev naj bo ob strani, kjer je
 * prostor«): QR, koda tega racunalnika in vnos kode s telefona so VEDNO na zaslonu, drug ob drugem v desnem stolpcu, kot seznanitev
 * Safeer Linka. Ko del za telefon ne tece, je na mestu QR in kode jasen razlog; Lina poskusa sama in oboje se pokaze samo.
 */
export function PovezavaPlosca({ s, povabilo, zaposlen, kodaTel, onKodaTel, onPotrdiKodo, onOdkleni, onVklopi, onDodaj, onZavrni, napaka = "" }: PovezavaPloscaLastnosti) {
  const razlog = razlogBrezKode(s, povabilo);
  const qr = s?.tece && povabilo ? povabilo : null;
  const koda = s?.tece && s.sKodo.odprto ? s.sKodo.koda : "";
  const cakajoKodo = s?.tece ? s.sKodo.cakajoKodo : [];
  return (
    <section aria-labelledby="pt-povezava" className="grid content-start gap-3 rounded-3xl bg-[var(--color-sheet)] p-4" data-povezava-plosca="1">
      <h3 id="pt-povezava" className="text-lg">{t("telPovezavaNaslov")}</h3>
      {razlog ? (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--color-signal)]">
          <p>{razlog}</p>
          {s && !s.vklop ? <button type="button" disabled={zaposlen} className={GUMB_MAJHEN} onClick={onVklopi}>{t("telVklopiPovezavo")}</button> : null}
        </div>
      ) : null}
      {napaka ? <p role="alert" className="text-sm text-[var(--color-signal)]">{napaka}</p> : null}
      {s && s.cakajo.map((c) => {
        // N5d: tudi clan ozjega kroga Safeer Linka vidi id in ga potrdi (telefon za Lino vedno zahteva dotik »ID se ujema«, zato bi
        // bilo potrjevanje brez primerjave slepo); opomba samo pove, zakaj. Streznik preskoka ne dovoli (PRESKOK_PRIMERJAVE_ZA_CLANE).
        const clan = s.ozjiKrog.includes(c.koda);
        return (
        <div key={c.koda} role="group" aria-label={t("telCaka")} className="grid gap-1 rounded-xl border border-[var(--color-rule)] p-3 text-sm">
          <p>{t("telCaka")}: <strong>{c.ime}</strong></p>
          {clan ? <p className="text-sm text-[var(--color-moss)]">{t("telClanPrimerjaj")}</p> : null}
          <IdTelefona id={c.id} />
          <div className="flex gap-2">
            <button type="button" disabled={zaposlen || idVSkupinah(c.id) === null} className={GUMB} onClick={() => onDodaj(c)}>
              {t("telIdSeDujemaDodaj")}
            </button>
            <button type="button" disabled={zaposlen} className={GUMB} onClick={() => onZavrni(c.koda)}>
              {t("telZavrni")}
            </button>
          </div>
        </div>
        );
      })}
      <div className="grid items-start gap-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
        <figure className="grid content-start gap-2" data-del="qr">
          {qr ? (
            // SVG iz lastnega kodirnika (qr.ts): samo pravokotniki, brez skript
            <div role="img" aria-label={t("telQrOznaka")} className="lina-qr w-[11rem] max-w-full rounded-xl bg-white p-2 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr.svg }} />
          ) : (
            <div role="img" aria-label={t("telQrNiNaVoljo")} className="grid aspect-square w-[11rem] max-w-full place-items-center rounded-xl border-2 border-dashed border-[var(--color-rule)] p-3 text-center text-xs text-[var(--color-moss)]">
              {t("telQrNiNaVoljo")}
            </div>
          )}
          <figcaption className="text-xs text-[var(--color-moss)]">
            {t("telQrRazlaga")} {qr ? (qr.klici ? t("telQrKlici") : t("telQrBrezKlicev")) : null}
          </figcaption>
          {qr?.opozorilo ? <p role="alert" className="text-sm text-[var(--color-signal)]">{qr.opozorilo}</p> : null}
        </figure>
        <div className="grid content-start gap-3">
          <div className="grid gap-1 text-sm" data-del="koda">
            <p className="font-medium">{t("telKodaRacunalnika")}</p>
            {/* koda v dveh skupinah po tri, bralnik zaslona jo prebere po stevkah */}
            {koda ? (
              <p className="text-3xl tracking-widest" aria-label={koda.split("").join(" ")}>{koda.slice(0, 3)} {koda.slice(3)}</p>
            ) : (
              <p className="text-3xl tracking-widest text-[var(--color-moss)]" aria-label={t("telKodaNiNaVoljo")}>––– –––</p>
            )}
            <p className="text-xs text-[var(--color-moss)]">{t("telKodaRazlaga")}</p>
            {s?.tece && s.sKodo.oglas ? <p>{t("telKodaOglas")} <strong>{s.sKodo.oglas}</strong></p> : null}
            {s?.tece && s.sKodo.zaprtoSe ? (
              <div className="grid gap-2">
                <p role="status" className="text-[var(--color-signal)]">{t("telKodaZaprto")} {Math.ceil(s.sKodo.zaprtoSe / 60)}</p>
                <button type="button" disabled={zaposlen} className={GUMB} onClick={onOdkleni}>{t("telOdkleni")}</button>
              </div>
            ) : null}
          </div>
          {s?.tece && s.sKodo.cakajoKodo.map((c) => (
            <form
              key={c.pairId}
              className="grid gap-1 rounded-xl border border-[var(--color-rule)] p-2 text-sm"
              data-del="vnos"
              onSubmit={(e) => {
                e.preventDefault();
                onPotrdiKodo(c.pairId);
              }}
            >
              <p>{t("telKodaCaka")}: <strong>{c.ime}</strong></p>
              <IdTelefona id={c.id} />
              {c.napacna ? <p role="alert" className="text-[var(--color-signal)]">{t("telKodaNapacna")}</p> : null}
              <label htmlFor={`pt-koda-${c.pairId}`}>{t("telKodaVnesi")}</label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id={`pt-koda-${c.pairId}`}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  value={kodaTel[c.pairId] ?? ""}
                  onChange={(e) => onKodaTel(c.pairId, e.target.value)}
                  className={POLJE_KODE}
                />
                <button type="submit" disabled={zaposlen || idVSkupinah(c.id) === null || !/^\d{3}\s?\d{3}$/.test(kodaTel[c.pairId] ?? "")} className={GUMB_MAJHEN}>{t("telKodaPotrdi")}</button>
              </div>
            </form>
          ))}
          {cakajoKodo.length === 0 ? (
            <form className="grid gap-1 rounded-xl border border-[var(--color-rule)] p-2 text-sm" data-del="vnos" onSubmit={(e) => e.preventDefault()}>
              <label htmlFor="pt-koda-prazno">{t("telKodaVnesi")}</label>
              <div className="flex flex-wrap items-center gap-2">
                <input id="pt-koda-prazno" inputMode="numeric" autoComplete="one-time-code" maxLength={7} disabled aria-describedby="pt-koda-prazno-namig" className={POLJE_KODE} />
                <button type="submit" disabled className={GUMB_MAJHEN}>{t("telKodaPotrdi")}</button>
              </div>
              <p id="pt-koda-prazno-namig" className="text-xs text-[var(--color-moss)]">{t("telKodaVnosNamig")}</p>
            </form>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** Pred potekom QR (10 min) ga zamenjamo z novim; rezerva, da telefon ne skenira kode tik pred iztekom. */
const QR_PREJ_MS = 30_000;
/** Po neuspelem samodejnem poskusu (QR, okno s kodo) najprej cez toliko casa znova, da zaslon ne udarja po strezniku. */
const PREMOR_PO_NAPAKI_MS = 15_000;
/** Po toliko zaporednih neuspehih samodejnega QR ali kode zaslon pokaze napako streznika (prej je kazal »se pripravlja«). */
const NAPAK_DO_PRIKAZA = 2;

/**
 * Zaslon »Poveži telefon« (lastnik 14. 11. 2026): en QR za obe poti (klici OpenLine in asistentka), potrditev telefona z enim
 * gumbom (ime in id n-...). Privzeto izklopljeno; naslov samo izmed zasebnih naslovov tega racunalnika.
 * Naloga 16: levo nastavitve, desno (PovezavaPlosca) QR, koda in vnos kode, brez gumba »Pokaži kodo QR«: QR in okno s kodo se
 * odpreta sama, dokler je zaslon odprt (ob zapustitvi se okno s kodo zapre - oglas mDNS ne ostane), in se osvezita sama.
 */
export function PoveziTelefon({ onError }: { onError: (m: string) => void }) {
  const [s, setS] = useState<Stanje | null>(null);
  const [naslov, setNaslov] = useState("");
  const [vrata, setVrata] = useState("");
  const [povabilo, setPovabilo] = useState<(Povabilo & { do: number; kljuc: string }) | null>(null);
  const [zaposlen, setZaposlen] = useState(false);
  const [lokalna, setLokalna] = useState("");
  const [kodaTel, setKodaTel] = useState<Record<string, string>>({});
  const [zdaj, setZdaj] = useState(() => Date.now());
  const premorDo = useRef({ qr: 0, koda: 0 });
  const vTeku = useRef({ qr: false, koda: false, zagon: false });
  // pregled 16 (1): odgovor, ki pride po zapustitvi zaslona, ne sme pustiti odprtega okna s kodo ali pisati v stanje
  const ziv = useRef(true);
  // CRR2: koda QR, ki ga kaze TA zaslon; ob odhodu se preklice samo ta (QR drugega zaslona ostane veljaven)
  const mojQr = useRef("");
  const neuspehov = useRef({ qr: 0, koda: 0 });

  function prevzemi(x: Stanje) {
    setS(x);
    setNaslov(x.naslov);
    setVrata(String(x.vrata));
  }

  useEffect(() => {
    void stanjeAsistentaFn().then(prevzemi).catch(() => setS(null));
  }, []);

  // naloga 15: Lina je sama presla na nov naslov -> izbira v obrazcu sledi (sicer bi naslednje stikalo poslalo stari naslov)
  useEffect(() => {
    if (s?.naslov) setNaslov(s.naslov);
  }, [s?.naslov]);

  // med cakanjem na telefon osvezi stanje (prijava telefona, seja Claude Code)
  useEffect(() => {
    if (!s?.vklop) return;
    const i = setInterval(() => {
      setZdaj(Date.now());
      void stanjeAsistentaFn().then(setS).catch(() => undefined);
    }, 3000);
    return () => clearInterval(i);
  }, [s?.vklop]);

  // naloga 16: vklopljeno, a ne tece -> en takojsen poskus zagona (streznik nato poskusa sam vsakih 30 s, zaslon se osvezuje)
  useEffect(() => {
    if (!s || !s.vklop || s.tece || s.samoGlobalLink || vTeku.current.zagon) return;
    vTeku.current.zagon = true;
    void shraniAsistentaFn({ data: {} }).then(setS).catch(() => undefined);
  }, [s?.vklop, s?.tece, s?.samoGlobalLink]);

  // naloga 16: QR brez klika; nov QR pred potekom in ko streznik zacne teci (stari QR nosi stari naslov ali vrata)
  const tece = !!s?.tece;
  const kljucStreznika = s ? `${s.naslov}:${s.vrata}:${s.odtis}` : "";
  useEffect(() => {
    if (!tece) {
      setPovabilo(null);
      return;
    }
    if ((povabilo && povabilo.kljuc === kljucStreznika && povabilo.do - QR_PREJ_MS > zdaj) || vTeku.current.qr || premorDo.current.qr > zdaj) return;
    vTeku.current.qr = true;
    zacniSeznanitevFn()
      .then((p) => {
        neuspehov.current.qr = 0;
        if (ziv.current) { mojQr.current = p.koda; setPovabilo({ ...p, do: Date.now() + p.velja, kljuc: kljucStreznika }); }
        // naloga 21 (N2): QR, ki je prisel po zapustitvi zaslona (zacniSeznanitev caka do 25 s na pot klicev), ne ostane veljaven
        else void prekliciSeznanitevFn({ data: { koda: p.koda } }).catch(() => undefined);
      })
      .catch((e: unknown) => {
        premorDo.current.qr = Date.now() + PREMOR_PO_NAPAKI_MS;
        // pregled 16 (4): trajna napaka ni tiho »se pripravlja«
        if (++neuspehov.current.qr >= NAPAK_DO_PRIKAZA && ziv.current) setLokalna(e instanceof Error ? e.message : "");
      })
      .finally(() => { vTeku.current.qr = false; });
  }, [tece, kljucStreznika, povabilo, zdaj]);

  // naloga 16: okno s 6-mestno kodo brez klika (ne med zaporo po prevec poskusih); po porabi ali poteku se odpre novo
  const kodaOdprta = !!s?.sKodo.odprto;
  const zaprtoSe = s?.sKodo.zaprtoSe ?? 0;
  useEffect(() => {
    if (!tece || kodaOdprta || zaprtoSe > 0 || vTeku.current.koda || premorDo.current.koda > zdaj) return;
    vTeku.current.koda = true;
    zacniSeznanitevSKodoFn()
      .then(async () => {
        neuspehov.current.koda = 0;
        if (!ziv.current) { await zapriSeznanitevSKodoFn().catch(() => undefined); return; }
        const x = await stanjeAsistentaFn();
        if (ziv.current) setS(x);
      })
      .catch((e: unknown) => {
        premorDo.current.koda = Date.now() + PREMOR_PO_NAPAKI_MS;
        if (++neuspehov.current.koda >= NAPAK_DO_PRIKAZA && ziv.current) setLokalna(e instanceof Error ? e.message : "");
      })
      .finally(() => { vTeku.current.koda = false; });
  }, [tece, kodaOdprta, zaprtoSe, zdaj]);

  // ob zapustitvi zaslona se okno s kodo zapre (koda ne velja vec, oglas mDNS se ustavi); naloga 21 (N2): tudi neporabljeni QR ne velja vec
  useEffect(() => {
    ziv.current = true;
    return () => {
      ziv.current = false;
      void zapriSeznanitevSKodoFn().catch(() => undefined);
      void prekliciSeznanitevFn({ data: { koda: mojQr.current } }).catch(() => undefined);
    };
  }, []);

  async function izvedi(delo: () => Promise<void>) {
    setZaposlen(true);
    onError("");
    setLokalna("");
    try {
      await delo();
    } catch (cause) {
      const m = cause instanceof Error ? cause.message : "";
      setLokalna(m);
      onError(m);
    } finally {
      setZaposlen(false);
    }
  }

  const plosca = (
    <PovezavaPlosca
      s={s}
      povabilo={povabilo}
      zaposlen={zaposlen}
      kodaTel={kodaTel}
      onKodaTel={(pairId, v) => setKodaTel({ ...kodaTel, [pairId]: v })}
      onPotrdiKodo={(pairId) => void izvedi(async () => setS(await vnesiKodoTelefonaFn({ data: { pairId, koda: kodaTel[pairId] ?? "" } })))}
      onOdkleni={() => void izvedi(async () => setS(await odkleniPovezovanjeFn()))}
      onVklopi={() => void izvedi(async () => prevzemi(await shraniAsistentaFn({ data: { vklop: true } })))}
      onDodaj={(c) => void izvedi(async () => { await potrdiIdSeznanitveFn({ data: { koda: c.koda, id: c.id } }); setS(await odlociSeznanitevFn({ data: { koda: c.koda, sprejmi: true } })); setPovabilo(null); })}
      napaka={lokalna}
      onZavrni={(koda) => void izvedi(async () => setS(await odlociSeznanitevFn({ data: { koda, sprejmi: false } })))}
    />
  );
  const gumb = GUMB;
  const polje = POLJE;
  if (!s) return <div className="mt-5 grid items-start gap-4 xl:grid-cols-[minmax(0,32rem)_minmax(0,1fr)]"><div className="xl:col-start-2">{plosca}</div></div>;
  return (
    <div className="mt-5 grid items-start gap-4 xl:grid-cols-[minmax(0,32rem)_minmax(0,1fr)]">
      <div className="xl:order-2">{plosca}</div>
    <section aria-labelledby="pt-naslov" className="grid gap-3 rounded-3xl bg-[var(--color-sheet)] p-5 xl:order-1">
      <h3 id="pt-naslov" className="text-lg">{t("telNaslov")}</h3>
      <p className="text-sm text-[var(--color-moss)]">{t("telRazlaga")}</p>
      {/* naloga 33: na 127.0.0.1 telefon doma Line ne najde - en gumb z naslovom; klik je lastnikova odobritev omrezja (N1), nikoli samodejno */}
      {s.vklop && ZANKA.test(s.naslov) && s.predlogNaslova ? (
        <div className="grid gap-2 text-sm" data-predlog-domace="1">
          <p role="status">{t("telZankaRazlaga")}</p>
          <button type="button" disabled={zaposlen} className={gumb}
            onClick={() => void izvedi(async () => prevzemi(await shraniAsistentaFn({ data: { naslov: s.predlogNaslova, odobriOmrezje: true } })))}>
            {t("telUporabiDomace")} ({s.predlogNaslova})
          </button>
        </div>
      ) : null}
      <form
        className="grid gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          // naloga 21 (N1): »Shrani« z NOVIM naslovom je lastnikova izbira - omrezje tega naslova postane odobreno; samo sprememba vrat ne
          // odobri omrezja (slepi pregled 21, najdba 8), za to je gumb »Uporabi ta naslov«
          void izvedi(async () => prevzemi(await shraniAsistentaFn({ data: { vklop: s.vklop, naslov, vrata: Number(vrata), odobriOmrezje: naslov !== s.naslov } })));
        }}
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={s.vklop}
            disabled={zaposlen}
            onChange={(e) => void izvedi(async () => prevzemi(await shraniAsistentaFn({ data: { vklop: e.target.checked, naslov, vrata: Number(vrata) } })))}
          />
          {t("telVklop")}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={s.ocenaIzida}
            disabled={zaposlen}
            aria-describedby="pt-ocena-namig"
            onChange={(e) => void izvedi(async () => prevzemi(await shraniAsistentaFn({ data: { ocenaIzida: e.target.checked } })))}
          />
          {t("telOcenaIzida")}
        </label>
        <p id="pt-ocena-namig" className="text-xs text-[var(--color-moss)]">{t("telOcenaIzidaNamig")}</p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={s.globalLink}
            disabled={zaposlen}
            aria-describedby="pt-global-namig"
            onChange={(e) => void izvedi(async () => prevzemi(await shraniAsistentaFn({ data: { globalLink: e.target.checked } })))}
          />
          {t("telGlobalLink")}
        </label>
        <p id="pt-global-namig" className="text-xs text-[var(--color-moss)]">{t("telGlobalLinkNamig")}</p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={s.samodejniAgenti}
            disabled={zaposlen}
            aria-describedby="pt-samodejni-namig"
            onChange={(e) => void izvedi(async () => prevzemi(await shraniAsistentaFn({ data: { samodejniAgenti: e.target.checked } })))}
          />
          {t("telSamodejniAgenti")}
        </label>
        <p id="pt-samodejni-namig" className="text-xs text-[var(--color-moss)]">{t("telSamodejniAgentiNamig")}</p>
        {s.globalLink && (
          <p className="text-xs" role="status">{t("telGlobalLinkStanje")}{t(`telGlobalLink_${s.globalLinkStanje}`)}</p>
        )}
        <label htmlFor="pt-naslov-rac">
          {t("telNaslovRac")}
          <select id="pt-naslov-rac" value={naslov} onChange={(e) => setNaslov(e.target.value)} className={polje}>
            {s.naslovi.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label htmlFor="pt-vrata">
          {t("telVrata")}
          <input id="pt-vrata" type="number" inputMode="numeric" min={1024} max={65535} value={vrata} onChange={(e) => setVrata(e.target.value)} className={polje} />
        </label>
        <button type="submit" disabled={zaposlen} className={gumb}>{t("telShrani")}</button>
      </form>
      {/* naloga 15: napaka je vidna vedno (tudi ko tece samo Global Link), v jeziku vmesnika; podrobnost streznika samo pri »drugo« */}
      {s.napakaKoda ? <p role="alert" className="text-sm text-[var(--color-signal)]">{t(`telNapaka_${s.napakaKoda}`)}{s.napakaKoda === "drugo" && s.napaka ? ` (${s.napaka})` : ""}</p> : null}
      {/* naloga 21 (N1): neodobreno omrezje - samo lastnik ga odobri z izrecnim klikom (naslov je viden) */}
      {s.napakaKoda === "omrezje" && s.predlogNaslova ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-predlog-naslova="1">
          <span>{t("telPredlogNaslova")} <strong>{s.predlogNaslova}</strong></span>
          <button type="button" disabled={zaposlen} className={gumb}
            onClick={() => void izvedi(async () => prevzemi(await shraniAsistentaFn({ data: { naslov: s.predlogNaslova, odobriOmrezje: true } })))}>
            {t("telUporabiNaslov")}
          </button>
        </div>
      ) : null}
      {s.samoGlobalLink ? <p role="status" className="text-sm">{t("telSamoGlobalLink")}</p> : null}
      {s.tece ? (
        <>
          <p className="text-sm">{t("telTece")} {s.naslov}:{s.vrata}</p>
          <p className="text-sm">{s.claudeCode ? t("telClaudeOdprt") : t(s.samodejniAgenti ? "telClaudeZaprtSamodejno" : "telClaudeZaprt")}</p>
          {/* naloga 18: samodejni zagon seje ni uspel (ni terminala, ni claude, omejitev poskusov) */}
          {!s.claudeCode && s.zagonClaude ? <p role="alert" className="text-sm text-[var(--color-signal)]">{t(`telZagonClaude_${s.zagonClaude}`)}</p> : null}
          {s.opozoriloKlicev ? <p role="alert" className="text-sm text-[var(--color-signal)]">{s.opozoriloKlicev}</p> : null}
        </>
      ) : (
        s.samoGlobalLink ? null : <p className="text-sm">{t("telNeTece")}</p>
      )}
      <h4 className="text-base">{t("telNaprave")}</h4>
      {s.naprave.length ? (
        <ul className="grid gap-1 text-sm">
          {s.naprave.map((n) => (
            <li key={n.id} className="flex items-center gap-2">
              <span>{n.ime || t("telBrezImena")} ({n.id})</span>
              <button type="button" disabled={zaposlen} className={gumb} onClick={() => izvedi(async () => setS(await odstraniNapravoFn({ data: { id: n.id } })))}>
                {t("telOdstrani")}
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm">{t("telNiNaprav")}</p>}
      <h4 className="text-base">{t("telOpenLine")}</h4>
      {/* Pot klicev (OpenLine) tece v tej aplikaciji in se zazene sama ob dodajanju telefona: lastnik ne vpisuje nic (lastnik 21. 11. 2026). */}
      <p className="text-sm" role="status">
        {s.klicevSePripravlja ? t("telOpenLinePripravlja") : s.openLine.povezan ? `${t("telOpenLinePovezan")} (${s.openLine.vrata})` : t("telOpenLineSama")}
      </p>
    </section>
    </div>
  );
}
