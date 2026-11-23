import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/lib/lina/besedila.ts";
import { asistentFn, asistentZgodovinaFn, govorFn, koledarSeznamFn, koledarSpremeniFn, nastavitveObvestilFn, prepisFn } from "@/lib/lina/functions.ts";
import { PRIVZETE_NASTAVITVE_OBVESTIL, odlociObvestilo } from "@/lib/lina/obvestila-odlocitev.ts";
import { datumBesedilo, pregledDneva, razberiCas, uraBesedilo, type ZapisKoledar } from "@/lib/lina/koledar.ts";
import type { BrainPublic } from "@/lib/lina/types.ts";

/** Prva stran programa: pogovor z Lino (tipkanje ali govor) in pregled dneva. Videz: styles.css (.zar, .lina-*). */
export const DOGODEK_KOLEDAR = "lina-koledar";

function fault(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Nekaj je šlo narobe.";
}

type Sporocilo = { vloga: "lastnik" | "lina"; besedilo: string; cas: string };
type IzbranaPriponka = { id: number; datoteka: File };
/** Iste meje kot pripraviPriponke na strezniku (priponke.ts); tu samo, da uporabnik napako vidi takoj. */
const NAJVEC_PRIPONK = 5;
const NAJVEC_BAJTOV_PRIPONK = 15 * 1024 * 1024;
const SPREJME_PRIPONKE = "image/*,application/pdf,video/*,audio/*,text/*,.md,.csv,.tsv,.json,.xml,.yaml,.yml,.log,.srt,.vtt,.py,.ts,.js,.kt,.java,.sh";

function IkonaSponka() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.5 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.8 1.8 0 0 1-2.5-2.5l7.9-7.9" />
    </svg>
  );
}

/** Odgovor Line kot datoteka (.md): lastnik je zahteval obdelavo, rezultat shrani z enim klikom. */
function shraniKotDatoteko(besedilo: string, cas: string) {
  const blob = new Blob([besedilo], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Lina-${cas.slice(0, 16).replace(/[:T]/g, "-")}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
type StanjeMika = "mirno" | "poslusam" | "prepisujem";

const NAJDALJSI_POSNETEK_MS = 60_000;
const TISINA_PO_GOVORU_MS = 1_600;
const BREZ_GOVORA_MS = 8_000;
const PRAG_GOVORA = 0.035;
const STOLPCEV = 56;

function IkonaMikrofon({ konec }: { konec: boolean }) {
  return konec ? (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="currentColor">
      <rect x="7" y="7" width="10" height="10" rx="2.5" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
    </svg>
  );
}

function kodiraj(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const bralnik = new FileReader();
    bralnik.onerror = () => reject(new Error("Posnetka ni mogoče prebrati."));
    bralnik.onload = () => resolve(String(bralnik.result).split(",")[1] ?? "");
    bralnik.readAsDataURL(blob);
  });
}

// Privzeta naprava (ALSA/PipeWire) na nekaterih računalnikih ne zažene zvoka (NotReadableError),
// konkretne naprave pa delujejo: če privzeta odpove, poskusimo vse vhode (najprej tiste s programsko pretvorbo).
async function odpriMikrofon(): Promise<MediaStream> {
  const md = navigator.mediaDevices;
  try {
    return await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (napaka) {
    if (!(napaka instanceof DOMException) || napaka.name !== "NotReadableError") throw napaka;
    const vhodi = (await md.enumerateDevices()).filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "");
    vhodi.sort((a, b) => Number(/software conversions/i.test(b.label)) - Number(/software conversions/i.test(a.label)));
    for (const d of vhodi) {
      try {
        return await md.getUserMedia({ audio: { deviceId: { exact: d.deviceId } } });
      } catch {
        /* naslednja naprava */
      }
    }
    throw napaka;
  }
}

/**
 * ukaz: besedilo iz spodnje ukazne vrstice lupine (poslje se enkrat na id); glas: id zahteve za zacetek snemanja.
 * onPrevzeto: ukaz ali glas je prevzet, lupina ju pozabi (sicer bi se ob vrnitvi na zaslon poslala znova).
 * kompakt: okno za odgovore na Domovu (brez mikrofona, polja in napisov); pokaze samo zadnje vprasanje in odgovor, ko je bilo kaj vprasano.
 */
