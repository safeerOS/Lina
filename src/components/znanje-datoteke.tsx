import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { FOKUS } from "@/components/ui-lina.tsx";
import { izbrisiVirFn, naloziVirFn, objaviVirFn, potrdiPredlogDatotekeFn, pregledViraFn, seznamVirovFn, zavrziPredlogDatotekeFn } from "@/lib/lina/functions.ts";
import type { Catalog, Predlog } from "@/lib/lina/types.ts";
import { dodajBesedilo } from "@/lib/lina/znanje-besedilo.ts";
import { besedaDatotek as b } from "@/lib/lina/znanje-datoteke-besedila.ts";
import { odstraniBlok, type VirJavno } from "@/lib/lina/znanje-viri.ts";

const MEJA_BAJTOV = 15 * 1024 * 1024;

function fault(cause: unknown): string {
  return cause instanceof Error && cause.message ? cause.message : b("poskodovan");
}

/** Base64 po kosih (velik niz v enem klicu String.fromCharCode preseze sklad). */
function vBase64(bajti: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bajti.length; i += 0x8000) s += String.fromCharCode(...bajti.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Dokumenti podjetja (AGENTS.md »Znanje iz datotek podjetja«): nalaganje, seznam virov s pregledom in izbrisom, predlog izdelkov
 * s potrditvijo. Nalozen vir caka na lastnikovo »Dodaj v znanje« (drugi pregled 0.2.10, N9); sele takrat streznik blok »Vir: <ime>« doda v
 * shranjeno znanje, vmesnik pa ga s funkcijsko posodobitvijo doda se v svoje (morda neshranjeno) stanje, da ga naslednji »Shrani« ne izbrise.
 */
export function ZnanjeDatoteke({
  catalog,
  busy,
  onChange,
  onError,
}: {
  catalog: Catalog;
  busy: boolean;
  onChange: Dispatch<SetStateAction<Catalog>>;
  onError: (message: string) => void;
}) {
  const [viri, setViri] = useState<VirJavno[]>([]);
  const [predlog, setPredlog] = useState<Predlog | null>(null);
  const [pregled, setPregled] = useState<{ id: string; blok: string } | null>(null);
  const [dela, setDela] = useState(false);
  const [opomba, setOpomba] = useState("");
  useEffect(() => {
    seznamVirovFn()
      .then((s) => {
        setViri(s.viri);
        setPredlog(s.predlog);
      })
      .catch(() => void 0);
  }, []);
  const zaseden = busy || dela;

  async function nalozi(file: File | undefined) {
    if (!file) return;
    onError("");
    setOpomba("");
    setDela(true);
    try {
      if (file.size > MEJA_BAJTOV) throw new Error(b("velik"));
      const izid = await naloziVirFn({ data: { ime: file.name, b64: vBase64(new Uint8Array(await file.arrayBuffer())) } });
      setViri((v) => [...v, izid.vir]);
      if (izid.predlog) setPredlog(izid.predlog);
      setOpomba([izid.skrajsano ? b("skrajsano") : "", b("shrani"), izid.brezModela ? b("brezModela") : ""].filter(Boolean).join(" "));
    } catch (cause) {
      onError(fault(cause));
    } finally {
      setDela(false);
    }
  }

  async function objavi(id: string) {
    onError("");
    setOpomba("");
    setDela(true);
    try {
      const { blok } = await objaviVirFn({ data: { id } });
      // Najnovejse stanje (CodeRabbit): vmes je lahko uporabnik tipkal ali je osvezitev ze prinesla blok s streznika.
      onChange((c) => (c.znanje?.includes(blok) ? c : { ...c, znanje: dodajBesedilo(c.znanje ?? "", blok).besedilo }));
      setViri((v) => v.map((x) => (x.id === id ? { ...x, objavljen: true } : x)));
      setOpomba(b("objavljeno"));
    } catch (cause) {
      onError(fault(cause));
    } finally {
      setDela(false);
    }
  }

  async function prikazi(id: string) {
    if (pregled?.id === id) return setPregled(null);
    try {
      setPregled({ id, ...(await pregledViraFn({ data: { id } })) });
    } catch (cause) {
      onError(fault(cause));
    }
  }

  async function izbrisi(id: string) {
    onError("");
    setOpomba("");
    setDela(true);
    try {
      const { blok, odstranjeno } = await izbrisiVirFn({ data: { id } });
      // Streznik je blok ze odstranil iz shranjenega znanja; tu se odstrani se iz neshranjenega stanja vmesnika.
      onChange((c) => {
        const izid = odstraniBlok(c.znanje ?? "", blok);
        return izid.najdeno ? { ...c, znanje: izid.znanje } : c;
      });
      // Sporocilo po stanju ob kliku (posodobitev zgoraj se izvede pozneje); odstranjeno = blok je bil v shranjenem znanju.
      setOpomba(odstranjeno || odstraniBlok(catalog.znanje ?? "", blok).najdeno ? b("izbrisano") : b("urejeno"));
      setViri((v) => v.filter((x) => x.id !== id));
      if (pregled?.id === id) setPregled(null);
    } catch (cause) {
      onError(fault(cause));
    } finally {
      setDela(false);
    }
  }

  async function potrdi() {
    if (!predlog) return;
    setDela(true);
    onError("");
    try {
      const ids = predlog.vrstice.filter((v) => v.izbrano).map((v) => v.id);
      const naslednji = await potrdiPredlogDatotekeFn({ data: { ids } });
      // Znanje ostane iz vmesnika (morda se neshranjeni blok vira); izdelki in materiali pridejo s streznika.
      onChange((c) => ({ ...naslednji, znanje: c.znanje }));
      setPredlog(null);
    } catch (cause) {
      onError(fault(cause));
    } finally {
      setDela(false);
    }
  }

  async function zavrzi() {
    setDela(true);
    try {
      await zavrziPredlogDatotekeFn();
      setPredlog(null);
    } catch (cause) {
      onError(fault(cause));
    } finally {
      setDela(false);
    }
  }

  return (
    <section className="grid gap-2" aria-labelledby="znanje-datoteke-naslov">
      <h3 id="znanje-datoteke-naslov" className="text-sm font-semibold">
        {b("naslov")}
      </h3>
      <p className="text-xs text-[var(--color-moss)]">{b("namig")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label
          className={`w-fit cursor-pointer rounded-full bg-[var(--color-surface)] px-4 py-2 text-sm focus-within:outline focus-within:outline-2 ${zaseden ? "pointer-events-none opacity-60" : ""}`}
        >
          {dela ? b("nalagam") : b("nalozi")}
          <input
            type="file"
            accept=".docx,.odt,.xlsx,.csv,.txt,.md,.markdown,.pdf"
            className="sr-only"
            disabled={zaseden}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void nalozi(file);
            }}
          />
        </label>
        <span role="status" className="text-sm">
          {opomba}
        </span>
      </div>
      {viri.length === 0 ? (
        <p className="text-xs text-[var(--color-moss)]">{b("ni")}</p>
      ) : (
        <ul className="grid gap-1">
          {viri.map((v) => (
            <li key={v.id} className="grid gap-1 rounded-xl bg-[var(--color-surface)] px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 break-words">
                  {v.ime} · {v.vrsta.toUpperCase()} · {v.znakov} {b("znakov")}
                  {v.objavljen === false ? <span className="text-[var(--color-signal)]"> · {b("neobjavljen")}</span> : null}
                </span>
                {v.objavljen === false ? (
                  <button type="button" disabled={zaseden} onClick={() => void objavi(v.id)} className={`${FOKUS} rounded-full bg-[var(--color-ink)] px-3 py-1 text-[var(--color-sheet)]`}>
                    {b("objavi")}
                  </button>
                ) : null}
                <button type="button" disabled={zaseden} onClick={() => void prikazi(v.id)} aria-expanded={pregled?.id === v.id} className={`${FOKUS} rounded-full px-3 py-1 underline`}>
                  {pregled?.id === v.id ? b("skrij") : b("pregled")}
                </button>
                <button type="button" disabled={zaseden} onClick={() => void izbrisi(v.id)} className={`${FOKUS} rounded-full px-3 py-1 text-[var(--color-signal)] underline`}>
                  {b("izbrisi")}
                </button>
              </div>
              {pregled?.id === v.id ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{pregled.blok}</pre> : null}
            </li>
          ))}
        </ul>
      )}
      {predlog ? (
        <fieldset className="grid gap-1 rounded-xl border border-[var(--color-rule)] p-3">
          <legend className="text-sm font-semibold">
            {b("predlogNaslov")}: {predlog.sporocilo}
          </legend>
          {predlog.vrstice.map((v) => (
            <label key={v.id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={v.izbrano}
                disabled={zaseden}
                onChange={() =>
                  setPredlog((p) => (p ? { ...p, vrstice: p.vrstice.map((x) => (x.id === v.id ? { ...x, izbrano: !x.izbrano } : x)) } : p))
                }
              />
              <span>
                {v.ime}
                {v.opis ? ` – ${v.opis}` : ""}
              </span>
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={zaseden} onClick={() => void potrdi()} className={`${FOKUS} rounded-full bg-[var(--color-ink)] px-4 py-2 text-sm text-[var(--color-sheet)]`}>
              {b("potrdi")}
            </button>
            <button type="button" disabled={zaseden} onClick={() => void zavrzi()} className={`${FOKUS} rounded-full bg-[var(--color-surface)] px-4 py-2 text-sm`}>
              {b("zavrzi")}
            </button>
          </div>
        </fieldset>
      ) : null}
    </section>
  );
}