export function AsistentPanel({ brain, ukaz, glas, onPrevzeto, kompakt, onOdpriPogovor }: {
  brain: BrainPublic;
  ukaz?: { id: number; besedilo: string } | null;
  glas?: number;
  onPrevzeto?: () => void;
  kompakt?: boolean;
  onOdpriPogovor?: () => void;
}) {
  const [sporocila, setSporocila] = useState<Sporocilo[]>([]);
  const [besedilo, setBesedilo] = useState("");
  const [caka, setCaka] = useState(false);
  const [napaka, setNapaka] = useState("");
  const [namig, setNamig] = useState("");
  const [stanje, setStanje] = useState<StanjeMika>("mirno");
  const [glasOn, setGlasOn] = useState(true);
  const [govori, setGovori] = useState(false);
  const [aktivno, setAktivno] = useState(false);
  const [priponke, setPriponke] = useState<IzbranaPriponka[]>([]);
  const [vlecenje, setVlecenje] = useState(false);
  const izbirnik = useRef<HTMLInputElement | null>(null);
  const stevecPriponk = useRef(0);
  const konec = useRef<HTMLDivElement | null>(null);
  const polje = useRef<HTMLTextAreaElement | null>(null);
  const zar = useRef<HTMLButtonElement | null>(null);
  const platno = useRef<HTMLCanvasElement | null>(null);
  const snemanje = useRef<{ ustavi: () => void } | null>(null);
  const zvok = useRef<HTMLAudioElement | null>(null);
  const ziv = useRef(true);

  useEffect(() => {
    ziv.current = true;
    void asistentZgodovinaFn().then(setSporocila).catch(() => setSporocila([]));
    try {
      setGlasOn(localStorage.getItem("lina-glas-odgovor") !== "0");
    } catch {
      /* Brez shrambe ostane privzeto vklopljeno. */
    }
    return () => {
      ziv.current = false;
      snemanje.current?.ustavi();
      zvok.current?.pause();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);
  useEffect(() => {
    konec.current?.scrollIntoView({ block: "end" });
  }, [sporocila, caka]);
  const obdelanUkaz = useRef(0);
  useEffect(() => {
    if (ukaz && ukaz.id !== obdelanUkaz.current) {
      obdelanUkaz.current = ukaz.id;
      void poslji(ukaz.besedilo);
      onPrevzeto?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ukaz?.id]);
  const obdelanGlas = useRef(0);
  useEffect(() => {
    if (glas && glas !== obdelanGlas.current) {
      obdelanGlas.current = glas;
      void zacniSnemanje();
      onPrevzeto?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glas]);

  function utisaj() {
    zvok.current?.pause();
    zvok.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setGovori(false);
  }

  async function izgovori(odgovor: string) {
    utisaj();
    setNamig("");
    try {
      const izid = await govorFn({ data: { besedilo: odgovor } });
      if (!ziv.current) return;
      if (izid.ok) {
        const el = new Audio(`data:audio/wav;base64,${izid.wavB64}`);
        zvok.current = el;
        el.onended = () => setGovori(false);
        el.onerror = () => setGovori(false);
        setGovori(true);
        await el.play().catch(() => setGovori(false));
        return;
      }
    } catch {
      /* Poskusimo z glasom sistema. */
    }
    if ("speechSynthesis" in window) {
      const glas = window.speechSynthesis.getVoices().find((g) => /^sl/i.test(g.lang));
      if (glas) {
        const u = new SpeechSynthesisUtterance(odgovor);
        u.voice = glas;
        u.lang = glas.lang;
        u.onend = () => setGovori(false);
        u.onerror = () => setGovori(false);
        setGovori(true);
        window.speechSynthesis.speak(u);
        return;
      }
    }
    setNamig(t("glasBrez"));
  }

  function dodajPriponke(datoteke: FileList | File[] | null) {
    if (!datoteke) return;
    const nove = Array.from(datoteke);
    if (nove.length === 0) return;
    setNapaka("");
    setPriponke((prej) => {
      const vse = [...prej, ...nove.map((datoteka) => ({ id: ++stevecPriponk.current, datoteka }))];
      if (vse.length > NAJVEC_PRIPONK) {
        setNapaka(t("pogovorPrevec"));
        return prej;
      }
      if (vse.reduce((v, p) => v + p.datoteka.size, 0) > NAJVEC_BAJTOV_PRIPONK) {
        setNapaka(t("pogovorPreveliko"));
        return prej;
      }
      return vse;
    });
  }

  async function poslji(vsebina?: string, glasovno = false) {
    const novo = (vsebina ?? besedilo).trim();
    // Pri glasovnem ali ukaznem sporocilu (vsebina podana) priponke ostanejo za naslednje vnosno sporocilo.
    const zPriponkami = vsebina === undefined ? priponke : [];
    if ((!novo && zPriponkami.length === 0) || caka) return;
    setAktivno(true);
    setCaka(true);
    setNapaka("");
    setNamig("");
    const oznaka = zPriponkami.length ? `📎 ${zPriponkami.map((p) => p.datoteka.name).join(", ")}` : "";
    setSporocila((prej) => [...prej, { vloga: "lastnik", besedilo: [novo, oznaka].filter(Boolean).join("\n"), cas: new Date().toISOString() }]);
    setBesedilo("");
    if (zPriponkami.length) setPriponke([]);
    try {
      const podatki = zPriponkami.length
        ? await Promise.all(zPriponkami.map(async (p) => ({ ime: p.datoteka.name, mime: p.datoteka.type, podatki: await kodiraj(p.datoteka) })))
        : undefined;
      const izid = await asistentFn({ data: podatki ? { besedilo: novo, priponke: podatki } : { besedilo: novo } });
      if (!ziv.current) return;
      setSporocila(izid.zgodovina);
      if (!izid.ok) {
        setNapaka(izid.sporocilo);
        // Znanje 22. 11. 2026: ob napaki uporabnikovo besedilo ostane (ne izgine), da lahko samo pritisne Poslji znova.
        if (vsebina === undefined) setBesedilo((prej) => prej || novo);
        // Neuspesno poslane priponke se vrnejo v vrstico, da jih uporabniku ni treba izbrati znova.
        if (zPriponkami.length) setPriponke((prej) => (prej.length ? prej : zPriponkami));
      }
      else {
        // Pogovor je lahko dodal opomnik ali zapisek: pregled dneva in koledar se osvezita.
        window.dispatchEvent(new Event(DOGODEK_KOLEDAR));
        const odgovor = izid.zgodovina[izid.zgodovina.length - 1];
        if (glasovno && glasOn && odgovor?.vloga === "lina") void izgovori(odgovor.besedilo);
      }
    } catch (e) {
      setNapaka(fault(e));
    } finally {
      if (ziv.current) setCaka(false);
    }
  }

  async function zacniSnemanje() {
    setAktivno(true);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setNapaka(t("mikNiPodprt"));
      return;
    }
    utisaj();
    setNapaka("");
    let tok: MediaStream;
    try {
      tok = await odpriMikrofon();
    } catch {
      setNapaka(t("mikNapaka"));
      return;
    }
    const ctx = new AudioContext();
    const analiza = ctx.createAnalyser();
    analiza.fftSize = 1024;
    ctx.createMediaStreamSource(tok).connect(analiza);
    const tip = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((x) => MediaRecorder.isTypeSupported(x));
    const rec = new MediaRecorder(tok, tip ? { mimeType: tip } : undefined);
    const kosi: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) kosi.push(e.data);
    };
    const zacetek = performance.now();
    const vzorec = new Float32Array(analiza.fftSize);
    const zgodovinaGlasnosti: number[] = Array.from({ length: STOLPCEV }, () => 0);
    let govoril = false;
    let tihoOd = 0;
    let koncano = false;
    let okvir = 0;
    let zadnjiVzorec = 0;

    const risi = (zdaj: number) => {
      analiza.getFloatTimeDomainData(vzorec);
      let vsota = 0;
      for (let i = 0; i < vzorec.length; i++) vsota += vzorec[i] * vzorec[i];
      const raven = Math.sqrt(vsota / vzorec.length);
      zar.current?.style.setProperty("--glasnost", String(1 + Math.min(raven * 2.4, 0.3)));
      if (zdaj - zadnjiVzorec > 45) {
        zadnjiVzorec = zdaj;
        zgodovinaGlasnosti.push(raven);
        zgodovinaGlasnosti.shift();
      }
      const p = platno.current;
      const g = p?.getContext("2d");
      if (p && g) {
        const dpr = window.devicePixelRatio || 1;
        const sirina = p.clientWidth;
        const visina = p.clientHeight;
        if (p.width !== Math.round(sirina * dpr)) {
          p.width = Math.round(sirina * dpr);
          p.height = Math.round(visina * dpr);
        }
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, sirina, visina);
        const stil = getComputedStyle(p);
        const a = stil.getPropertyValue("--aurora-2").trim() || "#4fd1c5";
        const b = stil.getPropertyValue("--aurora-1").trim() || "#8b7cf6";
        const korak = sirina / STOLPCEV;
        const zlato = g.createLinearGradient(0, 0, sirina, 0);
        zlato.addColorStop(0, a);
        zlato.addColorStop(1, b);
        g.fillStyle = zlato;
        zgodovinaGlasnosti.forEach((v, i) => {
          const h = Math.max(3, Math.min(visina, v * visina * 7));
          g.beginPath();
          g.roundRect(i * korak + korak * 0.2, (visina - h) / 2, Math.max(2, korak * 0.6), h, 2);
          g.fill();
        });
      }
      if (raven > PRAG_GOVORA) {
        govoril = true;
        tihoOd = 0;
      } else if (govoril) {
        if (!tihoOd) tihoOd = zdaj;
        if (zdaj - tihoOd > TISINA_PO_GOVORU_MS) return ustavi();
      }
      if (zdaj - zacetek > NAJDALJSI_POSNETEK_MS || (!govoril && zdaj - zacetek > BREZ_GOVORA_MS)) return ustavi();
      okvir = requestAnimationFrame(risi);
    };
    function ustavi() {
      if (koncano) return;
      koncano = true;
      cancelAnimationFrame(okvir);
      if (rec.state !== "inactive") rec.stop();
    }
    rec.onstop = async () => {
      tok.getTracks().forEach((s) => s.stop());
      void ctx.close();
      zar.current?.style.removeProperty("--glasnost");
      snemanje.current = null;
      if (!ziv.current) return;
      if (!govoril) {
        setStanje("mirno");
        setNapaka(t("mikNicGovora"));
        return;
      }
      setStanje("prepisujem");
      try {
        const blob = new Blob(kosi, { type: rec.mimeType || "audio/webm" });
        const izid = await prepisFn({ data: { zvok: await kodiraj(blob), mime: blob.type } });
        if (!ziv.current) return;
        setStanje("mirno");
        if (!izid.ok) setNapaka(izid.sporocilo);
        else await poslji(izid.besedilo, true);
      } catch (e) {
        if (ziv.current) {
          setStanje("mirno");
          setNapaka(fault(e));
        }
      }
    };
    snemanje.current = { ustavi };
    rec.start();
    setStanje("poslusam");
    okvir = requestAnimationFrame(risi);
  }

  function preklopiMikrofon() {
    if (stanje === "poslusam") snemanje.current?.ustavi();
    else if (stanje === "mirno") void zacniSnemanje();
  }

  function nastaviGlas(vklop: boolean) {
    setGlasOn(vklop);
    if (!vklop) utisaj();
    try {
      localStorage.setItem("lina-glas-odgovor", vklop ? "1" : "0");
    } catch {
      /* Izbira velja do zaprtja. */
    }
  }

  const poslusam = stanje === "poslusam";
  if (kompakt) {
    if (!aktivno) return null;
    const zadnje = sporocila[sporocila.length - 1];
    const vprasanje = [...sporocila].reverse().find((s) => s.vloga === "lastnik");
    return (
      <div className="lina-odgovor" role="region" aria-label={t("pogovorNaslov")} aria-live="polite">
        <div className="lina-odgovor-telo">
          {vprasanje ? <p className="lina-odgovor-vprasanje">{vprasanje.besedilo}</p> : null}
          {zadnje?.vloga === "lina" ? <p className="lina-odgovor-besedilo">{zadnje.besedilo}</p> : null}
          {caka ? <p className="lina-odgovor-stanje">{t("pogovorPremislja")}</p> : null}
          {poslusam ? <p className="lina-odgovor-stanje">{t("mikPoslusam")}</p> : null}
          {stanje === "prepisujem" ? <p className="lina-odgovor-stanje">{t("mikPrepisujem")}</p> : null}
          {napaka ? <p role="alert" className="lina-odgovor-napaka">{napaka}</p> : null}
          {namig ? <p className="lina-odgovor-stanje">{namig}</p> : null}
        </div>
        <div className="lina-odgovor-gumbi">
          {poslusam ? (
            <button type="button" onClick={preklopiMikrofon}>{t("mikKonec")}</button>
          ) : null}
          {govori ? (
            <button type="button" onClick={utisaj}>{t("glasUtisaj")}</button>
          ) : null}
          {onOdpriPogovor ? (
            <button type="button" onClick={onOdpriPogovor}>{t("d2OdpriPogovor")} ›</button>
          ) : null}
          <button type="button" className="lina-odgovor-zapri" onClick={() => setAktivno(false)} aria-label={t("d2Zapri")} title={t("d2Zapri")}>
            ×
          </button>
        </div>
      </div>
    );
  }
  return (
    <section className="mt-5 grid max-w-6xl gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="flex min-w-0 flex-col rounded-3xl bg-[var(--color-sheet)] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="display text-3xl">{t("pogovorNaslov")}</h2>
            <p className="mt-2 max-w-prose text-sm text-[var(--color-moss)]">{t("pogovorNamig")}</p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input type="checkbox" checked={glasOn} onChange={(e) => nastaviGlas(e.target.checked)} className="h-4 w-4 accent-[var(--aurora-1)]" />
            {t("glasOdgovor")}
          </label>
        </div>
        <p className="mt-2 flex items-center gap-2 text-xs">
          <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${brain.nastavljen ? "bg-[var(--color-moss)]" : "bg-[var(--color-signal)]"}`} />
          {brain.nastavljen ? `${t("pogovorPovezano")}: ${brain.provider ?? ""} ${brain.model}`.trim() : t("pogovorNepovezano")}
        </p>

        <div
          className={`lina-pogovor mt-4 flex max-h-[50vh] min-h-52 flex-col gap-4 overflow-y-auto rounded-2xl border bg-[var(--color-surface)] p-4 ${vlecenje ? "border-[var(--aurora-1)]" : "border-[var(--color-rule)]"}`}
          aria-live="polite"
          onDragOver={(e) => {
            if (!Array.from(e.dataTransfer.types).includes("Files")) return;
            e.preventDefault();
            setVlecenje(true);
          }}
          onDragLeave={() => setVlecenje(false)}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            setVlecenje(false);
            dodajPriponke(e.dataTransfer.files);
          }}
        >
          {vlecenje ? <p className="m-auto text-sm text-[var(--color-moss)]">{t("pogovorSpusti")}</p> : null}
          {sporocila.length === 0 ? <p className="m-auto max-w-xs text-center text-sm text-[var(--color-brass)]">{t("pogovorPrazno")}</p> : null}
          {sporocila.map((s, i) =>
            s.vloga === "lastnik" ? (
              <div key={`${s.cas}-${i}`} className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-[var(--color-ink)] px-3.5 py-2 text-sm text-[var(--color-on-ink)]">
                <span className="whitespace-pre-wrap">{s.besedilo}</span>
              </div>
            ) : (
              <div key={`${s.cas}-${i}`} className="lina-glas max-w-[90%] self-start pl-3 text-sm leading-relaxed">
                <span className="whitespace-pre-wrap">{s.besedilo}</span>
                <span className="mt-1 flex gap-3 text-xs text-[var(--color-moss)]">
                  <button type="button" className="underline" onClick={() => void navigator.clipboard?.writeText(s.besedilo).then(() => setNamig(t("pogovorKopirano"))).catch(() => undefined)}>
                    {t("pogovorKopiraj")}
                  </button>
                  {s.besedilo.length > 400 || sporocila[i - 1]?.besedilo.includes("📎") ? (
                    <button type="button" className="underline" onClick={() => shraniKotDatoteko(s.besedilo, s.cas)}>
                      {t("pogovorShrani")}
                    </button>
                  ) : null}
                </span>
              </div>
            ),
          )}
          {caka ? <p className="self-start pl-3 text-sm text-[var(--color-brass)]">{t("pogovorPremislja")}</p> : null}
          <div ref={konec} />
        </div>
        {napaka ? <p role="alert" className="mt-3 text-sm text-[var(--color-signal)]">{napaka}</p> : null}
        {namig ? <p className="mt-3 text-sm text-[var(--color-brass)]">{namig}</p> : null}
        {priponke.length ? (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label={t("pogovorPrilozi")}>
            {priponke.map((p) => (
              <li key={p.id} className="flex items-center gap-1 rounded-full border border-[var(--color-rule)] bg-[var(--color-surface)] py-1 pl-3 pr-1 text-xs">
                <span className="max-w-48 truncate">📎 {p.datoteka.name}</span>
                <button
                  type="button"
                  className="rounded-full px-2 py-0.5"
                  aria-label={`${t("pogovorOdstraniPriponko")}: ${p.datoteka.name}`}
                  title={t("pogovorOdstraniPriponko")}
                  onClick={() => setPriponke((prej) => prej.filter((x) => x.id !== p.id))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <form
          className="mt-4 flex items-center gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void poslji();
          }}
        >
          <button
            ref={zar}
            type="button"
            className="zar shrink-0"
            data-stanje={stanje}
            aria-pressed={poslusam}
            aria-label={poslusam ? t("mikKonec") : t("mikZacni")}
            title={poslusam ? t("mikKonec") : t("mikZacni")}
            disabled={stanje === "prepisujem" || caka}
            onClick={preklopiMikrofon}
          >
            <IkonaMikrofon konec={poslusam} />
          </button>
          <input
            ref={izbirnik}
            type="file"
            multiple
            accept={SPREJME_PRIPONKE}
            className="hidden"
            onChange={(e) => {
              dodajPriponke(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="shrink-0 rounded-full border border-[var(--color-rule)] p-2.5"
            aria-label={t("pogovorPrilozi")}
            title={t("pogovorPrilozi")}
            disabled={caka}
            onClick={() => izbirnik.current?.click()}
          >
            <IkonaSponka />
          </button>
          <div className="relative min-w-0 flex-1">
            <textarea
              ref={polje}
              value={besedilo}
              rows={2}
              maxLength={2000}
              aria-label={t("pogovorPolje")}
              placeholder={t("pogovorPolje")}
              onChange={(event) => setBesedilo(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void poslji();
                }
              }}
              className="w-full resize-none rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-sm"
            />
            {poslusam || stanje === "prepisujem" ? (
              <div className="absolute inset-0 flex flex-col justify-center gap-1 rounded-xl border border-[var(--aurora-1)] bg-[var(--color-surface)] px-3">
                <canvas ref={platno} className="h-9 w-full" aria-hidden="true" />
                <span className="text-xs text-[var(--color-moss)]" role="status">{poslusam ? t("mikPoslusam") : t("mikPrepisujem")}</span>
              </div>
            ) : null}
          </div>
          {govori ? (
            <button type="button" onClick={utisaj} className="rounded-full border border-[var(--color-rule)] px-4 py-2 text-sm">
              {t("glasUtisaj")}
            </button>
          ) : null}
          <button type="submit" disabled={caka || (!besedilo.trim() && priponke.length === 0)} className="rounded-full bg-[var(--color-ink)] px-5 py-2.5 text-sm text-[var(--color-on-ink)] disabled:opacity-50">
            {t("pogovorPosli")}
          </button>
        </form>
      </div>

      <DanesPregled
        onPredlog={(b) => {
          setBesedilo(b);
          polje.current?.focus();
        }}
      />
    </section>
  );
}

/** Skupni viri za »Danes«: zapisi koledarja, osvezitev na minuto in ob dogodku koledarja; uporabljata ga polni pregled in kartica. */
function useDanes() {
  const [zapisi, setZapisi] = useState<ZapisKoledar[] | null>(null);
  const [zdaj, setZdaj] = useState<Date | null>(null);
  const osvezi = useCallback(() => {
    setZdaj(new Date());
    void koledarSeznamFn().then(setZapisi).catch(() => setZapisi([]));
  }, []);
  useEffect(() => {
    osvezi();
    window.addEventListener(DOGODEK_KOLEDAR, osvezi);
    const casovnik = setInterval(osvezi, 60_000);
    return () => {
      window.removeEventListener(DOGODEK_KOLEDAR, osvezi);
      clearInterval(casovnik);
    };
  }, [osvezi]);

  const pregled = zdaj && zapisi ? pregledDneva(zapisi, zdaj) : null;
  const vrstice = pregled ? [...pregled.dogodki, ...pregled.opomniki].sort((a, b) => (a.cas ?? "").localeCompare(b.cas ?? "")) : [];

  async function opravljeno(id: string) {
    await koledarSpremeniFn({ data: { id, opravljeno: true } });
    window.dispatchEvent(new Event(DOGODEK_KOLEDAR));
  }
  return { zdaj, pregled, vrstice, opravljeno };
}

export function DanesPregled({ onPredlog }: { onPredlog: (besedilo: string) => void }) {
  const { zdaj, pregled, vrstice, opravljeno } = useDanes();

  return (
    <aside className="flex min-w-0 flex-col gap-6 rounded-3xl bg-[var(--color-sheet)] p-5 sm:p-6" aria-label={t("danesNaslov")}>
      <div>
        <h3 className="display text-2xl">{t("danesNaslov")}</h3>
        <p className="mt-1 text-sm text-[var(--color-moss)]">{zdaj ? datumBesedilo(zdaj) : " "}</p>
        {pregled && vrstice.length === 0 && pregled.zamujeno.length === 0 ? <p className="mt-4 text-sm text-[var(--color-brass)]">{t("danesPrazno")}</p> : null}
        {vrstice.length > 0 ? (
          <ul className="mt-4 divide-y divide-[var(--color-rule)]">
            {vrstice.map((z) => (
              <li key={z.id} className="flex items-start gap-3 py-2.5">
                <span className="w-12 shrink-0 pt-0.5 text-sm tabular-nums text-[var(--color-brass)]">{uraBesedilo(z.cas)}</span>
                <span className="min-w-0 flex-1 text-sm">{z.naslov}</span>
                <button type="button" onClick={() => void opravljeno(z.id)} aria-label={`${t("danesOpravi")}: ${z.naslov}`} title={t("danesOpravi")} className="lina-kljukica shrink-0" />
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {pregled && pregled.zamujeno.length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold text-[var(--color-signal)]">{t("danesZamujeno")}</h4>
          <ul className="mt-2 divide-y divide-[var(--color-rule)]">
            {pregled.zamujeno.map((z) => (
              <li key={z.id} className="flex items-start gap-3 py-2.5">
                <span className="min-w-0 flex-1 text-sm">
                  {z.naslov}
                  <span className="block text-xs text-[var(--color-brass)]">{(() => { const d = razberiCas(z.cas); return d ? `${datumBesedilo(d)}, ${uraBesedilo(z.cas)}` : ""; })()}</span>
                </span>
                <button type="button" onClick={() => void opravljeno(z.id)} aria-label={`${t("danesOpravi")}: ${z.naslov}`} title={t("danesOpravi")} className="lina-kljukica shrink-0" />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {pregled && pregled.zapiski.length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold">{t("danesZapiski")}</h4>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm marker:text-[var(--color-brass)]">
            {pregled.zapiski.slice(0, 5).map((z) => (
              <li key={z.id}>{z.naslov}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <h4 className="text-sm font-semibold">{t("predlogiNaslov")}</h4>
        <div className="mt-2 flex flex-wrap gap-2">
          {[t("predlog1"), t("predlog2"), t("predlog3")].map((p) => (
            <button key={p} type="button" onClick={() => onPredlog(p)} className="lina-predlog">
              {p}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

/** Kompaktna kartica »Danes« za zacetni zaslon (skica lastnika 21. 11. 2026): prvi dogodki in opomniki dneva iz istih virov kot polni pregled. */
export function DanesKartica({ onVec }: { onVec: () => void }) {
  const { zdaj, pregled, vrstice } = useDanes();
  const prikaz = vrstice.slice(0, 4);
  return (
    <aside className="lina-karta" aria-label={t("danesNaslov")}>
      <h3 className="lina-karta-naslov">
        <span>{t("danesNaslov")}</span>
        <button type="button" className="lina-karta-vec" onClick={onVec}>
          {t("d2Vec")} ›
        </button>
      </h3>
      <p className="lina-karta-datum">{zdaj ? datumBesedilo(zdaj) : " "}</p>
      {prikaz.length > 0 ? (
        <ul className="lina-danes-seznam">
          {prikaz.map((z) => (
            <li key={z.id}>
              <span className="lina-pika-dogodka" aria-hidden="true" />
              <span className="tabular-nums">{uraBesedilo(z.cas)}</span>
              <span className="lina-danes-naslov">{z.naslov}</span>
            </li>
          ))}
        </ul>
      ) : pregled ? (
        <p className="lina-karta-prazno">{t("danesPrazno")}</p>
      ) : null}
      {pregled && pregled.zamujeno.length > 0 ? (
        <p className="lina-karta-zamujeno">
          {t("danesZamujeno")}: {pregled.zamujeno.length}
        </p>
      ) : null}
    </aside>
  );
}

/** Opomniki v ozadju: ob casu pokaze sistemsko obvestilo in pasico v oknu; deluje, dokler je program zagnan (tudi v pladnju). */
export function OpomnikiVOzadju() {
  const [opozorila, setOpozorila] = useState<ZapisKoledar[]>([]);
  useEffect(() => {
    let ziv = true;
    try {
      if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    } catch {
      /* Pasica v oknu deluje tudi brez sistemskih obvestil. */
    }
    async function preveri() {
      try {
        const zapisi = await koledarSeznamFn();
        const zdaj = Date.now();
        const dospeli = zapisi.filter((z) => !z.opravljeno && !z.obvesceno && z.vrsta !== "zapisek" && z.cas && (razberiCas(z.cas)?.getTime() ?? Infinity) <= zdaj);
        if (!ziv || dospeli.length === 0) return;
        // Enotna odlocitev obvestil (22. 11. 2026): pasica v oknu ostane vedno, sistemsko obvestilo samo, ce odlocitev rece da
        // (ne moti, ure miru, raven za opomnike). Brez nastavitev veljajo privzete.
        const nastavitve = await nastavitveObvestilFn().catch(() => PRIVZETE_NASTAVITVE_OBVESTIL);
        for (const z of dospeli) {
          await koledarSpremeniFn({ data: { id: z.id, obvesceno: true } });
          // Opomnik, ki je zamudil ze vec kot 6 ur (program je bil ugasnjen), se ne razglasi na novo: ostane viden v pregledu kot zamujen.
          if (zdaj - (razberiCas(z.cas)?.getTime() ?? 0) > 6 * 3600 * 1000) continue;
          setOpozorila((prej) => [...prej, z]);
          try {
            const odl = odlociObvestilo(
              { vrsta: "opomnik", neposredno: true, casMs: razberiCas(z.cas)?.getTime() ?? zdaj, besedilo: z.naslov },
              nastavitve,
              { racunalnikAktiven: true, telefonPovezan: false, uraLokalno: new Date().getHours() },
            );
            if (odl.poslji && "Notification" in window && Notification.permission === "granted") new Notification(t("opozoriloNaslov"), { body: `${uraBesedilo(z.cas)} ${z.naslov}` });
          } catch {
            /* Pasica v oknu je dovolj. */
          }
        }
        window.dispatchEvent(new Event(DOGODEK_KOLEDAR));
      } catch {
        /* Brez prijave ali strežnika ni opomnikov. */
      }
    }
    void preveri();
    const casovnik = setInterval(() => void preveri(), 20_000);
    return () => {
      ziv = false;
      clearInterval(casovnik);
    };
  }, []);

  if (opozorila.length === 0) return null;
  return (
    <div className="fixed bottom-5 right-5 z-50 flex w-[min(24rem,calc(100vw-2.5rem))] flex-col gap-3" role="status" aria-live="polite">
      {opozorila.map((z) => (
        <div key={z.id} className="lina-opozorilo rounded-2xl bg-[var(--color-sheet)] p-4 shadow-lg">
          <p className="text-xs text-[var(--color-brass)]">{t("opozoriloNaslov")}, {uraBesedilo(z.cas)}</p>
          <p className="mt-1 text-sm">{z.naslov}</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="rounded-full bg-[var(--color-ink)] px-4 py-1.5 text-xs text-[var(--color-on-ink)]"
              onClick={async () => {
                await koledarSpremeniFn({ data: { id: z.id, opravljeno: true } });
                setOpozorila((prej) => prej.filter((p) => p.id !== z.id));
                window.dispatchEvent(new Event(DOGODEK_KOLEDAR));
              }}
            >
              {t("koledarOpravljeno")}
            </button>
            <button type="button" className="rounded-full border border-[var(--color-rule)] px-4 py-1.5 text-xs" onClick={() => setOpozorila((prej) => prej.filter((p) => p.id !== z.id))}>
              {t("opozoriloZapri")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
